// Buscador de socio para Efectivo y para la bandeja sin conciliar (4B). Solo
// vigentes y suspendidos del libro abierto: a una baja no se le cobra sin
// reingreso. Hasta 10 resultados; el operador afina la consulta.
import type { MemberCategory, MemberStatus, Prisma, PrismaClient } from "@/generated/prisma/client";

export type MemberHit = {
  id: number;
  memberNumber: number;
  fullName: string;
  dni: string | null;
  category: MemberCategory;
  status: MemberStatus;
};

const LIVE: MemberStatus[] = ["active", "suspended"];

export function memberSearchWhere(q: string): Prisma.MembershipWhereInput {
  const member: Prisma.MemberWhereInput = { status: { in: LIVE } };
  // Cada rama arrastra el filtro de estado: si no, buscar por número traería
  // también a un socio dado de baja, y esta pantalla cobra.
  const or: Prisma.MembershipWhereInput[] = [
    { member: { ...member, fullName: { contains: q } } },
    { member: { ...member, dni: { contains: q } } },
  ];
  const n = Number(q);
  if (Number.isInteger(n) && n > 0) or.push({ member, memberNumber: n });
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
