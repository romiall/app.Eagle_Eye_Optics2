<script setup lang="ts">
/**
 * Fiche d'un patient (P01, P02 ; fichier 02 : identité commune à la clinique et à la vente ;
 * fichier 04 : en-tête d'identité). Identité administrative seulement : aucune donnée clinique
 * (consultations, ordonnances, prix d'achat) n'est lue ni affichée ici. La fraîcheur dit à quelle
 * heure le serveur a répondu ; sans réponse, la fiche est « indisponible », jamais une ancienne copie
 * présentée comme actuelle. « Modifier » n'apparaît qu'avec le droit patient.update ; « Enregistrer
 * une arrivée » (P03) qu'avec visit.register, module « today » ouvert, sur une fiche ni archivée ni
 * fusionnée. L'onglet « Activité » est une autre adresse (`PatientActivityPage`) : cette fiche ne lit
 * jamais l'activité (chargement du seul onglet nécessaire, fichier 04).
 *
 * Présentation : bandeau d'identité (`PatientRecordHeader`) avec les actions du quotidien, onglets,
 * puis les cartes Identité, Contact et Dossier (deux colonnes sur ordinateur) ; l'export et la fusion,
 * outils de gestion du dossier, sont au pied de la carte Dossier.
 */
import { computed, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'

import { clinicTimeZone, clinicToday, formatInstantFr } from '@/app/clinicTime'
import { getPatient } from '@/app/services/patients'
import { can, enabledModules, session } from '@/app/session'
import FreshnessNote from '@/components/feedback/FreshnessNote.vue'
import StateMessage from '@/components/feedback/StateMessage.vue'
import { formatDateFr } from '@/components/form/format'
import PageHeader from '@/components/layout/PageHeader.vue'
import SectionCard from '@/components/layout/SectionCard.vue'
import PatientRecordHeader from '@/components/patients/PatientRecordHeader.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import LinkButton from '@/components/ui/LinkButton.vue'
import type { Patient } from '@/domain/contracts/generated'
import { formatAge, patientAge, sexLabel } from '@/domain/patients/identity'

import ExportRecordButton from './ExportRecordButton.vue'
import { takeFlash } from './flash'
import PatientRecordTabs from './PatientRecordTabs.vue'
import ReadStateMessage from './ReadStateMessage.vue'
import { usePatientRead } from './usePatientRead'

const BACK = { to: '/patients', label: 'Retour aux patients' }

const route = useRoute()
const id = computed(() => String(route.params['id']))
const flash = takeFlash()

const read = usePatientRead<Patient>(() => getPatient(id.value))

/**
 * Session locale (profil du coffre, serveur non joint) : seules les actions qui s'enregistrent sur le poste
 * restent offertes (modifier la fiche, créer une facture). Arrivée, fusion et export demandent le serveur : aucun
 * lien vers un écran fermé.
 */
const localSession = computed(() => session.status === 'local')

// Le même écran sert une autre fiche quand l'adresse change : relire, sans garder la précédente.
watch(id, () => void read.reload())

/** Fiche lue pour CET identifiant : une lecture précédente ne s'affiche jamais à sa place. */
const patient = computed(() => (read.data.value?.id === id.value ? read.data.value : null))
const canEdit = computed(
  () =>
    can('patient.update') &&
    patient.value !== null &&
    !patient.value.archived &&
    patient.value.merged_into_patient_id === null,
)
/**
 * « Enregistrer une arrivée » (P03) : avec le droit visit.register, quand le module « today » est
 * ouvert, et seulement pour une fiche vivante (ni archivée ni fusionnée : le serveur la refuserait).
 */
const canRegisterArrival = computed(
  () =>
    !localSession.value &&
    can('visit.register') &&
    enabledModules.value.includes('today') &&
    patient.value !== null &&
    !patient.value.archived &&
    patient.value.merged_into_patient_id === null,
)

/**
 * « Fusionner avec une autre fiche » (L1D08) : gérante (patient.merge), fiche vivante. Ouvre l'aperçu, rien
 * n'est fusionné sans comparaison, motif et mot de passe.
 */
const canMerge = computed(
  () =>
    !localSession.value &&
    can('patient.merge') &&
    patient.value !== null &&
    !patient.value.archived &&
    patient.value.merged_into_patient_id === null,
)

/** Fiches fusionnées dans celle-ci : leurs pièces gardent l'ancien numéro de dossier imprimé. */
const mergedRecords = computed(() => patient.value?.merged_records ?? [])

/** « Exporter le dossier » (X02) : droit clinical.export, module « settings » ouvert (page des exports). */
const canExportRecord = computed(
  () =>
    !localSession.value &&
    can('clinical.export') &&
    enabledModules.value.includes('settings') &&
    patient.value !== null,
)

/**
 * « Créer une facture » (B02) : avec invoice.create ou exam_fee.collect, module « sales » ouvert, pour
 * une fiche vivante. Le patient est présélectionné par son identifiant opaque : rien n'est ressaisi.
 */
const canInvoice = computed(
  () =>
    (can('invoice.create') || can('exam_fee.collect')) &&
    enabledModules.value.includes('sales') &&
    patient.value !== null &&
    !patient.value.archived &&
    patient.value.merged_into_patient_id === null,
)

const age = computed(() =>
  patient.value === null ? '' : formatAge(patientAge(patient.value.birth_date, clinicToday())),
)
const timeZone = clinicTimeZone()
const NOT_GIVEN = 'Non renseigné'

/** Valeur à afficher : un champ vide ou blanc est « Non renseigné », jamais une case vide. */
function shown(value: string | null): string {
  return value === null || value.trim() === '' ? NOT_GIVEN : value
}

/** Valeur absente accompagnée, quand elle existe, de la raison enregistrée de son absence. */
function absence(value: string | null, reason: string | null): string {
  if (value !== null && value.trim() !== '') return value
  return reason === null || reason.trim() === '' ? NOT_GIVEN : `${NOT_GIVEN} (raison : ${reason})`
}

/** Valeur mise en valeur dans une liste de détails (numéro de dossier, téléphone principal). */
const STRONG = 'font-semibold tabular-nums'
</script>

<template>
  <section aria-labelledby="titre-fiche" class="page-stack max-w-5xl">
    <StateMessage v-if="flash" state="success" :title="flash" />

    <template v-if="patient">
      <PatientRecordHeader :patient="patient" title-id="titre-fiche" :back="BACK">
        <template v-if="canRegisterArrival || canInvoice || canEdit" #actions>
          <LinkButton
            v-if="canRegisterArrival"
            :to="{ name: 'arrivee', query: { patient: patient.id } }"
            variant="secondary"
            ><AppIcon name="arrival" :size="18" />Enregistrer une arrivée</LinkButton
          >
          <LinkButton
            v-if="canInvoice"
            :to="{ name: 'facture-nouvelle', query: { patient: patient.id } }"
            variant="secondary"
            ><AppIcon name="file-plus" :size="18" />Créer une facture</LinkButton
          >
          <LinkButton
            v-if="canEdit"
            :to="{ name: 'patient-modifier', params: { id: patient.id } }"
            variant="primary"
            ><AppIcon name="edit" :size="18" />Modifier</LinkButton
          >
        </template>
      </PatientRecordHeader>

      <div class="space-y-6">
        <PatientRecordTabs :patient-id="patient.id" current="identite" />

        <ReadStateMessage
          v-if="read.state.value !== 'ready' && read.state.value !== 'loading'"
          :state="read.state.value"
          subject="record"
          :error="read.error.value"
          @retry="read.reload()"
        />

        <StateMessage
          v-if="patient.merged_into_patient_id !== null"
          state="offline"
          title="Cette fiche a été fusionnée dans une autre"
        >
          <RouterLink
            :to="{ name: 'patient', params: { id: patient.merged_into_patient_id } }"
            class="text-link inline-flex min-h-11 items-center font-semibold"
            >Ouvrir la fiche conservée</RouterLink
          >
        </StateMessage>

        <StateMessage
          v-if="mergedRecords.length > 0"
          state="success"
          title="Cette fiche réunit d’autres fiches fusionnées"
        >
          <ul class="divide-y divide-line rounded-lg border border-line bg-surface">
            <li
              v-for="record in mergedRecords"
              :key="record.patient_id"
              class="flex flex-col gap-1 px-3 py-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-2"
            >
              <span
                >Dossier <strong class="font-semibold">{{ record.record_number }}</strong
                >, fusionné le {{ formatInstantFr(record.merged_at) }} :</span
              >
              <RouterLink
                :to="{ name: 'patient', params: { id: record.patient_id } }"
                class="text-link inline-flex min-h-11 items-center font-semibold"
                >voir la fiche absorbée</RouterLink
              >
            </li>
          </ul>
          <p class="mt-2 text-sm text-muted">
            Leur activité apparaît dans l’onglet « Activité » ; leurs pièces gardent le numéro
            imprimé à leur émission.
          </p>
        </StateMessage>

        <div class="grid gap-6 lg:grid-cols-2">
          <SectionCard title="Identité" title-id="fiche-identite" icon="id-card">
            <dl class="detail-list">
              <div>
                <dt>Nom</dt>
                <dd class="font-semibold">{{ patient.last_name }}</dd>
              </div>
              <div>
                <dt>Prénom(s)</dt>
                <dd>{{ shown(patient.first_names) }}</dd>
              </div>
              <div>
                <dt>Sexe</dt>
                <dd>{{ sexLabel(patient.sex) }}</dd>
              </div>
              <div>
                <dt>Date de naissance</dt>
                <dd>
                  <template v-if="patient.birth_date !== null"
                    >{{ formatDateFr(patient.birth_date) }} ({{ age }})</template
                  >
                  <template v-else
                    >{{ absence(null, patient.birth_date_missing_reason) }} ({{ age }})</template
                  >
                </dd>
              </div>
              <div class="col-span-full">
                <dt>Profession</dt>
                <dd>{{ shown(patient.profession) }}</dd>
              </div>
            </dl>
          </SectionCard>

          <SectionCard title="Contact" title-id="fiche-contact" icon="phone">
            <dl class="detail-list">
              <div>
                <dt>Téléphone principal</dt>
                <dd :class="STRONG">
                  {{ absence(patient.phone_primary, patient.phone_missing_reason) }}
                </dd>
              </div>
              <div>
                <dt>Téléphone secondaire</dt>
                <dd class="tabular-nums">{{ shown(patient.phone_secondary) }}</dd>
              </div>
              <div class="col-span-full">
                <dt>Adresse ou quartier</dt>
                <dd class="whitespace-pre-line">{{ shown(patient.address) }}</dd>
              </div>
            </dl>
          </SectionCard>

          <SectionCard title="Dossier" title-id="fiche-dossier" icon="folder" class="lg:col-span-2">
            <dl class="detail-list lg:grid-cols-3">
              <div>
                <dt>Numéro de dossier</dt>
                <dd :class="STRONG">{{ patient.record_number }}</dd>
              </div>
              <div>
                <dt>Fiche créée le</dt>
                <dd>{{ formatInstantFr(patient.created_at) }}</dd>
              </div>
              <div>
                <dt>Dernière modification</dt>
                <dd>{{ formatInstantFr(patient.updated_at) }}</dd>
              </div>
              <div v-if="patient.legacy_record" class="col-span-full">
                <dt>Ancien dossier</dt>
                <dd>
                  Repris de l’ancien classeur<template v-if="patient.legacy_record_number">
                    (n° {{ patient.legacy_record_number }})</template
                  ><template v-if="patient.first_known_visit_on">
                    , première visite connue le
                    {{ formatDateFr(patient.first_known_visit_on) }}</template
                  >
                </dd>
              </div>
            </dl>

            <div
              v-if="canExportRecord || canMerge"
              class="mt-6 flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:flex-wrap sm:items-start"
            >
              <ExportRecordButton v-if="canExportRecord" :patient-id="patient.id" />
              <LinkButton
                v-if="canMerge"
                :to="{ name: 'patient-fusion', params: { id: patient.id } }"
                variant="ghost"
                ><AppIcon name="merge" :size="18" />Fusionner avec une autre fiche</LinkButton
              >
            </div>
          </SectionCard>
        </div>

        <FreshnessNote
          v-if="read.freshness.value"
          :freshness="read.freshness.value"
          :time-zone="timeZone"
        />
      </div>
    </template>

    <template v-else>
      <PageHeader title-id="titre-fiche" title="Dossier patient" icon="patients" :back="BACK" />
      <StateMessage v-if="read.state.value === 'ready'" state="error" title="Fiche inattendue">
        Le serveur a répondu avec une autre fiche que celle demandée : rien n’est affiché.
      </StateMessage>
      <ReadStateMessage
        :state="read.state.value"
        subject="record"
        :error="read.error.value"
        @retry="read.reload()"
      />
    </template>
  </section>
</template>
