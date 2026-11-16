<?php

namespace App\Support\Integrations\Assistant;

use App\Domain\Shared\ValueObjects\Text;

/**
 * Moteur déterministe local de l'assistant IA borné (mode sans LLM externe ou banc de test) :
 * répond exclusivement à partir des versions PUBLIÉES de la base de connaissances et des créneaux
 * administratifs disponibles. N'invente jamais de prix, d'horaire ni de conseil médical.
 */
final class DeterministicAssistantEngine implements AssistantEngineInterface
{
    public function engineName(): string
    {
        return 'deterministic';
    }

    public function modelName(): string
    {
        return 'eeo-bounded-kb-v1';
    }

    public function rulesVersion(): string
    {
        return '2026.10.v1';
    }

    public function respond(string $message, array $publishedKnowledge, array $toolData, ?string $bookingError = null): array
    {
        $matched = $this->matchKnowledge($message, $publishedKnowledge);

        $parts = [];
        $versionIds = [];
        $citations = [];

        foreach ($matched as $entry) {
            $parts[] = $entry['title'].' : '.$entry['content'];
            $versionIds[] = $entry['version_id'];
            $citations[] = $entry['code'];
        }

        if ($toolData['booking_reference'] !== null) {
            $parts[] = 'Demande de rendez-vous enregistrée sous la référence '.$toolData['booking_reference']
                .'. L\'équipe du cabinet vous confirmera ce créneau rapidement.';
        } elseif ($bookingError !== null) {
            $parts[] = $bookingError;
        }

        if ($toolData['slots'] !== [] && $toolData['booking_reference'] === null) {
            $preview = array_slice($toolData['slots'], 0, 3);
            $formatted = array_map(
                static fn (array $slot): string => $slot['resource_name'].' ('.$slot['starts_at'].')',
                $preview,
            );
            $parts[] = 'Créneaux disponibles : '.implode(', ', $formatted).'.';
        } elseif ($parts === [] && $this->asksAboutBooking($message) && $toolData['services'] !== []) {
            $names = array_map(static fn (array $service): string => $service['name'], array_slice($toolData['services'], 0, 5));
            $parts[] = 'Prestations réservables : '.implode(', ', $names).'. Précisez le créneau souhaité pour enregistrer une demande.';
        }

        $catalogItems = $toolData['catalog_items'] ?? [];
        if ($catalogItems !== [] && $this->asksAboutCatalog($message, $catalogItems)) {
            $matchedCatalog = $this->matchCatalogItems($message, $catalogItems);
            if ($matchedCatalog !== []) {
                $formattedCatalog = array_map(static function (array $item): string {
                    $label = $item['title'];
                    if ($item['brand'] !== null && $item['brand'] !== '') {
                        $label .= ' ('.$item['brand'].')';
                    }
                    $price = $item['sale_price'] !== null
                        ? number_format($item['sale_price'], 0, '', ' ').' '.$item['currency']
                        : 'tarif sur demande au cabinet';

                    return $label.' — '.$price;
                }, $matchedCatalog);
                $parts[] = 'Références du showroom : '.implode(' ; ', $formattedCatalog).'.';
            }
        }

        if ($parts === []) {
            $parts[] = 'Je dispose uniquement des informations officielles publiées par le cabinet. '
                .'Aucune fiche publiée ne répond précisément à votre question : un conseiller peut prendre le relais pour vous renseigner.';
        }

        $reply = mb_substr(implode("\n\n", $parts), 0, 4000);
        $inputTokens = max(1, (int) ceil(mb_strlen($message, 'UTF-8') / 4));
        $outputTokens = max(1, (int) ceil(mb_strlen($reply, 'UTF-8') / 4));

        return [
            'reply' => $reply,
            'knowledge_version_ids' => array_values(array_unique($versionIds)),
            'knowledge_citations' => array_values(array_unique($citations)),
            'input_tokens' => $inputTokens,
            'output_tokens' => $outputTokens,
        ];
    }

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
     * @return list<array{
     *     version_id: string,
     *     entry_id: string,
     *     code: string,
     *     title: string,
     *     category: string,
     *     content: string,
     *     language: string,
     * }>
     */
    private function matchKnowledge(string $message, array $publishedKnowledge): array
    {
        if ($publishedKnowledge === []) {
            return [];
        }

        $queryKey = Text::searchKey($message);
        $tokens = array_values(array_filter(
            explode(' ', $queryKey),
            static fn (string $token): bool => mb_strlen($token, 'UTF-8') >= 3 && ! in_array($token, [
                'les', 'des', 'une', 'est', 'que', 'qui', 'quoi', 'quel', 'quels', 'quelle', 'quelles',
                'pour', 'avec', 'sans', 'dans', 'sur', 'vous', 'nous', 'votre', 'notre', 'sont', 'etre',
                'avoir', 'pouvez', 'bonjour', 'salut', 'merci',
            ], true),
        ));

        if ($tokens === []) {
            return [];
        }

        $scored = [];
        foreach ($publishedKnowledge as $index => $item) {
            $haystack = Text::searchKey($item['code'].' '.$item['category'].' '.$item['title'].' '.$item['content']);
            $score = 0;
            foreach ($tokens as $token) {
                if (str_contains($haystack, $token)) {
                    $score++;
                }
            }
            if ($score > 0) {
                $scored[] = ['score' => $score, 'index' => $index, 'item' => $item];
            }
        }

        usort($scored, static function (array $left, array $right): int {
            if ($left['score'] !== $right['score']) {
                return $right['score'] <=> $left['score'];
            }

            return $left['index'] <=> $right['index'];
        });

        return array_map(static fn (array $row): array => $row['item'], array_slice($scored, 0, 3));
    }

    private function asksAboutBooking(string $message): bool
    {
        $key = Text::searchKey($message);

        foreach (['rendez vous', 'rdv', 'creneau', 'creneaux', 'reserver', 'reservation', 'disponibilite'] as $keyword) {
            if (str_contains($key, $keyword)) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param  list<array{
     *     publication_id: string,
     *     slug: string,
     *     title: string,
     *     description: string,
     *     style: ?string,
     *     brand: ?string,
     *     sale_price: ?int,
     *     currency: string,
     * }>  $catalogItems
     */
    private function asksAboutCatalog(string $message, array $catalogItems): bool
    {
        $key = Text::searchKey($message);
        foreach ([
            'monture', 'montures', 'lunette', 'lunettes', 'verre', 'verres', 'catalogue',
            'showroom', 'modele', 'modeles', 'marque', 'marques', 'prix', 'tarif', 'tarifs',
            'collection', 'solaire', 'solaires',
        ] as $keyword) {
            if (str_contains($key, $keyword)) {
                return true;
            }
        }

        foreach ($catalogItems as $item) {
            $haystack = Text::searchKey($item['title'].' '.($item['brand'] ?? '').' '.($item['style'] ?? ''));
            foreach (explode(' ', $haystack) as $word) {
                if (mb_strlen($word, 'UTF-8') >= 3 && str_contains($key, $word)) {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * @param  list<array{
     *     publication_id: string,
     *     slug: string,
     *     title: string,
     *     description: string,
     *     style: ?string,
     *     brand: ?string,
     *     sale_price: ?int,
     *     currency: string,
     * }>  $catalogItems
     * @return list<array{
     *     publication_id: string,
     *     slug: string,
     *     title: string,
     *     description: string,
     *     style: ?string,
     *     brand: ?string,
     *     sale_price: ?int,
     *     currency: string,
     * }>
     */
    private function matchCatalogItems(string $message, array $catalogItems): array
    {
        $queryKey = Text::searchKey($message);
        $tokens = array_values(array_filter(
            explode(' ', $queryKey),
            static fn (string $token): bool => mb_strlen($token, 'UTF-8') >= 3,
        ));

        $scored = [];
        foreach ($catalogItems as $index => $item) {
            $haystack = Text::searchKey($item['title'].' '.($item['brand'] ?? '').' '.($item['style'] ?? '').' '.$item['description']);
            $score = 0;
            foreach ($tokens as $token) {
                if (str_contains($haystack, $token)) {
                    $score++;
                }
            }
            if ($score > 0) {
                $scored[] = ['score' => $score, 'index' => $index, 'item' => $item];
            }
        }

        if ($scored === []) {
            return array_slice($catalogItems, 0, 3);
        }

        usort($scored, static function (array $left, array $right): int {
            if ($left['score'] !== $right['score']) {
                return $right['score'] <=> $left['score'];
            }

            return $left['index'] <=> $right['index'];
        });

        return array_map(static fn (array $row): array => $row['item'], array_slice($scored, 0, 3));
    }
}
