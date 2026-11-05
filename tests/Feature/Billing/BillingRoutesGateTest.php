<?php

namespace Tests\Feature\Billing;

use App\Domain\Shared\Ulid;
use Illuminate\Routing\Route as LaravelRoute;
use Illuminate\Support\Facades\Route;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Support\BillingFixtures;
use Tests\Support\MigratedDatabase;
use Tests\TestCase;

/**
 * Portes des routes des ventes, de la caisse et du stock : modules fermés par défaut (404), compte obligatoire (401),
 * matrice des droits par rôle (403 hors du rôle) alignée sur les `x-permission` du contrat. La matrice ne vérifie que
 * la porte : au-delà, la route répond 200, 201, 404 ou 422 selon la requête, jamais 401 ni 403.
 */
final class BillingRoutesGateTest extends TestCase
{
    use BillingFixtures;
    use MigratedDatabase;

    private const ROLES = ['manager', 'clinician', 'reception', 'cashier'];

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
     * @return array<string, array{0: string, 1: string, 2: list<string>}> méthode, adresse, rôles admis par défaut
     */
    public static function routes(): array
    {
        $cash = ['manager', 'cashier'];
        $invoices = ['manager', 'cashier'];

        return [
            'GET catalog' => ['GET', 'catalog', ['manager', 'clinician', 'cashier']],
            'POST catalog/items' => ['POST', 'catalog/items', ['manager']],
            'PATCH catalog/items/{id}' => ['PATCH', 'catalog/items/{id}', ['manager']],
            'GET tax-rules' => ['GET', 'tax-rules', ['manager']],
            'POST tax-rules' => ['POST', 'tax-rules', ['manager']],
            'PATCH tax-rules/{id}' => ['PATCH', 'tax-rules/{id}', ['manager']],
            'GET invoices' => ['GET', 'invoices', $invoices],
            'POST invoices' => ['POST', 'invoices', $invoices],
            'GET invoices/{id}' => ['GET', 'invoices/{id}', $invoices],
            'PATCH invoices/{id}' => ['PATCH', 'invoices/{id}', $invoices],
            'POST invoices/{id}/abandon' => ['POST', 'invoices/{id}/abandon', $invoices],
            // Devis (L1D07) : lecture invoice.read, écritures invoice.create (gérante et caisse avec le seed).
            'GET quotes' => ['GET', 'quotes', $invoices],
            'POST quotes' => ['POST', 'quotes', $invoices],
            'GET quotes/{id}' => ['GET', 'quotes/{id}', $invoices],
            'PATCH quotes/{id}' => ['PATCH', 'quotes/{id}', $invoices],
            // Suppression d'un brouillon jamais émis (chantier « CRUD des écrans ») : même porte que la modification ; la règle
            // « créateur ou gérante » est celle de la commande (DeleteQuoteDraftTest).
            'POST quotes/{id}/delete' => ['POST', 'quotes/{id}/delete', $invoices],
            'POST quotes/{id}/issue' => ['POST', 'quotes/{id}/issue', $invoices],
            'POST quotes/{id}/revisions' => ['POST', 'quotes/{id}/revisions', $invoices],
            'POST quotes/{id}/decision' => ['POST', 'quotes/{id}/decision', $invoices],
            'POST quotes/{id}/conversions' => ['POST', 'quotes/{id}/conversions', $invoices],
            'POST invoices/{id}/issue' => ['POST', 'invoices/{id}/issue', $invoices],
            'POST invoices/{id}/payments' => ['POST', 'invoices/{id}/payments', $invoices],
            'GET receipts/{id}' => ['GET', 'receipts/{id}', $invoices],
            // Remise au patient (I01) : l'historique suit invoice.read, la remise exige delivery.confirm (gérante et caisse
            // avec le seed) ; le retour physique (I02) exige stock.adjust et la réauthentification, gérante seule.
            'GET invoices/{id}/deliveries' => ['GET', 'invoices/{id}/deliveries', $invoices],
            'POST invoices/{id}/deliveries' => ['POST', 'invoices/{id}/deliveries', $invoices],
            'POST deliveries/{id}/physical-returns' => ['POST', 'deliveries/{id}/physical-returns', ['manager']],
            // Corrections (B07, B08) : permission propre à chaque opération, gérante seule avec le seed ; réauthentification
            // en plus (la porte des droits passe avant : 423 pour la gérante, 403 pour les autres).
            'POST payments/{id}/reversals' => ['POST', 'payments/{id}/reversals', ['manager']],
            'POST invoices/{id}/credit-notes' => ['POST', 'invoices/{id}/credit-notes', ['manager']],
            'POST invoices/{id}/refunds' => ['POST', 'invoices/{id}/refunds', ['manager']],
            'GET credit-notes/{id}' => ['GET', 'credit-notes/{id}', $invoices],
            'GET refunds/{id}' => ['GET', 'refunds/{id}', $invoices],
            'GET cash-registers' => ['GET', 'cash-registers', $cash],
            'GET cash-sessions/current' => ['GET', 'cash-sessions/current', $cash],
            // Liste des sessions du cabinet : gérante seule (`cash.manage`) ; le rapport d'une session suit la porte de
            // la caisse, le contrôle « sa propre session sinon cash.manage » est fait par le contrôleur.
            'GET cash-sessions' => ['GET', 'cash-sessions', ['manager']],
            'POST cash-sessions' => ['POST', 'cash-sessions', $cash],
            'POST cash-sessions/{id}/close' => ['POST', 'cash-sessions/{id}/close', $cash],
            'GET cash-sessions/{id}/report' => ['GET', 'cash-sessions/{id}/report', $cash],
            // Dépenses et mouvements hors vente (L1D05) : la session de la caissière (cash.own_session) ; la revue de l'écart
            // d'une session clôturée exige cash.manage et la réauthentification, gérante seule.
            'GET cash-sessions/{id}/movements' => ['GET', 'cash-sessions/{id}/movements', $cash],
            'POST cash-sessions/{id}/movements' => ['POST', 'cash-sessions/{id}/movements', $cash],
            'POST cash-sessions/{id}/variance-review' => ['POST', 'cash-sessions/{id}/variance-review', ['manager']],
            'GET stock/availability' => ['GET', 'stock/availability', ['manager', 'clinician', 'cashier']],
            'GET stock/locations' => ['GET', 'stock/locations', ['manager', 'clinician', 'cashier']],
            'POST stock/opening' => ['POST', 'stock/opening', ['manager']],
            'POST stock/movements' => ['POST', 'stock/movements', ['manager']],
        ];
    }

    /**
     * Les mêmes routes sans la colonne des rôles, pour les portes qui ne dépendent pas du rôle.
     *
     * @return array<string, array{0: string, 1: string}>
     */
    public static function paths(): array
    {
        return array_map(static fn (array $route): array => [$route[0], $route[1]], self::routes());
    }

    /**
     * @param  list<string>  $allowed
     */
    #[DataProvider('routes')]
    public function test_la_matrice_des_droits_par_route(string $method, string $uri, array $allowed): void
    {
        $path = '/api/v1/'.str_replace('{id}', Ulid::generate(), $uri);

        foreach (self::ROLES as $role) {
            $response = $this->actingAsFresh($this->{$role})->withHeaders(['Idempotency-Key' => Ulid::generate()])->json($method, $path, []);

            if (in_array($role, $allowed, true)) {
                $this->assertNotContains($response->getStatusCode(), [401, 403], $role.' doit passer la porte de '.$method.' '.$uri);
            } else {
                $this->assertSame(403, $response->getStatusCode(), $role.' ne doit pas passer la porte de '.$method.' '.$uri);
            }
        }
    }

    #[DataProvider('paths')]
    public function test_un_visiteur_non_connecte_est_refuse(string $method, string $uri): void
    {
        $path = '/api/v1/'.str_replace('{id}', Ulid::generate(), $uri);

        $this->json($method, $path, [])->assertUnauthorized();
    }

    #[DataProvider('paths')]
    public function test_un_module_ferme_repond_404_meme_pour_la_gerante(string $method, string $uri): void
    {
        config(['eeo.enabled_modules' => ['today', 'patients']]);
        $path = '/api/v1/'.str_replace('{id}', Ulid::generate(), $uri);

        $this->actingAsReauthenticated($this->manager)->withHeaders(['Idempotency-Key' => Ulid::generate()])->json($method, $path, [])->assertNotFound();
    }

    public function test_chaque_route_des_ventes_et_du_stock_porte_son_module_et_une_permission(): void
    {
        $prefixes = [
            'api.catalog.', 'api.tax-rules.', 'api.invoices.', 'api.quotes.', 'api.receipts.', 'api.payments.', 'api.credit-notes.', 'api.refunds.',
            'api.cash-registers.', 'api.cash-sessions.', 'api.deliveries.', 'api.stock.',
        ];
        $checked = 0;

        foreach (Route::getRoutes()->getRoutes() as $route) {
            /** @var LaravelRoute $route */
            $name = (string) $route->getName();
            if (! array_filter($prefixes, static fn (string $prefix): bool => str_starts_with($name, $prefix))) {
                continue;
            }
            $middleware = array_map('strval', $route->gatherMiddleware());
            // Le retour physique d'une remise (I02) appartient au stock, comme les mouvements ; le reste aux ventes.
            $module = str_starts_with($name, 'api.stock.') || str_starts_with($name, 'api.deliveries.') ? 'module:stock' : 'module:sales';

            $this->assertContains($module, $middleware, $name.' doit être derrière son module');
            $this->assertNotEmpty(
                array_filter($middleware, static fn (string $entry): bool => str_starts_with($entry, 'can:') || str_starts_with($entry, 'any-permission:')),
                $name.' doit exiger une permission',
            );
            $checked++;
        }

        $this->assertSame(count(self::routes()), $checked, 'Toutes les routes publiées sont dans la matrice ci-dessus.');
    }

    public function test_les_modules_ventes_et_stock_sont_fermes_par_defaut(): void
    {
        // Lecture du fichier plutôt que de la configuration chargée : un .env local peut ouvrir des modules.
        $source = (string) file_get_contents(base_path('config/eeo.php'));
        $example = (string) file_get_contents(base_path('.env.example'));

        $this->assertStringContainsString("env('EEO_ENABLED_MODULES', '')", $source, 'Aucun module ouvert sans décision de l\'exploitant.');
        $this->assertStringContainsString("env('EEO_EXAM_FEE_CONTROL', 'off')", $source, 'Le contrôle du paiement de l\'examen est inactif par défaut.');
        $this->assertMatchesRegularExpression('/^EEO_EXAM_FEE_CONTROL=off$/m', $example);
        $this->assertMatchesRegularExpression('/^EEO_ENABLED_MODULES=(?:[a-z,]*)$/m', $example);
    }
}
