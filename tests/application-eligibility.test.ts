import { describe, expect, it } from "vitest";
import { checkEligibility, REJECTION_BLOCK_MONTHS } from "@/lib/applications/eligibility";

const NOW = new Date("2026-08-20T15:00:00Z");
const base = { member: null, liveApplication: null, lastRejectionAt: null, now: NOW };
type M = NonNullable<Parameters<typeof checkEligibility>[0]["member"]>;
const member = (o: Partial<M>): M => ({
  id: 7,
  status: "withdrawn",
  withdrawalReason: null,
  debtAtWithdrawal: false,
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
  it("expulsado → visit_office genérico (sin revelar el motivo)", () => {
    const r = checkEligibility({ ...base, member: member({ reentryBlocked: true, withdrawalReason: "expulsion" }) });
    expect(r).toMatchObject({ ok: false, code: "visit_office" });
    expect((r as { error: string }).error).not.toMatch(/expuls/i);
  });
  it("fallecimiento y anulación por duplicado → sede, indistinguibles de la expulsión", () => {
    const expelled = checkEligibility({
      ...base,
      member: member({ reentryBlocked: true, withdrawalReason: "expulsion" }),
    });
    for (const reason of ["death", "duplicate_annulment"] as const) {
      const r = checkEligibility({ ...base, member: member({ withdrawalReason: reason }) });
      expect(r).toEqual(expelled); // mismo objeto: no se puede distinguir desde afuera
    }
  });
  it("expulsión gana a la deuda (precedencia de seguridad)", () => {
    const r = checkEligibility({
      ...base,
      member: member({ reentryBlocked: true, withdrawalReason: "expulsion", debtAtWithdrawal: true }),
    });
    expect(r).toMatchObject({ ok: false, code: "visit_office" });
  });
  it("la doble señal de expulsión funciona por separado", () => {
    expect(checkEligibility({ ...base, member: member({ reentryBlocked: true }) })).toMatchObject({
      ok: false,
      code: "visit_office",
    });
    expect(checkEligibility({ ...base, member: member({ withdrawalReason: "expulsion" }) })).toMatchObject({
      ok: false,
      code: "visit_office",
    });
  });
  it("baja por mora o con deuda → debt (sede)", () => {
    expect(checkEligibility({ ...base, member: member({ withdrawalReason: "arrears" }) })).toMatchObject({
      ok: false,
      code: "debt",
    });
    expect(
      checkEligibility({ ...base, member: member({ withdrawalReason: "resignation", debtAtWithdrawal: true }) }),
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
