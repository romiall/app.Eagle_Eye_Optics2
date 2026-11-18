<script setup lang="ts">
/**
 * Réception fournisseur (L1D01, EE026, EE027, AT30), module « stock », EN LIGNE, droit `stock.receive`. Trois temps :
 *
 *  1. BROUILLON : fournisseur, emplacement, référence de livraison (unique par fournisseur), date, lignes (article,
 *     quantité, coût unitaire connu ou laissé vide = INCONNU, jamais 0). Un brouillon ne touche JAMAIS au stock.
 *  2. VALIDATION : chaque ligne confirme son lot (numéro et expiration, obligatoires pour un article périssable) et son
 *     coût final ; mot de passe confirmé récemment (423) puis reprise sans doublon. Le serveur écrit alors lots et
 *     mouvements d'entrée dans une transaction.
 *  3. VALIDÉE : lecture seule, définitive (une erreur se corrige par un ajustement approuvé).
 *
 * Un brouillon jamais validé se supprime (la référence de livraison est alors libérée). Le serveur rejuge tout (lots
 * connus, quarantaine, expiration) : ses refus s'affichent par ligne. Données de démonstration FICTIVES seulement.
 */
import { computed, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { clinicTimeZone, clinicToday, formatInstantFr } from '@/app/clinicTime'
import { listStockLocations } from '@/app/services/billing'
import type { MutationOutcome } from '@/app/services/mutations'
import { getGoodsReceipt, listSuppliers } from '@/app/services/purchasing'
import { revalidateSession } from '@/app/session'
import { useUnsavedChangesGuard } from '@/app/unsavedChanges'
import ConfirmDialog from '@/components/feedback/ConfirmDialog.vue'
import ErrorSummary, { type FieldErrorItem } from '@/components/feedback/ErrorSummary.vue'
import StateMessage from '@/components/feedback/StateMessage.vue'
import DateField from '@/components/form/DateField.vue'
import MoneyField from '@/components/form/MoneyField.vue'
import SelectField from '@/components/form/SelectField.vue'
import TextAreaField from '@/components/form/TextAreaField.vue'
import TextField from '@/components/form/TextField.vue'
import PasswordConfirmDialog from '@/components/session/PasswordConfirmDialog.vue'
import AppButton from '@/components/ui/AppButton.vue'
import LinkButton from '@/components/ui/LinkButton.vue'
import type {
  GoodsReceipt,
  GoodsReceiptResponse,
  StockLocation,
  Supplier,
} from '@/domain/contracts/generated'
import {
  BATCH_NUMBER_MAX,
  buildReceiptDraftRequest,
  buildValidateRequest,
  type ConfirmLineField,
  type ConfirmLineForm,
  confirmationFormOf,
  DELIVERY_REFERENCE_MAX,
  emptyReceiptErrors,
  emptyReceiptForm,
  hasReceiptErrors,
  mapReceiptServerErrors,
  RECEIPT_NOTES_MAX,
  RECEIPT_STATUS_LABELS,
  type ReceiptErrors,
  type ReceiptForm,
  receiptFormOf,
  validateConfirmation,
  validateReceiptDraft,
} from '@/domain/inventory/purchasing'
import { currentInstant } from '@/domain/patients/visits'
import { formatMoney } from '@/domain/values/money'
import { newUlid } from '@/domain/values/ulid'
import { setSalesFlash, takeSalesFlash } from '@/pages/sales/flash'
import { quantityLabel } from '@/pages/sales/format'
import SalesReadMessage from '@/pages/sales/SalesReadMessage.vue'
import { useStockCommand } from '@/pages/stock/useStockCommand'
import { useServerRead } from '@/pages/today/useServerRead'

import CommandFailure from './CommandFailure.vue'
import { useCatalogItems } from './useCatalogItems'

const route = useRoute()
const router = useRouter()
const id = computed(() => {
  const raw = route.params['id']
  return typeof raw === 'string' ? raw : null
})
const timeZone = clinicTimeZone()
const today = clinicToday().toString()

const flash = shallowRef<string | null>(takeSalesFlash())
const notice = ref<string | null>(flash.value)

const supplierRead = useServerRead<Supplier[]>(() => listSuppliers(true))
const locationRead = useServerRead<StockLocation[]>(listStockLocations)
const catalog = useCatalogItems()
const receiptRead = useServerRead<GoodsReceipt>(() => getGoodsReceipt(id.value ?? ''), {
  lazy: id.value === null,
})
if (id.value !== null) void receiptRead.reload()

const command = useStockCommand('')
const { mutation } = command
const saving = computed(() => mutation.state.value === 'saving')

const receipt = shallowRef<GoodsReceipt | null>(null)
// Une nouvelle réception part de la date du jour ; l'unique emplacement du cabinet est préchoisi (jamais deviné s'il y en a plusieurs).
const form = ref<ReceiptForm>({
  ...emptyReceiptForm(),
  receivedOn: id.value === null ? today : null,
})
const snapshot = ref(JSON.stringify(form.value))
const errors = ref<ReceiptErrors>(emptyReceiptErrors())
const mode = ref<'edit' | 'confirm'>('edit')
const confirmLines = ref<ConfirmLineForm[]>([])
const confirmErrors = ref<Record<number, Partial<Record<ConfirmLineField, string>>>>({})
const confirmGeneral = ref<string | null>(null)
const summaryBox = ref<{ focus: () => Promise<void> } | null>(null)
const askingDelete = ref(false)

const isNew = computed(() => id.value === null)
const status = computed(() => receipt.value?.status ?? null)
const editable = computed(() => isNew.value || status.value === 'DRAFT')
const dirty = computed(() => editable.value && JSON.stringify(form.value) !== snapshot.value)
useUnsavedChangesGuard(dirty)

function load(next: GoodsReceipt): void {
  receipt.value = next
  form.value = receiptFormOf(next, timeZone, newUlid)
  snapshot.value = JSON.stringify(form.value)
  mode.value = 'edit'
}

watch(
  () => receiptRead.data.value,
  (data) => {
    if (data !== null && data.id === id.value) load(data)
  },
  { immediate: true },
)

watch(id, (next, prev) => {
  if (next === prev) return
  notice.value = takeSalesFlash()
  errors.value = emptyReceiptErrors()
  confirmLines.value = []
  confirmErrors.value = {}
  confirmGeneral.value = null
  askingDelete.value = false
  mode.value = 'edit'
  if (next !== null) {
    receipt.value = null
    void receiptRead.reload()
    return
  }
  receipt.value = null
  const onlyLocation =
    locationOptions.value.length === 1 ? (locationOptions.value[0]?.value ?? null) : null
  form.value = { ...emptyReceiptForm(), receivedOn: today, locationId: onlyLocation }
  snapshot.value = JSON.stringify(form.value)
})

const supplierOptions = computed(() => {
  const options = (supplierRead.data.value ?? []).map((supplier) => ({
    value: supplier.id,
    label: supplier.name,
  }))
  const current = receipt.value
  if (current !== null && !options.some((option) => option.value === current.supplier_id)) {
    options.push({ value: current.supplier_id, label: `${current.supplier_name} (désactivé)` })
  }
  return options
})
const locationOptions = computed(() =>
  (locationRead.data.value ?? []).map((location) => ({
    value: location.id,
    label: `${location.name} (${location.code})`,
  })),
)
watch(
  locationOptions,
  (options) => {
    const pristine = JSON.stringify(form.value) === snapshot.value
    const only = options.length === 1 ? (options[0]?.value ?? null) : null
    if (isNew.value && form.value.locationId === null && only !== null) {
      form.value = { ...form.value, locationId: only }
      if (pristine) snapshot.value = JSON.stringify(form.value)
    }
  },
  { immediate: true },
)
const itemOptions = computed(() => {
  const options = catalog.stocked.value.map((item) => ({
    value: item.id,
    label: `${item.name} (${item.reference})`,
  }))
  for (const line of form.value.lines) {
    if (line.itemId !== null && !options.some((option) => option.value === line.itemId)) {
      options.push({ value: line.itemId, label: catalog.name(line.itemId) })
    }
  }
  return options
})

const HEADER_IDS = {
  supplierId: 'reception-fournisseur',
  locationId: 'reception-emplacement',
  supplierReference: 'reception-reference',
  receivedOn: 'reception-date',
  notes: 'reception-notes',
} as const

function lineFieldId(key: string, field: 'itemId' | 'quantity' | 'unitCost'): string {
  const suffix = { itemId: 'article', quantity: 'quantite', unitCost: 'cout' }[field]
  return `reception-${key}-${suffix}`
}

function confirmFieldId(position: number, field: ConfirmLineField): string {
  const suffix = { batchNumber: 'lot', expiresOn: 'expiration', unitCost: 'cout' }[field]
  return `confirmation-${position}-${suffix}`
}

const summary = computed<FieldErrorItem[]>(() => {
  const items: FieldErrorItem[] = []
  if (errors.value.general !== null) {
    items.push({ fieldId: HEADER_IDS.supplierId, message: errors.value.general })
  }
  for (const [field, message] of Object.entries(errors.value.header)) {
    items.push({ fieldId: HEADER_IDS[field as keyof typeof HEADER_IDS], message })
  }
  form.value.lines.forEach((line, index) => {
    for (const [field, message] of Object.entries(errors.value.lines[line.key] ?? {})) {
      items.push({
        fieldId: lineFieldId(line.key, field as 'itemId' | 'quantity' | 'unitCost'),
        message: `Ligne ${index + 1} : ${message}`,
      })
    }
  })
  return items
})

const confirmSummary = computed<FieldErrorItem[]>(() => {
  const items: FieldErrorItem[] = []
  if (confirmGeneral.value !== null) {
    items.push({
      fieldId: confirmFieldId(confirmLines.value[0]?.position ?? 1, 'batchNumber'),
      message: confirmGeneral.value,
    })
  }
  for (const line of confirmLines.value) {
    for (const [field, message] of Object.entries(confirmErrors.value[line.position] ?? {})) {
      items.push({
        fieldId: confirmFieldId(line.position, field as ConfirmLineField),
        message: `Ligne ${line.position} : ${message}`,
      })
    }
  }
  return items
})

// --- Lignes ---------------------------------------------------------------------------------------------------

function addLine(): void {
  form.value = {
    ...form.value,
    lines: [...form.value.lines, { key: newUlid(), itemId: null, quantity: null, unitCost: null }],
  }
}

function updateLine(
  index: number,
  patch: Partial<{ itemId: string | null; quantity: string | null; unitCost: number | null }>,
): void {
  const lines = [...form.value.lines]
  const line = lines[index]
  if (line === undefined) return
  lines[index] = { ...line, ...patch }
  form.value = { ...form.value, lines }
  if (errors.value.lines[line.key] !== undefined) {
    const rest = { ...errors.value.lines }
    delete rest[line.key]
    errors.value = { ...errors.value, lines: rest }
  }
}

function removeLine(index: number): void {
  form.value = {
    ...form.value,
    lines: form.value.lines.filter((_line, position) => position !== index),
  }
}

// --- Brouillon ------------------------------------------------------------------------------------------------

function showServerErrors(): void {
  const mapped = mapReceiptServerErrors(command.fields.value)
  const lines: ReceiptErrors['lines'] = {}
  for (const [index, fields] of Object.entries(mapped.lines)) {
    const line = form.value.lines[Number(index)]
    if (line !== undefined) lines[line.key] = fields
  }
  const noField = Object.keys(mapped.header).length === 0 && Object.keys(lines).length === 0
  errors.value = {
    header: mapped.header,
    lines,
    general: mapped.general ?? (noField ? command.message.value : null),
  }
}

async function afterSave(outcome: MutationOutcome): Promise<void> {
  switch (outcome.kind) {
    case 'synced': {
      const saved = (outcome.result as GoodsReceiptResponse).data
      mutation.reset()
      load(saved)
      errors.value = emptyReceiptErrors()
      if (isNew.value) {
        setSalesFlash('Brouillon de réception enregistré : le stock n’a pas bougé.')
        await router.replace({ name: 'goods-receipt', params: { id: saved.id } })
        return
      }
      notice.value = 'Brouillon enregistré : le stock n’a pas bougé.'
      return
    }
    case 'refused':
    case 'conflict':
      showServerErrors()
      await summaryBox.value?.focus()
      return
    case 'session-expired':
      void revalidateSession().catch(() => undefined)
      return
    default:
      return
  }
}

async function saveDraft(): Promise<void> {
  if (saving.value) return
  notice.value = null
  errors.value = validateReceiptDraft({ form: form.value, items: catalog.items.value, today })
  if (hasReceiptErrors(errors.value)) {
    await summaryBox.value?.focus()
    return
  }
  const body = buildReceiptDraftRequest({ form: form.value, today, nowInstant: currentInstant() })
  await afterSave(
    await command.send({
      name: 'SaveGoodsReceiptDraft',
      route:
        id.value === null
          ? { method: 'POST', path: '/goods-receipts' }
          : { method: 'PATCH', path: `/goods-receipts/${encodeURIComponent(id.value)}` },
      payload: body,
    }),
  )
}

// --- Validation -----------------------------------------------------------------------------------------------

function openConfirmation(): void {
  const current = receipt.value
  if (current === null || dirty.value) return
  notice.value = null
  mutation.reset()
  confirmLines.value = confirmationFormOf(current)
  confirmErrors.value = {}
  confirmGeneral.value = null
  mode.value = 'confirm'
}

function updateConfirm(position: number, patch: Partial<ConfirmLineForm>): void {
  confirmLines.value = confirmLines.value.map((line) =>
    line.position === position ? { ...line, ...patch } : line,
  )
  if (confirmErrors.value[position] !== undefined) {
    const rest = { ...confirmErrors.value }
    delete rest[position]
    confirmErrors.value = rest
  }
}

function showConfirmServerErrors(): void {
  const mapped = mapReceiptServerErrors(command.fields.value)
  const byPosition: Record<number, Partial<Record<ConfirmLineField, string>>> = {}
  for (const [index, fields] of Object.entries(mapped.lines)) {
    const line = confirmLines.value[Number(index)]
    if (line === undefined) continue
    byPosition[line.position] = {
      ...(fields.batchNumber === undefined ? {} : { batchNumber: fields.batchNumber }),
      ...(fields.expiresOn === undefined ? {} : { expiresOn: fields.expiresOn }),
      ...(fields.unitCost === undefined ? {} : { unitCost: fields.unitCost }),
    }
  }
  confirmErrors.value = byPosition
  const headerMessages = Object.values(mapped.header)
  const others = [...headerMessages, ...(mapped.general === null ? [] : [mapped.general])]
  confirmGeneral.value =
    others.length > 0
      ? others.join(' ')
      : Object.keys(byPosition).length === 0
        ? command.message.value
        : null
}

async function afterValidate(outcome: MutationOutcome): Promise<void> {
  switch (outcome.kind) {
    case 'synced': {
      const validated = (outcome.result as GoodsReceiptResponse).data
      mutation.reset()
      load(validated)
      notice.value = `Réception validée : ${validated.line_count} ligne${validated.line_count > 1 ? 's' : ''} entrée${validated.line_count > 1 ? 's' : ''} en stock.`
      return
    }
    case 'reauthentication-required':
      return
    case 'refused':
    case 'conflict':
      showConfirmServerErrors()
      await summaryBox.value?.focus()
      return
    case 'session-expired':
      void revalidateSession().catch(() => undefined)
      return
    default:
      return
  }
}

async function validate(): Promise<void> {
  const current = receipt.value
  if (saving.value || current === null || id.value === null) return
  confirmGeneral.value = null
  confirmErrors.value = validateConfirmation({
    lines: confirmLines.value,
    receipt: current,
    items: catalog.items.value,
    receivedOn: form.value.receivedOn ?? today,
  })
  if (Object.keys(confirmErrors.value).length > 0) return
  await afterValidate(
    await command.send({
      name: 'ValidateGoodsReceipt',
      route: { method: 'POST', path: `/goods-receipts/${encodeURIComponent(id.value)}/validate` },
      payload: buildValidateRequest(confirmLines.value),
    }),
  )
}

async function onPasswordConfirmed(): Promise<void> {
  await afterValidate(await command.passwordConfirmed())
}

async function retry(): Promise<void> {
  if (saving.value) return
  const outcome = await command.retry()
  if (mode.value === 'confirm') await afterValidate(outcome)
  else await afterSave(outcome)
}

// --- Suppression du brouillon ---------------------------------------------------------------------------------

async function deleteDraft(): Promise<void> {
  if (saving.value || id.value === null) return
  const outcome = await command.send({
    name: 'DeleteGoodsReceiptDraft',
    route: { method: 'POST', path: `/goods-receipts/${encodeURIComponent(id.value)}/delete` },
    payload: {},
  })
  askingDelete.value = false
  if (outcome.kind === 'synced') {
    mutation.reset()
    snapshot.value = JSON.stringify(form.value)
    setSalesFlash('Brouillon de réception supprimé.')
    await router.replace({ name: 'goods-receipts' })
    return
  }
  if (outcome.kind === 'session-expired') void revalidateSession().catch(() => undefined)
}

function lotLabel(line: GoodsReceipt['lines'][number]): string {
  if (line.lot === null) return 'sans lot'
  const expiry =
    line.lot.expires_on === null
      ? ''
      : `, expire le ${line.lot.expires_on.split('-').reverse().join('/')}`
  return `lot ${line.lot.batch_number}${expiry}`
}
</script>

<template>
  <section aria-labelledby="titre-reception" class="max-w-3xl space-y-6">
    <h1 id="titre-reception" class="text-2xl font-semibold tracking-tight">
      {{
        isNew
          ? 'Nouvelle réception'
          : receipt
            ? `Réception ${receipt.supplier_reference}`
            : 'Réception fournisseur'
      }}
    </h1>
    <div class="flex flex-wrap gap-3">
      <LinkButton :to="{ name: 'goods-receipts' }" variant="ghost"
        >Retour aux réceptions</LinkButton
      >
    </div>

    <StateMessage v-if="notice" state="success" :title="notice" />

    <SalesReadMessage
      v-if="!isNew && receiptRead.state.value !== 'ready'"
      :state="receiptRead.state.value"
      subject="la réception"
      :error="receiptRead.error.value"
      not-found-title="Réception introuvable"
      @retry="receiptRead.reload()"
    />

    <!-- Réception validée : lecture seule, définitive. -->
    <section
      v-else-if="receipt && status === 'VALIDATED'"
      aria-labelledby="titre-reception-validee"
      class="space-y-4"
    >
      <h2 id="titre-reception-validee" class="text-lg font-semibold">
        {{ RECEIPT_STATUS_LABELS[receipt.status] }} le
        {{ receipt.validated_at ? formatInstantFr(receipt.validated_at) : '' }}
      </h2>
      <p class="text-base">
        {{ receipt.supplier_name }} · livraison {{ receipt.supplier_reference }} ·
        {{ receipt.location_name }} · reçue le {{ formatInstantFr(receipt.received_at) }}
      </p>
      <p v-if="receipt.notes" class="text-base break-words">{{ receipt.notes }}</p>
      <ul class="space-y-2">
        <li
          v-for="line in receipt.lines"
          :key="line.position"
          class="space-y-1 rounded-xl border border-line bg-surface shadow-card p-3"
        >
          <p class="font-semibold break-words">
            {{ line.item_name }} ({{ line.item_reference }}) · {{ quantityLabel(line.quantity) }}
          </p>
          <p class="text-sm text-muted break-words">
            {{ lotLabel(line) }} ·
            {{
              line.unit_cost === null ? 'coût inconnu' : `${formatMoney(line.unit_cost)} l’unité`
            }}
          </p>
        </li>
      </ul>
      <p class="text-base">
        Valeur au coût connu : <strong>{{ formatMoney(receipt.known_cost_total) }}</strong>
        <template v-if="receipt.unknown_cost_lines > 0">
          · {{ receipt.unknown_cost_lines }} ligne{{ receipt.unknown_cost_lines > 1 ? 's' : '' }} à
          coût inconnu, non valorisée{{ receipt.unknown_cost_lines > 1 ? 's' : '' }}
        </template>
      </p>
      <p class="text-sm text-muted">
        Cette réception est définitive. Une erreur se corrige par un ajustement approuvé de la
        gérante (Stock, Casse ou ajustement).
      </p>
    </section>

    <!-- Confirmation des lots et des coûts, puis validation. -->
    <section
      v-else-if="mode === 'confirm' && receipt"
      aria-labelledby="titre-validation"
      class="space-y-4"
    >
      <h2 id="titre-validation" class="text-lg font-semibold">Valider la réception</h2>
      <p class="max-w-prose text-base text-muted">
        Confirmez le lot et le coût de chaque ligne. Un article périssable exige un numéro de lot et
        une date d’expiration. Le coût inconnu reste vide (jamais 0). Le stock augmente à la
        validation, et la réception devient définitive.
      </p>
      <ErrorSummary ref="summaryBox" :errors="confirmSummary" />
      <CommandFailure
        :state="mutation.state.value"
        :message="null"
        :failure-message="mutation.failureMessage.value"
        :saving="saving"
        @retry="retry"
      />
      <StateMessage
        v-if="mutation.state.value === 'reauthentication-required' && !command.askingPassword.value"
        state="error"
        title="Confirmation du mot de passe demandée"
      >
        Rien n’a été enregistré : confirmez votre mot de passe pour reprendre.
        <template #action>
          <AppButton variant="secondary" @click="command.askingPassword.value = true"
            >Confirmer mon mot de passe</AppButton
          >
        </template>
      </StateMessage>
      <ul class="space-y-3">
        <li
          v-for="line in confirmLines"
          :key="line.position"
          class="space-y-3 rounded-xl border border-line bg-surface shadow-card p-3"
        >
          <p class="text-base font-semibold break-words">
            Ligne {{ line.position }} :
            {{ receipt.lines.find((entry) => entry.position === line.position)?.item_name }}
            ·
            {{
              quantityLabel(
                receipt.lines.find((entry) => entry.position === line.position)?.quantity ?? '0',
              )
            }}
          </p>
          <div class="grid gap-3 sm:grid-cols-2">
            <TextField
              :model-value="line.batchNumber"
              label="Numéro de lot"
              :maxlength="BATCH_NUMBER_MAX"
              :control-id="confirmFieldId(line.position, 'batchNumber')"
              :error="confirmErrors[line.position]?.batchNumber ?? null"
              :disabled="saving"
              @update:model-value="updateConfirm(line.position, { batchNumber: $event })"
            />
            <DateField
              :model-value="line.expiresOn"
              label="Date d’expiration"
              :control-id="confirmFieldId(line.position, 'expiresOn')"
              :error="confirmErrors[line.position]?.expiresOn ?? null"
              :disabled="saving"
              @update:model-value="updateConfirm(line.position, { expiresOn: $event })"
            />
            <MoneyField
              :model-value="line.unitCost"
              label="Coût d’achat unitaire (FCFA)"
              field="unit_cost"
              hint="Inconnu : laisser vide (jamais 0)."
              :control-id="confirmFieldId(line.position, 'unitCost')"
              :error="confirmErrors[line.position]?.unitCost ?? null"
              :disabled="saving"
              @update:model-value="updateConfirm(line.position, { unitCost: $event })"
            />
          </div>
        </li>
      </ul>
      <p class="text-sm text-muted">
        Opération sensible : votre mot de passe peut vous être demandé avant la validation.
      </p>
      <div class="flex flex-wrap gap-3">
        <AppButton :pending="saving" pending-label="Validation en cours…" @click="validate"
          >Valider la réception</AppButton
        >
        <AppButton variant="ghost" :disabled="saving" @click="mode = 'edit'"
          >Retour au brouillon</AppButton
        >
      </div>
    </section>

    <!-- Brouillon : en-tête et lignes. -->
    <form
      v-else-if="editable && (isNew || receipt)"
      novalidate
      aria-labelledby="titre-reception"
      class="space-y-5"
      @submit.prevent="saveDraft"
    >
      <p class="max-w-prose text-base text-muted">
        Un brouillon ne touche jamais au stock : le lot et le coût final se confirment à la
        validation.
      </p>
      <ErrorSummary ref="summaryBox" :errors="summary" />
      <CommandFailure
        :state="mutation.state.value"
        :message="null"
        :failure-message="mutation.failureMessage.value"
        :saving="saving"
        @retry="retry"
      />
      <StateMessage
        v-if="!supplierOptions.length && supplierRead.state.value === 'ready'"
        state="empty"
        title="Aucun fournisseur actif"
      >
        Créez d’abord un fournisseur (page « Fournisseurs ») pour enregistrer une réception.
        <template #action>
          <LinkButton :to="{ name: 'suppliers' }" variant="secondary">
            Ouvrir les fournisseurs
          </LinkButton>
        </template>
      </StateMessage>

      <div class="grid gap-3 sm:grid-cols-2">
        <SelectField
          v-model="form.supplierId"
          label="Fournisseur"
          :options="supplierOptions"
          placeholder="Choisir le fournisseur"
          :control-id="HEADER_IDS.supplierId"
          :error="errors.header.supplierId ?? null"
          :disabled="saving"
          required
        />
        <SelectField
          v-model="form.locationId"
          label="Emplacement de réception"
          :options="locationOptions"
          placeholder="Choisir l’emplacement"
          :control-id="HEADER_IDS.locationId"
          :error="errors.header.locationId ?? null"
          :disabled="saving"
          required
        />
        <TextField
          v-model="form.supplierReference"
          label="Référence de livraison"
          hint="Numéro du bon de livraison ou de la facture du fournisseur."
          :maxlength="DELIVERY_REFERENCE_MAX"
          :control-id="HEADER_IDS.supplierReference"
          :error="errors.header.supplierReference ?? null"
          :disabled="saving"
          required
        />
        <DateField
          v-model="form.receivedOn"
          label="Date de réception"
          :control-id="HEADER_IDS.receivedOn"
          :error="errors.header.receivedOn ?? null"
          :disabled="saving"
          required
        />
      </div>
      <TextAreaField
        v-model="form.notes"
        label="Remarques (facultatif)"
        :maxlength="RECEIPT_NOTES_MAX"
        :control-id="HEADER_IDS.notes"
        :error="errors.header.notes ?? null"
        :disabled="saving"
      />

      <h2 class="text-lg font-semibold">Lignes reçues</h2>
      <ul v-if="form.lines.length > 0" class="space-y-3">
        <li
          v-for="(line, index) in form.lines"
          :key="line.key"
          class="space-y-3 rounded-xl border border-line bg-surface shadow-card p-3"
        >
          <div class="flex flex-wrap items-start justify-between gap-2">
            <h3 class="text-base font-semibold">Ligne {{ index + 1 }}</h3>
            <AppButton
              variant="ghost"
              :disabled="saving"
              :accessible-name="`Retirer la ligne ${index + 1}`"
              @click="removeLine(index)"
              >Retirer la ligne</AppButton
            >
          </div>
          <div class="grid gap-3 sm:grid-cols-2">
            <SelectField
              :model-value="line.itemId"
              label="Article géré en stock"
              :options="itemOptions"
              placeholder="Choisir l’article"
              :control-id="lineFieldId(line.key, 'itemId')"
              :error="errors.lines[line.key]?.itemId ?? null"
              :disabled="saving || catalog.read.state.value === 'loading'"
              required
              @update:model-value="updateLine(index, { itemId: $event })"
            />
            <TextField
              :model-value="line.quantity ?? ''"
              label="Quantité reçue"
              inputmode="decimal"
              :control-id="lineFieldId(line.key, 'quantity')"
              :error="errors.lines[line.key]?.quantity ?? null"
              :disabled="saving"
              required
              @update:model-value="
                updateLine(index, { quantity: $event === '' ? null : $event.replace(',', '.') })
              "
            />
            <MoneyField
              :model-value="line.unitCost"
              label="Coût d’achat unitaire (facultatif)"
              field="unit_cost"
              hint="Inconnu : laisser vide (jamais 0)."
              :control-id="lineFieldId(line.key, 'unitCost')"
              :error="errors.lines[line.key]?.unitCost ?? null"
              :disabled="saving"
              @update:model-value="updateLine(index, { unitCost: $event })"
            />
          </div>
        </li>
      </ul>
      <AppButton variant="secondary" :disabled="saving" @click="addLine"
        >Ajouter une ligne</AppButton
      >

      <div class="flex flex-wrap gap-3">
        <AppButton type="submit" :pending="saving" pending-label="Enregistrement en cours…"
          >Enregistrer le brouillon</AppButton
        >
        <AppButton
          v-if="!isNew"
          variant="secondary"
          :disabled="saving || dirty"
          @click="openConfirmation"
          >Passer à la validation</AppButton
        >
        <AppButton v-if="!isNew" variant="danger" :disabled="saving" @click="askingDelete = true"
          >Supprimer le brouillon</AppButton
        >
      </div>
      <p v-if="!isNew && dirty" class="text-sm text-muted">
        Enregistrez d’abord vos modifications pour passer à la validation.
      </p>
    </form>

    <ConfirmDialog
      :open="askingDelete"
      title="Supprimer ce brouillon ?"
      confirm-label="Supprimer le brouillon"
      pending-label="Suppression en cours…"
      tone="danger"
      :pending="saving"
      @confirm="deleteDraft"
      @cancel="askingDelete = false"
    >
      <p>
        Le brouillon n’a jamais touché au stock : rien d’autre n’est modifié. Sa référence de
        livraison redevient libre.
      </p>
    </ConfirmDialog>
    <PasswordConfirmDialog
      :open="command.askingPassword.value"
      action="La validation d’une réception"
      @confirmed="onPasswordConfirmed"
      @cancel="command.askingPassword.value = false"
    />
  </section>
</template>
