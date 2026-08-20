// GET del archivo de un documento de solicitud. Documentos personales
// (docs/08): solo admin, sin caché, y CADA visualización queda auditada
// (`application_document_view`) — es el equivalente digital de abrir la carpeta
// del socio, y la auditoría es lo que permite responder "¿quién vio este DNI?".
//
// ── Por qué `inline` y no `attachment` ──────────────────────────────────────
//
// `sniffDocument` (lib/documents/storage.ts) valida la FIRMA del archivo, no su
// contenido completo: un archivo que empieza con los magic bytes de un JPEG y
// sigue con HTML pasa la validación de subida. Si el navegador lo re-interpreta
// como HTML, ese HTML corre en `vecinalciudadela.ar` — el mismo origen que la
// sesión de admin que lo está mirando. Eso es lo que hay que impedir, y `inline`
// por sí solo no lo impide.
//
// Lo impiden, en capas:
//  1. `X-Content-Type-Options: nosniff` — el navegador respeta el `Content-Type`
//     declarado y no adivina. El mime NO lo declara el cliente: sale de
//     `sniffDocument` en el momento de subir, así que sólo puede ser image/jpeg,
//     image/png, image/webp o application/pdf. Un HTML servido como image/jpeg
//     con nosniff no se renderiza como página: se rompe la imagen y punto.
//  2. Una CSP PROPIA de esta respuesta, `default-src 'none'; sandbox` (el patrón
//     que usa GitHub para el contenido crudo de usuarios). OJO con el porqué:
//     NO es que se "interseque" con la global de next.config.ts. Next copia las
//     cabeceras de la Response con `setHeader`, que REEMPLAZA — así que acá rige
//     únicamente esta CSP, y por eso tiene que bastarse sola. Se basta:
//     `default-src 'none'` ya cubre lo que la global aportaba con `object-src`,
//     y el framing lo sigue bloqueando `X-Frame-Options: DENY`, que viaja como
//     cabecera aparte y no la pisa nadie.
//  3. Alcance real de la capa 2, para no confiarse: cubre el caso del punto 1
//     (HTML disfrazado) dejándolo en un origen opaco y sin scripts. NO cubre el
//     JS embebido en un PDF, que corre dentro del visor (PDFium) y no pasa por
//     `script-src`. Ese JS igual no llega al DOM ni a las cookies de
//     vecinalciudadela.ar, así que no hay escalada de origen: el riesgo queda en
//     el visor del navegador, no en la sesión del admin.
//
// Con eso, `inline` es seguro y es lo que el trabajo pide: el operador compara
// la foto del DNI con los datos de la ficha en una pestaña al lado. Forzar
// `attachment` lo obligaría a descargar cada documento de cada solicitud al
// disco de la vecinal —copias sin control de un dato sensible, justo lo que
// docs/08 quiere evitar—. El `filename` va igual, para el "Guardar como".
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
  const applicationId = Number(id);
  const documentId = Number(docId);
  if (
    !Number.isInteger(applicationId) || applicationId <= 0 ||
    !Number.isInteger(documentId) || documentId <= 0
  ) {
    return new Response("No encontrado", { status: 404 });
  }

  // `ownerId` sale de la URL de la solicitud, no del documento: sin ese filtro,
  // /solicitudes/1/documentos/999 serviría el DNI de otra solicitud a cualquier
  // admin que tipeara un número.
  const doc = await prisma.document.findFirst({
    where: { id: documentId, ownerType: "application", ownerId: applicationId },
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
  // Ids, tipo y nada más (regla del proyecto): ni el nombre del solicitante, ni
  // su DNI, ni la ruta del archivo en disco.
  await audit({
    userId: actor.actorId,
    action: "application_document_view",
    entity: "document",
    entityId: doc.id,
    detail: { applicationId, type: doc.type },
    ip,
  });

  const ext = EXT_BY_MIME[doc.mime] ?? "bin";
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": doc.mime,
      "Content-Disposition": `inline; filename="solicitud-${applicationId}-${doc.type}-${doc.id}.${ext}"`,
      "Cache-Control": "no-store, private",
      Vary: "Cookie",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
