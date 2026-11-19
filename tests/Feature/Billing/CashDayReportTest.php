<?php

namespace Tests\Feature\Billing;

use Carbon\CarbonImmutable;
use Tests\Support\BillingFixtures;
use Tests\Support\MigratedDatabase;
use Tests\TestCase;

/**
 * « Caisse du jour » (R01 minimal, EN LIGNE) : encaissements nets par mode d'un jour civil du cabinet. La gérante
 * (`finance.global.read`) lit tout le cabinet avec factures émises et reste à encaisser ; une caissière ne lit que SES
 * encaissements et SES sessions (fichier 09), sans chiffre d'affaires ni créances. Jamais « payé ». Données fictives.
 */
final class CashDayReportTest extends TestCase
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
     * Une facture de 80 000 émise par la gérante ; la caissière encaisse 30 000 en espèces et 20 000 par MTN MoMo, la
     * gérante 5 000 par Orange Money : reste dû 25 000.
     */
    private function dayOfSales(): string
    {
        $session = $this->openedSession($this->cashier, 10000);
        [$invoice] = $this->issuedUncollectedInvoice([$this->line($this->item['lens'], '1', 1, 80000)], $this->manager);
        $this->pay($invoice, 1, 30000, 'CASH', ['cash_session_id' => $session], $this->cashier)->assertCreated();
        $this->pay($invoice, 2, 20000, 'MTN_MOMO', [], $this->cashier)->assertCreated();
        $this->pay($invoice, 3, 5000, 'ORANGE_MONEY', [], $this->manager)->assertCreated();

        return $session;
    }

    public function test_la_gerante_lit_tout_le_cabinet(): void
    {
        $session = $this->dayOfSales();

        $response = $this->read('/api/v1/reports/cash-day?date=2026-10-22', $this->manager)->assertOk();

        $this->assertMatchesContract($response, 'schemas/resources/billing.json#/$defs/CashDayReportResponse');
        $response->assertJsonPath('data.date', '2026-10-22')
            ->assertJsonPath('data.scope', 'CLINIC')
            ->assertJsonPath('data.net_total', 55000)
            ->assertJsonPath('data.issued', ['count' => 1, 'total_gross' => 80000])
            ->assertJsonPath('data.credited', ['count' => 0, 'amount_gross' => 0])
            ->assertJsonPath('data.outstanding', ['invoices_count' => 1, 'amount_due' => 25000, 'refundable_credit' => 0])
            ->assertJsonPath('data.sessions.0.id', $session);
        $byMethod = collect($response->json('data.collections'))->keyBy('method');
        $this->assertSame(['CASH', 'MTN_MOMO', 'ORANGE_MONEY'], $byMethod->keys()->all());
        $this->assertSame(['method' => 'CASH', 'payments_count' => 1, 'payments_amount' => 30000, 'reversals_amount' => 0, 'refunds_amount' => 0, 'net_amount' => 30000], $byMethod['CASH']);
        $this->assertSame(5000, $byMethod['ORANGE_MONEY']['net_amount']);
        $this->assertStringNotContainsString('PAID', (string) $response->getContent());
    }

    public function test_la_caissiere_ne_lit_que_ses_encaissements_et_ses_sessions(): void
    {
        $session = $this->dayOfSales();
        // Une autre caissière ouvre sa propre session ce jour-là : absente du relevé de la première.
        $this->write('POST', '/api/v1/cash-sessions/'.$session.'/close', $this->closeSessionBody($session, 40000, 40000, null, ['closed_at' => self::NOW]), $this->cashier)->assertOk();
        $other = $this->makeStaff($this->clinicId, 'CASHIER', 'caisse.deux');
        $otherSession = $this->openedSession($other);

        $response = $this->read('/api/v1/reports/cash-day', $this->cashier)->assertOk();

        $this->assertMatchesContract($response, 'schemas/resources/billing.json#/$defs/CashDayReportResponse');
        $response->assertJsonPath('data.scope', 'OWN')
            ->assertJsonPath('data.net_total', 50000)
            ->assertJsonPath('data.issued', null)
            ->assertJsonPath('data.credited', null)
            ->assertJsonPath('data.outstanding', null);
        $this->assertSame(['CASH', 'MTN_MOMO'], array_column($response->json('data.collections'), 'method'), 'L\'encaissement de la gérante n\'est pas le sien');
        $this->assertSame([$session], array_column($response->json('data.sessions'), 'id'));
        $this->assertNotContains($otherSession, array_column($response->json('data.sessions'), 'id'));
    }

    public function test_sans_date_c_est_aujourd_hui_au_fuseau_du_cabinet(): void
    {
        $this->dayOfSales();
        // 22 octobre, 23 h 30 UTC = 00 h 30 le 23 à Douala : « aujourd'hui » est le 23, jour sans encaissement.
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-10-22 23:30:00', 'UTC'));

        $this->read('/api/v1/reports/cash-day', $this->manager)
            ->assertOk()
            ->assertJsonPath('data.date', '2026-10-23')
            ->assertJsonPath('data.collections', [])
            ->assertJsonPath('data.net_total', 0)
            ->assertJsonPath('data.issued', ['count' => 0, 'total_gross' => 0]);
        $this->read('/api/v1/reports/cash-day?date=2026-10-22', $this->manager)->assertOk()->assertJsonPath('data.net_total', 55000);
    }

    public function test_une_date_illisible_est_refusee(): void
    {
        $this->read('/api/v1/reports/cash-day?date=22-10-2026', $this->manager)
            ->assertStatus(422)
            ->assertJsonStructure(['error' => ['fields' => ['date']]]);
    }

    public function test_droits_cabinet_et_module(): void
    {
        $this->read('/api/v1/reports/cash-day', $this->reception)->assertForbidden();
        $this->read('/api/v1/reports/cash-day', $this->clinician)->assertForbidden();

        $this->dayOfSales();
        $otherClinic = $this->makeClinic('TEST CABINET B');
        $otherManager = $this->makeStaff($otherClinic, 'MANAGER', 'gerante.b');
        $this->read('/api/v1/reports/cash-day?date=2026-10-22', $otherManager)
            ->assertOk()
            ->assertJsonPath('data.net_total', 0)
            ->assertJsonPath('data.outstanding.amount_due', 0);

        config(['eeo.enabled_modules' => ['stock']]);
        $this->read('/api/v1/reports/cash-day', $this->manager)->assertNotFound();
    }
}
