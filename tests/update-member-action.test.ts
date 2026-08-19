import { beforeEach, describe, expect, it, vi } from "vitest";

// Los dos rechazos de `memberWriter` (la dirección nueva ya es de otra cuenta de
// acceso, o la edición dejaría sin email a una ficha que ya tiene cuenta) no
// escriben nada, y por eso mismo se salían del rastro: la action retornaba antes
// del `audit`. Un intento de mover la identidad de acceso de un socio a la
// casilla de otra cuenta es justo lo que la asociación tiene que poder
// reconstruir después —el padrón es el registro que se presenta ante la IGJ—,
// así que acá se fija que quedan asentados, con el motivo y SIN valores.
//
// La action es "use server" y usa los singletones de producción directo (no
// sigue el patrón `make*(deps)` del resto del módulo), así que se mockean sus
// dependencias módulo por módulo, igual que en tests/send-verification-action.test.ts.
vi.mock("@/lib/prisma", () => ({
  prisma: {
    member: { findUnique: vi.fn() },
    street: { findUnique: vi.fn() },
    actionToken: { deleteMany: vi.fn(async () => ({ count: 0 })) },
  },
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Map([["x-real-ip", "10.0.0.7"]])),
}));

vi.mock("@/lib/auth/require-admin", () => ({
  requireAdmin: vi.fn(async () => ({ ok: true, actorId: 7 })),
}));

vi.mock("@/lib/auth/rate-limiter", () => ({
  verificationMemberLimiter: { allows: vi.fn(() => true), record: vi.fn(), refund: vi.fn() },
  verificationActorLimiter: { allows: vi.fn(() => true), record: vi.fn(), refund: vi.fn() },
}));

vi.mock("@/lib/tokens", () => ({
  hashToken: vi.fn((raw: string) => `hash:${raw}`),
  tokens: { issue: vi.fn(async () => "RAW"), revokeForMember: vi.fn(async () => 0) },
  MEMBER_EMAIL_TOKEN_PURPOSES: ["email_verification", "password_invitation"],
}));

vi.mock("@/lib/email", () => ({ mailer: { sendToMember: vi.fn(async () => ({ messageId: "m" })) } }));

// El singleton de los avisos de mudanza se stubea; los TEXTOS y el
// `accountEmailNoticeWarning` son los de verdad, si no el test fijaría el mock.
vi.mock("@/lib/members/account-email-notice", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/members/account-email-notice")>();
  return { ...actual, accountEmailNotice: { announce: vi.fn() } };
});

vi.mock("@/lib/email/templates", () => ({
  portalInvite: vi.fn(() => ({ message: { subject: "s", text: "t", html: "<p>t</p>" }, summary: "r" })),
}));

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));

// Del módulo de escritura sólo se stubea el SINGLETON: las clases de error
// tienen que ser las de verdad, si no `instanceof` en la action mediría el
// mock y el test pasaría con la rama rota.
vi.mock("@/lib/members/write", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/members/write")>();
  return { ...actual, memberWriter: { updateMember: vi.fn() } };
});

import { updateMemberAction } from "@/app/admin/socios/carga/[numero]/actions";
import {
  ACCOUNT_EMAIL_NOTICE_WARNINGS,
  accountEmailNotice,
} from "@/lib/members/account-email-notice";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import {
  MEMBER_WRITE_ERRORS,
  MemberEmailConflictError,
  MemberEmailRequiredError,
  memberWriter,
} from "@/lib/members/write";

type MockedFn = ReturnType<typeof vi.fn>;

// La ficha guardada, con todos los campos que `buildPatch`/`changedFields` leen.
function stored(over: Record<string, unknown> = {}) {
  return {
    id: 1, status: "active", fullName: "Perez Ana", dni: "20111222", birthDate: null,
    civilStatus: null, nationality: null, occupation: null, phone: null,
    streetId: null, streetText: null, streetNumber: null, neighborhood: null,
    email: "vecino@example.com", emailStatus: "verified", emailVerifiedAt: new Date("2026-01-01T00:00:00Z"),
    userId: 50, ...over,
  };
}

function form(fields: Record<string, string>) {
  const fd = new FormData();
  fd.set("memberId", "1");
  fd.set("fullName", "Perez Ana");
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

// El guardado que MUEVE la dirección de ingreso: el writer devuelve las dos
// direcciones de la mudanza y la ficha ya guardada.
function movedTo(email: string) {
  (memberWriter.updateMember as MockedFn).mockResolvedValue({
    member: stored({ email, emailStatus: "declared", emailVerifiedAt: null }),
    revokedTokens: 2,
    accountEmailMove: { from: "vecino@example.com", to: email },
    accountEmailUpdated: true,
  });
}

const allSent = {
  previousNotified: true, verificationSent: true, throttled: false, failures: [] as unknown[],
};

beforeEach(() => {
  vi.clearAllMocks();
  // `clearAllMocks` borra las llamadas pero NO las implementaciones: sin esto,
  // un `mockRejectedValue` de un test se derramaría a los siguientes.
  (audit as MockedFn).mockResolvedValue(undefined);
  (prisma.member.findUnique as MockedFn).mockResolvedValue(stored());
  (memberWriter.updateMember as MockedFn).mockResolvedValue({
    member: stored(), revokedTokens: 0, accountEmailMove: null, accountEmailUpdated: false,
  });
  (accountEmailNotice.announce as MockedFn).mockResolvedValue(allSent);
});

describe("updateMemberAction — rechazos de memberWriter", () => {
  // El operador borró el email de una ficha que ya tiene cuenta de acceso.
  it("shows the writer's message and audits the rejection when the card is left without email", async () => {
    (memberWriter.updateMember as MockedFn).mockRejectedValue(new MemberEmailRequiredError());

    // Sin campo email: `parseForm` lo traduce a undefined y `buildPatch` a null.
    const res = await updateMemberAction({}, form({}));

    expect(res).toEqual({ error: MEMBER_WRITE_ERRORS.emailRequired });
    expect(audit).toHaveBeenCalledTimes(1);
    const entry = (audit as MockedFn).mock.calls[0][0];
    expect(entry).toMatchObject({
      userId: 7, action: "member_update_rejected", entity: "member", entityId: 1, ip: "10.0.0.7",
    });
    expect(entry.detail.reason).toBe("email_required");
    // Los nombres de los campos que traía la edición, nunca los valores.
    expect(entry.detail.fields).toContain("email");
    // Y NO se asienta como un cambio efectivo: la transacción volvió atrás.
    expect(entry.action).not.toBe("member_update");
  });

  // La dirección nueva ya es la de otra cuenta de acceso.
  it("audits the collision attempt without leaking the other account holder", async () => {
    (memberWriter.updateMember as MockedFn).mockRejectedValue(new MemberEmailConflictError());

    const res = await updateMemberAction({}, form({ email: "otro.socio@example.com" }));

    expect(res).toEqual({ error: MEMBER_WRITE_ERRORS.emailConflict });
    const entry = (audit as MockedFn).mock.calls[0][0];
    expect(entry.action).toBe("member_update_rejected");
    expect(entry.detail.reason).toBe("email_conflict");
    // Ni la dirección tipeada ni ningún dato del titular de la otra cuenta: el
    // log de auditoría no lleva valores personales (Ley 25.326).
    expect(JSON.stringify(entry.detail)).not.toContain("@");
  });

  it("still audits the successful save as member_update", async () => {
    movedTo("nuevo@example.com");
    (accountEmailNotice.announce as MockedFn).mockResolvedValue(allSent);

    const res = await updateMemberAction({}, form({ email: "nuevo@example.com" }));

    expect(res).toEqual({ saved: true });
    const entry = (audit as MockedFn).mock.calls[0][0];
    expect(entry.action).toBe("member_update");
    expect(entry.detail).toMatchObject({ revokedTokens: 2, accountEmailUpdated: true });
  });

  // El P2002 del DNI no es un rechazo del writer y tiene su propio mensaje: no
  // puede caer en la rama nueva ni ensuciar la auditoría con un motivo inventado.
  it("does not audit the duplicated DNI as a writer rejection", async () => {
    (memberWriter.updateMember as MockedFn).mockRejectedValue(
      Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
    );

    const res = await updateMemberAction({}, form({ dni: "30999888" }));

    expect(res).toEqual({ error: "Ya existe otro socio con ese DNI." });
    expect(audit).not.toHaveBeenCalled();
  });
});

// Cambiar el email de la ficha de un socio con cuenta le mueve la dirección con
// la que INGRESA. Que se mude enseguida es la decisión de producto; que se mude
// en silencio, no: la action tiene que disparar los dos avisos y dejar asiento.
describe("updateMemberAction — mudanza de la dirección de ingreso", () => {
  it("warns both mailboxes with the address the account had, not the one typed", async () => {
    movedTo("nuevo@example.com");

    const res = await updateMemberAction({}, form({ email: "nuevo@example.com" }));

    expect(res).toEqual({ saved: true });
    expect(accountEmailNotice.announce).toHaveBeenCalledTimes(1);
    const call = (accountEmailNotice.announce as MockedFn).mock.calls[0][0];
    expect(call.previousEmail).toBe("vecino@example.com");
    expect(call.actorId).toBe(7);
    // La ficha que va es la GUARDADA, no la que había antes: es sobre ella que
    // `verificationTarget` decide qué enlace corresponde.
    expect(call.member.email).toBe("nuevo@example.com");
    expect(call.member.emailStatus).toBe("declared");
  });

  // Ninguna edición que NO mueva la dirección de ingreso puede disparar correos.
  it("does not warn anyone when the login address did not move", async () => {
    const res = await updateMemberAction({}, form({ fullName: "Perez Ana Maria" }));

    expect(res).toEqual({ saved: true });
    expect(accountEmailNotice.announce).not.toHaveBeenCalled();
    expect((audit as MockedFn).mock.calls.map((c) => c[0].action)).toEqual(["member_update"]);
  });

  // Asiento propio del hecho, además del `member_update`: mover la identidad de
  // acceso de un socio es lo que hay que poder reconstruir después.
  it("audits the move on its own entry, with no address in it", async () => {
    movedTo("nuevo@example.com");

    await updateMemberAction({}, form({ email: "nuevo@example.com" }));

    const actions = (audit as MockedFn).mock.calls.map((c) => c[0].action);
    expect(actions).toEqual(["member_update", "member_login_email_moved"]);
    const entry = (audit as MockedFn).mock.calls[1][0];
    expect(entry).toMatchObject({ userId: 7, entity: "member", entityId: 1, ip: "10.0.0.7" });
    expect(entry.detail).toMatchObject({ notifiedPrevious: true, verificationSent: true });
    // Banderas y códigos, jamás direcciones (Ley 25.326).
    expect(JSON.stringify(entry.detail)).not.toContain("@");
  });

  // El caso real más frecuente: el socio perdió la casilla vieja, así que el
  // rebote es lo esperado. El cambio NO se revierte —revertir dejaría la cuenta
  // apuntando a una dirección que el padrón ya no le reconoce— y el operador se
  // entera de que le queda un aviso por hacer a mano.
  it("keeps the saved change and warns the operator when a notice could not be delivered", async () => {
    movedTo("nuevo@example.com");
    (accountEmailNotice.announce as MockedFn).mockResolvedValue({
      previousNotified: false, verificationSent: true, throttled: false,
      failures: [{ target: "previous", code: "ECONNREFUSED" }],
    });

    const res = await updateMemberAction({}, form({ email: "nuevo@example.com" }));

    // `saved` sigue en true: el cambio está hecho y no se deshace por el correo.
    expect(res.saved).toBe(true);
    expect(res.error).toBeUndefined();
    expect(res.warning).toBe(ACCOUNT_EMAIL_NOTICE_WARNINGS.previous);
    const entry = (audit as MockedFn).mock.calls[1][0];
    expect(entry.detail.failures).toEqual([{ target: "previous", code: "ECONNREFUSED" }]);
    expect(JSON.stringify(entry.detail)).not.toContain("@");
  });

  // N9. `announce` degrada adentro lo que puede, pero lo que igual se escape no
  // puede convertir un guardado exitoso en la pantalla de error genérica de Next:
  // el operador leería "no se guardó", volvería a editar la ficha y produciría
  // una SEGUNDA mudanza de la dirección de ingreso, con su segundo par de
  // correos. Y el asiento del hecho —lo único con lo que se reconstruye después—
  // se perdería justo cuando algo salió mal.
  it("still saves, warns and audits when the whole notice blows up", async () => {
    movedTo("nuevo@example.com");
    (accountEmailNotice.announce as MockedFn).mockRejectedValue(
      Object.assign(new Error("pool timeout"), { code: "P2024" }),
    );

    const res = await updateMemberAction({}, form({ email: "nuevo@example.com" }));

    expect(res).toEqual({ saved: true, warning: ACCOUNT_EMAIL_NOTICE_WARNINGS.both });
    const actions = (audit as MockedFn).mock.calls.map((c) => c[0].action);
    expect(actions).toEqual(["member_update", "member_login_email_moved"]);
    const entry = (audit as MockedFn).mock.calls[1][0];
    // `crashed` distingue "los correos no salieron" (observado) de "el aviso
    // entero se cayó" (suposición conservadora), que es lo que hace falta al
    // reconstruir.
    expect(entry.detail).toMatchObject({
      notifiedPrevious: false, verificationSent: false, crashed: true,
    });
    expect(entry.detail.failures).toEqual([
      { target: "previous", code: "P2024" },
      { target: "current", code: "P2024" },
    ]);
    expect(JSON.stringify(entry.detail)).not.toContain("@");
  });

  // Misma familia: el asiento es posterior al commit, así que una falla suya
  // tampoco puede devolver una pantalla de error sobre un cambio ya guardado.
  it("saves and warns when the audit entry itself cannot be written", async () => {
    movedTo("nuevo@example.com");
    (audit as MockedFn).mockRejectedValue(Object.assign(new Error("db down"), { code: "P1001" }));

    const res = await updateMemberAction({}, form({ email: "nuevo@example.com" }));

    expect(res.saved).toBe(true);
    expect(res.error).toBeUndefined();
    expect(res.warning).toContain(ACCOUNT_EMAIL_NOTICE_WARNINGS.auditFailed);
    // Los dos asientos se intentaron igual: el segundo no se saltea porque el
    // primero haya fallado.
    expect(audit).toHaveBeenCalledTimes(2);
  });

  it("saves and warns when the audit fails on an edit that moved nothing", async () => {
    (audit as MockedFn).mockRejectedValue(Object.assign(new Error("db down"), { code: "P1001" }));

    const res = await updateMemberAction({}, form({ fullName: "Perez Ana Maria" }));

    expect(res).toEqual({ saved: true, warning: ACCOUNT_EMAIL_NOTICE_WARNINGS.auditFailed });
  });

  it("carries the throttled case to the operator too", async () => {
    movedTo("nuevo@example.com");
    (accountEmailNotice.announce as MockedFn).mockResolvedValue({
      previousNotified: false, verificationSent: false, throttled: true, failures: [],
    });

    const res = await updateMemberAction({}, form({ email: "nuevo@example.com" }));

    expect(res).toEqual({ saved: true, warning: ACCOUNT_EMAIL_NOTICE_WARNINGS.throttled });
    expect((audit as MockedFn).mock.calls[1][0].detail).toMatchObject({ throttled: true });
  });
});
