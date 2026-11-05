<script setup lang="ts">
/**
 * « Démarrer l'examen » d'une visite arrivée (C01 ; commande StartConsultation, droit clinical.write).
 * Contrôle du paiement de l'examen inactif (défaut) : le démarrage n'est pas bloqué par le règlement.
 * Contrôle actif (P03) : c'est le SERVEUR qui exige la facture de frais réglée ou la dispense accordée
 * (retrouvée par son contenu exact) ; un refus `EXAM_PAYMENT_REQUIRED` est dit tel quel sous le bouton,
 * sans rien supposer réglé. La consultation et la clé d'idempotence sont liées à ce bouton : un
 * double clic ou une reprise après coupure ne crée jamais deux consultations. Sur succès (réponse du
 * serveur), la consultation s'ouvre. Un refus d'état (409 : visite déjà démarrée ailleurs, plus
 * « Arrivé ») est dit et la file est relue (événement `stale`). Aucun succès n'est supposé sans
 * réponse : une coupure se reprend avec la même clé. Avec `autostart` (boîte « Nouvelle consultation » :
 * l'arrivée vient d'être enregistrée), le démarrage part à l'affichage du bouton ; un échec reste dit
 * sous le bouton, qui propose alors de réessayer.
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import type { MutationOutcome } from '@/app/services/mutations'
import { useMutation } from '@/app/services/useMutation'
import { revalidateSession } from '@/app/session'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { buildStartConsultationPayload, currentInstant } from '@/domain/clinical/payload'
import type { Visit } from '@/domain/contracts/generated'
import { patientDisplayName } from '@/domain/patients/identity'
import { statusLabel } from '@/domain/patients/visits'
import { isUlid } from '@/domain/values/ulid'

const props = withDefaults(defineProps<{ visit: Visit; autostart?: boolean }>(), {
  autostart: false,
})

const emit = defineEmits<{ stale: [message: string] }>()

const router = useRouter()
const mutation = useMutation()
const { state, failureMessage } = mutation
const opened = ref(false)

const name = computed(() =>
  patientDisplayName(props.visit.patient.last_name, props.visit.patient.first_names),
)

/** Une tentative sans réponse certaine se reprend avec la même clé, jamais avec une nouvelle charge. */
const unresolved = computed(() =>
  [
    'uncertain',
    'unavailable',
    'retryable',
    'session-expired',
    'reauthentication-required',
  ].includes(state.value),
)

const showsFailure = computed(
  () => state.value !== 'idle' && state.value !== 'saving' && state.value !== 'synced',
)

/** Identifiant de la consultation créée : celui de la réponse, sinon celui envoyé. */
function createdId(result: unknown): string {
  const data =
    typeof result === 'object' && result !== null && 'data' in result
      ? (result as { data: unknown }).data
      : null
  const id =
    typeof data === 'object' && data !== null ? (data as Record<string, unknown>)['id'] : null
  return typeof id === 'string' && isUlid(id) ? id : mutation.effectId('consultation_id')
}

/** Statut de la visite que le serveur a opposé au démarrage (409 `STATE_TRANSITION_REFUSED`). */
function staleMessage(outcome: Extract<MutationOutcome, { kind: 'refused' }>): string {
  const current = outcome.error.details['current_status']
  const known = typeof current === 'string' && current !== '' ? statusLabel(current) : null
  return known === null
    ? `Le serveur a refusé de démarrer l’examen de ${name.value} (${outcome.error.message}). La file a été relue.`
    : `L’examen de ${name.value} n’a pas pu être démarré : la visite est maintenant « ${known} ». La file a été relue.`
}

async function afterOutcome(outcome: MutationOutcome): Promise<void> {
  switch (outcome.kind) {
    case 'synced':
      opened.value = true
      await router.push({ name: 'consultation', params: { id: createdId(outcome.result) } })
      return
    case 'refused':
      if (outcome.error.status === 409) emit('stale', staleMessage(outcome))
      return
    case 'session-expired':
    case 'reauthentication-required':
      void revalidateSession().catch(() => undefined)
      return
    default:
      return
  }
}

async function start(): Promise<void> {
  if (state.value === 'saving' || opened.value) return
  if (unresolved.value) {
    await afterOutcome(await mutation.retry())
    return
  }
  const payload = buildStartConsultationPayload(
    props.visit,
    mutation.effectId('consultation_id'),
    currentInstant(),
  )
  await afterOutcome(
    await mutation.submit({
      name: 'StartConsultation',
      path: { id: props.visit.id },
      payload,
    }),
  )
}

onMounted(() => {
  if (props.autostart) void start()
})
</script>

<template>
  <div class="space-y-2">
    <AppButton
      variant="primary"
      :pending="state === 'saving'"
      pending-label="Démarrage en cours…"
      :disabled="opened"
      :accessible-name="`${unresolved ? 'Réessayer de démarrer' : 'Démarrer'} l’examen de ${name}`"
      @click="start"
      ><AppIcon :name="unresolved ? 'refresh' : 'stethoscope'" :size="18" />{{
        unresolved ? 'Réessayer de démarrer l’examen' : 'Démarrer l’examen'
      }}</AppButton
    >
    <p
      v-if="showsFailure && failureMessage"
      role="alert"
      class="flex max-w-prose items-start gap-1.5 text-sm font-medium text-danger"
    >
      <AppIcon name="alert" :size="16" class="mt-0.5" /><span>{{ failureMessage }}</span>
    </p>
  </div>
</template>
