// Buscador de socio para Efectivo y para la bandeja sin conciliar (4B). Todo el
// libro abierto, en los tres estados: al dado de baja también hay que poder
// cobrarle, porque el Art. 9 inc. c (REG-16) le exige saldar la deuda a valores
// vigentes ANTES de que la Comisión pueda readmitirlo. El estado viaja en cada
// resultado y la lista lo muestra en un badge: cobrarle a un cesante es
// legítimo, cobrarle sin saber que lo es, no.
// Hasta 10 resultados; el operador afina la consulta.
import type { MemberCategory, MemberStatus, Prisma, PrismaClient } from "@/generated/prisma/client";

export type MemberHit = {
  id: number;
  memberNumber: number;
  fullName: string;
  dni: string | null;
  category: MemberCategory;
  status: MemberStatus;
};

export function memberSearchWhere(q: string): Prisma.MembershipWhereInput {
  const or: Prisma.MembershipWhereInput[] = [
    { member: { fullName: { contains: q } } },
    { member: { dni: { contains: q } } },
  ];
  const n = Number(q);
  if (Number.isInteger(n) && n > 0) or.push({ memberNumber: n });
  return { book: { status: "open" }, OR: or };
}

export async function searchMembers(db: Pick<PrismaClient, "membership">, q: string): Promise<MemberHit[]> {
  // Sin consulta no se consulta: un `contains: ""` devolvería el padrón entero.
  const trimmed = q.trim();
  if (trimmed === "") return [];
  const rows = await db.membership.findMany({
    where: memberSearchWhere(trimmed),
    include: { member: { select: { id: true, fullName: true, dni: true, category: true, status: true } } },
    orderBy: { memberNumber: "asc" },
    take: 10,
  });
  return rows.map((r) => ({ memberNumber: r.memberNumber, ...r.member }));
}
