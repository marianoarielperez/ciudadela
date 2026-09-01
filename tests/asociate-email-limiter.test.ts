import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// El techo por CASILLA del wizard ASOCIATE (`asociateEmailLimiter`).
//
// Qué agujero tapa: cualquiera puede pedir un alta declarando el email de un
// TERCERO, y el wizard le manda correo a esa dirección dos veces (la
// verificación al crear y el enlace de retome cuando se lo piden). Los techos
// que ya existían son por IP —que no protege a una casilla concreta si el
// atacante rota de origen, el mismo argumento que documenta
// `passwordResetEmailLimiter`— y por DNI, que no protege nada: el DNI lo elige
// el atacante y nadie lo verifica antes de mandar el correo. El único dato que
// identifica a la VÍCTIMA es la dirección declarada.
//
// El limitador es el de verdad (no un mock): lo que este archivo mide es el
// presupuesto y la normalización, y con un doble que diga `true` no se mide
// ninguna de las dos. Se mockean sí los otros tres cupos, que acá son ruido
// —cinco creaciones por hora por IP dejarían el archivo entero en `TOO_MANY`—.
const mocks = vi.hoisted(() => {
  class DuplicateLiveApplicationError extends Error {
    constructor() {
      super("Ya tenés una solicitud en trámite.");
      this.name = "DuplicateLiveApplicationError";
    }
  }
  return {
    DuplicateLiveApplicationError,
    prisma: {
      member: { findUnique: vi.fn() },
      configuration: { findUnique: vi.fn() },
      reregistrationProcess: { findUnique: vi.fn() },
    },
    service: {
      create: vi.fn(),
      findLiveByDni: vi.fn(),
      lastRejectionAt: vi.fn(),
      mintResumeToken: vi.fn(),
      commitResumeToken: vi.fn(),
    },
    verifyTurnstile: vi.fn(),
    tokens: { issue: vi.fn() },
    mailer: { sendToApplication: vi.fn() },
    audit: vi.fn(),
    // Cupo infinito: los tres cupos que este archivo NO mide.
    noopLimiter: { allows: vi.fn(() => true), record: vi.fn(), refund: vi.fn(), check: vi.fn(() => true) },
    afterCallbacks: [] as Array<() => unknown>,
    configRows: {} as Record<string, unknown>,
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/applications/service", () => ({
  applicationService: mocks.service,
  DuplicateLiveApplicationError: mocks.DuplicateLiveApplicationError,
}));
vi.mock("@/lib/turnstile", () => ({ verifyTurnstile: mocks.verifyTurnstile }));
vi.mock("@/lib/tokens", () => ({ tokens: mocks.tokens }));
vi.mock("@/lib/email", () => ({ mailer: mocks.mailer }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
// El módulo real, con los tres cupos que no se miden reemplazados por el noop:
// `asociateEmailLimiter` queda siendo el singleton de producción.
vi.mock("@/lib/auth/rate-limiter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/rate-limiter")>();
  return {
    ...actual,
    applicationCreateLimiter: mocks.noopLimiter,
    resumeResendLimiter: mocks.noopLimiter,
    resumeResendTargetLimiter: mocks.noopLimiter,
  };
});
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-real-ip": "1.2.3.4", "user-agent": "vitest" }),
}));
vi.mock("next/server", () => ({
  after: (fn: () => unknown) => {
    mocks.afterCallbacks.push(fn);
  },
}));

import { createApplicationAction, resendResumeLinkAction } from "@/app/(public)/asociate/actions";
import {
  APPLICATION_WINDOW_MS,
  ASOCIATE_EMAIL_LIMIT,
  asociateEmailLimiter,
  PASSWORD_RESET_EMAIL_LIMIT,
  passwordResetEmailLimiter,
} from "@/lib/auth/rate-limiter";

const DNI = "30111222";
const VICTIM = "vecina@example.com";
const TOO_MANY = "Demasiados intentos desde esta conexión. Probá de nuevo en un rato.";

function valid(email: string): Record<string, string> {
  return {
    "cf-turnstile-response": "captcha-ok",
    livesInBarrio: "si",
    streetId: "3",
    streetNumber: "123",
    requestedCategory: "active",
    fullName: "Vecina Prueba",
    dni: DNI,
    birthDate: "1990-05-05",
    civilStatus: "soltera",
    nationality: "argentina",
    occupation: "docente",
    phone: "2974000000",
    email,
    emailConfirm: email,
    acceptTerms: "on",
  };
}

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.append(k, v);
  return fd;
}

// El reloj congelado por el mismo motivo que en
// tests/create-application-action.test.ts: la guarda 0 cita plazos.
vi.useFakeTimers({ toFake: ["Date"] });
vi.setSystemTime(new Date("2026-09-01T15:00:00Z")); // 12:00 en Argentina
afterAll(() => { vi.useRealTimers(); });

async function flushAfter() {
  const pending = mocks.afterCallbacks.splice(0);
  for (const fn of pending) await fn();
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.afterCallbacks.length = 0;
  mocks.noopLimiter.allows.mockReturnValue(true);
  mocks.noopLimiter.check.mockReturnValue(true);
  mocks.verifyTurnstile.mockResolvedValue(true);
  mocks.configRows = {
    asociate_activo: true,
    terms_text: "Términos de prueba",
    privacy_consent_text: "Consentimiento de prueba",
  };
  mocks.prisma.configuration.findUnique.mockImplementation(
    async ({ where: { key } }: { where: { key: string } }) =>
      key in mocks.configRows ? { key, value: mocks.configRows[key] } : null,
  );
  mocks.prisma.reregistrationProcess.findUnique.mockResolvedValue(null);
  mocks.prisma.member.findUnique.mockResolvedValue(null);
  mocks.service.findLiveByDni.mockResolvedValue(null);
  mocks.service.lastRejectionAt.mockResolvedValue(null);
  mocks.service.create.mockResolvedValue({ id: 7, resumeToken: "RESUME-RAW" });
  mocks.service.mintResumeToken.mockReturnValue({ raw: "MINTED-RAW", hash: "MINTED-HASH" });
  mocks.service.commitResumeToken.mockResolvedValue(undefined);
  mocks.tokens.issue.mockResolvedValue("VERIFY-RAW");
  mocks.mailer.sendToApplication.mockResolvedValue({ messageId: "mid" });
  // El singleton es de proceso y este archivo lo usa de verdad: cada caso
  // arranca con el presupuesto entero de las direcciones que toca.
  for (const key of [VICTIM, "otra@example.com"]) asociateEmailLimiter.reset(key);
});

describe("asociateEmailLimiter", () => {
  it("copia el presupuesto y la ventana del techo por casilla del recupero", () => {
    // Mismo daño (inundar el buzón de un tercero desde un formulario anónimo),
    // mismo número: si el del recupero se mueve, este test lo hace notar.
    expect(ASOCIATE_EMAIL_LIMIT).toBe(PASSWORD_RESET_EMAIL_LIMIT);
    expect(asociateEmailLimiter.limit).toBe(passwordResetEmailLimiter.limit);
    expect(asociateEmailLimiter.windowMs).toBe(passwordResetEmailLimiter.windowMs);
    expect(asociateEmailLimiter.windowMs).toBe(APPLICATION_WINDOW_MS);
  });

  it("bloquea la creación pasada del cupo, con el mensaje genérico y sin tocar el padrón", async () => {
    for (let i = 0; i < ASOCIATE_EMAIL_LIMIT; i++) {
      const ok = await createApplicationAction({}, form(valid(VICTIM)));
      expect(ok.created).toEqual({ resumeToken: "RESUME-RAW" });
    }

    vi.clearAllMocks();
    mocks.verifyTurnstile.mockResolvedValue(true);
    const blocked = await createApplicationAction({}, form(valid(VICTIM)));

    // El texto es el genérico que ya usa el archivo: uno nuevo ("esa casilla
    // recibió demasiados avisos") convertiría el error en un oráculo que dice
    // que la dirección es conocida.
    expect(blocked.error).toBe(TOO_MANY);
    expect(mocks.service.create).not.toHaveBeenCalled();
    expect(mocks.mailer.sendToApplication).not.toHaveBeenCalled();
    expect(mocks.prisma.member.findUnique).not.toHaveBeenCalled();
  });

  it("cuenta la dirección NORMALIZADA: alternar mayúsculas no regala presupuesto", async () => {
    const disfraces = ["Vecina@Example.com", "VECINA@EXAMPLE.COM", "vecina@example.com", " vecina@example.com ", "veCINA@example.com"];
    expect(disfraces.length).toBe(ASOCIATE_EMAIL_LIMIT);
    for (const d of disfraces) {
      const ok = await createApplicationAction({}, form(valid(d)));
      expect(ok.error).toBeUndefined();
    }

    const blocked = await createApplicationAction({}, form(valid(VICTIM)));
    expect(blocked.error).toBe(TOO_MANY);
  });

  it("el cupo es de la casilla, no del formulario: creación y reenvío lo comparten", async () => {
    for (let i = 0; i < ASOCIATE_EMAIL_LIMIT; i++) {
      await createApplicationAction({}, form(valid(VICTIM)));
    }

    // El reenvío es el OTRO correo hacia la misma casilla. Con un presupuesto
    // por formulario, la víctima recibiría el doble.
    mocks.service.findLiveByDni.mockResolvedValue({ id: 7, email: VICTIM });
    vi.clearAllMocks();
    const result = await resendResumeLinkAction({}, form({ "cf-turnstile-response": "ok", dni: DNI }));
    await flushAfter();

    // Anti-enumeración: la respuesta es la neutra de siempre, la MISMA que da
    // el DNI sin solicitud. Que el correo no salga es invisible desde afuera.
    expect(result).toEqual({ done: true });
    expect(mocks.mailer.sendToApplication).not.toHaveBeenCalled();
    expect(mocks.service.commitResumeToken).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("el reenvío gasta el cupo de la casilla de la solicitud VIVA", async () => {
    mocks.service.findLiveByDni.mockResolvedValue({ id: 7, email: VICTIM });
    for (let i = 0; i < ASOCIATE_EMAIL_LIMIT; i++) {
      await resendResumeLinkAction({}, form({ "cf-turnstile-response": "ok", dni: DNI }));
      await flushAfter();
    }
    expect(mocks.mailer.sendToApplication).toHaveBeenCalledTimes(ASOCIATE_EMAIL_LIMIT);

    await resendResumeLinkAction({}, form({ "cf-turnstile-response": "ok", dni: DNI }));
    await flushAfter();
    expect(mocks.mailer.sendToApplication).toHaveBeenCalledTimes(ASOCIATE_EMAIL_LIMIT);
  });

  it("dos direcciones distintas no se comen el presupuesto entre ellas", async () => {
    for (let i = 0; i < ASOCIATE_EMAIL_LIMIT; i++) {
      await createApplicationAction({}, form(valid(VICTIM)));
    }
    expect((await createApplicationAction({}, form(valid(VICTIM)))).error).toBe(TOO_MANY);

    const otra = await createApplicationAction({}, form(valid("otra@example.com")));
    expect(otra.created).toEqual({ resumeToken: "RESUME-RAW" });
  });
});
