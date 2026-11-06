/**
 * Identité d'un build de l'application (O06) : de quoi dire à la personne, en français, quelle version son navigateur
 * exécute. Règles pures : ni DOM, ni réseau, ni stockage.
 */
export interface BuildInfo {
  /** Identifiant de la livraison (le commit, `EEO_BUILD_ID`) ou « local-… » pour un build de développement. */
  readonly id: string
  /** Date de construction (ISO 8601, UTC). */
  readonly builtAt: string
}

/** Fuseau d'affichage par défaut : celui du cabinet (proposition d'après les sources, voir clinicTime.ts). */
const DEFAULT_TIME_ZONE = 'Africa/Douala'

/**
 * « 30 octobre 2026 à 19h16 » à l'heure du cabinet. Une date illisible donne « date inconnue » (jamais d'erreur à
 * l'écran) et un fuseau inconnu du navigateur retombe sur celui du cabinet.
 */
export function buildDateText(builtAt: string, timeZone: string = DEFAULT_TIME_ZONE): string {
  const instant = new Date(builtAt)
  if (Number.isNaN(instant.getTime())) return 'date inconnue'
  const format = (zone: string): string => {
    const parts = new Intl.DateTimeFormat('fr-FR', {
      timeZone: zone,
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(instant)
    const read = (type: Intl.DateTimeFormatPartTypes): string =>
      parts.find((part) => part.type === type)?.value ?? ''
    return `${read('day')} ${read('month')} ${read('year')} à ${read('hour')}h${read('minute')}`
  }
  try {
    return format(timeZone)
  } catch (error) {
    if (!(error instanceof RangeError)) throw error
    return format(DEFAULT_TIME_ZONE)
  }
}

/** « build bbd83c4, construite le 30 octobre 2026 à 19h16 » (phrase de la version en cours). */
export function describeBuild(info: BuildInfo, timeZone: string = DEFAULT_TIME_ZONE): string {
  return `build ${info.id}, construite le ${buildDateText(info.builtAt, timeZone)}`
}
