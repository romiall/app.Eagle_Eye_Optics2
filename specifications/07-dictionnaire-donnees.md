# Dictionnaire complet des données

Version 2.0. Ce dictionnaire remplace les silhouettes de tables L1–L3 du premier socle : toutes les tables, colonnes et relations sont définies dès maintenant. Le planning seul donne la priorité au chantier urgent.

Le [catalogue JSON](../database/schema_catalog.json), [SQL MySQL](../database/01_schema.sql) et [modèle relationnel](20-modele-relationnel.md) sont générés ensemble par `database/tools/build_model.py`. Modifier la définition canonique puis régénérer, sans maintenir des noms divergents.

## Conventions de données

ULID ASCII sensible à la casse ; monnaie XAF en entiers FCFA BIGINT, plafonds techniques explicités par CHECK ; quantités DECIMAL(12,3) ; dioptries/centrage DECIMAL(6,2), jamais FLOAT. Instants UTC en DATETIME(6), dates civiles DATE. Age calculé et non stocké. NULL distingue non mesuré de zéro et inconnu de non.

Sélections cliniques multiples normalisées : les anciennes listes DTO `complaint_codes`, `ametropia_codes`, `referral_codes`, `treatment_codes` se convertissent vers leurs tables de liaison. Les snapshots de révision restent JSON immuables. `known_none` représente Aucun connu ; absence de termes avec faux signifie non renseigné. Les antécédents sont liés à leur consultation.

Prescription interne ou transcription d’une ordonnance externe identifiée pour l’achat direct ; jamais créer un examen fictif. La transcription externe est une précision de conception à confirmer avec le cabinet, rattachée au patient et au professionnel qui la valide. Les codes médicaux viennent de DP/PC ; aucune règle ne produit une ordonnance à partir de symptômes.

Les fichiers et clés privées ne sont pas publics. Les champs `*_ciphertext` contiennent une enveloppe chiffrée par le service, pas une fonction de chiffrement MySQL ni une clé stockée dans le même champ. Les contraintes de confidentialité et de flux restent celles du fichier 09.

## Référentiels et absence de données inventées

Le script 02 ne contient que rôles, permissions, catégories/unités et codes cliniques des sources. Aucun cabinet réel, utilisateur avec mot de passe, patient, prix, taux fiscal, fournisseur, template approuvé ou credential n’est créé. Les jours ouvrés et échelles cliniques sont configurés avant usage ; les sources imposent les champs, pas une échelle universelle.

## Données par table


## Référentiels globaux

### clinics

Cabinet et paramètres administratifs ; unique cabinet initial, modèle extensible.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `name` | `VARCHAR(180)` | Non | — |  |
| `timezone` | `VARCHAR(64)` | Non | `'Africa/Douala'` |  |
| `currency` | `CHAR(3) CHARACTER SET ascii COLLATE ascii_bin` | Non | `'XAF'` |  |
| `address` | `TEXT` | Oui | — |  |
| `phone` | `VARCHAR(32)` | Oui | — |  |
| `email` | `VARCHAR(254)` | Oui | — |  |
| `tax_identifier` | `VARCHAR(100)` | Oui | — |  |
| `professional_mentions` | `TEXT` | Oui | — |  |
| `document_settings` | `JSON` | Oui | — |  |
| `production_documents_enabled` | `BOOLEAN` | Non | `0` |  |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### roles

Les quatre profils des sources.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `code` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `label` | `VARCHAR(180)` | Non | — |  |
| `description` | `TEXT` | Oui | — |  |
### permissions

Permissions serveur explicites, sans autorisation déduite du navigateur.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `code` | `VARCHAR(100)` | Non | — |  |
| `label` | `VARCHAR(180)` | Non | — |  |
### role_permissions

Permissions de base des profils.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `role_code` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `permission_code` | `VARCHAR(100)` | Non | — |  |
### clinical_terms

Codes cliniques DP et PC, sélection multiple normalisée.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `group_code` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `code` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `label` | `VARCHAR(180)` | Non | — |  |
| `sort_order` | `SMALLINT UNSIGNED` | Non | `0` |  |
| `active` | `BOOLEAN` | Non | `1` |  |
### catalog_categories

Catégories produit et prestation des sources.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `code` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `label` | `VARCHAR(180)` | Non | — |  |
### units

Unité, paire et prestation ; pas de conversion implicite.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `code` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `label` | `VARCHAR(180)` | Non | — |  |
| `integer_only` | `BOOLEAN` | Non | `1` |  |

## Accès et gouvernance

### users

Compte individuel désactivable, jamais supprimé pour effacer un auteur.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `display_name` | `VARCHAR(180)` | Non | — |  |
| `login` | `VARCHAR(180)` | Non | — |  |
| `email` | `VARCHAR(254)` | Oui | — |  |
| `password_hash` | `VARCHAR(255)` | Non | — |  |
| `active` | `BOOLEAN` | Non | `1` |  |
| `mfa_secret_ciphertext` | `TEXT` | Oui | — |  |
| `mfa_key_id` | `VARCHAR(100)` | Oui | — |  |
| `last_login_at` | `DATETIME(6)` | Oui | — |  |
| `version` | `INT UNSIGNED` | Non | `1` | Version optimiste, jamais un numéro de pièce |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### user_roles

Attribution explicite des profils.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `user_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK users |
| `role_code` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `assigned_by` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK users |
| `assigned_at` | `DATETIME(6)` | Non | — |  |
| `revoked_at` | `DATETIME(6)` | Oui | — |  |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### user_permissions

Dérogation de permission nominative, avec motif.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `user_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK users |
| `permission_code` | `VARCHAR(100)` | Non | — |  |
| `allowed` | `BOOLEAN` | Non | `0` |  |
| `assigned_by` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK users |
| `reason` | `TEXT` | Non | — | Motif obligatoire de l’opération |
| `expires_at` | `DATETIME(6)` | Oui | — |  |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### approvals

Autorisation liée au contenu exact ; cibles polymorphes vérifiées par action.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `action_code` | `VARCHAR(100)` | Non | — |  |
| `target_type` | `VARCHAR(64)` | Non | — |  |
| `target_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `payload_hash` | `CHAR(64) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `requested_by` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK users |
| `reason` | `TEXT` | Non | — | Motif obligatoire de l’opération |
| `status` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | `'REQUESTED'` |  Valeurs : REQUESTED, APPROVED, REFUSED, EXPIRED, CONSUMED |
| `decided_by` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK users |
| `decided_at` | `DATETIME(6)` | Oui | — |  |
| `expires_at` | `DATETIME(6)` | Oui | — |  |
| `consumed_at` | `DATETIME(6)` | Oui | — |  |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### audit_events

Journal append-only ; pas de contenu clinique brut dans log général.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `actor_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK users |
| `actor_name_snapshot` | `VARCHAR(180)` | Non | — |  |
| `action` | `VARCHAR(100)` | Non | — |  |
| `target_type` | `VARCHAR(64)` | Non | — |  |
| `target_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — |  |
| `recorded_at` | `DATETIME(6)` | Non | — |  |
| `correlation_id` | `VARCHAR(100)` | Non | — |  |
| `reason` | `TEXT` | Oui | — |  |
| `sanitized_diff` | `JSON` | Oui | — |  |
| `previous_hash` | `CHAR(64) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — |  |
| `event_hash` | `CHAR(64) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### idempotency_requests

Même commande et hash produisent le même résultat.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `namespace` | `VARCHAR(100)` | Non | — |  |
| `command_name` | `VARCHAR(100)` | Non | — |  |
| `request_key` | `VARCHAR(128)` | Non | — |  |
| `payload_hash` | `CHAR(64) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `status` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : RECEIVED, COMMITTED, FAILED |
| `result_type` | `VARCHAR(64)` | Oui | — |  |
| `result_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — |  |
| `result_payload` | `JSON` | Oui | — |  |
| `completed_at` | `DATETIME(6)` | Oui | — |  |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |

## Documents et exploitation

### stored_files

Fichier privé ou publication approuvée, métadonnées sans secret.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `private_path` | `VARCHAR(500)` | Non | — |  |
| `mime_type` | `VARCHAR(100)` | Non | — |  |
| `size_bytes` | `BIGINT UNSIGNED` | Non | — |  |
| `sha256` | `CHAR(64) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `classification` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : MEDICAL, FINANCIAL, INTERNAL, PUBLIC_APPROVED |
| `encryption_key_id` | `VARCHAR(100)` | Oui | — |  |
| `uploaded_by` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK users |
| `archived_at` | `DATETIME(6)` | Oui | — |  |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### document_sequences

High-water central incluant toutes plages hors-ligne réservées.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `document_type` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : PATIENT, INVOICE, RECEIPT, CREDIT_NOTE, REFUND, LEGACY_BALANCE, QUOTE, WORKSHOP |
| `document_year` | `SMALLINT UNSIGNED` | Non | — |  |
| `last_value` | `BIGINT UNSIGNED` | Non | `0` |  |
| `version` | `INT UNSIGNED` | Non | `1` | Version optimiste, jamais un numéro de pièce |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### document_number_usages

Registre immuable de consommation de numéro, cible vérifiée par commande.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `allocation_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK document_number_allocations |
| `document_type` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : PATIENT, INVOICE, RECEIPT, CREDIT_NOTE, REFUND, LEGACY_BALANCE, QUOTE, WORKSHOP |
| `document_year` | `SMALLINT UNSIGNED` | Non | — |  |
| `number_value` | `BIGINT UNSIGNED` | Non | — |  |
| `rendered_number` | `VARCHAR(64)` | Non | — |  |
| `entity_type` | `VARCHAR(64)` | Non | — |  |
| `entity_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `source_device_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK enrolled_devices |
| `actor_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK users |
| `consumed_at` | `DATETIME(6)` | Non | — |  |
| `status` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : USED, VOID, UNUSED |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### generated_documents

Source typée et fichier original privé à chaque version.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `document_type` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : INVOICE, RECEIPT, CREDIT_NOTE, REFUND, OPTICAL_PRESCRIPTION, CLINICAL_RECORD, WORKSHOP, ACCOUNT_STATEMENT, LEGACY_BALANCE, QUOTE |
| `invoice_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK invoices |
| `receipt_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK receipts |
| `credit_note_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK credit_notes |
| `refund_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK refunds |
| `prescription_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK optical_prescriptions |
| `clinical_revision_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK clinical_revisions |
| `workshop_order_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK workshop_orders |
| `patient_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK patient_records |
| `quote_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK quotes |
| `source_key` | `VARCHAR(100)` | Non | — |  |
| `revision_no` | `INT UNSIGNED` | Non | — |  |
| `template_version` | `VARCHAR(64)` | Non | — |  |
| `file_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK stored_files |
| `sha256` | `CHAR(64) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — |  |
| `status` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : PENDING, READY, FAILED |
| `generated_at` | `DATETIME(6)` | Oui | — |  |
| `failure_code` | `VARCHAR(100)` | Oui | — |  |
| `source_device_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK enrolled_devices |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### export_requests

Export contrôlé de données/archives, jamais fichier public par défaut.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `requested_by` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK users |
| `export_type` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : PATIENT_RECORD, PATIENTS, FINANCE, STOCK, FULL_HANDOVER |
| `patient_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK patient_records |
| `filters` | `JSON` | Oui | — |  |
| `status` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : REQUESTED, PROCESSING, READY, FAILED, EXPIRED |
| `file_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK stored_files |
| `completed_at` | `DATETIME(6)` | Oui | — |  |
| `expires_at` | `DATETIME(6)` | Oui | — |  |
| `error_code` | `VARCHAR(100)` | Oui | — |  |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### backup_runs

Journal de backup, pas la sauvegarde elle-même.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `scope` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : SERVER_DATABASE, SERVER_FILES, OFFLINE_UNSYNCED |
| `device_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK enrolled_devices |
| `started_at` | `DATETIME(6)` | Non | — |  |
| `completed_at` | `DATETIME(6)` | Oui | — |  |
| `status` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : RUNNING, SUCCEEDED, FAILED |
| `private_destination` | `VARCHAR(500)` | Oui | — |  |
| `sha256` | `CHAR(64) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — |  |
| `size_bytes` | `BIGINT UNSIGNED` | Oui | — |  |
| `encryption_key_id` | `VARCHAR(100)` | Oui | — |  |
| `error_code` | `VARCHAR(100)` | Oui | — |  |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### restore_tests

Preuve de restauration serveur ou poste, contrôles et durée.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `backup_run_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK backup_runs |
| `started_at` | `DATETIME(6)` | Non | — |  |
| `completed_at` | `DATETIME(6)` | Oui | — |  |
| `status` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : RUNNING, PASSED, FAILED |
| `tested_by` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK users |
| `checks` | `JSON` | Oui | — |  |
| `observations` | `TEXT` | Oui | — |  |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |

## Patients et clinique

### patient_records

Identité durable, téléphone non unique et naissance connue ou absence expliquée.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `record_number` | `VARCHAR(64)` | Non | — |  |
| `last_name` | `VARCHAR(120)` | Non | — |  |
| `first_names` | `VARCHAR(180)` | Oui | — |  |
| `sex` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | `'UNKNOWN'` |  Valeurs : F, M, UNKNOWN |
| `birth_date` | `DATE` | Oui | — |  |
| `birth_date_missing_reason` | `VARCHAR(255)` | Oui | — |  |
| `phone_primary` | `VARCHAR(32)` | Oui | — |  |
| `phone_primary_normalized` | `VARCHAR(32)` | Oui | — |  |
| `phone_secondary` | `VARCHAR(32)` | Oui | — |  |
| `phone_secondary_normalized` | `VARCHAR(32)` | Oui | — |  |
| `phone_missing_reason` | `VARCHAR(255)` | Oui | — |  |
| `name_search` | `VARCHAR(320)` | Non | — |  |
| `address` | `TEXT` | Oui | — |  |
| `profession` | `VARCHAR(180)` | Oui | — |  |
| `guardian_contact` | `JSON` | Oui | — |  |
| `legacy_record` | `BOOLEAN` | Non | `0` |  |
| `first_known_visit_on` | `DATE` | Oui | — |  |
| `first_visit_certified` | `BOOLEAN` | Non | `0` |  |
| `legacy_record_number` | `VARCHAR(64)` | Oui | — |  |
| `archived_at` | `DATETIME(6)` | Oui | — |  |
| `merged_into_patient_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK patient_records |
| `created_by` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK users |
| `version` | `INT UNSIGNED` | Non | `1` | Version optimiste, jamais un numéro de pièce |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### patient_merges

Fusion manuelle traçable avec ancienne identité conservée.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `source_patient_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK patient_records |
| `survivor_patient_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK patient_records |
| `approved_by` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK users |
| `merged_at` | `DATETIME(6)` | Non | — |  |
| `reason` | `TEXT` | Non | — | Motif obligatoire de l’opération |
| `snapshot` | `JSON` | Non | — | Données figées de la pièce ou révision |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### visits

Passage examen/achat/retrait/suivi ; zéro ou une consultation.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `patient_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK patient_records |
| `reason` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : EXAM, DIRECT_PURCHASE, PICKUP, FOLLOW_UP |
| `occurred_at` | `DATETIME(6)` | Non | — |  |
| `status` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : ARRIVED, AWAITING_EXAM_FEE, READY_FOR_EXAM, IN_CONSULTATION, COMPLETED, CANCELLED |
| `appointment_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK appointments |
| `exam_invoice_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK invoices |
| `exam_waiver_approval_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK approvals |
| `arrival_at` | `DATETIME(6)` | Oui | — |  |
| `closed_at` | `DATETIME(6)` | Oui | — |  |
| `administrative_note` | `TEXT` | Oui | — |  |
| `created_by` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK users |
| `version` | `INT UNSIGNED` | Non | `1` | Version optimiste, jamais un numéro de pièce |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### consultations

Examen clinique avec mesures et versions distinctes des ventes.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `visit_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK visits |
| `patient_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK patient_records |
| `clinician_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK users |
| `effective_at` | `DATETIME(6)` | Non | — |  |
| `date_change_reason` | `TEXT` | Oui | — |  |
| `status` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | `'DRAFT'` |  Valeurs : DRAFT, IN_PROGRESS, COMPLETED |
| `current_revision` | `INT UNSIGNED` | Non | `0` |  |
| `symptoms` | `TEXT` | Oui | — |  |
| `wears_glasses` | `BOOLEAN` | Oui | — |  |
| `glasses_duration` | `TEXT` | Oui | — |  |
| `previous_correction_available` | `BOOLEAN` | Oui | — |  |
| `refraction_observations` | `TEXT` | Oui | — |  |
| `conclusion` | `TEXT` | Oui | — |  |
| `referral` | `BOOLEAN` | Oui | — |  |
| `referral_urgency` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — |  Valeurs : NOT_URGENT, RECOMMENDED, RAPID, EMERGENCY |
| `finalization_missing_data_reason` | `TEXT` | Oui | — |  |
| `completed_at` | `DATETIME(6)` | Oui | — |  |
| `version` | `INT UNSIGNED` | Non | `1` | Version optimiste, jamais un numéro de pièce |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### consultation_complaints

Motifs en sélection multiple, Autre expliqué.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `consultation_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK consultations |
| `term_group` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | `'COMPLAINT'` |  |
| `term_code` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `other_text` | `TEXT` | Oui | — |  |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### consultation_histories

État des antécédents constaté pour cette consultation.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `consultation_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK consultations |
| `history_group` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : OCULAR_HISTORY, MEDICAL_HISTORY, FAMILY_HISTORY |
| `known_none` | `BOOLEAN` | Non | `0` |  |
| `comments` | `TEXT` | Oui | — |  |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### consultation_history_terms

Antécédents positifs normalisés ; exclusivité Aucun connu contrôlée à transaction.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `history_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK consultation_histories |
| `term_group` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : OCULAR_HISTORY, MEDICAL_HISTORY, FAMILY_HISTORY |
| `term_code` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `other_text` | `TEXT` | Oui | — |  |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### consultation_ametropias

Amétropies choisies par professionnel, sans inférence médicale.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `consultation_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK consultations |
| `term_group` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | `'AMETROPIA'` |  |
| `term_code` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `other_text` | `TEXT` | Oui | — |  |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### consultation_referral_reasons

Motifs d’orientation en sélection multiple.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `consultation_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK consultations |
| `term_group` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | `'REFERRAL_REASON'` |  |
| `term_code` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `other_text` | `TEXT` | Oui | — |  |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### visual_acuity_scales

Échelles configurées par cabinet, aucune conversion présumée.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `code` | `VARCHAR(32)` | Non | — |  |
| `label` | `VARCHAR(180)` | Non | — |  |
| `description` | `TEXT` | Oui | — |  |
| `active` | `BOOLEAN` | Non | `1` |  |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### visual_acuities

12 acuités préliminaires et 3 post-réfraction distinctes.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `consultation_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK consultations |
| `context` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : PRELIMINARY, POST_REFRACTION |
| `distance` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : FAR, NEAR, UNSPECIFIED |
| `correction` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : WITHOUT, WITH |
| `eye` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : OD, OG, OU |
| `scale_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK visual_acuity_scales |
| `raw_value` | `VARCHAR(100)` | Non | — |  |
| `normalized_value` | `DECIMAL(8,4)` | Oui | — |  |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### refraction_measurements

Mesures AUTOREFRACTOR/OBJECTIVE/SUBJECTIVE séparées par œil.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `consultation_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK consultations |
| `stage` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : AUTOREFRACTOR, OBJECTIVE, SUBJECTIVE |
| `eye` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : OD, OG |
| `sphere` | `DECIMAL(6,2)` | Oui | — |  |
| `cylinder` | `DECIMAL(6,2)` | Oui | — |  |
| `axis` | `SMALLINT UNSIGNED` | Oui | — |  |
| `addition` | `DECIMAL(6,2)` | Oui | — |  |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### autorefractor_centering

Écart pupillaire objectif total/monoculaire en mm.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `consultation_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK consultations |
| `pd_total` | `DECIMAL(6,2)` | Oui | — |  |
| `pd_od` | `DECIMAL(6,2)` | Oui | — |  |
| `pd_og` | `DECIMAL(6,2)` | Oui | — |  |
| `inconsistency_reason` | `TEXT` | Oui | — |  |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### clinical_revisions

Snapshot complet immuable après finalisation ou correction.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `consultation_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK consultations |
| `revision_no` | `INT UNSIGNED` | Non | — |  |
| `snapshot` | `JSON` | Non | — | Données figées de la pièce ou révision |
| `reason` | `TEXT` | Non | — | Motif obligatoire de l’opération |
| `author_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK users |
| `recorded_at` | `DATETIME(6)` | Non | — |  |
| `previous_revision_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK clinical_revisions |
| `sha256` | `CHAR(64) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### optical_prescriptions

Prescription optique décisionnelle, indépendante des mesures.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `patient_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK patient_records |
| `series_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `origin` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | `'INTERNAL'` |  Valeurs : INTERNAL, EXTERNAL |
| `external_file_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK stored_files |
| `external_prescriber` | `VARCHAR(180)` | Oui | — |  |
| `external_prescribed_on` | `DATE` | Oui | — |  |
| `consultation_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK consultations |
| `version_no` | `INT UNSIGNED` | Non | — |  |
| `status` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | `'DRAFT'` |  Valeurs : DRAFT, VALIDATED |
| `usage_group` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | `'OPTICAL_USAGE'` |  |
| `usage_code` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — |  |
| `usage_other` | `TEXT` | Oui | — |  |
| `lens_type_group` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | `'LENS_TYPE'` |  |
| `lens_type_code` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — |  |
| `lens_type_other` | `TEXT` | Oui | — |  |
| `lens_index` | `DECIMAL(4,2)` | Oui | — |  |
| `lens_index_other` | `TEXT` | Oui | — |  |
| `pd_total` | `DECIMAL(6,2)` | Oui | — |  |
| `pd_od` | `DECIMAL(6,2)` | Oui | — |  |
| `pd_og` | `DECIMAL(6,2)` | Oui | — |  |
| `pd_inconsistency_reason` | `TEXT` | Oui | — |  |
| `notes` | `TEXT` | Oui | — |  |
| `validated_at` | `DATETIME(6)` | Oui | — |  |
| `validated_by` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK users |
| `supersedes_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK optical_prescriptions |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### optical_prescription_eyes

OD et OG, valeurs explicites et hauteur de montage.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `prescription_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK optical_prescriptions |
| `eye` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : OD, OG |
| `no_correction` | `BOOLEAN` | Non | `0` |  |
| `sphere` | `DECIMAL(6,2)` | Oui | — |  |
| `cylinder` | `DECIMAL(6,2)` | Oui | — |  |
| `axis` | `SMALLINT UNSIGNED` | Oui | — |  |
| `addition` | `DECIMAL(6,2)` | Oui | — |  |
| `fitting_height` | `DECIMAL(6,2)` | Oui | — |  |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### optical_prescription_treatments

Traitements DP plus HMC de PC.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `prescription_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK optical_prescriptions |
| `term_group` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | `'LENS_TREATMENT'` |  |
| `term_code` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `other_text` | `TEXT` | Oui | — |  |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### medication_orders

Médicaments prescrits sans création automatique de vente.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `consultation_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK consultations |
| `position` | `SMALLINT UNSIGNED` | Non | — |  |
| `catalog_item_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK catalog_items |
| `name` | `VARCHAR(180)` | Non | — |  |
| `form` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : DROPS, OINTMENT, TABLET, OTHER |
| `form_other` | `VARCHAR(100)` | Oui | — |  |
| `strength` | `VARCHAR(100)` | Oui | — |  |
| `dosage` | `TEXT` | Oui | — |  |
| `frequency` | `VARCHAR(180)` | Oui | — |  |
| `duration_text` | `VARCHAR(180)` | Oui | — |  |
| `duration_value` | `INT UNSIGNED` | Oui | — |  |
| `duration_unit` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — |  Valeurs : DAY, WEEK, MONTH |
| `instructions` | `TEXT` | Oui | — |  |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |

## CRM et assistant

### prospect_contacts

Prospect commercial distinct d’un dossier médical, liaison explicite.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `name` | `VARCHAR(180)` | Non | — |  |
| `phone` | `VARCHAR(32)` | Oui | — |  |
| `phone_normalized` | `VARCHAR(32)` | Oui | — |  |
| `email` | `VARCHAR(254)` | Oui | — |  |
| `patient_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK patient_records |
| `origin` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : CRM, WEBSITE, WHATSAPP, MESSENGER, INSTAGRAM, MANUAL |
| `administrative_notes` | `TEXT` | Oui | — |  |
| `created_by` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK users |
| `version` | `INT UNSIGNED` | Non | `1` | Version optimiste, jamais un numéro de pièce |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### crm_leads

Pipeline Kommo, besoin/budget administratif et liaison prospect.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `prospect_contact_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK prospect_contacts |
| `integration_account_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK integration_accounts |
| `external_lead_id` | `VARCHAR(180)` | Non | — |  |
| `pipeline_id` | `VARCHAR(100)` | Oui | — |  |
| `pipeline_stage` | `VARCHAR(100)` | Non | — |  |
| `product_interest` | `TEXT` | Oui | — |  |
| `budget_min` | `BIGINT` | Oui | — |  |
| `budget_max` | `BIGINT` | Oui | — |  |
| `acquisition_source` | `VARCHAR(100)` | Oui | — |  |
| `assigned_to` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK users |
| `status` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : OPEN, APPOINTMENT_BOOKED, HUMAN_TAKEOVER, WON, LOST, CLOSED |
| `last_synced_at` | `DATETIME(6)` | Oui | — |  |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### crm_conversations

Métadonnées de conversation ; Kommo reste maître du fil intégral.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `crm_lead_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK crm_leads |
| `integration_account_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK integration_accounts |
| `external_conversation_id` | `VARCHAR(180)` | Non | — |  |
| `channel` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : WHATSAPP, MESSENGER, INSTAGRAM |
| `status` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : BOT_ACTIVE, HUMAN_TAKEOVER, CLOSED |
| `human_owner_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK users |
| `takeover_at` | `DATETIME(6)` | Oui | — |  |
| `takeover_reason` | `TEXT` | Oui | — |  |
| `administrative_summary` | `TEXT` | Oui | — |  |
| `bot_resumed_at` | `DATETIME(6)` | Oui | — |  |
| `bot_resumed_by` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK users |
| `last_activity_at` | `DATETIME(6)` | Oui | — |  |
| `version` | `INT UNSIGNED` | Non | `1` | Version optimiste, jamais un numéro de pièce |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### conversation_handoffs

Historique du transfert/reprise humaine, sans réécrire l’état passé.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `conversation_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK crm_conversations |
| `event_type` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : REQUEST, TAKEOVER, RESUME_BOT, CLOSE |
| `actor_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK users |
| `reason` | `TEXT` | Non | — | Motif obligatoire de l’opération |
| `administrative_summary` | `TEXT` | Oui | — |  |
| `occurred_at` | `DATETIME(6)` | Non | — |  |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### knowledge_entries

FAQ et réponses types publiques éditables et versionnées.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `code` | `VARCHAR(100)` | Non | — |  |
| `title` | `VARCHAR(180)` | Non | — |  |
| `category` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : HOURS, LOCATION, PRICING, INSURANCE, SERVICES, LENSES, PRODUCTS, OTHER |
| `active` | `BOOLEAN` | Non | `1` |  |
| `version` | `INT UNSIGNED` | Non | `1` | Version optimiste, jamais un numéro de pièce |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### knowledge_entry_versions

Version validée/publication d’une réponse, pas d’ordonnance IA.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `entry_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK knowledge_entries |
| `revision_no` | `INT UNSIGNED` | Non | — |  |
| `content` | `TEXT` | Non | — |  |
| `language` | `VARCHAR(10)` | Non | `'fr'` |  |
| `authored_by` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK users |
| `approved_by` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK users |
| `approved_at` | `DATETIME(6)` | Oui | — |  |
| `published_at` | `DATETIME(6)` | Oui | — |  |
| `retired_at` | `DATETIME(6)` | Oui | — |  |
| `active_entry_key` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | `CASE WHEN published_at IS NOT NULL AND retired_at IS NULL THEN entry_id ELSE NULL END` |  |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### assistant_runs

Audit technique IA minimal, modèle/coût/outils sans dossier médical.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `conversation_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK crm_conversations |
| `engine_name` | `VARCHAR(100)` | Non | — |  |
| `model_name` | `VARCHAR(100)` | Non | — |  |
| `rules_version` | `VARCHAR(64)` | Non | — |  |
| `started_at` | `DATETIME(6)` | Non | — |  |
| `completed_at` | `DATETIME(6)` | Oui | — |  |
| `status` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : RUNNING, COMPLETED, HANDOFF, FAILED |
| `input_tokens` | `INT UNSIGNED` | Oui | — |  |
| `output_tokens` | `INT UNSIGNED` | Oui | — |  |
| `knowledge_version_ids` | `JSON` | Oui | — |  |
| `sanitized_tool_results` | `JSON` | Oui | — |  |
| `error_code` | `VARCHAR(100)` | Oui | — |  |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |

## Agenda et suivi

### scheduling_resources

Professionnel ou ressource du cabinet.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `name` | `VARCHAR(180)` | Non | — |  |
| `professional_user_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK users |
| `active` | `BOOLEAN` | Non | `1` |  |
| `slot_duration_minutes` | `SMALLINT UNSIGNED` | Non | — |  |
| `version` | `INT UNSIGNED` | Non | `1` | Version optimiste, jamais un numéro de pièce |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### appointment_services

Prestation réservable, tarif métier éventuel et durée.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `name` | `VARCHAR(180)` | Non | — |  |
| `duration_minutes` | `SMALLINT UNSIGNED` | Non | — |  |
| `catalog_item_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK catalog_items |
| `active` | `BOOLEAN` | Non | `1` |  |
| `public_booking` | `BOOLEAN` | Non | `0` |  |
| `version` | `INT UNSIGNED` | Non | `1` | Version optimiste, jamais un numéro de pièce |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### resource_opening_hours

Créneaux hebdomadaires par ressource ; aucune semaine inventée.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `resource_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK scheduling_resources |
| `weekday` | `TINYINT UNSIGNED` | Non | — |  |
| `opens_at` | `TIME` | Non | — |  |
| `closes_at` | `TIME` | Non | — |  |
| `valid_from` | `DATE` | Oui | — |  |
| `valid_to` | `DATE` | Oui | — |  |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### resource_exceptions

Fermeture ou ouverture exceptionnelle datée.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `resource_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK scheduling_resources |
| `starts_at` | `DATETIME(6)` | Non | — |  |
| `ends_at` | `DATETIME(6)` | Non | — |  |
| `is_available` | `BOOLEAN` | Non | `0` |  |
| `reason` | `TEXT` | Non | — | Motif obligatoire de l’opération |
| `created_by` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK users |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### appointments

Créneau confirmé ou proposition offline, distinct du contrôle recommandé.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `patient_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK patient_records |
| `prospect_contact_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK prospect_contacts |
| `follow_up_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK follow_up_plans |
| `resource_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK scheduling_resources |
| `service_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK appointment_services |
| `starts_at` | `DATETIME(6)` | Non | — |  |
| `ends_at` | `DATETIME(6)` | Non | — |  |
| `status` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : PENDING_CONFIRMATION, CONFIRMED, ARRIVED, COMPLETED, CANCELLED, NO_SHOW |
| `source` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : INTERNAL, GOOGLE, CRM, WEBSITE |
| `administrative_reason` | `TEXT` | Oui | — |  |
| `cancel_reason` | `TEXT` | Oui | — |  |
| `created_by` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK users |
| `version` | `INT UNSIGNED` | Non | `1` | Version optimiste, jamais un numéro de pièce |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### calendar_blocks

Indisponibilités internes et externes sans contenu clinique.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `resource_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK scheduling_resources |
| `starts_at` | `DATETIME(6)` | Non | — |  |
| `ends_at` | `DATETIME(6)` | Non | — |  |
| `origin` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : INTERNAL, GOOGLE |
| `label` | `VARCHAR(180)` | Oui | — |  |
| `external_link_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK external_links |
| `created_by` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK users |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### follow_up_plans

Contrôle recommandé, pas une réservation implicite.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `consultation_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK consultations |
| `patient_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK patient_records |
| `reason` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : ROUTINE, DROPS, OTHER |
| `anchor_kind` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : CONSULTATION, TREATMENT_START, TREATMENT_END, MANUAL |
| `anchor_date` | `DATE` | Non | — |  |
| `interval_value` | `INT UNSIGNED` | Oui | — |  |
| `interval_unit` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — |  Valeurs : DAY, MONTH, YEAR |
| `recommended_date` | `DATE` | Non | — |  |
| `date_origin` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : CALCULATED, MANUAL |
| `manual_reason` | `TEXT` | Oui | — |  |
| `reminder_enabled` | `BOOLEAN` | Non | `1` |  |
| `preferred_channel` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : INTERNAL, SMS, WHATSAPP, CALL |
| `advance_value` | `INT UNSIGNED` | Oui | — |  |
| `advance_unit` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — |  Valeurs : DAY, MONTH |
| `notes` | `TEXT` | Oui | — |  |
| `status` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : ACTIVE, SCHEDULED, CLOSED, CANCELLED |
| `version` | `INT UNSIGNED` | Non | `1` | Version optimiste, jamais un numéro de pièce |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |

## Catalogue et facturation

### tax_rules

Régime validé par gérante/comptable, aucun taux fiscal seedé.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `code` | `VARCHAR(40)` | Non | — |  |
| `label` | `VARCHAR(180)` | Non | — |  |
| `rate_percent` | `DECIMAL(7,4)` | Oui | — |  |
| `active` | `BOOLEAN` | Non | `0` |  |
| `validated_by` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK users |
| `validated_at` | `DATETIME(6)` | Oui | — |  |
| `legal_note` | `TEXT` | Oui | — |  |
| `version` | `INT UNSIGNED` | Non | `1` | Version optimiste, jamais un numéro de pièce |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### catalog_items

Catalogue commun prestations, montures, verres, lentilles, collyres et soins.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `reference` | `VARCHAR(64)` | Non | — |  |
| `category_code` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `name` | `VARCHAR(180)` | Non | — |  |
| `brand` | `VARCHAR(120)` | Oui | — |  |
| `model` | `VARCHAR(120)` | Oui | — |  |
| `unit_code` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `quantity_integer_only` | `BOOLEAN` | Non | `1` |  |
| `sale_price` | `BIGINT` | Non | — |  |
| `purchase_cost` | `BIGINT` | Oui | — |  |
| `tax_rule_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK tax_rules |
| `stock_mode` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : NONE, STOCKED, MADE_TO_ORDER |
| `requires_expiry` | `BOOLEAN` | Non | `0` |  |
| `low_stock_threshold` | `DECIMAL(12,3)` | Oui | — |  |
| `expiry_alert_days` | `SMALLINT UNSIGNED` | Oui | — |  |
| `active` | `BOOLEAN` | Non | `1` |  |
| `public_visibility` | `BOOLEAN` | Non | `0` |  |
| `version` | `INT UNSIGNED` | Non | `1` | Version optimiste, jamais un numéro de pièce |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### quotes

Devis cité PC, option de fonctionnement sans dette ni encaissement.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `patient_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK patient_records |
| `prospect_contact_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK prospect_contacts |
| `number` | `VARCHAR(64)` | Oui | — |  |
| `status` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : DRAFT, ISSUED, ACCEPTED, DECLINED, EXPIRED, CONVERTED |
| `valid_until` | `DATE` | Oui | — |  |
| `total_gross` | `BIGINT` | Non | `0` |  |
| `recipient_snapshot` | `JSON` | Oui | — |  |
| `created_by` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK users |
| `issued_at` | `DATETIME(6)` | Oui | — |  |
| `version` | `INT UNSIGNED` | Non | `1` | Version optimiste, jamais un numéro de pièce |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### quote_lines

Lignes de devis, prix figés dans la version remise.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `quote_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK quotes |
| `position` | `SMALLINT UNSIGNED` | Non | — |  |
| `catalog_item_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK catalog_items |
| `description_snapshot` | `VARCHAR(500)` | Non | — |  |
| `unit_code` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `quantity` | `DECIMAL(12,3)` | Non | — |  |
| `unit_price_gross` | `BIGINT` | Non | — |  |
| `discount_gross` | `BIGINT` | Non | `0` |  |
| `line_total_gross` | `BIGINT` | Non | — |  |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### invoices

Facture ou créance restante papier, jamais solde éditable.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `patient_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK patient_records |
| `visit_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK visits |
| `quote_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK quotes |
| `number` | `VARCHAR(64)` | Oui | — |  |
| `issued_at` | `DATETIME(6)` | Oui | — |  |
| `issued_by` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK users |
| `number_usage_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK document_number_usages |
| `status` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | `'DRAFT'` |  Valeurs : DRAFT, ISSUED, ABANDONED |
| `due_date` | `DATE` | Oui | — |  |
| `currency` | `CHAR(3) CHARACTER SET ascii COLLATE ascii_bin` | Non | `'XAF'` |  |
| `total_gross` | `BIGINT` | Non | `0` |  |
| `patient_snapshot` | `JSON` | Oui | — |  |
| `clinic_snapshot` | `JSON` | Oui | — |  |
| `tax_snapshot` | `JSON` | Oui | — |  |
| `origin` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | `'NATIVE'` |  Valeurs : NATIVE, LEGACY_BALANCE |
| `legacy_reference` | `VARCHAR(100)` | Oui | — |  |
| `legacy_opening_balance` | `BIGINT` | Oui | — |  |
| `source_invoice_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK invoices |
| `created_by` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK users |
| `source_device_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK enrolled_devices |
| `version` | `INT UNSIGNED` | Non | `1` | Version optimiste, jamais un numéro de pièce |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### invoice_lines

Lignes exactes, données de catalogue conservées à émission.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `patient_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK patient_records |
| `invoice_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK invoices |
| `position` | `SMALLINT UNSIGNED` | Non | — |  |
| `catalog_item_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK catalog_items |
| `reference_snapshot` | `VARCHAR(64)` | Oui | — |  |
| `description_snapshot` | `VARCHAR(500)` | Non | — |  |
| `category_snapshot` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `unit_snapshot` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `quantity` | `DECIMAL(12,3)` | Non | — |  |
| `unit_price_gross` | `BIGINT` | Non | — |  |
| `discount_gross` | `BIGINT` | Non | `0` |  |
| `line_total_gross` | `BIGINT` | Non | — |  |
| `tax_code_snapshot` | `VARCHAR(40)` | Non | — |  |
| `tax_rate_snapshot` | `DECIMAL(7,4)` | Oui | — |  |
| `tax_amount` | `BIGINT` | Oui | — |  |
| `prescription_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK optical_prescriptions |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### payments

Un encaissement, confirmation humaine ou attente, jamais taxe/caisse supposée.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `invoice_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK invoices |
| `amount` | `BIGINT` | Non | — |  |
| `method` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : CASH, MTN_MOMO, ORANGE_MONEY, BANK_TRANSFER, CHEQUE, OTHER |
| `reference` | `VARCHAR(180)` | Oui | — |  |
| `effective_at` | `DATETIME(6)` | Non | — |  |
| `status` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : PENDING, CONFIRMED, REJECTED |
| `confirmed_at` | `DATETIME(6)` | Oui | — |  |
| `cash_session_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK cash_sessions |
| `received_by` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK users |
| `idempotency_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK idempotency_requests |
| `source_device_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK enrolled_devices |
| `sync_command_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK sync_commands |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### receipts

Exactement une pièce par encaissement confirmé ; original figé.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `payment_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK payments |
| `invoice_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK invoices |
| `number` | `VARCHAR(64)` | Non | — |  |
| `number_usage_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK document_number_usages |
| `issued_at` | `DATETIME(6)` | Non | — |  |
| `issued_by` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK users |
| `snapshot` | `JSON` | Non | — | Données figées de la pièce ou révision |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### payment_reversals

Contre-écriture d’un paiement enregistré à tort, pas remboursement cash.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `payment_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK payments |
| `amount` | `BIGINT` | Non | — |  |
| `reason` | `TEXT` | Non | — | Motif obligatoire de l’opération |
| `approval_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK approvals |
| `recorded_at` | `DATETIME(6)` | Non | — |  |
| `created_by` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK users |
| `idempotency_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK idempotency_requests |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### credit_notes

Avoir corrige créance, jamais automatiquement un retour physique.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `invoice_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK invoices |
| `number` | `VARCHAR(64)` | Oui | — |  |
| `issued_at` | `DATETIME(6)` | Oui | — |  |
| `issued_by` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK users |
| `number_usage_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK document_number_usages |
| `status` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | `'DRAFT'` |  Valeurs : DRAFT, ISSUED, ABANDONED |
| `amount_gross` | `BIGINT` | Non | — |  |
| `reason` | `TEXT` | Non | — | Motif obligatoire de l’opération |
| `approval_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK approvals |
| `snapshot` | `JSON` | Oui | — |  |
| `idempotency_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK idempotency_requests |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### credit_note_lines

Correction plafonnée aux lignes d’origine par commande transactionnelle.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `credit_note_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK credit_notes |
| `invoice_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK invoices |
| `invoice_line_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK invoice_lines |
| `quantity` | `DECIMAL(12,3)` | Oui | — |  |
| `amount_gross` | `BIGINT` | Non | — |  |
| `tax_amount` | `BIGINT` | Oui | — |  |
| `reason` | `TEXT` | Oui | — |  |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### refunds

Remboursement réel autorisé, indépendant d’une contre-écriture.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `invoice_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK invoices |
| `credit_note_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK credit_notes |
| `amount` | `BIGINT` | Non | — |  |
| `method` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : CASH, MTN_MOMO, ORANGE_MONEY, BANK_TRANSFER, CHEQUE, OTHER |
| `reference` | `VARCHAR(180)` | Oui | — |  |
| `approval_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK approvals |
| `number` | `VARCHAR(64)` | Non | — |  |
| `number_usage_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK document_number_usages |
| `effective_at` | `DATETIME(6)` | Non | — |  |
| `cash_session_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK cash_sessions |
| `idempotency_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK idempotency_requests |
| `created_by` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK users |
| `snapshot` | `JSON` | Non | — | Données figées de la pièce ou révision |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### legacy_balance_imports

Pièce papier originale et ancien acompte conservés sans CA nouveau.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `patient_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK patient_records |
| `invoice_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK invoices |
| `paper_reference` | `VARCHAR(100)` | Non | — |  |
| `original_total` | `BIGINT` | Non | — |  |
| `previously_paid` | `BIGINT` | Non | — |  |
| `opening_balance` | `BIGINT` | Non | — |  |
| `original_invoice_on` | `DATE` | Oui | — |  |
| `evidence_file_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK stored_files |
| `evidence_sha256` | `CHAR(64) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `validated_by` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK users |
| `validated_at` | `DATETIME(6)` | Non | — |  |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### quote_revisions

Version figée d’un devis remis ou corrigé.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `quote_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK quotes |
| `revision_no` | `INT UNSIGNED` | Non | — |  |
| `snapshot` | `JSON` | Non | — | Données figées de la pièce ou révision |
| `authored_by` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK users |
| `recorded_at` | `DATETIME(6)` | Non | — |  |
| `reason` | `TEXT` | Non | — | Motif obligatoire de l’opération |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |

## Caisse et rapprochement

### cash_registers

Caisse physique distincte du navigateur ou de la caissière.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `code` | `VARCHAR(40)` | Non | — |  |
| `name` | `VARCHAR(180)` | Non | — |  |
| `active` | `BOOLEAN` | Non | `1` |  |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### cash_sessions

Session comptée, ouverture et clôture avec écart motivé.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `cash_register_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK cash_registers |
| `cashier_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK users |
| `opened_at` | `DATETIME(6)` | Non | — |  |
| `opening_amount` | `BIGINT` | Non | — |  |
| `closed_at` | `DATETIME(6)` | Oui | — |  |
| `counted_amount` | `BIGINT` | Oui | — |  |
| `expected_amount` | `BIGINT` | Oui | — |  |
| `variance` | `BIGINT` | Oui | — |  |
| `variance_reason` | `TEXT` | Oui | — |  |
| `closed_by` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK users |
| `active_register_key` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | `CASE WHEN closed_at IS NULL THEN cash_register_id ELSE NULL END` |  |
| `active_cashier_key` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | `CASE WHEN closed_at IS NULL THEN cashier_id ELSE NULL END` |  |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### expense_categories

Catégories de dépenses validées, pas un plan comptable réglementaire.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `code` | `VARCHAR(40)` | Non | — |  |
| `name` | `VARCHAR(180)` | Non | — |  |
| `active` | `BOOLEAN` | Non | `1` |  |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### cash_movements

Dépenses et mouvements hors vente (tiroir espèces ou hors tiroir), sans duplication paiements/refunds.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `cash_session_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK cash_sessions |
| `kind` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : DEPOSIT, WITHDRAWAL, EXPENSE, OPENING_CORRECTION |
| `method` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | `'CASH'` |  Valeurs : CASH, MTN_MOMO, ORANGE_MONEY, BANK_TRANSFER, CHEQUE, OTHER |
| `signed_amount` | `BIGINT` | Non | — |  |
| `reason` | `TEXT` | Oui | — | Motif de l’opération (facultatif pour une dépense, obligatoire sinon) |
| `approval_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK approvals |
| `expense_category_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK expense_categories |
| `reference` | `VARCHAR(180)` | Oui | — |  |
| `occurred_at` | `DATETIME(6)` | Non | — |  |
| `created_by` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK users |
| `source_device_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK enrolled_devices |
| `sync_command_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK sync_commands |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### payment_reconciliations

Rapprochement d’un canal réel avec justificatifs.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `method` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : CASH, MTN_MOMO, ORANGE_MONEY, BANK_TRANSFER, CHEQUE, OTHER |
| `period_starts_at` | `DATETIME(6)` | Non | — |  |
| `period_ends_at` | `DATETIME(6)` | Non | — |  |
| `status` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : DRAFT, VALIDATED |
| `expected_amount` | `BIGINT` | Non | — |  |
| `statement_amount` | `BIGINT` | Oui | — |  |
| `statement_file_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK stored_files |
| `validated_by` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK users |
| `validated_at` | `DATETIME(6)` | Oui | — |  |
| `variance_reason` | `TEXT` | Oui | — |  |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### payment_reconciliation_lines

Pièces effectivement rapprochées par canal.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `reconciliation_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK payment_reconciliations |
| `payment_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK payments |
| `refund_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK refunds |
| `external_reference` | `VARCHAR(180)` | Oui | — |  |
| `statement_amount` | `BIGINT` | Non | — |  |
| `status` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : MATCHED, UNMATCHED, DISPUTED |
| `note` | `TEXT` | Oui | — |  |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |

## Stock achats et inventaires

### stock_locations

Rayon/atelier/emplacement physique.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `code` | `VARCHAR(40)` | Non | — |  |
| `name` | `VARCHAR(180)` | Non | — |  |
| `active` | `BOOLEAN` | Non | `1` |  |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### suppliers

Fournisseur ou laboratoire, coordonnées administratives.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `name` | `VARCHAR(180)` | Non | — |  |
| `reference` | `VARCHAR(64)` | Non | — |  |
| `phone` | `VARCHAR(32)` | Oui | — |  |
| `email` | `VARCHAR(254)` | Oui | — |  |
| `address` | `TEXT` | Oui | — |  |
| `is_optical_lab` | `BOOLEAN` | Non | `0` |  |
| `active` | `BOOLEAN` | Non | `1` |  |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### goods_receipts

Réception fournisseur validée et justificative.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `supplier_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK suppliers |
| `location_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK stock_locations |
| `supplier_reference` | `VARCHAR(100)` | Non | — |  |
| `received_at` | `DATETIME(6)` | Non | — |  |
| `status` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : DRAFT, VALIDATED, ABANDONED |
| `evidence_file_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK stored_files |
| `validated_by` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK users |
| `validated_at` | `DATETIME(6)` | Oui | — |  |
| `notes` | `TEXT` | Oui | — |  |
| `created_by` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK users |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### stock_positions

Projection physique/réserve centrale/quota local distincts.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `item_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK catalog_items |
| `location_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK stock_locations |
| `on_hand` | `DECIMAL(12,3)` | Non | `0` |  |
| `reserved` | `DECIMAL(12,3)` | Non | `0` |  |
| `offline_allocated` | `DECIMAL(12,3)` | Non | `0` |  |
| `central_available` | `DECIMAL(12,3)` | Non | `on_hand - reserved - offline_allocated` |  |
| `version` | `INT UNSIGNED` | Non | `1` | Version optimiste, jamais un numéro de pièce |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### stock_lots

Lot/péremption et coût connu ; pas de vente d’un lot périmé.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `item_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK catalog_items |
| `location_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK stock_locations |
| `stock_position_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK stock_positions |
| `batch_number` | `VARCHAR(80)` | Non | — |  |
| `expires_on` | `DATE` | Oui | — |  |
| `received_at` | `DATETIME(6)` | Non | — |  |
| `unit_cost` | `BIGINT` | Oui | — |  |
| `status` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : SELLABLE, QUARANTINE |
| `on_hand` | `DECIMAL(12,3)` | Non | `0` |  |
| `reserved` | `DECIMAL(12,3)` | Non | `0` |  |
| `offline_allocated` | `DECIMAL(12,3)` | Non | `0` |  |
| `version` | `INT UNSIGNED` | Non | `1` | Version optimiste, jamais un numéro de pièce |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### goods_receipt_lines

Article/quantité/coût/lot reçus, une ligne par lot.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `receipt_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK goods_receipts |
| `position` | `SMALLINT UNSIGNED` | Non | — |  |
| `item_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK catalog_items |
| `location_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK stock_locations |
| `stock_lot_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK stock_lots |
| `quantity` | `DECIMAL(12,3)` | Non | — |  |
| `unit_cost` | `BIGINT` | Oui | — |  |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### inventory_counts

Inventaire avec théorique figé et validation des écarts.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `location_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK stock_locations |
| `reference` | `VARCHAR(64)` | Non | — |  |
| `snapshot_at` | `DATETIME(6)` | Non | — |  |
| `status` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : OPEN, COUNTED, VALIDATED, ABANDONED |
| `opened_by` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK users |
| `validated_by` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK users |
| `validated_at` | `DATETIME(6)` | Oui | — |  |
| `approval_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK approvals |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### inventory_count_lines

Comptage par article/lot ; lot nullable sans doublon.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `inventory_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK inventory_counts |
| `item_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK catalog_items |
| `location_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK stock_locations |
| `stock_lot_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK stock_lots |
| `lot_key` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | `COALESCE(stock_lot_id,'00000000000000000000000000')` |  |
| `theoretical_quantity` | `DECIMAL(12,3)` | Non | — |  |
| `counted_quantity` | `DECIMAL(12,3)` | Oui | — |  |
| `variance_quantity` | `DECIMAL(12,3)` | Oui | `counted_quantity - theoretical_quantity` |  |
| `variance_reason` | `TEXT` | Oui | — |  |
| `counted_by` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK users |
| `counted_at` | `DATETIME(6)` | Oui | — |  |
| `adjustment_movement_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK stock_movements |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### stock_reservations

Réserve de vente, centrale OU sous quota local.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `item_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK catalog_items |
| `invoice_line_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK invoice_lines |
| `stock_position_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK stock_positions |
| `stock_lot_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK stock_lots |
| `device_allocation_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK device_stock_allocations |
| `quantity` | `DECIMAL(12,3)` | Non | — |  |
| `consumed_quantity` | `DECIMAL(12,3)` | Non | `0` |  |
| `released_quantity` | `DECIMAL(12,3)` | Non | `0` |  |
| `status` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : ACTIVE, CONSUMED, RELEASED |
| `version` | `INT UNSIGNED` | Non | `1` | Version optimiste, jamais un numéro de pièce |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `lot_key` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | `COALESCE(stock_lot_id,'00000000000000000000000000')` |  |
### deliveries

Remise physique liée à facture, partielle ou totale.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `invoice_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK invoices |
| `status` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : DRAFT, CONFIRMED |
| `delivered_at` | `DATETIME(6)` | Oui | — |  |
| `delivered_by` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK users |
| `credit_delivery_approval_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK approvals |
| `idempotency_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK idempotency_requests |
| `patient_snapshot` | `JSON` | Oui | — |  |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### delivery_lines

Quantité remise non déjà livrée, stock et atelier éventuels.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `item_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK catalog_items |
| `stock_position_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK stock_positions |
| `lot_key` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | `COALESCE(stock_lot_id,'00000000000000000000000000')` |  |
| `delivery_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK deliveries |
| `invoice_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK invoices |
| `invoice_line_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK invoice_lines |
| `quantity` | `DECIMAL(12,3)` | Non | — |  |
| `stock_lot_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK stock_lots |
| `workshop_order_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK workshop_orders |
| `reservation_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK stock_reservations |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### physical_returns

Retour physique contrôlé, indépendamment d’un avoir.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `item_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK catalog_items |
| `delivery_line_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK delivery_lines |
| `quantity` | `DECIMAL(12,3)` | Non | — |  |
| `condition_code` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : SELLABLE, DAMAGED, QUARANTINE, OTHER |
| `accepted_for_restock` | `BOOLEAN` | Non | `0` |  |
| `approved_by` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK users |
| `occurred_at` | `DATETIME(6)` | Non | — |  |
| `reason` | `TEXT` | Non | — | Motif obligatoire de l’opération |
| `credit_note_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK credit_notes |
| `idempotency_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK idempotency_requests |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### stock_movements

Faits physiques append-only ; réserve seule n’est pas une sortie.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `lot_key` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | `COALESCE(lot_id,'00000000000000000000000000')` |  |
| `movement_position` | `SMALLINT UNSIGNED` | Non | `1` |  |
| `item_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK catalog_items |
| `position_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK stock_positions |
| `lot_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK stock_lots |
| `kind` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : OPENING, RECEIPT, SALE_DELIVERY, PATIENT_RETURN, BREAKAGE, SUPPLIER_RETURN, ADJUSTMENT |
| `signed_quantity` | `DECIMAL(12,3)` | Non | — |  |
| `unit_cost` | `BIGINT` | Oui | — |  |
| `delivery_line_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK delivery_lines |
| `physical_return_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK physical_returns |
| `goods_receipt_line_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK goods_receipt_lines |
| `approval_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK approvals |
| `reason` | `TEXT` | Non | — | Motif obligatoire de l’opération |
| `occurred_at` | `DATETIME(6)` | Non | — |  |
| `actor_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK users |
| `idempotency_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK idempotency_requests |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### stock_alerts

Alerte de seuil/péremption dédupliquée et résoluble.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `item_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK catalog_items |
| `location_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK stock_locations |
| `lot_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK stock_lots |
| `kind` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : LOW_STOCK, EXPIRY |
| `dedupe_key` | `VARCHAR(180)` | Non | — |  |
| `detected_at` | `DATETIME(6)` | Non | — |  |
| `due_on` | `DATE` | Oui | — |  |
| `status` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : OPEN, ACKNOWLEDGED, RESOLVED |
| `acknowledged_by` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK users |
| `resolved_at` | `DATETIME(6)` | Oui | — |  |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |

## Atelier optique

### workshop_orders

Commande labo et équipement figés ; reprise sans effacement.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `patient_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK patient_records |
| `invoice_line_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK invoice_lines |
| `prescription_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK optical_prescriptions |
| `supplier_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK suppliers |
| `frame_item_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK catalog_items |
| `reference` | `VARCHAR(64)` | Non | — |  |
| `lab_reference` | `VARCHAR(100)` | Oui | — |  |
| `quantity` | `DECIMAL(12,3)` | Non | — |  |
| `snapshot` | `JSON` | Non | — | Données figées de la pièce ou révision |
| `ordered_at` | `DATETIME(6)` | Non | — |  |
| `expected_at` | `DATETIME(6)` | Oui | — |  |
| `received_at` | `DATETIME(6)` | Oui | — |  |
| `status` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : ORDERED, RECEIVED, MOUNTING, QUALITY_CHECK, READY, DELIVERED, CANCELLED |
| `ready_revision` | `INT UNSIGNED` | Non | `0` |  |
| `notes` | `TEXT` | Oui | — |  |
| `created_by` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK users |
| `version` | `INT UNSIGNED` | Non | `1` | Version optimiste, jamais un numéro de pièce |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### workshop_order_eyes

Spécifications verrier OD/OG figées issues d’une prescription validée.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `workshop_order_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK workshop_orders |
| `eye` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : OD, OG |
| `sphere` | `DECIMAL(6,2)` | Oui | — |  |
| `cylinder` | `DECIMAL(6,2)` | Oui | — |  |
| `axis` | `SMALLINT UNSIGNED` | Oui | — |  |
| `addition` | `DECIMAL(6,2)` | Oui | — |  |
| `pd` | `DECIMAL(6,2)` | Oui | — |  |
| `fitting_height` | `DECIMAL(6,2)` | Oui | — |  |
| `lens_type` | `VARCHAR(100)` | Non | — |  |
| `lens_index` | `DECIMAL(4,2)` | Oui | — |  |
| `treatments_snapshot` | `JSON` | Non | — |  |
| `frame_reference_snapshot` | `VARCHAR(100)` | Oui | — |  |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### workshop_events

Transition, reprise ou contrôle qualité auteur/date.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `workshop_order_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK workshop_orders |
| `sequence_no` | `INT UNSIGNED` | Non | — |  |
| `event_type` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : STATUS_CHANGE, REWORK, QUALITY_CHECK, ADJUSTMENT, CANCEL |
| `previous_status` | `VARCHAR(40)` | Oui | — |  |
| `new_status` | `VARCHAR(40)` | Oui | — |  |
| `quality_result` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — |  Valeurs : PASSED, FAILED, NOT_APPLICABLE |
| `observations` | `TEXT` | Oui | — |  |
| `occurred_at` | `DATETIME(6)` | Non | — |  |
| `actor_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK users |
| `delivery_line_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK delivery_lines |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |

## Intégrations

### integration_accounts

Compte Google/Kommo/Meta/SMS, secrets chiffrés séparés des données cliniques.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `provider` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : GOOGLE, KOMMO, META_WHATSAPP, META_MESSENGER, META_INSTAGRAM, SMS, SMTP |
| `external_account_id` | `VARCHAR(180)` | Non | — |  |
| `display_name` | `VARCHAR(180)` | Non | — |  |
| `credentials_ciphertext` | `TEXT` | Oui | — |  |
| `encryption_key_id` | `VARCHAR(100)` | Oui | — |  |
| `token_expires_at` | `DATETIME(6)` | Oui | — |  |
| `status` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : DISABLED, TEST, ACTIVE, ERROR |
| `public_configuration` | `JSON` | Oui | — |  |
| `configured_by` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK users |
| `version` | `INT UNSIGNED` | Non | `1` | Version optimiste, jamais un numéro de pièce |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### external_links

Correspondance externe à version/etag, cible interne contrôlée par adaptateur.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `integration_account_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK integration_accounts |
| `local_entity_type` | `VARCHAR(64)` | Non | — |  |
| `local_entity_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `external_entity_type` | `VARCHAR(64)` | Non | — |  |
| `external_entity_id` | `VARCHAR(180)` | Non | — |  |
| `etag` | `VARCHAR(255)` | Oui | — |  |
| `local_version` | `INT UNSIGNED` | Non | — |  |
| `last_synced_at` | `DATETIME(6)` | Oui | — |  |
| `status` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : PENDING, SYNCED, CONFLICT, FAILED |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### calendar_sync_states

État Google, token et canal push ne remplacent pas l’agenda interne.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `integration_account_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK integration_accounts |
| `resource_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK scheduling_resources |
| `external_calendar_id` | `VARCHAR(255)` | Non | — |  |
| `sync_token_ciphertext` | `TEXT` | Oui | — |  |
| `token_encryption_key_id` | `VARCHAR(100)` | Oui | — |  |
| `pending_page_token` | `VARCHAR(500)` | Oui | — |  |
| `push_channel_id` | `VARCHAR(180)` | Oui | — |  |
| `push_resource_id` | `VARCHAR(255)` | Oui | — |  |
| `push_expires_at` | `DATETIME(6)` | Oui | — |  |
| `last_full_sync_at` | `DATETIME(6)` | Oui | — |  |
| `last_incremental_sync_at` | `DATETIME(6)` | Oui | — |  |
| `status` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : NOT_CONFIGURED, READY, SYNCING, STALE, ERROR |
| `last_error_code` | `VARCHAR(100)` | Oui | — |  |
| `version` | `INT UNSIGNED` | Non | `1` | Version optimiste, jamais un numéro de pièce |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### webhook_inbox

Réception durable/dédupliquée, données minimales protégées.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `integration_account_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK integration_accounts |
| `provider_event_key` | `VARCHAR(180)` | Non | — |  |
| `payload_hash` | `CHAR(64) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `payload_ciphertext` | `TEXT` | Non | — |  |
| `encryption_key_id` | `VARCHAR(100)` | Non | — |  |
| `received_at` | `DATETIME(6)` | Non | — |  |
| `status` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : RECEIVED, VERIFIED, PROCESSED, REJECTED, FAILED |
| `verified_at` | `DATETIME(6)` | Oui | — |  |
| `processed_at` | `DATETIME(6)` | Oui | — |  |
| `attempt_count` | `INT UNSIGNED` | Non | `0` |  |
| `last_error_code` | `VARCHAR(100)` | Oui | — |  |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### outbox_events

Effets externes après commit, payload minimal et déduplication.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `event_type` | `VARCHAR(100)` | Non | — |  |
| `event_version` | `SMALLINT UNSIGNED` | Non | — |  |
| `source_type` | `VARCHAR(64)` | Non | — |  |
| `source_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `source_version` | `INT UNSIGNED` | Non | — |  |
| `payload` | `JSON` | Non | — |  |
| `correlation_id` | `VARCHAR(100)` | Non | — |  |
| `status` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : PENDING, PROCESSING, PROCESSED, FAILED |
| `processed_at` | `DATETIME(6)` | Oui | — |  |
| `attempt_count` | `INT UNSIGNED` | Non | `0` |  |
| `next_attempt_at` | `DATETIME(6)` | Oui | — |  |
| `last_error_code` | `VARCHAR(100)` | Oui | — |  |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |

## Communications et relances

### reminder_policies

Contrôle DP et anti-no-show PC, canaux/horaires configurés.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `code` | `VARCHAR(64)` | Non | — |  |
| `label` | `VARCHAR(180)` | Non | — |  |
| `purpose` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : APPOINTMENT, FOLLOW_UP, ORDER_UPDATE, PAYMENT_FOLLOW_UP |
| `channel` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : INTERNAL, CALL, SMS, WHATSAPP |
| `offset_unit` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : HOUR, DAY, MONTH |
| `offset_value` | `INT` | Non | — |  |
| `local_send_time` | `TIME` | Oui | — |  |
| `active` | `BOOLEAN` | Non | `1` |  |
| `version` | `INT UNSIGNED` | Non | `1` | Version optimiste, jamais un numéro de pièce |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### contact_tasks

Tâche et échéance uniques avec source typée.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `patient_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK patient_records |
| `prospect_contact_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK prospect_contacts |
| `follow_up_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK follow_up_plans |
| `appointment_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK appointments |
| `invoice_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK invoices |
| `workshop_order_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK workshop_orders |
| `policy_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK reminder_policies |
| `source_version` | `INT UNSIGNED` | Non | — |  |
| `due_at` | `DATETIME(6)` | Non | — |  |
| `channel` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : INTERNAL, CALL, SMS, WHATSAPP |
| `status` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : PENDING, CONTACTED, BOOKED, NO_RESPONSE, REFUSED, POSTPONED, CANCELLED |
| `next_attempt_at` | `DATETIME(6)` | Oui | — |  |
| `assigned_to` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK users |
| `dedupe_key` | `VARCHAR(180)` | Non | — |  |
| `administrative_notes` | `TEXT` | Oui | — |  |
| `version` | `INT UNSIGNED` | Non | `1` | Version optimiste, jamais un numéro de pièce |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### contact_attempts

Historique du contact humain ou système.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `task_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK contact_tasks |
| `actor_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK users |
| `occurred_at` | `DATETIME(6)` | Non | — |  |
| `result` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : CONTACTED, BOOKED, NO_RESPONSE, REFUSED, POSTPONED, FAILED |
| `appointment_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK appointments |
| `administrative_note` | `TEXT` | Oui | — |  |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### communication_consents

Événements consentement/retrait par sujet, numéro précis et finalité.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `patient_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK patient_records |
| `prospect_contact_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK prospect_contacts |
| `channel` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : SMS, WHATSAPP, CALL, EMAIL |
| `purpose` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : APPOINTMENT, FOLLOW_UP, ORDER_UPDATE, PAYMENT_FOLLOW_UP, MARKETING |
| `destination_hash` | `CHAR(64) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `destination_ciphertext` | `TEXT` | Non | — |  |
| `encryption_key_id` | `VARCHAR(100)` | Non | — |  |
| `status` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : GRANTED, REVOKED |
| `recorded_at` | `DATETIME(6)` | Non | — |  |
| `recorded_by` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK users |
| `proof` | `TEXT` | Non | — |  |
| `policy_version` | `VARCHAR(64)` | Non | — |  |
| `event_sequence` | `BIGINT UNSIGNED` | Non | — |  |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `subject_key` | `VARCHAR(28) CHARACTER SET ascii COLLATE ascii_bin` | Non | `CASE WHEN patient_id IS NOT NULL THEN CONCAT('P:',patient_id) ELSE CONCAT('C:',prospect_contact_id) END` |  |
### message_templates

Template administratif ou promotionnel, aucune activation par défaut.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `code` | `VARCHAR(100)` | Non | — |  |
| `channel` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : SMS, WHATSAPP, EMAIL |
| `purpose` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : APPOINTMENT, FOLLOW_UP, ORDER_UPDATE, PAYMENT_FOLLOW_UP, MARKETING |
| `active` | `BOOLEAN` | Non | `0` |  |
| `version` | `INT UNSIGNED` | Non | `1` | Version optimiste, jamais un numéro de pièce |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### message_template_versions

Texte et version fournisseur validés, variables autorisées.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `template_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK message_templates |
| `integration_account_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK integration_accounts |
| `revision_no` | `INT UNSIGNED` | Non | — |  |
| `provider_template_id` | `VARCHAR(180)` | Oui | — |  |
| `language` | `VARCHAR(10)` | Non | `'fr'` |  |
| `body` | `TEXT` | Non | — |  |
| `allowed_variables` | `JSON` | Non | — |  |
| `media_file_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK stored_files |
| `provider_approval_status` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : DRAFT, PENDING, APPROVED, REJECTED, PAUSED |
| `approved_by` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK users |
| `approved_at` | `DATETIME(6)` | Oui | — |  |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### audience_segments

Filtres administratifs ciblés, validés par code et non pathologies.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `name` | `VARCHAR(180)` | Non | — |  |
| `criteria` | `JSON` | Non | — |  |
| `criteria_schema_version` | `VARCHAR(64)` | Non | — |  |
| `created_by` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK users |
| `version` | `INT UNSIGNED` | Non | `1` | Version optimiste, jamais un numéro de pièce |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### campaign_definitions

Campagne avec cible figée et autorisation gérante.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `name` | `VARCHAR(180)` | Non | — |  |
| `segment_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK audience_segments |
| `template_version_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK message_template_versions |
| `approval_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK approvals |
| `scheduled_at` | `DATETIME(6)` | Oui | — |  |
| `status` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : DRAFT, APPROVED, RUNNING, COMPLETED, CANCELLED, FAILED |
| `created_by` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK users |
| `target_frozen_at` | `DATETIME(6)` | Oui | — |  |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### campaign_recipients

Destinataire de cible figée, consentement revérifié juste avant envoi.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `campaign_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK campaign_definitions |
| `patient_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK patient_records |
| `prospect_contact_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK prospect_contacts |
| `destination_hash` | `CHAR(64) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `destination_ciphertext` | `TEXT` | Non | — |  |
| `encryption_key_id` | `VARCHAR(100)` | Non | — |  |
| `consent_event_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK communication_consents |
| `status` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : PENDING, ELIGIBLE, EXCLUDED, SUBMITTED, DELIVERED, FAILED, CANCELLED |
| `exclusion_reason` | `TEXT` | Oui | — |  |
| `consent_checked_at` | `DATETIME(6)` | Oui | — |  |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### message_attempts

Tentative avec état fournisseur ; timeout peut rester inconnu.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `task_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK contact_tasks |
| `campaign_recipient_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK campaign_recipients |
| `integration_account_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK integration_accounts |
| `template_version_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK message_template_versions |
| `consent_event_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK communication_consents |
| `destination_hash` | `CHAR(64) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `destination_ciphertext` | `TEXT` | Non | — |  |
| `encryption_key_id` | `VARCHAR(100)` | Non | — |  |
| `dedupe_key` | `VARCHAR(180)` | Non | — |  |
| `provider_message_id` | `VARCHAR(180)` | Oui | — |  |
| `attempt_no` | `INT UNSIGNED` | Non | — |  |
| `status` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : PLANNED, SUBMITTED, DELIVERED, READ, FAILED, UNKNOWN, CANCELLED |
| `submitted_at` | `DATETIME(6)` | Oui | — |  |
| `delivered_at` | `DATETIME(6)` | Oui | — |  |
| `read_at` | `DATETIME(6)` | Oui | — |  |
| `error_code` | `VARCHAR(100)` | Oui | — |  |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |

## Showroom et réservation publique

### catalog_publications

Description approuvée et filtres publics sans prix achat/stock détaillé.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `catalog_item_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK catalog_items |
| `slug` | `VARCHAR(180)` | Non | — |  |
| `public_title` | `VARCHAR(180)` | Non | — |  |
| `public_description` | `TEXT` | Non | — |  |
| `style` | `VARCHAR(100)` | Oui | — |  |
| `show_sale_price` | `BOOLEAN` | Non | `0` |  |
| `status` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : DRAFT, PUBLISHED, ARCHIVED |
| `display_order` | `INT` | Non | `0` |  |
| `approved_by` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK users |
| `published_at` | `DATETIME(6)` | Oui | — |  |
| `version` | `INT UNSIGNED` | Non | `1` | Version optimiste, jamais un numéro de pièce |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### catalog_media

Images produit validées avec droits et ordre affichage.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `publication_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK catalog_publications |
| `file_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK stored_files |
| `alt_text` | `VARCHAR(255)` | Non | — |  |
| `display_order` | `INT` | Non | `0` |  |
| `rights_note` | `TEXT` | Non | — |  |
| `approved_by` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK users |
| `approved_at` | `DATETIME(6)` | Non | — |  |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### public_contents

Contenu limité vitrine/prestations/coordonnées, pas CMS illimité.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `code` | `VARCHAR(100)` | Non | — |  |
| `title` | `VARCHAR(180)` | Non | — |  |
| `content` | `TEXT` | Non | — |  |
| `revision_no` | `INT UNSIGNED` | Non | — |  |
| `status` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : DRAFT, PUBLISHED, ARCHIVED |
| `approved_by` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK users |
| `published_at` | `DATETIME(6)` | Oui | — |  |
| `version` | `INT UNSIGNED` | Non | `1` | Version optimiste, jamais un numéro de pièce |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### public_booking_requests

Demande de réservation protégée avant confirmation centrale.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `catalog_publication_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK catalog_publications |
| `public_reference` | `VARCHAR(100)` | Non | — |  |
| `prospect_contact_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK prospect_contacts |
| `service_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK appointment_services |
| `resource_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK scheduling_resources |
| `requested_starts_at` | `DATETIME(6)` | Non | — |  |
| `requested_ends_at` | `DATETIME(6)` | Non | — |  |
| `appointment_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK appointments |
| `request_key` | `VARCHAR(128)` | Non | — |  |
| `status` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : RECEIVED, PENDING, CONFIRMED, CONFLICT, CANCELLED, REJECTED |
| `consent_recorded_at` | `DATETIME(6)` | Non | — |  |
| `consent_policy_version` | `VARCHAR(64)` | Non | — |  |
| `management_token_hash` | `CHAR(64) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `token_expires_at` | `DATETIME(6)` | Non | — |  |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |

## Hors-ligne et synchronisation

### enrolled_devices

Poste préparé, aucun clone des droits financiers.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `device_code` | `VARCHAR(64)` | Non | — |  |
| `name` | `VARCHAR(180)` | Non | — |  |
| `public_key_jwk` | `TEXT` | Non | — |  |
| `key_algorithm` | `VARCHAR(16)` | Non | `'ES256'` |  |
| `status` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : ACTIVE, REVOKED, LOST, REPLACED |
| `enrolled_by` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK users |
| `responsible_user_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK users |
| `enrolled_at` | `DATETIME(6)` | Non | — |  |
| `last_sync_at` | `DATETIME(6)` | Oui | — |  |
| `last_accepted_sequence` | `BIGINT UNSIGNED` | Non | `0` |  |
| `last_accepted_hash` | `CHAR(64) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — |  |
| `app_version` | `VARCHAR(64)` | Non | — |  |
| `replaced_by_device_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK enrolled_devices |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### offline_grants

Autorisation signée bornée ; clés privées non présentes dans MySQL.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `device_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK enrolled_devices |
| `user_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK users |
| `permissions_snapshot` | `JSON` | Non | — |  |
| `rules_version` | `VARCHAR(64)` | Non | — |  |
| `catalog_version` | `VARCHAR(64)` | Non | — |  |
| `issued_at` | `DATETIME(6)` | Non | — |  |
| `valid_until` | `DATETIME(6)` | Non | — |  |
| `signed_payload` | `TEXT` | Non | — |  |
| `revoked_at` | `DATETIME(6)` | Oui | — |  |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### document_number_allocations

Plages pré-allouées disjointes, pas de libération automatique.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `device_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK enrolled_devices |
| `grant_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK offline_grants |
| `document_type` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : PATIENT, INVOICE, RECEIPT, CREDIT_NOTE, REFUND, LEGACY_BALANCE, QUOTE, WORKSHOP |
| `document_year` | `SMALLINT UNSIGNED` | Non | — |  |
| `range_start` | `BIGINT UNSIGNED` | Non | — |  |
| `range_end` | `BIGINT UNSIGNED` | Non | — |  |
| `last_consumed_value` | `BIGINT UNSIGNED` | Oui | — |  |
| `status` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : ACTIVE, CLOSING, CLOSED |
| `allocated_at` | `DATETIME(6)` | Non | — |  |
| `closed_at` | `DATETIME(6)` | Oui | — |  |
| `version` | `INT UNSIGNED` | Non | `1` | Version optimiste, jamais un numéro de pièce |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### invoice_write_owners

Un seul propriétaire financier, clôture après ACK de toutes commandes.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `invoice_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK invoices |
| `device_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK enrolled_devices |
| `epoch` | `INT UNSIGNED` | Non | — |  |
| `status` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : ACTIVE, CLOSING, CLOSED |
| `granted_at` | `DATETIME(6)` | Non | — |  |
| `closed_at` | `DATETIME(6)` | Oui | — |  |
| `final_device_sequence` | `BIGINT UNSIGNED` | Oui | — |  |
| `active_invoice_key` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | `CASE WHEN status IN ('ACTIVE','CLOSING') THEN invoice_id ELSE NULL END` |  |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### device_stock_allocations

Quota exclusif article/lot, réserve locale incluse dans quota restant.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `device_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK enrolled_devices |
| `stock_position_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK stock_positions |
| `stock_lot_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK stock_lots |
| `allocated_quantity` | `DECIMAL(12,3)` | Non | — |  |
| `consumed_quantity` | `DECIMAL(12,3)` | Non | `0` |  |
| `returned_quantity` | `DECIMAL(12,3)` | Non | `0` |  |
| `status` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : ACTIVE, CLOSING, CLOSED |
| `allocated_at` | `DATETIME(6)` | Non | — |  |
| `closed_at` | `DATETIME(6)` | Oui | — |  |
| `version` | `INT UNSIGNED` | Non | `1` | Version optimiste, jamais un numéro de pièce |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `lot_key` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | `COALESCE(stock_lot_id,'00000000000000000000000000')` |  |
### sync_commands

Commande immuable reçue ; état de traitement dans table séparée.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `device_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK enrolled_devices |
| `actor_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK users |
| `grant_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK offline_grants |
| `device_sequence` | `BIGINT UNSIGNED` | Non | — |  |
| `previous_event_hash` | `CHAR(64) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — |  |
| `event_hash` | `CHAR(64) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `signature` | `TEXT` | Non | — |  |
| `schema_version` | `VARCHAR(64)` | Non | — |  |
| `rules_version` | `VARCHAR(64)` | Non | — |  |
| `command_name` | `VARCHAR(100)` | Non | — |  |
| `occurred_at_local` | `DATETIME(6)` | Non | — |  |
| `last_server_time` | `DATETIME(6)` | Non | — |  |
| `entity_type` | `VARCHAR(64)` | Non | — |  |
| `entity_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `expected_version` | `INT UNSIGNED` | Oui | — |  |
| `number_allocation_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK document_number_allocations |
| `payload_ciphertext` | `TEXT` | Non | — |  |
| `encryption_key_id` | `VARCHAR(100)` | Non | — |  |
| `received_at` | `DATETIME(6)` | Non | — |  |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### sync_command_results

ACK durable ou litige ; commande originale jamais écrasée.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `command_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK sync_commands |
| `status` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : RECEIVED, ACCEPTED, WAITING_DEPENDENCY, CONFLICT_REQUIRES_REVIEW, REJECTED |
| `result_references` | `JSON` | Oui | — |  |
| `error_code` | `VARCHAR(100)` | Oui | — |  |
| `processed_at` | `DATETIME(6)` | Oui | — |  |
| `attempt_count` | `INT UNSIGNED` | Non | `0` |  |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### sync_conflicts

Versions en conflit et résolution explicite avec pièces conservées.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `command_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK sync_commands |
| `conflict_type` | `VARCHAR(100)` | Non | — |  |
| `local_snapshot_ciphertext` | `TEXT` | Non | — |  |
| `central_snapshot_ciphertext` | `TEXT` | Non | — |  |
| `encryption_key_id` | `VARCHAR(100)` | Non | — |  |
| `status` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : OPEN, RESOLVED |
| `resolution` | `TEXT` | Oui | — |  |
| `resolved_by` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Oui | — | FK users |
| `resolved_at` | `DATETIME(6)` | Oui | — |  |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
### sync_change_log

Journal de changement serveur pour pull paginé filtré par Policy.

| Colonne | Type SQL | NULL | Défaut ou calcul | Sens ou relation |
| --- | --- | --- | --- | --- |
| `id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `clinic_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — | FK clinics |
| `change_sequence` | `BIGINT UNSIGNED AUTO_INCREMENT` | Non | — |  |
| `entity_type` | `VARCHAR(64)` | Non | — |  |
| `entity_id` | `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  |
| `entity_version` | `INT UNSIGNED` | Non | — |  |
| `recorded_at` | `DATETIME(6)` | Non | — |  |
| `visibility` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : ADMINISTRATIVE, CLINICAL, FINANCIAL, MANAGER, PUBLIC |
| `change_kind` | `VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin` | Non | — |  Valeurs : CREATED, UPDATED, ARCHIVED |
| `created_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
| `updated_at` | `DATETIME(6)` | Non | `CURRENT_TIMESTAMP(6)` |  |
