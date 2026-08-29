// Smoke test: que el PDF salga, sea PDF, y pagine. El contenido (la redacción)
// ya está fijado por tests/minute-export-content.test.ts sobre el modelo puro.
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { renderMinutePdf } from "@/lib/minutes/export-pdf";
import type { MinuteExportModel } from "@/lib/minutes/export-content";

const MODEL: MinuteExportModel = {
  title: "Constancia de asientos del sistema",
  minuteLabel: "Comisión Directiva N° 124 — 15/08/2026",
  description: "Exención de cuota — pintura de la sede",
  sections: [
    { heading: "Movimientos de socios",
      lines: ["Se asentó el alta de Juana Molina (DNI 12.345.678, socio N° 45)."] },
  ],
  totalLine: "1 asiento registrado en el sistema bajo esta acta.",
  footer: "Generada por SIGeV el 29/08/2026. Documento de uso interno: refleja únicamente los asientos registrados en el sistema, para incorporar al acta del libro.",
  fileBase: "acta-cd-124",
};

describe("renderMinutePdf", () => {
  it("produce un PDF de una hoja con el título del documento", async () => {
    const bytes = await renderMinutePdf(MODEL);
    expect(bytes.length).toBeGreaterThan(500);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getTitle()).toContain("Constancia de asientos");
  });

  it("con doscientos renglones abre más hojas", async () => {
    const bytes = await renderMinutePdf({
      ...MODEL,
      sections: [{
        heading: "Movimientos de socios",
        lines: Array.from({ length: 200 }, (_, i) =>
          `Se asentó el alta de Socio Número ${i + 1} (DNI 10.000.${String(i).padStart(3, "0")}).`),
      }],
    });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(1);
  });
});
