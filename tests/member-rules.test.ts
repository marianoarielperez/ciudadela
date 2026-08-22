import { describe, expect, it } from "vitest";
import { canChangeCategory, canReadmit, canSuspend, canWithdraw } from "@/lib/members/rules";

describe("member rules", () => {
  it("cannot withdraw an already withdrawn member", () => {
    expect(canWithdraw({ status: "withdrawn" }).ok).toBe(false);
    expect(canWithdraw({ status: "active" }).ok).toBe(true);
  });

  it("category change requires active status, a different category and no ongoing election (REG-07)", () => {
    expect(canChangeCategory({ status: "active", category: "adherent" }, "active", false).ok).toBe(true);
    expect(canChangeCategory({ status: "active", category: "adherent" }, "adherent", false).ok).toBe(false);
    expect(canChangeCategory({ status: "withdrawn", category: "adherent" }, "active", false).ok).toBe(false);
    const blocked = canChangeCategory({ status: "active", category: "adherent" }, "active", true);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error).toContain("elecciones");
  });

  it("category change requires zero pending fees (REG-07, M4)", () => {
    const blocked = canChangeCategory({ status: "active", category: "adherent" }, "active", false, 3);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error).toContain("3 cuotas");
    expect(canChangeCategory({ status: "active", category: "adherent" }, "active", false, 0).ok).toBe(true);
  });

  it("suspension requires active status", () => {
    expect(canSuspend({ status: "active" }).ok).toBe(true);
    expect(canSuspend({ status: "suspended" }).ok).toBe(false);
  });

  it("readmission blocked for expelled members (REG-04) and non-withdrawn", () => {
    expect(canReadmit({ status: "withdrawn", reentryBlocked: false }).ok).toBe(true);
    const expelled = canReadmit({ status: "withdrawn", reentryBlocked: true });
    expect(expelled.ok).toBe(false);
    if (!expelled.ok) expect(expelled.error).toContain("expulsión");
    expect(canReadmit({ status: "active", reentryBlocked: false }).ok).toBe(false);
  });

  // El flag `reentryBlocked` no es la única fuente de verdad: una fila con motivo
  // de expulsión y el flag caído (import, arreglo manual, edición futura) tiene
  // que seguir bloqueada. La prohibición estatutaria es absoluta (REG-04).
  it("readmission blocked by an expulsion reason even if the flag is off (REG-04)", () => {
    const expelled = canReadmit({ status: "withdrawn", reentryBlocked: false, withdrawalReason: "expulsion" });
    expect(expelled.ok).toBe(false);
    if (!expelled.ok) expect(expelled.error).toContain("expulsión");
    expect(canReadmit({ status: "withdrawn", reentryBlocked: false, withdrawalReason: "arrears" }).ok).toBe(true);
  });
});
