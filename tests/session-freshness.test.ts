import { describe, expect, it } from "vitest";
import {
  EXPIRED_SESSION_MESSAGE,
  SESSION_MAX_LIFETIME_MS,
  sessionExceededMaxLifetime,
  sessionPredatesPasswordChange,
  STALE_SESSION_MESSAGE,
} from "@/lib/auth/session-freshness";

// Milisegundos epoch, que es la unidad en la que viaja `session.user.authAt`.
const AUTH_AT = Date.parse("2026-08-19T10:00:00Z");
const at = (secondsFromAuth: number, ms = 0) => new Date(AUTH_AT + secondsFromAuth * 1000 + ms);

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

  // Los dos sellos están en milisegundos y se comparan exacto. Truncar al
  // segundo —como hacía la versión anterior— no regalaba "menos de un segundo":
  // los dos sellos son fijos, así que la sesión abierta dentro del mismo segundo
  // del cambio daba `false` en TODAS las comparaciones posteriores y quedaba
  // válida para siempre. Este test es el que mata ese truncado.
  it("kills a session opened milliseconds before the change, not just a second before", () => {
    expect(sessionPredatesPasswordChange(AUTH_AT, at(0, 1))).toBe(true);
    expect(sessionPredatesPasswordChange(AUTH_AT, at(0, 800))).toBe(true);
    expect(sessionPredatesPasswordChange(AUTH_AT, at(0, 999))).toBe(true);
  });

  // La tolerancia que motivaba el truncado no hace falta: los dos sellos salen
  // del mismo proceso Node y el login es estrictamente posterior a la escritura
  // de la contraseña, así que `authAt >= passwordChangedAt` siempre. Lo único
  // que hay que garantizar es que el empate exacto no eche a nadie.
  it("never makes a fresh login its own victim", () => {
    expect(sessionPredatesPasswordChange(AUTH_AT, at(0, 0))).toBe(false);
    expect(sessionPredatesPasswordChange(AUTH_AT, at(0, -1))).toBe(false);
    expect(sessionPredatesPasswordChange(AUTH_AT, at(0, -400))).toBe(false);
  });
});

// Las 8 horas del JWT son de INACTIVIDAD: Auth.js reescribe `exp` en cada
// re-firma, así que una sesión que se usa no vence sola. Sin este techo, la
// única forma de terminar una sesión robada es que alguien sospeche.
describe("sessionExceededMaxLifetime", () => {
  it("is seven days", () => {
    expect(SESSION_MAX_LIFETIME_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("keeps a session that has not reached the ceiling", () => {
    expect(sessionExceededMaxLifetime(AUTH_AT, AUTH_AT)).toBe(false);
    expect(sessionExceededMaxLifetime(AUTH_AT, AUTH_AT + 8 * 60 * 60 * 1000)).toBe(false);
    expect(sessionExceededMaxLifetime(AUTH_AT, AUTH_AT + SESSION_MAX_LIFETIME_MS)).toBe(false);
  });

  it("kills a session past the ceiling, however much it was used", () => {
    expect(sessionExceededMaxLifetime(AUTH_AT, AUTH_AT + SESSION_MAX_LIFETIME_MS + 1)).toBe(true);
    expect(sessionExceededMaxLifetime(AUTH_AT, AUTH_AT + 30 * 24 * 60 * 60 * 1000)).toBe(true);
  });

  // Misma dirección que la regla 2 de la comparación de contraseña: una sesión
  // que no puede probar cuándo empezó no puede probar que esté dentro del techo.
  it("fails closed on a stamp it cannot use", () => {
    for (const authAt of [null, undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(sessionExceededMaxLifetime(authAt, AUTH_AT), String(authAt)).toBe(true);
    }
  });

  // El efecto de borde de haber pasado el claim de segundos a milisegundos: un
  // token viejo trae ~1.7e9 donde ahora se esperan ~1.7e12, o sea 1970. Se
  // cierra, que es la dirección correcta y cuesta un login.
  it("kills a token still stamped in seconds", () => {
    expect(sessionExceededMaxLifetime(Math.floor(AUTH_AT / 1000), AUTH_AT)).toBe(true);
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

  // El techo tiene su propio texto: "venció por antigüedad" y "se cambió la
  // contraseña" son dos hechos distintos y el segundo pide una contraseña nueva.
  it("gives the ceiling its own reason, distinct from the password change", () => {
    expect(EXPIRED_SESSION_MESSAGE).not.toBe(STALE_SESSION_MESSAGE);
    expect(EXPIRED_SESSION_MESSAGE).toContain("Cerrá la sesión");
    expect(EXPIRED_SESSION_MESSAGE).toContain("volvé a ingresar");
    expect(EXPIRED_SESSION_MESSAGE).toContain("7 días");
    expect(EXPIRED_SESSION_MESSAGE).not.toContain("@");
  });
});
