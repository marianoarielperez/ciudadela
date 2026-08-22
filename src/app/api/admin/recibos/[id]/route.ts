// GET del PDF de un recibo para el panel (spec §6.5). Un recibo es un documento
// personal —nombre del socio, su número de padrón, lo que pagó— así que rige el
// mismo criterio que los documentos de una solicitud (docs/08): solo admin, sin
// caché, `nosniff`, y CADA vista queda auditada (`receipt_view`). La auditoría
// es lo que permite responder después "¿quién miró este recibo?".
//
// El detalle de las cabeceras y del rescate del archivo faltante está en
// `@/lib/treasury/receipt-response`, que comparte con la ruta del socio.
import { headers } from "next/headers";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth/require-admin";
import { prisma } from "@/lib/prisma";
import {
  loadReceiptPdf,
  parseReceiptId,
  pdfResponse,
  RECEIPT_FILE_SELECT,
  RECEIPT_NOT_FOUND,
} from "@/lib/treasury/receipt-response";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireAdmin();
  if (!actor.ok) return new Response(actor.error, { status: 403 });

  const { id } = await params;
  const receiptId = parseReceiptId(id);
  if (receiptId === null) return new Response(RECEIPT_NOT_FOUND, { status: 404 });

  const receipt = await prisma.receipt.findUnique({
    where: { id: receiptId },
    select: RECEIPT_FILE_SELECT,
  });
  if (!receipt) return new Response(RECEIPT_NOT_FOUND, { status: 404 });

  const bytes = await loadReceiptPdf(receipt);
  // La fila existe pero el archivo no está y tampoco se pudo re-renderizar. Es
  // un 404 honesto y NO se audita: no se vio ningún recibo.
  if (!bytes) return new Response("El archivo no está disponible", { status: 404 });

  // Sólo X-Real-IP, igual que el resto del panel: Nginx la resuelve con el
  // módulo realip y la sobrescribe, así que no se puede rotar por request.
  const ip = (await headers()).get("x-real-ip") ?? "unknown";
  // Ids y número de serie, nada más (regla del proyecto): ni el nombre del
  // socio, ni su DNI, ni la ruta del archivo en disco.
  await audit({
    userId: actor.actorId,
    action: "receipt_view",
    entity: "receipt",
    entityId: receipt.id,
    detail: { number: receipt.number, memberId: receipt.payment.memberId },
    ip,
  });

  return pdfResponse(bytes, receipt.number);
}
