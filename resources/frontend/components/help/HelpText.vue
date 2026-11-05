<script setup lang="ts">
/**
 * Texte d'aide avec ses libellés d'écran. Le personnel lit « Cliquez sur « Enregistrer le patient » » et
 * doit reconnaître, sans hésiter, le NOM du bouton au milieu de la phrase : chaque libellé écrit entre
 * guillemets français devient une puce (`.help-label`, base.css), le reste est du texte simple. Les
 * guillemets restent dans le texte et une espace insécable les colle au libellé : le sens ne repose pas sur
 * la teinte, et un guillemet ne se retrouve jamais seul en bout de ligne.
 *
 * Aucun HTML n'est interprété : le texte est inséré comme texte, jamais comme balisage (une fiche d'aide
 * est du contenu, pas du code). La racine est un fragment : le composant se glisse dans un paragraphe, un
 * titre, une cellule ou une phrase sans ajouter d'élément autour du texte, et il n'accepte aucun attribut.
 * Le découpage vient de `splitInline` (domain/help/rules.ts), commun à la recherche et aux tests.
 */
import { computed } from 'vue'

import { splitInline } from '@/domain/help/rules'

defineOptions({ inheritAttrs: false })

const props = defineProps<{ text: string }>()

const segments = computed(() => splitInline(props.text))

/** Espace insécable (U+00A0), écrite par son code : écrite telle quelle, elle passerait pour une espace. */
const NBSP = String.fromCharCode(0xa0)

/** « libellé » avec une espace insécable à l'intérieur des guillemets. */
function quoted(label: string): string {
  return `«${NBSP}${label}${NBSP}»`
}
</script>

<template>
  <template v-for="(segment, index) in segments" :key="index">
    <span v-if="segment.kind === 'label'" class="help-label">{{ quoted(segment.value) }}</span>
    <template v-else>{{ segment.value }}</template>
  </template>
</template>
