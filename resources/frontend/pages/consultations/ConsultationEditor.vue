<script setup lang="ts">
/**
 * Consultation par étapes (C01 à C04 ; fichier 02, « Consultation et antécédents », « Examens et réfraction »,
 * « Médicaments et orientation » ; fichier 04, « Consultation guidée » ; AT18, AT19). EN LIGNE : motif et
 * lunettes, antécédents, acuité visuelle, réfraction, centrage, médicaments, conclusion et orientation, puis
 * « Terminer l'examen » (révision 1 figée) et « Corriger » (nouvelle révision motivée).
 *
 * - En-tête patient fixe sur écran large (identité, dossier, date et heure, professionnel), lu dans la
 *   consultation elle-même.
 * - Liste des étapes en pastilles numérotées (colonne latérale sur grand écran) : étape courante,
 *   rubrique déjà renseignée sur le serveur (coche, décrite aux lecteurs d'écran), saisie non
 *   enregistrée (« non enregistrée », en toutes lettres).
 * - Précédent / Enregistrer / Suivant : « Suivant » valide et enregistre l'étape avant d'avancer. Une
 *   étape n'est dite enregistrée qu'après la réponse du serveur (« Enregistré sur le serveur à
 *   10h42 ») ; rien n'est dit « enregistré sur ce poste ». Sur téléphone, la barre de ces boutons
 *   reste visible en bas de l'écran, au-dessus des raccourcis, tant que l'étape est à l'écran.
 * - Conflit de version (409) : saisie conservée, « Recharger la consultation » la rebase sur la
 *   version actuelle et signale les valeurs modifiées des deux côtés.
 * - Terminer l'examen : confirmation, récapitulatif des rubriques non renseignées (jamais transformées en
 *   « Aucun »), justification d'absence si le motif/les plaintes ou la conclusion manquent.
 * - Écart pupillaire du ticket de l'autoréfracteur : saisi dans le bloc de l'autoréfracteur (étape « Réfraction »),
 *   c'est l'écart total de l'étape « Centrage » ; « Enregistrer » ou « Suivant » sur la réfraction l'enregistre
 *   avec elle (deux commandes l'une après l'autre), sans repasser par le centrage.
 * - Examen terminé : lecture seule, avec l'historique des révisions, la correction motivée (`clinical.amend`) et
 *   « Transmettre à la caisse » (la facture de l'examen, patient et visite déjà renseignés) pour qui peut facturer ;
 *   les autres comptes lisent où la caisse crée la facture. Pendant l'examen, un bloc mène à la « Prescription
 *   optique » (écran à part, utilisable dès l'examen en cours).
 * - Examen resté BROUILLON (aucune rubrique enregistrée) : « Supprimer le brouillon » en tête de page, pour le
 *   professionnel qui l'a démarré ou la gérante ; confirmation, puis retour à la liste. Un examen en cours ou terminé ne
 *   l'offre jamais (terminé : « Corriger l'examen »). `?corriger=1` (bouton « Modifier » de la liste) ouvre un examen
 *   terminé directement en correction.
 * - Sans le droit d'écriture (clinical.write) : lecture seule, aucun bouton d'enregistrement.
 * - Hors ligne : « Consultation indisponible », jamais une consultation vide.
 * Une instance par consultation (l'écran la recrée quand l'adresse change).
 */
import { computed, nextTick, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { clinicTimeZone, formatInstantFr } from '@/app/clinicTime'
import { canOnScreen, knownAccountId, moduleOpenOnScreen } from '@/app/session'
import { useUnsavedChangesGuard } from '@/app/unsavedChanges'
import WorkStatusChip from '@/components/clinical/WorkStatusChip.vue'
import ConfirmDialog from '@/components/feedback/ConfirmDialog.vue'
import ErrorSummary from '@/components/feedback/ErrorSummary.vue'
import SaveStatus from '@/components/feedback/SaveStatus.vue'
import StateMessage from '@/components/feedback/StateMessage.vue'
import TextAreaField from '@/components/form/TextAreaField.vue'
import PageHeader from '@/components/layout/PageHeader.vue'
import SectionCard from '@/components/layout/SectionCard.vue'
import StatusChip from '@/components/layout/StatusChip.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import LinkButton from '@/components/ui/LinkButton.vue'
import { missingDataText } from '@/domain/clinical/completion'
import { CONTROL_IDS } from '@/domain/clinical/controls'
import { canDeleteDraftExam } from '@/domain/clinical/draftDeletion'
import {
  DELIVERED_STEPS,
  type DeliveredStep,
  REFERRAL_BADGE,
  STEP_TITLES,
  urgencyLabel,
} from '@/domain/clinical/labels'
import { patientDisplayName } from '@/domain/patients/identity'

import AnamnesisStep from './AnamnesisStep.vue'
import CenteringStep from './CenteringStep.vue'
import ConclusionStep from './ConclusionStep.vue'
import ConsultationDocuments from './ConsultationDocuments.vue'
import ConsultationReadMessage from './ConsultationReadMessage.vue'
import DeleteConsultationDialog from './DeleteConsultationDialog.vue'
import { setFlash } from './flash'
import HistoriesStep from './HistoriesStep.vue'
import MedicationsStep from './MedicationsStep.vue'
import PatientBanner from './PatientBanner.vue'
import RefractionStep from './RefractionStep.vue'
import { AMEND_REASON_ID, FINISH_REASON_ID, useConsultationEditor } from './useConsultationEditor'
import VisualAcuityStep from './VisualAcuityStep.vue'

const props = defineProps<{ consultationId: string }>()

const editor = useConsultationEditor(props.consultationId)
const {
  read,
  mutation,
  baseline,
  drafts,
  current,
  errorMap,
  summary,
  summaryBox,
  notice,
  announcement,
  needsReload,
  reloading,
  rebased,
  pending,
  operation,
  operationTitle,
  completed,
  canAmend,
  readOnly,
  busy,
  scales,
  scalesReady,
  dirtySteps,
  currentDirty,
  anyDirty,
  stepIndex,
  isFirst,
  isLast,
  failure,
  saveStatus,
  statusLabel,
  completionRecap,
  finishBlocked,
  canFinish,
  finishOpen,
  finishReason,
  finishError,
  amending,
  amendReason,
  amendReasonError,
} = editor
const { failureMessage, recordedAt, state } = mutation

const heading = ref<HTMLElement | null>(null)
const timeZone = clinicTimeZone()
const confirmingCancel = ref(false)

const route = useRoute()
const router = useRouter()

// Après la suppression du brouillon, ce qui était saisi et non enregistré n'a plus d'objet : on quitte sans demander.
const leaving = ref(false)
useUnsavedChangesGuard(() => anyDirty.value && !leaving.value)

/**
 * « Supprimer le brouillon » : seulement un examen resté brouillon, pour le professionnel qui l'a démarré ou la gérante
 * (`domain/clinical/draftDeletion`) ; le serveur applique la règle et refuse tout autre cas. Après la suppression,
 * l'examen n'existe plus : retour à la liste des examens, avec le message du résultat.
 */
const deleteOpen = ref(false)
const canDelete = computed(
  () =>
    baseline.value !== null &&
    canDeleteDraftExam(
      { status: baseline.value.status, clinicianId: baseline.value.clinician_id },
      { accountId: knownAccountId(), can: canOnScreen },
    ),
)
const patientLabel = computed(() =>
  baseline.value === null
    ? ''
    : patientDisplayName(baseline.value.patient.last_name, baseline.value.patient.first_names),
)

async function onDeleted(message: string): Promise<void> {
  leaving.value = true
  deleteOpen.value = false
  setFlash(message)
  await router.push({ name: 'consultations' })
}

/** Suppression refusée (l'examen a changé, n'est plus un brouillon, droits) : le message du serveur, puis relecture. */
const deleteProblem = ref<string | null>(null)

function onNotDeleted(message: string): void {
  deleteOpen.value = false
  deleteProblem.value = message
  void editor.reloadFromServer()
}

// Depuis « Modifier » de la liste, un examen terminé s'ouvre directement en correction (nouvelle révision motivée).
let correctionRequested = route.query['corriger'] === '1'
watch(
  baseline,
  (value) => {
    if (!correctionRequested || value === null) return
    correctionRequested = false
    if (value.status === 'COMPLETED' && canAmend.value) editor.startAmend()
  },
  { immediate: true },
)

// Le titre de l'étape reçoit le focus à chaque changement d'étape (annoncé aux lecteurs d'écran).
watch(current, async () => {
  await nextTick()
  heading.value?.focus()
})

/** Une relecture a échoué alors que la consultation est déjà affichée : le message et « Réessayer ». */
const readProblem = computed(
  () => baseline.value !== null && read.state.value !== 'ready' && read.state.value !== 'loading',
)

const referral = computed(() => {
  const conclusion = baseline.value?.steps.CONCLUSION
  if (conclusion === undefined || conclusion.referral !== true) return null
  return conclusion.referral_urgency === null ? null : urgencyLabel(conclusion.referral_urgency)
})
const referred = computed(() => baseline.value?.steps.CONCLUSION.referral === true)

/**
 * « Transmettre à la caisse » (B02) depuis l'examen terminé : la facture de l'examen s'ouvre avec le patient et la
 * visite déjà renseignés (identifiants opaques, rien n'est ressaisi). Droit invoice.create ou exam_fee.collect,
 * module « sales » ouvert. Un compte sans ce droit (le professionnel) voit à la place où la caisse crée la facture :
 * la file du jour. Aucun reçu n'est établi ici : il naît de l'encaissement d'une facture.
 */
const salesOpen = computed(() => moduleOpenOnScreen('sales'))
const canInvoice = computed(
  () => (canOnScreen('invoice.create') || canOnScreen('exam_fee.collect')) && salesOpen.value,
)
const invoiceLink = computed(() =>
  baseline.value === null
    ? null
    : {
        name: 'facture-nouvelle',
        query: { patient: baseline.value.patient_id, visite: baseline.value.visit_id },
      },
)

const saving = computed(() => state.value === 'saving')
const savingStep = computed(
  () => saving.value && operation.value === null && pending.value !== null,
)
const readOnlyNotCompleted = computed(() => readOnly.value && !completed.value)
const finishDisabled = computed(() => busy.value || finishBlocked.value !== null)

/** Le résumé d'erreurs est focalisé par l'éditeur (clic « Enregistrer » ou « Suivant » refusé). */
function bindSummary(element: unknown): void {
  summaryBox.value = element as { focus: () => Promise<void> } | null
}

async function save(): Promise<void> {
  await editor.save()
  await nextTick()
  // Le bouton était désactivé pendant l'envoi : le focus lui est rendu (jamais perdu dans la page).
  if (document.activeElement === document.body) {
    document.getElementById('consultation-enregistrer')?.focus()
  }
}

async function onSubmit(): Promise<void> {
  if (amending.value) {
    await editor.submitAmend()
    return
  }
  await save()
}

function cancelAmend(): void {
  if (anyDirty.value) {
    confirmingCancel.value = true
    return
  }
  editor.cancelAmend()
}

function confirmCancelAmend(): void {
  confirmingCancel.value = false
  editor.cancelAmend()
}

const completedAt = computed(() => {
  const at = baseline.value?.completed_at
  return at === null || at === undefined ? null : formatInstantFr(at)
})
const revisionCount = computed(() => baseline.value?.revisions.length ?? 0)

/** Icône décorative de chaque rubrique (en-tête de l'étape affichée). */
const STEP_ICONS: Readonly<Record<DeliveredStep, string>> = {
  ANAMNESIS: 'clipboard',
  HISTORIES: 'history',
  VISUAL_ACUITY: 'eye',
  REFRACTION: 'glasses',
  CENTERING: 'map-pin',
  MEDICATIONS: 'file-plus',
  CONCLUSION: 'stethoscope',
}

/** Rubrique déjà renseignée dans la version lue sur le serveur (pas dans la saisie en cours). */
function stepFilled(step: DeliveredStep): boolean {
  const recap = completionRecap.value
  return recap !== null && !recap.emptySteps.includes(step)
}

/** Pastille du numéro d'étape : étape courante, rubrique renseignée, ou à faire. */
function stepBadge(step: DeliveredStep): string {
  if (step === current.value) return 'bg-primary text-primary-contrast'
  if (stepFilled(step)) return 'bg-accent-soft text-accent'
  return 'bg-gold-soft text-gold-ink'
}
</script>

<template>
  <section aria-labelledby="titre-consultation" class="page-stack max-w-6xl">
    <PageHeader
      title-id="titre-consultation"
      title="Consultation"
      icon="consultations"
      :back="{ to: { name: 'consultations' }, label: 'Retour aux consultations' }"
    >
      <!-- Un examen resté brouillon se supprime ; un examen en cours ou terminé jamais (terminé : « Corriger l'examen »). -->
      <template v-if="canDelete" #actions>
        <AppButton
          variant="danger"
          :disabled="busy"
          :accessible-name="`Supprimer le brouillon de ${patientLabel}`"
          @click="deleteOpen = true"
          ><AppIcon name="trash" :size="18" />Supprimer le brouillon</AppButton
        >
      </template>
    </PageHeader>

    <DeleteConsultationDialog
      v-if="deleteOpen && baseline !== null"
      :consultation-id="props.consultationId"
      :version="baseline.version"
      :patient-name="patientLabel"
      @deleted="onDeleted"
      @stale="onNotDeleted"
      @close="deleteOpen = false"
    />

    <StateMessage v-if="deleteProblem" state="conflict" title="Examen non supprimé">
      {{ deleteProblem }}
    </StateMessage>

    <ConsultationReadMessage
      v-if="baseline === null"
      :state="read.state.value"
      subject="consultation"
      :error="read.error.value"
      @retry="read.reload()"
    />

    <template v-else>
      <PatientBanner :consultation="baseline">
        <p class="flex flex-wrap items-center gap-2 sm:justify-end">
          <WorkStatusChip :status="baseline.status" :label="statusLabel"
            ><span class="sr-only">État du travail : </span></WorkStatusChip
          >
          <StatusChip v-if="referred" tone="warning" icon="alert"
            >{{ REFERRAL_BADGE
            }}<template v-if="referral"
              ><span aria-hidden="true"> · </span><span class="sr-only">, niveau : </span
              >{{ referral }}</template
            ></StatusChip
          >
        </p>
      </PatientBanner>

      <ConsultationReadMessage
        v-if="readProblem"
        :state="read.state.value"
        subject="consultation"
        :error="read.error.value"
        @retry="editor.reloadFromServer"
      />

      <StateMessage v-if="readOnlyNotCompleted" state="empty" title="Lecture seule">
        Ce compte peut consulter l’examen mais pas le modifier.
      </StateMessage>
      <StateMessage v-else-if="completed && !amending" state="success" title="Examen terminé">
        <p>
          Terminé<template v-if="completedAt"> le {{ completedAt }}</template> ; révision
          {{ baseline.current_revision }} sur {{ revisionCount }} enregistrée(s). Les rubriques sont
          en lecture seule : une correction crée une nouvelle révision motivée, les précédentes
          restent lisibles.
        </p>
        <p v-if="baseline.finalization_missing_data_reason" class="mt-2">
          Justification d’absence enregistrée : {{ baseline.finalization_missing_data_reason }}
        </p>
        <p v-if="salesOpen && !canInvoice" class="mt-2">
          Le patient peut passer à la caisse : la facture se crée depuis « Aujourd’hui », avec «
          Créer une facture ».
        </p>
        <template #action>
          <div class="flex flex-wrap gap-3">
            <LinkButton
              :to="{ name: 'consultation-historique', params: { id: props.consultationId } }"
              variant="secondary"
              >Révisions et comparaison</LinkButton
            >
            <LinkButton
              :to="{ name: 'consultation-prescriptions', params: { id: props.consultationId } }"
              variant="secondary"
              >Prescription optique</LinkButton
            >
            <LinkButton
              v-if="canInvoice && invoiceLink"
              :to="invoiceLink"
              variant="secondary"
              :accessible-name="`Transmettre à la caisse : créer la facture de ${baseline.patient.last_name}`"
              >Transmettre à la caisse</LinkButton
            >
            <AppButton v-if="canAmend" variant="primary" :disabled="busy" @click="editor.startAmend"
              >Corriger l’examen</AppButton
            >
          </div>
        </template>
      </StateMessage>
      <StateMessage v-else-if="amending" state="conflict" title="Correction en cours">
        Vous corrigez un examen terminé : vos modifications seront enregistrées ensemble comme la
        révision {{ baseline.current_revision + 1 }}, avec le motif ci-dessous. Les révisions
        précédentes ne changent pas.
      </StateMessage>

      <!-- Documents imprimables : examen terminé seulement, depuis la révision figée (jamais en correction). -->
      <ConsultationDocuments
        v-if="completed && !amending && !needsReload"
        :consultation="baseline"
        :scales="scales"
      />

      <div class="space-y-6">
        <StateMessage
          v-if="needsReload"
          state="conflict"
          title="La consultation a changé entre-temps"
        >
          Quelqu’un a modifié cette consultation pendant votre saisie. Vos saisies sont conservées.
          Rechargez la consultation : vos modifications seront reportées sur la version actuelle et
          les valeurs modifiées des deux côtés vous seront signalées avant tout nouvel
          enregistrement.
          <template #action>
            <AppButton
              variant="primary"
              :pending="reloading"
              pending-label="Rechargement…"
              @click="editor.reloadFromServer"
              >Recharger la consultation</AppButton
            >
          </template>
        </StateMessage>

        <StateMessage
          v-else-if="rebased"
          :state="rebased.conflicts.length > 0 ? 'conflict' : 'success'"
          :title="
            rebased.conflicts.length > 0
              ? 'Valeurs modifiées aussi par une autre personne'
              : 'Consultation rechargée'
          "
        >
          <p>
            La consultation a été relue (version {{ rebased.version }}) : vos modifications sont
            reportées dessus, les autres valeurs ont repris ce qui est enregistré.
          </p>
          <ul v-if="rebased.conflicts.length > 0" class="mt-2 list-disc space-y-1 pl-5">
            <li v-for="conflict in rebased.conflicts" :key="`${conflict.step}-${conflict.key}`">
              {{ STEP_TITLES[conflict.step] }} · {{ conflict.label }} : valeur actuelle «
              {{ conflict.current }} » ; votre saisie est conservée tant que vous ne la changez pas.
            </li>
          </ul>
        </StateMessage>

        <ErrorSummary :ref="bindSummary" :errors="summary" />

        <StateMessage v-if="failure" :state="failure.state" :title="failure.title">
          <template v-if="operationTitle">{{ operationTitle }} : </template>{{ failureMessage }}
          <template v-if="failure.retry" #action>
            <AppButton variant="secondary" :pending="busy" @click="editor.retry"
              >Réessayer l’enregistrement</AppButton
            >
          </template>
        </StateMessage>

        <div class="grid gap-6 xl:grid-cols-[15rem_minmax(0,1fr)] xl:items-start">
          <nav aria-label="Étapes de la consultation">
            <ol class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-1">
              <li v-for="(step, index) in DELIVERED_STEPS" :key="step" class="min-w-0">
                <button
                  type="button"
                  :aria-current="step === current ? 'step' : undefined"
                  :aria-describedby="stepFilled(step) ? 'etapes-rubrique-renseignee' : undefined"
                  :disabled="busy"
                  :class="[
                    'flex min-h-11 w-full items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left text-base font-medium',
                    'disabled:cursor-not-allowed disabled:bg-disabled disabled:text-disabled-ink',
                    step === current
                      ? 'border-primary bg-primary-soft text-primary shadow-[inset_0_-3px_0_var(--color-gold)]'
                      : 'border-line bg-surface text-ink shadow-card hover:border-gold hover:bg-primary-soft',
                  ]"
                  @click="editor.goTo(step)"
                >
                  <span
                    :class="[
                      'flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold tabular-nums',
                      stepBadge(step),
                    ]"
                    >{{ index + 1 }}<span class="sr-only">.</span></span
                  >
                  <span class="flex min-w-0 flex-1 flex-col">
                    <span class="break-words">{{ STEP_TITLES[step] }}</span>
                    <span v-if="dirtySteps.includes(step)" class="text-sm font-normal text-warning"
                      ><span aria-hidden="true">● </span>non enregistrée</span
                    >
                  </span>
                  <AppIcon
                    v-if="stepFilled(step)"
                    name="check-circle"
                    :size="18"
                    class="text-accent"
                  />
                </button>
              </li>
            </ol>
            <!-- Description des étapes cochées, lue avec le bouton, jamais affichée. -->
            <p id="etapes-rubrique-renseignee" hidden>Rubrique déjà renseignée</p>
          </nav>

          <div class="min-w-0 space-y-6">
            <p role="status" aria-live="polite" class="sr-only">{{ announcement }}</p>

            <form
              class="card space-y-6 p-4 lg:p-6 max-md:[&_:is(input,select,textarea)]:scroll-mb-48"
              novalidate
              @submit.prevent="onSubmit"
            >
              <div class="flex items-start gap-3 border-b border-line pb-4">
                <div
                  aria-hidden="true"
                  class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gold-soft text-gold-ink"
                >
                  <AppIcon :name="STEP_ICONS[current]" :size="20" />
                </div>
                <h2
                  :id="CONTROL_IDS.step"
                  ref="heading"
                  tabindex="-1"
                  class="min-w-0 focus:outline-none"
                >
                  <span class="block text-sm font-semibold text-gold-ink"
                    >Étape {{ stepIndex + 1 }} sur {{ DELIVERED_STEPS.length
                    }}<span class="sr-only"> : </span></span
                  ><span class="block text-xl font-semibold break-words">{{
                    STEP_TITLES[current]
                  }}</span>
                </h2>
              </div>

              <AnamnesisStep
                v-if="current === 'ANAMNESIS'"
                v-model="drafts.ANAMNESIS"
                :errors="errorMap"
                :disabled="readOnly || busy"
              />
              <HistoriesStep
                v-else-if="current === 'HISTORIES'"
                v-model="drafts.HISTORIES"
                :errors="errorMap"
                :disabled="readOnly || busy"
              />
              <VisualAcuityStep
                v-else-if="current === 'VISUAL_ACUITY'"
                v-model="drafts.VISUAL_ACUITY"
                :errors="errorMap"
                :disabled="readOnly || busy"
                :scales="scales"
                :scales-ready="scalesReady"
              />
              <RefractionStep
                v-else-if="current === 'REFRACTION'"
                v-model="drafts.REFRACTION"
                :pd="drafts.CENTERING.pdTotal"
                :errors="errorMap"
                :disabled="readOnly || busy"
                @update:pd="drafts.CENTERING = { ...drafts.CENTERING, pdTotal: $event }"
              />
              <CenteringStep
                v-else-if="current === 'CENTERING'"
                v-model="drafts.CENTERING"
                :errors="errorMap"
                :disabled="readOnly || busy"
              />
              <MedicationsStep
                v-else-if="current === 'MEDICATIONS'"
                v-model="drafts.MEDICATIONS"
                :errors="errorMap"
                :disabled="readOnly || busy"
              />
              <ConclusionStep
                v-else
                v-model="drafts.CONCLUSION"
                :errors="errorMap"
                :disabled="readOnly || busy"
              />

              <p v-if="notice" role="status" class="font-medium text-ink">
                <span aria-hidden="true">○ </span>{{ notice }}
              </p>

              <section
                v-if="amending"
                aria-labelledby="titre-motif-correction"
                class="space-y-3 rounded-xl border border-warning bg-warning-soft p-4"
              >
                <h3
                  id="titre-motif-correction"
                  class="flex items-center gap-2 text-lg font-semibold"
                >
                  <AppIcon name="edit" :size="18" class="text-warning" />Motif de la correction
                </h3>
                <TextAreaField
                  v-model="amendReason"
                  label="Pourquoi corrigez-vous cet examen ?"
                  hint="Obligatoire. Conservé avec la révision, lisible par les profils cliniques ; jamais recopié dans le journal d’audit."
                  :control-id="AMEND_REASON_ID"
                  :rows="3"
                  :maxlength="1000"
                  :error="amendReasonError"
                  :disabled="busy"
                  required
                />
              </section>

              <p v-if="!readOnly && !amending" class="max-w-prose text-sm text-muted">
                « Suivant » enregistre l’étape sur le serveur avant de passer à la suivante.
              </p>

              <!-- Actions : collées en bas de l'écran sur téléphone, au-dessus des raccourcis. -->
              <div
                class="border-t border-line bg-surface pt-4 max-md:sticky max-md:bottom-[4.25rem] max-md:z-20 max-md:-mx-4 max-md:-mb-4 max-md:rounded-b-xl max-md:px-4 max-md:pt-3 max-md:pb-3 max-md:shadow-raised"
              >
                <p v-if="currentDirty" class="mb-3 text-sm font-medium text-warning">
                  <span aria-hidden="true">● </span>Modifications non enregistrées sur cette étape.
                </p>
                <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <div class="flex flex-1 flex-wrap gap-2 *:grow sm:flex-none sm:gap-3 sm:*:grow-0">
                    <AppButton
                      variant="secondary"
                      :disabled="busy || isFirst"
                      @click="editor.previous"
                      ><AppIcon name="chevron-left" :size="18" />Précédent</AppButton
                    >
                    <template v-if="amending">
                      <AppButton
                        id="consultation-enregistrer"
                        type="submit"
                        variant="primary"
                        :pending="saving && operation === 'amend'"
                        pending-label="Enregistrement de la correction…"
                        :disabled="busy || needsReload"
                        >Enregistrer la correction</AppButton
                      >
                      <AppButton
                        v-if="!isLast"
                        variant="secondary"
                        :disabled="busy"
                        @click="editor.advance"
                        >Suivant<AppIcon name="chevron-right" :size="18"
                      /></AppButton>
                      <AppButton variant="ghost" :disabled="busy" @click="cancelAmend"
                        >Abandonner la correction</AppButton
                      >
                    </template>
                    <template v-else-if="!readOnly">
                      <AppButton
                        id="consultation-enregistrer"
                        type="submit"
                        :variant="isLast ? 'primary' : 'secondary'"
                        :pending="savingStep && pending !== null && !pending.advance"
                        pending-label="Enregistrement en cours…"
                        :disabled="busy || needsReload"
                        >Enregistrer</AppButton
                      >
                      <AppButton
                        v-if="!isLast"
                        variant="primary"
                        :pending="savingStep && pending !== null && pending.advance"
                        pending-label="Enregistrement en cours…"
                        :disabled="busy || needsReload"
                        @click="editor.saveAndAdvance"
                        >Suivant<AppIcon name="chevron-right" :size="18"
                      /></AppButton>
                    </template>
                    <AppButton v-else-if="!isLast" variant="primary" @click="editor.advance"
                      >Suivant<AppIcon name="chevron-right" :size="18"
                    /></AppButton>
                  </div>
                  <SaveStatus :state="saveStatus" :at="recordedAt" :time-zone="timeZone" />
                </div>
              </div>
            </form>

            <!-- La prescription de lunettes est un écran à part (brouillon, puis version validée) : accessible dès l'examen en cours. -->
            <SectionCard
              v-if="!completed && !amending"
              title="Prescription optique"
              title-id="titre-prescription"
              icon="glasses"
            >
              <p class="max-w-prose text-base text-ink">
                Une fois la réfraction enregistrée, établissez la prescription de lunettes : verres
                de chaque œil, type de verre et traitements, puis version validée. Elle ne copie
                jamais la réfraction d’elle-même. Enregistrez d’abord les étapes modifiées.
              </p>
              <div class="mt-4">
                <LinkButton
                  :to="{ name: 'consultation-prescriptions', params: { id: props.consultationId } }"
                  variant="secondary"
                  >Prescription optique</LinkButton
                >
              </div>
            </SectionCard>

            <SectionCard
              v-if="canFinish"
              title="Terminer l’examen"
              title-id="titre-terminer"
              icon="check-circle"
            >
              <p class="max-w-prose text-base text-ink">
                Terminer fige la première révision de l’examen : les rubriques deviennent lisibles
                mais ne se modifient plus que par une correction motivée. Les rubriques non
                renseignées restent « non renseignées ».
              </p>
              <p v-if="finishBlocked" class="mt-3 text-sm font-medium text-warning">
                <span aria-hidden="true">● </span>{{ finishBlocked }}
              </p>
              <div class="mt-4">
                <AppButton variant="primary" :disabled="finishDisabled" @click="editor.openFinish"
                  >Terminer l’examen</AppButton
                >
              </div>
            </SectionCard>
          </div>
        </div>

        <!-- Monté seulement quand la finalisation est possible : aucun bouton « Terminer » caché ailleurs. -->
        <ConfirmDialog
          v-if="canFinish || finishOpen"
          :open="finishOpen"
          title="Terminer l’examen ?"
          confirm-label="Terminer l’examen"
          :pending="busy && operation === 'complete'"
          pending-label="Finalisation en cours…"
          initial-focus="#terminer-justification"
          @confirm="editor.confirmFinish"
          @cancel="editor.closeFinish"
        >
          <div v-if="completionRecap" class="space-y-3">
            <p>
              La première révision sera figée. Une correction ultérieure demandera un motif et
              créera une nouvelle révision.
            </p>
            <div>
              <p class="font-semibold">Rubriques non renseignées</p>
              <ul v-if="completionRecap.emptySteps.length > 0" class="list-disc pl-5">
                <li v-for="step in completionRecap.emptySteps" :key="step">
                  {{ STEP_TITLES[step] }} : non renseigné
                </li>
              </ul>
              <p v-else>Aucune : toutes les rubriques portent une réponse.</p>
              <p class="mt-1 text-sm text-muted">
                Une rubrique non renseignée n’est pas « aucun » : elle est figée telle quelle. Les
                mesures non réalisées ne sont pas exigées.
              </p>
            </div>
            <p v-if="completionRecap.reasonRequired" class="font-medium text-warning">
              <span aria-hidden="true">⚠ </span>Il manque {{ missingDataText(completionRecap) }} :
              justifiez leur absence ci-dessous.
            </p>
            <TextAreaField
              v-model="finishReason"
              :label="
                completionRecap.reasonRequired
                  ? 'Justification d’absence'
                  : 'Justification d’absence (facultative)'
              "
              :control-id="FINISH_REASON_ID"
              :rows="3"
              :maxlength="4000"
              :error="finishError"
              :disabled="busy"
              :required="completionRecap.reasonRequired"
            />
          </div>
        </ConfirmDialog>

        <ConfirmDialog
          v-if="amending"
          :open="confirmingCancel"
          title="Abandonner la correction ?"
          confirm-label="Abandonner la correction"
          tone="danger"
          @confirm="confirmCancelAmend"
          @cancel="confirmingCancel = false"
        >
          Les modifications non envoyées seront perdues. L’examen terminé reste inchangé.
        </ConfirmDialog>
      </div>
    </template>
  </section>
</template>
