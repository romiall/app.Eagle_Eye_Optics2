<?php

namespace Tests\Contracts;

use App\Http\Middleware\RequireRecentReauthentication;
use Illuminate\Routing\Route;
use Illuminate\Support\Facades\Route as RouteFacade;
use Symfony\Component\Yaml\Yaml;
use Tests\TestCase;

/**
 * Le contrat OpenAPI dit vrai sur ce qui est implémenté (F06) : chaque route /api déclarée par Laravel
 * figure dans contracts/openapi.yaml comme IMPLEMENTED, et réciproquement ; la permission (middleware
 * can:) et l'exigence de réauthentification d'une opération implémentée correspondent au code.
 */
final class OpenApiRoutesTest extends TestCase
{
    private const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

    /**
     * @return array<string, array{status: string, permission: list<string>, reauth: bool}>
     */
    private static function contractOperations(): array
    {
        /** @var array{servers: list<array{url: string}>, paths: array<string, array<string, mixed>>} $document */
        $document = Yaml::parseFile(dirname(__DIR__, 2).'/contracts/openapi.yaml');
        $operations = [];
        foreach ($document['paths'] as $path => $item) {
            $server = isset($item['servers']) && is_array($item['servers']) ? (string) $item['servers'][0]['url'] : $document['servers'][0]['url'];
            $uri = trim(rtrim($server, '/').$path, '/');
            foreach (self::METHODS as $method) {
                if (! isset($item[$method]) || ! is_array($item[$method])) {
                    continue;
                }
                $operation = $item[$method];
                $operations[strtoupper($method).' '.$uri] = [
                    'status' => (string) $operation['x-implementation-status'],
                    'permission' => array_values(array_map('strval', (array) ($operation['x-permission'] ?? []))),
                    'reauth' => (bool) ($operation['x-reauthentication'] ?? false),
                ];
            }
        }

        return $operations;
    }

    /**
     * @return array<string, Route>
     */
    private static function apiRoutes(): array
    {
        $routes = [];
        foreach (RouteFacade::getRoutes()->getRoutes() as $route) {
            if (! str_starts_with($route->uri(), 'api/') && ! str_starts_with($route->uri(), 'public/')) {
                continue;
            }
            foreach ($route->methods() as $method) {
                if ($method !== 'HEAD') {
                    $routes[$method.' '.$route->uri()] = $route;
                }
            }
        }

        return $routes;
    }

    public function test_les_routes_laravel_et_les_operations_implementees_coincident(): void
    {
        $operations = self::contractOperations();
        $routes = self::apiRoutes();
        $implemented = array_keys(array_filter($operations, static fn (array $operation): bool => $operation['status'] === 'IMPLEMENTED'));

        $this->assertNotEmpty($routes);
        $this->assertSame([], array_values(array_diff(array_keys($routes), array_keys($operations))), 'Routes /api absentes du contrat OpenAPI');
        $this->assertSame([], array_values(array_diff($implemented, array_keys($routes))), 'Opérations IMPLEMENTED sans route Laravel');
        $this->assertSame([], array_values(array_diff(array_keys($routes), $implemented)), 'Routes /api présentes mais déclarées PLANNED');
    }

    public function test_permission_et_reauthentification_correspondent_au_middleware(): void
    {
        $operations = self::contractOperations();

        foreach (self::apiRoutes() as $key => $route) {
            $middleware = $route->gatherMiddleware();
            $abilities = [];
            foreach ($middleware as $entry) {
                if (is_string($entry) && preg_match('/^(?:can|.*\\\\Authorize):(.+)$/', $entry, $match) === 1) {
                    $abilities[] = $match[1];
                } elseif (is_string($entry) && preg_match('/^any-permission:(.+)$/', $entry, $match) === 1) {
                    // « L'une ou l'autre » : les permissions de la liste, dans l'ordre déclaré.
                    array_push($abilities, ...explode(',', $match[1]));
                }
            }
            $reauth = in_array('reauthenticated', $middleware, true)
                || in_array(RequireRecentReauthentication::class, $middleware, true);

            $this->assertSame($abilities, $operations[$key]['permission'], $key.' : x-permission');
            $this->assertSame($reauth, $operations[$key]['reauth'], $key.' : x-reauthentication');
        }
    }
}
