<?php

namespace App\Domain\Billing\Handlers;

use App\Application\Command;
use App\Application\CommandHandler;
use App\Application\CommandOutcome;
use App\Application\Effects\AuditEntry;
use App\Application\Effects\ChangeKind;
use App\Application\Effects\ChangeRecord;
use App\Application\Effects\ChangeVisibility;
use App\Application\Effects\OutboxEvent;
use App\Application\Locking\TransactionLocks;
use App\Domain\Billing\BillingErrors;
use App\Domain\Billing\Catalog\CatalogSnapshot;
use App\Domain\Billing\Catalog\TaxRegime;
use App\Domain\Billing\Documents\PendingDocuments;
use App\Domain\Billing\ExamFeeScope;
use App\Domain\Billing\ExamFeeVisits;
use App\Domain\Billing\Guards\AuthoredSource;
use App\Domain\Billing\InvoiceDrafts;
use App\Domain\Billing\InvoiceLedger;
use App\Domain\Billing\Numbering\BillingNumbers;
use App\Domain\Billing\Numbering\NumberUsages;
use App\Domain\Billing\ReceiptRecorder;
use App\Domain\Billing\Rules\DraftLine;
use App\Domain\Billing\Rules\DraftLines;
use App\Domain\Billing\Rules\DraftPolicy;
use App\Domain\Billing\Rules\FieldErrors;
use App\Domain\Billing\Rules\LedgerBalance;
use App\Domain\Billing\Rules\PaymentRules;
use App\Domain\Billing\Snapshots\InvoiceSnapshots;
use App\Domain\Cash\CashSessions;
use App\Domain\Inventory\ReservationRefused;
use App\Domain\Inventory\ReservationRequest;
use App\Domain\Inventory\ReservationService;
use App\Domain\Shared\BusinessError;
use App\Domain\Shared\CommandContext;
use App\Domain\Shared\CommandSource;
use App\Domain\Shared\DeviceNumbers;
use App\Domain\Shared\RuleViolation;
use App\Domain\Shared\Ulid;
use App\Domain\Shared\ValueObjects\FixedDecimal;
use App\Domain\Shared\ValueObjects\Instant;
use App\Domain\Shared\ValueObjects\Quantity;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use LogicException;

/**
 * Émission d'une facture IMMUABLE (B03, EE021, EE023, EE045, AT08, AT09, AT37). Dans UNE transaction, sous le verrou du
 * cabinet, ce que le fichier 03 demande : validation des lignes, du patient et des taxes ; numéro définitif ;
 * snapshot de l'identité facturée, du cabinet, du catalogue (prix, désignation) et de la taxe ; réserve du stock des
 * articles stockés ; création du document PENDING ; audit, événement et journal des changements (chemin central).
 * Toute erreur annule l'ensemble, numéro compris : aucun trou, aucune réserve partielle.
 *
 * Ordre des écritures (triggers du schéma) : les ENFANTS d'abord, avec leurs snapshots (lignes recalculées et
 * figées, réserves, usage du numéro, document), puis le parent passe de `DRAFT` à `ISSUED` en UNE mise à jour. Dès
 * lors, plus aucune mise à jour de la facture ni de ses lignes n'est possible (guard `Issued or finalized parent`).
 * `invoices.version` reste la version DU BROUILLON, figée ; le solde, `ledger_version` et l'état de règlement sont
 * des projections des faits financiers qui suivront, jamais des colonnes de cette ligne.
 *
 * Route directe : le serveur attribue le numéro central, choisit positions et lots de la réserve, et n'attribue aucun
 * propriétaire de facture (aucun poste n'écrit cette facture). Commande d'un poste synchronisée (O05 ; contrat 23,
 * « Création locale de facture ») : le numéro est celui de la plage du poste, vérifié puis enregistré tel quel
 * (`DeviceNumbers`) ; la propriété d'écriture du poste est importée (époque suivante, initialement 1) dans la même
 * transaction ; les réserves sont celles que le poste a prises SOUS ses quotas, contrôlées ligne par ligne
 * (`reserveUnderQuota`) ; la date de la pièce est l'instant où le poste l'a émise. `total_gross` du client est une valeur À VÉRIFIER :
 * le serveur recalcule et refuse l'écart. `issued_at` du client doit être plausible (pas dans le futur au-delà de la
 * tolérance d'horloge) ; la date de la pièce est celle du serveur, relue APRÈS le verrou du cabinet (l'année du
 * numéro est celle de l'émission, au fuseau du cabinet).
 *
 * Document de production : refusé tant que le régime de taxe d'une ligne n'est pas validé (`test_document` faux
 * exige une règle fiscale applicable sur chaque ligne). Un document TEST peut porter `NO_TAX_CONFIGURED`.
 *
 * Verrous : cabinet, idempotence, séquence INVOICE (40), dossier patient (45), propriété de facture (50), facture
 * (60), positions (80), lots (81).
 */
final class IssueInvoiceHandler implements CommandHandler
{
    public const COMMAND = 'IssueInvoice';

    public function __construct(
        private readonly InvoiceDrafts $drafts,
        private readonly ReservationService $reservations,
        private readonly ExamFeeScope $examFee,
        private readonly ExamFeeVisits $visits,
    ) {}

    public function permissions(): array
    {
        return ['invoice.issue', 'exam_fee.collect'];
    }

    public function handle(Command $command, CommandContext $context, TransactionLocks $locks, ?string $idempotencyId): CommandOutcome
    {
        AuthoredSource::assert($context, 'L\'émission d\'une facture');
        $sync = $context->source === CommandSource::Sync;
        $payload = $command->payload;
        $invoiceId = (string) $payload['invoice_id'];
        $usageId = (string) $payload['number_usage_id'];
        $documentId = (string) $payload['document_id'];
        $at = CarbonImmutable::now('UTC');
        // Instant de la pièce : celui du serveur, ou celui où le poste a émis la facture (commande synchronisée).
        $pieceAt = $context->pieceInstant($at);
        $clinic = $locks->clinic();
        $timezone = (string) $clinic->timezone;

        $errors = new FieldErrors;
        $ownerId = null;
        if ($sync) {
            $ownerId = $payload['write_owner_id'] ?? null;
            if (! is_string($ownerId)) {
                $errors->add('write_owner_id', 'Une émission sur un poste importe sa propriété de facture : identifiant attendu.');
            } elseif (DB::table('invoice_write_owners')->where('id', $ownerId)->exists()) {
                $errors->add('write_owner_id', 'Cet identifiant de propriété de facture est déjà utilisé.');
            }
        } else {
            if (($payload['write_owner_id'] ?? null) !== null) {
                $errors->add('write_owner_id', 'Par la route directe, aucun poste ne détient la facture : laissez ce champ vide.');
            }
            if (($payload['reservations'] ?? []) !== []) {
                $errors->add('reservations', 'Par la route directe, le serveur choisit les positions et les lots : laissez cette liste vide.');
            }
        }
        if (NumberUsages::isTaken($usageId)) {
            $errors->add('number_usage_id', 'Cet identifiant d\'usage de numéro est déjà utilisé.');
        }
        if (PendingDocuments::isTaken($documentId)) {
            $errors->add('document_id', 'Cet identifiant de document est déjà utilisé.');
        }
        try {
            $claimed = Instant::parse((string) $payload['issued_at'], 'issued_at');
            $skew = ((int) config('eeo.offline.max_clock_skew_seconds', 300)) * 1000;
            if ($claimed !== null && $claimed->epochMilliseconds > ((int) $at->format('Uv')) + $skew) {
                $errors->add('issued_at', 'L\'horloge du poste est en avance sur celle du serveur : vérifiez l\'heure de l\'appareil.');
            }
        } catch (RuleViolation $violation) {
            $errors->addViolation('', $violation);
        }
        $errors->throwIfAny();

        // Lecture préalable sans verrou pour vérifier l'existence de la facture et connaître son patient avant le rang 40.
        $peek = DB::table('invoices')->where('clinic_id', $context->clinicId)->where('id', $invoiceId)->first();
        if ($peek === null) {
            throw BusinessError::notFound('Facture introuvable dans ce cabinet.');
        }

        $autoCollect = ! $sync && (int) ($payload['total_gross'] ?? 0) > 0;
        $sessionCandidate = null;
        if ($autoCollect) {
            if ($idempotencyId === null || $context->actorId === null) {
                throw new LogicException('L\'encaissement automatique à l\'émission exige une clé d\'idempotence et un auteur identifié.');
            }
            $sessionCandidate = CashSessions::resolveOpenForCollection($context->clinicId, $context->actorId, $pieceAt->format('Y-m-d H:i:s.u'));
            if ($sessionCandidate === null) {
                throw BusinessError::stateRefused(
                    'Ouvrez une session de caisse avant d\'émettre une facture : toute facture émise encaisse immédiatement 100 % en espèces.',
                    'CASH_SESSION_REQUIRED',
                );
            }
        }

        // 1. Numéros définitifs : facture, puis reçu si encaissement direct (rang 40, trié INVOICE < RECEIPT).
        $allocationId = null;
        $receiptNumber = null;
        if ($sync) {
            $consumed = DeviceNumbers::consume($context, BillingNumbers::INVOICE, $payload['number'] ?? null, BillingNumbers::render(...));
            $number = ['value' => $consumed['value'], 'rendered' => $consumed['rendered'], 'year' => $consumed['year']];
            $allocationId = $consumed['allocation_id'];
        } else {
            $number = BillingNumbers::allocate($locks, $context, BillingNumbers::INVOICE, $timezone, $at);
            if ($autoCollect) {
                $receiptNumber = BillingNumbers::allocate($locks, $context, BillingNumbers::RECEIPT, $timezone, $at);
            }
        }

        // 2. Patient (45), visite éventuelle (46), propriété (50) et facture (60), dans l'ordre du contrat.
        $patientId = (string) $peek->patient_id;
        $patient = $locks->patient($patientId);
        if ($patient === null) {
            throw BusinessError::notFound('Patient introuvable dans ce cabinet.');
        }
        $visit = $autoCollect ? $this->visits->lockForInvoice($locks, $context->clinicId, $invoiceId) : null;
        $owners = $locks->invoiceOwners($invoiceId);
        $ownedHere = false;
        foreach ($owners as $owner) {
            if (! in_array((string) $owner->status, ['ACTIVE', 'CLOSING'], true)) {
                continue;
            }
            if ($sync && (string) $owner->device_id === $context->deviceId) {
                $ownedHere = true;

                continue;
            }
            $name = DB::table('enrolled_devices')->where('clinic_id', $context->clinicId)->where('id', $owner->device_id)->value('name');
            throw BillingErrors::writeOwnerRequired(is_string($name) ? $name : 'poste');
        }
        $invoice = $locks->invoice($invoiceId);
        if ($invoice === null) {
            throw BusinessError::notFound('Facture introuvable dans ce cabinet.');
        }
        InvoiceDrafts::assertDraft($invoice);
        if ($command->expectedVersion === null || (int) $invoice->version !== $command->expectedVersion) {
            throw BillingErrors::versionConflict((int) $invoice->version);
        }
        if ($this->examFee->restricted($context, 'invoice.issue')) {
            $this->examFee->assertExamFeeInvoice($context->clinicId, $invoiceId);
        }
        if ($patient->merged_into_patient_id !== null) {
            throw BusinessError::validation(['patient_id' => ['Ce dossier a été fusionné : la facture ne peut plus être émise sur cette fiche.']]);
        }

        // 3. Lignes : recalcul et figement (mêmes règles que le brouillon, sans règle de droit).
        $rows = array_values(DB::table('invoice_lines')->where('clinic_id', $context->clinicId)->where('invoice_id', $invoiceId)->orderBy('position')->get()->all());
        if ($rows === []) {
            throw BusinessError::validation(['lines' => ['Une facture sans ligne ne s\'émet pas.']]);
        }
        $lines = $this->drafts->validated($context->clinicId, $invoiceId, $patientId, DraftLines::fromStored($rows), DraftPolicy::trusted(), false);
        try {
            $total = DraftLines::total($lines);
        } catch (RuleViolation $violation) {
            throw BusinessError::validation(['lines' => [$violation->getMessage()]]);
        }
        if ($total !== (int) $payload['total_gross']) {
            throw new BusinessError(
                'VALIDATION_FAILED',
                'Le total transmis diffère du total recalculé par le serveur : actualisez la facture.',
                422,
                ['total_gross' => ['Le total recalculé est '.$total.' FCFA.']],
                null,
                [],
                ['expected_total' => $total],
            );
        }

        $testDocument = InvoiceSnapshots::isTestDocument($clinic);
        if (! $testDocument) {
            $untaxed = new FieldErrors;
            foreach ($lines as $index => $line) {
                if ($line->taxRuleId === null) {
                    $untaxed->add('lines.'.$index.'.catalog_item_id', 'Document de production : cette ligne n\'a aucune règle fiscale validée.');
                }
            }
            $untaxed->throwIfAny();
        }
        $ruleIds = array_values(array_filter(array_map(static fn (DraftLine $line): ?string => $line->taxRuleId, $lines)));
        $usedRules = TaxRegime::applicable($context->clinicId, $ruleIds);

        $this->drafts->write($context->clinicId, $invoiceId, $patientId, $lines, $at, true);

        $cashSession = null;
        if ($sessionCandidate !== null) {
            $cashSession = $locks->cashSession((string) $sessionCandidate->id);
            if ($cashSession === null || $cashSession->closed_at !== null) {
                throw BusinessError::stateRefused(
                    'La session de caisse vient d\'être clôturée : ouvrez-en une nouvelle pour émettre la facture.',
                    'CASH_SESSION_REQUIRED',
                );
            }
        }

        // 4. Réserve du stock (positions 80, lots 81), atomique pour toutes les lignes.
        $requests = [];
        $lineIndex = [];
        foreach ($lines as $index => $line) {
            $lineIndex[$line->id] = $index;
            if ($line->stocked && $line->catalogItemId !== null) {
                $requests[] = new ReservationRequest($line->id, $line->catalogItemId, $line->quantity, $line->requiresExpiry);
            }
        }
        $localDate = Instant::fromEpochMilliseconds((int) $pieceAt->format('Uv'))->civilDate($timezone);
        try {
            $reserved = $sync
                ? $this->reservations->reserveUnderQuota($context->clinicId, $locks, (string) $context->deviceId, $localDate, $this->deviceReservations($context, $lines, $payload['reservations'] ?? [], $lineIndex), $at)
                : $this->reservations->reserveCentral($context->clinicId, $locks, $localDate, $requests, $at);
        } catch (ReservationRefused $refusal) {
            throw $refusal->toBusinessError('lines.'.($lineIndex[$refusal->invoiceLineId] ?? 0).'.quantity');
        }

        // 5. Pièces enfants (propriété importée d'un poste comprise), puis le parent passe à ISSUED.
        NumberUsages::record($context, $usageId, BillingNumbers::INVOICE, $number, 'invoices', $invoiceId, $at, $allocationId, $context->deviceId);
        $nowDb = $at->format('Y-m-d H:i:s.u');
        $issuedDb = $pieceAt->format('Y-m-d H:i:s.u');
        $catalog = CatalogSnapshot::of($context->clinicId);
        $importedOwner = null;
        if ($sync && ! $ownedHere && is_string($ownerId)) {
            $epoch = 1 + array_reduce($owners, static fn (int $carry, object $owner): int => max($carry, (int) $owner->epoch), 0);
            DB::table('invoice_write_owners')->insert([
                'id' => $ownerId,
                'clinic_id' => $context->clinicId,
                'invoice_id' => $invoiceId,
                'device_id' => (string) $context->deviceId,
                'epoch' => $epoch,
                'status' => 'ACTIVE',
                'granted_at' => $nowDb,
                'closed_at' => null,
                'final_device_sequence' => null,
                'created_at' => $nowDb,
                'updated_at' => $nowDb,
            ]);
            $importedOwner = ['owner_id' => $ownerId, 'epoch' => $epoch];
        }

        $patientSnapshotJson = self::json(InvoiceSnapshots::patient($patient));
        DB::table('invoices')->where('clinic_id', $context->clinicId)->where('id', $invoiceId)->update([
            'number' => $number['rendered'],
            'issued_at' => $issuedDb,
            'issued_by' => $context->actorId,
            'number_usage_id' => $usageId,
            'status' => 'ISSUED',
            'total_gross' => $total,
            'patient_snapshot' => $patientSnapshotJson,
            'clinic_snapshot' => self::json(InvoiceSnapshots::clinic($clinic)),
            'tax_snapshot' => self::json(InvoiceSnapshots::tax($usedRules)),
            'updated_at' => $nowDb,
        ]);
        PendingDocuments::forInvoice($context, $documentId, $invoiceId, $at);

        $ledger = LedgerBalance::of($total, [], [], [], []);
        $draftVersion = (int) $invoice->version;
        $issuedAt = $pieceAt->format('Y-m-d\TH:i:s.v\Z');

        $auditEntries = [new AuditEntry('invoice.issued', 'invoices', $invoiceId, null, [
            'number' => $number['rendered'],
            'patient_id' => $patientId,
            'total_gross' => $total,
            'lines' => count($lines),
            'reservations' => count($reserved),
            'test_document' => $testDocument,
            'tax_regime' => InvoiceSnapshots::tax($usedRules)['regime'],
            'catalog_snapshot_sha256' => $catalog['sha256'],
            'client_catalog_snapshot_sha256' => (string) $payload['catalog_snapshot_sha256'],
            'client_issued_at' => (string) $payload['issued_at'],
            'source_device_id' => $context->deviceId,
            'write_owner' => $importedOwner,
        ])];

        $collectedPayment = null;
        $extraChanges = [];
        if ($receiptNumber !== null && $total > 0) {
            $paymentId = Ulid::generate();
            $receiptId = Ulid::generate();
            $receiptUsageId = Ulid::generate();
            $receiptDocumentId = Ulid::generate();
            $issuedRow = (object) [
                'id' => $invoiceId,
                'number' => $number['rendered'],
                'issued_at' => $issuedDb,
                'total_gross' => $total,
                'currency' => (string) $invoice->currency,
                'patient_snapshot' => $patientSnapshotJson,
            ];
            $effective = Instant::fromEpochMilliseconds((int) $pieceAt->format('Uv'));
            $ledger = ReceiptRecorder::record(
                $context,
                $clinic,
                $issuedRow,
                $ledger,
                $paymentId,
                $receiptId,
                $receiptUsageId,
                $receiptDocumentId,
                $total,
                PaymentRules::CASH,
                null,
                (string) $cashSession->id,
                $receiptNumber,
                $effective,
                $pieceAt,
                $at,
                $idempotencyId,
            );
            $visitChange = $this->visits->refresh($context, $visit);
            $extraChanges[] = new ChangeRecord('payments', $paymentId, 1, ChangeVisibility::Financial, ChangeKind::Created);
            $extraChanges[] = new ChangeRecord('receipts', $receiptId, 1, ChangeVisibility::Financial, ChangeKind::Created);
            if ($visitChange !== null) {
                $extraChanges[] = $visitChange;
            }
            $auditEntries[] = new AuditEntry('payment.confirmed', 'payments', $paymentId, null, [
                'invoice_id' => $invoiceId,
                'amount' => $total,
                'method' => PaymentRules::CASH,
                'receipt_number' => $receiptNumber['rendered'],
                'ledger_version_before' => 1,
                'ledger_version_after' => $ledger->ledgerVersion,
                'balance_after' => $ledger->signedBalance(),
                'cash_session_id' => (string) $cashSession->id,
                'receipt_kind' => PaymentRules::receiptKind($ledger->signedBalance()),
                'auto_collected_on_issue' => true,
            ]);
            $collectedPayment = [
                'payment_id' => $paymentId,
                'receipt_id' => $receiptId,
                'receipt_number' => $receiptNumber['rendered'],
                'effective' => $effective->toString(),
            ];
        }

        $publicationVersion = InvoiceLedger::publicationVersion($draftVersion, $ledger->ledgerVersion);
        $changes = [new ChangeRecord('invoices', $invoiceId, $publicationVersion, ChangeVisibility::Financial, ChangeKind::Updated), ...$extraChanges];
        if ($importedOwner !== null) {
            $changes[] = new ChangeRecord('invoice_write_owners', $importedOwner['owner_id'], 1, ChangeVisibility::Manager, ChangeKind::Created);
        }

        $events = [new OutboxEvent('InvoiceIssued', 1, 'invoices', $invoiceId, $publicationVersion, [
            'invoice_id' => $invoiceId,
            'patient_id' => $patientId,
            'number' => $number['rendered'],
            'issued_at' => $issuedAt,
            'total_gross' => $total,
            'currency' => (string) $invoice->currency,
            'source_device_id' => $context->deviceId,
        ])];
        if ($collectedPayment !== null) {
            $events[] = new OutboxEvent('PaymentConfirmed', 1, 'invoices', $invoiceId, $publicationVersion, [
                'payment_id' => $collectedPayment['payment_id'],
                'invoice_id' => $invoiceId,
                'receipt_id' => $collectedPayment['receipt_id'],
                'receipt_number' => $collectedPayment['receipt_number'],
                'amount' => $total,
                'currency' => (string) $invoice->currency,
                'method' => PaymentRules::CASH,
                'effective_at' => $collectedPayment['effective'],
            ]);
        }

        return new CommandOutcome(
            result: [
                'invoice_id' => $invoiceId,
                'number' => $number['rendered'],
                'draft_version' => $draftVersion,
                'ledger_version' => $ledger->ledgerVersion,
                'total_gross' => $total,
                'document_id' => $documentId,
                'document_status' => 'PENDING',
            ],
            resultType: 'invoices',
            resultId: $invoiceId,
            audit: $auditEntries,
            events: $events,
            changes: $changes,
        );
    }

    /**
     * Réserves prises par le poste SOUS ses quotas (commande synchronisée) : chaque entrée désigne une ligne d'article
     * STOCKÉ de cette facture et son article ; les quantités d'une ligne couvrent exactement la ligne ; les quotas
     * employés sont exactement ceux que le cœur signé déclare (`stock_allocation_ids`). Le contrôle des quotas, positions
     * et lots (cohérence, disponible, péremption) est celui de `reserveUnderQuota`.
     *
     * @param  list<DraftLine>  $lines
     * @param  array<string, int>  $lineIndex
     * @return list<array{reservation_id: string, request: ReservationRequest, device_allocation_id: string, stock_position_id: string, stock_lot_id: ?string}>
     */
    private function deviceReservations(CommandContext $context, array $lines, mixed $entries, array $lineIndex): array
    {
        $stocked = [];
        foreach ($lines as $line) {
            if ($line->stocked && $line->catalogItemId !== null) {
                $stocked[$line->id] = $line;
            }
        }

        $errors = new FieldErrors;
        $planned = [];
        $covered = [];
        $quotaIds = [];
        foreach (is_array($entries) ? array_values($entries) : [] as $index => $entry) {
            $entry = is_array($entry) ? $entry : [];
            $line = is_string($entry['invoice_line_id'] ?? null) ? ($stocked[$entry['invoice_line_id']] ?? null) : null;
            if ($line === null || ($entry['item_id'] ?? null) !== $line->catalogItemId) {
                $errors->add('reservations.'.$index.'.invoice_line_id', 'Cette réserve ne correspond à aucune ligne d\'article stocké de la facture.');

                continue;
            }
            try {
                $quantity = Quantity::of((string) ($entry['quantity'] ?? ''), 'reservations.'.$index.'.quantity');
            } catch (RuleViolation $violation) {
                $errors->addViolation('', $violation);

                continue;
            }
            $quotaId = (string) ($entry['device_allocation_id'] ?? '');
            $quotaIds[] = $quotaId;
            $covered[$line->id] = ($covered[$line->id] ?? FixedDecimal::fromUnits(0, 3))->plus($quantity);
            $planned[] = [
                'reservation_id' => (string) ($entry['reservation_id'] ?? ''),
                'request' => new ReservationRequest($line->id, (string) $line->catalogItemId, $quantity, $line->requiresExpiry),
                'device_allocation_id' => $quotaId,
                'stock_position_id' => (string) ($entry['stock_position_id'] ?? ''),
                'stock_lot_id' => is_string($entry['stock_lot_id'] ?? null) ? $entry['stock_lot_id'] : null,
            ];
        }
        foreach ($stocked as $lineId => $line) {
            if (! isset($covered[$lineId]) || $covered[$lineId]->compare($line->quantity) !== 0) {
                $errors->add('lines.'.($lineIndex[$lineId] ?? 0).'.quantity', 'Les réserves du poste ne couvrent pas exactement la quantité de cette ligne.');
            }
        }
        $used = array_values(array_unique($quotaIds));
        sort($used, SORT_STRING);
        if ($used !== ($context->syncReferences->stockAllocationIds ?? [])) {
            $errors->add('reservations', 'Les quotas employés ne sont pas ceux que déclare la commande signée du poste.');
        }
        $errors->throwIfAny();

        return $planned;
    }

    /**
     * @param  array<string, mixed>  $snapshot
     */
    private static function json(array $snapshot): string
    {
        return json_encode($snapshot, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    }
}
