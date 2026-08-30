// Cómo se ENTREGA un PDF institucional. Lo comparten las dos rutas que lo
// sirven —`/api/mi/documentos/[id]` y `/api/admin/documentos/[id]`— y vive acá,
// y no en uno de los dos `route.ts`, por el mismo motivo que
// `receipt-response.ts`: un route handler de App Router está para exportar
// métodos HTTP, y hacer que una ruta importe a la otra ata dos endpoints que no
// tienen nada que ver salvo el formato de la respuesta.
//
// Este módulo es PURO —sin un solo import— a propósito: la CARGA (Prisma +
// node:fs) vive en `./file-load`. El cliente de Prisma tira al evaluarse si
// falta `DATABASE_URL`, así que importarlo acá haría que un test puro de las
// cabeceras se cayera sin `.env`. Mismo criterio que `doc-name.ts` frente a
// `storage.ts`, y que el `import()` dinámico de `receipt-response.ts`.

/** El único texto de 404 del módulo. La invariante es que todo lo que no sea
 *  "no hay sesión" responda 404, y con un solo texto la respuesta tampoco
 *  distingue una fila que no existe de un archivo que no está en el disco. */
export const INSTITUTIONAL_DOC_NOT_FOUND = "El documento no existe";

// Respuesta HTTP de un PDF institucional. Cabeceras defensivas calcadas de la
// ruta del estatuto del M5 (que este módulo retira) y de receipt-response.ts:
// inline, sin caché compartida, sin sniffing, CSP con sandbox.
export function institutionalDocResponse(bytes: Uint8Array, downloadName: string): Response {
  // `new Uint8Array(bytes)` normaliza el Buffer de `readFile` a una vista sobre
  // su propio ArrayBuffer: el Buffer de Node comparte un pool, y ese tipo no es
  // el `BodyInit` que espera la Response (mismo motivo y misma línea que
  // `pdfResponse` en receipt-response.ts). Va acá, y no en cada handler, para
  // que las dos rutas no puedan divergir en la normalización ni en las cabeceras.
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${downloadName}"`,
      "Cache-Control": "no-store, private",
      Vary: "Cookie",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
