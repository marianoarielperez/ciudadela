// Export del padrón electoral (REG-31: "Excel/PDF") en .xlsx. Reemplaza al CSV
// del cierre de la 4C por decisión del operador del 27/08/2026 (spec del
// rediseño §2): mismo path, misma guarda y la misma validación de fecha; cambia
// el cuerpo. Molde: padron-export/route.ts y el addSheet de resumen-export.
//
// Deja asiento: llevarse el padrón SÍ es un hecho auditable (mismo criterio que
// `padron_export`). La pantalla deja el suyo al generar, que es un hecho
// distinto —se puede imprimir sin pasar nunca por acá—.
import ExcelJS from "exceljs";
import { headers } from "next/headers";
import type { NextRequest } from "next/server";
import { audit } from "@/lib/audit";
import { requireSuperadmin } from "@/lib/auth/require-admin";
import { parseCivilDate } from "@/lib/dates";
import { buildElectoralRoll } from "@/lib/members/electoral";
import { electoralWorkbookSpec } from "@/lib/members/electoral-export";
import { prisma } from "@/lib/prisma";
import { feeValueReader } from "@/lib/treasury/fee-values";

export async function GET(req: NextRequest) {
  const actor = await requireSuperadmin();
  if (!actor.ok) return new Response(actor.error, { status: 403 });
  const raw = req.nextUrl.searchParams.get("fecha") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return new Response("Fecha inválida.", { status: 400 });
  const parsed = parseCivilDate(raw, { minYear: 2020, invalidError: "Fecha inválida." });
  if (!parsed.ok) return new Response(parsed.error, { status: 400 });

  const feeValue = await feeValueReader.current();
  const roll = await buildElectoralRoll(prisma, parsed.value, feeValue);

  const wb = new ExcelJS.Workbook();
  for (const sheet of electoralWorkbookSpec(roll, feeValue !== null)) {
    const ws = wb.addWorksheet(sheet.name);
    ws.columns = sheet.columns.map((c) => ({ ...c }));
    ws.getRow(1).font = { bold: true };
    for (const row of sheet.rows) ws.addRow(row);
    if (sheet.totals) ws.addRow(sheet.totals).font = { bold: true };
  }
  const buffer = await wb.xlsx.writeBuffer();

  await audit({
    userId: actor.actorId,
    action: "electoral_roll_export",
    // Sin `entity`: el asiento no es sobre ninguna fila en particular (mismo
    // criterio que `padron_export`). Metadatos: la fecha y los tamaños de los
    // TRES bloques. Nunca las filas.
    detail: {
      at: raw,
      enabled: roll.enabled.length,
      toPurge: roll.toPurge.length,
      purgeFees: roll.purgeFees,
      withoutSeniority: roll.withoutSeniority.length,
    },
    ip: (await headers()).get("x-real-ip") ?? "unknown",
  });

  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="padron-electoral-${raw}.xlsx"`,
      // Nombres y números de socio de 160 personas (Ley 25.326): fuera de toda
      // caché, igual que el export del padrón administrativo.
      "Cache-Control": "no-store, private",
      Vary: "Cookie",
    },
  });
}
