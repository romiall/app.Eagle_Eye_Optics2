import { ref } from 'vue'

import type { MutationOutcome, MutationRequest } from '@/app/services/mutations'
import { useMutation } from '@/app/services/useMutation'
import { revalidateSession } from '@/app/session'
import type { Approval } from '@/domain/contracts/generated'
import { newUlid } from '@/domain/values/ulid'

type StockIntent = Omit<MutationRequest, 'idempotencyKey'>

/**
 * Envoi d'une écriture de stock (I01 remise, I02 retour, casse, ajustement), EN LIGNE, sur le modèle des corrections
 * (`useCorrection`) avec les messages propres au stock :
 *
 * - Réauthentification (423 : retour, casse, ajustement) : `askingPassword` ouvre la confirmation du mot de passe ; la
 *   MÊME commande est reprise avec la même clé d'idempotence (jamais deux sorties de stock).
 * - Approbation exacte : `approvalId` vaut d'abord un identifiant neuf ; pour la gérante, le serveur en fait une
 *   exécution directe. Pour un autre compte, `APPROVAL_REQUIRED_OR_EXPIRED` ouvre la demande d'autorisation (contenu
 *   exact) ; la demande créée remplace l'identifiant, l'opération se renvoie après l'accord de la gérante.
 * - Refus du stock (409 `STOCK_UNAVAILABLE`, 422 `LOT_EXPIRED`) : le message du serveur est affiché tel quel, les
 *   valeurs actualisées (`details`) restent lisibles ; l'écran relit la remise (`stale`).
 * - Aucune issue n'est devinée : sans réponse, la commande se reprend avec la même clé.
 */
export function useStockCommand(approvalMessage: string) {
  const mutation = useMutation()
  const askingPassword = ref(false)
  const approvalNeeded = ref(false)
  const approvalId = ref(newUlid())
  const requestedApproval = ref<Approval | null>(null)
  const message = ref<string | null>(null)
  const notice = ref<string | null>(null)
  const fields = ref<Record<string, string>>({})
  const details = ref<Record<string, string | number | null>>({})
  const stale = ref(false)

  function absorb(outcome: MutationOutcome): MutationOutcome {
    switch (outcome.kind) {
      case 'synced':
        message.value = null
        fields.value = {}
        details.value = {}
        return outcome
      case 'reauthentication-required':
        askingPassword.value = true
        return outcome
      case 'conflict':
      case 'refused': {
        const error = outcome.error
        if (error.code === 'APPROVAL_REQUIRED_OR_EXPIRED') {
          approvalNeeded.value = true
          message.value =
            requestedApproval.value === null
              ? approvalMessage
              : 'L’autorisation demandée n’est pas (ou plus) accordée pour ce contenu exact : attendez la décision de la gérante, ou faites une nouvelle demande si elle est échue, refusée ou si le reste dû a changé.'
          return outcome
        }
        const byField: Record<string, string> = {}
        for (const [key, messages] of Object.entries(error.fields)) {
          const first = messages[0]
          if (first !== undefined) byField[key] = first
        }
        fields.value = byField
        details.value = { ...error.details }
        message.value = error.message
        if (
          outcome.kind === 'conflict' ||
          [
            'STATE_TRANSITION_REFUSED',
            'WRITE_OWNER_REQUIRED',
            'STOCK_UNAVAILABLE',
            'LOT_EXPIRED',
          ].includes(error.code)
        ) {
          stale.value = true
        }
        return outcome
      }
      case 'session-expired':
        void revalidateSession().catch(() => undefined)
        message.value = mutation.failureMessage.value
        return outcome
      default:
        message.value = mutation.failureMessage.value
        return outcome
    }
  }

  async function send(intent: StockIntent): Promise<MutationOutcome> {
    message.value = null
    notice.value = null
    fields.value = {}
    details.value = {}
    stale.value = false
    return absorb(await mutation.submit(intent))
  }

  async function passwordConfirmed(): Promise<MutationOutcome> {
    askingPassword.value = false
    return absorb(await mutation.retry())
  }

  /** Reprise de la MÊME commande (même clé d'idempotence) après une issue non confirmée. */
  async function retry(): Promise<MutationOutcome> {
    return absorb(await mutation.retry())
  }

  /** La demande d'autorisation est créée : l'opération se renverra sous son identifiant, après l'accord. */
  function approvalRequested(approval: Approval): void {
    requestedApproval.value = approval
    approvalId.value = approval.id
    approvalNeeded.value = false
    message.value = null
    notice.value =
      'Demande d’autorisation envoyée à la gérante : elle n’est pas encore accordée. Renvoyez l’opération après son accord.'
  }

  return {
    mutation,
    askingPassword,
    approvalNeeded,
    approvalId,
    requestedApproval,
    message,
    notice,
    fields,
    details,
    stale,
    send,
    passwordConfirmed,
    retry,
    approvalRequested,
  }
}
