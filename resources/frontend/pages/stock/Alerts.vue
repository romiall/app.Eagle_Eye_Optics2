<script setup lang="ts">
/**
 * Alertes et seuils de stock (L1D03), module « stock », EN LIGNE, droit `stock.read` (actions pour
 * `stock.adjust`, `stock.receive` ou `stock.inventory`) : affiche les alertes de seuil de stock bas
 * et de péremption proche ou dépassée, explique le calcul du disponible central (`Physique − Réservé
 * − Quotas des postes`), permet de lancer l'évaluation, de prendre en compte ou de résoudre manuellement
 * une alerte sans modifier aucun solde de stock.
 */
import { computed, ref } from 'vue'

import { clinicTimeZone, clinicToday, formatInstantFr } from '@/app/clinicTime'
import { listStockLocations } from '@/app/services/billing'
import type { MutationOutcome } from '@/app/services/mutations'
import { listStockAlerts } from '@/app/services/stockAlerts'
import { canOnScreen, revalidateSession } from '@/app/session'
import FreshnessNote from '@/components/feedback/FreshnessNote.vue'
import StateMessage from '@/components/feedback/StateMessage.vue'
import SelectField from '@/components/form/SelectField.vue'
import AppButton from '@/components/ui/AppButton.vue'
import LinkButton from '@/components/ui/LinkButton.vue'
import PaginationControls from '@/components/ui/PaginationControls.vue'
import type {
  StockAlert,
  StockAlertEvaluationResponse,
  StockAlertPage,
  StockLocation,
} from '@/domain/contracts/generated'
import {
  ALERT_KIND_LABELS,
  ALERT_STATUS_LABELS,
  formatCivilDateFr,
  formatExpiryHeadline,
  lowStockShortfall,
} from '@/domain/inventory/alerts'
import CommandFailure from '@/pages/purchasing/CommandFailure.vue'
import { quantityLabel } from '@/pages/sales/format'
import { useStockCommand } from '@/pages/stock/useStockCommand'
import { useServerRead } from '@/pages/today/useServerRead'

const timeZone = clinicTimeZone()
const today = computed(() => clinicToday())

const status = ref<string | null>(null)
const kind = ref<string | null>(null)
const locationId = ref<string | null>(null)
const page = ref(1)
const notice = ref<string | null>(null)

const canManage = computed(
  () =>
    canOnScreen('stock.adjust') || canOnScreen('stock.receive') || canOnScreen('stock.inventory'),
)
const canReceive = computed(() => canOnScreen('stock.receive'))
const canAdjust = computed(() => canOnScreen('stock.adjust'))

const read = useServerRead<StockAlertPage>(
  () =>
    listStockAlerts({
      status: status.value,
      kind: kind.value,
      locationId: locationId.value,
      page: page.value,
    }),
  { isEmpty: (result) => result.data.length === 0 },
)
const result = computed(() => read.data.value)

const locationRead = useServerRead<StockLocation[]>(listStockLocations)
const locationOptions = computed(() => [
  { value: '', label: 'Tous les emplacements' },
  ...(locationRead.data.value ?? []).map((location) => ({
    value: location.id,
    label: `${location.name} (${location.code})`,
  })),
])

const statusOptions = [
  { value: '', label: 'Toutes' },
  { value: 'OPEN', label: 'À traiter' },
  { value: 'ACKNOWLEDGED', label: 'Prises en compte' },
  { value: 'RESOLVED', label: 'Résolues' },
]

const kindOptions = [
  { value: '', label: 'Tous les types' },
  { value: 'LOW_STOCK', label: 'Seuil bas' },
  { value: 'EXPIRY', label: 'Péremption' },
]

function setStatus(value: string | null): void {
  status.value = value === '' ? null : value
  page.value = 1
  void read.reload()
}

function setKind(value: string | null): void {
  kind.value = value === '' ? null : value
  page.value = 1
  void read.reload()
}

function setLocationId(value: string | null): void {
  locationId.value = value === '' ? null : value
  page.value = 1
  void read.reload()
}

function goToPage(next: number): void {
  page.value = next
  void read.reload()
}

const command = useStockCommand('')
const { mutation } = command
const saving = computed(() => mutation.state.value === 'saving')
const busyKey = ref<string | null>(null)
const lastAction = ref<'evaluate' | 'ack' | 'resolve' | null>(null)

async function afterCommand(outcome: MutationOutcome): Promise<void> {
  busyKey.value = null
  switch (outcome.kind) {
    case 'synced': {
      if (lastAction.value === 'evaluate') {
        const summary = (outcome.result as StockAlertEvaluationResponse).data
        notice.value =
          `Évaluation terminée : ${summary.open_count} alerte${summary.open_count > 1 ? 's' : ''} à traiter` +
          ` (${summary.opened} nouvelle${summary.opened > 1 ? 's' : ''}, ` +
          `${summary.reopened} réouverte${summary.reopened > 1 ? 's' : ''}, ` +
          `${summary.resolved} résolue${summary.resolved > 1 ? 's' : ''}).`
      } else if (lastAction.value === 'ack') {
        notice.value = 'Alerte marquée comme prise en compte.'
      } else if (lastAction.value === 'resolve') {
        notice.value = 'Alerte marquée comme résolue.'
      }
      mutation.reset()
      await read.reload()
      return
    }
    case 'session-expired':
      void revalidateSession().catch(() => undefined)
      return
    default:
      return
  }
}

async function evaluate(): Promise<void> {
  if (saving.value || !canManage.value) return
  notice.value = null
  busyKey.value = 'evaluate'
  lastAction.value = 'evaluate'
  await afterCommand(
    await command.send({
      name: 'EvaluateStockAlerts',
      route: { method: 'POST', path: '/stock/alerts/evaluate' },
      payload: { expected_version: null },
    }),
  )
}

async function acknowledge(alert: StockAlert): Promise<void> {
  if (saving.value || !canManage.value) return
  notice.value = null
  busyKey.value = `${alert.id}:ack`
  lastAction.value = 'ack'
  await afterCommand(
    await command.send({
      name: 'AcknowledgeStockAlert',
      route: { method: 'POST', path: `/stock/alerts/${alert.id}/acknowledge` },
      payload: { expected_version: null },
    }),
  )
}

async function resolve(alert: StockAlert): Promise<void> {
  if (saving.value || !canManage.value) return
  notice.value = null
  busyKey.value = `${alert.id}:resolve`
  lastAction.value = 'resolve'
  await afterCommand(
    await command.send({
      name: 'ResolveStockAlert',
      route: { method: 'POST', path: `/stock/alerts/${alert.id}/resolve` },
      payload: { expected_version: null },
    }),
  )
}

async function retry(): Promise<void> {
  if (saving.value) return
  await afterCommand(await command.retry())
}

function shortfallLabel(alert: StockAlert): string | null {
  const shortfall = lowStockShortfall(alert)
  return shortfall === null ? null : quantityLabel(shortfall.canonical())
}
</script>

<template>
  <section aria-labelledby="titre-alertes" class="max-w-3xl space-y-6">
    <h1 id="titre-alertes" class="text-2xl font-semibold tracking-tight">
      Alertes et seuils de stock
    </h1>
    <p class="max-w-prose text-base text-muted">
      Surveillance des articles sous leur seuil de stock bas et des lots dont la date de péremption
      approche ou est dépassée. Le disponible central suit toujours la règle : Physique − Réservé −
      Quotas des postes.
    </p>
    <div class="flex flex-wrap gap-3">
      <LinkButton :to="{ name: 'stock' }" variant="ghost">Retour au stock</LinkButton>
      <AppButton
        v-if="canManage"
        variant="secondary"
        :pending="saving && busyKey === 'evaluate'"
        pending-label="Actualisation…"
        :disabled="saving"
        @click="evaluate"
        >Actualiser les alertes</AppButton
      >
    </div>

    <StateMessage v-if="notice" state="success" :title="notice" />
    <CommandFailure
      :state="mutation.state.value"
      :message="command.message.value"
      :failure-message="mutation.failureMessage.value"
      :saving="saving"
      @retry="retry"
    />

    <section aria-labelledby="titre-liste-alertes" class="space-y-4">
      <h2 id="titre-liste-alertes" class="text-lg font-semibold">Alertes</h2>
      <div class="grid gap-3 sm:grid-cols-3">
        <SelectField
          :model-value="status ?? ''"
          label="Afficher"
          :options="statusOptions"
          control-id="alertes-statut"
          @update:model-value="setStatus"
        />
        <SelectField
          :model-value="kind ?? ''"
          label="Type"
          :options="kindOptions"
          control-id="alertes-type"
          @update:model-value="setKind"
        />
        <SelectField
          :model-value="locationId ?? ''"
          label="Emplacement"
          :options="locationOptions"
          control-id="alertes-emplacement"
          @update:model-value="setLocationId"
        />
      </div>

      <StateMessage
        v-if="read.state.value === 'loading'"
        state="loading"
        title="Chargement des alertes…"
      />
      <StateMessage
        v-else-if="read.state.value === 'error' || read.state.value === 'offline'"
        state="error"
        title="Lecture des alertes impossible"
      >
        {{ read.error.value ?? 'Le serveur n’a pas répondu.' }}
        <template #action>
          <AppButton variant="secondary" @click="read.reload()">Réessayer</AppButton>
        </template>
      </StateMessage>
      <StateMessage
        v-else-if="read.state.value === 'empty'"
        state="empty"
        title="Aucune alerte de stock"
      >
        Aucune alerte ne correspond aux filtres choisis.
      </StateMessage>
      <template v-else-if="result !== null">
        <ul class="space-y-3">
          <li
            v-for="alert in result.data"
            :key="alert.id"
            class="space-y-2 rounded-xl border border-line bg-surface shadow-card p-3"
          >
            <p class="font-semibold break-words">
              {{ ALERT_KIND_LABELS[alert.kind] }} · {{ ALERT_STATUS_LABELS[alert.status] }}
            </p>
            <p class="font-semibold break-words">
              {{ alert.item_name ?? `Article …${alert.item_id.slice(-6)}` }}
              <template v-if="alert.item_reference"> ({{ alert.item_reference }})</template>
              · {{ alert.location_name ?? `Emplacement …${alert.location_id.slice(-6)}` }}
              <template v-if="alert.location_code"> ({{ alert.location_code }})</template>
            </p>

            <template v-if="alert.kind === 'LOW_STOCK'">
              <p class="text-sm break-words">
                Seuil de stock bas :
                <strong class="tabular-nums">{{
                  alert.low_stock_threshold !== null
                    ? quantityLabel(alert.low_stock_threshold)
                    : 'Non défini'
                }}</strong>
                <template v-if="shortfallLabel(alert) !== null">
                  · Manque {{ shortfallLabel(alert) }} pour revenir au-dessus du seuil
                </template>
              </p>
            </template>

            <template v-else>
              <p class="text-sm font-medium break-words">
                Lot {{ alert.batch_number ?? `…${(alert.lot_id ?? '').slice(-6)}` }}
                <template v-if="alert.due_on">
                  · Date de péremption : {{ formatCivilDateFr(alert.due_on) }}
                </template>
                <template v-if="alert.expiry_alert_days !== null">
                  · Délai d’alerte : {{ alert.expiry_alert_days }} j
                </template>
              </p>
              <p class="text-sm text-muted break-words">
                {{ formatExpiryHeadline(alert, today) }}
              </p>
            </template>

            <dl
              v-if="alert.on_hand !== null"
              class="grid grid-cols-2 gap-x-4 gap-y-1 text-base sm:grid-cols-4"
            >
              <div>
                <dt class="text-sm text-muted">Physique</dt>
                <dd class="tabular-nums">{{ quantityLabel(alert.on_hand) }}</dd>
              </div>
              <div>
                <dt class="text-sm text-muted">Réservé</dt>
                <dd class="tabular-nums">{{ quantityLabel(alert.reserved ?? '0') }}</dd>
              </div>
              <div>
                <dt class="text-sm text-muted">Quotas des postes</dt>
                <dd class="tabular-nums">
                  {{ quantityLabel(alert.offline_allocated ?? '0') }}
                </dd>
              </div>
              <div>
                <dt class="text-sm font-semibold">Disponible</dt>
                <dd class="font-semibold tabular-nums">
                  {{ quantityLabel(alert.central_available ?? '0') }}
                </dd>
              </div>
            </dl>

            <p class="text-sm text-muted break-words">
              Détectée le {{ formatInstantFr(alert.detected_at) }}
              <template v-if="alert.acknowledged_by_name">
                · Prise en compte par {{ alert.acknowledged_by_name }}</template
              >
              <template v-if="alert.resolved_at">
                · Résolue le {{ formatInstantFr(alert.resolved_at) }}</template
              >
            </p>

            <div class="flex flex-wrap gap-2">
              <template v-if="canManage && alert.status !== 'RESOLVED'">
                <AppButton
                  v-if="alert.status === 'OPEN'"
                  variant="secondary"
                  :pending="saving && busyKey === `${alert.id}:ack`"
                  pending-label="Enregistrement…"
                  :disabled="saving"
                  @click="acknowledge(alert)"
                  >Prendre en compte</AppButton
                >
                <AppButton
                  variant="ghost"
                  :pending="saving && busyKey === `${alert.id}:resolve`"
                  pending-label="Enregistrement…"
                  :disabled="saving"
                  @click="resolve(alert)"
                  >Marquer résolue</AppButton
                >
              </template>
              <LinkButton
                :to="{ name: 'stock-history', query: { article: alert.item_id } }"
                variant="ghost"
              >
                Historique des mouvements
              </LinkButton>
              <LinkButton
                v-if="canReceive && alert.kind === 'LOW_STOCK'"
                :to="{ name: 'goods-receipt-new' }"
                variant="secondary"
              >
                Nouvelle réception
              </LinkButton>
              <LinkButton
                v-if="canAdjust && alert.kind === 'EXPIRY'"
                :to="{ name: 'stock-movement' }"
                variant="secondary"
              >
                Casse ou ajustement
              </LinkButton>
            </div>
          </li>
        </ul>
        <PaginationControls
          :current-page="result.meta.current_page"
          :last-page="result.meta.last_page"
          :total="result.meta.total"
          label="Pagination des alertes de stock"
          unit="alertes"
          @page="goToPage"
        />
        <FreshnessNote
          v-if="read.freshness.value"
          :freshness="read.freshness.value"
          :time-zone="timeZone"
        />
      </template>
    </section>
  </section>
</template>
