<script setup lang="ts">
/**
 * Dépenses et mouvements de caisse hors vente d'une session (L1D05 ; fichier 03) :
 *  - Dépense au tiroir espèces (`EXPENSE`) : saisie directe pour la caissière et la gérante sans
 *    approbation préalable, motif et référence facultatifs (synchronisable hors ligne sur poste préparé).
 *  - Entrée motivée (`DEPOSIT`), Sortie motivée (`WITHDRAWAL`) et Correction d'ouverture
 *    (`OPENING_CORRECTION`) : motif obligatoire, autorisation exacte de la gérante (`ExactApprovals`).
 *  - Totaux séparés par nature et filtres sur les mouvements de la session.
 * Une session clôturée est figée : la liste reste lisible, aucun ajout.
 */
import { computed, ref, shallowRef, watch } from 'vue'

import { ApiError, NetworkUnavailable } from '@/app/api'
import { formatInstantFr } from '@/app/clinicTime'
import { getCashSessionMovements } from '@/app/services/billing'
import {
  loadExpenseCategoriesWithFallback,
  loadLocalExpenses,
  type LocalExpense,
} from '@/app/services/localCash'
import { useMutation } from '@/app/services/useMutation'
import { canOnScreen, moduleOpenOnScreen, revalidateSession } from '@/app/session'
import ApprovalRequestDialog from '@/components/approvals/ApprovalRequestDialog.vue'
import StateMessage from '@/components/feedback/StateMessage.vue'
import SyncBadge from '@/components/feedback/SyncBadge.vue'
import MoneyField from '@/components/form/MoneyField.vue'
import SelectField from '@/components/form/SelectField.vue'
import TextAreaField from '@/components/form/TextAreaField.vue'
import TextField from '@/components/form/TextField.vue'
import PasswordConfirmDialog from '@/components/session/PasswordConfirmDialog.vue'
import AppButton from '@/components/ui/AppButton.vue'
import { CASH_MOVEMENT_LABELS, cashMovementSubject } from '@/domain/approvals/approvals'
import { cashMovementLabel } from '@/domain/billing/cashReport'
import {
  buildCashMovementPayload,
  type CashMovementKind,
  checkMovement,
  type CorrectionDirection,
  MOVEMENT_REASON_MAX,
  MOVEMENT_REFERENCE_MAX,
} from '@/domain/cash/movements'
import type { Approval, CashSessionMovements, ExpenseCategory } from '@/domain/contracts/generated'
import { salesFailureView } from '@/pages/sales/failureView'
import { formatMoney } from '@/pages/sales/format'

import { useCashCommand } from './useCashCommand'

const props = defineProps<{
  sessionId: string
  /** Session ouverte : la saisie est proposée. */
  open: boolean
  /** Espèces attendues du tiroir à l'affichage (incluant d'éventuelles dépenses locales en attente). */
  available: number
}>()
const emit = defineEmits<{ changed: [] }>()

type MovementFilter = 'ALL' | 'EXPENSE' | 'DEPOSIT' | 'WITHDRAWAL'

const data = shallowRef<CashSessionMovements | null>(null)
const categories = shallowRef<ExpenseCategory[]>([])
const localPending = shallowRef<LocalExpense[]>([])
const readProblem = ref<string | null>(null)
const loading = ref(false)
const filterKind = ref<MovementFilter>('ALL')

const kind = ref<CashMovementKind>('EXPENSE')
const amount = ref<number | null>(null)
const amountField = ref<{ commit: () => boolean } | null>(null)
const direction = ref<string | null>(null)
const categoryId = ref<string | null>(null)
const reason = ref('')
const reference = ref('')
const errors = ref<Record<string, string>>({})
const asking = ref(false)
const done = ref<string | null>(null)

const command = useCashCommand()
const expenseMutation = useMutation()
const saving = computed(
  () => command.mutation.state.value === 'saving' || expenseMutation.state.value === 'saving',
)
const expenseFailure = computed(() => salesFailureView(expenseMutation.state.value))

const MODE_TABS: readonly { kind: CashMovementKind; label: string; badge: string }[] = [
  { kind: 'EXPENSE', label: 'Dépense (tiroir)', badge: 'Directe · motif facultatif' },
  { kind: 'DEPOSIT', label: 'Entrée motivée', badge: 'Motif obligatoire' },
  { kind: 'WITHDRAWAL', label: 'Sortie motivée', badge: 'Motif obligatoire' },
  { kind: 'OPENING_CORRECTION', label: 'Correction d’ouverture', badge: 'Motif obligatoire' },
]

const FILTER_TABS: readonly { value: MovementFilter; label: string }[] = [
  { value: 'ALL', label: 'Tous' },
  { value: 'EXPENSE', label: 'Dépenses' },
  { value: 'DEPOSIT', label: 'Entrées motivées' },
  { value: 'WITHDRAWAL', label: 'Sorties motivées' },
]

async function load(): Promise<void> {
  loading.value = true
  readProblem.value = null
  try {
    const response = await getCashSessionMovements(props.sessionId)
    data.value = response.data
    if (props.open) {
      const cat = await loadExpenseCategoriesWithFallback().catch((error) => {
        if (error instanceof NetworkUnavailable) return { categories: [], fromDevice: true }
        throw error
      })
      categories.value = cat.categories
    }
    const serverIds = new Set(response.data.movements.map((movement) => movement.id))
    localPending.value = (await loadLocalExpenses(serverIds)).filter(
      (item) => item.cashSessionId === props.sessionId && item.method === 'CASH',
    )
  } catch (error) {
    readProblem.value =
      error instanceof NetworkUnavailable
        ? 'Le serveur n’a pas répondu : les mouvements ne sont pas affichés (rien n’est conclu).'
        : error instanceof ApiError
          ? error.message
          : 'Une erreur inattendue est survenue.'
  } finally {
    loading.value = false
  }
}

watch(
  () => props.sessionId,
  () => void load(),
  { immediate: true },
)

function chooseKind(next: CashMovementKind): void {
  if (kind.value === next) return
  kind.value = next
  direction.value = null
  if (next !== 'EXPENSE') categoryId.value = null
  errors.value = {}
  done.value = null
  command.reset()
}

const directionOptions = [
  { value: 'IN', label: 'Ajouter des espèces (ouverture sous-estimée)' },
  { value: 'OUT', label: 'Retirer des espèces (ouverture surestimée)' },
]
const categoryOptions = computed(() =>
  categories.value
    .filter((category) => category.active)
    .map((category) => ({ value: category.id, label: category.name })),
)

function categoryNameOf(id: string | null): string {
  if (id === null) return 'Sans catégorie'
  return categories.value.find((category) => category.id === id)?.name ?? 'Catégorie'
}

const filteredMovements = computed(() => {
  const list = data.value?.movements ?? []
  if (filterKind.value === 'ALL') return list
  return list.filter((movement) => movement.kind === filterKind.value)
})

const drawerTotals = computed(() => {
  const list = data.value?.movements ?? []
  let deposits = 0
  let withdrawals = 0
  let expenses = 0
  for (const item of list) {
    if (item.kind === 'DEPOSIT') deposits += item.signed_amount
    else if (item.kind === 'WITHDRAWAL') withdrawals += Math.abs(item.signed_amount)
    else if (item.kind === 'EXPENSE') expenses += Math.abs(item.signed_amount)
  }
  const localExpensesTotal = localPending.value.reduce(
    (sum, item) => sum + Math.abs(item.signedAmount),
    0,
  )
  return { deposits, withdrawals, expenses: expenses + localExpensesTotal }
})

const checked = computed(() =>
  checkMovement(
    {
      kind: kind.value,
      method: 'CASH',
      amount: amount.value,
      direction: direction.value as CorrectionDirection | null,
      categoryId: categoryId.value,
      reason: reason.value,
      reference: reference.value,
    },
    props.available,
    true,
  ),
)

/** Pour DEPOSIT/WITHDRAWAL/OPENING_CORRECTION sans `approval.decide`, demande d'autorisation préalable. */
const requestOnly = computed(
  () =>
    kind.value !== 'EXPENSE' &&
    !canOnScreen('approval.decide') &&
    command.requestedApproval.value === null,
)
const canRequest = computed(() => canOnScreen('approval.request') && moduleOpenOnScreen('settings'))
const subject = computed(() =>
  checked.value.ok && checked.value.movement.kind !== 'EXPENSE'
    ? cashMovementSubject(
        props.sessionId,
        checked.value.movement.kind,
        checked.value.movement.signedAmount,
        checked.value.movement.categoryId,
      )
    : null,
)
const summary = computed(() =>
  checked.value.ok
    ? `${CASH_MOVEMENT_LABELS[checked.value.movement.kind]} de ${formatMoney(Math.abs(checked.value.movement.signedAmount))}${checked.value.movement.reason ? ` : ${checked.value.movement.reason}` : ''}`
    : '',
)

function clearFormAfterSuccess(message: string): void {
  done.value = message
  amount.value = null
  direction.value = null
  categoryId.value = null
  reason.value = ''
  reference.value = ''
  errors.value = {}
}

async function submit(): Promise<void> {
  if (saving.value) return
  done.value = null
  const amountCommitted = amountField.value?.commit() ?? true
  const result = checked.value
  if (!result.ok || !amountCommitted) {
    errors.value = result.ok
      ? { amount: 'Indiquez un montant valide.' }
      : Object.fromEntries(
          Object.entries(result.errors).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string',
          ),
        )
    return
  }
  errors.value = {}

  if (result.movement.kind === 'EXPENSE') {
    const payload = buildCashMovementPayload({
      movementId: expenseMutation.effectId('movement_id'),
      cashSessionId: props.sessionId,
      checked: result.movement,
      approvalId: null,
      occurredAt: new Date().toISOString(),
    })
    const outcome = await expenseMutation.submit({ name: 'RecordCashMovement', payload })
    if (outcome.kind === 'synced') {
      clearFormAfterSuccess(
        `Dépense enregistrée depuis le tiroir : ${formatMoney(Math.abs(result.movement.signedAmount))}.`,
      )
      await load()
      emit('changed')
    } else if (outcome.kind === 'saved-local') {
      clearFormAfterSuccess(
        `Dépense enregistrée sur ce poste (${formatMoney(Math.abs(result.movement.signedAmount))}), en attente de synchronisation.`,
      )
      await load()
      emit('changed')
    } else if (outcome.kind === 'refused' || outcome.kind === 'conflict') {
      const mapped: Record<string, string> = {}
      for (const [key, messages] of Object.entries(outcome.error.fields)) {
        const first = messages[0]
        if (first !== undefined) {
          const fieldKey =
            key === 'signed_amount' ? 'amount' : key === 'expense_category_id' ? 'category' : key
          mapped[fieldKey] = first
        }
      }
      errors.value = Object.keys(mapped).length > 0 ? mapped : { amount: outcome.error.message }
      if (outcome.error.code === 'STATE_TRANSITION_REFUSED') {
        await load()
        emit('changed')
      }
    } else if (outcome.kind === 'session-expired' || outcome.kind === 'reauthentication-required') {
      void revalidateSession().catch(() => undefined)
    }
    return
  }

  if (requestOnly.value) {
    if (canRequest.value) asking.value = true
    else
      command.message.value =
        'Ce compte ne peut pas demander d’autorisation : la gérante enregistre ce mouvement.'
    return
  }
  const outcome = await command.send({
    name: 'RecordCashMovement',
    route: {
      method: 'POST',
      path: `/cash-sessions/${encodeURIComponent(props.sessionId)}/movements`,
      expectedVersion: 'none',
    },
    payload: buildCashMovementPayload({
      movementId: command.mutation.effectId('movement_id'),
      cashSessionId: props.sessionId,
      checked: result.movement,
      approvalId: command.approvalId.value,
      occurredAt: new Date().toISOString(),
    }),
  })
  if (outcome.kind === 'synced') {
    clearFormAfterSuccess(
      `${CASH_MOVEMENT_LABELS[result.movement.kind]} enregistré(e) : ${formatMoney(Math.abs(result.movement.signedAmount))}.`,
    )
    command.reset()
    await load()
    emit('changed')
  } else if (command.stale.value) {
    await load()
    emit('changed')
  }
}

function onRequested(approval: Approval): void {
  asking.value = false
  command.approvalRequested(approval)
}

async function passwordConfirmed(): Promise<void> {
  const outcome = await command.passwordConfirmed()
  if (outcome.kind === 'synced') {
    await load()
    emit('changed')
  }
}

function fieldError(name: string, server: string): string | null {
  return errors.value[name] ?? command.fields.value[server] ?? null
}

function approvalLabel(mode: 'DIRECT' | 'APPROVED' | null): string {
  if (mode === null) return 'Directe (sans approbation)'
  return mode === 'DIRECT' ? 'Gérante (directe)' : 'Accordée par la gérante'
}
</script>

<template>
  <section aria-labelledby="titre-mouvements" class="space-y-4">
    <h2 id="titre-mouvements" class="text-lg font-semibold">Dépenses et mouvements de caisse</h2>
    <p class="max-w-prose text-sm text-muted">
      Sorties et entrées d’espèces hors vente : elles entrent dans les espèces attendues du tiroir.
      Ce ne sont jamais des paiements de patients (ni facture, ni reçu).
    </p>

    <StateMessage v-if="loading && !data" state="loading" title="Lecture des mouvements…" />
    <StateMessage v-if="readProblem" state="offline" title="Mouvements non lus">
      {{ readProblem }}
    </StateMessage>

    <template v-if="data">
      <dl
        v-if="data.movements.length > 0 || localPending.length > 0"
        class="grid gap-3 rounded-xl border border-line bg-surface p-4 shadow-card sm:grid-cols-3"
      >
        <div>
          <dt class="text-sm text-muted">Entrées motivées</dt>
          <dd class="text-base font-semibold tabular-nums text-accent">
            + {{ formatMoney(drawerTotals.deposits) }}
          </dd>
        </div>
        <div>
          <dt class="text-sm text-muted">Sorties motivées</dt>
          <dd class="text-base font-semibold tabular-nums text-danger">
            − {{ formatMoney(drawerTotals.withdrawals) }}
          </dd>
        </div>
        <div>
          <dt class="text-sm text-muted">Dépenses au tiroir</dt>
          <dd class="text-base font-semibold tabular-nums text-danger">
            − {{ formatMoney(drawerTotals.expenses) }}
          </dd>
        </div>
      </dl>

      <div v-if="localPending.length > 0" class="space-y-2">
        <p class="text-sm font-medium">
          Dépenses tiroir enregistrées sur ce poste (à synchroniser)
        </p>
        <ul class="space-y-2">
          <li
            v-for="expense in localPending"
            :key="expense.commandId"
            class="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface p-3 shadow-card text-sm"
          >
            <div class="min-w-0">
              <p class="font-semibold">
                {{ categoryNameOf(expense.expenseCategoryId) }}
                <template v-if="expense.reason"> · {{ expense.reason }}</template>
              </p>
              <p class="text-muted">{{ formatInstantFr(expense.occurredAt) }}</p>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <SyncBadge :state="expense.state" />
              <span class="font-semibold tabular-nums text-danger"
                >− {{ formatMoney(Math.abs(expense.signedAmount)) }}</span
              >
            </div>
          </li>
        </ul>
      </div>

      <div
        v-if="data.movements.length > 0"
        role="group"
        aria-label="Filtrer les mouvements de la session"
        class="flex flex-wrap gap-2"
      >
        <AppButton
          v-for="tab in FILTER_TABS"
          :key="tab.value"
          variant="ghost"
          :pressed="filterKind === tab.value"
          @click="filterKind = tab.value"
          >{{ tab.label }}</AppButton
        >
      </div>

      <p v-if="filteredMovements.length === 0" class="text-sm text-muted">
        {{
          data.movements.length === 0
            ? 'Aucun mouvement hors vente dans cette session.'
            : 'Aucun mouvement pour ce filtre.'
        }}
      </p>
      <div v-else class="overflow-x-auto rounded-xl border border-line bg-surface shadow-card">
        <table class="w-full min-w-[40rem] text-left text-sm">
          <caption class="sr-only">
            Mouvements hors vente de la session
          </caption>
          <thead class="bg-primary-soft">
            <tr>
              <th scope="col" class="px-3 py-2 font-semibold">Heure</th>
              <th scope="col" class="px-3 py-2 font-semibold">Nature</th>
              <th scope="col" class="px-3 py-2 font-semibold">Motif</th>
              <th scope="col" class="px-3 py-2 font-semibold">Autorisation</th>
              <th scope="col" class="px-3 py-2 text-right font-semibold">Montant</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="movement in filteredMovements"
              :key="movement.id"
              class="border-t border-line align-top"
            >
              <td class="px-3 py-2 whitespace-nowrap">
                {{ formatInstantFr(movement.occurred_at) }}
              </td>
              <td class="px-3 py-2">
                {{ cashMovementLabel(movement.kind) }}
                <span v-if="movement.expense_category" class="block text-muted">{{
                  movement.expense_category.name
                }}</span>
              </td>
              <td class="px-3 py-2 break-words">
                <span v-if="movement.reason">{{ movement.reason }}</span>
                <span v-else class="text-muted">Sans motif précisé</span>
                <span v-if="movement.reference" class="block text-muted"
                  >Justificatif : {{ movement.reference }}</span
                >
              </td>
              <td class="px-3 py-2">
                {{ approvalLabel(movement.approval_mode) }}
                <span v-if="movement.created_by_name" class="block text-muted">{{
                  movement.created_by_name
                }}</span>
              </td>
              <td
                :class="[
                  'px-3 py-2 text-right font-semibold whitespace-nowrap tabular-nums',
                  movement.signed_amount < 0 ? 'text-danger' : 'text-accent',
                ]"
              >
                {{ movement.signed_amount < 0 ? '−' : '+' }}
                {{ formatMoney(Math.abs(movement.signed_amount)) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <StateMessage v-if="!props.open" state="empty" title="Session clôturée : mouvements figés">
        Une session clôturée ne reçoit plus de mouvement. Une erreur se corrige dans une session
        ouverte, avec son motif.
      </StateMessage>

      <form
        v-else
        novalidate
        aria-labelledby="titre-nouveau-mouvement"
        class="space-y-4 rounded-xl border border-line bg-surface p-4 shadow-card"
        @submit.prevent="submit"
      >
        <h3 id="titre-nouveau-mouvement" class="font-semibold">
          Enregistrer un mouvement au tiroir
        </h3>

        <div
          role="group"
          aria-label="Choisir le type d’opération"
          class="flex flex-wrap gap-2 border-b border-line pb-3"
        >
          <AppButton
            v-for="tab in MODE_TABS"
            :key="tab.kind"
            type="button"
            variant="ghost"
            :pressed="kind === tab.kind"
            @click="chooseKind(tab.kind)"
            ><span>{{ tab.label }}</span></AppButton
          >
        </div>

        <StateMessage v-if="done" state="success" :title="done" />
        <StateMessage v-if="command.notice.value" state="empty" title="Autorisation demandée">
          {{ command.notice.value }}
        </StateMessage>
        <StateMessage
          v-if="expenseFailure"
          :state="expenseFailure.state"
          :title="expenseFailure.title"
        >
          {{ expenseMutation.failureMessage.value }}
        </StateMessage>
        <p v-if="command.message.value" role="alert" class="text-sm font-medium text-danger">
          {{ command.message.value }}
        </p>

        <div class="grid gap-4 sm:grid-cols-2">
          <MoneyField
            ref="amountField"
            v-model="amount"
            label="Montant (FCFA)"
            field="signed_amount"
            :error="fieldError('amount', 'signed_amount')"
            required
            control-id="mouvement-montant"
          />
          <SelectField
            v-if="kind === 'EXPENSE'"
            v-model="categoryId"
            label="Catégorie de la dépense"
            :options="categoryOptions"
            :hint="
              categoryOptions.length === 0
                ? 'Aucune catégorie active : la gérante les crée dans « Catégories de dépenses ».'
                : undefined
            "
            :error="fieldError('category', 'expense_category_id')"
            required
            control-id="mouvement-categorie"
          />
          <SelectField
            v-if="kind === 'OPENING_CORRECTION'"
            v-model="direction"
            label="Sens de la correction"
            :options="directionOptions"
            :error="fieldError('direction', 'signed_amount')"
            required
            control-id="mouvement-sens"
          />
        </div>
        <TextAreaField
          v-model="reason"
          :label="kind === 'EXPENSE' ? 'Motif (facultatif)' : 'Motif (obligatoire)'"
          :hint="
            kind === 'EXPENSE'
              ? 'Facultatif. Au moins 3 caractères si renseigné.'
              : 'Indiquez précisément le motif de cette opération en caisse.'
          "
          :error="fieldError('reason', 'reason')"
          :maxlength="MOVEMENT_REASON_MAX"
          :rows="2"
          :required="kind !== 'EXPENSE'"
          control-id="mouvement-motif"
        />
        <TextField
          v-model="reference"
          label="Référence du justificatif (facultatif)"
          hint="Numéro du bon, de la facture du fournisseur ou du bordereau de versement."
          :error="fieldError('reference', 'reference')"
          :maxlength="MOVEMENT_REFERENCE_MAX"
          control-id="mouvement-reference"
        />
        <p class="text-sm text-muted">
          Espèces disponibles dans le tiroir : {{ formatMoney(props.available) }}. Une sortie ne
          peut pas les dépasser.
        </p>
        <AppButton type="submit" :pending="saving" pending-label="Enregistrement…">
          {{
            kind === 'EXPENSE'
              ? 'Enregistrer la dépense'
              : requestOnly
                ? 'Demander l’autorisation'
                : 'Enregistrer le mouvement'
          }}
        </AppButton>
      </form>
    </template>

    <ApprovalRequestDialog
      :open="asking"
      :subject="subject"
      :summary="summary"
      @requested="onRequested"
      @cancel="asking = false"
    />
    <PasswordConfirmDialog
      :open="command.askingPassword.value"
      action="Un mouvement de caisse"
      @confirmed="passwordConfirmed"
      @cancel="command.askingPassword.value = false"
    />
  </section>
</template>
