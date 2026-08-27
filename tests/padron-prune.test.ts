import { describe, expect, it } from "vitest";
import { IMPORT_ADMISSION_DETAIL, pruneBlockReasons, type PrunableMember } from "@/lib/padron/prune";

// Una ficha que entró SOLO por el import: su asiento de admisión y nada más.
// Es el único caso que `--prune` puede borrar.
const importedOnly = (over: Partial<PrunableMember> = {}): PrunableMember => ({
  user: null,
  _count: {
    applications: 0, mpSubscriptions: 0, payments: 0, fees: 0, memberships: 1,
    presentations: 0, feeExemptions: 0,
  },
  movements: [{ type: "admission", detail: IMPORT_ADMISSION_DETAIL }],
  withdrawalReason: "arrears",
  reentryBlocked: false,
  ...over,
});

describe("pruneBlockReasons", () => {
  it("does not block a member that only the import ever touched", () => {
    expect(pruneBlockReasons(importedOnly())).toEqual([]);
  });

  it("blocks on anything the system produced", () => {
    const cases: [Partial<PrunableMember>, RegExp][] = [
      [{ user: { id: 7 } }, /cuenta de acceso/],
      [{ _count: { applications: 1, mpSubscriptions: 0, payments: 0, fees: 0, memberships: 1, presentations: 0, feeExemptions: 0 } }, /solicitud/],
      [{ _count: { applications: 0, mpSubscriptions: 1, payments: 0, fees: 0, memberships: 1, presentations: 0, feeExemptions: 0 } }, /Mercado Pago/],
      [{ _count: { applications: 0, mpSubscriptions: 0, payments: 2, fees: 0, memberships: 1, presentations: 0, feeExemptions: 0 } }, /2 pago/],
      [{ _count: { applications: 0, mpSubscriptions: 0, payments: 0, fees: 21, memberships: 1, presentations: 0, feeExemptions: 0 } }, /21 cuota/],
      [{ _count: { applications: 0, mpSubscriptions: 0, payments: 0, fees: 0, memberships: 2, presentations: 0, feeExemptions: 0 } }, /1 libro/],
      [{ movements: [{ type: "withdrawal", detail: "Acta 12" }] }, /a mano/],
    ];
    for (const [over, re] of cases) {
      const reasons = pruneBlockReasons(importedOnly(over));
      expect(reasons).toHaveLength(1);
      expect(reasons[0]).toMatch(re);
    }
  });

  // Las presentaciones de re-empadronamiento (M6) son un referente más de la
  // ficha y su FK es `Restrict`: sin nombrarlas acá la poda igual no borra, pero
  // revienta con un error crudo de base a mitad de la transacción en vez del
  // mensaje que el operador puede resolver.
  it("blocks on re-registration presentations", () => {
    const reasons = pruneBlockReasons(
      importedOnly({
        _count: {
          applications: 0, mpSubscriptions: 0, payments: 0, fees: 0, memberships: 1,
          presentations: 1, feeExemptions: 0,
        },
      }),
    );
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toMatch(/presentación/i);
  });

  // Misma clase de referente y misma trampa: las dos FKs de `fee_exemptions`
  // son `Restrict`, así que sin nombrar la exención acá la poda no borra igual
  // —revienta con un error crudo de base— y el operador no se entera de que lo
  // que la traba es una decisión de la Comisión asentada en un acta.
  it("blocks on a recorded fee exemption", () => {
    const reasons = pruneBlockReasons(
      importedOnly({
        _count: {
          applications: 0, mpSubscriptions: 0, payments: 0, fees: 0, memberships: 1,
          presentations: 0, feeExemptions: 1,
        },
      }),
    );
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toMatch(/exención/i);
    // El acta es lo que el operador tiene que ir a buscar: sin nombrarla, el
    // motivo no le dice por dónde resolverlo.
    expect(reasons[0]).toMatch(/acta/i);
  });

  // REG-04 (Art. 5 inc. 2): el expulsado no reingresa jamás. Su ficha puede no
  // tener NADA colgando —la admisión del import y se acabó—, así que sin esta
  // regla desaparecer del Excel la borraba, y con ella las dos señales que mira
  // `eligibility.ts:64`: el DNI volvía a ser desconocido para el alta web.
  it("never prunes an expelled member, even with nothing else attached", () => {
    const reasons = pruneBlockReasons(importedOnly({ withdrawalReason: "expulsion", reentryBlocked: true }));
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toMatch(/REG-04/);
    expect(reasons[0]).toMatch(/Expulsión/);
  });

  // El mismo criterio doble que `canReadmit`, `reentryVerdict` y la puerta del
  // wizard: cualquiera de las dos señales alcanza. Hay fichas viejas con el
  // motivo puesto y el flag apagado, y el flag se prende también sobre otros
  // motivos.
  it("blocks on either signal alone", () => {
    expect(pruneBlockReasons(importedOnly({ withdrawalReason: "expulsion", reentryBlocked: false }))).toHaveLength(1);
    expect(pruneBlockReasons(importedOnly({ withdrawalReason: "arrears", reentryBlocked: true }))).toHaveLength(1);
  });

  // Decisión explícita (26/08/2026): fallecimiento y anulación por duplicado
  // desvían a la sede en `eligibility.ts:71`, pero NO son una prohibición
  // permanente de reingreso. Sacar esas fichas del libro es justo la limpieza
  // para la que existe `--prune`. Ver el reporte de la tarea.
  it("does not block on death or duplicate annulment by themselves", () => {
    expect(pruneBlockReasons(importedOnly({ withdrawalReason: "death" }))).toEqual([]);
    expect(pruneBlockReasons(importedOnly({ withdrawalReason: "duplicate_annulment" }))).toEqual([]);
  });

  // El motivo estatutario va PRIMERO: es el que el operador tiene que resolver
  // con un acta, no dando de baja una suscripción.
  it("reports the statutory block first when there is more than one reason", () => {
    const reasons = pruneBlockReasons(
      importedOnly({
        withdrawalReason: "expulsion",
        reentryBlocked: true,
        _count: {
          applications: 0, mpSubscriptions: 0, payments: 0, fees: 21, memberships: 1,
          presentations: 0, feeExemptions: 0,
        },
      }),
    );
    expect(reasons).toHaveLength(2);
    expect(reasons[0]).toMatch(/REG-04/);
    expect(reasons[1]).toMatch(/21 cuota/);
  });
});
