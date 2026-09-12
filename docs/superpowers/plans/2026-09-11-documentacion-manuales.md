# Documentación técnica y manuales en Word — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Producir siete documentos técnicos y tres manuales de usuario como `.docx` generados desde Markdown, con capturas reales del dev server, más el archivo de hallazgos del relevamiento.

**Architecture:** Fuente Markdown en `docs/manuales/`, un script de build (`marked` → librería `docx`) que genera los Word y actualiza el índice con Word por COM, un script de capturas con `playwright-core` sobre el Chrome instalado, y un subagente escritor por documento con un revisor que coteja contra el código. Spec: `docs/superpowers/specs/2026-09-11-documentacion-manuales-design.md`.

**Tech Stack:** Node 24, `tsx`, `docx` 9.7.1 (ya instalada), `marked` (nueva devDependency), `playwright-core` (nueva devDependency, `channel: "chrome"`), PowerShell + Word COM para el índice, LibreOffice headless para verificar en PDF.

## Global Constraints

- Rama `docs-manuales`. Commits en inglés con el trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- El diff final toca SOLO: `docs/manuales/**`, `docs/superpowers/**`, `scripts/docs/**`, `package.json`, `package-lock.json`, `CLAUDE.md`. Ningún archivo de `src/`, `prisma/`, `tests/`.
- **No se agregan tests a `tests/`**: el conteo de `npm test` tiene que quedar igual que en `main` (la línea de base la anota la Tarea 0 en `.superpowers/sdd/manuales/baseline.md`).
- `tsconfig.json` incluye `**/*.ts`, así que `scripts/docs/*.ts` tiene que pasar `npx tsc --noEmit` y `npm run lint` limpios.
- Español rioplatense. Manuales de **vos**. Técnicos en impersonal. Fechas DD/MM/AAAA, moneda `$ 1.234,56`.
- Identificadores de código en inglés y en `código inline`; máximo un identificador por frase. Sin transcribir código en los docs (bloques cortos de comandos y `.env` sí).
- Toda afirmación sale del código o de los informes `.superpowers/sdd/manuales/scan-0*.md` (que citan `archivo:línea`). Lo que no se puede verificar no se escribe. Donde `docs/` y código difieren, se describe el código y se anota en HALLAZGOS.
- Un manual no habla de actions ni de tablas: dice qué ve el usuario y qué mensaje literal aparece.
- Reportes: un **reclamo** se presenta ante un organismo; una **iniciativa** la trata la Comisión Directiva. Revisar cada frase que hable de reportes.
- Capturas: ninguna con DNI, domicilio o nombre de un socio real del padrón importado. Solo `*.prueba` o fichas inventadas. Viewport 1280×800, escala 1, tema claro.
- Las contraseñas de prueba salen de `SEED_TEST_PASSWORD` del `.env` local y no se escriben en ningún archivo commiteado.
- Markdown admitido (el build falla con otra cosa): `#`-`####`, párrafos, `**`, `*`, `` ` ``, enlaces, listas `-`/`1.` de dos niveles, tablas GFM, bloques de código con lenguaje, `>` citas, `![leyenda](ruta)`, `---`, front matter YAML plano (`title`, `subtitle`, `series`, `docx`, `version`, `date`).
- Cada documento abre con "Para quién es y qué da por sabido" y "Cómo leer este documento"; los técnicos cierran cada capítulo con "Dónde está en el código"; todos cierran con "Documentos relacionados".
- Páginas objetivo (tope, medidas con Word por COM al compilar): T1 15-20, T2 25-30, T3 25-30, T4 20-25, T5 30, T6 25, T7 20, M1 40, M2 20, M3 20.

---

## Mapa de archivos

| Archivo | Responsabilidad | Tarea |
|---|---|---|
| `scripts/docs/build-docx.ts` | Markdown → `.docx` con portada, índice, estilos, header/footer; invoca el ps1 | 0 |
| `scripts/docs/update-toc.ps1` | Abre cada Word por COM, actualiza campos e índice, imprime páginas | 0 |
| `docs/manuales/img/logo.png` | Copia de `assets/logo.png` | 0 |
| `docs/manuales/README.md` | Cómo regenerar, convenciones, cómo re-capturar | 0 (esqueleto), 13 (final) |
| `package.json` | `docs:build`, `docs:capture`, devDeps | 0 |
| `scripts/docs/reset-test-passwords.ts` | Reaplica `SEED_TEST_PASSWORD` a los tres usuarios de prueba (solo localhost) | 1 |
| `scripts/docs/capture-plan.ts` | Lista de capturas (manual, archivo, rol, URL, preparación) | 1 (esqueleto), 2 (completa) |
| `scripts/docs/capture.ts` | Login por rol y captura de la lista con playwright-core | 1 |
| `docs/manuales/img/m1|m2|m3/*.png` | Capturas | 2 |
| `docs/manuales/tecnica/T1..T7-*.md` | Documentos técnicos | 3-9 |
| `docs/manuales/usuario/M1..M3-*.md` | Manuales | 10-12 |
| `docs/manuales/HALLAZGOS-2026-09-11.md` | Inconsistencias docs↔código | 13 |
| `CLAUDE.md` | Párrafo "Documentación y manuales" | 13 |
| `docs/manuales/word/*.docx` | Salida del build (commiteada) | cada tarea de doc |
| `.superpowers/sdd/manuales/*.md` | Briefs, reports, baseline, verificación final (gitignored) | todas |

---

### Task 0: Pipeline Markdown → Word y plantilla

**Files:**
- Create: `scripts/docs/build-docx.ts`, `scripts/docs/update-toc.ps1`, `docs/manuales/img/logo.png`, `docs/manuales/README.md`, `docs/manuales/word/.gitkeep`
- Modify: `package.json` (scripts + devDependencies)
- Scratch: `.superpowers/sdd/manuales/prueba-pipeline.md` (documento de prueba, no se commitea), `.superpowers/sdd/manuales/baseline.md`

**Interfaces:**
- Produces: `npm run docs:build [ruta.md …]` (sin argumentos compila `docs/manuales/tecnica/*.md` y `docs/manuales/usuario/*.md`), salida en `docs/manuales/word/<front matter docx>.docx`; imprime `páginas: N` por archivo cuando Word está disponible.
- Front matter que consumen las tareas 3-12: `title`, `subtitle`, `series`, `docx`, `version`, `date`.

- [ ] **Step 1: Línea de base**

Run: `git rev-parse --abbrev-ref HEAD` → `docs-manuales`. Run: `npm test 2>&1 | tail -6` y anotar en `.superpowers/sdd/manuales/baseline.md` las líneas `Test Files` y `Tests` (ej. `Test Files 297 passed`, `Tests 4050 passed`). Ese número es el que la Tarea 14 compara.

- [ ] **Step 2: Dependencias y scripts de npm**

Run: `npm install -D marked playwright-core`

Editar `package.json` → `scripts`, agregar:

```json
"docs:build": "tsx scripts/docs/build-docx.ts",
"docs:capture": "tsx scripts/docs/capture.ts"
```

Run: `cp assets/logo.png docs/manuales/img/logo.png && mkdir -p docs/manuales/word docs/manuales/tecnica docs/manuales/usuario docs/manuales/img/m1 docs/manuales/img/m2 docs/manuales/img/m3 && touch docs/manuales/word/.gitkeep`

- [ ] **Step 3: El script de actualización del índice**

Crear `scripts/docs/update-toc.ps1`:

```powershell
# Abre cada .docx con Word (COM), actualiza campos e índice, guarda y cierra.
# Imprime "<archivo>: <páginas> páginas". Lo llama scripts/docs/build-docx.ts.
param([Parameter(Mandatory = $true)][string[]]$Paths)

$word = $null
try {
  $word = New-Object -ComObject Word.Application
  $word.Visible = $false
  $word.DisplayAlerts = 0
  foreach ($p in $Paths) {
    $full = (Resolve-Path $p).Path
    $doc = $word.Documents.Open($full, $false, $false)
    try {
      $doc.Fields.Update() | Out-Null
      foreach ($toc in $doc.TablesOfContents) { $toc.Update() | Out-Null }
      $doc.Repaginate()
      $pages = $doc.ComputeStatistics(2)   # 2 = wdStatisticPages
      $doc.Save()
      Write-Output ("{0}: {1} páginas" -f (Split-Path $full -Leaf), $pages)
    } finally {
      $doc.Close(0) | Out-Null
    }
  }
} finally {
  if ($word -ne $null) {
    $word.Quit()
    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($word)
  }
}
```

- [ ] **Step 4: El script de build**

Crear `scripts/docs/build-docx.ts`:

```ts
// Markdown → .docx para docs/manuales/. Uso:
//   npm run docs:build                      (compila tecnica/*.md y usuario/*.md)
//   npm run docs:build docs/manuales/tecnica/T1-vision-y-panorama.md
// Subconjunto de Markdown admitido: ver docs/manuales/README.md. Cualquier otra
// sintaxis corta el build con archivo y línea. Después de escribir cada Word,
// en Windows intenta actualizar el índice con Word por COM (update-toc.ps1).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
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
function parseFrontMatter(src: string, file: string): { meta: Meta; body: string; bodyLineOffset: number } {
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

function pngSize(buf: Buffer, file: string): { width: number; height: number } {
  if (buf.length < 24 || buf.toString("ascii", 1, 4) !== "PNG") throw new BuildError(`${file}: solo se admiten imágenes PNG`);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

// ---------- estado por documento ----------
class Ctx {
  figure = 0;
  numberingInstance = 0;
  line = 1;
  constructor(readonly file: string, readonly dir: string) {}
  fail(msg: string): never { throw new BuildError(`${this.file}:${this.line} ${msg}`); }
}

// ---------- inline ----------
type Inline = TextRun | ExternalHyperlink;
type Style = { bold?: boolean; italics?: boolean };

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
        const label = inline(l.tokens, ctx, style);
        out.push(new ExternalHyperlink({ link: l.href, children: label.length ? label : [new TextRun({ text: l.href })] }));
        if (l.text !== l.href) out.push(new TextRun({ text: ` (${l.href})`, ...style, size: 18, color: "555555" }));
        break;
      }
      case "del": out.push(...inline((t as Tokens.Del).tokens, ctx, style)); break;
      case "html": ctx.fail(`HTML inline no admitido: ${(t as Tokens.HTML).raw.slice(0, 40)}`);
      case "image": ctx.fail("una imagen tiene que ir sola en su párrafo");
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
  const { width, height } = pngSize(buf, tok.href);
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
  const cols = tok.header.length;
  // Ancho proporcional al texto más largo de cada columna, con piso del 10 %.
  const longest = tok.header.map((h, i) => Math.max(h.text.length, ...tok.rows.map((r) => r[i]?.text.length ?? 0), 4));
  const total = longest.reduce((a, b) => a + b, 0);
  const widths = longest.map((l) => Math.max(Math.round((l / total) * TEXT_WIDTH), Math.round(TEXT_WIDTH * 0.1)));
  const sum = widths.reduce((a, b) => a + b, 0);
  widths[widths.length - 1] += TEXT_WIDTH - sum;
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

function list(tok: Tokens.List, ctx: Ctx, level: number): Block[] {
  if (level > 1) ctx.fail("las listas admiten dos niveles como máximo");
  const reference = tok.ordered ? "numbers" : "bullets";
  const instance = tok.ordered && level === 0 ? ++ctx.numberingInstance : ctx.numberingInstance;
  const out: Block[] = [];
  for (const item of tok.items) {
    let first = true;
    for (const child of item.tokens) {
      if (child.type === "text" || child.type === "paragraph") {
        const runs = inline((child as Tokens.Text).tokens, ctx);
        out.push(new Paragraph({ numbering: first ? { reference, level, instance } : undefined, indent: first ? undefined : { left: 720 * (level + 1) }, spacing: { after: 60 }, children: runs }));
        first = false;
      } else if (child.type === "list") {
        out.push(...list(child as Tokens.List, ctx, level + 1));
      } else if (child.type === "space") {
        continue;
      } else {
        ctx.fail(`dentro de una lista solo va texto o una sublista (encontré ${child.type})`);
      }
    }
  }
  return out;
}

function blockquote(tok: Tokens.Blockquote, ctx: Ctx): Block[] {
  return blocks(tok.tokens, ctx).map((b) =>
    b instanceof Paragraph
      ? new Paragraph({ ...(b as unknown as { options: IParagraphOptions }).options, indent: { left: 360 }, border: { left: { style: BorderStyle.SINGLE, size: 18, color: BRAND, space: 8 } } })
      : b,
  );
}

function blocks(tokens: Token[], ctx: Ctx): Block[] {
  const out: Block[] = [];
  for (const t of tokens) {
    switch (t.type) {
      case "space": break;
      case "heading": out.push(heading((t as Tokens.Heading).depth, (t as Tokens.Heading).tokens, ctx)); break;
      case "paragraph": {
        const p = t as Tokens.Paragraph;
        if (p.tokens.length === 1 && p.tokens[0].type === "image") { out.push(...image(p.tokens[0] as Tokens.Image, ctx)); break; }
        out.push(new Paragraph({ spacing: { after: 120, line: 276 }, children: inline(p.tokens, ctx) }));
        break;
      }
      case "text": out.push(new Paragraph({ spacing: { after: 120 }, children: inline((t as Tokens.Text).tokens ?? [t], ctx) })); break;
      case "code": out.push(codeBlock(t as Tokens.Code), new Paragraph({ spacing: { after: 120 } })); break;
      case "table": out.push(table(t as Tokens.Table, ctx), new Paragraph({ spacing: { after: 120 } })); break;
      case "list": out.push(...list(t as Tokens.List, ctx, 0)); out.push(new Paragraph({ spacing: { after: 60 } })); break;
      case "blockquote": out.push(...blockquote(t as Tokens.Blockquote, ctx)); break;
      case "hr": out.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "999999", space: 1 } }, spacing: { after: 200 } })); break;
      case "html": ctx.fail(`HTML no admitido: ${(t as Tokens.HTML).raw.trim().slice(0, 40)}`);
      case "def": ctx.fail("las definiciones de enlace [x]: url no se admiten; escribí el enlace inline");
      default: ctx.fail(`sintaxis no admitida (${t.type})`);
    }
    ctx.line += (t.raw.match(/\n/g) ?? []).length;
  }
  return out;
}

// ---------- portada, índice, header/footer ----------
function cover(meta: Meta): Paragraph[] {
  const logo = readFileSync(LOGO);
  const { width, height } = pngSize(logo, LOGO);
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
      default: { document: { run: { font: FONT, size: 22 } } },
      paragraphStyles: [
        h("Heading1", "Heading 1", 36, { border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: BRAND, space: 4 } }, spacing: { before: 0, after: 240 } }),
        h("Heading2", "Heading 2", 28),
        h("Heading3", "Heading 3", 24),
        h("Heading4", "Heading 4", 22),
      ],
    },
    numbering: { config: [
      { reference: "bullets", levels: [
        { level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
        { level: 1, format: LevelFormat.BULLET, text: "\u2013", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 1440, hanging: 360 } } } },
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
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Índice")] }),
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
  // El índice se rompe si el primer bloque ya trae salto de página: el H1 lo
  // trae por pageBreakBefore, así que el índice queda solo en su página.
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

function updateToc(paths: string[]): void {
  if (process.platform !== "win32" || process.env.DOCS_SKIP_TOC === "1") {
    console.warn("aviso: el índice no se actualizó (hace falta Word en Windows). Abrí el Word y apretá F9 sobre el índice.");
    return;
  }
  try {
    const out = execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", PS1, ...paths], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    process.stdout.write(out);
  } catch (err) {
    console.warn(`aviso: falló la actualización del índice con Word: ${(err as Error).message.split("\n")[0]}. Abrí el Word y apretá F9.`);
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
```

Nota para el implementador: `blockquote` clona el párrafo leyendo `options`, que en `docx` es una propiedad privada; si `tsc` se queja, reemplazar por reconstruir el párrafo desde los tokens (llamar a `blocks` con un flag `quote` que agregue `indent` y `border` al crear cada `Paragraph`). Cualquier ajuste que haga falta para que `tsc` y `lint` pasen es parte de esta tarea.

- [ ] **Step 5: Documento de prueba con TODAS las construcciones**

Crear `.superpowers/sdd/manuales/prueba-pipeline.md`:

```markdown
---
title: Prueba del pipeline
subtitle: Todas las construcciones admitidas
series: Documento de prueba
docx: _prueba-pipeline
version: 0.0
date: 11/09/2026
---

# Capítulo uno

Párrafo con **negrita**, *cursiva*, `código inline` y un [enlace](https://vecinalciudadela.ar).

## Sección con lista

- Primer ítem
- Segundo ítem con `código`
  - Sub-ítem
- Tercero

1. Paso uno
2. Paso dos
   a. no, esto es texto plano del paso dos

### Tabla

| Columna | Descripción | Archivo |
|---|---|---|
| `a` | Una descripción bastante más larga que las otras dos columnas | `src/x.ts` |
| `b` | Corta | `src/y.ts` |

> Una cita con barra a la izquierda.

```bash
npm run docs:build
```

![El logo como imagen de prueba](../../../docs/manuales/img/logo.png)

---

# Capítulo dos

#### Título de cuarto nivel

Texto final.
```

Run: `npm run docs:build .superpowers/sdd/manuales/prueba-pipeline.md`
Expected: `ok  … → docs/manuales/word/_prueba-pipeline.docx` y una línea `_prueba-pipeline.docx: N páginas` (N ≥ 4: portada, índice, dos capítulos).

Run (PDF para mirar): `"/c/Program Files/LibreOffice/program/soffice.exe" --headless --convert-to pdf --outdir .superpowers/sdd/manuales docs/manuales/word/_prueba-pipeline.docx` y leer el PDF con la herramienta Read (páginas 1-4). Verificar: portada con logo y título celeste; índice con dos entradas y números de página; título 1 celeste con línea; tabla con encabezado celeste claro; bloque de código sombreado; imagen con "Figura 1 — …"; pie "SIGeV — v0.0 — 11/09/2026 — Página 1 de N"; encabezado con el título. Si algo no se ve, corregir el script y repetir.

Run (validador del skill docx): `python "C:/Users/Mariano/AppData/Roaming/Claude/local-agent-mode-sessions/skills-plugin/f6f89920-89cc-4ccc-af0f-e3bb5d211920/b4d5c34d-8308-4ea2-8cfe-3e12c9d89bd5/skills/docx/scripts/office/validate.py" docs/manuales/word/_prueba-pipeline.docx` → sin errores.

Run (sintaxis prohibida corta el build): agregar `<div>x</div>` al final del doc de prueba, correr el build y verificar `error: ….md:NN HTML no admitido`; quitarlo.

- [ ] **Step 6: Calidad de código**

Run: `npx tsc --noEmit` → sin errores. Run: `npm run lint` → sin errores ni warnings nuevos en `scripts/docs/`.

- [ ] **Step 7: README esqueleto**

Crear `docs/manuales/README.md`:

```markdown
# Manuales y documentación técnica de SIGeV

Fuente en Markdown, salida en Word. **Se edita el Markdown y se regenera el Word;
nunca al revés.**

| Carpeta | Qué hay |
|---|---|
| `tecnica/` | Serie técnica T1-T7 (para el desarrollador que hereda el proyecto) |
| `usuario/` | Manuales M1 (operador), M2 (socio), M3 (vecino) |
| `img/` | Logo y capturas (`m1/`, `m2/`, `m3/`) |
| `word/` | Los `.docx` generados (se commitean) |

## Regenerar los Word

    npm run docs:build                          # todos
    npm run docs:build docs/manuales/usuario/M2-manual-del-socio.md

En Windows con Word instalado el build actualiza el índice solo. Sin Word queda
el campo sin calcular: abrir el `.docx`, clic en el índice y F9.

## Markdown admitido

Títulos `#` a `####`, párrafos, **negrita**, *cursiva*, `código`, enlaces, listas
`-` y `1.` de dos niveles, tablas GFM, bloques de código con lenguaje, citas `>`,
imágenes `![leyenda](../img/m1/01-x.png)` solas en su párrafo (PNG), `---`, y el
front matter `title / subtitle / series / docx / version / date`. Otra sintaxis
corta el build con archivo y línea.

## Capturas

(Se completa en la Tarea 13.)
```

- [ ] **Step 8: Commit**

```bash
git rm --cached -q docs/manuales/word/_prueba-pipeline.docx 2>/dev/null; rm -f docs/manuales/word/_prueba-pipeline.docx
git add package.json package-lock.json scripts/docs/build-docx.ts scripts/docs/update-toc.ps1 docs/manuales/README.md docs/manuales/img/logo.png docs/manuales/word/.gitkeep
git commit -m "docs(manuales): Markdown to Word pipeline (docx + marked), cover, TOC via Word COM"
```

---

### Task 1: Contraseñas de prueba y harness de capturas

**Files:**
- Create: `scripts/docs/reset-test-passwords.ts`, `scripts/docs/capture-plan.ts`, `scripts/docs/capture.ts`

**Interfaces:**
- Produces: `npm run docs:capture [m1|m2|m3] [--only NN]`; tipo `Capture` y constante `CAPTURES` en `capture-plan.ts`; usuarios `admin.prueba@sigev.local` (admin), `socio.prueba@sigev.local` (socio), `verificacion.m2@sigev.local` (superadmin, activado) con la contraseña `SEED_TEST_PASSWORD` del `.env`.

- [ ] **Step 1: Reset de contraseñas (solo localhost)**

Crear `scripts/docs/reset-test-passwords.ts`:

```ts
// Reaplica SEED_TEST_PASSWORD a los tres usuarios de prueba que usan las
// capturas de docs/manuales y activa verificacion.m2 (superadmin de prueba).
// Solo corre contra una base en localhost. Uso: npx tsx scripts/docs/reset-test-passwords.ts
import "dotenv/config";
import bcrypt from "bcryptjs";
import { BCRYPT_COST } from "../../src/lib/auth/password";
import { prisma } from "../../src/lib/prisma";

const TEST_USERS = ["admin.prueba@sigev.local", "socio.prueba@sigev.local", "verificacion.m2@sigev.local"];

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) {
    throw new Error("Este script solo corre contra una base en localhost (DATABASE_URL).");
  }
  const password = process.env.SEED_TEST_PASSWORD;
  if (!password) throw new Error("Falta SEED_TEST_PASSWORD en el .env local.");
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  for (const email of TEST_USERS) {
    const r = await prisma.user.updateMany({ where: { email }, data: { passwordHash, passwordChangedAt: new Date(), active: true } });
    console.log(`${email}: ${r.count ? "contraseña reaplicada" : "NO EXISTE"}`);
  }
}

main().then(() => prisma.$disconnect()).catch((err) => { console.error(err); process.exit(1); });
```

Run: `npx tsx scripts/docs/reset-test-passwords.ts` → tres líneas "contraseña reaplicada". Si `BCRYPT_COST` no se exporta desde `src/lib/auth/password.ts`, usar el nombre que ese archivo exporte (verificar con `grep -n export src/lib/auth/password.ts`).

- [ ] **Step 2: El plan de capturas (esqueleto con las cuatro de login)**

Crear `scripts/docs/capture-plan.ts`:

```ts
// Lista de capturas de los manuales. Cada entrada produce
// docs/manuales/img/<manual>/<file>.png. `prepare` corre con la página ya
// cargada y la sesión del rol iniciada, para abrir pestañas, llenar pasos, etc.
import type { Page } from "playwright-core";

export type Role = "public" | "admin" | "member" | "superadmin";
export type Manual = "m1" | "m2" | "m3";
export type Capture = {
  manual: Manual;
  file: string;          // NN-slug, sin extensión
  role: Role;
  url: string;           // relativa a DOCS_CAPTURE_BASE_URL
  fullPage?: boolean;    // default: solo el viewport
  prepare?: (page: Page) => Promise<void>;
};

export const CAPTURES: Capture[] = [
  { manual: "m1", file: "01-ingresar", role: "public", url: "/ingresar" },
  { manual: "m1", file: "02-inicio-tablero", role: "admin", url: "/admin", fullPage: true },
  { manual: "m2", file: "01-mi-inicio", role: "member", url: "/mi", fullPage: true },
  { manual: "m3", file: "01-portada", role: "public", url: "/", fullPage: true },
];
```

- [ ] **Step 3: El script de captura**

Crear `scripts/docs/capture.ts`:

```ts
// Capturas de pantalla para docs/manuales con playwright-core sobre el Chrome
// instalado. Uso:
//   npm run docs:capture             (todas)
//   npm run docs:capture m1          (solo un manual)
//   npm run docs:capture m1 -- --only 07   (solo la que empieza por 07)
// Requiere el dev server en DOCS_CAPTURE_BASE_URL (default http://localhost:3000)
// y SEED_TEST_PASSWORD en el .env (la contraseña de los usuarios de prueba).
import "dotenv/config";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { CAPTURES, type Capture, type Role } from "./capture-plan";

const BASE = process.env.DOCS_CAPTURE_BASE_URL ?? "http://localhost:3000";
const OUT = join(process.cwd(), "docs", "manuales", "img");
const ACCOUNTS: Record<Exclude<Role, "public">, string> = {
  admin: "admin.prueba@sigev.local",
  member: "socio.prueba@sigev.local",
  superadmin: "verificacion.m2@sigev.local",
};

async function login(page: Page, role: Exclude<Role, "public">): Promise<void> {
  const password = process.env.SEED_TEST_PASSWORD;
  if (!password) throw new Error("Falta SEED_TEST_PASSWORD en el .env");
  await page.goto(`${BASE}/ingresar`, { waitUntil: "networkidle" });
  await page.fill("#email", ACCOUNTS[role]);
  await page.fill("#password", password);
  // Turnstile con claves dummy: el widget resuelve solo y llena el hidden input.
  await page.waitForFunction(() => {
    const el = document.querySelector<HTMLInputElement>('input[name="cf-turnstile-response"]');
    return Boolean(el && el.value);
  }, undefined, { timeout: 30_000 });
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/(admin|mi)(\/|$)/, { timeout: 60_000 });
}

async function contextFor(browser: Browser, role: Role): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, locale: "es-AR", colorScheme: "light" });
  ctx.setDefaultNavigationTimeout(120_000); // el dev server compila la primera vez
  if (role !== "public") { const page = await ctx.newPage(); await login(page, role); await page.close(); }
  return ctx;
}

async function capture(ctx: BrowserContext, c: Capture): Promise<void> {
  const page = await ctx.newPage();
  try {
    await page.goto(`${BASE}${c.url}`, { waitUntil: "networkidle" });
    if (c.prepare) await c.prepare(page);
    await page.waitForTimeout(400); // transiciones
    const dir = join(OUT, c.manual);
    mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: join(dir, `${c.file}.png`), fullPage: c.fullPage ?? false });
    console.log(`ok  ${c.manual}/${c.file}.png`);
  } finally {
    await page.close();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const manual = args.find((a) => /^m[123]$/.test(a));
  const onlyIdx = args.indexOf("--only");
  const only = onlyIdx >= 0 ? args[onlyIdx + 1] : undefined;
  const selected = CAPTURES.filter((c) => (!manual || c.manual === manual) && (!only || c.file.startsWith(only)));
  if (!selected.length) { console.error("ninguna captura coincide"); process.exit(1); }

  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const roles = [...new Set(selected.map((c) => c.role))];
    for (const role of roles) {
      const ctx = await contextFor(browser, role);
      try { for (const c of selected.filter((x) => x.role === role)) await capture(ctx, c); }
      finally { await ctx.close(); }
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 4: Probar contra el dev server**

Levantar el dev server con la herramienta de preview (`preview_start` con `name: "sigev-dev"`), NO con Bash. Run: `npm run docs:capture` → cuatro líneas `ok`. Abrir los cuatro PNG con Read y verificar: `m1/01-ingresar.png` muestra el formulario; `m1/02-inicio-tablero.png` muestra el tablero del panel (login funcionó); `m2/01-mi-inicio.png` muestra el panel del socio; `m3/01-portada.png` la home.

Run: `npx tsc --noEmit && npm run lint` → limpios.

- [ ] **Step 5: Commit**

```bash
git add scripts/docs/reset-test-passwords.ts scripts/docs/capture-plan.ts scripts/docs/capture.ts docs/manuales/img/m1/01-ingresar.png docs/manuales/img/m1/02-inicio-tablero.png docs/manuales/img/m2/01-mi-inicio.png docs/manuales/img/m3/01-portada.png
git commit -m "docs(manuales): screenshot harness (playwright-core on installed Chrome) and local test-password reset"
```

---

### Task 2: Siembra de estados y captura completa

**Files:**
- Modify: `scripts/docs/capture-plan.ts` (lista completa)
- Create: `docs/manuales/img/m1/*.png`, `docs/manuales/img/m2/*.png`, `docs/manuales/img/m3/*.png`
- Create: `.superpowers/sdd/manuales/siembra.md` (qué se sembró, con ids)

**Interfaces:**
- Consumes: `CAPTURES`/`Capture` de la Tarea 1; usuarios de prueba de la Tarea 1.
- Produces: los PNG con los nombres EXACTOS de la tabla de abajo (las tareas 10-12 los referencian por nombre).

- [ ] **Step 1: Sembrar los estados desde el panel (con las herramientas de navegador, como operador)**

Con el dev server levantado y entrando como `admin.prueba` (y `verificacion.m2` para lo de superadmin), crear en la base local, anotando cada id en `siembra.md`:

1. **Noticias**: una noticia publicada con portada (una imagen PNG cualquiera de `assets/`) y una en borrador. **Actividades**: una actividad con días y horario.
2. **Actas**: un acta de Comisión Directiva nueva (fecha de hoy) para usarla en las acciones siguientes.
3. **Solicitudes de alta**: desde `/asociate` (público, sin sesión) completar un alta con datos inventados (nombre "Vecina de Prueba", DNI inventado que no exista en el padrón: verificar con `docker exec sigev-db mariadb -usigev -p… sigev -e "SELECT COUNT(*) FROM members WHERE dni='…'"`), residencia en el barrio, categoría activo, dos imágenes PNG como DNI. Dejarla en cola. Si ya hay altas de prueba en cola (hay 18 `applications` en local), usar una existente que no tenga datos reales.
4. **Reportes**: un reporte de tipo reclamo desde `/reportes` con foto (PNG) y ubicación, enviado; queda en la bandeja.
5. **Socio de prueba** (`socio.prueba`, ver su `member_id`): asegurarse de que tiene cuotas pendientes (si no, `npx tsx scripts/import-deuda.ts` no sirve para él: registrar desde Tesorería → Efectivo un pago de 1 cuota para que tenga un recibo, y dejar deuda). Sin débito vigente.
6. **Exención**: otorgar una exención vigente a OTRO socio de prueba (no al `socio.prueba`, que necesita poder pagar): usar la ficha del socio de la solicitud aprobada del punto 3 si se aprueba, o crear uno con "alta manual" con nombre inventado.
7. **Bandeja**: `npx tsx scripts/dev/seed-unmatched.ts 18000 haraoz@yahoo.com` (ver su encabezado) para tener un cobro sin conciliar con qué mostrar el reparto.
8. **Re-empadronamiento**: como superadmin, convocar el proceso con el acta del punto 2; desde `/reempadronate` (público) hacer una presentación para un adherente **inventado** (crear antes por alta manual un adherente con nombre inventado y DNI inexistente; la cohorte se congela al convocar, así que crearlo ANTES de convocar); fijar un lote de cartelera desde `/admin/reempadronamiento/avisos`.
9. **Usuario**: desde `/admin/usuarios` no crear nada; solo capturar la lista.

Cada pantalla que se use para sembrar es además una verificación de los pasos del manual: anotar en `siembra.md` cualquier mensaje o comportamiento que sorprenda (sirve para M1).

- [ ] **Step 2: Completar `capture-plan.ts` con esta lista**

Reemplazar `CAPTURES` por la lista completa. Cada fila es una entrada; `prepare` solo donde hace falta (se indica). Nombres EXACTOS:

| manual | file | role | url | fullPage | prepare |
|---|---|---|---|---|---|
| m1 | 01-ingresar | public | /ingresar | no | — |
| m1 | 02-inicio-tablero | admin | /admin | sí | — |
| m1 | 03-solicitudes-altas | admin | /admin/solicitudes | sí | — |
| m1 | 04-solicitud-alta-ficha | admin | /admin/solicitudes/{id del alta en cola} | sí | — |
| m1 | 05-solicitudes-resumen-acta | admin | /admin/solicitudes/resumen | sí | — |
| m1 | 06-solicitudes-de-socios | admin | /admin/solicitudes/socios | sí | — |
| m1 | 07-reportes-bandeja | admin | /admin/solicitudes/reportes | sí | — |
| m1 | 08-reporte-ficha | admin | /admin/solicitudes/reportes/{id} | sí | — |
| m1 | 09-reempadronamiento-tablero | admin | /admin/reempadronamiento | sí | — |
| m1 | 10-reempadronamiento-presentaciones | admin | /admin/reempadronamiento/presentaciones | sí | — |
| m1 | 11-reempadronamiento-avisos | admin | /admin/reempadronamiento/avisos | sí | — |
| m1 | 12-socios-padron | admin | /admin/socios | sí | — |
| m1 | 13-socio-ficha | admin | /admin/socios/{id socio.prueba} | sí | — |
| m1 | 14-socio-ficha-cuenta | admin | /admin/socios/{id socio.prueba}?tab=cuenta | sí | si la pestaña no es por URL: `prepare` hace clic en la pestaña "Cuenta corriente" (o el rótulo real) |
| m1 | 15-socio-link-de-pago | admin | /admin/socios/{id socio.prueba}/link | sí | — |
| m1 | 16-socios-libros | admin | /admin/socios/libros (ruta real de la pestaña Libros) | sí | — |
| m1 | 17-tesoreria-deudores | admin | /admin/tesoreria/deudores | sí | — |
| m1 | 18-tesoreria-efectivo | admin | /admin/tesoreria/efectivo | sí | — |
| m1 | 19-tesoreria-recibos | admin | /admin/tesoreria/recibos | sí | — |
| m1 | 20-tesoreria-sin-conciliar | admin | /admin/tesoreria/sin-conciliar | sí | — |
| m1 | 21-tesoreria-reparto | admin | /admin/tesoreria/sin-conciliar/{id de la fila sembrada} (ruta real del reparto) | sí | — |
| m1 | 22-tesoreria-suscripciones | admin | /admin/tesoreria/suscripciones | sí | — |
| m1 | 23-tesoreria-otros-ingresos | admin | /admin/tesoreria/otros-ingresos | sí | — |
| m1 | 24-tesoreria-exenciones | admin | /admin/tesoreria/exenciones | sí | — |
| m1 | 25-actas | admin | /admin/actas | sí | — |
| m1 | 26-noticias | admin | /admin/noticias | sí | — |
| m1 | 27-noticia-editor | admin | /admin/noticias/{id}/editar (ruta real) | sí | — |
| m1 | 28-actividades | admin | /admin/actividades | sí | — |
| m1 | 29-documentos | admin | /admin/documentos | sí | — |
| m1 | 30-usuarios | superadmin | /admin/usuarios | sí | — |
| m1 | 31-configuracion | superadmin | /admin/configuracion | sí | — |
| m1 | 32-tesoreria-valores | superadmin | /admin/tesoreria/valores | sí | — |
| m1 | 33-salud | superadmin | /admin/salud | sí | — |
| m1 | 34-padron-electoral | superadmin | /admin/padron-electoral | sí | — |
| m1 | 35-reempadronamiento-cierre | superadmin | /admin/reempadronamiento/cierre | sí | — |
| m2 | 01-mi-inicio | member | /mi | sí | — |
| m2 | 02-mi-cuenta | member | /mi/cuenta | sí | — |
| m2 | 03-mi-cuenta-pagar | member | /mi/cuenta | no | `prepare`: clic en el botón "Pagar" (rótulo real) para mostrar el selector de cuotas / confirmación, SIN confirmar el pago |
| m2 | 04-mi-debito | member | /mi/debito | sí | — |
| m2 | 05-mi-datos | member | /mi/datos | sí | — |
| m2 | 06-mi-solicitudes | member | /mi/solicitudes | sí | — |
| m2 | 07-mi-solicitudes-reportes | member | /mi/solicitudes/reportes | sí | — |
| m2 | 08-mi-documentos | member | /mi/documentos | sí | — |
| m2 | 09-recuperar-contrasena | public | /ingresar/recuperar | no | — |
| m3 | 01-portada | public | / | sí | — |
| m3 | 02-noticias | public | /noticias | sí | — |
| m3 | 03-actividades | public | /actividades | sí | — |
| m3 | 04-ubicacion | public | /ubicacion | sí | — |
| m3 | 05-asociate-paso-1-dni | public | /asociate | sí | — |
| m3 | 06-asociate-paso-2-datos | public | /asociate | sí | `prepare`: tipear un DNI inventado inexistente, resolver el paso 1 y esperar el paso 2 |
| m3 | 07-asociate-paso-3-residencia | public | /asociate | sí | `prepare`: como 06 y completar el paso 2 con datos inventados |
| m3 | 08-asociate-paso-4-categoria | public | /asociate | sí | `prepare`: como 07 y elegir "En el barrio" |
| m3 | 09-asociate-paso-5-documentos | public | /asociate | sí | `prepare`: como 08 y elegir categoría |
| m3 | 10-asociate-paso-6-pago | public | /asociate | sí | `prepare`: como 09 y subir dos PNG (`page.setInputFiles`) |
| m3 | 11-reempadronate-paso-1 | public | /reempadronate | sí | — |
| m3 | 12-reportes-paso-1 | public | /reportes | sí | — |
| m3 | 13-reportes-paso-2 | public | /reportes | sí | `prepare`: elegir "Reclamo" y avanzar |
| m3 | 14-ingresar | public | /ingresar | no | — |

Para las `prepare` de ASOCIATE: leer `src/app/(public)/asociate/` para los `name` de los campos y los rótulos de los botones; escribir una función auxiliar `asociateHasta(page, paso)` en `capture-plan.ts` que encadene los pasos y la reutilicen las entradas 06-10. El DNI inventado NO puede existir en `members` ni en `applications` (si existe, el paso 1 lo bloquea y la captura sale mal). Al terminar, la solicitud creada por la captura 10 queda en cola: anotar su id en `siembra.md`. Las rutas marcadas "ruta real" se verifican con `ls src/app/admin/...` antes de escribir la entrada.

- [ ] **Step 3: Capturar y revisar una por una**

Run: `npm run docs:capture` → una línea `ok` por entrada. Abrir CADA PNG con Read y verificar: (a) es la pantalla que dice el nombre; (b) no hay DNI, domicilio ni nombre de un socio real del padrón (el padrón de prueba está importado: en las listas de `/admin/socios`, `/admin/tesoreria/deudores` y `/admin/padron-electoral` **sí aparecen apellidos reales** — para esas tres capturas usar un filtro/búsqueda que muestre solo a los socios de prueba, o capturar con `fullPage: false` recortando a la barra de filtros y las primeras filas de prueba; si no es posible, reemplazar la lista por una captura con el estado vacío de la búsqueda "sin resultados" y anotarlo); (c) no aparece ningún mensaje de error rojo por un estado que faltó sembrar; (d) tema claro. Re-capturar lo que falle con `--only NN`.

- [ ] **Step 4: Calidad y commit**

Run: `npx tsc --noEmit && npm run lint` → limpios.

```bash
git add scripts/docs/capture-plan.ts docs/manuales/img
git commit -m "docs(manuales): seeded local states and the full screenshot set for the three manuals"
```

---

### Tareas 3 a 12: los documentos (patrón común)

Cada una de estas tareas la ejecuta un subagente escritor (Opus) y la revisa un subagente revisor (Fable). Los pasos son los mismos; lo que cambia es el brief (archivo, índice, fuentes, tope de páginas). **El escritor no toca ningún otro archivo que el suyo y su `.docx`.**

Pasos comunes (se repiten en cada tarea; se listan acá una vez y cada tarea los marca):

1. Leer, en este orden: `docs/superpowers/specs/2026-09-11-documentacion-manuales-design.md` §3 (convenciones) y su índice; los informes de relevamiento que indica el brief; los `docs/` que indica; y abrir el código cuando el informe no alcance.
2. Escribir el Markdown en la ruta indicada, con este front matter (ajustar `title`, `subtitle`, `series`, `docx`):
   ```
   ---
   title: <Título>
   subtitle: <Subtítulo>
   series: Serie técnica — Documento N de 7   (o "Manual de usuario")
   docx: SIGeV-<prefijo>-<Titulo-con-guiones>
   version: 1.0
   date: 11/09/2026
   ---
   ```
   Seguir el índice del brief como capítulos `#` y `##`. Empezar con "Para quién es y qué da por sabido" y "Cómo leer este documento". Cerrar con "Documentos relacionados".
3. Run: `npm run docs:build <ruta.md>` → `ok` y `N páginas`. Si falla por sintaxis, corregir el Markdown (no el script). Si `N` supera el tope, recortar (el informe de relevamiento es material, no texto a volcar).
4. Run: `"/c/Program Files/LibreOffice/program/soffice.exe" --headless --convert-to pdf --outdir .superpowers/sdd/manuales docs/manuales/word/<docx>.docx` y leer con Read la portada, el índice y dos páginas interiores (una con tabla, una con imagen si aplica). Corregir lo que se vea mal.
5. Escribir `.superpowers/sdd/manuales/<prefijo>-report.md`: páginas, qué fuentes se usaron, qué se dejó afuera y por qué, y toda afirmación de la que el escritor NO esté seguro (lista para el revisor).
6. Commit: `git add docs/manuales/<carpeta>/<archivo>.md docs/manuales/word/<docx>.docx && git commit -m "docs(manuales): <prefijo> <título en inglés>"`.

Revisor (Fable), por cada documento: toma 15 afirmaciones concretas al azar (números, nombres de pantallas, mensajes literales, rutas de archivo, horarios de cron, cupos) y las coteja contra el código; verifica el tope de páginas, que el Word abra (PDF), que cada `![…]` apunte a una captura existente y que la captura muestre lo que el texto dice, que no haya datos reales en las capturas referenciadas, y las reglas de copy (vos en manuales, reclamo/iniciativa, un identificador por frase). Devuelve la lista de correcciones; el escritor corrige y recompila.

---

### Task 3: T1 — Visión y panorama

**Files:** Create `docs/manuales/tecnica/T1-vision-y-panorama.md`; salida `docs/manuales/word/SIGeV-T1-Vision-y-panorama.docx`. Tope: 20 páginas.

**Fuentes:** `CLAUDE.md` (secciones "SIGeV", "Prioridad actual", "Flujo de trabajo"), `docs/01-vision-y-alcance.md`, `docs/07-plan-de-etapas.md` (solo los títulos y las fechas de cierre), los mapas de rutas de `scan-01` §1, `scan-02` §1 y `scan-03` §1, `scan-05` §1.3 y §11-12 (para el estado y lo no desplegado), `git log --oneline -40`.

**Índice:**
1. Qué es SIGeV y para quién: la asociación, el estatuto reformado y la IGJ; los cuatro procesos que digitaliza (asociarse, re-empadronarse, pagar/registrar cuotas, reportes); qué NO es (sin contabilidad general, sin facturación ARCA, sin altas sin acta).
2. Los tres públicos y los tres roles: `superadmin`, `admin`, `socio`, acumulables; tabla de quién ve qué zona; que la nav es display y la autorización va en cada action (una frase, remite a T7).
3. Mapa del sitio: tres tablas (público, `/mi`, `/admin`) con URL y una línea por pantalla.
4. Los módulos en el orden en que se construyeron: 0 base, 1 padrón, 2 sitio público, 3 ASOCIATE+MP, shell del panel, 4A/4B/4C/4D tesorería, 5A/5B panel de socio, 6A/6B/6C re-empadronamiento, exención, paso DNI, Módulo 7 reportes, llave colaborador, pagos ajenos; una frase y fecha de cierre cada uno.
5. Estado al 11/09/2026: tabla de qué está desplegado en `vecinalciudadela.ar`, qué está mergeado en `main` sin desplegar (migración `payment_split`, N° público de reportes, llave colaborador, pestañas de sección, nav móvil, etc. — verificar contra `git log` y CLAUDE.md "Prioridad actual"), qué queda pendiente (`fix-withdrawal-reasons.ts` en el VPS, borrar `EMAIL_ALLOWLIST` al lanzar, oficialización IGJ). Marcar explícitamente que los ids de pruebas locales no aplican.
6. Cómo se desarrolló: Claude Code con `CLAUDE.md` como contrato, specs y planes en `docs/superpowers/`, reports en `.superpowers/sdd/` (gitignored), qué es un "test de fuente", el flujo de deploy git-based.
7. Guía de lectura de la serie (tabla tarea → documento) y glosario de 25-30 términos (acta, activo/adherente/colaborador, devengo, cuota de ingreso, piso de cobertura, valor vigente, recibo, imputación, débito automático/preapproval, link de pago, bandeja, reparto, conciliación, cartelera, libro, cohorte, presentación, cesantía, exención, reporte/reclamo/iniciativa, token de un solo uso, allowlist, cron, salud).

- [ ] Pasos comunes 1-6 (ver "patrón común"). Commit: `docs(manuales): T1 vision and overview`.

---

### Task 4: T2 — Arquitectura y código

**Files:** Create `docs/manuales/tecnica/T2-arquitectura-y-codigo.md`; salida `SIGeV-T2-Arquitectura-y-codigo.docx`. Tope: 30 páginas.

**Fuentes:** `scan-05` §1, §2, §3.3, §5 (entero), §8.4; `scan-02` §0; `scan-03` §1.3 y §2.2; `CLAUDE.md` ("Stack", "Convenciones", "Panel de administración: shell y patrones", todos los bloques "Patrones que estrenó…"); `docs/03-arquitectura-e-infraestructura.md` §1-2; `src/lib/admin/nav.ts`, `src/lib/mi/nav.ts`, `src/lib/ui/section-tabs.ts`, `src/components/admin/`, `src/app/globals.css`.

**Índice:**
1. Stack con versiones reales de `package.json` (tabla dependencia | versión | para qué), notas de Next 16 (`proxy.ts`, `params` como Promise, `unstable_cache`), Prisma 7 con adapter MariaDB (sin engine).
2. Un solo proyecto, tres zonas más la API: qué vive en `(public)`, `/mi`, `/admin`, `/api/{admin,mi,cron,webhooks,imagenes,auth}`; las tres capas de autorización (proxy → layout → cada action) y por qué la nav filtra por el token pero la autorización lee la fila viva.
3. Estructura de carpetas comentada: árbol de `src/` a tres niveles, una línea por carpeta (tomar de `scan-05` §2 y verificar con `ls`).
4. Capas y responsabilidades: pantalla RSC → server action (`forms.ts`, `useActionState`) → módulo de dominio `src/lib/*` → Prisma; qué NO va en una transacción (red, PDF), qué va después del commit; `keyed-mutex`; `cache-tags`.
5. Patrones transversales, cada uno con "qué problema resuelve / dónde está / cómo se reconoce": gateway propio (`makeMpGateway`); reglas puras testeadas aparte (`eligibility.ts`, `rules.ts`, `resolve.ts`); Prisma inyectado en módulos puros; una función compartida en vez de copias (`coverageFloor`, `activeExemption`, `validateSubmission`, `loadEligibilityInputs`, `groupTotals`); premisa de un solo proceso; auditoría best-effort vs estricta; transiciones por `updateMany` condicional; numeración sin huecos con `receipt_sequences`; guardas globales en el transporte (`EMAIL_ALLOWLIST`); `unique-violation.ts` y el `meta.target` que no existe con el adapter.
6. El shell del panel: `PageHeader`, `FormMessage`, `EmptyState`, `status-badges`, `dashboard-cards`, pestañas por URL vs Radix (`section-tabs`, por qué existe la variante `section`), `synced-fields`, accesibilidad verificada; el shell de `/mi` (`mi-tabs`, tira grande bajo `md`); las primitivas de `asociate/wizard-ui.tsx` y quién las comparte.
7. Formularios: el patrón central paso a paso (form → action → `FormMessage`), Turnstile dónde sí y dónde no, los `<select>` crudos y la deuda anotada.
8. Tema y color: tokens de `globals.css`, `--primary` `#0079BC` vs celeste de marca, la regla de contraste (por qué no se atenúa texto), modo oscuro, tests de fuente que lo fijan.
9. Checklist del desarrollador nuevo: 12-15 ítems (clonar, `.env`, Docker, `migrate dev`, seed, importar padrón, dev server, correr suites, abrir `/admin` con `admin.prueba`, dónde agregar una sección del panel, cómo agregar una action, qué leer antes de tocar tesorería).

- [ ] Pasos comunes 1-6. Commit: `docs(manuales): T2 architecture and code`.

---

### Task 5: T3 — Instalación, despliegue y operación

**Files:** Create `docs/manuales/tecnica/T3-instalacion-despliegue-operacion.md`; salida `SIGeV-T3-Instalacion-despliegue-operacion.docx`. Tope: 30 páginas.

**Fuentes:** `scan-05` §1.3, §4, §6, §9; `scan-04` §5 (crons); `docs/03`, `docs/09`, `docs/10` (§4.x verificaciones post-deploy; ojo: lo que dicen de staging es historia), `docs/11` Partes H y J (resumen, no copia); `.env.example`; `deploy.sh`; `scripts/*.ts`; `scripts/backup.sh`; `docker-compose.yml`; `docker/`; `src/app/api/cron/*/route.ts`; `src/app/admin/salud/`.

**Índice:**
1. Entorno local: requisitos (Node 24, npm 11, Docker Desktop), clonar, `.env` desde `.env.example` (valores de desarrollo: Turnstile dummy `1x0000…`, `EMAIL_ALLOWLIST`, `SEED_*`), `docker compose up -d`, `npm ci`, `npx prisma migrate dev`, seed (qué crea y la guarda `SEED_ALLOW_TEST_USERS`), `import-calles`, `import-padron` (con sus flags), `import-deuda` (`DEBT_SNAPSHOT_DATE`), `seed-holidays`, `import-estatuto`, `generate-assets`; `npm run dev`; `npm test`, `npm run test:integration` (qué necesita); cómo restaurar la base a la línea de base (los tres comandos).
2. `.env` completo: tabla variable | obligatoria | dev | prod | qué pasa si falta.
3. Tabla `Configuration`: llave | quién la edita | efecto | si falta.
4. Producción: VPS (`/root/dev/ciudadela`, SSH 2222, root), PM2 (`sigev`, puerto 3006, `instances: 1` y por qué), Nginx, Cloudflare (proxy, WAF con su falso positivo, caché de imágenes de noticias), Brevo (SMTP y dominio), Turnstile, Mercado Pago (credenciales productivas desde el 22/08/2026, dos solapas de webhooks), `AUTH_URL` horneada en el build.
5. Desplegar: `bash /root/dev/ciudadela/deploy.sh` qué hace paso a paso; con migración (backup antes, `migrate deploy`, verificación post-deploy de `docs/10` §4.9/§4.10/§4.11 como ejemplos); rollback (git + restaurar backup); reiniciar el dev server tras cambiar `next.config.ts`.
6. Crontab de seis líneas: tabla línea | ruta | horario AR | qué hace | cuándo saltea | qué escribe; `CRON_SECRET`; `?force=1` y `?upTo=`; `cron_runs`; el `curl` copiable (de `docs/11` H).
7. Backups: `backup.sh` (qué respalda: base, `uploads`, `recibos`), `BACKUP_DIR`, `LAST_OK`, retención, cómo restaurar (con la lección del rearmado que perdió actividades si está en `docs/10`).
8. `/admin/salud`: las cuatro pestañas, *act* vs *review* vs historia, las varas por cron (24 h / 31 d / 7 d), tabla "si ves X, hacé Y".
9. Logs y diagnóstico: `pm2 logs sigev`, qué se enmascara, el 403 de Cloudflare sin rastro (`docs/10` §4.8), el 429 `local_rate_limited` de MP, cómo leer `webhook_events`, `notifications` y `audit_log` con SQL de solo lectura.
10. Runbooks cortos (5-10 líneas cada uno): registrar un valor de cuota nuevo; correr el devengo o el recordatorio de un mes perdido; correr la conciliación a mano; reenviar una invitación; dar de alta un usuario de gestión; regenerar un PDF de recibo; lanzar (borrar `EMAIL_ALLOWLIST`, configurar `digest_recipients`, prender `colaborador_habilitado` cuando IGJ oficialice).

- [ ] Pasos comunes 1-6. Commit: `docs(manuales): T3 install, deploy and operations`.

---

### Task 6: T4 — Modelo de datos

**Files:** Create `docs/manuales/tecnica/T4-modelo-de-datos.md`; salida `SIGeV-T4-Modelo-de-datos.docx`. Tope: 25 páginas.

**Fuentes:** `prisma/schema.prisma` (la verdad), `scan-04` §1 entero, `scan-05` §7 (migraciones), `docs/04-modelo-de-datos.md` (para contrastar; lo que difiera va a HALLAZGOS, no acá), `prisma/migrations/*/migration.sql` (solo para la tabla del cap. 6), `datos/`.

**Índice:**
1. Cómo leer el esquema: modelo vs `@@map`, `@map` de columnas, UTC en la base y `civilDayOf`, estados por columnas (`revokedAt`, `voidedAt`) en vez de borrados, dinero como `Decimal`.
2. Diagrama de dominios: bloques (Usuarios/Auth, Padrón, Solicitudes, Tesorería, Mercado Pago, Re-empadronamiento, Reportes, Contenido, Sistema) con las flechas principales, como bloque de código ASCII.
3. Un capítulo `##` por dominio con una tabla modelo | tabla | campos clave | relaciones | para qué, y debajo dos o tres párrafos con lo no obvio (por ejemplo: `Membership` es la foto del libro; `Payment.mpPaymentId` es la barrera de idempotencia y no se borra al anular; `Receipt.concept` se congela; `Fee` no lleva monto; `MpSubscription.planId` está muerto; `FeeStatus.voided` no lo escribe nadie).
4. Enums: tabla enum | valores | significado | quién escribe cada valor.
5. Invariantes: las que sostiene la base (uniques y FKs, tabla) y las que viven en código por falta de unique parcial en MySQL (lista, con el módulo que las cuida).
6. Migraciones: tabla N° | fecha | nombre | qué agrega | muda datos (sí/no) | desplegada (según T1 §5).
7. Datos importados: qué trae cada archivo de `datos/`, qué script lo importa, qué queda a mano.

- [ ] Pasos comunes 1-6. Commit: `docs(manuales): T4 data model`.

---

### Task 7: T5 — Tesorería y Mercado Pago

**Files:** Create `docs/manuales/tecnica/T5-tesoreria-y-mercadopago.md`; salida `SIGeV-T5-Tesoreria-y-mercadopago.docx`. Tope: 30 páginas.

**Fuentes:** `scan-04` §2, §3, §4, §5, §6 (la base del documento); `CLAUDE.md` bloques de los Módulos 4 (4A-4D), 5 (débito), exención y pagos ajenos; `docs/06-integracion-mercadopago.md` (§2 gateway); `docs/02` para los REG-xx (14, 16, 33, 34); `src/lib/treasury/*`, `src/lib/mp/*`, `src/lib/email/templates.ts`, `src/app/api/webhooks/mp/route.ts`, `src/app/api/cron/*`.

**Índice:**
1. Vocabulario (tabla de 15 términos).
2. Ciclo de vida de una cuota: calendario, devengo (dos niveles, `upTo`), `coverageFloor` (los tres términos), deuda a valor vigente (REG-16), `allocate`, recibo (número tarde dentro de la transacción, REG-33; PDF después del commit, regenerable; concepto congelado), anulación y reembolso (`revertCore`), con un diagrama numerado del camino feliz.
3. `fee_values`: única fuente de montos; alta desde Configuración; mediodía UTC; REG-34.
4. Los seis caminos de cobro y el núcleo: tabla camino | quién lo dispara | entrada | núcleo | salida; explicación de `validateInput` / `preparePart` / `writePaymentAndFees` / `issueReceipt`; efectivo; link (`pago:{id}:{n}`, 72 h, sello HMAC, no se persiste); débito por webhook; vinculación de suscripción existente; bandeja con reparto (portador + partes, `FOR UPDATE`, estado derivado por `groupTotals`); pago desde `/mi`.
5. Ingresos no societarios.
6. Exención: registro con acta, cuotas `exempt` materializadas, `activeExemption` y `isInForce`, las cinco guardas, anulación.
7. Mercado Pago: gateway (tabla de 12 métodos con su trampa medida), planes como referencia, preapproval sin plan e `ignora notification_url`, webhook (firma `x-Signature`, `WebhookEvent` por `body.id`, `mpPaymentId`, 200 a IPN/merchant_order), procesador (nunca falla por regla de negocio; bandeja con motivo), `resolve.ts` (tabla de las nueve reglas), las tres semánticas de suscripción viva y por qué fallan hacia lados opuestos, conciliación (dos fuentes, `isOwnCollection` y `ownAccountId`, `paymentsForeign`, 207), lote REG-34.
8. Crons de plata y avisos: tabla; el recordatorio en detalle (calendario, texto por fecha, `MailBudget`).
9. Correos: la cañería y la tabla completa de plantillas (plantilla | asunto | disparador | destinatario | acredita `Notification`).
10. Cómo se prueba: sandbox (resumen de `docs/11` J: cuenta de prueba, túnel, dos solapas de webhooks), tests unitarios con gateway falso, integración con MariaDB (`mp-apply-concurrency`), y la regla "medir antes de suponer" con los cinco arreglos que salieron de medir.

- [ ] Pasos comunes 1-6. Commit: `docs(manuales): T5 treasury and Mercado Pago`.

---

### Task 8: T6 — Módulos de dominio

**Files:** Create `docs/manuales/tecnica/T6-modulos-de-dominio.md`; salida `SIGeV-T6-Modulos-de-dominio.docx`. Tope: 25 páginas.

**Fuentes:** `scan-01` §2.5-2.7 y §3; `scan-02` §2 (las secciones no tesorería) y §3; `scan-03` §2 y §4.4-4.5; `CLAUDE.md` bloques de Módulo 3, 5, 6, 7, paso DNI, admisión y exención; `docs/02` (REG-xx), `docs/05`; `src/lib/applications`, `src/lib/members`, `src/lib/reregistration`, `src/lib/board`, `src/lib/reports`, `src/lib/minutes`, `src/lib/news`, `src/lib/activities`, `src/lib/institutional-documents`, `src/lib/users`, `src/lib/padron`.

**Índice:**
1. Solicitudes de alta: máquina de estados (tabla estado | cómo se entra | cómo se sale), elegibilidad por DNI (las 8 causales, `checkEligibility`, `loadEligibilityInputs`), residencia y categoría, `colaborador_habilitado`, cuota de ingreso (REG-14) y la solicitud revivida por pago tardío, vencimientos y el cron de mantenimiento, acuse vs admisión (`ProcessRail`, `admissionPending`), aprobación con acta, rechazo, retome por token.
2. Socios, libros e histórico: `Member`/`Membership`/`Book`/`Movement`, categorías y estados, alta manual y modo carga, baja individual y en lote (`withdraw-with-debits`, `WITHDRAWAL_DEBIT_CALL_BUDGET`), cesantía por mora, recategorización, suspensión, invitación por correo, `maskedName`.
3. Solicitudes de socios: tipos, "una pendiente por tipo" bajo mutex, aplicación y rechazo, la regla anti-duplicación mensual del débito.
4. Re-empadronamiento: proceso y cohorte congelada (`isCohortMember`), wizard público y carga presencial, validación (qué se copia a `Member` y cuándo), días corridos vs hábiles en módulos separados y `hasExpired`, feriados que fallan ruidoso, cartelera por lotes (`dueAt`, correos que no acreditan), checklist de cierre, bajas en lote, `closeBook` (precondiciones como `where`, `updateMany` por 18 conjuntos, `planMigration` y `assertDensePlan`), el acta del cierre.
5. Reportes: borrador con llave (sha256), captcha solo en el paso 1, sharp y EXIF, `validateSubmission` compartida, `updateMany` condicionales sin mutex, N° público con `report_sequences`, PDF con su CSP, mapa, purga en el cron diario, copy por tipo.
6. Actas: tipos y numeración, `MinutePicker` (y su default riesgoso, con la lección), export PDF/Word, `discardUnusedMinute`, acta huérfana.
7. Contenido: noticias (editor, portada en `UPLOADS_DIR/news`, ruta pública con caché), actividades (días dinámicos), documentos institucionales y el estatuto importado, cartelera pública.
8. Usuarios y roles: `requireSuperadminUsers`, alta, invitación, degradación y su latencia de 8 h en el token, desactivación.
9. Padrón electoral: reglas de quién vota, el Excel, dónde está.

- [ ] Pasos comunes 1-6. Commit: `docs(manuales): T6 domain modules`.

---

### Task 9: T7 — Seguridad, privacidad y calidad

**Files:** Create `docs/manuales/tecnica/T7-seguridad-privacidad-calidad.md`; salida `SIGeV-T7-Seguridad-privacidad-calidad.docx`. Tope: 20 páginas.

**Fuentes:** `scan-05` §1.4, §3, §8, §10; `scan-01` §3 (cupos) ; `scan-02` §0.5 y §4 (auditoría); `scan-03` §2.2, §2.5; `docs/08-seguridad-y-privacidad.md`; `next.config.ts`; `src/proxy.ts`; `src/lib/auth/*`; `src/lib/tokens.ts`; `src/lib/turnstile.ts`; `src/lib/log-safe.ts`; `src/lib/audit.ts`; `tests/` (los 13 de fuente, listados en `scan-05` §8.4).

**Índice:**
1. Qué se protege: público / personal / dinero, en una tabla con ejemplos.
2. Sesión y credenciales: Credentials + bcrypt (costo), JWT 8 h, techo de 7 días, `passwordChangedAt`, frescura, roles vivos, `/redirigir`, qué pasa con un rol degradado.
3. Tokens de un solo uso: tabla tipo | TTL | quién lo emite | dónde se canjea | consumo atómico.
4. Turnstile: la regla (formularios anónimos sí, rutas con token no), `verifyTurnstile` falla cerrado, claves dummy en dev.
5. Rate limiters: tabla de los 21 (nombre | clave | cupo | ventana | dónde); todo en memoria; por qué `instances: 1`.
6. Cabeceras y CSP: la global, las 8 entradas por ruta, la lección de `setHeader`, el test que compara contra la constante, el caso de la cartelera (remite a HALLAZGOS).
7. Archivos: `UPLOADS_DIR`, `RECEIPTS_DIR`, `news/`; magic bytes (los 4 sniffers), `nosniff`, `no-store`, sharp solo en reportes y la deuda de los DNIs, retención 360 d / 48 h, `PURGE_BATCH`.
8. Ley 25.326 en el código: `log-safe`, `maskedName`, `Notification.error` con código, `EMAIL_ALLOWLIST` (guarda en el transporte; bloqueo no es fallo), 404 en vez de 403, qué no se loguea.
9. Auditoría: `audit` vs `auditStrict`, tabla resumida de asientos por sección (20-30 filas más importantes), auditoría por visualización de documentos, el asiento que lee la ficha del alta.
10. Webhook y crons: `x-Signature`, `WebhookEvent`, 200 a lo no atendido, `CRON_SECRET` timing-safe.
11. Calidad: `npm test` (conteo, dos configs), integración (qué necesita, cómo se corre), los 13 tests de fuente (tabla archivo | convención que fija), `tsc`, `lint`, `build`; qué no hay (CI) y la verificación manual de cierre de módulo.
12. Deuda conocida y decisiones abiertas: lista corta con puntero a `HALLAZGOS-2026-09-11.md`.

- [ ] Pasos comunes 1-6. Commit: `docs(manuales): T7 security, privacy and quality`.

---

### Task 10: M1 — Manual del operador

**Files:** Create `docs/manuales/usuario/M1-manual-del-operador.md`; salida `SIGeV-M1-Manual-del-operador.docx`. Tope: 40 páginas. Capturas: `../img/m1/01…35`.

**Fuentes:** `scan-02` entero (especialmente §2, §3 flujos y §5 correos), `.superpowers/sdd/manuales/siembra.md` (sorpresas vistas al sembrar), `docs/05` §3-6, textos literales de las pantallas (`src/app/admin/**`), `src/lib/email/templates.ts` para los asuntos.

**Índice (capítulos `#`):**
0. Antes de empezar: qué es el panel, quién entra (`admin`; `superadmin` ve más), navegador recomendado y celular (el cajón), qué NO se hace desde el panel (sin acta no hay alta/baja).
1. Entrar y salir (captura 01): el correo de invitación, crear la contraseña, recuperar la contraseña, la sesión vence a las 8 h y siempre a los 7 días.
2. Inicio (captura 02): las tarjetas y qué significa cada contador.
3. Solicitudes → Altas (03, 04, 05): la cola y sus estados, la ficha, ver los documentos (queda registrado), aprobar y asentar en acta con el resumen para acta, rechazar (motivo), reenviar el enlace, la solicitud vencida y la revivida por pago tardío; tabla de correos que recibe el vecino.
4. Solicitudes → De socios (06): recategorización y baja pedidas desde Mi cuenta; aplicar (con acta) y rechazar.
5. Solicitudes → Reportes (07, 08): la bandeja, la ficha con foto y mapa, "Presentar ante" vs "Desestimar", el PDF, qué le llega al vecino. Copy: reclamo vs iniciativa.
6. Reempadronamiento (09, 10, 11): qué es, el tablero, validar o rechazar una presentación (qué se copia a la ficha), carga presencial, la cartelera: armar el lote, fijar la fecha, imprimir, qué acredita y desde cuándo corren los 20 días hábiles. (Convocar y cerrar: capítulo 13.)
7. Socios (12, 13, 14, 15, 16): buscar y filtrar, exportar, la ficha y sus pestañas, cuenta corriente, acciones societarias (baja con acta, recategorización, suspensión), alta manual, modo carga, invitar por correo, generar y mandar un link de pago, Libros e Histórico.
8. Tesorería (17-24 y 32): Deudores (lista, gestión manual, cesantía por mora en lote y su tope), Efectivo (registrar, el recibo y su PDF, qué se manda por correo), Recibos (buscar, reimprimir, anular y qué pasa con la cuota), Sin conciliar (qué es, de dónde viene, aplicar a un socio, repartir entre varios, ingreso no societario, reembolso), Suscripciones (vincular una existente de MP), Otros ingresos, Exenciones (otorgar con acta y anular; qué ve el socio), Valores de cuota (remite al cap. 13).
9. Actas (25): cargar, tipos y numeración, exportar PDF/Word, elegir el acta correcta en cada acción (la advertencia del selector preseleccionado).
10. Noticias y Actividades (26, 27, 28): publicar, borrador, portada, editar, días de actividad.
11. Documentos (29): publicar para los socios.
12. Correos que manda el sistema: tabla qué | a quién | cuándo; el resumen diario a la Comisión; qué pasa cuando un correo no sale (y que en producción de prueba la allowlist bloquea).
13. Solo superadmin (30-35): Usuarios (alta, roles, invitación, desactivar; el rol tarda hasta 8 h en reflejarse en la nav), Configuración (cada pestaña con su efecto), Valores de cuota (registrar uno nuevo, nunca editar, tope estatutario), Salud (leer el veredicto; tabla rojo → qué hacer), Padrón electoral (armar y exportar), Reempadronamiento: convocar con acta, checklist de cierre, bajas en lote con acta, cerrar el libro (irreversible: qué revisar y con qué acta).
14. Preguntas frecuentes y problemas: 10-12 (no llega el correo; el socio pagó y no figura; un pago sin socio en la bandeja; anulé un recibo por error; error rojo en Salud; 403 al subir un archivo; el socio no puede adherirse al débito; una exención no bloquea el cobro; quiero cambiar el valor de la cuota; cerré el libro con el acta equivocada).

- [ ] Pasos comunes 1-6 (además: cada `![…]` debe apuntar a un PNG existente en `docs/manuales/img/m1/`; el build falla si no). Commit: `docs(manuales): M1 operator manual`.

---

### Task 11: M2 — Manual del socio

**Files:** Create `docs/manuales/usuario/M2-manual-del-socio.md`; salida `SIGeV-M2-Manual-del-socio.docx`. Tope: 20 páginas. Capturas: `../img/m2/01…09`.

**Fuentes:** `scan-03` entero (§3 pantallas, §4 flujos, §5 correos, §7 para los mensajes literales), `docs/05` §7, textos de `src/app/mi/**`, `src/app/(public)/ingresar/**`, `src/app/(public)/acceso/**`, `src/app/(public)/verificar/**`.

**Índice:**
1. Qué es Mi cuenta y quién puede entrar (socio con correo cargado).
2. Primera vez (09 para recuperar): el correo de invitación, el enlace y su vencimiento, crear la contraseña, verificar el correo, qué hacer si el enlace venció (pedir reenvío a la Comisión / recuperar), recuperar la contraseña, por qué te puede cerrar la sesión.
3. Inicio (01): qué muestra y qué significan los avisos (deuda, suspendido, débito).
4. Mi cuenta (02, 03): las cuotas y la deuda, pagar con Mercado Pago paso a paso (elegir cuántas, el link vence a las 72 h, qué pasa al volver, la pantalla de espera de 2 minutos, cuándo llega el recibo), descargar recibos, qué pasa si tenés una exención.
5. Débito automático (04): qué es, requisitos (categoría, correo, sin débito vigente, no haber pagado este mes: "Podés adherirte desde el 01/MM/AAAA"), adherirse paso a paso en Mercado Pago, qué ves al volver, cuándo se cobra, cancelar (qué efecto tiene y desde cuándo).
6. Mis datos (05): qué podés cambiar, qué no (nombre, DNI, categoría) y por qué, cambio de domicilio.
7. Solicitudes (06, 07): institucional (cambio de categoría, baja; una pendiente por tipo; la Comisión resuelve con acta) y Reportes (presentar un reclamo o una iniciativa, seguir el estado, el número).
8. Documentos (08): el estatuto y lo que publica la Comisión.
9. Si estás suspendido: qué podés hacer (ver, pagar, reportar) y qué no (adherir/cancelar débito, editar datos, solicitudes societarias), con el mensaje literal.
10. Correos que vas a recibir (tabla) y preguntas frecuentes (8-10: pagué y no figura; no me llegó el recibo; no puedo adherirme; el enlace venció; quiero cambiar el correo; me olvidé la contraseña; quiero darme de baja; cuánto debo y a qué valor).

- [ ] Pasos comunes 1-6. Commit: `docs(manuales): M2 member manual`.

---

### Task 12: M3 — Guía del vecino

**Files:** Create `docs/manuales/usuario/M3-guia-del-vecino.md`; salida `SIGeV-M3-Guia-del-vecino.docx`. Tope: 20 páginas. Capturas: `../img/m3/01…14`.

**Fuentes:** `scan-01` entero (§2 wizards con sus pasos y mensajes, §3 reglas, §4 correos), `docs/05` §1, §2, §8, §11.1, textos de `src/app/(public)/**`.

**Índice:**
1. El sitio (01-04): inicio, noticias, actividades, ubicación (el mapa del IGN y la sede), documentos públicos.
2. Asociarse — ASOCIATE (05-10): quién puede (mayor de edad, DNI, vivir en el barrio para activo/adherente; "en otro barrio" según la llave), los 6 pasos uno por uno con su captura y qué pide cada uno, los documentos (las dos caras del DNI, formatos y tamaño), la cuota de ingreso y el pago (Mercado Pago; el link vence), qué pasa después (acuse por correo; la Comisión resuelve; el acta; recién ahí sos socio), retomar un trámite (enlace y reenvío), por qué puede bloquearse el DNI (las causales en lenguaje llano) y qué hacer, plazos (3/7 días).
3. Re-empadronarse — REEMPADRONATE (11): quién tiene que hacerlo (adherentes convocados), los 4 pasos, plazos (30 días, segunda instancia de 10, recurso de 30 corridos), qué pasa si no lo hacés (baja por acta, aviso por correo o cartelera), cómo saber si estás convocado.
4. Reportes (12, 13): reclamo (se presenta ante un organismo) vs iniciativa (la trata la Comisión), los 3 pasos, la foto (se quita la ubicación del celular) y el mapa, tus datos y las dos caras del DNI, el número de reporte, cómo sigue, retomar un borrador (48 h).
5. Ingresar y recuperar el acceso (14): remite al manual del socio.
6. Tus datos: qué se pide, para qué, cuánto tiempo se guarda (Ley 25.326, dos párrafos, sin jerga).
7. Preguntas frecuentes (8-10).

- [ ] Pasos comunes 1-6. Commit: `docs(manuales): M3 neighbour guide`.

---

### Task 13: Hallazgos, README y CLAUDE.md

**Files:**
- Create: `docs/manuales/HALLAZGOS-2026-09-11.md`
- Modify: `docs/manuales/README.md` (sección Capturas), `CLAUDE.md` (párrafo nuevo antes de "## Prioridad actual")

- [ ] **Step 1: Compilar los hallazgos**

Leer las secciones "Cosas que NO están…" y "Dudas e inconsistencias" de los cinco informes (`scan-01` §5-6, `scan-02` §6-7, `scan-03` §6-7, `scan-04` §7-8, `scan-05` §11-12). Escribir `HALLAZGOS-2026-09-11.md` con este encabezado y una tabla por informe:

```markdown
# Hallazgos del relevamiento del 11/09/2026

Inconsistencias entre `docs/`, `CLAUDE.md`, `README.md` y el código, y dudas que
dejó el relevamiento con el que se escribieron los manuales. **Nada de esto se
corrigió**: la serie técnica describe el código; acá queda qué difiere y dónde,
para que el operador decida. Gravedad: **doc** (documentación desactualizada),
**deuda** (código que conviene revisar), **duda** (no se pudo determinar).

## 1. Sitio público

| # | Qué dice la doc | Qué dice el código | Gravedad | Sugerencia |
|---|---|---|---|---|
| 1.1 | CLAUDE.md: la home usa `assets/hero-nuevo.jpg` | `src/app/page.tsx:NN` usa `hero-3.jpg` | doc | Actualizar CLAUDE.md |
…
```

Una fila por hallazgo, cada una con archivo:línea del lado del código (verificar que la cita del informe siga siendo válida con `sed -n`). Deduplicar los que aparecen en dos informes. Se esperan 50-70 filas.

- [ ] **Step 2: README final**

Reemplazar la sección "## Capturas" del README por:

```markdown
## Capturas

Las capturas salen del dev server local con `scripts/docs/capture.ts`
(`playwright-core` sobre el Chrome instalado; no descarga navegadores). Hace falta:

1. el dev server corriendo (`npm run dev`, puerto 3000, o `DOCS_CAPTURE_BASE_URL`);
2. los usuarios de prueba con la contraseña `SEED_TEST_PASSWORD` del `.env`
   (`npx tsx scripts/docs/reset-test-passwords.ts` la reaplica; solo contra localhost);
3. los estados sembrados que describe `.superpowers/sdd/manuales/siembra.md`
   (noticia, alta en cola, reporte, exención, re-empadronamiento convocado, bandeja).

    npm run docs:capture            # todas
    npm run docs:capture m1         # un manual
    npm run docs:capture m1 -- --only 20   # una sola (por prefijo)

La lista de capturas vive en `scripts/docs/capture-plan.ts`. Ninguna captura puede
mostrar datos de un socio real: se usan los `*.prueba` y fichas inventadas.

## Mantenimiento

Al cerrar un módulo que cambie una pantalla o una regla: actualizar el Markdown del
documento que la describe, re-capturar lo que cambió, `npm run docs:build`, y
commitear el `.md`, los PNG y el `.docx` juntos. Subir `version` y `date` en el
front matter.
```

- [ ] **Step 3: Párrafo en CLAUDE.md**

Insertar antes de `## Prioridad actual`:

```markdown
## Documentación y manuales (`docs/manuales/`)

Desde el 11/09/2026 existe una serie de siete documentos técnicos (T1-T7) y tres
manuales de usuario (M1 operador, M2 socio, M3 vecino) en `docs/manuales/`: fuente
Markdown, capturas en `img/` y los Word generados en `word/` con `npm run docs:build`
(`scripts/docs/`, ver el README de la carpeta). **Al cerrar un módulo que cambie una
pantalla, una regla o un cron, se actualiza el Markdown correspondiente, se
re-captura lo que cambió y se regenera el Word en el mismo commit.** Lo que `docs/`
y el código dicen distinto está en `docs/manuales/HALLAZGOS-2026-09-11.md`; la serie
describe el código.
```

- [ ] **Step 4: Commit**

```bash
git add docs/manuales/HALLAZGOS-2026-09-11.md docs/manuales/README.md CLAUDE.md
git commit -m "docs(manuales): survey findings, folder README and the maintenance rule in CLAUDE.md"
```

---

### Task 14: Verificación final

**Files:** Create `.superpowers/sdd/manuales/verificacion-final.md`.

- [ ] **Step 1: Build completo desde cero**

Run: `rm -f docs/manuales/word/*.docx && npm run docs:build` → diez líneas `ok` y diez líneas `N páginas`. Anotar la tabla documento | páginas | tope y marcar los que se pasan (si alguno se pasa, volver al escritor de esa tarea).

- [ ] **Step 2: Cada Word abre**

Run: `"/c/Program Files/LibreOffice/program/soffice.exe" --headless --convert-to pdf --outdir .superpowers/sdd/manuales docs/manuales/word/*.docx`. Para cada PDF, leer con Read la página 1 (portada), la 2 (índice con números) y una interior. Run: `python <ruta del skill>/scripts/office/validate.py docs/manuales/word/<cada>.docx` → sin errores.

- [ ] **Step 3: Nada roto**

Run: `npm test 2>&1 | tail -6` → mismo `Test Files` y `Tests` que `.superpowers/sdd/manuales/baseline.md`. Run: `npx tsc --noEmit` → limpio. Run: `npm run lint` → limpio. Run: `npm run build` → OK (`scripts/` no entra al bundle, pero `tsc` de Next sí lo tipa).

- [ ] **Step 4: Diff acotado**

Run: `git diff --stat main..HEAD -- . ':!docs/manuales' ':!docs/superpowers' ':!scripts/docs' ':!package.json' ':!package-lock.json' ':!CLAUDE.md'` → vacío. Run: `git diff --stat main..HEAD -- src prisma tests` → vacío.

- [ ] **Step 5: Privacidad**

Run: `git grep -n -i -E "SEED_TEST_PASSWORD=|password.{0,3}[:=]\s*['\"][^'\"]{4,}" -- docs/manuales scripts/docs` → solo referencias a la variable, ningún valor. Volver a mirar las tres capturas de listas (`m1/12`, `m1/17`, `m1/34`) y confirmar que no hay apellidos reales.

- [ ] **Step 6: Revisión de rama**

Dispatch de un revisor (Fable) con la spec, el plan y `git diff main..HEAD --stat`: verifica cobertura del índice de la spec documento por documento, toma 5 afirmaciones por documento y las coteja, y lee HALLAZGOS contra dos informes. Se aplican sus correcciones.

- [ ] **Step 7: Informe y commit**

Escribir `verificacion-final.md` con cada punto y su resultado real (incluidos los que fallaron y cómo se resolvieron). Commit final si hubo correcciones: `docs(manuales): final review fixes`. Dejar el `git push` como comando copiable para el operador: `git push -u origin docs-manuales`.
