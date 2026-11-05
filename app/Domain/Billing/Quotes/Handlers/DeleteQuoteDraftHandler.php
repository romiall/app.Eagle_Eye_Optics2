<?php

namespace App\Domain\Billing\Quotes\Handlers;

use App\Application\Command;
use App\Application\CommandHandler;
use App\Application\CommandOutcome;
use App\Application\Effects\AuditEntry;
use App\Application\Effects\ChangeKind;
use App\Application\Effects\ChangeRecord;
use App\Application\Effects\ChangeVisibility;
use App\Application\Locking\TransactionLocks;
use App\Domain\Billing\BillingErrors;
use App\Domain\Billing\Guards\ActorRights;
use App\Domain\Billing\Guards\CentralOnly;
use App\Domain\Billing\Quotes;
use App\Domain\Shared\BusinessError;
use App\Domain\Shared\CommandContext;
use Illuminate\Support\Facades\DB;

/**
 * Suppression d'un brouillon de devis JAMAIS ÉMIS (chantier « CRUD des écrans », tranche 3a ; route
 * `POST /quotes/{id}/delete`). Le statut d'un devis n'a pas de valeur « abandonné » et un devis ne retourne jamais à
 * l'état de brouillon (une révision n'existe que pour un devis émis) : un brouillon n'a donc ni numéro, ni révision, ni
 * document, ni facture. Un devis émis, accepté, refusé, expiré ou converti ne se supprime pas : il se révise
 * (`ReviseQuote`), reçoit la réponse du client ou se convertit ; ses révisions figées sont immuables (déclencheurs de
 * la base).
 *
 * Même droit que la modification d'un brouillon (`UpdateQuoteDraft`) : son créateur, ou la gérante (`approval.decide`),
 * avec `invoice.create`. Version attendue : 409 `VERSION_CONFLICT` si le brouillon a changé. Par précaution, une
 * révision, un document ou une facture qui désignerait le devis refuse aussi la suppression (409).
 *
 * Les lignes du brouillon disparaissent avec lui. Audit `quote.draft_deleted` (version, nombre de lignes, total : ni
 * prix de ligne ni identité du destinataire) ; journal des changements : pierre tombale `ARCHIVED`. Aucune réserve de
 * stock, aucune créance, aucun numéro de série à rendre : un brouillon n'en a pas.
 *
 * Commande EN LIGNE. Verrous : cabinet, idempotence, devis (55).
 */
final class DeleteQuoteDraftHandler implements CommandHandler
{
    public const COMMAND = 'DeleteQuoteDraft';

    /** Tables qui peuvent désigner un devis : si l'une le désigne, il reste. */
    private const QUOTE_USERS = ['quote_revisions', 'generated_documents', 'invoices'];

    public function __construct(private readonly ActorRights $rights) {}

    public function permissions(): array
    {
        return ['invoice.create'];
    }

    public function handle(Command $command, CommandContext $context, TransactionLocks $locks, ?string $idempotencyId): CommandOutcome
    {
        CentralOnly::assert($context, 'La suppression d\'un brouillon de devis');

        $quoteId = (string) $command->payload['quote_id'];
        $quote = $locks->quote($quoteId);
        if ($quote === null) {
            throw BusinessError::notFound('Devis introuvable dans ce cabinet (déjà supprimé ?).');
        }
        Quotes::assertStatus($quote, ['DRAFT'], 'Ce devis est émis : il ne se supprime pas. Il se révise avec un motif, ou reçoit la réponse du client.');
        if ($command->expectedVersion === null || (int) $quote->version !== $command->expectedVersion) {
            throw BillingErrors::versionConflict((int) $quote->version);
        }
        if ((string) $quote->created_by !== (string) $context->actorId && ! $this->rights->manager($context)) {
            throw BusinessError::forbidden('Ce brouillon de devis appartient à un autre compte : seule la gérante le supprime.');
        }
        if ($quote->number !== null || $quote->issued_at !== null) {
            throw BusinessError::stateRefused('Ce devis a déjà été émis : il ne se supprime pas.', (string) $quote->status);
        }
        foreach (self::QUOTE_USERS as $table) {
            if (DB::table($table)->where('clinic_id', $context->clinicId)->where('quote_id', $quoteId)->exists()) {
                throw BusinessError::stateRefused('Une révision, un document ou une facture désigne ce devis : il ne se supprime pas.', (string) $quote->status);
            }
        }

        $lines = DB::table('quote_lines')->where('clinic_id', $context->clinicId)->where('quote_id', $quoteId)->count();
        // Les lignes avant le devis (aucune cascade en base).
        DB::table('quote_lines')->where('clinic_id', $context->clinicId)->where('quote_id', $quoteId)->delete();
        DB::table('quotes')->where('clinic_id', $context->clinicId)->where('id', $quoteId)->delete();

        return new CommandOutcome(
            result: ['quote_id' => $quoteId, 'lines' => $lines],
            resultType: 'quotes',
            resultId: $quoteId,
            audit: [new AuditEntry('quote.draft_deleted', 'quotes', $quoteId, null, [
                'version' => (int) $quote->version,
                'lines' => $lines,
                'total_gross' => (int) $quote->total_gross,
            ])],
            changes: [new ChangeRecord('quotes', $quoteId, (int) $quote->version + 1, ChangeVisibility::Financial, ChangeKind::Archived)],
        );
    }
}
