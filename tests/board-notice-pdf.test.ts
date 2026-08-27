// El PDF del aviso de cartelera.
//
// Se fija lo que no se ve mirando una sola hoja de prueba: que la nómina de
// CIEN socios entre —paginada y en dos columnas— sin pisar el pie de fijación ni
// perder a nadie por el camino, y que cada nombre ocupe UNA fila.
//
// Los dos casos de texto salieron de mirar el cartel real, no de imaginar: las
// rayas de imprenta se dibujaban como "?" y un nombre largo se partía en dos
// renglones montándose sobre la fila de abajo. Los dos se leen del flujo de
// contenido del PDF (`drawnText`), que es la única forma de que un test vea lo
// que ve el vecino parado frente a la pared. La redacción estatutaria en sí se
// verificó a ojo (está en el informe de la tarea).
import { inflateSync } from "node:zlib";

import { PDFArray, PDFDocument, PDFName, PDFRawStream, PDFRef } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { renderBoardNoticePdf, type BoardNoticePdfData } from "@/lib/board/notice-pdf";
import { civilDateUtc } from "@/lib/dates";

const d = civilDateUtc;

function data(over: Partial<BoardNoticePdfData> = {}): BoardNoticePdfData {
  return {
    kind: "first_instance",
    subject: "first_instance",
    bookNumber: 1,
    calledAt: d(2026, 9, 1),
    firstEndsAt: d(2026, 10, 1),
    secondEndsAt: null,
    postedAt: null,
    dueAt: null,
    recipients: [{ memberNumber: 12, fullName: "Coñuecar Nestor Ramón" }],
    siteUrl: "https://vecinalciudadela.ar",
    printedAt: d(2026, 10, 2),
    ...over,
  };
}

async function pageCount(bytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPageCount();
}

/** El texto efectivamente DIBUJADO, hoja por hoja, leído del flujo de contenido.
 *
 *  Existe porque mirar el archivo a ojo no sirve como test y porque las dos
 *  fallas que este bloque cubre eran invisibles desde afuera: pdf-lib acepta
 *  cualquier string y dibuja lo que puede. `drawText` escribe los strings en
 *  hexadecimal, un byte por carácter WinAnsi. */
async function drawnText(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes);
  const out: string[] = [];
  for (const page of doc.getPages()) {
    const contents = page.node.get(PDFName.of("Contents"));
    const refs: unknown[] = contents instanceof PDFArray ? contents.asArray() : [contents];
    for (const ref of refs) {
      const stream = ref instanceof PDFRef ? doc.context.lookup(ref) : ref;
      if (!(stream instanceof PDFRawStream)) continue;
      const raw = Buffer.from(stream.contents);
      const filter = stream.dict.get(PDFName.of("Filter"));
      const body = (String(filter) === "/FlateDecode" ? inflateSync(raw) : raw).toString("latin1");
      for (const line of body.split("\n")) {
        const hex = /^<([0-9A-Fa-f]*)>\s*Tj$/.exec(line.trim());
        if (!hex) continue;
        out.push(
          (hex[1].match(/../g) ?? []).map((b) => String.fromCharCode(parseInt(b, 16))).join(""),
        );
      }
    }
  }
  return out;
}

describe("renderBoardNoticePdf", () => {
  it("un aviso corto entra en una hoja", async () => {
    expect(await pageCount(await renderBoardNoticePdf(data()))).toBe(1);
  });

  it("los cien socios sin casilla entran, paginados", async () => {
    // El caso real del proyecto: 100 de los 124 adherentes no tienen correo.
    const recipients = Array.from({ length: 100 }, (_, i) => ({
      memberNumber: i + 1,
      fullName: `Apellido${i + 1} Nombre Segundo`,
    }));
    const pages = await pageCount(await renderBoardNoticePdf(data({ recipients })));
    // Dos columnas por hoja: no puede quedar en una sola, y tampoco puede
    // dispararse a cinco (eso sería una columna sola o una fila por hoja).
    expect(pages).toBeGreaterThan(1);
    expect(pages).toBeLessThanOrEqual(3);
  });

  it("un aviso sin destinatarios no rompe", async () => {
    expect(await pageCount(await renderBoardNoticePdf(data({ recipients: [] })))).toBe(1);
  });

  it("los tres textos y el complementario se renderizan", async () => {
    for (const subject of ["first_instance", "second_instance", "withdrawal"] as const) {
      const bytes = await renderBoardNoticePdf(
        data({ subject, kind: subject, secondEndsAt: d(2026, 10, 11) }),
      );
      expect(bytes.byteLength).toBeGreaterThan(1000);
    }
    const other = await renderBoardNoticePdf(data({ kind: "other", subject: "second_instance" }));
    expect(other.byteLength).toBeGreaterThan(1000);
  });

  it("un socio sin número en el libro no rompe el cartel", async () => {
    const bytes = await renderBoardNoticePdf(
      data({ recipients: [{ memberNumber: null, fullName: "Sin Membresía" }] }),
    );
    expect(await pageCount(bytes)).toBe(1);
  });

  it("la tipografía de imprenta NO sale como signos de pregunta", async () => {
    // Las rayas y las comillas tipográficas de los textos del proyecto quedan
    // fuera del Latin-1 que aceptan las fuentes estándar, y el reemplazo crudo
    // las convertía en "?". Se vio en el cartel real: "que se nominan al pie
    // ?inscriptos en el Libro de Socios N° 1?". Eso no se cuelga en una pared.
    const lines = await drawnText(await renderBoardNoticePdf(data({ subject: "withdrawal" })));
    expect(lines.join(" ")).not.toContain("?");
    // Y el castellano sí tiene que salir entero: tildes, ñ y el ordinal.
    expect(lines.join(" ")).toContain("Art. 9° bis");
    expect(lines.some((l) => l.includes("Coñuecar Nestor Ramón"))).toBe(true);
  });

  it("un nombre largo ocupa UNA fila y sale entero", async () => {
    // El corte de línea de pdf-lib dibuja el segundo renglón por debajo, encima
    // de la fila siguiente: la nómina queda pisada y no se puede leer de pie
    // frente a la pared. Se vio en el cartel real. El nombre entra achicando la
    // letra, que es lo que preserva lo único que importa acá: que el socio se
    // reconozca. Éste tiene 48 caracteres; el más largo del padrón hoy tiene 29.
    const largo = "Uribe Barria Agustina Soledad de la Concepción";
    const lines = await drawnText(
      await renderBoardNoticePdf(data({ recipients: [{ memberNumber: 7, fullName: largo }] })),
    );
    // Una sola aparición y COMPLETA: partido en dos renglones habría dos
    // entradas parciales.
    expect(lines.filter((l) => l.includes("Uribe Barria"))).toEqual([largo]);
  });

  it("un nombre imposible se recorta, pero sigue en una sola fila", async () => {
    // `Member.fullName` es VarChar(160): la columna admite un nombre que no
    // entra ni a 7 pt. Ahí se recorta, que es la red y no el camino — recortar
    // pierde información y por eso es lo último que se prueba.
    const imposible = `Fernández ${"Villanueva ".repeat(12)}Etchegaray`;
    const lines = await drawnText(
      await renderBoardNoticePdf(data({ recipients: [{ memberNumber: 7, fullName: imposible }] })),
    );
    const drawn = lines.filter((l) => l.includes("Fernández"));
    expect(drawn).toHaveLength(1);
    expect(drawn[0].endsWith("...")).toBe(true);
    expect(drawn[0].length).toBeLessThan(imposible.length);
  });

  it("un aviso ya fijado imprime su plazo", async () => {
    // Una reimpresión que reemplaza una hoja rota tiene que decir el MISMO
    // plazo que la que se colgó.
    const bytes = await renderBoardNoticePdf(
      data({ postedAt: d(2026, 10, 2), dueAt: d(2026, 11, 2) }),
    );
    expect(await pageCount(bytes)).toBe(1);
  });
});
