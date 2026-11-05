<script setup lang="ts">
/**
 * Encaisser un acompte ou le solde d'une facture émise (B04 ; AT10, AT11, AT12), EN LIGNE. Montant au
 * plus le reste à encaisser (le serveur tranche sous verrou : 409 avec le reste actualisé), mode de
 * règlement, référence pour mobile money et virement. Les espèces exigent une session de caisse
 * ouverte de l'auteur : l'écran le dit et renvoie vers la caisse.
 *
 * Idempotence : la clé et les identifiants des effets (paiement, reçu, usage du numéro, document) sont
 * liés à CETTE tentative, et l'instant de l'encaissement est fixé à la première demande. Double clic,
 * coupure ou réponse perdue : « Réessayer » rejoue la même commande, le serveur rend la réponse
 * d'origine, jamais un second encaissement. Tant que l'issue n'est pas confirmée, les champs sont
 * verrouillés ; si une relecture de la facture montre le paiement de cette tentative, l'encaissement
 * est constaté sans renvoi. Après un reçu, « Nouvel encaissement » ouvre une nouvelle intention.
 */
import { computed, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'

import type { MutationOutcome } from '@/app/services/mutations'
import { useMutation } from '@/app/services/useMutation'
import { canOnScreen, revalidateSession } from '@/app/session'
import { useUnsavedChangesGuard } from '@/app/unsavedChanges'
import ErrorSummary, { type FieldErrorItem } from '@/components/feedback/ErrorSummary.vue'
import StateMessage from '@/components/feedback/StateMessage.vue'
import MoneyField from '@/components/form/MoneyField.vue'
import SelectField from '@/components/form/SelectField.vue'
import TextField from '@/components/form/TextField.vue'
import AppButton from '@/components/ui/AppButton.vue'
import {
  buildPaymentPayload,
  isPaymentMethod,
  PAYMENT_METHODS,
  type PaymentErrors,
  REFERENCE_MAX_LENGTH,
  referenceRequired,
  validatePayment,
} from '@/domain/billing/payment'
import type { Invoice, PaymentResult, PaymentResultResponse } from '@/domain/contracts/generated'
import { currentInstant } from '@/domain/patients/visits'

import { salesFailureView, unconfirmed } from './failureView'
import { formatMoney, paymentMethodLabel } from './format'
import { useSalesSettings } from './useSalesSettings'

const props = withDefaults(
  defineProps<{
    invoice: Invoice
    /** Session de caisse ouverte du compte (espèces), ou null (aucune, ou pas encore lue). */
    cashSessionId: string | null
    /**
     * Lecture de cette session : `ready` (le serveur a répondu, `cashSessionId` fait foi), `loading` (en cours)
     * ou `unavailable` (pas de réponse exploitable). Tant qu'elle n'est pas lue, rien n'est conclu : ni « caisse
     * non ouverte », ni encaissement en espèces envoyé sans session.
     */
    cashSessionRead?: 'ready' | 'loading' | 'unavailable'
  }>(),
  { cashSessionRead: 'ready' },
)

const emit = defineEmits<{
  /** Encaissement confirmé par le serveur (réponse ou relecture) : le reçu est à afficher. */
  recorded: [receipt: { receiptId: string; receiptNumber: string | null }]
  /** Encaissement enregistré sur CE poste préparé (commit local) : l'écran relit les encaissements du poste. */
  recordedLocal: [at: string]
  /** La facture a changé (reste dû, version) : l'écran la relit. */
  stale: []
  /** La session de caisse n'a pas pu être lue : l'écran la relit. */
  recheckCash: []
}>()

const FIELD_IDS = {
  amount: 'encaissement-montant',
  method: 'encaissement-mode',
  reference: 'encaissement-reference',
  cashSession: 'encaissement-caisse',
} as const

const mutation = useMutation()
const salesSettings = useSalesSettings()
/** Modes à référence obligatoire lus sur le serveur (null : liste par défaut). */
const referenceMethods = computed(() => salesSettings.value?.payment_reference_required ?? null)
const amount = ref<number | null>(null)
const methodValue = ref<string | null>(null)
const reference = ref('')
const amountField = ref<{ commit: () => boolean } | null>(null)
const errors = ref<PaymentErrors>({})
const general = ref<string | null>(null)
const summaryBox = ref<{ focus: () => Promise<void> } | null>(null)
/** Montant dû appris d'un refus du serveur (`amount_due`), dit à l'opératrice. */
const serverDue = ref<number | null>(null)
/** Instant de l'encaissement, fixé à la première demande de cette intention. */
let effectiveAt: string | null = null
/** Identifiant du paiement de la tentative envoyée (pour la constater à la relecture). */
const sentPaymentId = ref<string | null>(null)
/** Instant du commit sur CE poste préparé (O04, O05) : l'encaissement partira au serveur ; jamais « sur le serveur ». */
const savedLocallyAt = ref<string | null>(null)

const method = computed(() => (isPaymentMethod(methodValue.value) ? methodValue.value : null))
const amountDue = computed(() => Math.max(0, props.invoice.balance.balance_due))
const methodOptions = PAYMENT_METHODS.map((value) => ({ value, label: paymentMethodLabel(value) }))
const sending = computed(() => mutation.state.value === 'saving')
const locked = computed(
  () => sending.value || unconfirmed(mutation.state.value) || savedLocallyAt.value !== null,
)
const failure = computed(() =>
  mutation.state.value === 'conflict' ? null : salesFailureView(mutation.state.value),
)
const canOpenCash = computed(() => canOnScreen('cash.own_session'))
const cashMissing = computed(() => method.value === 'CASH' && props.cashSessionId === null)
/** Espèces sans session, constaté par le serveur. */
const cashBlocked = computed(() => cashMissing.value && props.cashSessionRead === 'ready')
/** Espèces alors que la session du compte n'est pas encore lue : ni refus, ni envoi. */
const cashUnknown = computed(() => cashMissing.value && props.cashSessionRead !== 'ready')

/** Saisie à protéger tant qu'elle n'est ni confirmée par le serveur ni enregistrée sur ce poste (commit local). */
const dirty = computed(
  () =>
    mutation.state.value !== 'synced' &&
    savedLocallyAt.value === null &&
    (amount.value !== null || reference.value.trim() !== ''),
)
useUnsavedChangesGuard(dirty)

/**
 * Une saisie corrigée efface l'erreur de son champ, immédiatement (`sync`) : la lecture du champ au
 * moment de l'envoi ne peut pas effacer l'erreur que la validation pose juste après.
 */
function dropError(...fields: (keyof PaymentErrors)[]): void {
  if (fields.every((field) => errors.value[field] === undefined)) return
  const rest = { ...errors.value }
  for (const field of fields) delete rest[field]
  errors.value = rest
}
watch(amount, () => dropError('amount'), { flush: 'sync' })
watch(methodValue, () => dropError('method', 'cashSession', 'reference'), { flush: 'sync' })
watch(reference, () => dropError('reference'), { flush: 'sync' })
watch(
  () => props.cashSessionId,
  (id) => {
    if (id !== null) dropError('cashSession')
  },
)

/** Relecture de la facture : le paiement de la tentative envoyée y figure → encaissement constaté. */
watch(
  () => props.invoice.payments,
  (payments) => {
    const id = sentPaymentId.value
    if (id === null || mutation.state.value === 'synced') return
    const found = payments.find((payment) => payment.id === id && payment.status === 'CONFIRMED')
    if (found !== undefined && found.receipt_id !== null) {
      sentPaymentId.value = null
      emit('recorded', { receiptId: found.receipt_id, receiptNumber: found.receipt_number })
    }
  },
)

const summary = computed<FieldErrorItem[]>(() => {
  const items: FieldErrorItem[] = []
  for (const key of ['amount', 'method', 'reference', 'cashSession'] as const) {
    const message = errors.value[key]
    if (message !== undefined) items.push({ fieldId: FIELD_IDS[key], message })
  }
  if (general.value !== null) items.push({ fieldId: FIELD_IDS.amount, message: general.value })
  return items
})

function takeRemaining(): void {
  amount.value = amountDue.value
}

function serverField(key: string): keyof PaymentErrors | null {
  switch (key) {
    case 'amount':
      return 'amount'
    case 'method':
      return 'method'
    case 'reference':
      return 'reference'
    case 'cash_session_id':
      return 'cashSession'
    default:
      return null
  }
}

async function afterOutcome(result: MutationOutcome): Promise<void> {
  switch (result.kind) {
    case 'synced': {
      const payment: PaymentResult = (result.result as PaymentResultResponse).data
      sentPaymentId.value = null
      emit('recorded', { receiptId: payment.receipt_id, receiptNumber: payment.receipt_number })
      return
    }
    case 'conflict': {
      const due = result.error.details['amount_due']
      serverDue.value = typeof due === 'number' ? due : null
      general.value =
        'La facture a changé depuis l’affichage (un autre encaissement, un avoir) : le reste à encaisser est relu. Vérifiez le montant puis encaissez de nouveau.'
      emit('stale')
      await summaryBox.value?.focus()
      return
    }
    case 'refused': {
      const error = result.error
      if (error.code === 'PAYMENT_EXCEEDS_BALANCE') {
        const due = error.details['amount_due']
        serverDue.value = typeof due === 'number' ? due : null
        errors.value = {
          amount:
            serverDue.value === null
              ? 'Le montant dépasse le reste à encaisser de cette facture.'
              : `Le montant dépasse le reste à encaisser : il reste ${formatMoney(serverDue.value)} à encaisser selon le serveur.`,
        }
        emit('stale')
        await summaryBox.value?.focus()
        return
      }
      if (
        ['payment_id', 'receipt_id', 'receipt_number_usage_id', 'receipt_document_id'].some(
          (key) => key in error.fields,
        )
      ) {
        // Les identifiants de cette tentative sont déjà pris : l'encaissement a probablement abouti.
        general.value =
          'Cet encaissement a peut-être déjà été enregistré : la facture est relue. Ne recommencez pas l’encaissement.'
        emit('stale')
        await summaryBox.value?.focus()
        return
      }
      const byField: PaymentErrors = {}
      const others: string[] = []
      for (const [key, messages] of Object.entries(error.fields)) {
        const message = messages[0]
        if (message === undefined) continue
        const field = serverField(key)
        if (field === null) others.push(message)
        else byField[field] = message
      }
      errors.value = byField
      general.value =
        others.length > 0
          ? others.join(' ')
          : Object.keys(byField).length === 0
            ? error.message
            : null
      if (error.code === 'STATE_TRANSITION_REFUSED' || error.code === 'WRITE_OWNER_REQUIRED') {
        emit('stale')
      }
      await summaryBox.value?.focus()
      return
    }
    case 'saved-local':
      // Poste préparé : commit local durable, numéro de reçu pris dans la plage du poste ; transmis au serveur à la
      // synchronisation (O05). Le formulaire reste verrouillé : une nouvelle intention passe par « Nouvel encaissement ».
      savedLocallyAt.value = result.at
      sentPaymentId.value = null
      emit('recordedLocal', result.at)
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
  if (locked.value || cashUnknown.value) return
  errors.value = {}
  general.value = null
  const committed = amountField.value?.commit() ?? true
  const checked = validatePayment(
    { amount: committed ? amount.value : null, method: method.value, reference: reference.value },
    {
      amountDue: amountDue.value,
      cashSessionId: props.cashSessionId,
      referenceRequiredMethods: referenceMethods.value,
    },
  )
  if (!checked.ok) {
    errors.value = checked.errors
    await summaryBox.value?.focus()
    return
  }
  const ledgerVersion = props.invoice.ledger_version
  if (ledgerVersion === null) {
    general.value = 'Seule une facture émise peut être encaissée.'
    return
  }
  effectiveAt ??= currentInstant()
  const paymentId = mutation.effectId('payment_id')
  sentPaymentId.value = paymentId
  await afterOutcome(
    await mutation.submit({
      name: 'RegisterPayment',
      path: { id: props.invoice.id },
      payload: buildPaymentPayload({
        invoiceId: props.invoice.id,
        amount: checked.amount,
        method: checked.method,
        reference: checked.reference,
        effectiveAt,
        cashSessionId: props.cashSessionId,
        effects: {
          paymentId,
          receiptId: mutation.effectId('receipt_id'),
          receiptNumberUsageId: mutation.effectId('receipt_number_usage_id'),
          receiptDocumentId: mutation.effectId('receipt_document_id'),
        },
      }),
      expectedVersion: ledgerVersion,
    }),
  )
}

async function retry(): Promise<void> {
  if (sending.value) return
  await afterOutcome(await mutation.retry())
}

/** Nouvelle intention (après un reçu) : nouvelle clé, nouveaux identifiants, saisie vide. */
function reset(): void {
  mutation.reset()
  effectiveAt = null
  sentPaymentId.value = null
  savedLocallyAt.value = null
  amount.value = null
  methodValue.value = null
  reference.value = ''
  errors.value = {}
  general.value = null
  serverDue.value = null
}

defineExpose({ reset })
</script>

<template>
  <form
    novalidate
    aria-labelledby="titre-encaisser"
    class="space-y-4 rounded-xl border border-line bg-surface shadow-card p-4"
    @submit.prevent="submit"
  >
    <h2 id="titre-encaisser" class="text-lg font-semibold">Encaisser</h2>
    <p class="text-base">
      Reste à encaisser :
      <strong class="tabular-nums" data-montant="reste-formulaire">{{
        formatMoney(amountDue)
      }}</strong>
    </p>

    <ErrorSummary ref="summaryBox" :errors="summary" />

    <StateMessage v-if="failure" :state="failure.state" :title="failure.title">
      {{ mutation.failureMessage.value }}
      <p v-if="unconfirmed(mutation.state.value)" class="mt-2">
        Ne recommencez pas l’encaissement : « Réessayer l’encaissement » le renvoie sans doublon, ou
        relisez la facture pour voir s’il a été enregistré.
      </p>
      <template v-if="failure.retry" #action>
        <div class="flex flex-wrap gap-3">
          <AppButton variant="primary" :pending="sending" @click="retry"
            >Réessayer l’encaissement</AppButton
          >
          <AppButton variant="secondary" :disabled="sending" @click="emit('stale')"
            >Relire la facture</AppButton
          >
        </div>
      </template>
    </StateMessage>

    <p v-if="savedLocallyAt" role="status" class="font-medium">
      <span aria-hidden="true">✓ </span>Encaissement enregistré sur ce poste, en attente de
      synchronisation avec le serveur.
    </p>

    <div class="space-y-2">
      <MoneyField
        ref="amountField"
        v-model="amount"
        label="Montant encaissé"
        field="amount"
        :hint="`Acompte ou solde : au plus ${formatMoney(amountDue)}.`"
        :control-id="FIELD_IDS.amount"
        :error="errors.amount ?? null"
        :disabled="locked"
        required
      />
      <AppButton variant="ghost" :disabled="locked || amountDue <= 0" @click="takeRemaining"
        >Encaisser le reste ({{ formatMoney(amountDue) }})</AppButton
      >
    </div>

    <SelectField
      v-model="methodValue"
      label="Mode de règlement"
      :options="methodOptions"
      :control-id="FIELD_IDS.method"
      :error="errors.method ?? null"
      :disabled="locked"
      required
    />

    <TextField
      v-model="reference"
      :label="
        referenceRequired(method, referenceMethods)
          ? 'Référence de l’opération'
          : 'Référence de l’opération (facultative)'
      "
      :hint="
        referenceRequired(method, referenceMethods)
          ? 'Numéro de transaction ou de virement, obligatoire pour ce mode.'
          : undefined
      "
      :control-id="FIELD_IDS.reference"
      :maxlength="REFERENCE_MAX_LENGTH"
      :error="errors.reference ?? null"
      :disabled="locked"
      :required="referenceRequired(method, referenceMethods)"
    />

    <!-- Cible du résumé d'erreurs (focus) : le message d'état ne porte pas d'identifiant. -->
    <div v-if="cashBlocked || errors.cashSession" :id="FIELD_IDS.cashSession" tabindex="-1">
      <StateMessage state="offline" title="Caisse non ouverte">
        Un encaissement en espèces exige une session de caisse ouverte par ce compte.
        <template v-if="canOpenCash" #action>
          <RouterLink
            :to="{ name: 'caisse' }"
            class="inline-flex min-h-11 items-center font-semibold text-primary underline underline-offset-4"
            >Ouvrir la caisse</RouterLink
          >
        </template>
      </StateMessage>
    </div>
    <StateMessage
      v-else-if="cashUnknown && props.cashSessionRead === 'loading'"
      state="loading"
      title="Lecture de la session de caisse…"
    >
      L’encaissement en espèces attend la réponse du serveur sur la session de caisse de ce compte.
    </StateMessage>
    <StateMessage v-else-if="cashUnknown" state="offline" title="Session de caisse non vérifiée">
      La session de caisse de ce compte n’a pas pu être lue : rien n’est conclu, l’encaissement en
      espèces attend cette lecture.
      <template #action>
        <AppButton variant="secondary" @click="emit('recheckCash')"
          >Relire la session de caisse</AppButton
        >
      </template>
    </StateMessage>

    <p class="text-sm text-muted">
      L’encaissement est un fait constaté par vous : aucun opérateur de paiement n’est interrogé. Un
      reçu numéroté est créé par le serveur pour chaque encaissement.
    </p>

    <AppButton
      type="submit"
      :pending="sending"
      :disabled="locked || cashUnknown"
      pending-label="Encaissement en cours…"
      >Encaisser{{ amount === null ? '' : ` ${formatMoney(amount)}` }}</AppButton
    >
  </form>
</template>
