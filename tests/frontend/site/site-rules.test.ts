import { describe, expect, it } from 'vitest'

import type { Publication } from '@/domain/contracts/generated'
import {
  buildContentRequest,
  buildPublicationRequest,
  emptyPublicationForm,
  hasErrors,
  publicationFieldFromServer,
  publicationFormOf,
  validateContent,
  validateMedia,
  validatePublicationForm,
  whatsappDigits,
} from '@/domain/site/site'

// Règles de l'écran du site public (L3D02, EE039), côté gérante : le serveur rejuge tout, ces règles nomment le champ en
// cause sans aller-retour. Données FICTIVES.
const ITEM = '01J9ZXK4M2Q8R7S6T5V4WF0001'

const VALID = {
  ...emptyPublicationForm(),
  catalogItemId: ITEM,
  title: 'Monture légère fictive',
  description: 'Une monture légère pour tous les jours, donnée fictive.',
}

describe('fiche du showroom', () => {
  it('une fiche complète ne signale aucune erreur', () => {
    expect(hasErrors(validatePublicationForm(VALID, true))).toBe(false)
  })

  it('nomme chaque champ en faute, et n’exige l’article qu’à la création', () => {
    const errors = validatePublicationForm(
      { ...emptyPublicationForm(), title: 'A', description: 'courte', displayOrder: '12a' },
      true,
    )
    expect(Object.keys(errors).sort()).toEqual([
      'catalogItemId',
      'description',
      'displayOrder',
      'title',
    ])
    expect(validatePublicationForm({ ...VALID, catalogItemId: '' }, false)).toEqual({})
  })

  it('refuse un titre trop long, une description trop longue et un style trop long', () => {
    const errors = validatePublicationForm(
      {
        ...VALID,
        title: 'x'.repeat(181),
        description: 'y'.repeat(2001),
        style: 'z'.repeat(101),
      },
      true,
    )
    expect(Object.keys(errors).sort()).toEqual(['description', 'style', 'title'])
  })

  it('construit la création sans version et la modification sans changer d’article', () => {
    const created = buildPublicationRequest({ ...VALID, style: '  sport ' }, null, true)
    expect(created).toEqual({
      expected_version: null,
      catalog_item_id: ITEM,
      public_title: 'Monture légère fictive',
      public_description: 'Une monture légère pour tous les jours, donnée fictive.',
      style: 'sport',
      show_sale_price: false,
      display_order: 0,
    })
    const edited = buildPublicationRequest(
      { ...VALID, showPrice: true, displayOrder: '3' },
      4,
      false,
    )
    expect(edited).toMatchObject({
      expected_version: 4,
      show_sale_price: true,
      display_order: 3,
      style: null,
    })
    expect(edited).not.toHaveProperty('catalog_item_id')
  })

  it('reprend une fiche du serveur dans le formulaire', () => {
    const publication = {
      catalog_item_id: ITEM,
      public_title: 'Titre',
      public_description: 'Description publique suffisante.',
      style: null,
      show_sale_price: true,
      display_order: 7,
    } as Publication
    expect(publicationFormOf(publication)).toEqual({
      catalogItemId: ITEM,
      title: 'Titre',
      description: 'Description publique suffisante.',
      style: '',
      showPrice: true,
      displayOrder: '7',
    })
  })

  it('associe les champs du serveur à ceux du formulaire', () => {
    expect(publicationFieldFromServer('public_title')).toBe('title')
    expect(publicationFieldFromServer('catalog_item_id')).toBe('catalogItemId')
    expect(publicationFieldFromServer('slug')).toBeNull()
  })
})

describe('image d’une fiche', () => {
  const PNG = { type: 'image/png', size: 2048 }

  it('exige le fichier, son texte alternatif et sa note de droits', () => {
    expect(Object.keys(validateMedia(null, '', '')).sort()).toEqual(['alt', 'file', 'rights'])
    expect(
      hasErrors(
        validateMedia(PNG, 'Monture vue de face', 'Photo du cabinet, publication autorisée'),
      ),
    ).toBe(false)
  })

  it('refuse un format autre que JPEG, PNG ou WebP et une image de plus de 3 Mo', () => {
    expect(
      validateMedia({ type: 'image/gif', size: 100 }, 'Monture vue de face', 'Photo du cabinet')
        .file,
    ).toMatch(/JPEG, PNG et WebP/)
    expect(
      validateMedia(
        { type: 'image/png', size: 3_145_729 },
        'Monture vue de face',
        'Photo du cabinet',
      ).file,
    ).toMatch(/3 Mo/)
    expect(
      validateMedia(
        { type: 'image/webp', size: 3_145_728 },
        'Monture vue de face',
        'Photo du cabinet',
      ).file,
    ).toBeUndefined()
  })

  it('la note de droits est obligatoire : une note vide ou d’espaces est refusée', () => {
    expect(validateMedia(PNG, 'Monture vue de face', '   ').rights).toMatch(/obligatoire/)
  })
})

describe('contenus du site', () => {
  it('exige un titre et un texte', () => {
    expect(Object.keys(validateContent('ACCUEIL', { title: '', content: '' })).sort()).toEqual([
      'content',
      'title',
    ])
    expect(
      hasErrors(validateContent('ACCUEIL', { title: 'Bienvenue', content: 'Texte fictif.' })),
    ).toBe(false)
  })

  it('n’accepte pour WhatsApp qu’un numéro de 8 à 15 chiffres, indicatif compris', () => {
    expect(whatsappDigits('+237 600 00 00 00')).toBe('237600000000')
    expect(whatsappDigits('(237) 600-000-000')).toBe('237600000000')
    expect(whatsappDigits('600')).toBeNull()
    expect(whatsappDigits('appelez-nous')).toBeNull()
    expect(whatsappDigits('1234567890123456')).toBeNull()
    expect(
      validateContent('WHATSAPP', { title: 'WhatsApp', content: 'appelez-nous' }).content,
    ).toMatch(/indicatif/)
    expect(validateContent('WHATSAPP', { title: 'WhatsApp', content: '237600000000' })).toEqual({})
  })

  it('construit un brouillon sans version attendue', () => {
    expect(
      buildContentRequest('HORAIRES', { title: ' Horaires ', content: ' Lundi au samedi. ' }),
    ).toEqual({
      expected_version: null,
      code: 'HORAIRES',
      title: 'Horaires',
      content: 'Lundi au samedi.',
    })
  })
})
