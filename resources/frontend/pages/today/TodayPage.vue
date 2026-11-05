<script setup lang="ts">
/**
 * Aujourd'hui (P03 ; fichier 02 : « File patients » ; fichier 04 : écran « Aujourd'hui », AT05). La
 * file du jour des arrivées du cabinet, lue sur le serveur : jour civil du cabinet par défaut (jamais un
 * minuit UTC), jour précédent ou suivant, ou une date saisie. « Enregistrer une arrivée » n'apparaît
 * qu'avec le droit visit.register ; la file elle-même se lit avec visit.register OU agenda.read.
 *
 * Contrôle du paiement de l'examen INACTIF (défaut) : l'écran le dit en toutes lettres et n'affirme
 * jamais qu'un examen est réglé, soldé ou gratuit ; « Démarrer l'examen » (C01) n'est PAS bloqué par le
 * règlement. Contrôle ACTIF (`clinic.exam_fee_control = BILLED`, P03 avec B04 et B06) : l'écran dit que
 * l'examen ne démarre qu'avec la facture de frais de la visite encaissée ou une dispense accordée par la
 * gérante ; chaque visite porte son marqueur (voir `VisitQueue`). Un achat ou un retrait n'impose aucun
 * examen.
 *
 * Présentation (charte du logo) : en-tête d'écran avec la date civile du cabinet au-dessus du titre,
 * encadré du contrôle du paiement de l'examen, barre de choix du jour en carte, puis la file.
 */
import { computed, ref } from 'vue'

import { clinicToday, formatDayFr } from '@/app/clinicTime'
import { can, canOnScreen, examFeeControlledOnScreen, moduleOpenOnScreen } from '@/app/session'
import StateMessage from '@/components/feedback/StateMessage.vue'
import DateField from '@/components/form/DateField.vue'
import PageHeader from '@/components/layout/PageHeader.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import LinkButton from '@/components/ui/LinkButton.vue'
import { CivilDate } from '@/domain/values/civilDate'
import { shiftDay } from '@/domain/patients/visits'

import { takeArrivalFlash } from './flash'
import VisitQueue from './VisitQueue.vue'

const flash = takeArrivalFlash()

/** Jour affiché (`AAAA-MM-JJ`) : le jour civil du cabinet à l'ouverture de l'écran. */
const day = ref(clinicToday().toString())
const page = ref(1)
/** Incrémenté pour relire la même page (actualiser, « Aujourd'hui » déjà affiché). */
const run = ref(0)
/** Remonte le champ de date quand un bouton change le jour : une saisie refusée ne reste pas affichée. */
const fieldKey = ref(0)
const focusResults = ref(false)
const announcement = ref('')

const canRegister = computed(() => can('visit.register'))
/** La mention de « Démarrer l'examen » n'a de sens que pour qui peut le faire, module ouvert (C01). */
const mentionsExamStart = computed(
  () => canOnScreen('clinical.write') && moduleOpenOnScreen('consultations'),
)
/** Le serveur contrôle réellement le paiement de l'examen (`/auth/me`). */
const examFeeControlled = computed(() => examFeeControlledOnScreen())
const queueKey = computed(() => `${day.value}\u{1F}${page.value}\u{1F}${run.value}`)
const isToday = computed(() => day.value === clinicToday().toString())
/** Date civile du cabinet à l'ouverture de l'écran, au-dessus du titre (« jeudi 15 octobre 2026 »). */
const todayLabel = formatDayFr(clinicToday())
const title = computed(() => {
  const label = formatDayFr(CivilDate.fromString(day.value))
  return isToday.value ? `File du jour : ${label} (aujourd’hui)` : `File du jour : ${label}`
})

/** Affiche un autre jour (première page) ; `remountField` remet le champ de date à ce jour. */
function show(newDay: string, remountField: boolean): void {
  announcement.value = 'Chargement de la file du jour…'
  focusResults.value = false
  day.value = newDay
  page.value = 1
  run.value += 1
  if (remountField) fieldKey.value += 1
}

function shift(days: number): void {
  const next = shiftDay(day.value, days)
  if (next !== null) show(next, true)
}

function showToday(): void {
  show(clinicToday().toString(), true)
}

function refresh(): void {
  announcement.value = 'Actualisation de la file du jour…'
  focusResults.value = false
  run.value += 1
}

/** Date saisie et lue par le champ : un champ vidé ou refusé (null) ne change pas le jour affiché. */
function chooseDay(chosen: string | null): void {
  if (chosen === null || chosen === day.value) return
  show(chosen, false)
}

function goToPage(next: number): void {
  announcement.value = 'Chargement de la page…'
  focusResults.value = true
  page.value = next
}
</script>

<template>
  <section aria-labelledby="titre-aujourdhui" class="page-stack">
    <PageHeader
      title-id="titre-aujourdhui"
      title="Aujourd’hui"
      icon="today"
      :eyebrow="todayLabel"
      subtitle="Arrivées du cabinet, état de chaque visite et suite à donner."
    >
      <template v-if="canRegister" #actions>
        <LinkButton :to="{ name: 'arrivee' }" variant="primary"
          ><AppIcon name="arrival" :size="18" />Enregistrer une arrivée</LinkButton
        >
      </template>
    </PageHeader>

    <StateMessage v-if="flash" state="success" :title="flash" />

    <div class="card flex items-start gap-3 p-4 sm:gap-4 sm:p-5">
      <div
        aria-hidden="true"
        :class="[
          'flex size-9 shrink-0 items-center justify-center rounded-lg',
          examFeeControlled ? 'bg-accent-soft text-accent' : 'bg-warning-soft text-warning',
        ]"
      >
        <AppIcon :name="examFeeControlled ? 'shield' : 'alert'" :size="18" />
      </div>
      <p v-if="examFeeControlled" class="max-w-prose text-muted">
        Les frais d’examen sont contrôlés : un examen de vue ou un contrôle de suivi ne démarre
        qu’avec la facture de frais de la visite encaissée, ou une dispense accordée par la gérante.
        Un achat direct ou un retrait de commande n’impose aucun examen.
      </p>
      <p v-else class="max-w-prose text-muted">
        Le contrôle du paiement de l’examen n’est pas encore actif. Une arrivée pour un examen de
        vue ou un contrôle de suivi n’est donc pas bloquée faute de règlement, et cet écran ne dit
        rien de l’état du règlement de l’examen.
        <template v-if="mentionsExamStart">
          Démarrer l’examen n’est pas non plus bloqué par le règlement.
        </template>
        Un achat direct ou un retrait de commande n’impose aucun examen.
      </p>
    </div>

    <div role="group" aria-label="Choisir le jour affiché" class="card toolbar p-4 sm:p-5">
      <!-- Deux blocs pleine largeur (`w-full`), quelle que soit la largeur du texte (la CI Linux a des
           polices plus larges que Windows) : la navigation du jour, seule sur sa ligne et sans
           décalage d'étiquette ; puis la date et « Actualiser la file », empilées jusqu'à 1024 px
           (à côté du menu, la colonne de la date rétrécit et son étiquette passerait sur deux lignes,
           ce qui décalerait la saisie du bouton) et côte à côte, alignés sur la saisie, au-delà. -->
      <div class="flex w-full flex-wrap gap-2 *:grow sm:*:grow-0">
        <AppButton variant="secondary" @click="shift(-1)"
          ><AppIcon name="chevron-left" :size="18" />Jour précédent</AppButton
        >
        <AppButton variant="secondary" @click="showToday">Aujourd’hui</AppButton>
        <AppButton variant="secondary" @click="shift(1)"
          >Jour suivant<AppIcon name="chevron-right" :size="18"
        /></AppButton>
      </div>
      <div class="flex w-full flex-col gap-3 lg:flex-row lg:items-start">
        <div class="min-w-0 sm:w-56">
          <DateField
            :key="fieldKey"
            label="Jour affiché"
            :model-value="day"
            field="date"
            control-id="aujourdhui-jour"
            required
            @update:model-value="chooseDay"
          />
        </div>
        <AppButton
          variant="ghost"
          class="sm:self-start lg:mt-(--field-label-offset) lg:ml-auto lg:self-auto"
          @click="refresh"
          ><AppIcon name="refresh" :size="18" />Actualiser la file</AppButton
        >
      </div>
    </div>

    <p role="status" aria-live="polite" class="sr-only">{{ announcement }}</p>

    <VisitQueue
      :key="queueKey"
      :date="day"
      :page="page"
      :title="title"
      :focus-on-load="focusResults"
      @page="goToPage"
      @summary="announcement = $event"
    />
  </section>
</template>
