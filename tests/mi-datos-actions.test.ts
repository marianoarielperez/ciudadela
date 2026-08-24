// La invariante que este archivo fija: el memberId sale de requireMember(),
// NUNCA del formulario (mismo contrato que member-pay-action.test.ts), y el
// suspendido/bloqueado no escribe.
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireMember = vi.fn();
vi.mock("@/lib/auth/require-member", () => ({
  requireMember: (...a: unknown[]) => requireMember(...a),
}));
// La firma variádica (no `async () => ...`) es a propósito: `vi.fn` infiere el
// tipo del mock desde la implementación, y sin `..._args` acá TypeScript ve un
// mock de ARIDAD CERO — `npx vitest run` no lo nota (no tipa), pero
// `npm run build` sí, y `updateMember(...a)` de más abajo rompe con TS2556.
const updateMember = vi.fn(async (..._args: unknown[]) => ({
  member: {}, revokedTokens: 0, accountEmailMove: null, accountEmailUpdated: false,
}));
vi.mock("@/lib/members/write", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/members/write")>();
  return { ...real, memberWriter: { updateMember: (...a: unknown[]) => updateMember(...a) } };
});
vi.mock("@/lib/auth/rate-limiter", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/auth/rate-limiter")>();
  return { ...real, memberEditLimiter: { check: () => true } };
});
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("next/headers", () => ({ headers: async () => ({ get: () => "1.2.3.4" }) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    member: { findUniqueOrThrow: vi.fn(async () => ({ email: "vieja@x.com" })) },
    street: { findUnique: vi.fn(async () => ({ id: 3 })) },
  },
}));
vi.mock("@/lib/members/account-email-notice", () => ({
  accountEmailNotice: {
    announce: vi.fn(async () => ({
      previousNotified: true, verificationSent: true, throttled: false, failures: [],
    })),
  },
}));

import { updateAddressAction, updateContactAction } from "@/app/mi/datos/actions";

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

describe("updateContactAction", () => {
  it("rejects a blocked actor without touching the writer", async () => {
    requireMember.mockResolvedValue({ ok: false, reason: "suspended", error: "bloqueado" });
    const r = await updateContactAction({}, fd({ phone: "297" }));
    expect(r.error).toBe("bloqueado");
    expect(updateMember).not.toHaveBeenCalled();
  });

  it("writes to the actor's member, ignoring any memberId in the form", async () => {
    const r = await updateContactAction({}, fd({ phone: "2974", memberId: "999" }));
    expect(r.done).toBe(true);
    expect(updateMember).toHaveBeenCalledWith(7, { phone: "2974" });
  });

  it("does not ask requireMember for allowSuspended (the suspended cannot edit)", async () => {
    await updateContactAction({}, fd({ phone: "1" }));
    expect(requireMember).toHaveBeenCalledWith();
  });
});

describe("updateAddressAction", () => {
  it("writes the whitelist patch with the pending-review flag", async () => {
    const r = await updateAddressAction({}, fd({ streetId: "3", streetNumber: "742" }));
    expect(r.done).toBe(true);
    expect(updateMember).toHaveBeenCalledWith(7, {
      streetId: 3, streetText: null, streetNumber: "742", neighborhood: null,
      addressPendingReview: true,
    });
  });

  it("rejects a streetId outside the catalog", async () => {
    const { prisma } = await import("@/lib/prisma");
    vi.mocked(prisma.street.findUnique).mockResolvedValueOnce(null as never);
    const r = await updateAddressAction({}, fd({ streetId: "99" }));
    expect(r.error).toBeTruthy();
    expect(updateMember).not.toHaveBeenCalled();
  });
});
