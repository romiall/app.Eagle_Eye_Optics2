-- Eagle's Eye Optics Medical | Complete application schema | 2026-10-14
-- Target: MySQL 8.4 / InnoDB / utf8mb4. All domains are defined NOW.
-- Run on an EMPTY database selected by your client. No DROP, TRUNCATE or credentials.
-- No USE here: shared hosting database name is provided by its owner.
-- Installation order: 01_schema, 02_reference_data, 03_reporting_views, 04_history_guards.
-- Foreign keys are added after tables to handle the documented cyclic links.
-- Cross-row totals, permissions, cryptography and physical events still require app transactions.
SET NAMES utf8mb4 COLLATE utf8mb4_0900_ai_ci;
SET SESSION time_zone = '+00:00';
SET SESSION sql_mode = 'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION,ONLY_FULL_GROUP_BY';


-- Référentiels globaux : Cabinet et paramètres administratifs ; unique cabinet initial, modèle extensible
CREATE TABLE `clinics` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `name` VARCHAR(180) NOT NULL,
  `timezone` VARCHAR(64) NOT NULL DEFAULT 'Africa/Douala',
  `currency` CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'XAF',
  `address` TEXT NULL,
  `phone` VARCHAR(32) NULL,
  `email` VARCHAR(254) NULL,
  `tax_identifier` VARCHAR(100) NULL,
  `professional_mentions` TEXT NULL,
  `document_settings` JSON NULL,
  `production_documents_enabled` BOOLEAN NOT NULL DEFAULT 0,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  CONSTRAINT `ck_clinics_01` CHECK (currency = 'XAF'),
  CONSTRAINT `ck_clinics_02` CHECK (`production_documents_enabled` IN (0,1)),
  CONSTRAINT `ck_clinics_03` CHECK (id <> '00000000000000000000000000'),
  CONSTRAINT `ck_clinics_04` CHECK (`document_settings` IS NULL OR JSON_TYPE(`document_settings`) = 'OBJECT')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Cabinet et paramètres administratifs ; unique cabinet initial, modèle extensible';

-- Référentiels globaux : Les quatre profils des sources
CREATE TABLE `roles` (
  `code` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `label` VARCHAR(180) NOT NULL,
  `description` TEXT NULL,
  PRIMARY KEY (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Les quatre profils des sources';

-- Référentiels globaux : Permissions serveur explicites, sans autorisation déduite du navigateur
CREATE TABLE `permissions` (
  `code` VARCHAR(100) NOT NULL,
  `label` VARCHAR(180) NOT NULL,
  PRIMARY KEY (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Permissions serveur explicites, sans autorisation déduite du navigateur';

-- Référentiels globaux : Permissions de base des profils
CREATE TABLE `role_permissions` (
  `role_code` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `permission_code` VARCHAR(100) NOT NULL,
  PRIMARY KEY (`role_code`, `permission_code`),
  KEY `ix_role_permissions_01` (`permission_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Permissions de base des profils';

-- Référentiels globaux : Codes cliniques DP et PC, sélection multiple normalisée
CREATE TABLE `clinical_terms` (
  `group_code` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `code` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `label` VARCHAR(180) NOT NULL,
  `sort_order` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `active` BOOLEAN NOT NULL DEFAULT 1,
  PRIMARY KEY (`group_code`, `code`),
  CONSTRAINT `ck_clinical_terms_01` CHECK (`active` IN (0,1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Codes cliniques DP et PC, sélection multiple normalisée';

-- Référentiels globaux : Catégories produit et prestation des sources
CREATE TABLE `catalog_categories` (
  `code` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `label` VARCHAR(180) NOT NULL,
  PRIMARY KEY (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Catégories produit et prestation des sources';

-- Référentiels globaux : Unité, paire et prestation ; pas de conversion implicite
CREATE TABLE `units` (
  `code` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `label` VARCHAR(180) NOT NULL,
  `integer_only` BOOLEAN NOT NULL DEFAULT 1,
  PRIMARY KEY (`code`),
  CONSTRAINT `ck_units_01` CHECK (`integer_only` IN (0,1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Unité, paire et prestation ; pas de conversion implicite';

-- Accès et gouvernance : Compte individuel désactivable, jamais supprimé pour effacer un auteur
CREATE TABLE `users` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `display_name` VARCHAR(180) NOT NULL,
  `login` VARCHAR(180) NOT NULL,
  `email` VARCHAR(254) NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `active` BOOLEAN NOT NULL DEFAULT 1,
  `mfa_secret_ciphertext` TEXT NULL,
  `mfa_key_id` VARCHAR(100) NULL,
  `last_login_at` DATETIME(6) NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'Version optimiste, jamais un numéro de pièce',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_users_02` (`clinic_id`, `login`),
  UNIQUE KEY `uq_users_03` (`clinic_id`, `email`),
  CONSTRAINT `ck_users_01` CHECK (`active` IN (0,1)),
  CONSTRAINT `ck_users_02` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Compte individuel désactivable, jamais supprimé pour effacer un auteur';

-- Accès et gouvernance : Attribution explicite des profils
CREATE TABLE `user_roles` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `user_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `role_code` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `assigned_by` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `assigned_at` DATETIME(6) NOT NULL,
  `revoked_at` DATETIME(6) NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_user_roles_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_user_roles_02` (`clinic_id`, `user_id`, `role_code`),
  KEY `ix_user_roles_01` (`role_code`),
  KEY `ix_user_roles_02` (`clinic_id`, `assigned_by`),
  CONSTRAINT `ck_user_roles_01` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Attribution explicite des profils';

-- Accès et gouvernance : Dérogation de permission nominative, avec motif
CREATE TABLE `user_permissions` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `user_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `permission_code` VARCHAR(100) NOT NULL,
  `allowed` BOOLEAN NOT NULL DEFAULT 0,
  `assigned_by` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `reason` TEXT NOT NULL COMMENT 'Motif obligatoire de l’opération',
  `expires_at` DATETIME(6) NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_user_permissions_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_user_permissions_02` (`clinic_id`, `user_id`, `permission_code`),
  KEY `ix_user_permissions_01` (`permission_code`),
  KEY `ix_user_permissions_02` (`clinic_id`, `assigned_by`),
  CONSTRAINT `ck_user_permissions_01` CHECK (`allowed` IN (0,1)),
  CONSTRAINT `ck_user_permissions_02` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Dérogation de permission nominative, avec motif';

-- Documents et exploitation : Fichier privé ou publication approuvée, métadonnées sans secret
CREATE TABLE `stored_files` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `private_path` VARCHAR(500) NOT NULL,
  `mime_type` VARCHAR(100) NOT NULL,
  `size_bytes` BIGINT UNSIGNED NOT NULL,
  `sha256` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `classification` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `encryption_key_id` VARCHAR(100) NULL,
  `uploaded_by` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `archived_at` DATETIME(6) NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_stored_files_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_stored_files_02` (`clinic_id`, `private_path`),
  KEY `ix_stored_files_01` (`clinic_id`, `uploaded_by`),
  CONSTRAINT `ck_stored_files_01` CHECK (`classification` IN ('MEDICAL','FINANCIAL','INTERNAL','PUBLIC_APPROVED')),
  CONSTRAINT `ck_stored_files_02` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Fichier privé ou publication approuvée, métadonnées sans secret';

-- Accès et gouvernance : Autorisation liée au contenu exact ; cibles polymorphes vérifiées par action
CREATE TABLE `approvals` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `action_code` VARCHAR(100) NOT NULL,
  `target_type` VARCHAR(64) NOT NULL,
  `target_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `payload_hash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `requested_by` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `reason` TEXT NOT NULL COMMENT 'Motif obligatoire de l’opération',
  `status` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'REQUESTED',
  `decided_by` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `decided_at` DATETIME(6) NULL,
  `expires_at` DATETIME(6) NULL,
  `consumed_at` DATETIME(6) NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_approvals_01` (`clinic_id`, `id`),
  KEY `ix_approvals_01` (`clinic_id`, `requested_by`),
  KEY `ix_approvals_02` (`clinic_id`, `decided_by`),
  CONSTRAINT `ck_approvals_01` CHECK (status NOT IN ('APPROVED','REFUSED','CONSUMED') OR (decided_by IS NOT NULL AND decided_at IS NOT NULL)),
  CONSTRAINT `ck_approvals_02` CHECK (status <> 'CONSUMED' OR consumed_at IS NOT NULL),
  CONSTRAINT `ck_approvals_03` CHECK (`status` IN ('REQUESTED','APPROVED','REFUSED','EXPIRED','CONSUMED')),
  CONSTRAINT `ck_approvals_04` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Autorisation liée au contenu exact ; cibles polymorphes vérifiées par action';

-- Accès et gouvernance : Journal append-only ; pas de contenu clinique brut dans log général
CREATE TABLE `audit_events` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `actor_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `actor_name_snapshot` VARCHAR(180) NOT NULL,
  `action` VARCHAR(100) NOT NULL,
  `target_type` VARCHAR(64) NOT NULL,
  `target_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `recorded_at` DATETIME(6) NOT NULL,
  `correlation_id` VARCHAR(100) NOT NULL,
  `reason` TEXT NULL,
  `sanitized_diff` JSON NULL,
  `previous_hash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `event_hash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_audit_events_01` (`clinic_id`, `id`),
  KEY `ix_audit_events_01` (`clinic_id`, `target_type`, `target_id`, `recorded_at`),
  KEY `ix_audit_events_02` (`clinic_id`, `actor_id`, `recorded_at`),
  CONSTRAINT `ck_audit_events_01` CHECK (id <> '00000000000000000000000000'),
  CONSTRAINT `ck_audit_events_02` CHECK (`sanitized_diff` IS NULL OR JSON_TYPE(`sanitized_diff`) = 'OBJECT')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Journal append-only ; pas de contenu clinique brut dans log général';

-- Accès et gouvernance : Même commande et hash produisent le même résultat
CREATE TABLE `idempotency_requests` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `namespace` VARCHAR(100) NOT NULL,
  `command_name` VARCHAR(100) NOT NULL,
  `request_key` VARCHAR(128) NOT NULL,
  `payload_hash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `status` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `result_type` VARCHAR(64) NULL,
  `result_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `result_payload` JSON NULL,
  `completed_at` DATETIME(6) NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_idempotency_requests_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_idempotency_requests_02` (`clinic_id`, `namespace`, `command_name`, `request_key`),
  CONSTRAINT `ck_idempotency_requests_01` CHECK (`status` IN ('RECEIVED','COMMITTED','FAILED')),
  CONSTRAINT `ck_idempotency_requests_02` CHECK (id <> '00000000000000000000000000'),
  CONSTRAINT `ck_idempotency_requests_03` CHECK (`result_payload` IS NULL OR JSON_TYPE(`result_payload`) = 'OBJECT')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Même commande et hash produisent le même résultat';

-- Patients et clinique : Identité durable, téléphone non unique et naissance connue ou absence expliquée
CREATE TABLE `patient_records` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `record_number` VARCHAR(64) NOT NULL,
  `last_name` VARCHAR(120) NOT NULL,
  `first_names` VARCHAR(180) NULL,
  `sex` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'UNKNOWN',
  `birth_date` DATE NULL,
  `birth_date_missing_reason` VARCHAR(255) NULL,
  `phone_primary` VARCHAR(32) NULL,
  `phone_primary_normalized` VARCHAR(32) NULL,
  `phone_secondary` VARCHAR(32) NULL,
  `phone_secondary_normalized` VARCHAR(32) NULL,
  `phone_missing_reason` VARCHAR(255) NULL,
  `name_search` VARCHAR(320) NOT NULL,
  `address` TEXT NULL,
  `profession` VARCHAR(180) NULL,
  `guardian_contact` JSON NULL,
  `legacy_record` BOOLEAN NOT NULL DEFAULT 0,
  `first_known_visit_on` DATE NULL,
  `first_visit_certified` BOOLEAN NOT NULL DEFAULT 0,
  `legacy_record_number` VARCHAR(64) NULL,
  `archived_at` DATETIME(6) NULL,
  `merged_into_patient_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `created_by` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'Version optimiste, jamais un numéro de pièce',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_patient_records_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_patient_records_02` (`clinic_id`, `record_number`),
  KEY `ix_patient_records_01` (`clinic_id`, `name_search`),
  KEY `ix_patient_records_02` (`clinic_id`, `phone_primary_normalized`),
  KEY `ix_patient_records_03` (`clinic_id`, `merged_into_patient_id`),
  KEY `ix_patient_records_04` (`clinic_id`, `created_by`),
  CONSTRAINT `ck_patient_records_01` CHECK (birth_date IS NOT NULL OR birth_date_missing_reason IS NOT NULL),
  CONSTRAINT `ck_patient_records_02` CHECK (phone_primary IS NOT NULL OR phone_missing_reason IS NOT NULL),
  CONSTRAINT `ck_patient_records_03` CHECK (merged_into_patient_id IS NULL OR merged_into_patient_id <> id),
  CONSTRAINT `ck_patient_records_04` CHECK (`sex` IN ('F','M','UNKNOWN')),
  CONSTRAINT `ck_patient_records_05` CHECK (`legacy_record` IN (0,1)),
  CONSTRAINT `ck_patient_records_06` CHECK (`first_visit_certified` IN (0,1)),
  CONSTRAINT `ck_patient_records_07` CHECK (id <> '00000000000000000000000000'),
  CONSTRAINT `ck_patient_records_08` CHECK (`guardian_contact` IS NULL OR JSON_TYPE(`guardian_contact`) = 'OBJECT')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Identité durable, téléphone non unique et naissance connue ou absence expliquée';

-- Patients et clinique : Fusion manuelle traçable avec ancienne identité conservée
CREATE TABLE `patient_merges` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `source_patient_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `survivor_patient_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `approved_by` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `merged_at` DATETIME(6) NOT NULL,
  `reason` TEXT NOT NULL COMMENT 'Motif obligatoire de l’opération',
  `snapshot` JSON NOT NULL COMMENT 'Données figées de la pièce ou révision',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_patient_merges_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_patient_merges_02` (`clinic_id`, `source_patient_id`),
  KEY `ix_patient_merges_01` (`clinic_id`, `survivor_patient_id`),
  KEY `ix_patient_merges_02` (`clinic_id`, `approved_by`),
  CONSTRAINT `ck_patient_merges_01` CHECK (source_patient_id <> survivor_patient_id),
  CONSTRAINT `ck_patient_merges_02` CHECK (id <> '00000000000000000000000000'),
  CONSTRAINT `ck_patient_merges_03` CHECK (`snapshot` IS NULL OR JSON_TYPE(`snapshot`) = 'OBJECT')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Fusion manuelle traçable avec ancienne identité conservée';

-- CRM et assistant : Prospect commercial distinct d’un dossier médical, liaison explicite
CREATE TABLE `prospect_contacts` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `name` VARCHAR(180) NOT NULL,
  `phone` VARCHAR(32) NULL,
  `phone_normalized` VARCHAR(32) NULL,
  `email` VARCHAR(254) NULL,
  `patient_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `origin` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `administrative_notes` TEXT NULL,
  `created_by` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'Version optimiste, jamais un numéro de pièce',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_prospect_contacts_01` (`clinic_id`, `id`),
  KEY `ix_prospect_contacts_01` (`clinic_id`, `phone_normalized`),
  KEY `ix_prospect_contacts_02` (`clinic_id`, `patient_id`),
  KEY `ix_prospect_contacts_03` (`clinic_id`, `created_by`),
  CONSTRAINT `ck_prospect_contacts_01` CHECK (`origin` IN ('CRM','WEBSITE','WHATSAPP','MESSENGER','INSTAGRAM','MANUAL')),
  CONSTRAINT `ck_prospect_contacts_02` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Prospect commercial distinct d’un dossier médical, liaison explicite';

-- Agenda et suivi : Professionnel ou ressource du cabinet
CREATE TABLE `scheduling_resources` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `name` VARCHAR(180) NOT NULL,
  `professional_user_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `active` BOOLEAN NOT NULL DEFAULT 1,
  `slot_duration_minutes` SMALLINT UNSIGNED NOT NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'Version optimiste, jamais un numéro de pièce',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_scheduling_resources_01` (`clinic_id`, `id`),
  KEY `ix_scheduling_resources_01` (`clinic_id`, `professional_user_id`),
  CONSTRAINT `ck_scheduling_resources_01` CHECK (slot_duration_minutes > 0),
  CONSTRAINT `ck_scheduling_resources_02` CHECK (`active` IN (0,1)),
  CONSTRAINT `ck_scheduling_resources_03` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Professionnel ou ressource du cabinet';

-- Agenda et suivi : Prestation réservable, tarif métier éventuel et durée
CREATE TABLE `appointment_services` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `name` VARCHAR(180) NOT NULL,
  `duration_minutes` SMALLINT UNSIGNED NOT NULL,
  `catalog_item_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `active` BOOLEAN NOT NULL DEFAULT 1,
  `public_booking` BOOLEAN NOT NULL DEFAULT 0,
  `version` INT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'Version optimiste, jamais un numéro de pièce',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_appointment_services_01` (`clinic_id`, `id`),
  KEY `ix_appointment_services_01` (`clinic_id`, `catalog_item_id`),
  CONSTRAINT `ck_appointment_services_01` CHECK (duration_minutes > 0),
  CONSTRAINT `ck_appointment_services_02` CHECK (`active` IN (0,1)),
  CONSTRAINT `ck_appointment_services_03` CHECK (`public_booking` IN (0,1)),
  CONSTRAINT `ck_appointment_services_04` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Prestation réservable, tarif métier éventuel et durée';

-- Agenda et suivi : Créneaux hebdomadaires par ressource ; aucune semaine inventée
CREATE TABLE `resource_opening_hours` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `resource_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `weekday` TINYINT UNSIGNED NOT NULL,
  `opens_at` TIME NOT NULL,
  `closes_at` TIME NOT NULL,
  `valid_from` DATE NULL,
  `valid_to` DATE NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_resource_opening_hours_01` (`clinic_id`, `id`),
  KEY `ix_resource_opening_hours_01` (`clinic_id`, `resource_id`),
  CONSTRAINT `ck_resource_opening_hours_01` CHECK (weekday BETWEEN 1 AND 7),
  CONSTRAINT `ck_resource_opening_hours_02` CHECK (closes_at > opens_at),
  CONSTRAINT `ck_resource_opening_hours_03` CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from),
  CONSTRAINT `ck_resource_opening_hours_04` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Créneaux hebdomadaires par ressource ; aucune semaine inventée';

-- Agenda et suivi : Fermeture ou ouverture exceptionnelle datée
CREATE TABLE `resource_exceptions` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `resource_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `starts_at` DATETIME(6) NOT NULL,
  `ends_at` DATETIME(6) NOT NULL,
  `is_available` BOOLEAN NOT NULL DEFAULT 0,
  `reason` TEXT NOT NULL COMMENT 'Motif obligatoire de l’opération',
  `created_by` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_resource_exceptions_01` (`clinic_id`, `id`),
  KEY `ix_resource_exceptions_01` (`clinic_id`, `resource_id`),
  KEY `ix_resource_exceptions_02` (`clinic_id`, `created_by`),
  CONSTRAINT `ck_resource_exceptions_01` CHECK (ends_at > starts_at),
  CONSTRAINT `ck_resource_exceptions_02` CHECK (`is_available` IN (0,1)),
  CONSTRAINT `ck_resource_exceptions_03` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Fermeture ou ouverture exceptionnelle datée';

-- Agenda et suivi : Créneau confirmé ou proposition offline, distinct du contrôle recommandé
CREATE TABLE `appointments` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `patient_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `prospect_contact_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `follow_up_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `resource_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `service_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `starts_at` DATETIME(6) NOT NULL,
  `ends_at` DATETIME(6) NOT NULL,
  `status` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `source` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `administrative_reason` TEXT NULL,
  `cancel_reason` TEXT NULL,
  `created_by` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'Version optimiste, jamais un numéro de pièce',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_appointments_01` (`clinic_id`, `id`),
  KEY `ix_appointments_01` (`clinic_id`, `resource_id`, `starts_at`, `ends_at`),
  KEY `ix_appointments_02` (`clinic_id`, `patient_id`, `starts_at`),
  KEY `ix_appointments_03` (`clinic_id`, `follow_up_id`, `patient_id`),
  KEY `ix_appointments_04` (`clinic_id`, `prospect_contact_id`),
  KEY `ix_appointments_05` (`clinic_id`, `service_id`),
  KEY `ix_appointments_06` (`clinic_id`, `created_by`),
  CONSTRAINT `ck_appointments_01` CHECK (ends_at > starts_at),
  CONSTRAINT `ck_appointments_02` CHECK ((patient_id IS NOT NULL) + (prospect_contact_id IS NOT NULL) = 1),
  CONSTRAINT `ck_appointments_03` CHECK (follow_up_id IS NULL OR patient_id IS NOT NULL),
  CONSTRAINT `ck_appointments_04` CHECK (`status` IN ('PENDING_CONFIRMATION','CONFIRMED','ARRIVED','COMPLETED','CANCELLED','NO_SHOW')),
  CONSTRAINT `ck_appointments_05` CHECK (`source` IN ('INTERNAL','GOOGLE','CRM','WEBSITE')),
  CONSTRAINT `ck_appointments_06` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Créneau confirmé ou proposition offline, distinct du contrôle recommandé';

-- Agenda et suivi : Indisponibilités internes et externes sans contenu clinique
CREATE TABLE `calendar_blocks` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `resource_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `starts_at` DATETIME(6) NOT NULL,
  `ends_at` DATETIME(6) NOT NULL,
  `origin` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `label` VARCHAR(180) NULL,
  `external_link_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `created_by` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_calendar_blocks_01` (`clinic_id`, `id`),
  KEY `ix_calendar_blocks_01` (`clinic_id`, `resource_id`),
  KEY `ix_calendar_blocks_02` (`clinic_id`, `external_link_id`),
  KEY `ix_calendar_blocks_03` (`clinic_id`, `created_by`),
  CONSTRAINT `ck_calendar_blocks_01` CHECK (ends_at > starts_at),
  CONSTRAINT `ck_calendar_blocks_02` CHECK (`origin` IN ('INTERNAL','GOOGLE')),
  CONSTRAINT `ck_calendar_blocks_03` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Indisponibilités internes et externes sans contenu clinique';

-- Patients et clinique : Passage examen/achat/retrait/suivi ; zéro ou une consultation
CREATE TABLE `visits` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `patient_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `reason` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `occurred_at` DATETIME(6) NOT NULL,
  `status` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `appointment_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `exam_invoice_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `exam_waiver_approval_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `arrival_at` DATETIME(6) NULL,
  `closed_at` DATETIME(6) NULL,
  `administrative_note` TEXT NULL,
  `created_by` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'Version optimiste, jamais un numéro de pièce',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_visits_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_visits_02` (`clinic_id`, `id`, `patient_id`),
  KEY `ix_visits_01` (`clinic_id`, `patient_id`, `occurred_at`),
  KEY `ix_visits_02` (`clinic_id`, `occurred_at`, `status`),
  KEY `ix_visits_03` (`clinic_id`, `exam_invoice_id`, `id`, `patient_id`),
  KEY `ix_visits_04` (`clinic_id`, `appointment_id`),
  KEY `ix_visits_05` (`clinic_id`, `exam_waiver_approval_id`),
  KEY `ix_visits_06` (`clinic_id`, `created_by`),
  CONSTRAINT `ck_visits_01` CHECK (`reason` IN ('EXAM','DIRECT_PURCHASE','PICKUP','FOLLOW_UP')),
  CONSTRAINT `ck_visits_02` CHECK (`status` IN ('ARRIVED','AWAITING_EXAM_FEE','READY_FOR_EXAM','IN_CONSULTATION','COMPLETED','CANCELLED')),
  CONSTRAINT `ck_visits_03` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Passage examen/achat/retrait/suivi ; zéro ou une consultation';

-- Patients et clinique : Examen clinique avec mesures et versions distinctes des ventes
CREATE TABLE `consultations` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `visit_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `patient_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinician_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `effective_at` DATETIME(6) NOT NULL,
  `date_change_reason` TEXT NULL,
  `status` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'DRAFT',
  `current_revision` INT UNSIGNED NOT NULL DEFAULT 0,
  `symptoms` TEXT NULL,
  `wears_glasses` BOOLEAN NULL,
  `glasses_duration` TEXT NULL,
  `previous_correction_available` BOOLEAN NULL,
  `refraction_observations` TEXT NULL,
  `conclusion` TEXT NULL,
  `referral` BOOLEAN NULL,
  `referral_urgency` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `finalization_missing_data_reason` TEXT NULL,
  `completed_at` DATETIME(6) NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'Version optimiste, jamais un numéro de pièce',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_consultations_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_consultations_02` (`clinic_id`, `visit_id`),
  UNIQUE KEY `uq_consultations_03` (`clinic_id`, `id`, `patient_id`),
  KEY `ix_consultations_01` (`clinic_id`, `patient_id`, `effective_at`),
  KEY `ix_consultations_02` (`clinic_id`, `visit_id`, `patient_id`),
  KEY `ix_consultations_03` (`clinic_id`, `clinician_id`),
  CONSTRAINT `ck_consultations_01` CHECK (referral IS NULL OR referral = 0 OR referral_urgency IS NOT NULL),
  CONSTRAINT `ck_consultations_02` CHECK (status <> 'COMPLETED' OR (completed_at IS NOT NULL AND current_revision > 0)),
  CONSTRAINT `ck_consultations_03` CHECK (`status` IN ('DRAFT','IN_PROGRESS','COMPLETED')),
  CONSTRAINT `ck_consultations_04` CHECK (`wears_glasses` IN (0,1)),
  CONSTRAINT `ck_consultations_05` CHECK (`previous_correction_available` IN (0,1)),
  CONSTRAINT `ck_consultations_06` CHECK (`referral` IN (0,1)),
  CONSTRAINT `ck_consultations_07` CHECK (`referral_urgency` IN ('NOT_URGENT','RECOMMENDED','RAPID','EMERGENCY')),
  CONSTRAINT `ck_consultations_08` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Examen clinique avec mesures et versions distinctes des ventes';

-- Patients et clinique : Motifs en sélection multiple, Autre expliqué
CREATE TABLE `consultation_complaints` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `consultation_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `term_group` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'COMPLAINT',
  `term_code` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `other_text` TEXT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_consultation_complaints_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_consultation_complaints_02` (`clinic_id`, `consultation_id`, `term_code`),
  KEY `ix_consultation_complaints_01` (`term_group`, `term_code`),
  CONSTRAINT `ck_consultation_complaints_01` CHECK (term_group = 'COMPLAINT'),
  CONSTRAINT `ck_consultation_complaints_02` CHECK (term_code <> 'OTHER' OR other_text IS NOT NULL),
  CONSTRAINT `ck_consultation_complaints_03` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Motifs en sélection multiple, Autre expliqué';

-- Patients et clinique : État des antécédents constaté pour cette consultation
CREATE TABLE `consultation_histories` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `consultation_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `history_group` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `known_none` BOOLEAN NOT NULL DEFAULT 0,
  `comments` TEXT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_consultation_histories_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_consultation_histories_02` (`clinic_id`, `consultation_id`, `history_group`),
  UNIQUE KEY `uq_consultation_histories_03` (`clinic_id`, `id`, `history_group`),
  CONSTRAINT `ck_consultation_histories_01` CHECK (`history_group` IN ('OCULAR_HISTORY','MEDICAL_HISTORY','FAMILY_HISTORY')),
  CONSTRAINT `ck_consultation_histories_02` CHECK (`known_none` IN (0,1)),
  CONSTRAINT `ck_consultation_histories_03` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='État des antécédents constaté pour cette consultation';

-- Patients et clinique : Antécédents positifs normalisés ; exclusivité Aucun connu contrôlée à transaction
CREATE TABLE `consultation_history_terms` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `history_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `term_group` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `term_code` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `other_text` TEXT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_consultation_history_terms_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_consultation_history_terms_02` (`clinic_id`, `history_id`, `term_code`),
  KEY `ix_consultation_history_terms_01` (`clinic_id`, `history_id`, `term_group`),
  KEY `ix_consultation_history_terms_02` (`term_group`, `term_code`),
  CONSTRAINT `ck_consultation_history_terms_01` CHECK (term_code <> 'NONE'),
  CONSTRAINT `ck_consultation_history_terms_02` CHECK (term_code <> 'OTHER' OR other_text IS NOT NULL),
  CONSTRAINT `ck_consultation_history_terms_03` CHECK (`term_group` IN ('OCULAR_HISTORY','MEDICAL_HISTORY','FAMILY_HISTORY')),
  CONSTRAINT `ck_consultation_history_terms_04` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Antécédents positifs normalisés ; exclusivité Aucun connu contrôlée à transaction';

-- Patients et clinique : Amétropies choisies par professionnel, sans inférence médicale
CREATE TABLE `consultation_ametropias` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `consultation_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `term_group` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'AMETROPIA',
  `term_code` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `other_text` TEXT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_consultation_ametropias_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_consultation_ametropias_02` (`clinic_id`, `consultation_id`, `term_code`),
  KEY `ix_consultation_ametropias_01` (`term_group`, `term_code`),
  CONSTRAINT `ck_consultation_ametropias_01` CHECK (term_group = 'AMETROPIA'),
  CONSTRAINT `ck_consultation_ametropias_02` CHECK (term_code <> 'OTHER' OR other_text IS NOT NULL),
  CONSTRAINT `ck_consultation_ametropias_03` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Amétropies choisies par professionnel, sans inférence médicale';

-- Patients et clinique : Motifs d’orientation en sélection multiple
CREATE TABLE `consultation_referral_reasons` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `consultation_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `term_group` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'REFERRAL_REASON',
  `term_code` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `other_text` TEXT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_consultation_referral_reasons_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_consultation_referral_reasons_02` (`clinic_id`, `consultation_id`, `term_code`),
  KEY `ix_consultation_referral_reasons_01` (`term_group`, `term_code`),
  CONSTRAINT `ck_consultation_referral_reasons_01` CHECK (term_group = 'REFERRAL_REASON'),
  CONSTRAINT `ck_consultation_referral_reasons_02` CHECK (term_code <> 'OTHER' OR other_text IS NOT NULL),
  CONSTRAINT `ck_consultation_referral_reasons_03` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Motifs d’orientation en sélection multiple';

-- Patients et clinique : Échelles configurées par cabinet, aucune conversion présumée
CREATE TABLE `visual_acuity_scales` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `code` VARCHAR(32) NOT NULL,
  `label` VARCHAR(180) NOT NULL,
  `description` TEXT NULL,
  `active` BOOLEAN NOT NULL DEFAULT 1,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_visual_acuity_scales_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_visual_acuity_scales_02` (`clinic_id`, `code`),
  CONSTRAINT `ck_visual_acuity_scales_01` CHECK (`active` IN (0,1)),
  CONSTRAINT `ck_visual_acuity_scales_02` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Échelles configurées par cabinet, aucune conversion présumée';

-- Patients et clinique : 12 acuités préliminaires et 3 post-réfraction distinctes
CREATE TABLE `visual_acuities` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `consultation_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `context` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `distance` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `correction` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `eye` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `scale_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `raw_value` VARCHAR(100) NOT NULL,
  `normalized_value` DECIMAL(8,4) NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_visual_acuities_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_visual_acuities_02` (`clinic_id`, `consultation_id`, `context`, `distance`, `correction`, `eye`),
  KEY `ix_visual_acuities_01` (`clinic_id`, `scale_id`),
  CONSTRAINT `ck_visual_acuities_01` CHECK ((context = 'PRELIMINARY' AND distance IN ('FAR','NEAR')) OR (context = 'POST_REFRACTION' AND distance = 'UNSPECIFIED' AND correction = 'WITH')),
  CONSTRAINT `ck_visual_acuities_02` CHECK (`context` IN ('PRELIMINARY','POST_REFRACTION')),
  CONSTRAINT `ck_visual_acuities_03` CHECK (`distance` IN ('FAR','NEAR','UNSPECIFIED')),
  CONSTRAINT `ck_visual_acuities_04` CHECK (`correction` IN ('WITHOUT','WITH')),
  CONSTRAINT `ck_visual_acuities_05` CHECK (`eye` IN ('OD','OG','OU')),
  CONSTRAINT `ck_visual_acuities_06` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='12 acuités préliminaires et 3 post-réfraction distinctes';

-- Patients et clinique : Mesures AUTOREFRACTOR/OBJECTIVE/SUBJECTIVE séparées par œil
CREATE TABLE `refraction_measurements` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `consultation_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `stage` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `eye` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `sphere` DECIMAL(6,2) NULL,
  `cylinder` DECIMAL(6,2) NULL,
  `axis` SMALLINT UNSIGNED NULL,
  `addition` DECIMAL(6,2) NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_refraction_measurements_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_refraction_measurements_02` (`clinic_id`, `consultation_id`, `stage`, `eye`),
  CONSTRAINT `ck_refraction_measurements_01` CHECK (axis IS NULL OR axis <= 180),
  CONSTRAINT `ck_refraction_measurements_02` CHECK (stage = 'SUBJECTIVE' OR addition IS NULL),
  CONSTRAINT `ck_refraction_measurements_03` CHECK (`stage` IN ('AUTOREFRACTOR','OBJECTIVE','SUBJECTIVE')),
  CONSTRAINT `ck_refraction_measurements_04` CHECK (`eye` IN ('OD','OG')),
  CONSTRAINT `ck_refraction_measurements_05` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Mesures AUTOREFRACTOR/OBJECTIVE/SUBJECTIVE séparées par œil';

-- Patients et clinique : Écart pupillaire objectif total/monoculaire en mm
CREATE TABLE `autorefractor_centering` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `consultation_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `pd_total` DECIMAL(6,2) NULL,
  `pd_od` DECIMAL(6,2) NULL,
  `pd_og` DECIMAL(6,2) NULL,
  `inconsistency_reason` TEXT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_autorefractor_centering_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_autorefractor_centering_02` (`clinic_id`, `consultation_id`),
  CONSTRAINT `ck_autorefractor_centering_01` CHECK (pd_total IS NULL OR pd_total > 0),
  CONSTRAINT `ck_autorefractor_centering_02` CHECK (pd_od IS NULL OR pd_od > 0),
  CONSTRAINT `ck_autorefractor_centering_03` CHECK (pd_og IS NULL OR pd_og > 0),
  CONSTRAINT `ck_autorefractor_centering_04` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Écart pupillaire objectif total/monoculaire en mm';

-- Patients et clinique : Snapshot complet immuable après finalisation ou correction
CREATE TABLE `clinical_revisions` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `consultation_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `revision_no` INT UNSIGNED NOT NULL,
  `snapshot` JSON NOT NULL COMMENT 'Données figées de la pièce ou révision',
  `reason` TEXT NOT NULL COMMENT 'Motif obligatoire de l’opération',
  `author_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `recorded_at` DATETIME(6) NOT NULL,
  `previous_revision_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `sha256` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_clinical_revisions_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_clinical_revisions_02` (`clinic_id`, `consultation_id`, `revision_no`),
  UNIQUE KEY `uq_clinical_revisions_03` (`clinic_id`, `id`, `consultation_id`),
  KEY `ix_clinical_revisions_01` (`clinic_id`, `previous_revision_id`, `consultation_id`),
  KEY `ix_clinical_revisions_02` (`clinic_id`, `author_id`),
  CONSTRAINT `ck_clinical_revisions_01` CHECK (revision_no > 0),
  CONSTRAINT `ck_clinical_revisions_02` CHECK (id <> '00000000000000000000000000'),
  CONSTRAINT `ck_clinical_revisions_03` CHECK (`snapshot` IS NULL OR JSON_TYPE(`snapshot`) = 'OBJECT')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Snapshot complet immuable après finalisation ou correction';

-- Patients et clinique : Prescription optique décisionnelle, indépendante des mesures
CREATE TABLE `optical_prescriptions` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `patient_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `series_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `origin` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'INTERNAL',
  `external_file_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `external_prescriber` VARCHAR(180) NULL,
  `external_prescribed_on` DATE NULL,
  `consultation_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `version_no` INT UNSIGNED NOT NULL,
  `status` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'DRAFT',
  `usage_group` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'OPTICAL_USAGE',
  `usage_code` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `usage_other` TEXT NULL,
  `lens_type_group` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'LENS_TYPE',
  `lens_type_code` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `lens_type_other` TEXT NULL,
  `lens_index` DECIMAL(4,2) NULL,
  `lens_index_other` TEXT NULL,
  `pd_total` DECIMAL(6,2) NULL,
  `pd_od` DECIMAL(6,2) NULL,
  `pd_og` DECIMAL(6,2) NULL,
  `pd_inconsistency_reason` TEXT NULL,
  `notes` TEXT NULL,
  `validated_at` DATETIME(6) NULL,
  `validated_by` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `supersedes_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_optical_prescriptions_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_optical_prescriptions_02` (`clinic_id`, `consultation_id`, `version_no`),
  UNIQUE KEY `uq_optical_prescriptions_03` (`clinic_id`, `id`, `consultation_id`),
  UNIQUE KEY `uq_optical_prescriptions_04` (`clinic_id`, `series_id`, `version_no`),
  UNIQUE KEY `uq_optical_prescriptions_05` (`clinic_id`, `id`, `patient_id`, `series_id`),
  UNIQUE KEY `uq_optical_prescriptions_06` (`clinic_id`, `id`, `patient_id`),
  KEY `ix_optical_prescriptions_01` (`usage_group`, `usage_code`),
  KEY `ix_optical_prescriptions_02` (`lens_type_group`, `lens_type_code`),
  KEY `ix_optical_prescriptions_03` (`clinic_id`, `supersedes_id`, `consultation_id`),
  KEY `ix_optical_prescriptions_04` (`clinic_id`, `consultation_id`, `patient_id`),
  KEY `ix_optical_prescriptions_05` (`clinic_id`, `supersedes_id`, `patient_id`, `series_id`),
  KEY `ix_optical_prescriptions_06` (`clinic_id`, `patient_id`),
  KEY `ix_optical_prescriptions_07` (`clinic_id`, `external_file_id`),
  KEY `ix_optical_prescriptions_08` (`clinic_id`, `validated_by`),
  CONSTRAINT `ck_optical_prescriptions_01` CHECK (usage_group = 'OPTICAL_USAGE'),
  CONSTRAINT `ck_optical_prescriptions_02` CHECK (lens_type_group = 'LENS_TYPE'),
  CONSTRAINT `ck_optical_prescriptions_03` CHECK (version_no > 0),
  CONSTRAINT `ck_optical_prescriptions_04` CHECK (status <> 'VALIDATED' OR (validated_at IS NOT NULL AND validated_by IS NOT NULL)),
  CONSTRAINT `ck_optical_prescriptions_05` CHECK (pd_total IS NULL OR pd_total > 0),
  CONSTRAINT `ck_optical_prescriptions_06` CHECK (pd_od IS NULL OR pd_od > 0),
  CONSTRAINT `ck_optical_prescriptions_07` CHECK (pd_og IS NULL OR pd_og > 0),
  CONSTRAINT `ck_optical_prescriptions_08` CHECK ((origin = 'INTERNAL' AND consultation_id IS NOT NULL) OR (origin = 'EXTERNAL' AND consultation_id IS NULL AND external_prescriber IS NOT NULL)),
  CONSTRAINT `ck_optical_prescriptions_09` CHECK (`origin` IN ('INTERNAL','EXTERNAL')),
  CONSTRAINT `ck_optical_prescriptions_10` CHECK (`status` IN ('DRAFT','VALIDATED')),
  CONSTRAINT `ck_optical_prescriptions_11` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Prescription optique décisionnelle, indépendante des mesures';

-- Patients et clinique : OD et OG, valeurs explicites et hauteur de montage
CREATE TABLE `optical_prescription_eyes` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `prescription_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `eye` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `no_correction` BOOLEAN NOT NULL DEFAULT 0,
  `sphere` DECIMAL(6,2) NULL,
  `cylinder` DECIMAL(6,2) NULL,
  `axis` SMALLINT UNSIGNED NULL,
  `addition` DECIMAL(6,2) NULL,
  `fitting_height` DECIMAL(6,2) NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_optical_prescription_eyes_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_optical_prescription_eyes_02` (`clinic_id`, `prescription_id`, `eye`),
  CONSTRAINT `ck_optical_prescription_eyes_01` CHECK (axis IS NULL OR axis <= 180),
  CONSTRAINT `ck_optical_prescription_eyes_02` CHECK (fitting_height IS NULL OR fitting_height > 0),
  CONSTRAINT `ck_optical_prescription_eyes_03` CHECK (no_correction = 0 OR (sphere IS NULL AND cylinder IS NULL AND axis IS NULL AND addition IS NULL)),
  CONSTRAINT `ck_optical_prescription_eyes_04` CHECK (`eye` IN ('OD','OG')),
  CONSTRAINT `ck_optical_prescription_eyes_05` CHECK (`no_correction` IN (0,1)),
  CONSTRAINT `ck_optical_prescription_eyes_06` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='OD et OG, valeurs explicites et hauteur de montage';

-- Patients et clinique : Traitements DP plus HMC de PC
CREATE TABLE `optical_prescription_treatments` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `prescription_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `term_group` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'LENS_TREATMENT',
  `term_code` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `other_text` TEXT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_optical_prescription_treatments_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_optical_prescription_treatments_02` (`clinic_id`, `prescription_id`, `term_code`),
  KEY `ix_optical_prescription_treatments_01` (`term_group`, `term_code`),
  CONSTRAINT `ck_optical_prescription_treatments_01` CHECK (term_group = 'LENS_TREATMENT'),
  CONSTRAINT `ck_optical_prescription_treatments_02` CHECK (term_code <> 'OTHER' OR other_text IS NOT NULL),
  CONSTRAINT `ck_optical_prescription_treatments_03` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Traitements DP plus HMC de PC';

-- Patients et clinique : Médicaments prescrits sans création automatique de vente
CREATE TABLE `medication_orders` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `consultation_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `position` SMALLINT UNSIGNED NOT NULL,
  `catalog_item_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `name` VARCHAR(180) NOT NULL,
  `form` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `form_other` VARCHAR(100) NULL,
  `strength` VARCHAR(100) NULL,
  `dosage` TEXT NULL,
  `frequency` VARCHAR(180) NULL,
  `duration_text` VARCHAR(180) NULL,
  `duration_value` INT UNSIGNED NULL,
  `duration_unit` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `instructions` TEXT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_medication_orders_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_medication_orders_02` (`clinic_id`, `consultation_id`, `position`),
  KEY `ix_medication_orders_01` (`clinic_id`, `catalog_item_id`),
  CONSTRAINT `ck_medication_orders_01` CHECK (position > 0),
  CONSTRAINT `ck_medication_orders_02` CHECK ((duration_value IS NULL) = (duration_unit IS NULL)),
  CONSTRAINT `ck_medication_orders_03` CHECK (duration_value IS NULL OR duration_value > 0),
  CONSTRAINT `ck_medication_orders_04` CHECK (`form` IN ('DROPS','OINTMENT','TABLET','OTHER')),
  CONSTRAINT `ck_medication_orders_05` CHECK (`duration_unit` IN ('DAY','WEEK','MONTH')),
  CONSTRAINT `ck_medication_orders_06` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Médicaments prescrits sans création automatique de vente';

-- Agenda et suivi : Contrôle recommandé, pas une réservation implicite
CREATE TABLE `follow_up_plans` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `consultation_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `patient_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `reason` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `anchor_kind` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `anchor_date` DATE NOT NULL,
  `interval_value` INT UNSIGNED NULL,
  `interval_unit` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `recommended_date` DATE NOT NULL,
  `date_origin` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `manual_reason` TEXT NULL,
  `reminder_enabled` BOOLEAN NOT NULL DEFAULT 1,
  `preferred_channel` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `advance_value` INT UNSIGNED NULL,
  `advance_unit` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `notes` TEXT NULL,
  `status` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'Version optimiste, jamais un numéro de pièce',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_follow_up_plans_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_follow_up_plans_02` (`clinic_id`, `id`, `patient_id`),
  KEY `ix_follow_up_plans_01` (`clinic_id`, `consultation_id`, `patient_id`),
  KEY `ix_follow_up_plans_02` (`clinic_id`, `patient_id`),
  CONSTRAINT `ck_follow_up_plans_01` CHECK ((interval_value IS NULL) = (interval_unit IS NULL)),
  CONSTRAINT `ck_follow_up_plans_02` CHECK ((advance_value IS NULL) = (advance_unit IS NULL)),
  CONSTRAINT `ck_follow_up_plans_03` CHECK (date_origin <> 'MANUAL' OR manual_reason IS NOT NULL),
  CONSTRAINT `ck_follow_up_plans_04` CHECK (interval_value IS NULL OR interval_value > 0),
  CONSTRAINT `ck_follow_up_plans_05` CHECK (`reason` IN ('ROUTINE','DROPS','OTHER')),
  CONSTRAINT `ck_follow_up_plans_06` CHECK (`anchor_kind` IN ('CONSULTATION','TREATMENT_START','TREATMENT_END','MANUAL')),
  CONSTRAINT `ck_follow_up_plans_07` CHECK (`interval_unit` IN ('DAY','MONTH','YEAR')),
  CONSTRAINT `ck_follow_up_plans_08` CHECK (`date_origin` IN ('CALCULATED','MANUAL')),
  CONSTRAINT `ck_follow_up_plans_09` CHECK (`reminder_enabled` IN (0,1)),
  CONSTRAINT `ck_follow_up_plans_10` CHECK (`preferred_channel` IN ('INTERNAL','SMS','WHATSAPP','CALL')),
  CONSTRAINT `ck_follow_up_plans_11` CHECK (`advance_unit` IN ('DAY','MONTH')),
  CONSTRAINT `ck_follow_up_plans_12` CHECK (`status` IN ('ACTIVE','SCHEDULED','CLOSED','CANCELLED')),
  CONSTRAINT `ck_follow_up_plans_13` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Contrôle recommandé, pas une réservation implicite';

-- Catalogue et facturation : Régime validé par gérante/comptable, aucun taux fiscal seedé
CREATE TABLE `tax_rules` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `code` VARCHAR(40) NOT NULL,
  `label` VARCHAR(180) NOT NULL,
  `rate_percent` DECIMAL(7,4) NULL,
  `active` BOOLEAN NOT NULL DEFAULT 0,
  `validated_by` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `validated_at` DATETIME(6) NULL,
  `legal_note` TEXT NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'Version optimiste, jamais un numéro de pièce',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tax_rules_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_tax_rules_02` (`clinic_id`, `code`),
  KEY `ix_tax_rules_01` (`clinic_id`, `validated_by`),
  CONSTRAINT `ck_tax_rules_01` CHECK (rate_percent IS NULL OR rate_percent BETWEEN 0 AND 100),
  CONSTRAINT `ck_tax_rules_02` CHECK (active = 0 OR (rate_percent IS NOT NULL AND validated_by IS NOT NULL AND validated_at IS NOT NULL)),
  CONSTRAINT `ck_tax_rules_03` CHECK (`active` IN (0,1)),
  CONSTRAINT `ck_tax_rules_04` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Régime validé par gérante/comptable, aucun taux fiscal seedé';

-- Catalogue et facturation : Catalogue commun prestations, montures, verres, lentilles, collyres et soins
CREATE TABLE `catalog_items` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `reference` VARCHAR(64) NOT NULL,
  `category_code` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `name` VARCHAR(180) NOT NULL,
  `brand` VARCHAR(120) NULL,
  `model` VARCHAR(120) NULL,
  `unit_code` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `quantity_integer_only` BOOLEAN NOT NULL DEFAULT 1,
  `sale_price` BIGINT NOT NULL,
  `purchase_cost` BIGINT NULL,
  `tax_rule_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `stock_mode` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `requires_expiry` BOOLEAN NOT NULL DEFAULT 0,
  `low_stock_threshold` DECIMAL(12,3) NULL,
  `expiry_alert_days` SMALLINT UNSIGNED NULL,
  `active` BOOLEAN NOT NULL DEFAULT 1,
  `public_visibility` BOOLEAN NOT NULL DEFAULT 0,
  `version` INT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'Version optimiste, jamais un numéro de pièce',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_catalog_items_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_catalog_items_02` (`clinic_id`, `reference`),
  KEY `ix_catalog_items_01` (`clinic_id`, `name`),
  KEY `ix_catalog_items_02` (`clinic_id`, `category_code`, `active`),
  KEY `ix_catalog_items_03` (`category_code`),
  KEY `ix_catalog_items_04` (`unit_code`),
  KEY `ix_catalog_items_05` (`clinic_id`, `tax_rule_id`),
  CONSTRAINT `ck_catalog_items_01` CHECK (category_code <> 'COLLYRE' OR requires_expiry = 1),
  CONSTRAINT `ck_catalog_items_02` CHECK (stock_mode = 'STOCKED' OR requires_expiry = 0),
  CONSTRAINT `ck_catalog_items_03` CHECK (`quantity_integer_only` IN (0,1)),
  CONSTRAINT `ck_catalog_items_04` CHECK (`sale_price` BETWEEN 0 AND 1000000000000),
  CONSTRAINT `ck_catalog_items_05` CHECK (`purchase_cost` BETWEEN 0 AND 1000000000000),
  CONSTRAINT `ck_catalog_items_06` CHECK (`stock_mode` IN ('NONE','STOCKED','MADE_TO_ORDER')),
  CONSTRAINT `ck_catalog_items_07` CHECK (`requires_expiry` IN (0,1)),
  CONSTRAINT `ck_catalog_items_08` CHECK (`active` IN (0,1)),
  CONSTRAINT `ck_catalog_items_09` CHECK (`public_visibility` IN (0,1)),
  CONSTRAINT `ck_catalog_items_10` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Catalogue commun prestations, montures, verres, lentilles, collyres et soins';

-- Catalogue et facturation : Devis cité PC, option de fonctionnement sans dette ni encaissement
CREATE TABLE `quotes` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `patient_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `prospect_contact_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `number` VARCHAR(64) NULL,
  `status` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `valid_until` DATE NULL,
  `total_gross` BIGINT NOT NULL DEFAULT 0,
  `recipient_snapshot` JSON NULL,
  `created_by` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `issued_at` DATETIME(6) NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'Version optimiste, jamais un numéro de pièce',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_quotes_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_quotes_02` (`clinic_id`, `number`),
  KEY `ix_quotes_01` (`clinic_id`, `patient_id`),
  KEY `ix_quotes_02` (`clinic_id`, `prospect_contact_id`),
  KEY `ix_quotes_03` (`clinic_id`, `created_by`),
  CONSTRAINT `ck_quotes_01` CHECK ((patient_id IS NOT NULL) + (prospect_contact_id IS NOT NULL) = 1),
  CONSTRAINT `ck_quotes_02` CHECK (`status` IN ('DRAFT','ISSUED','ACCEPTED','DECLINED','EXPIRED','CONVERTED')),
  CONSTRAINT `ck_quotes_03` CHECK (`total_gross` BETWEEN 0 AND 1000000000000),
  CONSTRAINT `ck_quotes_04` CHECK (id <> '00000000000000000000000000'),
  CONSTRAINT `ck_quotes_05` CHECK (`recipient_snapshot` IS NULL OR JSON_TYPE(`recipient_snapshot`) = 'OBJECT')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Devis cité PC, option de fonctionnement sans dette ni encaissement';

-- Catalogue et facturation : Lignes de devis, prix figés dans la version remise
CREATE TABLE `quote_lines` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `quote_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `position` SMALLINT UNSIGNED NOT NULL,
  `catalog_item_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `description_snapshot` VARCHAR(500) NOT NULL,
  `unit_code` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `quantity` DECIMAL(12,3) NOT NULL,
  `unit_price_gross` BIGINT NOT NULL,
  `discount_gross` BIGINT NOT NULL DEFAULT 0,
  `line_total_gross` BIGINT NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_quote_lines_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_quote_lines_02` (`clinic_id`, `quote_id`, `position`),
  KEY `ix_quote_lines_01` (`unit_code`),
  KEY `ix_quote_lines_02` (`clinic_id`, `catalog_item_id`),
  CONSTRAINT `ck_quote_lines_01` CHECK (position > 0),
  CONSTRAINT `ck_quote_lines_02` CHECK (quantity > 0),
  CONSTRAINT `ck_quote_lines_03` CHECK (discount_gross <= ROUND(quantity * unit_price_gross,0)),
  CONSTRAINT `ck_quote_lines_04` CHECK (line_total_gross = ROUND(quantity * unit_price_gross,0) - discount_gross),
  CONSTRAINT `ck_quote_lines_05` CHECK (`unit_price_gross` BETWEEN 0 AND 1000000000000),
  CONSTRAINT `ck_quote_lines_06` CHECK (`discount_gross` BETWEEN 0 AND 1000000000000),
  CONSTRAINT `ck_quote_lines_07` CHECK (`line_total_gross` BETWEEN 0 AND 1000000000000),
  CONSTRAINT `ck_quote_lines_08` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Lignes de devis, prix figés dans la version remise';

-- Documents et exploitation : High-water central incluant toutes plages hors-ligne réservées
CREATE TABLE `document_sequences` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `document_type` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `document_year` SMALLINT UNSIGNED NOT NULL,
  `last_value` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `version` INT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'Version optimiste, jamais un numéro de pièce',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_document_sequences_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_document_sequences_02` (`clinic_id`, `document_type`, `document_year`),
  CONSTRAINT `ck_document_sequences_01` CHECK (document_year BETWEEN 2000 AND 9999),
  CONSTRAINT `ck_document_sequences_02` CHECK (`document_type` IN ('PATIENT','INVOICE','RECEIPT','CREDIT_NOTE','REFUND','LEGACY_BALANCE','QUOTE','WORKSHOP')),
  CONSTRAINT `ck_document_sequences_03` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='High-water central incluant toutes plages hors-ligne réservées';

-- Documents et exploitation : Registre immuable de consommation de numéro, cible vérifiée par commande
CREATE TABLE `document_number_usages` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `allocation_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `document_type` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `document_year` SMALLINT UNSIGNED NOT NULL,
  `number_value` BIGINT UNSIGNED NOT NULL,
  `rendered_number` VARCHAR(64) NOT NULL,
  `entity_type` VARCHAR(64) NOT NULL,
  `entity_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `source_device_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `actor_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `consumed_at` DATETIME(6) NOT NULL,
  `status` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_document_number_usages_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_document_number_usages_02` (`clinic_id`, `document_type`, `document_year`, `number_value`),
  UNIQUE KEY `uq_document_number_usages_03` (`clinic_id`, `document_type`, `rendered_number`),
  UNIQUE KEY `uq_document_number_usages_04` (`clinic_id`, `id`, `document_type`),
  KEY `ix_document_number_usages_01` (`clinic_id`, `allocation_id`),
  KEY `ix_document_number_usages_02` (`clinic_id`, `source_device_id`),
  KEY `ix_document_number_usages_03` (`clinic_id`, `actor_id`),
  CONSTRAINT `ck_document_number_usages_01` CHECK (number_value > 0),
  CONSTRAINT `ck_document_number_usages_02` CHECK (document_year BETWEEN 2000 AND 9999),
  CONSTRAINT `ck_document_number_usages_03` CHECK (`document_type` IN ('PATIENT','INVOICE','RECEIPT','CREDIT_NOTE','REFUND','LEGACY_BALANCE','QUOTE','WORKSHOP')),
  CONSTRAINT `ck_document_number_usages_04` CHECK (`status` IN ('USED','VOID','UNUSED')),
  CONSTRAINT `ck_document_number_usages_05` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Registre immuable de consommation de numéro, cible vérifiée par commande';

-- Caisse et rapprochement : Caisse physique distincte du navigateur ou de la caissière
CREATE TABLE `cash_registers` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `code` VARCHAR(40) NOT NULL,
  `name` VARCHAR(180) NOT NULL,
  `active` BOOLEAN NOT NULL DEFAULT 1,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cash_registers_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_cash_registers_02` (`clinic_id`, `code`),
  CONSTRAINT `ck_cash_registers_01` CHECK (`active` IN (0,1)),
  CONSTRAINT `ck_cash_registers_02` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Caisse physique distincte du navigateur ou de la caissière';

-- Caisse et rapprochement : Session comptée, ouverture et clôture avec écart motivé
CREATE TABLE `cash_sessions` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `cash_register_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `cashier_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `opened_at` DATETIME(6) NOT NULL,
  `opening_amount` BIGINT NOT NULL,
  `closed_at` DATETIME(6) NULL,
  `counted_amount` BIGINT NULL,
  `expected_amount` BIGINT NULL,
  `variance` BIGINT NULL,
  `variance_reason` TEXT NULL,
  `closed_by` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `active_register_key` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin GENERATED ALWAYS AS (CASE WHEN closed_at IS NULL THEN cash_register_id ELSE NULL END) STORED,
  `active_cashier_key` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin GENERATED ALWAYS AS (CASE WHEN closed_at IS NULL THEN cashier_id ELSE NULL END) STORED,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cash_sessions_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_cash_sessions_02` (`clinic_id`, `active_register_key`),
  UNIQUE KEY `uq_cash_sessions_03` (`clinic_id`, `active_cashier_key`),
  KEY `ix_cash_sessions_01` (`clinic_id`, `cash_register_id`),
  KEY `ix_cash_sessions_02` (`clinic_id`, `cashier_id`),
  KEY `ix_cash_sessions_03` (`clinic_id`, `closed_by`),
  CONSTRAINT `ck_cash_sessions_01` CHECK (closed_at IS NULL OR closed_at >= opened_at),
  CONSTRAINT `ck_cash_sessions_02` CHECK (closed_at IS NULL OR (counted_amount IS NOT NULL AND expected_amount IS NOT NULL AND variance IS NOT NULL AND closed_by IS NOT NULL)),
  CONSTRAINT `ck_cash_sessions_03` CHECK (variance IS NULL OR variance = counted_amount - expected_amount),
  CONSTRAINT `ck_cash_sessions_04` CHECK (variance IS NULL OR variance = 0 OR variance_reason IS NOT NULL),
  CONSTRAINT `ck_cash_sessions_05` CHECK (`opening_amount` BETWEEN 0 AND 1000000000000),
  CONSTRAINT `ck_cash_sessions_06` CHECK (`counted_amount` BETWEEN 0 AND 1000000000000),
  CONSTRAINT `ck_cash_sessions_07` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Session comptée, ouverture et clôture avec écart motivé';

-- Caisse et rapprochement : Catégories de dépenses validées, pas un plan comptable réglementaire
CREATE TABLE `expense_categories` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `code` VARCHAR(40) NOT NULL,
  `name` VARCHAR(180) NOT NULL,
  `active` BOOLEAN NOT NULL DEFAULT 1,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_expense_categories_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_expense_categories_02` (`clinic_id`, `code`),
  CONSTRAINT `ck_expense_categories_01` CHECK (`active` IN (0,1)),
  CONSTRAINT `ck_expense_categories_02` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Catégories de dépenses validées, pas un plan comptable réglementaire';

-- Catalogue et facturation : Facture ou créance restante papier, jamais solde éditable
CREATE TABLE `invoices` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `patient_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `visit_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `quote_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `number` VARCHAR(64) NULL,
  `issued_at` DATETIME(6) NULL,
  `issued_by` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `number_usage_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `status` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'DRAFT',
  `due_date` DATE NULL,
  `currency` CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'XAF',
  `total_gross` BIGINT NOT NULL DEFAULT 0,
  `patient_snapshot` JSON NULL,
  `clinic_snapshot` JSON NULL,
  `tax_snapshot` JSON NULL,
  `origin` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'NATIVE',
  `legacy_reference` VARCHAR(100) NULL,
  `legacy_opening_balance` BIGINT NULL,
  `source_invoice_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `created_by` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `source_device_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'Version optimiste, jamais un numéro de pièce',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_invoices_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_invoices_02` (`clinic_id`, `number`),
  UNIQUE KEY `uq_invoices_03` (`clinic_id`, `number_usage_id`),
  UNIQUE KEY `uq_invoices_04` (`clinic_id`, `id`, `patient_id`),
  UNIQUE KEY `uq_invoices_05` (`clinic_id`, `id`, `visit_id`, `patient_id`),
  KEY `ix_invoices_01` (`clinic_id`, `patient_id`, `issued_at`),
  KEY `ix_invoices_02` (`clinic_id`, `status`, `issued_at`),
  KEY `ix_invoices_03` (`clinic_id`, `visit_id`, `patient_id`),
  KEY `ix_invoices_04` (`clinic_id`, `quote_id`),
  KEY `ix_invoices_05` (`clinic_id`, `issued_by`),
  KEY `ix_invoices_06` (`clinic_id`, `source_invoice_id`),
  KEY `ix_invoices_07` (`clinic_id`, `created_by`),
  KEY `ix_invoices_08` (`clinic_id`, `source_device_id`),
  CONSTRAINT `ck_invoices_01` CHECK (currency = 'XAF'),
  CONSTRAINT `ck_invoices_02` CHECK (status <> 'ISSUED' OR (number IS NOT NULL AND number_usage_id IS NOT NULL AND issued_at IS NOT NULL AND issued_by IS NOT NULL AND patient_snapshot IS NOT NULL AND clinic_snapshot IS NOT NULL AND tax_snapshot IS NOT NULL)),
  CONSTRAINT `ck_invoices_03` CHECK (origin <> 'LEGACY_BALANCE' OR (legacy_reference IS NOT NULL AND legacy_opening_balance IS NOT NULL AND legacy_opening_balance = total_gross)),
  CONSTRAINT `ck_invoices_04` CHECK (`status` IN ('DRAFT','ISSUED','ABANDONED')),
  CONSTRAINT `ck_invoices_05` CHECK (`total_gross` BETWEEN 0 AND 1000000000000),
  CONSTRAINT `ck_invoices_06` CHECK (`origin` IN ('NATIVE','LEGACY_BALANCE')),
  CONSTRAINT `ck_invoices_07` CHECK (`legacy_opening_balance` BETWEEN 0 AND 1000000000000),
  CONSTRAINT `ck_invoices_08` CHECK (id <> '00000000000000000000000000'),
  CONSTRAINT `ck_invoices_09` CHECK (`patient_snapshot` IS NULL OR JSON_TYPE(`patient_snapshot`) = 'OBJECT'),
  CONSTRAINT `ck_invoices_10` CHECK (`clinic_snapshot` IS NULL OR JSON_TYPE(`clinic_snapshot`) = 'OBJECT'),
  CONSTRAINT `ck_invoices_11` CHECK (`tax_snapshot` IS NULL OR JSON_TYPE(`tax_snapshot`) = 'OBJECT')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Facture ou créance restante papier, jamais solde éditable';

-- Catalogue et facturation : Lignes exactes, données de catalogue conservées à émission
CREATE TABLE `invoice_lines` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `patient_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `invoice_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `position` SMALLINT UNSIGNED NOT NULL,
  `catalog_item_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `reference_snapshot` VARCHAR(64) NULL,
  `description_snapshot` VARCHAR(500) NOT NULL,
  `category_snapshot` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `unit_snapshot` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `quantity` DECIMAL(12,3) NOT NULL,
  `unit_price_gross` BIGINT NOT NULL,
  `discount_gross` BIGINT NOT NULL DEFAULT 0,
  `line_total_gross` BIGINT NOT NULL,
  `tax_code_snapshot` VARCHAR(40) NOT NULL,
  `tax_rate_snapshot` DECIMAL(7,4) NULL,
  `tax_amount` BIGINT NULL,
  `prescription_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_invoice_lines_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_invoice_lines_02` (`clinic_id`, `invoice_id`, `position`),
  UNIQUE KEY `uq_invoice_lines_03` (`clinic_id`, `id`, `invoice_id`),
  UNIQUE KEY `uq_invoice_lines_04` (`clinic_id`, `id`, `catalog_item_id`),
  UNIQUE KEY `uq_invoice_lines_05` (`clinic_id`, `id`, `patient_id`),
  KEY `ix_invoice_lines_01` (`clinic_id`, `invoice_id`, `patient_id`),
  KEY `ix_invoice_lines_02` (`clinic_id`, `prescription_id`, `patient_id`),
  KEY `ix_invoice_lines_03` (`clinic_id`, `patient_id`),
  KEY `ix_invoice_lines_04` (`clinic_id`, `catalog_item_id`),
  CONSTRAINT `ck_invoice_lines_01` CHECK (position > 0),
  CONSTRAINT `ck_invoice_lines_02` CHECK (quantity > 0),
  CONSTRAINT `ck_invoice_lines_03` CHECK (discount_gross <= ROUND(quantity * unit_price_gross,0)),
  CONSTRAINT `ck_invoice_lines_04` CHECK (line_total_gross = ROUND(quantity * unit_price_gross,0) - discount_gross),
  CONSTRAINT `ck_invoice_lines_05` CHECK (tax_rate_snapshot IS NULL OR tax_rate_snapshot BETWEEN 0 AND 100),
  CONSTRAINT `ck_invoice_lines_06` CHECK (tax_amount IS NULL OR tax_amount <= line_total_gross),
  CONSTRAINT `ck_invoice_lines_07` CHECK (`unit_price_gross` BETWEEN 0 AND 1000000000000),
  CONSTRAINT `ck_invoice_lines_08` CHECK (`discount_gross` BETWEEN 0 AND 1000000000000),
  CONSTRAINT `ck_invoice_lines_09` CHECK (`line_total_gross` BETWEEN 0 AND 1000000000000),
  CONSTRAINT `ck_invoice_lines_10` CHECK (`tax_amount` BETWEEN 0 AND 1000000000000),
  CONSTRAINT `ck_invoice_lines_11` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Lignes exactes, données de catalogue conservées à émission';

-- Catalogue et facturation : Un encaissement, confirmation humaine ou attente, jamais taxe/caisse supposée
CREATE TABLE `payments` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `invoice_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `amount` BIGINT NOT NULL,
  `method` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `reference` VARCHAR(180) NULL,
  `effective_at` DATETIME(6) NOT NULL,
  `status` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `confirmed_at` DATETIME(6) NULL,
  `cash_session_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `received_by` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `idempotency_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `source_device_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `sync_command_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_payments_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_payments_02` (`clinic_id`, `idempotency_id`),
  UNIQUE KEY `uq_payments_03` (`clinic_id`, `id`, `invoice_id`),
  KEY `ix_payments_01` (`clinic_id`, `invoice_id`, `status`),
  KEY `ix_payments_02` (`clinic_id`, `effective_at`, `method`),
  KEY `ix_payments_03` (`clinic_id`, `cash_session_id`),
  KEY `ix_payments_04` (`clinic_id`, `received_by`),
  KEY `ix_payments_05` (`clinic_id`, `source_device_id`),
  KEY `ix_payments_06` (`clinic_id`, `sync_command_id`),
  CONSTRAINT `ck_payments_01` CHECK (amount > 0),
  CONSTRAINT `ck_payments_02` CHECK (status <> 'CONFIRMED' OR confirmed_at IS NOT NULL),
  CONSTRAINT `ck_payments_03` CHECK (method <> 'CASH' OR cash_session_id IS NOT NULL),
  CONSTRAINT `ck_payments_04` CHECK (`amount` BETWEEN 0 AND 1000000000000),
  CONSTRAINT `ck_payments_05` CHECK (`method` IN ('CASH','MTN_MOMO','ORANGE_MONEY','BANK_TRANSFER','CHEQUE','OTHER')),
  CONSTRAINT `ck_payments_06` CHECK (`status` IN ('PENDING','CONFIRMED','REJECTED')),
  CONSTRAINT `ck_payments_07` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Un encaissement, confirmation humaine ou attente, jamais taxe/caisse supposée';

-- Catalogue et facturation : Exactement une pièce par encaissement confirmé ; original figé
CREATE TABLE `receipts` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `payment_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `invoice_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `number` VARCHAR(64) NOT NULL,
  `number_usage_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `issued_at` DATETIME(6) NOT NULL,
  `issued_by` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `snapshot` JSON NOT NULL COMMENT 'Données figées de la pièce ou révision',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_receipts_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_receipts_02` (`clinic_id`, `payment_id`),
  UNIQUE KEY `uq_receipts_03` (`clinic_id`, `number`),
  UNIQUE KEY `uq_receipts_04` (`clinic_id`, `number_usage_id`),
  KEY `ix_receipts_01` (`clinic_id`, `payment_id`, `invoice_id`),
  KEY `ix_receipts_02` (`clinic_id`, `invoice_id`),
  KEY `ix_receipts_03` (`clinic_id`, `issued_by`),
  CONSTRAINT `ck_receipts_01` CHECK (id <> '00000000000000000000000000'),
  CONSTRAINT `ck_receipts_02` CHECK (`snapshot` IS NULL OR JSON_TYPE(`snapshot`) = 'OBJECT')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Exactement une pièce par encaissement confirmé ; original figé';

-- Catalogue et facturation : Contre-écriture d’un paiement enregistré à tort, pas remboursement cash
CREATE TABLE `payment_reversals` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `payment_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `amount` BIGINT NOT NULL,
  `reason` TEXT NOT NULL COMMENT 'Motif obligatoire de l’opération',
  `approval_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `recorded_at` DATETIME(6) NOT NULL,
  `created_by` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `idempotency_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_payment_reversals_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_payment_reversals_02` (`clinic_id`, `idempotency_id`),
  KEY `ix_payment_reversals_01` (`clinic_id`, `payment_id`),
  KEY `ix_payment_reversals_02` (`clinic_id`, `approval_id`),
  KEY `ix_payment_reversals_03` (`clinic_id`, `created_by`),
  CONSTRAINT `ck_payment_reversals_01` CHECK (amount > 0),
  CONSTRAINT `ck_payment_reversals_02` CHECK (`amount` BETWEEN 0 AND 1000000000000),
  CONSTRAINT `ck_payment_reversals_03` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Contre-écriture d’un paiement enregistré à tort, pas remboursement cash';

-- Catalogue et facturation : Avoir corrige créance, jamais automatiquement un retour physique
CREATE TABLE `credit_notes` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `invoice_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `number` VARCHAR(64) NULL,
  `issued_at` DATETIME(6) NULL,
  `issued_by` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `number_usage_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `status` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'DRAFT',
  `amount_gross` BIGINT NOT NULL,
  `reason` TEXT NOT NULL COMMENT 'Motif obligatoire de l’opération',
  `approval_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `snapshot` JSON NULL,
  `idempotency_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_credit_notes_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_credit_notes_02` (`clinic_id`, `number`),
  UNIQUE KEY `uq_credit_notes_03` (`clinic_id`, `number_usage_id`),
  UNIQUE KEY `uq_credit_notes_04` (`clinic_id`, `idempotency_id`),
  UNIQUE KEY `uq_credit_notes_05` (`clinic_id`, `id`, `invoice_id`),
  KEY `ix_credit_notes_01` (`clinic_id`, `invoice_id`),
  KEY `ix_credit_notes_02` (`clinic_id`, `issued_by`),
  KEY `ix_credit_notes_03` (`clinic_id`, `approval_id`),
  CONSTRAINT `ck_credit_notes_01` CHECK (amount_gross > 0),
  CONSTRAINT `ck_credit_notes_02` CHECK (status <> 'ISSUED' OR (number IS NOT NULL AND number_usage_id IS NOT NULL AND issued_at IS NOT NULL AND issued_by IS NOT NULL AND snapshot IS NOT NULL)),
  CONSTRAINT `ck_credit_notes_03` CHECK (`status` IN ('DRAFT','ISSUED','ABANDONED')),
  CONSTRAINT `ck_credit_notes_04` CHECK (`amount_gross` BETWEEN 0 AND 1000000000000),
  CONSTRAINT `ck_credit_notes_05` CHECK (id <> '00000000000000000000000000'),
  CONSTRAINT `ck_credit_notes_06` CHECK (`snapshot` IS NULL OR JSON_TYPE(`snapshot`) = 'OBJECT')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Avoir corrige créance, jamais automatiquement un retour physique';

-- Catalogue et facturation : Correction plafonnée aux lignes d’origine par commande transactionnelle
CREATE TABLE `credit_note_lines` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `credit_note_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `invoice_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `invoice_line_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `quantity` DECIMAL(12,3) NULL,
  `amount_gross` BIGINT NOT NULL,
  `tax_amount` BIGINT NULL,
  `reason` TEXT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_credit_note_lines_01` (`clinic_id`, `id`),
  KEY `ix_credit_note_lines_01` (`clinic_id`, `credit_note_id`, `invoice_id`),
  KEY `ix_credit_note_lines_02` (`clinic_id`, `invoice_line_id`, `invoice_id`),
  KEY `ix_credit_note_lines_03` (`clinic_id`, `invoice_id`),
  CONSTRAINT `ck_credit_note_lines_01` CHECK (quantity IS NULL OR quantity > 0),
  CONSTRAINT `ck_credit_note_lines_02` CHECK (amount_gross > 0),
  CONSTRAINT `ck_credit_note_lines_03` CHECK (tax_amount IS NULL OR tax_amount <= amount_gross),
  CONSTRAINT `ck_credit_note_lines_04` CHECK (`amount_gross` BETWEEN 0 AND 1000000000000),
  CONSTRAINT `ck_credit_note_lines_05` CHECK (`tax_amount` BETWEEN 0 AND 1000000000000),
  CONSTRAINT `ck_credit_note_lines_06` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Correction plafonnée aux lignes d’origine par commande transactionnelle';

-- Catalogue et facturation : Remboursement réel autorisé, indépendant d’une contre-écriture
CREATE TABLE `refunds` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `invoice_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `credit_note_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `amount` BIGINT NOT NULL,
  `method` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `reference` VARCHAR(180) NULL,
  `approval_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `number` VARCHAR(64) NOT NULL,
  `number_usage_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `effective_at` DATETIME(6) NOT NULL,
  `cash_session_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `idempotency_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_by` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `snapshot` JSON NOT NULL COMMENT 'Données figées de la pièce ou révision',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_refunds_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_refunds_02` (`clinic_id`, `number`),
  UNIQUE KEY `uq_refunds_03` (`clinic_id`, `number_usage_id`),
  UNIQUE KEY `uq_refunds_04` (`clinic_id`, `idempotency_id`),
  KEY `ix_refunds_01` (`clinic_id`, `credit_note_id`, `invoice_id`),
  KEY `ix_refunds_02` (`clinic_id`, `invoice_id`),
  KEY `ix_refunds_03` (`clinic_id`, `approval_id`),
  KEY `ix_refunds_04` (`clinic_id`, `cash_session_id`),
  KEY `ix_refunds_05` (`clinic_id`, `created_by`),
  CONSTRAINT `ck_refunds_01` CHECK (amount > 0),
  CONSTRAINT `ck_refunds_02` CHECK (method <> 'CASH' OR cash_session_id IS NOT NULL),
  CONSTRAINT `ck_refunds_03` CHECK (`amount` BETWEEN 0 AND 1000000000000),
  CONSTRAINT `ck_refunds_04` CHECK (`method` IN ('CASH','MTN_MOMO','ORANGE_MONEY','BANK_TRANSFER','CHEQUE','OTHER')),
  CONSTRAINT `ck_refunds_05` CHECK (id <> '00000000000000000000000000'),
  CONSTRAINT `ck_refunds_06` CHECK (`snapshot` IS NULL OR JSON_TYPE(`snapshot`) = 'OBJECT')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Remboursement réel autorisé, indépendant d’une contre-écriture';

-- Catalogue et facturation : Pièce papier originale et ancien acompte conservés sans CA nouveau
CREATE TABLE `legacy_balance_imports` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `patient_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `invoice_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `paper_reference` VARCHAR(100) NOT NULL,
  `original_total` BIGINT NOT NULL,
  `previously_paid` BIGINT NOT NULL,
  `opening_balance` BIGINT NOT NULL,
  `original_invoice_on` DATE NULL,
  `evidence_file_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `evidence_sha256` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `validated_by` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `validated_at` DATETIME(6) NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_legacy_balance_imports_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_legacy_balance_imports_02` (`clinic_id`, `invoice_id`),
  UNIQUE KEY `uq_legacy_balance_imports_03` (`clinic_id`, `paper_reference`),
  KEY `ix_legacy_balance_imports_01` (`clinic_id`, `invoice_id`, `patient_id`),
  KEY `ix_legacy_balance_imports_02` (`clinic_id`, `patient_id`),
  KEY `ix_legacy_balance_imports_03` (`clinic_id`, `evidence_file_id`),
  KEY `ix_legacy_balance_imports_04` (`clinic_id`, `validated_by`),
  CONSTRAINT `ck_legacy_balance_imports_01` CHECK (original_total - previously_paid = opening_balance),
  CONSTRAINT `ck_legacy_balance_imports_02` CHECK (`original_total` BETWEEN 0 AND 1000000000000),
  CONSTRAINT `ck_legacy_balance_imports_03` CHECK (`previously_paid` BETWEEN 0 AND 1000000000000),
  CONSTRAINT `ck_legacy_balance_imports_04` CHECK (`opening_balance` BETWEEN 0 AND 1000000000000),
  CONSTRAINT `ck_legacy_balance_imports_05` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Pièce papier originale et ancien acompte conservés sans CA nouveau';

-- Caisse et rapprochement : Dépenses et mouvements hors vente (tiroir espèces ou hors tiroir), sans duplication paiements/refunds
CREATE TABLE `cash_movements` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `cash_session_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `kind` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `method` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'CASH',
  `signed_amount` BIGINT NOT NULL,
  `reason` TEXT NULL COMMENT 'Motif de l’opération (facultatif pour une dépense, obligatoire sinon)',
  `approval_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `expense_category_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `reference` VARCHAR(180) NULL,
  `occurred_at` DATETIME(6) NOT NULL,
  `created_by` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `source_device_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `sync_command_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cash_movements_01` (`clinic_id`, `id`),
  KEY `ix_cash_movements_01` (`clinic_id`, `occurred_at`, `kind`),
  KEY `ix_cash_movements_02` (`clinic_id`, `cash_session_id`),
  KEY `ix_cash_movements_03` (`clinic_id`, `approval_id`),
  KEY `ix_cash_movements_04` (`clinic_id`, `expense_category_id`),
  KEY `ix_cash_movements_05` (`clinic_id`, `created_by`),
  KEY `ix_cash_movements_06` (`clinic_id`, `source_device_id`),
  KEY `ix_cash_movements_07` (`clinic_id`, `sync_command_id`),
  CONSTRAINT `ck_cash_movements_01` CHECK (signed_amount <> 0),
  CONSTRAINT `ck_cash_movements_02` CHECK (kind <> 'DEPOSIT' OR signed_amount > 0),
  CONSTRAINT `ck_cash_movements_03` CHECK (kind NOT IN ('WITHDRAWAL','EXPENSE') OR signed_amount < 0),
  CONSTRAINT `ck_cash_movements_04` CHECK (kind <> 'EXPENSE' OR expense_category_id IS NOT NULL),
  CONSTRAINT `ck_cash_movements_05` CHECK (kind = 'EXPENSE' OR method = 'CASH'),
  CONSTRAINT `ck_cash_movements_06` CHECK ((method = 'CASH' AND cash_session_id IS NOT NULL) OR (method <> 'CASH' AND cash_session_id IS NULL)),
  CONSTRAINT `ck_cash_movements_07` CHECK (kind = 'EXPENSE' OR (reason IS NOT NULL AND approval_id IS NOT NULL)),
  CONSTRAINT `ck_cash_movements_08` CHECK (`kind` IN ('DEPOSIT','WITHDRAWAL','EXPENSE','OPENING_CORRECTION')),
  CONSTRAINT `ck_cash_movements_09` CHECK (`method` IN ('CASH','MTN_MOMO','ORANGE_MONEY','BANK_TRANSFER','CHEQUE','OTHER')),
  CONSTRAINT `ck_cash_movements_10` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Dépenses et mouvements hors vente (tiroir espèces ou hors tiroir), sans duplication paiements/refunds';

-- Caisse et rapprochement : Rapprochement d’un canal réel avec justificatifs
CREATE TABLE `payment_reconciliations` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `method` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `period_starts_at` DATETIME(6) NOT NULL,
  `period_ends_at` DATETIME(6) NOT NULL,
  `status` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `expected_amount` BIGINT NOT NULL,
  `statement_amount` BIGINT NULL,
  `statement_file_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `validated_by` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `validated_at` DATETIME(6) NULL,
  `variance_reason` TEXT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_payment_reconciliations_01` (`clinic_id`, `id`),
  KEY `ix_payment_reconciliations_01` (`clinic_id`, `statement_file_id`),
  KEY `ix_payment_reconciliations_02` (`clinic_id`, `validated_by`),
  CONSTRAINT `ck_payment_reconciliations_01` CHECK (period_ends_at > period_starts_at),
  CONSTRAINT `ck_payment_reconciliations_02` CHECK (status <> 'VALIDATED' OR (validated_at IS NOT NULL AND validated_by IS NOT NULL AND statement_amount IS NOT NULL)),
  CONSTRAINT `ck_payment_reconciliations_03` CHECK (`method` IN ('CASH','MTN_MOMO','ORANGE_MONEY','BANK_TRANSFER','CHEQUE','OTHER')),
  CONSTRAINT `ck_payment_reconciliations_04` CHECK (`status` IN ('DRAFT','VALIDATED')),
  CONSTRAINT `ck_payment_reconciliations_05` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Rapprochement d’un canal réel avec justificatifs';

-- Caisse et rapprochement : Pièces effectivement rapprochées par canal
CREATE TABLE `payment_reconciliation_lines` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `reconciliation_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `payment_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `refund_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `external_reference` VARCHAR(180) NULL,
  `statement_amount` BIGINT NOT NULL,
  `status` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `note` TEXT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_payment_reconciliation_lines_01` (`clinic_id`, `id`),
  KEY `ix_payment_reconciliation_lines_01` (`clinic_id`, `reconciliation_id`),
  KEY `ix_payment_reconciliation_lines_02` (`clinic_id`, `payment_id`),
  KEY `ix_payment_reconciliation_lines_03` (`clinic_id`, `refund_id`),
  CONSTRAINT `ck_payment_reconciliation_lines_01` CHECK ((payment_id IS NOT NULL) + (refund_id IS NOT NULL) <= 1),
  CONSTRAINT `ck_payment_reconciliation_lines_02` CHECK (`status` IN ('MATCHED','UNMATCHED','DISPUTED')),
  CONSTRAINT `ck_payment_reconciliation_lines_03` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Pièces effectivement rapprochées par canal';

-- Stock achats et inventaires : Rayon/atelier/emplacement physique
CREATE TABLE `stock_locations` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `code` VARCHAR(40) NOT NULL,
  `name` VARCHAR(180) NOT NULL,
  `active` BOOLEAN NOT NULL DEFAULT 1,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_stock_locations_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_stock_locations_02` (`clinic_id`, `code`),
  CONSTRAINT `ck_stock_locations_01` CHECK (`active` IN (0,1)),
  CONSTRAINT `ck_stock_locations_02` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Rayon/atelier/emplacement physique';

-- Stock achats et inventaires : Fournisseur ou laboratoire, coordonnées administratives
CREATE TABLE `suppliers` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `name` VARCHAR(180) NOT NULL,
  `reference` VARCHAR(64) NOT NULL,
  `phone` VARCHAR(32) NULL,
  `email` VARCHAR(254) NULL,
  `address` TEXT NULL,
  `is_optical_lab` BOOLEAN NOT NULL DEFAULT 0,
  `active` BOOLEAN NOT NULL DEFAULT 1,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_suppliers_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_suppliers_02` (`clinic_id`, `reference`),
  CONSTRAINT `ck_suppliers_01` CHECK (`is_optical_lab` IN (0,1)),
  CONSTRAINT `ck_suppliers_02` CHECK (`active` IN (0,1)),
  CONSTRAINT `ck_suppliers_03` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Fournisseur ou laboratoire, coordonnées administratives';

-- Stock achats et inventaires : Réception fournisseur validée et justificative
CREATE TABLE `goods_receipts` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `supplier_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `location_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `supplier_reference` VARCHAR(100) NOT NULL,
  `received_at` DATETIME(6) NOT NULL,
  `status` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `evidence_file_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `validated_by` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `validated_at` DATETIME(6) NULL,
  `notes` TEXT NULL,
  `created_by` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_goods_receipts_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_goods_receipts_02` (`clinic_id`, `supplier_id`, `supplier_reference`),
  UNIQUE KEY `uq_goods_receipts_03` (`clinic_id`, `id`, `location_id`),
  KEY `ix_goods_receipts_01` (`clinic_id`, `location_id`),
  KEY `ix_goods_receipts_02` (`clinic_id`, `evidence_file_id`),
  KEY `ix_goods_receipts_03` (`clinic_id`, `validated_by`),
  KEY `ix_goods_receipts_04` (`clinic_id`, `created_by`),
  CONSTRAINT `ck_goods_receipts_01` CHECK (status <> 'VALIDATED' OR (validated_by IS NOT NULL AND validated_at IS NOT NULL)),
  CONSTRAINT `ck_goods_receipts_02` CHECK (`status` IN ('DRAFT','VALIDATED','ABANDONED')),
  CONSTRAINT `ck_goods_receipts_03` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Réception fournisseur validée et justificative';

-- Stock achats et inventaires : Projection physique/réserve centrale/quota local distincts
CREATE TABLE `stock_positions` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `item_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `location_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `on_hand` DECIMAL(12,3) NOT NULL DEFAULT 0,
  `reserved` DECIMAL(12,3) NOT NULL DEFAULT 0,
  `offline_allocated` DECIMAL(12,3) NOT NULL DEFAULT 0,
  `central_available` DECIMAL(12,3) GENERATED ALWAYS AS (on_hand - reserved - offline_allocated) STORED,
  `version` INT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'Version optimiste, jamais un numéro de pièce',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_stock_positions_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_stock_positions_02` (`clinic_id`, `item_id`, `location_id`),
  UNIQUE KEY `uq_stock_positions_03` (`clinic_id`, `id`, `item_id`, `location_id`),
  UNIQUE KEY `uq_stock_positions_04` (`clinic_id`, `id`, `item_id`),
  KEY `ix_stock_positions_01` (`clinic_id`, `location_id`),
  CONSTRAINT `ck_stock_positions_01` CHECK (on_hand >= 0),
  CONSTRAINT `ck_stock_positions_02` CHECK (reserved >= 0),
  CONSTRAINT `ck_stock_positions_03` CHECK (offline_allocated >= 0),
  CONSTRAINT `ck_stock_positions_04` CHECK (on_hand >= reserved + offline_allocated),
  CONSTRAINT `ck_stock_positions_05` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Projection physique/réserve centrale/quota local distincts';

-- Stock achats et inventaires : Lot/péremption et coût connu ; pas de vente d’un lot périmé
CREATE TABLE `stock_lots` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `item_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `location_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `stock_position_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `batch_number` VARCHAR(80) NOT NULL,
  `expires_on` DATE NULL,
  `received_at` DATETIME(6) NOT NULL,
  `unit_cost` BIGINT NULL,
  `status` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `on_hand` DECIMAL(12,3) NOT NULL DEFAULT 0,
  `reserved` DECIMAL(12,3) NOT NULL DEFAULT 0,
  `offline_allocated` DECIMAL(12,3) NOT NULL DEFAULT 0,
  `version` INT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'Version optimiste, jamais un numéro de pièce',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_stock_lots_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_stock_lots_02` (`clinic_id`, `item_id`, `location_id`, `batch_number`),
  UNIQUE KEY `uq_stock_lots_03` (`clinic_id`, `id`, `stock_position_id`),
  UNIQUE KEY `uq_stock_lots_04` (`clinic_id`, `id`, `item_id`, `location_id`),
  KEY `ix_stock_lots_01` (`clinic_id`, `stock_position_id`, `item_id`, `location_id`),
  KEY `ix_stock_lots_02` (`clinic_id`, `location_id`),
  CONSTRAINT `ck_stock_lots_01` CHECK (on_hand >= reserved + offline_allocated),
  CONSTRAINT `ck_stock_lots_02` CHECK (on_hand >= 0),
  CONSTRAINT `ck_stock_lots_03` CHECK (reserved >= 0),
  CONSTRAINT `ck_stock_lots_04` CHECK (offline_allocated >= 0),
  CONSTRAINT `ck_stock_lots_05` CHECK (`unit_cost` BETWEEN 0 AND 1000000000000),
  CONSTRAINT `ck_stock_lots_06` CHECK (`status` IN ('SELLABLE','QUARANTINE')),
  CONSTRAINT `ck_stock_lots_07` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Lot/péremption et coût connu ; pas de vente d’un lot périmé';

-- Stock achats et inventaires : Article/quantité/coût/lot reçus, une ligne par lot
CREATE TABLE `goods_receipt_lines` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `receipt_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `position` SMALLINT UNSIGNED NOT NULL,
  `item_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `location_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `stock_lot_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `quantity` DECIMAL(12,3) NOT NULL,
  `unit_cost` BIGINT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_goods_receipt_lines_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_goods_receipt_lines_02` (`clinic_id`, `receipt_id`, `position`),
  UNIQUE KEY `uq_goods_receipt_lines_03` (`clinic_id`, `id`, `item_id`),
  KEY `ix_goods_receipt_lines_01` (`clinic_id`, `receipt_id`, `location_id`),
  KEY `ix_goods_receipt_lines_02` (`clinic_id`, `stock_lot_id`, `item_id`, `location_id`),
  KEY `ix_goods_receipt_lines_03` (`clinic_id`, `item_id`),
  KEY `ix_goods_receipt_lines_04` (`clinic_id`, `location_id`),
  CONSTRAINT `ck_goods_receipt_lines_01` CHECK (quantity > 0),
  CONSTRAINT `ck_goods_receipt_lines_02` CHECK (position > 0),
  CONSTRAINT `ck_goods_receipt_lines_03` CHECK (`unit_cost` BETWEEN 0 AND 1000000000000),
  CONSTRAINT `ck_goods_receipt_lines_04` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Article/quantité/coût/lot reçus, une ligne par lot';

-- Stock achats et inventaires : Inventaire avec théorique figé et validation des écarts
CREATE TABLE `inventory_counts` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `location_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `reference` VARCHAR(64) NOT NULL,
  `snapshot_at` DATETIME(6) NOT NULL,
  `status` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `opened_by` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `validated_by` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `validated_at` DATETIME(6) NULL,
  `approval_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_inventory_counts_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_inventory_counts_02` (`clinic_id`, `reference`),
  UNIQUE KEY `uq_inventory_counts_03` (`clinic_id`, `id`, `location_id`),
  KEY `ix_inventory_counts_01` (`clinic_id`, `location_id`),
  KEY `ix_inventory_counts_02` (`clinic_id`, `opened_by`),
  KEY `ix_inventory_counts_03` (`clinic_id`, `validated_by`),
  KEY `ix_inventory_counts_04` (`clinic_id`, `approval_id`),
  CONSTRAINT `ck_inventory_counts_01` CHECK (status <> 'VALIDATED' OR (validated_by IS NOT NULL AND validated_at IS NOT NULL AND approval_id IS NOT NULL)),
  CONSTRAINT `ck_inventory_counts_02` CHECK (`status` IN ('OPEN','COUNTED','VALIDATED','ABANDONED')),
  CONSTRAINT `ck_inventory_counts_03` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Inventaire avec théorique figé et validation des écarts';

-- Stock achats et inventaires : Comptage par article/lot ; lot nullable sans doublon
CREATE TABLE `inventory_count_lines` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `inventory_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `item_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `location_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `stock_lot_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `lot_key` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin GENERATED ALWAYS AS (COALESCE(stock_lot_id,'00000000000000000000000000')) STORED,
  `theoretical_quantity` DECIMAL(12,3) NOT NULL,
  `counted_quantity` DECIMAL(12,3) NULL,
  `variance_quantity` DECIMAL(12,3) GENERATED ALWAYS AS (counted_quantity - theoretical_quantity) STORED,
  `variance_reason` TEXT NULL,
  `counted_by` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `counted_at` DATETIME(6) NULL,
  `adjustment_movement_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_inventory_count_lines_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_inventory_count_lines_02` (`clinic_id`, `inventory_id`, `item_id`, `lot_key`),
  KEY `ix_inventory_count_lines_01` (`clinic_id`, `inventory_id`, `location_id`),
  KEY `ix_inventory_count_lines_02` (`clinic_id`, `stock_lot_id`, `item_id`, `location_id`),
  KEY `ix_inventory_count_lines_03` (`clinic_id`, `item_id`),
  KEY `ix_inventory_count_lines_04` (`clinic_id`, `location_id`),
  KEY `ix_inventory_count_lines_05` (`clinic_id`, `counted_by`),
  KEY `ix_inventory_count_lines_06` (`clinic_id`, `adjustment_movement_id`),
  CONSTRAINT `ck_inventory_count_lines_01` CHECK (theoretical_quantity >= 0),
  CONSTRAINT `ck_inventory_count_lines_02` CHECK (counted_quantity IS NULL OR counted_quantity >= 0),
  CONSTRAINT `ck_inventory_count_lines_03` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Comptage par article/lot ; lot nullable sans doublon';

-- Stock achats et inventaires : Réserve de vente, centrale OU sous quota local
CREATE TABLE `stock_reservations` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `item_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `invoice_line_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `stock_position_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `stock_lot_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `device_allocation_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `quantity` DECIMAL(12,3) NOT NULL,
  `consumed_quantity` DECIMAL(12,3) NOT NULL DEFAULT 0,
  `released_quantity` DECIMAL(12,3) NOT NULL DEFAULT 0,
  `status` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'Version optimiste, jamais un numéro de pièce',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `lot_key` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin GENERATED ALWAYS AS (COALESCE(stock_lot_id,'00000000000000000000000000')) STORED,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_stock_reservations_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_stock_reservations_02` (`clinic_id`, `id`, `invoice_line_id`, `stock_position_id`, `lot_key`),
  KEY `ix_stock_reservations_01` (`clinic_id`, `stock_lot_id`, `stock_position_id`),
  KEY `ix_stock_reservations_02` (`clinic_id`, `device_allocation_id`, `stock_position_id`),
  KEY `ix_stock_reservations_03` (`clinic_id`, `invoice_line_id`, `item_id`),
  KEY `ix_stock_reservations_04` (`clinic_id`, `stock_position_id`, `item_id`),
  KEY `ix_stock_reservations_05` (`clinic_id`, `device_allocation_id`, `stock_position_id`, `lot_key`),
  KEY `ix_stock_reservations_06` (`clinic_id`, `item_id`),
  CONSTRAINT `ck_stock_reservations_01` CHECK (quantity > 0),
  CONSTRAINT `ck_stock_reservations_02` CHECK (consumed_quantity >= 0),
  CONSTRAINT `ck_stock_reservations_03` CHECK (released_quantity >= 0),
  CONSTRAINT `ck_stock_reservations_04` CHECK (consumed_quantity + released_quantity <= quantity),
  CONSTRAINT `ck_stock_reservations_05` CHECK (`status` IN ('ACTIVE','CONSUMED','RELEASED')),
  CONSTRAINT `ck_stock_reservations_06` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Réserve de vente, centrale OU sous quota local';

-- Stock achats et inventaires : Remise physique liée à facture, partielle ou totale
CREATE TABLE `deliveries` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `invoice_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `status` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `delivered_at` DATETIME(6) NULL,
  `delivered_by` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `credit_delivery_approval_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `idempotency_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `patient_snapshot` JSON NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_deliveries_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_deliveries_02` (`clinic_id`, `idempotency_id`),
  UNIQUE KEY `uq_deliveries_03` (`clinic_id`, `id`, `invoice_id`),
  KEY `ix_deliveries_01` (`clinic_id`, `invoice_id`),
  KEY `ix_deliveries_02` (`clinic_id`, `delivered_by`),
  KEY `ix_deliveries_03` (`clinic_id`, `credit_delivery_approval_id`),
  CONSTRAINT `ck_deliveries_01` CHECK (status <> 'CONFIRMED' OR (delivered_at IS NOT NULL AND delivered_by IS NOT NULL AND patient_snapshot IS NOT NULL)),
  CONSTRAINT `ck_deliveries_02` CHECK (`status` IN ('DRAFT','CONFIRMED')),
  CONSTRAINT `ck_deliveries_03` CHECK (id <> '00000000000000000000000000'),
  CONSTRAINT `ck_deliveries_04` CHECK (`patient_snapshot` IS NULL OR JSON_TYPE(`patient_snapshot`) = 'OBJECT')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Remise physique liée à facture, partielle ou totale';

-- Stock achats et inventaires : Quantité remise non déjà livrée, stock et atelier éventuels
CREATE TABLE `delivery_lines` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `item_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `stock_position_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `lot_key` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin GENERATED ALWAYS AS (COALESCE(stock_lot_id,'00000000000000000000000000')) STORED,
  `delivery_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `invoice_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `invoice_line_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `quantity` DECIMAL(12,3) NOT NULL,
  `stock_lot_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `workshop_order_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `reservation_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_delivery_lines_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_delivery_lines_02` (`clinic_id`, `id`, `invoice_line_id`),
  UNIQUE KEY `uq_delivery_lines_03` (`clinic_id`, `id`, `item_id`),
  UNIQUE KEY `uq_delivery_lines_04` (`clinic_id`, `id`, `item_id`, `stock_position_id`, `lot_key`),
  KEY `ix_delivery_lines_01` (`clinic_id`, `delivery_id`, `invoice_id`),
  KEY `ix_delivery_lines_02` (`clinic_id`, `invoice_line_id`, `invoice_id`),
  KEY `ix_delivery_lines_03` (`clinic_id`, `invoice_line_id`, `item_id`),
  KEY `ix_delivery_lines_04` (`clinic_id`, `stock_position_id`, `item_id`),
  KEY `ix_delivery_lines_05` (`clinic_id`, `stock_lot_id`, `stock_position_id`),
  KEY `ix_delivery_lines_06` (`clinic_id`, `reservation_id`, `invoice_line_id`, `stock_position_id`, `lot_key`),
  KEY `ix_delivery_lines_07` (`clinic_id`, `workshop_order_id`, `invoice_line_id`),
  KEY `ix_delivery_lines_08` (`clinic_id`, `item_id`),
  KEY `ix_delivery_lines_09` (`clinic_id`, `invoice_id`),
  CONSTRAINT `ck_delivery_lines_01` CHECK (quantity > 0),
  CONSTRAINT `ck_delivery_lines_02` CHECK (stock_lot_id IS NULL OR stock_position_id IS NOT NULL),
  CONSTRAINT `ck_delivery_lines_03` CHECK (reservation_id IS NULL OR stock_position_id IS NOT NULL),
  CONSTRAINT `ck_delivery_lines_04` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Quantité remise non déjà livrée, stock et atelier éventuels';

-- Stock achats et inventaires : Retour physique contrôlé, indépendamment d’un avoir
CREATE TABLE `physical_returns` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `item_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `delivery_line_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `quantity` DECIMAL(12,3) NOT NULL,
  `condition_code` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `accepted_for_restock` BOOLEAN NOT NULL DEFAULT 0,
  `approved_by` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `occurred_at` DATETIME(6) NOT NULL,
  `reason` TEXT NOT NULL COMMENT 'Motif obligatoire de l’opération',
  `credit_note_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `idempotency_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_physical_returns_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_physical_returns_02` (`clinic_id`, `idempotency_id`),
  UNIQUE KEY `uq_physical_returns_03` (`clinic_id`, `id`, `item_id`),
  KEY `ix_physical_returns_01` (`clinic_id`, `delivery_line_id`, `item_id`),
  KEY `ix_physical_returns_02` (`clinic_id`, `item_id`),
  KEY `ix_physical_returns_03` (`clinic_id`, `approved_by`),
  KEY `ix_physical_returns_04` (`clinic_id`, `credit_note_id`),
  CONSTRAINT `ck_physical_returns_01` CHECK (quantity > 0),
  CONSTRAINT `ck_physical_returns_02` CHECK (accepted_for_restock = 0 OR condition_code = 'SELLABLE'),
  CONSTRAINT `ck_physical_returns_03` CHECK (`condition_code` IN ('SELLABLE','DAMAGED','QUARANTINE','OTHER')),
  CONSTRAINT `ck_physical_returns_04` CHECK (`accepted_for_restock` IN (0,1)),
  CONSTRAINT `ck_physical_returns_05` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Retour physique contrôlé, indépendamment d’un avoir';

-- Stock achats et inventaires : Faits physiques append-only ; réserve seule n’est pas une sortie
CREATE TABLE `stock_movements` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `lot_key` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin GENERATED ALWAYS AS (COALESCE(lot_id,'00000000000000000000000000')) STORED,
  `movement_position` SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  `item_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `position_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `lot_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `kind` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `signed_quantity` DECIMAL(12,3) NOT NULL,
  `unit_cost` BIGINT NULL,
  `delivery_line_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `physical_return_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `goods_receipt_line_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `approval_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `reason` TEXT NOT NULL COMMENT 'Motif obligatoire de l’opération',
  `occurred_at` DATETIME(6) NOT NULL,
  `actor_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `idempotency_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_stock_movements_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_stock_movements_02` (`clinic_id`, `idempotency_id`, `movement_position`),
  KEY `ix_stock_movements_01` (`clinic_id`, `item_id`, `occurred_at`),
  KEY `ix_stock_movements_02` (`clinic_id`, `position_id`, `item_id`),
  KEY `ix_stock_movements_03` (`clinic_id`, `lot_id`, `position_id`),
  KEY `ix_stock_movements_04` (`clinic_id`, `delivery_line_id`, `item_id`, `position_id`, `lot_key`),
  KEY `ix_stock_movements_05` (`clinic_id`, `goods_receipt_line_id`, `item_id`),
  KEY `ix_stock_movements_06` (`clinic_id`, `physical_return_id`, `item_id`),
  KEY `ix_stock_movements_07` (`clinic_id`, `approval_id`),
  KEY `ix_stock_movements_08` (`clinic_id`, `actor_id`),
  CONSTRAINT `ck_stock_movements_01` CHECK (signed_quantity <> 0),
  CONSTRAINT `ck_stock_movements_02` CHECK (kind <> 'SALE_DELIVERY' OR (signed_quantity < 0 AND delivery_line_id IS NOT NULL)),
  CONSTRAINT `ck_stock_movements_03` CHECK (kind <> 'PATIENT_RETURN' OR (signed_quantity > 0 AND physical_return_id IS NOT NULL)),
  CONSTRAINT `ck_stock_movements_04` CHECK (kind <> 'RECEIPT' OR (signed_quantity > 0 AND goods_receipt_line_id IS NOT NULL)),
  CONSTRAINT `ck_stock_movements_05` CHECK (kind NOT IN ('BREAKAGE','SUPPLIER_RETURN') OR signed_quantity < 0),
  CONSTRAINT `ck_stock_movements_06` CHECK (kind NOT IN ('OPENING','BREAKAGE','SUPPLIER_RETURN','ADJUSTMENT') OR approval_id IS NOT NULL),
  CONSTRAINT `ck_stock_movements_07` CHECK (movement_position > 0),
  CONSTRAINT `ck_stock_movements_08` CHECK (`kind` IN ('OPENING','RECEIPT','SALE_DELIVERY','PATIENT_RETURN','BREAKAGE','SUPPLIER_RETURN','ADJUSTMENT')),
  CONSTRAINT `ck_stock_movements_09` CHECK (`unit_cost` BETWEEN 0 AND 1000000000000),
  CONSTRAINT `ck_stock_movements_10` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Faits physiques append-only ; réserve seule n’est pas une sortie';

-- Stock achats et inventaires : Alerte de seuil/péremption dédupliquée et résoluble
CREATE TABLE `stock_alerts` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `item_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `location_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `lot_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `kind` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `dedupe_key` VARCHAR(180) NOT NULL,
  `detected_at` DATETIME(6) NOT NULL,
  `due_on` DATE NULL,
  `status` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `acknowledged_by` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `resolved_at` DATETIME(6) NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_stock_alerts_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_stock_alerts_02` (`clinic_id`, `dedupe_key`),
  KEY `ix_stock_alerts_01` (`clinic_id`, `item_id`),
  KEY `ix_stock_alerts_02` (`clinic_id`, `location_id`),
  KEY `ix_stock_alerts_03` (`clinic_id`, `lot_id`),
  KEY `ix_stock_alerts_04` (`clinic_id`, `acknowledged_by`),
  CONSTRAINT `ck_stock_alerts_01` CHECK (`kind` IN ('LOW_STOCK','EXPIRY')),
  CONSTRAINT `ck_stock_alerts_02` CHECK (`status` IN ('OPEN','ACKNOWLEDGED','RESOLVED')),
  CONSTRAINT `ck_stock_alerts_03` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Alerte de seuil/péremption dédupliquée et résoluble';

-- Atelier optique : Commande labo et équipement figés ; reprise sans effacement
CREATE TABLE `workshop_orders` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `patient_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `invoice_line_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `prescription_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `supplier_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `frame_item_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `reference` VARCHAR(64) NOT NULL,
  `lab_reference` VARCHAR(100) NULL,
  `quantity` DECIMAL(12,3) NOT NULL,
  `snapshot` JSON NOT NULL COMMENT 'Données figées de la pièce ou révision',
  `ordered_at` DATETIME(6) NOT NULL,
  `expected_at` DATETIME(6) NULL,
  `received_at` DATETIME(6) NULL,
  `status` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `ready_revision` INT UNSIGNED NOT NULL DEFAULT 0,
  `notes` TEXT NULL,
  `created_by` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'Version optimiste, jamais un numéro de pièce',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_workshop_orders_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_workshop_orders_02` (`clinic_id`, `reference`),
  UNIQUE KEY `uq_workshop_orders_03` (`clinic_id`, `id`, `invoice_line_id`),
  KEY `ix_workshop_orders_01` (`clinic_id`, `invoice_line_id`, `patient_id`),
  KEY `ix_workshop_orders_02` (`clinic_id`, `prescription_id`, `patient_id`),
  KEY `ix_workshop_orders_03` (`clinic_id`, `patient_id`),
  KEY `ix_workshop_orders_04` (`clinic_id`, `supplier_id`),
  KEY `ix_workshop_orders_05` (`clinic_id`, `frame_item_id`),
  KEY `ix_workshop_orders_06` (`clinic_id`, `created_by`),
  CONSTRAINT `ck_workshop_orders_01` CHECK (quantity > 0),
  CONSTRAINT `ck_workshop_orders_02` CHECK (`status` IN ('ORDERED','RECEIVED','MOUNTING','QUALITY_CHECK','READY','DELIVERED','CANCELLED')),
  CONSTRAINT `ck_workshop_orders_03` CHECK (id <> '00000000000000000000000000'),
  CONSTRAINT `ck_workshop_orders_04` CHECK (`snapshot` IS NULL OR JSON_TYPE(`snapshot`) = 'OBJECT')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Commande labo et équipement figés ; reprise sans effacement';

-- Atelier optique : Spécifications verrier OD/OG figées issues d’une prescription validée
CREATE TABLE `workshop_order_eyes` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workshop_order_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `eye` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `sphere` DECIMAL(6,2) NULL,
  `cylinder` DECIMAL(6,2) NULL,
  `axis` SMALLINT UNSIGNED NULL,
  `addition` DECIMAL(6,2) NULL,
  `pd` DECIMAL(6,2) NULL,
  `fitting_height` DECIMAL(6,2) NULL,
  `lens_type` VARCHAR(100) NOT NULL,
  `lens_index` DECIMAL(4,2) NULL,
  `treatments_snapshot` JSON NOT NULL,
  `frame_reference_snapshot` VARCHAR(100) NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_workshop_order_eyes_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_workshop_order_eyes_02` (`clinic_id`, `workshop_order_id`, `eye`),
  CONSTRAINT `ck_workshop_order_eyes_01` CHECK (axis IS NULL OR axis <= 180),
  CONSTRAINT `ck_workshop_order_eyes_02` CHECK (pd IS NULL OR pd > 0),
  CONSTRAINT `ck_workshop_order_eyes_03` CHECK (fitting_height IS NULL OR fitting_height > 0),
  CONSTRAINT `ck_workshop_order_eyes_04` CHECK (`eye` IN ('OD','OG')),
  CONSTRAINT `ck_workshop_order_eyes_05` CHECK (id <> '00000000000000000000000000'),
  CONSTRAINT `ck_workshop_order_eyes_06` CHECK (`treatments_snapshot` IS NULL OR JSON_TYPE(`treatments_snapshot`) = 'ARRAY')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Spécifications verrier OD/OG figées issues d’une prescription validée';

-- Atelier optique : Transition, reprise ou contrôle qualité auteur/date
CREATE TABLE `workshop_events` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `workshop_order_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `sequence_no` INT UNSIGNED NOT NULL,
  `event_type` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `previous_status` VARCHAR(40) NULL,
  `new_status` VARCHAR(40) NULL,
  `quality_result` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `observations` TEXT NULL,
  `occurred_at` DATETIME(6) NOT NULL,
  `actor_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `delivery_line_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_workshop_events_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_workshop_events_02` (`clinic_id`, `workshop_order_id`, `sequence_no`),
  KEY `ix_workshop_events_01` (`clinic_id`, `actor_id`),
  KEY `ix_workshop_events_02` (`clinic_id`, `delivery_line_id`),
  CONSTRAINT `ck_workshop_events_01` CHECK (sequence_no > 0),
  CONSTRAINT `ck_workshop_events_02` CHECK (`event_type` IN ('STATUS_CHANGE','REWORK','QUALITY_CHECK','ADJUSTMENT','CANCEL')),
  CONSTRAINT `ck_workshop_events_03` CHECK (`quality_result` IN ('PASSED','FAILED','NOT_APPLICABLE')),
  CONSTRAINT `ck_workshop_events_04` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Transition, reprise ou contrôle qualité auteur/date';

-- Intégrations : Compte Google/Kommo/Meta/SMS, secrets chiffrés séparés des données cliniques
CREATE TABLE `integration_accounts` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `provider` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `external_account_id` VARCHAR(180) NOT NULL,
  `display_name` VARCHAR(180) NOT NULL,
  `credentials_ciphertext` TEXT NULL,
  `encryption_key_id` VARCHAR(100) NULL,
  `token_expires_at` DATETIME(6) NULL,
  `status` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `public_configuration` JSON NULL,
  `configured_by` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'Version optimiste, jamais un numéro de pièce',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_integration_accounts_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_integration_accounts_02` (`clinic_id`, `provider`, `external_account_id`),
  KEY `ix_integration_accounts_01` (`clinic_id`, `configured_by`),
  CONSTRAINT `ck_integration_accounts_01` CHECK (credentials_ciphertext IS NULL OR encryption_key_id IS NOT NULL),
  CONSTRAINT `ck_integration_accounts_02` CHECK (`provider` IN ('GOOGLE','KOMMO','META_WHATSAPP','META_MESSENGER','META_INSTAGRAM','SMS','SMTP')),
  CONSTRAINT `ck_integration_accounts_03` CHECK (`status` IN ('DISABLED','TEST','ACTIVE','ERROR')),
  CONSTRAINT `ck_integration_accounts_04` CHECK (id <> '00000000000000000000000000'),
  CONSTRAINT `ck_integration_accounts_05` CHECK (`public_configuration` IS NULL OR JSON_TYPE(`public_configuration`) = 'OBJECT')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Compte Google/Kommo/Meta/SMS, secrets chiffrés séparés des données cliniques';

-- Intégrations : Correspondance externe à version/etag, cible interne contrôlée par adaptateur
CREATE TABLE `external_links` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `integration_account_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `local_entity_type` VARCHAR(64) NOT NULL,
  `local_entity_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `external_entity_type` VARCHAR(64) NOT NULL,
  `external_entity_id` VARCHAR(180) NOT NULL,
  `etag` VARCHAR(255) NULL,
  `local_version` INT UNSIGNED NOT NULL,
  `last_synced_at` DATETIME(6) NULL,
  `status` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_external_links_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_external_links_02` (`clinic_id`, `integration_account_id`, `external_entity_type`, `external_entity_id`),
  UNIQUE KEY `uq_external_links_03` (`clinic_id`, `integration_account_id`, `local_entity_type`, `local_entity_id`, `external_entity_type`),
  CONSTRAINT `ck_external_links_01` CHECK (`status` IN ('PENDING','SYNCED','CONFLICT','FAILED')),
  CONSTRAINT `ck_external_links_02` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Correspondance externe à version/etag, cible interne contrôlée par adaptateur';

-- Intégrations : État Google, token et canal push ne remplacent pas l’agenda interne
CREATE TABLE `calendar_sync_states` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `integration_account_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `resource_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `external_calendar_id` VARCHAR(255) NOT NULL,
  `sync_token_ciphertext` TEXT NULL,
  `token_encryption_key_id` VARCHAR(100) NULL,
  `pending_page_token` VARCHAR(500) NULL,
  `push_channel_id` VARCHAR(180) NULL,
  `push_resource_id` VARCHAR(255) NULL,
  `push_expires_at` DATETIME(6) NULL,
  `last_full_sync_at` DATETIME(6) NULL,
  `last_incremental_sync_at` DATETIME(6) NULL,
  `status` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `last_error_code` VARCHAR(100) NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'Version optimiste, jamais un numéro de pièce',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_calendar_sync_states_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_calendar_sync_states_02` (`clinic_id`, `integration_account_id`, `resource_id`),
  KEY `ix_calendar_sync_states_01` (`clinic_id`, `resource_id`),
  CONSTRAINT `ck_calendar_sync_states_01` CHECK (`status` IN ('NOT_CONFIGURED','READY','SYNCING','STALE','ERROR')),
  CONSTRAINT `ck_calendar_sync_states_02` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='État Google, token et canal push ne remplacent pas l’agenda interne';

-- Intégrations : Réception durable/dédupliquée, données minimales protégées
CREATE TABLE `webhook_inbox` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `integration_account_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `provider_event_key` VARCHAR(180) NOT NULL,
  `payload_hash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `payload_ciphertext` TEXT NOT NULL,
  `encryption_key_id` VARCHAR(100) NOT NULL,
  `received_at` DATETIME(6) NOT NULL,
  `status` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `verified_at` DATETIME(6) NULL,
  `processed_at` DATETIME(6) NULL,
  `attempt_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `last_error_code` VARCHAR(100) NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_webhook_inbox_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_webhook_inbox_02` (`clinic_id`, `integration_account_id`, `provider_event_key`),
  CONSTRAINT `ck_webhook_inbox_01` CHECK (`status` IN ('RECEIVED','VERIFIED','PROCESSED','REJECTED','FAILED')),
  CONSTRAINT `ck_webhook_inbox_02` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Réception durable/dédupliquée, données minimales protégées';

-- Intégrations : Effets externes après commit, payload minimal et déduplication
CREATE TABLE `outbox_events` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `event_type` VARCHAR(100) NOT NULL,
  `event_version` SMALLINT UNSIGNED NOT NULL,
  `source_type` VARCHAR(64) NOT NULL,
  `source_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `source_version` INT UNSIGNED NOT NULL,
  `payload` JSON NOT NULL,
  `correlation_id` VARCHAR(100) NOT NULL,
  `status` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `processed_at` DATETIME(6) NULL,
  `attempt_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `next_attempt_at` DATETIME(6) NULL,
  `last_error_code` VARCHAR(100) NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_outbox_events_01` (`clinic_id`, `id`),
  KEY `ix_outbox_events_01` (`clinic_id`, `status`, `next_attempt_at`),
  CONSTRAINT `ck_outbox_events_01` CHECK (`status` IN ('PENDING','PROCESSING','PROCESSED','FAILED')),
  CONSTRAINT `ck_outbox_events_02` CHECK (id <> '00000000000000000000000000'),
  CONSTRAINT `ck_outbox_events_03` CHECK (`payload` IS NULL OR JSON_TYPE(`payload`) = 'OBJECT')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Effets externes après commit, payload minimal et déduplication';

-- CRM et assistant : Pipeline Kommo, besoin/budget administratif et liaison prospect
CREATE TABLE `crm_leads` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `prospect_contact_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `integration_account_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `external_lead_id` VARCHAR(180) NOT NULL,
  `pipeline_id` VARCHAR(100) NULL,
  `pipeline_stage` VARCHAR(100) NOT NULL,
  `product_interest` TEXT NULL,
  `budget_min` BIGINT NULL,
  `budget_max` BIGINT NULL,
  `acquisition_source` VARCHAR(100) NULL,
  `assigned_to` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `status` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `last_synced_at` DATETIME(6) NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_crm_leads_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_crm_leads_02` (`clinic_id`, `integration_account_id`, `external_lead_id`),
  KEY `ix_crm_leads_01` (`clinic_id`, `prospect_contact_id`),
  KEY `ix_crm_leads_02` (`clinic_id`, `assigned_to`),
  CONSTRAINT `ck_crm_leads_01` CHECK (budget_min IS NULL OR budget_max IS NULL OR budget_max >= budget_min),
  CONSTRAINT `ck_crm_leads_02` CHECK (`budget_min` BETWEEN 0 AND 1000000000000),
  CONSTRAINT `ck_crm_leads_03` CHECK (`budget_max` BETWEEN 0 AND 1000000000000),
  CONSTRAINT `ck_crm_leads_04` CHECK (`status` IN ('OPEN','APPOINTMENT_BOOKED','HUMAN_TAKEOVER','WON','LOST','CLOSED')),
  CONSTRAINT `ck_crm_leads_05` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Pipeline Kommo, besoin/budget administratif et liaison prospect';

-- CRM et assistant : Métadonnées de conversation ; Kommo reste maître du fil intégral
CREATE TABLE `crm_conversations` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `crm_lead_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `integration_account_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `external_conversation_id` VARCHAR(180) NOT NULL,
  `channel` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `status` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `human_owner_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `takeover_at` DATETIME(6) NULL,
  `takeover_reason` TEXT NULL,
  `administrative_summary` TEXT NULL,
  `bot_resumed_at` DATETIME(6) NULL,
  `bot_resumed_by` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `last_activity_at` DATETIME(6) NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'Version optimiste, jamais un numéro de pièce',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_crm_conversations_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_crm_conversations_02` (`clinic_id`, `integration_account_id`, `external_conversation_id`),
  KEY `ix_crm_conversations_01` (`clinic_id`, `crm_lead_id`),
  KEY `ix_crm_conversations_02` (`clinic_id`, `human_owner_id`),
  KEY `ix_crm_conversations_03` (`clinic_id`, `bot_resumed_by`),
  CONSTRAINT `ck_crm_conversations_01` CHECK (status <> 'HUMAN_TAKEOVER' OR takeover_at IS NOT NULL),
  CONSTRAINT `ck_crm_conversations_02` CHECK (`channel` IN ('WHATSAPP','MESSENGER','INSTAGRAM')),
  CONSTRAINT `ck_crm_conversations_03` CHECK (`status` IN ('BOT_ACTIVE','HUMAN_TAKEOVER','CLOSED')),
  CONSTRAINT `ck_crm_conversations_04` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Métadonnées de conversation ; Kommo reste maître du fil intégral';

-- CRM et assistant : Historique du transfert/reprise humaine, sans réécrire l’état passé
CREATE TABLE `conversation_handoffs` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `conversation_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `event_type` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `actor_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `reason` TEXT NOT NULL COMMENT 'Motif obligatoire de l’opération',
  `administrative_summary` TEXT NULL,
  `occurred_at` DATETIME(6) NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_conversation_handoffs_01` (`clinic_id`, `id`),
  KEY `ix_conversation_handoffs_01` (`clinic_id`, `conversation_id`),
  KEY `ix_conversation_handoffs_02` (`clinic_id`, `actor_id`),
  CONSTRAINT `ck_conversation_handoffs_01` CHECK (`event_type` IN ('REQUEST','TAKEOVER','RESUME_BOT','CLOSE')),
  CONSTRAINT `ck_conversation_handoffs_02` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Historique du transfert/reprise humaine, sans réécrire l’état passé';

-- CRM et assistant : FAQ et réponses types publiques éditables et versionnées
CREATE TABLE `knowledge_entries` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `code` VARCHAR(100) NOT NULL,
  `title` VARCHAR(180) NOT NULL,
  `category` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `active` BOOLEAN NOT NULL DEFAULT 1,
  `version` INT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'Version optimiste, jamais un numéro de pièce',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_knowledge_entries_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_knowledge_entries_02` (`clinic_id`, `code`),
  CONSTRAINT `ck_knowledge_entries_01` CHECK (`category` IN ('HOURS','LOCATION','PRICING','INSURANCE','SERVICES','LENSES','PRODUCTS','OTHER')),
  CONSTRAINT `ck_knowledge_entries_02` CHECK (`active` IN (0,1)),
  CONSTRAINT `ck_knowledge_entries_03` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='FAQ et réponses types publiques éditables et versionnées';

-- CRM et assistant : Version validée/publication d’une réponse, pas d’ordonnance IA
CREATE TABLE `knowledge_entry_versions` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `entry_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `revision_no` INT UNSIGNED NOT NULL,
  `content` TEXT NOT NULL,
  `language` VARCHAR(10) NOT NULL DEFAULT 'fr',
  `authored_by` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `approved_by` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `approved_at` DATETIME(6) NULL,
  `published_at` DATETIME(6) NULL,
  `retired_at` DATETIME(6) NULL,
  `active_entry_key` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin GENERATED ALWAYS AS (CASE WHEN published_at IS NOT NULL AND retired_at IS NULL THEN entry_id ELSE NULL END) STORED,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_knowledge_entry_versions_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_knowledge_entry_versions_02` (`clinic_id`, `entry_id`, `revision_no`),
  UNIQUE KEY `uq_knowledge_entry_versions_03` (`clinic_id`, `active_entry_key`),
  KEY `ix_knowledge_entry_versions_01` (`clinic_id`, `authored_by`),
  KEY `ix_knowledge_entry_versions_02` (`clinic_id`, `approved_by`),
  CONSTRAINT `ck_knowledge_entry_versions_01` CHECK (revision_no > 0),
  CONSTRAINT `ck_knowledge_entry_versions_02` CHECK (published_at IS NULL OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)),
  CONSTRAINT `ck_knowledge_entry_versions_03` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Version validée/publication d’une réponse, pas d’ordonnance IA';

-- CRM et assistant : Audit technique IA minimal, modèle/coût/outils sans dossier médical
CREATE TABLE `assistant_runs` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `conversation_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `engine_name` VARCHAR(100) NOT NULL,
  `model_name` VARCHAR(100) NOT NULL,
  `rules_version` VARCHAR(64) NOT NULL,
  `started_at` DATETIME(6) NOT NULL,
  `completed_at` DATETIME(6) NULL,
  `status` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `input_tokens` INT UNSIGNED NULL,
  `output_tokens` INT UNSIGNED NULL,
  `knowledge_version_ids` JSON NULL,
  `sanitized_tool_results` JSON NULL,
  `error_code` VARCHAR(100) NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_assistant_runs_01` (`clinic_id`, `id`),
  KEY `ix_assistant_runs_01` (`clinic_id`, `conversation_id`),
  CONSTRAINT `ck_assistant_runs_01` CHECK (completed_at IS NULL OR completed_at >= started_at),
  CONSTRAINT `ck_assistant_runs_02` CHECK (`status` IN ('RUNNING','COMPLETED','HANDOFF','FAILED')),
  CONSTRAINT `ck_assistant_runs_03` CHECK (id <> '00000000000000000000000000'),
  CONSTRAINT `ck_assistant_runs_04` CHECK (`knowledge_version_ids` IS NULL OR JSON_TYPE(`knowledge_version_ids`) = 'ARRAY'),
  CONSTRAINT `ck_assistant_runs_05` CHECK (`sanitized_tool_results` IS NULL OR JSON_TYPE(`sanitized_tool_results`) = 'ARRAY')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Audit technique IA minimal, modèle/coût/outils sans dossier médical';

-- Communications et relances : Contrôle DP et anti-no-show PC, canaux/horaires configurés
CREATE TABLE `reminder_policies` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `code` VARCHAR(64) NOT NULL,
  `label` VARCHAR(180) NOT NULL,
  `purpose` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `channel` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `offset_unit` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `offset_value` INT NOT NULL,
  `local_send_time` TIME NULL,
  `active` BOOLEAN NOT NULL DEFAULT 1,
  `version` INT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'Version optimiste, jamais un numéro de pièce',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_reminder_policies_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_reminder_policies_02` (`clinic_id`, `code`),
  CONSTRAINT `ck_reminder_policies_01` CHECK (`purpose` IN ('APPOINTMENT','FOLLOW_UP','ORDER_UPDATE','PAYMENT_FOLLOW_UP')),
  CONSTRAINT `ck_reminder_policies_02` CHECK (`channel` IN ('INTERNAL','CALL','SMS','WHATSAPP')),
  CONSTRAINT `ck_reminder_policies_03` CHECK (`offset_unit` IN ('HOUR','DAY','MONTH')),
  CONSTRAINT `ck_reminder_policies_04` CHECK (`active` IN (0,1)),
  CONSTRAINT `ck_reminder_policies_05` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Contrôle DP et anti-no-show PC, canaux/horaires configurés';

-- Communications et relances : Tâche et échéance uniques avec source typée
CREATE TABLE `contact_tasks` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `patient_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `prospect_contact_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `follow_up_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `appointment_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `invoice_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `workshop_order_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `policy_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `source_version` INT UNSIGNED NOT NULL,
  `due_at` DATETIME(6) NOT NULL,
  `channel` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `status` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `next_attempt_at` DATETIME(6) NULL,
  `assigned_to` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `dedupe_key` VARCHAR(180) NOT NULL,
  `administrative_notes` TEXT NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'Version optimiste, jamais un numéro de pièce',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_contact_tasks_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_contact_tasks_02` (`clinic_id`, `dedupe_key`),
  KEY `ix_contact_tasks_01` (`clinic_id`, `status`, `due_at`),
  KEY `ix_contact_tasks_02` (`clinic_id`, `patient_id`),
  KEY `ix_contact_tasks_03` (`clinic_id`, `prospect_contact_id`),
  KEY `ix_contact_tasks_04` (`clinic_id`, `follow_up_id`),
  KEY `ix_contact_tasks_05` (`clinic_id`, `appointment_id`),
  KEY `ix_contact_tasks_06` (`clinic_id`, `invoice_id`),
  KEY `ix_contact_tasks_07` (`clinic_id`, `workshop_order_id`),
  KEY `ix_contact_tasks_08` (`clinic_id`, `policy_id`),
  KEY `ix_contact_tasks_09` (`clinic_id`, `assigned_to`),
  CONSTRAINT `ck_contact_tasks_01` CHECK ((patient_id IS NOT NULL) + (prospect_contact_id IS NOT NULL) = 1),
  CONSTRAINT `ck_contact_tasks_02` CHECK ((follow_up_id IS NOT NULL) + (appointment_id IS NOT NULL) + (invoice_id IS NOT NULL) + (workshop_order_id IS NOT NULL) = 1),
  CONSTRAINT `ck_contact_tasks_03` CHECK (`channel` IN ('INTERNAL','CALL','SMS','WHATSAPP')),
  CONSTRAINT `ck_contact_tasks_04` CHECK (`status` IN ('PENDING','CONTACTED','BOOKED','NO_RESPONSE','REFUSED','POSTPONED','CANCELLED')),
  CONSTRAINT `ck_contact_tasks_05` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Tâche et échéance uniques avec source typée';

-- Communications et relances : Historique du contact humain ou système
CREATE TABLE `contact_attempts` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `task_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `actor_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `occurred_at` DATETIME(6) NOT NULL,
  `result` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `appointment_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `administrative_note` TEXT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_contact_attempts_01` (`clinic_id`, `id`),
  KEY `ix_contact_attempts_01` (`clinic_id`, `task_id`),
  KEY `ix_contact_attempts_02` (`clinic_id`, `actor_id`),
  KEY `ix_contact_attempts_03` (`clinic_id`, `appointment_id`),
  CONSTRAINT `ck_contact_attempts_01` CHECK (`result` IN ('CONTACTED','BOOKED','NO_RESPONSE','REFUSED','POSTPONED','FAILED')),
  CONSTRAINT `ck_contact_attempts_02` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Historique du contact humain ou système';

-- Communications et relances : Événements consentement/retrait par sujet, numéro précis et finalité
CREATE TABLE `communication_consents` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `patient_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `prospect_contact_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `channel` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `purpose` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `destination_hash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `destination_ciphertext` TEXT NOT NULL,
  `encryption_key_id` VARCHAR(100) NOT NULL,
  `status` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `recorded_at` DATETIME(6) NOT NULL,
  `recorded_by` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `proof` TEXT NOT NULL,
  `policy_version` VARCHAR(64) NOT NULL,
  `event_sequence` BIGINT UNSIGNED NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `subject_key` VARCHAR(28) CHARACTER SET ascii COLLATE ascii_bin GENERATED ALWAYS AS (CASE WHEN patient_id IS NOT NULL THEN CONCAT('P:',patient_id) ELSE CONCAT('C:',prospect_contact_id) END) STORED,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_communication_consents_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_communication_consents_02` (`clinic_id`, `subject_key`, `channel`, `purpose`, `destination_hash`, `event_sequence`),
  KEY `ix_communication_consents_01` (`clinic_id`, `destination_hash`, `channel`, `purpose`, `recorded_at`),
  KEY `ix_communication_consents_02` (`clinic_id`, `patient_id`),
  KEY `ix_communication_consents_03` (`clinic_id`, `prospect_contact_id`),
  KEY `ix_communication_consents_04` (`clinic_id`, `recorded_by`),
  CONSTRAINT `ck_communication_consents_01` CHECK ((patient_id IS NOT NULL) + (prospect_contact_id IS NOT NULL) = 1),
  CONSTRAINT `ck_communication_consents_02` CHECK (event_sequence > 0),
  CONSTRAINT `ck_communication_consents_03` CHECK (`channel` IN ('SMS','WHATSAPP','CALL','EMAIL')),
  CONSTRAINT `ck_communication_consents_04` CHECK (`purpose` IN ('APPOINTMENT','FOLLOW_UP','ORDER_UPDATE','PAYMENT_FOLLOW_UP','MARKETING')),
  CONSTRAINT `ck_communication_consents_05` CHECK (`status` IN ('GRANTED','REVOKED')),
  CONSTRAINT `ck_communication_consents_06` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Événements consentement/retrait par sujet, numéro précis et finalité';

-- Communications et relances : Template administratif ou promotionnel, aucune activation par défaut
CREATE TABLE `message_templates` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `code` VARCHAR(100) NOT NULL,
  `channel` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `purpose` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `active` BOOLEAN NOT NULL DEFAULT 0,
  `version` INT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'Version optimiste, jamais un numéro de pièce',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_message_templates_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_message_templates_02` (`clinic_id`, `code`),
  CONSTRAINT `ck_message_templates_01` CHECK (`channel` IN ('SMS','WHATSAPP','EMAIL')),
  CONSTRAINT `ck_message_templates_02` CHECK (`purpose` IN ('APPOINTMENT','FOLLOW_UP','ORDER_UPDATE','PAYMENT_FOLLOW_UP','MARKETING')),
  CONSTRAINT `ck_message_templates_03` CHECK (`active` IN (0,1)),
  CONSTRAINT `ck_message_templates_04` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Template administratif ou promotionnel, aucune activation par défaut';

-- Communications et relances : Texte et version fournisseur validés, variables autorisées
CREATE TABLE `message_template_versions` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `template_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `integration_account_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `revision_no` INT UNSIGNED NOT NULL,
  `provider_template_id` VARCHAR(180) NULL,
  `language` VARCHAR(10) NOT NULL DEFAULT 'fr',
  `body` TEXT NOT NULL,
  `allowed_variables` JSON NOT NULL,
  `media_file_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `provider_approval_status` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `approved_by` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `approved_at` DATETIME(6) NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_message_template_versions_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_message_template_versions_02` (`clinic_id`, `template_id`, `revision_no`),
  KEY `ix_message_template_versions_01` (`clinic_id`, `integration_account_id`),
  KEY `ix_message_template_versions_02` (`clinic_id`, `media_file_id`),
  KEY `ix_message_template_versions_03` (`clinic_id`, `approved_by`),
  CONSTRAINT `ck_message_template_versions_01` CHECK (revision_no > 0),
  CONSTRAINT `ck_message_template_versions_02` CHECK (`provider_approval_status` IN ('DRAFT','PENDING','APPROVED','REJECTED','PAUSED')),
  CONSTRAINT `ck_message_template_versions_03` CHECK (id <> '00000000000000000000000000'),
  CONSTRAINT `ck_message_template_versions_04` CHECK (`allowed_variables` IS NULL OR JSON_TYPE(`allowed_variables`) = 'ARRAY')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Texte et version fournisseur validés, variables autorisées';

-- Communications et relances : Filtres administratifs ciblés, validés par code et non pathologies
CREATE TABLE `audience_segments` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `name` VARCHAR(180) NOT NULL,
  `criteria` JSON NOT NULL,
  `criteria_schema_version` VARCHAR(64) NOT NULL,
  `created_by` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'Version optimiste, jamais un numéro de pièce',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_audience_segments_01` (`clinic_id`, `id`),
  KEY `ix_audience_segments_01` (`clinic_id`, `created_by`),
  CONSTRAINT `ck_audience_segments_01` CHECK (id <> '00000000000000000000000000'),
  CONSTRAINT `ck_audience_segments_02` CHECK (`criteria` IS NULL OR JSON_TYPE(`criteria`) = 'OBJECT')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Filtres administratifs ciblés, validés par code et non pathologies';

-- Communications et relances : Campagne avec cible figée et autorisation gérante
CREATE TABLE `campaign_definitions` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `name` VARCHAR(180) NOT NULL,
  `segment_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `template_version_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `approval_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `scheduled_at` DATETIME(6) NULL,
  `status` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_by` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `target_frozen_at` DATETIME(6) NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_campaign_definitions_01` (`clinic_id`, `id`),
  KEY `ix_campaign_definitions_01` (`clinic_id`, `segment_id`),
  KEY `ix_campaign_definitions_02` (`clinic_id`, `template_version_id`),
  KEY `ix_campaign_definitions_03` (`clinic_id`, `approval_id`),
  KEY `ix_campaign_definitions_04` (`clinic_id`, `created_by`),
  CONSTRAINT `ck_campaign_definitions_01` CHECK (status NOT IN ('APPROVED','RUNNING','COMPLETED') OR (approval_id IS NOT NULL AND target_frozen_at IS NOT NULL)),
  CONSTRAINT `ck_campaign_definitions_02` CHECK (`status` IN ('DRAFT','APPROVED','RUNNING','COMPLETED','CANCELLED','FAILED')),
  CONSTRAINT `ck_campaign_definitions_03` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Campagne avec cible figée et autorisation gérante';

-- Communications et relances : Destinataire de cible figée, consentement revérifié juste avant envoi
CREATE TABLE `campaign_recipients` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `campaign_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `patient_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `prospect_contact_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `destination_hash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `destination_ciphertext` TEXT NOT NULL,
  `encryption_key_id` VARCHAR(100) NOT NULL,
  `consent_event_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `status` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `exclusion_reason` TEXT NULL,
  `consent_checked_at` DATETIME(6) NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_campaign_recipients_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_campaign_recipients_02` (`clinic_id`, `campaign_id`, `destination_hash`),
  KEY `ix_campaign_recipients_01` (`clinic_id`, `patient_id`),
  KEY `ix_campaign_recipients_02` (`clinic_id`, `prospect_contact_id`),
  KEY `ix_campaign_recipients_03` (`clinic_id`, `consent_event_id`),
  CONSTRAINT `ck_campaign_recipients_01` CHECK ((patient_id IS NOT NULL) + (prospect_contact_id IS NOT NULL) = 1),
  CONSTRAINT `ck_campaign_recipients_02` CHECK (`status` IN ('PENDING','ELIGIBLE','EXCLUDED','SUBMITTED','DELIVERED','FAILED','CANCELLED')),
  CONSTRAINT `ck_campaign_recipients_03` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Destinataire de cible figée, consentement revérifié juste avant envoi';

-- Communications et relances : Tentative avec état fournisseur ; timeout peut rester inconnu
CREATE TABLE `message_attempts` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `task_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `campaign_recipient_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `integration_account_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `template_version_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `consent_event_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `destination_hash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `destination_ciphertext` TEXT NOT NULL,
  `encryption_key_id` VARCHAR(100) NOT NULL,
  `dedupe_key` VARCHAR(180) NOT NULL,
  `provider_message_id` VARCHAR(180) NULL,
  `attempt_no` INT UNSIGNED NOT NULL,
  `status` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `submitted_at` DATETIME(6) NULL,
  `delivered_at` DATETIME(6) NULL,
  `read_at` DATETIME(6) NULL,
  `error_code` VARCHAR(100) NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_message_attempts_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_message_attempts_02` (`clinic_id`, `dedupe_key`, `attempt_no`),
  UNIQUE KEY `uq_message_attempts_03` (`clinic_id`, `integration_account_id`, `provider_message_id`),
  KEY `ix_message_attempts_01` (`clinic_id`, `task_id`),
  KEY `ix_message_attempts_02` (`clinic_id`, `campaign_recipient_id`),
  KEY `ix_message_attempts_03` (`clinic_id`, `template_version_id`),
  KEY `ix_message_attempts_04` (`clinic_id`, `consent_event_id`),
  CONSTRAINT `ck_message_attempts_01` CHECK ((task_id IS NOT NULL) + (campaign_recipient_id IS NOT NULL) = 1),
  CONSTRAINT `ck_message_attempts_02` CHECK (attempt_no > 0),
  CONSTRAINT `ck_message_attempts_03` CHECK (`status` IN ('PLANNED','SUBMITTED','DELIVERED','READ','FAILED','UNKNOWN','CANCELLED')),
  CONSTRAINT `ck_message_attempts_04` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Tentative avec état fournisseur ; timeout peut rester inconnu';

-- Showroom et réservation publique : Description approuvée et filtres publics sans prix achat/stock détaillé
CREATE TABLE `catalog_publications` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `catalog_item_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `slug` VARCHAR(180) NOT NULL,
  `public_title` VARCHAR(180) NOT NULL,
  `public_description` TEXT NOT NULL,
  `style` VARCHAR(100) NULL,
  `show_sale_price` BOOLEAN NOT NULL DEFAULT 0,
  `status` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `display_order` INT NOT NULL DEFAULT 0,
  `approved_by` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `published_at` DATETIME(6) NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'Version optimiste, jamais un numéro de pièce',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_catalog_publications_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_catalog_publications_02` (`clinic_id`, `catalog_item_id`),
  UNIQUE KEY `uq_catalog_publications_03` (`clinic_id`, `slug`),
  KEY `ix_catalog_publications_01` (`clinic_id`, `approved_by`),
  CONSTRAINT `ck_catalog_publications_01` CHECK (status <> 'PUBLISHED' OR (approved_by IS NOT NULL AND published_at IS NOT NULL)),
  CONSTRAINT `ck_catalog_publications_02` CHECK (`show_sale_price` IN (0,1)),
  CONSTRAINT `ck_catalog_publications_03` CHECK (`status` IN ('DRAFT','PUBLISHED','ARCHIVED')),
  CONSTRAINT `ck_catalog_publications_04` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Description approuvée et filtres publics sans prix achat/stock détaillé';

-- Showroom et réservation publique : Images produit validées avec droits et ordre affichage
CREATE TABLE `catalog_media` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `publication_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `file_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `alt_text` VARCHAR(255) NOT NULL,
  `display_order` INT NOT NULL DEFAULT 0,
  `rights_note` TEXT NOT NULL,
  `approved_by` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `approved_at` DATETIME(6) NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_catalog_media_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_catalog_media_02` (`clinic_id`, `publication_id`, `file_id`),
  KEY `ix_catalog_media_01` (`clinic_id`, `file_id`),
  KEY `ix_catalog_media_02` (`clinic_id`, `approved_by`),
  CONSTRAINT `ck_catalog_media_01` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Images produit validées avec droits et ordre affichage';

-- Showroom et réservation publique : Contenu limité vitrine/prestations/coordonnées, pas CMS illimité
CREATE TABLE `public_contents` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `code` VARCHAR(100) NOT NULL,
  `title` VARCHAR(180) NOT NULL,
  `content` TEXT NOT NULL,
  `revision_no` INT UNSIGNED NOT NULL,
  `status` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `approved_by` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `published_at` DATETIME(6) NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'Version optimiste, jamais un numéro de pièce',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_public_contents_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_public_contents_02` (`clinic_id`, `code`, `revision_no`),
  KEY `ix_public_contents_01` (`clinic_id`, `approved_by`),
  CONSTRAINT `ck_public_contents_01` CHECK (revision_no > 0),
  CONSTRAINT `ck_public_contents_02` CHECK (status <> 'PUBLISHED' OR (approved_by IS NOT NULL AND published_at IS NOT NULL)),
  CONSTRAINT `ck_public_contents_03` CHECK (`status` IN ('DRAFT','PUBLISHED','ARCHIVED')),
  CONSTRAINT `ck_public_contents_04` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Contenu limité vitrine/prestations/coordonnées, pas CMS illimité';

-- Showroom et réservation publique : Demande de réservation protégée avant confirmation centrale
CREATE TABLE `public_booking_requests` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `catalog_publication_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `public_reference` VARCHAR(100) NOT NULL,
  `prospect_contact_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `service_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `resource_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `requested_starts_at` DATETIME(6) NOT NULL,
  `requested_ends_at` DATETIME(6) NOT NULL,
  `appointment_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `request_key` VARCHAR(128) NOT NULL,
  `status` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `consent_recorded_at` DATETIME(6) NOT NULL,
  `consent_policy_version` VARCHAR(64) NOT NULL,
  `management_token_hash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `token_expires_at` DATETIME(6) NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_public_booking_requests_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_public_booking_requests_02` (`clinic_id`, `public_reference`),
  UNIQUE KEY `uq_public_booking_requests_03` (`clinic_id`, `request_key`),
  KEY `ix_public_booking_requests_01` (`clinic_id`, `catalog_publication_id`),
  KEY `ix_public_booking_requests_02` (`clinic_id`, `prospect_contact_id`),
  KEY `ix_public_booking_requests_03` (`clinic_id`, `service_id`),
  KEY `ix_public_booking_requests_04` (`clinic_id`, `resource_id`),
  KEY `ix_public_booking_requests_05` (`clinic_id`, `appointment_id`),
  CONSTRAINT `ck_public_booking_requests_01` CHECK (requested_ends_at > requested_starts_at),
  CONSTRAINT `ck_public_booking_requests_02` CHECK (status <> 'CONFIRMED' OR appointment_id IS NOT NULL),
  CONSTRAINT `ck_public_booking_requests_03` CHECK (`status` IN ('RECEIVED','PENDING','CONFIRMED','CONFLICT','CANCELLED','REJECTED')),
  CONSTRAINT `ck_public_booking_requests_04` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Demande de réservation protégée avant confirmation centrale';

-- Hors-ligne et synchronisation : Poste préparé, aucun clone des droits financiers
CREATE TABLE `enrolled_devices` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `device_code` VARCHAR(64) NOT NULL,
  `name` VARCHAR(180) NOT NULL,
  `public_key_jwk` TEXT NOT NULL,
  `key_algorithm` VARCHAR(16) NOT NULL DEFAULT 'ES256',
  `status` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `enrolled_by` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `responsible_user_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `enrolled_at` DATETIME(6) NOT NULL,
  `last_sync_at` DATETIME(6) NULL,
  `last_accepted_sequence` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `last_accepted_hash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `app_version` VARCHAR(64) NOT NULL,
  `replaced_by_device_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_enrolled_devices_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_enrolled_devices_02` (`clinic_id`, `device_code`),
  KEY `ix_enrolled_devices_01` (`clinic_id`, `enrolled_by`),
  KEY `ix_enrolled_devices_02` (`clinic_id`, `responsible_user_id`),
  KEY `ix_enrolled_devices_03` (`clinic_id`, `replaced_by_device_id`),
  CONSTRAINT `ck_enrolled_devices_01` CHECK (key_algorithm = 'ES256'),
  CONSTRAINT `ck_enrolled_devices_02` CHECK (replaced_by_device_id IS NULL OR replaced_by_device_id <> id),
  CONSTRAINT `ck_enrolled_devices_03` CHECK (`status` IN ('ACTIVE','REVOKED','LOST','REPLACED')),
  CONSTRAINT `ck_enrolled_devices_04` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Poste préparé, aucun clone des droits financiers';

-- Hors-ligne et synchronisation : Autorisation signée bornée ; clés privées non présentes dans MySQL
CREATE TABLE `offline_grants` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `device_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `user_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `permissions_snapshot` JSON NOT NULL,
  `rules_version` VARCHAR(64) NOT NULL,
  `catalog_version` VARCHAR(64) NOT NULL,
  `issued_at` DATETIME(6) NOT NULL,
  `valid_until` DATETIME(6) NOT NULL,
  `signed_payload` TEXT NOT NULL,
  `revoked_at` DATETIME(6) NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_offline_grants_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_offline_grants_02` (`clinic_id`, `id`, `device_id`, `user_id`),
  UNIQUE KEY `uq_offline_grants_03` (`clinic_id`, `id`, `device_id`),
  KEY `ix_offline_grants_01` (`clinic_id`, `device_id`),
  KEY `ix_offline_grants_02` (`clinic_id`, `user_id`),
  CONSTRAINT `ck_offline_grants_01` CHECK (valid_until > issued_at),
  CONSTRAINT `ck_offline_grants_02` CHECK (id <> '00000000000000000000000000'),
  CONSTRAINT `ck_offline_grants_03` CHECK (`permissions_snapshot` IS NULL OR JSON_TYPE(`permissions_snapshot`) = 'ARRAY')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Autorisation signée bornée ; clés privées non présentes dans MySQL';

-- Hors-ligne et synchronisation : Plages pré-allouées disjointes, pas de libération automatique
CREATE TABLE `document_number_allocations` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `device_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `grant_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `document_type` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `document_year` SMALLINT UNSIGNED NOT NULL,
  `range_start` BIGINT UNSIGNED NOT NULL,
  `range_end` BIGINT UNSIGNED NOT NULL,
  `last_consumed_value` BIGINT UNSIGNED NULL,
  `status` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `allocated_at` DATETIME(6) NOT NULL,
  `closed_at` DATETIME(6) NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'Version optimiste, jamais un numéro de pièce',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_document_number_allocations_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_document_number_allocations_02` (`clinic_id`, `document_type`, `document_year`, `range_start`),
  UNIQUE KEY `uq_document_number_allocations_03` (`clinic_id`, `id`, `document_type`, `document_year`),
  KEY `ix_document_number_allocations_01` (`clinic_id`, `grant_id`, `device_id`),
  KEY `ix_document_number_allocations_02` (`clinic_id`, `device_id`),
  CONSTRAINT `ck_document_number_allocations_01` CHECK (range_start > 0),
  CONSTRAINT `ck_document_number_allocations_02` CHECK (range_end >= range_start),
  CONSTRAINT `ck_document_number_allocations_03` CHECK (document_year BETWEEN 2000 AND 9999),
  CONSTRAINT `ck_document_number_allocations_04` CHECK (last_consumed_value IS NULL OR last_consumed_value BETWEEN range_start AND range_end),
  CONSTRAINT `ck_document_number_allocations_05` CHECK (status <> 'CLOSED' OR closed_at IS NOT NULL),
  CONSTRAINT `ck_document_number_allocations_06` CHECK (`document_type` IN ('PATIENT','INVOICE','RECEIPT','CREDIT_NOTE','REFUND','LEGACY_BALANCE','QUOTE','WORKSHOP')),
  CONSTRAINT `ck_document_number_allocations_07` CHECK (`status` IN ('ACTIVE','CLOSING','CLOSED')),
  CONSTRAINT `ck_document_number_allocations_08` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Plages pré-allouées disjointes, pas de libération automatique';

-- Hors-ligne et synchronisation : Un seul propriétaire financier, clôture après ACK de toutes commandes
CREATE TABLE `invoice_write_owners` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `invoice_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `device_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `epoch` INT UNSIGNED NOT NULL,
  `status` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `granted_at` DATETIME(6) NOT NULL,
  `closed_at` DATETIME(6) NULL,
  `final_device_sequence` BIGINT UNSIGNED NULL,
  `active_invoice_key` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin GENERATED ALWAYS AS (CASE WHEN status IN ('ACTIVE','CLOSING') THEN invoice_id ELSE NULL END) STORED,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_invoice_write_owners_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_invoice_write_owners_02` (`clinic_id`, `invoice_id`, `epoch`),
  UNIQUE KEY `uq_invoice_write_owners_03` (`clinic_id`, `active_invoice_key`),
  KEY `ix_invoice_write_owners_01` (`clinic_id`, `device_id`),
  CONSTRAINT `ck_invoice_write_owners_01` CHECK (epoch > 0),
  CONSTRAINT `ck_invoice_write_owners_02` CHECK (status <> 'CLOSED' OR (closed_at IS NOT NULL AND final_device_sequence IS NOT NULL)),
  CONSTRAINT `ck_invoice_write_owners_03` CHECK (`status` IN ('ACTIVE','CLOSING','CLOSED')),
  CONSTRAINT `ck_invoice_write_owners_04` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Un seul propriétaire financier, clôture après ACK de toutes commandes';

-- Hors-ligne et synchronisation : Quota exclusif article/lot, réserve locale incluse dans quota restant
CREATE TABLE `device_stock_allocations` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `device_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `stock_position_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `stock_lot_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `allocated_quantity` DECIMAL(12,3) NOT NULL,
  `consumed_quantity` DECIMAL(12,3) NOT NULL DEFAULT 0,
  `returned_quantity` DECIMAL(12,3) NOT NULL DEFAULT 0,
  `status` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `allocated_at` DATETIME(6) NOT NULL,
  `closed_at` DATETIME(6) NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'Version optimiste, jamais un numéro de pièce',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `lot_key` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin GENERATED ALWAYS AS (COALESCE(stock_lot_id,'00000000000000000000000000')) STORED,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_device_stock_allocations_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_device_stock_allocations_02` (`clinic_id`, `id`, `stock_position_id`),
  UNIQUE KEY `uq_device_stock_allocations_03` (`clinic_id`, `id`, `stock_position_id`, `lot_key`),
  KEY `ix_device_stock_allocations_01` (`clinic_id`, `stock_lot_id`, `stock_position_id`),
  KEY `ix_device_stock_allocations_02` (`clinic_id`, `device_id`),
  KEY `ix_device_stock_allocations_03` (`clinic_id`, `stock_position_id`),
  CONSTRAINT `ck_device_stock_allocations_01` CHECK (allocated_quantity > 0),
  CONSTRAINT `ck_device_stock_allocations_02` CHECK (consumed_quantity >= 0),
  CONSTRAINT `ck_device_stock_allocations_03` CHECK (returned_quantity >= 0),
  CONSTRAINT `ck_device_stock_allocations_04` CHECK (consumed_quantity + returned_quantity <= allocated_quantity),
  CONSTRAINT `ck_device_stock_allocations_05` CHECK (status <> 'CLOSED' OR (closed_at IS NOT NULL AND consumed_quantity + returned_quantity = allocated_quantity)),
  CONSTRAINT `ck_device_stock_allocations_06` CHECK (`status` IN ('ACTIVE','CLOSING','CLOSED')),
  CONSTRAINT `ck_device_stock_allocations_07` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Quota exclusif article/lot, réserve locale incluse dans quota restant';

-- Hors-ligne et synchronisation : Commande immuable reçue ; état de traitement dans table séparée
CREATE TABLE `sync_commands` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `device_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `actor_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `grant_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `device_sequence` BIGINT UNSIGNED NOT NULL,
  `previous_event_hash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `event_hash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `signature` TEXT NOT NULL,
  `schema_version` VARCHAR(64) NOT NULL,
  `rules_version` VARCHAR(64) NOT NULL,
  `command_name` VARCHAR(100) NOT NULL,
  `occurred_at_local` DATETIME(6) NOT NULL,
  `last_server_time` DATETIME(6) NOT NULL,
  `entity_type` VARCHAR(64) NOT NULL,
  `entity_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `expected_version` INT UNSIGNED NULL,
  `number_allocation_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `payload_ciphertext` TEXT NOT NULL,
  `encryption_key_id` VARCHAR(100) NOT NULL,
  `received_at` DATETIME(6) NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_sync_commands_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_sync_commands_02` (`clinic_id`, `device_id`, `device_sequence`),
  KEY `ix_sync_commands_01` (`clinic_id`, `grant_id`, `device_id`, `actor_id`),
  KEY `ix_sync_commands_02` (`clinic_id`, `actor_id`),
  KEY `ix_sync_commands_03` (`clinic_id`, `number_allocation_id`),
  CONSTRAINT `ck_sync_commands_01` CHECK (device_sequence > 0),
  CONSTRAINT `ck_sync_commands_02` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Commande immuable reçue ; état de traitement dans table séparée';

-- Hors-ligne et synchronisation : ACK durable ou litige ; commande originale jamais écrasée
CREATE TABLE `sync_command_results` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `command_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `status` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `result_references` JSON NULL,
  `error_code` VARCHAR(100) NULL,
  `processed_at` DATETIME(6) NULL,
  `attempt_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_sync_command_results_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_sync_command_results_02` (`clinic_id`, `command_id`),
  CONSTRAINT `ck_sync_command_results_01` CHECK (`status` IN ('RECEIVED','ACCEPTED','WAITING_DEPENDENCY','CONFLICT_REQUIRES_REVIEW','REJECTED')),
  CONSTRAINT `ck_sync_command_results_02` CHECK (id <> '00000000000000000000000000'),
  CONSTRAINT `ck_sync_command_results_03` CHECK (`result_references` IS NULL OR JSON_TYPE(`result_references`) = 'OBJECT')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='ACK durable ou litige ; commande originale jamais écrasée';

-- Hors-ligne et synchronisation : Versions en conflit et résolution explicite avec pièces conservées
CREATE TABLE `sync_conflicts` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `command_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `conflict_type` VARCHAR(100) NOT NULL,
  `local_snapshot_ciphertext` TEXT NOT NULL,
  `central_snapshot_ciphertext` TEXT NOT NULL,
  `encryption_key_id` VARCHAR(100) NOT NULL,
  `status` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `resolution` TEXT NULL,
  `resolved_by` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `resolved_at` DATETIME(6) NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_sync_conflicts_01` (`clinic_id`, `id`),
  KEY `ix_sync_conflicts_01` (`clinic_id`, `command_id`),
  KEY `ix_sync_conflicts_02` (`clinic_id`, `resolved_by`),
  CONSTRAINT `ck_sync_conflicts_01` CHECK (status <> 'RESOLVED' OR (resolution IS NOT NULL AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL)),
  CONSTRAINT `ck_sync_conflicts_02` CHECK (`status` IN ('OPEN','RESOLVED')),
  CONSTRAINT `ck_sync_conflicts_03` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Versions en conflit et résolution explicite avec pièces conservées';

-- Hors-ligne et synchronisation : Journal de changement serveur pour pull paginé filtré par Policy
CREATE TABLE `sync_change_log` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `change_sequence` BIGINT UNSIGNED AUTO_INCREMENT NOT NULL,
  `entity_type` VARCHAR(64) NOT NULL,
  `entity_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `entity_version` INT UNSIGNED NOT NULL,
  `recorded_at` DATETIME(6) NOT NULL,
  `visibility` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `change_kind` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_sync_change_log_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_sync_change_log_02` (`change_sequence`),
  CONSTRAINT `ck_sync_change_log_01` CHECK (`visibility` IN ('ADMINISTRATIVE','CLINICAL','FINANCIAL','MANAGER','PUBLIC')),
  CONSTRAINT `ck_sync_change_log_02` CHECK (`change_kind` IN ('CREATED','UPDATED','ARCHIVED')),
  CONSTRAINT `ck_sync_change_log_03` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Journal de changement serveur pour pull paginé filtré par Policy';

-- Documents et exploitation : Source typée et fichier original privé à chaque version
CREATE TABLE `generated_documents` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `document_type` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `invoice_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `receipt_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `credit_note_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `refund_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `prescription_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `clinical_revision_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `workshop_order_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `patient_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `quote_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `source_key` VARCHAR(100) NOT NULL,
  `revision_no` INT UNSIGNED NOT NULL,
  `template_version` VARCHAR(64) NOT NULL,
  `file_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `sha256` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `status` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `generated_at` DATETIME(6) NULL,
  `failure_code` VARCHAR(100) NULL,
  `source_device_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_generated_documents_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_generated_documents_02` (`clinic_id`, `document_type`, `source_key`, `revision_no`, `template_version`),
  KEY `ix_generated_documents_01` (`clinic_id`, `invoice_id`),
  KEY `ix_generated_documents_02` (`clinic_id`, `receipt_id`),
  KEY `ix_generated_documents_03` (`clinic_id`, `credit_note_id`),
  KEY `ix_generated_documents_04` (`clinic_id`, `refund_id`),
  KEY `ix_generated_documents_05` (`clinic_id`, `prescription_id`),
  KEY `ix_generated_documents_06` (`clinic_id`, `clinical_revision_id`),
  KEY `ix_generated_documents_07` (`clinic_id`, `workshop_order_id`),
  KEY `ix_generated_documents_08` (`clinic_id`, `patient_id`),
  KEY `ix_generated_documents_09` (`clinic_id`, `quote_id`),
  KEY `ix_generated_documents_10` (`clinic_id`, `file_id`),
  KEY `ix_generated_documents_11` (`clinic_id`, `source_device_id`),
  CONSTRAINT `ck_generated_documents_01` CHECK ((invoice_id IS NOT NULL) + (receipt_id IS NOT NULL) + (credit_note_id IS NOT NULL) + (refund_id IS NOT NULL) + (prescription_id IS NOT NULL) + (clinical_revision_id IS NOT NULL) + (workshop_order_id IS NOT NULL) + (patient_id IS NOT NULL) + (quote_id IS NOT NULL) = 1),
  CONSTRAINT `ck_generated_documents_02` CHECK (status <> 'READY' OR (file_id IS NOT NULL AND sha256 IS NOT NULL AND generated_at IS NOT NULL)),
  CONSTRAINT `ck_generated_documents_03` CHECK (`document_type` IN ('INVOICE','RECEIPT','CREDIT_NOTE','REFUND','OPTICAL_PRESCRIPTION','CLINICAL_RECORD','WORKSHOP','ACCOUNT_STATEMENT','LEGACY_BALANCE','QUOTE')),
  CONSTRAINT `ck_generated_documents_04` CHECK (`status` IN ('PENDING','READY','FAILED')),
  CONSTRAINT `ck_generated_documents_05` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Source typée et fichier original privé à chaque version';

-- Documents et exploitation : Export contrôlé de données/archives, jamais fichier public par défaut
CREATE TABLE `export_requests` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `requested_by` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `export_type` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `patient_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `filters` JSON NULL,
  `status` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `file_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `completed_at` DATETIME(6) NULL,
  `expires_at` DATETIME(6) NULL,
  `error_code` VARCHAR(100) NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_export_requests_01` (`clinic_id`, `id`),
  KEY `ix_export_requests_01` (`clinic_id`, `requested_by`),
  KEY `ix_export_requests_02` (`clinic_id`, `patient_id`),
  KEY `ix_export_requests_03` (`clinic_id`, `file_id`),
  CONSTRAINT `ck_export_requests_01` CHECK (export_type <> 'PATIENT_RECORD' OR patient_id IS NOT NULL),
  CONSTRAINT `ck_export_requests_02` CHECK (status <> 'READY' OR (file_id IS NOT NULL AND completed_at IS NOT NULL)),
  CONSTRAINT `ck_export_requests_03` CHECK (`export_type` IN ('PATIENT_RECORD','PATIENTS','FINANCE','STOCK','FULL_HANDOVER')),
  CONSTRAINT `ck_export_requests_04` CHECK (`status` IN ('REQUESTED','PROCESSING','READY','FAILED','EXPIRED')),
  CONSTRAINT `ck_export_requests_05` CHECK (id <> '00000000000000000000000000'),
  CONSTRAINT `ck_export_requests_06` CHECK (`filters` IS NULL OR JSON_TYPE(`filters`) = 'OBJECT')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Export contrôlé de données/archives, jamais fichier public par défaut';

-- Documents et exploitation : Journal de backup, pas la sauvegarde elle-même
CREATE TABLE `backup_runs` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `scope` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `device_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `started_at` DATETIME(6) NOT NULL,
  `completed_at` DATETIME(6) NULL,
  `status` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `private_destination` VARCHAR(500) NULL,
  `sha256` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `size_bytes` BIGINT UNSIGNED NULL,
  `encryption_key_id` VARCHAR(100) NULL,
  `error_code` VARCHAR(100) NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_backup_runs_01` (`clinic_id`, `id`),
  KEY `ix_backup_runs_01` (`clinic_id`, `device_id`),
  CONSTRAINT `ck_backup_runs_01` CHECK (scope <> 'OFFLINE_UNSYNCED' OR device_id IS NOT NULL),
  CONSTRAINT `ck_backup_runs_02` CHECK (status <> 'SUCCEEDED' OR (completed_at IS NOT NULL AND private_destination IS NOT NULL AND sha256 IS NOT NULL AND encryption_key_id IS NOT NULL)),
  CONSTRAINT `ck_backup_runs_03` CHECK (`scope` IN ('SERVER_DATABASE','SERVER_FILES','OFFLINE_UNSYNCED')),
  CONSTRAINT `ck_backup_runs_04` CHECK (`status` IN ('RUNNING','SUCCEEDED','FAILED')),
  CONSTRAINT `ck_backup_runs_05` CHECK (id <> '00000000000000000000000000')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Journal de backup, pas la sauvegarde elle-même';

-- Documents et exploitation : Preuve de restauration serveur ou poste, contrôles et durée
CREATE TABLE `restore_tests` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `backup_run_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `started_at` DATETIME(6) NOT NULL,
  `completed_at` DATETIME(6) NULL,
  `status` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `tested_by` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `checks` JSON NULL,
  `observations` TEXT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_restore_tests_01` (`clinic_id`, `id`),
  KEY `ix_restore_tests_01` (`clinic_id`, `backup_run_id`),
  KEY `ix_restore_tests_02` (`clinic_id`, `tested_by`),
  CONSTRAINT `ck_restore_tests_01` CHECK (completed_at IS NULL OR completed_at >= started_at),
  CONSTRAINT `ck_restore_tests_02` CHECK (`status` IN ('RUNNING','PASSED','FAILED')),
  CONSTRAINT `ck_restore_tests_03` CHECK (id <> '00000000000000000000000000'),
  CONSTRAINT `ck_restore_tests_04` CHECK (`checks` IS NULL OR JSON_TYPE(`checks`) = 'OBJECT')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Preuve de restauration serveur ou poste, contrôles et durée';

-- Catalogue et facturation : Version figée d’un devis remis ou corrigé
CREATE TABLE `quote_revisions` (
  `id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clinic_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `quote_id` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `revision_no` INT UNSIGNED NOT NULL,
  `snapshot` JSON NOT NULL COMMENT 'Données figées de la pièce ou révision',
  `authored_by` CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `recorded_at` DATETIME(6) NOT NULL,
  `reason` TEXT NOT NULL COMMENT 'Motif obligatoire de l’opération',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_quote_revisions_01` (`clinic_id`, `id`),
  UNIQUE KEY `uq_quote_revisions_02` (`clinic_id`, `quote_id`, `revision_no`),
  KEY `ix_quote_revisions_01` (`clinic_id`, `authored_by`),
  CONSTRAINT `ck_quote_revisions_01` CHECK (revision_no > 0),
  CONSTRAINT `ck_quote_revisions_02` CHECK (id <> '00000000000000000000000000'),
  CONSTRAINT `ck_quote_revisions_03` CHECK (`snapshot` IS NULL OR JSON_TYPE(`snapshot`) = 'OBJECT')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Version figée d’un devis remis ou corrigé';

-- Foreign keys: default NO ACTION/RESTRICT, never cascade business history.
ALTER TABLE `role_permissions`
  ADD CONSTRAINT `fk_role_permissions_01` FOREIGN KEY (`role_code`) REFERENCES `roles` (`code`),
  ADD CONSTRAINT `fk_role_permissions_02` FOREIGN KEY (`permission_code`) REFERENCES `permissions` (`code`);

ALTER TABLE `users`
  ADD CONSTRAINT `fk_users_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`);

ALTER TABLE `user_roles`
  ADD CONSTRAINT `fk_user_roles_01` FOREIGN KEY (`role_code`) REFERENCES `roles` (`code`),
  ADD CONSTRAINT `fk_user_roles_02` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_user_roles_03` FOREIGN KEY (`clinic_id`, `user_id`) REFERENCES `users` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_user_roles_04` FOREIGN KEY (`clinic_id`, `assigned_by`) REFERENCES `users` (`clinic_id`, `id`);

ALTER TABLE `user_permissions`
  ADD CONSTRAINT `fk_user_permissions_01` FOREIGN KEY (`permission_code`) REFERENCES `permissions` (`code`),
  ADD CONSTRAINT `fk_user_permissions_02` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_user_permissions_03` FOREIGN KEY (`clinic_id`, `user_id`) REFERENCES `users` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_user_permissions_04` FOREIGN KEY (`clinic_id`, `assigned_by`) REFERENCES `users` (`clinic_id`, `id`);

ALTER TABLE `stored_files`
  ADD CONSTRAINT `fk_stored_files_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_stored_files_02` FOREIGN KEY (`clinic_id`, `uploaded_by`) REFERENCES `users` (`clinic_id`, `id`);

ALTER TABLE `approvals`
  ADD CONSTRAINT `fk_approvals_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_approvals_02` FOREIGN KEY (`clinic_id`, `requested_by`) REFERENCES `users` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_approvals_03` FOREIGN KEY (`clinic_id`, `decided_by`) REFERENCES `users` (`clinic_id`, `id`);

ALTER TABLE `audit_events`
  ADD CONSTRAINT `fk_audit_events_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_audit_events_02` FOREIGN KEY (`clinic_id`, `actor_id`) REFERENCES `users` (`clinic_id`, `id`);

ALTER TABLE `idempotency_requests`
  ADD CONSTRAINT `fk_idempotency_requests_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`);

ALTER TABLE `patient_records`
  ADD CONSTRAINT `fk_patient_records_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_patient_records_02` FOREIGN KEY (`clinic_id`, `merged_into_patient_id`) REFERENCES `patient_records` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_patient_records_03` FOREIGN KEY (`clinic_id`, `created_by`) REFERENCES `users` (`clinic_id`, `id`);

ALTER TABLE `patient_merges`
  ADD CONSTRAINT `fk_patient_merges_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_patient_merges_02` FOREIGN KEY (`clinic_id`, `source_patient_id`) REFERENCES `patient_records` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_patient_merges_03` FOREIGN KEY (`clinic_id`, `survivor_patient_id`) REFERENCES `patient_records` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_patient_merges_04` FOREIGN KEY (`clinic_id`, `approved_by`) REFERENCES `users` (`clinic_id`, `id`);

ALTER TABLE `prospect_contacts`
  ADD CONSTRAINT `fk_prospect_contacts_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_prospect_contacts_02` FOREIGN KEY (`clinic_id`, `patient_id`) REFERENCES `patient_records` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_prospect_contacts_03` FOREIGN KEY (`clinic_id`, `created_by`) REFERENCES `users` (`clinic_id`, `id`);

ALTER TABLE `scheduling_resources`
  ADD CONSTRAINT `fk_scheduling_resources_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_scheduling_resources_02` FOREIGN KEY (`clinic_id`, `professional_user_id`) REFERENCES `users` (`clinic_id`, `id`);

ALTER TABLE `appointment_services`
  ADD CONSTRAINT `fk_appointment_services_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_appointment_services_02` FOREIGN KEY (`clinic_id`, `catalog_item_id`) REFERENCES `catalog_items` (`clinic_id`, `id`);

ALTER TABLE `resource_opening_hours`
  ADD CONSTRAINT `fk_resource_opening_hours_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_resource_opening_hours_02` FOREIGN KEY (`clinic_id`, `resource_id`) REFERENCES `scheduling_resources` (`clinic_id`, `id`);

ALTER TABLE `resource_exceptions`
  ADD CONSTRAINT `fk_resource_exceptions_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_resource_exceptions_02` FOREIGN KEY (`clinic_id`, `resource_id`) REFERENCES `scheduling_resources` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_resource_exceptions_03` FOREIGN KEY (`clinic_id`, `created_by`) REFERENCES `users` (`clinic_id`, `id`);

ALTER TABLE `appointments`
  ADD CONSTRAINT `fk_appointments_01` FOREIGN KEY (`clinic_id`, `follow_up_id`, `patient_id`) REFERENCES `follow_up_plans` (`clinic_id`, `id`, `patient_id`),
  ADD CONSTRAINT `fk_appointments_02` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_appointments_03` FOREIGN KEY (`clinic_id`, `patient_id`) REFERENCES `patient_records` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_appointments_04` FOREIGN KEY (`clinic_id`, `prospect_contact_id`) REFERENCES `prospect_contacts` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_appointments_05` FOREIGN KEY (`clinic_id`, `follow_up_id`) REFERENCES `follow_up_plans` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_appointments_06` FOREIGN KEY (`clinic_id`, `resource_id`) REFERENCES `scheduling_resources` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_appointments_07` FOREIGN KEY (`clinic_id`, `service_id`) REFERENCES `appointment_services` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_appointments_08` FOREIGN KEY (`clinic_id`, `created_by`) REFERENCES `users` (`clinic_id`, `id`);

ALTER TABLE `calendar_blocks`
  ADD CONSTRAINT `fk_calendar_blocks_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_calendar_blocks_02` FOREIGN KEY (`clinic_id`, `resource_id`) REFERENCES `scheduling_resources` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_calendar_blocks_03` FOREIGN KEY (`clinic_id`, `external_link_id`) REFERENCES `external_links` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_calendar_blocks_04` FOREIGN KEY (`clinic_id`, `created_by`) REFERENCES `users` (`clinic_id`, `id`);

ALTER TABLE `visits`
  ADD CONSTRAINT `fk_visits_01` FOREIGN KEY (`clinic_id`, `exam_invoice_id`, `id`, `patient_id`) REFERENCES `invoices` (`clinic_id`, `id`, `visit_id`, `patient_id`),
  ADD CONSTRAINT `fk_visits_02` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_visits_03` FOREIGN KEY (`clinic_id`, `patient_id`) REFERENCES `patient_records` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_visits_04` FOREIGN KEY (`clinic_id`, `appointment_id`) REFERENCES `appointments` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_visits_05` FOREIGN KEY (`clinic_id`, `exam_invoice_id`) REFERENCES `invoices` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_visits_06` FOREIGN KEY (`clinic_id`, `exam_waiver_approval_id`) REFERENCES `approvals` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_visits_07` FOREIGN KEY (`clinic_id`, `created_by`) REFERENCES `users` (`clinic_id`, `id`);

ALTER TABLE `consultations`
  ADD CONSTRAINT `fk_consultations_01` FOREIGN KEY (`clinic_id`, `visit_id`, `patient_id`) REFERENCES `visits` (`clinic_id`, `id`, `patient_id`),
  ADD CONSTRAINT `fk_consultations_02` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_consultations_03` FOREIGN KEY (`clinic_id`, `visit_id`) REFERENCES `visits` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_consultations_04` FOREIGN KEY (`clinic_id`, `patient_id`) REFERENCES `patient_records` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_consultations_05` FOREIGN KEY (`clinic_id`, `clinician_id`) REFERENCES `users` (`clinic_id`, `id`);

ALTER TABLE `consultation_complaints`
  ADD CONSTRAINT `fk_consultation_complaints_01` FOREIGN KEY (`term_group`, `term_code`) REFERENCES `clinical_terms` (`group_code`, `code`),
  ADD CONSTRAINT `fk_consultation_complaints_02` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_consultation_complaints_03` FOREIGN KEY (`clinic_id`, `consultation_id`) REFERENCES `consultations` (`clinic_id`, `id`);

ALTER TABLE `consultation_histories`
  ADD CONSTRAINT `fk_consultation_histories_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_consultation_histories_02` FOREIGN KEY (`clinic_id`, `consultation_id`) REFERENCES `consultations` (`clinic_id`, `id`);

ALTER TABLE `consultation_history_terms`
  ADD CONSTRAINT `fk_consultation_history_terms_01` FOREIGN KEY (`clinic_id`, `history_id`, `term_group`) REFERENCES `consultation_histories` (`clinic_id`, `id`, `history_group`),
  ADD CONSTRAINT `fk_consultation_history_terms_02` FOREIGN KEY (`term_group`, `term_code`) REFERENCES `clinical_terms` (`group_code`, `code`),
  ADD CONSTRAINT `fk_consultation_history_terms_03` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_consultation_history_terms_04` FOREIGN KEY (`clinic_id`, `history_id`) REFERENCES `consultation_histories` (`clinic_id`, `id`);

ALTER TABLE `consultation_ametropias`
  ADD CONSTRAINT `fk_consultation_ametropias_01` FOREIGN KEY (`term_group`, `term_code`) REFERENCES `clinical_terms` (`group_code`, `code`),
  ADD CONSTRAINT `fk_consultation_ametropias_02` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_consultation_ametropias_03` FOREIGN KEY (`clinic_id`, `consultation_id`) REFERENCES `consultations` (`clinic_id`, `id`);

ALTER TABLE `consultation_referral_reasons`
  ADD CONSTRAINT `fk_consultation_referral_reasons_01` FOREIGN KEY (`term_group`, `term_code`) REFERENCES `clinical_terms` (`group_code`, `code`),
  ADD CONSTRAINT `fk_consultation_referral_reasons_02` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_consultation_referral_reasons_03` FOREIGN KEY (`clinic_id`, `consultation_id`) REFERENCES `consultations` (`clinic_id`, `id`);

ALTER TABLE `visual_acuity_scales`
  ADD CONSTRAINT `fk_visual_acuity_scales_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`);

ALTER TABLE `visual_acuities`
  ADD CONSTRAINT `fk_visual_acuities_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_visual_acuities_02` FOREIGN KEY (`clinic_id`, `consultation_id`) REFERENCES `consultations` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_visual_acuities_03` FOREIGN KEY (`clinic_id`, `scale_id`) REFERENCES `visual_acuity_scales` (`clinic_id`, `id`);

ALTER TABLE `refraction_measurements`
  ADD CONSTRAINT `fk_refraction_measurements_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_refraction_measurements_02` FOREIGN KEY (`clinic_id`, `consultation_id`) REFERENCES `consultations` (`clinic_id`, `id`);

ALTER TABLE `autorefractor_centering`
  ADD CONSTRAINT `fk_autorefractor_centering_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_autorefractor_centering_02` FOREIGN KEY (`clinic_id`, `consultation_id`) REFERENCES `consultations` (`clinic_id`, `id`);

ALTER TABLE `clinical_revisions`
  ADD CONSTRAINT `fk_clinical_revisions_01` FOREIGN KEY (`clinic_id`, `previous_revision_id`, `consultation_id`) REFERENCES `clinical_revisions` (`clinic_id`, `id`, `consultation_id`),
  ADD CONSTRAINT `fk_clinical_revisions_02` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_clinical_revisions_03` FOREIGN KEY (`clinic_id`, `consultation_id`) REFERENCES `consultations` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_clinical_revisions_04` FOREIGN KEY (`clinic_id`, `author_id`) REFERENCES `users` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_clinical_revisions_05` FOREIGN KEY (`clinic_id`, `previous_revision_id`) REFERENCES `clinical_revisions` (`clinic_id`, `id`);

ALTER TABLE `optical_prescriptions`
  ADD CONSTRAINT `fk_optical_prescriptions_01` FOREIGN KEY (`usage_group`, `usage_code`) REFERENCES `clinical_terms` (`group_code`, `code`),
  ADD CONSTRAINT `fk_optical_prescriptions_02` FOREIGN KEY (`lens_type_group`, `lens_type_code`) REFERENCES `clinical_terms` (`group_code`, `code`),
  ADD CONSTRAINT `fk_optical_prescriptions_03` FOREIGN KEY (`clinic_id`, `supersedes_id`, `consultation_id`) REFERENCES `optical_prescriptions` (`clinic_id`, `id`, `consultation_id`),
  ADD CONSTRAINT `fk_optical_prescriptions_04` FOREIGN KEY (`clinic_id`, `consultation_id`, `patient_id`) REFERENCES `consultations` (`clinic_id`, `id`, `patient_id`),
  ADD CONSTRAINT `fk_optical_prescriptions_05` FOREIGN KEY (`clinic_id`, `supersedes_id`, `patient_id`, `series_id`) REFERENCES `optical_prescriptions` (`clinic_id`, `id`, `patient_id`, `series_id`),
  ADD CONSTRAINT `fk_optical_prescriptions_06` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_optical_prescriptions_07` FOREIGN KEY (`clinic_id`, `patient_id`) REFERENCES `patient_records` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_optical_prescriptions_08` FOREIGN KEY (`clinic_id`, `external_file_id`) REFERENCES `stored_files` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_optical_prescriptions_09` FOREIGN KEY (`clinic_id`, `consultation_id`) REFERENCES `consultations` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_optical_prescriptions_10` FOREIGN KEY (`clinic_id`, `validated_by`) REFERENCES `users` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_optical_prescriptions_11` FOREIGN KEY (`clinic_id`, `supersedes_id`) REFERENCES `optical_prescriptions` (`clinic_id`, `id`);

ALTER TABLE `optical_prescription_eyes`
  ADD CONSTRAINT `fk_optical_prescription_eyes_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_optical_prescription_eyes_02` FOREIGN KEY (`clinic_id`, `prescription_id`) REFERENCES `optical_prescriptions` (`clinic_id`, `id`);

ALTER TABLE `optical_prescription_treatments`
  ADD CONSTRAINT `fk_optical_prescription_treatments_01` FOREIGN KEY (`term_group`, `term_code`) REFERENCES `clinical_terms` (`group_code`, `code`),
  ADD CONSTRAINT `fk_optical_prescription_treatments_02` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_optical_prescription_treatments_03` FOREIGN KEY (`clinic_id`, `prescription_id`) REFERENCES `optical_prescriptions` (`clinic_id`, `id`);

ALTER TABLE `medication_orders`
  ADD CONSTRAINT `fk_medication_orders_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_medication_orders_02` FOREIGN KEY (`clinic_id`, `consultation_id`) REFERENCES `consultations` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_medication_orders_03` FOREIGN KEY (`clinic_id`, `catalog_item_id`) REFERENCES `catalog_items` (`clinic_id`, `id`);

ALTER TABLE `follow_up_plans`
  ADD CONSTRAINT `fk_follow_up_plans_01` FOREIGN KEY (`clinic_id`, `consultation_id`, `patient_id`) REFERENCES `consultations` (`clinic_id`, `id`, `patient_id`),
  ADD CONSTRAINT `fk_follow_up_plans_02` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_follow_up_plans_03` FOREIGN KEY (`clinic_id`, `consultation_id`) REFERENCES `consultations` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_follow_up_plans_04` FOREIGN KEY (`clinic_id`, `patient_id`) REFERENCES `patient_records` (`clinic_id`, `id`);

ALTER TABLE `tax_rules`
  ADD CONSTRAINT `fk_tax_rules_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_tax_rules_02` FOREIGN KEY (`clinic_id`, `validated_by`) REFERENCES `users` (`clinic_id`, `id`);

ALTER TABLE `catalog_items`
  ADD CONSTRAINT `fk_catalog_items_01` FOREIGN KEY (`category_code`) REFERENCES `catalog_categories` (`code`),
  ADD CONSTRAINT `fk_catalog_items_02` FOREIGN KEY (`unit_code`) REFERENCES `units` (`code`),
  ADD CONSTRAINT `fk_catalog_items_03` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_catalog_items_04` FOREIGN KEY (`clinic_id`, `tax_rule_id`) REFERENCES `tax_rules` (`clinic_id`, `id`);

ALTER TABLE `quotes`
  ADD CONSTRAINT `fk_quotes_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_quotes_02` FOREIGN KEY (`clinic_id`, `patient_id`) REFERENCES `patient_records` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_quotes_03` FOREIGN KEY (`clinic_id`, `prospect_contact_id`) REFERENCES `prospect_contacts` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_quotes_04` FOREIGN KEY (`clinic_id`, `created_by`) REFERENCES `users` (`clinic_id`, `id`);

ALTER TABLE `quote_lines`
  ADD CONSTRAINT `fk_quote_lines_01` FOREIGN KEY (`unit_code`) REFERENCES `units` (`code`),
  ADD CONSTRAINT `fk_quote_lines_02` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_quote_lines_03` FOREIGN KEY (`clinic_id`, `quote_id`) REFERENCES `quotes` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_quote_lines_04` FOREIGN KEY (`clinic_id`, `catalog_item_id`) REFERENCES `catalog_items` (`clinic_id`, `id`);

ALTER TABLE `document_sequences`
  ADD CONSTRAINT `fk_document_sequences_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`);

ALTER TABLE `document_number_usages`
  ADD CONSTRAINT `fk_document_number_usages_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_document_number_usages_02` FOREIGN KEY (`clinic_id`, `allocation_id`) REFERENCES `document_number_allocations` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_document_number_usages_03` FOREIGN KEY (`clinic_id`, `source_device_id`) REFERENCES `enrolled_devices` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_document_number_usages_04` FOREIGN KEY (`clinic_id`, `actor_id`) REFERENCES `users` (`clinic_id`, `id`);

ALTER TABLE `cash_registers`
  ADD CONSTRAINT `fk_cash_registers_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`);

ALTER TABLE `cash_sessions`
  ADD CONSTRAINT `fk_cash_sessions_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_cash_sessions_02` FOREIGN KEY (`clinic_id`, `cash_register_id`) REFERENCES `cash_registers` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_cash_sessions_03` FOREIGN KEY (`clinic_id`, `cashier_id`) REFERENCES `users` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_cash_sessions_04` FOREIGN KEY (`clinic_id`, `closed_by`) REFERENCES `users` (`clinic_id`, `id`);

ALTER TABLE `expense_categories`
  ADD CONSTRAINT `fk_expense_categories_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`);

ALTER TABLE `invoices`
  ADD CONSTRAINT `fk_invoices_01` FOREIGN KEY (`clinic_id`, `visit_id`, `patient_id`) REFERENCES `visits` (`clinic_id`, `id`, `patient_id`),
  ADD CONSTRAINT `fk_invoices_02` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_invoices_03` FOREIGN KEY (`clinic_id`, `patient_id`) REFERENCES `patient_records` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_invoices_04` FOREIGN KEY (`clinic_id`, `visit_id`) REFERENCES `visits` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_invoices_05` FOREIGN KEY (`clinic_id`, `quote_id`) REFERENCES `quotes` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_invoices_06` FOREIGN KEY (`clinic_id`, `issued_by`) REFERENCES `users` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_invoices_07` FOREIGN KEY (`clinic_id`, `number_usage_id`) REFERENCES `document_number_usages` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_invoices_08` FOREIGN KEY (`clinic_id`, `source_invoice_id`) REFERENCES `invoices` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_invoices_09` FOREIGN KEY (`clinic_id`, `created_by`) REFERENCES `users` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_invoices_10` FOREIGN KEY (`clinic_id`, `source_device_id`) REFERENCES `enrolled_devices` (`clinic_id`, `id`);

ALTER TABLE `invoice_lines`
  ADD CONSTRAINT `fk_invoice_lines_01` FOREIGN KEY (`clinic_id`, `invoice_id`, `patient_id`) REFERENCES `invoices` (`clinic_id`, `id`, `patient_id`),
  ADD CONSTRAINT `fk_invoice_lines_02` FOREIGN KEY (`clinic_id`, `prescription_id`, `patient_id`) REFERENCES `optical_prescriptions` (`clinic_id`, `id`, `patient_id`),
  ADD CONSTRAINT `fk_invoice_lines_03` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_invoice_lines_04` FOREIGN KEY (`clinic_id`, `patient_id`) REFERENCES `patient_records` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_invoice_lines_05` FOREIGN KEY (`clinic_id`, `invoice_id`) REFERENCES `invoices` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_invoice_lines_06` FOREIGN KEY (`clinic_id`, `catalog_item_id`) REFERENCES `catalog_items` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_invoice_lines_07` FOREIGN KEY (`clinic_id`, `prescription_id`) REFERENCES `optical_prescriptions` (`clinic_id`, `id`);

ALTER TABLE `payments`
  ADD CONSTRAINT `fk_payments_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_payments_02` FOREIGN KEY (`clinic_id`, `invoice_id`) REFERENCES `invoices` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_payments_03` FOREIGN KEY (`clinic_id`, `cash_session_id`) REFERENCES `cash_sessions` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_payments_04` FOREIGN KEY (`clinic_id`, `received_by`) REFERENCES `users` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_payments_05` FOREIGN KEY (`clinic_id`, `idempotency_id`) REFERENCES `idempotency_requests` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_payments_06` FOREIGN KEY (`clinic_id`, `source_device_id`) REFERENCES `enrolled_devices` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_payments_07` FOREIGN KEY (`clinic_id`, `sync_command_id`) REFERENCES `sync_commands` (`clinic_id`, `id`);

ALTER TABLE `receipts`
  ADD CONSTRAINT `fk_receipts_01` FOREIGN KEY (`clinic_id`, `payment_id`, `invoice_id`) REFERENCES `payments` (`clinic_id`, `id`, `invoice_id`),
  ADD CONSTRAINT `fk_receipts_02` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_receipts_03` FOREIGN KEY (`clinic_id`, `payment_id`) REFERENCES `payments` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_receipts_04` FOREIGN KEY (`clinic_id`, `invoice_id`) REFERENCES `invoices` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_receipts_05` FOREIGN KEY (`clinic_id`, `number_usage_id`) REFERENCES `document_number_usages` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_receipts_06` FOREIGN KEY (`clinic_id`, `issued_by`) REFERENCES `users` (`clinic_id`, `id`);

ALTER TABLE `payment_reversals`
  ADD CONSTRAINT `fk_payment_reversals_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_payment_reversals_02` FOREIGN KEY (`clinic_id`, `payment_id`) REFERENCES `payments` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_payment_reversals_03` FOREIGN KEY (`clinic_id`, `approval_id`) REFERENCES `approvals` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_payment_reversals_04` FOREIGN KEY (`clinic_id`, `created_by`) REFERENCES `users` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_payment_reversals_05` FOREIGN KEY (`clinic_id`, `idempotency_id`) REFERENCES `idempotency_requests` (`clinic_id`, `id`);

ALTER TABLE `credit_notes`
  ADD CONSTRAINT `fk_credit_notes_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_credit_notes_02` FOREIGN KEY (`clinic_id`, `invoice_id`) REFERENCES `invoices` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_credit_notes_03` FOREIGN KEY (`clinic_id`, `issued_by`) REFERENCES `users` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_credit_notes_04` FOREIGN KEY (`clinic_id`, `number_usage_id`) REFERENCES `document_number_usages` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_credit_notes_05` FOREIGN KEY (`clinic_id`, `approval_id`) REFERENCES `approvals` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_credit_notes_06` FOREIGN KEY (`clinic_id`, `idempotency_id`) REFERENCES `idempotency_requests` (`clinic_id`, `id`);

ALTER TABLE `credit_note_lines`
  ADD CONSTRAINT `fk_credit_note_lines_01` FOREIGN KEY (`clinic_id`, `credit_note_id`, `invoice_id`) REFERENCES `credit_notes` (`clinic_id`, `id`, `invoice_id`),
  ADD CONSTRAINT `fk_credit_note_lines_02` FOREIGN KEY (`clinic_id`, `invoice_line_id`, `invoice_id`) REFERENCES `invoice_lines` (`clinic_id`, `id`, `invoice_id`),
  ADD CONSTRAINT `fk_credit_note_lines_03` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_credit_note_lines_04` FOREIGN KEY (`clinic_id`, `credit_note_id`) REFERENCES `credit_notes` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_credit_note_lines_05` FOREIGN KEY (`clinic_id`, `invoice_id`) REFERENCES `invoices` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_credit_note_lines_06` FOREIGN KEY (`clinic_id`, `invoice_line_id`) REFERENCES `invoice_lines` (`clinic_id`, `id`);

ALTER TABLE `refunds`
  ADD CONSTRAINT `fk_refunds_01` FOREIGN KEY (`clinic_id`, `credit_note_id`, `invoice_id`) REFERENCES `credit_notes` (`clinic_id`, `id`, `invoice_id`),
  ADD CONSTRAINT `fk_refunds_02` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_refunds_03` FOREIGN KEY (`clinic_id`, `invoice_id`) REFERENCES `invoices` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_refunds_04` FOREIGN KEY (`clinic_id`, `credit_note_id`) REFERENCES `credit_notes` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_refunds_05` FOREIGN KEY (`clinic_id`, `approval_id`) REFERENCES `approvals` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_refunds_06` FOREIGN KEY (`clinic_id`, `number_usage_id`) REFERENCES `document_number_usages` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_refunds_07` FOREIGN KEY (`clinic_id`, `cash_session_id`) REFERENCES `cash_sessions` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_refunds_08` FOREIGN KEY (`clinic_id`, `idempotency_id`) REFERENCES `idempotency_requests` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_refunds_09` FOREIGN KEY (`clinic_id`, `created_by`) REFERENCES `users` (`clinic_id`, `id`);

ALTER TABLE `legacy_balance_imports`
  ADD CONSTRAINT `fk_legacy_balance_imports_01` FOREIGN KEY (`clinic_id`, `invoice_id`, `patient_id`) REFERENCES `invoices` (`clinic_id`, `id`, `patient_id`),
  ADD CONSTRAINT `fk_legacy_balance_imports_02` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_legacy_balance_imports_03` FOREIGN KEY (`clinic_id`, `patient_id`) REFERENCES `patient_records` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_legacy_balance_imports_04` FOREIGN KEY (`clinic_id`, `invoice_id`) REFERENCES `invoices` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_legacy_balance_imports_05` FOREIGN KEY (`clinic_id`, `evidence_file_id`) REFERENCES `stored_files` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_legacy_balance_imports_06` FOREIGN KEY (`clinic_id`, `validated_by`) REFERENCES `users` (`clinic_id`, `id`);

ALTER TABLE `cash_movements`
  ADD CONSTRAINT `fk_cash_movements_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_cash_movements_02` FOREIGN KEY (`clinic_id`, `cash_session_id`) REFERENCES `cash_sessions` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_cash_movements_03` FOREIGN KEY (`clinic_id`, `approval_id`) REFERENCES `approvals` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_cash_movements_04` FOREIGN KEY (`clinic_id`, `expense_category_id`) REFERENCES `expense_categories` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_cash_movements_05` FOREIGN KEY (`clinic_id`, `created_by`) REFERENCES `users` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_cash_movements_06` FOREIGN KEY (`clinic_id`, `source_device_id`) REFERENCES `enrolled_devices` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_cash_movements_07` FOREIGN KEY (`clinic_id`, `sync_command_id`) REFERENCES `sync_commands` (`clinic_id`, `id`);

ALTER TABLE `payment_reconciliations`
  ADD CONSTRAINT `fk_payment_reconciliations_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_payment_reconciliations_02` FOREIGN KEY (`clinic_id`, `statement_file_id`) REFERENCES `stored_files` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_payment_reconciliations_03` FOREIGN KEY (`clinic_id`, `validated_by`) REFERENCES `users` (`clinic_id`, `id`);

ALTER TABLE `payment_reconciliation_lines`
  ADD CONSTRAINT `fk_payment_reconciliation_lines_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_payment_reconciliation_lines_02` FOREIGN KEY (`clinic_id`, `reconciliation_id`) REFERENCES `payment_reconciliations` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_payment_reconciliation_lines_03` FOREIGN KEY (`clinic_id`, `payment_id`) REFERENCES `payments` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_payment_reconciliation_lines_04` FOREIGN KEY (`clinic_id`, `refund_id`) REFERENCES `refunds` (`clinic_id`, `id`);

ALTER TABLE `stock_locations`
  ADD CONSTRAINT `fk_stock_locations_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`);

ALTER TABLE `suppliers`
  ADD CONSTRAINT `fk_suppliers_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`);

ALTER TABLE `goods_receipts`
  ADD CONSTRAINT `fk_goods_receipts_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_goods_receipts_02` FOREIGN KEY (`clinic_id`, `supplier_id`) REFERENCES `suppliers` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_goods_receipts_03` FOREIGN KEY (`clinic_id`, `location_id`) REFERENCES `stock_locations` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_goods_receipts_04` FOREIGN KEY (`clinic_id`, `evidence_file_id`) REFERENCES `stored_files` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_goods_receipts_05` FOREIGN KEY (`clinic_id`, `validated_by`) REFERENCES `users` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_goods_receipts_06` FOREIGN KEY (`clinic_id`, `created_by`) REFERENCES `users` (`clinic_id`, `id`);

ALTER TABLE `stock_positions`
  ADD CONSTRAINT `fk_stock_positions_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_stock_positions_02` FOREIGN KEY (`clinic_id`, `item_id`) REFERENCES `catalog_items` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_stock_positions_03` FOREIGN KEY (`clinic_id`, `location_id`) REFERENCES `stock_locations` (`clinic_id`, `id`);

ALTER TABLE `stock_lots`
  ADD CONSTRAINT `fk_stock_lots_01` FOREIGN KEY (`clinic_id`, `stock_position_id`, `item_id`, `location_id`) REFERENCES `stock_positions` (`clinic_id`, `id`, `item_id`, `location_id`),
  ADD CONSTRAINT `fk_stock_lots_02` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_stock_lots_03` FOREIGN KEY (`clinic_id`, `item_id`) REFERENCES `catalog_items` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_stock_lots_04` FOREIGN KEY (`clinic_id`, `location_id`) REFERENCES `stock_locations` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_stock_lots_05` FOREIGN KEY (`clinic_id`, `stock_position_id`) REFERENCES `stock_positions` (`clinic_id`, `id`);

ALTER TABLE `goods_receipt_lines`
  ADD CONSTRAINT `fk_goods_receipt_lines_01` FOREIGN KEY (`clinic_id`, `receipt_id`, `location_id`) REFERENCES `goods_receipts` (`clinic_id`, `id`, `location_id`),
  ADD CONSTRAINT `fk_goods_receipt_lines_02` FOREIGN KEY (`clinic_id`, `stock_lot_id`, `item_id`, `location_id`) REFERENCES `stock_lots` (`clinic_id`, `id`, `item_id`, `location_id`),
  ADD CONSTRAINT `fk_goods_receipt_lines_03` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_goods_receipt_lines_04` FOREIGN KEY (`clinic_id`, `receipt_id`) REFERENCES `goods_receipts` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_goods_receipt_lines_05` FOREIGN KEY (`clinic_id`, `item_id`) REFERENCES `catalog_items` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_goods_receipt_lines_06` FOREIGN KEY (`clinic_id`, `location_id`) REFERENCES `stock_locations` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_goods_receipt_lines_07` FOREIGN KEY (`clinic_id`, `stock_lot_id`) REFERENCES `stock_lots` (`clinic_id`, `id`);

ALTER TABLE `inventory_counts`
  ADD CONSTRAINT `fk_inventory_counts_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_inventory_counts_02` FOREIGN KEY (`clinic_id`, `location_id`) REFERENCES `stock_locations` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_inventory_counts_03` FOREIGN KEY (`clinic_id`, `opened_by`) REFERENCES `users` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_inventory_counts_04` FOREIGN KEY (`clinic_id`, `validated_by`) REFERENCES `users` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_inventory_counts_05` FOREIGN KEY (`clinic_id`, `approval_id`) REFERENCES `approvals` (`clinic_id`, `id`);

ALTER TABLE `inventory_count_lines`
  ADD CONSTRAINT `fk_inventory_count_lines_01` FOREIGN KEY (`clinic_id`, `inventory_id`, `location_id`) REFERENCES `inventory_counts` (`clinic_id`, `id`, `location_id`),
  ADD CONSTRAINT `fk_inventory_count_lines_02` FOREIGN KEY (`clinic_id`, `stock_lot_id`, `item_id`, `location_id`) REFERENCES `stock_lots` (`clinic_id`, `id`, `item_id`, `location_id`),
  ADD CONSTRAINT `fk_inventory_count_lines_03` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_inventory_count_lines_04` FOREIGN KEY (`clinic_id`, `inventory_id`) REFERENCES `inventory_counts` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_inventory_count_lines_05` FOREIGN KEY (`clinic_id`, `item_id`) REFERENCES `catalog_items` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_inventory_count_lines_06` FOREIGN KEY (`clinic_id`, `location_id`) REFERENCES `stock_locations` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_inventory_count_lines_07` FOREIGN KEY (`clinic_id`, `stock_lot_id`) REFERENCES `stock_lots` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_inventory_count_lines_08` FOREIGN KEY (`clinic_id`, `counted_by`) REFERENCES `users` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_inventory_count_lines_09` FOREIGN KEY (`clinic_id`, `adjustment_movement_id`) REFERENCES `stock_movements` (`clinic_id`, `id`);

ALTER TABLE `stock_reservations`
  ADD CONSTRAINT `fk_stock_reservations_01` FOREIGN KEY (`clinic_id`, `stock_lot_id`, `stock_position_id`) REFERENCES `stock_lots` (`clinic_id`, `id`, `stock_position_id`),
  ADD CONSTRAINT `fk_stock_reservations_02` FOREIGN KEY (`clinic_id`, `device_allocation_id`, `stock_position_id`) REFERENCES `device_stock_allocations` (`clinic_id`, `id`, `stock_position_id`),
  ADD CONSTRAINT `fk_stock_reservations_03` FOREIGN KEY (`clinic_id`, `invoice_line_id`, `item_id`) REFERENCES `invoice_lines` (`clinic_id`, `id`, `catalog_item_id`),
  ADD CONSTRAINT `fk_stock_reservations_04` FOREIGN KEY (`clinic_id`, `stock_position_id`, `item_id`) REFERENCES `stock_positions` (`clinic_id`, `id`, `item_id`),
  ADD CONSTRAINT `fk_stock_reservations_05` FOREIGN KEY (`clinic_id`, `device_allocation_id`, `stock_position_id`, `lot_key`) REFERENCES `device_stock_allocations` (`clinic_id`, `id`, `stock_position_id`, `lot_key`),
  ADD CONSTRAINT `fk_stock_reservations_06` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_stock_reservations_07` FOREIGN KEY (`clinic_id`, `item_id`) REFERENCES `catalog_items` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_stock_reservations_08` FOREIGN KEY (`clinic_id`, `invoice_line_id`) REFERENCES `invoice_lines` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_stock_reservations_09` FOREIGN KEY (`clinic_id`, `stock_position_id`) REFERENCES `stock_positions` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_stock_reservations_10` FOREIGN KEY (`clinic_id`, `stock_lot_id`) REFERENCES `stock_lots` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_stock_reservations_11` FOREIGN KEY (`clinic_id`, `device_allocation_id`) REFERENCES `device_stock_allocations` (`clinic_id`, `id`);

ALTER TABLE `deliveries`
  ADD CONSTRAINT `fk_deliveries_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_deliveries_02` FOREIGN KEY (`clinic_id`, `invoice_id`) REFERENCES `invoices` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_deliveries_03` FOREIGN KEY (`clinic_id`, `delivered_by`) REFERENCES `users` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_deliveries_04` FOREIGN KEY (`clinic_id`, `credit_delivery_approval_id`) REFERENCES `approvals` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_deliveries_05` FOREIGN KEY (`clinic_id`, `idempotency_id`) REFERENCES `idempotency_requests` (`clinic_id`, `id`);

ALTER TABLE `delivery_lines`
  ADD CONSTRAINT `fk_delivery_lines_01` FOREIGN KEY (`clinic_id`, `delivery_id`, `invoice_id`) REFERENCES `deliveries` (`clinic_id`, `id`, `invoice_id`),
  ADD CONSTRAINT `fk_delivery_lines_02` FOREIGN KEY (`clinic_id`, `invoice_line_id`, `invoice_id`) REFERENCES `invoice_lines` (`clinic_id`, `id`, `invoice_id`),
  ADD CONSTRAINT `fk_delivery_lines_03` FOREIGN KEY (`clinic_id`, `invoice_line_id`, `item_id`) REFERENCES `invoice_lines` (`clinic_id`, `id`, `catalog_item_id`),
  ADD CONSTRAINT `fk_delivery_lines_04` FOREIGN KEY (`clinic_id`, `stock_position_id`, `item_id`) REFERENCES `stock_positions` (`clinic_id`, `id`, `item_id`),
  ADD CONSTRAINT `fk_delivery_lines_05` FOREIGN KEY (`clinic_id`, `stock_lot_id`, `stock_position_id`) REFERENCES `stock_lots` (`clinic_id`, `id`, `stock_position_id`),
  ADD CONSTRAINT `fk_delivery_lines_06` FOREIGN KEY (`clinic_id`, `reservation_id`, `invoice_line_id`, `stock_position_id`, `lot_key`) REFERENCES `stock_reservations` (`clinic_id`, `id`, `invoice_line_id`, `stock_position_id`, `lot_key`),
  ADD CONSTRAINT `fk_delivery_lines_07` FOREIGN KEY (`clinic_id`, `workshop_order_id`, `invoice_line_id`) REFERENCES `workshop_orders` (`clinic_id`, `id`, `invoice_line_id`),
  ADD CONSTRAINT `fk_delivery_lines_08` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_delivery_lines_09` FOREIGN KEY (`clinic_id`, `item_id`) REFERENCES `catalog_items` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_delivery_lines_10` FOREIGN KEY (`clinic_id`, `stock_position_id`) REFERENCES `stock_positions` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_delivery_lines_11` FOREIGN KEY (`clinic_id`, `delivery_id`) REFERENCES `deliveries` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_delivery_lines_12` FOREIGN KEY (`clinic_id`, `invoice_id`) REFERENCES `invoices` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_delivery_lines_13` FOREIGN KEY (`clinic_id`, `invoice_line_id`) REFERENCES `invoice_lines` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_delivery_lines_14` FOREIGN KEY (`clinic_id`, `stock_lot_id`) REFERENCES `stock_lots` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_delivery_lines_15` FOREIGN KEY (`clinic_id`, `workshop_order_id`) REFERENCES `workshop_orders` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_delivery_lines_16` FOREIGN KEY (`clinic_id`, `reservation_id`) REFERENCES `stock_reservations` (`clinic_id`, `id`);

ALTER TABLE `physical_returns`
  ADD CONSTRAINT `fk_physical_returns_01` FOREIGN KEY (`clinic_id`, `delivery_line_id`, `item_id`) REFERENCES `delivery_lines` (`clinic_id`, `id`, `item_id`),
  ADD CONSTRAINT `fk_physical_returns_02` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_physical_returns_03` FOREIGN KEY (`clinic_id`, `item_id`) REFERENCES `catalog_items` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_physical_returns_04` FOREIGN KEY (`clinic_id`, `delivery_line_id`) REFERENCES `delivery_lines` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_physical_returns_05` FOREIGN KEY (`clinic_id`, `approved_by`) REFERENCES `users` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_physical_returns_06` FOREIGN KEY (`clinic_id`, `credit_note_id`) REFERENCES `credit_notes` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_physical_returns_07` FOREIGN KEY (`clinic_id`, `idempotency_id`) REFERENCES `idempotency_requests` (`clinic_id`, `id`);

ALTER TABLE `stock_movements`
  ADD CONSTRAINT `fk_stock_movements_01` FOREIGN KEY (`clinic_id`, `position_id`, `item_id`) REFERENCES `stock_positions` (`clinic_id`, `id`, `item_id`),
  ADD CONSTRAINT `fk_stock_movements_02` FOREIGN KEY (`clinic_id`, `lot_id`, `position_id`) REFERENCES `stock_lots` (`clinic_id`, `id`, `stock_position_id`),
  ADD CONSTRAINT `fk_stock_movements_03` FOREIGN KEY (`clinic_id`, `delivery_line_id`, `item_id`, `position_id`, `lot_key`) REFERENCES `delivery_lines` (`clinic_id`, `id`, `item_id`, `stock_position_id`, `lot_key`),
  ADD CONSTRAINT `fk_stock_movements_04` FOREIGN KEY (`clinic_id`, `goods_receipt_line_id`, `item_id`) REFERENCES `goods_receipt_lines` (`clinic_id`, `id`, `item_id`),
  ADD CONSTRAINT `fk_stock_movements_05` FOREIGN KEY (`clinic_id`, `physical_return_id`, `item_id`) REFERENCES `physical_returns` (`clinic_id`, `id`, `item_id`),
  ADD CONSTRAINT `fk_stock_movements_06` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_stock_movements_07` FOREIGN KEY (`clinic_id`, `item_id`) REFERENCES `catalog_items` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_stock_movements_08` FOREIGN KEY (`clinic_id`, `position_id`) REFERENCES `stock_positions` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_stock_movements_09` FOREIGN KEY (`clinic_id`, `lot_id`) REFERENCES `stock_lots` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_stock_movements_10` FOREIGN KEY (`clinic_id`, `delivery_line_id`) REFERENCES `delivery_lines` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_stock_movements_11` FOREIGN KEY (`clinic_id`, `physical_return_id`) REFERENCES `physical_returns` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_stock_movements_12` FOREIGN KEY (`clinic_id`, `goods_receipt_line_id`) REFERENCES `goods_receipt_lines` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_stock_movements_13` FOREIGN KEY (`clinic_id`, `approval_id`) REFERENCES `approvals` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_stock_movements_14` FOREIGN KEY (`clinic_id`, `actor_id`) REFERENCES `users` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_stock_movements_15` FOREIGN KEY (`clinic_id`, `idempotency_id`) REFERENCES `idempotency_requests` (`clinic_id`, `id`);

ALTER TABLE `stock_alerts`
  ADD CONSTRAINT `fk_stock_alerts_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_stock_alerts_02` FOREIGN KEY (`clinic_id`, `item_id`) REFERENCES `catalog_items` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_stock_alerts_03` FOREIGN KEY (`clinic_id`, `location_id`) REFERENCES `stock_locations` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_stock_alerts_04` FOREIGN KEY (`clinic_id`, `lot_id`) REFERENCES `stock_lots` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_stock_alerts_05` FOREIGN KEY (`clinic_id`, `acknowledged_by`) REFERENCES `users` (`clinic_id`, `id`);

ALTER TABLE `workshop_orders`
  ADD CONSTRAINT `fk_workshop_orders_01` FOREIGN KEY (`clinic_id`, `invoice_line_id`, `patient_id`) REFERENCES `invoice_lines` (`clinic_id`, `id`, `patient_id`),
  ADD CONSTRAINT `fk_workshop_orders_02` FOREIGN KEY (`clinic_id`, `prescription_id`, `patient_id`) REFERENCES `optical_prescriptions` (`clinic_id`, `id`, `patient_id`),
  ADD CONSTRAINT `fk_workshop_orders_03` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_workshop_orders_04` FOREIGN KEY (`clinic_id`, `patient_id`) REFERENCES `patient_records` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_workshop_orders_05` FOREIGN KEY (`clinic_id`, `invoice_line_id`) REFERENCES `invoice_lines` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_workshop_orders_06` FOREIGN KEY (`clinic_id`, `prescription_id`) REFERENCES `optical_prescriptions` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_workshop_orders_07` FOREIGN KEY (`clinic_id`, `supplier_id`) REFERENCES `suppliers` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_workshop_orders_08` FOREIGN KEY (`clinic_id`, `frame_item_id`) REFERENCES `catalog_items` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_workshop_orders_09` FOREIGN KEY (`clinic_id`, `created_by`) REFERENCES `users` (`clinic_id`, `id`);

ALTER TABLE `workshop_order_eyes`
  ADD CONSTRAINT `fk_workshop_order_eyes_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_workshop_order_eyes_02` FOREIGN KEY (`clinic_id`, `workshop_order_id`) REFERENCES `workshop_orders` (`clinic_id`, `id`);

ALTER TABLE `workshop_events`
  ADD CONSTRAINT `fk_workshop_events_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_workshop_events_02` FOREIGN KEY (`clinic_id`, `workshop_order_id`) REFERENCES `workshop_orders` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_workshop_events_03` FOREIGN KEY (`clinic_id`, `actor_id`) REFERENCES `users` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_workshop_events_04` FOREIGN KEY (`clinic_id`, `delivery_line_id`) REFERENCES `delivery_lines` (`clinic_id`, `id`);

ALTER TABLE `integration_accounts`
  ADD CONSTRAINT `fk_integration_accounts_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_integration_accounts_02` FOREIGN KEY (`clinic_id`, `configured_by`) REFERENCES `users` (`clinic_id`, `id`);

ALTER TABLE `external_links`
  ADD CONSTRAINT `fk_external_links_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_external_links_02` FOREIGN KEY (`clinic_id`, `integration_account_id`) REFERENCES `integration_accounts` (`clinic_id`, `id`);

ALTER TABLE `calendar_sync_states`
  ADD CONSTRAINT `fk_calendar_sync_states_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_calendar_sync_states_02` FOREIGN KEY (`clinic_id`, `integration_account_id`) REFERENCES `integration_accounts` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_calendar_sync_states_03` FOREIGN KEY (`clinic_id`, `resource_id`) REFERENCES `scheduling_resources` (`clinic_id`, `id`);

ALTER TABLE `webhook_inbox`
  ADD CONSTRAINT `fk_webhook_inbox_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_webhook_inbox_02` FOREIGN KEY (`clinic_id`, `integration_account_id`) REFERENCES `integration_accounts` (`clinic_id`, `id`);

ALTER TABLE `outbox_events`
  ADD CONSTRAINT `fk_outbox_events_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`);

ALTER TABLE `crm_leads`
  ADD CONSTRAINT `fk_crm_leads_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_crm_leads_02` FOREIGN KEY (`clinic_id`, `prospect_contact_id`) REFERENCES `prospect_contacts` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_crm_leads_03` FOREIGN KEY (`clinic_id`, `integration_account_id`) REFERENCES `integration_accounts` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_crm_leads_04` FOREIGN KEY (`clinic_id`, `assigned_to`) REFERENCES `users` (`clinic_id`, `id`);

ALTER TABLE `crm_conversations`
  ADD CONSTRAINT `fk_crm_conversations_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_crm_conversations_02` FOREIGN KEY (`clinic_id`, `crm_lead_id`) REFERENCES `crm_leads` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_crm_conversations_03` FOREIGN KEY (`clinic_id`, `integration_account_id`) REFERENCES `integration_accounts` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_crm_conversations_04` FOREIGN KEY (`clinic_id`, `human_owner_id`) REFERENCES `users` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_crm_conversations_05` FOREIGN KEY (`clinic_id`, `bot_resumed_by`) REFERENCES `users` (`clinic_id`, `id`);

ALTER TABLE `conversation_handoffs`
  ADD CONSTRAINT `fk_conversation_handoffs_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_conversation_handoffs_02` FOREIGN KEY (`clinic_id`, `conversation_id`) REFERENCES `crm_conversations` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_conversation_handoffs_03` FOREIGN KEY (`clinic_id`, `actor_id`) REFERENCES `users` (`clinic_id`, `id`);

ALTER TABLE `knowledge_entries`
  ADD CONSTRAINT `fk_knowledge_entries_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`);

ALTER TABLE `knowledge_entry_versions`
  ADD CONSTRAINT `fk_knowledge_entry_versions_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_knowledge_entry_versions_02` FOREIGN KEY (`clinic_id`, `entry_id`) REFERENCES `knowledge_entries` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_knowledge_entry_versions_03` FOREIGN KEY (`clinic_id`, `authored_by`) REFERENCES `users` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_knowledge_entry_versions_04` FOREIGN KEY (`clinic_id`, `approved_by`) REFERENCES `users` (`clinic_id`, `id`);

ALTER TABLE `assistant_runs`
  ADD CONSTRAINT `fk_assistant_runs_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_assistant_runs_02` FOREIGN KEY (`clinic_id`, `conversation_id`) REFERENCES `crm_conversations` (`clinic_id`, `id`);

ALTER TABLE `reminder_policies`
  ADD CONSTRAINT `fk_reminder_policies_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`);

ALTER TABLE `contact_tasks`
  ADD CONSTRAINT `fk_contact_tasks_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_contact_tasks_02` FOREIGN KEY (`clinic_id`, `patient_id`) REFERENCES `patient_records` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_contact_tasks_03` FOREIGN KEY (`clinic_id`, `prospect_contact_id`) REFERENCES `prospect_contacts` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_contact_tasks_04` FOREIGN KEY (`clinic_id`, `follow_up_id`) REFERENCES `follow_up_plans` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_contact_tasks_05` FOREIGN KEY (`clinic_id`, `appointment_id`) REFERENCES `appointments` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_contact_tasks_06` FOREIGN KEY (`clinic_id`, `invoice_id`) REFERENCES `invoices` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_contact_tasks_07` FOREIGN KEY (`clinic_id`, `workshop_order_id`) REFERENCES `workshop_orders` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_contact_tasks_08` FOREIGN KEY (`clinic_id`, `policy_id`) REFERENCES `reminder_policies` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_contact_tasks_09` FOREIGN KEY (`clinic_id`, `assigned_to`) REFERENCES `users` (`clinic_id`, `id`);

ALTER TABLE `contact_attempts`
  ADD CONSTRAINT `fk_contact_attempts_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_contact_attempts_02` FOREIGN KEY (`clinic_id`, `task_id`) REFERENCES `contact_tasks` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_contact_attempts_03` FOREIGN KEY (`clinic_id`, `actor_id`) REFERENCES `users` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_contact_attempts_04` FOREIGN KEY (`clinic_id`, `appointment_id`) REFERENCES `appointments` (`clinic_id`, `id`);

ALTER TABLE `communication_consents`
  ADD CONSTRAINT `fk_communication_consents_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_communication_consents_02` FOREIGN KEY (`clinic_id`, `patient_id`) REFERENCES `patient_records` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_communication_consents_03` FOREIGN KEY (`clinic_id`, `prospect_contact_id`) REFERENCES `prospect_contacts` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_communication_consents_04` FOREIGN KEY (`clinic_id`, `recorded_by`) REFERENCES `users` (`clinic_id`, `id`);

ALTER TABLE `message_templates`
  ADD CONSTRAINT `fk_message_templates_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`);

ALTER TABLE `message_template_versions`
  ADD CONSTRAINT `fk_message_template_versions_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_message_template_versions_02` FOREIGN KEY (`clinic_id`, `template_id`) REFERENCES `message_templates` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_message_template_versions_03` FOREIGN KEY (`clinic_id`, `integration_account_id`) REFERENCES `integration_accounts` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_message_template_versions_04` FOREIGN KEY (`clinic_id`, `media_file_id`) REFERENCES `stored_files` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_message_template_versions_05` FOREIGN KEY (`clinic_id`, `approved_by`) REFERENCES `users` (`clinic_id`, `id`);

ALTER TABLE `audience_segments`
  ADD CONSTRAINT `fk_audience_segments_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_audience_segments_02` FOREIGN KEY (`clinic_id`, `created_by`) REFERENCES `users` (`clinic_id`, `id`);

ALTER TABLE `campaign_definitions`
  ADD CONSTRAINT `fk_campaign_definitions_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_campaign_definitions_02` FOREIGN KEY (`clinic_id`, `segment_id`) REFERENCES `audience_segments` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_campaign_definitions_03` FOREIGN KEY (`clinic_id`, `template_version_id`) REFERENCES `message_template_versions` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_campaign_definitions_04` FOREIGN KEY (`clinic_id`, `approval_id`) REFERENCES `approvals` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_campaign_definitions_05` FOREIGN KEY (`clinic_id`, `created_by`) REFERENCES `users` (`clinic_id`, `id`);

ALTER TABLE `campaign_recipients`
  ADD CONSTRAINT `fk_campaign_recipients_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_campaign_recipients_02` FOREIGN KEY (`clinic_id`, `campaign_id`) REFERENCES `campaign_definitions` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_campaign_recipients_03` FOREIGN KEY (`clinic_id`, `patient_id`) REFERENCES `patient_records` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_campaign_recipients_04` FOREIGN KEY (`clinic_id`, `prospect_contact_id`) REFERENCES `prospect_contacts` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_campaign_recipients_05` FOREIGN KEY (`clinic_id`, `consent_event_id`) REFERENCES `communication_consents` (`clinic_id`, `id`);

ALTER TABLE `message_attempts`
  ADD CONSTRAINT `fk_message_attempts_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_message_attempts_02` FOREIGN KEY (`clinic_id`, `task_id`) REFERENCES `contact_tasks` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_message_attempts_03` FOREIGN KEY (`clinic_id`, `campaign_recipient_id`) REFERENCES `campaign_recipients` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_message_attempts_04` FOREIGN KEY (`clinic_id`, `integration_account_id`) REFERENCES `integration_accounts` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_message_attempts_05` FOREIGN KEY (`clinic_id`, `template_version_id`) REFERENCES `message_template_versions` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_message_attempts_06` FOREIGN KEY (`clinic_id`, `consent_event_id`) REFERENCES `communication_consents` (`clinic_id`, `id`);

ALTER TABLE `catalog_publications`
  ADD CONSTRAINT `fk_catalog_publications_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_catalog_publications_02` FOREIGN KEY (`clinic_id`, `catalog_item_id`) REFERENCES `catalog_items` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_catalog_publications_03` FOREIGN KEY (`clinic_id`, `approved_by`) REFERENCES `users` (`clinic_id`, `id`);

ALTER TABLE `catalog_media`
  ADD CONSTRAINT `fk_catalog_media_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_catalog_media_02` FOREIGN KEY (`clinic_id`, `publication_id`) REFERENCES `catalog_publications` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_catalog_media_03` FOREIGN KEY (`clinic_id`, `file_id`) REFERENCES `stored_files` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_catalog_media_04` FOREIGN KEY (`clinic_id`, `approved_by`) REFERENCES `users` (`clinic_id`, `id`);

ALTER TABLE `public_contents`
  ADD CONSTRAINT `fk_public_contents_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_public_contents_02` FOREIGN KEY (`clinic_id`, `approved_by`) REFERENCES `users` (`clinic_id`, `id`);

ALTER TABLE `public_booking_requests`
  ADD CONSTRAINT `fk_public_booking_requests_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_public_booking_requests_02` FOREIGN KEY (`clinic_id`, `catalog_publication_id`) REFERENCES `catalog_publications` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_public_booking_requests_03` FOREIGN KEY (`clinic_id`, `prospect_contact_id`) REFERENCES `prospect_contacts` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_public_booking_requests_04` FOREIGN KEY (`clinic_id`, `service_id`) REFERENCES `appointment_services` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_public_booking_requests_05` FOREIGN KEY (`clinic_id`, `resource_id`) REFERENCES `scheduling_resources` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_public_booking_requests_06` FOREIGN KEY (`clinic_id`, `appointment_id`) REFERENCES `appointments` (`clinic_id`, `id`);

ALTER TABLE `enrolled_devices`
  ADD CONSTRAINT `fk_enrolled_devices_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_enrolled_devices_02` FOREIGN KEY (`clinic_id`, `enrolled_by`) REFERENCES `users` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_enrolled_devices_03` FOREIGN KEY (`clinic_id`, `responsible_user_id`) REFERENCES `users` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_enrolled_devices_04` FOREIGN KEY (`clinic_id`, `replaced_by_device_id`) REFERENCES `enrolled_devices` (`clinic_id`, `id`);

ALTER TABLE `offline_grants`
  ADD CONSTRAINT `fk_offline_grants_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_offline_grants_02` FOREIGN KEY (`clinic_id`, `device_id`) REFERENCES `enrolled_devices` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_offline_grants_03` FOREIGN KEY (`clinic_id`, `user_id`) REFERENCES `users` (`clinic_id`, `id`);

ALTER TABLE `document_number_allocations`
  ADD CONSTRAINT `fk_document_number_allocations_01` FOREIGN KEY (`clinic_id`, `grant_id`, `device_id`) REFERENCES `offline_grants` (`clinic_id`, `id`, `device_id`),
  ADD CONSTRAINT `fk_document_number_allocations_02` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_document_number_allocations_03` FOREIGN KEY (`clinic_id`, `device_id`) REFERENCES `enrolled_devices` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_document_number_allocations_04` FOREIGN KEY (`clinic_id`, `grant_id`) REFERENCES `offline_grants` (`clinic_id`, `id`);

ALTER TABLE `invoice_write_owners`
  ADD CONSTRAINT `fk_invoice_write_owners_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_invoice_write_owners_02` FOREIGN KEY (`clinic_id`, `invoice_id`) REFERENCES `invoices` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_invoice_write_owners_03` FOREIGN KEY (`clinic_id`, `device_id`) REFERENCES `enrolled_devices` (`clinic_id`, `id`);

ALTER TABLE `device_stock_allocations`
  ADD CONSTRAINT `fk_device_stock_allocations_01` FOREIGN KEY (`clinic_id`, `stock_lot_id`, `stock_position_id`) REFERENCES `stock_lots` (`clinic_id`, `id`, `stock_position_id`),
  ADD CONSTRAINT `fk_device_stock_allocations_02` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_device_stock_allocations_03` FOREIGN KEY (`clinic_id`, `device_id`) REFERENCES `enrolled_devices` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_device_stock_allocations_04` FOREIGN KEY (`clinic_id`, `stock_position_id`) REFERENCES `stock_positions` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_device_stock_allocations_05` FOREIGN KEY (`clinic_id`, `stock_lot_id`) REFERENCES `stock_lots` (`clinic_id`, `id`);

ALTER TABLE `sync_commands`
  ADD CONSTRAINT `fk_sync_commands_01` FOREIGN KEY (`clinic_id`, `grant_id`, `device_id`, `actor_id`) REFERENCES `offline_grants` (`clinic_id`, `id`, `device_id`, `user_id`),
  ADD CONSTRAINT `fk_sync_commands_02` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_sync_commands_03` FOREIGN KEY (`clinic_id`, `device_id`) REFERENCES `enrolled_devices` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_sync_commands_04` FOREIGN KEY (`clinic_id`, `actor_id`) REFERENCES `users` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_sync_commands_05` FOREIGN KEY (`clinic_id`, `grant_id`) REFERENCES `offline_grants` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_sync_commands_06` FOREIGN KEY (`clinic_id`, `number_allocation_id`) REFERENCES `document_number_allocations` (`clinic_id`, `id`);

ALTER TABLE `sync_command_results`
  ADD CONSTRAINT `fk_sync_command_results_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_sync_command_results_02` FOREIGN KEY (`clinic_id`, `command_id`) REFERENCES `sync_commands` (`clinic_id`, `id`);

ALTER TABLE `sync_conflicts`
  ADD CONSTRAINT `fk_sync_conflicts_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_sync_conflicts_02` FOREIGN KEY (`clinic_id`, `command_id`) REFERENCES `sync_commands` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_sync_conflicts_03` FOREIGN KEY (`clinic_id`, `resolved_by`) REFERENCES `users` (`clinic_id`, `id`);

ALTER TABLE `sync_change_log`
  ADD CONSTRAINT `fk_sync_change_log_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`);

ALTER TABLE `generated_documents`
  ADD CONSTRAINT `fk_generated_documents_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_generated_documents_02` FOREIGN KEY (`clinic_id`, `invoice_id`) REFERENCES `invoices` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_generated_documents_03` FOREIGN KEY (`clinic_id`, `receipt_id`) REFERENCES `receipts` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_generated_documents_04` FOREIGN KEY (`clinic_id`, `credit_note_id`) REFERENCES `credit_notes` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_generated_documents_05` FOREIGN KEY (`clinic_id`, `refund_id`) REFERENCES `refunds` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_generated_documents_06` FOREIGN KEY (`clinic_id`, `prescription_id`) REFERENCES `optical_prescriptions` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_generated_documents_07` FOREIGN KEY (`clinic_id`, `clinical_revision_id`) REFERENCES `clinical_revisions` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_generated_documents_08` FOREIGN KEY (`clinic_id`, `workshop_order_id`) REFERENCES `workshop_orders` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_generated_documents_09` FOREIGN KEY (`clinic_id`, `patient_id`) REFERENCES `patient_records` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_generated_documents_10` FOREIGN KEY (`clinic_id`, `quote_id`) REFERENCES `quotes` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_generated_documents_11` FOREIGN KEY (`clinic_id`, `file_id`) REFERENCES `stored_files` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_generated_documents_12` FOREIGN KEY (`clinic_id`, `source_device_id`) REFERENCES `enrolled_devices` (`clinic_id`, `id`);

ALTER TABLE `export_requests`
  ADD CONSTRAINT `fk_export_requests_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_export_requests_02` FOREIGN KEY (`clinic_id`, `requested_by`) REFERENCES `users` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_export_requests_03` FOREIGN KEY (`clinic_id`, `patient_id`) REFERENCES `patient_records` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_export_requests_04` FOREIGN KEY (`clinic_id`, `file_id`) REFERENCES `stored_files` (`clinic_id`, `id`);

ALTER TABLE `backup_runs`
  ADD CONSTRAINT `fk_backup_runs_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_backup_runs_02` FOREIGN KEY (`clinic_id`, `device_id`) REFERENCES `enrolled_devices` (`clinic_id`, `id`);

ALTER TABLE `restore_tests`
  ADD CONSTRAINT `fk_restore_tests_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_restore_tests_02` FOREIGN KEY (`clinic_id`, `backup_run_id`) REFERENCES `backup_runs` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_restore_tests_03` FOREIGN KEY (`clinic_id`, `tested_by`) REFERENCES `users` (`clinic_id`, `id`);

ALTER TABLE `quote_revisions`
  ADD CONSTRAINT `fk_quote_revisions_01` FOREIGN KEY (`clinic_id`) REFERENCES `clinics` (`id`),
  ADD CONSTRAINT `fk_quote_revisions_02` FOREIGN KEY (`clinic_id`, `quote_id`) REFERENCES `quotes` (`clinic_id`, `id`),
  ADD CONSTRAINT `fk_quote_revisions_03` FOREIGN KEY (`clinic_id`, `authored_by`) REFERENCES `users` (`clinic_id`, `id`);
