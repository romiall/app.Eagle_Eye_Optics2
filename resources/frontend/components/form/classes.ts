/**
 * Classes communes des contrôles de saisie : cible d'au moins 44 px, texte de 16 px (pas de zoom
 * forcé sur téléphone), bordure de champ contrastée (≥ 3:1), erreur signalée aussi par le message
 * et `aria-invalid` (bordure et fond d'erreur en plus), état désactivé lisible. `field-control`
 * porte le contour de focus propre aux champs (base.css : contour à l'encre, halo doré léger).
 */
export function controlClasses(invalid: boolean, extra = ''): string[] {
  return [
    'field-control min-h-11 w-full rounded-lg border px-3 py-2 text-base leading-6 text-ink shadow-[inset_0_1px_2px_rgb(35_31_32/0.04)]',
    'disabled:cursor-not-allowed disabled:bg-disabled disabled:text-disabled-ink',
    invalid
      ? 'border-danger bg-danger-soft ring-1 ring-danger hover:border-danger-strong'
      : 'border-field bg-surface hover:border-primary',
    extra,
  ]
}
