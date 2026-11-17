<?php

namespace App\Support\Integrations\Kommo;

use Illuminate\Contracts\Container\Container;

/**
 * Sélectionne le connecteur Kommo (`fake` pour le développement et les tests déterministes, `live` sinon).
 */
final class KommoClientFactory
{
    public function __construct(private readonly Container $container) {}

    public function make(?string $mode = null): KommoClientInterface
    {
        $resolved = $mode ?? (string) config('eeo.integrations.mode', 'fake');

        if ($resolved === 'fake') {
            return $this->container->make(FakeKommoClient::class);
        }

        return $this->container->make(HttpKommoClient::class);
    }
}
