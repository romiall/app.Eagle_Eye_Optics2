<script setup lang="ts">
/**
 * Une ligne du brouillon de facture (B02), en carte (360 px sans défilement horizontal) : article ou
 * ligne libre, quantité exacte, prix unitaire TTC, remise TTC et montants calculés par les règles
 * partagées. Le prix d'un article du catalogue s'impose sans autorité de prix (`catalog.manage`) : le
 * champ est alors en lecture seule. La règle de remise est dite à côté du champ ; le serveur tranche.
 * `commit()` (exposé) lit les champs numériques avant l'envoi.
 */
import { computed, ref } from 'vue'

import DecimalField from '@/components/form/DecimalField.vue'
import MoneyField from '@/components/form/MoneyField.vue'
import TextField from '@/components/form/TextField.vue'
import AppButton from '@/components/ui/AppButton.vue'
import {
  computeDraftLine,
  DESCRIPTION_MAX_LENGTH,
  discountRule,
  type DraftLineField,
  type DraftLineForm,
  priceEditable,
} from '@/domain/billing/draft'
import { formatMoney } from '@/domain/values/money'

import { unitLabel } from './format'
import StockAvailabilityNote from './StockAvailabilityNote.vue'

const props = withDefaults(
  defineProps<{
    line: DraftLineForm
    index: number
    priceAuthority: boolean
    errors?: Partial<Record<DraftLineField, string>>
    showStock?: boolean
    disabled?: boolean
    /** Plafond de remise effectif de ce compte lu sur le serveur (« 10.0000 »), ou null s'il n'est pas lu. */
    discountCap?: string | null
  }>(),
  { errors: () => ({}), showStock: false, disabled: false, discountCap: null },
)

const emit = defineEmits<{ 'update:line': [line: DraftLineForm]; remove: [] }>()

const quantityField = ref<{ commit: () => boolean } | null>(null)
const priceField = ref<{ commit: () => boolean } | null>(null)
const discountField = ref<{ commit: () => boolean } | null>(null)

const number = computed(() => props.index + 1)
const prefix = computed(() => `ligne-${props.line.lineId}`)
const computed_ = computed(() => computeDraftLine(props.line))
const freeLine = computed(() => props.line.catalogItemId === null)
const canEditPrice = computed(() => priceEditable(props.priceAuthority))
const canEditDescription = computed(() => freeLine.value || props.priceAuthority)
const stocked = computed(
  () => props.showStock && props.line.stockMode === 'STOCKED' && props.line.catalogItemId !== null,
)

function update(patch: Partial<DraftLineForm>): void {
  emit('update:line', { ...props.line, ...patch })
}

/** Identifiant du contrôle d'un champ de la ligne (cible du résumé d'erreurs). */
function fieldId(field: DraftLineField): string {
  return `${prefix.value}-${field}`
}

function commit(): boolean {
  const results = [
    quantityField.value?.commit() ?? true,
    priceField.value?.commit() ?? true,
    discountField.value?.commit() ?? true,
  ]
  return results.every(Boolean)
}

defineExpose({ commit, fieldId })
</script>

<template>
  <li
    :id="fieldId('line')"
    tabindex="-1"
    class="space-y-3 rounded-xl border border-line bg-surface shadow-card p-3"
    :aria-labelledby="`${prefix}-titre`"
  >
    <div class="flex flex-wrap items-start justify-between gap-2">
      <h3 :id="`${prefix}-titre`" class="text-base font-semibold break-words">
        Ligne {{ number }}<span v-if="props.line.reference"> · {{ props.line.reference }}</span
        ><span v-if="freeLine"> · hors catalogue</span>
      </h3>
      <AppButton
        variant="ghost"
        :disabled="props.disabled"
        :accessible-name="`Retirer la ligne ${number}`"
        @click="emit('remove')"
        >Retirer la ligne</AppButton
      >
    </div>

    <TextField
      v-if="canEditDescription"
      :model-value="props.line.description"
      label="Désignation"
      :control-id="fieldId('description')"
      :maxlength="DESCRIPTION_MAX_LENGTH"
      :error="props.errors.description ?? null"
      :disabled="props.disabled"
      required
      @update:model-value="update({ description: $event })"
    />
    <p v-else :id="fieldId('description')" tabindex="-1" class="break-words">
      <span class="text-sm text-muted">Désignation : </span>{{ props.line.description }}
      <span v-if="props.errors.description" class="block text-sm font-medium text-danger"
        ><span aria-hidden="true">⚠ </span>{{ props.errors.description }}</span
      >
    </p>
    <p v-if="freeLine" class="text-xs text-muted">
      Produit hors catalogue : exonéré de TVA (0 %) par défaut lorsqu’une règle fiscale à 0 % est
      validée.
    </p>
    <p
      v-if="props.errors.catalogItemId"
      :id="fieldId('catalogItemId')"
      tabindex="-1"
      class="text-sm font-medium text-danger"
    >
      <span aria-hidden="true">⚠ </span>{{ props.errors.catalogItemId }}
    </p>

    <div class="grid gap-3 sm:grid-cols-3">
      <DecimalField
        ref="quantityField"
        :model-value="props.line.quantity"
        kind="quantity"
        field="quantity"
        :label="`Quantité (${unitLabel(props.line.unitCode)})`"
        :hint="props.line.integerOnly ? 'Nombre entier.' : undefined"
        :control-id="fieldId('quantity')"
        :error="props.errors.quantity ?? null"
        :disabled="props.disabled"
        required
        @update:model-value="update({ quantity: $event })"
      />
      <MoneyField
        ref="priceField"
        :model-value="props.line.unitPriceGross"
        label="Prix unitaire TTC"
        field="unit_price_gross"
        :hint="
          canEditPrice ? undefined : 'Prix du catalogue (modifiable par la gérante seulement).'
        "
        :control-id="fieldId('unitPriceGross')"
        :error="props.errors.unitPriceGross ?? null"
        :disabled="props.disabled || !canEditPrice"
        required
        @update:model-value="update({ unitPriceGross: $event })"
      />
      <MoneyField
        ref="discountField"
        :model-value="props.line.discountGross"
        label="Remise TTC"
        field="discount_gross"
        :hint="discountRule(props.priceAuthority, props.discountCap)"
        :control-id="fieldId('discountGross')"
        :error="props.errors.discountGross ?? null"
        :disabled="props.disabled"
        @update:model-value="update({ discountGross: $event })"
      />
    </div>

    <p v-if="computed_.ok" class="text-base">
      Brut : <span class="tabular-nums">{{ formatMoney(computed_.amounts.gross) }}</span>
      <template v-if="computed_.amounts.discount > 0">
        · remise : <span class="tabular-nums">{{ formatMoney(computed_.amounts.discount) }}</span>
      </template>
      ·
      <strong
        >montant de la ligne :
        <span class="tabular-nums">{{ formatMoney(computed_.amounts.net) }}</span></strong
      >
    </p>
    <p v-else class="text-sm text-muted">
      Montant de la ligne : à compléter ({{ computed_.message }})
    </p>

    <StockAvailabilityNote
      v-if="stocked && props.line.catalogItemId"
      :item-id="props.line.catalogItemId"
    />
    <p v-if="props.errors.line" class="text-sm font-medium text-danger">
      <span aria-hidden="true">⚠ </span>{{ props.errors.line }}
    </p>
  </li>
</template>
