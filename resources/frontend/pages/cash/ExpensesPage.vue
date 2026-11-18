<script setup lang="ts">
/**
 * Dépenses du cabinet (/ventes/depenses, L1D05) :
 *  - Accessible directement depuis le menu principal, pour la gérante ET la caissière (sans exiger
 *    d'ouvrir préalablement la caisse).
 *  - Saisie directe sans approbation préalable : depuis le tiroir espèces d'une session ouverte OU par
 *    un autre canal (Mobile Money, virement, chèque, autre), même caisse fermée.
 *  - Motif et référence de pièce justificative facultatifs.
 *  - Fonctionne en ligne ET hors ligne sur un poste préparé (`RecordCashMovement` synchronisable),
 *    avec ajustement immédiat du disponible espèces affiché et liste des dépenses en attente de synchro.
 */
import { computed, ref, shallowRef, watch } from 'vue'

import { ApiError, NetworkUnavailable } from '@/app/api'
import { formatInstantFr } from '@/app/clinicTime'
import { type ExpenseFilters, listExpenses } from '@/app/services/billing'
import {
  loadCurrentCashSessionWithFallback,
  loadExpenseCategoriesWithFallback,
  loadLocalDrawerDelta,
  loadLocalExpenses,
  type LocalCashSession,
  type LocalExpense,
} from '@/app/services/localCash'
import { type MutationOutcome } from '@/app/services/mutations'
import { useMutation } from '@/app/services/useMutation'
import { canOnScreen, revalidateSession, session } from '@/app/session'
import ErrorSummary, { type FieldErrorItem } from '@/components/feedback/ErrorSummary.vue'
import StateMessage from '@/components/feedback/StateMessage.vue'
import SyncBadge from '@/components/feedback/SyncBadge.vue'
import DateField from '@/components/form/DateField.vue'
import MoneyField from '@/components/form/MoneyField.vue'
import SelectField from '@/components/form/SelectField.vue'
import TextAreaField from '@/components/form/TextAreaField.vue'
import TextField from '@/components/form/TextField.vue'
import PageHeader from '@/components/layout/PageHeader.vue'
import AppButton from '@/components/ui/AppButton.vue'
import LinkButton from '@/components/ui/LinkButton.vue'
import {
  buildCashMovementPayload,
  checkMovement,
  EXPENSE_METHODS,
  MOVEMENT_REASON_MAX,
  MOVEMENT_REFERENCE_MAX,
} from '@/domain/cash/movements'
import type {
  CashMovementPage,
  CashSession,
  ExpenseCategory,
  PaymentsMethod,
} from '@/domain/contracts/generated'
import { salesFailureView } from '@/pages/sales/failureView'
import { formatMoney, paymentMethodLabel } from '@/pages/sales/format'

const FIELD_IDS = {
  amount: 'depense-montant',
  category: 'depense-categorie',
  method: 'depense-canal',
  reason: 'depense-motif',
  reference: 'depense-reference',
} as const

const localMode = computed(() => session.status === 'local')
const isManager = computed(() => canOnScreen('cash.manage'))
const canOpenCash = computed(() => canOnScreen('cash.own_session'))

const categories = shallowRef<ExpenseCategory[]>([])
const serverSession = shallowRef<CashSession | null>(null)
const localOpenedSession = shallowRef<LocalCashSession | null>(null)
const localDelta = ref(0)
const pendingLocal = shallowRef<LocalExpense[]>([])
const serverPage = shallowRef<CashMovementPage | null>(null)

const loading = ref(true)
const readProblem = ref<string | null>(null)
const historyUnavailable = ref(false)
const usingDeviceFallback = ref(false)

// Formulaire de saisie
const amount = ref<number | null>(null)
const amountField = ref<{ commit: () => boolean } | null>(null)
const categoryId = ref<string | null>(null)
const method = ref<PaymentsMethod>('CASH')
const reason = ref('')
const reference = ref('')
const fieldErrors = ref<FieldErrorItem[]>([])
const errorSummary = ref<{ focus: () => Promise<void> } | null>(null)
const feedback = ref<{ state: 'success' | 'empty'; title: string; detail?: string } | null>(null)

// Filtres de l'historique serveur
const filterFrom = ref<string | null>(null)
const filterTo = ref<string | null>(null)
const filterCategoryId = ref<string | null>(null)
const filterMethod = ref<string | null>(null)
const currentPage = ref(1)

const mutation = useMutation()
const saving = computed(() => mutation.state.value === 'saving')
const failureView = computed(() => salesFailureView(mutation.state.value))

const activeSessionId = computed(
  () => serverSession.value?.id ?? localOpenedSession.value?.cashSessionId ?? null,
)
const hasOpenSession = computed(() => activeSessionId.value !== null)
const baseAvailable = computed(() =>
  serverSession.value !== null
    ? serverSession.value.theoretical_cash
    : localOpenedSession.value !== null
      ? localOpenedSession.value.openingAmount
      : null,
)
const drawerAvailable = computed(() =>
  baseAvailable.value === null ? null : Math.max(0, baseAvailable.value + localDelta.value),
)

const activeCategoryOptions = computed(() =>
  categories.value
    .filter((category) => category.active)
    .map((category) => ({ value: category.id, label: category.name })),
)

const allCategoryOptions = computed(() =>
  categories.value.map((category) => ({
    value: category.id,
    label: category.active ? category.name : `${category.name} (inactive)`,
  })),
)

const channelOptions = EXPENSE_METHODS.map((value) => ({
  value,
  label: value === 'CASH' ? 'Espèces (tiroir)' : paymentMethodLabel(value),
}))

const filterMethodOptions = EXPENSE_METHODS.map((value) => ({
  value,
  label: paymentMethodLabel(value),
}))

const channelProxy = computed<string | null>({
  get: () => method.value,
  set: (value) => {
    if (value !== null && EXPENSE_METHODS.includes(value as PaymentsMethod)) {
      method.value = value as PaymentsMethod
    }
  },
})

function categoryNameOf(id: string | null): string {
  if (id === null) return 'Sans catégorie'
  return categories.value.find((category) => category.id === id)?.name ?? 'Catégorie'
}

function fieldError(id: string): string | null {
  return fieldErrors.value.find((item) => item.fieldId === id)?.message ?? null
}

function activeFilters(): ExpenseFilters {
  const filters: ExpenseFilters = { page: currentPage.value }
  if (filterFrom.value !== null && /^\d{4}-\d{2}-\d{2}$/.test(filterFrom.value)) {
    filters.from = filterFrom.value
  }
  if (filterTo.value !== null && /^\d{4}-\d{2}-\d{2}$/.test(filterTo.value)) {
    filters.to = filterTo.value
  }
  if (filterCategoryId.value !== null && filterCategoryId.value !== '') {
    filters.categoryId = filterCategoryId.value
  }
  if (
    filterMethod.value !== null &&
    EXPENSE_METHODS.includes(filterMethod.value as PaymentsMethod)
  ) {
    filters.method = filterMethod.value as PaymentsMethod
  }
  return filters
}

async function loadAll(initial = false): Promise<void> {
  loading.value = true
  readProblem.value = null
  historyUnavailable.value = false
  usingDeviceFallback.value = false
  try {
    const [catRes, sessionRes] = await Promise.all([
      loadExpenseCategoriesWithFallback().catch((err) => {
        if (err instanceof NetworkUnavailable) return { categories: [], fromDevice: true }
        throw err
      }),
      loadCurrentCashSessionWithFallback().catch((err) => {
        if (err instanceof NetworkUnavailable) {
          return { session: null, localPending: null, fromDevice: true }
        }
        throw err
      }),
    ])
    categories.value = catRes.categories
    serverSession.value = sessionRes.session
    localOpenedSession.value = sessionRes.localPending
    usingDeviceFallback.value = catRes.fromDevice || sessionRes.fromDevice

    if (initial && activeSessionId.value === null && method.value === 'CASH') {
      method.value = 'MTN_MOMO'
    }

    let serverIds = new Set<string>()
    if (!localMode.value) {
      try {
        const listRes = await listExpenses(activeFilters())
        serverPage.value = listRes.data
        serverIds = new Set(listRes.data.data.map((item) => item.id))
      } catch (err) {
        if (err instanceof NetworkUnavailable) {
          historyUnavailable.value = true
          serverPage.value = null
        } else {
          throw err
        }
      }
    } else {
      historyUnavailable.value = true
      serverPage.value = null
    }

    pendingLocal.value = await loadLocalExpenses(serverIds)
    localDelta.value = await loadLocalDrawerDelta(activeSessionId.value, serverIds)
  } catch (error) {
    readProblem.value =
      error instanceof ApiError
        ? error.message
        : 'Impossible de charger les dépenses pour le moment.'
  } finally {
    loading.value = false
  }
}

watch(
  () => session.status,
  () => {
    void loadAll(true)
  },
  { immediate: true },
)

function mapValidationErrors(
  fields: Readonly<Record<string, readonly string[]>>,
  fallbackMessage: string,
): FieldErrorItem[] {
  const map: Readonly<Record<string, string>> = {
    signed_amount: FIELD_IDS.amount,
    expense_category_id: FIELD_IDS.category,
    method: FIELD_IDS.method,
    cash_session_id: FIELD_IDS.method,
    reason: FIELD_IDS.reason,
    reference: FIELD_IDS.reference,
  }
  const items: FieldErrorItem[] = []
  for (const [key, messages] of Object.entries(fields)) {
    const first = messages[0]
    if (first !== undefined) items.push({ fieldId: map[key] ?? FIELD_IDS.amount, message: first })
  }
  return items.length > 0 ? items : [{ fieldId: FIELD_IDS.amount, message: fallbackMessage }]
}

async function applyOutcome(
  outcome: MutationOutcome,
  spentAmount: number,
  chosenMethod: PaymentsMethod,
): Promise<void> {
  switch (outcome.kind) {
    case 'synced':
      feedback.value = {
        state: 'success',
        title: `Dépense enregistrée (${formatMoney(spentAmount)})`,
        detail: `Réglée via ${chosenMethod === 'CASH' ? 'Espèces (tiroir)' : paymentMethodLabel(chosenMethod)}.`,
      }
      amount.value = null
      reason.value = ''
      reference.value = ''
      fieldErrors.value = []
      await loadAll(false)
      return
    case 'saved-local':
      feedback.value = {
        state: 'empty',
        title: `Dépense enregistrée sur ce poste (${formatMoney(spentAmount)})`,
        detail: 'En attente de synchronisation dès le retour de la connexion au serveur.',
      }
      amount.value = null
      reason.value = ''
      reference.value = ''
      fieldErrors.value = []
      await loadAll(false)
      return
    case 'refused':
    case 'conflict':
      fieldErrors.value = mapValidationErrors(outcome.error.fields, outcome.error.message)
      await errorSummary.value?.focus()
      if (outcome.error.code === 'STATE_TRANSITION_REFUSED') {
        await loadAll(false)
      }
      return
    case 'session-expired':
    case 'reauthentication-required':
      void revalidateSession().catch(() => undefined)
      return
    default:
      return
  }
}

async function submit(): Promise<void> {
  if (saving.value) return
  feedback.value = null
  const amountCommitted = amountField.value?.commit() ?? true
  const checked = checkMovement(
    {
      kind: 'EXPENSE',
      method: method.value,
      amount: amountCommitted ? amount.value : null,
      direction: null,
      categoryId: categoryId.value,
      reason: reason.value,
      reference: reference.value,
    },
    method.value === 'CASH' ? drawerAvailable.value : null,
    method.value === 'CASH' ? hasOpenSession.value : true,
  )

  if (!checked.ok || !amountCommitted) {
    const errors: FieldErrorItem[] = []
    if (checked.ok === false) {
      if (checked.errors.amount)
        errors.push({ fieldId: FIELD_IDS.amount, message: checked.errors.amount })
      if (checked.errors.category)
        errors.push({ fieldId: FIELD_IDS.category, message: checked.errors.category })
      if (checked.errors.method)
        errors.push({ fieldId: FIELD_IDS.method, message: checked.errors.method })
      if (checked.errors.reason)
        errors.push({ fieldId: FIELD_IDS.reason, message: checked.errors.reason })
      if (checked.errors.reference)
        errors.push({ fieldId: FIELD_IDS.reference, message: checked.errors.reference })
    }
    fieldErrors.value = errors
    if (errors.length > 0) await errorSummary.value?.focus()
    return
  }

  fieldErrors.value = []
  const payload = buildCashMovementPayload({
    movementId: mutation.effectId('movement_id'),
    cashSessionId: activeSessionId.value,
    checked: checked.movement,
    approvalId: null,
    occurredAt: new Date().toISOString(),
  })

  const outcome = await mutation.submit({
    name: 'RecordCashMovement',
    payload,
  })
  await applyOutcome(outcome, Math.abs(checked.movement.signedAmount), checked.movement.method)
}

async function retryMutation(): Promise<void> {
  if (saving.value) return
  const outcome = await mutation.retry()
  await applyOutcome(outcome, amount.value ?? 0, method.value)
}

function applyFilters(): void {
  currentPage.value = 1
  void loadAll(false)
}

function resetFilters(): void {
  filterFrom.value = null
  filterTo.value = null
  filterCategoryId.value = null
  filterMethod.value = null
  currentPage.value = 1
  void loadAll(false)
}

function goToPage(page: number): void {
  currentPage.value = page
  void loadAll(false)
}

const serverTotalShown = computed(() =>
  (serverPage.value?.data ?? []).reduce((sum, item) => sum + Math.abs(item.signed_amount), 0),
)
</script>

<template>
  <section aria-labelledby="titre-depenses" class="page-stack max-w-4xl">
    <PageHeader
      title-id="titre-depenses"
      title="Dépenses"
      icon="cash"
      subtitle="Sorties catégorisées du cabinet : depuis le tiroir espèces ou par un autre canal, en saisie directe pour la caissière et la gérante."
    >
      <template #actions>
        <LinkButton v-if="canOpenCash && !localMode" :to="{ name: 'caisse' }" variant="secondary"
          >Caisse</LinkButton
        >
        <LinkButton
          v-if="isManager && !localMode"
          :to="{ name: 'categories-depenses' }"
          variant="ghost"
          >Catégories de dépenses</LinkButton
        >
      </template>
    </PageHeader>

    <StateMessage v-if="readProblem" state="error" title="Lecture impossible">
      {{ readProblem }}
    </StateMessage>

    <StateMessage
      v-if="usingDeviceFallback || historyUnavailable"
      state="offline"
      title="Mode hors ligne ou historique serveur injoignable"
    >
      Les dépenses saisies sur un poste préparé sont enregistrées localement et synchronisées dès le
      retour de la connexion.
    </StateMessage>

    <form
      novalidate
      aria-labelledby="titre-nouvelle-depense"
      class="card space-y-4 p-4 sm:p-6"
      @submit.prevent="submit"
    >
      <h2 id="titre-nouvelle-depense" class="text-lg font-semibold">Nouvelle dépense</h2>

      <ErrorSummary ref="errorSummary" :errors="fieldErrors" />

      <StateMessage v-if="feedback" :state="feedback.state" :title="feedback.title">
        <span v-if="feedback.detail">{{ feedback.detail }}</span>
      </StateMessage>

      <StateMessage v-if="failureView" :state="failureView.state" :title="failureView.title">
        {{ mutation.failureMessage.value }}
        <template v-if="failureView.retry" #action>
          <AppButton variant="secondary" :pending="saving" @click="retryMutation"
            >Réessayer l’envoi</AppButton
          >
        </template>
      </StateMessage>

      <div class="grid gap-4 sm:grid-cols-3">
        <MoneyField
          ref="amountField"
          v-model="amount"
          label="Montant (FCFA)"
          field="signed_amount"
          required
          :control-id="FIELD_IDS.amount"
          :error="fieldError(FIELD_IDS.amount)"
        />
        <SelectField
          v-model="categoryId"
          label="Catégorie"
          :options="activeCategoryOptions"
          :hint="
            activeCategoryOptions.length === 0
              ? 'Aucune catégorie active sur ce poste ou le serveur.'
              : undefined
          "
          required
          :control-id="FIELD_IDS.category"
          :error="fieldError(FIELD_IDS.category)"
        />
        <SelectField
          v-model="channelProxy"
          label="Canal de règlement"
          :options="channelOptions"
          required
          :control-id="FIELD_IDS.method"
          :error="fieldError(FIELD_IDS.method)"
        />
      </div>

      <p v-if="method === 'CASH' && hasOpenSession" class="text-sm text-muted">
        Tiroir espèces ouvert : disponible estimé
        <strong class="tabular-nums text-ink">{{ formatMoney(drawerAvailable ?? 0) }}</strong
        ><template v-if="localDelta < 0">
          (tient compte de {{ formatMoney(Math.abs(localDelta)) }} de dépenses locales en
          attente)</template
        >.
      </p>
      <div
        v-else-if="method === 'CASH' && !hasOpenSession"
        class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-canvas px-3 py-2 text-sm"
      >
        <span>
          Aucune session de caisse ouverte : choisissez Mobile Money, Virement ou Chèque, ou ouvrez
          la caisse pour régler en espèces.
        </span>
        <LinkButton v-if="canOpenCash && !localMode" :to="{ name: 'caisse' }" variant="secondary"
          >Ouvrir la caisse</LinkButton
        >
      </div>
      <p v-else class="text-sm text-muted">
        Dépense hors tiroir espèces ({{ paymentMethodLabel(method) }}) : aucune session de caisse
        ouverte n’est exigée.
      </p>

      <div class="grid gap-4 sm:grid-cols-2">
        <TextAreaField
          v-model="reason"
          label="Motif (facultatif)"
          hint="Facultatif. Au moins 3 caractères si vous en saisissez un."
          :maxlength="MOVEMENT_REASON_MAX"
          :rows="2"
          :control-id="FIELD_IDS.reason"
          :error="fieldError(FIELD_IDS.reason)"
        />
        <TextField
          v-model="reference"
          label="Référence pièce justificative (facultatif)"
          hint="Numéro de reçu fournisseur, facture ou bordereau."
          :maxlength="MOVEMENT_REFERENCE_MAX"
          :control-id="FIELD_IDS.reference"
          :error="fieldError(FIELD_IDS.reference)"
        />
      </div>

      <AppButton type="submit" :pending="saving" pending-label="Enregistrement…"
        >Enregistrer la dépense</AppButton
      >
    </form>

    <section
      v-if="pendingLocal.length > 0"
      aria-labelledby="titre-depenses-locales"
      class="space-y-3"
    >
      <h2 id="titre-depenses-locales" class="text-lg font-semibold">
        Dépenses enregistrées sur ce poste
      </h2>
      <ul class="space-y-2">
        <li
          v-for="expense in pendingLocal"
          :key="expense.commandId"
          class="space-y-1 rounded-xl border border-line bg-surface p-3 shadow-card"
        >
          <p class="flex flex-wrap items-baseline justify-between gap-x-3">
            <span class="font-semibold">{{ categoryNameOf(expense.expenseCategoryId) }}</span>
            <span class="font-semibold tabular-nums text-danger"
              >− {{ formatMoney(Math.abs(expense.signedAmount)) }}</span
            >
          </p>
          <p class="text-sm text-muted">
            {{ paymentMethodLabel(expense.method) }} · {{ formatInstantFr(expense.occurredAt) }}
            <template v-if="expense.reason"> · {{ expense.reason }}</template>
            <template v-if="expense.reference"> · Réf. {{ expense.reference }}</template>
          </p>
          <p class="flex flex-wrap items-center gap-2 text-sm">
            <SyncBadge :state="expense.state" />
            <span>Saisie locale conservée dans le coffre du poste.</span>
          </p>
        </li>
      </ul>
    </section>

    <section aria-labelledby="titre-historique-depenses" class="space-y-4">
      <div class="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="titre-historique-depenses" class="text-lg font-semibold">
          Historique des dépenses
        </h2>
        <p v-if="serverPage && serverPage.data.length > 0" class="text-sm text-muted">
          Total affiché :
          <strong class="tabular-nums text-ink">{{ formatMoney(serverTotalShown) }}</strong>
        </p>
      </div>

      <form
        v-if="!localMode"
        class="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4"
        novalidate
        @submit.prevent="applyFilters"
      >
        <DateField v-model="filterFrom" label="Du" control-id="filtre-depense-du" />
        <DateField v-model="filterTo" label="Au" control-id="filtre-depense-au" />
        <SelectField
          v-model="filterCategoryId"
          label="Catégorie"
          placeholder="Toutes"
          :options="allCategoryOptions"
          control-id="filtre-depense-categorie"
        />
        <SelectField
          v-model="filterMethod"
          label="Canal"
          placeholder="Tous les canaux"
          :options="filterMethodOptions"
          control-id="filtre-depense-canal"
        />
        <div class="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-4">
          <AppButton type="submit" variant="secondary">Filtrer</AppButton>
          <AppButton type="button" variant="ghost" @click="resetFilters">Réinitialiser</AppButton>
        </div>
      </form>

      <StateMessage v-if="loading && !serverPage" state="loading" title="Lecture des dépenses…" />
      <StateMessage
        v-else-if="serverPage && serverPage.data.length === 0"
        state="empty"
        title="Aucune dépense enregistrée"
      >
        Aucune dépense ne correspond aux filtres sélectionnés.
      </StateMessage>
      <div
        v-else-if="serverPage && serverPage.data.length > 0"
        class="overflow-x-auto rounded-xl border border-line bg-surface shadow-card"
      >
        <table class="w-full min-w-[40rem] text-left text-sm">
          <caption class="sr-only">
            Dépenses enregistrées sur le serveur
          </caption>
          <thead class="bg-primary-soft">
            <tr>
              <th scope="col" class="px-3 py-2 font-semibold">Date</th>
              <th scope="col" class="px-3 py-2 font-semibold">Catégorie</th>
              <th scope="col" class="px-3 py-2 font-semibold">Canal</th>
              <th scope="col" class="px-3 py-2 font-semibold">Motif &amp; justificatif</th>
              <th scope="col" class="px-3 py-2 font-semibold">Auteur</th>
              <th scope="col" class="px-3 py-2 text-right font-semibold">Montant</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="item in serverPage.data"
              :key="item.id"
              class="border-t border-line align-top"
            >
              <td class="px-3 py-2 whitespace-nowrap">{{ formatInstantFr(item.occurred_at) }}</td>
              <td class="px-3 py-2 font-medium">
                {{ item.expense_category?.name ?? '—' }}
              </td>
              <td class="px-3 py-2">
                {{ item.method === 'CASH' ? 'Espèces (tiroir)' : paymentMethodLabel(item.method) }}
              </td>
              <td class="px-3 py-2 break-words">
                <span v-if="item.reason">{{ item.reason }}</span>
                <span v-else class="text-muted">Sans motif précisé</span>
                <span v-if="item.reference" class="block text-muted"
                  >Justificatif : {{ item.reference }}</span
                >
              </td>
              <td class="px-3 py-2">{{ item.created_by_name ?? '—' }}</td>
              <td
                class="px-3 py-2 text-right font-semibold whitespace-nowrap tabular-nums text-danger"
              >
                − {{ formatMoney(Math.abs(item.signed_amount)) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div
        v-if="serverPage && serverPage.meta.last_page > 1"
        class="flex flex-wrap items-center justify-between gap-2"
      >
        <p class="text-sm text-muted">
          Page {{ serverPage.meta.current_page }} sur {{ serverPage.meta.last_page }} ({{
            serverPage.meta.total
          }}
          dépenses)
        </p>
        <div class="flex gap-2">
          <AppButton
            variant="secondary"
            :disabled="serverPage.meta.current_page <= 1"
            @click="goToPage(serverPage.meta.current_page - 1)"
            >Précédent</AppButton
          >
          <AppButton
            variant="secondary"
            :disabled="serverPage.meta.current_page >= serverPage.meta.last_page"
            @click="goToPage(serverPage.meta.current_page + 1)"
            >Suivant</AppButton
          >
        </div>
      </div>
    </section>
  </section>
</template>
