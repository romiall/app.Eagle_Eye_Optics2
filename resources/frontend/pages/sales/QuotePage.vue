<script setup lang="ts">
/**
 * Devis (L1D07) : un brouillon s'édite et s'émet (`QuoteEditor`) ; un devis émis se lit (lignes de la révision
 * actuelle), se révise (nouvelle révision figée, avec motif), reçoit la réponse du client (accepté, refusé) et se
 * convertit en BROUILLON de facture (`QuoteConvertPanel`). Toutes les révisions restent réimprimables
 * (`QuoteRevisions`). Le devis est relu sur le serveur ; sans réponse, il est « indisponible », jamais une ancienne
 * copie présentée comme actuelle. L'identifiant de l'adresse est un ULID opaque : aucune donnée personnelle dans l'URL.
 */
import { computed, ref, shallowRef, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

import { clinicTimeZone } from '@/app/clinicTime'
import type { MutationOutcome } from '@/app/services/mutations'
import { getQuote, quotePath } from '@/app/services/quotes'
import { useMutation } from '@/app/services/useMutation'
import { canOnScreen, revalidateSession } from '@/app/session'
import ConfirmDialog from '@/components/feedback/ConfirmDialog.vue'
import FreshnessNote from '@/components/feedback/FreshnessNote.vue'
import StateMessage from '@/components/feedback/StateMessage.vue'
import { formatDateFr } from '@/components/form/format'
import TextAreaField from '@/components/form/TextAreaField.vue'
import AppButton from '@/components/ui/AppButton.vue'
import LinkButton from '@/components/ui/LinkButton.vue'
import {
  buildDecisionPayload,
  quoteActions,
  quoteStatusLabel,
  quoteStatusSymbol,
  quoteTitle,
  recipientLabel,
} from '@/domain/billing/quote'
import type { Quote, QuoteResponse } from '@/domain/contracts/generated'
import { useServerRead } from '@/pages/today/useServerRead'

import { salesFailureView } from './failureView'
import { setSalesFlash, takeSalesFlash } from './flash'
import { formatMoney, invoiceStatusLabel, quantityLabel, unitLabel } from './format'
import QuoteConvertPanel from './QuoteConvertPanel.vue'
import QuoteEditor from './QuoteEditor.vue'
import QuoteRevisions from './QuoteRevisions.vue'
import SalesReadMessage from './SalesReadMessage.vue'

const route = useRoute()
const router = useRouter()
const id = computed(() => String(route.params['id']))
const flash = shallowRef<string | null>(takeSalesFlash())
const timeZone = clinicTimeZone()

const read = useServerRead<Quote>(() => getQuote(id.value))
watch(id, () => void read.reload())

/** Devis lu pour CET identifiant : une lecture précédente ne s'affiche jamais à sa place. */
const quote = computed(() => (read.data.value?.id === id.value ? read.data.value : null))
const actions = computed(() =>
  quote.value === null ? null : quoteActions(quote.value, canOnScreen('invoice.create')),
)

const revising = ref(false)
const converting = ref(false)

function show(next: Quote): void {
  flash.value = takeSalesFlash()
  read.data.value = next
  revising.value = false
  converting.value = false
}

function reload(): void {
  revising.value = false
  converting.value = false
  void read.reload()
}

/** Brouillon supprimé : le devis n'existe plus, retour à la liste (le message du résultat est déjà passé à l'écran). */
function leaveDeleted(): void {
  void router.push({ name: 'devis' })
}

// --- Réponse du client ----------------------------------------------------------------------------

const DECISION_REASON_ID = 'devis-reponse-motif'
const decision = ref<'ACCEPTED' | 'DECLINED' | null>(null)
const decisionReason = ref('')
const decisionMutation = useMutation()
const deciding = computed(() => decisionMutation.state.value === 'saving')
const decisionFailure = computed(() => salesFailureView(decisionMutation.state.value))
const decisionRefusal = ref<string | null>(null)

function askDecision(next: 'ACCEPTED' | 'DECLINED'): void {
  decisionRefusal.value = null
  decisionReason.value = ''
  decision.value = next
}

async function afterDecision(result: MutationOutcome): Promise<void> {
  const chosen = decision.value
  decision.value = null
  switch (result.kind) {
    case 'synced':
      setSalesFlash(
        chosen === 'ACCEPTED'
          ? 'Devis accepté par le client : aucune facture n’est créée tant qu’il n’est pas converti.'
          : 'Devis refusé par le client.',
      )
      show((result.result as QuoteResponse).data)
      return
    case 'conflict':
      decisionRefusal.value = 'Le devis a changé entre-temps : il est relu.'
      reload()
      return
    case 'refused':
      decisionRefusal.value = result.error.message
      if (result.error.code === 'STATE_TRANSITION_REFUSED') reload()
      return
    case 'session-expired':
    case 'reauthentication-required':
      void revalidateSession().catch(() => undefined)
      return
    default:
      return
  }
}

async function confirmDecision(): Promise<void> {
  const current = quote.value
  const chosen = decision.value
  if (current === null || chosen === null || deciding.value) return
  await afterDecision(
    await decisionMutation.submit({
      name: 'RecordQuoteDecision',
      route: { method: 'POST', path: quotePath(current.id, 'decision'), expectedVersion: 'entity' },
      payload: buildDecisionPayload(current.id, chosen, decisionReason.value),
      expectedVersion: current.version,
    }),
  )
}

async function retryDecision(): Promise<void> {
  if (deciding.value) return
  await afterDecision(await decisionMutation.retry())
}
</script>

<template>
  <section aria-labelledby="titre-devis-detail" class="max-w-3xl space-y-6">
    <StateMessage v-if="flash" state="success" :title="flash" />

    <template v-if="quote">
      <div class="space-y-1">
        <h1 id="titre-devis-detail" class="text-2xl font-semibold tracking-tight break-words">
          {{ quoteTitle(quote.number) }}
        </h1>
        <p class="text-base text-muted">
          <span aria-hidden="true">{{ quoteStatusSymbol(quote.effective_status) }}</span>
          {{ quoteStatusLabel(quote.effective_status) }}
          <template v-if="quote.current_revision > 0">
            · révision {{ quote.current_revision }}</template
          >
        </p>
        <p class="text-base break-words">Pour : {{ recipientLabel(quote.recipient) }}</p>
        <p v-if="quote.valid_until" class="text-base">
          Valable jusqu’au {{ formatDateFr(quote.valid_until) }}
        </p>
        <p class="text-sm font-medium">Devis — ne vaut pas facture.</p>
      </div>

      <SalesReadMessage
        v-if="read.state.value !== 'ready' && read.state.value !== 'loading'"
        :state="read.state.value"
        subject="le devis"
        :error="read.error.value"
        not-found-title="Devis introuvable"
        @retry="reload"
      />

      <StateMessage v-if="quote.effective_status === 'EXPIRED'" state="empty" title="Devis expiré">
        Sa date de validité est passée : il ne s’accepte ni ne se convertit plus. Une révision lui
        donne une nouvelle validité.
      </StateMessage>

      <div v-if="quote.invoices.length > 0" class="space-y-1">
        <h2 class="text-lg font-semibold">Factures nées de ce devis</h2>
        <ul class="space-y-1">
          <li v-for="invoice in quote.invoices" :key="invoice.id">
            <RouterLink
              :to="{ name: 'facture', params: { id: invoice.id } }"
              class="inline-flex min-h-11 items-center font-semibold text-primary underline underline-offset-4"
              >{{ invoice.number ?? 'Brouillon de facture sans numéro' }}</RouterLink
            >
            · {{ invoiceStatusLabel(invoice.status) }}
          </li>
        </ul>
      </div>

      <QuoteEditor
        v-if="quote.status === 'DRAFT'"
        :key="`brouillon-${quote.id}`"
        :initial="quote"
        @issued="show"
        @deleted="leaveDeleted"
        @stale="reload"
      />

      <template v-else>
        <QuoteEditor
          v-if="revising"
          :key="`revision-${quote.id}-${quote.version}`"
          mode="revision"
          :initial="quote"
          @revised="show"
          @stale="reload"
          @cancel="revising = false"
        />
        <section v-else aria-labelledby="titre-lignes-actuelles" class="space-y-3">
          <h2 id="titre-lignes-actuelles" class="text-lg font-semibold">
            Lignes de la révision {{ quote.current_revision }}
          </h2>
          <ul class="space-y-2">
            <li
              v-for="line in quote.lines"
              :key="line.id"
              class="rounded-lg border border-line bg-surface p-3"
            >
              <p class="font-medium break-words">{{ line.description_snapshot }}</p>
              <p class="text-sm">
                {{ quantityLabel(line.quantity) }} {{ unitLabel(line.unit_code) }} ×
                <span class="tabular-nums">{{ formatMoney(line.unit_price_gross) }}</span>
                <template v-if="line.discount_gross > 0">
                  − remise <span class="tabular-nums">{{ formatMoney(line.discount_gross) }}</span>
                </template>
                = <strong class="tabular-nums">{{ formatMoney(line.line_total_gross) }}</strong>
              </p>
            </li>
          </ul>
          <p class="text-base font-semibold">
            Total TTC proposé :
            <span class="tabular-nums" data-montant="total-devis">{{
              formatMoney(quote.total_gross)
            }}</span>
          </p>

          <div v-if="actions" class="flex flex-wrap gap-3">
            <AppButton v-if="actions.convert" variant="primary" @click="converting = !converting">{{
              converting ? 'Fermer la conversion' : 'Convertir en facture'
            }}</AppButton>
            <AppButton v-if="actions.revise" variant="secondary" @click="revising = true"
              >Réviser le devis</AppButton
            >
            <AppButton v-if="actions.accept" variant="secondary" @click="askDecision('ACCEPTED')"
              >Accepté par le client</AppButton
            >
            <AppButton v-if="actions.decline" variant="ghost" @click="askDecision('DECLINED')"
              >Refusé par le client</AppButton
            >
          </div>

          <StateMessage
            v-if="decisionFailure"
            :state="decisionFailure.state"
            :title="decisionFailure.title"
          >
            {{ decisionMutation.failureMessage.value }}
            <template v-if="decisionFailure.retry" #action>
              <AppButton variant="secondary" :pending="deciding" @click="retryDecision"
                >Réessayer</AppButton
              >
            </template>
          </StateMessage>
          <StateMessage v-if="decisionRefusal" state="error" title="Réponse non enregistrée">
            {{ decisionRefusal }}
          </StateMessage>

          <QuoteConvertPanel
            v-if="converting && actions?.convert"
            :key="`conversion-${quote.id}-${quote.version}`"
            :quote="quote"
            @stale="reload"
          />
        </section>
      </template>

      <QuoteRevisions :quote="quote" />

      <FreshnessNote
        v-if="read.freshness.value"
        :freshness="read.freshness.value"
        :time-zone="timeZone"
      />
    </template>

    <template v-else>
      <h1 id="titre-devis-detail" class="text-2xl font-semibold tracking-tight">Devis</h1>
      <StateMessage v-if="read.state.value === 'ready'" state="error" title="Devis inattendu">
        Le serveur a répondu avec un autre devis que celui demandé : rien n’est affiché.
      </StateMessage>
      <SalesReadMessage
        :state="read.state.value"
        subject="le devis"
        :error="read.error.value"
        not-found-title="Devis introuvable"
        @retry="reload"
      />
    </template>

    <ConfirmDialog
      :open="decision !== null"
      :title="
        decision === 'ACCEPTED' ? 'Le client accepte ce devis ?' : 'Le client refuse ce devis ?'
      "
      :confirm-label="
        decision === 'ACCEPTED' ? 'Enregistrer l’acceptation' : 'Enregistrer le refus'
      "
      pending-label="Enregistrement…"
      :pending="deciding"
      :initial-focus="`#${DECISION_REASON_ID}`"
      @confirm="confirmDecision"
      @cancel="decision = null"
    >
      <p v-if="decision === 'ACCEPTED'">
        L’acceptation ne crée ni facture ni paiement : la facture naîtra d’une conversion explicite.
      </p>
      <p v-else>Le devis restera consultable et réimprimable ; il pourra être révisé.</p>
      <div class="mt-3">
        <TextAreaField
          v-model="decisionReason"
          label="Précision (facultative)"
          hint="Conservée dans le journal d’audit."
          :control-id="DECISION_REASON_ID"
          :maxlength="1000"
          :rows="2"
        />
      </div>
    </ConfirmDialog>

    <LinkButton :to="{ name: 'devis' }" variant="ghost">Retour aux devis</LinkButton>
  </section>
</template>
