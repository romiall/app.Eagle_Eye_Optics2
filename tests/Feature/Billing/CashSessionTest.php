<?php

namespace Tests\Feature\Billing;

use App\Application\Checkpoint;
use App\Application\Command;
use App\Application\CommandBusProbe;
use App\Application\Locking\TransactionLocks;
use App\Domain\Cash\Handlers\CloseCashSessionHandler;
use App\Domain\Cash\Handlers\OpenCashSessionHandler;
use App\Domain\Shared\BusinessError;
use App\Domain\Shared\CommandContext;
use App\Domain\Shared\Ulid;
use Carbon\CarbonImmutable;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\DataProvider;
use RuntimeException;
use Tests\Support\BillingFixtures;
use Tests\Support\Commands\RecordingProbe;
use Tests\Support\MigratedDatabase;
use Tests\TestCase;

/**
 * Session de caisse (B05, EE030, AT25) : ouverture avec fond, une session ouverte par caisse et par caissière, attendu
 * recalculé par le serveur à la clôture, écart motivé, session close figée. Dates du serveur. Données fictives.
 */
final class CashSessionTest extends TestCase
{
    use BillingFixtures;
    use MigratedDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->bootBilling();
    }

    protected function tearDown(): void
    {
        $this->resetClock();
        parent::tearDown();
    }

    /**
     * Encaisse des espèces dans la session, sur une facture émise de 80 000 : identifiant de la facture.
     */
    private function cashPayment(string $sessionId, int $amount): string
    {
        [$invoice] = $this->issuedUncollectedInvoice([$this->line($this->item['lens'], '1', 1, 80000)], $this->manager);
        $this->pay($invoice, 1, $amount, 'CASH', ['cash_session_id' => $sessionId])->assertCreated();

        return $invoice;
    }

    // ------------------------------------------------------------------------------------------------------------
    // Caisses et session courante
    // ------------------------------------------------------------------------------------------------------------

    public function test_la_caisse_principale_est_listee_pour_les_comptes_de_caisse(): void
    {
        $response = $this->read('/api/v1/cash-registers', $this->cashier)->assertOk();

        $response->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $this->registerId)->assertJsonPath('data.0.code', 'CAISSE-PRINCIPALE')->assertJsonPath('data.0.active', true);
        $this->assertMatchesContract($response, 'schemas/resources/billing.json#/$defs/CashRegisterList');
        $this->read('/api/v1/cash-registers', $this->manager)->assertOk();
        $this->read('/api/v1/cash-registers', $this->reception)->assertForbidden();
        $this->read('/api/v1/cash-registers', $this->clinician)->assertForbidden();
    }

    public function test_une_caisse_desactivee_n_est_plus_listee(): void
    {
        DB::table('cash_registers')->where('id', $this->registerId)->update(['active' => 0]);

        $this->read('/api/v1/cash-registers', $this->cashier)->assertOk()->assertJsonPath('data', []);
    }

    public function test_sans_session_ouverte_la_session_courante_est_nulle(): void
    {
        $response = $this->read('/api/v1/cash-sessions/current', $this->cashier)->assertOk();

        $response->assertJsonPath('data', null);
        $this->assertMatchesContract($response, 'schemas/resources/billing.json#/$defs/CurrentCashSessionResponse');
    }

    public function test_la_session_courante_est_celle_du_compte_connecte(): void
    {
        $session = $this->openedSession($this->cashier);

        $this->read('/api/v1/cash-sessions/current', $this->cashier)->assertJsonPath('data.id', $session);
        $this->read('/api/v1/cash-sessions/current', $this->manager)->assertJsonPath('data', null);
    }

    // ------------------------------------------------------------------------------------------------------------
    // Ouverture
    // ------------------------------------------------------------------------------------------------------------

    public function test_l_ouverture_enregistre_le_fond_avec_la_date_du_serveur(): void
    {
        $body = $this->openSessionBody(25000, ['opened_at' => '2026-10-22T09:27:00.000Z']);

        $response = $this->write('POST', '/api/v1/cash-sessions', $body, $this->cashier);

        $response->assertCreated()
            ->assertJsonPath('data.id', $body['cash_session_id'])
            ->assertJsonPath('data.cash_register_id', $this->registerId)
            ->assertJsonPath('data.cashier_id', $this->cashier->id)
            ->assertJsonPath('data.opening_amount', 25000)
            ->assertJsonPath('data.opened_at', self::NOW)
            ->assertJsonPath('data.closed_at', null)
            ->assertJsonPath('data.counted_amount', null)
            ->assertJsonPath('data.collected_cash', 0)
            ->assertJsonPath('data.theoretical_cash', 25000);
        $this->assertMatchesContract($response, 'schemas/resources/billing.json#/$defs/CashSessionResponse');

        $audit = DB::table('audit_events')->where('action', 'cash_session.opened')->first();
        $this->assertNotNull($audit);
        $this->assertSame([$this->cashier->id, $body['cash_session_id']], [$audit->actor_id, $audit->target_id]);
        $change = DB::table('sync_change_log')->where('entity_type', 'cash_sessions')->first();
        $this->assertNotNull($change);
        $this->assertSame([$body['cash_session_id'], 'FINANCIAL', 'CREATED'], [$change->entity_id, $change->visibility, $change->change_kind]);
    }

    public function test_un_fond_nul_est_admis_et_un_fond_negatif_ou_decimal_refuse(): void
    {
        $this->write('POST', '/api/v1/cash-sessions', $this->openSessionBody(-1), $this->cashier)->assertStatus(422)->assertJsonPath('error.code', 'VALIDATION_FAILED');
        $this->write('POST', '/api/v1/cash-sessions', $this->openSessionBody(0, ['opening_amount' => 100.5]), $this->cashier)->assertStatus(422);
        $this->assertSame(0, DB::table('cash_sessions')->count());

        $this->write('POST', '/api/v1/cash-sessions', $this->openSessionBody(0), $this->cashier)->assertCreated()->assertJsonPath('data.opening_amount', 0);
    }

    public function test_une_session_ouverte_par_caisse_et_par_caissiere(): void
    {
        $this->openedSession($this->cashier);

        // Même caissière, même caisse.
        $this->write('POST', '/api/v1/cash-sessions', $this->openSessionBody(), $this->cashier)
            ->assertStatus(409)->assertJsonPath('error.code', 'STATE_TRANSITION_REFUSED')->assertJsonPath('error.details.current_status', 'OPEN');
        // Autre compte, même caisse.
        $this->write('POST', '/api/v1/cash-sessions', $this->openSessionBody(), $this->manager)
            ->assertStatus(409)->assertJsonPath('error.code', 'STATE_TRANSITION_REFUSED');
        // Même caissière, autre caisse.
        $second = $this->seedRegister($this->clinicId, 'CAISSE-2');
        $this->write('POST', '/api/v1/cash-sessions', $this->openSessionBody(10000, ['cash_register_id' => $second]), $this->cashier)
            ->assertStatus(409)->assertJsonPath('error.code', 'STATE_TRANSITION_REFUSED');
        $this->assertSame(1, DB::table('cash_sessions')->count());

        // Autre compte, autre caisse : admis.
        $this->write('POST', '/api/v1/cash-sessions', $this->openSessionBody(10000, ['cash_register_id' => $second]), $this->manager)->assertCreated();
        $this->assertSame(2, DB::table('cash_sessions')->whereNull('closed_at')->count());
    }

    public function test_une_caisse_inconnue_desactivee_ou_un_identifiant_pris_est_refuse_sans_erreur_sql(): void
    {
        $session = $this->openedSession($this->cashier);
        $this->write('POST', '/api/v1/cash-sessions/'.$session.'/close', $this->closeSessionBody($session, 25000, 25000), $this->cashier)->assertOk();

        $this->write('POST', '/api/v1/cash-sessions', $this->openSessionBody(100, ['cash_register_id' => Ulid::generate()]), $this->cashier)
            ->assertStatus(422)->assertJsonStructure(['error' => ['fields' => ['cash_register_id']]]);
        $this->write('POST', '/api/v1/cash-sessions', $this->openSessionBody(100, ['cash_session_id' => $session]), $this->cashier)
            ->assertStatus(422)->assertJsonStructure(['error' => ['fields' => ['cash_session_id']]]);
        DB::table('cash_registers')->where('id', $this->registerId)->update(['active' => 0]);
        $this->write('POST', '/api/v1/cash-sessions', $this->openSessionBody(100), $this->cashier)
            ->assertStatus(422)->assertJsonStructure(['error' => ['fields' => ['cash_register_id']]]);
    }

    public function test_l_horloge_du_poste_ne_peut_pas_etre_en_avance(): void
    {
        $this->write('POST', '/api/v1/cash-sessions', $this->openSessionBody(100, ['opened_at' => '2026-10-22T10:30:00.000Z']), $this->cashier)
            ->assertStatus(422)->assertJsonStructure(['error' => ['fields' => ['opened_at']]]);
        $this->assertSame(0, DB::table('cash_sessions')->count());
    }

    public function test_une_version_attendue_est_refusee_a_l_ouverture(): void
    {
        $this->write('POST', '/api/v1/cash-sessions', $this->openSessionBody(100, ['expected_version' => 1]), $this->cashier)->assertStatus(422);
        $this->assertSame(0, DB::table('cash_sessions')->count());
    }

    public function test_un_rejeu_de_l_ouverture_ne_cree_qu_une_session(): void
    {
        $body = $this->openSessionBody();
        $key = Ulid::generate();

        $first = $this->write('POST', '/api/v1/cash-sessions', $body, $this->cashier, $key)->assertCreated();
        $replay = $this->write('POST', '/api/v1/cash-sessions', $body, $this->cashier, $key)->assertCreated();
        $this->write('POST', '/api/v1/cash-sessions', [...$body, 'opening_amount' => 1], $this->cashier, $key)
            ->assertStatus(409)->assertJsonPath('error.code', 'IDEMPOTENCY_PAYLOAD_MISMATCH');

        $this->assertSame($first->json('data.id'), $replay->json('data.id'));
        $this->assertSame(1, DB::table('cash_sessions')->count());
    }

    public function test_seules_les_comptes_de_caisse_ouvrent_une_session_et_le_module_doit_etre_ouvert(): void
    {
        $this->write('POST', '/api/v1/cash-sessions', $this->openSessionBody(), $this->reception)->assertForbidden();
        $this->write('POST', '/api/v1/cash-sessions', $this->openSessionBody(), $this->clinician)->assertForbidden();
        config(['eeo.enabled_modules' => ['stock']]);
        $this->write('POST', '/api/v1/cash-sessions', $this->openSessionBody(), $this->cashier)->assertNotFound();
        $this->assertSame(0, DB::table('cash_sessions')->count());
    }

    // ------------------------------------------------------------------------------------------------------------
    // Clôture
    // ------------------------------------------------------------------------------------------------------------

    public function test_la_cloture_fige_le_compte_et_l_attendu_recalcule_par_le_serveur(): void
    {
        $session = $this->openedSession($this->cashier, 25000);
        $this->cashPayment($session, 30000);

        $response = $this->write('POST', '/api/v1/cash-sessions/'.$session.'/close', $this->closeSessionBody($session, 55000, 55000), $this->cashier);

        $response->assertOk()
            ->assertJsonPath('data.closed_at', self::NOW)
            ->assertJsonPath('data.counted_amount', 55000)
            ->assertJsonPath('data.expected_amount', 55000)
            ->assertJsonPath('data.variance', 0)
            ->assertJsonPath('data.variance_reason', null)
            ->assertJsonPath('data.closed_by', $this->cashier->id)
            ->assertJsonPath('data.collected_cash', 30000)
            ->assertJsonPath('data.theoretical_cash', 55000);
        $this->assertMatchesContract($response, 'schemas/resources/billing.json#/$defs/CashSessionResponse');
        $this->assertNotNull(DB::table('audit_events')->where('action', 'cash_session.closed')->first());
        $this->read('/api/v1/cash-sessions/current', $this->cashier)->assertJsonPath('data', null);
    }

    public function test_la_session_close_est_figee_par_le_schema(): void
    {
        $session = $this->openedSession($this->cashier, 25000);
        $this->write('POST', '/api/v1/cash-sessions/'.$session.'/close', $this->closeSessionBody($session, 25000, 25000), $this->cashier)->assertOk();

        foreach ([
            fn () => DB::table('cash_sessions')->where('id', $session)->update(['counted_amount' => 1]),
            fn () => DB::table('cash_sessions')->where('id', $session)->delete(),
        ] as $attempt) {
            try {
                DB::transaction($attempt);
                $this->fail('Le schéma devait refuser de modifier une session close.');
            } catch (QueryException $exception) {
                $this->assertStringContainsString('Finalized record is immutable', $exception->getMessage());
            }
        }
        $this->assertSame(25000, (int) DB::table('cash_sessions')->where('id', $session)->value('counted_amount'));
    }

    public function test_un_ecart_exige_un_motif_conserve_dans_l_audit(): void
    {
        $session = $this->openedSession($this->cashier, 25000);

        $this->write('POST', '/api/v1/cash-sessions/'.$session.'/close', $this->closeSessionBody($session, 24000, 25000), $this->cashier)
            ->assertStatus(422)->assertJsonStructure(['error' => ['fields' => ['variance_reason']]]);
        $this->assertNull(DB::table('cash_sessions')->where('id', $session)->value('closed_at'));

        $this->write('POST', '/api/v1/cash-sessions/'.$session.'/close', $this->closeSessionBody($session, 24000, 25000, 'Billet déchiré écarté'), $this->cashier)
            ->assertOk()->assertJsonPath('data.variance', -1000)->assertJsonPath('data.variance_reason', 'Billet déchiré écarté');
        $this->assertSame('Billet déchiré écarté', DB::table('audit_events')->where('action', 'cash_session.closed')->value('reason'));
    }

    public function test_un_ecart_mal_calcule_est_refuse(): void
    {
        $session = $this->openedSession($this->cashier, 25000);

        $this->write('POST', '/api/v1/cash-sessions/'.$session.'/close', $this->closeSessionBody($session, 24000, 25000, 'Motif', ['variance' => -500]), $this->cashier)
            ->assertStatus(422)->assertJsonStructure(['error' => ['fields' => ['variance']]]);
        $this->assertNull(DB::table('cash_sessions')->where('id', $session)->value('closed_at'));
    }

    public function test_un_encaissement_especes_apres_l_affichage_change_l_attendu_et_oblige_a_recompter(): void
    {
        $session = $this->openedSession($this->cashier, 25000);
        $this->cashPayment($session, 30000);

        // La caissière avait affiché 25 000 attendus avant cet encaissement.
        $response = $this->write('POST', '/api/v1/cash-sessions/'.$session.'/close', $this->closeSessionBody($session, 25000, 25000), $this->cashier);

        $response->assertStatus(409)->assertJsonPath('error.code', 'VERSION_CONFLICT')->assertJsonPath('error.details.expected_amount', 55000);
        $this->assertNull(DB::table('cash_sessions')->where('id', $session)->value('closed_at'));
    }

    public function test_une_session_ne_se_cloture_qu_une_fois_et_une_nouvelle_peut_s_ouvrir_ensuite(): void
    {
        $session = $this->openedSession($this->cashier, 25000);
        $this->write('POST', '/api/v1/cash-sessions/'.$session.'/close', $this->closeSessionBody($session, 25000, 25000), $this->cashier)->assertOk();

        $this->write('POST', '/api/v1/cash-sessions/'.$session.'/close', $this->closeSessionBody($session, 25000, 25000), $this->cashier)
            ->assertStatus(409)->assertJsonPath('error.code', 'STATE_TRANSITION_REFUSED')->assertJsonPath('error.details.current_status', 'CLOSED');
        $this->write('POST', '/api/v1/cash-sessions', $this->openSessionBody(30000), $this->cashier)->assertCreated();
    }

    public function test_seule_la_gerante_cloture_la_session_d_une_autre_caissiere(): void
    {
        $other = $this->makeStaff($this->clinicId, 'CASHIER', 'caisse2.test');
        $session = $this->openedSession($this->cashier, 25000);

        $this->write('POST', '/api/v1/cash-sessions/'.$session.'/close', $this->closeSessionBody($session, 25000, 25000), $other)->assertForbidden();
        $this->assertNull(DB::table('cash_sessions')->where('id', $session)->value('closed_at'));

        $this->write('POST', '/api/v1/cash-sessions/'.$session.'/close', $this->closeSessionBody($session, 25000, 25000), $this->manager)
            ->assertOk()->assertJsonPath('data.closed_by', $this->manager->id);
    }

    public function test_une_session_inconnue_ou_un_identifiant_incoherent_est_refuse(): void
    {
        $session = $this->openedSession($this->cashier);
        $unknown = Ulid::generate();

        $this->write('POST', '/api/v1/cash-sessions/'.$unknown.'/close', $this->closeSessionBody($unknown, 0, 0), $this->cashier)->assertNotFound();
        $this->write('POST', '/api/v1/cash-sessions/'.$session.'/close', $this->closeSessionBody($unknown, 25000, 25000), $this->cashier)
            ->assertStatus(422)->assertJsonStructure(['error' => ['fields' => ['cash_session_id']]]);
    }

    public function test_les_roles_sans_caisse_ne_cloturent_pas(): void
    {
        $session = $this->openedSession($this->cashier);

        $this->write('POST', '/api/v1/cash-sessions/'.$session.'/close', $this->closeSessionBody($session, 25000, 25000), $this->reception)->assertForbidden();
        $this->write('POST', '/api/v1/cash-sessions/'.$session.'/close', $this->closeSessionBody($session, 25000, 25000), $this->clinician)->assertForbidden();
    }

    // ------------------------------------------------------------------------------------------------------------
    // Chemin central
    // ------------------------------------------------------------------------------------------------------------

    /**
     * L'ouverture est ouverte aux postes synchronisés (O05) : une tâche du serveur, sans caissière, est refusée avant toute
     * lecture ; la clôture reste réservée à la route directe, donc un poste est refusé aussi.
     */
    public function test_une_source_sans_auteur_ou_hors_ligne_est_refusee(): void
    {
        $session = $this->openedSession($this->cashier);
        $sessions = DB::table('cash_sessions')->count();
        $job = CommandContext::job($this->clinicId, 'test', 'corr-test', CarbonImmutable::now('UTC'));

        $attempts = [
            [OpenCashSessionHandler::class, new Command('OpenCashSession', ['cash_session_id' => Ulid::generate(), 'cash_register_id' => $this->registerId, 'opening_amount' => 0, 'opened_at' => self::NOW], null), 'auteur identifié'],
            [CloseCashSessionHandler::class, new Command('CloseCashSession', ['cash_session_id' => $session, 'closed_at' => self::NOW, 'counted_amount' => 0, 'expected_amount' => 0, 'variance' => 0, 'variance_reason' => null], $session), 'hors-ligne'],
        ];
        foreach ($attempts as [$handler, $command, $fragment]) {
            try {
                $this->app->make($handler)->handle($command, $job, new TransactionLocks($this->clinicId), null);
                $this->fail('Une source autre que la route directe ou un poste devait être refusée.');
            } catch (BusinessError $error) {
                $this->assertSame('ACTION_FORBIDDEN', $error->errorCode);
                $this->assertStringContainsString($fragment, $error->getMessage());
            }
        }
        $this->assertSame($sessions, DB::table('cash_sessions')->count());
        $this->assertNull(DB::table('cash_sessions')->where('id', $session)->value('closed_at'));
    }

    public function test_les_verrous_sont_pris_dans_l_ordre_du_contrat(): void
    {
        $locks = new TransactionLocks($this->clinicId);
        $locks->clinic();
        $sessionId = Ulid::generate();
        $payload = $this->openSessionBody(1000, ['cash_session_id' => $sessionId]);
        unset($payload['expected_version']);

        $this->app->make(OpenCashSessionHandler::class)->handle(new Command('OpenCashSession', $payload, $sessionId, null), CommandContext::direct($this->cashier, 'corr-test-0001'), $locks, null);

        $this->assertSame(['10:'.$this->clinicId, '70:'.$sessionId], $locks->acquired());
    }

    /**
     * @return array<string, array{0: Checkpoint}>
     */
    public static function checkpoints(): array
    {
        $cases = [];
        foreach (Checkpoint::cases() as $checkpoint) {
            $cases[$checkpoint->value] = [$checkpoint];
        }

        return $cases;
    }

    #[DataProvider('checkpoints')]
    public function test_un_echec_a_l_ouverture_n_en_laisse_aucune_trace(Checkpoint $failAt): void
    {
        $before = $this->billingEffects();
        $this->app->instance(CommandBusProbe::class, new RecordingProbe($failAt));
        $this->withoutExceptionHandling();

        try {
            $this->write('POST', '/api/v1/cash-sessions', $this->openSessionBody(), $this->cashier);
            $this->fail('Une erreur injectée devait annuler la commande.');
        } catch (RuntimeException) {
            // Attendu : la transaction est annulée en entier.
        }

        $this->assertSame($before, $this->billingEffects());
        $this->app->instance(CommandBusProbe::class, new RecordingProbe);
        $this->write('POST', '/api/v1/cash-sessions', $this->openSessionBody(), $this->cashier)->assertCreated();
    }

    #[DataProvider('checkpoints')]
    public function test_un_echec_a_la_cloture_laisse_la_session_ouverte(Checkpoint $failAt): void
    {
        $session = $this->openedSession($this->cashier, 25000);
        $before = $this->billingEffects();
        $this->app->instance(CommandBusProbe::class, new RecordingProbe($failAt));
        $this->withoutExceptionHandling();

        try {
            $this->write('POST', '/api/v1/cash-sessions/'.$session.'/close', $this->closeSessionBody($session, 25000, 25000), $this->cashier);
            $this->fail('Une erreur injectée devait annuler la commande.');
        } catch (RuntimeException) {
            // Attendu : la transaction est annulée en entier.
        }

        $this->assertSame($before, $this->billingEffects());
        $this->assertNull(DB::table('cash_sessions')->where('id', $session)->value('closed_at'));
        $this->app->instance(CommandBusProbe::class, new RecordingProbe);
        $this->write('POST', '/api/v1/cash-sessions/'.$session.'/close', $this->closeSessionBody($session, 25000, 25000), $this->cashier)->assertOk();
    }
}
