<?php

namespace Tests\Feature\Billing;

use App\Application\Checkpoint;
use App\Application\Command;
use App\Application\CommandBusProbe;
use App\Application\Locking\TransactionLocks;
use App\Domain\Billing\Handlers\RegisterPaymentHandler;
use App\Domain\Shared\BusinessError;
use App\Domain\Shared\CommandContext;
use App\Domain\Shared\Ulid;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\DataProvider;
use RuntimeException;
use Tests\Support\BillingFixtures;
use Tests\Support\Commands\RecordingProbe;
use Tests\Support\MigratedDatabase;
use Tests\Support\RefusedSources;
use Tests\TestCase;

/**
 * Acompte et solde (B04, EE022, EE023, EE030, EE045, AT10, AT11, AT12, AT37) sur MySQL réel : un reçu unique par
 * encaissement, jamais de sur-encaissement, facture émise jamais modifiée, solde et `ledger_version` recalculés,
 * espèces rattachées à une session ouverte de l'auteur, motif des dates antérieures, idempotence, retour arrière à
 * chaque point. Données fictives ; un encaissement est un fait constaté par un opérateur, sans opérateur télécom.
 */
final class RegisterPaymentTest extends TestCase
{
    use BillingFixtures;
    use MigratedDatabase;
    use RefusedSources;

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
     * Facture émise d'un montant libre (la gérante seule peut fixer un prix hors catalogue) : identifiant.
     */
    private function invoiceOf(int $amount = 80000): string
    {
        [$id] = $this->issuedUncollectedInvoice([$this->line($this->item['lens'], '1', 1, $amount)], $this->manager);

        return $id;
    }

    // ------------------------------------------------------------------------------------------------------------
    // Acompte puis solde
    // ------------------------------------------------------------------------------------------------------------

    public function test_un_acompte_puis_le_solde_donnent_deux_recus_numerotes_et_laissent_la_facture_intacte(): void
    {
        $id = $this->invoiceOf(80000);
        $invoiceBefore = DB::table('invoices')->where('id', $id)->first();
        $this->assertSame(1, $this->ledgerVersion($id), 'Avant tout encaissement, la version financière vaut 1.');

        $deposit = $this->pay($id, 1, 30000, 'MTN_MOMO');
        $balance = $this->pay($id, 2, 50000, 'ORANGE_MONEY');

        $deposit->assertCreated()
            ->assertJsonPath('data.invoice_id', $id)
            ->assertJsonPath('data.amount', 30000)
            ->assertJsonPath('data.currency', 'XAF')
            ->assertJsonPath('data.method', 'MTN_MOMO')
            ->assertJsonPath('data.receipt_number', 'TEST-REC-2026-000001')
            ->assertJsonPath('data.effective_at', self::NOW)
            ->assertJsonPath('data.recorded_at', self::NOW)
            ->assertJsonPath('data.ledger_version', 2)
            ->assertJsonPath('data.balance.total_gross', 80000)
            ->assertJsonPath('data.balance.paid_net', 30000)
            ->assertJsonPath('data.balance.balance_due', 50000)
            ->assertJsonPath('data.balance.settlement', 'PARTIALLY_PAID')
            ->assertJsonPath('data.receipt_document.document_status', 'PENDING');
        $this->assertMatchesContract($deposit, 'schemas/resources/billing.json#/$defs/PaymentResultResponse');
        $balance->assertCreated()
            ->assertJsonPath('data.receipt_number', 'TEST-REC-2026-000002')
            ->assertJsonPath('data.ledger_version', 3)
            ->assertJsonPath('data.balance.paid_net', 80000)
            ->assertJsonPath('data.balance.balance_due', 0)
            ->assertJsonPath('data.balance.settlement', 'SETTLED');
        $this->assertMatchesContract($balance, 'schemas/resources/billing.json#/$defs/PaymentResultResponse');
        $this->assertNotSame($deposit->json('data.receipt_id'), $balance->json('data.receipt_id'));
        $this->assertNotSame($deposit->json('data.payment_id'), $balance->json('data.payment_id'));

        // La facture émise n'a pas bougé : ni solde, ni version, ni date de mise à jour.
        $this->assertEquals($invoiceBefore, DB::table('invoices')->where('id', $id)->first());

        $this->assertSame(2, DB::table('payments')->where('invoice_id', $id)->where('status', 'CONFIRMED')->count());
        $this->assertSame(80000, (int) DB::table('payments')->where('invoice_id', $id)->sum('amount'));
        $receipts = DB::table('receipts')->where('invoice_id', $id)->orderBy('number')->get();
        $this->assertCount(2, $receipts);
        $snapshots = $receipts->map(static fn (object $row): array => json_decode((string) $row->snapshot, true, 512, JSON_THROW_ON_ERROR))->all();
        $this->assertSame(['DEPOSIT', 'BALANCE_SETTLEMENT'], array_column($snapshots, 'kind'));
        $this->assertSame([0, 30000], array_column($snapshots, 'paid_net_before'));
        $this->assertSame([30000, 80000], array_column($snapshots, 'paid_net_after'));
        $this->assertSame([50000, 0], array_column($snapshots, 'balance_after'));
        $this->assertSame(['TEST-REC-2026-000001', 'TEST-REC-2026-000002'], $receipts->pluck('number')->all());
        foreach ($receipts as $receipt) {
            $this->assertDataMatchesContract(json_decode((string) $receipt->snapshot, false, 512, JSON_THROW_ON_ERROR), 'snapshots/receipt.json');
        }

        $invoice = $this->read('/api/v1/invoices/'.$id, $this->manager)->assertOk();
        $invoice->assertJsonPath('data.status', 'ISSUED')
            ->assertJsonPath('data.draft_version', 1)
            ->assertJsonPath('data.ledger_version', 3)
            ->assertJsonPath('data.balance.settlement', 'SETTLED')
            ->assertJsonCount(2, 'data.payments');
        $numbers = array_column($invoice->json('data.payments'), 'receipt_number');
        sort($numbers);
        $this->assertSame(['TEST-REC-2026-000001', 'TEST-REC-2026-000002'], $numbers);
        $this->assertMatchesContract($invoice, 'schemas/resources/billing.json#/$defs/InvoiceResponse');
    }

    public function test_l_encaissement_ecrit_audit_evenement_et_changements_avec_la_version_de_publication(): void
    {
        $id = $this->invoiceOf(80000);

        $response = $this->pay($id, 1, 30000)->assertCreated();

        $event = DB::table('outbox_events')->where('clinic_id', $this->clinicId)->where('event_type', 'PaymentConfirmed')->first();
        $this->assertNotNull($event);
        $this->assertSame(['invoices', $id, 3, 'PENDING'], [$event->source_type, $event->source_id, (int) $event->source_version, $event->status]);
        $payload = json_decode((string) $event->payload, true);
        $this->assertSame([30000, 'MTN_MOMO', 'TEST-REC-2026-000001', $response->json('data.payment_id')], [$payload['amount'], $payload['method'], $payload['receipt_number'], $payload['payment_id']]);

        $audit = DB::table('audit_events')->where('action', 'payment.confirmed')->first();
        $this->assertNotNull($audit);
        $this->assertSame([$this->cashier->id, $response->json('data.payment_id'), null], [$audit->actor_id, $audit->target_id, $audit->reason]);
        $diff = json_decode((string) $audit->sanitized_diff, true);
        $this->assertSame([1, 2, 50000, 'DEPOSIT'], [$diff['ledger_version_before'], $diff['ledger_version_after'], $diff['balance_after'], $diff['receipt_kind']]);

        $changes = DB::table('sync_change_log')->where('clinic_id', $this->clinicId)->orderBy('change_sequence')->get(['entity_type', 'entity_id', 'entity_version', 'visibility', 'change_kind'])->all();
        $payment = array_values(array_filter($changes, static fn (object $row): bool => $row->entity_type === 'payments'));
        $receipt = array_values(array_filter($changes, static fn (object $row): bool => $row->entity_type === 'receipts'));
        $invoice = array_values(array_filter($changes, static fn (object $row): bool => $row->entity_type === 'invoices'));
        $this->assertCount(1, $payment);
        $this->assertCount(1, $receipt);
        $this->assertSame(['FINANCIAL', 'CREATED'], [$payment[0]->visibility, $payment[0]->change_kind]);
        $this->assertSame(['FINANCIAL', 'CREATED'], [$receipt[0]->visibility, $receipt[0]->change_kind]);
        $this->assertSame(3, (int) end($invoice)->entity_version, 'Brouillon 1 + ledger_version 2 : la publication ne recule jamais.');
        $this->assertStringNotContainsString('purchase_cost', $this->sideEffectsDump());
    }

    public function test_la_lecture_du_recu_est_conforme_au_contrat_et_son_document_attend_le_moteur(): void
    {
        $id = $this->invoiceOf(80000);
        $payment = $this->pay($id, 1, 30000)->assertCreated();

        $receipt = $this->read('/api/v1/receipts/'.$payment->json('data.receipt_id'), $this->cashier)->assertOk();

        $receipt->assertJsonPath('data.number', 'TEST-REC-2026-000001')
            ->assertJsonPath('data.payment_id', $payment->json('data.payment_id'))
            ->assertJsonPath('data.invoice_id', $id)
            ->assertJsonPath('data.issued_by', $this->cashier->id)
            ->assertJsonPath('data.snapshot.kind', 'DEPOSIT')
            ->assertJsonPath('data.snapshot.payment.amount', 30000)
            ->assertJsonPath('data.snapshot.patient.last_name', 'Patient Fictif')
            ->assertJsonPath('data.snapshot.clinic.test_document', true)
            ->assertJsonPath('data.document.document_id', $payment->json('data.receipt_document.document_id'))
            ->assertJsonPath('data.document.document_status', 'PENDING');
        $this->assertMatchesContract($receipt, 'schemas/resources/billing.json#/$defs/ReceiptResponse');

        $document = DB::table('generated_documents')->where('id', $payment->json('data.receipt_document.document_id'))->first();
        $this->assertNotNull($document);
        $this->assertSame(['RECEIPT', $payment->json('data.receipt_id'), 'PENDING', 1, null], [$document->document_type, $document->receipt_id, $document->status, (int) $document->revision_no, $document->file_id]);
    }

    // ------------------------------------------------------------------------------------------------------------
    // Montant, version, état
    // ------------------------------------------------------------------------------------------------------------

    public function test_un_montant_au_dela_du_reste_du_est_refuse_avec_le_reste_a_proposer(): void
    {
        // AT12 : deux caissières voient 50 000 dû ; la première encaisse 40 000, la seconde 40 000 à son tour.
        $id = $this->invoiceOf(50000);
        $this->pay($id, 1, 40000)->assertCreated();
        $before = $this->billingEffects();

        $response = $this->pay($id, 1, 40000);

        $response->assertStatus(409)
            ->assertJsonPath('error.code', 'PAYMENT_EXCEEDS_BALANCE')
            ->assertJsonPath('error.details.amount_due', 10000)
            ->assertJsonPath('error.details.current_version', 2)
            ->assertJsonStructure(['error' => ['fields' => ['amount']]]);
        $this->assertMatchesContract($response, 'schemas/error.json');
        $this->assertSame($before, $this->billingEffects(), 'Ni paiement, ni reçu, ni numéro consommé.');
        $this->assertSame(40000, (int) DB::table('payments')->where('invoice_id', $id)->sum('amount'));

        // Le montant proposé (10 000) est accepté avec la version rendue : jamais un reçu partiel.
        $this->pay($id, 2, 10000)->assertCreated()->assertJsonPath('data.balance.settlement', 'SETTLED')->assertJsonPath('data.receipt_number', 'TEST-REC-2026-000002');
    }

    public function test_une_facture_soldee_n_accepte_plus_aucun_encaissement(): void
    {
        $id = $this->invoiceOf(20000);
        $this->pay($id, 1, 20000)->assertCreated();

        $this->pay($id, 2, 1)->assertStatus(409)->assertJsonPath('error.code', 'PAYMENT_EXCEEDS_BALANCE')->assertJsonPath('error.details.amount_due', 0);
        $this->assertSame(1, DB::table('payments')->where('invoice_id', $id)->count());
    }

    public function test_un_montant_nul_negatif_ou_decimal_est_refuse_par_le_contrat(): void
    {
        $id = $this->invoiceOf(20000);

        foreach ([0, -5000] as $amount) {
            $this->pay($id, 1, $amount)->assertStatus(422)->assertJsonPath('error.code', 'VALIDATION_FAILED');
        }
        $this->write('POST', '/api/v1/invoices/'.$id.'/payments', $this->paymentBody($id, 1, 1000, 'MTN_MOMO', ['amount' => 1000.5]))->assertStatus(422);
        $this->write('POST', '/api/v1/invoices/'.$id.'/payments', $this->paymentBody($id, 1, 1000, 'MTN_MOMO', ['currency' => 'EUR']))->assertStatus(422);
        $this->assertSame(0, DB::table('payments')->count());
    }

    public function test_une_version_perimee_est_un_conflit_qui_rend_la_version_et_le_reste_du(): void
    {
        $id = $this->invoiceOf(80000);
        $this->pay($id, 1, 30000)->assertCreated();
        $before = $this->billingEffects();

        $response = $this->pay($id, 1, 10000);

        $response->assertStatus(409)
            ->assertJsonPath('error.code', 'VERSION_CONFLICT')
            ->assertJsonPath('error.details.current_version', 2)
            ->assertJsonPath('error.details.amount_due', 50000);
        $this->assertSame($before, $this->billingEffects());
    }

    public function test_un_rejeu_de_la_meme_cle_rend_le_meme_recu_et_un_autre_contenu_est_un_conflit(): void
    {
        $id = $this->invoiceOf(80000);
        $body = $this->paymentBody($id, 1, 30000);
        $key = Ulid::generate();

        $first = $this->write('POST', '/api/v1/invoices/'.$id.'/payments', $body, null, $key)->assertCreated();
        $replay = $this->write('POST', '/api/v1/invoices/'.$id.'/payments', $body, null, $key)->assertCreated();
        $this->write('POST', '/api/v1/invoices/'.$id.'/payments', [...$body, 'amount' => 20000], null, $key)
            ->assertStatus(409)->assertJsonPath('error.code', 'IDEMPOTENCY_PAYLOAD_MISMATCH');

        $this->assertSame($first->json('data.receipt_number'), $replay->json('data.receipt_number'));
        $this->assertSame($first->json('data.payment_id'), $replay->json('data.payment_id'));
        $this->assertSame(1, DB::table('payments')->where('invoice_id', $id)->count());
        $this->assertSame(1, DB::table('receipts')->where('invoice_id', $id)->count());
        $this->assertSame(1, DB::table('audit_events')->where('action', 'payment.confirmed')->count());
    }

    public function test_un_second_clic_avec_une_autre_cle_ne_double_pas_l_encaissement(): void
    {
        $id = $this->invoiceOf(80000);
        $body = $this->paymentBody($id, 1, 30000);

        $this->write('POST', '/api/v1/invoices/'.$id.'/payments', $body)->assertCreated();
        $this->write('POST', '/api/v1/invoices/'.$id.'/payments', $body)->assertStatus(422)->assertJsonStructure(['error' => ['fields' => ['payment_id']]]);

        $this->assertSame(30000, (int) DB::table('payments')->where('invoice_id', $id)->sum('amount'));
        $this->assertSame(1, DB::table('receipts')->where('invoice_id', $id)->count());
    }

    public function test_les_identifiants_de_recu_deja_pris_sont_refuses_sans_erreur_sql(): void
    {
        $id = $this->invoiceOf(80000);
        $first = $this->paymentBody($id, 1, 10000);
        $this->write('POST', '/api/v1/invoices/'.$id.'/payments', $first)->assertCreated();

        foreach (['receipt_id', 'receipt_number_usage_id', 'receipt_document_id'] as $field) {
            $this->write('POST', '/api/v1/invoices/'.$id.'/payments', $this->paymentBody($id, 2, 10000, 'MTN_MOMO', [$field => $first[$field]]))
                ->assertStatus(422)->assertJsonStructure(['error' => ['fields' => [$field]]]);
        }
        $this->assertSame(1, DB::table('payments')->where('invoice_id', $id)->count());
    }

    public function test_un_brouillon_et_une_facture_inconnue_ne_s_encaissent_pas(): void
    {
        [$draft] = $this->draft([$this->line($this->item['exam'])]);
        $unknown = Ulid::generate();

        $this->pay($draft, 1, 1000)->assertStatus(409)->assertJsonPath('error.code', 'STATE_TRANSITION_REFUSED')->assertJsonPath('error.details.current_status', 'DRAFT');
        $this->pay($unknown, 1, 1000)->assertNotFound();

        $this->assertSame(0, DB::table('payments')->count());
        $this->assertSame(0, DB::table('document_sequences')->where('document_type', 'RECEIPT')->count(), 'Aucun numéro de reçu n\'est brûlé par un refus.');
    }

    public function test_une_facture_d_un_autre_cabinet_est_introuvable(): void
    {
        $other = $this->makeClinic('TEST CABINET B');
        $this->makeStaff($other, 'MANAGER', 'gerante.b');
        $patient = $this->seedPatient($other);
        $foreign = Ulid::generate();
        DB::table('invoices')->insert([
            'id' => $foreign, 'clinic_id' => $other, 'patient_id' => $patient, 'status' => 'DRAFT', 'currency' => 'XAF', 'total_gross' => 0,
            'origin' => 'NATIVE', 'created_by' => DB::table('users')->where('clinic_id', $other)->value('id'), 'version' => 1,
        ]);

        $this->pay($foreign, 1, 1000)->assertNotFound();
        $this->assertSame(0, DB::table('payments')->count());
    }

    // ------------------------------------------------------------------------------------------------------------
    // Référence de paiement
    // ------------------------------------------------------------------------------------------------------------

    public function test_la_reference_est_obligatoire_pour_mobile_money_et_virement_selon_le_parametrage(): void
    {
        $id = $this->invoiceOf(80000);

        foreach (['MTN_MOMO', 'ORANGE_MONEY', 'BANK_TRANSFER'] as $method) {
            $this->pay($id, 1, 1000, $method, ['reference' => null])->assertStatus(422)->assertJsonStructure(['error' => ['fields' => ['reference']]]);
        }
        $this->pay($id, 1, 1000, 'MTN_MOMO', ['reference' => '   '])->assertStatus(422)->assertJsonStructure(['error' => ['fields' => ['reference']]]);
        $this->assertSame(0, DB::table('payments')->count());

        $this->pay($id, 1, 1000, 'CHEQUE', ['reference' => null])->assertCreated();

        config(['eeo.billing.payment_reference_required' => []]);
        $this->pay($id, 2, 1000, 'MTN_MOMO', ['reference' => null])->assertCreated();
        $this->assertSame(2, DB::table('payments')->count());
    }

    // ------------------------------------------------------------------------------------------------------------
    // Espèces et session de caisse
    // ------------------------------------------------------------------------------------------------------------

    public function test_les_especes_exigent_une_session_ouverte_de_l_auteur_et_les_autres_modes_n_en_ont_pas(): void
    {
        $id = $this->invoiceOf(80000);
        $session = $this->openedSession($this->cashier);

        $this->pay($id, 1, 10000, 'CASH')->assertStatus(422)->assertJsonStructure(['error' => ['fields' => ['cash_session_id']]]);
        $this->pay($id, 1, 10000, 'MTN_MOMO', ['cash_session_id' => $session])->assertStatus(422)->assertJsonStructure(['error' => ['fields' => ['cash_session_id']]]);
        $this->pay($id, 1, 10000, 'CASH', ['cash_session_id' => $session], $this->manager)->assertStatus(422)->assertJsonStructure(['error' => ['fields' => ['cash_session_id']]]);
        $this->pay($id, 1, 10000, 'CASH', ['cash_session_id' => Ulid::generate()])->assertStatus(422)->assertJsonStructure(['error' => ['fields' => ['cash_session_id']]]);
        $this->assertSame(0, DB::table('payments')->count());

        $this->pay($id, 1, 10000, 'CASH', ['cash_session_id' => $session])->assertCreated();
        $this->assertSame($session, DB::table('payments')->where('invoice_id', $id)->value('cash_session_id'));
    }

    public function test_les_especes_alimentent_les_especes_theoriques_de_la_session_et_pas_les_autres_modes(): void
    {
        $id = $this->invoiceOf(80000);
        $session = $this->openedSession($this->cashier, 25000);

        $this->pay($id, 1, 30000, 'CASH', ['cash_session_id' => $session])->assertCreated();
        $this->pay($id, 2, 20000, 'MTN_MOMO')->assertCreated();

        $current = $this->read('/api/v1/cash-sessions/current', $this->cashier)->assertOk();
        $current->assertJsonPath('data.id', $session)
            ->assertJsonPath('data.opening_amount', 25000)
            ->assertJsonPath('data.collected_cash', 30000)
            ->assertJsonPath('data.refunded_cash', 0)
            ->assertJsonPath('data.theoretical_cash', 55000)
            ->assertJsonPath('data.closed_at', null);
        $this->assertMatchesContract($current, 'schemas/resources/billing.json#/$defs/CurrentCashSessionResponse');
    }

    public function test_une_session_cloturee_n_accepte_plus_d_encaissement_especes(): void
    {
        $id = $this->invoiceOf(80000);
        $session = $this->openedSession($this->cashier, 25000);
        $this->write('POST', '/api/v1/cash-sessions/'.$session.'/close', $this->closeSessionBody($session, 25000, 25000), $this->cashier)->assertOk();

        $this->pay($id, 1, 10000, 'CASH', ['cash_session_id' => $session])
            ->assertStatus(409)->assertJsonPath('error.code', 'STATE_TRANSITION_REFUSED')->assertJsonPath('error.details.current_status', 'CLOSED');
        $this->assertSame(0, DB::table('payments')->count());
    }

    public function test_un_encaissement_ne_precede_pas_l_ouverture_de_sa_session(): void
    {
        $id = $this->invoiceOf(80000);
        $session = $this->openedSession($this->cashier);

        // La session s'ouvre à l'instant du serveur (09 h 30 UTC) : une date une minute plus tôt le même jour est antérieure.
        $this->pay($id, 1, 10000, 'CASH', ['cash_session_id' => $session, 'effective_at' => '2026-10-22T09:29:00.000Z'])
            ->assertStatus(422)->assertJsonStructure(['error' => ['fields' => ['effective_at']]]);
        $this->assertSame(0, DB::table('payments')->count());
    }

    // ------------------------------------------------------------------------------------------------------------
    // Date effective
    // ------------------------------------------------------------------------------------------------------------

    public function test_un_encaissement_date_d_un_jour_anterieur_exige_un_motif_conserve_dans_l_audit(): void
    {
        $id = $this->invoiceOf(80000);
        $yesterday = '2026-10-21T22:59:00.000Z'; // 23 h 59 la veille à Douala (UTC+1)
        $sameDay = '2026-10-21T23:00:00.000Z';   // 00 h 00 le jour même à Douala

        $this->pay($id, 1, 10000, 'MTN_MOMO', ['effective_at' => $yesterday])
            ->assertStatus(422)->assertJsonStructure(['error' => ['fields' => ['retroactive_reason']]]);
        $this->pay($id, 1, 10000, 'MTN_MOMO', ['effective_at' => $sameDay])->assertCreated();
        $this->pay($id, 2, 10000, 'MTN_MOMO', ['effective_at' => $yesterday, 'retroactive_reason' => 'Reçu papier de la veille saisi en retard'])
            ->assertCreated()->assertJsonPath('data.effective_at', $yesterday)->assertJsonPath('data.recorded_at', self::NOW);

        $this->assertSame(2, DB::table('payments')->where('invoice_id', $id)->count());
        $reasons = DB::table('audit_events')->where('action', 'payment.confirmed')->whereNotNull('reason')->pluck('reason')->all();
        $this->assertSame(['Reçu papier de la veille saisi en retard'], $reasons);
    }

    public function test_une_date_dans_le_futur_est_refusee(): void
    {
        $id = $this->invoiceOf(80000);

        $this->pay($id, 1, 10000, 'MTN_MOMO', ['effective_at' => '2026-10-22T10:30:00.000Z'])
            ->assertStatus(422)->assertJsonStructure(['error' => ['fields' => ['effective_at']]]);
        $this->assertSame(0, DB::table('payments')->count());
    }

    // ------------------------------------------------------------------------------------------------------------
    // Propriété, droits, cabinets
    // ------------------------------------------------------------------------------------------------------------

    public function test_une_facture_detenue_par_un_poste_n_est_pas_encaissee_par_l_api(): void
    {
        $id = $this->invoiceOf(80000);
        $this->seedWriteOwner($id, 'ACTIVE');

        $response = $this->pay($id, 1, 10000);

        $response->assertStatus(409)->assertJsonPath('error.code', 'WRITE_OWNER_REQUIRED');
        $this->assertStringContainsString('Caisse A', (string) $response->json('error.message'));
        $this->assertSame(0, DB::table('payments')->count());
    }

    public function test_un_droit_de_poste_clos_ne_bloque_plus_l_encaissement_central(): void
    {
        $id = $this->invoiceOf(80000);
        $this->seedWriteOwner($id, 'CLOSED');

        $this->pay($id, 1, 10000)->assertCreated();
    }

    public function test_seuls_la_caissiere_et_la_gerante_encaissent(): void
    {
        $id = $this->invoiceOf(80000);

        $this->pay($id, 1, 1000, 'MTN_MOMO', [], $this->reception)->assertForbidden();
        $this->pay($id, 1, 1000, 'MTN_MOMO', [], $this->clinician)->assertForbidden();
        $this->assertSame(0, DB::table('payments')->count());

        $this->pay($id, 1, 1000, 'MTN_MOMO', [], $this->cashier)->assertCreated();
        $this->pay($id, 2, 1000, 'MTN_MOMO', [], $this->manager)->assertCreated();
        $received = DB::table('payments')->where('invoice_id', $id)->pluck('received_by')->all();
        $expected = [$this->cashier->id, $this->manager->id];
        sort($received);
        sort($expected);
        $this->assertSame($expected, $received);
    }

    public function test_le_profil_frais_d_examen_n_encaisse_que_les_factures_de_frais_d_examen(): void
    {
        $this->allowPermission($this->reception, 'exam_fee.collect');
        [$exam] = $this->issuedUncollectedInvoice([$this->line($this->item['exam'])], $this->reception);
        [$mixed] = $this->issuedUncollectedInvoice([$this->line($this->item['exam']), $this->line($this->item['lens'], '1', 2)], $this->manager);

        $this->pay($mixed, 1, 1000, 'MTN_MOMO', [], $this->reception)->assertForbidden();
        $this->pay($exam, 1, 15000, 'MTN_MOMO', [], $this->reception)->assertCreated()->assertJsonPath('data.balance.settlement', 'SETTLED');

        $this->assertSame(0, DB::table('payments')->where('invoice_id', $mixed)->count());
        $this->assertSame($this->reception->id, DB::table('payments')->where('invoice_id', $exam)->value('received_by'));
    }

    public function test_un_module_ferme_repond_404(): void
    {
        $id = $this->invoiceOf(80000);
        config(['eeo.enabled_modules' => ['stock']]);

        $this->pay($id, 1, 1000, 'MTN_MOMO', [], $this->manager)->assertNotFound();
    }

    /**
     * L'encaissement est ouvert aux postes synchronisés (O05) : une tâche du serveur, sans auteur, est refusée avant toute
     * lecture ; un poste dont le cœur signé ne désigne aucune plage de numéros est refusé sans reçu ni écriture.
     */
    public function test_une_source_sans_auteur_ou_sans_plage_de_numeros_est_refusee(): void
    {
        $id = $this->invoiceOf(80000);
        $payload = $this->paymentBody($id, 1, 1000);
        unset($payload['expected_version']);
        $payload['receipt_number'] = 'TEST-REC-2026-000001';

        $attempts = [
            ['ACTION_FORBIDDEN', 'auteur identifié', $this->jobContext()],
            ['NUMBER_RANGE_INVALID', 'aucune plage', $this->syncContextWithoutRange($this->cashier)],
        ];
        foreach ($attempts as [$code, $fragment, $context]) {
            try {
                $this->app->make(RegisterPaymentHandler::class)->handle(
                    new Command('RegisterPayment', $payload, $id, 1),
                    $context,
                    new TransactionLocks($this->clinicId),
                    Ulid::generate(),
                );
                $this->fail('Une source sans auteur ou sans plage de numéros devait être refusée.');
            } catch (BusinessError $error) {
                $this->assertSame($code, $error->errorCode);
                $this->assertStringContainsString($fragment, $error->getMessage());
            }
        }
        $this->assertSame(0, DB::table('payments')->count());
        $this->assertSame(0, DB::table('receipts')->count());
    }

    public function test_les_verrous_sont_pris_dans_l_ordre_du_contrat(): void
    {
        $id = $this->invoiceOf(80000);
        $session = $this->openedSession($this->cashier);
        $idempotency = Ulid::generate();
        DB::table('idempotency_requests')->insert([
            'id' => $idempotency, 'clinic_id' => $this->clinicId, 'namespace' => 'test', 'command_name' => 'RegisterPayment',
            'request_key' => 'CLE-TEST-0001', 'payload_hash' => str_repeat('b', 64), 'status' => 'RECEIVED',
        ]);
        $payload = $this->paymentBody($id, 1, 10000, 'CASH', ['cash_session_id' => $session]);
        unset($payload['expected_version']);
        $locks = new TransactionLocks($this->clinicId);
        $locks->clinic();

        $this->app->make(RegisterPaymentHandler::class)->handle(
            new Command('RegisterPayment', $payload, $id, 1),
            CommandContext::direct($this->cashier, 'corr-test-0001'),
            $locks,
            $idempotency,
        );

        $this->assertSame(
            ['10:'.$this->clinicId, '40:RECEIPT:2026', '50:'.$id, '60:'.$id, '70:'.$session],
            $locks->acquired(),
            'Cabinet, série de reçus (40), propriété de facture (50), facture (60), session de caisse (70).',
        );
    }

    // ------------------------------------------------------------------------------------------------------------
    // Retour arrière
    // ------------------------------------------------------------------------------------------------------------

    /**
     * @return array<string, array{0: Checkpoint}>
     */
    public static function checkpoints(): array
    {
        $cases = [];
        foreach (Checkpoint::cases() as $checkpoint) {
            $cases[$checkpoint->value] = [$checkpoint];
        }

        return $cases;
    }

    #[DataProvider('checkpoints')]
    public function test_un_echec_a_n_importe_quel_point_annule_paiement_recu_numero_et_document(Checkpoint $failAt): void
    {
        $id = $this->invoiceOf(80000);
        $session = $this->openedSession($this->cashier);
        $before = $this->billingEffects();
        $this->app->instance(CommandBusProbe::class, new RecordingProbe($failAt));
        $this->withoutExceptionHandling();

        try {
            $this->pay($id, 1, 30000, 'CASH', ['cash_session_id' => $session]);
            $this->fail('Une erreur injectée devait annuler la commande.');
        } catch (RuntimeException) {
            // Attendu : la transaction est annulée en entier.
        }

        $this->assertSame($before, $this->billingEffects());
        $this->assertSame(0, DB::table('payments')->count());
        $this->assertSame(0, DB::table('receipts')->count());

        // La même demande aboutit ensuite avec le PREMIER numéro de reçu : rien n'a été brûlé.
        $this->app->instance(CommandBusProbe::class, new RecordingProbe);
        $this->pay($id, 1, 30000, 'CASH', ['cash_session_id' => $session])->assertCreated()->assertJsonPath('data.receipt_number', 'TEST-REC-2026-000001');
    }
}
