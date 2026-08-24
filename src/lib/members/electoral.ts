// Padrón electoral (REG-31, docs/02:155-158) con la enmienda del operador del
// 23/08/2026.
//
// La enmienda: el Código Civil y Comercial deja al moroso purgar su deuda hasta
// una hora antes del acto, así que el padrón NO lo excluye — lo LISTA aparte,
// con cuántas cuotas y cuánto tiene que pagar en la mesa para votar. Por eso son
// dos bloques y no una lista filtrada.
//
// Tres cosas del estatuto que no son obvias:
//   - Los ADHERENTES votan (con ≥90 días). "Sin mora" es requisito sólo de
//     activos y colaboradores.
//   - La antigüedad sale de `joinedAt` y el reingreso NO la reinicia (REG-11),
//     así que no hay nada especial que hacer: `joinedAt` ya es el original.
//   - "No registrar deuda a la fecha de la elección" es MORA, no "al cobro": se
//     mide sobre períodos ANTERIORES al mes de la elección (§3 de la spec). Con
//     la otra definición, el padrón se vaciaría de activos todos los meses.
//
// Prisma inyectado; la fecha es un PARÁMETRO (docs/02:157), nunca el reloj.
import type { MemberCategory, PrismaClient } from "@/generated/prisma/client";
import { periodOf, type Period } from "@/lib/treasury/periods";
import { ACCRUING_CATEGORIES, debtAmount, type FeeValueAmounts } from "@/lib/treasury/rules";

export const ELECTORAL_MIN_DAYS = 90;

/** REG-31: activos, honorarios, colaboradores, vitalicios y adherentes. El
 *  CADETE no integra el padrón: no tiene voto (docs/02, tabla del Art. 5). */
export const ELECTORAL_CATEGORIES: readonly MemberCategory[] = [
  "active",
  "honorary",
  "collaborator",
  "lifetime",
  "adherent",
];

export function seniorityDays(joinedAt: Date, at: Date): number {
  return Math.floor((at.getTime() - joinedAt.getTime()) / 86_400_000);
}

export function isEligibleBySeniority(joinedAt: Date, at: Date): boolean {
  return seniorityDays(joinedAt, at) >= ELECTORAL_MIN_DAYS;
}

export type ElectoralRow = {
  memberId: number;
  memberNumber: number | null;
  fullName: string;
  category: MemberCategory;
  joinedAt: Date;
  seniorityDays: number;
  arrears: number;
  debt: number | null;
};

export type ElectoralRoll = {
  at: Date;
  period: Period;
  enabled: ElectoralRow[];
  toPurge: ElectoralRow[];
  purgeFees: number;
  purgeAmount: number;
};

export async function buildElectoralRoll(
  db: Pick<PrismaClient, "membership" | "fee">,
  at: Date,
  feeValue: FeeValueAmounts | null,
): Promise<ElectoralRoll> {
  // Del libro ABIERTO: el número de un libro cerrado es historia y no es el que
  // figura en el padrón de hoy (mismo criterio que `fetchDebtors`).
  //
  // Sólo socios `active`: el `withdrawn` no es socio, y el `suspended` NO vota
  // —la suspensión es disciplinaria y suspende también el voto— por decisión del
  // operador del 23/08/2026 (spec §13, decisión 9), que cerró la pregunta que el
  // estatuto no resuelve expresamente.
  const rows = await db.membership.findMany({
    where: {
      book: { status: "open" },
      member: { status: "active", category: { in: [...ELECTORAL_CATEGORIES] } },
    },
    select: {
      memberNumber: true,
      member: { select: { id: true, fullName: true, category: true, joinedAt: true } },
    },
    orderBy: { memberNumber: "asc" },
  });
  const eligible = rows.filter((r) => isEligibleBySeniority(r.member.joinedAt, at));
  const period = periodOf(at);
  const ids = eligible.map((r) => r.member.id);

  // La mora A LA FECHA: pendientes de períodos anteriores al mes de la elección.
  // `Fee.period` es Char(7) "YYYY-MM", que ordena lexicográficamente igual que
  // en el tiempo, así que el `lt` es una comparación de texto barata.
  const groups =
    ids.length === 0
      ? []
      : await db.fee.groupBy({
          by: ["memberId"],
          where: { memberId: { in: ids }, status: "pending", period: { lt: period } },
          _count: { _all: true },
        });
  const arrearsBy = new Map(groups.map((g) => [g.memberId, g._count._all]));

  const enabled: ElectoralRow[] = [];
  const toPurge: ElectoralRow[] = [];
  for (const r of eligible) {
    const arrears = arrearsBy.get(r.member.id) ?? 0;
    const row: ElectoralRow = {
      memberId: r.member.id,
      memberNumber: r.memberNumber,
      fullName: r.member.fullName,
      category: r.member.category,
      joinedAt: r.member.joinedAt,
      seniorityDays: seniorityDays(r.member.joinedAt, at),
      arrears,
      debt: feeValue ? debtAmount(arrears, r.member.category, feeValue) : null,
    };
    // La exigencia de estar sin mora es SÓLO para activos y colaboradores: el
    // aporte del adherente es voluntario y su deuda no le quita el voto.
    const owes = arrears > 0 && ACCRUING_CATEGORIES.includes(r.member.category);
    (owes ? toPurge : enabled).push(row);
  }

  return {
    at,
    period,
    enabled,
    toPurge,
    purgeFees: toPurge.reduce((a, r) => a + r.arrears, 0),
    purgeAmount: toPurge.reduce((a, r) => a + (r.debt ?? 0), 0),
  };
}

const CSV_HEADER = "bloque,numero_socio,apellido_nombre,categoria,cuotas_adeudadas,monto_a_purgar";

/** Comillas dobles siempre: los apellidos con coma ("Pizarro, Francisco" es el
 *  formato del catálogo de calles y aparece igual en nombres cargados a mano)
 *  parten la fila en dos. La comilla interna se duplica, como manda el RFC. */
function cell(value: string | number | null): string {
  const s = value === null ? "" : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

/** Las columnas de REG-31 (docs/02:158) y nada más: nombre, número de socio y
 *  categoría. **Sin DNI**, que es el dato más sensible del padrón y no hace
 *  falta para tomar lista en una mesa donde los vecinos se conocen.
 *
 *  Las dos columnas de plata salen en blanco para el bloque de habilitados, y no
 *  es cosmético: para un activo o un colaborador habilitado valen cero por
 *  definición, y para un adherente moroso —que vota igual— son un dato
 *  financiero personal que la Junta Electoral no necesita para nada y que en
 *  papel ya no vuelve (Ley 25.326, principio de pertinencia). */
export function electoralCsv(roll: ElectoralRoll): string {
  const line = (block: string, r: ElectoralRow, withDebt: boolean) =>
    [
      cell(block),
      cell(r.memberNumber),
      cell(r.fullName),
      cell(r.category),
      cell(withDebt ? r.arrears : ""),
      cell(withDebt ? r.debt : ""),
    ].join(",");
  return [
    CSV_HEADER,
    ...roll.enabled.map((r) => line("habilitado", r, false)),
    ...roll.toPurge.map((r) => line("a_purgar", r, true)),
  ].join("\n");
}
