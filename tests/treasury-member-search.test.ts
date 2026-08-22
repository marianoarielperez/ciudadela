import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import { memberSearchWhere, searchMembers } from "@/lib/treasury/member-search";

describe("member search", () => {
  it("busca por número exacto, nombre o DNI, solo vigentes/suspendidos del libro abierto", () => {
    const where = memberSearchWhere("144");
    expect(where.book).toEqual({ status: "open" });
    expect(where.OR).toEqual([
      { member: { status: { in: ["active", "suspended"] }, fullName: { contains: "144" } } },
      { member: { status: { in: ["active", "suspended"] }, dni: { contains: "144" } } },
      { member: { status: { in: ["active", "suspended"] } }, memberNumber: 144 },
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

  it("con consulta vacía no consulta", async () => {
    const db = { membership: { findMany: vi.fn() } } as never;
    expect(await searchMembers(db, "  ")).toEqual([]);
  });
});
