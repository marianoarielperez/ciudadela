// Descarga del resumen mensual de solicitudes en Excel — las mismas tres listas
// y las mismas seis columnas que /admin/solicitudes/resumen, para que lo que la
// Comisión ve en pantalla sea exactamente lo que se lleva en el archivo.
// Calcado de `padron-export/route.ts` (Task 16).
import ExcelJS from "exceljs";
import type { NextRequest } from "next/server";
import { headers } from "next/headers";
import { requireAdmin } from "@/lib/auth/require-admin";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import {
  buildSummaryExportRow, formatMonthParam, makeSummaryQueries, monthRangeUtc,
  parseMonthParam, SUMMARY_EXPORT_COLUMNS, type SummaryRow,
} from "@/lib/applications/summary";

export async function GET(req: NextRequest) {
  // requireAdmin() y no un chequeo de roles a mano: resuelve contra la fila viva
  // de User, no contra el rol que trae el JWT. Esta ruta expone nombres y DNIs
  // de gente que todavía no es socia, así que la autorización es la misma que
  // usan las server actions del panel.
  const actor = await requireAdmin();
  if (!actor.ok) return new Response(actor.error, { status: 403 });

  const month = parseMonthParam(req.nextUrl.searchParams.get("mes") ?? undefined, new Date());
  const monthValue = formatMonthParam(month);
  const summary = await makeSummaryQueries(prisma)
    .fetchSummary(monthRangeUtc(month.year, month.month));

  const wb = new ExcelJS.Workbook();
  // Los nombres de hoja de Excel no admiten : \ / ? * [ ] y se cortan a 31
  // caracteres: por eso son cortos y no repiten el título largo de la pantalla.
  addSheet(wb, "Pendientes de asiento", summary.accepted);
  addSheet(wb, "Pendientes CD", summary.pendingBoard);
  addSheet(wb, "Asentadas", summary.recordedInMonth);

  const buffer = await wb.xlsx.writeBuffer();

  // Metadatos únicamente: quién exportó, de qué mes y cuántas filas por lista —
  // nunca los nombres ni los DNIs de esas filas.
  //
  // Sólo X-Real-IP, igual que el resto del panel: Nginx la resuelve con el
  // módulo realip y la sobrescribe, así que no se puede rotar por request.
  const ip = (await headers()).get("x-real-ip") ?? "unknown";
  await audit({
    userId: actor.actorId,
    action: "application_summary_export",
    detail: {
      month: monthValue,
      counts: {
        accepted: summary.accepted.length,
        pendingBoard: summary.pendingBoard.length,
        recordedInMonth: summary.recordedInMonth.length,
      },
    },
    ip,
  });

  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="resumen-solicitudes-${monthValue}.xlsx"`,
      // El archivo trae nombres y DNIs (Ley 25.326). Sin esto Next no agrega
      // ninguna cabecera de caché, así que un intermediario entre el navegador
      // y este handler podría guardar la respuesta. `no-store` la saca de
      // cualquier caché; `private`, además de las compartidas que lo ignoren. Y
      // `Vary: Cookie` para que un proxy no la sirva sin mirar la sesión.
      "Cache-Control": "no-store, private",
      Vary: "Cookie",
    },
  });
}

function addSheet(wb: ExcelJS.Workbook, name: string, rows: SummaryRow[]) {
  const ws = wb.addWorksheet(name);
  ws.columns = [...SUMMARY_EXPORT_COLUMNS];
  ws.getRow(1).font = { bold: true };
  // La hoja se crea aunque la lista esté vacía: el archivo siempre trae las
  // tres, y una hoja con sólo el encabezado dice "esta lista está vacía", que
  // es información. Una hoja faltante parecería un error de exportación.
  for (const row of rows) ws.addRow(buildSummaryExportRow(row));
}
