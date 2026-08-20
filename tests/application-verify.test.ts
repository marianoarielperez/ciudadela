import { beforeEach, describe, expect, it, vi } from "vitest";

// Cableado de `confirmEmailAction` (src/app/(public)/verificar/[token]/actions.ts)
// cuando el token pertenece a una SOLICITUD y no a una ficha. Misma técnica que
// tests/password-reset-action.test.ts: la action usa los singletones de
// producción, así que se mockean módulo por módulo.
//
// Lo que este archivo protege son TRES cosas: que la rama nueva (M3) haga lo
// suyo según el estado de la solicitud, que la verificación TARDÍA —la que llega
// después del asiento— alcance la ficha y su invitación al portal, y que la rama
// vieja —el canje de socios del M1, que ya corre en producción— siga llamando
// exactamente lo mismo que llamaba antes.

// Las piezas que la action usa DENTRO de la transacción se arman acá para poder
// referenciarlas desde los factories de `vi.mock`, que se hoistean.
const h = vi.hoisted(() => {
  type Row = Record<string, unknown> | null;
  const state: { application: Row; member: Row } = { application: null, member: null };

  const tokens = {
    peek: vi.fn(async (): Promise<unknown> => null),
    consume: vi.fn(async (): Promise<unknown> => null),
    ownerOf: vi.fn(async (): Promise<unknown> => null),
    // Las usa `applyEmailVerification`, que en estos tests corre DE VERDAD.
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
    state,
    tokens,
    tx,
    applicationSvc: { verifyEmail: vi.fn(async () => {}) },
    // Un passthrough alcanza para lo que se assertea acá: que el canje entero
    // corra DENTRO de un `$transaction` y que las dos escrituras se hagan con
    // los factories atados a ESE `tx`. La atomicidad de verdad la da la base.
    prisma: { $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(tx)) },
  };
});

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
    // La lista de estados vivos es la de producción a propósito: si mañana se
    // agrega uno, estos tests tienen que verlo.
    LIVE_APPLICATION_STATUSES: actual.LIVE_APPLICATION_STATUSES,
    makeApplicationService: vi.fn(() => h.applicationSvc),
  };
});

// `memberAccess` se mockea (es el canje de FICHA, que tiene su propia suite en
// tests/member-access.test.ts), pero `canRedeem` y `applyEmailVerification` son
// los DE VERDAD: son justamente la pieza compartida que la verificación tardía
// reusa, y mockearla dejaría sin probar lo único que este fix agrega.
vi.mock("@/lib/members/access", async () => {
  const actual = await vi.importActual<typeof import("@/lib/members/access")>("@/lib/members/access");
  return {
    ACCESS_ERRORS: actual.ACCESS_ERRORS,
    canRedeem: actual.canRedeem,
    applyEmailVerification: actual.applyEmailVerification,
    memberAccess: { verifyEmail: vi.fn() },
  };
});

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));

import { confirmEmailAction } from "@/app/(public)/verificar/[token]/actions";
import { VERIFIED } from "@/app/(public)/verificar/[token]/confirm-form";
import { makeApplicationService } from "@/lib/applications/service";
import { audit } from "@/lib/audit";
import { publicTokenLimiter } from "@/lib/auth/rate-limiter";
import { memberAccess } from "@/lib/members/access";
import { makeTokens, tokens } from "@/lib/tokens";

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

/** Deja el enlace de una solicitud vivo y canjeable, con la solicitud (y, si se
 *  pide, la ficha ya asentada) en el estado que el caso necesita. */
function seedApplication(
  application: Record<string, unknown> = {},
  member: Record<string, unknown> | null = null,
) {
  (tokens.peek as MockedFn).mockResolvedValue(applicationToken(55));
  (tokens.consume as MockedFn).mockResolvedValue(applicationToken(55));
  h.state.application = {
    id: 55, status: "pending_board", email: APP_EMAIL, memberId: null, ...application,
  };
  h.state.member = member && {
    id: 12, status: "active", email: APP_EMAIL, emailStatus: "declared",
    emailVerifiedAt: null, userId: null, ...member,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (publicTokenLimiter.check as MockedFn).mockReturnValue(true);
  (tokens.peek as MockedFn).mockResolvedValue(null);
  (tokens.consume as MockedFn).mockResolvedValue(null);
  (tokens.issue as MockedFn).mockResolvedValue("INVITE-NUEVA");
  h.state.application = null;
  h.state.member = null;
});

describe("confirmEmailAction — solicitud VIVA", () => {
  it("verifies the application and never touches the member circuit", async () => {
    seedApplication({ status: "pending_board" });

    const res = await confirmEmailAction({}, formDataFor());

    expect(res).toEqual({ verified: "pending" });
    // El `consume` sigue siendo del POST y sólo del POST (el GET hace `peek`).
    expect(tokens.consume).toHaveBeenCalledWith("RAW", "email_verification", expect.any(Date));
    expect(h.applicationSvc.verifyEmail).toHaveBeenCalledWith(55, expect.any(Date));
    // La rama de socios ni se roza: no hay ficha que verificar todavía.
    expect(memberAccess.verifyEmail).not.toHaveBeenCalled();
    expect(h.tx.member.update).not.toHaveBeenCalled();
    expect(tokens.issue).not.toHaveBeenCalled();
  });

  // Un reingreso trae `memberId` desde el `create` (REG-25): la ficha existe
  // pero el asiento todavía no ocurrió, así que no hay nada que propagar.
  it("does not propagate to the card of a live application that already points at one", async () => {
    seedApplication({ status: "pending_payment", memberId: 12 }, {});

    expect(await confirmEmailAction({}, formDataFor())).toEqual({ verified: "pending" });
    expect(h.tx.member.findUnique).not.toHaveBeenCalled();
    expect(h.tx.member.update).not.toHaveBeenCalled();
  });

  it("audits the verification without a single personal datum", async () => {
    seedApplication();

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
    seedApplication();
    // El UPDATE condicional de `consume` ya lo ganó el primer click.
    (tokens.consume as MockedFn).mockResolvedValue(null);

    const res = await confirmEmailAction({}, formDataFor());

    expect(res.error).toBeTruthy();
    expect(res.verified).toBeUndefined();
    expect(h.applicationSvc.verifyEmail).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  // El canje partido en dos (consume commiteado, después el UPDATE) dejaba el
  // enlace quemado y `emailVerifiedAt` en null para siempre si el segundo paso
  // fallaba: el token de una solicitud se emite UNA vez y no hay reenvío.
  it("burns the token and writes inside one transaction", async () => {
    seedApplication();

    await confirmEmailAction({}, formDataFor());

    expect(h.prisma.$transaction).toHaveBeenCalledTimes(1);
    // Y las dos escrituras van con los factories atados a ESE `tx`, no con los
    // singletones de producción.
    expect(makeTokens).toHaveBeenCalledWith(h.tx);
    expect(makeApplicationService).toHaveBeenCalledWith(h.tx);
  });
});

describe("confirmEmailAction — solicitud YA ASENTADA (verificación tardía)", () => {
  // El agujero que cierra el fix: el vecino no hizo clic en el correo, completó
  // el wizard, la CD asentó el alta —la ficha nace `declared`, así que el
  // asiento NO le mandó la invitación— y recién entonces abre el enlace.
  it("propagates the verification to the card and hands over the portal invitation", async () => {
    seedApplication({ status: "completed", memberId: 12 }, {});

    await expect(confirmEmailAction({}, formDataFor())).rejects.toThrow("NEXT_REDIRECT:/acceso/INVITE-NUEVA");

    expect(h.state.member).toMatchObject({ emailStatus: "verified" });
    expect((h.state.member as { emailVerifiedAt: Date }).emailVerifiedAt).toBeInstanceOf(Date);
    // Un enlace vivo por socio: la invitación se emite después de revocar.
    expect(tokens.revokeForMember).toHaveBeenCalledWith(12, ["email_verification", "password_invitation"]);
    expect(tokens.issue).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: "password_invitation", memberId: 12 }),
    );
    // Los dos hechos quedan asentados: la solicitud y la ficha.
    expect((audit as MockedFn).mock.calls.map((c) => (c[0] as { action: string }).action)).toEqual([
      "application_email_verified", "member_email_verified",
    ]);
    expect(audit).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: "member_email_verified", entity: "member", entityId: 12 }),
    );
  });

  // Misma escritura que el canje de ficha: con cuenta ya creada no se reinvita
  // (eso es un recupero), y la persona va derecho al login.
  it("sends a member that already has an account to the login instead of inviting again", async () => {
    seedApplication({ status: "completed", memberId: 12 }, { userId: 42 });

    await expect(confirmEmailAction({}, formDataFor())).rejects.toThrow("NEXT_REDIRECT:/ingresar");

    expect(h.state.member).toMatchObject({ emailStatus: "verified" });
    expect(tokens.issue).not.toHaveBeenCalled();
    expect(tokens.revokeForMember).not.toHaveBeenCalled();
  });

  // Si un admin le cambió la dirección a la ficha, este enlace —que autorizaba
  // la casilla vieja— ya no autoriza nada sobre la nueva.
  it("refuses to touch a card whose address is no longer the one that authorized the link", async () => {
    seedApplication({ status: "completed", memberId: 12 }, { email: "otra@example.com" });

    const res = await confirmEmailAction({}, formDataFor());

    expect(res).toEqual({ verified: "closed" });
    expect(h.tx.member.update).not.toHaveBeenCalled();
    expect(tokens.issue).not.toHaveBeenCalled();
    // La solicitud sí se marca: es inocuo y deja el rastro del doble opt-in.
    expect(h.applicationSvc.verifyEmail).toHaveBeenCalledWith(55, expect.any(Date));
  });

  // Mayúsculas y espacios no son una dirección distinta (el login normaliza
  // igual): un dedazo de formato no puede dejar al socio sin acceso.
  it("compares the two addresses normalized", async () => {
    seedApplication({ status: "completed", memberId: 12 }, { email: "  Vecina@Example.COM " });

    await expect(confirmEmailAction({}, formDataFor())).rejects.toThrow("NEXT_REDIRECT:/acceso/INVITE-NUEVA");
  });

  // La baja cierra el canje también acá: el enlace llegó a un buzón que ya no
  // representa a nadie (mismo criterio que `canRedeem`).
  it("refuses to invite a member that was withdrawn in the meantime", async () => {
    seedApplication({ status: "completed", memberId: 12 }, { status: "withdrawn" });

    expect(await confirmEmailAction({}, formDataFor())).toEqual({ verified: "closed" });
    expect(h.tx.member.update).not.toHaveBeenCalled();
    expect(tokens.issue).not.toHaveBeenCalled();
  });

  it("stays neutral when the application was completed without a card", async () => {
    seedApplication({ status: "completed", memberId: null });

    expect(await confirmEmailAction({}, formDataFor())).toEqual({ verified: "closed" });
    expect(h.tx.member.findUnique).not.toHaveBeenCalled();
  });
});

describe("confirmEmailAction — solicitud RECHAZADA o VENCIDA", () => {
  it.each(["rejected", "expired"])("marks the %s application but promises nothing", async (status) => {
    seedApplication({ status });

    const res = await confirmEmailAction({}, formDataFor());

    expect(res).toEqual({ verified: "closed" });
    // Marcarla es inocuo (y es el rastro del doble opt-in), pero no hay ficha
    // que tocar ni invitación que emitir.
    expect(h.applicationSvc.verifyEmail).toHaveBeenCalledWith(55, expect.any(Date));
    expect(h.tx.member.findUnique).not.toHaveBeenCalled();
    expect(tokens.issue).not.toHaveBeenCalled();
    expect(memberAccess.verifyEmail).not.toHaveBeenCalled();
  });

  // El mensaje de esta rama no puede insinuar un alta ni una invitación que no
  // van a llegar: es la mentira que el fix vino a sacar de la pantalla.
  it("shows a message that makes no promise about an alta or an invitation", () => {
    expect(VERIFIED.closed).not.toMatch(/invitaci|contraseñ|alta|Comisión Directiva/i);
    // Y el de la solicitud viva sí las hace, porque ahí sí van a ocurrir.
    expect(VERIFIED.pending).toMatch(/invitaci/i);
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
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
    expect(h.applicationSvc.verifyEmail).not.toHaveBeenCalled();
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
    expect(h.applicationSvc.verifyEmail).not.toHaveBeenCalled();
  });
});
