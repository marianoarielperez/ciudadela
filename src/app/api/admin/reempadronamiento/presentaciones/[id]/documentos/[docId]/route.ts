// GET del archivo de un documento de una presentación de re-empadronamiento.
//
// Calcada de la ruta de los documentos de solicitud
// (`/api/admin/solicitudes/[id]/documentos/[docId]`), que explica en largo por
// qué cada cabecera está donde está. Lo que se repite acá es lo que no se puede
// perder: son fotos del DNI de un vecino, o sea datos personales sensibles
// (docs/08, Ley 25.326).
//
//  - `requireAdmin` en la primera línea. Una route handler no pasa por el
//    layout del panel, así que lo único que cierra esta puerta es esta llamada,
//    y resuelve contra la fila viva de `User` (el rol del token puede tener
//    hasta 8 horas de atraso).
//  - `ownerId` sale de la URL de la PRESENTACIÓN y no del documento: sin ese
//    filtro, `/presentaciones/1/documentos/999` serviría el DNI de otra
//    presentación —o el de una solicitud de alta, que vive en la misma tabla—
//    a cualquier admin que tipeara un número.
//  - `no-store, private` + `Vary: Cookie`: nada de esto se cachea.
//  - `nosniff` + una CSP propia (`default-src 'none'; sandbox`): el mime sale
//    de `sniffDocument` en la subida y nunca del cliente, y con `nosniff` un
//    HTML disfrazado de JPEG no se renderiza como página en el origen de la
//    sesión del admin. OJO: la CSP que emite este handler NO llega sola al
//    cliente —Next copia las cabeceras de `headers()` de `next.config.ts` con
//    `setHeader`, que REEMPLAZA—, por eso hay una entrada específica para esta
//    ruta ahí, igual que para la de solicitudes. Sin ella, el iframe del PDF
//    queda bloqueado en silencio.
//  - UN ASIENTO DE AUDITORÍA POR CADA VISTA (`presentation_document_view`). Es
//    el equivalente digital de abrir la carpeta del socio: la auditoría es lo
//    que permite responder después "¿quién vio este DNI?". Con el visor
//    embebido, cada `<img>`/`<iframe>` dispara su propio GET, así que abrir el
//    detalle dos veces audita dos vistas de cada documento — sobre-reporta
//    contra la semántica vieja de "vista deliberada", que es la dirección
//    segura.
import { headers } from "next/headers";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth/require-admin";
import { documentStore } from "@/lib/documents/storage";
import { prisma } from "@/lib/prisma";

// Extensión derivada del mime del SERVIDOR, nunca de `doc.path` ni de nada que
// haya tocado el cliente: el nombre sugerido no puede ser un vector.
const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; docId: string }> },
) {
  const actor = await requireAdmin();
  if (!actor.ok) return new Response(actor.error, { status: 403 });

  const { id, docId } = await params;
  const presentationId = Number(id);
  const documentId = Number(docId);
  if (
    !Number.isInteger(presentationId) || presentationId <= 0 ||
    !Number.isInteger(documentId) || documentId <= 0
  ) {
    return new Response("No encontrado", { status: 404 });
  }

  const doc = await prisma.document.findFirst({
    where: { id: documentId, ownerType: "presentation", ownerId: presentationId },
  });
  if (!doc) return new Response("No encontrado", { status: 404 });

  let data: Buffer;
  try {
    data = await documentStore.readDocumentFile(doc);
  } catch {
    // La fila existe pero el archivo no está (backup a medias, borrado a mano).
    // Es un 404 honesto y NO se audita: no se vio ningún documento.
    return new Response("El archivo no está disponible", { status: 404 });
  }

  // Sólo X-Real-IP, igual que el resto del panel: Nginx la resuelve con el
  // módulo realip y la sobrescribe, así que no se puede rotar por request.
  const ip = (await headers()).get("x-real-ip") ?? "unknown";
  // Ids, tipo y nada más (regla del proyecto): ni el nombre del socio, ni su
  // DNI, ni la ruta del archivo en disco.
  await audit({
    userId: actor.actorId,
    action: "presentation_document_view",
    entity: "document",
    entityId: doc.id,
    detail: { presentationId, type: doc.type },
    ip,
  });

  const ext = EXT_BY_MIME[doc.mime] ?? "bin";
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": doc.mime,
      "Content-Disposition": `inline; filename="presentacion-${presentationId}-${doc.type}-${doc.id}.${ext}"`,
      "Cache-Control": "no-store, private",
      Vary: "Cookie",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
