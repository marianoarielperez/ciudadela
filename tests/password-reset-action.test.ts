import { beforeEach, describe, expect, it, vi } from "vitest";

// Cableado de `resetPasswordAction`
// (src/app/(public)/ingresar/restablecer/[token]/actions.ts). Misma técnica que
// tests/send-verification-action.test.ts: la action usa los singletones de
// producción, así que se mockean módulo por módulo.

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Map([["x-real-ip", "203.0.113.7"]])),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    // `redirect` señaliza con una excepción: replicarlo es lo que prueba que la
    // action no siga escribiendo después.
    throw Object.assign(new Error(`NEXT_REDIRECT:${url}`), { digest: `NEXT_REDIRECT;${url}` });
  }),
}));

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

vi.mock("@/lib/auth/password-reset", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/password-reset")>(
    "@/lib/auth/password-reset",
  );
  return { RESET_ERRORS: actual.RESET_ERRORS, passwordReset: { reset: vi.fn() } };
});

vi.mock("@/lib/auth/rate-limiter", () => ({
  publicTokenLimiter: { check: vi.fn(() => true) },
}));

vi.mock("@/lib/tokens", () => ({ tokens: { peek: vi.fn(async () => ({ id: 1, userId: 7 })) } }));

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));

import { resetPasswordAction } from "@/app/(public)/ingresar/restablecer/[token]/actions";
import { audit } from "@/lib/audit";
import { RESET_ERRORS, passwordReset } from "@/lib/auth/password-reset";
import { publicTokenLimiter } from "@/lib/auth/rate-limiter";
import { tokens } from "@/lib/tokens";

type MockedFn = ReturnType<typeof vi.fn>;

function formDataFor(over: { token?: string; password?: string; confirm?: string } = {}) {
  const fd = new FormData();
  fd.set("token", over.token ?? "RAW");
  fd.set("password", over.password ?? "contraseña-larga");
  fd.set("confirm", over.confirm ?? over.password ?? "contraseña-larga");
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  (publicTokenLimiter.check as MockedFn).mockReturnValue(true);
  (tokens.peek as MockedFn).mockResolvedValue({ id: 1, userId: 7 });
});

describe("resetPasswordAction", () => {
  it("writes the new password, audits it and sends the member to the login", async () => {
    (passwordReset.reset as MockedFn).mockResolvedValueOnce({ ok: true, userId: 7 });

    await expect(resetPasswordAction({}, formDataFor())).rejects.toThrow(
      "NEXT_REDIRECT:/ingresar?cuenta=restablecida",
    );

    const [rawToken, hash] = (passwordReset.reset as MockedFn).mock.calls[0]!;
    expect(rawToken).toBe("RAW");
    // El hash se calcula en la action y viaja ya hecho: bcrypt de costo 12 no
    // puede correr con la transacción abierta.
    expect(String(hash)).toMatch(/^\$2[aby]\$12\$/);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 7, action: "password_reset_completed", ip: "203.0.113.7" }),
    );
  });

  it("keeps a mistyped confirmation from costing quota or burning the link", async () => {
    const res = await resetPasswordAction({}, formDataFor({ password: "contraseña-larga", confirm: "otra-cosa" }));

    expect(res.error).toBeTruthy();
    expect(publicTokenLimiter.check).not.toHaveBeenCalled();
    expect(passwordReset.reset).not.toHaveBeenCalled();
  });

  it("rejects a password shorter than the minimum before touching the token", async () => {
    const res = await resetPasswordAction({}, formDataFor({ password: "corta" }));

    expect(res.error).toContain("8");
    expect(passwordReset.reset).not.toHaveBeenCalled();
  });

  it("checks the link with peek before paying for the bcrypt", async () => {
    (tokens.peek as MockedFn).mockResolvedValueOnce(null);
    const res = await resetPasswordAction({}, formDataFor());

    expect(res).toEqual({ error: RESET_ERRORS.dead });
    expect(passwordReset.reset).not.toHaveBeenCalled();
  });

  it("blocks the origin that ran out of quota without redeeming anything", async () => {
    (publicTokenLimiter.check as MockedFn).mockReturnValue(false);
    const res = await resetPasswordAction({}, formDataFor());

    expect(res.error).toBeTruthy();
    expect(tokens.peek).not.toHaveBeenCalled();
    expect(passwordReset.reset).not.toHaveBeenCalled();
  });

  it("hands back the rejection of the redemption and audits the reason", async () => {
    (passwordReset.reset as MockedFn).mockResolvedValueOnce({
      ok: false,
      error: RESET_ERRORS.disabled,
      reason: "disabled",
    });

    const res = await resetPasswordAction({}, formDataFor());

    expect(res).toEqual({ error: RESET_ERRORS.disabled });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "password_reset_failed", detail: { reason: "disabled" } }),
    );
  });
});
