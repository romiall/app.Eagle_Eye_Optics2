<script setup lang="ts">
/**
 * Historique des révisions d'une consultation terminée et comparaison côte à côte (C03 ; fichier 02,
 * « Historique et statistiques » ; AT19, AT21). Chaque révision est immuable et lisible telle qu'enregistrée ;
 * une correction n'écrase jamais la précédente.
 *
 * - Deux révisions se comparent fait par fait. Le changement est dit en texte ET par un symbole (« ≠ Modifié »,
 *   « + Ajouté », « − Retiré », « = Identique ») : la couleur n'est jamais le seul signal.
 * - Une valeur absente est « non renseigné » ou « non mesuré », jamais « aucun » ni zéro.
 * - Une acuité est toujours rendue avec son échelle ; des échelles différentes sont déclarées non comparables.
 * - Mise en page : sur grand écran, trois colonnes (élément, révision de référence, révision comparée) ; sur
 *   téléphone, des blocs empilés, sans défilement horizontal.
 * - Hors ligne : « indisponible », jamais une révision vide ni une ancienne copie.
 * - Présentation : cartes de révision (la révision actuelle porte sa puce), choix des révisions dans une
 *   carte, faits regroupés par rubrique, changement en puce écrite (symbole et libellé).
 */
import { computed, ref, shallowRef, watch } from 'vue'

import { ApiError, NetworkUnavailable } from '@/app/api'
import { formatInstantFr } from '@/app/clinicTime'
import { getConsultation, getRevision, getVisualAcuityScales } from '@/app/services/consultations'
import StateMessage from '@/components/feedback/StateMessage.vue'
import SelectField from '@/components/form/SelectField.vue'
import PageHeader from '@/components/layout/PageHeader.vue'
import StatusChip, { type ChipTone } from '@/components/layout/StatusChip.vue'
import AppButton from '@/components/ui/AppButton.vue'
import {
  CHANGE_LABELS,
  CHANGE_SYMBOLS,
  type ChangeKind,
  compareSteps,
  type ComparisonRow,
  describeSteps,
  type StepsData,
} from '@/domain/clinical/compare'
import { DELIVERED_STEPS, STEP_TITLES } from '@/domain/clinical/labels'
import type {
  ClinicalRevisionDetail,
  Consultation,
  VisualAcuityScale,
} from '@/domain/contracts/generated'

import ConsultationReadMessage from './ConsultationReadMessage.vue'
import { useClinicalRead } from './useClinicalRead'

const props = defineProps<{ consultationId: string }>()

const consultationRead = useClinicalRead<Consultation>(() => getConsultation(props.consultationId))
const scalesRead = useClinicalRead<VisualAcuityScale[]>(() => getVisualAcuityScales())

type Loaded =
  | { state: 'loading' }
  | { state: 'ready'; detail: ClinicalRevisionDetail }
  | { state: 'error'; message: string }

const loaded = shallowRef<Readonly<Record<number, Loaded>>>({})
const leftNo = ref<number | null>(null)
const rightNo = ref<number | null>(null)
const onlyDifferences = ref(true)

const consultation = computed(() => consultationRead.data.value)
const revisions = computed(() => consultation.value?.revisions ?? [])
const scales = computed(() => scalesRead.data.value ?? [])

watch(
  consultation,
  (value) => {
    if (value === null || rightNo.value !== null) return
    const list = value.revisions
    const last = list[list.length - 1]
    const before = list[list.length - 2]
    rightNo.value = last?.revision_no ?? null
    leftNo.value = before?.revision_no ?? null
  },
  { immediate: true },
)

function message(error: unknown): string {
  if (error instanceof NetworkUnavailable) {
    return 'Le serveur n’a pas répondu : cette révision n’a pas pu être lue. Aucune ancienne copie n’est présentée.'
  }
  if (error instanceof ApiError) return error.message
  return 'Une erreur inattendue est survenue.'
}

async function ensure(revisionNo: number | null): Promise<void> {
  if (revisionNo === null) return
  const known = loaded.value[revisionNo]
  if (known !== undefined && known.state !== 'error') return
  loaded.value = { ...loaded.value, [revisionNo]: { state: 'loading' } }
  try {
    const result = await getRevision(props.consultationId, revisionNo)
    loaded.value = { ...loaded.value, [revisionNo]: { state: 'ready', detail: result.data } }
  } catch (error) {
    loaded.value = { ...loaded.value, [revisionNo]: { state: 'error', message: message(error) } }
  }
}

watch(
  [leftNo, rightNo],
  ([left, right]) => {
    void ensure(left)
    void ensure(right)
  },
  { immediate: true },
)

function detailOf(revisionNo: number | null): ClinicalRevisionDetail | null {
  if (revisionNo === null) return null
  const entry = loaded.value[revisionNo]
  return entry?.state === 'ready' ? entry.detail : null
}

function stateOf(revisionNo: number | null): Loaded | null {
  return revisionNo === null ? null : (loaded.value[revisionNo] ?? null)
}

function retry(revisionNo: number | null): void {
  void ensure(revisionNo)
}

const selected = computed(() =>
  [leftNo.value, rightNo.value].filter((value): value is number => value !== null),
)
const loadingAny = computed(() => selected.value.some((no) => stateOf(no)?.state === 'loading'))
const failures = computed(() =>
  selected.value.flatMap((revisionNo) => {
    const entry = stateOf(revisionNo)
    return entry?.state === 'error' ? [{ revisionNo, message: entry.message }] : []
  }),
)

const left = computed(() => detailOf(leftNo.value))
const right = computed(() => detailOf(rightNo.value))

function scaleLabel(scaleId: string): string {
  return scales.value.find((scale) => scale.id === scaleId)?.label ?? 'échelle inconnue'
}

function stepsOf(detail: ClinicalRevisionDetail): StepsData {
  return detail.snapshot.steps as unknown as StepsData
}

/** Comparaison de deux révisions, ou description de la seule révision choisie. */
const rows = computed<ComparisonRow[]>(() => {
  if (right.value === null) return []
  if (left.value === null) {
    if (leftNo.value !== null) return []
    // Une seule révision : son contenu, sans colonne de référence.
    return describeSteps(stepsOf(right.value), scaleLabel).map((fact) => ({
      step: fact.step,
      key: fact.key,
      label: fact.label,
      left: '',
      right: fact.value,
      kind: 'same' as const,
      note: null,
    }))
  }
  return compareSteps(stepsOf(left.value), stepsOf(right.value), scaleLabel).rows
})

const comparing = computed(() => leftNo.value !== null)
const differences = computed(() => rows.value.filter((row) => row.kind !== 'same').length)
const visibleRows = computed(() =>
  comparing.value && onlyDifferences.value
    ? rows.value.filter((row) => row.kind !== 'same')
    : rows.value,
)
const stepsWithRows = computed(() =>
  DELIVERED_STEPS.map((step) => ({
    step,
    rows: visibleRows.value.filter((row) => row.step === step),
  })).filter((group) => group.rows.length > 0),
)

const options = computed(() =>
  revisions.value.map((revision) => ({
    value: String(revision.revision_no),
    label: `Révision ${revision.revision_no} · ${formatInstantFr(revision.recorded_at)}`,
  })),
)

function choose(which: 'left' | 'right', value: string | null): void {
  const next = value === null ? null : Number(value)
  if (which === 'left') leftNo.value = next
  else if (next !== null) rightNo.value = next
}

function authorName(detail: ClinicalRevisionDetail | null): string {
  return detail?.snapshot.author.display_name ?? 'auteur inconnu'
}

function shortHash(hash: string): string {
  return hash.slice(0, 12)
}

/** Révision en vigueur de l'examen (la dernière figée). */
const currentRevision = computed(() => consultation.value?.current_revision ?? null)

/** Teinte de la puce de changement : elle accompagne le symbole et le libellé, jamais seule. */
const CHANGE_TONES: Readonly<Record<ChangeKind, ChipTone>> = {
  same: 'neutral',
  changed: 'gold',
  added: 'success',
  removed: 'warning',
}
</script>

<template>
  <section aria-labelledby="titre-revisions" class="page-stack max-w-5xl">
    <PageHeader
      title-id="titre-revisions"
      title="Révisions de la consultation"
      icon="history"
      :back="
        consultation === null
          ? undefined
          : {
              to: { name: 'consultation', params: { id: props.consultationId } },
              label: 'Retour à la consultation',
            }
      "
    />

    <ConsultationReadMessage
      v-if="consultation === null"
      :state="consultationRead.state.value"
      subject="consultation"
      :error="consultationRead.error.value"
      @retry="consultationRead.reload()"
    />

    <template v-else>
      <StateMessage v-if="revisions.length === 0" state="empty" title="Aucune révision enregistrée">
        Cet examen n’est pas terminé : la première révision est figée quand on le termine. Les
        révisions suivantes sont créées par les corrections motivées.
      </StateMessage>

      <template v-else>
        <div class="space-y-3">
          <h2 class="section-title">Révisions enregistrées</h2>
          <p class="max-w-prose text-base text-muted">
            Chaque révision est figée telle qu’enregistrée : elle ne change jamais. Choisissez deux
            révisions pour les comparer ; une valeur absente est « non renseigné » ou « non mesuré
            », jamais « aucun ».
          </p>
          <ol class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <li
              v-for="revision in revisions"
              :key="revision.id"
              class="card flex min-w-0 flex-col gap-1.5 p-4 text-base"
            >
              <div class="flex flex-wrap items-center justify-between gap-2">
                <p class="font-semibold">Révision {{ revision.revision_no }}</p>
                <StatusChip
                  v-if="revision.revision_no === currentRevision"
                  tone="success"
                  icon="check"
                  >Actuelle</StatusChip
                >
              </div>
              <p class="text-sm text-muted tabular-nums">
                {{ formatInstantFr(revision.recorded_at) }}
              </p>
              <p class="break-words">Motif : {{ revision.reason }}</p>
              <details class="mt-auto border-t border-line pt-2 text-sm text-muted">
                <summary class="cursor-pointer font-medium hover:text-ink">
                  Preuve technique d’intégrité
                </summary>
                <p class="mt-1 tabular-nums">
                  Empreinte SHA-256 : {{ shortHash(revision.sha256) }}…
                </p>
              </details>
            </li>
          </ol>
        </div>

        <div class="space-y-3">
          <h2 class="section-title">Comparaison</h2>
          <div class="card grid gap-4 p-4 sm:grid-cols-2 sm:gap-x-6 sm:p-5">
            <SelectField
              :model-value="leftNo === null ? null : String(leftNo)"
              label="Révision de référence"
              placeholder="Aucune (voir une seule révision)"
              :options="options"
              @update:model-value="choose('left', $event)"
            />
            <SelectField
              :model-value="rightNo === null ? null : String(rightNo)"
              label="Révision à comparer"
              placeholder="Choisir une révision…"
              :options="options"
              required
              @update:model-value="choose('right', $event)"
            />
          </div>
        </div>

        <StateMessage v-if="loadingAny" state="loading" title="Chargement de la révision…" />
        <StateMessage
          v-for="failure in failures"
          :key="failure.revisionNo"
          state="offline"
          title="Révision indisponible"
        >
          Révision {{ failure.revisionNo }} : {{ failure.message }}
          <template #action>
            <AppButton variant="secondary" @click="retry(failure.revisionNo)">Réessayer</AppButton>
          </template>
        </StateMessage>

        <div v-if="right !== null && (!comparing || left !== null)" class="space-y-6">
          <div class="grid gap-3 sm:grid-cols-2">
            <div v-if="comparing && left" class="card space-y-1 p-4 text-sm">
              <p class="text-base font-semibold">Référence : révision {{ left.revision_no }}</p>
              <p class="text-muted">
                Enregistrée par {{ authorName(left) }} le {{ formatInstantFr(left.recorded_at) }}.
              </p>
              <p class="break-words">Motif : {{ left.reason }}</p>
            </div>
            <div class="card space-y-1 border-t-4 border-t-gold p-4 text-sm">
              <p class="text-base font-semibold">
                {{ comparing ? 'Comparée' : 'Révision' }} : révision {{ right.revision_no }}
              </p>
              <p class="text-muted">
                Enregistrée par {{ authorName(right) }} le {{ formatInstantFr(right.recorded_at) }}.
              </p>
              <p class="break-words">Motif : {{ right.reason }}</p>
            </div>
          </div>

          <div
            v-if="comparing"
            class="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between"
          >
            <p role="status" class="text-base font-medium text-ink">
              {{
                differences === 0
                  ? 'Aucune différence entre ces deux révisions.'
                  : `${differences} différence(s) entre ces deux révisions.`
              }}
            </p>
            <label class="flex min-h-11 items-center gap-3 text-base">
              <input v-model="onlyDifferences" type="checkbox" class="size-5 accent-primary" />
              Afficher seulement les différences
            </label>
          </div>

          <section v-for="group in stepsWithRows" :key="group.step" class="space-y-3">
            <h2 class="section-title">{{ STEP_TITLES[group.step] }}</h2>
            <ul class="space-y-2">
              <li
                v-for="row in group.rows"
                :key="`${row.step}-${row.key}`"
                :class="[
                  'rounded-xl border border-line bg-surface p-4 shadow-card',
                  row.kind === 'same' ? '' : 'border-l-4 border-l-gold',
                ]"
              >
                <dl
                  :class="[
                    'grid gap-2 sm:gap-4',
                    comparing
                      ? 'sm:grid-cols-[minmax(8rem,1fr)_2fr_2fr]'
                      : 'sm:grid-cols-[minmax(8rem,1fr)_4fr]',
                  ]"
                >
                  <div class="space-y-1">
                    <dt class="font-semibold">{{ row.label }}</dt>
                    <dd v-if="comparing">
                      <StatusChip :tone="CHANGE_TONES[row.kind]"
                        ><span aria-hidden="true">{{ CHANGE_SYMBOLS[row.kind] }}</span>
                        {{ CHANGE_LABELS[row.kind] }}</StatusChip
                      >
                    </dd>
                  </div>
                  <div v-if="comparing">
                    <dt class="text-sm text-muted">Révision {{ left?.revision_no }}</dt>
                    <dd class="break-words">{{ row.left }}</dd>
                  </div>
                  <div>
                    <dt class="text-sm text-muted">Révision {{ right.revision_no }}</dt>
                    <dd class="font-medium break-words">{{ row.right }}</dd>
                  </div>
                </dl>
                <p v-if="row.note" class="mt-2 text-sm font-medium text-warning">
                  <span aria-hidden="true">⚠ </span>{{ row.note }}
                </p>
              </li>
            </ul>
          </section>
        </div>
      </template>
    </template>
  </section>
</template>
