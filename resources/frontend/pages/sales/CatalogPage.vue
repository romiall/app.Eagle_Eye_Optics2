<script setup lang="ts">
/**
 * Catalogue (B01), gérante (`catalog.manage`), EN LIGNE : articles actifs et désactivés, recherche,
 * création et modification. Articles stockés, prestations et sur mesure distincts ; une paire n'est
 * jamais convertie en deux unités. Le coût d'achat n'apparaît qu'avec `catalog.purchase_cost.read`.
 * Aucun prix réel n'est proposé : seules des données FICTIVES existent en développement.
 */
import { computed, ref, shallowRef } from 'vue'

import { clinicTimeZone } from '@/app/clinicTime'
import { listTaxRules, searchCatalog } from '@/app/services/billing'
import { canOnScreen } from '@/app/session'
import FreshnessNote from '@/components/feedback/FreshnessNote.vue'
import StateMessage from '@/components/feedback/StateMessage.vue'
import TextField from '@/components/form/TextField.vue'
import AppButton from '@/components/ui/AppButton.vue'
import LinkButton from '@/components/ui/LinkButton.vue'
import PaginationControls from '@/components/ui/PaginationControls.vue'
import { categoryLabel, stockModeLabel } from '@/domain/billing/catalog'
import type {
  CatalogItem,
  CatalogPage as CatalogPageResponse,
  TaxRule,
} from '@/domain/contracts/generated'
import { useServerRead } from '@/pages/today/useServerRead'

import CatalogItemForm from './CatalogItemForm.vue'
import { formatMoney, unitLabel } from './format'
import SalesReadMessage from './SalesReadMessage.vue'

const timeZone = clinicTimeZone()
const query = ref('')
const appliedQuery = ref('')
const page = ref(1)
const queryError = ref<string | null>(null)

const read = useServerRead<CatalogPageResponse>(
  () => searchCatalog(appliedQuery.value, page.value, { includeInactive: true }),
  { isEmpty: (result) => result.data.length === 0 },
)
const rules = useServerRead<TaxRule[]>(() => listTaxRules())

/** Article en cours de modification (identifiant), « nouveau », ou rien. */
const editing = ref<string | 'new' | null>(null)
const notice = ref<string | null>(null)
const withCost = computed(() => canOnScreen('catalog.purchase_cost.read'))
const result = computed(() => read.data.value)
const taxRules = computed(() => rules.data.value ?? [])
/** Version actuelle de l'article modifié, relue après un conflit. */
const latest = shallowRef<CatalogItem | null>(null)

function ruleLabel(id: string | null): string {
  if (id === null) return 'Aucune règle fiscale'
  const rule = taxRules.value.find((candidate) => candidate.id === id)
  return rule === undefined ? 'Règle fiscale (non lue)' : `${rule.label} (${rule.code})`
}

function applySearch(): void {
  const text = query.value.trim()
  if (text !== '' && text.length < 2) {
    queryError.value = 'La recherche demande 2 caractères au moins.'
    return
  }
  queryError.value = null
  appliedQuery.value = text
  page.value = 1
  void read.reload()
}

function goToPage(next: number): void {
  page.value = next
  void read.reload()
}

function edit(target: string | 'new'): void {
  notice.value = null
  latest.value = null
  editing.value = target
}

function onSaved(item: CatalogItem): void {
  editing.value = null
  latest.value = null
  notice.value = `Article ${item.reference} enregistré sur le serveur.`
  void read.reload()
}

async function onReload(): Promise<void> {
  await read.reload()
  const id = editing.value
  latest.value =
    id === null || id === 'new'
      ? null
      : (read.data.value?.data.find((item) => item.id === id) ?? null)
}
</script>

<template>
  <section aria-labelledby="titre-catalogue" class="max-w-3xl space-y-6">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <h1 id="titre-catalogue" class="text-2xl font-semibold tracking-tight">Catalogue</h1>
      <div class="flex flex-wrap gap-3">
        <LinkButton :to="{ name: 'import-catalogue' }" variant="secondary"
          >Importer un fichier CSV</LinkButton
        >
        <AppButton v-if="editing !== 'new'" variant="primary" @click="edit('new')"
          >Nouvel article</AppButton
        >
      </div>
    </div>

    <StateMessage v-if="notice" state="success" :title="notice" />

    <CatalogItemForm
      v-if="editing === 'new'"
      key="nouveau"
      :tax-rules="taxRules"
      @saved="onSaved"
      @cancel="editing = null"
    />

    <form
      role="search"
      aria-label="Rechercher dans le catalogue"
      class="flex flex-col gap-3 sm:flex-row sm:items-start"
      @submit.prevent="applySearch"
    >
      <div class="grow">
        <TextField
          v-model="query"
          label="Rechercher un article"
          hint="Référence, nom, marque ou modèle (2 caractères au moins) ; vide : tout le catalogue."
          type="search"
          control-id="catalogue-recherche"
          :error="queryError"
        />
      </div>
      <AppButton type="submit" variant="secondary" class="field-action">Rechercher</AppButton>
    </form>

    <!-- Une relecture garde la liste affichée (un article en cours de modification n'est jamais
         effacé) ; l'état de la lecture est dit au-dessus. -->
    <SalesReadMessage
      v-if="
        read.state.value !== 'ready' &&
        read.state.value !== 'empty' &&
        !(read.state.value === 'loading' && result !== null)
      "
      :state="read.state.value"
      subject="le catalogue"
      :error="read.error.value"
      @retry="read.reload()"
    />
    <StateMessage v-if="read.state.value === 'empty'" state="empty" title="Aucun article">
      Le serveur n’a aucun article pour cette recherche.
    </StateMessage>

    <template v-else-if="result !== null">
      <ul class="space-y-3">
        <li
          v-for="item in result.data"
          :key="item.id"
          class="space-y-2 rounded-xl border border-line bg-surface shadow-card p-3"
        >
          <p class="flex flex-wrap items-baseline justify-between gap-x-3">
            <span class="font-semibold break-words">{{ item.name }}</span>
            <span class="tabular-nums">{{ formatMoney(item.sale_price) }}</span>
          </p>
          <p class="text-sm break-words text-muted">
            {{ item.reference }} · {{ categoryLabel(item.category_code) }} ·
            {{ unitLabel(item.unit_code) }} · {{ stockModeLabel(item.stock_mode) }}
          </p>
          <p class="text-sm text-muted">
            {{ ruleLabel(item.tax_rule_id) }}
            <template v-if="withCost && item.purchase_cost !== undefined">
              · coût d’achat :
              {{
                item.purchase_cost === null ? 'inconnu' : formatMoney(item.purchase_cost)
              }}</template
            >
          </p>
          <p class="text-sm font-medium">
            <span aria-hidden="true">{{ item.active ? '✓' : '–' }}</span>
            {{ item.active ? 'Actif' : 'Désactivé' }}
          </p>
          <AppButton
            v-if="editing !== item.id"
            variant="secondary"
            :accessible-name="`Modifier ${item.name}`"
            @click="edit(item.id)"
            >Modifier</AppButton
          >
          <CatalogItemForm
            v-else
            :key="item.id"
            :item="item"
            :tax-rules="taxRules"
            :latest="latest"
            @saved="onSaved"
            @cancel="editing = null"
            @reload="onReload"
          />
        </li>
      </ul>

      <PaginationControls
        :current-page="result.meta.current_page"
        :last-page="result.meta.last_page"
        :total="result.meta.total"
        label="Pagination du catalogue"
        unit="articles"
        :busy="read.state.value === 'loading'"
        @page="goToPage"
      />

      <FreshnessNote
        v-if="read.freshness.value"
        :freshness="read.freshness.value"
        :time-zone="timeZone"
      />
    </template>
  </section>
</template>
