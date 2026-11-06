<?php

namespace Tests\Feature\Offline;

use App\Domain\Shared\Ulid;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Tests\Support\BillingFixtures;
use Tests\Support\MigratedDatabase;
use Tests\Support\OfflineResourceFixtures;
use Tests\TestCase;

/**
 * Pull des changements publiés (O05 ; fichier 19 ; contrat 23 « publication pull transactionnelle » ; AT42) : pages
 * ordonnées du cabinet, compartiments = grant actif ∩ droits actuels (jamais CLINICAL sans droit clinique, même si le
 * grant était plus large), curseur opaque signé qui avance sur les entrées filtrées et lie poste et compte, projection
 * de l'entité (fiche patient, facture avec son solde). Données fictives.
 */
final class SyncPullTest extends TestCase
{
    use BillingFixtures;
    use MigratedDatabase;
    use OfflineResourceFixtures;

    private const PAGE = 'sync/pull-page.json';

    private string $device;

    protected function setUp(): void
    {
        parent::setUp();
        $this->bootBilling(['patients', 'sales', 'stock', 'offline']);
        $this->device = $this->seedDevice('Poste accueil et caisse (fictif)');
        $this->seedGrant($this->device, $this->cashier);
    }

    protected function tearDown(): void
    {
        $this->resetClock();
        parent::tearDown();
    }

    private function change(string $type, string $id, string $visibility, int $version = 1): void
    {
        DB::table('sync_change_log')->insert([
            'id' => Ulid::generate(), 'clinic_id' => $this->clinicId, 'entity_type' => $type, 'entity_id' => $id, 'entity_version' => $version,
            'recorded_at' => '2026-10-22 09:30:00.000000', 'visibility' => $visibility, 'change_kind' => 'UPDATED',
        ]);
    }

    private function pull(User $as, ?string $cursor = null, ?string $device = null): TestResponse
    {
        $query = 'device_id='.($device ?? $this->device).($cursor === null ? '' : '&cursor='.rawurlencode($cursor));

        return $this->actingAsFresh($as)->getJson('/api/v1/sync/pull?'.$query);
    }

    public function test_chaque_profil_ne_recoit_que_ses_compartiments_et_jamais_le_clinique_sans_droit(): void
    {
        // Grant de l'accueil PLUS LARGE que ses droits actuels (permission clinique figée) : le clinique reste masqué.
        $this->seedGrant($this->device, $this->reception, permissions: ['patient.read', 'patient.create', 'visit.register', 'clinical.read']);
        $this->change('consultations', Ulid::generate(), 'CLINICAL');
        $this->change('patient_records', $this->patientId, 'ADMINISTRATIVE');
        [$invoice] = $this->draft();

        $reception = $this->pull($this->reception)->assertOk();
        $this->assertMatchesContract($reception, self::PAGE);
        $this->assertSame(['patient_records'], array_values(array_unique(array_column($reception->json('changes'), 'entity_type'))));
        $this->assertSame($this->patientId, $reception->json('changes.0.data.id'));
        $this->assertSame('EE-2026-0001', $reception->json('changes.0.data.record_number'));

        $cashier = $this->pull($this->cashier)->assertOk();
        $this->assertMatchesContract($cashier, self::PAGE);
        $types = array_column($cashier->json('changes'), 'entity_type');
        $this->assertContains('invoices', $types);
        $this->assertNotContains('consultations', $types);
        $invoiceChange = collect($cashier->json('changes'))->firstWhere('entity_id', $invoice);
        $this->assertSame(15000, $invoiceChange['data']['total_gross']);
        $this->assertSame('FINANCIAL', $invoiceChange['visibility']);
        $this->assertArrayNotHasKey('purchase_cost', $invoiceChange['data']);
    }

    public function test_le_curseur_avance_sur_les_entrees_filtrees_et_ne_boucle_jamais(): void
    {
        config(['eeo.offline.pull_page_size' => 2]);
        $this->seedGrant($this->device, $this->reception);
        $this->change('consultations', Ulid::generate(), 'CLINICAL');
        $this->change('invoices', Ulid::generate(), 'FINANCIAL');
        $this->change('patient_records', $this->patientId, 'ADMINISTRATIVE');

        $first = $this->pull($this->reception)->assertOk();
        $this->assertSame([], $first->json('changes'), 'les deux premières entrées sont masquées à l\'accueil');
        $this->assertTrue($first->json('has_more'));

        $second = $this->pull($this->reception, (string) $first->json('next_cursor'))->assertOk();
        $this->assertSame(['patient_records'], array_column($second->json('changes'), 'entity_type'));
        $this->assertFalse($second->json('has_more'));

        $third = $this->pull($this->reception, (string) $second->json('next_cursor'))->assertOk();
        $this->assertSame([], $third->json('changes'));
        $this->assertSame($second->json('next_cursor'), $third->json('next_cursor'), 'aucune entrée nouvelle : même borne');
    }

    public function test_des_commits_entrelaces_entre_deux_pages_ne_font_ni_sauter_ni_rejouer_un_changement(): void
    {
        // « Pull avec commits entrelacés » (fiche O05) : d'autres mutations du cabinet committent entre deux pages ; leur
        // numéro dépasse toute borne déjà rendue, la page suivante les trouve, une seule fois, dans l'ordre.
        config(['eeo.offline.pull_page_size' => 2]);
        $this->seedGrant($this->device, $this->reception);
        $ids = [Ulid::generate(), Ulid::generate(), Ulid::generate(), Ulid::generate(), Ulid::generate()];
        foreach (array_slice($ids, 0, 3) as $id) {
            $this->change('patient_records', $id, 'ADMINISTRATIVE');
        }

        $one = $this->pull($this->reception)->assertOk();
        $this->assertSame([$ids[0], $ids[1]], array_column($one->json('changes'), 'entity_id'));
        $this->assertTrue($one->json('has_more'));

        $this->change('patient_records', $ids[3], 'ADMINISTRATIVE');
        $this->change('patient_records', $ids[4], 'ADMINISTRATIVE');

        $two = $this->pull($this->reception, (string) $one->json('next_cursor'))->assertOk();
        $this->assertSame([$ids[2], $ids[3]], array_column($two->json('changes'), 'entity_id'));
        $this->assertTrue($two->json('has_more'));

        $three = $this->pull($this->reception, (string) $two->json('next_cursor'))->assertOk();
        $this->assertSame([$ids[4]], array_column($three->json('changes'), 'entity_id'));
        $this->assertFalse($three->json('has_more'));

        // Chaque changement est rendu une seule fois, dans l'ordre de publication ; la page suivante est vide.
        $sequences = array_map('intval', [...array_column($one->json('changes'), 'change_sequence'), ...array_column($two->json('changes'), 'change_sequence'), ...array_column($three->json('changes'), 'change_sequence')]);
        $sorted = $sequences;
        sort($sorted);
        $this->assertSame($sorted, $sequences);
        $this->assertCount(5, array_unique($sequences));
        $this->assertSame([], $this->pull($this->reception, (string) $three->json('next_cursor'))->assertOk()->json('changes'));

        // Le rejeu d'une page déjà reçue (réponse perdue) rend les mêmes changements : le poste ne perd rien.
        $replay = $this->pull($this->reception, (string) $one->json('next_cursor'))->assertOk();
        $this->assertSame([$ids[2], $ids[3]], array_column($replay->json('changes'), 'entity_id'));
        $this->assertSame($two->json('next_cursor'), $replay->json('next_cursor'));
    }

    public function test_un_curseur_altere_ou_d_un_autre_profil_est_refuse(): void
    {
        $this->seedGrant($this->device, $this->reception);
        $this->change('patient_records', $this->patientId, 'ADMINISTRATIVE');
        $cursor = (string) $this->pull($this->reception)->assertOk()->json('next_cursor');

        $this->pull($this->cashier, $cursor)->assertStatus(422)->assertJsonPath('error.code', 'VALIDATION_FAILED');
        [$body, $mac] = explode('.', $cursor);
        $this->pull($this->reception, $body.'.'.strrev($mac))->assertStatus(422);
        $other = $this->seedDevice('Autre poste (fictif)');
        $this->seedGrant($other, $this->reception);
        $this->pull($this->reception, $cursor, $other)->assertStatus(422);
    }

    public function test_un_grant_actif_du_compte_sur_ce_poste_est_exige(): void
    {
        $this->pull($this->clinician)->assertForbidden()->assertJsonPath('error.code', 'GRANT_EXPIRED_OR_REVOKED');

        $this->seedGrant($this->device, $this->reception, revokedAt: '2026-10-22 09:15:00.000000');
        $this->pull($this->reception)->assertForbidden();

        $this->pull($this->cashier, null, Ulid::generate())->assertNotFound();
        $this->actingAsFresh($this->cashier)->getJson('/api/v1/sync/pull')->assertStatus(422);

        config(['eeo.enabled_modules' => ['patients', 'sales', 'stock']]);
        $this->pull($this->cashier)->assertNotFound();
    }
}
