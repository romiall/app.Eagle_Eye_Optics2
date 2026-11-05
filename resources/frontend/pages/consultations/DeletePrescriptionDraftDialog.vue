<script setup lang="ts">
/**
 * « Supprimer le brouillon » d'une prescription optique (écran de prescription d'une consultation et ordonnances externes
 * d'un patient), EN LIGNE. La boîte est montée par l'écran seulement quand la suppression est demandée. Le serveur applique
 * la règle : seul un brouillon jamais utilisé se supprime (une prescription validée est immuable : 409, elle se corrige par
 * une nouvelle version) ; le jeton `expected_updated_at` est celui lu avec le brouillon (409 s'il a été modifié ailleurs).
 * Une reprise après coupure rejoue la même commande (même clé), jamais deux suppressions ; un brouillon déjà supprimé répond
 * « introuvable » et l'écran le dit.
 */
import { computed, ref } from 'vue'

import type { MutationOutcome } from '@/app/services/mutations'
import { useMutation } from '@/app/services/useMutation'
import { revalidateSession } from '@/app/session'
import ConfirmDialog from '@/components/feedback/ConfirmDialog.vue'

const props = defineProps<{
  prescriptionId: string
  /** Jeton de concurrence lu avec le brouillon (`updated_at`). */
  updatedAt: string
  versionNo: number
}>()

const emit = defineEmits<{
  deleted: [message: string]
  /** Non supprimé (modifié ailleurs, déjà validé, introuvable ou refusé) : l'écran relit et dit pourquoi. */
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
      emit('deleted', 'Le brouillon de prescription a été supprimé.')
      return
    case 'conflict':
      emit('stale', 'Ce brouillon a été modifié entre-temps : il n’a pas été supprimé.')
      return
    case 'refused':
      if (outcome.error.status === 404) {
        emit('stale', 'Cette prescription n’existe plus (déjà supprimée ?).')
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
      name: 'DeletePrescriptionDraft',
      route: { method: 'POST', path: `/prescriptions/${props.prescriptionId}/delete` },
      payload: { prescription_id: props.prescriptionId, expected_updated_at: props.updatedAt },
    }),
  )
}
</script>

<template>
  <ConfirmDialog
    :open="true"
    :title="`Supprimer le brouillon de la version ${props.versionNo} ?`"
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
        Ce brouillon n’a jamais été validé : il est supprimé définitivement. Une prescription
        validée ne se supprime pas, elle se corrige par une nouvelle version.
      </p>
      <p v-if="failure" role="alert" class="max-w-prose font-semibold text-danger">
        {{ failure }}
      </p>
    </div>
  </ConfirmDialog>
</template>
