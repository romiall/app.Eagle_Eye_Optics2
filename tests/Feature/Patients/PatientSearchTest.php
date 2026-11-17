<?php

namespace Tests\Feature\Patients;

use App\Domain\Shared\Ulid;
use App\Domain\Shared\ValueObjects\Text;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Support\AccessFixtures;
use Tests\Support\MigratedDatabase;
use Tests\Support\ValidatesContracts;
use Tests\TestCase;

/**
 * Recherche de patients (P02, AT03) : à partir de deux caractères, sans tenir compte de la casse ni des accents,
 * par nom, prénom, téléphone ou numéro de dossier, toujours limitée au cabinet, pagination de 25. Données
 * fictives.
 */
final class PatientSearchTest extends TestCase
{
    use AccessFixtures;
    use MigratedDatabase;
    use ValidatesContracts;

    private string $clinicId;

    private User $reception;

    protected function setUp(): void
    {
        parent::setUp();
        // Horloge figée AVANT la création des comptes : l'attribution d'un profil porte l'instant courant et une
        // permission n'est effective qu'à partir de cet instant (une horloge figée dans le passé les rendrait futures).
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-10-22 09:30:00', 'UTC'));
        config(['eeo.enabled_modules' => ['patients']]);
        $this->clinicId = $this->makeClinic();
        $this->reception = $this->makeStaff($this->clinicId, 'RECEPTION', 'accueil.test');
    }

    protected function tearDown(): void
    {
        CarbonImmutable::setTestNow();
        parent::tearDown();
    }

    /**
     * @param  array<string, mixed>  $overrides
     */
    private function seedPatient(string $lastName, ?string $firstNames, ?string $phone, array $overrides = [], ?string $clinicId = null): string
    {
        $id = Ulid::generate();
        $clinic = $clinicId ?? $this->clinicId;
        $count = DB::table('patient_records')->where('clinic_id', $clinic)->count() + 1;
        $number = sprintf('EE-2026-%04d', $count);
        $now = '2026-10-22 09:30:00.000000';
        $creator = DB::table('users')->where('clinic_id', $clinic)->value('id');

        DB::table('patient_records')->insert($overrides + [
            'id' => $id,
            'clinic_id' => $clinic,
            'record_number' => $number,
            'last_name' => $lastName,
            'first_names' => $firstNames,
            'sex' => 'UNKNOWN',
            'birth_date' => '1990-01-01',
            'birth_date_missing_reason' => null,
            'phone_primary' => $phone,
            'phone_primary_normalized' => $phone === null ? null : preg_replace('/[^0-9+]/', '', $phone),
            'phone_secondary' => null,
            'phone_secondary_normalized' => null,
            'phone_missing_reason' => $phone === null ? 'Inconnu' : null,
            'name_search' => Text::searchKey($lastName.' '.($firstNames ?? '')),
            'address' => null,
            'profession' => null,
            'guardian_contact' => null,
            'legacy_record' => false,
            'first_known_visit_on' => null,
            'first_visit_certified' => false,
            'legacy_record_number' => null,
            'archived_at' => null,
            'merged_into_patient_id' => null,
            'created_by' => $creator,
            'version' => 1,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        return $id;
    }

    /**
     * @return list<string> noms rendus, dans l'ordre
     */
    private function names(string $query, ?User $as = null): array
    {
        $response = $this->actingAsFresh($as ?? $this->reception)->getJson('/api/v1/patients?'.http_build_query(['query' => $query]));
        $response->assertOk();
        $this->assertMatchesContract($response, 'schemas/resources/patients.json#/$defs/PatientPage');

        return array_map(static fn (array $row): string => $row['last_name'], $response->json('data'));
    }

    public function test_la_recherche_ignore_la_casse_les_accents_et_l_ordre_des_mots(): void
    {
        $this->seedPatient("N'Guessan-Kouamé", 'Élodie', '+237 600 00 00 01');
        $this->seedPatient('Dupont', 'Jean', '699000002');

        $this->assertSame(["N'Guessan-Kouamé"], $this->names('elodie'));
        $this->assertSame(["N'Guessan-Kouamé"], $this->names('KOUAME'));
        $this->assertSame(["N'Guessan-Kouamé"], $this->names('Élodie Kouamé'));
        $this->assertSame(["N'Guessan-Kouamé"], $this->names('kouame elodie'));
        $this->assertSame(['Dupont'], $this->names('dup'));
        $this->assertSame([], $this->names('inconnu'));
    }

    public function test_la_recherche_par_telephone_compare_les_chiffres_sans_indicatif_deduit(): void
    {
        $this->seedPatient('Alpha', null, '+237 600 00 00 01');
        $this->seedPatient('Beta', null, '699 00 00 02');

        $this->assertSame(['Alpha'], $this->names('600000001'));
        $this->assertSame(['Alpha'], $this->names('+237 600 00 00 01'));
        $this->assertSame(['Beta'], $this->names('699 00 00'));
        // « 00 » initial = « + » : « 0000 » cherche « 00 » (les chiffres communs aux deux numéros).
        $this->assertSame(['Alpha', 'Beta'], $this->names('0000'));
    }

    public function test_la_recherche_par_numero_de_dossier_complet_prefixe_ou_fin(): void
    {
        $this->seedPatient('Alpha', null, '600000001');
        $this->seedPatient('Beta', null, '600000002');

        $this->assertSame(['Alpha'], $this->names('EE-2026-0001'));
        $this->assertSame(['Alpha', 'Beta'], $this->names('ee-2026'));
        $this->assertSame(['Beta'], $this->names('0002'));
    }

    public function test_deux_caracteres_au_moins_sinon_422(): void
    {
        $this->seedPatient('Alpha', null, '600000001');

        foreach (['a', ' a '] as $query) {
            $this->actingAsFresh($this->reception)
                ->getJson('/api/v1/patients?'.http_build_query(['query' => $query]))
                ->assertStatus(422)
                ->assertJsonPath('error.code', 'VALIDATION_FAILED')
                ->assertJsonStructure(['error' => ['fields' => ['query']]]);
        }
        $this->assertSame(['Alpha'], $this->names('al'));
    }

    public function test_requete_vide_ou_absente_renvoie_tous_les_patients(): void
    {
        $this->seedPatient('Alpha', null, '600000001');
        $this->seedPatient('Beta', null, '600000002');

        foreach (['', ' ', null] as $query) {
            $url = $query === null ? '/api/v1/patients' : '/api/v1/patients?'.http_build_query(['query' => $query]);
            $response = $this->actingAsFresh($this->reception)->getJson($url);
            $response->assertOk();
            $this->assertMatchesContract($response, 'schemas/resources/patients.json#/$defs/PatientPage');
            $names = array_map(static fn (array $row): string => $row['last_name'], $response->json('data'));
            $this->assertSame(['Alpha', 'Beta'], $names);
        }
    }

    public function test_le_nombre_de_lignes_par_page_est_reglable(): void
    {
        $this->seedPatient('Alpha', null, '600000001');
        $this->seedPatient('Beta', null, '600000002');

        $response = $this->actingAsFresh($this->reception)->getJson('/api/v1/patients?per_page=15');
        $response->assertOk();
        $this->assertMatchesContract($response, 'schemas/resources/patients.json#/$defs/PatientPage');
        $this->assertSame(15, $response->json('meta.per_page'));

        // Hors bornes 5..100 -> 422
        $this->actingAsFresh($this->reception)->getJson('/api/v1/patients?per_page=2')->assertStatus(422);
        $this->actingAsFresh($this->reception)->getJson('/api/v1/patients?per_page=105')->assertStatus(422);
    }

    public function test_les_jokers_de_like_sont_cherches_comme_des_caracteres(): void
    {
        $this->seedPatient('Alpha', null, '600000001');
        $this->seedPatient('Beta', null, '600000002');

        // Un joker n'est jamais un motif : dans un nom, la ponctuation sépare les mots (« a_p » = « a » et « p ») ;
        // dans un numéro de dossier ou de téléphone, « % » est cherché comme caractère et ne correspond à rien.
        $this->assertSame(['Alpha'], $this->names('a_p'));
        $this->assertSame([], $this->names('EE-%'));
        $this->assertSame([], $this->names('EE-2026-00_1'));
        $this->assertSame([], $this->names('EE-2026-00%'));
        $this->assertSame([], $this->names("x'; DROP TABLE patient_records; --"));
        $this->assertSame(2, DB::table('patient_records')->count());

        // Une requête sans aucun caractère de recherche (symboles seuls) est refusée, pas élargie à tout le cabinet.
        $this->actingAsFresh($this->reception)->getJson('/api/v1/patients?query=%25%25')->assertStatus(422);
    }

    public function test_la_recherche_ne_renvoie_que_le_cabinet_et_jamais_une_fiche_fusionnee(): void
    {
        $this->seedPatient('Alpha', null, '600000001');
        $otherClinic = $this->makeClinic();
        $this->makeStaff($otherClinic, 'MANAGER', 'autre.gerante');
        $this->seedPatient('Alpha', null, '600000001', [], $otherClinic);
        $kept = $this->seedPatient('Alphabet', null, '600000003');
        $this->seedPatient('Alphonse', null, '600000004', ['merged_into_patient_id' => $kept]);

        $this->assertSame(['Alpha', 'Alphabet'], $this->names('alph'));
    }

    public function test_tous_les_roles_de_lecture_cherchent_et_la_reponse_ne_porte_aucune_donnee_clinique(): void
    {
        $this->seedPatient('Alpha', null, '600000001', ['address' => 'Quartier fictif', 'profession' => 'Enseignante']);

        foreach (['MANAGER', 'RECEPTION', 'CLINICIAN', 'CASHIER'] as $role) {
            $user = $this->makeStaff($this->clinicId, $role);
            $this->assertSame(['Alpha'], $this->names('alpha', $user), $role);
        }

        $row = $this->actingAsFresh($this->reception)->getJson('/api/v1/patients?query=alpha')->json('data.0');
        $this->assertArrayNotHasKey('address', $row, 'La liste ne porte que l\'identité de base.');
        $this->assertArrayNotHasKey('profession', $row);
    }

    public function test_sans_connexion_401_et_avec_module_ferme_404(): void
    {
        $this->getJson('/api/v1/patients?query=al')->assertStatus(401);

        config(['eeo.enabled_modules' => []]);
        $this->actingAsFresh($this->reception)->getJson('/api/v1/patients?query=al')->assertNotFound();
    }

    public function test_le_telephone_saisi_avec_ou_sans_indicatif_retrouve_la_fiche_dans_les_deux_sens(): void
    {
        $this->seedPatient('Alpha', null, '600000001');
        $this->seedPatient('Beta', null, '+237 699 00 00 02');
        $this->seedPatient('Gamma', null, '123');

        // Enregistré sans indicatif, saisi avec : retrouvé par la fin du numéro saisi.
        $this->assertSame(['Alpha'], $this->names('+237 600 00 00 01'));
        $this->assertSame(['Alpha'], $this->names('00237 600 00 00 01'));
        // Enregistré avec indicatif, saisi avec « 00 » ou sans indicatif.
        $this->assertSame(['Beta'], $this->names('00237 699 00 00 02'));
        $this->assertSame(['Beta'], $this->names('699 00 00 02'));
        // Un numéro enregistré trop court n'est jamais pris pour la fin d'un numéro saisi.
        $this->assertSame([], $this->names('+237 600 00 00 123'));
    }

    public function test_une_requete_trop_longue_mal_encodee_ou_une_page_hors_borne_est_refusee(): void
    {
        $this->seedPatient('Alpha', null, '600000001');

        $this->actingAsFresh($this->reception)->getJson('/api/v1/patients?query='.str_repeat('a', 101))->assertStatus(422);
        $this->actingAsFresh($this->reception)->getJson('/api/v1/patients?query=%FFab')->assertStatus(422);
        $this->actingAsFresh($this->reception)->getJson('/api/v1/patients?query=al&page=100001')->assertStatus(422);
        $this->actingAsFresh($this->reception)->getJson('/api/v1/patients?query=al&page=9223372036854775807')->assertStatus(422);
        $this->assertSame(['Alpha'], $this->names('al'));
    }

    public function test_un_nom_qui_commence_par_ee_reste_cherche_comme_un_nom(): void
    {
        $this->seedPatient('Eekhout', 'Paul', '600000001');

        $this->assertSame(['Eekhout'], $this->names('Ee-khout'));
        $this->assertSame([], $this->names('EE-2099'));
    }

    public function test_la_recherche_est_limitee_en_debit_par_compte(): void
    {
        config(['eeo.rate_limits.patient_search' => 3]);
        $this->seedPatient('Alpha', null, '600000001');

        foreach ([1, 2, 3] as $attempt) {
            $this->actingAsFresh($this->reception)->getJson('/api/v1/patients?query=alpha')->assertOk();
        }
        $this->actingAsFresh($this->reception)->getJson('/api/v1/patients?query=alpha')
            ->assertStatus(429)
            ->assertJsonPath('error.code', 'RATE_LIMITED');
    }

    public function test_pagination_de_25_en_ordre_stable_meme_avec_des_homonymes(): void
    {
        for ($i = 1; $i <= 30; $i++) {
            $this->seedPatient('Homonyme', sprintf('Prénom %02d', $i), null);
        }

        $first = $this->actingAsFresh($this->reception)->getJson('/api/v1/patients?query=homonyme');
        $second = $this->actingAsFresh($this->reception)->getJson('/api/v1/patients?query=homonyme&page=2');
        $outOfRange = $this->actingAsFresh($this->reception)->getJson('/api/v1/patients?query=homonyme&page=9');

        $first->assertOk()->assertJsonPath('meta.per_page', 25)->assertJsonPath('meta.total', 30)->assertJsonPath('meta.last_page', 2);
        $this->assertCount(25, $first->json('data'));
        $this->assertCount(5, $second->json('data'));
        $this->assertSame(0, count($outOfRange->json('data')));
        $firstNames = array_merge(array_column($first->json('data'), 'first_names'), array_column($second->json('data'), 'first_names'));
        $sorted = $firstNames;
        sort($sorted);
        $this->assertSame($sorted, $firstNames, 'Ordre déterministe, sans doublon entre deux pages.');
        $this->assertCount(30, array_unique($firstNames));
    }

    #[DataProvider('invalidPages')]
    public function test_une_page_invalide_est_refusee(string $page): void
    {
        $this->actingAsFresh($this->reception)->getJson('/api/v1/patients?query=al&page='.$page)->assertStatus(422);
    }

    /**
     * @return array<string, array{0: string}>
     */
    public static function invalidPages(): array
    {
        return ['zéro' => ['0'], 'négative' => ['-1'], 'texte' => ['abc'], 'décimale' => ['1.5']];
    }
}
