<script setup lang="ts">
/**
 * Statistiques du dossier patient (R02 ; fichier 02 « Historique et statistiques »), module « reports »,
 * EN LIGNE. Période : aujourd'hui, semaine (du lundi au dimanche), mois, année civils du cabinet, ou
 * intervalle personnalisé (bornes incluses, 366 jours au plus). Deux tableaux séparés par leurs droits :
 * l'activité de l'accueil (`statistics.activity`) et les examens (`statistics.clinical`) ; un compte ne
 * voit que ceux de ses droits. Chaque tableau donne ses définitions et le dénominateur de ses parts.
 * Présentation : choix de la période en segments (boutons à bascule) et intervalle personnalisé dans une
 * même carte, période affichée annoncée, puis les tableaux des droits du compte.
 */
import { computed, ref } from 'vue'

import { clinicToday, formatDayFr } from '@/app/clinicTime'
import { canOnScreen } from '@/app/session'
import DateField from '@/components/form/DateField.vue'
import PageHeader from '@/components/layout/PageHeader.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import LinkButton from '@/components/ui/LinkButton.vue'
import {
  PERIOD_LABELS,
  PERIOD_PRESETS,
  type PeriodPreset,
  periodError,
  presetPeriod,
} from '@/domain/reports/statistics'
import { CivilDate } from '@/domain/values/civilDate'

import ActivityStatistics from './ActivityStatistics.vue'
import Clinical from './Clinical.vue'

const showsActivity = computed(() => canOnScreen('statistics.activity'))
const showsClinical = computed(() => canOnScreen('statistics.clinical'))

const preset = ref<PeriodPreset | 'custom'>('month')
const initial = presetPeriod('month', clinicToday())
/** Période affichée (AAAA-MM-JJ), appliquée par les boutons ou par « Afficher ». */
const shown = ref({ from: initial.from.toString(), to: initial.to.toString() })
const customFrom = ref<string | null>(shown.value.from)
const customTo = ref<string | null>(shown.value.to)
const customError = ref<string | null>(null)

const title = computed(() => {
  const from = formatDayFr(CivilDate.fromString(shown.value.from))
  if (shown.value.from === shown.value.to) return `Période : ${from}`
  return `Période : du ${from} au ${formatDayFr(CivilDate.fromString(shown.value.to))}`
})

function choose(next: PeriodPreset): void {
  const period = presetPeriod(next, clinicToday())
  preset.value = next
  customError.value = null
  shown.value = { from: period.from.toString(), to: period.to.toString() }
  customFrom.value = shown.value.from
  customTo.value = shown.value.to
}

function parsed(value: string | null): CivilDate | null | 'invalid' {
  try {
    return CivilDate.parse(value)
  } catch {
    return 'invalid'
  }
}

function applyCustom(): void {
  const from = parsed(customFrom.value)
  const to = parsed(customTo.value)
  if (from === 'invalid' || to === 'invalid') {
    customError.value = 'Date invalide : JJ/MM/AAAA ou AAAA-MM-JJ.'
    return
  }
  const error = periodError(from, to)
  customError.value = error
  if (error !== null || from === null || to === null) return
  preset.value = 'custom'
  shown.value = { from: from.toString(), to: to.toString() }
}
</script>

<template>
  <section aria-labelledby="titre-statistiques" class="page-stack max-w-5xl">
    <PageHeader
      title-id="titre-statistiques"
      title="Statistiques"
      icon="chart"
      subtitle="Comptages du cabinet sur la période choisie, calculés par le serveur. Aucune information ne permet d’identifier un patient."
    >
      <template
        v-if="
          canOnScreen('finance.global.read') ||
          canOnScreen('stock.read') ||
          canOnScreen('workshop.manage') ||
          canOnScreen('statistics.activity') ||
          canOnScreen('statistics.clinical')
        "
        #actions
      >
        <LinkButton :to="{ name: 'rapports-gestion' }" variant="secondary">
          Rapports de gestion
        </LinkButton>
      </template>
    </PageHeader>

    <div role="group" aria-label="Choisir la période" class="card space-y-4 p-4 sm:p-5">
      <div
        class="grid grid-cols-2 gap-1 rounded-xl border border-line bg-canvas p-1 sm:flex sm:w-fit sm:max-w-full sm:flex-wrap"
      >
        <AppButton
          v-for="option in PERIOD_PRESETS"
          :key="option"
          variant="ghost"
          :pressed="preset === option"
          @click="choose(option)"
          >{{ PERIOD_LABELS[option] }}</AppButton
        >
      </div>
      <form class="toolbar border-t border-line pt-4" novalidate @submit.prevent="applyCustom">
        <div class="min-w-0 sm:flex-1">
          <DateField v-model="customFrom" label="Du" control-id="statistiques-debut" />
        </div>
        <div class="min-w-0 sm:flex-1">
          <DateField
            v-model="customTo"
            label="Au"
            control-id="statistiques-fin"
            :error="customError"
          />
        </div>
        <AppButton type="submit" variant="secondary" :pressed="preset === 'custom'"
          >Afficher la période</AppButton
        >
      </form>
    </div>

    <p role="status" class="flex items-center gap-2 text-lg font-semibold">
      <AppIcon name="calendar" :size="20" class="text-gold" />
      <span class="min-w-0">{{ title }}</span>
    </p>

    <ActivityStatistics v-if="showsActivity" :from="shown.from" :to="shown.to" />
    <Clinical v-if="showsClinical" :from="shown.from" :to="shown.to" />
  </section>
</template>
