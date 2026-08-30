import { describe, expect, it } from "vitest";
import { isValidInstitutionalDocFileName } from "@/lib/institutional-documents/doc-name";
import {
  DOCUMENT_TYPE_LABELS,
  duplicateYearMessage,
  pdfDownloadName,
  prepareDocumentInput,
  requiresYear,
} from "@/lib/institutional-documents/rules";

const UUID = "123e4567-e89b-42d3-a456-426614174000";

describe("isValidInstitutionalDocFileName", () => {
  it("acepta uuid.pdf", () => {
    expect(isValidInstitutionalDocFileName(`${UUID}.pdf`)).toBe(true);
  });
  // Única defensa anti-traversal antes de concatenar al filesystem: mismo
  // criterio que isValidNewsImageName (tests/news-images.test.ts).
  it("rechaza traversal, separadores, byte nulo y extensiones ajenas", () => {
    expect(isValidInstitutionalDocFileName("../secret.pdf")).toBe(false);
    expect(isValidInstitutionalDocFileName(`..\\${UUID}.pdf`)).toBe(false);
    expect(isValidInstitutionalDocFileName(`/etc/passwd`)).toBe(false);
    expect(isValidInstitutionalDocFileName(`${UUID}.pdf\0.txt`)).toBe(false);
    expect(isValidInstitutionalDocFileName(`${UUID}.pdf\n`)).toBe(false);
    expect(isValidInstitutionalDocFileName(`${UUID}.exe`)).toBe(false);
    expect(isValidInstitutionalDocFileName(`${UUID}.pdf.html`)).toBe(false);
    expect(isValidInstitutionalDocFileName(`${UUID.toUpperCase()}.pdf`)).toBe(false);
    expect(isValidInstitutionalDocFileName("")).toBe(false);
  });
});

describe("requiresYear", () => {
  it("solo memorias y balances exigen año", () => {
    expect(requiresYear("annual_report")).toBe(true);
    expect(requiresYear("balance")).toBe(true);
    expect(requiresYear("norm")).toBe(false);
    expect(requiresYear("other")).toBe(false);
  });
});

describe("prepareDocumentInput", () => {
  it("deriva el título de memorias y balances por tipo y año", () => {
    const memoria = prepareDocumentInput({ type: "annual_report", year: 2025 });
    expect(memoria).toMatchObject({
      ok: true,
      data: { title: "Memoria 2025", yearKey: "annual_report:2025", year: 2025 },
    });
    const balance = prepareDocumentInput({ type: "balance", year: 2024 });
    expect(balance).toMatchObject({
      ok: true,
      data: { title: "Balance 2024", yearKey: "balance:2024" },
    });
  });

  // El mensaje lo lee el operador: la preposición se deriva del artículo del
  // tipo, no se hardcodea ("de la Memoria" pero "del Balance").
  it("rechaza memoria/balance sin año, con el tipo y su preposición en el mensaje", () => {
    const memoria = prepareDocumentInput({ type: "annual_report" });
    expect(memoria).toMatchObject({ ok: false });
    if (!memoria.ok) expect(memoria.error).toBe("Ingresá el año de la Memoria.");
    const balance = prepareDocumentInput({ type: "balance" });
    expect(balance).toMatchObject({ ok: false });
    if (!balance.ok) expect(balance.error).toBe("Ingresá el año del Balance.");
  });

  it("normas y otros exigen título libre y no llevan yearKey", () => {
    const ok = prepareDocumentInput({ type: "norm", title: "Estatuto social", year: 2019 });
    expect(ok).toMatchObject({
      ok: true,
      data: { title: "Estatuto social", yearKey: null, year: 2019 },
    });
    expect(prepareDocumentInput({ type: "norm" })).toMatchObject({ ok: false });
    expect(prepareDocumentInput({ type: "other", title: "Convenio" })).toMatchObject({
      ok: true,
      data: { yearKey: null, year: null },
    });
  });

  it("featured solo prende en normas; en el resto se ignora", () => {
    const norm = prepareDocumentInput({ type: "norm", title: "Estatuto", featured: true });
    expect(norm).toMatchObject({ ok: true, data: { featured: true } });
    const memoria = prepareDocumentInput({ type: "annual_report", year: 2025, featured: true });
    expect(memoria).toMatchObject({ ok: true, data: { featured: false } });
    // Rama de título libre: acá `featured` NO está hardcodeado en false, así que
    // es la única que ejercita la cláusula `type === "norm"` (un POST forjado
    // sobre un documento cualquiera no puede colar el destacado).
    const otro = prepareDocumentInput({ type: "other", title: "x", featured: true });
    expect(otro).toMatchObject({ ok: true, data: { featured: false } });
  });

  it("la descripción vacía o en blanco queda null", () => {
    const r = prepareDocumentInput({ type: "other", title: "x" });
    expect(r).toMatchObject({ ok: true, data: { description: null } });
    const blanco = prepareDocumentInput({ type: "other", title: "x", description: "   " });
    expect(blanco).toMatchObject({ ok: true, data: { description: null } });
    const con = prepareDocumentInput({ type: "other", title: "x", description: "Aprobado en asamblea." });
    expect(con).toMatchObject({ ok: true, data: { description: "Aprobado en asamblea." } });
  });

  it("un título de solo espacios no alcanza", () => {
    expect(prepareDocumentInput({ type: "other", title: "   " })).toMatchObject({ ok: false });
  });
});

describe("duplicateYearMessage", () => {
  it("nombra el tipo con su artículo y el año", () => {
    expect(duplicateYearMessage("annual_report", 2025)).toBe(
      "Ya hay una Memoria 2025 cargada: editá la existente.",
    );
    expect(duplicateYearMessage("balance", 2024)).toBe(
      "Ya hay un Balance 2024 cargado: editá el existente.",
    );
  });
});

describe("pdfDownloadName", () => {
  it("slugifica el título y agrega .pdf", () => {
    expect(pdfDownloadName("Memoria 2025")).toBe("memoria-2025.pdf");
    expect(pdfDownloadName("Estatuto social")).toBe("estatuto-social.pdf");
  });
});

describe("DOCUMENT_TYPE_LABELS", () => {
  it("cubre los cuatro tipos", () => {
    expect(Object.keys(DOCUMENT_TYPE_LABELS).sort()).toEqual(
      ["annual_report", "balance", "norm", "other"].sort(),
    );
  });

  // En la columna "Tipo" del panel, "Documento" no distinguía nada frente a
  // Norma / Memoria / Balance.
  it("el tipo suelto se lee como Otro documento", () => {
    expect(DOCUMENT_TYPE_LABELS.other).toBe("Otro documento");
  });
});
