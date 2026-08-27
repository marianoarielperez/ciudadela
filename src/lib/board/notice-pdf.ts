// El PDF del aviso de cartelera: el papel que se imprime y se pega en la pared
// de la sede.
//
// Molde: `src/lib/treasury/receipt-pdf.ts` (A4, pdf-lib, fuentes estándar,
// membrete con el logo). Se LEE como molde y no se toca ni se extiende: es
// núcleo de dinero. Por eso el saneado WinAnsi está escrito otra vez acá —allá
// es privado— en lugar de exportarlo desde el módulo de recibos.
//
// ── Privacidad, que acá no es un detalle ─────────────────────────────────────
// Este papel va pegado en una pared donde lo ve CUALQUIERA que entre a la sede:
// vecinos, proveedores, alguien que vino a alquilar el salón. Lleva lo mínimo
// indispensable para que cada socio se reconozca —número de socio y nombre— y
// NADA MÁS. Sin DNI, sin domicilio, sin teléfono, sin correo (Ley 25.326,
// docs/08). El tipo `BoardNoticePdfData` no los recibe siquiera, para que
// agregarlos no sea un descuido de una línea.
//
// ── Por qué el pie se completa a mano ────────────────────────────────────────
// El cartel se imprime ANTES de colgarse, así que la fecha de fijación todavía
// no existe cuando sale de la impresora. El pie deja los dos renglones —fijado
// y retirado— para llenar con lapicera: es la constancia física que después se
// archiva junto al acta. La fecha que vale para el sistema es la que el operador
// asienta en la pantalla, y el cartel ya fijado la imprime también.
import { readFile } from "node:fs/promises";
import path from "node:path";

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

import type { BoardNoticeKind } from "@/generated/prisma/client";
import { formatDateAR } from "@/lib/format";
import { SITE } from "@/lib/site";
import type { NoticeSubject } from "./notice";

export type BoardNoticePdfData = {
  kind: BoardNoticeKind;
  /** De qué aviso se trata realmente (`other` se resuelve a su instancia). */
  subject: NoticeSubject;
  bookNumber: number;
  calledAt: Date;
  firstEndsAt: Date;
  secondEndsAt: Date | null;
  postedAt: Date | null;
  dueAt: Date | null;
  /** Número de socio y nombre. NADA MÁS: ver la cabecera. */
  recipients: Array<{ memberNumber: number | null; fullName: string }>;
  /** URL pública del wizard, para que el vecino sepa dónde presentarse. */
  siteUrl: string;
  printedAt: Date;
};

const PRIMARY = rgb(0 / 255, 121 / 255, 188 / 255); // #0079BC, el token --primary
const INK = rgb(0.1, 0.1, 0.1);
const MUTED = rgb(0.45, 0.45, 0.45);

const A4: readonly [number, number] = [595.28, 841.89];
const MARGIN = 48;
const CONTENT_WIDTH = A4[0] - MARGIN * 2;
const COLUMN_GAP = 24;
const COLUMN_WIDTH = (CONTENT_WIDTH - COLUMN_GAP) / 2;
const ROW_HEIGHT = 13;
/** Lo que se reserva SIEMPRE abajo para el pie de fijación. Reservarlo en todas
 *  las hojas —y no sólo en la última— desperdicia un poco de papel y a cambio
 *  garantiza que el pie entre sin tener que saber de antemano cuál va a ser la
 *  última hoja. */
const FOOTER_RESERVE = 108;
const BOTTOM = MARGIN + FOOTER_RESERVE;

// Las fuentes estándar de pdf-lib sólo tienen WinAnsi (U+0020–U+007E y
// U+00A0–U+00FF): cubre el castellano entero —tildes, ñ, ü, ¿, °— y lo que
// quede afuera se reemplaza para que un nombre raro del padrón no tire el
// cartel de cien personas.
//
// Antes del reemplazo se TRANSLITERA la tipografía de imprenta, y eso NO es un
// lujo: los textos de este módulo están escritos con rayas de diálogo y comillas
// tipográficas como todo el proyecto, y el reemplazo crudo las convertía en
// signos de pregunta. Se vio en el cartel real: "que se nominan al pie
// ?inscriptos en el Libro de Socios N° 1? a RATIFICAR…". En una pared pública
// eso no se puede colgar.
const TYPOGRAPHIC: Array<[RegExp, string]> = [
  [/[—–]/g, "-"],
  [/[“”]/g, '"'],
  [/[‘’]/g, "'"],
  [/…/g, "..."],
  [/ /g, " "],
];

function safe(s: string): string {
  let out = s;
  for (const [pattern, replacement] of TYPOGRAPHIC) out = out.replace(pattern, replacement);
  return out.replace(/[^ -~ -ÿ]/g, "?");
}

/** El nombre de un socio en UNA sola línea, que es lo que hace legible una
 *  columna de cincuenta renglones.
 *
 *  El corte de línea automático de pdf-lib no sirve acá: dibuja el segundo
 *  renglón por debajo, encima de la fila siguiente, y la nómina queda pisada.
 *  Se vio en el cartel real con un nombre de cuarenta caracteres.
 *
 *  El nombre completo es lo que le permite al socio reconocerse en la pared, así
 *  que primero se achica la letra (hasta 7 pt) y recién si con eso no entra se
 *  recorta. Hoy el padrón tiene 29 caracteres en su nombre más largo y en la
 *  columna entran unos 52 a 9 pt, así que el recorte es la red y no el camino. */
function fitName(name: string, font: PDFFont, maxWidth: number): { text: string; size: number } {
  for (const size of [9, 8, 7]) {
    if (font.widthOfTextAtSize(name, size) <= maxWidth) return { text: name, size };
  }
  let text = name;
  while (text.length > 1 && font.widthOfTextAtSize(text + "...", 7) > maxWidth) {
    text = text.slice(0, -1);
  }
  return { text: text + "...", size: 7 };
}

/** Corta un texto en renglones que entran en `maxWidth`. pdf-lib sabe cortar
 *  solo con `maxWidth`, pero no dice cuántos renglones usó, y acá el texto
 *  decide dónde empieza la nómina: sin saberlo, la primera columna se montaría
 *  sobre el último párrafo. */
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

const TITLES: Record<NoticeSubject, string> = {
  first_instance: "CONVOCATORIA A RE-EMPADRONAMIENTO",
  second_instance: "SEGUNDA INSTANCIA, BAJO APERCIBIMIENTO DE BAJA",
  withdrawal: "BAJAS DECLARADAS",
};

/** El párrafo final es el MISMO en los tres avisos y es el que le da al papel
 *  su efecto jurídico: sin él, esto es un cartel informativo. */
function publicationParagraph(subject: NoticeSubject): string {
  return subject === "withdrawal"
    ? "El presente aviso se publica en la cartelera de la sede social por veinte (20) días hábiles. " +
        "Cumplido ese plazo la notificación se tiene por practicada con idéntico efecto que la " +
        "notificación fehaciente (Art. 5° ter del Estatuto), y desde entonces corre el plazo del recurso."
    : "El presente aviso se publica en la cartelera de la sede social por veinte (20) días hábiles y, " +
        "cumplido ese plazo, surte idéntico efecto que la notificación fehaciente (Art. 5° ter del Estatuto).";
}

/** El cuerpo del aviso, por lo que efectivamente se está avisando. Las fechas
 *  que se nombran son las ASENTADAS en el proceso: el vecino tiene que poder
 *  leer en la pared exactamente el plazo que quedó registrado. */
function bodyParagraphs(data: BoardNoticePdfData): string[] {
  const where =
    `La presentación puede hacerse personalmente en la sede social, ${SITE.address}, ` +
    `o por vía electrónica en ${data.siteUrl}/reempadronate.`;

  switch (data.subject) {
    case "first_instance":
      return [
        `La Comisión Directiva de la ${SITE.name} convoca a los señores socios adherentes que se ` +
          `nominan al pie (inscriptos en el Libro de Socios N° ${data.bookNumber}) a RATIFICAR SU ` +
          `CONDICIÓN DE SOCIO (re-empadronamiento del Art. 9° bis del Estatuto), dentro de los ` +
          `treinta (30) días corridos contados desde la convocatoria del ` +
          `${formatDateAR(data.calledAt)}, plazo que vence el ${formatDateAR(data.firstEndsAt)}.`,
        where,
        "Quien no ratifique su condición de socio en el plazo indicado quedará comprendido en la " +
          "segunda instancia del Art. 9° bis, bajo apercibimiento de que se declare su baja.",
        publicationParagraph(data.subject),
      ];
    case "second_instance":
      return [
        `La Comisión Directiva de la ${SITE.name} hace saber a los señores socios adherentes que se ` +
          `nominan al pie (inscriptos en el Libro de Socios N° ${data.bookNumber}) que, vencido el ` +
          `plazo de la primera instancia del re-empadronamiento del Art. 9° bis del Estatuto, se les ` +
          `otorga un plazo final de diez (10) días corridos, que vence el ` +
          `${formatDateAR(data.secondEndsAt ?? data.firstEndsAt)}, para RATIFICAR SU CONDICIÓN DE ` +
          `SOCIO, BAJO APERCIBIMIENTO DE DECLARAR SU BAJA del registro de socios ` +
          `(Art. 9° bis inc. c del Estatuto).`,
        where,
        publicationParagraph(data.subject),
      ];
    case "withdrawal":
      return [
        `La Comisión Directiva de la ${SITE.name} hace saber que ha DECLARADO LA BAJA del registro ` +
          `de socios de las personas que se nominan al pie (inscriptas en el Libro de Socios ` +
          `N° ${data.bookNumber}), por no haber ratificado su condición de socio en el proceso de ` +
          `re-empadronamiento del Art. 9° bis del Estatuto.`,
        "Contra esta decisión puede interponerse recurso ante la primera Asamblea que se celebre, " +
          "dentro de los treinta (30) días corridos contados desde la notificación fehaciente " +
          "(Art. 9° bis inc. d del Estatuto).",
        publicationParagraph(data.subject),
      ];
  }
}

let logoCache: Uint8Array | null = null;
async function logoBytes(): Promise<Uint8Array | null> {
  if (logoCache) return logoCache;
  try {
    logoCache = new Uint8Array(await readFile(path.join(process.cwd(), "assets", "logo.png")));
    return logoCache;
  } catch {
    return null; // sin logo el cartel sale igual
  }
}

export async function renderBoardNoticePdf(data: BoardNoticePdfData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const title = TITLES[data.subject];
  doc.setTitle(`Aviso de cartelera — ${title} — ${SITE.shortName}`);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.Courier);
  const logo = await logoBytes();

  const pages: PDFPage[] = [];
  let y = 0;

  function newPage(): PDFPage {
    const fresh = doc.addPage([A4[0], A4[1]]);
    pages.push(fresh);
    y = fresh.getHeight() - MARGIN;
    if (pages.length > 1) {
      // Cabecera corrida de las hojas siguientes: quien despega una hoja del
      // cartel tiene que poder saber de qué aviso es y que le falta el resto.
      fresh.drawText(safe(`${SITE.shortName} — ${title} (continúa)`), {
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
      // Un PNG que pdf-lib no sabe leer es cosmético: el cartel sale igual.
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

  page.drawText("AVISO DE CARTELERA", { x: MARGIN, y, size: 9, font: bold, color: MUTED });
  y -= 20;
  for (const line of wrap(title, bold, 15, CONTENT_WIDTH)) {
    page.drawText(safe(line), { x: MARGIN, y, size: 15, font: bold, color: PRIMARY });
    y -= 19;
  }
  if (data.kind === "other") {
    // El aviso complementario dice de qué es complemento: si no, el vecino que
    // ve dos carteles casi iguales no sabe cuál lo alcanza.
    page.drawText(safe("Aviso complementario: mismo aviso, para socios incorporados con posterioridad"), {
      x: MARGIN, y, size: 9, font, color: MUTED,
    });
    y -= 16;
  }
  y -= 6;

  // ── Cuerpo ─────────────────────────────────────────────────────────────────
  for (const paragraph of bodyParagraphs(data)) {
    for (const line of wrap(paragraph, font, 10, CONTENT_WIDTH)) {
      page.drawText(safe(line), { x: MARGIN, y, size: 10, font, color: INK });
      y -= 13;
    }
    y -= 8;
  }

  // El aviso ya fijado imprime sus fechas: una reimpresión que reemplace una
  // hoja rota tiene que decir el mismo plazo que la que se colgó.
  if (data.postedAt && data.dueAt) {
    page.drawText(
      safe(
        `Fijado el ${formatDateAR(data.postedAt)}. Cumplidos los veinte (20) días hábiles, la ` +
          `notificación queda practicada el ${formatDateAR(data.dueAt)}.`,
      ),
      { x: MARGIN, y, size: 10, font: bold, color: INK },
    );
    y -= 20;
  }

  // ── Nómina ─────────────────────────────────────────────────────────────────
  const count = data.recipients.length;
  page.drawText(
    safe(count === 1 ? "SOCIO ALCANZADO (1)" : `SOCIOS ALCANZADOS (${count})`),
    { x: MARGIN, y, size: 9, font: bold, color: MUTED },
  );
  y -= 16;

  if (count === 0) {
    page.drawText(safe("Sin destinatarios."), { x: MARGIN, y, size: 10, font, color: MUTED });
    y -= 16;
  }

  let index = 0;
  while (index < count) {
    // Cuántas filas entran en ESTA hoja, en dos columnas. Si no entra ni una,
    // se abre otra hoja (pasa cuando el cuerpo llegó casi hasta el pie).
    const perColumn = Math.floor((y - BOTTOM) / ROW_HEIGHT);
    if (perColumn < 1) {
      page = newPage();
      continue;
    }
    const top = y;
    const drawn = Math.min(perColumn * 2, count - index);
    for (let slot = 0; slot < drawn; slot++) {
      const column = Math.floor(slot / perColumn);
      const rowY = top - (slot % perColumn) * ROW_HEIGHT;
      const x = MARGIN + column * (COLUMN_WIDTH + COLUMN_GAP);
      const r = data.recipients[index + slot];
      // El número en monoespaciada: es lo que el vecino busca con el dedo
      // recorriendo la columna, y en proporcional los dígitos no alinean.
      const label = r.memberNumber === null ? "  —" : String(r.memberNumber).padStart(3, " ");
      page.drawText(safe(label), { x, y: rowY, size: 9, font: mono, color: MUTED });
      const nameX = x + mono.widthOfTextAtSize("0000 ", 9);
      const name = fitName(safe(r.fullName), font, COLUMN_WIDTH - (nameX - x));
      page.drawText(name.text, { x: nameX, y: rowY, size: name.size, font, color: INK });
    }
    index += drawn;
    // La columna izquierda es la más larga: es la que dice hasta dónde bajó
    // la nómina en esta hoja.
    y = top - Math.min(drawn, perColumn) * ROW_HEIGHT;
    if (index < count) page = newPage();
  }

  // ── Pie para completar a mano ──────────────────────────────────────────────
  const last = pages[pages.length - 1];
  const footerY = MARGIN + 62;
  last.drawLine({
    start: { x: MARGIN, y: footerY + 22 }, end: { x: MARGIN + CONTENT_WIDTH, y: footerY + 22 },
    thickness: 0.5, color: MUTED,
  });
  last.drawText(safe("FIJADO EL ____ / ____ / ________"), {
    x: MARGIN, y: footerY, size: 10, font: bold, color: INK,
  });
  last.drawText(safe("RETIRADO EL ____ / ____ / ________"), {
    x: MARGIN + CONTENT_WIDTH / 2, y: footerY, size: 10, font: bold, color: INK,
  });
  last.drawText(safe("Firma ______________________________"), {
    x: MARGIN, y: footerY - 22, size: 9, font, color: MUTED,
  });
  last.drawText(safe("Firma ______________________________"), {
    x: MARGIN + CONTENT_WIDTH / 2, y: footerY - 22, size: 9, font, color: MUTED,
  });
  last.drawText(
    safe(
      `Nómina al ${formatDateAR(data.printedAt)}` +
        (data.postedAt ? " (aviso ya fijado)." : ". Asentá la fijación en el panel el mismo día que colgás el cartel."),
    ),
    { x: MARGIN, y: MARGIN + 4, size: 7.5, font, color: MUTED },
  );

  // Numeración de hojas: un cartel de tres hojas al que le falta una tiene que
  // notarse desde la pared.
  pages.forEach((p, i) => {
    p.drawText(safe(`Hoja ${i + 1} de ${pages.length}`), {
      x: MARGIN + CONTENT_WIDTH - 70, y: MARGIN + 4, size: 7.5, font, color: MUTED,
    });
  });

  return doc.save();
}
