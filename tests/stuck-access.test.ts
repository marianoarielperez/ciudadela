import { describe, expect, it } from "vitest";

import { classifyStuckAccess, INVITE_EXPIRING_HOURS } from "@/lib/admin/health";

const NOW = new Date("2026-08-29T12:00:00Z");
const hours = (n: number) => new Date(NOW.getTime() + n * 3_600_000);

const row = (over: Partial<{
  id: number; fullName: string; emailVerifiedAt: Date | null; tokens: Array<{ expiresAt: Date }>;
}> = {}) => ({
  id: 1, fullName: "Vecina Uno", emailVerifiedAt: hours(-72), tokens: [], ...over,
});

// La consulta ya trae SOLO invitaciones vivas (usedAt null, expiresAt > now):
// acá se decide únicamente la frescura.
describe("classifyStuckAccess (§7.3)", () => {
  it("sin invitación viva → listado como 'none' (el caso del socio 106 tras vencer)", () => {
    const out = classifyStuckAccess([row()], NOW);
    expect(out).toEqual([{
      memberId: 1, memberName: "Vecina Uno", verifiedAt: hours(-72),
      invite: "none", inviteExpiresAt: null,
    }]);
  });

  it("invitación viva pero por vencer (≤ 48 h) → listado como 'expiring'", () => {
    const expiresAt = hours(INVITE_EXPIRING_HOURS - 1);
    const out = classifyStuckAccess([row({ tokens: [{ expiresAt }] })], NOW);
    expect(out).toEqual([{
      memberId: 1, memberName: "Vecina Uno", verifiedAt: hours(-72),
      invite: "expiring", inviteExpiresAt: expiresAt,
    }]);
  });

  it("invitación fresca → NO se lista: es el transitorio normal entre verificar y elegir contraseña", () => {
    expect(classifyStuckAccess([row({ tokens: [{ expiresAt: hours(72) }] })], NOW)).toEqual([]);
  });

  it("el borde exacto de la ventana cuenta como por vencer", () => {
    const out = classifyStuckAccess([row({ tokens: [{ expiresAt: hours(INVITE_EXPIRING_HOURS) }] })], NOW);
    expect(out).toHaveLength(1);
    expect(out[0].invite).toBe("expiring");
  });

  // La ventana medida en horas ABSOLUTAS y no derivada de la constante: los
  // casos de arriba se escriben en términos de `INVITE_EXPIRING_HOURS`, así que
  // sobreviven a cualquier valor —incluido el 0, que apagaría el aviso entero—.
  // 48 de las 168 h del TTL es la decisión de §7.3 y acá es donde se defiende.
  it("la ventana son 48 horas: a 47 h se avisa y a 49 h todavía no", () => {
    expect(INVITE_EXPIRING_HOURS).toBe(48);
    expect(classifyStuckAccess([row({ tokens: [{ expiresAt: hours(47) }] })], NOW)).toHaveLength(1);
    expect(classifyStuckAccess([row({ tokens: [{ expiresAt: hours(49) }] })], NOW)).toEqual([]);
  });

  it("con más de una viva (no debería pasar: revocar-al-emitir) manda la que más lejos vence", () => {
    const far = hours(100);
    const out = classifyStuckAccess(
      [row({ tokens: [{ expiresAt: hours(10) }, { expiresAt: far }] })], NOW,
    );
    expect(out).toEqual([]); // la lejana es fresca: no se lista
  });
});
