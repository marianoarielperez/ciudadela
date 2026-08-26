// Visor de los documentos de la presentación: embebe el DNI (frente, dorso y
// los anexos) en la misma pantalla donde el operador compara lo declarado con
// la ficha, en vez de mandarlo a otra pestaña.
//
// Calcado del visor del detalle de solicitud
// (`admin/solicitudes/[id]/document-viewer.tsx`), que explica en largo por qué
// `inline` es seguro. En corto: el mime lo decide `sniffDocument` en la subida
// y nunca el cliente, `X-Content-Type-Options: nosniff` impide que el navegador
// lo reinterprete, y el aislamiento del documento embebido lo pone la CSP de
// respuesta (`default-src 'none'; sandbox`) de la entrada específica de
// `next.config.ts` para esta ruta — la que emite el handler NO llega sola al
// cliente, porque Next copia las cabeceras de `headers()` con `setHeader`, que
// REEMPLAZA.
//
// Server-safe (sin estado, sin "use client"): sólo arma el `<img>` o el
// `<iframe>` apuntando a la ruta autenticada.
//
// Privacidad (Ley 25.326): cada carga de `<img>`/`<iframe>` es un GET real a la
// ruta, que YA audita la vista (`presentation_document_view`) del lado del
// servidor. Este componente no agrega un segundo asiento ni escribe el nombre
// del archivo en ningún log. Abrir el detalle dos veces audita dos vistas de
// cada documento: sobre-reporta contra una semántica de "vista deliberada", que
// es la dirección segura.
import type { Document } from "@/generated/prisma/client";
import { INLINE_LINK } from "@/lib/admin/link-styles";
import { DOCUMENT_TYPE_LABELS } from "@/lib/applications/labels";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";

const IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function PresentationDocumentViewer({
  presentationId,
  documents,
}: {
  presentationId: number;
  documents: Pick<Document, "id" | "type" | "mime" | "size">[];
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {documents.map((doc) => {
        const href = `/api/admin/reempadronamiento/presentaciones/${presentationId}/documentos/${doc.id}`;
        const label = DOCUMENT_TYPE_LABELS[doc.type];
        const isImage = IMAGE_MIMES.has(doc.mime);
        return (
          <div key={doc.id} className="space-y-2">
            <p className="text-sm">
              {label} · {formatBytes(doc.size)}
            </p>
            {isImage ? (
              // Archivo detrás de una ruta autenticada y `no-store`: Next/Image
              // lo cachearía y lo serviría como asset público, justo lo que
              // docs/08 prohíbe para un documento personal.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={href}
                alt={label}
                loading="lazy"
                className="max-h-96 w-full rounded-md border object-contain"
              />
            ) : (
              // SIN atributo `sandbox`: un iframe totalmente sandboxeado hace
              // que Chromium bloquee el REQUEST del PDF antes de pedirlo
              // (medido el 25/08/2026 con la ruta hermana de solicitudes). El
              // aislamiento lo pone la CSP de respuesta, que sí convive con el
              // visor.
              <iframe src={href} title={label} className="h-96 w-full max-w-full rounded-md border" />
            )}
            {/* Respaldo siempre presente, para los dos casos: si el visor
                embebido no renderiza bien un PDF grande o una imagen rara,
                ésta es la salida. */}
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
