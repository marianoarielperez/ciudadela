import { beforeEach, describe, expect, it, vi } from "vitest";

// Cableado del §7.1: después de un canje exitoso que emite invitación, la
// action manda el correo de la red ANTES de redirigir, en las dos ramas.
// `redirect` señaliza con una excepción: si el envío estuviera después, el mock
// que tira corta la action y `sendAfterVerification` no llega a llamarse — esa
// asimetría es lo que prueba el orden.
const h = vi.hoisted(() => {
  type Row = Record<string, unknown> | null;
  const state: { application: Row; member: Row } = { application: null, member: null };
  const tokens = {
    peek: vi.fn(async (): Promise<unknown> => null),
    consume: vi.fn(async (): Promise<unknown> => null),
    ownerOf: vi.fn(async (): Promise<unknown> => null),
    revokeForMember: vi.fn(async () => 0),
    issue: vi.fn(async () => "INVITE-NUEVA"),
  };
  const tx = {
    application: { findUnique: vi.fn(async () => state.application) },
    member: {
      findUnique: vi.fn(async () => state.member),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(state.member as Record<string, unknown>, data);
        return state.member;
      }),
    },
  };
  return {
    state, tokens, tx,
    applicationSvc: { verifyEmail: vi.fn(async () => {}) },
    // Las lecturas de `deadCopyFor` van por el cliente de arriba (fuera de la
    // transacción, que ya terminó sin escribir nada): el doble las sirve del mismo estado.
    prisma: {
      $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(tx)),
      application: { findUnique: vi.fn(async () => state.application) },
      member: { findUnique: vi.fn(async () => state.member) },
    },
    verifyEmail: vi.fn(),
    sendAfterVerification: vi.fn(async () => {}),
  };
});

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Map([["x-real-ip", "203.0.113.9"]])),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT:${url}`), { digest: `NEXT_REDIRECT;${url}` });
  }),
}));
vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));
vi.mock("@/lib/auth/rate-limiter", () => ({
  publicTokenLimiter: { check: vi.fn(() => true) },
}));
vi.mock("@/lib/tokens", () => ({
  tokens: h.tokens,
  makeTokens: vi.fn(() => h.tokens),
  MEMBER_EMAIL_TOKEN_PURPOSES: ["email_verification", "password_invitation"],
}));
vi.mock("@/lib/applications/service", async () => {
  const actual = await vi.importActual<typeof import("@/lib/applications/service")>(
    "@/lib/applications/service",
  );
  return {
    LIVE_APPLICATION_STATUSES: actual.LIVE_APPLICATION_STATUSES,
    makeApplicationService: vi.fn(() => h.applicationSvc),
  };
});
vi.mock("@/lib/members/access", async () => {
  const actual = await vi.importActual<typeof import("@/lib/members/access")>("@/lib/members/access");
  return {
    ACCESS_ERRORS: actual.ACCESS_ERRORS,
    APPLICATION_DEAD_COPY: actual.APPLICATION_DEAD_COPY,
    canRedeem: actual.canRedeem,
    deadVerificationCopy: actual.deadVerificationCopy,
    applyEmailVerification: actual.applyEmailVerification,
    memberAccess: { verifyEmail: h.verifyEmail },
  };
});
vi.mock("@/lib/members/invitation-email", () => ({
  invitationEmailer: { sendAfterVerification: h.sendAfterVerification },
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));

import { confirmEmailAction } from "@/app/(public)/verificar/[token]/actions";
import { APPLICATION_DEAD_COPY } from "@/lib/members/access";

const APP_EMAIL = "vecina@example.com";

function formDataFor(token = "RAW") {
  const fd = new FormData();
  fd.set("token", token);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  // `clearAllMocks` borra las llamadas pero NO las implementaciones: sin esto,
  // el `mockResolvedValue` de un describe sobrevive al siguiente y el resultado
  // depende del orden en que corren los bloques.
  h.tokens.peek.mockResolvedValue(null);
  h.tokens.consume.mockResolvedValue(null);
  h.state.application = null;
  h.state.member = null;
});

describe("rama de FICHA: la red viaja antes del redirect", () => {
  it("con invitación emitida, manda el correo y recién entonces redirige", async () => {
    h.verifyEmail.mockResolvedValue({ ok: true, memberId: 1, invite: "INV" });
    await expect(confirmEmailAction({}, formDataFor())).rejects.toThrow("NEXT_REDIRECT:/acceso/INV");
    expect(h.sendAfterVerification).toHaveBeenCalledExactlyOnceWith(1, "INV");
  });

  it("sin invitación (la ficha ya tenía cuenta) no manda nada", async () => {
    h.verifyEmail.mockResolvedValue({ ok: true, memberId: 1, invite: null });
    await expect(confirmEmailAction({}, formDataFor())).rejects.toThrow("NEXT_REDIRECT:/ingresar");
    expect(h.sendAfterVerification).not.toHaveBeenCalled();
  });

  it("con canje fallido no manda nada", async () => {
    h.verifyEmail.mockResolvedValue({ ok: false, error: "x" });
    const res = await confirmEmailAction({}, formDataFor());
    expect(res).toEqual({ error: "x" });
    expect(h.sendAfterVerification).not.toHaveBeenCalled();
  });
});

describe("rama de SOLICITUD asentada: misma red, mismo orden", () => {
  it("el canje tardío que alcanza la ficha también manda el correo", async () => {
    h.tokens.peek.mockResolvedValue({ applicationId: 5 });
    h.tokens.consume.mockResolvedValue({ applicationId: 5 });
    h.state.application = { id: 5, status: "completed", email: APP_EMAIL, memberId: 3 };
    h.state.member = { id: 3, status: "active", email: APP_EMAIL, userId: null };
    await expect(confirmEmailAction({}, formDataFor())).rejects.toThrow(
      "NEXT_REDIRECT:/acceso/INVITE-NUEVA",
    );
    expect(h.sendAfterVerification).toHaveBeenCalledExactlyOnceWith(3, "INVITE-NUEVA");
    // UN solo token: el del redirect es el mismo que viaja por correo. Un
    // segundo `issue` habría revocado al primero y roto el enlace del redirect.
    expect(h.tokens.issue).toHaveBeenCalledTimes(1);
  });

  it("si la ficha ya tenía cuenta, no hay invitación ni correo", async () => {
    h.tokens.peek.mockResolvedValue({ applicationId: 5 });
    h.tokens.consume.mockResolvedValue({ applicationId: 5 });
    h.state.application = { id: 5, status: "completed", email: APP_EMAIL, memberId: 3 };
    h.state.member = { id: 3, status: "active", email: APP_EMAIL, userId: 77 };
    await expect(confirmEmailAction({}, formDataFor())).rejects.toThrow("NEXT_REDIRECT:/ingresar");
    expect(h.sendAfterVerification).not.toHaveBeenCalled();
  });

  // Doble POST simultáneo (dos pestañas, o el reintento del cliente de correo):
  // el `peek` de los dos ve el token vivo y el UPDATE condicional del `consume`
  // lo gana exactamente uno. El PERDEDOR llega acá con la verificación ya hecha,
  // y el genérico le mandaría a pedir un reenvío que para una solicitud no
  // existe.
  it("el perdedor de un doble POST simultáneo no recibe el genérico imposible", async () => {
    h.tokens.peek.mockResolvedValue({ applicationId: 5 });
    h.tokens.consume.mockResolvedValue(null);
    h.state.application = { id: 5, status: "submitted", email: APP_EMAIL, memberId: null };
    expect(await confirmEmailAction({}, formDataFor())).toEqual({ error: APPLICATION_DEAD_COPY });
    expect(h.sendAfterVerification).not.toHaveBeenCalled();
  });
});
