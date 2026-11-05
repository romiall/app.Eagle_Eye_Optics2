<script setup lang="ts">
/**
 * « Annuler le contrôle » recommandé (consultation et liste des patients à revoir), EN LIGNE. La boîte est montée par
 * l'écran seulement quand l'annulation est demandée. Le contrôle reste lisible, marqué annulé, et disparaît de la liste des
 * patients à revoir ; ses rappels internes ouverts sont clos. Motif obligatoire (3 à 1 000 caractères, information
 * d'accueil seulement : conservé dans l'audit). Le serveur applique la règle : un contrôle actif seulement (409 s'il est
 * programmé par un rendez-vous, déjà annulé ou clos), version attendue (409 s'il a changé), droit de programmer les contrôles
 * et lecture clinique (403). Une reprise après coupure rejoue la même commande (même clé), jamais deux annulations.
 */
import { computed, ref, useId } from 'vue'

import type { MutationOutcome } from '@/app/services/mutations'
import { useMutation } from '@/app/services/useMutation'
import { revalidateSession } from '@/app/session'
import ConfirmDialog from '@/components/feedback/ConfirmDialog.vue'
import TextAreaField from '@/components/form/TextAreaField.vue'

const REASON_MIN_LENGTH = 3
const REASON_MAX_LENGTH = 1000

const props = defineProps<{
  planId: string
  /** Version du contrôle lue par l'écran (attendue par le serveur). */
  version: number
  patientName: string
}>()

const emit = defineEmits<{
  cancelled: [message: string]
  /** Non annulé (modifié ailleurs, programmé par un rendez-vous, déjà annulé, introuvable ou refusé). */
  stale: [message: string]
  close: []
}>()

const REASON_ID = `${useId()}-motif-annulation-controle`
const mutation = useMutation()
const reason = ref('')
const error = ref<string | null>(null)
const saving = computed(() => mutation.state.value === 'saving')

function close(): void {
  if (saving.value) return
  emit('close')
}

async function afterOutcome(outcome: MutationOutcome): Promise<void> {
  switch (outcome.kind) {
    case 'synced':
      emit(
        'cancelled',
        'Le contrôle recommandé a été annulé : il reste lisible dans la consultation.',
      )
      return
    case 'conflict':
      emit('stale', 'Le contrôle a changé entre-temps : il n’a pas été annulé.')
      return
    case 'refused':
      if (outcome.error.status === 404) {
        emit('stale', 'Ce contrôle n’existe plus.')
        return
      }
      if (outcome.error.status === 409 || outcome.error.status === 403) {
        emit('stale', `Le contrôle n’a pas été annulé : ${outcome.error.message}`)
        return
      }
      error.value = outcome.error.fields['reason']?.[0] ?? outcome.error.message
      return
    case 'session-expired':
    case 'reauthentication-required':
      void revalidateSession().catch(() => undefined)
      error.value = mutation.failureMessage.value
      return
    default:
      error.value = mutation.failureMessage.value
  }
}

async function confirm(): Promise<void> {
  if (saving.value) return
  const text = reason.value.trim()
  if (text.length < REASON_MIN_LENGTH) {
    error.value = `Indiquez le motif de l’annulation (au moins ${REASON_MIN_LENGTH} caractères).`
    document.getElementById(REASON_ID)?.focus()
    return
  }
  error.value = null
  await afterOutcome(
    await mutation.submit({
      name: 'CancelFollowUp',
      route: {
        method: 'POST',
        path: `/follow-ups/${props.planId}/cancel`,
        expectedVersion: 'entity',
      },
      payload: { follow_up_plan_id: props.planId, reason: text },
      expectedVersion: props.version,
    }),
  )
}
</script>

<template>
  <ConfirmDialog
    :open="true"
    :title="`Annuler le contrôle de ${props.patientName} ?`"
    confirm-label="Annuler le contrôle"
    cancel-label="Garder le contrôle"
    tone="danger"
    :pending="saving"
    pending-label="Annulation en cours…"
    :initial-focus="`#${REASON_ID}`"
    @confirm="confirm"
    @cancel="close"
  >
    <div class="space-y-3">
      <p class="max-w-prose">
        Le contrôle reste lisible dans la consultation, marqué annulé, et disparaît de la liste des
        patients à revoir ; ses rappels internes ouverts sont clos. Un contrôle déjà programmé par
        un rendez-vous s’annule d’abord en annulant le rendez-vous.
      </p>
      <TextAreaField
        v-model="reason"
        :control-id="REASON_ID"
        label="Motif de l’annulation (obligatoire)"
        hint="Information d’accueil seulement, par exemple « patient suivi ailleurs ». Aucune information médicale détaillée."
        :maxlength="REASON_MAX_LENGTH"
        :error="error"
        :disabled="saving"
      />
    </div>
  </ConfirmDialog>
</template>
