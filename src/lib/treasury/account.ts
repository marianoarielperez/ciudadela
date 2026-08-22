// Cuenta corriente de un socio: cuotas, pagos y resumen. Prisma inyectado.
import type {
  FeeOrigin, FeeStatus, MemberCategory, PaymentStatus, PaymentType, PrismaClient,
} from "@/generated/prisma/client";
import { comparePeriods, periodYear, type Period } from "./periods";
import { arrearsLevel, debtAmount, feeAmountFor, type ArrearsLevel, type FeeValueAmounts } from "./rules";

export type AccountFee = { period: Period; status: FeeStatus; origin: FeeOrigin; paymentId: number | null };

export type AccountPayment = {
  id: number;
  type: PaymentType;
  amount: number;
  paidAt: Date;
  status: PaymentStatus;
  periods: Period[];
  receipt: { id: number; number: string; voidedAt: Date | null } | null;
  note: string | null;
};

export type MemberAccount = {
  fees: AccountFee[];
  payments: AccountPayment[];
  pendingCount: number;
  pendingPeriods: Period[];
  oldestPending: Period | null;
  /** Deuda a valor vigente, o `null` si no hay valor vigente. */
  debt: number | null;
  feeAmount: number | null;
  level: ArrearsLevel;
};

type Db = Pick<PrismaClient, "fee" | "payment">;

export async function fetchMemberAccount(
  db: Db,
  member: { id: number; category: MemberCategory },
  feeValue: FeeValueAmounts | null,
): Promise<MemberAccount> {
  const [feeRows, paymentRows] = await Promise.all([
    db.fee.findMany({
      where: { memberId: member.id },
      select: { period: true, status: true, origin: true, paymentId: true },
      orderBy: { period: "asc" },
    }),
    db.payment.findMany({
      where: { memberId: member.id },
      select: {
        id: true, type: true, amount: true, paidAt: true, status: true, note: true,
        fees: { select: { period: true } },
        receipt: { select: { id: true, number: true, voidedAt: true } },
      },
      orderBy: [{ paidAt: "desc" }, { id: "desc" }],
    }),
  ]);
  const fees: AccountFee[] = feeRows.map((f) => ({
    period: f.period, status: f.status, origin: f.origin, paymentId: f.paymentId,
  }));
  const pendingPeriods = fees.filter((f) => f.status === "pending").map((f) => f.period).sort(comparePeriods);
  return {
    fees,
    payments: paymentRows.map((p) => ({
      id: p.id,
      type: p.type,
      amount: Number(p.amount),
      paidAt: p.paidAt,
      status: p.status,
      periods: p.fees.map((f) => f.period).sort(comparePeriods),
      receipt: p.receipt,
      note: p.note,
    })),
    pendingCount: pendingPeriods.length,
    pendingPeriods,
    oldestPending: pendingPeriods[0] ?? null,
    debt: feeValue ? debtAmount(pendingPeriods.length, member.category, feeValue) : null,
    feeAmount: feeValue ? feeAmountFor(member.category, feeValue) : null,
    level: arrearsLevel(pendingPeriods.length),
  };
}

export async function countPendingFees(db: Pick<PrismaClient, "fee">, memberId: number): Promise<number> {
  return db.fee.count({ where: { memberId, status: "pending" } });
}

export type GridCellState = "paid" | "pending" | "pending_import" | "exempt" | "voided" | "none";
export type GridCell = { period: Period; state: GridCellState; receiptNumber?: string };
export type GridRow = { year: number; cells: GridCell[] };

/** La cinta de períodos: una fila por año, 12 celdas. Va del año de la PRIMERA
 *  cuota al de la última, con el período corriente siempre adentro (y el año
 *  corriente solo, si el socio todavía no tiene ninguna cuota).
 *
 *  La fecha de ingreso NO entra en el cálculo, y es deliberado: un socio que
 *  ingresó en 2019 y tiene una sola cuota en 2026 mostraba ocho filas de las
 *  cuales 95 celdas decían "sin cuota" —una pared de guiones en pantalla y 96
 *  anuncios para que un lector de pantalla llegue al único pago—. Los años
 *  anteriores a la primera cuota no tienen nada que contar: no hubo devengo. */
export function buildPeriodGrid(
  fees: AccountFee[],
  receiptByPayment: Map<number, string>,
  currentPeriod: Period,
): GridRow[] {
  const byPeriod = new Map(fees.map((f) => [f.period, f]));
  const currentYear = periodYear(currentPeriod);
  const years = [...fees.map((f) => periodYear(f.period)), currentYear];
  // El corriente entra siempre: si la primera cuota es futura (alguien que pagó
  // por adelantado antes de que devengue nada), la cinta arranca igual en el año
  // en curso y no en el del pago.
  const firstYear = Math.min(...years);
  // `allocate()` puede generar cuotas en un año POSTERIOR al del período
  // corriente: un pago que cubre más meses de los que el socio debe (p. ej.
  // uno de noviembre que cubre nov/dic/ene) crea una fila de enero del año
  // siguiente. El límite superior tiene que ensanchar igual que el inferior,
  // o esa cuota queda sin fila y sin celda en la cinta.
  const lastYear = Math.max(...years);
  const rows: GridRow[] = [];
  for (let year = firstYear; year <= lastYear; year++) {
    const cells: GridCell[] = [];
    for (let m = 1; m <= 12; m++) {
      const period = `${year}-${String(m).padStart(2, "0")}`;
      const fee = byPeriod.get(period);
      if (!fee) {
        cells.push({ period, state: "none" });
        continue;
      }
      const state: GridCellState =
        fee.status === "paid" ? "paid"
        : fee.status === "pending" ? (fee.origin === "import" ? "pending_import" : "pending")
        : fee.status === "exempt" ? "exempt"
        : "voided";
      const receiptNumber = fee.paymentId !== null ? receiptByPayment.get(fee.paymentId) : undefined;
      cells.push(receiptNumber ? { period, state, receiptNumber } : { period, state });
    }
    rows.push({ year, cells });
  }
  return rows;
}
