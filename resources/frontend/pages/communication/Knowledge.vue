<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'

import { ApiError, NetworkUnavailable } from '@/app/api'
import { formatInstantFr } from '@/app/clinicTime'
import {
  approveKnowledgeVersion,
  createKnowledgeEntry,
  createKnowledgeVersion,
  listKnowledgeEntries,
  newIdempotencyKey,
  publishKnowledgeVersion,
} from '@/app/services/communication'
import ReadNotice from '@/components/feedback/ReadNotice.vue'
import StateMessage from '@/components/feedback/StateMessage.vue'
import SelectField from '@/components/form/SelectField.vue'
import TextAreaField from '@/components/form/TextAreaField.vue'
import TextField from '@/components/form/TextField.vue'
import EmptyState from '@/components/layout/EmptyState.vue'
import PageHeader from '@/components/layout/PageHeader.vue'
import SectionCard from '@/components/layout/SectionCard.vue'
import StatusChip from '@/components/layout/StatusChip.vue'
import AppButton from '@/components/ui/AppButton.vue'
import LinkButton from '@/components/ui/LinkButton.vue'
import PaginationControls from '@/components/ui/PaginationControls.vue'
import { KNOWLEDGE_CATEGORY_LABELS, KNOWLEDGE_CATEGORY_OPTIONS } from '@/domain/communication/types'
import type {
  KnowledgeEntriesCategory,
  KnowledgeEntry,
  KnowledgeEntryVersion,
} from '@/domain/contracts/generated'
import { useServerRead } from '@/pages/today/useServerRead'

/**
 * Base de connaissances gouvernée pour l'assistant borné : création des fiches, rédaction des
 * révisions brouillon, approbation manager puis publication d'une version active unique.
 */
const router = useRouter()
const communicationHomeTarget = computed(() =>
  router.hasRoute('communication') ? { name: 'communication' } : '/communication',
)

const categoryFilter = ref<KnowledgeEntriesCategory | null>(null)
const currentPage = ref(1)

const entriesRead = useServerRead(
  () => listKnowledgeEntries({ page: currentPage.value, category: categoryFilter.value }),
  { isEmpty: (page) => page.data.length === 0 },
)

const selectedEntry = ref<KnowledgeEntry | null>(null)

function changeCategory(next: string | null): void {
  categoryFilter.value = (next as KnowledgeEntriesCategory | null) ?? null
  currentPage.value = 1
  void entriesRead.reload()
}

function goPage(page: number): void {
  currentPage.value = page
  void entriesRead.reload()
}

// --- Approbation & publication de révision ---

const actionReason = ref('')
const busyVersionId = ref<string | null>(null)
const actionFeedback = ref<{ tone: 'success' | 'error'; title: string; text: string } | null>(null)

function versionStatus(version: KnowledgeEntryVersion): {
  label: string
  tone: 'success' | 'gold' | 'neutral'
} {
  if (version.is_published) return { label: 'Publiée (active)', tone: 'success' }
  if (version.approved_at !== null) return { label: 'Approuvée (prête)', tone: 'gold' }
  if (version.retired_at !== null) return { label: 'Retirée', tone: 'neutral' }
  return { label: 'Brouillon', tone: 'neutral' }
}

async function handleVersionAction(
  version: KnowledgeEntryVersion,
  kind: 'approve' | 'publish',
): Promise<void> {
  if (busyVersionId.value !== null) return
  busyVersionId.value = version.id
  actionFeedback.value = null
  const reason = actionReason.value.trim()
  const payload = { reason: reason !== '' ? reason : null }
  try {
    const updated =
      kind === 'approve'
        ? await approveKnowledgeVersion(version.id, payload, newIdempotencyKey())
        : await publishKnowledgeVersion(version.id, payload, newIdempotencyKey())
    actionFeedback.value = {
      tone: 'success',
      title:
        kind === 'approve'
          ? `Révision r${updated.revision_no} approuvée`
          : `Révision r${updated.revision_no} publiée`,
      text:
        kind === 'approve'
          ? 'La révision peut désormais être publiée comme version active.'
          : 'Cette révision devient l’unique version active consultée par l’assistant.',
    }
    actionReason.value = ''
    await entriesRead.reload()
    if (selectedEntry.value) {
      selectedEntry.value =
        entriesRead.data.value?.data.find((entry) => entry.id === selectedEntry.value?.id) ?? null
    }
  } catch (failure) {
    if (failure instanceof NetworkUnavailable) {
      actionFeedback.value = {
        tone: 'error',
        title: 'Action non confirmée',
        text: 'Serveur injoignable : veuillez vérifier la connexion et réessayer.',
      }
    } else if (failure instanceof ApiError) {
      actionFeedback.value = {
        tone: 'error',
        title: 'Transition refusée',
        text: failure.message,
      }
    } else {
      throw failure
    }
  } finally {
    busyVersionId.value = null
  }
}

// --- Nouvelle révision sur fiche existante ---

const revisionForm = reactive({
  content: '',
  language: 'fr',
})
const revisionSaving = ref(false)
const revisionError = ref<string | null>(null)
const revisionSuccess = ref<string | null>(null)

function openRevisionFor(entry: KnowledgeEntry): void {
  selectedEntry.value = entry
  revisionForm.content = entry.published_version?.content ?? entry.versions[0]?.content ?? ''
  revisionForm.language = entry.published_version?.language ?? entry.versions[0]?.language ?? 'fr'
  revisionError.value = null
  revisionSuccess.value = null
}

async function submitNewRevision(): Promise<void> {
  if (!selectedEntry.value || revisionSaving.value) return
  revisionError.value = null
  revisionSuccess.value = null
  if (revisionForm.content.trim() === '') {
    revisionError.value = 'Renseignez le contenu administratif de la révision.'
    return
  }

  revisionSaving.value = true
  try {
    const created = await createKnowledgeVersion(
      selectedEntry.value.id,
      {
        content: revisionForm.content.trim(),
        language: revisionForm.language.trim() || 'fr',
      },
      newIdempotencyKey(),
    )
    revisionSuccess.value = `Révision brouillon r${created.revision_no} ajoutée à « ${selectedEntry.value.title} ».`
    await entriesRead.reload()
    selectedEntry.value =
      entriesRead.data.value?.data.find((entry) => entry.id === selectedEntry.value?.id) ?? null
  } catch (failure) {
    if (failure instanceof NetworkUnavailable) {
      revisionError.value = 'Serveur injoignable : révision non enregistrée.'
    } else if (failure instanceof ApiError) {
      revisionError.value = failure.message
    } else {
      throw failure
    }
  } finally {
    revisionSaving.value = false
  }
}

// --- Création d'une nouvelle fiche + révision 1 ---

const createForm = reactive<{
  code: string
  title: string
  category: KnowledgeEntriesCategory | null
  language: string
  content: string
}>({
  code: '',
  title: '',
  category: 'HOURS',
  language: 'fr',
  content: '',
})
const createSaving = ref(false)
const createError = ref<string | null>(null)
const createSuccess = ref<string | null>(null)

async function submitNewEntry(): Promise<void> {
  if (createSaving.value) return
  createError.value = null
  createSuccess.value = null

  if (
    createForm.code.trim() === '' ||
    createForm.title.trim() === '' ||
    createForm.content.trim() === ''
  ) {
    createError.value = 'Renseignez le code, le titre et le contenu initial de la fiche.'
    return
  }

  createSaving.value = true
  try {
    const created = await createKnowledgeEntry(
      {
        code: createForm.code.trim(),
        title: createForm.title.trim(),
        category: createForm.category ?? 'OTHER',
        language: createForm.language.trim() || 'fr',
        content: createForm.content.trim(),
      },
      newIdempotencyKey(),
    )
    createSuccess.value = `Fiche « ${created.title} » (${created.code}) créée en révision 1 (brouillon).`
    createForm.code = ''
    createForm.title = ''
    createForm.content = ''
    await entriesRead.reload()
    selectedEntry.value = created
  } catch (failure) {
    if (failure instanceof NetworkUnavailable) {
      createError.value = 'Serveur injoignable : fiche non enregistrée.'
    } else if (failure instanceof ApiError) {
      createError.value = failure.message
    } else {
      throw failure
    }
  } finally {
    createSaving.value = false
  }
}
</script>

<template>
  <section aria-labelledby="titre-knowledge" class="page-stack max-w-6xl">
    <PageHeader
      title-id="titre-knowledge"
      title="Base de connaissances gouvernée"
      subtitle="Fiches informatives du cabinet (horaires, tarifs indicatifs, mutuelles) approuvées puis publiées avant usage par l’assistant."
      icon="clipboard"
      eyebrow="Connaissances assistant"
    >
      <template #actions>
        <LinkButton :to="communicationHomeTarget" variant="secondary">
          Retour Communication
        </LinkButton>
      </template>
    </PageHeader>

    <StateMessage v-if="actionFeedback" :state="actionFeedback.tone" :title="actionFeedback.title">
      {{ actionFeedback.text }}
    </StateMessage>

    <SectionCard
      title="Fiches enregistrées et versions"
      title-id="titre-fiches-connaissances"
      description="Une seule révision publiée peut être active par fiche ; toute nouvelle révision part au statut brouillon."
      icon="list"
    >
      <template #actions>
        <div class="min-w-52">
          <SelectField
            label="Catégorie"
            :model-value="categoryFilter"
            :options="KNOWLEDGE_CATEGORY_OPTIONS"
            placeholder="Toutes les catégories"
            @update:model-value="changeCategory"
          />
        </div>
      </template>

      <div class="space-y-4">
        <TextField
          v-model="actionReason"
          label="Note d’approbation ou de publication (facultative)"
          placeholder="ex. Vérifié avec la grille tarifaire du trimestre"
        />

        <ReadNotice
          :state="entriesRead.state.value"
          :error="entriesRead.error.value"
          subject="la base de connaissances"
          @retry="entriesRead.reload()"
        />

        <EmptyState
          v-if="entriesRead.state.value === 'empty'"
          title="Aucune fiche de connaissance pour cette catégorie"
          icon="clipboard"
          flat
          title-as="h3"
        >
          Créez une fiche ci-dessous pour alimenter les réponses sourcées de l’assistant.
        </EmptyState>

        <template v-else-if="entriesRead.data.value">
          <ul class="space-y-4">
            <li
              v-for="entry in entriesRead.data.value.data"
              :key="entry.id"
              class="rounded-xl border border-line bg-canvas p-4"
            >
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p class="text-xs font-semibold tracking-wide text-gold-ink uppercase">
                    {{ KNOWLEDGE_CATEGORY_LABELS[entry.category] }} · <code>{{ entry.code }}</code>
                  </p>
                  <h3 class="text-lg font-semibold text-ink">{{ entry.title }}</h3>
                  <p class="text-sm text-muted">
                    {{
                      entry.published_version
                        ? `Version publiée active : r${entry.published_version.revision_no} (${entry.published_version.language})`
                        : 'Aucune version publiée pour le moment'
                    }}
                  </p>
                </div>
                <AppButton variant="secondary" @click="openRevisionFor(entry)">
                  Ajouter une révision
                </AppButton>
              </div>

              <div v-if="entry.versions.length > 0" class="mt-4 space-y-3">
                <div
                  v-for="version in entry.versions"
                  :key="version.id"
                  class="rounded-lg border border-line bg-surface p-3"
                >
                  <div class="flex flex-wrap items-center justify-between gap-2">
                    <div class="flex flex-wrap items-center gap-2">
                      <span class="font-semibold text-ink">
                        Révision r{{ version.revision_no }} ({{ version.language }})
                      </span>
                      <StatusChip :tone="versionStatus(version).tone">
                        {{ versionStatus(version).label }}
                      </StatusChip>
                      <span class="text-xs text-muted">
                        Créée le {{ formatInstantFr(version.created_at) }}
                      </span>
                    </div>
                    <div class="flex flex-wrap gap-2">
                      <AppButton
                        v-if="version.approved_at === null"
                        variant="secondary"
                        :pending="busyVersionId === version.id"
                        :accessible-name="`Approuver la révision ${version.revision_no} de ${entry.title}`"
                        @click="handleVersionAction(version, 'approve')"
                      >
                        Approuver la révision
                      </AppButton>
                      <AppButton
                        v-if="version.approved_at !== null && !version.is_published"
                        variant="primary"
                        :pending="busyVersionId === version.id"
                        :accessible-name="`Publier la révision ${version.revision_no} de ${entry.title}`"
                        @click="handleVersionAction(version, 'publish')"
                      >
                        Publier cette révision
                      </AppButton>
                    </div>
                  </div>
                  <p class="mt-2 whitespace-pre-line text-sm text-ink">{{ version.content }}</p>
                </div>
              </div>
            </li>
          </ul>

          <PaginationControls
            :current-page="entriesRead.data.value.meta.current_page"
            :last-page="entriesRead.data.value.meta.last_page"
            :total="entriesRead.data.value.meta.total"
            :busy="entriesRead.state.value === 'loading'"
            unit="fiches"
            @page="goPage"
          />
        </template>
      </div>
    </SectionCard>

    <SectionCard
      v-if="selectedEntry"
      :title="`Nouvelle révision pour « ${selectedEntry.title} »`"
      title-id="titre-nouvelle-revision"
      description="Crée une nouvelle révision brouillon sans modifier la version actuellement publiée."
      icon="file-plus"
    >
      <form class="space-y-4" novalidate @submit.prevent="submitNewRevision">
        <StateMessage v-if="revisionError" state="error" title="Révision non enregistrée">
          {{ revisionError }}
        </StateMessage>
        <StateMessage v-if="revisionSuccess" state="success" title="Révision créée">
          {{ revisionSuccess }}
        </StateMessage>
        <div class="form-grid">
          <TextField v-model="revisionForm.language" label="Langue" placeholder="fr" />
          <TextAreaField
            v-model="revisionForm.content"
            class="col-span-full"
            label="Contenu de la révision"
            :rows="4"
            required
          />
        </div>
        <div class="form-actions">
          <AppButton
            type="submit"
            variant="primary"
            :pending="revisionSaving"
            pending-label="Création…"
          >
            Enregistrer la révision brouillon
          </AppButton>
          <AppButton variant="secondary" @click="selectedEntry = null">Fermer</AppButton>
        </div>
      </form>
    </SectionCard>

    <SectionCard
      title="Créer une fiche de connaissance"
      title-id="titre-creer-fiche"
      description="Rédigez les informations factuelles autorisées (aucun avis médical ni conseil thérapeutique)."
      icon="plus"
    >
      <form class="space-y-4" novalidate @submit.prevent="submitNewEntry">
        <StateMessage v-if="createError" state="error" title="Fiche non créée">
          {{ createError }}
        </StateMessage>
        <StateMessage v-if="createSuccess" state="success" title="Fiche créée">
          {{ createSuccess }}
        </StateMessage>
        <div class="form-grid">
          <TextField
            v-model="createForm.code"
            label="Code unique"
            placeholder="ex. HORAIRES_OUVERTURE"
            required
          />
          <TextField
            v-model="createForm.title"
            label="Titre de la fiche"
            placeholder="ex. Horaires d’ouverture du cabinet"
            required
          />
          <SelectField
            :model-value="createForm.category"
            label="Catégorie"
            :options="KNOWLEDGE_CATEGORY_OPTIONS"
            required
            @update:model-value="
              (v) => (createForm.category = (v as KnowledgeEntriesCategory | null) ?? 'HOURS')
            "
          />
          <TextField v-model="createForm.language" label="Langue" placeholder="fr" />
          <TextAreaField
            v-model="createForm.content"
            class="col-span-full"
            label="Contenu initial (révision 1)"
            :rows="4"
            required
          />
        </div>
        <div class="form-actions">
          <AppButton
            type="submit"
            variant="primary"
            :pending="createSaving"
            pending-label="Création…"
          >
            Créer la fiche et sa révision 1
          </AppButton>
        </div>
      </form>
    </SectionCard>
  </section>
</template>
