import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  verifyEmail: vi.fn(),
  ownerOf: vi.fn(async (): Promise<unknown> => null),
  memberFindUnique: vi.fn(async (): Promise<unknown> => null),
  applicationFindUnique: vi.fn(async (): Promise<unknown> => null),
  sendAfterVerification: vi.fn(async () => {}),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Map([["x-real-ip", "203.0.113.9"]])),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT:${url}`), { digest: `NEXT_REDIRECT;${url}` });
  }),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    member: { findUnique: h.memberFindUnique },
    application: { findUnique: h.applicationFindUnique },
  },
}));
vi.mock("@/lib/auth/rate-limiter", () => ({
  publicTokenLimiter: { check: vi.fn(() => true) },
}));
vi.mock("@/lib/tokens", () => ({
  tokens: { peek: vi.fn(async () => null), ownerOf: h.ownerOf },
  makeTokens: vi.fn(),
  MEMBER_EMAIL_TOKEN_PURPOSES: ["email_verification", "password_invitation"],
}));
vi.mock("@/lib/applications/service", async () => {
  const actual = await vi.importActual<typeof import("@/lib/applications/service")>(
    "@/lib/applications/service",
  );
  return { LIVE_APPLICATION_STATUSES: actual.LIVE_APPLICATION_STATUSES, makeApplicationService: vi.fn() };
});
vi.mock("@/lib/members/access", async () => {
  const actual = await vi.importActual<typeof import("@/lib/members/access")>("@/lib/members/access");
  return { ...actual, memberAccess: { verifyEmail: h.verifyEmail } };
});
vi.mock("@/lib/members/invitation-email", () => ({
  invitationEmailer: { sendAfterVerification: h.sendAfterVerification },
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));

import { confirmEmailAction } from "@/app/(public)/verificar/[token]/actions";
import { ACCESS_ERRORS, APPLICATION_DEAD_COPY, deadVerificationCopy } from "@/lib/members/access";

function formDataFor(token = "RAW") {
  const fd = new FormData();
  fd.set("token", token);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.ownerOf.mockResolvedValue(null);
  h.memberFindUnique.mockResolvedValue(null);
  h.applicationFindUnique.mockResolvedValue(null);
});

// La tabla entera de casos, sin base (patrón de eligibility.ts). La única
// combinación que gana el texto nuevo es la del incidente: verificado, sin
// cuenta, y no dado de baja. Todo lo demás conserva el genérico.
describe("deadVerificationCopy (§7.2)", () => {
  const CASES: Array<{
    name: string;
    member: { status: string; emailStatus: string; userId: number | null } | null;
    expected: string;
  }> = [
    {
      name: "verificado y sin cuenta (el incidente): dice la verdad",
      member: { status: "active", emailStatus: "verified", userId: null },
      expected: ACCESS_ERRORS.verifiedNoAccount,
    },
    {
      name: "suspendido cuenta igual: sigue siendo socio y puede crear su cuenta",
      member: { status: "suspended", emailStatus: "verified", userId: null },
      expected: ACCESS_ERRORS.verifiedNoAccount,
    },
    {
      name: "con cuenta creada: el trámite terminó, el genérico es correcto",
      member: { status: "active", emailStatus: "verified", userId: 7 },
      expected: ACCESS_ERRORS.dead,
    },
    {
      name: "sin verificar: no hay verdad nueva que contar",
      member: { status: "active", emailStatus: "declared", userId: null },
      expected: ACCESS_ERRORS.dead,
    },
    {
      name: "dado de baja: no se le promete ningún camino",
      member: { status: "withdrawn", emailStatus: "verified", userId: null },
      expected: ACCESS_ERRORS.dead,
    },
    { name: "ficha inexistente", member: null, expected: ACCESS_ERRORS.dead },
  ];

  for (const c of CASES) {
    it(c.name, () => {
      expect(deadVerificationCopy(c.member as never)).toBe(c.expected);
    });
  }

  // Mismos candados que el resto del copy de canje (redeem-pages.test.ts):
  // voseo, sin hueco de interpolación, sin dirección ni nombre.
  it("el texto nuevo respeta los candados del copy público", () => {
    const text = ACCESS_ERRORS.verifiedNoAccount;
    expect(text).toContain("Buscá");
    expect(text).not.toMatch(/\$\{|\{\{|%s/);
    expect(text).not.toContain("@");
    // NO afirma que el correo salió (el envío es best-effort): manda a buscarlo.
    expect(text).not.toMatch(/te mandamos|te enviamos/i);
    // Y tampoco AFIRMA un desenlace. El socio de casilla compartida llega a
    // este mismo estado —`verifyEmail` marca `verified` antes de que exista la
    // guarda de conflicto, que vive en `createPassword`— y su alta de
    // contraseña rebota con ACCESS_ERRORS.conflict. El texto manda al correo
    // cuyo enlace lleva a /acceso, que es donde espera el formulario O la
    // explicación honesta; nombrarle el asunto real es lo que le permite
    // encontrarlo.
    expect(text).toContain("«Creá tu contraseña»");
    expect(text).not.toMatch(/lo que falta|vas a poder|ya podés/i);
  });
});

describe("el segundo POST del incidente (§7.2, cableado de la action)", () => {
  it("token usado + ficha verificada sin cuenta → el texto que dice la verdad", async () => {
    h.verifyEmail.mockResolvedValue({ ok: false, error: ACCESS_ERRORS.dead });
    h.ownerOf.mockResolvedValue({ memberId: 106, applicationId: null });
    h.memberFindUnique.mockResolvedValue({ status: "active", emailStatus: "verified", userId: null });
    const res = await confirmEmailAction({}, formDataFor());
    expect(res).toEqual({ error: ACCESS_ERRORS.verifiedNoAccount });
    // La rama informa, no envía: ningún correo sale de acá.
    expect(h.sendAfterVerification).not.toHaveBeenCalled();
  });

  it("token usado de una ficha que YA tiene cuenta → el genérico de siempre", async () => {
    h.verifyEmail.mockResolvedValue({ ok: false, error: ACCESS_ERRORS.dead });
    h.ownerOf.mockResolvedValue({ memberId: 106, applicationId: null });
    h.memberFindUnique.mockResolvedValue({ status: "active", emailStatus: "verified", userId: 9 });
    expect(await confirmEmailAction({}, formDataFor())).toEqual({ error: ACCESS_ERRORS.dead });
  });

  it("token sin rastro → el genérico, sin consultas de ficha", async () => {
    h.verifyEmail.mockResolvedValue({ ok: false, error: ACCESS_ERRORS.dead });
    expect(await confirmEmailAction({}, formDataFor())).toEqual({ error: ACCESS_ERRORS.dead });
    expect(h.memberFindUnique).not.toHaveBeenCalled();
  });

  it("un rechazo que NO es 'dead' (baja) no toca la rama nueva", async () => {
    h.verifyEmail.mockResolvedValue({ ok: false, error: ACCESS_ERRORS.withdrawn });
    expect(await confirmEmailAction({}, formDataFor())).toEqual({ error: ACCESS_ERRORS.withdrawn });
    expect(h.ownerOf).not.toHaveBeenCalled();
  });
});

// Un token de SOLICITUD que llega muerto a la rama de ficha (el `peek` no lo
// resolvió: ya estaba usado o vencido). El genérico de `ACCESS_ERRORS.dead`
// manda a "pedí a la vecinal que te lo reenvíe", y para una solicitud ese
// reenvío NO EXISTE — ver el comentario de `ownerOf` en `@/lib/tokens`.
describe("enlace muerto de una SOLICITUD (§7.2, la rama que faltaba)", () => {
  beforeEach(() => {
    h.verifyEmail.mockResolvedValue({ ok: false, error: ACCESS_ERRORS.dead });
    h.ownerOf.mockResolvedValue({ memberId: null, applicationId: 5 });
  });

  it("la solicitud ya se asentó y su ficha quedó verificada sin cuenta → la verdad", async () => {
    h.applicationFindUnique.mockResolvedValue({ memberId: 3 });
    h.memberFindUnique.mockResolvedValue({ status: "active", emailStatus: "verified", userId: null });
    expect(await confirmEmailAction({}, formDataFor())).toEqual({
      error: ACCESS_ERRORS.verifiedNoAccount,
    });
  });

  it("la ficha de la solicitud YA tiene cuenta → el texto de solicitud, nunca el genérico", async () => {
    h.applicationFindUnique.mockResolvedValue({ memberId: 3 });
    h.memberFindUnique.mockResolvedValue({ status: "active", emailStatus: "verified", userId: 9 });
    // El genérico prometería un reenvío que para este circuito no existe.
    expect(await confirmEmailAction({}, formDataFor())).toEqual({ error: APPLICATION_DEAD_COPY });
  });

  it("la solicitud todavía no tiene ficha (viva o cerrada) → el texto de solicitud", async () => {
    h.applicationFindUnique.mockResolvedValue({ memberId: null });
    expect(await confirmEmailAction({}, formDataFor())).toEqual({ error: APPLICATION_DEAD_COPY });
    expect(h.memberFindUnique).not.toHaveBeenCalled();
  });
});
