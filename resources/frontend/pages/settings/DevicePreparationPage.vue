<script setup lang="ts">
/**
 * « Préparer ce poste » (O01, O02 ; fichier 19, « Préparation du poste »), gérante, module `offline`. Étapes :
 * vérifier le stockage du navigateur, créer le coffre chiffré du poste (secret local de la gérante et clé de
 * récupération notée HORS du poste), l'ouvrir, enrôler le poste (clé ES256 du poste, preuve de possession), puis
 * préparer les profils (grant signé par le serveur, vérifié sur ce poste, profil local dont la personne saisit
 * elle-même son secret).
 *
 * Puis (O03, O05) : réserver les numéros du poste (plages disjointes du serveur), relire les ressources attribuées, et
 * suivre la synchronisation : pièces à envoyer, en attente, en conflit ou rejetées, bouton « Synchroniser maintenant ».
 *
 * Honnêteté : sans Internet, seuls la création et la modification de patients, les factures et les encaissements
 * s'enregistrent sur ce poste ; ils ne sont « consolidés » qu'à l'ACK du serveur. Aucun secret n'est conservé par
 * l'écran au-delà de la saisie.
 */
import { computed, onMounted, ref } from 'vue'

import {
  deviceSyncIssues,
  deviceSyncState,
  type LocalSyncIssue,
  refreshDeviceSync,
  syncDeviceNow,
} from '@/app/services/deviceSync'
import { listStaff } from '@/app/services/staff'
import { syncFailureMessage } from '@/app/services/syncFailure'
import {
  addLocalProfile,
  enrollThisDevice,
  type GrantClaims,
  isVaultError,
  localSecrets,
  lockVault,
  prepareProfileGrant,
  type PreparedRecovery,
  prepareThisDeviceResources,
  prepareVaultForManager,
  refreshThisDevicePreparation,
  refreshVault,
  type StorageHealth,
  unlockVault,
  vaultStorageHealth,
  vaultView,
} from '@/app/services/vault'
import StateMessage from '@/components/feedback/StateMessage.vue'
import DeviceRecoveryPanel from '@/components/devices/DeviceRecoveryPanel.vue'
import SelectField from '@/components/form/SelectField.vue'
import TextField from '@/components/form/TextField.vue'
import PasswordConfirmDialog from '@/components/session/PasswordConfirmDialog.vue'
import AppButton from '@/components/ui/AppButton.vue'
import type { StaffMemberSummary } from '@/domain/contracts/generated'

import { useAdminWrite } from './useAdminWrite'

const APP_VERSION = '0.1.0'

const writer = useAdminWrite()
const view = vaultView
const problem = ref<string | null>(null)
const busy = ref(false)

const health = ref<StorageHealth | null>(null)
const secret = ref('')
const suggested = ref<string | null>(null)
const prepared = ref<PreparedRecovery | null>(null)
const recoveryInput = ref('')
const unlockProfile = ref<string | null>(null)
const unlockSecret = ref('')
const deviceCode = ref('CAISSE-1')
const deviceName = ref('')
const managerSecret = ref('')
const staff = ref<StaffMemberSummary[]>([])
const preparedClaims = ref<Record<string, GrantClaims>>({})
const holderFor = ref<string | null>(null)
const holderSecret = ref('')

const rangeSizes = ref<Record<'PATIENT' | 'INVOICE' | 'RECEIPT', string>>({
  PATIENT: '50',
  INVOICE: '50',
  RECEIPT: '50',
})
const resources = ref<{ ranges: number; quotas: number; owners: number } | null>(null)
const syncSummary = deviceSyncState.summary
const syncIssues = deviceSyncIssues
const syncing = ref(false)
const syncProblem = ref<string | null>(null)

const SERIES_LABELS: Record<'PATIENT' | 'INVOICE' | 'RECEIPT', string> = {
  PATIENT: 'Numéros de dossiers patients',
  INVOICE: 'Numéros de factures',
  RECEIPT: 'Numéros de reçus',
}

const COMMAND_LABELS: Record<string, string> = {
  CreatePatient: 'Création d’un patient',
  UpdatePatient: 'Modification d’un patient',
  CreateInvoiceDraft: 'Brouillon de facture',
  UpdateDraft: 'Modification d’un brouillon',
  IssueInvoice: 'Émission d’une facture',
  RegisterPayment: 'Encaissement',
  OpenCashSession: 'Ouverture de caisse',
}

const ISSUE_LABELS: Record<LocalSyncIssue['state'], string> = {
  WAITING_DEPENDENCY: 'En attente d’une pièce liée',
  CONFLICT_REQUIRES_REVIEW: 'Conflit à revoir par la gérante',
  REJECTED: 'Rejeté après revue',
}

const profileOptions = computed(() =>
  view.value.profiles.map((profile) => ({
    value: profile.profileId,
    label: `${profile.displayName} (${profile.login})`,
  })),
)
const localUsers = computed(() => new Set(view.value.profiles.map((profile) => profile.userId)))

const VAULT_MESSAGES: Record<string, string> = {
  SECRET_TOO_WEAK:
    'Ce secret local est trop faible : au moins 14 caractères, sans votre identifiant ni suite évidente.',
  AUTH_FAILED: 'Secret local incorrect.',
  AUTH_THROTTLED: 'Trop de tentatives : patientez avant de réessayer.',
  STEP_UP_FAILED: 'Secret local de la gérante incorrect : rien n’a été modifié.',
  RECOVERY_KEY_MISMATCH: 'La clé ressaisie ne correspond pas à celle affichée : rien n’a été créé.',
  COMPARTMENT_NOT_AVAILABLE: 'Ce compte n’a pas les droits nécessaires sur ce poste.',
  GRANT_INVALID: 'L’autorisation de ce profil est altérée : préparez-le de nouveau en ligne.',
  INSECURE_CONTEXT: 'Le coffre exige une connexion sécurisée (HTTPS).',
  WEBCRYPTO_SELFTEST_FAILED:
    'Ce navigateur ne permet pas de chiffrer le coffre : utilisez Chrome ou Edge à jour.',
  PROFILE_EXISTS: 'Ce compte a déjà un profil sur ce poste.',
}

function explain(error: unknown): string {
  if (isVaultError(error))
    return VAULT_MESSAGES[error.code] ?? `Opération refusée par le coffre (${error.code}).`
  return error instanceof Error ? error.message : 'Opération impossible.'
}

async function guarded(action: () => Promise<void>): Promise<void> {
  if (busy.value) return
  busy.value = true
  problem.value = null
  try {
    await action()
  } catch (error) {
    problem.value = explain(error)
  } finally {
    busy.value = false
  }
}

onMounted(
  () =>
    void guarded(async () => {
      await refreshVault()
      await refreshDeviceSync()
    }),
)

function checkStorage(): Promise<void> {
  return guarded(async () => {
    health.value = await vaultStorageHealth()
  })
}

function propose(): void {
  suggested.value = localSecrets.generatePassphrase()
  secret.value = suggested.value
}

function createVault(): Promise<void> {
  return guarded(async () => {
    prepared.value = await prepareVaultForManager(secret.value)
  })
}

function confirmRecovery(): Promise<void> {
  return guarded(async () => {
    if (prepared.value === null) return
    await prepared.value.commit(recoveryInput.value)
    prepared.value = null
    recoveryInput.value = ''
    secret.value = ''
    suggested.value = null
    await refreshVault()
  })
}

function unlock(): Promise<void> {
  return guarded(async () => {
    if (unlockProfile.value === null) return
    await unlockVault(unlockProfile.value, unlockSecret.value)
    unlockSecret.value = ''
    staff.value = (await listStaff()).data.data.filter((member) => member.active)
  })
}

function enroll(): Promise<void> {
  return writer.run(
    () =>
      enrollThisDevice({
        managerSecret: managerSecret.value,
        deviceCode: deviceCode.value.trim(),
        name: deviceName.value.trim(),
        appVersion: APP_VERSION,
      }),
    async () => {
      managerSecret.value = ''
    },
  )
}

function prepareGrant(member: StaffMemberSummary): Promise<void> {
  return writer.run(
    () => prepareProfileGrant(member.id),
    (claims) => {
      preparedClaims.value = { ...preparedClaims.value, [member.id]: claims }
    },
  )
}

function addProfile(member: StaffMemberSummary): Promise<void> {
  return guarded(async () => {
    const claims = preparedClaims.value[member.id]
    if (claims === undefined) return
    await addLocalProfile({
      managerSecret: managerSecret.value,
      member,
      claims,
      holderSecret: holderSecret.value,
    })
    holderSecret.value = ''
    managerSecret.value = ''
    holderFor.value = null
  })
}

/** Plages de numéros de ce poste (O03), pour les profils préparés sur ce poste. */
function prepareResources(): Promise<void> {
  const ranges = (Object.keys(rangeSizes.value) as ('PATIENT' | 'INVOICE' | 'RECEIPT')[])
    .map((type) => ({ document_type: type, quantity: Number.parseInt(rangeSizes.value[type], 10) }))
    .filter((range) => Number.isSafeInteger(range.quantity) && range.quantity > 0)
  return writer.run(
    () => prepareThisDeviceResources({ profiles: [...localUsers.value], number_ranges: ranges }),
    async (counts) => {
      resources.value = counts
      await refreshDeviceSync()
    },
  )
}

/** Relit les ressources attribuées par le serveur à ce poste (plages, quotas, factures attribuées). */
function reloadResources(): Promise<void> {
  return guarded(async () => {
    resources.value = await refreshThisDevicePreparation()
  })
}

async function synchronize(): Promise<void> {
  if (syncing.value) return
  syncing.value = true
  syncProblem.value = null
  try {
    await syncDeviceNow()
  } catch (error) {
    syncProblem.value = syncFailureMessage(error)
  } finally {
    syncing.value = false
  }
}

function clock(instant: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Africa/Douala',
  }).format(new Date(instant))
}

function lock(): Promise<void> {
  return guarded(async () => {
    await lockVault('USER')
  })
}

function validUntil(claims: GrantClaims): string {
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Africa/Douala',
  }).format(new Date(claims.valid_until))
}
</script>

<template>
  <section aria-labelledby="titre-poste" class="max-w-3xl space-y-6">
    <h1 id="titre-poste" class="text-2xl font-semibold tracking-tight">Préparer ce poste</h1>

    <StateMessage state="empty" title="Travail sans Internet sur ce poste préparé">
      Une fois le poste préparé (coffre, enrôlement, profils et numéros réservés), la création et la
      modification de patients, les factures et les encaissements s’enregistrent sur ce poste puis
      partent au serveur dès que la connexion revient. Les visites, examens, avoirs et autres
      opérations restent en ligne.
    </StateMessage>

    <p v-if="problem" role="alert" class="font-medium text-danger">
      <span aria-hidden="true">⚠ </span>{{ problem }}
    </p>
    <p v-if="writer.message.value" role="alert" class="font-medium text-danger">
      <span aria-hidden="true">⚠ </span>{{ writer.message.value }}
    </p>

    <section aria-labelledby="titre-stockage" class="space-y-3">
      <h2 id="titre-stockage" class="text-xl font-semibold">1. Stockage du navigateur</h2>
      <AppButton variant="secondary" :pending="busy" @click="checkStorage"
        >Vérifier le stockage du poste</AppButton
      >
      <ul v-if="health" class="list-disc space-y-1 pl-5">
        <li>Stockage persistant : {{ health.persisted ? 'accordé' : 'non accordé' }}</li>
        <li>Écriture et relecture : {{ health.roundTrip ? 'réussies' : 'échec' }}</li>
        <li v-if="health.privateModeSuspected">
          Navigation privée soupçonnée : interdite pour ce poste.
        </li>
        <li>
          Écriture disque garantie à chaque enregistrement :
          {{ health.strictDurability ? 'oui' : 'non (prévoir un onduleur)' }}
        </li>
        <li v-if="health.quotaBytes !== null">
          Place annoncée : {{ Math.round(health.quotaBytes / 1048576) }} Mo
        </li>
      </ul>
      <p v-if="health && health.blockers.length === 0" class="text-sm text-muted">
        Un stockage persistant n’est pas une sauvegarde : l’export du poste reste nécessaire.
      </p>
    </section>

    <section v-if="view.status === 'absent'" aria-labelledby="titre-coffre" class="space-y-3">
      <h2 id="titre-coffre" class="text-xl font-semibold">2. Créer le coffre de ce poste</h2>
      <template v-if="prepared === null">
        <p class="max-w-prose">
          Choisissez un secret local, différent de votre mot de passe du serveur. Il ouvre le coffre
          de ce poste ; il n’est jamais envoyé au serveur.
        </p>
        <TextField
          v-model="secret"
          label="Secret local de la gérante"
          type="password"
          autocomplete="new-password"
          control-id="poste-secret"
        />
        <p v-if="suggested" class="text-sm">
          Secret proposé : <strong class="font-mono">{{ suggested }}</strong> (notez-le maintenant).
        </p>
        <div class="flex flex-wrap gap-3">
          <AppButton variant="secondary" @click="propose">Proposer un secret</AppButton>
          <AppButton variant="primary" :pending="busy" @click="createVault"
            >Créer le coffre</AppButton
          >
        </div>
      </template>
      <template v-else>
        <StateMessage
          state="conflict"
          title="Clé de récupération : à noter maintenant, hors du poste"
        >
          <p class="font-mono text-base break-all">{{ prepared.recoveryKey }}</p>
          <p>
            Elle seule permet de retrouver le coffre si un secret est perdu. Elle ne sera plus
            jamais affichée. Conservez-la sous votre contrôle, jamais sur ce poste.
          </p>
        </StateMessage>
        <TextField
          v-model="recoveryInput"
          label="Ressaisir la clé de récupération"
          control-id="poste-recuperation"
          autocomplete="off"
        />
        <AppButton variant="primary" :pending="busy" @click="confirmRecovery"
          >Confirmer et créer le coffre</AppButton
        >
      </template>
    </section>

    <section v-else-if="view.status === 'locked'" aria-labelledby="titre-ouvrir" class="space-y-3">
      <h2 id="titre-ouvrir" class="text-xl font-semibold">2. Ouvrir le coffre de ce poste</h2>
      <SelectField
        v-model="unlockProfile"
        label="Profil"
        placeholder="Choisir un profil…"
        control-id="poste-profil"
        :options="profileOptions"
      />
      <TextField
        v-model="unlockSecret"
        label="Secret local"
        type="password"
        autocomplete="current-password"
        control-id="poste-ouvrir"
      />
      <AppButton variant="primary" :pending="busy" @click="unlock">Ouvrir le coffre</AppButton>
    </section>

    <StateMessage
      v-else-if="view.status === 'damaged' || view.status === 'too-new'"
      state="error"
      title="Coffre illisible"
    >
      Le coffre de ce poste est endommagé ou écrit par une version plus récente de l’application :
      rien n’y est modifié. Contactez le support avant toute réinstallation.
    </StateMessage>

    <template v-else-if="view.status === 'unlocked' && view.session">
      <p class="font-medium">
        Coffre ouvert : {{ view.session.displayName }} — compartiments
        {{ view.session.compartments.join(', ') }}.
      </p>

      <section v-if="view.deviceId === null" aria-labelledby="titre-enrolement" class="space-y-3">
        <h2 id="titre-enrolement" class="text-xl font-semibold">3. Enrôler ce poste</h2>
        <TextField
          v-model="deviceCode"
          label="Code du poste"
          control-id="poste-code"
          hint="Par exemple CAISSE-1."
        />
        <TextField
          v-model="deviceName"
          label="Nom du poste"
          control-id="poste-nom"
          hint="Par exemple Caisse principale."
        />
        <TextField
          v-model="managerSecret"
          label="Votre secret local (confirmation)"
          type="password"
          autocomplete="current-password"
          control-id="poste-confirmation"
        />
        <AppButton variant="primary" :pending="writer.state.value === 'saving'" @click="enroll"
          >Enrôler ce poste</AppButton
        >
      </section>

      <section v-else aria-labelledby="titre-profils" class="space-y-3">
        <h2 id="titre-profils" class="text-xl font-semibold">
          3. Préparer les profils de ce poste
        </h2>
        <p class="max-w-prose">
          Chaque profil reçoit une autorisation signée par le serveur, vérifiée sur ce poste,
          valable 72 heures par défaut. La personne saisit ensuite elle-même son secret local.
        </p>
        <ul class="space-y-3">
          <li
            v-for="member in staff"
            :key="member.id"
            class="space-y-2 rounded-lg border-2 border-line p-3"
          >
            <p class="font-medium">
              {{ member.display_name }} <span class="text-muted">({{ member.login }})</span>
            </p>
            <p v-if="preparedClaims[member.id]" class="text-sm">
              Autorisation vérifiée jusqu’au
              {{ validUntil(preparedClaims[member.id] as GrantClaims) }} —
              {{ (preparedClaims[member.id] as GrantClaims).compartments.join(', ') }}
            </p>
            <p v-if="localUsers.has(member.id)" class="text-sm">
              Profil local présent sur ce poste.
            </p>
            <div class="flex flex-wrap gap-3">
              <AppButton
                variant="secondary"
                :pending="writer.state.value === 'saving'"
                @click="prepareGrant(member)"
                >Préparer l’autorisation</AppButton
              >
              <AppButton
                v-if="preparedClaims[member.id] && !localUsers.has(member.id)"
                variant="secondary"
                @click="holderFor = member.id"
                >Ajouter le profil local</AppButton
              >
            </div>
            <div v-if="holderFor === member.id" class="space-y-2">
              <TextField
                v-model="holderSecret"
                label="Secret local de la personne (saisi par elle)"
                type="password"
                autocomplete="new-password"
                :control-id="`poste-titulaire-${member.id}`"
              />
              <TextField
                v-model="managerSecret"
                label="Votre secret local (confirmation)"
                type="password"
                autocomplete="current-password"
                :control-id="`poste-gerante-${member.id}`"
              />
              <AppButton variant="primary" :pending="busy" @click="addProfile(member)"
                >Enregistrer le profil local</AppButton
              >
            </div>
          </li>
        </ul>
      </section>

      <section v-if="view.deviceId !== null" aria-labelledby="titre-ressources" class="space-y-3">
        <h2 id="titre-ressources" class="text-xl font-semibold">
          4. Réserver les numéros de ce poste
        </h2>
        <p class="max-w-prose">
          Sans Internet, ce poste numérote lui-même dossiers, factures et reçus dans des plages que
          le serveur lui réserve : un numéro n’est jamais attribué deux fois ni renuméroté. Les
          profils préparés ci-dessus les utilisent.
        </p>
        <div class="grid gap-3 sm:grid-cols-3">
          <TextField
            v-for="(label, type) in SERIES_LABELS"
            :key="type"
            v-model="rangeSizes[type]"
            :label="label"
            inputmode="numeric"
            :control-id="`poste-plage-${type.toLowerCase()}`"
          />
        </div>
        <div class="flex flex-wrap gap-3">
          <AppButton
            variant="primary"
            :pending="writer.state.value === 'saving'"
            @click="prepareResources"
            >Réserver les numéros</AppButton
          >
          <AppButton variant="secondary" :pending="busy" @click="reloadResources"
            >Relire les ressources du serveur</AppButton
          >
        </div>
        <p v-if="resources" role="status" class="text-sm">
          Ressources conservées sur ce poste : {{ resources.ranges }} plage(s) de numéros,
          {{ resources.quotas }} quota(s) de stock, {{ resources.owners }} facture(s) attribuée(s).
        </p>
      </section>

      <section
        v-if="view.deviceId !== null"
        aria-labelledby="titre-synchronisation"
        class="space-y-3"
      >
        <h2 id="titre-synchronisation" class="text-xl font-semibold">5. Synchronisation</h2>
        <ul v-if="syncSummary" class="list-disc space-y-1 pl-5">
          <li>Enregistrées sur ce poste, pas encore envoyées : {{ syncSummary.local }}</li>
          <li>Envoyées, en attente de confirmation : {{ syncSummary.pending }}</li>
          <li>En attente d’une pièce liée : {{ syncSummary.waitingDependency }}</li>
          <li>Conflits à revoir : {{ syncSummary.conflicts }}</li>
          <li v-if="syncSummary.otherProfiles > 0">
            D’autres profils (envoyées à l’ouverture de leur profil) :
            {{ syncSummary.otherProfiles }}
          </li>
          <li>
            Dernier échange réussi :
            {{ syncSummary.lastExchangeAt === null ? 'jamais' : clock(syncSummary.lastExchangeAt) }}
            <span v-if="syncSummary.lastAttemptFailed">
              — dernier essai sans réponse du serveur</span
            >
          </li>
        </ul>
        <AppButton
          variant="primary"
          :pending="syncing"
          pending-label="Synchronisation en cours…"
          @click="synchronize"
          >Synchroniser maintenant</AppButton
        >
        <p v-if="syncProblem" role="alert" class="font-medium text-warning">
          <span aria-hidden="true">⚠ </span>{{ syncProblem }}
        </p>
        <section v-if="syncIssues.length > 0" aria-labelledby="titre-a-revoir" class="space-y-2">
          <h3 id="titre-a-revoir" class="text-lg font-semibold">Pièces à revoir</h3>
          <ul class="space-y-2">
            <li
              v-for="issue in syncIssues"
              :key="issue.commandId"
              class="rounded-lg border-2 border-line p-3"
            >
              <p class="font-medium">
                <span aria-hidden="true"
                  >{{ issue.state === 'WAITING_DEPENDENCY' ? '↻' : '⚠' }}
                </span>
                {{ COMMAND_LABELS[issue.commandName] ?? issue.commandName }} (n°
                {{ issue.deviceSequence }} du journal) —
                {{ ISSUE_LABELS[issue.state] }}
              </p>
              <p v-if="issue.reason" class="text-sm">{{ issue.reason }}</p>
              <p class="text-sm text-muted">
                Enregistré sur ce poste le {{ clock(issue.recordedAt) }} ; la pièce locale est
                conservée.
              </p>
            </li>
          </ul>
        </section>
      </section>

      <!-- O07 : export chiffré de ce poste et reprise d'un ancien poste (mêmes numéros, aucun droit recopié). -->
      <DeviceRecoveryPanel :device-id="view.deviceId" />

      <AppButton variant="secondary" :pending="busy" @click="lock">Verrouiller le coffre</AppButton>
    </template>

    <PasswordConfirmDialog
      :open="writer.state.value === 'reauthentication'"
      action="La préparation de ce poste"
      @confirmed="writer.resume()"
      @cancel="writer.cancel()"
    />
  </section>
</template>
