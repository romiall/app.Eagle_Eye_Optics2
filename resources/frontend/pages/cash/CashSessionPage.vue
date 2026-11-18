<script setup lang="ts">
/**
 * Caisse (B05 ; fichier 03 « Caisse et indicateurs » ; AT25), EN LIGNE : session ouverte du compte,
 * ouverture avec un fond de caisse, clôture avec le compté. Un encaissement en espèces n'est possible
 * que dans une session ouverte de son auteur : l'écran le dit. L'attendu affiché est la projection du
 * serveur à la lecture ; à la clôture, le serveur le recalcule sous verrou et refuse un attendu changé
 * depuis l'affichage (409, nouvel attendu) : le compté saisi est conservé, la caissière recompte.
 * L'écart est dit sans jugement ; un écart non nul exige un motif. Une session clôturée est figée.
 *
 * Droits : `cash.own_session` pour sa propre session. La gérante (`cash.manage`) voit les sessions de
 * toutes les caisses (`CashSessionsManager`), en lit les relevés et clôture la session d'une autre
 * caissière. Relevé de sa session en PDF (provisoire tant qu'elle est ouverte) ; « Caisse du jour »
 * résume les encaissements du jour par mode.
 */
import { computed, ref, shallowRef, watch } from 'vue'

import { clinicTimeZone, formatInstantFr } from '@/app/clinicTime'
import { getCurrentCashSession, listCashRegisters } from '@/app/services/billing'
import type { MutationOutcome } from '@/app/services/mutations'
import type { ReadOutcome } from '@/app/services/reads'
import { useMutation } from '@/app/services/useMutation'
import { canOnScreen, revalidateSession } from '@/app/session'
import { useUnsavedChangesGuard } from '@/app/unsavedChanges'
import ConfirmDialog from '@/components/feedback/ConfirmDialog.vue'
import ErrorSummary, { type FieldErrorItem } from '@/components/feedback/ErrorSummary.vue'
import FreshnessNote from '@/components/feedback/FreshnessNote.vue'
import SaveStatus from '@/components/feedback/SaveStatus.vue'
import StateMessage from '@/components/feedback/StateMessage.vue'
import MoneyField from '@/components/form/MoneyField.vue'
import SelectField from '@/components/form/SelectField.vue'
import TextAreaField from '@/components/form/TextAreaField.vue'
import AppButton from '@/components/ui/AppButton.vue'
import LinkButton from '@/components/ui/LinkButton.vue'
import {
  buildCloseSessionPayload,
  buildOpenSessionPayload,
  cashVariance,
  validateClosing,
  VARIANCE_REASON_MAX_LENGTH,
  varianceDescription,
} from '@/domain/billing/cash'
import type { CashRegister, CashSession, CashSessionResponse } from '@/domain/contracts/generated'
import { currentInstant } from '@/domain/patients/visits'
import { formatMoney } from '@/domain/values/money'
import { salesFailureView } from '@/pages/sales/failureView'
import SalesReadMessage from '@/pages/sales/SalesReadMessage.vue'
import { useServerRead } from '@/pages/today/useServerRead'

import CashSessionsManager from './CashSessionsManager.vue'
import Expenses from './Expenses.vue'
import SessionReportButton from './SessionReportButton.vue'

interface CashView {
  registers: CashRegister[]
  session: CashSession | null
}

const FIELD_IDS = {
  register: 'caisse-poste',
  opening: 'caisse-fond',
  counted: 'caisse-compte',
  reason: 'caisse-motif',
} as const

async function loadCash(): Promise<ReadOutcome<CashView>> {
  const [registers, current] = await Promise.all([listCashRegisters(), getCurrentCashSession()])
  return {
    data: { registers: registers.data, session: current.data },
    freshness: current.freshness,
    live: true,
  }
}

const read = useServerRead<CashView>(loadCash)
const timeZone = clinicTimeZone()
const openMutation = useMutation()
const closeMutation = useMutation()

const registers = computed(() => read.data.value?.registers ?? [])
const session = computed(() => read.data.value?.session ?? null)
const ready = computed(() => read.data.value !== null)
const isManager = computed(() => canOnScreen('cash.manage'))

/** Session close rendue par le serveur à la clôture : photographie figée. */
const closed = shallowRef<CashSession | null>(null)

// --- Ouverture ------------------------------------------------------------------------------------

const registerId = ref<string | null>(null)
const openingAmount = ref<number | null>(null)
const openingField = ref<{ commit: () => boolean } | null>(null)
const openErrors = ref<FieldErrorItem[]>([])
const openSummary = ref<{ focus: () => Promise<void> } | null>(null)
/** Refus d'état à l'ouverture (session déjà ouverte) : dit au-dessus de la session relue. */
const openNotice = ref<string | null>(null)

watch(
  registers,
  (list) => {
    const first = list[0]
    if (registerId.value === null && list.length === 1 && first !== undefined) {
      registerId.value = first.id
    }
  },
  { immediate: true },
)

const registerOptions = computed(() =>
  registers.value.map((register) => ({ value: register.id, label: register.name })),
)
const registerName = computed(
  () =>
    registers.value.find((register) => register.id === session.value?.cash_register_id)?.name ??
    'Caisse',
)
const openFailure = computed(() => salesFailureView(openMutation.state.value))
const opening = computed(() => openMutation.state.value === 'saving')

function fieldError(errors: readonly FieldErrorItem[], fieldId: string): string | null {
  return errors.find((item) => item.fieldId === fieldId)?.message ?? null
}

function serverErrors(
  fields: Readonly<Record<string, readonly string[]>>,
  map: Readonly<Record<string, string>>,
  fallbackField: string,
  fallback: string,
): FieldErrorItem[] {
  const items: FieldErrorItem[] = []
  for (const [key, messages] of Object.entries(fields)) {
    const message = messages[0]
    if (message !== undefined) items.push({ fieldId: map[key] ?? fallbackField, message })
  }
  return items.length > 0 ? items : [{ fieldId: fallbackField, message: fallback }]
}

async function afterOpen(result: MutationOutcome): Promise<void> {
  switch (result.kind) {
    case 'synced':
      closed.value = null
      openingAmount.value = null
      await read.reload()
      return
    case 'refused':
    case 'conflict':
      if (result.error.code === 'STATE_TRANSITION_REFUSED') {
        // Une session est déjà ouverte (autre onglet, autre poste) : elle est relue et affichée.
        openNotice.value = result.error.message
        await read.reload()
        return
      }
      openErrors.value = serverErrors(
        result.error.fields,
        { cash_register_id: FIELD_IDS.register, opening_amount: FIELD_IDS.opening },
        FIELD_IDS.opening,
        result.error.message,
      )
      await openSummary.value?.focus()
      return
    case 'session-expired':
    case 'reauthentication-required':
      void revalidateSession().catch(() => undefined)
      return
    default:
      return
  }
}

async function openSession(): Promise<void> {
  if (opening.value) return
  openErrors.value = []
  const committed = openingField.value?.commit() ?? true
  const errors: FieldErrorItem[] = []
  if (registerId.value === null) {
    errors.push({ fieldId: FIELD_IDS.register, message: 'Choisissez la caisse.' })
  }
  if (!committed || openingAmount.value === null) {
    errors.push({
      fieldId: FIELD_IDS.opening,
      message: 'Saisissez le fond de caisse (0 FCFA si le tiroir est vide).',
    })
  }
  if (errors.length > 0 || registerId.value === null || openingAmount.value === null) {
    openErrors.value = errors
    await openSummary.value?.focus()
    return
  }
  if (openMutation.state.value === 'synced') openMutation.reset()
  await afterOpen(
    await openMutation.submit({
      name: 'OpenCashSession',
      payload: buildOpenSessionPayload({
        cashSessionId: openMutation.effectId('cash_session_id'),
        cashRegisterId: registerId.value,
        openingAmount: openingAmount.value,
        openedAt: currentInstant(),
      }),
    }),
  )
}

async function retryOpen(): Promise<void> {
  if (opening.value) return
  await afterOpen(await openMutation.retry())
}

// --- Clôture --------------------------------------------------------------------------------------

const counted = ref<number | null>(null)
const reason = ref('')
const countedField = ref<{ commit: () => boolean } | null>(null)
const closeErrors = ref<FieldErrorItem[]>([])
const closeSummary = ref<{ focus: () => Promise<void> } | null>(null)
const confirmingClose = ref(false)
/** Attendu changé depuis l'affichage (409) : ancien et nouveau montants, dits avant de recompter. */
const expectedChanged = ref<{ before: number; after: number } | null>(null)

const expected = computed(() => session.value?.theoretical_cash ?? 0)
const variance = computed(() => {
  if (counted.value === null || session.value === null) return null
  return cashVariance(counted.value, expected.value)
})
const closing = computed(() => closeMutation.state.value === 'saving')
const closeFailure = computed(() =>
  closeMutation.state.value === 'conflict' ? null : salesFailureView(closeMutation.state.value),
)

const dirty = computed(
  () =>
    (session.value !== null && (counted.value !== null || reason.value.trim() !== '')) ||
    (session.value === null &&
      openingAmount.value !== null &&
      openMutation.state.value !== 'synced'),
)
useUnsavedChangesGuard(dirty)

watch(counted, () => {
  closeErrors.value = closeErrors.value.filter((item) => item.fieldId !== FIELD_IDS.counted)
})
watch(reason, () => {
  closeErrors.value = closeErrors.value.filter((item) => item.fieldId !== FIELD_IDS.reason)
})

function signed(amount: number): string {
  return amount > 0 ? `+${formatMoney(amount)}` : formatMoney(amount)
}

async function requestClose(): Promise<void> {
  if (closing.value || session.value === null) return
  closeErrors.value = []
  const committed = countedField.value?.commit() ?? true
  const checked = validateClosing({
    counted: committed ? counted.value : null,
    expected: expected.value,
    reason: reason.value,
  })
  if (!checked.ok) {
    closeErrors.value = [
      ...(checked.errors.counted === undefined
        ? []
        : [{ fieldId: FIELD_IDS.counted, message: checked.errors.counted }]),
      ...(checked.errors.reason === undefined
        ? []
        : [{ fieldId: FIELD_IDS.reason, message: checked.errors.reason }]),
    ]
    await closeSummary.value?.focus()
    return
  }
  confirmingClose.value = true
}

async function afterClose(result: MutationOutcome): Promise<void> {
  switch (result.kind) {
    case 'synced': {
      confirmingClose.value = false
      const response = result.result as CashSessionResponse
      closed.value = response.data
      counted.value = null
      reason.value = ''
      expectedChanged.value = null
      await read.reload()
      return
    }
    case 'conflict': {
      confirmingClose.value = false
      const after = result.error.details['expected_amount']
      expectedChanged.value = {
        before: expected.value,
        after: typeof after === 'number' ? after : expected.value,
      }
      await read.reload()
      return
    }
    case 'refused':
      confirmingClose.value = false
      closeErrors.value = serverErrors(
        result.error.fields,
        {
          counted_amount: FIELD_IDS.counted,
          variance_reason: FIELD_IDS.reason,
          variance: FIELD_IDS.counted,
        },
        FIELD_IDS.counted,
        result.error.message,
      )
      await closeSummary.value?.focus()
      if (result.error.code === 'STATE_TRANSITION_REFUSED') await read.reload()
      return
    case 'session-expired':
    case 'reauthentication-required':
      confirmingClose.value = false
      void revalidateSession().catch(() => undefined)
      return
    default:
      confirmingClose.value = false
      return
  }
}

async function confirmClose(): Promise<void> {
  const current = session.value
  if (closing.value || current === null) return
  const checked = validateClosing({
    counted: counted.value,
    expected: current.theoretical_cash,
    reason: reason.value,
  })
  if (!checked.ok || counted.value === null) {
    confirmingClose.value = false
    return
  }
  expectedChanged.value = null
  await afterClose(
    await closeMutation.submit({
      name: 'CloseCashSession',
      path: { id: current.id },
      payload: buildCloseSessionPayload({
        cashSessionId: current.id,
        closedAt: currentInstant(),
        counted: counted.value,
        expected: current.theoretical_cash,
        variance: checked.variance,
        reason: checked.reason,
      }),
    }),
  )
}

async function retryClose(): Promise<void> {
  if (closing.value) return
  await afterClose(await closeMutation.retry())
}
</script>

<template>
  <section aria-labelledby="titre-caisse" class="max-w-3xl space-y-6">
    <h1 id="titre-caisse" class="text-2xl font-semibold tracking-tight">Caisse</h1>

    <SalesReadMessage
      v-if="read.state.value !== 'ready'"
      :state="read.state.value"
      subject="la caisse"
      :error="read.error.value"
      not-found-title="Caisse indisponible"
      @retry="read.reload()"
    />

    <StateMessage v-if="openNotice" state="conflict" title="Une session était déjà ouverte">
      {{ openNotice }} La session ouverte est affichée ci-dessous.
    </StateMessage>

    <StateMessage v-if="closed" state="success" title="Session de caisse clôturée">
      <dl class="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-2">
        <div>
          <dt class="text-sm text-muted">Clôturée le</dt>
          <dd>{{ closed.closed_at === null ? '—' : formatInstantFr(closed.closed_at) }}</dd>
        </div>
        <div>
          <dt class="text-sm text-muted">Espèces attendues</dt>
          <dd class="tabular-nums">{{ formatMoney(closed.expected_amount ?? 0) }}</dd>
        </div>
        <div>
          <dt class="text-sm text-muted">Montant compté</dt>
          <dd class="tabular-nums">{{ formatMoney(closed.counted_amount ?? 0) }}</dd>
        </div>
        <div>
          <dt class="text-sm text-muted">Écart</dt>
          <dd class="tabular-nums">
            {{ signed(closed.variance ?? 0) }} — {{ varianceDescription(closed.variance ?? 0) }}
          </dd>
        </div>
        <div v-if="closed.variance_reason" class="sm:col-span-2">
          <dt class="text-sm text-muted">Motif de l’écart</dt>
          <dd class="break-words whitespace-pre-line">{{ closed.variance_reason }}</dd>
        </div>
      </dl>
      <p class="mt-2">La session clôturée est figée : elle ne se modifie plus.</p>
      <template #action>
        <SessionReportButton :session-id="closed.id" label="Relevé de clôture (PDF)" />
      </template>
    </StateMessage>

    <template v-if="ready && session === null">
      <StateMessage state="empty" title="Aucune session de caisse ouverte">
        Ce compte n’a pas de session de caisse ouverte : un encaissement en espèces est impossible
        tant que la caisse n’est pas ouverte. Les autres modes (mobile money, virement, chèque) ne
        dépendent pas de la caisse.
      </StateMessage>

      <StateMessage
        v-if="registers.length === 0"
        state="error"
        title="Aucune caisse active dans ce cabinet"
      >
        La caisse principale n’a pas encore été créée : demandez à l’administrateur système de
        finaliser l’initialisation des ventes avant toute ouverture.
      </StateMessage>

      <form
        v-else
        novalidate
        aria-labelledby="titre-ouverture"
        class="space-y-4"
        @submit.prevent="openSession"
      >
        <h2 id="titre-ouverture" class="text-lg font-semibold">Ouvrir la caisse</h2>
        <ErrorSummary ref="openSummary" :errors="openErrors" />
        <StateMessage v-if="openFailure" :state="openFailure.state" :title="openFailure.title">
          {{ openMutation.failureMessage.value }}
          <template v-if="openFailure.retry" #action>
            <AppButton variant="secondary" :pending="opening" @click="retryOpen"
              >Réessayer l’ouverture</AppButton
            >
          </template>
        </StateMessage>
        <SelectField
          v-if="registers.length > 1"
          v-model="registerId"
          label="Caisse"
          :options="registerOptions"
          :control-id="FIELD_IDS.register"
          :error="fieldError(openErrors, FIELD_IDS.register)"
          required
        />
        <p v-else :id="FIELD_IDS.register" tabindex="-1" class="text-base">
          Caisse : <strong>{{ registers[0]?.name }}</strong>
        </p>
        <MoneyField
          ref="openingField"
          v-model="openingAmount"
          label="Fond de caisse"
          field="opening_amount"
          hint="Espèces présentes dans le tiroir à l’ouverture, en FCFA (0 si le tiroir est vide)."
          :control-id="FIELD_IDS.opening"
          :error="fieldError(openErrors, FIELD_IDS.opening)"
          required
        />
        <div class="flex flex-wrap items-center gap-3">
          <AppButton type="submit" :pending="opening" pending-label="Ouverture en cours…"
            >Ouvrir la caisse</AppButton
          >
          <SaveStatus
            :state="
              openMutation.saveState.value === 'synced'
                ? 'saved-server'
                : openMutation.saveState.value
            "
            :at="openMutation.recordedAt.value"
            :time-zone="timeZone"
          />
        </div>
      </form>
    </template>

    <template v-if="session">
      <section aria-labelledby="titre-session" class="space-y-3">
        <h2 id="titre-session" class="text-lg font-semibold">
          Session ouverte : {{ registerName }}
        </h2>
        <dl
          class="grid gap-x-6 gap-y-3 rounded-xl border border-line bg-surface shadow-card p-4 sm:grid-cols-2"
        >
          <div>
            <dt class="text-sm text-muted">Ouverte le</dt>
            <dd>{{ formatInstantFr(session.opened_at) }}</dd>
          </div>
          <div>
            <dt class="text-sm text-muted">Fond de caisse</dt>
            <dd class="tabular-nums">{{ formatMoney(session.opening_amount) }}</dd>
          </div>
          <div>
            <dt class="text-sm text-muted">Espèces encaissées</dt>
            <dd class="tabular-nums">{{ formatMoney(session.collected_cash) }}</dd>
          </div>
          <div>
            <dt class="text-sm text-muted">Remboursements en espèces</dt>
            <dd class="tabular-nums">{{ formatMoney(session.refunded_cash) }}</dd>
          </div>
          <div class="sm:col-span-2">
            <dt class="text-base font-semibold">Espèces attendues dans le tiroir</dt>
            <dd class="text-2xl font-bold tabular-nums" data-montant="attendu">
              {{ formatMoney(session.theoretical_cash) }}
            </dd>
          </div>
        </dl>
        <p class="text-sm text-muted">
          Projection du serveur à la lecture : fond + espèces encaissées − remboursements en espèces
          ± dépenses et mouvements autorisés. Mobile money, virements et chèques ne sont pas dans le
          tiroir.
        </p>
        <div class="flex flex-wrap gap-3">
          <LinkButton :to="{ name: 'factures' }" variant="secondary">Aller aux factures</LinkButton>
          <LinkButton :to="{ name: 'caisse-du-jour' }" variant="secondary"
            >Caisse du jour</LinkButton
          >
          <LinkButton v-if="isManager" :to="{ name: 'categories-depenses' }" variant="ghost"
            >Catégories de dépenses</LinkButton
          >
        </div>
        <SessionReportButton :session-id="session.id" label="Relevé provisoire (PDF)" />
      </section>

      <Expenses
        :session-id="session.id"
        :open="true"
        :available="session.theoretical_cash"
        @changed="read.reload()"
      />

      <StateMessage
        v-if="expectedChanged"
        state="conflict"
        title="Les espèces attendues ont changé depuis l’affichage"
      >
        Attendu affiché : {{ formatMoney(expectedChanged.before) }} ; attendu recalculé par le
        serveur : {{ formatMoney(expectedChanged.after) }}. Un encaissement en espèces est
        probablement survenu. Votre compté est conservé : recomptez le tiroir, corrigez si besoin,
        puis clôturez de nouveau.
      </StateMessage>

      <form
        novalidate
        aria-labelledby="titre-cloture"
        class="space-y-4"
        @submit.prevent="requestClose"
      >
        <h2 id="titre-cloture" class="text-lg font-semibold">Clôturer la caisse</h2>
        <ErrorSummary ref="closeSummary" :errors="closeErrors" />
        <StateMessage v-if="closeFailure" :state="closeFailure.state" :title="closeFailure.title">
          {{ closeMutation.failureMessage.value }}
          <template v-if="closeFailure.retry" #action>
            <AppButton variant="secondary" :pending="closing" @click="retryClose"
              >Réessayer la clôture</AppButton
            >
          </template>
        </StateMessage>
        <MoneyField
          ref="countedField"
          v-model="counted"
          label="Montant compté dans le tiroir"
          field="counted_amount"
          :control-id="FIELD_IDS.counted"
          :error="fieldError(closeErrors, FIELD_IDS.counted)"
          required
        />
        <p v-if="variance !== null" role="status" aria-live="polite" class="text-base">
          Écart : <strong class="tabular-nums">{{ signed(variance) }}</strong> —
          {{ varianceDescription(variance) }}
        </p>
        <TextAreaField
          v-model="reason"
          label="Motif de l’écart"
          hint="Obligatoire si le compté diffère de l’attendu."
          :maxlength="VARIANCE_REASON_MAX_LENGTH"
          :control-id="FIELD_IDS.reason"
          :error="fieldError(closeErrors, FIELD_IDS.reason)"
          :required="variance !== null && variance !== 0"
        />
        <AppButton type="submit" :pending="closing" pending-label="Clôture en cours…"
          >Clôturer la caisse</AppButton
        >
      </form>
    </template>

    <CashSessionsManager v-if="isManager" />

    <FreshnessNote
      v-if="read.freshness.value && ready"
      :freshness="read.freshness.value"
      :time-zone="timeZone"
    />

    <ConfirmDialog
      :open="confirmingClose"
      title="Clôturer la session de caisse ?"
      confirm-label="Clôturer la caisse"
      pending-label="Clôture en cours…"
      :pending="closing"
      tone="danger"
      @confirm="confirmClose"
      @cancel="confirmingClose = false"
    >
      <p>
        Compté : <strong>{{ formatMoney(counted ?? 0) }}</strong> ; attendu :
        <strong>{{ formatMoney(expected) }}</strong> ; écart :
        <strong>{{ signed(variance ?? 0) }}</strong
        >.
      </p>
      <p class="mt-2">
        La session clôturée ne pourra plus être modifiée et aucun encaissement en espèces n’y sera
        plus admis.
      </p>
    </ConfirmDialog>
  </section>
</template>
