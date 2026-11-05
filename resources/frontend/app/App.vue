<script setup lang="ts">
/**
 * Coquille de l'application (fichier 04) : en-tête « EAGLE’S EYE OPTICS MEDICAL – GESTION DES
 * PATIENTS » (lien vers l'accueil), état réseau, compte connecté ; navigation des seuls modules
 * livrés et autorisés (barre latérale sur ordinateur ; raccourcis Aujourd'hui, Patients, Agenda et
 * « Plus » sur téléphone) ; lien d'évitement vers le contenu. Sans module livré, aucune navigation
 * n'est affichée : l'accueil le dit.
 *
 * Le titre est écrit en casse normale et affiché en capitales par le style : les lecteurs d'écran le
 * lisent comme des mots, pas lettre par lettre. La recherche rapide de l'en-tête arrive avec la
 * recherche de patients (P02). L'état de synchronisation du poste (F10) s'affiche dès qu'un poste
 * préparé le fournit (journal du poste, O04, O05) ; il est distinct de l'état du réseau.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch, watchEffect } from 'vue'
import {
  isNavigationFailure,
  NavigationFailureType,
  RouterLink,
  RouterView,
  useRoute,
  useRouter,
} from 'vue-router'

import logoUrl from '@/assets/brand/eeo-logo.svg'
import NetworkStatus from '@/components/feedback/NetworkStatus.vue'
import HelpLauncher from '@/components/help/HelpLauncher.vue'
import ReauthDialog from '@/components/session/ReauthDialog.vue'
import SyncStatus from '@/components/SyncStatus.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import UpdatePrompt from '@/components/update/UpdatePrompt.vue'

import { useNavigationCatalog, visibleModules } from './navigation'
import { iconOf } from './navigationIcons'
import { probeServer, useNetworkStatus } from './network'
import { entryRoute, lockLocalProfile, vaultNeedsUnlock } from './services/localIdentity'
import { identityDiverges, vaultView } from './services/vault'
import {
  currentPermissions,
  enabledModules,
  refreshSession,
  revalidateSession,
  session,
  signOut,
} from './session'

const route = useRoute()
const router = useRouter()
const catalog = useNavigationCatalog()
const { online, serverReachable } = useNetworkStatus()

/** Une identité d'action est connue : le compte du serveur, ou, sans serveur, le profil du coffre (D27). */
const signedIn = computed(
  () =>
    (session.status === 'authenticated' || session.status === 'local') && session.account !== null,
)
/** Session locale : le profil du coffre fait foi, le serveur n'est pas joint (ou n'a pas de session). */
const localMode = computed(() => session.status === 'local')
/** Coffre ouvert dans cet onglet : le poste peut être verrouillé sans quitter le serveur. */
const vaultOpen = computed(() => vaultView.value.session !== null)
/** Coffre ouvert au nom d'un autre compte que celui du serveur : rien n'est écrit sur le poste (D27). */
const diverges = computed(() => identityDiverges())
/** Aucune identité et un coffre à ouvrir : la coquille métier est démontée, seul le déverrouillage reste (D14). */
const unlockRequired = computed(() => vaultNeedsUnlock())
/** Session perdue pendant le travail : l'écran et ses saisies restent, la reconnexion se fait sur place. */
const sessionExpired = computed(() => session.status === 'expired' && route.meta.public !== true)
const reconnecting = ref(false)
const modules = computed(() => {
  if (!signedIn.value || route.meta.public === true) return []
  const visible = visibleModules(currentPermissions.value, enabledModules.value, catalog.modules)
  // Session locale : seuls les modules dont l'écran d'entrée sait travailler sans le serveur.
  return localMode.value
    ? visible.filter((module) => router.resolve(module.path).meta.offlineCapable === true)
    : visible
})
const shortcuts = computed(() => modules.value.filter((module) => module.mobileShortcut))
const others = computed(() => modules.value.filter((module) => !module.mobileShortcut))

const moreMenu = ref<HTMLDetailsElement | null>(null)
const logoutError = ref<string | null>(null)
const loggingOut = ref(false)

function closeMoreMenu(returnFocus: boolean): void {
  const menu = moreMenu.value
  if (menu === null || !menu.open) return
  menu.open = false
  if (returnFocus) menu.querySelector('summary')?.focus()
}

// Le menu « Plus » se referme dès qu'un écran est ouvert ; un message de déconnexion ancien disparaît.
watch(
  () => route.fullPath,
  () => {
    closeMoreMenu(false)
    logoutError.value = null
  },
)

function skipToContent(): void {
  document.getElementById('contenu')?.focus()
}

/**
 * Session non vérifiable au démarrage (serveur muet ou en erreur) : elle est relue quand le réseau
 * revient, puis toutes les 30 secondes (aucune conclusion tirée entre-temps).
 */
const SESSION_RETRY_MS = 30_000

async function recheckSession(): Promise<void> {
  if (session.status !== 'unverified' && session.status !== 'local') return
  const status = await refreshSession().catch(() => session.status)
  // Aucun compte n'a jamais été connu sur cet écran (donc aucune saisie à protéger) : l'entrée s'ouvre
  // (déverrouillage du poste s'il a un coffre, sinon connexion). Une session expirée, elle, laisse l'écran et
  // ses saisies en place (bannière). La session locale, elle, n'est jamais quittée par cette relecture.
  if (status === 'anonymous' && route.meta.public !== true) {
    await router.push(entryRoute(route.path))
  }
}

/** Coffre verrouillé (inactivité, autre onglet, bouton) sans identité : la coquille est démontée (D14). */
watch(unlockRequired, (required) => {
  if (required && route.meta.public !== true) void router.push(entryRoute(route.path))
})

/** Verrouille le poste sans quitter la session du serveur ; sans identité, l'écran de déverrouillage s'ouvre. */
async function lockStation(): Promise<void> {
  await lockLocalProfile('USER')
  if (vaultNeedsUnlock()) await router.push(entryRoute('/'))
}

watch(online, (isOnline) => {
  if (!isOnline) return
  void probeServer()
  void recheckSession()
})

/**
 * Joignabilité du serveur vérifiée par requête, pas seulement par `navigator.onLine` : toutes les
 * 30 secondes quand le serveur ne répond pas (l'en-tête redevient « En ligne » à son retour), toutes
 * les 60 secondes sinon (une liaison Internet perdue n'est pas affichée « En ligne » sans limite).
 */
const PROBE_UNREACHABLE_MS = 30_000
const PROBE_REACHABLE_MS = 60_000

watchEffect((onCleanup) => {
  if (!online.value) return
  const delay = serverReachable.value === false ? PROBE_UNREACHABLE_MS : PROBE_REACHABLE_MS
  const timer = setInterval(() => void probeServer(), delay)
  onCleanup(() => clearInterval(timer))
})

watchEffect((onCleanup) => {
  if (session.status !== 'unverified' && session.status !== 'local') return
  const timer = setInterval(() => void recheckSession(), SESSION_RETRY_MS)
  onCleanup(() => clearInterval(timer))
})

/**
 * Retour sur l'onglet : la session est relue (autre onglet connecté à un autre compte, session
 * expirée). Seule une réponse explicite 401 ou 419 la fait passer en « expirée » ; un réseau coupé
 * ou une erreur du serveur ne la dégradent jamais (le poste hors ligne continue de travailler).
 * Aucune navigation n'est provoquée : une saisie en cours reste à l'écran et la reconnexion se fait
 * sur place (`ReauthDialog`).
 */
function onReturnToTab(): void {
  if (document.visibilityState !== 'visible' || session.status !== 'authenticated') return
  void revalidateSession().catch(() => undefined)
}

onMounted(() => {
  document.addEventListener('visibilitychange', onReturnToTab)
  window.addEventListener('focus', onReturnToTab)
})

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onReturnToTab)
  window.removeEventListener('focus', onReturnToTab)
})

/**
 * Déconnexion : l'écran en cours est d'abord quitté (sa garde de saisie peut refuser : la session
 * reste alors ouverte et la saisie intacte), puis la session est fermée par le serveur, et la
 * connexion ne s'affiche qu'après sa confirmation (voir signOut).
 */
async function logout(): Promise<void> {
  logoutError.value = null
  const left = await router.push({ name: 'accueil' })
  if (isNavigationFailure(left, NavigationFailureType.aborted)) return
  loggingOut.value = true
  try {
    // D15 : le verrouillage local passe en premier, sans réseau. En session locale, il n'y a pas de session serveur à
    // fermer : le poste se verrouille et s'arrête là. Sinon la déconnexion du serveur suit, et elle seule confirme.
    const serverSession = session.status !== 'local'
    if (vaultOpen.value) await lockLocalProfile('LOGOUT')
    if (serverSession) await signOut()
    await router.push(entryRoute('/'))
  } catch {
    logoutError.value =
      'Déconnexion impossible : le serveur n’a pas confirmé la fermeture. La session reste ouverte sur ce poste ; réessayez quand la connexion revient.'
  } finally {
    loggingOut.value = false
  }
}

/**
 * Entrée de navigation : icône décorative et libellé ; l'entrée active (`aria-current="page"`) est
 * marquée par un fond doré léger, un filet doré à gauche et le gras (jamais la couleur seule).
 */
const linkClass =
  'flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-base font-medium text-ink transition-colors hover:bg-primary-soft aria-[current=page]:bg-primary-soft aria-[current=page]:font-semibold aria-[current=page]:text-primary aria-[current=page]:shadow-[inset_3px_0_0_var(--color-gold)]'
/** Entrée de la barre du téléphone : icône au-dessus du libellé, filet doré en haut pour l'active. */
const barLinkClass =
  'flex min-h-14 min-w-16 flex-col items-center justify-center gap-0.5 rounded-lg px-2 py-1 text-xs font-medium text-ink transition-colors hover:bg-primary-soft aria-[current=page]:bg-primary-soft aria-[current=page]:font-semibold aria-[current=page]:text-primary aria-[current=page]:shadow-[inset_0_3px_0_var(--color-gold)]'

/** Initiales du compte connecté (pastille décorative à côté du nom). */
const initials = computed(() =>
  (session.account?.display_name ?? '')
    .split(/\s+/)
    .filter((part) => /^\p{L}/u.test(part))
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join(''),
)
</script>

<template>
  <a
    href="#contenu"
    class="sr-only rounded-lg bg-primary px-4 py-2 text-primary-contrast focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50"
    @click.prevent="skipToContent"
    >Aller au contenu</a
  >
  <div class="flex min-h-screen flex-col">
    <header class="border-b border-line bg-surface shadow-card">
      <div aria-hidden="true" class="h-1 bg-gold"></div>
      <div
        class="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 sm:px-6"
      >
        <RouterLink
          v-if="signedIn"
          to="/"
          class="order-1 inline-flex min-h-11 items-center gap-3 rounded-lg pr-2 text-sm font-bold tracking-[0.12em] text-ink uppercase"
          ><img :src="logoUrl" alt="" width="52" height="57" class="h-12 w-auto sm:h-14" /><span
            class="sr-only flex-col leading-tight sm:not-sr-only sm:flex"
            ><span>Eagle’s Eye Optics Medical</span><span class="sr-only"> – </span
            ><span class="text-xs font-semibold tracking-[0.18em] text-gold-ink"
              >Gestion des patients</span
            ></span
          ><span class="sr-only"> (accueil)</span></RouterLink
        >
        <p
          v-else
          class="order-1 inline-flex min-h-11 items-center gap-3 text-sm font-bold tracking-[0.12em] text-ink uppercase"
        >
          <img
            v-if="route.meta.public !== true"
            :src="logoUrl"
            alt=""
            width="52"
            height="57"
            class="h-12 w-auto sm:h-14"
          /><span class="flex flex-col leading-tight"
            ><span>Eagle’s Eye Optics Medical</span><span class="sr-only"> – </span
            ><span class="text-xs font-semibold tracking-[0.18em] text-gold-ink"
              >Gestion des patients</span
            ></span
          >
        </p>
        <!--
          Ordre visuel : sur téléphone, ligne 1 = logo, compte, état du réseau ; ligne 2 = « Aide » et
          « Se déconnecter », visibles avec leur texte. Sur écran large : logo, état, compte, actions.
          L'ordre du DOM (donc du clavier) suit l'ordre visuel dans les deux cas.
        -->
        <div
          v-if="signedIn && session.account"
          class="order-2 flex min-w-0 flex-1 items-center justify-end gap-2 sm:order-3 sm:flex-none"
        >
          <span
            v-if="initials"
            aria-hidden="true"
            class="flex size-9 shrink-0 items-center justify-center rounded-full border border-gold bg-gold-soft text-sm font-semibold text-gold-ink"
            >{{ initials }}</span
          >
          <p class="min-w-0 truncate text-sm font-medium text-ink sm:max-w-48">
            <span class="sr-only">Compte connecté : </span>{{ session.account.display_name }}
          </p>
        </div>
        <div class="order-3 ml-auto flex flex-wrap items-center gap-x-3 gap-y-2 sm:order-2">
          <NetworkStatus />
          <SyncStatus />
          <p
            v-if="localMode"
            role="status"
            class="flex items-center gap-1 text-sm font-medium text-warning"
          >
            <span aria-hidden="true">○</span><span>Profil local : serveur non joint</span>
          </p>
          <RouterLink
            v-if="localMode && online"
            :to="{ name: 'connexion' }"
            class="inline-flex min-h-11 items-center rounded-lg px-2 text-sm font-medium text-primary underline underline-offset-4 hover:bg-primary-soft"
            >Se connecter au serveur</RouterLink
          >
          <p
            v-if="diverges"
            role="alert"
            class="flex items-center gap-1 text-sm font-medium text-danger"
          >
            <span aria-hidden="true">⚠</span
            ><span
              >Le coffre est ouvert au nom d’un autre compte que celui du serveur : rien n’est
              enregistré sur le poste. Verrouillez le poste.</span
            >
          </p>
          <p
            v-if="sessionExpired"
            role="status"
            class="flex items-center gap-1 text-sm font-medium text-warning"
          >
            <span aria-hidden="true">⚠</span
            ><span>Session expirée : vos saisies sont conservées</span>
          </p>
          <AppButton v-if="sessionExpired" variant="secondary" @click="reconnecting = true"
            >Se reconnecter</AppButton
          >
        </div>
        <div
          v-if="signedIn && session.account"
          class="order-4 flex w-full flex-wrap items-center justify-between gap-2 border-t border-line pt-2 sm:w-auto sm:justify-end sm:border-t-0 sm:pt-0"
        >
          <HelpLauncher />
          <AppButton v-if="vaultOpen" variant="ghost" @click="lockStation"
            ><AppIcon name="lock" :size="18" />Verrouiller le poste</AppButton
          >
          <AppButton
            variant="ghost"
            :pending="loggingOut"
            pending-label="Déconnexion en cours…"
            @click="logout"
            ><AppIcon name="logout" :size="18" />Se déconnecter</AppButton
          >
        </div>
      </div>
    </header>

    <div class="mx-auto flex w-full max-w-7xl flex-1">
      <nav
        v-if="modules.length > 0"
        aria-label="Navigation principale"
        class="hidden w-60 shrink-0 border-r border-line bg-surface px-3 py-5 md:block"
      >
        <ul class="space-y-1">
          <li>
            <RouterLink to="/" :class="linkClass"
              ><AppIcon :name="iconOf('accueil')" class="text-gold" />Accueil</RouterLink
            >
          </li>
          <li v-for="module in modules" :key="module.id">
            <RouterLink :to="module.path" :class="linkClass"
              ><AppIcon :name="iconOf(module.id)" class="text-gold" />{{ module.label }}</RouterLink
            >
          </li>
        </ul>
      </nav>
      <main
        id="contenu"
        tabindex="-1"
        :class="[
          'w-full min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8',
          modules.length > 0 ? 'pb-28 md:pb-8' : '',
        ]"
      >
        <div
          v-if="logoutError"
          role="alert"
          class="mb-4 rounded-lg border-2 border-danger bg-danger-soft p-4 text-ink"
        >
          <span aria-hidden="true">⚠ </span>{{ logoutError }}
        </div>
        <!-- Nouvelle version proposée, jamais imposée (O06). -->
        <UpdatePrompt class="mb-4" />
        <!-- Coffre verrouillé sans identité : la coquille métier est démontée, seul le déverrouillage reste (D14). -->
        <RouterView v-if="!unlockRequired || route.meta.public === true" />
      </main>
    </div>

    <nav
      v-if="modules.length > 0"
      aria-label="Raccourcis"
      class="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface shadow-raised md:hidden"
    >
      <ul class="flex justify-around gap-1 px-2 py-1">
        <li v-for="module in shortcuts" :key="module.id">
          <RouterLink :to="module.path" :class="barLinkClass"
            ><AppIcon :name="iconOf(module.id)" :size="22" class="text-gold" />{{
              module.label
            }}</RouterLink
          >
        </li>
        <li v-if="others.length > 0" class="relative">
          <details ref="moreMenu" @keydown.esc="closeMoreMenu(true)">
            <summary :class="[barLinkClass, 'cursor-pointer list-none']">
              <AppIcon name="more" :size="22" class="text-gold" /><span>Plus</span>
            </summary>
            <ul
              class="absolute right-0 bottom-full mb-2 max-h-[min(70vh,24rem)] w-60 space-y-1 overflow-y-auto rounded-xl border border-line bg-surface p-2 shadow-raised"
            >
              <li v-for="module in others" :key="module.id">
                <RouterLink :to="module.path" :class="linkClass"
                  ><AppIcon :name="iconOf(module.id)" class="text-gold" />{{
                    module.label
                  }}</RouterLink
                >
              </li>
            </ul>
          </details>
        </li>
      </ul>
    </nav>
  </div>
  <ReauthDialog
    v-if="reconnecting && sessionExpired"
    :open="true"
    @reauthenticated="reconnecting = false"
    @cancel="reconnecting = false"
  />
</template>
