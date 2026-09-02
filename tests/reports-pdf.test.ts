// El PDF de un reporte (spec §5). Es el papel que va al organismo, así que lo
// que se fija acá no es el dibujo sino las tres cosas que no se pueden mirar en
// una vista previa:
//
//  1. **Reservado = sin identidad.** `identityLines` es pura y es el ÚNICO lugar
//     del módulo que lee `data.reporter`: se asevera directo, y además se
//     verifica sobre los bytes que el nombre no viaja al archivo.
//  2. **Nunca tira.** Un vecino escribe en el textarea de su celular: llegan
//     emojis, rayas de diálogo y comillas curvas, y `drawText` de pdf-lib TIRA
//     con cualquier carácter fuera de WinAnsi. Y una foto rota en disco tampoco
//     puede impedir que el reclamo se imprima.
//  3. **El texto es del TIPO.** Un reclamo se presenta ante un organismo; una
//     iniciativa la trata la Comisión (Art. 6.2), y su estado terminal va en
//     femenino.
import { inflateSync } from "node:zlib";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { identityLines, renderReportPdf, statusLine, type ReportPdfData } from "@/lib/reports/pdf";

/** El texto que de verdad quedó ADENTRO del archivo. Mirar los bytes crudos no
 *  alcanza: pdf-lib comprime los streams con Flate y escribe cada `drawText`
 *  como una cadena HEX (`<416E61…> Tj`), así que un `toContain("Ana")` sobre el
 *  buffer pasa siempre —y una aserción negativa sobre él pasaría también con el
 *  nombre adentro—. Se descomprime cada stream y se decodifican las cadenas hex;
 *  el caso "con nombre" es el control que prueba que esto lee de verdad. */
function pdfText(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes).toString("latin1");
  let out = "";
  const opener = /stream\r?\n/g;
  let match: RegExpExecArray | null;
  while ((match = opener.exec(raw)) !== null) {
    if (raw.slice(match.index - 3, match.index) === "end") continue;
    const start = match.index + match[0].length;
    const end = raw.indexOf("endstream", start);
    if (end < 0) break;
    const chunk = Buffer.from(raw.slice(start, end), "latin1");
    try {
      out += inflateSync(chunk).toString("latin1");
    } catch {
      out += chunk.toString("latin1"); // stream sin comprimir (una imagen JPEG)
    }
  }
  return out.replace(/<([0-9A-Fa-f\s]+)>/g, (whole, hex: string) => {
    const clean = hex.replace(/\s/g, "");
    return clean.length % 2 === 0 ? Buffer.from(clean, "hex").toString("latin1") : whole;
  });
}

const base: ReportPdfData = {
  number: 14,
  kind: "claim",
  status: "filed",
  categoryLabel: "Agua potable",
  subtypeLabel: "Pérdida de agua en la red",
  description: "Pierde agua desde hace una semana — “mucha”…",
  street: "Cerro Catedral al 280",
  lat: -45.797,
  lng: -67.494,
  outsideBoundary: false,
  scplTicket: "SC-123",
  submittedAt: new Date("2026-09-01T15:00:00Z"),
  reporter: {
    name: "Ana López",
    dni: "30123456",
    phone: "2974",
    email: "ana@example.com",
    memberNumber: null,
  },
  anonymous: false,
  filed: { agencyLabel: "SCPL", at: new Date("2026-09-12T15:00:00Z"), reference: "EXP 1", minuteName: null },
  dismissed: null,
  printedAt: new Date("2026-09-13T15:00:00Z"),
};

const photo = () =>
  sharp({ create: { width: 80, height: 60, channels: 3, background: "#0079BC" } })
    .jpeg()
    .toBuffer();

const mapPng = () =>
  sharp({ create: { width: 600, height: 400, channels: 3, background: "#eee" } })
    .png()
    .toBuffer();

describe("identityLines", () => {
  it("reservado: una sola línea y NADA de la persona", () => {
    expect(identityLines({ ...base, anonymous: true })).toEqual([
      "Identidad reservada a pedido de quien reporta.",
    ]);
  });

  it("con nombre: nombre, condición y los tres contactos", () => {
    const lines = identityLines(base).join(" ");
    expect(lines).toContain("Ana López");
    expect(lines).toContain("vecino/a");
    expect(lines).toContain("30123456");
    expect(lines).toContain("ana@example.com");
  });

  it("un socio se identifica por su número del libro abierto", () => {
    const lines = identityLines({
      ...base,
      reporter: { ...base.reporter, memberNumber: 306 },
    }).join(" ");
    expect(lines).toContain("socio N° 306");
    expect(lines).not.toContain("vecino/a");
  });

  it("los campos vacíos no imprimen 'null'", () => {
    const lines = identityLines({
      ...base,
      reporter: { name: null, dni: null, phone: null, email: null, memberNumber: null },
    }).join(" ");
    expect(lines).not.toContain("null");
    expect(lines).not.toContain("undefined");
  });
});

describe("statusLine", () => {
  it("un reclamo se PRESENTA ante el organismo, con su expediente", () => {
    expect(statusLine(base)).toBe("Presentado ante SCPL el 12/09/2026 · Expediente EXP 1.");
  });

  it("una iniciativa la TRATA la Comisión, y el acta va nombrada por tipo y número", () => {
    const line = statusLine({
      ...base,
      kind: "initiative",
      filed: {
        agencyLabel: null,
        at: new Date("2026-09-12T15:00:00Z"),
        reference: null,
        minuteName: "Comisión Directiva N° 124",
      },
    });
    expect(line).toBe("Tratada por la Comisión Directiva el 12/09/2026 · Comisión Directiva N° 124.");
  });

  it("el estado terminal lleva el género del tipo", () => {
    const dismissed = { at: new Date("2026-09-12T15:00:00Z"), reason: "Fuera del barrio" };
    expect(statusLine({ ...base, status: "dismissed", filed: null, dismissed })).toContain(
      "Desestimado el 12/09/2026",
    );
    expect(
      statusLine({ ...base, kind: "initiative", status: "dismissed", filed: null, dismissed }),
    ).toContain("Desestimada el 12/09/2026");
  });

  it("sin resolver, el pendiente también es del tipo", () => {
    expect(statusLine({ ...base, status: "received", filed: null })).toBe(
      "Recibido, pendiente de presentación.",
    );
    expect(statusLine({ ...base, kind: "initiative", status: "received", filed: null })).toBe(
      "Recibida, pendiente de tratamiento.",
    );
  });

  it("un `filed` que quedó sin fecha no inventa: cae al pendiente", () => {
    expect(statusLine({ ...base, status: "filed", filed: null })).toBe(
      "Recibido, pendiente de presentación.",
    );
  });
});

describe("renderReportPdf", () => {
  it("genera un PDF con fotos y mapa", async () => {
    const bytes = await renderReportPdf(base, {
      photos: [await photo(), await photo()],
      map: await mapPng(),
    });
    expect(Buffer.from(bytes.subarray(0, 5)).toString()).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(3000);
  });

  it("sin mapa y con una foto corrupta sale igual", async () => {
    const bytes = await renderReportPdf(base, { photos: [Buffer.from("no soy jpeg")], map: null });
    expect(Buffer.from(bytes.subarray(0, 5)).toString()).toBe("%PDF-");
  });

  it("un mapa corrupto no rompe: sale sin mapa", async () => {
    const bytes = await renderReportPdf(base, { photos: [], map: Buffer.from("no soy png") });
    expect(Buffer.from(bytes.subarray(0, 5)).toString()).toBe("%PDF-");
  });

  it("emojis, rayas y comillas curvas del vecino no tiran drawText", async () => {
    // Sin el saneado WinAnsi, esta sola línea revienta la generación entera.
    const bytes = await renderReportPdf(
      {
        ...base,
        description: "Hay un pozo 🚧 enorme — “peligroso”…\nSegunda línea con ñ, ü y °.",
        street: "Calle ①②③",
      },
      { photos: [], map: null },
    );
    expect(Buffer.from(bytes.subarray(0, 5)).toString()).toBe("%PDF-");
  });

  it("el salto de línea del vecino corta el párrafo, no se convierte en '?'", async () => {
    // El `\n` no está en WinAnsi: si el saneado corre ANTES de cortar, los dos
    // párrafos salen pegados con un signo de pregunta en el medio (pasó en un
    // PDF de prueba real).
    const bytes = await renderReportPdf(
      { ...base, description: "PRIMERO\nSEGUNDO" },
      { photos: [], map: null },
    );
    const text = pdfText(bytes);
    expect(text).toContain("PRIMERO");
    expect(text).toContain("SEGUNDO");
    expect(text).not.toContain("PRIMERO?SEGUNDO");
  });

  it("una descripción larguísima pagina sin perder el pie", async () => {
    const bytes = await renderReportPdf(
      { ...base, description: "palabra ".repeat(4000) },
      { photos: [await photo()], map: await mapPng() },
    );
    const text = pdfText(bytes);
    // Más de una hoja, y todas con su pie numerado.
    expect(text).toContain("Hoja 1 de ");
    expect(text).toContain("Hoja 2 de ");
  });

  it("reservado: la identidad NO viaja al archivo", async () => {
    // Control: con nombre, el nombre SÍ está adentro del archivo. Sin este
    // control la aserción negativa de abajo pasaría contra cualquier cosa.
    const withName = pdfText(await renderReportPdf(base, { photos: [], map: null }));
    expect(withName).toContain("Ana L");
    expect(withName).toContain("30123456");

    const reserved = pdfText(
      await renderReportPdf({ ...base, anonymous: true }, { photos: [], map: null }),
    );
    expect(reserved).toContain("Identidad reservada");
    expect(reserved).not.toContain("Ana L");
    expect(reserved).not.toContain("30123456");
    expect(reserved).not.toContain("ana@example.com");
    expect(reserved).not.toContain("2974");
  });
});
