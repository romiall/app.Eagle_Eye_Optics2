# Domaine, HTTPS et courrier du cabinet (L3D04, EE040)

Procédure d'exploitation du domaine, du certificat et de la messagerie. **Le domaine, sa zone DNS, l'hébergement et les boîtes de courrier appartiennent au client** ; le développement ne les achète pas, ne les modifie pas et n'en garde aucun accès. Ce document dit quoi vérifier, comment, et qui fait quoi quand quelque chose casse.

## 1. Règles

- **Aucun achat ni changement de DNS sans autorisation écrite du client.** Le contrôle fourni (`eeo:domain:check`) ne fait que LIRE : requêtes DNS, poignée de main TLS, deux requêtes HTTP, bannière SMTP. Il ne crée aucun compte, n'envoie aucun courrier, ne s'authentifie nulle part.
- **Les comptes appartiennent au client.** Le titulaire du domaine, du panneau d'hébergement et des boîtes est le client (ou la personne qu'il désigne par écrit). Le prestataire n'est titulaire d'aucun.
- **Les secrets sont distincts des accès du développeur.** Mots de passe de boîtes, clés DKIM privées, identifiants SMTP et jetons : jamais dans le dépôt, jamais dans un message ; ceux de l'application vivent dans `~/eeo/.env` (production) et, pour les connecteurs, chiffrés en base (`/parametres/integrations`). L'accès SSH du développeur (clé) n'est pas un accès du client et se révoque sans toucher aux comptes du client.
- **Rien n'est supposé.** Quand un enregistrement ou un fournisseur est inconnu, le contrôle l'écrit « non précisé » et ne devine pas.

## 2. Inventaire à tenir (propriétaire et détenteur de chaque accès)

À remplir avec le client ; une ligne vide n'est pas un défaut de l'application.

| Élément | Propriétaire | Qui détient l'accès | État connu |
| --- | --- | --- | --- |
| Domaine du cabinet (`eagleeyeoptic.com` au fichier 02) et sa zone DNS | Client | À renseigner | Aucune modification faite par le développement |
| Nom de production de l'application | Client | Hébergeur (panneau hPanel) | `app-eagleseye.com` en service (fichier 12 proposait `app.eagleeyeoptic.com`, à confirmer) |
| Hébergement (mutualisé, sans VPS) et certificat HTTPS | Client | À renseigner | Certificat Let's Encrypt valide (renouvellement par l'hébergeur), voir `docs/evidence/domain-checks.md` |
| Boîtes `direction@` et `contact@` du domaine du cabinet | Client | À renseigner | « Si disponibles » (fichier 02) : non vérifiées, domaine de messagerie non précisé au contrôle |
| Sauvegardes (clé de chiffrement, copie hors serveur) | Client | À renseigner | Voir `docs/runbooks/server-restore.md` ; la copie hors serveur est mise de côté (décision du 2026-11-10) |

## 3. Contrôle en lecture seule

Depuis le poste de développement, ou depuis le serveur :

```bash
php artisan eeo:domain:check --host=app-eagleseye.com
php artisan eeo:domain:check --host=app-eagleseye.com --mail-domain=<domaine-de-messagerie> --smtp-host=<serveur-smtp> --dkim-selector=<sélecteur>
php artisan eeo:domain:check --host=app-eagleseye.com --json
```

Par défaut, l'hôte vient de `APP_URL`, le domaine de messagerie de `MAIL_FROM_ADDRESS` et le serveur de `MAIL_HOST` ; une valeur d'exemple (`example.com`, `127.0.0.1`) n'est jamais contrôlée. Le code de sortie est 0 sans point bloquant, 1 sinon ; `--json` donne le rapport à consigner dans `docs/evidence/domain-checks.md`.

| Contrôle | Réussi quand… | Si ce n'est pas le cas |
| --- | --- | --- |
| Application : DNS | Le nom a au moins une adresse A ou AAAA. | **Bloquant.** Zone DNS du client : enregistrement A/AAAA absent ou domaine expiré (section 6, cas 2). |
| Application : certificat HTTPS | Chaîne et nom reconnus, échéance dans plus de 21 jours. | **Bloquant** si expiré, non reconnu ou illisible ; alerte sous 21 jours (section 6, cas 1). |
| Application : HTTP vers HTTPS | Le port 80 renvoie (301, 302, 307 ou 308) vers `https://`. | Alerte : le trafic pourrait rester en clair ; réglage de redirection de l'hébergeur. |
| Application : sonde `/up` | `https://<hôte>/up` répond 200 `{"status":"ok"}`. | **Bloquant.** Voir `docs/implementation/deploiement.md` (reprise d'un déploiement). |
| Application : HSTS | `Strict-Transport-Security` est présent. | Alerte : à décider avec le client, voir `docs/evidence/domain-checks.md`. |
| Messagerie : MX, SPF, DMARC, DKIM | Enregistrements publiés ; un seul SPF. | Alerte (jamais bloquant : les boîtes sont facultatives). Les valeurs viennent du fournisseur de messagerie du client. |
| Messagerie : SMTP | Bannière `220` et chiffrement (STARTTLS ou TLS implicite). | Alerte. |

## 4. Boîtes `direction@` et `contact@` (si les comptes sont disponibles)

1. Le **client** crée les boîtes dans le panneau de son fournisseur de messagerie (ou demande à son hébergeur) : le développement n'y a pas accès.
2. Le fournisseur indique les enregistrements à publier (MX, SPF, DKIM, DMARC). Le **client** (ou son prestataire DNS) les publie dans SA zone. Ne jamais recopier un enregistrement d'un autre domaine ni d'un exemple.
3. Relancer `eeo:domain:check` avec `--mail-domain`, `--smtp-host` et `--dkim-selector` : tout doit passer en OK.
4. L'application n'envoie, aujourd'hui, aucun courrier : les canaux sortants (SMS, WhatsApp, e-mail) sont en mode simulé tant que les comptes des fournisseurs ne sont pas fournis (Q10 et Q11, `docs/runbooks/integration-incidents.md`). Les identifiants SMTP, le jour venu, se saisissent dans `/parametres/integrations` (chiffrés), jamais dans un fichier.

## 5. Délivrabilité vers une boîte contrôlée

À faire seulement quand les boîtes existent, avec l'accord du client et une boîte de réception que le client contrôle :

1. Le client envoie un message de test depuis `contact@` vers la boîte contrôlée.
2. Dans le message reçu, afficher les en-têtes complets et noter les lignes `Authentication-Results` : `spf=pass`, `dkim=pass`, `dmarc=pass`.
3. Consigner le résultat (date, boîte d'origine, boîte de réception, verdicts) dans `docs/evidence/domain-checks.md`. Un verdict autre que `pass` se corrige chez le fournisseur de messagerie, puis se rejoue.

Cette étape n'a PAS été exécutée : elle exige les boîtes et un destinataire du client (voir l'écart dans `docs/evidence/domain-checks.md`).

## 6. Incidents et reprise

| Cas | Signe | Qui | Reprise |
| --- | --- | --- | --- |
| 1. Certificat expiré ou proche de l'échéance | Alerte ou point bloquant « certificat HTTPS » ; le navigateur affiche un avertissement. | Titulaire du panneau d'hébergement (client) | Dans le panneau, relancer l'émission du certificat (Let's Encrypt est renouvelé par l'hébergeur) ; relancer le contrôle. Tant que le certificat est invalide, l'application n'est pas utilisable en sécurité : ne pas contourner l'avertissement. |
| 2. Nom non résolu | « DNS » bloquant. | Titulaire du domaine (client) | Vérifier l'échéance du domaine et l'enregistrement A/AAAA chez le registraire ; ne jamais modifier une zone sans autorisation écrite du client. |
| 3. Application hors service | `/up` bloquant. | Exploitant | `docs/implementation/deploiement.md` ; en dernier recours, retour à la release précédente. |
| 4. Courrier refusé ou classé en indésirable | SPF/DKIM/DMARC absents ou en échec. | Client et fournisseur de messagerie | Republier les enregistrements fournis, attendre la propagation, rejouer la section 5. |
| 5. Boîte pleine ou compte compromis | Hors du contrôle (panneau du fournisseur). | Client | Changer le mot de passe de la boîte, vérifier les règles de transfert, prévenir le prestataire si l'accès SSH doit être contrôlé. |

## 7. Registre des accès (à tenir par le client)

Chaque accès donné au prestataire est noté ici, avec sa date d'octroi et de retrait. Le prestataire ne conserve aucun accès à la fin de la mission (voir `docs/runbooks/handover.md`).

| Accès | Donné le | Retiré le | Par qui |
| --- | --- | --- | --- |
| SSH de déploiement (clé du développeur) | À renseigner | À renseigner | Client |
| Panneau d'hébergement | À renseigner | À renseigner | Client |
| Zone DNS | Aucun accès donné à ce jour | — | Client |
| Boîtes de courrier | Aucun accès donné à ce jour | — | Client |
