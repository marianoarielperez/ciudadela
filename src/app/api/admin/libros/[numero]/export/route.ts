// Descarga de un libro entero en Excel. Molde: el export del padrón
// (`api/admin/padron-export/route.ts`) — mismas cabeceras de descarga, mismo
// `no-store, private` y mismo asiento de auditoría con IP.
//
// A diferencia del padrón, acá no hay filtros: un libro de registro se exporta
// completo o no se exporta. Lo que baja es exactamente lo que muestra
// `/admin/socios/libros/{n}`, foto incluida si el libro está cerrado.
import ExcelJS from "exceljs";
import { headers } from "next/headers";

import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth/require-admin";
import { formatDateAR } from "@/lib/format";
import { fetchBookRows } from "@/lib/members/books";
import { CATEGORY_LABELS, STATUS_LABELS } from "@/lib/members/labels";
import { prisma } from "@/lib/prisma";

// Las mismas cinco columnas de la pantalla, en el mismo orden. Sin `header`: la
// fila 1 la ocupa el encabezado del libro, así que los nombres de columna se
// escriben a mano en la fila 2 (ver abajo).
const COLUMNS = [
  { key: "n", width: 12 },
  { key: "name", width: 32 },
  // numFmt "@" (texto): el DNI es una cadena de dígitos, no una cantidad. Mismo
  // motivo que en el export del padrón — sin esto Excel marca la celda con el
  // triángulo verde "número guardado como texto".
  { key: "dni", width: 14, style: { numFmt: "@" } },
  { key: "cat", width: 16 },
  { key: "st", width: 12 },
] as const;

const HEADERS = ["numero_socio", "apellido_nombre", "dni", "categoria", "estado"];

export async function GET(_req: Request, { params }: { params: Promise<{ numero: string }> }) {
  // Igual que el export del padrón: `requireAdmin()` y no un chequeo de roles a
  // mano, porque resuelve contra la fila viva de `User`. Este archivo se lleva
  // nombres y DNIs del registro entero (Ley 25.326).
  const actor = await requireAdmin();
  if (!actor.ok) return new Response(actor.error, { status: 403 });

  const { numero } = await params;
  const bookNumber = Number(numero);
  if (!Number.isInteger(bookNumber) || bookNumber <= 0) {
    return new Response("Libro inexistente", { status: 404 });
  }

  const result = await fetchBookRows(prisma, bookNumber);
  if (!result) return new Response("Libro inexistente", { status: 404 });
  const { book, rows } = result;

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(`libro-${book.number}`);
  ws.columns = COLUMNS.map((c) => ({ ...c }));

  // Fila 1: de qué libro es esta planilla y cuándo se sacó. Un libro cerrado se
  // exporta muchas veces y el archivo circula suelto por mail; sin esta línea,
  // dos descargas del mismo libro son indistinguibles entre sí.
  const estado = book.status === "open" ? "Abierto" : "Cerrado";
  const title = ws.addRow([
    `Libro N° ${book.number} — ${estado} — exportado el ${formatDateAR(new Date())}`,
  ]);
  title.font = { bold: true };

  ws.addRow(HEADERS).font = { bold: true };

  for (const row of rows) {
    ws.addRow({
      n: row.memberNumber,
      name: row.fullName,
      dni: row.dni ?? "",
      cat: CATEGORY_LABELS[row.category],
      st: STATUS_LABELS[row.status],
    });
  }

  const buffer = await wb.xlsx.writeBuffer();

  // Metadatos únicamente: qué libro, en qué estado y cuántas filas — nunca los
  // datos personales de esas filas. Sólo X-Real-IP, como el resto del panel
  // (Nginx la resuelve con el módulo realip y la sobrescribe).
  const ip = (await headers()).get("x-real-ip") ?? "unknown";
  await audit({
    userId: actor.actorId,
    action: "book_export",
    entity: "book",
    entityId: String(book.id),
    detail: { number: book.number, status: book.status, rows: rows.length },
    ip,
  });

  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="libro-${book.number}.xlsx"`,
      // El archivo trae nombres y DNIs (Ley 25.326): fuera de toda caché, igual
      // que el export del padrón. `Vary: Cookie` para que un proxy que respete
      // `no-store` tampoco lo sirva sin mirar la sesión.
      "Cache-Control": "no-store, private",
      Vary: "Cookie",
    },
  });
}
