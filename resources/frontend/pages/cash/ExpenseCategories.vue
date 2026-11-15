<script setup lang="ts">
/**
 * Catégories de dépenses du cabinet (L1D05), gérées par la gérante (`cash.manage`) : création (code figé ensuite),
 * renommage, désactivation. Aucune catégorie n'est préconfigurée et ce n'est pas un plan comptable réglementaire.
 * Une catégorie ne se supprime jamais : les dépenses passées la gardent.
 */
import { computed, ref, shallowRef } from 'vue'

import { ApiError, NetworkUnavailable } from '@/app/api'
import { listExpenseCategories } from '@/app/services/billing'
import type { MutationOutcome } from '@/app/services/mutations'
import { useMutation } from '@/app/services/useMutation'
import { revalidateSession } from '@/app/session'
import StateMessage from '@/components/feedback/StateMessage.vue'
import TextField from '@/components/form/TextField.vue'
import AppButton from '@/components/ui/AppButton.vue'
import LinkButton from '@/components/ui/LinkButton.vue'
import type { ExpenseCategory } from '@/domain/contracts/generated'
import { newUlid } from '@/domain/values/ulid'

const categories = shallowRef<ExpenseCategory[]>([])
const loading = ref(true)
const problem = ref<string | null>(null)
const code = ref('')
const name = ref('')
const message = ref<string | null>(null)
const fields = ref<Record<string, string>>({})
const done = ref<string | null>(null)
const mutation = useMutation()
const saving = computed(() => mutation.state.value === 'saving')

async function load(): Promise<void> {
  loading.value = true
  problem.value = null
  try {
    categories.value = (await listExpenseCategories()).data
  } catch (error) {
    problem.value =
      error instanceof NetworkUnavailable
        ? 'Le serveur n’a pas répondu : les catégories ne sont pas affichées.'
        : error instanceof ApiError
          ? error.message
          : 'Une erreur inattendue est survenue.'
  } finally {
    loading.value = false
  }
}
void load()

function absorb(outcome: MutationOutcome): boolean {
  switch (outcome.kind) {
    case 'synced':
      return true
    case 'refused':
    case 'conflict': {
      const byField: Record<string, string> = {}
      for (const [key, messages] of Object.entries(outcome.error.fields)) {
        const first = messages[0]
        if (first !== undefined) byField[key] = first
      }
      fields.value = byField
      message.value = outcome.error.message
      return false
    }
    case 'session-expired':
      void revalidateSession().catch(() => undefined)
      message.value = mutation.failureMessage.value
      return false
    default:
      message.value = mutation.failureMessage.value
      return false
  }
}

async function save(category: {
  id: string
  code: string | null
  name: string
  active: boolean
}): Promise<boolean> {
  message.value = null
  fields.value = {}
  done.value = null
  mutation.reset()
  const ok = absorb(
    await mutation.submit({
      name: 'SaveExpenseCategory',
      route: { method: 'POST', path: '/expense-categories', expectedVersion: 'none' },
      payload: {
        category_id: category.id,
        code: category.code,
        name: category.name,
        active: category.active,
      },
    }),
  )
  if (ok) await load()
  return ok
}

async function create(): Promise<void> {
  const normalized = code.value.trim().toUpperCase()
  if (await save({ id: newUlid(), code: normalized, name: name.value.trim(), active: true })) {
    done.value = `Catégorie « ${name.value.trim()} » créée.`
    code.value = ''
    name.value = ''
  }
}

async function toggle(category: ExpenseCategory): Promise<void> {
  if (await save({ id: category.id, code: null, name: category.name, active: !category.active })) {
    done.value = category.active
      ? `Catégorie « ${category.name} » désactivée : elle n’est plus proposée.`
      : `Catégorie « ${category.name} » réactivée.`
  }
}
</script>

<template>
  <section aria-labelledby="titre-categories" class="max-w-3xl space-y-6">
    <header class="space-y-2">
      <h1 id="titre-categories" class="text-2xl font-semibold tracking-tight">
        Catégories de dépenses
      </h1>
      <p class="max-w-prose text-muted">
        Les catégories servent à classer les sorties d’espèces de la caisse (dépenses). Elles ne
        remplacent pas le plan comptable du comptable.
      </p>
    </header>

    <StateMessage v-if="done" state="success" :title="done" />
    <p v-if="message" role="alert" class="text-sm font-medium text-danger">{{ message }}</p>

    <StateMessage v-if="loading" state="loading" title="Lecture des catégories…" />
    <StateMessage v-else-if="problem" state="offline" title="Catégories non lues">{{
      problem
    }}</StateMessage>
    <template v-else>
      <StateMessage v-if="categories.length === 0" state="empty" title="Aucune catégorie">
        Créez les catégories utilisées par le cabinet (par exemple transport, fournitures,
        entretien).
      </StateMessage>
      <ul v-else class="divide-y divide-line rounded-xl border border-line bg-surface shadow-card">
        <li
          v-for="category in categories"
          :key="category.id"
          class="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
        >
          <span>
            <span class="font-semibold">{{ category.name }}</span>
            <span class="ml-2 text-sm text-muted">{{ category.code }}</span>
            <span v-if="!category.active" class="ml-2 text-sm font-semibold text-warning"
              >Désactivée</span
            >
          </span>
          <AppButton
            variant="secondary"
            :disabled="saving"
            :accessible-name="`${category.active ? 'Désactiver' : 'Réactiver'} la catégorie ${category.name}`"
            @click="toggle(category)"
            >{{ category.active ? 'Désactiver' : 'Réactiver' }}</AppButton
          >
        </li>
      </ul>
    </template>

    <form
      novalidate
      aria-labelledby="titre-nouvelle-categorie"
      class="space-y-4 rounded-xl border border-line bg-surface p-4 shadow-card"
      @submit.prevent="create"
    >
      <h2 id="titre-nouvelle-categorie" class="text-lg font-semibold">Nouvelle catégorie</h2>
      <div class="grid gap-4 sm:grid-cols-2">
        <TextField
          v-model="name"
          label="Nom"
          :error="fields['name'] ?? null"
          :maxlength="180"
          required
          control-id="categorie-nom"
        />
        <TextField
          v-model="code"
          label="Code"
          hint="Majuscules, chiffres et _ (par exemple TRANSPORT). Il ne change plus ensuite."
          :error="fields['code'] ?? null"
          :maxlength="40"
          required
          control-id="categorie-code"
        />
      </div>
      <AppButton type="submit" :pending="saving" pending-label="Enregistrement…"
        >Créer la catégorie</AppButton
      >
    </form>

    <LinkButton :to="{ name: 'caisse' }" variant="ghost">Retour à la caisse</LinkButton>
  </section>
</template>
