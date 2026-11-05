<script setup lang="ts">
/**
 * « Supprimer » un examen resté BROUILLON (liste des examens et éditeur), EN LIGNE. La boîte est montée par l'écran
 * seulement quand la suppression est demandée (une seule par page : pas une boîte cachée par carte). Le serveur
 * applique la règle (brouillon seulement, 409 sinon ; auteur ou gérante, 403 sinon ; version attendue, 409 si l'examen a
 * changé) et rend la visite dans son état d'avant l'examen : l'examen peut être redémarré depuis la file du jour. Une
 * reprise après coupure rejoue la même commande (même clé), jamais deux suppressions ; un examen déjà supprimé répond
 * « introuvable » et l'écran le dit au lieu de réessayer.
 */
import { computed, ref } from 'vue'

import type { MutationOutcome } from '@/app/services/mutations'
import { useMutation } from '@/app/services/useMutation'
import { revalidateSession } from '@/app/session'
import ConfirmDialog from '@/components/feedback/ConfirmDialog.vue'

const props = defineProps<{
  consultationId: string
  /** Version de la consultation lue par l'écran (attendue par le serveur). */
  version: number
  patientName: string
}>()

const emit = defineEmits<{
  /** Supprimé sur le serveur : l'écran relit sa liste ou quitte la consultation. */
  deleted: [message: string]
  /** Non supprimé (l'examen a changé, n'existe plus, ou le serveur refuse) : l'écran relit et dit pourquoi. */
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
      // Message sans nom de patient : il peut passer d'un écran au suivant (voir `flash.ts`).
      emit(
        'deleted',
        'L’examen a été supprimé. Sa visite est revenue dans la file du jour : l’examen peut être redémarré.',
      )
      return
    case 'conflict':
      emit('stale', 'L’examen a changé entre-temps : il n’a pas été supprimé.')
      return
    case 'refused':
      if (outcome.error.status === 404) {
        emit('stale', 'Cet examen n’existe plus (déjà supprimé ?).')
        return
      }
      if (outcome.error.status === 409 || outcome.error.status === 403) {
        emit('stale', `L’examen n’a pas été supprimé : ${outcome.error.message}`)
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
      name: 'DeleteConsultationDraft',
      route: {
        method: 'POST',
        path: `/consultations/${props.consultationId}/delete`,
        expectedVersion: 'entity',
      },
      payload: { consultation_id: props.consultationId },
      expectedVersion: props.version,
    }),
  )
}
</script>

<template>
  <ConfirmDialog
    :open="true"
    :title="`Supprimer l’examen de ${props.patientName} ?`"
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
        Ce brouillon n’a aucune rubrique enregistrée. Il est supprimé définitivement, avec sa
        prescription brouillon éventuelle.
      </p>
      <p class="max-w-prose">
        La visite revient dans la file du jour : l’examen pourra être redémarré. Un examen en cours
        ou terminé ne se supprime pas.
      </p>
      <p v-if="failure" role="alert" class="max-w-prose font-semibold text-danger">
        {{ failure }}
      </p>
    </div>
  </ConfirmDialog>
</template>
