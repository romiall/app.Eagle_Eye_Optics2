<script setup lang="ts">
/**
 * Fournisseurs et laboratoires (L1D01, EE026), module « stock », EN LIGNE, droit `stock.receive` (gérante par défaut) :
 * liste, création, modification et désactivation. Un fournisseur ne se supprime jamais : il se désactive et reste lisible
 * sur ses réceptions passées. Le code est unique par cabinet. Les coordonnées sont celles d'une entreprise, jamais d'un
 * patient. Données de démonstration FICTIVES seulement.
 */
import { computed, ref } from 'vue'

import { listSuppliers } from '@/app/services/purchasing'
import type { MutationOutcome } from '@/app/services/mutations'
import { revalidateSession } from '@/app/session'
import { useUnsavedChangesGuard } from '@/app/unsavedChanges'
import ErrorSummary, { type FieldErrorItem } from '@/components/feedback/ErrorSummary.vue'
import StateMessage from '@/components/feedback/StateMessage.vue'
import CheckboxField from '@/components/form/CheckboxField.vue'
import TextAreaField from '@/components/form/TextAreaField.vue'
import TextField from '@/components/form/TextField.vue'
import AppButton from '@/components/ui/AppButton.vue'
import LinkButton from '@/components/ui/LinkButton.vue'
import type { Supplier } from '@/domain/contracts/generated'
import {
  emptySupplierForm,
  SUPPLIER_ADDRESS_MAX,
  SUPPLIER_CODE_MAX,
  SUPPLIER_NAME_MAX,
  SUPPLIER_PHONE_MAX,
  type SupplierField,
  type SupplierForm,
  supplierFieldFromServer,
  supplierFormOf,
  validateSupplier,
} from '@/domain/inventory/purchasing'
import SalesReadMessage from '@/pages/sales/SalesReadMessage.vue'
import { useStockCommand } from '@/pages/stock/useStockCommand'
import { useServerRead } from '@/pages/today/useServerRead'

import CommandFailure from './CommandFailure.vue'

const read = useServerRead<Supplier[]>(() => listSuppliers(), {
  isEmpty: (list) => list.length === 0,
})
const command = useStockCommand('')
const { mutation } = command
const saving = computed(() => mutation.state.value === 'saving')

const form = ref<SupplierForm>(emptySupplierForm())
const baseline = ref<SupplierForm>(emptySupplierForm())
const editingId = ref<string | null>(null)
const errors = ref<Partial<Record<SupplierField, string>>>({})
const general = ref<string | null>(null)
const notice = ref<string | null>(null)
const summaryBox = ref<{ focus: () => Promise<void> } | null>(null)

const dirty = computed(() => JSON.stringify(form.value) !== JSON.stringify(baseline.value))
useUnsavedChangesGuard(dirty)

const suppliers = computed(() => read.data.value ?? [])
const FIELD_IDS: Readonly<Record<SupplierField, string>> = {
  name: 'fournisseur-nom',
  reference: 'fournisseur-code',
  phone: 'fournisseur-telephone',
  email: 'fournisseur-courriel',
  address: 'fournisseur-adresse',
}
const summary = computed<FieldErrorItem[]>(() => {
  const items: FieldErrorItem[] = []
  if (general.value !== null) items.push({ fieldId: FIELD_IDS.name, message: general.value })
  for (const [field, message] of Object.entries(errors.value)) {
    items.push({ fieldId: FIELD_IDS[field as SupplierField], message })
  }
  return items
})

function reset(next: SupplierForm, id: string | null): void {
  form.value = { ...next }
  baseline.value = { ...next }
  editingId.value = id
  errors.value = {}
  general.value = null
}

function startEdit(supplier: Supplier): void {
  notice.value = null
  mutation.reset()
  reset(supplierFormOf(supplier), supplier.id)
}

function cancel(): void {
  mutation.reset()
  reset(emptySupplierForm(), null)
}

async function afterOutcome(outcome: MutationOutcome, created: boolean): Promise<void> {
  switch (outcome.kind) {
    case 'synced':
      notice.value = created ? 'Fournisseur créé.' : 'Fournisseur enregistré.'
      mutation.reset()
      reset(emptySupplierForm(), null)
      await read.reload()
      return
    case 'refused':
    case 'conflict': {
      const byField: Partial<Record<SupplierField, string>> = {}
      const others: string[] = []
      for (const [key, message] of Object.entries(command.fields.value)) {
        const field = supplierFieldFromServer(key)
        if (field === null) others.push(message)
        else byField[field] = message
      }
      errors.value = byField
      general.value =
        others.length > 0
          ? others.join(' ')
          : Object.keys(byField).length === 0
            ? command.message.value
            : null
      await summaryBox.value?.focus()
      return
    }
    case 'session-expired':
      void revalidateSession().catch(() => undefined)
      return
    default:
      return
  }
}

async function send(id: string | null, form_: SupplierForm): Promise<void> {
  const checked = validateSupplier(form_)
  if (checked.request === null) {
    errors.value = checked.errors
    general.value = null
    await summaryBox.value?.focus()
    return
  }
  notice.value = null
  const outcome = await command.send({
    name: 'SaveSupplier',
    route:
      id === null
        ? { method: 'POST', path: '/suppliers' }
        : { method: 'PATCH', path: `/suppliers/${encodeURIComponent(id)}` },
    payload: checked.request,
  })
  await afterOutcome(outcome, id === null)
}

async function submit(): Promise<void> {
  if (saving.value) return
  await send(editingId.value, form.value)
}

async function toggleActive(supplier: Supplier): Promise<void> {
  if (saving.value) return
  await send(supplier.id, { ...supplierFormOf(supplier), active: !supplier.active })
}

async function retry(): Promise<void> {
  if (saving.value) return
  await afterOutcome(await command.retry(), editingId.value === null)
}
</script>

<template>
  <section aria-labelledby="titre-fournisseurs" class="max-w-3xl space-y-6">
    <h1 id="titre-fournisseurs" class="text-2xl font-semibold tracking-tight">Fournisseurs</h1>
    <p class="max-w-prose text-base text-muted">
      Les fournisseurs et laboratoires dont vous recevez de la marchandise. Un fournisseur ne se
      supprime pas : il se désactive et reste lisible sur ses réceptions passées.
    </p>
    <div class="flex flex-wrap gap-3">
      <LinkButton :to="{ name: 'stock' }" variant="ghost">Retour au stock</LinkButton>
      <LinkButton :to="{ name: 'goods-receipts' }" variant="secondary"
        >Réceptions fournisseur</LinkButton
      >
    </div>

    <StateMessage v-if="notice" state="success" :title="notice" />

    <section aria-labelledby="titre-liste-fournisseurs" class="space-y-3">
      <h2 id="titre-liste-fournisseurs" class="text-lg font-semibold">Liste</h2>
      <SalesReadMessage
        v-if="read.state.value !== 'ready' && read.state.value !== 'empty'"
        :state="read.state.value"
        subject="les fournisseurs"
        :error="read.error.value"
        @retry="read.reload()"
      />
      <StateMessage
        v-else-if="read.state.value === 'empty'"
        state="empty"
        title="Aucun fournisseur"
      >
        Aucun fournisseur n’est encore enregistré : créez le premier ci-dessous.
      </StateMessage>
      <ul v-else class="space-y-3">
        <li
          v-for="supplier in suppliers"
          :key="supplier.id"
          class="space-y-2 rounded-xl border border-line bg-surface shadow-card p-3"
        >
          <div class="flex flex-wrap items-start justify-between gap-2">
            <div class="min-w-0">
              <p class="font-semibold break-words">{{ supplier.name }}</p>
              <p class="text-sm text-muted break-words">
                Code {{ supplier.reference }}
                <template v-if="supplier.is_optical_lab"> · laboratoire d’optique</template>
                <template v-if="!supplier.active"> · désactivé</template>
              </p>
            </div>
            <div class="flex flex-wrap gap-2">
              <AppButton
                variant="secondary"
                :disabled="saving"
                :accessible-name="`Modifier ${supplier.name}`"
                @click="startEdit(supplier)"
                >Modifier</AppButton
              >
              <AppButton
                variant="ghost"
                :disabled="saving"
                :accessible-name="`${supplier.active ? 'Désactiver' : 'Réactiver'} ${supplier.name}`"
                @click="toggleActive(supplier)"
                >{{ supplier.active ? 'Désactiver' : 'Réactiver' }}</AppButton
              >
            </div>
          </div>
          <p v-if="supplier.phone || supplier.email" class="text-base break-words">
            <template v-if="supplier.phone">{{ supplier.phone }}</template>
            <template v-if="supplier.phone && supplier.email"> · </template>
            <template v-if="supplier.email">{{ supplier.email }}</template>
          </p>
          <p v-if="supplier.address" class="text-sm text-muted break-words">
            {{ supplier.address }}
          </p>
        </li>
      </ul>
    </section>

    <section aria-labelledby="titre-formulaire-fournisseur" class="space-y-4">
      <h2 id="titre-formulaire-fournisseur" class="text-lg font-semibold">
        {{ editingId === null ? 'Nouveau fournisseur' : 'Modifier le fournisseur' }}
      </h2>
      <form
        novalidate
        class="space-y-4"
        aria-labelledby="titre-formulaire-fournisseur"
        @submit.prevent="submit"
      >
        <ErrorSummary ref="summaryBox" :errors="summary" />
        <CommandFailure
          :state="mutation.state.value"
          :message="null"
          :failure-message="mutation.failureMessage.value"
          :saving="saving"
          @retry="retry"
        />
        <div class="grid gap-3 sm:grid-cols-2">
          <TextField
            v-model="form.name"
            label="Nom"
            :control-id="FIELD_IDS.name"
            :maxlength="SUPPLIER_NAME_MAX"
            :error="errors.name ?? null"
            required
          />
          <TextField
            v-model="form.reference"
            label="Code du fournisseur"
            hint="Court et unique, par exemple FOU-001."
            :control-id="FIELD_IDS.reference"
            :maxlength="SUPPLIER_CODE_MAX"
            :error="errors.reference ?? null"
            required
          />
          <TextField
            v-model="form.phone"
            label="Téléphone (facultatif)"
            type="tel"
            :control-id="FIELD_IDS.phone"
            :maxlength="SUPPLIER_PHONE_MAX"
            :error="errors.phone ?? null"
          />
          <TextField
            v-model="form.email"
            label="Adresse e-mail (facultatif)"
            type="email"
            :control-id="FIELD_IDS.email"
            :error="errors.email ?? null"
          />
        </div>
        <TextAreaField
          v-model="form.address"
          label="Adresse (facultatif)"
          :control-id="FIELD_IDS.address"
          :maxlength="SUPPLIER_ADDRESS_MAX"
          :error="errors.address ?? null"
        />
        <CheckboxField v-model="form.isOpticalLab" label="C’est un laboratoire d’optique" />
        <CheckboxField
          v-if="editingId !== null"
          v-model="form.active"
          label="Fournisseur actif (décochez pour le désactiver)"
        />
        <div class="flex flex-wrap gap-3">
          <AppButton type="submit" :pending="saving" pending-label="Enregistrement en cours…">{{
            editingId === null ? 'Créer le fournisseur' : 'Enregistrer les modifications'
          }}</AppButton>
          <AppButton v-if="editingId !== null" variant="ghost" :disabled="saving" @click="cancel"
            >Annuler la modification</AppButton
          >
        </div>
      </form>
    </section>
  </section>
</template>
