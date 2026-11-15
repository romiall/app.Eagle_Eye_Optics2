import type {
  AssistantRunsStatus,
  CalendarSyncStatesStatus,
  CampaignDefinitionsStatus,
  CampaignRecipientsStatus,
  CommunicationConsentsChannel,
  CommunicationConsentsPurpose,
  CommunicationConsentsStatus,
  ConversationHandoffsEventType,
  CrmConversationsChannel,
  CrmConversationsStatus,
  CrmLeadsStatus,
  IntegrationAccountsProvider,
  IntegrationAccountsStatus,
  IntegrationHealth,
  KnowledgeEntriesCategory,
  MessageAttemptsStatus,
  MessageTemplate,
  MessageTemplateVersion,
  MessageTemplateVersionsProviderApprovalStatus,
  MessageTemplatesChannel,
  MessageTemplatesPurpose,
  OutboxEventsStatus,
  ProspectContactsOrigin,
  PublicBookingRequestsStatus,
  ReminderPoliciesChannel,
  ReminderPoliciesOffsetUnit,
  ReminderPoliciesPurpose,
  WebhookInboxStatus,
} from '@/domain/contracts/generated'

/**
 * Domaine Communication, CRM et Intégrations (L2) : libellés français, pastilles d’état et règles
 * administratives pures sans appel réseau ni calcul flottant.
 */
export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'gold'

export interface BadgeDescriptor {
  readonly label: string
  readonly tone: BadgeTone
  readonly symbol: string
}

export interface SelectOption<T extends string = string> {
  readonly value: T
  readonly label: string
}

// --- Comptes connecteurs & santé ---

export const INTEGRATION_PROVIDER_LABELS: Readonly<Record<IntegrationAccountsProvider, string>> = {
  GOOGLE: 'Google (Agenda & OAuth)',
  KOMMO: 'Kommo CRM',
  META_WHATSAPP: 'Meta WhatsApp Business',
  META_MESSENGER: 'Meta Messenger',
  META_INSTAGRAM: 'Meta Instagram',
  SMS: 'Passerelle SMS',
  SMTP: 'Messagerie électronique SMTP',
}

export const INTEGRATION_PROVIDER_OPTIONS: readonly SelectOption<IntegrationAccountsProvider>[] = [
  { value: 'GOOGLE', label: INTEGRATION_PROVIDER_LABELS.GOOGLE },
  { value: 'KOMMO', label: INTEGRATION_PROVIDER_LABELS.KOMMO },
  { value: 'META_WHATSAPP', label: INTEGRATION_PROVIDER_LABELS.META_WHATSAPP },
  { value: 'META_MESSENGER', label: INTEGRATION_PROVIDER_LABELS.META_MESSENGER },
  { value: 'META_INSTAGRAM', label: INTEGRATION_PROVIDER_LABELS.META_INSTAGRAM },
  { value: 'SMS', label: INTEGRATION_PROVIDER_LABELS.SMS },
  { value: 'SMTP', label: INTEGRATION_PROVIDER_LABELS.SMTP },
]

export const INTEGRATION_STATUS_BADGES: Readonly<
  Record<IntegrationAccountsStatus, BadgeDescriptor>
> = {
  DISABLED: { label: 'Désactivé', tone: 'neutral', symbol: '⊘' },
  TEST: { label: 'Mode test', tone: 'gold', symbol: '…' },
  ACTIVE: { label: 'Actif', tone: 'success', symbol: '✓' },
  ERROR: { label: 'En erreur', tone: 'danger', symbol: '⚠' },
}

export const INTEGRATION_STATUS_OPTIONS: readonly SelectOption<IntegrationAccountsStatus>[] = [
  { value: 'DISABLED', label: INTEGRATION_STATUS_BADGES.DISABLED.label },
  { value: 'TEST', label: INTEGRATION_STATUS_BADGES.TEST.label },
  { value: 'ACTIVE', label: INTEGRATION_STATUS_BADGES.ACTIVE.label },
  { value: 'ERROR', label: INTEGRATION_STATUS_BADGES.ERROR.label },
]

export const INTEGRATION_MODE_BADGES: Readonly<Record<IntegrationHealth['mode'], BadgeDescriptor>> =
  {
    disabled: { label: 'Désactivé', tone: 'neutral', symbol: '⊘' },
    fake: { label: 'Simulation locale', tone: 'gold', symbol: '…' },
    live: { label: 'Production connectée', tone: 'success', symbol: '✓' },
  }

// --- Boîte d'envoi (Outbox) & Webhooks ---

export const OUTBOX_STATUS_BADGES: Readonly<Record<OutboxEventsStatus, BadgeDescriptor>> = {
  PENDING: { label: 'En attente', tone: 'gold', symbol: '⌛' },
  PROCESSING: { label: 'En cours', tone: 'info', symbol: '…' },
  PROCESSED: { label: 'Traité', tone: 'success', symbol: '✓' },
  FAILED: { label: 'En échec', tone: 'danger', symbol: '⚠' },
}

export const OUTBOX_STATUS_OPTIONS: readonly SelectOption<OutboxEventsStatus>[] = [
  { value: 'PENDING', label: OUTBOX_STATUS_BADGES.PENDING.label },
  { value: 'PROCESSING', label: OUTBOX_STATUS_BADGES.PROCESSING.label },
  { value: 'PROCESSED', label: OUTBOX_STATUS_BADGES.PROCESSED.label },
  { value: 'FAILED', label: OUTBOX_STATUS_BADGES.FAILED.label },
]

export const WEBHOOK_STATUS_BADGES: Readonly<Record<WebhookInboxStatus, BadgeDescriptor>> = {
  RECEIVED: { label: 'Reçu', tone: 'neutral', symbol: '●' },
  VERIFIED: { label: 'Signature vérifiée', tone: 'info', symbol: '…' },
  PROCESSED: { label: 'Traité', tone: 'success', symbol: '✓' },
  REJECTED: { label: 'Rejeté', tone: 'warning', symbol: '✕' },
  FAILED: { label: 'En échec', tone: 'danger', symbol: '⚠' },
}

export const WEBHOOK_STATUS_OPTIONS: readonly SelectOption<WebhookInboxStatus>[] = [
  { value: 'RECEIVED', label: WEBHOOK_STATUS_BADGES.RECEIVED.label },
  { value: 'VERIFIED', label: WEBHOOK_STATUS_BADGES.VERIFIED.label },
  { value: 'PROCESSED', label: WEBHOOK_STATUS_BADGES.PROCESSED.label },
  { value: 'REJECTED', label: WEBHOOK_STATUS_BADGES.REJECTED.label },
  { value: 'FAILED', label: WEBHOOK_STATUS_BADGES.FAILED.label },
]

// --- Réservations publiques & Google Calendar ---

export const PUBLIC_BOOKING_STATUS_BADGES: Readonly<
  Record<PublicBookingRequestsStatus, BadgeDescriptor>
> = {
  RECEIVED: { label: 'Reçue', tone: 'info', symbol: '●' },
  PENDING: { label: 'À traiter', tone: 'gold', symbol: '⌛' },
  CONFIRMED: { label: 'Confirmée', tone: 'success', symbol: '✓' },
  CONFLICT: { label: 'Conflit d’horaire', tone: 'warning', symbol: '⚠' },
  CANCELLED: { label: 'Annulée', tone: 'neutral', symbol: '⊘' },
  REJECTED: { label: 'Refusée', tone: 'danger', symbol: '✕' },
}

export const PUBLIC_BOOKING_STATUS_OPTIONS: readonly SelectOption<PublicBookingRequestsStatus>[] = [
  { value: 'RECEIVED', label: PUBLIC_BOOKING_STATUS_BADGES.RECEIVED.label },
  { value: 'PENDING', label: PUBLIC_BOOKING_STATUS_BADGES.PENDING.label },
  { value: 'CONFIRMED', label: PUBLIC_BOOKING_STATUS_BADGES.CONFIRMED.label },
  { value: 'CONFLICT', label: PUBLIC_BOOKING_STATUS_BADGES.CONFLICT.label },
  { value: 'CANCELLED', label: PUBLIC_BOOKING_STATUS_BADGES.CANCELLED.label },
  { value: 'REJECTED', label: PUBLIC_BOOKING_STATUS_BADGES.REJECTED.label },
]

export const CALENDAR_SYNC_STATUS_BADGES: Readonly<
  Record<CalendarSyncStatesStatus, BadgeDescriptor>
> = {
  NOT_CONFIGURED: { label: 'Non configuré', tone: 'neutral', symbol: '⊘' },
  READY: { label: 'Synchronisé', tone: 'success', symbol: '✓' },
  SYNCING: { label: 'Synchronisation', tone: 'info', symbol: '…' },
  STALE: { label: 'À rafraîchir', tone: 'warning', symbol: '⌛' },
  ERROR: { label: 'En erreur', tone: 'danger', symbol: '⚠' },
}

export const CALENDAR_SYNC_STATUS_OPTIONS: readonly SelectOption<CalendarSyncStatesStatus>[] = [
  { value: 'READY', label: CALENDAR_SYNC_STATUS_BADGES.READY.label },
  { value: 'NOT_CONFIGURED', label: CALENDAR_SYNC_STATUS_BADGES.NOT_CONFIGURED.label },
  { value: 'STALE', label: CALENDAR_SYNC_STATUS_BADGES.STALE.label },
  { value: 'ERROR', label: CALENDAR_SYNC_STATUS_BADGES.ERROR.label },
]

// --- Prospects, Kommo CRM, Conversations & Assistant ---

export const PROSPECT_ORIGIN_LABELS: Readonly<Record<ProspectContactsOrigin, string>> = {
  CRM: 'Kommo CRM',
  WEBSITE: 'Site web',
  WHATSAPP: 'WhatsApp',
  MESSENGER: 'Messenger',
  INSTAGRAM: 'Instagram',
  MANUAL: 'Saisie accueil',
}

export const PROSPECT_ORIGIN_OPTIONS: readonly SelectOption<ProspectContactsOrigin>[] = [
  { value: 'MANUAL', label: PROSPECT_ORIGIN_LABELS.MANUAL },
  { value: 'WEBSITE', label: PROSPECT_ORIGIN_LABELS.WEBSITE },
  { value: 'WHATSAPP', label: PROSPECT_ORIGIN_LABELS.WHATSAPP },
  { value: 'MESSENGER', label: PROSPECT_ORIGIN_LABELS.MESSENGER },
  { value: 'INSTAGRAM', label: PROSPECT_ORIGIN_LABELS.INSTAGRAM },
  { value: 'CRM', label: PROSPECT_ORIGIN_LABELS.CRM },
]

export const CRM_LEAD_STATUS_BADGES: Readonly<Record<CrmLeadsStatus, BadgeDescriptor>> = {
  OPEN: { label: 'Ouverte', tone: 'info', symbol: '●' },
  APPOINTMENT_BOOKED: { label: 'Rendez-vous pris', tone: 'gold', symbol: '✓' },
  HUMAN_TAKEOVER: { label: 'Reprise humaine', tone: 'warning', symbol: '⚠' },
  WON: { label: 'Convertie', tone: 'success', symbol: '✓' },
  LOST: { label: 'Perdue', tone: 'neutral', symbol: '✕' },
  CLOSED: { label: 'Clôturée', tone: 'neutral', symbol: '⊘' },
}

export const CRM_LEAD_STATUS_OPTIONS: readonly SelectOption<CrmLeadsStatus>[] = [
  { value: 'OPEN', label: CRM_LEAD_STATUS_BADGES.OPEN.label },
  { value: 'APPOINTMENT_BOOKED', label: CRM_LEAD_STATUS_BADGES.APPOINTMENT_BOOKED.label },
  { value: 'HUMAN_TAKEOVER', label: CRM_LEAD_STATUS_BADGES.HUMAN_TAKEOVER.label },
  { value: 'WON', label: CRM_LEAD_STATUS_BADGES.WON.label },
  { value: 'LOST', label: CRM_LEAD_STATUS_BADGES.LOST.label },
  { value: 'CLOSED', label: CRM_LEAD_STATUS_BADGES.CLOSED.label },
]

export const CRM_CHANNEL_LABELS: Readonly<Record<CrmConversationsChannel, string>> = {
  WHATSAPP: 'WhatsApp',
  MESSENGER: 'Messenger',
  INSTAGRAM: 'Instagram',
}

export const CONVERSATION_STATUS_BADGES: Readonly<Record<CrmConversationsStatus, BadgeDescriptor>> =
  {
    BOT_ACTIVE: { label: 'Assistant actif', tone: 'info', symbol: '●' },
    HUMAN_TAKEOVER: { label: 'Conseiller humain', tone: 'warning', symbol: '⚠' },
    CLOSED: { label: 'Fermée', tone: 'neutral', symbol: '⊘' },
  }

export const CONVERSATION_STATUS_OPTIONS: readonly SelectOption<CrmConversationsStatus>[] = [
  { value: 'BOT_ACTIVE', label: CONVERSATION_STATUS_BADGES.BOT_ACTIVE.label },
  { value: 'HUMAN_TAKEOVER', label: CONVERSATION_STATUS_BADGES.HUMAN_TAKEOVER.label },
  { value: 'CLOSED', label: CONVERSATION_STATUS_BADGES.CLOSED.label },
]

export const HANDOFF_EVENT_BADGES: Readonly<
  Record<ConversationHandoffsEventType, BadgeDescriptor>
> = {
  REQUEST: { label: 'Demande de transfert', tone: 'gold', symbol: '⌛' },
  TAKEOVER: { label: 'Reprise humaine', tone: 'warning', symbol: '⚠' },
  RESUME_BOT: { label: 'Retour à l’assistant', tone: 'info', symbol: '●' },
  CLOSE: { label: 'Clôture', tone: 'neutral', symbol: '⊘' },
}

export const ASSISTANT_RUN_STATUS_BADGES: Readonly<Record<AssistantRunsStatus, BadgeDescriptor>> = {
  RUNNING: { label: 'En cours', tone: 'info', symbol: '…' },
  COMPLETED: { label: 'Réponse émise', tone: 'success', symbol: '✓' },
  HANDOFF: { label: 'Transfert humain', tone: 'warning', symbol: '⚠' },
  FAILED: { label: 'Échec technique', tone: 'danger', symbol: '✕' },
}

// --- Base de connaissances ---

export const KNOWLEDGE_CATEGORY_LABELS: Readonly<Record<KnowledgeEntriesCategory, string>> = {
  HOURS: 'Horaires d’ouverture',
  LOCATION: 'Adresse & accès',
  PRICING: 'Tarifs indicatifs',
  INSURANCE: 'Assurances & mutuelles',
  SERVICES: 'Prestations du cabinet',
  LENSES: 'Verres & montures',
  PRODUCTS: 'Produits disponibles',
  OTHER: 'Autres informations',
}

export const KNOWLEDGE_CATEGORY_OPTIONS: readonly SelectOption<KnowledgeEntriesCategory>[] = [
  { value: 'HOURS', label: KNOWLEDGE_CATEGORY_LABELS.HOURS },
  { value: 'LOCATION', label: KNOWLEDGE_CATEGORY_LABELS.LOCATION },
  { value: 'PRICING', label: KNOWLEDGE_CATEGORY_LABELS.PRICING },
  { value: 'INSURANCE', label: KNOWLEDGE_CATEGORY_LABELS.INSURANCE },
  { value: 'SERVICES', label: KNOWLEDGE_CATEGORY_LABELS.SERVICES },
  { value: 'LENSES', label: KNOWLEDGE_CATEGORY_LABELS.LENSES },
  { value: 'PRODUCTS', label: KNOWLEDGE_CATEGORY_LABELS.PRODUCTS },
  { value: 'OTHER', label: KNOWLEDGE_CATEGORY_LABELS.OTHER },
]

// --- Consentements, Modèles, Relances & Tentatives d'envoi ---

export const CONSENT_CHANNEL_LABELS: Readonly<Record<CommunicationConsentsChannel, string>> = {
  SMS: 'SMS',
  WHATSAPP: 'WhatsApp',
  CALL: 'Appel téléphonique',
  EMAIL: 'Courriel',
}

export const CONSENT_CHANNEL_OPTIONS: readonly SelectOption<CommunicationConsentsChannel>[] = [
  { value: 'SMS', label: CONSENT_CHANNEL_LABELS.SMS },
  { value: 'WHATSAPP', label: CONSENT_CHANNEL_LABELS.WHATSAPP },
  { value: 'CALL', label: CONSENT_CHANNEL_LABELS.CALL },
  { value: 'EMAIL', label: CONSENT_CHANNEL_LABELS.EMAIL },
]

export const CONSENT_PURPOSE_LABELS: Readonly<Record<CommunicationConsentsPurpose, string>> = {
  APPOINTMENT: 'Rappels de rendez-vous',
  FOLLOW_UP: 'Suivi administratif',
  ORDER_UPDATE: 'Disponibilité de commande',
  PAYMENT_FOLLOW_UP: 'Suivi d’encaissement',
  MARKETING: 'Campagnes d’information',
}

export const CONSENT_PURPOSE_OPTIONS: readonly SelectOption<CommunicationConsentsPurpose>[] = [
  { value: 'APPOINTMENT', label: CONSENT_PURPOSE_LABELS.APPOINTMENT },
  { value: 'FOLLOW_UP', label: CONSENT_PURPOSE_LABELS.FOLLOW_UP },
  { value: 'ORDER_UPDATE', label: CONSENT_PURPOSE_LABELS.ORDER_UPDATE },
  { value: 'PAYMENT_FOLLOW_UP', label: CONSENT_PURPOSE_LABELS.PAYMENT_FOLLOW_UP },
  { value: 'MARKETING', label: CONSENT_PURPOSE_LABELS.MARKETING },
]

export const CONSENT_STATUS_BADGES: Readonly<Record<CommunicationConsentsStatus, BadgeDescriptor>> =
  {
    GRANTED: { label: 'Accordé (opt-in)', tone: 'success', symbol: '✓' },
    REVOKED: { label: 'Révoqué (opt-out)', tone: 'danger', symbol: '⊘' },
  }

export const TEMPLATE_CHANNEL_LABELS: Readonly<Record<MessageTemplatesChannel, string>> = {
  SMS: 'SMS',
  WHATSAPP: 'WhatsApp',
  EMAIL: 'Courriel',
}

export const TEMPLATE_CHANNEL_OPTIONS: readonly SelectOption<MessageTemplatesChannel>[] = [
  { value: 'SMS', label: TEMPLATE_CHANNEL_LABELS.SMS },
  { value: 'WHATSAPP', label: TEMPLATE_CHANNEL_LABELS.WHATSAPP },
  { value: 'EMAIL', label: TEMPLATE_CHANNEL_LABELS.EMAIL },
]

export const TEMPLATE_PURPOSE_LABELS: Readonly<Record<MessageTemplatesPurpose, string>> = {
  ...CONSENT_PURPOSE_LABELS,
}

export const TEMPLATE_PURPOSE_OPTIONS: readonly SelectOption<MessageTemplatesPurpose>[] =
  CONSENT_PURPOSE_OPTIONS

export const TEMPLATE_APPROVAL_BADGES: Readonly<
  Record<MessageTemplateVersionsProviderApprovalStatus, BadgeDescriptor>
> = {
  DRAFT: { label: 'Brouillon', tone: 'neutral', symbol: '…' },
  PENDING: { label: 'En validation fournisseur', tone: 'gold', symbol: '⌛' },
  APPROVED: { label: 'Approuvé', tone: 'success', symbol: '✓' },
  REJECTED: { label: 'Refusé', tone: 'danger', symbol: '✕' },
  PAUSED: { label: 'En pause', tone: 'warning', symbol: '⊘' },
}

export const REMINDER_CHANNEL_LABELS: Readonly<Record<ReminderPoliciesChannel, string>> = {
  INTERNAL: 'Tâche interne',
  CALL: 'Appel téléphonique',
  SMS: 'SMS',
  WHATSAPP: 'WhatsApp',
}

export const REMINDER_CHANNEL_OPTIONS: readonly SelectOption<ReminderPoliciesChannel>[] = [
  { value: 'INTERNAL', label: REMINDER_CHANNEL_LABELS.INTERNAL },
  { value: 'CALL', label: REMINDER_CHANNEL_LABELS.CALL },
  { value: 'SMS', label: REMINDER_CHANNEL_LABELS.SMS },
  { value: 'WHATSAPP', label: REMINDER_CHANNEL_LABELS.WHATSAPP },
]

export const REMINDER_OFFSET_UNIT_LABELS: Readonly<Record<ReminderPoliciesOffsetUnit, string>> = {
  HOUR: 'heure(s)',
  DAY: 'jour(s)',
  MONTH: 'mois',
}

export const REMINDER_OFFSET_UNIT_OPTIONS: readonly SelectOption<ReminderPoliciesOffsetUnit>[] = [
  { value: 'HOUR', label: 'Heures' },
  { value: 'DAY', label: 'Jours' },
  { value: 'MONTH', label: 'Mois' },
]

export const REMINDER_PURPOSE_LABELS: Readonly<Record<ReminderPoliciesPurpose, string>> = {
  APPOINTMENT: 'Rendez-vous',
  FOLLOW_UP: 'Suivi administratif',
  ORDER_UPDATE: 'Commande atelier',
  PAYMENT_FOLLOW_UP: 'Suivi d’encaissement',
}

export const REMINDER_PURPOSE_OPTIONS: readonly SelectOption<ReminderPoliciesPurpose>[] = [
  { value: 'APPOINTMENT', label: REMINDER_PURPOSE_LABELS.APPOINTMENT },
  { value: 'FOLLOW_UP', label: REMINDER_PURPOSE_LABELS.FOLLOW_UP },
  { value: 'ORDER_UPDATE', label: REMINDER_PURPOSE_LABELS.ORDER_UPDATE },
  { value: 'PAYMENT_FOLLOW_UP', label: REMINDER_PURPOSE_LABELS.PAYMENT_FOLLOW_UP },
]

export const MESSAGE_ATTEMPT_STATUS_BADGES: Readonly<
  Record<MessageAttemptsStatus, BadgeDescriptor>
> = {
  PLANNED: { label: 'Planifié', tone: 'neutral', symbol: '⌛' },
  SUBMITTED: { label: 'Transmis au fournisseur', tone: 'info', symbol: '…' },
  DELIVERED: { label: 'Remis', tone: 'success', symbol: '✓' },
  READ: { label: 'Lu', tone: 'success', symbol: '✓' },
  FAILED: { label: 'Échec', tone: 'danger', symbol: '⚠' },
  UNKNOWN: { label: 'Statut inconnu', tone: 'warning', symbol: '?' },
  CANCELLED: { label: 'Annulé', tone: 'neutral', symbol: '⊘' },
}

export const MESSAGE_ATTEMPT_STATUS_OPTIONS: readonly SelectOption<MessageAttemptsStatus>[] = [
  { value: 'PLANNED', label: MESSAGE_ATTEMPT_STATUS_BADGES.PLANNED.label },
  { value: 'SUBMITTED', label: MESSAGE_ATTEMPT_STATUS_BADGES.SUBMITTED.label },
  { value: 'DELIVERED', label: MESSAGE_ATTEMPT_STATUS_BADGES.DELIVERED.label },
  { value: 'READ', label: MESSAGE_ATTEMPT_STATUS_BADGES.READ.label },
  { value: 'FAILED', label: MESSAGE_ATTEMPT_STATUS_BADGES.FAILED.label },
  { value: 'UNKNOWN', label: MESSAGE_ATTEMPT_STATUS_BADGES.UNKNOWN.label },
  { value: 'CANCELLED', label: MESSAGE_ATTEMPT_STATUS_BADGES.CANCELLED.label },
]

// --- Segments & Campagnes ---

export const CAMPAIGN_STATUS_BADGES: Readonly<Record<CampaignDefinitionsStatus, BadgeDescriptor>> =
  {
    DRAFT: { label: 'Brouillon', tone: 'neutral', symbol: '…' },
    APPROVED: { label: 'Gelée & approuvée', tone: 'gold', symbol: '✓' },
    RUNNING: { label: 'En cours d’envoi', tone: 'info', symbol: '…' },
    COMPLETED: { label: 'Terminée', tone: 'success', symbol: '✓' },
    CANCELLED: { label: 'Suspendue / annulée', tone: 'warning', symbol: '⊘' },
    FAILED: { label: 'En échec', tone: 'danger', symbol: '⚠' },
  }

export const CAMPAIGN_STATUS_OPTIONS: readonly SelectOption<CampaignDefinitionsStatus>[] = [
  { value: 'DRAFT', label: CAMPAIGN_STATUS_BADGES.DRAFT.label },
  { value: 'APPROVED', label: CAMPAIGN_STATUS_BADGES.APPROVED.label },
  { value: 'RUNNING', label: CAMPAIGN_STATUS_BADGES.RUNNING.label },
  { value: 'COMPLETED', label: CAMPAIGN_STATUS_BADGES.COMPLETED.label },
  { value: 'CANCELLED', label: CAMPAIGN_STATUS_BADGES.CANCELLED.label },
  { value: 'FAILED', label: CAMPAIGN_STATUS_BADGES.FAILED.label },
]

export const CAMPAIGN_RECIPIENT_STATUS_BADGES: Readonly<
  Record<CampaignRecipientsStatus, BadgeDescriptor>
> = {
  PENDING: { label: 'En attente', tone: 'neutral', symbol: '⌛' },
  ELIGIBLE: { label: 'Admissible', tone: 'info', symbol: '●' },
  EXCLUDED: { label: 'Exclu (opt-out)', tone: 'warning', symbol: '⊘' },
  SUBMITTED: { label: 'Transmis', tone: 'gold', symbol: '…' },
  DELIVERED: { label: 'Remis', tone: 'success', symbol: '✓' },
  FAILED: { label: 'Échec', tone: 'danger', symbol: '⚠' },
  CANCELLED: { label: 'Annulé', tone: 'neutral', symbol: '⊘' },
}

export const CAMPAIGN_RECIPIENT_STATUS_OPTIONS: readonly SelectOption<CampaignRecipientsStatus>[] =
  [
    { value: 'PENDING', label: CAMPAIGN_RECIPIENT_STATUS_BADGES.PENDING.label },
    { value: 'ELIGIBLE', label: CAMPAIGN_RECIPIENT_STATUS_BADGES.ELIGIBLE.label },
    { value: 'EXCLUDED', label: CAMPAIGN_RECIPIENT_STATUS_BADGES.EXCLUDED.label },
    { value: 'SUBMITTED', label: CAMPAIGN_RECIPIENT_STATUS_BADGES.SUBMITTED.label },
    { value: 'DELIVERED', label: CAMPAIGN_RECIPIENT_STATUS_BADGES.DELIVERED.label },
    { value: 'FAILED', label: CAMPAIGN_RECIPIENT_STATUS_BADGES.FAILED.label },
    { value: 'CANCELLED', label: CAMPAIGN_RECIPIENT_STATUS_BADGES.CANCELLED.label },
  ]

// --- Critères administratifs autorisés pour la segmentation ---

export type SegmentTargetType = 'ALL' | 'PATIENT' | 'PROSPECT'

export interface AdministrativeSegmentCriteria {
  target_type?: SegmentTargetType
  city?: string
  origin?: ProspectContactsOrigin
  visited_within_days?: number
  has_upcoming_appointment?: boolean
  has_open_quote?: boolean
}

export const ALLOWED_SEGMENT_CRITERIA_KEYS: readonly string[] = [
  'target_type',
  'city',
  'origin',
  'visited_within_days',
  'has_upcoming_appointment',
  'has_open_quote',
]

const FORBIDDEN_CLINICAL_WORDS: readonly string[] = [
  'diagnostic',
  'pathologie',
  'diabete',
  'glaucome',
  'cataracte',
  'myopie',
  'astigmatisme',
  'hypermetropie',
  'presbytie',
  'ordonnance',
  'prescription',
  'medicament',
  'collyre',
  'acuite',
  'refraction',
  'consultation',
  'antecedent',
  'allergie',
  'tension_oculaire',
  'clinical',
  'diagnosis',
]

function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

/**
 * Vérifie qu'un objet de critères ou un texte saisi pour un segment ne comporte aucun critère
 * clinique ni clé non administrative. Retourne la liste des clés/termes refusés.
 */
export function detectForbiddenSegmentTerms(criteria: Readonly<Record<string, unknown>>): string[] {
  const rejected: string[] = []
  for (const [key, rawValue] of Object.entries(criteria)) {
    const normalizedKey = normalizeForMatch(key)
    if (!ALLOWED_SEGMENT_CRITERIA_KEYS.includes(key)) {
      rejected.push(key)
      continue
    }
    if (typeof rawValue === 'string') {
      const normalizedValue = normalizeForMatch(rawValue)
      for (const forbidden of FORBIDDEN_CLINICAL_WORDS) {
        if (normalizedKey.includes(forbidden) || normalizedValue.includes(forbidden)) {
          rejected.push(forbidden)
        }
      }
    }
  }
  return [...new Set(rejected)]
}

/** Formate un décalage de politique de relance en français sans décimale. */
export function formatReminderOffset(
  value: number,
  unit: ReminderPoliciesOffsetUnit,
  localSendTime: string | null,
): string {
  const direction = value < 0 ? 'avant' : value > 0 ? 'après' : 'au moment de'
  const absValue = Math.abs(value)
  const unitLabel = REMINDER_OFFSET_UNIT_LABELS[unit]
  const base = value === 0 ? 'Le jour même' : `${absValue} ${unitLabel} ${direction}`
  return localSendTime ? `${base} à ${localSendTime}` : base
}

/** Extrait les variables autorisées d'une saisie séparée par virgules ou espaces. */
export function parseAllowedVariablesInput(raw: string): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const token of raw.split(/[\s,;]+/)) {
    const cleaned = token.trim()
    if (cleaned !== '' && !seen.has(cleaned)) {
      seen.add(cleaned)
      result.push(cleaned)
    }
  }
  return result
}

export interface ApprovedTemplateOption {
  readonly version: MessageTemplateVersion
  readonly template: MessageTemplate
  readonly label: string
}

/** Liste les révisions de modèles approuvées prêtes pour une campagne ou un envoi. */
export function listApprovedTemplateVersions(
  templates: readonly MessageTemplate[],
): ApprovedTemplateOption[] {
  const options: ApprovedTemplateOption[] = []
  for (const template of templates) {
    for (const version of template.versions) {
      if (version.provider_approval_status === 'APPROVED') {
        options.push({
          version,
          template,
          label: `${template.code} · r${version.revision_no} (${TEMPLATE_CHANNEL_LABELS[template.channel]} · ${TEMPLATE_PURPOSE_LABELS[template.purpose]})`,
        })
      }
    }
  }
  return options
}

/** Vérifie que la cible d'un consentement renseigne exactement un patient ou un prospect. */
export function validateConsentSubject(
  patientId: string | null | undefined,
  prospectContactId: string | null | undefined,
): string | null {
  const hasPatient = Boolean(patientId && patientId.trim() !== '')
  const hasProspect = Boolean(prospectContactId && prospectContactId.trim() !== '')
  if (!hasPatient && !hasProspect) {
    return 'Sélectionnez un patient ou un prospect pour ce consentement.'
  }
  if (hasPatient && hasProspect) {
    return 'Indiquez soit un patient, soit un prospect (jamais les deux à la fois).'
  }
  return null
}

/** Valide l'objet JSON facultatif des identifiants ou réglages connecteur. */
export function parseOptionalJsonObject(
  raw: string,
  fieldLabel: string,
): { ok: true; value: Record<string, unknown> | null } | { ok: false; error: string } {
  const trimmed = raw.trim()
  if (trimmed === '') return { ok: true, value: null }
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (parsed === null) return { ok: true, value: null }
    if (typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, error: `${fieldLabel} doit être un objet JSON valide.` }
    }
    return { ok: true, value: parsed as Record<string, unknown> }
  } catch {
    return { ok: false, error: `${fieldLabel} contient une syntaxe JSON invalide.` }
  }
}
