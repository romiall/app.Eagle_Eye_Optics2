<script setup lang="ts">
/**
 * Prise de rendez-vous du public (L3D03, AT33, AT35), SANS compte, EN LIGNE : prestation ouverte à la réservation en
 * ligne, créneau libre, coordonnées et consentement. L'envoi est une DEMANDE : le cabinet la confirme ou la refuse,
 * et l'écran ne dit jamais « rendez-vous confirmé » (l'application n'envoie aucun message). Rien de médical n'est
 * demandé. Un numéro de téléphone connu du cabinet ne change rien à ce que le visiteur voit (aucune énumération). Le
 * champ caché « website » est un piège à robots. Un seul envoi par demande : la même clé d'idempotence est reprise
 * tant que la demande est la même. Données de démonstration FICTIVES seulement.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import { ApiError, NetworkUnavailable } from '@/app/api'
import { clinicTimeZone, formatDayFr, formatInstantFr, formatTimeFr } from '@/app/clinicTime'
import {
  getShowroomItem,
  listPublicServices,
  listPublicSlots,
  listSiteContents,
  requestPublicBooking,
} from '@/app/services/publicSite'
import { useRead } from '@/app/services/reads'
import SlotOption from '@/components/agenda/SlotOption.vue'
import StepCard from '@/components/agenda/StepCard.vue'
import ErrorSummary, { type FieldErrorItem } from '@/components/feedback/ErrorSummary.vue'
import StateMessage from '@/components/feedback/StateMessage.vue'
import CheckboxField from '@/components/form/CheckboxField.vue'
import TextField from '@/components/form/TextField.vue'
import PageHeader from '@/components/layout/PageHeader.vue'
import AppButton from '@/components/ui/AppButton.vue'
import LinkButton from '@/components/ui/LinkButton.vue'
import type {
  BookingReceipt,
  PublicContent,
  PublicService,
  PublicSlot,
  ShowroomItem,
} from '@/domain/contracts/generated'
import {
  type BookingErrors,
  type BookingField,
  bookingFieldFromServer,
  buildBookingRequest,
  emptyBookingForm,
  groupSlotsByDay,
  hasBookingErrors,
  NAME_MAX,
  SLOT_WINDOWS_MAX,
  slotWindow,
  validateBooking,
} from '@/domain/site/booking'
import { CivilDate } from '@/domain/values/civilDate'
import { newUlid } from '@/domain/values/ulid'

import PublicContents from './PublicContents.vue'
import PublicNav from './PublicNav.vue'
import PublicReadMessage from './PublicReadMessage.vue'

const FIELD_IDS: Readonly<Record<BookingField, string>> = {
  service: 'rdv-prestation',
  slot: 'rdv-creneau-groupe',
  name: 'rdv-nom',
  phone: 'rdv-telephone',
  email: 'rdv-courriel',
  consent: 'rdv-consentement',
}

const route = useRoute()

/** Référence du showroom qui a donné envie de venir (`?fiche=<adresse>`), jamais une donnée de santé. */
const publicationSlug = computed(() => {
  const raw = route.query['fiche']
  const value = Array.isArray(raw) ? raw[0] : raw
  return typeof value === 'string' && /^[a-z0-9-]{1,180}$/.test(value) ? value : null
})

const servicesRead = useRead<PublicService[]>(() => listPublicServices(), {
  isEmpty: (list) => list.length === 0,
})
const contentsRead = useRead<PublicContent[]>(() => listSiteContents())
const linkedRead = useRead<ShowroomItem>(() => getShowroomItem(publicationSlug.value ?? ''), {
  lazy: true,
})
/** La référence n'est liée que si elle est bien publiée : jamais une adresse inventée envoyée au serveur. */
const linkedSlug = computed(() =>
  publicationSlug.value !== null && linkedRead.state.value === 'ready' ? publicationSlug.value : null,
)

const startedAt = Date.now()
const serviceId = ref<string | null>(null)
const windowIndex = ref(0)
const slotsRead = useRead<PublicSlot[]>(
  () => {
    const { from, to } = slotWindow(startedAt, windowIndex.value)
    return listPublicSlots(serviceId.value ?? '', from, to)
  },
  { lazy: true },
)
const chosenDay = ref<string | null>(null)
const chosenStart = ref<string | null>(null)

const days = computed(() => groupSlotsByDay(slotsRead.data.value ?? [], clinicTimeZone()))
const daySlots = computed(() => days.value.find((entry) => entry.day === chosenDay.value)?.slots ?? [])
const chosenSlot = computed(
  () => daySlots.value.find((slot) => slot.starts_at === chosenStart.value) ?? null,
)
const hasMoreWindows = computed(() => windowIndex.value < SLOT_WINDOWS_MAX - 1)

function dayLabel(day: string): string {
  return formatDayFr(CivilDate.fromString(day))
}

watch(days, (list) => {
  if (!list.some((entry) => entry.day === chosenDay.value)) {
    chosenDay.value = list[0]?.day ?? null
  }
})
watch(daySlots, (list) => {
  if (!list.some((slot) => slot.starts_at === chosenStart.value)) chosenStart.value = null
})

watch(
  () => servicesRead.data.value,
  (list) => {
    const only = list?.length === 1 ? list[0] : undefined
    if (only !== undefined && serviceId.value === null) serviceId.value = only.id
  },
)

watch(serviceId, (id) => {
  chosenDay.value = null
  chosenStart.value = null
  windowIndex.value = 0
  if (id !== null) void slotsRead.reload()
})

function nextWindow(): void {
  windowIndex.value += 1
  chosenDay.value = null
  chosenStart.value = null
  void slotsRead.reload()
}

function firstWindow(): void {
  windowIndex.value = 0
  chosenDay.value = null
  chosenStart.value = null
  void slotsRead.reload()
}

onMounted(() => {
  if (publicationSlug.value !== null) void linkedRead.reload()
})

const form = ref(emptyBookingForm())
const errors = ref<BookingErrors>({})
const failure = ref<string | null>(null)
const submitting = ref(false)
const receipt = ref<BookingReceipt | null>(null)
const summaryBox = ref<{ focus: () => Promise<void> } | null>(null)
/** Dernière demande envoyée : tant que la demande est identique, la même clé d'idempotence est reprise. */
let attempt: { body: string; key: string } | null = null

const summary = computed<FieldErrorItem[]>(() =>
  (Object.entries(errors.value) as [BookingField, string][]).map(([field, message]) => ({
    fieldId: FIELD_IDS[field],
    message,
  })),
)

function describeFailure(caught: unknown): string {
  if (caught instanceof NetworkUnavailable) {
    return 'Pas de connexion : votre demande n’a pas été envoyée. Vérifiez votre connexion, puis renvoyez-la.'
  }
  if (caught instanceof ApiError) {
    if (caught.status === 429) {
      return 'Trop de demandes en peu de temps. Patientez une minute, puis renvoyez votre demande.'
    }
    if (caught.code === 'SLOT_UNAVAILABLE') {
      return 'Ce créneau vient d’être pris. Choisissez-en un autre.'
    }
    if (caught.status >= 500 || !caught.fromApplication) {
      return 'Nous n’avons pas pu confirmer l’envoi de votre demande. Vous pouvez la renvoyer : elle ne sera pas enregistrée deux fois.'
    }
    return caught.message
  }
  return 'Votre demande n’a pas pu être envoyée. Réessayez dans quelques instants.'
}

async function submit(): Promise<void> {
  if (submitting.value) return
  failure.value = null
  const slot = chosenSlot.value
  errors.value = validateBooking(form.value, serviceId.value, slot?.starts_at ?? null)
  if (hasBookingErrors(errors.value) || slot === null || serviceId.value === null) {
    await summaryBox.value?.focus()
    return
  }
  const body = buildBookingRequest(form.value, serviceId.value, slot, linkedSlug.value)
  const text = JSON.stringify(body)
  if (attempt === null || attempt.body !== text) attempt = { body: text, key: newUlid() }
  submitting.value = true
  try {
    receipt.value = await requestPublicBooking(body, attempt.key)
    attempt = null
    form.value = emptyBookingForm()
    errors.value = {}
  } catch (caught) {
    if (caught instanceof ApiError && caught.status === 422) {
      const byField: BookingErrors = {}
      const others: string[] = []
      for (const [key, messages] of Object.entries(caught.fields)) {
        const field = bookingFieldFromServer(key)
        const first = messages[0]
        if (first === undefined) continue
        if (field === null) others.push(first)
        else byField[field] = first
      }
      errors.value = byField
      failure.value = others.length > 0 ? others.join(' ') : hasBookingErrors(byField) ? null : caught.message
      await summaryBox.value?.focus()
    } else {
      failure.value = describeFailure(caught)
      if (caught instanceof ApiError && caught.code === 'SLOT_UNAVAILABLE') {
        chosenStart.value = null
        void slotsRead.reload()
      }
    }
  } finally {
    submitting.value = false
  }
}

function another(): void {
  receipt.value = null
  failure.value = null
  chosenStart.value = null
  void slotsRead.reload()
}
</script>

<template>
  <section aria-labelledby="titre-rendez-vous" class="page-stack max-w-3xl">
    <PageHeader
      title-id="titre-rendez-vous"
      title="Prendre rendez-vous"
      subtitle="Choisissez une prestation et un créneau libre, puis laissez vos coordonnées : le cabinet vous répond pour confirmer."
      icon="calendar-plus"
      eyebrow="Cabinet d’optique"
    />
    <PublicNav />

    <template v-if="receipt">
      <StateMessage state="success" title="Demande envoyée">
        Votre référence est <strong>{{ receipt.public_reference }}</strong
        >. Créneau demandé : {{ formatInstantFr(receipt.requested_starts_at) }}. Le cabinet vous
        répondra pour confirmer ce créneau : tant qu’il ne l’a pas fait, ce n’est pas un rendez-vous
        confirmé. Notez votre référence.
      </StateMessage>
      <div class="flex flex-wrap gap-3">
        <AppButton variant="secondary" @click="another">Faire une autre demande</AppButton>
        <LinkButton :to="{ name: 'public-showroom' }" variant="ghost">Voir le showroom</LinkButton>
      </div>
    </template>

    <form v-else novalidate class="space-y-4" aria-labelledby="titre-rendez-vous" @submit.prevent="submit">
      <p
        v-if="linkedRead.state.value === 'ready' && linkedRead.data.value"
        class="max-w-prose text-base text-muted"
      >
        Votre demande concerne la référence « {{ linkedRead.data.value.title }} » du showroom.
      </p>
      <ErrorSummary ref="summaryBox" :errors="summary" />
      <StateMessage v-if="failure" state="error" title="Demande non envoyée">
        {{ failure }}
      </StateMessage>

      <StepCard
        :step="1"
        title="Prestation"
        :done="serviceId !== null"
        hint="Seules les prestations ouvertes à la réservation en ligne sont proposées."
      >
        <PublicReadMessage
          v-if="servicesRead.state.value !== 'ready' && servicesRead.state.value !== 'empty'"
          :state="servicesRead.state.value"
          subject="les prestations"
          :error="servicesRead.error.value"
          @retry="servicesRead.reload()"
        />
        <StateMessage
          v-else-if="servicesRead.state.value === 'empty'"
          state="empty"
          title="Prise de rendez-vous en ligne fermée"
        >
          Aucune prestation n’est ouverte à la réservation en ligne pour le moment. Contactez
          directement le cabinet.
        </StateMessage>
        <fieldset v-else :id="FIELD_IDS.service" tabindex="-1" class="space-y-2">
          <legend class="font-semibold">Prestation souhaitée</legend>
          <div class="grid grid-cols-[repeat(auto-fill,minmax(min(100%,14rem),1fr))] gap-2">
            <SlotOption v-for="service in servicesRead.data.value ?? []" :key="service.id">
              <input
                v-model="serviceId"
                type="radio"
                name="rdv-prestation-choix"
                :value="service.id"
                class="size-4 shrink-0 accent-primary"
              />
              <span>{{ service.name }} · {{ service.duration_minutes }} min</span>
            </SlotOption>
          </div>
          <p v-if="errors.service" class="text-sm font-medium text-danger">{{ errors.service }}</p>
        </fieldset>
      </StepCard>

      <StepCard :step="2" title="Jour et heure" :done="chosenSlot !== null">
        <p v-if="serviceId === null" class="text-sm text-muted">
          Les créneaux libres s’affichent après le choix de la prestation.
        </p>
        <PublicReadMessage
          v-else-if="slotsRead.state.value === 'loading' || slotsRead.state.value === 'offline' || slotsRead.state.value === 'error'"
          :state="slotsRead.state.value"
          subject="les créneaux"
          :error="slotsRead.error.value"
          @retry="slotsRead.reload()"
        />
        <template v-else>
          <p
            v-if="days.length === 0"
            class="flex items-center gap-2 rounded-xl border border-dashed border-line bg-canvas px-4 py-3 text-muted"
          >
            Aucun créneau libre sur ces 7 jours.
          </p>
          <fieldset v-else :id="FIELD_IDS.slot" tabindex="-1" class="space-y-3">
            <legend class="font-semibold">Jour</legend>
            <div class="grid grid-cols-[repeat(auto-fill,minmax(min(100%,11rem),1fr))] gap-2">
              <SlotOption v-for="entry in days" :key="entry.day">
                <input
                  v-model="chosenDay"
                  type="radio"
                  name="rdv-jour"
                  :value="entry.day"
                  class="size-4 shrink-0 accent-primary"
                />
                <span class="capitalize">{{ dayLabel(entry.day) }}</span>
              </SlotOption>
            </div>
            <div v-if="daySlots.length > 0" class="space-y-2">
              <p class="font-semibold">Heure</p>
              <div class="grid grid-cols-[repeat(auto-fill,minmax(min(100%,6.5rem),1fr))] gap-2">
                <SlotOption v-for="slot in daySlots" :key="slot.starts_at">
                  <input
                    v-model="chosenStart"
                    type="radio"
                    name="rdv-heure"
                    :value="slot.starts_at"
                    class="size-4 shrink-0 accent-primary"
                  />
                  <span>{{ formatTimeFr(slot.starts_at) }}</span>
                </SlotOption>
              </div>
            </div>
            <p v-if="errors.slot" class="text-sm font-medium text-danger">{{ errors.slot }}</p>
          </fieldset>
          <div class="flex flex-wrap gap-3">
            <AppButton v-if="windowIndex > 0" variant="ghost" @click="firstWindow"
              >Revenir aux 7 premiers jours</AppButton
            >
            <AppButton v-if="hasMoreWindows" variant="secondary" @click="nextWindow"
              >Voir les 7 jours suivants</AppButton
            >
          </div>
        </template>
      </StepCard>

      <StepCard
        :step="3"
        title="Vos coordonnées"
        hint="Ne mentionnez ici aucune information de santé : le cabinet en parlera avec vous lors du rendez-vous."
      >
        <div class="grid gap-3 sm:grid-cols-2">
          <TextField
            v-model="form.name"
            label="Nom et prénom"
            autocomplete="name"
            :control-id="FIELD_IDS.name"
            :maxlength="NAME_MAX"
            :error="errors.name ?? null"
            required
          />
          <TextField
            v-model="form.phone"
            label="Téléphone"
            type="tel"
            autocomplete="tel"
            inputmode="tel"
            hint="Le cabinet vous rappelle à ce numéro."
            :control-id="FIELD_IDS.phone"
            :error="errors.phone ?? null"
            required
          />
          <TextField
            v-model="form.email"
            label="Adresse e-mail (facultative)"
            type="email"
            autocomplete="email"
            :control-id="FIELD_IDS.email"
            :error="errors.email ?? null"
          />
        </div>
        <!-- Piège à robots : hors de l'écran, ignoré des lecteurs d'écran et du clavier ; un visiteur humain ne le remplit jamais. -->
        <div
          aria-hidden="true"
          class="absolute -left-[10000px] h-px w-px overflow-hidden"
          data-testid="piege"
        >
          <label
            >Laissez ce champ vide
            <input
              v-model="form.website"
              type="text"
              name="website"
              tabindex="-1"
              autocomplete="off"
          /></label>
        </div>
        <CheckboxField
          v-model="form.consent"
          label="J’accepte que le cabinet utilise mon nom, mon téléphone et mon e-mail pour répondre à cette demande de rendez-vous."
          :control-id="FIELD_IDS.consent"
          :error="errors.consent ?? null"
        />
      </StepCard>

      <div class="flex flex-wrap gap-3">
        <AppButton
          type="submit"
          :pending="submitting"
          pending-label="Envoi en cours…"
          :disabled="servicesRead.state.value === 'empty'"
          >Envoyer ma demande</AppButton
        >
      </div>
    </form>

    <PublicContents
      v-if="contentsRead.data.value"
      :contents="contentsRead.data.value"
      :codes="['HORAIRES', 'LOCALISATION', 'CONTACT', 'WHATSAPP']"
      heading="Pour nous joindre"
      title-id="titre-joindre"
    />
  </section>
</template>
