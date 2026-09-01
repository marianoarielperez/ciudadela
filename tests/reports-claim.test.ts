// La llave del borrador (spec §5.1): 32 bytes de randomBytes en base64url, sólo
// el sha256 se persiste, y la forma se valida antes de consultar la base.
// También fija los cupos de los cuatro limitadores nuevos.
import { describe, expect, it, vi } from "vitest";

// `claim.ts` importa `hashToken` de @/lib/tokens, que importa @/lib/prisma
// (eager, explota sin .env) — mismo mock que tests/tokens.test.ts.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { hashClaim, isClaimShaped, mintClaim } from "@/lib/reports/claim";
import {
  REPORT_DRAFT_LIMIT, REPORT_MEMBER_LIMIT, REPORT_MEMBER_WINDOW_MS, REPORT_SUBMIT_LIMIT,
  REPORT_UPLOAD_LIMIT, REPORT_WINDOW_MS, reportDraftLimiter, reportMemberLimiter,
  reportSubmitLimiter, reportUploadLimiter,
} from "@/lib/auth/rate-limiter";

describe("claim", () => {
  it("acuña 43 caracteres base64url y un hash sha256 hex de 64", () => {
    const { raw, hash } = mintClaim();
    expect(raw).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashClaim(raw)).toBe(hash);
  });
  it("dos llaves no coinciden", () => {
    expect(mintClaim().raw).not.toBe(mintClaim().raw);
  });
  it("isClaimShaped rechaza lo que no tiene la forma", () => {
    expect(isClaimShaped(mintClaim().raw)).toBe(true);
    expect(isClaimShaped("")).toBe(false);
    expect(isClaimShaped("../etc/passwd")).toBe(false);
    expect(isClaimShaped("a".repeat(44))).toBe(false);
  });
});

describe("limitadores de Reportes", () => {
  it("cupos y ventanas fijados por la spec §7", () => {
    expect(REPORT_WINDOW_MS).toBe(60 * 60_000);
    expect(REPORT_MEMBER_WINDOW_MS).toBe(24 * 60 * 60_000);
    expect(reportDraftLimiter.limit).toBe(REPORT_DRAFT_LIMIT);
    expect(REPORT_DRAFT_LIMIT).toBe(5);
    expect(reportSubmitLimiter.limit).toBe(REPORT_SUBMIT_LIMIT);
    expect(REPORT_SUBMIT_LIMIT).toBe(5);
    expect(reportUploadLimiter.limit).toBe(REPORT_UPLOAD_LIMIT);
    expect(REPORT_UPLOAD_LIMIT).toBe(30);
    expect(reportMemberLimiter.limit).toBe(REPORT_MEMBER_LIMIT);
    expect(REPORT_MEMBER_LIMIT).toBe(5);
    expect(reportMemberLimiter.windowMs).toBe(REPORT_MEMBER_WINDOW_MS);
  });
});
