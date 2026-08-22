import { describe, expect, it } from "vitest";
import { civilDateUtc } from "@/lib/dates";
import { planDebtImport } from "@/lib/treasury/debt-import";

// deuda.xlsx es una FOTO: dice cuántas cuotas debía cada socio el 21/08/2026.
// El reloj se inyecta en todos los casos para que el resultado no cambie cuando
// el calendario avance — con `new Date()` real, el caso del año en curso
// (2026 = enero..agosto) empezaría a dar otra cosa en 2027 y el test que
// protege la regla más delicada del import se volvería ruido.
const NOW = new Date("2026-08-21T15:00:00Z"); // período en curso: 2026-08

describe("planDebtImport", () => {
  it("asigna N cuotas a los últimos N meses de cada año cerrado", () => {
    const { plans, errors } = planDebtImport(
      [{ memberNumber: 144, dni: "1", counts: { 2022: 0, 2023: 0, 2024: 3, 2025: 12 }, leftAt: null }],
      NOW,
    );
    expect(errors).toEqual([]);
    expect(plans[0].periods).toEqual([
      "2024-10", "2024-11", "2024-12",
      "2025-01", "2025-02", "2025-03", "2025-04", "2025-05", "2025-06",
      "2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12",
    ]);
  });

  it("el año en curso cuenta hacia atrás desde el mes corriente, no desde diciembre", () => {
    // 8 cuotas de 2026 leídas en agosto de 2026 son enero..agosto. Contarlas
    // como "los últimos 8 meses del año" (mayo..diciembre) inventaría cuatro
    // cuotas de meses que todavía no se devengaron.
    const { plans, errors } = planDebtImport(
      [{ memberNumber: 144, dni: "1", counts: { 2026: 8 }, leftAt: null }],
      NOW,
    );
    expect(errors).toEqual([]);
    expect(plans[0].periods).toEqual([
      "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08",
    ]);
    expect(plans[0].periods.every((p) => p <= "2026-08")).toBe(true);
  });

  it("para una baja, el año de la baja cuenta hacia atrás desde el mes de egreso", () => {
    const { plans, errors } = planDebtImport(
      [{ memberNumber: 1, dni: "2", counts: { 2024: 12, 2025: 8, 2026: null }, leftAt: civilDateUtc(2025, 8, 31) }],
      NOW,
    );
    expect(errors).toEqual([]);
    expect(plans[0].periods.slice(-8)).toEqual([
      "2025-01", "2025-02", "2025-03", "2025-04", "2025-05", "2025-06", "2025-07", "2025-08",
    ]);
    expect(plans[0].periods).toHaveLength(20);
  });

  it("devuelve los períodos ordenados y sin repetir", () => {
    const { plans } = planDebtImport(
      [{ memberNumber: 5, dni: "5", counts: { 2025: 2, 2023: 1, 2024: 2 }, leftAt: null }],
      NOW,
    );
    expect(plans[0].periods).toEqual(["2023-12", "2024-11", "2024-12", "2025-11", "2025-12"]);
    expect(new Set(plans[0].periods).size).toBe(plans[0].periods.length);
  });

  it("blancos y ceros no generan cuotas; un adherente sin datos no aparece", () => {
    const { plans, errors } = planDebtImport(
      [{ memberNumber: 3, dni: "3", counts: { 2025: null, 2026: null }, leftAt: null }],
      NOW,
    );
    expect(errors).toEqual([]);
    expect(plans).toEqual([]);
  });

  it("rechaza cantidades imposibles", () => {
    const { errors } = planDebtImport([{ memberNumber: 4, dni: "4", counts: { 2025: 13 }, leftAt: null }], NOW);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("socio 4");
    expect(errors[0]).toContain("2025");
  });

  it("rechaza un decimal y un negativo", () => {
    const { errors } = planDebtImport(
      [{ memberNumber: 6, dni: "6", counts: { 2024: 1.5, 2025: -2 }, leftAt: null }],
      NOW,
    );
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain("cuotas_deuda_2024");
    expect(errors[1]).toContain("cuotas_deuda_2025");
  });

  it("rechaza más cuotas que meses devengados en el año en curso", () => {
    const { errors } = planDebtImport([{ memberNumber: 7, dni: "7", counts: { 2026: 9 }, leftAt: null }], NOW);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("socio 7");
    expect(errors[0]).toContain("2026-08");
  });

  it("rechaza más cuotas que meses hasta la baja", () => {
    const { errors } = planDebtImport(
      [{ memberNumber: 8, dni: "8", counts: { 2025: 9 }, leftAt: civilDateUtc(2025, 8, 31) }],
      NOW,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("socio 8");
    expect(errors[0]).toContain("2025-08");
  });

  it("rechaza deuda de un año posterior a la baja", () => {
    const { errors } = planDebtImport(
      [{ memberNumber: 9, dni: "9", counts: { 2026: 1 }, leftAt: civilDateUtc(2025, 8, 31) }],
      NOW,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("baja");
  });

  it("rechaza un año que todavía no devengó nada", () => {
    const { errors } = planDebtImport([{ memberNumber: 10, dni: "10", counts: { 2027: 1 }, leftAt: null }], NOW);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("2027");
  });

  it("una fila con error no produce plan aunque otros años sean válidos", () => {
    // El script aborta ante cualquier error, pero el planificador no puede
    // devolver un plan a medias: si un llamador futuro mirara solo `plans`,
    // cargaría deuda incompleta sobre un socio real.
    const { plans, errors } = planDebtImport(
      [
        { memberNumber: 11, dni: "11", counts: { 2024: 12, 2025: 13 }, leftAt: null },
        { memberNumber: 12, dni: "12", counts: { 2024: 1 }, leftAt: null },
      ],
      NOW,
    );
    expect(errors).toHaveLength(1);
    expect(plans.map((p) => p.memberNumber)).toEqual([12]);
  });

  it("el reloj por defecto es el de sistema", () => {
    // Sin `now` explícito el planificador tiene que seguir funcionando: es como
    // lo llama el script.
    const { errors } = planDebtImport([{ memberNumber: 13, dni: "13", counts: { 2022: 3 }, leftAt: null }]);
    expect(errors).toEqual([]);
  });
});
