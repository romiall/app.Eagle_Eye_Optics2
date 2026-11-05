<script setup lang="ts">
/**
 * Ordonnances optiques EXTERNES d'un patient (C04, A13 « transcrire une ordonnance externe identifiée »),
 * EN LIGNE : un patient apporte l'ordonnance d'un autre prescripteur pour ses lunettes. Elle se transcrit
 * sans consultation fictive : prescripteur et date d'origine obligatoires, valeurs recopiées telles
 * qu'écrites (rien n'est calculé ni complété). Brouillon, puis « Valider la prescription » (immuable) ; une
 * correction crée une nouvelle version. Même éditeur et mêmes règles que la prescription d'une
 * consultation (`usePrescriptionEditor`, source externe). Une transcription n'est dite enregistrée qu'après
 * la réponse du serveur. Sans le droit d'écriture : lecture seule.
 *
 * Présentation : titre de section, saisie dans une carte avec sa barre d'actions, dernière version en
 * tête et versions précédentes repliées ; sans ordonnance, un état vide propose la transcription.
 */
import { computed, ref } from 'vue'

import { clinicTimeZone } from '@/app/clinicTime'
import { useUnsavedChangesGuard } from '@/app/unsavedChanges'
import ErrorSummary from '@/components/feedback/ErrorSummary.vue'
import SaveStatus from '@/components/feedback/SaveStatus.vue'
import StateMessage from '@/components/feedback/StateMessage.vue'
import EmptyState from '@/components/layout/EmptyState.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { RX_IDS } from '@/domain/clinical/prescriptions'
import DeletePrescriptionDraftDialog from '@/pages/consultations/DeletePrescriptionDraftDialog.vue'
import { failureView } from '@/pages/consultations/failureView'
import PrescriptionForm from '@/pages/consultations/PrescriptionForm.vue'
import PrescriptionView from '@/pages/consultations/PrescriptionView.vue'
import { usePrescriptionEditor } from '@/pages/consultations/usePrescriptionEditor'

const props = defineProps<{ patientId: string }>()

const editor = usePrescriptionEditor({ kind: 'external', patientId: props.patientId })
const {
  listRead,
  mutation,
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
  return 'Transcription d’une ordonnance externe (brouillon)'
})

useUnsavedChangesGuard(dirty)

// Suppression du brouillon enregistré : jamais une ordonnance validée (elle se corrige par une nouvelle version).
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
</script>

<template>
  <section aria-labelledby="titre-ordonnances-externes" class="space-y-6">
    <div class="space-y-1">
      <h2 id="titre-ordonnances-externes" class="section-title">Ordonnances externes</h2>
      <p class="max-w-prose text-muted">
        Ordonnances rédigées par un autre prescripteur et apportées par le patient. Les
        prescriptions faites au cabinet se trouvent dans chaque consultation.
      </p>
    </div>

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
      title="Chargement des ordonnances…"
    />
    <StateMessage
      v-else-if="listRead.state.value !== 'ready' && listRead.state.value !== 'empty'"
      state="offline"
      title="Ordonnances indisponibles"
    >
      Le serveur n’a pas répondu : les ordonnances n’ont pas pu être lues. Aucune ancienne copie ni
      liste vide n’est présentée.
      <template #action>
        <AppButton variant="secondary" @click="listRead.reload()">Réessayer</AppButton>
      </template>
    </StateMessage>

    <template v-else>
      <StateMessage v-if="conflict" state="conflict" title="Ce brouillon a été modifié entre-temps">
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
        class="card space-y-6 p-4 sm:p-6"
        novalidate
        @submit.prevent="editor.saveDraft"
      >
        <h3 :id="RX_IDS.form" tabindex="-1" class="text-lg font-semibold focus:outline-none">
          {{ heading }}
        </h3>
        <p
          class="flex items-start gap-2 rounded-lg border border-warning bg-warning-soft px-3 py-2 text-sm font-semibold text-ink"
        >
          <span aria-hidden="true" class="text-warning">○</span>BROUILLON : recopiez les valeurs
          telles qu’elles sont écrites sur l’ordonnance, puis validez.
        </p>
        <PrescriptionForm v-model="draft" :errors="errorMap" :disabled="busy || !canWrite" />
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
          <AppButton variant="ghost" :disabled="busy" @click="editor.cancelEdit">Annuler</AppButton>
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
      </form>

      <!-- Lecture -->
      <template v-else>
        <EmptyState v-if="list.length === 0" title="Aucune ordonnance externe" icon="glasses">
          Aucune ordonnance externe n’est enregistrée pour ce patient.
          <template v-if="canWrite" #action>
            <AppButton variant="primary" @click="editor.startNew"
              ><AppIcon name="plus" :size="18" />Transcrire une ordonnance externe</AppButton
            >
          </template>
        </EmptyState>
        <template v-else-if="latest">
          <p v-if="canWrite">
            <AppButton variant="primary" @click="editor.startNew"
              ><AppIcon name="plus" :size="18" />Transcrire une ordonnance externe</AppButton
            >
          </p>
          <PrescriptionView :prescription="latest" />
          <AppButton
            v-if="latest.status === 'VALIDATED' && canAmend && canWrite"
            variant="secondary"
            @click="editor.startRevision"
            >Créer une nouvelle version</AppButton
          >
          <details v-if="olderVersions.length > 0" class="card group p-0">
            <summary
              class="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-3 text-base font-semibold sm:px-6"
            >
              Ordonnances et versions précédentes ({{ olderVersions.length }})
              <AppIcon
                name="chevron-down"
                :size="20"
                class="text-muted transition-transform group-open:rotate-180"
              />
            </summary>
            <div class="space-y-4 border-t border-line p-4 sm:p-6">
              <PrescriptionView
                v-for="version in olderVersions"
                :key="version.id"
                :prescription="version"
              />
            </div>
          </details>
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
    </template>
  </section>
</template>
