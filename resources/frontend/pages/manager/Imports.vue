<script setup lang="ts">
/**
 * Import du catalogue depuis un fichier CSV (X01), gérante (`catalog.manage`), module « sales », EN LIGNE :
 * 1. télécharger le modèle, le remplir (tableur), l'enregistrer en CSV ;
 * 2. choisir le fichier : il est lu SUR CE POSTE (aperçu immédiat, problèmes de lecture ligne par ligne) ;
 * 3. « Vérifier sur le serveur » : aperçu sans aucune écriture, avec les règles d'un article saisi à l'écran ;
 * 4. « Importer » : toutes les lignes sont créées en une seule fois, ou aucune ; le numéro de chaque ligne
 *    refusée est celui du fichier. L'opération demande la confirmation du mot de passe (423), puis reprend
 *    la même demande avec la même clé (aucun doublon). Rien n'est conservé dans le navigateur.
 */
import { computed, ref } from 'vue'

import { listTaxRules } from '@/app/services/billing'
import type { MutationOutcome } from '@/app/services/mutations'
import { useMutation } from '@/app/services/useMutation'
import { canOnScreen, revalidateSession } from '@/app/session'
import StateMessage from '@/components/feedback/StateMessage.vue'
import PasswordConfirmDialog from '@/components/session/PasswordConfirmDialog.vue'
import AppButton from '@/components/ui/AppButton.vue'
import LinkButton from '@/components/ui/LinkButton.vue'
import {
  catalogTemplateCsv,
  IMPORT_COLUMNS,
  IMPORT_MAX_ROWS,
  type ImportProblem,
  type ParsedImport,
  readCatalogCsv,
} from '@/domain/billing/catalogImport'
import type { ImportReport, ImportReportResponse, TaxRule } from '@/domain/contracts/generated'
import { useServerRead } from '@/pages/today/useServerRead'

import LegacyBalances from './LegacyBalances.vue'

/** Reprise des créances papier (X01) : la gérante seule (lecture des finances globales). */
const showsLegacy = computed(() => canOnScreen('finance.global.read'))

const taxes = useServerRead<TaxRule[]>(() => listTaxRules())
const mutation = useMutation()

const fileName = ref<string | null>(null)
const parsed = ref<ParsedImport | null>(null)
const readError = ref<string | null>(null)
const report = ref<ImportReport | null>(null)
const imported = ref<ImportReport | null>(null)
const serverProblems = ref<string[]>([])
const askingPassword = ref(false)
const pending = ref<'check' | 'import' | null>(null)

const busy = computed(() => mutation.state.value === 'saving')
const rows = computed(() => parsed.value?.rows ?? [])
const localProblems = computed<ImportProblem[]>(() => parsed.value?.problems ?? [])
const canCheck = computed(
  () => rows.value.length > 0 && localProblems.value.length === 0 && !busy.value,
)
const canImport = computed(
  () =>
    report.value !== null &&
    report.value.rejected.length === 0 &&
    report.value.accepted === rows.value.length &&
    imported.value === null &&
    !busy.value,
)

function downloadTemplate(): void {
  const blob = new Blob([`\u{FEFF}${catalogTemplateCsv()}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'modele-catalogue.csv'
  link.click()
  URL.revokeObjectURL(url)
}

async function choose(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0] ?? null
  report.value = null
  imported.value = null
  serverProblems.value = []
  readError.value = null
  parsed.value = null
  fileName.value = file?.name ?? null
  if (file === null) return
  try {
    parsed.value = readCatalogCsv(await file.text(), taxes.data.value ?? [])
  } catch {
    readError.value =
      'Le fichier n’a pas pu être lu : enregistrez-le au format CSV (UTF-8) et réessayez.'
  }
}

function reportOf(result: unknown): ImportReport | null {
  const data = (result as ImportReportResponse | null)?.data
  return typeof data === 'object' && data !== null && Array.isArray(data.rejected) ? data : null
}

async function afterOutcome(outcome: MutationOutcome): Promise<void> {
  switch (outcome.kind) {
    case 'synced': {
      const received = reportOf(outcome.result)
      if (received === null) {
        serverProblems.value = [
          'Réponse inattendue du serveur : rien n’est conclu, relisez le catalogue.',
        ]
        return
      }
      if (received.dry_run) report.value = received
      else imported.value = received
      pending.value = null
      return
    }
    case 'reauthentication-required':
      askingPassword.value = true
      return
    case 'refused':
      serverProblems.value = Object.values(outcome.error.fields).flat()
      if (serverProblems.value.length === 0) serverProblems.value = [outcome.error.message]
      return
    case 'session-expired':
      void revalidateSession().catch(() => undefined)
      return
    default:
      return
  }
}

async function send(dryRun: boolean): Promise<void> {
  if (busy.value) return
  serverProblems.value = []
  pending.value = dryRun ? 'check' : 'import'
  // Chaque vérification et chaque import est une intention nouvelle (nouvelle clé d'idempotence).
  mutation.reset()
  await afterOutcome(
    await mutation.submit({
      name: 'ImportCatalog',
      route: { method: 'POST', path: '/imports/catalog', expectedVersion: 'omitted' },
      payload: { dry_run: dryRun, rows: rows.value },
    }),
  )
}

async function onPasswordConfirmed(): Promise<void> {
  askingPassword.value = false
  await afterOutcome(await mutation.retry())
}

function columnLabel(column: string | null): string {
  return column === null ? '' : ` (${column})`
}
</script>

<template>
  <section aria-labelledby="titre-imports" class="max-w-3xl space-y-8">
    <header class="space-y-2">
      <h1 id="titre-imports" class="text-2xl font-semibold tracking-tight">
        Importer le catalogue
      </h1>
      <p class="max-w-prose text-muted">
        Ajoutez en une fois les articles et prestations du cabinet à partir d’un fichier de tableur
        enregistré au format CSV. Les articles déjà au catalogue ne sont pas modifiés.
      </p>
      <p v-if="showsLegacy" class="max-w-prose text-muted">
        Les créances du carnet papier (ventes antérieures dont il reste un dû) se reprennent plus
        bas, dans « Créances papier ».
      </p>
    </header>

    <section aria-labelledby="titre-modele" class="space-y-3">
      <h2 id="titre-modele" class="text-xl font-semibold">1. Préparer le fichier</h2>
      <p class="max-w-prose">
        Téléchargez le modèle, remplissez une ligne par article (au plus {{ IMPORT_MAX_ROWS }}),
        puis enregistrez-le au format CSV. Les deux lignes d’exemple sont à remplacer.
      </p>
      <AppButton variant="secondary" @click="downloadTemplate">Télécharger le modèle</AppButton>
      <details class="rounded-lg border-2 border-line bg-surface p-3">
        <summary class="min-h-11 cursor-pointer py-2 font-semibold">Colonnes du fichier</summary>
        <ul class="mt-2 list-disc space-y-1 pl-6 text-sm">
          <li v-for="column in IMPORT_COLUMNS" :key="column.field">
            <span class="font-medium">{{ column.headers[0] }}</span>
            {{ column.required ? '(obligatoire)' : '(facultative)' }}
          </li>
        </ul>
        <p class="mt-2 text-sm text-muted">
          Catégorie et unité : leur nom (Monture, Paire…) ou leur code. Mode de stock : sans stock,
          stocké ou sur mesure. Oui/non pour quantité entière, périssable, actif et visible au
          public. Prix en FCFA entiers (« 50 000 »). Taxe : le code d’une règle fiscale du cabinet.
        </p>
      </details>
    </section>

    <section aria-labelledby="titre-fichier" class="space-y-3">
      <h2 id="titre-fichier" class="text-xl font-semibold">2. Choisir le fichier</h2>
      <label for="fichier-catalogue" class="field-label block">Fichier CSV du catalogue</label>
      <input
        id="fichier-catalogue"
        type="file"
        accept=".csv,text/csv"
        class="block min-h-11 w-full max-w-full text-base"
        :disabled="busy"
        @change="choose"
      />
      <StateMessage v-if="readError" state="error" title="Fichier illisible">{{
        readError
      }}</StateMessage>
      <template v-if="parsed">
        <p role="status" class="font-medium">
          {{ fileName }} : {{ rows.length }} article(s) lu(s).
        </p>
        <p v-if="parsed.ignoredColumns.length > 0" class="text-sm text-muted">
          Colonnes ignorées : {{ parsed.ignoredColumns.join(', ') }}.
        </p>
        <StateMessage
          v-if="localProblems.length > 0"
          state="error"
          title="Le fichier est à corriger avant toute vérification"
        >
          <ul class="mt-2 list-disc space-y-1 pl-5">
            <li v-for="(item, index) in localProblems" :key="index">
              Ligne {{ item.line }}{{ columnLabel(item.column) }} : {{ item.message }}
            </li>
          </ul>
        </StateMessage>
      </template>
    </section>

    <section aria-labelledby="titre-verification" class="space-y-3">
      <h2 id="titre-verification" class="text-xl font-semibold">3. Vérifier, puis importer</h2>
      <div class="flex flex-wrap gap-3">
        <AppButton
          variant="secondary"
          :disabled="!canCheck"
          :pending="busy && pending === 'check'"
          pending-label="Vérification en cours…"
          @click="send(true)"
          >Vérifier sur le serveur</AppButton
        >
        <AppButton
          variant="primary"
          :disabled="!canImport"
          :pending="busy && pending === 'import'"
          pending-label="Import en cours…"
          @click="send(false)"
          >Importer {{ report?.accepted ?? 0 }} article(s)</AppButton
        >
      </div>

      <StateMessage
        v-if="report && report.rejected.length === 0 && imported === null"
        state="success"
        title="Fichier vérifié par le serveur"
      >
        {{ report.accepted }} article(s) prêt(s) à être importé(s). Rien n’a encore été enregistré.
      </StateMessage>
      <StateMessage
        v-else-if="report && report.rejected.length > 0"
        state="error"
        title="Lignes refusées par le serveur : rien n’a été enregistré"
      >
        <ul class="mt-2 list-disc space-y-1 pl-5">
          <li v-for="(item, index) in report.rejected" :key="index">
            Ligne {{ item.line }}{{ columnLabel(item.field) }} : {{ item.message }}
          </li>
        </ul>
        <p class="mt-2">Corrigez le fichier, choisissez-le de nouveau puis vérifiez-le.</p>
      </StateMessage>
      <StateMessage
        v-if="serverProblems.length > 0"
        state="error"
        title="Import refusé : aucun article n’a été enregistré"
      >
        <ul class="mt-2 list-disc space-y-1 pl-5">
          <li v-for="(message, index) in serverProblems" :key="index">{{ message }}</li>
        </ul>
      </StateMessage>
      <StateMessage
        v-if="mutation.failureMessage.value && !askingPassword"
        state="offline"
        title="Demande non aboutie"
      >
        {{ mutation.failureMessage.value }}
      </StateMessage>
      <StateMessage v-if="imported" state="success" title="Catalogue importé">
        {{ imported.accepted }} article(s) enregistré(s) sur le serveur.
        <template #action>
          <LinkButton :to="{ name: 'catalogue' }" variant="secondary">Voir le catalogue</LinkButton>
        </template>
      </StateMessage>
    </section>

    <template v-if="showsLegacy">
      <hr class="border-line" />
      <LegacyBalances />
    </template>

    <PasswordConfirmDialog
      :open="askingPassword"
      action="L’import du catalogue"
      @confirmed="onPasswordConfirmed"
      @cancel="askingPassword = false"
    />
  </section>
</template>
