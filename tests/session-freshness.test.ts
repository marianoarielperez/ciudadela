import { describe, expect, it } from "vitest";
import {
  sessionPredatesPasswordChange,
  STALE_SESSION_MESSAGE,
} from "@/lib/auth/session-freshness";

// Segundos epoch, que es la unidad en la que viaja `session.user.authAt`.
const AUTH_AT = Math.floor(Date.parse("2026-08-19T10:00:00Z") / 1000);
const at = (secondsFromAuth: number, ms = 0) => new Date((AUTH_AT + secondsFromAuth) * 1000 + ms);

describe("sessionPredatesPasswordChange", () => {
  it("kills a session opened before the password changed", () => {
    expect(sessionPredatesPasswordChange(AUTH_AT, at(1))).toBe(true);
    expect(sessionPredatesPasswordChange(AUTH_AT, at(60 * 60 * 24))).toBe(true);
  });

  it("keeps a session opened after the password changed", () => {
    expect(sessionPredatesPasswordChange(AUTH_AT, at(-1))).toBe(false);
    expect(sessionPredatesPasswordChange(AUTH_AT, at(-60 * 60 * 24))).toBe(false);
  });

  // Todas las filas anteriores a la migración que creó la columna. No sabemos
  // nada de ellas, y desloguear al mundo entero por no saberlo sería falso.
  it("keeps every session of an account that never changed its password", () => {
    expect(sessionPredatesPasswordChange(AUTH_AT, null)).toBe(false);
    expect(sessionPredatesPasswordChange(AUTH_AT, undefined)).toBe(false);
    expect(sessionPredatesPasswordChange(null, null)).toBe(false);
  });

  // Falla cerrada: una sesión emitida antes de que existiera el claim no puede
  // probar que sea posterior al cambio, y el costo de equivocarse es un login.
  it("fails closed when there is a password change but no usable authAt", () => {
    for (const authAt of [null, undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(sessionPredatesPasswordChange(authAt, at(-60)), String(authAt)).toBe(true);
    }
  });

  // El sello de la base tiene milisegundos y `authAt` no. Sin truncar los dos al
  // segundo, una cuenta creada a las 10:00:00.500 que entra a las 10:00:00.900 se
  // echaría a sí misma: el alta de contraseña y el login que le sigue ocurren
  // dentro del mismo segundo.
  it("compares truncated to the second, so a fresh login is never its own victim", () => {
    expect(sessionPredatesPasswordChange(AUTH_AT, at(0, 1))).toBe(false);
    expect(sessionPredatesPasswordChange(AUTH_AT, at(0, 999))).toBe(false);
    // Y un segundo después sí corta: la tolerancia no se estira más que eso.
    expect(sessionPredatesPasswordChange(AUTH_AT, at(1, 0))).toBe(true);
  });
});

describe("STALE_SESSION_MESSAGE", () => {
  // Es el mismo texto para el socio y para el administrador: el hecho es el
  // mismo. Y dice qué hacer, porque de estas pantallas no se puede redirigir al
  // login (el token sigue diciendo que hay sesión y el rebote no terminaría).
  it("tells the person what to do, in es-AR, without leaking anything", () => {
    expect(STALE_SESSION_MESSAGE).toContain("Cerrá la sesión");
    expect(STALE_SESSION_MESSAGE).toContain("volvé a ingresar");
    expect(STALE_SESSION_MESSAGE).not.toContain("@");
  });
});
