import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import { memberSearchWhere, searchMembers } from "@/lib/treasury/member-search";

describe("member search", () => {
  // Sin filtro de estado: al cesante hay que poder cobrarle la deuda congelada
  // antes del reingreso (REG-16), así que el buscador de Efectivo lo encuentra.
  it("busca por número exacto, nombre o DNI en el libro abierto, sin filtrar por estado", () => {
    const where = memberSearchWhere("144");
    expect(where.book).toEqual({ status: "open" });
    expect(where.OR).toEqual([
      { member: { fullName: { contains: "144" } } },
      { member: { dni: { contains: "144" } } },
      { memberNumber: 144 },
    ]);
    expect(memberSearchWhere("ana").OR).toHaveLength(2);
  });

  it("devuelve hasta 10 resultados con número y ficha", async () => {
    const db = {
      membership: {
        findMany: vi.fn(async () => [
          { memberNumber: 144, member: { id: 1, fullName: "Skardius Ana", dni: "1", category: "active", status: "active" } },
        ]),
      },
    } as never;
    const hits = await searchMembers(db, "ana");
    expect(hits).toEqual([{ id: 1, memberNumber: 144, fullName: "Skardius Ana", dni: "1", category: "active", status: "active" }]);
  });

  // El estado viaja en el hit porque la lista lo muestra en un badge: cobrarle
  // a un dado de baja es legítimo, cobrarle sin saberlo no.
  it("trae al socio dado de baja con su estado", async () => {
    const db = {
      membership: {
        findMany: vi.fn(async () => [
          { memberNumber: 7, member: { id: 9, fullName: "Cesante Juan", dni: "2", category: "active", status: "withdrawn" } },
        ]),
      },
    } as never;
    expect(await searchMembers(db, "cesante")).toEqual([
      { id: 9, memberNumber: 7, fullName: "Cesante Juan", dni: "2", category: "active", status: "withdrawn" },
    ]);
  });

  it("con consulta vacía no consulta", async () => {
    const db = { membership: { findMany: vi.fn() } } as never;
    expect(await searchMembers(db, "  ")).toEqual([]);
  });
});
