<script setup lang="ts">
/**
 * « Supprimer le brouillon » d'un devis jamais émis (écran du devis), EN LIGNE. La boîte est montée par l'écran seulement
 * quand la suppression est demandée. Le serveur applique la règle : seul un brouillon sans numéro ni révision se supprime
 * (un devis émis se révise, 409), son créateur ou la gérante seulement (403), version du brouillon attendue (409 s'il a
 * changé). Aucun numéro n'est consommé, aucun article n'est réservé, aucune créance n'existe : il n'y a rien à défaire.
 * Une reprise après coupure rejoue la même commande (même clé), jamais deux suppressions.
 */
import { computed, ref } from 'vue'

import type { MutationOutcome } from '@/app/services/mutations'
import { quotePath } from '@/app/services/quotes'
import { useMutation } from '@/app/services/useMutation'
import { revalidateSession } from '@/app/session'
import ConfirmDialog from '@/components/feedback/ConfirmDialog.vue'

const props = defineProps<{
  quoteId: string
  /** Version du brouillon lue par l'écran (attendue par le serveur). */
  version: number
  /** Nombre de lignes du brouillon, dit dans la confirmation. */
  lines: number
}>()

const emit = defineEmits<{
  deleted: [message: string]
  /** Non supprimé (modifié ailleurs, déjà émis, introuvable ou refusé) : l'écran relit et dit pourquoi. */
  stale: [message: string]
  close: []
}>()

const mutation = useMutation()
const failure = ref<string | null>(null)
const saving = computed(() => mutation.state.value === 'saving')

function close(): void {
  if (saving.value) return
  emit('close')
}

async function afterOutcome(outcome: MutationOutcome): Promise<void> {
  switch (outcome.kind) {
    case 'synced':
      emit('deleted', 'Le brouillon de devis a été supprimé.')
      return
    case 'conflict':
      emit('stale', 'Ce brouillon a changé entre-temps : il n’a pas été supprimé.')
      return
    case 'refused':
      if (outcome.error.status === 404) {
        emit('stale', 'Ce devis n’existe plus (déjà supprimé ?).')
        return
      }
      if (outcome.error.status === 409 || outcome.error.status === 403) {
        emit('stale', `Le brouillon n’a pas été supprimé : ${outcome.error.message}`)
        return
      }
      failure.value = outcome.error.message
      return
    case 'session-expired':
    case 'reauthentication-required':
      void revalidateSession().catch(() => undefined)
      failure.value = mutation.failureMessage.value
      return
    default:
      failure.value = mutation.failureMessage.value
  }
}

async function confirm(): Promise<void> {
  if (saving.value) return
  failure.value = null
  await afterOutcome(
    await mutation.submit({
      name: 'DeleteQuoteDraft',
      route: {
        method: 'POST',
        path: quotePath(props.quoteId, 'delete'),
        expectedVersion: 'entity',
      },
      payload: { quote_id: props.quoteId },
      expectedVersion: props.version,
    }),
  )
}
</script>

<template>
  <ConfirmDialog
    :open="true"
    title="Supprimer ce brouillon de devis ?"
    confirm-label="Supprimer le brouillon"
    cancel-label="Garder le brouillon"
    tone="danger"
    :pending="saving"
    pending-label="Suppression en cours…"
    @confirm="confirm"
    @cancel="close"
  >
    <div class="space-y-3">
      <p class="max-w-prose">
        Ce devis n’a jamais été émis : il n’a ni numéro ni révision. Il est supprimé définitivement,
        avec ses {{ props.lines }} ligne{{ props.lines > 1 ? 's' : '' }}. Un devis émis ne se
        supprime pas : il se révise.
      </p>
      <p v-if="failure" role="alert" class="max-w-prose font-semibold text-danger">
        {{ failure }}
      </p>
    </div>
  </ConfirmDialog>
</template>
