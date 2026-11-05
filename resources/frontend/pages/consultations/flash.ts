import { ref } from 'vue'

/**
 * Message passé d'un écran d'examen à la liste des examens (« L'examen a été supprimé. »), en mémoire seulement :
 * jamais dans l'URL ni dans un stockage, lu une seule fois. Il ne contient aucune donnée personnelle ni clinique.
 */
const pending = ref<string | null>(null)

export function setFlash(message: string): void {
  pending.value = message
}

export function takeFlash(): string | null {
  const message = pending.value
  pending.value = null
  return message
}
