import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { refreshSession, resetSessionForTests, session } from '@/app/session'
import { type DeviceSyncSummary, SYNC_STATE_KEY, type SyncStateSource } from '@/app/services/sync'
import FreshnessNote from '@/components/feedback/FreshnessNote.vue'
import SyncBadge from '@/components/feedback/SyncBadge.vue'
import ReauthDialog from '@/components/session/ReauthDialog.vue'
import SyncStatus from '@/components/SyncStatus.vue'

import { meResponse, type ServerScript, stubServer } from '../shell/server'

const IDLE: DeviceSyncSummary = {
  local: 0,
  pending: 0,
  waitingDependency: 0,
  conflicts: 0,
  otherProfiles: 0,
  documentsFailed: 0,
  documentsToUpload: 0,
  lastExchangeAt: '2026-10-15T09:42:00.000Z',
  lastAttemptFailed: false,
}

function mountStatus(summary: DeviceSyncSummary | null, syncNow?: () => Promise<void>) {
  const source: SyncStateSource = {
    summary: ref(summary),
    ...(syncNow === undefined ? {} : { syncNow }),
  }
  return mount(SyncStatus, { global: { provide: { [SYNC_STATE_KEY as symbol]: source } } })
}

afterEach(() => {
  resetSessionForTests()
  document.body.innerHTML = ''
})

describe('SyncStatus : état de synchronisation du poste, distinct du réseau', () => {
  it('n’affiche rien sans poste préparé (aucune pièce locale à synchroniser)', () => {
    expect(mount(SyncStatus).html()).toBe('<!--v-if-->')
    expect(mountStatus(null).html()).toBe('<!--v-if-->')
  })

  it('dit « Synchronisé » seulement si rien n’attend et qu’un échange a réussi', () => {
    const wrapper = mountStatus(IDLE)
    expect(wrapper.get('[role="status"]').text()).toContain('Synchronisé le 15/10 à 10h42')
    expect(wrapper.text()).not.toContain('En ligne')

    expect(mountStatus({ ...IDLE, lastExchangeAt: null }).text()).toContain('Jamais synchronisé')
  })

  it.each([
    ['des pièces enregistrées', { local: 1 }],
    ['des pièces envoyées', { pending: 1 }],
    ['une pièce liée attendue', { waitingDependency: 1 }],
    ['un conflit', { conflicts: 1 }],
    ['des pièces d’autres profils', { otherProfiles: 2 }],
    ['un PDF à régénérer', { documentsFailed: 1 }],
    ['un PDF à déposer', { documentsToUpload: 1 }],
    ['un dernier essai sans réponse', { lastAttemptFailed: true }],
  ] as const)('jamais « Synchronisé » avec %s', (_name, change) => {
    const text = mountStatus({ ...IDLE, ...change }).text()

    expect(text).not.toContain('Synchronisé')
    expect(text).not.toContain('Jamais synchronisé')
    expect(text).toContain('Dernier échange réussi le 15/10 à 10h42')
  })

  it('annonce chaque catégorie en attente avec son compte', () => {
    const text = mountStatus({
      ...IDLE,
      local: 1,
      pending: 2,
      waitingDependency: 1,
      conflicts: 1,
      otherProfiles: 3,
      documentsFailed: 2,
      documentsToUpload: 1,
      lastAttemptFailed: true,
    }).text()

    expect(text).toContain('1 conflit à revoir')
    expect(text).toContain('4 pièces en attente de synchronisation')
    expect(text).toContain('3 pièces d’autres profils : à envoyer à l’ouverture de leur profil')
    expect(text).toContain('2 PDF à régénérer')
    expect(text).toContain('1 PDF à déposer sur le serveur')
    expect(text).toContain('Dernier essai d’échange sans réponse du serveur')
  })

  it('nomme le profil qui doit s’ouvrir quand le poste connaît le compartiment des pièces d’autres profils (P04)', () => {
    const text = mountStatus({
      ...IDLE,
      otherProfiles: 3,
      otherCompartments: { FINANCIAL: 2, CLINICAL: 1 },
    }).text()

    expect(text).toContain(
      '1 pièce clinique : à envoyer à l’ouverture d’un profil professionnel ou de la gérante',
    )
    expect(text).toContain(
      '2 pièces de la caisse : à envoyer à l’ouverture d’un profil de caisse ou de la gérante',
    )
    expect(text).not.toContain('d’autres profils')
    expect(text).not.toContain('Synchronisé')
  })

  it('garde l’annonce générique si le détail par compartiment ne correspond pas au total', () => {
    const text = mountStatus({
      ...IDLE,
      otherProfiles: 3,
      otherCompartments: { FINANCIAL: 2 },
    }).text()

    expect(text).toContain('3 pièces d’autres profils : à envoyer à l’ouverture de leur profil')
    expect(text).not.toContain('de la caisse')
  })

  it('« Synchroniser » : état en cours pendant l’échange, bouton désactivé', async () => {
    let finish!: () => void
    const syncNow = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)))
    const wrapper = mountStatus(IDLE, syncNow)

    await wrapper.get('button').trigger('click')
    expect(wrapper.get('button').text()).toBe('Synchronisation en cours…')
    expect(wrapper.get('button').attributes('disabled')).toBeDefined()
    await wrapper.get('button').trigger('click')
    expect(syncNow).toHaveBeenCalledOnce()

    finish()
    await flushPromises()
    expect(wrapper.get('button').text()).toBe('Synchroniser')
  })

  it('une erreur de l’échange est annoncée, sans plantage ni « Synchronisé »', async () => {
    const wrapper = mountStatus(
      IDLE,
      vi.fn(async () => {
        throw new Error('serveur muet')
      }),
    )

    await wrapper.get('button').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Dernier essai d’échange sans réponse du serveur')
    expect(wrapper.text()).not.toContain('Synchronisé le')
  })
})

describe('SyncBadge : émis localement ou consolidé, et état du PDF', () => {
  it.each([
    ['local', 'Enregistré sur ce poste'],
    ['pending', 'En attente de synchronisation'],
    ['conflict', 'Conflit à revoir'],
    ['consolidated', 'Consolidé sur le serveur'],
    ['rejected', 'Rejeté après revue'],
  ] as const)('l’état %s se lit « %s », avec un symbole', (state, label) => {
    const wrapper = mount(SyncBadge, { props: { state } })
    expect(wrapper.text()).toContain(label)
    expect(wrapper.find('[aria-hidden="true"]').text()).not.toBe('')
  })

  it('montre l’état du PDF local à côté de celui de la pièce', () => {
    const wrapper = mount(SyncBadge, { props: { state: 'local', document: 'failed' } })
    expect(wrapper.text()).toContain('PDF à régénérer')
  })
})

describe('FreshnessNote : fraîcheur distante (AT45)', () => {
  it('donne l’heure du serveur à l’heure du cabinet', () => {
    const wrapper = mount(FreshnessNote, {
      props: { freshness: { serverAsOf: '2026-10-15T09:42:00.000Z', complete: true } },
    })
    expect(wrapper.text()).toBe('·Données du serveur au 15/10/2026 à 10h42.')
  })

  it('marque les totaux distants incomplets', () => {
    const wrapper = mount(FreshnessNote, {
      props: { freshness: { serverAsOf: '2026-10-15T09:42:00.000Z', complete: false } },
    })
    expect(wrapper.text()).toContain('Totaux distants incomplets')
  })

  it('dit quand seules les données du poste sont affichées', () => {
    const wrapper = mount(FreshnessNote, {
      props: { freshness: { serverAsOf: null, complete: false } },
    })
    expect(wrapper.text()).toContain('Données de ce poste seulement')
  })
})

describe('ReauthDialog : reconnexion sur place du même compte, saisie conservée', () => {
  /** Session connue puis expirée : le dernier compte reste connu de l'écran. */
  async function expiredSession(extra: Partial<ServerScript>) {
    const fetchMock = stubServer({ me: meResponse(['payment.collect']), ...extra })
    await refreshSession()
    return fetchMock
  }

  function openDialog() {
    return mount(ReauthDialog, { props: { open: true }, attachTo: document.body })
  }

  async function fillAndConfirm(wrapper: ReturnType<typeof openDialog>, password: string) {
    await flushPromises()
    await wrapper.get('input[type="password"]').setValue(password)
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Se reconnecter')
      ?.trigger('click')
    await flushPromises()
  }

  it('reconnecte le dernier compte connu puis rend la main à l’écran', async () => {
    const fetchMock = await expiredSession({ login: meResponse(['payment.collect']) })
    const wrapper = openDialog()
    await flushPromises()

    expect(wrapper.text()).toContain('Vos saisies sont conservées')
    expect(wrapper.text()).toContain('Gérante Fictive')
    await fillAndConfirm(wrapper, 'mot-de-passe-fictif')

    const login = fetchMock.mock.calls.find(([url]) => String(url) === '/api/v1/auth/login')
    expect(JSON.parse(String(login?.[1]?.body))).toEqual({
      login: 'gerante.fictive',
      password: 'mot-de-passe-fictif',
    })
    expect(wrapper.emitted('reauthenticated')).toHaveLength(1)
    expect((wrapper.get('input[type="password"]').element as HTMLInputElement).value).toBe('')
    wrapper.unmount()
  })

  it('refuse un compte dont l’identifiant n’est pas celui de la saisie, et ferme cette session', async () => {
    const other = {
      data: { ...meResponse(['payment.collect']).data, id: '01J9ZXK4M2Q8R7S6T5V4W30009' },
    }
    const fetchMock = await expiredSession({ login: other })
    const wrapper = openDialog()

    await fillAndConfirm(wrapper, 'mot-de-passe-fictif')

    expect(wrapper.emitted('reauthenticated')).toBeUndefined()
    expect(wrapper.text()).toContain('Ce n’est pas le compte qui a commencé cette saisie')
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) => String(url) === '/api/v1/auth/logout' && init?.method === 'POST',
      ),
    ).toBe(true)
    expect(session.status).toBe('anonymous')
    wrapper.unmount()
  })

  it('un mot de passe refusé laisse la boîte ouverte avec le message, mot de passe vidé', async () => {
    await expiredSession({
      login: {
        status: 422,
        code: 'VALIDATION_FAILED',
        message: 'Identifiant ou mot de passe incorrect.',
        fields: { login: ['Identifiant ou mot de passe incorrect.'] },
      },
    })
    const wrapper = openDialog()

    await fillAndConfirm(wrapper, 'faux')

    expect(wrapper.emitted('reauthenticated')).toBeUndefined()
    expect(wrapper.text()).toContain('Identifiant ou mot de passe incorrect.')
    expect((wrapper.get('input[type="password"]').element as HTMLInputElement).value).toBe('')
    wrapper.unmount()
  })

  it('une erreur du serveur garde le mot de passe saisi et ne rouvre pas de seconde demande', async () => {
    const fetchMock = await expiredSession({
      login: { status: 500, code: 'INTERNAL_ERROR', message: 'Erreur interne.' },
    })
    const wrapper = openDialog()

    await fillAndConfirm(wrapper, 'mot-de-passe-fictif')

    expect(wrapper.text()).toContain('Erreur interne.')
    expect((wrapper.get('input[type="password"]').element as HTMLInputElement).value).toBe(
      'mot-de-passe-fictif',
    )
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url) === '/api/v1/auth/login'),
    ).toHaveLength(1)
    wrapper.unmount()
  })

  it('une double soumission (Entrée deux fois) ne lance qu’une connexion', async () => {
    const fetchMock = await expiredSession({ login: meResponse(['payment.collect']) })
    const wrapper = openDialog()
    await flushPromises()
    await wrapper.get('input[type="password"]').setValue('mot-de-passe-fictif')

    const form = wrapper.get('form')
    await form.trigger('submit')
    await form.trigger('submit')
    await flushPromises()

    expect(
      fetchMock.mock.calls.filter(([url]) => String(url) === '/api/v1/auth/login'),
    ).toHaveLength(1)
    wrapper.unmount()
  })

  it('serveur injoignable pendant la reconnexion : message clair, rien n’est perdu', async () => {
    await expiredSession({})
    const wrapper = openDialog()

    await fillAndConfirm(wrapper, 'mot-de-passe-fictif')

    expect(wrapper.emitted('reauthenticated')).toBeUndefined()
    expect(wrapper.text()).toContain('Serveur injoignable')
    wrapper.unmount()
  })

  it('sans mot de passe saisi : message, aucun appel', async () => {
    const fetchMock = await expiredSession({ login: meResponse(['payment.collect']) })
    fetchMock.mockClear()
    const wrapper = openDialog()
    await flushPromises()

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Se reconnecter')
      ?.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Saisissez votre mot de passe.')
    expect(fetchMock).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('aucun compte connu sur cet écran : pas de reconnexion possible, message', async () => {
    stubServer({ me: 'anonymous' })
    const wrapper = openDialog()
    await flushPromises()

    expect(wrapper.text()).toContain('Aucun compte connu sur cet écran')
    wrapper.unmount()
  })
})
