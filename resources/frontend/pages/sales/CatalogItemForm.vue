<script setup lang="ts">
/**
 * Création ou modification d'un article du catalogue (B01), par la gérante (`catalog.manage`), EN
 * LIGNE. Référence unique, catégorie et unité du référentiel, prix de vente en FCFA, mode de stock
 * (sans stock, stocké, sur mesure), règle fiscale éventuelle. Le coût d'achat n'est montré et saisi
 * qu'avec `catalog.purchase_cost.read`. Aucun prix réel n'est proposé : seules des valeurs FICTIVES
 * existent en développement. Modification : version attendue de l'article ; s'il a changé entre-temps
 * (409), la saisie est conservée et « Relire l'article » reprend la version actuelle sans l'effacer. Un
 * changement de prix ne touche jamais une facture émise.
 */
import { computed, ref, shallowRef } from 'vue'

import type { MutationOutcome } from '@/app/services/mutations'
import { useMutation } from '@/app/services/useMutation'
import { canOnScreen, revalidateSession } from '@/app/session'
import { useUnsavedChangesGuard } from '@/app/unsavedChanges'
import ErrorSummary, { type FieldErrorItem } from '@/components/feedback/ErrorSummary.vue'
import StateMessage from '@/components/feedback/StateMessage.vue'
import CheckboxField from '@/components/form/CheckboxField.vue'
import DecimalField from '@/components/form/DecimalField.vue'
import MoneyField from '@/components/form/MoneyField.vue'
import SelectField from '@/components/form/SelectField.vue'
import TextField from '@/components/form/TextField.vue'
import AppButton from '@/components/ui/AppButton.vue'
import {
  blankCatalogForm,
  CATALOG_TEXT_LIMITS,
  CATEGORY_LABELS,
  type CatalogErrors,
  type CatalogField,
  catalogFieldFromServer,
  catalogFormFromItem,
  type CatalogItemForm,
  STOCK_MODE_LABELS,
  UNIT_INTEGER_ONLY,
  validateCatalogForm,
} from '@/domain/billing/catalog'
import type {
  CatalogItem,
  CatalogItemResponse,
  CatalogItemsStockMode,
  TaxRule,
} from '@/domain/contracts/generated'
import { formatMoney } from '@/domain/values/money'

import { salesFailureView } from './failureView'
import { unitLabel } from './format'

const props = withDefaults(
  defineProps<{
    /** Article modifié, ou null pour une création. */
    item?: CatalogItem | null
    taxRules: readonly TaxRule[]
    /** Version actuelle relue après un conflit (fournie par la liste), ou null. */
    latest?: CatalogItem | null
  }>(),
  { item: null, latest: null },
)

const emit = defineEmits<{ saved: [item: CatalogItem]; cancel: []; reload: [] }>()

const mutation = useMutation()
const baseline = shallowRef<CatalogItem | null>(props.item)
const form = ref<CatalogItemForm>(
  props.item === null ? blankCatalogForm() : catalogFormFromItem(props.item),
)
const initial = JSON.stringify(form.value)
const errors = ref<CatalogErrors>({})
const general = ref<string | null>(null)
const summaryBox = ref<{ focus: () => Promise<void> } | null>(null)
const priceField = ref<{ commit: () => boolean } | null>(null)
const costField = ref<{ commit: () => boolean } | null>(null)
const thresholdField = ref<{ commit: () => boolean } | null>(null)
const saved = ref(false)
const needsReload = ref(false)

const withCost = computed(() => canOnScreen('catalog.purchase_cost.read'))
const saving = computed(() => mutation.state.value === 'saving')
const failure = computed(() =>
  mutation.state.value === 'conflict' ? null : salesFailureView(mutation.state.value),
)
const dirty = computed(() => !saved.value && JSON.stringify(form.value) !== initial)
useUnsavedChangesGuard(dirty)

const prefix = computed(() =>
  props.item === null ? 'article-nouveau' : `article-${props.item.id}`,
)
function fieldId(field: CatalogField): string {
  return `${prefix.value}-${field}`
}

const categoryOptions = Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ value, label }))
const unitOptions = Object.keys(UNIT_INTEGER_ONLY).map((value) => ({
  value,
  label: unitLabel(value),
}))
const stockOptions = (Object.keys(STOCK_MODE_LABELS) as CatalogItemsStockMode[]).map((value) => ({
  value,
  label: STOCK_MODE_LABELS[value],
}))
const taxOptions = computed(() =>
  props.taxRules.map((rule) => ({
    value: rule.id,
    label: `${rule.label} (${rule.code})${rule.validated_at === null ? ' — non validée' : ''}`,
  })),
)

const LABELS: Readonly<Record<CatalogField, string>> = {
  reference: 'Référence',
  categoryCode: 'Catégorie',
  name: 'Nom',
  brand: 'Marque',
  model: 'Modèle',
  unitCode: 'Unité',
  quantityIntegerOnly: 'Quantité entière',
  salePrice: 'Prix de vente',
  purchaseCost: 'Coût d’achat',
  taxRuleId: 'Règle fiscale',
  stockMode: 'Mode de stock',
  requiresExpiry: 'Lot et date d’expiration',
  lowStockThreshold: 'Seuil de stock bas',
  expiryAlertDays: 'Délai d’alerte de péremption',
  active: 'Article actif',
  publicVisibility: 'Visible sur le site public',
}

const summary = computed<FieldErrorItem[]>(() => {
  const items: FieldErrorItem[] = []
  for (const [field, message] of Object.entries(errors.value) as [CatalogField, string][]) {
    items.push({ fieldId: fieldId(field), message: `${LABELS[field]} : ${message}` })
  }
  if (general.value !== null) items.push({ fieldId: fieldId('reference'), message: general.value })
  return items
})

function set<K extends keyof CatalogItemForm>(key: K, value: CatalogItemForm[K]): void {
  form.value = { ...form.value, [key]: value }
  if (errors.value[key] !== undefined) {
    const rest = { ...errors.value }
    delete rest[key]
    errors.value = rest
  }
}

function setUnit(value: string | null): void {
  set('unitCode', value)
  if (value !== null && UNIT_INTEGER_ONLY[value] === true) set('quantityIntegerOnly', true)
}

async function afterOutcome(result: MutationOutcome): Promise<void> {
  switch (result.kind) {
    case 'synced': {
      saved.value = true
      emit('saved', (result.result as CatalogItemResponse).data)
      return
    }
    case 'conflict':
      needsReload.value = true
      emit('reload')
      return
    case 'refused': {
      const byField: CatalogErrors = {}
      const others: string[] = []
      for (const [key, messages] of Object.entries(result.error.fields)) {
        const message = messages[0]
        if (message === undefined) continue
        const field = catalogFieldFromServer(key)
        if (field === null) others.push(message)
        else byField[field] = message
      }
      errors.value = byField
      general.value =
        others.length > 0
          ? others.join(' ')
          : Object.keys(byField).length === 0
            ? result.error.message
            : null
      await summaryBox.value?.focus()
      return
    }
    case 'session-expired':
    case 'reauthentication-required':
      void revalidateSession().catch(() => undefined)
      return
    default:
      return
  }
}

/** Version actuelle relue (conflit) : la saisie est conservée, la version attendue est mise à jour. */
function adoptLatest(): void {
  if (props.latest === null) return
  baseline.value = props.latest
  needsReload.value = false
}

async function submit(): Promise<void> {
  if (saving.value) return
  errors.value = {}
  general.value = null
  const committed = [
    priceField.value?.commit() ?? true,
    costField.value?.commit() ?? true,
    thresholdField.value?.commit() ?? true,
  ].every(Boolean)
  const checked = validateCatalogForm(form.value)
  if (!committed || !checked.ok) {
    errors.value = checked.ok ? {} : checked.errors
    if (!committed && checked.ok)
      general.value = 'Certaines valeurs saisies sont refusées : corrigez-les.'
    await summaryBox.value?.focus()
    return
  }
  // Sans le droit de lire le coût d'achat, il n'est jamais envoyé autrement que lu (absent → null).
  const payload = withCost.value
    ? checked.payload
    : { ...checked.payload, purchase_cost: baseline.value?.purchase_cost ?? null }
  const base = baseline.value
  await afterOutcome(
    await mutation.submit(
      base === null
        ? {
            name: 'CreateCatalogItem',
            route: { method: 'POST', path: '/catalog/items' },
            payload,
          }
        : {
            name: 'UpdateCatalogItem',
            route: {
              method: 'PATCH',
              path: `/catalog/items/${encodeURIComponent(base.id)}`,
              expectedVersion: 'entity',
            },
            payload,
            expectedVersion: base.version,
          },
    ),
  )
}

async function retry(): Promise<void> {
  if (saving.value) return
  await afterOutcome(await mutation.retry())
}
</script>

<template>
  <form
    novalidate
    :aria-labelledby="`${prefix}-titre`"
    class="space-y-4 rounded-xl border border-primary bg-surface p-4"
    @submit.prevent="submit"
  >
    <h2 :id="`${prefix}-titre`" class="text-lg font-semibold">
      {{ props.item === null ? 'Nouvel article' : `Modifier l’article ${props.item.reference}` }}
    </h2>
    <p class="text-sm text-muted">
      Données de démonstration FICTIVES seulement tant que la gérante n’a pas fourni son catalogue :
      aucun prix réel n’est proposé par l’application.
    </p>

    <ErrorSummary ref="summaryBox" :errors="summary" />

    <StateMessage v-if="needsReload" state="conflict" title="L’article a changé entre-temps">
      <p>
        Quelqu’un a modifié cet article pendant votre saisie. Votre saisie est conservée.
        <template v-if="props.latest">
          Version actuelle : prix {{ formatMoney(props.latest.sale_price) }},
          {{ props.latest.active ? 'actif' : 'désactivé' }}.</template
        >
      </p>
      <template #action>
        <AppButton v-if="props.latest" variant="primary" @click="adoptLatest"
          >Garder ma saisie sur la version actuelle</AppButton
        >
        <AppButton v-else variant="secondary" @click="emit('reload')">Relire l’article</AppButton>
      </template>
    </StateMessage>

    <StateMessage v-if="failure" :state="failure.state" :title="failure.title">
      {{ mutation.failureMessage.value }}
      <template v-if="failure.retry" #action>
        <AppButton variant="secondary" :pending="saving" @click="retry"
          >Réessayer l’enregistrement</AppButton
        >
      </template>
    </StateMessage>

    <div class="grid gap-4 sm:grid-cols-2">
      <TextField
        :model-value="form.reference"
        label="Référence"
        :control-id="fieldId('reference')"
        :maxlength="CATALOG_TEXT_LIMITS.reference"
        :error="errors.reference ?? null"
        required
        @update:model-value="set('reference', $event)"
      />
      <TextField
        :model-value="form.name"
        label="Nom"
        :control-id="fieldId('name')"
        :maxlength="CATALOG_TEXT_LIMITS.name"
        :error="errors.name ?? null"
        required
        @update:model-value="set('name', $event)"
      />
      <SelectField
        :model-value="form.categoryCode"
        label="Catégorie"
        :options="categoryOptions"
        :control-id="fieldId('categoryCode')"
        :error="errors.categoryCode ?? null"
        required
        @update:model-value="set('categoryCode', $event)"
      />
      <SelectField
        :model-value="form.stockMode"
        label="Mode de stock"
        :options="stockOptions"
        :control-id="fieldId('stockMode')"
        :error="errors.stockMode ?? null"
        required
        @update:model-value="set('stockMode', $event as CatalogItemsStockMode | null)"
      />
      <TextField
        :model-value="form.brand"
        label="Marque"
        :control-id="fieldId('brand')"
        :maxlength="CATALOG_TEXT_LIMITS.brand"
        :error="errors.brand ?? null"
        @update:model-value="set('brand', $event)"
      />
      <TextField
        :model-value="form.model"
        label="Modèle"
        :control-id="fieldId('model')"
        :maxlength="CATALOG_TEXT_LIMITS.model"
        :error="errors.model ?? null"
        @update:model-value="set('model', $event)"
      />
      <SelectField
        :model-value="form.unitCode"
        label="Unité"
        hint="Une paire reste une paire : elle n’est jamais convertie en deux unités."
        :options="unitOptions"
        :control-id="fieldId('unitCode')"
        :error="errors.unitCode ?? null"
        required
        @update:model-value="setUnit($event)"
      />
      <MoneyField
        ref="priceField"
        :model-value="form.salePrice"
        label="Prix de vente TTC"
        field="sale_price"
        :control-id="fieldId('salePrice')"
        :error="errors.salePrice ?? null"
        required
        @update:model-value="set('salePrice', $event)"
      />
      <MoneyField
        v-if="withCost"
        ref="costField"
        :model-value="form.purchaseCost"
        label="Coût d’achat (facultatif)"
        field="purchase_cost"
        hint="Inconnu : laisser vide (jamais 0). Visible seulement par la gérante."
        :control-id="fieldId('purchaseCost')"
        :error="errors.purchaseCost ?? null"
        @update:model-value="set('purchaseCost', $event)"
      />
      <SelectField
        :model-value="form.taxRuleId"
        label="Règle fiscale"
        placeholder="Aucune règle fiscale"
        hint="Une règle n’est appliquée aux documents que si elle est active et validée."
        :options="taxOptions"
        :control-id="fieldId('taxRuleId')"
        :error="errors.taxRuleId ?? null"
        @update:model-value="set('taxRuleId', $event)"
      />
      <DecimalField
        v-if="form.stockMode === 'STOCKED'"
        ref="thresholdField"
        :model-value="form.lowStockThreshold"
        kind="quantity"
        field="low_stock_threshold"
        label="Seuil de stock bas (facultatif)"
        :control-id="fieldId('lowStockThreshold')"
        :error="errors.lowStockThreshold ?? null"
        @update:model-value="set('lowStockThreshold', $event)"
      />
      <TextField
        v-if="form.requiresExpiry"
        :model-value="form.expiryAlertDays"
        label="Délai d’alerte de péremption, en jours (facultatif)"
        inputmode="numeric"
        :control-id="fieldId('expiryAlertDays')"
        :error="errors.expiryAlertDays ?? null"
        @update:model-value="set('expiryAlertDays', $event)"
      />
    </div>

    <div class="space-y-1">
      <CheckboxField
        :model-value="form.quantityIntegerOnly"
        label="Quantité entière seulement"
        :control-id="fieldId('quantityIntegerOnly')"
        :error="errors.quantityIntegerOnly ?? null"
        @update:model-value="set('quantityIntegerOnly', $event)"
      />
      <CheckboxField
        :model-value="form.requiresExpiry"
        label="Lot et date d’expiration obligatoires (périssable)"
        :control-id="fieldId('requiresExpiry')"
        :error="errors.requiresExpiry ?? null"
        @update:model-value="set('requiresExpiry', $event)"
      />
      <CheckboxField
        :model-value="form.active"
        label="Article actif (proposé sur les factures)"
        :control-id="fieldId('active')"
        :error="errors.active ?? null"
        @update:model-value="set('active', $event)"
      />
      <CheckboxField
        :model-value="form.publicVisibility"
        label="Visible sur le site public"
        hint="Autorise une fiche du showroom pour cet article ; la fiche se prépare dans Communication."
        :control-id="fieldId('publicVisibility')"
        :error="errors.publicVisibility ?? null"
        @update:model-value="set('publicVisibility', $event)"
      />
    </div>

    <div class="flex flex-wrap gap-3">
      <AppButton type="submit" :pending="saving" pending-label="Enregistrement en cours…">{{
        props.item === null ? 'Créer l’article' : 'Enregistrer l’article'
      }}</AppButton>
      <AppButton variant="ghost" :disabled="saving" @click="emit('cancel')">Annuler</AppButton>
    </div>
  </form>
</template>
