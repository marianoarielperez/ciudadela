import { describe, expect, it } from "vitest";
import { civilDateUtc } from "@/lib/dates";
import {
  accrues, allocate, arrearsLevel, cashConceptsFor, categoryPaysFee, coverageFloor, debtAmount,
  feeAmountFor, firstAccrualPeriod, IMPORT_COVERAGE_FLOOR, revertFees,
} from "@/lib/treasury/rules";
import { describePeriods, paymentConcept } from "@/lib/treasury/labels";

const V = { activeAmount: 6000, sharedAmount: 3000 };

describe("feeAmountFor", () => {
  it("activo paga el monto de activo; adherente y colaborador el compartido", () => {
    expect(feeAmountFor("active", V)).toBe(6000);
    expect(feeAmountFor("adherent", V)).toBe(3000);
    expect(feeAmountFor("collaborator", V)).toBe(3000);
  });
  it("honorario, vitalicio y cadete no pagan", () => {
    expect(feeAmountFor("honorary", V)).toBeNull();
    expect(feeAmountFor("lifetime", V)).toBeNull();
    expect(feeAmountFor("cadet", V)).toBeNull();
  });
});

describe("categoryPaysFee", () => {
  // Contesta la mitad de `feeAmountFor` que NO depende de que haya valor
  // vigente: sin este predicado, una pantalla sin valor registrado le dice a un
  // socio activo "tu categoría no paga cuota", y a un vitalicio "el valor
  // todavía no está publicado". Las dos son mentiras con salidas opuestas.
  it("coincide con feeAmountFor para las seis categorías, haya o no valor", () => {
    for (const c of ["active", "adherent", "collaborator"] as const) {
      expect(categoryPaysFee(c)).toBe(true);
      expect(feeAmountFor(c, V)).not.toBeNull();
    }
    for (const c of ["honorary", "lifetime", "cadet"] as const) {
      expect(categoryPaysFee(c)).toBe(false);
      expect(feeAmountFor(c, V)).toBeNull();
    }
  });
});

describe("firstAccrualPeriod / accrues", () => {
  it("la primera cuota es el primer mes completo posterior al ingreso", () => {
    expect(firstAccrualPeriod(civilDateUtc(2026, 8, 21))).toBe("2026-09");
    expect(firstAccrualPeriod(civilDateUtc(2026, 9, 1))).toBe("2026-10");
    expect(firstAccrualPeriod(civilDateUtc(2025, 12, 31))).toBe("2026-01");
  });
  it("devengan activos y colaboradores vigentes o suspendidos", () => {
    const joined = civilDateUtc(2026, 8, 21);
    expect(accrues({ status: "active", category: "active", joinedAt: joined }, "2026-09")).toBe(true);
    expect(accrues({ status: "suspended", category: "collaborator", joinedAt: joined }, "2026-09")).toBe(true);
    expect(accrues({ status: "withdrawn", category: "active", joinedAt: joined }, "2026-09")).toBe(false);
  });
  it("no devengan adherentes, honorarios, vitalicios ni cadetes", () => {
    const joined = civilDateUtc(2020, 1, 1);
    for (const category of ["adherent", "honorary", "lifetime", "cadet"] as const) {
      expect(accrues({ status: "active", category, joinedAt: joined }, "2026-09")).toBe(false);
    }
  });
  it("no devenga antes del primer mes completo", () => {
    const joined = civilDateUtc(2026, 8, 21);
    expect(accrues({ status: "active", category: "active", joinedAt: joined }, "2026-08")).toBe(false);
  });
});

describe("arrearsLevel (REG-15)", () => {
  it("0 al día, 1 una cuota, 2 desde la segunda, 4 desde la cuarta", () => {
    expect(arrearsLevel(0)).toBe(0);
    expect(arrearsLevel(1)).toBe(1);
    expect(arrearsLevel(2)).toBe(2);
    expect(arrearsLevel(3)).toBe(2);
    expect(arrearsLevel(4)).toBe(4);
    expect(arrearsLevel(23)).toBe(4);
  });
});

describe("debtAmount (REG-16)", () => {
  it("cuotas pendientes × valor vigente de la categoría", () => {
    expect(debtAmount(23, "active", V)).toBe(138000);
    expect(debtAmount(4, "collaborator", V)).toBe(12000);
    expect(debtAmount(3, "honorary", V)).toBe(0);
  });
});

describe("coverageFloor", () => {
  // La foto de deuda (21/08/2026) contó los impagos hasta agosto INCLUSIVE: el
  // primer período que NO cubre es septiembre. Sale del archivo, no de un
  // literal suelto — si algún día se re-mide el padrón, el piso se mueve con él.
  it("el piso del padrón es el mes siguiente a la foto de deuda", () => {
    expect(IMPORT_COVERAGE_FLOOR).toBe("2026-09");
  });
  it("un socio viejo del padrón tiene el piso de la foto", () => {
    expect(coverageFloor({ joinedAt: civilDateUtc(1998, 3, 12) })).toBe("2026-09");
  });
  it("un alta anterior a la foto no baja el piso", () => {
    // Martín (306): se asoció el 21/08/2026 y su cuota de ingreso cubre agosto.
    expect(coverageFloor({ joinedAt: civilDateUtc(2026, 8, 21) })).toBe("2026-09");
  });
  it("un alta posterior al padrón manda: la cuota de ingreso cubre el mes de alta", () => {
    expect(coverageFloor({ joinedAt: civilDateUtc(2026, 11, 4) })).toBe("2026-12");
  });
  it("el reingreso manda sobre joinedAt, que el reingreso NO toca (REG-11)", () => {
    // Sin este término, al ex socio que vuelve en noviembre se le crearían
    // cuotas de septiembre y octubre: meses en los que no fue socio.
    expect(coverageFloor({
      joinedAt: civilDateUtc(2005, 6, 1),
      readmittedAt: civilDateUtc(2026, 11, 18),
    })).toBe("2026-12");
  });
  it("un reingreso viejo no baja el piso de la foto", () => {
    expect(coverageFloor({
      joinedAt: civilDateUtc(2005, 6, 1),
      readmittedAt: civilDateUtc(2019, 4, 2),
    })).toBe("2026-09");
  });
  it("readmittedAt null o ausente dan lo mismo", () => {
    const joinedAt = civilDateUtc(2005, 6, 1);
    expect(coverageFloor({ joinedAt, readmittedAt: null })).toBe(coverageFloor({ joinedAt }));
  });
});

describe("allocate", () => {
  // `startAt` es el PISO DE COBERTURA del socio, no el mes calendario: la cuenta
  // corriente no tiene fila para lo que ya está cubierto, así que arrancar en el
  // mes en curso le volvía a cobrar ese mes a todo socio al día.
  it("imputa a las pendientes más antiguas primero", () => {
    const r = allocate({ pending: ["2025-03", "2024-11", "2025-01"], existing: [], n: 2, startAt: "2026-09" });
    expect(r.toPay).toEqual(["2024-11", "2025-01"]);
    expect(r.toCreate).toEqual([]);
  });
  it("si faltan pendientes crea desde el piso, salteando las que ya existen", () => {
    const r = allocate({ pending: ["2026-07"], existing: ["2026-07", "2026-08"], n: 3, startAt: "2026-09" });
    expect(r.toPay).toEqual(["2026-07", "2026-09", "2026-10"]);
    expect(r.toCreate).toEqual(["2026-09", "2026-10"]);
  });
  it("n = 0 no imputa nada", () => {
    expect(allocate({ pending: ["2026-01"], existing: ["2026-01"], n: 0, startAt: "2026-09" }))
      .toEqual({ toPay: [], toCreate: [] });
  });
  it("no duplica el piso cuando la pendiente aún no está en existing", () => {
    const r = allocate({ pending: ["2026-09"], existing: [], n: 2, startAt: "2026-09" });
    expect(r).toEqual({ toPay: ["2026-09", "2026-10"], toCreate: ["2026-10"] });
  });

  // Los casos canónicos que laudó el operador el 23/08/2026. Son la
  // especificación del piso: cada uno es un socio real del padrón o de producción.
  describe("los casos canónicos del piso de cobertura", () => {
    const floorPadron = coverageFloor({ joinedAt: civilDateUtc(1998, 3, 12) }); // 2026-09

    it("Rodrigo: socio del padrón sin filas paga 1 el 23/08 → septiembre, no agosto", () => {
      const r = allocate({ pending: [], existing: [], n: 1, startAt: floorPadron });
      expect(r).toEqual({ toPay: ["2026-09"], toCreate: ["2026-09"] });
    });

    it("Roberto en octubre: sin filas y sin haber pagado septiembre → septiembre primero", () => {
      // El piso puede quedar ANTERIOR al mes en curso: septiembre ya venció y es
      // lo primero que hay que cubrir.
      expect(allocate({ pending: [], existing: [], n: 1, startAt: floorPadron }))
        .toEqual({ toPay: ["2026-09"], toCreate: ["2026-09"] });
      expect(allocate({ pending: [], existing: [], n: 2, startAt: floorPadron }))
        .toEqual({ toPay: ["2026-09", "2026-10"], toCreate: ["2026-09", "2026-10"] });
    });

    it("Skardius: pendientes hasta 2026-08 y paga una más en agosto → las pendientes + septiembre", () => {
      const pending = ["2026-06", "2026-07", "2026-08"];
      const r = allocate({ pending, existing: [...pending], n: 4, startAt: floorPadron });
      expect(r.toPay).toEqual(["2026-06", "2026-07", "2026-08", "2026-09"]);
      expect(r.toCreate).toEqual(["2026-09"]);
    });

    it("Martín: alta del 21/08 con su 2026-08 ya paga, débito del 21/09 → septiembre", () => {
      const floor = coverageFloor({ joinedAt: civilDateUtc(2026, 8, 21) });
      const r = allocate({ pending: [], existing: ["2026-08"], n: 1, startAt: floor });
      expect(r).toEqual({ toPay: ["2026-09"], toCreate: ["2026-09"] });
    });

    it("alta posterior al padrón: ingreso en noviembre → diciembre, no septiembre", () => {
      const floor = coverageFloor({ joinedAt: civilDateUtc(2026, 11, 4) });
      const r = allocate({ pending: [], existing: [], n: 1, startAt: floor });
      expect(r).toEqual({ toPay: ["2026-12"], toCreate: ["2026-12"] });
    });

    it("reingreso de noviembre: la deuda congelada + 1 → diciembre, no septiembre", () => {
      const floor = coverageFloor({
        joinedAt: civilDateUtc(2005, 6, 1),
        readmittedAt: civilDateUtc(2026, 11, 18),
      });
      const pending = ["2025-04", "2025-05"];
      const r = allocate({ pending, existing: [...pending], n: 3, startAt: floor });
      expect(r.toPay).toEqual(["2025-04", "2025-05", "2026-12"]);
      expect(r.toCreate).toEqual(["2026-12"]);
    });

    it("el débito del socio 14 del 10/09 sigue cayendo en septiembre", () => {
      const r = allocate({ pending: [], existing: [], n: 1, startAt: floorPadron });
      expect(r).toEqual({ toPay: ["2026-09"], toCreate: ["2026-09"] });
    });
  });
});

describe("revertFees", () => {
  it("las cuotas de períodos futuros se borran, el resto vuelve a pendiente", () => {
    const r = revertFees(["2026-07", "2026-08", "2026-09", "2026-10"], "2026-08");
    expect(r.toPending).toEqual(["2026-07", "2026-08"]);
    expect(r.toDelete).toEqual(["2026-09", "2026-10"]);
  });
  it("el resultado no depende del orden de entrada (filas de la DB sin orden garantizado)", () => {
    const r = revertFees(["2026-10", "2026-07", "2026-09", "2026-08"], "2026-08");
    expect(r.toPending).toEqual(["2026-07", "2026-08"]);
    expect(r.toDelete).toEqual(["2026-09", "2026-10"]);
  });
});

describe("cashConceptsFor", () => {
  it("activo y colaborador: cuotas, voluntaria y extraordinaria", () => {
    expect(cashConceptsFor("active")).toEqual(["fees", "voluntary", "extraordinary"]);
    expect(cashConceptsFor("collaborator")).toEqual(["fees", "voluntary", "extraordinary"]);
  });
  it("adherente: voluntaria y extraordinaria; honorario/vitalicio/cadete: solo extraordinaria", () => {
    expect(cashConceptsFor("adherent")).toEqual(["voluntary", "extraordinary"]);
    expect(cashConceptsFor("honorary")).toEqual(["extraordinary"]);
    expect(cashConceptsFor("lifetime")).toEqual(["extraordinary"]);
    expect(cashConceptsFor("cadet")).toEqual(["extraordinary"]);
  });
});

describe("labels", () => {
  it("describePeriods resume rangos contiguos", () => {
    expect(describePeriods(["2025-03"])).toBe("marzo 2025");
    expect(describePeriods(["2025-03", "2025-04", "2025-05"])).toBe("marzo a mayo 2025 (3 cuotas)");
    expect(describePeriods(["2024-11", "2024-12", "2025-01"])).toBe("noviembre 2024 a enero 2025 (3 cuotas)");
    expect(describePeriods(["2025-01", "2025-03"])).toBe("enero 2025, marzo 2025 (2 cuotas)");
    expect(describePeriods([])).toBe("");
  });
  it("paymentConcept arma el concepto del recibo", () => {
    expect(paymentConcept("cash", ["2025-03", "2025-04"])).toBe("Cuota social · marzo a abril 2025 (2 cuotas)");
    expect(paymentConcept("voluntary", [])).toBe("Aporte voluntario");
    expect(paymentConcept("extraordinary", [])).toBe("Aporte extraordinario");
    expect(paymentConcept("entry", [])).toBe("Cuota de ingreso");
    expect(paymentConcept("debit", ["2026-09"])).toBe("Cuota social · septiembre 2026");
  });
  it("paymentConcept sin períodos cae en el genérico, nunca vacío", () => {
    expect(paymentConcept("cash", [])).toBe("Cuota social");
  });
});
