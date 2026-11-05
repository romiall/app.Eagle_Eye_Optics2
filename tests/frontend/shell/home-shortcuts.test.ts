import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  APP_MODULES,
  visibleWorkShortcuts,
  WORK_GROUP_LABELS,
  WORK_SHORTCUTS,
} from '@/app/navigation'

/**
 * Accueil par profil : raccourcis de travail regroupés par activité, chacun rattaché à une tâche du backlog,
 * à des permissions du référentiel et à un module de la navigation ; visibles seulement avec le droit ET le
 * module ouvert. Les comptes des profils seedés voient chacun leurs activités, jamais celles des autres.
 */
const ROOT = join(import.meta.dirname, '..', '..', '..')
const ALL = APP_MODULES.map((module) => module.id)

function backlogTaskIds(): Set<string> {
  const backlog = JSON.parse(
    readFileSync(join(ROOT, 'specifications', 'developpement', 'backlog.json'), 'utf8'),
  ) as { tasks: { id: string }[] }
  return new Set(backlog.tasks.map((task) => task.id))
}

function seededPermissions(): Set<string> {
  const sql = readFileSync(join(ROOT, 'database', '02_reference_data.sql'), 'utf8')
  const start = sql.indexOf('INSERT INTO `permissions`')
  const block = sql.slice(start, sql.indexOf(';', start))
  return new Set([...block.matchAll(/\('([a-z_.]+)',/g)].map((match) => match[1] ?? ''))
}

/** Permissions seedées par profil (`role_permissions`). */
function rolePermissions(role: string): string[] {
  const sql = readFileSync(join(ROOT, 'database', '02_reference_data.sql'), 'utf8')
  return [...sql.matchAll(new RegExp(`\\('${role}', '([a-z_.]+)'\\)`, 'g'))].map(
    (match) => match[1] ?? '',
  )
}

describe('raccourcis de travail de l’accueil', () => {
  it('chaque raccourci est rattaché à une tâche, des permissions seedées et un module connu', () => {
    const tasks = backlogTaskIds()
    const permissions = seededPermissions()
    const modules = new Set(ALL)
    for (const shortcut of WORK_SHORTCUTS) {
      expect(tasks.has(shortcut.deliveredBy), shortcut.id).toBe(true)
      expect(shortcut.permissions.length, shortcut.id).toBeGreaterThan(0)
      for (const permission of shortcut.permissions) {
        expect(permissions.has(permission), `${shortcut.id} → ${permission}`).toBe(true)
      }
      expect(modules.has(shortcut.module ?? ''), shortcut.id).toBe(true)
      expect(shortcut.path.startsWith('/'), shortcut.id).toBe(true)
      expect(Object.keys(WORK_GROUP_LABELS)).toContain(shortcut.group)
    }
    const ids = WORK_SHORTCUTS.map((shortcut) => shortcut.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('l’accueil voit l’arrivée, jamais les examens, la caisse ni l’administration', () => {
    const groups = visibleWorkShortcuts(rolePermissions('RECEPTION'), ALL).map((s) => s.group)
    expect(groups).toContain('reception')
    expect(groups).not.toContain('exams')
    expect(groups).not.toContain('cash')
    expect(groups).not.toContain('administration')
  })

  it('le professionnel voit ses examens, la caisse voit la caisse et les factures', () => {
    const clinician = visibleWorkShortcuts(rolePermissions('CLINICIAN'), ALL).map((s) => s.id)
    expect(clinician).toContain('start-exam')
    expect(clinician).toContain('exams-in-progress')
    expect(clinician).toContain('exams-today')
    expect(clinician).not.toContain('cash-session')
    expect(clinician).not.toContain('staff')

    const cashier = visibleWorkShortcuts(rolePermissions('CASHIER'), ALL).map((s) => s.id)
    expect(cashier).toContain('cash-session')
    expect(cashier).toContain('invoices')
    expect(cashier).not.toContain('exams-today')
    expect(cashier).not.toContain('start-exam')
    expect(cashier).not.toContain('staff')
  })

  it('la gérante voit l’administration ; un module fermé retire ses raccourcis', () => {
    const manager = rolePermissions('MANAGER')
    expect(visibleWorkShortcuts(manager, ALL).map((s) => s.id)).toEqual(
      expect.arrayContaining(['staff', 'clinic-settings', 'catalog']),
    )
    const withoutSettings = visibleWorkShortcuts(
      manager,
      ALL.filter((code) => code !== 'settings'),
    ).map((s) => s.id)
    expect(withoutSettings).not.toContain('staff')
    expect(withoutSettings).toContain('catalog')
    expect(visibleWorkShortcuts(manager, [])).toEqual([])
  })

  it('aucune adresse de raccourci ne porte de donnée de santé (filtres seulement)', () => {
    for (const shortcut of WORK_SHORTCUTS) {
      const query = shortcut.path.split('?')[1] ?? ''
      for (const [key] of new URLSearchParams(query)) {
        // « nouvelle » n'est pas une donnée : il ouvre la boîte « Nouvelle consultation » de l'écran des examens.
        expect(['jour', 'etat', 'mes', 'nouvelle'], shortcut.id).toContain(key)
      }
    }
  })
})
