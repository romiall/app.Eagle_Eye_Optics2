<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'

import { ApiError, NetworkUnavailable } from '@/app/api'
import { formatInstantFr } from '@/app/clinicTime'
import { getAgendaConfiguration } from '@/app/services/agenda'
import {
  confirmPublicBooking,
  listCalendarSyncStates,
  listIntegrationAccounts,
  listPublicBookings,
  newIdempotencyKey,
  rejectPublicBooking,
  saveCalendarSyncState,
  syncGoogleCalendar,
} from '@/app/services/communication'
import { canOnScreen } from '@/app/session'
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
import {
  CALENDAR_SYNC_STATUS_BADGES,
  CALENDAR_SYNC_STATUS_OPTIONS,
  PUBLIC_BOOKING_STATUS_BADGES,
  PUBLIC_BOOKING_STATUS_OPTIONS,
} from '@/domain/communication/types'
import type {
  CalendarSyncRunResult,
  CalendarSyncStatesStatus,
  IntegrationAccount,
  PublicBookingAdminItem,
  PublicBookingRequestsStatus,
  SchedulingResource,
} from '@/domain/contracts/generated'
import { isUlid } from '@/domain/values/ulid'
import { useServerRead } from '@/pages/today/useServerRead'

/**
 * Traitement des demandes publiques de rendez-vous et supervision de la synchronisation Google
 * Agenda par ressource du cabinet.
 */
const router = useRouter()
const communicationHomeTarget = computed(() =>
  router.hasRoute('communication') ? { name: 'communication' } : '/communication',
)

const statusFilter = ref<PublicBookingRequestsStatus | null>(null)
const currentPage = ref(1)

const bookingsRead = useServerRead(
  () => listPublicBookings({ page: currentPage.value, status: statusFilter.value }),
  { isEmpty: (page) => page.data.length === 0 },
)
const calendarStatesRead = useServerRead(() => listCalendarSyncStates())

const resources = ref<SchedulingResource[]>([])
const googleAccounts = ref<IntegrationAccount[]>([])

async function loadAuxiliaryCatalogs(): Promise<void> {
  if (canOnScreen('agenda.read')) {
    try {
      const agenda = await getAgendaConfiguration()
      resources.value = agenda.data.resources
    } catch {
      // Facultatif : l'écran permet toujours la saisie explicite d'identifiants.
    }
  }
  if (canOnScreen('integration.manage')) {
    try {
      const accounts = await listIntegrationAccounts()
      googleAccounts.value = accounts.data.filter((account) => account.provider === 'GOOGLE')
    } catch {
      // Facultatif si le compte n'a pas integration.manage.
    }
  }
}

onMounted(() => {
  void loadAuxiliaryCatalogs()
})

const resourceOptions = computed(() =>
  resources.value.map((resource) => ({ value: resource.id, label: resource.name })),
)

const googleAccountOptions = computed(() =>
  googleAccounts.value.map((account) => ({
    value: account.id,
    label: `${account.display_name} (${account.external_account_id})`,
  })),
)

function resourceLabel(id: string | null): string {
  if (!id) return 'Non affectée'
  return resources.value.find((resource) => resource.id === id)?.name ?? id
}

function accountLabel(id: string): string {
  return googleAccounts.value.find((account) => account.id === id)?.display_name ?? id
}

// --- Décision sur demande publique ---

const decisionResourceId = ref<string | null>(null)
const decisionReason = ref('')
const decidingId = ref<string | null>(null)
const actionFeedback = ref<{ tone: 'success' | 'error'; title: string; text: string } | null>(null)

function isActionable(item: PublicBookingAdminItem): boolean {
  return item.status === 'RECEIVED' || item.status === 'PENDING' || item.status === 'CONFLICT'
}

function changeStatusFilter(next: string | null): void {
  statusFilter.value = (next as PublicBookingRequestsStatus | null) ?? null
  currentPage.value = 1
  void bookingsRead.reload()
}

function changePage(page: number): void {
  currentPage.value = page
  void bookingsRead.reload()
}

function formatActionError(failure: unknown, fallbackTitle: string): void {
  if (failure instanceof NetworkUnavailable) {
    actionFeedback.value = {
      tone: 'error',
      title: fallbackTitle,
      text: 'Serveur injoignable : l’opération n’a pas pu être confirmée.',
    }
    return
  }
  if (failure instanceof ApiError) {
    actionFeedback.value = {
      tone: 'error',
      title: fallbackTitle,
      text: failure.message,
    }
    return
  }
  throw failure
}

async function decideBooking(
  item: PublicBookingAdminItem,
  decision: 'confirm' | 'reject',
): Promise<void> {
  if (decidingId.value !== null) return
  decidingId.value = item.id
  actionFeedback.value = null
  const resourceId = decisionResourceId.value ?? item.resource_id ?? null
  const reason = decisionReason.value.trim()
  const payload = {
    resource_id: decision === 'confirm' ? resourceId : null,
    reason: reason !== '' ? reason : null,
  }
  try {
    const updated =
      decision === 'confirm'
        ? await confirmPublicBooking(item.id, payload, newIdempotencyKey())
        : await rejectPublicBooking(item.id, payload, newIdempotencyKey())
    actionFeedback.value = {
      tone: 'success',
      title:
        decision === 'confirm'
          ? `Demande ${updated.public_reference} confirmée`
          : `Demande ${updated.public_reference} refusée`,
      text:
        decision === 'confirm' && updated.appointment_id
          ? `Rendez-vous créé dans l’agenda (${updated.appointment_id}).`
          : 'Le statut de la demande a été mis à jour.',
    }
    decisionReason.value = ''
    await bookingsRead.reload()
  } catch (failure) {
    formatActionError(failure, 'Décision non enregistrée')
  } finally {
    decidingId.value = null
  }
}

// --- Association Google Agenda & synchronisation ---

const linkForm = reactive<{
  integrationAccountId: string
  resourceId: string
  externalCalendarId: string
  status: CalendarSyncStatesStatus | null
}>({
  integrationAccountId: '',
  resourceId: '',
  externalCalendarId: 'primary',
  status: 'READY',
})

const linkSaving = ref(false)
const linkError = ref<string | null>(null)
const linkSuccess = ref<string | null>(null)

async function submitCalendarLink(): Promise<void> {
  if (linkSaving.value) return
  linkError.value = null
  linkSuccess.value = null
  const accountId = linkForm.integrationAccountId.trim()
  const resourceId = linkForm.resourceId.trim()
  const calendarId = linkForm.externalCalendarId.trim()

  if (!isUlid(accountId)) {
    linkError.value = 'Sélectionnez ou saisissez un identifiant ULID de compte Google valide.'
    return
  }
  if (!isUlid(resourceId)) {
    linkError.value = 'Sélectionnez ou saisissez un identifiant ULID de ressource valide.'
    return
  }
  if (calendarId === '') {
    linkError.value = 'Renseignez l’identifiant du calendrier Google (ex. primary).'
    return
  }

  linkSaving.value = true
  try {
    const saved = await saveCalendarSyncState(
      {
        integration_account_id: accountId,
        resource_id: resourceId,
        external_calendar_id: calendarId,
        status: linkForm.status ?? 'READY',
      },
      newIdempotencyKey(),
    )
    linkSuccess.value = `Agenda « ${saved.external_calendar_id} » associé à la ressource ${resourceLabel(saved.resource_id)}.`
    await calendarStatesRead.reload()
  } catch (failure) {
    if (failure instanceof NetworkUnavailable) {
      linkError.value = 'Serveur injoignable : association non enregistrée.'
    } else if (failure instanceof ApiError) {
      linkError.value = failure.message
    } else {
      throw failure
    }
  } finally {
    linkSaving.value = false
  }
}

const syncResourceFilter = ref<string | null>(null)
const fullResync = ref(false)
const syncing = ref(false)
const syncResult = ref<CalendarSyncRunResult | null>(null)
const syncError = ref<string | null>(null)

async function triggerCalendarSync(): Promise<void> {
  if (syncing.value) return
  syncing.value = true
  syncError.value = null
  syncResult.value = null
  try {
    syncResult.value = await syncGoogleCalendar(
      {
        resource_id: syncResourceFilter.value ?? null,
        full_resync: fullResync.value,
      },
      newIdempotencyKey(),
    )
    await calendarStatesRead.reload()
  } catch (failure) {
    if (failure instanceof NetworkUnavailable) {
      syncError.value = 'Serveur injoignable : synchronisation Google Agenda non confirmée.'
    } else if (failure instanceof ApiError) {
      syncError.value = failure.message
    } else {
      throw failure
    }
  } finally {
    syncing.value = false
  }
}
</script>

<template>
  <section aria-labelledby="titre-bookings-admin" class="page-stack max-w-6xl">
    <PageHeader
      title-id="titre-bookings-admin"
      title="Réservations publiques & Google Agenda"
      subtitle="Validation des demandes reçues en ligne et pilotage de la synchronisation Google Agenda."
      icon="calendar-plus"
      eyebrow="Agenda public"
    >
      <template #actions>
        <LinkButton :to="communicationHomeTarget" variant="secondary">
          Retour Communication
        </LinkButton>
        <AppButton
          variant="secondary"
          :pending="bookingsRead.state.value === 'loading'"
          @click="bookingsRead.reload()"
        >
          Actualiser la boîte
        </AppButton>
      </template>
    </PageHeader>

    <StateMessage v-if="actionFeedback" :state="actionFeedback.tone" :title="actionFeedback.title">
      {{ actionFeedback.text }}
    </StateMessage>

    <SectionCard
      title="Demandes de rendez-vous en ligne"
      title-id="titre-demandes-publiques"
      description="Confirmez ou refusez les demandes reçues depuis le portail public sans exposer d’information clinique."
      icon="calendar"
      flush
    >
      <template #actions>
        <div class="min-w-52">
          <SelectField
            label="Filtrer par statut"
            :model-value="statusFilter"
            :options="PUBLIC_BOOKING_STATUS_OPTIONS"
            placeholder="Tous les statuts"
            @update:model-value="changeStatusFilter"
          />
        </div>
      </template>

      <div class="space-y-4 px-4 pt-2 pb-4 sm:px-6">
        <div class="form-grid">
          <SelectField
            v-if="resourceOptions.length > 0"
            v-model="decisionResourceId"
            label="Ressource d’affectation pour la confirmation"
            :options="resourceOptions"
            placeholder="Conserver la ressource demandée"
          />
          <TextField
            v-model="decisionReason"
            label="Motif ou précision administrative (facultatif)"
            placeholder="ex. Confirmé avec l’optométriste de garde"
          />
        </div>
      </div>

      <div class="px-4 pb-4 sm:px-6">
        <ReadNotice
          :state="bookingsRead.state.value"
          :error="bookingsRead.error.value"
          subject="les demandes publiques de rendez-vous"
          @retry="bookingsRead.reload()"
        />
      </div>

      <div v-if="bookingsRead.state.value === 'empty'" class="px-4 pb-6 sm:px-6">
        <EmptyState
          title="Aucune demande publique pour ce filtre"
          icon="calendar"
          flat
          title-as="h3"
        >
          Les nouvelles demandes soumises depuis le portail public apparaîtront ici.
        </EmptyState>
      </div>

      <template v-else-if="bookingsRead.data.value">
        <div class="data-table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th scope="col">Référence</th>
                <th scope="col">Demandeur</th>
                <th scope="col">Prestation</th>
                <th scope="col">Créneau demandé</th>
                <th scope="col">Ressource</th>
                <th scope="col">Statut</th>
                <th scope="col">Décision</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in bookingsRead.data.value.data" :key="item.id">
                <th scope="row">
                  <code>{{ item.public_reference }}</code>
                </th>
                <td>
                  <span class="font-medium">{{ item.prospect_name ?? 'Prospect' }}</span>
                  <span v-if="item.prospect_phone" class="block text-xs text-muted">
                    {{ item.prospect_phone }}
                  </span>
                </td>
                <td>{{ item.service_name ?? item.service_id }}</td>
                <td>
                  {{ formatInstantFr(item.requested_starts_at) }}
                  <span class="block text-xs text-muted">
                    Consentement : {{ formatInstantFr(item.consent_recorded_at) }}
                  </span>
                </td>
                <td>{{ resourceLabel(item.resource_id) }}</td>
                <td>
                  <StatusChip :tone="PUBLIC_BOOKING_STATUS_BADGES[item.status].tone">
                    {{ PUBLIC_BOOKING_STATUS_BADGES[item.status].label }}
                  </StatusChip>
                </td>
                <td>
                  <div v-if="isActionable(item)" class="flex flex-wrap gap-2">
                    <AppButton
                      variant="primary"
                      :pending="decidingId === item.id"
                      :accessible-name="`Confirmer la demande ${item.public_reference}`"
                      @click="decideBooking(item, 'confirm')"
                    >
                      Confirmer
                    </AppButton>
                    <AppButton
                      variant="danger"
                      :pending="decidingId === item.id"
                      :accessible-name="`Refuser la demande ${item.public_reference}`"
                      @click="decideBooking(item, 'reject')"
                    >
                      Refuser
                    </AppButton>
                  </div>
                  <span v-else class="text-sm text-muted">
                    {{ item.appointment_id ? `RDV ${item.appointment_id}` : 'Traitée' }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="p-4 sm:px-6">
          <PaginationControls
            :current-page="bookingsRead.data.value.meta.current_page"
            :last-page="bookingsRead.data.value.meta.last_page"
            :total="bookingsRead.data.value.meta.total"
            :busy="bookingsRead.state.value === 'loading'"
            unit="demandes"
            @page="changePage"
          />
        </div>
      </template>
    </SectionCard>

    <SectionCard
      title="Synchronisation Google Agenda"
      title-id="titre-google-sync"
      description="Associez chaque ressource réservable à son calendrier Google et déclenchez une synchronisation."
      icon="refresh"
    >
      <div class="space-y-6">
        <ReadNotice
          :state="calendarStatesRead.state.value"
          :error="calendarStatesRead.error.value"
          subject="les états de synchronisation Google Agenda"
          @retry="calendarStatesRead.reload()"
        />

        <StateMessage
          v-if="syncResult"
          state="success"
          title="Synchronisation Google Agenda terminée"
        >
          {{ syncResult.synced_states }} état(s) traités ·
          {{ syncResult.pushed_appointments }} rendez-vous poussés ·
          {{ syncResult.pulled_blocks }} indisponibilité(s) importées ·
          {{ syncResult.conflicts }} conflit(s) signalés.
        </StateMessage>

        <StateMessage v-if="syncError" state="error" title="Synchronisation impossible">
          {{ syncError }}
        </StateMessage>

        <div class="toolbar rounded-xl border border-line bg-canvas p-4">
          <SelectField
            v-if="resourceOptions.length > 0"
            v-model="syncResourceFilter"
            label="Ressource à synchroniser"
            :options="resourceOptions"
            placeholder="Toutes les ressources associées"
          />
          <CheckboxField v-model="fullResync" label="Resynchronisation complète" />
          <AppButton
            variant="primary"
            :pending="syncing"
            pending-label="Synchronisation…"
            @click="triggerCalendarSync"
          >
            Synchroniser Google Agenda
          </AppButton>
        </div>

        <div
          v-if="calendarStatesRead.data.value && calendarStatesRead.data.value.length > 0"
          class="data-table-wrap"
        >
          <table class="data-table">
            <thead>
              <tr>
                <th scope="col">Ressource</th>
                <th scope="col">Compte connecteur</th>
                <th scope="col">Calendrier externe</th>
                <th scope="col">Statut</th>
                <th scope="col">Dernière synchro</th>
                <th scope="col">Erreur</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="stateRow in calendarStatesRead.data.value" :key="stateRow.id">
                <th scope="row">{{ resourceLabel(stateRow.resource_id) }}</th>
                <td>{{ accountLabel(stateRow.integration_account_id) }}</td>
                <td>
                  <code>{{ stateRow.external_calendar_id }}</code>
                </td>
                <td>
                  <StatusChip :tone="CALENDAR_SYNC_STATUS_BADGES[stateRow.status].tone">
                    {{ CALENDAR_SYNC_STATUS_BADGES[stateRow.status].label }}
                  </StatusChip>
                </td>
                <td>
                  {{
                    stateRow.last_incremental_sync_at
                      ? formatInstantFr(stateRow.last_incremental_sync_at)
                      : stateRow.last_full_sync_at
                        ? formatInstantFr(stateRow.last_full_sync_at)
                        : 'Jamais synchronisé'
                  }}
                </td>
                <td>{{ stateRow.last_error_code ?? '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <EmptyState
          v-else-if="calendarStatesRead.state.value === 'ready'"
          title="Aucun agenda Google associé"
          icon="calendar"
          flat
          title-as="h3"
        >
          Utilisez le formulaire ci-dessous pour lier une ressource à un agenda Google.
        </EmptyState>

        <form
          class="space-y-4 rounded-xl border border-line bg-canvas p-4"
          novalidate
          @submit.prevent="submitCalendarLink"
        >
          <h3 class="text-base font-semibold text-ink">
            Associer un calendrier Google à une ressource
          </h3>
          <StateMessage v-if="linkError" state="error" title="Association refusée">
            {{ linkError }}
          </StateMessage>
          <StateMessage v-if="linkSuccess" state="success" title="Association enregistrée">
            {{ linkSuccess }}
          </StateMessage>
          <div class="form-grid">
            <SelectField
              v-if="googleAccountOptions.length > 0"
              label="Compte connecteur Google"
              :model-value="linkForm.integrationAccountId || null"
              :options="googleAccountOptions"
              placeholder="Choisir un compte Google…"
              required
              @update:model-value="(val) => (linkForm.integrationAccountId = val ?? '')"
            />
            <TextField
              v-else
              v-model="linkForm.integrationAccountId"
              label="Identifiant ULID du compte connecteur Google"
              placeholder="01J..."
              required
            />

            <SelectField
              v-if="resourceOptions.length > 0"
              label="Ressource du cabinet"
              :model-value="linkForm.resourceId || null"
              :options="resourceOptions"
              placeholder="Choisir une ressource…"
              required
              @update:model-value="(val) => (linkForm.resourceId = val ?? '')"
            />
            <TextField
              v-else
              v-model="linkForm.resourceId"
              label="Identifiant ULID de la ressource"
              placeholder="01J..."
              required
            />

            <TextField
              v-model="linkForm.externalCalendarId"
              label="Identifiant du calendrier Google"
              placeholder="primary"
              required
            />
            <SelectField
              :model-value="linkForm.status"
              label="Statut initial"
              :options="CALENDAR_SYNC_STATUS_OPTIONS"
              @update:model-value="
                (v) => (linkForm.status = (v as CalendarSyncStatesStatus | null) ?? 'READY')
              "
            />
          </div>
          <div class="form-actions">
            <AppButton
              type="submit"
              variant="secondary"
              :pending="linkSaving"
              pending-label="Association…"
            >
              Associer l’agenda Google
            </AppButton>
          </div>
        </form>
      </div>
    </SectionCard>
  </section>
</template>
