<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'

import { ApiError, NetworkUnavailable } from '@/app/api'
import { clinicToday, formatInstantFr } from '@/app/clinicTime'
import { listContactTasks } from '@/app/services/agenda'
import {
  approveMessageTemplateVersion,
  createMessageTemplate,
  createMessageTemplateVersion,
  createReminderPolicy,
  listCommunicationConsents,
  listMessageAttempts,
  listMessageTemplates,
  listReminderPolicies,
  newIdempotencyKey,
  reconcileMessageAttempt,
  recordCommunicationConsent,
  revokeCommunicationConsent,
  sendTransactionalTaskMessage,
  updateReminderPolicy,
} from '@/app/services/communication'
import { searchPatients } from '@/app/services/patients'
import { canOnScreen, moduleOpenOnScreen } from '@/app/session'
import ReadNotice from '@/components/feedback/ReadNotice.vue'
import StateMessage from '@/components/feedback/StateMessage.vue'
import CheckboxField from '@/components/form/CheckboxField.vue'
import ComboboxField, { type ComboboxSearchResult } from '@/components/form/ComboboxField.vue'
import SelectField from '@/components/form/SelectField.vue'
import TextAreaField from '@/components/form/TextAreaField.vue'
import TextField from '@/components/form/TextField.vue'
import EmptyState from '@/components/layout/EmptyState.vue'
import PageHeader from '@/components/layout/PageHeader.vue'
import SectionCard from '@/components/layout/SectionCard.vue'
import StatusChip from '@/components/layout/StatusChip.vue'
import AppButton from '@/components/ui/AppButton.vue'
import LinkButton from '@/components/ui/LinkButton.vue'
import PaginationControls from '@/components/ui/PaginationControls.vue'
import {
  CONSENT_CHANNEL_LABELS,
  CONSENT_CHANNEL_OPTIONS,
  CONSENT_PURPOSE_LABELS,
  CONSENT_PURPOSE_OPTIONS,
  CONSENT_STATUS_BADGES,
  MESSAGE_ATTEMPT_STATUS_BADGES,
  MESSAGE_ATTEMPT_STATUS_OPTIONS,
  REMINDER_CHANNEL_LABELS,
  REMINDER_CHANNEL_OPTIONS,
  REMINDER_OFFSET_UNIT_OPTIONS,
  REMINDER_PURPOSE_LABELS,
  REMINDER_PURPOSE_OPTIONS,
  TEMPLATE_APPROVAL_BADGES,
  TEMPLATE_CHANNEL_LABELS,
  TEMPLATE_CHANNEL_OPTIONS,
  TEMPLATE_PURPOSE_LABELS,
  TEMPLATE_PURPOSE_OPTIONS,
  formatReminderOffset,
  listApprovedTemplateVersions,
  parseAllowedVariablesInput,
  validateConsentSubject,
} from '@/domain/communication/types'
import type {
  CommunicationConsentsChannel,
  CommunicationConsentsPurpose,
  ContactTask,
  MessageAttemptsStatus,
  MessageTemplate,
  MessageTemplatesChannel,
  MessageTemplatesPurpose,
  ReminderPoliciesChannel,
  ReminderPoliciesOffsetUnit,
  ReminderPoliciesPurpose,
  ReminderPolicy,
} from '@/domain/contracts/generated'
import { patientDisplayName } from '@/domain/patients/identity'
import { isUlid } from '@/domain/values/ulid'
import { useServerRead } from '@/pages/today/useServerRead'

/**
 * Registre des consentements opt-in / opt-out, modèles de messages approuvés, politiques de
 * relance paramétrées et déclenchement / audit des envois transactionnels.
 */
const router = useRouter()
const communicationHomeTarget = computed(() =>
  router.hasRoute('communication') ? { name: 'communication' } : '/communication',
)

// ============================================================================
// 1. Consentements (opt-in / opt-out)
// ============================================================================

const consentFilter = reactive<{
  page: number
  channel: CommunicationConsentsChannel | null
  purpose: CommunicationConsentsPurpose | null
}>({
  page: 1,
  channel: null,
  purpose: null,
})

const consentsRead = useServerRead(
  () =>
    listCommunicationConsents({
      page: consentFilter.page,
      channel: consentFilter.channel,
      purpose: consentFilter.purpose,
    }),
  { isEmpty: (page) => page.data.length === 0 },
)

function updateConsentChannelFilter(val: string | null): void {
  consentFilter.channel = (val as CommunicationConsentsChannel | null) ?? null
  consentFilter.page = 1
  void consentsRead.reload()
}

function updateConsentPurposeFilter(val: string | null): void {
  consentFilter.purpose = (val as CommunicationConsentsPurpose | null) ?? null
  consentFilter.page = 1
  void consentsRead.reload()
}

function goConsentPage(page: number): void {
  consentFilter.page = page
  void consentsRead.reload()
}

const consentForm = reactive<{
  patientId: string
  selectedPatientLabel: string | null
  prospectContactId: string
  channel: CommunicationConsentsChannel | null
  purpose: CommunicationConsentsPurpose | null
  destination: string
  proof: string
  policyVersion: string
}>({
  patientId: '',
  selectedPatientLabel: null,
  prospectContactId: '',
  channel: 'SMS',
  purpose: 'APPOINTMENT',
  destination: '',
  proof: '',
  policyVersion: 'v1',
})

const consentBusy = ref(false)
const consentError = ref<string | null>(null)
const consentSuccess = ref<string | null>(null)

async function searchPatientForConsent(query: string): Promise<ComboboxSearchResult> {
  const page = await searchPatients(query, 1)
  return page.data.data.map((patient) => ({
    value: patient.id,
    label: `${patient.last_name} ${patient.first_names ?? ''}`.trim(),
    description: `Dossier ${patient.record_number}`,
  }))
}

async function submitConsent(mode: 'grant' | 'revoke'): Promise<void> {
  if (consentBusy.value) return
  consentError.value = null
  consentSuccess.value = null

  const patientId = consentForm.patientId.trim() !== '' ? consentForm.patientId.trim() : null
  const prospectId =
    consentForm.prospectContactId.trim() !== '' ? consentForm.prospectContactId.trim() : null

  const subjectError = validateConsentSubject(patientId, prospectId)
  if (subjectError) {
    consentError.value = subjectError
    return
  }
  if (patientId && !isUlid(patientId)) {
    consentError.value = 'Identifiant ULID patient invalide.'
    return
  }
  if (prospectId && !isUlid(prospectId)) {
    consentError.value = 'Identifiant ULID prospect invalide.'
    return
  }
  if (consentForm.destination.trim() === '' || consentForm.proof.trim().length < 2) {
    consentError.value = 'Renseignez la destination et la preuve vérifiable du consentement.'
    return
  }

  const payload = {
    patient_id: patientId,
    prospect_contact_id: prospectId,
    channel: consentForm.channel ?? 'SMS',
    purpose: consentForm.purpose ?? 'APPOINTMENT',
    destination: consentForm.destination.trim(),
    proof: consentForm.proof.trim(),
    policy_version: consentForm.policyVersion.trim() || 'v1',
  }

  consentBusy.value = true
  try {
    const recorded =
      mode === 'grant'
        ? await recordCommunicationConsent(payload, newIdempotencyKey())
        : await revokeCommunicationConsent(payload, newIdempotencyKey())
    consentSuccess.value =
      mode === 'grant'
        ? `Opt-in enregistré pour ${recorded.destination_masked} (séquence ${recorded.event_sequence}).`
        : `Opt-out immédiat enregistré pour ${recorded.destination_masked} (séquence ${recorded.event_sequence}).`
    consentForm.proof = ''
    await consentsRead.reload()
  } catch (failure) {
    if (failure instanceof NetworkUnavailable) {
      consentError.value = 'Serveur injoignable : consentement non confirmé.'
    } else if (failure instanceof ApiError) {
      consentError.value = failure.message
    } else {
      throw failure
    }
  } finally {
    consentBusy.value = false
  }
}

// ============================================================================
// 2. Modèles de messages & révisions approuvées
// ============================================================================

const templatesRead = useServerRead(() => listMessageTemplates())
const templates = computed(() => templatesRead.data.value ?? [])
const approvedVersions = computed(() => listApprovedTemplateVersions(templates.value))
const todayTasks = ref<ContactTask[]>([])
const contactTaskOptions = computed(() =>
  todayTasks.value.map((task) => {
    const label = task.patient
      ? `${patientDisplayName(task.patient.last_name, task.patient.first_names)} (${task.patient.record_number})`
      : 'Contact'
    return { value: task.id, label: `${label} · ${task.source_type}` }
  }),
)

onMounted(async () => {
  if (!canOnScreen('agenda.read') || !moduleOpenOnScreen('agenda')) return
  try {
    todayTasks.value = (await listContactTasks(clinicToday().toString())).data
  } catch {
    todayTasks.value = []
  }
})

const templateForm = reactive<{
  code: string
  channel: MessageTemplatesChannel | null
  purpose: MessageTemplatesPurpose | null
}>({
  code: '',
  channel: 'SMS',
  purpose: 'APPOINTMENT',
})
const templateSaving = ref(false)
const templateError = ref<string | null>(null)
const templateSuccess = ref<string | null>(null)

async function submitTemplate(): Promise<void> {
  if (templateSaving.value) return
  templateError.value = null
  templateSuccess.value = null
  if (templateForm.code.trim() === '') {
    templateError.value = 'Saisissez le code unique du modèle.'
    return
  }
  templateSaving.value = true
  try {
    const created = await createMessageTemplate(
      {
        code: templateForm.code.trim(),
        channel: templateForm.channel ?? 'SMS',
        purpose: templateForm.purpose ?? 'APPOINTMENT',
      },
      newIdempotencyKey(),
    )
    templateSuccess.value = `Modèle « ${created.code} » créé.`
    templateForm.code = ''
    selectedTemplate.value = created
    await templatesRead.reload()
  } catch (failure) {
    if (failure instanceof NetworkUnavailable) {
      templateError.value = 'Serveur injoignable : modèle non enregistré.'
    } else if (failure instanceof ApiError) {
      templateError.value = failure.message
    } else {
      throw failure
    }
  } finally {
    templateSaving.value = false
  }
}

const selectedTemplate = ref<MessageTemplate | null>(null)
const templateVersionForm = reactive({
  integrationAccountId: '',
  providerTemplateId: '',
  language: 'fr',
  allowedVariablesText: 'patient_name, date',
  body: '',
})
const versionSaving = ref(false)
const approvingVersionId = ref<string | null>(null)
const versionFeedback = ref<{ tone: 'success' | 'error'; title: string; text: string } | null>(null)

function openNewTemplateVersion(template: MessageTemplate): void {
  selectedTemplate.value = template
  templateVersionForm.body = template.versions[0]?.body ?? ''
  templateVersionForm.allowedVariablesText =
    template.versions[0]?.allowed_variables.join(', ') ?? ''
  versionFeedback.value = null
}

async function submitTemplateVersion(): Promise<void> {
  if (!selectedTemplate.value || versionSaving.value) return
  versionFeedback.value = null
  if (templateVersionForm.body.trim() === '') {
    versionFeedback.value = {
      tone: 'error',
      title: 'Révision incomplète',
      text: 'Le corps du message est obligatoire.',
    }
    return
  }

  versionSaving.value = true
  try {
    const accountId = templateVersionForm.integrationAccountId.trim()
    const created = await createMessageTemplateVersion(
      selectedTemplate.value.id,
      {
        integration_account_id: accountId !== '' ? accountId : null,
        provider_template_id:
          templateVersionForm.providerTemplateId.trim() !== ''
            ? templateVersionForm.providerTemplateId.trim()
            : null,
        language: templateVersionForm.language.trim() || 'fr',
        body: templateVersionForm.body.trim(),
        allowed_variables: parseAllowedVariablesInput(templateVersionForm.allowedVariablesText),
      },
      newIdempotencyKey(),
    )
    versionFeedback.value = {
      tone: 'success',
      title: 'Révision ajoutée',
      text: `Révision r${created.revision_no} enregistrée sur ${selectedTemplate.value.code}.`,
    }
    templateVersionForm.body = ''
    await templatesRead.reload()
  } catch (failure) {
    if (failure instanceof NetworkUnavailable) {
      versionFeedback.value = {
        tone: 'error',
        title: 'Révision non enregistrée',
        text: 'Serveur injoignable.',
      }
    } else if (failure instanceof ApiError) {
      versionFeedback.value = {
        tone: 'error',
        title: 'Révision refusée',
        text: failure.message,
      }
    } else {
      throw failure
    }
  } finally {
    versionSaving.value = false
  }
}

async function approveVersion(versionId: string): Promise<void> {
  if (approvingVersionId.value !== null) return
  approvingVersionId.value = versionId
  versionFeedback.value = null
  try {
    const updated = await approveMessageTemplateVersion(versionId, {}, newIdempotencyKey())
    versionFeedback.value = {
      tone: 'success',
      title: 'Révision approuvée',
      text: `Révision r${updated.revision_no} approuvée pour les envois et campagnes.`,
    }
    await templatesRead.reload()
  } catch (failure) {
    if (failure instanceof NetworkUnavailable) {
      versionFeedback.value = {
        tone: 'error',
        title: 'Approbation non confirmée',
        text: 'Serveur injoignable.',
      }
    } else if (failure instanceof ApiError) {
      versionFeedback.value = {
        tone: 'error',
        title: 'Approbation refusée',
        text: failure.message,
      }
    } else {
      throw failure
    }
  } finally {
    approvingVersionId.value = null
  }
}

// ============================================================================
// 3. Politiques de relance (CRUD)
// ============================================================================

const policiesRead = useServerRead(() => listReminderPolicies())
const editingPolicyId = ref<string | null>(null)
const editingPolicyVersion = ref(1)

const policyForm = reactive<{
  code: string
  label: string
  purpose: ReminderPoliciesPurpose | null
  channel: ReminderPoliciesChannel | null
  offsetUnit: ReminderPoliciesOffsetUnit | null
  offsetValueText: string
  localSendTime: string
  active: boolean
}>({
  code: '',
  label: '',
  purpose: 'APPOINTMENT',
  channel: 'SMS',
  offsetUnit: 'DAY',
  offsetValueText: '-1',
  localSendTime: '09:00',
  active: true,
})

const policySaving = ref(false)
const policyError = ref<string | null>(null)
const policySuccess = ref<string | null>(null)

function resetPolicyForm(): void {
  editingPolicyId.value = null
  editingPolicyVersion.value = 1
  policyForm.code = ''
  policyForm.label = ''
  policyForm.purpose = 'APPOINTMENT'
  policyForm.channel = 'SMS'
  policyForm.offsetUnit = 'DAY'
  policyForm.offsetValueText = '-1'
  policyForm.localSendTime = '09:00'
  policyForm.active = true
  policyError.value = null
}

function editPolicy(policy: ReminderPolicy): void {
  editingPolicyId.value = policy.id
  editingPolicyVersion.value = policy.version
  policyForm.code = policy.code
  policyForm.label = policy.label
  policyForm.purpose = policy.purpose
  policyForm.channel = policy.channel
  policyForm.offsetUnit = policy.offset_unit
  policyForm.offsetValueText = String(policy.offset_value)
  policyForm.localSendTime = policy.local_send_time ?? ''
  policyForm.active = policy.active
  policyError.value = null
  policySuccess.value = null
}

async function submitPolicy(): Promise<void> {
  if (policySaving.value) return
  policyError.value = null
  policySuccess.value = null
  const offset = Number.parseInt(policyForm.offsetValueText.trim(), 10)
  if (!Number.isSafeInteger(offset)) {
    policyError.value = 'Le décalage doit être un nombre entier.'
    return
  }
  if (policyForm.label.trim() === '' || (!editingPolicyId.value && policyForm.code.trim() === '')) {
    policyError.value = 'Renseignez le code et le libellé de la politique.'
    return
  }

  policySaving.value = true
  try {
    const sendTime = policyForm.localSendTime.trim() !== '' ? policyForm.localSendTime.trim() : null
    if (editingPolicyId.value !== null) {
      const updated = await updateReminderPolicy(
        editingPolicyId.value,
        {
          expected_version: editingPolicyVersion.value,
          label: policyForm.label.trim(),
          channel: policyForm.channel ?? 'SMS',
          offset_unit: policyForm.offsetUnit ?? 'DAY',
          offset_value: offset,
          local_send_time: sendTime,
          active: policyForm.active,
        },
        newIdempotencyKey(),
      )
      policySuccess.value = `Politique « ${updated.label} » mise à jour (v${updated.version}).`
      resetPolicyForm()
    } else {
      const created = await createReminderPolicy(
        {
          code: policyForm.code.trim(),
          label: policyForm.label.trim(),
          purpose: policyForm.purpose ?? 'APPOINTMENT',
          channel: policyForm.channel ?? 'SMS',
          offset_unit: policyForm.offsetUnit ?? 'DAY',
          offset_value: offset,
          local_send_time: sendTime,
          active: policyForm.active,
        },
        newIdempotencyKey(),
      )
      policySuccess.value = `Politique « ${created.label} » créée.`
      resetPolicyForm()
    }
    await policiesRead.reload()
  } catch (failure) {
    if (failure instanceof NetworkUnavailable) {
      policyError.value = 'Serveur injoignable : politique non enregistrée.'
    } else if (failure instanceof ApiError) {
      policyError.value = failure.message
    } else {
      throw failure
    }
  } finally {
    policySaving.value = false
  }
}

// ============================================================================
// 4. Envoi transactionnel & journal d'audit des tentatives
// ============================================================================

const attemptsFilter = reactive<{
  page: number
  status: MessageAttemptsStatus | null
  taskId: string
}>({
  page: 1,
  status: null,
  taskId: '',
})

const attemptsRead = useServerRead(
  () =>
    listMessageAttempts({
      page: attemptsFilter.page,
      status: attemptsFilter.status,
      taskId: isUlid(attemptsFilter.taskId.trim()) ? attemptsFilter.taskId.trim() : null,
    }),
  { isEmpty: (page) => page.data.length === 0 },
)

function changeAttemptStatus(val: string | null): void {
  attemptsFilter.status = (val as MessageAttemptsStatus | null) ?? null
  attemptsFilter.page = 1
  void attemptsRead.reload()
}

function goAttemptPage(page: number): void {
  attemptsFilter.page = page
  void attemptsRead.reload()
}

const sendForm = reactive<{
  taskId: string
  templateVersionId: string | null
  channel: CommunicationConsentsChannel | null
}>({
  taskId: '',
  templateVersionId: null,
  channel: 'SMS',
})

const sendingTask = ref(false)
const sendError = ref<string | null>(null)
const sendSuccess = ref<string | null>(null)
const reconcilingAttemptId = ref<string | null>(null)

const approvedVersionOptions = computed(() =>
  approvedVersions.value.map((entry) => ({
    value: entry.version.id,
    label: entry.label,
  })),
)

async function submitTransactionalSend(): Promise<void> {
  if (sendingTask.value) return
  sendError.value = null
  sendSuccess.value = null
  const taskId = sendForm.taskId.trim()
  if (!isUlid(taskId)) {
    sendError.value = 'Saisissez un identifiant ULID de tâche de contact valide.'
    return
  }

  sendingTask.value = true
  try {
    const attempt = await sendTransactionalTaskMessage(
      taskId,
      {
        template_version_id: sendForm.templateVersionId ?? null,
        channel: sendForm.channel ?? null,
      },
      newIdempotencyKey(),
    )
    sendSuccess.value = `Envoi traité (${MESSAGE_ATTEMPT_STATUS_BADGES[attempt.status].label}) · clé déduplication ${attempt.dedupe_key}.`
    await attemptsRead.reload()
  } catch (failure) {
    if (failure instanceof NetworkUnavailable) {
      sendError.value = 'Serveur injoignable : envoi non confirmé.'
    } else if (failure instanceof ApiError) {
      sendError.value = failure.message
    } else {
      throw failure
    }
  } finally {
    sendingTask.value = false
  }
}

async function reconcileAttempt(attemptId: string): Promise<void> {
  if (reconcilingAttemptId.value !== null) return
  reconcilingAttemptId.value = attemptId
  sendError.value = null
  sendSuccess.value = null
  try {
    const updated = await reconcileMessageAttempt(attemptId, {}, newIdempotencyKey())
    sendSuccess.value = `Tentative rapprochée : statut ${MESSAGE_ATTEMPT_STATUS_BADGES[updated.status].label}.`
    await attemptsRead.reload()
  } catch (failure) {
    if (failure instanceof NetworkUnavailable) {
      sendError.value = 'Serveur injoignable : rapprochement non confirmé.'
    } else if (failure instanceof ApiError) {
      sendError.value = failure.message
    } else {
      throw failure
    }
  } finally {
    reconcilingAttemptId.value = null
  }
}
</script>

<template>
  <section aria-labelledby="titre-consents" class="page-stack max-w-6xl">
    <PageHeader
      title-id="titre-consents"
      title="Consentements, modèles et relances"
      subtitle="Registre immuable opt-in / opt-out, modèles de messages approuvés, politiques de relance et audit des envois."
      icon="bell"
      eyebrow="Conformité & envois"
    >
      <template #actions>
        <LinkButton :to="communicationHomeTarget" variant="secondary">
          Retour Communication
        </LinkButton>
      </template>
    </PageHeader>

    <SectionCard
      title="Registre des consentements (opt-in / opt-out)"
      title-id="titre-consent-ledger"
      description="Aucun message SMS, WhatsApp ou courriel ne part sans opt-in actif et non révoqué pour le canal et la finalité."
      icon="shield"
    >
      <template #actions>
        <div class="flex flex-wrap gap-3">
          <div class="min-w-40">
            <SelectField
              label="Canal"
              :model-value="consentFilter.channel"
              :options="CONSENT_CHANNEL_OPTIONS"
              placeholder="Tous les canaux"
              @update:model-value="updateConsentChannelFilter"
            />
          </div>
          <div class="min-w-48">
            <SelectField
              label="Finalité"
              :model-value="consentFilter.purpose"
              :options="CONSENT_PURPOSE_OPTIONS"
              placeholder="Toutes les finalités"
              @update:model-value="updateConsentPurposeFilter"
            />
          </div>
        </div>
      </template>

      <div class="space-y-5">
        <ReadNotice
          :state="consentsRead.state.value"
          :error="consentsRead.error.value"
          subject="le registre des consentements"
          @retry="consentsRead.reload()"
        />

        <EmptyState
          v-if="consentsRead.state.value === 'empty'"
          title="Aucun événement de consentement enregistré"
          icon="shield"
          flat
          title-as="h3"
        >
          Utilisez le formulaire ci-dessous pour consigner un accord ou un retrait immédiat.
        </EmptyState>

        <template v-else-if="consentsRead.data.value">
          <div class="data-table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th scope="col">Séqu.</th>
                  <th scope="col">Statut</th>
                  <th scope="col">Canal & finalité</th>
                  <th scope="col">Destination</th>
                  <th scope="col">Preuve & politique</th>
                  <th scope="col">Date</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in consentsRead.data.value.data" :key="item.id">
                  <th scope="row">#{{ item.event_sequence }}</th>
                  <td>
                    <StatusChip :tone="CONSENT_STATUS_BADGES[item.status].tone">
                      {{ CONSENT_STATUS_BADGES[item.status].label }}
                    </StatusChip>
                  </td>
                  <td>
                    {{ CONSENT_CHANNEL_LABELS[item.channel] }} ·
                    {{ CONSENT_PURPOSE_LABELS[item.purpose] }}
                  </td>
                  <td>
                    <code>{{ item.destination_masked }}</code>
                  </td>
                  <td>
                    {{ item.proof ?? '—' }}
                    <span class="block text-xs text-muted">
                      Politique {{ item.policy_version }}
                    </span>
                  </td>
                  <td>{{ formatInstantFr(item.recorded_at) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <PaginationControls
            :current-page="consentsRead.data.value.meta.current_page"
            :last-page="consentsRead.data.value.meta.last_page"
            :total="consentsRead.data.value.meta.total"
            :busy="consentsRead.state.value === 'loading'"
            unit="consentements"
            @page="goConsentPage"
          />
        </template>

        <div class="space-y-4 rounded-xl border border-line bg-canvas p-4">
          <h3 class="text-base font-semibold text-ink">
            Consigner un accord (opt-in) ou révoquer immédiatement (opt-out)
          </h3>
          <StateMessage v-if="consentError" state="error" title="Consentement refusé">
            {{ consentError }}
          </StateMessage>
          <StateMessage v-if="consentSuccess" state="success" title="Consentement consigné">
            {{ consentSuccess }}
          </StateMessage>

          <div class="form-grid">
            <ComboboxField
              v-if="canOnScreen('patient.read')"
              label="Rechercher un patient"
              :model-value="consentForm.patientId || null"
              :selected-label="consentForm.selectedPatientLabel"
              :search="searchPatientForConsent"
              placeholder="Nom ou numéro de dossier"
              @update:model-value="(val) => (consentForm.patientId = val ?? '')"
              @select="(option) => (consentForm.selectedPatientLabel = option?.label ?? null)"
            />
            <TextField
              v-model="consentForm.patientId"
              label="ULID patient (si dossier existant)"
              placeholder="01J..."
            />
            <TextField
              v-model="consentForm.prospectContactId"
              label="ULID prospect (sinon)"
              placeholder="01J..."
            />
            <SelectField
              :model-value="consentForm.channel"
              label="Canal"
              :options="CONSENT_CHANNEL_OPTIONS"
              required
              @update:model-value="
                (v) => (consentForm.channel = (v as CommunicationConsentsChannel | null) ?? 'SMS')
              "
            />
            <SelectField
              :model-value="consentForm.purpose"
              label="Finalité"
              :options="CONSENT_PURPOSE_OPTIONS"
              required
              @update:model-value="
                (v) =>
                  (consentForm.purpose =
                    (v as CommunicationConsentsPurpose | null) ?? 'APPOINTMENT')
              "
            />
            <TextField
              v-model="consentForm.destination"
              label="Numéro ou adresse exacte"
              placeholder="+237690000001"
              required
            />
            <TextField
              v-model="consentForm.proof"
              label="Preuve vérifiable"
              placeholder="ex. Formulaire signé à l’accueil"
              required
            />
            <TextField
              v-model="consentForm.policyVersion"
              label="Version de notice"
              placeholder="v1"
            />
          </div>

          <div class="form-actions">
            <AppButton variant="primary" :pending="consentBusy" @click="submitConsent('grant')">
              Enregistrer l’opt-in
            </AppButton>
            <AppButton variant="danger" :pending="consentBusy" @click="submitConsent('revoke')">
              Révoquer immédiatement (opt-out)
            </AppButton>
          </div>
        </div>
      </div>
    </SectionCard>

    <SectionCard
      title="Modèles de messages et révisions"
      title-id="titre-templates"
      description="Seules les révisions approuvées peuvent servir aux envois et aux campagnes."
      icon="file"
    >
      <div class="space-y-5">
        <ReadNotice
          :state="templatesRead.state.value"
          :error="templatesRead.error.value"
          subject="les modèles de messages"
          @retry="templatesRead.reload()"
        />

        <StateMessage
          v-if="versionFeedback"
          :state="versionFeedback.tone"
          :title="versionFeedback.title"
        >
          {{ versionFeedback.text }}
        </StateMessage>

        <div v-if="templates.length > 0" class="space-y-3">
          <div
            v-for="template in templates"
            :key="template.id"
            class="rounded-xl border border-line bg-canvas p-4"
          >
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 class="text-base font-semibold text-ink">
                  <code>{{ template.code }}</code> ·
                  {{ TEMPLATE_CHANNEL_LABELS[template.channel] }} ·
                  {{ TEMPLATE_PURPOSE_LABELS[template.purpose] }}
                </h3>
              </div>
              <AppButton variant="secondary" @click="openNewTemplateVersion(template)">
                Nouvelle révision
              </AppButton>
            </div>
            <div v-if="template.versions.length > 0" class="mt-3 space-y-2">
              <div
                v-for="version in template.versions"
                :key="version.id"
                class="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-line bg-surface p-3"
              >
                <div class="min-w-0 flex-1 space-y-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="font-medium text-ink">
                      r{{ version.revision_no }} ({{ version.language }})
                    </span>
                    <StatusChip
                      :tone="TEMPLATE_APPROVAL_BADGES[version.provider_approval_status].tone"
                    >
                      {{ TEMPLATE_APPROVAL_BADGES[version.provider_approval_status].label }}
                    </StatusChip>
                  </div>
                  <p class="text-sm text-ink">{{ version.body }}</p>
                  <p v-if="version.allowed_variables.length > 0" class="text-xs text-muted">
                    Variables autorisées : {{ version.allowed_variables.join(', ') }}
                  </p>
                </div>
                <AppButton
                  v-if="version.provider_approval_status !== 'APPROVED'"
                  variant="primary"
                  :pending="approvingVersionId === version.id"
                  :accessible-name="`Approuver la révision ${version.revision_no} de ${template.code}`"
                  @click="approveVersion(version.id)"
                >
                  Approuver le modèle
                </AppButton>
              </div>
            </div>
          </div>
        </div>

        <form
          v-if="selectedTemplate"
          class="space-y-4 rounded-xl border border-line bg-canvas p-4"
          novalidate
          @submit.prevent="submitTemplateVersion"
        >
          <h3 class="text-base font-semibold text-ink">
            Nouvelle révision pour <code>{{ selectedTemplate.code }}</code>
          </h3>
          <div class="form-grid">
            <TextField v-model="templateVersionForm.language" label="Langue" placeholder="fr" />
            <TextField
              v-model="templateVersionForm.allowedVariablesText"
              label="Variables autorisées (séparées par des virgules)"
              placeholder="patient_name, date"
            />
            <TextField
              v-model="templateVersionForm.providerTemplateId"
              label="ID modèle fournisseur (facultatif)"
            />
            <TextField
              v-model="templateVersionForm.integrationAccountId"
              label="ULID compte connecteur (facultatif)"
            />
            <TextAreaField
              v-model="templateVersionForm.body"
              class="col-span-full"
              label="Corps du message"
              :rows="3"
              required
            />
          </div>
          <div class="form-actions">
            <AppButton
              type="submit"
              variant="primary"
              :pending="versionSaving"
              pending-label="Enregistrement…"
            >
              Enregistrer la révision de modèle
            </AppButton>
            <AppButton variant="secondary" @click="selectedTemplate = null">Fermer</AppButton>
          </div>
        </form>

        <form
          class="space-y-4 rounded-xl border border-line bg-canvas p-4"
          novalidate
          @submit.prevent="submitTemplate"
        >
          <h3 class="text-base font-semibold text-ink">Créer un modèle de message</h3>
          <StateMessage v-if="templateError" state="error" title="Modèle refusé">
            {{ templateError }}
          </StateMessage>
          <StateMessage v-if="templateSuccess" state="success" title="Modèle créé">
            {{ templateSuccess }}
          </StateMessage>
          <div class="form-grid">
            <TextField
              v-model="templateForm.code"
              label="Code du modèle"
              placeholder="ex. RAPPEL_RDV_SMS"
              required
            />
            <SelectField
              :model-value="templateForm.channel"
              label="Canal"
              :options="TEMPLATE_CHANNEL_OPTIONS"
              required
              @update:model-value="
                (v) => (templateForm.channel = (v as MessageTemplatesChannel | null) ?? 'SMS')
              "
            />
            <SelectField
              :model-value="templateForm.purpose"
              label="Finalité"
              :options="TEMPLATE_PURPOSE_OPTIONS"
              required
              @update:model-value="
                (v) =>
                  (templateForm.purpose = (v as MessageTemplatesPurpose | null) ?? 'APPOINTMENT')
              "
            />
          </div>
          <div class="form-actions">
            <AppButton type="submit" variant="secondary" :pending="templateSaving">
              Créer le modèle
            </AppButton>
          </div>
        </form>
      </div>
    </SectionCard>

    <SectionCard
      title="Politiques de relance paramétrées"
      title-id="titre-reminder-policies"
      description="Règles de planification des rappels et relances selon l’échéance et le canal."
      icon="clock"
    >
      <div class="space-y-5">
        <ReadNotice
          :state="policiesRead.state.value"
          :error="policiesRead.error.value"
          subject="les politiques de relance"
          @retry="policiesRead.reload()"
        />

        <div
          v-if="policiesRead.data.value && policiesRead.data.value.length > 0"
          class="data-table-wrap"
        >
          <table class="data-table">
            <thead>
              <tr>
                <th scope="col">Code</th>
                <th scope="col">Libellé</th>
                <th scope="col">Finalité & canal</th>
                <th scope="col">Décalage</th>
                <th scope="col">État</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="policy in policiesRead.data.value" :key="policy.id">
                <th scope="row">
                  <code>{{ policy.code }}</code>
                </th>
                <td>{{ policy.label }}</td>
                <td>
                  {{ REMINDER_PURPOSE_LABELS[policy.purpose] }} ·
                  {{ REMINDER_CHANNEL_LABELS[policy.channel] }}
                </td>
                <td>
                  {{
                    formatReminderOffset(
                      policy.offset_value,
                      policy.offset_unit,
                      policy.local_send_time,
                    )
                  }}
                </td>
                <td>
                  <StatusChip :tone="policy.active ? 'success' : 'neutral'">
                    {{ policy.active ? 'Active' : 'Inactive' }}
                  </StatusChip>
                </td>
                <td>
                  <AppButton variant="ghost" @click="editPolicy(policy)">Modifier</AppButton>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <form
          class="space-y-4 rounded-xl border border-line bg-canvas p-4"
          novalidate
          @submit.prevent="submitPolicy"
        >
          <h3 class="text-base font-semibold text-ink">
            {{
              editingPolicyId
                ? 'Modifier la politique de relance'
                : 'Créer une politique de relance'
            }}
          </h3>
          <StateMessage v-if="policyError" state="error" title="Politique refusée">
            {{ policyError }}
          </StateMessage>
          <StateMessage v-if="policySuccess" state="success" title="Politique enregistrée">
            {{ policySuccess }}
          </StateMessage>
          <div class="form-grid">
            <TextField
              v-model="policyForm.code"
              label="Code"
              :disabled="editingPolicyId !== null"
              placeholder="ex. RDV_J_MOINS_1"
              required
            />
            <TextField
              v-model="policyForm.label"
              label="Libellé"
              placeholder="ex. Rappel veille de rendez-vous"
              required
            />
            <SelectField
              :model-value="policyForm.purpose"
              label="Finalité"
              :options="REMINDER_PURPOSE_OPTIONS"
              :disabled="editingPolicyId !== null"
              required
              @update:model-value="
                (v) => (policyForm.purpose = (v as ReminderPoliciesPurpose | null) ?? 'APPOINTMENT')
              "
            />
            <SelectField
              :model-value="policyForm.channel"
              label="Canal"
              :options="REMINDER_CHANNEL_OPTIONS"
              required
              @update:model-value="
                (v) => (policyForm.channel = (v as ReminderPoliciesChannel | null) ?? 'SMS')
              "
            />
            <SelectField
              :model-value="policyForm.offsetUnit"
              label="Unité de décalage"
              :options="REMINDER_OFFSET_UNIT_OPTIONS"
              required
              @update:model-value="
                (v) => (policyForm.offsetUnit = (v as ReminderPoliciesOffsetUnit | null) ?? 'DAY')
              "
            />
            <TextField
              v-model="policyForm.offsetValueText"
              label="Valeur entière du décalage (ex. -1)"
              inputmode="numeric"
              required
            />
            <TextField
              v-model="policyForm.localSendTime"
              label="Heure locale cible (HH:MM)"
              placeholder="09:00"
            />
            <CheckboxField v-model="policyForm.active" label="Politique active" />
          </div>
          <div class="form-actions">
            <AppButton type="submit" variant="primary" :pending="policySaving">
              {{ editingPolicyId ? 'Mettre à jour la politique' : 'Enregistrer la politique' }}
            </AppButton>
            <AppButton v-if="editingPolicyId" variant="secondary" @click="resetPolicyForm()">
              Annuler
            </AppButton>
          </div>
        </form>
      </div>
    </SectionCard>

    <SectionCard
      title="Envoi transactionnel et journal d’audit des tentatives"
      title-id="titre-attempts"
      description="Déclenche un envoi dédupliqué depuis une tâche de contact et rapproche le statut fournisseur."
      icon="send"
    >
      <template #actions>
        <div class="min-w-48">
          <SelectField
            label="Filtrer par statut"
            :model-value="attemptsFilter.status"
            :options="MESSAGE_ATTEMPT_STATUS_OPTIONS"
            placeholder="Tous les statuts"
            @update:model-value="changeAttemptStatus"
          />
        </div>
      </template>

      <div class="space-y-5">
        <StateMessage v-if="sendError" state="error" title="Envoi ou rapprochement refusé">
          {{ sendError }}
        </StateMessage>
        <StateMessage v-if="sendSuccess" state="success" title="Journal mis à jour">
          {{ sendSuccess }}
        </StateMessage>

        <form
          class="space-y-4 rounded-xl border border-line bg-canvas p-4"
          novalidate
          @submit.prevent="submitTransactionalSend"
        >
          <h3 class="text-base font-semibold text-ink">
            Déclencher l’envoi d’une tâche de contact
          </h3>
          <div class="form-grid">
            <SelectField
              v-if="contactTaskOptions.length > 0"
              label="Choisir une tâche de contact du jour (facultatif)"
              :model-value="sendForm.taskId || null"
              :options="contactTaskOptions"
              placeholder="Sélectionner un patient à rappeler…"
              @update:model-value="(val) => (sendForm.taskId = val ?? '')"
            />
            <TextField
              v-model="sendForm.taskId"
              label="Identifiant ULID de la tâche de contact"
              placeholder="01J..."
              required
            />
            <SelectField
              :model-value="sendForm.channel"
              label="Canal"
              :options="CONSENT_CHANNEL_OPTIONS"
              @update:model-value="
                (v) => (sendForm.channel = (v as CommunicationConsentsChannel | null) ?? 'SMS')
              "
            />
            <SelectField
              v-model="sendForm.templateVersionId"
              label="Révision de modèle approuvée"
              :options="approvedVersionOptions"
              placeholder="Modèle par défaut de la tâche"
            />
          </div>
          <div class="form-actions">
            <AppButton type="submit" variant="primary" :pending="sendingTask">
              Envoyer le message transactionnel
            </AppButton>
          </div>
        </form>

        <ReadNotice
          :state="attemptsRead.state.value"
          :error="attemptsRead.error.value"
          subject="l’audit des tentatives d’envoi"
          @retry="attemptsRead.reload()"
        />

        <EmptyState
          v-if="attemptsRead.state.value === 'empty'"
          title="Aucune tentative d’envoi enregistrée"
          icon="send"
          flat
          title-as="h3"
        >
          Les envois transactionnels et lots de campagne apparaîtront ici avec leur clé de
          déduplication.
        </EmptyState>

        <template v-else-if="attemptsRead.data.value">
          <div class="data-table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th scope="col">Clé déduplication</th>
                  <th scope="col">Tentative</th>
                  <th scope="col">Statut</th>
                  <th scope="col">ID fournisseur / erreur</th>
                  <th scope="col">Horodatage</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="attempt in attemptsRead.data.value.data" :key="attempt.id">
                  <th scope="row">
                    <code>{{ attempt.dedupe_key }}</code>
                  </th>
                  <td>#{{ attempt.attempt_no }}</td>
                  <td>
                    <StatusChip :tone="MESSAGE_ATTEMPT_STATUS_BADGES[attempt.status].tone">
                      {{ MESSAGE_ATTEMPT_STATUS_BADGES[attempt.status].label }}
                    </StatusChip>
                  </td>
                  <td>
                    {{ attempt.provider_message_id ?? '—' }}
                    <span v-if="attempt.error_code" class="block text-xs text-danger">
                      {{ attempt.error_code }}
                    </span>
                  </td>
                  <td>{{ formatInstantFr(attempt.created_at) }}</td>
                  <td>
                    <AppButton
                      variant="secondary"
                      :pending="reconcilingAttemptId === attempt.id"
                      @click="reconcileAttempt(attempt.id)"
                    >
                      Rapprocher le statut
                    </AppButton>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <PaginationControls
            :current-page="attemptsRead.data.value.meta.current_page"
            :last-page="attemptsRead.data.value.meta.last_page"
            :total="attemptsRead.data.value.meta.total"
            :busy="attemptsRead.state.value === 'loading'"
            unit="tentatives"
            @page="goAttemptPage"
          />
        </template>
      </div>
    </SectionCard>
  </section>
</template>
