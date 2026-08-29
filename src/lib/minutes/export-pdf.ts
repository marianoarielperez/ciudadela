// La "Constancia de asientos del sistema" en PDF.
//
// Molde: `src/lib/board/notice-pdf.ts` (multi-página, cabecera corrida,
// numeración de hojas). Como allá: el molde se LEE y no se importa — el saneado
// WinAnsi y el wrap se reescriben acá para no acoplar módulos que evolucionan
// por separado. No se persiste en disco: se genera a pedido (mismo criterio que
// el aviso de cartelera, y a diferencia del recibo, que sí tiene carpeta).
import { readFile } from "node:fs/promises";
import path from "node:path";

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

import { SITE } from "@/lib/site";
import type { MinuteExportModel } from "./export-content";

const PRIMARY = rgb(0 / 255, 121 / 255, 188 / 255); // #0079BC, el token --primary
const INK = rgb(0.1, 0.1, 0.1);
const MUTED = rgb(0.45, 0.45, 0.45);

const A4: readonly [number, number] = [595.28, 841.89];
const MARGIN = 48;
const CONTENT_WIDTH = A4[0] - MARGIN * 2;
const LINE_HEIGHT = 14;
const BOTTOM = MARGIN + 28; // reserva para el pie de cada hoja

// WinAnsi + transliteración tipográfica: mismas razones y misma tabla que el
// aviso de cartelera (rayas y comillas tipográficas del proyecto se volvían
// "?" en el papel).
const TYPOGRAPHIC: Array<[RegExp, string]> = [
  [/[—–]/g, "-"],
  [/[“”]/g, '"'],
  [/[‘’]/g, "'"],
  [/…/g, "..."],
  [/ /g, " "],
];

function safe(s: string): string {
  let out = s;
  for (const [pattern, replacement] of TYPOGRAPHIC) out = out.replace(pattern, replacement);
  return out.replace(/[^ -~ -ÿ]/g, "?");
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = current === "" ? word : `${current} ${word}`;
    if (current !== "" && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current !== "") lines.push(current);
  return lines.length > 0 ? lines : [""];
}

let logoCache: Uint8Array | null = null;
async function logoBytes(): Promise<Uint8Array | null> {
  if (logoCache) return logoCache;
  try {
    logoCache = new Uint8Array(await readFile(path.join(process.cwd(), "assets", "logo.png")));
    return logoCache;
  } catch {
    return null; // sin logo la constancia sale igual
  }
}

export async function renderMinutePdf(model: MinuteExportModel): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${model.title} — ${model.minuteLabel} — ${SITE.shortName}`);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const logo = await logoBytes();

  const pages: PDFPage[] = [];
  let y = 0;

  function newPage(): PDFPage {
    const fresh = doc.addPage([A4[0], A4[1]]);
    pages.push(fresh);
    y = fresh.getHeight() - MARGIN;
    if (pages.length > 1) {
      fresh.drawText(safe(`${SITE.shortName} — ${model.minuteLabel} (continúa)`), {
        x: MARGIN, y: y - 10, size: 8, font: bold, color: MUTED,
      });
      y -= 26;
    }
    return fresh;
  }

  let page = newPage();

  // ── Membrete ───────────────────────────────────────────────────────────────
  if (logo) {
    try {
      const img = await doc.embedPng(logo);
      const h = 48;
      page.drawImage(img, { x: MARGIN, y: y - h, width: (img.width / img.height) * h, height: h });
    } catch {
      // Un PNG ilegible es cosmético.
    }
  }
  page.drawText(safe(SITE.name), { x: MARGIN + 60, y: y - 16, size: 13, font: bold, color: INK });
  page.drawText(safe(SITE.address), { x: MARGIN + 60, y: y - 30, size: 9, font, color: MUTED });
  page.drawText(safe(SITE.city), { x: MARGIN + 60, y: y - 42, size: 9, font, color: MUTED });
  y -= 68;
  page.drawLine({
    start: { x: MARGIN, y }, end: { x: MARGIN + CONTENT_WIDTH, y }, thickness: 1, color: PRIMARY,
  });
  y -= 22;

  page.drawText(safe(model.title.toUpperCase()), { x: MARGIN, y, size: 9, font: bold, color: MUTED });
  y -= 20;
  for (const line of wrap(model.minuteLabel, bold, 15, CONTENT_WIDTH)) {
    page.drawText(safe(line), { x: MARGIN, y, size: 15, font: bold, color: PRIMARY });
    y -= 19;
  }
  y -= 4;

  function paragraph(text: string, opts?: { bold?: boolean; muted?: boolean; size?: number }) {
    const size = opts?.size ?? 10;
    const f = opts?.bold ? bold : font;
    const color = opts?.muted ? MUTED : INK;
    for (const line of wrap(text, f, size, CONTENT_WIDTH)) {
      if (y < BOTTOM + LINE_HEIGHT) page = newPage();
      page.drawText(safe(line), { x: MARGIN, y, size, font: f, color });
      y -= LINE_HEIGHT;
    }
  }

  if (model.description) {
    paragraph(model.description, { muted: true });
    y -= 6;
  }
  paragraph(model.totalLine, { bold: true });
  y -= 8;

  // ── Secciones de asientos ──────────────────────────────────────────────────
  for (const section of model.sections) {
    if (y < BOTTOM + LINE_HEIGHT * 3) page = newPage();
    page.drawText(safe(section.heading.toUpperCase()), {
      x: MARGIN, y, size: 9, font: bold, color: MUTED,
    });
    y -= 16;
    for (const line of section.lines) {
      // Renglón con viñeta y sangría francesa: la segunda línea de un asiento
      // no puede confundirse con el asiento siguiente.
      const wrapped = wrap(line, font, 10, CONTENT_WIDTH - 12);
      for (let i = 0; i < wrapped.length; i++) {
        if (y < BOTTOM + LINE_HEIGHT) page = newPage();
        if (i === 0) page.drawText("-", { x: MARGIN, y, size: 10, font, color: MUTED });
        page.drawText(safe(wrapped[i]), { x: MARGIN + 12, y, size: 10, font, color: INK });
        y -= LINE_HEIGHT;
      }
    }
    y -= 10;
  }

  // ── Pie en todas las hojas ─────────────────────────────────────────────────
  // Dos renglones como mucho: el pie es metadata, no contenido.
  const footerLines = wrap(model.footer, font, 7.5, CONTENT_WIDTH - 80).slice(0, 2);
  pages.forEach((p, i) => {
    footerLines.forEach((line, j) => {
      p.drawText(safe(line), {
        x: MARGIN, y: MARGIN + 4 + (footerLines.length - 1 - j) * 9, size: 7.5, font, color: MUTED,
      });
    });
    p.drawText(safe(`Hoja ${i + 1} de ${pages.length}`), {
      x: MARGIN + CONTENT_WIDTH - 70, y: MARGIN + 4, size: 7.5, font, color: MUTED,
    });
  });

  return doc.save();
}
