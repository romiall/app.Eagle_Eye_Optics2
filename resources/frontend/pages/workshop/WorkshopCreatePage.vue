<script setup lang="ts">
/**
 * Création d'une commande atelier (L1D04) : rattachement d'une ligne facturée admissible avec
 * reliquat > 0 à une ordonnance optique validée du patient, à un laboratoire optique actif et, si
 * souhaité, à une monture du catalogue. Le bon laboratoire reste anonymisé.
 */
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import { clinicTimeZone, formatInstantFr } from '@/app/clinicTime'
import type { MutationOutcome } from '@/app/services/mutations'
import { getWorkshopEligibleLines } from '@/app/services/workshop'
import { revalidateSession } from '@/app/session'
import { useUnsavedChangesGuard } from '@/app/unsavedChanges'
import MeasureField from '@/components/clinical/MeasureField.vue'
import ErrorSummary, { type FieldErrorItem } from '@/components/feedback/ErrorSummary.vue'
import FreshnessNote from '@/components/feedback/FreshnessNote.vue'
import StateMessage from '@/components/feedback/StateMessage.vue'
import DateField from '@/components/form/DateField.vue'
import DecimalField from '@/components/form/DecimalField.vue'
import SelectField from '@/components/form/SelectField.vue'
import TextAreaField from '@/components/form/TextAreaField.vue'
import TextField from '@/components/form/TextField.vue'
import EmptyState from '@/components/layout/EmptyState.vue'
import PageHeader from '@/components/layout/PageHeader.vue'
import SectionCard from '@/components/layout/SectionCard.vue'
import AppButton from '@/components/ui/AppButton.vue'
import LinkButton from '@/components/ui/LinkButton.vue'
import { formatQuantity } from '@/documents/engine/format'
import type {
  WorkshopEligibleInvoiceLine,
  WorkshopEligiblePrescription,
  WorkshopOrderResponse,
} from '@/domain/contracts/generated'
import { patientDisplayName } from '@/domain/patients/identity'
import {
  prescriptionLabel,
  prescriptionLensTypeDefault,
  validateCreateWorkshopOrder,
} from '@/domain/workshop/orders'
import CommandFailure from '@/pages/purchasing/CommandFailure.vue'
import { setSalesFlash } from '@/pages/sales/flash'
import SalesReadMessage from '@/pages/sales/SalesReadMessage.vue'
import { useStockCommand } from '@/pages/stock/useStockCommand'
import { useServerRead } from '@/pages/today/useServerRead'

import { prescriptionEyeDisplayRows } from './presentation'

const router = useRouter()
const timeZone = clinicTimeZone()
const command = useStockCommand('')
const { mutation } = command
const saving = computed(() => mutation.state.value === 'saving')

const searchQuery = ref('')
const appliedQuery = ref('')

const eligibleRead = useServerRead(
  () => getWorkshopEligibleLines({ q: appliedQuery.value || null }),
  { isEmpty: () => false },
)

const summaryBox = ref<{ focus: () => Promise<void> } | null>(null)
const quantityRef = ref<{ commit: () => boolean } | null>(null)
const expectedDateRef = ref<{ commit: () => boolean } | null>(null)

const FIELD_IDS = {
  invoice_line_id: 'atelier-ligne-facture',
  prescription_id: 'atelier-ordonnance',
  supplier_id: 'atelier-laboratoire',
  frame_item_id: 'atelier-monture',
  frame_reference_snapshot: 'atelier-reference-monture',
  quantity: 'atelier-quantite',
  expected_at: 'atelier-date-prevue',
  lens_type: 'atelier-type-verre',
  pd_od: 'atelier-dp-od',
  pd_og: 'atelier-dp-og',
  fitting_height_od: 'atelier-hauteur-od',
  fitting_height_og: 'atelier-hauteur-og',
  lab_reference: 'atelier-reference-labo',
  notes: 'atelier-notes',
} as const

const selectedLineId = ref<string | null>(null)
const selectedPrescriptionId = ref<string | null>(null)
const supplierId = ref<string | null>(null)
const frameItemId = ref<string | null>(null)
const frameReferenceSnapshot = ref('')
const labReference = ref('')
const expectedDate = ref<string | null>(null)
const quantity = ref<string | null>(null)
const lensType = ref('')
const pdOd = ref('')
const pdOg = ref('')
const fittingHeightOd = ref('')
const fittingHeightOg = ref('')
const notes = ref('')
const errors = ref<Record<string, string>>({})
const submitted = ref(false)
useUnsavedChangesGuard(
  computed(
    () =>
      !submitted.value &&
      (selectedLineId.value !== null ||
        supplierId.value !== null ||
        frameItemId.value !== null ||
        frameReferenceSnapshot.value !== '' ||
        labReference.value !== '' ||
        notes.value !== ''),
  ),
)

const eligible = computed(() => eligibleRead.data.value)
const lines = computed<WorkshopEligibleInvoiceLine[]>(() => eligible.value?.lines ?? [])
const selectedLine = computed(
  () => lines.value.find((line) => line.invoice_line_id === selectedLineId.value) ?? null,
)
const patientPrescriptions = computed<WorkshopEligiblePrescription[]>(() => {
  const current = selectedLine.value
  if (current === null || eligible.value === null) return []
  return eligible.value.prescriptions.filter((rx) => rx.patient_id === current.patient.id)
})
const selectedPrescription = computed(
  () => patientPrescriptions.value.find((rx) => rx.id === selectedPrescriptionId.value) ?? null,
)

const supplierOptions = computed(() =>
  (eligible.value?.suppliers ?? []).map((supplier) => ({
    value: supplier.id,
    label: `${supplier.name} (${supplier.reference})`,
  })),
)

const frameOptions = computed(() =>
  (eligible.value?.frames ?? []).map((frame) => {
    const details = [frame.brand, frame.model]
      .filter((part) => part !== null && part !== '')
      .join(' ')
    return {
      value: frame.id,
      label:
        details === ''
          ? `${frame.name} (${frame.reference})`
          : `${frame.name} · ${details} (${frame.reference})`,
    }
  }),
)

const errorList = computed<FieldErrorItem[]>(() =>
  Object.entries(errors.value).map(([field, message]) => ({
    fieldId: FIELD_IDS[field as keyof typeof FIELD_IDS] ?? 'atelier-ligne-facture',
    message,
  })),
)

function applyPrescriptionDefaults(rx: WorkshopEligiblePrescription): void {
  lensType.value = prescriptionLensTypeDefault(rx)
  pdOd.value = rx.pd_od ?? ''
  pdOg.value = rx.pd_og ?? ''
  const od = rx.eyes.find((eye) => eye.eye === 'OD') ?? null
  const og = rx.eyes.find((eye) => eye.eye === 'OG') ?? null
  fittingHeightOd.value = od?.fitting_height ?? ''
  fittingHeightOg.value = og?.fitting_height ?? ''
}

watch(
  selectedLineId,
  (lineId) => {
    if (lineId === null) {
      selectedPrescriptionId.value = null
      return
    }
    const line = lines.value.find((candidate) => candidate.invoice_line_id === lineId)
    if (line === undefined) return
    quantity.value = line.remaining_quantity
    const matchesFrame = (eligible.value?.frames ?? []).some((frame) => frame.id === line.item_id)
    frameItemId.value = matchesFrame ? line.item_id : null

    const matchingPrescriptions = (eligible.value?.prescriptions ?? []).filter(
      (rx) => rx.patient_id === line.patient.id,
    )
    const linked =
      line.linked_prescription_id !== null
        ? (matchingPrescriptions.find((rx) => rx.id === line.linked_prescription_id) ?? null)
        : null
    const nextRx =
      linked ?? (matchingPrescriptions.length === 1 ? (matchingPrescriptions[0] ?? null) : null)
    selectedPrescriptionId.value = nextRx?.id ?? null
    if (nextRx !== null) applyPrescriptionDefaults(nextRx)
  },
  { flush: 'sync' },
)

watch(selectedPrescriptionId, (prescriptionId) => {
  if (prescriptionId === null) return
  const rx = patientPrescriptions.value.find((candidate) => candidate.id === prescriptionId)
  if (rx !== undefined) applyPrescriptionDefaults(rx)
})

watch(
  () => eligible.value?.suppliers,
  (suppliers) => {
    if (suppliers !== undefined && suppliers.length === 1 && supplierId.value === null) {
      supplierId.value = suppliers[0]?.id ?? null
    }
  },
  { immediate: true },
)

function clearError(field: string): void {
  if (errors.value[field] === undefined) return
  const next = { ...errors.value }
  delete next[field]
  errors.value = next
}

function runSearch(): void {
  appliedQuery.value = searchQuery.value.trim()
  void eligibleRead.reload()
}

function resetSearch(): void {
  searchQuery.value = ''
  appliedQuery.value = ''
  void eligibleRead.reload()
}

function mapServerErrors(): void {
  const mapped: Record<string, string> = {}
  for (const [field, message] of Object.entries(command.fields.value)) {
    mapped[field] = message
  }
  if (Object.keys(mapped).length === 0 && command.message.value !== null) {
    mapped['invoice_line_id'] = command.message.value
  }
  errors.value = mapped
}

async function handleOutcome(outcome: MutationOutcome): Promise<void> {
  switch (outcome.kind) {
    case 'synced': {
      const created = (outcome.result as WorkshopOrderResponse).data
      submitted.value = true
      setSalesFlash(`Commande atelier ${created.reference} enregistrée.`)
      await router.replace({ name: 'atelier-detail', params: { id: created.id } })
      return
    }
    case 'refused':
    case 'conflict':
      mapServerErrors()
      await summaryBox.value?.focus()
      return
    case 'session-expired':
      void revalidateSession().catch(() => undefined)
      return
    default:
      return
  }
}

async function submit(): Promise<void> {
  if (saving.value) return
  const qtyOk = quantityRef.value?.commit() ?? true
  const dateOk = expectedDateRef.value?.commit() ?? true

  const validation = validateCreateWorkshopOrder(
    {
      invoiceLineId: selectedLineId.value,
      prescriptionId: selectedPrescriptionId.value,
      supplierId: supplierId.value,
      frameItemId: frameItemId.value,
      frameReferenceSnapshot: frameReferenceSnapshot.value,
      labReference: labReference.value,
      expectedDate: expectedDate.value,
      quantity: quantity.value,
      lensType: lensType.value,
      pdOd: pdOd.value.trim() === '' ? null : pdOd.value,
      pdOg: pdOg.value.trim() === '' ? null : pdOg.value,
      fittingHeightOd: fittingHeightOd.value.trim() === '' ? null : fittingHeightOd.value,
      fittingHeightOg: fittingHeightOg.value.trim() === '' ? null : fittingHeightOg.value,
      notes: notes.value,
    },
    selectedLine.value?.remaining_quantity ?? null,
  )

  const combinedErrors = { ...validation.errors }
  if (!qtyOk && combinedErrors['quantity'] === undefined) {
    combinedErrors['quantity'] = 'Quantité invalide.'
  }
  if (!dateOk && combinedErrors['expected_at'] === undefined) {
    combinedErrors['expected_at'] = 'Date d’échéance attendue invalide.'
  }

  errors.value = combinedErrors
  if (Object.keys(combinedErrors).length > 0 || validation.request === null || !qtyOk || !dateOk) {
    await summaryBox.value?.focus()
    return
  }

  await handleOutcome(
    await command.send({
      name: 'CreateWorkshopOrder',
      route: { method: 'POST', path: '/workshop-orders', expectedVersion: 'none' },
      payload: validation.request as unknown as Record<string, unknown>,
      expectedVersion: null,
    }),
  )
}

async function retrySubmit(): Promise<void> {
  await handleOutcome(await command.retry())
}

function reload(): void {
  void eligibleRead.reload()
}
</script>

<template>
  <section aria-labelledby="titre-nouvel-atelier" class="space-y-6">
    <PageHeader
      title-id="titre-nouvel-atelier"
      eyebrow="Atelier optique"
      title="Nouvelle commande atelier"
      subtitle="Sélectionnez une ligne de facture émise, une ordonnance validée et un laboratoire optique actif. Le bon laboratoire produit reste anonymisé."
      icon="workshop"
      :back="{ to: { name: 'workshop' }, label: 'Retour à l’atelier' }"
    />

    <SectionCard title="Rechercher une ligne facturée" title-id="titre-recherche-atelier">
      <form class="flex flex-col gap-3 sm:flex-row sm:items-end" @submit.prevent="runSearch">
        <div class="min-w-0 flex-1">
          <TextField
            v-model="searchQuery"
            control-id="atelier-recherche-ligne"
            label="Facture, patient (nom ou dossier) ou article"
            type="search"
            placeholder="Ex. FAC-2026 ou NGONO…"
          />
        </div>
        <div class="flex flex-wrap gap-2">
          <AppButton type="submit" variant="secondary">Rechercher</AppButton>
          <AppButton v-if="appliedQuery !== ''" variant="ghost" @click="resetSearch">
            Effacer
          </AppButton>
        </div>
      </form>
    </SectionCard>

    <SalesReadMessage
      v-if="eligibleRead.state.value !== 'ready'"
      :state="eligibleRead.state.value"
      subject="les lignes facturées admissibles"
      :error="eligibleRead.error.value"
      @retry="reload"
    />

    <form v-else novalidate class="space-y-6" @submit.prevent="submit">
      <ErrorSummary ref="summaryBox" :errors="errorList" />

      <CommandFailure
        :state="mutation.state.value"
        :message="command.message.value"
        :failure-message="mutation.failureMessage.value"
        :saving="saving"
        @retry="retrySubmit"
      />

      <SectionCard
        title="1. Ligne de facture à envoyer au laboratoire"
        title-id="titre-etape-ligne"
        description="Seules les lignes d’optique issues de factures émises avec un reliquat à commander apparaissent ici."
      >
        <EmptyState
          v-if="lines.length === 0"
          flat
          icon="sales"
          title="Aucune ligne facturée disponible"
        >
          Aucune ligne émise n’a de reliquat optique à commander pour l’instant.
        </EmptyState>
        <fieldset v-else :id="FIELD_IDS.invoice_line_id" tabindex="-1" class="space-y-2">
          <legend class="sr-only">Ligne de facture à commander</legend>
          <p v-if="errors.invoice_line_id" class="text-sm font-medium text-danger" role="alert">
            ⚠ {{ errors.invoice_line_id }}
          </p>
          <div class="space-y-2">
            <label
              v-for="line in lines"
              :key="line.invoice_line_id"
              class="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-line bg-canvas p-3.5 hover:border-primary has-checked:border-gold has-checked:bg-primary-soft"
            >
              <input
                v-model="selectedLineId"
                type="radio"
                name="atelier-invoice-line"
                :value="line.invoice_line_id"
                class="mt-1 size-5 shrink-0 accent-primary"
                @change="clearError('invoice_line_id')"
              />
              <span class="min-w-0 space-y-1 text-base text-ink">
                <span class="block font-semibold">
                  Facture {{ line.invoice_number }} · {{ line.description }}
                </span>
                <span class="block text-sm text-muted">
                  Patient :
                  <strong class="text-ink">{{
                    patientDisplayName(line.patient.last_name, line.patient.first_names)
                  }}</strong>
                  (dossier {{ line.patient.record_number }}) · Émise le
                  {{ formatInstantFr(line.issued_at) }}
                </span>
                <span class="block text-sm font-medium text-ink">
                  Facturée : {{ formatQuantity(line.quantity) }} · Déjà commandée :
                  {{ formatQuantity(line.ordered_quantity) }} · Reliquat :
                  {{ formatQuantity(line.remaining_quantity) }}
                </span>
              </span>
            </label>
          </div>
        </fieldset>
      </SectionCard>

      <SectionCard
        v-if="selectedLine"
        title="2. Ordonnance optique validée"
        title-id="titre-etape-ordonnance"
        description="Les mesures OD/OG de l’ordonnance sélectionnée sont figées sur la commande atelier."
      >
        <StateMessage
          v-if="patientPrescriptions.length === 0"
          state="error"
          title="Aucune ordonnance validée pour ce patient"
        >
          Validez d’abord une prescription optique (interne ou externe) dans le dossier patient
          avant de commander les verres.
        </StateMessage>

        <fieldset v-else :id="FIELD_IDS.prescription_id" tabindex="-1" class="space-y-3">
          <legend class="sr-only">Ordonnance optique validée</legend>
          <p v-if="errors.prescription_id" class="text-sm font-medium text-danger" role="alert">
            ⚠ {{ errors.prescription_id }}
          </p>
          <div class="space-y-3">
            <label
              v-for="rx in patientPrescriptions"
              :key="rx.id"
              class="block cursor-pointer rounded-xl border border-line bg-canvas p-3.5 hover:border-primary has-checked:border-gold has-checked:bg-primary-soft"
            >
              <span class="flex items-start gap-3">
                <input
                  v-model="selectedPrescriptionId"
                  type="radio"
                  name="atelier-prescription"
                  :value="rx.id"
                  class="mt-1 size-5 shrink-0 accent-primary"
                  @change="clearError('prescription_id')"
                />
                <span class="min-w-0 flex-1 space-y-2">
                  <span class="block font-semibold text-ink">
                    {{ prescriptionLabel(rx) }}
                  </span>
                  <span class="block text-sm text-muted">
                    Validée le {{ formatInstantFr(rx.validated_at) }}
                    <template v-if="selectedLine.linked_prescription_id === rx.id">
                      · Rattachée à la ligne facturée
                    </template>
                  </span>
                  <span class="block overflow-x-auto">
                    <table class="min-w-full border-collapse text-sm">
                      <thead>
                        <tr class="border-b border-line text-left text-muted">
                          <th class="py-1 pr-3 font-medium">Œil</th>
                          <th class="py-1 pr-3 font-medium">Sphère</th>
                          <th class="py-1 pr-3 font-medium">Cylindre</th>
                          <th class="py-1 pr-3 font-medium">Axe</th>
                          <th class="py-1 pr-3 font-medium">Add.</th>
                          <th class="py-1 pr-3 font-medium">DP</th>
                          <th class="py-1 font-medium">Hauteur</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr
                          v-for="row in prescriptionEyeDisplayRows(rx)"
                          :key="row.eye"
                          class="border-b border-line/60 last:border-b-0"
                        >
                          <td class="py-1 pr-3 font-semibold text-ink">{{ row.eye }}</td>
                          <td class="py-1 pr-3 tabular-nums">{{ row.sphere }}</td>
                          <td class="py-1 pr-3 tabular-nums">{{ row.cylinder }}</td>
                          <td class="py-1 pr-3 tabular-nums">{{ row.axis }}</td>
                          <td class="py-1 pr-3 tabular-nums">{{ row.addition }}</td>
                          <td class="py-1 pr-3 tabular-nums">{{ row.pd }}</td>
                          <td class="py-1 tabular-nums">{{ row.fittingHeight }}</td>
                        </tr>
                      </tbody>
                    </table>
                  </span>
                </span>
              </span>
            </label>
          </div>
        </fieldset>
      </SectionCard>

      <SectionCard
        title="3. Laboratoire, monture et paramètres de montage"
        title-id="titre-etape-labo"
      >
        <StateMessage
          v-if="supplierOptions.length === 0"
          state="error"
          title="Aucun laboratoire optique actif"
        >
          Créez ou activez d’abord un fournisseur de type laboratoire optique dans la rubrique Stock
          &rsaquo; Fournisseurs.
        </StateMessage>

        <div class="grid gap-4 sm:grid-cols-2">
          <SelectField
            v-model="supplierId"
            :control-id="FIELD_IDS.supplier_id"
            label="Laboratoire optique"
            placeholder="Choisir un laboratoire…"
            required
            :options="supplierOptions"
            :error="errors.supplier_id ?? null"
            @update:model-value="clearError('supplier_id')"
          />

          <TextField
            v-model="lensType"
            :control-id="FIELD_IDS.lens_type"
            label="Type de verre sur le bon laboratoire"
            required
            :maxlength="100"
            :error="errors.lens_type ?? null"
            placeholder="Ex. Progressif organique 1.67"
            @update:model-value="clearError('lens_type')"
          />

          <DecimalField
            ref="quantityRef"
            v-model="quantity"
            :control-id="FIELD_IDS.quantity"
            label="Quantité à commander"
            kind="quantity"
            field="quantity"
            required
            :hint="
              selectedLine
                ? `Reliquat maximal : ${formatQuantity(selectedLine.remaining_quantity)}`
                : undefined
            "
            :error="errors.quantity ?? null"
            @update:model-value="clearError('quantity')"
          />

          <DateField
            ref="expectedDateRef"
            v-model="expectedDate"
            :control-id="FIELD_IDS.expected_at"
            label="Échéance prévue au cabinet (JJ/MM/AAAA)"
            field="expected_at"
            :error="errors.expected_at ?? null"
            @update:model-value="clearError('expected_at')"
          />

          <SelectField
            v-model="frameItemId"
            :control-id="FIELD_IDS.frame_item_id"
            label="Monture du catalogue (optionnel)"
            placeholder="Aucune ou monture personnelle du patient"
            :options="frameOptions"
            :error="errors.frame_item_id ?? null"
            @update:model-value="clearError('frame_item_id')"
          />

          <TextField
            v-model="frameReferenceSnapshot"
            :control-id="FIELD_IDS.frame_reference_snapshot"
            label="Référence monture libre (optionnel)"
            :maxlength="100"
            :error="errors.frame_reference_snapshot ?? null"
            placeholder="Ex. Monture client Titane 52-18"
            @update:model-value="clearError('frame_reference_snapshot')"
          />

          <MeasureField
            v-model="pdOd"
            :control-id="FIELD_IDS.pd_od"
            label="Écart pupillaire OD (mm, optionnel)"
            inputmode="decimal"
            :error="errors.pd_od ?? null"
            :hint="
              selectedPrescription?.pd_od
                ? `Ordonnance : ${selectedPrescription.pd_od} mm`
                : undefined
            "
            @update:model-value="clearError('pd_od')"
          />

          <MeasureField
            v-model="pdOg"
            :control-id="FIELD_IDS.pd_og"
            label="Écart pupillaire OG (mm, optionnel)"
            inputmode="decimal"
            :error="errors.pd_og ?? null"
            :hint="
              selectedPrescription?.pd_og
                ? `Ordonnance : ${selectedPrescription.pd_og} mm`
                : undefined
            "
            @update:model-value="clearError('pd_og')"
          />

          <MeasureField
            v-model="fittingHeightOd"
            :control-id="FIELD_IDS.fitting_height_od"
            label="Hauteur de montage OD (mm, optionnel)"
            inputmode="decimal"
            :error="errors.fitting_height_od ?? null"
            @update:model-value="clearError('fitting_height_od')"
          />

          <MeasureField
            v-model="fittingHeightOg"
            :control-id="FIELD_IDS.fitting_height_og"
            label="Hauteur de montage OG (mm, optionnel)"
            inputmode="decimal"
            :error="errors.fitting_height_og ?? null"
            @update:model-value="clearError('fitting_height_og')"
          />

          <TextField
            v-model="labReference"
            :control-id="FIELD_IDS.lab_reference"
            label="Référence dossier laboratoire (optionnel)"
            :maxlength="100"
            :error="errors.lab_reference ?? null"
            placeholder="Ex. LAB-88412"
            @update:model-value="clearError('lab_reference')"
          />
        </div>

        <div class="mt-4">
          <TextAreaField
            v-model="notes"
            :control-id="FIELD_IDS.notes"
            label="Instructions techniques pour le laboratoire (optionnel)"
            :rows="3"
            :error="errors.notes ?? null"
          />
        </div>
      </SectionCard>

      <div class="flex flex-wrap items-center gap-3">
        <AppButton
          type="submit"
          variant="primary"
          :pending="saving"
          pending-label="Création en cours…"
        >
          Créer la commande atelier
        </AppButton>
        <LinkButton :to="{ name: 'workshop' }" variant="ghost">Annuler</LinkButton>
      </div>
    </form>

    <FreshnessNote
      v-if="eligibleRead.freshness.value"
      :freshness="eligibleRead.freshness.value"
      :time-zone="timeZone"
    />
  </section>
</template>
