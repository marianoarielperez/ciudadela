import { describe, expect, it } from "vitest";
import { isAdmin } from "@/lib/auth/roles";

describe("isAdmin", () => {
  it("accepts admin and superadmin", () => {
    expect(isAdmin(["admin"])).toBe(true);
    expect(isAdmin(["superadmin"])).toBe(true);
  });
  it("accepts accumulated roles", () => {
    expect(isAdmin(["socio", "admin"])).toBe(true);
  });
  it("rejects a plain member", () => {
    expect(isAdmin(["socio"])).toBe(false);
  });
  it("rejects an empty or missing role list", () => {
    expect(isAdmin([])).toBe(false);
    expect(isAdmin(undefined)).toBe(false);
    expect(isAdmin(null)).toBe(false);
  });
  it("does not fall for a lookalike role name", () => {
    expect(isAdmin(["administrativo"])).toBe(false);
    expect(isAdmin(["Admin"])).toBe(false);
  });
});
