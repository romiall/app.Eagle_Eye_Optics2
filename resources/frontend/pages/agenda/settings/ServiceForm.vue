<script setup lang="ts">
/**
 * Création ou modification d'une prestation réservable (gérante) : nom et durée en minutes saisis par le cabinet,
 * active ou non. Aucun prix ici (le catalogue des ventes porte les prix).
 */
import { ref, useId } from 'vue'

import CheckboxField from '@/components/form/CheckboxField.vue'
import TextField from '@/components/form/TextField.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import type { AppointmentService } from '@/domain/contracts/generated'
import { newUlid } from '@/domain/values/ulid'

import { useAgendaWrite } from './useAgendaWrite'

const props = defineProps<{ service: AppointmentService | null }>()
const emit = defineEmits<{ saved: [message: string]; cancel: [] }>()

const ids = useId()
const write = useAgendaWrite()
const serviceId = props.service?.id ?? newUlid()
const name = ref(props.service?.name ?? '')
const duration = ref(props.service === null ? '' : String(props.service.duration_minutes))
const active = ref(props.service?.active ?? true)
const publicBooking = ref(props.service?.public_booking ?? false)
const localError = ref<string | null>(null)

async function save(): Promise<void> {
  localError.value = null
  const minutes = Number(duration.value)
  if (!Number.isSafeInteger(minutes) || minutes < 5 || minutes > 480) {
    localError.value = 'La durée est un nombre entier de minutes, de 5 à 480.'
    return
  }
  const editing = props.service !== null
  const done = await write.send({
    name: 'SaveAppointmentService',
    route: editing
      ? { method: 'PATCH', path: `/agenda/services/${serviceId}`, expectedVersion: 'entity' }
      : { method: 'POST', path: '/agenda/services' },
    payload: {
      service_id: serviceId,
      name: name.value.trim(),
      duration_minutes: minutes,
      active: active.value,
      public_booking: publicBooking.value,
    },
    expectedVersion: editing ? props.service!.version : null,
  })
  if (done)
    emit(
      'saved',
      editing
        ? `Prestation « ${name.value.trim()} » modifiée.`
        : `Prestation « ${name.value.trim()} » créée.`,
    )
}
</script>

<template>
  <form
    class="space-y-4 rounded-xl border border-line bg-canvas p-4 sm:p-5"
    novalidate
    @submit.prevent="save"
  >
    <div class="form-grid">
      <TextField
        v-model="name"
        label="Nom de la prestation"
        :control-id="`${ids}-nom`"
        :error="write.fields.value['name'] ?? null"
        required
      />
      <TextField
        v-model="duration"
        label="Durée (minutes)"
        inputmode="numeric"
        :control-id="`${ids}-duree`"
        :error="localError ?? write.fields.value['duration_minutes'] ?? null"
        required
      />
      <CheckboxField
        v-model="active"
        class="col-span-full"
        label="Prestation proposée à la prise de rendez-vous"
        :control-id="`${ids}-active`"
      />
      <CheckboxField
        v-model="publicBooking"
        class="col-span-full"
        label="Ouverte à la réservation en ligne"
        hint="Le public la voit sur la page de prise de rendez-vous. Fermée, elle reste réservable par l’équipe seulement."
        :control-id="`${ids}-public`"
      />
    </div>
    <p v-if="write.error.value" role="alert" class="text-sm font-medium text-danger">
      {{ write.error.value }}
    </p>
    <div class="form-actions">
      <AppButton
        type="submit"
        variant="primary"
        :pending="write.saving.value"
        pending-label="Enregistrement…"
      >
        <AppIcon name="check" />
        Enregistrer la prestation
      </AppButton>
      <AppButton variant="ghost" @click="emit('cancel')">Annuler</AppButton>
    </div>
  </form>
</template>
