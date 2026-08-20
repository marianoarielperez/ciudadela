import { beforeEach, describe, expect, it, vi } from "vitest";

// Cableado de `confirmEmailAction` (src/app/(public)/verificar/[token]/actions.ts)
// cuando el token pertenece a una SOLICITUD y no a una ficha. Misma técnica que
// tests/password-reset-action.test.ts: la action usa los singletones de
// producción, así que se mockean módulo por módulo.
//
// Lo que este archivo protege son DOS cosas a la vez: que la rama nueva (M3)
// haga lo suyo, y que la rama vieja —el canje de socios del M1, que ya corre en
// producción— siga llamando exactamente lo mismo que llamaba antes.

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Map([["x-real-ip", "203.0.113.9"]])),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    // `redirect` señaliza con una excepción: replicarlo es lo que prueba que la
    // action no siga escribiendo después.
    throw Object.assign(new Error(`NEXT_REDIRECT:${url}`), { digest: `NEXT_REDIRECT;${url}` });
  }),
}));

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

vi.mock("@/lib/auth/rate-limiter", () => ({
  publicTokenLimiter: { check: vi.fn(() => true) },
}));

vi.mock("@/lib/tokens", () => ({
  tokens: { peek: vi.fn(async () => null), consume: vi.fn(async () => null) },
}));

vi.mock("@/lib/applications/service", () => ({
  applicationService: { verifyEmail: vi.fn(async () => {}) },
}));

vi.mock("@/lib/members/access", async () => {
  const actual = await vi.importActual<typeof import("@/lib/members/access")>("@/lib/members/access");
  return { ACCESS_ERRORS: actual.ACCESS_ERRORS, memberAccess: { verifyEmail: vi.fn() } };
});

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));

import { confirmEmailAction } from "@/app/(public)/verificar/[token]/actions";
import { applicationService } from "@/lib/applications/service";
import { audit } from "@/lib/audit";
import { publicTokenLimiter } from "@/lib/auth/rate-limiter";
import { memberAccess } from "@/lib/members/access";
import { tokens } from "@/lib/tokens";

type MockedFn = ReturnType<typeof vi.fn>;

const APP_EMAIL = "vecina@example.com";

function formDataFor(token = "RAW") {
  const fd = new FormData();
  fd.set("token", token);
  return fd;
}

/** Token de SOLICITUD tal como lo emite el wizard (Task 11). */
function applicationToken(applicationId = 55) {
  return { id: 1, purpose: "email_verification", memberId: null, userId: null, applicationId };
}

/** Token de FICHA: el del circuito del M1, sin `applicationId`. */
function memberToken(memberId = 7) {
  return { id: 2, purpose: "email_verification", memberId, userId: null, applicationId: null };
}

beforeEach(() => {
  vi.clearAllMocks();
  (publicTokenLimiter.check as MockedFn).mockReturnValue(true);
  (tokens.peek as MockedFn).mockResolvedValue(null);
  (tokens.consume as MockedFn).mockResolvedValue(null);
});

describe("confirmEmailAction — token de solicitud", () => {
  it("verifies the application and never touches the member circuit", async () => {
    (tokens.peek as MockedFn).mockResolvedValue(applicationToken(55));
    (tokens.consume as MockedFn).mockResolvedValue(applicationToken(55));

    const res = await confirmEmailAction({}, formDataFor());

    expect(res).toEqual({ verified: "application" });
    // El `consume` sigue siendo del POST y sólo del POST (el GET hace `peek`).
    expect(tokens.consume).toHaveBeenCalledWith("RAW", "email_verification");
    expect(applicationService.verifyEmail).toHaveBeenCalledWith(55);
    // La rama de socios ni se roza: no hay ficha que verificar todavía.
    expect(memberAccess.verifyEmail).not.toHaveBeenCalled();
  });

  it("audits the verification without a single personal datum", async () => {
    (tokens.peek as MockedFn).mockResolvedValue(applicationToken(55));
    (tokens.consume as MockedFn).mockResolvedValue(applicationToken(55));

    await confirmEmailAction({}, formDataFor());

    expect(audit).toHaveBeenCalledTimes(1);
    const entry = (audit as MockedFn).mock.calls[0]![0] as Record<string, unknown>;
    expect(entry).toMatchObject({
      action: "application_email_verified",
      entity: "application",
      entityId: 55,
      ip: "203.0.113.9",
    });
    // Ni el email, ni el token, ni ningún dato de la persona: la solicitud ya
    // queda identificada por su id (docs/08, Ley 25.326).
    const serialized = JSON.stringify(entry);
    expect(serialized).not.toContain(APP_EMAIL);
    expect(serialized).not.toContain("RAW");
    expect(entry.detail).toBeUndefined();
  });

  it("does not write twice when the link is clicked a second time", async () => {
    (tokens.peek as MockedFn).mockResolvedValue(applicationToken(55));
    // El UPDATE condicional de `consume` ya lo ganó el primer click.
    (tokens.consume as MockedFn).mockResolvedValue(null);

    const res = await confirmEmailAction({}, formDataFor());

    expect(res.error).toBeTruthy();
    expect(res.verified).toBeUndefined();
    expect(applicationService.verifyEmail).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });
});

describe("confirmEmailAction — token de ficha (circuito M1 intacto)", () => {
  it("still redeems through memberAccess, audits the member and redirects to the invitation", async () => {
    (tokens.peek as MockedFn).mockResolvedValue(memberToken(7));
    (memberAccess.verifyEmail as MockedFn).mockResolvedValue({ ok: true, memberId: 7, invite: "INVITE" });

    await expect(confirmEmailAction({}, formDataFor())).rejects.toThrow("NEXT_REDIRECT:/acceso/INVITE");

    // El consumo del token de ficha sigue ocurriendo DENTRO de la transacción de
    // `memberAccess.verifyEmail` y no en la action: `tokens.consume` no se toca.
    expect(memberAccess.verifyEmail).toHaveBeenCalledWith("RAW");
    expect(tokens.consume).not.toHaveBeenCalled();
    expect(applicationService.verifyEmail).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "member_email_verified", entity: "member", entityId: 7, ip: "203.0.113.9",
      }),
    );
  });

  it("still redirects to the login when the member already had an account", async () => {
    (tokens.peek as MockedFn).mockResolvedValue(memberToken(7));
    (memberAccess.verifyEmail as MockedFn).mockResolvedValue({ ok: true, memberId: 7, invite: null });

    await expect(confirmEmailAction({}, formDataFor())).rejects.toThrow("NEXT_REDIRECT:/ingresar");
  });

  it("still hands back the rejection of the redemption without auditing", async () => {
    (tokens.peek as MockedFn).mockResolvedValue(memberToken(7));
    (memberAccess.verifyEmail as MockedFn).mockResolvedValue({ ok: false, error: "El enlace venció." });

    const res = await confirmEmailAction({}, formDataFor());

    expect(res).toEqual({ error: "El enlace venció." });
    expect(audit).not.toHaveBeenCalled();
  });

  it("still spends the rate limit before redeeming anything", async () => {
    (publicTokenLimiter.check as MockedFn).mockReturnValue(false);

    const res = await confirmEmailAction({}, formDataFor());

    expect(res.error).toBeTruthy();
    expect(tokens.peek).not.toHaveBeenCalled();
    expect(tokens.consume).not.toHaveBeenCalled();
    expect(memberAccess.verifyEmail).not.toHaveBeenCalled();
    expect(applicationService.verifyEmail).not.toHaveBeenCalled();
  });
});
