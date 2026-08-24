// Export del padrón electoral (REG-31). CSV y no Excel: se lo lleva la Junta
// Electoral, que lo abre en cualquier cosa, y el archivo tiene tres columnas de
// texto y dos números.
//
// Deja asiento: llevarse el padrón SÍ es un hecho auditable (mismo criterio que
// `padron_export`). La pantalla deja el suyo al generar, que es un hecho
// distinto —se puede imprimir sin pasar nunca por acá—.
import { headers } from "next/headers";
import type { NextRequest } from "next/server";
import { audit } from "@/lib/audit";
import { requireSuperadmin } from "@/lib/auth/require-admin";
import { parseCivilDate } from "@/lib/dates";
import { buildElectoralRoll, electoralCsv } from "@/lib/members/electoral";
import { prisma } from "@/lib/prisma";
import { feeValueReader } from "@/lib/treasury/fee-values";

// Marca de orden de bytes. Sin ella, Excel en Windows abre el CSV en ANSI y
// rompe los acentos de "Coñuecar" y "Gómez" — y Excel es el destinatario más
// probable del archivo. Se construye por código de carácter y no se pega el
// U+FEFF literal: en el fuente es invisible y cualquiera lo borra sin saberlo.
const BOM = String.fromCharCode(0xfeff);

export async function GET(req: NextRequest) {
  const actor = await requireSuperadmin();
  if (!actor.ok) return new Response(actor.error, { status: 403 });
  const raw = req.nextUrl.searchParams.get("fecha") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return new Response("Fecha inválida.", { status: 400 });
  const parsed = parseCivilDate(raw, { minYear: 2020, invalidError: "Fecha inválida." });
  if (!parsed.ok) return new Response(parsed.error, { status: 400 });

  const roll = await buildElectoralRoll(prisma, parsed.value, await feeValueReader.current());
  const csv = electoralCsv(roll);
  await audit({
    userId: actor.actorId,
    action: "electoral_roll_export",
    // Sin `entity`: el asiento no es sobre ninguna fila en particular, y el
    // índice `(entity, entity_id)` se consulta para la historia de UNA entidad.
    // Mismo criterio que `padron_export` y `manual_collection_sheet`.
    // Metadatos: la fecha y los tamaños. Nunca las filas.
    detail: { at: raw, enabled: roll.enabled.length, toPurge: roll.toPurge.length, purgeFees: roll.purgeFees },
    ip: (await headers()).get("x-real-ip") ?? "unknown",
  });

  return new Response(BOM + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="padron-electoral-${raw}.csv"`,
      // Nombres y números de socio de 160 personas (Ley 25.326): fuera de toda
      // caché, igual que el export del padrón administrativo.
      "Cache-Control": "no-store, private",
      Vary: "Cookie",
    },
  });
}
