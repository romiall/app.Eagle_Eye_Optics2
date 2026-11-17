import { apiRequest, NetworkUnavailable } from '@/app/api'
import type { ReadOutcome } from '@/app/services/reads'
import type {
  AssistantRun,
  AssistantRunList,
  AssistantTurnRequest,
  AssistantTurnResult,
  AssistantTurnResultResponse,
  AudienceSegment,
  AudienceSegmentList,
  AudienceSegmentResponse,
  BookingReceipt,
  BookingReceiptResponse,
  BookingRequest,
  CalendarSyncRunRequest,
  CalendarSyncRunResult,
  CalendarSyncRunResultResponse,
  CalendarSyncState,
  CalendarSyncStateList,
  CalendarSyncStateResponse,
  CampaignDefinition,
  CampaignDefinitionsStatus,
  CampaignPage,
  CampaignPreview,
  CampaignPreviewResponse,
  CampaignRecipientPage,
  CampaignRecipientsStatus,
  CampaignResponse,
  CommunicationConsent,
  CommunicationConsentPage,
  CommunicationConsentResponse,
  CommunicationConsentsChannel,
  CommunicationConsentsPurpose,
  ConversationHandoff,
  ConversationHandoffList,
  ConversationHandoffRequest,
  CreateKnowledgeVersionRequest,
  CreateMessageTemplateVersionRequest,
  CrmConversation,
  CrmConversationPage,
  CrmConversationResponse,
  CrmConversationsStatus,
  CrmLeadPage,
  CrmLeadSyncResult,
  CrmLeadSyncResultResponse,
  CrmLeadsStatus,
  DecidePublicBookingRequest,
  FreezeCampaignRequest,
  IntegrationAccount,
  IntegrationAccountList,
  IntegrationAccountResponse,
  IntegrationConnectionTest,
  IntegrationConnectionTestResponse,
  IntegrationHealth,
  IntegrationHealthResponse,
  IntegrationReconcileResult,
  IntegrationReconcileResultResponse,
  KnowledgeActionRequest,
  KnowledgeEntriesCategory,
  KnowledgeEntry,
  KnowledgeEntryPage,
  KnowledgeEntryResponse,
  KnowledgeEntryVersion,
  KnowledgeEntryVersionResponse,
  LinkProspectPatientRequest,
  MessageAttempt,
  MessageAttemptPage,
  MessageAttemptResponse,
  MessageAttemptsStatus,
  MessageTemplate,
  MessageTemplateList,
  MessageTemplateResponse,
  MessageTemplateVersion,
  MessageTemplateVersionResponse,
  OutboxBatchResult,
  OutboxBatchResultResponse,
  OutboxEventPage,
  OutboxEventsStatus,
  PauseCampaignRequest,
  ProcessOutboxRequest,
  ProspectContact,
  ProspectContactPage,
  ProspectContactResponse,
  PublicBookingAdminItem,
  PublicBookingAdminPage,
  PublicBookingAdminResponse,
  PublicBookingRequestsStatus,
  PublicService,
  PublicServiceList,
  PublicSlot,
  PublicSlotList,
  ReconcileIntegrationsRequest,
  RecordConsentRequest,
  ReminderPolicy,
  ReminderPolicyList,
  ReminderPolicyResponse,
  RevokeConsentRequest,
  SaveAudienceSegmentRequest,
  SaveCalendarSyncStateRequest,
  SaveCampaignRequest,
  SaveIntegrationAccountRequest,
  SaveKnowledgeEntryRequest,
  SaveMessageTemplateRequest,
  SaveProspectContactRequest,
  SaveReminderPolicyRequest,
  SendTaskMessageRequest,
  SyncCrmLeadsRequest,
  UpdateAudienceSegmentRequest,
  UpdateIntegrationAccountRequest,
  UpdateProspectContactRequest,
  UpdateReminderPolicyRequest,
  WebhookInboxPage,
  WebhookInboxStatus,
} from '@/domain/contracts/generated'
import { isUlid, newUlid } from '@/domain/values/ulid'

/**
 * Client HTTP typé pour les écrans Communication, CRM, Réservations publiques et Intégrations (L2).
 * Toutes les opérations restent en ligne : aucune donnée sensible ni secret connecteur n’est stocké
 * localement. Les écritures exigent un en-tête `Idempotency-Key` conservé sur reprise.
 */
function requireResponse<T>(response: T | undefined): T {
  if (response === undefined) throw new NetworkUnavailable()
  return response
}

function answered<T>(data: T | undefined): ReadOutcome<T> {
  return {
    data: requireResponse(data),
    freshness: { serverAsOf: new Date().toISOString(), complete: true },
    live: true,
  }
}

function assertId(id: string, what: string): void {
  if (!isUlid(id)) throw new RangeError(`Identifiant de ${what} invalide.`)
}

function assertPage(page: number): void {
  if (!Number.isSafeInteger(page) || page < 1) throw new RangeError('Numéro de page invalide.')
}

function withQuery(basePath: string, params: URLSearchParams): string {
  const qs = params.toString()
  return qs === '' ? basePath : `${basePath}?${qs}`
}

export function newIdempotencyKey(): string {
  return newUlid()
}

function idempotentHeaders(idempotencyKey?: string): Readonly<Record<string, string>> {
  return { 'Idempotency-Key': idempotencyKey ?? newUlid() }
}

// ============================================================================
// Portail public de réservation (/public/v1/*)
// ============================================================================

export async function listPublicServices(): Promise<ReadOutcome<PublicService[]>> {
  const response = await apiRequest<PublicServiceList>('GET', '/public/v1/services')
  return answered(requireResponse(response).data)
}

export interface PublicSlotFilters {
  serviceId?: string | null
  from?: string | null
  to?: string | null
}

export async function listPublicSlots(
  filters: PublicSlotFilters = {},
): Promise<ReadOutcome<PublicSlot[]>> {
  const params = new URLSearchParams()
  if (filters.serviceId) {
    assertId(filters.serviceId, 'prestation')
    params.set('service_id', filters.serviceId)
  }
  if (filters.from) params.set('from', filters.from)
  if (filters.to) params.set('to', filters.to)
  const response = await apiRequest<PublicSlotList>('GET', withQuery('/public/v1/slots', params))
  return answered(requireResponse(response).data)
}

export async function submitPublicBookingRequest(
  payload: BookingRequest,
  idempotencyKey?: string,
): Promise<BookingReceipt> {
  const response = await apiRequest<BookingReceiptResponse>(
    'POST',
    '/public/v1/booking-requests',
    payload,
    idempotentHeaders(idempotencyKey),
  )
  return requireResponse(response).data
}

// ============================================================================
// Intégrations, boîte d'envoi (Outbox), webhooks & réconciliation
// ============================================================================

export async function getIntegrationsHealth(): Promise<ReadOutcome<IntegrationHealth>> {
  const response = await apiRequest<IntegrationHealthResponse>('GET', '/api/v1/integrations/health')
  return answered(requireResponse(response).data)
}

export async function listIntegrationAccounts(): Promise<ReadOutcome<IntegrationAccount[]>> {
  const response = await apiRequest<IntegrationAccountList>('GET', '/api/v1/integrations/accounts')
  return answered(requireResponse(response).data)
}

export async function createIntegrationAccount(
  payload: SaveIntegrationAccountRequest,
  idempotencyKey?: string,
): Promise<IntegrationAccount> {
  const response = await apiRequest<IntegrationAccountResponse>(
    'POST',
    '/api/v1/integrations/accounts',
    payload,
    idempotentHeaders(idempotencyKey),
  )
  return requireResponse(response).data
}

export async function updateIntegrationAccount(
  id: string,
  payload: UpdateIntegrationAccountRequest,
  idempotencyKey?: string,
): Promise<IntegrationAccount> {
  assertId(id, 'compte connecteur')
  const response = await apiRequest<IntegrationAccountResponse>(
    'PATCH',
    `/api/v1/integrations/accounts/${id}`,
    payload,
    idempotentHeaders(idempotencyKey),
  )
  return requireResponse(response).data
}

export async function testIntegrationAccount(
  id: string,
  idempotencyKey?: string,
): Promise<IntegrationConnectionTest> {
  assertId(id, 'compte connecteur')
  const response = await apiRequest<IntegrationConnectionTestResponse>(
    'POST',
    `/api/v1/integrations/accounts/${id}/test`,
    undefined,
    idempotentHeaders(idempotencyKey),
  )
  return requireResponse(response).data
}

export interface OutboxFilters {
  page?: number
  status?: OutboxEventsStatus | null
  eventType?: string | null
}

export async function listOutboxEvents(
  filters: OutboxFilters = {},
): Promise<ReadOutcome<OutboxEventPage>> {
  const page = filters.page ?? 1
  assertPage(page)
  const params = new URLSearchParams({ page: String(page) })
  if (filters.status) params.set('status', filters.status)
  if (filters.eventType && filters.eventType.trim() !== '') {
    params.set('event_type', filters.eventType.trim())
  }
  const response = await apiRequest<OutboxEventPage>(
    'GET',
    withQuery('/api/v1/integrations/outbox', params),
  )
  return answered(response)
}

export async function processOutboxEvents(
  payload: ProcessOutboxRequest = {},
  idempotencyKey?: string,
): Promise<OutboxBatchResult> {
  const response = await apiRequest<OutboxBatchResultResponse>(
    'POST',
    '/api/v1/integrations/outbox/process',
    payload,
    idempotentHeaders(idempotencyKey),
  )
  return requireResponse(response).data
}

export interface WebhookInboxFilters {
  page?: number
  status?: WebhookInboxStatus | null
}

export async function listWebhookInbox(
  filters: WebhookInboxFilters = {},
): Promise<ReadOutcome<WebhookInboxPage>> {
  const page = filters.page ?? 1
  assertPage(page)
  const params = new URLSearchParams({ page: String(page) })
  if (filters.status) params.set('status', filters.status)
  const response = await apiRequest<WebhookInboxPage>(
    'GET',
    withQuery('/api/v1/integrations/webhooks', params),
  )
  return answered(response)
}

export async function reconcileIntegrations(
  payload: ReconcileIntegrationsRequest = {},
  idempotencyKey?: string,
): Promise<IntegrationReconcileResult> {
  const response = await apiRequest<IntegrationReconcileResultResponse>(
    'POST',
    '/api/v1/integrations/reconcile',
    payload,
    idempotentHeaders(idempotencyKey),
  )
  return requireResponse(response).data
}

// ============================================================================
// Google Calendar & demandes publiques de rendez-vous
// ============================================================================

export async function listCalendarSyncStates(): Promise<ReadOutcome<CalendarSyncState[]>> {
  const response = await apiRequest<CalendarSyncStateList>(
    'GET',
    '/api/v1/integrations/google/states',
  )
  return answered(requireResponse(response).data)
}

export async function saveCalendarSyncState(
  payload: SaveCalendarSyncStateRequest,
  idempotencyKey?: string,
): Promise<CalendarSyncState> {
  assertId(payload.integration_account_id, 'compte connecteur')
  assertId(payload.resource_id, 'ressource')
  const response = await apiRequest<CalendarSyncStateResponse>(
    'POST',
    '/api/v1/integrations/google/states',
    payload,
    idempotentHeaders(idempotencyKey),
  )
  return requireResponse(response).data
}

export async function syncGoogleCalendar(
  payload: CalendarSyncRunRequest = {},
  idempotencyKey?: string,
): Promise<CalendarSyncRunResult> {
  if (payload.resource_id) assertId(payload.resource_id, 'ressource')
  const response = await apiRequest<CalendarSyncRunResultResponse>(
    'POST',
    '/api/v1/integrations/google/sync',
    payload,
    idempotentHeaders(idempotencyKey),
  )
  return requireResponse(response).data
}

export interface PublicBookingAdminFilters {
  page?: number
  status?: PublicBookingRequestsStatus | null
}

export async function listPublicBookings(
  filters: PublicBookingAdminFilters = {},
): Promise<ReadOutcome<PublicBookingAdminPage>> {
  const page = filters.page ?? 1
  assertPage(page)
  const params = new URLSearchParams({ page: String(page) })
  if (filters.status) params.set('status', filters.status)
  const response = await apiRequest<PublicBookingAdminPage>(
    'GET',
    withQuery('/api/v1/public-bookings', params),
  )
  return answered(response)
}

export async function confirmPublicBooking(
  id: string,
  payload: DecidePublicBookingRequest = {},
  idempotencyKey?: string,
): Promise<PublicBookingAdminItem> {
  assertId(id, 'demande de rendez-vous')
  if (payload.resource_id) assertId(payload.resource_id, 'ressource')
  const response = await apiRequest<PublicBookingAdminResponse>(
    'POST',
    `/api/v1/public-bookings/${id}/confirm`,
    payload,
    idempotentHeaders(idempotencyKey),
  )
  return requireResponse(response).data
}

export async function rejectPublicBooking(
  id: string,
  payload: DecidePublicBookingRequest = {},
  idempotencyKey?: string,
): Promise<PublicBookingAdminItem> {
  assertId(id, 'demande de rendez-vous')
  const response = await apiRequest<PublicBookingAdminResponse>(
    'POST',
    `/api/v1/public-bookings/${id}/reject`,
    payload,
    idempotentHeaders(idempotencyKey),
  )
  return requireResponse(response).data
}

// ============================================================================
// Prospects, Kommo CRM & Conversations
// ============================================================================

export interface ProspectFilters {
  page?: number
  query?: string | null
}

export async function listProspects(
  filters: ProspectFilters = {},
): Promise<ReadOutcome<ProspectContactPage>> {
  const page = filters.page ?? 1
  assertPage(page)
  const params = new URLSearchParams({ page: String(page) })
  if (filters.query && filters.query.trim() !== '') params.set('query', filters.query.trim())
  const response = await apiRequest<ProspectContactPage>(
    'GET',
    withQuery('/api/v1/crm/prospects', params),
  )
  return answered(response)
}

export async function createProspect(
  payload: SaveProspectContactRequest,
  idempotencyKey?: string,
): Promise<ProspectContact> {
  const response = await apiRequest<ProspectContactResponse>(
    'POST',
    '/api/v1/crm/prospects',
    payload,
    idempotentHeaders(idempotencyKey),
  )
  return requireResponse(response).data
}

export async function updateProspect(
  id: string,
  payload: UpdateProspectContactRequest,
  idempotencyKey?: string,
): Promise<ProspectContact> {
  assertId(id, 'prospect')
  const response = await apiRequest<ProspectContactResponse>(
    'PATCH',
    `/api/v1/crm/prospects/${id}`,
    payload,
    idempotentHeaders(idempotencyKey),
  )
  return requireResponse(response).data
}

export async function linkProspectToPatient(
  prospectId: string,
  payload: LinkProspectPatientRequest,
  idempotencyKey?: string,
): Promise<ProspectContact> {
  assertId(prospectId, 'prospect')
  assertId(payload.patient_id, 'patient')
  const response = await apiRequest<ProspectContactResponse>(
    'POST',
    `/api/v1/crm/prospects/${prospectId}/link-patient`,
    payload,
    idempotentHeaders(idempotencyKey),
  )
  return requireResponse(response).data
}

export interface CrmLeadFilters {
  page?: number
  status?: CrmLeadsStatus | null
}

export async function listCrmLeads(
  filters: CrmLeadFilters = {},
): Promise<ReadOutcome<CrmLeadPage>> {
  const page = filters.page ?? 1
  assertPage(page)
  const params = new URLSearchParams({ page: String(page) })
  if (filters.status) params.set('status', filters.status)
  const response = await apiRequest<CrmLeadPage>('GET', withQuery('/api/v1/crm/leads', params))
  return answered(response)
}

export async function syncCrmLeads(
  payload: SyncCrmLeadsRequest = {},
  idempotencyKey?: string,
): Promise<CrmLeadSyncResult> {
  if (payload.integration_account_id) assertId(payload.integration_account_id, 'compte connecteur')
  const response = await apiRequest<CrmLeadSyncResultResponse>(
    'POST',
    '/api/v1/crm/leads/sync',
    payload,
    idempotentHeaders(idempotencyKey),
  )
  return requireResponse(response).data
}

export interface CrmConversationFilters {
  page?: number
  status?: CrmConversationsStatus | null
}

export async function listCrmConversations(
  filters: CrmConversationFilters = {},
): Promise<ReadOutcome<CrmConversationPage>> {
  const page = filters.page ?? 1
  assertPage(page)
  const params = new URLSearchParams({ page: String(page) })
  if (filters.status) params.set('status', filters.status)
  const response = await apiRequest<CrmConversationPage>(
    'GET',
    withQuery('/api/v1/crm/conversations', params),
  )
  return answered(response)
}

export async function getCrmConversation(id: string): Promise<ReadOutcome<CrmConversation>> {
  assertId(id, 'conversation')
  const response = await apiRequest<CrmConversationResponse>(
    'GET',
    `/api/v1/crm/conversations/${id}`,
  )
  return answered(requireResponse(response).data)
}

// ============================================================================
// Base de connaissances gouvernée
// ============================================================================

export interface KnowledgeFilters {
  page?: number
  category?: KnowledgeEntriesCategory | null
}

export async function listKnowledgeEntries(
  filters: KnowledgeFilters = {},
): Promise<ReadOutcome<KnowledgeEntryPage>> {
  const page = filters.page ?? 1
  assertPage(page)
  const params = new URLSearchParams({ page: String(page) })
  if (filters.category) params.set('category', filters.category)
  const response = await apiRequest<KnowledgeEntryPage>(
    'GET',
    withQuery('/api/v1/knowledge', params),
  )
  return answered(response)
}

export async function createKnowledgeEntry(
  payload: SaveKnowledgeEntryRequest,
  idempotencyKey?: string,
): Promise<KnowledgeEntry> {
  const response = await apiRequest<KnowledgeEntryResponse>(
    'POST',
    '/api/v1/knowledge',
    payload,
    idempotentHeaders(idempotencyKey),
  )
  return requireResponse(response).data
}

export async function createKnowledgeVersion(
  entryId: string,
  payload: CreateKnowledgeVersionRequest,
  idempotencyKey?: string,
): Promise<KnowledgeEntryVersion> {
  assertId(entryId, 'fiche de connaissance')
  const response = await apiRequest<KnowledgeEntryVersionResponse>(
    'POST',
    `/api/v1/knowledge/${entryId}/versions`,
    payload,
    idempotentHeaders(idempotencyKey),
  )
  return requireResponse(response).data
}

export async function approveKnowledgeVersion(
  versionId: string,
  payload: KnowledgeActionRequest = {},
  idempotencyKey?: string,
): Promise<KnowledgeEntryVersion> {
  assertId(versionId, 'révision de connaissance')
  const response = await apiRequest<KnowledgeEntryVersionResponse>(
    'POST',
    `/api/v1/knowledge/versions/${versionId}/approve`,
    payload,
    idempotentHeaders(idempotencyKey),
  )
  return requireResponse(response).data
}

export async function publishKnowledgeVersion(
  versionId: string,
  payload: KnowledgeActionRequest = {},
  idempotencyKey?: string,
): Promise<KnowledgeEntryVersion> {
  assertId(versionId, 'révision de connaissance')
  const response = await apiRequest<KnowledgeEntryVersionResponse>(
    'POST',
    `/api/v1/knowledge/versions/${versionId}/publish`,
    payload,
    idempotentHeaders(idempotencyKey),
  )
  return requireResponse(response).data
}

// ============================================================================
// Assistant borné & transferts humain / bot
// ============================================================================

export async function runAssistantTurn(
  conversationId: string,
  payload: AssistantTurnRequest,
  idempotencyKey?: string,
): Promise<AssistantTurnResult> {
  assertId(conversationId, 'conversation')
  if (payload.service_id) assertId(payload.service_id, 'prestation')
  const response = await apiRequest<AssistantTurnResultResponse>(
    'POST',
    `/api/v1/crm/conversations/${conversationId}/assistant-turn`,
    payload,
    idempotentHeaders(idempotencyKey),
  )
  return requireResponse(response).data
}

export async function requestHumanHandoff(
  conversationId: string,
  payload: ConversationHandoffRequest,
  idempotencyKey?: string,
): Promise<CrmConversation> {
  assertId(conversationId, 'conversation')
  const response = await apiRequest<CrmConversationResponse>(
    'POST',
    `/api/v1/crm/conversations/${conversationId}/handoff`,
    payload,
    idempotentHeaders(idempotencyKey),
  )
  return requireResponse(response).data
}

export async function resumeConversationBot(
  conversationId: string,
  payload: KnowledgeActionRequest = {},
  idempotencyKey?: string,
): Promise<CrmConversation> {
  assertId(conversationId, 'conversation')
  const response = await apiRequest<CrmConversationResponse>(
    'POST',
    `/api/v1/crm/conversations/${conversationId}/resume-bot`,
    payload,
    idempotentHeaders(idempotencyKey),
  )
  return requireResponse(response).data
}

export async function listConversationHandoffs(
  conversationId: string,
): Promise<ReadOutcome<ConversationHandoff[]>> {
  assertId(conversationId, 'conversation')
  const response = await apiRequest<ConversationHandoffList>(
    'GET',
    `/api/v1/crm/conversations/${conversationId}/handoffs`,
  )
  return answered(requireResponse(response).data)
}

export async function listAssistantRuns(
  conversationId: string,
): Promise<ReadOutcome<AssistantRun[]>> {
  assertId(conversationId, 'conversation')
  const response = await apiRequest<AssistantRunList>(
    'GET',
    `/api/v1/crm/conversations/${conversationId}/runs`,
  )
  return answered(requireResponse(response).data)
}

// ============================================================================
// Consentements, modèles, politiques de relance & envois transactionnels
// ============================================================================

export interface ConsentFilters {
  page?: number
  patientId?: string | null
  prospectContactId?: string | null
  channel?: CommunicationConsentsChannel | null
  purpose?: CommunicationConsentsPurpose | null
}

export async function listCommunicationConsents(
  filters: ConsentFilters = {},
): Promise<ReadOutcome<CommunicationConsentPage>> {
  const page = filters.page ?? 1
  assertPage(page)
  const params = new URLSearchParams({ page: String(page) })
  if (filters.patientId) {
    assertId(filters.patientId, 'patient')
    params.set('patient_id', filters.patientId)
  }
  if (filters.prospectContactId) {
    assertId(filters.prospectContactId, 'prospect')
    params.set('prospect_contact_id', filters.prospectContactId)
  }
  if (filters.channel) params.set('channel', filters.channel)
  if (filters.purpose) params.set('purpose', filters.purpose)
  const response = await apiRequest<CommunicationConsentPage>(
    'GET',
    withQuery('/api/v1/communication/consents', params),
  )
  return answered(response)
}

export async function recordCommunicationConsent(
  payload: RecordConsentRequest,
  idempotencyKey?: string,
): Promise<CommunicationConsent> {
  if (payload.patient_id) assertId(payload.patient_id, 'patient')
  if (payload.prospect_contact_id) assertId(payload.prospect_contact_id, 'prospect')
  const response = await apiRequest<CommunicationConsentResponse>(
    'POST',
    '/api/v1/communication/consents',
    payload,
    idempotentHeaders(idempotencyKey),
  )
  return requireResponse(response).data
}

export async function revokeCommunicationConsent(
  payload: RevokeConsentRequest,
  idempotencyKey?: string,
): Promise<CommunicationConsent> {
  if (payload.patient_id) assertId(payload.patient_id, 'patient')
  if (payload.prospect_contact_id) assertId(payload.prospect_contact_id, 'prospect')
  const response = await apiRequest<CommunicationConsentResponse>(
    'POST',
    '/api/v1/communication/consents/revoke',
    payload,
    idempotentHeaders(idempotencyKey),
  )
  return requireResponse(response).data
}

export async function listMessageTemplates(): Promise<ReadOutcome<MessageTemplate[]>> {
  const response = await apiRequest<MessageTemplateList>('GET', '/api/v1/communication/templates')
  return answered(requireResponse(response).data)
}

export async function createMessageTemplate(
  payload: SaveMessageTemplateRequest,
  idempotencyKey?: string,
): Promise<MessageTemplate> {
  const response = await apiRequest<MessageTemplateResponse>(
    'POST',
    '/api/v1/communication/templates',
    payload,
    idempotentHeaders(idempotencyKey),
  )
  return requireResponse(response).data
}

export async function createMessageTemplateVersion(
  templateId: string,
  payload: CreateMessageTemplateVersionRequest,
  idempotencyKey?: string,
): Promise<MessageTemplateVersion> {
  assertId(templateId, 'modèle de message')
  if (payload.integration_account_id) assertId(payload.integration_account_id, 'compte connecteur')
  const response = await apiRequest<MessageTemplateVersionResponse>(
    'POST',
    `/api/v1/communication/templates/${templateId}/versions`,
    payload,
    idempotentHeaders(idempotencyKey),
  )
  return requireResponse(response).data
}

export async function approveMessageTemplateVersion(
  versionId: string,
  payload: KnowledgeActionRequest = {},
  idempotencyKey?: string,
): Promise<MessageTemplateVersion> {
  assertId(versionId, 'révision de modèle')
  const response = await apiRequest<MessageTemplateVersionResponse>(
    'POST',
    `/api/v1/communication/templates/versions/${versionId}/approve`,
    payload,
    idempotentHeaders(idempotencyKey),
  )
  return requireResponse(response).data
}

export async function listReminderPolicies(): Promise<ReadOutcome<ReminderPolicy[]>> {
  const response = await apiRequest<ReminderPolicyList>(
    'GET',
    '/api/v1/communication/reminder-policies',
  )
  return answered(requireResponse(response).data)
}

export async function createReminderPolicy(
  payload: SaveReminderPolicyRequest,
  idempotencyKey?: string,
): Promise<ReminderPolicy> {
  const response = await apiRequest<ReminderPolicyResponse>(
    'POST',
    '/api/v1/communication/reminder-policies',
    payload,
    idempotentHeaders(idempotencyKey),
  )
  return requireResponse(response).data
}

export async function updateReminderPolicy(
  policyId: string,
  payload: UpdateReminderPolicyRequest,
  idempotencyKey?: string,
): Promise<ReminderPolicy> {
  assertId(policyId, 'politique de relance')
  const response = await apiRequest<ReminderPolicyResponse>(
    'PATCH',
    `/api/v1/communication/reminder-policies/${policyId}`,
    payload,
    idempotentHeaders(idempotencyKey),
  )
  return requireResponse(response).data
}

export interface MessageAttemptFilters {
  page?: number
  status?: MessageAttemptsStatus | null
  taskId?: string | null
}

export async function listMessageAttempts(
  filters: MessageAttemptFilters = {},
): Promise<ReadOutcome<MessageAttemptPage>> {
  const page = filters.page ?? 1
  assertPage(page)
  const params = new URLSearchParams({ page: String(page) })
  if (filters.status) params.set('status', filters.status)
  if (filters.taskId) {
    assertId(filters.taskId, 'tâche de contact')
    params.set('task_id', filters.taskId)
  }
  const response = await apiRequest<MessageAttemptPage>(
    'GET',
    withQuery('/api/v1/communication/attempts', params),
  )
  return answered(response)
}

export async function sendTransactionalTaskMessage(
  taskId: string,
  payload: SendTaskMessageRequest = {},
  idempotencyKey?: string,
): Promise<MessageAttempt> {
  assertId(taskId, 'tâche de contact')
  if (payload.template_version_id) assertId(payload.template_version_id, 'révision de modèle')
  const response = await apiRequest<MessageAttemptResponse>(
    'POST',
    `/api/v1/communication/tasks/${taskId}/send`,
    payload,
    idempotentHeaders(idempotencyKey),
  )
  return requireResponse(response).data
}

export async function reconcileMessageAttempt(
  attemptId: string,
  payload: KnowledgeActionRequest = {},
  idempotencyKey?: string,
): Promise<MessageAttempt> {
  assertId(attemptId, 'tentative d’envoi')
  const response = await apiRequest<MessageAttemptResponse>(
    'POST',
    `/api/v1/communication/attempts/${attemptId}/reconcile`,
    payload,
    idempotentHeaders(idempotencyKey),
  )
  return requireResponse(response).data
}

// ============================================================================
// Segments d'audience & Campagnes
// ============================================================================

export async function listAudienceSegments(): Promise<ReadOutcome<AudienceSegment[]>> {
  const response = await apiRequest<AudienceSegmentList>('GET', '/api/v1/communication/segments')
  return answered(requireResponse(response).data)
}

export async function createAudienceSegment(
  payload: SaveAudienceSegmentRequest,
  idempotencyKey?: string,
): Promise<AudienceSegment> {
  const response = await apiRequest<AudienceSegmentResponse>(
    'POST',
    '/api/v1/communication/segments',
    payload,
    idempotentHeaders(idempotencyKey),
  )
  return requireResponse(response).data
}

export async function updateAudienceSegment(
  segmentId: string,
  payload: UpdateAudienceSegmentRequest,
  idempotencyKey?: string,
): Promise<AudienceSegment> {
  assertId(segmentId, 'segment d’audience')
  const response = await apiRequest<AudienceSegmentResponse>(
    'PATCH',
    `/api/v1/communication/segments/${segmentId}`,
    payload,
    idempotentHeaders(idempotencyKey),
  )
  return requireResponse(response).data
}

export interface CampaignFilters {
  page?: number
  status?: CampaignDefinitionsStatus | null
}

export async function listCampaigns(
  filters: CampaignFilters = {},
): Promise<ReadOutcome<CampaignPage>> {
  const page = filters.page ?? 1
  assertPage(page)
  const params = new URLSearchParams({ page: String(page) })
  if (filters.status) params.set('status', filters.status)
  const response = await apiRequest<CampaignPage>(
    'GET',
    withQuery('/api/v1/communication/campaigns', params),
  )
  return answered(response)
}

export async function createCampaign(
  payload: SaveCampaignRequest,
  idempotencyKey?: string,
): Promise<CampaignDefinition> {
  assertId(payload.segment_id, 'segment d’audience')
  assertId(payload.template_version_id, 'révision de modèle')
  const response = await apiRequest<CampaignResponse>(
    'POST',
    '/api/v1/communication/campaigns',
    payload,
    idempotentHeaders(idempotencyKey),
  )
  return requireResponse(response).data
}

export async function previewCampaign(
  campaignId: string,
  payload: KnowledgeActionRequest = {},
  idempotencyKey?: string,
): Promise<CampaignPreview> {
  assertId(campaignId, 'campagne')
  const response = await apiRequest<CampaignPreviewResponse>(
    'POST',
    `/api/v1/communication/campaigns/${campaignId}/preview`,
    payload,
    idempotentHeaders(idempotencyKey),
  )
  return requireResponse(response).data
}

export async function freezeCampaign(
  campaignId: string,
  payload: FreezeCampaignRequest = {},
  idempotencyKey?: string,
): Promise<CampaignDefinition> {
  assertId(campaignId, 'campagne')
  if (payload.approval_id) assertId(payload.approval_id, 'approbation')
  const response = await apiRequest<CampaignResponse>(
    'POST',
    `/api/v1/communication/campaigns/${campaignId}/freeze`,
    payload,
    idempotentHeaders(idempotencyKey),
  )
  return requireResponse(response).data
}

export async function executeCampaign(
  campaignId: string,
  payload: KnowledgeActionRequest = {},
  idempotencyKey?: string,
): Promise<CampaignDefinition> {
  assertId(campaignId, 'campagne')
  const response = await apiRequest<CampaignResponse>(
    'POST',
    `/api/v1/communication/campaigns/${campaignId}/execute`,
    payload,
    idempotentHeaders(idempotencyKey),
  )
  return requireResponse(response).data
}

export async function pauseCampaign(
  campaignId: string,
  payload: PauseCampaignRequest = {},
  idempotencyKey?: string,
): Promise<CampaignDefinition> {
  assertId(campaignId, 'campagne')
  const response = await apiRequest<CampaignResponse>(
    'POST',
    `/api/v1/communication/campaigns/${campaignId}/pause`,
    payload,
    idempotentHeaders(idempotencyKey),
  )
  return requireResponse(response).data
}

export interface CampaignRecipientFilters {
  page?: number
  status?: CampaignRecipientsStatus | null
}

export async function listCampaignRecipients(
  campaignId: string,
  filters: CampaignRecipientFilters = {},
): Promise<ReadOutcome<CampaignRecipientPage>> {
  assertId(campaignId, 'campagne')
  const page = filters.page ?? 1
  assertPage(page)
  const params = new URLSearchParams({ page: String(page) })
  if (filters.status) params.set('status', filters.status)
  const response = await apiRequest<CampaignRecipientPage>(
    'GET',
    withQuery(`/api/v1/communication/campaigns/${campaignId}/recipients`, params),
  )
  return answered(response)
}
