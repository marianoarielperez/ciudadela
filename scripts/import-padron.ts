// Idempotent import of datos/padron_socios.xlsx into Book 1.
// Run: npx tsx scripts/import-padron.ts
// `tsx` no carga `.env` por su cuenta: sin esto el singleton de Prisma no ve
// DATABASE_URL. Tiene que ser el primer import del archivo.
import "dotenv/config";

import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { prisma } from "../src/lib/prisma";
import { audit } from "../src/lib/audit";
import { mapPadronRow, type RawPadronRow } from "../src/lib/padron/mapping";

const FILE = join(process.cwd(), "datos", "padron_socios.xlsx");
const LOCK = join(process.cwd(), "datos", "~$padron_socios.xlsx");
const EXPECTED_HEADERS = [
  "numero_socio", "apellido_nombre", "dni", "calle", "altura", "barrio",
  "nacionalidad", "fecha_nacimiento", "estado_civil", "ocupacion", "telefono",
  "email", "debito_automatico", "fecha_ingreso", "categoria_socio", "activo",
  "deuda_tesoreria", "fecha_egreso", "motivo_baja",
] as const;

// ExcelJS cell values can be strings, numbers, Dates, or objects
// (hyperlinks {text,hyperlink}, rich text {richText:[...]}).
function cellValue(v: ExcelJS.CellValue): string | number | Date | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" || typeof v === "number" || v instanceof Date) return v;
  if (typeof v === "object") {
    if ("text" in v && typeof v.text === "string") return v.text;
    if ("richText" in v) return v.richText.map((r) => r.text).join("");
    if ("result" in v) return cellValue(v.result as ExcelJS.CellValue);
  }
  return String(v);
}
const asStr = (v: ReturnType<typeof cellValue>): string | null =>
  v === null ? null : v instanceof Date ? v.toISOString() : String(v);
const asDate = (v: ReturnType<typeof cellValue>): Date | null => (v instanceof Date ? v : null);

// El archivo ya cambió de forma una vez (se insertó una columna en el medio):
// resolvemos cada columna por NOMBRE de encabezado, nunca por posición fija.
function resolveColumns(headerRow: ExcelJS.Row): Map<string, number> {
  const found = new Map<string, number>();
  const seen: string[] = [];
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const name = (asStr(cellValue(cell.value)) ?? "").trim();
    if (name === "") return;
    seen.push(name);
    if (!found.has(name)) found.set(name, colNumber);
  });

  const missing = EXPECTED_HEADERS.filter((h) => !found.has(h));
  const unexpected = seen.filter((h) => !(EXPECTED_HEADERS as readonly string[]).includes(h));
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      [
        "El encabezado de padron_socios.xlsx no coincide con el esperado.",
        `  encontrado : ${seen.join(", ")}`,
        `  esperado   : ${EXPECTED_HEADERS.join(", ")}`,
        missing.length > 0 ? `  faltan     : ${missing.join(", ")}` : null,
        unexpected.length > 0 ? `  sobran     : ${unexpected.join(", ")}` : null,
      ].filter(Boolean).join("\n"),
    );
  }
  return found;
}

async function main() {
  if (existsSync(LOCK)) {
    throw new Error("padron_socios.xlsx está abierto en Excel (lock ~$). Cerralo y reintentá.");
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(FILE);
  const ws = wb.worksheets[0];

  const columns = resolveColumns(ws.getRow(1));

  const rows: RawPadronRow[] = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const c = (name: (typeof EXPECTED_HEADERS)[number]) => cellValue(row.getCell(columns.get(name)!).value);
    if (c("numero_socio") === null) return; // fila vacía
    const ingreso = asDate(c("fecha_ingreso"));
    if (!ingreso) throw new Error(`fila ${rowNumber}: fecha_ingreso inválida`);
    rows.push({
      numero_socio: Number(c("numero_socio")),
      apellido_nombre: asStr(c("apellido_nombre")) ?? "",
      dni: asStr(c("dni")),
      calle: asStr(c("calle")),
      altura: asStr(c("altura")),
      barrio: asStr(c("barrio")),
      nacionalidad: asStr(c("nacionalidad")),
      fecha_nacimiento: asDate(c("fecha_nacimiento")),
      estado_civil: asStr(c("estado_civil")),
      ocupacion: asStr(c("ocupacion")),
      telefono: asStr(c("telefono")),
      email: asStr(c("email")),
      debito_automatico: asStr(c("debito_automatico")),
      fecha_ingreso: ingreso,
      categoria_socio: asStr(c("categoria_socio")) ?? "",
      activo: asStr(c("activo")) ?? "",
      deuda_tesoreria: asStr(c("deuda_tesoreria")),
      fecha_egreso: asDate(c("fecha_egreso")),
      motivo_baja: asStr(c("motivo_baja")),
    });
  });

  const mapped = rows.map(mapPadronRow);
  const warnings = mapped.flatMap((m) => m.warnings);

  const minJoined = mapped.reduce((min, m) => (m.member.joinedAt < min ? m.member.joinedAt : min), mapped[0].member.joinedAt);
  const book = await prisma.book.upsert({
    where: { number: 1 },
    create: { number: 1, status: "open", openedAt: minJoined },
    update: {},
  });

  let created = 0;
  let updated = 0;
  for (const m of mapped) {
    const existing = await prisma.membership.findUnique({
      where: { bookId_memberNumber: { bookId: book.id, memberNumber: m.memberNumber } },
    });
    if (existing) {
      await prisma.member.update({ where: { id: existing.memberId }, data: m.member });
      updated++;
    } else {
      const member = await prisma.member.create({ data: m.member });
      await prisma.membership.create({
        data: { memberId: member.id, bookId: book.id, memberNumber: m.memberNumber },
      });
      await prisma.movement.create({
        data: {
          memberId: member.id, type: "admission", date: m.member.joinedAt,
          newCategory: m.member.category, detail: "import Libro 1 (acta física no digitalizada)",
        },
      });
      created++;
    }
  }

  const total = mapped.length;
  const vigentes = mapped.filter((m) => m.member.status === "active").length;
  const bajas = total - vigentes;
  const numbers = new Set(mapped.map((m) => m.memberNumber));
  const maxN = Math.max(...numbers);
  const gaps: number[] = [];
  for (let i = 1; i <= maxN; i++) if (!numbers.has(i)) gaps.push(i);

  const lines = [
    `Padron import — ${new Date().toISOString()}`,
    `filas: ${total} (esperado 283) | vigentes: ${vigentes} (esperado 160) | bajas: ${bajas} (esperado 123)`,
    `numeracion: 1..${maxN} | huecos (${gaps.length}, esperado 22): ${gaps.join(", ")}`,
    `creados: ${created} | actualizados: ${updated}`,
    `avisos (${warnings.length}):`,
    ...warnings.map((w) => `  - ${w}`),
  ];
  if (total !== 283 || vigentes !== 160 || gaps.length !== 22) {
    lines.push("ATENCION: TOTALES DISTINTOS DE LOS ESPERADOS — revisar antes de continuar");
  }
  const report = lines.join("\n");
  console.log(report);
  writeFileSync(join(process.cwd(), "padron-import-report.txt"), report + "\n", "utf8");

  await audit({
    action: "padron_import", entity: "book", entityId: book.id,
    detail: { total, vigentes, bajas, created, updated, warnings: warnings.length },
  });
}

main().finally(() => prisma.$disconnect());
