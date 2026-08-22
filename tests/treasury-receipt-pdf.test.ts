import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { PDFArray, PDFDocument, PDFName, PDFRawStream, StandardFonts } from "pdf-lib";
import { LINE_HEIGHT, VALUE_WIDTH, lineCount, renderReceiptPdf } from "@/lib/treasury/receipt-pdf";

// Doce cuotas sueltas: el concepto ocupa tres renglones al ancho de la fila.
const LONG_CONCEPT =
  "Cuota social · enero 2024, marzo 2024, mayo 2024, julio 2024, septiembre 2024, " +
  "noviembre 2024, enero 2025, marzo 2025, mayo 2025, julio 2025, septiembre 2025, " +
  "noviembre 2025 (12 cuotas)";

type Drawn = { text: string; x: number; y: number };

// pdf-lib no extrae texto. Lo que sí se puede sin sumar dependencias: abrir el
// PDF YA GUARDADO, descomprimir el content stream de la página y leer los pares
// `Tm` + `<hex> Tj`, que son literalmente la posición y los bytes de texto que
// el visor va a dibujar (fuentes estándar → WinAnsi, que en este rango coincide
// con latin1). Aserciones sobre esto prueban que la cadena llegó al archivo y en
// qué coordenada, no solo que alguien llamó a `drawText`.
async function drawnText(bytes: Uint8Array): Promise<Drawn[]> {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const contents = page.node.get(PDFName.of("Contents"));
  const refs = contents instanceof PDFArray ? contents.asArray() : [contents!];
  let stream = "";
  for (const ref of refs) {
    const obj = doc.context.lookup(ref);
    if (!(obj instanceof PDFRawStream)) continue;
    const raw = Buffer.from(obj.contents);
    stream += (obj.dict.get(PDFName.of("Filter")) ? inflateSync(raw) : raw).toString("latin1");
  }
  const out: Drawn[] = [];
  let x = 0;
  let y = 0;
  for (const line of stream.split("\n")) {
    const tm = /^1 0 0 1 (-?[\d.]+) (-?[\d.]+) Tm$/.exec(line.trim());
    if (tm) {
      x = Number(tm[1]);
      y = Number(tm[2]);
      continue;
    }
    const tj = /^<([0-9A-Fa-f]*)> Tj$/.exec(line.trim());
    if (tj) out.push({ text: Buffer.from(tj[1], "hex").toString("latin1"), x, y });
  }
  return out;
}

const yOf = (drawn: Drawn[], text: string): number => {
  const hit = drawn.find((d) => d.text === text);
  if (!hit) throw new Error(`No se dibujó "${text}" (sí: ${drawn.map((d) => d.text).join(" | ")})`);
  return hit.y;
};

describe("renderReceiptPdf", () => {
  it("produce un PDF A4 de una página con el número, el importe y el monto en letras", async () => {
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
    // A4 en puntos: si alguien cambia el tamaño de la hoja, el recibo deja de
    // entrar en el sobre y en la carpeta del libro.
    const { width, height } = doc.getPage(0).getSize();
    expect([Math.round(width), Math.round(height)]).toEqual([595, 842]);

    const drawn = await drawnText(bytes);
    const texts = drawn.map((d) => d.text);
    expect(texts).toContain("2026-00001"); // lo que el socio busca al reclamar
    expect(texts).toContain("$ 18.000,00");
    expect(texts).toContain("dieciocho mil pesos");
    expect(texts).toContain("03/09/2026");
    expect(texts).toContain("Skardius Ana Maria (socio N° 144)");
    expect(texts).not.toContain("ANULADO");
  });

  // Regresión del corte de líneas. La aserción es la DISTANCIA entre la etiqueta
  // del concepto y la de la fila siguiente: con el avance fijo de 22 pt anterior
  // el tercer renglón del concepto se dibujaba encima de "Medio de pago".
  // (`getPageCount() === 1` no servía: `drawText` nunca agrega páginas.)
  it("un concepto de tres renglones empuja la fila siguiente 2 renglones más abajo", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    expect(lineCount(LONG_CONCEPT, font, 11, VALUE_WIDTH)).toBe(3);

    const base = { number: "2026-00003", issuedAt: new Date("2026-09-03T15:00:00Z"),
      memberName: "Gonzalez Maria de los Angeles", memberNumber: 305,
      methodLabel: "Efectivo", amount: 72000, voided: null } as const;

    const short = await drawnText(await renderReceiptPdf({ ...base, concept: "Cuota social" }));
    const long = await drawnText(await renderReceiptPdf({ ...base, concept: LONG_CONCEPT }));

    expect(yOf(short, "CONCEPTO") - yOf(short, "MEDIO DE PAGO")).toBe(22);
    expect(yOf(long, "CONCEPTO") - yOf(long, "MEDIO DE PAGO")).toBe(22 + 2 * LINE_HEIGHT);
    // Y todo lo que sigue baja igual: el pie no se monta sobre nada.
    expect(yOf(short, "SON") - yOf(long, "SON")).toBe(2 * LINE_HEIGHT);
  });

  it("un recibo anulado lleva el sello y el motivo, y el motivo largo envuelve", async () => {
    const bytes = await renderReceiptPdf({
      number: "2026-00002", issuedAt: new Date(), memberName: "Muñoz Ñandú", memberNumber: null,
      concept: "Aporte voluntario", methodLabel: "Efectivo", amount: 1000.01,
      voided: { reason: "Cargado por error" },
    });
    const drawn = await drawnText(bytes);
    const texts = drawn.map((d) => d.text);
    expect(texts).toContain("ANULADO");
    expect(texts).toContain("Anulado: Cargado por error");
    expect(texts).toContain("mil pesos con un centavo");
    // El apellido con ñ y ú sobrevive a WinAnsi (no se convierte en "?").
    expect(texts).toContain("Muñoz Ñandú");

    // El motivo es texto libre: tiene que envolver, no salirse de la hoja.
    const long = "a".repeat(20) + (" motivo largo de anulación escrito por el operador".repeat(6));
    const drawnLong = await drawnText(await renderReceiptPdf({
      number: "2026-00004", issuedAt: new Date(), memberName: "X", memberNumber: null,
      concept: "Aporte voluntario", methodLabel: "Efectivo", amount: 1000,
      voided: { reason: long },
    }));
    const reason = drawnLong.filter((d) => d.text.startsWith("Anulado:") || d.text.includes("operador"));
    expect(reason.length).toBeGreaterThan(1); // se partió en varios renglones
    const bold = await (await PDFDocument.create()).embedFont(StandardFonts.HelveticaBold);
    for (const line of reason) {
      expect(bold.widthOfTextAtSize(line.text, 9)).toBeLessThanOrEqual(595.28 - 48 * 2);
    }
  });
});
