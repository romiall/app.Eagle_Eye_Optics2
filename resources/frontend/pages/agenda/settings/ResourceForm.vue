<script setup lang="ts">
/**
 * Création ou modification d'une ressource de l'agenda (gérante) : nom, professionnel rattaché (compte actif du
 * cabinet, facultatif), pas de l'agenda en minutes, active ou non. Les horaires se saisissent à part.
 */
import { computed, ref, useId } from 'vue'

import CheckboxField from '@/components/form/CheckboxField.vue'
import SelectField from '@/components/form/SelectField.vue'
import TextField from '@/components/form/TextField.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import type { SchedulingResource, StaffMemberSummary } from '@/domain/contracts/generated'
import { newUlid } from '@/domain/values/ulid'

import { useAgendaWrite } from './useAgendaWrite'

const props = defineProps<{
  resource: SchedulingResource | null
  staff: readonly StaffMemberSummary[]
}>()
const emit = defineEmits<{ saved: [message: string]; cancel: [] }>()

const ids = useId()
const write = useAgendaWrite()
const resourceId = props.resource?.id ?? newUlid()
const name = ref(props.resource?.name ?? '')
const professional = ref<string | null>(props.resource?.professional_user_id ?? '')
const slot = ref(String(props.resource?.slot_duration_minutes ?? 15))
const active = ref(props.resource?.active ?? true)
const localError = ref<string | null>(null)

const staffOptions = computed(() => [
  { value: '', label: 'Aucun (salle ou matériel)' },
  ...props.staff
    .filter((member) => member.active)
    .map((member) => ({ value: member.id, label: member.display_name })),
])

async function save(): Promise<void> {
  localError.value = null
  const minutes = Number(slot.value)
  if (!Number.isSafeInteger(minutes) || minutes < 5 || minutes > 480) {
    localError.value = 'Le pas de l’agenda est un nombre entier de minutes, de 5 à 480.'
    return
  }
  const editing = props.resource !== null
  const done = await write.send({
    name: 'SaveSchedulingResource',
    route: editing
      ? { method: 'PATCH', path: `/agenda/resources/${resourceId}`, expectedVersion: 'entity' }
      : { method: 'POST', path: '/agenda/resources' },
    payload: {
      resource_id: resourceId,
      name: name.value.trim(),
      professional_user_id: professional.value === '' ? null : professional.value,
      slot_duration_minutes: minutes,
      active: active.value,
    },
    expectedVersion: editing ? props.resource!.version : null,
  })
  if (done)
    emit(
      'saved',
      editing
        ? `Ressource « ${name.value.trim()} » modifiée.`
        : `Ressource « ${name.value.trim()} » créée.`,
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
        label="Nom"
        :control-id="`${ids}-nom`"
        :error="write.fields.value['name'] ?? null"
        required
      />
      <SelectField
        v-model="professional"
        label="Professionnel rattaché"
        :options="staffOptions"
        :control-id="`${ids}-pro`"
        :error="write.fields.value['professional_user_id'] ?? null"
      />
      <TextField
        v-model="slot"
        label="Pas de l’agenda (minutes)"
        hint="Écart entre deux débuts de créneau, par exemple 15."
        inputmode="numeric"
        :control-id="`${ids}-pas`"
        :error="localError ?? write.fields.value['slot_duration_minutes'] ?? null"
      />
      <CheckboxField
        v-model="active"
        class="field-action"
        label="Ressource active (proposée à la prise de rendez-vous)"
        :control-id="`${ids}-active`"
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
        Enregistrer la ressource
      </AppButton>
      <AppButton variant="ghost" @click="emit('cancel')">Annuler</AppButton>
    </div>
  </form>
</template>
