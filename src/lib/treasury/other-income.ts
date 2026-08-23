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
  /** Fecha civil al mediodía UTC (`parseCivilDate`), inclusive. */
  from?: Date;
  /** Fecha civil al mediodía UTC, inclusive: cubre el día entero. */
  to?: Date;
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

const HOUR = 3_600_000;

// El filtro por fecha se compara contra el DÍA CIVIL argentino y no contra el
// mediodía UTC con el que el proyecto guarda las fechas civiles: un cobro de
// Mercado Pago de las 20:00 del último día del rango se guarda como las 23:00
// UTC de ese día, y un `lte` al mediodía lo dejaba afuera — la suma del período
// mentía por abajo justo el día que el operador mira. Argentina es UTC-3 sin
// DST, así que el día civil D va de D 03:00 UTC a D+1 03:00 UTC.
function startOfArDay(civilNoonUtc: Date): Date {
  return new Date(civilNoonUtc.getTime() - 9 * HOUR);
}
function afterArDay(civilNoonUtc: Date): Date {
  return new Date(civilNoonUtc.getTime() + 15 * HOUR);
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
  const where: Prisma.OtherIncomeWhereInput = {};
  if (f.from || f.to) {
    where.receivedAt = {
      ...(f.from ? { gte: startOfArDay(f.from) } : {}),
      ...(f.to ? { lt: afterArDay(f.to) } : {}),
    };
  }
  if (f.method) where.method = f.method;
  if (f.id) where.id = f.id;
  return where;
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
