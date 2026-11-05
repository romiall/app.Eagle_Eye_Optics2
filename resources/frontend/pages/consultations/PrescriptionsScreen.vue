<script setup lang="ts">
/**
 * Prescription optique d'une consultation (C04 ; fichier 02, « Prescription optique » ; EE009, EE014 ; AT20,
 * AT21), EN LIGNE. La prescription est distincte des mesures : la copier depuis la réfraction est un geste
 * explicite et confirmé, puis elle s'édite sans toucher à l'examen.
 *
 * - Première prescription : brouillon (version 1). Brouillon enregistré : modifiable, avec détection des
 *   modifications faites ailleurs. « Valider » rend la version immuable et prépare le document (PDF généré par le
 *   moteur de documents) ; la corriger crée une NOUVELLE version, les anciennes restent lisibles.
 * - Rien n'est inféré : aucune valeur n'est calculée, transposée ou complétée ; vente et stock ne sont pas créés.
 * - Sans le droit d'écriture : lecture seule. Hors ligne : « indisponible », jamais une prescription vide.
 * L'ordonnance externe se transcrit depuis la fiche du patient ou la vente (aucune consultation fictive).
 * Présentation : en-tête d'écran (retour à la consultation une fois celle-ci lue), bandeau patient, brouillon
 * édité dans une carte, dernière version en carte de lecture, versions précédentes repliées.
 */
import { computed, ref } from 'vue'

import { clinicTimeZone } from '@/app/clinicTime'
import {
  mayOfferDocument,
  prescriptionDocument,
  printablePrescription,
} from '@/app/services/clinicalDocuments'
import { useUnsavedChangesGuard } from '@/app/unsavedChanges'
import ConfirmDialog from '@/components/feedback/ConfirmDialog.vue'
import ErrorSummary from '@/components/feedback/ErrorSummary.vue'
import SaveStatus from '@/components/feedback/SaveStatus.vue'
import StateMessage from '@/components/feedback/StateMessage.vue'
import SelectField from '@/components/form/SelectField.vue'
import PageHeader from '@/components/layout/PageHeader.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { STAGE_LABELS } from '@/domain/clinical/labels'
import { RX_IDS } from '@/domain/clinical/prescriptions'
import { REFRACTION_STAGES, type RefractionStage } from '@/domain/clinical/refraction'

import ClinicalPrintActions from './ClinicalPrintActions.vue'
import ConsultationReadMessage from './ConsultationReadMessage.vue'
import DeletePrescriptionDraftDialog from './DeletePrescriptionDraftDialog.vue'
import PatientBanner from './PatientBanner.vue'
import PrescriptionForm from './PrescriptionForm.vue'
import PrescriptionView from './PrescriptionView.vue'
import { failureView } from './failureView'
import type { PrintAction } from './useClinicalPrint'
import { usePrescriptionEditor } from './usePrescriptionEditor'

const props = defineProps<{ consultationId: string }>()

const editor = usePrescriptionEditor(props.consultationId)
const {
  consultationRead,
  listRead,
  mutation,
  consultation,
  list,
  latest,
  mode,
  draft,
  saved,
  dirty,
  errorMap,
  summary,
  summaryBox,
  notice,
  conflict,
  busy,
  canWrite,
  canAmend,
  canValidate,
  canDeleteDraft,
} = editor
const { failureMessage, recordedAt, state } = mutation

const timeZone = clinicTimeZone()
const failure = computed(() => failureView(state.value, mutation.error.value))
const editing = computed(() => mode.value !== 'idle' && draft.value !== null)
const saving = computed(() => state.value === 'saving')
const olderVersions = computed(() => list.value.slice(1))
const saveState = computed(() => {
  switch (state.value) {
    case 'saving':
      return 'saving' as const
    case 'synced':
      return dirty.value ? ('idle' as const) : ('saved-server' as const)
    case 'idle':
      return 'idle' as const
    default:
      return 'failed' as const
  }
})
const heading = computed(() => {
  if (mode.value === 'revise')
    return `Nouvelle version ${(latest.value?.version_no ?? 0) + 1} (brouillon)`
  if (mode.value === 'edit') return `Version ${saved.value?.version_no ?? 1} (brouillon)`
  return 'Nouvelle prescription (brouillon)'
})
const hasMeasures = computed(
  () => (consultation.value?.steps.REFRACTION.measurements.length ?? 0) > 0,
)
const hasCentering = computed(
  () => (consultation.value?.steps.CENTERING.centering_id ?? null) !== null,
)

/**
 * Impression (fichier 11 : « Bouton Imprimer prescription distinct du dossier complet ») : seulement la
 * version VALIDÉE la plus récente, jamais un brouillon (« ne pas remettre au patient »), et seulement pour un
 * compte qui ouvre ce document (`clinical.read`).
 */
const printable = computed(() => printablePrescription(list.value))
const printActions = computed<PrintAction[]>(() => {
  const target = printable.value
  const exam = consultation.value
  if (target === null || exam === null || !mayOfferDocument('OPTICAL_PRESCRIPTION')) return []
  return [
    {
      id: `prescription-${target.id}`,
      label: `Aperçu de la prescription (version ${target.version_no})`,
      heading: `Prescription optique, version ${target.version_no}`,
      run: () => prescriptionDocument(target, exam),
    },
  ]
})

useUnsavedChangesGuard(dirty)

// --- Suppression du brouillon enregistré (la validée ne se supprime jamais : nouvelle version) -------------------
const deleteOpen = ref(false)
const deletion = ref<{ state: 'success' | 'conflict'; message: string } | null>(null)

async function afterDeleteAttempt(state: 'success' | 'conflict', message: string): Promise<void> {
  deleteOpen.value = false
  deletion.value = { state, message }
  await editor.forgetDraft()
}

function bindSummary(element: unknown): void {
  summaryBox.value = element as { focus: () => Promise<void> } | null
}

// --- Copie explicite de la réfraction (confirmation) ----------------------------------------------
const copyOpen = ref(false)
const copyStage = ref<string | null>(null)
const copyError = ref<string | null>(null)
const stageOptions = REFRACTION_STAGES.map((stage) => ({
  value: stage,
  label: STAGE_LABELS[stage],
}))

function openCopy(): void {
  copyStage.value = null
  copyError.value = null
  copyOpen.value = true
}

function confirmCopy(): void {
  const stage = REFRACTION_STAGES.find((candidate) => candidate === copyStage.value)
  if (stage === undefined) {
    copyError.value = 'Choisissez la mesure à copier : aucune n’est copiée d’office.'
    return
  }
  const copied = editor.copyFromRefraction(stage as RefractionStage)
  if (copied.length === 0) {
    copyError.value = `${STAGE_LABELS[stage]} : aucune mesure à copier pour cet examen.`
    return
  }
  copyOpen.value = false
}

const copyCenteringOpen = ref(false)

function confirmCopyCentering(): void {
  editor.copyFromCentering()
  copyCenteringOpen.value = false
}
</script>

<template>
  <section aria-labelledby="titre-prescriptions" class="page-stack max-w-4xl">
    <PageHeader
      title-id="titre-prescriptions"
      title="Prescription optique"
      icon="glasses"
      :back="
        consultation === null
          ? undefined
          : {
              to: { name: 'consultation', params: { id: props.consultationId } },
              label: 'Retour à la consultation',
            }
      "
    />

    <ConsultationReadMessage
      v-if="consultation === null"
      :state="consultationRead.state.value"
      subject="consultation"
      :error="consultationRead.error.value"
      @retry="consultationRead.reload()"
    />

    <template v-else>
      <PatientBanner :consultation="consultation" />

      <StateMessage
        v-if="deletion !== null"
        :state="deletion.state"
        :title="deletion.state === 'success' ? 'Brouillon supprimé' : 'Brouillon non supprimé'"
      >
        {{ deletion.message }}
      </StateMessage>

      <StateMessage
        v-if="listRead.state.value === 'loading'"
        state="loading"
        title="Chargement des prescriptions…"
      />
      <StateMessage
        v-else-if="listRead.state.value !== 'ready' && listRead.state.value !== 'empty'"
        state="offline"
        title="Prescriptions indisponibles"
      >
        Le serveur n’a pas répondu : les prescriptions n’ont pas pu être lues. Aucune ancienne copie
        ni liste vide n’est présentée.
        <template #action>
          <AppButton variant="secondary" @click="listRead.reload()">Réessayer</AppButton>
        </template>
      </StateMessage>

      <template v-else>
        <StateMessage
          v-if="conflict"
          state="conflict"
          title="Ce brouillon a été modifié entre-temps"
        >
          <p>
            Une autre personne a modifié ce brouillon. Votre saisie est conservée ; l’enregistrer
            remplacera les valeurs suivantes :
          </p>
          <ul class="mt-2 list-disc space-y-1 pl-5">
            <li v-for="difference in conflict" :key="difference.key">
              {{ difference.label }} : actuellement « {{ difference.current }} », votre saisie «
              {{ difference.mine }} ».
            </li>
          </ul>
        </StateMessage>

        <ErrorSummary :ref="bindSummary" :errors="summary" />
        <StateMessage v-if="failure" :state="failure.state" :title="failure.title">
          {{ failureMessage }}
          <template v-if="failure.retry" #action>
            <AppButton variant="secondary" :pending="busy" @click="editor.retry"
              >Réessayer l’enregistrement</AppButton
            >
          </template>
        </StateMessage>

        <!-- Édition -->
        <form
          v-if="editing && draft"
          class="card space-y-6 p-4 lg:p-6"
          novalidate
          @submit.prevent="editor.saveDraft"
        >
          <div class="space-y-3 border-b border-line pb-4">
            <h2 :id="RX_IDS.form" tabindex="-1" class="text-xl font-semibold focus:outline-none">
              {{ heading }}
            </h2>
            <p
              class="flex max-w-prose items-start gap-2 rounded-lg border border-warning bg-warning-soft px-3 py-2 text-sm font-semibold text-ink"
            >
              <AppIcon name="alert" :size="18" class="mt-px text-warning" />
              <span>BROUILLON : ne pas remettre au patient tant qu’elle n’est pas validée.</span>
            </p>
          </div>
          <PrescriptionForm
            v-model="draft"
            :errors="errorMap"
            :disabled="busy || !canWrite"
            :can-copy-refraction="hasMeasures"
            :can-copy-centering="hasCentering"
            @copy-refraction="openCopy"
            @copy-centering="copyCenteringOpen = true"
          />
          <p v-if="notice" role="status" class="font-medium text-ink">
            <span aria-hidden="true">○ </span>{{ notice }}
          </p>
          <p v-if="dirty" class="text-sm font-medium text-warning">
            <span aria-hidden="true">● </span>Modifications non enregistrées.
          </p>
          <div class="form-actions">
            <AppButton
              v-if="canWrite"
              type="submit"
              variant="primary"
              :pending="saving"
              pending-label="Enregistrement en cours…"
              :disabled="busy"
              >Enregistrer le brouillon</AppButton
            >
            <AppButton
              v-if="mode === 'edit' && canValidate"
              variant="secondary"
              :disabled="busy || dirty"
              @click="editor.validate"
              >Valider la prescription</AppButton
            >
            <AppButton variant="ghost" :disabled="busy" @click="editor.cancelEdit"
              >Annuler</AppButton
            >
            <AppButton
              v-if="canDeleteDraft"
              variant="danger"
              :disabled="busy"
              :accessible-name="`Supprimer le brouillon de la version ${saved?.version_no ?? 1}`"
              @click="deleteOpen = true"
              ><AppIcon name="trash" :size="18" />Supprimer le brouillon</AppButton
            >
            <SaveStatus :state="saveState" :at="recordedAt" :time-zone="timeZone" />
          </div>
          <p v-if="mode === 'edit'" class="max-w-prose text-sm text-muted">
            Valider rend cette version immuable et prépare son document PDF ; pour la corriger
            ensuite, vous créerez une nouvelle version. Valider ne crée ni vente ni mouvement de
            stock.
          </p>
        </form>

        <!-- Lecture -->
        <template v-else>
          <StateMessage v-if="list.length === 0" state="empty" title="Aucune prescription">
            Aucune prescription optique n’est enregistrée pour cette consultation.
            <template v-if="canWrite" #action>
              <AppButton variant="primary" @click="editor.startNew"
                ><AppIcon name="plus" :size="18" />Nouvelle prescription</AppButton
              >
            </template>
          </StateMessage>

          <template v-else-if="latest">
            <div class="space-y-3">
              <h2 class="section-title">Dernière version</h2>
              <PrescriptionView :prescription="latest" />
              <p v-if="latest.status === 'VALIDATED' && canAmend && canWrite">
                <AppButton variant="secondary" @click="editor.startRevision"
                  ><AppIcon name="edit" :size="18" />Créer une nouvelle version</AppButton
                >
              </p>
            </div>
            <ClinicalPrintActions
              v-if="printable && printActions.length > 0"
              :key="printable.id"
              title-id="titre-imprimer-prescription"
              title="Imprimer la prescription"
              :actions="printActions"
            >
              <p>
                Version {{ printable.version_no }} validée : document distinct du dossier complet.
                Un brouillon ne s’imprime pas ; il ne se remet pas au patient.
              </p>
            </ClinicalPrintActions>
            <details
              v-if="olderVersions.length > 0"
              class="group rounded-xl border border-line bg-canvas"
            >
              <summary
                class="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-3 text-base font-semibold hover:bg-primary-soft"
              >
                <span class="flex items-center gap-2"
                  ><AppIcon name="history" :size="18" class="text-gold" />Versions précédentes ({{
                    olderVersions.length
                  }})</span
                >
                <AppIcon name="chevron-down" :size="18" class="group-open:rotate-180" />
              </summary>
              <div class="space-y-4 px-4 pt-1 pb-4">
                <PrescriptionView
                  v-for="version in olderVersions"
                  :key="version.id"
                  :prescription="version"
                />
              </div>
            </details>
          </template>
        </template>
      </template>

      <DeletePrescriptionDraftDialog
        v-if="deleteOpen && saved !== null"
        :prescription-id="saved.id"
        :updated-at="saved.updated_at"
        :version-no="saved.version_no"
        @deleted="afterDeleteAttempt('success', $event)"
        @stale="afterDeleteAttempt('conflict', $event)"
        @close="deleteOpen = false"
      />

      <ConfirmDialog
        :open="copyOpen"
        title="Copier une mesure de réfraction ?"
        confirm-label="Copier dans la prescription"
        @confirm="confirmCopy"
        @cancel="copyOpen = false"
      >
        <div class="space-y-3">
          <p>
            Les valeurs choisies (sphère, cylindre, axe et addition pour la réfraction subjective)
            seront recopiées dans la prescription et remplaceront celles des yeux concernés. La
            prescription s’édite ensuite sans modifier l’examen.
          </p>
          <SelectField
            v-model="copyStage"
            label="Mesure à copier"
            placeholder="Choisir une mesure…"
            :options="stageOptions"
            :error="copyError"
            required
          />
        </div>
      </ConfirmDialog>
      <ConfirmDialog
        :open="copyCenteringOpen"
        title="Reporter les écarts du centrage ?"
        confirm-label="Reporter dans la prescription"
        @confirm="confirmCopyCentering"
        @cancel="copyCenteringOpen = false"
      >
        Les écarts pupillaires mesurés au centrage remplaceront ceux de la prescription. Aucun écart
        n’est calculé à votre place.
      </ConfirmDialog>
    </template>
  </section>
</template>
