import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  APP_MODULES,
  type AppModule,
  HOME_ACTIONS,
  type NavigationEntry,
  visibleHomeActions,
  visibleModules,
} from '@/app/navigation'

const ROOT = join(import.meta.dirname, '..', '..', '..')

/** Modules ouverts par l'exploitant : tous (les tests de filtrage le restreignent). */
const ALL_MODULES = APP_MODULES.map((module) => module.id)

/** Identifiants des tâches du backlog (plan d'exécution, jamais régénéré ici). */
function backlogTaskIds(): Set<string> {
  const backlog = JSON.parse(
    readFileSync(join(ROOT, 'specifications', 'developpement', 'backlog.json'), 'utf8'),
  ) as { tasks: { id: string }[] }
  return new Set(backlog.tasks.map((task) => task.id))
}

/** Codes du référentiel `permissions` seedé (database/02_reference_data.sql). */
function seededPermissions(): Set<string> {
  const sql = readFileSync(join(ROOT, 'database', '02_reference_data.sql'), 'utf8')
  const start = sql.indexOf('INSERT INTO `permissions`')
  const end = sql.indexOf(';', start)
  const block = sql.slice(start, end)
  return new Set(
    [...block.matchAll(/\('([a-z_]+(?:\.[a-z_]+)+)',/g)].map((match) => match[1] ?? ''),
  )
}

function fake(id: string, permissions: string[], delivered: boolean, mobile = false): AppModule {
  return {
    id,
    label: id,
    path: `/${id}`,
    permissions,
    deliveredBy: 'P01',
    delivered,
    mobileShortcut: mobile,
  }
}

describe('navigation de la coquille (fichier 04)', () => {
  it('liste les modules dans l’ordre du fichier 04', () => {
    expect(APP_MODULES.map((module) => module.label)).toEqual([
      'Aujourd’hui',
      'Patients',
      'Consultations',
      'Agenda',
      'Ventes et caisse',
      'Stock',
      'Atelier',
      'Communication',
      'Rapports',
      'Paramètres',
      // Module de préparation des postes (O01 à O05) : jamais livré dans le menu, il s'ouvre depuis les Paramètres.
      'Postes hors-ligne',
    ])
  })

  it('propose sur téléphone les raccourcis Aujourd’hui, Patients et Agenda, le reste sous « Plus »', () => {
    expect(APP_MODULES.filter((module) => module.mobileShortcut).map((m) => m.label)).toEqual([
      'Aujourd’hui',
      'Patients',
      'Agenda',
    ])
  })

  it('liste les actions d’accueil du dossier patient dans l’ordre du fichier 04', () => {
    expect(HOME_ACTIONS.map((action) => action.label)).toEqual([
      'Nouveau patient',
      'Nouvelle consultation',
      'Rechercher',
      'Rendez-vous',
      'Consultations du jour',
      'Statistiques',
      'Paramètres',
    ])
  })

  it('ne présente aucun écran futur comme livré : patients, file du jour, examens, agenda, ventes, statistiques et paramètres seulement', () => {
    // Chaque tâche qui livre un écran passe son entrée à true en même temps que sa route et ses
    // tests (et met ce test à jour) : ici P01 (Nouveau patient), P02 (module Patients, Rechercher),
    // P03 (module Aujourd'hui, action « Consultations du jour » qui mène à la file du jour), S01 (agenda
    // et « Rendez-vous ») et R02 (« Statistiques »). Stock, atelier, communication, rapports financiers
    // et postes hors-ligne restent non livrés.
    const entries: readonly NavigationEntry[] = [...APP_MODULES, ...HOME_ACTIONS]
    expect(
      entries.filter((entry) => entry.delivered).map((entry) => `${entry.id}:${entry.deliveredBy}`),
    ).toEqual([
      'today:P03',
      'patients:P02',
      // Liste des examens du cabinet (C01 à C04, en ligne).
      'consultations:C01',
      // Agenda interne (S01, en ligne).
      'agenda:S01',
      // Ventes et caisse (B02 à B05, en ligne) : caisse, factures, encaissements, catalogue.
      'sales:B02',
      // Paramètres : comptes du personnel et identité du cabinet (écrans F09 des routes F05).
      'settings:F09',
      'new-patient:P01',
      // Démarrer un examen sans passer par la file du jour (boîte de l'écran des examens, C01).
      'new-consultation:C01',
      'search:P02',
      'appointment:S01',
      'consultations-today:P03',
      'statistics:R02',
      'settings:F09',
    ])

    const everything = [...seededPermissions()]
    expect(visibleModules(everything, ALL_MODULES).map((module) => module.label)).toEqual([
      'Aujourd’hui',
      'Patients',
      'Consultations',
      'Agenda',
      'Ventes et caisse',
      'Paramètres',
    ])
    expect(visibleHomeActions(everything, ALL_MODULES).map((action) => action.label)).toEqual([
      'Nouveau patient',
      'Nouvelle consultation',
      'Rechercher',
      'Rendez-vous',
      'Consultations du jour',
      'Statistiques',
      'Paramètres',
    ])
    // Livrés mais pas ouverts par l'exploitant : rien n'apparaît.
    expect(visibleModules(everything, [])).toEqual([])
    expect(visibleHomeActions(everything, ['sales', 'stock'])).toEqual([])
  })

  it('les écrans patient suivent les droits : lecture seule sans « Nouveau patient »', () => {
    const open = ['patients']
    const readOnly = ['patient.read']
    expect(visibleModules(readOnly, open).map((module) => module.id)).toEqual(['patients'])
    expect(visibleHomeActions(readOnly, open).map((action) => action.id)).toEqual(['search'])

    const reception = ['patient.read', 'patient.create', 'patient.update']
    expect(visibleHomeActions(reception, open).map((action) => action.id)).toEqual([
      'new-patient',
      'search',
    ])

    // Sans patient.read ni patient.create : aucun écran patient.
    expect(visibleModules(['invoice.read'], open)).toEqual([])
    expect(visibleHomeActions(['invoice.read'], open)).toEqual([])
  })

  it('la file du jour (P03) suit les droits de la route du serveur : visit.register OU agenda.read', () => {
    const open = ['today']
    const labels = (permissions: string[]) =>
      visibleModules(permissions, open).map((module) => module.label)
    const actions = (permissions: string[]) =>
      visibleHomeActions(permissions, open).map((action) => action.label)

    // L'une ou l'autre suffit, comme le middleware « any-permission » de GET /api/v1/visits.
    expect(labels(['visit.register'])).toEqual(['Aujourd’hui'])
    expect(labels(['agenda.read'])).toEqual(['Aujourd’hui'])
    expect(actions(['visit.register'])).toEqual(['Consultations du jour'])
    expect(actions(['agenda.read'])).toEqual(['Consultations du jour'])
    // Les anciens droits cliniques ou de facture n'ouvrent plus la file : elle est administrative.
    expect(labels(['clinical.read', 'invoice.read'])).toEqual([])
    expect(actions(['clinical.read'])).toEqual([])
    // Module fermé : rien n'apparaît, même autorisé.
    expect(visibleModules(['visit.register'], ['patients'])).toEqual([])
    expect(visibleHomeActions(['visit.register'], ['patients'])).toEqual([])

    // Le module et l'action d'accueil mènent au même écran, avec les mêmes droits que la route.
    const module = APP_MODULES.find((entry) => entry.id === 'today')
    const action = HOME_ACTIONS.find((entry) => entry.id === 'consultations-today')
    expect(module?.path).toBe('/aujourdhui')
    expect(action?.path).toBe('/aujourdhui')
    expect(module?.permissions).toEqual(['visit.register', 'agenda.read'])
    expect(action?.permissions).toEqual(module?.permissions)
  })

  it('rattache chaque entrée à une tâche du backlog et à des permissions du référentiel', () => {
    const tasks = backlogTaskIds()
    const permissions = seededPermissions()
    expect(permissions.size).toBeGreaterThan(40)

    for (const entry of [...APP_MODULES, ...HOME_ACTIONS]) {
      expect(tasks.has(entry.deliveredBy), `${entry.id} → ${entry.deliveredBy}`).toBe(true)
      expect(entry.permissions.length, entry.id).toBeGreaterThan(0)
      for (const permission of entry.permissions) {
        expect(permissions.has(permission), `${entry.id} → ${permission}`).toBe(true)
      }
      expect(entry.path.startsWith('/'), entry.id).toBe(true)
    }
    for (const entries of [APP_MODULES, HOME_ACTIONS]) {
      const ids = entries.map((entry) => entry.id)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  it('n’affiche une entrée que livrée ET autorisée, l’une des permissions suffisant', () => {
    const modules = [
      fake('livre-autorise', ['patient.read', 'agenda.read'], true),
      fake('livre-interdit', ['users.manage'], true),
      fake('non-livre', ['patient.read'], false),
    ]

    const open = modules.map((module) => module.id)
    expect(visibleModules(['agenda.read'], open, modules).map((module) => module.id)).toEqual([
      'livre-autorise',
    ])
    expect(visibleModules([], open, modules)).toEqual([])
    expect(
      visibleModules(['users.manage', 'patient.read'], open, modules).map((m) => m.id),
    ).toEqual(['livre-autorise', 'livre-interdit'])
  })

  it('montre à la caisse les actions de caisse et jamais les écrans cliniques', () => {
    const cashier = [
      'patient.read',
      'agenda.read',
      'catalog.read',
      'invoice.read',
      'payment.collect',
    ]
    const delivered = APP_MODULES.map((module) => ({ ...module, delivered: true }))

    const labels = visibleModules(cashier, ALL_MODULES, delivered).map((module) => module.label)
    expect(labels).toContain('Ventes et caisse')
    expect(labels).not.toContain('Consultations')
    expect(labels).not.toContain('Paramètres')

    const actions = visibleHomeActions(
      cashier,
      ALL_MODULES,
      HOME_ACTIONS.map((action) => ({ ...action, delivered: true })),
    ).map((action) => action.label)
    // La caisse lit la file du jour (agenda.read, identité administrative seulement) mais n'ouvre ni
    // nouveau patient, ni rendez-vous, ni statistiques, ni paramètres.
    expect(actions).toEqual(['Rechercher', 'Consultations du jour'])
  })
})

describe('mise en service progressive : un module livré reste caché tant qu’il n’est pas ouvert', () => {
  const modules = [fake('patients', ['patient.read'], true), fake('sales', ['invoice.read'], true)]
  const permissions = ['patient.read', 'invoice.read']

  it('n’affiche que les modules ouverts par l’exploitant', () => {
    expect(visibleModules(permissions, ['patients'], modules).map((m) => m.id)).toEqual([
      'patients',
    ])
    expect(visibleModules(permissions, ['sales', 'patients'], modules).map((m) => m.id)).toEqual([
      'patients',
      'sales',
    ])
  })

  it('n’affiche rien sans module ouvert, même livré et autorisé', () => {
    expect(visibleModules(permissions, [], modules)).toEqual([])
  })

  it('un module inconnu de la liste n’ouvre pas les autres', () => {
    expect(visibleModules(permissions, ['stock'], modules)).toEqual([])
  })

  it('une action d’accueil dépend de son module, pas de son identifiant', () => {
    const actions = HOME_ACTIONS.map((action) => ({ ...action, delivered: true }))

    const labels = (enabled: string[]) =>
      visibleHomeActions(['patient.create', 'patient.read', 'agenda.write'], enabled, actions).map(
        (action) => action.label,
      )

    expect(labels(['patients'])).toEqual(['Nouveau patient', 'Rechercher'])
    expect(labels(['agenda'])).toEqual(['Rendez-vous'])
    expect(labels([])).toEqual([])
  })

  it('chaque module d’action d’accueil existe dans la navigation', () => {
    const codes = new Set(APP_MODULES.map((module) => module.id))
    for (const action of HOME_ACTIONS) {
      expect(codes.has(action.module ?? action.id), action.id).toBe(true)
    }
  })

  it('les codes de la navigation sont ceux du serveur (liste de Modules.php)', () => {
    const php = readFileSync(join(ROOT, 'app', 'Support', 'Modules.php'), 'utf8')
    const block = php.slice(php.indexOf('public const CODES'), php.indexOf('];'))
    const server = [...block.matchAll(/'([a-z]+)'/g)].map((match) => match[1])
    expect(server).toEqual(APP_MODULES.map((module) => module.id))
  })
})
