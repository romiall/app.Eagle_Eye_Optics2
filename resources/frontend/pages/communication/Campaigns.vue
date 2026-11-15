<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'

import { ApiError, NetworkUnavailable } from '@/app/api'
import { formatInstantFr } from '@/app/clinicTime'
import {
  createAudienceSegment,
  createCampaign,
  executeCampaign,
  freezeCampaign,
  listAudienceSegments,
  listCampaignRecipients,
  listCampaigns,
  listMessageTemplates,
  newIdempotencyKey,
  pauseCampaign,
  previewCampaign,
  updateAudienceSegment,
} from '@/app/services/communication'
import ApprovalRequestDialog from '@/components/approvals/ApprovalRequestDialog.vue'
import ReadNotice from '@/components/feedback/ReadNotice.vue'
import StateMessage from '@/components/feedback/StateMessage.vue'
import CheckboxField from '@/components/form/CheckboxField.vue'
import SelectField from '@/components/form/SelectField.vue'
import TextField from '@/components/form/TextField.vue'
import EmptyState from '@/components/layout/EmptyState.vue'
import PageHeader from '@/components/layout/PageHeader.vue'
import SectionCard from '@/components/layout/SectionCard.vue'
import StatusChip from '@/components/layout/StatusChip.vue'
import AppButton from '@/components/ui/AppButton.vue'
import LinkButton from '@/components/ui/LinkButton.vue'
import PaginationControls from '@/components/ui/PaginationControls.vue'
import { campaignSendSubject } from '@/domain/approvals/approvals'
import {
  CAMPAIGN_RECIPIENT_STATUS_BADGES,
  CAMPAIGN_RECIPIENT_STATUS_OPTIONS,
  CAMPAIGN_STATUS_BADGES,
  CAMPAIGN_STATUS_OPTIONS,
  PROSPECT_ORIGIN_OPTIONS,
  detectForbiddenSegmentTerms,
  listApprovedTemplateVersions,
  type SegmentTargetType,
} from '@/domain/communication/types'
import type {
  Approval,
  AudienceSegment,
  CampaignDefinition,
  CampaignDefinitionsStatus,
  CampaignPreview,
  CampaignRecipientPage,
  CampaignRecipientsStatus,
  MessageTemplate,
  ProspectContactsOrigin,
} from '@/domain/contracts/generated'
import { isUlid } from '@/domain/values/ulid'
import { useServerRead } from '@/pages/today/useServerRead'

/**
 * Segmentation strictement administrative, création de campagnes, prévisualisation des exclusions
 * opt-out, demande d'approbation CAMPAIGN_SEND, gel, exécution par lots et suivi des destinataires.
 */
const router = useRouter()
const communicationHomeTarget = computed(() =>
  router.hasRoute('communication') ? { name: 'communication' } : '/communication',
)

// ============================================================================
// 1. Segments d'audience (critères administratifs uniquement)
// ============================================================================

const segmentsRead = useServerRead(() => listAudienceSegments())
const segments = computed(() => segmentsRead.data.value ?? [])
const templates = ref<MessageTemplate[]>([])

async function loadTemplates(): Promise<void> {
  try {
    const outcome = await listMessageTemplates()
    templates.value = outcome.data
  } catch {
    // Facultatif : l'écran permet aussi la saisie manuelle d'un ULID de révision approuvée.
  }
}

onMounted(() => {
  void loadTemplates()
})

const segmentOptions = computed(() =>
  segments.value.map((segment) => ({ value: segment.id, label: segment.name })),
)

const approvedTemplateOptions = computed(() =>
  listApprovedTemplateVersions(templates.value).map((item) => ({
    value: item.version.id,
    label: item.label,
  })),
)

const TARGET_TYPE_OPTIONS: readonly { value: SegmentTargetType; label: string }[] = [
  { value: 'BOTH', label: 'Tous (patients et prospects)' },
  { value: 'PATIENT', label: 'Patients avec dossier' },
  { value: 'PROSPECT', label: 'Prospects administratifs uniquement' },
]

const editingSegmentId = ref<string | null>(null)
const editingSegmentVersion = ref(1)

const segmentForm = reactive<{
  name: string
  targetType: SegmentTargetType
  city: string
  origin: ProspectContactsOrigin | null
  visitedWithinDaysText: string
  hasUpcomingAppointment: boolean
  hasOpenQuote: boolean
}>({
  name: '',
  targetType: 'BOTH',
  city: '',
  origin: null,
  visitedWithinDaysText: '',
  hasUpcomingAppointment: false,
  hasOpenQuote: false,
})

const segmentSaving = ref(false)
const segmentError = ref<string | null>(null)
const segmentSuccess = ref<string | null>(null)

function resetSegmentForm(): void {
  editingSegmentId.value = null
  editingSegmentVersion.value = 1
  segmentForm.name = ''
  segmentForm.targetType = 'BOTH'
  segmentForm.city = ''
  segmentForm.origin = null
  segmentForm.visitedWithinDaysText = ''
  segmentForm.hasUpcomingAppointment = false
  segmentForm.hasOpenQuote = false
  segmentError.value = null
}

function editSegment(segment: AudienceSegment): void {
  const criteria = segment.criteria as Record<string, unknown>
  editingSegmentId.value = segment.id
  editingSegmentVersion.value = segment.version
  segmentForm.name = segment.name
  const rawSubjectType = criteria['subject_type'] ?? criteria['patient_or_prospect']
  segmentForm.targetType =
    rawSubjectType === 'PATIENT' || rawSubjectType === 'PROSPECT' ? rawSubjectType : 'BOTH'
  segmentForm.city = typeof criteria['city'] === 'string' ? criteria['city'] : ''
  segmentForm.origin =
    typeof criteria['origin'] === 'string' ? (criteria['origin'] as ProspectContactsOrigin) : null
  segmentForm.visitedWithinDaysText =
    typeof criteria['last_visit_days'] === 'number' ? String(criteria['last_visit_days']) : ''
  segmentForm.hasUpcomingAppointment =
    typeof criteria['min_appointments'] === 'number' && criteria['min_appointments'] >= 1
  segmentForm.hasOpenQuote = criteria['has_quote'] === true
  segmentError.value = null
  segmentSuccess.value = null
}

async function submitSegment(): Promise<void> {
  if (segmentSaving.value) return
  segmentError.value = null
  segmentSuccess.value = null

  if (segmentForm.name.trim() === '') {
    segmentError.value = 'Renseignez le nom du segment.'
    return
  }

  const criteria: Record<string, unknown> = {
    subject_type: segmentForm.targetType,
  }
  if (segmentForm.city.trim() !== '') criteria['city'] = segmentForm.city.trim()
  if (segmentForm.origin) criteria['origin'] = segmentForm.origin
  if (segmentForm.visitedWithinDaysText.trim() !== '') {
    const days = Number.parseInt(segmentForm.visitedWithinDaysText.trim(), 10)
    if (!Number.isSafeInteger(days) || days < 0) {
      segmentError.value = 'Le délai de visite doit être un nombre entier positif ou nul de jours.'
      return
    }
    criteria['last_visit_days'] = days
  }
  if (segmentForm.hasUpcomingAppointment) criteria['min_appointments'] = 1
  if (segmentForm.hasOpenQuote) criteria['has_quote'] = true

  const forbidden = detectForbiddenSegmentTerms(criteria)
  if (forbidden.length > 0) {
    segmentError.value = `Critère clinique interdit dans un segment : ${forbidden.join(', ')}.`
    return
  }

  segmentSaving.value = true
  try {
    if (editingSegmentId.value !== null) {
      const updated = await updateAudienceSegment(
        editingSegmentId.value,
        {
          expected_version: editingSegmentVersion.value,
          name: segmentForm.name.trim(),
          criteria,
        },
        newIdempotencyKey(),
      )
      segmentSuccess.value = `Segment « ${updated.name} » mis à jour (v${updated.version}).`
      resetSegmentForm()
    } else {
      const created = await createAudienceSegment(
        {
          name: segmentForm.name.trim(),
          criteria,
        },
        newIdempotencyKey(),
      )
      segmentSuccess.value = `Segment « ${created.name} » créé.`
      resetSegmentForm()
    }
    await segmentsRead.reload()
  } catch (failure) {
    if (failure instanceof NetworkUnavailable) {
      segmentError.value = 'Serveur injoignable : segment non enregistré.'
    } else if (failure instanceof ApiError) {
      segmentError.value = failure.message
    } else {
      throw failure
    }
  } finally {
    segmentSaving.value = false
  }
}

// ============================================================================
// 2. Campagnes, prévisualisation, approbation CAMPAIGN_SEND, gel & lots
// ============================================================================

const campaignStatusFilter = ref<CampaignDefinitionsStatus | null>(null)
const campaignPage = ref(1)

const campaignsRead = useServerRead(
  () => listCampaigns({ page: campaignPage.value, status: campaignStatusFilter.value }),
  { isEmpty: (page) => page.data.length === 0 },
)

function changeCampaignStatus(val: string | null): void {
  campaignStatusFilter.value = (val as CampaignDefinitionsStatus | null) ?? null
  campaignPage.value = 1
  void campaignsRead.reload()
}

function goCampaignPage(page: number): void {
  campaignPage.value = page
  void campaignsRead.reload()
}

const campaignForm = reactive({
  name: '',
  segmentId: '',
  templateVersionId: '',
  scheduledAt: '',
})
const campaignSaving = ref(false)
const campaignError = ref<string | null>(null)
const campaignSuccess = ref<string | null>(null)

async function submitCreateCampaign(): Promise<void> {
  if (campaignSaving.value) return
  campaignError.value = null
  campaignSuccess.value = null

  if (campaignForm.name.trim() === '') {
    campaignError.value = 'Saisissez le nom de la campagne.'
    return
  }
  if (!isUlid(campaignForm.segmentId.trim())) {
    campaignError.value = 'Sélectionnez ou saisissez un segment d’audience valide.'
    return
  }
  if (!isUlid(campaignForm.templateVersionId.trim())) {
    campaignError.value = 'Sélectionnez ou saisissez une révision de modèle approuvée valide.'
    return
  }

  campaignSaving.value = true
  try {
    const created = await createCampaign(
      {
        name: campaignForm.name.trim(),
        segment_id: campaignForm.segmentId.trim(),
        template_version_id: campaignForm.templateVersionId.trim(),
        scheduled_at:
          campaignForm.scheduledAt.trim() !== '' ? campaignForm.scheduledAt.trim() : null,
      },
      newIdempotencyKey(),
    )
    campaignSuccess.value = `Campagne brouillon « ${created.name} » créée.`
    campaignForm.name = ''
    selectedCampaign.value = created
    await campaignsRead.reload()
  } catch (failure) {
    if (failure instanceof NetworkUnavailable) {
      campaignError.value = 'Serveur injoignable : campagne non créée.'
    } else if (failure instanceof ApiError) {
      campaignError.value = failure.message
    } else {
      throw failure
    }
  } finally {
    campaignSaving.value = false
  }
}

// --- Pilotage de la campagne sélectionnée ---

const selectedCampaign = ref<CampaignDefinition | null>(null)
const previewResult = ref<CampaignPreview | null>(null)
const freezeApprovalId = ref('')
const pauseReason = ref('')
const campaignActionBusy = ref(false)
const campaignActionFeedback = ref<{
  tone: 'success' | 'error'
  title: string
  text: string
} | null>(null)

const approvalDialogOpen = ref(false)
const approvalRecord = ref<Approval | null>(null)

const recipientStatusFilter = ref<CampaignRecipientsStatus | null>(null)
const recipientPage = ref(1)
const recipientsData = ref<CampaignRecipientPage | null>(null)
const recipientsLoading = ref(false)
const recipientsError = ref<string | null>(null)

async function loadRecipients(): Promise<void> {
  if (!selectedCampaign.value) return
  recipientsLoading.value = true
  recipientsError.value = null
  try {
    const outcome = await listCampaignRecipients(selectedCampaign.value.id, {
      page: recipientPage.value,
      status: recipientStatusFilter.value,
    })
    recipientsData.value = outcome.data
  } catch (failure) {
    if (failure instanceof NetworkUnavailable) {
      recipientsError.value = 'Serveur injoignable : destinataires non chargés.'
    } else if (failure instanceof ApiError) {
      recipientsError.value = failure.message
    } else {
      throw failure
    }
  } finally {
    recipientsLoading.value = false
  }
}

function selectCampaign(campaign: CampaignDefinition): void {
  selectedCampaign.value = campaign
  previewResult.value = null
  freezeApprovalId.value = campaign.approval_id ?? ''
  campaignActionFeedback.value = null
  approvalRecord.value = null
  recipientPage.value = 1
  recipientStatusFilter.value = null
  void loadRecipients()
}

function changeRecipientStatus(val: string | null): void {
  recipientStatusFilter.value = (val as CampaignRecipientsStatus | null) ?? null
  recipientPage.value = 1
  void loadRecipients()
}

function goRecipientPage(page: number): void {
  recipientPage.value = page
  void loadRecipients()
}

const approvalSubject = computed(() => {
  if (!selectedCampaign.value) return null
  const eligible = previewResult.value?.eligible_count ?? selectedCampaign.value.eligible_count
  return campaignSendSubject(
    selectedCampaign.value.id,
    selectedCampaign.value.segment_id,
    selectedCampaign.value.template_version_id,
    eligible,
  )
})

function onApprovalRequested(approval: Approval): void {
  approvalDialogOpen.value = false
  approvalRecord.value = approval
  freezeApprovalId.value = approval.id
  campaignActionFeedback.value = {
    tone: 'success',
    title: 'Demande d’approbation CAMPAIGN_SEND créée',
    text: `Approbation ${approval.id} enregistrée (${approval.status}). Dès validation par la gérante, vous pouvez geler la campagne.`,
  }
}

async function runPreview(): Promise<void> {
  if (!selectedCampaign.value || campaignActionBusy.value) return
  campaignActionBusy.value = true
  campaignActionFeedback.value = null
  try {
    previewResult.value = await previewCampaign(selectedCampaign.value.id, {}, newIdempotencyKey())
    campaignActionFeedback.value = {
      tone: 'success',
      title: 'Prévisualisation calculée',
      text: `${previewResult.value.eligible_count} destinataire(s) admissible(s) · ${previewResult.value.excluded_count} exclu(s) (opt-out ou sans contact valide).`,
    }
  } catch (failure) {
    handleCampaignError(failure, 'Prévisualisation impossible')
  } finally {
    campaignActionBusy.value = false
  }
}

async function runFreeze(): Promise<void> {
  if (!selectedCampaign.value || campaignActionBusy.value) return
  const approvalId = freezeApprovalId.value.trim()
  if (approvalId !== '' && !isUlid(approvalId)) {
    campaignActionFeedback.value = {
      tone: 'error',
      title: 'Identifiant d’approbation invalide',
      text: 'Saisissez un ULID d’approbation valide ou laissez vide si votre profil gérante gèle directement.',
    }
    return
  }
  campaignActionBusy.value = true
  campaignActionFeedback.value = null
  try {
    const updated = await freezeCampaign(
      selectedCampaign.value.id,
      { approval_id: approvalId !== '' ? approvalId : null },
      newIdempotencyKey(),
    )
    selectedCampaign.value = updated
    campaignActionFeedback.value = {
      tone: 'success',
      title: 'Campagne gelée et approuvée',
      text: `Cible figée : ${updated.eligible_count} admissible(s), ${updated.excluded_count} exclu(s).`,
    }
    await campaignsRead.reload()
    await loadRecipients()
  } catch (failure) {
    handleCampaignError(failure, 'Gel de campagne refusé')
  } finally {
    campaignActionBusy.value = false
  }
}

async function runExecute(): Promise<void> {
  if (!selectedCampaign.value || campaignActionBusy.value) return
  campaignActionBusy.value = true
  campaignActionFeedback.value = null
  try {
    const updated = await executeCampaign(selectedCampaign.value.id, {}, newIdempotencyKey())
    selectedCampaign.value = updated
    campaignActionFeedback.value = {
      tone: 'success',
      title: 'Lot de campagne exécuté',
      text: `Statut : ${CAMPAIGN_STATUS_BADGES[updated.status].label} · ${updated.delivered_count} remis · ${updated.failed_count} en échec.`,
    }
    await campaignsRead.reload()
    await loadRecipients()
  } catch (failure) {
    handleCampaignError(failure, 'Exécution refusée')
  } finally {
    campaignActionBusy.value = false
  }
}

async function runPause(): Promise<void> {
  if (!selectedCampaign.value || campaignActionBusy.value) return
  campaignActionBusy.value = true
  campaignActionFeedback.value = null
  try {
    const updated = await pauseCampaign(
      selectedCampaign.value.id,
      { reason: pauseReason.value.trim() !== '' ? pauseReason.value.trim() : null },
      newIdempotencyKey(),
    )
    selectedCampaign.value = updated
    pauseReason.value = ''
    campaignActionFeedback.value = {
      tone: 'success',
      title: 'Campagne suspendue',
      text: `La campagne « ${updated.name} » est désormais au statut ${CAMPAIGN_STATUS_BADGES[updated.status].label}.`,
    }
    await campaignsRead.reload()
  } catch (failure) {
    handleCampaignError(failure, 'Suspension refusée')
  } finally {
    campaignActionBusy.value = false
  }
}

function handleCampaignError(failure: unknown, title: string): void {
  if (failure instanceof NetworkUnavailable) {
    campaignActionFeedback.value = {
      tone: 'error',
      title,
      text: 'Serveur injoignable : l’action n’a pas pu être confirmée.',
    }
    return
  }
  if (failure instanceof ApiError) {
    campaignActionFeedback.value = {
      tone: 'error',
      title,
      text: failure.message,
    }
    return
  }
  throw failure
}
</script>

<template>
  <section aria-labelledby="titre-campaigns" class="page-stack max-w-6xl">
    <PageHeader
      title-id="titre-campaigns"
      title="Segments d’audience et campagnes"
      subtitle="Ciblage strictement administratif, prévisualisation opt-in / opt-out, approbation CAMPAIGN_SEND et exécution par lots."
      icon="mail"
      eyebrow="Campagnes ciblées"
    >
      <template #actions>
        <LinkButton :to="communicationHomeTarget" variant="secondary">
          Retour Communication
        </LinkButton>
      </template>
    </PageHeader>

    <StateMessage state="conflict" title="Critères cliniques strictement interdits">
      Les segments d’audience acceptent uniquement des filtres administratifs (ville, origine, date
      de visite, rendez-vous ou devis). Aucun diagnostic, pathologie ni prescription n’est autorisé
      pour cibler une campagne.
    </StateMessage>

    <SectionCard
      title="Segments d’audience administratifs"
      title-id="titre-segments"
      description="Définissez des audiences réutilisables sans aucune donnée clinique."
      icon="filter"
    >
      <div class="space-y-5">
        <ReadNotice
          :state="segmentsRead.state.value"
          :error="segmentsRead.error.value"
          subject="les segments d’audience"
          @retry="segmentsRead.reload()"
        />

        <div v-if="segments.length > 0" class="data-table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th scope="col">Nom du segment</th>
                <th scope="col">Critères administratifs</th>
                <th scope="col">Mise à jour</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="segment in segments" :key="segment.id">
                <th scope="row">{{ segment.name }}</th>
                <td>
                  <code>{{ JSON.stringify(segment.criteria) }}</code>
                </td>
                <td>
                  {{ formatInstantFr(segment.updated_at) }}
                  <span class="block text-xs text-muted">v{{ segment.version }}</span>
                </td>
                <td>
                  <AppButton variant="ghost" @click="editSegment(segment)">Modifier</AppButton>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <form
          class="space-y-4 rounded-xl border border-line bg-canvas p-4"
          novalidate
          @submit.prevent="submitSegment"
        >
          <h3 class="text-base font-semibold text-ink">
            {{
              editingSegmentId ? 'Modifier le segment d’audience' : 'Créer un segment d’audience'
            }}
          </h3>
          <StateMessage v-if="segmentError" state="error" title="Segment refusé">
            {{ segmentError }}
          </StateMessage>
          <StateMessage v-if="segmentSuccess" state="success" title="Segment enregistré">
            {{ segmentSuccess }}
          </StateMessage>
          <div class="form-grid">
            <TextField
              v-model="segmentForm.name"
              label="Nom du segment"
              placeholder="ex. Patients Douala avec devis ouvert"
              required
            />
            <SelectField
              label="Type de contact"
              :model-value="segmentForm.targetType"
              :options="TARGET_TYPE_OPTIONS"
              required
              @update:model-value="
                (val) => (segmentForm.targetType = (val as SegmentTargetType) ?? 'BOTH')
              "
            />
            <TextField
              v-model="segmentForm.city"
              label="Ville / quartier administratif"
              placeholder="ex. Douala"
            />
            <SelectField
              :model-value="segmentForm.origin"
              label="Origine d’acquisition"
              :options="PROSPECT_ORIGIN_OPTIONS"
              placeholder="Toutes origines"
              @update:model-value="
                (v) => (segmentForm.origin = (v as ProspectContactsOrigin | null) ?? null)
              "
            />
            <TextField
              v-model="segmentForm.visitedWithinDaysText"
              label="Visite dans les N derniers jours (entier)"
              inputmode="numeric"
              placeholder="ex. 90"
            />
            <div class="flex flex-col justify-end gap-2">
              <CheckboxField
                v-model="segmentForm.hasUpcomingAppointment"
                label="Possède un rendez-vous à venir"
              />
              <CheckboxField v-model="segmentForm.hasOpenQuote" label="Possède un devis en cours" />
            </div>
          </div>
          <div class="form-actions">
            <AppButton type="submit" variant="primary" :pending="segmentSaving">
              {{ editingSegmentId ? 'Mettre à jour le segment' : 'Enregistrer le segment' }}
            </AppButton>
            <AppButton v-if="editingSegmentId" variant="secondary" @click="resetSegmentForm()">
              Annuler
            </AppButton>
          </div>
        </form>
      </div>
    </SectionCard>

    <SectionCard
      title="Campagnes de communication"
      title-id="titre-liste-campagnes"
      description="Prévisualisez la cible, obtenez l’approbation CAMPAIGN_SEND, gelez les destinataires puis exécutez par lots."
      icon="send"
    >
      <template #actions>
        <div class="min-w-48">
          <SelectField
            label="Filtrer par statut"
            :model-value="campaignStatusFilter"
            :options="CAMPAIGN_STATUS_OPTIONS"
            placeholder="Tous les statuts"
            @update:model-value="changeCampaignStatus"
          />
        </div>
      </template>

      <div class="space-y-5">
        <ReadNotice
          :state="campaignsRead.state.value"
          :error="campaignsRead.error.value"
          subject="les campagnes de communication"
          @retry="campaignsRead.reload()"
        />

        <EmptyState
          v-if="campaignsRead.state.value === 'empty'"
          title="Aucune campagne enregistrée"
          icon="mail"
          flat
          title-as="h3"
        >
          Créez un brouillon ci-dessous avec un segment administratif et une révision de modèle
          approuvée.
        </EmptyState>

        <template v-else-if="campaignsRead.data.value">
          <div class="data-table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th scope="col">Nom</th>
                  <th scope="col">Statut</th>
                  <th scope="col">Admissibles / Exclus</th>
                  <th scope="col">Remis / Échecs</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="campaign in campaignsRead.data.value.data" :key="campaign.id">
                  <th scope="row">{{ campaign.name }}</th>
                  <td>
                    <StatusChip :tone="CAMPAIGN_STATUS_BADGES[campaign.status].tone">
                      {{ CAMPAIGN_STATUS_BADGES[campaign.status].label }}
                    </StatusChip>
                  </td>
                  <td>
                    {{ campaign.eligible_count }} admissibles · {{ campaign.excluded_count }}
                    exclus
                  </td>
                  <td>
                    {{ campaign.delivered_count }} remis · {{ campaign.failed_count }} échec(s)
                  </td>
                  <td>
                    <AppButton
                      variant="secondary"
                      :pressed="selectedCampaign?.id === campaign.id"
                      @click="selectCampaign(campaign)"
                    >
                      Piloter
                    </AppButton>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <PaginationControls
            :current-page="campaignsRead.data.value.meta.current_page"
            :last-page="campaignsRead.data.value.meta.last_page"
            :total="campaignsRead.data.value.meta.total"
            :busy="campaignsRead.state.value === 'loading'"
            unit="campagnes"
            @page="goCampaignPage"
          />
        </template>

        <form
          class="space-y-4 rounded-xl border border-line bg-canvas p-4"
          novalidate
          @submit.prevent="submitCreateCampaign"
        >
          <h3 class="text-base font-semibold text-ink">Créer une campagne en brouillon</h3>
          <StateMessage v-if="campaignError" state="error" title="Campagne refusée">
            {{ campaignError }}
          </StateMessage>
          <StateMessage v-if="campaignSuccess" state="success" title="Campagne créée">
            {{ campaignSuccess }}
          </StateMessage>
          <div class="form-grid">
            <TextField
              v-model="campaignForm.name"
              label="Nom de la campagne"
              placeholder="ex. Information horaires fin d’année"
              required
            />
            <SelectField
              v-if="segmentOptions.length > 0"
              label="Segment d’audience"
              :model-value="campaignForm.segmentId || null"
              :options="segmentOptions"
              placeholder="Choisir un segment…"
              required
              @update:model-value="(val) => (campaignForm.segmentId = val ?? '')"
            />
            <TextField
              v-else
              v-model="campaignForm.segmentId"
              label="ULID du segment d’audience"
              placeholder="01J..."
              required
            />
            <SelectField
              v-if="approvedTemplateOptions.length > 0"
              label="Révision de modèle approuvée"
              :model-value="campaignForm.templateVersionId || null"
              :options="approvedTemplateOptions"
              placeholder="Choisir une révision approuvée…"
              required
              @update:model-value="(val) => (campaignForm.templateVersionId = val ?? '')"
            />
            <TextField
              v-else
              v-model="campaignForm.templateVersionId"
              label="ULID de révision de modèle approuvée"
              placeholder="01J..."
              required
            />
            <TextField
              v-model="campaignForm.scheduledAt"
              label="Envoi programmé ISO UTC (facultatif)"
              placeholder="2026-12-01T08:00:00.000Z"
            />
          </div>
          <div class="form-actions">
            <AppButton type="submit" variant="primary" :pending="campaignSaving">
              Créer la campagne brouillon
            </AppButton>
          </div>
        </form>
      </div>
    </SectionCard>

    <SectionCard
      v-if="selectedCampaign"
      :title="`Pilotage de « ${selectedCampaign.name} »`"
      title-id="titre-pilotage-campagne"
      description="Prévisualisez les exclusions opt-out, demandez l’approbation CAMPAIGN_SEND et suivez la diffusion."
      icon="check-circle"
    >
      <div class="space-y-5">
        <div class="flex flex-wrap items-center gap-3">
          <StatusChip :tone="CAMPAIGN_STATUS_BADGES[selectedCampaign.status].tone">
            {{ CAMPAIGN_STATUS_BADGES[selectedCampaign.status].label }}
          </StatusChip>
          <span class="text-sm text-muted">
            Admissibles : <strong>{{ selectedCampaign.eligible_count }}</strong> · Exclus (opt-out)
            :
            <strong>{{ selectedCampaign.excluded_count }}</strong>
          </span>
        </div>

        <StateMessage
          v-if="campaignActionFeedback"
          :state="campaignActionFeedback.tone"
          :title="campaignActionFeedback.title"
        >
          {{ campaignActionFeedback.text }}
        </StateMessage>

        <div
          v-if="previewResult"
          class="space-y-2 rounded-xl border border-gold bg-gold-soft/40 p-4 text-sm text-ink"
        >
          <p class="font-semibold">
            Prévisualisation : {{ previewResult.total_candidates }} candidat(s) évalué(s) ·
            {{ previewResult.eligible_count }} admissible(s) · {{ previewResult.excluded_count }}
            exclu(s)
          </p>
          <ul v-if="previewResult.sample.length > 0" class="list-disc pl-5">
            <li v-for="sampleRow in previewResult.sample" :key="sampleRow.id">
              <code>{{ sampleRow.destination_masked }}</code> —
              {{ CAMPAIGN_RECIPIENT_STATUS_BADGES[sampleRow.status].label }}
              <span v-if="sampleRow.exclusion_reason"> ({{ sampleRow.exclusion_reason }}) </span>
            </li>
          </ul>
        </div>

        <div class="form-grid">
          <TextField
            v-model="freezeApprovalId"
            label="Identifiant ULID d’approbation CAMPAIGN_SEND"
            placeholder="Renseigné après demande ou laisser vide si gérante"
            :hint="approvalRecord ? `Demande créée (${approvalRecord.status})` : undefined"
          />
          <TextField
            v-model="pauseReason"
            label="Motif de suspension (si mise en pause)"
            placeholder="ex. Vérification du message avant suite"
          />
        </div>

        <div class="flex flex-wrap gap-3">
          <AppButton variant="secondary" :pending="campaignActionBusy" @click="runPreview">
            Prévisualiser l’audience
          </AppButton>
          <AppButton
            variant="secondary"
            :pending="campaignActionBusy"
            @click="approvalDialogOpen = true"
          >
            Demander l’autorisation d’envoi
          </AppButton>
          <AppButton variant="primary" :pending="campaignActionBusy" @click="runFreeze">
            Geler la campagne
          </AppButton>
          <AppButton variant="primary" :pending="campaignActionBusy" @click="runExecute">
            Exécuter un lot d’envoi
          </AppButton>
          <AppButton variant="danger" :pending="campaignActionBusy" @click="runPause">
            Suspendre la campagne
          </AppButton>
        </div>

        <div class="space-y-3 border-t border-line pt-4">
          <div class="flex flex-wrap items-end justify-between gap-3">
            <h3 class="text-base font-semibold text-ink">Destinataires gelés et exclusions</h3>
            <div class="min-w-48">
              <SelectField
                label="Statut destinataire"
                :model-value="recipientStatusFilter"
                :options="CAMPAIGN_RECIPIENT_STATUS_OPTIONS"
                placeholder="Tous les destinataires"
                @update:model-value="changeRecipientStatus"
              />
            </div>
          </div>

          <StateMessage v-if="recipientsError" state="error" title="Lecture impossible">
            {{ recipientsError }}
          </StateMessage>
          <p v-else-if="recipientsLoading" class="text-sm text-muted">
            Chargement des destinataires…
          </p>
          <template v-else-if="recipientsData && recipientsData.data.length > 0">
            <div class="data-table-wrap">
              <table class="data-table">
                <thead>
                  <tr>
                    <th scope="col">Destination</th>
                    <th scope="col">Statut</th>
                    <th scope="col">Motif d’exclusion</th>
                    <th scope="col">Contrôle consentement</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="recipient in recipientsData.data" :key="recipient.id">
                    <th scope="row">
                      <code>{{ recipient.destination_masked }}</code>
                    </th>
                    <td>
                      <StatusChip :tone="CAMPAIGN_RECIPIENT_STATUS_BADGES[recipient.status].tone">
                        {{ CAMPAIGN_RECIPIENT_STATUS_BADGES[recipient.status].label }}
                      </StatusChip>
                    </td>
                    <td>{{ recipient.exclusion_reason ?? '—' }}</td>
                    <td>
                      {{
                        recipient.consent_checked_at
                          ? formatInstantFr(recipient.consent_checked_at)
                          : '—'
                      }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <PaginationControls
              :current-page="recipientsData.meta.current_page"
              :last-page="recipientsData.meta.last_page"
              :total="recipientsData.meta.total"
              :busy="recipientsLoading"
              unit="destinataires"
              @page="goRecipientPage"
            />
          </template>
          <EmptyState v-else title="Aucun destinataire gelé" icon="users" flat title-as="h3">
            Gelez la campagne après prévisualisation pour figer la liste exacte des destinataires et
            des exclusions opt-out.
          </EmptyState>
        </div>
      </div>
    </SectionCard>

    <ApprovalRequestDialog
      :open="approvalDialogOpen"
      :subject="approvalSubject"
      :summary="
        selectedCampaign
          ? `Gel et autorisation d’envoi de la campagne « ${selectedCampaign.name} »`
          : ''
      "
      @requested="onApprovalRequested"
      @cancel="approvalDialogOpen = false"
    />
  </section>
</template>
