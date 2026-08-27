import { describe, expect, it } from "vitest";
import { dniCheckVerdict } from "@/lib/applications/dni-check";
import { maskedName } from "@/lib/members/masked-name";

// La tabla del veredicto del paso "Tu DNI". La PRECEDENCIA no se re-testea acá
// entera —la dicta `checkEligibility` y la fija tests/application-eligibility.
// test.ts—; lo que este archivo fija es la capa de PRIVACIDAD del paso 1:
//   1. el reingreso habilitado es INDISTINGUIBLE del DNI desconocido;
//   2. el nombre sólo viaja enmascarado, nunca completo;
//   3. `in_progress` no lleva nombre (habla de la solicitud, no de la ficha);
//   4. `ok` no lleva memberId ni ningún otro campo.
const NOW = new Date("2026-08-27T15:00:00Z");

function member(over: Partial<{
  status: "active" | "suspended" | "withdrawn";
  withdrawalReason: string | null;
  reentryBlocked: boolean;
  rejectedUntil: Date | null;
  pendingFees: number;
}> = {}) {
  return {
    id: 42,
    fullName: "Castillo Nestor",
    status: over.status ?? ("withdrawn" as const),
    withdrawalReason: over.withdrawalReason === undefined ? ("resignation" as const) : over.withdrawalReason,
    reentryBlocked: over.reentryBlocked ?? false,
    rejectedUntil: over.rejectedUntil ?? null,
    pendingFees: over.pendingFees ?? 0,
  } as Parameters<typeof dniCheckVerdict>[0]["member"];
}

const base = { member: null, liveApplication: null, lastRejectionAt: null, now: NOW };

describe("dniCheckVerdict — el ok indistinguible", () => {
  it("un DNI desconocido continúa", () => {
    expect(dniCheckVerdict(base)).toStrictEqual({ ok: true });
  });

  it("un ex-socio habilitado (renuncia, sin deuda) contesta EXACTAMENTE lo mismo", () => {
    // Igualdad estructural estricta contra el MISMO literal del caso anterior:
    // ningún campo extra —memberId, bandera, nombre— puede separar los dos
    // casos leyendo la respuesta (decisión del operador #10).
    expect(dniCheckVerdict({ ...base, member: member() })).toStrictEqual({ ok: true });
  });

  it("el cesante por mora que saldó también continúa, indistinguible", () => {
    expect(
      dniCheckVerdict({ ...base, member: member({ withdrawalReason: "arrears" }) }),
    ).toStrictEqual({ ok: true });
  });
});

describe("dniCheckVerdict — bloqueos", () => {
  it("socio vigente: already_member con el nombre ENMASCARADO", () => {
    const res = dniCheckVerdict({ ...base, member: member({ status: "active", withdrawalReason: null }) });

    expect(res).toStrictEqual({
      ok: false,
      code: "already_member",
      maskedName: maskedName("Castillo Nestor"),
    });
    // La garantía que importa: el nombre completo no sale, ni adentro de otro campo.
    expect(JSON.stringify(res)).not.toContain("Castillo");
    expect(JSON.stringify(res)).not.toContain("Nestor");
  });

  it("suspendido: el mismo already_member (no se revela la suspensión)", () => {
    expect(
      dniCheckVerdict({ ...base, member: member({ status: "suspended", withdrawalReason: null }) }),
    ).toStrictEqual({
      ok: false,
      code: "already_member",
      maskedName: maskedName("Castillo Nestor"),
    });
  });

  it("solicitud viva: in_progress SIN nombre y SIN applicationId", () => {
    const res = dniCheckVerdict({
      ...base,
      member: member({ status: "active", withdrawalReason: null }),
      liveApplication: { id: 99 },
    });

    // Sin nombre a propósito: el veredicto habla de la solicitud, no de la
    // ficha, y sumarle el nombre sería puro oráculo. Y el id jamás sale.
    expect(res).toStrictEqual({ ok: false, code: "in_progress", maskedName: null });
    expect(JSON.stringify(res)).not.toContain("99");
  });

  it("deuda viva: debt con la CANTIDAD de cuotas (decisión del operador #7)", () => {
    expect(
      dniCheckVerdict({ ...base, member: member({ pendingFees: 7 }) }),
    ).toStrictEqual({
      ok: false,
      code: "debt",
      maskedName: maskedName("Castillo Nestor"),
      pendingCount: 7,
    });
  });

  it.each([
    ["expulsión", member({ withdrawalReason: "expulsion" })],
    ["reentryBlocked sin motivo", member({ withdrawalReason: null, reentryBlocked: true })],
    ["fallecimiento", member({ withdrawalReason: "death" })],
    ["anulación por duplicado", member({ withdrawalReason: "duplicate_annulment" })],
  ])("%s: visit_office, indistinguibles entre sí", (_label, m) => {
    expect(dniCheckVerdict({ ...base, member: m })).toStrictEqual({
      ok: false,
      code: "visit_office",
      maskedName: maskedName("Castillo Nestor"),
    });
  });

  it("la expulsión gana a la deuda (precedencia heredada de checkEligibility)", () => {
    expect(
      dniCheckVerdict({ ...base, member: member({ withdrawalReason: "expulsion", pendingFees: 5 }) }),
    ).toMatchObject({ code: "visit_office" });
  });

  it("rechazo reciente sobre la ficha: rejected_wait con la fecha y el nombre", () => {
    const until = new Date("2026-11-01T12:00:00Z");
    expect(
      dniCheckVerdict({ ...base, member: member({ rejectedUntil: until }) }),
    ).toStrictEqual({
      ok: false,
      code: "rejected_wait",
      maskedName: maskedName("Castillo Nestor"),
      retryAt: until,
    });
  });

  it("rechazo reciente SIN ficha: rejected_wait sin nombre", () => {
    const res = dniCheckVerdict({
      ...base,
      lastRejectionAt: new Date("2026-06-27T12:00:00Z"), // + 6 meses > NOW
    });
    expect(res).toMatchObject({ ok: false, code: "rejected_wait", maskedName: null });
  });
});
