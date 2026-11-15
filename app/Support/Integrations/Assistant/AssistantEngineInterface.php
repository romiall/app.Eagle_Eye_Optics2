<?php

namespace App\Support\Integrations\Assistant;

/**
 * Moteur d'exécution borné de l'assistant IA (L2D05) : génère une réponse exclusivement ancrée sur
 * les fiches publiées de la base de connaissances et les résultats assainis d'outils administratifs.
 */
interface AssistantEngineInterface
{
    public function engineName(): string;

    public function modelName(): string;

    public function rulesVersion(): string;

    /**
     * @param  list<array{
     *     version_id: string,
     *     entry_id: string,
     *     code: string,
     *     title: string,
     *     category: string,
     *     content: string,
     *     language: string,
     * }>  $publishedKnowledge
     * @param  array{
     *     services: list<array{service_id: string, name: string, duration_minutes: int}>,
     *     slots: list<array{resource_id: string, resource_name: string, starts_at: string, ends_at: string}>,
     *     booking_reference: ?string,
     * }  $toolData
     * @return array{
     *     reply: string,
     *     knowledge_version_ids: list<string>,
     *     knowledge_citations: list<string>,
     *     input_tokens: int,
     *     output_tokens: int,
     * }
     */
    public function respond(string $message, array $publishedKnowledge, array $toolData, ?string $bookingError = null): array;
}
