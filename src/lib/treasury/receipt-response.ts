// Cómo se ENTREGA el PDF de un recibo. Lo comparten las dos rutas de §6.5
// —`/api/admin/recibos/[id]` y `/api/mi/recibos/[id]`— y vive acá, y no en el
// `route.ts` del panel, por dos razones: un route handler de App Router está
// para exportar métodos HTTP (Next puede rechazar otros exports), y hacer que
// la ruta del socio importe a la del admin ata dos endpoints que no tienen nada
// que ver salvo el formato de la respuesta.
//
// El criterio de las cabeceras es el mismo que el de los documentos de una
// solicitud (`api/admin/solicitudes/[id]/documentos/[docId]/route.ts`, donde
// está el razonamiento largo). En resumen, y por qué aplica también acá:
//  - `no-store, private` + `Vary: Cookie`: el recibo lleva nombre, número de
//    socio y monto. No queda en la caché de Cloudflare ni en la del navegador
//    compartido de la vecinal.
//  - `nosniff`: el `Content-Type` lo declara el servidor y no se adivina.
//  - CSP propia `default-src 'none'; sandbox`: Next copia las cabeceras de la
//    Response con `setHeader`, que REEMPLAZA la global, así que ésta tiene que
//    bastarse sola — y se basta. Deja el archivo sin scripts y en un origen
//    opaco. (El JS embebido en un PDF corre en el visor del navegador y no pasa
//    por `script-src`; eso no cambia acá, pero tampoco alcanza el origen de la
//    sesión.)
//  - `inline` y no `attachment`: el socio y el operador quieren MIRAR el recibo.
//    El `filename` viaja igual, para el "Guardar como".
import { readReceiptPdf, receiptRelativePath } from "@/lib/treasury/receipts-dir";

/** Lo mínimo que hace falta de la fila para servir el archivo. */
export type ReceiptFile = {
  id: number;
  number: string;
  pdfPath: string | null;
};

/**
 * Los bytes del recibo, o `null` si no hay forma de conseguirlos.
 *
 * Primero el disco; si no está —restore parcial, borrado a mano, o un `pdfPath`
 * con una forma que `readReceiptPdf` rechaza— se re-renderiza desde la base,
 * que es la fuente de verdad (spec §6.5). Regenerar también puede fallar (un
 * monto guardado fuera de rango hace explotar `amountInWords`): eso NO es un
 * 500, es un recibo que hoy no se puede mostrar, y el llamador lo convierte en
 * 404 igual que la ruta de documentos. Queda el log para que se pueda arreglar.
 */
export async function loadReceiptPdf(receipt: ReceiptFile): Promise<Uint8Array | null> {
  try {
    return await readReceiptPdf(receipt.pdfPath ?? receiptRelativePath(receipt.number));
  } catch {
    try {
      // `import()` dinámico a propósito, igual que en `require-admin.ts`: el
      // servicio arrastra el cliente de Prisma, que tira al evaluarse si falta
      // `DATABASE_URL`. Así este módulo se puede importar sin `.env` y el costo
      // queda en el camino excepcional, que es el único que lo necesita.
      const { treasuryService } = await import("@/lib/treasury/service");
      return await treasuryService.regenerateReceiptPdf(receipt.id);
    } catch (err) {
      // Sin datos personales: el id del recibo alcanza para encontrarlo.
      console.error("[receipts] no se pudo regenerar el PDF del recibo", receipt.id, err);
      return null;
    }
  }
}

// La serie es AAAA-NNNNN y nada más. El nombre sugerido se arma con el número
// de la fila, así que se valida acá: una fila con basura (migración a mano,
// restore raro) no puede terminar inyectando en la cabecera. Mismo criterio que
// el `EXT_BY_MIME` de la ruta de documentos — el nombre nunca sale de texto
// libre.
const RECEIPT_NUMBER_RE = /^\d{4}-\d{5}$/;

export function receiptFileName(number: string): string {
  return RECEIPT_NUMBER_RE.test(number) ? `recibo-${number}.pdf` : "recibo.pdf";
}

export function pdfResponse(bytes: Uint8Array, number: string): Response {
  // `new Uint8Array(bytes)` normaliza el Buffer de `readFile` a una vista sobre
  // su propio ArrayBuffer: el Buffer de Node comparte un pool, y ese tipo no es
  // el `BodyInit` que espera la Response.
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${receiptFileName(number)}"`,
      "Cache-Control": "no-store, private",
      Vary: "Cookie",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}

/** El id llega como texto de la URL. Un `Number()` suelto convierte "abc" en
 *  NaN y "1.5" en 1.5: como clave de búsqueda, eso es una consulta que nadie
 *  escribió. Devuelve `null` y el llamador responde 404. */
export function parseReceiptId(id: string): number | null {
  const parsed = Number(id);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/** Lo que las dos rutas leen de la fila. Un solo `select` para que el asiento
 *  del panel y el filtro del socio no se desincronicen. */
export const RECEIPT_FILE_SELECT = {
  id: true,
  number: true,
  pdfPath: true,
  payment: { select: { memberId: true } },
} as const;

export const RECEIPT_NOT_FOUND = "No encontrado";
