<?php

namespace Tests\Support;

use App\Application\Locking\TransactionLocks;
use App\Application\TransactionRunner;
use App\Domain\Access\EffectivePermissions;
use App\Domain\Billing\Catalog\TaxRegime;
use App\Domain\Billing\Documents\PendingDocuments;
use App\Domain\Billing\InvoiceDrafts;
use App\Domain\Billing\Numbering\BillingNumbers;
use App\Domain\Billing\Numbering\NumberUsages;
use App\Domain\Billing\Rules\DraftLine;
use App\Domain\Billing\Rules\DraftLines;
use App\Domain\Billing\Rules\DraftPolicy;
use App\Domain\Billing\Snapshots\InvoiceSnapshots;
use App\Domain\Cash\CashSessions;
use App\Domain\Inventory\ReservationRequest;
use App\Domain\Inventory\ReservationService;
use App\Domain\Shared\CommandContext;
use App\Domain\Shared\Ulid;
use App\Domain\Shared\ValueObjects\Instant;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;

/**
 * Cabinet, comptes, patient, catalogue, caisse, stock, appels et corps de requêtes FICTIFS pour les tests des ventes
 * (B01 à B05, I00). Aucun prix, taxe ni stock réel : « Examen de vue (fictif) » à 15 000, « Monture » à 40 000, etc.
 *
 * Horloge : `bootBilling()` fige l'horloge EN PREMIER (2026-10-22 09:30 UTC, soit 10 h 30 à Douala), avant de créer les
 * comptes (une permission n'est effective qu'à partir de l'instant d'attribution du profil). Chaque test remet
 * l'horloge en place dans tearDown (`resetClock()`).
 *
 * Les helpers `create*`, `issue*` et `pay*` passent par l'API réelle (chemin central de commandes) ; les `seed*`
 * insèrent directement les lignes de départ que la commande testée suppose existantes.
 */
trait BillingFixtures
{
    use AccessFixtures;
    use PatientFixtures;
    use ValidatesContracts;

    protected string $clinicId;

    protected User $manager;

    protected User $clinician;

    protected User $reception;

    protected User $cashier;

    protected string $patientId;

    protected string $registerId;

    protected string $locationId;

    /** @var array<string, string> identifiants des articles fictifs : exam, frame, lens, drops */
    protected array $item = [];

    /** Instant d'émission des pièces dans les tests (09 h 30 UTC). */
    protected const NOW = '2026-10-22T09:30:00.000Z';

    /**
     * @param  list<string>  $modules
     */
    protected function bootBilling(array $modules = ['sales', 'stock']): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-10-22 09:30:00', 'UTC'));
        config([
            'eeo.enabled_modules' => $modules,
            'eeo.billing.exam_fee_control' => 'off',
            'eeo.billing.exam_fee_item_reference' => 'EX-001',
            'eeo.billing.discount_cap_percent' => '0',
            'eeo.billing.payment_reference_required' => ['MTN_MOMO', 'ORANGE_MONEY', 'BANK_TRANSFER'],
            'eeo.numbering.width' => 6,
            'eeo.numbering.prefixes' => ['INVOICE' => 'TEST-FAC', 'RECEIPT' => 'TEST-REC', 'CREDIT_NOTE' => 'TEST-AV', 'REFUND' => 'TEST-RMB'],
        ]);

        $this->clinicId = $this->makeClinic();
        $this->manager = $this->makeStaff($this->clinicId, 'MANAGER', 'gerante.test');
        $this->clinician = $this->makeStaff($this->clinicId, 'CLINICIAN', 'pro.test');
        $this->reception = $this->makeStaff($this->clinicId, 'RECEPTION', 'accueil.test');
        $this->cashier = $this->makeStaff($this->clinicId, 'CASHIER', 'caisse.test');
        $this->patientId = $this->seedPatient($this->clinicId);
        $this->registerId = $this->seedRegister($this->clinicId);
        $this->locationId = $this->seedLocation($this->clinicId);

        $this->item = [
            'exam' => $this->seedItem($this->clinicId, ['reference' => 'EX-001', 'name' => 'Examen de vue (fictif)', 'category_code' => 'SERVICE', 'unit_code' => 'SERVICE', 'quantity_integer_only' => 0, 'sale_price' => 15000, 'stock_mode' => 'NONE']),
            'frame' => $this->seedItem($this->clinicId, ['reference' => 'FR-001', 'name' => 'Monture fictive', 'category_code' => 'FRAME', 'unit_code' => 'UNIT', 'sale_price' => 40000, 'stock_mode' => 'STOCKED']),
            'lens' => $this->seedItem($this->clinicId, ['reference' => 'LS-001', 'name' => 'Verres fictifs sur mesure', 'category_code' => 'LENS', 'unit_code' => 'PAIR', 'sale_price' => 60000, 'stock_mode' => 'MADE_TO_ORDER']),
            'drops' => $this->seedItem($this->clinicId, ['reference' => 'CO-001', 'name' => 'Collyre fictif', 'category_code' => 'COLLYRE', 'unit_code' => 'UNIT', 'sale_price' => 5000, 'stock_mode' => 'STOCKED', 'requires_expiry' => 1]),
        ];
    }

    protected function resetClock(): void
    {
        CarbonImmutable::setTestNow();
    }

    // ------------------------------------------------------------------------------------------------------------
    // Lignes de départ insérées directement
    // ------------------------------------------------------------------------------------------------------------

    protected function seedRegister(string $clinicId, string $code = 'CAISSE-PRINCIPALE'): string
    {
        $id = Ulid::generate();
        DB::table('cash_registers')->insert(['id' => $id, 'clinic_id' => $clinicId, 'code' => $code, 'name' => 'Caisse fictive', 'active' => 1]);

        return $id;
    }

    protected function seedLocation(string $clinicId, string $code = 'PRINCIPAL'): string
    {
        $id = Ulid::generate();
        DB::table('stock_locations')->insert(['id' => $id, 'clinic_id' => $clinicId, 'code' => $code, 'name' => 'Emplacement fictif', 'active' => 1]);

        return $id;
    }

    /**
     * Article du catalogue (fictif).
     *
     * @param  array<string, mixed>  $overrides
     */
    protected function seedItem(string $clinicId, array $overrides = []): string
    {
        $id = Ulid::generate();
        DB::table('catalog_items')->insert($overrides + [
            'id' => $id,
            'clinic_id' => $clinicId,
            'reference' => 'ART-'.substr($id, -8),
            'category_code' => 'OTHER',
            'name' => 'Article fictif',
            'brand' => null,
            'model' => null,
            'unit_code' => 'UNIT',
            'quantity_integer_only' => 1,
            'sale_price' => 10000,
            'purchase_cost' => null,
            'tax_rule_id' => null,
            'stock_mode' => 'NONE',
            'requires_expiry' => 0,
            'low_stock_threshold' => null,
            'expiry_alert_days' => null,
            'active' => 1,
            'public_visibility' => 0,
            'version' => 1,
        ]);

        return (string) ($overrides['id'] ?? $id);
    }

    /**
     * Règle fiscale FICTIVE : active et validée par la gérante, ou non.
     */
    protected function seedTaxRule(string $code = 'TEST_TAXE', string $rate = '10.0000', bool $validated = true): string
    {
        $id = Ulid::generate();
        DB::table('tax_rules')->insert([
            'id' => $id,
            'clinic_id' => $this->clinicId,
            'code' => $code,
            'label' => 'Taxe fictive',
            'rate_percent' => $rate,
            'active' => $validated ? 1 : 0,
            'validated_by' => $validated ? $this->manager->id : null,
            'validated_at' => $validated ? '2026-10-20 08:00:00.000000' : null,
            'legal_note' => 'Fictive',
            'version' => 1,
        ]);

        return $id;
    }

    /**
     * Position de stock (article × emplacement) avec sa quantité physique.
     */
    protected function seedPosition(string $itemId, string $onHand, string $reserved = '0', string $offlineAllocated = '0'): string
    {
        $id = Ulid::generate();
        DB::table('stock_positions')->insert([
            'id' => $id,
            'clinic_id' => $this->clinicId,
            'item_id' => $itemId,
            'location_id' => $this->locationId,
            'on_hand' => $onHand,
            'reserved' => $reserved,
            'offline_allocated' => $offlineAllocated,
            'version' => 1,
        ]);

        return $id;
    }

    protected function seedLot(string $positionId, string $itemId, string $batch, ?string $expiresOn, string $onHand, string $status = 'SELLABLE', string $reserved = '0'): string
    {
        $id = Ulid::generate();
        DB::table('stock_lots')->insert([
            'id' => $id,
            'clinic_id' => $this->clinicId,
            'item_id' => $itemId,
            'location_id' => $this->locationId,
            'stock_position_id' => $positionId,
            'batch_number' => $batch,
            'expires_on' => $expiresOn,
            'received_at' => '2026-10-01 08:00:00.000000',
            'unit_cost' => null,
            'status' => $status,
            'on_hand' => $onHand,
            'reserved' => $reserved,
            'offline_allocated' => '0',
            'version' => 1,
        ]);

        return $id;
    }

    /**
     * Poste enrôlé fictif (fixture directe : l'enrôlement des postes est O02).
     */
    protected function seedDevice(string $name = 'Caisse A'): string
    {
        $device = Ulid::generate();
        DB::table('enrolled_devices')->insert([
            'id' => $device, 'clinic_id' => $this->clinicId, 'device_code' => 'POSTE-'.substr($device, -8), 'name' => $name,
            'public_key_jwk' => '{"kty":"EC","crv":"P-256","x":"TEST","y":"TEST"}', 'key_algorithm' => 'ES256', 'status' => 'ACTIVE',
            'enrolled_by' => $this->manager->id, 'responsible_user_id' => $this->manager->id, 'enrolled_at' => '2026-10-14 08:00:00.000000', 'app_version' => '0.0.0-test',
        ]);

        return $device;
    }

    /**
     * Poste enrôlé « Caisse A » et sa propriété de la facture (fixture directe : l'enrôlement des postes est O02).
     * Avec le statut ACTIVE ou CLOSING, la facture n'est plus écrite par l'API centrale ; CLOSED ne bloque plus.
     */
    protected function seedWriteOwner(string $invoiceId, string $status = 'ACTIVE'): string
    {
        $device = $this->seedDevice('Caisse A');
        DB::table('invoice_write_owners')->insert([
            'id' => Ulid::generate(), 'clinic_id' => $this->clinicId, 'invoice_id' => $invoiceId, 'device_id' => $device, 'epoch' => 1, 'status' => $status,
            'granted_at' => '2026-10-22 08:00:00.000000',
            'closed_at' => $status === 'CLOSED' ? '2026-10-22 09:00:00.000000' : null,
            'final_device_sequence' => $status === 'CLOSED' ? 4 : null,
        ]);

        return $device;
    }

    /**
     * Donne une permission au compte (dérogation nominative autorisée) ; le cache des droits est oublié.
     */
    protected function allowPermission(User $user, string $permission): void
    {
        DB::table('user_permissions')->insert([
            'id' => Ulid::generate(),
            'clinic_id' => $this->clinicId,
            'user_id' => $user->id,
            'permission_code' => $permission,
            'allowed' => true,
            'assigned_by' => $this->manager->id,
            'reason' => 'Test',
            'expires_at' => null,
            'created_at' => '2026-01-01 00:00:00.000000',
            'updated_at' => '2026-01-01 00:00:00.000000',
        ]);
        $this->app->make(EffectivePermissions::class)->forget($user);
    }

    protected function denyPermission(User $user, string $permission): void
    {
        DB::table('user_permissions')->insert([
            'id' => Ulid::generate(),
            'clinic_id' => $this->clinicId,
            'user_id' => $user->id,
            'permission_code' => $permission,
            'allowed' => false,
            'assigned_by' => $this->manager->id,
            'reason' => 'Test',
            'expires_at' => null,
            'created_at' => '2026-01-01 00:00:00.000000',
            'updated_at' => '2026-01-01 00:00:00.000000',
        ]);
        $this->app->make(EffectivePermissions::class)->forget($user);
    }

    // ------------------------------------------------------------------------------------------------------------
    // Corps de requêtes (route directe)
    // ------------------------------------------------------------------------------------------------------------

    /**
     * Ligne de brouillon : prix du catalogue par défaut.
     *
     * @return array<string, mixed>
     */
    protected function line(string $itemId, string $quantity = '1', int $position = 1, ?int $price = null, int $discount = 0, string $description = 'Ligne fictive'): array
    {
        return [
            'line_id' => Ulid::generate(),
            'position' => $position,
            'catalog_item_id' => $itemId,
            'description' => $description,
            'quantity' => $quantity,
            'unit_price_gross' => $price ?? (int) DB::table('catalog_items')->where('id', $itemId)->value('sale_price'),
            'discount_gross' => $discount,
            'prescription_id' => null,
        ];
    }

    /**
     * @param  list<array<string, mixed>>  $lines
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    protected function draftBody(array $lines, array $overrides = []): array
    {
        return array_merge([
            'expected_version' => null,
            'invoice_id' => Ulid::generate(),
            'patient_id' => $this->patientId,
            'visit_id' => null,
            'due_date' => null,
            'lines' => $lines,
        ], $overrides);
    }

    /**
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    protected function issueBody(string $invoiceId, int $draftVersion, int $total, array $overrides = []): array
    {
        return array_merge([
            'expected_version' => $draftVersion,
            'invoice_id' => $invoiceId,
            'number_usage_id' => Ulid::generate(),
            'number' => null,
            'issued_at' => '2026-10-22T09:29:00.000Z',
            'total_gross' => $total,
            'write_owner_id' => null,
            'catalog_snapshot_sha256' => str_repeat('a', 64),
            'reservations' => [],
            'document_id' => Ulid::generate(),
        ], $overrides);
    }

    /**
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    protected function paymentBody(string $invoiceId, int $ledgerVersion, int $amount, string $method = 'MTN_MOMO', array $overrides = []): array
    {
        return array_merge([
            'expected_version' => $ledgerVersion,
            'invoice_id' => $invoiceId,
            'payment_id' => Ulid::generate(),
            'receipt_id' => Ulid::generate(),
            'receipt_number_usage_id' => Ulid::generate(),
            'receipt_number' => null,
            'amount' => $amount,
            'currency' => 'XAF',
            'method' => $method,
            'reference' => $method === 'CASH' ? null : 'REFERENCE_FICTIVE',
            'effective_at' => self::NOW,
            'cash_session_id' => null,
            'retroactive_reason' => null,
            'receipt_document_id' => Ulid::generate(),
        ], $overrides);
    }

    /**
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    protected function openSessionBody(int $opening = 25000, array $overrides = []): array
    {
        return array_merge([
            'expected_version' => null,
            'cash_session_id' => Ulid::generate(),
            'cash_register_id' => $this->registerId,
            'opening_amount' => $opening,
            'opened_at' => '2026-10-22T09:00:00.000Z',
        ], $overrides);
    }

    /**
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    protected function closeSessionBody(string $sessionId, int $counted, int $expected, ?string $reason = null, array $overrides = []): array
    {
        return array_merge([
            'expected_version' => null,
            'cash_session_id' => $sessionId,
            // L'heure du poste n'est pas dans le futur du serveur (horloge figée à NOW) : sinon refus « horloge en avance ».
            'closed_at' => self::NOW,
            'counted_amount' => $counted,
            'expected_amount' => $expected,
            'variance' => $counted - $expected,
            'variance_reason' => $reason,
        ], $overrides);
    }

    // ------------------------------------------------------------------------------------------------------------
    // Appels de l'API réelle
    // ------------------------------------------------------------------------------------------------------------

    /**
     * Appel d'écriture d'un compte, avec sa clé d'idempotence (nouvelle par défaut).
     *
     * @param  array<string, mixed>  $body
     */
    protected function write(string $method, string $uri, array $body, ?User $as = null, ?string $key = null): TestResponse
    {
        return $this->actingAsFresh($as ?? $this->cashier)
            ->withHeaders(['Idempotency-Key' => $key ?? Ulid::generate()])
            ->json($method, $uri, $body);
    }

    protected function read(string $uri, ?User $as = null): TestResponse
    {
        return $this->actingAsFresh($as ?? $this->cashier)->getJson($uri);
    }

    /**
     * @param  list<array<string, mixed>>|null  $lines
     * @param  array<string, mixed>  $overrides
     */
    protected function createDraft(?array $lines = null, ?User $as = null, array $overrides = [], ?string $key = null): TestResponse
    {
        $lines ??= [$this->line($this->item['exam'])];

        return $this->write('POST', '/api/v1/invoices', $this->draftBody($lines, $overrides), $as, $key);
    }

    /**
     * Brouillon créé par l'API : [identifiant, total].
     *
     * @param  list<array<string, mixed>>|null  $lines
     * @return array{0: string, 1: int, 2: int} identifiant, total, version du brouillon
     */
    protected function draft(?array $lines = null, ?User $as = null, array $overrides = []): array
    {
        $response = $this->createDraft($lines, $as, $overrides);
        $response->assertCreated();

        return [(string) $response->json('data.id'), (int) $response->json('data.total_gross'), (int) $response->json('data.draft_version')];
    }

    /**
     * Garantit qu'une session de caisse ouverte existe avant l'émission d'une facture (règle A1).
     */
    protected function ensureOpenCashSession(?User $as = null): string
    {
        $now = CarbonImmutable::now('UTC');
        $actor = $as ?? $this->cashier;
        $existing = CashSessions::resolveOpenForCollection($this->clinicId, (string) $actor->getKey(), $now->format('Y-m-d H:i:s.u'));
        if ($existing !== null) {
            return (string) $existing->id;
        }

        $openedAt = $now->subMinutes(30)->toIso8601ZuluString('millisecond');
        $body = $this->openSessionBody(25000, ['opened_at' => $openedAt]);
        $this->write('POST', '/api/v1/cash-sessions', $body, $this->cashier)->assertCreated();

        return (string) $body['cash_session_id'];
    }

    /**
     * Facture créée ET émise par l'API (avec ouverture de caisse préalable, règle A1) : [identifiant, total, numéro].
     *
     * @param  list<array<string, mixed>>|null  $lines
     * @return array{0: string, 1: int, 2: string} identifiant, total, numéro
     */
    protected function issuedInvoice(?array $lines = null, ?User $as = null): array
    {
        $this->ensureOpenCashSession($as);
        [$id, $total, $version] = $this->draft($lines, $as);
        $response = $this->write('POST', '/api/v1/invoices/'.$id.'/issue', $this->issueBody($id, $version, $total), $as);
        $response->assertOk();

        return [$id, $total, (string) $response->json('data.number')];
    }

    /**
     * Facture NATIVE émise SANS encaissement initial (`ledger_version = 1`, `balance_due = total`, équivalent
     * d'une pièce émise hors ligne avant encaissement) pour les tests d'acompte/solde et de modes hors espèces.
     *
     * @param  list<array<string, mixed>>|null  $lines
     * @return array{0: string, 1: int, 2: string} identifiant, total, numéro
     */
    protected function issuedUncollectedInvoice(?array $lines = null, ?User $as = null, array $draftOverrides = []): array
    {
        $actor = $as ?? $this->cashier;
        [$id, $total] = $this->draft($lines, $actor, $draftOverrides);

        /** @var array{0: string, 1: int, 2: string} */
        return $this->app->make(TransactionRunner::class)->run(function () use ($id, $total, $actor): array {
            $now = CarbonImmutable::now('UTC');
            $pieceAt = $now->subMinute();
            $context = CommandContext::direct($actor, 'test-uncollected-issue-'.$id, $now);
            $locks = new TransactionLocks($this->clinicId);
            $clinic = $locks->clinic();
            $timezone = (string) ($clinic->timezone ?? 'Africa/Douala');

            $number = BillingNumbers::allocate($locks, $context, BillingNumbers::INVOICE, $timezone, $pieceAt);
            $invoiceRow = DB::table('invoices')->where('clinic_id', $this->clinicId)->where('id', $id)->first();
            if ($invoiceRow === null) {
                throw new \RuntimeException('Draft introuvable.');
            }
            $patient = $locks->patient((string) $invoiceRow->patient_id);
            $locks->invoice($id);

            $storedRows = array_values(DB::table('invoice_lines')->where('clinic_id', $this->clinicId)->where('invoice_id', $id)->orderBy('position')->get()->all());
            $drafts = app(InvoiceDrafts::class);
            $draftLines = $drafts->validated($this->clinicId, $id, (string) $invoiceRow->patient_id, DraftLines::fromStored($storedRows), DraftPolicy::trusted(), false);

            $requests = [];
            foreach ($draftLines as $line) {
                if ($line->stocked && $line->catalogItemId !== null) {
                    $requests[] = new ReservationRequest($line->id, $line->catalogItemId, $line->quantity, $line->requiresExpiry);
                }
            }
            if ($requests !== []) {
                $localDate = Instant::fromEpochMilliseconds((int) $pieceAt->format('Uv'))->civilDate($timezone);
                app(ReservationService::class)->reserveCentral($this->clinicId, $locks, $localDate, $requests, $now);
            }

            $usageId = Ulid::generate();
            $documentId = Ulid::generate();
            NumberUsages::record($context, $usageId, BillingNumbers::INVOICE, $number, 'invoices', $id, $now);

            $ruleIds = array_values(array_filter(array_map(static fn (DraftLine $line): ?string => $line->taxRuleId, $draftLines)));
            $usedRules = TaxRegime::applicable($this->clinicId, $ruleIds);
            $nowDb = $now->format('Y-m-d H:i:s.u');
            $issuedDb = $pieceAt->format('Y-m-d H:i:s.u');

            DB::table('invoices')->where('clinic_id', $this->clinicId)->where('id', $id)->update([
                'number' => $number['rendered'],
                'issued_at' => $issuedDb,
                'issued_by' => $actor->id,
                'number_usage_id' => $usageId,
                'status' => 'ISSUED',
                'total_gross' => $total,
                'patient_snapshot' => json_encode(InvoiceSnapshots::patient($patient), JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE),
                'clinic_snapshot' => json_encode(InvoiceSnapshots::clinic($clinic), JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE),
                'tax_snapshot' => json_encode(InvoiceSnapshots::tax($usedRules), JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE),
                'updated_at' => $nowDb,
            ]);
            PendingDocuments::forInvoice($context, $documentId, $id, $now);

            return [$id, $total, $number['rendered']];
        });
    }

    /**
     * @param  array<string, mixed>  $overrides
     */
    protected function pay(string $invoiceId, int $ledgerVersion, int $amount, string $method = 'MTN_MOMO', array $overrides = [], ?User $as = null, ?string $key = null): TestResponse
    {
        return $this->write('POST', '/api/v1/invoices/'.$invoiceId.'/payments', $this->paymentBody($invoiceId, $ledgerVersion, $amount, $method, $overrides), $as, $key);
    }

    protected function ledgerVersion(string $invoiceId): int
    {
        return (int) $this->read('/api/v1/invoices/'.$invoiceId, $this->manager)->json('data.ledger_version');
    }

    /**
     * Session de caisse ouverte par l'API pour un compte : identifiant.
     */
    protected function openedSession(?User $as = null, int $opening = 25000): string
    {
        $body = $this->openSessionBody($opening);
        $this->write('POST', '/api/v1/cash-sessions', $body, $as)->assertCreated();

        return (string) $body['cash_session_id'];
    }

    // ------------------------------------------------------------------------------------------------------------
    // Mesures
    // ------------------------------------------------------------------------------------------------------------

    /**
     * Effets durables des commandes financières, pour prouver qu'un retour arrière n'en laisse aucun.
     *
     * @return array<string, int|string>
     */
    protected function billingEffects(): array
    {
        $clinic = $this->clinicId;

        return [
            'invoices' => DB::table('invoices')->where('clinic_id', $clinic)->count(),
            'issued' => DB::table('invoices')->where('clinic_id', $clinic)->where('status', 'ISSUED')->count(),
            'lines' => DB::table('invoice_lines')->where('clinic_id', $clinic)->count(),
            'payments' => DB::table('payments')->where('clinic_id', $clinic)->count(),
            'receipts' => DB::table('receipts')->where('clinic_id', $clinic)->count(),
            'documents' => DB::table('generated_documents')->where('clinic_id', $clinic)->count(),
            'usages' => DB::table('document_number_usages')->where('clinic_id', $clinic)->count(),
            'sequences' => json_encode(DB::table('document_sequences')->where('clinic_id', $clinic)->orderBy('document_type')->orderBy('document_year')->get(['document_type', 'document_year', 'last_value', 'version'])->all(), JSON_THROW_ON_ERROR),
            'reservations' => DB::table('stock_reservations')->where('clinic_id', $clinic)->count(),
            'reserved' => (string) DB::table('stock_positions')->where('clinic_id', $clinic)->sum('reserved'),
            'sessions' => DB::table('cash_sessions')->where('clinic_id', $clinic)->count(),
            'audit' => DB::table('audit_events')->where('clinic_id', $clinic)->count(),
            'outbox' => DB::table('outbox_events')->where('clinic_id', $clinic)->count(),
            'changes' => DB::table('sync_change_log')->where('clinic_id', $clinic)->count(),
            'idempotency' => DB::table('idempotency_requests')->where('clinic_id', $clinic)->count(),
        ];
    }

    /**
     * Tout ce que le chemin central a écrit ailleurs que dans les tables de la facturation, sérialisé : c'est là qu'aucun
     * coût d'achat ni donnée sensible ne doit figurer.
     */
    protected function sideEffectsDump(): string
    {
        $dump = '';
        foreach (['audit_events', 'outbox_events', 'sync_change_log', 'idempotency_requests'] as $table) {
            $dump .= $table.json_encode(DB::table($table)->where('clinic_id', $this->clinicId)->get(), JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        }

        return $dump;
    }
}
