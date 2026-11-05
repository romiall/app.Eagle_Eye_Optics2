<script setup lang="ts">
/**
 * Stock (I00), module « stock », EN LIGNE : disponibilités par article et emplacement (physique,
 * réservé, quotas locaux, disponible central ; aucun coût ni valeur), puis saisie du stock initial par
 * la gérante. Un mouvement `OPENING` par ligne, lots créés au besoin, approbation directe de la gérante
 * (aucune approbation à distance avant B06) ; un article périssable exige un lot daté ; un coût d'achat
 * inconnu reste vide, jamais 0 ; le stock initial d'un article dans un emplacement ne s'enregistre
 * qu'une fois. Écriture sensible : mot de passe confirmé récemment (423), puis reprise sans doublon.
 *
 * Emplacements : liste des emplacements actifs du cabinet lue sur le serveur (`GET /stock/locations`,
 * `PRINCIPAL` créé par l'exploitant). Sans aucun emplacement lu, la saisie est indisponible et l'écran le
 * dit (jamais un emplacement deviné).
 */
import { computed, ref } from 'vue'

import { clinicTimeZone } from '@/app/clinicTime'
import { getStockAvailability, listStockLocations, searchCatalog } from '@/app/services/billing'
import type { MutationOutcome } from '@/app/services/mutations'
import type { ReadOutcome } from '@/app/services/reads'
import { useMutation } from '@/app/services/useMutation'
import { canOnScreen, revalidateSession } from '@/app/session'
import { useUnsavedChangesGuard } from '@/app/unsavedChanges'
import ErrorSummary, { type FieldErrorItem } from '@/components/feedback/ErrorSummary.vue'
import FreshnessNote from '@/components/feedback/FreshnessNote.vue'
import StateMessage from '@/components/feedback/StateMessage.vue'
import DateField from '@/components/form/DateField.vue'
import DecimalField from '@/components/form/DecimalField.vue'
import MoneyField from '@/components/form/MoneyField.vue'
import SelectField from '@/components/form/SelectField.vue'
import TextAreaField from '@/components/form/TextAreaField.vue'
import TextField from '@/components/form/TextField.vue'
import PasswordConfirmDialog from '@/components/session/PasswordConfirmDialog.vue'
import AppButton from '@/components/ui/AppButton.vue'
import LinkButton from '@/components/ui/LinkButton.vue'
import PaginationControls from '@/components/ui/PaginationControls.vue'
import type {
  CatalogItem,
  OpeningStockResponse,
  StockAvailabilityPage,
  StockLocation,
} from '@/domain/contracts/generated'
import {
  buildOpeningStockPayload,
  type OpeningLineField,
  type OpeningLineForm,
  openingFieldFromServer,
  REASON_MAX_LENGTH,
  validateOpeningStock,
} from '@/domain/inventory/opening'
import type { ImportProblem } from '@/domain/billing/catalogImport'
import { openingTemplateCsv, readOpeningCsv } from '@/domain/inventory/openingImport'
import { currentInstant } from '@/domain/patients/visits'
import { newUlid } from '@/domain/values/ulid'
import { quantityLabel } from '@/pages/sales/format'
import { salesFailureView } from '@/pages/sales/failureView'
import SalesReadMessage from '@/pages/sales/SalesReadMessage.vue'
import { useServerRead } from '@/pages/today/useServerRead'

/** Pages du catalogue lues pour nommer les articles (25 par page) : au-delà, l'identifiant court. */
const CATALOG_PAGES = 4

const timeZone = clinicTimeZone()
const page = ref(1)
const read = useServerRead<StockAvailabilityPage>(
  () => getStockAvailability({ page: page.value }),
  {
    isEmpty: (result) => result.data.length === 0,
  },
)

async function loadStockedItems(): Promise<ReadOutcome<CatalogItem[]>> {
  const items: CatalogItem[] = []
  let last = 1
  let freshness: ReadOutcome<CatalogItem[]>['freshness'] = { serverAsOf: null, complete: false }
  for (let current = 1; current <= Math.min(last, CATALOG_PAGES); current += 1) {
    const result = await searchCatalog('', current)
    items.push(...result.data.data)
    last = result.data.meta.last_page
    freshness = { serverAsOf: result.freshness.serverAsOf, complete: last <= CATALOG_PAGES }
  }
  return { data: items, freshness, live: true }
}
const catalog = useServerRead<CatalogItem[]>(loadStockedItems)

const items = computed(() => new Map((catalog.data.value ?? []).map((item) => [item.id, item])))
const stockedItems = computed(() =>
  (catalog.data.value ?? []).filter((item) => item.stock_mode === 'STOCKED' && item.active),
)
const result = computed(() => read.data.value)
const canOpen = computed(() => canOnScreen('stock.adjust'))
const withCost = computed(() => canOnScreen('catalog.purchase_cost.read'))

function itemName(id: string): string {
  const item = items.value.get(id)
  return item === undefined ? `Article …${id.slice(-6)}` : `${item.name} (${item.reference})`
}

/** Emplacements actifs du cabinet, lus sur le serveur. */
const locationRead = useServerRead<StockLocation[]>(listStockLocations, {
  isEmpty: (list) => list.length === 0,
})
const locationNames = computed(
  () => new Map((locationRead.data.value ?? []).map((location) => [location.id, location])),
)
const locations = computed(() =>
  (locationRead.data.value ?? []).map((location) => ({
    value: location.id,
    label: `${location.name} (${location.code})`,
  })),
)

/** Nom d'un emplacement des disponibilités (identifiant court s'il n'est plus actif). */
function locationName(id: string): string {
  const location = locationNames.value.get(id)
  return location === undefined ? `Emplacement …${id.slice(-6)}` : location.name
}

function goToPage(next: number): void {
  page.value = next
  void read.reload()
}

// --- Stock initial --------------------------------------------------------------------------------

const mutation = useMutation()
const reason = ref('')
const lines = ref<OpeningLineForm[]>([])
const lineErrors = ref<Record<string, Partial<Record<OpeningLineField, string>>>>({})
const general = ref<string | null>(null)
const summaryBox = ref<{ focus: () => Promise<void> } | null>(null)
const notice = ref<string | null>(null)
const askingPassword = ref(false)
let countedAt: string | null = null
const fieldRefs = new Map<string, { commit: () => boolean }>()

const saving = computed(() => mutation.state.value === 'saving')
const failure = computed(() =>
  mutation.state.value === 'reauthentication-required'
    ? null
    : salesFailureView(mutation.state.value),
)
const dirty = computed(() => lines.value.length > 0 || reason.value.trim() !== '')
useUnsavedChangesGuard(dirty)

const itemOptions = computed(() =>
  stockedItems.value.map((item) => ({ value: item.id, label: `${item.name} (${item.reference})` })),
)

function setRef(key: string, element: unknown): void {
  if (element === null) fieldRefs.delete(key)
  else fieldRefs.set(key, element as { commit: () => boolean })
}

// --- Remplir le stock initial depuis un fichier CSV (X01) -------------------------------------------

const csvProblems = ref<ImportProblem[]>([])
const csvReading = ref(false)

/** Tous les articles du catalogue (pages successives) : chaque référence du fichier y est retrouvée. */
async function allCatalogItems(): Promise<CatalogItem[]> {
  const all: CatalogItem[] = []
  let last = 1
  for (let current = 1; current <= last; current += 1) {
    const result = await searchCatalog('', current)
    all.push(...result.data.data)
    last = result.data.meta.last_page
  }
  return all
}

function downloadOpeningTemplate(): void {
  const blob = new Blob([`\u{FEFF}${openingTemplateCsv()}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'modele-stock-initial.csv'
  link.click()
  URL.revokeObjectURL(url)
}

/** Le fichier remplit le formulaire (rien n'est envoyé) : la gérante relit puis enregistre comme d'habitude. */
async function fillFromCsv(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0] ?? null
  csvProblems.value = []
  if (file === null) return
  csvReading.value = true
  try {
    const parsed = readOpeningCsv(
      await file.text(),
      await allCatalogItems(),
      locationRead.data.value ?? [],
    )
    csvProblems.value = parsed.problems
    if (parsed.problems.length === 0) {
      lines.value = parsed.lines
      notice.value = `${parsed.lines.length} ligne(s) reprise(s) du fichier : vérifiez-les, indiquez le motif puis enregistrez.`
    }
  } catch {
    csvProblems.value = [
      {
        line: 1,
        column: null,
        message: 'Le fichier ou le catalogue n’a pas pu être lu : réessayez.',
      },
    ]
  } finally {
    csvReading.value = false
    input.value = ''
  }
}

function addLine(): void {
  const onlyLocation = locations.value.length === 1 ? (locations.value[0]?.value ?? null) : null
  lines.value = [
    ...lines.value,
    {
      movementId: newUlid(),
      lotId: newUlid(),
      itemId: null,
      locationId: onlyLocation,
      quantity: null,
      batchNumber: '',
      expiresOn: null,
      unitCost: null,
    },
  ]
}

function updateLine(index: number, patch: Partial<OpeningLineForm>): void {
  const next = [...lines.value]
  const line = next[index]
  if (line === undefined) return
  next[index] = { ...line, ...patch }
  lines.value = next
  if (lineErrors.value[line.movementId] !== undefined) {
    const rest = { ...lineErrors.value }
    delete rest[line.movementId]
    lineErrors.value = rest
  }
}

function removeLine(index: number): void {
  lines.value = lines.value.filter((_line, position) => position !== index)
}

function fieldId(line: OpeningLineForm, field: OpeningLineField): string {
  return `stock-${line.movementId}-${field}`
}

const summary = computed<FieldErrorItem[]>(() => {
  const items: FieldErrorItem[] = []
  if (general.value !== null) items.push({ fieldId: 'stock-motif', message: general.value })
  lines.value.forEach((line, index) => {
    for (const [field, message] of Object.entries(lineErrors.value[line.movementId] ?? {})) {
      if (message === undefined) continue
      items.push({
        fieldId: fieldId(line, field as OpeningLineField),
        message: `Ligne ${index + 1} : ${message}`,
      })
    }
  })
  return items
})

function showErrors(
  errors: readonly { index: number; field: OpeningLineField; message: string }[],
): void {
  const byLine: Record<string, Partial<Record<OpeningLineField, string>>> = {}
  for (const error of errors) {
    const line = lines.value[error.index]
    if (line === undefined) continue
    byLine[line.movementId] = { ...(byLine[line.movementId] ?? {}), [error.field]: error.message }
  }
  lineErrors.value = byLine
}

async function afterOutcome(result: MutationOutcome): Promise<void> {
  switch (result.kind) {
    case 'synced': {
      const response = result.result as OpeningStockResponse
      const count = response.data.movements.length
      notice.value = `Stock initial enregistré sur le serveur : ${count} mouvement${count > 1 ? 's' : ''}.`
      lines.value = []
      reason.value = ''
      countedAt = null
      mutation.reset()
      await read.reload()
      return
    }
    case 'reauthentication-required':
      askingPassword.value = true
      return
    case 'refused':
    case 'conflict': {
      const errors: { index: number; field: OpeningLineField; message: string }[] = []
      const others: string[] = []
      for (const [key, messages] of Object.entries(result.error.fields)) {
        const message = messages[0]
        if (message === undefined) continue
        const target = openingFieldFromServer(key)
        if (target === null) others.push(message)
        else errors.push({ ...target, message })
      }
      showErrors(errors)
      general.value =
        others.length > 0 ? others.join(' ') : errors.length === 0 ? result.error.message : null
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

async function submit(): Promise<void> {
  if (saving.value) return
  notice.value = null
  general.value = null
  lineErrors.value = {}
  const committed = [...fieldRefs.values()].map((field) => field.commit()).every(Boolean)
  const checked = validateOpeningStock({
    reason: reason.value,
    lines: lines.value,
    items: items.value,
  })
  if (
    !committed ||
    checked.errors.length > 0 ||
    checked.general !== null ||
    checked.reason === null
  ) {
    showErrors(checked.errors)
    general.value =
      checked.general ??
      (committed ? null : 'Certaines valeurs saisies sont refusées : corrigez-les.')
    await summaryBox.value?.focus()
    return
  }
  countedAt ??= currentInstant()
  await afterOutcome(
    await mutation.submit({
      name: 'RegisterOpeningStock',
      route: { method: 'POST', path: '/stock/opening', expectedVersion: 'omitted' },
      payload: buildOpeningStockPayload({ countedAt, reason: checked.reason, lines: lines.value }),
    }),
  )
}

async function retry(): Promise<void> {
  if (saving.value) return
  await afterOutcome(await mutation.retry())
}

async function onPasswordConfirmed(): Promise<void> {
  askingPassword.value = false
  await retry()
}
</script>

<template>
  <section aria-labelledby="titre-stock" class="max-w-3xl space-y-6">
    <h1 id="titre-stock" class="text-2xl font-semibold tracking-tight">Stock</h1>
    <LinkButton v-if="canOpen" :to="{ name: 'stock-movement' }" variant="secondary"
      >Casse ou ajustement</LinkButton
    >

    <StateMessage v-if="notice" state="success" :title="notice" />

    <section aria-labelledby="titre-disponibilites" class="space-y-3">
      <h2 id="titre-disponibilites" class="text-lg font-semibold">Disponibilités</h2>
      <SalesReadMessage
        v-if="read.state.value !== 'ready' && read.state.value !== 'empty'"
        :state="read.state.value"
        subject="le stock"
        :error="read.error.value"
        @retry="read.reload()"
      />
      <StateMessage
        v-else-if="read.state.value === 'empty'"
        state="empty"
        title="Aucun stock enregistré"
      >
        Le serveur n’a aucune position de stock : le stock initial n’a pas encore été saisi.
      </StateMessage>
      <template v-else-if="result !== null">
        <ul class="space-y-3">
          <li
            v-for="row in result.data"
            :key="row.stock_position_id"
            class="space-y-1 rounded-xl border border-line bg-surface shadow-card p-3"
          >
            <p class="font-semibold break-words">{{ itemName(row.item_id) }}</p>
            <p class="text-sm text-muted break-words">{{ locationName(row.location_id) }}</p>
            <dl class="grid grid-cols-2 gap-x-4 gap-y-1 text-base sm:grid-cols-4">
              <div>
                <dt class="text-sm text-muted">Physique</dt>
                <dd class="tabular-nums">{{ quantityLabel(row.on_hand) }}</dd>
              </div>
              <div>
                <dt class="text-sm text-muted">Réservé</dt>
                <dd class="tabular-nums">{{ quantityLabel(row.reserved) }}</dd>
              </div>
              <div>
                <dt class="text-sm text-muted">Quotas des postes</dt>
                <dd class="tabular-nums">{{ quantityLabel(row.offline_allocated) }}</dd>
              </div>
              <div>
                <dt class="text-sm font-semibold">Disponible</dt>
                <dd class="font-semibold tabular-nums">
                  {{ quantityLabel(row.central_available) }}
                </dd>
              </div>
            </dl>
            <ul v-if="row.lots.length > 0" class="space-y-0.5 text-sm text-muted">
              <li v-for="lot in row.lots" :key="lot.lot_id" class="break-words">
                Lot {{ lot.batch_number }}
                <template v-if="lot.expires_on">
                  · expire le {{ lot.expires_on.split('-').reverse().join('/') }}</template
                >
                · {{ quantityLabel(lot.on_hand) }} en stock
                <template v-if="lot.status === 'QUARANTINE'">
                  · en quarantaine (jamais réservé)</template
                >
              </li>
            </ul>
          </li>
        </ul>
        <PaginationControls
          :current-page="result.meta.current_page"
          :last-page="result.meta.last_page"
          :total="result.meta.total"
          label="Pagination du stock"
          unit="positions"
          @page="goToPage"
        />
        <FreshnessNote
          v-if="read.freshness.value"
          :freshness="read.freshness.value"
          :time-zone="timeZone"
        />
      </template>
    </section>

    <section v-if="canOpen" aria-labelledby="titre-stock-initial" class="space-y-4">
      <h2 id="titre-stock-initial" class="text-lg font-semibold">Stock initial</h2>
      <p class="text-base text-muted">
        Comptage validé par la gérante : un mouvement d’ouverture par ligne. Le stock initial d’un
        article dans un emplacement ne s’enregistre qu’une fois (ensuite : réception, inventaire ou
        ajustement approuvé). Données de démonstration FICTIVES seulement.
      </p>

      <SalesReadMessage
        v-if="
          locationRead.state.value !== 'ready' &&
          locationRead.state.value !== 'empty' &&
          locationRead.state.value !== 'loading'
        "
        :state="locationRead.state.value"
        subject="les emplacements de stock"
        :error="locationRead.error.value"
        @retry="locationRead.reload()"
      />
      <StateMessage
        v-else-if="locations.length === 0 && locationRead.state.value !== 'loading'"
        state="empty"
        title="Aucun emplacement de stock"
      >
        Le cabinet n’a aucun emplacement de stock actif : l’exploitant le crée à la mise en service
        (commande « eeo:sales:bootstrap »). Aucun emplacement n’est deviné ici.
      </StateMessage>

      <form
        v-else
        novalidate
        aria-labelledby="titre-stock-initial"
        class="space-y-4"
        @submit.prevent="submit"
      >
        <ErrorSummary ref="summaryBox" :errors="summary" />
        <StateMessage v-if="failure" :state="failure.state" :title="failure.title">
          {{ mutation.failureMessage.value }}
          <template v-if="failure.retry" #action>
            <AppButton variant="secondary" :pending="saving" @click="retry"
              >Réessayer l’enregistrement</AppButton
            >
          </template>
        </StateMessage>
        <StateMessage
          v-if="mutation.state.value === 'reauthentication-required' && !askingPassword"
          state="error"
          title="Confirmation du mot de passe demandée"
        >
          Rien n’a été enregistré : confirmez votre mot de passe pour reprendre.
          <template #action>
            <AppButton variant="secondary" @click="askingPassword = true"
              >Confirmer mon mot de passe</AppButton
            >
          </template>
        </StateMessage>

        <ul v-if="lines.length > 0" class="space-y-3">
          <li
            v-for="(line, index) in lines"
            :key="line.movementId"
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
                :control-id="fieldId(line, 'itemId')"
                :error="lineErrors[line.movementId]?.itemId ?? null"
                required
                @update:model-value="updateLine(index, { itemId: $event })"
              />
              <SelectField
                :model-value="line.locationId"
                label="Emplacement"
                :options="locations"
                :control-id="fieldId(line, 'locationId')"
                :error="lineErrors[line.movementId]?.locationId ?? null"
                required
                @update:model-value="updateLine(index, { locationId: $event })"
              />
              <DecimalField
                :ref="(element) => setRef(`${line.movementId}-q`, element)"
                :model-value="line.quantity"
                kind="quantity"
                field="quantity"
                label="Quantité comptée"
                :control-id="fieldId(line, 'quantity')"
                :error="lineErrors[line.movementId]?.quantity ?? null"
                required
                @update:model-value="updateLine(index, { quantity: $event })"
              />
              <MoneyField
                v-if="withCost"
                :ref="(element) => setRef(`${line.movementId}-c`, element)"
                :model-value="line.unitCost"
                label="Coût d’achat unitaire (facultatif)"
                field="unit_cost"
                hint="Inconnu : laisser vide (jamais 0)."
                @update:model-value="updateLine(index, { unitCost: $event })"
              />
              <TextField
                :model-value="line.batchNumber"
                label="Numéro de lot"
                :hint="
                  line.itemId && items.get(line.itemId)?.requires_expiry
                    ? 'Obligatoire pour un article périssable.'
                    : 'Facultatif.'
                "
                :maxlength="64"
                :control-id="fieldId(line, 'batchNumber')"
                :error="lineErrors[line.movementId]?.batchNumber ?? null"
                @update:model-value="updateLine(index, { batchNumber: $event })"
              />
              <DateField
                :ref="(element) => setRef(`${line.movementId}-d`, element)"
                :model-value="line.expiresOn"
                label="Date d’expiration"
                :control-id="fieldId(line, 'expiresOn')"
                :error="lineErrors[line.movementId]?.expiresOn ?? null"
                @update:model-value="updateLine(index, { expiresOn: $event })"
              />
            </div>
          </li>
        </ul>
        <AppButton variant="secondary" :disabled="saving" @click="addLine"
          >Ajouter une ligne</AppButton
        >

        <div class="space-y-2 rounded-lg border-2 border-line bg-surface p-3">
          <label for="stock-fichier-csv" class="field-label block"
            >Remplir depuis un fichier CSV (facultatif)</label
          >
          <p class="text-sm text-muted">
            Colonnes : reference, quantite, emplacement, lot, peremption, cout_unitaire. Les lignes
            remplacent celles du formulaire ; rien n’est enregistré avant « Enregistrer ».
          </p>
          <input
            id="stock-fichier-csv"
            type="file"
            accept=".csv,text/csv"
            class="block min-h-11 w-full max-w-full text-base"
            :disabled="saving || csvReading"
            @change="fillFromCsv"
          />
          <AppButton variant="ghost" @click="downloadOpeningTemplate"
            >Télécharger le modèle de stock initial</AppButton
          >
          <StateMessage
            v-if="csvProblems.length > 0"
            state="error"
            title="Le fichier est à corriger : le formulaire n’a pas été modifié"
          >
            <ul class="mt-2 list-disc space-y-1 pl-5">
              <li v-for="(item, index) in csvProblems" :key="index">
                Ligne {{ item.line }}<template v-if="item.column"> ({{ item.column }})</template> :
                {{ item.message }}
              </li>
            </ul>
          </StateMessage>
        </div>

        <TextAreaField
          v-model="reason"
          label="Motif du comptage"
          hint="Par exemple : comptage d’ouverture du cabinet (données de démonstration)."
          :maxlength="REASON_MAX_LENGTH"
          control-id="stock-motif"
          required
        />
        <p class="text-sm text-muted">
          Opération sensible : votre mot de passe peut vous être demandé avant l’enregistrement.
        </p>
        <AppButton type="submit" :pending="saving" pending-label="Enregistrement en cours…"
          >Enregistrer le stock initial</AppButton
        >
      </form>
    </section>

    <PasswordConfirmDialog
      :open="askingPassword"
      action="L’enregistrement du stock initial"
      @confirmed="onPasswordConfirmed"
      @cancel="askingPassword = false"
    />
  </section>
</template>
