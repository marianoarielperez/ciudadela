import { describe, expect, it } from "vitest";
import { checkEligibility, REJECTION_BLOCK_MONTHS } from "@/lib/applications/eligibility";

const NOW = new Date("2026-08-20T15:00:00Z");
const base = { member: null, liveApplication: null, lastRejectionAt: null, now: NOW };
type M = NonNullable<Parameters<typeof checkEligibility>[0]["member"]>;
const member = (o: Partial<M>): M => ({
  id: 7,
  status: "withdrawn",
  withdrawalReason: null,
  pendingFees: 0,
  reentryBlocked: false,
  rejectedUntil: null,
  ...o,
});

describe("checkEligibility", () => {
  it("DNI desconocido → alta común", () => {
    expect(checkEligibility(base)).toEqual({ ok: true, memberId: null });
  });
  it("solicitud viva → in_progress (gana a cualquier otro estado)", () => {
    const r = checkEligibility({ ...base, liveApplication: { id: 33 }, member: member({ status: "active" }) });
    expect(r).toMatchObject({ ok: false, code: "in_progress", applicationId: 33 });
  });
  it("socio vigente y suspendido → already_member con el MISMO mensaje", () => {
    const a = checkEligibility({ ...base, member: member({ status: "active" }) });
    const s = checkEligibility({ ...base, member: member({ status: "suspended" }) });
    expect(a).toMatchObject({ ok: false, code: "already_member" });
    expect(s).toEqual(a); // no revelar la suspensión
  });
  it("expulsión asentada → expelled, nombrada con su ratificación por asamblea (decisión 27/08/2026)", () => {
    const r = checkEligibility({ ...base, member: member({ reentryBlocked: true, withdrawalReason: "expulsion" }) });
    expect(r).toMatchObject({ ok: false, code: "expelled" });
    const error = (r as { error: string }).error;
    expect(error).toMatch(/expulsión/);
    expect(error).toMatch(/asamblea/);
    expect(error).toMatch(/no puede reingresar/);
  });
  it("fallecimiento y anulación por duplicado → sede genérica, indistinguibles entre sí y del flag suelto", () => {
    const flagOnly = checkEligibility({ ...base, member: member({ reentryBlocked: true }) });
    expect(flagOnly).toMatchObject({ ok: false, code: "visit_office" });
    expect((flagOnly as { error: string }).error).not.toMatch(/expuls/i);
    for (const reason of ["death", "duplicate_annulment"] as const) {
      const r = checkEligibility({ ...base, member: member({ withdrawalReason: reason }) });
      expect(r).toEqual(flagOnly); // mismo objeto: no se puede distinguir desde afuera
    }
  });
  it("la expulsión gana a la deuda (precedencia de seguridad)", () => {
    const r = checkEligibility({
      ...base,
      member: member({ reentryBlocked: true, withdrawalReason: "expulsion", pendingFees: 1 }),
    });
    expect(r).toMatchObject({ ok: false, code: "expelled" });
  });
  it("la doble señal se separa: el motivo asentado nombra, el flag suelto no afirma nada", () => {
    // El flag puede venir sucio del import (fix-withdrawal-reasons pendiente):
    // nunca se afirma una expulsión que la ficha no registra como motivo.
    expect(checkEligibility({ ...base, member: member({ reentryBlocked: true }) })).toMatchObject({
      ok: false,
      code: "visit_office",
    });
    expect(checkEligibility({ ...base, member: member({ withdrawalReason: "expulsion" }) })).toMatchObject({
      ok: false,
      code: "expelled",
    });
  });
  it("bloquea por deuda real aunque la baja no haya sido por mora", () => {
    const r = checkEligibility({
      member: { id: 1, status: "withdrawn", withdrawalReason: "resignation", pendingFees: 2, reentryBlocked: false, rejectedUntil: null },
      liveApplication: null, lastRejectionAt: null, now: new Date(),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("debt");
  });
  it("cesante por mora que saldó la deuda vuelve a ser elegible sin tocar ningún flag (REG-16)", () => {
    // Decisión del cliente (22/08/2026): lo que bloquea es la DEUDA, no el
    // motivo histórico de la baja. El que pagó en la sede se rehabilita solo.
    const r = checkEligibility({ ...base, member: member({ withdrawalReason: "arrears", pendingFees: 0 }) });
    expect(r).toEqual({ ok: true, memberId: 7 });
  });
  it("cesante por mora que sigue debiendo → debt (sede)", () => {
    expect(
      checkEligibility({ ...base, member: member({ withdrawalReason: "arrears", pendingFees: 4 }) }),
    ).toMatchObject({ ok: false, code: "debt" });
  });
  it("rejectedUntil futuro → rejected_wait con la fecha", () => {
    const until = new Date("2026-11-01T12:00:00Z");
    const r = checkEligibility({ ...base, member: member({ rejectedUntil: until }) });
    expect(r).toMatchObject({ ok: false, code: "rejected_wait", retryAt: until });
  });
  it("Application rechazada hace <6 meses (sin ficha) → rejected_wait a +6 meses", () => {
    const rejected = new Date("2026-06-01T12:00:00Z");
    const r = checkEligibility({ ...base, lastRejectionAt: rejected });
    expect(r).toMatchObject({ ok: false, code: "rejected_wait" });
    const retry = (r as { retryAt: Date }).retryAt;
    expect(retry.getUTCMonth()).toBe(11); // junio + 6 = diciembre
  });
  it("rechazo viejo (>6 meses) ya no bloquea", () => {
    const r = checkEligibility({ ...base, lastRejectionAt: new Date("2025-08-01T12:00:00Z") });
    expect(r).toEqual({ ok: true, memberId: null });
  });
  it("ex socio sin deuda (renuncia/mudanza/no reempadronado) → ok con memberId (reingreso)", () => {
    for (const reason of ["resignation", "moved_away", "not_reregistered", "other"] as const) {
      const r = checkEligibility({ ...base, member: member({ withdrawalReason: reason }) });
      expect(r).toEqual({ ok: true, memberId: 7 });
    }
  });
  it("REJECTION_BLOCK_MONTHS es 6 (REG-05)", () => {
    expect(REJECTION_BLOCK_MONTHS).toBe(6);
  });
});
