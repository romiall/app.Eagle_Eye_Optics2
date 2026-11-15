import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import { NetworkUnavailable } from '@/app/api'
import * as communicationApi from '@/app/services/communication'
import { createMutationDispatcher, MUTATION_DISPATCHER_KEY } from '@/app/services/mutations'
import { refreshSession, resetSessionForTests } from '@/app/session'
import { FORBIDDEN_SETTLEMENT_WORDS } from '@/domain/billing/payment'
import {
  ASSISTANT_RUN_STATUS_BADGES,
  CALENDAR_SYNC_STATUS_BADGES,
  CAMPAIGN_RECIPIENT_STATUS_BADGES,
  CAMPAIGN_STATUS_BADGES,
  CONSENT_CHANNEL_LABELS,
  CONSENT_PURPOSE_LABELS,
  CONSENT_STATUS_BADGES,
  CONVERSATION_STATUS_BADGES,
  CRM_CHANNEL_LABELS,
  CRM_LEAD_STATUS_BADGES,
  HANDOFF_EVENT_BADGES,
  INTEGRATION_MODE_BADGES,
  INTEGRATION_PROVIDER_LABELS,
  INTEGRATION_STATUS_BADGES,
  KNOWLEDGE_CATEGORY_LABELS,
  MESSAGE_ATTEMPT_STATUS_BADGES,
  OUTBOX_STATUS_BADGES,
  PROSPECT_ORIGIN_LABELS,
  PUBLIC_BOOKING_STATUS_BADGES,
  REMINDER_CHANNEL_LABELS,
  REMINDER_OFFSET_UNIT_LABELS,
  REMINDER_PURPOSE_LABELS,
  TEMPLATE_APPROVAL_BADGES,
  TEMPLATE_CHANNEL_LABELS,
  TEMPLATE_PURPOSE_LABELS,
  WEBHOOK_STATUS_BADGES,
  detectForbiddenSegmentTerms,
  formatReminderOffset,
  listApprovedTemplateVersions,
  parseAllowedVariablesInput,
  parseOptionalJsonObject,
  validateConsentSubject,
} from '@/domain/communication/types'
import type {
  Approval,
  AssistantRun,
  AssistantTurnResult,
  AudienceSegment,
  CalendarSyncState,
  CampaignDefinition,
  CampaignPreview,
  CampaignRecipient,
  CommunicationConsent,
  ConversationHandoff,
  CrmConversation,
  CrmLead,
  IntegrationAccount,
  IntegrationHealth,
  KnowledgeEntry,
  KnowledgeEntryVersion,
  MessageAttempt,
  MessageTemplate,
  MessageTemplateVersion,
  OutboxEvent,
  ProspectContact,
  PublicBookingAdminItem,
  ReminderPolicy,
  WebhookInboxItem,
} from '@/domain/contracts/generated'
import { PAGES_COMMUNICATION } from '@/domain/help/content/pages-communication'
import Campaigns from '@/pages/communication/Campaigns.vue'
import CommunicationHomePage from '@/pages/communication/CommunicationHomePage.vue'
import Consents from '@/pages/communication/Consents.vue'
import CrmLinks from '@/pages/communication/CrmLinks.vue'
import Handoffs from '@/pages/communication/Handoffs.vue'
import Knowledge from '@/pages/communication/Knowledge.vue'
import OutboxAndWebhooks from '@/pages/communication/OutboxAndWebhooks.vue'
import PublicBookingsAdminPage from '@/pages/communication/PublicBookingsAdminPage.vue'
import Integrations from '@/pages/manager/Integrations.vue'

import { buttonByName, settle } from '../billing/support'
import { findPromises } from '../help/support/checks'
import { apiError, click, field, json, textOf } from '../patients/support'
import { ALL_TEST_MODULES, meResponse } from '../shell/server'

function forbiddenWordsInText(text: string): string[] {
  const lower = text.toLowerCase()
  return FORBIDDEN_SETTLEMENT_WORDS.filter((word) => lower.includes(word))
}

const ID_ACCOUNT = '01J00000000000000000000001'
const ID_RESOURCE = '01J00000000000000000000002'
const ID_SERVICE = '01J00000000000000000000003'
const ID_BOOKING = '01J00000000000000000000004'
const ID_APPOINTMENT = '01J00000000000000000000005'
const ID_CAL_STATE = '01J00000000000000000000006'
const ID_PROSPECT = '01J00000000000000000000007'
const ID_PATIENT = '01J00000000000000000000008'
const ID_LEAD = '01J00000000000000000000009'
const ID_CONVERSATION = '01J00000000000000000000010'
const ID_ENTRY = '01J00000000000000000000011'
const ID_KVER_DRAFT = '01J00000000000000000000012'
const ID_KVER_APPROVED = '01J00000000000000000000013'
const ID_RUN = '01J00000000000000000000014'
const ID_HANDOFF = '01J00000000000000000000015'
const ID_CONSENT = '01J00000000000000000000016'
const ID_TEMPLATE = '01J00000000000000000000017'
const ID_TVER_1 = '01J00000000000000000000018'
const ID_POLICY = '01J00000000000000000000020'
const ID_TASK = '01J00000000000000000000021'
const ID_ATTEMPT = '01J00000000000000000000022'
const ID_SEGMENT = '01J00000000000000000000023'
const ID_CAMPAIGN = '01J00000000000000000000024'
const ID_APPROVAL = '01J00000000000000000000025'
const ID_RECIPIENT = '01J00000000000000000000026'
const ID_OUTBOX = '01J00000000000000000000027'
const ID_WEBHOOK = '01J00000000000000000000028'

const NOW = '2026-11-15T10:00:00.000Z'

const FULL_COMMS_PERMS = [
  'integration.manage',
  'communication.manage',
  'knowledge.manage',
  'conversation.takeover',
  'agenda.read',
  'agenda.write',
  'patient.read',
]

const StubRoute = defineComponent({ template: '<div />' })

async function makeTestRouter(path = '/communication'): Promise<Router> {
  const routes = [
    { path: '/parametres/integrations', name: 'integrations', component: StubRoute },
    { path: '/communication', name: 'communication', component: StubRoute },
    { path: '/communication/reservations', name: 'communication-bookings', component: StubRoute },
    { path: '/communication/crm', name: 'communication-crm', component: StubRoute },
    { path: '/communication/connaissances', name: 'communication-knowledge', component: StubRoute },
    { path: '/communication/assistant', name: 'communication-handoffs', component: StubRoute },
    { path: '/communication/consentements', name: 'communication-consents', component: StubRoute },
    { path: '/communication/campagnes', name: 'communication-campaigns', component: StubRoute },
    { path: '/communication/boite-envoi', name: 'communication-outbox', component: StubRoute },
  ]
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
  await router.isReady()
  return router
}

interface RecordedReq {
  method: string
  path: string
  query: URLSearchParams
  headers: Record<string, string>
  body: Record<string, unknown> | null
}

function pageMeta(total: number) {
  return { current_page: 1, last_page: 1, per_page: 25, total }
}

function stubFetchRouter(handler: (req: RecordedReq) => Response | Promise<Response> | 'network'): {
  requests: RecordedReq[]
} {
  const requests: RecordedReq[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit): Promise<Response> => {
      const url = new URL(String(input), 'https://cabinet.test')
      const method = (init?.method ?? 'GET').toUpperCase()
      const headers = (init?.headers ?? {}) as Record<string, string>
      const body =
        typeof init?.body === 'string' && init.body.length > 0
          ? (JSON.parse(init.body) as Record<string, unknown>)
          : null
      const req: RecordedReq = {
        method,
        path: url.pathname,
        query: url.searchParams,
        headers,
        body,
      }
      requests.push(req)

      if (url.pathname === '/api/sanctum/csrf-cookie') return new Response(null, { status: 204 })
      if (url.pathname === '/api/v1/auth/me') {
        return json(
          200,
          meResponse(FULL_COMMS_PERMS, 'Gérante Test', [...ALL_TEST_MODULES, 'communication']),
        )
      }
      const reply = await handler(req)
      if (reply === 'network') throw new TypeError('Failed to fetch')
      return reply
    }),
  )
  return { requests }
}

const cleanups: (() => void)[] = []

async function mountPage<T>(
  component: T,
  router: Router,
  options: { withDispatcher?: boolean } = {},
): Promise<{ ui: HTMLElement; unmount: () => void }> {
  const root = document.createElement('div')
  document.body.append(root)
  const provide: Record<symbol, unknown> = {}
  if (options.withDispatcher) {
    provide[MUTATION_DISPATCHER_KEY] = createMutationDispatcher({ localEngine: null })
  }
  const wrapper = mount(component as never, {
    attachTo: root,
    global: {
      plugins: [router],
      provide,
    },
  })
  const unmount = (): void => {
    wrapper.unmount()
    root.remove()
  }
  cleanups.push(unmount)
  await settle()
  await flushPromises()
  return { ui: document.body, unmount }
}

async function setFieldValue(root: ParentNode, label: string, value: string): Promise<void> {
  const control = field(root, label) as HTMLInputElement | HTMLTextAreaElement
  control.value = value
  control.dispatchEvent(new Event('input', { bubbles: true }))
  control.dispatchEvent(new Event('change', { bubbles: true }))
  await settle()
}

async function selectOptionValue(root: ParentNode, label: string, value: string): Promise<void> {
  const control = field(root, label) as HTMLSelectElement
  control.value = value
  control.dispatchEvent(new Event('change', { bubbles: true }))
  await settle()
}

async function pressButton(root: ParentNode, name: string | RegExp): Promise<void> {
  await click(buttonByName(root, name))
  await flushPromises()
  await settle()
}

function sampleAccount(overrides: Partial<IntegrationAccount> = {}): IntegrationAccount {
  return {
    id: ID_ACCOUNT,
    provider: 'GOOGLE',
    external_account_id: 'cabinet-douala-01',
    display_name: 'Google Agenda Principal',
    status: 'ACTIVE',
    has_credentials: true,
    encryption_key_id: 'v1',
    token_expires_at: null,
    public_configuration: { calendar: 'primary' },
    version: 1,
    updated_at: NOW,
    ...overrides,
  }
}

function sampleHealth(accounts: IntegrationAccount[] = [sampleAccount()]): IntegrationHealth {
  return {
    mode: 'fake',
    credentials_configured: true,
    accounts_total: accounts.length,
    accounts_active: accounts.filter((a) => a.status === 'ACTIVE').length,
    accounts_error: accounts.filter((a) => a.status === 'ERROR').length,
    outbox_pending: 2,
    outbox_failed: 0,
    webhook_pending: 1,
    webhook_failed: 0,
    calendar_stale: 1,
    accounts,
  }
}

function sampleBooking(overrides: Partial<PublicBookingAdminItem> = {}): PublicBookingAdminItem {
  return {
    id: ID_BOOKING,
    public_reference: 'RDV-2026-0042',
    status: 'PENDING',
    service_id: ID_SERVICE,
    service_name: 'Contrôle vision',
    resource_id: ID_RESOURCE,
    prospect_contact_id: ID_PROSPECT,
    prospect_name: 'Nadia Mbarga',
    prospect_phone: '+237690000001',
    requested_starts_at: '2026-11-20T09:00:00.000Z',
    requested_ends_at: '2026-11-20T09:30:00.000Z',
    appointment_id: null,
    consent_recorded_at: NOW,
    created_at: NOW,
    ...overrides,
  }
}

function sampleCalendarState(overrides: Partial<CalendarSyncState> = {}): CalendarSyncState {
  return {
    id: ID_CAL_STATE,
    integration_account_id: ID_ACCOUNT,
    resource_id: ID_RESOURCE,
    external_calendar_id: 'primary',
    status: 'READY',
    last_full_sync_at: NOW,
    last_incremental_sync_at: NOW,
    last_error_code: null,
    push_expires_at: null,
    version: 1,
    updated_at: NOW,
    ...overrides,
  }
}

function sampleProspect(overrides: Partial<ProspectContact> = {}): ProspectContact {
  return {
    id: ID_PROSPECT,
    patient_id: null,
    name: 'Nadia Mbarga',
    phone: '+237690000001',
    email: 'nadia@example.test',
    origin: 'WHATSAPP',
    administrative_notes: 'Demande horaires samedi',
    version: 1,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  }
}

function sampleLead(overrides: Partial<CrmLead> = {}): CrmLead {
  return {
    id: ID_LEAD,
    integration_account_id: ID_ACCOUNT,
    prospect_contact_id: ID_PROSPECT,
    prospect_name: 'Nadia Mbarga',
    external_lead_id: 'kommo-998',
    pipeline_id: 'pipeline-optique',
    pipeline_stage: 'Qualification accueil',
    status: 'OPEN',
    acquisition_source: 'WhatsApp',
    product_interest: 'Monture optique',
    budget_min: 45000,
    budget_max: 90000,
    assigned_to: null,
    last_synced_at: NOW,
    updated_at: NOW,
    ...overrides,
  }
}

function sampleConversation(overrides: Partial<CrmConversation> = {}): CrmConversation {
  return {
    id: ID_CONVERSATION,
    crm_lead_id: ID_LEAD,
    integration_account_id: ID_ACCOUNT,
    external_conversation_id: 'wa-conv-101',
    channel: 'WHATSAPP',
    status: 'BOT_ACTIVE',
    human_owner_id: null,
    takeover_at: null,
    takeover_reason: null,
    administrative_summary: 'Demande de disponibilité',
    bot_resumed_at: null,
    last_activity_at: NOW,
    version: 1,
    ...overrides,
  }
}

function sampleKnowledgeVersion(
  overrides: Partial<KnowledgeEntryVersion> = {},
): KnowledgeEntryVersion {
  return {
    id: ID_KVER_DRAFT,
    entry_id: ID_ENTRY,
    revision_no: 1,
    language: 'fr',
    content: 'Le cabinet ouvre du lundi au samedi de 08h30 à 18h00.',
    authored_by: ID_ACCOUNT,
    approved_by: null,
    approved_at: null,
    published_at: null,
    retired_at: null,
    is_published: false,
    created_at: NOW,
    ...overrides,
  }
}

function sampleKnowledgeEntry(overrides: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
  const version = sampleKnowledgeVersion()
  return {
    id: ID_ENTRY,
    code: 'HORAIRES_OUVERTURE',
    category: 'HOURS',
    title: 'Horaires d’ouverture du cabinet',
    active: true,
    version: 1,
    published_version: null,
    versions: [version],
    ...overrides,
  }
}

function sampleAssistantRun(overrides: Partial<AssistantRun> = {}): AssistantRun {
  return {
    id: ID_RUN,
    conversation_id: ID_CONVERSATION,
    engine_name: 'bounded-optique',
    model_name: 'rules-v1',
    rules_version: '2026.11',
    started_at: NOW,
    completed_at: NOW,
    status: 'COMPLETED',
    input_tokens: 120,
    output_tokens: 45,
    knowledge_version_ids: [ID_KVER_APPROVED],
    sanitized_tool_results: [{ tool: 'knowledge.search', hits: 1 }],
    error_code: null,
    ...overrides,
  }
}

function sampleHandoff(overrides: Partial<ConversationHandoff> = {}): ConversationHandoff {
  return {
    id: ID_HANDOFF,
    conversation_id: ID_CONVERSATION,
    event_type: 'TAKEOVER',
    actor_id: ID_ACCOUNT,
    reason: 'Demande de renseignement téléphonique',
    administrative_summary: 'Rappel souhaité après 15h',
    occurred_at: NOW,
    ...overrides,
  }
}

function sampleConsent(overrides: Partial<CommunicationConsent> = {}): CommunicationConsent {
  return {
    id: ID_CONSENT,
    patient_id: ID_PATIENT,
    prospect_contact_id: null,
    channel: 'SMS',
    purpose: 'APPOINTMENT',
    destination_masked: '+237***0001',
    status: 'GRANTED',
    event_sequence: 1,
    proof: 'Formulaire accueil signé',
    policy_version: 'v1',
    recorded_by: ID_ACCOUNT,
    recorded_at: NOW,
    ...overrides,
  }
}

function sampleTemplateVersion(
  overrides: Partial<MessageTemplateVersion> = {},
): MessageTemplateVersion {
  return {
    id: ID_TVER_1,
    template_id: ID_TEMPLATE,
    integration_account_id: null,
    revision_no: 1,
    provider_template_id: 'wa-tpl-1',
    language: 'fr',
    body: 'Bonjour {{patient_name}}, rendez-vous le {{date}}.',
    allowed_variables: ['patient_name', 'date'],
    provider_approval_status: 'PENDING',
    approved_by: null,
    approved_at: null,
    created_at: NOW,
    ...overrides,
  }
}

function sampleTemplate(overrides: Partial<MessageTemplate> = {}): MessageTemplate {
  return {
    id: ID_TEMPLATE,
    code: 'RAPPEL_RDV_SMS',
    channel: 'SMS',
    purpose: 'APPOINTMENT',
    active: true,
    version: 1,
    versions: [sampleTemplateVersion()],
    ...overrides,
  }
}

function samplePolicy(overrides: Partial<ReminderPolicy> = {}): ReminderPolicy {
  return {
    id: ID_POLICY,
    code: 'RDV_J_MOINS_1',
    label: 'Rappel veille de rendez-vous',
    purpose: 'APPOINTMENT',
    channel: 'SMS',
    offset_unit: 'DAY',
    offset_value: -1,
    local_send_time: '09:00',
    active: true,
    version: 1,
    ...overrides,
  }
}

function sampleAttempt(overrides: Partial<MessageAttempt> = {}): MessageAttempt {
  return {
    id: ID_ATTEMPT,
    integration_account_id: ID_ACCOUNT,
    task_id: ID_TASK,
    campaign_recipient_id: null,
    template_version_id: ID_TVER_1,
    consent_event_id: ID_CONSENT,
    dedupe_key: 'task-01J-1',
    attempt_no: 1,
    status: 'SUBMITTED',
    provider_message_id: 'msg-ext-100',
    submitted_at: NOW,
    delivered_at: null,
    read_at: null,
    error_code: null,
    created_at: NOW,
    ...overrides,
  }
}

function sampleSegment(overrides: Partial<AudienceSegment> = {}): AudienceSegment {
  return {
    id: ID_SEGMENT,
    name: 'Contacts Douala accueil',
    criteria: { subject_type: 'BOTH', city: 'Douala' },
    criteria_schema_version: '1.0',
    created_by: ID_ACCOUNT,
    version: 1,
    updated_at: NOW,
    ...overrides,
  }
}

function sampleCampaign(overrides: Partial<CampaignDefinition> = {}): CampaignDefinition {
  return {
    id: ID_CAMPAIGN,
    name: 'Horaires fin d’année',
    segment_id: ID_SEGMENT,
    template_version_id: ID_TVER_1,
    approval_id: null,
    status: 'DRAFT',
    created_by: ID_ACCOUNT,
    scheduled_at: null,
    target_frozen_at: null,
    eligible_count: 0,
    excluded_count: 0,
    delivered_count: 0,
    failed_count: 0,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  }
}

function sampleRecipient(overrides: Partial<CampaignRecipient> = {}): CampaignRecipient {
  return {
    id: ID_RECIPIENT,
    campaign_id: ID_CAMPAIGN,
    patient_id: ID_PATIENT,
    prospect_contact_id: null,
    destination_masked: '+237***0001',
    consent_event_id: ID_CONSENT,
    status: 'PENDING',
    exclusion_reason: null,
    consent_checked_at: NOW,
    ...overrides,
  }
}

function sampleOutbox(overrides: Partial<OutboxEvent> = {}): OutboxEvent {
  return {
    id: ID_OUTBOX,
    event_type: 'AppointmentConfirmed',
    event_version: 1,
    source_type: 'Appointment',
    source_id: ID_APPOINTMENT,
    source_version: 1,
    correlation_id: 'corr-101',
    status: 'PENDING',
    attempt_count: 0,
    next_attempt_at: null,
    processed_at: null,
    last_error_code: null,
    created_at: NOW,
    ...overrides,
  }
}

function sampleWebhook(overrides: Partial<WebhookInboxItem> = {}): WebhookInboxItem {
  return {
    id: ID_WEBHOOK,
    integration_account_id: ID_ACCOUNT,
    provider_event_key: 'meta-evt-777',
    payload_hash: 'a'.repeat(64),
    status: 'PROCESSED',
    attempt_count: 1,
    last_error_code: null,
    received_at: NOW,
    verified_at: NOW,
    processed_at: NOW,
    ...overrides,
  }
}

describe('Communication & CRM L2 frontend', () => {
  beforeEach(() => {
    resetSessionForTests()
  })

  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()?.()
    }
    document.body.innerHTML = ''
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  describe('domain/communication/types.ts', () => {
    it('détecte les critères cliniques interdits dans les segments et accepte les critères administratifs', () => {
      expect(
        detectForbiddenSegmentTerms({
          subject_type: 'PATIENT',
          city: 'Douala',
          origin: 'WEBSITE',
          last_visit_days: 90,
          min_appointments: 1,
          has_quote: false,
        }),
      ).toEqual([])

      expect(
        detectForbiddenSegmentTerms({
          subject_type: 'PATIENT',
          city: 'Patient avec Glaucome ou Diabète',
        }),
      ).toEqual(['diabete', 'glaucome'])

      expect(
        detectForbiddenSegmentTerms({
          diagnosis: 'myopie',
          prescription_min: -3,
        }),
      ).toEqual(['diagnosis', 'prescription_min'])
    })

    it('formate les décalages de relance, parse les variables et valide les sujets et JSON', () => {
      expect(formatReminderOffset(-1, 'DAY', '09:00')).toBe('1 jour(s) avant à 09:00')
      expect(formatReminderOffset(0, 'DAY', '08:30')).toBe('Le jour même à 08:30')
      expect(formatReminderOffset(2, 'HOUR', null)).toBe('2 heure(s) après')

      expect(parseAllowedVariablesInput(' patient_name, date ; patient_name ')).toEqual([
        'patient_name',
        'date',
      ])

      expect(validateConsentSubject(null, null)).toContain('patient ou un prospect')
      expect(validateConsentSubject(ID_PATIENT, ID_PROSPECT)).toContain('jamais les deux')
      expect(validateConsentSubject(ID_PATIENT, null)).toBeNull()

      expect(parseOptionalJsonObject('', 'Config')).toEqual({ ok: true, value: null })
      expect(parseOptionalJsonObject('[]', 'Config')).toEqual({
        ok: false,
        error: 'Config doit être un objet JSON valide.',
      })
      expect(parseOptionalJsonObject('{bad', 'Config')).toEqual({
        ok: false,
        error: 'Config contient une syntaxe JSON invalide.',
      })
      expect(parseOptionalJsonObject('{"region":"cm"}', 'Config')).toEqual({
        ok: true,
        value: { region: 'cm' },
      })

      const approved = sampleTemplate({
        versions: [
          sampleTemplateVersion({ id: ID_TVER_1, provider_approval_status: 'PENDING' }),
          sampleTemplateVersion({
            id: ID_KVER_APPROVED,
            revision_no: 2,
            provider_approval_status: 'APPROVED',
          }),
        ],
      })
      const options = listApprovedTemplateVersions([approved])
      expect(options).toHaveLength(1)
      expect(options[0]?.version.id).toBe(ID_KVER_APPROVED)
    })

    it('ne contient aucun mot interdit dans les libellés et badges du domaine', () => {
      const badgeTexts = [
        ...Object.values(INTEGRATION_PROVIDER_LABELS),
        ...Object.values(INTEGRATION_STATUS_BADGES).map((b) => b.label),
        ...Object.values(INTEGRATION_MODE_BADGES).map((b) => b.label),
        ...Object.values(OUTBOX_STATUS_BADGES).map((b) => b.label),
        ...Object.values(WEBHOOK_STATUS_BADGES).map((b) => b.label),
        ...Object.values(PUBLIC_BOOKING_STATUS_BADGES).map((b) => b.label),
        ...Object.values(CALENDAR_SYNC_STATUS_BADGES).map((b) => b.label),
        ...Object.values(PROSPECT_ORIGIN_LABELS),
        ...Object.values(CRM_LEAD_STATUS_BADGES).map((b) => b.label),
        ...Object.values(CRM_CHANNEL_LABELS),
        ...Object.values(CONVERSATION_STATUS_BADGES).map((b) => b.label),
        ...Object.values(HANDOFF_EVENT_BADGES).map((b) => b.label),
        ...Object.values(ASSISTANT_RUN_STATUS_BADGES).map((b) => b.label),
        ...Object.values(KNOWLEDGE_CATEGORY_LABELS),
        ...Object.values(CONSENT_CHANNEL_LABELS),
        ...Object.values(CONSENT_PURPOSE_LABELS),
        ...Object.values(CONSENT_STATUS_BADGES).map((b) => b.label),
        ...Object.values(TEMPLATE_CHANNEL_LABELS),
        ...Object.values(TEMPLATE_PURPOSE_LABELS),
        ...Object.values(TEMPLATE_APPROVAL_BADGES).map((b) => b.label),
        ...Object.values(REMINDER_CHANNEL_LABELS),
        ...Object.values(REMINDER_OFFSET_UNIT_LABELS),
        ...Object.values(REMINDER_PURPOSE_LABELS),
        ...Object.values(MESSAGE_ATTEMPT_STATUS_BADGES).map((b) => b.label),
        ...Object.values(CAMPAIGN_STATUS_BADGES).map((b) => b.label),
        ...Object.values(CAMPAIGN_RECIPIENT_STATUS_BADGES).map((b) => b.label),
      ].join(' ')
      expect(forbiddenWordsInText(badgeTexts)).toEqual([])
    })
  })

  describe('app/services/communication.ts', () => {
    it('propage Idempotency-Key, les filtres de requête et NetworkUnavailable', async () => {
      const { requests } = stubFetchRouter((req) => {
        if (req.path === '/public/v1/services') {
          return json(200, {
            data: [{ id: ID_SERVICE, name: 'Bilan visuel', duration_minutes: 30, price_amount: 0 }],
          })
        }
        if (req.path === '/public/v1/slots') {
          return json(200, {
            data: [{ starts_at: NOW, ends_at: NOW, resource_ids: [ID_RESOURCE] }],
          })
        }
        if (req.path === '/public/v1/booking-requests' && req.method === 'POST') {
          return json(201, {
            data: {
              booking_request_id: ID_BOOKING,
              public_reference: 'RDV-2026-0042',
              status: 'RECEIVED',
            },
          })
        }
        if (req.path === '/api/v1/integrations/health') return 'network'
        return apiError(404, 'RESOURCE_NOT_FOUND', 'Non trouvé')
      })

      const services = await communicationApi.listPublicServices()
      expect(services.data[0]?.name).toBe('Bilan visuel')

      await communicationApi.listPublicSlots({
        serviceId: ID_SERVICE,
        from: '2026-11-20',
        to: '2026-11-21',
      })
      const slotReq = requests.find((r) => r.path === '/public/v1/slots')
      expect(slotReq?.query.get('service_id')).toBe(ID_SERVICE)
      expect(slotReq?.query.get('from')).toBe('2026-11-20')

      const receipt = await communicationApi.submitPublicBookingRequest(
        {
          service_id: ID_SERVICE,
          starts_at: '2026-11-20T09:00:00.000Z',
          name: 'Nadia Mbarga',
          phone: '+237690000001',
          consent: true,
        },
        'idem-public-booking-1',
      )
      expect(receipt.public_reference).toBe('RDV-2026-0042')
      const postBooking = requests.find((r) => r.path === '/public/v1/booking-requests')
      expect(postBooking?.headers['Idempotency-Key']).toBe('idem-public-booking-1')

      await expect(communicationApi.getIntegrationsHealth()).rejects.toBeInstanceOf(
        NetworkUnavailable,
      )
    })
  })

  describe('PAGES_COMMUNICATION (fiches d’aide)', () => {
    it('couvre les 9 routes nommées L2 sans mots interdits ni promesses fausses', () => {
      const routes = PAGES_COMMUNICATION.map((p) => p.route)
      expect(routes).toEqual([
        'integrations',
        'communication',
        'communication-bookings',
        'communication-crm',
        'communication-knowledge',
        'communication-handoffs',
        'communication-consents',
        'communication-campaigns',
        'communication-outbox',
      ])

      for (const page of PAGES_COMMUNICATION) {
        expect(page.actions.length).toBeGreaterThan(0)
        expect(page.rules.length).toBeGreaterThan(0)
        const taskIds = page.tasks.map((t) => t.id)
        expect(new Set(taskIds).size).toBe(taskIds.length)

        const blob = [
          page.title,
          page.purpose,
          ...page.actions.map((a) => `${a.label} ${a.effect}`),
          ...page.tasks.flatMap((t) => [t.title, ...t.steps, t.result ?? '']),
          ...page.rules,
          ...(page.problems ?? []).flatMap((p) => [p.symptom, p.remedy]),
        ].join(' ')

        expect(forbiddenWordsInText(blob)).toEqual([])
        expect(findPromises(blob)).toEqual([])
      }
    })
  })

  describe('Écrans Vue L2', () => {
    it('Integrations.vue affiche la santé, teste la connexion et gère le 423 avec même Idempotency-Key', async () => {
      const accounts = [sampleAccount()]
      let unlocked = false
      const createKeys: string[] = []

      const { requests } = stubFetchRouter((req) => {
        if (req.path === '/api/v1/integrations/health' && req.method === 'GET') {
          return json(200, { data: sampleHealth(accounts) })
        }
        if (
          req.path === `/api/v1/integrations/accounts/${ID_ACCOUNT}/test` &&
          req.method === 'POST'
        ) {
          return json(200, {
            data: {
              integration_account_id: ID_ACCOUNT,
              provider: 'GOOGLE',
              mode: 'fake',
              status: 'ACTIVE',
              reachable: true,
              checked_at: NOW,
              detail: 'Ping Google OK (simulation locale)',
            },
          })
        }
        if (req.path === '/api/v1/auth/reauthenticate' && req.method === 'POST') {
          unlocked = true
          return json(200, { data: { reauthenticated_until: '2026-11-15T10:15:00.000Z' } })
        }
        if (req.path === '/api/v1/integrations/accounts' && req.method === 'POST') {
          createKeys.push(req.headers['Idempotency-Key'] ?? '')
          if (!unlocked) {
            return apiError(423, 'REAUTHENTICATION_REQUIRED', 'Confirmez votre mot de passe.')
          }
          const created = sampleAccount({
            id: ID_OUTBOX,
            provider: 'META_WHATSAPP',
            external_account_id: 'wa-douala-01',
            display_name: 'WhatsApp Officiel',
            status: 'ACTIVE',
          })
          accounts.push(created)
          return json(201, { data: created })
        }
        return apiError(404, 'NOT_FOUND', 'Route inconnue')
      })

      await refreshSession()
      const router = await makeTestRouter('/parametres/integrations')
      const { ui } = await mountPage(Integrations, router)

      expect(textOf(ui)).toContain('Intégrations et connecteurs')
      expect(textOf(ui)).toContain('Google Agenda Principal')
      expect(textOf(ui)).toContain('Secret chiffré')

      await pressButton(ui, 'Tester la connexion')
      expect(textOf(ui)).toContain('Connectivité vérifiée')

      await selectOptionValue(ui, 'Fournisseur', 'META_WHATSAPP')
      await setFieldValue(ui, 'Identifiant externe', 'wa-douala-01')
      await setFieldValue(ui, 'Nom affiché', 'WhatsApp Officiel')
      await setFieldValue(
        ui,
        'Identifiants secrets (objet JSON, chiffré au repos)',
        '{"token":"tok-123"}',
      )

      await pressButton(ui, 'Enregistrer le compte')
      expect(textOf(ui)).toContain('Confirmer votre mot de passe')

      await setFieldValue(ui, 'Mot de passe', 'secret-gerante')
      await pressButton(ui, 'Confirmer et reprendre')

      expect(createKeys).toHaveLength(2)
      expect(createKeys[0]).toBeTruthy()
      expect(createKeys[0]).toBe(createKeys[1])
      expect(requests.some((r) => r.path === '/api/v1/auth/reauthenticate')).toBe(true)
      expect(textOf(ui)).toContain('WhatsApp Officiel')
    })

    it('CommunicationHomePage.vue filtre les tuiles selon les droits effectifs', async () => {
      let currentPerms = FULL_COMMS_PERMS
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: unknown): Promise<Response> => {
          const url = new URL(String(input), 'https://cabinet.test')
          if (url.pathname === '/api/v1/auth/me') {
            return json(
              200,
              meResponse(currentPerms, 'Utilisateur', [...ALL_TEST_MODULES, 'communication']),
            )
          }
          return json(200, { data: [] })
        }),
      )

      await refreshSession()
      const router = await makeTestRouter('/communication')
      const fullMount = await mountPage(CommunicationHomePage, router)
      expect(textOf(fullMount.ui)).toContain('Réservations en ligne & Google Agenda')
      expect(textOf(fullMount.ui)).toContain('Segments & campagnes')
      expect(textOf(fullMount.ui)).toContain('Intégrations et connecteurs')
      fullMount.unmount()

      currentPerms = ['conversation.takeover']
      await refreshSession()
      const limitedMount = await mountPage(CommunicationHomePage, router)
      expect(textOf(limitedMount.ui)).toContain('Assistant borné & reprises humaines')
      expect(textOf(limitedMount.ui)).not.toContain('Segments & campagnes')
      limitedMount.unmount()

      currentPerms = ['stock.read']
      await refreshSession()
      const emptyMount = await mountPage(CommunicationHomePage, router)
      expect(textOf(emptyMount.ui)).toContain(
        'Aucun écran de communication n’est ouvert sur ce compte.',
      )
    })

    it('PublicBookingsAdminPage.vue confirme une réservation et synchronise Google Agenda', async () => {
      let booking = sampleBooking()
      const calendarStates: CalendarSyncState[] = [sampleCalendarState()]

      stubFetchRouter((req) => {
        if (req.path === '/api/v1/public-bookings' && req.method === 'GET') {
          return json(200, { data: [booking], meta: pageMeta(1) })
        }
        if (req.path === '/api/v1/integrations/google/states' && req.method === 'GET') {
          return json(200, { data: calendarStates })
        }
        if (req.path === '/api/v1/agenda/configuration') {
          return json(200, {
            data: {
              clinic_settings: {},
              resources: [
                {
                  id: ID_RESOURCE,
                  name: 'Salle Optométrie 1',
                  kind: 'CONSULTATION_ROOM',
                  active: true,
                },
              ],
              services: [],
            },
          })
        }
        if (req.path === '/api/v1/integrations/accounts') {
          return json(200, { data: [sampleAccount()] })
        }
        if (req.path === `/api/v1/public-bookings/${ID_BOOKING}/confirm` && req.method === 'POST') {
          booking = sampleBooking({ status: 'CONFIRMED', appointment_id: ID_APPOINTMENT })
          return json(200, { data: booking })
        }
        if (req.path === '/api/v1/integrations/google/sync' && req.method === 'POST') {
          return json(200, {
            data: {
              synced_states: 1,
              pushed_appointments: 1,
              pulled_blocks: 2,
              conflicts: 0,
            },
          })
        }
        return apiError(404, 'NOT_FOUND', 'Route inconnue')
      })

      await refreshSession()
      const router = await makeTestRouter('/communication/reservations')
      const { ui } = await mountPage(PublicBookingsAdminPage, router)

      expect(textOf(ui)).toContain('RDV-2026-0042')
      expect(textOf(ui)).toContain('Salle Optométrie 1')

      await pressButton(ui, 'Confirmer')
      expect(textOf(ui)).toContain('Demande RDV-2026-0042 confirmée')

      await pressButton(ui, 'Synchroniser Google Agenda')
      expect(textOf(ui)).toContain('Synchronisation Google Agenda terminée')
      expect(textOf(ui)).toContain('2 indisponibilité(s) importées')
    })

    it('CrmLinks.vue crée un prospect, le rattache à un patient et synchronise Kommo', async () => {
      const prospects: ProspectContact[] = [sampleProspect()]

      stubFetchRouter((req) => {
        if (req.path === '/api/v1/crm/prospects' && req.method === 'GET') {
          return json(200, { data: prospects, meta: pageMeta(prospects.length) })
        }
        if (req.path === '/api/v1/crm/prospects' && req.method === 'POST') {
          const added = sampleProspect({
            id: ID_TASK,
            name: String(req.body?.['name'] ?? 'Nouveau'),
            origin: 'INSTAGRAM',
          })
          prospects.push(added)
          return json(201, { data: added })
        }
        if (
          req.path === `/api/v1/crm/prospects/${ID_PROSPECT}/link-patient` &&
          req.method === 'POST'
        ) {
          prospects[0] = sampleProspect({
            patient_id: String(req.body?.['patient_id'] ?? ID_PATIENT),
          })
          return json(200, { data: prospects[0] })
        }
        if (req.path === '/api/v1/crm/leads' && req.method === 'GET') {
          return json(200, { data: [sampleLead()], meta: pageMeta(1) })
        }
        if (req.path === '/api/v1/crm/leads/sync' && req.method === 'POST') {
          return json(200, {
            data: { synced: 3, created: 1, updated: 2, conflicts: 0 },
          })
        }
        if (req.path === '/api/v1/crm/conversations' && req.method === 'GET') {
          return json(200, { data: [sampleConversation()], meta: pageMeta(1) })
        }
        return apiError(404, 'NOT_FOUND', 'Route inconnue')
      })

      await refreshSession()
      const router = await makeTestRouter('/communication/crm')
      const { ui } = await mountPage(CrmLinks, router)

      expect(textOf(ui)).toContain('Nadia Mbarga')
      expect(textOf(ui)).toContain('kommo-998')

      await pressButton(ui, 'Rattacher un patient')
      await setFieldValue(ui, 'Identifiant ULID du patient', ID_PATIENT)
      await pressButton(ui, 'Valider le rattachement')
      expect(textOf(ui)).toContain(`Patient lié · ${ID_PATIENT}`)

      await pressButton(ui, 'Synchroniser Kommo CRM')
      expect(textOf(ui)).toContain('3 piste(s) synchronisée(s)')
    })

    it('Knowledge.vue crée une fiche, approuve et publie une révision unique', async () => {
      let entry = sampleKnowledgeEntry()

      stubFetchRouter((req) => {
        if (req.path === '/api/v1/knowledge' && req.method === 'GET') {
          return json(200, { data: [entry], meta: pageMeta(1) })
        }
        if (
          req.path === `/api/v1/knowledge/versions/${ID_KVER_DRAFT}/approve` &&
          req.method === 'POST'
        ) {
          const approved = sampleKnowledgeVersion({
            approved_at: NOW,
            approved_by: ID_ACCOUNT,
          })
          entry = sampleKnowledgeEntry({ versions: [approved] })
          return json(200, { data: approved })
        }
        if (
          req.path === `/api/v1/knowledge/versions/${ID_KVER_DRAFT}/publish` &&
          req.method === 'POST'
        ) {
          const published = sampleKnowledgeVersion({
            approved_at: NOW,
            published_at: NOW,
            is_published: true,
          })
          entry = sampleKnowledgeEntry({ published_version: published, versions: [published] })
          return json(200, { data: published })
        }
        return apiError(404, 'NOT_FOUND', 'Route inconnue')
      })

      await refreshSession()
      const router = await makeTestRouter('/communication/connaissances')
      const { ui } = await mountPage(Knowledge, router)

      expect(textOf(ui)).toContain('Horaires d’ouverture du cabinet')
      await pressButton(ui, 'Approuver la révision')
      expect(textOf(ui)).toContain('Approuvée (prête)')

      await pressButton(ui, 'Publier cette révision')
      expect(textOf(ui)).toContain('Version publiée active : r1 (fr)')
    })

    it('Handoffs.vue affiche le refus clinique et les citations après un tour, puis bascule humain/bot', async () => {
      let conv = sampleConversation()
      const handoffs: ConversationHandoff[] = []
      const runs: AssistantRun[] = []

      stubFetchRouter((req) => {
        if (req.path === '/api/v1/crm/conversations' && req.method === 'GET') {
          return json(200, { data: [conv], meta: pageMeta(1) })
        }
        if (req.path === `/api/v1/crm/conversations/${ID_CONVERSATION}` && req.method === 'GET') {
          return json(200, { data: conv })
        }
        if (
          req.path === `/api/v1/crm/conversations/${ID_CONVERSATION}/handoffs` &&
          req.method === 'GET'
        ) {
          return json(200, { data: handoffs })
        }
        if (
          req.path === `/api/v1/crm/conversations/${ID_CONVERSATION}/runs` &&
          req.method === 'GET'
        ) {
          return json(200, { data: runs })
        }
        if (
          req.path === `/api/v1/crm/conversations/${ID_CONVERSATION}/assistant-turn` &&
          req.method === 'POST'
        ) {
          const run = sampleAssistantRun({ status: 'COMPLETED' })
          const result: AssistantTurnResult = {
            run,
            conversation_status: 'BOT_ACTIVE',
            reply:
              'Je ne peux pas formuler de conseil clinique ; je vous propose un rendez-vous au cabinet.',
            clinical_refusal: true,
            handoff_triggered: false,
            knowledge_citations: ['HORAIRES_OUVERTURE#r1'],
            booking_reference: null,
          }
          runs.push(run)
          return json(200, { data: result })
        }
        if (
          req.path === `/api/v1/crm/conversations/${ID_CONVERSATION}/handoff` &&
          req.method === 'POST'
        ) {
          conv = sampleConversation({ status: 'HUMAN_TAKEOVER' })
          handoffs.push(sampleHandoff())
          return json(200, { data: conv })
        }
        if (
          req.path === `/api/v1/crm/conversations/${ID_CONVERSATION}/resume-bot` &&
          req.method === 'POST'
        ) {
          conv = sampleConversation({ status: 'BOT_ACTIVE' })
          handoffs.push(sampleHandoff({ id: ID_TASK, event_type: 'RESUME_BOT' }))
          return json(200, { data: conv })
        }
        return apiError(404, 'NOT_FOUND', 'Route inconnue')
      })

      await refreshSession()
      const router = await makeTestRouter('/communication/assistant')
      const { ui } = await mountPage(Handoffs, router)

      await pressButton(ui, 'Inspecter')
      await setFieldValue(ui, 'Message du contact', 'Quel collyre utiliser pour ma douleur ?')
      await pressButton(ui, 'Exécuter un tour d’assistant')

      expect(textOf(ui)).toContain('Question à caractère clinique refusée par l’assistant')
      expect(textOf(ui)).toContain('HORAIRES_OUVERTURE#r1')

      await setFieldValue(ui, 'Motif du transfert humain', 'Client demande l’accueil')
      await pressButton(ui, 'Basculer vers un conseiller humain')
      expect(textOf(ui)).toContain('Conversation basculée vers un conseiller humain')

      await pressButton(ui, 'Rendre la main à l’assistant')
      expect(textOf(ui)).toContain('suivie par l’assistant')
    })

    it('Consents.vue gère opt-in/opt-out, modèles, politiques et envoi transactionnel', async () => {
      const consents: CommunicationConsent[] = [sampleConsent()]
      const templates: MessageTemplate[] = [sampleTemplate()]
      const policies: ReminderPolicy[] = [samplePolicy()]
      const attempts: MessageAttempt[] = [sampleAttempt()]

      stubFetchRouter((req) => {
        if (req.path === '/api/v1/communication/consents' && req.method === 'GET') {
          return json(200, { data: consents, meta: pageMeta(consents.length) })
        }
        if (req.path === '/api/v1/communication/consents' && req.method === 'POST') {
          const item = sampleConsent({ id: ID_OUTBOX, event_sequence: 2, status: 'GRANTED' })
          consents.unshift(item)
          return json(201, { data: item })
        }
        if (req.path === '/api/v1/communication/consents/revoke' && req.method === 'POST') {
          const item = sampleConsent({ id: ID_WEBHOOK, event_sequence: 3, status: 'REVOKED' })
          consents.unshift(item)
          return json(201, { data: item })
        }
        if (req.path === '/api/v1/communication/templates' && req.method === 'GET') {
          return json(200, { data: templates })
        }
        if (
          req.path === `/api/v1/communication/templates/versions/${ID_TVER_1}/approve` &&
          req.method === 'POST'
        ) {
          templates[0] = sampleTemplate({
            versions: [
              sampleTemplateVersion({ provider_approval_status: 'APPROVED', approved_at: NOW }),
            ],
          })
          return json(200, { data: templates[0].versions[0] })
        }
        if (req.path === '/api/v1/communication/reminder-policies' && req.method === 'GET') {
          return json(200, { data: policies })
        }
        if (req.path === '/api/v1/communication/reminder-policies' && req.method === 'POST') {
          const created = samplePolicy({
            id: ID_RECIPIENT,
            code: 'DEVIS_J3',
            label: 'Relance devis',
          })
          policies.push(created)
          return json(201, { data: created })
        }
        if (req.path === '/api/v1/communication/attempts' && req.method === 'GET') {
          return json(200, { data: attempts, meta: pageMeta(attempts.length) })
        }
        if (req.path === `/api/v1/communication/tasks/${ID_TASK}/send` && req.method === 'POST') {
          const sent = sampleAttempt({ id: ID_OUTBOX, dedupe_key: 'task-01J-2' })
          attempts.unshift(sent)
          return json(200, { data: sent })
        }
        if (
          req.path === `/api/v1/communication/attempts/${ID_OUTBOX}/reconcile` &&
          req.method === 'POST'
        ) {
          attempts[0] = sampleAttempt({
            id: ID_OUTBOX,
            status: 'DELIVERED',
            dedupe_key: 'task-01J-2',
          })
          return json(200, { data: attempts[0] })
        }
        return apiError(404, 'NOT_FOUND', 'Route inconnue')
      })

      await refreshSession()
      const router = await makeTestRouter('/communication/consentements')
      const { ui } = await mountPage(Consents, router)

      await setFieldValue(ui, 'ULID patient (si dossier existant)', ID_PATIENT)
      await setFieldValue(ui, 'Numéro ou adresse exacte', '+237690000001')
      await setFieldValue(ui, 'Preuve vérifiable', 'Accord écrit accueil')
      await pressButton(ui, 'Enregistrer l’opt-in')
      expect(textOf(ui)).toContain('séquence 2')

      await setFieldValue(ui, 'Preuve vérifiable', 'STOP reçu par SMS')
      await pressButton(ui, 'Révoquer immédiatement (opt-out)')
      expect(textOf(ui)).toContain('Opt-out immédiat enregistré')

      await pressButton(ui, 'Approuver le modèle')
      expect(textOf(ui)).toContain('Révision r1 approuvée')

      await setFieldValue(ui, 'Identifiant ULID de la tâche de contact', ID_TASK)
      await pressButton(ui, 'Envoyer le message transactionnel')
      expect(textOf(ui)).toContain('task-01J-2')

      await pressButton(ui, 'Rapprocher le statut')
      expect(textOf(ui)).toContain('Tentative rapprochée')
    })

    it('Campaigns.vue bloque les critères cliniques, demande CAMPAIGN_SEND, gèle et exécute', async () => {
      const segments: AudienceSegment[] = [sampleSegment()]
      const campaigns: CampaignDefinition[] = [sampleCampaign()]
      const recipients: CampaignRecipient[] = []
      let segmentPostCalled = false

      stubFetchRouter((req) => {
        if (req.path === '/api/v1/communication/segments' && req.method === 'GET') {
          return json(200, { data: segments })
        }
        if (req.path === '/api/v1/communication/segments' && req.method === 'POST') {
          segmentPostCalled = true
          return json(201, { data: sampleSegment() })
        }
        if (req.path === '/api/v1/communication/templates') {
          return json(200, {
            data: [
              sampleTemplate({
                versions: [sampleTemplateVersion({ provider_approval_status: 'APPROVED' })],
              }),
            ],
          })
        }
        if (req.path === '/api/v1/communication/campaigns' && req.method === 'GET') {
          return json(200, { data: campaigns, meta: pageMeta(campaigns.length) })
        }
        if (
          req.path === `/api/v1/communication/campaigns/${ID_CAMPAIGN}/recipients` &&
          req.method === 'GET'
        ) {
          return json(200, { data: recipients, meta: pageMeta(recipients.length) })
        }
        if (
          req.path === `/api/v1/communication/campaigns/${ID_CAMPAIGN}/preview` &&
          req.method === 'POST'
        ) {
          const preview: CampaignPreview = {
            campaign_id: ID_CAMPAIGN,
            total_candidates: 12,
            eligible_count: 9,
            excluded_count: 3,
            sample: [sampleRecipient({ status: 'ELIGIBLE' })],
          }
          return json(200, { data: preview })
        }
        if (req.path === '/api/v1/approvals' && req.method === 'POST') {
          const approval: Approval = {
            id: ID_APPROVAL,
            kind: 'CAMPAIGN_SEND',
            action_code: 'communication.manage',
            target_type: 'campaign_definitions',
            target_id: ID_CAMPAIGN,
            payload_hash: 'b'.repeat(64),
            subject: {
              kind: 'CAMPAIGN_SEND',
              campaign_id: ID_CAMPAIGN,
              segment_id: ID_SEGMENT,
              template_version_id: ID_TVER_1,
              eligible_count: 9,
            },
            reason: String(req.body?.['reason'] ?? ''),
            status: 'APPROVED',
            effective_status: 'APPROVED',
            requested_by: ID_ACCOUNT,
            requested_by_name: 'Accueil Test',
            requested_at: NOW,
            decided_by: ID_ACCOUNT,
            decided_by_name: 'Gérante Test',
            decided_at: NOW,
            decision_reason: null,
            expires_at: null,
            consumed_at: null,
            target: {
              patient: null,
              invoice_number: null,
              visit_occurred_at: null,
              payment: null,
            },
          }
          return json(201, { data: approval })
        }
        if (
          req.path === `/api/v1/communication/campaigns/${ID_CAMPAIGN}/freeze` &&
          req.method === 'POST'
        ) {
          campaigns[0] = sampleCampaign({
            status: 'APPROVED',
            approval_id: ID_APPROVAL,
            eligible_count: 9,
            excluded_count: 3,
            target_frozen_at: NOW,
          })
          recipients.push(sampleRecipient({ status: 'ELIGIBLE' }))
          return json(200, { data: campaigns[0] })
        }
        if (
          req.path === `/api/v1/communication/campaigns/${ID_CAMPAIGN}/execute` &&
          req.method === 'POST'
        ) {
          campaigns[0] = sampleCampaign({
            status: 'COMPLETED',
            approval_id: ID_APPROVAL,
            eligible_count: 9,
            excluded_count: 3,
            delivered_count: 9,
            failed_count: 0,
            target_frozen_at: NOW,
          })
          recipients[0] = sampleRecipient({ status: 'SUBMITTED' })
          return json(200, { data: campaigns[0] })
        }
        return apiError(404, 'NOT_FOUND', 'Route inconnue')
      })

      await refreshSession()
      const router = await makeTestRouter('/communication/campagnes')
      const { ui } = await mountPage(Campaigns, router, { withDispatcher: true })

      await setFieldValue(ui, 'Nom du segment', 'Segment interdit test')
      await setFieldValue(ui, 'Ville / quartier administratif', 'glaucome')
      await pressButton(ui, 'Enregistrer le segment')
      expect(textOf(ui)).toContain('Critère clinique interdit')
      expect(segmentPostCalled).toBe(false)

      await pressButton(ui, 'Piloter')
      await pressButton(ui, 'Prévisualiser l’audience')
      expect(textOf(ui)).toContain('9 admissible(s) · 3 exclu(s)')

      await pressButton(ui, 'Demander l’autorisation d’envoi')
      await setFieldValue(ui, 'Motif de la demande', 'Campagne horaire validée')
      await pressButton(ui, 'Envoyer la demande à la gérante')
      expect(textOf(ui)).toContain(ID_APPROVAL)

      await pressButton(ui, 'Geler la campagne')
      expect(textOf(ui)).toContain('Campagne gelée et approuvée')
      expect(textOf(ui)).toContain('+237***0001')

      await pressButton(ui, 'Exécuter un lot d’envoi')
      expect(textOf(ui)).toContain('9 remis · 0 en échec')
    })

    it('OutboxAndWebhooks.vue traite un lot outbox, liste les webhooks et lance le rattrapage global', async () => {
      stubFetchRouter((req) => {
        if (req.path === '/api/v1/integrations/outbox' && req.method === 'GET') {
          return json(200, { data: [sampleOutbox()], meta: pageMeta(1) })
        }
        if (req.path === '/api/v1/integrations/outbox/process' && req.method === 'POST') {
          return json(200, { data: { processed: 4, failed: 0, skipped: 1 } })
        }
        if (req.path === '/api/v1/integrations/webhooks' && req.method === 'GET') {
          return json(200, { data: [sampleWebhook()], meta: pageMeta(1) })
        }
        if (req.path === '/api/v1/integrations/reconcile' && req.method === 'POST') {
          return json(200, {
            data: {
              outbox_processed: 4,
              webhooks_processed: 2,
              attempts_reconciled: 3,
              calendar_synced: 1,
            },
          })
        }
        return apiError(404, 'NOT_FOUND', 'Route inconnue')
      })

      await refreshSession()
      const router = await makeTestRouter('/communication/boite-envoi')
      const { ui } = await mountPage(OutboxAndWebhooks, router)

      expect(textOf(ui)).toContain('AppointmentConfirmed')
      expect(textOf(ui)).toContain('meta-evt-777')

      await pressButton(ui, 'Traiter un lot outbox')
      expect(textOf(ui)).toContain('4 traité(s)')

      await pressButton(ui, 'Lancer le rattrapage global')
      expect(textOf(ui)).toContain('Rattrapage global terminé')
      expect(textOf(ui)).toContain('3 tentative(s) rapprochée(s)')
    })
  })
})
