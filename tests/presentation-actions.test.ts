// Task 12 (6B): las cuatro acciones de decisión del detalle de una presentación.
//
// Una server action no se despacha por su URL sino por el id del encabezado
// `Next-Action`, así que ni el proxy ni el chequeo de rol del layout corren
// sobre estos POST: lo único que cierra la puerta es el `requireAdmin()` de la
// primera línea. Validar copia al padrón datos que tipeó una persona anónima; y
// observar le abre al vecino la única ventana que tiene para corregir antes de
// que el plazo del Art. 9° bis lo deje afuera.
//
// LO QUE ESTE ARCHIVO EXISTE PARA FIJAR es la trampa que dejó la task anterior:
// `presentationObservedEmail` acepta `observation` como OPCIONAL —lo omite a
// propósito cuando sólo reenvía el enlace, para no tener el mismo pedido en dos
// correos que pueden divergir—, así que nada en el código obliga al llamador a
// pasarla. Si se la olvidara, al vecino le llegaría "el detalle de qué es te lo
// mandamos por correo cuando lo revisamos" sin que ese detalle exista en ningún
// lado: un callejón sin salida con el plazo corriendo. El test es lo que
// obliga.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { actionToken: { deleteMany: vi.fn() } } }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/email", () => ({ mailer: { sendToMember: vi.fn(async () => ({ messageId: "x" })) } }));
// Las plantillas se DOBLAN para poder afirmar con qué las llamaron. Lo que se
// verifica no es su texto (eso es de `templates`), sino que el llamador les
// entregue la nota.
vi.mock("@/lib/email/templates", () => ({
  presentationObservedEmail: vi.fn(() => ({ subject: "s", text: "t", html: "h" })),
  presentationRejectedEmail: vi.fn(() => ({ subject: "s", text: "t", html: "h" })),
  portalInvite: vi.fn(() => ({ message: { subject: "s", text: "t", html: "h" }, summary: "r" })),
}));
vi.mock("@/lib/reregistration/presentation", async (orig) => ({
  ...(await orig<typeof import("@/lib/reregistration/presentation")>()),
  presentations: {
    validate: vi.fn(),
    observe: vi.fn(),
    reject: vi.fn(),
    unreject: vi.fn(),
    mintResumeToken: vi.fn(() => ({ raw: "LLAVE", hash: "hash" })),
    commitResumeToken: vi.fn(async () => {}),
  },
}));
// La emisión del enlace de verificación toca la base; se dobla entera. Lo que
// se verifica acá es que la action LO INTENTE cuando la dirección cambió, no
// cómo se firma un token (eso vive en `tokens.test.ts`).
vi.mock("@/lib/tokens", async (orig) => ({
  ...(await orig<typeof import("@/lib/tokens")>()),
  tokens: {
    revokeForMember: vi.fn(async () => 0),
    issue: vi.fn(async () => "TOKEN"),
  },
}));
vi.mock("@/lib/members/account-email-notice", () => ({
  ACCOUNT_EMAIL_NOTICE_WARNINGS: { both: "los dos correos fallaron" },
  accountEmailNotice: { announce: vi.fn() },
  accountEmailNoticeWarning: vi.fn(() => null),
}));
vi.mock("next/cache", async (orig) => ({
  ...(await orig<typeof import("next/cache")>()),
  revalidatePath: vi.fn(),
}));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Map([["x-real-ip", "10.0.0.4"]])),
}));

import {
  observePresentationAction, rejectPresentationAction, validatePresentationAction,
} from "@/app/admin/reempadronamiento/presentaciones/[id]/actions";
import { audit } from "@/lib/audit";
import type { AdminActor } from "@/lib/auth/require-admin";
import { requireAdmin } from "@/lib/auth/require-admin";
import { mailer } from "@/lib/email";
import { presentationObservedEmail, presentationRejectedEmail } from "@/lib/email/templates";
import { presentations } from "@/lib/reregistration/presentation";

type MockedFn = ReturnType<typeof vi.fn>;

const admin: AdminActor = { ok: true, actorId: 7 };
const blocked: AdminActor = {
  ok: false,
  reason: "not_admin",
  error: "No tenés permiso para esta sección.",
};

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

const PROCESS = {
  id: 3,
  status: "first_instance" as const,
  firstEndsAt: new Date("2026-11-01T12:00:00Z"),
  secondEndsAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  (requireAdmin as MockedFn).mockResolvedValue(admin);
});

describe("observePresentationAction", () => {
  it("le entrega la NOTA a la plantilla del correo", async () => {
    (presentations.observe as MockedFn).mockResolvedValue({
      ok: true,
      presentationId: 5,
      memberId: 42,
      email: "vecina@ejemplo.com",
      note: "El dorso del DNI salió movido.",
      process: PROCESS,
    });

    const res = await observePresentationAction({}, form({ presentationId: "5", note: "El dorso del DNI salió movido." }));

    expect(res.ok).toBe(true);
    expect(presentationObservedEmail).toHaveBeenCalledTimes(1);
    const arg = (presentationObservedEmail as MockedFn).mock.calls[0][0];
    // Sin esto el vecino recibe un correo que promete un detalle inexistente.
    expect(arg.observation).toBe("El dorso del DNI salió movido.");
    // Y con la fecha límite, que es la otra mitad accionable: "cuanto antes" no
    // es una fecha y el vecino no puede reconstruir un plazo estatutario solo.
    expect(arg.deadline).toEqual(PROCESS.firstEndsAt);
    expect(arg.url).toContain("LLAVE");
  });

  it("la LLAVE se persiste sólo DESPUÉS de que el correo salió", async () => {
    (presentations.observe as MockedFn).mockResolvedValue({
      ok: true, presentationId: 5, memberId: 42, email: "v@e.com", note: "corregí", process: PROCESS,
    });
    (mailer.sendToMember as MockedFn).mockRejectedValueOnce(new Error("smtp"));

    const res = await observePresentationAction({}, form({ presentationId: "5", note: "corregí" }));

    // La observación quedó asentada igual —no se revierte porque el SMTP esté
    // caído— pero la llave vieja sigue viva: rotarla sin que el correo salga
    // dejaría al vecino sin ninguna.
    expect(res.ok).toBe(true);
    expect(res.warning).toBeTruthy();
    expect(presentations.commitResumeToken).not.toHaveBeenCalled();
  });

  it("el asiento de auditoría NO lleva el texto de la observación", async () => {
    (presentations.observe as MockedFn).mockResolvedValue({
      ok: true, presentationId: 5, memberId: 42, email: "v@e.com",
      note: "Nombre y apellido del socio en claro", process: PROCESS,
    });

    await observePresentationAction({}, form({ presentationId: "5", note: "Nombre y apellido del socio en claro" }));

    const entry = (audit as MockedFn).mock.calls[0][0];
    expect(entry.action).toBe("presentation_observe");
    expect(JSON.stringify(entry.detail)).not.toContain("Nombre y apellido");
  });

  it("sin sesión de admin no toca nada", async () => {
    (requireAdmin as MockedFn).mockResolvedValue(blocked);
    const res = await observePresentationAction({}, form({ presentationId: "5", note: "x" }));
    expect(res.error).toBe(blocked.error);
    expect(presentations.observe).not.toHaveBeenCalled();
  });
});

describe("validatePresentationAction", () => {
  const member = {
    id: 42, fullName: "Castillo Nestor", status: "active",
    email: "vecina@ejemplo.com", emailStatus: "declared", userId: null,
  };

  it("sin cambio de email no manda ningún correo", async () => {
    (presentations.validate as MockedFn).mockResolvedValue({
      ok: true, memberId: 42, applied: ["phone"], emailChanged: false,
      accountEmailMove: null, member,
    });

    const res = await validatePresentationAction({}, form({ presentationId: "5" }));

    expect(res.ok).toBe(true);
    expect(mailer.sendToMember).not.toHaveBeenCalled();
  });

  it("con email nuevo dispara la verificación de la casilla", async () => {
    (presentations.validate as MockedFn).mockResolvedValue({
      ok: true, memberId: 42, applied: ["email", "emailStatus"], emailChanged: true,
      accountEmailMove: null, member,
    });

    const res = await validatePresentationAction({}, form({ presentationId: "5" }));

    expect(res.ok).toBe(true);
    expect(mailer.sendToMember).toHaveBeenCalledTimes(1);
    expect((mailer.sendToMember as MockedFn).mock.calls[0][0].type).toBe("email_verification");
  });

  it("el asiento lleva ids, nombres de campos y banderas — nunca valores", async () => {
    (presentations.validate as MockedFn).mockResolvedValue({
      ok: true, memberId: 42, applied: ["phone", "email"], emailChanged: true,
      accountEmailMove: null, member,
    });

    await validatePresentationAction({}, form({ presentationId: "5" }));

    const entry = (audit as MockedFn).mock.calls[0][0];
    expect(entry.action).toBe("presentation_validate");
    expect(entry.entityId).toBe(5);
    expect(entry.detail).toMatchObject({ memberId: 42, applied: ["phone", "email"] });
    const dumped = JSON.stringify(entry.detail);
    expect(dumped).not.toContain("vecina@ejemplo.com");
    expect(dumped).not.toContain("Castillo");
  });

  it("un rechazo del dominio se muestra y no audita nada", async () => {
    (presentations.validate as MockedFn).mockResolvedValue({
      ok: false, error: "Otro administrador ya resolvió esta presentación.",
    });

    const res = await validatePresentationAction({}, form({ presentationId: "5" }));

    expect(res.error).toMatch(/otro administrador/i);
    expect(audit).not.toHaveBeenCalled();
  });
});

describe("rejectPresentationAction", () => {
  /** El dominio ya devuelve lo que el correo necesita. */
  function rejected(over: Record<string, unknown> = {}) {
    (presentations.reject as MockedFn).mockResolvedValue({
      ok: true, presentationId: 5, memberId: 42, email: "vecina@ejemplo.com",
      note: "La foto del frente es de otra persona.", process: PROCESS, ...over,
    });
  }

  it("asienta que hubo motivo, nunca cuál", async () => {
    rejected();

    await rejectPresentationAction({}, form({ presentationId: "5", note: "No coincide con el DNI" }));

    const entry = (audit as MockedFn).mock.calls[0][0];
    expect(entry.detail).toMatchObject({ memberId: 42, hasNote: true });
    expect(JSON.stringify(entry.detail)).not.toContain("DNI");
  });

  // LA MISMA TRAMPA QUE LA OBSERVACIÓN, y por eso el mismo test.
  // `presentationRejectedEmail` acepta `note` como OPCIONAL —tiene que valerse
  // sin motivo, porque en la pantalla el motivo lo es—, así que nada en el
  // código obliga al llamador a pasárselo. Si se lo olvidara, al vecino le
  // llegaría "si querés saber por qué, preguntanos en la sede" con el motivo
  // escrito y guardado a un centímetro: la Comisión creería que avisó lo que no
  // avisó, y el vecino tendría que ir a la sede a preguntar algo que ya estaba
  // dicho, con el plazo del Art. 9° bis corriendo.
  it("le entrega el MOTIVO a la plantilla del correo", async () => {
    rejected();

    const res = await rejectPresentationAction({}, form({ presentationId: "5", note: "La foto del frente es de otra persona." }));

    expect(res.ok).toBe(true);
    expect(presentationRejectedEmail).toHaveBeenCalledTimes(1);
    const arg = (presentationRejectedEmail as MockedFn).mock.calls[0][0];
    expect(arg.note).toBe("La foto del frente es de otra persona.");
    // Y la fecha límite: sin ella el vecino no sabe hasta cuándo puede volver a
    // presentarse, que es la mitad accionable del aviso. Sale de
    // `currentDeadline` y no de una fecha escrita a mano, para no citarle la
    // instancia equivocada.
    expect(arg.deadline).toEqual(PROCESS.firstEndsAt);
  });

  it("el correo va a la casilla DECLARADA en la presentación", async () => {
    rejected();

    await rejectPresentationAction({}, form({ presentationId: "5", note: "x" }));

    const sent = (mailer.sendToMember as MockedFn).mock.calls[0][0];
    expect(sent.to).toBe("vecina@ejemplo.com");
    expect(sent.type).toBe("presentation_rejected");
    // La Notification cuelga del socio igual: es lo que le da carácter
    // fehaciente (Art. 5° quater).
    expect(sent.memberId).toBe(42);
  });

  it("un SMTP caído NO tumba el rechazo ya asentado, pero se lo dice al operador", async () => {
    rejected();
    (mailer.sendToMember as MockedFn).mockRejectedValueOnce(new Error("smtp"));

    const res = await rejectPresentationAction({}, form({ presentationId: "5", note: "x" }));

    expect(res.ok).toBe(true);
    expect(res.warning).toBeTruthy();
    // Y el asiento dice que el correo NO salió, que es lo único que después
    // permite saber si al socio se le avisó antes de la baja.
    expect((audit as MockedFn).mock.calls[0][0].detail).toMatchObject({ mailed: false });
  });

  it("el asiento de auditoría NO lleva el texto del motivo", async () => {
    rejected({ note: "Nombre y apellido del socio en claro" });

    await rejectPresentationAction({}, form({ presentationId: "5", note: "Nombre y apellido del socio en claro" }));

    const entry = (audit as MockedFn).mock.calls[0][0];
    expect(entry.action).toBe("presentation_reject");
    expect(JSON.stringify(entry.detail)).not.toContain("Nombre y apellido");
  });

  it("sin sesión de admin no toca nada", async () => {
    (requireAdmin as MockedFn).mockResolvedValue(blocked);
    const res = await rejectPresentationAction({}, form({ presentationId: "5", note: "x" }));
    expect(res.error).toBe(blocked.error);
    expect(presentations.reject).not.toHaveBeenCalled();
    expect(mailer.sendToMember).not.toHaveBeenCalled();
  });
});
