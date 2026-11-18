<script setup lang="ts">
/**
 * Activité administrative (R02, `statistics.activity` : gérante, accueil) : visites, patients distincts,
 * nouveaux et anciens, sexe et tranches d'âge, lus sur le serveur pour la période choisie. Aucune donnée
 * clinique ni financière. Rendez-vous et patients à revoir : « non disponible » tant que l'agenda n'est
 * pas livré (jamais un zéro inventé). Une lecture qui échoue est « indisponible », jamais « aucune visite ».
 * Présentation : chiffres clés en tuiles, tableaux de comptage en cartes (deux colonnes sur ordinateur),
 * tuiles de l'agenda « — » avec leur explication tant que la valeur n'existe pas.
 */
import { computed, watch } from 'vue'

import { clinicTimeZone } from '@/app/clinicTime'
import { getActivityReport } from '@/app/services/reports'
import FreshnessNote from '@/components/feedback/FreshnessNote.vue'
import SectionCard from '@/components/layout/SectionCard.vue'
import StatTile from '@/components/layout/StatTile.vue'
import type { ActivityReport } from '@/domain/contracts/generated'
import { sexLabel } from '@/domain/patients/identity'
import { reasonLabel } from '@/domain/patients/visits'
import { ACTIVITY_DEFINITIONS, ageBandLabel } from '@/domain/reports/statistics'
import SalesReadMessage from '@/pages/sales/SalesReadMessage.vue'
import { useServerRead } from '@/pages/today/useServerRead'

import CountTable, { type CountRow } from './CountTable.vue'

const props = defineProps<{ from: string; to: string }>()

const timeZone = clinicTimeZone()
const read = useServerRead<ActivityReport>(() => getActivityReport(props.from, props.to))
watch(
  () => `${props.from}\u{1F}${props.to}`,
  () => void read.reload(),
)
const report = computed(() => read.data.value)

const reasons = computed<CountRow[]>(() =>
  (report.value?.visits_by_reason ?? []).map((row) => ({
    key: row.reason,
    label: reasonLabel(row.reason),
    count: row.count,
  })),
)
const patients = computed<CountRow[]>(() =>
  report.value === null
    ? []
    : [
        { key: 'new', label: 'Nouveaux patients', count: report.value.new_patients },
        { key: 'returning', label: 'Anciens patients', count: report.value.returning_patients },
      ],
)
const sexes = computed<CountRow[]>(() =>
  (report.value?.sex ?? []).map((row) => ({
    key: row.sex,
    label: sexLabel(row.sex),
    count: row.count,
  })),
)
const ages = computed<CountRow[]>(() =>
  report.value === null
    ? []
    : [
        ...report.value.age_bands.map((band) => ({
          key: `age-${band.min_age}`,
          label: ageBandLabel(band.min_age, band.max_age),
          count: band.count,
        })),
        { key: 'age-unknown', label: 'Âge non renseigné', count: report.value.age_unknown },
      ],
)
</script>

<template>
  <section aria-labelledby="titre-stat-activite" class="space-y-5">
    <h2 id="titre-stat-activite" class="section-title text-xl">Activité de l’accueil</h2>

    <SalesReadMessage
      v-if="read.state.value !== 'ready'"
      :state="read.state.value"
      subject="l’activité de la période"
      :error="read.error.value"
      @retry="read.reload()"
    />

    <template v-if="report">
      <dl class="stat-grid">
        <StatTile label="Visites" :value="report.visits" icon="today" tone="gold" />
        <StatTile label="Patients de la période" :value="report.patients" icon="patients" />
        <StatTile label="Nouveaux patients" :value="report.new_patients" icon="user-plus" />
      </dl>

      <div class="grid gap-4 lg:grid-cols-2">
        <CountTable
          caption="Visites par motif"
          :rows="reasons"
          :denominator="report.visits"
          denominator-label="visites"
          empty-text="Aucune visite sur la période."
        />
        <CountTable
          caption="Nouveaux et anciens patients"
          :rows="patients"
          :denominator="report.patients"
          denominator-label="patients de la période"
        />
        <CountTable
          caption="Répartition par sexe"
          :rows="sexes"
          :denominator="report.patients"
          denominator-label="patients de la période"
        />
        <CountTable
          caption="Tranches d’âge"
          :rows="ages"
          :denominator="report.patients"
          denominator-label="patients de la période"
        />
      </div>

      <dl class="stat-grid stat-grid-wide">
        <StatTile
          label="Rendez-vous programmés"
          :value="report.appointments"
          icon="calendar"
          unavailable-text="Consultable dans le module Agenda"
        />
        <StatTile
          label="Patients à revoir"
          :value="report.follow_ups_due"
          icon="history"
          unavailable-text="Consultable dans Patients à rappeler"
        />
      </dl>

      <SectionCard flat title="Définitions" heading-level="h3" icon="info">
        <ul role="list" class="max-w-prose space-y-2 text-sm text-muted">
          <li v-for="definition in ACTIVITY_DEFINITIONS" :key="definition" class="flex gap-2">
            <span aria-hidden="true" class="mt-2 size-1.5 shrink-0 rounded-full bg-gold"></span>
            <span class="min-w-0">{{ definition }}</span>
          </li>
        </ul>
      </SectionCard>
      <FreshnessNote
        v-if="read.freshness.value"
        :freshness="read.freshness.value"
        :time-zone="timeZone"
      />
    </template>
  </section>
</template>
