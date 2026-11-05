<script setup lang="ts">
/**
 * En-tête patient de la consultation (fichier 04 : « en-tête patient fixe sur écran large, compact sur
 * mobile » ; fichier 02 : « identité, dossier, date/heure de consultation et professionnel »).
 *
 * L'identité vient de la CONSULTATION elle-même (`patient`, identité administrative de base rendue avec
 * `clinical.read`) : l'écran ne dépend ni du module « Patients » ni du droit `patient.read`, et ne remplit jamais
 * un dossier sous un en-tête qui ne dit pas de qui il s'agit. L'état « archivée » ou « fusionnée » de la fiche
 * n'est pas porté par la consultation : il n'est pas affiché ici. Le professionnel est nommé quand le compte
 * connecté est celui de la consultation (la consultation ne porte que son identifiant). La profession du dossier
 * administratif, que le cabinet note dans son carnet, s'ajoute à la ligne de la date quand elle est connue (rien
 * n'est écrit quand elle ne l'est pas).
 *
 * Bandeau de dossier : filet doré à gauche, pastille de patient (dès la tablette), identité puis date et
 * professionnel ; la fente (puces d'état de l'examen) se place à droite dès la tablette, dessous sur
 * téléphone.
 */
import { computed } from 'vue'

import { formatInstantFr } from '@/app/clinicTime'
import { session } from '@/app/session'
import PatientIdentityHeader from '@/components/patients/PatientIdentityHeader.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import type { Consultation } from '@/domain/contracts/generated'

const props = defineProps<{
  consultation: Pick<Consultation, 'patient' | 'effective_at' | 'clinician_id'>
}>()

const patient = computed(() => ({
  ...props.consultation.patient,
  archived: false,
  merged_into_patient_id: null,
}))

const clinician = computed(() =>
  session.account !== null && session.account.id === props.consultation.clinician_id
    ? session.account.display_name
    : null,
)

const profession = computed(() => {
  const text = props.consultation.patient.profession?.trim() ?? ''
  return text === '' ? null : text
})
</script>

<template>
  <div
    role="group"
    aria-label="Patient et consultation"
    class="rounded-xl border border-l-4 border-line border-l-gold bg-surface p-3 shadow-card sm:p-4 lg:sticky lg:top-0 lg:z-30"
  >
    <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div class="flex min-w-0 items-start gap-4">
        <div
          aria-hidden="true"
          class="hidden size-12 shrink-0 items-center justify-center rounded-full bg-gold-soft text-gold-ink sm:flex"
        >
          <AppIcon name="user" :size="24" />
        </div>
        <div class="min-w-0 space-y-2">
          <PatientIdentityHeader :patient="patient" />
          <p class="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
            <span class="inline-flex items-center gap-1.5">
              <AppIcon name="calendar" :size="16" class="text-gold" />
              <span
                >Consultation du
                <strong class="font-semibold text-ink">{{
                  formatInstantFr(props.consultation.effective_at)
                }}</strong></span
              >
            </span>
            <span v-if="profession" class="inline-flex min-w-0 items-center gap-1.5">
              <AppIcon name="building" :size="16" class="text-gold" />
              <span class="min-w-0 break-words"
                ><span class="sr-only">, </span>Profession :
                <strong class="font-semibold text-ink">{{ profession }}</strong></span
              >
            </span>
            <span v-if="clinician" class="inline-flex items-center gap-1.5">
              <AppIcon name="stethoscope" :size="16" class="text-gold" />
              <span
                ><span class="sr-only">, </span>Professionnel :
                <strong class="font-semibold text-ink">{{ clinician }}</strong></span
              >
            </span>
          </p>
        </div>
      </div>
      <div v-if="$slots.default" class="sm:shrink-0">
        <slot />
      </div>
    </div>
  </div>
</template>
