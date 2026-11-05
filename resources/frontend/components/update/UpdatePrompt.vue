<script setup lang="ts">
/**
 * Bandeau d'annonce d'une nouvelle version de l'application (O06) : jamais installée d'office, mais impossible à manquer.
 * Il est collé en haut de CHAQUE écran (connexion et déverrouillage compris) tant qu'une version attend, et ne peut pas
 * être masqué : seuls ses détails se replient. Le 2026-10-30, un bandeau discret en haut de la page n'avait été ni compris
 * ni cliqué, et le navigateur affichait l'ancienne version sans que la personne le sache.
 *
 * Le contrôle du poste dit ce qui bloque (pièces en attente que la nouvelle version ne reprendrait plus, serveur
 * injoignable avec des pièces en attente) ou ce qui demande une confirmation (pièces en attente, profil verrouillé,
 * export ancien, stockage presque plein). « Installer » n'est possible que sans blocage. Rien n'est purgé.
 */
import { computed, ref, watchEffect } from 'vue'

import {
  appUpdateState,
  applyUpdate,
  refreshUpdateReadiness,
  reloadApplication,
  toggleUpdateDetails,
} from '@/app/services/appUpdate'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'

const state = appUpdateState
const confirming = ref(false)
const message = ref<string | null>(null)

const visible = computed(() => state.value.available || state.value.reloadNeeded)
const readiness = computed(() => state.value.readiness)
const blocked = computed(() => readiness.value?.decision === 'BLOCKED')
const blocking = computed(() =>
  (readiness.value?.reasons ?? []).filter((reason) => reason.blocking),
)
const warnings = computed(() =>
  (readiness.value?.reasons ?? []).filter((reason) => !reason.blocking),
)
/** Les détails s'ouvrent d'eux-mêmes quand il faut lire avant de confirmer ou qu'un refus est expliqué. */
const detailsOpen = computed(
  () => state.value.expanded || confirming.value || state.value.installStalled,
)

/**
 * Un défilement ou un focus ne doit pas laisser un champ caché derrière le bandeau collé en haut : la page réserve la
 * place du bandeau (`html.has-update-banner`, styles/base.css).
 */
watchEffect((onCleanup) => {
  if (typeof document === 'undefined' || !visible.value) return
  document.documentElement.classList.add('has-update-banner')
  onCleanup(() => document.documentElement.classList.remove('has-update-banner'))
})

async function install(): Promise<void> {
  message.value = null
  const outcome = await applyUpdate(confirming.value)
  if (outcome === 'NEEDS_CONFIRMATION') {
    confirming.value = true
    message.value = 'Lisez les points ci-dessous, puis confirmez l’installation.'
  } else if (outcome === 'BLOCKED') {
    message.value = 'L’installation est bloquée tant que le point signalé en rouge n’est pas réglé.'
  } else if (outcome === 'UNAVAILABLE') {
    message.value =
      'La nouvelle version n’est pas prête dans ce navigateur : rechargez la page plus tard.'
  }
}

function cancelConfirmation(): void {
  confirming.value = false
  message.value = null
}
</script>

<template>
  <section
    v-if="visible"
    aria-labelledby="titre-mise-a-jour"
    class="sticky top-0 z-40 border-b-4 border-gold bg-gold-soft text-ink shadow-raised print:hidden"
    role="region"
  >
    <div class="mx-auto w-full max-w-7xl space-y-2 px-4 py-3 sm:px-6">
      <!-- Une autre fenêtre a installé la nouvelle version : cette page garde l'ancien code et doit être rechargée. -->
      <template v-if="state.reloadNeeded">
        <h2 id="titre-mise-a-jour" class="flex items-center gap-2 font-semibold">
          <AppIcon name="alert" class="text-gold-ink" />Cette page doit être rechargée
        </h2>
        <p class="text-sm">
          L’application a été mise à jour dans une autre fenêtre. Rechargez cette page pour utiliser
          la nouvelle version : rien n’est supprimé, les pièces enregistrées sur ce poste sont
          conservées.
        </p>
        <div class="flex flex-wrap gap-3">
          <AppButton variant="primary" @click="reloadApplication()">Recharger la page</AppButton>
        </div>
      </template>

      <template v-else>
        <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h2
            id="titre-mise-a-jour"
            class="flex min-w-0 flex-1 items-center gap-2 font-semibold sm:text-lg"
          >
            <AppIcon name="refresh" class="shrink-0 text-gold-ink" /><span
              >Une nouvelle version de l’application est prête</span
            >
          </h2>
          <div class="flex w-full flex-wrap gap-2 sm:w-auto">
            <AppButton
              variant="primary"
              :disabled="blocked || state.checking"
              :pending="state.applying"
              pending-label="Installation…"
              @click="install"
              >{{
                confirming ? 'Confirmer l’installation' : 'Installer la nouvelle version'
              }}</AppButton
            >
            <AppButton v-if="confirming" variant="secondary" @click="cancelConfirmation()"
              >Annuler</AppButton
            >
            <AppButton
              v-else
              variant="secondary"
              :expanded="detailsOpen"
              controls="details-mise-a-jour"
              @click="toggleUpdateDetails()"
              >{{ detailsOpen ? 'Masquer les détails' : 'Voir les détails' }}</AppButton
            >
            <AppButton
              v-if="blocked"
              variant="ghost"
              :disabled="state.checking"
              @click="refreshUpdateReadiness()"
              >Vérifier de nouveau</AppButton
            >
          </div>
        </div>

        <p class="text-sm">
          Vous utilisez encore l’ancienne version : les corrections récentes ne s’affichent pas tant
          que vous ne l’installez pas.
        </p>

        <!-- Réponse au dernier clic (points à lire, blocage, version pas prête) : AVANT les points qu'elle annonce. -->
        <p v-if="message" role="status" class="text-sm font-medium">{{ message }}</p>

        <p v-if="state.checking" class="text-sm">Vérification des pièces de ce poste…</p>
        <p
          v-else-if="readiness && readiness.decision === 'FREE'"
          class="text-sm"
          data-readiness="free"
        >
          Aucune pièce n’attend sur ce poste : vous pouvez installer la nouvelle version.
        </p>
        <ul
          v-if="blocking.length > 0"
          class="list-disc space-y-1 pl-5 text-sm font-medium text-danger"
        >
          <li v-for="reason in blocking" :key="reason.code">{{ reason.message }}</li>
        </ul>

        <div v-if="detailsOpen" id="details-mise-a-jour" class="space-y-2 text-sm">
          <ul v-if="warnings.length > 0" class="list-disc space-y-1 pl-5">
            <li v-for="reason in warnings" :key="reason.code">{{ reason.message }}</li>
          </ul>
          <dl class="grid gap-x-4 gap-y-1 sm:grid-cols-[max-content_1fr]">
            <dt class="font-semibold">Ce que fait l’installation</dt>
            <dd>
              Elle recharge cette page avec la nouvelle version, en quelques secondes. Rien n’est
              installé sans votre accord.
            </dd>
            <dt class="font-semibold">Ce qu’elle ne fait pas</dt>
            <dd>
              Elle ne supprime rien : ni les pièces enregistrées sur ce poste, ni les profils, ni le
              coffre. Vous restez connecté au serveur.
            </dd>
            <dt class="font-semibold">Après le rechargement</dt>
            <dd>
              Si ce poste était déverrouillé, il est de nouveau verrouillé : saisissez votre secret
              local pour reprendre.
            </dd>
            <dt class="font-semibold">Avant d’installer</dt>
            <dd>
              Terminez ou enregistrez la saisie en cours, et fermez les autres onglets de
              l’application.
            </dd>
          </dl>
        </div>

        <div v-if="state.installStalled" role="alert" class="space-y-2 text-sm font-medium">
          <p>L’installation n’a pas abouti. Rechargez la page, puis recommencez.</p>
          <AppButton variant="secondary" @click="reloadApplication()">Recharger la page</AppButton>
        </div>
        <p v-if="state.applying" role="status" class="text-sm font-medium">
          La page va se recharger dans un instant.
        </p>
      </template>
    </div>
  </section>
</template>
