// GET del PDF de un aviso de cartelera: el papel que se imprime y se pega en la
// pared de la sede.
//
// Se genera A PEDIDO y no se guarda en disco, al revés que el recibo. Y no es
// una omisión: el recibo es un comprobante con número de serie que el socio
// puede reclamar años después, así que su archivo se conserva; el cartel es un
// papel que se imprime, se cuelga y se retira, y su valor probatorio no está en
// el archivo sino en las filas `Notification` que el asentado de la fijación
// congela. Reimprimirlo tiene que dar SIEMPRE lo que corresponde al estado del
// aviso, no lo que quedó cacheado.
//
// `requireAdmin` y no `requireSuperadmin`: imprimir es trabajo de mostrador
// —el que arma la carpeta y camina hasta la cartelera—, y no mueve ningún
// plazo. Asentar la fijación sí, y ésa es de superadmin.
//
// Cabeceras: el mismo criterio que los recibos y los documentos de una
// solicitud (docs/08). El cartel lleva nombres y números de socio de cien
// personas, así que no queda en la caché de Cloudflare ni en la del navegador
// compartido de la vecinal. `inline` porque el operador quiere MIRARLO antes de
// mandarlo a la impresora.
//
// CADA impresión queda AUDITADA. No es ceremonia: si mañana aparece un cartel
// pegado en la pared con una nómina distinta de la que el sistema dice, el
// asiento es lo único que permite reconstruir cuándo se imprimió cada versión y
// con cuánta gente.
import { headers } from "next/headers";

import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth/require-admin";
import { boardNotices, NOTICE_AUDIT_ENTITY, PDF_AUDIT_ACTION } from "@/lib/board/notice";
import { renderBoardNoticePdf } from "@/lib/board/notice-pdf";
import { siteBaseUrl } from "@/lib/site";

const NOT_FOUND = "No encontrado";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireAdmin();
  if (!actor.ok) return new Response(actor.error, { status: 403 });

  const { id } = await params;
  // Un `Number()` suelto convierte "abc" en NaN y "1.5" en 1.5: como clave de
  // búsqueda eso es una consulta que nadie escribió (mismo criterio que
  // `parseReceiptId`).
  const noticeId = Number(id);
  if (!Number.isInteger(noticeId) || noticeId <= 0) {
    return new Response(NOT_FOUND, { status: 404 });
  }

  const notice = await boardNotices.load(noticeId);
  if (!notice) return new Response(NOT_FOUND, { status: 404 });

  const bytes = await renderBoardNoticePdf({
    kind: notice.kind,
    subject: notice.subject,
    bookNumber: notice.process.bookNumber,
    calledAt: notice.process.calledAt,
    firstEndsAt: notice.process.firstEndsAt,
    secondEndsAt: notice.process.secondEndsAt,
    postedAt: notice.postedAt,
    dueAt: notice.dueAt,
    // SÓLO número y nombre. El cartel va a una pared pública: ver la cabecera
    // de `notice-pdf.ts`.
    recipients: notice.recipients.map((r) => ({
      memberNumber: r.memberNumber,
      fullName: r.fullName,
    })),
    siteUrl: siteBaseUrl().origin,
    printedAt: new Date(),
  });

  // Sólo X-Real-IP, igual que el resto del panel: Nginx la resuelve con el
  // módulo realip y la sobrescribe.
  const ip = (await headers()).get("x-real-ip") ?? "unknown";
  await audit({
    userId: actor.actorId,
    action: PDF_AUDIT_ACTION,
    entity: NOTICE_AUDIT_ENTITY,
    entityId: notice.id,
    // Ids, códigos y conteos. Ningún nombre: el asiento no puede ser una copia
    // del cartel (Ley 25.326).
    detail: {
      processId: notice.process.id,
      kind: notice.kind,
      subject: notice.subject,
      recipients: notice.recipients.length,
      frozen: notice.frozen,
    },
    ip,
  });

  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="aviso-cartelera-${notice.id}.pdf"`,
      "Cache-Control": "no-store, private",
      Vary: "Cookie",
      "X-Content-Type-Options": "nosniff",
      // OJO: esta CSP NO es la que llega al navegador. Medido contra el
      // servidor de esta rama, la respuesta viaja con la CSP GLOBAL del
      // proyecto; el comentario de `treasury/receipt-response.ts` —"Next copia
      // las cabeceras de la Response con `setHeader`, que REEMPLAZA la
      // global"— está desmentido por la medición. Se la declara igual porque
      // es lo correcto para un binario servido inline y no cuesta nada, pero
      // NO se puede contar como la barrera de este endpoint.
      // El problema de fondo es preexistente y más grande que esta ruta
      // (alcanza a los recibos y a los documentos de solicitudes desde el M3),
      // vive en el núcleo de dinero y se ataca con su propia tarea: ver el
      // informe de la Task 13, §8.2. `nosniff`, `no-store` y `Vary: Cookie` sí
      // llegan, y son las que efectivamente protegen este PDF.
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
