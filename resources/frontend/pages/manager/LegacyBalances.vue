<script setup lang="ts">
/**
 * Reprise des créances papier (X01, AT26, AT39), gérante (`finance.global.read`), module « sales », EN LIGNE.
 * Une créance d'un carnet papier (vente faite avant l'application, dont il reste un dû) devient une pièce émise
 * dont le total est le SEUL reste dû : ni vente du jour, ni encaissement de l'ancien acompte, ni stock. Le reste
 * dû se règle ensuite par l'encaissement habituel de la facture (un reçu par encaissement).
 *
 * 1. Déposer le justificatif scanné (PDF, JPEG ou PNG) : obligatoire, conservé en privé.
 * 2. Saisir une créance (patient retrouvé par la recherche, identité jamais ressaisie) ou choisir un fichier
 *    CSV (le carnet entier, lu sur ce poste).
 * 3. « Vérifier sur le serveur » : aperçu sans écriture ; « Reprendre » : toutes les créances ou aucune.
 * L'opération demande la confirmation du mot de passe (423), puis renvoie la MÊME demande avec la même clé. On
 * n'écrit jamais « payé » ni « soldé » : seulement le reste dû repris.
 */
import { computed, ref, shallowRef } from 'vue'
import { RouterLink } from 'vue-router'

import { ApiError } from '@/app/api'
import { clinicToday } from '@/app/clinicTime'
import { submitLegacyBalances, uploadLegacyEvidence } from '@/app/services/legacyBalances'
import { newIdempotencyKey } from '@/app/services/mutations'
import { searchPatients } from '@/app/services/patients'
import { revalidateSession } from '@/app/session'
import StateMessage from '@/components/feedback/StateMessage.vue'
import ComboboxField, {
  type ComboboxOption,
  type ComboboxSearchResult,
} from '@/components/form/ComboboxField.vue'
import DateField from '@/components/form/DateField.vue'
import MoneyField from '@/components/form/MoneyField.vue'
import TextField from '@/components/form/TextField.vue'
import PatientIdentityHeader from '@/components/patients/PatientIdentityHeader.vue'
import PasswordConfirmDialog from '@/components/session/PasswordConfirmDialog.vue'
import AppButton from '@/components/ui/AppButton.vue'
import type { ImportProblem } from '@/domain/billing/catalogImport'
import {
  type LegacyImportRow,
  legacyTemplateCsv,
  openingOrProblem,
  type ParsedLegacyImport,
  readLegacyCsv,
} from '@/domain/billing/legacyImport'
import type { ImportReport, LegacyEvidence, PatientSummary } from '@/domain/contracts/generated'
import { patientAge, formatAge, patientDisplayName } from '@/domain/patients/identity'
import { nonEmpty } from '@/domain/values/list'
import { formatMoney } from '@/domain/values/money'

type Mode = 'single' | 'file'

const mode = ref<Mode>('single')

// --- Justificatif -----------------------------------------------------------------------------------
const evidence = ref<LegacyEvidence | null>(null)
const evidenceName = ref<string | null>(null)
const evidenceError = ref<string | null>(null)
const uploading = ref(false)

// --- Créance unique ---------------------------------------------------------------------------------
const patientId = ref<string | null>(null)
const selected = shallowRef<PatientSummary | null>(null)
const known = new Map<string, PatientSummary>()
const reference = ref('')
const originalTotal = ref<number | null>(null)
const alreadyPaid = ref<number | null>(0)
const invoiceDate = ref<string | null>(null)

// --- Fichier ----------------------------------------------------------------------------------------
const fileName = ref<string | null>(null)
const parsed = ref<ParsedLegacyImport | null>(null)
const readError = ref<string | null>(null)

// --- Envoi ------------------------------------------------------------------------------------------
const report = ref<ImportReport | null>(null)
const imported = ref<ImportReport | null>(null)
const serverProblems = ref<string[]>([])
const failure = ref<string | null>(null)
const askingPassword = ref(false)
const pending = ref<'check' | 'import' | null>(null)
/** Dernière demande envoyée et sa clé : une reprise (mot de passe, coupure) renvoie la même. */
let lastRequest: {
  dryRun: boolean
  rows: LegacyImportRow[]
  key: string
  fingerprint: string
} | null = null

const singleOpening = computed<number | string | null>(() =>
  originalTotal.value === null || alreadyPaid.value === null
    ? null
    : openingOrProblem(originalTotal.value, alreadyPaid.value),
)

const singleRow = computed<LegacyImportRow | null>(() => {
  if (
    patientId.value === null ||
    reference.value.trim() === '' ||
    typeof singleOpening.value !== 'number'
  )
    return null
  return {
    line: 2,
    patient_id: patientId.value,
    patient_record_number: null,
    paper_reference: reference.value.trim(),
    original_total: originalTotal.value,
    already_paid: alreadyPaid.value,
    original_invoice_on: invoiceDate.value,
  }
})

const rows = computed<LegacyImportRow[]>(() => {
  if (mode.value === 'single') return singleRow.value === null ? [] : [singleRow.value]
  return parsed.value?.rows ?? []
})
const localProblems = computed<ImportProblem[]>(() =>
  mode.value === 'file' ? (parsed.value?.problems ?? []) : [],
)
const totalOpening = computed(() =>
  mode.value === 'single'
    ? typeof singleOpening.value === 'number'
      ? singleOpening.value
      : 0
    : (parsed.value?.openings ?? []).reduce((sum, value) => sum + value, 0),
)
const busy = computed(() => pending.value !== null)
const canCheck = computed(
  () =>
    evidence.value !== null &&
    rows.value.length > 0 &&
    localProblems.value.length === 0 &&
    !busy.value,
)
const canImport = computed(
  () =>
    canCheck.value &&
    report.value !== null &&
    report.value.rejected.length === 0 &&
    report.value.accepted === rows.value.length &&
    imported.value === null,
)

function resetResults(): void {
  report.value = null
  imported.value = null
  serverProblems.value = []
  failure.value = null
}

function choose(next: Mode): void {
  mode.value = next
  resetResults()
}

async function chooseEvidence(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0] ?? null
  evidenceError.value = null
  if (file === null) return
  uploading.value = true
  try {
    evidence.value = await uploadLegacyEvidence(file)
    evidenceName.value = file.name
    resetResults()
  } catch (error) {
    evidence.value = null
    if (error instanceof ApiError && error.status === 423) {
      evidenceError.value =
        'Confirmez votre mot de passe, puis choisissez de nouveau le fichier du justificatif.'
      askingPassword.value = true
    } else if (error instanceof ApiError && error.status === 422) {
      evidenceError.value = Object.values(error.fields).flat()[0] ?? error.message
    } else {
      evidenceError.value =
        'Le justificatif n’a pas pu être déposé : vérifiez la connexion et réessayez.'
    }
  } finally {
    uploading.value = false
    input.value = ''
  }
}

async function chooseFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0] ?? null
  resetResults()
  readError.value = null
  parsed.value = null
  fileName.value = file?.name ?? null
  if (file === null) return
  try {
    parsed.value = readLegacyCsv(await file.text())
  } catch {
    readError.value =
      'Le fichier n’a pas pu être lu : enregistrez-le au format CSV (UTF-8) et réessayez.'
  }
}

function downloadTemplate(): void {
  const blob = new Blob([`\u{FEFF}${legacyTemplateCsv()}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'modele-creances-papier.csv'
  link.click()
  URL.revokeObjectURL(url)
}

function optionOf(patient: PatientSummary): ComboboxOption {
  return {
    value: patient.id,
    label: patientDisplayName(patient.last_name, patient.first_names),
    description: [
      `Dossier ${patient.record_number}`,
      formatAge(patientAge(patient.birth_date, clinicToday())),
    ].join(' · '),
  }
}

async function searchForPatients(query: string): Promise<ComboboxSearchResult> {
  try {
    const { data } = await searchPatients(query)
    for (const patient of data.data) known.set(patient.id, patient)
    return data.data.map(optionOf)
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 419)) {
      void revalidateSession().catch(() => undefined)
    }
    throw error
  }
}

function onSelect(option: ComboboxOption | null): void {
  selected.value = option === null ? null : (known.get(option.value) ?? null)
  resetResults()
}

const selectedLabel = computed(() =>
  selected.value === null
    ? null
    : patientDisplayName(selected.value.last_name, selected.value.first_names),
)

async function send(dryRun: boolean): Promise<void> {
  if (busy.value || evidence.value === null) return
  const payloadRows = rows.value.map((row) => ({ ...row }))
  const fingerprint = JSON.stringify([dryRun, evidence.value.file_id, payloadRows])
  // Une nouvelle intention (contenu différent) prend une nouvelle clé ; une reprise garde la sienne.
  if (lastRequest === null || lastRequest.fingerprint !== fingerprint) {
    lastRequest = { dryRun, rows: payloadRows, key: newIdempotencyKey(), fingerprint }
  }
  await dispatch()
}

async function dispatch(): Promise<void> {
  const request = lastRequest
  if (request === null || evidence.value === null) return
  serverProblems.value = []
  failure.value = null
  pending.value = request.dryRun ? 'check' : 'import'
  try {
    const result = await submitLegacyBalances(
      {
        dry_run: request.dryRun,
        evidence_file_id: evidence.value.file_id,
        rows: nonEmpty(request.rows, 'créance'),
      },
      request.key,
    )
    if (result.dry_run) report.value = result
    else imported.value = result
  } catch (error) {
    if (!(error instanceof ApiError)) {
      failure.value =
        'Aucune réponse du serveur : rien n’est conclu. Réessayez, la même demande sera renvoyée sans doublon.'
    } else if (error.status === 423) {
      askingPassword.value = true
    } else if (error.status === 401 || error.status === 419) {
      failure.value = 'Session expirée : reconnectez-vous, puis réessayez.'
      void revalidateSession().catch(() => undefined)
    } else if (error.status === 422) {
      const messages = Object.values(error.fields).flat()
      serverProblems.value = messages.length > 0 ? [...messages] : [error.message]
    } else {
      failure.value = error.message
    }
  } finally {
    pending.value = null
  }
}

async function onPasswordConfirmed(): Promise<void> {
  askingPassword.value = false
  if (lastRequest !== null) await dispatch()
}

function columnLabel(column: string | null): string {
  return column === null ? '' : ` (${column})`
}
</script>

<template>
  <section aria-labelledby="titre-creances" class="space-y-6">
    <header class="space-y-2">
      <h2 id="titre-creances" class="text-xl font-semibold">Créances papier</h2>
      <p class="max-w-prose text-muted">
        Reprenez ce qu’un patient doit encore sur une vente notée dans le carnet papier. Seul le
        reste dû est repris : la vente et l’acompte d’origine restent dans le carnet. Le reste dû
        s’encaisse ensuite depuis la facture, avec un reçu pour chaque encaissement.
      </p>
    </header>

    <section aria-labelledby="titre-justificatif" class="space-y-2">
      <h3 id="titre-justificatif" class="text-lg font-semibold">1. Justificatif scanné</h3>
      <label for="creance-justificatif" class="field-label block"
        >Scan de la pièce ou de la page du carnet (PDF, JPEG ou PNG)</label
      >
      <input
        id="creance-justificatif"
        type="file"
        accept="application/pdf,image/jpeg,image/png"
        class="block min-h-11 w-full max-w-full text-base"
        :disabled="uploading || busy"
        @change="chooseEvidence"
      />
      <p v-if="uploading" role="status">Dépôt du justificatif en cours…</p>
      <p v-else-if="evidence" role="status" class="font-medium">
        <span aria-hidden="true">✓ </span>Justificatif conservé sur le serveur : {{ evidenceName }}.
      </p>
      <StateMessage v-if="evidenceError" state="error" title="Justificatif non déposé">{{
        evidenceError
      }}</StateMessage>
    </section>

    <section aria-labelledby="titre-saisie-creance" class="space-y-4">
      <h3 id="titre-saisie-creance" class="text-lg font-semibold">2. Créance à reprendre</h3>
      <div class="flex flex-wrap gap-2" role="group" aria-label="Mode de reprise">
        <AppButton variant="secondary" :pressed="mode === 'single'" @click="choose('single')"
          >Une créance</AppButton
        >
        <AppButton variant="secondary" :pressed="mode === 'file'" @click="choose('file')"
          >Un fichier CSV</AppButton
        >
      </div>

      <div v-if="mode === 'single'" class="space-y-4">
        <ComboboxField
          v-model="patientId"
          control-id="creance-patient"
          label="Patient"
          required
          :selected-label="selectedLabel"
          :search="searchForPatients"
          unavailable-text="Recherche indisponible : vérifiez la connexion."
          :disabled="busy"
          hint="Nom, prénom, téléphone ou numéro de dossier. Au moins 2 caractères."
          @select="onSelect"
        />
        <PatientIdentityHeader v-if="selected" :patient="selected" />
        <TextField
          v-model="reference"
          label="Référence de la pièce papier"
          hint="Numéro du carnet ou de la facture papier : il ne peut être repris qu’une fois."
          control-id="creance-reference"
          :maxlength="100"
          required
          :disabled="busy"
        />
        <MoneyField
          v-model="originalTotal"
          label="Total de la pièce papier (FCFA)"
          field="original_total"
          control-id="creance-total"
          required
          :disabled="busy"
        />
        <MoneyField
          v-model="alreadyPaid"
          label="Déjà réglé sur papier (FCFA)"
          field="already_paid"
          hint="0 si rien n’a été réglé."
          control-id="creance-deja"
          required
          :disabled="busy"
        />
        <DateField
          v-model="invoiceDate"
          label="Date de la pièce papier (facultative)"
          control-id="creance-date"
          :disabled="busy"
        />
        <p v-if="typeof singleOpening === 'number'" role="status" class="text-lg font-semibold">
          Reste dû repris : {{ formatMoney(singleOpening) }}
        </p>
        <StateMessage
          v-else-if="typeof singleOpening === 'string'"
          state="error"
          title="Montants à corriger"
          >{{ singleOpening }}</StateMessage
        >
      </div>

      <div v-else class="space-y-3">
        <p class="max-w-prose">
          Colonnes : reference_papier, dossier (numéro de dossier du patient), total_origine,
          deja_paye (vide = 0), date_piece. Une ligne par créance, au plus 500.
        </p>
        <AppButton variant="secondary" @click="downloadTemplate">Télécharger le modèle</AppButton>
        <label for="creance-fichier" class="field-label block">Fichier CSV des créances</label>
        <input
          id="creance-fichier"
          type="file"
          accept=".csv,text/csv"
          class="block min-h-11 w-full max-w-full text-base"
          :disabled="busy"
          @change="chooseFile"
        />
        <StateMessage v-if="readError" state="error" title="Fichier illisible">{{
          readError
        }}</StateMessage>
        <template v-if="parsed">
          <p role="status" class="font-medium">
            {{ fileName }} : {{ parsed.rows.length }} créance(s) lue(s), reste dû total
            {{ formatMoney(totalOpening) }}.
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
      </div>
    </section>

    <section aria-labelledby="titre-reprise" class="space-y-3">
      <h3 id="titre-reprise" class="text-lg font-semibold">3. Vérifier, puis reprendre</h3>
      <p v-if="evidence === null" class="text-sm text-muted">
        Déposez d’abord le justificatif scanné : il est obligatoire.
      </p>
      <div class="flex flex-wrap gap-3">
        <AppButton
          variant="secondary"
          :disabled="!canCheck"
          :pending="pending === 'check'"
          pending-label="Vérification en cours…"
          @click="send(true)"
          >Vérifier sur le serveur</AppButton
        >
        <AppButton
          variant="primary"
          :disabled="!canImport"
          :pending="pending === 'import'"
          pending-label="Reprise en cours…"
          @click="send(false)"
          >Reprendre {{ report?.accepted ?? 0 }} créance(s)</AppButton
        >
      </div>

      <StateMessage
        v-if="report && report.rejected.length === 0 && imported === null"
        state="success"
        title="Créances vérifiées par le serveur"
      >
        {{ report.accepted }} créance(s) prête(s) à être reprise(s), reste dû total
        {{ formatMoney(totalOpening) }}. Rien n’a encore été enregistré.
      </StateMessage>
      <StateMessage
        v-else-if="report && report.rejected.length > 0"
        state="error"
        title="Créances refusées par le serveur : rien n’a été enregistré"
      >
        <ul class="mt-2 list-disc space-y-1 pl-5">
          <li v-for="(item, index) in report.rejected" :key="index">
            Ligne {{ item.line }}{{ columnLabel(item.field) }} : {{ item.message }}
          </li>
        </ul>
      </StateMessage>
      <StateMessage
        v-if="serverProblems.length > 0"
        state="error"
        title="Reprise refusée : aucune créance n’a été enregistrée"
      >
        <ul class="mt-2 list-disc space-y-1 pl-5">
          <li v-for="(message, index) in serverProblems" :key="index">{{ message }}</li>
        </ul>
      </StateMessage>
      <StateMessage v-if="failure" state="offline" title="Demande non aboutie">{{
        failure
      }}</StateMessage>
      <StateMessage v-if="imported" state="success" title="Créances reprises">
        <p>{{ imported.accepted }} pièce(s) de reprise émise(s) sur le serveur.</p>
        <ul class="mt-2 list-disc space-y-1 pl-5">
          <li v-for="(id, index) in imported.created_ids" :key="id">
            <RouterLink
              :to="{ name: 'facture', params: { id } }"
              class="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
              >Ouvrir la pièce {{ index + 1 }} et encaisser le reste dû</RouterLink
            >
          </li>
        </ul>
      </StateMessage>
    </section>

    <PasswordConfirmDialog
      :open="askingPassword"
      action="La reprise des créances papier"
      @confirmed="onPasswordConfirmed"
      @cancel="askingPassword = false"
    />
  </section>
</template>
