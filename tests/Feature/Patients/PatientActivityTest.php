<?php

namespace Tests\Feature\Patients;

use App\Domain\Shared\Ulid;
use App\Models\User;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Support\MigratedDatabase;
use Tests\Support\PatientActivityFixtures;
use Tests\TestCase;

/**
 * Activité du patient (onglet « Activité » de la fiche ; R02 « activité patient » ; fichier 09 : identité, clinique
 * et finance séparées) : GET /api/v1/patients/{id}/activity, sur MySQL réel. Ordre du plus récent au plus ancien,
 * pagination, filtre par section, matrice des quatre profils seedés et dérogations DENY, modules fermés, isolation
 * entre cabinets, aucune valeur clinique (sentinelles) et aucun indice d'une section non autorisée. Données fictives.
 */
final class PatientActivityTest extends TestCase
{
    use MigratedDatabase;
    use PatientActivityFixtures;

    private const SCHEMA = 'schemas/resources/patients.json#/$defs/PatientActivity';

    protected function setUp(): void
    {
        parent::setUp();
        // Horloge figée AVANT la création des comptes (voir PatientActivityFixtures).
        $this->bootActivity();
    }

    protected function tearDown(): void
    {
        $this->resetClock();
        parent::tearDown();
    }

    /**
     * Dossier fictif complet. Clés : v1, c1, p1, i1, pay1, r1, p2, v2 ; numéros : i1_number, r1_number.
     *
     * Ordre attendu (du plus récent au plus ancien) :
     *   v2 15/10 10:00 · p2 10/10 12:00 · r1 01/10 09:05 · i1 09:00 · p1 08:40 (validation) ·
     *   ordonnance de médicaments de c1 08:10 · c1 08:10 · v1 08:00
     *
     * @return array<string, string>
     */
    private function timeline(): array
    {
        $v1 = $this->seedActivityVisit('2026-10-01 08:00:00', ['status' => 'COMPLETED']);
        $c1 = $this->seedActivityConsultation($v1, '2026-10-01 08:10:00', 'COMPLETED');
        $this->seedMedicationOrder($c1);
        $this->seedMedicationOrder($c1, 2);
        $p1 = $this->seedOpticalPrescription($c1, '2026-10-01 08:30:00', '2026-10-01 08:40:00');
        [$i1, $i1Number] = $this->seedIssuedInvoice(50000, '2026-10-01 09:00:00');
        [$pay1, $r1, $r1Number] = $this->seedPaymentWithReceipt($i1, 20000, '2026-10-01 09:05:00');
        $p2 = $this->seedOpticalPrescription(null, '2026-10-10 12:00:00');
        $v2 = $this->seedActivityVisit('2026-10-15 10:00:00', ['reason' => 'PICKUP']);

        return [
            'v1' => $v1, 'c1' => $c1, 'p1' => $p1, 'i1' => $i1, 'pay1' => $pay1, 'r1' => $r1, 'p2' => $p2, 'v2' => $v2,
            'i1_number' => $i1Number, 'r1_number' => $r1Number,
        ];
    }

    /**
     * « TYPE:identifiant » de chaque élément, dans l'ordre de la réponse.
     *
     * @return list<string>
     */
    private static function keys(TestResponse $response): array
    {
        return array_map(
            static fn (array $item): string => $item['type'].':'.$item['id'],
            (array) $response->json('data'),
        );
    }

    /**
     * @param  array<string, string>  $ids
     * @param  list<string>  $expected  « TYPE:clé » (clé de timeline())
     * @return list<string>
     */
    private static function expand(array $ids, array $expected): array
    {
        return array_map(static function (string $entry) use ($ids): string {
            [$type, $key] = explode(':', $entry);

            return $type.':'.$ids[$key];
        }, $expected);
    }

    /**
     * @return array<string, int>
     */
    private static function sections(TestResponse $response): array
    {
        $sections = [];
        foreach ((array) $response->json('meta.sections') as $section) {
            $sections[(string) $section['section']] = (int) $section['total'];
        }

        return $sections;
    }

    private function user(string $role): User
    {
        return match ($role) {
            'MANAGER' => $this->manager,
            'CLINICIAN' => $this->clinician,
            'RECEPTION' => $this->reception,
            'CASHIER' => $this->cashier,
        };
    }

    public function test_la_gerante_voit_toute_l_activite_du_plus_recent_au_plus_ancien(): void
    {
        $ids = $this->timeline();

        $response = $this->readActivity($this->manager)->assertOk();

        $this->assertMatchesContract($response, self::SCHEMA);
        $this->assertSame(self::expand($ids, [
            'VISIT:v2', 'PRESCRIPTION:p2', 'RECEIPT:r1', 'INVOICE:i1', 'PRESCRIPTION:p1', 'MEDICATION_ORDER:c1', 'CONSULTATION:c1', 'VISIT:v1',
        ]), self::keys($response));
        $response->assertJsonPath('meta.current_page', 1)
            ->assertJsonPath('meta.last_page', 1)
            ->assertJsonPath('meta.per_page', 25)
            ->assertJsonPath('meta.total', 8)
            ->assertJsonPath('meta.section', null);
        // Une ordonnance de médicaments par consultation, quel que soit le nombre de lignes.
        $this->assertSame(['VISITS' => 2, 'EXAMS' => 1, 'PRESCRIPTIONS' => 3, 'FINANCIAL' => 2], self::sections($response));

        $items = (array) $response->json('data');
        // Visite : motif et statut administratifs, aucun écran de visite.
        $this->assertSame(['type' => 'VISIT', 'id' => $ids['v2'], 'occurred_at' => '2026-10-15T10:00:00.000Z', 'screen_path' => null, 'reason' => 'PICKUP', 'status' => 'ARRIVED'], $items[0]);
        // Prescription externe : ouvre l'onglet Prescriptions du dossier patient.
        $this->assertSame('EXTERNAL', $items[1]['origin']);
        $this->assertSame('DRAFT', $items[1]['status']);
        $this->assertSame('2026-09-30', $items[1]['external_prescribed_on']);
        $this->assertSame('/patients/'.$this->patientId.'/prescriptions', $items[1]['screen_path']);
        // Reçu : numéro, montant, mode, facture d'origine ; jamais la référence du paiement.
        $this->assertSame('/ventes/factures/'.$ids['i1'], $items[2]['screen_path']);
        $this->assertSame($ids['r1_number'], $items[2]['number']);
        $this->assertSame(20000, $items[2]['amount']);
        $this->assertSame('MTN_MOMO', $items[2]['method']);
        $this->assertSame(0, $items[2]['reversed_amount']);
        $this->assertSame($ids['i1'], $items[2]['invoice_id']);
        $this->assertSame($ids['i1_number'], $items[2]['invoice_number']);
        // Facture : solde issu de la projection, jamais un statut « payé ».
        $this->assertSame([
            'type' => 'INVOICE', 'id' => $ids['i1'], 'occurred_at' => '2026-10-01T09:00:00.000Z', 'screen_path' => '/ventes/factures/'.$ids['i1'],
            'number' => $ids['i1_number'], 'origin' => 'NATIVE', 'total_gross' => 50000, 'paid_net' => 20000,
            'balance_due' => 30000, 'credit_available' => 0, 'settlement' => 'PARTIALLY_PAID',
        ], $items[3]);
        // Prescription interne : date de validation, version, lien vers les prescriptions de la consultation.
        $this->assertSame('2026-10-01T08:40:00.000Z', $items[4]['occurred_at']);
        $this->assertSame(['INTERNAL', 'VALIDATED', 1, $ids['c1']], [$items[4]['origin'], $items[4]['status'], $items[4]['version_no'], $items[4]['consultation_id']]);
        $this->assertSame('/consultations/'.$ids['c1'].'/prescriptions', $items[4]['screen_path']);
        // Ordonnance de médicaments : identifiant et état de la consultation, aucun nom de médicament.
        $this->assertSame(['type' => 'MEDICATION_ORDER', 'id' => $ids['c1'], 'occurred_at' => '2026-10-01T08:10:00.000Z', 'screen_path' => '/consultations/'.$ids['c1'], 'consultation_id' => $ids['c1'], 'consultation_status' => 'COMPLETED'], $items[5]);
        // Examen : date, état, professionnel, lien vers la consultation ; rien d'autre.
        $this->assertSame(['type' => 'CONSULTATION', 'id' => $ids['c1'], 'occurred_at' => '2026-10-01T08:10:00.000Z', 'screen_path' => '/consultations/'.$ids['c1'], 'status' => 'COMPLETED', 'clinician_name' => 'TEST CLINICIAN'], $items[6]);

        $this->assertStringNotContainsString('"PAID"', (string) $response->getContent());
    }

    /**
     * @return array<string, array{0: string, 1: list<string>, 2: list<string>}>
     */
    public static function roles(): array
    {
        return [
            'gérante : tout' => ['MANAGER', ['VISITS', 'EXAMS', 'PRESCRIPTIONS', 'FINANCIAL'],
                ['VISIT:v2', 'PRESCRIPTION:p2', 'RECEIPT:r1', 'INVOICE:i1', 'PRESCRIPTION:p1', 'MEDICATION_ORDER:c1', 'CONSULTATION:c1', 'VISIT:v1']],
            'professionnel : visites et clinique' => ['CLINICIAN', ['VISITS', 'EXAMS', 'PRESCRIPTIONS'],
                ['VISIT:v2', 'PRESCRIPTION:p2', 'PRESCRIPTION:p1', 'MEDICATION_ORDER:c1', 'CONSULTATION:c1', 'VISIT:v1']],
            'accueil : visites seulement' => ['RECEPTION', ['VISITS'], ['VISIT:v2', 'VISIT:v1']],
            'caisse : visites et pièces' => ['CASHIER', ['VISITS', 'FINANCIAL'], ['VISIT:v2', 'RECEIPT:r1', 'INVOICE:i1', 'VISIT:v1']],
        ];
    }

    /**
     * @param  list<string>  $sections
     * @param  list<string>  $expected
     */
    #[DataProvider('roles')]
    public function test_chaque_profil_ne_recoit_que_les_sections_de_ses_droits(string $role, array $sections, array $expected): void
    {
        $ids = $this->timeline();

        $response = $this->readActivity($this->user($role))->assertOk();

        $this->assertMatchesContract($response, self::SCHEMA);
        $this->assertSame($sections, array_keys(self::sections($response)));
        $this->assertSame(self::expand($ids, $expected), self::keys($response));
        $this->assertSame(count($expected), $response->json('meta.total'));
    }

    /**
     * @return array<string, array{0: string}>
     */
    public static function allRoles(): array
    {
        return ['gérante' => ['MANAGER'], 'professionnel' => ['CLINICIAN'], 'accueil' => ['RECEPTION'], 'caisse' => ['CASHIER']];
    }

    #[DataProvider('allRoles')]
    public function test_aucune_valeur_clinique_ni_reference_de_paiement_ne_sort_quel_que_soit_le_profil(string $role): void
    {
        $this->timeline();

        $body = (string) $this->readActivity($this->user($role))->assertOk()->getContent();

        $this->assertStringNotContainsString(self::CLINICAL_SENTINEL, $body);
        $this->assertStringNotContainsString(self::PAYMENT_SENTINEL, $body);
        foreach (['symptoms', 'conclusion', 'referral', 'notes', 'external_prescriber', 'name', 'dosage', 'pd_total', 'reference'] as $field) {
            $this->assertStringNotContainsString('"'.$field.'"', $body, $role.' : '.$field);
        }
    }

    /**
     * @return array<string, array{0: string}>
     */
    public static function nonClinicalRoles(): array
    {
        return ['accueil' => ['RECEPTION'], 'caisse' => ['CASHIER']];
    }

    #[DataProvider('nonClinicalRoles')]
    public function test_l_accueil_et_la_caisse_ne_recoivent_aucun_indice_de_l_examen(string $role): void
    {
        $ids = $this->timeline();

        $body = (string) $this->readActivity($this->user($role))->assertOk()->getContent();

        foreach ([$ids['c1'], $ids['p1'], $ids['p2'], 'TEST CLINICIAN', '"EXAMS"', '"PRESCRIPTIONS"', '"CONSULTATION"', '"PRESCRIPTION"', '"MEDICATION_ORDER"', '/consultations/'] as $absent) {
            $this->assertStringNotContainsString($absent, $body, $role.' : '.$absent);
        }
    }

    /**
     * @return array<string, array{0: string}>
     */
    public static function nonFinancialRoles(): array
    {
        return ['accueil' => ['RECEPTION'], 'professionnel' => ['CLINICIAN']];
    }

    #[DataProvider('nonFinancialRoles')]
    public function test_l_accueil_et_le_professionnel_ne_recoivent_aucun_indice_des_pieces(string $role): void
    {
        $ids = $this->timeline();

        $body = (string) $this->readActivity($this->user($role))->assertOk()->getContent();

        foreach ([$ids['i1'], $ids['r1'], $ids['i1_number'], $ids['r1_number'], '"FINANCIAL"', '"INVOICE"', '"RECEIPT"', '50000', '20000', 'settlement'] as $absent) {
            $this->assertStringNotContainsString($absent, $body, $role.' : '.$absent);
        }
    }

    public function test_une_derogation_deny_retire_la_section_correspondante(): void
    {
        $ids = $this->timeline();

        $this->denyPermission($this->manager, 'clinical.read');
        $withoutClinical = $this->readActivity($this->manager)->assertOk();
        $this->assertSame(['VISITS', 'FINANCIAL'], array_keys(self::sections($withoutClinical)));
        $this->assertSame(self::expand($ids, ['VISIT:v2', 'RECEIPT:r1', 'INVOICE:i1', 'VISIT:v1']), self::keys($withoutClinical));
        $this->assertStringNotContainsString($ids['c1'], (string) $withoutClinical->getContent());

        $this->denyPermission($this->cashier, 'invoice.read');
        $cashierWithoutInvoices = $this->readActivity($this->cashier)->assertOk();
        $this->assertSame(['VISITS'], array_keys(self::sections($cashierWithoutInvoices)));
        $this->assertSame(self::expand($ids, ['VISIT:v2', 'VISIT:v1']), self::keys($cashierWithoutInvoices));

        $this->denyPermission($this->clinician, 'patient.read');
        $this->readActivity($this->clinician)->assertStatus(403)->assertJsonPath('error.code', 'ACTION_FORBIDDEN');
    }

    public function test_une_derogation_deny_sur_invoice_read_retire_les_pieces_a_la_gerante(): void
    {
        $ids = $this->timeline();

        $this->denyPermission($this->manager, 'invoice.read');
        $response = $this->readActivity($this->manager)->assertOk();

        $this->assertSame(['VISITS', 'EXAMS', 'PRESCRIPTIONS'], array_keys(self::sections($response)));
        $this->assertStringNotContainsString($ids['i1_number'], (string) $response->getContent());
        $this->readActivity($this->manager, '?section=FINANCIAL')->assertStatus(403);
    }

    public function test_un_module_ferme_retire_ses_sections_et_le_module_patients_ferme_repond_404(): void
    {
        $ids = $this->timeline();

        config(['eeo.enabled_modules' => ['today', 'patients', 'sales']]);
        $withoutConsultations = $this->readActivity($this->manager)->assertOk();
        $this->assertSame(['VISITS', 'FINANCIAL'], array_keys(self::sections($withoutConsultations)));
        $this->assertStringNotContainsString($ids['c1'], (string) $withoutConsultations->getContent());

        config(['eeo.enabled_modules' => ['today', 'patients', 'consultations']]);
        $withoutSales = $this->readActivity($this->manager)->assertOk();
        $this->assertSame(['VISITS', 'EXAMS', 'PRESCRIPTIONS'], array_keys(self::sections($withoutSales)));
        $this->assertStringNotContainsString($ids['i1'], (string) $withoutSales->getContent());

        config(['eeo.enabled_modules' => ['today', 'consultations', 'sales']]);
        $this->readActivity($this->manager)->assertStatus(404)->assertJsonPath('error.code', 'RESOURCE_NOT_FOUND');
    }

    public function test_un_patient_d_un_autre_cabinet_ou_inconnu_repond_404(): void
    {
        $this->timeline();
        $otherClinic = $this->makeClinic('TEST CABINET B');
        $otherManager = $this->makeStaff($otherClinic, 'MANAGER', 'gerante.b');
        $otherPatient = $this->seedPatient($otherClinic, 'Autre Patient Fictif');
        $otherVisit = $this->seedActivityVisit('2026-10-20 08:00:00', [], $otherClinic, $otherPatient);

        // Le dossier du cabinet A n'existe pas pour le cabinet B, et réciproquement.
        $this->readActivity($otherManager)->assertStatus(404)->assertJsonPath('error.code', 'RESOURCE_NOT_FOUND');
        $this->readActivity($this->manager, '', $otherPatient)->assertStatus(404);
        $this->readActivity($this->manager, '', Ulid::generate())->assertStatus(404);
        $this->actingAsFresh($this->manager)->getJson('/api/v1/patients/pas-un-identifiant/activity')->assertStatus(404);

        // Chaque cabinet ne lit que ses lignes.
        $own = $this->readActivity($otherManager, '', $otherPatient)->assertOk();
        $this->assertSame(['VISIT:'.$otherVisit], self::keys($own));
        $this->assertStringNotContainsString($otherVisit, (string) $this->readActivity($this->manager)->getContent());
    }

    public function test_la_pagination_est_stable_du_plus_recent_au_plus_ancien(): void
    {
        $visits = [];
        for ($minute = 0; $minute < 30; $minute++) {
            $visits[] = $this->seedActivityVisit(sprintf('2026-10-02 08:%02d:00', $minute));
        }
        // Deux visites au même instant : départagées par identifiant décroissant.
        $twinA = $this->seedActivityVisit('2026-10-02 08:29:00');
        $twinB = $this->seedActivityVisit('2026-10-02 08:29:00');
        $recent = array_reverse($visits);

        $first = $this->readActivity($this->reception, '?page=1')->assertOk();
        $this->assertMatchesContract($first, self::SCHEMA);
        $first->assertJsonPath('meta.current_page', 1)->assertJsonPath('meta.last_page', 2)->assertJsonPath('meta.total', 32)->assertJsonPath('meta.per_page', 25);
        $this->assertCount(25, (array) $first->json('data'));
        $atLatest = [$twinA, $twinB, $recent[0]];
        rsort($atLatest, SORT_STRING);
        $this->assertSame(array_map(static fn (string $id): string => 'VISIT:'.$id, $atLatest), array_slice(self::keys($first), 0, 3));

        $second = $this->readActivity($this->reception, '?page=2')->assertOk();
        $this->assertMatchesContract($second, self::SCHEMA);
        $this->assertCount(7, (array) $second->json('data'));
        $this->assertSame('VISIT:'.$visits[0], self::keys($second)[6]);
        $this->assertSame([], array_values(array_intersect(self::keys($first), self::keys($second))));

        $beyond = $this->readActivity($this->reception, '?page=3')->assertOk();
        $this->assertSame([], $beyond->json('data'));
        $beyond->assertJsonPath('meta.current_page', 3)->assertJsonPath('meta.last_page', 2)->assertJsonPath('meta.total', 32);

        foreach (['0', 'abc', '-1', '100001'] as $page) {
            $this->readActivity($this->reception, '?page='.$page)->assertStatus(422)->assertJsonStructure(['error' => ['fields' => ['page']]]);
        }
    }

    public function test_le_filtre_par_section_ne_rend_que_cette_section(): void
    {
        $ids = $this->timeline();

        $financial = $this->readActivity($this->manager, '?section=FINANCIAL')->assertOk();
        $this->assertMatchesContract($financial, self::SCHEMA);
        $this->assertSame(self::expand($ids, ['RECEIPT:r1', 'INVOICE:i1']), self::keys($financial));
        $financial->assertJsonPath('meta.section', 'FINANCIAL')->assertJsonPath('meta.total', 2);
        // Les comptes des autres sections visibles restent donnés (filtres de l'écran).
        $this->assertSame(['VISITS' => 2, 'EXAMS' => 1, 'PRESCRIPTIONS' => 3, 'FINANCIAL' => 2], self::sections($financial));

        $prescriptions = $this->readActivity($this->clinician, '?section=PRESCRIPTIONS')->assertOk();
        $this->assertSame(self::expand($ids, ['PRESCRIPTION:p2', 'PRESCRIPTION:p1', 'MEDICATION_ORDER:c1']), self::keys($prescriptions));

        $visits = $this->readActivity($this->reception, '?section=VISITS')->assertOk();
        $this->assertSame(self::expand($ids, ['VISIT:v2', 'VISIT:v1']), self::keys($visits));

        // Une section que le compte ne voit pas : refus, sans aucune donnée du dossier.
        $refused = $this->readActivity($this->reception, '?section=EXAMS')->assertStatus(403);
        $this->assertStringNotContainsString($ids['c1'], (string) $refused->getContent());
        $this->readActivity($this->clinician, '?section=FINANCIAL')->assertStatus(403);
        $this->readActivity($this->cashier, '?section=PRESCRIPTIONS')->assertStatus(403);

        $this->readActivity($this->manager, '?section=INCONNUE')->assertStatus(422)->assertJsonStructure(['error' => ['fields' => ['section']]]);
        $this->readActivity($this->manager, '?section[]=VISITS')->assertStatus(422);
    }

    public function test_les_brouillons_et_pieces_abandonnees_sont_exclus_et_le_solde_vient_de_la_projection(): void
    {
        $this->seedDraftInvoice(12000, '2026-10-03 08:00:00');
        $this->seedDraftInvoice(13000, '2026-10-03 08:30:00', 'ABANDONED');

        // Aucune pièce encaissée : non réglée.
        [$unpaid] = $this->seedIssuedInvoice(15000, '2026-10-04 08:00:00');
        // Encaissement total : solde nul.
        [$settled] = $this->seedIssuedInvoice(10000, '2026-10-05 08:00:00');
        $this->seedPaymentWithReceipt($settled, 10000, '2026-10-05 08:05:00');
        // Encaissement contre-passé : rien d'encaissé net, le reçu reste et dit la contre-écriture.
        [$reversed] = $this->seedIssuedInvoice(20000, '2026-10-06 08:00:00');
        [$reversedPayment, $reversedReceipt] = $this->seedPaymentWithReceipt($reversed, 20000, '2026-10-06 08:05:00');
        $this->seedReversal($reversedPayment, 20000, '2026-10-06 09:00:00');
        // Encaissement total puis avoir émis : crédit à rembourser ; un avoir brouillon ne compte pas.
        [$credited] = $this->seedIssuedInvoice(8000, '2026-10-07 08:00:00');
        $this->seedPaymentWithReceipt($credited, 8000, '2026-10-07 08:05:00');
        [$creditNote, $creditNumber] = $this->seedCreditNote($credited, 3000, '2026-10-07 09:00:00');
        $this->seedCreditNote($credited, 1000, '2026-10-07 09:10:00', 'DRAFT');
        // Encaissement total, avoir puis remboursement du crédit : solde nul.
        [$refunded] = $this->seedIssuedInvoice(6000, '2026-10-08 08:00:00');
        $this->seedPaymentWithReceipt($refunded, 6000, '2026-10-08 08:05:00');
        [$refundCredit] = $this->seedCreditNote($refunded, 2000, '2026-10-08 09:00:00');
        [$refund, $refundNumber] = $this->seedRefund($refunded, $refundCredit, 2000, '2026-10-08 10:00:00');

        $response = $this->readActivity($this->cashier, '?section=FINANCIAL')->assertOk();
        $this->assertMatchesContract($response, self::SCHEMA);

        $invoices = [];
        $byId = [];
        foreach ((array) $response->json('data') as $item) {
            $byId[$item['id']] = $item;
            if ($item['type'] === 'INVOICE') {
                $invoices[$item['id']] = [$item['settlement'], $item['balance_due'], $item['paid_net'], $item['credit_available']];
            }
        }
        // Ni brouillon ni facture abandonnée : seules les cinq factures émises.
        $this->assertSame([
            $refunded => ['SETTLED', 0, 6000, 0],
            $credited => ['IN_CREDIT', -3000, 8000, 3000],
            $reversed => ['UNPAID', 20000, 0, 0],
            $settled => ['SETTLED', 0, 10000, 0],
            $unpaid => ['UNPAID', 15000, 0, 0],
        ], $invoices);
        $this->assertSame(20000, $byId[$reversedReceipt]['reversed_amount']);
        $this->assertSame($creditNumber, $byId[$creditNote]['number']);
        $this->assertSame(3000, $byId[$creditNote]['amount_gross']);
        $this->assertSame($refundNumber, $byId[$refund]['number']);
        $this->assertSame(2000, $byId[$refund]['amount']);
        // 5 factures, 4 reçus, 2 avoirs émis, 1 remboursement.
        $response->assertJsonPath('meta.total', 12);
        $this->assertStringNotContainsString('"PAID"', (string) $response->getContent());
        $this->assertStringNotContainsString('12000', (string) $response->getContent());
        $this->assertStringNotContainsString('13000', (string) $response->getContent());
    }

    public function test_un_dossier_sans_activite_le_dit_par_des_comptes_a_zero(): void
    {
        $response = $this->readActivity($this->manager)->assertOk();

        $this->assertMatchesContract($response, self::SCHEMA);
        $this->assertSame([], $response->json('data'));
        $response->assertJsonPath('meta.total', 0)->assertJsonPath('meta.last_page', 1);
        $this->assertSame(['VISITS' => 0, 'EXAMS' => 0, 'PRESCRIPTIONS' => 0, 'FINANCIAL' => 0], self::sections($response));

        $reception = $this->readActivity($this->reception)->assertOk();
        $this->assertSame(['VISITS' => 0], self::sections($reception));
    }

    public function test_chaque_version_d_une_prescription_reste_une_entree(): void
    {
        $visit = $this->seedActivityVisit('2026-10-01 08:00:00');
        $consultation = $this->seedActivityConsultation($visit, '2026-10-01 08:10:00');
        $series = Ulid::generate();
        $first = $this->seedOpticalPrescription($consultation, '2026-10-01 08:30:00', '2026-10-01 08:40:00', ['series_id' => $series]);
        $second = $this->seedOpticalPrescription($consultation, '2026-10-03 09:00:00', null, ['series_id' => $series, 'version_no' => 2, 'supersedes_id' => $first]);

        $response = $this->readActivity($this->clinician, '?section=PRESCRIPTIONS')->assertOk();

        $this->assertSame(['PRESCRIPTION:'.$second, 'PRESCRIPTION:'.$first], self::keys($response));
        $this->assertSame([2, 1], array_column((array) $response->json('data'), 'version_no'));
        $this->assertSame(['DRAFT', 'VALIDATED'], array_column((array) $response->json('data'), 'status'));
    }
}
