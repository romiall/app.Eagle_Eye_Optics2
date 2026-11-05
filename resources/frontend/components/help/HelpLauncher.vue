<script setup lang="ts">
/**
 * Bouton « Aide » de l'en-tête et son panneau (docs/implementation/help.md) : la fiche de l'écran en cours,
 * lue sans formation, sans rien ajouter aux écrans. Le panneau reste FERMÉ tant que la personne ne le demande
 * pas : aucun bandeau, aucune pastille, aucun stockage navigateur ; le contenu de l'aide n'est même pas chargé
 * avant le premier clic (import dynamique, `loadPageHelp`).
 *
 * Le panneau est un `<dialog>` natif ouvert par showModal() (comme `ConfirmDialog`) : le reste de la page
 * devient inerte, Échap le ferme, le focus ne s'échappe pas. Il se présente en feuille à droite (plein écran
 * sur téléphone). À l'ouverture, le focus va sur le titre de la fiche (un lecteur d'écran l'annonce) ; à la
 * fermeture, il retourne là où il était (le bouton « Aide », ou l'élément qui avait le focus quand la touche ?
 * a ouvert l'aide). Un clic sur le fond, « Fermer », Échap ou un lien interne cliqué le referment.
 *
 * Contenu : la fiche de la route en cours (`pageHelpFor(route.name)`, suivie si la route change), filtrée par
 * les droits du compte ; les écrans cités dans « Ensuite » sont proposés comme l'accueil les propose
 * (`useHelpLinkState` : un écran fermé ou interdit n'est pas montré, un écran qui demande le serveur est
 * nommé sans lien en session locale). Les droits ne servent qu'à choisir ce que l'on décrit : le serveur
 * revérifie chaque action. Le contenu vient du paquet de l'application, jamais du serveur : le panneau
 * s'ouvre donc aussi sur un poste préparé dont le serveur est arrêté (l'écran « Documentation » est ouvert
 * hors ligne).
 *
 * Pied du panneau : recherche dans la documentation (envoie vers l'écran « Documentation » avec `?q=`) et lien
 * « Toute la documentation ». Raccourci : la touche ? ouvre ou ferme l'aide, sauf dans un champ de saisie (où
 * le point d'interrogation est un caractère) et par-dessus une autre boîte de dialogue.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, useId } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

import { currentPermissions } from '@/app/session'
import { controlClasses } from '@/components/form/classes'
import PageHelpView from '@/components/help/PageHelpView.vue'
import { useHelpLinkState } from '@/components/help/useHelpLinks'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { loadPageHelp } from '@/domain/help/loader'
import { queryWords } from '@/domain/help/search'

type Pages = Awaited<ReturnType<typeof loadPageHelp>>
/** `idle` : rien n'a encore été demandé ; `loading` : contenu en route ; `ready` : fiches disponibles. */
type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'

const route = useRoute()
const router = useRouter()
const linkState = useHelpLinkState()

const uid = useId()
const labelId = `${uid}-etiquette`
const searchId = `${uid}-recherche`
const searchErrorId = `${uid}-recherche-erreur`

const trigger = ref<{ $el: HTMLElement } | null>(null)
const dialog = ref<HTMLDialogElement | null>(null)
const title = ref<HTMLElement | null>(null)
const searchField = ref<HTMLInputElement | null>(null)

const open = ref(false)
/**
 * Le `<dialog>` n'existe dans la page qu'après la première demande d'aide : un écran qui cherche « sa » boîte de
 * dialogue (confirmation d'un doublon, fin d'un examen) ne tombe jamais sur celle de l'en-tête, qui précède le
 * contenu dans le document.
 */
const mounted = ref(false)
const status = ref<LoadStatus>('idle')
const pages = shallowRef<Pages | null>(null)
const query = ref('')
const searchError = ref<string | null>(null)

/** Élément qui avait le focus à l'ouverture : il le retrouve à la fermeture. */
let opener: HTMLElement | null = null

/**
 * Ce que le bouton annonce : une boîte de dialogue (ouverte ou non) et son raccourci. `AppButton` ne déclare
 * pas ces attributs, il les laisse tomber sur son `<button>` ; le typage strict des gabarits les refuse écrits
 * un par un sur le composant, d'où cet objet.
 */
const triggerAttributes = computed(() => ({
  'aria-haspopup': 'dialog',
  'aria-expanded': open.value ? 'true' : 'false',
  'aria-keyshortcuts': '?',
}))

/** Fiche de l'écran en cours (absente : écran sans fiche, ou contenu pas encore chargé). */
const help = computed(() => pages.value?.pageHelpFor(route.name))

/** Titre de l'en-tête du panneau : celui de la fiche, sinon celui de l'écran (visible dès le premier clic). */
const heading = computed(() => {
  if (help.value !== undefined) return help.value.title
  return typeof route.meta.title === 'string' ? route.meta.title : 'Cet écran'
})

async function load(): Promise<void> {
  if (status.value === 'loading') return
  status.value = 'loading'
  try {
    pages.value = await loadPageHelp()
    status.value = 'ready'
  } catch {
    status.value = 'error'
  }
}

function triggerElement(): HTMLElement | null {
  return trigger.value?.$el ?? null
}

/** Élément qui a le focus dans la page (hors `body`), rendu après l'aide ouverte par la touche ?. */
function focusedElement(): HTMLElement | null {
  const active = document.activeElement
  return active instanceof HTMLElement && active !== document.body ? active : null
}

async function show(origin: HTMLElement | null): Promise<void> {
  opener = origin ?? triggerElement()
  if (!mounted.value) {
    mounted.value = true
    await nextTick()
  }
  const element = dialog.value
  if (element === null) return
  query.value = ''
  searchError.value = null
  open.value = true
  if (!element.open) {
    try {
      if (typeof element.showModal === 'function') element.showModal()
      else element.setAttribute('open', '')
    } catch {
      element.setAttribute('open', '')
    }
  }
  // Premier clic, ou nouvel essai après une erreur : le contenu est chargé à la demande.
  if (status.value === 'idle' || status.value === 'error') void load()
  void nextTick(() => title.value?.focus())
}

/** Le panneau est fermé (par nous ou par le navigateur) : l'état suit, le focus revient. */
function settle(): void {
  if (!open.value) return
  open.value = false
  const target = opener !== null && opener.isConnected ? opener : triggerElement()
  opener = null
  target?.focus()
}

function hide(): void {
  const element = dialog.value
  if (element !== null && element.open) {
    if (typeof element.close === 'function') element.close()
    else element.removeAttribute('open')
  }
  settle()
}

function toggle(origin: HTMLElement | null): void {
  if (open.value) hide()
  else void show(origin)
}

function onTriggerClick(): void {
  toggle(triggerElement())
}

/** Échap : la fermeture native est reprise à notre compte (état, focus). */
function onCancel(event: Event): void {
  event.preventDefault()
  hide()
}

/**
 * Le navigateur peut fermer la boîte sans « cancel » annulable (Échap répété sans geste, règle anti-abus
 * de Chromium) : l'état et le focus suivent quand même. L'événement « close » arrive après la fermeture : si
 * la boîte a été rouverte entre-temps, c'est celui de la fermeture précédente et il est ignoré.
 */
function onNativeClose(): void {
  if (dialog.value?.open === true) return
  settle()
}

/**
 * Clic sur le fond : seul un geste commencé ET terminé sur le fond ferme le panneau (glisser une sélection de
 * texte du panneau vers le fond ne le ferme pas). Le contenu occupe toute la feuille : une cible `dialog` est
 * toujours le fond.
 */
let pressedOnBackdrop = false

function onDialogPointerDown(event: Event): void {
  pressedOnBackdrop = event.target === dialog.value
}

function onDialogClick(event: MouseEvent): void {
  const onBackdrop = pressedOnBackdrop && event.target === dialog.value
  pressedOnBackdrop = false
  if (onBackdrop) hide()
}

/** Un clic simple sur un lien interne ferme le panneau ; ouvrir dans un autre onglet le laisse en place. */
function onLinkClick(event: MouseEvent): void {
  if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
  hide()
}

/** Champ où le point d'interrogation est un caractère à saisir, jamais un raccourci. */
const TYPING_FIELD =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="searchbox"], [role="combobox"]'

function isTypingField(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(TYPING_FIELD) !== null
}

/** Une autre boîte de dialogue est ouverte (confirmation, reconnexion) : l'aide ne s'ouvre pas par-dessus. */
function anotherDialogIsOpen(): boolean {
  return Array.from(document.querySelectorAll('dialog[open]')).some(
    (other) => other !== dialog.value,
  )
}

/** La touche ? (Maj admis : c'est ainsi qu'on la tape sur la plupart des claviers) ouvre ou ferme l'aide. */
function onKeydown(event: KeyboardEvent): void {
  if (event.key !== '?' || event.ctrlKey || event.altKey || event.metaKey) return
  if (event.defaultPrevented || event.repeat || event.isComposing) return
  if (isTypingField(event.target) || anotherDialogIsOpen()) return
  event.preventDefault()
  toggle(focusedElement())
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

/**
 * Recherche dans la documentation : sans mot d'au moins 2 caractères, elle est refusée avec un message ; sinon
 * le panneau se ferme et l'écran « Documentation » s'ouvre sur les résultats (`?q=`).
 */
async function submitSearch(): Promise<void> {
  const text = query.value.trim().replace(/\s+/g, ' ')
  if (queryWords(text).length === 0) {
    searchError.value = 'Saisissez au moins 2 caractères pour lancer la recherche.'
    searchField.value?.focus()
    return
  }
  searchError.value = null
  hide()
  await router.push({ name: 'aide', query: { q: text } })
}
</script>

<template>
  <AppButton ref="trigger" variant="ghost" v-bind="triggerAttributes" @click="onTriggerClick"
    ><AppIcon name="help" :size="18" />Aide</AppButton
  >
  <dialog
    v-if="mounted"
    ref="dialog"
    data-help-panel
    :aria-labelledby="labelId"
    tabindex="-1"
    class="fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-none w-[34rem] max-w-full overflow-hidden bg-surface p-0 text-ink shadow-raised backdrop:bg-ink/40"
    @cancel="onCancel"
    @close="onNativeClose"
    @pointerdown="onDialogPointerDown"
    @click="onDialogClick"
  >
    <div v-if="open" class="flex h-full min-h-0 flex-col border-l-4 border-l-gold">
      <div
        class="flex shrink-0 items-start justify-between gap-3 border-b border-line px-4 py-3 sm:px-5"
      >
        <div class="min-w-0">
          <p :id="labelId" class="text-sm font-medium text-muted">Aide de cette page</p>
          <h2
            ref="title"
            tabindex="-1"
            class="text-lg leading-7 font-semibold break-words focus:outline-none"
          >
            {{ heading }}
          </h2>
        </div>
        <AppButton variant="secondary" class="shrink-0" @click="hide"
          ><AppIcon name="x" :size="18" />Fermer</AppButton
        >
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
        <p
          v-if="status === 'loading' || status === 'idle'"
          role="status"
          aria-live="polite"
          class="text-muted"
        >
          Chargement de l’aide…
        </p>
        <div v-else-if="status === 'error'" class="space-y-3">
          <p role="alert" class="flex items-start gap-2 font-medium text-danger">
            <AppIcon name="alert" :size="18" class="mt-1" />
            <span>L’aide n’a pas pu être chargée. Réessayez.</span>
          </p>
          <AppButton variant="secondary" @click="load"
            ><AppIcon name="refresh" :size="18" />Réessayer</AppButton
          >
        </div>
        <PageHelpView
          v-else-if="help !== undefined"
          :help="help"
          :permissions="currentPermissions"
          :level="3"
          :link-state="linkState"
          @navigate="hide"
        />
        <p v-else class="flex items-start gap-2">
          <AppIcon name="info" :size="18" class="mt-1 text-primary" />
          <span>Cet écran n’a pas encore de fiche d’aide.</span>
        </p>
      </div>

      <div
        class="max-h-[45dvh] shrink-0 space-y-3 overflow-y-auto border-t border-line bg-canvas px-4 py-3 sm:px-5"
      >
        <form
          role="search"
          aria-label="Chercher dans la documentation"
          novalidate
          @submit.prevent="submitSearch"
        >
          <label :for="searchId" class="field-label block">Chercher dans la documentation</label>
          <div class="flex items-start gap-2">
            <input
              :id="searchId"
              ref="searchField"
              v-model="query"
              type="search"
              inputmode="search"
              autocomplete="off"
              :aria-invalid="searchError === null ? undefined : 'true'"
              :aria-describedby="searchError === null ? undefined : searchErrorId"
              :class="controlClasses(searchError !== null, 'min-w-0 flex-1')"
            />
            <AppButton type="submit" variant="secondary" class="shrink-0"
              ><AppIcon name="search" :size="18" />Chercher</AppButton
            >
          </div>
          <p
            v-if="searchError !== null"
            :id="searchErrorId"
            class="mt-1.5 flex items-start gap-1.5 text-sm leading-5 font-medium text-danger"
          >
            <span aria-hidden="true" class="shrink-0">⚠ </span><span>{{ searchError }}</span>
          </p>
        </form>
        <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <RouterLink
            :to="{ name: 'aide' }"
            class="text-link inline-flex min-h-11 items-center gap-2 font-medium"
            @click="onLinkClick"
          >
            <AppIcon name="arrow-right" :size="16" class="text-gold" />
            <span>Toute la documentation</span>
          </RouterLink>
          <p class="text-sm text-muted">
            La touche
            <kbd class="rounded border border-field bg-surface px-1.5 font-mono text-ink">?</kbd>
            ouvre cette aide.
          </p>
        </div>
      </div>
    </div>
  </dialog>
</template>
