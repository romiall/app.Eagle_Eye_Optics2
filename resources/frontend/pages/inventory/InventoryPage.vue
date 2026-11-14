<script setup lang="ts">
/**
 * Inventaire (L1D02, EE026, EE030, AT30), module « stock », EN LIGNE, droit `stock.inventory`. Quatre états :
 *
 *  - OUVERT : on saisit la quantité trouvée de chaque ligne (zéro si rien n'est trouvé) et le motif de chaque écart ;
 *    aucun stock n'est modifié ;
 *  - COMPTÉ : toutes les lignes sont comptées ; la gérante, mot de passe confirmé, valide : chaque écart devient un
 *    mouvement d'ajustement SIGNÉ et approuvé (jamais un remplacement de la quantité). Le théorique est jugé au moment du
 *    comptage de la ligne ; la marchandise réservée ou confiée à un poste ne se retire pas ;
 *  - VALIDÉ : lecture seule, définitif ; ABANDONNÉ : sans effet sur le stock.
 *
 * La valeur des écarts (coût connu) n'apparaît que pour qui détient la valorisation ; un coût absent est « inconnu »,
 * jamais zéro. Données de démonstration FICTIVES seulement.
 */
import { computed, ref, shallowRef, watch } from 'vue'
import { useRoute } from 'vue-router'

import { formatInstantFr } from '@/app/clinicTime'
import type { MutationOutcome } from '@/app/services/mutations'
import { getInventoryCount } from '@/app/services/purchasing'
import { canOnScreen, revalidateSession } from '@/app/session'
import { useUnsavedChangesGuard } from '@/app/unsavedChanges'
import ConfirmDialog from '@/components/feedback/ConfirmDialog.vue'
import ErrorSummary, { type FieldErrorItem } from '@/components/feedback/ErrorSummary.vue'
import StateMessage from '@/components/feedback/StateMessage.vue'
import TextAreaField from '@/components/form/TextAreaField.vue'
import TextField from '@/components/form/TextField.vue'
import PasswordConfirmDialog from '@/components/session/PasswordConfirmDialog.vue'
import AppButton from '@/components/ui/AppButton.vue'
import LinkButton from '@/components/ui/LinkButton.vue'
import type { InventoryCount, InventoryCountResponse } from '@/domain/contracts/generated'
import {
  checkCountChanges,
  COUNT_REASON_MAX,
  type CountLineForm,
  countFormOf,
  INVENTORY_STATUS_LABELS,
  mapInventoryServerErrors,
  parseCounted,
  varianceOf,
} from '@/domain/inventory/counting'
import { formatMoney } from '@/domain/values/money'
import { takeSalesFlash } from '@/pages/sales/flash'
import { quantityLabel } from '@/pages/sales/format'
import SalesReadMessage from '@/pages/sales/SalesReadMessage.vue'
import { useStockCommand } from '@/pages/stock/useStockCommand'
import { useServerRead } from '@/pages/today/useServerRead'

import CommandFailure from '@/pages/purchasing/CommandFailure.vue'
import { useCatalogItems } from '@/pages/purchasing/useCatalogItems'

const route = useRoute()
const id = computed(() => String(route.params['id']))
const notice = ref<string | null>(takeSalesFlash())

const read = useServerRead<InventoryCount>(() => getInventoryCount(id.value))
const catalog = useCatalogItems()
const command = useStockCommand('')
const { mutation } = command
const saving = computed(() => mutation.state.value === 'saving')

const detail = shallowRef<InventoryCount | null>(null)
const forms = ref<Record<string, CountLineForm>>({})
const snapshot = ref('')
const lineErrors = ref<Record<string, string>>({})
const general = ref<string | null>(null)
const validationReason = ref('')
const abandonReason = ref('')
const askingAbandon = ref(false)
const summaryBox = ref<{ focus: () => Promise<void> } | null>(null)

const status = computed(() => detail.value?.status ?? null)
const lines = computed(() => detail.value?.lines ?? [])
const canValidate = computed(() => canOnScreen('stock.adjust'))
const counting = computed(() => status.value === 'OPEN')
const dirty = computed(() => counting.value && JSON.stringify(forms.value) !== snapshot.value)
useUnsavedChangesGuard(dirty)

function load(next: InventoryCount): void {
  detail.value = next
  forms.value = Object.fromEntries(next.lines.map((line) => [line.line_id, countFormOf(line)]))
  snapshot.value = JSON.stringify(forms.value)
  lineErrors.value = {}
  general.value = null
}

watch(
  () => read.data.value,
  (data) => {
    if (data !== null && data.id === id.value) load(data)
  },
  { immediate: true },
)

function integerOnly(itemId: string): boolean {
  return catalog.items.value.get(itemId)?.quantity_integer_only ?? true
}

/** Écart brut saisi (comptage moins théorique figé), ou null tant que la ligne n'est pas comptée ou que la saisie est refusée. */
function liveVariance(lineId: string, theoretical: string, itemId: string): string | null {
  const form = forms.value[lineId]
  if (form === undefined) return null
  const parsed = parseCounted(form.counted, integerOnly(itemId))
  return parsed.ok && parsed.value !== null ? varianceOf(theoretical, parsed.value) : null
}

function signed(value: string): string {
  return value.startsWith('-') ? quantityLabel(value) : `+${quantityLabel(value)}`
}

function isZero(value: string): boolean {
  return /^-?0(\.0+)?$/u.test(value)
}

function setCounted(lineId: string, text: string): void {
  const form = forms.value[lineId]
  if (form === undefined) return
  forms.value = { ...forms.value, [lineId]: { ...form, counted: text } }
  if (lineErrors.value[lineId] !== undefined) {
    const rest = { ...lineErrors.value }
    delete rest[lineId]
    lineErrors.value = rest
  }
}

function setReason(lineId: string, text: string): void {
  const form = forms.value[lineId]
  if (form === undefined) return
  forms.value = { ...forms.value, [lineId]: { ...form, reason: text } }
}

const summary = computed<FieldErrorItem[]>(() => {
  const items: FieldErrorItem[] = []
  if (general.value !== null)
    items.push({ fieldId: 'inventaire-motif-validation', message: general.value })
  for (const line of lines.value) {
    const message = lineErrors.value[line.line_id]
    if (message !== undefined) {
      items.push({
        fieldId: `inventaire-${line.line_id}-comptage`,
        message: `${line.item_reference} : ${message}`,
      })
    }
  }
  return items
})

function showServerErrors(): void {
  const mapped = mapInventoryServerErrors(command.fields.value)
  lineErrors.value = mapped.lines
  general.value =
    mapped.general ?? (Object.keys(mapped.lines).length === 0 ? command.message.value : null)
}

async function absorb(outcome: MutationOutcome, done: string | null): Promise<boolean> {
  switch (outcome.kind) {
    case 'synced':
      mutation.reset()
      load((outcome.result as InventoryCountResponse).data)
      notice.value = done
      return true
    case 'reauthentication-required':
      return false
    case 'refused':
    case 'conflict':
      showServerErrors()
      await summaryBox.value?.focus()
      return false
    case 'session-expired':
      void revalidateSession().catch(() => undefined)
      return false
    default:
      return false
  }
}

async function saveCounts(announce: boolean): Promise<boolean> {
  notice.value = null
  const checked = checkCountChanges({ lines: lines.value, forms: forms.value, integerOnly })
  lineErrors.value = checked.errors
  if (Object.keys(checked.errors).length > 0) {
    await summaryBox.value?.focus()
    return false
  }
  if (checked.request === null) return true
  return absorb(
    await command.send({
      name: 'RecordInventoryCounts',
      route: { method: 'PATCH', path: `/inventory-counts/${encodeURIComponent(id.value)}/lines` },
      payload: checked.request,
    }),
    announce ? 'Comptages enregistrés : le stock n’a pas bougé.' : null,
  )
}

async function complete(): Promise<void> {
  if (saving.value) return
  if (!(await saveCounts(false))) return
  await absorb(
    await command.send({
      name: 'CompleteInventoryCount',
      route: { method: 'POST', path: `/inventory-counts/${encodeURIComponent(id.value)}/complete` },
      payload: {},
    }),
    'Comptage terminé : l’inventaire attend la validation de la gérante.',
  )
}

async function reopen(): Promise<void> {
  if (saving.value) return
  await absorb(
    await command.send({
      name: 'ReopenInventoryCount',
      route: { method: 'POST', path: `/inventory-counts/${encodeURIComponent(id.value)}/reopen` },
      payload: {},
    }),
    'Inventaire rouvert : vous pouvez corriger les comptages.',
  )
}

async function abandon(): Promise<void> {
  if (saving.value) return
  const reason = abandonReason.value.trim()
  const done = await absorb(
    await command.send({
      name: 'AbandonInventoryCount',
      route: { method: 'POST', path: `/inventory-counts/${encodeURIComponent(id.value)}/abandon` },
      payload: reason === '' ? {} : { reason },
    }),
    'Inventaire abandonné : aucun stock n’a été modifié.',
  )
  if (done) askingAbandon.value = false
}

async function validate(): Promise<void> {
  if (saving.value) return
  const reason = validationReason.value.trim()
  if (reason.length < 3) {
    general.value = 'Le motif de l’approbation est obligatoire (3 caractères au moins).'
    await summaryBox.value?.focus()
    return
  }
  await absorb(
    await command.send({
      name: 'ValidateInventoryCount',
      route: { method: 'POST', path: `/inventory-counts/${encodeURIComponent(id.value)}/validate` },
      payload: { reason },
    }),
    'Inventaire validé : les écarts sont ajustés dans le stock.',
  )
}

async function onPasswordConfirmed(): Promise<void> {
  await absorb(
    await command.passwordConfirmed(),
    'Inventaire validé : les écarts sont ajustés dans le stock.',
  )
}

async function retry(): Promise<void> {
  if (saving.value) return
  await absorb(await command.retry(), null)
}
</script>

<template>
  <section aria-labelledby="titre-inventaire" class="max-w-3xl space-y-6">
    <h1 id="titre-inventaire" class="text-2xl font-semibold tracking-tight">
      {{ detail ? `Inventaire ${detail.reference}` : 'Inventaire' }}
    </h1>
    <LinkButton :to="{ name: 'inventories' }" variant="ghost">Retour aux inventaires</LinkButton>

    <StateMessage v-if="notice" state="success" :title="notice" />

    <SalesReadMessage
      v-if="read.state.value !== 'ready' || detail === null"
      :state="read.state.value"
      subject="l’inventaire"
      :error="read.error.value"
      not-found-title="Inventaire introuvable"
      @retry="read.reload()"
    />

    <template v-else>
      <section aria-labelledby="titre-etat-inventaire" class="space-y-2">
        <h2 id="titre-etat-inventaire" class="text-lg font-semibold">
          {{ INVENTORY_STATUS_LABELS[detail.status] ?? detail.status }}
        </h2>
        <p class="text-base">
          {{ detail.location_name }} · théorique figé le {{ formatInstantFr(detail.snapshot_at) }} ·
          {{ detail.counted_lines }} ligne{{ detail.counted_lines > 1 ? 's' : '' }} comptée{{
            detail.counted_lines > 1 ? 's' : ''
          }}
          sur {{ detail.line_count }}
        </p>
        <p v-if="detail.status === 'VALIDATED' || detail.variance_lines > 0" class="text-base">
          {{ detail.variance_lines }} écart{{ detail.variance_lines > 1 ? 's' : '' }}
          <template v-if="detail.variance_value_known !== null">
            · valeur au coût connu :
            <strong>{{ formatMoney(detail.variance_value_known) }}</strong>
            <template v-if="(detail.unknown_cost_lines ?? 0) > 0">
              · {{ detail.unknown_cost_lines }} écart{{
                (detail.unknown_cost_lines ?? 0) > 1 ? 's' : ''
              }}
              à coût inconnu (non valorisé{{ (detail.unknown_cost_lines ?? 0) > 1 ? 's' : '' }})
            </template>
          </template>
        </p>
        <p v-if="detail.status === 'OPEN'" class="max-w-prose text-sm text-muted">
          Comptez chaque article et chaque lot, zéro si rien n’est trouvé. Rien n’est modifié dans
          le stock avant la validation.
        </p>
        <p v-if="detail.status === 'VALIDATED'" class="text-sm text-muted">
          Cet inventaire est définitif : les écarts ont été ajustés par des mouvements signés et
          approuvés.
        </p>
      </section>

      <ErrorSummary ref="summaryBox" :errors="summary" />
      <CommandFailure
        :state="mutation.state.value"
        :message="null"
        :failure-message="mutation.failureMessage.value"
        :saving="saving"
        @retry="retry"
      />
      <StateMessage
        v-if="mutation.state.value === 'reauthentication-required' && !command.askingPassword.value"
        state="error"
        title="Confirmation du mot de passe demandée"
      >
        Rien n’a été enregistré : confirmez votre mot de passe pour reprendre.
        <template #action>
          <AppButton variant="secondary" @click="command.askingPassword.value = true"
            >Confirmer mon mot de passe</AppButton
          >
        </template>
      </StateMessage>

      <ul class="space-y-3">
        <li
          v-for="line in lines"
          :key="line.line_id"
          class="space-y-3 rounded-xl border border-line bg-surface shadow-card p-3"
        >
          <div>
            <p class="font-semibold break-words">
              {{ line.item_name }} ({{ line.item_reference }})
            </p>
            <p class="text-sm text-muted break-words">
              <template v-if="line.lot">
                Lot {{ line.lot.batch_number
                }}<template v-if="line.lot.expires_on">
                  · expire le {{ line.lot.expires_on.split('-').reverse().join('/') }}</template
                >
              </template>
              <template v-else>Sans lot</template>
              · théorique {{ quantityLabel(line.theoretical_quantity) }}
            </p>
          </div>

          <template v-if="counting">
            <TextField
              :model-value="forms[line.line_id]?.counted ?? ''"
              label="Quantité trouvée"
              inputmode="decimal"
              hint="Zéro si rien n’est trouvé ; laisser vide = pas encore compté."
              :control-id="`inventaire-${line.line_id}-comptage`"
              :error="lineErrors[line.line_id] ?? null"
              :disabled="saving"
              @update:model-value="setCounted(line.line_id, $event)"
            />
            <p
              v-if="liveVariance(line.line_id, line.theoretical_quantity, line.item_id) !== null"
              class="text-base"
              :class="
                isZero(liveVariance(line.line_id, line.theoretical_quantity, line.item_id) ?? '0')
                  ? 'text-muted'
                  : 'font-semibold'
              "
            >
              Écart :
              {{
                signed(liveVariance(line.line_id, line.theoretical_quantity, line.item_id) ?? '0')
              }}
            </p>
            <TextField
              v-if="
                liveVariance(line.line_id, line.theoretical_quantity, line.item_id) !== null &&
                !isZero(liveVariance(line.line_id, line.theoretical_quantity, line.item_id) ?? '0')
              "
              :model-value="forms[line.line_id]?.reason ?? ''"
              label="Motif de l’écart"
              hint="Obligatoire pour valider : casse, vol constaté, erreur de saisie…"
              :maxlength="COUNT_REASON_MAX"
              :control-id="`inventaire-${line.line_id}-motif`"
              :disabled="saving"
              @update:model-value="setReason(line.line_id, $event)"
            />
          </template>
          <template v-else>
            <p class="text-base">
              <template v-if="line.counted_quantity !== null"
                >Trouvé : {{ quantityLabel(line.counted_quantity) }}
                <template v-if="line.variance_quantity !== null && !isZero(line.variance_quantity)">
                  · écart {{ signed(line.variance_quantity) }}</template
                ></template
              >
              <template v-else>Pas compté</template>
            </p>
            <p v-if="line.variance_reason" class="text-sm text-muted break-words">
              Motif : {{ line.variance_reason }}
            </p>
            <p
              v-else-if="
                detail.status === 'COUNTED' &&
                line.variance_quantity !== null &&
                !isZero(line.variance_quantity)
              "
              class="text-sm font-semibold"
            >
              Écart sans motif : rouvrez l’inventaire pour le renseigner avant la validation.
            </p>
            <p v-if="line.adjustment_quantity !== null" class="text-base font-semibold">
              Ajusté dans le stock : {{ signed(line.adjustment_quantity) }}
              <template v-if="line.variance_value !== null">
                · {{ formatMoney(line.variance_value) }}</template
              >
              <template v-else-if="line.unit_cost === null && detail.variance_value_known !== null">
                · coût inconnu</template
              >
            </p>
          </template>
        </li>
      </ul>

      <div v-if="counting" class="flex flex-wrap gap-3">
        <AppButton
          variant="secondary"
          :pending="saving"
          pending-label="Enregistrement…"
          :disabled="!dirty"
          @click="saveCounts(true)"
          >Enregistrer les comptages</AppButton
        >
        <AppButton :pending="saving" pending-label="Traitement…" @click="complete"
          >Terminer le comptage</AppButton
        >
        <AppButton variant="ghost" :disabled="saving" @click="askingAbandon = true"
          >Abandonner l’inventaire</AppButton
        >
      </div>

      <section
        v-if="status === 'COUNTED'"
        aria-labelledby="titre-validation-inventaire"
        class="space-y-4"
      >
        <h2 id="titre-validation-inventaire" class="text-lg font-semibold">
          Validation par la gérante
        </h2>
        <template v-if="canValidate">
          <p class="max-w-prose text-base text-muted">
            Valider ajuste le stock : chaque écart devient un mouvement signé et approuvé. Une
            marchandise réservée pour une vente ou confiée à un poste ne se retire pas.
          </p>
          <TextAreaField
            v-model="validationReason"
            label="Motif de l’approbation"
            hint="Par exemple : inventaire de fin de mois, écarts relus avec l’équipe."
            :maxlength="COUNT_REASON_MAX"
            control-id="inventaire-motif-validation"
            :disabled="saving"
            required
          />
          <p class="text-sm text-muted">
            Opération sensible : votre mot de passe peut vous être demandé avant la validation.
          </p>
          <div class="flex flex-wrap gap-3">
            <AppButton :pending="saving" pending-label="Validation en cours…" @click="validate"
              >Valider l’inventaire</AppButton
            >
            <AppButton variant="secondary" :disabled="saving" @click="reopen"
              >Rouvrir pour corriger</AppButton
            >
            <AppButton variant="ghost" :disabled="saving" @click="askingAbandon = true"
              >Abandonner l’inventaire</AppButton
            >
          </div>
        </template>
        <template v-else>
          <StateMessage state="forbidden" title="Réservé à la gérante">
            Seule la gérante valide les écarts d’un inventaire. Vous pouvez le rouvrir pour corriger
            un comptage.
          </StateMessage>
          <AppButton variant="secondary" :disabled="saving" @click="reopen"
            >Rouvrir pour corriger</AppButton
          >
        </template>
      </section>
    </template>

    <ConfirmDialog
      :open="askingAbandon"
      title="Abandonner cet inventaire ?"
      confirm-label="Abandonner l’inventaire"
      pending-label="Traitement…"
      tone="danger"
      :pending="saving"
      @confirm="abandon"
      @cancel="askingAbandon = false"
    >
      <p>Aucun stock n’est modifié. Un nouvel inventaire de cet emplacement pourra être ouvert.</p>
      <TextField v-model="abandonReason" label="Motif (facultatif)" :maxlength="COUNT_REASON_MAX" />
    </ConfirmDialog>
    <PasswordConfirmDialog
      :open="command.askingPassword.value"
      action="La validation d’un inventaire"
      @confirmed="onPasswordConfirmed"
      @cancel="command.askingPassword.value = false"
    />
  </section>
</template>
