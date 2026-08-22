// Carga la deuda histórica de datos/deuda.xlsx como cuotas `origin = import`.
// Run: npx tsx scripts/import-deuda.ts
//
// El archivo no trae montos: dice CUÁNTAS cuotas debe cada socio en cada año
// calendario. La deuda se valúa siempre a valor vigente al momento del pago
// (spec §2.2), así que lo único que hay que decidir es en qué MES cae cada
// cuota — y eso lo resuelve `planDebtImport`, que es puro y está probado
// aparte.
//
// Idempotente por socio: si ya tiene alguna cuota importada, se saltea entero.
// Aborta ante cualquier fila que no matchee número Y DNI con la base: esta
// deuda se va a cobrar y a notificar fehacientemente, así que no se carga sobre
// una ficha dudosa. Nunca pisa una cuota existente —las `accrual` que haya
// devengado el cron son del sistema y mandan—, pero tampoco las saltea en
// silencio: el reporte las cuenta.
//
// `tsx` no carga `.env` por su cuenta: sin esto el singleton de Prisma no ve
// DATABASE_URL. Tiene que ser el primer import del archivo.
import "dotenv/config";

import { existsSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { prisma } from "../src/lib/prisma";
import { audit } from "../src/lib/audit";
import { excelDateToCivilUtc } from "../src/lib/dates";
import { planDebtImport, type DebtRow } from "../src/lib/treasury/debt-import";
import { comparePeriods, periodOf } from "../src/lib/treasury/periods";

const FILE = join(process.cwd(), "datos", "deuda.xlsx");
const LOCK = join(process.cwd(), "datos", "~$deuda.xlsx");
const SHEET_NAME = "deuda";
const YEARS = [2022, 2023, 2024, 2025, 2026] as const;
const EXPECTED_HEADERS = [
  "numero_socio", "apellido_nombre", "dni", "categoria_socio",
  ...YEARS.map((y) => `cuotas_deuda_${y}`), "fecha_egreso",
] as const;

// Totales de control medidos sobre el archivo del 21/08/2026. Son constantes (y
// no literales sueltos) porque el reporte los imprime Y la validación los
// compara: tocar uno solo dejaría el reporte diciendo "esperado N" mientras
// valida otra cosa.
const EXPECTED_ROWS = 278;
const EXPECTED_TOTAL_FEES = 3080;
const EXPECTED_DEBTORS = 119;

// Un error de datos se arregla editando el Excel; uno de infraestructura,
// levantando la base. Para el operador se ven igual si no los distinguimos.
class DebtDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DebtDataError";
  }
}

type CellScalar = string | number | boolean | Date | null;

// ExcelJS devuelve un union amplio de formas de celda. Las contemplamos todas
// de forma explícita: caer a `String(v)` escribiría "[object Object]" donde va
// un DNI o una cantidad de cuotas y nadie se enteraría.
function normalizeCell(v: ExcelJS.CellValue, ref: string): CellScalar {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    if ("error" in v) {
      throw new DebtDataError(
        `celda ${ref}: contiene el error de Excel ${String(v.error)} — corregí la fórmula o pegá el valor a mano`,
      );
    }
    if ("formula" in v || "sharedFormula" in v) {
      const result = (v as ExcelJS.CellFormulaValue).result;
      if (result === undefined) {
        throw new DebtDataError(
          `celda ${ref}: fórmula sin resultado cacheado — abrí el archivo en Excel, recalculá y guardá (o pegá el valor)`,
        );
      }
      return normalizeCell(result as ExcelJS.CellValue, ref);
    }
    if ("richText" in v) return v.richText.map((r) => r.text).join("");
    if ("text" in v) return normalizeCell(v.text as ExcelJS.CellValue, ref);
  }
  throw new DebtDataError(
    `celda ${ref}: tipo de valor de Excel no soportado (${JSON.stringify(v)}) — pegá el valor como texto plano`,
  );
}

const readCell = (cell: ExcelJS.Cell): CellScalar => normalizeCell(cell.value, cell.address);

// El archivo del padrón ya cambió de forma una vez (se insertó una columna en el
// medio): resolvemos cada columna por NOMBRE de encabezado, nunca por posición.
function resolveColumns(headerRow: ExcelJS.Row): Map<string, number> {
  const found = new Map<string, number>();
  const seen: string[] = [];
  const duplicated = new Set<string>();
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const raw = readCell(cell);
    const name = String(raw ?? "").trim();
    if (name === "") return;
    seen.push(name);
    if (found.has(name)) duplicated.add(name);
    else found.set(name, colNumber);
  });
  // Con dos columnas del mismo nombre no hay forma de saber cuál es la buena.
  if (duplicated.size > 0) {
    throw new DebtDataError(
      [
        "El encabezado de deuda.xlsx tiene columnas duplicadas.",
        `  duplicadas : ${[...duplicated].join(", ")}`,
        `  encontrado : ${seen.join(", ")}`,
      ].join("\n"),
    );
  }
  const missing = EXPECTED_HEADERS.filter((h) => !found.has(h));
  if (missing.length > 0) {
    throw new DebtDataError(
      [
        "El encabezado de deuda.xlsx no coincide con el esperado.",
        `  encontrado : ${seen.join(", ")}`,
        `  esperado   : ${EXPECTED_HEADERS.join(", ")}`,
        `  faltan     : ${missing.join(", ")}`,
      ].join("\n"),
    );
  }
  return found;
}

// Contadores fuera de main() para que el handler de error pueda decir hasta
// dónde llegó si el proceso muere en medio del loop de escritura.
const progress = { imported: 0, skipped: 0, fees: 0, collisions: 0 };

async function main() {
  if (existsSync(LOCK)) {
    throw new DebtDataError("deuda.xlsx está abierto en Excel (lock ~$). Cerralo y reintentá.");
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(FILE);
  const ws = wb.getWorksheet(SHEET_NAME);
  if (!ws) {
    throw new DebtDataError(
      `deuda.xlsx no tiene una hoja llamada "${SHEET_NAME}" ` +
        `(hojas presentes: ${wb.worksheets.map((w) => w.name).join(", ") || "ninguna"})`,
    );
  }
  const columns = resolveColumns(ws.getRow(1));

  const rows: DebtRow[] = [];
  const rowsByNumber = new Map<number, number[]>();
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const cell = (name: string) => row.getCell(columns.get(name)!);
    const c = (name: string) => readCell(cell(name));

    const numero = c("numero_socio");
    if (numero === null) return; // fila vacía
    // Se valida el TIPO antes de convertir: `Number(true)` es 1 y una celda
    // formateada como fecha es un timestamp, y los dos pasarían el chequeo de
    // entero positivo apuntando a un socio que no es.
    if (typeof numero !== "number" || !Number.isInteger(numero) || numero <= 0) {
      throw new DebtDataError(
        `fila ${rowNumber}: numero_socio inválido (${JSON.stringify(numero)}) — tiene que ser un entero positivo`,
      );
    }
    const dni = c("dni");
    if (dni === null || String(dni).trim() === "") {
      throw new DebtDataError(
        `fila ${rowNumber} (socio ${numero}): dni vacío — el import matchea por número Y DNI, no se puede cargar deuda sin él`,
      );
    }

    const counts: DebtRow["counts"] = {};
    for (const y of YEARS) {
      const v = c(`cuotas_deuda_${y}`);
      // Celda vacía = "no corresponde" (un adherente nunca devengó). No es un 0.
      if (v === null || (typeof v === "string" && v.trim() === "")) counts[y] = null;
      else if (typeof v === "number") counts[y] = v;
      else {
        throw new DebtDataError(
          `fila ${rowNumber} (socio ${numero}): cuotas_deuda_${y} no es numérico (${JSON.stringify(v)}) — ` +
            `formateá la columna como número y volvé a escribir el valor`,
        );
      }
    }

    const egreso = c("fecha_egreso");
    // Una fecha guardada como texto se perdería en silencio y la deuda del año
    // de la baja caería en los meses equivocados: es el caso que más importa.
    if (egreso !== null && !(egreso instanceof Date) && String(egreso).trim() !== "" && String(egreso).trim() !== "-") {
      throw new DebtDataError(
        `fila ${rowNumber} (socio ${numero}): fecha_egreso no es una fecha (${JSON.stringify(egreso)}) — ` +
          `formateá la columna como fecha en Excel y volvé a guardar`,
      );
    }

    rows.push({
      memberNumber: numero,
      dni: String(dni).trim(),
      counts,
      leftAt: egreso instanceof Date ? excelDateToCivilUtc(egreso) : null,
    });
    rowsByNumber.set(numero, [...(rowsByNumber.get(numero) ?? []), rowNumber]);
  });

  if (rows.length === 0) {
    throw new DebtDataError(
      `la hoja "${SHEET_NAME}" de deuda.xlsx no tiene ninguna fila de datos (solo el encabezado, ` +
        `o todas las filas con numero_socio vacío)`,
    );
  }
  // Dos filas con el mismo socio serían dos deudas peleando por la misma ficha.
  const duplicated = [...rowsByNumber.entries()].filter(([, rns]) => rns.length > 1);
  if (duplicated.length > 0) {
    throw new DebtDataError(
      [
        "deuda.xlsx tiene numero_socio duplicados:",
        ...duplicated.map(([n, rns]) => `  socio ${n}: filas ${rns.join(", ")}`),
      ].join("\n"),
    );
  }

  const { plans, errors } = planDebtImport(rows);
  if (errors.length > 0) throw new DebtDataError(["deuda.xlsx tiene cantidades imposibles:", ...errors].join("\n"));

  // ── Join con la base: por número de socio del libro abierto Y por DNI ──────
  const openBooks = await prisma.book.findMany({ where: { status: "open" }, orderBy: { number: "asc" } });
  if (openBooks.length !== 1) {
    throw new DebtDataError(
      openBooks.length === 0
        ? "no hay ningún Libro de Socios abierto — corré primero scripts/import-padron.ts"
        : `hay ${openBooks.length} libros abiertos (${openBooks.map((b) => b.number).join(", ")}): ` +
          `no se puede decidir a cuál pertenece esta deuda`,
    );
  }
  const book = openBooks[0];
  const memberships = await prisma.membership.findMany({
    where: { bookId: book.id },
    select: { memberNumber: true, member: { select: { id: true, dni: true, joinedAt: true, leftAt: true } } },
  });
  const byNumber = new Map(memberships.map((m) => [m.memberNumber, m.member]));

  const mismatches: string[] = [];
  for (const r of rows) {
    const m = byNumber.get(r.memberNumber);
    // Los mensajes nombran el número de socio y nunca el DNI ni el nombre: el
    // número no es dato personal, los otros dos sí (Ley 25.326).
    if (!m) mismatches.push(`socio ${r.memberNumber}: no está en el libro ${book.number}`);
    else if ((m.dni ?? "") !== r.dni) {
      mismatches.push(`socio ${r.memberNumber}: el DNI del Excel no coincide con el de la ficha`);
    }
  }
  if (mismatches.length > 0) {
    throw new DebtDataError(
      [
        "deuda.xlsx no coincide con el padrón cargado:",
        ...mismatches.map((m) => `  ${m}`),
        "Corré scripts/import-padron.ts con el padrón definitivo antes de cargar la deuda.",
      ].join("\n"),
    );
  }

  // ── Avisos: nada se descarta en silencio ──────────────────────────────────
  const warnings: string[] = [];
  const inExcel = new Set(rows.map((r) => r.memberNumber));
  const notInExcel = memberships.map((m) => m.memberNumber).filter((n) => !inExcel.has(n)).sort((a, b) => a - b);
  if (notInExcel.length > 0) {
    warnings.push(
      `${notInExcel.length} socios del libro ${book.number} no figuran en deuda.xlsx y quedan sin deuda ` +
        `importada: ${notInExcel.join(", ")}`,
    );
  }
  const rowByNumber = new Map(rows.map((r) => [r.memberNumber, r]));
  for (const plan of plans) {
    const m = byNumber.get(plan.memberNumber)!;
    // El mes de la baja decide en qué meses cae la deuda del año de la baja: si
    // los dos Excel no dicen lo mismo, la deuda queda imputada a meses
    // distintos de los que muestra la ficha del socio.
    const fichaLeft = m.leftAt ? periodOf(m.leftAt) : null;
    const excelLeft = rowByNumber.get(plan.memberNumber)!.leftAt;
    const excelLeftPeriod = excelLeft ? periodOf(excelLeft) : null;
    if (fichaLeft !== excelLeftPeriod) {
      warnings.push(
        `socio ${plan.memberNumber}: la baja de deuda.xlsx (${excelLeftPeriod ?? "sin baja"}) no coincide con la ` +
          `de la ficha (${fichaLeft ?? "sin baja"}) — la deuda se imputó según deuda.xlsx`,
      );
    }
    // Cuotas anteriores al ingreso: el Excel pidió más cuotas de las que ese
    // año pudo devengar para este socio. No se descarta ninguna (la cantidad la
    // puso el tesorero), pero tiene que quedar dicho.
    const joined = periodOf(m.joinedAt);
    if (comparePeriods(plan.periods[0], joined) < 0) {
      warnings.push(
        `socio ${plan.memberNumber}: la deuda arranca en ${plan.periods[0]}, antes de su ingreso (${joined}) — ` +
          `revisá la cantidad del primer año`,
      );
    }
  }

  // ── Escritura ─────────────────────────────────────────────────────────────
  const memberIds = plans.map((p) => byNumber.get(p.memberNumber)!.id);
  const existingFees = await prisma.fee.findMany({
    where: { memberId: { in: memberIds } },
    select: { memberId: true, period: true, origin: true },
  });
  const alreadyImported = new Set(existingFees.filter((f) => f.origin === "import").map((f) => f.memberId));
  const takenPeriods = new Map<number, Set<string>>();
  for (const f of existingFees) {
    const set = takenPeriods.get(f.memberId) ?? new Set<string>();
    set.add(f.period);
    takenPeriods.set(f.memberId, set);
  }

  for (const plan of plans) {
    const member = byNumber.get(plan.memberNumber)!;
    if (alreadyImported.has(member.id)) {
      progress.skipped++;
      continue;
    }
    const taken = takenPeriods.get(member.id) ?? new Set<string>();
    // Las cuotas que el cron ya devengó mandan: son del sistema y pueden estar
    // pagas. Se saltean, pero se cuentan (`@@unique(memberId, period)` haría
    // fallar el INSERT entero si intentáramos crearlas).
    const toCreate = plan.periods.filter((p) => !taken.has(p));
    progress.collisions += plan.periods.length - toCreate.length;
    if (toCreate.length === 0) continue;
    // Un solo `createMany` = un solo INSERT = atómico: o el socio queda con toda
    // su deuda importada o con ninguna, que es justo lo que asume la clave de
    // idempotencia ("tiene alguna cuota importada"). Por eso el script se puede
    // cortar a la mitad y re-correr sin dejar a nadie con media deuda.
    await prisma.fee.createMany({
      data: toCreate.map((period) => ({ memberId: member.id, period, status: "pending" as const, origin: "import" as const })),
    });
    progress.imported++;
    progress.fees += toCreate.length;
  }

  const totalFees = plans.reduce((n, p) => n + p.periods.length, 0);
  const totalsOk = rows.length === EXPECTED_ROWS && plans.length === EXPECTED_DEBTORS && totalFees === EXPECTED_TOTAL_FEES;
  // Se cuenta acotado al libro: cuando el re-empadronamiento abra el Libro 2,
  // un total global diría otra cosa que lo que este import escribió.
  const dbImported = await prisma.fee.count({
    where: { origin: "import", member: { memberships: { some: { bookId: book.id } } } },
  });

  const lines = [
    `Debt import — ${new Date().toISOString()}`,
    `filas: ${rows.length} (esperado ${EXPECTED_ROWS}) | socios con deuda: ${plans.length} (esperado ${EXPECTED_DEBTORS}) ` +
      `| cuotas en el Excel: ${totalFees} (esperado ${EXPECTED_TOTAL_FEES})`,
    `importados: ${progress.imported} | salteados (ya tenían deuda importada): ${progress.skipped} | ` +
      `cuotas creadas: ${progress.fees}` +
      (progress.collisions > 0 ? ` | cuotas del Excel que ya existían devengadas: ${progress.collisions}` : ""),
    `en base: cuotas origin=import del libro ${book.number}: ${dbImported}`,
    `avisos (${warnings.length}):`,
    ...warnings.map((w) => `  - ${w}`),
  ];
  if (!totalsOk) lines.push("ATENCION: TOTALES DISTINTOS DE LOS ESPERADOS — revisar antes de continuar");
  console.log(lines.join("\n"));

  // El asiento lleva solo contadores: ni nombres ni DNIs (Ley 25.326).
  await audit({
    action: "debt_import",
    entity: "book",
    entityId: book.id,
    detail: {
      rows: rows.length, debtors: plans.length, totalFees,
      imported: progress.imported, skipped: progress.skipped,
      feesCreated: progress.fees, collisions: progress.collisions,
      warnings: warnings.length, totalsOk,
    },
  });
}

main()
  .catch((err: unknown) => {
    process.exitCode = 1;
    const isDataError = err instanceof DebtDataError;
    const message = err instanceof Error ? err.message : String(err);
    console.error("");
    console.error(
      isDataError
        ? "IMPORT ABORTADO — ERROR DE DATOS: revisá datos/deuda.xlsx; la base no es el problema"
        : "IMPORT ABORTADO — ERROR DE INFRAESTRUCTURA: el Excel no es el problema (base, red o entorno)",
    );
    for (const line of message.split("\n")) console.error(`  ${line}`);
    if (!isDataError) {
      console.error("  Revisá que MariaDB esté levantada (docker compose up -d) y que DATABASE_URL apunte a ella.");
      if (err instanceof Error && err.stack) console.error(err.stack);
    }
    console.error(
      `  progreso antes de abortar: socios importados ${progress.imported}, salteados ${progress.skipped}, ` +
        `cuotas creadas ${progress.fees}`,
    );
    console.error("  El script es idempotente: corregí la causa y volvé a correrlo (los socios ya cargados se saltean).");
  })
  .finally(() => prisma.$disconnect());
