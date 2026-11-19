<?php

namespace Tests\Feature\Offline;

use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Support\BillingFixtures;
use Tests\Support\MigratedDatabase;
use Tests\Support\OfflineResourceFixtures;
use Tests\TestCase;

/**
 * Ressources d'un poste préparé (O03 ; fichier 19 « Numéros », « Un seul rédacteur financier », « Droits de stock » ;
 * AT09, AT39, AT40, AT43) sur MySQL réel : plages disjointes prises après le plus haut numéro connu et hors de toute
 * allocation centrale, année du fuseau du cabinet (en cours ou suivante), propriété d'écriture des factures émises,
 * quotas retirés du disponible central sans toucher au physique, une seule caisse hors-ligne principale, grants actifs
 * exigés, droits, module, réauthentification, rejeu idempotent. Données fictives.
 */
final class PrepareResourcesTest extends TestCase
{
    use BillingFixtures;
    use MigratedDatabase;
    use OfflineResourceFixtures;

    private const SCHEMA = 'schemas/resources/operations.json#/$defs/PreparationResponse';

    private string $device;

    protected function setUp(): void
    {
        parent::setUp();
        // Horloge figée AVANT la création des comptes (BillingFixtures::bootBilling).
        $this->bootBilling(['sales', 'stock', 'offline']);
        $this->device = $this->seedDevice('Caisse principale (fictive)');
        $this->seedGrant($this->device, $this->cashier);
        $this->seedGrant($this->device, $this->reception);
    }

    protected function tearDown(): void
    {
        $this->resetClock();
        parent::tearDown();
    }

    public function test_les_plages_sont_disjointes_et_la_sequence_centrale_monte_a_leur_fin(): void
    {
        // Deux factures déjà numérotées au central : la plage commence après elles.
        $this->issuedUncollectedInvoice();
        $this->issuedUncollectedInvoice();

        $response = $this->prepareDevice($this->device, [
            'profiles' => [$this->cashier->id, $this->reception->id],
            'number_ranges' => [
                ['document_type' => 'INVOICE', 'quantity' => 300],
                ['document_type' => 'RECEIPT', 'quantity' => 300],
                ['document_type' => 'PATIENT', 'quantity' => 50],
            ],
        ])->assertOk();
        $this->assertMatchesContract($response, self::SCHEMA);

        $this->assertSame([['start' => 3, 'end' => 302]], $this->rangesOf('INVOICE'));
        $this->assertSame([['start' => 1, 'end' => 300]], $this->rangesOf('RECEIPT'));
        $this->assertSame(302, (int) DB::table('document_sequences')->where('clinic_id', $this->clinicId)->where('document_type', 'INVOICE')->value('last_value'));

        $ranges = collect($response->json('data.number_allocations'))->keyBy('document_type');
        $this->assertSame('TEST-FAC', $ranges['INVOICE']['prefix']);
        $this->assertSame(6, $ranges['INVOICE']['width']);
        $this->assertSame('EE', $ranges['PATIENT']['prefix']);
        $this->assertSame(4, $ranges['PATIENT']['width']);
        $this->assertSame('3', $ranges['INVOICE']['range_start']);

        // La patiente reçoit sa plage par le grant de l'accueil (patient.create), les pièces par celui de la caisse.
        $grants = DB::table('offline_grants')->where('device_id', $this->device)->pluck('id', 'user_id');
        $this->assertSame($grants[$this->reception->id], $ranges['PATIENT']['grant_id']);
        $this->assertSame($grants[$this->cashier->id], $ranges['INVOICE']['grant_id']);

        // Un numéro central ultérieur est HORS de la plage : jamais un numéro déjà réservé au poste.
        [, , $number] = $this->issuedInvoice();
        $this->assertSame('TEST-FAC-2026-000303', $number);
    }

    public function test_deux_preparations_successives_ne_se_chevauchent_jamais(): void
    {
        $first = ['profiles' => [$this->reception->id], 'number_ranges' => [['document_type' => 'PATIENT', 'quantity' => 100]]];
        $this->prepareDevice($this->device, $first)->assertOk();
        $this->prepareDevice($this->device, $first)->assertOk();

        $this->assertSame([['start' => 1, 'end' => 100], ['start' => 101, 'end' => 200]], $this->rangesOf('PATIENT'));
    }

    public function test_un_rejeu_de_la_meme_cle_ne_reserve_qu_une_plage(): void
    {
        $body = ['profiles' => [$this->reception->id], 'number_ranges' => [['document_type' => 'PATIENT', 'quantity' => 10]]];
        $this->prepareDevice($this->device, $body, key: 'cle-preparation-0001')->assertOk();
        $this->prepareDevice($this->device, $body, key: 'cle-preparation-0001')->assertOk();

        $this->assertCount(1, $this->rangesOf('PATIENT'));
    }

    public function test_la_plage_de_l_annee_suivante_se_prepare_avant_le_franchissement(): void
    {
        $this->prepareDevice($this->device, [
            'profiles' => [$this->reception->id],
            'number_ranges' => [['document_type' => 'PATIENT', 'quantity' => 20, 'document_year' => 2027]],
        ])->assertOk();

        $this->assertSame([['start' => 1, 'end' => 20]], $this->rangesOf('PATIENT', 2027));
    }

    /**
     * @return array<string, array{0: array<string, mixed>, 1: string}>
     */
    public static function invalidRanges(): array
    {
        return [
            'série non préparée en L0' => [['document_type' => 'QUOTE', 'quantity' => 10], 'number_ranges.0.document_type'],
            'taille nulle' => [['document_type' => 'PATIENT', 'quantity' => 0], 'number_ranges.0.quantity'],
            'année passée' => [['document_type' => 'PATIENT', 'quantity' => 10, 'document_year' => 2025], 'number_ranges.0.document_year'],
            'deux ans à l\'avance' => [['document_type' => 'PATIENT', 'quantity' => 10, 'document_year' => 2028], 'number_ranges.0.document_year'],
        ];
    }

    /**
     * @param  array<string, mixed>  $range
     */
    #[DataProvider('invalidRanges')]
    public function test_une_plage_invalide_est_refusee_sans_rien_reserver(array $range, string $field): void
    {
        $response = $this->prepareDevice($this->device, ['profiles' => [$this->reception->id], 'number_ranges' => [$range]]);

        $response->assertStatus(422);
        $this->assertSame(0, DB::table('document_number_allocations')->where('clinic_id', $this->clinicId)->count());
        $this->assertContains($field, array_keys((array) $response->json('error.fields')));
    }

    public function test_un_profil_sans_grant_actif_ou_sans_la_permission_de_la_serie_est_refuse(): void
    {
        // Le professionnel n'a aucun grant sur ce poste.
        $this->prepareDevice($this->device, ['profiles' => [$this->clinician->id], 'number_ranges' => [['document_type' => 'PATIENT', 'quantity' => 5]]])
            ->assertStatus(422)->assertJsonStructure(['error' => ['fields' => ['profiles.0']]]);

        // Grant révoqué ou expiré : refusé.
        $other = $this->seedDevice('Poste accueil (fictif)');
        $this->seedGrant($other, $this->reception, revokedAt: '2026-10-22 09:10:00.000000');
        $this->prepareDevice($other, ['profiles' => [$this->reception->id]])->assertStatus(422);
        $expired = $this->seedDevice('Poste ancien (fictif)');
        $this->seedGrant($expired, $this->reception, '2026-10-22 09:00:00.000000');
        $this->prepareDevice($expired, ['profiles' => [$this->reception->id]])->assertStatus(422);

        // L'accueil ne peut pas émettre de facture : aucune plage de factures pour lui.
        $this->prepareDevice($this->device, ['profiles' => [$this->reception->id], 'number_ranges' => [['document_type' => 'INVOICE', 'quantity' => 5]]])
            ->assertStatus(422)->assertJsonStructure(['error' => ['fields' => ['number_ranges.0.document_type']]]);
        $this->assertSame(0, DB::table('document_number_allocations')->where('clinic_id', $this->clinicId)->count());
    }

    public function test_une_facture_emise_attribuee_au_poste_n_est_plus_encaissee_par_l_api_centrale(): void
    {
        [$invoice] = $this->issuedUncollectedInvoice();

        $response = $this->prepareDevice($this->device, ['profiles' => [$this->cashier->id], 'invoice_ids' => [$invoice]])->assertOk();

        $this->assertSame([['owner_id' => $response->json('data.write_owners.0.owner_id'), 'invoice_id' => $invoice, 'epoch' => 1]], $response->json('data.write_owners'));
        $this->assertSame('ACTIVE', DB::table('invoice_write_owners')->where('invoice_id', $invoice)->value('status'));
        // Un seul rédacteur financier : la route directe refuse l'encaissement de cette facture.
        $session = $this->openedSession($this->cashier);
        $this->pay($invoice, $this->ledgerVersion($invoice), 1000, 'CASH', ['cash_session_id' => $session], $this->cashier)->assertStatus(409);
    }

    public function test_une_facture_deja_attribuee_ou_non_emise_n_est_pas_attribuee(): void
    {
        config(['eeo.offline.single_financial_device' => false]);
        [$invoice] = $this->issuedInvoice();
        $this->prepareDevice($this->device, ['profiles' => [$this->cashier->id], 'invoice_ids' => [$invoice]])->assertOk();

        $other = $this->seedDevice('Seconde caisse (fictive)');
        $this->seedGrant($other, $this->cashier);
        $this->prepareDevice($other, ['profiles' => [$this->cashier->id], 'invoice_ids' => [$invoice]])
            ->assertStatus(409)->assertJsonPath('error.details.current_status', 'WRITE_OWNER_ACTIVE');

        [$draft] = $this->draft();
        $this->prepareDevice($this->device, ['profiles' => [$this->cashier->id], 'invoice_ids' => [$draft]])->assertStatus(409);
        $this->assertSame(1, DB::table('invoice_write_owners')->where('clinic_id', $this->clinicId)->count());
    }

    public function test_une_seule_caisse_hors_ligne_principale_detient_des_ressources_financieres(): void
    {
        $this->prepareDevice($this->device, ['profiles' => [$this->cashier->id], 'number_ranges' => [['document_type' => 'RECEIPT', 'quantity' => 50]]])->assertOk();

        $other = $this->seedDevice('Seconde caisse (fictive)');
        $this->seedGrant($other, $this->cashier);
        $this->seedGrant($other, $this->reception);
        $this->prepareDevice($other, ['profiles' => [$this->cashier->id], 'number_ranges' => [['document_type' => 'RECEIPT', 'quantity' => 50]]])
            ->assertStatus(409)->assertJsonPath('error.details.current_status', 'FINANCIAL_DEVICE_ELSEWHERE');
        // Une série administrative reste possible sur un second poste (accueil).
        $this->prepareDevice($other, ['profiles' => [$this->reception->id], 'number_ranges' => [['document_type' => 'PATIENT', 'quantity' => 20]]])->assertOk();
    }

    public function test_un_quota_retire_le_disponible_central_sans_toucher_au_physique(): void
    {
        // Fichier 19 : physique 5, quota A 3 → disponible central 2, local 3.
        $position = $this->seedPosition($this->item['frame'], '5.000');

        $response = $this->prepareDevice($this->device, [
            'profiles' => [$this->cashier->id],
            'stock_quotas' => [['stock_position_id' => $position, 'stock_lot_id' => null, 'quantity' => '3']],
        ])->assertOk();

        $row = DB::table('stock_positions')->where('id', $position)->first();
        $this->assertSame('5.000', (string) $row->on_hand);
        $this->assertSame('3.000', (string) $row->offline_allocated);
        $this->assertSame('2.000', (string) $row->central_available);
        $this->assertSame('3.000', $response->json('data.stock_allocations.0.allocated_quantity'));
        $this->assertSame($this->item['frame'], $response->json('data.stock_allocations.0.item_id'));

        // Plus que le disponible central : refusé, rien ne bouge.
        $this->prepareDevice($this->device, [
            'profiles' => [$this->cashier->id],
            'stock_quotas' => [['stock_position_id' => $position, 'stock_lot_id' => null, 'quantity' => '3']],
        ])->assertStatus(409)->assertJsonPath('error.details.current_status', 'STOCK_UNAVAILABLE');
        $this->assertSame('3.000', (string) DB::table('stock_positions')->where('id', $position)->value('offline_allocated'));
        $this->assertSame(1, DB::table('device_stock_allocations')->where('clinic_id', $this->clinicId)->count());
    }

    public function test_un_lot_qui_n_appartient_pas_a_la_position_est_refuse(): void
    {
        $position = $this->seedPosition($this->item['drops'], '4.000');
        $otherPosition = $this->seedPosition($this->item['frame'], '4.000');
        $lot = $this->seedLot($otherPosition, $this->item['frame'], 'LOT-FICTIF-1', null, '4.000');

        $this->prepareDevice($this->device, [
            'profiles' => [$this->cashier->id],
            'stock_quotas' => [['stock_position_id' => $position, 'stock_lot_id' => $lot, 'quantity' => '1']],
        ])->assertStatus(422);
    }

    public function test_droits_module_et_reauthentification(): void
    {
        $body = ['profiles' => [$this->reception->id], 'number_ranges' => [['document_type' => 'PATIENT', 'quantity' => 5]]];
        $this->prepareDevice($this->device, $body, $this->cashier)->assertForbidden();
        $this->prepareDevice($this->device, $body, $this->reception)->assertForbidden();
        $this->prepareDevice($this->device, $body, reauthenticated: false)->assertStatus(423);

        config(['eeo.enabled_modules' => ['sales', 'stock']]);
        $this->prepareDevice($this->device, $body)->assertNotFound();
        $this->assertSame(0, DB::table('document_number_allocations')->where('clinic_id', $this->clinicId)->count());
    }

    public function test_la_preparation_se_relit_avec_le_catalogue_fige_sans_cout_d_achat(): void
    {
        $this->prepareDevice($this->device, ['profiles' => [$this->reception->id], 'number_ranges' => [['document_type' => 'PATIENT', 'quantity' => 5]]])->assertOk();

        $response = $this->actingAsFresh($this->manager)->getJson('/api/v1/devices/'.$this->device.'/preparation')->assertOk();
        $this->assertMatchesContract($response, self::SCHEMA);
        $this->assertCount(4, $response->json('data.catalog.snapshot.items'));
        $this->assertStringNotContainsString('purchase', (string) $response->getContent());
        $this->assertSame('0', $response->json('data.last_accepted_sequence'));
        $this->assertCount(2, $response->json('data.grants'));
    }

    public function test_un_poste_inactif_ou_d_un_autre_cabinet_ne_recoit_rien(): void
    {
        DB::table('enrolled_devices')->where('id', $this->device)->update(['status' => 'REVOKED']);
        $this->prepareDevice($this->device, ['profiles' => [$this->reception->id]])->assertStatus(409);

        $this->prepareDevice('01J9ZXK4M2Q8R7S6T5V4W3X9YZ', ['profiles' => [$this->reception->id]])->assertNotFound();
    }
}
