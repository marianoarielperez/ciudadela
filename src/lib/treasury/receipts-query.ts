// Listado de recibos: filtros por querystring + paginación.
//
// El cliente de Prisma se INYECTA y no se importa: "@/lib/prisma" tira al
// evaluarse si falta DATABASE_URL, y este módulo lo importan los tests puros.
import type { PaymentType, Prisma, PrismaClient } from "@/generated/prisma/client";
import { paginate } from "@/lib/admin/pagination";
import { isPeriod, periodMonth, periodYear, type Period } from "./periods";

export type ReceiptFilters = {
  q?: string;
  mes?: Period;
  medio?: PaymentType;
  estado?: "vigentes" | "anulados";
};

const TYPES: PaymentType[] = ["debit", "link", "cash", "voluntary", "entry", "extraordinary"];

export function parseReceiptFilters(sp: Record<string, string | string[] | undefined>): ReceiptFilters {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const f: ReceiptFilters = {};
  const q = one(sp.q)?.trim();
  if (q) f.q = q;
  const mes = one(sp.mes);
  if (mes && isPeriod(mes)) f.mes = mes;
  const medio = one(sp.medio);
  if (medio && (TYPES as string[]).includes(medio)) f.medio = medio as PaymentType;
  const estado = one(sp.estado);
  if (estado === "vigentes" || estado === "anulados") f.estado = estado;
  return f;
}

// Mes civil en hora Argentina: el 1° a las 00:00 AR es 03:00Z. Sin el corrimiento,
// filtrar "septiembre" perdería los recibos emitidos entre las 21:00 y las 24:00
// del último día de agosto y los mostraría como de septiembre.
function monthBoundsAR(p: Period): { gte: Date; lt: Date } {
  const y = periodYear(p);
  const m = periodMonth(p);
  // `Date.UTC(y, 12, …)` arrastra solo al año siguiente: diciembre cierra bien.
  return { gte: new Date(Date.UTC(y, m - 1, 1, 3)), lt: new Date(Date.UTC(y, m, 1, 3)) };
}

export function receiptsWhere(f: ReceiptFilters): Prisma.ReceiptWhereInput {
  const where: Prisma.ReceiptWhereInput = {};
  if (f.estado === "vigentes") where.voidedAt = null;
  if (f.estado === "anulados") where.voidedAt = { not: null };
  if (f.mes) where.issuedAt = monthBoundsAR(f.mes);
  if (f.medio) where.payment = { type: f.medio };
  if (f.q) {
    // El operador tipea o el número de recibo o el apellido: las dos ramas van
    // en un OR, y Prisma lo combina con AND contra los demás filtros de arriba
    // (así "septiembre + efectivo + Pérez" sigue siendo la intersección).
    where.OR = [
      { number: { contains: f.q } },
      { payment: { member: { fullName: { contains: f.q } } } },
    ];
  }
  return where;
}

export const RECEIPTS_PAGE_SIZE = 50;

export async function fetchReceiptsPage(db: Pick<PrismaClient, "receipt">, f: ReceiptFilters, page: number) {
  const where = receiptsWhere(f);
  const total = await db.receipt.count({ where });
  const p = paginate(total, page, RECEIPTS_PAGE_SIZE);
  const rows = await db.receipt.findMany({
    where,
    // Sin `payment.fees`: el concepto ya viene congelado en `Receipt.concept`
    // (se escribe al emitir). Recalcularlo desde las cuotas devolvería "Cuota
    // social" pelada justo en los anulados, que es cuando las cuotas se
    // despegan del pago.
    include: { payment: { include: { member: { select: { id: true, fullName: true } } } } },
    // Por la serie y no por `issuedAt`: dos recibos del mismo segundo tienen
    // que salir en el orden en que se numeraron.
    orderBy: [{ year: "desc" }, { seq: "desc" }],
    skip: p.skip,
    take: p.take,
  });
  return { rows, total, page: p.page, pageCount: p.pageCount };
}
