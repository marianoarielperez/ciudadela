import { describe, expect, it } from "vitest";
import { padronWhere, parsePadronFilters } from "@/lib/members/query";

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
