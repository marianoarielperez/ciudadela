// Ingresos NO societarios (4B, tarea 8B): alquiler del salón, eventos, rifas,
// donaciones. Plata que entró y es de la asociación pero no es de ningún socio.
//
// Es un REGISTRO, no contabilidad (docs/01): no hay plan de cuentas, ni asientos,
// ni egresos, y NO emite recibo. Por eso este módulo es INDEPENDIENTE del
// servicio de tesorería: no lo importa, no comparte su transacción y no toca
// `payments`, `fees`, `receipts` ni `receipt_sequences`. Lo único que comparte
// con el núcleo es la regla de que una fila de la bandeja nunca queda apuntando
// a un registro anulado — de ahí el `mpUnmatchedPayment` de la anulación.
//
// Prisma se INYECTA: el módulo se prueba sin `.env`, sin fixtures y sin base.
// El singleton del final es para rutas y actions.
import type { IncomeMethod, Prisma, PrismaClient } from "@/generated/prisma/client";
import { paginate } from "@/lib/admin/pagination";
import { prisma } from "@/lib/prisma";
import { periodMonth, periodOf, periodYear } from "./periods";

/** El techo de `Decimal(10,2)`. Un peso más y MariaDB trunca en silencio. */
export const MAX_INCOME_AMOUNT = 99_999_999.99;

export const INCOME_PAGE_SIZE = 50;

/** Regla de negocio ya redactada en es-AR: la action la muestra tal cual. */
export class OtherIncomeError extends Error {}

export type RecordIncomeInput = {
  amount: number;
  /** La fecha REAL del ingreso: la del cobro de MP, o la que cargó el operador. */
  receivedAt: Date;
  concept: string;
  method: IncomeMethod;
  /** Sólo cuando viene de la bandeja sin conciliar. */
  mpPaymentId?: string | null;
  note?: string | null;
  actorId: number;
};

export type RecordIncomeResult =
  | { kind: "recorded"; id: number }
  /** El cobro de Mercado Pago ya estaba registrado: mismo hecho, no un error. */
  | { kind: "already_recorded"; id: number };

export type IncomeFilters = {
  /** El EJERCICIO: del 1/1 al 31/12 en hora argentina. Es la unidad de la
   *  asociación y la única forma de acotar por fecha que ofrece la pantalla. */
  year?: number;
  /** Un mes del ejercicio, 1 a 12. Sin `year` no acota nada: un mes suelto no
   *  es una unidad de nada. */
  month?: number;
  method?: IncomeMethod;
  /** Un solo ingreso, para el enlace que llega desde la bandeja sin conciliar.
   *  Es un id: lo único que puede viajar en la URL sin arrastrar texto del
   *  operador a los logs de Nginx y de Cloudflare (Ley 25.326, docs/08). */
  id?: number;
};

export type OtherIncomeRow = {
  id: number;
  amount: number;
  receivedAt: Date;
  concept: string;
  method: IncomeMethod;
  mpPaymentId: string | null;
  note: string | null;
  registeredBy: string | null;
  voidedAt: Date | null;
  voidReason: string | null;
  voidedBy: string | null;
};

export type ListIncomeResult = {
  rows: OtherIncomeRow[];
  /** Filas del filtro, anuladas incluidas: se listan aunque no sumen. */
  total: number;
  /** Ingresos que SÍ suman. Va aparte de `total` porque "$ X en N ingresos"
   *  con un anulado adentro sería una frase falsa. */
  counted: number;
  /** Suma del período filtrado SIN los anulados. */
  sum: number;
  byMethod: { cash: number; mp: number };
};

export type EditIncomeResult =
  | { kind: "edited" }
  | { kind: "not_found" }
  /** Un ingreso anulado es un asiento cerrado: no se reescribe. */
  | { kind: "voided" };

export type VoidIncomeResult =
  /** `reopened`: el ingreso venía de la bandeja y su fila volvió a Pendientes. */
  | { kind: "voided"; reopened: boolean }
  | { kind: "not_found" }
  | { kind: "already_voided" };

type IncomeTx = Pick<PrismaClient, "otherIncome" | "mpUnmatchedPayment">;
type IncomeDb = IncomeTx & Pick<PrismaClient, "$transaction">;

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2002";
}

// Pesos con dos decimales: sumar dos `Number(Decimal)` sin redondear devuelve
// 0.30000000000000004 y esa cifra termina en pantalla.
function toCents(n: number): number {
  return Math.round(n * 100) / 100;
}

// Argentina es UTC-3 sin DST (docs/03): el día civil D empieza a las D 03:00
// UTC. De ahí salen los dos bordes de abajo.
const AR_OFFSET_HOURS = 3;

/**
 * Los bordes del ejercicio (o de uno de sus meses) como instantes UTC, medio
 * abierto: `[gte, lt)`.
 *
 * El corte es en hora ARGENTINA y no en UTC. Un alquiler cobrado a las 22:00
 * del 31 de diciembre se guarda como la 01:00 UTC del 1 de enero: con el corte
 * en UTC esa plata caía en el ejercicio siguiente, y los dos ejercicios que la
 * Comisión presenta quedaban mal por el mismo importe.
 *
 * `Date.UTC` normaliza el mes 13, así que diciembre cierra solo contra el 1/1
 * del año que viene.
 */
export function exerciseBounds(year: number, month?: number): { gte: Date; lt: Date } {
  const at = (y: number, m: number) => new Date(Date.UTC(y, m - 1, 1, AR_OFFSET_HOURS));
  if (month) return { gte: at(year, month), lt: at(year, month + 1) };
  return { gte: at(year, 1), lt: at(year + 1, 1) };
}

/**
 * El `where` de la lista. Exportado para probarlo sin base.
 *
 * NO hay filtro por texto del concepto a propósito: los filtros viajan por GET
 * y un `?q=Ramírez` queda escrito en el access log de Nginx y de Cloudflare, que
 * no están alcanzados por el circuito de retención que sí cubre `audit_logs`.
 * El concepto y la nota son texto libre del operador y pueden nombrar a un
 * tercero (Ley 25.326, docs/08): se leen en pantalla y no salen de ahí.
 */
export function incomeWhere(f: IncomeFilters): Prisma.OtherIncomeWhereInput {
  // El id manda sobre todo lo demás: es el enlace que llega desde la bandeja
  // sin conciliar y tiene que abrir ESE ingreso, sea del ejercicio que sea.
  if (f.id) return { id: f.id };
  const where: Prisma.OtherIncomeWhereInput = {};
  if (f.year) where.receivedAt = exerciseBounds(f.year, f.month);
  if (f.method) where.method = f.method;
  return where;
}

/** Una celda de la cinta de doce meses. Sin monto no hay celda: los meses en
 *  cero también son parte de la forma del ejercicio. */
export type ExerciseMonth = { month: number; amount: number; count: number };

export type ExerciseSummary = {
  year: number;
  /** Lo que entró en el ejercicio, sin los anulados. */
  total: number;
  /** Ingresos que suman. */
  counted: number;
  /** Anulados del ejercicio: se listan tachados, no suman en ninguna cifra. */
  voided: number;
  byMethod: { cash: number; mp: number };
  /** Siempre doce, de enero a diciembre. */
  months: ExerciseMonth[];
  /** El mes más alto: es la escala de la cinta y nada más. */
  max: number;
};

export type ExerciseRow = {
  receivedAt: Date;
  amount: number;
  method: IncomeMethod;
  voided: boolean;
};

/**
 * El ejercicio entero resumido: total, desglose por medio y las doce celdas de
 * la cinta. Puro y sobre TODAS las filas del año — nunca sobre la página, o el
 * total diría una cosa distinta según dónde esté parado el operador.
 *
 * El mes de cada ingreso lo decide `periodOf`, que es la única función del
 * proyecto que traduce instante a período civil argentino. Acá eso no es un
 * detalle: es lo que pone un alquiler de las 22:00 del 31 de diciembre en
 * diciembre y no en enero del ejercicio siguiente.
 *
 * Los anulados quedan afuera de las tres cifras y se cuentan aparte: el que
 * anuló tiene que ver que anuló, y el total tiene que decir la verdad.
 *
 * Agregar en memoria y no en SQL es deliberado: son decenas de filas por año, y
 * así el bucketing se prueba entero sin base y comparte la definición de "mes"
 * con el resto del módulo en vez de re-derivarla en un `$queryRaw`.
 */
export function summarizeExercise(rows: ExerciseRow[], year: number): ExerciseSummary {
  const months: ExerciseMonth[] = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    amount: 0,
    count: 0,
  }));
  const byMethod = { cash: 0, mp: 0 };
  let counted = 0;
  let voided = 0;
  for (const r of rows) {
    if (r.voided) {
      voided++;
      continue;
    }
    const p = periodOf(r.receivedAt);
    // Defensivo: el WHERE ya acotó al ejercicio. Si algo se colara, no puede
    // sumar en un mes que no es el suyo.
    if (periodYear(p) !== year) continue;
    const cell = months[periodMonth(p) - 1];
    cell.amount = toCents(cell.amount + r.amount);
    cell.count++;
    byMethod[r.method] = toCents(byMethod[r.method] + r.amount);
    counted++;
  }
  return {
    year,
    total: toCents(byMethod.cash + byMethod.mp),
    counted,
    voided,
    byMethod,
    months,
    max: months.reduce((m, c) => Math.max(m, c.amount), 0),
  };
}

/** Los años (argentinos) que tienen ingresos, descendentes y sin repetir. */
export function incomeYearsOf(dates: Date[]): number[] {
  const years = new Set(dates.map((d) => periodYear(periodOf(d))));
  return [...years].sort((a, b) => b - a);
}

const ROW_SELECT = {
  id: true,
  amount: true,
  receivedAt: true,
  concept: true,
  method: true,
  mpPaymentId: true,
  note: true,
  voidedAt: true,
  voidReason: true,
  registeredBy: { select: { name: true } },
  voidedBy: { select: { name: true } },
} as const;

function toRow(r: {
  id: number; amount: unknown; receivedAt: Date; concept: string; method: IncomeMethod;
  mpPaymentId: string | null; note: string | null; voidedAt: Date | null; voidReason: string | null;
  registeredBy: { name: string | null } | null; voidedBy: { name: string | null } | null;
}): OtherIncomeRow {
  return {
    id: r.id,
    amount: Number(r.amount),
    receivedAt: r.receivedAt,
    concept: r.concept,
    method: r.method,
    mpPaymentId: r.mpPaymentId,
    note: r.note,
    registeredBy: r.registeredBy?.name ?? null,
    voidedAt: r.voidedAt,
    voidReason: r.voidReason,
    voidedBy: r.voidedBy?.name ?? null,
  };
}

/**
 * Asienta el ingreso. Es la primitiva y no un método de la factory porque la
 * bandeja sin conciliar la llama DENTRO de su propia transacción, con el `tx`
 * del callback: ahí no hay `$transaction` al que pedirle nada.
 *
 * Un choque de la unique de `mpPaymentId` devuelve `already_recorded` y no un
 * error — mismo criterio que `unmatched.record`: dos operadores sobre la misma
 * fila, o el mismo cobro llegando por dos caminos, no es una falla. Sin
 * `mpPaymentId` no hay unique que pueda chocar, así que ese P2002 se propaga:
 * taparlo escondería un bug nuestro.
 */
export async function recordOtherIncome(
  db: Pick<PrismaClient, "otherIncome">,
  input: RecordIncomeInput,
): Promise<RecordIncomeResult> {
  const concept = input.concept.trim();
  if (concept === "") throw new OtherIncomeError("Ingresá a qué corresponde el ingreso.");
  if (!Number.isFinite(input.amount)) throw new OtherIncomeError("El monto no es válido.");
  if (input.amount <= 0) throw new OtherIncomeError("El monto tiene que ser mayor a cero.");
  if (input.amount > MAX_INCOME_AMOUNT) {
    throw new OtherIncomeError("El monto supera el máximo que el sistema puede registrar.");
  }
  if (Number.isNaN(input.receivedAt.getTime())) {
    throw new OtherIncomeError("La fecha del ingreso no es válida.");
  }

  try {
    const row = await db.otherIncome.create({
      data: {
        // Decimal(10,2): string con dos decimales, nunca un float.
        amount: input.amount.toFixed(2),
        receivedAt: input.receivedAt,
        concept: concept.slice(0, 200),
        method: input.method,
        mpPaymentId: input.mpPaymentId ?? null,
        note: input.note?.trim().slice(0, 200) || null,
        registeredById: input.actorId,
      },
      select: { id: true },
    });
    return { kind: "recorded", id: row.id };
  } catch (e) {
    if (!isUniqueViolation(e) || !input.mpPaymentId) throw e;
    const existing = await db.otherIncome.findUnique({
      where: { mpPaymentId: input.mpPaymentId },
      select: { id: true },
    });
    if (!existing) throw e;
    return { kind: "already_recorded", id: existing.id };
  }
}

export function makeOtherIncome(db: IncomeDb) {
  return {
    record(input: RecordIncomeInput): Promise<RecordIncomeResult> {
      return recordOtherIncome(db, input);
    },

    /** Los años que ofrece la barra de ejercicios. Una sola columna de todas
     *  las filas: son decenas por año, y el año hay que resolverlo en hora
     *  argentina —lo que un `YEAR(received_at)` de SQL no hace—.
     *
     *  Incluye los años de los ingresos ANULADOS: se siguen listando, así que
     *  tiene que haber una pestaña por la que llegar a ellos. */
    async years(): Promise<number[]> {
      const rows = await db.otherIncome.findMany({ select: { receivedAt: true } });
      return incomeYearsOf(rows.map((r: { receivedAt: Date }) => r.receivedAt));
    },

    /** El ejercicio de un vistazo: total, desglose por medio y las doce celdas
     *  de la cinta. Sin `skip` ni `take` a propósito. */
    async exercise(year: number): Promise<ExerciseSummary> {
      const rows = await db.otherIncome.findMany({
        where: { receivedAt: exerciseBounds(year) },
        select: { receivedAt: true, amount: true, method: true, voidedAt: true },
      });
      return summarizeExercise(
        rows.map((r: { receivedAt: Date; amount: unknown; method: IncomeMethod; voidedAt: Date | null }) => ({
          receivedAt: r.receivedAt,
          amount: Number(r.amount),
          method: r.method,
          voided: r.voidedAt !== null,
        })),
        year,
      );
    },

    /** El ejercicio al que pertenece un ingreso. Lo usa el enlace que llega
     *  desde la bandeja sin conciliar: un cobro de diciembre mirado en enero
     *  tiene que abrir SU ejercicio y no el que está en curso. */
    async yearOf(id: number): Promise<number | null> {
      const row = await db.otherIncome.findUnique({
        where: { id },
        select: { receivedAt: true },
      });
      return row ? periodYear(periodOf(row.receivedAt)) : null;
    },

    /** Los anulados se LISTAN (tachados) pero no SUMAN: el que anuló tiene que
     *  poder ver lo que anuló, y el total del período tiene que decir la verdad.
     *  Las dos cifras se resuelven en la base y no en memoria — sobre el filtro
     *  entero y no sobre la página, o el total dependería de dónde está parado
     *  el operador. */
    async list(f: IncomeFilters, page: number): Promise<ListIncomeResult> {
      const where = incomeWhere(f);
      const total = await db.otherIncome.count({ where });
      const pg = paginate(total, page, INCOME_PAGE_SIZE);
      const [groups, rows] = await Promise.all([
        db.otherIncome.groupBy({
          by: ["method"],
          where: { ...where, voidedAt: null },
          _sum: { amount: true },
          _count: { _all: true },
        }),
        db.otherIncome.findMany({
          where,
          orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
          skip: pg.skip,
          take: pg.take,
          select: ROW_SELECT,
        }),
      ]);
      const byMethod = { cash: 0, mp: 0 };
      let counted = 0;
      for (const g of groups) {
        byMethod[g.method] = toCents(Number(g._sum.amount ?? 0));
        counted += g._count._all;
      }
      return { rows: rows.map(toRow), total, counted, sum: toCents(byMethod.cash + byMethod.mp), byMethod };
    },

    /**
     * Corrige el texto de un ingreso: SÓLO el concepto y la nota.
     *
     * No toca monto, fecha, medio ni `mpPaymentId` — para cambiar cualquiera de
     * esos, el camino sigue siendo anular y registrar de nuevo. Existe porque
     * para un ingreso venido de Mercado Pago ese camino NO existe: la unique de
     * `mpPaymentId` no se libera al anular (MariaDB no tiene índices únicos
     * parciales), así que un concepto mal escrito dejaba al operador con dos
     * salidas falsas —imputárselo a un socio o descartarlo— y ninguna verdadera.
     *
     * El `voidedAt: null` va en el WHERE y no en un `if` sobre una lectura
     * previa: es lo que impide que una edición pise un asiento que otro operador
     * acaba de anular.
     */
    async edit(input: { id: number; concept: string; note?: string | null }): Promise<EditIncomeResult> {
      const concept = input.concept.trim();
      if (concept === "") throw new OtherIncomeError("Ingresá a qué corresponde el ingreso.");
      const { count } = await db.otherIncome.updateMany({
        where: { id: input.id, voidedAt: null },
        data: { concept: concept.slice(0, 200), note: input.note?.trim().slice(0, 200) || null },
      });
      if (count > 0) return { kind: "edited" };
      const exists = await db.otherIncome.findUnique({
        where: { id: input.id },
        select: { id: true },
      });
      return exists ? { kind: "voided" } : { kind: "not_found" };
    },

    /** Anular es idempotente y no borra: el ingreso queda con motivo, fecha y
     *  quién. Si vino de la bandeja, la fila vuelve a Pendientes DENTRO de la
     *  misma transacción — la regla del núcleo es que una fila nunca queda
     *  apuntando a un registro anulado. */
    async void(input: { id: number; actorId: number; reason: string }): Promise<VoidIncomeResult> {
      const reason = input.reason.trim();
      if (reason === "") throw new OtherIncomeError("Indicá el motivo de la anulación.");
      return db.$transaction(async (tx: IncomeTx): Promise<VoidIncomeResult> => {
        // El `voidedAt: null` va en el WHERE y no en un `if` sobre una lectura
        // previa: es lo que serializa dos anulaciones simultáneas sin que la
        // segunda pise el motivo de la primera.
        const { count } = await tx.otherIncome.updateMany({
          where: { id: input.id, voidedAt: null },
          data: { voidedAt: new Date(), voidReason: reason.slice(0, 200), voidedById: input.actorId },
        });
        const row = await tx.otherIncome.findUnique({
          where: { id: input.id },
          select: { mpPaymentId: true },
        });
        if (count === 0) return row ? { kind: "already_voided" } : { kind: "not_found" };
        if (!row?.mpPaymentId) return { kind: "voided", reopened: false };
        const reopened = await tx.mpUnmatchedPayment.updateMany({
          where: { mpPaymentId: row.mpPaymentId, status: "other_income" },
          data: { status: "open", resolvedById: null, resolvedAt: null },
        });
        // `reopened` va al asiento del que anula: sin eso, que una fila de la
        // bandeja haya vuelto a Pendientes no queda escrito en ningún lado.
        return { kind: "voided", reopened: reopened.count > 0 };
      });
    },
  };
}

export const otherIncome = makeOtherIncome(prisma);
