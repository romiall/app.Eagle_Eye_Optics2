import { brandLogo } from '@/app/services/brandLogo'
import { depositOriginal } from '@/app/services/documentDeposit'
import { keepOriginal, renderDocument, type RenderedDocument } from '@/app/services/documents'
import { workshopOrderFromSnapshot } from '@/documents/data/workshop'
import { buildWorkshopOrder } from '@/documents/templates/workshop/workOrder'
import type { WorkshopOrder } from '@/domain/contracts/generated'

/**
 * Production et conservation du bon laboratoire anonymisé (L1D04) à partir du snapshot figé de la
 * commande atelier. L'original est conservé localement (si magasin disponible) et déposé une fois sur
 * le serveur central lorsqu'il est encore en attente (`PENDING` ou `FAILED`).
 */
export interface WorkshopDocumentOutcome {
  document: RenderedDocument
  deposited: boolean
}

export async function workshopOrderDocument(
  order: WorkshopOrder,
): Promise<WorkshopDocumentOutcome> {
  const logo = await brandLogo()
  const data = workshopOrderFromSnapshot(order.snapshot, logo)
  const rendered = await renderDocument(buildWorkshopOrder(data))

  if (order.document === null) {
    return { document: rendered, deposited: false }
  }

  const key = {
    documentType: 'WORKSHOP' as const,
    sourceKey: `workshop:${order.id}`,
    revisionNo: 1,
  }

  try {
    await keepOriginal(rendered, {
      key,
      documentId: order.document.document_id,
      entityId: order.id,
    })
  } catch {
    // Le magasin volatile ou déjà rempli n'empêche jamais l'aperçu ni le dépôt serveur.
  }

  if (order.document.document_status === 'READY') {
    return { document: rendered, deposited: true }
  }

  try {
    const deposited = await depositOriginal({
      documentId: order.document.document_id,
      key,
      bytes: rendered.bytes,
      sha256: rendered.sha256,
    })
    return { document: rendered, deposited }
  } catch {
    return { document: rendered, deposited: false }
  }
}
