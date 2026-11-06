<?php

namespace Tests\Unit\Offline;

use App\Application\CommandRegistry;
use App\Domain\Shared\CommandSource;
use App\Offline\SyncCommandModules;
use App\Support\Modules;
use Tests\TestCase;

/**
 * Porte des modules fermés pour les commandes de poste (O05 ; M01) sans base : chaque commande que le chemin central
 * accepte de la source SYNC déclare son module, et ce module est un code connu du déploiement. Une nouvelle commande de
 * poste sans module fait échouer ce test : la synchronisation ne peut pas devenir une porte dérobée vers un module que
 * l'exploitant n'a pas ouvert.
 */
final class SyncCommandModulesTest extends TestCase
{
    public function test_toute_commande_acceptant_la_source_poste_declare_son_module(): void
    {
        $registry = $this->app->make(CommandRegistry::class);
        $accepted = [];
        foreach ($registry->names() as $name) {
            if (in_array(CommandSource::Sync, $registry->definition($name)->sources, true)) {
                $accepted[] = $name;
            }
        }
        $declared = array_keys(SyncCommandModules::OWNERS);
        sort($accepted);
        sort($declared);

        $this->assertSame($accepted, $declared, 'La table des modules doit contenir exactement les commandes acceptant la source SYNC.');
        foreach (SyncCommandModules::OWNERS as $command => $module) {
            $this->assertContains($module, Modules::CODES, 'Module inconnu pour '.$command);
        }
    }

    public function test_un_module_ferme_ou_une_commande_sans_module_n_est_jamais_ouvert(): void
    {
        config(['eeo.enabled_modules' => ['patients', 'offline']]);

        $this->assertTrue(SyncCommandModules::isOpen('CreatePatient'));
        $this->assertFalse(SyncCommandModules::isOpen('IssueInvoice'));
        $this->assertFalse(SyncCommandModules::isOpen('CommandeInconnue'));
        $this->assertNull(SyncCommandModules::of('CommandeInconnue'));

        config(['eeo.enabled_modules' => ['patients', 'sales', 'offline']]);
        $this->assertTrue(SyncCommandModules::isOpen('IssueInvoice'));
    }

    public function test_le_motif_dit_le_module_sans_donnee_de_la_charge(): void
    {
        $this->assertStringContainsString('« Ventes et caisse »', SyncCommandModules::closedMessage('RegisterPayment'));
        $this->assertStringContainsString('conservée', SyncCommandModules::closedMessage('RegisterPayment'));
        $this->assertStringContainsString('n’a pas de module déclaré', SyncCommandModules::closedMessage('CommandeInconnue'));
    }
}
