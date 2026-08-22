// Idempotent import of datos/padron_socios.xlsx into Book 1.
// Run: npx tsx scripts/import-padron.ts [--update-existing] [--prune --yes]
//
// Por defecto SOLO crea los socios que faltan: los que ya están en la base no se
// tocan. Es a propósito. Una vez que la Comisión empiece a completar las fichas a
// mano desde el panel (DNI, domicilio, email, teléfono, fecha de nacimiento — todos
// campos que el Excel tiene vacíos), re-correr el script con sobrescritura les
// borraría ese trabajo sin decir nada. El script vive en el VPS y cualquiera lo
// puede ejecutar por error, así que el modo destructivo es opt-in explícito:
// --update-existing pisa los datos de los socios existentes con los del Excel.
// Con una excepción, que el reporte cuenta fila por fila: no se saltea ninguna
// invariante de `memberWriter`, así que las filas cuyo email choque con otra
// cuenta de acceso —o que dejarían sin email a un socio que ya tiene cuenta— NO
// se escriben (ver el bloque del loop).
//
// El padrón definitivo es el Excel (decisión del 21/08/2026): si una ficha
// dejó de figurar ahí, es que la Comisión la sacó del libro. --prune la borra
// de la base, pero SOLO si no tiene nada colgando que haya producido el
// sistema, y SOLO si los totales de control del archivo dan — un Excel truncado
// borraría socios buenos. Ese chequeo corre ANTES de la primera escritura: si
// esperara al bloque de poda, el archivo malo ya habría pisado todas las fichas
// presentes. Es destructivo, así que además pide --yes.
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
import { audit, auditStrict } from "../src/lib/audit";
import { mapPadronRow, type RawPadronRow } from "../src/lib/padron/mapping";
import { MemberEmailConflictError, MemberEmailRequiredError, memberWriter } from "../src/lib/members/write";

const FILE = join(process.cwd(), "datos", "padron_socios.xlsx");
const LOCK = join(process.cwd(), "datos", "~$padron_socios.xlsx");
const REPORT = join(process.cwd(), "padron-import-report.txt");

// La hoja se busca por nombre: si alguien agrega una hoja auxiliar adelante,
// importar "la primera" cargaría cualquier cosa.
const SHEET_NAME = "socios";

// Totales de control del Libro N° 1 tal como está el papel. Son constantes (y no
// literales sueltos) porque el reporte los imprime Y la validación los compara:
// tocar uno solo dejaría el reporte diciendo "esperado N" mientras valida otra cosa.
const EXPECTED_ROWS = 278;
const EXPECTED_ACTIVE = 160;
const EXPECTED_WITHDRAWN = EXPECTED_ROWS - EXPECTED_ACTIVE;
// Números de socio que el libro nunca usó (fichas anuladas o nunca asignadas).
// Se compara el CONJUNTO, no la cantidad: si se completara el 21 y desapareciera
// otro, el total seguiría dando 28 y el cambio pasaría inadvertido.
// Los seis últimos (118, 141, 158, 239, 287, 288) los sumó el padrón definitivo
// del 21/08/2026: son las fichas que la Comisión sacó del libro y que --prune
// borra de la base.
const EXPECTED_GAPS = [
  21, 71, 72, 73, 93, 94, 95, 97, 118, 125, 132, 141, 147, 158, 199, 208, 214,
  221, 222, 223, 224, 238, 239, 245, 254, 263, 287, 288,
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

// Del error sólo se conserva el código, nunca el objeto: los errores de Prisma
// traen la consulta, o sea datos del socio en claro, y la salida del script
// termina pegada en un chat o en un log (Ley 25.326, docs/08).
function codeOf(e: unknown): string {
  return typeof e === "object" && e !== null && "code" in e ? String(e.code) : "unknown";
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
const PRUNE_FLAG = "--prune";
const YES_FLAG = "--yes";
const KNOWN_FLAGS = [UPDATE_FLAG, PRUNE_FLAG, YES_FLAG];

// El detalle del movimiento de admisión que crea ESTE script. Es constante
// porque la poda lo usa para reconocer un socio "solo importado": un socio con
// cualquier otro movimiento tiene trabajo hecho a mano encima y no se borra.
const IMPORT_ADMISSION_DETAIL = "import Libro 1 (acta física no digitalizada)";

// Si el proceso muere en medio del loop, el reporte nunca se escribe: este contador
// vive afuera para que el handler de error pueda decir hasta dónde llegó.
const progress = {
  created: 0, updated: 0, unchanged: 0, conflicts: 0, missingEmail: 0, loginEmailMoved: 0,
  memberships: 0, movements: 0, pruned: 0,
};

async function main() {
  const args = process.argv.slice(2);
  const updateExisting = args.includes(UPDATE_FLAG);
  const prune = args.includes(PRUNE_FLAG);
  const unknownArgs = args.filter((a) => !KNOWN_FLAGS.includes(a));
  if (unknownArgs.length > 0) {
    throw new PadronDataError(
      `Argumento desconocido: ${unknownArgs.join(", ")}. Flags válidos: ${KNOWN_FLAGS.join(", ")}`,
    );
  }
  // Borrar socios no puede salir de un tab-completion desprolijo.
  if (prune && !args.includes(YES_FLAG)) {
    throw new PadronDataError(`${PRUNE_FLAG} borra socios de la base: confirmá con ${YES_FLAG}`);
  }
  if (args.includes(YES_FLAG) && !prune) {
    throw new PadronDataError(`${YES_FLAG} solo tiene sentido junto con ${PRUNE_FLAG}`);
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

  // Los totales de control salen del Excel y no de la base, así que se calculan
  // ACÁ, antes de escribir nada: la poda los necesita para decidir si el archivo
  // que tiene delante es el padrón entero o uno truncado. El reporte los imprime
  // más abajo, ya con los conteos leídos de la base.
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
  const controlTotalsOk = total === EXPECTED_ROWS && vigentes === EXPECTED_ACTIVE && gapsOk;

  // La poda necesita este chequeo, pero NO puede esperar a su bloque: para
  // cuando se llega ahí, el loop de abajo ya escribió el archivo entero. Con un
  // Excel truncado y --update-existing eso significa pisar cada ficha presente
  // con los nulos del archivo malo antes de abortar: no se borra a nadie, pero
  // el trabajo del panel ya se perdió. Como los totales salen del Excel y ya
  // están calculados, se corta acá, antes de la primera escritura.
  if (prune && !controlTotalsOk) {
    throw new PadronDataError(
      [
        `${PRUNE_FLAG} borra socios y los totales de control del Excel no dan: no se escribió ni se borró nada.`,
        `  filas ${total} (esperado ${EXPECTED_ROWS}) | vigentes ${vigentes} (esperado ${EXPECTED_ACTIVE})`,
        newGaps.length > 0 ? `  huecos NUEVOS (no esperados): ${newGaps.join(", ")}` : null,
        filledGaps.length > 0 ? `  huecos que se completaron: ${filledGaps.join(", ")}` : null,
        "  Si el padrón cambió de verdad, actualizá EXPECTED_ROWS / EXPECTED_ACTIVE / EXPECTED_GAPS y volvé a correr.",
      ].filter((l): l is string => l !== null).join("\n"),
    );
  }

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
      // nueva también a la cuenta. Las invariantes de la cuenta viven allá, del
      // lado del dueño del dato: el import las HEREDA, incluidos sus dos
      // rechazos, y por eso no puede producirlas en masa sin enterarse.
      try {
        const { accountEmailMove } = await memberWriter.updateMember(existing.memberId, m.member);
        progress.updated++;
        // El writer le llevó la dirección nueva a la CUENTA del socio, o sea que
        // le movió el nombre de usuario con el que ingresa. Desde el panel eso
        // dispara dos correos (aviso a la casilla vieja + verificación de la
        // nueva); desde acá no sale ninguno —es una corrida batch, sin operador
        // mirando, y con el padrón entero podría ser un mailing masivo—, así que
        // lo que no puede faltar es que la corrida lo diga.
        if (accountEmailMove) {
          warnings.push(
            `socio ${m.memberNumber}: el Excel le cambió el email y el socio ya tiene cuenta de acceso — ` +
              `ahora INGRESA con la dirección nueva y NO se le avisó por correo; ` +
              `avisale por otro medio o volvé a guardar la ficha desde el panel`,
          );
          progress.loginEmailMoved++;
        }
      } catch (err) {
        // Los dos rechazos de `memberWriter` son datos a corregir, no fallas del
        // import: se saltea la fila (no se escribió nada de ella) y se sigue,
        // porque abortar dejaría el resto del padrón sin actualizar por una sola
        // celda. Lo que NO se puede es saltearla en silencio: cada una queda en
        // `warnings`, con su contador propio en el reporte y en la auditoría, así
        // que la población afectada se lee de una corrida.
        if (err instanceof MemberEmailConflictError) {
          // El Excel le pone a este socio una dirección que ya es la de otra
          // cuenta de acceso.
          warnings.push(
            `socio ${m.memberNumber}: el email del Excel ya pertenece a otra cuenta de acceso — ` +
              `la fila NO se actualizó, corregí la dirección y volvé a correr el import`,
          );
          progress.conflicts++;
        } else if (err instanceof MemberEmailRequiredError) {
          // El caso masivo: el Excel del padrón viene casi sin datos personales,
          // así que una corrida con --update-existing le borra el email a todas
          // las fichas completadas desde el panel. En las que ya tienen cuenta de
          // acceso eso dejaría la cuenta apuntando a la casilla vieja —la amenaza
          // que cierra `syncAccountEmail`— multiplicada por cuantos socios haya.
          // El writer las rechaza una por una y acá se cuentan: el import no se
          // aborta entero (el resto del padrón sí se actualiza) pero ninguna de
          // estas filas pasa, y el reporte dice cuáles fueron.
          warnings.push(
            `socio ${m.memberNumber}: el Excel no trae email y el socio ya tiene cuenta de acceso — ` +
              `la fila NO se actualizó (dejarlo sin email le dejaría a la cuenta la dirección vieja); ` +
              `cargá la dirección en el Excel o editá la ficha desde el panel`,
          );
          progress.missingEmail++;
        } else throw err;
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
            newCategory: m.member.category, detail: IMPORT_ADMISSION_DETAIL,
          },
        });
      });
      progress.created++;
      progress.memberships++;
      progress.movements++;
    }
  }

  // ── Poda (--prune --yes): socios del libro que ya no están en el Excel ─────
  // Se borra FÍSICAMENTE, así que antes hay que estar seguro de dos cosas.
  //
  // Primero, que el Excel es el padrón entero: si viniera truncado, todos los
  // socios que faltan parecerían fichas dadas de baja. Por eso la poda exige
  // que los totales de control den; si el padrón cambió de verdad, se actualizan
  // las constantes de arriba (que es lo que hay que hacer igual) y recién ahí
  // se poda.
  //
  // Segundo, que el socio no tenga NADA colgando que haya producido el sistema.
  // El esquema no protege: `fees` es Cascade (se borrarían las cuotas sin
  // decir nada), `payments`, `applications` y `mpSubscriptions` son SetNull (un
  // pago cobrado quedaría sin socio, y con él su recibo). Y la cuenta de acceso
  // ni siquiera se entera: la FK vive en `Member.userId` (el `SetNull` es para
  // cuando se borra el USUARIO, no la ficha), así que borrar el socio deja la
  // fila de `User` intacta —con su contraseña y su rol `socio`— pero sin
  // ninguna ficha detrás: alguien sigue pudiendo ingresar al panel de socio de
  // un socio que ya no está en el libro. Si aparece cualquiera de esos casos se
  // aborta SIN borrar a nadie y se resuelve a mano.
  const pruned: number[] = [];
  const prunedCollateral = { notifications: 0, tokens: 0, movements: 0 };
  if (prune) {
    // (Los totales de control ya se verificaron arriba, antes de la primera
    // escritura: llegar hasta acá con --prune significa que el archivo es el
    // padrón entero.)
    const stale = await prisma.membership.findMany({
      where: { bookId: book.id, memberNumber: { notIn: [...numbers] } },
      include: {
        member: {
          include: {
            _count: {
              select: {
                applications: true, mpSubscriptions: true, payments: true, fees: true, memberships: true,
              },
            },
            movements: { select: { type: true, detail: true } },
            user: { select: { id: true } },
          },
        },
      },
    });

    const blocked = stale.flatMap((s) => {
      const c = s.member._count;
      const reasons: string[] = [];
      if (s.member.user) reasons.push("tiene cuenta de acceso");
      if (c.applications > 0) reasons.push(`${c.applications} solicitud(es)`);
      if (c.mpSubscriptions > 0) reasons.push(`${c.mpSubscriptions} suscripción(es) de Mercado Pago`);
      if (c.payments > 0) reasons.push(`${c.payments} pago(s)`);
      if (c.fees > 0) reasons.push(`${c.fees} cuota(s)`);
      // Membresía en otro libro: borrar al socio dejaría esa otra ficha rota (y
      // la FK, que es Restrict, haría fallar el borrado a mitad de camino).
      if (c.memberships > 1) reasons.push(`membresía en ${c.memberships - 1} libro(s) más`);
      // Cualquier movimiento que no sea la admisión que escribió este import es
      // trabajo hecho desde el panel (una baja asentada, un cambio de categoría).
      const handMade = s.member.movements.filter(
        (mv) => !(mv.type === "admission" && mv.detail === IMPORT_ADMISSION_DETAIL),
      );
      if (handMade.length > 0) reasons.push(`${handMade.length} movimiento(s) cargados a mano`);
      return reasons.length > 0 ? [`  socio ${s.memberNumber}: ${reasons.join(", ")}`] : [];
    });
    if (blocked.length > 0) {
      throw new PadronDataError(
        [
          "No se puede podar: estos socios ya no están en el Excel pero tienen datos del sistema.",
          "No se borró a nadie. Resolvelos a mano desde el panel (o volvelos a poner en el Excel):",
          ...blocked,
        ].join("\n"),
      );
    }

    for (const s of stale) {
      // Notificaciones, tokens y el asiento de admisión del import se van con el
      // socio: son derivados suyos y sin la ficha no significan nada. Se cuentan
      // en el reporte para que el borrado no sea silencioso.
      // Los contadores se suman DESPUÉS del commit y no adentro del callback:
      // si la transacción se reintentara, adentro contarían dos veces.
      const collateral = await prisma.$transaction(async (tx) => {
        const n = await tx.notification.deleteMany({ where: { memberId: s.memberId } });
        const t = await tx.actionToken.deleteMany({ where: { memberId: s.memberId } });
        const mv = await tx.movement.deleteMany({ where: { memberId: s.memberId } });
        await tx.membership.delete({ where: { id: s.id } });
        await tx.member.delete({ where: { id: s.memberId } });
        return { notifications: n.count, tokens: t.count, movements: mv.count };
      });
      prunedCollateral.notifications += collateral.notifications;
      prunedCollateral.tokens += collateral.tokens;
      prunedCollateral.movements += collateral.movements;
      pruned.push(s.memberNumber);
      progress.pruned++;
    }
    if (pruned.length > 0) {
      // El asiento lleva números de socio: no son dato personal (a diferencia
      // del DNI o del nombre) y son lo único que permite reconstruir qué se borró.
      //
      // Va por `auditStrict` y no por `audit()`: acá el asiento ES la señal. Un
      // borrado físico no deja rastro en ninguna otra pantalla, así que si
      // `audit()` se tragara el error el operador se quedaría sin saber qué
      // fichas desaparecieron. Lo que no se puede hacer con el fallo es
      // propagarlo —el borrado ya está commiteado y abortar acá dejaría la
      // corrida sin reporte ni asiento de import—, así que se degrada a un
      // aviso explícito en el reporte y a un `console.error`.
      try {
        await auditStrict({
          action: "padron_prune", entity: "book", entityId: book.id,
          detail: { memberNumbers: pruned, ...prunedCollateral },
        });
      } catch (e) {
        console.error(
          "[padron] CRÍTICO: se borraron socios y el asiento de auditoría NO se pudo escribir. code:",
          codeOf(e),
        );
        warnings.push(
          `se borraron ${pruned.length} socios (${pruned.join(", ")}) pero el asiento de auditoría NO se pudo ` +
            `escribir: anotá esos números a mano, son el único registro de qué salió del libro`,
        );
      }
    }
  }

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
      + (progress.conflicts > 0 ? ` | NO actualizados por email en conflicto: ${progress.conflicts}` : "")
      + (progress.missingEmail > 0 ? ` | NO actualizados por quedar sin email teniendo cuenta: ${progress.missingEmail}` : "")
      + (progress.loginEmailMoved > 0 ? ` | socios cuya direccion de INGRESO se mudo sin aviso por correo: ${progress.loginEmailMoved}` : ""),
    `memberships creadas: ${progress.memberships} | movements de admision creados: ${progress.movements}`,
    prune
      ? `podados (${pruned.length}): ${pruned.join(", ") || "ninguno"}`
        + (pruned.length > 0
          ? ` | con ellos se borraron ${prunedCollateral.movements} movimientos, `
            + `${prunedCollateral.notifications} notificaciones y ${prunedCollateral.tokens} enlaces`
          : "")
      : `poda: no se pidio (${PRUNE_FLAG} ${YES_FLAG} borra los socios del libro que ya no estan en el Excel)`,
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
  if (!controlTotalsOk) {
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
      missingEmail: progress.missingEmail, loginEmailMoved: progress.loginEmailMoved,
      memberships: progress.memberships, movements: progress.movements,
      updateExisting, prune, pruned: pruned.length, warnings: warnings.length,
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
        `sin cambios ${progress.unchanged}, salteados ${progress.conflicts + progress.missingEmail} ` +
        `(memberships ${progress.memberships}, movements ${progress.movements}), podados ${progress.pruned}`,
    );
    console.error("  El script es idempotente: corregí la causa y volvé a correrlo (los socios ya cargados se saltean).");
  })
  .finally(() => prisma.$disconnect());
