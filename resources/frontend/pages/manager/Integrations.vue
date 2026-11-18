<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'

import { ApiError, NetworkUnavailable } from '@/app/api'
import { formatInstantFr } from '@/app/clinicTime'
import {
  createIntegrationAccount,
  getIntegrationsHealth,
  newIdempotencyKey,
  testIntegrationAccount,
  updateIntegrationAccount,
} from '@/app/services/communication'
import ErrorSummary, { type FieldErrorItem } from '@/components/feedback/ErrorSummary.vue'
import ReadNotice from '@/components/feedback/ReadNotice.vue'
import StateMessage from '@/components/feedback/StateMessage.vue'
import SelectField from '@/components/form/SelectField.vue'
import TextAreaField from '@/components/form/TextAreaField.vue'
import TextField from '@/components/form/TextField.vue'
import EmptyState from '@/components/layout/EmptyState.vue'
import PageHeader from '@/components/layout/PageHeader.vue'
import SectionCard from '@/components/layout/SectionCard.vue'
import StatTile from '@/components/layout/StatTile.vue'
import StatusChip from '@/components/layout/StatusChip.vue'
import PasswordConfirmDialog from '@/components/session/PasswordConfirmDialog.vue'
import AppButton from '@/components/ui/AppButton.vue'
import LinkButton from '@/components/ui/LinkButton.vue'
import {
  INTEGRATION_MODE_BADGES,
  INTEGRATION_PROVIDER_LABELS,
  INTEGRATION_PROVIDER_OPTIONS,
  INTEGRATION_STATUS_BADGES,
  INTEGRATION_STATUS_OPTIONS,
  parseOptionalJsonObject,
} from '@/domain/communication/types'
import type {
  IntegrationAccount,
  IntegrationAccountsProvider,
  IntegrationAccountsStatus,
  IntegrationConnectionTest,
} from '@/domain/contracts/generated'
import { useAdminWrite } from '@/pages/settings/useAdminWrite'
import { useServerRead } from '@/pages/today/useServerRead'

/**
 * Paramétrage et supervision des connecteurs externes (module integrations, gérante réauthentifiée) :
 * santé globale, enregistrement chiffré des secrets (jamais relus en clair) et test de connectivité.
 */
const router = useRouter()
const outboxRouteTarget = computed(() =>
  router.hasRoute('communication-outbox')
    ? { name: 'communication-outbox' }
    : '/communication/boite-envoi',
)

const healthRead = useServerRead(() => getIntegrationsHealth())
const health = computed(() => healthRead.data.value)
const accounts = computed(() => health.value?.accounts ?? [])

const writer = useAdminWrite()
const localErrors = ref<Record<string, string>>({})
const saveSuccess = ref<string | null>(null)
const editingId = ref<string | null>(null)
const editingVersion = ref<number>(1)

const testingAccountId = ref<string | null>(null)
const testResult = ref<IntegrationConnectionTest | null>(null)
const testError = ref<string | null>(null)

const IDS = {
  provider: 'integration-provider',
  externalId: 'integration-external-id',
  displayName: 'integration-display-name',
  status: 'integration-status',
  credentials: 'integration-credentials',
  publicConfig: 'integration-public-config',
} as const

const form = reactive<{
  provider: IntegrationAccountsProvider | null
  externalAccountId: string
  displayName: string
  status: IntegrationAccountsStatus | null
  credentialsJson: string
  publicConfigJson: string
}>({
  provider: 'GOOGLE',
  externalAccountId: '',
  displayName: '',
  status: 'TEST',
  credentialsJson: '',
  publicConfigJson: '',
})

const PROVIDER_PRESETS: Readonly<
  Record<IntegrationAccountsProvider, { credentials: string; publicConfig: string }>
> = {
  GOOGLE: {
    credentials: '{\n  "access_token": "A_REMPLACER",\n  "refresh_token": "A_REMPLACER"\n}',
    publicConfig: '{\n  "calendar_id": "primary",\n  "timezone": "Africa/Douala"\n}',
  },
  KOMMO: {
    credentials: '{\n  "long_lived_token": "A_REMPLACER"\n}',
    publicConfig: '{\n  "subdomain": "votre-compte-kommo",\n  "pipeline_id": ""\n}',
  },
  META_WHATSAPP: {
    credentials: '{\n  "token": "A_REMPLACER"\n}',
    publicConfig: '{\n  "phone_number_id": "A_REMPLACER",\n  "business_account_id": ""\n}',
  },
  META_MESSENGER: {
    credentials: '{\n  "page_access_token": "A_REMPLACER"\n}',
    publicConfig: '{\n  "page_id": "A_REMPLACER"\n}',
  },
  META_INSTAGRAM: {
    credentials: '{\n  "page_access_token": "A_REMPLACER"\n}',
    publicConfig: '{\n  "ig_account_id": "A_REMPLACER"\n}',
  },
  SMS: {
    credentials: '{\n  "api_key": "A_REMPLACER"\n}',
    publicConfig: '{\n  "sender_id": "EagleEye",\n  "country_prefix": "+237"\n}',
  },
  SMTP: {
    credentials: '{\n  "username": "contact@eagleeyeoptic.com",\n  "password": "A_REMPLACER"\n}',
    publicConfig:
      '{\n  "host": "smtp.exemple.com",\n  "port": 587,\n  "from": "contact@eagleeyeoptic.com"\n}',
  },
}

function applyProviderPreset(): void {
  const provider = form.provider ?? 'GOOGLE'
  const preset = PROVIDER_PRESETS[provider]
  form.credentialsJson = preset.credentials
  form.publicConfigJson = preset.publicConfig
}

const isEditing = computed(() => editingId.value !== null)

function resetForm(): void {
  editingId.value = null
  editingVersion.value = 1
  form.provider = 'GOOGLE'
  form.externalAccountId = ''
  form.displayName = ''
  form.status = 'TEST'
  form.credentialsJson = ''
  form.publicConfigJson = ''
  localErrors.value = {}
  writer.reset()
}

function startEdit(account: IntegrationAccount): void {
  editingId.value = account.id
  editingVersion.value = account.version
  form.provider = account.provider
  form.externalAccountId = account.external_account_id
  form.displayName = account.display_name
  form.status = account.status
  form.credentialsJson = ''
  form.publicConfigJson =
    account.public_configuration !== null
      ? JSON.stringify(account.public_configuration, null, 2)
      : ''
  localErrors.value = {}
  saveSuccess.value = null
  writer.reset()
}

function fieldError(field: string, controlId: string): string | null {
  return localErrors.value[controlId] ?? writer.fieldError(field)
}

const summaryErrors = computed<FieldErrorItem[]>(() => {
  const items: FieldErrorItem[] = []
  const map: readonly { key: string; controlId: string }[] = [
    { key: 'provider', controlId: IDS.provider },
    { key: 'external_account_id', controlId: IDS.externalId },
    { key: 'display_name', controlId: IDS.displayName },
    { key: 'status', controlId: IDS.status },
    { key: 'credentials', controlId: IDS.credentials },
    { key: 'public_configuration', controlId: IDS.publicConfig },
  ]
  for (const entry of map) {
    const message = fieldError(entry.key, entry.controlId)
    if (message) items.push({ fieldId: entry.controlId, message })
  }
  return items
})

async function submitAccount(): Promise<void> {
  localErrors.value = {}
  saveSuccess.value = null

  const errors: Record<string, string> = {}
  if (!form.provider) errors[IDS.provider] = 'Sélectionnez un fournisseur.'
  if (!isEditing.value && form.externalAccountId.trim() === '') {
    errors[IDS.externalId] = 'Saisissez l’identifiant externe du compte.'
  }
  if (form.displayName.trim() === '') {
    errors[IDS.displayName] = 'Saisissez un libellé lisible pour l’équipe.'
  }
  if (!form.status) errors[IDS.status] = 'Choisissez un statut.'

  const credentialsParsed = parseOptionalJsonObject(form.credentialsJson, 'Identifiants JSON')
  if (!credentialsParsed.ok) errors[IDS.credentials] = credentialsParsed.error

  const publicConfigParsed = parseOptionalJsonObject(
    form.publicConfigJson,
    'Configuration publique JSON',
  )
  if (!publicConfigParsed.ok) errors[IDS.publicConfig] = publicConfigParsed.error

  if (Object.keys(errors).length > 0 || !credentialsParsed.ok || !publicConfigParsed.ok) {
    localErrors.value = errors
    return
  }

  const key = newIdempotencyKey()
  if (isEditing.value && editingId.value !== null) {
    const targetId = editingId.value
    const payload = {
      expected_version: editingVersion.value,
      display_name: form.displayName.trim(),
      status: form.status ?? 'TEST',
      ...(credentialsParsed.value !== null ? { credentials: credentialsParsed.value } : {}),
      public_configuration: publicConfigParsed.value,
    }
    await writer.run(
      () => updateIntegrationAccount(targetId, payload, key),
      async (updated) => {
        saveSuccess.value = `Compte « ${updated.display_name} » mis à jour (version ${updated.version}).`
        form.credentialsJson = ''
        editingVersion.value = updated.version
        await healthRead.reload()
      },
    )
    return
  }

  const createPayload = {
    provider: form.provider ?? 'GOOGLE',
    external_account_id: form.externalAccountId.trim(),
    display_name: form.displayName.trim(),
    status: form.status ?? 'TEST',
    credentials: credentialsParsed.value,
    public_configuration: publicConfigParsed.value,
  }
  await writer.run(
    () => createIntegrationAccount(createPayload, key),
    async (created) => {
      saveSuccess.value = `Compte « ${created.display_name} » enregistré avec chiffrement au repos.`
      resetForm()
      await healthRead.reload()
    },
  )
}

async function runConnectionTest(account: IntegrationAccount): Promise<void> {
  if (testingAccountId.value !== null) return
  testingAccountId.value = account.id
  testError.value = null
  testResult.value = null
  try {
    testResult.value = await testIntegrationAccount(account.id, newIdempotencyKey())
  } catch (failure) {
    if (failure instanceof NetworkUnavailable) {
      testError.value = 'Serveur injoignable : test de connectivité non confirmé.'
    } else if (failure instanceof ApiError) {
      testError.value = failure.message
    } else {
      throw failure
    }
  } finally {
    testingAccountId.value = null
  }
}
</script>

<template>
  <section aria-labelledby="titre-integrations" class="page-stack max-w-6xl">
    <PageHeader
      title-id="titre-integrations"
      title="Intégrations et connecteurs"
      subtitle="Configuration chiffrée des connecteurs externes, état de santé global et tests de connectivité."
      icon="shield"
      eyebrow="Connecteurs & sécurité"
    >
      <template #actions>
        <LinkButton :to="outboxRouteTarget" variant="secondary">
          Boîte d’envoi et webhooks
        </LinkButton>
        <AppButton
          variant="secondary"
          :pending="healthRead.state.value === 'loading'"
          @click="healthRead.reload()"
        >
          Actualiser la santé
        </AppButton>
      </template>
    </PageHeader>

    <ReadNotice
      :state="healthRead.state.value"
      :error="healthRead.error.value"
      subject="la santé des intégrations"
      @retry="healthRead.reload()"
    />

    <template v-if="health">
      <dl class="stat-grid">
        <StatTile
          label="Mode d’exécution"
          :value="INTEGRATION_MODE_BADGES[health.mode].label"
          :hint="
            health.credentials_configured
              ? 'Clé de chiffrement configurée'
              : 'Configuration serveur requise'
          "
          :tone="health.mode === 'live' ? 'success' : health.mode === 'fake' ? 'gold' : 'neutral'"
          icon="cloud"
        />
        <StatTile
          label="Comptes actifs"
          :value="`${health.accounts_active} / ${health.accounts_total}`"
          :hint="
            health.accounts_error > 0
              ? `${health.accounts_error} compte(s) en erreur`
              : 'Aucune erreur détectée'
          "
          :tone="health.accounts_error > 0 ? 'danger' : 'success'"
          icon="shield"
        />
        <StatTile
          label="Boîte d’envoi (outbox)"
          :value="health.outbox_pending"
          unit="en attente"
          :hint="
            health.outbox_failed > 0
              ? `${health.outbox_failed} événement(s) en échec`
              : 'Aucun échec outbox'
          "
          :tone="health.outbox_failed > 0 ? 'warning' : 'neutral'"
          icon="send"
        />
        <StatTile
          label="Webhooks & agendas"
          :value="health.webhook_pending"
          unit="webhooks"
          :hint="`${health.webhook_failed} webhook(s) en échec · ${health.calendar_stale} agenda(s) à rafraîchir`"
          :tone="health.webhook_failed > 0 || health.calendar_stale > 0 ? 'warning' : 'neutral'"
          icon="refresh"
        />
      </dl>

      <StateMessage
        v-if="testResult"
        :state="testResult.reachable ? 'success' : 'error'"
        :title="
          testResult.reachable
            ? `Connectivité vérifiée (${INTEGRATION_PROVIDER_LABELS[testResult.provider]})`
            : `Échec du test (${INTEGRATION_PROVIDER_LABELS[testResult.provider]})`
        "
      >
        <p>
          Mode : {{ testResult.mode === 'live' ? 'Production' : 'Simulation locale' }} · Statut :
          {{ INTEGRATION_STATUS_BADGES[testResult.status].label }} · Vérifié le
          {{ formatInstantFr(testResult.checked_at) }}
        </p>
        <p v-if="testResult.detail" class="mt-1 text-sm text-muted">{{ testResult.detail }}</p>
      </StateMessage>

      <StateMessage v-if="testError" state="error" title="Test de connectivité impossible">
        {{ testError }}
      </StateMessage>

      <SectionCard
        title="Comptes connecteurs configurés"
        title-id="titre-comptes-connecteurs"
        description="Les secrets sont chiffrés au repos sur le serveur et ne sont jamais renvoyés en lecture."
        icon="list"
        flush
      >
        <div v-if="accounts.length === 0" class="p-4 sm:p-6">
          <EmptyState
            title="Aucun compte connecteur enregistré"
            icon="cloud-off"
            flat
            title-as="h3"
          >
            Ajoutez un connecteur ci-dessous pour activer les échanges externes.
          </EmptyState>
        </div>
        <div v-else class="data-table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th scope="col">Fournisseur</th>
                <th scope="col">Libellé</th>
                <th scope="col">Identifiant externe</th>
                <th scope="col">Statut</th>
                <th scope="col">Identifiants</th>
                <th scope="col">Mise à jour</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="account in accounts" :key="account.id">
                <td>{{ INTEGRATION_PROVIDER_LABELS[account.provider] }}</td>
                <th scope="row">{{ account.display_name }}</th>
                <td>
                  <code>{{ account.external_account_id }}</code>
                </td>
                <td>
                  <StatusChip :tone="INTEGRATION_STATUS_BADGES[account.status].tone">
                    {{ INTEGRATION_STATUS_BADGES[account.status].label }}
                  </StatusChip>
                </td>
                <td>
                  <span>{{ account.has_credentials ? 'Secret chiffré' : 'Non renseigné' }}</span>
                  <span v-if="account.encryption_key_id" class="block text-xs text-muted">
                    Clé {{ account.encryption_key_id }}
                  </span>
                </td>
                <td>
                  {{ formatInstantFr(account.updated_at) }}
                  <span class="block text-xs text-muted">v{{ account.version }}</span>
                </td>
                <td>
                  <div class="flex flex-wrap gap-2">
                    <AppButton
                      variant="secondary"
                      :pending="testingAccountId === account.id"
                      :accessible-name="`Tester la connexion de ${account.display_name}`"
                      @click="runConnectionTest(account)"
                    >
                      Tester la connexion
                    </AppButton>
                    <AppButton
                      variant="ghost"
                      :accessible-name="`Modifier ${account.display_name}`"
                      @click="startEdit(account)"
                    >
                      Modifier
                    </AppButton>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </SectionCard>
    </template>

    <SectionCard
      :title="isEditing ? 'Modifier le compte connecteur' : 'Ajouter un compte connecteur'"
      title-id="titre-form-connecteur"
      description="Opération sensible : la gérante peut être invitée à confirmer son mot de passe (HTTP 423)."
      icon="lock"
    >
      <div class="space-y-4">
        <ErrorSummary :errors="summaryErrors" />

        <StateMessage
          v-if="writer.message.value && summaryErrors.length === 0"
          :state="writer.state.value === 'uncertain' ? 'offline' : 'error'"
          title="Compte non enregistré"
        >
          {{ writer.message.value }}
        </StateMessage>

        <StateMessage
          v-if="saveSuccess && writer.state.value === 'saved'"
          state="success"
          title="Compte connecteur enregistré"
        >
          {{ saveSuccess }}
        </StateMessage>

        <form class="space-y-5" novalidate @submit.prevent="submitAccount">
          <div class="form-grid">
            <SelectField
              :model-value="form.provider"
              label="Fournisseur"
              :control-id="IDS.provider"
              :options="INTEGRATION_PROVIDER_OPTIONS"
              :disabled="isEditing"
              :error="fieldError('provider', IDS.provider)"
              required
              @update:model-value="
                (v) => (form.provider = (v as IntegrationAccountsProvider | null) ?? 'GOOGLE')
              "
            />
            <TextField
              v-model="form.externalAccountId"
              label="Identifiant externe"
              :control-id="IDS.externalId"
              :disabled="isEditing"
              :error="fieldError('external_account_id', IDS.externalId)"
              placeholder="ex. cabinet-douala-01"
              required
            />
            <TextField
              v-model="form.displayName"
              label="Nom affiché"
              :control-id="IDS.displayName"
              :error="fieldError('display_name', IDS.displayName)"
              placeholder="ex. WhatsApp officiel du cabinet"
              required
            />
            <SelectField
              :model-value="form.status"
              label="Statut"
              :control-id="IDS.status"
              :options="INTEGRATION_STATUS_OPTIONS"
              :error="fieldError('status', IDS.status)"
              required
              @update:model-value="
                (v) => (form.status = (v as IntegrationAccountsStatus | null) ?? 'TEST')
              "
            />
            <div
              class="col-span-full flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface p-3 text-sm"
            >
              <span class="text-muted">
                Besoin d’aide sur les champs attendus pour ce fournisseur ? Pré-remplissez un modèle
                puis remplacez « A_REMPLACER ».
              </span>
              <AppButton variant="secondary" @click="applyProviderPreset">
                Pré-remplir le modèle du fournisseur
              </AppButton>
            </div>
            <TextAreaField
              v-model="form.credentialsJson"
              class="col-span-full"
              label="Identifiants secrets (objet JSON, chiffré au repos)"
              :control-id="IDS.credentials"
              :rows="3"
              :error="fieldError('credentials', IDS.credentials)"
              :hint="
                isEditing
                  ? 'Laissez vide pour conserver le secret chiffré existant ; saisissez un objet JSON pour le remplacer.'
                  : 'Objet JSON facultatif (ex. token, clé API). Jamais affiché après enregistrement.'
              "
            />
            <TextAreaField
              v-model="form.publicConfigJson"
              class="col-span-full"
              label="Configuration publique (objet JSON non sensible)"
              :control-id="IDS.publicConfig"
              :rows="3"
              :error="fieldError('public_configuration', IDS.publicConfig)"
              hint="Paramètres non secrets (ex. fuseau horaire, nom d’expéditeur, URL d’endpoint)."
            />
          </div>

          <div class="form-actions">
            <AppButton
              type="submit"
              variant="primary"
              :pending="writer.state.value === 'saving'"
              pending-label="Enregistrement…"
            >
              {{ isEditing ? 'Mettre à jour le compte' : 'Enregistrer le compte' }}
            </AppButton>
            <AppButton v-if="isEditing" variant="secondary" @click="resetForm()">
              Annuler la modification
            </AppButton>
          </div>
        </form>
      </div>
    </SectionCard>

    <PasswordConfirmDialog
      :open="writer.state.value === 'reauthentication'"
      action="L’enregistrement du compte connecteur"
      @confirmed="writer.resume()"
      @cancel="writer.cancel()"
    />
  </section>
</template>
