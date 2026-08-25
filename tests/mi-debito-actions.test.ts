// La invariante que este archivo fija: el memberId sale de requireMember(),
// NUNCA del formulario (mismo contrato que mi-datos-actions.test.ts). Las dos
// actions llaman a requireMember() SIN allowSuspended: el suspendido no
// adhiere NI cancela (REG-20) — la página en cambio sí lo deja VER (usa
// `{ allowSuspended: true }`), pero eso es harina de otro archivo.
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireMember = vi.fn();
vi.mock("@/lib/auth/require-member", () => ({
  requireMember: (...a: unknown[]) => requireMember(...a),
}));

const start = vi.fn();
const cancel = vi.fn();
vi.mock("@/lib/members/member-debit", () => ({
  memberDebit: { start: (...a: unknown[]) => start(...a), cancel: (...a: unknown[]) => cancel(...a) },
}));

vi.mock("@/lib/auth/rate-limiter", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/auth/rate-limiter")>();
  return { ...real, memberPayLimiter: { check: () => true } };
});

// La firma variádica (no `async () => {}`) es a propósito: sin ella TS ve un
// mock de ARIDAD CERO (`npx vitest run` no lo nota, `npm run build` sí — mismo
// aviso que deja `mi-datos-actions.test.ts`), y el `(...a) => audit(...a)` de
// abajo revienta con TS2556.
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- la firma existe para tipar, no para leerse
const audit = vi.fn(async (..._args: unknown[]) => {});
vi.mock("@/lib/audit", () => ({ audit: (...a: unknown[]) => audit(...a) }));
vi.mock("next/headers", () => ({ headers: async () => ({ get: () => "1.2.3.4" }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { cancelDebitAction, startDebitAction } from "@/app/mi/debito/actions";

const OK_ACTOR = { ok: true, userId: 9, memberId: 7, fullName: "Socia", suspension: null };
const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

beforeEach(() => {
  vi.clearAllMocks();
  requireMember.mockResolvedValue(OK_ACTOR);
});

describe("startDebitAction", () => {
  it("rejects a blocked actor without touching the service", async () => {
    requireMember.mockResolvedValue({ ok: false, reason: "suspended", error: "bloqueado" });
    const r = await startDebitAction({}, fd({}));
    expect(r.error).toBe("bloqueado");
    expect(start).not.toHaveBeenCalled();
  });

  it("does not ask requireMember for allowSuspended (the suspended cannot adhere)", async () => {
    start.mockResolvedValue({ ok: true, checkoutUrl: "https://mp.example/x" });
    await startDebitAction({}, fd({}));
    expect(requireMember).toHaveBeenCalledWith();
  });

  it("starts the service with the actor's memberId", async () => {
    start.mockResolvedValue({ ok: true, checkoutUrl: "https://mp.example/x" });
    await startDebitAction({}, fd({}));
    expect(start).toHaveBeenCalledWith({ memberId: 7 });
  });

  it("returns the checkout URL from the service", async () => {
    start.mockResolvedValue({ ok: true, checkoutUrl: "https://mp.example/checkout/abc" });
    const r = await startDebitAction({}, fd({}));
    expect(r.redirectUrl).toBe("https://mp.example/checkout/abc");
    expect(r.error).toBeUndefined();
  });

  it("surfaces the service's error without calling audit", async () => {
    start.mockResolvedValue({ ok: false, error: "Ya tenés un débito automático activo." });
    const r = await startDebitAction({}, fd({}));
    expect(r.error).toBe("Ya tenés un débito automático activo.");
    expect(audit).not.toHaveBeenCalled();
  });

  it("audits the adhesion without the checkout URL anywhere in the detail", async () => {
    start.mockResolvedValue({ ok: true, checkoutUrl: "https://mp.example/checkout/abc" });
    await startDebitAction({}, fd({}));
    expect(audit).toHaveBeenCalledTimes(1);
    const call = audit.mock.calls[0][0] as Record<string, unknown>;
    expect(call.action).toBe("member_debit_adhesion");
    expect(JSON.stringify(call.detail)).not.toContain("mp.example");
    expect(call.detail).toEqual({ memberId: 7 });
  });
});

describe("cancelDebitAction", () => {
  it("rejects a blocked actor without touching the service", async () => {
    requireMember.mockResolvedValue({ ok: false, reason: "suspended", error: "bloqueado" });
    const r = await cancelDebitAction({}, fd({ preapprovalId: "abc123" }));
    expect(r.error).toBe("bloqueado");
    expect(cancel).not.toHaveBeenCalled();
  });

  it("does not ask requireMember for allowSuspended (the suspended cannot cancel)", async () => {
    cancel.mockResolvedValue({ ok: true });
    await cancelDebitAction({}, fd({ preapprovalId: "abc123" }));
    expect(requireMember).toHaveBeenCalledWith();
  });

  it("passes the preapprovalId from the form and the memberId from the actor", async () => {
    cancel.mockResolvedValue({ ok: true });
    await cancelDebitAction({}, fd({ preapprovalId: "abc123" }));
    expect(cancel).toHaveBeenCalledWith({ memberId: 7, preapprovalId: "abc123" });
  });

  it("rejects a malformed preapprovalId without calling the service", async () => {
    const r = await cancelDebitAction({}, fd({ preapprovalId: "../../etc" }));
    expect(r.error).toBeTruthy();
    expect(cancel).not.toHaveBeenCalled();
  });

  it("surfaces the service's error without calling audit", async () => {
    cancel.mockResolvedValue({ ok: false, error: "La suscripción no existe." });
    const r = await cancelDebitAction({}, fd({ preapprovalId: "abc123" }));
    expect(r.error).toBe("La suscripción no existe.");
    expect(audit).not.toHaveBeenCalled();
  });

  it("audits the cancellation with the preapprovalId and returns done", async () => {
    cancel.mockResolvedValue({ ok: true });
    const r = await cancelDebitAction({}, fd({ preapprovalId: "abc123" }));
    expect(r.done).toBe(true);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "member_debit_cancel", detail: { preapprovalId: "abc123" } }),
    );
  });
});
