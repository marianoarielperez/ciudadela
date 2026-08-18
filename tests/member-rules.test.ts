import { describe, expect, it } from "vitest";
import { canChangeCategory, canReadmit, canSuspend, canWithdraw, hasArrearsDebt } from "@/lib/members/rules";

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

  it("arrears debt flag (REG-16 placeholder)", () => {
    expect(hasArrearsDebt({ withdrawalReason: "arrears", debtAtWithdrawal: true })).toBe(true);
    expect(hasArrearsDebt({ withdrawalReason: "death", debtAtWithdrawal: false })).toBe(false);
  });
});
