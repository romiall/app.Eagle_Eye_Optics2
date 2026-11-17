<?php

namespace App\Support\Integrations\Kommo;

/**
 * Connecteur externe Kommo CRM (L2D03) : toutes les données transportées sont strictement administratives
 * et commerciales (prospect, étape pipeline, intérêt produit, budget). Aucune donnée médicale n'est admise.
 */
interface KommoClientInterface
{
    /**
     * Récupère les pistes commerciales administratives depuis Kommo.
     *
     * @param  array<string, mixed>  $accountConfig
     * @return list<array{
     *     external_lead_id: string,
     *     external_conversation_id: ?string,
     *     channel: ?string,
     *     prospect: array{
     *         external_contact_id: ?string,
     *         name: string,
     *         phone: ?string,
     *         email: ?string,
     *     },
     *     pipeline_id: ?string,
     *     pipeline_stage: string,
     *     product_interest: ?string,
     *     budget_min: ?int,
     *     budget_max: ?int,
     *     acquisition_source: ?string,
     *     status: string,
     *     etag: ?string,
     * }>
     */
    public function fetchLeads(array $accountConfig, int $limit = 50): array;

    /**
     * Pousse une mise à jour administrative de statut/rendez-vous vers Kommo sans aucune donnée médicale.
     *
     * @param  array<string, mixed>  $accountConfig
     * @return array{external_lead_id: string, etag: ?string, synced: bool}
     */
    public function pushBookingStatus(
        array $accountConfig,
        string $externalLeadId,
        string $status,
        ?string $pipelineStage = null,
        ?string $note = null,
    ): array;

    /**
     * Ajoute une note administrative sur une piste Kommo.
     *
     * @param  array<string, mixed>  $accountConfig
     * @return array{external_note_id: string, synced: bool}
     */
    public function addAdministrativeNote(array $accountConfig, string $externalLeadId, string $note): array;
}
