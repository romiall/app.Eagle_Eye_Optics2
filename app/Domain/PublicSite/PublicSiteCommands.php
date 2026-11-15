<?php

namespace App\Domain\PublicSite;

use App\Application\CommandDefinition;
use App\Domain\PublicSite\Handlers\AttachCatalogMediaHandler;
use App\Domain\PublicSite\Handlers\ChangeCatalogPublicationStatusHandler;
use App\Domain\PublicSite\Handlers\ChangePublicContentStatusHandler;
use App\Domain\PublicSite\Handlers\RemoveCatalogMediaHandler;
use App\Domain\PublicSite\Handlers\SaveCatalogPublicationHandler;
use App\Domain\PublicSite\Handlers\SavePublicContentHandler;
use App\Domain\Shared\CommandSource;

/**
 * Commandes du site public (L3D02) enregistrées auprès du chemin central (F07) : fiches du showroom, images et contenus
 * publics. Opérations EN LIGNE seulement (route directe, droit `site.publish`) ; clé d'idempotence obligatoire.
 *
 * L'image arrive en octets bruts : le contrôleur contrôle et écrit le fichier privé AVANT la commande, qui rattache le
 * fichier (même ordre que le dépôt d'un PDF, D01). Son corps n'est donc pas validé par un schéma de requête JSON : l'action
 * valide elle-même ce que le contrôleur lui confie.
 */
final class PublicSiteCommands
{
    /**
     * @return list<CommandDefinition>
     */
    public static function definitions(): array
    {
        $direct = [CommandSource::Direct];
        $http = 'schemas/requests/http.json#/$defs/';

        return [
            new CommandDefinition(SaveCatalogPublicationHandler::COMMAND, SaveCatalogPublicationHandler::class, $direct, null, true, $http.'SaveCatalogPublicationRequest'),
            new CommandDefinition(ChangeCatalogPublicationStatusHandler::COMMAND, ChangeCatalogPublicationStatusHandler::class, $direct, null, true, $http.'ChangePublicStatusRequest'),
            new CommandDefinition(AttachCatalogMediaHandler::COMMAND, AttachCatalogMediaHandler::class, $direct, null, true),
            new CommandDefinition(RemoveCatalogMediaHandler::COMMAND, RemoveCatalogMediaHandler::class, $direct, null, true),
            new CommandDefinition(SavePublicContentHandler::COMMAND, SavePublicContentHandler::class, $direct, null, true, $http.'SavePublicContentRequest'),
            new CommandDefinition(ChangePublicContentStatusHandler::COMMAND, ChangePublicContentStatusHandler::class, $direct, null, true, $http.'ChangePublicStatusRequest'),
        ];
    }
}
