// Visor de documentos de la solicitud: embebe el DNI (frente/dorso/anexo) en
// vez de mandar al operador a otra pestaña para compararlo con esta misma
// pantalla. Server-safe (sin estado, sin "use client"): sólo arma el <img> o
// el <iframe> apuntando a la ruta ya preparada para esto
// (`/api/admin/solicitudes/[id]/documentos/[docId]/route.ts:6-40` explica por
// qué `inline` es seguro — `nosniff` + CSP propia).
//
// El tipo lo decide `doc.mime`, que sale de `sniffDocument` en la subida y
// nunca del cliente: sólo puede ser image/jpeg, image/png, image/webp o
// application/pdf (ver `EXT_BY_MIME` en la ruta). Cualquier otro valor cae al
// link de respaldo, nunca a un <img>/<iframe> roto.
//
// Privacidad (Ley 25.326): cada carga de <img>/<iframe> es un GET real a la
// ruta, que YA audita la vista (`application_document_view`) del lado del
// servidor — este componente no agrega un segundo asiento ni escribe el
// documento ni su nombre en ningún log.
import type { Document } from "@/generated/prisma/client";
import { INLINE_LINK } from "@/lib/admin/link-styles";
import { DOCUMENT_TYPE_LABELS } from "@/lib/applications/labels";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";

const IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function DocumentViewer({
  applicationId,
  documents,
}: {
  applicationId: number;
  documents: Pick<Document, "id" | "type" | "mime" | "size">[];
}) {
  return (
    // DNI frente y dorso (y el anexo, si lo hay) lado a lado en desktop,
    // apilados en móvil: mismo patrón `grid gap-4 md:grid-cols-2` del resto
    // del detalle.
    <div className="grid gap-4 md:grid-cols-2">
      {documents.map((doc) => {
        const href = `/api/admin/solicitudes/${applicationId}/documentos/${doc.id}`;
        const label = DOCUMENT_TYPE_LABELS[doc.type];
        const isImage = IMAGE_MIMES.has(doc.mime);
        return (
          <div key={doc.id} className="space-y-2">
            <p className="text-sm">
              {label} · {formatBytes(doc.size)}
            </p>
            {isImage ? (
              // Archivo detrás de una ruta autenticada y `no-store`:
              // Next/Image lo cachearía y lo serviría como asset público,
              // justo lo que docs/08 prohíbe para un documento personal.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={href}
                alt={label}
                className="max-w-full rounded-md border object-contain"
              />
            ) : (
              <iframe
                src={href}
                title={label}
                className="h-96 max-w-full w-full rounded-md border"
              />
            )}
            {/* Respaldo siempre presente: si el visor embebido no renderiza
                bien un PDF grande o una imagen rara, esta es la salida. */}
            <a
              className={cn(INLINE_LINK, "inline-flex min-h-11 items-center")}
              href={href}
              target="_blank"
              rel="noopener"
            >
              Abrir en otra pestaña
            </a>
          </div>
        );
      })}
    </div>
  );
}
