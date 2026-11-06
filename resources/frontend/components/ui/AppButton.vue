<script setup lang="ts">
/**
 * Bouton d'action : libellé qui dit sa conséquence (« Émettre la facture », fichier 04), cible
 * tactile d'au moins 44 px, désactivé pendant la commande pour réduire les doubles clics (l'idempotence
 * locale et serveur reste la vraie protection). Pendant la commande, le libellé devient
 * `pendingLabel` et `aria-busy` est posé. L'état désactivé garde un texte lisible (teintes pleines
 * vérifiées par le test de contraste, jamais une simple opacité).
 */
const props = withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
    type?: 'button' | 'submit'
    pending?: boolean
    disabled?: boolean
    pendingLabel?: string
    /** Identifiant du bouton (cible d'un rendu de focus après un envoi). */
    id?: string | undefined
    /**
     * Nom accessible quand plusieurs boutons portent le même libellé visible (une liste de patients) :
     * il COMMENCE par le libellé visible (WCAG 2.5.3) et nomme l'objet de l'action.
     */
    accessibleName?: string | undefined
    /** Bouton à bascule (un filtre) : état annoncé par `aria-pressed` ; absent pour un bouton d'action. */
    pressed?: boolean | undefined
    /** Bouton qui déplie ou replie une zone (détails) : état annoncé par `aria-expanded` ; absent sinon. */
    expanded?: boolean | undefined
    /** Identifiant de la zone que le bouton déplie (`aria-controls`). */
    controls?: string | undefined
  }>(),
  {
    variant: 'primary',
    type: 'button',
    pending: false,
    disabled: false,
    pendingLabel: 'Traitement en cours…',
    id: undefined,
    accessibleName: undefined,
    pressed: undefined,
    expanded: undefined,
    controls: undefined,
  },
)

const emit = defineEmits<{ click: [event: MouseEvent] }>()

const variants: Record<string, string> = {
  primary:
    'border-transparent bg-primary text-primary-contrast shadow-card hover:bg-primary-strong',
  secondary:
    'border-field bg-surface text-primary shadow-card hover:border-primary hover:bg-primary-soft',
  danger: 'border-transparent bg-danger text-primary-contrast shadow-card hover:bg-danger-strong',
  ghost: 'border-transparent bg-transparent text-primary hover:bg-primary-soft',
}
</script>

<template>
  <button
    :id="props.id"
    :type="props.type"
    :aria-label="props.accessibleName"
    :disabled="props.disabled || props.pending"
    :aria-busy="props.pending ? 'true' : undefined"
    :aria-pressed="props.pressed === undefined ? undefined : props.pressed ? 'true' : 'false'"
    :aria-expanded="props.expanded === undefined ? undefined : props.expanded ? 'true' : 'false'"
    :aria-controls="props.controls"
    :class="[
      'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border px-4 py-2 text-base font-semibold',
      'disabled:cursor-not-allowed disabled:border-transparent disabled:bg-disabled disabled:text-disabled-ink disabled:shadow-none',
      // Bouton à bascule enfoncé : fond doré léger, bordure et filet dorés (en plus d'`aria-pressed`).
      'aria-pressed:border-gold aria-pressed:bg-primary-soft aria-pressed:text-primary aria-pressed:shadow-[inset_0_-3px_0_var(--color-gold)]',
      variants[props.variant],
    ]"
    @click="emit('click', $event)"
  >
    <span v-if="props.pending">{{ props.pendingLabel }}</span>
    <slot v-else />
  </button>
</template>
