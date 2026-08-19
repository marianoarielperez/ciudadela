import { describe, expect, it, vi } from "vitest";
import { fetchPadron, padronWhere, parsePadronFilters } from "@/lib/members/query";

describe("parsePadronFilters", () => {
  it("keeps only known values", () => {
    expect(parsePadronFilters({ q: "perez", category: "adherent", status: "nope", email: "sin", dni: "con" }))
      .toEqual({ q: "perez", category: "adherent", email: "sin", dni: "con" });
  });
});

describe("padronWhere", () => {
  it("always scopes to the open book", () => {
    expect(padronWhere({})).toMatchObject({ book: { status: "open" } });
  });
  it("searches by name, dni or member number", () => {
    const w = padronWhere({ q: "123" });
    expect(JSON.stringify(w)).toContain("123");
    expect(JSON.stringify(w)).toContain("memberNumber");
  });
  it("maps email filter", () => {
    expect(JSON.stringify(padronWhere({ email: "verificado" }))).toContain("verified");
    expect(JSON.stringify(padronWhere({ email: "sin" }))).toContain("none");
  });
});

describe("fetchPadron", () => {
  // El export a Excel (Task 16) necesita el nombre de la calle de catálogo, no
  // sólo el streetId: si esta relación se deja de traer, `member.street` vuelve
  // a ser `undefined` y el domicilio de los socios del barrio se exporta vacío
  // en silencio.
  it("includes the catalog street relation on member", async () => {
    const findMany = vi.fn(async () => []);
    const db = { membership: { findMany } } as never;
    await fetchPadron(db, {});
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ include: { member: { include: { street: true } } } }),
    );
  });
});
