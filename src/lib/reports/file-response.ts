// Cómo se ENTREGA un archivo de un reporte. Lo comparten las dos rutas que lo
// sirven —`/api/admin/reportes/[id]/archivos/[fileId]` y su equivalente en
// `/api/mi/...`— y vive acá, y no en uno de los dos `route.ts`, por el mismo
// motivo que `institutional-documents/response.ts` y `receipt-response.ts`: un
// route handler de App Router está para exportar métodos HTTP, y hacer que una
// ruta importe a la otra ata dos endpoints que no comparten nada salvo el
// formato de la respuesta.
//
// Este módulo es PURO —sin un solo import— a propósito: `@/lib/prisma` tira al
// evaluarse si falta `DATABASE_URL`, así que un test de cabeceras que lo
// importara se caería sin `.env`.

/** CSP del archivo: no carga nada, corre en sandbox y nadie lo puede framear.
 *  Las fotos y las caras del DNI se muestran en un `<img>` del panel (nunca en
 *  un `<iframe>`), así que acá NO hay framing que reabrir: `frame-ancestors
 *  'none'` y, deliberadamente, sin `X-Frame-Options` propio — el `DENY` de la
 *  entrada global de `next.config.ts` es el que corresponde y tiene que quedar.
 *
 *  La comparte el PDF del reporte (`/api/admin/reportes/[id]/pdf`), que tampoco
 *  carga nada ni se framea: son las TRES rutas del módulo que sirven un archivo
 *  y las tres quieren exactamente esta CSP (spec §8).
 *
 *  OJO: emitirla en el handler NO alcanza para que llegue al navegador. Next
 *  copia las cabeceras de `headers()` de `next.config.ts` con `setHeader`, que
 *  REEMPLAZA, así que la CSP global del sitio pisa a ésta salvo que haya una
 *  entrada específica que la reponga. Esas entradas —una por ruta— están en
 *  `next.config.ts` con este mismo valor, y `tests/report-file-routes.test.ts`
 *  verifica que no se desincronicen. Cambiar esta constante sin tocar aquéllas
 *  no cambia una sola cabecera de las que ve el cliente. */
export const REPORT_FILE_CSP = "default-src 'none'; sandbox; frame-ancestors 'none'";

/** El único texto de 404 del módulo, para que la respuesta no distinga una fila
 *  que no existe de una fila ajena (el 404 del socio es una guarda, no un
 *  descuido: un 403 confirmaría que ese archivo existe). */
export const REPORT_FILE_NOT_FOUND = "No encontrado";

/** El archivo está en la base pero no en el disco (backup a medias, purga del
 *  DNI a mano). Texto aparte porque el hecho es otro y no filtra nada. */
export const REPORT_FILE_MISSING = "El archivo no está disponible";

/** Todo lo que el store escribe pasa por sharp y sale JPEG (`storage.ts`): el
 *  `Content-Type` es una constante y no un dato del cliente. Una fila con otro
 *  mime es una fila que este módulo no sabe servir, y las dos rutas la tratan
 *  como inexistente en vez de mentir en la cabecera. */
export const REPORT_FILE_MIME = "image/jpeg";

/** Nombre sugerido para el "Guardar como": ids y tipo, nada del vecino. Nunca
 *  se deriva de `file.path` —que trae un uuid y la carpeta de UPLOADS_DIR— ni
 *  de nada que haya tocado el cliente.
 *
 *  El `kind` se sanea igual: hoy sale de un enum de Prisma (`photo`,
 *  `dni_front`, `dni_back`) y no puede traer nada raro, pero llega tipado como
 *  `string` y este valor se interpola DENTRO de un `Content-Disposition`. Una
 *  comilla o un salto de línea ahí parten la cabecera; el filtro cuesta una
 *  línea y no depende de que el enum siga siendo lo que es. */
export function reportFileName(reportId: number, kind: string, fileId: number): string {
  return `reporte-${reportId}-${kind.replace(/[^a-z_]/gi, "")}-${fileId}.jpg`;
}

/** Respuesta HTTP de un archivo de reporte. Cabeceras defensivas calcadas de la
 *  ruta de documentos de solicitud: inline (el operador compara la foto con la
 *  ficha en una pestaña al lado), sin caché compartida, sin sniffing, con CSP
 *  de sandbox. Va acá, y no en cada handler, para que las dos rutas no puedan
 *  divergir en las cabeceras ni en la normalización del cuerpo. */
export function reportFileResponse(bytes: Uint8Array, name: string): Response {
  // `new Uint8Array(bytes)` normaliza el Buffer de `readFile` a una vista sobre
  // su propio ArrayBuffer: el Buffer de Node comparte un pool y ese tipo no es
  // el `BodyInit` que espera la Response (misma línea y mismo motivo que
  // `pdfResponse` y `institutionalDocResponse`).
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": REPORT_FILE_MIME,
      "Content-Disposition": `inline; filename="${name}"`,
      "Cache-Control": "no-store, private",
      Vary: "Cookie",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": REPORT_FILE_CSP,
    },
  });
}

/** Los dos segmentos de la URL son ids de la base: un NaN o un negativo no
 *  llegan a la consulta. `Number.isSafeInteger` además descarta el float y el
 *  entero fuera de rango, que en MySQL serían una comparación silenciosa. */
export function parsePositiveInt(raw: string): number | null {
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
