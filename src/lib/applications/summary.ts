// Resumen mensual de solicitudes para confeccionar el acta de la Comisión
// Directiva (pedido explícito del cliente: la CD tiene que llegar a la reunión
// con el listado de a quiénes va a asentar).
//
// El cliente de Prisma se INYECTA, no se importa: `@/lib/prisma` tira al
// evaluarse si falta DATABASE_URL, y este módulo lo importa un test puro sin
// base ni `.env`. Mismo criterio que `applications/query.ts`.
import type { MemberCategory, MovementType, PrismaClient } from "@/generated/prisma/client";
import { civilDateUtc } from "@/lib/dates";
import { CATEGORY_LABELS } from "@/lib/members/labels";

// ── El "mes" del resumen ─────────────────────────────────────────────────────
//
// Son TRES listas, y sólo una lleva mes. El motivo: una solicitud aceptada no
// tiene fecha de aceptación (no hay columna; `updatedAt` se mueve con cualquier
// escritura y sería una fecha mentirosa en el acta). Entonces:
//
//   · "Aceptadas pendientes de asiento" y "Pendientes de decisión de la CD" van
//     SIN filtro: son TODAS las vivas, o sea exactamente lo que la próxima
//     reunión tiene que tratar. Filtrarlas por mes escondería a la que entró en
//     julio y todavía espera acta — justo la que no hay que olvidar.
//   · "Asentadas en el mes" sí filtra, sobre `decidedAt`, que es la fecha real
//     del asiento. Sirve para reconstruir un acta ya pasada.
//
// Tres listas, cero ambigüedad.

/** Argentina es UTC-3 todo el año (sin DST): el corrimiento es una constante.
 *  Conviven DOS relojes para la misma zona: éste (una resta fija) y el que usa
 *  `Intl` con la zona IANA, en `monthLabelAR` (más abajo, en este archivo) y en
 *  `formatDateAR` (`src/lib/format.ts`, el que pinta las fechas de la pantalla
 *  en `page.tsx`). Hoy coinciden porque Argentina no tiene horario de verano;
 *  si volviera, divergirían — moveé los dos call sites juntos. */
const AR_OFFSET_MS = 3 * 60 * 60 * 1000;

const TZ = "America/Argentina/Buenos_Aires";

export type MonthSelection = { year: number; month: number };

const MIN_YEAR = 1900;
const MAX_YEAR = 2199;

type Param = string | string[] | undefined;
const one = (v: Param) => (Array.isArray(v) ? v[0] : v);

/** El mes civil argentino de un instante. A las 22:30 del 31/08 en Comodoro ya
 *  son las 01:30 UTC del 1/9: leer los campos UTC pelados haría que el operador
 *  que abre el resumen esa noche viera "septiembre" y un acta vacía. */
function currentMonthAR(now: Date): MonthSelection {
  const shifted = new Date(now.getTime() - AR_OFFSET_MS);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1 };
}

/** Formato `YYYY-MM`, el que emite `<input type="month">`. Cualquier otra cosa
 *  —vacío, un mes 13, una fecha completa, un año imposible— cae al mes
 *  corriente: el parámetro llega por la URL y se tipea a mano. */
export function parseMonthParam(value: Param, now: Date): MonthSelection {
  const raw = one(value)?.trim();
  const m = raw ? /^(\d{4})-(\d{2})$/.exec(raw) : null;
  if (!m) return currentMonthAR(now);
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12 || year < MIN_YEAR || year > MAX_YEAR) return currentMonthAR(now);
  return { year, month };
}

/** La inversa: el valor que vuelve al `<input type="month">` y al link de
 *  exportación, para que la pantalla no pierda el mes elegido. */
export function formatMonthParam({ year, month }: MonthSelection): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

export type MonthRange = { from: Date; to: Date };

/** El mes civil ARGENTINO expresado como un par de instantes UTC — no un mes
 *  UTC: 00:00 del 1° en Comodoro son las 03:00 UTC. Con bordes en 00:00 UTC,
 *  una solicitud asentada el 31/08 a las 22:00 (01:00Z del 1/9) caería en el
 *  acta de septiembre — o sea, en la reunión equivocada. `to` es exclusivo. */
export function arMonthRangeUtc(year: number, month: number): MonthRange {
  return {
    from: new Date(Date.UTC(year, month - 1, 1, 3)),
    to: new Date(Date.UTC(year, month, 1, 3)),
  };
}

/** "agosto de 2026", para el encabezado de la sección y el nombre del archivo. */
export function monthLabelAR(sel: MonthSelection): string {
  return new Intl.DateTimeFormat("es-AR", { timeZone: TZ, month: "long", year: "numeric" })
    .format(arMonthRangeUtc(sel.year, sel.month).from);
}

// ── Las filas ────────────────────────────────────────────────────────────────

export type SummaryRow = {
  id: number;
  fullName: string;
  dni: string;
  requestedCategory: MemberCategory;
  wantsDebit: boolean;
  /** `true` reingreso, `false` alta nueva, `null` "no se sabe" — ver abajo. */
  reentry: boolean | null;
  createdAt: Date;
  decidedAt: Date | null;
};

export type ApplicationSummary = {
  accepted: SummaryRow[];
  pendingBoard: SummaryRow[];
  recordedInMonth: SummaryRow[];
};

// `select` explícito y no `include`: la fila de Application trae el hash del
// token de retome, la IP y el user-agent del vecino. Nada de eso tiene por qué
// viajar a una pantalla que se imprime y se lleva a una reunión.
const SUMMARY_SELECT = {
  id: true, fullName: true, dni: true, requestedCategory: true, wantsDebit: true,
  memberId: true, minuteId: true, createdAt: true, decidedAt: true,
} as const;

type RawRow = {
  id: number; fullName: string; dni: string; requestedCategory: MemberCategory;
  wantsDebit: boolean; memberId: number | null; minuteId: number | null;
  createdAt: Date; decidedAt: Date | null;
};

const pairKey = (memberId: number, minuteId: number) => `${memberId}:${minuteId}`;

export function makeSummaryQueries(db: Pick<PrismaClient, "application" | "movement">) {
  return {
    async fetchSummary(range: MonthRange): Promise<ApplicationSummary> {
      const [accepted, pendingBoard, recorded] = await Promise.all([
        db.application.findMany({
          where: { status: "approved_pending_minute" },
          // Ascendente y no descendente como la bandeja: el acta se lee de la
          // más vieja a la más nueva, que es el orden en que se asientan.
          orderBy: { createdAt: "asc" },
          select: SUMMARY_SELECT,
        }),
        db.application.findMany({
          where: { status: "pending_board" },
          orderBy: { createdAt: "asc" },
          select: SUMMARY_SELECT,
        }),
        db.application.findMany({
          where: { status: "completed", decidedAt: { gte: range.from, lt: range.to } },
          orderBy: { decidedAt: "asc" },
          select: SUMMARY_SELECT,
        }),
      ]) as [RawRow[], RawRow[], RawRow[]];

      // ── Alta o reingreso, DESPUÉS del asiento ─────────────────────────────
      // `memberId` no es el discriminador (el porqué largo está en
      // `showsReentryBadge`, en query.ts): el asiento se lo escribe a TODA
      // solicitud que completa, así que un alta común es indistinguible de un
      // reingreso por ese campo. La señal verdadera es el `Movement` que ese
      // asiento creó, identificado por el par (socio, acta).
      //
      // El detalle de una solicitud paga una consulta por fila; este resumen no
      // puede — el acta de un mes de campaña trae decenas. Una sola consulta
      // para todo el lote: `memberId IN (...) AND minuteId IN (...)`, que es un
      // SUPERCONJUNTO (el producto cartesiano socios × actas). Los sobrantes se
      // descartan al indexar por el PAR exacto, no por cada campo suelto.
      const pairs = recorded.filter(
        (r): r is RawRow & { memberId: number; minuteId: number } =>
          r.memberId !== null && r.minuteId !== null,
      );
      const byPair = new Map<string, MovementType>();
      if (pairs.length > 0) {
        const movements = await db.movement.findMany({
          where: {
            memberId: { in: [...new Set(pairs.map((p) => p.memberId))] },
            minuteId: { in: [...new Set(pairs.map((p) => p.minuteId))] },
            type: { in: ["admission", "readmission"] },
          },
          // Ascendente + sobrescritura: si un par tuviera dos movimientos, gana
          // el último, igual que el `orderBy: { id: "desc" }` + findFirst del
          // detalle.
          orderBy: { id: "asc" },
          select: { memberId: true, minuteId: true, type: true },
        });
        for (const mv of movements) {
          if (mv.minuteId === null) continue;
          byPair.set(pairKey(mv.memberId, mv.minuteId), mv.type);
        }
      }

      // Viva, `memberId` sí significa "matcheó una ficha existente" y el
      // reingreso está por venir (REG-25): es justo lo que la CD necesita ver
      // para redactar el acta.
      const live = (r: RawRow): SummaryRow => ({ ...toRow(r), reentry: r.memberId !== null });

      return {
        accepted: accepted.map(live),
        pendingBoard: pendingBoard.map(live),
        recordedInMonth: recorded.map((r) => {
          // Sin movimiento que lo respalde (un asiento anterior a este
          // circuito, un dato migrado) queda `null`: la pantalla NO sabe si fue
          // alta o reingreso, y decir "Alta" ahí sería afirmarlo sin con qué.
          const mv = r.memberId !== null && r.minuteId !== null
            ? byPair.get(pairKey(r.memberId, r.minuteId))
            : undefined;
          return { ...toRow(r), reentry: mv === undefined ? null : mv === "readmission" };
        }),
      };
    },
  };
}

function toRow(r: RawRow): Omit<SummaryRow, "reentry"> {
  return {
    id: r.id, fullName: r.fullName, dni: r.dni, requestedCategory: r.requestedCategory,
    wantsDebit: r.wantsDebit, createdAt: r.createdAt, decidedAt: r.decidedAt,
  };
}

// ── La exportación ───────────────────────────────────────────────────────────
//
// Construcción pura: nada de acá toca la base ni ExcelJS. La route arma el
// Workbook con `SUMMARY_EXPORT_COLUMNS` y llena filas con `buildSummaryExportRow`.

// La columna de fecha no se llama "fecha" a secas: la pantalla alterna el
// encabezado entre "Solicitud" y "Asentada" según la lista (ver `Section` en
// `page.tsx`), porque el significado de la fecha cambia — en las dos listas
// vivas es cuándo se pidió, en las asentadas es cuándo se asentó. Un `fecha`
// genérico en las tres hojas escondería esa diferencia en el Excel. La route
// pasa el mismo criterio que usa la pantalla.
export function summaryExportColumns(dateHeader: string) {
  return [
    { header: "apellido_nombre", key: "name", width: 32 },
    // numFmt "@" (texto): el DNI es una cadena de dígitos, no una cantidad. Sin
    // esto Excel lo marca con el triángulo verde "número guardado como texto".
    { header: "dni", key: "dni", width: 12, style: { numFmt: "@" } },
    { header: "categoria", key: "cat", width: 14 },
    { header: "debito_automatico", key: "debit", width: 16 },
    { header: "reingreso", key: "reentry", width: 12 },
    // Fecha nativa y no texto DD/MM/AAAA: un texto ordena mal en Excel
    // (compara el día antes que el año) y el acta se arma ordenando. Ver
    // members/export.ts.
    { header: dateHeader, key: "date", width: 14, style: { numFmt: "dd/mm/yyyy" } },
  ] as const;
}

export type SummaryExportRow = {
  name: string; dni: string; cat: string; debit: string; reentry: string; date: Date;
};

/** El día civil ARGENTINO de un instante, anclado a mediodía UTC.
 *
 *  `createdAt`/`decidedAt` son timestamps reales, no fechas civiles: una
 *  solicitud cargada a las 22:00 del 3/8 en Comodoro se guarda como
 *  2026-08-04T01:00Z. ExcelJS convierte al serial con el epoch absoluto (ver
 *  exceljs/lib/utils/utils.js:dateToExcel), así que sin anclar, la pantalla
 *  diría 03/08 y el Excel 04/08 — sobre la misma fila del acta. Mediodía cae
 *  siempre dentro del mismo día calendario, así que ahí ya no se corre nada. */
export function arCivilDay(d: Date): Date {
  const shifted = new Date(d.getTime() - AR_OFFSET_MS);
  return civilDateUtc(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

/** El "—" del reingreso no es cosmética: es la diferencia entre "sabemos que
 *  fue un alta" y "no lo sabemos". Ver el comentario de `reentry` arriba. */
export function reentryLabel(reentry: boolean | null): string {
  return reentry === null ? "—" : reentry ? "Sí" : "No";
}

export function buildSummaryExportRow(
  row: Pick<SummaryRow, "fullName" | "dni" | "requestedCategory" | "wantsDebit" | "reentry" | "createdAt" | "decidedAt">,
): SummaryExportRow {
  return {
    name: row.fullName,
    dni: row.dni,
    cat: CATEGORY_LABELS[row.requestedCategory],
    debit: row.wantsDebit ? "Sí" : "No",
    reentry: reentryLabel(row.reentry),
    // Las vivas no tienen `decidedAt` (sólo lo escriben el asiento y el
    // rechazo), así que ahí la fecha del resumen es la de la solicitud.
    date: arCivilDay(row.decidedAt ?? row.createdAt),
  };
}
