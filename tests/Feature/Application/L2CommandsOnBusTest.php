<?php

namespace Tests\Feature\Application;

use App\Application\CommandBusProbe;
use App\Application\CommandRegistry;
use App\Domain\Shared\CommandSource;
use App\Domain\Shared\Ulid;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Tests\Support\AgendaFixtures;
use Tests\Support\Commands\RecordingProbe;
use Tests\Support\MigratedDatabase;
use Tests\TestCase;

/**
 * Les écritures de la couche L2 (intégrations, CRM, base de connaissances, communication, réservations publiques)
 * passent par le chemin central, comme le reste de l'application (F07) : un seul chemin pour le verrou du cabinet, les
 * droits relus sous ce verrou, l'idempotence et le rejeu d'une réponse perdue. MutationRoutesTest dit QUELLES routes
 * sont des commandes ; ce test prouve ce que cela veut dire à l'exécution, sur le prospect (CRM) comme exemple.
 */
final class L2CommandsOnBusTest extends TestCase
{
    use AgendaFixtures;
    use MigratedDatabase;

    /** Les 22 noms de commande de la couche L2, un par intention de la route directe. */
    private const L2_COMMANDS = [
        'SaveIntegrationAccount', 'SaveCalendarSyncState', 'ConfirmPublicBooking', 'RejectPublicBooking',
        'SaveProspectContact', 'LinkProspectPatient', 'HandoffConversation', 'ResumeConversationBot',
        'SaveKnowledgeEntry', 'CreateKnowledgeVersion', 'ApproveKnowledgeVersion', 'PublishKnowledgeVersion',
        'RecordConsent', 'RevokeConsent', 'SaveMessageTemplate', 'CreateMessageTemplateVersion',
        'ApproveMessageTemplateVersion', 'SaveReminderPolicy', 'SaveAudienceSegment', 'SaveCampaign',
        'FreezeCampaign', 'PauseCampaign',
    ];

    protected function setUp(): void
    {
        parent::setUp();
        $this->bootAgenda(['agenda', 'today', 'patients', 'communication', 'settings']);
        config(['eeo.integrations.mode' => 'fake']);
    }

    protected function tearDown(): void
    {
        $this->resetClock();
        parent::tearDown();
    }

    public function test_les_commandes_l2_sont_enregistrees_en_ligne_seulement_avec_cle_d_idempotence_obligatoire(): void
    {
        $registry = $this->app->make(CommandRegistry::class);

        foreach (self::L2_COMMANDS as $name) {
            $definition = $registry->definition($name);
            $this->assertSame([CommandSource::Direct], $definition->sources, $name.' : route directe seulement, jamais un poste.');
            $this->assertTrue($definition->idempotencyRequired, $name.' : la clé d\'idempotence est obligatoire.');
        }
    }

    public function test_une_ecriture_l2_prend_le_verrou_du_cabinet_et_termine_l_idempotence(): void
    {
        $probe = new RecordingProbe;
        $this->app->instance(CommandBusProbe::class, $probe);

        $this->createProspect($this->body('Verrou'), Ulid::generate())->assertCreated();

        $this->assertContains('clinic-locked', $probe->reached, 'Le verrou du cabinet est pris par le chemin central.');
        $this->assertContains('idempotency-completed', $probe->reached, 'Le chemin central termine la ligne d\'idempotence.');
    }

    public function test_la_meme_cle_rejoue_la_reponse_sans_second_prospect(): void
    {
        $key = Ulid::generate();
        $body = $this->body('Rejeu');

        $first = $this->createProspect($body, $key);
        $second = $this->createProspect($body, $key);

        $first->assertCreated();
        $second->assertCreated();
        $this->assertSame($first->json('data.id'), $second->json('data.id'), 'Une réponse perdue se rejoue : même prospect.');
        $this->assertSame(1, DB::table('prospect_contacts')->where('clinic_id', $this->clinicId)->count(), 'Aucun doublon.');
    }

    public function test_la_meme_cle_avec_un_autre_contenu_est_un_conflit(): void
    {
        $key = Ulid::generate();

        $this->createProspect($this->body('Premier'), $key)->assertCreated();
        $conflict = $this->createProspect($this->body('Second'), $key);

        $conflict->assertStatus(409);
        $this->assertSame('IDEMPOTENCY_PAYLOAD_MISMATCH', $conflict->json('error.code'));
        $this->assertSame(1, DB::table('prospect_contacts')->where('clinic_id', $this->clinicId)->count());
    }

    public function test_sans_cle_d_idempotence_l_ecriture_est_refusee_et_rien_n_est_ecrit(): void
    {
        $response = $this->actingAsFresh($this->reception)->postJson('/api/v1/crm/prospects', $this->body('Sans clé'));

        $response->assertStatus(422);
        $this->assertSame('VALIDATION_FAILED', $response->json('error.code'));
        $this->assertSame(0, DB::table('prospect_contacts')->where('clinic_id', $this->clinicId)->count());
    }

    public function test_les_droits_sont_juges_par_le_chemin_central_pour_un_compte_sans_droit(): void
    {
        // Un caissier n'a ni communication.manage ni agenda.write : refusé avant toute écriture.
        $response = $this->actingAsFresh($this->cashier)
            ->withHeaders(['Idempotency-Key' => Ulid::generate()])
            ->postJson('/api/v1/crm/prospects', $this->body('Interdit'));

        $response->assertForbidden();
        $this->assertSame(0, DB::table('prospect_contacts')->where('clinic_id', $this->clinicId)->count());
    }

    /**
     * @param  array<string, mixed>  $body
     */
    private function createProspect(array $body, string $key): TestResponse
    {
        return $this->actingAsFresh($this->reception)->withHeaders(['Idempotency-Key' => $key])->postJson('/api/v1/crm/prospects', $body);
    }

    /**
     * @return array<string, mixed>
     */
    private function body(string $name): array
    {
        return [
            'name' => 'Prospect '.$name,
            'phone' => '+237 699 00 12 34',
            'email' => null,
            'origin' => 'WEBSITE',
            'administrative_notes' => 'Données fictives.',
        ];
    }
}
