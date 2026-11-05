<script setup lang="ts">
/**
 * Formulaire de modification d'une fiche (P01 ; fichier 02 ; AT04, AT42). La fiche est lue sur le
 * serveur ; seuls les champs modifiés partent, avec la version lue (`expected_version`) : jamais de
 * dernier écrit gagnant. Si la fiche a changé entre-temps (409 VERSION_CONFLICT), la saisie est
 * conservée et « Recharger la fiche » la rebase sur la version actuelle : les champs que la personne
 * n'a pas touchés reprennent la valeur du serveur, ceux qu'elle a modifiés gardent sa saisie, et
 * ceux qui ont changé des deux côtés sont signalés avec la valeur actuelle avant tout nouvel envoi.
 * Une instance par fiche (l'écran la recrée quand l'adresse change).
 */
import { computed, ref, shallowRef, watch } from 'vue'
import { useRouter } from 'vue-router'

import { clinicTimeZone } from '@/app/clinicTime'
import type { MutationOutcome } from '@/app/services/mutations'
import { getPatient } from '@/app/services/patients'
import { useMutation } from '@/app/services/useMutation'
import { revalidateSession } from '@/app/session'
import { useUnsavedChangesGuard } from '@/app/unsavedChanges'
import ErrorSummary from '@/components/feedback/ErrorSummary.vue'
import SaveStatus from '@/components/feedback/SaveStatus.vue'
import StateMessage from '@/components/feedback/StateMessage.vue'
import { formatDateFr } from '@/components/form/format'
import PageHeader from '@/components/layout/PageHeader.vue'
import PatientIdentityHeader from '@/components/patients/PatientIdentityHeader.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import LinkButton from '@/components/ui/LinkButton.vue'
import type { Patient } from '@/domain/contracts/generated'
import {
  blankPatientForm,
  FIELD_LABELS,
  FORM_FIELDS,
  formFromPatient,
  type PatientFormField,
  type PatientFormState,
  type PatientIdentity,
} from '@/domain/patients/form'
import { sexLabel } from '@/domain/patients/identity'
import { buildUpdatePatientPayload } from '@/domain/patients/payload'
import { rebaseEdits } from '@/domain/patients/rebase'

import { failureView } from './failureView'
import { setFlash } from './flash'
import PatientFormFields from './PatientFormFields.vue'
import ReadStateMessage from './ReadStateMessage.vue'
import { usePatientForm } from './usePatientForm'
import { usePatientRead } from './usePatientRead'

const props = defineProps<{ patientId: string }>()

const router = useRouter()
const read = usePatientRead<Patient>(() => getPatient(props.patientId))
const mutation = useMutation()
const { state, saveState, recordedAt, failureMessage } = mutation
/** Champs du formulaire (ref du gabarit) : la date de naissance est lue avant l'envoi. */
const fields = ref<{ commit: () => boolean } | null>(null)
const { form, summary, summaryBox, errors, validate, applyServerFailure } = usePatientForm(
  blankPatientForm(),
  fields,
)

/** Fiche telle que la personne l'a ouverte (ou relue après un conflit) : base des modifications. */
const baseline = shallowRef<Patient | null>(null)
const saved = ref(false)
const reloading = ref(false)
/** Un conflit de version attend « Recharger la fiche ». */
const needsReload = ref(false)
const nothingToSave = ref(false)
const rebased = ref<{
  version: number
  conflicts: { field: PatientFormField; label: string; current: string }[]
} | null>(null)
/** Saisie au moment de l'ouverture : sert à savoir si quelque chose reste à enregistrer. */
const initial = shallowRef<PatientFormState | null>(null)

watch(
  read.data,
  (patient) => {
    if (patient === null || baseline.value !== null || patient.id !== props.patientId) return
    baseline.value = patient
    initial.value = formFromPatient(patient)
    form.value = formFromPatient(patient)
  },
  { immediate: true },
)

watch(form, () => {
  nothingToSave.value = false
})

const busy = computed(() => state.value === 'saving' || reloading.value)
const dirty = computed(() => {
  if (saved.value || initial.value === null) return false
  const start = initial.value
  return FORM_FIELDS.some((field) => form.value[field] !== start[field])
})
useUnsavedChangesGuard(dirty)

// Un conflit de version a son propre encart (« Recharger la fiche ») ; les autres échecs, le leur.
const failure = computed(() =>
  state.value === 'conflict' ? null : failureView(state.value, 'edit'),
)
const visibleSaveState = computed(() =>
  state.value === 'conflict' && !needsReload.value ? 'idle' : saveState.value,
)
const timeZone = clinicTimeZone()

/** Une relecture a échoué alors que la fiche est déjà affichée : le message et « Réessayer ». */
const readProblem = computed(
  () => baseline.value !== null && read.state.value !== 'ready' && read.state.value !== 'loading',
)

function describe(field: PatientFormField, source: PatientFormState): string {
  const value = source[field]
  if (field === 'sex') return sexLabel(source.sex)
  if (field === 'birthDate')
    return source.birthDate === null ? 'vide' : formatDateFr(source.birthDate)
  return typeof value === 'string' && value.trim() !== '' ? value : 'vide'
}

/** Relit la fiche et rebase la saisie sur la version actuelle (voir `rebaseEdits`). */
async function reloadFromServer(): Promise<void> {
  if (reloading.value) return
  reloading.value = true
  try {
    await read.reload()
    const latest = read.data.value
    const base = baseline.value
    if (read.state.value !== 'ready' || latest === null || base === null) return
    const result = rebaseEdits(base, latest, form.value)
    const latestForm = formFromPatient(latest)
    baseline.value = latest
    initial.value = latestForm
    form.value = result.form
    needsReload.value = false
    rebased.value = {
      version: latest.version,
      conflicts: result.conflicts.map((field) => ({
        field,
        label: FIELD_LABELS[field],
        current: describe(field, latestForm),
      })),
    }
  } finally {
    reloading.value = false
  }
}

async function afterOutcome(result: MutationOutcome): Promise<void> {
  switch (result.kind) {
    case 'synced':
      saved.value = true
      setFlash('Modifications enregistrées.')
      await router.push({ name: 'patient', params: { id: props.patientId } })
      return
    case 'saved-local':
      // Commit local durable (poste préparé, O04) : rien n'est dit « synchronisé ».
      saved.value = true
      return
    case 'conflict':
      needsReload.value = true
      return
    case 'refused':
      applyServerFailure(result.error)
      await summaryBox.value?.focus()
      return
    case 'session-expired':
    case 'reauthentication-required':
      void revalidateSession().catch(() => undefined)
      return
    default:
      return
  }
}

async function save(base: Patient, values: PatientIdentity): Promise<void> {
  const payload = buildUpdatePatientPayload(base, values)
  if (payload === null) {
    nothingToSave.value = true
    return
  }
  rebased.value = null
  await afterOutcome(
    await mutation.submit({
      name: 'UpdatePatient',
      path: { id: base.id },
      payload,
      expectedVersion: base.version,
    }),
  )
}

async function submit(): Promise<void> {
  const base = baseline.value
  if (busy.value || base === null) return
  nothingToSave.value = false
  const values = validate()
  if (values === null) return
  await save(base, values)
}

async function retry(): Promise<void> {
  if (busy.value) return
  await afterOutcome(await mutation.retry())
}
</script>

<template>
  <section aria-labelledby="titre-modifier-patient" class="page-stack max-w-4xl">
    <PageHeader title-id="titre-modifier-patient" title="Modifier le patient" icon="edit" />

    <ReadStateMessage
      v-if="baseline === null"
      :state="read.state.value"
      subject="record"
      :error="read.error.value"
      @retry="read.reload()"
    />

    <template v-else>
      <div class="card border-t-4 border-t-gold p-4 sm:p-6">
        <PatientIdentityHeader :patient="baseline" avatar />
      </div>

      <ReadStateMessage
        v-if="readProblem"
        :state="read.state.value"
        subject="record"
        :error="read.error.value"
        @retry="reloadFromServer"
      />

      <StateMessage v-if="needsReload" state="conflict" title="La fiche a changé entre-temps">
        Quelqu’un a modifié cette fiche pendant votre saisie. Vos saisies sont conservées. Rechargez
        la fiche : vos modifications seront reportées sur la version actuelle et les champs modifiés
        des deux côtés vous seront signalés avant tout nouvel enregistrement.
        <template #action>
          <AppButton
            variant="primary"
            :pending="reloading"
            pending-label="Rechargement…"
            @click="reloadFromServer"
            >Recharger la fiche</AppButton
          >
        </template>
      </StateMessage>

      <StateMessage
        v-else-if="rebased"
        :state="rebased.conflicts.length > 0 ? 'conflict' : 'success'"
        :title="
          rebased.conflicts.length > 0
            ? 'Champs modifiés aussi par une autre personne'
            : 'Fiche rechargée'
        "
      >
        <p>
          La fiche a été relue (version {{ rebased.version }}) : vos modifications sont reportées
          dessus, les autres champs ont repris la valeur actuelle.
        </p>
        <ul v-if="rebased.conflicts.length > 0" class="mt-2 list-disc space-y-1 pl-5">
          <li v-for="conflict in rebased.conflicts" :key="conflict.field">
            {{ conflict.label }} : valeur actuelle « {{ conflict.current }} » ; votre saisie est
            conservée tant que vous ne la changez pas.
          </li>
        </ul>
      </StateMessage>

      <ErrorSummary ref="summaryBox" :errors="summary" />

      <StateMessage v-if="failure" :state="failure.state" :title="failure.title">
        {{ failureMessage }}
        <template v-if="failure.retry" #action>
          <AppButton variant="secondary" :pending="busy" @click="retry"
            >Réessayer l’enregistrement</AppButton
          >
        </template>
      </StateMessage>

      <p v-if="nothingToSave" role="status" class="font-medium text-ink">
        <span aria-hidden="true">○ </span>Aucune modification à enregistrer.
      </p>

      <form class="space-y-6" novalidate @submit.prevent="submit">
        <PatientFormFields ref="fields" v-model="form" :errors="errors" :disabled="busy" />

        <div class="form-actions">
          <AppButton
            type="submit"
            :pending="state === 'saving'"
            pending-label="Enregistrement en cours…"
            :disabled="reloading"
            ><AppIcon name="check" :size="18" />Enregistrer les modifications</AppButton
          >
          <LinkButton :to="{ name: 'patient', params: { id: props.patientId } }"
            >Annuler</LinkButton
          >
          <SaveStatus :state="visibleSaveState" :at="recordedAt" :time-zone="timeZone" />
        </div>
      </form>
    </template>
  </section>
</template>
