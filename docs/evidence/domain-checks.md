# Preuves : domaine, HTTPS et messagerie (L3D04, EE040)

Procédure : `docs/runbooks/domain-email.md`. Contrôle : `php artisan eeo:domain:check` (en lecture seule : aucun achat, aucune modification de zone, aucun compte créé, aucun courrier envoyé).

## 1. Contrôle de l'application en production (2026-11-15)

Lancé depuis le poste de développement (aucun accès au serveur), sur le nom de production, par le contrôle livré dans le dépôt :

```
php artisan eeo:domain:check --host=app-eagleseye.com

  OK      Application : DNS                app-eagleseye.com → 77.37.83.185, 91.108.98.138, 2a02:4780:32:c05d:2b67:d4ba:79c2:f7e7, 2a02:4780:24:39bc:630:f026:7f2:2e9b
  OK      Application : certificat HTTPS   Valide jusqu'au 24/01/2027 (app-eagleseye.com, émis par Let's Encrypt).
  OK      Application : HTTP vers HTTPS    Le port 80 renvoie (statut 301) vers https://app-eagleseye.com/up
  OK      Application : sonde /up          https://app-eagleseye.com/up répond 200 {"status":"ok"}.
  ALERTE  Application : HSTS               L'en-tête Strict-Transport-Security est absent des réponses HTTPS.
  info    Messagerie                       Domaine de messagerie non précisé : relancer avec --mail-domain=<domaine> pour contrôler MX, SPF, DKIM et DMARC.

Aucun point bloquant (1 alerte(s) à lire).
```

| Exigence de la fiche L3D04 | Résultat |
| --- | --- |
| Vérifier HTTPS et DNS | **Fait** : nom résolu, certificat reconnu jusqu'au 24/01/2027, port 80 renvoyé vers HTTPS, sonde de santé OK. |
| Vérifier SMTP et enregistrements de messagerie accessibles | **Outil livré et testé ; non exécuté sur les boîtes du cabinet** : le domaine de messagerie et le serveur SMTP du client ne sont pas connus (aucun compte n'a été fourni). Le contrôle le dit (« non précisé ») au lieu de le deviner. |
| Configurer direction et contact si comptes disponibles | **Non fait : aucun compte n'a été fourni** (« si disponibles », fichier 02). Les boîtes appartiennent au client ; procédure en section 4 du runbook. |
| Tester la délivrabilité vers une boîte contrôlée et la reprise d'incident | **Reprise d'incident documentée** (section 6 du runbook) ; **délivrabilité non testée** : elle exige les boîtes et un destinataire contrôlé par le client (section 5 du runbook). |
| Aucun achat ou changement DNS non autorisé | **Respecté** : aucun achat, aucune modification de zone ; le contrôle ne fait que lire. |
| Comptes appartenant au client | **Respecté** : le prestataire n'est titulaire d'aucun compte (registre des accès, section 7 du runbook). |
| Secrets distincts des accès développeur | **Respecté** : `.env` de production hors dépôt, connecteurs chiffrés en base, clé de sauvegarde à part ; l'accès SSH par clé du développeur n'ouvre aucun compte du client. |

## 2. Écarts à décider avec le client

1. **HSTS absent.** L'application ne pose pas `Strict-Transport-Security` et l'hébergeur n'en ajoute pas. Le poser est recommandé (par exemple un an, sans `includeSubDomains`), mais un navigateur qui l'a lu ne revient pas en arrière avant l'échéance : à faire APRÈS confirmation du nom de production (le fichier 12 proposait `app.eagleeyeoptic.com`). Non fait : la décision appartient au client.
2. **Messagerie non contrôlée.** Domaine de messagerie, serveur SMTP et sélecteur DKIM inconnus. Relancer `eeo:domain:check --mail-domain=… --smtp-host=… --dkim-selector=…` dès que le client les fournit, et consigner le résultat ici.
3. **Délivrabilité à tester** sur une boîte contrôlée par le client (section 5 du runbook).

## 3. Preuves automatisées du contrôle

`tests/Feature/Deployment/DomainCheckTest.php` : verdict sur le certificat (expiré, non reconnu, illisible, proche de l'échéance, valide), nom non résolu, redirection HTTP et sonde de santé, messagerie incomplète (MX, SPF double, DMARC, DKIM, SMTP sans chiffrement : alertes, jamais bloquant), absence de domaine de messagerie, rapport JSON et code de sortie, configuration de démonstration jamais contrôlée, sondes HTTP qui ne suivent pas les redirections. Sondes simulées : aucun réseau.
