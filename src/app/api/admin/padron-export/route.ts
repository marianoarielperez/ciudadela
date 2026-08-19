// Descarga del padrón filtrado en Excel. Mismos filtros que /admin/socios
// (parsePadronFilters/fetchPadron, Task 9): lo que el operador ve en pantalla
// es exactamente lo que se lleva en el archivo.
import ExcelJS from "exceljs";
import type { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { fetchPadron, parsePadronFilters } from "@/lib/members/query";
import { buildExportRow, PADRON_EXPORT_COLUMNS, sanitizeFiltersForAudit } from "@/lib/members/export";

export async function GET(req: NextRequest) {
  // requireAdmin() (no un chequeo de roles a mano): resuelve contra la fila
  // viva de User, no contra el rol que trae el JWT. Ver el comentario de
  // require-admin.ts — esta ruta expone DNIs y domicilios de los 283 socios,
  // así que la autorización tiene que ser la misma que usan las server
  // actions del panel, no una versión liviana propia.
  const actor = await requireAdmin();
  if (!actor.ok) return new Response(actor.error, { status: 403 });

  const filters = parsePadronFilters(Object.fromEntries(req.nextUrl.searchParams.entries()));
  const rows = await fetchPadron(prisma, filters);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("padron");
  ws.columns = [...PADRON_EXPORT_COLUMNS];
  ws.getRow(1).font = { bold: true };
  for (const row of rows) ws.addRow(buildExportRow(row));

  const buffer = await wb.xlsx.writeBuffer();

  // Metadatos únicamente: quién exportó, con qué filtros (sin el texto libre
  // de `q`, que puede traer un apellido o un DNI) y cuántas filas — nunca los
  // datos personales de esas filas. Ver sanitizeFiltersForAudit.
  await audit({
    userId: actor.actorId,
    action: "padron_export",
    detail: { filters: sanitizeFiltersForAudit(filters), rows: rows.length },
  });

  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="padron-libro-1.xlsx"',
      // El archivo trae DNIs, domicilios y teléfonos de los 283 socios (Ley
      // 25.326). Sin esto Next no agrega ninguna cabecera de caché (verificado
      // sobre el build de producción — ver task-16-review.md, I-1), así que un
      // intermediario entre el navegador y este handler (Nginx, un proxy del
      // operador) podría guardar la respuesta. `no-store` saca la ruta de
      // cualquier caché; `private` la saca además de las compartidas que
      // ignoren `no-store`. Y como la ruta no varía la respuesta por cookie
      // (recalcula todo del lado servidor), agregamos `Cookie` al `vary` que ya
      // pone Next para que un proxy que sí respete `no-store` no la sirva
      // igual sin mirar la sesión.
      "Cache-Control": "no-store, private",
      Vary: "Cookie",
    },
  });
}
