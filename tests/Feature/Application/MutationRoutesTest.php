<?php

namespace Tests\Feature\Application;

use App\Application\CommandBusProbe;
use App\Http\Controllers\CommandController;
use App\Models\User;
use Illuminate\Routing\Route;
use Illuminate\Support\Facades\Route as Router;
use Tests\Support\AccessFixtures;
use Tests\Support\Commands\RecordingProbe;
use Tests\Support\MigratedDatabase;
use Tests\TestCase;

/**
 * « Une mutation critique passe toujours par ce chemin » (F07), prouvé à l'exécution et non par lecture du code
 * (constat de revue F07). Chaque route d'API qui modifie des données est classée :
 *
 *  - contrôleur `CommandController` : il n'a que `dispatchCommand` pour agir (et aucun contrôleur n'écrit en base,
 *    voir CentralPathGuardTest) ;
 *  - façade d'administration F05 : la requête réelle doit atteindre le chemin central (sonde du bus) ;
 *  - opération de session (connexion, déconnexion, réauthentification, mot de passe personnel) : hors du chemin des
 *    commandes par décision F05, chacune dans sa transaction TransactionRunner (docs/implementation/command-bus.md) ;
 *  - opération à appel fournisseur (L2) : elle appelle Google, Kommo ou la messagerie, ce qu'aucune action du chemin
 *    central ne peut faire (« aucun effet externe dans la transaction »). Chacune s'exécute en deux transactions autour de
 *    l'appel, ne passe jamais par `CommandController` et figure ICI par son nom de route ; OperationRoutesGuardTest
 *    prouve ses droits, son isolation des transactions et son idempotence ;
 *  - lecture portée par un POST (corps de requête) : elle n'écrit rien, ce que OperationRoutesGuardTest prouve aussi.
 *
 * Une nouvelle route de mutation non classée fait échouer ce test.
 */
final class MutationRoutesTest extends TestCase
{
    use AccessFixtures;
    use MigratedDatabase;

    private const SESSION_ROUTES = ['api.auth.login', 'api.auth.logout', 'api.auth.password', 'api.auth.reauthenticate'];

    private const FACADE_ROUTES = ['api.clinic.settings.update', 'api.staff.password', 'api.staff.permissions', 'api.staff.store', 'api.staff.update'];

    /** Opérations à appel fournisseur (L2) : la liste complète, jamais une famille de routes. */
    public const PROVIDER_OPERATION_ROUTES = [
        'api.integrations.accounts.test',
        'api.integrations.outbox.process',
        'api.integrations.reconcile',
        'api.integrations.google.sync',
        'api.crm.leads.sync',
        'api.crm.conversations.assistant-turn',
        'api.communication.tasks.send',
        'api.communication.attempts.reconcile',
        'api.communication.campaigns.execute',
    ];

    /** POST en lecture seule : l'aperçu d'une campagne calcule ses destinataires sans rien écrire. */
    public const READ_ONLY_POST_ROUTES = ['api.communication.campaigns.preview'];

    private string $clinicId;

    private User $manager;

    protected function setUp(): void
    {
        parent::setUp();

        $this->clinicId = $this->makeClinic();
        $this->manager = $this->makeStaff($this->clinicId, 'MANAGER', 'gerante.routes');
    }

    public function test_chaque_route_de_mutation_de_l_api_est_classee(): void
    {
        $unclassified = [];
        foreach (Router::getRoutes()->getRoutes() as $route) {
            /** @var Route $route */
            if (! str_starts_with($route->uri(), 'api/') || array_intersect($route->methods(), ['POST', 'PUT', 'PATCH', 'DELETE']) === []) {
                continue;
            }
            $name = (string) $route->getName();
            $controller = $route->getControllerClass();
            $viaBus = is_string($controller) && is_subclass_of($controller, CommandController::class);
            $classified = [...self::SESSION_ROUTES, ...self::FACADE_ROUTES, ...self::PROVIDER_OPERATION_ROUTES, ...self::READ_ONLY_POST_ROUTES];
            if (! $viaBus && ! in_array($name, $classified, true)) {
                $unclassified[] = implode('|', $route->methods()).' '.$route->uri();
            }
            // Une opération classée qui passerait par CommandController ne serait plus une exception : elle serait une commande.
            if ($viaBus && in_array($name, [...self::PROVIDER_OPERATION_ROUTES, ...self::READ_ONLY_POST_ROUTES], true)) {
                $unclassified[] = 'classée à tort comme opération : '.$name;
            }
        }

        $this->assertSame([], $unclassified, 'Route de mutation hors du chemin central : passer par CommandController.');
    }

    public function test_chaque_operation_classee_existe_encore_comme_route_de_mutation(): void
    {
        $existing = [];
        foreach (Router::getRoutes()->getRoutes() as $route) {
            /** @var Route $route */
            if (str_starts_with($route->uri(), 'api/') && array_intersect($route->methods(), ['POST', 'PUT', 'PATCH', 'DELETE']) !== []) {
                $existing[] = (string) $route->getName();
            }
        }

        // Une exception qui ne correspond plus à aucune route est une exception oubliée : la liste reste exacte.
        $this->assertSame([], array_values(array_diff([...self::PROVIDER_OPERATION_ROUTES, ...self::READ_ONLY_POST_ROUTES], $existing)));
    }

    public function test_chaque_facade_d_administration_atteint_le_chemin_central(): void
    {
        $cashier = $this->makeStaff($this->clinicId, 'CASHIER', 'caisse.routes');
        $requests = [
            'api.clinic.settings.update' => fn () => $this->actingAsReauthenticated($this->manager)->patchJson('/api/v1/clinic/settings', ['name' => 'TEST CABINET RENOMMÉ']),
            'api.staff.store' => fn () => $this->actingAsReauthenticated($this->manager)->postJson('/api/v1/staff', ['login' => 'nouveau.routes', 'display_name' => 'Agent Fictif', 'password' => 'InitialFictif2026', 'roles' => ['CASHIER']]),
            'api.staff.update' => fn () => $this->actingAsReauthenticated($this->manager)->patchJson('/api/v1/staff/'.$cashier->id, ['expected_version' => 1, 'display_name' => 'Caisse Renommée']),
            'api.staff.permissions' => fn () => $this->actingAsReauthenticated($this->manager)->postJson('/api/v1/staff/'.$cashier->id.'/permissions', ['permission_code' => 'exam_fee.collect', 'effect' => 'ALLOW', 'reason' => 'Accueil fictif', 'expected_version' => 2]),
            'api.staff.password' => fn () => $this->actingAsReauthenticated($this->manager)->postJson('/api/v1/staff/'.$cashier->id.'/password', ['password' => 'Remplace2026xx', 'password_confirmation' => 'Remplace2026xx', 'reason' => 'Oubli fictif', 'expected_version' => 3]),
        ];
        $this->assertSame(self::FACADE_ROUTES, collect(array_keys($requests))->sort()->values()->all());

        foreach ($requests as $name => $send) {
            $probe = new RecordingProbe;
            $this->app->instance(CommandBusProbe::class, $probe);

            $response = $send();

            $this->assertContains($response->status(), [200, 201, 204], $name.' : '.$response->getContent());
            $this->assertContains('clinic-locked', $probe->reached, $name.' n\'a pas pris le verrou du chemin central.');
            $this->assertContains('idempotency-completed', $probe->reached, $name.' n\'a pas terminé le chemin central.');
        }
    }
}
