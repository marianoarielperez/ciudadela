import { beforeEach, describe, expect, it, vi } from "vitest";

// Turnstile en los dos formularios públicos y ANÓNIMOS que no lo tenían: el
// ingreso y el pedido de recupero de contraseña (decisión del 21/08/2026;
// CLAUDE.md prometía "captcha en todos los formularios públicos" y hasta hoy era
// falso).
//
// Lo que se fija acá es lo único que el test de la librería (tests/turnstile.ts)
// no puede ver: que con el captcha inválido las dos actions se detengan ANTES de
// tocar nada —ni base, ni bcrypt, ni correo— y ANTES de cobrarle el intento a
// ningún limitador, y que el captcha se sume a las guardas que ya estaban en vez
// de correrlas de lugar.

const { verifyTurnstile } = vi.hoisted(() => ({ verifyTurnstile: vi.fn(async () => true) }));
vi.mock("@/lib/turnstile", () => ({ verifyTurnstile }));

// ── Login ──────────────────────────────────────────────────────────────────
const { signIn } = vi.hoisted(() => ({ signIn: vi.fn(async () => {}) }));
vi.mock("@/auth", () => ({ signIn }));
// `next-auth` entero: la action sólo lo usa para `instanceof AuthError`, y
// cargar el paquete de verdad arrastra su `lib/env.js`, que no resuelve fuera
// del runtime de Next.
vi.mock("next-auth", () => ({ AuthError: class AuthError extends Error {} }));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Map([["x-real-ip", "203.0.113.7"]])),
}));

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn(async () => null) },
    actionToken: { deleteMany: vi.fn(async () => ({ count: 0 })) },
  },
}));

vi.mock("@/lib/auth/rate-limiter", () => ({
  ipLimiter: { allows: vi.fn(() => true), record: vi.fn(), reset: vi.fn() },
  loginLimiter: { allows: vi.fn(() => true), record: vi.fn(), reset: vi.fn() },
  passwordResetIpLimiter: { allows: vi.fn(() => true), record: vi.fn(), refund: vi.fn() },
  passwordResetEmailLimiter: { allows: vi.fn(() => true), record: vi.fn(), refund: vi.fn() },
}));

// ── Recupero ───────────────────────────────────────────────────────────────
// El trabajo contra la cuenta va dentro de `after()`. El mock guarda las
// callbacks: si el captcha frena el pedido, no tiene que quedar NINGUNA agendada.
const afterCalls: Array<() => unknown> = [];
vi.mock("next/server", () => ({
  after: (fn: () => unknown) => { afterCalls.push(fn); },
}));

vi.mock("@/lib/auth/password-reset", () => ({
  passwordReset: { request: vi.fn(async () => null) },
}));

const sendMock = vi.fn(async () => ({ messageId: "mid-1" }));
vi.mock("@/lib/email/transport", () => ({ getTransport: vi.fn(() => ({ send: sendMock })) }));
vi.mock("@/lib/tokens", () => ({ hashToken: (raw: string) => `hash:${raw}` }));

import { loginAction } from "@/app/(public)/ingresar/actions";
import { recoverAction } from "@/app/(public)/ingresar/recuperar/actions";
import { audit } from "@/lib/audit";
import { passwordReset } from "@/lib/auth/password-reset";
import {
  ipLimiter, loginLimiter, passwordResetEmailLimiter, passwordResetIpLimiter,
} from "@/lib/auth/rate-limiter";

type MockedFn = ReturnType<typeof vi.fn>;

function loginForm(captcha: string | null) {
  const fd = new FormData();
  fd.set("email", "Vecino@Example.com");
  fd.set("password", "secreta-123");
  if (captcha !== null) fd.set("cf-turnstile-response", captcha);
  return fd;
}

function recoverForm(captcha: string | null) {
  const fd = new FormData();
  fd.set("email", "vecino@example.com");
  if (captcha !== null) fd.set("cf-turnstile-response", captcha);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  afterCalls.length = 0;
  verifyTurnstile.mockResolvedValue(true);
  (ipLimiter.allows as MockedFn).mockReturnValue(true);
  (loginLimiter.allows as MockedFn).mockReturnValue(true);
  (passwordResetIpLimiter.allows as MockedFn).mockReturnValue(true);
  (passwordResetEmailLimiter.allows as MockedFn).mockReturnValue(true);
});

describe("loginAction con Turnstile", () => {
  it("Turnstile inválido: no se prueba ninguna contraseña y no se gasta cupo", async () => {
    verifyTurnstile.mockResolvedValue(false);

    const res = await loginAction({}, loginForm("token-vencido"));

    expect(res.error).toContain("verificar que sos una persona");
    // Lo importante: el intento muere antes de `signIn`, o sea antes del bcrypt
    // y de la consulta a `users`.
    expect(signIn).not.toHaveBeenCalled();
    // Y no le cobra el intento a nadie: el token vencido es un problema del
    // captcha, no un intento de contraseña.
    expect(ipLimiter.record).not.toHaveBeenCalled();
    expect(loginLimiter.record).not.toHaveBeenCalled();
  });

  it("sin el campo del captcha (POST armado a mano) falla igual", async () => {
    // `verifyTurnstile` real falla CERRADO con token vacío; acá lo que se fija es
    // que la action LEA el campo y no lo dé por bueno cuando falta.
    verifyTurnstile.mockResolvedValue(false);
    const res = await loginAction({}, loginForm(null));
    expect(res.error).toContain("verificar que sos una persona");
    expect(verifyTurnstile).toHaveBeenCalledWith("", "203.0.113.7");
    expect(signIn).not.toHaveBeenCalled();
  });

  it("con el captcha resuelto sigue el circuito de siempre y recién ahí gasta cupo", async () => {
    await loginAction({}, loginForm("captcha-ok"));

    expect(signIn).toHaveBeenCalledWith(
      "credentials",
      // Email normalizado: la misma clave que usan el limitador y la auditoría.
      expect.objectContaining({ email: "vecino@example.com", redirectTo: "/redirigir" }),
    );
    expect(ipLimiter.record).toHaveBeenCalledWith("203.0.113.7");
    expect(loginLimiter.record).toHaveBeenCalledWith("vecino@example.com|203.0.113.7");
  });

  it("el cupo agotado sigue frenando ANTES del captcha (el captcha se suma, no reemplaza)", async () => {
    (ipLimiter.allows as MockedFn).mockReturnValue(false);

    const res = await loginAction({}, loginForm("captcha-ok"));

    expect(res.error).toContain("Demasiados intentos");
    // A un origen ya bloqueado no se le regala una llamada de red por intento.
    expect(verifyTurnstile).not.toHaveBeenCalled();
    expect(signIn).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "login_blocked" }),
    );
  });

  it("reserva atómica: si rechaza el techo del par email|ip, el techo por IP tampoco cobra", async () => {
    (loginLimiter.allows as MockedFn).mockReturnValue(false);

    await loginAction({}, loginForm("captcha-ok"));

    expect(ipLimiter.record).not.toHaveBeenCalled();
    expect(loginLimiter.record).not.toHaveBeenCalled();
  });
});

describe("recoverAction con Turnstile", () => {
  it("Turnstile inválido: ni cuenta consultada, ni correo agendado, ni cupo gastado", async () => {
    verifyTurnstile.mockResolvedValue(false);

    const res = await recoverAction({}, recoverForm("token-vencido"));

    expect(res.error).toContain("verificar que sos una persona");
    // Nada de lo que toca la cuenta llegó a agendarse.
    expect(afterCalls).toHaveLength(0);
    expect(passwordReset.request).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
    // Y el pedido no le come al socio ninguno de sus cinco de la hora.
    expect(passwordResetIpLimiter.record).not.toHaveBeenCalled();
    expect(passwordResetEmailLimiter.record).not.toHaveBeenCalled();
  });

  it("el captcha corre ANTES de registrar el cupo y DESPUÉS de consultarlo", async () => {
    // El orden importa: consultado primero (al bloqueado no se le regala una
    // llamada de red), registrado después (un token vencido no le quema un
    // pedido a quien no hizo nada mal).
    await recoverAction({}, recoverForm("captcha-ok"));

    expect(passwordResetIpLimiter.allows).toHaveBeenCalled();
    expect(verifyTurnstile).toHaveBeenCalledWith("captcha-ok", "203.0.113.7");
    expect(passwordResetIpLimiter.record).toHaveBeenCalledWith("203.0.113.7");
    expect(afterCalls).toHaveLength(1);
  });

  it("el cupo agotado sigue frenando ANTES del captcha", async () => {
    (passwordResetEmailLimiter.allows as MockedFn).mockReturnValue(false);

    const res = await recoverAction({}, recoverForm("captcha-ok"));

    expect(res.error).toContain("Ya pediste el enlace");
    expect(verifyTurnstile).not.toHaveBeenCalled();
    expect(afterCalls).toHaveLength(0);
  });

  it("el formato inválido sigue rechazándose antes que nada: un typo no cuesta un captcha", async () => {
    const res = await recoverAction({}, recoverForm("captcha-ok"));
    expect(res.done).toBe(true); // control: el email de arriba es válido

    const malo = new FormData();
    malo.set("email", "esto-no-es-un-email");
    malo.set("cf-turnstile-response", "captcha-ok");
    const res2 = await recoverAction({}, malo);

    expect(res2.error).toBeTruthy();
    expect(verifyTurnstile).toHaveBeenCalledTimes(1); // sólo la del control
  });

  it("la respuesta con el captcha resuelto sigue siendo idéntica exista o no la cuenta", async () => {
    // La anti-enumeración no se toca: el captcha corre igual en los dos casos
    // —antes de mirar la base— así que tampoco introduce una diferencia de
    // tiempo entre ellos.
    (passwordReset.request as MockedFn).mockResolvedValueOnce({ userId: 7, token: "RAW" });
    const conCuenta = await recoverAction({}, recoverForm("captcha-ok"));
    (passwordReset.request as MockedFn).mockResolvedValueOnce(null);
    const sinCuenta = await recoverAction({}, recoverForm("captcha-ok"));

    expect(conCuenta).toEqual({ done: true });
    expect(sinCuenta).toEqual(conCuenta);
    expect(verifyTurnstile).toHaveBeenCalledTimes(2);
  });
});
