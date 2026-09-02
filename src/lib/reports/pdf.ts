// El PDF de un reporte (spec §5 y §7): el papel que el operador imprime o
// adjunta para llevar el reclamo al organismo. Se genera A PEDIDO y no se guarda
// nunca: no hay serie numerada que sostener (eso es de los recibos, REG-33) y
// el reporte ya está en la base.
//
// Molde: `src/lib/board/notice-pdf.ts` —que a su vez calcó `treasury/receipt-pdf.ts`—
// A4, pdf-lib con fuentes estándar, membrete con el logo, saneado WinAnsi con
// transliteración y corte de línea propio. El saneado está escrito otra vez acá
// por el mismo motivo que allá: en los dos módulos vecinos es privado, y núcleo
// de dinero no se toca para exportarlo.
//
// ── La identidad, que acá es la regla y no un detalle ────────────────────────
// "Reservado" en este módulo significa RESERVADO ANTE EL ORGANISMO (spec §1): la
// asociación siempre sabe quién reportó —lo ve en la ficha del panel—, y lo que
// no puede salir es este papel con nombre, DNI, teléfono o correo. Por eso todo
// lo que dice el PDF sobre quien reporta sale de `identityLines`, que es PURA,
// está exportada y tiene su propio test: la regla es una función, no una línea
// perdida en medio del dibujo, y agregarle el nombre en otro lado sería un
// cambio visible en vez de un descuido de una línea.
import { readFile } from "node:fs/promises";
import path from "node:path";

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage } from "pdf-lib";

import { formatDateAR, formatDateTimeAR } from "@/lib/format";
import { SITE } from "@/lib/site";
import { KIND_LABELS, type ReportKindSlug } from "./catalog";
import { MAX_PHOTOS } from "./rules";

export type ReportPdfData = {
  number: number;
  kind: ReportKindSlug;
  status: "received" | "filed" | "dismissed";
  categoryLabel: string;
  subtypeLabel: string | null;
  description: string;
  street: string | null;
  lat: number | null;
  lng: number | null;
  outsideBoundary: boolean;
  scplTicket: string | null;
  submittedAt: Date | null;
  reporter: {
    name: string | null;
    dni: string | null;
    phone: string | null;
    email: string | null;
    memberNumber: number | null;
  };
  anonymous: boolean;
  /** El acta llega NOMBRADA (`minuteName`: tipo + número), nunca por su id: el
   *  id manda al operador a buscar en el libro un documento que existe y no es
   *  ése (misma lección que el acta del cierre del Libro 1). */
  filed: {
    agencyLabel: string | null;
    at: Date;
    reference: string | null;
    minuteName: string | null;
  } | null;
  dismissed: { at: Date; reason: string | null } | null;
  printedAt: Date;
};

const PRIMARY = rgb(0 / 255, 121 / 255, 188 / 255); // #0079BC, el token --primary
const INK = rgb(0.1, 0.1, 0.1);
const MUTED = rgb(0.45, 0.45, 0.45);
const FRAME = rgb(0.85, 0.88, 0.9);

const A4: readonly [number, number] = [595.28, 841.89];
const MARGIN = 48;
const CONTENT_WIDTH = A4[0] - MARGIN * 2;
/** Lo que se reserva abajo para el pie (impreso el · hoja N de M). */
const BOTTOM = MARGIN + 30;

// Las fuentes estándar de pdf-lib sólo tienen WinAnsi (U+0020–U+007E y
// U+00A0–U+00FF): cubre el castellano entero —tildes, ñ, ü, ¿, °— y lo que
// quede afuera se reemplaza. Acá el texto lo escribe UN VECINO en un textarea
// del celular: llegan emojis, rayas de diálogo y comillas curvas, y `drawText`
// TIRA con cualquiera de ellos. Un reclamo que no se puede imprimir porque
// alguien puso un 🚧 no es aceptable.
//
// La transliteración va ANTES del reemplazo y no es un lujo: sin ella las rayas
// y las comillas tipográficas —que el proyecto usa en todos sus textos— salen
// como signos de pregunta. Se vio en el cartel de cartelera real.
const TYPOGRAPHIC: Array<[RegExp, string]> = [
  [/[—–]/g, "-"], // — –
  [/[“”]/g, '"'], // “ ”
  [/[‘’]/g, "'"], // ‘ ’
  [/…/g, "..."], // …
  [/ /g, " "], // espacio no separable
];

function safe(s: string): string {
  let out = s;
  for (const [pattern, replacement] of TYPOGRAPHIC) out = out.replace(pattern, replacement);
  return out.replace(/[^ -~ -ÿ]/g, "?");
}

/** Los párrafos que escribió el vecino, tal como los tipeó. Va aparte de `safe`
 *  porque tiene que correr ANTES (ver el comentario de `paragraph`). */
function splitParagraphs(text: string): string[] {
  return text.split(/\r?\n/);
}

/** Corta un párrafo YA SANEADO en renglones que entran en `maxWidth`. pdf-lib
 *  sabe cortar solo, pero no dice cuántos renglones usó, y acá cada bloque
 *  decide dónde empieza el siguiente. */
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
  lines.push(current);
  return lines;
}

/** Las líneas de identidad del PDF. PURA y exportada a propósito: es la regla
 *  "reservado ante el organismo" hecha función, y un test la fija. Es el ÚNICO
 *  lugar del módulo que lee `data.reporter`. */
export function identityLines(d: ReportPdfData): string[] {
  if (d.anonymous) return ["Identidad reservada a pedido de quien reporta."];
  const r = d.reporter;
  const who = [r.name ?? "-", r.memberNumber !== null ? `socio N° ${r.memberNumber}` : "vecino/a"];
  return [who.join(" · "), `DNI ${r.dni ?? "-"} · Tel. ${r.phone ?? "-"} · ${r.email ?? "-"}`];
}

let logoCache: Uint8Array | null = null;
async function logoBytes(): Promise<Uint8Array | null> {
  if (logoCache) return logoCache;
  try {
    logoCache = new Uint8Array(await readFile(path.join(process.cwd(), "assets", "logo.png")));
    return logoCache;
  } catch {
    // El membrete sin logo sigue siendo un papel válido: no se cachea el fallo,
    // por si el archivo aparece (un deploy a medias).
    return null;
  }
}

/** Embebe una imagen fallando SUAVE. Las fotos las sube un vecino y el store las
 *  re-codifica a JPEG, pero un archivo truncado en disco no puede impedir que
 *  el reclamo se imprima. */
async function embedImage(doc: PDFDocument, bytes: Buffer): Promise<PDFImage | null> {
  try {
    return await doc.embedJpg(bytes);
  } catch {
    /* puede ser PNG: se prueba abajo */
  }
  try {
    return await doc.embedPng(bytes);
  } catch {
    return null;
  }
}

export async function renderReportPdf(
  d: ReportPdfData,
  assets: { photos: Buffer[]; map: Buffer | null },
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(safe(`${KIND_LABELS[d.kind]} N° ${d.number} - ${SITE.shortName}`));
  doc.setProducer(SITE.shortName);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.Courier);

  let page = doc.addPage([A4[0], A4[1]]);
  const pages = [page];
  let y = A4[1] - MARGIN;

  function ensure(space: number) {
    if (y - space < BOTTOM) {
      page = doc.addPage([A4[0], A4[1]]);
      pages.push(page);
      y = A4[1] - MARGIN;
    }
  }
  function label(text: string) {
    ensure(26);
    page.drawText(safe(text.toUpperCase()), { x: MARGIN, y, size: 8, font: bold, color: MUTED });
    y -= 13;
  }
  function paragraph(text: string, size = 10, f: PDFFont = font, color = INK) {
    // Se corta por párrafo ANTES de sanear, y el orden importa: el salto de
    // línea no está en WinAnsi, así que `safe()` lo convierte en "?" y los dos
    // párrafos del vecino salían pegados con un signo de pregunta en el medio.
    // Se vio en un PDF de prueba real. Lo que llega a `drawText` es siempre un
    // renglón ya saneado y sin saltos.
    for (const block of splitParagraphs(text)) {
      for (const line of wrap(safe(block), f, size, CONTENT_WIDTH)) {
        ensure(size + 4);
        page.drawText(line, { x: MARGIN, y, size, font: f, color });
        y -= size + 4;
      }
    }
  }

  // ── Membrete ───────────────────────────────────────────────────────────────
  const logo = await logoBytes();
  if (logo) {
    try {
      const img = await doc.embedPng(logo);
      page.drawImage(img, {
        x: MARGIN,
        y: y - 44,
        width: (img.width / img.height) * 44,
        height: 44,
      });
    } catch {
      /* el logo es cosmético: sin él el papel sigue siendo válido */
    }
  }
  page.drawText(safe(SITE.name), { x: MARGIN + 56, y: y - 16, size: 12, font: bold, color: INK });
  page.drawText(safe(`${SITE.address} · ${SITE.city}`), {
    x: MARGIN + 56,
    y: y - 30,
    size: 8,
    font,
    color: MUTED,
  });
  // Sin silueta del barrio en el membrete (pedido del operador, 02/09): el
  // contorno ya va en el mini-mapa, y el membrete es logo, nombre y dirección.
  y -= 62;
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: MARGIN + CONTENT_WIDTH, y },
    thickness: 1,
    color: PRIMARY,
  });
  y -= 26;

  // ── Encabezado del reporte ────────────────────────────────────────────────
  page.drawText(safe(`${KIND_LABELS[d.kind].toUpperCase()} N°`), {
    x: MARGIN,
    y,
    size: 9,
    font: bold,
    color: MUTED,
  });
  page.drawText(String(d.number), { x: MARGIN + 84, y: y - 8, size: 24, font: mono, color: PRIMARY });
  y -= 36;
  paragraph(d.subtypeLabel ? `${d.categoryLabel} > ${d.subtypeLabel}` : d.categoryLabel, 13, bold);
  paragraph(
    `Enviado el ${d.submittedAt ? formatDateTimeAR(d.submittedAt) : "-"}`,
    9,
    font,
    MUTED,
  );
  y -= 8;

  // ── Quién reporta ─────────────────────────────────────────────────────────
  label(d.kind === "claim" ? "Quién reclama" : "Quién propone");
  for (const line of identityLines(d)) paragraph(line, 10);
  y -= 8;

  // ── Descripción ───────────────────────────────────────────────────────────
  label("Descripción");
  paragraph(d.description.trim() || "Sin descripción.", 10);
  if (d.scplTicket) paragraph(`N° de reclamo SCPL: ${d.scplTicket}`, 9, font, MUTED);
  y -= 8;

  // ── Ubicación ─────────────────────────────────────────────────────────────
  label("Ubicación");
  if (d.street) paragraph(d.street, 10);
  if (d.lat !== null && d.lng !== null) {
    paragraph(
      `${d.lat.toFixed(5)}, ${d.lng.toFixed(5)}` +
        (d.outsideBoundary ? " (fuera del límite catastral del barrio)" : ""),
      9,
      mono,
      MUTED,
    );
    const img = assets.map ? await embedImage(doc, assets.map) : null;
    if (img) {
      const w = CONTENT_WIDTH;
      const h = (img.height / img.width) * w;
      ensure(h + 18);
      page.drawImage(img, { x: MARGIN, y: y - h, width: w, height: h });
      page.drawRectangle({
        x: MARGIN,
        y: y - h,
        width: w,
        height: h,
        borderColor: FRAME,
        borderWidth: 0.5,
      });
      y -= h + 5;
      // Atribución OBLIGATORIA de la capa base (la del IGN integra datos de OSM
      // bajo ODbL): es la misma que muestra el mapa de /ubicacion.
      paragraph(
        "Cartografía: Instituto Geográfico Nacional (ArgenMap) + OpenStreetMap.",
        7,
        font,
        MUTED,
      );
    } else {
      // El PDF sale igual y DICE que salió sin mapa: si no lo dijera, el
      // operador no sabría si el reporte no tenía punto o si el IGN no contestó.
      paragraph("No se pudo componer el mini-mapa (el servicio de mapas no respondió).", 9, font, MUTED);
    }
  } else if (!d.street) {
    paragraph("Sin ubicación.", 10, font, MUTED);
  }
  y -= 8;

  // ── Fotos ─────────────────────────────────────────────────────────────────
  // Las fotos van SIEMPRE en una hoja propia (la segunda), a una columna y dos
  // filas (pedido del operador, 02/09): a lo ancho del contenido, cada una en
  // una caja de media hoja, escalada para entrar entera (nunca recortada ni
  // desbordada) y centrada en su caja. Con una sola foto, la segunda fila
  // queda vacía: todos los PDF se ven iguales.
  const photos = assets.photos.slice(0, MAX_PHOTOS);
  if (photos.length > 0) {
    page = doc.addPage([A4[0], A4[1]]);
    pages.push(page);
    y = A4[1] - MARGIN;
    label("Fotos");
    const gap = 12;
    const boxW = CONTENT_WIDTH;
    const boxH = (y - BOTTOM - gap) / 2;
    for (const bytes of photos) {
      const img = await embedImage(doc, bytes);
      if (img) {
        const scale = Math.min(boxW / img.width, boxH / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        page.drawImage(img, {
          x: MARGIN + (boxW - w) / 2,
          y: y - boxH + (boxH - h) / 2,
          width: w,
          height: h,
        });
      }
      page.drawRectangle({
        x: MARGIN,
        y: y - boxH,
        width: boxW,
        height: boxH,
        borderColor: FRAME,
        borderWidth: 0.5,
      });
      y -= boxH + gap;
    }
  }

  // Sin bloque "Estado" (pedido del operador, 02/09): este PDF es el documento
  // que se eleva al organismo, y al organismo no le interesa el estado interno
  // del reporte ni el expediente que la asociación le asigna después.

  // ── Pie, en TODAS las hojas ───────────────────────────────────────────────
  pages.forEach((p, i) => {
    p.drawText(
      safe(
        `Impreso el ${formatDateAR(d.printedAt)} · ${SITE.shortName} · Hoja ${i + 1} de ${pages.length}`,
      ),
      { x: MARGIN, y: MARGIN - 20, size: 7.5, font, color: MUTED },
    );
  });

  return doc.save();
}
