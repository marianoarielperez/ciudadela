// Markdown → .docx para docs/manuales/. Uso:
//   npm run docs:build                      (compila tecnica/*.md y usuario/*.md)
//   npm run docs:build docs/manuales/tecnica/T1-vision-y-panorama.md
// Subconjunto de Markdown admitido: ver docs/manuales/README.md. Cualquier otra
// sintaxis corta el build con archivo y línea. Después de escribir cada Word,
// en Windows intenta actualizar el índice con Word por COM (update-toc.ps1).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Lexer, type Token, type Tokens } from "marked";
import {
  AlignmentType, BorderStyle, Document, ExternalHyperlink, Footer, Header, HeadingLevel,
  ImageRun, LevelFormat, PageBreak, PageNumber, Packer, Paragraph, ShadingType, Table,
  TableCell, TableOfContents, TableRow, TabStopType, TextRun, WidthType, type IParagraphOptions,
} from "docx";

const ROOT = process.cwd();
const OUT_DIR = join(ROOT, "docs", "manuales", "word");
const LOGO = join(ROOT, "docs", "manuales", "img", "logo.png");
const PS1 = join(ROOT, "scripts", "docs", "update-toc.ps1");

// A4 = 11906 × 16838 DXA; márgenes 2,5 cm = 1417 DXA → ancho útil 9072 DXA (16 cm).
const MARGIN = 1417;
const TEXT_WIDTH = 11906 - 2 * MARGIN;
const MAX_IMAGE_PX = 605; // 16 cm a 96 dpi
const BRAND = "0079BC";
const HEAD_FILL = "DCEBF7";
const CODE_FILL = "F1F5F9";
const FONT = "Calibri";
const MONO = "Consolas";

type Meta = { title: string; subtitle: string; series: string; docx: string; version: string; date: string };

class BuildError extends Error {}

// ---------- front matter ----------
function parseFrontMatter(raw: string, file: string): { meta: Meta; body: string; bodyLineOffset: number } {
  const src = raw.replace(/^﻿/, ""); // un BOM tapa el --- de apertura
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(src);
  if (!m) throw new BuildError(`${file}:1 falta el front matter (--- title: … ---)`);
  const meta: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([a-z]+):\s*(.*)$/.exec(line.trim());
    if (kv) meta[kv[1]] = kv[2].replace(/^"(.*)"$/, "$1");
  }
  for (const k of ["title", "subtitle", "series", "docx", "version", "date"]) {
    if (!meta[k]) throw new BuildError(`${file}:1 el front matter no tiene "${k}"`);
  }
  return { meta: meta as Meta, body: src.slice(m[0].length), bodyLineOffset: m[0].split("\n").length - 1 };
}

// ---------- utilidades ----------
function unescapeEntities(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

// null si el archivo no es un PNG: quien llama decide cómo avisar (con línea del
// Markdown desde el cuerpo, sin línea desde la portada).
function pngSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 24 || buf.toString("ascii", 1, 4) !== "PNG") return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function countLines(raw: string): number {
  return (raw.match(/\n/g) ?? []).length;
}

// ---------- estado por documento ----------
class Ctx {
  figure = 0;
  numberingInstance = 0;
  line = 1;
  constructor(readonly file: string, readonly dir: string) {}
  fail(msg: string): never { throw new BuildError(`${this.file}:${this.line} ${msg}`); }
}

// Decoración que arrastra una cita: sangría y barra celeste a la izquierda. Se
// pasa hacia abajo al armar cada párrafo en vez de clonar el Paragraph ya hecho
// (docx no expone las opciones de un párrafo construido).
type Deco = { indent?: IParagraphOptions["indent"]; border?: IParagraphOptions["border"] };
const QUOTE: Deco = {
  indent: { left: 360 },
  border: { left: { style: BorderStyle.SINGLE, size: 18, color: BRAND, space: 8 } },
};

// ---------- inline ----------
type Inline = TextRun | ExternalHyperlink;
type Style = { bold?: boolean; italics?: boolean; style?: string };

function inline(tokens: Token[] | undefined, ctx: Ctx, style: Style = {}): Inline[] {
  const out: Inline[] = [];
  for (const t of tokens ?? []) {
    switch (t.type) {
      case "text": {
        const tt = t as Tokens.Text;
        if (tt.tokens) out.push(...inline(tt.tokens, ctx, style));
        else out.push(new TextRun({ text: unescapeEntities(tt.text), ...style }));
        break;
      }
      case "escape": out.push(new TextRun({ text: (t as Tokens.Escape).text, ...style })); break;
      case "strong": out.push(...inline((t as Tokens.Strong).tokens, ctx, { ...style, bold: true })); break;
      case "em": out.push(...inline((t as Tokens.Em).tokens, ctx, { ...style, italics: true })); break;
      case "codespan":
        out.push(new TextRun({ text: unescapeEntities((t as Tokens.Codespan).text), font: MONO, size: 20, shading: { type: ShadingType.CLEAR, fill: CODE_FILL, color: "auto" }, ...style }));
        break;
      case "br": out.push(new TextRun({ break: 1 })); break;
      case "link": {
        const l = t as Tokens.Link;
        const linked = { ...style, style: "Hyperlink" };
        const label = inline(l.tokens, ctx, linked);
        out.push(new ExternalHyperlink({ link: l.href, children: label.length ? label : [new TextRun({ text: l.href, ...linked })] }));
        // El autolink de un correo llega como texto "x@y" y href "mailto:x@y": no
        // hay que repetir la dirección entre paréntesis.
        if (l.text !== l.href.replace(/^mailto:/, "")) out.push(new TextRun({ text: ` (${l.href})`, ...style, size: 18, color: "555555" }));
        break;
      }
      case "del": ctx.fail("el tachado ~~texto~~ no está admitido"); break;
      case "html": ctx.fail(`HTML inline no admitido: ${(t as Tokens.HTML).raw.slice(0, 40)}`); break;
      case "image": ctx.fail("una imagen tiene que ir sola en su párrafo"); break;
      default: ctx.fail(`sintaxis inline no admitida (${t.type})`);
    }
  }
  return out;
}

// ---------- bloques ----------
type Block = Paragraph | Table;

function heading(depth: number, tokens: Token[], ctx: Ctx): Paragraph {
  const levels = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4];
  if (depth < 1 || depth > 4) ctx.fail(`solo se admiten títulos # a #### (encontré ${"#".repeat(depth)})`);
  return new Paragraph({ heading: levels[depth - 1], pageBreakBefore: depth === 1, children: inline(tokens, ctx) });
}

function image(tok: Tokens.Image, ctx: Ctx): Paragraph[] {
  const path = resolve(ctx.dir, tok.href);
  if (!existsSync(path)) ctx.fail(`imagen no encontrada: ${tok.href}`);
  const buf = readFileSync(path);
  const size = pngSize(buf);
  if (!size) ctx.fail(`solo se admiten imágenes PNG: ${tok.href}`);
  const { width, height } = size;
  const scale = Math.min(1, MAX_IMAGE_PX / width);
  ctx.figure += 1;
  return [
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 120, after: 60 }, keepNext: true, children: [new ImageRun({ type: "png", data: buf, transformation: { width: Math.round(width * scale), height: Math.round(height * scale) } })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [new TextRun({ text: `Figura ${ctx.figure} — ${unescapeEntities(tok.text)}`, italics: true, size: 18, color: "444444" })] }),
  ];
}

function codeBlock(tok: Tokens.Code): Table {
  const lines = tok.text.split("\n");
  return new Table({
    width: { size: TEXT_WIDTH, type: WidthType.DXA },
    columnWidths: [TEXT_WIDTH],
    rows: [new TableRow({ children: [new TableCell({
      width: { size: TEXT_WIDTH, type: WidthType.DXA },
      shading: { type: ShadingType.CLEAR, fill: CODE_FILL, color: "auto" },
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      children: lines.map((l) => new Paragraph({ spacing: { after: 0 }, children: [new TextRun({ text: l, font: MONO, size: 19 })] })),
    })] })],
  });
}

function table(tok: Tokens.Table, ctx: Ctx): Table {
  // Con más de 8 columnas el piso del 10 % pasa el ancho útil y la última columna
  // sale negativa; en A4 tampoco se leería.
  if (tok.header.length > 8) ctx.fail("una tabla no puede tener más de 8 columnas");
  // Ancho proporcional al texto más largo de cada columna, con piso del 10 %. El
  // piso agranda a las angostas (una columna "N°" se queda sin lugar para el
  // encabezado), así que lo que se le dio de más se le saca a las que NO tocaron el
  // piso: si el sobrante se descontara al final de la última columna, ésa podía
  // quedar en cero o negativa aun con seis columnas.
  const cols = tok.header.length;
  const longest = tok.header.map((h, i) => Math.max(h.text.length, ...tok.rows.map((r) => r[i]?.text.length ?? 0), 4));
  const total = longest.reduce((a, b) => a + b, 0);
  const floor = Math.round(TEXT_WIDTH * 0.1);
  const share = longest.map((l) => (l / total) * TEXT_WIDTH);
  const pinned = share.map((w) => w < floor);
  const free = pinned.filter((p) => !p).length;
  let widths: number[];
  if (free === 0) {
    widths = share.map(() => Math.round(TEXT_WIDTH / cols));
  } else {
    const budget = TEXT_WIDTH - floor * (cols - free);
    const freeTotal = share.reduce((a, w, i) => a + (pinned[i] ? 0 : w), 0);
    widths = share.map((w, i) => (pinned[i] ? floor : Math.round((w / freeTotal) * budget)));
  }
  // El redondeo deja unas pocas DXA sueltas: se las queda la columna más ancha.
  const widest = widths.indexOf(Math.max(...widths));
  widths[widest] += TEXT_WIDTH - widths.reduce((a, b) => a + b, 0);
  if (widths.some((w) => w <= 0)) ctx.fail(`no se pudo repartir el ancho de la tabla entre ${cols} columnas`);
  const cell = (c: Tokens.TableCell, i: number, head: boolean) => new TableCell({
    width: { size: widths[i], type: WidthType.DXA },
    shading: head ? { type: ShadingType.CLEAR, fill: HEAD_FILL, color: "auto" } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({ spacing: { after: 0 }, children: inline(c.tokens, ctx, head ? { bold: true } : {}) })],
  });
  return new Table({
    width: { size: TEXT_WIDTH, type: WidthType.DXA },
    columnWidths: widths,
    rows: [
      new TableRow({ tableHeader: true, children: tok.header.map((c, i) => cell(c, i, true)) }),
      ...tok.rows.map((r) => new TableRow({ children: r.map((c, i) => cell(c, i, false)) })),
    ],
  });
}

function list(tok: Tokens.List, ctx: Ctx, level: number, deco: Deco = {}): Block[] {
  if (level > 1) ctx.fail("las listas admiten dos niveles como máximo");
  const reference = tok.ordered ? "numbers" : "bullets";
  const instance = tok.ordered && level === 0 ? ++ctx.numberingInstance : ctx.numberingInstance;
  // La sangría de una cita la maneja la numeración, así que dentro de una lista
  // sólo se arrastra la barra de la izquierda.
  const border = deco.border;
  const out: Block[] = [];
  // La línea avanza ítem por ítem para que un error adentro de la lista no apunte
  // siempre a donde empieza; el llamador la restaura y suma el bloque entero.
  for (const item of tok.items) {
    if (item.task) ctx.fail("las casillas - [ ] no están admitidas");
    let first = true;
    for (const child of item.tokens) {
      if (child.type === "text" || child.type === "paragraph") {
        const runs = inline((child as Tokens.Text).tokens, ctx);
        out.push(new Paragraph({ numbering: first ? { reference, level, instance } : undefined, indent: first ? undefined : { left: 720 * (level + 1) }, border, spacing: { after: 60 }, children: runs }));
        first = false;
      } else if (child.type === "list") {
        const sub = ctx.line;
        out.push(...list(child as Tokens.List, ctx, level + 1, deco));
        ctx.line = sub;
      } else if (child.type === "space") {
        continue;
      } else {
        ctx.fail(`dentro de una lista solo va texto o una sublista (encontré ${child.type})`);
      }
    }
    ctx.line += countLines(item.raw);
  }
  return out;
}

function blocks(tokens: Token[], ctx: Ctx, deco: Deco = {}): Block[] {
  const out: Block[] = [];
  for (const t of tokens) {
    switch (t.type) {
      case "space": break;
      case "heading": out.push(heading((t as Tokens.Heading).depth, (t as Tokens.Heading).tokens, ctx)); break;
      case "paragraph": {
        const p = t as Tokens.Paragraph;
        if (p.tokens.length === 1 && p.tokens[0].type === "image") { out.push(...image(p.tokens[0] as Tokens.Image, ctx)); break; }
        out.push(new Paragraph({ ...deco, spacing: { after: 120 }, children: inline(p.tokens, ctx) }));
        break;
      }
      case "text": out.push(new Paragraph({ ...deco, spacing: { after: 120 }, children: inline((t as Tokens.Text).tokens ?? [t], ctx) })); break;
      case "code": out.push(codeBlock(t as Tokens.Code), new Paragraph({ spacing: { after: 120 } })); break;
      case "table": out.push(table(t as Tokens.Table, ctx), new Paragraph({ spacing: { after: 120 } })); break;
      // Los dos bloques que recursan llevan su propia cuenta de líneas adentro: se
      // restaura la de entrada y el incremento de abajo suma el bloque entero una
      // sola vez.
      case "list": {
        const start = ctx.line;
        out.push(...list(t as Tokens.List, ctx, 0, deco));
        ctx.line = start;
        out.push(new Paragraph({ spacing: { after: 60 } }));
        break;
      }
      case "blockquote": {
        const start = ctx.line;
        out.push(...blocks((t as Tokens.Blockquote).tokens, ctx, QUOTE));
        ctx.line = start;
        break;
      }
      case "hr": out.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "999999", space: 1 } }, spacing: { after: 200 } })); break;
      case "html": ctx.fail(`HTML no admitido: ${(t as Tokens.HTML).raw.trim().slice(0, 40)}`); break;
      case "def": ctx.fail("las definiciones de enlace [x]: url no se admiten; escribí el enlace inline"); break;
      default: ctx.fail(`sintaxis no admitida (${t.type})`);
    }
    ctx.line += countLines(t.raw);
  }
  return out;
}

// ---------- portada, índice, header/footer ----------
function cover(meta: Meta): Paragraph[] {
  const logo = readFileSync(LOGO);
  const size = pngSize(logo);
  if (!size) throw new BuildError(`${LOGO}: el logo de la portada tiene que ser PNG`);
  const { width, height } = size;
  const w = 190; // ~5 cm
  const center = (text: string, opts: { size: number; bold?: boolean; color?: string; before?: number }) =>
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: opts.before ?? 0, after: 120 }, children: [new TextRun({ text, size: opts.size, bold: opts.bold, color: opts.color, font: FONT })] });
  return [
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 2400, after: 600 }, children: [new ImageRun({ type: "png", data: logo, transformation: { width: w, height: Math.round((height / width) * w) } })] }),
    center("SIGeV — Sistema Integral de Gestión Vecinal", { size: 28, color: "555555" }),
    center(meta.title, { size: 56, bold: true, color: BRAND, before: 400 }),
    center(meta.subtitle, { size: 32, color: "333333" }),
    center(meta.series, { size: 24, color: "555555", before: 200 }),
    center("Asociación Vecinal del Barrio Ciudadela · Comodoro Rivadavia, Chubut", { size: 22, color: "555555", before: 1800 }),
    center(`Versión ${meta.version} · ${meta.date}`, { size: 22, color: "555555" }),
  ];
}

function headerFooter(meta: Meta) {
  const tab = { tabStops: [{ type: TabStopType.RIGHT, position: TEXT_WIDTH }] };
  return {
    header: new Header({ children: [new Paragraph({ ...tab, border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "BBBBBB", space: 4 } }, children: [new TextRun({ text: `${meta.title}\tSIGeV`, size: 18, color: "666666" })] })] }),
    footer: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [
      new TextRun({ text: `SIGeV — v${meta.version} — ${meta.date} — Página `, size: 18, color: "666666" }),
      new TextRun({ children: [PageNumber.CURRENT], size: 18, color: "666666" }),
      new TextRun({ text: " de ", size: 18, color: "666666" }),
      new TextRun({ children: [PageNumber.TOTAL_PAGES_IN_SECTION], size: 18, color: "666666" }),
    ] })] }),
  };
}

function buildDocument(meta: Meta, body: Block[]): Document {
  const { header, footer } = headerFooter(meta);
  const h = (id: string, name: string, size: number, extra: Record<string, unknown> = {}) => ({
    id, name, basedOn: "Normal", next: "Normal", quickFormat: true,
    run: { size, bold: true, color: BRAND, font: FONT },
    paragraph: { spacing: { before: 280, after: 120 }, outlineLevel: Number(id.slice(-1)) - 1, ...extra },
  });
  return new Document({
    creator: "SIGeV", title: meta.title, description: meta.subtitle,
    styles: {
      // Interlineado 1,15 para todo el documento, no sólo para los párrafos sueltos.
      default: { document: { run: { font: FONT, size: 22 }, paragraph: { spacing: { line: 276 } } } },
      paragraphStyles: [
        h("Heading1", "Heading 1", 36, { border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: BRAND, space: 4 } }, spacing: { before: 0, after: 240 } }),
        h("Heading2", "Heading 2", 28),
        h("Heading3", "Heading 3", 24),
        h("Heading4", "Heading 4", 22),
      ],
    },
    numbering: { config: [
      { reference: "bullets", levels: [
        { level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
        { level: 1, format: LevelFormat.BULLET, text: "–", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 1440, hanging: 360 } } } },
      ] },
      { reference: "numbers", levels: [
        { level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
        { level: 1, format: LevelFormat.LOWER_LETTER, text: "%2)", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 1440, hanging: 360 } } } },
      ] },
    ] },
    sections: [
      { properties: { page: { margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } } }, children: cover(meta) },
      {
        properties: { page: { margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN }, pageNumbers: { start: 1 } } },
        headers: { default: header }, footers: { default: footer },
        children: [
          // Con el estilo Heading1 el índice se listaba a sí mismo: mismo aspecto,
          // sin nivel de esquema.
          new Paragraph({
            spacing: { after: 240 },
            border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: BRAND, space: 4 } },
            children: [new TextRun({ text: "Índice", bold: true, size: 36, color: BRAND, font: FONT })],
          }),
          new TableOfContents("Índice", { hyperlink: true, headingStyleRange: "1-3" }),
          new Paragraph({ children: [new PageBreak()] }),
          ...body,
        ],
      },
    ],
  });
}

// ---------- main ----------
async function buildOne(file: string): Promise<string> {
  const abs = resolve(file);
  const src = readFileSync(abs, "utf8");
  const { meta, body, bodyLineOffset } = parseFrontMatter(src, file);
  const ctx = new Ctx(file, dirname(abs));
  ctx.line = bodyLineOffset + 1;
  const tokens = new Lexer({ gfm: true }).lex(body);
  const content = blocks(tokens, ctx);
  const doc = buildDocument(meta, content);
  const out = join(OUT_DIR, `${meta.docx}.docx`);
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(out, await Packer.toBuffer(doc));
  console.log(`ok  ${file} → ${out.replace(ROOT + "\\", "").replace(ROOT + "/", "")}`);
  return out;
}

function defaultInputs(): string[] {
  const dirs = [join(ROOT, "docs", "manuales", "tecnica"), join(ROOT, "docs", "manuales", "usuario")];
  return dirs.flatMap((d) => (existsSync(d) ? readdirSync(d).filter((f) => f.endsWith(".md") && !f.startsWith("_")).sort().map((f) => join(d, f)) : []));
}

const F9 = "Abrí el .docx en Word, clic en el índice y F9.";

// Sin Word, PowerShell termina con código 0 y el error sólo en stderr, así que el
// código de salida NO alcanza: también se miran stderr y que haya salido al menos
// una línea "… páginas" (que es la prueba de que el índice se actualizó de verdad).
function updateToc(paths: string[]): void {
  if (process.platform !== "win32" || process.env.DOCS_SKIP_TOC === "1") {
    console.warn(`aviso: el índice no se actualizó (hace falta Word en Windows). ${F9}`);
    return;
  }
  const r = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", PS1, ...paths], { encoding: "utf8", timeout: 120_000 });
  const stdout = r.stdout ?? "";
  const stderr = (r.stderr ?? "").trim();
  const updated = stdout.split(/\r?\n/).filter((l) => l.includes("páginas")).length;
  process.stdout.write(stdout);
  if (r.error || r.status !== 0 || stderr || updated < paths.length) {
    const why = r.error?.message ?? (stderr || (r.status !== 0 ? `PowerShell terminó con código ${r.status}` : "Word no informó las páginas de cada documento"));
    console.warn(`aviso: falló la actualización del índice con Word: ${why.split("\n")[0]}. ${F9}`);
  }
}

async function main() {
  const inputs = process.argv.slice(2).length ? process.argv.slice(2) : defaultInputs();
  if (!inputs.length) { console.error("no hay Markdown para compilar"); process.exit(1); }
  const outputs: string[] = [];
  for (const f of inputs) outputs.push(await buildOne(f));
  updateToc(outputs);
}

main().catch((err) => {
  console.error(err instanceof BuildError ? `error: ${err.message}` : err);
  process.exit(1);
});
