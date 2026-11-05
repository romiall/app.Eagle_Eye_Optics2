<script setup lang="ts">
/**
 * Déverrouillage du poste (vault.md D14, D27) : écran PUBLIC, avant la connexion au serveur, qui fonctionne sans
 * réseau (la coquille vient du service worker, le coffre d'IndexedDB). La personne choisit son profil (identifiant et
 * nom, jamais de donnée de santé) et ressaisit son secret local : le coffre limite les tentatives et rend un message
 * uniforme. Le profil ouvert devient l'identité d'action tant que le serveur n'en a pas une autre ; les écrans qui
 * lisent le serveur restent fermés (voir l'accueil). Le lien « Se connecter au serveur » reste offert.
 *
 * Le secret n'est jamais conservé : le champ est vidé après chaque essai. L'autorité de la personne vient de son
 * grant signé (droits figés à la préparation du poste) : sans grant valide, le profil s'ouvre sans aucun droit.
 */
import { computed, nextTick, onMounted, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

import { afterUnlockPath, unlockLocalProfile } from '@/app/services/localIdentity'
import { isVaultError, vaultView } from '@/app/services/vault'
import logoUrl from '@/assets/brand/eeo-logo.svg'
import ErrorSummary, { type FieldErrorItem } from '@/components/feedback/ErrorSummary.vue'
import StateMessage from '@/components/feedback/StateMessage.vue'
import SelectField from '@/components/form/SelectField.vue'
import TextField from '@/components/form/TextField.vue'
import PageHeader from '@/components/layout/PageHeader.vue'
import AppButton from '@/components/ui/AppButton.vue'

const PROFILE_ID = 'deverrouiller-profil'
const SECRET_ID = 'deverrouiller-secret'

const route = useRoute()
const router = useRouter()

const view = vaultView
const profileOptions = computed(() =>
  view.value.profiles.map((profile) => ({
    value: profile.profileId,
    label: `${profile.displayName} (${profile.login})`,
  })),
)
const unusable = computed(() => view.value.status === 'damaged' || view.value.status === 'too-new')

/** Un seul profil sur ce poste : il est présélectionné (la saisie du secret reste exigée). */
const profileId = ref<string | null>(
  view.value.profiles.length === 1 ? (view.value.profiles[0]?.profileId ?? null) : null,
)
const secret = ref('')
const pending = ref(false)
const fieldErrors = ref<{ profile: string | null; secret: string | null }>({
  profile: null,
  secret: null,
})
const general = ref<string | null>(null)
const summaryBox = ref<{ focus: () => Promise<void> } | null>(null)

const summary = computed<FieldErrorItem[]>(() => {
  const items: FieldErrorItem[] = []
  if (fieldErrors.value.profile !== null)
    items.push({ fieldId: PROFILE_ID, message: fieldErrors.value.profile })
  if (fieldErrors.value.secret !== null)
    items.push({ fieldId: SECRET_ID, message: fieldErrors.value.secret })
  if (items.length === 0 && general.value !== null)
    items.push({ fieldId: SECRET_ID, message: general.value })
  return items
})

/** Heure locale d'un instant (ms) : « 14:05:30 », pour dire quand une nouvelle tentative sera admise. */
function clock(instant: number): string {
  return new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(instant))
}

/** Profil bloqué par des échecs répétés : l'heure à laquelle il sera de nouveau admis (null sinon). */
const blockedUntil = computed(
  () =>
    view.value.profiles.find((profile) => profile.profileId === profileId.value)?.blockedUntil ??
    null,
)

const VAULT_MESSAGES: Record<string, string> = {
  AUTH_FAILED: 'Profil ou secret incorrect.',
  INSECURE_CONTEXT: 'Le coffre exige une connexion sécurisée (HTTPS).',
  WEBCRYPTO_SELFTEST_FAILED:
    'Ce navigateur ne permet pas de chiffrer le coffre : utilisez Chrome ou Edge à jour.',
  GRANT_INVALID: 'L’autorisation de ce profil est altérée : préparez-le de nouveau en ligne.',
  VAULT_DAMAGED: 'Le coffre de ce poste est illisible : rien n’y est modifié.',
  VAULT_FORMAT_TOO_NEW:
    'Le coffre de ce poste a été écrit par une version plus récente de l’application.',
}

/** Message d'un échec du coffre : le code stable est traduit, aucun détail technique n'est montré. */
function explain(error: unknown): string {
  if (isVaultError(error, 'AUTH_THROTTLED')) {
    const retryAt = error.detail.retryAt
    return retryAt === undefined
      ? 'Trop de tentatives : patientez avant de réessayer.'
      : `Trop de tentatives : réessayez à ${clock(retryAt)}.`
  }
  if (isVaultError(error))
    return VAULT_MESSAGES[error.code] ?? `Déverrouillage refusé (${error.code}).`
  return 'Déverrouillage impossible sur ce poste.'
}

async function submit(): Promise<void> {
  fieldErrors.value = { profile: null, secret: null }
  general.value = null
  const missingProfile = profileId.value === null
  const missingSecret = secret.value === ''
  if (missingProfile || missingSecret) {
    fieldErrors.value = {
      profile: missingProfile ? 'Choisissez votre profil.' : null,
      secret: missingSecret ? 'Saisissez votre secret local.' : null,
    }
    await summaryBox.value?.focus()
    return
  }
  if (profileId.value === null) return

  pending.value = true
  try {
    await unlockLocalProfile(profileId.value, secret.value)
    secret.value = ''
    await router.push(afterUnlockPath(route.query['suite']))
  } catch (error) {
    general.value = explain(error)
    // Le secret est toujours à ressaisir : il n'est jamais conservé après un essai.
    secret.value = ''
    await summaryBox.value?.focus()
  } finally {
    pending.value = false
  }
}

onMounted(() => {
  // Focus sur le champ utile (D14) : le secret quand le profil est connu, sinon le choix du profil.
  void nextTick(() =>
    document.getElementById(profileId.value === null ? PROFILE_ID : SECRET_ID)?.focus(),
  )
})
</script>

<template>
  <section
    aria-labelledby="titre-deverrouiller"
    class="mx-auto grid w-full max-w-4xl overflow-hidden rounded-2xl border border-line bg-surface shadow-raised md:mt-6 md:grid-cols-2"
  >
    <div
      class="flex flex-col items-center justify-center gap-4 border-b border-line bg-surface px-6 py-6 text-center sm:py-8 md:border-r md:border-b-0 md:px-10 md:py-14"
    >
      <img
        :src="logoUrl"
        alt="Eagle’s Eye Optics"
        width="380"
        height="417"
        class="h-auto w-28 sm:w-44 md:w-60"
      />
      <span aria-hidden="true" class="h-0.5 w-16 rounded-full bg-gold"></span>
      <p class="max-w-xs text-sm font-medium text-muted">Espace réservé au personnel du cabinet</p>
    </div>
    <div class="space-y-6 bg-canvas px-6 py-8 sm:px-8 md:px-10 md:py-14">
      <PageHeader
        title-id="titre-deverrouiller"
        title="Déverrouiller ce poste"
        subtitle="Choisissez votre profil et saisissez votre secret local. Aucune connexion au réseau n’est nécessaire."
      />

      <StateMessage v-if="unusable" state="error" title="Coffre illisible">
        Le coffre de ce poste est endommagé ou écrit par une version plus récente de l’application :
        rien n’y est modifié. Contactez le support avant toute réinstallation.
      </StateMessage>

      <template v-else-if="profileOptions.length === 0">
        <StateMessage state="empty" title="Aucun profil sur ce poste">
          Ce poste n’a pas encore de profil préparé. Connectez-vous au serveur pour continuer.
        </StateMessage>
      </template>

      <template v-else>
        <ErrorSummary ref="summaryBox" :errors="summary" title="Déverrouillage impossible" />
        <form class="space-y-5" novalidate @submit.prevent="submit">
          <SelectField
            v-model="profileId"
            label="Profil"
            placeholder="Choisir un profil…"
            :control-id="PROFILE_ID"
            :options="profileOptions"
            :error="fieldErrors.profile"
            required
          />
          <TextField
            v-model="secret"
            label="Secret local"
            type="password"
            :control-id="SECRET_ID"
            autocomplete="current-password"
            :error="fieldErrors.secret"
            required
          />
          <p v-if="blockedUntil !== null" role="status" class="text-sm font-medium text-warning">
            <span aria-hidden="true">⚠ </span>Trop de tentatives sur ce profil : réessayez à
            {{ clock(blockedUntil) }}.
          </p>
          <AppButton
            type="submit"
            :pending="pending"
            pending-label="Déverrouillage en cours…"
            class="w-full"
          >
            Déverrouiller
          </AppButton>
        </form>
      </template>

      <p class="border-t border-line pt-4 text-sm text-muted">
        Secret local oublié : la gérante le réinitialise avec la clé de récupération du poste.
        <RouterLink :to="{ name: 'connexion', query: route.query }" class="text-link"
          >Se connecter au serveur</RouterLink
        >
        (le réseau est nécessaire).
      </p>
    </div>
  </section>
</template>
