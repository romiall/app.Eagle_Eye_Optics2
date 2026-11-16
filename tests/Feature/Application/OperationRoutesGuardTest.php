<?php

namespace Tests\Feature\Application;

use Illuminate\Routing\Route;
use Illuminate\Support\Facades\Route as Router;
use Tests\TestCase;

/**
 * Garde des opérations à appel fournisseur (L2), classées à part dans MutationRoutesTest parce qu'aucune action du
 * chemin central ne peut appeler Google, Kommo ou la messagerie (« aucun effet externe dans la transaction »). Ce test
 * ramène l'exception à ce qu'elle a le droit d'être :
 *
 *  - chaque opération exige un compte connecté ET un droit (jamais une route ouverte) ;
 *  - aucun appel au fournisseur n'est écrit dans la fonction qu'une transaction exécute : l'appel est ENTRE deux
 *    transactions, jamais dedans (lecture du code, comme CentralPathGuardTest) ;
 *  - un POST en lecture seule n'écrit rien : OperationReadOnlyTest, dans CampaignsTest, le prouve à l'exécution.
 */
final class OperationRoutesGuardTest extends TestCase
{
    /**
     * Services qui portent une opération à appel fournisseur : seuls fichiers où un client externe est appelé.
     */
    private const PROVIDER_SERVICES = [
        'app/Domain/Communication/SendTransactionalMessage.php',
        'app/Domain/Communication/Campaigns.php',
        'app/Domain/Crm/CrmMirror.php',
        'app/Domain/Crm/LimitedAssistant.php',
        'app/Domain/Operations/IntegrationAccounts.php',
        'app/Domain/Operations/OutboxProcessor.php',
        'app/Domain/Operations/IntegrationReconciler.php',
        'app/Domain/Scheduling/CalendarReconciliation.php',
    ];

    /**
     * Appels qui sortent de l'application : le client d'un fournisseur obtenu de sa fabrique, une sonde réseau ou le moteur d'assistant.
     */
    private const PROVIDER_CALL = '/->(?:forAccount|probeProvider)\(|\$client->|\$this->clients->|\$this->httpClient->|\$engine->respond\(/';

    public function test_chaque_operation_a_appel_fournisseur_exige_un_compte_connecte_et_un_droit(): void
    {
        $unguarded = [];
        foreach ([...MutationRoutesTest::PROVIDER_OPERATION_ROUTES, ...MutationRoutesTest::READ_ONLY_POST_ROUTES] as $name) {
            $route = Router::getRoutes()->getByName($name);
            $this->assertInstanceOf(Route::class, $route, 'Route classée introuvable : '.$name);

            $stack = array_map('strval', $route->gatherMiddleware());
            $authenticated = array_filter($stack, static fn (string $m): bool => str_starts_with($m, 'auth'));
            $authorized = array_filter($stack, static fn (string $m): bool => str_starts_with($m, 'can:') || str_starts_with($m, 'any-permission:'));
            if ($authenticated === [] || $authorized === []) {
                $unguarded[] = $name;
            }
        }

        $this->assertSame([], $unguarded, 'Une opération classée doit exiger un compte connecté et un droit.');
    }

    public function test_aucun_appel_au_fournisseur_n_est_ecrit_dans_une_transaction(): void
    {
        $offenders = [];
        foreach (self::PROVIDER_SERVICES as $relative) {
            $source = (string) file_get_contents(base_path($relative));
            foreach (self::transactionBodies($source) as [$line, $body]) {
                if (preg_match(self::PROVIDER_CALL, $body, $match) === 1) {
                    $offenders[] = $relative.':'.$line.' : '.trim($match[0]);
                }
            }
        }

        $this->assertSame([], $offenders, 'L\'appel au fournisseur se place ENTRE deux transactions, jamais dedans.');
    }

    public function test_le_garde_reconnait_un_appel_ecrit_dans_une_transaction(): void
    {
        // Contrôle négatif du garde lui-même : un appel dans la fonction de la transaction doit être relevé, un appel
        // placé entre deux transactions non.
        $dedans = '<?php $this->transactions->run(function () { $client = $this->clients->forAccount($a); $client->send($m); });';
        $entre = '<?php $x = $this->transactions->run(function () { return 1; }); $client = $this->clients->forAccount($a); $client->send($m); $this->transactions->run(function () { return 2; });';

        $this->assertNotSame([], array_filter(self::transactionBodies($dedans), fn (array $b): bool => preg_match(self::PROVIDER_CALL, $b[1]) === 1));
        $this->assertSame([], array_filter(self::transactionBodies($entre), fn (array $b): bool => preg_match(self::PROVIDER_CALL, $b[1]) === 1));
        $this->assertCount(2, self::transactionBodies($entre));
    }

    /**
     * Corps des fonctions passées à `->run(` ou `->joinOrRun(` : de l'accolade qui ouvre la fonction à celle qui la ferme.
     *
     * @return list<array{0: int, 1: string}> numéro de ligne et corps
     */
    private static function transactionBodies(string $source): array
    {
        $bodies = [];
        $offset = 0;
        while (preg_match('/->(?:run|joinOrRun)\(\s*(?:static\s+)?function\s*\(/', $source, $match, PREG_OFFSET_CAPTURE, $offset) === 1) {
            $start = $match[0][1];
            $open = strpos($source, '{', $start + strlen($match[0][0]));
            if ($open === false) {
                break;
            }
            $depth = 0;
            $end = $open;
            for ($i = $open, $length = strlen($source); $i < $length; $i++) {
                if ($source[$i] === '{') {
                    $depth++;
                } elseif ($source[$i] === '}') {
                    $depth--;
                    if ($depth === 0) {
                        $end = $i;
                        break;
                    }
                }
            }
            $bodies[] = [substr_count(substr($source, 0, $start), "\n") + 1, substr($source, $open, $end - $open + 1)];
            $offset = $end;
        }

        return $bodies;
    }
}
