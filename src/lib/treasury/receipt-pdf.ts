// Recibo PDF (spec §6.5): A4, una página, logo + nombre de la asociación, número
// grande, datos del pago. pdf-lib es JS puro: sin binarios en el VPS. Las fuentes
// estándar (Helvetica/Courier) solo tienen WinAnsi: cubre el castellano (tildes,
// ñ, ü) y lo demás se reemplaza para que un nombre raro no tire el recibo.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont } from "pdf-lib";
import { SITE } from "@/lib/site";
import { formatARS, formatDateAR } from "@/lib/format";
import { amountInWords } from "./amount-words";

export type ReceiptPdfData = {
  number: string;
  issuedAt: Date;
  memberName: string;
  memberNumber: number | null;
  concept: string;
  methodLabel: string;
  amount: number;
  voided: { reason: string } | null;
};

const PRIMARY = rgb(0 / 255, 121 / 255, 188 / 255); // #0079BC
const INK = rgb(0.1, 0.1, 0.1);
const MUTED = rgb(0.45, 0.45, 0.45);
const RED = rgb(0.85, 0.2, 0.2);

// Fuera de WinAnsi (U+0020–U+007E y U+00A0–U+00FF) se sustituye. El "·" del
// concepto es U+00B7, está cubierto.
function safe(s: string): string {
  return s.replace(/[^ -~ -ÿ]/g, "?");
}

// Medidas de la hoja. Exportadas porque los tests miden el corte de líneas con
// el MISMO ancho que usa la fila: una constante duplicada en el test dejaría
// pasar justo el caso que el corte de líneas existe para evitar.
export const A4: readonly [number, number] = [595.28, 841.89];
const MARGIN = 48;
const CONTENT_WIDTH = A4[0] - MARGIN * 2;
/** Ancho disponible para el valor de una fila (la etiqueta ocupa 140 pt). */
export const VALUE_WIDTH = CONTENT_WIDTH - 140;
/** Interlineado de los valores que envuelven. */
export const LINE_HEIGHT = 14;

// pdf-lib corta el valor por palabras cuando se pasa `maxWidth`, pero no dice
// cuántos renglones usó. El concepto de doce cuotas sueltas ocupa tres, y con un
// avance fijo de 22 el tercero se monta sobre la fila siguiente. Contamos igual
// que pdf-lib (cada palabra con su espacio) para avanzar lo que se dibujó.
export function lineCount(text: string, font: PDFFont, size: number, maxWidth: number): number {
  let lines = 1;
  let used = 0;
  for (const word of text.split(" ")) {
    const w = font.widthOfTextAtSize(`${word} `, size);
    if (used > 0 && used + w > maxWidth) {
      lines += 1;
      used = 0;
    }
    used += w;
  }
  return lines;
}

let logoCache: Uint8Array | null = null;
async function logoBytes(): Promise<Uint8Array | null> {
  if (logoCache) return logoCache;
  try {
    logoCache = new Uint8Array(await readFile(path.join(process.cwd(), "assets", "logo.png")));
    return logoCache;
  } catch {
    return null; // sin logo el recibo sigue saliendo
  }
}

export async function renderReceiptPdf(data: ReceiptPdfData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Recibo ${data.number} — ${SITE.shortName}`);
  const page = doc.addPage([A4[0], A4[1]]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.Courier);
  const margin = MARGIN;
  const width = CONTENT_WIDTH;
  let y = page.getHeight() - margin;

  const logo = await logoBytes();
  if (logo) {
    try {
      const img = await doc.embedPng(logo);
      const h = 48;
      page.drawImage(img, { x: margin, y: y - h, width: (img.width / img.height) * h, height: h });
    } catch {
      // Un PNG que pdf-lib no sabe leer es cosmético: el recibo tiene que salir igual.
    }
  }
  page.drawText(safe(SITE.name), { x: margin + 60, y: y - 18, size: 13, font: bold, color: INK });
  page.drawText(safe(SITE.city), { x: margin + 60, y: y - 34, size: 9, font, color: MUTED });

  // Número grande a la derecha: es lo que el socio busca cuando reclama.
  page.drawText("RECIBO", { x: margin + width - 150, y: y - 14, size: 10, font: bold, color: MUTED });
  page.drawText(data.number, { x: margin + width - 150, y: y - 42, size: 22, font: mono, color: PRIMARY });
  y -= 70;
  page.drawLine({ start: { x: margin, y }, end: { x: margin + width, y }, thickness: 1, color: PRIMARY });
  y -= 28;

  const row = (label: string, value: string, opts?: { big?: boolean; monoValue?: boolean }) => {
    const size = opts?.big ? 16 : 11;
    const valueFont = opts?.monoValue ? mono : font;
    const valueWidth = VALUE_WIDTH;
    const text = safe(value);
    page.drawText(safe(label.toUpperCase()), { x: margin, y, size: 8, font: bold, color: MUTED });
    page.drawText(text, {
      x: margin + 140, y: y - 1, size,
      font: valueFont, color: INK, maxWidth: valueWidth, lineHeight: LINE_HEIGHT,
    });
    y -= (opts?.big ? 30 : 22) + (lineCount(text, valueFont, size, valueWidth) - 1) * LINE_HEIGHT;
  };

  row("Fecha", formatDateAR(data.issuedAt));
  row("Recibimos de", data.memberNumber !== null ? `${data.memberName} (socio N° ${data.memberNumber})` : data.memberName);
  row("Concepto", data.concept);
  row("Medio de pago", data.methodLabel);
  row("Importe", formatARS(data.amount), { big: true, monoValue: true });
  row("Son", amountInWords(data.amount));

  y -= 10;
  page.drawText(safe("Comprobante interno de la asociación. No válido como factura."), {
    x: margin, y, size: 8, font, color: MUTED,
  });

  if (data.voided) {
    page.drawText("ANULADO", { x: 120, y: 380, size: 72, font: bold, color: RED, opacity: 0.35, rotate: degrees(30) });
    // El motivo es texto libre del operador: sin `maxWidth` una anulación
    // explicada en dos renglones se sale por el borde derecho de la hoja.
    page.drawText(safe(`Anulado: ${data.voided.reason}`), {
      x: margin, y: y - 16, size: 9, font: bold, color: RED,
      maxWidth: width, lineHeight: 11,
    });
  }

  return doc.save();
}
