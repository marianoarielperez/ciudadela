// Smoke test del Word: que salga un .docx válido (ZIP: empieza con "PK") con
// el contenido del modelo adentro. La redacción ya la fija el test del modelo.
import { describe, expect, it } from "vitest";
import { renderMinuteDocx } from "@/lib/minutes/export-docx";
import type { MinuteExportModel } from "@/lib/minutes/export-content";

const MODEL: MinuteExportModel = {
  title: "Constancia de asientos del sistema",
  minuteLabel: "Comisión Directiva N° 124 — 15/08/2026",
  description: null,
  sections: [
    { heading: "Movimientos de socios",
      lines: ["Se asentó el alta de Juana Molina (DNI 12.345.678, socio N° 45)."] },
  ],
  totalLine: "1 asiento registrado en el sistema bajo esta acta.",
  footer: "Generada por SIGeV el 29/08/2026. Documento de uso interno: refleja únicamente los asientos registrados en el sistema, para incorporar al acta del libro.",
  fileBase: "acta-cd-124",
};

describe("renderMinuteDocx", () => {
  it("produce un ZIP OOXML", async () => {
    const bytes = await renderMinuteDocx(MODEL);
    expect(bytes.length).toBeGreaterThan(500);
    expect(bytes[0]).toBe(0x50); // "P"
    expect(bytes[1]).toBe(0x4b); // "K"
  });
});
