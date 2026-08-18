// Shared padron query: listing page and Excel export use the same filters.
import type { Member, MemberCategory, MemberStatus, Prisma, PrismaClient } from "@/generated/prisma/client";

export type PadronFilters = {
  q?: string;
  category?: MemberCategory;
  status?: MemberStatus;
  email?: "con" | "sin" | "verificado";
  dni?: "con" | "sin";
};

const CATEGORIES = ["active", "adherent", "collaborator", "cadet", "honorary", "lifetime"];
const STATUSES = ["active", "suspended", "withdrawn"];

export function parsePadronFilters(sp: Record<string, string | string[] | undefined>): PadronFilters {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const f: PadronFilters = {};
  const q = one(sp.q)?.trim();
  if (q) f.q = q;
  const category = one(sp.category);
  if (category && CATEGORIES.includes(category)) f.category = category as MemberCategory;
  const status = one(sp.status);
  if (status && STATUSES.includes(status)) f.status = status as MemberStatus;
  const email = one(sp.email);
  if (email === "con" || email === "sin" || email === "verificado") f.email = email;
  const dni = one(sp.dni);
  if (dni === "con" || dni === "sin") f.dni = dni;
  return f;
}

export function padronWhere(f: PadronFilters): Prisma.MembershipWhereInput {
  const member: Prisma.MemberWhereInput = {};
  if (f.category) member.category = f.category;
  if (f.status) member.status = f.status;
  if (f.email === "con") member.email = { not: null };
  if (f.email === "sin") member.emailStatus = "none";
  if (f.email === "verificado") member.emailStatus = "verified";
  if (f.dni === "con") member.dni = { not: null };
  if (f.dni === "sin") member.dni = null;

  const where: Prisma.MembershipWhereInput = { book: { status: "open" }, member };
  if (f.q) {
    // La búsqueda es un OR de tres campos, pero cada rama tiene que arrastrar los
    // demás filtros: si no, buscar un nombre con "Estado: vigente" puesto
    // devolvería también las bajas que matchean el nombre.
    const or: Prisma.MembershipWhereInput[] = [
      { member: { ...member, fullName: { contains: f.q } } },
      { member: { ...member, dni: { contains: f.q } } },
    ];
    const asNumber = Number(f.q);
    if (Number.isInteger(asNumber) && asNumber > 0) {
      or.push({ member, memberNumber: asNumber });
    }
    return { book: { status: "open" }, OR: or };
  }
  return where;
}

export async function fetchPadron(db: PrismaClient, f: PadronFilters) {
  const rows = await db.membership.findMany({
    where: padronWhere(f),
    include: { member: true },
    orderBy: { memberNumber: "asc" },
  });
  return rows.map((r) => ({ memberNumber: r.memberNumber, member: r.member as Member }));
}
