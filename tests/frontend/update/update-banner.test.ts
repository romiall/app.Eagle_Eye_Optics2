import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetAppUpdateForTests, watchServiceWorkerUpdates } from '@/app/services/appUpdate'
import AppVersion from '@/components/update/AppVersion.vue'
import UpdatePrompt from '@/components/update/UpdatePrompt.vue'
import type { UpdateReadiness } from '@/offline/update/updateGate'

import { fakeEnvironment, FakeWorkbox, type FakeEnvironment } from './support'

/**
 * Bandeau de mise à jour et pied de page « Version » (O06). Ce que le demandeur n'a pas vu le 2026-10-30 est ici une
 * exigence mesurée : le bandeau est collé en haut, ne se masque pas, dit en français ce que l'installation fait et ne
 * fait pas, explique un blocage, et le pied de page dit quelle version tourne. Le navigateur réel (service worker,
 * défilement, 360 px) est mesuré par tests/e2e/app-update.spec.ts.
 */
const vault = vi.hoisted(() => ({ updateReadinessForThisDevice: vi.fn() }))
vi.mock('@/app/services/vault', () => vault)

const FREE: UpdateReadiness = { decision: 'FREE', reasons: [], pendingCount: 0 }
const CONFIRM: UpdateReadiness = {
  decision: 'CONFIRM',
  pendingCount: 2,
  reasons: [
    {
      code: 'PENDING_COMMANDS',
      blocking: false,
      message: '2 pièces enregistrées sur ce poste attendent la synchronisation.',
    },
    { code: 'NO_RECENT_EXPORT', blocking: false, message: 'Aucun export chiffré récent du poste.' },
  ],
}
const BLOCKED: UpdateReadiness = {
  decision: 'BLOCKED',
  pendingCount: 1,
  reasons: [
    {
      code: 'COMPATIBILITY_UNKNOWN',
      blocking: true,
      message: 'Le serveur est injoignable : installez après une synchronisation.',
    },
  ],
}

let workbox: FakeWorkbox
let environment: FakeEnvironment
let wrapper: VueWrapper | null = null

function mountPrompt(): VueWrapper {
  wrapper = mount(UpdatePrompt, { attachTo: document.body })
  return wrapper
}

async function announce(readiness: UpdateReadiness): Promise<void> {
  vault.updateReadinessForThisDevice.mockResolvedValue(readiness)
  workbox.emit('waiting')
  await flushPromises()
}

function button(label: string | RegExp) {
  const found = wrapper
    ?.findAll('button')
    .find((candidate) =>
      typeof label === 'string'
        ? candidate.text().trim() === label
        : label.test(candidate.text().trim()),
    )
  return found
}

beforeEach(() => {
  workbox = new FakeWorkbox()
  environment = fakeEnvironment()
  watchServiceWorkerUpdates(workbox.asWorkbox(), environment)
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  resetAppUpdateForTests()
  document.body.innerHTML = ''
  document.documentElement.classList.remove('has-update-banner')
})

describe('bandeau « nouvelle version »', () => {
  it('n’affiche rien tant qu’aucune version n’attend', async () => {
    mountPrompt()
    await flushPromises()
    expect(wrapper?.find('section').exists()).toBe(false)
    expect(document.documentElement.classList.contains('has-update-banner')).toBe(false)
  })

  it('est collé en haut de l’écran, nommé, et ne peut pas être masqué', async () => {
    mountPrompt()
    await announce(FREE)
    const section = wrapper?.find('section')
    expect(section?.exists()).toBe(true)
    expect(section?.attributes('role')).toBe('region')
    expect(section?.classes()).toEqual(expect.arrayContaining(['sticky', 'top-0']))
    expect(wrapper?.find('h2').text()).toBe('Une nouvelle version de l’application est prête')
    // Aucun moyen de le faire disparaître : ni « Plus tard », ni fermeture.
    expect(button('Plus tard')).toBeUndefined()
    expect(button(/Fermer|Ignorer/)).toBeUndefined()
    // La page réserve la place du bandeau pour les ancres et le focus.
    expect(document.documentElement.classList.contains('has-update-banner')).toBe(true)
  })

  it('dit sans détour que l’ancienne version est encore affichée', async () => {
    mountPrompt()
    await announce(FREE)
    const text = wrapper?.text() ?? ''
    expect(text).toContain('Vous utilisez encore l’ancienne version')
    expect(text).toContain(
      'les corrections récentes ne s’affichent pas tant que vous ne l’installez pas',
    )
    expect(text).toContain('Aucune pièce n’attend sur ce poste')
  })

  it('les détails expliquent ce que l’installation fait, ne fait pas, et ce qu’il faut faire avant', async () => {
    mountPrompt()
    await announce(FREE)
    const toggle = button('Voir les détails')
    expect(toggle?.attributes('aria-expanded')).toBe('false')
    expect(wrapper?.find('#details-mise-a-jour').exists()).toBe(false)
    await toggle?.trigger('click')
    expect(button('Masquer les détails')?.attributes('aria-expanded')).toBe('true')
    const details = wrapper?.find('#details-mise-a-jour').text() ?? ''
    expect(details).toContain('Ce que fait l’installation')
    expect(details).toContain('Elle recharge cette page avec la nouvelle version')
    expect(details).toContain('Ce qu’elle ne fait pas')
    expect(details).toContain('Elle ne supprime rien')
    expect(details).toContain('Vous restez connecté au serveur')
    expect(details).toContain('il est de nouveau verrouillé')
    expect(details).toContain('fermez les autres onglets')
    await button('Masquer les détails')?.trigger('click')
    expect(wrapper?.find('#details-mise-a-jour').exists()).toBe(false)
    expect(wrapper?.find('section').exists()).toBe(true)
  })

  it('sans blocage ni pièce en attente, un clic installe et la page se recharge à la prise de contrôle', async () => {
    mountPrompt()
    await announce(FREE)
    await button('Installer la nouvelle version')?.trigger('click')
    await flushPromises()
    expect(workbox.messageSkipWaiting).toHaveBeenCalledTimes(1)
    expect(wrapper?.text()).toContain('La page va se recharger dans un instant.')
    workbox.emit('controlling')
    expect(environment.reload).toHaveBeenCalledTimes(1)
  })

  it('des pièces en attente : lecture des points puis confirmation, et « Annuler » renonce', async () => {
    mountPrompt()
    await announce(CONFIRM)
    await button('Installer la nouvelle version')?.trigger('click')
    await flushPromises()
    expect(workbox.messageSkipWaiting).not.toHaveBeenCalled()
    expect(wrapper?.text()).toContain('Lisez les points ci-dessous, puis confirmez l’installation.')
    expect(wrapper?.text()).toContain(
      '2 pièces enregistrées sur ce poste attendent la synchronisation.',
    )
    expect(wrapper?.text()).toContain('Aucun export chiffré récent du poste.')

    await button('Annuler')?.trigger('click')
    expect(button('Installer la nouvelle version')).toBeDefined()
    expect(wrapper?.text()).not.toContain('Lisez les points ci-dessous')

    await button('Installer la nouvelle version')?.trigger('click')
    await flushPromises()
    await button('Confirmer l’installation')?.trigger('click')
    await flushPromises()
    expect(workbox.messageSkipWaiting).toHaveBeenCalledTimes(1)
  })

  it('un blocage grise l’installation, se lit en rouge sans ouvrir les détails, et se revérifie', async () => {
    mountPrompt()
    await announce(BLOCKED)
    const install = button('Installer la nouvelle version')
    expect(install?.attributes('disabled')).toBeDefined()
    const blocking = wrapper?.find('ul.text-danger')
    expect(blocking?.text()).toContain('Le serveur est injoignable')
    expect(wrapper?.find('#details-mise-a-jour').exists()).toBe(false)

    vault.updateReadinessForThisDevice.mockResolvedValue(FREE)
    await button('Vérifier de nouveau')?.trigger('click')
    await flushPromises()
    expect(button('Installer la nouvelle version')?.attributes('disabled')).toBeUndefined()
    expect(button('Vérifier de nouveau')).toBeUndefined()
  })

  it('une installation qui n’aboutit pas invite à recharger la page', async () => {
    mountPrompt()
    await announce(FREE)
    await button('Installer la nouvelle version')?.trigger('click')
    await flushPromises()
    environment.fireStall()
    await flushPromises()
    expect(wrapper?.text()).toContain(
      'L’installation n’a pas abouti. Rechargez la page, puis recommencez.',
    )
    await button('Recharger la page')?.trigger('click')
    expect(environment.reload).toHaveBeenCalledTimes(1)
  })

  it('quand une autre fenêtre a installé la version, cette page est priée de se recharger', async () => {
    mountPrompt()
    await announce(FREE)
    workbox.emit('controlling')
    await flushPromises()
    expect(wrapper?.find('h2').text()).toContain('Cette page doit être rechargée')
    expect(wrapper?.text()).toContain('rien n’est supprimé')
    expect(button('Installer la nouvelle version')).toBeUndefined()
    await button('Recharger la page')?.trigger('click')
    expect(environment.reload).toHaveBeenCalledTimes(1)
  })

  it('le bandeau se retire de lui-même quand il n’y a plus rien à installer', async () => {
    mountPrompt()
    await announce(FREE)
    expect(document.documentElement.classList.contains('has-update-banner')).toBe(true)
    wrapper?.unmount()
    wrapper = null
    expect(document.documentElement.classList.contains('has-update-banner')).toBe(false)
  })
})

describe('pied de page « Version de l’application »', () => {
  function mountFooter(): VueWrapper {
    wrapper = mount(AppVersion, { attachTo: document.body })
    return wrapper
  }

  it('dit la version exécutée, à l’heure du cabinet', () => {
    mountFooter()
    expect(wrapper?.find('footer').exists()).toBe(true)
    expect(wrapper?.text()).toContain(
      'Version de l’application : build test-build, construite le 22 octobre 2026 à 11h00.',
    )
  })

  it('propose de chercher une nouvelle version et annonce le résultat sans déplacer le focus', async () => {
    mountFooter()
    await flushPromises()
    expect(wrapper?.find('[role="status"]').exists()).toBe(true)
    expect(wrapper?.find('[role="status"]').text()).toBe('')

    await button('Vérifier les mises à jour')?.trigger('click')
    await flushPromises()
    expect(workbox.update).toHaveBeenCalledTimes(1)
    expect(wrapper?.find('[role="status"]').text()).toBe(
      'Vous utilisez la dernière version publiée.',
    )

    workbox.update.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await button('Vérifier les mises à jour')?.trigger('click')
    await flushPromises()
    expect(wrapper?.find('[role="status"]').text()).toContain('La recherche a échoué')

    vault.updateReadinessForThisDevice.mockResolvedValue(FREE)
    workbox.emit('waiting')
    await flushPromises()
    expect(wrapper?.find('[role="status"]').text()).toContain('installez-la depuis le bandeau')
  })

  it('sans service worker (serveur de développement), pas de bouton de recherche', () => {
    resetAppUpdateForTests()
    watchServiceWorkerUpdates(null, environment)
    mountFooter()
    expect(button('Vérifier les mises à jour')).toBeUndefined()
    expect(wrapper?.text()).toContain('Version de l’application')
  })
})
