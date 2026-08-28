// El builder puro del Excel del padrón electoral (REG-31 pide "Excel/PDF"; el
// CSV de la 4C fue una divergencia que este módulo cierra — decisión del
// 27/08/2026). Sin ExcelJS y sin base, igual que tests/members-export.test.ts:
// lo que se afirma es QUÉ sale en el archivo — hojas, columnas, filas — y qué NO.
import { describe, expect, it } from "vitest";
import type { ElectoralRoll, ElectoralRow } from "@/lib/members/electoral";
import { electoralWorkbookSpec } from "@/lib/members/electoral-export";

const row = (over: Partial<ElectoralRow> = {}): ElectoralRow => ({
  memberId: 1,
  memberNumber: 42,
  fullName: "Coñuecar, Marta",
  category: "active",
  joinedAt: new Date("2019-09-01T12:00:00Z"),
  arrears: 0,
  debt: null,
  ...over,
});

const roll = (over: Partial<ElectoralRoll> = {}): ElectoralRoll => ({
  at: new Date("2026-11-15T12:00:00Z"),
  period: "2026-11",
  considered: 0,
  withoutSeniority: [],
  enabled: [],
  toPurge: [],
  purgeFees: 0,
  purgeAmount: 0,
  ...over,
});

describe("electoralWorkbookSpec", () => {
  it("arma SIEMPRE las tres hojas, en el orden de la pantalla, aunque estén vacías", () => {
    const sheets = electoralWorkbookSpec(roll(), true);
    expect(sheets.map((s) => s.name)).toEqual([
      "Habilitados",
      "Con deuda a purgar",
      "No habilitados por antigüedad",
    ]);
    expect(sheets.every((s) => s.rows.length === 0)).toBe(true);
    // Regla de Excel: nombres de hoja de hasta 31 caracteres y sin : \ / ? * [ ]
    for (const s of sheets) {
      expect(s.name.length).toBeLessThanOrEqual(31);
      expect(s.name).not.toMatch(/[:\\/?*[\]]/);
    }
  });

  it("la hoja de habilitados lleva las columnas de REG-31 y ninguna de plata", () => {
    const [enabled] = electoralWorkbookSpec(roll({ enabled: [row()] }), true);
    expect(enabled.columns.map((c) => c.header)).toEqual([
      "numero_socio",
      "apellido_nombre",
      "categoria",
      "fecha_ingreso",
    ]);
    expect(enabled.rows[0]).toEqual({
      n: 42,
      name: "Coñuecar, Marta",
      cat: "Activo",
      in: new Date("2019-09-01T12:00:00Z"),
    });
  });

  it("la hoja de purga suma cuotas, monto nativo y la fila de total", () => {
    const sheets = electoralWorkbookSpec(
      roll({ toPurge: [row({ arrears: 3, debt: 18000 })], purgeFees: 3, purgeAmount: 18000 }),
      true,
    );
    const purge = sheets[1];
    expect(purge.columns.map((c) => c.header)).toEqual([
      "numero_socio",
      "apellido_nombre",
      "categoria",
      "fecha_ingreso",
      "cuotas_adeudadas",
      "monto_a_purgar",
    ]);
    expect(purge.rows[0]).toMatchObject({ fees: 3, amount: 18000 });
    expect(purge.totals).toMatchObject({ name: "Total a purgar", fees: 3, amount: 18000 });
  });

  it("sin valor de cuota vigente el monto va vacío, nunca un cero", () => {
    const sheets = electoralWorkbookSpec(
      roll({ toPurge: [row({ arrears: 2, debt: null })], purgeFees: 2, purgeAmount: 0 }),
      false,
    );
    expect(sheets[1].rows[0]).toMatchObject({ amount: null });
    expect(sheets[1].totals).toMatchObject({ amount: null });
  });

  it("una hoja de purga vacía no lleva fila de total", () => {
    expect(electoralWorkbookSpec(roll(), true)[1].totals).toBeUndefined();
  });

  it("la hoja de no habilitados dice desde cuándo puede votar cada uno", () => {
    const sheets = electoralWorkbookSpec(
      roll({ withoutSeniority: [row({ joinedAt: new Date("2026-10-01T12:00:00Z") })] }),
      true,
    );
    const block = sheets[2];
    expect(block.columns.map((c) => c.header)).toEqual([
      "numero_socio",
      "apellido_nombre",
      "categoria",
      "fecha_ingreso",
      "habilitado_desde",
    ]);
    // 01/10/2026 + 90 días = 30/12/2026, a mediodía UTC como toda fecha civil.
    expect(block.rows[0].from).toEqual(new Date("2026-12-30T12:00:00Z"));
  });

  it("el socio sin número va con la celda vacía, no con un guión", () => {
    const [enabled] = electoralWorkbookSpec(roll({ enabled: [row({ memberNumber: null })] }), true);
    expect(enabled.rows[0].n).toBeNull();
  });

  it("la categoría sale con la etiqueta del Libro, no el enum", () => {
    const [enabled] = electoralWorkbookSpec(roll({ enabled: [row({ category: "adherent" })] }), true);
    expect(enabled.rows[0].cat).toBe("Adherente");
  });

  it("ninguna hoja lleva DNI, email ni domicilio", () => {
    const sheets = electoralWorkbookSpec(roll({ enabled: [row()] }), true);
    const everything = JSON.stringify(sheets).toLowerCase();
    expect(everything).not.toContain("dni");
    expect(everything).not.toContain("email");
    expect(everything).not.toContain("domicilio");
  });

  it("las fechas van como Date nativas con numFmt dd/mm/yyyy, para que ordenen bien", () => {
    const sheets = electoralWorkbookSpec(roll({ enabled: [row()] }), true);
    const inCol = sheets[0].columns.find((c) => c.key === "in")!;
    expect(inCol.style).toEqual({ numFmt: "dd/mm/yyyy" });
    expect(sheets[0].rows[0].in).toBeInstanceOf(Date);
  });
});
