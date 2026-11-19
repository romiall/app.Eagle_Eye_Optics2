<?php

namespace Tests\Feature\Offline;

use App\Domain\Shared\Ulid;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Tests\Support\BillingFixtures;
use Tests\Support\MigratedDatabase;
use Tests\Support\OfflineResourceFixtures;
use Tests\TestCase;

/**
 * Clôture des ressources d'un poste APRÈS reprise complète (O03 ; fichier 19 ; fiche O03 « Restituer seulement après
 * reprise complète, jamais à expiration simple », « release prématuré refusé ») : préfixe finalisé du journal exigé,
 * aucune commande reçue non finalisée, poste perdu refusé, numéros inutilisés inscrits UNUSED (jamais recyclés),
 * reliquats de quota rendus au disponible central, propriétés de facture closes ; un grant expiré ne libère rien.
 * Données fictives.
 */
final class ReleaseResourcesTest extends TestCase
{
    use BillingFixtures;
    use MigratedDatabase;
    use OfflineResourceFixtures;

    private string $device;

    private string $position;

    private string $invoice;

    protected function setUp(): void
    {
        parent::setUp();
        $this->bootBilling(['sales', 'stock', 'offline']);
        $this->device = $this->seedDevice('Caisse principale (fictive)');
        $this->seedGrant($this->device, $this->cashier);
        $this->position = $this->seedPosition($this->item['frame'], '5.000');
        [$this->invoice] = $this->issuedUncollectedInvoice();
        $this->prepareDevice($this->device, [
            'profiles' => [$this->cashier->id],
            'number_ranges' => [['document_type' => 'RECEIPT', 'quantity' => 10]],
            'stock_quotas' => [['stock_position_id' => $this->position, 'stock_lot_id' => null, 'quantity' => '3']],
            'invoice_ids' => [$this->invoice],
        ])->assertOk();
    }

    protected function tearDown(): void
    {
        $this->resetClock();
        parent::tearDown();
    }

    public function test_une_restitution_prematuree_est_refusee_et_ne_libere_rien(): void
    {
        // Le poste annonce 3 commandes ; le serveur n'en a finalisé aucune.
        $this->releaseDevice($this->device, ['last_device_sequence' => '3', 'last_event_hash' => str_repeat('a', 64)])
            ->assertStatus(409)->assertJsonPath('error.details.current_status', 'SYNC_INCOMPLETE');

        // Une commande reçue au-delà du préfixe finalisé : refusé aussi.
        DB::table('sync_commands')->insert([
            'id' => Ulid::generate(), 'clinic_id' => $this->clinicId, 'device_id' => $this->device, 'actor_id' => $this->cashier->id,
            'grant_id' => (string) DB::table('offline_grants')->where('device_id', $this->device)->value('id'),
            'device_sequence' => 1, 'previous_event_hash' => null, 'event_hash' => str_repeat('b', 64), 'signature' => 'test.test.test',
            'schema_version' => '1', 'rules_version' => 'test', 'command_name' => 'RegisterPayment',
            'occurred_at_local' => '2026-10-22 09:20:00.000000', 'last_server_time' => '2026-10-22 09:00:00.000000',
            'entity_type' => 'payments', 'entity_id' => Ulid::generate(), 'expected_version' => null, 'number_allocation_id' => null,
            'payload_ciphertext' => 'chiffre', 'encryption_key_id' => 'test', 'received_at' => '2026-10-22 09:25:00.000000',
        ]);
        $this->releaseDevice($this->device)->assertStatus(409)->assertJsonPath('error.details.current_status', 'SYNC_INCOMPLETE');

        $this->assertSame('ACTIVE', DB::table('document_number_allocations')->where('device_id', $this->device)->value('status'));
        $this->assertSame('ACTIVE', DB::table('invoice_write_owners')->where('device_id', $this->device)->value('status'));
        $this->assertSame('3.000', (string) DB::table('stock_positions')->where('id', $this->position)->value('offline_allocated'));
    }

    public function test_apres_reprise_complete_tout_est_restitue_sans_recycler_un_numero(): void
    {
        $range = DB::table('document_number_allocations')->where('device_id', $this->device)->first();
        $this->assertNotNull($range);
        // Deux numéros consommés par le poste et déjà synchronisés (usage enregistré par O05).
        foreach ([(int) $range->range_start, (int) $range->range_start + 1] as $value) {
            DB::table('document_number_usages')->insert([
                'id' => Ulid::generate(), 'clinic_id' => $this->clinicId, 'allocation_id' => $range->id, 'document_type' => 'RECEIPT',
                'document_year' => 2026, 'number_value' => $value, 'rendered_number' => sprintf('TEST-REC-2026-%06d', $value),
                'entity_type' => 'receipts', 'entity_id' => Ulid::generate(), 'source_device_id' => $this->device, 'actor_id' => $this->cashier->id,
                'consumed_at' => '2026-10-22 09:20:00.000000', 'status' => 'USED',
            ]);
        }

        $response = $this->releaseDevice($this->device)->assertOk();

        $closed = DB::table('document_number_allocations')->where('id', $range->id)->first();
        $this->assertSame('CLOSED', $closed->status);
        $this->assertSame((int) $range->range_start + 1, (int) $closed->last_consumed_value);
        // Huit numéros inutilisés conservés, jamais recyclés ; la séquence centrale reste au-delà de la plage.
        $this->assertSame(8, DB::table('document_number_usages')->where('allocation_id', $range->id)->where('status', 'UNUSED')->count());
        $this->assertSame((int) $range->range_end, (int) DB::table('document_sequences')->where('clinic_id', $this->clinicId)->where('document_type', 'RECEIPT')->value('last_value'));

        $this->assertSame('CLOSED', DB::table('invoice_write_owners')->where('device_id', $this->device)->value('status'));
        $this->assertSame(0, (int) DB::table('invoice_write_owners')->where('device_id', $this->device)->value('final_device_sequence'));
        $quota = DB::table('device_stock_allocations')->where('device_id', $this->device)->first();
        $this->assertSame('CLOSED', $quota->status);
        $this->assertSame('3.000', (string) $quota->returned_quantity);
        $this->assertSame('0.000', (string) DB::table('stock_positions')->where('id', $this->position)->value('offline_allocated'));
        $this->assertSame([$range->id], $response->json('data.closed_number_allocations'));

        // La facture redevient encaissable par la route directe ; un nouveau reçu central est hors de l'ancienne plage.
        $session = $this->openedSession($this->cashier);
        $payment = $this->pay($this->invoice, $this->ledgerVersion($this->invoice), 1000, 'CASH', ['cash_session_id' => $session], $this->cashier)->assertCreated();
        $this->assertSame(sprintf('TEST-REC-2026-%06d', (int) $range->range_end + 1), $payment->json('data.receipt_number'));
    }

    public function test_un_poste_perdu_ne_se_restitue_pas_automatiquement(): void
    {
        DB::table('enrolled_devices')->where('id', $this->device)->update(['status' => 'LOST']);

        $this->releaseDevice($this->device)->assertStatus(409);
        $this->assertSame('ACTIVE', DB::table('document_number_allocations')->where('device_id', $this->device)->value('status'));
    }

    public function test_un_grant_expire_ne_libere_ni_plage_ni_quota_ni_propriete(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-11-30 09:30:00', 'UTC'));

        $response = $this->actingAsFresh($this->manager)->getJson('/api/v1/devices/'.$this->device.'/preparation')->assertOk();

        $this->assertSame([], $response->json('data.grants'));
        $this->assertCount(1, $response->json('data.number_allocations'));
        $this->assertCount(1, $response->json('data.stock_allocations'));
        $this->assertCount(1, $response->json('data.write_owners'));
    }
}
