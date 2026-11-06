// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * « Commandes d'une ancienne version encore reprises » (O06 ; fiche : « conserver anciens templates/règles » ; contrat
 * 23) : une release garde TOUTES les versions que les releases publiées savaient lire — règles, versions de commande,
 * événements, formats de coffre, schémas locaux, modèles de documents. Un poste qui n'a pas installé la nouvelle version
 * peut détenir des pièces dans une version ancienne ; la retirer les laisserait sans issue.
 *
 * Les releases mises en ligne sont figées dans `tests/frontend/offline/published/` (une copie de la déclaration par
 * livraison). La déclaration COURANTE doit contenir chacune d'elles ; ajouter une version est libre, en retirer une fait
 * échouer ce test. Le refus par le serveur d'une version non déclarée est éprouvé côté PHP (tests/Contracts).
 */
interface Declaration {
  release: string
  rules_versions: string[]
  commands: Record<string, string[]>
  events: Record<string, number[]>
  vault_formats: number[]
  local_schema_versions: number[]
  document_templates: { document_type: string; template_version: string }[]
}

const ROOT = process.cwd()
const PUBLISHED_DIRECTORY = join(ROOT, 'tests/frontend/offline/published')

function read(path: string): Declaration {
  return JSON.parse(readFileSync(path, 'utf8')) as Declaration
}

/** Ce que `current` ne contient plus de `published` : une ligne lisible par version retirée. */
function removedVersions(published: Declaration, current: Declaration): string[] {
  const removed: string[] = []
  for (const version of published.rules_versions) {
    if (!current.rules_versions.includes(version)) removed.push(`règles ${version}`)
  }
  for (const [name, versions] of Object.entries(published.commands)) {
    for (const version of versions) {
      if (!(current.commands[name] ?? []).includes(version)) {
        removed.push(`commande ${name} v${version}`)
      }
    }
  }
  for (const [name, versions] of Object.entries(published.events)) {
    for (const version of versions) {
      if (!(current.events[name] ?? []).includes(version))
        removed.push(`événement ${name} v${version}`)
    }
  }
  for (const format of published.vault_formats) {
    if (!current.vault_formats.includes(format)) removed.push(`format de coffre ${format}`)
  }
  for (const version of published.local_schema_versions) {
    if (!current.local_schema_versions.includes(version)) removed.push(`schéma local v${version}`)
  }
  for (const template of published.document_templates) {
    const kept = current.document_templates.some(
      (candidate) =>
        candidate.document_type === template.document_type &&
        candidate.template_version === template.template_version,
    )
    if (!kept) removed.push(`modèle ${template.document_type} ${template.template_version}`)
  }
  return removed
}

const current = read(join(ROOT, 'contracts/compatibility.json'))
const files = readdirSync(PUBLISHED_DIRECTORY)
  .filter((name) => name.endsWith('.json'))
  .sort()

describe('une release garde les versions des releases déjà publiées', () => {
  it('au moins une release publiée est figée (celle qui tourne en production)', () => {
    expect(files.length).toBeGreaterThanOrEqual(1)
  })

  it.each(files)('la déclaration courante contient tout ce que %s savait lire', (file) => {
    expect(removedVersions(read(join(PUBLISHED_DIRECTORY, file)), current)).toEqual([])
  })

  it('le contrôle voit chaque sorte de retrait (le test n’est pas aveugle)', () => {
    const published = read(join(PUBLISHED_DIRECTORY, files[0] ?? ''))
    const without = (change: (copy: Declaration) => void): string[] => {
      const copy = structuredClone(current)
      change(copy)
      return removedVersions(published, copy)
    }
    expect(without((copy) => (copy.rules_versions = []))[0]).toMatch(/^règles /)
    expect(without((copy) => delete copy.commands['RegisterPayment'])).toContain(
      'commande RegisterPayment v1',
    )
    expect(without((copy) => (copy.commands['CreatePatient'] = ['2']))).toContain(
      'commande CreatePatient v1',
    )
    expect(without((copy) => delete copy.events['InvoiceIssued'])).toContain(
      'événement InvoiceIssued v1',
    )
    expect(without((copy) => (copy.vault_formats = []))).toContain('format de coffre 1')
    expect(without((copy) => (copy.local_schema_versions = [1, 2, 3, 4]))).toContain(
      'schéma local v5',
    )
    expect(
      without(
        (copy) =>
          (copy.document_templates = copy.document_templates.filter(
            (template) => template.template_version !== 'receipt.v1',
          )),
      ),
    ).toContain('modèle RECEIPT receipt.v1')
  })

  it('ajouter une version est libre : une déclaration plus riche ne retire rien', () => {
    const richer = structuredClone(current)
    richer.rules_versions.push('2099-01-01.1')
    richer.commands['RegisterPayment'] = ['1', '2']
    richer.local_schema_versions.push(99)
    for (const file of files) {
      expect(removedVersions(read(join(PUBLISHED_DIRECTORY, file)), richer)).toEqual([])
    }
  })
})
