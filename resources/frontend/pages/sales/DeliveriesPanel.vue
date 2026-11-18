<script setup lang="ts">
/**
 * Remises d'une facture ÉMISE (I01, I02), EN LIGNE : ce qui reste à remettre ligne par ligne, l'historique des remises
 * (date, qui a remis, lot) et des retours physiques, puis les actions :
 *  - « Remettre au patient » (`delivery.confirm`) tant qu'une ligne reste à remettre ;
 *  - « Enregistrer un retour » d'une ligne remise (`stock.adjust`, module « stock »), sans avoir.
 * Tout vient du serveur (`GET /invoices/{id}/deliveries`) ; une facture détenue par un poste préparé se remet sur ce
 * poste. Aucun texte ne dit « payé » ni « soldé » : seule la projection du reste à encaisser est affichée.
 */
import { computed, ref } from 'vue'

import { formatInstantFr } from '@/app/clinicTime'
import { getInvoiceDeliveries } from '@/app/services/deliveries'
import { canOnScreen, moduleOpenOnScreen } from '@/app/session'
import StateMessage from '@/components/feedback/StateMessage.vue'
import AppButton from '@/components/ui/AppButton.vue'
import { heldByDevice } from '@/domain/billing/issueInvoice'
import type { Invoice, InvoiceDeliveries } from '@/domain/contracts/generated'
import {
  CONDITION_LABELS,
  type DeliveredLine,
  fullyDelivered,
  pendingLines,
  quantityLabel,
} from '@/domain/inventory/delivery'
import { useServerRead } from '@/pages/today/useServerRead'

import DeliveryForm from './DeliveryForm.vue'
import PhysicalReturnForm from './PhysicalReturnForm.vue'
import SalesReadMessage from './SalesReadMessage.vue'

const props = defineProps<{ invoice: Invoice }>()

const read = useServerRead<InvoiceDeliveries>(() => getInvoiceDeliveries(props.invoice.id))

type Action = { kind: 'deliver' } | { kind: 'return'; deliveryId: string; line: DeliveredLine }

const action = ref<Action | null>(null)
/** Nouvelle intention : recrée le formulaire (nouvelle clé, nouveaux identifiants). */
const generation = ref(0)
const notice = ref<string | null>(null)

const view = computed(() => read.data.value)
/** Lecture absente du serveur (404 : module des ventes fermé, version antérieure) : la section n'est pas montrée. */
const unavailable = computed(() => read.state.value === 'error' && read.error.value?.status === 404)
const held = computed(() => heldByDevice(props.invoice))
const mayDeliver = computed(() => canOnScreen('delivery.confirm'))
const mayReturn = computed(() => canOnScreen('stock.adjust') && moduleOpenOnScreen('stock'))
const pending = computed(() => (view.value === null ? [] : pendingLines(view.value)))
const deliverable = computed(() => pending.value.some((line) => line.deliverable))
const complete = computed(() => view.value !== null && fullyDelivered(view.value))
const hasArticles = computed(() => view.value?.lines.some((line) => line.item_id !== null) ?? false)

function integerOnly(invoiceLineId: string): boolean {
  return (
    view.value?.lines.find((line) => line.invoice_line_id === invoiceLineId)
      ?.quantity_integer_only ?? true
  )
}

function descriptionOf(deliveryLineId: string): string {
  for (const delivery of view.value?.deliveries ?? []) {
    const line = delivery.lines.find((entry) => entry.id === deliveryLineId)
    if (line !== undefined) return line.description
  }
  return 'Article remis'
}

function open(next: Action): void {
  notice.value = null
  generation.value += 1
  action.value = next
}

async function done(message: string): Promise<void> {
  action.value = null
  notice.value = message
  await read.reload()
}

async function stale(): Promise<void> {
  await read.reload()
}
</script>

<template>
  <section
    v-if="props.invoice.status === 'ISSUED' && !unavailable"
    aria-labelledby="titre-remises"
    class="space-y-4"
  >
    <h2 id="titre-remises" class="text-lg font-semibold">Remise au patient</h2>
    <p class="max-w-prose text-sm text-muted">
      Livraison ou retrait physique des articles (monture, verres, collyres) au patient ; sort du
      stock sans modifier les prix ni les remises commerciales de la facture.
    </p>

    <StateMessage v-if="notice" state="success" :title="notice" />

    <SalesReadMessage
      v-if="read.state.value !== 'ready' && read.state.value !== 'empty'"
      :state="read.state.value"
      subject="les remises de cette facture"
      :error="read.error.value"
      @retry="read.reload()"
    />
    <template v-else-if="view !== null">
      <p v-if="!hasArticles" class="text-base text-muted">
        Cette facture ne porte aucun article à remettre (prestations seulement).
      </p>
      <template v-else>
        <ul class="space-y-2">
          <li
            v-for="line in view.lines.filter((entry) => entry.item_id !== null)"
            :key="line.invoice_line_id"
            class="rounded-lg border border-line bg-surface p-3"
          >
            <p class="font-semibold break-words">{{ line.description }}</p>
            <p class="text-sm text-muted tabular-nums">
              Facturé {{ quantityLabel(line.quantity) }} · remis {{ quantityLabel(line.delivered) }}
              <template v-if="line.returned !== '0.000'">
                · retourné {{ quantityLabel(line.returned) }}</template
              >
              · <strong>reste à remettre {{ quantityLabel(line.remaining) }}</strong>
            </p>
          </li>
        </ul>

        <StateMessage v-if="complete" state="success" title="Tous les articles sont remis" />

        <StateMessage v-if="held" state="conflict" title="Facture détenue par un poste préparé">
          Un poste préparé détient cette facture : la remise se fait sur ce poste, pas depuis cet
          écran.
        </StateMessage>
        <template v-else-if="mayDeliver && pending.length > 0">
          <DeliveryForm
            v-if="action?.kind === 'deliver'"
            :key="`remise-${generation}`"
            :invoice="props.invoice"
            :view="view"
            @done="done"
            @stale="stale"
            @cancel="action = null"
          />
          <AppButton
            v-else
            variant="primary"
            :disabled="!deliverable"
            @click="open({ kind: 'deliver' })"
            >Remettre au patient</AppButton
          >
          <p v-if="!deliverable" class="text-sm text-muted">
            Aucune ligne restante n’a de réserve ouverte : voir la gérante.
          </p>
        </template>
      </template>

      <section
        v-if="view.deliveries.length > 0"
        aria-labelledby="titre-historique-remises"
        class="space-y-3"
      >
        <h3 id="titre-historique-remises" class="text-base font-semibold">Remises enregistrées</h3>
        <ul class="space-y-3">
          <li
            v-for="delivery in view.deliveries"
            :key="delivery.id"
            class="space-y-2 rounded-lg border border-line p-3"
          >
            <p class="text-sm">
              {{ formatInstantFr(delivery.delivered_at) }}
              <template v-if="delivery.delivered_by_name">
                · par {{ delivery.delivered_by_name }}</template
              >
              <template v-if="delivery.credit_delivery_approval_id">
                · remise avant règlement complet, autorisée par la gérante</template
              >
            </p>
            <ul class="space-y-2">
              <li v-for="line in delivery.lines" :key="line.id" class="space-y-1">
                <p class="break-words">
                  {{ line.description }} : {{ quantityLabel(line.quantity) }}
                  <template v-if="line.batch_number">
                    · lot {{ line.batch_number }}
                    <template v-if="line.expires_on">
                      (expire le {{ line.expires_on.split('-').reverse().join('/') }})</template
                    ></template
                  >
                  <template v-if="line.returned !== '0.000'">
                    · retourné {{ quantityLabel(line.returned) }}</template
                  >
                </p>
                <PhysicalReturnForm
                  v-if="action?.kind === 'return' && action.line.id === line.id"
                  :key="`retour-${generation}`"
                  :invoice="props.invoice"
                  :delivery-id="delivery.id"
                  :line="line"
                  :integer-only="integerOnly(line.invoice_line_id)"
                  @done="done"
                  @stale="stale"
                  @cancel="action = null"
                />
                <AppButton
                  v-else-if="mayReturn && line.returnable !== '0.000'"
                  variant="secondary"
                  :accessible-name="`Enregistrer un retour — ${line.description}`"
                  @click="open({ kind: 'return', deliveryId: delivery.id, line })"
                  >Enregistrer un retour</AppButton
                >
              </li>
            </ul>
          </li>
        </ul>
      </section>

      <section v-if="view.returns.length > 0" aria-labelledby="titre-retours" class="space-y-2">
        <h3 id="titre-retours" class="text-base font-semibold">Retours physiques</h3>
        <ul class="space-y-1 text-base">
          <li v-for="entry in view.returns" :key="entry.id" class="break-words">
            {{ formatInstantFr(entry.occurred_at) }} · {{ descriptionOf(entry.delivery_line_id) }} :
            {{ quantityLabel(entry.quantity) }} · {{ CONDITION_LABELS[entry.condition_code] }} ·
            {{ entry.accepted_for_restock ? 'remis en stock vendable' : 'hors stock vendable' }}
            <template v-if="entry.credit_note_id"> · relié à un avoir</template>
          </li>
        </ul>
      </section>
    </template>
  </section>
</template>
