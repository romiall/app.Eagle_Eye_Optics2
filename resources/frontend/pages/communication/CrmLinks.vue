<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'

import { ApiError, NetworkUnavailable } from '@/app/api'
import { formatInstantFr } from '@/app/clinicTime'
import {
  createProspect,
  listCrmConversations,
  listCrmLeads,
  listProspects,
  newIdempotencyKey,
  linkProspectToPatient,
  syncCrmLeads,
  updateProspect,
} from '@/app/services/communication'
import { searchPatients } from '@/app/services/patients'
import { canOnScreen } from '@/app/session'
import ReadNotice from '@/components/feedback/ReadNotice.vue'
import StateMessage from '@/components/feedback/StateMessage.vue'
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
  CONVERSATION_STATUS_BADGES,
  CONVERSATION_STATUS_OPTIONS,
  CRM_CHANNEL_LABELS,
  CRM_LEAD_STATUS_BADGES,
  CRM_LEAD_STATUS_OPTIONS,
  PROSPECT_ORIGIN_LABELS,
  PROSPECT_ORIGIN_OPTIONS,
} from '@/domain/communication/types'
import type {
  CrmConversationsStatus,
  CrmLeadSyncResult,
  CrmLeadsStatus,
  ProspectContact,
  ProspectContactsOrigin,
} from '@/domain/contracts/generated'
import { formatMoney } from '@/domain/values/money'
import { isUlid } from '@/domain/values/ulid'
import { useServerRead } from '@/pages/today/useServerRead'

/**
 * Annuaire des prospects administratifs (sans création de dossier médical), rattachement à un
 * dossier patient existant, pistes Kommo CRM et vue d'ensemble des conversations.
 */
const router = useRouter()
const communicationHomeTarget = computed(() =>
  router.hasRoute('communication') ? { name: 'communication' } : '/communication',
)
const handoffsTarget = computed(() =>
  router.hasRoute('communication-handoffs')
    ? { name: 'communication-handoffs' }
    : '/communication/assistant',
)

// --- Prospects ---

const prospectSearchInput = ref('')
const prospectQuery = ref('')
const prospectPage = ref(1)

const prospectsRead = useServerRead(
  () => listProspects({ page: prospectPage.value, query: prospectQuery.value }),
  { isEmpty: (page) => page.data.length === 0 },
)

function submitProspectSearch(): void {
  prospectQuery.value = prospectSearchInput.value.trim()
  prospectPage.value = 1
  void prospectsRead.reload()
}

function goProspectPage(page: number): void {
  prospectPage.value = page
  void prospectsRead.reload()
}

const editingProspectId = ref<string | null>(null)
const editingProspectVersion = ref(1)
const prospectForm = reactive<{
  name: string
  phone: string
  email: string
  origin: ProspectContactsOrigin | null
  administrativeNotes: string
}>({
  name: '',
  phone: '',
  email: '',
  origin: 'MANUAL',
  administrativeNotes: '',
})

const isEditingProspect = computed(() => editingProspectId.value !== null)
const prospectSaving = ref(false)
const prospectError = ref<string | null>(null)
const prospectSuccess = ref<string | null>(null)

function resetProspectForm(): void {
  editingProspectId.value = null
  editingProspectVersion.value = 1
  prospectForm.name = ''
  prospectForm.phone = ''
  prospectForm.email = ''
  prospectForm.origin = 'MANUAL'
  prospectForm.administrativeNotes = ''
  prospectError.value = null
}

function editProspect(prospect: ProspectContact): void {
  editingProspectId.value = prospect.id
  editingProspectVersion.value = prospect.version
  prospectForm.name = prospect.name
  prospectForm.phone = prospect.phone ?? ''
  prospectForm.email = prospect.email ?? ''
  prospectForm.origin = prospect.origin
  prospectForm.administrativeNotes = prospect.administrative_notes ?? ''
  prospectError.value = null
  prospectSuccess.value = null
}

async function saveProspect(): Promise<void> {
  if (prospectSaving.value) return
  prospectError.value = null
  prospectSuccess.value = null
  if (prospectForm.name.trim() === '') {
    prospectError.value = 'Le nom du prospect est obligatoire.'
    return
  }

  prospectSaving.value = true
  try {
    const phone = prospectForm.phone.trim()
    const email = prospectForm.email.trim()
    const notes = prospectForm.administrativeNotes.trim()

    if (editingProspectId.value !== null) {
      const updated = await updateProspect(
        editingProspectId.value,
        {
          expected_version: editingProspectVersion.value,
          name: prospectForm.name.trim(),
          phone: phone !== '' ? phone : null,
          email: email !== '' ? email : null,
          administrative_notes: notes !== '' ? notes : null,
        },
        newIdempotencyKey(),
      )
      prospectSuccess.value = `Prospect « ${updated.name} » mis à jour (v${updated.version}).`
      resetProspectForm()
    } else {
      const created = await createProspect(
        {
          name: prospectForm.name.trim(),
          phone: phone !== '' ? phone : null,
          email: email !== '' ? email : null,
          origin: prospectForm.origin ?? 'MANUAL',
          administrative_notes: notes !== '' ? notes : null,
        },
        newIdempotencyKey(),
      )
      prospectSuccess.value = `Prospect « ${created.name} » créé sans ouverture de dossier patient.`
      resetProspectForm()
    }
    await prospectsRead.reload()
  } catch (failure) {
    if (failure instanceof NetworkUnavailable) {
      prospectError.value = 'Serveur injoignable : prospect non enregistré.'
    } else if (failure instanceof ApiError) {
      prospectError.value = failure.message
    } else {
      throw failure
    }
  } finally {
    prospectSaving.value = false
  }
}

// --- Rattachement d'un prospect à un patient existant ---

const linkingProspect = ref<ProspectContact | null>(null)
const selectedPatientId = ref<string | null>(null)
const selectedPatientLabel = ref<string | null>(null)
const manualPatientId = ref('')
const linkPatientSaving = ref(false)
const linkPatientError = ref<string | null>(null)
const linkPatientSuccess = ref<string | null>(null)

function openLinkPatient(prospect: ProspectContact): void {
  linkingProspect.value = prospect
  selectedPatientId.value = null
  selectedPatientLabel.value = null
  manualPatientId.value = prospect.patient_id ?? ''
  linkPatientError.value = null
  linkPatientSuccess.value = null
}

function closeLinkPatient(): void {
  linkingProspect.value = null
  selectedPatientId.value = null
  selectedPatientLabel.value = null
  manualPatientId.value = ''
  linkPatientError.value = null
}

async function searchPatientOptions(query: string): Promise<ComboboxSearchResult> {
  const result = await searchPatients(query, 1)
  return result.data.data.map((patient) => ({
    value: patient.id,
    label: `${patient.last_name} ${patient.first_names ?? ''}`.trim(),
    description: `Dossier ${patient.record_number}${patient.phone_primary ? ` · ${patient.phone_primary}` : ''}`,
  }))
}

async function submitLinkPatient(): Promise<void> {
  if (!linkingProspect.value || linkPatientSaving.value) return
  linkPatientError.value = null
  const patientId = (selectedPatientId.value ?? manualPatientId.value).trim()
  if (!isUlid(patientId)) {
    linkPatientError.value = 'Sélectionnez un patient ou saisissez un identifiant ULID valide.'
    return
  }

  linkPatientSaving.value = true
  try {
    const updated = await linkProspectToPatient(
      linkingProspect.value.id,
      { patient_id: patientId },
      newIdempotencyKey(),
    )
    linkPatientSuccess.value = `Prospect « ${updated.name} » rattaché au dossier patient ${updated.patient_id}.`
    linkingProspect.value = null
    await prospectsRead.reload()
  } catch (failure) {
    if (failure instanceof NetworkUnavailable) {
      linkPatientError.value = 'Serveur injoignable : rattachement non confirmé.'
    } else if (failure instanceof ApiError) {
      linkPatientError.value = failure.message
    } else {
      throw failure
    }
  } finally {
    linkPatientSaving.value = false
  }
}

// --- Pistes Kommo CRM ---

const leadStatusFilter = ref<CrmLeadsStatus | null>(null)
const leadPage = ref(1)
const leadsRead = useServerRead(
  () => listCrmLeads({ page: leadPage.value, status: leadStatusFilter.value }),
  { isEmpty: (page) => page.data.length === 0 },
)

const syncingLeads = ref(false)
const leadsSyncResult = ref<CrmLeadSyncResult | null>(null)
const leadsSyncError = ref<string | null>(null)

function changeLeadStatus(next: string | null): void {
  leadStatusFilter.value = (next as CrmLeadsStatus | null) ?? null
  leadPage.value = 1
  void leadsRead.reload()
}

function goLeadPage(page: number): void {
  leadPage.value = page
  void leadsRead.reload()
}

async function triggerKommoSync(): Promise<void> {
  if (syncingLeads.value) return
  syncingLeads.value = true
  leadsSyncResult.value = null
  leadsSyncError.value = null
  try {
    leadsSyncResult.value = await syncCrmLeads({}, newIdempotencyKey())
    await leadsRead.reload()
  } catch (failure) {
    if (failure instanceof NetworkUnavailable) {
      leadsSyncError.value = 'Serveur injoignable : synchronisation Kommo non confirmée.'
    } else if (failure instanceof ApiError) {
      leadsSyncError.value = failure.message
    } else {
      throw failure
    }
  } finally {
    syncingLeads.value = false
  }
}

// --- Conversations omnicanales ---

const conversationStatusFilter = ref<CrmConversationsStatus | null>(null)
const conversationPage = ref(1)
const conversationsRead = useServerRead(
  () =>
    listCrmConversations({
      page: conversationPage.value,
      status: conversationStatusFilter.value,
    }),
  { isEmpty: (page) => page.data.length === 0 },
)

function changeConversationStatus(next: string | null): void {
  conversationStatusFilter.value = (next as CrmConversationsStatus | null) ?? null
  conversationPage.value = 1
  void conversationsRead.reload()
}
</script>

<template>
  <section aria-labelledby="titre-crm-links" class="page-stack max-w-6xl">
    <PageHeader
      title-id="titre-crm-links"
      title="Prospects, CRM Kommo et liens patients"
      subtitle="Annuaire administratif des prospects, rattachement explicite aux dossiers patients et suivi Kommo CRM."
      icon="users"
      eyebrow="CRM administratif"
    >
      <template #actions>
        <LinkButton :to="handoffsTarget" variant="secondary">
          Ouvrir la console assistant
        </LinkButton>
        <LinkButton :to="communicationHomeTarget" variant="ghost">
          Retour Communication
        </LinkButton>
      </template>
    </PageHeader>

    <SectionCard
      title="Annuaire des prospects administratifs"
      title-id="titre-prospects"
      description="Un prospect reste strictement administratif tant qu’il n’est pas rattaché à un dossier patient existant."
      icon="id-card"
    >
      <div class="space-y-5">
        <StateMessage
          v-if="linkPatientSuccess"
          state="success"
          title="Rattachement patient enregistré"
        >
          {{ linkPatientSuccess }}
        </StateMessage>

        <form class="toolbar" @submit.prevent="submitProspectSearch">
          <TextField
            v-model="prospectSearchInput"
            label="Rechercher un prospect"
            icon="search"
            placeholder="Nom, téléphone ou courriel"
          />
          <AppButton type="submit" variant="secondary">Rechercher</AppButton>
        </form>

        <ReadNotice
          :state="prospectsRead.state.value"
          :error="prospectsRead.error.value"
          subject="l’annuaire des prospects"
          @retry="prospectsRead.reload()"
        />

        <EmptyState
          v-if="prospectsRead.state.value === 'empty'"
          title="Aucun prospect trouvé"
          icon="users"
          flat
          title-as="h3"
        >
          Aucun contact prospect ne correspond à cette recherche.
        </EmptyState>

        <template v-else-if="prospectsRead.data.value">
          <div class="data-table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th scope="col">Nom</th>
                  <th scope="col">Téléphone / Courriel</th>
                  <th scope="col">Origine</th>
                  <th scope="col">Dossier patient lié</th>
                  <th scope="col">Notes administratives</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="prospect in prospectsRead.data.value.data" :key="prospect.id">
                  <th scope="row">{{ prospect.name }}</th>
                  <td>
                    <span>{{ prospect.phone ?? '—' }}</span>
                    <span v-if="prospect.email" class="block text-xs text-muted">
                      {{ prospect.email }}
                    </span>
                  </td>
                  <td>{{ PROSPECT_ORIGIN_LABELS[prospect.origin] }}</td>
                  <td>
                    <StatusChip v-if="prospect.patient_id" tone="success">
                      Patient lié · {{ prospect.patient_id }}
                    </StatusChip>
                    <StatusChip v-else tone="neutral">Prospect non rattaché</StatusChip>
                  </td>
                  <td>{{ prospect.administrative_notes ?? '—' }}</td>
                  <td>
                    <div class="flex flex-wrap gap-2">
                      <AppButton variant="ghost" @click="editProspect(prospect)"
                        >Modifier</AppButton
                      >
                      <AppButton variant="secondary" @click="openLinkPatient(prospect)">
                        Rattacher un patient
                      </AppButton>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <PaginationControls
            :current-page="prospectsRead.data.value.meta.current_page"
            :last-page="prospectsRead.data.value.meta.last_page"
            :total="prospectsRead.data.value.meta.total"
            :busy="prospectsRead.state.value === 'loading'"
            unit="prospects"
            @page="goProspectPage"
          />
        </template>

        <div
          v-if="linkingProspect"
          class="space-y-4 rounded-xl border border-gold bg-gold-soft/40 p-4"
        >
          <h3 class="text-base font-semibold text-ink">
            Rattacher « {{ linkingProspect.name }} » à un dossier patient existant
          </h3>
          <StateMessage v-if="linkPatientError" state="error" title="Rattachement refusé">
            {{ linkPatientError }}
          </StateMessage>
          <div class="form-grid">
            <ComboboxField
              v-if="canOnScreen('patient.read')"
              v-model="selectedPatientId"
              label="Rechercher le patient"
              :selected-label="selectedPatientLabel"
              :search="searchPatientOptions"
              placeholder="Nom, dossier ou téléphone (2 caractères min.)"
              @select="(option) => (selectedPatientLabel = option?.label ?? null)"
            />
            <TextField
              v-model="manualPatientId"
              label="Identifiant ULID du patient"
              placeholder="01J..."
              hint="Pré-rempli après sélection dans la recherche ou saisissable directement."
            />
          </div>
          <div class="form-actions">
            <AppButton
              variant="primary"
              :pending="linkPatientSaving"
              pending-label="Rattachement…"
              @click="submitLinkPatient"
            >
              Valider le rattachement
            </AppButton>
            <AppButton variant="secondary" @click="closeLinkPatient()">Annuler</AppButton>
          </div>
        </div>

        <form
          class="space-y-4 rounded-xl border border-line bg-canvas p-4"
          novalidate
          @submit.prevent="saveProspect"
        >
          <h3 class="text-base font-semibold text-ink">
            {{ isEditingProspect ? 'Modifier le prospect' : 'Créer un prospect administratif' }}
          </h3>
          <StateMessage v-if="prospectError" state="error" title="Prospect non enregistré">
            {{ prospectError }}
          </StateMessage>
          <StateMessage v-if="prospectSuccess" state="success" title="Prospect enregistré">
            {{ prospectSuccess }}
          </StateMessage>
          <div class="form-grid">
            <TextField
              v-model="prospectForm.name"
              label="Nom complet"
              required
              placeholder="ex. Nadia Mbarga"
            />
            <SelectField
              :model-value="prospectForm.origin"
              label="Origine"
              :options="PROSPECT_ORIGIN_OPTIONS"
              :disabled="isEditingProspect"
              required
              @update:model-value="
                (v) => (prospectForm.origin = (v as ProspectContactsOrigin | null) ?? 'MANUAL')
              "
            />
            <TextField v-model="prospectForm.phone" label="Téléphone" type="tel" />
            <TextField v-model="prospectForm.email" label="Courriel" type="email" />
            <TextAreaField
              v-model="prospectForm.administrativeNotes"
              class="col-span-full"
              label="Notes administratives (aucune note clinique)"
              :rows="2"
            />
          </div>
          <div class="form-actions">
            <AppButton
              type="submit"
              variant="primary"
              :pending="prospectSaving"
              pending-label="Enregistrement…"
            >
              {{ isEditingProspect ? 'Mettre à jour le prospect' : 'Enregistrer le prospect' }}
            </AppButton>
            <AppButton v-if="isEditingProspect" variant="secondary" @click="resetProspectForm()">
              Annuler la modification
            </AppButton>
          </div>
        </form>
      </div>
    </SectionCard>

    <SectionCard
      title="Pistes commerciales Kommo CRM"
      title-id="titre-kommo-leads"
      description="Miroir local des opportunités Kommo sans donnée médicale."
      icon="refresh"
      flush
    >
      <template #actions>
        <div class="flex flex-wrap items-end gap-3">
          <div class="min-w-44">
            <SelectField
              label="Statut Kommo"
              :model-value="leadStatusFilter"
              :options="CRM_LEAD_STATUS_OPTIONS"
              placeholder="Tous les statuts"
              @update:model-value="changeLeadStatus"
            />
          </div>
          <AppButton
            variant="primary"
            :pending="syncingLeads"
            pending-label="Synchronisation…"
            @click="triggerKommoSync"
          >
            Synchroniser Kommo CRM
          </AppButton>
        </div>
      </template>

      <div class="space-y-4 px-4 pt-2 sm:px-6">
        <StateMessage v-if="leadsSyncResult" state="success" title="Synchronisation Kommo terminée">
          {{ leadsSyncResult.synced }} piste(s) synchronisée(s) ·
          {{ leadsSyncResult.created }} créée(s) · {{ leadsSyncResult.updated }} mise(s) à jour ·
          {{ leadsSyncResult.conflicts }}
          conflit(s).
        </StateMessage>
        <StateMessage v-if="leadsSyncError" state="error" title="Synchronisation Kommo impossible">
          {{ leadsSyncError }}
        </StateMessage>
        <ReadNotice
          :state="leadsRead.state.value"
          :error="leadsRead.error.value"
          subject="les pistes Kommo CRM"
          @retry="leadsRead.reload()"
        />
      </div>

      <div v-if="leadsRead.state.value === 'empty'" class="p-4 sm:p-6">
        <EmptyState title="Aucune piste Kommo synchronisée" icon="tag" flat title-as="h3">
          Lancez une synchronisation pour importer le miroir des pistes Kommo.
        </EmptyState>
      </div>

      <template v-else-if="leadsRead.data.value">
        <div class="data-table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th scope="col">ID Kommo</th>
                <th scope="col">Prospect</th>
                <th scope="col">Étape pipeline</th>
                <th scope="col">Intérêt / Source</th>
                <th scope="col">Budget indicatif</th>
                <th scope="col">Statut</th>
                <th scope="col">Dernière synchro</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="lead in leadsRead.data.value.data" :key="lead.id">
                <th scope="row">
                  <code>{{ lead.external_lead_id }}</code>
                </th>
                <td>{{ lead.prospect_name ?? lead.prospect_contact_id }}</td>
                <td>{{ lead.pipeline_stage ?? '—' }}</td>
                <td>
                  {{ lead.product_interest ?? '—' }}
                  <span v-if="lead.acquisition_source" class="block text-xs text-muted">
                    Source : {{ lead.acquisition_source }}
                  </span>
                </td>
                <td>
                  <span v-if="lead.budget_min !== null || lead.budget_max !== null">
                    {{ lead.budget_min !== null ? formatMoney(lead.budget_min) : '—' }} à
                    {{ lead.budget_max !== null ? formatMoney(lead.budget_max) : '—' }}
                  </span>
                  <span v-else>—</span>
                </td>
                <td>
                  <StatusChip :tone="CRM_LEAD_STATUS_BADGES[lead.status].tone">
                    {{ CRM_LEAD_STATUS_BADGES[lead.status].label }}
                  </StatusChip>
                </td>
                <td>
                  {{ lead.last_synced_at ? formatInstantFr(lead.last_synced_at) : '—' }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="p-4 sm:px-6">
          <PaginationControls
            :current-page="leadsRead.data.value.meta.current_page"
            :last-page="leadsRead.data.value.meta.last_page"
            :total="leadsRead.data.value.meta.total"
            :busy="leadsRead.state.value === 'loading'"
            unit="pistes"
            @page="goLeadPage"
          />
        </div>
      </template>
    </SectionCard>

    <SectionCard
      title="Aperçu des conversations omnicanales"
      title-id="titre-conversations-apercu"
      description="État d’aiguillage bot / conseiller humain sur les canaux connectés."
      icon="communication"
      flush
    >
      <template #actions>
        <div class="min-w-48">
          <SelectField
            label="Filtrer par mode"
            :model-value="conversationStatusFilter"
            :options="CONVERSATION_STATUS_OPTIONS"
            placeholder="Tous les modes"
            @update:model-value="changeConversationStatus"
          />
        </div>
      </template>

      <div class="px-4 pt-2 sm:px-6">
        <ReadNotice
          :state="conversationsRead.state.value"
          :error="conversationsRead.error.value"
          subject="les conversations omnicanales"
          @retry="conversationsRead.reload()"
        />
      </div>

      <div v-if="conversationsRead.state.value === 'empty'" class="p-4 sm:p-6">
        <EmptyState title="Aucune conversation active" icon="communication" flat title-as="h3">
          Les échanges WhatsApp, Messenger et Instagram apparaîtront ici.
        </EmptyState>
      </div>

      <div v-else-if="conversationsRead.data.value" class="data-table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th scope="col">Canal</th>
              <th scope="col">Référence externe</th>
              <th scope="col">Statut</th>
              <th scope="col">Dernière activité</th>
              <th scope="col">Résumé / motif</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="conv in conversationsRead.data.value.data" :key="conv.id">
              <th scope="row">{{ CRM_CHANNEL_LABELS[conv.channel] }}</th>
              <td>
                <code>{{ conv.external_conversation_id }}</code>
              </td>
              <td>
                <StatusChip :tone="CONVERSATION_STATUS_BADGES[conv.status].tone">
                  {{ CONVERSATION_STATUS_BADGES[conv.status].label }}
                </StatusChip>
              </td>
              <td>{{ formatInstantFr(conv.last_activity_at) }}</td>
              <td>{{ conv.administrative_summary ?? conv.takeover_reason ?? '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </SectionCard>
  </section>
</template>
