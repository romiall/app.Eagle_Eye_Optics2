<script setup lang="ts">
/**
 * Enveloppe commune des champs : vrai libellé, aide et erreur reliées au contrôle par
 * aria-describedby, état invalide annoncé (aria-invalid) et jamais signalé par la seule couleur.
 * Le contrôle reçoit ses attributs par la fente : `{ id, describedBy, invalid }`.
 *
 * Ordre d'affichage : libellé, contrôle, erreur, aide. L'erreur et l'aide sont SOUS le contrôle :
 * dans une rangée à deux colonnes, les contrôles de tous les champs commencent à la même hauteur,
 * qu'un champ porte une aide ou non, et l'erreur reste contre sa saisie même quand l'aide est
 * longue (l'ordre de lecture par aria-describedby ne change pas : aide puis erreur). Le libellé
 * tient sur une ligne de `--field-label-height` (limite connue : un libellé qui passe sur deux
 * lignes décale la saisie de son voisin de rangée) ; un bouton posé à côté d'un champ prend
 * `.field-action` (base.css) pour s'aligner sur la saisie.
 */
import { computed, useId } from 'vue'

const props = defineProps<{
  label: string
  hint?: string | undefined
  error?: string | null | undefined
  required?: boolean | undefined
  /** Libellé visuellement masqué, toujours lu par les lecteurs d'écran. */
  hideLabel?: boolean | undefined
  /** Libellé masqué sur grand écran seulement (tableau optique : l'en-tête de colonne le montre). */
  hideLabelWide?: boolean | undefined
  /** Identifiant imposé du contrôle (cible d'un résumé d'erreurs) ; sinon un identifiant unique. */
  controlId?: string | undefined
}>()

const id = props.controlId ?? useId()
const hintId = `${id}-aide`
const errorId = `${id}-erreur`
const describedBy = computed(
  () =>
    [props.hint ? hintId : null, props.error ? errorId : null].filter(Boolean).join(' ') ||
    undefined,
)
</script>

<template>
  <div class="group/field flex flex-col">
    <label
      :for="id"
      :class="[
        'field-label transition-colors group-focus-within/field:text-gold-ink',
        props.hideLabel ? 'sr-only' : props.hideLabelWide ? 'sm:sr-only' : '',
      ]"
    >
      {{ props.label
      }}<span v-if="props.required" class="text-[0.8125rem] font-normal text-danger">
        (obligatoire)</span
      >
    </label>
    <slot :id="id" :described-by="describedBy" :invalid="Boolean(props.error)" />
    <p
      v-if="props.error"
      :id="errorId"
      class="mt-1.5 flex items-start gap-1.5 text-sm leading-5 font-medium text-danger"
    >
      <span aria-hidden="true" class="shrink-0">⚠ </span><span>{{ props.error }}</span>
    </p>
    <p v-if="props.hint" :id="hintId" class="mt-1.5 text-sm leading-5 text-muted">
      {{ props.hint }}
    </p>
  </div>
</template>
