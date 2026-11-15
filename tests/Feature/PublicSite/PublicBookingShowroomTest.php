<?php

namespace Tests\Feature\PublicSite;

use App\Domain\Shared\Ulid;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Tests\Support\AgendaFixtures;
use Tests\Support\MigratedDatabase;
use Tests\Support\ValidatesContracts;
use Tests\TestCase;

/**
 * Réservation publique reliée au showroom (L3D03, AT33, AT35) : une demande qui vient d'une référence publiée la garde
 * (jamais une référence inconnue ou en brouillon), un robot qui remplit le champ caché est refusé sans rien enregistrer et
 * sans fausse confirmation, et deux demandes pour le même créneau ne passent pas toutes les deux. L'énumération d'un
 * numéro de patient est jugée par GoogleCalendarAndPublicBookingTest. Données fictives.
 */
final class PublicBookingShowroomTest extends TestCase
{
    use AgendaFixtures;
    use MigratedDatabase;
    use ValidatesContracts;

    protected function setUp(): void
    {
        parent::setUp();
        $this->bootAgenda(['agenda', 'today', 'patients', 'consultations', 'communication']);
        config(['eeo.integrations.default_clinic_id' => $this->clinicId]);
        DB::table('appointment_services')->where('clinic_id', $this->clinicId)->where('id', $this->serviceId)->update(['public_booking' => true]);
    }

    protected function tearDown(): void
    {
        $this->resetClock();
        parent::tearDown();
    }

    private function publication(string $slug, string $status = 'PUBLISHED'): string
    {
        $itemId = Ulid::generate();
        DB::table('catalog_items')->insert([
            'id' => $itemId, 'clinic_id' => $this->clinicId, 'reference' => 'ART-'.substr($itemId, -8), 'category_code' => 'OTHER', 'name' => 'Monture fictive',
            'brand' => null, 'model' => null, 'unit_code' => 'UNIT', 'quantity_integer_only' => 1, 'sale_price' => 45000, 'purchase_cost' => null,
            'tax_rule_id' => null, 'stock_mode' => 'NONE', 'requires_expiry' => 0, 'low_stock_threshold' => null, 'expiry_alert_days' => null,
            'active' => 1, 'public_visibility' => 1, 'version' => 1, 'created_at' => '2026-10-01 08:00:00.000000', 'updated_at' => '2026-10-01 08:00:00.000000',
        ]);
        $id = Ulid::generate();
        $published = $status === 'PUBLISHED';
        DB::table('catalog_publications')->insert([
            'id' => $id, 'clinic_id' => $this->clinicId, 'catalog_item_id' => $itemId, 'slug' => $slug, 'public_title' => 'Monture fictive',
            'public_description' => 'Description publique fictive.', 'style' => null, 'show_sale_price' => 0, 'status' => $status, 'display_order' => 0,
            'approved_by' => $published ? $this->manager->id : null, 'published_at' => $published ? '2026-10-02 08:00:00.000000' : null, 'version' => 1,
            'created_at' => '2026-10-01 08:00:00.000000', 'updated_at' => '2026-10-01 08:00:00.000000',
        ]);

        return $id;
    }

    /**
     * @param  array<string, mixed>  $overrides
     */
    private function request(string $startsAt, array $overrides = [], ?string $key = null): TestResponse
    {
        return $this->withHeaders(['Idempotency-Key' => $key ?? Ulid::generate()])->postJson('/public/v1/booking-requests', $overrides + [
            'service_id' => $this->serviceId,
            'resource_id' => $this->resourceId,
            'starts_at' => $startsAt,
            'name' => 'Visiteur Fictif',
            'phone' => '+237 699 00 11 22',
            'consent' => true,
        ]);
    }

    public function test_une_demande_venue_d_une_reference_publiee_la_garde_et_ignore_une_reference_inconnue_ou_en_brouillon(): void
    {
        $published = $this->publication('monture-publiee');
        $this->publication('monture-brouillon', 'DRAFT');

        $first = $this->request('2026-10-23T08:00:00.000Z', ['publication_slug' => 'monture-publiee']);
        $first->assertCreated();
        $this->assertMatchesContract($first, 'schemas/resources/public.json#/$defs/BookingReceiptResponse');
        $this->assertSame($published, DB::table('public_booking_requests')->where('public_reference', $first->json('data.public_reference'))->value('catalog_publication_id'));

        $draft = $this->request('2026-10-23T09:00:00.000Z', ['publication_slug' => 'monture-brouillon', 'phone' => '+237 699 00 11 23']);
        $unknown = $this->request('2026-10-23T09:30:00.000Z', ['publication_slug' => 'inconnue', 'phone' => '+237 699 00 11 24']);
        foreach ([$draft, $unknown] as $response) {
            $response->assertCreated();
            $this->assertNull(DB::table('public_booking_requests')->where('public_reference', $response->json('data.public_reference'))->value('catalog_publication_id'), 'Une référence non publiée ne se relie jamais.');
        }
    }

    public function test_le_piege_a_robots_refuse_la_demande_sans_rien_enregistrer_ni_fausse_confirmation(): void
    {
        $response = $this->request('2026-10-23T08:00:00.000Z', ['website' => 'https://exemple.invalid']);

        $response->assertStatus(422)->assertJsonPath('error.code', 'VALIDATION_FAILED')->assertJsonMissingPath('data');
        $this->assertSame(0, DB::table('public_booking_requests')->count());
        $this->assertSame(0, DB::table('prospect_contacts')->count());

        // Un visiteur qui ne voit pas le champ l'envoie vide ou absent : sa demande passe.
        $this->request('2026-10-23T08:00:00.000Z', ['website' => ''])->assertCreated();
        $this->request('2026-10-23T09:00:00.000Z', ['website' => null, 'phone' => '+237 699 00 11 23'])->assertCreated();
    }

    public function test_deux_demandes_pour_le_meme_creneau_ne_passent_pas_toutes_les_deux(): void
    {
        $this->request('2026-10-23T08:00:00.000Z')->assertCreated();
        $second = $this->request('2026-10-23T08:00:00.000Z', ['name' => 'Autre Visiteur', 'phone' => '+237 699 33 44 55']);

        $second->assertStatus(409)->assertJsonPath('error.code', 'SLOT_UNAVAILABLE');
        $this->assertSame(1, DB::table('public_booking_requests')->where('requested_starts_at', '2026-10-23 08:00:00.000000')->count());
    }
}
