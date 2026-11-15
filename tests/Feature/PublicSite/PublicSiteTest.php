<?php

namespace Tests\Feature\PublicSite;

use App\Domain\Shared\Ulid;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;
use Tests\Support\BillingFixtures;
use Tests\Support\MigratedDatabase;
use Tests\Support\ValidatesContracts;
use Tests\TestCase;

/**
 * Site public (L3D02, EE039, AT35) : la gérante prépare des fiches du showroom et des contenus, les approuve, et le public
 * ne lit QUE ce qui est publié, par une liste blanche de champs (jamais coût d'achat, stock, référence interne). Une fiche
 * modifiée repasse en brouillon, une image n'a pas de note de droits = refusée, un module fermé répond 404. Fictif.
 */
final class PublicSiteTest extends TestCase
{
    use BillingFixtures;
    use MigratedDatabase;
    use ValidatesContracts;

    private const PURCHASE_COST = 123457;

    protected function setUp(): void
    {
        parent::setUp();
        $this->bootBilling();
        config(['eeo.enabled_modules' => ['sales', 'stock', 'communication', 'settings'], 'eeo.integrations.default_clinic_id' => $this->clinicId]);
        Storage::fake('local');
        DB::table('catalog_items')->where('id', $this->item['frame'])->update(['public_visibility' => 1, 'purchase_cost' => self::PURCHASE_COST, 'brand' => 'Marque Fictive']);
    }

    protected function tearDown(): void
    {
        $this->resetClock();
        parent::tearDown();
    }

    // --- Aides -------------------------------------------------------------------------------------------------------

    /**
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    private function body(array $overrides = []): array
    {
        return $overrides + [
            'expected_version' => null,
            'catalog_item_id' => $this->item['frame'],
            'public_title' => 'Monture ronde noire',
            'public_description' => 'Une monture ronde en acétate noir, légère et robuste.',
            'style' => 'Rond',
            'show_sale_price' => false,
            'display_order' => 1,
        ];
    }

    private function draft(array $overrides = []): TestResponse
    {
        return $this->write('POST', '/api/v1/publications', $this->body($overrides), $this->manager);
    }

    private function changeStatus(string $id, int $version, string $status, ?User $as = null): TestResponse
    {
        return $this->actingAsReauthenticated($as ?? $this->manager)->withHeaders(['Idempotency-Key' => Ulid::generate()])
            ->postJson('/api/v1/publications/'.$id.'/status', ['expected_version' => $version, 'status' => $status]);
    }

    private function publishedFrame(): string
    {
        $created = $this->draft();
        $created->assertCreated();
        $id = (string) $created->json('data.id');
        $this->changeStatus($id, 1, 'PUBLISHED')->assertOk()->assertJsonPath('data.status', 'PUBLISHED');

        return $id;
    }

    private function png(int $width = 300, int $height = 300): string
    {
        $chunk = static fn (string $type, string $data): string => pack('N', strlen($data)).$type.$data.pack('N', crc32($type.$data));

        return "\x89PNG\r\n\x1a\n"
            .$chunk('IHDR', pack('NNCCCCC', $width, $height, 8, 2, 0, 0, 0))
            .$chunk('IDAT', (string) gzcompress(str_repeat("\x00".str_repeat("\xff", $width * 3), $height)))
            .$chunk('IEND', '');
    }

    /**
     * @param  array<string, string>  $query
     */
    private function upload(string $publicationId, string $bytes, string $mime = 'image/png', array $query = [], ?User $as = null): TestResponse
    {
        $query += ['alt_text' => 'Monture ronde noire vue de face', 'rights_note' => 'Photo prise par le cabinet, publication autorisée'];

        return $this->actingAsFresh($as ?? $this->manager)->call(
            'POST',
            '/api/v1/publications/'.$publicationId.'/media?'.http_build_query($query),
            [],
            [],
            [],
            ['CONTENT_TYPE' => $mime, 'HTTP_IDEMPOTENCY_KEY' => Ulid::generate(), 'HTTP_ACCEPT' => 'application/json'],
            $bytes,
        );
    }

    // --- Fiches du showroom --------------------------------------------------------------------------------------------

    public function test_un_article_non_visible_ou_deja_decrit_ne_peut_pas_recevoir_de_fiche(): void
    {
        DB::table('catalog_items')->where('id', $this->item['frame'])->update(['public_visibility' => 0]);
        $this->draft()->assertStatus(422)->assertJsonPath('error.fields.catalog_item_id.0', 'Cet article n\'est pas marqué « visible au public » dans le catalogue : la gérante doit d\'abord l\'autoriser.');

        DB::table('catalog_items')->where('id', $this->item['frame'])->update(['public_visibility' => 1]);
        $this->draft()->assertCreated();
        $this->draft(['public_title' => 'Autre fiche'])->assertStatus(422);
        $this->draft(['catalog_item_id' => 'pas-un-ulid'])->assertStatus(422);
    }

    public function test_un_brouillon_n_est_pas_public_et_la_publication_exige_la_gerante_reauthentifiee(): void
    {
        $created = $this->draft();
        $created->assertCreated()->assertJsonPath('data.status', 'DRAFT')->assertJsonPath('data.slug', 'monture-ronde-noire')->assertJsonPath('data.version', 1);
        $this->assertMatchesContract($created, 'schemas/resources/public.json#/$defs/PublicationResponse');
        $id = (string) $created->json('data.id');

        $this->getJson('/public/v1/showroom')->assertOk()->assertJsonCount(0, 'data');

        // Sans réauthentification récente : refus (423). Une caissière n'a pas site.publish : refus (403).
        $this->actingAsFresh($this->manager)->withHeaders(['Idempotency-Key' => Ulid::generate()])
            ->postJson('/api/v1/publications/'.$id.'/status', ['expected_version' => 1, 'status' => 'PUBLISHED'])->assertStatus(423);
        $this->changeStatus($id, 1, 'PUBLISHED', $this->cashier)->assertForbidden();
        $this->getJson('/public/v1/showroom')->assertOk()->assertJsonCount(0, 'data');

        $this->changeStatus($id, 1, 'PUBLISHED')->assertOk()->assertJsonPath('data.status', 'PUBLISHED')->assertJsonPath('data.version', 2)->assertJsonPath('data.published_at', fn ($v) => is_string($v));
        $row = DB::table('catalog_publications')->where('id', $id)->first();
        $this->assertSame($this->manager->id, $row->approved_by, 'Le nom de la gérante qui publie est conservé.');
        $this->assertSame(1, DB::table('audit_events')->where('action', 'site.publication_published')->count());
    }

    public function test_le_public_ne_lit_qu_une_liste_blanche_de_champs_jamais_le_cout_ni_le_stock(): void
    {
        $this->publishedFrame();

        $response = $this->getJson('/public/v1/showroom');

        $response->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.slug', 'monture-ronde-noire')->assertJsonPath('data.0.price', null)
            ->assertJsonPath('data.0.brand', 'Marque Fictive')->assertJsonPath('data.0.currency', 'XAF')->assertJsonPath('facets.styles.0', 'rond');
        $this->assertSame(['brand', 'currency', 'description', 'media', 'price', 'slug', 'style', 'title'], collect($response->json('data.0'))->keys()->sort()->values()->all());
        $this->assertMatchesContract($response, 'schemas/resources/public.json#/$defs/ShowroomPage');
        $raw = $response->getContent();
        $this->assertStringNotContainsString((string) self::PURCHASE_COST, $raw, 'Le coût d\'achat ne sort jamais.');
        $this->assertStringNotContainsString($this->item['frame'], $raw, 'L\'identifiant de l\'article ne sort pas.');
        $this->assertStringContainsString('max-age=', (string) $response->headers->get('Cache-Control'));

        $detail = $this->getJson('/public/v1/showroom/monture-ronde-noire');
        $detail->assertOk()->assertJsonPath('data.title', 'Monture ronde noire');
        $this->assertMatchesContract($detail, 'schemas/resources/public.json#/$defs/ShowroomItemResponse');
        $this->getJson('/public/v1/showroom/inconnue')->assertNotFound();
    }

    public function test_modifier_une_fiche_publiee_la_retire_du_site_et_le_prix_n_est_montre_que_sur_decision(): void
    {
        $id = $this->publishedFrame();

        $edited = $this->write('PATCH', '/api/v1/publications/'.$id, $this->body(['expected_version' => 2, 'show_sale_price' => true]), $this->manager);
        $edited->assertOk()->assertJsonPath('data.status', 'DRAFT')->assertJsonPath('data.version', 3)->assertJsonPath('data.published_at', null);
        $this->getJson('/public/v1/showroom')->assertOk()->assertJsonCount(0, 'data');

        // Une version périmée est un conflit : jamais d'écrasement silencieux.
        $this->write('PATCH', '/api/v1/publications/'.$id, $this->body(['expected_version' => 2]), $this->manager)->assertStatus(409);

        $this->changeStatus($id, 3, 'PUBLISHED')->assertOk();
        $price = (int) DB::table('catalog_items')->where('id', $this->item['frame'])->value('sale_price');
        $this->getJson('/public/v1/showroom')->assertOk()->assertJsonPath('data.0.price', $price);
    }

    public function test_un_article_retire_du_catalogue_public_disparait_du_site_sans_toucher_a_la_fiche(): void
    {
        $this->publishedFrame();

        DB::table('catalog_items')->where('id', $this->item['frame'])->update(['public_visibility' => 0]);
        $this->getJson('/public/v1/showroom')->assertOk()->assertJsonCount(0, 'data');
        $this->getJson('/public/v1/showroom/monture-ronde-noire')->assertNotFound();
    }

    public function test_retirer_puis_archiver_suivent_les_transitions_permises(): void
    {
        $id = $this->publishedFrame();

        $this->changeStatus($id, 2, 'DRAFT')->assertOk()->assertJsonPath('data.status', 'DRAFT');
        $this->changeStatus($id, 3, 'ARCHIVED')->assertOk()->assertJsonPath('data.status', 'ARCHIVED');
        $this->changeStatus($id, 4, 'PUBLISHED')->assertStatus(409);
        $this->changeStatus($id, 4, 'INVENTE')->assertStatus(422);
        $this->getJson('/public/v1/showroom')->assertOk()->assertJsonCount(0, 'data');
    }

    // --- Images --------------------------------------------------------------------------------------------------------

    public function test_une_image_exige_une_note_de_droits_un_vrai_format_et_une_taille_permise(): void
    {
        $id = (string) $this->draft()->json('data.id');

        $this->upload($id, $this->png(), 'image/png', ['rights_note' => ''])->assertStatus(422)->assertJsonStructure(['error' => ['fields' => ['rights_note']]]);
        $this->upload($id, "<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>", 'image/svg+xml')->assertStatus(422);
        $this->upload($id, 'ceci n\'est pas une image', 'image/png')->assertStatus(422);
        $this->upload($id, $this->png(), 'image/jpeg')->assertStatus(422);
        $this->upload($id, $this->png(100, 100))->assertStatus(422);
        config(['eeo.public_site.max_media_bytes' => 100]);
        $this->upload($id, $this->png())->assertStatus(422);
        config(['eeo.public_site.max_media_bytes' => 3145728]);
        $this->upload($id, $this->png(), 'image/png', [], $this->cashier)->assertForbidden();
        $this->assertSame(0, DB::table('catalog_media')->count());

        $ok = $this->upload($id, $this->png());
        $ok->assertCreated()->assertJsonCount(1, 'data.media')->assertJsonPath('data.media.0.alt_text', 'Monture ronde noire vue de face');
        $this->assertMatchesContract($ok, 'schemas/resources/public.json#/$defs/PublicationResponse');
        $this->upload($id, $this->png())->assertStatus(422)->assertJsonPath('error.fields.file.0', 'Cette image est déjà associée à la fiche.');
        $this->assertSame('PUBLIC_APPROVED', DB::table('stored_files')->value('classification'));
    }

    public function test_l_image_n_est_publique_qu_une_fois_la_fiche_publiee_et_une_fiche_compte_au_plus_n_images(): void
    {
        $id = (string) $this->draft()->json('data.id');
        $mediaId = (string) $this->upload($id, $this->png())->json('data.media.0.id');

        // Brouillon : la gérante voit l'image, le public non.
        $this->actingAsFresh($this->manager)->get('/api/v1/publication-media/'.$mediaId)->assertOk()->assertHeader('Content-Type', 'image/png');
        $this->getJson('/public/v1/media/'.$mediaId)->assertNotFound();

        $this->changeStatus($id, 1, 'PUBLISHED')->assertOk();
        $public = $this->get('/public/v1/media/'.$mediaId);
        $public->assertOk()->assertHeader('Content-Type', 'image/png');
        $this->assertStringContainsString('max-age=', (string) $public->headers->get('Cache-Control'));
        $list = $this->getJson('/public/v1/showroom')->assertOk();
        $this->assertSame('/public/v1/media/'.$mediaId, $list->json('data.0.media.0.url'));

        config(['eeo.public_site.max_media_per_publication' => 1]);
        $this->upload($id, $this->png(320, 320))->assertStatus(422);

        // Retirer l'image la rend introuvable à l'instant ; le fichier privé reste conservé.
        $this->actingAsFresh($this->manager)->withHeaders(['Idempotency-Key' => Ulid::generate()])->deleteJson('/api/v1/publications/'.$id.'/media/'.$mediaId)->assertOk()->assertJsonCount(0, 'data.media');
        $this->getJson('/public/v1/media/'.$mediaId)->assertNotFound();
        $this->assertSame(1, DB::table('stored_files')->count());
    }

    // --- Contenus publics ----------------------------------------------------------------------------------------------

    public function test_un_contenu_public_est_controle_puis_publie_et_une_seule_revision_reste_publique(): void
    {
        $this->write('POST', '/api/v1/public-contents', ['expected_version' => null, 'code' => 'INCONNU', 'title' => 'X', 'content' => 'Texte'], $this->manager)->assertStatus(422);
        $this->write('POST', '/api/v1/public-contents', ['expected_version' => null, 'code' => 'WHATSAPP', 'title' => 'WhatsApp', 'content' => 'appelez-nous'], $this->manager)->assertStatus(422);

        $draft = $this->write('POST', '/api/v1/public-contents', ['expected_version' => null, 'code' => 'WHATSAPP', 'title' => 'WhatsApp direct', 'content' => '+237 6 00 00 00 00'], $this->manager);
        $draft->assertCreated()->assertJsonPath('data.content', '237600000000')->assertJsonPath('data.status', 'DRAFT')->assertJsonPath('data.revision_no', 1);
        $this->assertMatchesContract($draft, 'schemas/resources/public.json#/$defs/PublicContentResponse');
        $id = (string) $draft->json('data.id');

        $this->getJson('/public/v1/contents')->assertOk()->assertJsonCount(0, 'data');
        $this->publishContent($id, 1)->assertOk()->assertJsonPath('data.status', 'PUBLISHED');
        $public = $this->getJson('/public/v1/contents');
        $public->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.whatsapp_url', 'https://wa.me/237600000000');
        $this->assertMatchesContract($public, 'schemas/resources/public.json#/$defs/PublicContentPublicList');

        // Un nouveau texte est un brouillon : le public garde l'ancien jusqu'à la publication, qui archive l'ancienne.
        $second = $this->write('POST', '/api/v1/public-contents', ['expected_version' => null, 'code' => 'WHATSAPP', 'title' => 'WhatsApp direct', 'content' => '237611111111'], $this->manager);
        $second->assertCreated()->assertJsonPath('data.revision_no', 2);
        $this->getJson('/public/v1/contents')->assertJsonPath('data.0.whatsapp_url', 'https://wa.me/237600000000');
        $this->publishContent((string) $second->json('data.id'), 1)->assertOk();
        $this->getJson('/public/v1/contents')->assertJsonCount(1, 'data')->assertJsonPath('data.0.whatsapp_url', 'https://wa.me/237611111111');
        $this->assertSame(1, DB::table('public_contents')->where('status', 'PUBLISHED')->count());
        $this->assertSame(1, DB::table('public_contents')->where('status', 'ARCHIVED')->count());

        $admin = $this->read('/api/v1/public-contents', $this->manager);
        $admin->assertOk();
        $this->assertMatchesContract($admin, 'schemas/resources/public.json#/$defs/PublicContentList');
    }

    private function publishContent(string $id, int $version): TestResponse
    {
        return $this->actingAsReauthenticated($this->manager)->withHeaders(['Idempotency-Key' => Ulid::generate()])
            ->postJson('/api/v1/public-contents/'.$id.'/status', ['expected_version' => $version, 'status' => 'PUBLISHED']);
    }

    // --- Accès ---------------------------------------------------------------------------------------------------------

    public function test_l_administration_exige_site_publish_et_un_module_ferme_repond_404_partout(): void
    {
        foreach ([$this->cashier, $this->clinician, $this->reception] as $user) {
            $this->read('/api/v1/publications', $user)->assertForbidden();
            $this->read('/api/v1/public-contents', $user)->assertForbidden();
        }
        $this->publishedFrame();
        $this->read('/api/v1/publications', $this->manager)->assertOk()->assertJsonCount(1, 'data');

        config(['eeo.enabled_modules' => ['sales', 'stock', 'settings']]);
        $this->read('/api/v1/publications', $this->manager)->assertNotFound();
        $this->getJson('/public/v1/showroom')->assertNotFound();
        $this->getJson('/public/v1/contents')->assertNotFound();
    }
}
