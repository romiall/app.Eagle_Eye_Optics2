<?php

namespace Tests\Feature\Offline;

use App\Domain\Shared\Ulid;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Tests\Support\BillingFixtures;
use Tests\Support\MigratedDatabase;
use Tests\Support\OfflineResourceFixtures;
use Tests\Support\SyncFixtures;
use Tests\TestCase;

/**
 * Remplacement d'un poste et reprise de son journal exporté (O07 ; fichier 19 ; fiche O07 « Mêmes IDs/numéros pour
 * anciens faits », « Aucun clone actif des droits non consommés », « Ancien poste réapparu passe en revue » ; AT39,
 * AT44) sur MySQL réel, avec une VRAIE clé ES256 pour l'ancien poste :
 *
 *  - déclaration : ancien poste REPLACED, grants révoqués, plages CLOSING ; refus d'un second remplacement, d'un
 *    remplacement par lui-même ou par un poste inconnu ;
 *  - reprise : la gérante transmet les commandes signées de l'ancien poste TELLES QUELLES, appliquées avec leurs
 *    numéros d'origine ; un rejeu ne double rien ; seule la gérante reprend, et seulement après la déclaration ;
 *  - réconciliation : refusée tant que le journal exporté n'est pas finalisé ; ensuite plages CLOSED et numéros
 *    inutilisés UNUSED (jamais recyclés) ;
 *  - l'ancien poste réapparu : ses commandes nouvelles passent en revue, jamais appliquées d'office.
 *
 * Données fictives ; horloge figée à 09 h 30 UTC le 22/10/2026 (BillingFixtures).
 */
final class DeviceReplacementTest extends TestCase
{
    use BillingFixtures;
    use MigratedDatabase;
    use OfflineResourceFixtures;
    use SyncFixtures;

    private string $oldDevice;

    private string $newDevice;

    private string $receptionGrant;

    private string $patientRange;

    protected function setUp(): void
    {
        parent::setUp();
        $this->bootBilling(['patients', 'sales', 'stock', 'offline']);
        $this->oldDevice = $this->signingDevice('Caisse perdue (fictive)');
        $this->receptionGrant = $this->seedGrant($this->oldDevice, $this->reception);
        $this->patientRange = $this->seedRange($this->receptionGrant, 'PATIENT', 101, 150);
        $this->newDevice = $this->seedDevice('Caisse neuve (fictive)');
    }

    protected function tearDown(): void
    {
        $this->resetClock();
        parent::tearDown();
    }

    /**
     * @param  array<string, mixed>  $body
     */
    private function deviceCommand(string $action, string $deviceId, array $body, ?User $as = null): TestResponse
    {
        return $this->actingAsReauthenticated($as ?? $this->manager)
            ->withHeaders(['Idempotency-Key' => Ulid::generate()])
            ->postJson('/api/v1/devices/'.$deviceId.'/'.$action, array_merge(['expected_version' => null], $body));
    }

    private function replace(?string $replacement = null): TestResponse
    {
        return $this->deviceCommand('replace', $this->oldDevice, [
            'replacement_device_id' => $replacement ?? $this->newDevice,
            'reason' => 'Poste de caisse perdu (test)',
        ]);
    }

    /**
     * @param  list<array{core: array<string, mixed>, event_hash: string, signature: string}>  $commands
     */
    private function recoveredPush(array $commands, ?User $as = null): TestResponse
    {
        return $this->actingAsReauthenticated($as ?? $this->manager)
            ->postJson('/api/v1/devices/'.$this->oldDevice.'/recovered-push', [
                'device_id' => $this->oldDevice,
                'commands' => $commands,
            ]);
    }

    /**
     * Fiche patient créée par l'ancien poste avant sa perte (numéro de SA plage), telle qu'elle figure dans l'export.
     *
     * @return array{command: array{core: array<string, mixed>, event_hash: string, signature: string}, patient: string}
     */
    private function exportedPatient(): array
    {
        $patient = $this->patientPayload('EE-2026-0101');

        return [
            'patient' => (string) $patient['patient_id'],
            'command' => $this->signed('CreatePatient', $patient, 'patient_records', (string) $patient['patient_id'], $this->reception, $this->receptionGrant, null, $this->patientRange),
        ];
    }

    public function test_reprise_complete_avec_les_numeros_d_origine_puis_cloture_sans_recycler(): void
    {
        ['command' => $command, 'patient' => $patient] = $this->exportedPatient();

        $this->replace()->assertOk()
            ->assertJsonPath('data.status', 'REPLACED')
            ->assertJsonPath('data.revoked_grants', 1);
        $this->assertSame('REPLACED', DB::table('enrolled_devices')->where('id', $this->oldDevice)->value('status'));
        $this->assertSame($this->newDevice, DB::table('enrolled_devices')->where('id', $this->oldDevice)->value('replaced_by_device_id'));
        $this->assertNotNull(DB::table('offline_grants')->where('id', $this->receptionGrant)->value('revoked_at'));
        $this->assertSame('CLOSING', DB::table('document_number_allocations')->where('id', $this->patientRange)->value('status'));

        $this->recoveredPush([$command])->assertOk()
            ->assertJsonPath('results.0.status', 'ACCEPTED')
            ->assertJsonPath('finalized_prefix.last_sequence', '1');
        $this->assertSame('EE-2026-0101', DB::table('patient_records')->where('id', $patient)->value('record_number'));

        // Rejeu du même export : aucun second fait.
        $this->recoveredPush([$command])->assertOk()->assertJsonPath('results.0.status', 'ALREADY_ACCEPTED');
        $this->assertSame(1, DB::table('patient_records')->where('id', $patient)->count());

        $this->deviceCommand('reconcile-replacement', $this->oldDevice, [
            'last_device_sequence' => '1',
            'last_event_hash' => $command['event_hash'],
            'reason' => 'Reprise complète de l’export (test)',
        ])->assertOk()->assertJsonPath('data.closed_number_allocations', [$this->patientRange]);

        $this->assertSame('CLOSED', DB::table('document_number_allocations')->where('id', $this->patientRange)->value('status'));
        // 49 numéros inutilisés de l'ancienne plage conservés, jamais réattribués.
        $this->assertSame(49, DB::table('document_number_usages')->where('allocation_id', $this->patientRange)->where('status', 'UNUSED')->count());
        $this->assertSame('REPLACED', DB::table('enrolled_devices')->where('id', $this->oldDevice)->value('status'));
    }

    public function test_la_cloture_attend_la_reprise_complete_du_journal_exporte(): void
    {
        ['command' => $command] = $this->exportedPatient();
        $this->replace()->assertOk();

        $this->deviceCommand('reconcile-replacement', $this->oldDevice, [
            'last_device_sequence' => '1',
            'last_event_hash' => $command['event_hash'],
            'reason' => 'Clôture trop tôt (test)',
        ])->assertStatus(409)->assertJsonPath('error.details.current_status', 'SYNC_INCOMPLETE');

        $this->assertSame('CLOSING', DB::table('document_number_allocations')->where('id', $this->patientRange)->value('status'));
        $this->assertSame(0, DB::table('document_number_usages')->where('allocation_id', $this->patientRange)->count());
    }

    public function test_refus_du_remplacement_et_de_la_reprise(): void
    {
        ['command' => $command] = $this->exportedPatient();

        // Reprise avant la déclaration du remplacement : refusée, rien n'est stocké.
        $this->recoveredPush([$command])->assertStatus(409);
        $this->replace($this->oldDevice)->assertStatus(422);
        $this->replace(Ulid::generate())->assertStatus(422);

        $this->replace()->assertOk();
        $this->replace()->assertStatus(409)->assertJsonPath('error.details.current_status', 'REPLACED');

        // Seule la gérante reprend le journal d'un poste remplacé.
        $this->recoveredPush([$command], $this->cashier)->assertForbidden();
        $this->assertSame(0, DB::table('sync_commands')->count());
        $this->assertSame(0, DB::table('patient_records')->where('record_number', 'EE-2026-0101')->count());
    }

    public function test_l_ancien_poste_reapparu_passe_en_revue(): void
    {
        ['command' => $command, 'patient' => $patient] = $this->exportedPatient();
        $this->replace()->assertOk();

        // L'ancien poste, qui ignore son remplacement, envoie lui-même sa commande : en revue, rien n'est appliqué.
        $this->push([$command], $this->reception)->assertOk()
            ->assertJsonPath('results.0.status', 'CONFLICT_REQUIRES_REVIEW');
        $this->assertSame(0, DB::table('patient_records')->where('id', $patient)->count());
        $this->assertSame(1, DB::table('sync_conflicts')->where('status', 'OPEN')->count());

        // Il ne reçoit plus de données.
        $this->actingAsFresh($this->reception)
            ->getJson('/api/v1/sync/pull?device_id='.$this->oldDevice)
            ->assertForbidden();
    }
}
