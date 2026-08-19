// Idempotent import of datos/padron_socios.xlsx into Book 1.
// Run: npx tsx scripts/import-padron.ts [--update-existing]
//
// Por defecto SOLO crea los socios que faltan: los que ya están en la base no se
// tocan. Es a propósito. Una vez que la Comisión empiece a completar las fichas a
// mano desde el panel (DNI, domicilio, email, teléfono, fecha de nacimiento — todos
// campos que el Excel tiene vacíos), re-correr el script con sobrescritura les
// borraría ese trabajo sin decir nada. El script vive en el VPS y cualquiera lo
// puede ejecutar por error, así que el modo destructivo es opt-in explícito:
// --update-existing pisa los datos de los socios existentes con los del Excel.
//
// Esta es la carga fundacional del Libro de Socios: todo el sistema se construye
// encima. Ante cualquier ambigüedad el script ABORTA en vez de adivinar; nunca
// escribe un dato inventado ni descarta uno en silencio.
// `tsx` no carga `.env` por su cuenta: sin esto el singleton de Prisma no ve
// DATABASE_URL. Tiene que ser el primer import del archivo.
import "dotenv/config";

import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { prisma } from "../src/lib/prisma";
import { audit } from "../src/lib/audit";
import { mapPadronRow, type RawPadronRow } from "../src/lib/padron/mapping";
import { MemberEmailConflictError, memberWriter } from "../src/lib/members/write";

const FILE = join(process.cwd(), "datos", "padron_socios.xlsx");
const LOCK = join(process.cwd(), "datos", "~$padron_socios.xlsx");
const REPORT = join(process.cwd(), "padron-import-report.txt");

// La hoja se busca por nombre: si alguien agrega una hoja auxiliar adelante,
// importar "la primera" cargaría cualquier cosa.
const SHEET_NAME = "socios";

// Totales de control del Libro N° 1 tal como está el papel. Son constantes (y no
// literales sueltos) porque el reporte los imprime Y la validación los compara:
// tocar uno solo dejaría el reporte diciendo "esperado N" mientras valida otra cosa.
const EXPECTED_ROWS = 283;
const EXPECTED_ACTIVE = 160;
const EXPECTED_WITHDRAWN = EXPECTED_ROWS - EXPECTED_ACTIVE;
// Números de socio que el libro nunca usó (fichas anuladas o nunca asignadas).
// Se compara el CONJUNTO, no la cantidad: si se completara el 21 y desapareciera
// otro, el total seguiría dando 22 y el cambio pasaría inadvertido.
const EXPECTED_GAPS = [
  21, 71, 72, 73, 93, 94, 95, 97, 125, 132, 147, 199, 208, 214, 221, 222, 223, 224,
  238, 245, 254, 263,
] as const;

const EXPECTED_HEADERS = [
  "numero_socio", "apellido_nombre", "dni", "calle", "altura", "barrio",
  "nacionalidad", "fecha_nacimiento", "estado_civil", "ocupacion", "telefono",
  "email", "debito_automatico", "fecha_ingreso", "categoria_socio", "activo",
  "deuda_tesoreria", "fecha_egreso", "motivo_baja",
] as const;

type HeaderName = (typeof EXPECTED_HEADERS)[number];

// Un error de datos se arregla editando el Excel; uno de infraestructura, levantando
// la base. Para el operador se ven igual si no los distinguimos, así que los
// marcamos con una clase propia y el handler final los reporta distinto.
class PadronDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PadronDataError";
  }
}

type CellScalar = string | number | boolean | Date | null;

// Destino de un hipervínculo mailto:, o null si el link es de otro tipo (o no hay).
// El `?asunto=` que a veces agrega Outlook no forma parte de la dirección.
function mailtoTarget(hyperlink: string): string | null {
  if (!/^mailto:/i.test(hyperlink)) return null;
  const address = hyperlink.slice("mailto:".length).split("?")[0];
  try {
    return decodeURIComponent(address).trim();
  } catch {
    return address.trim();
  }
}

// ExcelJS devuelve un union amplio de formas de celda. Las contemplamos todas de
// forma explícita: para una carga fundacional, caer a `String(v)` escribiría
// "[object Object]" en el padrón y nadie se enteraría.
function normalizeCell(v: ExcelJS.CellValue, ref: string): CellScalar {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    // Celda de error de Excel: {error: '#N/A'}.
    if ("error" in v) {
      throw new PadronDataError(
        `celda ${ref}: contiene el error de Excel ${String(v.error)} — corregí la fórmula o pegá el valor a mano`,
      );
    }
    // Fórmula: el resultado cacheado puede faltar (archivo guardado sin recalcular).
    if ("formula" in v || "sharedFormula" in v) {
      const result = (v as ExcelJS.CellFormulaValue).result;
      if (result === undefined) {
        throw new PadronDataError(
          `celda ${ref}: fórmula sin resultado cacheado — abrí el archivo en Excel, recalculá y guardá (o pegá el valor)`,
        );
      }
      return normalizeCell(result as ExcelJS.CellValue, ref);
    }
    if ("richText" in v) return v.richText.map((r) => r.text).join("");
    // Hipervínculo: {text, hyperlink}. Es la forma que Excel genera al autolinkear
    // emails, y `text` puede ser string o, a su vez, texto enriquecido.
    if ("text" in v) {
      const shown = normalizeCell(v.text as ExcelJS.CellValue, ref);
      // Si alguien edita el texto de la celda DESPUÉS de que Excel la autolinkeó, el
      // texto visible y el destino del mailto: quedan distintos y no hay forma de
      // saber cuál es el email bueno. Quedarse con el texto (o con el link) elegiría
      // a ciegas, así que abortamos nombrando la celda.
      const link = "hyperlink" in v ? String((v as ExcelJS.CellHyperlinkValue).hyperlink ?? "") : "";
      const target = mailtoTarget(link);
      if (target !== null) {
        const shownText = (typeof shown === "string" ? shown : String(shown ?? "")).trim();
        if (target.toLowerCase() !== shownText.toLowerCase()) {
          throw new PadronDataError(
            `celda ${ref}: el texto visible ("${shownText}") no coincide con el destino del hipervínculo ` +
              `("${target}") — no hay forma de saber cuál es el correcto: borrá el hipervínculo (clic derecho → ` +
              `Quitar hipervínculo) dejando el texto bueno, o corregí el texto para que coincida`,
          );
        }
      }
      return shown;
    }
  }
  throw new PadronDataError(
    `celda ${ref}: tipo de valor de Excel no soportado (${JSON.stringify(v)}) — pegá el valor como texto plano`,
  );
}

const readCell = (cell: ExcelJS.Cell): CellScalar => normalizeCell(cell.value, cell.address);

// Los booleanos de Excel (TRUE/FALSE) se traducen a los literales "si"/"no" del
// padrón: `String(true)` daría "true", que no matchea el "si" que espera el mapeo
// y dejaría, por ejemplo, autoDebit en false sin ningún aviso.
const asStr = (v: CellScalar): string | null =>
  v === null
    ? null
    : typeof v === "boolean"
      ? v ? "si" : "no"
      : v instanceof Date
        ? v.toISOString()
        : String(v);

// Distingue "celda vacía" (dato que todavía no se cargó) de "celda con el tipo
// equivocado" (una fecha guardada como texto o como serial numérico crudo). El
// segundo caso antes se perdía en silencio y el único rastro era el aviso genérico
// "baja sin fecha_egreso", que atribuye mal la causa.
function asDate(v: CellScalar, field: HeaderName, ref: string): Date | null {
  if (v === null) return null;
  if (v instanceof Date) return v;
  // "" y "-" son la forma de escribir "vacío" a mano en este padrón.
  if (typeof v === "string" && (v.trim() === "" || v.trim() === "-")) return null;
  throw new PadronDataError(
    `celda ${ref} (${field}): se esperaba una fecha y vino ${typeof v} ${JSON.stringify(v)} — ` +
      `formateá la columna como fecha en Excel y volvé a guardar`,
  );
}

// El archivo ya cambió de forma una vez (se insertó una columna en el medio):
// resolvemos cada columna por NOMBRE de encabezado, nunca por posición fija.
function resolveColumns(headerRow: ExcelJS.Row): Map<string, number> {
  const found = new Map<string, number>();
  const seen: string[] = [];
  const duplicated = new Set<string>();
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const name = (asStr(readCell(cell)) ?? "").trim();
    if (name === "") return;
    seen.push(name);
    if (found.has(name)) duplicated.add(name);
    else found.set(name, colNumber);
  });

  // Con dos columnas del mismo nombre no hay forma de saber cuál es la buena:
  // quedarse con la primera puede importar una columna vieja sin decir nada.
  if (duplicated.size > 0) {
    throw new PadronDataError(
      [
        "El encabezado de padron_socios.xlsx tiene columnas duplicadas.",
        `  duplicadas : ${[...duplicated].join(", ")}`,
        `  encontrado : ${seen.join(", ")}`,
      ].join("\n"),
    );
  }

  const missing = EXPECTED_HEADERS.filter((h) => !found.has(h));
  const unexpected = seen.filter((h) => !(EXPECTED_HEADERS as readonly string[]).includes(h));
  if (missing.length > 0 || unexpected.length > 0) {
    throw new PadronDataError(
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

const UPDATE_FLAG = "--update-existing";

// Si el proceso muere en medio del loop, el reporte nunca se escribe: este contador
// vive afuera para que el handler de error pueda decir hasta dónde llegó.
const progress = { created: 0, updated: 0, unchanged: 0, conflicts: 0, memberships: 0, movements: 0 };

async function main() {
  const updateExisting = process.argv.slice(2).includes(UPDATE_FLAG);
  const unknownArgs = process.argv.slice(2).filter((a) => a !== UPDATE_FLAG);
  if (unknownArgs.length > 0) {
    throw new PadronDataError(
      `Argumento desconocido: ${unknownArgs.join(", ")}. Único flag válido: ${UPDATE_FLAG}`,
    );
  }

  if (existsSync(LOCK)) {
    throw new PadronDataError("padron_socios.xlsx está abierto en Excel (lock ~$). Cerralo y reintentá.");
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(FILE);
  const ws = wb.getWorksheet(SHEET_NAME);
  if (!ws) {
    throw new PadronDataError(
      `padron_socios.xlsx no tiene una hoja llamada "${SHEET_NAME}" ` +
        `(hojas presentes: ${wb.worksheets.map((w) => w.name).join(", ") || "ninguna"})`,
    );
  }

  const columns = resolveColumns(ws.getRow(1));

  const parsed: { rowNumber: number; raw: RawPadronRow }[] = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const cell = (name: HeaderName) => row.getCell(columns.get(name)!);
    const c = (name: HeaderName) => readCell(cell(name));
    const d = (name: HeaderName) => asDate(c(name), name, cell(name).address);
    const rawNumero = c("numero_socio");
    if (rawNumero === null) return; // fila vacía

    // Validamos el TIPO antes de convertir, no el resultado de la conversión. `Number()`
    // acepta cosas que no son un número de socio y que después pasan el chequeo de entero
    // positivo: un booleano TRUE se vuelve 1 (socio fantasma pisando al primero del libro)
    // y una celda formateada como fecha se vuelve un timestamp de milisegundos (~1,7e12)
    // que cuelga el cálculo de huecos, que itera de 1 hasta el máximo.
    if (typeof rawNumero !== "number" && !(typeof rawNumero === "string" && /^\s*\d+\s*$/.test(rawNumero))) {
      throw new PadronDataError(
        `fila ${rowNumber}: numero_socio inválido (${JSON.stringify(rawNumero)}, tipo ${
          rawNumero instanceof Date ? "fecha" : typeof rawNumero
        }) — la celda tiene que ser un número (o texto con solo dígitos); ` +
          `si se ve como fecha o como TRUE/FALSE, formateá la columna como número y volvé a escribir el valor`,
      );
    }
    const numeroSocio = Number(rawNumero);
    if (!Number.isInteger(numeroSocio) || numeroSocio <= 0) {
      throw new PadronDataError(
        `fila ${rowNumber}: numero_socio inválido (${JSON.stringify(rawNumero)}) — tiene que ser un entero positivo`,
      );
    }
    const ingreso = d("fecha_ingreso");
    if (!ingreso) throw new PadronDataError(`fila ${rowNumber}: fecha_ingreso vacía`);

    parsed.push({
      rowNumber,
      raw: {
        numero_socio: numeroSocio,
        apellido_nombre: asStr(c("apellido_nombre")) ?? "",
        dni: asStr(c("dni")),
        calle: asStr(c("calle")),
        altura: asStr(c("altura")),
        barrio: asStr(c("barrio")),
        nacionalidad: asStr(c("nacionalidad")),
        fecha_nacimiento: d("fecha_nacimiento"),
        estado_civil: asStr(c("estado_civil")),
        ocupacion: asStr(c("ocupacion")),
        telefono: asStr(c("telefono")),
        email: asStr(c("email")),
        debito_automatico: asStr(c("debito_automatico")),
        fecha_ingreso: ingreso,
        categoria_socio: asStr(c("categoria_socio")) ?? "",
        activo: asStr(c("activo")) ?? "",
        deuda_tesoreria: asStr(c("deuda_tesoreria")),
        fecha_egreso: d("fecha_egreso"),
        motivo_baja: asStr(c("motivo_baja")),
      },
    });
  });

  // Sin filas de datos no hay nada que importar, y todo lo que sigue asume al menos
  // una: el `reduce` de la fecha mínima usa `mapped[0]` como semilla (TypeError) y
  // `Math.max(...numbers)` devuelve -Infinity. Cortamos acá, con el motivo real:
  // casi siempre es un archivo con el encabezado pero sin datos debajo.
  if (parsed.length === 0) {
    throw new PadronDataError(
      `la hoja "${SHEET_NAME}" de padron_socios.xlsx no tiene ninguna fila de datos ` +
        `(solo el encabezado, o todas las filas con numero_socio vacío) — ` +
        `revisá que el archivo sea el padrón completo y no una copia vaciada`,
    );
  }

  // Dos filas con el mismo número de socio serían dos personas peleando por la
  // misma ficha del libro: la clave de idempotencia es (libro, numero_socio).
  const rowsByNumber = new Map<number, number[]>();
  for (const p of parsed) {
    const list = rowsByNumber.get(p.raw.numero_socio) ?? [];
    list.push(p.rowNumber);
    rowsByNumber.set(p.raw.numero_socio, list);
  }
  const duplicatedNumbers = [...rowsByNumber.entries()].filter(([, rowNumbers]) => rowNumbers.length > 1);
  if (duplicatedNumbers.length > 0) {
    throw new PadronDataError(
      [
        "padron_socios.xlsx tiene numero_socio duplicados:",
        ...duplicatedNumbers.map(([n, rowNumbers]) => `  socio ${n}: filas ${rowNumbers.join(", ")}`),
      ].join("\n"),
    );
  }

  // `mapPadronRow` lo importa también la app, así que lanza `Error` pelado — pero sus
  // dos rechazos (categoria_socio desconocida, activo que no es Si/No) son errores del
  // Excel, y son justo los primeros que produce alguien tipeando. Sin esto el handler
  // final los clasificaría como problema de infraestructura y mandaría al operador a
  // revisar MariaDB. De paso les agregamos la fila, que el mensaje original no trae.
  const mapped = parsed.map((p) => {
    try {
      return mapPadronRow(p.raw);
    } catch (err) {
      if (err instanceof PadronDataError) throw err;
      throw new PadronDataError(`fila ${p.rowNumber}: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
  const warnings = mapped.flatMap((m) => m.warnings);

  const minJoined = mapped.reduce((min, m) => (m.member.joinedAt < min ? m.member.joinedAt : min), mapped[0].member.joinedAt);
  const book = await prisma.book.upsert({
    where: { number: 1 },
    create: { number: 1, status: "open", openedAt: minJoined },
    update: {},
  });

  for (const m of mapped) {
    const existing = await prisma.membership.findUnique({
      where: { bookId_memberNumber: { bookId: book.id, memberNumber: m.memberNumber } },
    });
    if (existing) {
      // Sin el flag no escribimos nada sobre un socio ya cargado: las correcciones
      // hechas desde el panel valen más que los nulos del Excel.
      if (!updateExisting) {
        progress.unchanged++;
        continue;
      }
      // Pasa por `memberWriter` y no por `prisma.member.update` a secas: si el
      // Excel trae otra dirección de correo (o la borra, o la fila viene con la
      // baja asentada), los enlaces de verificación/invitación vivos de ese socio
      // dejan de estar autorizados y hay que revocarlos en la misma transacción,
      // y si el socio ya tiene cuenta de acceso hay que llevarle la dirección
      // nueva también a la cuenta.
      try {
        await memberWriter.updateMember(existing.memberId, m.member);
        progress.updated++;
      } catch (err) {
        // El Excel le pone a este socio una dirección que ya es la de otra
        // cuenta de acceso. Es un dato a corregir, no una falla del import: se
        // saltea esta fila (no se escribió nada de ella) y se sigue, porque
        // abortar dejaría el resto del padrón sin actualizar por un email mal
        // tipeado en una celda.
        if (!(err instanceof MemberEmailConflictError)) throw err;
        warnings.push(
          `socio ${m.memberNumber}: el email del Excel ya pertenece a otra cuenta de acceso — ` +
            `la fila NO se actualizó, corregí la dirección y volvé a correr el import`,
        );
        progress.conflicts++;
      }
    } else {
      // Las tres escrituras van en una transacción. Si no, un corte entre la segunda
      // y la tercera dejaría al socio sin asiento de admisión PARA SIEMPRE: la clave
      // de idempotencia es (libro, numero_socio), así que la re-corrida lo saltearía
      // y nunca repararía el movimiento faltante. Y un corte entre la primera y la
      // segunda dejaría un Member huérfano que, para los socios sin DNI (MariaDB
      // permite repetir NULL en un UNIQUE), la re-corrida duplicaría en silencio.
      await prisma.$transaction(async (tx) => {
        const member = await tx.member.create({ data: m.member });
        await tx.membership.create({
          data: { memberId: member.id, bookId: book.id, memberNumber: m.memberNumber },
        });
        await tx.movement.create({
          data: {
            memberId: member.id, type: "admission", date: m.member.joinedAt,
            newCategory: m.member.category, detail: "import Libro 1 (acta física no digitalizada)",
          },
        });
      });
      progress.created++;
      progress.memberships++;
      progress.movements++;
    }
  }

  const total = mapped.length;
  const vigentes = mapped.filter((m) => m.member.status === "active").length;
  const bajas = total - vigentes;
  const numbers = new Set(mapped.map((m) => m.memberNumber));
  const maxN = Math.max(...numbers);
  const gaps: number[] = [];
  for (let i = 1; i <= maxN; i++) if (!numbers.has(i)) gaps.push(i);

  const gapSet = new Set(gaps);
  const expectedGapSet = new Set<number>(EXPECTED_GAPS);
  const newGaps = gaps.filter((g) => !expectedGapSet.has(g));
  const filledGaps = EXPECTED_GAPS.filter((g) => !gapSet.has(g));
  const gapsOk = newGaps.length === 0 && filledGaps.length === 0;

  // Conteos leídos de la base (no de los contadores del loop): es lo que hay que
  // mirar para confirmar que cada socio quedó con su membresía y su admisión.
  // Los dos conteos que se comparan abajo tienen que cubrir el MISMO universo: los
  // socios de este libro. Contar todas las admisiones sin filtrar hoy da igual porque
  // hay un solo libro, pero cuando el re-empadronamiento estatutario abra el Libro 2
  // los socios re-empadronados sumarían admisiones que este libro no tiene y la alerta
  // gritaría para siempre sin que haya nada roto — y una alerta que grita en falso se
  // termina ignorando, justo la que detecta un socio sin asiento de admisión.
  const dbMembers = await prisma.member.count();
  const dbMemberships = await prisma.membership.count({ where: { bookId: book.id } });
  const dbAdmissions = await prisma.movement.count({
    where: { type: "admission", member: { memberships: { some: { bookId: book.id } } } },
  });

  const lines = [
    `Padron import — ${new Date().toISOString()}`,
    `filas: ${total} (esperado ${EXPECTED_ROWS}) | vigentes: ${vigentes} (esperado ${EXPECTED_ACTIVE}) | bajas: ${bajas} (esperado ${EXPECTED_WITHDRAWN})`,
    `numeracion: 1..${maxN} | huecos (${gaps.length}, esperado ${EXPECTED_GAPS.length}): ${gaps.join(", ")}`,
    ...(gapsOk
      ? []
      : [
          newGaps.length > 0 ? `  huecos NUEVOS (no esperados): ${newGaps.join(", ")}` : null,
          filledGaps.length > 0 ? `  huecos que se completaron: ${filledGaps.join(", ")}` : null,
        ].filter((l): l is string => l !== null)),
    `modo: ${updateExisting ? `${UPDATE_FLAG} (los existentes se pisan con el Excel)` : "solo alta (por defecto)"}`,
    `creados: ${progress.created} | actualizados: ${progress.updated} | sin cambios: ${progress.unchanged}`
      + (progress.conflicts > 0 ? ` | NO actualizados por email en conflicto: ${progress.conflicts}` : ""),
    `memberships creadas: ${progress.memberships} | movements de admision creados: ${progress.movements}`,
    `en base: members ${dbMembers} | memberships libro ${book.number}: ${dbMemberships} | movements admission libro ${book.number}: ${dbAdmissions}`,
    ...(updateExisting
      ? []
      : [
          `los ${progress.unchanged} socios ya existentes NO se tocaron (se conservan los datos cargados desde el panel).`,
          `  para pisarlos con los datos del Excel: npx tsx scripts/import-padron.ts ${UPDATE_FLAG}`,
        ]),
    `avisos (${warnings.length}):`,
    ...warnings.map((w) => `  - ${w}`),
  ];
  if (total !== EXPECTED_ROWS || vigentes !== EXPECTED_ACTIVE || !gapsOk) {
    lines.push("ATENCION: TOTALES DISTINTOS DE LOS ESPERADOS — revisar antes de continuar");
  }
  if (dbMemberships !== dbAdmissions) {
    lines.push(
      `ATENCION: el libro ${book.number} tiene ${dbMemberships} memberships y ${dbAdmissions} movimientos de admision — algun socio quedo sin asiento`,
    );
  }
  const report = lines.join("\n");
  console.log(report);
  writeFileSync(REPORT, report + "\n", "utf8");

  await audit({
    action: "padron_import", entity: "book", entityId: book.id,
    detail: {
      total, vigentes, bajas, created: progress.created, updated: progress.updated,
      unchanged: progress.unchanged, conflicts: progress.conflicts,
      memberships: progress.memberships, movements: progress.movements,
      updateExisting, warnings: warnings.length,
    },
  });
}

main()
  .catch((err: unknown) => {
    process.exitCode = 1;
    const isDataError = err instanceof PadronDataError;
    const message = err instanceof Error ? err.message : String(err);
    console.error("");
    console.error(
      isDataError
        ? "IMPORT ABORTADO — ERROR DE DATOS O DE USO: revisá datos/padron_socios.xlsx (o los argumentos del comando); la base no es el problema"
        : "IMPORT ABORTADO — ERROR DE INFRAESTRUCTURA: el Excel no es el problema (base, red o entorno)",
    );
    for (const line of message.split("\n")) console.error(`  ${line}`);
    if (!isDataError) {
      console.error("  Revisá que MariaDB esté levantada (docker compose up -d) y que DATABASE_URL apunte a ella.");
      if (err instanceof Error && err.stack) console.error(err.stack);
    }
    console.error(
      `  progreso antes de abortar: creados ${progress.created}, actualizados ${progress.updated}, ` +
        `sin cambios ${progress.unchanged} (memberships ${progress.memberships}, movements ${progress.movements})`,
    );
    console.error("  El script es idempotente: corregí la causa y volvé a correrlo (los socios ya cargados se saltean).");
  })
  .finally(() => prisma.$disconnect());
