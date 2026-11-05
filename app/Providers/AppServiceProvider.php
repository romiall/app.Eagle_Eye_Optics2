<?php

namespace App\Providers;

use App\Domain\Access\EffectivePermissions;
use App\Models\User;
use App\Support\Testing\BlockDestructiveDatabaseCommands;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Console\Events\CommandStarting;
use Illuminate\Contracts\Console\Kernel as ConsoleKernel;
use Illuminate\Foundation\Console\Kernel as FoundationConsoleKernel;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Vite;
use Illuminate\Support\ServiceProvider;
use Laravel\Sanctum\Sanctum;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        // Permissions effectives relues en base une fois par requête (désactivation/révocation immédiates).
        $this->app->scoped(EffectivePermissions::class);
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        $this->useRootRelativeAssetPaths();
        $this->ignoreViteHotFileInEndToEndTests();
        $this->authorizePermissionCodes();
        $this->limitAuthenticationAttempts();
        $this->disablePersonalAccessTokens();

        // Aucune commande destructive de base de données hors base de test isolée (contrats 23 et 25).
        Event::listen(CommandStarting::class, [BlockDestructiveDatabaseCommands::class, 'handle']);

        if ($this->app->runningInConsole()) {
            $this->relayConsoleEvents();
        }
    }

    /**
     * Limites de débit de l'authentification (fichier 09) : 20 connexions par minute et par adresse, en
     * plus de la limite de 5 échecs par identifiant de l'action de connexion ; 5 réauthentifications par
     * minute et par compte.
     */
    private function limitAuthenticationAttempts(): void
    {
        RateLimiter::for('eeo-login-ip', static fn (Request $request): Limit => Limit::perMinute((int) config('eeo.rate_limits.login_ip', 20))->by('ip:'.$request->ip()));
        // Recherche de patients : un compte ne parcourt pas le registre à la chaîne (valeur configurable).
        RateLimiter::for('eeo-patient-search', static fn (Request $request): Limit => Limit::perMinute((int) config('eeo.rate_limits.patient_search', 120))->by('patient-search:'.($request->user()?->getAuthIdentifier() ?? $request->ip())));
        // Lectures d'un dossier clinique : un compte ne parcourt pas tous les dossiers à la chaîne (valeur configurable).
        RateLimiter::for('eeo-consultation-read', static fn (Request $request): Limit => Limit::perMinute((int) config('eeo.rate_limits.consultation_read', 60))->by('consultation-read:'.($request->user()?->getAuthIdentifier() ?? $request->ip())));
        RateLimiter::for('eeo-reauthenticate', static fn (Request $request): Limit => Limit::perMinute((int) config('eeo.rate_limits.reauthenticate', 5))->by('reauth:'.($request->user()?->getAuthIdentifier() ?? $request->ip())));
    }

    /**
     * Session SPA uniquement (fichier 23) : aucun jeton d'accès personnel. Sans ce réglage, le garde
     * Sanctum chercherait tout en-tête « Authorization: Bearer » dans la table personal_access_tokens,
     * absente du schéma : erreur 500 et journal volumineux pour une requête non authentifiée, au lieu
     * d'un simple 401.
     */
    private function disablePersonalAccessTokens(): void
    {
        Sanctum::getAccessTokenFromRequestUsing(static fn (): ?string => null);
    }

    /**
     * Chaque code du référentiel `permissions` (49 codes seedés, autorité des droits) est une capacité
     * Gate : `Gate::allows('invoice.issue')`, `$user->can(...)`, middleware `can:`. Un compte désactivé
     * n'a aucune permission. Les autres capacités restent décidées par les Policies de ressource.
     */
    private function authorizePermissionCodes(): void
    {
        Gate::before(static function (User $user, string $ability): ?bool {
            $permissions = app(EffectivePermissions::class);

            if (! str_contains($ability, '.') || ! $permissions->isKnown($ability)) {
                return null;
            }

            return $permissions->has($user, $ability);
        });
    }

    /**
     * Les assets de la coquille SPA (@vite) sont des chemins depuis la racine du site (« /build/… »), non
     * des URL absolues.
     *
     * Par défaut Laravel écrit des URL absolues déduites de la REQUÊTE (helper asset()) : schéma et hôte
     * reçus, ou ASSET_URL. Derrière un proxy ou un CDN qui termine TLS, la requête arrive en HTTP et la
     * page HTTPS référence http://…/build/…js : le navigateur bloque le script (contenu mixte), la page
     * reste vide et le service worker n'est jamais enregistré. APP_URL n'y change rien, et un en-tête Host
     * arbitraire ferait pointer les assets vers cet hôte.
     *
     * La SPA, ses assets, son service worker et son manifeste sont servis par une seule origine (fichier
     * 23) : un chemin depuis la racine se résout toujours contre l'origine du document, quelle que soit la
     * chaîne de proxys, sans dépendre de trustProxies ni d'un en-tête X-Forwarded-*. ASSET_URL est donc
     * volontairement sans effet sur la coquille : un CDN d'assets sortirait de l'origine unique (portée du
     * service worker, précache, politique de contenu).
     */
    private function useRootRelativeAssetPaths(): void
    {
        Vite::createAssetPathsUsing(
            static fn (string $path, ?bool $secure = null): string => '/'.ltrim($path, '/'),
        );
    }

    /**
     * Parcours e2e et démonstration locale (APP_ENV=e2e ou demo) : la coquille vient TOUJOURS de `public/build`, jamais
     * d'un serveur Vite (le développement, lui, garde le fichier `hot`). Un
     * `npm run dev` lancé dans le même dossier (aperçu d'une autre session) écrit `public/hot` et ferait charger la
     * page depuis ce serveur : ni service worker, ni précache, donc plus aucun test de démarrage hors ligne ne
     * peut aboutir. Le fichier désigné n'existe jamais ; les autres environnements gardent le comportement de Laravel.
     */
    private function ignoreViteHotFileInEndToEndTests(): void
    {
        if ($this->app->environment(['e2e', 'demo'])) {
            Vite::useHotFile(storage_path('framework/testing/vite-hot-ignored'));
        }
    }

    /**
     * Laravel ne relaie pas les événements de commande Symfony vers CommandStarting lorsque
     * APP_ENV=testing (Kernel::__construct). Sans ce relais, « APP_ENV=testing php artisan migrate:fresh »
     * contournerait l'écouteur ci-dessus alors que c'est précisément le cas d'une base mal ciblée.
     * La méthode est idempotente.
     *
     * Appel direct, sans test d'existence : si une mise à jour de Laravel retirait cette méthode, la
     * console doit échouer bruyamment plutôt que de laisser la garde silencieusement inactive.
     */
    private function relayConsoleEvents(): void
    {
        /** @var FoundationConsoleKernel $kernel Le noyau lié au contrat : la méthode de relais n'existe pas sur l'interface. */
        $kernel = $this->app->make(ConsoleKernel::class);
        $kernel->rerouteSymfonyCommandEvents();
    }
}
