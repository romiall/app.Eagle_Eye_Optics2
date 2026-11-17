<?php

namespace App\Support\Integrations\GoogleCalendar;

use Illuminate\Contracts\Container\Container;
use RuntimeException;

/**
 * Résout l'adaptateur Google Calendar selon `eeo.integrations.mode` (`fake` vs `real`).
 * En mode `fake`, partage la même instance dans le conteneur courant afin que les contrôleurs
 * et les tests observent le même état déterministe en mémoire.
 */
final class GoogleCalendarClientFactory
{
    public function __construct(private readonly Container $container) {}

    public function make(): GoogleCalendarClientInterface
    {
        $mode = strtolower(trim((string) config('eeo.integrations.mode', 'fake')));

        if ($mode === 'fake') {
            if (! $this->container->bound(FakeGoogleCalendarClient::class)) {
                $this->container->instance(FakeGoogleCalendarClient::class, new FakeGoogleCalendarClient);
            }

            /** @var FakeGoogleCalendarClient $fake */
            $fake = $this->container->make(FakeGoogleCalendarClient::class);

            return $fake;
        }

        if ($mode === 'disabled') {
            throw new RuntimeException('Les intégrations externes sont désactivées (`eeo.integrations.mode=disabled`).');
        }

        return $this->container->make(HttpGoogleCalendarClient::class);
    }
}
