<script setup lang="ts">
/**
 * En-tête des onglets du dossier patient (Identité, Activité, Prescriptions ; fichier 04 : « en-tête
 * identité ; onglets ») : lien de retour facultatif, puis bandeau d'identité en carte, filet doré en
 * haut, pastille d'initiales, nom en `h1` (son `id` nomme la section de l'écran), numéro de dossier,
 * sexe, âge et état de la fiche (`PatientIdentityHeader`). Les actions de l'écran passent sous
 * l'identité, après un filet, avec retour à la ligne automatique pour ne jamais comprimer le nom ni
 * déborder du bandeau. Présentation seule : aucun appel serveur ni droit vérifié ici, l'écran ne
 * passe que les actions ouvertes au compte (`<template v-if="…" #actions>`).
 *
 * Fente : `actions` (liens et boutons de la fiche).
 */
import { RouterLink } from 'vue-router'

import type { PageBackLink } from '@/components/layout/PageHeader.vue'
import AppIcon from '@/components/ui/AppIcon.vue'

import PatientIdentityHeader, { type HeaderPatient } from './PatientIdentityHeader.vue'

const props = withDefaults(
  defineProps<{
    patient: HeaderPatient
    /** Identifiant du `h1`, repris par l'`aria-labelledby` de la section de l'écran. */
    titleId: string
    back?: PageBackLink | undefined
  }>(),
  { back: undefined },
)
</script>

<template>
  <div class="space-y-3">
    <p v-if="props.back">
      <RouterLink
        :to="props.back.to"
        class="-ml-1 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-1 text-sm font-medium text-muted hover:text-primary hover:underline hover:underline-offset-4"
        ><AppIcon name="arrow-left" :size="16" />{{ props.back.label }}</RouterLink
      >
    </p>
    <div class="card flex flex-col gap-4 border-t-4 border-t-gold p-4 sm:p-6">
      <PatientIdentityHeader :patient="props.patient" as="h1" :title-id="props.titleId" avatar />
      <div
        v-if="$slots.actions"
        class="flex flex-wrap gap-3 border-t border-line pt-4 *:grow sm:*:grow-0"
      >
        <slot name="actions" />
      </div>
    </div>
  </div>
</template>
