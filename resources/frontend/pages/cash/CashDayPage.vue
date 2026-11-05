<script setup lang="ts">
/**
 * Caisse du jour (R01 minimal ; fichier 03 « Caisse et indicateurs » ; fichier 09), EN LIGNE : ce qui a
 * été encaissé un jour civil du cabinet, par mode, net des contre-écritures et des remboursements ; les
 * sessions de caisse du jour avec leur relevé. La portée vient des droits, décidée par le serveur :
 *  - gérante (`finance.global.read`) : tout le cabinet, factures et avoirs émis du jour, et reste à
 *    encaisser des factures ouvertes À L'INSTANT de la lecture ;
 *  - caissière : SES encaissements et SES sessions seulement (ni chiffre d'affaires, ni créances).
 * Aucun « payé » ni « soldé » : des montants encaissés et des restes à encaisser, tous du serveur. Une
 * lecture qui échoue est « indisponible », jamais « aucun encaissement ». Cartes, rien ne déborde à 360 px.
 */
import { computed, ref } from 'vue'

import { clinicTimeZone, clinicToday, formatDayFr, formatInstantFr } from '@/app/clinicTime'
import { getCashDayReport } from '@/app/services/billing'
import FreshnessNote from '@/components/feedback/FreshnessNote.vue'
import StateMessage from '@/components/feedback/StateMessage.vue'
import DateField from '@/components/form/DateField.vue'
import AppButton from '@/components/ui/AppButton.vue'
import LinkButton from '@/components/ui/LinkButton.vue'
import { accountLabel, dayCashNet, dayMethodRows, dayOtherNet } from '@/domain/billing/cashReport'
import type { CashDayReport } from '@/domain/contracts/generated'
import { CivilDate } from '@/domain/values/civilDate'
import { formatMoney, paymentMethodLabel } from '@/pages/sales/format'
import SalesReadMessage from '@/pages/sales/SalesReadMessage.vue'
import { useServerRead } from '@/pages/today/useServerRead'

import SessionReportButton from './SessionReportButton.vue'

const timeZone = clinicTimeZone()
const day = ref<string | null>(clinicToday().toString())
/** Jour lu : la saisie complète du champ, sinon aujourd'hui (le champ dit lui-même une saisie invalide). */
const requested = computed(() =>
  day.value !== null && /^\d{4}-\d{2}-\d{2}$/.test(day.value) ? day.value : null,
)

const read = useServerRead<CashDayReport>(() => getCashDayReport(requested.value))
const report = computed(() => read.data.value)
const rows = computed(() => (report.value === null ? [] : dayMethodRows(report.value)))
const clinicScope = computed(() => report.value?.scope === 'CLINIC')

const title = computed(() => {
  const shown = report.value?.date ?? requested.value
  if (shown === null) return 'Caisse du jour'
  const label = formatDayFr(CivilDate.fromString(shown))
  return shown === clinicToday().toString()
    ? `Caisse du jour : ${label} (aujourd’hui)`
    : `Caisse du ${label}`
})

function show(): void {
  void read.reload()
}

function today(): void {
  day.value = clinicToday().toString()
  void read.reload()
}

/** Écart de caisse dit avec son signe (« +500 FCFA » : compté supérieur à l'attendu). */
function signedVariance(amount: number): string {
  return amount > 0 ? `+${formatMoney(amount)}` : formatMoney(amount)
}
</script>

<template>
  <section aria-labelledby="titre-caisse-jour" class="max-w-3xl space-y-6">
    <h1 id="titre-caisse-jour" class="text-2xl font-semibold tracking-tight">{{ title }}</h1>

    <form
      role="search"
      aria-label="Choisir le jour"
      class="flex flex-col gap-3 sm:flex-row sm:items-start"
      @submit.prevent="show"
    >
      <div class="min-w-0 flex-1">
        <DateField v-model="day" label="Jour" control-id="caisse-jour-date" />
      </div>
      <AppButton type="submit" variant="secondary" class="field-action">Afficher</AppButton>
      <AppButton variant="ghost" class="field-action" @click="today">Aujourd’hui</AppButton>
    </form>

    <SalesReadMessage
      v-if="read.state.value !== 'ready'"
      :state="read.state.value"
      subject="la caisse du jour"
      :error="read.error.value"
      @retry="read.reload()"
    />

    <template v-if="report && read.state.value === 'ready'">
      <p v-if="!clinicScope" class="text-base text-muted">
        Vos encaissements et vos sessions seulement : le chiffre d’affaires et les créances du
        cabinet sont réservés à la gérante.
      </p>

      <section aria-labelledby="titre-encaissements" class="space-y-3">
        <h2 id="titre-encaissements" class="text-lg font-semibold">Encaissements nets par mode</h2>
        <StateMessage v-if="rows.length === 0" state="empty" title="Aucun encaissement ce jour-là">
          Le serveur n’a enregistré aucun encaissement, contre-écriture ni remboursement pour ce
          jour.
        </StateMessage>
        <ul v-else class="space-y-3">
          <li
            v-for="row in rows"
            :key="row.method"
            class="space-y-1 rounded-xl border border-line bg-surface shadow-card p-3"
          >
            <p class="flex flex-wrap items-baseline justify-between gap-x-3">
              <span class="font-semibold">{{ paymentMethodLabel(row.method) }}</span>
              <strong class="tabular-nums">{{ formatMoney(row.net) }}</strong>
            </p>
            <p class="text-sm text-muted">
              {{ row.count }} encaissement{{ row.count > 1 ? 's' : '' }} :
              {{ formatMoney(row.collected) }}
              <template v-if="row.reversed > 0">
                · contre-écritures −{{ formatMoney(row.reversed) }}</template
              >
              <template v-if="row.refunded > 0">
                · remboursements −{{ formatMoney(row.refunded) }}</template
              >
            </p>
          </li>
        </ul>
        <dl
          class="grid gap-x-6 gap-y-2 rounded-xl border border-line bg-surface shadow-card p-4 sm:grid-cols-3"
        >
          <div>
            <dt class="text-sm text-muted">Espèces (tiroir)</dt>
            <dd class="tabular-nums">{{ formatMoney(dayCashNet(report)) }}</dd>
          </div>
          <div>
            <dt class="text-sm text-muted">Autres modes (rapprochés à part)</dt>
            <dd class="tabular-nums">{{ formatMoney(dayOtherNet(report)) }}</dd>
          </div>
          <div>
            <dt class="text-base font-semibold">Total net encaissé</dt>
            <dd class="text-xl font-bold tabular-nums" data-montant="total-jour">
              {{ formatMoney(report.net_total) }}
            </dd>
          </div>
        </dl>
      </section>

      <section
        v-if="clinicScope && report.issued && report.outstanding"
        aria-labelledby="titre-ventes-jour"
        class="space-y-3"
      >
        <h2 id="titre-ventes-jour" class="text-lg font-semibold">
          Ventes du jour et reste à encaisser
        </h2>
        <dl
          class="grid gap-x-6 gap-y-3 rounded-xl border border-line bg-surface shadow-card p-4 sm:grid-cols-2"
        >
          <div>
            <dt class="text-sm text-muted">Factures émises ce jour</dt>
            <dd class="tabular-nums">
              {{ report.issued.count }} · {{ formatMoney(report.issued.total_gross) }}
            </dd>
          </div>
          <div v-if="report.credited">
            <dt class="text-sm text-muted">Avoirs émis ce jour</dt>
            <dd class="tabular-nums">
              {{ report.credited.count }} · {{ formatMoney(report.credited.amount_gross) }}
            </dd>
          </div>
          <div>
            <dt class="text-sm text-muted">Reste à encaisser (factures ouvertes)</dt>
            <dd class="font-semibold tabular-nums">
              {{ formatMoney(report.outstanding.amount_due) }}
              <span class="font-normal">
                ({{ report.outstanding.invoices_count }} facture{{
                  report.outstanding.invoices_count > 1 ? 's' : ''
                }})</span
              >
            </dd>
          </div>
          <div v-if="report.outstanding.refundable_credit > 0">
            <dt class="text-sm text-muted">Crédits à rembourser</dt>
            <dd class="tabular-nums">{{ formatMoney(report.outstanding.refundable_credit) }}</dd>
          </div>
        </dl>
        <p class="text-sm text-muted">
          Reste à encaisser à l’instant de la lecture ({{ formatInstantFr(report.generated_at) }}),
          toutes factures émises confondues.
        </p>
        <LinkButton :to="{ name: 'factures' }" variant="secondary">Voir les factures</LinkButton>
      </section>

      <section aria-labelledby="titre-sessions-jour" class="space-y-3">
        <h2 id="titre-sessions-jour" class="text-lg font-semibold">Sessions de caisse du jour</h2>
        <StateMessage
          v-if="report.sessions.length === 0"
          state="empty"
          title="Aucune session de caisse ce jour-là"
        >
          Aucune session n’était ouverte ce jour-là{{ clinicScope ? '' : ' pour votre compte' }}.
        </StateMessage>
        <ul v-else class="space-y-3">
          <li
            v-for="session in report.sessions"
            :key="session.id"
            class="space-y-2 rounded-xl border border-line bg-surface shadow-card p-3"
          >
            <p class="flex flex-wrap items-baseline justify-between gap-x-3">
              <span class="font-semibold break-words">{{
                accountLabel(session.cashier_name, session.cashier_id)
              }}</span>
              <span>{{ session.closed_at === null ? 'Ouverte' : 'Clôturée' }}</span>
            </p>
            <p class="text-sm text-muted break-words">
              {{ session.register_name ?? 'Caisse' }} · ouverte le
              {{ formatInstantFr(session.opened_at) }}
              <template v-if="session.closed_at">
                · clôturée le {{ formatInstantFr(session.closed_at) }}</template
              >
            </p>
            <p class="text-base">
              Fond {{ formatMoney(session.opening_amount) }} · espèces encaissées
              {{ formatMoney(session.collected_cash) }} ·
              <template v-if="session.closed_at === null">
                attendu {{ formatMoney(session.theoretical_cash) }}</template
              >
              <template v-else>
                écart
                <strong class="tabular-nums">{{
                  signedVariance(session.variance ?? 0)
                }}</strong></template
              >
            </p>
            <SessionReportButton
              :session-id="session.id"
              label="Relevé (PDF)"
              :context="`de ${accountLabel(session.cashier_name, session.cashier_id)}`"
            />
          </li>
        </ul>
      </section>

      <FreshnessNote
        v-if="read.freshness.value"
        :freshness="read.freshness.value"
        :time-zone="timeZone"
      />
    </template>

    <LinkButton :to="{ name: 'caisse' }" variant="ghost">Retour à la caisse</LinkButton>
  </section>
</template>
