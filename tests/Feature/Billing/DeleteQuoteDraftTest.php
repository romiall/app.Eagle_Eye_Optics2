<?php

namespace Tests\Feature\Billing;

use App\Domain\Shared\Ulid;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Tests\Support\BillingFixtures;
use Tests\Support\MigratedDatabase;
use Tests\TestCase;

/**
 * Suppression d'un brouillon de devis jamais émis (chantier « CRUD des écrans », tranche 3a ; en ligne seulement) sur
 * MySQL réel : seul le brouillon disparaît, avec ses lignes ; un devis émis, accepté ou converti ne se supprime pas
 * (409, il se révise) ; créateur ou gérante ; version attendue ; audit sans prix de ligne ni identité ; pierre tombale
 * au journal des changements ; rejeu idempotent ; aucun numéro consommé. Données fictives.
 */
final class DeleteQuoteDraftTest extends TestCase
{
    use BillingFixtures;
    use MigratedDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->bootBilling();
        config(['eeo.numbering.prefixes.QUOTE' => 'TEST-DEV']);
    }

    protected function tearDown(): void
    {
        $this->resetClock();
        parent::tearDown();
    }

    /**
     * @return array<string, mixed>
     */
    private function quoteLine(string $itemId, string $quantity = '1', int $position = 1): array
    {
        $line = $this->line($itemId, $quantity, $position);
        unset($line['prescription_id']);

        return $line;
    }

    /**
     * Brouillon créé par l'API : [identifiant, version, total].
     *
     * @return array{0: string, 1: int, 2: int}
     */
    private function draftQuote(?User $as = null): array
    {
        $created = $this->write('POST', '/api/v1/quotes', [
            'expected_version' => null,
            'quote_id' => Ulid::generate(),
            'patient_id' => $this->patientId,
            'prospect' => null,
            'valid_until' => '2026-11-21',
            'lines' => [$this->quoteLine($this->item['frame'], '1', 1), $this->quoteLine($this->item['exam'], '1', 2)],
        ], $as)->assertCreated();

        return [(string) $created->json('data.id'), (int) $created->json('data.version'), (int) $created->json('data.total_gross')];
    }

    /**
     * @param  array<string, mixed>  $overrides
     */
    private function deleteQuote(string $id, int $version, ?User $as = null, ?string $key = null, array $overrides = []): TestResponse
    {
        return $this->write('POST', '/api/v1/quotes/'.$id.'/delete', array_merge(['expected_version' => $version, 'quote_id' => $id], $overrides), $as, $key);
    }

    /**
     * @return array<string, int>
     */
    private function counts(): array
    {
        $count = fn (string $table): int => DB::table($table)->where('clinic_id', $this->clinicId)->count();

        return [
            'quotes' => $count('quotes'), 'quote_lines' => $count('quote_lines'), 'revisions' => $count('quote_revisions'),
            'audit' => $count('audit_events'), 'changes' => $count('sync_change_log'), 'usages' => $count('document_number_usages'),
        ];
    }

    public function test_un_brouillon_se_supprime_avec_ses_lignes_sans_consommer_de_numero(): void
    {
        [$id, $version, $total] = $this->draftQuote();
        $this->assertSame(2, DB::table('quote_lines')->where('quote_id', $id)->count());
        $usages = DB::table('document_number_usages')->where('clinic_id', $this->clinicId)->count();

        $response = $this->deleteQuote($id, $version)->assertOk();

        $this->assertMatchesContract($response, 'schemas/resources/billing.json#/$defs/DeleteQuoteDraftResponse');
        $response->assertJsonPath('data.quote_id', $id)->assertJsonPath('data.lines', 2);
        $this->assertFalse(DB::table('quotes')->where('id', $id)->exists());
        $this->assertSame(0, DB::table('quote_lines')->where('quote_id', $id)->count());
        $this->assertSame($usages, DB::table('document_number_usages')->where('clinic_id', $this->clinicId)->count(), 'Aucun numéro n\'est consommé ni rendu.');

        $audit = DB::table('audit_events')->where('action', 'quote.draft_deleted')->where('target_id', $id)->first();
        $this->assertNotNull($audit);
        $this->assertSame($this->cashier->id, $audit->actor_id);
        $this->assertEquals(['version' => $version, 'lines' => 2, 'total_gross' => $total], json_decode((string) $audit->sanitized_diff, true, 512, JSON_THROW_ON_ERROR));
        $tombstone = DB::table('sync_change_log')->where('entity_type', 'quotes')->where('entity_id', $id)->orderByDesc('change_sequence')->first();
        $this->assertNotNull($tombstone);
        $this->assertSame(['ARCHIVED', $version + 1, 'FINANCIAL'], [$tombstone->change_kind, (int) $tombstone->entity_version, $tombstone->visibility]);
    }

    public function test_un_devis_emis_ne_se_supprime_pas(): void
    {
        [$id, $version] = $this->draftQuote();
        $issued = $this->write('POST', '/api/v1/quotes/'.$id.'/issue', ['expected_version' => $version, 'quote_id' => $id, 'total_gross' => 55000])->assertOk();
        $before = $this->counts();

        $this->deleteQuote($id, (int) $issued->json('data.version'))
            ->assertStatus(409)
            ->assertJsonPath('error.code', 'STATE_TRANSITION_REFUSED')
            ->assertJsonPath('error.details.current_status', 'ISSUED');

        $this->assertSame('ISSUED', DB::table('quotes')->where('id', $id)->value('status'));
        $this->assertSame($before, $this->counts(), 'Un refus ne laisse aucun effet.');
    }

    public function test_une_version_perimee_repond_conflit_avec_la_version_actuelle(): void
    {
        [$id, $version] = $this->draftQuote();
        $before = $this->counts();

        $this->deleteQuote($id, $version + 4)
            ->assertStatus(409)
            ->assertJsonPath('error.code', 'VERSION_CONFLICT')
            ->assertJsonPath('error.details.current_version', $version);

        $this->assertTrue(DB::table('quotes')->where('id', $id)->exists());
        $this->assertSame($before, $this->counts());
    }

    public function test_le_createur_ou_la_gerante_suppriment_pas_un_autre_compte_de_la_caisse(): void
    {
        [$id, $version] = $this->draftQuote();
        $other = $this->makeStaff($this->clinicId, 'CASHIER', 'caisse2.test');
        $before = $this->counts();

        $this->deleteQuote($id, $version, $other)->assertForbidden();
        $this->assertSame($before, $this->counts());

        $this->deleteQuote($id, $version, $this->manager)->assertOk();
        $this->assertFalse(DB::table('quotes')->where('id', $id)->exists());
        $audit = DB::table('audit_events')->where('action', 'quote.draft_deleted')->where('target_id', $id)->first();
        $this->assertNotNull($audit);
        $this->assertSame($this->manager->id, $audit->actor_id);
    }

    public function test_l_accueil_et_le_professionnel_ne_suppriment_pas_un_devis(): void
    {
        [$id, $version] = $this->draftQuote();
        $before = $this->counts();

        $this->deleteQuote($id, $version, $this->reception)->assertForbidden();
        $this->deleteQuote($id, $version, $this->clinician)->assertForbidden();

        $this->assertSame($before, $this->counts());
    }

    public function test_le_corps_doit_porter_la_version_et_l_identifiant_de_l_adresse(): void
    {
        [$id, $version] = $this->draftQuote();
        $before = $this->counts();

        $this->deleteQuote($id, $version, null, null, ['quote_id' => Ulid::generate()])->assertStatus(422)->assertJsonPath('error.code', 'VALIDATION_FAILED');
        $this->write('POST', '/api/v1/quotes/'.$id.'/delete', ['quote_id' => $id])->assertStatus(422);
        $this->deleteQuote($id, 0)->assertStatus(422);

        $this->assertSame($before, $this->counts());
    }

    public function test_le_rejeu_de_la_meme_cle_rend_la_reponse_d_origine_sans_second_effet(): void
    {
        [$id, $version] = $this->draftQuote();
        $key = Ulid::generate();

        $first = $this->deleteQuote($id, $version, null, $key)->assertOk();
        $second = $this->deleteQuote($id, $version, null, $key)->assertOk();

        $this->assertEquals($first->json('data'), $second->json('data'));
        $this->assertSame(1, DB::table('audit_events')->where('action', 'quote.draft_deleted')->count());
        $this->assertSame(1, DB::table('sync_change_log')->where('entity_type', 'quotes')->where('entity_id', $id)->where('change_kind', 'ARCHIVED')->count());
    }

    public function test_un_devis_deja_supprime_ou_d_un_autre_cabinet_repond_introuvable(): void
    {
        [$id, $version] = $this->draftQuote();
        $this->deleteQuote($id, $version)->assertOk();
        $this->deleteQuote($id, $version)->assertNotFound();
        $this->deleteQuote(Ulid::generate(), 1)->assertNotFound();

        [$kept, $keptVersion] = $this->draftQuote();
        $clinicB = $this->makeClinic('TEST CABINET B');
        $foreign = $this->makeStaff($clinicB, 'MANAGER', 'gerante.b');
        $this->deleteQuote($kept, $keptVersion, $foreign)->assertNotFound();
        $this->assertTrue(DB::table('quotes')->where('id', $kept)->exists());
    }
}
