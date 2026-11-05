<script setup lang="ts">
/**
 * Fiche d'une facture ÉMISE (B03, B04) : numéro définitif, patient et cabinet FIGÉS à l'émission
 * (snapshots), lignes figées, récapitulatif de la projection du serveur (« Total encaissé », « Reste à
 * encaisser »), encaissements avec leurs reçus, encaissement d'un acompte ou du solde, PDF de la facture
 * et des reçus générés sur ce poste. Rien n'y est modifiable : une erreur se corrige par une pièce liée
 * (contre-écriture, avoir, remboursement : `CorrectionsPanel`). Jamais « payé », « soldé » ni « acquitté » :
 * un reste nul se lit avec ses reçus. Remise au patient et retours physiques (I01, I02) : `DeliveriesPanel`.
 *
 * Facture lue sur la copie de CE poste (`local`, G1) : créée et émise sans réseau, le serveur ne la connaît pas encore.
 * Les encaissements se font sur le poste ; remises au patient, avoirs et corrections demandent le serveur et ne sont
 * pas offerts (aucun panneau qui échouerait), l'écran le dit.
 */
import { computed, onMounted, ref, shallowRef, watch } from 'vue'

import { formatInstantFr } from '@/app/clinicTime'
import { getCurrentCashSession } from '@/app/services/billing'
import type { RenderedDocument } from '@/app/services/documents'
import {
  collectionBlockedByReview,
  countedLocal,
  effectiveBalance,
  effectiveLedgerVersion,
  loadLocalPayments,
  type LocalPayment,
  localReceiptOf,
  notYetOnServer,
} from '@/app/services/localPayments'
import { invoiceDocument } from '@/app/services/salesDocuments'
import { vaultView } from '@/app/services/vault'
import { canOnScreen, session as appSession } from '@/app/session'
import BalanceSummary from '@/components/billing/BalanceSummary.vue'
import DocumentPreview from '@/components/documents/DocumentPreview.vue'
import StateMessage from '@/components/feedback/StateMessage.vue'
import SyncBadge from '@/components/feedback/SyncBadge.vue'
import AppButton from '@/components/ui/AppButton.vue'
import { heldByDevice } from '@/domain/billing/issueInvoice'
import type { CashSession, Invoice, Receipt } from '@/domain/contracts/generated'
import { patientDisplayName } from '@/domain/patients/identity'
import { useServerRead } from '@/pages/today/useServerRead'

import CorrectionsPanel from './CorrectionsPanel.vue'
import DeliveriesPanel from './DeliveriesPanel.vue'
import { formatMoney, paymentMethodLabel, quantityLabel, rateLabel, unitLabel } from './format'
import PaymentForm from './PaymentForm.vue'
import ReceiptPanel from './ReceiptPanel.vue'

const props = withDefaults(defineProps<{ invoice: Invoice; local?: boolean }>(), {
  local: false,
})

const emit = defineEmits<{ reload: [] }>()

const canCollect = computed(() => canOnScreen('payment.collect') || canOnScreen('exam_fee.collect'))
const canReadCash = computed(() => canOnScreen('cash.own_session'))
// Facture détenue par un poste préparé : encaissée sur CE poste seulement (coffre ouvert, O04, O05), jamais par la
// route directe ; ailleurs, l'écran le dit et ne propose pas d'encaisser.
const heldHere = computed(
  () =>
    heldByDevice(props.invoice) &&
    vaultView.value.session !== null &&
    vaultView.value.deviceId !== null &&
    props.invoice.write_owner?.device_id === vaultView.value.deviceId,
)
const held = computed(() => heldByDevice(props.invoice) && !heldHere.value)

/**
 * Encaissements enregistrés sur CE poste préparé (coffre ouvert), relus au chargement, au déverrouillage et après
 * chaque commit local. Le serveur ne les connaît qu'après la synchronisation : ils s'affichent à part, avec l'état de
 * leur commande, et le reste à encaisser comme la version du grand livre attendue en tiennent compte (G1).
 */
const localPayments = ref<LocalPayment[]>([])
const pendingLocal = computed(() => notYetOnServer(localPayments.value, props.invoice.payments))
const countedPendingTotal = computed(() =>
  countedLocal(pendingLocal.value).reduce((total, payment) => total + payment.amount, 0),
)
const reviewBlocked = computed(() => collectionBlockedByReview(pendingLocal.value))
const effectiveInvoice = computed<Invoice>(() => ({
  ...props.invoice,
  balance: effectiveBalance(props.invoice.balance, pendingLocal.value),
  ledger_version: effectiveLedgerVersion(props.invoice.ledger_version, pendingLocal.value),
}))
const amountDue = computed(() => Math.max(0, effectiveInvoice.value.balance.balance_due))

async function loadLocal(): Promise<void> {
  try {
    localPayments.value = await loadLocalPayments(props.invoice.id)
  } catch {
    localPayments.value = []
  }
}
onMounted(() => void loadLocal())
watch(
  () => [
    props.invoice.id,
    props.invoice.payments.length,
    props.invoice.ledger_version,
    vaultView.value.session !== null,
  ],
  () => void loadLocal(),
)

/** Reçus des encaissements du poste, au format du serveur, pour en produire le PDF sans réseau. */
const localReceipts = computed(() => {
  const receipts = new Map<string, Receipt>()
  const account = appSession.account
  if (account === null) return receipts
  for (const payment of pendingLocal.value) {
    const receipt = localReceiptOf({
      invoice: props.invoice,
      pending: pendingLocal.value,
      payment,
      cashier: { userId: account.id, displayName: account.display_name },
    })
    if (receipt !== null) receipts.set(payment.paymentId, receipt)
  }
  return receipts
})
/** Dernier encaissement enregistré sur ce poste depuis cet écran (message, numéro du reçu). */
const localNotice = ref<{ receiptNumber: string | null } | null>(null)
const patient = computed(() => props.invoice.patient_snapshot)
const testDocument = computed(() => props.invoice.clinic_snapshot?.test_document === true)

/** Session de caisse du compte, lue pour les espèces (null : aucune, ou non lue). */
const cash = useServerRead<CashSession | null>(async () =>
  canReadCash.value
    ? getCurrentCashSession()
    : { data: null, freshness: { serverAsOf: null, complete: false }, live: false },
)
const sortedLines = computed(() =>
  [...props.invoice.lines].sort((left, right) => left.position - right.position),
)
const cashSessionId = computed(() => cash.data.value?.id ?? null)
/** Lecture de la session de caisse : tant que le serveur n'a pas répondu, le formulaire ne conclut rien. */
const cashSessionRead = computed(() =>
  cash.state.value === 'ready'
    ? 'ready'
    : cash.state.value === 'loading'
      ? 'loading'
      : 'unavailable',
)

function recheckCash(): void {
  void cash.reload()
}

/** Reçu à mettre en avant (dernier encaissement de cet écran). */
const lastReceiptId = ref<string | null>(null)
const lastReceiptNumber = ref<string | null>(null)
/** Nouvelle intention d'encaissement : recrée le formulaire (nouvelle clé, nouveaux identifiants). */
const paymentGeneration = ref(0)
const showPaymentForm = ref(true)
/** Reçus ouverts depuis la liste des encaissements. */
const openedReceipts = ref<string[]>([])

const confirmedPayments = computed(() =>
  props.invoice.payments.filter((payment) => payment.status === 'CONFIRMED'),
)
const otherPayments = computed(() =>
  props.invoice.payments.filter((payment) => payment.status !== 'CONFIRMED'),
)

function onRecorded(receipt: { receiptId: string; receiptNumber: string | null }): void {
  lastReceiptId.value = receipt.receiptId
  lastReceiptNumber.value = receipt.receiptNumber
  showPaymentForm.value = false
  emit('reload')
  void cash.reload()
}

async function onRecordedLocal(): Promise<void> {
  await loadLocal()
  const last = pendingLocal.value[pendingLocal.value.length - 1] ?? null
  localNotice.value = { receiptNumber: last?.receiptNumber ?? null }
  showPaymentForm.value = false
}

function newPayment(): void {
  paymentGeneration.value += 1
  localNotice.value = null
  showPaymentForm.value = true
}

function toggleReceipt(receiptId: string): void {
  openedReceipts.value = openedReceipts.value.includes(receiptId)
    ? openedReceipts.value.filter((id) => id !== receiptId)
    : [...openedReceipts.value, receiptId]
}

const rendered = shallowRef<RenderedDocument | null>(null)
const generating = ref(false)
const documentProblem = ref<string | null>(null)

async function previewInvoice(): Promise<void> {
  if (generating.value) return
  generating.value = true
  documentProblem.value = null
  try {
    rendered.value = await invoiceDocument(props.invoice)
  } catch (error) {
    documentProblem.value =
      error instanceof Error
        ? `Le PDF de la facture n’a pas pu être généré : ${error.message}`
        : 'Le PDF de la facture n’a pas pu être généré.'
  } finally {
    generating.value = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <div class="space-y-1">
      <p class="text-base">
        <span aria-hidden="true">✓ </span>Facture émise le
        {{ props.invoice.issued_at === null ? '—' : formatInstantFr(props.invoice.issued_at) }} :
        elle ne se modifie plus.
      </p>
      <p v-if="patient" class="text-base break-words">
        Patient (identité figée à l’émission) :
        <strong>{{ patientDisplayName(patient.last_name, patient.first_names) }}</strong
        >, dossier
        {{ patient.record_number }}
      </p>
    </div>

    <StateMessage v-if="testDocument" state="offline" title="Document de test">
      Numéro et mentions de test : les paramètres réels du cabinet ne sont pas encore validés
      (données fictives).
    </StateMessage>

    <BalanceSummary :balance="effectiveInvoice.balance" />
    <p v-if="countedPendingTotal > 0" class="text-sm text-muted">
      Dont {{ formatMoney(countedPendingTotal) }} enregistrés sur ce poste, en attente de
      synchronisation avec le serveur.
    </p>

    <section aria-labelledby="titre-lignes-figees" class="space-y-3">
      <h2 id="titre-lignes-figees" class="text-lg font-semibold">Lignes (figées à l’émission)</h2>
      <ul class="space-y-3">
        <li
          v-for="line in sortedLines"
          :key="line.id"
          class="space-y-1 rounded-xl border border-line bg-surface shadow-card p-3"
        >
          <p class="font-semibold break-words">
            {{ line.description_snapshot
            }}<span v-if="line.reference_snapshot" class="font-normal text-muted">
              · {{ line.reference_snapshot }}</span
            >
          </p>
          <p class="text-base">
            {{ quantityLabel(line.quantity) }} × {{ formatMoney(line.unit_price_gross) }}
            <span class="text-muted">({{ unitLabel(line.unit_snapshot) }})</span>
            <template v-if="line.discount_gross > 0">
              · remise {{ formatMoney(line.discount_gross) }}</template
            >
          </p>
          <p class="text-base">
            Montant de la ligne :
            <strong class="tabular-nums">{{ formatMoney(line.line_total_gross) }}</strong>
          </p>
          <p class="text-sm text-muted">
            <template v-if="line.tax_amount === null"
              >Aucune taxe ventilée (régime non configuré)</template
            >
            <template v-else
              >Dont taxe {{ line.tax_code_snapshot }} ({{ rateLabel(line.tax_rate_snapshot) }}) :
              {{ formatMoney(line.tax_amount) }}</template
            >
          </p>
        </li>
      </ul>
    </section>

    <section aria-labelledby="titre-encaissements" class="space-y-3">
      <h2 id="titre-encaissements" class="text-lg font-semibold">Encaissements et reçus</h2>
      <p v-if="confirmedPayments.length === 0 && pendingLocal.length === 0" class="text-base">
        Aucun encaissement enregistré sur cette facture.
      </p>
      <ul v-else class="space-y-3">
        <li
          v-for="payment in confirmedPayments"
          :key="payment.id"
          class="space-y-2 rounded-xl border border-line bg-surface shadow-card p-3"
        >
          <p class="flex flex-wrap items-baseline justify-between gap-x-3">
            <span class="font-semibold break-words">
              Reçu {{ payment.receipt_number ?? '(numéro non reçu)' }}</span
            >
            <span class="tabular-nums">{{ formatMoney(payment.amount) }}</span>
          </p>
          <p class="text-sm text-muted">
            {{ paymentMethodLabel(payment.method) }} · {{ formatInstantFr(payment.effective_at) }}
            <template v-if="payment.reversed_amount > 0">
              · contre-passé {{ formatMoney(payment.reversed_amount) }}</template
            >
          </p>
          <AppButton
            v-if="payment.receipt_id"
            variant="secondary"
            :accessible-name="`${openedReceipts.includes(payment.receipt_id) ? 'Masquer le reçu' : 'Voir le reçu'} ${payment.receipt_number ?? ''}`"
            @click="toggleReceipt(payment.receipt_id)"
            >{{
              openedReceipts.includes(payment.receipt_id) ? 'Masquer le reçu' : 'Voir le reçu'
            }}</AppButton
          >
          <ReceiptPanel
            v-if="payment.receipt_id && openedReceipts.includes(payment.receipt_id)"
            :receipt-id="payment.receipt_id"
          />
        </li>
        <li
          v-for="payment in pendingLocal"
          :key="payment.paymentId"
          class="space-y-2 rounded-xl border border-line bg-surface shadow-card p-3"
        >
          <p class="flex flex-wrap items-baseline justify-between gap-x-3">
            <span class="font-semibold break-words">
              Reçu {{ payment.receiptNumber ?? '(numéro non reçu)' }}</span
            >
            <span class="tabular-nums">{{ formatMoney(payment.amount) }}</span>
          </p>
          <p class="text-sm text-muted">
            {{ paymentMethodLabel(payment.method) }} · {{ formatInstantFr(payment.effectiveAt) }}
          </p>
          <p class="flex flex-wrap items-center gap-2 text-sm">
            <SyncBadge :state="payment.state" />
            <span v-if="countedLocal([payment]).length > 0"
              >Enregistré sur ce poste, en attente de synchronisation avec le serveur.</span
            >
          </p>
          <template v-if="localReceipts.get(payment.paymentId)">
            <AppButton
              variant="secondary"
              :accessible-name="`${openedReceipts.includes(payment.paymentId) ? 'Masquer le reçu' : 'Voir le reçu'} ${payment.receiptNumber ?? ''}`"
              @click="toggleReceipt(payment.paymentId)"
              >{{
                openedReceipts.includes(payment.paymentId) ? 'Masquer le reçu' : 'Voir le reçu'
              }}</AppButton
            >
            <ReceiptPanel
              v-if="openedReceipts.includes(payment.paymentId)"
              :receipt-id="payment.receiptId ?? payment.paymentId"
              :local="localReceipts.get(payment.paymentId) ?? null"
            />
          </template>
        </li>
      </ul>
      <p v-if="otherPayments.length > 0" class="text-sm text-muted">
        {{ otherPayments.length }} encaissement(s) non confirmé(s) : ils ne comptent pas dans le
        total encaissé.
      </p>
    </section>

    <section v-if="lastReceiptId" aria-live="polite" class="space-y-3">
      <StateMessage state="success" title="Encaissement enregistré sur le serveur">
        Reçu {{ lastReceiptNumber ?? '' }} créé. Reste à encaisser maintenant :
        {{ formatMoney(amountDue) }}.
      </StateMessage>
      <ReceiptPanel :key="lastReceiptId" :receipt-id="lastReceiptId" highlight />
    </section>

    <section v-if="localNotice" aria-live="polite" class="space-y-3">
      <StateMessage state="offline" title="Encaissement noté sur ce poste">
        Encaissement enregistré sur ce poste, en attente de synchronisation avec le serveur. Reçu
        {{ localNotice.receiptNumber ?? '' }} pris dans la plage de ce poste : son numéro ne
        changera pas. Reste à encaisser maintenant : {{ formatMoney(amountDue) }}.
      </StateMessage>
    </section>

    <StateMessage v-if="reviewBlocked" state="conflict" title="Encaissement du poste à revoir">
      Un encaissement enregistré sur ce poste est en conflit : aucun nouvel encaissement sans la
      décision de la gérante.
    </StateMessage>

    <StateMessage v-else-if="held" state="conflict" title="Facture détenue par un poste préparé">
      Un poste préparé détient cette facture : l’encaissement se fait sur ce poste, pas depuis cet
      écran.
    </StateMessage>

    <template v-else-if="canCollect && amountDue > 0">
      <PaymentForm
        v-if="showPaymentForm"
        :key="paymentGeneration"
        :invoice="effectiveInvoice"
        :cash-session-id="cashSessionId"
        :cash-session-read="cashSessionRead"
        @recorded="onRecorded"
        @recorded-local="onRecordedLocal"
        @stale="emit('reload')"
        @recheck-cash="recheckCash"
      />
      <AppButton v-else variant="primary" @click="newPayment">Nouvel encaissement</AppButton>
    </template>

    <StateMessage v-if="props.local" state="offline" title="Facture de ce poste">
      Cette facture est enregistrée sur ce poste, en attente de synchronisation : la remise au
      patient, les avoirs et les corrections se feront après l’envoi au serveur.
    </StateMessage>
    <template v-else>
      <DeliveriesPanel
        :key="`remises-${props.invoice.ledger_version ?? 0}`"
        :invoice="props.invoice"
      />

      <CorrectionsPanel
        :invoice="props.invoice"
        :cash-session-id="cashSessionId"
        :cash-session-read="cashSessionRead"
        @reload="emit('reload')"
      />
    </template>

    <section aria-labelledby="titre-pdf-facture" class="space-y-3">
      <h2 id="titre-pdf-facture" class="text-lg font-semibold">Document de la facture</h2>
      <p class="text-sm text-muted">
        PDF généré sur ce poste depuis les données figées à l’émission ; une réimpression rend la
        même pièce. Il n’est pas conservé après la fermeture du navigateur dans cette version.
      </p>
      <AppButton
        variant="secondary"
        :pending="generating"
        pending-label="Génération du PDF…"
        @click="previewInvoice"
        >{{ rendered ? 'Réimprimer la facture' : 'Aperçu de la facture (PDF)' }}</AppButton
      >
      <StateMessage v-if="documentProblem" state="error" title="PDF non généré">
        {{ documentProblem }}
      </StateMessage>
      <DocumentPreview
        v-if="rendered"
        :document="rendered"
        :heading="`Facture ${props.invoice.number ?? ''}`"
      />
    </section>
  </div>
</template>
