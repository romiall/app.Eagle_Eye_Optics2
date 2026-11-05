/**
 * Valeurs usuelles proposées en saisie d'une acuité (C02 ; fichier 02 : « sélection de l'échelle utilisée, valeurs
 * usuelles configurables et saisie libre ; conserver la valeur originale »).
 *
 * Ce sont des AIDES À LA SAISIE, jamais des données : une suggestion n'est appliquée que par un geste de la
 * personne, n'implique aucune conversion entre échelles et ne valide rien cliniquement (les échelles réelles du
 * cabinet attendent la cliente : Q06, décision G11 ouverte). Les listes sont celles du carnet de la cliente
 * (dixièmes « 10/10 », « 9/10 »…, mentions « CLD » et « VLMB » ; Parinaud « P2 », « P3 »…) et celles, courantes, de
 * Snellen.
 *
 * Une échelle reçoit les valeurs de sa FAMILLE, reconnue à son code ou à son libellé : « DIXIEME », « DECIMAL » ou
 * « X/10 » pour les dixièmes, « SNELLEN », « PARINAUD » ou « PRES » pour les autres (accents et casse ignorés). Les
 * échelles de démonstration (`DEMO_DIXIEMES`, `DEMO_SNELLEN_6`, `DEMO_PRES`) et celles qu'un exploitant crée avec
 * `eeo:clinical:scales --code DIXIEMES --label "Dixièmes (X/10)"` ou `--code PARINAUD …` sont donc servies de la même
 * façon ; une échelle d'une autre famille n'en propose aucune : la saisie reste libre et la valeur lue est conservée
 * telle quelle. Règles pures : ni Vue, ni réseau, ni stockage.
 */
export type AcuityFamily = 'DECIMAL' | 'SNELLEN' | 'PARINAUD'

const FAMILY_SUGGESTIONS: Readonly<Record<AcuityFamily, readonly string[]>> = {
  DECIMAL: ['10/10', '9/10', '8/10', '7/10', '6/10', '5/10', '4/10', '3/10', '2/10', '1/10'],
  SNELLEN: ['6/6', '6/9', '6/12', '6/18', '6/24', '6/36', '6/60'],
  PARINAUD: ['P1,5', 'P2', 'P3', 'P4', 'P5', 'P6', 'P8', 'P10', 'P14', 'P20'],
}

/**
 * Mentions du carnet pour une acuité qui ne se chiffre pas en dixièmes (compte les doigts : « CLD » ; « VLMB »),
 * proposées à la suite des dixièmes. Comme les suggestions : une aide à la saisie, jamais une valeur appliquée seule.
 */
const FAMILY_SPECIAL_VALUES: Readonly<Partial<Record<AcuityFamily, readonly string[]>>> = {
  DECIMAL: ['CLD', 'VLMB'],
}

function plain(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase()
}

/** Famille d'une échelle d'après son code et son libellé, ou null (saisie libre, aucune valeur proposée). */
export function acuityFamily(scaleCode: string | null, label = ''): AcuityFamily | null {
  if (scaleCode === null) return null
  const text = plain(`${scaleCode} ${label}`)
  if (text.includes('SNELLEN')) return 'SNELLEN'
  if (text.includes('PARINAUD') || /(^|[^A-Z])PRES([^A-Z]|$)/.test(text)) return 'PARINAUD'
  if (text.includes('DIXIEME') || text.includes('DECIMAL') || text.includes('X/10')) {
    return 'DECIMAL'
  }
  return null
}

/** Suggestions pour une échelle (vide si aucune : saisie libre). */
export function acuitySuggestions(scaleCode: string | null, label = ''): readonly string[] {
  const family = acuityFamily(scaleCode, label)
  return family === null ? [] : FAMILY_SUGGESTIONS[family]
}

/** Valeurs à proposer en boutons : les valeurs usuelles de l'échelle, puis ses mentions du carnet. */
export function acuityQuickValues(scaleCode: string | null, label = ''): readonly string[] {
  const family = acuityFamily(scaleCode, label)
  return family === null
    ? []
    : [...FAMILY_SUGGESTIONS[family], ...(FAMILY_SPECIAL_VALUES[family] ?? [])]
}

/** Vrai pour une échelle de démonstration (code `DEMO_…`) : l'écran le dit, ce n'est pas une échelle validée. */
export function isDemoScale(scaleCode: string): boolean {
  return scaleCode.startsWith('DEMO_')
}
