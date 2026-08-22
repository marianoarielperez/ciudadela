// El socio descarga SUS recibos (spec §6.5). Dos diferencias con la ruta del
// panel, y las dos son deliberadas:
//
//  1. El filtro es `payment.memberId === actor.memberId`, y un recibo ajeno da
//     404, no 403: un 403 confirmaría que ese recibo existe, y la serie es
//     correlativa —cualquiera podría contar cuántos recibos emitió la vecinal
//     probando ids—. `memberId` es nullable (pago de una solicitud todavía sin
//     ficha), así que la comparación estricta también deja afuera el nulo.
//  2. Sin asiento de auditoría: `receipt_view` responde "¿quién miró el recibo
//     de otro?", y el socio mirando lo propio no es ese hecho. Las cabeceras de
//     privacidad, en cambio, son idénticas: mismo `pdfResponse`.
//
// `requireMember` resuelve contra la fila viva del padrón, no contra el token:
// una baja o una suspensión cierran esta ruta sin esperar a que venza el JWT.
import { requireMember } from "@/lib/auth/require-member";
import { prisma } from "@/lib/prisma";
import {
  loadReceiptPdf,
  parseReceiptId,
  pdfResponse,
  RECEIPT_FILE_SELECT,
  RECEIPT_NOT_FOUND,
} from "@/lib/treasury/receipt-response";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireMember();
  if (!actor.ok) return new Response(actor.error, { status: 403 });

  const { id } = await params;
  const receiptId = parseReceiptId(id);
  if (receiptId === null) return new Response(RECEIPT_NOT_FOUND, { status: 404 });

  const receipt = await prisma.receipt.findUnique({
    where: { id: receiptId },
    select: RECEIPT_FILE_SELECT,
  });
  if (!receipt || receipt.payment.memberId !== actor.memberId) {
    return new Response(RECEIPT_NOT_FOUND, { status: 404 });
  }

  const bytes = await loadReceiptPdf(receipt);
  if (!bytes) return new Response("El archivo no está disponible", { status: 404 });

  return pdfResponse(bytes, receipt.number);
}
