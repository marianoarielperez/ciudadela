// El estatuto como PDF autenticado (spec M5 §10; docs/07:48 lo movió del M2
// acá: no tiene página pública). Mismas cabeceras defensivas que los recibos
// (receipt-response.ts): inline, sin caché compartida, sin sniffing, CSP con
// sandbox. El suspendido y el vigente lo ven igual; el cesante no (requireMember).
import { readFile } from "node:fs/promises";
import path from "node:path";

import { requireMember } from "@/lib/auth/require-member";

export async function GET(): Promise<Response> {
  const actor = await requireMember({ allowSuspended: true });
  if (!actor.ok) return new Response(actor.error, { status: 403 });
  let bytes: Buffer;
  try {
    bytes = await readFile(path.join(process.cwd(), "datos", "estatuto.pdf"));
  } catch {
    return new Response("El archivo no está disponible", { status: 404 });
  }
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'inline; filename="estatuto-vecinal-ciudadela.pdf"',
      "Cache-Control": "no-store, private",
      Vary: "Cookie",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
