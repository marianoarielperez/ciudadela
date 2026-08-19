import { beforeEach, describe, expect, it, vi } from "vitest";

// El singleton importa @/lib/prisma (eager, explota sin .env) — mockear SIEMPRE.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import {
  ACCOUNT_EMAIL_NOTICE_WARNINGS,
  accountEmailNoticeWarning,
  makeAccountEmailNotice,
} from "@/lib/members/account-email-notice";

const PREVIOUS = "casilla.vieja@example.com";
const CURRENT = "casilla.nueva@example.com";

// La ficha DESPUÉS de la edición: con cuenta creada y la dirección nueva todavía
// sin verificar, que es lo que deja `buildPatch` al cambiar el email.
function movedCard(over: Record<string, unknown> = {}) {
  return {
    id: 7, status: "active" as const, email: CURRENT,
    emailStatus: "declared" as const, userId: 50, ...over,
  } as never;
}

type SentRaw = { to: string; subject: string; text: string; html: string };
type SentMember = { memberId: number | null; to: string; type: string; summary: string };

function makeDeps(opts: { failRaw?: boolean; failMailer?: boolean; quota?: boolean } = {}) {
  const raw: SentRaw[] = [];
  const notified: SentMember[] = [];
  const created: Array<Record<string, unknown>> = [];
  const deleted: Array<Record<string, unknown>> = [];
  const quota = opts.quota ?? true;
  // Sólo lo que el módulo usa del limitador, contando las reservas y las
  // devoluciones: lo que se está probando es que este camino gaste el MISMO
  // presupuesto que el botón de envío del panel.
  const makeLimiter = () => ({
    allows: vi.fn(() => quota),
    record: vi.fn(),
    refund: vi.fn(),
  });
  const memberLimiter = makeLimiter();
  const actorLimiter = makeLimiter();
  const deps = {
    db: {
      actionToken: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return data;
        }),
        deleteMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
          deleted.push(where);
          return { count: 1 };
        }),
      },
    },
    transport: {
      send: vi.fn(async (msg: SentRaw) => {
        if (opts.failRaw) throw Object.assign(new Error("smtp down"), { code: "ECONNREFUSED" });
        raw.push(msg);
        return { messageId: "raw-1" };
      }),
    },
    mailer: {
      sendToMember: vi.fn(async (input: SentMember) => {
        if (opts.failMailer) throw Object.assign(new Error("mailbox unavailable"), { code: "EENVELOPE" });
        notified.push(input);
        return { messageId: "mid-1" };
      }),
    },
    memberLimiter,
    actorLimiter,
    baseUrl: () => "https://sigev.test",
  };
  return { deps, raw, notified, created, deleted, memberLimiter, actorLimiter };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("accountEmailNotice.announce", () => {
  it("warns the previous address and sends a verification link to the new one", async () => {
    const { deps, raw, notified, created } = makeDeps();
    const notice = makeAccountEmailNotice(deps as never);

    const out = await notice.announce({ member: movedCard(), previousEmail: PREVIOUS, actorId: 7 });

    expect(out).toMatchObject({ previousNotified: true, verificationSent: true, throttled: false });
    expect(out.failures).toEqual([]);
    // Cada correo a su casilla, y ninguno a la del otro.
    expect(raw.map((m) => m.to)).toEqual([PREVIOUS]);
    expect(notified.map((m) => m.to)).toEqual([CURRENT]);
    // El enlace que viaja es un `email_verification` del socio.
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ purpose: "email_verification", memberId: 7 });
  });

  // El punto entero del aviso: la casilla que pierde el acceso NO puede
  // enterarse de cuál es la nueva.
  it("never tells the previous address which address replaced it", async () => {
    const { deps, raw } = makeDeps();
    const notice = makeAccountEmailNotice(deps as never);

    await notice.announce({ member: movedCard(), previousEmail: PREVIOUS, actorId: 7 });

    for (const body of [raw[0].subject, raw[0].text, raw[0].html]) {
      expect(body).not.toContain(CURRENT);
      expect(body).not.toContain("casilla.nueva");
    }
  });

  // Cuál de los dos correos es un acto de notificación fehaciente y cuál no:
  // la verificación va al domicilio electrónico declarado y se acredita como
  // `Notification` (`mailer.sendToMember`); el aviso va a una casilla que ya NO
  // es el domicilio del socio y sale por el transporte crudo, sin acreditar
  // nada. Su rastro es el asiento de auditoría del llamador.
  it("records a Notification only for the address that is now the electronic domicile", async () => {
    const { deps, notified } = makeDeps();
    const notice = makeAccountEmailNotice(deps as never);

    await notice.announce({ member: movedCard(), previousEmail: PREVIOUS, actorId: 7 });

    expect(deps.mailer.sendToMember).toHaveBeenCalledTimes(1);
    expect(notified[0]).toMatchObject({ memberId: 7, to: CURRENT, type: "email_verification" });
    // Y el aviso a la casilla vieja no pasó por el mailer: si pasara, quedaría
    // acreditada una notificación fehaciente en una dirección que el padrón ya
    // no le reconoce al socio.
    expect(deps.transport.send).toHaveBeenCalledTimes(1);
  });

  // Éste es el caso REAL más frecuente: el socio perdió el acceso a su correo
  // viejo, así que el rebote es lo esperado. No puede revertir nada ni frenar el
  // otro correo.
  it("keeps going when the previous address bounces", async () => {
    const { deps, notified } = makeDeps({ failRaw: true });
    const notice = makeAccountEmailNotice(deps as never);

    const out = await notice.announce({ member: movedCard(), previousEmail: PREVIOUS, actorId: 7 });

    expect(out.previousNotified).toBe(false);
    expect(out.verificationSent).toBe(true);
    expect(out.failures).toEqual([{ target: "previous", code: "ECONNREFUSED" }]);
    expect(notified.map((m) => m.to)).toEqual([CURRENT]);
    expect(accountEmailNoticeWarning(out)).toBe(ACCOUNT_EMAIL_NOTICE_WARNINGS.previous);
  });

  it("burns the verification link when it could not be delivered", async () => {
    const { deps, created, deleted } = makeDeps({ failMailer: true });
    const notice = makeAccountEmailNotice(deps as never);

    const out = await notice.announce({ member: movedCard(), previousEmail: PREVIOUS, actorId: 7 });

    expect(out.verificationSent).toBe(false);
    expect(out.failures).toEqual([{ target: "current", code: "EENVELOPE" }]);
    // Un enlace vivo que nadie recibió es superficie de ataque sin
    // contrapartida: se borra por su hash, el mismo que se acaba de emitir.
    expect(deleted).toEqual([{ tokenHash: created[0].tokenHash }]);
    expect(accountEmailNoticeWarning(out)).toBe(ACCOUNT_EMAIL_NOTICE_WARNINGS.current);
  });

  it("gives the quota back only when neither email went out", async () => {
    const both = makeDeps({ failRaw: true, failMailer: true });
    const out = await makeAccountEmailNotice(both.deps as never).announce({
      member: movedCard(), previousEmail: PREVIOUS, actorId: 7,
    });
    expect(out.failures.map((f) => f.target).sort()).toEqual(["current", "previous"]);
    expect(both.memberLimiter.refund).toHaveBeenCalledTimes(1);
    expect(both.actorLimiter.refund).toHaveBeenCalledTimes(1);
    expect(accountEmailNoticeWarning(out)).toBe(ACCOUNT_EMAIL_NOTICE_WARNINGS.both);

    // Con uno solo caído sí se gastó cupo: salió un correo.
    const one = makeDeps({ failRaw: true });
    await makeAccountEmailNotice(one.deps as never).announce({
      member: movedCard(), previousEmail: PREVIOUS, actorId: 7,
    });
    expect(one.memberLimiter.refund).not.toHaveBeenCalled();
    expect(one.actorLimiter.refund).not.toHaveBeenCalled();
  });

  // Sin esto, editar el email sería la vuelta larga para saltearse el techo de 3
  // correos por socio por hora del botón del panel: un admin podría inundar
  // cualquier casilla cambiando la dirección de ida y de vuelta.
  it("spends the same per-member and per-actor budget as the panel's send button", async () => {
    const { deps, memberLimiter, actorLimiter } = makeDeps();
    const notice = makeAccountEmailNotice(deps as never);

    await notice.announce({ member: movedCard(), previousEmail: PREVIOUS, actorId: 9 });

    expect(memberLimiter.allows).toHaveBeenCalledWith("member:7");
    expect(actorLimiter.allows).toHaveBeenCalledWith("actor:9");
    expect(memberLimiter.record).toHaveBeenCalledWith("member:7");
    expect(actorLimiter.record).toHaveBeenCalledWith("actor:9");
  });

  it("sends nothing at all when the budget is spent", async () => {
    const { deps, created } = makeDeps({ quota: false });
    const notice = makeAccountEmailNotice(deps as never);

    const out = await notice.announce({ member: movedCard(), previousEmail: PREVIOUS, actorId: 7 });

    expect(out).toMatchObject({ throttled: true, previousNotified: false, verificationSent: false });
    expect(deps.transport.send).not.toHaveBeenCalled();
    expect(deps.mailer.sendToMember).not.toHaveBeenCalled();
    // Y tampoco se emite un enlace que nadie va a recibir.
    expect(created).toEqual([]);
    // Reserva atómica: si no hay cupo NO se registra en ninguno de los dos.
    expect(deps.memberLimiter.record).not.toHaveBeenCalled();
    expect(deps.actorLimiter.record).not.toHaveBeenCalled();
    expect(accountEmailNoticeWarning(out)).toBe(ACCOUNT_EMAIL_NOTICE_WARNINGS.throttled);
  });

  // Quién decide qué correo le corresponde al socio es `verificationTarget`, la
  // misma función que usa el botón del panel. Si la ficha estuviera en un estado
  // que le corresponde una INVITACIÓN de contraseña (email ya verificado), este
  // camino no la manda: reinvitar a crear la contraseña a alguien que ya tiene
  // cuenta es exactamente lo que esa función niega.
  it("never turns into a password invitation for a member who already has an account", async () => {
    const { deps, created } = makeDeps();
    const notice = makeAccountEmailNotice(deps as never);

    const out = await notice.announce({
      member: movedCard({ emailStatus: "verified" }), previousEmail: PREVIOUS, actorId: 7,
    });

    expect(created).toEqual([]);
    expect(deps.mailer.sendToMember).not.toHaveBeenCalled();
    expect(out.failures).toEqual([{ target: "current", code: "not_eligible" }]);
    // Y el aviso a la casilla vieja sí salió: la mudanza ocurrió igual.
    expect(out.previousNotified).toBe(true);
  });

  // El caso anterior lo frena el `ok: false` de `verificationTarget`. Éste fija
  // la otra mitad de la guarda: aunque la función dijera que SÍ corresponde un
  // correo, este camino sólo manda el de VERIFICACIÓN. El enlace que emite es
  // siempre un `email_verification` y se canja en /verificar, así que dejar
  // pasar un `password_invitation` mandaría al socio un enlace muerto —y, peor,
  // sería una invitación a crear contraseña disparada por una edición de ficha.
  it("only ever sends the verification kind, never an invitation", async () => {
    const { deps, created } = makeDeps();
    const notice = makeAccountEmailNotice(deps as never);

    // Estado en el que `verificationTarget` devuelve `password_invitation`.
    const out = await notice.announce({
      member: movedCard({ emailStatus: "verified", userId: null }),
      previousEmail: PREVIOUS,
      actorId: 7,
    });

    expect(created).toEqual([]);
    expect(deps.mailer.sendToMember).not.toHaveBeenCalled();
    expect(out.failures).toEqual([{ target: "current", code: "not_eligible" }]);
  });
});

describe("accountEmailNoticeWarning", () => {
  it("says nothing to the operator when both emails went out", () => {
    expect(
      accountEmailNoticeWarning({
        previousNotified: true, verificationSent: true, throttled: false, failures: [],
      }),
    ).toBeNull();
  });

  // Los cuatro textos arrancan igual a propósito: la edición YA commiteó y el
  // socio ya ingresa con la dirección nueva. Un operador que lea esto como "no
  // se guardó" volvería a editar y produciría una segunda mudanza.
  it("always tells the operator that the change was saved anyway", () => {
    for (const text of Object.values(ACCOUNT_EMAIL_NOTICE_WARNINGS)) {
      expect(text).toContain("Se guardó el cambio");
      // Voseo y sin datos de nadie.
      expect(text).not.toContain("@");
    }
  });
});
