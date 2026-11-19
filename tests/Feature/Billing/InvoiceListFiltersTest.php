<?php

namespace Tests\Feature\Billing;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Tests\Support\BillingFixtures;
use Tests\Support\MigratedDatabase;
use Tests\TestCase;

/**
 * Liste des factures pour un usage réel (B02, écarts relevés par les écrans) : identité de BASE du patient dans chaque
 * ligne (dossier, nom, prénoms ; jamais clinique), filtre serveur par jour civil d'émission au FUSEAU DU CABINET
 * (jamais minuit UTC), noms actuels de l'émetteur et de qui a encaissé dans la facture. Données fictives.
 */
final class InvoiceListFiltersTest extends TestCase
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

    public function test_chaque_ligne_porte_l_identite_de_base_du_patient(): void
    {
        [$draftId] = $this->draft(null, $this->cashier);
        [$issuedId] = $this->issuedInvoice(null, $this->cashier);
        $record = DB::table('patient_records')->where('id', $this->patientId)->first();

        $response = $this->read('/api/v1/invoices', $this->cashier)->assertOk();

        $this->assertMatchesContract($response, 'schemas/resources/billing.json#/$defs/InvoicePage');
        $rows = collect($response->json('data'))->keyBy('id');
        foreach ([$draftId, $issuedId] as $id) {
            $this->assertSame($this->patientId, $rows[$id]['patient']['id']);
            $this->assertSame($record->record_number, $rows[$id]['patient']['record_number']);
            $this->assertSame($record->last_name, $rows[$id]['patient']['last_name']);
            $this->assertSame($record->first_names, $rows[$id]['patient']['first_names']);
            $this->assertSame(['id', 'record_number', 'last_name', 'first_names'], array_keys($rows[$id]['patient']), 'Aucune autre donnée du dossier dans la liste');
        }
    }

    public function test_le_jour_d_emission_est_celui_du_fuseau_du_cabinet(): void
    {
        // 22 octobre, 09 h 30 UTC = 10 h 30 à Douala : jour civil du 22.
        [$morning] = $this->issuedInvoice(null, $this->cashier);
        // 22 octobre, 23 h 30 UTC = 00 h 30 le 23 à Douala : jour civil du 23, bien que ce soit encore le 22 en UTC.
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-10-22 23:30:00', 'UTC'));
        [$night] = $this->issuedInvoice(null, $this->cashier);
        [$draft] = $this->draft(null, $this->cashier);

        $first = $this->read('/api/v1/invoices?issued_on=2026-10-22', $this->cashier)->assertOk();
        $this->assertSame([$morning], array_column($first->json('data'), 'id'));
        $this->assertSame(1, $first->json('meta.total'));

        $second = $this->read('/api/v1/invoices?issued_on=2026-10-23', $this->cashier)->assertOk();
        $this->assertSame([$night], array_column($second->json('data'), 'id'), 'Le brouillon du même jour n\'est pas une facture émise');
        $this->assertNotContains($draft, array_column($second->json('data'), 'id'));

        $this->read('/api/v1/invoices?issued_on=2026-10-24', $this->cashier)->assertOk()->assertJsonPath('data', [])->assertJsonPath('meta.total', 0);
    }

    public function test_le_filtre_de_jour_se_combine_avec_le_patient_et_l_etat(): void
    {
        [$mine] = $this->issuedInvoice(null, $this->cashier);
        $other = $this->seedPatient($this->clinicId);
        $this->write('POST', '/api/v1/invoices', $this->draftBody([$this->line($this->item['exam'])], ['patient_id' => $other]), $this->cashier)->assertCreated();

        $this->read('/api/v1/invoices?issued_on=2026-10-22&patient_id='.$this->patientId.'&status=ISSUED', $this->cashier)
            ->assertOk()
            ->assertJsonPath('data.0.id', $mine)
            ->assertJsonPath('meta.total', 1);
        $this->read('/api/v1/invoices?issued_on=2026-10-22&status=DRAFT', $this->cashier)->assertOk()->assertJsonPath('meta.total', 0);
    }

    public function test_un_jour_illisible_est_refuse_sur_son_champ(): void
    {
        foreach (['22/10/2026', '2026-02-30', 'hier', '2026-10-22T00:00:00Z'] as $value) {
            $this->read('/api/v1/invoices?issued_on='.urlencode($value), $this->cashier)
                ->assertStatus(422)
                ->assertJsonPath('error.code', 'VALIDATION_FAILED')
                ->assertJsonStructure(['error' => ['fields' => ['issued_on']]]);
        }
        $this->read('/api/v1/invoices?issued_on=', $this->cashier)->assertOk();
    }

    public function test_la_liste_reste_limitee_au_cabinet(): void
    {
        $this->issuedInvoice(null, $this->cashier);
        $otherClinic = $this->makeClinic('TEST CABINET B');
        $otherCashier = $this->makeStaff($otherClinic, 'CASHIER', 'caisse.b');

        $this->read('/api/v1/invoices?issued_on=2026-10-22', $otherCashier)->assertOk()->assertJsonPath('meta.total', 0);
    }

    public function test_la_facture_porte_le_nom_actuel_de_l_emetteur_et_de_qui_a_encaisse(): void
    {
        [$id, $total] = $this->issuedUncollectedInvoice(null, $this->cashier);
        $this->pay($id, 1, $total, 'MTN_MOMO', [], $this->cashier)->assertCreated();

        $response = $this->read('/api/v1/invoices/'.$id, $this->cashier)->assertOk();
        $this->assertMatchesContract($response, 'schemas/resources/billing.json#/$defs/InvoiceResponse');
        $name = (string) DB::table('users')->where('id', $this->cashier->id)->value('display_name');
        $response->assertJsonPath('data.issued_by_name', $name)
            ->assertJsonPath('data.payments.0.received_by', $this->cashier->id)
            ->assertJsonPath('data.payments.0.received_by_name', $name);

        // Brouillon : aucun émetteur, aucun nom inventé.
        [$draft] = $this->draft(null, $this->cashier);
        $this->read('/api/v1/invoices/'.$draft, $this->cashier)->assertOk()->assertJsonPath('data.issued_by_name', null);
    }

    public function test_sans_droit_de_lecture_ou_module_ferme_la_liste_n_est_pas_lue(): void
    {
        $this->read('/api/v1/invoices?issued_on=2026-10-22', $this->reception)->assertForbidden();
        $this->read('/api/v1/invoices?issued_on=2026-10-22', $this->clinician)->assertForbidden();

        config(['eeo.enabled_modules' => ['stock']]);
        $this->read('/api/v1/invoices?issued_on=2026-10-22', $this->cashier)->assertNotFound();
    }
}
