<script setup lang="ts">
/**
 * Étape « Acuité visuelle » (C02 ; DP §6 et §7 ; fichier 02) : acuité de loin et de près, sans et avec
 * correction, pour OD, OG et OU (douze valeurs), puis acuité après correction OD, OG, OU (trois valeurs, sans
 * distinction loin/près). Toutes les valeurs sont facultatives : une case vide est « non mesuré », jamais zéro ;
 * « 0 » est une valeur.
 *
 * L'échelle est choisie explicitement pour chaque groupe (loin, près, après correction) ; la valeur lue est
 * conservée telle que saisie (« 10/10 », « 6/6 », « P2 »). AUCUNE conversion entre échelles n'est faite : des
 * échelles différentes dans un même groupe sont signalées, leurs valeurs ne sont pas comparables. Les valeurs
 * usuelles proposées (famille de l'échelle : dixièmes, Snellen, Parinaud) n'ont aucune valeur clinique : la saisie
 * libre reste toujours possible.
 *
 * Choix direct, sans menu déroulant : une rangée de boutons radio, un par échelle active du cabinet, un seul geste.
 * Quand le cabinet n'a qu'UNE échelle active, elle s'applique d'office et son choix n'est pas proposé (rien n'est
 * deviné : il n'y en a pas d'autre).
 *
 * Saisie rapide, comme le carnet (sans correction puis avec correction, OD puis OG) : sous chaque tableau, les
 * valeurs usuelles de l'échelle du groupe sont des boutons qui remplissent la dernière case touchée, ou la
 * première case vide, puis passent à la suivante. Une valeur nouvelle prend l'échelle déjà choisie pour le
 * groupe. Le formulaire est tenu par l'écran ; ce composant affiche les erreurs reçues par identifiant de
 * contrôle.
 */
import { computed, ref } from 'vue'

import ClinicalHint from '@/components/clinical/ClinicalHint.vue'
import MeasureField from '@/components/clinical/MeasureField.vue'
import OpticalTable, {
  type OpticalColumn,
  type OpticalMeasures,
} from '@/components/clinical/OpticalTable.vue'
import QuickChoices from '@/components/clinical/QuickChoices.vue'
import {
  ACUITY_GROUPS,
  ACUITY_SLOTS,
  type AcuityCorrection,
  type AcuityEye,
  type AcuityGroup,
  acuitySlotKey,
  CORRECTION_TITLES,
  groupScale,
  mixedScaleGroups,
  setAcuityValue,
  setGroupScale,
  type VisualAcuityDraft,
} from '@/domain/clinical/acuity'
import { acuityQuickValues, acuitySuggestions, isDemoScale } from '@/domain/clinical/acuityScales'
import { CONTROL_IDS } from '@/domain/clinical/controls'
import type { VisualAcuityScale } from '@/domain/contracts/generated'

const model = defineModel<VisualAcuityDraft>({ required: true })
const props = withDefaults(
  defineProps<{
    errors: Readonly<Record<string, string>>
    disabled?: boolean
    scales: readonly VisualAcuityScale[]
    /** Les échelles ont été lues sur le serveur (sinon la saisie des échelles est impossible). */
    scalesReady?: boolean
  }>(),
  { disabled: false, scalesReady: true },
)

const EYES: readonly AcuityEye[] = ['OD', 'OG', 'OU']
/** Les boutons de valeurs usuelles remplissent OD puis OG, comme le carnet ; « OU » se saisit à la main. */
const QUICK_EYES: readonly AcuityEye[] = ['OD', 'OG']

const activeScales = computed(() => props.scales.filter((scale) => scale.active))
/** L'unique échelle active du cabinet, s'il n'y en a qu'une : aucun choix à faire, rien n'est deviné. */
const soleScale = computed<VisualAcuityScale | null>(() =>
  activeScales.value.length === 1 ? (activeScales.value[0] ?? null) : null,
)
const mixed = computed(() => new Set(mixedScaleGroups(model.value).map((group) => group.key)))
const hasDemo = computed(() => props.scales.some((scale) => isDemoScale(scale.code)))
/** Case visée par les boutons de valeurs usuelles, par groupe (dernière case touchée, puis la suivante). */
const targets = ref<Record<string, string>>({})

/** Échelle du groupe : celle des valeurs saisies, sinon l'unique échelle active, sinon aucune. */
function usedScale(group: AcuityGroup): string | null {
  if (mixed.value.has(group.key)) return null
  return groupScale(model.value, group.key) ?? soleScale.value?.id ?? null
}

/** Vrai quand le cabinet n'a qu'une échelle et que le groupe l'utilise (ou n'en utilise aucune) : pas de choix à montrer. */
function scaleIsImposed(group: AcuityGroup): boolean {
  const sole = soleScale.value
  if (sole === null || mixed.value.has(group.key)) return false
  const used = groupScale(model.value, group.key)
  return used === null || used === sole.id
}

function scaleOptions(group: AcuityGroup): { value: string; label: string }[] {
  const options = activeScales.value.map((scale) => ({ value: scale.id, label: scale.label }))
  // Une échelle désactivée depuis reste visible tant qu'une valeur l'utilise : elle n'est jamais retirée en silence.
  const used = groupScale(model.value, group.key)
  const inactive = props.scales.find((scale) => scale.id === used && !scale.active)
  return inactive === undefined
    ? options
    : [...options, { value: inactive.id, label: `${inactive.label} (désactivée)` }]
}

function columns(group: AcuityGroup): OpticalColumn[] {
  return group.corrections.map((correction) => ({
    key: correction,
    label: CORRECTION_TITLES[correction],
  }))
}

function slotKey(group: AcuityGroup, correction: string, eye: AcuityEye): string {
  return acuitySlotKey(group.context, group.distance, correction as AcuityCorrection, eye)
}

function measures(group: AcuityGroup): OpticalMeasures {
  const result: Record<string, Record<string, string>> = {}
  for (const eye of EYES) {
    const row: Record<string, string> = {}
    for (const correction of group.corrections) {
      row[correction] = model.value[slotKey(group, correction, eye)]?.value ?? ''
    }
    result[eye] = row
  }
  return result
}

function errorsOf(group: AcuityGroup): Record<string, string> {
  const result: Record<string, string> = {}
  for (const eye of EYES) {
    for (const correction of group.corrections) {
      const message = props.errors[CONTROL_IDS.acuityValue(slotKey(group, correction, eye))]
      if (message !== undefined) result[`${eye}.${correction}`] = message
    }
  }
  return result
}

/** L'échelle (code et libellé) du groupe : de sa famille dépendent les valeurs usuelles proposées. */
function usedScaleOf(group: AcuityGroup): VisualAcuityScale | null {
  const id = usedScale(group)
  return props.scales.find((scale) => scale.id === id) ?? null
}

function suggestionsOf(group: AcuityGroup): readonly string[] {
  const scale = usedScaleOf(group)
  return acuitySuggestions(scale?.code ?? null, scale?.label ?? '')
}

function listId(group: AcuityGroup): string {
  return `acuite-valeurs-${group.key.replaceAll('|', '-')}`
}

function chooseScale(group: AcuityGroup, scaleId: string | null): void {
  model.value = setGroupScale(model.value, group.key, scaleId)
}

/** Une valeur nouvelle prend l'échelle déjà choisie pour le groupe (ou l'unique échelle active). */
function withGroupScale(
  group: AcuityGroup,
  draft: VisualAcuityDraft,
  key: string,
): VisualAcuityDraft {
  const cell = draft[key]
  if (cell === undefined || cell.scaleId !== null) return draft
  const inherited = usedScale(group)
  return inherited === null ? draft : { ...draft, [key]: { ...cell, scaleId: inherited } }
}

function setValue(group: AcuityGroup, correction: string, eye: AcuityEye, value: string): void {
  const key = slotKey(group, correction, eye)
  model.value = withGroupScale(group, setAcuityValue(model.value, key, value), key)
}

// --- Valeurs usuelles en boutons -------------------------------------------------------------------

function quickValues(group: AcuityGroup): readonly string[] {
  const scale = usedScaleOf(group)
  return acuityQuickValues(scale?.code ?? null, scale?.label ?? '')
}

/** Cases remplies par les boutons, dans l'ordre du carnet : sans correction (OD, OG), puis avec correction. */
function quickSlots(group: AcuityGroup): string[] {
  return group.corrections.flatMap((correction) =>
    QUICK_EYES.map((eye) => slotKey(group, correction, eye)),
  )
}

function isEmptyAt(draft: VisualAcuityDraft, key: string): boolean {
  return (draft[key]?.value ?? '').trim() === ''
}

/** Case visée : la dernière case touchée du groupe, sinon la première case vide. */
function targetOf(group: AcuityGroup): string | null {
  const order = quickSlots(group)
  const wanted = targets.value[group.key]
  if (wanted !== undefined && order.includes(wanted)) return wanted
  return order.find((key) => isEmptyAt(model.value, key)) ?? order[0] ?? null
}

/** Dit où ira la prochaine valeur (« sans correction, OD »). */
function targetLabel(group: AcuityGroup): string {
  const key = targetOf(group)
  const slot = key === null ? undefined : ACUITY_SLOTS.find((entry) => entry.key === key)
  return slot === undefined
    ? 'la case suivante'
    : `${CORRECTION_TITLES[slot.correction].toLowerCase()}, ${slot.eye}`
}

/** Toucher une case la désigne comme cible des boutons, comme au carnet on pose le doigt sur la ligne. */
function trackFocus(group: AcuityGroup, event: FocusEvent): void {
  const element = event.target
  if (!(element instanceof HTMLElement)) return
  const key = quickSlots(group).find(
    (candidate) => CONTROL_IDS.acuityValue(candidate) === element.id,
  )
  if (key !== undefined) targets.value = { ...targets.value, [group.key]: key }
}

function pickValue(group: AcuityGroup, value: string): void {
  const key = targetOf(group)
  if (key === null) return
  const next = withGroupScale(group, setAcuityValue(model.value, key, value), key)
  model.value = next
  const order = quickSlots(group)
  const following = order
    .slice(order.indexOf(key) + 1)
    .find((candidate) => isEmptyAt(next, candidate))
  targets.value = { ...targets.value, [group.key]: following ?? key }
}

function valueOf(group: AcuityGroup, correction: string, eye: AcuityEye): string {
  return model.value[slotKey(group, correction, eye)]?.value ?? ''
}
</script>

<template>
  <div class="space-y-8">
    <ClinicalHint>
      Saisissez les valeurs lues, telles que l’échelle les donne. Une case vide est « non mesuré » ;
      « 0 » est une valeur. Aucune conversion entre échelles n’est faite. Les boutons proposent les
      valeurs usuelles de l’échelle : vous pouvez toujours écrire une autre valeur.
    </ClinicalHint>
    <p
      v-if="props.scalesReady && props.scales.length === 0"
      role="alert"
      class="rounded-xl border border-warning bg-warning-soft p-3 text-base font-medium text-ink"
    >
      <span aria-hidden="true">⚠ </span>Aucune échelle d’acuité n’est configurée pour ce cabinet :
      les acuités ne peuvent pas être saisies. Demandez à l’exploitant de les créer (commande
      <code>eeo:clinical:scales</code>).
    </p>
    <p
      v-else-if="!props.scalesReady"
      role="alert"
      class="rounded-xl border border-warning bg-warning-soft p-3 text-base font-medium text-ink"
    >
      <span aria-hidden="true">⚠ </span>Les échelles d’acuité n’ont pas pu être lues : le choix de
      l’échelle est indisponible. Aucune échelle n’est devinée.
    </p>
    <ClinicalHint v-if="hasDemo">
      Échelles de démonstration : non validées cliniquement, à remplacer par celles du cabinet.
    </ClinicalHint>

    <section
      v-for="group in ACUITY_GROUPS"
      :key="group.key"
      class="space-y-3"
      @focusin="trackFocus(group, $event)"
    >
      <datalist :id="listId(group)">
        <option v-for="suggestion in suggestionsOf(group)" :key="suggestion" :value="suggestion" />
      </datalist>
      <OpticalTable
        :caption="group.title"
        :columns="columns(group)"
        :eyes="EYES"
        :model-value="measures(group)"
        :errors="errorsOf(group)"
      >
        <template #intro>
          <p v-if="scaleIsImposed(group)" class="text-sm text-muted">
            Échelle utilisée :
            <strong class="font-semibold text-ink">{{ soleScale?.label }}</strong>
          </p>
          <!-- Choix direct de l'échelle : un bouton radio par échelle active, jamais un menu déroulant. -->
          <fieldset
            v-else-if="scaleOptions(group).length > 0"
            :id="CONTROL_IDS.acuityScale(group.key)"
            tabindex="-1"
            class="min-w-0"
          >
            <legend class="mb-1.5 p-0 text-sm leading-5 font-semibold text-ink">
              {{ group.title }} : échelle utilisée
            </legend>
            <div class="flex flex-wrap gap-2">
              <label
                v-for="option in scaleOptions(group)"
                :key="option.value"
                :for="`${CONTROL_IDS.acuityScale(group.key)}-${option.value}`"
                class="flex min-h-11 items-center gap-2 rounded-lg border border-line bg-surface px-3 py-1 text-base text-ink hover:border-primary has-checked:border-gold has-checked:bg-primary-soft has-checked:font-medium has-disabled:cursor-not-allowed has-disabled:bg-disabled"
              >
                <input
                  :id="`${CONTROL_IDS.acuityScale(group.key)}-${option.value}`"
                  type="radio"
                  :name="CONTROL_IDS.acuityScale(group.key)"
                  class="size-6 shrink-0 accent-primary"
                  :checked="groupScale(model, group.key) === option.value"
                  :disabled="props.disabled || !props.scalesReady"
                  @change="chooseScale(group, option.value)"
                />
                <span>{{ option.label }}</span>
              </label>
            </div>
            <p
              v-if="props.errors[CONTROL_IDS.acuityScale(group.key)]"
              class="mt-1.5 flex items-start gap-1.5 text-sm leading-5 font-medium text-danger"
            >
              <span aria-hidden="true" class="shrink-0">⚠ </span
              ><span>{{ props.errors[CONTROL_IDS.acuityScale(group.key)] }}</span>
            </p>
          </fieldset>
          <p
            v-if="mixed.has(group.key)"
            class="rounded-xl border border-warning bg-warning-soft p-3 text-sm font-medium text-ink"
          >
            <span aria-hidden="true">⚠ </span>Échelles différentes dans ce groupe : ses valeurs ne
            sont pas comparables entre elles. Choisissez une seule échelle pour tout le groupe, ou
            gardez-les séparées en connaissance de cause.
          </p>
        </template>
        <template #cellule-WITHOUT="cell">
          <MeasureField
            :label="`${group.title}, sans correction, ${cell.eye}`"
            :model-value="valueOf(group, 'WITHOUT', cell.eye)"
            :control-id="CONTROL_IDS.acuityValue(slotKey(group, 'WITHOUT', cell.eye))"
            :error="cell.error"
            :list="listId(group)"
            :maxlength="100"
            :disabled="props.disabled"
            hide-label-wide
            @update:model-value="setValue(group, 'WITHOUT', cell.eye, $event)"
          />
        </template>
        <template #cellule-WITH="cell">
          <MeasureField
            :label="`${group.title}, avec correction, ${cell.eye}`"
            :model-value="valueOf(group, 'WITH', cell.eye)"
            :control-id="CONTROL_IDS.acuityValue(slotKey(group, 'WITH', cell.eye))"
            :error="cell.error"
            :list="listId(group)"
            :maxlength="100"
            :disabled="props.disabled"
            hide-label-wide
            @update:model-value="setValue(group, 'WITH', cell.eye, $event)"
          />
        </template>
      </OpticalTable>
      <QuickChoices
        :legend="`Valeurs usuelles : touchez une valeur pour remplir ${targetLabel(group)}`"
        :values="quickValues(group)"
        :disabled="props.disabled"
        @pick="pickValue(group, $event)"
      />
    </section>
  </div>
</template>
