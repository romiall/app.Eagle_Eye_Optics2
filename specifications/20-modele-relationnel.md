# Modèle relationnel complet de l’application

Version 2.0 du 14 octobre 2026. Toutes les relations de l’application sont définies maintenant. Les lots du planning déterminent l’ordre de développement et d’activation, sans retirer de tables du socle.

Le modèle contient 117 tables. Il est généré à partir du même catalogue que [le SQL](../database/01_schema.sql) et [le dictionnaire](07-dictionnaire-donnees.md). [Le MCD](06-modele-conceptuel.md) explique leurs cardinalités métier. Aucun patient, tarif ou taux fiscal réel n’est inventé.

## Conventions

PK = clé primaire ; FK = clé étrangère ; UQ = clé candidate unique. Les identifiants ULID sont conservés hors-ligne/serveur. Les tables métier incluent `clinic_id` et une clé unique `(clinic_id,id)` ; leurs FK composées interdisent les liens entre cabinets. Suppressions et changements d’identifiants sont restreints, sans cascade.

Les colonnes générées fournissent les unicités conditionnelles MySQL (session ouverte, propriétaire financier actif) et les clés de lot/consentement même en présence de NULL. Les sommes, chevauchements et signatures nécessitent les actions transactionnelles décrites dans [les invariants](21-invariants-base-donnees.md).

## Domaines

| Domaine | Tables |
| --- | --- |
| Référentiels globaux | `clinics`, `roles`, `permissions`, `role_permissions`, `clinical_terms`, `catalog_categories`, `units` |
| Accès et gouvernance | `users`, `user_roles`, `user_permissions`, `approvals`, `audit_events`, `idempotency_requests` |
| Documents et exploitation | `stored_files`, `document_sequences`, `document_number_usages`, `generated_documents`, `export_requests`, `backup_runs`, `restore_tests` |
| Patients et clinique | `patient_records`, `patient_merges`, `visits`, `consultations`, `consultation_complaints`, `consultation_histories`, `consultation_history_terms`, `consultation_ametropias`, `consultation_referral_reasons`, `visual_acuity_scales`, `visual_acuities`, `refraction_measurements`, `autorefractor_centering`, `clinical_revisions`, `optical_prescriptions`, `optical_prescription_eyes`, `optical_prescription_treatments`, `medication_orders` |
| CRM et assistant | `prospect_contacts`, `crm_leads`, `crm_conversations`, `conversation_handoffs`, `knowledge_entries`, `knowledge_entry_versions`, `assistant_runs` |
| Agenda et suivi | `scheduling_resources`, `appointment_services`, `resource_opening_hours`, `resource_exceptions`, `appointments`, `calendar_blocks`, `follow_up_plans` |
| Catalogue et facturation | `tax_rules`, `catalog_items`, `quotes`, `quote_lines`, `invoices`, `invoice_lines`, `payments`, `receipts`, `payment_reversals`, `credit_notes`, `credit_note_lines`, `refunds`, `legacy_balance_imports`, `quote_revisions` |
| Caisse et rapprochement | `cash_registers`, `cash_sessions`, `expense_categories`, `cash_movements`, `payment_reconciliations`, `payment_reconciliation_lines` |
| Stock achats et inventaires | `stock_locations`, `suppliers`, `goods_receipts`, `stock_positions`, `stock_lots`, `goods_receipt_lines`, `inventory_counts`, `inventory_count_lines`, `stock_reservations`, `deliveries`, `delivery_lines`, `physical_returns`, `stock_movements`, `stock_alerts` |
| Atelier optique | `workshop_orders`, `workshop_order_eyes`, `workshop_events` |
| Intégrations | `integration_accounts`, `external_links`, `calendar_sync_states`, `webhook_inbox`, `outbox_events` |
| Communications et relances | `reminder_policies`, `contact_tasks`, `contact_attempts`, `communication_consents`, `message_templates`, `message_template_versions`, `audience_segments`, `campaign_definitions`, `campaign_recipients`, `message_attempts` |
| Showroom et réservation publique | `catalog_publications`, `catalog_media`, `public_contents`, `public_booking_requests` |
| Hors-ligne et synchronisation | `enrolled_devices`, `offline_grants`, `document_number_allocations`, `invoice_write_owners`, `device_stock_allocations`, `sync_commands`, `sync_command_results`, `sync_conflicts`, `sync_change_log` |

## Référentiels globaux

### clinics

Cabinet et paramètres administratifs ; unique cabinet initial, modèle extensible.

**Attributs** : `id`, `name`, `timezone`, `currency`, `address` ?, `phone` ?, `email` ?, `tax_identifier` ?, `professional_mentions` ?, `document_settings` ?, `production_documents_enabled`, `created_at`, `updated_at`.

**PK** : `id`.

**Contrôles CHECK** : 4 ; expressions exactes dans le SQL et le catalogue.
### roles

Les quatre profils des sources.

**Attributs** : `code`, `label`, `description` ?.

**PK** : `code`.
### permissions

Permissions serveur explicites, sans autorisation déduite du navigateur.

**Attributs** : `code`, `label`.

**PK** : `code`.
### role_permissions

Permissions de base des profils.

**Attributs** : `role_code`, `permission_code`.

**PK** : `role_code,permission_code`.

| FK locale | Relation cible |
| --- | --- |
| `(role_code)` | `roles(code)` |
| `(permission_code)` | `permissions(code)` |
### clinical_terms

Codes cliniques DP et PC, sélection multiple normalisée.

**Attributs** : `group_code`, `code`, `label`, `sort_order`, `active`.

**PK** : `group_code,code`.

**Contrôles CHECK** : 1 ; expressions exactes dans le SQL et le catalogue.
### catalog_categories

Catégories produit et prestation des sources.

**Attributs** : `code`, `label`.

**PK** : `code`.
### units

Unité, paire et prestation ; pas de conversion implicite.

**Attributs** : `code`, `label`, `integer_only`.

**PK** : `code`.

**Contrôles CHECK** : 1 ; expressions exactes dans le SQL et le catalogue.

## Accès et gouvernance

### users

Compte individuel désactivable, jamais supprimé pour effacer un auteur.

**Attributs** : `id`, `clinic_id`, `display_name`, `login`, `email` ?, `password_hash`, `active`, `mfa_secret_ciphertext` ?, `mfa_key_id` ?, `last_login_at` ?, `version`, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,login)`; `(clinic_id,email)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |

**Contrôles CHECK** : 2 ; expressions exactes dans le SQL et le catalogue.
### user_roles

Attribution explicite des profils.

**Attributs** : `id`, `clinic_id`, `user_id`, `role_code`, `assigned_by`, `assigned_at`, `revoked_at` ?, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,user_id,role_code)`.

| FK locale | Relation cible |
| --- | --- |
| `(role_code)` | `roles(code)` |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,user_id)` | `users(clinic_id,id)` |
| `(clinic_id,assigned_by)` | `users(clinic_id,id)` |

**Contrôles CHECK** : 1 ; expressions exactes dans le SQL et le catalogue.
### user_permissions

Dérogation de permission nominative, avec motif.

**Attributs** : `id`, `clinic_id`, `user_id`, `permission_code`, `allowed`, `assigned_by`, `reason`, `expires_at` ?, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,user_id,permission_code)`.

| FK locale | Relation cible |
| --- | --- |
| `(permission_code)` | `permissions(code)` |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,user_id)` | `users(clinic_id,id)` |
| `(clinic_id,assigned_by)` | `users(clinic_id,id)` |

**Contrôles CHECK** : 2 ; expressions exactes dans le SQL et le catalogue.
### approvals

Autorisation liée au contenu exact ; cibles polymorphes vérifiées par action.

**Attributs** : `id`, `clinic_id`, `action_code`, `target_type`, `target_id`, `payload_hash`, `requested_by`, `reason`, `status`, `decided_by` ?, `decided_at` ?, `expires_at` ?, `consumed_at` ?, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,requested_by)` | `users(clinic_id,id)` |
| `(clinic_id,decided_by)` | `users(clinic_id,id)` |

**Contrôles CHECK** : 4 ; expressions exactes dans le SQL et le catalogue.
### audit_events

Journal append-only ; pas de contenu clinique brut dans log général.

**Attributs** : `id`, `clinic_id`, `actor_id` ?, `actor_name_snapshot`, `action`, `target_type`, `target_id` ?, `recorded_at`, `correlation_id`, `reason` ?, `sanitized_diff` ?, `previous_hash` ?, `event_hash`, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,actor_id)` | `users(clinic_id,id)` |

**Contrôles CHECK** : 2 ; expressions exactes dans le SQL et le catalogue.

**Historique** : append-only, UPDATE/DELETE refusés par le script 04.
### idempotency_requests

Même commande et hash produisent le même résultat.

**Attributs** : `id`, `clinic_id`, `namespace`, `command_name`, `request_key`, `payload_hash`, `status`, `result_type` ?, `result_id` ?, `result_payload` ?, `completed_at` ?, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,namespace,command_name,request_key)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |

**Contrôles CHECK** : 3 ; expressions exactes dans le SQL et le catalogue.

## Documents et exploitation

### stored_files

Fichier privé ou publication approuvée, métadonnées sans secret.

**Attributs** : `id`, `clinic_id`, `private_path`, `mime_type`, `size_bytes`, `sha256`, `classification`, `encryption_key_id` ?, `uploaded_by`, `archived_at` ?, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,private_path)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,uploaded_by)` | `users(clinic_id,id)` |

**Contrôles CHECK** : 2 ; expressions exactes dans le SQL et le catalogue.
### document_sequences

High-water central incluant toutes plages hors-ligne réservées.

**Attributs** : `id`, `clinic_id`, `document_type`, `document_year`, `last_value`, `version`, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,document_type,document_year)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |

**Contrôles CHECK** : 3 ; expressions exactes dans le SQL et le catalogue.
### document_number_usages

Registre immuable de consommation de numéro, cible vérifiée par commande.

**Attributs** : `id`, `clinic_id`, `allocation_id` ?, `document_type`, `document_year`, `number_value`, `rendered_number`, `entity_type`, `entity_id`, `source_device_id` ?, `actor_id`, `consumed_at`, `status`, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,document_type,document_year,number_value)`; `(clinic_id,document_type,rendered_number)`; `(clinic_id,id,document_type)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,allocation_id)` | `document_number_allocations(clinic_id,id)` |
| `(clinic_id,source_device_id)` | `enrolled_devices(clinic_id,id)` |
| `(clinic_id,actor_id)` | `users(clinic_id,id)` |

**Contrôles CHECK** : 5 ; expressions exactes dans le SQL et le catalogue.

**Historique** : append-only, UPDATE/DELETE refusés par le script 04.
### generated_documents

Source typée et fichier original privé à chaque version.

**Attributs** : `id`, `clinic_id`, `document_type`, `invoice_id` ?, `receipt_id` ?, `credit_note_id` ?, `refund_id` ?, `prescription_id` ?, `clinical_revision_id` ?, `workshop_order_id` ?, `patient_id` ?, `quote_id` ?, `source_key`, `revision_no`, `template_version`, `file_id` ?, `sha256` ?, `status`, `generated_at` ?, `failure_code` ?, `source_device_id` ?, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,document_type,source_key,revision_no,template_version)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,invoice_id)` | `invoices(clinic_id,id)` |
| `(clinic_id,receipt_id)` | `receipts(clinic_id,id)` |
| `(clinic_id,credit_note_id)` | `credit_notes(clinic_id,id)` |
| `(clinic_id,refund_id)` | `refunds(clinic_id,id)` |
| `(clinic_id,prescription_id)` | `optical_prescriptions(clinic_id,id)` |
| `(clinic_id,clinical_revision_id)` | `clinical_revisions(clinic_id,id)` |
| `(clinic_id,workshop_order_id)` | `workshop_orders(clinic_id,id)` |
| `(clinic_id,patient_id)` | `patient_records(clinic_id,id)` |
| `(clinic_id,quote_id)` | `quotes(clinic_id,id)` |
| `(clinic_id,file_id)` | `stored_files(clinic_id,id)` |
| `(clinic_id,source_device_id)` | `enrolled_devices(clinic_id,id)` |

**Contrôles CHECK** : 5 ; expressions exactes dans le SQL et le catalogue.

**Historique** : garde de cycle de vie `ready_document` dans le script 04.
### export_requests

Export contrôlé de données/archives, jamais fichier public par défaut.

**Attributs** : `id`, `clinic_id`, `requested_by`, `export_type`, `patient_id` ?, `filters` ?, `status`, `file_id` ?, `completed_at` ?, `expires_at` ?, `error_code` ?, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,requested_by)` | `users(clinic_id,id)` |
| `(clinic_id,patient_id)` | `patient_records(clinic_id,id)` |
| `(clinic_id,file_id)` | `stored_files(clinic_id,id)` |

**Contrôles CHECK** : 6 ; expressions exactes dans le SQL et le catalogue.
### backup_runs

Journal de backup, pas la sauvegarde elle-même.

**Attributs** : `id`, `clinic_id`, `scope`, `device_id` ?, `started_at`, `completed_at` ?, `status`, `private_destination` ?, `sha256` ?, `size_bytes` ?, `encryption_key_id` ?, `error_code` ?, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,device_id)` | `enrolled_devices(clinic_id,id)` |

**Contrôles CHECK** : 5 ; expressions exactes dans le SQL et le catalogue.
### restore_tests

Preuve de restauration serveur ou poste, contrôles et durée.

**Attributs** : `id`, `clinic_id`, `backup_run_id`, `started_at`, `completed_at` ?, `status`, `tested_by`, `checks` ?, `observations` ?, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,backup_run_id)` | `backup_runs(clinic_id,id)` |
| `(clinic_id,tested_by)` | `users(clinic_id,id)` |

**Contrôles CHECK** : 4 ; expressions exactes dans le SQL et le catalogue.

## Patients et clinique

### patient_records

Identité durable, téléphone non unique et naissance connue ou absence expliquée.

**Attributs** : `id`, `clinic_id`, `record_number`, `last_name`, `first_names` ?, `sex`, `birth_date` ?, `birth_date_missing_reason` ?, `phone_primary` ?, `phone_primary_normalized` ?, `phone_secondary` ?, `phone_secondary_normalized` ?, `phone_missing_reason` ?, `name_search`, `address` ?, `profession` ?, `guardian_contact` ?, `legacy_record`, `first_known_visit_on` ?, `first_visit_certified`, `legacy_record_number` ?, `archived_at` ?, `merged_into_patient_id` ?, `created_by`, `version`, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,record_number)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,merged_into_patient_id)` | `patient_records(clinic_id,id)` |
| `(clinic_id,created_by)` | `users(clinic_id,id)` |

**Contrôles CHECK** : 8 ; expressions exactes dans le SQL et le catalogue.
### patient_merges

Fusion manuelle traçable avec ancienne identité conservée.

**Attributs** : `id`, `clinic_id`, `source_patient_id`, `survivor_patient_id`, `approved_by`, `merged_at`, `reason`, `snapshot`, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,source_patient_id)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,source_patient_id)` | `patient_records(clinic_id,id)` |
| `(clinic_id,survivor_patient_id)` | `patient_records(clinic_id,id)` |
| `(clinic_id,approved_by)` | `users(clinic_id,id)` |

**Contrôles CHECK** : 3 ; expressions exactes dans le SQL et le catalogue.

**Historique** : append-only, UPDATE/DELETE refusés par le script 04.
### visits

Passage examen/achat/retrait/suivi ; zéro ou une consultation.

**Attributs** : `id`, `clinic_id`, `patient_id`, `reason`, `occurred_at`, `status`, `appointment_id` ?, `exam_invoice_id` ?, `exam_waiver_approval_id` ?, `arrival_at` ?, `closed_at` ?, `administrative_note` ?, `created_by`, `version`, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,id,patient_id)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id,exam_invoice_id,id,patient_id)` | `invoices(clinic_id,id,visit_id,patient_id)` |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,patient_id)` | `patient_records(clinic_id,id)` |
| `(clinic_id,appointment_id)` | `appointments(clinic_id,id)` |
| `(clinic_id,exam_invoice_id)` | `invoices(clinic_id,id)` |
| `(clinic_id,exam_waiver_approval_id)` | `approvals(clinic_id,id)` |
| `(clinic_id,created_by)` | `users(clinic_id,id)` |

**Contrôles CHECK** : 3 ; expressions exactes dans le SQL et le catalogue.
### consultations

Examen clinique avec mesures et versions distinctes des ventes.

**Attributs** : `id`, `clinic_id`, `visit_id`, `patient_id`, `clinician_id`, `effective_at`, `date_change_reason` ?, `status`, `current_revision`, `symptoms` ?, `wears_glasses` ?, `glasses_duration` ?, `previous_correction_available` ?, `refraction_observations` ?, `conclusion` ?, `referral` ?, `referral_urgency` ?, `finalization_missing_data_reason` ?, `completed_at` ?, `version`, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,visit_id)`; `(clinic_id,id,patient_id)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id,visit_id,patient_id)` | `visits(clinic_id,id,patient_id)` |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,visit_id)` | `visits(clinic_id,id)` |
| `(clinic_id,patient_id)` | `patient_records(clinic_id,id)` |
| `(clinic_id,clinician_id)` | `users(clinic_id,id)` |

**Contrôles CHECK** : 8 ; expressions exactes dans le SQL et le catalogue.
### consultation_complaints

Motifs en sélection multiple, Autre expliqué.

**Attributs** : `id`, `clinic_id`, `consultation_id`, `term_group`, `term_code`, `other_text` ?, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,consultation_id,term_code)`.

| FK locale | Relation cible |
| --- | --- |
| `(term_group,term_code)` | `clinical_terms(group_code,code)` |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,consultation_id)` | `consultations(clinic_id,id)` |

**Contrôles CHECK** : 3 ; expressions exactes dans le SQL et le catalogue.
### consultation_histories

État des antécédents constaté pour cette consultation.

**Attributs** : `id`, `clinic_id`, `consultation_id`, `history_group`, `known_none`, `comments` ?, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,consultation_id,history_group)`; `(clinic_id,id,history_group)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,consultation_id)` | `consultations(clinic_id,id)` |

**Contrôles CHECK** : 3 ; expressions exactes dans le SQL et le catalogue.
### consultation_history_terms

Antécédents positifs normalisés ; exclusivité Aucun connu contrôlée à transaction.

**Attributs** : `id`, `clinic_id`, `history_id`, `term_group`, `term_code`, `other_text` ?, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,history_id,term_code)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id,history_id,term_group)` | `consultation_histories(clinic_id,id,history_group)` |
| `(term_group,term_code)` | `clinical_terms(group_code,code)` |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,history_id)` | `consultation_histories(clinic_id,id)` |

**Contrôles CHECK** : 4 ; expressions exactes dans le SQL et le catalogue.
### consultation_ametropias

Amétropies choisies par professionnel, sans inférence médicale.

**Attributs** : `id`, `clinic_id`, `consultation_id`, `term_group`, `term_code`, `other_text` ?, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,consultation_id,term_code)`.

| FK locale | Relation cible |
| --- | --- |
| `(term_group,term_code)` | `clinical_terms(group_code,code)` |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,consultation_id)` | `consultations(clinic_id,id)` |

**Contrôles CHECK** : 3 ; expressions exactes dans le SQL et le catalogue.
### consultation_referral_reasons

Motifs d’orientation en sélection multiple.

**Attributs** : `id`, `clinic_id`, `consultation_id`, `term_group`, `term_code`, `other_text` ?, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,consultation_id,term_code)`.

| FK locale | Relation cible |
| --- | --- |
| `(term_group,term_code)` | `clinical_terms(group_code,code)` |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,consultation_id)` | `consultations(clinic_id,id)` |

**Contrôles CHECK** : 3 ; expressions exactes dans le SQL et le catalogue.
### visual_acuity_scales

Échelles configurées par cabinet, aucune conversion présumée.

**Attributs** : `id`, `clinic_id`, `code`, `label`, `description` ?, `active`, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,code)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |

**Contrôles CHECK** : 2 ; expressions exactes dans le SQL et le catalogue.
### visual_acuities

12 acuités préliminaires et 3 post-réfraction distinctes.

**Attributs** : `id`, `clinic_id`, `consultation_id`, `context`, `distance`, `correction`, `eye`, `scale_id`, `raw_value`, `normalized_value` ?, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,consultation_id,context,distance,correction,eye)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,consultation_id)` | `consultations(clinic_id,id)` |
| `(clinic_id,scale_id)` | `visual_acuity_scales(clinic_id,id)` |

**Contrôles CHECK** : 6 ; expressions exactes dans le SQL et le catalogue.
### refraction_measurements

Mesures AUTOREFRACTOR/OBJECTIVE/SUBJECTIVE séparées par œil.

**Attributs** : `id`, `clinic_id`, `consultation_id`, `stage`, `eye`, `sphere` ?, `cylinder` ?, `axis` ?, `addition` ?, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,consultation_id,stage,eye)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,consultation_id)` | `consultations(clinic_id,id)` |

**Contrôles CHECK** : 5 ; expressions exactes dans le SQL et le catalogue.
### autorefractor_centering

Écart pupillaire objectif total/monoculaire en mm.

**Attributs** : `id`, `clinic_id`, `consultation_id`, `pd_total` ?, `pd_od` ?, `pd_og` ?, `inconsistency_reason` ?, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,consultation_id)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,consultation_id)` | `consultations(clinic_id,id)` |

**Contrôles CHECK** : 4 ; expressions exactes dans le SQL et le catalogue.
### clinical_revisions

Snapshot complet immuable après finalisation ou correction.

**Attributs** : `id`, `clinic_id`, `consultation_id`, `revision_no`, `snapshot`, `reason`, `author_id`, `recorded_at`, `previous_revision_id` ?, `sha256`, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,consultation_id,revision_no)`; `(clinic_id,id,consultation_id)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id,previous_revision_id,consultation_id)` | `clinical_revisions(clinic_id,id,consultation_id)` |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,consultation_id)` | `consultations(clinic_id,id)` |
| `(clinic_id,author_id)` | `users(clinic_id,id)` |
| `(clinic_id,previous_revision_id)` | `clinical_revisions(clinic_id,id)` |

**Contrôles CHECK** : 3 ; expressions exactes dans le SQL et le catalogue.

**Historique** : append-only, UPDATE/DELETE refusés par le script 04.
### optical_prescriptions

Prescription optique décisionnelle, indépendante des mesures.

**Attributs** : `id`, `clinic_id`, `patient_id`, `series_id`, `origin`, `external_file_id` ?, `external_prescriber` ?, `external_prescribed_on` ?, `consultation_id` ?, `version_no`, `status`, `usage_group`, `usage_code` ?, `usage_other` ?, `lens_type_group`, `lens_type_code` ?, `lens_type_other` ?, `lens_index` ?, `lens_index_other` ?, `pd_total` ?, `pd_od` ?, `pd_og` ?, `pd_inconsistency_reason` ?, `notes` ?, `validated_at` ?, `validated_by` ?, `supersedes_id` ?, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,consultation_id,version_no)`; `(clinic_id,id,consultation_id)`; `(clinic_id,series_id,version_no)`; `(clinic_id,id,patient_id,series_id)`; `(clinic_id,id,patient_id)`.

| FK locale | Relation cible |
| --- | --- |
| `(usage_group,usage_code)` | `clinical_terms(group_code,code)` |
| `(lens_type_group,lens_type_code)` | `clinical_terms(group_code,code)` |
| `(clinic_id,supersedes_id,consultation_id)` | `optical_prescriptions(clinic_id,id,consultation_id)` |
| `(clinic_id,consultation_id,patient_id)` | `consultations(clinic_id,id,patient_id)` |
| `(clinic_id,supersedes_id,patient_id,series_id)` | `optical_prescriptions(clinic_id,id,patient_id,series_id)` |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,patient_id)` | `patient_records(clinic_id,id)` |
| `(clinic_id,external_file_id)` | `stored_files(clinic_id,id)` |
| `(clinic_id,consultation_id)` | `consultations(clinic_id,id)` |
| `(clinic_id,validated_by)` | `users(clinic_id,id)` |
| `(clinic_id,supersedes_id)` | `optical_prescriptions(clinic_id,id)` |

**Contrôles CHECK** : 11 ; expressions exactes dans le SQL et le catalogue.

**Historique** : garde de cycle de vie `validated` dans le script 04.
### optical_prescription_eyes

OD et OG, valeurs explicites et hauteur de montage.

**Attributs** : `id`, `clinic_id`, `prescription_id`, `eye`, `no_correction`, `sphere` ?, `cylinder` ?, `axis` ?, `addition` ?, `fitting_height` ?, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,prescription_id,eye)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,prescription_id)` | `optical_prescriptions(clinic_id,id)` |

**Contrôles CHECK** : 6 ; expressions exactes dans le SQL et le catalogue.

**Historique** : garde de cycle de vie `prescription_child` dans le script 04.
### optical_prescription_treatments

Traitements DP plus HMC de PC.

**Attributs** : `id`, `clinic_id`, `prescription_id`, `term_group`, `term_code`, `other_text` ?, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,prescription_id,term_code)`.

| FK locale | Relation cible |
| --- | --- |
| `(term_group,term_code)` | `clinical_terms(group_code,code)` |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,prescription_id)` | `optical_prescriptions(clinic_id,id)` |

**Contrôles CHECK** : 3 ; expressions exactes dans le SQL et le catalogue.

**Historique** : garde de cycle de vie `prescription_child` dans le script 04.
### medication_orders

Médicaments prescrits sans création automatique de vente.

**Attributs** : `id`, `clinic_id`, `consultation_id`, `position`, `catalog_item_id` ?, `name`, `form`, `form_other` ?, `strength` ?, `dosage` ?, `frequency` ?, `duration_text` ?, `duration_value` ?, `duration_unit` ?, `instructions` ?, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,consultation_id,position)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,consultation_id)` | `consultations(clinic_id,id)` |
| `(clinic_id,catalog_item_id)` | `catalog_items(clinic_id,id)` |

**Contrôles CHECK** : 6 ; expressions exactes dans le SQL et le catalogue.

## CRM et assistant

### prospect_contacts

Prospect commercial distinct d’un dossier médical, liaison explicite.

**Attributs** : `id`, `clinic_id`, `name`, `phone` ?, `phone_normalized` ?, `email` ?, `patient_id` ?, `origin`, `administrative_notes` ?, `created_by`, `version`, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,patient_id)` | `patient_records(clinic_id,id)` |
| `(clinic_id,created_by)` | `users(clinic_id,id)` |

**Contrôles CHECK** : 2 ; expressions exactes dans le SQL et le catalogue.
### crm_leads

Pipeline Kommo, besoin/budget administratif et liaison prospect.

**Attributs** : `id`, `clinic_id`, `prospect_contact_id`, `integration_account_id`, `external_lead_id`, `pipeline_id` ?, `pipeline_stage`, `product_interest` ?, `budget_min` ?, `budget_max` ?, `acquisition_source` ?, `assigned_to` ?, `status`, `last_synced_at` ?, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,integration_account_id,external_lead_id)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,prospect_contact_id)` | `prospect_contacts(clinic_id,id)` |
| `(clinic_id,integration_account_id)` | `integration_accounts(clinic_id,id)` |
| `(clinic_id,assigned_to)` | `users(clinic_id,id)` |

**Contrôles CHECK** : 5 ; expressions exactes dans le SQL et le catalogue.
### crm_conversations

Métadonnées de conversation ; Kommo reste maître du fil intégral.

**Attributs** : `id`, `clinic_id`, `crm_lead_id`, `integration_account_id`, `external_conversation_id`, `channel`, `status`, `human_owner_id` ?, `takeover_at` ?, `takeover_reason` ?, `administrative_summary` ?, `bot_resumed_at` ?, `bot_resumed_by` ?, `last_activity_at` ?, `version`, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,integration_account_id,external_conversation_id)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,crm_lead_id)` | `crm_leads(clinic_id,id)` |
| `(clinic_id,integration_account_id)` | `integration_accounts(clinic_id,id)` |
| `(clinic_id,human_owner_id)` | `users(clinic_id,id)` |
| `(clinic_id,bot_resumed_by)` | `users(clinic_id,id)` |

**Contrôles CHECK** : 4 ; expressions exactes dans le SQL et le catalogue.
### conversation_handoffs

Historique du transfert/reprise humaine, sans réécrire l’état passé.

**Attributs** : `id`, `clinic_id`, `conversation_id`, `event_type`, `actor_id` ?, `reason`, `administrative_summary` ?, `occurred_at`, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,conversation_id)` | `crm_conversations(clinic_id,id)` |
| `(clinic_id,actor_id)` | `users(clinic_id,id)` |

**Contrôles CHECK** : 2 ; expressions exactes dans le SQL et le catalogue.

**Historique** : append-only, UPDATE/DELETE refusés par le script 04.
### knowledge_entries

FAQ et réponses types publiques éditables et versionnées.

**Attributs** : `id`, `clinic_id`, `code`, `title`, `category`, `active`, `version`, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,code)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |

**Contrôles CHECK** : 3 ; expressions exactes dans le SQL et le catalogue.
### knowledge_entry_versions

Version validée/publication d’une réponse, pas d’ordonnance IA.

**Attributs** : `id`, `clinic_id`, `entry_id`, `revision_no`, `content`, `language`, `authored_by`, `approved_by` ?, `approved_at` ?, `published_at` ?, `retired_at` ?, `active_entry_key` ?, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,entry_id,revision_no)`; `(clinic_id,active_entry_key)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,entry_id)` | `knowledge_entries(clinic_id,id)` |
| `(clinic_id,authored_by)` | `users(clinic_id,id)` |
| `(clinic_id,approved_by)` | `users(clinic_id,id)` |

**Contrôles CHECK** : 3 ; expressions exactes dans le SQL et le catalogue.
### assistant_runs

Audit technique IA minimal, modèle/coût/outils sans dossier médical.

**Attributs** : `id`, `clinic_id`, `conversation_id`, `engine_name`, `model_name`, `rules_version`, `started_at`, `completed_at` ?, `status`, `input_tokens` ?, `output_tokens` ?, `knowledge_version_ids` ?, `sanitized_tool_results` ?, `error_code` ?, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,conversation_id)` | `crm_conversations(clinic_id,id)` |

**Contrôles CHECK** : 5 ; expressions exactes dans le SQL et le catalogue.

## Agenda et suivi

### scheduling_resources

Professionnel ou ressource du cabinet.

**Attributs** : `id`, `clinic_id`, `name`, `professional_user_id` ?, `active`, `slot_duration_minutes`, `version`, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,professional_user_id)` | `users(clinic_id,id)` |

**Contrôles CHECK** : 3 ; expressions exactes dans le SQL et le catalogue.
### appointment_services

Prestation réservable, tarif métier éventuel et durée.

**Attributs** : `id`, `clinic_id`, `name`, `duration_minutes`, `catalog_item_id` ?, `active`, `public_booking`, `version`, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,catalog_item_id)` | `catalog_items(clinic_id,id)` |

**Contrôles CHECK** : 4 ; expressions exactes dans le SQL et le catalogue.
### resource_opening_hours

Créneaux hebdomadaires par ressource ; aucune semaine inventée.

**Attributs** : `id`, `clinic_id`, `resource_id`, `weekday`, `opens_at`, `closes_at`, `valid_from` ?, `valid_to` ?, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,resource_id)` | `scheduling_resources(clinic_id,id)` |

**Contrôles CHECK** : 4 ; expressions exactes dans le SQL et le catalogue.
### resource_exceptions

Fermeture ou ouverture exceptionnelle datée.

**Attributs** : `id`, `clinic_id`, `resource_id`, `starts_at`, `ends_at`, `is_available`, `reason`, `created_by`, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,resource_id)` | `scheduling_resources(clinic_id,id)` |
| `(clinic_id,created_by)` | `users(clinic_id,id)` |

**Contrôles CHECK** : 3 ; expressions exactes dans le SQL et le catalogue.
### appointments

Créneau confirmé ou proposition offline, distinct du contrôle recommandé.

**Attributs** : `id`, `clinic_id`, `patient_id` ?, `prospect_contact_id` ?, `follow_up_id` ?, `resource_id`, `service_id`, `starts_at`, `ends_at`, `status`, `source`, `administrative_reason` ?, `cancel_reason` ?, `created_by`, `version`, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id,follow_up_id,patient_id)` | `follow_up_plans(clinic_id,id,patient_id)` |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,patient_id)` | `patient_records(clinic_id,id)` |
| `(clinic_id,prospect_contact_id)` | `prospect_contacts(clinic_id,id)` |
| `(clinic_id,follow_up_id)` | `follow_up_plans(clinic_id,id)` |
| `(clinic_id,resource_id)` | `scheduling_resources(clinic_id,id)` |
| `(clinic_id,service_id)` | `appointment_services(clinic_id,id)` |
| `(clinic_id,created_by)` | `users(clinic_id,id)` |

**Contrôles CHECK** : 6 ; expressions exactes dans le SQL et le catalogue.
### calendar_blocks

Indisponibilités internes et externes sans contenu clinique.

**Attributs** : `id`, `clinic_id`, `resource_id`, `starts_at`, `ends_at`, `origin`, `label` ?, `external_link_id` ?, `created_by` ?, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,resource_id)` | `scheduling_resources(clinic_id,id)` |
| `(clinic_id,external_link_id)` | `external_links(clinic_id,id)` |
| `(clinic_id,created_by)` | `users(clinic_id,id)` |

**Contrôles CHECK** : 3 ; expressions exactes dans le SQL et le catalogue.
### follow_up_plans

Contrôle recommandé, pas une réservation implicite.

**Attributs** : `id`, `clinic_id`, `consultation_id`, `patient_id`, `reason`, `anchor_kind`, `anchor_date`, `interval_value` ?, `interval_unit` ?, `recommended_date`, `date_origin`, `manual_reason` ?, `reminder_enabled`, `preferred_channel`, `advance_value` ?, `advance_unit` ?, `notes` ?, `status`, `version`, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,id,patient_id)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id,consultation_id,patient_id)` | `consultations(clinic_id,id,patient_id)` |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,consultation_id)` | `consultations(clinic_id,id)` |
| `(clinic_id,patient_id)` | `patient_records(clinic_id,id)` |

**Contrôles CHECK** : 13 ; expressions exactes dans le SQL et le catalogue.

## Catalogue et facturation

### tax_rules

Régime validé par gérante/comptable, aucun taux fiscal seedé.

**Attributs** : `id`, `clinic_id`, `code`, `label`, `rate_percent` ?, `active`, `validated_by` ?, `validated_at` ?, `legal_note` ?, `version`, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,code)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,validated_by)` | `users(clinic_id,id)` |

**Contrôles CHECK** : 4 ; expressions exactes dans le SQL et le catalogue.
### catalog_items

Catalogue commun prestations, montures, verres, lentilles, collyres et soins.

**Attributs** : `id`, `clinic_id`, `reference`, `category_code`, `name`, `brand` ?, `model` ?, `unit_code`, `quantity_integer_only`, `sale_price`, `purchase_cost` ?, `tax_rule_id` ?, `stock_mode`, `requires_expiry`, `low_stock_threshold` ?, `expiry_alert_days` ?, `active`, `public_visibility`, `version`, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,reference)`.

| FK locale | Relation cible |
| --- | --- |
| `(category_code)` | `catalog_categories(code)` |
| `(unit_code)` | `units(code)` |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,tax_rule_id)` | `tax_rules(clinic_id,id)` |

**Contrôles CHECK** : 10 ; expressions exactes dans le SQL et le catalogue.
### quotes

Devis cité PC, option de fonctionnement sans dette ni encaissement.

**Attributs** : `id`, `clinic_id`, `patient_id` ?, `prospect_contact_id` ?, `number` ?, `status`, `valid_until` ?, `total_gross`, `recipient_snapshot` ?, `created_by`, `issued_at` ?, `version`, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,number)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,patient_id)` | `patient_records(clinic_id,id)` |
| `(clinic_id,prospect_contact_id)` | `prospect_contacts(clinic_id,id)` |
| `(clinic_id,created_by)` | `users(clinic_id,id)` |

**Contrôles CHECK** : 5 ; expressions exactes dans le SQL et le catalogue.
### quote_lines

Lignes de devis, prix figés dans la version remise.

**Attributs** : `id`, `clinic_id`, `quote_id`, `position`, `catalog_item_id` ?, `description_snapshot`, `unit_code`, `quantity`, `unit_price_gross`, `discount_gross`, `line_total_gross`, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,quote_id,position)`.

| FK locale | Relation cible |
| --- | --- |
| `(unit_code)` | `units(code)` |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,quote_id)` | `quotes(clinic_id,id)` |
| `(clinic_id,catalog_item_id)` | `catalog_items(clinic_id,id)` |

**Contrôles CHECK** : 8 ; expressions exactes dans le SQL et le catalogue.
### invoices

Facture ou créance restante papier, jamais solde éditable.

**Attributs** : `id`, `clinic_id`, `patient_id`, `visit_id` ?, `quote_id` ?, `number` ?, `issued_at` ?, `issued_by` ?, `number_usage_id` ?, `status`, `due_date` ?, `currency`, `total_gross`, `patient_snapshot` ?, `clinic_snapshot` ?, `tax_snapshot` ?, `origin`, `legacy_reference` ?, `legacy_opening_balance` ?, `source_invoice_id` ?, `created_by`, `source_device_id` ?, `version`, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,number)`; `(clinic_id,number_usage_id)`; `(clinic_id,id,patient_id)`; `(clinic_id,id,visit_id,patient_id)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id,visit_id,patient_id)` | `visits(clinic_id,id,patient_id)` |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,patient_id)` | `patient_records(clinic_id,id)` |
| `(clinic_id,visit_id)` | `visits(clinic_id,id)` |
| `(clinic_id,quote_id)` | `quotes(clinic_id,id)` |
| `(clinic_id,issued_by)` | `users(clinic_id,id)` |
| `(clinic_id,number_usage_id)` | `document_number_usages(clinic_id,id)` |
| `(clinic_id,source_invoice_id)` | `invoices(clinic_id,id)` |
| `(clinic_id,created_by)` | `users(clinic_id,id)` |
| `(clinic_id,source_device_id)` | `enrolled_devices(clinic_id,id)` |

**Contrôles CHECK** : 11 ; expressions exactes dans le SQL et le catalogue.

**Historique** : garde de cycle de vie `issued` dans le script 04.
### invoice_lines

Lignes exactes, données de catalogue conservées à émission.

**Attributs** : `id`, `clinic_id`, `patient_id`, `invoice_id`, `position`, `catalog_item_id` ?, `reference_snapshot` ?, `description_snapshot`, `category_snapshot`, `unit_snapshot`, `quantity`, `unit_price_gross`, `discount_gross`, `line_total_gross`, `tax_code_snapshot`, `tax_rate_snapshot` ?, `tax_amount` ?, `prescription_id` ?, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,invoice_id,position)`; `(clinic_id,id,invoice_id)`; `(clinic_id,id,catalog_item_id)`; `(clinic_id,id,patient_id)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id,invoice_id,patient_id)` | `invoices(clinic_id,id,patient_id)` |
| `(clinic_id,prescription_id,patient_id)` | `optical_prescriptions(clinic_id,id,patient_id)` |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,patient_id)` | `patient_records(clinic_id,id)` |
| `(clinic_id,invoice_id)` | `invoices(clinic_id,id)` |
| `(clinic_id,catalog_item_id)` | `catalog_items(clinic_id,id)` |
| `(clinic_id,prescription_id)` | `optical_prescriptions(clinic_id,id)` |

**Contrôles CHECK** : 11 ; expressions exactes dans le SQL et le catalogue.

**Historique** : garde de cycle de vie `invoice_child` dans le script 04.
### payments

Un encaissement, confirmation humaine ou attente, jamais taxe/caisse supposée.

**Attributs** : `id`, `clinic_id`, `invoice_id`, `amount`, `method`, `reference` ?, `effective_at`, `status`, `confirmed_at` ?, `cash_session_id` ?, `received_by`, `idempotency_id`, `source_device_id` ?, `sync_command_id` ?, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,idempotency_id)`; `(clinic_id,id,invoice_id)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,invoice_id)` | `invoices(clinic_id,id)` |
| `(clinic_id,cash_session_id)` | `cash_sessions(clinic_id,id)` |
| `(clinic_id,received_by)` | `users(clinic_id,id)` |
| `(clinic_id,idempotency_id)` | `idempotency_requests(clinic_id,id)` |
| `(clinic_id,source_device_id)` | `enrolled_devices(clinic_id,id)` |
| `(clinic_id,sync_command_id)` | `sync_commands(clinic_id,id)` |

**Contrôles CHECK** : 7 ; expressions exactes dans le SQL et le catalogue.

**Historique** : garde de cycle de vie `confirmed_payment` dans le script 04.
### receipts

Exactement une pièce par encaissement confirmé ; original figé.

**Attributs** : `id`, `clinic_id`, `payment_id`, `invoice_id`, `number`, `number_usage_id`, `issued_at`, `issued_by`, `snapshot`, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,payment_id)`; `(clinic_id,number)`; `(clinic_id,number_usage_id)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id,payment_id,invoice_id)` | `payments(clinic_id,id,invoice_id)` |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,payment_id)` | `payments(clinic_id,id)` |
| `(clinic_id,invoice_id)` | `invoices(clinic_id,id)` |
| `(clinic_id,number_usage_id)` | `document_number_usages(clinic_id,id)` |
| `(clinic_id,issued_by)` | `users(clinic_id,id)` |

**Contrôles CHECK** : 2 ; expressions exactes dans le SQL et le catalogue.

**Historique** : append-only, UPDATE/DELETE refusés par le script 04.
### payment_reversals

Contre-écriture d’un paiement enregistré à tort, pas remboursement cash.

**Attributs** : `id`, `clinic_id`, `payment_id`, `amount`, `reason`, `approval_id`, `recorded_at`, `created_by`, `idempotency_id`, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,idempotency_id)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,payment_id)` | `payments(clinic_id,id)` |
| `(clinic_id,approval_id)` | `approvals(clinic_id,id)` |
| `(clinic_id,created_by)` | `users(clinic_id,id)` |
| `(clinic_id,idempotency_id)` | `idempotency_requests(clinic_id,id)` |

**Contrôles CHECK** : 3 ; expressions exactes dans le SQL et le catalogue.

**Historique** : append-only, UPDATE/DELETE refusés par le script 04.
### credit_notes

Avoir corrige créance, jamais automatiquement un retour physique.

**Attributs** : `id`, `clinic_id`, `invoice_id`, `number` ?, `issued_at` ?, `issued_by` ?, `number_usage_id` ?, `status`, `amount_gross`, `reason`, `approval_id`, `snapshot` ?, `idempotency_id`, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,number)`; `(clinic_id,number_usage_id)`; `(clinic_id,idempotency_id)`; `(clinic_id,id,invoice_id)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,invoice_id)` | `invoices(clinic_id,id)` |
| `(clinic_id,issued_by)` | `users(clinic_id,id)` |
| `(clinic_id,number_usage_id)` | `document_number_usages(clinic_id,id)` |
| `(clinic_id,approval_id)` | `approvals(clinic_id,id)` |
| `(clinic_id,idempotency_id)` | `idempotency_requests(clinic_id,id)` |

**Contrôles CHECK** : 6 ; expressions exactes dans le SQL et le catalogue.

**Historique** : garde de cycle de vie `issued` dans le script 04.
### credit_note_lines

Correction plafonnée aux lignes d’origine par commande transactionnelle.

**Attributs** : `id`, `clinic_id`, `credit_note_id`, `invoice_id`, `invoice_line_id`, `quantity` ?, `amount_gross`, `tax_amount` ?, `reason` ?, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id,credit_note_id,invoice_id)` | `credit_notes(clinic_id,id,invoice_id)` |
| `(clinic_id,invoice_line_id,invoice_id)` | `invoice_lines(clinic_id,id,invoice_id)` |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,credit_note_id)` | `credit_notes(clinic_id,id)` |
| `(clinic_id,invoice_id)` | `invoices(clinic_id,id)` |
| `(clinic_id,invoice_line_id)` | `invoice_lines(clinic_id,id)` |

**Contrôles CHECK** : 6 ; expressions exactes dans le SQL et le catalogue.

**Historique** : garde de cycle de vie `credit_child` dans le script 04.
### refunds

Remboursement réel autorisé, indépendant d’une contre-écriture.

**Attributs** : `id`, `clinic_id`, `invoice_id`, `credit_note_id`, `amount`, `method`, `reference` ?, `approval_id`, `number`, `number_usage_id`, `effective_at`, `cash_session_id` ?, `idempotency_id`, `created_by`, `snapshot`, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,number)`; `(clinic_id,number_usage_id)`; `(clinic_id,idempotency_id)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id,credit_note_id,invoice_id)` | `credit_notes(clinic_id,id,invoice_id)` |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,invoice_id)` | `invoices(clinic_id,id)` |
| `(clinic_id,credit_note_id)` | `credit_notes(clinic_id,id)` |
| `(clinic_id,approval_id)` | `approvals(clinic_id,id)` |
| `(clinic_id,number_usage_id)` | `document_number_usages(clinic_id,id)` |
| `(clinic_id,cash_session_id)` | `cash_sessions(clinic_id,id)` |
| `(clinic_id,idempotency_id)` | `idempotency_requests(clinic_id,id)` |
| `(clinic_id,created_by)` | `users(clinic_id,id)` |

**Contrôles CHECK** : 6 ; expressions exactes dans le SQL et le catalogue.

**Historique** : append-only, UPDATE/DELETE refusés par le script 04.
### legacy_balance_imports

Pièce papier originale et ancien acompte conservés sans CA nouveau.

**Attributs** : `id`, `clinic_id`, `patient_id`, `invoice_id`, `paper_reference`, `original_total`, `previously_paid`, `opening_balance`, `original_invoice_on` ?, `evidence_file_id` ?, `evidence_sha256`, `validated_by`, `validated_at`, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,invoice_id)`; `(clinic_id,paper_reference)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id,invoice_id,patient_id)` | `invoices(clinic_id,id,patient_id)` |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,patient_id)` | `patient_records(clinic_id,id)` |
| `(clinic_id,invoice_id)` | `invoices(clinic_id,id)` |
| `(clinic_id,evidence_file_id)` | `stored_files(clinic_id,id)` |
| `(clinic_id,validated_by)` | `users(clinic_id,id)` |

**Contrôles CHECK** : 5 ; expressions exactes dans le SQL et le catalogue.

**Historique** : append-only, UPDATE/DELETE refusés par le script 04.
### quote_revisions

Version figée d’un devis remis ou corrigé.

**Attributs** : `id`, `clinic_id`, `quote_id`, `revision_no`, `snapshot`, `authored_by`, `recorded_at`, `reason`, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,quote_id,revision_no)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,quote_id)` | `quotes(clinic_id,id)` |
| `(clinic_id,authored_by)` | `users(clinic_id,id)` |

**Contrôles CHECK** : 3 ; expressions exactes dans le SQL et le catalogue.

**Historique** : append-only, UPDATE/DELETE refusés par le script 04.

## Caisse et rapprochement

### cash_registers

Caisse physique distincte du navigateur ou de la caissière.

**Attributs** : `id`, `clinic_id`, `code`, `name`, `active`, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,code)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |

**Contrôles CHECK** : 2 ; expressions exactes dans le SQL et le catalogue.
### cash_sessions

Session comptée, ouverture et clôture avec écart motivé.

**Attributs** : `id`, `clinic_id`, `cash_register_id`, `cashier_id`, `opened_at`, `opening_amount`, `closed_at` ?, `counted_amount` ?, `expected_amount` ?, `variance` ?, `variance_reason` ?, `closed_by` ?, `active_register_key` ?, `active_cashier_key` ?, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,active_register_key)`; `(clinic_id,active_cashier_key)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,cash_register_id)` | `cash_registers(clinic_id,id)` |
| `(clinic_id,cashier_id)` | `users(clinic_id,id)` |
| `(clinic_id,closed_by)` | `users(clinic_id,id)` |

**Contrôles CHECK** : 7 ; expressions exactes dans le SQL et le catalogue.

**Historique** : garde de cycle de vie `closed_session` dans le script 04.
### expense_categories

Catégories de dépenses validées, pas un plan comptable réglementaire.

**Attributs** : `id`, `clinic_id`, `code`, `name`, `active`, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,code)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |

**Contrôles CHECK** : 2 ; expressions exactes dans le SQL et le catalogue.
### cash_movements

Dépenses et mouvements hors vente (tiroir espèces ou hors tiroir), sans duplication paiements/refunds.

**Attributs** : `id`, `clinic_id`, `cash_session_id` ?, `kind`, `method`, `signed_amount`, `reason` ?, `approval_id` ?, `expense_category_id` ?, `reference` ?, `occurred_at`, `created_by`, `source_device_id` ?, `sync_command_id` ?, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,cash_session_id)` | `cash_sessions(clinic_id,id)` |
| `(clinic_id,approval_id)` | `approvals(clinic_id,id)` |
| `(clinic_id,expense_category_id)` | `expense_categories(clinic_id,id)` |
| `(clinic_id,created_by)` | `users(clinic_id,id)` |
| `(clinic_id,source_device_id)` | `enrolled_devices(clinic_id,id)` |
| `(clinic_id,sync_command_id)` | `sync_commands(clinic_id,id)` |

**Contrôles CHECK** : 10 ; expressions exactes dans le SQL et le catalogue.

**Historique** : append-only, UPDATE/DELETE refusés par le script 04.
### payment_reconciliations

Rapprochement d’un canal réel avec justificatifs.

**Attributs** : `id`, `clinic_id`, `method`, `period_starts_at`, `period_ends_at`, `status`, `expected_amount`, `statement_amount` ?, `statement_file_id` ?, `validated_by` ?, `validated_at` ?, `variance_reason` ?, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,statement_file_id)` | `stored_files(clinic_id,id)` |
| `(clinic_id,validated_by)` | `users(clinic_id,id)` |

**Contrôles CHECK** : 5 ; expressions exactes dans le SQL et le catalogue.
### payment_reconciliation_lines

Pièces effectivement rapprochées par canal.

**Attributs** : `id`, `clinic_id`, `reconciliation_id`, `payment_id` ?, `refund_id` ?, `external_reference` ?, `statement_amount`, `status`, `note` ?, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,reconciliation_id)` | `payment_reconciliations(clinic_id,id)` |
| `(clinic_id,payment_id)` | `payments(clinic_id,id)` |
| `(clinic_id,refund_id)` | `refunds(clinic_id,id)` |

**Contrôles CHECK** : 3 ; expressions exactes dans le SQL et le catalogue.

## Stock achats et inventaires

### stock_locations

Rayon/atelier/emplacement physique.

**Attributs** : `id`, `clinic_id`, `code`, `name`, `active`, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,code)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |

**Contrôles CHECK** : 2 ; expressions exactes dans le SQL et le catalogue.
### suppliers

Fournisseur ou laboratoire, coordonnées administratives.

**Attributs** : `id`, `clinic_id`, `name`, `reference`, `phone` ?, `email` ?, `address` ?, `is_optical_lab`, `active`, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,reference)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |

**Contrôles CHECK** : 3 ; expressions exactes dans le SQL et le catalogue.
### goods_receipts

Réception fournisseur validée et justificative.

**Attributs** : `id`, `clinic_id`, `supplier_id`, `location_id`, `supplier_reference`, `received_at`, `status`, `evidence_file_id` ?, `validated_by` ?, `validated_at` ?, `notes` ?, `created_by`, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,supplier_id,supplier_reference)`; `(clinic_id,id,location_id)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,supplier_id)` | `suppliers(clinic_id,id)` |
| `(clinic_id,location_id)` | `stock_locations(clinic_id,id)` |
| `(clinic_id,evidence_file_id)` | `stored_files(clinic_id,id)` |
| `(clinic_id,validated_by)` | `users(clinic_id,id)` |
| `(clinic_id,created_by)` | `users(clinic_id,id)` |

**Contrôles CHECK** : 3 ; expressions exactes dans le SQL et le catalogue.

**Historique** : garde de cycle de vie `validated` dans le script 04.
### stock_positions

Projection physique/réserve centrale/quota local distincts.

**Attributs** : `id`, `clinic_id`, `item_id`, `location_id`, `on_hand`, `reserved`, `offline_allocated`, `central_available`, `version`, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,item_id,location_id)`; `(clinic_id,id,item_id,location_id)`; `(clinic_id,id,item_id)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,item_id)` | `catalog_items(clinic_id,id)` |
| `(clinic_id,location_id)` | `stock_locations(clinic_id,id)` |

**Contrôles CHECK** : 5 ; expressions exactes dans le SQL et le catalogue.
### stock_lots

Lot/péremption et coût connu ; pas de vente d’un lot périmé.

**Attributs** : `id`, `clinic_id`, `item_id`, `location_id`, `stock_position_id`, `batch_number`, `expires_on` ?, `received_at`, `unit_cost` ?, `status`, `on_hand`, `reserved`, `offline_allocated`, `version`, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,item_id,location_id,batch_number)`; `(clinic_id,id,stock_position_id)`; `(clinic_id,id,item_id,location_id)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id,stock_position_id,item_id,location_id)` | `stock_positions(clinic_id,id,item_id,location_id)` |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,item_id)` | `catalog_items(clinic_id,id)` |
| `(clinic_id,location_id)` | `stock_locations(clinic_id,id)` |
| `(clinic_id,stock_position_id)` | `stock_positions(clinic_id,id)` |

**Contrôles CHECK** : 7 ; expressions exactes dans le SQL et le catalogue.
### goods_receipt_lines

Article/quantité/coût/lot reçus, une ligne par lot.

**Attributs** : `id`, `clinic_id`, `receipt_id`, `position`, `item_id`, `location_id`, `stock_lot_id` ?, `quantity`, `unit_cost` ?, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,receipt_id,position)`; `(clinic_id,id,item_id)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id,receipt_id,location_id)` | `goods_receipts(clinic_id,id,location_id)` |
| `(clinic_id,stock_lot_id,item_id,location_id)` | `stock_lots(clinic_id,id,item_id,location_id)` |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,receipt_id)` | `goods_receipts(clinic_id,id)` |
| `(clinic_id,item_id)` | `catalog_items(clinic_id,id)` |
| `(clinic_id,location_id)` | `stock_locations(clinic_id,id)` |
| `(clinic_id,stock_lot_id)` | `stock_lots(clinic_id,id)` |

**Contrôles CHECK** : 4 ; expressions exactes dans le SQL et le catalogue.

**Historique** : garde de cycle de vie `goods_child` dans le script 04.
### inventory_counts

Inventaire avec théorique figé et validation des écarts.

**Attributs** : `id`, `clinic_id`, `location_id`, `reference`, `snapshot_at`, `status`, `opened_by`, `validated_by` ?, `validated_at` ?, `approval_id` ?, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,reference)`; `(clinic_id,id,location_id)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,location_id)` | `stock_locations(clinic_id,id)` |
| `(clinic_id,opened_by)` | `users(clinic_id,id)` |
| `(clinic_id,validated_by)` | `users(clinic_id,id)` |
| `(clinic_id,approval_id)` | `approvals(clinic_id,id)` |

**Contrôles CHECK** : 3 ; expressions exactes dans le SQL et le catalogue.

**Historique** : garde de cycle de vie `validated` dans le script 04.
### inventory_count_lines

Comptage par article/lot ; lot nullable sans doublon.

**Attributs** : `id`, `clinic_id`, `inventory_id`, `item_id`, `location_id`, `stock_lot_id` ?, `lot_key`, `theoretical_quantity`, `counted_quantity` ?, `variance_quantity` ?, `variance_reason` ?, `counted_by` ?, `counted_at` ?, `adjustment_movement_id` ?, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,inventory_id,item_id,lot_key)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id,inventory_id,location_id)` | `inventory_counts(clinic_id,id,location_id)` |
| `(clinic_id,stock_lot_id,item_id,location_id)` | `stock_lots(clinic_id,id,item_id,location_id)` |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,inventory_id)` | `inventory_counts(clinic_id,id)` |
| `(clinic_id,item_id)` | `catalog_items(clinic_id,id)` |
| `(clinic_id,location_id)` | `stock_locations(clinic_id,id)` |
| `(clinic_id,stock_lot_id)` | `stock_lots(clinic_id,id)` |
| `(clinic_id,counted_by)` | `users(clinic_id,id)` |
| `(clinic_id,adjustment_movement_id)` | `stock_movements(clinic_id,id)` |

**Contrôles CHECK** : 3 ; expressions exactes dans le SQL et le catalogue.

**Historique** : garde de cycle de vie `inventory_child` dans le script 04.
### stock_reservations

Réserve de vente, centrale OU sous quota local.

**Attributs** : `id`, `clinic_id`, `item_id`, `invoice_line_id`, `stock_position_id`, `stock_lot_id` ?, `device_allocation_id` ?, `quantity`, `consumed_quantity`, `released_quantity`, `status`, `version`, `created_at`, `updated_at`, `lot_key`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,id,invoice_line_id,stock_position_id,lot_key)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id,stock_lot_id,stock_position_id)` | `stock_lots(clinic_id,id,stock_position_id)` |
| `(clinic_id,device_allocation_id,stock_position_id)` | `device_stock_allocations(clinic_id,id,stock_position_id)` |
| `(clinic_id,invoice_line_id,item_id)` | `invoice_lines(clinic_id,id,catalog_item_id)` |
| `(clinic_id,stock_position_id,item_id)` | `stock_positions(clinic_id,id,item_id)` |
| `(clinic_id,device_allocation_id,stock_position_id,lot_key)` | `device_stock_allocations(clinic_id,id,stock_position_id,lot_key)` |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,item_id)` | `catalog_items(clinic_id,id)` |
| `(clinic_id,invoice_line_id)` | `invoice_lines(clinic_id,id)` |
| `(clinic_id,stock_position_id)` | `stock_positions(clinic_id,id)` |
| `(clinic_id,stock_lot_id)` | `stock_lots(clinic_id,id)` |
| `(clinic_id,device_allocation_id)` | `device_stock_allocations(clinic_id,id)` |

**Contrôles CHECK** : 6 ; expressions exactes dans le SQL et le catalogue.
### deliveries

Remise physique liée à facture, partielle ou totale.

**Attributs** : `id`, `clinic_id`, `invoice_id`, `status`, `delivered_at` ?, `delivered_by` ?, `credit_delivery_approval_id` ?, `idempotency_id`, `patient_snapshot` ?, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,idempotency_id)`; `(clinic_id,id,invoice_id)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,invoice_id)` | `invoices(clinic_id,id)` |
| `(clinic_id,delivered_by)` | `users(clinic_id,id)` |
| `(clinic_id,credit_delivery_approval_id)` | `approvals(clinic_id,id)` |
| `(clinic_id,idempotency_id)` | `idempotency_requests(clinic_id,id)` |

**Contrôles CHECK** : 4 ; expressions exactes dans le SQL et le catalogue.

**Historique** : garde de cycle de vie `confirmed_delivery` dans le script 04.
### delivery_lines

Quantité remise non déjà livrée, stock et atelier éventuels.

**Attributs** : `id`, `clinic_id`, `item_id`, `stock_position_id` ?, `lot_key`, `delivery_id`, `invoice_id`, `invoice_line_id`, `quantity`, `stock_lot_id` ?, `workshop_order_id` ?, `reservation_id` ?, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,id,invoice_line_id)`; `(clinic_id,id,item_id)`; `(clinic_id,id,item_id,stock_position_id,lot_key)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id,delivery_id,invoice_id)` | `deliveries(clinic_id,id,invoice_id)` |
| `(clinic_id,invoice_line_id,invoice_id)` | `invoice_lines(clinic_id,id,invoice_id)` |
| `(clinic_id,invoice_line_id,item_id)` | `invoice_lines(clinic_id,id,catalog_item_id)` |
| `(clinic_id,stock_position_id,item_id)` | `stock_positions(clinic_id,id,item_id)` |
| `(clinic_id,stock_lot_id,stock_position_id)` | `stock_lots(clinic_id,id,stock_position_id)` |
| `(clinic_id,reservation_id,invoice_line_id,stock_position_id,lot_key)` | `stock_reservations(clinic_id,id,invoice_line_id,stock_position_id,lot_key)` |
| `(clinic_id,workshop_order_id,invoice_line_id)` | `workshop_orders(clinic_id,id,invoice_line_id)` |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,item_id)` | `catalog_items(clinic_id,id)` |
| `(clinic_id,stock_position_id)` | `stock_positions(clinic_id,id)` |
| `(clinic_id,delivery_id)` | `deliveries(clinic_id,id)` |
| `(clinic_id,invoice_id)` | `invoices(clinic_id,id)` |
| `(clinic_id,invoice_line_id)` | `invoice_lines(clinic_id,id)` |
| `(clinic_id,stock_lot_id)` | `stock_lots(clinic_id,id)` |
| `(clinic_id,workshop_order_id)` | `workshop_orders(clinic_id,id)` |
| `(clinic_id,reservation_id)` | `stock_reservations(clinic_id,id)` |

**Contrôles CHECK** : 4 ; expressions exactes dans le SQL et le catalogue.

**Historique** : garde de cycle de vie `delivery_child` dans le script 04.
### physical_returns

Retour physique contrôlé, indépendamment d’un avoir.

**Attributs** : `id`, `clinic_id`, `item_id`, `delivery_line_id`, `quantity`, `condition_code`, `accepted_for_restock`, `approved_by`, `occurred_at`, `reason`, `credit_note_id` ?, `idempotency_id`, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,idempotency_id)`; `(clinic_id,id,item_id)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id,delivery_line_id,item_id)` | `delivery_lines(clinic_id,id,item_id)` |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,item_id)` | `catalog_items(clinic_id,id)` |
| `(clinic_id,delivery_line_id)` | `delivery_lines(clinic_id,id)` |
| `(clinic_id,approved_by)` | `users(clinic_id,id)` |
| `(clinic_id,credit_note_id)` | `credit_notes(clinic_id,id)` |
| `(clinic_id,idempotency_id)` | `idempotency_requests(clinic_id,id)` |

**Contrôles CHECK** : 5 ; expressions exactes dans le SQL et le catalogue.

**Historique** : append-only, UPDATE/DELETE refusés par le script 04.
### stock_movements

Faits physiques append-only ; réserve seule n’est pas une sortie.

**Attributs** : `id`, `clinic_id`, `lot_key`, `movement_position`, `item_id`, `position_id`, `lot_id` ?, `kind`, `signed_quantity`, `unit_cost` ?, `delivery_line_id` ?, `physical_return_id` ?, `goods_receipt_line_id` ?, `approval_id` ?, `reason`, `occurred_at`, `actor_id`, `idempotency_id`, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,idempotency_id,movement_position)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id,position_id,item_id)` | `stock_positions(clinic_id,id,item_id)` |
| `(clinic_id,lot_id,position_id)` | `stock_lots(clinic_id,id,stock_position_id)` |
| `(clinic_id,delivery_line_id,item_id,position_id,lot_key)` | `delivery_lines(clinic_id,id,item_id,stock_position_id,lot_key)` |
| `(clinic_id,goods_receipt_line_id,item_id)` | `goods_receipt_lines(clinic_id,id,item_id)` |
| `(clinic_id,physical_return_id,item_id)` | `physical_returns(clinic_id,id,item_id)` |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,item_id)` | `catalog_items(clinic_id,id)` |
| `(clinic_id,position_id)` | `stock_positions(clinic_id,id)` |
| `(clinic_id,lot_id)` | `stock_lots(clinic_id,id)` |
| `(clinic_id,delivery_line_id)` | `delivery_lines(clinic_id,id)` |
| `(clinic_id,physical_return_id)` | `physical_returns(clinic_id,id)` |
| `(clinic_id,goods_receipt_line_id)` | `goods_receipt_lines(clinic_id,id)` |
| `(clinic_id,approval_id)` | `approvals(clinic_id,id)` |
| `(clinic_id,actor_id)` | `users(clinic_id,id)` |
| `(clinic_id,idempotency_id)` | `idempotency_requests(clinic_id,id)` |

**Contrôles CHECK** : 10 ; expressions exactes dans le SQL et le catalogue.

**Historique** : append-only, UPDATE/DELETE refusés par le script 04.
### stock_alerts

Alerte de seuil/péremption dédupliquée et résoluble.

**Attributs** : `id`, `clinic_id`, `item_id`, `location_id`, `lot_id` ?, `kind`, `dedupe_key`, `detected_at`, `due_on` ?, `status`, `acknowledged_by` ?, `resolved_at` ?, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,dedupe_key)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,item_id)` | `catalog_items(clinic_id,id)` |
| `(clinic_id,location_id)` | `stock_locations(clinic_id,id)` |
| `(clinic_id,lot_id)` | `stock_lots(clinic_id,id)` |
| `(clinic_id,acknowledged_by)` | `users(clinic_id,id)` |

**Contrôles CHECK** : 3 ; expressions exactes dans le SQL et le catalogue.

## Atelier optique

### workshop_orders

Commande labo et équipement figés ; reprise sans effacement.

**Attributs** : `id`, `clinic_id`, `patient_id`, `invoice_line_id`, `prescription_id`, `supplier_id`, `frame_item_id` ?, `reference`, `lab_reference` ?, `quantity`, `snapshot`, `ordered_at`, `expected_at` ?, `received_at` ?, `status`, `ready_revision`, `notes` ?, `created_by`, `version`, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,reference)`; `(clinic_id,id,invoice_line_id)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id,invoice_line_id,patient_id)` | `invoice_lines(clinic_id,id,patient_id)` |
| `(clinic_id,prescription_id,patient_id)` | `optical_prescriptions(clinic_id,id,patient_id)` |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,patient_id)` | `patient_records(clinic_id,id)` |
| `(clinic_id,invoice_line_id)` | `invoice_lines(clinic_id,id)` |
| `(clinic_id,prescription_id)` | `optical_prescriptions(clinic_id,id)` |
| `(clinic_id,supplier_id)` | `suppliers(clinic_id,id)` |
| `(clinic_id,frame_item_id)` | `catalog_items(clinic_id,id)` |
| `(clinic_id,created_by)` | `users(clinic_id,id)` |

**Contrôles CHECK** : 4 ; expressions exactes dans le SQL et le catalogue.
### workshop_order_eyes

Spécifications verrier OD/OG figées issues d’une prescription validée.

**Attributs** : `id`, `clinic_id`, `workshop_order_id`, `eye`, `sphere` ?, `cylinder` ?, `axis` ?, `addition` ?, `pd` ?, `fitting_height` ?, `lens_type`, `lens_index` ?, `treatments_snapshot`, `frame_reference_snapshot` ?, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,workshop_order_id,eye)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,workshop_order_id)` | `workshop_orders(clinic_id,id)` |

**Contrôles CHECK** : 6 ; expressions exactes dans le SQL et le catalogue.
### workshop_events

Transition, reprise ou contrôle qualité auteur/date.

**Attributs** : `id`, `clinic_id`, `workshop_order_id`, `sequence_no`, `event_type`, `previous_status` ?, `new_status` ?, `quality_result` ?, `observations` ?, `occurred_at`, `actor_id`, `delivery_line_id` ?, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,workshop_order_id,sequence_no)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,workshop_order_id)` | `workshop_orders(clinic_id,id)` |
| `(clinic_id,actor_id)` | `users(clinic_id,id)` |
| `(clinic_id,delivery_line_id)` | `delivery_lines(clinic_id,id)` |

**Contrôles CHECK** : 4 ; expressions exactes dans le SQL et le catalogue.

**Historique** : append-only, UPDATE/DELETE refusés par le script 04.

## Intégrations

### integration_accounts

Compte Google/Kommo/Meta/SMS, secrets chiffrés séparés des données cliniques.

**Attributs** : `id`, `clinic_id`, `provider`, `external_account_id`, `display_name`, `credentials_ciphertext` ?, `encryption_key_id` ?, `token_expires_at` ?, `status`, `public_configuration` ?, `configured_by`, `version`, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,provider,external_account_id)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,configured_by)` | `users(clinic_id,id)` |

**Contrôles CHECK** : 5 ; expressions exactes dans le SQL et le catalogue.
### external_links

Correspondance externe à version/etag, cible interne contrôlée par adaptateur.

**Attributs** : `id`, `clinic_id`, `integration_account_id`, `local_entity_type`, `local_entity_id`, `external_entity_type`, `external_entity_id`, `etag` ?, `local_version`, `last_synced_at` ?, `status`, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,integration_account_id,external_entity_type,external_entity_id)`; `(clinic_id,integration_account_id,local_entity_type,local_entity_id,external_entity_type)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,integration_account_id)` | `integration_accounts(clinic_id,id)` |

**Contrôles CHECK** : 2 ; expressions exactes dans le SQL et le catalogue.
### calendar_sync_states

État Google, token et canal push ne remplacent pas l’agenda interne.

**Attributs** : `id`, `clinic_id`, `integration_account_id`, `resource_id`, `external_calendar_id`, `sync_token_ciphertext` ?, `token_encryption_key_id` ?, `pending_page_token` ?, `push_channel_id` ?, `push_resource_id` ?, `push_expires_at` ?, `last_full_sync_at` ?, `last_incremental_sync_at` ?, `status`, `last_error_code` ?, `version`, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,integration_account_id,resource_id)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,integration_account_id)` | `integration_accounts(clinic_id,id)` |
| `(clinic_id,resource_id)` | `scheduling_resources(clinic_id,id)` |

**Contrôles CHECK** : 2 ; expressions exactes dans le SQL et le catalogue.
### webhook_inbox

Réception durable/dédupliquée, données minimales protégées.

**Attributs** : `id`, `clinic_id`, `integration_account_id`, `provider_event_key`, `payload_hash`, `payload_ciphertext`, `encryption_key_id`, `received_at`, `status`, `verified_at` ?, `processed_at` ?, `attempt_count`, `last_error_code` ?, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,integration_account_id,provider_event_key)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,integration_account_id)` | `integration_accounts(clinic_id,id)` |

**Contrôles CHECK** : 2 ; expressions exactes dans le SQL et le catalogue.
### outbox_events

Effets externes après commit, payload minimal et déduplication.

**Attributs** : `id`, `clinic_id`, `event_type`, `event_version`, `source_type`, `source_id`, `source_version`, `payload`, `correlation_id`, `status`, `processed_at` ?, `attempt_count`, `next_attempt_at` ?, `last_error_code` ?, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |

**Contrôles CHECK** : 3 ; expressions exactes dans le SQL et le catalogue.

## Communications et relances

### reminder_policies

Contrôle DP et anti-no-show PC, canaux/horaires configurés.

**Attributs** : `id`, `clinic_id`, `code`, `label`, `purpose`, `channel`, `offset_unit`, `offset_value`, `local_send_time` ?, `active`, `version`, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,code)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |

**Contrôles CHECK** : 5 ; expressions exactes dans le SQL et le catalogue.
### contact_tasks

Tâche et échéance uniques avec source typée.

**Attributs** : `id`, `clinic_id`, `patient_id` ?, `prospect_contact_id` ?, `follow_up_id` ?, `appointment_id` ?, `invoice_id` ?, `workshop_order_id` ?, `policy_id` ?, `source_version`, `due_at`, `channel`, `status`, `next_attempt_at` ?, `assigned_to` ?, `dedupe_key`, `administrative_notes` ?, `version`, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,dedupe_key)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,patient_id)` | `patient_records(clinic_id,id)` |
| `(clinic_id,prospect_contact_id)` | `prospect_contacts(clinic_id,id)` |
| `(clinic_id,follow_up_id)` | `follow_up_plans(clinic_id,id)` |
| `(clinic_id,appointment_id)` | `appointments(clinic_id,id)` |
| `(clinic_id,invoice_id)` | `invoices(clinic_id,id)` |
| `(clinic_id,workshop_order_id)` | `workshop_orders(clinic_id,id)` |
| `(clinic_id,policy_id)` | `reminder_policies(clinic_id,id)` |
| `(clinic_id,assigned_to)` | `users(clinic_id,id)` |

**Contrôles CHECK** : 5 ; expressions exactes dans le SQL et le catalogue.
### contact_attempts

Historique du contact humain ou système.

**Attributs** : `id`, `clinic_id`, `task_id`, `actor_id` ?, `occurred_at`, `result`, `appointment_id` ?, `administrative_note` ?, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,task_id)` | `contact_tasks(clinic_id,id)` |
| `(clinic_id,actor_id)` | `users(clinic_id,id)` |
| `(clinic_id,appointment_id)` | `appointments(clinic_id,id)` |

**Contrôles CHECK** : 2 ; expressions exactes dans le SQL et le catalogue.

**Historique** : append-only, UPDATE/DELETE refusés par le script 04.
### communication_consents

Événements consentement/retrait par sujet, numéro précis et finalité.

**Attributs** : `id`, `clinic_id`, `patient_id` ?, `prospect_contact_id` ?, `channel`, `purpose`, `destination_hash`, `destination_ciphertext`, `encryption_key_id`, `status`, `recorded_at`, `recorded_by`, `proof`, `policy_version`, `event_sequence`, `created_at`, `updated_at`, `subject_key`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,subject_key,channel,purpose,destination_hash,event_sequence)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,patient_id)` | `patient_records(clinic_id,id)` |
| `(clinic_id,prospect_contact_id)` | `prospect_contacts(clinic_id,id)` |
| `(clinic_id,recorded_by)` | `users(clinic_id,id)` |

**Contrôles CHECK** : 6 ; expressions exactes dans le SQL et le catalogue.

**Historique** : append-only, UPDATE/DELETE refusés par le script 04.
### message_templates

Template administratif ou promotionnel, aucune activation par défaut.

**Attributs** : `id`, `clinic_id`, `code`, `channel`, `purpose`, `active`, `version`, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,code)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |

**Contrôles CHECK** : 4 ; expressions exactes dans le SQL et le catalogue.
### message_template_versions

Texte et version fournisseur validés, variables autorisées.

**Attributs** : `id`, `clinic_id`, `template_id`, `integration_account_id`, `revision_no`, `provider_template_id` ?, `language`, `body`, `allowed_variables`, `media_file_id` ?, `provider_approval_status`, `approved_by` ?, `approved_at` ?, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,template_id,revision_no)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,template_id)` | `message_templates(clinic_id,id)` |
| `(clinic_id,integration_account_id)` | `integration_accounts(clinic_id,id)` |
| `(clinic_id,media_file_id)` | `stored_files(clinic_id,id)` |
| `(clinic_id,approved_by)` | `users(clinic_id,id)` |

**Contrôles CHECK** : 4 ; expressions exactes dans le SQL et le catalogue.
### audience_segments

Filtres administratifs ciblés, validés par code et non pathologies.

**Attributs** : `id`, `clinic_id`, `name`, `criteria`, `criteria_schema_version`, `created_by`, `version`, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,created_by)` | `users(clinic_id,id)` |

**Contrôles CHECK** : 2 ; expressions exactes dans le SQL et le catalogue.
### campaign_definitions

Campagne avec cible figée et autorisation gérante.

**Attributs** : `id`, `clinic_id`, `name`, `segment_id`, `template_version_id`, `approval_id` ?, `scheduled_at` ?, `status`, `created_by`, `target_frozen_at` ?, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,segment_id)` | `audience_segments(clinic_id,id)` |
| `(clinic_id,template_version_id)` | `message_template_versions(clinic_id,id)` |
| `(clinic_id,approval_id)` | `approvals(clinic_id,id)` |
| `(clinic_id,created_by)` | `users(clinic_id,id)` |

**Contrôles CHECK** : 3 ; expressions exactes dans le SQL et le catalogue.
### campaign_recipients

Destinataire de cible figée, consentement revérifié juste avant envoi.

**Attributs** : `id`, `clinic_id`, `campaign_id`, `patient_id` ?, `prospect_contact_id` ?, `destination_hash`, `destination_ciphertext`, `encryption_key_id`, `consent_event_id` ?, `status`, `exclusion_reason` ?, `consent_checked_at` ?, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,campaign_id,destination_hash)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,campaign_id)` | `campaign_definitions(clinic_id,id)` |
| `(clinic_id,patient_id)` | `patient_records(clinic_id,id)` |
| `(clinic_id,prospect_contact_id)` | `prospect_contacts(clinic_id,id)` |
| `(clinic_id,consent_event_id)` | `communication_consents(clinic_id,id)` |

**Contrôles CHECK** : 3 ; expressions exactes dans le SQL et le catalogue.
### message_attempts

Tentative avec état fournisseur ; timeout peut rester inconnu.

**Attributs** : `id`, `clinic_id`, `task_id` ?, `campaign_recipient_id` ?, `integration_account_id`, `template_version_id`, `consent_event_id`, `destination_hash`, `destination_ciphertext`, `encryption_key_id`, `dedupe_key`, `provider_message_id` ?, `attempt_no`, `status`, `submitted_at` ?, `delivered_at` ?, `read_at` ?, `error_code` ?, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,dedupe_key,attempt_no)`; `(clinic_id,integration_account_id,provider_message_id)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,task_id)` | `contact_tasks(clinic_id,id)` |
| `(clinic_id,campaign_recipient_id)` | `campaign_recipients(clinic_id,id)` |
| `(clinic_id,integration_account_id)` | `integration_accounts(clinic_id,id)` |
| `(clinic_id,template_version_id)` | `message_template_versions(clinic_id,id)` |
| `(clinic_id,consent_event_id)` | `communication_consents(clinic_id,id)` |

**Contrôles CHECK** : 4 ; expressions exactes dans le SQL et le catalogue.

## Showroom et réservation publique

### catalog_publications

Description approuvée et filtres publics sans prix achat/stock détaillé.

**Attributs** : `id`, `clinic_id`, `catalog_item_id`, `slug`, `public_title`, `public_description`, `style` ?, `show_sale_price`, `status`, `display_order`, `approved_by` ?, `published_at` ?, `version`, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,catalog_item_id)`; `(clinic_id,slug)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,catalog_item_id)` | `catalog_items(clinic_id,id)` |
| `(clinic_id,approved_by)` | `users(clinic_id,id)` |

**Contrôles CHECK** : 4 ; expressions exactes dans le SQL et le catalogue.
### catalog_media

Images produit validées avec droits et ordre affichage.

**Attributs** : `id`, `clinic_id`, `publication_id`, `file_id`, `alt_text`, `display_order`, `rights_note`, `approved_by`, `approved_at`, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,publication_id,file_id)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,publication_id)` | `catalog_publications(clinic_id,id)` |
| `(clinic_id,file_id)` | `stored_files(clinic_id,id)` |
| `(clinic_id,approved_by)` | `users(clinic_id,id)` |

**Contrôles CHECK** : 1 ; expressions exactes dans le SQL et le catalogue.
### public_contents

Contenu limité vitrine/prestations/coordonnées, pas CMS illimité.

**Attributs** : `id`, `clinic_id`, `code`, `title`, `content`, `revision_no`, `status`, `approved_by` ?, `published_at` ?, `version`, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,code,revision_no)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,approved_by)` | `users(clinic_id,id)` |

**Contrôles CHECK** : 4 ; expressions exactes dans le SQL et le catalogue.
### public_booking_requests

Demande de réservation protégée avant confirmation centrale.

**Attributs** : `id`, `clinic_id`, `catalog_publication_id` ?, `public_reference`, `prospect_contact_id`, `service_id`, `resource_id`, `requested_starts_at`, `requested_ends_at`, `appointment_id` ?, `request_key`, `status`, `consent_recorded_at`, `consent_policy_version`, `management_token_hash`, `token_expires_at`, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,public_reference)`; `(clinic_id,request_key)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,catalog_publication_id)` | `catalog_publications(clinic_id,id)` |
| `(clinic_id,prospect_contact_id)` | `prospect_contacts(clinic_id,id)` |
| `(clinic_id,service_id)` | `appointment_services(clinic_id,id)` |
| `(clinic_id,resource_id)` | `scheduling_resources(clinic_id,id)` |
| `(clinic_id,appointment_id)` | `appointments(clinic_id,id)` |

**Contrôles CHECK** : 4 ; expressions exactes dans le SQL et le catalogue.

## Hors-ligne et synchronisation

### enrolled_devices

Poste préparé, aucun clone des droits financiers.

**Attributs** : `id`, `clinic_id`, `device_code`, `name`, `public_key_jwk`, `key_algorithm`, `status`, `enrolled_by`, `responsible_user_id`, `enrolled_at`, `last_sync_at` ?, `last_accepted_sequence`, `last_accepted_hash` ?, `app_version`, `replaced_by_device_id` ?, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,device_code)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,enrolled_by)` | `users(clinic_id,id)` |
| `(clinic_id,responsible_user_id)` | `users(clinic_id,id)` |
| `(clinic_id,replaced_by_device_id)` | `enrolled_devices(clinic_id,id)` |

**Contrôles CHECK** : 4 ; expressions exactes dans le SQL et le catalogue.
### offline_grants

Autorisation signée bornée ; clés privées non présentes dans MySQL.

**Attributs** : `id`, `clinic_id`, `device_id`, `user_id`, `permissions_snapshot`, `rules_version`, `catalog_version`, `issued_at`, `valid_until`, `signed_payload`, `revoked_at` ?, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,id,device_id,user_id)`; `(clinic_id,id,device_id)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,device_id)` | `enrolled_devices(clinic_id,id)` |
| `(clinic_id,user_id)` | `users(clinic_id,id)` |

**Contrôles CHECK** : 3 ; expressions exactes dans le SQL et le catalogue.

**Historique** : garde de cycle de vie `signed_grant` dans le script 04.
### document_number_allocations

Plages pré-allouées disjointes, pas de libération automatique.

**Attributs** : `id`, `clinic_id`, `device_id`, `grant_id`, `document_type`, `document_year`, `range_start`, `range_end`, `last_consumed_value` ?, `status`, `allocated_at`, `closed_at` ?, `version`, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,document_type,document_year,range_start)`; `(clinic_id,id,document_type,document_year)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id,grant_id,device_id)` | `offline_grants(clinic_id,id,device_id)` |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,device_id)` | `enrolled_devices(clinic_id,id)` |
| `(clinic_id,grant_id)` | `offline_grants(clinic_id,id)` |

**Contrôles CHECK** : 8 ; expressions exactes dans le SQL et le catalogue.
### invoice_write_owners

Un seul propriétaire financier, clôture après ACK de toutes commandes.

**Attributs** : `id`, `clinic_id`, `invoice_id`, `device_id`, `epoch`, `status`, `granted_at`, `closed_at` ?, `final_device_sequence` ?, `active_invoice_key` ?, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,invoice_id,epoch)`; `(clinic_id,active_invoice_key)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,invoice_id)` | `invoices(clinic_id,id)` |
| `(clinic_id,device_id)` | `enrolled_devices(clinic_id,id)` |

**Contrôles CHECK** : 4 ; expressions exactes dans le SQL et le catalogue.
### device_stock_allocations

Quota exclusif article/lot, réserve locale incluse dans quota restant.

**Attributs** : `id`, `clinic_id`, `device_id`, `stock_position_id`, `stock_lot_id` ?, `allocated_quantity`, `consumed_quantity`, `returned_quantity`, `status`, `allocated_at`, `closed_at` ?, `version`, `created_at`, `updated_at`, `lot_key`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,id,stock_position_id)`; `(clinic_id,id,stock_position_id,lot_key)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id,stock_lot_id,stock_position_id)` | `stock_lots(clinic_id,id,stock_position_id)` |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,device_id)` | `enrolled_devices(clinic_id,id)` |
| `(clinic_id,stock_position_id)` | `stock_positions(clinic_id,id)` |
| `(clinic_id,stock_lot_id)` | `stock_lots(clinic_id,id)` |

**Contrôles CHECK** : 7 ; expressions exactes dans le SQL et le catalogue.
### sync_commands

Commande immuable reçue ; état de traitement dans table séparée.

**Attributs** : `id`, `clinic_id`, `device_id`, `actor_id`, `grant_id`, `device_sequence`, `previous_event_hash` ?, `event_hash`, `signature`, `schema_version`, `rules_version`, `command_name`, `occurred_at_local`, `last_server_time`, `entity_type`, `entity_id`, `expected_version` ?, `number_allocation_id` ?, `payload_ciphertext`, `encryption_key_id`, `received_at`, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,device_id,device_sequence)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id,grant_id,device_id,actor_id)` | `offline_grants(clinic_id,id,device_id,user_id)` |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,device_id)` | `enrolled_devices(clinic_id,id)` |
| `(clinic_id,actor_id)` | `users(clinic_id,id)` |
| `(clinic_id,grant_id)` | `offline_grants(clinic_id,id)` |
| `(clinic_id,number_allocation_id)` | `document_number_allocations(clinic_id,id)` |

**Contrôles CHECK** : 2 ; expressions exactes dans le SQL et le catalogue.

**Historique** : append-only, UPDATE/DELETE refusés par le script 04.
### sync_command_results

ACK durable ou litige ; commande originale jamais écrasée.

**Attributs** : `id`, `clinic_id`, `command_id`, `status`, `result_references` ?, `error_code` ?, `processed_at` ?, `attempt_count`, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(clinic_id,command_id)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,command_id)` | `sync_commands(clinic_id,id)` |

**Contrôles CHECK** : 3 ; expressions exactes dans le SQL et le catalogue.
### sync_conflicts

Versions en conflit et résolution explicite avec pièces conservées.

**Attributs** : `id`, `clinic_id`, `command_id`, `conflict_type`, `local_snapshot_ciphertext`, `central_snapshot_ciphertext`, `encryption_key_id`, `status`, `resolution` ?, `resolved_by` ?, `resolved_at` ?, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |
| `(clinic_id,command_id)` | `sync_commands(clinic_id,id)` |
| `(clinic_id,resolved_by)` | `users(clinic_id,id)` |

**Contrôles CHECK** : 3 ; expressions exactes dans le SQL et le catalogue.
### sync_change_log

Journal de changement serveur pour pull paginé filtré par Policy.

**Attributs** : `id`, `clinic_id`, `change_sequence`, `entity_type`, `entity_id`, `entity_version`, `recorded_at`, `visibility`, `change_kind`, `created_at`, `updated_at`.

**PK** : `id`.

**UQ** : `(clinic_id,id)`; `(change_sequence)`.

| FK locale | Relation cible |
| --- | --- |
| `(clinic_id)` | `clinics(id)` |

**Contrôles CHECK** : 3 ; expressions exactes dans le SQL et le catalogue.

**Historique** : append-only, UPDATE/DELETE refusés par le script 04.
