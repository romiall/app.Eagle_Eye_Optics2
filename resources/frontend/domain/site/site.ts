import type {
  Publication,
  SaveCatalogPublicationRequest,
  SavePublicContentRequest,
} from '@/domain/contracts/generated'

/**
 * Règles de l'écran du site public (L3D02, EE039) côté gérante : seules les fiches PUBLIÉES et les contenus APPROUVÉS
 * sortent de l'application. Le serveur rejuge tout (article visible, droits, versions) ; ces règles évitent un aller-retour
 * pour une faute de saisie évidente et nomment le champ en cause.
 */
export const TITLE_MAX = 180
export const DESCRIPTION_MIN = 10
export const DESCRIPTION_MAX = 2000
export const CONTENT_MAX = 4000
export const STYLE_MAX = 100
export const ALT_MIN = 3
export const ALT_MAX = 255
export const RIGHTS_MIN = 3
export const RIGHTS_MAX = 1000
export const MEDIA_MAX_BYTES = 3_145_728
export const MEDIA_TYPES: readonly string[] = ['image/jpeg', 'image/png', 'image/webp']

export const PUBLICATION_STATUS_LABELS = {
  DRAFT: 'Brouillon',
  PUBLISHED: 'Publiée sur le site',
  ARCHIVED: 'Archivée',
} as const

export const CONTENT_STATUS_LABELS = {
  DRAFT: 'Brouillon',
  PUBLISHED: 'Publié sur le site',
  ARCHIVED: 'Archivé',
} as const

export interface PublicationForm {
  catalogItemId: string
  title: string
  description: string
  style: string
  showPrice: boolean
  displayOrder: string
}

export type PublicationField = 'catalogItemId' | 'title' | 'description' | 'style' | 'displayOrder'
export type PublicationErrors = Partial<Record<PublicationField, string>>

export function emptyPublicationForm(): PublicationForm {
  return {
    catalogItemId: '',
    title: '',
    description: '',
    style: '',
    showPrice: false,
    displayOrder: '0',
  }
}

export function publicationFormOf(publication: Publication): PublicationForm {
  return {
    catalogItemId: publication.catalog_item_id,
    title: publication.public_title,
    description: publication.public_description,
    style: publication.style ?? '',
    showPrice: publication.show_sale_price,
    displayOrder: String(publication.display_order),
  }
}

export function validatePublicationForm(
  form: PublicationForm,
  creating: boolean,
): PublicationErrors {
  const errors: PublicationErrors = {}
  if (creating && form.catalogItemId === '') {
    errors.catalogItemId = 'Choisissez l’article du catalogue décrit par la fiche.'
  }
  const title = form.title.trim()
  if (title.length < 2 || title.length > TITLE_MAX) {
    errors.title = `Le titre public compte de 2 à ${TITLE_MAX} caractères.`
  }
  const description = form.description.trim()
  if (description.length < DESCRIPTION_MIN || description.length > DESCRIPTION_MAX) {
    errors.description = `La description publique compte de ${DESCRIPTION_MIN} à ${DESCRIPTION_MAX} caractères.`
  }
  if (form.style.trim().length > STYLE_MAX) {
    errors.style = `Le style compte au plus ${STYLE_MAX} caractères.`
  }
  if (!/^\d{1,4}$/.test(form.displayOrder.trim())) {
    errors.displayOrder = 'L’ordre d’affichage est un nombre entier de 0 à 9999.'
  }
  return errors
}

/** Champ du formulaire d'une fiche pour un nom de champ du serveur (refus 422), ou null s'il n'a pas de champ. */
export function publicationFieldFromServer(key: string): PublicationField | null {
  switch (key) {
    case 'catalog_item_id':
      return 'catalogItemId'
    case 'public_title':
      return 'title'
    case 'public_description':
      return 'description'
    case 'style':
      return 'style'
    case 'display_order':
      return 'displayOrder'
    default:
      return null
  }
}

export function hasErrors(errors: Record<string, string | undefined>): boolean {
  return Object.values(errors).some((message) => message !== undefined)
}

/** Corps de la création (version nulle) ou de la modification (version lue). */
export function buildPublicationRequest(
  form: PublicationForm,
  version: number | null,
  creating: boolean,
): SaveCatalogPublicationRequest {
  const style = form.style.trim()
  return {
    expected_version: version,
    ...(creating ? { catalog_item_id: form.catalogItemId } : {}),
    public_title: form.title.trim(),
    public_description: form.description.trim(),
    style: style === '' ? null : style,
    show_sale_price: form.showPrice,
    display_order: Number.parseInt(form.displayOrder.trim(), 10),
  } as SaveCatalogPublicationRequest
}

export type MediaField = 'file' | 'alt' | 'rights'
export type MediaErrors = Partial<Record<MediaField, string>>

export function validateMedia(
  file: { type: string; size: number } | null,
  alt: string,
  rights: string,
): MediaErrors {
  const errors: MediaErrors = {}
  if (file === null) {
    errors.file = 'Choisissez une image.'
  } else if (!MEDIA_TYPES.includes(file.type)) {
    errors.file = 'Seules les images JPEG, PNG et WebP sont acceptées.'
  } else if (file.size > MEDIA_MAX_BYTES) {
    errors.file = 'L’image dépasse 3 Mo : réduisez-la avant de la déposer.'
  }
  const altText = alt.trim()
  if (altText.length < ALT_MIN || altText.length > ALT_MAX) {
    errors.alt = `Le texte alternatif décrit l’image en ${ALT_MIN} à ${ALT_MAX} caractères.`
  }
  const note = rights.trim()
  if (note.length < RIGHTS_MIN || note.length > RIGHTS_MAX) {
    errors.rights =
      'La note de droits est obligatoire : qui a pris ou fourni la photo, et l’autorisation de la publier.'
  }
  return errors
}

export interface ContentForm {
  title: string
  content: string
}

export type ContentField = 'title' | 'content'
export type ContentErrors = Partial<Record<ContentField, string>>

/** Numéro WhatsApp : chiffres seuls, indicatif compris, de 8 à 15 chiffres (lien https://wa.me/<numéro>). */
export function whatsappDigits(text: string): string | null {
  const digits = text.replace(/[\s().-]+/g, '').replace(/^\+/, '')
  return /^\d{8,15}$/.test(digits) ? digits : null
}

export function validateContent(code: string, form: ContentForm): ContentErrors {
  const errors: ContentErrors = {}
  const title = form.title.trim()
  if (title.length < 2 || title.length > TITLE_MAX) {
    errors.title = `Le titre compte de 2 à ${TITLE_MAX} caractères.`
  }
  const content = form.content.trim()
  if (content === '' || content.length > CONTENT_MAX) {
    errors.content = `Le contenu compte de 1 à ${CONTENT_MAX} caractères.`
  } else if (code === 'WHATSAPP' && whatsappDigits(content) === null) {
    errors.content =
      'Écrivez le numéro WhatsApp en chiffres, avec l’indicatif du pays (exemple : 237600000000).'
  }
  return errors
}

export function buildContentRequest(code: string, form: ContentForm): SavePublicContentRequest {
  return {
    expected_version: null,
    code,
    title: form.title.trim(),
    content: form.content.trim(),
  } as SavePublicContentRequest
}
