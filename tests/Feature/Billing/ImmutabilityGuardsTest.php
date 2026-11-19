<?php

namespace Tests\Feature\Billing;

use App\Domain\Shared\Ulid;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Tests\Support\BillingFixtures;
use Tests\Support\MigratedDatabase;
use Tests\TestCase;

/**
 * Garde-fous du schéma sur les pièces financières (EE023, EE045, AT09) : même un accès direct à la base ne modifie ni
 * ne supprime un paiement confirmé ou un reçu, n'encaisse ni brouillon ni session close, et ne crée pas de reçu sans
 * paiement confirmé. La facture émise et ses lignes sont couvertes par `IssueInvoiceTest`. Données fictives.
 */
final class ImmutabilityGuardsTest extends TestCase
{
    use BillingFixtures;
    use MigratedDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->bootBilling();
    }

    protected function tearDown(): void
    {
        $this->resetClock();
        parent::tearDown();
    }

    /**
     * @param  callable(): mixed  $attempt
     */
    private function assertRefused(callable $attempt, string $message, string $label): void
    {
        try {
            DB::transaction($attempt);
            $this->fail('Le schéma devait refuser : '.$label.'.');
        } catch (QueryException $exception) {
            $this->assertStringContainsString($message, $exception->getMessage(), $label);
        }
    }

    /**
     * Ligne de l'idempotence qu'exige tout paiement (fixture directe, sans passer par la commande).
     */
    private function seedIdempotency(): string
    {
        $id = Ulid::generate();
        DB::table('idempotency_requests')->insert([
            'id' => $id, 'clinic_id' => $this->clinicId, 'namespace' => 'test', 'command_name' => 'RegisterPayment',
            'request_key' => 'CLE-'.substr($id, -10), 'payload_hash' => str_repeat('c', 64), 'status' => 'COMMITTED',
        ]);

        return $id;
    }

    /**
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    private function paymentRow(string $invoiceId, array $overrides = []): array
    {
        return $overrides + [
            'id' => Ulid::generate(), 'clinic_id' => $this->clinicId, 'invoice_id' => $invoiceId, 'amount' => 1000, 'method' => 'MTN_MOMO', 'reference' => 'REF',
            'effective_at' => '2026-10-22 09:30:00.000000', 'status' => 'CONFIRMED', 'confirmed_at' => '2026-10-22 09:30:00.000000', 'cash_session_id' => null,
            'received_by' => $this->cashier->id, 'idempotency_id' => $this->seedIdempotency(),
        ];
    }

    public function test_un_paiement_confirme_et_son_recu_ne_se_modifient_ni_ne_se_suppriment(): void
    {
        [$invoice] = $this->issuedUncollectedInvoice();
        $payment = $this->pay($invoice, 1, 15000)->assertCreated();
        $paymentId = $payment->json('data.payment_id');
        $receiptId = $payment->json('data.receipt_id');

        $this->assertRefused(fn () => DB::table('payments')->where('id', $paymentId)->update(['amount' => 1]), 'Finalized record is immutable', 'modifier un paiement confirmé');
        $this->assertRefused(fn () => DB::table('payments')->where('id', $paymentId)->update(['status' => 'REJECTED']), 'Finalized record is immutable', 'rejeter un paiement confirmé');
        $this->assertRefused(fn () => DB::table('payments')->where('id', $paymentId)->delete(), 'Finalized record is immutable', 'supprimer un paiement confirmé');
        $this->assertRefused(fn () => DB::table('receipts')->where('id', $receiptId)->update(['number' => 'AUTRE']), 'Append-only history', 'renuméroter un reçu');
        $this->assertRefused(fn () => DB::table('receipts')->where('id', $receiptId)->delete(), 'Append-only history', 'supprimer un reçu');

        $this->assertSame(['CONFIRMED', 15000, 'TEST-REC-2026-000001'], [
            DB::table('payments')->where('id', $paymentId)->value('status'),
            (int) DB::table('payments')->where('id', $paymentId)->value('amount'),
            DB::table('receipts')->where('id', $receiptId)->value('number'),
        ]);
    }

    public function test_un_paiement_exige_une_facture_emise(): void
    {
        [$draft] = $this->draft();

        $this->assertRefused(fn () => DB::table('payments')->insert($this->paymentRow($draft)), 'Payment requires an issued invoice', 'encaisser un brouillon');
        $this->assertSame(0, DB::table('payments')->count());
    }

    public function test_un_recu_exige_un_paiement_confirme(): void
    {
        [$invoice] = $this->issuedUncollectedInvoice();
        $pending = $this->paymentRow($invoice, ['status' => 'PENDING', 'confirmed_at' => null]);
        DB::table('payments')->insert($pending);
        $usage = Ulid::generate();

        $this->assertRefused(function () use ($pending, $invoice, $usage): void {
            DB::table('document_number_usages')->insert([
                'id' => $usage, 'clinic_id' => $this->clinicId, 'document_type' => 'RECEIPT', 'document_year' => 2026, 'number_value' => 99,
                'rendered_number' => 'TEST-REC-2026-000099', 'status' => 'USED', 'entity_type' => 'receipts', 'entity_id' => Ulid::generate(),
                'actor_id' => $this->cashier->id, 'consumed_at' => '2026-10-22 09:30:00.000000',
            ]);
            DB::table('receipts')->insert([
                'id' => Ulid::generate(), 'clinic_id' => $this->clinicId, 'payment_id' => $pending['id'], 'invoice_id' => $invoice, 'number' => 'TEST-REC-2026-000099',
                'number_usage_id' => $usage, 'issued_at' => '2026-10-22 09:30:00.000000', 'issued_by' => $this->cashier->id, 'snapshot' => '{}',
            ]);
        }, 'Receipt requires a confirmed payment', 'créer un reçu pour un paiement non confirmé');
        $this->assertSame(0, DB::table('receipts')->count());
    }

    public function test_un_encaissement_especes_dans_une_session_close_est_refuse_par_le_schema(): void
    {
        [$invoice] = $this->issuedUncollectedInvoice();
        $session = $this->openedSession($this->cashier, 25000);
        $this->write('POST', '/api/v1/cash-sessions/'.$session.'/close', $this->closeSessionBody($session, 25000, 25000), $this->cashier)->assertOk();

        $this->assertRefused(
            fn () => DB::table('payments')->insert($this->paymentRow($invoice, ['method' => 'CASH', 'cash_session_id' => $session, 'reference' => null])),
            'New cash operation requires an open session',
            'encaisser des espèces dans une session close',
        );
        $this->assertSame(0, DB::table('payments')->count());
    }

    public function test_un_paiement_en_especes_sans_session_est_refuse_par_le_schema(): void
    {
        [$invoice] = $this->issuedUncollectedInvoice();

        $this->assertRefused(
            fn () => DB::table('payments')->insert($this->paymentRow($invoice, ['method' => 'CASH', 'cash_session_id' => null, 'reference' => null])),
            'ck_payments_03',
            'des espèces sans session de caisse',
        );
    }

    public function test_le_document_pret_est_fige_mais_le_document_en_attente_reste_completable(): void
    {
        [$invoice] = $this->issuedInvoice();
        $documentId = (string) DB::table('generated_documents')->where('invoice_id', $invoice)->value('id');

        // En attente : le moteur de documents peut le compléter (D01), c'est la seule mutation admise.
        $this->assertSame(1, DB::table('generated_documents')->where('id', $documentId)->update(['failure_code' => 'RETRY_LATER']));
        $this->assertSame('PENDING', DB::table('generated_documents')->where('id', $documentId)->value('status'));
    }
}
