<script setup lang="ts">
/**
 * Liste des commandes atelier (L1D04), EN LIGNE, droit `workshop.manage` : filtres par état et
 * retard, état du bon laboratoire anonymisé et accès direct à la fiche de montage. Aucun montant
 * financier n'apparaît ici.
 */
import { computed, ref } from 'vue'

import { clinicTimeZone, formatInstantFr } from '@/app/clinicTime'
import { listWorkshopOrders } from '@/app/services/workshop'
import StateMessage from '@/components/feedback/StateMessage.vue'
import FreshnessNote from '@/components/feedback/FreshnessNote.vue'
import CheckboxField from '@/components/form/CheckboxField.vue'
import SelectField from '@/components/form/SelectField.vue'
import EmptyState from '@/components/layout/EmptyState.vue'
import PageHeader from '@/components/layout/PageHeader.vue'
import SectionCard from '@/components/layout/SectionCard.vue'
import StatusChip from '@/components/layout/StatusChip.vue'
import AppButton from '@/components/ui/AppButton.vue'
import LinkButton from '@/components/ui/LinkButton.vue'
import PaginationControls from '@/components/ui/PaginationControls.vue'
import { formatQuantity } from '@/documents/engine/format'
import type { WorkshopOrdersStatus } from '@/domain/contracts/generated'
import { patientDisplayName } from '@/domain/patients/identity'
import { WORKSHOP_STATUS_LABELS } from '@/domain/workshop/orders'
import { takeSalesFlash } from '@/pages/sales/flash'
import SalesReadMessage from '@/pages/sales/SalesReadMessage.vue'
import { useServerRead } from '@/pages/today/useServerRead'

import { WORKSHOP_STATUS_TONES } from './presentation'

const timeZone = clinicTimeZone()
const notice = ref<string | null>(takeSalesFlash())
const statusFilter = ref<WorkshopOrdersStatus | null>(null)
const overdueOnly = ref(false)
const page = ref(1)

const STATUS_OPTIONS: readonly { value: WorkshopOrdersStatus; label: string }[] = (
  Object.entries(WORKSHOP_STATUS_LABELS) as [WorkshopOrdersStatus, string][]
).map(([value, label]) => ({ value, label }))

const hasActiveFilters = computed(() => statusFilter.value !== null || overdueOnly.value)

const read = useServerRead(
  () =>
    listWorkshopOrders({
      status: statusFilter.value,
      overdue: overdueOnly.value,
      page: page.value,
    }),
  { isEmpty: (result) => result.data.length === 0 },
)

const orders = computed(() => read.data.value?.data ?? [])
const meta = computed(() => read.data.value?.meta ?? null)

function applyFilter(): void {
  page.value = 1
  void read.reload()
}

function updateStatus(value: string | null): void {
  statusFilter.value = (value as WorkshopOrdersStatus | null) ?? null
  applyFilter()
}

function updateOverdue(checked: boolean): void {
  overdueOnly.value = checked
  applyFilter()
}

function resetFilters(): void {
  statusFilter.value = null
  overdueOnly.value = false
  page.value = 1
  void read.reload()
}

function goPage(next: number): void {
  page.value = next
  void read.reload()
}

function reload(): void {
  void read.reload()
}
</script>

<template>
  <section aria-labelledby="titre-atelier" class="space-y-6">
    <PageHeader
      title-id="titre-atelier"
      eyebrow="Atelier optique"
      title="Atelier optique"
      subtitle="Suivi des montages confiés aux laboratoires optiques, contrôles qualité, reprises et bons laboratoire anonymisés."
      icon="workshop"
    >
      <template #actions>
        <LinkButton :to="{ name: 'atelier-nouveau' }" variant="primary">
          Nouvelle commande atelier
        </LinkButton>
      </template>
    </PageHeader>

    <StateMessage v-if="notice" state="success" title="Commande enregistrée">
      {{ notice }}
    </StateMessage>

    <SectionCard title="Filtrer les commandes" title-id="titre-filtres-atelier">
      <div class="grid gap-4 sm:grid-cols-2 sm:items-end">
        <SelectField
          control-id="atelier-filtre-statut"
          label="État de la commande"
          placeholder="Tous les états"
          :model-value="statusFilter"
          :options="STATUS_OPTIONS"
          @update:model-value="updateStatus"
        />
        <div class="space-y-2 pb-1">
          <CheckboxField
            control-id="atelier-filtre-retard"
            :model-value="overdueOnly"
            label="Uniquement les commandes en retard"
            @update:model-value="updateOverdue"
          />
          <AppButton v-if="hasActiveFilters" variant="ghost" @click="resetFilters">
            Réinitialiser les filtres
          </AppButton>
        </div>
      </div>
    </SectionCard>

    <SalesReadMessage
      v-if="read.state.value !== 'ready' && read.state.value !== 'empty'"
      :state="read.state.value"
      subject="les commandes atelier"
      :error="read.error.value"
      @retry="reload"
    />

    <EmptyState
      v-else-if="read.state.value === 'empty'"
      icon="workshop"
      :title="
        hasActiveFilters
          ? 'Aucune commande atelier pour ces filtres'
          : 'Aucune commande atelier enregistrée'
      "
    >
      <template v-if="hasActiveFilters">
        Aucune commande ne correspond à l’état ou au filtre de retard sélectionné.
      </template>
      <template v-else>
        Créez une première commande atelier à partir d’une ligne de facture émise et d’une
        prescription optique validée.
      </template>
      <template #action>
        <AppButton v-if="hasActiveFilters" variant="secondary" @click="resetFilters">
          Afficher toutes les commandes
        </AppButton>
        <LinkButton v-else :to="{ name: 'atelier-nouveau' }" variant="primary">
          Créer une commande atelier
        </LinkButton>
      </template>
    </EmptyState>

    <div v-else class="space-y-4">
      <ul class="space-y-3" aria-label="Liste des commandes atelier">
        <li
          v-for="order in orders"
          :key="order.id"
          class="rounded-xl border border-line bg-surface p-4 shadow-card sm:p-5"
        >
          <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div class="min-w-0 space-y-2">
              <div class="flex flex-wrap items-center gap-2">
                <span class="font-semibold text-ink tabular-nums">{{ order.reference }}</span>
                <StatusChip :tone="WORKSHOP_STATUS_TONES[order.status]">
                  {{ WORKSHOP_STATUS_LABELS[order.status] }}
                </StatusChip>
                <StatusChip v-if="order.is_overdue" tone="danger" icon="warning">
                  En retard
                </StatusChip>
                <StatusChip v-if="order.ready_revision > 1" tone="gold">
                  Prête révision {{ order.ready_revision }}
                </StatusChip>
                <StatusChip v-if="order.document?.document_status === 'READY'" tone="success">
                  Bon labo archivé
                </StatusChip>
              </div>

              <p class="text-base text-ink">
                <strong>{{
                  patientDisplayName(order.patient.last_name, order.patient.first_names)
                }}</strong>
                <span class="text-muted"> · Dossier {{ order.patient.record_number }}</span>
              </p>

              <p class="text-sm text-muted">
                Facture {{ order.invoice_number }} · {{ order.invoice_line_description }} ({{
                  formatQuantity(order.quantity)
                }}) · Ordonnance v{{ order.prescription_version_no }}
              </p>

              <p class="text-sm text-muted">
                Laboratoire : <strong class="text-ink">{{ order.supplier_name }}</strong>
                <template v-if="order.lab_reference">
                  · Réf. labo : {{ order.lab_reference }}</template
                >
                <template v-if="order.frame_reference">
                  · Monture : {{ order.frame_reference }}</template
                >
              </p>

              <p class="text-sm text-muted">
                Commandée le {{ formatInstantFr(order.ordered_at) }}
                <template v-if="order.expected_at">
                  · Échéance prévue : {{ formatInstantFr(order.expected_at) }}
                </template>
              </p>
            </div>

            <div class="shrink-0">
              <LinkButton
                :to="{ name: 'atelier-detail', params: { id: order.id } }"
                variant="secondary"
                :accessible-name="`Ouvrir la commande ${order.reference}`"
              >
                Ouvrir
              </LinkButton>
            </div>
          </div>
        </li>
      </ul>

      <PaginationControls
        v-if="meta && meta.last_page > 1"
        :current-page="meta.current_page"
        :last-page="meta.last_page"
        :total="meta.total"
        label="Pagination des commandes atelier"
        unit="commandes"
        @page="goPage"
      />
    </div>

    <FreshnessNote
      v-if="read.freshness.value"
      :freshness="read.freshness.value"
      :time-zone="timeZone"
    />
  </section>
</template>
