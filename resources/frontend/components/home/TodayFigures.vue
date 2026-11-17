<script setup lang="ts">
/**
 * Tuiles du bandeau « Aujourd’hui » de l'accueil (voir `TodaySummary`), lues EN LIGNE sur le
 * serveur pour le jour civil du cabinet (jamais un minuit UTC). Une lecture par source, créée
 * seulement pour les tuiles ouvertes au compte : le parent remonte ce bloc quand elles changent.
 * Chaque tuile a son propre état (lecture en cours, valeur du serveur, ou « — » avec la raison
 * écrite) : un échec n'empêche pas les autres, aucun zéro n'est inventé et une valeur ancienne
 * n'est pas reprise après un échec.
 *  - File du jour : patients en attente (arrivés, frais d'examen attendus, prêts pour l'examen), en
 *    consultation, visites terminées ; une file plus longue que la lecture plafonnée donne des
 *    minimums.
 *  - Rendez-vous du jour qui ne sont pas annulés.
 *  - Encaissé net du jour (`net_total` du serveur : encaissements moins contre-écritures et
 *    remboursements), mis en forme par `formatMoney`, sans aucun calcul ; la portée (tout le
 *    cabinet ou ses propres encaissements) est décidée par le serveur.
 * L'heure de la plus ancienne réponse affichée est indiquée sous le titre. Une réponse 401 ou 419
 * fait relire la session : l'accueil dit alors « Session expirée ».
 */
import { computed, ref, watch } from 'vue'

import { clinicToday, formatTimeFr } from '@/app/clinicTime'
import { listAppointments } from '@/app/services/agenda'
import { getCashDayReport } from '@/app/services/billing'
import { type ReadState, useRead } from '@/app/services/reads'
import { listStockAlerts } from '@/app/services/stockAlerts'
import { type DayVisits, listDayVisits } from '@/app/services/visits'
import { revalidateSession } from '@/app/session'
import StatTile, { type StatTone } from '@/components/layout/StatTile.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import type { Appointment, CashDayReport, StockAlertPage } from '@/domain/contracts/generated'
import { formatMoney } from '@/domain/values/money'

import { activeAppointmentCount, queueCounts } from './todayFigures'

const props = withDefaults(
  defineProps<{
    /** File du jour lisible : `visit.register` ou `agenda.read`, module « today ». */
    queue: boolean
    /** Rendez-vous lisibles : `agenda.read`, module « agenda ». */
    appointments: boolean
    /** Caisse du jour lisible : `finance.global.read` ou `cash.own_session`, module « sales ». */
    cash: boolean
    /** Alertes de stock lisibles : `stock.read`, module « stock ». */
    stockAlerts?: boolean
  }>(),
  { stockAlerts: false },
)

/** Jour civil du cabinet des lectures (`AAAA-MM-JJ`), relu à chaque actualisation. */
const day = ref(clinicToday().toString())

// Lectures créées une seule fois, pour les tuiles ouvertes au montage (le parent remonte ce bloc).
const queueRead = props.queue ? useRead<DayVisits>(() => listDayVisits(day.value)) : null
const appointmentsRead = props.appointments
  ? useRead<Appointment[]>(() => listAppointments(day.value, day.value))
  : null
const cashRead = props.cash ? useRead<CashDayReport>(() => getCashDayReport(day.value)) : null
const lowStockAlertsRead = props.stockAlerts
  ? useRead<StockAlertPage>(() => listStockAlerts({ status: 'OPEN', kind: 'LOW_STOCK', page: 1 }))
  : null
const expiryAlertsRead = props.stockAlerts
  ? useRead<StockAlertPage>(() => listStockAlerts({ status: 'OPEN', kind: 'EXPIRY', page: 1 }))
  : null

/** Ce que le bandeau suit de chaque lecture : son état, l'heure de sa réponse, sa relance. */
interface TileRead {
  readonly state: { readonly value: ReadState }
  readonly freshness: { readonly value: { readonly serverAsOf: string | null } | null }
  reload: () => Promise<void>
}

/** Lecture dont la donnée s'affiche dans une tuile. */
interface DataRead<T> extends TileRead {
  readonly data: { readonly value: T | null }
}

const reads: TileRead[] = []
if (queueRead !== null) reads.push(queueRead)
if (appointmentsRead !== null) reads.push(appointmentsRead)
if (cashRead !== null) reads.push(cashRead)
if (lowStockAlertsRead !== null) reads.push(lowStockAlertsRead)
if (expiryAlertsRead !== null) reads.push(expiryAlertsRead)

/** Explication écrite d'une tuile sans valeur, selon l'état de sa lecture. */
const UNAVAILABLE: Readonly<Record<Exclude<ReadState, 'ready' | 'empty'>, string>> = {
  loading: 'Lecture en cours…',
  offline: 'Serveur indisponible pour l’instant',
  forbidden: 'Non autorisé pour ce compte',
  'session-expired': 'Session à rouvrir',
  error: 'Lecture impossible',
}

function unavailableText(read: TileRead | null): string {
  const state = read?.state.value ?? 'loading'
  return state === 'ready' || state === 'empty' ? UNAVAILABLE.error : UNAVAILABLE[state]
}

/** Donnée de la lecture si elle vient de réussir ; après un échec, aucune valeur ancienne. */
function readyData<T>(read: DataRead<T> | null): T | null {
  return read !== null && read.state.value === 'ready' ? read.data.value : null
}

const queueFigures = computed(() => {
  const data = readyData(queueRead)
  return data === null ? null : { ...queueCounts(data.visits), partial: data.truncated }
})
/** File plus longue que la lecture plafonnée : les chiffres lus sont des minimums. */
const queueHint = computed(() => {
  if (queueFigures.value?.partial !== true) return undefined
  return 'Au moins ce nombre : file lue en partie'
})

const appointmentCount = computed(() => {
  const list = readyData(appointmentsRead)
  return list === null ? null : activeAppointmentCount(list)
})

const report = computed(() => readyData(cashRead))
/** Montant net du serveur (FCFA entiers) affiché tel quel ; un solde négatif garde son signe. */
const cashValue = computed(() => {
  if (report.value === null) return null
  return formatMoney(report.value.net_total)
})
const cashTone = computed<StatTone>(() => {
  if (report.value === null) return 'success'
  return report.value.net_total < 0 ? 'warning' : 'success'
})
const cashHint = computed(() => {
  if (report.value === null) return undefined
  return report.value.scope === 'CLINIC' ? 'Tout le cabinet' : 'Vos encaissements seulement'
})

const lowStockAlertCount = computed(() => readyData(lowStockAlertsRead)?.meta.total ?? null)
const expiryAlertCount = computed(() => readyData(expiryAlertsRead)?.meta.total ?? null)

/** Heure de la plus ancienne réponse affichée (« 10h42 ») ; null sans aucune valeur affichée. */
const readAt = computed(() => {
  const answered = reads
    .filter((read) => read.state.value === 'ready')
    .map((read) => read.freshness.value?.serverAsOf ?? null)
    .filter((instant) => instant !== null)
    .sort()
  const first = answered[0]
  return first === undefined ? null : formatTimeFr(first)
})

const readLine = computed(() => {
  if (readAt.value !== null) return `Chiffres du serveur, lus à ${readAt.value}`
  return reads.some((read) => read.state.value === 'loading')
    ? 'Lecture des chiffres du serveur…'
    : 'Chiffres du serveur non lus'
})

/** Annonce discrète, seulement après une actualisation demandée. */
const announcement = ref('')

const sessionExpired = computed(() => reads.some((read) => read.state.value === 'session-expired'))
watch(sessionExpired, (expired) => {
  if (expired) void revalidateSession().catch(() => undefined)
})

/** Relit chaque tuile pour le jour civil du cabinet à cet instant (après minuit, le suivant). */
function refresh(): void {
  announcement.value = ''
  day.value = clinicToday().toString()
  void Promise.all(reads.map((read) => read.reload())).then(() => {
    announcement.value = readLine.value
  })
}
</script>

<template>
  <section aria-labelledby="titre-accueil-jour" class="space-y-4">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div class="min-w-0 space-y-1">
        <h2 id="titre-accueil-jour" class="section-title">Aujourd’hui</h2>
        <p class="flex items-center gap-1.5 text-sm text-muted">
          <AppIcon name="clock" :size="16" />{{ readLine }}
        </p>
      </div>
      <AppButton variant="secondary" @click="refresh"
        ><AppIcon name="refresh" :size="18" />Actualiser les chiffres</AppButton
      >
    </div>
    <p role="status" class="sr-only">{{ announcement }}</p>

    <dl v-if="queueRead !== null || appointmentsRead !== null" class="stat-grid">
      <template v-if="queueRead !== null">
        <StatTile
          label="Patients en attente"
          :value="queueFigures === null ? null : queueFigures.waiting"
          :unavailable-text="unavailableText(queueRead)"
          :hint="queueHint"
          icon="clock"
          tone="gold"
          :to="{ name: 'aujourdhui' }"
          link-label="Voir la file du jour"
        />
        <StatTile
          label="En consultation"
          :value="queueFigures === null ? null : queueFigures.inConsultation"
          :unavailable-text="unavailableText(queueRead)"
          :hint="queueHint"
          icon="stethoscope"
        />
        <StatTile
          label="Visites terminées"
          :value="queueFigures === null ? null : queueFigures.completed"
          :unavailable-text="unavailableText(queueRead)"
          :hint="queueHint"
          icon="check-circle"
          tone="success"
        />
      </template>
      <StatTile
        v-if="appointmentsRead !== null"
        label="Rendez-vous"
        :value="appointmentCount"
        :unavailable-text="unavailableText(appointmentsRead)"
        :hint="appointmentCount === null ? undefined : 'Hors rendez-vous annulés'"
        icon="calendar"
        :to="{ name: 'agenda' }"
        link-label="Voir l’agenda"
      />
    </dl>

    <dl
      v-if="cashRead !== null || (lowStockAlertsRead !== null && expiryAlertsRead !== null)"
      class="stat-grid stat-grid-wide lg:grid-cols-3"
    >
      <StatTile
        v-if="cashRead !== null"
        label="Encaissé net"
        :value="cashValue"
        :unavailable-text="unavailableText(cashRead)"
        :hint="cashHint"
        icon="wallet"
        :tone="cashTone"
        :to="{ name: 'caisse-du-jour' }"
        link-label="Voir la caisse du jour"
      />
      <StatTile
        v-if="lowStockAlertsRead !== null"
        label="Alertes stock bas"
        :value="lowStockAlertCount"
        :unavailable-text="unavailableText(lowStockAlertsRead)"
        :hint="lowStockAlertCount === null ? undefined : 'Seuils centraux ouverts'"
        icon="alert"
        :tone="lowStockAlertCount !== null && lowStockAlertCount > 0 ? 'warning' : 'success'"
        :to="{ name: 'stock-alerts' }"
        link-label="Voir les alertes"
      />
      <StatTile
        v-if="expiryAlertsRead !== null"
        label="Alertes péremption"
        :value="expiryAlertCount"
        :unavailable-text="unavailableText(expiryAlertsRead)"
        :hint="expiryAlertCount === null ? undefined : 'Lots expirés ou à surveiller'"
        icon="clock"
        :tone="expiryAlertCount !== null && expiryAlertCount > 0 ? 'danger' : 'success'"
        :to="{ name: 'stock-alerts' }"
        link-label="Voir les alertes"
      />
    </dl>
  </section>
</template>
