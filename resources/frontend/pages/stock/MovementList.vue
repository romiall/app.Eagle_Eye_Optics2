<script setup lang="ts">
/**
 * Liste des mouvements de stock d'UN article (cahier des charges §6, EE026), du plus récent au plus ancien : type,
 * quantité signée, emplacement, lot, motif, auteur et date. Lecture du serveur, EN LIGNE ; le coût unitaire n'est rendu
 * qu'avec `stock.valuation.read` (gérante). Monté seulement quand un article est choisi (la lecture part à la création).
 */
import { computed, ref } from 'vue'

import { clinicTimeZone, formatInstantFr } from '@/app/clinicTime'
import { listStockLocations } from '@/app/services/billing'
import { listStockMovements } from '@/app/services/stockMovements'
import FreshnessNote from '@/components/feedback/FreshnessNote.vue'
import StateMessage from '@/components/feedback/StateMessage.vue'
import SelectField from '@/components/form/SelectField.vue'
import AppButton from '@/components/ui/AppButton.vue'
import PaginationControls from '@/components/ui/PaginationControls.vue'
import type { StockLocation, StockMovementHistoryPage } from '@/domain/contracts/generated'
import { formatCivilDateFr } from '@/domain/inventory/alerts'
import {
  absoluteQuantity,
  isOutgoing,
  MOVEMENT_KIND_LABELS,
  MOVEMENT_KIND_ORDER,
  movementSign,
} from '@/domain/inventory/movements'
import { formatMoney } from '@/domain/values/money'
import { quantityLabel } from '@/pages/sales/format'
import { useServerRead } from '@/pages/today/useServerRead'

const props = defineProps<{ itemId: string }>()

const timeZone = clinicTimeZone()
const kind = ref<string | null>(null)
const locationId = ref<string | null>(null)
const page = ref(1)

const read = useServerRead<StockMovementHistoryPage>(
  () =>
    listStockMovements({
      itemId: props.itemId,
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
const kindOptions = [
  { value: '', label: 'Tous les types' },
  ...MOVEMENT_KIND_ORDER.map((value) => ({ value, label: MOVEMENT_KIND_LABELS[value] })),
]

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
</script>

<template>
  <section aria-labelledby="titre-liste-mouvements" class="space-y-4">
    <h2 id="titre-liste-mouvements" class="text-lg font-semibold">Mouvements</h2>
    <div class="grid gap-3 sm:grid-cols-2">
      <SelectField
        :model-value="kind ?? ''"
        label="Type de mouvement"
        :options="kindOptions"
        control-id="mouvements-type"
        @update:model-value="setKind"
      />
      <SelectField
        :model-value="locationId ?? ''"
        label="Emplacement"
        :options="locationOptions"
        control-id="mouvements-emplacement"
        @update:model-value="setLocationId"
      />
    </div>

    <StateMessage
      v-if="read.state.value === 'loading'"
      state="loading"
      title="Chargement des mouvements…"
    />
    <StateMessage
      v-else-if="read.state.value === 'error' || read.state.value === 'offline'"
      state="error"
      title="Lecture des mouvements impossible"
    >
      {{ read.error.value ?? 'Le serveur n’a pas répondu.' }}
      <template #action>
        <AppButton variant="secondary" @click="read.reload()">Réessayer</AppButton>
      </template>
    </StateMessage>
    <StateMessage v-else-if="read.state.value === 'empty'" state="empty" title="Aucun mouvement">
      Aucun mouvement de stock ne correspond à cet article et à ces filtres.
    </StateMessage>
    <template v-else-if="result !== null">
      <ul class="space-y-3">
        <li
          v-for="movement in result.data"
          :key="movement.id"
          class="space-y-1 rounded-xl border border-line bg-surface shadow-card p-3"
        >
          <p class="font-semibold break-words">
            {{ MOVEMENT_KIND_LABELS[movement.kind] }}
            <span
              class="tabular-nums"
              :class="isOutgoing(movement.signed_quantity) ? 'text-danger' : 'text-success'"
              >{{ movementSign(movement.signed_quantity)
              }}{{ quantityLabel(absoluteQuantity(movement.signed_quantity)) }}</span
            >
          </p>
          <p class="text-sm text-muted break-words">
            {{ formatInstantFr(movement.occurred_at) }} · {{ movement.location_name }}
            <template v-if="movement.actor_name"> · par {{ movement.actor_name }}</template>
          </p>
          <p v-if="movement.lot" class="text-sm break-words">
            Lot {{ movement.lot.batch_number }}
            <template v-if="movement.lot.expires_on">
              · expire le {{ formatCivilDateFr(movement.lot.expires_on) }}</template
            >
          </p>
          <p class="text-sm break-words">Motif : {{ movement.reason }}</p>
          <p v-if="movement.unit_cost !== null" class="text-sm text-muted tabular-nums">
            Coût unitaire : {{ formatMoney(movement.unit_cost) }}
          </p>
        </li>
      </ul>
      <PaginationControls
        :current-page="result.meta.current_page"
        :last-page="result.meta.last_page"
        :total="result.meta.total"
        label="Pagination des mouvements de stock"
        unit="mouvements"
        @page="goToPage"
      />
      <FreshnessNote
        v-if="read.freshness.value"
        :freshness="read.freshness.value"
        :time-zone="timeZone"
      />
    </template>
  </section>
</template>
