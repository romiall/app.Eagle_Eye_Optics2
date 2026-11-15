<?php

declare(strict_types=1);

namespace Tests\Feature\Communication;

use App\Application\Contracts\ContractValidator;
use App\Domain\Access\Approvals\ApprovalSubject;
use App\Domain\Shared\Ulid;
use App\Models\User;
use App\Support\Integrations\Messaging\FakeMessagingClient;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Tests\Support\AccessFixtures;
use Tests\Support\ApprovalFixtures;
use Tests\Support\MigratedDatabase;
use Tests\Support\PatientFixtures;
use Tests\Support\ValidatesContracts;
use Tests\TestCase;

final class CampaignsTest extends TestCase
{
    use AccessFixtures;
    use ApprovalFixtures;
    use MigratedDatabase;
    use PatientFixtures;
    use ValidatesContracts;

    protected string $clinicId;

    protected User $manager;

    protected User $operator;

    protected string $patientEligibleOne;

    protected string $patientEligibleTwo;

    protected string $patientOptedOut;

    protected string $patientOtherCity;

    protected string $templateVersionId;

    protected function setUp(): void
    {
        parent::setUp();

        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-10-22 09:30:00', 'UTC'));
        config(['eeo.enabled_modules' => ['communication', 'patients', 'settings']]);
        $this->app->singleton(FakeMessagingClient::class);

        $this->clinicId = $this->makeClinic();
        $this->manager = $this->makeStaff($this->clinicId, 'MANAGER', 'gerante.test');
        $this->operator = $this->makeStaff($this->clinicId, 'RECEPTION', 'comms.test');
        DB::table('user_permissions')->insert([
            'id' => Ulid::generate(),
            'clinic_id' => $this->clinicId,
            'user_id' => $this->operator->id,
            'permission_code' => 'communication.manage',
            'allowed' => 1,
            'assigned_by' => $this->manager->id,
            'expires_at' => null,
            'reason' => 'Opérateur campagnes',
            'created_at' => '2026-10-22 09:30:00.000000',
            'updated_at' => '2026-10-22 09:30:00.000000',
        ]);

        $this->patientEligibleOne = $this->seedPatient($this->clinicId, 'Mbarga', 'Alice', [
            'address' => 'Bonapriso, Douala',
            'phone_primary' => '690100001',
            'phone_primary_normalized' => '690100001',
        ]);
        $this->patientEligibleTwo = $this->seedPatient($this->clinicId, 'Tchuenté', 'Marc', [
            'address' => 'Akwa, Douala',
            'phone_primary' => '690100002',
            'phone_primary_normalized' => '690100002',
        ]);
        $this->patientOptedOut = $this->seedPatient($this->clinicId, 'Essomba', 'Luc', [
            'address' => 'Makepe, Douala',
            'phone_primary' => '690100003',
            'phone_primary_normalized' => '690100003',
        ]);
        $this->patientOtherCity = $this->seedPatient($this->clinicId, 'Biya', 'Claire', [
            'address' => 'Bastos, Yaoundé',
            'phone_primary' => '690100004',
            'phone_primary_normalized' => '690100004',
        ]);

        // Consentements MARKETING : patients 1 & 2 GRANTED, patient 3 REVOKED, patient Yaoundé GRANTED.
        foreach ([
            [$this->patientEligibleOne, '+237690100001', false],
            [$this->patientEligibleTwo, '+237690100002', false],
            [$this->patientOptedOut, '+237690100003', true],
            [$this->patientOtherCity, '+237690100004', false],
        ] as [$pid, $phone, $revoke]) {
            $this->write('POST', '/api/v1/communication/consents', [
                'patient_id' => $pid,
                'channel' => 'SMS',
                'purpose' => 'MARKETING',
                'destination' => $phone,
                'proof' => 'Formulaire campagne',
            ], $this->operator)->assertCreated();

            if ($revoke) {
                $this->write('POST', '/api/v1/communication/consents/revoke', [
                    'patient_id' => $pid,
                    'channel' => 'SMS',
                    'purpose' => 'MARKETING',
                    'destination' => $phone,
                    'proof' => 'Opt-out accueil',
                ], $this->operator)->assertCreated();
            }
        }

        $this->seedSmsAccount($this->clinicId);
        $tpl = $this->write('POST', '/api/v1/communication/templates', [
            'code' => 'PROMO_PRINTEMPS',
            'channel' => 'SMS',
            'purpose' => 'MARKETING',
        ], $this->manager)->assertCreated();
        $tplId = (string) $tpl->json('data.id');

        $ver = $this->write('POST', '/api/v1/communication/templates/'.$tplId.'/versions', [
            'body' => 'Bonjour {{first_name}}, découvrez nos nouveautés chez {{clinic_name}}.',
            'allowed_variables' => ['first_name', 'clinic_name'],
        ], $this->manager)->assertCreated();
        $this->templateVersionId = (string) $ver->json('data.id');

        $this->write('POST', '/api/v1/communication/templates/versions/'.$this->templateVersionId.'/approve', [
            'reason' => 'Texte validé',
        ], $this->manager)->assertOk();
    }

    protected function tearDown(): void
    {
        CarbonImmutable::setTestNow();
        parent::tearDown();
    }

    public function test_segment_rejects_clinical_filter_and_campaign_requires_exact_approval_and_rechecks_opt_out(): void
    {
        // 1. Critère clinique interdit -> 422.
        $clinical = $this->write('POST', '/api/v1/communication/segments', [
            'name' => 'Segment interdit',
            'criteria' => ['city' => 'Douala', 'diagnosis' => 'myopie'],
        ], $this->operator);
        $clinical->assertStatus(422);
        self::assertSame('VALIDATION_FAILED', $clinical->json('error.code'));

        // 2. Segment administratif valide.
        $seg = $this->write('POST', '/api/v1/communication/segments', [
            'name' => 'Patients Douala',
            'criteria' => ['city' => 'Douala', 'patient_or_prospect' => 'PATIENT'],
        ], $this->operator);
        $seg->assertCreated();
        $this->assertMatchesContract($seg, 'schemas/resources/communication.json#/$defs/AudienceSegmentResponse');
        $segmentId = (string) $seg->json('data.id');

        $updatedSeg = $this->write('PATCH', '/api/v1/communication/segments/'.$segmentId, [
            'expected_version' => 1,
            'name' => 'Patients Douala actifs',
        ], $this->operator);
        $updatedSeg->assertOk();
        self::assertSame(2, $updatedSeg->json('data.version'));

        $segList = $this->read('/api/v1/communication/segments', $this->operator);
        $segList->assertOk();
        $this->assertMatchesContract($segList, 'schemas/resources/communication.json#/$defs/AudienceSegmentList');

        // 3. Création et prévisualisation de campagne.
        $camp = $this->write('POST', '/api/v1/communication/campaigns', [
            'name' => 'Information Douala',
            'segment_id' => $segmentId,
            'template_version_id' => $this->templateVersionId,
        ], $this->operator);
        $camp->assertCreated();
        $this->assertMatchesContract($camp, 'schemas/resources/communication.json#/$defs/CampaignResponse');
        $campaignId = (string) $camp->json('data.id');

        $preview = $this->write('POST', '/api/v1/communication/campaigns/'.$campaignId.'/preview', [], $this->operator);
        $preview->assertOk();
        $this->assertMatchesContract($preview, 'schemas/resources/communication.json#/$defs/CampaignPreviewResponse');
        self::assertSame(3, $preview->json('data.total_candidates'));
        self::assertSame(2, $preview->json('data.eligible_count'));
        self::assertSame(1, $preview->json('data.excluded_count'));

        // 4. Opérateur sans approbation -> 422 APPROVAL_REQUIRED_OR_EXPIRED.
        $noApproval = $this->write('POST', '/api/v1/communication/campaigns/'.$campaignId.'/freeze', [
            'approval_id' => null,
        ], $this->operator);
        $noApproval->assertStatus(422);
        self::assertSame('APPROVAL_REQUIRED_OR_EXPIRED', $noApproval->json('error.code'));

        // Exécution avant gel -> 409 STATE_TRANSITION_REFUSED.
        $this->write('POST', '/api/v1/communication/campaigns/'.$campaignId.'/execute', [], $this->operator)
            ->assertStatus(409);

        // 5. Approbation avec mauvais effectif (5 au lieu de 2) -> refusée 422 !
        $wrongApprovalId = $this->approved(
            ApprovalSubject::campaignSend($campaignId, $segmentId, $this->templateVersionId, 5)->toArray(),
            $this->operator,
        );
        $wrongFreeze = $this->write('POST', '/api/v1/communication/campaigns/'.$campaignId.'/freeze', [
            'approval_id' => $wrongApprovalId,
        ], $this->operator);
        $wrongFreeze->assertStatus(422);
        self::assertSame('APPROVAL_REQUIRED_OR_EXPIRED', $wrongFreeze->json('error.code'));

        // 6. Approbation exacte (eligible_count = 2) -> gel réussi -> APPROVED avec target_frozen_at & approval_id !
        $exactApprovalId = $this->approved(
            ApprovalSubject::campaignSend($campaignId, $segmentId, $this->templateVersionId, 2)->toArray(),
            $this->operator,
        );
        $frozen = $this->write('POST', '/api/v1/communication/campaigns/'.$campaignId.'/freeze', [
            'approval_id' => $exactApprovalId,
        ], $this->operator);
        $frozen->assertOk();
        $this->assertMatchesContract($frozen, 'schemas/resources/communication.json#/$defs/CampaignResponse');
        self::assertSame('APPROVED', $frozen->json('data.status'));
        self::assertSame($exactApprovalId, $frozen->json('data.approval_id'));
        self::assertNotNull($frozen->json('data.target_frozen_at'));
        self::assertSame(2, $frozen->json('data.eligible_count'));
        self::assertSame(1, $frozen->json('data.excluded_count'));

        // Vérification liste destinataires figés.
        $recipients = $this->read('/api/v1/communication/campaigns/'.$campaignId.'/recipients', $this->operator);
        $recipients->assertOk();
        $this->assertMatchesContract($recipients, 'schemas/resources/communication.json#/$defs/CampaignRecipientPage');
        self::assertCount(3, $recipients->json('data'));

        // 7. Opt-out du patient #2 APRÈS gel mais AVANT exécution -> il doit être EXCLU à l'exécution !
        $this->write('POST', '/api/v1/communication/consents/revoke', [
            'patient_id' => $this->patientEligibleTwo,
            'channel' => 'SMS',
            'purpose' => 'MARKETING',
            'destination' => '+237690100002',
            'proof' => 'Retrait dernière minute',
        ], $this->operator)->assertCreated();

        /** @var FakeMessagingClient $fake */
        $fake = $this->app->make(FakeMessagingClient::class);
        $executed = $this->write('POST', '/api/v1/communication/campaigns/'.$campaignId.'/execute', [
            'reason' => 'Lancement campagne approuvée',
        ], $this->operator);
        $executed->assertOk();
        $this->assertMatchesContract($executed, 'schemas/resources/communication.json#/$defs/CampaignResponse');
        self::assertSame('COMPLETED', $executed->json('data.status'));

        // Seul le patient #1 a reçu un message ; patient #2 a basculé en EXCLUDED.
        self::assertCount(1, $fake->sent());
        self::assertSame('+237690100001', $fake->sent()[0]['destination']);
        self::assertSame(2, DB::table('campaign_recipients')->where('campaign_id', $campaignId)->where('status', 'EXCLUDED')->count());
        self::assertSame(1, DB::table('campaign_recipients')->where('campaign_id', $campaignId)->where('status', 'SUBMITTED')->count());

        // Événement Outbox CampaignCompleted v1 conforme au schéma contrat.
        $outbox = DB::table('outbox_events')
            ->where('clinic_id', $this->clinicId)
            ->where('event_type', 'CampaignCompleted')
            ->where('source_id', $campaignId)
            ->first();
        self::assertNotNull($outbox);
        /** @var array<string, mixed> $eventPayload */
        $eventPayload = json_decode((string) $outbox->payload, true, 512, JSON_THROW_ON_ERROR);
        $this->app->make(ContractValidator::class)->assertEventPayload('CampaignCompleted', 1, $eventPayload);
    }

    public function test_pause_cancels_draft_or_approved_campaign(): void
    {
        $seg = $this->write('POST', '/api/v1/communication/segments', [
            'name' => 'Tous patients',
            'criteria' => ['patient_or_prospect' => 'PATIENT'],
        ], $this->manager)->assertCreated();

        $camp = $this->write('POST', '/api/v1/communication/campaigns', [
            'name' => 'Campagne annulable',
            'segment_id' => (string) $seg->json('data.id'),
            'template_version_id' => $this->templateVersionId,
        ], $this->manager)->assertCreated();
        $campaignId = (string) $camp->json('data.id');

        $paused = $this->write('POST', '/api/v1/communication/campaigns/'.$campaignId.'/pause', [
            'reason' => 'Report interne',
        ], $this->manager);
        $paused->assertOk();
        $this->assertMatchesContract($paused, 'schemas/resources/communication.json#/$defs/CampaignResponse');
        self::assertSame('CANCELLED', $paused->json('data.status'));

        $list = $this->read('/api/v1/communication/campaigns', $this->manager);
        $list->assertOk();
        $this->assertMatchesContract($list, 'schemas/resources/communication.json#/$defs/CampaignPage');
    }

    /**
     * @param  array<string, mixed>  $body
     */
    protected function write(string $method, string $uri, array $body, ?User $as = null, ?string $key = null): TestResponse
    {
        return $this->actingAsFresh($as ?? $this->manager)
            ->withHeaders(['Idempotency-Key' => $key ?? Ulid::generate()])
            ->json($method, $uri, $body);
    }

    protected function read(string $uri, ?User $as = null): TestResponse
    {
        return $this->actingAsFresh($as ?? $this->manager)->getJson($uri);
    }

    private function seedSmsAccount(string $clinicId): void
    {
        $id = Ulid::generate();
        $nowDb = '2026-10-22 09:30:00.000000';
        DB::table('integration_accounts')->insert([
            'id' => $id,
            'clinic_id' => $clinicId,
            'provider' => 'SMS',
            'external_account_id' => 'sms-camp-test',
            'display_name' => 'SMS Campagnes',
            'credentials_ciphertext' => null,
            'encryption_key_id' => null,
            'token_expires_at' => null,
            'status' => 'TEST',
            'public_configuration' => null,
            'configured_by' => $this->manager->id,
            'version' => 1,
            'created_at' => $nowDb,
            'updated_at' => $nowDb,
        ]);
    }
}
