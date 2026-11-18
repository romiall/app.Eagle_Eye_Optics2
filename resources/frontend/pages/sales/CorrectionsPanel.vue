<script setup lang="ts">
/**
 * Corrections d'une facture ÉMISE (B07, B08), EN LIGNE : contre-écritures, avoirs et remboursements déjà
 * enregistrés (pièces liées, jamais une modification du paiement, du reçu ou de la facture), leurs PDF
 * produits sur ce poste depuis leurs snapshots figés, et les actions de correction :
 *  - « Contre-passer » un paiement confirmé encore contre-passable (erreur d'encaissement) ;
 *  - « Émettre un avoir » tant qu'une part de la facture reste créditable (réduction de la vente) ;
 *  - « Rembourser » le crédit d'un avoir (argent rendu au patient).
 * Chaque action est proposée à qui détient sa permission, ou à qui peut DEMANDER une autorisation exacte
 * (module « settings » ouvert) : la gérante l'exécute ensuite. Le solde affiché reste celui du serveur.
 */
import { computed, ref, shallowRef } from 'vue'

import { formatInstantFr } from '@/app/clinicTime'
import { getCreditNote, getRefund } from '@/app/services/billing'
import type { RenderedDocument } from '@/app/services/documents'
import { creditNoteDocument, refundDocument } from '@/app/services/salesDocuments'
import { canOnScreen, moduleOpenOnScreen } from '@/app/session'
import DocumentPreview from '@/components/documents/DocumentPreview.vue'
import StateMessage from '@/components/feedback/StateMessage.vue'
import AppButton from '@/components/ui/AppButton.vue'
import { creditableTotal, refundableAmount, reversibleAmount } from '@/domain/billing/corrections'
import { heldByDevice } from '@/domain/billing/issueInvoice'
import type { Invoice } from '@/domain/contracts/generated'

import CreditNoteForm from './CreditNoteForm.vue'
import { formatMoney, paymentMethodLabel } from './format'
import RefundForm from './RefundForm.vue'
import ReversalForm from './ReversalForm.vue'

const props = withDefaults(
  defineProps<{
    invoice: Invoice
    cashSessionId: string | null
    cashSessionRead?: 'ready' | 'loading' | 'unavailable'
  }>(),
  { cashSessionRead: 'ready' },
)

const emit = defineEmits<{ reload: [] }>()

type Action =
  | { kind: 'reversal'; paymentId: string }
  | { kind: 'credit-note' }
  | { kind: 'refund'; creditNoteId: string }

const action = ref<Action | null>(null)
/** Nouvelle intention : recrée le formulaire (nouvelle clé, nouveaux identifiants). */
const generation = ref(0)
const notice = ref<string | null>(null)

const mayRequest = computed(() => canOnScreen('approval.request') && moduleOpenOnScreen('settings'))
const mayReverse = computed(() => canOnScreen('payment.reverse') || mayRequest.value)
const mayCredit = computed(() => canOnScreen('credit_note.issue') || mayRequest.value)
const mayRefund = computed(() => canOnScreen('refund.execute') || mayRequest.value)

const reversals = computed(() => props.invoice.reversals ?? [])
const issuedNotes = computed(() =>
  props.invoice.credit_notes.filter((note) => note.status === 'ISSUED'),
)
const reversiblePayments = computed(() =>
  props.invoice.payments.filter((payment) => reversibleAmount(payment) > 0),
)
const creditable = computed(() => creditableTotal(props.invoice.balance))
const held = computed(() => heldByDevice(props.invoice))

const selectedPayment = computed(() => {
  const current = action.value
  if (current?.kind !== 'reversal') return null
  return props.invoice.payments.find((payment) => payment.id === current.paymentId) ?? null
})
const selectedNote = computed(() => {
  const current = action.value
  if (current?.kind !== 'refund') return null
  return props.invoice.credit_notes.find((note) => note.id === current.creditNoteId) ?? null
})

function open(next: Action): void {
  notice.value = null
  generation.value += 1
  action.value = next
}

function done(message: string): void {
  action.value = null
  notice.value = message
  emit('reload')
}

function receiptOf(paymentId: string): string {
  return props.invoice.payments.find((payment) => payment.id === paymentId)?.receipt_number ?? ''
}

// --- PDF des pièces de correction (produits sur ce poste, depuis leur snapshot figé) ------------------
const rendered = shallowRef<RenderedDocument | null>(null)
const renderedTitle = ref('')
const generating = ref<string | null>(null)
const documentProblem = ref<string | null>(null)

async function preview(kind: 'credit-note' | 'refund', id: string, title: string): Promise<void> {
  if (generating.value !== null) return
  generating.value = id
  documentProblem.value = null
  try {
    if (kind === 'credit-note') {
      const read = await getCreditNote(id)
      rendered.value = await creditNoteDocument(read.data)
    } else {
      const read = await getRefund(id)
      rendered.value = await refundDocument(read.data)
    }
    renderedTitle.value = title
  } catch (error) {
    documentProblem.value =
      error instanceof Error
        ? `Le PDF n’a pas pu être généré : ${error.message}`
        : 'Le PDF n’a pas pu être généré.'
  } finally {
    generating.value = null
  }
}
</script>

<template>
  <section aria-labelledby="titre-corrections" class="space-y-4">
    <h2 id="titre-corrections" class="text-lg font-semibold">Corrections de la facture</h2>
    <p class="max-w-prose text-sm text-muted">
      Une facture émise et ses reçus ne sont jamais effacés : choisissez l’opération adaptée à votre
      situation sans modifier l’historique.
    </p>
    <div class="rounded-xl border border-line bg-canvas p-4 text-sm text-ink">
      <p class="font-semibold">Quelle correction choisir selon votre situation ?</p>
      <ul class="mt-2 list-disc space-y-1 pl-5 text-muted">
        <li>
          <strong class="text-ink">Erreur de saisie sur un encaissement</strong> (doublon, montant
          ou mode erroné) → cliquez sur <strong class="text-ink">Contre-passer le paiement</strong>.
        </li>
        <li>
          <strong class="text-ink"
            >Annulation partielle, oubli de remise ou retour d’article</strong
          >
          (réduire le montant de la vente) → cliquez sur
          <strong class="text-ink">Émettre un avoir</strong>.
        </li>
        <li>
          <strong class="text-ink">Rendre de l’argent au patient</strong> suite à un avoir en sa
          faveur → cliquez sur <strong class="text-ink">Rembourser</strong> sous l’avoir concerné.
        </li>
      </ul>
    </div>

    <StateMessage v-if="notice" state="success" title="Correction enregistrée">{{
      notice
    }}</StateMessage>

    <div v-if="reversals.length > 0" class="space-y-2">
      <h3 class="text-base font-semibold">Contre-écritures</h3>
      <ul class="space-y-2">
        <li
          v-for="reversal in reversals"
          :key="reversal.id"
          class="space-y-1 rounded-xl border border-line bg-surface shadow-card p-3"
        >
          <p class="flex flex-wrap items-baseline justify-between gap-x-3">
            <span class="font-semibold">Paiement {{ receiptOf(reversal.payment_id) }}</span>
            <span class="tabular-nums">− {{ formatMoney(reversal.amount) }}</span>
          </p>
          <p class="text-sm text-muted">
            {{ formatInstantFr(reversal.recorded_at) }}
            <template v-if="reversal.recorded_by_name"> · {{ reversal.recorded_by_name }}</template>
          </p>
          <p class="text-sm break-words whitespace-pre-line">Motif : {{ reversal.reason }}</p>
        </li>
      </ul>
    </div>

    <div v-if="issuedNotes.length > 0" class="space-y-2">
      <h3 class="text-base font-semibold">Avoirs</h3>
      <ul class="space-y-2">
        <li
          v-for="note in issuedNotes"
          :key="note.id"
          class="space-y-2 rounded-xl border border-line bg-surface shadow-card p-3"
        >
          <p class="flex flex-wrap items-baseline justify-between gap-x-3">
            <span class="font-semibold">Avoir {{ note.number ?? '' }}</span>
            <span class="tabular-nums">{{ formatMoney(note.amount_gross) }}</span>
          </p>
          <p class="text-sm text-muted">
            {{ note.issued_at === null ? '—' : formatInstantFr(note.issued_at) }}
            <template v-if="(note.refunded_amount ?? 0) > 0">
              · déjà remboursé {{ formatMoney(note.refunded_amount ?? 0) }}</template
            >
          </p>
          <p v-if="note.reason" class="text-sm break-words whitespace-pre-line">
            Motif : {{ note.reason }}
          </p>
          <div class="flex flex-wrap gap-2">
            <AppButton
              variant="secondary"
              :pending="generating === note.id"
              pending-label="Génération du PDF…"
              :accessible-name="`PDF de l’avoir ${note.number ?? ''}`"
              @click="preview('credit-note', note.id, `Avoir ${note.number ?? ''}`)"
              >PDF de l’avoir</AppButton
            >
            <AppButton
              v-if="mayRefund && !held && refundableAmount(note, props.invoice.balance) > 0"
              variant="secondary"
              :accessible-name="`Rembourser le crédit de l’avoir ${note.number ?? ''}`"
              @click="open({ kind: 'refund', creditNoteId: note.id })"
              >Rembourser</AppButton
            >
          </div>
        </li>
      </ul>
    </div>

    <div v-if="props.invoice.refunds.length > 0" class="space-y-2">
      <h3 class="text-base font-semibold">Remboursements</h3>
      <ul class="space-y-2">
        <li
          v-for="refund in props.invoice.refunds"
          :key="refund.id"
          class="space-y-2 rounded-xl border border-line bg-surface shadow-card p-3"
        >
          <p class="flex flex-wrap items-baseline justify-between gap-x-3">
            <span class="font-semibold">Remboursement {{ refund.number }}</span>
            <span class="tabular-nums">{{ formatMoney(refund.amount) }}</span>
          </p>
          <p class="text-sm text-muted">
            {{ paymentMethodLabel(refund.method) }} · {{ formatInstantFr(refund.effective_at) }}
          </p>
          <AppButton
            variant="secondary"
            :pending="generating === refund.id"
            pending-label="Génération du PDF…"
            :accessible-name="`PDF du remboursement ${refund.number}`"
            @click="preview('refund', refund.id, `Remboursement ${refund.number}`)"
            >PDF du remboursement</AppButton
          >
        </li>
      </ul>
    </div>

    <StateMessage v-if="held" state="conflict" title="Facture détenue par un poste préparé">
      Les corrections de cette facture se font sur le poste qui la détient.
    </StateMessage>

    <div v-else-if="action === null" class="flex flex-wrap gap-2">
      <template v-if="mayReverse">
        <AppButton
          v-for="payment in reversiblePayments"
          :key="payment.id"
          variant="secondary"
          :accessible-name="`Contre-passer le paiement ${payment.receipt_number ?? ''}`"
          @click="open({ kind: 'reversal', paymentId: payment.id })"
          >Contre-passer le paiement {{ payment.receipt_number ?? '' }}</AppButton
        >
      </template>
      <AppButton
        v-if="mayCredit && creditable > 0"
        variant="secondary"
        @click="open({ kind: 'credit-note' })"
        >Émettre un avoir</AppButton
      >
    </div>

    <ReversalForm
      v-if="selectedPayment"
      :key="`reversal-${generation}`"
      :invoice="props.invoice"
      :payment="selectedPayment"
      @done="done"
      @stale="emit('reload')"
      @cancel="action = null"
    />
    <CreditNoteForm
      v-else-if="action?.kind === 'credit-note'"
      :key="`credit-${generation}`"
      :invoice="props.invoice"
      @done="done"
      @stale="emit('reload')"
      @cancel="action = null"
    />
    <RefundForm
      v-else-if="selectedNote"
      :key="`refund-${generation}`"
      :invoice="props.invoice"
      :note="selectedNote"
      :cash-session-id="props.cashSessionId"
      :cash-session-read="props.cashSessionRead"
      @done="done"
      @stale="emit('reload')"
      @cancel="action = null"
    />

    <StateMessage v-if="documentProblem" state="error" title="PDF non généré">
      {{ documentProblem }}
    </StateMessage>
    <DocumentPreview v-if="rendered" :document="rendered" :heading="renderedTitle" />
  </section>
</template>
