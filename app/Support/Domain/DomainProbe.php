<?php

namespace App\Support\Domain;

/**
 * Sondes réseau EN LECTURE SEULE du contrôle du domaine (`php artisan eeo:domain:check`, L3D04) : certificat HTTPS,
 * requête HTTP sans redirection suivie, enregistrements DNS et bannière SMTP. Jamais d'authentification, d'envoi de
 * courrier ni de modification : ce que le client possède (domaine, zone DNS, messagerie) n'est qu'interrogé.
 *
 * Interface : les tests jouent des réponses déterministes (certificat expiré, SPF absent…) sans réseau.
 */
interface DomainProbe
{
    /**
     * Certificat présenté par `host:port` ; `trusted` vaut vrai si la chaîne ET le nom d'hôte sont vérifiés.
     *
     * @return array{trusted: bool, valid_from: int|null, valid_to: int|null, subject: string|null, issuer: string|null, error: string|null}
     */
    public function certificate(string $host, int $port = 443): array;

    /**
     * Réponse d'une requête GET, SANS suivre les redirections (la redirection elle-même est ce qu'on contrôle).
     *
     * @return array{status: int|null, location: string|null, body: string|null, headers: array<string, string>, error: string|null}
     */
    public function http(string $url): array;

    /**
     * Enregistrements DNS d'un type (`A`, `AAAA`, `MX`, `TXT`, `CNAME`) : adresse pour A et AAAA, « priorité hôte » pour
     * MX, texte pour TXT et CNAME ; liste vide si le nom n'existe pas ou si le type n'a aucun enregistrement.
     *
     * @return list<string>
     */
    public function dns(string $name, string $type): array;

    /**
     * Bannière et capacités annoncées par un serveur SMTP (EHLO), sans authentification ni envoi. `tls` vaut `implicite`
     * (port 465), `STARTTLS` (annoncé) ou null (aucun chiffrement annoncé).
     *
     * @return array{banner: string|null, capabilities: list<string>, tls: string|null, error: string|null}
     */
    public function smtp(string $host, int $port): array;
}
