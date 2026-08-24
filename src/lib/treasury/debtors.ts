// Deudores: socios vigentes o suspendidos con cuotas pendientes (spec §6.5).
// Prisma se INYECTA — el módulo se prueba sin `.env` ni fixtures.
//
// La baja no entra: sus pendientes quedan congeladas como deuda al momento de
// la baja (REG-16) y siguen visibles en su cuenta corriente, pero un socio que
// ya no es socio no se puede "declarar cesante" otra vez. El suspendido SÍ
// entra: la suspensión es disciplinaria, no eximición, y sigue devengando.
import type { MemberCategory, MemberStatus, PrismaClient } from "@/generated/prisma/client";
import { arrearsLevel, debtAmount, type ArrearsLevel, type FeeValueAmounts } from "./rules";

export type DebtorRow = {
  memberId: number;
  memberNumber: number | null;
  fullName: string;
  category: MemberCategory;
  status: MemberStatus;
  pendingCount: number;
  /** Deuda a valor vigente, o `null` si todavía no rige ningún valor de cuota. */
  debt: number | null;
  level: ArrearsLevel;
  lastPaidAt: Date | null;
  /** Teléfono de la ficha: lo usa la lista imprimible de gestión manual, que es
   *  el canal de los socios sin email (hoy, 23 de los 35 devengantes). */
  phone: string | null;
  /** Si tiene casilla utilizable — mismo criterio que el recibo
   *  (`receipt-email.ts:59`) y el recordatorio: hay email y no rebotó. El que NO
   *  la tiene es al que hay que llamar. */
  emailUsable: boolean;
};

export type DebtorFilters = { level?: 2 | 4; q?: string };

export function parseDebtorFilters(sp: Record<string, string | string[] | undefined>): DebtorFilters {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const f: DebtorFilters = {};
  const nivel = one(sp.nivel);
  // Sólo los dos umbrales del estatuto (REG-15): la pantalla no ofrece filtrar
  // por una cantidad arbitraria de cuotas y un `nivel` inventado se ignora.
  if (nivel === "2" || nivel === "4") f.level = Number(nivel) as 2 | 4;
  const q = one(sp.q)?.trim();
  if (q) f.q = q;
  return f;
}

/** Mayor deuda primero (es la lista que mira la Comisión), y a igual cantidad
 *  de cuotas por número de socio para que el orden sea estable entre recargas.
 *  El socio sin número de libro abierto va primero de su grupo. */
export function rankDebtors(rows: DebtorRow[]): DebtorRow[] {
  return [...rows].sort(
    (a, b) => b.pendingCount - a.pendingCount || (a.memberNumber ?? 0) - (b.memberNumber ?? 0),
  );
}

export async function fetchDebtors(
  db: Pick<PrismaClient, "fee" | "member">,
  f: DebtorFilters,
  feeValue: FeeValueAmounts | null,
): Promise<DebtorRow[]> {
  // El conteo sale de un groupBy y no de un `_count` por socio: la lista se
  // arma desde las cuotas pendientes, así que el padrón entero no se recorre.
  const groups = await db.fee.groupBy({
    by: ["memberId"],
    where: { status: "pending", member: { status: { in: ["active", "suspended"] } } },
    _count: { _all: true },
  });
  const counts = new Map(groups.map((g) => [g.memberId, g._count._all]));
  const minimum = f.level ?? 1;
  const ids = [...counts.entries()].filter(([, n]) => n >= minimum).map(([id]) => id);
  if (ids.length === 0) return [];
  const members = await db.member.findMany({
    where: {
      id: { in: ids },
      ...(f.q ? { OR: [{ fullName: { contains: f.q } }, { dni: { contains: f.q } }] } : {}),
    },
    include: {
      memberships: { include: { book: true } },
      payments: {
        where: { status: "applied" },
        orderBy: { paidAt: "desc" },
        take: 1,
        select: { paidAt: true },
      },
    },
  });
  const rows = members.map((m) => {
    const pendingCount = counts.get(m.id) ?? 0;
    return {
      memberId: m.id,
      // El número vigente es el del libro ABIERTO: el de un libro cerrado es
      // historia y no es el que figura en el padrón de hoy.
      memberNumber: m.memberships.find((ms) => ms.book.status === "open")?.memberNumber ?? null,
      fullName: m.fullName,
      category: m.category,
      status: m.status,
      pendingCount,
      debt: feeValue ? debtAmount(pendingCount, m.category, feeValue) : null,
      level: arrearsLevel(pendingCount),
      lastPaidAt: m.payments[0]?.paidAt ?? null,
      phone: m.phone,
      emailUsable: Boolean(m.email) && m.emailStatus !== "bounced",
    };
  });
  // Defensa en profundidad: se vuelve a aplicar el umbral sobre las filas ya
  // armadas, no sólo en el `where` que arma `ids`. Así la lista devuelta nunca
  // puede ofrecer un candidato que el llamador no pidió, aunque cambie cómo se
  // construye `ids` más arriba.
  return rankDebtors(rows.filter((r) => r.pendingCount >= minimum));
}
