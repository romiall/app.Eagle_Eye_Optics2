<?php

namespace Tests\Feature\Billing;

use App\Domain\Access\Approvals\ApprovalSubject;
use App\Domain\Shared\Ulid;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Tests\Support\ApprovalFixtures;
use Tests\Support\BillingFixtures;
use Tests\Support\MigratedDatabase;
use Tests\TestCase;

/**
 * Contre-écriture d'un paiement enregistré à tort (B07, AT13, EE024, EE045) sur MySQL réel : jamais de suppression ni de
 * modification du paiement, de son reçu ou de la facture ; une pièce liée, motivée, plafonnée au paiement, avec
 * approbation exacte de la gérante (ou exécution directe par elle) ; solde et `ledger_version` recalculés. Données
 * fictives.
 */
final class ReversePaymentTest extends TestCase
{
    use ApprovalFixtures;
    use BillingFixtures;
    use MigratedDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->bootBilling(['sales', 'stock', 'settings']);
    }

    protected function tearDown(): void
    {
        $this->resetClock();
        parent::tearDown();
    }

    /**
     * Facture de 50 000 et un paiement (30 000 par défaut) : [facture, paiement, numéro du reçu].
     *
     * @return array{0: string, 1: string, 2: string}
     */
    private function paid(int $amount = 30000): array
    {
        [$invoice] = $this->issuedUncollectedInvoice([$this->line($this->item['lens'], '1', 1, 50000)], $this->manager);
        $receipt = (string) $this->pay($invoice, 1, $amount)->assertCreated()->json('data.receipt_number');

        return [$invoice, $this->firstPayment($invoice), $receipt];
    }

    /**
     * @param  array<string, mixed>  $overrides
     */
    private function reverse(string $invoice, string $payment, int $version, int $amount, array $overrides = [], ?User $as = null, ?string $key = null): TestResponse
    {
        return $this->writeReauthenticated('POST', '/api/v1/payments/'.$payment.'/reversals', $this->reversalBody($invoice, $payment, $version, $amount, $overrides), $as ?? $this->manager, $key);
    }

    public function test_la_gerante_contre_passe_directement_et_tout_l_original_reste_intact(): void
    {
        [$invoice, $payment, $receipt] = $this->paid();
        $paymentBefore = DB::table('payments')->where('id', $payment)->first();
        $receiptBefore = DB::table('receipts')->where('payment_id', $payment)->first();
        $invoiceBefore = DB::table('invoices')->where('id', $invoice)->first();

        $response = $this->reverse($invoice, $payment, 2, 30000);

        $response->assertCreated()
            ->assertJsonPath('data.payment_id', $payment)
            ->assertJsonPath('data.amount', 30000)
            ->assertJsonPath('data.ledger_version', 3)
            ->assertJsonPath('data.balance.paid_net', 0)
            ->assertJsonPath('data.balance.balance_due', 50000)
            ->assertJsonPath('data.balance.settlement', 'UNPAID');
        $this->assertMatchesContract($response, 'schemas/resources/billing.json#/$defs/ReversalResultResponse');
        $this->assertEquals($paymentBefore, DB::table('payments')->where('id', $payment)->first());
        $this->assertEquals($receiptBefore, DB::table('receipts')->where('payment_id', $payment)->first());
        $this->assertEquals($invoiceBefore, DB::table('invoices')->where('id', $invoice)->first());
        $this->assertSame($receipt, DB::table('receipts')->where('payment_id', $payment)->value('number'), 'Le reçu d\'origine n\'est jamais renuméroté.');

        $reversal = DB::table('payment_reversals')->where('payment_id', $payment)->first();
        $this->assertNotNull($reversal);
        $approval = DB::table('approvals')->where('id', $reversal->approval_id)->first();
        $this->assertNotNull($approval);
        $this->assertSame(['CONSUMED', $this->manager->id, $this->manager->id, 'payment.reverse', 'payments', $payment],
            [$approval->status, $approval->requested_by, $approval->decided_by, $approval->action_code, $approval->target_type, $approval->target_id]);
        $this->assertSame(ApprovalSubject::paymentReversal($invoice, $payment, 30000)->hash(), $approval->payload_hash);
        $audit = DB::table('audit_events')->where('action', 'payment.reversed')->where('target_id', $payment)->first();
        $this->assertNotNull($audit);
        $this->assertSame('Paiement saisi deux fois par erreur (fictif)', $audit->reason);
        $this->assertSame('DIRECT', json_decode((string) $audit->sanitized_diff, true)['approval_mode']);

        $this->read('/api/v1/invoices/'.$invoice, $this->manager)->assertOk()
            ->assertJsonPath('data.payments.0.reversed_amount', 30000)
            ->assertJsonPath('data.ledger_version', 3);
    }

    public function test_aucune_route_ne_supprime_ni_ne_modifie_un_paiement(): void
    {
        [, $payment] = $this->paid();

        foreach (['DELETE', 'PATCH', 'PUT'] as $method) {
            $this->actingAsReauthenticated($this->manager)->json($method, '/api/v1/payments/'.$payment)->assertStatus(404);
        }
        $this->assertSame(1, DB::table('payments')->where('id', $payment)->count());
    }

    public function test_la_caisse_sans_permission_ne_contre_passe_pas_et_avec_elle_il_faut_l_approbation_exacte(): void
    {
        [$invoice, $payment] = $this->paid();
        $this->reverse($invoice, $payment, 2, 30000, [], $this->cashier)->assertForbidden();

        $this->allowPermission($this->cashier, 'payment.reverse');
        $this->reverse($invoice, $payment, 2, 30000, [], $this->cashier)
            ->assertStatus(422)->assertJsonPath('error.code', 'APPROVAL_REQUIRED_OR_EXPIRED');

        // Approbation exacte de 30 000 : un autre montant est refusé, le bon est accepté et brûle l'approbation.
        $approval = $this->approved(ApprovalSubject::paymentReversal($invoice, $payment, 30000)->toArray(), $this->cashier);
        $this->reverse($invoice, $payment, 2, 20000, ['approval_id' => $approval], $this->cashier)
            ->assertStatus(422)->assertJsonPath('error.code', 'APPROVAL_REQUIRED_OR_EXPIRED');
        $this->assertSame('APPROVED', DB::table('approvals')->where('id', $approval)->value('status'), 'Un refus ne consomme pas l\'approbation.');

        $this->reverse($invoice, $payment, 2, 30000, ['approval_id' => $approval], $this->cashier)->assertCreated();
        $this->assertSame('CONSUMED', DB::table('approvals')->where('id', $approval)->value('status'));
        $this->reverse($invoice, $payment, 3, 30000, ['approval_id' => $approval], $this->cashier)->assertStatus(422);
    }

    public function test_le_cumul_des_contre_ecritures_ne_depasse_jamais_le_paiement(): void
    {
        [$invoice, $payment] = $this->paid();
        $this->reverse($invoice, $payment, 2, 20000)->assertCreated();

        $this->reverse($invoice, $payment, 3, 10001)->assertStatus(422)->assertJsonPath('error.details.reversible', 10000);
        $this->reverse($invoice, $payment, 3, 10000)->assertCreated()->assertJsonPath('data.balance.paid_net', 0);
        $this->assertSame(30000, (int) DB::table('payment_reversals')->where('payment_id', $payment)->sum('amount'));
    }

    public function test_version_perimee_motif_absent_et_paiement_d_une_autre_facture_sont_refuses_sans_effet(): void
    {
        [$invoice, $payment] = $this->paid();
        [$other] = $this->issuedInvoice([$this->line($this->item['lens'], '1', 1, 20000)], $this->manager);
        $effects = $this->billingEffects();

        $this->reverse($invoice, $payment, 1, 30000)->assertStatus(409)->assertJsonPath('error.code', 'VERSION_CONFLICT')->assertJsonPath('error.details.current_version', 2);
        $this->reverse($invoice, $payment, 2, 30000, ['reason' => 'ab'])->assertStatus(422);
        $this->reverse($other, $payment, 1, 30000)->assertStatus(422)->assertJsonStructure(['error' => ['fields' => ['payment_id']]]);
        $this->writeReauthenticated('POST', '/api/v1/payments/'.Ulid::generate().'/reversals', $this->reversalBody($invoice, $payment, 2, 30000), $this->manager)->assertStatus(422);

        $this->assertSame($effects, $this->billingEffects());
        $this->assertSame(0, DB::table('payment_reversals')->count());
    }

    public function test_sans_reauthentification_recente_rien_n_est_ecrit(): void
    {
        [$invoice, $payment] = $this->paid();

        $this->write('POST', '/api/v1/payments/'.$payment.'/reversals', $this->reversalBody($invoice, $payment, 2, 30000), $this->manager)
            ->assertStatus(423)->assertJsonPath('error.code', 'REAUTHENTICATION_REQUIRED');
        $this->assertSame(0, DB::table('payment_reversals')->count());
    }

    public function test_un_rejeu_de_la_meme_cle_rend_la_meme_contre_ecriture(): void
    {
        [$invoice, $payment] = $this->paid();
        $body = $this->reversalBody($invoice, $payment, 2, 30000);
        $key = Ulid::generate();

        $first = $this->writeReauthenticated('POST', '/api/v1/payments/'.$payment.'/reversals', $body, $this->manager, $key)->assertCreated();
        $second = $this->writeReauthenticated('POST', '/api/v1/payments/'.$payment.'/reversals', $body, $this->manager, $key)->assertCreated();

        $this->assertSame($first->json('data.reversal_id'), $second->json('data.reversal_id'));
        $this->assertSame(1, DB::table('payment_reversals')->count());
    }

    public function test_une_contre_ecriture_especes_d_une_session_close_ne_la_reecrit_pas(): void
    {
        [$invoice] = $this->issuedUncollectedInvoice([$this->line($this->item['lens'], '1', 1, 50000)], $this->manager);
        $session = $this->openedSession($this->cashier, 10000);
        $this->pay($invoice, 1, 30000, 'CASH', ['cash_session_id' => $session])->assertCreated();
        $this->write('POST', '/api/v1/cash-sessions/'.$session.'/close', $this->closeSessionBody($session, 40000, 40000, null, ['closed_at' => self::NOW]), $this->cashier)->assertOk();
        $closed = DB::table('cash_sessions')->where('id', $session)->first();

        $this->reverse($invoice, $this->firstPayment($invoice), 2, 30000)->assertCreated();

        $this->assertEquals($closed, DB::table('cash_sessions')->where('id', $session)->first(), 'La photographie de clôture reste figée.');
        $audit = DB::table('audit_events')->where('action', 'payment.reversed')->value('sanitized_diff');
        $this->assertTrue(json_decode((string) $audit, true)['cash_session_closed']);
    }

    public function test_une_contre_ecriture_qui_laisserait_un_remboursement_sans_encaissement_est_refusee(): void
    {
        [$invoice, $payment] = $this->paid(50000);
        $credit = $this->writeReauthenticated('POST', '/api/v1/invoices/'.$invoice.'/credit-notes', $this->creditNoteBody($invoice, 2, [$this->creditLine($this->firstLine($invoice), 10000)]), $this->manager)->assertCreated();
        $this->writeReauthenticated('POST', '/api/v1/invoices/'.$invoice.'/refunds', $this->refundBody($invoice, (string) $credit->json('data.credit_note_id'), 3, 10000), $this->manager)->assertCreated();

        $this->reverse($invoice, $payment, 4, 45000)->assertStatus(422);
        $this->reverse($invoice, $payment, 4, 40000)->assertCreated()->assertJsonPath('data.balance.paid_net', 10000);
    }
}
