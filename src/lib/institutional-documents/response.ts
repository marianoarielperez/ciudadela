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
