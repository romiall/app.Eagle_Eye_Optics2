<?php

namespace Tests\Feature\Crm;

use App\Domain\Shared\Ulid;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Tests\Support\AgendaFixtures;
use Tests\Support\MigratedDatabase;
use Tests\Support\SendsIdempotencyKeys;
use Tests\TestCase;

/**
 * Assistant IA borné et escalade humaine (L2D05) :
 * - ancrage exclusif sur les fiches PUBLIÉES (jamais les brouillons) ;
 * - réservation administrative assainie (`public_booking_requests`) sans lecture de tables cliniques ;
 * - détection de mots-clés médicaux/cliniques -> refus clinique + handoff automatique `REQUEST` ;
 * - arrêt strict du bot pendant `HUMAN_TAKEOVER` (409 `STATE_TRANSITION_REFUSED`) et reprise explicite ;
 * - cloisonnement inter-cabinet.
 */
final class AssistantAndHandoffTest extends TestCase
{
    use AgendaFixtures;
    use MigratedDatabase;
    use SendsIdempotencyKeys;

    protected function setUp(): void
    {
        parent::setUp();
        $this->bootAgenda(['agenda', 'today', 'patients', 'communication']);
    }

    protected function tearDown(): void
    {
        $this->resetClock();
        parent::tearDown();
    }

    public function test_bounded_assistant_clinical_guard_handoff_and_takeover_enforcement(): void
    {
        $nowSql = CarbonImmutable::now('UTC')->format('Y-m-d H:i:s.u');

        // Prestation ouverte à la réservation en ligne (`public_booking: true`).
        $publicServiceId = Ulid::generate();
        DB::table('appointment_services')->insert([
            'id' => $publicServiceId,
            'clinic_id' => $this->clinicId,
            'name' => 'Essayage montures et prise de mesures',
            'duration_minutes' => 30,
            'catalog_item_id' => null,
            'active' => true,
            'public_booking' => true,
            'version' => 1,
            'created_at' => $nowSql,
            'updated_at' => $nowSql,
        ]);

        // Prospect + compte Kommo + piste + conversation active + fiche publiée vs brouillons non publiés.
        $prospectId = Ulid::generate();
        DB::table('prospect_contacts')->insert([
            'id' => $prospectId,
            'clinic_id' => $this->clinicId,
            'name' => 'Mariam Kouam',
            'phone' => '+237691234567',
            'phone_normalized' => '+237691234567',
            'email' => null,
            'patient_id' => $this->patientId,
            'origin' => 'WHATSAPP',
            'administrative_notes' => null,
            'created_by' => $this->manager->id,
            'version' => 1,
            'created_at' => $nowSql,
            'updated_at' => $nowSql,
        ]);

        $accountId = Ulid::generate();
        DB::table('integration_accounts')->insert([
            'id' => $accountId,
            'clinic_id' => $this->clinicId,
            'provider' => 'KOMMO',
            'external_account_id' => 'kommo-assistant',
            'display_name' => 'Kommo Assistant',
            'status' => 'ACTIVE',
            'configured_by' => $this->manager->id,
            'version' => 1,
            'created_at' => $nowSql,
            'updated_at' => $nowSql,
        ]);

        $leadId = Ulid::generate();
        DB::table('crm_leads')->insert([
            'id' => $leadId,
            'clinic_id' => $this->clinicId,
            'prospect_contact_id' => $prospectId,
            'integration_account_id' => $accountId,
            'external_lead_id' => 'lead-assistant-1',
            'pipeline_id' => 'pipe-1',
            'pipeline_stage' => 'QUALIFICATION',
            'product_interest' => 'Montures',
            'budget_min' => 40000,
            'budget_max' => 90000,
            'acquisition_source' => 'WHATSAPP',
            'assigned_to' => null,
            'status' => 'OPEN',
            'last_synced_at' => $nowSql,
            'created_at' => $nowSql,
            'updated_at' => $nowSql,
        ]);

        $conversationId = Ulid::generate();
        DB::table('crm_conversations')->insert([
            'id' => $conversationId,
            'clinic_id' => $this->clinicId,
            'crm_lead_id' => $leadId,
            'integration_account_id' => $accountId,
            'external_conversation_id' => 'conv-wa-1',
            'channel' => 'WHATSAPP',
            'status' => 'BOT_ACTIVE',
            'last_activity_at' => $nowSql,
            'version' => 1,
            'created_at' => $nowSql,
            'updated_at' => $nowSql,
        ]);

        // Fiche KB publiée (rev 1) + révision 2 restée BROUILLON + fiche 2 restée BROUILLON.
        $entry1Id = Ulid::generate();
        DB::table('knowledge_entries')->insert([
            'id' => $entry1Id,
            'clinic_id' => $this->clinicId,
            'code' => 'HORAIRES',
            'title' => 'Horaires du cabinet',
            'category' => 'HOURS',
            'active' => true,
            'version' => 2,
            'created_at' => $nowSql,
            'updated_at' => $nowSql,
        ]);
        $publishedRevId = Ulid::generate();
        DB::table('knowledge_entry_versions')->insert([
            'id' => $publishedRevId,
            'clinic_id' => $this->clinicId,
            'entry_id' => $entry1Id,
            'revision_no' => 1,
            'content' => 'Ouvert du lundi au samedi de 08h00 à 18h00.',
            'language' => 'fr',
            'authored_by' => $this->manager->id,
            'approved_by' => $this->manager->id,
            'approved_at' => $nowSql,
            'published_at' => $nowSql,
            'retired_at' => null,
            'created_at' => $nowSql,
            'updated_at' => $nowSql,
        ]);
        DB::table('knowledge_entry_versions')->insert([
            'id' => Ulid::generate(),
            'clinic_id' => $this->clinicId,
            'entry_id' => $entry1Id,
            'revision_no' => 2,
            'content' => 'BROUILLON NON PUBLIE HORAIRES.',
            'language' => 'fr',
            'authored_by' => $this->manager->id,
            'approved_by' => null,
            'approved_at' => null,
            'published_at' => null,
            'retired_at' => null,
            'created_at' => $nowSql,
            'updated_at' => $nowSql,
        ]);

        $entry2Id = Ulid::generate();
        DB::table('knowledge_entries')->insert([
            'id' => $entry2Id,
            'clinic_id' => $this->clinicId,
            'code' => 'PRIX_TEST',
            'title' => 'Tarifs horaires brouillon',
            'category' => 'PRICING',
            'active' => true,
            'version' => 1,
            'created_at' => $nowSql,
            'updated_at' => $nowSql,
        ]);
        DB::table('knowledge_entry_versions')->insert([
            'id' => Ulid::generate(),
            'clinic_id' => $this->clinicId,
            'entry_id' => $entry2Id,
            'revision_no' => 1,
            'content' => 'TARIF SECRET NON PUBLIE.',
            'language' => 'fr',
            'authored_by' => $this->manager->id,
            'approved_by' => null,
            'approved_at' => null,
            'published_at' => null,
            'retired_at' => null,
            'created_at' => $nowSql,
            'updated_at' => $nowSql,
        ]);

        // 1. Tour normal ancré sur la KB publiée + réservation administrative du vendredi 2026-10-23 08:00 UTC (= 09:00 Douala).
        $turn1 = $this->actingAsFresh($this->manager)->postJson('/api/v1/crm/conversations/'.$conversationId.'/assistant-turn', [
            'message' => 'Bonjour, quels sont vos horaires et pouvez-vous réserver ce créneau ?',
            'service_id' => $publicServiceId,
            'preferred_starts_at' => '2026-10-23T08:00:00.000Z',
        ]);
        $turn1->assertOk();
        $this->assertMatchesContract($turn1, 'schemas/resources/communication.json#/$defs/AssistantTurnResultResponse');
        $this->assertFalse($turn1->json('data.handoff_triggered'));
        $this->assertFalse($turn1->json('data.clinical_refusal'));
        $this->assertSame('BOT_ACTIVE', $turn1->json('data.conversation_status'));
        $this->assertSame(['HORAIRES'], $turn1->json('data.knowledge_citations'));
        $this->assertSame([$publishedRevId], $turn1->json('data.run.knowledge_version_ids'));
        $this->assertStringContainsString('08h00 à 18h00', (string) $turn1->json('data.reply'));
        $this->assertStringNotContainsString('BROUILLON NON PUBLIE', (string) $turn1->json('data.reply'));
        $this->assertStringNotContainsString('TARIF SECRET', (string) $turn1->json('data.reply'));

        $bookingRef = $turn1->json('data.booking_reference');
        $this->assertIsString($bookingRef);
        $this->assertStringStartsWith('RDV-', $bookingRef);
        $this->assertDatabaseHas('public_booking_requests', [
            'clinic_id' => $this->clinicId,
            'prospect_contact_id' => $prospectId,
            'public_reference' => $bookingRef,
            'status' => 'PENDING',
        ]);

        // 2. Question médicale/clinique -> refus strict + handoff automatique `REQUEST` + outbox.
        $clinicalTurn = $this->actingAsFresh($this->manager)->postJson('/api/v1/crm/conversations/'.$conversationId.'/assistant-turn', [
            'message' => 'J\'ai une douleur à l\'oeil, quelle dioptrie sur mon ordonnance de glaucome ?',
        ]);
        $clinicalTurn->assertOk();
        $this->assertMatchesContract($clinicalTurn, 'schemas/resources/communication.json#/$defs/AssistantTurnResultResponse');
        $this->assertTrue($clinicalTurn->json('data.clinical_refusal'));
        $this->assertTrue($clinicalTurn->json('data.handoff_triggered'));
        $this->assertSame('HUMAN_TAKEOVER', $clinicalTurn->json('data.conversation_status'));
        $this->assertSame('HANDOFF', $clinicalTurn->json('data.run.status'));
        $this->assertSame([], $clinicalTurn->json('data.knowledge_citations'));

        $this->assertDatabaseHas('conversation_handoffs', [
            'clinic_id' => $this->clinicId,
            'conversation_id' => $conversationId,
            'event_type' => 'REQUEST',
        ]);
        $this->assertDatabaseHas('outbox_events', [
            'clinic_id' => $this->clinicId,
            'event_type' => 'HumanHandoffRequested',
            'source_id' => $conversationId,
        ]);

        // 3. Pendant HUMAN_TAKEOVER, l'assistant refuse de répondre (409 STATE_TRANSITION_REFUSED).
        $blockedTurn = $this->actingAsFresh($this->manager)->postJson('/api/v1/crm/conversations/'.$conversationId.'/assistant-turn', [
            'message' => 'Êtes-vous ouverts demain ?',
        ]);
        $blockedTurn->assertStatus(409)->assertJsonPath('error.code', 'STATE_TRANSITION_REFUSED');

        // 4. Reprise bot par un conseiller -> repasse en BOT_ACTIVE et répond de nouveau.
        $resume = $this->actingAsFresh($this->manager)->postJson('/api/v1/crm/conversations/'.$conversationId.'/resume-bot', [
            'reason' => 'Question médicale traitée au cabinet.',
        ]);
        $resume->assertOk();
        $this->assertMatchesContract($resume, 'schemas/resources/communication.json#/$defs/CrmConversationResponse');
        $this->assertSame('BOT_ACTIVE', $resume->json('data.status'));

        $resumedTurn = $this->actingAsFresh($this->manager)->postJson('/api/v1/crm/conversations/'.$conversationId.'/assistant-turn', [
            'message' => 'Quels sont les horaires ?',
        ]);
        $resumedTurn->assertOk();
        $this->assertSame('BOT_ACTIVE', $resumedTurn->json('data.conversation_status'));

        // 5. Escalade humaine explicite avec affectation (`assign_to_self: true`).
        $manualHandoff = $this->actingAsFresh($this->manager)->postJson('/api/v1/crm/conversations/'.$conversationId.'/handoff', [
            'reason' => 'Le prospect souhaite négocier un devis entreprise.',
            'administrative_summary' => 'Intéressé par 5 montures optiques.',
            'assign_to_self' => true,
        ]);
        $manualHandoff->assertOk();
        $this->assertMatchesContract($manualHandoff, 'schemas/resources/communication.json#/$defs/CrmConversationResponse');
        $this->assertSame('HUMAN_TAKEOVER', $manualHandoff->json('data.status'));
        $this->assertSame($this->manager->id, $manualHandoff->json('data.human_owner_id'));

        // 6. Historique des handoffs et des exécutions conforme aux contrats.
        $handoffsList = $this->actingAsFresh($this->manager)->getJson('/api/v1/crm/conversations/'.$conversationId.'/handoffs');
        $handoffsList->assertOk();
        $this->assertMatchesContract($handoffsList, 'schemas/resources/communication.json#/$defs/ConversationHandoffList');
        $this->assertCount(3, $handoffsList->json('data'));

        $runsList = $this->actingAsFresh($this->manager)->getJson('/api/v1/crm/conversations/'.$conversationId.'/runs');
        $runsList->assertOk();
        $this->assertMatchesContract($runsList, 'schemas/resources/communication.json#/$defs/AssistantRunList');
        $this->assertCount(3, $runsList->json('data'));

        // 7. Cloisonnement inter-cabinet : un utilisateur d'un autre cabinet reçoit 404.
        $clinicB = $this->makeClinic('TEST CABINET B');
        $managerB = $this->makeStaff($clinicB, 'MANAGER', 'gerante.bot.b');
        $this->actingAsFresh($managerB)->getJson('/api/v1/crm/conversations/'.$conversationId.'/runs')->assertNotFound();
        $this->actingAsFresh($managerB)->postJson('/api/v1/crm/conversations/'.$conversationId.'/handoff', [
            'reason' => 'Tentative hors cabinet',
        ])->assertNotFound();
    }

    private function seedAssistantConversation(string $suffix): string
    {
        $nowSql = '2026-10-22 09:30:00.000000';
        $accountId = Ulid::generate();
        DB::table('integration_accounts')->insert([
            'id' => $accountId,
            'clinic_id' => $this->clinicId,
            'provider' => 'KOMMO',
            'external_account_id' => 'kommo-'.$suffix,
            'display_name' => 'Kommo '.$suffix,
            'status' => 'ACTIVE',
            'public_configuration' => null,
            'configured_by' => $this->manager->id,
            'version' => 1,
            'created_at' => $nowSql,
            'updated_at' => $nowSql,
        ]);

        $prospectId = Ulid::generate();
        DB::table('prospect_contacts')->insert([
            'id' => $prospectId,
            'clinic_id' => $this->clinicId,
            'name' => 'Prospect '.$suffix,
            'phone' => '+237690001122',
            'phone_normalized' => '+237690001122',
            'origin' => 'WHATSAPP',
            'created_by' => $this->manager->id,
            'version' => 1,
            'created_at' => $nowSql,
            'updated_at' => $nowSql,
        ]);

        $leadId = Ulid::generate();
        DB::table('crm_leads')->insert([
            'id' => $leadId,
            'clinic_id' => $this->clinicId,
            'prospect_contact_id' => $prospectId,
            'integration_account_id' => $accountId,
            'external_lead_id' => 'lead-'.$suffix,
            'pipeline_stage' => 'NEW',
            'status' => 'OPEN',
            'last_synced_at' => $nowSql,
            'created_at' => $nowSql,
            'updated_at' => $nowSql,
        ]);

        $conversationId = Ulid::generate();
        DB::table('crm_conversations')->insert([
            'id' => $conversationId,
            'clinic_id' => $this->clinicId,
            'crm_lead_id' => $leadId,
            'integration_account_id' => $accountId,
            'external_conversation_id' => 'conv-'.$suffix,
            'channel' => 'WHATSAPP',
            'status' => 'BOT_ACTIVE',
            'last_activity_at' => $nowSql,
            'version' => 1,
            'created_at' => $nowSql,
            'updated_at' => $nowSql,
        ]);

        return $conversationId;
    }

    public function test_assistant_reads_published_showroom_catalog_and_hides_unpublished_or_unapproved_prices(): void
    {
        $nowSql = '2026-10-22 09:30:00.000000';
        $conversationId = $this->seedAssistantConversation('cat-1');

        $visiblePricedId = Ulid::generate();
        $visibleHiddenPriceId = Ulid::generate();
        $draftHiddenId = Ulid::generate();

        foreach ([
            [$visiblePricedId, 'REF-SHOW-01', 'Monture Lumière', 'MarqueA', 45000, 18000, true],
            [$visibleHiddenPriceId, 'REF-SHOW-02', 'Monture Discrète', 'MarqueB', 72500, 29000, true],
            [$draftHiddenId, 'REF-DRAFT-99', 'Monture Brouillon Secrète', 'MarqueC', 99000, 33333, true],
        ] as [$itemId, $ref, $name, $brand, $salePrice, $costPrice, $pubVis]) {
            DB::table('catalog_items')->insert([
                'id' => $itemId,
                'clinic_id' => $this->clinicId,
                'reference' => $ref,
                'category_code' => 'FRAME',
                'name' => $name,
                'brand' => $brand,
                'model' => 'M-1',
                'unit_code' => 'UNIT',
                'quantity_integer_only' => true,
                'sale_price' => $salePrice,
                'purchase_cost' => $costPrice,
                'tax_rule_id' => null,
                'stock_mode' => 'STOCKED',
                'requires_expiry' => false,
                'low_stock_threshold' => null,
                'expiry_alert_days' => null,
                'active' => true,
                'public_visibility' => $pubVis,
                'version' => 1,
                'created_at' => $nowSql,
                'updated_at' => $nowSql,
            ]);
        }

        DB::table('catalog_publications')->insert([
            [
                'id' => Ulid::generate(),
                'clinic_id' => $this->clinicId,
                'catalog_item_id' => $visiblePricedId,
                'slug' => 'monture-lumiere',
                'public_title' => 'Monture Lumière Ronde',
                'public_description' => 'Acétate léger conçu pour le quotidien.',
                'style' => 'Rond',
                'show_sale_price' => true,
                'status' => 'PUBLISHED',
                'display_order' => 1,
                'approved_by' => $this->manager->id,
                'published_at' => $nowSql,
                'version' => 1,
                'created_at' => $nowSql,
                'updated_at' => $nowSql,
            ],
            [
                'id' => Ulid::generate(),
                'clinic_id' => $this->clinicId,
                'catalog_item_id' => $visibleHiddenPriceId,
                'slug' => 'monture-discrete',
                'public_title' => 'Monture Discrète Titane',
                'public_description' => 'Modèle titane haute résistance.',
                'style' => 'Rectangulaire',
                'show_sale_price' => false,
                'status' => 'PUBLISHED',
                'display_order' => 2,
                'approved_by' => $this->manager->id,
                'published_at' => $nowSql,
                'version' => 1,
                'created_at' => $nowSql,
                'updated_at' => $nowSql,
            ],
            [
                'id' => Ulid::generate(),
                'clinic_id' => $this->clinicId,
                'catalog_item_id' => $draftHiddenId,
                'slug' => 'monture-brouillon',
                'public_title' => 'BROUILLON INVISIBLE SHOWROOM',
                'public_description' => 'Ne doit jamais fuiter vers l\'assistant.',
                'style' => 'Aviateur',
                'show_sale_price' => true,
                'status' => 'DRAFT',
                'display_order' => 3,
                'approved_by' => null,
                'published_at' => null,
                'version' => 1,
                'created_at' => $nowSql,
                'updated_at' => $nowSql,
            ],
        ]);

        $response = $this->actingAsFresh($this->manager)->postJson('/api/v1/crm/conversations/'.$conversationId.'/assistant-turn', [
            'message' => 'Quelles montures et tarifs avez-vous au showroom ?',
        ]);

        $response->assertOk();
        $this->assertMatchesContract($response, 'schemas/resources/communication.json#/$defs/AssistantTurnResultResponse');
        $reply = (string) $response->json('data.reply');
        $this->assertStringContainsString('Monture Lumière Ronde', $reply);
        $this->assertStringContainsString('45 000 XAF', $reply);
        $this->assertStringContainsString('Monture Discrète Titane', $reply);
        $this->assertStringContainsString('tarif sur demande au cabinet', $reply);
        $this->assertStringNotContainsString('72 500', $reply);
        $this->assertStringNotContainsString('BROUILLON INVISIBLE SHOWROOM', $reply);
        $this->assertStringNotContainsString('18000', $reply);
        $this->assertStringNotContainsString('REF-SHOW-01', $reply);

        $tools = $response->json('data.run.sanitized_tool_results');
        $this->assertIsArray($tools);
        $catalogTool = array_values(array_filter($tools, static fn (array $entry): bool => ($entry['tool'] ?? null) === 'get_public_catalog'));
        $this->assertCount(1, $catalogTool);
        $this->assertSame(2, $catalogTool[0]['count']);
    }

    public function test_assistant_turn_requires_and_enforces_idempotency_across_normal_and_handoff_turns(): void
    {
        $conversationId = $this->seedAssistantConversation('idem-1');

        // En-tête explicitement absent : 422 VALIDATION_FAILED (Idempotency-Key).
        $missingKey = $this->actingAsFresh($this->manager)
            ->withHeader('Idempotency-Key', '')
            ->postJson('/api/v1/crm/conversations/'.$conversationId.'/assistant-turn', [
                'message' => 'Bonjour',
            ]);
        $missingKey->assertStatus(422);
        $this->assertSame(0, DB::table('assistant_runs')->where('conversation_id', $conversationId)->count());

        // 1. Tour normal rejoué avec la même clé et le même contenu : un seul run créé.
        $normalKey = Ulid::generate();
        $normalBody = ['message' => 'Bonjour, quels sont vos services ?'];
        $first = $this->actingAsFresh($this->manager)
            ->withHeader('Idempotency-Key', $normalKey)
            ->postJson('/api/v1/crm/conversations/'.$conversationId.'/assistant-turn', $normalBody);
        $replay = $this->actingAsFresh($this->manager)
            ->withHeader('Idempotency-Key', $normalKey)
            ->postJson('/api/v1/crm/conversations/'.$conversationId.'/assistant-turn', $normalBody);

        $first->assertOk();
        $replay->assertOk();
        $this->assertSame($first->json('data.run.id'), $replay->json('data.run.id'));
        $this->assertSame($first->json('data.reply'), $replay->json('data.reply'));
        $this->assertSame(1, DB::table('assistant_runs')->where('conversation_id', $conversationId)->count());

        // 2. Même clé avec une autre charge -> 409 IDEMPOTENCY_PAYLOAD_MISMATCH.
        $mismatch = $this->actingAsFresh($this->manager)
            ->withHeader('Idempotency-Key', $normalKey)
            ->postJson('/api/v1/crm/conversations/'.$conversationId.'/assistant-turn', ['message' => 'Autre question']);
        $mismatch->assertStatus(409);
        $this->assertSame('IDEMPOTENCY_PAYLOAD_MISMATCH', $mismatch->json('error.code'));

        // 3. Rejeu d'un refus clinique : même après passage en HUMAN_TAKEOVER, la même clé rejoue le résultat d'origine sans doublon.
        $clinicalKey = Ulid::generate();
        $clinicalBody = ['message' => 'Quel médicament prendre pour un glaucome ?'];
        $clinicalFirst = $this->actingAsFresh($this->manager)
            ->withHeader('Idempotency-Key', $clinicalKey)
            ->postJson('/api/v1/crm/conversations/'.$conversationId.'/assistant-turn', $clinicalBody);
        $clinicalReplay = $this->actingAsFresh($this->manager)
            ->withHeader('Idempotency-Key', $clinicalKey)
            ->postJson('/api/v1/crm/conversations/'.$conversationId.'/assistant-turn', $clinicalBody);

        $clinicalFirst->assertOk();
        $clinicalReplay->assertOk();
        $this->assertTrue($clinicalReplay->json('data.clinical_refusal'));
        $this->assertSame($clinicalFirst->json('data.run.id'), $clinicalReplay->json('data.run.id'));
        $this->assertSame(2, DB::table('assistant_runs')->where('conversation_id', $conversationId)->count());
        $this->assertSame(1, DB::table('conversation_handoffs')->where('conversation_id', $conversationId)->count());
    }
}
