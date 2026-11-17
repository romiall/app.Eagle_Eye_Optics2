<script setup lang="ts">
/**
 * Inventaires (L1D02, EE026, EE030, AT30), module « stock », EN LIGNE, droit `stock.inventory` : liste et ouverture d'un
 * inventaire. Ouvrir fige UN emplacement et le théorique de chaque article et de chaque lot à cet instant ; rien n'est
 * écrit dans le stock. Un seul inventaire actif par emplacement. Le comptage se fait sur la page de l'inventaire ; les
 * écarts ne ajustent le stock qu'à la validation de la gérante, par des mouvements signés.
 */
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'

import { clinicTimeZone, clinicToday, formatInstantFr } from '@/app/clinicTime'
import { listStockLocations } from '@/app/services/billing'
import type { MutationOutcome } from '@/app/services/mutations'
import { listInventoryCounts } from '@/app/services/purchasing'
import { revalidateSession } from '@/app/session'
import ErrorSummary, { type FieldErrorItem } from '@/components/feedback/ErrorSummary.vue'
import FreshnessNote from '@/components/feedback/FreshnessNote.vue'
import StateMessage from '@/components/feedback/StateMessage.vue'
import SelectField from '@/components/form/SelectField.vue'
import TextField from '@/components/form/TextField.vue'
import AppButton from '@/components/ui/AppButton.vue'
import LinkButton from '@/components/ui/LinkButton.vue'
import PaginationControls from '@/components/ui/PaginationControls.vue'
import type {
  InventoryCountPage,
  InventoryCountResponse,
  StockLocation,
} from '@/domain/contracts/generated'
import {
  defaultInventoryReference,
  INVENTORY_REFERENCE_MAX,
  INVENTORY_STATUS_LABELS,
  validateOpenInventory,
} from '@/domain/inventory/counting'
import { formatMoney } from '@/domain/values/money'
import { setSalesFlash, takeSalesFlash } from '@/pages/sales/flash'
import SalesReadMessage from '@/pages/sales/SalesReadMessage.vue'
import { useStockCommand } from '@/pages/stock/useStockCommand'
import { useServerRead } from '@/pages/today/useServerRead'

import CommandFailure from '@/pages/purchasing/CommandFailure.vue'

const router = useRouter()
const timeZone = clinicTimeZone()
const notice = ref<string | null>(takeSalesFlash())
const status = ref<string | null>(null)
const page = ref(1)
const read = useServerRead<InventoryCountPage>(
  () => listInventoryCounts({ status: status.value, page: page.value }),
  { isEmpty: (result) => result.data.length === 0 },
)
const result = computed(() => read.data.value)
const locationRead = useServerRead<StockLocation[]>(listStockLocations)
const locationOptions = computed(() =>
  (locationRead.data.value ?? []).map((location) => ({
    value: location.id,
    label: `${location.name} (${location.code})`,
  })),
)

const statusOptions = [
  { value: '', label: 'Tous' },
  { value: 'OPEN', label: 'Ouverts' },
  { value: 'COUNTED', label: 'Comptés, à valider' },
  { value: 'VALIDATED', label: 'Validés' },
  { value: 'ABANDONED', label: 'Abandonnés' },
]

function setStatus(value: string | null): void {
  status.value = value === '' ? null : value
  page.value = 1
  void read.reload()
}

function goToPage(next: number): void {
  page.value = next
  void read.reload()
}

// --- Ouverture ------------------------------------------------------------------------------------------------

const command = useStockCommand('')
const { mutation } = command
const saving = computed(() => mutation.state.value === 'saving')
const locationId = ref<string | null>(null)
const reference = ref(defaultInventoryReference(clinicToday().toString()))
const errors = ref<{ locationId?: string; reference?: string; general?: string }>({})
const summaryBox = ref<{ focus: () => Promise<void> } | null>(null)

const summary = computed<FieldErrorItem[]>(() => {
  const items: FieldErrorItem[] = []
  if (errors.value.general !== undefined) {
    items.push({ fieldId: 'inventaire-emplacement', message: errors.value.general })
  }
  if (errors.value.locationId !== undefined) {
    items.push({ fieldId: 'inventaire-emplacement', message: errors.value.locationId })
  }
  if (errors.value.reference !== undefined) {
    items.push({ fieldId: 'inventaire-reference', message: errors.value.reference })
  }
  return items
})

async function afterOpen(outcome: MutationOutcome): Promise<void> {
  switch (outcome.kind) {
    case 'synced': {
      const opened = (outcome.result as InventoryCountResponse).data
      mutation.reset()
      setSalesFlash(
        `Inventaire ouvert : ${opened.line_count} ligne${opened.line_count > 1 ? 's' : ''} à compter, théorique figé.`,
      )
      await router.push({ name: 'inventory', params: { id: opened.id } })
      return
    }
    case 'refused':
    case 'conflict': {
      const next: { locationId?: string; reference?: string; general?: string } = {}
      const fields = command.fields.value
      if (fields['location_id'] !== undefined) next.locationId = fields['location_id']
      if (fields['reference'] !== undefined) next.reference = fields['reference']
      if (Object.keys(next).length === 0)
        next.general = command.message.value ?? 'Ouverture refusée.'
      errors.value = next
      await summaryBox.value?.focus()
      return
    }
    case 'session-expired':
      void revalidateSession().catch(() => undefined)
      return
    default:
      return
  }
}

async function openInventory(): Promise<void> {
  if (saving.value) return
  notice.value = null
  const checked = validateOpenInventory({
    locationId: locationId.value,
    reference: reference.value,
  })
  errors.value = checked.errors
  if (checked.request === null) {
    await summaryBox.value?.focus()
    return
  }
  await afterOpen(
    await command.send({
      name: 'OpenInventoryCount',
      route: { method: 'POST', path: '/inventory-counts' },
      payload: checked.request,
    }),
  )
}

async function retry(): Promise<void> {
  if (saving.value) return
  await afterOpen(await command.retry())
}
</script>

<template>
  <section aria-labelledby="titre-inventaires" class="max-w-3xl space-y-6">
    <h1 id="titre-inventaires" class="text-2xl font-semibold tracking-tight">Inventaires</h1>
    <p class="max-w-prose text-base text-muted">
      Un inventaire compte un emplacement à un instant donné. Ouvrir un inventaire ne change rien au
      stock : les écarts ne sont ajustés qu’à la validation de la gérante, par des mouvements signés
      et motivés.
    </p>
    <LinkButton :to="{ name: 'stock' }" variant="ghost">Retour au stock</LinkButton>

    <StateMessage v-if="notice" state="success" :title="notice" />

    <section aria-labelledby="titre-ouvrir-inventaire" class="space-y-4">
      <h2 id="titre-ouvrir-inventaire" class="text-lg font-semibold">Ouvrir un inventaire</h2>
      <form
        novalidate
        class="space-y-4"
        aria-labelledby="titre-ouvrir-inventaire"
        @submit.prevent="openInventory"
      >
        <ErrorSummary ref="summaryBox" :errors="summary" />
        <CommandFailure
          :state="mutation.state.value"
          :message="null"
          :failure-message="mutation.failureMessage.value"
          :saving="saving"
          @retry="retry"
        />
        <div class="grid gap-3 sm:grid-cols-2">
          <SelectField
            v-model="locationId"
            label="Emplacement à inventorier"
            :options="locationOptions"
            placeholder="Choisir l’emplacement"
            control-id="inventaire-emplacement"
            :error="errors.locationId ?? null"
            :disabled="saving"
            required
          />
          <TextField
            v-model="reference"
            label="Référence de l’inventaire"
            hint="Unique, par exemple INV-2026-11-10."
            :maxlength="INVENTORY_REFERENCE_MAX"
            control-id="inventaire-reference"
            :error="errors.reference ?? null"
            :disabled="saving"
            required
          />
        </div>
        <AppButton type="submit" :pending="saving" pending-label="Ouverture en cours…"
          >Ouvrir l’inventaire</AppButton
        >
      </form>
    </section>

    <section aria-labelledby="titre-liste-inventaires" class="space-y-3">
      <h2 id="titre-liste-inventaires" class="text-lg font-semibold">Inventaires</h2>
      <SelectField
        :model-value="status ?? ''"
        label="Afficher"
        :options="statusOptions"
        control-id="inventaires-statut"
        @update:model-value="setStatus"
      />
      <SalesReadMessage
        v-if="read.state.value !== 'ready' && read.state.value !== 'empty'"
        :state="read.state.value"
        subject="les inventaires"
        :error="read.error.value"
        @retry="read.reload()"
      />
      <StateMessage v-else-if="read.state.value === 'empty'" state="empty" title="Aucun inventaire">
        Aucun inventaire ne correspond : ouvrez-en un ci-dessus.
      </StateMessage>
      <template v-else-if="result !== null">
        <ul class="space-y-3">
          <li
            v-for="count in result.data"
            :key="count.id"
            class="space-y-1 rounded-xl border border-line bg-surface shadow-card p-3"
          >
            <p class="font-semibold break-words">
              {{ count.reference }} · {{ count.location_name }}
            </p>
            <p class="text-sm text-muted break-words">
              {{ INVENTORY_STATUS_LABELS[count.status] ?? count.status }} · figé le
              {{ formatInstantFr(count.snapshot_at) }} · {{ count.counted_lines }} ligne{{
                count.counted_lines > 1 ? 's' : ''
              }}
              comptée{{ count.counted_lines > 1 ? 's' : '' }} sur {{ count.line_count }}
            </p>
            <p class="text-base">
              {{ count.variance_lines }} écart{{ count.variance_lines > 1 ? 's' : '' }}
              <template v-if="count.variance_value_known !== null">
                · valeur au coût connu :
                <strong>{{ formatMoney(count.variance_value_known) }}</strong>
                <template v-if="(count.unknown_cost_lines ?? 0) > 0">
                  · {{ count.unknown_cost_lines }} écart{{
                    (count.unknown_cost_lines ?? 0) > 1 ? 's' : ''
                  }}
                  à coût inconnu
                </template>
              </template>
            </p>
            <LinkButton
              :to="{ name: 'inventory', params: { id: count.id } }"
              variant="secondary"
              :accessible-name="`Ouvrir l’inventaire ${count.reference}`"
              >{{
                count.status === 'OPEN' || count.status === 'COUNTED' ? 'Continuer' : 'Voir'
              }}</LinkButton
            >
          </li>
        </ul>
        <PaginationControls
          :current-page="result.meta.current_page"
          :last-page="result.meta.last_page"
          :total="result.meta.total"
          label="Pagination des inventaires"
          unit="inventaires"
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
