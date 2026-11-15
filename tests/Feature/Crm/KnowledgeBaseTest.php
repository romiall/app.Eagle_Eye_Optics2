<?php

namespace Tests\Feature\Crm;

use App\Domain\Shared\Ulid;
use App\Http\Controllers\Api\V1\KnowledgeController;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;
use Tests\Support\AgendaFixtures;
use Tests\Support\MigratedDatabase;
use Tests\TestCase;

/**
 * Base de connaissances gouvernée (L2D04) : création brouillon, révisions, approbation gérante
 * (`knowledge.manage`), transition unique vers une nouvelle version publiée via la colonne
 * générée `active_entry_key` et cloisonnement strict par cabinet.
 */
final class KnowledgeBaseTest extends TestCase
{
    use AgendaFixtures;
    use MigratedDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->bootAgenda(['agenda', 'today', 'patients', 'communication']);
        $this->registerTestRoutes();
    }

    protected function tearDown(): void
    {
        $this->resetClock();
        parent::tearDown();
    }

    public function test_knowledge_workflow_single_active_published_version_and_permissions(): void
    {
        // Un agent sans `knowledge.manage` peut rédiger (si `communication.manage` lui est accordé), mais pas approuver.
        $nowSql = CarbonImmutable::now('UTC')->format('Y-m-d H:i:s.u');
        DB::table('user_permissions')->insert([
            'id' => Ulid::generate(),
            'clinic_id' => $this->clinicId,
            'user_id' => $this->reception->id,
            'permission_code' => 'communication.manage',
            'allowed' => true,
            'assigned_by' => $this->manager->id,
            'reason' => 'Rédaction FAQ test',
            'created_at' => $nowSql,
            'updated_at' => $nowSql,
        ]);

        // 1. Création d'une fiche + révision 1 brouillon par l'accueil.
        $create = $this->actingAsFresh($this->reception)->postJson('/api/v1/knowledge', [
            'code' => 'HORAIRES',
            'title' => 'Horaires d\'ouverture',
            'category' => 'HOURS',
            'content' => 'Ouvert du lundi au vendredi de 08h00 à 17h00.',
            'language' => 'fr',
        ]);
        $create->assertCreated();
        $this->assertMatchesContract($create, 'schemas/resources/communication.json#/$defs/KnowledgeEntryResponse');
        $entryId = (string) $create->json('data.id');
        $rev1Id = (string) $create->json('data.versions.0.id');
        $this->assertNull($create->json('data.published_version'));
        $this->assertFalse($create->json('data.versions.0.is_published'));

        // Code dupliqué dans le même cabinet -> 409.
        $this->actingAsFresh($this->manager)->postJson('/api/v1/knowledge', [
            'code' => 'HORAIRES',
            'title' => 'Doublon',
            'category' => 'HOURS',
            'content' => 'Contenu doublon.',
        ])->assertStatus(409);

        // 2. Tentative de publication d'un brouillon non approuvé -> 409 STATE_TRANSITION_REFUSED.
        $this->actingAsFresh($this->manager)->postJson('/api/v1/knowledge/versions/'.$rev1Id.'/publish', [])
            ->assertStatus(409)
            ->assertJsonPath('error.code', 'STATE_TRANSITION_REFUSED');

        // 3. L'accueil sans `knowledge.manage` ne peut pas approuver -> 403.
        $this->actingAsFresh($this->reception)->postJson('/api/v1/knowledge/versions/'.$rev1Id.'/approve', [
            'reason' => 'Auto-validation interdite',
        ])->assertForbidden();

        // 4. La gérante approuve puis publie la révision 1.
        $approve1 = $this->actingAsFresh($this->manager)->postJson('/api/v1/knowledge/versions/'.$rev1Id.'/approve', [
            'reason' => 'Horaires vérifiés.',
        ]);
        $approve1->assertOk();
        $this->assertMatchesContract($approve1, 'schemas/resources/communication.json#/$defs/KnowledgeEntryVersionResponse');
        $this->assertSame($this->manager->id, $approve1->json('data.approved_by'));
        $this->assertNotNull($approve1->json('data.approved_at'));

        $publish1 = $this->actingAsFresh($this->manager)->postJson('/api/v1/knowledge/versions/'.$rev1Id.'/publish', []);
        $publish1->assertOk();
        $this->assertMatchesContract($publish1, 'schemas/resources/communication.json#/$defs/KnowledgeEntryVersionResponse');
        $this->assertTrue($publish1->json('data.is_published'));
        $this->assertDatabaseHas('knowledge_entry_versions', [
            'id' => $rev1Id,
            'active_entry_key' => $entryId,
        ]);

        // 5. Ajout d'une révision 2, approbation, puis publication -> retire automatiquement la révision 1 (`active_entry_key` unique respecté).
        $addRev2 = $this->actingAsFresh($this->manager)->postJson('/api/v1/knowledge/'.$entryId.'/versions', [
            'content' => 'Ouvert du lundi au samedi de 08h00 à 18h00.',
            'language' => 'fr',
        ]);
        $addRev2->assertCreated();
        $this->assertMatchesContract($addRev2, 'schemas/resources/communication.json#/$defs/KnowledgeEntryVersionResponse');
        $rev2Id = (string) $addRev2->json('data.id');
        $this->assertSame(2, $addRev2->json('data.revision_no'));

        $this->actingAsFresh($this->manager)->postJson('/api/v1/knowledge/versions/'.$rev2Id.'/approve', [])->assertOk();

        $this->moveClock('2026-10-22 10:00:00');
        $publish2 = $this->actingAsFresh($this->manager)->postJson('/api/v1/knowledge/versions/'.$rev2Id.'/publish', [
            'reason' => 'Extension horaires samedi.',
        ]);
        $publish2->assertOk();
        $this->assertMatchesContract($publish2, 'schemas/resources/communication.json#/$defs/KnowledgeEntryVersionResponse');
        $this->assertTrue($publish2->json('data.is_published'));

        // Seule la révision 2 porte `active_entry_key = $entryId`, la révision 1 est retirée (`active_entry_key` NULL).
        $rev1Row = DB::table('knowledge_entry_versions')->where('id', $rev1Id)->first();
        $rev2Row = DB::table('knowledge_entry_versions')->where('id', $rev2Id)->first();
        $this->assertNotNull($rev1Row);
        $this->assertNotNull($rev2Row);
        $this->assertNotNull($rev1Row->retired_at);
        $this->assertNull($rev1Row->active_entry_key);
        $this->assertNull($rev2Row->retired_at);
        $this->assertSame($entryId, $rev2Row->active_entry_key);

        // 6. Liste paginée filtrée par catégorie : une seule `published_version` et historique complet des versions.
        $list = $this->actingAsFresh($this->manager)->getJson('/api/v1/knowledge?category=HOURS');
        $list->assertOk();
        $this->assertMatchesContract($list, 'schemas/resources/communication.json#/$defs/KnowledgeEntryPage');
        $this->assertCount(1, $list->json('data'));
        $this->assertSame($rev2Id, $list->json('data.0.published_version.id'));
        $this->assertCount(2, $list->json('data.0.versions'));

        // 7. Cloisonnement inter-cabinet (404 / liste vide / même code autorisé dans un autre cabinet).
        $clinicB = $this->makeClinic('TEST CABINET B');
        $managerB = $this->makeStaff($clinicB, 'MANAGER', 'gerante.kb.b');

        $this->actingAsFresh($managerB)->getJson('/api/v1/knowledge')
            ->assertOk()
            ->assertJsonCount(0, 'data');
        $this->actingAsFresh($managerB)->postJson('/api/v1/knowledge/'.$entryId.'/versions', ['content' => 'Intrusion'])
            ->assertNotFound();
        $this->actingAsFresh($managerB)->postJson('/api/v1/knowledge', [
            'code' => 'HORAIRES',
            'title' => 'Horaires Cabinet B',
            'category' => 'HOURS',
            'content' => 'Ouvert de 09h00 à 16h00.',
        ])->assertCreated();
    }

    private function registerTestRoutes(): void
    {
        Route::middleware(['api', 'auth:sanctum', 'active', 'module:communication'])
            ->prefix('api/v1')
            ->group(function (): void {
                Route::get('/knowledge', [KnowledgeController::class, 'index'])
                    ->middleware('any-permission:communication.manage');
                Route::post('/knowledge', [KnowledgeController::class, 'store'])
                    ->middleware('any-permission:communication.manage');
                Route::post('/knowledge/{id}/versions', [KnowledgeController::class, 'storeVersion'])
                    ->middleware('any-permission:communication.manage');
                Route::post('/knowledge/versions/{id}/approve', [KnowledgeController::class, 'approveVersion'])
                    ->middleware('any-permission:communication.manage');
                Route::post('/knowledge/versions/{id}/publish', [KnowledgeController::class, 'publishVersion'])
                    ->middleware('any-permission:communication.manage');
            });
    }
}
