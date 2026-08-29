import { describe, expect, it } from "vitest";

import { classifyStuckAccess, INVITE_FRESH_HOURS } from "@/lib/admin/health";

const NOW = new Date("2026-08-29T12:00:00Z");
const hours = (n: number) => new Date(NOW.getTime() + n * 3_600_000);

/** TTL de la invitación (`TOKEN_TTL.password_invitation`): 7 días. Las filas del
 *  fixture lo respetan para que la antigüedad y el vencimiento no se contradigan. */
const TTL_HOURS = 168;

/** Una invitación viva EMITIDA hace `ageHours`. */
const token = (ageHours: number) => ({
  createdAt: hours(-ageHours),
  expiresAt: hours(TTL_HOURS - ageHours),
});

const row = (over: Partial<{
  id: number; fullName: string; emailVerifiedAt: Date | null;
  tokens: Array<{ createdAt: Date; expiresAt: Date }>;
}> = {}) => ({
  id: 1, fullName: "Vecina Uno", emailVerifiedAt: hours(-72), tokens: [], ...over,
});

// La consulta ya trae SOLO invitaciones vivas (usedAt null, expiresAt > now):
// acá se decide únicamente si la espera ya es demasiado larga.
describe("classifyStuckAccess (§7.3)", () => {
  it("sin invitación viva → listado como 'none' (el caso del socio 106 tras vencer)", () => {
    const out = classifyStuckAccess([row()], NOW);
    expect(out).toEqual([{
      memberId: 1, memberName: "Vecina Uno", verifiedAt: hours(-72),
      invite: "none", inviteExpiresAt: null,
    }]);
  });

  it("invitación recién emitida → NO se lista: es el transitorio normal entre verificar y elegir contraseña", () => {
    expect(classifyStuckAccess([row({ tokens: [token(1)] })], NOW)).toEqual([]);
  });

  it("invitación viva SIN USAR desde hace 48 h o más → listada como 'stale'", () => {
    // Con la regla vieja —"le quedan menos de 48 h para vencer"— este socio
    // quedaba invisible CINCO DÍAS. Y con `EMAIL_ALLOWLIST` puesta en producción
    // el correo de red no sale, así que esta pantalla es la única red que queda.
    const t = token(INVITE_FRESH_HOURS);
    const out = classifyStuckAccess([row({ tokens: [t] })], NOW);
    expect(out).toEqual([{
      memberId: 1, memberName: "Vecina Uno", verifiedAt: hours(-72),
      invite: "stale", inviteExpiresAt: t.expiresAt,
    }]);
  });

  it("el borde exacto cuenta como vieja: a las 48 h justas ya se lista", () => {
    expect(classifyStuckAccess([row({ tokens: [token(INVITE_FRESH_HOURS)] })], NOW)).toHaveLength(1);
    expect(classifyStuckAccess([row({ tokens: [token(INVITE_FRESH_HOURS - 1)] })], NOW)).toEqual([]);
  });

  // La ventana medida en horas ABSOLUTAS y no derivada de la constante: los
  // casos de arriba se escriben en términos de `INVITE_FRESH_HOURS`, así que
  // sobreviven a cualquier valor —incluido el 0, que listaría hasta al que
  // verificó recién y llenaría la pantalla de ruido—. 48 h de las 168 del TTL
  // es la decisión de §7.3 y acá es donde se defiende.
  it("la ventana son 48 horas: a 47 h todavía no se avisa y a 49 h sí", () => {
    expect(INVITE_FRESH_HOURS).toBe(48);
    expect(classifyStuckAccess([row({ tokens: [token(47)] })], NOW)).toEqual([]);
    expect(classifyStuckAccess([row({ tokens: [token(49)] })], NOW)).toHaveLength(1);
  });

  it("una invitación listada NO está por vencer: le quedan 5 de sus 7 días", () => {
    // Por eso el valor es `stale` y no `expiring`: lo que la pone en la lista es
    // que nadie la usó, no que se esté por caer. Y esa distancia al vencimiento
    // es justamente lo que hace barato el reenvío.
    const out = classifyStuckAccess([row({ tokens: [token(INVITE_FRESH_HOURS)] })], NOW);
    expect(out[0].invite).toBe("stale");
    expect(out[0].inviteExpiresAt).toEqual(hours(TTL_HOURS - INVITE_FRESH_HOURS));
  });

  it("con más de una viva (no debería pasar: revocar-al-emitir) manda la MÁS NUEVA", () => {
    // La que decide es la última emitida: si se reenvió hace una hora, el socio
    // tiene un enlace fresco en el buzón y no hay nada que destrabar todavía.
    expect(classifyStuckAccess([row({ tokens: [token(100), token(1)] })], NOW)).toEqual([]);
    // Y al revés: dos viejas siguen siendo una espera larga.
    expect(classifyStuckAccess([row({ tokens: [token(100), token(60)] })], NOW)).toHaveLength(1);
  });
});
