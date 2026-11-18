<script setup lang="ts">
/**
 * Casse et ajustement de stock (I02), module « stock », EN LIGNE, droit `stock.adjust` (gérante par défaut), mot de
 * passe confirmé récemment. Hors vente : la remise au patient passe par la fiche facture, un retour par la remise
 * d'origine, le stock initial par l'écran Stock.
 *
 *  - Casse ou perte : sortie du stock ;
 *  - Ajustement après comptage : sortie ou entrée.
 *
 * Une sortie ne prend jamais la marchandise réservée pour une vente émise ni celle confiée à un poste : au plus le
 * disponible affiché (le serveur rejuge sous verrou). Un article suivi par lots s'ajuste lot par lot. Approbation
 * exacte : la gérante exécute directement ; un autre compte autorisé DEMANDE d'abord l'autorisation. Motif obligatoire.
 * Données de démonstration FICTIVES seulement.
 */
import { computed, ref, watch } from 'vue'

import { getStockAvailability, listStockLocations } from '@/app/services/billing'
import { canOnScreen, moduleOpenOnScreen } from '@/app/session'
import { useUnsavedChangesGuard } from '@/app/unsavedChanges'
import ApprovalRequestDialog from '@/components/approvals/ApprovalRequestDialog.vue'
import StateMessage from '@/components/feedback/StateMessage.vue'
import SelectField from '@/components/form/SelectField.vue'
import TextAreaField from '@/components/form/TextAreaField.vue'
import TextField from '@/components/form/TextField.vue'
import PasswordConfirmDialog from '@/components/session/PasswordConfirmDialog.vue'
import AppButton from '@/components/ui/AppButton.vue'
import LinkButton from '@/components/ui/LinkButton.vue'
import { stockMovementSubject } from '@/domain/approvals/approvals'
import type {
  Approval,
  CatalogItem,
  StockAvailability,
  StockLocation,
  StockMovementResponse,
} from '@/domain/contracts/generated'
import {
  buildMovementPayload,
  MOVEMENT_LABELS,
  type MovementErrors,
  type MovementKind,
  quantityLabel,
  REASON_MAX_LENGTH,
  validateMovement,
} from '@/domain/inventory/delivery'
import { centralAvailable } from '@/domain/inventory/stock'
import { currentInstant } from '@/domain/patients/visits'
import { Quantity } from '@/domain/values/decimal'
import { newUlid } from '@/domain/values/ulid'
import { loadAllCatalogItems } from '@/pages/purchasing/useCatalogItems'
import { useServerRead } from '@/pages/today/useServerRead'

import { useStockCommand } from './useStockCommand'

const catalog = useServerRead<CatalogItem[]>(() => loadAllCatalogItems())
const locationRead = useServerRead<StockLocation[]>(listStockLocations)

const itemId = ref<string | null>(null)
const positionId = ref<string | null>(null)
const lotId = ref<string | null>(null)
const kind = ref<MovementKind>('BREAKAGE')
const direction = ref<'out' | 'in'>('out')
const quantity = ref('')
const reason = ref('')
const errors = ref<MovementErrors>({})
const positions = ref<StockAvailability[]>([])
const positionsState = ref<'idle' | 'loading' | 'ready' | 'failed'>('idle')
const success = ref<string | null>(null)
const asking = ref(false)
/** Instant du constat, fixé à la première tentative : une reprise renvoie la même charge. */
let occurredAt: string | null = null

const command = useStockCommand(
  'Cette casse ou cet ajustement exige l’autorisation de la gérante pour ce contenu exact. Demandez-la, puis renvoyez le mouvement après son accord.',
)
const { mutation, message, notice, approvalNeeded } = command

const saving = computed(() => mutation.state.value === 'saving')
const allowed = computed(() => canOnScreen('stock.adjust'))
const canRequest = computed(() => canOnScreen('approval.request') && moduleOpenOnScreen('settings'))
const requestOnly = computed(
  () => !canOnScreen('approval.decide') && command.requestedApproval.value === null,
)
const dirty = computed(() => quantity.value.trim() !== '' || reason.value.trim() !== '')
useUnsavedChangesGuard(dirty)

const stockedItems = computed(() =>
  (catalog.data.value ?? []).filter((item) => item.stock_mode === 'STOCKED'),
)
const itemOptions = computed(() =>
  stockedItems.value.map((item) => ({ value: item.id, label: `${item.name} (${item.reference})` })),
)
const item = computed(() => stockedItems.value.find((entry) => entry.id === itemId.value) ?? null)
const locationNames = computed(
  () => new Map((locationRead.data.value ?? []).map((location) => [location.id, location.name])),
)
const positionOptions = computed(() =>
  positions.value.map((row) => ({
    value: row.stock_position_id,
    label: `${locationNames.value.get(row.location_id) ?? `Emplacement …${row.location_id.slice(-6)}`} — disponible ${quantityLabel(row.central_available)}`,
  })),
)
const position = computed(
  () => positions.value.find((row) => row.stock_position_id === positionId.value) ?? null,
)
const lotOptions = computed(() =>
  (position.value?.lots ?? []).map((lot) => ({
    value: lot.lot_id,
    label: `Lot ${lot.batch_number}${lot.expires_on ? `, expire le ${lot.expires_on.split('-').reverse().join('/')}` : ''} — ${quantityLabel(lot.on_hand)} en stock${lot.status === 'QUARANTINE' ? ', en quarantaine' : ''}`,
  })),
)
const lot = computed(
  () => position.value?.lots.find((entry) => entry.lot_id === lotId.value) ?? null,
)
const lotRequired = computed(() => (position.value?.lots.length ?? 0) > 0)
const available = computed(() => {
  if (lot.value !== null) {
    return centralAvailable(
      Quantity.of(lot.value.on_hand),
      Quantity.of(lot.value.reserved),
      Quantity.of(lot.value.offline_allocated),
    ).canonical()
  }
  return position.value?.central_available ?? '0.000'
})
const kindOptions = (Object.keys(MOVEMENT_LABELS) as MovementKind[]).map((value) => ({
  value,
  label: MOVEMENT_LABELS[value],
}))
const directionOptions = [
  { value: 'out', label: 'Sortie (le comptage trouve moins)' },
  { value: 'in', label: 'Entrée (le comptage trouve plus)' },
]

const checked = computed(() =>
  validateMovement(
    {
      kind: kind.value,
      quantity: quantity.value,
      direction: direction.value,
      reason: reason.value,
    },
    {
      available: available.value,
      integerOnly: item.value?.quantity_integer_only ?? true,
      lotRequired: lotRequired.value,
      lotChosen: lotId.value !== null,
    },
  ),
)
const subject = computed(() => {
  const result = checked.value
  if (!result.ok || itemId.value === null || positionId.value === null) return null
  return stockMovementSubject(
    positionId.value,
    itemId.value,
    lotId.value,
    kind.value,
    result.signedQuantity,
  )
})

/** Positions et lots de l'article, relus du serveur (après un mouvement : disponible actualisé). */
async function loadPositions(
  next: string | null,
  keep: { position: string | null; lot: string | null } | null = null,
): Promise<void> {
  positionId.value = null
  lotId.value = null
  positions.value = []
  if (next === null) {
    positionsState.value = 'idle'
    return
  }
  positionsState.value = 'loading'
  try {
    const result = await getStockAvailability({ itemId: next })
    positions.value = result.data.data
    positionsState.value = 'ready'
    const kept = keep?.position ?? null
    if (kept !== null && positions.value.some((row) => row.stock_position_id === kept)) {
      positionId.value = kept
      lotId.value = keep?.lot ?? null
    } else if (positions.value.length === 1) {
      positionId.value = positions.value[0]?.stock_position_id ?? null
    }
  } catch {
    positionsState.value = 'failed'
  }
}

watch(itemId, (next) => {
  void loadPositions(next)
})
function setPosition(value: string | null): void {
  positionId.value = value
  lotId.value = null
}
watch(kind, (next) => {
  if (next === 'BREAKAGE') direction.value = 'out'
})

function setKind(value: string | null): void {
  kind.value = value === 'ADJUSTMENT' ? 'ADJUSTMENT' : 'BREAKAGE'
}

function setDirection(value: string | null): void {
  direction.value = value === 'in' ? 'in' : 'out'
}

async function submit(): Promise<void> {
  if (saving.value) return
  success.value = null
  const result = checked.value
  if (!result.ok || itemId.value === null || positionId.value === null) {
    errors.value = result.ok ? {} : result.errors
    return
  }
  errors.value = {}
  if (requestOnly.value) {
    asking.value = true
    return
  }
  occurredAt ??= currentInstant()
  const outcome = await command.send({
    name: 'RegisterStockMovement',
    payload: buildMovementPayload({
      movementId: mutation.effectId('movement_id'),
      itemId: itemId.value,
      positionId: positionId.value,
      lotId: lotId.value,
      kind: kind.value,
      signedQuantity: result.signedQuantity,
      approvalId: command.approvalId.value,
      reason: result.reason,
      occurredAt,
    }),
    expectedVersion: null,
  })
  after(outcome)
}

function after(outcome: Awaited<ReturnType<typeof command.send>>): void {
  if (outcome.kind === 'synced') {
    const movement = (outcome.result as StockMovementResponse).data
    success.value = `${movement.kind === 'BREAKAGE' ? 'Casse' : 'Ajustement'} de ${quantityLabel(movement.signed_quantity)} enregistré sur le serveur.`
    quantity.value = ''
    reason.value = ''
    occurredAt = null
    mutation.reset()
    command.approvalId.value = newUlid()
    command.requestedApproval.value = null
    command.notice.value = null
    void loadPositions(itemId.value, { position: positionId.value, lot: lotId.value })
    return
  }
  const fields = command.fields.value
  const next: MovementErrors = {}
  if (fields['signed_quantity'] !== undefined) next.quantity = fields['signed_quantity']
  if (fields['lot_id'] !== undefined) next.lot = fields['lot_id']
  if (fields['reason'] !== undefined) next.reason = fields['reason']
  errors.value = next
}

function onRequested(approval: Approval): void {
  asking.value = false
  command.approvalRequested(approval)
}

async function passwordConfirmed(): Promise<void> {
  after(await command.passwordConfirmed())
}
</script>

<template>
  <section aria-labelledby="titre-mouvement" class="max-w-3xl space-y-6">
    <h1 id="titre-mouvement" class="text-2xl font-semibold tracking-tight">Casse ou ajustement</h1>
    <p class="max-w-prose text-base text-muted">
      Une sortie hors vente (article cassé, perdu) ou un écart constaté au comptage. La remise au
      patient se fait depuis la facture ; un retour, depuis la remise d’origine.
    </p>
    <LinkButton :to="{ name: 'stock' }" variant="ghost">Retour au stock</LinkButton>

    <StateMessage v-if="!allowed" state="forbidden" title="Réservé à la gérante">
      Ce compte ne peut pas enregistrer de casse ni d’ajustement.
    </StateMessage>

    <form v-else class="space-y-4" novalidate @submit.prevent="submit">
      <StateMessage v-if="success" state="success" :title="success" />

      <SelectField
        v-model="itemId"
        label="Article"
        :options="itemOptions"
        placeholder="Choisir l’article géré en stock"
        control-id="mouvement-article"
        :disabled="saving || catalog.state.value === 'loading'"
        required
      />
      <StateMessage v-if="positionsState === 'failed'" state="error" title="Stock non lu">
        Le stock de cet article n’a pas pu être lu : vérifiez la connexion puis choisissez de
        nouveau l’article.
      </StateMessage>
      <StateMessage
        v-else-if="positionsState === 'ready' && positions.length === 0"
        state="empty"
        title="Aucun stock pour cet article"
      >
        Cet article n’a encore aucune position de stock : saisissez d’abord son stock initial.
      </StateMessage>
      <SelectField
        v-if="positions.length > 0"
        :model-value="positionId"
        label="Emplacement"
        :options="positionOptions"
        placeholder="Choisir l’emplacement"
        control-id="mouvement-emplacement"
        :disabled="saving"
        required
        @update:model-value="setPosition"
      />
      <SelectField
        v-if="lotRequired"
        v-model="lotId"
        label="Lot"
        :options="lotOptions"
        placeholder="Choisir le lot"
        control-id="mouvement-lot"
        :error="errors.lot ?? null"
        :disabled="saving"
        required
      />

      <SelectField
        :model-value="kind"
        label="Nature"
        :options="kindOptions"
        control-id="mouvement-nature"
        :disabled="saving"
        required
        @update:model-value="setKind"
      />
      <SelectField
        v-if="kind === 'ADJUSTMENT'"
        :model-value="direction"
        label="Sens de l’ajustement"
        :options="directionOptions"
        control-id="mouvement-sens"
        :disabled="saving"
        required
        @update:model-value="setDirection"
      />
      <TextField
        v-model="quantity"
        label="Quantité"
        control-id="mouvement-quantite"
        inputmode="decimal"
        :hint="
          kind === 'BREAKAGE' || direction === 'out'
            ? `Au plus ${quantityLabel(available)} disponible à retirer.`
            : 'Quantité trouvée en plus au comptage.'
        "
        :error="errors.quantity ?? null"
        :disabled="saving || positionId === null"
        required
      />
      <TextAreaField
        v-model="reason"
        control-id="mouvement-motif"
        label="Motif (obligatoire)"
        hint="Par exemple : monture tombée pendant l’essayage, flacon cassé, écart d’inventaire du 22/10."
        :maxlength="REASON_MAX_LENGTH"
        :error="errors.reason ?? null"
        :disabled="saving"
      />

      <StateMessage
        v-if="message"
        :state="approvalNeeded ? 'conflict' : 'error'"
        title="Mouvement non enregistré"
      >
        {{ message }}
        <template v-if="approvalNeeded && canRequest && subject" #action>
          <AppButton variant="secondary" @click="asking = true">Demander l’autorisation</AppButton>
        </template>
      </StateMessage>
      <StateMessage v-if="notice" state="empty" title="Autorisation demandée">{{
        notice
      }}</StateMessage>

      <AppButton
        type="submit"
        :variant="kind === 'BREAKAGE' || direction === 'out' ? 'danger' : 'primary'"
        :pending="saving"
        pending-label="Enregistrement…"
        :disabled="positionId === null"
        >{{ requestOnly ? 'Demander l’autorisation' : 'Enregistrer le mouvement' }}</AppButton
      >

      <ApprovalRequestDialog
        :open="asking"
        :subject="subject"
        :summary="`${MOVEMENT_LABELS[kind]} : ${quantity} de ${item?.name ?? 'l’article'}.`"
        @requested="onRequested"
        @cancel="asking = false"
      />
      <PasswordConfirmDialog
        :open="command.askingPassword.value"
        action="Une casse ou un ajustement de stock"
        @confirmed="passwordConfirmed"
        @cancel="command.askingPassword.value = false"
      />
    </form>
  </section>
</template>
