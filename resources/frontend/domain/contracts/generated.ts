/* eslint-disable */
// Généré par contracts/tools/generate-types.mjs depuis les JSON Schema de contracts/ : ne pas modifier
// à la main. Les règles conditionnelles (if/then, not) sont vérifiées à l'exécution par Ajv.

/**
 * Identifiant ULID ASCII (26 caractères Crockford, majuscules), connu avant tout commit local ; jamais l'identifiant nul.
 */
export type Ulid = string
/**
 * Code ASCII de référentiel (VARCHAR(40) ascii).
 */
export type Code = string
/**
 *  (catalogue : consultation_histories.history_group)
 */
export type ConsultationHistoriesHistoryGroup = ("OCULAR_HISTORY" | "MEDICAL_HISTORY" | "FAMILY_HISTORY")
/**
 *  (catalogue : visual_acuities.context)
 */
export type VisualAcuitiesContext = ("PRELIMINARY" | "POST_REFRACTION")
/**
 *  (catalogue : visual_acuities.distance)
 */
export type VisualAcuitiesDistance = ("FAR" | "NEAR" | "UNSPECIFIED")
/**
 *  (catalogue : visual_acuities.correction)
 */
export type VisualAcuitiesCorrection = ("WITHOUT" | "WITH")
/**
 *  (catalogue : visual_acuities.eye)
 */
export type VisualAcuitiesEye = ("OD" | "OG" | "OU")
/**
 *  (catalogue : refraction_measurements.stage)
 */
export type RefractionMeasurementsStage = ("AUTOREFRACTOR" | "OBJECTIVE" | "SUBJECTIVE")
/**
 *  (catalogue : refraction_measurements.eye)
 */
export type RefractionMeasurementsEye = ("OD" | "OG")
export type NullableDiopter = (Diopter | null)
/**
 * Valeur optique DECIMAL(6,2) en chaîne exacte, signe explicite admis ; null = non mesuré (jamais remplacé par zéro).
 */
export type Diopter = string
export type NullableUlid = (Ulid | null)
/**
 *  (catalogue : medication_orders.form)
 */
export type MedicationOrdersForm = ("DROPS" | "OINTMENT" | "TABLET" | "OTHER")
/**
 *  (catalogue : medication_orders.duration_unit)
 */
export type MedicationOrdersDurationUnit = ("DAY" | "WEEK" | "MONTH")
/**
 *  (catalogue : consultations.referral_urgency)
 */
export type ConsultationsReferralUrgency = ("NOT_URGENT" | "RECOMMENDED" | "RAPID" | "EMERGENCY")
export type StepName = ("ANAMNESIS" | "HISTORIES" | "VISUAL_ACUITY" | "REFRACTION" | "CENTERING" | "MEDICATIONS" | "CONCLUSION")
/**
 * Code de permission du référentiel seedé (ex. invoice.issue).
 */
export type PermissionCode = string
/**
 * Empreinte SHA-256 en hexadécimal minuscule (64 caractères).
 */
export type Sha256Hex = string
export type NullableSha256Hex = (Sha256Hex | null)
/**
 * JWS compact base64url (en-tête.charge.signature), ES256 uniquement.
 */
export type CompactJws = string
/**
 * Montant en francs CFA (XAF), entier exact, bornes SQL 0..1 000 000 000 000 ; jamais de flottant.
 */
export type MoneyXaf = number
/**
 * Montant strictement positif (paiement, remboursement, contre-écriture).
 */
export type PositiveMoneyXaf = number
/**
 * Montant signé (solde, écart de caisse) : entier exact.
 */
export type SignedMoneyXaf = number
/**
 * Monnaie unique du cabinet (CHECK currency = 'XAF').
 */
export type Currency = "XAF"
/**
 * Quantité DECIMAL(12,3) en chaîne décimale exacte (point décimal), strictement positive.
 */
export type Quantity = string
/**
 * Quantité DECIMAL(12,3) signée en chaîne exacte (mouvements de stock).
 */
export type SignedQuantity = string
/**
 * Taux en pourcentage DECIMAL en chaîne exacte (0 à 100).
 */
export type Rate = string
/**
 * Compteur BIGINT (séquence d'appareil, curseur) : chaîne de chiffres sans zéro non significatif ; jamais un nombre JS hors plage sûre.
 */
export type Counter = string
/**
 * Version optimiste (brouillon ou ledger dérivé), entier ≥ 1.
 */
export type Version = number
/**
 * Instant UTC ISO 8601 à la milliseconde, suffixe Z (ex. 2026-10-14T09:30:00.000Z).
 */
export type Instant = string
export type NullableInstant = (Instant | null)
/**
 * Date civile YYYY-MM-DD dans le fuseau du cabinet (Africa/Douala) ; jamais déduite d'un minuit UTC.
 */
export type CivilDate = string
export type NullableCivilDate = (CivilDate | null)
/**
 * Heure locale HH:MM du cabinet (Africa/Douala), sans date ni fuseau : créneau hebdomadaire d'un agenda.
 */
export type LocalTime = string
export type ShortText = string
/**
 * Motif obligatoire d'une opération sensible.
 */
export type Reason = string
export type Phone = string
/**
 *  (catalogue : generated_documents.document_type)
 */
export type GeneratedDocumentsDocumentType = ("INVOICE" | "RECEIPT" | "CREDIT_NOTE" | "REFUND" | "OPTICAL_PRESCRIPTION" | "CLINICAL_RECORD" | "WORKSHOP" | "ACCOUNT_STATEMENT" | "LEGACY_BALANCE" | "QUOTE")
/**
 *  (catalogue : appointments.source)
 */
export type AppointmentsSource = ("INTERNAL" | "GOOGLE" | "CRM" | "WEBSITE")
/**
 *  (catalogue : appointments.status)
 */
export type AppointmentsStatus = ("PENDING_CONFIRMATION" | "CONFIRMED" | "ARRIVED" | "COMPLETED" | "CANCELLED" | "NO_SHOW")
/**
 *  (catalogue : approvals.status)
 */
export type ApprovalsStatus = ("REQUESTED" | "APPROVED" | "REFUSED" | "EXPIRED" | "CONSUMED")
/**
 *  (catalogue : assistant_runs.status)
 */
export type AssistantRunsStatus = ("RUNNING" | "COMPLETED" | "HANDOFF" | "FAILED")
/**
 *  (catalogue : backup_runs.scope)
 */
export type BackupRunsScope = ("SERVER_DATABASE" | "SERVER_FILES" | "OFFLINE_UNSYNCED")
/**
 *  (catalogue : backup_runs.status)
 */
export type BackupRunsStatus = ("RUNNING" | "SUCCEEDED" | "FAILED")
/**
 *  (catalogue : calendar_blocks.origin)
 */
export type CalendarBlocksOrigin = ("INTERNAL" | "GOOGLE")
/**
 *  (catalogue : calendar_sync_states.status)
 */
export type CalendarSyncStatesStatus = ("NOT_CONFIGURED" | "READY" | "SYNCING" | "STALE" | "ERROR")
/**
 *  (catalogue : campaign_definitions.status)
 */
export type CampaignDefinitionsStatus = ("DRAFT" | "APPROVED" | "RUNNING" | "COMPLETED" | "CANCELLED" | "FAILED")
/**
 *  (catalogue : campaign_recipients.status)
 */
export type CampaignRecipientsStatus = ("PENDING" | "ELIGIBLE" | "EXCLUDED" | "SUBMITTED" | "DELIVERED" | "FAILED" | "CANCELLED")
/**
 *  (catalogue : cash_movements.kind)
 */
export type CashMovementsKind = ("DEPOSIT" | "WITHDRAWAL" | "EXPENSE" | "OPENING_CORRECTION")
/**
 *  (catalogue : catalog_items.stock_mode)
 */
export type CatalogItemsStockMode = ("NONE" | "STOCKED" | "MADE_TO_ORDER")
/**
 *  (catalogue : catalog_publications.status)
 */
export type CatalogPublicationsStatus = ("DRAFT" | "PUBLISHED" | "ARCHIVED")
/**
 *  (catalogue : communication_consents.channel)
 */
export type CommunicationConsentsChannel = ("SMS" | "WHATSAPP" | "CALL" | "EMAIL")
/**
 *  (catalogue : communication_consents.purpose)
 */
export type CommunicationConsentsPurpose = ("APPOINTMENT" | "FOLLOW_UP" | "ORDER_UPDATE" | "PAYMENT_FOLLOW_UP" | "MARKETING")
/**
 *  (catalogue : communication_consents.status)
 */
export type CommunicationConsentsStatus = ("GRANTED" | "REVOKED")
/**
 *  (catalogue : consultation_history_terms.term_group)
 */
export type ConsultationHistoryTermsTermGroup = ("OCULAR_HISTORY" | "MEDICAL_HISTORY" | "FAMILY_HISTORY")
/**
 *  (catalogue : consultations.status)
 */
export type ConsultationsStatus = ("DRAFT" | "IN_PROGRESS" | "COMPLETED")
/**
 *  (catalogue : contact_attempts.result)
 */
export type ContactAttemptsResult = ("CONTACTED" | "BOOKED" | "NO_RESPONSE" | "REFUSED" | "POSTPONED" | "FAILED")
/**
 *  (catalogue : contact_tasks.channel)
 */
export type ContactTasksChannel = ("INTERNAL" | "CALL" | "SMS" | "WHATSAPP")
/**
 *  (catalogue : contact_tasks.status)
 */
export type ContactTasksStatus = ("PENDING" | "CONTACTED" | "BOOKED" | "NO_RESPONSE" | "REFUSED" | "POSTPONED" | "CANCELLED")
/**
 *  (catalogue : conversation_handoffs.event_type)
 */
export type ConversationHandoffsEventType = ("REQUEST" | "TAKEOVER" | "RESUME_BOT" | "CLOSE")
/**
 *  (catalogue : credit_notes.status)
 */
export type CreditNotesStatus = ("DRAFT" | "ISSUED" | "ABANDONED")
/**
 *  (catalogue : crm_conversations.channel)
 */
export type CrmConversationsChannel = ("WHATSAPP" | "MESSENGER" | "INSTAGRAM")
/**
 *  (catalogue : crm_conversations.status)
 */
export type CrmConversationsStatus = ("BOT_ACTIVE" | "HUMAN_TAKEOVER" | "CLOSED")
/**
 *  (catalogue : crm_leads.status)
 */
export type CrmLeadsStatus = ("OPEN" | "APPOINTMENT_BOOKED" | "HUMAN_TAKEOVER" | "WON" | "LOST" | "CLOSED")
/**
 *  (catalogue : deliveries.status)
 */
export type DeliveriesStatus = ("DRAFT" | "CONFIRMED")
/**
 *  (catalogue : device_stock_allocations.status)
 */
export type DeviceStockAllocationsStatus = ("ACTIVE" | "CLOSING" | "CLOSED")
/**
 *  (catalogue : document_number_allocations.document_type)
 */
export type DocumentNumberAllocationsDocumentType = ("PATIENT" | "INVOICE" | "RECEIPT" | "CREDIT_NOTE" | "REFUND" | "LEGACY_BALANCE" | "QUOTE" | "WORKSHOP")
/**
 *  (catalogue : document_number_allocations.status)
 */
export type DocumentNumberAllocationsStatus = ("ACTIVE" | "CLOSING" | "CLOSED")
/**
 *  (catalogue : document_number_usages.document_type)
 */
export type DocumentNumberUsagesDocumentType = ("PATIENT" | "INVOICE" | "RECEIPT" | "CREDIT_NOTE" | "REFUND" | "LEGACY_BALANCE" | "QUOTE" | "WORKSHOP")
/**
 *  (catalogue : document_number_usages.status)
 */
export type DocumentNumberUsagesStatus = ("USED" | "VOID" | "UNUSED")
/**
 *  (catalogue : document_sequences.document_type)
 */
export type DocumentSequencesDocumentType = ("PATIENT" | "INVOICE" | "RECEIPT" | "CREDIT_NOTE" | "REFUND" | "LEGACY_BALANCE" | "QUOTE" | "WORKSHOP")
/**
 *  (catalogue : enrolled_devices.status)
 */
export type EnrolledDevicesStatus = ("ACTIVE" | "REVOKED" | "LOST" | "REPLACED")
/**
 *  (catalogue : export_requests.export_type)
 */
export type ExportRequestsExportType = ("PATIENT_RECORD" | "PATIENTS" | "FINANCE" | "STOCK" | "FULL_HANDOVER")
/**
 *  (catalogue : export_requests.status)
 */
export type ExportRequestsStatus = ("REQUESTED" | "PROCESSING" | "READY" | "FAILED" | "EXPIRED")
/**
 *  (catalogue : external_links.status)
 */
export type ExternalLinksStatus = ("PENDING" | "SYNCED" | "CONFLICT" | "FAILED")
/**
 *  (catalogue : follow_up_plans.advance_unit)
 */
export type FollowUpPlansAdvanceUnit = ("DAY" | "MONTH")
/**
 *  (catalogue : follow_up_plans.anchor_kind)
 */
export type FollowUpPlansAnchorKind = ("CONSULTATION" | "TREATMENT_START" | "TREATMENT_END" | "MANUAL")
/**
 *  (catalogue : follow_up_plans.date_origin)
 */
export type FollowUpPlansDateOrigin = ("CALCULATED" | "MANUAL")
/**
 *  (catalogue : follow_up_plans.interval_unit)
 */
export type FollowUpPlansIntervalUnit = ("DAY" | "MONTH" | "YEAR")
/**
 *  (catalogue : follow_up_plans.preferred_channel)
 */
export type FollowUpPlansPreferredChannel = ("INTERNAL" | "SMS" | "WHATSAPP" | "CALL")
/**
 *  (catalogue : follow_up_plans.reason)
 */
export type FollowUpPlansReason = ("ROUTINE" | "DROPS" | "OTHER")
/**
 *  (catalogue : follow_up_plans.status)
 */
export type FollowUpPlansStatus = ("ACTIVE" | "SCHEDULED" | "CLOSED" | "CANCELLED")
/**
 *  (catalogue : generated_documents.status)
 */
export type GeneratedDocumentsStatus = ("PENDING" | "READY" | "FAILED")
/**
 *  (catalogue : goods_receipts.status)
 */
export type GoodsReceiptsStatus = ("DRAFT" | "VALIDATED" | "ABANDONED")
/**
 *  (catalogue : idempotency_requests.status)
 */
export type IdempotencyRequestsStatus = ("RECEIVED" | "COMMITTED" | "FAILED")
/**
 *  (catalogue : integration_accounts.provider)
 */
export type IntegrationAccountsProvider = ("GOOGLE" | "KOMMO" | "META_WHATSAPP" | "META_MESSENGER" | "META_INSTAGRAM" | "SMS" | "SMTP")
/**
 *  (catalogue : integration_accounts.status)
 */
export type IntegrationAccountsStatus = ("DISABLED" | "TEST" | "ACTIVE" | "ERROR")
/**
 *  (catalogue : inventory_counts.status)
 */
export type InventoryCountsStatus = ("OPEN" | "COUNTED" | "VALIDATED" | "ABANDONED")
/**
 *  (catalogue : invoice_write_owners.status)
 */
export type InvoiceWriteOwnersStatus = ("ACTIVE" | "CLOSING" | "CLOSED")
/**
 *  (catalogue : invoices.origin)
 */
export type InvoicesOrigin = ("NATIVE" | "LEGACY_BALANCE")
/**
 *  (catalogue : invoices.status)
 */
export type InvoicesStatus = ("DRAFT" | "ISSUED" | "ABANDONED")
/**
 *  (catalogue : knowledge_entries.category)
 */
export type KnowledgeEntriesCategory = ("HOURS" | "LOCATION" | "PRICING" | "INSURANCE" | "SERVICES" | "LENSES" | "PRODUCTS" | "OTHER")
/**
 *  (catalogue : message_attempts.status)
 */
export type MessageAttemptsStatus = ("PLANNED" | "SUBMITTED" | "DELIVERED" | "READ" | "FAILED" | "UNKNOWN" | "CANCELLED")
/**
 *  (catalogue : message_template_versions.provider_approval_status)
 */
export type MessageTemplateVersionsProviderApprovalStatus = ("DRAFT" | "PENDING" | "APPROVED" | "REJECTED" | "PAUSED")
/**
 *  (catalogue : message_templates.channel)
 */
export type MessageTemplatesChannel = ("SMS" | "WHATSAPP" | "EMAIL")
/**
 *  (catalogue : message_templates.purpose)
 */
export type MessageTemplatesPurpose = ("APPOINTMENT" | "FOLLOW_UP" | "ORDER_UPDATE" | "PAYMENT_FOLLOW_UP" | "MARKETING")
/**
 *  (catalogue : optical_prescription_eyes.eye)
 */
export type OpticalPrescriptionEyesEye = ("OD" | "OG")
/**
 *  (catalogue : optical_prescriptions.origin)
 */
export type OpticalPrescriptionsOrigin = ("INTERNAL" | "EXTERNAL")
/**
 *  (catalogue : optical_prescriptions.status)
 */
export type OpticalPrescriptionsStatus = ("DRAFT" | "VALIDATED")
/**
 *  (catalogue : outbox_events.status)
 */
export type OutboxEventsStatus = ("PENDING" | "PROCESSING" | "PROCESSED" | "FAILED")
/**
 *  (catalogue : patient_records.sex)
 */
export type PatientRecordsSex = ("F" | "M" | "UNKNOWN")
/**
 *  (catalogue : payment_reconciliation_lines.status)
 */
export type PaymentReconciliationLinesStatus = ("MATCHED" | "UNMATCHED" | "DISPUTED")
/**
 *  (catalogue : payment_reconciliations.method)
 */
export type PaymentReconciliationsMethod = ("CASH" | "MTN_MOMO" | "ORANGE_MONEY" | "BANK_TRANSFER" | "CHEQUE" | "OTHER")
/**
 *  (catalogue : payment_reconciliations.status)
 */
export type PaymentReconciliationsStatus = ("DRAFT" | "VALIDATED")
/**
 *  (catalogue : payments.method)
 */
export type PaymentsMethod = ("CASH" | "MTN_MOMO" | "ORANGE_MONEY" | "BANK_TRANSFER" | "CHEQUE" | "OTHER")
/**
 *  (catalogue : payments.status)
 */
export type PaymentsStatus = ("PENDING" | "CONFIRMED" | "REJECTED")
/**
 *  (catalogue : physical_returns.condition_code)
 */
export type PhysicalReturnsConditionCode = ("SELLABLE" | "DAMAGED" | "QUARANTINE" | "OTHER")
/**
 *  (catalogue : prospect_contacts.origin)
 */
export type ProspectContactsOrigin = ("CRM" | "WEBSITE" | "WHATSAPP" | "MESSENGER" | "INSTAGRAM" | "MANUAL")
/**
 *  (catalogue : public_booking_requests.status)
 */
export type PublicBookingRequestsStatus = ("RECEIVED" | "PENDING" | "CONFIRMED" | "CONFLICT" | "CANCELLED" | "REJECTED")
/**
 *  (catalogue : public_contents.status)
 */
export type PublicContentsStatus = ("DRAFT" | "PUBLISHED" | "ARCHIVED")
/**
 *  (catalogue : quotes.status)
 */
export type QuotesStatus = ("DRAFT" | "ISSUED" | "ACCEPTED" | "DECLINED" | "EXPIRED" | "CONVERTED")
/**
 *  (catalogue : refunds.method)
 */
export type RefundsMethod = ("CASH" | "MTN_MOMO" | "ORANGE_MONEY" | "BANK_TRANSFER" | "CHEQUE" | "OTHER")
/**
 *  (catalogue : reminder_policies.channel)
 */
export type ReminderPoliciesChannel = ("INTERNAL" | "CALL" | "SMS" | "WHATSAPP")
/**
 *  (catalogue : reminder_policies.offset_unit)
 */
export type ReminderPoliciesOffsetUnit = ("HOUR" | "DAY" | "MONTH")
/**
 *  (catalogue : reminder_policies.purpose)
 */
export type ReminderPoliciesPurpose = ("APPOINTMENT" | "FOLLOW_UP" | "ORDER_UPDATE" | "PAYMENT_FOLLOW_UP")
/**
 *  (catalogue : restore_tests.status)
 */
export type RestoreTestsStatus = ("RUNNING" | "PASSED" | "FAILED")
/**
 *  (catalogue : stock_alerts.kind)
 */
export type StockAlertsKind = ("LOW_STOCK" | "EXPIRY")
/**
 *  (catalogue : stock_alerts.status)
 */
export type StockAlertsStatus = ("OPEN" | "ACKNOWLEDGED" | "RESOLVED")
/**
 *  (catalogue : stock_lots.status)
 */
export type StockLotsStatus = ("SELLABLE" | "QUARANTINE")
/**
 *  (catalogue : stock_movements.kind)
 */
export type StockMovementsKind = ("OPENING" | "RECEIPT" | "SALE_DELIVERY" | "PATIENT_RETURN" | "BREAKAGE" | "SUPPLIER_RETURN" | "ADJUSTMENT")
/**
 *  (catalogue : stock_reservations.status)
 */
export type StockReservationsStatus = ("ACTIVE" | "CONSUMED" | "RELEASED")
/**
 *  (catalogue : stored_files.classification)
 */
export type StoredFilesClassification = ("MEDICAL" | "FINANCIAL" | "INTERNAL" | "PUBLIC_APPROVED")
/**
 *  (catalogue : sync_change_log.change_kind)
 */
export type SyncChangeLogChangeKind = ("CREATED" | "UPDATED" | "ARCHIVED")
/**
 *  (catalogue : sync_change_log.visibility)
 */
export type SyncChangeLogVisibility = ("ADMINISTRATIVE" | "CLINICAL" | "FINANCIAL" | "MANAGER" | "PUBLIC")
/**
 *  (catalogue : sync_command_results.status)
 */
export type SyncCommandResultsStatus = ("RECEIVED" | "ACCEPTED" | "WAITING_DEPENDENCY" | "CONFLICT_REQUIRES_REVIEW" | "REJECTED")
/**
 *  (catalogue : sync_conflicts.status)
 */
export type SyncConflictsStatus = ("OPEN" | "RESOLVED")
/**
 *  (catalogue : visits.reason)
 */
export type VisitsReason = ("EXAM" | "DIRECT_PURCHASE" | "PICKUP" | "FOLLOW_UP")
/**
 *  (catalogue : visits.status)
 */
export type VisitsStatus = ("ARRIVED" | "AWAITING_EXAM_FEE" | "READY_FOR_EXAM" | "IN_CONSULTATION" | "COMPLETED" | "CANCELLED")
/**
 *  (catalogue : webhook_inbox.status)
 */
export type WebhookInboxStatus = ("RECEIVED" | "VERIFIED" | "PROCESSED" | "REJECTED" | "FAILED")
/**
 *  (catalogue : workshop_events.event_type)
 */
export type WorkshopEventsEventType = ("STATUS_CHANGE" | "REWORK" | "QUALITY_CHECK" | "ADJUSTMENT" | "CANCEL")
/**
 *  (catalogue : workshop_events.quality_result)
 */
export type WorkshopEventsQualityResult = ("PASSED" | "FAILED" | "NOT_APPLICABLE")
/**
 *  (catalogue : workshop_order_eyes.eye)
 */
export type WorkshopOrderEyesEye = ("OD" | "OG")
/**
 *  (catalogue : workshop_orders.status)
 */
export type WorkshopOrdersStatus = ("ORDERED" | "RECEIVED" | "MOUNTING" | "QUALITY_CHECK" | "READY" | "DELIVERED" | "CANCELLED")
/**
 * Codes du fichier 08 et compléments documentés (F05). Un nouveau code s'ajoute ici avec sa route. STATE_TRANSITION_REFUSED (409) : l'état actuel de la ressource ne permet pas l'opération (consultation déjà démarrée, visite non démarrable, consultation terminée) ; details.current_status porte ce statut.
 */
export type ErrorCode = ("AUTH_REQUIRED" | "SESSION_CONTEXT_EXPIRED" | "SESSION_REQUIRED" | "ACTION_FORBIDDEN" | "RESOURCE_NOT_FOUND" | "METHOD_NOT_ALLOWED" | "VERSION_CONFLICT" | "STATE_TRANSITION_REFUSED" | "PAYMENT_EXCEEDS_BALANCE" | "STOCK_UNAVAILABLE" | "IDEMPOTENCY_PAYLOAD_MISMATCH" | "SLOT_UNAVAILABLE" | "VALIDATION_FAILED" | "EXAM_PAYMENT_REQUIRED" | "APPROVAL_REQUIRED_OR_EXPIRED" | "REAUTHENTICATION_REQUIRED" | "LOT_EXPIRED" | "RATE_LIMITED" | "DEPENDENCY_UNAVAILABLE" | "CLINIC_NOT_CONFIGURED" | "CLINIC_ALREADY_SET_UP" | "LAST_MANAGER_REQUIRED" | "MANAGER_RESET_REQUIRES_CONSOLE" | "SELF_DEACTIVATION_FORBIDDEN" | "SELF_OVERRIDE_FORBIDDEN" | "SELF_RESET_FORBIDDEN" | "SELF_ROLE_CHANGE_FORBIDDEN" | "WRITE_OWNER_REQUIRED" | "NUMBER_RANGE_EXHAUSTED" | "GRANT_EXPIRED_OR_REVOKED" | "AUTHORIZATION_REVIEW_REQUIRED" | "SYNC_INTEGRITY_FAILED" | "SYNC_SEQUENCE_GAP" | "SYNC_INCOMPLETE" | "NUMBER_RANGE_INVALID" | "DEPENDENCY_REJECTED" | "FINANCIAL_DEVICE_ELSEWHERE" | "DEVICE_REPLACED" | "PAYLOAD_TOO_LARGE" | "SERVER_BUSY" | "HTTP_ERROR" | "INTERNAL_ERROR")
/**
 * Contenu exact de l'opération à approuver ; la nature (kind) fixe l'action, la cible et les champs.
 */
export type ApprovalSubject = (ExamFeeWaiverSubject | DraftLineRightsSubject | PaymentReversalSubject | CreditNoteSubject | RefundSubject | CreditDeliverySubject | StockMovementSubject | CashMovementSubject)
/**
 * Élément de l'activité, distingué par type.
 */
export type PatientActivityItem = (PatientActivityVisit | PatientActivityConsultation | PatientActivityPrescription | PatientActivityMedicationOrder | PatientActivityInvoice | PatientActivityReceipt | PatientActivityCreditNote | PatientActivityRefund)
export type VectorCase = (({
expected: unknown
} | {
error: unknown
}) & {
id: string
operation: string
description?: string
/**
 * Scénarios de recette (fichier 14), exigences (fichier 17) ou tests d'intégration (fichier 25) illustrés par ce cas.
 * 
 * @minItems 1
 */
covers?: [string, ...(string)[]]
input: {

}
expected?: unknown
error?: VectorRefusal
})
/**
 * Commandes disponibles dans le journal local (actions du fichier 08 jouables hors-ligne).
 */
export type CommandName = ("CreatePatient" | "UpdatePatient" | "RegisterVisit" | "StartConsultation" | "SaveClinicalStep" | "CompleteConsultation" | "AmendConsultation" | "CreatePrescription" | "ValidatePrescription" | "CreateInvoiceDraft" | "UpdateDraft" | "IssueInvoice" | "RegisterPayment" | "ReversePayment" | "IssueCreditNote" | "RefundCredit" | "OpenCashSession" | "CloseCashSession" | "ConfirmDelivery" | "RegisterPhysicalReturn" | "RegisterStockMovement" | "CreateFollowUp" | "CreateAppointment" | "RecordContactAttempt" | "RequestApproval" | "DecideApproval")
/**
 * Événements de la version 1 (fichier 08).
 */
export type EventType = ("PatientCreated" | "ConsultationCompleted" | "PrescriptionValidated" | "FollowUpScheduled" | "AppointmentConfirmed" | "AppointmentRescheduled" | "AppointmentCancelled" | "InvoiceIssued" | "PaymentConfirmed" | "CreditNoteIssued" | "DeliveryConfirmed" | "StockThresholdCrossed" | "WorkshopReady")

export interface ContractTypes {
SchemasClinicalStepsJsonAnamnesis?: Anamnesis
SchemasClinicalStepsJsonHistories?: Histories
SchemasClinicalStepsJsonVisualAcuity?: VisualAcuity
SchemasClinicalStepsJsonRefraction?: Refraction
SchemasClinicalStepsJsonCentering?: Centering
SchemasClinicalStepsJsonMedications?: Medications
SchemasClinicalStepsJsonConclusion?: Conclusion
SchemasClinicalStepsJsonStepName?: StepName
SchemasClinicalStepsJsonAllSteps?: AllSteps
SchemasCommonJsonUlid?: Ulid
SchemasCommonJsonNullableUlid?: NullableUlid
SchemasCommonJsonCode?: Code
SchemasCommonJsonPermissionCode?: PermissionCode
SchemasCommonJsonSha256Hex?: Sha256Hex
SchemasCommonJsonNullableSha256Hex?: NullableSha256Hex
SchemasCommonJsonCompactJws?: CompactJws
SchemasCommonJsonMoneyXaf?: MoneyXaf
SchemasCommonJsonPositiveMoneyXaf?: PositiveMoneyXaf
SchemasCommonJsonSignedMoneyXaf?: SignedMoneyXaf
SchemasCommonJsonCurrency?: Currency
SchemasCommonJsonQuantity?: Quantity
SchemasCommonJsonSignedQuantity?: SignedQuantity
SchemasCommonJsonDiopter?: Diopter
SchemasCommonJsonNullableDiopter?: NullableDiopter
SchemasCommonJsonRate?: Rate
SchemasCommonJsonCounter?: Counter
SchemasCommonJsonVersion?: Version
SchemasCommonJsonInstant?: Instant
SchemasCommonJsonNullableInstant?: NullableInstant
SchemasCommonJsonCivilDate?: CivilDate
SchemasCommonJsonNullableCivilDate?: NullableCivilDate
SchemasCommonJsonLocalTime?: LocalTime
SchemasCommonJsonShortText?: ShortText
SchemasCommonJsonReason?: Reason
SchemasCommonJsonPhone?: Phone
SchemasCommonJsonPagination?: Pagination
CompatibilityDeclaration?: CompatibilityDeclaration
SchemasEnumsJsonAppointmentsSource?: AppointmentsSource
SchemasEnumsJsonAppointmentsStatus?: AppointmentsStatus
SchemasEnumsJsonApprovalsStatus?: ApprovalsStatus
SchemasEnumsJsonAssistantRunsStatus?: AssistantRunsStatus
SchemasEnumsJsonBackupRunsScope?: BackupRunsScope
SchemasEnumsJsonBackupRunsStatus?: BackupRunsStatus
SchemasEnumsJsonCalendarBlocksOrigin?: CalendarBlocksOrigin
SchemasEnumsJsonCalendarSyncStatesStatus?: CalendarSyncStatesStatus
SchemasEnumsJsonCampaignDefinitionsStatus?: CampaignDefinitionsStatus
SchemasEnumsJsonCampaignRecipientsStatus?: CampaignRecipientsStatus
SchemasEnumsJsonCashMovementsKind?: CashMovementsKind
SchemasEnumsJsonCatalogItemsStockMode?: CatalogItemsStockMode
SchemasEnumsJsonCatalogPublicationsStatus?: CatalogPublicationsStatus
SchemasEnumsJsonCommunicationConsentsChannel?: CommunicationConsentsChannel
SchemasEnumsJsonCommunicationConsentsPurpose?: CommunicationConsentsPurpose
SchemasEnumsJsonCommunicationConsentsStatus?: CommunicationConsentsStatus
SchemasEnumsJsonConsultationHistoriesHistoryGroup?: ConsultationHistoriesHistoryGroup
SchemasEnumsJsonConsultationHistoryTermsTermGroup?: ConsultationHistoryTermsTermGroup
SchemasEnumsJsonConsultationsReferralUrgency?: ConsultationsReferralUrgency
SchemasEnumsJsonConsultationsStatus?: ConsultationsStatus
SchemasEnumsJsonContactAttemptsResult?: ContactAttemptsResult
SchemasEnumsJsonContactTasksChannel?: ContactTasksChannel
SchemasEnumsJsonContactTasksStatus?: ContactTasksStatus
SchemasEnumsJsonConversationHandoffsEventType?: ConversationHandoffsEventType
SchemasEnumsJsonCreditNotesStatus?: CreditNotesStatus
SchemasEnumsJsonCrmConversationsChannel?: CrmConversationsChannel
SchemasEnumsJsonCrmConversationsStatus?: CrmConversationsStatus
SchemasEnumsJsonCrmLeadsStatus?: CrmLeadsStatus
SchemasEnumsJsonDeliveriesStatus?: DeliveriesStatus
SchemasEnumsJsonDeviceStockAllocationsStatus?: DeviceStockAllocationsStatus
SchemasEnumsJsonDocumentNumberAllocationsDocumentType?: DocumentNumberAllocationsDocumentType
SchemasEnumsJsonDocumentNumberAllocationsStatus?: DocumentNumberAllocationsStatus
SchemasEnumsJsonDocumentNumberUsagesDocumentType?: DocumentNumberUsagesDocumentType
SchemasEnumsJsonDocumentNumberUsagesStatus?: DocumentNumberUsagesStatus
SchemasEnumsJsonDocumentSequencesDocumentType?: DocumentSequencesDocumentType
SchemasEnumsJsonEnrolledDevicesStatus?: EnrolledDevicesStatus
SchemasEnumsJsonExportRequestsExportType?: ExportRequestsExportType
SchemasEnumsJsonExportRequestsStatus?: ExportRequestsStatus
SchemasEnumsJsonExternalLinksStatus?: ExternalLinksStatus
SchemasEnumsJsonFollowUpPlansAdvanceUnit?: FollowUpPlansAdvanceUnit
SchemasEnumsJsonFollowUpPlansAnchorKind?: FollowUpPlansAnchorKind
SchemasEnumsJsonFollowUpPlansDateOrigin?: FollowUpPlansDateOrigin
SchemasEnumsJsonFollowUpPlansIntervalUnit?: FollowUpPlansIntervalUnit
SchemasEnumsJsonFollowUpPlansPreferredChannel?: FollowUpPlansPreferredChannel
SchemasEnumsJsonFollowUpPlansReason?: FollowUpPlansReason
SchemasEnumsJsonFollowUpPlansStatus?: FollowUpPlansStatus
SchemasEnumsJsonGeneratedDocumentsDocumentType?: GeneratedDocumentsDocumentType
SchemasEnumsJsonGeneratedDocumentsStatus?: GeneratedDocumentsStatus
SchemasEnumsJsonGoodsReceiptsStatus?: GoodsReceiptsStatus
SchemasEnumsJsonIdempotencyRequestsStatus?: IdempotencyRequestsStatus
SchemasEnumsJsonIntegrationAccountsProvider?: IntegrationAccountsProvider
SchemasEnumsJsonIntegrationAccountsStatus?: IntegrationAccountsStatus
SchemasEnumsJsonInventoryCountsStatus?: InventoryCountsStatus
SchemasEnumsJsonInvoiceWriteOwnersStatus?: InvoiceWriteOwnersStatus
SchemasEnumsJsonInvoicesOrigin?: InvoicesOrigin
SchemasEnumsJsonInvoicesStatus?: InvoicesStatus
SchemasEnumsJsonKnowledgeEntriesCategory?: KnowledgeEntriesCategory
SchemasEnumsJsonMedicationOrdersDurationUnit?: MedicationOrdersDurationUnit
SchemasEnumsJsonMedicationOrdersForm?: MedicationOrdersForm
SchemasEnumsJsonMessageAttemptsStatus?: MessageAttemptsStatus
SchemasEnumsJsonMessageTemplateVersionsProviderApprovalStatus?: MessageTemplateVersionsProviderApprovalStatus
SchemasEnumsJsonMessageTemplatesChannel?: MessageTemplatesChannel
SchemasEnumsJsonMessageTemplatesPurpose?: MessageTemplatesPurpose
SchemasEnumsJsonOpticalPrescriptionEyesEye?: OpticalPrescriptionEyesEye
SchemasEnumsJsonOpticalPrescriptionsOrigin?: OpticalPrescriptionsOrigin
SchemasEnumsJsonOpticalPrescriptionsStatus?: OpticalPrescriptionsStatus
SchemasEnumsJsonOutboxEventsStatus?: OutboxEventsStatus
SchemasEnumsJsonPatientRecordsSex?: PatientRecordsSex
SchemasEnumsJsonPaymentReconciliationLinesStatus?: PaymentReconciliationLinesStatus
SchemasEnumsJsonPaymentReconciliationsMethod?: PaymentReconciliationsMethod
SchemasEnumsJsonPaymentReconciliationsStatus?: PaymentReconciliationsStatus
SchemasEnumsJsonPaymentsMethod?: PaymentsMethod
SchemasEnumsJsonPaymentsStatus?: PaymentsStatus
SchemasEnumsJsonPhysicalReturnsConditionCode?: PhysicalReturnsConditionCode
SchemasEnumsJsonProspectContactsOrigin?: ProspectContactsOrigin
SchemasEnumsJsonPublicBookingRequestsStatus?: PublicBookingRequestsStatus
SchemasEnumsJsonPublicContentsStatus?: PublicContentsStatus
SchemasEnumsJsonQuotesStatus?: QuotesStatus
SchemasEnumsJsonRefractionMeasurementsEye?: RefractionMeasurementsEye
SchemasEnumsJsonRefractionMeasurementsStage?: RefractionMeasurementsStage
SchemasEnumsJsonRefundsMethod?: RefundsMethod
SchemasEnumsJsonReminderPoliciesChannel?: ReminderPoliciesChannel
SchemasEnumsJsonReminderPoliciesOffsetUnit?: ReminderPoliciesOffsetUnit
SchemasEnumsJsonReminderPoliciesPurpose?: ReminderPoliciesPurpose
SchemasEnumsJsonRestoreTestsStatus?: RestoreTestsStatus
SchemasEnumsJsonStockAlertsKind?: StockAlertsKind
SchemasEnumsJsonStockAlertsStatus?: StockAlertsStatus
SchemasEnumsJsonStockLotsStatus?: StockLotsStatus
SchemasEnumsJsonStockMovementsKind?: StockMovementsKind
SchemasEnumsJsonStockReservationsStatus?: StockReservationsStatus
SchemasEnumsJsonStoredFilesClassification?: StoredFilesClassification
SchemasEnumsJsonSyncChangeLogChangeKind?: SyncChangeLogChangeKind
SchemasEnumsJsonSyncChangeLogVisibility?: SyncChangeLogVisibility
SchemasEnumsJsonSyncCommandResultsStatus?: SyncCommandResultsStatus
SchemasEnumsJsonSyncConflictsStatus?: SyncConflictsStatus
SchemasEnumsJsonVisitsReason?: VisitsReason
SchemasEnumsJsonVisitsStatus?: VisitsStatus
SchemasEnumsJsonVisualAcuitiesContext?: VisualAcuitiesContext
SchemasEnumsJsonVisualAcuitiesCorrection?: VisualAcuitiesCorrection
SchemasEnumsJsonVisualAcuitiesDistance?: VisualAcuitiesDistance
SchemasEnumsJsonVisualAcuitiesEye?: VisualAcuitiesEye
SchemasEnumsJsonWebhookInboxStatus?: WebhookInboxStatus
SchemasEnumsJsonWorkshopEventsEventType?: WorkshopEventsEventType
SchemasEnumsJsonWorkshopEventsQualityResult?: WorkshopEventsQualityResult
SchemasEnumsJsonWorkshopOrderEyesEye?: WorkshopOrderEyesEye
SchemasEnumsJsonWorkshopOrdersStatus?: WorkshopOrdersStatus
ErrorEnvelope?: ErrorEnvelope
SchemasErrorJsonErrorCode?: ErrorCode
SchemasRequestsHttpJsonLoginRequest?: LoginRequest
SchemasRequestsHttpJsonReauthenticateRequest?: ReauthenticateRequest
SchemasRequestsHttpJsonChangePasswordRequest?: ChangePasswordRequest
SchemasRequestsHttpJsonCreateStaffRequest?: CreateStaffRequest
SchemasRequestsHttpJsonUpdateStaffRequest?: UpdateStaffRequest
SchemasRequestsHttpJsonPermissionOverrideRequest?: PermissionOverrideRequest
SchemasRequestsHttpJsonResetPasswordRequest?: ResetPasswordRequest
SchemasRequestsHttpJsonUpdateClinicSettingsRequest?: UpdateClinicSettingsRequest
SchemasRequestsHttpJsonUpdatePrescriptionDraftRequest?: UpdatePrescriptionDraftRequest
SchemasRequestsHttpJsonRescheduleAppointmentRequest?: RescheduleAppointmentRequest
SchemasRequestsHttpJsonCancelAppointmentRequest?: CancelAppointmentRequest
SchemasRequestsHttpJsonMarkAppointmentNoShowRequest?: MarkAppointmentNoShowRequest
SchemasRequestsHttpJsonSchedulingResourceRequest?: SchedulingResourceRequest
SchemasRequestsHttpJsonOpeningHoursRequest?: OpeningHoursRequest
SchemasRequestsHttpJsonResourceExceptionRequest?: ResourceExceptionRequest
SchemasRequestsHttpJsonAppointmentServiceRequest?: AppointmentServiceRequest
SchemasRequestsHttpJsonCatalogItemRequest?: CatalogItemRequest
SchemasRequestsHttpJsonCatalogImportRequest?: CatalogImportRequest
SchemasRequestsHttpJsonStoreDocumentContentCommand?: StoreDocumentContentCommand
SchemasRequestsHttpJsonLegacyBalanceImportRequest?: LegacyBalanceImportRequest
SchemasRequestsHttpJsonStoreLegacyEvidenceCommand?: StoreLegacyEvidenceCommand
SchemasRequestsHttpJsonTaxRuleRequest?: TaxRuleRequest
SchemasRequestsHttpJsonCreateQuoteDraftRequest?: CreateQuoteDraftRequest
SchemasRequestsHttpJsonUpdateQuoteDraftRequest?: UpdateQuoteDraftRequest
SchemasRequestsHttpJsonIssueQuoteRequest?: IssueQuoteRequest
SchemasRequestsHttpJsonReviseQuoteRequest?: ReviseQuoteRequest
SchemasRequestsHttpJsonQuoteDecisionRequest?: QuoteDecisionRequest
SchemasRequestsHttpJsonConvertQuoteRequest?: ConvertQuoteRequest
SchemasRequestsHttpJsonAbandonInvoiceDraftRequest?: AbandonInvoiceDraftRequest
SchemasRequestsHttpJsonMergePatientsRequest?: MergePatientsRequest
SchemasRequestsHttpJsonRecordCashMovementRequest?: RecordCashMovementRequest
SchemasRequestsHttpJsonExpenseCategoryRequest?: ExpenseCategoryRequest
SchemasRequestsHttpJsonCashVarianceReviewRequest?: CashVarianceReviewRequest
SchemasRequestsHttpJsonDeletePrescriptionDraftRequest?: DeletePrescriptionDraftRequest
SchemasRequestsHttpJsonDeleteQuoteDraftRequest?: DeleteQuoteDraftRequest
SchemasRequestsHttpJsonCancelFollowUpRequest?: CancelFollowUpRequest
SchemasRequestsHttpJsonDeleteConsultationDraftRequest?: DeleteConsultationDraftRequest
SchemasRequestsHttpJsonCancelVisitRequest?: CancelVisitRequest
SchemasRequestsHttpJsonOpeningStockRequest?: OpeningStockRequest
SchemasRequestsHttpJsonEnrollDeviceRequest?: EnrollDeviceRequest
SchemasRequestsHttpJsonIssueOfflineGrantRequest?: IssueOfflineGrantRequest
SchemasRequestsHttpJsonRevokeDeviceRequest?: RevokeDeviceRequest
SchemasRequestsHttpJsonRevokeOfflineGrantRequest?: RevokeOfflineGrantRequest
SchemasRequestsHttpJsonPrepareDeviceRequest?: PrepareDeviceRequest
SchemasRequestsHttpJsonReleaseDeviceRequest?: ReleaseDeviceRequest
SchemasRequestsHttpJsonReplaceDeviceRequest?: ReplaceDeviceRequest
SchemasRequestsHttpJsonReconcileReplacementRequest?: ReconcileReplacementRequest
SchemasRequestsHttpJsonConflictResolutionRequest?: ConflictResolutionRequest
SchemasRequestsHttpJsonCreateExportRequest?: CreateExportRequest
SchemasRequestsHttpJsonBookingRequest?: BookingRequest
SchemasResourcesAccessJsonStaffMemberSummary?: StaffMemberSummary
SchemasResourcesAccessJsonStaffMember?: StaffMember
SchemasResourcesAccessJsonClinicSummary?: ClinicSummary
SchemasResourcesAccessJsonMe?: Me
SchemasResourcesAccessJsonClinicSettings?: ClinicSettings
SchemasResourcesAccessJsonClinicDocumentIdentity?: ClinicDocumentIdentity
SchemasResourcesAccessJsonClinicDocumentIdentityResponse?: ClinicDocumentIdentityResponse
SchemasResourcesAccessJsonReauthentication?: Reauthentication
SchemasResourcesAccessJsonStaffMemberResponse?: StaffMemberResponse
SchemasResourcesAccessJsonStaffMemberPage?: StaffMemberPage
SchemasResourcesAccessJsonMeResponse?: MeResponse
SchemasResourcesAccessJsonClinicSettingsResponse?: ClinicSettingsResponse
SchemasResourcesAccessJsonReauthenticationResponse?: ReauthenticationResponse
SchemasResourcesBillingJsonCatalogItem?: CatalogItem
SchemasResourcesBillingJsonCatalogPage?: CatalogPage
SchemasResourcesBillingJsonCatalogItemResponse?: CatalogItemResponse
SchemasResourcesBillingJsonTaxRule?: TaxRule
SchemasResourcesBillingJsonTaxRuleResponse?: TaxRuleResponse
SchemasResourcesBillingJsonTaxRuleList?: TaxRuleList
SchemasResourcesBillingJsonImportReport?: ImportReport
SchemasResourcesBillingJsonImportReportResponse?: ImportReportResponse
SchemasResourcesBillingJsonLegacyEvidence?: LegacyEvidence
SchemasResourcesBillingJsonLegacyEvidenceResponse?: LegacyEvidenceResponse
SchemasResourcesBillingJsonInvoiceLine?: InvoiceLine
SchemasResourcesBillingJsonInvoiceBalance?: InvoiceBalance
SchemasResourcesBillingJsonInvoicePayment?: InvoicePayment
SchemasResourcesBillingJsonDocumentState?: DocumentState
SchemasResourcesBillingJsonInvoice?: Invoice
SchemasResourcesBillingJsonInvoiceSummary?: InvoiceSummary
SchemasResourcesBillingJsonInvoiceResponse?: InvoiceResponse
SchemasResourcesBillingJsonQuoteRecipient?: QuoteRecipient
SchemasResourcesBillingJsonQuoteLine?: QuoteLine
SchemasResourcesBillingJsonQuoteRevision?: QuoteRevision
SchemasResourcesBillingJsonQuote?: Quote
SchemasResourcesBillingJsonQuoteSummary?: QuoteSummary
SchemasResourcesBillingJsonQuoteResponse?: QuoteResponse
SchemasResourcesBillingJsonQuoteDeletion?: QuoteDeletion
SchemasResourcesBillingJsonDeleteQuoteDraftResponse?: DeleteQuoteDraftResponse
SchemasResourcesBillingJsonQuotePage?: QuotePage
SchemasResourcesBillingJsonInvoicePage?: InvoicePage
SchemasResourcesBillingJsonPaymentResult?: PaymentResult
SchemasResourcesBillingJsonReversalResult?: ReversalResult
SchemasResourcesBillingJsonCreditNoteResult?: CreditNoteResult
SchemasResourcesBillingJsonRefundResult?: RefundResult
SchemasResourcesBillingJsonPaymentResultResponse?: PaymentResultResponse
SchemasResourcesBillingJsonReversalResultResponse?: ReversalResultResponse
SchemasResourcesBillingJsonCreditNoteResultResponse?: CreditNoteResultResponse
SchemasResourcesBillingJsonRefundResultResponse?: RefundResultResponse
SchemasResourcesBillingJsonCreditNote?: CreditNote
SchemasResourcesBillingJsonCreditNoteResponse?: CreditNoteResponse
SchemasResourcesBillingJsonRefund?: Refund
SchemasResourcesBillingJsonRefundResponse?: RefundResponse
SchemasResourcesBillingJsonApproval?: Approval
SchemasResourcesBillingJsonApprovalTarget?: ApprovalTarget
SchemasResourcesBillingJsonApprovalResponse?: ApprovalResponse
SchemasResourcesBillingJsonApprovalPage?: ApprovalPage
SchemasResourcesBillingJsonCashRegister?: CashRegister
SchemasResourcesBillingJsonCashRegisterList?: CashRegisterList
SchemasResourcesBillingJsonReceipt?: Receipt
SchemasResourcesBillingJsonReceiptResponse?: ReceiptResponse
SchemasResourcesBillingJsonCashSession?: CashSession
SchemasResourcesBillingJsonCashSessionResponse?: CashSessionResponse
SchemasResourcesBillingJsonCurrentCashSessionResponse?: CurrentCashSessionResponse
SchemasResourcesBillingJsonDelivery?: Delivery
SchemasResourcesBillingJsonDeliveryResponse?: DeliveryResponse
SchemasResourcesBillingJsonInvoiceDeliveries?: InvoiceDeliveries
SchemasResourcesBillingJsonInvoiceDeliveriesResponse?: InvoiceDeliveriesResponse
SchemasResourcesBillingJsonCashSessionEntry?: CashSessionEntry
SchemasResourcesBillingJsonCashSessionPage?: CashSessionPage
SchemasResourcesBillingJsonCashSessionReport?: CashSessionReport
SchemasResourcesBillingJsonCashSessionReportResponse?: CashSessionReportResponse
SchemasResourcesBillingJsonExpenseCategory?: ExpenseCategory
SchemasResourcesBillingJsonExpenseCategoryResponse?: ExpenseCategoryResponse
SchemasResourcesBillingJsonExpenseCategoryList?: ExpenseCategoryList
SchemasResourcesBillingJsonCashMovement?: CashMovement
SchemasResourcesBillingJsonCashMovementResponse?: CashMovementResponse
SchemasResourcesBillingJsonCashVarianceReview?: CashVarianceReview
SchemasResourcesBillingJsonCashVarianceReviewResponse?: CashVarianceReviewResponse
SchemasResourcesBillingJsonCashSessionMovements?: CashSessionMovements
SchemasResourcesBillingJsonCashSessionMovementsResponse?: CashSessionMovementsResponse
SchemasResourcesBillingJsonCashDayReport?: CashDayReport
SchemasResourcesBillingJsonCashDayReportResponse?: CashDayReportResponse
SchemasResourcesBillingJsonSalesSettings?: SalesSettings
SchemasResourcesBillingJsonSalesSettingsResponse?: SalesSettingsResponse
SchemasResourcesClinicalJsonClinicalRevision?: ClinicalRevision
SchemasResourcesClinicalJsonClinicalRevisionDetail?: ClinicalRevisionDetail
SchemasResourcesClinicalJsonClinicalRevisionResponse?: ClinicalRevisionResponse
SchemasResourcesClinicalJsonConsultationPatient?: ConsultationPatient
SchemasResourcesClinicalJsonConsultationHeaderPatient?: ConsultationHeaderPatient
SchemasResourcesClinicalJsonConsultation?: Consultation
SchemasResourcesClinicalJsonConsultationSummary?: ConsultationSummary
SchemasResourcesClinicalJsonConsultationSummaryPage?: ConsultationSummaryPage
SchemasResourcesClinicalJsonVisualAcuityScale?: VisualAcuityScale
SchemasResourcesClinicalJsonVisualAcuityScaleList?: VisualAcuityScaleList
SchemasResourcesClinicalJsonPrescription?: Prescription
SchemasResourcesClinicalJsonConsultationResponse?: ConsultationResponse
SchemasResourcesClinicalJsonConsultationDeletion?: ConsultationDeletion
SchemasResourcesClinicalJsonDeleteConsultationDraftResponse?: DeleteConsultationDraftResponse
SchemasResourcesClinicalJsonPrescriptionDeletion?: PrescriptionDeletion
SchemasResourcesClinicalJsonDeletePrescriptionDraftResponse?: DeletePrescriptionDraftResponse
SchemasResourcesClinicalJsonPrescriptionResponse?: PrescriptionResponse
SchemasResourcesClinicalJsonPrescriptionList?: PrescriptionList
SchemasResourcesOperationsJsonPublicJwk?: PublicJwk
SchemasResourcesOperationsJsonEnrolledDevice?: EnrolledDevice
SchemasResourcesOperationsJsonEnrolledDeviceResponse?: EnrolledDeviceResponse
SchemasResourcesOperationsJsonEnrolledDeviceList?: EnrolledDeviceList
SchemasResourcesOperationsJsonOfflineGrant?: OfflineGrant
SchemasResourcesOperationsJsonOfflineGrantResponse?: OfflineGrantResponse
SchemasResourcesOperationsJsonOfflineGrantList?: OfflineGrantList
SchemasResourcesOperationsJsonSigningKeySet?: SigningKeySet
SchemasResourcesOperationsJsonSigningKeySetResponse?: SigningKeySetResponse
SchemasResourcesOperationsJsonNumberAllocation?: NumberAllocation
SchemasResourcesOperationsJsonStockQuota?: StockQuota
SchemasResourcesOperationsJsonPreparation?: Preparation
SchemasResourcesOperationsJsonPreparationResponse?: PreparationResponse
SchemasResourcesOperationsJsonRelease?: Release
SchemasResourcesOperationsJsonReleaseResponse?: ReleaseResponse
SchemasResourcesOperationsJsonReplacement?: Replacement
SchemasResourcesOperationsJsonReplacementResponse?: ReplacementResponse
SchemasResourcesOperationsJsonCompatibilityResponse?: CompatibilityResponse
SchemasResourcesOperationsJsonDeviceHealth?: DeviceHealth
SchemasResourcesOperationsJsonDeviceHealthResponse?: DeviceHealthResponse
SchemasResourcesOperationsJsonConflict?: Conflict
SchemasResourcesOperationsJsonConflictPage?: ConflictPage
SchemasResourcesOperationsJsonConflictResponse?: ConflictResponse
SchemasResourcesOperationsJsonGeneratedDocument?: GeneratedDocument
SchemasResourcesOperationsJsonGeneratedDocumentResponse?: GeneratedDocumentResponse
SchemasResourcesOperationsJsonExportRequest?: ExportRequest
SchemasResourcesOperationsJsonExportRequestResponse?: ExportRequestResponse
SchemasResourcesOperationsJsonExportRequestList?: ExportRequestList
SchemasResourcesOperationsJsonFinancialReport?: FinancialReport
SchemasResourcesOperationsJsonFinancialReportResponse?: FinancialReportResponse
SchemasResourcesOperationsJsonAuditEvent?: AuditEvent
SchemasResourcesOperationsJsonAuditEventPage?: AuditEventPage
SchemasResourcesPatientsJsonPatientSummary?: PatientSummary
SchemasResourcesPatientsJsonPatient?: Patient
SchemasResourcesPatientsJsonPatientHistory?: PatientHistory
SchemasResourcesPatientsJsonPatientResponse?: PatientResponse
SchemasResourcesPatientsJsonPatientPage?: PatientPage
SchemasResourcesPatientsJsonPatientHistoryResponse?: PatientHistoryResponse
SchemasResourcesPatientsJsonVisit?: Visit
SchemasResourcesPatientsJsonVisitPatient?: VisitPatient
SchemasResourcesPatientsJsonVisitResponse?: VisitResponse
SchemasResourcesPatientsJsonVisitPage?: VisitPage
SchemasResourcesPatientsJsonPatientMergeIdentity?: PatientMergeIdentity
SchemasResourcesPatientsJsonPatientMergePreview?: PatientMergePreview
SchemasResourcesPatientsJsonPatientMergePreviewResponse?: PatientMergePreviewResponse
SchemasResourcesPatientsJsonPatientMerge?: PatientMerge
SchemasResourcesPatientsJsonPatientMergeResponse?: PatientMergeResponse
SchemasResourcesPatientsJsonPatientActivityVisit?: PatientActivityVisit
SchemasResourcesPatientsJsonPatientActivityConsultation?: PatientActivityConsultation
SchemasResourcesPatientsJsonPatientActivityPrescription?: PatientActivityPrescription
SchemasResourcesPatientsJsonPatientActivityMedicationOrder?: PatientActivityMedicationOrder
SchemasResourcesPatientsJsonPatientActivityInvoice?: PatientActivityInvoice
SchemasResourcesPatientsJsonPatientActivityReceipt?: PatientActivityReceipt
SchemasResourcesPatientsJsonPatientActivityCreditNote?: PatientActivityCreditNote
SchemasResourcesPatientsJsonPatientActivityRefund?: PatientActivityRefund
SchemasResourcesPatientsJsonPatientActivityItem?: PatientActivityItem
SchemasResourcesPatientsJsonPatientActivitySection?: PatientActivitySection
SchemasResourcesPatientsJsonPatientActivityMeta?: PatientActivityMeta
SchemasResourcesPatientsJsonPatientActivity?: PatientActivity
SchemasResourcesPublicJsonPublicService?: PublicService
SchemasResourcesPublicJsonPublicServiceList?: PublicServiceList
SchemasResourcesPublicJsonPublicSlot?: PublicSlot
SchemasResourcesPublicJsonPublicSlotList?: PublicSlotList
SchemasResourcesPublicJsonBookingReceipt?: BookingReceipt
SchemasResourcesPublicJsonBookingReceiptResponse?: BookingReceiptResponse
SchemasResourcesSchedulingJsonSchedulingPatient?: SchedulingPatient
SchemasResourcesSchedulingJsonOpeningHour?: OpeningHour
SchemasResourcesSchedulingJsonSchedulingResource?: SchedulingResource
SchemasResourcesSchedulingJsonSchedulingResourceResponse?: SchedulingResourceResponse
SchemasResourcesSchedulingJsonAppointmentService?: AppointmentService
SchemasResourcesSchedulingJsonAppointmentServiceResponse?: AppointmentServiceResponse
SchemasResourcesSchedulingJsonResourceException?: ResourceException
SchemasResourcesSchedulingJsonResourceExceptionResponse?: ResourceExceptionResponse
SchemasResourcesSchedulingJsonAgendaConfiguration?: AgendaConfiguration
SchemasResourcesSchedulingJsonAgendaConfigurationResponse?: AgendaConfigurationResponse
SchemasResourcesSchedulingJsonAvailableSlots?: AvailableSlots
SchemasResourcesSchedulingJsonAvailableSlotsResponse?: AvailableSlotsResponse
SchemasResourcesSchedulingJsonFollowUpPlan?: FollowUpPlan
SchemasResourcesSchedulingJsonFollowUpPlanResponse?: FollowUpPlanResponse
SchemasResourcesSchedulingJsonFollowUpPlanList?: FollowUpPlanList
SchemasResourcesSchedulingJsonAppointment?: Appointment
SchemasResourcesSchedulingJsonAppointmentResponse?: AppointmentResponse
SchemasResourcesSchedulingJsonAppointmentList?: AppointmentList
SchemasResourcesSchedulingJsonContactAttempt?: ContactAttempt
SchemasResourcesSchedulingJsonContactTask?: ContactTask
SchemasResourcesSchedulingJsonContactTaskPage?: ContactTaskPage
SchemasResourcesSchedulingJsonContactTaskList?: ContactTaskList
SchemasResourcesSchedulingJsonContactAttemptResult?: ContactAttemptResult
SchemasResourcesSchedulingJsonContactAttemptResultResponse?: ContactAttemptResultResponse
SchemasResourcesSchedulingJsonActivityReport?: ActivityReport
SchemasResourcesSchedulingJsonActivityReportResponse?: ActivityReportResponse
SchemasResourcesSchedulingJsonClinicalReport?: ClinicalReport
SchemasResourcesSchedulingJsonClinicalReportResponse?: ClinicalReportResponse
SchemasResourcesStockJsonStockAvailability?: StockAvailability
SchemasResourcesStockJsonStockAvailabilityPage?: StockAvailabilityPage
SchemasResourcesStockJsonStockLocation?: StockLocation
SchemasResourcesStockJsonStockLocationList?: StockLocationList
SchemasResourcesStockJsonStockMovement?: StockMovement
SchemasResourcesStockJsonStockMovementResponse?: StockMovementResponse
SchemasResourcesStockJsonOpeningStockResult?: OpeningStockResult
SchemasResourcesStockJsonOpeningStockResponse?: OpeningStockResponse
SchemasResourcesStockJsonPhysicalReturn?: PhysicalReturn
SchemasResourcesStockJsonPhysicalReturnResponse?: PhysicalReturnResponse
SchemasRuleVectorsJson?: RuleVectors
SchemasRuleVectorsJsonVectorCase?: VectorCase
SchemasRuleVectorsJsonVectorRefusal?: VectorRefusal
Ack?: Ack
CommandCore?: CommandCore
PullPage?: PullPage
SyncPullPageJsonChange?: Change
PushRequest?: PushRequest
PushResponse?: PushResponse
SignedCommand?: SignedCommand
SyncSignedCommandJsonJwsProtectedHeader?: JwsProtectedHeader
SyncSignedCommandJsonJwsPayload?: JwsPayload
AmendConsultationPayload?: AmendConsultationPayload
CommandsAmendConsultationV1JsonDirectRequest?: AmendConsultationDirectRequest
CloseCashSessionPayload?: CloseCashSessionPayload
CommandsCloseCashSessionV1JsonDirectRequest?: CloseCashSessionDirectRequest
CompleteConsultationPayload?: CompleteConsultationPayload
CommandsCompleteConsultationV1JsonDirectRequest?: CompleteConsultationDirectRequest
ConfirmDeliveryPayload?: ConfirmDeliveryPayload
CommandsConfirmDeliveryV1JsonDirectRequest?: ConfirmDeliveryDirectRequest
CreateAppointmentPayload?: CreateAppointmentPayload
CommandsCreateAppointmentV1JsonDirectRequest?: CreateAppointmentDirectRequest
CreateFollowUpPayload?: CreateFollowUpPayload
CommandsCreateFollowUpV1JsonDirectRequest?: CreateFollowUpDirectRequest
CreateInvoiceDraftPayload?: CreateInvoiceDraftPayload
CommandsCreateInvoiceDraftV1JsonDirectRequest?: CreateInvoiceDraftDirectRequest
CreatePatientPayload?: CreatePatientPayload
CommandsCreatePatientV1JsonDirectRequest?: CreatePatientDirectRequest
CreatePrescriptionPayload?: CreatePrescriptionPayload
CommandsCreatePrescriptionV1JsonDirectRequest?: CreatePrescriptionDirectRequest
DecideApprovalPayload?: DecideApprovalPayload
CommandsDecideApprovalV1JsonDirectRequest?: DecideApprovalDirectRequest
IssueCreditNotePayload?: IssueCreditNotePayload
CommandsIssueCreditNoteV1JsonDirectRequest?: IssueCreditNoteDirectRequest
IssueInvoicePayload?: IssueInvoicePayload
CommandsIssueInvoiceV1JsonDirectRequest?: IssueInvoiceDirectRequest
OpenCashSessionPayload?: OpenCashSessionPayload
CommandsOpenCashSessionV1JsonDirectRequest?: OpenCashSessionDirectRequest
RecordContactAttemptPayload?: RecordContactAttemptPayload
CommandsRecordContactAttemptV1JsonDirectRequest?: RecordContactAttemptDirectRequest
RefundCreditPayload?: RefundCreditPayload
CommandsRefundCreditV1JsonDirectRequest?: RefundCreditDirectRequest
RegisterPaymentPayload?: RegisterPaymentPayload
CommandsRegisterPaymentV1JsonDirectRequest?: RegisterPaymentDirectRequest
RegisterPhysicalReturnPayload?: RegisterPhysicalReturnPayload
CommandsRegisterPhysicalReturnV1JsonDirectRequest?: RegisterPhysicalReturnDirectRequest
RegisterStockMovementPayload?: RegisterStockMovementPayload
CommandsRegisterStockMovementV1JsonDirectRequest?: RegisterStockMovementDirectRequest
RegisterVisitPayload?: RegisterVisitPayload
CommandsRegisterVisitV1JsonDirectRequest?: RegisterVisitDirectRequest
RequestApprovalPayload?: RequestApprovalPayload
CommandsRequestApprovalV1JsonDirectRequest?: RequestApprovalDirectRequest
CommandsRequestApprovalV1JsonApprovalSubject?: ApprovalSubject
CommandsRequestApprovalV1JsonExamFeeWaiverSubject?: ExamFeeWaiverSubject
CommandsRequestApprovalV1JsonDraftLineRightsSubject?: DraftLineRightsSubject
CommandsRequestApprovalV1JsonPaymentReversalSubject?: PaymentReversalSubject
CommandsRequestApprovalV1JsonCreditNoteSubject?: CreditNoteSubject
CommandsRequestApprovalV1JsonRefundSubject?: RefundSubject
CommandsRequestApprovalV1JsonCreditDeliverySubject?: CreditDeliverySubject
CommandsRequestApprovalV1JsonStockMovementSubject?: StockMovementSubject
CommandsRequestApprovalV1JsonCashMovementSubject?: CashMovementSubject
ReversePaymentPayload?: ReversePaymentPayload
CommandsReversePaymentV1JsonDirectRequest?: ReversePaymentDirectRequest
SaveClinicalStepPayload?: SaveClinicalStepPayload
CommandsSaveClinicalStepV1JsonDirectRequest?: SaveClinicalStepDirectRequest
StartConsultationPayload?: StartConsultationPayload
CommandsStartConsultationV1JsonDirectRequest?: StartConsultationDirectRequest
UpdateDraftPayload?: UpdateDraftPayload
CommandsUpdateDraftV1JsonDirectRequest?: UpdateDraftDirectRequest
UpdatePatientPayload?: UpdatePatientPayload
CommandsUpdatePatientV1JsonDirectRequest?: UpdatePatientDirectRequest
ValidatePrescriptionPayload?: ValidatePrescriptionPayload
CommandsValidatePrescriptionV1JsonDirectRequest?: ValidatePrescriptionDirectRequest
CommandsDispatchJsonCommandName?: CommandName
AppointmentCancelledEventPayload?: AppointmentCancelledEventPayload
AppointmentConfirmedEventPayload?: AppointmentConfirmedEventPayload
AppointmentRescheduledEventPayload?: AppointmentRescheduledEventPayload
ConsultationCompletedEventPayload?: ConsultationCompletedEventPayload
CreditNoteIssuedEventPayload?: CreditNoteIssuedEventPayload
DeliveryConfirmedEventPayload?: DeliveryConfirmedEventPayload
FollowUpScheduledEventPayload?: FollowUpScheduledEventPayload
InvoiceIssuedEventPayload?: InvoiceIssuedEventPayload
PatientCreatedEventPayload?: PatientCreatedEventPayload
PaymentConfirmedEventPayload?: PaymentConfirmedEventPayload
PrescriptionValidatedEventPayload?: PrescriptionValidatedEventPayload
StockThresholdCrossedEventPayload?: StockThresholdCrossedEventPayload
WorkshopReadyEventPayload?: WorkshopReadyEventPayload
EventEnvelope?: EventEnvelope
EventsEnvelopeJsonEventType?: EventType
ClinicalRevisionSnapshot?: ClinicalRevisionSnapshot
CreditNoteSnapshot?: CreditNoteSnapshot
DeliveryPatientSnapshot?: DeliveryPatientSnapshot
InvoiceClinicSnapshot?: InvoiceClinicSnapshot
InvoicePatientSnapshot?: InvoicePatientSnapshot
InvoiceTaxSnapshot?: InvoiceTaxSnapshot
QuoteRevisionSnapshot?: QuoteRevisionSnapshot
ReceiptSnapshot?: ReceiptSnapshot
RefundSnapshot?: RefundSnapshot
}
export interface Anamnesis {
symptoms: (string | null)
wears_glasses: (boolean | null)
glasses_duration: (string | null)
previous_correction_available: (boolean | null)
/**
 * @minItems 0
 * @maxItems 50
 */
complaints: {
id: Ulid
term_code: Code
other_text: (string | null)
}[]
}
export interface Histories {
/**
 * @minItems 0
 * @maxItems 3
 */
histories: []|[{
id: Ulid
history_group: ConsultationHistoriesHistoryGroup
known_none: boolean
comments: (string | null)
/**
 * @minItems 0
 * @maxItems 50
 */
terms: {
id: Ulid
term_code: Code
other_text: (string | null)
}[]
}]|[{
id: Ulid
history_group: ConsultationHistoriesHistoryGroup
known_none: boolean
comments: (string | null)
/**
 * @minItems 0
 * @maxItems 50
 */
terms: {
id: Ulid
term_code: Code
other_text: (string | null)
}[]
}, {
id: Ulid
history_group: ConsultationHistoriesHistoryGroup
known_none: boolean
comments: (string | null)
/**
 * @minItems 0
 * @maxItems 50
 */
terms: {
id: Ulid
term_code: Code
other_text: (string | null)
}[]
}]|[{
id: Ulid
history_group: ConsultationHistoriesHistoryGroup
known_none: boolean
comments: (string | null)
/**
 * @minItems 0
 * @maxItems 50
 */
terms: {
id: Ulid
term_code: Code
other_text: (string | null)
}[]
}, {
id: Ulid
history_group: ConsultationHistoriesHistoryGroup
known_none: boolean
comments: (string | null)
/**
 * @minItems 0
 * @maxItems 50
 */
terms: {
id: Ulid
term_code: Code
other_text: (string | null)
}[]
}, {
id: Ulid
history_group: ConsultationHistoriesHistoryGroup
known_none: boolean
comments: (string | null)
/**
 * @minItems 0
 * @maxItems 50
 */
terms: {
id: Ulid
term_code: Code
other_text: (string | null)
}[]
}]
}
export interface VisualAcuity {
/**
 * @minItems 0
 * @maxItems 48
 */
acuities: {
id: Ulid
context: VisualAcuitiesContext
distance: VisualAcuitiesDistance
correction: VisualAcuitiesCorrection
eye: VisualAcuitiesEye
scale_id: Ulid
raw_value: string
normalized_value: (string | null)
}[]
}
export interface Refraction {
/**
 * @minItems 0
 * @maxItems 6
 */
measurements: []|[{
id: Ulid
stage: RefractionMeasurementsStage
eye: RefractionMeasurementsEye
sphere: NullableDiopter
cylinder: NullableDiopter
axis: (number | null)
addition: NullableDiopter
}]|[{
id: Ulid
stage: RefractionMeasurementsStage
eye: RefractionMeasurementsEye
sphere: NullableDiopter
cylinder: NullableDiopter
axis: (number | null)
addition: NullableDiopter
}, {
id: Ulid
stage: RefractionMeasurementsStage
eye: RefractionMeasurementsEye
sphere: NullableDiopter
cylinder: NullableDiopter
axis: (number | null)
addition: NullableDiopter
}]|[{
id: Ulid
stage: RefractionMeasurementsStage
eye: RefractionMeasurementsEye
sphere: NullableDiopter
cylinder: NullableDiopter
axis: (number | null)
addition: NullableDiopter
}, {
id: Ulid
stage: RefractionMeasurementsStage
eye: RefractionMeasurementsEye
sphere: NullableDiopter
cylinder: NullableDiopter
axis: (number | null)
addition: NullableDiopter
}, {
id: Ulid
stage: RefractionMeasurementsStage
eye: RefractionMeasurementsEye
sphere: NullableDiopter
cylinder: NullableDiopter
axis: (number | null)
addition: NullableDiopter
}]|[{
id: Ulid
stage: RefractionMeasurementsStage
eye: RefractionMeasurementsEye
sphere: NullableDiopter
cylinder: NullableDiopter
axis: (number | null)
addition: NullableDiopter
}, {
id: Ulid
stage: RefractionMeasurementsStage
eye: RefractionMeasurementsEye
sphere: NullableDiopter
cylinder: NullableDiopter
axis: (number | null)
addition: NullableDiopter
}, {
id: Ulid
stage: RefractionMeasurementsStage
eye: RefractionMeasurementsEye
sphere: NullableDiopter
cylinder: NullableDiopter
axis: (number | null)
addition: NullableDiopter
}, {
id: Ulid
stage: RefractionMeasurementsStage
eye: RefractionMeasurementsEye
sphere: NullableDiopter
cylinder: NullableDiopter
axis: (number | null)
addition: NullableDiopter
}]|[{
id: Ulid
stage: RefractionMeasurementsStage
eye: RefractionMeasurementsEye
sphere: NullableDiopter
cylinder: NullableDiopter
axis: (number | null)
addition: NullableDiopter
}, {
id: Ulid
stage: RefractionMeasurementsStage
eye: RefractionMeasurementsEye
sphere: NullableDiopter
cylinder: NullableDiopter
axis: (number | null)
addition: NullableDiopter
}, {
id: Ulid
stage: RefractionMeasurementsStage
eye: RefractionMeasurementsEye
sphere: NullableDiopter
cylinder: NullableDiopter
axis: (number | null)
addition: NullableDiopter
}, {
id: Ulid
stage: RefractionMeasurementsStage
eye: RefractionMeasurementsEye
sphere: NullableDiopter
cylinder: NullableDiopter
axis: (number | null)
addition: NullableDiopter
}, {
id: Ulid
stage: RefractionMeasurementsStage
eye: RefractionMeasurementsEye
sphere: NullableDiopter
cylinder: NullableDiopter
axis: (number | null)
addition: NullableDiopter
}]|[{
id: Ulid
stage: RefractionMeasurementsStage
eye: RefractionMeasurementsEye
sphere: NullableDiopter
cylinder: NullableDiopter
axis: (number | null)
addition: NullableDiopter
}, {
id: Ulid
stage: RefractionMeasurementsStage
eye: RefractionMeasurementsEye
sphere: NullableDiopter
cylinder: NullableDiopter
axis: (number | null)
addition: NullableDiopter
}, {
id: Ulid
stage: RefractionMeasurementsStage
eye: RefractionMeasurementsEye
sphere: NullableDiopter
cylinder: NullableDiopter
axis: (number | null)
addition: NullableDiopter
}, {
id: Ulid
stage: RefractionMeasurementsStage
eye: RefractionMeasurementsEye
sphere: NullableDiopter
cylinder: NullableDiopter
axis: (number | null)
addition: NullableDiopter
}, {
id: Ulid
stage: RefractionMeasurementsStage
eye: RefractionMeasurementsEye
sphere: NullableDiopter
cylinder: NullableDiopter
axis: (number | null)
addition: NullableDiopter
}, {
id: Ulid
stage: RefractionMeasurementsStage
eye: RefractionMeasurementsEye
sphere: NullableDiopter
cylinder: NullableDiopter
axis: (number | null)
addition: NullableDiopter
}]
refraction_observations: (string | null)
/**
 * @minItems 0
 * @maxItems 20
 */
ametropias: []|[{
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]
}
export interface Centering {
centering_id: NullableUlid
pd_total: NullableDiopter
pd_od: NullableDiopter
pd_og: NullableDiopter
inconsistency_reason: (string | null)
}
export interface Medications {
/**
 * @minItems 0
 * @maxItems 20
 */
orders: []|[{
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}]|[{
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}]|[{
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}]|[{
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}]|[{
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}]|[{
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}]|[{
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}]|[{
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}]|[{
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}]|[{
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}]|[{
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}]|[{
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}]|[{
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}]|[{
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}]|[{
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}]|[{
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}]|[{
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}]|[{
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}]|[{
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}]|[{
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}, {
id: Ulid
catalog_item_id: NullableUlid
name: string
form: MedicationOrdersForm
form_other: (string | null)
strength: (string | null)
dosage: (string | null)
frequency: (string | null)
duration_text: (string | null)
duration_value: (number | null)
duration_unit: (MedicationOrdersDurationUnit | null)
instructions: (string | null)
}]
}
export interface Conclusion {
conclusion: (string | null)
referral: (boolean | null)
referral_urgency: (ConsultationsReferralUrgency | null)
/**
 * @minItems 0
 * @maxItems 20
 */
referral_reasons: []|[{
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]
}
export interface AllSteps {
ANAMNESIS: Anamnesis
HISTORIES: Histories
VISUAL_ACUITY: VisualAcuity
REFRACTION: Refraction
CENTERING: Centering
MEDICATIONS: Medications
CONCLUSION: Conclusion
}
export interface Pagination {
current_page: number
last_page: number
per_page: (25 | 50)
total: number
}
export interface CompatibilityDeclaration {
/**
 * Version de l'application (identique à info.version du contrat OpenAPI).
 */
release: string
sync_protocol_version: number
catalog_sha256: Sha256Hex
/**
 * Versions de règles métier dont les commandes locales sont acceptées (format du cœur signé).
 * 
 * @minItems 1
 */
rules_versions: [string, ...(string)[]]
/**
 * Pour chaque commande, versions de schéma de charge reprises (schema_version du cœur).
 */
commands: {
/**
 * @minItems 1
 */
[k: string]: [string, ...(string)[]] | undefined
}
/**
 * Pour chaque événement interne, versions produites et consommées.
 */
events: {
/**
 * @minItems 1
 */
[k: string]: [number, ...(number)[]] | undefined
}
/**
 * Versions du format du coffre local reprises (définies par O01, migrations par O06).
 */
vault_formats: number[]
/**
 * Versions du schéma IndexedDB du poste (base eeo-device) que cette release sait ouvrir et migrer EN AVANT, par ajouts seulement (O06) ; une base plus récente est refusée en écriture, jamais purgée.
 * 
 * @minItems 1
 */
local_schema_versions: [number, ...(number)[]]
/**
 * Modèles de documents disponibles pour régénérer une pièce en attente (définis par D01/D02).
 */
document_templates: {
document_type: GeneratedDocumentsDocumentType
template_version: string
}[]
notes: string
}
export interface ErrorEnvelope {
error: {
code: ErrorCode
message: string
fields?: {
/**
 * @minItems 1
 */
[k: string]: [string, ...(string)[]] | undefined
}
/**
 * Valeurs actualisées d'un refus d'état, à proposer au client (fichier 08 : « solde actualisé » de PAYMENT_EXCEEDS_BALANCE, « quantité disponible actualisée » de STOCK_UNAVAILABLE ; current_version de VERSION_CONFLICT ; current_status de STATE_TRANSITION_REFUSED). Valeurs simples seulement, jamais une donnée personnelle ni clinique.
 */
details?: {
[k: string]: string | number | null | undefined
}
}
correlation_id: string
}
export interface LoginRequest {
login: string
password: string
}
export interface ReauthenticateRequest {
password: string
}
export interface ChangePasswordRequest {
current_password: string
password: string
password_confirmation: string
}
export interface CreateStaffRequest {
login: string
display_name: string
email?: (string | null)
password: string
/**
 * @minItems 1
 * @maxItems 4
 */
roles: [("CASHIER" | "CLINICIAN" | "MANAGER" | "RECEPTION")]|[("CASHIER" | "CLINICIAN" | "MANAGER" | "RECEPTION"), ("CASHIER" | "CLINICIAN" | "MANAGER" | "RECEPTION")]|[("CASHIER" | "CLINICIAN" | "MANAGER" | "RECEPTION"), ("CASHIER" | "CLINICIAN" | "MANAGER" | "RECEPTION"), ("CASHIER" | "CLINICIAN" | "MANAGER" | "RECEPTION")]|[("CASHIER" | "CLINICIAN" | "MANAGER" | "RECEPTION"), ("CASHIER" | "CLINICIAN" | "MANAGER" | "RECEPTION"), ("CASHIER" | "CLINICIAN" | "MANAGER" | "RECEPTION"), ("CASHIER" | "CLINICIAN" | "MANAGER" | "RECEPTION")]
}
export interface UpdateStaffRequest {
expected_version: Version
display_name?: string
email?: (string | null)
active?: boolean
/**
 * @minItems 1
 * @maxItems 4
 */
roles?: [("CASHIER" | "CLINICIAN" | "MANAGER" | "RECEPTION")]|[("CASHIER" | "CLINICIAN" | "MANAGER" | "RECEPTION"), ("CASHIER" | "CLINICIAN" | "MANAGER" | "RECEPTION")]|[("CASHIER" | "CLINICIAN" | "MANAGER" | "RECEPTION"), ("CASHIER" | "CLINICIAN" | "MANAGER" | "RECEPTION"), ("CASHIER" | "CLINICIAN" | "MANAGER" | "RECEPTION")]|[("CASHIER" | "CLINICIAN" | "MANAGER" | "RECEPTION"), ("CASHIER" | "CLINICIAN" | "MANAGER" | "RECEPTION"), ("CASHIER" | "CLINICIAN" | "MANAGER" | "RECEPTION"), ("CASHIER" | "CLINICIAN" | "MANAGER" | "RECEPTION")]
reason?: (string | null)
}
export interface PermissionOverrideRequest {
expected_version: Version
permission_code: PermissionCode
effect: ("ALLOW" | "DENY" | "CLEAR")
reason: string
expires_at?: NullableInstant
}
export interface ResetPasswordRequest {
expected_version: Version
password: string
password_confirmation: string
reason: string
}
/**
 * Fuseau, monnaie et production_documents_enabled sont refusés (422).
 */
export interface UpdateClinicSettingsRequest {
name?: string
address?: (string | null)
phone?: (string | null)
email?: (string | null)
tax_identifier?: (string | null)
professional_mentions?: (string | null)
document_settings?: ({

} | null)
}
/**
 * Modification d'une prescription encore DRAFT, en ligne seulement ; jeton de concurrence updated_at. Hors-ligne, une correction est une nouvelle version (CreatePrescription avec supersedes_id).
 */
export interface UpdatePrescriptionDraftRequest {
expected_updated_at: Instant
changes: {

}
}
export interface RescheduleAppointmentRequest {
expected_version: Version
starts_at: Instant
ends_at: Instant
resource_id?: Ulid
}
export interface CancelAppointmentRequest {
expected_version: Version
reason: string
}
/**
 * Absence constatée après l'heure du rendez-vous (statut NO_SHOW), jamais avant.
 */
export interface MarkAppointmentNoShowRequest {
expected_version: Version
}
/**
 * Création (expected_version null) ou modification d'une ressource de l'agenda (gérante).
 */
export interface SchedulingResourceRequest {
expected_version: (Version | null)
resource_id: Ulid
name: string
professional_user_id: NullableUlid
slot_duration_minutes: number
active: boolean
}
/**
 * Remplace les créneaux hebdomadaires d'une ressource (version de la ressource attendue).
 */
export interface OpeningHoursRequest {
expected_version: Version
/**
 * @minItems 0
 * @maxItems 50
 */
hours: {
id: Ulid
weekday: number
opens_at: LocalTime
closes_at: LocalTime
}[]
}
/**
 * Fermeture ou ouverture exceptionnelle datée, motif obligatoire.
 */
export interface ResourceExceptionRequest {
expected_version: null
exception_id: Ulid
starts_at: Instant
ends_at: Instant
is_available: boolean
reason: string
}
/**
 * Création (expected_version null) ou modification d'une prestation réservable (gérante).
 */
export interface AppointmentServiceRequest {
expected_version: (Version | null)
service_id: Ulid
name: string
duration_minutes: number
active: boolean
}
/**
 * Création (expected_version null) ou modification d'un article par la gérante (catalog.manage). Les prix réels sont fournis par le cabinet : seules des données fictives sont utilisées en développement.
 */
export interface CatalogItemRequest {
expected_version: (Version | null)
reference: string
category_code: Code
name: string
brand: (string | null)
model: (string | null)
unit_code: Code
quantity_integer_only: boolean
sale_price: MoneyXaf
purchase_cost: (MoneyXaf | null)
tax_rule_id: NullableUlid
stock_mode: CatalogItemsStockMode
requires_expiry: boolean
low_stock_threshold: (Quantity | null)
expiry_alert_days: (number | null)
active: boolean
public_visibility: boolean
}
/**
 * Import contrôlé du catalogue (X01) : lignes du fichier CSV lues sur le poste (numéro de ligne du fichier), revérifiées par le serveur avec les règles d'un article saisi à l'écran. dry_run = true : aperçu sans aucune écriture ; false : toutes les lignes sont créées dans une seule transaction, ou aucune.
 */
export interface CatalogImportRequest {
expected_version?: null
dry_run: boolean
/**
 * @minItems 1
 * @maxItems 500
 */
rows: [{
line: number
reference: (string | null)
category_code: (Code | null)
name: (string | null)
brand: (string | null)
model: (string | null)
unit_code: (Code | null)
quantity_integer_only: boolean
sale_price: (MoneyXaf | null)
purchase_cost: (MoneyXaf | null)
tax_rule_id: NullableUlid
stock_mode: (CatalogItemsStockMode | null)
requires_expiry: boolean
low_stock_threshold: (Quantity | null)
expiry_alert_days: (number | null)
active: boolean
public_visibility: boolean
}, ...({
line: number
reference: (string | null)
category_code: (Code | null)
name: (string | null)
brand: (string | null)
model: (string | null)
unit_code: (Code | null)
quantity_integer_only: boolean
sale_price: (MoneyXaf | null)
purchase_cost: (MoneyXaf | null)
tax_rule_id: NullableUlid
stock_mode: (CatalogItemsStockMode | null)
requires_expiry: boolean
low_stock_threshold: (Quantity | null)
expiry_alert_days: (number | null)
active: boolean
public_visibility: boolean
})[]]
}
/**
 * Charge INTERNE de la commande StoreDocumentContent, construite par le serveur après contrôle des octets PDF reçus (POST /documents/{id}/content, corps application/pdf) : jamais envoyée par un poste.
 */
export interface StoreDocumentContentCommand {
expected_version?: null
document_id: Ulid
sha256: Sha256Hex
size_bytes: number
private_path: string
}
/**
 * Reprise des créances papier (X01) : une créance (saisie) ou un fichier CSV lu sur le poste. Le patient est désigné par sa fiche (patient_id) OU son numéro de dossier ; dry_run = true : aperçu sans écriture ; false : toutes les créances reprises dans une transaction, ou aucune (justificatif scanné evidence_file_id obligatoire).
 */
export interface LegacyBalanceImportRequest {
expected_version?: null
dry_run: boolean
evidence_file_id: NullableUlid
/**
 * @minItems 1
 * @maxItems 500
 */
rows: [{
line: number
patient_id: NullableUlid
patient_record_number: (string | null)
paper_reference: (string | null)
original_total: (MoneyXaf | null)
already_paid: (MoneyXaf | null)
original_invoice_on: NullableCivilDate
}, ...({
line: number
patient_id: NullableUlid
patient_record_number: (string | null)
paper_reference: (string | null)
original_total: (MoneyXaf | null)
already_paid: (MoneyXaf | null)
original_invoice_on: NullableCivilDate
})[]]
}
/**
 * Charge INTERNE de la commande StoreLegacyEvidence, construite par le serveur après contrôle des octets reçus (POST /legacy-balances/evidence) : jamais envoyée par un poste.
 */
export interface StoreLegacyEvidenceCommand {
expected_version?: null
sha256: Sha256Hex
size_bytes: number
mime_type: ("application/pdf" | "image/jpeg" | "image/png")
private_path: string
}
/**
 * Règle fiscale saisie par la gérante ; validate = true enregistre la validation (réauthentification). Aucune taxe n'est préconfigurée.
 */
export interface TaxRuleRequest {
expected_version: (Version | null)
code: string
label: string
rate_percent: (Rate | null)
active: boolean
validate: boolean
legal_note: (string | null)
}
/**
 * Brouillon de devis (L1D07) : un patient (patient_id) OU un prospect saisi (nom, téléphone), jamais les deux ; validité facultative (au plus tôt aujourd'hui) ; lignes soumises aux droits de l'auteur.
 */
export interface CreateQuoteDraftRequest {
expected_version: null
quote_id: Ulid
patient_id: NullableUlid
prospect: ({
name: string
phone: (string | null)
} | null)
valid_until: NullableCivilDate
/**
 * @minItems 0
 * @maxItems 200
 * 
 * Items: Ligne de devis : prix TTC unitaire, remise TTC ; total de ligne recalculé (ROUND(quantité × prix) − remise). Aucune prescription.
 */
lines: {
line_id: Ulid
position: number
catalog_item_id: NullableUlid
description: string
quantity: Quantity
unit_price_gross: MoneyXaf
discount_gross: MoneyXaf
}[]
}
/**
 * Modification d'un brouillon de devis (remplacement complet des lignes) : créateur ou gérante.
 */
export interface UpdateQuoteDraftRequest {
expected_version: Version
quote_id: Ulid
valid_until: NullableCivilDate
/**
 * @minItems 0
 * @maxItems 200
 * 
 * Items: Ligne de devis : prix TTC unitaire, remise TTC ; total de ligne recalculé (ROUND(quantité × prix) − remise). Aucune prescription.
 */
lines: {
line_id: Ulid
position: number
catalog_item_id: NullableUlid
description: string
quantity: Quantity
unit_price_gross: MoneyXaf
discount_gross: MoneyXaf
}[]
}
/**
 * Émission : numéro de la série QUOTE, révision 1 figée ; total_gross est vérifié par le serveur (422 avec details.expected_total sinon) ; validité obligatoire.
 */
export interface IssueQuoteRequest {
expected_version: Version
quote_id: Ulid
total_gross: MoneyXaf
}
/**
 * Révision d'un devis émis, accepté ou refusé : nouvelle révision figée avec motif ; les précédentes restent intactes.
 */
export interface ReviseQuoteRequest {
expected_version: Version
quote_id: Ulid
reason: string
valid_until: CivilDate
/**
 * @minItems 1
 * @maxItems 200
 * 
 * Items: Ligne de devis : prix TTC unitaire, remise TTC ; total de ligne recalculé (ROUND(quantité × prix) − remise). Aucune prescription.
 */
lines: [{
line_id: Ulid
position: number
catalog_item_id: NullableUlid
description: string
quantity: Quantity
unit_price_gross: MoneyXaf
discount_gross: MoneyXaf
}, ...({
line_id: Ulid
position: number
catalog_item_id: NullableUlid
description: string
quantity: Quantity
unit_price_gross: MoneyXaf
discount_gross: MoneyXaf
})[]]
total_gross: MoneyXaf
}
/**
 * Réponse du client : ACCEPTED (devis émis encore valable) ou DECLINED ; aucune facture ni paiement.
 */
export interface QuoteDecisionRequest {
expected_version: Version
quote_id: Ulid
decision: ("ACCEPTED" | "DECLINED")
reason: (string | null)
}
/**
 * Conversion d'une révision choisie en BROUILLON de facture (invoices.quote_id) : prix confirmés explicitement (QUOTE : prix et remises de la révision ; CATALOG : prix actuel du catalogue, sans remise) ; patient_id obligatoire pour un prospect. Ni émission, ni paiement, ni réserve.
 */
export interface ConvertQuoteRequest {
expected_version: Version
quote_id: Ulid
revision_no: number
invoice_id: Ulid
patient_id: NullableUlid
price_basis: ("QUOTE" | "CATALOG")
prices_confirmed: true
}
/**
 * Abandon d'un brouillon de facture (fichier 03) : version de brouillon attendue, motif facultatif (conservé dans l'audit). Aucun numéro, aucune réserve, aucun document à annuler.
 */
export interface AbandonInvoiceDraftRequest {
expected_version: Version
invoice_id: Ulid
reason: (string | null)
}
/**
 * Fusion manuelle de deux fiches d'un même patient (L1D08), par la gérante après revue : version attendue de la fiche ABSORBÉE, motif obligatoire (5 à 1000 caractères).
 */
export interface MergePatientsRequest {
expected_version: Version
source_patient_id: Ulid
survivor_patient_id: Ulid
reason: string
}
/**
 * Mouvement d'espèces hors vente d'une session OUVERTE (L1D05) : entrée positive, sortie négative ; catégorie obligatoire pour une dépense et seulement pour elle ; approval_id = approbation exacte CASH_MOVEMENT accordée, ou identifiant neuf pour l'exécution directe de la gérante.
 */
export interface RecordCashMovementRequest {
expected_version: null
movement_id: Ulid
cash_session_id: Ulid
movement_kind: CashMovementsKind
signed_amount: number
expense_category_id: NullableUlid
reason: string
reference: (string | null)
approval_id: Ulid
}
/**
 * Création (identifiant neuf, code obligatoire) ou modification (nom, activation ; le code ne change pas) d'une catégorie de dépenses par la gérante.
 */
export interface ExpenseCategoryRequest {
expected_version: null
category_id: Ulid
code: (string | null)
name: string
active: boolean
}
/**
 * Revue par la gérante de l'écart d'une session clôturée : acceptée ou contestée (note obligatoire), une seule fois.
 */
export interface CashVarianceReviewRequest {
expected_version: null
cash_session_id: Ulid
decision: ("ACCEPTED" | "DISPUTED")
note: (string | null)
}
/**
 * Suppression d'un brouillon de prescription : jeton de concurrence expected_updated_at lu avec la prescription (elle n'a pas de colonne version, expected_version vaut null). Refusée (409) si la prescription est validée ou déjà utilisée par une facture, une commande d'atelier ou un document.
 */
export interface DeletePrescriptionDraftRequest {
expected_version: null
prescription_id: Ulid
expected_updated_at: Instant
}
/**
 * Suppression d'un brouillon de devis jamais émis : version du brouillon attendue. Refusée (409) pour un devis émis, accepté, refusé, expiré ou converti ; son créateur ou la gérante seulement.
 */
export interface DeleteQuoteDraftRequest {
expected_version: Version
quote_id: Ulid
}
/**
 * Annulation d'un contrôle recommandé encore actif : version du contrôle attendue, motif obligatoire (3 à 1 000 caractères, conservé dans l'audit). Refusée (409) si un rendez-vous le programme, s'il est déjà annulé ou clos.
 */
export interface CancelFollowUpRequest {
expected_version: Version
follow_up_plan_id: Ulid
reason: string
}
/**
 * Suppression d'un examen resté brouillon (aucune rubrique enregistrée) : version de la consultation attendue. Refusée (409) si l'examen est en cours ou terminé, ou si une prescription validée, un contrôle recommandé ou une rubrique clinique y est rattaché.
 */
export interface DeleteConsultationDraftRequest {
expected_version: Version
consultation_id: Ulid
}
/**
 * Annulation d'une visite avant l'examen (P03) : version de la visite attendue, motif obligatoire (information d'accueil seulement, conservé dans l'audit). Refusée si l'examen a démarré ou si une facture non abandonnée est liée à la visite.
 */
export interface CancelVisitRequest {
expected_version: Version
visit_id: Ulid
reason: string
}
/**
 * Stock initial validé (I00) : un mouvement OPENING par ligne, lots créés au besoin ; gérante.
 */
export interface OpeningStockRequest {
counted_at: Instant
reason: string
approval_id: NullableUlid
/**
 * @minItems 1
 * @maxItems 500
 */
lines: [{
movement_id: Ulid
item_id: Ulid
location_id: Ulid
lot: ({
lot_id: Ulid
batch_number: string
expires_on: NullableCivilDate
} | null)
quantity: Quantity
unit_cost: (MoneyXaf | null)
}, ...({
movement_id: Ulid
item_id: Ulid
location_id: Ulid
lot: ({
lot_id: Ulid
batch_number: string
expires_on: NullableCivilDate
} | null)
quantity: Quantity
unit_cost: (MoneyXaf | null)
})[]]
}
/**
 * Enrôlement (O02) : clé publique ES256 du poste et preuve de possession (JWS compact ES256 signé par la clé PRIVÉE du poste, typ eeo-device-proof+jws, kid = empreinte RFC 7638, charge JCS {clinic_id, device_code, issued_at, jwk_thumbprint, purpose=enroll, v=1}, fraîche de 10 minutes).
 */
export interface EnrollDeviceRequest {
expected_version: null
device_code: string
name: string
public_key_jwk: PublicJwk
responsible_user_id: Ulid
app_version: string
proof: CompactJws
}
/**
 * Clé publique ES256 du poste (JWK, jamais de composante privée « d »).
 */
export interface PublicJwk {
kty: "EC"
crv: "P-256"
x: string
y: string
}
/**
 * Grant signé d'un profil sur ce poste (O02) : permissions effectives figées, catalogue et règles ; durée par défaut eeo.offline.grant_hours (72 h).
 */
export interface IssueOfflineGrantRequest {
expected_version: null
user_id: Ulid
valid_hours?: (number | null)
}
/**
 * Révocation d'un poste (retiré ou perdu) et de tous ses grants actifs ; connue du poste à sa prochaine connexion.
 */
export interface RevokeDeviceRequest {
expected_version: null
status: ("REVOKED" | "LOST")
reason: string
}
export interface RevokeOfflineGrantRequest {
expected_version: null
reason: string
}
/**
 * Préparation en ligne (gérante, O03) : profils préparés (grant actif exigé), plages demandées (année en cours par défaut, ou la suivante avant le franchissement), quotas et factures émises à attribuer à ce poste.
 */
export interface PrepareDeviceRequest {
expected_version: null
/**
 * @minItems 1
 * @maxItems 10
 */
profiles: [Ulid]|[Ulid, Ulid]|[Ulid, Ulid, Ulid]|[Ulid, Ulid, Ulid, Ulid]|[Ulid, Ulid, Ulid, Ulid, Ulid]|[Ulid, Ulid, Ulid, Ulid, Ulid, Ulid]|[Ulid, Ulid, Ulid, Ulid, Ulid, Ulid, Ulid]|[Ulid, Ulid, Ulid, Ulid, Ulid, Ulid, Ulid, Ulid]|[Ulid, Ulid, Ulid, Ulid, Ulid, Ulid, Ulid, Ulid, Ulid]|[Ulid, Ulid, Ulid, Ulid, Ulid, Ulid, Ulid, Ulid, Ulid, Ulid]
/**
 * @minItems 0
 * @maxItems 10
 */
number_ranges?: []|[{
document_type: DocumentNumberAllocationsDocumentType
quantity: number
document_year?: (number | null)
}]|[{
document_type: DocumentNumberAllocationsDocumentType
quantity: number
document_year?: (number | null)
}, {
document_type: DocumentNumberAllocationsDocumentType
quantity: number
document_year?: (number | null)
}]|[{
document_type: DocumentNumberAllocationsDocumentType
quantity: number
document_year?: (number | null)
}, {
document_type: DocumentNumberAllocationsDocumentType
quantity: number
document_year?: (number | null)
}, {
document_type: DocumentNumberAllocationsDocumentType
quantity: number
document_year?: (number | null)
}]|[{
document_type: DocumentNumberAllocationsDocumentType
quantity: number
document_year?: (number | null)
}, {
document_type: DocumentNumberAllocationsDocumentType
quantity: number
document_year?: (number | null)
}, {
document_type: DocumentNumberAllocationsDocumentType
quantity: number
document_year?: (number | null)
}, {
document_type: DocumentNumberAllocationsDocumentType
quantity: number
document_year?: (number | null)
}]|[{
document_type: DocumentNumberAllocationsDocumentType
quantity: number
document_year?: (number | null)
}, {
document_type: DocumentNumberAllocationsDocumentType
quantity: number
document_year?: (number | null)
}, {
document_type: DocumentNumberAllocationsDocumentType
quantity: number
document_year?: (number | null)
}, {
document_type: DocumentNumberAllocationsDocumentType
quantity: number
document_year?: (number | null)
}, {
document_type: DocumentNumberAllocationsDocumentType
quantity: number
document_year?: (number | null)
}]|[{
document_type: DocumentNumberAllocationsDocumentType
quantity: number
document_year?: (number | null)
}, {
document_type: DocumentNumberAllocationsDocumentType
quantity: number
document_year?: (number | null)
}, {
document_type: DocumentNumberAllocationsDocumentType
quantity: number
document_year?: (number | null)
}, {
document_type: DocumentNumberAllocationsDocumentType
quantity: number
document_year?: (number | null)
}, {
document_type: DocumentNumberAllocationsDocumentType
quantity: number
document_year?: (number | null)
}, {
document_type: DocumentNumberAllocationsDocumentType
quantity: number
document_year?: (number | null)
}]|[{
document_type: DocumentNumberAllocationsDocumentType
quantity: number
document_year?: (number | null)
}, {
document_type: DocumentNumberAllocationsDocumentType
quantity: number
document_year?: (number | null)
}, {
document_type: DocumentNumberAllocationsDocumentType
quantity: number
document_year?: (number | null)
}, {
document_type: DocumentNumberAllocationsDocumentType
quantity: number
document_year?: (number | null)
}, {
document_type: DocumentNumberAllocationsDocumentType
quantity: number
document_year?: (number | null)
}, {
document_type: DocumentNumberAllocationsDocumentType
quantity: number
document_year?: (number | null)
}, {
document_type: DocumentNumberAllocationsDocumentType
quantity: number
document_year?: (number | null)
}]|[{
document_type: DocumentNumberAllocationsDocumentType
quantity: number
document_year?: (number | null)
}, {
document_type: DocumentNumberAllocationsDocumentType
quantity: number
document_year?: (number | null)
}, {
document_type: DocumentNumberAllocationsDocumentType
quantity: number
document_year?: (number | null)
}, {
document_type: DocumentNumberAllocationsDocumentType
quantity: number
document_year?: (number | null)
}, {
document_type: DocumentNumberAllocationsDocumentType
quantity: number
document_year?: (number | null)
}, {
document_type: DocumentNumberAllocationsDocumentType
quantity: number
document_year?: (number | null)
}, {
document_type: DocumentNumberAllocationsDocumentType
quantity: number
document_year?: (number | null)
}, {
document_type: DocumentNumberAllocationsDocumentType
quantity: number
document_year?: (number | null)
}]|[{
document_type: DocumentNumberAllocationsDocumentType
quantity: number
document_year?: (number | null)
}, {
document_type: DocumentNumberAllocationsDocumentType
quantity: number
document_year?: (number | null)
}, {
document_type: DocumentNumberAllocationsDocumentType
quantity: number
document_year?: (number | null)
}, {
document_type: DocumentNumberAllocationsDocumentType
quantity: number
document_year?: (number | null)
}, {
document_type: DocumentNumberAllocationsDocumentType
quantity: number
document_year?: (number | null)
}, {
document_type: DocumentNumberAllocationsDocumentType
quantity: number
document_year?: (number | null)
}, {
document_type: DocumentNumberAllocationsDocumentType
quantity: number
document_year?: (number | null)
}, {
document_type: DocumentNumberAllocationsDocumentType
quantity: number
document_year?: (number | null)
}, {
document_type: DocumentNumberAllocationsDocumentType
quantity: number
document_year?: (number | null)
}]|[{
document_type: DocumentNumberAllocationsDocumentType
quantity: number
document_year?: (number | null)
}, {
document_type: DocumentNumberAllocationsDocumentType
quantity: number
document_year?: (number | null)
}, {
document_type: DocumentNumberAllocationsDocumentType
quantity: number
document_year?: (number | null)
}, {
document_type: DocumentNumberAllocationsDocumentType
quantity: number
document_year?: (number | null)
}, {
document_type: DocumentNumberAllocationsDocumentType
quantity: number
document_year?: (number | null)
}, {
document_type: DocumentNumberAllocationsDocumentType
quantity: number
document_year?: (number | null)
}, {
document_type: DocumentNumberAllocationsDocumentType
quantity: number
document_year?: (number | null)
}, {
document_type: DocumentNumberAllocationsDocumentType
quantity: number
document_year?: (number | null)
}, {
document_type: DocumentNumberAllocationsDocumentType
quantity: number
document_year?: (number | null)
}, {
document_type: DocumentNumberAllocationsDocumentType
quantity: number
document_year?: (number | null)
}]
/**
 * @minItems 0
 * @maxItems 200
 */
stock_quotas?: {
stock_position_id: Ulid
stock_lot_id: NullableUlid
quantity: Quantity
}[]
/**
 * @minItems 0
 * @maxItems 500
 */
invoice_ids?: Ulid[]
known_catalog_version?: (string | null)
}
/**
 * Clôture après reprise complète (O03) : séquence et empreinte égales au préfixe finalisé du serveur, sinon 409.
 */
export interface ReleaseDeviceRequest {
expected_version: null
last_device_sequence: Counter
last_event_hash: NullableSha256Hex
reason: string
}
/**
 * Remplacement d'un poste par un poste NEUF déjà enrôlé et actif (O07) ; aucun droit de l'ancien poste n'est cloné.
 */
export interface ReplaceDeviceRequest {
expected_version: null
replacement_device_id: Ulid
reason: string
}
/**
 * Réconciliation d'un poste remplacé (O07) : séquence et empreinte du manifeste de l'export, égales au préfixe finalisé du serveur, sinon 409 SYNC_INCOMPLETE.
 */
export interface ReconcileReplacementRequest {
expected_version: null
last_device_sequence: Counter
last_event_hash: NullableSha256Hex
reason: string
}
/**
 * Résolution autorisée et motivée ; ne réécrit jamais core/hash/signature ; une correction a sa propre command_id (contrat 23).
 */
export interface ConflictResolutionRequest {
expected_version: null
decision: ("ACCEPT_LOCAL" | "KEEP_CENTRAL" | "REJECT" | "CORRECT")
reason: string
correction_command_id: NullableUlid
}
export interface CreateExportRequest {
expected_version?: null
export_type: ExportRequestsExportType
patient_id?: NullableUlid
filters?: ({

} | null)
}
/**
 * Réservation publique (L2) : consentement explicite exigé, anti-abus et idempotence.
 */
export interface BookingRequest {
service_id: Ulid
starts_at: Instant
name: string
phone: Phone
email?: (string | null)
consent: true
}
/**
 * Compte dans une liste : sans les permissions effectives.
 */
export interface StaffMemberSummary {
id: Ulid
login: string
display_name: string
email: (string | null)
active: boolean
version: Version
/**
 * @minItems 0
 * @maxItems 4
 */
roles: []|[("CASHIER" | "CLINICIAN" | "MANAGER" | "RECEPTION")]|[("CASHIER" | "CLINICIAN" | "MANAGER" | "RECEPTION"), ("CASHIER" | "CLINICIAN" | "MANAGER" | "RECEPTION")]|[("CASHIER" | "CLINICIAN" | "MANAGER" | "RECEPTION"), ("CASHIER" | "CLINICIAN" | "MANAGER" | "RECEPTION"), ("CASHIER" | "CLINICIAN" | "MANAGER" | "RECEPTION")]|[("CASHIER" | "CLINICIAN" | "MANAGER" | "RECEPTION"), ("CASHIER" | "CLINICIAN" | "MANAGER" | "RECEPTION"), ("CASHIER" | "CLINICIAN" | "MANAGER" | "RECEPTION"), ("CASHIER" | "CLINICIAN" | "MANAGER" | "RECEPTION")]
}
/**
 * Compte du personnel : profils actifs et permissions effectives (jamais de hash ni de secret MFA).
 */
export interface StaffMember {
id: Ulid
login: string
display_name: string
email: (string | null)
active: boolean
version: Version
/**
 * @minItems 0
 * @maxItems 4
 */
roles: []|[("CASHIER" | "CLINICIAN" | "MANAGER" | "RECEPTION")]|[("CASHIER" | "CLINICIAN" | "MANAGER" | "RECEPTION"), ("CASHIER" | "CLINICIAN" | "MANAGER" | "RECEPTION")]|[("CASHIER" | "CLINICIAN" | "MANAGER" | "RECEPTION"), ("CASHIER" | "CLINICIAN" | "MANAGER" | "RECEPTION"), ("CASHIER" | "CLINICIAN" | "MANAGER" | "RECEPTION")]|[("CASHIER" | "CLINICIAN" | "MANAGER" | "RECEPTION"), ("CASHIER" | "CLINICIAN" | "MANAGER" | "RECEPTION"), ("CASHIER" | "CLINICIAN" | "MANAGER" | "RECEPTION"), ("CASHIER" | "CLINICIAN" | "MANAGER" | "RECEPTION")]
/**
 * @minItems 0
 */
permissions: PermissionCode[]
}
/**
 * enabled_modules : modules ouverts par l'exploitant (EEO_ENABLED_MODULES), codes de la navigation ; vide = aucun module métier exposé. exam_fee_control : OFF (défaut, le paiement de l'examen n'est contrôlé nulle part) ou BILLED (EEO_EXAM_FEE_CONTROL=billed : facture de frais réglée ou dispense de la gérante exigée au démarrage de l'examen) ; absent pour un serveur plus ancien, lu comme OFF.
 */
export interface ClinicSummary {
id: Ulid
name: string
timezone: string
currency: Currency
production_documents_enabled: boolean
/**
 * @minItems 0
 */
enabled_modules: string[]
exam_fee_control?: ("OFF" | "BILLED")
}
/**
 * Compte connecté : profils, permissions effectives, cabinet (nom, fuseau, monnaie).
 */
export interface Me {
id: Ulid
login: string
display_name: string
email: (string | null)
active: boolean
version: Version
/**
 * @minItems 0
 * @maxItems 4
 */
roles: []|[("CASHIER" | "CLINICIAN" | "MANAGER" | "RECEPTION")]|[("CASHIER" | "CLINICIAN" | "MANAGER" | "RECEPTION"), ("CASHIER" | "CLINICIAN" | "MANAGER" | "RECEPTION")]|[("CASHIER" | "CLINICIAN" | "MANAGER" | "RECEPTION"), ("CASHIER" | "CLINICIAN" | "MANAGER" | "RECEPTION"), ("CASHIER" | "CLINICIAN" | "MANAGER" | "RECEPTION")]|[("CASHIER" | "CLINICIAN" | "MANAGER" | "RECEPTION"), ("CASHIER" | "CLINICIAN" | "MANAGER" | "RECEPTION"), ("CASHIER" | "CLINICIAN" | "MANAGER" | "RECEPTION"), ("CASHIER" | "CLINICIAN" | "MANAGER" | "RECEPTION")]
/**
 * @minItems 0
 */
permissions: PermissionCode[]
clinic: ClinicSummary
}
/**
 * Paramètres administratifs du cabinet (gérante).
 */
export interface ClinicSettings {
id: Ulid
name: string
timezone: string
currency: Currency
address: (string | null)
phone: (string | null)
email: (string | null)
tax_identifier: (string | null)
professional_mentions: (string | null)
document_settings: ({

} | null)
production_documents_enabled: boolean
}
/**
 * Identité du cabinet imprimée sur les documents (en-tête, pied) : lisible par tout profil qui produit un document. production_documents_enabled faux : documents de TEST marqués comme tels.
 */
export interface ClinicDocumentIdentity {
name: string
timezone: string
currency: Currency
address: (string | null)
phone: (string | null)
email: (string | null)
tax_identifier: (string | null)
professional_mentions: (string | null)
document_settings: ({

} | null)
production_documents_enabled: boolean
}
export interface ClinicDocumentIdentityResponse {
data: ClinicDocumentIdentity
}
export interface Reauthentication {
reauthenticated_until: Instant
}
export interface StaffMemberResponse {
data: StaffMember
}
export interface StaffMemberPage {
/**
 * @minItems 0
 */
data: StaffMemberSummary[]
meta: Pagination
}
export interface MeResponse {
data: Me
}
export interface ClinicSettingsResponse {
data: ClinicSettings
}
export interface ReauthenticationResponse {
data: Reauthentication
}
/**
 * Article : prix de vente pour les profils autorisés ; purchase_cost présent seulement pour la gérante (fichier 08). Mêmes champs que la requête CatalogItemRequest, pour pré-remplir la modification.
 */
export interface CatalogItem {
id: Ulid
reference: string
category_code: Code
name: string
brand: (string | null)
model: (string | null)
unit_code: Code
quantity_integer_only: boolean
sale_price: MoneyXaf
purchase_cost?: (MoneyXaf | null)
tax_rule_id: NullableUlid
stock_mode: CatalogItemsStockMode
requires_expiry: boolean
low_stock_threshold: (Quantity | null)
expiry_alert_days: (number | null)
active: boolean
public_visibility: boolean
version: Version
}
export interface CatalogPage {
/**
 * @minItems 0
 */
data: CatalogItem[]
meta: Pagination
}
export interface CatalogItemResponse {
data: CatalogItem
}
/**
 * Règle fiscale saisie par la gérante ; jamais inventée : sans validation (validated_at), elle n'est pas appliquée aux documents de production.
 */
export interface TaxRule {
id: Ulid
code: string
label: string
rate_percent: (Rate | null)
active: boolean
validated_by: NullableUlid
validated_at: NullableInstant
legal_note: (string | null)
version: Version
}
export interface TaxRuleResponse {
data: TaxRule
}
export interface TaxRuleList {
/**
 * @minItems 0
 */
data: TaxRule[]
}
/**
 * Rapport d'import contrôlé (X01) : aperçu sans écriture (dry_run) puis import ; une ligne refusée n'est jamais importée partiellement.
 */
export interface ImportReport {
dry_run: boolean
rows: number
accepted: number
/**
 * @minItems 0
 */
rejected: {
line: number
field: (string | null)
message: string
}[]
/**
 * @minItems 0
 */
created_ids: Ulid[]
}
export interface ImportReportResponse {
data: ImportReport
}
/**
 * Justificatif scanné d'une créance papier (X01), conservé dans le stockage privé du cabinet (classement FINANCIAL) ; aucune adresse publique.
 */
export interface LegacyEvidence {
file_id: Ulid
sha256: Sha256Hex
mime_type: ("application/pdf" | "image/jpeg" | "image/png")
size_bytes: number
}
export interface LegacyEvidenceResponse {
data: LegacyEvidence
}
export interface InvoiceLine {
id: Ulid
position: number
catalog_item_id: NullableUlid
reference_snapshot: (string | null)
description_snapshot: string
category_snapshot: Code
unit_snapshot: Code
quantity: Quantity
unit_price_gross: MoneyXaf
discount_gross: MoneyXaf
line_total_gross: MoneyXaf
tax_code_snapshot: string
tax_rate_snapshot: (Rate | null)
tax_amount: (MoneyXaf | null)
prescription_id: NullableUlid
}
/**
 * Projection calculée sous le verrou de la facture (contrat 23) : aucun statut PAID stocké.
 */
export interface InvoiceBalance {
total_gross: MoneyXaf
paid_net: MoneyXaf
credited: MoneyXaf
refunded: MoneyXaf
balance_due: SignedMoneyXaf
credit_available: MoneyXaf
settlement: ("NOT_ISSUED" | "UNPAID" | "PARTIALLY_PAID" | "SETTLED" | "IN_CREDIT")
}
/**
 * Encaissement d'une facture ; received_by_name est le nom ACTUEL du compte qui a encaissé (le reçu garde le nom figé dans son snapshot).
 */
export interface InvoicePayment {
id: Ulid
amount: PositiveMoneyXaf
method: PaymentsMethod
reference: (string | null)
effective_at: Instant
confirmed_at: NullableInstant
status: PaymentsStatus
receipt_id: NullableUlid
receipt_number: (string | null)
reversed_amount: MoneyXaf
received_by: Ulid
received_by_name: (string | null)
}
/**
 * État central du PDF : PENDING n'autorise jamais à répéter l'opération (fichier 08).
 */
export interface DocumentState {
document_id: Ulid
document_status: GeneratedDocumentsStatus
}
/**
 * Facture : draft_version (version du brouillon, figée à l'émission) et ledger_version (projection après émission, null pour un brouillon) nommées distinctement (fichier 08). patient_snapshot, clinic_snapshot et tax_snapshot sont les contenus FIGÉS à l'émission (null pour un brouillon) : le document d'une facture émise est produit d'eux, jamais de l'identité ni des prix actuels (fichier 11). Un document dont clinic_snapshot.test_document vaut true est un document TEST.
 */
export interface Invoice {
id: Ulid
patient_id: Ulid
visit_id: NullableUlid
quote_id?: NullableUlid
number: (string | null)
status: InvoicesStatus
issued_at: NullableInstant
issued_by: NullableUlid
issued_by_name: (string | null)
due_date: NullableCivilDate
currency: Currency
total_gross: MoneyXaf
origin: InvoicesOrigin
legacy_reference: (string | null)
draft_version: Version
ledger_version: (Version | null)
/**
 * Projection calculée sous le verrou de la facture (contrat 23) : aucun statut PAID stocké.
 */
balance: {
total_gross: MoneyXaf
paid_net: MoneyXaf
credited: MoneyXaf
refunded: MoneyXaf
balance_due: SignedMoneyXaf
credit_available: MoneyXaf
settlement: ("NOT_ISSUED" | "UNPAID" | "PARTIALLY_PAID" | "SETTLED" | "IN_CREDIT")
}
/**
 * @minItems 0
 */
lines: {
id: Ulid
position: number
catalog_item_id: NullableUlid
reference_snapshot: (string | null)
description_snapshot: string
category_snapshot: Code
unit_snapshot: Code
quantity: Quantity
unit_price_gross: MoneyXaf
discount_gross: MoneyXaf
line_total_gross: MoneyXaf
tax_code_snapshot: string
tax_rate_snapshot: (Rate | null)
tax_amount: (MoneyXaf | null)
prescription_id: NullableUlid
}[]
/**
 * @minItems 0
 * 
 * Items: Encaissement d'une facture ; received_by_name est le nom ACTUEL du compte qui a encaissé (le reçu garde le nom figé dans son snapshot).
 */
payments: {
id: Ulid
amount: PositiveMoneyXaf
method: PaymentsMethod
reference: (string | null)
effective_at: Instant
confirmed_at: NullableInstant
status: PaymentsStatus
receipt_id: NullableUlid
receipt_number: (string | null)
reversed_amount: MoneyXaf
received_by: Ulid
received_by_name: (string | null)
}[]
/**
 * @minItems 0
 */
reversals?: {
id: Ulid
payment_id: Ulid
amount: PositiveMoneyXaf
reason: string
recorded_at: Instant
recorded_by: Ulid
recorded_by_name: (string | null)
}[]
/**
 * @minItems 0
 */
credit_notes: {
id: Ulid
number: (string | null)
status: CreditNotesStatus
amount_gross: MoneyXaf
issued_at: NullableInstant
reason?: string
refunded_amount?: MoneyXaf
}[]
/**
 * @minItems 0
 */
refunds: {
id: Ulid
number: string
amount: PositiveMoneyXaf
method: RefundsMethod
effective_at: Instant
credit_note_id?: Ulid
}[]
write_owner: ({
device_id: Ulid
epoch: number
status: InvoiceWriteOwnersStatus
} | null)
document: ({
document_id: Ulid
document_status: GeneratedDocumentsStatus
} | null)
patient_snapshot: (InvoicePatientSnapshot | null)
clinic_snapshot: (InvoiceClinicSnapshot | null)
tax_snapshot: (InvoiceTaxSnapshot | null)
}
export interface InvoicePatientSnapshot {
patient_id: Ulid
record_number: string
last_name: string
first_names: (string | null)
}
export interface InvoiceClinicSnapshot {
clinic_id: Ulid
name: string
address: (string | null)
phone: (string | null)
email: (string | null)
tax_identifier: (string | null)
professional_mentions: (string | null)
document_settings: ({

} | null)
currency: Currency
timezone: string
test_document: boolean
}
export interface InvoiceTaxSnapshot {
regime: ("NO_TAX_CONFIGURED" | "VALIDATED_RULES")
/**
 * @minItems 0
 */
rules: {
tax_rule_id: Ulid
code: string
label: string
rate_percent: (Rate | null)
validated_at: NullableInstant
legal_note: (string | null)
}[]
}
/**
 * Ligne de la liste des factures : identité de BASE du patient (dossier courant, jamais clinique), reste dû projeté.
 */
export interface InvoiceSummary {
id: Ulid
patient_id: Ulid
patient: ({
id: Ulid
record_number: string
last_name: string
first_names: (string | null)
} | null)
number: (string | null)
status: InvoicesStatus
issued_at: NullableInstant
total_gross: MoneyXaf
balance_due: SignedMoneyXaf
draft_version: Version
ledger_version: (Version | null)
}
export interface InvoiceResponse {
data: Invoice
}
/**
 * Destinataire d'un devis : patient (dossier, nom, prénoms ; aucun téléphone) OU prospect (nom, téléphone). Figé à l'émission et à chaque révision ; jamais une donnée clinique.
 */
export interface QuoteRecipient {
kind: ("PATIENT" | "PROSPECT")
patient_id: NullableUlid
prospect_contact_id: NullableUlid
record_number: (string | null)
last_name: string
first_names: (string | null)
phone: (string | null)
}
/**
 * Ligne ACTUELLE du devis (brouillon ou dernière révision) ; les révisions antérieures sont dans leur snapshot.
 */
export interface QuoteLine {
id: Ulid
position: number
catalog_item_id: NullableUlid
description_snapshot: string
unit_code: Code
quantity: Quantity
unit_price_gross: MoneyXaf
discount_gross: MoneyXaf
line_total_gross: MoneyXaf
}
/**
 * Révision figée (immuable) : snapshot complet, source de son document, réimprimable à l'identique ; authored_by_name est le nom ACTUEL de l'auteur (le snapshot garde le nom figé).
 */
export interface QuoteRevision {
id: Ulid
revision_no: number
recorded_at: Instant
authored_by: Ulid
authored_by_name: (string | null)
reason: string
snapshot: QuoteRevisionSnapshot
document: ({
document_id: Ulid
document_status: GeneratedDocumentsStatus
} | null)
}
export interface QuoteRevisionSnapshot {
quote_id: Ulid
number: string
revision_no: number
recorded_at: Instant
issued_at: Instant
valid_until: NullableCivilDate
recipient: {
kind: ("PATIENT" | "PROSPECT")
patient_id: NullableUlid
prospect_contact_id: NullableUlid
record_number: (string | null)
last_name: string
first_names: (string | null)
phone: (string | null)
}
/**
 * @minItems 1
 */
lines: [{
line_id: Ulid
position: number
catalog_item_id: NullableUlid
reference: (string | null)
description: string
unit_code: Code
quantity: Quantity
unit_price_gross: MoneyXaf
discount_gross: MoneyXaf
line_total_gross: MoneyXaf
tax_code: string
tax_rate_percent: (Rate | null)
tax_amount: (MoneyXaf | null)
}, ...({
line_id: Ulid
position: number
catalog_item_id: NullableUlid
reference: (string | null)
description: string
unit_code: Code
quantity: Quantity
unit_price_gross: MoneyXaf
discount_gross: MoneyXaf
line_total_gross: MoneyXaf
tax_code: string
tax_rate_percent: (Rate | null)
tax_amount: (MoneyXaf | null)
})[]]
total_gross: MoneyXaf
currency: Currency
/**
 * Régime fiscal figé : aucune taxe inventée ; sans règle validée, NO_TAX_CONFIGURED et liste vide.
 */
tax: {
regime: ("NO_TAX_CONFIGURED" | "VALIDATED_RULES")
/**
 * @minItems 0
 */
rules: {
tax_rule_id: Ulid
code: string
label: string
rate_percent: (Rate | null)
validated_at: NullableInstant
legal_note: (string | null)
}[]
}
/**
 * En-tête du cabinet au moment de l'émission ; test_document = true tant que production_documents_enabled est faux (document TEST clairement marqué, fichier 23).
 */
clinic: {
clinic_id: Ulid
name: string
address: (string | null)
phone: (string | null)
email: (string | null)
tax_identifier: (string | null)
professional_mentions: (string | null)
document_settings: ({

} | null)
currency: Currency
timezone: string
test_document: boolean
}
authored_by: {
user_id: Ulid
display_name: string
}
reason: string
template_version: string
}
/**
 * Devis (L1D07) : effective_status = statut à l'instant (EXPIRED pour un devis émis ou accepté dont la validité est passée, jamais écrit) ; revisions de la plus récente à la plus ancienne ; invoices = brouillons ou factures nés de sa conversion (provenance). Un devis ne compte ni dans le chiffre d'affaires ni dans l'encaissé.
 */
export interface Quote {
id: Ulid
number: (string | null)
status: QuotesStatus
effective_status: QuotesStatus
valid_until: NullableCivilDate
total_gross: MoneyXaf
recipient: QuoteRecipient
issued_at: NullableInstant
created_by: Ulid
created_by_name: (string | null)
version: Version
current_revision: number
/**
 * @minItems 0
 */
lines: QuoteLine[]
/**
 * @minItems 0
 */
revisions: QuoteRevision[]
/**
 * @minItems 0
 */
invoices: {
id: Ulid
number: (string | null)
status: InvoicesStatus
}[]
created_at: Instant
updated_at: Instant
}
/**
 * Ligne de la liste des devis : destinataire (identité de base), statut à l'instant, dernière révision.
 */
export interface QuoteSummary {
id: Ulid
number: (string | null)
status: QuotesStatus
effective_status: QuotesStatus
valid_until: NullableCivilDate
total_gross: MoneyXaf
recipient: QuoteRecipient
issued_at: NullableInstant
current_revision: number
version: Version
created_at: Instant
}
export interface QuoteResponse {
data: Quote
}
/**
 * Résultat de la suppression d'un brouillon de devis jamais émis : le devis et ses lignes n'existent plus.
 */
export interface QuoteDeletion {
quote_id: Ulid
lines: number
}
export interface DeleteQuoteDraftResponse {
data: QuoteDeletion
}
export interface QuotePage {
/**
 * @minItems 0
 */
data: QuoteSummary[]
meta: Pagination
}
export interface InvoicePage {
/**
 * @minItems 0
 */
data: InvoiceSummary[]
meta: Pagination
}
/**
 * Réponse confirmée d'encaissement (fichier 08) : références paiement/reçu, montant, solde recalculé, état du PDF.
 */
export interface PaymentResult {
payment_id: Ulid
receipt_id: Ulid
receipt_number: string
invoice_id: Ulid
amount: PositiveMoneyXaf
currency: Currency
method: PaymentsMethod
effective_at: Instant
recorded_at: Instant
ledger_version: Version
/**
 * Projection calculée sous le verrou de la facture (contrat 23) : aucun statut PAID stocké.
 */
balance: {
total_gross: MoneyXaf
paid_net: MoneyXaf
credited: MoneyXaf
refunded: MoneyXaf
balance_due: SignedMoneyXaf
credit_available: MoneyXaf
settlement: ("NOT_ISSUED" | "UNPAID" | "PARTIALLY_PAID" | "SETTLED" | "IN_CREDIT")
}
/**
 * État central du PDF : PENDING n'autorise jamais à répéter l'opération (fichier 08).
 */
receipt_document: {
document_id: Ulid
document_status: GeneratedDocumentsStatus
}
}
export interface ReversalResult {
reversal_id: Ulid
payment_id: Ulid
invoice_id: Ulid
amount: PositiveMoneyXaf
recorded_at: Instant
ledger_version: Version
/**
 * Projection calculée sous le verrou de la facture (contrat 23) : aucun statut PAID stocké.
 */
balance: {
total_gross: MoneyXaf
paid_net: MoneyXaf
credited: MoneyXaf
refunded: MoneyXaf
balance_due: SignedMoneyXaf
credit_available: MoneyXaf
settlement: ("NOT_ISSUED" | "UNPAID" | "PARTIALLY_PAID" | "SETTLED" | "IN_CREDIT")
}
}
export interface CreditNoteResult {
credit_note_id: Ulid
number: string
invoice_id: Ulid
amount_gross: PositiveMoneyXaf
issued_at: Instant
ledger_version: Version
/**
 * Projection calculée sous le verrou de la facture (contrat 23) : aucun statut PAID stocké.
 */
balance: {
total_gross: MoneyXaf
paid_net: MoneyXaf
credited: MoneyXaf
refunded: MoneyXaf
balance_due: SignedMoneyXaf
credit_available: MoneyXaf
settlement: ("NOT_ISSUED" | "UNPAID" | "PARTIALLY_PAID" | "SETTLED" | "IN_CREDIT")
}
/**
 * État central du PDF : PENDING n'autorise jamais à répéter l'opération (fichier 08).
 */
document: {
document_id: Ulid
document_status: GeneratedDocumentsStatus
}
}
export interface RefundResult {
refund_id: Ulid
number: string
invoice_id: Ulid
credit_note_id: Ulid
amount: PositiveMoneyXaf
method: RefundsMethod
effective_at: Instant
ledger_version: Version
/**
 * Projection calculée sous le verrou de la facture (contrat 23) : aucun statut PAID stocké.
 */
balance: {
total_gross: MoneyXaf
paid_net: MoneyXaf
credited: MoneyXaf
refunded: MoneyXaf
balance_due: SignedMoneyXaf
credit_available: MoneyXaf
settlement: ("NOT_ISSUED" | "UNPAID" | "PARTIALLY_PAID" | "SETTLED" | "IN_CREDIT")
}
/**
 * État central du PDF : PENDING n'autorise jamais à répéter l'opération (fichier 08).
 */
document: {
document_id: Ulid
document_status: GeneratedDocumentsStatus
}
}
export interface PaymentResultResponse {
data: PaymentResult
}
export interface ReversalResultResponse {
data: ReversalResult
}
export interface CreditNoteResultResponse {
data: CreditNoteResult
}
export interface RefundResultResponse {
data: RefundResult
}
/**
 * Avoir (B07) : pièce liée à la facture, lignes d'origine créditées, part déjà remboursée (refunded_amount), snapshot figé à l'émission (source de son document, produit sur le poste) ; issued_by_name est le nom ACTUEL de l'émetteur. Un avoir ne se modifie ni ne se supprime.
 */
export interface CreditNote {
id: Ulid
invoice_id: Ulid
number: (string | null)
status: CreditNotesStatus
amount_gross: PositiveMoneyXaf
reason: string
approval_id: Ulid
issued_at: NullableInstant
issued_by: NullableUlid
issued_by_name: (string | null)
refunded_amount: MoneyXaf
/**
 * @minItems 0
 */
lines: {
id: Ulid
invoice_line_id: Ulid
description_snapshot: (string | null)
quantity: (Quantity | null)
amount_gross: PositiveMoneyXaf
tax_amount: (MoneyXaf | null)
reason: (string | null)
}[]
snapshot: (CreditNoteSnapshot | null)
document: ({
document_id: Ulid
document_status: GeneratedDocumentsStatus
} | null)
}
export interface CreditNoteSnapshot {
credit_note_id: Ulid
number: string
issued_at: Instant
invoice: {
invoice_id: Ulid
number: string
issued_at: Instant
total_gross: MoneyXaf
}
patient: {
patient_id: Ulid
record_number: string
last_name: string
first_names: (string | null)
}
/**
 * @minItems 1
 */
lines: [{
invoice_line_id: Ulid
description: string
quantity: (Quantity | null)
amount_gross: PositiveMoneyXaf
tax_amount: (MoneyXaf | null)
}, ...({
invoice_line_id: Ulid
description: string
quantity: (Quantity | null)
amount_gross: PositiveMoneyXaf
tax_amount: (MoneyXaf | null)
})[]]
amount_gross: PositiveMoneyXaf
reason: string
issued_by: {
user_id: Ulid
display_name: string
}
approval_id: Ulid
/**
 * Régime fiscal figé : aucune taxe inventée ; sans règle validée, NO_TAX_CONFIGURED et liste vide.
 */
tax: {
regime: ("NO_TAX_CONFIGURED" | "VALIDATED_RULES")
/**
 * @minItems 0
 */
rules: {
tax_rule_id: Ulid
code: string
label: string
rate_percent: (Rate | null)
validated_at: NullableInstant
legal_note: (string | null)
}[]
}
/**
 * En-tête du cabinet au moment de l'émission ; test_document = true tant que production_documents_enabled est faux (document TEST clairement marqué, fichier 23).
 */
clinic: {
clinic_id: Ulid
name: string
address: (string | null)
phone: (string | null)
email: (string | null)
tax_identifier: (string | null)
professional_mentions: (string | null)
document_settings: ({

} | null)
currency: Currency
timezone: string
test_document: boolean
}
template_version: string
}
export interface CreditNoteResponse {
data: CreditNote
}
/**
 * Remboursement d'un crédit (B08) : sortie d'argent liée à un avoir, snapshot figé (bénéficiaire = identité figée de la facture, source de son document) ; created_by_name est le nom ACTUEL de l'auteur. Un remboursement ne se modifie ni ne se supprime.
 */
export interface Refund {
id: Ulid
invoice_id: Ulid
credit_note_id: Ulid
number: string
amount: PositiveMoneyXaf
method: RefundsMethod
reference: (string | null)
approval_id: Ulid
effective_at: Instant
cash_session_id: NullableUlid
created_by: Ulid
created_by_name: (string | null)
snapshot: RefundSnapshot
document: ({
document_id: Ulid
document_status: GeneratedDocumentsStatus
} | null)
}
export interface RefundSnapshot {
refund_id: Ulid
number: string
effective_at: Instant
credit_note: {
credit_note_id: Ulid
number: string
}
invoice: {
invoice_id: Ulid
number: string
issued_at: Instant
total_gross: MoneyXaf
}
beneficiary: {
patient_id: Ulid
record_number: string
last_name: string
first_names: (string | null)
}
amount: PositiveMoneyXaf
currency: Currency
method: RefundsMethod
reference: (string | null)
created_by: {
user_id: Ulid
display_name: string
}
/**
 * En-tête du cabinet au moment de l'émission ; test_document = true tant que production_documents_enabled est faux (document TEST clairement marqué, fichier 23).
 */
clinic: {
clinic_id: Ulid
name: string
address: (string | null)
phone: (string | null)
email: (string | null)
tax_identifier: (string | null)
professional_mentions: (string | null)
document_settings: ({

} | null)
currency: Currency
timezone: string
test_document: boolean
}
template_version: string
}
export interface RefundResponse {
data: Refund
}
/**
 * Approbation exacte (B06) : nature, cible et empreinte du contenu ; subject = contenu exact relu dans l'audit de la demande et REVÉRIFIÉ contre payload_hash (null s'il ne la reproduit pas, ou pour une exécution directe de la gérante) ; effective_status = statut à l'instant (une demande ou un accord échus sont EXPIRED, jamais écrit) ; noms à la date de la demande et de la décision ; motif de la décision. Aucune donnée clinique.
 */
export interface Approval {
id: Ulid
kind: (("EXAM_FEE_WAIVER" | "DRAFT_LINE_RIGHTS" | "PAYMENT_REVERSAL" | "CREDIT_NOTE" | "REFUND" | "CREDIT_DELIVERY" | "STOCK_MOVEMENT" | "CASH_MOVEMENT") | null)
action_code: PermissionCode
target_type: string
target_id: Ulid
payload_hash: Sha256Hex
subject: (ApprovalSubject | null)
reason: string
status: ApprovalsStatus
effective_status: ApprovalsStatus
requested_by: Ulid
requested_by_name: string
requested_at: Instant
decided_by: NullableUlid
decided_by_name: (string | null)
decided_at: NullableInstant
decision_reason: (string | null)
expires_at: NullableInstant
consumed_at: NullableInstant
target: ApprovalTarget
}
/**
 * Dispense des frais d'examen d'UNE visite de CE patient (action exam_fee.collect, cible visits).
 */
export interface ExamFeeWaiverSubject {
kind: "EXAM_FEE_WAIVER"
visit_id: Ulid
patient_id: Ulid
}
/**
 * Prix hors catalogue, ligne libre ou remise au-delà du plafond : TOUTES les lignes du brouillon telles qu'elles seront enregistrées, sans leurs identifiants (action catalog.manage, cible invoices ; le brouillon peut ne pas encore exister).
 */
export interface DraftLineRightsSubject {
kind: "DRAFT_LINE_RIGHTS"
invoice_id: Ulid
patient_id: Ulid
/**
 * @minItems 1
 * @maxItems 200
 */
lines: [{
position: number
catalog_item_id: NullableUlid
description: string
quantity: Quantity
unit_price_gross: MoneyXaf
discount_gross: MoneyXaf
prescription_id: NullableUlid
}, ...({
position: number
catalog_item_id: NullableUlid
description: string
quantity: Quantity
unit_price_gross: MoneyXaf
discount_gross: MoneyXaf
prescription_id: NullableUlid
})[]]
}
/**
 * Contre-écriture d'un paiement (action payment.reverse, cible payments).
 */
export interface PaymentReversalSubject {
kind: "PAYMENT_REVERSAL"
invoice_id: Ulid
payment_id: Ulid
amount: PositiveMoneyXaf
}
/**
 * Avoir lié aux lignes d'origine (action credit_note.issue, cible invoices).
 */
export interface CreditNoteSubject {
kind: "CREDIT_NOTE"
invoice_id: Ulid
amount_gross: PositiveMoneyXaf
/**
 * @minItems 1
 * @maxItems 200
 */
lines: [{
invoice_line_id: Ulid
quantity: (Quantity | null)
amount_gross: PositiveMoneyXaf
}, ...({
invoice_line_id: Ulid
quantity: (Quantity | null)
amount_gross: PositiveMoneyXaf
})[]]
}
/**
 * Remboursement d'un crédit (action refund.execute, cible invoices).
 */
export interface RefundSubject {
kind: "REFUND"
invoice_id: Ulid
credit_note_id: Ulid
amount: PositiveMoneyXaf
method: RefundsMethod
}
/**
 * Remise au patient d'une facture non soldée : reste dû à l'instant de la demande et quantités remises par ligne d'origine (une entrée par ligne, cumul de la remise) ; un encaissement intervenu entre-temps exige une nouvelle demande (action delivery.confirm, cible invoices).
 */
export interface CreditDeliverySubject {
kind: "CREDIT_DELIVERY"
invoice_id: Ulid
amount_due: PositiveMoneyXaf
/**
 * @minItems 1
 * @maxItems 200
 */
lines: [{
invoice_line_id: Ulid
quantity: Quantity
}, ...({
invoice_line_id: Ulid
quantity: Quantity
})[]]
}
/**
 * Casse ou ajustement de stock : position, article, lot, nature et quantité signée exactes (action stock.adjust, cible stock_positions).
 */
export interface StockMovementSubject {
kind: "STOCK_MOVEMENT"
position_id: Ulid
item_id: Ulid
lot_id: NullableUlid
movement_kind: ("BREAKAGE" | "ADJUSTMENT")
signed_quantity: SignedQuantity
}
/**
 * Mouvement d'espèces hors vente d'une session ouverte : nature, montant signé (entrée positive, sortie négative) et catégorie de la dépense exacts (action cash.manage, cible cash_sessions).
 */
export interface CashMovementSubject {
kind: "CASH_MOVEMENT"
cash_session_id: Ulid
movement_kind: ("DEPOSIT" | "WITHDRAWAL" | "EXPENSE" | "OPENING_CORRECTION")
signed_amount: number
expense_category_id: NullableUlid
}
/**
 * Résumé de la cible pour décider : identité administrative du patient, numéro de facture (null pour un brouillon), heure de la visite, paiement visé.
 */
export interface ApprovalTarget {
patient: ({
id: Ulid
record_number: string
last_name: string
first_names: (string | null)
} | null)
invoice_number: (string | null)
visit_occurred_at: NullableInstant
payment: ({
amount: PositiveMoneyXaf
method: PaymentsMethod
effective_at: Instant
} | null)
}
export interface ApprovalResponse {
data: Approval
}
export interface ApprovalPage {
/**
 * @minItems 0
 */
data: Approval[]
meta: Pagination
}
/**
 * Caisse physique (cash_registers). Une seule caisse principale au premier jalon.
 */
export interface CashRegister {
id: Ulid
code: string
name: string
active: boolean
}
export interface CashRegisterList {
/**
 * @minItems 0
 */
data: CashRegister[]
}
/**
 * Reçu d'un encaissement : pièce immuable, numéro définitif jamais renuméroté, snapshot figé (source de son document ; fichier 11). Un reçu ne se modifie ni ne se supprime.
 */
export interface Receipt {
id: Ulid
payment_id: Ulid
invoice_id: Ulid
number: string
issued_at: Instant
issued_by: Ulid
snapshot: ReceiptSnapshot
document: ({
document_id: Ulid
document_status: GeneratedDocumentsStatus
} | null)
}
export interface ReceiptSnapshot {
receipt_id: Ulid
receipt_number: string
issued_at: Instant
effective_at: Instant
invoice: {
invoice_id: Ulid
number: string
issued_at: Instant
total_gross: MoneyXaf
}
patient: {
patient_id: Ulid
record_number: string
last_name: string
first_names: (string | null)
}
payment: {
payment_id: Ulid
amount: PositiveMoneyXaf
currency: Currency
method: PaymentsMethod
reference: (string | null)
}
paid_net_before: MoneyXaf
paid_net_after: MoneyXaf
balance_after: SignedMoneyXaf
/**
 * Calculée : BALANCE_SETTLEMENT si le reste après ce paiement est nul, sinon DEPOSIT (un encaissement ne dépasse jamais le solde).
 */
kind: ("DEPOSIT" | "BALANCE_SETTLEMENT")
cashier: {
user_id: Ulid
display_name: string
}
/**
 * En-tête du cabinet au moment de l'émission ; test_document = true tant que production_documents_enabled est faux (document TEST clairement marqué, fichier 23).
 */
clinic: {
clinic_id: Ulid
name: string
address: (string | null)
phone: (string | null)
email: (string | null)
tax_identifier: (string | null)
professional_mentions: (string | null)
document_settings: ({

} | null)
currency: Currency
timezone: string
test_document: boolean
}
template_version: string
}
export interface ReceiptResponse {
data: Receipt
}
/**
 * Session de caisse ; collected_cash, refunded_cash et theoretical_cash (ouverture + espèces encaissées − contre-écritures − remboursements espèces + mouvements autorisés) sont des projections recalculées à chaque lecture. expected_amount, counted_amount et variance ne sont renseignés qu'à la clôture : photographie figée.
 */
export interface CashSession {
id: Ulid
cash_register_id: Ulid
cashier_id: Ulid
opened_at: Instant
opening_amount: MoneyXaf
closed_at: NullableInstant
counted_amount: (MoneyXaf | null)
expected_amount: (MoneyXaf | null)
variance: (SignedMoneyXaf | null)
variance_reason: (string | null)
closed_by: NullableUlid
collected_cash: MoneyXaf
refunded_cash: MoneyXaf
theoretical_cash: SignedMoneyXaf
}
export interface CashSessionResponse {
data: CashSession
}
export interface CurrentCashSessionResponse {
data: (CashSession | null)
}
export interface Delivery {
id: Ulid
invoice_id: Ulid
status: DeliveriesStatus
delivered_at: NullableInstant
delivered_by: NullableUlid
credit_delivery_approval_id: NullableUlid
/**
 * @minItems 1
 */
lines: [{
id: Ulid
invoice_line_id: Ulid
item_id: Ulid
quantity: Quantity
stock_position_id: NullableUlid
stock_lot_id: NullableUlid
reservation_id: NullableUlid
}, ...({
id: Ulid
invoice_line_id: Ulid
item_id: Ulid
quantity: Quantity
stock_position_id: NullableUlid
stock_lot_id: NullableUlid
reservation_id: NullableUlid
})[]]
}
export interface DeliveryResponse {
data: Delivery
}
/**
 * Remises d'une facture (I01, I02) : par ligne, quantité facturée, remise, retournée, reste à remettre, réserve ouverte et remettable maintenant ; remises confirmées (lot, nom ACTUEL de qui a remis) et retours physiques ; reste dû à l'instant (null pour un brouillon : une facture non soldée se remet avec l'approbation de la gérante). Projection recalculée à chaque lecture, aucun coût d'achat.
 */
export interface InvoiceDeliveries {
invoice_id: Ulid
invoice_number: (string | null)
invoice_status: InvoicesStatus
amount_due: (MoneyXaf | null)
/**
 * @minItems 0
 */
lines: {
invoice_line_id: Ulid
position: number
item_id: NullableUlid
description: string
stock_mode: (CatalogItemsStockMode | null)
quantity_integer_only: boolean
quantity: Quantity
/**
 * DECIMAL(12,3) en chaîne exacte, zéro admis.
 */
delivered: string
/**
 * DECIMAL(12,3) en chaîne exacte, zéro admis.
 */
returned: string
/**
 * DECIMAL(12,3) en chaîne exacte, zéro admis.
 */
remaining: string
/**
 * DECIMAL(12,3) en chaîne exacte, zéro admis.
 */
reserved_open: string
deliverable: boolean
}[]
/**
 * @minItems 0
 */
deliveries: {
id: Ulid
status: DeliveriesStatus
delivered_at: Instant
delivered_by: Ulid
delivered_by_name: (string | null)
credit_delivery_approval_id: NullableUlid
/**
 * @minItems 0
 */
lines: {
id: Ulid
invoice_line_id: Ulid
item_id: Ulid
description: string
quantity: Quantity
/**
 * DECIMAL(12,3) en chaîne exacte, zéro admis.
 */
returned: string
/**
 * DECIMAL(12,3) en chaîne exacte, zéro admis.
 */
returnable: string
stock_position_id: NullableUlid
stock_lot_id: NullableUlid
batch_number: (string | null)
expires_on: NullableCivilDate
}[]
}[]
/**
 * @minItems 0
 */
returns: {
id: Ulid
delivery_line_id: Ulid
item_id: Ulid
quantity: Quantity
condition_code: PhysicalReturnsConditionCode
accepted_for_restock: boolean
occurred_at: Instant
stock_movement_id: NullableUlid
credit_note_id: NullableUlid
}[]
}
export interface InvoiceDeliveriesResponse {
data: InvoiceDeliveries
}
/**
 * Session de caisse et ses libellés : noms ACTUELS de la caissière et de qui a clôturé, caisse.
 */
export interface CashSessionEntry {
id: Ulid
cash_register_id: Ulid
cashier_id: Ulid
opened_at: Instant
opening_amount: MoneyXaf
closed_at: NullableInstant
counted_amount: (MoneyXaf | null)
expected_amount: (MoneyXaf | null)
variance: (SignedMoneyXaf | null)
variance_reason: (string | null)
closed_by: NullableUlid
collected_cash: MoneyXaf
refunded_cash: MoneyXaf
theoretical_cash: SignedMoneyXaf
cashier_name: (string | null)
closed_by_name: (string | null)
register_code: (string | null)
register_name: (string | null)
}
export interface CashSessionPage {
/**
 * @minItems 0
 */
data: CashSessionEntry[]
meta: Pagination
}
/**
 * Relevé d'une session : tiroir espèces (encaissés, contre-écritures, remboursés, mouvements), encaissements de la session et, hors tiroir, les autres modes encaissés par la même caissière pendant la session. Session ouverte : relevé provisoire. Source du PDF produit sur le poste.
 */
export interface CashSessionReport {
session: CashSessionEntry
cash_received: MoneyXaf
cash_reversed: MoneyXaf
cash_refunded: MoneyXaf
movements_in: MoneyXaf
movements_out: MoneyXaf
/**
 * @minItems 0
 */
movements: {
id: Ulid
kind: CashMovementsKind
signed_amount: SignedMoneyXaf
reason: string
occurred_at: Instant
}[]
/**
 * @minItems 0
 */
payments: {
payment_id: Ulid
invoice_id: Ulid
invoice_number: (string | null)
receipt_id: NullableUlid
receipt_number: (string | null)
method: PaymentsMethod
amount: PositiveMoneyXaf
reversed_amount: MoneyXaf
effective_at: Instant
}[]
/**
 * @minItems 0
 */
other_methods: {
method: PaymentsMethod
count: number
amount: SignedMoneyXaf
}[]
generated_at: Instant
}
export interface CashSessionReportResponse {
data: CashSessionReport
}
/**
 * Catégorie de dépenses du cabinet (L1D05) : pas un plan comptable réglementaire ; aucune n'est préconfigurée.
 */
export interface ExpenseCategory {
id: Ulid
code: string
name: string
active: boolean
}
export interface ExpenseCategoryResponse {
data: ExpenseCategory
}
export interface ExpenseCategoryList {
/**
 * @minItems 0
 */
data: ExpenseCategory[]
}
/**
 * Mouvement d'espèces hors vente (L1D05) : dépense catégorisée, dépôt, retrait ou correction de l'ouverture ; jamais un paiement (ni facture, ni reçu). approval_mode : demande accordée par la gérante, ou exécution directe de la gérante. Immuable.
 */
export interface CashMovement {
id: Ulid
cash_session_id: Ulid
kind: CashMovementsKind
signed_amount: SignedMoneyXaf
reason: string
reference: (string | null)
occurred_at: Instant
expense_category: ({
id: Ulid
code: string
name: string
} | null)
created_by: Ulid
created_by_name: (string | null)
approval_id: Ulid
approval_mode: ("APPROVED" | "DIRECT")
}
export interface CashMovementResponse {
data: CashMovement
}
/**
 * Revue de l'écart d'une session clôturée par la gérante : fait d'audit, la session figée n'est pas réécrite.
 */
export interface CashVarianceReview {
decision: ("ACCEPTED" | "DISPUTED")
note: (string | null)
reviewed_by: NullableUlid
reviewed_by_name: string
reviewed_at: Instant
}
export interface CashVarianceReviewResponse {
data: CashVarianceReview
}
export interface CashSessionMovements {
cash_session_id: Ulid
closed: boolean
/**
 * @minItems 0
 */
movements: CashMovement[]
variance_review: (CashVarianceReview | null)
}
export interface CashSessionMovementsResponse {
data: CashSessionMovements
}
/**
 * Caisse du jour (jour civil du cabinet) : encaissements nets par mode (encaissés − contre-écritures − remboursements), sessions du jour. Portée CLINIC (finance.global.read) : tout le cabinet, factures et avoirs émis du jour, reste à encaisser des factures ouvertes à l'instant de la lecture. Portée OWN (caissière) : ses encaissements et ses sessions seulement ; issued, credited et outstanding à null.
 */
export interface CashDayReport {
date: CivilDate
scope: ("CLINIC" | "OWN")
/**
 * @minItems 0
 */
collections: {
method: PaymentsMethod
payments_count: number
payments_amount: MoneyXaf
reversals_amount: MoneyXaf
refunds_amount: MoneyXaf
net_amount: SignedMoneyXaf
}[]
net_total: SignedMoneyXaf
/**
 * @minItems 0
 */
sessions: CashSessionEntry[]
issued: ({
count: number
total_gross: MoneyXaf
} | null)
credited: ({
count: number
amount_gross: MoneyXaf
} | null)
outstanding: ({
invoices_count: number
amount_due: MoneyXaf
refundable_credit: MoneyXaf
} | null)
generated_at: Instant
}
export interface CashDayReportResponse {
data: CashDayReport
}
/**
 * Règles de vente du compte connecté, pour l'affichage : le serveur reste seul juge à chaque commande.
 */
export interface SalesSettings {
price_authority: boolean
discount_cap_percent: Rate
/**
 * @minItems 1
 */
payment_methods: [PaymentsMethod, ...(PaymentsMethod)[]]
/**
 * @minItems 0
 */
payment_reference_required: PaymentsMethod[]
exam_fee_item_reference: (string | null)
}
export interface SalesSettingsResponse {
data: SalesSettings
}
export interface ClinicalRevision {
id: Ulid
revision_no: number
recorded_at: Instant
author_id: Ulid
reason: string
previous_revision_id: NullableUlid
sha256: Sha256Hex
}
/**
 * Révision figée avec son snapshot complet (clinical.read) : immuable, lue telle qu’enregistrée ; sha256 = SHA-256 de JCS(snapshot).
 */
export interface ClinicalRevisionDetail {
id: Ulid
revision_no: number
recorded_at: Instant
author_id: Ulid
reason: string
previous_revision_id: NullableUlid
sha256: Sha256Hex
snapshot: ClinicalRevisionSnapshot
}
export interface ClinicalRevisionSnapshot {
consultation_id: Ulid
revision_no: number
recorded_at: Instant
author: {
user_id: Ulid
display_name: string
}
patient: {
patient_id: Ulid
record_number: string
last_name: string
first_names: (string | null)
}
visit_id: Ulid
effective_at: Instant
steps: AllSteps
finalization_missing_data_reason: (string | null)
previous_revision_id: NullableUlid
amendment_reason: (string | null)
}
export interface ClinicalRevisionResponse {
data: ClinicalRevisionDetail
}
/**
 * Identité administrative de base du patient de la consultation, pour l’en-tête de l’écran (comme Visit.patient).
 */
export interface ConsultationPatient {
id: Ulid
record_number: string
last_name: string
first_names: (string | null)
sex: PatientRecordsSex
birth_date: NullableCivilDate
}
/**
 * Identité administrative de base du patient de la consultation ouverte, avec sa profession (donnée du dossier administratif que le cabinet note dans son carnet), pour l’en-tête de l’écran. La liste des examens (ConsultationSummary) ne porte pas la profession.
 */
export interface ConsultationHeaderPatient {
id: Ulid
record_number: string
last_name: string
first_names: (string | null)
sex: PatientRecordsSex
birth_date: NullableCivilDate
profession: (string | null)
}
/**
 * Consultation complète : professionnel et gérante seulement (clinical.read). patient : identité administrative de base et profession, pour l’en-tête (sans dépendre du module Patients).
 */
export interface Consultation {
id: Ulid
visit_id: Ulid
patient_id: Ulid
clinician_id: Ulid
effective_at: Instant
date_change_reason: (string | null)
status: ConsultationsStatus
current_revision: number
completed_at: NullableInstant
finalization_missing_data_reason: (string | null)
version: Version
patient: ConsultationHeaderPatient
steps: AllSteps
/**
 * @minItems 0
 */
revisions: {
id: Ulid
revision_no: number
recorded_at: Instant
author_id: Ulid
reason: string
previous_revision_id: NullableUlid
sha256: Sha256Hex
}[]
}
/**
 * Examen dans la liste du cabinet : patient (identité administrative de base), état, dates, révision, version (attendue par la suppression d'un brouillon) et professionnel. Aucune valeur clinique.
 */
export interface ConsultationSummary {
id: Ulid
visit_id: Ulid
patient_id: Ulid
status: ConsultationsStatus
effective_at: Instant
completed_at: NullableInstant
current_revision: number
version: number
patient: ConsultationPatient
clinician: {
id: Ulid
display_name: string
}
}
export interface ConsultationSummaryPage {
/**
 * @minItems 0
 */
data: ConsultationSummary[]
meta: Pagination
}
/**
 * Échelle d’acuité configurée par le cabinet (visual_acuity_scales). Aucune conversion entre échelles n’est fournie ni présumée.
 */
export interface VisualAcuityScale {
id: Ulid
code: string
label: string
description: (string | null)
active: boolean
}
export interface VisualAcuityScaleList {
/**
 * @minItems 0
 */
data: VisualAcuityScale[]
}
/**
 * Prescription versionnée ; updated_at sert de jeton de concurrence pour PATCH d'un brouillon (optical_prescriptions n'a pas de colonne version).
 */
export interface Prescription {
id: Ulid
series_id: Ulid
version_no: number
supersedes_id: NullableUlid
patient_id: Ulid
origin: OpticalPrescriptionsOrigin
consultation_id: NullableUlid
external_prescriber: (string | null)
external_prescribed_on: NullableCivilDate
external_file_id: NullableUlid
status: OpticalPrescriptionsStatus
usage_code: (Code | null)
usage_other: (string | null)
lens_type_code: (Code | null)
lens_type_other: (string | null)
lens_index: (string | null)
lens_index_other: (string | null)
pd_total: NullableDiopter
pd_od: NullableDiopter
pd_og: NullableDiopter
pd_inconsistency_reason: (string | null)
notes: (string | null)
/**
 * @minItems 2
 * @maxItems 2
 */
eyes: [{
id: Ulid
eye: OpticalPrescriptionEyesEye
no_correction: boolean
sphere: NullableDiopter
cylinder: NullableDiopter
axis: (number | null)
addition: NullableDiopter
fitting_height: NullableDiopter
}, {
id: Ulid
eye: OpticalPrescriptionEyesEye
no_correction: boolean
sphere: NullableDiopter
cylinder: NullableDiopter
axis: (number | null)
addition: NullableDiopter
fitting_height: NullableDiopter
}]
/**
 * @minItems 0
 */
treatments: {
id: Ulid
term_code: Code
other_text: (string | null)
}[]
validated_at: NullableInstant
validated_by: NullableUlid
validated_by_name: (string | null)
document_id: NullableUlid
updated_at: Instant
}
export interface ConsultationResponse {
data: Consultation
}
/**
 * Résultat de la suppression d'un examen resté brouillon : la consultation n'existe plus ; la visite est remise dans son état d'avant l'examen (ARRIVED, ou READY_FOR_EXAM / AWAITING_EXAM_FEE quand le paiement de l'examen est contrôlé) avec sa nouvelle version.
 */
export interface ConsultationDeletion {
consultation_id: Ulid
visit_id: Ulid
visit_status: VisitsStatus
visit_version: number
}
export interface DeleteConsultationDraftResponse {
data: ConsultationDeletion
}
/**
 * Résultat de la suppression d'un brouillon de prescription : la prescription n'existe plus (version_no : celle qu'elle portait ; la dernière version validée de sa série redevient la plus récente).
 */
export interface PrescriptionDeletion {
prescription_id: Ulid
patient_id: Ulid
consultation_id: NullableUlid
version_no: number
}
export interface DeletePrescriptionDraftResponse {
data: PrescriptionDeletion
}
export interface PrescriptionResponse {
data: Prescription
}
/**
 * Toutes les versions des prescriptions de la consultation, de la plus récente à la plus ancienne.
 */
export interface PrescriptionList {
/**
 * @minItems 0
 */
data: Prescription[]
}
/**
 * Poste enrôlé (O02) : clé PUBLIQUE ES256 seulement ; kid = empreinte RFC 7638 de cette clé.
 */
export interface EnrolledDevice {
device_id: Ulid
device_code: string
name: string
kid: string
public_key_jwk: PublicJwk
status: EnrolledDevicesStatus
enrolled_at: Instant
responsible_user_id: Ulid
responsible_name: (string | null)
app_version: string
last_sync_at: NullableInstant
active_grants: number
}
export interface EnrolledDeviceResponse {
data: EnrolledDevice
}
export interface EnrolledDeviceList {
/**
 * @minItems 0
 */
data: EnrolledDevice[]
}
/**
 * Grant hors-ligne SIGNÉ (O02) : JWS compact ES256, en-tête {alg, kid, typ=eeo-offline-grant+jws} et charge JCS {catalog_sha256, catalog_version, clinic_id, compartments, device_id, grant_id, issued_at, permissions, rules_version, user_id, v=1, valid_until}. Immuable : une révocation s'ajoute (revoked_at), state est calculé à la lecture.
 */
export interface OfflineGrant {
grant_id: Ulid
device_id: Ulid
user_id: Ulid
user_name: (string | null)
/**
 * @minItems 0
 */
permissions_snapshot: PermissionCode[]
/**
 * @minItems 0
 */
compartments: ("ADMINISTRATIVE" | "CLINICAL" | "FINANCIAL" | "MANAGER")[]
rules_version: string
catalog_version: string
issued_at: Instant
valid_until: Instant
revoked_at: NullableInstant
state: ("ACTIVE" | "EXPIRED" | "REVOKED")
signed_payload: CompactJws
}
export interface OfflineGrantResponse {
data: OfflineGrant
}
export interface OfflineGrantList {
/**
 * @minItems 0
 */
data: OfflineGrant[]
}
/**
 * Clés PUBLIQUES du serveur qui signent les grants (courante puis retirées), à épingler par le poste.
 */
export interface SigningKeySet {
algorithm: "ES256"
grant_type: "eeo-offline-grant+jws"
/**
 * @minItems 1
 */
keys: [{
kid: string
status: ("CURRENT" | "RETIRED")
jwk: PublicJwk
}, ...({
kid: string
status: ("CURRENT" | "RETIRED")
jwk: PublicJwk
})[]]
}
export interface SigningKeySetResponse {
data: SigningKeySet
}
/**
 * Plage de numéros pré-allouée à ce poste (O03), disjointe de toute autre et de la séquence centrale ; le poste rend le numéro consommé <prefix>-AAAA-<valeur complétée à gauche sur width chiffres>, comme le serveur.
 */
export interface NumberAllocation {
allocation_id: Ulid
grant_id: Ulid
document_type: DocumentNumberAllocationsDocumentType
document_year: number
range_start: Counter
range_end: Counter
last_consumed_value: (Counter | null)
status: DocumentNumberAllocationsStatus
prefix: string
width: number
}
/**
 * Quota de stock du poste (O03) : retiré du disponible central, jamais du physique ; disponible local = alloué − consommé − rendu − réservé localement.
 */
export interface StockQuota {
allocation_id: Ulid
item_id: Ulid
stock_position_id: Ulid
stock_lot_id: NullableUlid
allocated_quantity: Quantity
/**
 * DECIMAL(12,3) en chaîne exacte, zéro admis.
 */
consumed_quantity: string
/**
 * DECIMAL(12,3) en chaîne exacte, zéro admis.
 */
returned_quantity: string
status: DeviceStockAllocationsStatus
}
/**
 * Préparation du poste (fichier 19, O03) : grants actifs par profil, plages de numéros ACTIVES et leur format, quotas, factures dont le poste est propriétaire, catalogue figé (contenu dont l'empreinte JCS est signée dans le grant ; jamais de coût d'achat), heure du serveur et préfixe finalisé du journal du poste.
 */
export interface Preparation {
device_id: Ulid
/**
 * @minItems 0
 * 
 * Items: Grant hors-ligne SIGNÉ (O02) : JWS compact ES256, en-tête {alg, kid, typ=eeo-offline-grant+jws} et charge JCS {catalog_sha256, catalog_version, clinic_id, compartments, device_id, grant_id, issued_at, permissions, rules_version, user_id, v=1, valid_until}. Immuable : une révocation s'ajoute (revoked_at), state est calculé à la lecture.
 */
grants: {
grant_id: Ulid
device_id: Ulid
user_id: Ulid
user_name: (string | null)
/**
 * @minItems 0
 */
permissions_snapshot: PermissionCode[]
/**
 * @minItems 0
 */
compartments: ("ADMINISTRATIVE" | "CLINICAL" | "FINANCIAL" | "MANAGER")[]
rules_version: string
catalog_version: string
issued_at: Instant
valid_until: Instant
revoked_at: NullableInstant
state: ("ACTIVE" | "EXPIRED" | "REVOKED")
signed_payload: CompactJws
}[]
/**
 * @minItems 0
 * 
 * Items: Plage de numéros pré-allouée à ce poste (O03), disjointe de toute autre et de la séquence centrale ; le poste rend le numéro consommé <prefix>-AAAA-<valeur complétée à gauche sur width chiffres>, comme le serveur.
 */
number_allocations: {
allocation_id: Ulid
grant_id: Ulid
document_type: DocumentNumberAllocationsDocumentType
document_year: number
range_start: Counter
range_end: Counter
last_consumed_value: (Counter | null)
status: DocumentNumberAllocationsStatus
prefix: string
width: number
}[]
/**
 * @minItems 0
 * 
 * Items: Quota de stock du poste (O03) : retiré du disponible central, jamais du physique ; disponible local = alloué − consommé − rendu − réservé localement.
 */
stock_allocations: {
allocation_id: Ulid
item_id: Ulid
stock_position_id: Ulid
stock_lot_id: NullableUlid
allocated_quantity: Quantity
/**
 * DECIMAL(12,3) en chaîne exacte, zéro admis.
 */
consumed_quantity: string
/**
 * DECIMAL(12,3) en chaîne exacte, zéro admis.
 */
returned_quantity: string
status: DeviceStockAllocationsStatus
}[]
/**
 * @minItems 0
 */
write_owners: {
owner_id: Ulid
invoice_id: Ulid
epoch: number
}[]
catalog: {
catalog_version: string
snapshot_sha256: Sha256Hex
snapshot: {
/**
 * @minItems 0
 */
items: {
id: Ulid
reference: string
category_code: string
name: string
unit_code: string
quantity_integer_only: boolean
sale_price: MoneyXaf
tax_rule_id: NullableUlid
stock_mode: string
requires_expiry: boolean
active: boolean
version: number
}[]
/**
 * @minItems 0
 */
tax_rules: {
id: Ulid
code: string
rate_percent: (string | null)
active: boolean
validated_at: (string | null)
version: number
}[]
}
}
rules_version: string
server_time: Instant
last_accepted_sequence: Counter
last_accepted_hash: NullableSha256Hex
}
export interface PreparationResponse {
data: Preparation
}
export interface Release {
device_id: Ulid
/**
 * @minItems 0
 */
closed_number_allocations: Ulid[]
/**
 * @minItems 0
 */
returned_stock_allocations: Ulid[]
/**
 * @minItems 0
 */
closed_write_owners: Ulid[]
released_at: Instant
}
export interface ReleaseResponse {
data: Release
}
/**
 * Remplacement d'un poste (O07) : ancien poste REPLACED, ses grants révoqués (aucun droit transféré), ses plages, quotas et propriétés passés CLOSING jusqu'à la reprise de son journal exporté.
 */
export interface Replacement {
device_id: Ulid
replacement_device_id: Ulid
status: "REPLACED"
revoked_grants: number
/**
 * @minItems 0
 */
closing_number_allocations: Ulid[]
/**
 * @minItems 0
 */
closing_stock_allocations: Ulid[]
/**
 * @minItems 0
 */
closing_write_owners: Ulid[]
replaced_at: Instant
}
export interface ReplacementResponse {
data: Replacement
}
/**
 * Déclaration de compatibilité de la release du serveur (O06), telle que publiée dans contracts/compatibility.json.
 */
export interface CompatibilityResponse {
data: CompatibilityDeclaration
}
export interface DeviceHealth {
device_id: Ulid
status: EnrolledDevicesStatus
last_sync_at: NullableInstant
last_accepted_sequence: Counter
last_accepted_hash: NullableSha256Hex
pending_conflicts: number
app_version: string
grants_valid_until: NullableInstant
/**
 * @minItems 0
 */
number_ranges_low: Ulid[]
}
export interface DeviceHealthResponse {
data: DeviceHealth
}
/**
 * Conflit de synchronisation : les instantanés chiffrés restent côté serveur ; seuls les profils autorisés les déchiffrent.
 */
export interface Conflict {
id: Ulid
command_id: Ulid
conflict_type: string
status: SyncConflictsStatus
device_id: Ulid
created_at: Instant
resolution: (string | null)
resolved_by: NullableUlid
resolved_at: NullableInstant
command_name: string
device_sequence: Counter
device_name: string
actor_name: string
reason: (string | null)
decision: (("ACCEPT_LOCAL" | "KEEP_CENTRAL" | "REJECT" | "CORRECT") | null)
resolved_by_name: (string | null)
}
export interface ConflictPage {
/**
 * @minItems 0
 */
data: Conflict[]
meta: Pagination
}
export interface ConflictResponse {
data: Conflict
}
export interface GeneratedDocument {
id: Ulid
document_type: GeneratedDocumentsDocumentType
source_key: string
revision_no: number
template_version: string
status: GeneratedDocumentsStatus
sha256: NullableSha256Hex
generated_at: NullableInstant
failure_code: (string | null)
}
export interface GeneratedDocumentResponse {
data: GeneratedDocument
}
export interface ExportRequest {
id: Ulid
export_type: ExportRequestsExportType
patient_id: NullableUlid
filters: ({

} | null)
status: ExportRequestsStatus
requested_by: Ulid
completed_at: NullableInstant
expires_at: NullableInstant
error_code: (string | null)
}
export interface ExportRequestResponse {
data: ExportRequest
}
export interface ExportRequestList {
/**
 * @minItems 0
 */
data: ExportRequest[]
}
/**
 * Gérante : chiffre d'affaires émis et encaissé distincts ; créances d'ouverture papier séparées ; postes non synchronisés signalés (totaux incomplets).
 */
export interface FinancialReport {
from: CivilDate
to: CivilDate
issued_total: MoneyXaf
collected_total: MoneyXaf
credited_total: MoneyXaf
refunded_total: MoneyXaf
outstanding_total: SignedMoneyXaf
/**
 * @minItems 0
 */
collected_by_method: {
method: PaymentsMethod
amount: MoneyXaf
}[]
legacy_opening_balances: MoneyXaf
/**
 * @minItems 0
 */
incomplete_devices: {
device_id: Ulid
last_sync_at: NullableInstant
}[]
}
export interface FinancialReportResponse {
data: FinancialReport
}
/**
 * Événement du journal append-only (lecture gérante, audit.read) ; aucun secret dans le diff.
 */
export interface AuditEvent {
id: Ulid
actor_id: NullableUlid
actor_name_snapshot: string
action: string
target_type: string
target_id: NullableUlid
recorded_at: Instant
correlation_id: string
reason: (string | null)
sanitized_diff: ({

} | null)
event_hash: Sha256Hex
}
export interface AuditEventPage {
/**
 * @minItems 0
 */
data: AuditEvent[]
meta: Pagination
}
/**
 * Résultat de recherche : identité administrative minimale (tous profils autorisés).
 */
export interface PatientSummary {
id: Ulid
record_number: string
last_name: string
first_names: (string | null)
sex: PatientRecordsSex
birth_date: NullableCivilDate
phone_primary: (Phone | null)
archived: boolean
merged_into_patient_id: NullableUlid
version: Version
}
/**
 * Dossier administratif (identité durable) ; jamais de donnée clinique. merged_records (lecture GET /patients/{id} seulement) : fiches fusionnées dans celle-ci (L1D08), de la plus ancienne fusion à la plus récente.
 */
export interface Patient {
id: Ulid
record_number: string
last_name: string
first_names: (string | null)
sex: PatientRecordsSex
birth_date: NullableCivilDate
phone_primary: (Phone | null)
archived: boolean
merged_into_patient_id: NullableUlid
version: Version
birth_date_missing_reason: (string | null)
phone_secondary: (Phone | null)
phone_missing_reason: (string | null)
address: (string | null)
profession: (string | null)
guardian_contact: ({

} | null)
legacy_record: boolean
first_known_visit_on: NullableCivilDate
first_visit_certified: boolean
legacy_record_number: (string | null)
created_at: Instant
updated_at: Instant
/**
 * @minItems 0
 */
merged_records?: {
patient_id: Ulid
record_number: string
merged_at: Instant
}[]
}
/**
 * Historique : visites pour tout profil autorisé ; consultations seulement avec clinical.read ; pièces seulement avec invoice.read.
 */
export interface PatientHistory {
patient_id: Ulid
/**
 * @minItems 0
 */
visits: {
id: Ulid
reason: VisitsReason
occurred_at: Instant
status: VisitsStatus
}[]
/**
 * @minItems 0
 */
consultations?: {
id: Ulid
visit_id: Ulid
effective_at: Instant
status: ConsultationsStatus
current_revision: number
clinician_id: Ulid
}[]
/**
 * @minItems 0
 */
invoices?: {
id: Ulid
number: (string | null)
status: InvoicesStatus
issued_at: NullableInstant
total_gross: MoneyXaf
balance_due: SignedMoneyXaf
}[]
}
export interface PatientResponse {
data: Patient
}
export interface PatientPage {
/**
 * @minItems 0
 */
data: PatientSummary[]
meta: Pagination
}
export interface PatientHistoryResponse {
data: PatientHistory
}
/**
 * Visite : l’identité de base du patient accompagne la visite (file du jour). exam_fee_control, contrôle inactif (EEO_EXAM_FEE_CONTROL=off, défaut) : NOT_CONTROLLED pour un motif d’examen ou de suivi, NOT_APPLICABLE pour un achat ou un retrait ; contrôle actif (billed) : UNPAID (frais d’examen à encaisser), WAIVER_REQUESTED (dispense demandée, en attente de la gérante), PAID (facture de frais de CETTE visite réglée ; exam_fee_receipt_number = numéro de son dernier reçu), WAIVED (dispense accordée ou consommée), NOT_APPLICABLE. Jamais « payé » ni « gratuit » sans pièce : PAID s’appuie sur des reçus réels. Contrôle actif, le statut AWAITING_EXAM_FEE / READY_FOR_EXAM est celui du contrôle à l’instant (une dispense échue ramène « en attente »). consultation_id et consultation_status : la consultation de la visite, rendus SEULEMENT à un compte qui détient clinical.read (null sinon, y compris quand la consultation existe) ; null aussi quand l’examen n’est pas démarré.
 */
export interface Visit {
id: Ulid
patient_id: Ulid
reason: VisitsReason
occurred_at: Instant
status: VisitsStatus
appointment_id: NullableUlid
exam_invoice_id: NullableUlid
exam_waiver_approval_id: NullableUlid
arrival_at: NullableInstant
closed_at: NullableInstant
administrative_note: (string | null)
version: Version
patient: VisitPatient
exam_fee_control: ("NOT_CONTROLLED" | "NOT_APPLICABLE" | "UNPAID" | "WAIVER_REQUESTED" | "PAID" | "WAIVED")
exam_fee_receipt_number?: (string | null)
consultation_id: NullableUlid
consultation_status: (ConsultationsStatus | null)
}
/**
 * Identité administrative de base du patient d’une visite.
 */
export interface VisitPatient {
id: Ulid
record_number: string
last_name: string
first_names: (string | null)
sex: PatientRecordsSex
birth_date: NullableCivilDate
}
export interface VisitResponse {
data: Visit
}
export interface VisitPage {
/**
 * @minItems 0
 */
data: Visit[]
meta: Pagination
}
/**
 * Identité administrative comparée avant une fusion (L1D08) : jamais de donnée clinique.
 */
export interface PatientMergeIdentity {
id: Ulid
record_number: string
last_name: string
first_names: (string | null)
sex: PatientRecordsSex
birth_date: NullableCivilDate
phone_primary: (Phone | null)
archived: boolean
merged_into_patient_id: NullableUlid
version: Version
legacy_record_number: (string | null)
created_at: Instant
}
/**
 * Aperçu d'une fusion : les deux identités côte à côte, ce qui est rattaché à la fiche absorbée (visites pour tout compte autorisé ; consultations et prescriptions seulement avec clinical.read, pièces émises seulement avec invoice.read, null sinon) et les garde-fous qui empêchent la fusion.
 */
export interface PatientMergePreview {
source: PatientMergeIdentity
survivor: PatientMergeIdentity
linked: {
visits: number
appointments_upcoming: number
consultations: (number | null)
prescriptions: (number | null)
invoices: (number | null)
}
/**
 * @minItems 0
 */
blockers: {
code: ("SOURCE_ALREADY_MERGED" | "SURVIVOR_MERGED" | "SURVIVOR_ARCHIVED" | "VISIT_IN_PROGRESS" | "CONSULTATION_IN_PROGRESS" | "INVOICE_DRAFT" | "APPOINTMENT_UPCOMING")
message: string
}[]
can_merge: boolean
}
export interface PatientMergePreviewResponse {
data: PatientMergePreview
}
/**
 * Fusion enregistrée (patient_merges, immuable) : la fiche absorbée garde son identifiant, son numéro et son historique ; elle pointe vers la fiche conservée.
 */
export interface PatientMerge {
id: Ulid
source_patient_id: Ulid
survivor_patient_id: Ulid
approved_by: Ulid
merged_at: Instant
reason: string
source_version: Version
}
export interface PatientMergeResponse {
data: PatientMerge
}
/**
 * Visite (section VISITS, patient.read) : motif et statut administratifs ; occurred_at = heure de la visite.
 */
export interface PatientActivityVisit {
type: "VISIT"
id: Ulid
occurred_at: Instant
screen_path: (string | null)
reason: VisitsReason
status: VisitsStatus
}
/**
 * Examen (section EXAMS, clinical.read) : date effective, état et professionnel ; aucun contenu clinique.
 */
export interface PatientActivityConsultation {
type: "CONSULTATION"
id: Ulid
occurred_at: Instant
screen_path: (string | null)
status: ConsultationsStatus
clinician_name: string
}
/**
 * Prescription optique, une entrée par version (section PRESCRIPTIONS, clinical.read) : origine, état et numéro de version ; occurred_at = validation, sinon création. Aucune valeur de correction.
 */
export interface PatientActivityPrescription {
type: "PRESCRIPTION"
id: Ulid
occurred_at: Instant
screen_path: (string | null)
origin: OpticalPrescriptionsOrigin
status: OpticalPrescriptionsStatus
version_no: number
consultation_id: NullableUlid
external_prescribed_on: NullableCivilDate
}
/**
 * Ordonnance de médicaments d'une consultation (section PRESCRIPTIONS, clinical.read) : id = consultation_id (ni table ni numéro propres) ; aucun nom de médicament.
 */
export interface PatientActivityMedicationOrder {
type: "MEDICATION_ORDER"
id: Ulid
occurred_at: Instant
screen_path: (string | null)
consultation_id: Ulid
consultation_status: ConsultationsStatus
}
/**
 * Facture émise (section FINANCIAL, invoice.read) : solde projeté par vw_invoice_balances, jamais un statut payé stocké ; SETTLED = solde nul (encaissements ou avoirs).
 */
export interface PatientActivityInvoice {
type: "INVOICE"
id: Ulid
occurred_at: Instant
screen_path: (string | null)
number: string
origin: InvoicesOrigin
total_gross: MoneyXaf
paid_net: MoneyXaf
balance_due: SignedMoneyXaf
credit_available: MoneyXaf
settlement: ("UNPAID" | "PARTIALLY_PAID" | "SETTLED" | "IN_CREDIT")
}
/**
 * Reçu d'un encaissement confirmé (section FINANCIAL, invoice.read) : reversed_amount = contre-écritures du paiement ; le reçu reste, immuable.
 */
export interface PatientActivityReceipt {
type: "RECEIPT"
id: Ulid
occurred_at: Instant
screen_path: (string | null)
number: string
amount: PositiveMoneyXaf
method: PaymentsMethod
reversed_amount: MoneyXaf
invoice_id: Ulid
invoice_number: (string | null)
}
/**
 * Avoir émis (section FINANCIAL, invoice.read).
 */
export interface PatientActivityCreditNote {
type: "CREDIT_NOTE"
id: Ulid
occurred_at: Instant
screen_path: (string | null)
number: string
amount_gross: PositiveMoneyXaf
invoice_id: Ulid
invoice_number: (string | null)
}
/**
 * Remboursement exécuté (section FINANCIAL, invoice.read).
 */
export interface PatientActivityRefund {
type: "REFUND"
id: Ulid
occurred_at: Instant
screen_path: (string | null)
number: string
amount: PositiveMoneyXaf
method: RefundsMethod
invoice_id: Ulid
invoice_number: (string | null)
}
export interface PatientActivitySection {
section: ("VISITS" | "EXAMS" | "PRESCRIPTIONS" | "FINANCIAL")
total: number
}
/**
 * Pagination (25 par page) ; section = filtre appliqué (null : toutes les sections visibles) ; sections = sections VISIBLES du compte et leur nombre d'éléments, aucune autre.
 */
export interface PatientActivityMeta {
current_page: number
last_page: number
per_page: 25
total: number
section: (("VISITS" | "EXAMS" | "PRESCRIPTIONS" | "FINANCIAL") | null)
/**
 * @minItems 0
 */
sections: PatientActivitySection[]
}
/**
 * Activité du patient, du plus récent au plus ancien. Visites pour patient.read ; examens et ordonnances seulement avec clinical.read (module consultations) ; pièces financières seulement avec invoice.read (module sales). Brouillons et pièces abandonnées exclus.
 */
export interface PatientActivity {
/**
 * @minItems 0
 * @maxItems 25
 */
data: PatientActivityItem[]
meta: PatientActivityMeta
}
export interface PublicService {
id: Ulid
name: string
duration_minutes: number
}
export interface PublicServiceList {
/**
 * @minItems 0
 */
data: PublicService[]
}
export interface PublicSlot {
service_id: Ulid
resource_id: Ulid
starts_at: Instant
ends_at: Instant
}
export interface PublicSlotList {
/**
 * @minItems 0
 */
data: PublicSlot[]
}
/**
 * Référence publique distincte des identifiants internes ; ne révèle jamais l'existence d'un dossier.
 */
export interface BookingReceipt {
public_reference: string
status: ("RECEIVED" | "PENDING_CONFIRMATION")
}
export interface BookingReceiptResponse {
data: BookingReceipt
}
/**
 * Identité administrative minimale du patient d'un rendez-vous, d'un suivi ou d'une tâche.
 */
export interface SchedulingPatient {
id: Ulid
record_number: string
last_name: string
first_names: (string | null)
}
/**
 * Créneau hebdomadaire d'une ressource (1 = lundi … 7 = dimanche), heure locale du cabinet.
 */
export interface OpeningHour {
id: Ulid
weekday: number
opens_at: LocalTime
closes_at: LocalTime
valid_from: NullableCivilDate
valid_to: NullableCivilDate
}
/**
 * Professionnel ou salle réservable ; aucun horaire n'est inventé : sans créneau hebdomadaire, aucun rendez-vous n'est proposé.
 */
export interface SchedulingResource {
id: Ulid
name: string
professional_user_id: NullableUlid
professional_name: (string | null)
active: boolean
slot_duration_minutes: number
version: Version
/**
 * @minItems 0
 */
opening_hours: OpeningHour[]
}
export interface SchedulingResourceResponse {
data: SchedulingResource
}
export interface AppointmentService {
id: Ulid
name: string
duration_minutes: number
active: boolean
version: Version
}
export interface AppointmentServiceResponse {
data: AppointmentService
}
/**
 * Fermeture (is_available = false) ou ouverture exceptionnelle datée d'une ressource.
 */
export interface ResourceException {
id: Ulid
resource_id: Ulid
starts_at: Instant
ends_at: Instant
is_available: boolean
reason: string
}
export interface ResourceExceptionResponse {
data: ResourceException
}
/**
 * Configuration de l'agenda (S01) : ressources, prestations, exceptions à venir (90 jours).
 */
export interface AgendaConfiguration {
/**
 * @minItems 0
 */
resources: SchedulingResource[]
/**
 * @minItems 0
 */
services: AppointmentService[]
/**
 * @minItems 0
 */
exceptions: ResourceException[]
}
export interface AgendaConfigurationResponse {
data: AgendaConfiguration
}
/**
 * Créneaux libres d'un jour civil du cabinet pour une ressource et une prestation, lus SOUS l'état du serveur au moment de la lecture : la réservation revérifie sous verrou.
 */
export interface AvailableSlots {
date: CivilDate
resource_id: Ulid
service_id: Ulid
duration_minutes: number
/**
 * @minItems 0
 */
slots: {
starts_at: Instant
ends_at: Instant
}[]
}
export interface AvailableSlotsResponse {
data: AvailableSlots
}
/**
 * Contrôle recommandé (S02), jamais une réservation implicite. reason, manual_reason et notes valent null pour un compte sans clinical.read (cloisonnement clinique) ; la date et l'identité restent lisibles par l'agenda.
 */
export interface FollowUpPlan {
id: Ulid
consultation_id: Ulid
patient_id: Ulid
patient: SchedulingPatient
reason: (FollowUpPlansReason | null)
anchor_kind: FollowUpPlansAnchorKind
anchor_date: CivilDate
interval_value: (number | null)
interval_unit: (FollowUpPlansIntervalUnit | null)
recommended_date: CivilDate
date_origin: FollowUpPlansDateOrigin
manual_reason: (string | null)
reminder_enabled: boolean
preferred_channel: FollowUpPlansPreferredChannel
advance_value: (number | null)
advance_unit: (FollowUpPlansAdvanceUnit | null)
reminder_date: NullableCivilDate
notes: (string | null)
status: FollowUpPlansStatus
appointment_id: NullableUlid
version: Version
}
export interface FollowUpPlanResponse {
data: FollowUpPlan
}
export interface FollowUpPlanList {
/**
 * @minItems 0
 */
data: FollowUpPlan[]
}
/**
 * Rendez-vous ; un rendez-vous pris hors-ligne reste PENDING_CONFIRMATION jusqu'à validation serveur. visit_id : arrivée enregistrée pour ce rendez-vous, s'il y en a une.
 */
export interface Appointment {
id: Ulid
patient_id: NullableUlid
patient: (SchedulingPatient | null)
prospect_contact_id: NullableUlid
follow_up_id: NullableUlid
resource_id: Ulid
resource_name: string
service_id: Ulid
service_name: string
starts_at: Instant
ends_at: Instant
status: AppointmentsStatus
source: AppointmentsSource
administrative_reason: (string | null)
cancel_reason: (string | null)
visit_id: NullableUlid
version: Version
}
export interface AppointmentResponse {
data: Appointment
}
/**
 * Rendez-vous d'une période de jours civils du cabinet (31 jours au plus), du plus tôt au plus tard.
 */
export interface AppointmentList {
/**
 * @minItems 0
 */
data: Appointment[]
}
export interface ContactAttempt {
id: Ulid
occurred_at: Instant
result: ContactAttemptsResult
actor_name: (string | null)
administrative_note: (string | null)
}
/**
 * Tâche de contact INTERNE (L0 : aucun envoi SMS/WhatsApp réel ; le canal est la préférence du patient). Unique par source et échéance (dedupe_key) : jamais deux relances pour le même événement.
 */
export interface ContactTask {
id: Ulid
patient_id: NullableUlid
patient: (SchedulingPatient | null)
prospect_contact_id: NullableUlid
follow_up_id: NullableUlid
appointment_id: NullableUlid
invoice_id: NullableUlid
source_type: ("FOLLOW_UP" | "APPOINTMENT" | "INVOICE" | "WORKSHOP_ORDER")
source_date: NullableCivilDate
source_starts_at: NullableInstant
due_at: Instant
channel: ContactTasksChannel
status: ContactTasksStatus
next_attempt_at: NullableInstant
assigned_to: NullableUlid
administrative_notes: (string | null)
/**
 * @minItems 0
 */
attempts: ContactAttempt[]
version: Version
}
export interface ContactTaskPage {
/**
 * @minItems 0
 */
data: ContactTask[]
meta: Pagination
}
/**
 * Tâches de contact d'un jour civil du cabinet (échéance ou nouvelle tentative ce jour-là, ou en retard et encore ouvertes).
 */
export interface ContactTaskList {
/**
 * @minItems 0
 */
data: ContactTask[]
}
export interface ContactAttemptResult {
attempt_id: Ulid
task: ContactTask
}
export interface ContactAttemptResultResponse {
data: ContactAttemptResult
}
/**
 * Activité administrative (R02, statistics.activity) sur une période de jours civils du cabinet : visites non annulées, patients distincts, nouveaux (première visite connue au cabinet dans la période, reprise historique comprise) et anciens, sexe et tranches d'âge des patients de la période (âge au dernier jour de la période). Comptages seulement, aucune donnée clinique ni financière. appointments et follow_ups_due valent null tant que l'agenda (S01, S02) n'est pas livré.
 */
export interface ActivityReport {
from: CivilDate
to: CivilDate
timezone: string
visits: number
/**
 * @minItems 0
 */
visits_by_reason: {
reason: VisitsReason
count: number
}[]
patients: number
new_patients: number
returning_patients: number
/**
 * @minItems 0
 */
sex: {
sex: PatientRecordsSex
count: number
}[]
/**
 * @minItems 0
 */
age_bands: {
min_age: number
max_age: (number | null)
count: number
}[]
age_unknown: number
appointments: (number | null)
follow_ups_due: (number | null)
}
export interface ActivityReportResponse {
data: ActivityReport
}
/**
 * Statistiques cliniques agrégées (R02, statistics.clinical) des consultations dont la date effective tombe dans la période : nombre de consultations, par motif (une consultation compte une fois par motif), prescriptions optiques validées, ordonnances de médicaments, orientations par niveau d'urgence, amétropies. Comptages seulement, aucun patient identifiable, aucune agrégation de mesures (jamais d'acuités d'échelles différentes).
 */
export interface ClinicalReport {
from: CivilDate
to: CivilDate
timezone: string
consultations: number
consultations_completed: number
/**
 * @minItems 0
 */
complaints: {
term_code: Code
count: number
}[]
consultations_without_complaint: number
prescriptions_validated: number
medication_orders: number
referrals: number
/**
 * @minItems 0
 */
referrals_by_urgency: {
urgency: (ConsultationsReferralUrgency | null)
count: number
}[]
referral_unknown: number
/**
 * @minItems 0
 */
ametropias: {
term_code: Code
count: number
}[]
}
export interface ClinicalReportResponse {
data: ClinicalReport
}
/**
 * Disponible central = physique − réservations centrales − quotas locaux non consommés (fichier 19).
 */
export interface StockAvailability {
item_id: Ulid
location_id: Ulid
stock_position_id: Ulid
/**
 * DECIMAL(12,3) en chaîne exacte, zéro admis.
 */
on_hand: string
/**
 * DECIMAL(12,3) en chaîne exacte, zéro admis.
 */
reserved: string
/**
 * DECIMAL(12,3) en chaîne exacte, zéro admis.
 */
offline_allocated: string
/**
 * DECIMAL(12,3) en chaîne exacte, zéro admis.
 */
central_available: string
/**
 * @minItems 0
 */
lots: {
lot_id: Ulid
batch_number: string
expires_on: NullableCivilDate
status: StockLotsStatus
/**
 * DECIMAL(12,3) en chaîne exacte, zéro admis.
 */
on_hand: string
/**
 * DECIMAL(12,3) en chaîne exacte, zéro admis.
 */
reserved: string
/**
 * DECIMAL(12,3) en chaîne exacte, zéro admis.
 */
offline_allocated: string
}[]
}
export interface StockAvailabilityPage {
/**
 * @minItems 0
 */
data: StockAvailability[]
meta: Pagination
}
/**
 * Emplacement de stock (rayon, atelier, réserve) ; PRINCIPAL créé par eeo:sales:bootstrap.
 */
export interface StockLocation {
id: Ulid
code: string
name: string
active: boolean
}
export interface StockLocationList {
/**
 * @minItems 0
 */
data: StockLocation[]
}
export interface StockMovement {
id: Ulid
item_id: Ulid
position_id: Ulid
lot_id: NullableUlid
kind: StockMovementsKind
/**
 * DECIMAL(12,3) en chaîne exacte, zéro admis.
 */
signed_quantity: string
occurred_at: Instant
reason: string
approval_id: NullableUlid
}
export interface StockMovementResponse {
data: StockMovement
}
export interface OpeningStockResult {
/**
 * @minItems 1
 */
movements: [StockMovement, ...(StockMovement)[]]
}
export interface OpeningStockResponse {
data: OpeningStockResult
}
export interface PhysicalReturn {
id: Ulid
delivery_line_id: Ulid
item_id: Ulid
quantity: Quantity
condition_code: PhysicalReturnsConditionCode
accepted_for_restock: boolean
occurred_at: Instant
stock_movement_id: NullableUlid
credit_note_id: NullableUlid
}
export interface PhysicalReturnResponse {
data: PhysicalReturn
}
export interface RuleVectors {
/**
 * Version des règles (contracts/compatibility.json, rules_versions).
 */
rules_version: string
description: string
/**
 * @minItems 1
 */
cases: [VectorCase, ...(VectorCase)[]]
}
export interface VectorRefusal {
/**
 * Code d'erreur du fichier 08 (sous-ensemble de error.json#/$defs/ErrorCode).
 */
code: ("VALIDATION_FAILED" | "PAYMENT_EXCEEDS_BALANCE" | "STOCK_UNAVAILABLE" | "LOT_EXPIRED")
field: string
rule: string
details?: {
[k: string]: string | number | null | undefined
}
}
export interface Ack {
command_id: Ulid
device_sequence: Counter
status: ("ACCEPTED" | "ALREADY_ACCEPTED" | "WAITING_DEPENDENCY" | "CONFLICT_REQUIRES_REVIEW" | "REJECTED")
/**
 * Identifiants d'origine des effets appliqués (ex. invoice_id, payment_id, receipt_id), identiques à ceux du poste.
 */
result_references: {
[k: string]: Ulid | undefined
}
versions: {
draft_version?: Version
ledger_version?: Version
entity_version?: Version
}
/**
 * Dépendances manquantes accessibles (WAITING_DEPENDENCY), sinon liste vide.
 */
dependencies: {
entity_type: string
entity_id: Ulid
}[]
conflict_id: NullableUlid
error_code: (ErrorCode | null)
reason: (string | null)
}
export interface CommandCore {
command_id: Ulid
command_name: CommandName
device_id: Ulid
actor_id: Ulid
grant_id: Ulid
clinic_id: Ulid
/**
 * Rang strictement croissant dans le journal unique du poste (premier = "1").
 */
device_sequence: Counter
previous_event_hash: NullableSha256Hex
/**
 * Version du schéma de la charge (contracts/commands/<Commande>.v<N>.json), en chaîne de chiffres comme la colonne sync_commands.schema_version : le cœur est reconstitué à l'identique pour recalculer event_hash.
 */
schema_version: string
/**
 * Version des règles métier appliquées localement (compatibility.json).
 */
rules_version: string
occurred_at_local: Instant
last_server_time: Instant
/**
 * Agrégat principal visé (nom de table du catalogue).
 */
entity_type: string
entity_id: Ulid
/**
 * Version brouillon (UpdateDraft/IssueInvoice) ou ledger_version (RegisterPayment/ReversePayment/IssueCreditNote/RefundCredit) ; null pour une création.
 */
expected_version: (Version | null)
number_allocation_id: NullableUlid
/**
 * Quotas device_stock_allocations utilisés, triés, sans doublon (liste vide si aucun).
 * 
 * @maxItems 100
 */
stock_allocation_ids: Ulid[]
/**
 * Charge métier validée par contracts/commands/<command_name>.v<schema_version>.json (dispatch.json).
 */
payload: {

}
}
export interface PullPage {
/**
 * @maxItems 100
 */
changes: Change[]
/**
 * Curseur opaque signé (borne supérieure incluse) ; à renvoyer tel quel.
 */
next_cursor: string
has_more: boolean
server_time: Instant
}
export interface Change {
change_sequence: Counter
entity_type: string
entity_id: Ulid
entity_version: Version
change_kind: SyncChangeLogChangeKind
visibility: SyncChangeLogVisibility
recorded_at: Instant
/**
 * Projection autorisée de l'entité pour ce profil (jamais une donnée d'un compartiment non autorisé).
 */
data: {

}
}
export interface PushRequest {
device_id: Ulid
/**
 * @minItems 1
 * @maxItems 50
 */
commands: [SignedCommand, ...(SignedCommand)[]]
}
export interface SignedCommand {
core: CommandCore
event_hash: Sha256Hex
signature: CompactJws
}
export interface PushResponse {
results: Ack[]
finalized_prefix: {
last_sequence: Counter
last_hash: NullableSha256Hex
}
server_time: Instant
}
/**
 * En-tête protégé du JWS : algorithme et type imposés, kid de la clé d'appareil enrôlée.
 */
export interface JwsProtectedHeader {
alg: "ES256"
typ: "eeo-command+jws"
/**
 * Empreinte RFC 7638 (base64url du SHA-256 de {crv, kty, x, y}) de la clé publique ENRÔLÉE du poste : même règle que la preuve de possession (O02). Alignement O05 : le contrat déclarait un ULID.
 */
kid: string
}
/**
 * Charge signée : la signature porte sur l'identité de la commande, le poste et event_hash (pas sur le cœur entier, déjà lié par le hash).
 */
export interface JwsPayload {
command_id: Ulid
device_id: Ulid
event_hash: Sha256Hex
}
export interface AmendConsultationPayload {
consultation_id: Ulid
revision_id: Ulid
revision_no: number
previous_revision_id: Ulid
reason: Reason
/**
 * @minItems 1
 * @maxItems 7
 */
steps: [{
step: StepName
data: {

}
}]|[{
step: StepName
data: {

}
}, {
step: StepName
data: {

}
}]|[{
step: StepName
data: {

}
}, {
step: StepName
data: {

}
}, {
step: StepName
data: {

}
}]|[{
step: StepName
data: {

}
}, {
step: StepName
data: {

}
}, {
step: StepName
data: {

}
}, {
step: StepName
data: {

}
}]|[{
step: StepName
data: {

}
}, {
step: StepName
data: {

}
}, {
step: StepName
data: {

}
}, {
step: StepName
data: {

}
}, {
step: StepName
data: {

}
}]|[{
step: StepName
data: {

}
}, {
step: StepName
data: {

}
}, {
step: StepName
data: {

}
}, {
step: StepName
data: {

}
}, {
step: StepName
data: {

}
}, {
step: StepName
data: {

}
}]|[{
step: StepName
data: {

}
}, {
step: StepName
data: {

}
}, {
step: StepName
data: {

}
}, {
step: StepName
data: {

}
}, {
step: StepName
data: {

}
}, {
step: StepName
data: {

}
}, {
step: StepName
data: {

}
}]
snapshot_sha256: Sha256Hex
}
/**
 * Corps de la route directe POST /consultations/{id}/amendments : même charge + expected_version (Version de l'agrégat (colonne version).) ; en-tête Idempotency-Key obligatoire.
 */
export interface AmendConsultationDirectRequest {
expected_version: Version
consultation_id: Ulid
revision_id: Ulid
revision_no: number
previous_revision_id: Ulid
reason: Reason
/**
 * @minItems 1
 * @maxItems 7
 */
steps: [{
step: StepName
data: {

}
}]|[{
step: StepName
data: {

}
}, {
step: StepName
data: {

}
}]|[{
step: StepName
data: {

}
}, {
step: StepName
data: {

}
}, {
step: StepName
data: {

}
}]|[{
step: StepName
data: {

}
}, {
step: StepName
data: {

}
}, {
step: StepName
data: {

}
}, {
step: StepName
data: {

}
}]|[{
step: StepName
data: {

}
}, {
step: StepName
data: {

}
}, {
step: StepName
data: {

}
}, {
step: StepName
data: {

}
}, {
step: StepName
data: {

}
}]|[{
step: StepName
data: {

}
}, {
step: StepName
data: {

}
}, {
step: StepName
data: {

}
}, {
step: StepName
data: {

}
}, {
step: StepName
data: {

}
}, {
step: StepName
data: {

}
}]|[{
step: StepName
data: {

}
}, {
step: StepName
data: {

}
}, {
step: StepName
data: {

}
}, {
step: StepName
data: {

}
}, {
step: StepName
data: {

}
}, {
step: StepName
data: {

}
}, {
step: StepName
data: {

}
}]
snapshot_sha256: Sha256Hex
}
export interface CloseCashSessionPayload {
cash_session_id: Ulid
closed_at: Instant
counted_amount: MoneyXaf
expected_amount: MoneyXaf
variance: SignedMoneyXaf
variance_reason: (string | null)
}
/**
 * Corps de la route directe POST /cash-sessions/{id}/close : même charge + expected_version (Transition d'état contrôlée sous verrou (statut attendu vérifié par le serveur) ; la table n'a pas de colonne version, que le contrat 23 interdit d'inventer : expected_version vaut null.) ; en-tête Idempotency-Key obligatoire.
 */
export interface CloseCashSessionDirectRequest {
expected_version: null
cash_session_id: Ulid
closed_at: Instant
counted_amount: MoneyXaf
expected_amount: MoneyXaf
variance: SignedMoneyXaf
variance_reason: (string | null)
}
export interface CompleteConsultationPayload {
consultation_id: Ulid
revision_id: Ulid
revision_no: number
snapshot_sha256: Sha256Hex
finalization_missing_data_reason: (string | null)
}
/**
 * Corps de la route directe POST /consultations/{id}/complete : même charge + expected_version (Version de l'agrégat (colonne version).) ; en-tête Idempotency-Key obligatoire.
 */
export interface CompleteConsultationDirectRequest {
expected_version: Version
consultation_id: Ulid
revision_id: Ulid
revision_no: number
snapshot_sha256: Sha256Hex
finalization_missing_data_reason: (string | null)
}
export interface ConfirmDeliveryPayload {
delivery_id: Ulid
invoice_id: Ulid
delivered_at: Instant
credit_delivery_approval_id: NullableUlid
/**
 * @minItems 1
 * @maxItems 200
 */
lines: [{
delivery_line_id: Ulid
invoice_line_id: Ulid
item_id: Ulid
quantity: Quantity
stock_position_id: NullableUlid
stock_lot_id: NullableUlid
reservation_id: NullableUlid
stock_movement_id: NullableUlid
}, ...({
delivery_line_id: Ulid
invoice_line_id: Ulid
item_id: Ulid
quantity: Quantity
stock_position_id: NullableUlid
stock_lot_id: NullableUlid
reservation_id: NullableUlid
stock_movement_id: NullableUlid
})[]]
}
/**
 * Corps de la route directe POST /invoices/{id}/deliveries : même charge + expected_version (Création : expected_version vaut null.) ; en-tête Idempotency-Key obligatoire.
 */
export interface ConfirmDeliveryDirectRequest {
expected_version: null
delivery_id: Ulid
invoice_id: Ulid
delivered_at: Instant
credit_delivery_approval_id: NullableUlid
/**
 * @minItems 1
 * @maxItems 200
 */
lines: [{
delivery_line_id: Ulid
invoice_line_id: Ulid
item_id: Ulid
quantity: Quantity
stock_position_id: NullableUlid
stock_lot_id: NullableUlid
reservation_id: NullableUlid
stock_movement_id: NullableUlid
}, ...({
delivery_line_id: Ulid
invoice_line_id: Ulid
item_id: Ulid
quantity: Quantity
stock_position_id: NullableUlid
stock_lot_id: NullableUlid
reservation_id: NullableUlid
stock_movement_id: NullableUlid
})[]]
}
export interface CreateAppointmentPayload {
appointment_id: Ulid
patient_id: NullableUlid
prospect_contact_id: NullableUlid
follow_up_id: NullableUlid
resource_id: Ulid
service_id: Ulid
starts_at: Instant
ends_at: Instant
administrative_reason: (string | null)
}
/**
 * Corps de la route directe POST /appointments : même charge + expected_version (Création : expected_version vaut null.) ; en-tête Idempotency-Key obligatoire.
 */
export interface CreateAppointmentDirectRequest {
expected_version: null
appointment_id: Ulid
patient_id: NullableUlid
prospect_contact_id: NullableUlid
follow_up_id: NullableUlid
resource_id: Ulid
service_id: Ulid
starts_at: Instant
ends_at: Instant
administrative_reason: (string | null)
}
export interface CreateFollowUpPayload {
follow_up_plan_id: Ulid
consultation_id: Ulid
patient_id: Ulid
reason: FollowUpPlansReason
anchor_kind: FollowUpPlansAnchorKind
anchor_date: CivilDate
interval_value: (number | null)
interval_unit: (FollowUpPlansIntervalUnit | null)
recommended_date: CivilDate
date_origin: FollowUpPlansDateOrigin
manual_reason: (string | null)
reminder_enabled: boolean
preferred_channel: FollowUpPlansPreferredChannel
advance_value: (number | null)
advance_unit: (FollowUpPlansAdvanceUnit | null)
notes: (string | null)
}
/**
 * Corps de la route directe POST /follow-ups : même charge + expected_version (Création : expected_version vaut null.) ; en-tête Idempotency-Key obligatoire.
 */
export interface CreateFollowUpDirectRequest {
expected_version: null
follow_up_plan_id: Ulid
consultation_id: Ulid
patient_id: Ulid
reason: FollowUpPlansReason
anchor_kind: FollowUpPlansAnchorKind
anchor_date: CivilDate
interval_value: (number | null)
interval_unit: (FollowUpPlansIntervalUnit | null)
recommended_date: CivilDate
date_origin: FollowUpPlansDateOrigin
manual_reason: (string | null)
reminder_enabled: boolean
preferred_channel: FollowUpPlansPreferredChannel
advance_value: (number | null)
advance_unit: (FollowUpPlansAdvanceUnit | null)
notes: (string | null)
}
export interface CreateInvoiceDraftPayload {
invoice_id: Ulid
patient_id: Ulid
visit_id: NullableUlid
due_date: NullableCivilDate
/**
 * @minItems 0
 * @maxItems 200
 * 
 * Items: Ligne de brouillon : prix TTC unitaire, remise TTC ; total de ligne recalculé (ROUND(quantité × prix) − remise).
 */
lines: {
line_id: Ulid
position: number
catalog_item_id: NullableUlid
description: string
quantity: Quantity
unit_price_gross: MoneyXaf
discount_gross: MoneyXaf
prescription_id: NullableUlid
}[]
}
/**
 * Corps de la route directe POST /invoices : même charge + expected_version (Création : expected_version vaut null.) ; en-tête Idempotency-Key obligatoire.
 */
export interface CreateInvoiceDraftDirectRequest {
expected_version: null
invoice_id: Ulid
patient_id: Ulid
visit_id: NullableUlid
due_date: NullableCivilDate
/**
 * @minItems 0
 * @maxItems 200
 * 
 * Items: Ligne de brouillon : prix TTC unitaire, remise TTC ; total de ligne recalculé (ROUND(quantité × prix) − remise).
 */
lines: {
line_id: Ulid
position: number
catalog_item_id: NullableUlid
description: string
quantity: Quantity
unit_price_gross: MoneyXaf
discount_gross: MoneyXaf
prescription_id: NullableUlid
}[]
}
export interface CreatePatientPayload {
patient_id: Ulid
record_number_usage_id: Ulid
record_number: string
last_name: string
first_names: (string | null)
sex: PatientRecordsSex
birth_date: NullableCivilDate
birth_date_missing_reason: (string | null)
phone_primary: (Phone | null)
phone_secondary: (Phone | null)
phone_missing_reason: (string | null)
address: (string | null)
profession: (string | null)
guardian_contact: ({
name?: string
relationship?: string
phone?: string
} | null)
legacy_record: boolean
first_known_visit_on: NullableCivilDate
first_visit_certified: boolean
legacy_record_number: (string | null)
}
/**
 * Corps de la route directe POST /patients : même charge + expected_version (Création : expected_version vaut null.) ; en-tête Idempotency-Key obligatoire.
 */
export interface CreatePatientDirectRequest {
expected_version: null
patient_id: Ulid
record_number_usage_id: Ulid
/**
 * Numéro central attribué par le serveur sous verrou : null dans la requête directe.
 */
record_number: null
last_name: string
first_names: (string | null)
sex: PatientRecordsSex
birth_date: NullableCivilDate
birth_date_missing_reason: (string | null)
phone_primary: (Phone | null)
phone_secondary: (Phone | null)
phone_missing_reason: (string | null)
address: (string | null)
profession: (string | null)
guardian_contact: ({
name?: string
relationship?: string
phone?: string
} | null)
legacy_record: boolean
first_known_visit_on: NullableCivilDate
first_visit_certified: boolean
legacy_record_number: (string | null)
}
export interface CreatePrescriptionPayload {
prescription_id: Ulid
series_id: Ulid
version_no: number
supersedes_id: NullableUlid
patient_id: Ulid
origin: OpticalPrescriptionsOrigin
consultation_id: NullableUlid
external_prescriber: (string | null)
external_prescribed_on: NullableCivilDate
external_file_id: NullableUlid
usage_code: (Code | null)
usage_other: (string | null)
lens_type_code: (Code | null)
lens_type_other: (string | null)
lens_index: (string | null)
lens_index_other: (string | null)
pd_total: NullableDiopter
pd_od: NullableDiopter
pd_og: NullableDiopter
pd_inconsistency_reason: (string | null)
notes: (string | null)
/**
 * @minItems 2
 * @maxItems 2
 */
eyes: [{
id: Ulid
eye: OpticalPrescriptionEyesEye
no_correction: boolean
sphere: NullableDiopter
cylinder: NullableDiopter
axis: (number | null)
addition: NullableDiopter
fitting_height: NullableDiopter
}, {
id: Ulid
eye: OpticalPrescriptionEyesEye
no_correction: boolean
sphere: NullableDiopter
cylinder: NullableDiopter
axis: (number | null)
addition: NullableDiopter
fitting_height: NullableDiopter
}]
/**
 * @minItems 0
 * @maxItems 20
 */
treatments: []|[{
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]
}
/**
 * Corps de la route directe POST /consultations/{id}/prescriptions : même charge + expected_version (Création : expected_version vaut null.) ; en-tête Idempotency-Key obligatoire.
 */
export interface CreatePrescriptionDirectRequest {
expected_version: null
prescription_id: Ulid
series_id: Ulid
version_no: number
supersedes_id: NullableUlid
patient_id: Ulid
origin: OpticalPrescriptionsOrigin
consultation_id: NullableUlid
external_prescriber: (string | null)
external_prescribed_on: NullableCivilDate
external_file_id: NullableUlid
usage_code: (Code | null)
usage_other: (string | null)
lens_type_code: (Code | null)
lens_type_other: (string | null)
lens_index: (string | null)
lens_index_other: (string | null)
pd_total: NullableDiopter
pd_od: NullableDiopter
pd_og: NullableDiopter
pd_inconsistency_reason: (string | null)
notes: (string | null)
/**
 * @minItems 2
 * @maxItems 2
 */
eyes: [{
id: Ulid
eye: OpticalPrescriptionEyesEye
no_correction: boolean
sphere: NullableDiopter
cylinder: NullableDiopter
axis: (number | null)
addition: NullableDiopter
fitting_height: NullableDiopter
}, {
id: Ulid
eye: OpticalPrescriptionEyesEye
no_correction: boolean
sphere: NullableDiopter
cylinder: NullableDiopter
axis: (number | null)
addition: NullableDiopter
fitting_height: NullableDiopter
}]
/**
 * @minItems 0
 * @maxItems 20
 */
treatments: []|[{
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]|[{
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}, {
id: Ulid
term_code: Code
other_text: (string | null)
}]
}
export interface DecideApprovalPayload {
approval_id: Ulid
decision: ("APPROVED" | "REFUSED")
reason: (string | null)
}
/**
 * Corps de la route directe POST /approvals/{id}/decision : même charge + expected_version (Transition d'état contrôlée sous verrou (statut attendu vérifié par le serveur) ; la table n'a pas de colonne version, que le contrat 23 interdit d'inventer : expected_version vaut null.) ; en-tête Idempotency-Key obligatoire.
 */
export interface DecideApprovalDirectRequest {
expected_version: null
approval_id: Ulid
decision: ("APPROVED" | "REFUSED")
reason: (string | null)
}
export interface IssueCreditNotePayload {
invoice_id: Ulid
credit_note_id: Ulid
number_usage_id: Ulid
number: string
amount_gross: PositiveMoneyXaf
reason: Reason
approval_id: Ulid
document_id: Ulid
/**
 * @minItems 1
 * @maxItems 200
 */
lines: [{
credit_note_line_id: Ulid
invoice_line_id: Ulid
quantity: (Quantity | null)
amount_gross: PositiveMoneyXaf
reason: (string | null)
}, ...({
credit_note_line_id: Ulid
invoice_line_id: Ulid
quantity: (Quantity | null)
amount_gross: PositiveMoneyXaf
reason: (string | null)
})[]]
}
/**
 * Corps de la route directe POST /invoices/{id}/credit-notes : même charge + expected_version (ledger_version dérivée : 1 + paiements confirmés + contre-écritures + avoirs émis + remboursements (contrat 23).) ; en-tête Idempotency-Key obligatoire.
 */
export interface IssueCreditNoteDirectRequest {
expected_version: Version
invoice_id: Ulid
credit_note_id: Ulid
number_usage_id: Ulid
/**
 * Numéro central attribué par le serveur sous verrou : null dans la requête directe.
 */
number: null
amount_gross: PositiveMoneyXaf
reason: Reason
approval_id: Ulid
document_id: Ulid
/**
 * @minItems 1
 * @maxItems 200
 */
lines: [{
credit_note_line_id: Ulid
invoice_line_id: Ulid
quantity: (Quantity | null)
amount_gross: PositiveMoneyXaf
reason: (string | null)
}, ...({
credit_note_line_id: Ulid
invoice_line_id: Ulid
quantity: (Quantity | null)
amount_gross: PositiveMoneyXaf
reason: (string | null)
})[]]
}
export interface IssueInvoicePayload {
invoice_id: Ulid
number_usage_id: Ulid
number: string
issued_at: Instant
total_gross: MoneyXaf
write_owner_id: NullableUlid
catalog_snapshot_sha256: Sha256Hex
/**
 * @minItems 0
 * @maxItems 200
 * 
 * Items: Réserve créée à l'émission (I00) : une réserve sous quota local reste incluse dans le quota, jamais soustraite deux fois.
 */
reservations: {
reservation_id: Ulid
invoice_line_id: Ulid
item_id: Ulid
stock_position_id: Ulid
stock_lot_id: NullableUlid
device_allocation_id: (Ulid | null)
quantity: Quantity
}[]
document_id: Ulid
}
/**
 * Corps de la route directe POST /invoices/{id}/issue : même charge + expected_version (Version du brouillon (invoices.version), figée à l'émission.) ; en-tête Idempotency-Key obligatoire.
 */
export interface IssueInvoiceDirectRequest {
expected_version: Version
invoice_id: Ulid
number_usage_id: Ulid
/**
 * Numéro central attribué par le serveur sous verrou : null dans la requête directe.
 */
number: null
issued_at: Instant
total_gross: MoneyXaf
write_owner_id: NullableUlid
catalog_snapshot_sha256: Sha256Hex
/**
 * @minItems 0
 * @maxItems 200
 * 
 * Items: Réserve créée à l'émission (I00) : une réserve sous quota local reste incluse dans le quota, jamais soustraite deux fois.
 */
reservations: {
reservation_id: Ulid
invoice_line_id: Ulid
item_id: Ulid
stock_position_id: Ulid
stock_lot_id: NullableUlid
device_allocation_id: (Ulid | null)
quantity: Quantity
}[]
document_id: Ulid
}
export interface OpenCashSessionPayload {
cash_session_id: Ulid
cash_register_id: Ulid
opening_amount: MoneyXaf
opened_at: Instant
}
/**
 * Corps de la route directe POST /cash-sessions : même charge + expected_version (Création : expected_version vaut null.) ; en-tête Idempotency-Key obligatoire.
 */
export interface OpenCashSessionDirectRequest {
expected_version: null
cash_session_id: Ulid
cash_register_id: Ulid
opening_amount: MoneyXaf
opened_at: Instant
}
export interface RecordContactAttemptPayload {
attempt_id: Ulid
task_id: Ulid
occurred_at: Instant
result: ContactAttemptsResult
appointment_id: NullableUlid
administrative_note: (string | null)
next_status: ContactTasksStatus
next_attempt_at: NullableInstant
}
/**
 * Corps de la route directe POST /contact-tasks/{id}/attempts : même charge + expected_version (Version de l'agrégat (colonne version).) ; en-tête Idempotency-Key obligatoire.
 */
export interface RecordContactAttemptDirectRequest {
expected_version: Version
attempt_id: Ulid
task_id: Ulid
occurred_at: Instant
result: ContactAttemptsResult
appointment_id: NullableUlid
administrative_note: (string | null)
next_status: ContactTasksStatus
next_attempt_at: NullableInstant
}
export interface RefundCreditPayload {
invoice_id: Ulid
refund_id: Ulid
credit_note_id: Ulid
number_usage_id: Ulid
number: string
amount: PositiveMoneyXaf
method: RefundsMethod
reference: (string | null)
approval_id: Ulid
effective_at: Instant
cash_session_id: NullableUlid
document_id: Ulid
}
/**
 * Corps de la route directe POST /invoices/{id}/refunds : même charge + expected_version (ledger_version dérivée : 1 + paiements confirmés + contre-écritures + avoirs émis + remboursements (contrat 23).) ; en-tête Idempotency-Key obligatoire.
 */
export interface RefundCreditDirectRequest {
expected_version: Version
invoice_id: Ulid
refund_id: Ulid
credit_note_id: Ulid
number_usage_id: Ulid
/**
 * Numéro central attribué par le serveur sous verrou : null dans la requête directe.
 */
number: null
amount: PositiveMoneyXaf
method: RefundsMethod
reference: (string | null)
approval_id: Ulid
effective_at: Instant
cash_session_id: NullableUlid
document_id: Ulid
}
export interface RegisterPaymentPayload {
invoice_id: Ulid
payment_id: Ulid
receipt_id: Ulid
receipt_number_usage_id: Ulid
receipt_number: string
amount: PositiveMoneyXaf
currency: Currency
method: PaymentsMethod
reference: (string | null)
effective_at: Instant
cash_session_id: NullableUlid
retroactive_reason: (string | null)
receipt_document_id: Ulid
}
/**
 * Corps de la route directe POST /invoices/{id}/payments : même charge + expected_version (ledger_version dérivée : 1 + paiements confirmés + contre-écritures + avoirs émis + remboursements (contrat 23).) ; en-tête Idempotency-Key obligatoire.
 */
export interface RegisterPaymentDirectRequest {
expected_version: Version
invoice_id: Ulid
payment_id: Ulid
receipt_id: Ulid
receipt_number_usage_id: Ulid
/**
 * Numéro central attribué par le serveur sous verrou : null dans la requête directe.
 */
receipt_number: null
amount: PositiveMoneyXaf
currency: Currency
method: PaymentsMethod
reference: (string | null)
effective_at: Instant
cash_session_id: NullableUlid
retroactive_reason: (string | null)
receipt_document_id: Ulid
}
export interface RegisterPhysicalReturnPayload {
physical_return_id: Ulid
delivery_line_id: Ulid
item_id: Ulid
quantity: Quantity
condition_code: PhysicalReturnsConditionCode
accepted_for_restock: boolean
approved_by: Ulid
occurred_at: Instant
reason: Reason
credit_note_id: NullableUlid
stock_movement_id: NullableUlid
}
/**
 * Corps de la route directe POST /deliveries/{id}/physical-returns : même charge + expected_version (Création : expected_version vaut null.) ; en-tête Idempotency-Key obligatoire.
 */
export interface RegisterPhysicalReturnDirectRequest {
expected_version: null
physical_return_id: Ulid
delivery_line_id: Ulid
item_id: Ulid
quantity: Quantity
condition_code: PhysicalReturnsConditionCode
accepted_for_restock: boolean
approved_by: Ulid
occurred_at: Instant
reason: Reason
credit_note_id: NullableUlid
stock_movement_id: NullableUlid
}
export interface RegisterStockMovementPayload {
movement_id: Ulid
item_id: Ulid
position_id: Ulid
lot_id: NullableUlid
kind: ("BREAKAGE" | "ADJUSTMENT")
signed_quantity: SignedQuantity
unit_cost: (MoneyXaf | null)
approval_id: Ulid
reason: Reason
occurred_at: Instant
}
/**
 * Corps de la route directe POST /stock/movements : même charge + expected_version (Création : expected_version vaut null.) ; en-tête Idempotency-Key obligatoire.
 */
export interface RegisterStockMovementDirectRequest {
expected_version: null
movement_id: Ulid
item_id: Ulid
position_id: Ulid
lot_id: NullableUlid
kind: ("BREAKAGE" | "ADJUSTMENT")
signed_quantity: SignedQuantity
unit_cost: (MoneyXaf | null)
approval_id: Ulid
reason: Reason
occurred_at: Instant
}
export interface RegisterVisitPayload {
visit_id: Ulid
patient_id: Ulid
reason: VisitsReason
occurred_at: Instant
appointment_id: NullableUlid
administrative_note: (string | null)
}
/**
 * Corps de la route directe POST /visits : même charge + expected_version (Création : expected_version vaut null.) ; en-tête Idempotency-Key obligatoire.
 */
export interface RegisterVisitDirectRequest {
expected_version: null
visit_id: Ulid
patient_id: Ulid
reason: VisitsReason
occurred_at: Instant
appointment_id: NullableUlid
administrative_note: (string | null)
}
export interface RequestApprovalPayload {
approval_id: Ulid
subject: ApprovalSubject
reason: Reason
expires_at: NullableInstant
}
/**
 * Corps de la route directe POST /approvals : même charge + expected_version (Création : expected_version vaut null.) ; en-tête Idempotency-Key obligatoire.
 */
export interface RequestApprovalDirectRequest {
expected_version: null
approval_id: Ulid
subject: ApprovalSubject
reason: Reason
expires_at: NullableInstant
}
export interface ReversePaymentPayload {
invoice_id: Ulid
payment_id: Ulid
reversal_id: Ulid
amount: PositiveMoneyXaf
reason: Reason
approval_id: Ulid
}
/**
 * Corps de la route directe POST /payments/{id}/reversals : même charge + expected_version (ledger_version dérivée : 1 + paiements confirmés + contre-écritures + avoirs émis + remboursements (contrat 23).) ; en-tête Idempotency-Key obligatoire.
 */
export interface ReversePaymentDirectRequest {
expected_version: Version
invoice_id: Ulid
payment_id: Ulid
reversal_id: Ulid
amount: PositiveMoneyXaf
reason: Reason
approval_id: Ulid
}
export interface SaveClinicalStepPayload {
consultation_id: Ulid
step: {
step: StepName
data: {

}
}
}
/**
 * Corps de la route directe PATCH /consultations/{id}/steps/{step} : même charge + expected_version (Version de l'agrégat (colonne version).) ; en-tête Idempotency-Key obligatoire.
 */
export interface SaveClinicalStepDirectRequest {
expected_version: Version
consultation_id: Ulid
step: {
step: StepName
data: {

}
}
}
export interface StartConsultationPayload {
consultation_id: Ulid
visit_id: Ulid
patient_id: Ulid
effective_at: Instant
date_change_reason: (string | null)
exam_invoice_id: NullableUlid
exam_waiver_approval_id: NullableUlid
}
/**
 * Corps de la route directe POST /visits/{id}/consultations : même charge + expected_version (Création : expected_version vaut null.) ; en-tête Idempotency-Key obligatoire.
 */
export interface StartConsultationDirectRequest {
expected_version: null
consultation_id: Ulid
visit_id: Ulid
patient_id: Ulid
effective_at: Instant
date_change_reason: (string | null)
exam_invoice_id: NullableUlid
exam_waiver_approval_id: NullableUlid
}
export interface UpdateDraftPayload {
invoice_id: Ulid
visit_id: NullableUlid
due_date: NullableCivilDate
/**
 * @minItems 0
 * @maxItems 200
 * 
 * Items: Ligne de brouillon : prix TTC unitaire, remise TTC ; total de ligne recalculé (ROUND(quantité × prix) − remise).
 */
lines: {
line_id: Ulid
position: number
catalog_item_id: NullableUlid
description: string
quantity: Quantity
unit_price_gross: MoneyXaf
discount_gross: MoneyXaf
prescription_id: NullableUlid
}[]
}
/**
 * Corps de la route directe PATCH /invoices/{id} : même charge + expected_version (Version du brouillon (invoices.version), figée à l'émission.) ; en-tête Idempotency-Key obligatoire.
 */
export interface UpdateDraftDirectRequest {
expected_version: Version
invoice_id: Ulid
visit_id: NullableUlid
due_date: NullableCivilDate
/**
 * @minItems 0
 * @maxItems 200
 * 
 * Items: Ligne de brouillon : prix TTC unitaire, remise TTC ; total de ligne recalculé (ROUND(quantité × prix) − remise).
 */
lines: {
line_id: Ulid
position: number
catalog_item_id: NullableUlid
description: string
quantity: Quantity
unit_price_gross: MoneyXaf
discount_gross: MoneyXaf
prescription_id: NullableUlid
}[]
}
export interface UpdatePatientPayload {
patient_id: Ulid
changes: {
last_name?: string
first_names?: (string | null)
sex?: PatientRecordsSex
birth_date?: NullableCivilDate
birth_date_missing_reason?: (string | null)
phone_primary?: (Phone | null)
phone_secondary?: (Phone | null)
phone_missing_reason?: (string | null)
address?: (string | null)
profession?: (string | null)
guardian_contact?: ({
name?: string
relationship?: string
phone?: string
} | null)
}
}
/**
 * Corps de la route directe PATCH /patients/{id} : même charge + expected_version (Version de l'agrégat (colonne version).) ; en-tête Idempotency-Key obligatoire.
 */
export interface UpdatePatientDirectRequest {
expected_version: Version
patient_id: Ulid
changes: {
last_name?: string
first_names?: (string | null)
sex?: PatientRecordsSex
birth_date?: NullableCivilDate
birth_date_missing_reason?: (string | null)
phone_primary?: (Phone | null)
phone_secondary?: (Phone | null)
phone_missing_reason?: (string | null)
address?: (string | null)
profession?: (string | null)
guardian_contact?: ({
name?: string
relationship?: string
phone?: string
} | null)
}
}
export interface ValidatePrescriptionPayload {
prescription_id: Ulid
document_id: Ulid
}
/**
 * Corps de la route directe POST /prescriptions/{id}/validate : même charge + expected_version (Transition d'état contrôlée sous verrou (statut attendu vérifié par le serveur) ; la table n'a pas de colonne version, que le contrat 23 interdit d'inventer : expected_version vaut null.) ; en-tête Idempotency-Key obligatoire.
 */
export interface ValidatePrescriptionDirectRequest {
expected_version: null
prescription_id: Ulid
document_id: Ulid
}
export interface AppointmentCancelledEventPayload {
appointment_id: Ulid
patient_id: NullableUlid
prospect_contact_id: NullableUlid
starts_at: Instant
cancelled_at: Instant
}
export interface AppointmentConfirmedEventPayload {
appointment_id: Ulid
patient_id: NullableUlid
prospect_contact_id: NullableUlid
resource_id: Ulid
service_id: Ulid
starts_at: Instant
ends_at: Instant
source: AppointmentsSource
}
export interface AppointmentRescheduledEventPayload {
appointment_id: Ulid
patient_id: NullableUlid
prospect_contact_id: NullableUlid
resource_id: Ulid
previous_starts_at: Instant
starts_at: Instant
ends_at: Instant
}
export interface ConsultationCompletedEventPayload {
consultation_id: Ulid
patient_id: Ulid
visit_id: Ulid
revision_id: Ulid
revision_no: number
completed_at: Instant
}
export interface CreditNoteIssuedEventPayload {
credit_note_id: Ulid
invoice_id: Ulid
number: string
amount_gross: PositiveMoneyXaf
currency: Currency
issued_at: Instant
}
export interface DeliveryConfirmedEventPayload {
delivery_id: Ulid
invoice_id: Ulid
delivered_at: Instant
line_count: number
}
export interface FollowUpScheduledEventPayload {
follow_up_plan_id: Ulid
patient_id: Ulid
consultation_id: Ulid
recommended_date: CivilDate
reminder_enabled: boolean
preferred_channel: FollowUpPlansPreferredChannel
}
export interface InvoiceIssuedEventPayload {
invoice_id: Ulid
patient_id: Ulid
number: string
issued_at: Instant
total_gross: MoneyXaf
currency: Currency
source_device_id: NullableUlid
}
export interface PatientCreatedEventPayload {
patient_id: Ulid
record_number: string
legacy_record: boolean
source_device_id: NullableUlid
}
export interface PaymentConfirmedEventPayload {
payment_id: Ulid
invoice_id: Ulid
receipt_id: Ulid
receipt_number: string
amount: PositiveMoneyXaf
currency: Currency
method: PaymentsMethod
effective_at: Instant
}
export interface PrescriptionValidatedEventPayload {
prescription_id: Ulid
patient_id: Ulid
consultation_id: NullableUlid
origin: OpticalPrescriptionsOrigin
version_no: number
validated_at: Instant
document_id: NullableUlid
}
export interface StockThresholdCrossedEventPayload {
stock_alert_id: Ulid
item_id: Ulid
location_id: Ulid
lot_id: NullableUlid
kind: StockAlertsKind
detected_at: Instant
due_on: NullableCivilDate
}
export interface WorkshopReadyEventPayload {
workshop_order_id: Ulid
patient_id: Ulid
invoice_line_id: Ulid
ready_revision: number
ready_at: Instant
}
export interface EventEnvelope {
event_id: Ulid
event_type: EventType
event_version: number
clinic_id: Ulid
occurred_at: Instant
aggregate_type: string
aggregate_id: Ulid
aggregate_version: Version
correlation_id: string
payload: {

}
}
export interface DeliveryPatientSnapshot {
patient_id: Ulid
record_number: string
last_name: string
first_names: (string | null)
}
