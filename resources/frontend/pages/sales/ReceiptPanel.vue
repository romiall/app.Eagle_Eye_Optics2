<script setup lang="ts">
/**
 * Reçu d'un encaissement (B04 ; fichier 11 : « Chaque acompte/paiement complémentaire a son reçu »),
 * lu sur le serveur : numéro définitif (jamais renuméroté), montant, mode, nature calculée par le
 * serveur (acompte ou règlement du solde) et reste après ce reçu, d'après le snapshot FIGÉ. Le PDF est
 * généré sur ce poste depuis ce snapshot ; une réimpression rend la même pièce et ne déclenche
 * jamais un nouvel encaissement. Aucun mot « payé », « soldé » ni « acquitté ».
 */
import { computed, ref, shallowRef } from 'vue'

import { formatInstantFr } from '@/app/clinicTime'
import { getReceipt } from '@/app/services/billing'
import type { RenderedDocument } from '@/app/services/documents'
import { receiptDocument } from '@/app/services/salesDocuments'
import DocumentPreview from '@/components/documents/DocumentPreview.vue'
import StateMessage from '@/components/feedback/StateMessage.vue'
import AppButton from '@/components/ui/AppButton.vue'
import { receiptKindLabel } from '@/domain/billing/payment'
import type { Receipt } from '@/domain/contracts/generated'
import { useServerRead } from '@/pages/today/useServerRead'

import { formatMoney, paymentMethodLabel } from './format'
import SalesReadMessage from './SalesReadMessage.vue'

/**
 * `local` : reçu d'un encaissement enregistré sur CE poste (G1), au format du reçu du serveur, que le serveur ne
 * connaît pas encore : rien n'est lu, le PDF se produit sans réseau depuis ce reçu (numéro de la plage du poste).
 */
const props = withDefaults(
  defineProps<{ receiptId: string; highlight?: boolean; local?: Receipt | null }>(),
  { highlight: false, local: null },
)

const read = useServerRead<Receipt>(() =>
  props.local === null
    ? getReceipt(props.receiptId)
    : Promise.resolve({
        data: props.local,
        freshness: { serverAsOf: null, complete: false },
        live: false,
      }),
)
const receipt = computed(() => (read.data.value?.id === props.receiptId ? read.data.value : null))

const rendered = shallowRef<RenderedDocument | null>(null)
const generating = ref(false)
const documentProblem = ref<string | null>(null)

const documentStatus = computed(() => {
  const status = receipt.value?.document?.document_status ?? null
  switch (status) {
    case 'READY':
      return 'PDF déposé sur le serveur.'
    case 'FAILED':
      return 'PDF du serveur à régénérer : le reçu existe, il ne faut pas encaisser à nouveau.'
    case 'PENDING':
      return 'PDF du serveur en préparation : le reçu existe déjà, il ne faut pas encaisser à nouveau.'
    default:
      return null
  }
})

async function preview(): Promise<void> {
  const current = receipt.value
  if (current === null || generating.value) return
  generating.value = true
  documentProblem.value = null
  try {
    rendered.value = await receiptDocument(current)
  } catch (error) {
    documentProblem.value =
      error instanceof Error
        ? `Le PDF du reçu n’a pas pu être généré : ${error.message} Le reçu existe : ne recommencez pas l’encaissement.`
        : 'Le PDF du reçu n’a pas pu être généré. Le reçu existe : ne recommencez pas l’encaissement.'
  } finally {
    generating.value = false
  }
}
</script>

<template>
  <section
    :aria-labelledby="`recu-${props.receiptId}`"
    :class="[
      'space-y-3 rounded-xl border p-4',
      props.highlight ? 'border-accent bg-accent-soft' : 'border-line bg-surface',
    ]"
  >
    <SalesReadMessage
      v-if="read.state.value !== 'ready'"
      :state="read.state.value"
      subject="le reçu"
      :error="read.error.value"
      not-found-title="Reçu introuvable"
      @retry="read.reload()"
    />
    <template v-if="receipt">
      <h3 :id="`recu-${props.receiptId}`" class="text-lg font-semibold break-words">
        Reçu {{ receipt.number }}
      </h3>
      <dl class="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        <div>
          <dt class="text-sm text-muted">Montant reçu</dt>
          <dd class="text-xl font-semibold tabular-nums">
            {{ formatMoney(receipt.snapshot.payment.amount) }}
          </dd>
        </div>
        <div>
          <dt class="text-sm text-muted">
            Nature (calculée {{ props.local === null ? 'par le serveur' : 'sur ce poste' }})
          </dt>
          <dd>{{ receiptKindLabel(receipt.snapshot.kind) }}</dd>
        </div>
        <div>
          <dt class="text-sm text-muted">Mode de règlement</dt>
          <dd>
            {{ paymentMethodLabel(receipt.snapshot.payment.method)
            }}<template v-if="receipt.snapshot.payment.reference">
              · référence {{ receipt.snapshot.payment.reference }}</template
            >
          </dd>
        </div>
        <div>
          <dt class="text-sm text-muted">Date de l’encaissement</dt>
          <dd>{{ formatInstantFr(receipt.snapshot.effective_at) }}</dd>
        </div>
        <div>
          <dt class="text-sm text-muted">Total encaissé après ce reçu</dt>
          <dd class="tabular-nums">{{ formatMoney(receipt.snapshot.paid_net_after) }}</dd>
        </div>
        <div>
          <dt class="text-sm text-muted">Reste à encaisser après ce reçu</dt>
          <dd class="tabular-nums">
            {{ formatMoney(Math.max(0, receipt.snapshot.balance_after)) }}
          </dd>
        </div>
        <div>
          <dt class="text-sm text-muted">Facture</dt>
          <dd>{{ receipt.snapshot.invoice.number }}</dd>
        </div>
        <div>
          <dt class="text-sm text-muted">Encaissé par</dt>
          <dd class="break-words">{{ receipt.snapshot.cashier.display_name }}</dd>
        </div>
      </dl>
      <p v-if="receipt.snapshot.clinic.test_document" class="text-sm font-medium">
        <span aria-hidden="true">⚠ </span>Document de test : numéro et mentions de test (données
        fictives).
      </p>
      <p v-if="props.local !== null" class="text-sm text-muted">
        Reçu enregistré sur ce poste, en attente de synchronisation : son numéro est définitif et ne
        changera pas.
      </p>
      <p v-if="documentStatus" class="text-sm text-muted">{{ documentStatus }}</p>
      <div class="flex flex-wrap gap-3">
        <AppButton
          variant="secondary"
          :pending="generating"
          pending-label="Génération du PDF…"
          :accessible-name="`${rendered ? 'Réimprimer le reçu' : 'Aperçu du reçu (PDF)'} ${receipt.number}`"
          @click="preview"
          >{{ rendered ? 'Réimprimer le reçu' : 'Aperçu du reçu (PDF)' }}</AppButton
        >
      </div>
      <StateMessage v-if="documentProblem" state="error" title="PDF non généré">
        {{ documentProblem }}
      </StateMessage>
      <DocumentPreview v-if="rendered" :document="rendered" :heading="`Reçu ${receipt.number}`" />
    </template>
  </section>
</template>
