// El GRUPO de un cobro de Mercado Pago (spec 2026-09-10 §4.3): el portador —el
// pago que lleva `mpPaymentId`— más las partes que apuntan a él con
// `splitOfPaymentId`. Es UNA aritmética para el núcleo, la pantalla Resolver y
// la lista de la bandeja: con una copia por lector, alcanzaba con que uno
// olvidara filtrar `status: "applied"` para que una parte anulada siguiera
// contando como plata asignada.
//
// Prisma inyectado: este módulo lo importan tests puros (sin `.env`).
import type { PaymentStatus, PaymentType, PrismaClient } from "@/generated/prisma/client";
import type { CashConcept } from "./rules";

/** Tope de socios por cobro (decisión 1 del operador, 10/09/2026). Cinco recibos
 *  en una transacción entran holgados en el timeout de 5 s de Prisma; el
 *  tiempo real se mide en `tests/integration/unmatched-split.test.ts`. */
export const MAX_SPLIT_PARTS = 5;

/** Tipo de pago por concepto DESDE LA BANDEJA: distinto del `CONCEPT_TYPE` de
 *  Efectivo (`fees → cash`). La plata entró por Mercado Pago y el recibo lo
 *  tiene que decir; `link` se rotula "Mercado Pago" (decisión 10). */
export const INBOX_CONCEPT_TYPE: Record<CashConcept, PaymentType> = {
  fees: "link", voluntary: "voluntary", extraordinary: "extraordinary",
};

/** Plata en centavos enteros: toda comparación de importes del reparto se hace
 *  acá y no en flotantes (0.1 + 0.2 no es 0.3). */
export function cents(n: number): number {
  return Math.round(n * 100);
}

export type GroupStatus = "open" | "partial" | "matched";
export type GroupTotals = { assigned: number; unassigned: number; status: GroupStatus };

/** Asignado = Σ `applied` del grupo; sin asignar = lo cobrado menos eso. El
 *  estado de la fila se DERIVA de acá y no se decide en ninguna pantalla. Un
 *  grupo que supera lo cobrado —no debería existir: el núcleo revalida la suma
 *  dentro de la transacción— cuenta como `matched` con cero sin asignar, en vez
 *  de un negativo que la lista sumaría al total. */
export function groupTotals(
  payments: ReadonlyArray<{ amount: number; status: PaymentStatus }>,
  rowAmount: number,
): GroupTotals {
  const assigned = payments.filter((p) => p.status === "applied").reduce((s, p) => s + cents(p.amount), 0);
  const total = cents(rowAmount);
  const unassigned = Math.max(0, total - assigned);
  const status: GroupStatus = assigned === 0 ? "open" : assigned >= total ? "matched" : "partial";
  return { assigned: assigned / 100, unassigned: unassigned / 100, status };
}

export const GROUP_PAYMENT_SELECT = {
  id: true, amount: true, status: true, type: true, mpPaymentId: true, splitOfPaymentId: true, memberId: true,
  member: { select: { id: true, fullName: true } },
  receipt: { select: { id: true, number: true, concept: true, voidedAt: true } },
} as const;

export type GroupRow = {
  id: number;
  amount: number;
  status: PaymentStatus;
  type: PaymentType;
  mpPaymentId: string | null;
  splitOfPaymentId: number | null;
  memberId: number | null;
  member: { id: number; fullName: string } | null;
  receipt: { id: number; number: string; concept: string; voidedAt: Date | null } | null;
};

export type LoadedGroup = { holder: GroupRow | null; parts: GroupRow[]; all: GroupRow[]; totals: GroupTotals };

type RawRow = Omit<GroupRow, "amount"> & { amount: unknown };

function toRow(r: RawRow): GroupRow {
  return { ...r, amount: Number(r.amount) };
}

/** El grupo de una fila de la bandeja, con el portador primero y las partes por
 *  id. `holder` puede existir anulado o reembolsado: sigue siendo el portador del
 *  `mpPaymentId`, y las partes nuevas cuelgan de él. */
export async function loadGroup(
  db: Pick<PrismaClient, "payment">,
  row: { mpPaymentId: string; amount: number },
): Promise<LoadedGroup> {
  const holderRaw = await db.payment.findUnique({ where: { mpPaymentId: row.mpPaymentId }, select: GROUP_PAYMENT_SELECT });
  if (!holderRaw) return { holder: null, parts: [], all: [], totals: groupTotals([], row.amount) };
  const holder = toRow(holderRaw as RawRow);
  const partsRaw = await db.payment.findMany({
    where: { splitOfPaymentId: holder.id }, select: GROUP_PAYMENT_SELECT, orderBy: { id: "asc" },
  });
  const parts = (partsRaw as RawRow[]).map(toRow).sort((a, b) => a.id - b.id);
  const all = [holder, ...parts];
  return { holder, parts, all, totals: groupTotals(all, row.amount) };
}

/** La leyenda de "pago compartido" del recibo y del email (decisión 4): total y
 *  fecha del cobro de MP, sólo cuando este pago cubre MENOS que el cobro. Sin
 *  contar socios, para que el texto no envejezca cuando una parte se anula y se
 *  reasigna. Un pago sin partes ni portador no consulta nada: el dato del recibo
 *  de siempre sigue byte-idéntico. */
export async function sharedPaymentOf(
  db: Pick<PrismaClient, "payment" | "mpUnmatchedPayment">,
  payment: { amount: number; mpPaymentId: string | null; splitOfPaymentId: number | null; hasParts: boolean },
): Promise<{ rowId: number; mpPaymentId: string; total: number; paidAt: Date } | null> {
  if (payment.splitOfPaymentId === null && !payment.hasParts) return null;
  const holderMpId = payment.mpPaymentId
    ?? (payment.splitOfPaymentId !== null
      ? (await db.payment.findUnique({ where: { id: payment.splitOfPaymentId }, select: { mpPaymentId: true } }))?.mpPaymentId ?? null
      : null);
  if (!holderMpId) return null;
  const row = await db.mpUnmatchedPayment.findUnique({
    where: { mpPaymentId: holderMpId }, select: { id: true, amount: true, paidAt: true },
  });
  if (!row) return null;
  const total = Number(row.amount);
  return cents(payment.amount) < cents(total) ? { rowId: row.id, mpPaymentId: holderMpId, total, paidAt: row.paidAt } : null;
}

/** `?socios=192,193` → `[192, 193]`: enteros positivos, sin repetidos, hasta el
 *  tope. Lo que no es un id se ignora (una URL editada a mano no puede tirar la
 *  pantalla). */
export function parseSociosParam(raw: string | undefined): number[] {
  if (!raw) return [];
  const out: number[] = [];
  for (const piece of raw.split(",")) {
    if (!/^\d+$/.test(piece.trim())) continue;
    const n = Number(piece);
    if (n <= 0 || out.includes(n)) continue;
    out.push(n);
    if (out.length === MAX_SPLIT_PARTS) break;
  }
  return out;
}
