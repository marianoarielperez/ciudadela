import { describe, expect, it } from "vitest";
import { minuteExportModel, type MinuteExportInput } from "@/lib/minutes/export-content";

const BASE: MinuteExportInput = {
  type: "board", number: 124, date: new Date(Date.UTC(2026, 7, 15, 12)),
  description: null, movements: [], feeValues: [], applications: [],
  booksOpened: [], booksClosed: [], processesCalled: [], processesClosed: [],
  generatedAt: new Date(Date.UTC(2026, 7, 29, 12)),
};

const WHO = {
  member: { fullName: "Juana Molina", dni: "12345678" },
  memberNumber: 45, previousCategory: null, newCategory: null, reason: null,
};

describe("renglones transcribibles por tipo de movimiento", () => {
  const line = (mv: Partial<(typeof BASE)["movements"][number]> & { type: string }) => {
    const model = minuteExportModel({
      ...BASE,
      movements: [{ ...WHO, ...mv } as (typeof BASE)["movements"][number]],
    });
    return model.sections[0].lines[0];
  };

  it("alta, con DNI formateado y número de socio", () => {
    expect(line({ type: "admission" }))
      .toBe("Se asentó el alta de Juana Molina (DNI 12.345.678, socio N° 45).");
  });

  it("baja con motivo en minúscula", () => {
    expect(line({ type: "withdrawal", reason: "resignation" }))
      .toBe("Se asentó la baja de Juana Molina (DNI 12.345.678, socio N° 45), por renuncia.");
  });

  it("cambio de categoría nombra las dos", () => {
    expect(line({ type: "category_change", previousCategory: "adherent", newCategory: "active" }))
      .toBe("Se asentó el cambio de categoría de Juana Molina (DNI 12.345.678, socio N° 45): de Adherente a Activo.");
  });

  it("exención y anulación", () => {
    expect(line({ type: "fee_exemption" }))
      .toBe("Se asentó la exención de cuota de Juana Molina (DNI 12.345.678, socio N° 45).");
    expect(line({ type: "fee_exemption_revoked" }))
      .toBe("Se asentó la anulación de la exención de cuota de Juana Molina (DNI 12.345.678, socio N° 45).");
  });

  it("sin DNI y sin número de socio degrada con honestidad", () => {
    const model = minuteExportModel({
      ...BASE,
      movements: [{ ...WHO, member: { fullName: "Ana Paz", dni: null }, memberNumber: null,
        type: "admission" } as (typeof BASE)["movements"][number]],
    });
    expect(model.sections[0].lines[0]).toBe("Se asentó el alta de Ana Paz (sin DNI).");
  });
});

describe("las demás clases de asiento", () => {
  it("valor de cuota con montos ARS y vigencia", () => {
    const model = minuteExportModel({
      ...BASE,
      feeValues: [{ activeAmount: 5000, sharedAmount: 3500,
        validFrom: new Date(Date.UTC(2026, 8, 1, 12)) }],
    });
    expect(model.sections[0].heading).toBe("Valores de cuota");
    expect(model.sections[0].lines[0]).toBe(
      "Se fijó el valor de la cuota social en $ 5.000,00 (activos) y $ 3.500,00 " +
        "(adherentes y colaboradores), con vigencia desde el 01/09/2026.",
    );
  });

  it("solicitud asentada y rechazada", () => {
    const model = minuteExportModel({
      ...BASE,
      applications: [
        { fullName: "Ana Paz", dni: "30111222", status: "rejected" },
        { fullName: "Luis Sosa", dni: "28000111", status: "completed" },
      ],
    });
    expect(model.sections[0].lines).toEqual([
      "Se rechazó la solicitud de asociación de Ana Paz (DNI 30.111.222).",
      "Se asentó la solicitud de asociación de Luis Sosa (DNI 28.000.111).",
    ]);
  });

  it("libros y re-empadronamiento", () => {
    const model = minuteExportModel({
      ...BASE,
      booksOpened: [{ number: 2 }], booksClosed: [{ number: 1 }],
      processesCalled: [{ bookNumber: 1 }], processesClosed: [{ bookNumber: 1 }],
    });
    const lines = model.sections.flatMap((s) => s.lines);
    expect(lines).toContain("Se dispuso la apertura del Libro de Socios N° 2.");
    expect(lines).toContain("Se dispuso el cierre del Libro de Socios N° 1.");
    expect(lines).toContain("Se convocó al re-empadronamiento de los socios del Libro N° 1.");
    expect(lines).toContain("Se cerró el proceso de re-empadronamiento del Libro N° 1.");
  });
});

describe("el modelo del documento", () => {
  it("título, etiqueta del acta, total, pie y nombre de archivo", () => {
    const model = minuteExportModel({ ...BASE, movements: [
      { ...WHO, type: "admission" } as (typeof BASE)["movements"][number],
    ] });
    expect(model.title).toBe("Constancia de asientos del sistema");
    expect(model.minuteLabel).toBe("Comisión Directiva N° 124 — 15/08/2026");
    expect(model.totalLine).toBe("1 asiento registrado en el sistema bajo esta acta.");
    expect(model.footer).toContain("Generada por SIGeV el 29/08/2026");
    expect(model.footer).toContain("para incorporar al acta del libro");
    expect(model.fileBase).toBe("acta-cd-124");
  });

  it("una asamblea sin asientos", () => {
    const model = minuteExportModel({ ...BASE, type: "assembly", number: 3 });
    expect(model.fileBase).toBe("acta-asamblea-3");
    expect(model.sections).toEqual([]);
    expect(model.totalLine).toBe("Sin asientos registrados en el sistema bajo esta acta.");
  });
});
