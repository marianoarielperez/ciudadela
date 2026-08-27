// Reconcilia el MOTIVO DE BAJA de la base con datos/padron_socios.xlsx.
// Correr: npx tsx scripts/fix-withdrawal-reasons.ts [--apply]
//
// ── Por qué existe ────────────────────────────────────────────────────────────
//
// El Excel es el padrón (decisión del 21/08/2026): la fuente de verdad del Libro
// N° 1. La Comisión corrigió ahí seis motivos de baja —cinco fallecimientos y,
// sobre todo, la expulsión del socio N° 38, que hasta entonces figuraba como
// mora— y la base quedó atrás.
//
// No es un detalle de presentación. El motivo de baja es la entrada de dos
// decisiones estatutarias:
//   · REG-04 (Art. 5 inc. 2): el expulsado NO puede reingresar jamás. La puerta
//     del alta web (`src/lib/applications/eligibility.ts:64`) lo bloquea por
//     `reentryBlocked || withdrawalReason === "expulsion"`. Con el motivo en
//     "arrears" no lo bloquea NADIE: el expulsado se asocia por la web.
//   · El fallecimiento y la anulación por duplicado desvían a la sede
//     (`eligibility.ts:71`) y, en `/admin/socios/historico`, evitan que el
//     mostrador le reclame deuda al familiar de un socio fallecido.
//
// ── Por qué NO se usa `import-padron.ts --update-existing` ────────────────────
//
// Porque pisa la ficha ENTERA con lo que diga el Excel, y el Excel del padrón
// viene casi sin datos personales: DNI, domicilio, email, teléfono y fecha de
// nacimiento son justamente los campos que la Comisión completa a mano desde el
// panel. Una corrida con ese flag para arreglar dos motivos de baja borraría
// todo ese trabajo sin decir nada (lo advierte la cabecera del propio import).
//
// Este script es lo contrario: toca DOS columnas —`withdrawal_reason` y
// `reentry_blocked`— y sólo de socios que en la base YA están dados de baja.
//
// ── Reglas que se impuso ──────────────────────────────────────────────────────
//
//  1. **No cambia el estado societario de nadie.** Si el Excel da de baja a un
//     socio que en la base está vigente (o al revés), no lo corrige: lo reporta
//     como discrepancia. Eso se resuelve con un acta y desde el panel, nunca por
//     script.
//  2. **Nunca APAGA un bloqueo de reingreso**, y eso vale para las DOS señales
//     que mira la puerta, no sólo para el flag. El flag lo prende cuando el
//     motivo es expulsión y lo deja como está en cualquier otro caso: puede
//     haberlo puesto un acta que el Excel todavía no refleja. Y una ficha cuyo
//     motivo YA es expulsión no se degrada nunca: se reporta como discrepancia,
//     porque hay fichas viejas con el motivo puesto y el flag en `false` y ahí
//     el motivo es lo único que cierra la puerta que REG-04 cierra para siempre.
//  3. **No escribe un motivo que no entiende.** Una celda que el mapeo manda a
//     `other`, o vacía, no pisa el motivo que ya tiene la ficha: se reporta.
//  4. **Seco por defecto.** Sin `--apply` imprime la tabla de lo que haría y no
//     escribe una sola fila. Es idempotente: la segunda corrida no cambia nada.
//  5. **El asiento de auditoría ES la señal.** Corregir un motivo estatutario no
//     deja rastro en ninguna otra pantalla, así que va por `auditStrict` y
//     DENTRO de la misma transacción que el update: si el asiento no se puede
//     escribir, la corrección se deshace y el socio queda listado como no
//     corregido. (Es más estricto que el `padron_prune` de `import-padron.ts`,
//     que sólo puede degradar a un aviso porque su borrado ya está commiteado y
//     no se puede revertir.)
//
// `tsx` no carga `.env` por su cuenta: sin esto el singleton de Prisma no ve
// DATABASE_URL. Tiene que ser el primer import del archivo.
import "dotenv/config";

import { existsSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "exceljs";
import type { WithdrawalReason } from "../src/generated/prisma/client";
import { makeAuditStrict } from "../src/lib/audit";
import { REASON_LABELS } from "../src/lib/members/labels";
import { isWithdrawnRow } from "../src/lib/padron/mapping";
import { prisma } from "../src/lib/prisma";
// El veredicto por fila es una función pura y vive en `src/`: las reglas que
// decide son estatutarias y se prueban sin base ni Excel (tests/padron-withdrawal-fix).
import { decideWithdrawalFix } from "../src/lib/padron/withdrawal-fix";

const FILE = join(process.cwd(), "datos", "padron_socios.xlsx");
const LOCK = join(process.cwd(), "datos", "~$padron_socios.xlsx");
const SHEET_NAME = "socios";
const BOOK_NUMBER = 1;

const APPLY_FLAG = "--apply";

// Mismo criterio que `import-padron.ts`: un error de datos se arregla editando el
// Excel (o el comando), uno de infraestructura levantando la base. Para el
// operador se ven igual si no los distinguimos.
class DataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataError";
  }
}

// Del error sólo se conserva el código, nunca el objeto: los errores de Prisma
// traen la consulta, o sea datos del socio en claro, y la salida del script
// termina pegada en un chat o en un log (Ley 25.326, docs/08).
function codeOf(e: unknown): string {
  return typeof e === "object" && e !== null && "code" in e ? String(e.code) : "unknown";
}

// Este script lee TRES columnas de texto (número, activo, motivo) más el DNI para
// el cruce de identidad, así que no necesita el normalizador completo del import
// — pero tampoco puede caer a `String(v)`, que compararía motivos contra
// "[object Object]". Contempla las formas que produce Excel y aborta ante otra.
function cellText(v: ExcelJS.CellValue, ref: string): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "si" : "no";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    if ("error" in v) throw new DataError(`celda ${ref}: error de Excel ${String(v.error)}`);
    if ("richText" in v) return v.richText.map((r) => r.text).join("");
    if ("formula" in v || "sharedFormula" in v) {
      const result = (v as ExcelJS.CellFormulaValue).result;
      if (result === undefined) {
        throw new DataError(`celda ${ref}: fórmula sin resultado cacheado — recalculá y guardá el archivo`);
      }
      return cellText(result as ExcelJS.CellValue, ref);
    }
    if ("text" in v) return cellText(v.text as ExcelJS.CellValue, ref);
  }
  throw new DataError(`celda ${ref}: tipo de valor de Excel no soportado (${JSON.stringify(v)})`);
}

const trimmed = (s: string | null) => {
  const t = (s ?? "").trim();
  return t === "" || t === "-" ? null : t;
};
// El DNI se compara sólo por sus dígitos: el Excel lo trae como número y la ficha
// como texto, y a mano aparece con puntos ("30.280.971").
const digits = (s: string | null) => (s ?? "").replace(/\D/g, "") || null;

type Row = {
  rowNumber: number;
  memberNumber: number;
  withdrawn: boolean;
  motivo: string | null;
  dni: string | null;
};

type Plan = {
  memberNumber: number;
  memberId: number;
  fullName: string;
  from: WithdrawalReason | null;
  to: WithdrawalReason;
  blockFrom: boolean;
  blockTo: boolean;
};

const label = (r: WithdrawalReason | null) => (r === null ? "sin motivo" : REASON_LABELS[r]);

async function readRows(): Promise<Row[]> {
  if (existsSync(LOCK)) {
    throw new DataError("padron_socios.xlsx está abierto en Excel (lock ~$). Cerralo y reintentá.");
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(FILE);
  const ws = wb.getWorksheet(SHEET_NAME);
  if (!ws) throw new DataError(`padron_socios.xlsx no tiene una hoja "${SHEET_NAME}"`);

  // Por NOMBRE de encabezado y nunca por posición: el archivo ya cambió de forma
  // una vez (se insertó una columna en el medio).
  const col = new Map<string, number>();
  ws.getRow(1).eachCell({ includeEmpty: false }, (cell, n) => {
    const name = (cellText(cell.value, cell.address) ?? "").trim();
    if (name !== "" && !col.has(name)) col.set(name, n);
  });
  const needed = ["numero_socio", "activo", "motivo_baja", "dni"];
  const missing = needed.filter((h) => !col.has(h));
  if (missing.length > 0) {
    throw new DataError(`padron_socios.xlsx no tiene la(s) columna(s): ${missing.join(", ")}`);
  }

  const rows: Row[] = [];
  const seen = new Map<number, number>();
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const get = (name: string) => {
      const cell = row.getCell(col.get(name)!);
      return cellText(cell.value, cell.address);
    };
    const rawNumero = trimmed(get("numero_socio"));
    if (rawNumero === null) return; // fila vacía
    if (!/^\d+$/.test(rawNumero)) {
      throw new DataError(`fila ${rowNumber}: numero_socio inválido (${JSON.stringify(rawNumero)})`);
    }
    const memberNumber = Number(rawNumero);
    // Dos filas peleando por la misma ficha del libro: no hay forma de saber cuál
    // trae el motivo bueno.
    const previous = seen.get(memberNumber);
    if (previous !== undefined) {
      throw new DataError(`socio ${memberNumber}: aparece en las filas ${previous} y ${rowNumber}`);
    }
    seen.set(memberNumber, rowNumber);
    // El estado se decide con el mismo lector que el import (`isWithdrawnRow`) y
    // no con un `!== "no"`: una celda rara —"0", "false", un typo— pasaba por
    // VIGENTE y la fila salía reportada como "el Excel lo da por VIGENTE", que
    // manda al operador a buscar un acta por un error de tipeo. El error del
    // lector se re-envuelve en `DataError` para que el pie del script diga que el
    // problema está en el Excel y no en la base.
    let withdrawn: boolean;
    try {
      withdrawn = isWithdrawnRow(get("activo"), `fila ${rowNumber}`);
    } catch (e) {
      throw new DataError(e instanceof Error ? e.message : String(e));
    }
    rows.push({
      rowNumber,
      memberNumber,
      withdrawn,
      motivo: trimmed(get("motivo_baja")),
      dni: digits(get("dni")),
    });
  });
  if (rows.length === 0) throw new DataError(`la hoja "${SHEET_NAME}" no tiene filas de datos`);
  return rows;
}

async function main() {
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => a !== APPLY_FLAG);
  if (unknown.length > 0) {
    throw new DataError(`Argumento desconocido: ${unknown.join(", ")}. Flag válido: ${APPLY_FLAG}`);
  }
  const apply = args.includes(APPLY_FLAG);

  const rows = await readRows();

  const book = await prisma.book.findUnique({ where: { number: BOOK_NUMBER } });
  if (!book) {
    throw new DataError(`no existe el Libro N° ${BOOK_NUMBER} en la base: corré primero el import del padrón`);
  }

  const memberships = await prisma.membership.findMany({
    where: { bookId: book.id },
    select: {
      memberNumber: true,
      member: {
        select: {
          id: true, fullName: true, dni: true, status: true,
          withdrawalReason: true, reentryBlocked: true,
        },
      },
    },
  });
  const byNumber = new Map(memberships.map((m) => [m.memberNumber, m.member]));

  const plans: Plan[] = [];
  const discrepancies: string[] = [];
  let unchanged = 0;

  for (const row of rows) {
    const member = byNumber.get(row.memberNumber);
    const decision = decideWithdrawalFix(row, member);
    switch (decision.kind) {
      case "skip":
        break;
      case "unchanged":
        unchanged++;
        break;
      case "discrepancy":
        discrepancies.push(decision.message);
        break;
      case "plan": {
        // Sin ficha no hay plan posible: `decideWithdrawalFix` sólo devuelve
        // "plan" cuando recibió una. La guarda es para el compilador.
        if (!member) throw new Error(`socio ${row.memberNumber}: plan sin ficha`);
        plans.push({
          memberNumber: row.memberNumber,
          memberId: member.id,
          fullName: member.fullName,
          from: member.withdrawalReason,
          to: decision.to,
          blockFrom: member.reentryBlocked,
          blockTo: decision.blockTo,
        });
        break;
      }
    }
  }

  console.log(`\nfix-withdrawal-reasons — ${new Date().toISOString()}`);
  console.log(
    `modo: ${apply ? `${APPLY_FLAG} (ESCRIBE en la base)` : `seco (por defecto; para escribir: ${APPLY_FLAG})`}`,
  );
  console.log(
    `filas del Excel: ${rows.length} | bajas: ${rows.filter((r) => r.withdrawn).length} ` +
      `| ya coinciden: ${unchanged} | a corregir: ${plans.length} | discrepancias: ${discrepancies.length}`,
  );

  if (plans.length === 0) {
    console.log("\nNo hay ningún motivo de baja que corregir.");
  } else {
    console.log("\n  N°   socio                             motivo actual         →  motivo del padrón");
    console.log("  ───────────────────────────────────────────────────────────────────────────────────");
    for (const p of plans) {
      const bloqueo = p.blockTo !== p.blockFrom ? "  + bloqueo de reingreso (REG-04)" : "";
      console.log(
        `  ${String(p.memberNumber).padStart(3)}  ${p.fullName.padEnd(33).slice(0, 33)} ` +
          `${label(p.from).padEnd(21)} →  ${label(p.to)}${bloqueo}`,
      );
    }
  }

  if (discrepancies.length > 0) {
    console.log(`\nDISCREPANCIAS que este script NO corrige (${discrepancies.length}):`);
    for (const d of discrepancies) console.log(`  - ${d}`);
  }

  if (!apply) {
    console.log(`\n(seco: no se escribió nada. Volvé a correr con ${APPLY_FLAG} para aplicar.)`);
    return;
  }

  let applied = 0;
  const failed: number[] = [];
  for (const p of plans) {
    try {
      // Update + asiento en la MISMA transacción (regla 5): si el asiento no se
      // puede escribir, la corrección se deshace y el socio sale listado abajo.
      await prisma.$transaction(async (tx) => {
        await tx.member.update({
          where: { id: p.memberId },
          data: { withdrawalReason: p.to, reentryBlocked: p.blockTo },
        });
        // El detalle NO lleva nombre ni DNI: con el id y el número de socio se
        // reconstruye qué cambió sin volcar datos personales al log (Ley 25.326).
        await makeAuditStrict(tx)({
          action: "member_withdrawal_reason_fix",
          entity: "member",
          entityId: p.memberId,
          detail: {
            memberNumber: p.memberNumber,
            from: p.from,
            to: p.to,
            reentryBlockedFrom: p.blockFrom,
            reentryBlockedTo: p.blockTo,
            source: "datos/padron_socios.xlsx",
          },
        });
      });
      applied++;
    } catch (e) {
      failed.push(p.memberNumber);
      console.error(`  socio ${p.memberNumber}: NO se corrigió (nada quedó escrito). code: ${codeOf(e)}`);
    }
  }
  console.log(`\ncorregidos: ${applied} de ${plans.length}`);
  if (failed.length > 0) {
    process.exitCode = 1;
    console.error(`ATENCION: quedaron sin corregir los socios ${failed.join(", ")} — volvé a correr el script`);
  }
}

main()
  .catch((err: unknown) => {
    process.exitCode = 1;
    const isDataError = err instanceof DataError;
    const message = err instanceof Error ? err.message : String(err);
    console.error("");
    console.error(
      isDataError
        ? "ABORTADO — ERROR DE DATOS O DE USO: revisá datos/padron_socios.xlsx (o los argumentos); la base no es el problema"
        : "ABORTADO — ERROR DE INFRAESTRUCTURA: el Excel no es el problema (base, red o entorno)",
    );
    for (const line of message.split("\n")) console.error(`  ${line}`);
    if (!isDataError) console.error(`  code: ${codeOf(err)}`);
  })
  .finally(() => prisma.$disconnect());
