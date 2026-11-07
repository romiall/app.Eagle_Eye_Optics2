<?php

namespace Tests\Feature\Billing;

use App\Domain\Shared\Ulid;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;
use Tests\Support\ApprovalFixtures;
use Tests\Support\BillingFixtures;
use Tests\Support\MigratedDatabase;
use Tests\TestCase;

/**
 * Finance du cabinet sur une période (R01 ; fichier 03 « Caisse et indicateurs » ; AT24, AT25, AT26) sur MySQL réel :
 * chiffre d'affaires et encaissements sont des indicateurs DISTINCTS (une ancienne facture réglée aujourd'hui augmente les
 * encaissements, pas le chiffre d'affaires ; un avoir d'aujourd'hui le diminue) ; plusieurs paiements, avoirs, contre-
 * écritures et remboursements ne se multiplient pas entre eux ; dates effectives au fuseau du cabinet ; reprise papier hors
 * chiffre d'affaires mais dans les créances et les encaissements ; caisse clôturée ; gérante seule, cabinet, module, période.
 * Les postes hors ligne et la fraîcheur des totaux sont dans `FinancialReportFreshnessTest`. Données fictives.
 */
final class FinancialReportTest extends TestCase
{
    use ApprovalFixtures;
    use BillingFixtures;
    use MigratedDatabase;

    private const JPEG = "\xFF\xD8\xFF\xE0fictif-justificatif";

    private const SCHEMA = 'schemas/resources/operations.json#/$defs/FinancialReportResponse';

    protected function setUp(): void
    {
        parent::setUp();
        $this->bootBilling(['sales', 'stock', 'settings']);
        // bootBilling remplace la liste des préfixes : la série des reprises y est ajoutée ici.
        config(['eeo.numbering.prefixes.LEGACY_BALANCE' => 'TEST-REP']);
        Storage::fake('local');
    }

    protected function tearDown(): void
    {
        $this->resetClock();
        parent::tearDown();
    }

    private function goTo(string $instant): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse($instant, 'UTC'));
    }

    private function finance(string $query = '', ?User $as = null): TestResponse
    {
        return $this->read('/api/v1/reports/financial'.$query, $as ?? $this->manager);
    }

    /** @return array<string, mixed> */
    private function data(TestResponse $response): array
    {
        $this->assertMatchesContract($response, self::SCHEMA);

        return (array) $response->json('data');
    }

    /**
     * Une facture de 80 000 émise le 22 octobre (gérante) et payée de 30 000 ; le 25 octobre, une vente de 30 000 (deux examens) émise par la
     * caissière, le solde de 50 000 de l'ancienne facture encaissé par la caissière, 10 000 d'acompte sur la vente encaissés
     * par la gérante, et un avoir de 5 000 sur la vente : [ancienne facture, vente].
     *
     * @return array{0: string, 1: string}
     */
    private function twoDays(): array
    {
        [$old] = $this->issuedInvoice([$this->line($this->item['lens'], '1', 1, 80000)], $this->manager);
        $this->pay($old, 1, 30000, 'MTN_MOMO', [], $this->cashier)->assertCreated();

        $this->goTo('2026-10-25 09:30:00');
        [$sale, $total, $version] = $this->draft([$this->line($this->item['exam'], '2')], $this->cashier);
        $this->write('POST', '/api/v1/invoices/'.$sale.'/issue', $this->issueBody($sale, $version, $total, ['issued_at' => '2026-10-25T09:29:00.000Z']), $this->cashier)->assertOk();
        $this->pay($old, $this->ledgerVersion($old), 50000, 'MTN_MOMO', ['effective_at' => '2026-10-25T09:30:00.000Z'], $this->cashier)->assertCreated();
        $this->pay($sale, $this->ledgerVersion($sale), 10000, 'MTN_MOMO', ['effective_at' => '2026-10-25T09:30:00.000Z'], $this->manager)->assertCreated();
        $this->writeReauthenticated('POST', '/api/v1/invoices/'.$sale.'/credit-notes', $this->creditNoteBody($sale, $this->ledgerVersion($sale), [$this->creditLine($this->firstLine($sale), 5000)]), $this->manager)->assertCreated();

        return [$old, $sale];
    }

    public function test_le_chiffre_d_affaires_et_les_encaissements_sont_des_indicateurs_distincts(): void
    {
        $this->twoDays();

        // Le 25 : une vente de 30 000 moins un avoir de 5 000 = 25 000 de chiffre d'affaires ; mais 60 000 encaissés
        // (50 000 d'une ANCIENNE facture + 10 000 d'acompte), qui ne sont pas des ventes d'aujourd'hui.
        $today = $this->data($this->finance('?from=2026-10-25&to=2026-10-25')->assertOk());
        $this->assertSame(['from' => '2026-10-25', 'to' => '2026-10-25'], $today['period']);
        $this->assertSame(['count' => 1, 'total_gross' => 30000], $today['revenue']['issued']);
        $this->assertSame(['count' => 1, 'amount_gross' => 5000], $today['revenue']['credited']);
        $this->assertSame(25000, $today['revenue']['net']);
        $this->assertSame(60000, $today['collections']['net_total']);
        $this->assertNotSame($today['revenue']['net'], $today['collections']['net_total']);
        $this->assertSame([['method' => 'MTN_MOMO', 'payments_count' => 2, 'payments_amount' => 60000, 'reversals_amount' => 0, 'refunds_amount' => 0, 'net_amount' => 60000]], $today['collections']['by_method']);
        // Créances de TOUTES les périodes : l'ancienne facture est soldée, la vente doit encore 30 000 − 5 000 − 10 000.
        $this->assertSame(['invoices_count' => 1, 'amount_due' => 15000], ['invoices_count' => $today['receivables']['invoices_count'], 'amount_due' => $today['receivables']['amount_due']]);

        // Le 22 : l'ancienne facture de 80 000 est une vente de ce jour-là, 30 000 seulement ont été encaissés.
        $first = $this->data($this->finance('?from=2026-10-22&to=2026-10-22')->assertOk());
        $this->assertSame(['count' => 1, 'total_gross' => 80000], $first['revenue']['issued']);
        $this->assertSame(80000, $first['revenue']['net']);
        $this->assertSame(30000, $first['collections']['net_total']);

        // Les quatre jours ensemble : 2 ventes (110 000) − 5 000 d'avoir, 90 000 encaissés en 3 paiements.
        $all = $this->data($this->finance('?from=2026-10-22&to=2026-10-25')->assertOk());
        $this->assertSame(['count' => 2, 'total_gross' => 110000], $all['revenue']['issued']);
        $this->assertSame(105000, $all['revenue']['net']);
        $this->assertSame(90000, $all['collections']['net_total']);
        $this->assertSame(3, $all['collections']['by_method'][0]['payments_count']);
        $this->assertStringNotContainsString('PAID', (string) json_encode($all));
    }

    public function test_la_vente_et_l_encaissement_se_rattachent_chacun_a_leur_auteur(): void
    {
        $this->twoDays();

        $data = $this->data($this->finance('?from=2026-10-25&to=2026-10-25')->assertOk());

        // Vente = auteur de l'ÉMISSION (la caissière a émis la vente, la gérante a émis l'avoir) ; encaissement = auteur du
        // PAIEMENT (la caissière a encaissé 50 000, la gérante 10 000) : deux responsabilités qui ne se fusionnent pas.
        $sales = collect($data['revenue']['by_author'])->keyBy('user_id');
        $this->assertSame(30000, $sales[$this->cashier->id]['issued_gross']);
        $this->assertSame(0, $sales[$this->cashier->id]['credited_gross']);
        $this->assertSame(0, $sales[$this->manager->id]['issued_gross']);
        $this->assertSame(5000, $sales[$this->manager->id]['credited_gross']);
        $this->assertSame(-5000, $sales[$this->manager->id]['net']);
        $this->assertNotNull($sales[$this->cashier->id]['display_name']);

        $collected = collect($data['collections']['by_author'])->keyBy('user_id');
        $this->assertSame(50000, $collected[$this->cashier->id]['payments_amount']);
        $this->assertSame(10000, $collected[$this->manager->id]['payments_amount']);
        $this->assertSame(60000, $collected[$this->cashier->id]['net_amount'] + $collected[$this->manager->id]['net_amount']);
    }

    public function test_plusieurs_paiements_avoirs_contre_ecritures_et_remboursements_ne_se_multiplient_pas(): void
    {
        [$invoice] = $this->issuedInvoice([$this->line($this->item['lens'], '1', 1, 80000)], $this->manager);
        $this->pay($invoice, 1, 50000)->assertCreated();
        $this->pay($invoice, 2, 30000)->assertCreated();
        $payments = DB::table('payments')->where('invoice_id', $invoice)->orderBy('effective_at')->orderBy('created_at')->pluck('id')->all();
        $this->writeReauthenticated('POST', '/api/v1/payments/'.$payments[1].'/reversals', $this->reversalBody($invoice, (string) $payments[1], 3, 10000), $this->manager)->assertCreated();
        $note = $this->writeReauthenticated('POST', '/api/v1/invoices/'.$invoice.'/credit-notes', $this->creditNoteBody($invoice, 4, [$this->creditLine($this->firstLine($invoice), 30000)]), $this->manager)->assertCreated();
        $this->writeReauthenticated('POST', '/api/v1/invoices/'.$invoice.'/refunds', $this->refundBody($invoice, (string) $note->json('data.credit_note_id'), 5, 5000), $this->manager)->assertCreated();
        $this->writeReauthenticated('POST', '/api/v1/invoices/'.$invoice.'/credit-notes', $this->creditNoteBody($invoice, 6, [$this->creditLine($this->firstLine($invoice), 10000)]), $this->manager)->assertCreated();

        $data = $this->data($this->finance('?from=2026-10-22&to=2026-10-22')->assertOk());

        // Deux avoirs (30 000 + 10 000) sur une facture de 80 000 payée deux fois : ni 2 × 40 000 ni 2 × 80 000.
        $this->assertSame(['count' => 1, 'total_gross' => 80000], $data['revenue']['issued']);
        $this->assertSame(['count' => 2, 'amount_gross' => 40000], $data['revenue']['credited']);
        $this->assertSame(40000, $data['revenue']['net']);
        $this->assertSame([['method' => 'MTN_MOMO', 'payments_count' => 2, 'payments_amount' => 80000, 'reversals_amount' => 10000, 'refunds_amount' => 5000, 'net_amount' => 65000]], $data['collections']['by_method']);
        $this->assertSame(65000, $data['collections']['net_total']);
        $this->assertSame(['reversals' => ['count' => 1, 'amount' => 10000], 'refunds' => ['count' => 1, 'amount' => 5000]], $data['collections']['corrections']);
        // 80 000 − 40 000 d'avoirs − 80 000 reçus + 10 000 contre-écrits + 5 000 remboursés = −25 000 : rien à encaisser,
        // 25 000 de crédit à rembourser, rendus à part.
        $this->assertSame(0, $data['receivables']['amount_due']);
        $this->assertSame(['invoices_count' => 1, 'amount' => 25000], $data['receivables']['refundable_credit']);
        // La vue des soldes du serveur dit la même chose que le rapport.
        $this->assertSame(25000, (int) DB::table('vw_invoice_balances')->where('invoice_id', $invoice)->value('refundable_credit'));
    }

    public function test_les_dates_effectives_et_les_bornes_du_jour_sont_celles_du_cabinet(): void
    {
        [$invoice] = $this->issuedInvoice([$this->line($this->item['lens'], '1', 1, 80000)], $this->manager);
        // 23 h 59 la veille à Douala (UTC+1), saisi en retard ; puis 00 h 00 le jour même (borne incluse du jour).
        $this->pay($invoice, 1, 10000, 'MTN_MOMO', ['effective_at' => '2026-10-21T22:59:00.000Z', 'retroactive_reason' => 'Reçu papier de la veille saisi en retard'])->assertCreated();
        $this->pay($invoice, 2, 20000, 'MTN_MOMO', ['effective_at' => '2026-10-21T23:00:00.000Z'])->assertCreated();

        $this->assertSame(10000, $this->data($this->finance('?from=2026-10-21&to=2026-10-21')->assertOk())['collections']['net_total']);
        $this->assertSame(20000, $this->data($this->finance('?from=2026-10-22&to=2026-10-22')->assertOk())['collections']['net_total']);
        $this->assertSame(30000, $this->data($this->finance('?from=2026-10-21&to=2026-10-22')->assertOk())['collections']['net_total']);
        // La vente reste du 22 : la date de saisie d'un paiement ne déplace pas le chiffre d'affaires.
        $this->assertSame(0, $this->data($this->finance('?from=2026-10-21&to=2026-10-21')->assertOk())['revenue']['net']);
    }

    public function test_une_reprise_papier_n_est_ni_une_vente_ni_un_encaissement_mais_une_creance(): void
    {
        $evidence = (string) $this->actingAsReauthenticated($this->manager)
            ->call('POST', '/api/v1/legacy-balances/evidence', [], [], [], $this->transformHeadersToServerVars(['Idempotency-Key' => Ulid::generate(), 'Content-Type' => 'image/jpeg', 'Accept' => 'application/json']), self::JPEG)
            ->assertCreated()->json('data.file_id');
        $row = ['line' => 2, 'patient_id' => $this->patientId, 'patient_record_number' => null, 'paper_reference' => 'CARNET-0142', 'original_total' => 80000, 'already_paid' => 30000, 'original_invoice_on' => '2025-11-04'];
        $legacy = (string) $this->actingAsReauthenticated($this->manager)->withHeaders(['Idempotency-Key' => Ulid::generate()])
            ->postJson('/api/v1/imports/legacy-balances', ['dry_run' => false, 'evidence_file_id' => $evidence, 'rows' => [$row]])
            ->assertCreated()->json('data.created_ids.0');
        // Une vente du jour, non payée, à côté de la reprise.
        $this->issuedInvoice([$this->line($this->item['lens'], '1', 1, 10000)], $this->manager);

        $before = $this->data($this->finance('?from=2026-10-22&to=2026-10-22')->assertOk());
        $this->assertSame(['count' => 1, 'total_gross' => 10000], $before['revenue']['issued'], 'la reprise de 50 000 n\'est pas une vente');
        $this->assertSame(['count' => 1, 'opening_balance' => 50000], $before['legacy_imported']);
        $this->assertSame(0, $before['collections']['net_total'], 'l\'ancien acompte de 30 000 n\'est pas un encaissement');
        $this->assertSame(60000, $before['receivables']['amount_due']);
        $this->assertSame(['invoices_count' => 1, 'amount_due' => 50000], $before['receivables']['of_which_legacy']);

        // 20 000 encaissés sur la reprise : un encaissement d'aujourd'hui, une dette ramenée à 30 000, toujours pas une vente.
        $this->pay($legacy, $this->ledgerVersion($legacy), 20000)->assertCreated();
        $after = $this->data($this->finance('?from=2026-10-22&to=2026-10-22')->assertOk());
        $this->assertSame(['count' => 1, 'total_gross' => 10000], $after['revenue']['issued']);
        $this->assertSame(20000, $after['collections']['net_total']);
        $this->assertSame(['payments_count' => 1, 'net_amount' => 20000], $after['collections']['on_legacy']);
        $this->assertSame(40000, $after['receivables']['amount_due']);
        $this->assertSame(['invoices_count' => 1, 'amount_due' => 30000], $after['receivables']['of_which_legacy']);
    }

    public function test_une_session_cloturee_donne_son_attendu_fige_son_compte_son_ecart_et_les_corrections_apres_cloture(): void
    {
        $session = $this->openedSession($this->cashier, 10000);
        [$invoice] = $this->issuedInvoice([$this->line($this->item['lens'], '1', 1, 80000)], $this->manager);
        $this->pay($invoice, 1, 30000, 'CASH', ['cash_session_id' => $session], $this->cashier)->assertCreated();
        // Ouverture 10 000 + espèces 30 000 = 40 000 attendus ; 39 500 comptés : écart de −500, motivé.
        $this->write('POST', '/api/v1/cash-sessions/'.$session.'/close', $this->closeSessionBody($session, 39500, 40000, 'Écart de monnaie (fictif)'), $this->cashier)->assertOk();
        // Une autre session reste ouverte.
        $other = $this->makeStaff($this->clinicId, 'CASHIER', 'caisse.deux');
        $this->openedSession($other, 5000);
        // Contre-écriture de 5 000 APRÈS la clôture : la session figée n'est pas réécrite, la correction est comptée à part.
        $this->goTo('2026-10-22 09:45:00');
        $payment = $this->firstPayment($invoice);
        $this->writeReauthenticated('POST', '/api/v1/payments/'.$payment.'/reversals', $this->reversalBody($invoice, $payment, $this->ledgerVersion($invoice), 5000), $this->manager)->assertCreated();

        $data = $this->data($this->finance('?from=2026-10-22&to=2026-10-22')->assertOk());

        $this->assertSame(
            ['closed_count' => 1, 'expected_total' => 40000, 'counted_total' => 39500, 'variance_total' => -500, 'post_closure_reversals' => 5000, 'open_count' => 1],
            $data['cash_sessions'],
        );
        $this->assertSame(25000, $data['collections']['net_total'], 'espèces 30 000 − contre-écriture 5 000');
        $this->assertSame(['reversals' => ['count' => 1, 'amount' => 5000], 'refunds' => ['count' => 0, 'amount' => 0]], $data['collections']['corrections']);
        // Le lendemain, aucune session n'a été clôturée ; celle de l'autre caissière est toujours ouverte.
        $next = $this->data($this->finance('?from=2026-10-23&to=2026-10-23')->assertOk());
        $this->assertSame(0, $next['cash_sessions']['closed_count']);
    }

    public function test_la_gerante_seule_lit_la_finance_de_son_cabinet(): void
    {
        $this->twoDays();
        $this->goTo('2026-10-25 10:00:00');

        foreach ([$this->cashier, $this->reception, $this->clinician] as $user) {
            $this->finance('?from=2026-10-25&to=2026-10-25', $user)->assertForbidden();
        }

        // Un autre cabinet ne voit rien de celui-ci.
        $otherClinic = $this->makeClinic('TEST CABINET B');
        $otherManager = $this->makeStaff($otherClinic, 'MANAGER', 'gerante.b');
        $other = $this->data($this->finance('?from=2026-10-22&to=2026-10-25', $otherManager)->assertOk());
        $this->assertSame(0, $other['revenue']['issued']['count']);
        $this->assertSame(0, $other['collections']['net_total']);
        $this->assertSame(0, $other['receivables']['amount_due']);
        $this->assertSame([], $other['collections']['by_method']);
        $this->assertSame([], $other['freshness']['devices']);

        config(['eeo.enabled_modules' => ['stock']]);
        $this->finance('?from=2026-10-25&to=2026-10-25')->assertNotFound();
        $this->read('/api/v1/reports/financial')->assertNotFound();
    }

    public function test_sans_periode_c_est_aujourd_hui_au_fuseau_du_cabinet_et_une_periode_illisible_est_refusee(): void
    {
        [$invoice] = $this->issuedInvoice([$this->line($this->item['lens'], '1', 1, 80000)], $this->manager);
        $this->pay($invoice, 1, 30000)->assertCreated();
        // 22 octobre, 23 h 30 UTC = 00 h 30 le 23 à Douala : « aujourd'hui » est le 23, jour sans encaissement.
        $this->goTo('2026-10-22 23:30:00');

        $today = $this->data($this->finance()->assertOk());
        $this->assertSame(['from' => '2026-10-23', 'to' => '2026-10-23'], $today['period']);
        $this->assertSame(0, $today['collections']['net_total']);
        $this->assertSame(0, $today['revenue']['issued']['count']);
        $this->assertSame(30000, $this->data($this->finance('?from=2026-10-22&to=2026-10-22')->assertOk())['collections']['net_total']);

        $this->finance('?from=2026-10-25&to=2026-10-22')->assertStatus(422)->assertJsonStructure(['error' => ['fields' => ['to']]]);
        $this->finance('?from=2026-10-22')->assertStatus(422)->assertJsonStructure(['error' => ['fields' => ['to']]]);
        $this->finance('?to=2026-10-22')->assertStatus(422)->assertJsonStructure(['error' => ['fields' => ['from']]]);
        $this->finance('?from=22-10-2026&to=2026-10-22')->assertStatus(422)->assertJsonStructure(['error' => ['fields' => ['from']]]);
        $this->finance('?from=2025-01-01&to=2026-10-22')->assertStatus(422)->assertJsonStructure(['error' => ['fields' => ['to']]]);
        $this->finance('?from=2025-10-22&to=2026-10-22')->assertOk();
    }
}
