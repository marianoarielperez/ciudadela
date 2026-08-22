import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { renderReceiptPdf } from "@/lib/treasury/receipt-pdf";

describe("renderReceiptPdf", () => {
  it("produce un PDF A4 de una página", async () => {
    const bytes = await renderReceiptPdf({
      number: "2026-00001",
      issuedAt: new Date("2026-09-03T15:00:00Z"),
      memberName: "Skardius Ana Maria",
      memberNumber: 144,
      concept: "Cuota social · octubre a diciembre 2024 (3 cuotas)",
      methodLabel: "Efectivo",
      amount: 18000,
      voided: null,
    });
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getTitle()).toBe("Recibo 2026-00001 — Vecinal Ciudadela");
  });

  // Doce cuotas sueltas: el concepto ocupa tres renglones. Antes de contar las
  // líneas, el tercero se dibujaba encima de la fila "Medio de pago".
  it("un concepto largo no se sale de la única página", async () => {
    const bytes = await renderReceiptPdf({
      number: "2026-00003",
      issuedAt: new Date("2026-09-03T15:00:00Z"),
      memberName: "Gonzalez Maria de los Angeles",
      memberNumber: 305,
      concept:
        "Cuota social · enero 2024, marzo 2024, mayo 2024, julio 2024, septiembre 2024, " +
        "noviembre 2024, enero 2025, marzo 2025, mayo 2025, julio 2025, septiembre 2025, " +
        "noviembre 2025 (12 cuotas)",
      methodLabel: "Efectivo",
      amount: 72000,
      voided: null,
    });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it("un recibo anulado también se renderiza", async () => {
    const bytes = await renderReceiptPdf({
      number: "2026-00002", issuedAt: new Date(), memberName: "Muñoz Ñandú", memberNumber: null,
      concept: "Aporte voluntario", methodLabel: "Efectivo", amount: 1000, voided: { reason: "Cargado por error" },
    });
    expect(bytes.length).toBeGreaterThan(1000);
  });
});
