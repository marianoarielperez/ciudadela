// La MISMA constancia que el PDF, en Word: la versión retocable. La secretaría
// abre este archivo, copia los renglones al acta real del libro —junto con las
// decisiones que el sistema no ve— y lo tira. Por eso el contenido viene del
// mismo `MinuteExportModel` que el PDF: una sola redacción, dos formatos.
//
// `docx` es JS puro (sin binarios), mismo criterio de VPS que pdf-lib.
// Los tamaños de fuente de docx van en MEDIOS puntos: size 22 = 11 pt.
import { AlignmentType, Document, Packer, Paragraph, TextRun } from "docx";

import { SITE } from "@/lib/site";
import type { MinuteExportModel } from "./export-content";

const PRIMARY = "0079BC"; // el token --primary, sin "#": docx usa hex pelado
const MUTED = "737373";

export async function renderMinuteDocx(model: MinuteExportModel): Promise<Uint8Array> {
  const children: Paragraph[] = [
    new Paragraph({
      children: [new TextRun({ text: SITE.name, bold: true, size: 26 })],
    }),
    new Paragraph({
      children: [new TextRun({ text: `${SITE.address} — ${SITE.city}`, size: 18, color: MUTED })],
      spacing: { after: 240 },
    }),
    new Paragraph({
      children: [new TextRun({ text: model.title.toUpperCase(), bold: true, size: 18, color: MUTED })],
    }),
    new Paragraph({
      children: [new TextRun({ text: model.minuteLabel, bold: true, size: 30, color: PRIMARY })],
      spacing: { after: 240 },
    }),
  ];

  if (model.description) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: model.description, italics: true, size: 20, color: MUTED })],
        spacing: { after: 120 },
      }),
    );
  }
  children.push(
    new Paragraph({
      children: [new TextRun({ text: model.totalLine, bold: true, size: 20 })],
      spacing: { after: 240 },
    }),
  );

  for (const section of model.sections) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: section.heading.toUpperCase(), bold: true, size: 18, color: MUTED })],
        spacing: { before: 160, after: 80 },
      }),
    );
    for (const line of section.lines) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: line, size: 22 })],
          bullet: { level: 0 },
          spacing: { after: 40 },
        }),
      );
    }
  }

  children.push(
    new Paragraph({
      children: [new TextRun({ text: model.footer, size: 16, color: MUTED })],
      alignment: AlignmentType.LEFT,
      spacing: { before: 360 },
    }),
  );

  const doc = new Document({
    title: `${model.title} — ${model.minuteLabel}`,
    sections: [{ children }],
  });
  const buffer = await Packer.toBuffer(doc);
  return new Uint8Array(buffer);
}
