<script setup lang="ts">
/**
 * Réceptions fournisseur (L1D01, EE026, EE027, AT30), module « stock », EN LIGNE, droit `stock.receive` : liste des
 * brouillons et des réceptions validées, avec la valeur au coût CONNU et le nombre de lignes à coût inconnu (jamais
 * valorisées à zéro). Le stock n'augmente que par une réception validée ; un brouillon ne touche à rien.
 */
import { computed, ref } from 'vue'

import { clinicTimeZone, formatInstantFr } from '@/app/clinicTime'
import { listGoodsReceipts } from '@/app/services/purchasing'
import { takeSalesFlash } from '@/pages/sales/flash'
import FreshnessNote from '@/components/feedback/FreshnessNote.vue'
import StateMessage from '@/components/feedback/StateMessage.vue'
import SelectField from '@/components/form/SelectField.vue'
import LinkButton from '@/components/ui/LinkButton.vue'
import PaginationControls from '@/components/ui/PaginationControls.vue'
import type { GoodsReceiptPage } from '@/domain/contracts/generated'
import { RECEIPT_STATUS_LABELS } from '@/domain/inventory/purchasing'
import { formatMoney } from '@/domain/values/money'
import SalesReadMessage from '@/pages/sales/SalesReadMessage.vue'
import { useServerRead } from '@/pages/today/useServerRead'

const timeZone = clinicTimeZone()
const notice = ref<string | null>(takeSalesFlash())
const status = ref<string | null>(null)
const page = ref(1)
const read = useServerRead<GoodsReceiptPage>(
  () => listGoodsReceipts({ status: status.value, page: page.value }),
  { isEmpty: (result) => result.data.length === 0 },
)
const result = computed(() => read.data.value)

const statusOptions = [
  { value: '', label: 'Toutes' },
  { value: 'DRAFT', label: 'Brouillons' },
  { value: 'VALIDATED', label: 'Validées' },
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
</script>

<template>
  <section aria-labelledby="titre-receptions" class="max-w-3xl space-y-6">
    <h1 id="titre-receptions" class="text-2xl font-semibold tracking-tight">
      Réceptions fournisseur
    </h1>
    <p class="max-w-prose text-base text-muted">
      Une réception est la marchandise reçue d’un fournisseur. Le stock n’augmente que lorsque la
      réception est validée (lots et coûts confirmés) : un brouillon ne touche à rien.
    </p>
    <div class="flex flex-wrap gap-3">
      <LinkButton :to="{ name: 'goods-receipt-new' }">Nouvelle réception</LinkButton>
      <LinkButton :to="{ name: 'suppliers' }" variant="secondary">Fournisseurs</LinkButton>
      <LinkButton :to="{ name: 'stock' }" variant="ghost">Retour au stock</LinkButton>
    </div>

    <StateMessage v-if="notice" state="success" :title="notice" />

    <SelectField
      :model-value="status ?? ''"
      label="Afficher"
      :options="statusOptions"
      control-id="receptions-statut"
      @update:model-value="setStatus"
    />

    <SalesReadMessage
      v-if="read.state.value !== 'ready' && read.state.value !== 'empty'"
      :state="read.state.value"
      subject="les réceptions"
      :error="read.error.value"
      @retry="read.reload()"
    />
    <StateMessage v-else-if="read.state.value === 'empty'" state="empty" title="Aucune réception">
      Aucune réception ne correspond : créez la première avec « Nouvelle réception ».
    </StateMessage>
    <template v-else-if="result !== null">
      <ul class="space-y-3">
        <li
          v-for="receipt in result.data"
          :key="receipt.id"
          class="space-y-1 rounded-xl border border-line bg-surface shadow-card p-3"
        >
          <p class="font-semibold break-words">
            {{ receipt.supplier_name }} · livraison {{ receipt.supplier_reference }}
          </p>
          <p class="text-sm text-muted break-words">
            {{ RECEIPT_STATUS_LABELS[receipt.status] ?? receipt.status }} ·
            {{ formatInstantFr(receipt.received_at) }} · {{ receipt.location_name }} ·
            {{ receipt.line_count }} ligne{{ receipt.line_count > 1 ? 's' : '' }}
          </p>
          <p class="text-base">
            Valeur au coût connu : <strong>{{ formatMoney(receipt.known_cost_total) }}</strong>
            <template v-if="receipt.unknown_cost_lines > 0">
              · {{ receipt.unknown_cost_lines }} ligne{{
                receipt.unknown_cost_lines > 1 ? 's' : ''
              }}
              à coût inconnu (non valorisée{{ receipt.unknown_cost_lines > 1 ? 's' : '' }})
            </template>
          </p>
          <LinkButton
            :to="{ name: 'goods-receipt', params: { id: receipt.id } }"
            variant="secondary"
            :accessible-name="`${receipt.status === 'DRAFT' ? 'Ouvrir' : 'Voir'} la réception ${receipt.supplier_reference}`"
            >{{
              receipt.status === 'DRAFT' ? 'Ouvrir le brouillon' : 'Voir la réception'
            }}</LinkButton
          >
        </li>
      </ul>
      <PaginationControls
        :current-page="result.meta.current_page"
        :last-page="result.meta.last_page"
        :total="result.meta.total"
        label="Pagination des réceptions"
        unit="réceptions"
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
