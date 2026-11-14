import type { PageFormatId } from './units'

/**
 * Modèle d'un document (D01) : le CONTENU, sans aucune position. Un modèle est produit par une
 * fonction pure `build<Type>(données)` à partir d'un snapshot figé ; la mise en page (`layout.ts`)
 * puis le rendu PDF (`pdf.ts`) en déduisent des pages. Le même modèle donne toujours le même PDF
 * octet pour octet (réimpression d'une pièce : même pièce).
 *
 * Aucun champ ne porte une donnée que le document n'imprime pas : le modèle est ce qui est imprimé.
 * Les textes sont des chaînes UTF-8 normales ; leur conversion au jeu de caractères des PDF est faite
 * par la mise en page (`charset.ts`) qui signale tout caractère remplacé.
 */

/** Types de documents. Les sept premiers existent dans `generated_documents.document_type`. */
export type DocumentKind =
  | 'INVOICE'
  | 'RECEIPT'
  | 'CREDIT_NOTE'
  | 'REFUND'
  | 'ACCOUNT_STATEMENT'
  | 'QUOTE'
  | 'OPTICAL_PRESCRIPTION'
  | 'CLINICAL_RECORD'
  | 'WORKSHOP'
  // Types propres au poste : pas (encore) de valeur dans l'énumération du serveur.
  | 'MEDICATION_ORDER'
  | 'REFERRAL_LETTER'
  | 'CASH_SESSION_REPORT'

export type FontStyle = 'normal' | 'bold' | 'italic' | 'bolditalic'
export type Align = 'left' | 'right' | 'center'

/** Original, ou réimpression marquée Duplicata (jamais une nouvelle pièce, jamais renumérotée). */
export type CopyInfo =
  { kind: 'ORIGINAL' } | { kind: 'DUPLICATA'; reprintNumber: number; reprintedAt: string }

export interface FieldRow {
  label: string
  value: string
}

/** Largeur d'une colonne : millimètres fixes, ou part (`fr`) de l'espace restant. */
export type ColumnWidth = { mm: number } | { fr: number }

export interface TableColumn {
  /** Identifiant stable de la colonne (tests, accessibilité). */
  key: string
  header: string
  width: ColumnWidth
  align: Align
}

export type RowStyle = 'normal' | 'strong' | 'muted'

export interface TableRow {
  /** Une cellule par colonne, dans l'ordre ; « \n » force un retour à la ligne. */
  cells: readonly string[]
  style: RowStyle
}

export interface TotalRow {
  label: string
  value: string
  /** Ligne mise en évidence (total, reste) : gras, filet au-dessus. */
  emphasis: boolean
}

export type NoticeTone = 'info' | 'warning' | 'test'

export interface HeadingBlock {
  kind: 'heading'
  level: 1 | 2 | 3
  text: string
}

export interface ParagraphBlock {
  kind: 'paragraph'
  text: string
  bold: boolean
  italic: boolean
  muted: boolean
  align: Align
  /** Taille en points, ou null pour le corps du format. */
  sizePt: number | null
}

export interface FieldsBlock {
  kind: 'fields'
  rows: readonly FieldRow[]
  columns: 1 | 2
}

export interface TableBlock {
  kind: 'table'
  /** Intitulé lu par les lecteurs d'écran de l'aperçu ; non imprimé. */
  caption: string
  columns: readonly TableColumn[]
  rows: readonly TableRow[]
  /**
   * Nombre de dernières lignes qui restent solidaires du bloc `totals` qui suit (« pas de totaux
   * seuls sur une page », fichier 11) ; sans effet si le bloc suivant n'est pas un `totals`.
   */
  keepLastRows: number
  /** Taille de police en points, ou null pour le corps du format. */
  sizePt: number | null
}

export interface TotalsBlock {
  kind: 'totals'
  rows: readonly TotalRow[]
}

export interface NoticeBlock {
  kind: 'notice'
  tone: NoticeTone
  title: string | null
  text: string
}

export interface SpacerBlock {
  kind: 'spacer'
  heightMm: number
}

export interface RuleBlock {
  kind: 'rule'
}

export interface SignatureBox {
  label: string
  heightMm: number
}

export interface SignatureBlock {
  kind: 'signature'
  boxes: readonly SignatureBox[]
}

export interface GroupBlock {
  kind: 'group'
  blocks: readonly Block[]
  /** Le groupe commence sur une nouvelle page s'il ne tient pas dans ce qui reste de la page. */
  keepTogether: boolean
}

export interface PageBreakBlock {
  kind: 'pageBreak'
}

export type Block =
  | HeadingBlock
  | ParagraphBlock
  | FieldsBlock
  | TableBlock
  | TotalsBlock
  | NoticeBlock
  | SpacerBlock
  | RuleBlock
  | SignatureBlock
  | GroupBlock
  | PageBreakBlock

/** Logo local (jamais une URL distante) : image PNG ou JPEG en URL de données. */
export interface DocumentLogo {
  dataUrl: string
  format: 'PNG' | 'JPEG'
  widthMm: number
  heightMm: number
}

export interface Letterhead {
  organization: string
  lines: readonly string[]
  logo: DocumentLogo | null
  /** Vrai : emplacement du logo réservé et marqué « à fournir » (cabinet sans logo, démonstration). */
  logoPlaceholder: boolean
}

export interface TitleBlockModel {
  title: string
  subtitle: string | null
  fields: readonly FieldRow[]
}

export type WatermarkText = 'BROUILLON' | 'DUPLICATA' | 'DONNÉES DE TEST'

export interface DocumentMeta {
  /** Numéro définitif de la pièce, ou null (brouillon, pièce sans numéro). */
  documentNumber: string | null
  /** Instant d'émission (ou de création d'un brouillon), repris dans les propriétés du PDF. */
  documentAt: string
  copy: CopyInfo
  draft: boolean
  test: boolean
  /** Fuseau du cabinet (dates imprimées). */
  timeZone: string
}

export interface DocumentModel {
  schema: 1
  kind: DocumentKind
  templateVersion: string
  /** Propriété « Titre » du PDF : type et numéro, jamais un nom de personne. */
  title: string
  format: PageFormatId
  meta: DocumentMeta
  letterhead: Letterhead
  titleBlock: TitleBlockModel
  body: readonly Block[]
  /** Lignes de pied de page (mentions du cabinet, modèle). */
  footerLines: readonly string[]
  watermark: WatermarkText | null
  /** Anomalies relevées à la construction (mentions légales manquantes, etc.), jamais cachées. */
  warnings: readonly string[]
}

export const DOCUMENT_KIND_LABELS: Readonly<Record<DocumentKind, string>> = {
  INVOICE: 'Facture',
  RECEIPT: 'Reçu de paiement',
  CREDIT_NOTE: 'Avoir',
  REFUND: 'Reçu de remboursement',
  ACCOUNT_STATEMENT: 'État de compte',
  QUOTE: 'Devis',
  OPTICAL_PRESCRIPTION: 'Prescription optique',
  CLINICAL_RECORD: 'Fiche de consultation',
  WORKSHOP: 'Bon laboratoire',
  MEDICATION_ORDER: 'Ordonnance de médicaments',
  REFERRAL_LETTER: 'Lettre d’orientation',
  CASH_SESSION_REPORT: 'Relevé de caisse',
}

// --- Constructeurs de blocs : valeurs par défaut explicites (exactOptionalPropertyTypes) ----------

export function heading(text: string, level: 1 | 2 | 3 = 2): HeadingBlock {
  return { kind: 'heading', level, text }
}

export function paragraph(
  text: string,
  options: {
    bold?: boolean
    italic?: boolean
    muted?: boolean
    align?: Align
    sizePt?: number
  } = {},
): ParagraphBlock {
  return {
    kind: 'paragraph',
    text,
    bold: options.bold ?? false,
    italic: options.italic ?? false,
    muted: options.muted ?? false,
    align: options.align ?? 'left',
    sizePt: options.sizePt ?? null,
  }
}

export function fields(rows: readonly FieldRow[], columns: 1 | 2 = 1): FieldsBlock {
  return { kind: 'fields', rows, columns }
}

export function notice(tone: NoticeTone, text: string, title: string | null = null): NoticeBlock {
  return { kind: 'notice', tone, title, text }
}

export function spacer(heightMm: number): SpacerBlock {
  return { kind: 'spacer', heightMm }
}

export function totals(rows: readonly TotalRow[]): TotalsBlock {
  return { kind: 'totals', rows }
}

export function totalRow(label: string, value: string, emphasis = false): TotalRow {
  return { label, value, emphasis }
}

export function group(blocks: readonly Block[], keepTogether = true): GroupBlock {
  return { kind: 'group', blocks, keepTogether }
}

export function signature(boxes: readonly SignatureBox[]): SignatureBlock {
  return { kind: 'signature', boxes }
}

export function row(cells: readonly string[], style: RowStyle = 'normal'): TableRow {
  return { cells, style }
}

export function table(
  caption: string,
  columns: readonly TableColumn[],
  rows: readonly TableRow[],
  options: { keepLastRows?: number; sizePt?: number } = {},
): TableBlock {
  return {
    kind: 'table',
    caption,
    columns,
    rows,
    keepLastRows: options.keepLastRows ?? 0,
    sizePt: options.sizePt ?? null,
  }
}
