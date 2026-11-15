<script setup lang="ts">
/**
 * Site public de la gérante (L3D02, EE039), module « communication », EN LIGNE, droit `site.publish` : les fiches du
 * showroom (un article du catalogue décrit pour le public, avec ses images, leur texte alternatif et leur note de
 * droits) et les contenus du site (accueil, expertises, horaires…). Écrire enregistre un BROUILLON ; publier, retirer ou
 * archiver est une décision de la gérante, confirmée par son mot de passe. Seul ce qui est publié sort de l'application :
 * jamais de coût d'achat, de stock ni de donnée de patient. Données de démonstration FICTIVES seulement.
 */
import { computed, nextTick, ref } from 'vue'

import { ApiError, NetworkUnavailable } from '@/app/api'
import type { MutationOutcome } from '@/app/services/mutations'
import {
  attachPublicationMedia,
  listPublicContents,
  listPublications,
  removePublicationMedia,
} from '@/app/services/publications'
import { revalidateSession } from '@/app/session'
import { useUnsavedChangesGuard } from '@/app/unsavedChanges'
import ErrorSummary, { type FieldErrorItem } from '@/components/feedback/ErrorSummary.vue'
import StateMessage from '@/components/feedback/StateMessage.vue'
import CheckboxField from '@/components/form/CheckboxField.vue'
import SelectField from '@/components/form/SelectField.vue'
import TextAreaField from '@/components/form/TextAreaField.vue'
import TextField from '@/components/form/TextField.vue'
import PageHeader from '@/components/layout/PageHeader.vue'
import PasswordConfirmDialog from '@/components/session/PasswordConfirmDialog.vue'
import AppButton from '@/components/ui/AppButton.vue'
import PaginationControls from '@/components/ui/PaginationControls.vue'
import type {
  PublicationPage,
  PublicContentEntry,
  PublicContentList,
  Publication,
} from '@/domain/contracts/generated'
import {
  buildContentRequest,
  buildPublicationRequest,
  DESCRIPTION_MAX,
  emptyPublicationForm,
  hasErrors,
  type PublicationErrors,
  type PublicationField,
  publicationFieldFromServer,
  type PublicationForm,
  publicationFormOf,
  STYLE_MAX,
  TITLE_MAX,
  validatePublicationForm,
} from '@/domain/site/site'
import CommandFailure from '@/pages/purchasing/CommandFailure.vue'
import { useCatalogItems } from '@/pages/purchasing/useCatalogItems'
import SalesReadMessage from '@/pages/sales/SalesReadMessage.vue'
import { useStockCommand } from '@/pages/stock/useStockCommand'
import { useServerRead } from '@/pages/today/useServerRead'

import SiteContentCard from './SiteContentCard.vue'
import SitePublicationCard from './SitePublicationCard.vue'

type Flow = 'publication' | 'status' | 'content'
type PublicStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'

const STATUS_FILTER_OPTIONS = [
  { value: 'DRAFT', label: 'Brouillons' },
  { value: 'PUBLISHED', label: 'Publiées' },
  { value: 'ARCHIVED', label: 'Archivées' },
] as const

const FIELD_IDS: Readonly<Record<PublicationField, string>> = {
  catalogItemId: 'fiche-article',
  title: 'fiche-titre',
  description: 'fiche-description',
  style: 'fiche-style',
  displayOrder: 'fiche-ordre',
}

const statusFilter = ref<string | null>(null)
const currentPage = ref(1)

const publicationsRead = useServerRead<PublicationPage>(
  () => listPublications({ status: statusFilter.value, page: currentPage.value }),
  { isEmpty: (page) => page.data.length === 0 },
)
const contentsRead = useServerRead<PublicContentList>(() => listPublicContents())
const catalog = useCatalogItems()
const command = useStockCommand('')
const { mutation } = command
const saving = computed(() => mutation.state.value === 'saving')
const mediaBusy = ref(false)
const busy = computed(() => saving.value || mediaBusy.value)

const form = ref<PublicationForm>(emptyPublicationForm())
const baseline = ref<PublicationForm>(emptyPublicationForm())
const editing = ref<Publication | null>(null)
const errors = ref<PublicationErrors>({})
const general = ref<string | null>(null)
const notice = ref<string | null>(null)
const actionError = ref<string | null>(null)
const summaryBox = ref<{ focus: () => Promise<void> } | null>(null)
const lastIntent = ref<{ flow: Flow; success: string } | null>(null)

const dirty = computed(() => JSON.stringify(form.value) !== JSON.stringify(baseline.value))
useUnsavedChangesGuard(dirty)

const publications = computed(() => publicationsRead.data.value?.data ?? [])
const contents = computed<readonly PublicContentEntry[]>(() => contentsRead.data.value?.data ?? [])

/**
 * Le message d'état remplace la liste sauf pendant une relecture : la liste lue reste alors affichée (les saisies des
 * autres cartes, par exemple une image en cours de description, ne sont pas perdues par la relecture d'une décision).
 */
function readMessage(state: string, loaded: boolean): boolean {
  if (state === 'ready' || state === 'empty') return false
  return !(state === 'loading' && loaded)
}
const publicationsMessage = computed(() =>
  readMessage(publicationsRead.state.value, publicationsRead.data.value !== null),
)
const contentsMessage = computed(() =>
  readMessage(contentsRead.state.value, contentsRead.data.value !== null),
)

/** Seuls les articles actifs et marqués « visibles au public » dans le catalogue peuvent avoir une fiche. */
const itemOptions = computed(() =>
  (catalog.read.data.value ?? [])
    .filter((item) => item.active && item.public_visibility)
    .map((item) => ({ value: item.id, label: `${item.name} (${item.reference})` })),
)
const catalogTruncated = computed(() => catalog.read.freshness.value?.complete === false)
const itemChoice = computed<string | null>({
  get: () => (form.value.catalogItemId === '' ? null : form.value.catalogItemId),
  set: (value) => {
    form.value.catalogItemId = value ?? ''
  },
})

const summary = computed<FieldErrorItem[]>(() => {
  const items: FieldErrorItem[] = []
  if (general.value !== null) items.push({ fieldId: FIELD_IDS.title, message: general.value })
  for (const [field, message] of Object.entries(errors.value)) {
    items.push({ fieldId: FIELD_IDS[field as PublicationField], message })
  }
  return items
})

function resetForm(next: PublicationForm, target: Publication | null): void {
  form.value = { ...next }
  baseline.value = { ...next }
  editing.value = target
  errors.value = {}
  general.value = null
}

function reloadBoth(): Promise<unknown> {
  return Promise.all([publicationsRead.reload(), contentsRead.reload()])
}

function startEdit(publication: Publication): void {
  notice.value = null
  actionError.value = null
  mutation.reset()
  resetForm(publicationFormOf(publication), publication)
  void nextTick(() => document.getElementById(FIELD_IDS.title)?.focus())
}

function cancelEdit(): void {
  mutation.reset()
  resetForm(emptyPublicationForm(), null)
}

function changeFilter(next: string | null): void {
  statusFilter.value = next
  currentPage.value = 1
  void publicationsRead.reload()
}

function goPage(page: number): void {
  currentPage.value = page
  void publicationsRead.reload()
}

/** Message du refus d'une commande : le texte du serveur, puis ses messages par champ, sans doublon. */
function commandFailureText(): string | null {
  const parts = [command.message.value, ...Object.values(command.fields.value)]
  const text = [
    ...new Set(parts.filter((part): part is string => typeof part === 'string' && part !== '')),
  ]
  return text.length === 0 ? null : text.join(' ')
}

/** Message d'un échec hors commande (image) : jamais « enregistré » sans réponse du serveur. */
function describeFailure(failure: unknown): string {
  if (failure instanceof NetworkUnavailable) {
    return 'Pas de connexion au serveur : rien n’a été enregistré. Recommencez quand le réseau est revenu.'
  }
  if (failure instanceof ApiError) {
    if (failure.status === 401 || failure.status === 419) {
      void revalidateSession().catch(() => undefined)
      return 'Votre session a expiré : reconnectez-vous, puis recommencez.'
    }
    const parts = [failure.message, ...Object.values(failure.fields).flat()]
    return [...new Set(parts.filter((part) => part !== ''))].join(' ')
  }
  return 'L’opération n’a pas pu être terminée : rien n’a été enregistré.'
}

async function afterOutcome(outcome: MutationOutcome, flow: Flow, success: string): Promise<void> {
  switch (outcome.kind) {
    case 'synced':
      notice.value = success
      actionError.value = null
      general.value = null
      mutation.reset()
      if (flow === 'publication') resetForm(emptyPublicationForm(), null)
      await reloadBoth()
      return
    case 'refused':
    case 'conflict': {
      if (flow === 'publication') {
        const byField: PublicationErrors = {}
        const others: string[] = []
        for (const [key, message] of Object.entries(command.fields.value)) {
          const field = publicationFieldFromServer(key)
          if (field === null) others.push(message)
          else byField[field] = message
        }
        errors.value = byField
        general.value =
          others.length > 0
            ? others.join(' ')
            : Object.keys(byField).length === 0
              ? command.message.value
              : null
        await summaryBox.value?.focus()
      } else {
        actionError.value = commandFailureText()
      }
      if (command.stale.value) await reloadBoth()
      return
    }
    default:
      return
  }
}

async function submitPublication(): Promise<void> {
  if (busy.value) return
  const target = editing.value
  const creating = target === null
  const checked = validatePublicationForm(form.value, creating)
  if (hasErrors(checked)) {
    errors.value = checked
    general.value = null
    await summaryBox.value?.focus()
    return
  }
  notice.value = null
  actionError.value = null
  // La version attendue est celle de la dernière lecture : une fiche modifiée ailleurs est refusée (409), jamais écrasée.
  const version =
    target === null
      ? null
      : (publications.value.find((candidate) => candidate.id === target.id)?.version ??
        target.version)
  const success = creating
    ? 'Fiche enregistrée en brouillon : elle n’est pas visible du public tant que vous ne la publiez pas.'
    : 'Fiche modifiée : elle est repassée en brouillon, publiez-la de nouveau quand elle est prête.'
  lastIntent.value = { flow: 'publication', success }
  const outcome = await command.send({
    name: 'SaveCatalogPublication',
    route:
      target === null
        ? { method: 'POST', path: '/publications' }
        : {
            method: 'PATCH',
            path: `/publications/${encodeURIComponent(target.id)}`,
            expectedVersion: 'entity',
          },
    expectedVersion: version,
    payload: { ...buildPublicationRequest(form.value, version, creating) },
  })
  await afterOutcome(outcome, 'publication', success)
}

const STATUS_NOTICES: Readonly<Record<PublicStatus, (title: string) => string>> = {
  PUBLISHED: (title) => `« ${title} » est publiée : elle est visible sur le site.`,
  DRAFT: (title) => `« ${title} » est retirée du site : elle est repassée en brouillon.`,
  ARCHIVED: (title) => `« ${title} » est archivée.`,
}

async function changePublicationStatus(
  publication: Publication,
  status: PublicStatus,
): Promise<void> {
  if (busy.value) return
  notice.value = null
  actionError.value = null
  const success = STATUS_NOTICES[status](publication.public_title)
  lastIntent.value = { flow: 'status', success }
  const outcome = await command.send({
    name: 'ChangeCatalogPublicationStatus',
    route: {
      method: 'POST',
      path: `/publications/${encodeURIComponent(publication.id)}/status`,
      expectedVersion: 'entity',
    },
    expectedVersion: publication.version,
    payload: { status },
  })
  await afterOutcome(outcome, 'status', success)
}

async function saveContent(
  entry: PublicContentEntry,
  values: { title: string; content: string },
): Promise<void> {
  if (busy.value) return
  notice.value = null
  actionError.value = null
  const success = `Brouillon « ${entry.label} » enregistré : il n’est pas visible du public tant que vous ne le publiez pas.`
  lastIntent.value = { flow: 'content', success }
  const outcome = await command.send({
    name: 'SavePublicContent',
    route: { method: 'POST', path: '/public-contents' },
    payload: { ...buildContentRequest(entry.code, values) },
  })
  await afterOutcome(outcome, 'content', success)
}

async function changeContentStatus(
  entry: PublicContentEntry,
  status: 'PUBLISHED' | 'ARCHIVED',
): Promise<void> {
  if (busy.value) return
  const revision = status === 'PUBLISHED' ? entry.draft : entry.published
  if (revision === null) return
  notice.value = null
  actionError.value = null
  const success =
    status === 'PUBLISHED'
      ? `« ${entry.label} » est publié : l’ancienne version est archivée.`
      : `« ${entry.label} » est retiré du site.`
  lastIntent.value = { flow: 'status', success }
  const outcome = await command.send({
    name: 'ChangePublicContentStatus',
    route: {
      method: 'POST',
      path: `/public-contents/${encodeURIComponent(revision.id)}/status`,
      expectedVersion: 'entity',
    },
    expectedVersion: revision.version,
    payload: { status },
  })
  await afterOutcome(outcome, 'status', success)
}

async function uploadMedia(
  publication: Publication,
  payload: { file: File; alt: string; rights: string; order: number; done: () => void },
): Promise<void> {
  if (busy.value) return
  mediaBusy.value = true
  notice.value = null
  actionError.value = null
  try {
    await attachPublicationMedia(
      publication.id,
      payload.file,
      payload.alt,
      payload.rights,
      payload.order,
    )
    payload.done()
    notice.value = 'Image déposée : elle ne sort sur le site qu’avec la fiche publiée.'
    await publicationsRead.reload()
  } catch (failure) {
    actionError.value = describeFailure(failure)
  } finally {
    mediaBusy.value = false
  }
}

async function removeMedia(publication: Publication, mediaId: string): Promise<void> {
  if (busy.value) return
  mediaBusy.value = true
  notice.value = null
  actionError.value = null
  try {
    await removePublicationMedia(publication.id, mediaId)
    notice.value = 'Image retirée de la fiche.'
    await publicationsRead.reload()
  } catch (failure) {
    actionError.value = describeFailure(failure)
  } finally {
    mediaBusy.value = false
  }
}

async function passwordConfirmed(): Promise<void> {
  const intent = lastIntent.value
  const outcome = await command.passwordConfirmed()
  if (intent !== null) await afterOutcome(outcome, intent.flow, intent.success)
}

async function retry(): Promise<void> {
  if (saving.value) return
  const intent = lastIntent.value
  const outcome = await command.retry()
  if (intent !== null) await afterOutcome(outcome, intent.flow, intent.success)
}

function contentKey(entry: PublicContentEntry): string {
  return `${entry.code}:${entry.draft?.id ?? '-'}:${entry.published?.id ?? '-'}`
}
</script>

<template>
  <section aria-labelledby="titre-site-public" class="page-stack max-w-5xl">
    <PageHeader
      title-id="titre-site-public"
      title="Site public : showroom et contenus"
      subtitle="Les fiches du showroom et les contenus du site : écrire enregistre un brouillon, la publication est votre décision."
      icon="communication"
      eyebrow="Relation & canaux"
      :back="{ to: { name: 'communication' }, label: 'Communication et CRM' }"
    />

    <p class="max-w-prose text-base text-muted">
      Seul ce qui est <strong>publié</strong> sort de l’application. Jamais de coût d’achat, de
      quantité en stock ni de donnée de patient. Publier, retirer ou archiver demande votre mot de
      passe.
    </p>

    <StateMessage v-if="notice" state="success" :title="notice" />
    <StateMessage v-if="actionError" state="error" title="Opération refusée">
      {{ actionError }}
    </StateMessage>
    <CommandFailure
      :state="mutation.state.value"
      :message="null"
      :failure-message="mutation.failureMessage.value"
      :saving="saving"
      @retry="retry"
    />

    <section aria-labelledby="titre-fiches" class="space-y-4">
      <h2 id="titre-fiches" class="text-xl font-semibold">Fiches du showroom</h2>
      <div class="max-w-xs">
        <SelectField
          :model-value="statusFilter"
          label="Afficher"
          placeholder="Toutes les fiches"
          :options="STATUS_FILTER_OPTIONS"
          control-id="fiches-filtre"
          @update:model-value="changeFilter"
        />
      </div>

      <SalesReadMessage
        v-if="publicationsMessage"
        :state="publicationsRead.state.value"
        subject="les fiches du showroom"
        :error="publicationsRead.error.value"
        @retry="publicationsRead.reload()"
      />
      <StateMessage
        v-else-if="publicationsRead.state.value === 'empty'"
        state="empty"
        title="Aucune fiche"
      >
        Aucune fiche ne correspond : créez la première ci-dessous.
      </StateMessage>
      <template v-else>
        <ul class="space-y-3">
          <SitePublicationCard
            v-for="publication in publications"
            :key="publication.id"
            :publication="publication"
            :busy="busy"
            @edit="startEdit(publication)"
            @status="(status) => changePublicationStatus(publication, status)"
            @upload="(payload) => uploadMedia(publication, payload)"
            @remove="(mediaId) => removeMedia(publication, mediaId)"
          />
        </ul>
        <PaginationControls
          v-if="publicationsRead.data.value"
          :current-page="publicationsRead.data.value.meta.current_page"
          :last-page="publicationsRead.data.value.meta.last_page"
          :total="publicationsRead.data.value.meta.total"
          :busy="publicationsRead.state.value === 'loading'"
          unit="fiches"
          label="Pagination des fiches du showroom"
          @page="goPage"
        />
      </template>

      <section aria-labelledby="titre-formulaire-fiche" class="space-y-4">
        <h3 id="titre-formulaire-fiche" class="text-lg font-semibold">
          {{ editing === null ? 'Nouvelle fiche' : 'Modifier la fiche' }}
        </h3>
        <p v-if="editing !== null" class="max-w-prose text-sm text-muted">
          Modifier une fiche la remet en brouillon : vous la publiez de nouveau quand elle est
          prête.
        </p>
        <form
          novalidate
          class="space-y-4"
          aria-labelledby="titre-formulaire-fiche"
          @submit.prevent="submitPublication"
        >
          <ErrorSummary ref="summaryBox" :errors="summary" />
          <template v-if="editing === null">
            <SelectField
              v-model="itemChoice"
              label="Article du catalogue"
              hint="Seuls les articles actifs et marqués « visibles au public » dans le catalogue sont proposés."
              placeholder="Choisir l’article…"
              :options="itemOptions"
              :control-id="FIELD_IDS.catalogItemId"
              :error="errors.catalogItemId ?? null"
              required
            />
            <p v-if="catalogTruncated" class="text-sm text-muted">
              Le catalogue est long : seuls ses premiers articles sont proposés ici.
            </p>
          </template>
          <p v-else class="text-sm text-muted">
            Article du catalogue : {{ editing.item_name }} ({{ editing.item_reference }}).
          </p>
          <TextField
            v-model="form.title"
            label="Titre public"
            :control-id="FIELD_IDS.title"
            :maxlength="TITLE_MAX"
            :error="errors.title ?? null"
            required
          />
          <TextAreaField
            v-model="form.description"
            label="Description publique"
            hint="Ce que le public lira. Pas de promesse médicale."
            :control-id="FIELD_IDS.description"
            :maxlength="DESCRIPTION_MAX"
            :rows="4"
            :error="errors.description ?? null"
            required
          />
          <div class="grid gap-3 sm:grid-cols-2">
            <TextField
              v-model="form.style"
              label="Style (facultatif)"
              hint="Par exemple : classique, sport, enfant."
              :control-id="FIELD_IDS.style"
              :maxlength="STYLE_MAX"
              :error="errors.style ?? null"
            />
            <TextField
              v-model="form.displayOrder"
              label="Ordre d’affichage"
              hint="0 s’affiche en premier."
              inputmode="numeric"
              :control-id="FIELD_IDS.displayOrder"
              :error="errors.displayOrder ?? null"
            />
          </div>
          <CheckboxField
            v-model="form.showPrice"
            label="Montrer le prix de vente au public"
            hint="Décoché : le public ne voit aucun prix."
          />
          <div class="flex flex-wrap gap-3">
            <AppButton
              type="submit"
              :pending="saving"
              pending-label="Enregistrement en cours…"
              :disabled="mediaBusy"
              >{{
                editing === null
                  ? 'Enregistrer la fiche en brouillon'
                  : 'Enregistrer les modifications'
              }}</AppButton
            >
            <AppButton v-if="editing !== null" variant="ghost" :disabled="busy" @click="cancelEdit"
              >Annuler la modification</AppButton
            >
          </div>
        </form>
      </section>
    </section>

    <section aria-labelledby="titre-contenus" class="space-y-4">
      <h2 id="titre-contenus" class="text-xl font-semibold">Contenus du site</h2>
      <p class="max-w-prose text-sm text-muted">
        Un brouillon par contenu. Publier un brouillon archive la version précédemment publiée : le
        public ne voit jamais deux versions.
      </p>
      <SalesReadMessage
        v-if="contentsMessage"
        :state="contentsRead.state.value"
        subject="les contenus du site"
        :error="contentsRead.error.value"
        @retry="contentsRead.reload()"
      />
      <ul v-else class="space-y-3">
        <SiteContentCard
          v-for="entry in contents"
          :key="contentKey(entry)"
          :entry="entry"
          :busy="busy"
          @save="(values) => saveContent(entry, values)"
          @publish="changeContentStatus(entry, 'PUBLISHED')"
          @archive="changeContentStatus(entry, 'ARCHIVED')"
        />
      </ul>
    </section>

    <PasswordConfirmDialog
      :open="command.askingPassword.value"
      action="Publier, retirer ou archiver un contenu du site public"
      @confirmed="passwordConfirmed"
      @cancel="command.askingPassword.value = false"
    />
  </section>
</template>
