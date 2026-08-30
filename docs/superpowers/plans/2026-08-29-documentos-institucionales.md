# Documentos institucionales — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Módulo de documentos institucionales: gestión desde `/admin/documentos` (Contenido) y publicación a socios en `/mi/documentos`, que reemplaza a `/mi/estatuto`.

**Architecture:** Tabla nueva `institutional_documents` (enum + modelo, migración aditiva) con unicidad "una memoria/balance por año" garantizada por la base vía `yearKey`. Storage en `UPLOADS_DIR/institucional/` con los moldes probados de noticias/documentos (magic bytes, UUID, compensación de huérfanos). Dos route handlers finos (socio y admin) con las cabeceras defensivas del estatuto actual. UI admin con pestañas Radix `?tab=` (molde `/admin/configuracion`) y UI de socio con norma vigente destacada + secciones por tipo.

**Tech Stack:** Next.js 16 App Router, Prisma 7 + `@prisma/adapter-mariadb`, zod, Radix Tabs, lucide-react, Tailwind v4, vitest.

**Spec:** `docs/superpowers/specs/2026-08-29-documentos-institucionales-design.md`

## Global Constraints

- UI en español es-AR ("vos", DD/MM/AAAA); código, tablas y commits en inglés.
- Solo PDF, máximo **10 MB** (`bodySizeLimit` global ya es 12 MB, no se toca).
- `lib/` **nunca** importa lucide: íconos como strings + mapa en el componente cliente.
- Módulos puros: el cliente de Prisma se INYECTA o se importa solo desde código de app (nunca desde un módulo que un test puro importe).
- Toda action abre con `requireAdmin()` (es un endpoint público); auditoría con el patrón de `news_create` (fuera del try; en borrados, antes de tocar el disco).
- **No tocar**: `src/lib/treasury/*` (solo IMPORTAR `unique-violation.ts`), `src/lib/mp/*`, `next.config.ts`, `resolve.ts`, `registerPayment`. Ninguna env var nueva.
- Migraciones con `prisma migrate dev`, nunca `db push`.
- Accesibilidad del shell: targets ≥44px, `outline-hidden` + `focus-visible:ring-*` (jamás `outline-none`), `aria-current`, nunca un `thead` sin filas.
- Tests con vitest: `npx vitest run tests/<archivo>.test.ts`.
- Commits frecuentes, mensajes en inglés, footer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Trabajar en la rama `institutional-documents` (creada en Task 1).

---

### Task 1: Modelo Prisma y migración

**Files:**
- Modify: `prisma/schema.prisma` (User: agregar back-relation; al final: enum + modelo)
- Create: `prisma/migrations/<timestamp>_add_institutional_documents/migration.sql` (la genera Prisma)

**Interfaces:**
- Produces: modelo `InstitutionalDocument` y enum `InstitutionalDocumentType` (`norm | annual_report | balance | other`) en `@/generated/prisma/client`; accessor `prisma.institutionalDocument`.

- [ ] **Step 1: Crear la rama**

```bash
git checkout -b institutional-documents
```

- [ ] **Step 2: Agregar la back-relation en `User`**

En `prisma/schema.prisma`, dentro de `model User`, después de la línea `feeExemptionsCreated   FeeExemption[]`:

```prisma
  institutionalDocs      InstitutionalDocument[]
```

- [ ] **Step 3: Agregar enum y modelo al final de `prisma/schema.prisma`**

```prisma
// ---------------------------------------------------------------------------
// Documentos institucionales (spec 2026-08-29). NO es el modelo `Document`:
// aquel es documentación PERSONAL de trámite (DNI/anexos, auditado por vista);
// este es material que la Comisión publica a los socios (estatuto, memorias,
// balances). Solo PDF; el archivo vive en UPLOADS_DIR/institucional/.
enum InstitutionalDocumentType {
  norm
  annual_report
  balance
  other
}

model InstitutionalDocument {
  id           Int                       @id @default(autoincrement())
  type         InstitutionalDocumentType
  title        String                    @db.VarChar(160)
  description  String?                   @db.VarChar(200)
  year         Int?
  // La unicidad "una memoria/un balance por año" la garantiza la BASE, no un
  // if: MySQL no tiene índices parciales, así que la clave se materializa solo
  // para annual_report/balance ("annual_report:2025") y queda NULL para
  // norm/other — los NULL de un unique de MySQL no chocan entre sí.
  yearKey      String?                   @unique @map("year_key") @db.VarChar(30)
  // {uuid}.pdf relativo a UPLOADS_DIR/institucional/. Nunca una ruta.
  fileName     String                    @map("file_name") @db.VarChar(255)
  size         Int
  // Solo normas; a lo sumo una (lo sostiene la transacción del asiento, no un
  // unique: false no es NULL). Es el documento que /mi/documentos destaca.
  featured     Boolean                   @default(false)
  uploadedById Int?                      @map("uploaded_by_id")
  uploadedBy   User?                     @relation(fields: [uploadedById], references: [id], onDelete: SetNull)
  createdAt    DateTime                  @default(now()) @map("created_at")
  updatedAt    DateTime                  @updatedAt @map("updated_at")

  @@index([type, year])
  @@map("institutional_documents")
}
```

- [ ] **Step 4: Generar la migración**

Run (requiere la MariaDB local de Docker corriendo):

```bash
npx prisma migrate dev --name add_institutional_documents
```

Expected: crea `prisma/migrations/<timestamp>_add_institutional_documents/migration.sql` con `CREATE TABLE institutional_documents` y regenera el cliente. Verificar que el SQL solo tenga `CREATE TABLE` + índices (aditiva pura).

- [ ] **Step 5: Verificar que la suite existente sigue verde**

```bash
npx vitest run
```

Expected: todo verde (la migración no toca nada existente).

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(documents): institutional documents model and migration"
```

---

### Task 2: Dominio puro (reglas de título, año, yearKey, featured y nombre de archivo)

**Files:**
- Create: `src/lib/institutional-documents/doc-name.ts` (puro, SIN `node:` — lo importan client components y el route handler)
- Create: `src/lib/institutional-documents/rules.ts` (puro, sin Prisma ni fs)
- Test: `tests/institutional-documents-rules.test.ts`

**Interfaces:**
- Consumes: `InstitutionalDocumentType` (type-only) de `@/generated/prisma/client`; `slugify` de `@/lib/news/slug` (puro).
- Produces:
  - `isValidInstitutionalDocFileName(name: string): boolean`
  - `DOCUMENT_TYPE_LABELS: Record<InstitutionalDocumentType, string>`
  - `requiresYear(type: InstitutionalDocumentType): boolean`
  - `prepareDocumentInput(input): { ok: true; data: PreparedDocument } | { ok: false; error: string }` con `PreparedDocument = { type; title: string; description: string | null; year: number | null; yearKey: string | null; featured: boolean }`
  - `duplicateYearMessage(type, year): string`
  - `pdfDownloadName(title: string): string`

- [ ] **Step 1: Escribir los tests que fallan**

Create `tests/institutional-documents-rules.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isValidInstitutionalDocFileName } from "@/lib/institutional-documents/doc-name";
import {
  DOCUMENT_TYPE_LABELS,
  duplicateYearMessage,
  pdfDownloadName,
  prepareDocumentInput,
  requiresYear,
} from "@/lib/institutional-documents/rules";

const UUID = "123e4567-e89b-42d3-a456-426614174000";

describe("isValidInstitutionalDocFileName", () => {
  it("acepta uuid.pdf", () => {
    expect(isValidInstitutionalDocFileName(`${UUID}.pdf`)).toBe(true);
  });
  // Única defensa anti-traversal antes de concatenar al filesystem: mismo
  // criterio que isValidNewsImageName (tests/news-images.test.ts).
  it("rechaza traversal, separadores, byte nulo y extensiones ajenas", () => {
    expect(isValidInstitutionalDocFileName("../secret.pdf")).toBe(false);
    expect(isValidInstitutionalDocFileName(`..\\${UUID}.pdf`)).toBe(false);
    expect(isValidInstitutionalDocFileName(`/etc/passwd`)).toBe(false);
    expect(isValidInstitutionalDocFileName(`${UUID}.pdf .txt`)).toBe(false);
    expect(isValidInstitutionalDocFileName(`${UUID}.pdf\n`)).toBe(false);
    expect(isValidInstitutionalDocFileName(`${UUID}.exe`)).toBe(false);
    expect(isValidInstitutionalDocFileName(`${UUID}.pdf.html`)).toBe(false);
    expect(isValidInstitutionalDocFileName(`${UUID.toUpperCase()}.pdf`)).toBe(false);
    expect(isValidInstitutionalDocFileName("")).toBe(false);
  });
});

describe("requiresYear", () => {
  it("solo memorias y balances exigen año", () => {
    expect(requiresYear("annual_report")).toBe(true);
    expect(requiresYear("balance")).toBe(true);
    expect(requiresYear("norm")).toBe(false);
    expect(requiresYear("other")).toBe(false);
  });
});

describe("prepareDocumentInput", () => {
  it("deriva el título de memorias y balances por tipo y año", () => {
    const memoria = prepareDocumentInput({ type: "annual_report", year: 2025 });
    expect(memoria).toMatchObject({
      ok: true,
      data: { title: "Memoria 2025", yearKey: "annual_report:2025", year: 2025 },
    });
    const balance = prepareDocumentInput({ type: "balance", year: 2024 });
    expect(balance).toMatchObject({
      ok: true,
      data: { title: "Balance 2024", yearKey: "balance:2024" },
    });
  });

  it("rechaza memoria/balance sin año, con el tipo en el mensaje", () => {
    const r = prepareDocumentInput({ type: "annual_report" });
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).toContain("Memoria");
  });

  it("normas y otros exigen título libre y no llevan yearKey", () => {
    const ok = prepareDocumentInput({ type: "norm", title: "Estatuto social", year: 2019 });
    expect(ok).toMatchObject({
      ok: true,
      data: { title: "Estatuto social", yearKey: null, year: 2019 },
    });
    expect(prepareDocumentInput({ type: "norm" })).toMatchObject({ ok: false });
    expect(prepareDocumentInput({ type: "other", title: "Convenio" })).toMatchObject({
      ok: true,
      data: { yearKey: null, year: null },
    });
  });

  it("featured solo prende en normas; en el resto se ignora", () => {
    const norm = prepareDocumentInput({ type: "norm", title: "Estatuto", featured: true });
    expect(norm).toMatchObject({ ok: true, data: { featured: true } });
    const memoria = prepareDocumentInput({ type: "annual_report", year: 2025, featured: true });
    expect(memoria).toMatchObject({ ok: true, data: { featured: false } });
  });

  it("la descripción vacía queda null", () => {
    const r = prepareDocumentInput({ type: "other", title: "x" });
    expect(r).toMatchObject({ ok: true, data: { description: null } });
    const con = prepareDocumentInput({ type: "other", title: "x", description: "Aprobado en asamblea." });
    expect(con).toMatchObject({ ok: true, data: { description: "Aprobado en asamblea." } });
  });
});

describe("duplicateYearMessage", () => {
  it("nombra el tipo con su artículo y el año", () => {
    expect(duplicateYearMessage("annual_report", 2025)).toBe(
      "Ya hay una Memoria 2025 cargada: editá la existente.",
    );
    expect(duplicateYearMessage("balance", 2024)).toBe(
      "Ya hay un Balance 2024 cargado: editá el existente.",
    );
  });
});

describe("pdfDownloadName", () => {
  it("slugifica el título y agrega .pdf", () => {
    expect(pdfDownloadName("Memoria 2025")).toBe("memoria-2025.pdf");
    expect(pdfDownloadName("Estatuto social")).toBe("estatuto-social.pdf");
  });
});

describe("DOCUMENT_TYPE_LABELS", () => {
  it("cubre los cuatro tipos", () => {
    expect(Object.keys(DOCUMENT_TYPE_LABELS).sort()).toEqual(
      ["annual_report", "balance", "norm", "other"].sort(),
    );
  });
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

```bash
npx vitest run tests/institutional-documents-rules.test.ts
```

Expected: FAIL (módulos inexistentes).

- [ ] **Step 3: Implementar `doc-name.ts`**

Create `src/lib/institutional-documents/doc-name.ts`:

```ts
// Validación del nombre de archivo de un documento institucional. Separado del
// storage (que importa node:fs) para poder importarse desde client components y
// tests puros — mismo criterio que @/lib/news/image-url.
//
// Es la ÚNICA defensa contra path traversal antes de concatenar el nombre a una
// ruta del filesystem. Sin flag `m`: `^`/`$` anclan a los extremos reales del
// string. No aflojar.
const NAME_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/;

export function isValidInstitutionalDocFileName(name: string): boolean {
  return NAME_RE.test(name);
}
```

- [ ] **Step 4: Implementar `rules.ts`**

Create `src/lib/institutional-documents/rules.ts`:

```ts
// Reglas de negocio de los documentos institucionales. Puro: sin Prisma, sin
// fs, sin lucide — las comparten las actions del admin, las dos pantallas y el
// script de importación, así que un cambio acá no puede divergir por camino
// (la lección de coverageFloor).
import type { InstitutionalDocumentType } from "@/generated/prisma/client";
import { slugify } from "@/lib/news/slug";

export const DOCUMENT_TYPE_LABELS: Record<InstitutionalDocumentType, string> = {
  norm: "Norma",
  annual_report: "Memoria",
  balance: "Balance",
  other: "Documento",
};

// El artículo por tipo, para mensajes en castellano ("una Memoria", "un Balance").
const TYPE_ARTICLE: Record<InstitutionalDocumentType, "un" | "una"> = {
  norm: "una",
  annual_report: "una",
  balance: "un",
  other: "un",
};

export function requiresYear(type: InstitutionalDocumentType): boolean {
  return type === "annual_report" || type === "balance";
}

export type PreparedDocument = {
  type: InstitutionalDocumentType;
  title: string;
  description: string | null;
  year: number | null;
  yearKey: string | null;
  featured: boolean;
};

/** Normaliza y valida lo que llega del formulario. Deriva el título de
 *  memorias/balances ("Memoria 2025"), materializa el yearKey solo para los
 *  tipos con unicidad anual y apaga `featured` fuera de las normas (el
 *  formulario no lo ofrece ahí; un POST forjado no puede colarlo). */
export function prepareDocumentInput(input: {
  type: InstitutionalDocumentType;
  title?: string;
  description?: string;
  year?: number;
  featured?: boolean;
}): { ok: true; data: PreparedDocument } | { ok: false; error: string } {
  const { type } = input;
  const year = input.year ?? null;
  if (requiresYear(type)) {
    if (year === null) {
      return { ok: false, error: `Ingresá el año de la ${DOCUMENT_TYPE_LABELS[type]}.` };
    }
    return {
      ok: true,
      data: {
        type,
        title: `${DOCUMENT_TYPE_LABELS[type]} ${year}`,
        description: input.description?.trim() || null,
        year,
        yearKey: `${type}:${year}`,
        featured: false,
      },
    };
  }
  const title = input.title?.trim();
  if (!title) return { ok: false, error: "Ingresá el título del documento." };
  return {
    ok: true,
    data: {
      type,
      title,
      description: input.description?.trim() || null,
      year,
      yearKey: null,
      // Solo una norma puede ser la vigente destacada de /mi/documentos.
      featured: type === "norm" && input.featured === true,
    },
  };
}

/** Mensaje del P2002 de `yearKey`, legible por el operador. */
export function duplicateYearMessage(type: InstitutionalDocumentType, year: number): string {
  const article = TYPE_ARTICLE[type];
  const suffix = article === "una" ? "cargada: editá la existente." : "cargado: editá el existente.";
  return `Ya hay ${article} ${DOCUMENT_TYPE_LABELS[type]} ${year} ${suffix}`;
}

/** Nombre con el que el navegador guarda el PDF ("memoria-2025.pdf"). */
export function pdfDownloadName(title: string): string {
  return `${slugify(title)}.pdf`;
}
```

- [ ] **Step 5: Correr los tests y verificar que pasan**

```bash
npx vitest run tests/institutional-documents-rules.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/institutional-documents tests/institutional-documents-rules.test.ts
git commit -m "feat(documents): pure domain rules for institutional documents"
```

---

### Task 3: Storage (escritura, sniff de PDF, borrado)

**Files:**
- Create: `src/lib/institutional-documents/storage.ts`
- Test: `tests/institutional-documents-storage.test.ts`

**Interfaces:**
- Consumes: `uploadsDir()` de `@/lib/news/images` (único dueño del default de `UPLOADS_DIR`); `isValidInstitutionalDocFileName` de Task 2.
- Produces:
  - `MAX_DOC_BYTES = 10 * 1024 * 1024`
  - `institutionalDocsDir(): string`
  - `sniffPdf(bytes: Uint8Array): boolean`
  - `saveInstitutionalDocument(file: File): Promise<{ ok: true; fileName: string; size: number } | { ok: false; error: string }>`
  - `deleteInstitutionalDocument(fileName: string): Promise<void>`

- [ ] **Step 1: Escribir los tests que fallan**

Create `tests/institutional-documents-storage.test.ts`:

```ts
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MAX_DOC_BYTES,
  deleteInstitutionalDocument,
  institutionalDocsDir,
  saveInstitutionalDocument,
  sniffPdf,
} from "@/lib/institutional-documents/storage";

const PDF_BYTES = new TextEncoder().encode("%PDF-1.7\n%contenido de prueba");

function fileOf(bytes: Uint8Array, name = "doc.pdf"): File {
  return new File([bytes], name, { type: "application/pdf" });
}

describe("sniffPdf", () => {
  it("acepta solo la firma %PDF-", () => {
    expect(sniffPdf(PDF_BYTES)).toBe(true);
    expect(sniffPdf(new TextEncoder().encode("<!DOCTYPE html>"))).toBe(false);
    // Un JPEG o un PNG no son un documento institucional aunque el sniffer de
    // imágenes los acepte: acá la allowlist es PDF y nada más.
    expect(sniffPdf(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(false);
    expect(sniffPdf(new Uint8Array([]))).toBe(false);
    expect(sniffPdf(new TextEncoder().encode("%PD"))).toBe(false);
  });
});

describe("saveInstitutionalDocument / deleteInstitutionalDocument", () => {
  let dir: string;
  let prevUploads: string | undefined;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "sigev-docs-"));
    prevUploads = process.env.UPLOADS_DIR;
    process.env.UPLOADS_DIR = dir;
  });
  afterEach(() => {
    process.env.UPLOADS_DIR = prevUploads;
    if (prevUploads === undefined) delete process.env.UPLOADS_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it("escribe {uuid}.pdf bajo UPLOADS_DIR/institucional y reporta el tamaño real", async () => {
    const saved = await saveInstitutionalDocument(fileOf(PDF_BYTES));
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.fileName).toMatch(/^[0-9a-f-]{36}\.pdf$/);
    expect(saved.size).toBe(PDF_BYTES.length);
    const onDisk = readFileSync(path.join(institutionalDocsDir(), saved.fileName));
    expect(new Uint8Array(onDisk)).toEqual(PDF_BYTES);
  });

  it("rechaza archivo vacío, no-PDF y tamaño excedido", async () => {
    expect(await saveInstitutionalDocument(fileOf(new Uint8Array([])))).toMatchObject({ ok: false });
    const html = new TextEncoder().encode("<!DOCTYPE html><script>1</script>");
    expect(await saveInstitutionalDocument(fileOf(html))).toMatchObject({ ok: false });
    // File sintético que MIENTE su .size: el corte temprano lo agarra sin leer.
    const liar = { size: MAX_DOC_BYTES + 1, arrayBuffer: async () => PDF_BYTES.buffer } as unknown as File;
    expect(await saveInstitutionalDocument(liar)).toMatchObject({ ok: false });
  });

  it("el borrado trata ENOENT como éxito y rechaza nombres inválidos sin tocar el fs", async () => {
    await expect(
      deleteInstitutionalDocument("123e4567-e89b-42d3-a456-426614174000.pdf"),
    ).resolves.toBeUndefined();
    await expect(deleteInstitutionalDocument("../algo.pdf")).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

```bash
npx vitest run tests/institutional-documents-storage.test.ts
```

Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Implementar `storage.ts`**

Create `src/lib/institutional-documents/storage.ts`:

```ts
// Escritura y borrado de los PDFs institucionales. Viven en
// UPLOADS_DIR/institucional (fuera de public/ y del repo; backup.sh ya cubre
// UPLOADS_DIR entero) y se sirven SOLO por rutas autenticadas — el socio por
// /api/mi/documentos/[id], el admin por /api/admin/documentos/[id].
//
// Este módulo importa node:fs — NO importarlo desde un client component (para
// eso está ./doc-name, que es puro).
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { uploadsDir } from "@/lib/news/images";
import { isValidInstitutionalDocFileName } from "@/lib/institutional-documents/doc-name";

export const MAX_DOC_BYTES = 10 * 1024 * 1024;

export function institutionalDocsDir(): string {
  return path.join(uploadsDir(), "institucional");
}

// Magic bytes, no extensión ni Content-Type del cliente. La allowlist es PDF y
// nada más: un documento institucional publicado a socios se abre inline en el
// navegador, y cualquier otro formato es un error de carga, no una variante.
export function sniffPdf(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 5 &&
    bytes[0] === 0x25 && // %
    bytes[1] === 0x50 && // P
    bytes[2] === 0x44 && // D
    bytes[3] === 0x46 && // F
    bytes[4] === 0x2d //    -
  );
}

export async function saveInstitutionalDocument(
  file: File,
): Promise<{ ok: true; fileName: string; size: number } | { ok: false; error: string }> {
  if (file.size === 0) return { ok: false, error: "El archivo llegó vacío." };
  if (file.size > MAX_DOC_BYTES) {
    return { ok: false, error: "El PDF no puede superar los 10 MB." };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  // Dos veces a propósito: `file.size` lo declara el caller y un File sintético
  // puede mentir; el límite real se aplica sobre los bytes que van al disco.
  if (bytes.length > MAX_DOC_BYTES) {
    return { ok: false, error: "El PDF no puede superar los 10 MB." };
  }
  if (!sniffPdf(bytes)) {
    return { ok: false, error: "Formato no soportado: subí el documento en PDF." };
  }
  const fileName = `${crypto.randomUUID()}.pdf`;
  await mkdir(institutionalDocsDir(), { recursive: true });
  await writeFile(path.join(institutionalDocsDir(), fileName), bytes);
  return { ok: true, fileName, size: bytes.length };
}

// ENOENT no es error: si el archivo ya no está, el estado final es el buscado.
export async function deleteInstitutionalDocument(fileName: string): Promise<void> {
  if (!isValidInstitutionalDocFileName(fileName)) return;
  try {
    await unlink(path.join(institutionalDocsDir(), fileName));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}
```

- [ ] **Step 4: Correr y verificar que pasa**

```bash
npx vitest run tests/institutional-documents-storage.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/institutional-documents/storage.ts tests/institutional-documents-storage.test.ts
git commit -m "feat(documents): PDF storage under UPLOADS_DIR/institucional"
```

---

### Task 4: Server actions del admin (crear, editar, eliminar)

**Files:**
- Create: `src/lib/institutional-documents/schema.ts`
- Create: `src/lib/admin/documentos-tabs.ts`
- Create: `src/app/admin/documentos/actions.ts`
- Test: `tests/documentos-actions-auth.test.ts`
- Test: `tests/documentos-tabs.test.ts`

**Interfaces:**
- Consumes: `prepareDocumentInput`, `duplicateYearMessage`, `requiresYear` (Task 2); `saveInstitutionalDocument`, `deleteInstitutionalDocument` (Task 3); `parseForm` de `@/lib/forms`; `requireAdmin`, `audit`, `prisma`; `isUniqueViolation` de `@/lib/treasury/unique-violation` (import de lectura, no se modifica ese archivo).
- Produces:
  - `documentFormSchema` (zod)
  - `DOCUMENTOS_TABS: DocumentosTab[]`, `DocumentosTabId = "normas" | "memorias" | "balances" | "otros"`, `initialDocumentosTab(sp)`, `tabForType(type)`
  - actions `createDocumentAction`, `updateDocumentAction`, `deleteDocumentAction` — firma `(prev: { error?: string }, formData: FormData) => Promise<{ error?: string }>`

- [ ] **Step 1: Escribir los tests que fallan**

Create `tests/documentos-tabs.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  DOCUMENTOS_TABS,
  initialDocumentosTab,
  tabForType,
} from "@/lib/admin/documentos-tabs";

describe("DOCUMENTOS_TABS", () => {
  it("cubre los cuatro tipos, en el orden de la spec", () => {
    expect(DOCUMENTOS_TABS.map((t) => t.value)).toEqual(["normas", "memorias", "balances", "otros"]);
    expect(DOCUMENTOS_TABS.map((t) => t.type)).toEqual(["norm", "annual_report", "balance", "other"]);
  });
});

describe("initialDocumentosTab", () => {
  it("honra un ?tab= válido y cae a normas ante basura o ausencia", () => {
    expect(initialDocumentosTab({ tab: "balances" })).toBe("balances");
    expect(initialDocumentosTab({ tab: "inventada" })).toBe("normas");
    expect(initialDocumentosTab({})).toBe("normas");
    expect(initialDocumentosTab({ tab: ["memorias", "otros"] })).toBe("normas");
  });
});

describe("tabForType", () => {
  it("mapea cada tipo a su pestaña", () => {
    expect(tabForType("norm")).toBe("normas");
    expect(tabForType("annual_report")).toBe("memorias");
    expect(tabForType("balance")).toBe("balances");
    expect(tabForType("other")).toBe("otros");
  });
});
```

Create `tests/documentos-actions-auth.test.ts` (molde: `tests/news-actions-auth.test.ts` — cada action es un endpoint público y `requireAdmin()` es el único control):

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  institutionalDocument: {
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
    findUnique: vi.fn(),
  },
  $transaction: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth/require-admin", () => ({
  requireAdmin: vi.fn(async () => ({ ok: false, reason: "anonymous", error: "Sesión inválida." })),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

import {
  createDocumentAction,
  deleteDocumentAction,
  updateDocumentAction,
} from "@/app/admin/documentos/actions";
import { audit } from "@/lib/audit";

const form = (entries: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.append(k, v);
  return fd;
};

describe("autorización de las actions de documentos", () => {
  beforeEach(() => vi.clearAllMocks());

  const cases: Array<
    [string, (p: { error?: string }, f: FormData) => Promise<{ error?: string }>, FormData]
  > = [
    ["create", createDocumentAction, form({ type: "norm", title: "x" })],
    ["update", updateDocumentAction, form({ id: "1", type: "norm", title: "x" })],
    ["delete", deleteDocumentAction, form({ id: "1" })],
  ];

  for (const [name, action, fd] of cases) {
    it(`${name}: sin sesión devuelve error y no toca la base`, async () => {
      const result = await action({}, fd);
      expect(result.error).toBe("Sesión inválida.");
      expect(prismaMock.institutionalDocument.create).not.toHaveBeenCalled();
      expect(prismaMock.institutionalDocument.update).not.toHaveBeenCalled();
      expect(prismaMock.institutionalDocument.delete).not.toHaveBeenCalled();
      expect(prismaMock.institutionalDocument.findUnique).not.toHaveBeenCalled();
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
      expect(audit).not.toHaveBeenCalled();
    });
  }
});
```

- [ ] **Step 2: Correr y verificar que fallan**

```bash
npx vitest run tests/documentos-tabs.test.ts tests/documentos-actions-auth.test.ts
```

Expected: FAIL (módulos inexistentes).

- [ ] **Step 3: Implementar `src/lib/admin/documentos-tabs.ts`**

```ts
// Pestañas de /admin/documentos. Client-side (`?tab=`, calco de config-tabs) y
// NO subrutas: una sola URL conserva los redirects de actions.ts y el deep-link
// de los chips de año (`?tab=memorias&anio=2025`). El mapa ícono→componente
// vive en el componente cliente: lib/ es puro y testeable en node sin lucide.
import type { InstitutionalDocumentType } from "@/generated/prisma/client";

export type DocumentosTabId = "normas" | "memorias" | "balances" | "otros";

export type DocumentosTab = {
  value: DocumentosTabId;
  label: string;
  icon: "scale" | "book-open" | "chart-column" | "files";
  type: InstitutionalDocumentType;
};

export const DOCUMENTOS_TABS: DocumentosTab[] = [
  { value: "normas", label: "Normas", icon: "scale", type: "norm" },
  { value: "memorias", label: "Memorias", icon: "book-open", type: "annual_report" },
  { value: "balances", label: "Balances", icon: "chart-column", type: "balance" },
  { value: "otros", label: "Otros", icon: "files", type: "other" },
];

// Acepta el union crudo de searchParams: un param repetido o inventado cae en
// la primera pestaña, que es lo inofensivo.
export function initialDocumentosTab(sp: { tab?: string | string[] }): DocumentosTabId {
  const found = DOCUMENTOS_TABS.find((t) => t.value === sp.tab);
  return found ? found.value : "normas";
}

// A qué pestaña vuelve el redirect después de crear/editar/borrar un documento.
export function tabForType(type: InstitutionalDocumentType): DocumentosTabId {
  return DOCUMENTOS_TABS.find((t) => t.type === type)?.value ?? "normas";
}
```

- [ ] **Step 4: Implementar `src/lib/institutional-documents/schema.ts`**

```ts
import { z } from "zod";

// Mensajes en castellano: una server action es un endpoint público y los textos
// de zod por defecto ("Invalid input…") terminarían en pantalla tal cual.
export const documentFormSchema = z.object({
  type: z.enum(["norm", "annual_report", "balance", "other"], "Tipo de documento inválido."),
  title: z.string().max(160, "El título no puede superar los 160 caracteres.").optional(),
  description: z.string().max(200, "La descripción no puede superar los 200 caracteres.").optional(),
  year: z.coerce
    .number("Año inválido.")
    .int("Año inválido.")
    .min(1900, "Año inválido.")
    .max(2100, "Año inválido.")
    .optional(),
  featured: z.literal("on").optional(),
});

export type DocumentFormValues = z.infer<typeof documentFormSchema>;
```

- [ ] **Step 5: Implementar `src/app/admin/documentos/actions.ts`**

```ts
"use server";
// ABM de documentos institucionales. Cada action es un endpoint HTTP público
// (ver el encabezado de noticias/actions.ts): el `requireAdmin()` que abre cada
// función es el único control que hay.
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { parseForm } from "@/lib/forms";
import { documentFormSchema } from "@/lib/institutional-documents/schema";
import {
  duplicateYearMessage,
  prepareDocumentInput,
  requiresYear,
} from "@/lib/institutional-documents/rules";
import {
  deleteInstitutionalDocument,
  saveInstitutionalDocument,
} from "@/lib/institutional-documents/storage";
// Import de LECTURA: unique-violation.ts sabe que con @prisma/adapter-mariadb
// el nombre del unique violado no viaja en meta.target. No se modifica.
import { isUniqueViolation } from "@/lib/treasury/unique-violation";
import { tabForType } from "@/lib/admin/documentos-tabs";

async function clientIp(): Promise<string> {
  // Solo X-Real-IP, como en el resto del panel.
  return (await headers()).get("x-real-ip") ?? "unknown";
}

const idSchema = z.object({
  id: z.coerce.number("Documento inválido.").int("Documento inválido.").positive("Documento inválido."),
});

// El File NO pasa por parseForm (descarta no-strings): se lee del FormData.
function fileFrom(formData: FormData): File | undefined {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return undefined;
  return file;
}

const NOT_FOUND = "El documento no existe.";
const FILE_REQUIRED = "Elegí el archivo PDF.";

// Borrado que no puede tumbar el flujo: con la base ya escrita y auditada, un
// EACCES del filesystem solo deja un huérfano benigno en disco.
async function deleteDocBestEffort(fileName: string): Promise<void> {
  try {
    await deleteInstitutionalDocument(fileName);
  } catch (err) {
    console.error("[documentos] no se pudo borrar el archivo", fileName, err);
  }
}

type ActionState = { error?: string };

export async function createDocumentAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireAdmin();
  if (!actor.ok) return { error: actor.error };
  const parsed = parseForm(documentFormSchema, formData);
  if (!parsed.ok) return { error: parsed.error };
  const prepared = prepareDocumentInput({
    type: parsed.data.type,
    title: parsed.data.title,
    description: parsed.data.description,
    year: parsed.data.year,
    featured: parsed.data.featured === "on",
  });
  if (!prepared.ok) return { error: prepared.error };
  const file = fileFrom(formData);
  if (!file) return { error: FILE_REQUIRED };
  const saved = await saveInstitutionalDocument(file);
  if (!saved.ok) return { error: saved.error };

  const ip = await clientIp();
  const d = prepared.data;
  let docId: number;
  try {
    // La transacción sostiene "a lo sumo una norma vigente": desmarcar y marcar
    // son un solo commit. Sin llamadas de red adentro (regla del proyecto).
    docId = await prisma.$transaction(async (tx) => {
      if (d.featured) {
        await tx.institutionalDocument.updateMany({
          where: { type: "norm", featured: true },
          data: { featured: false },
        });
      }
      const doc = await tx.institutionalDocument.create({
        data: {
          type: d.type,
          title: d.title,
          description: d.description,
          year: d.year,
          yearKey: d.yearKey,
          fileName: saved.fileName,
          size: saved.size,
          featured: d.featured,
          uploadedById: actor.actorId,
        },
      });
      return doc.id;
    });
  } catch (e) {
    // El PDF ya está en disco: si el INSERT falló, no dejar el huérfano.
    await deleteDocBestEffort(saved.fileName);
    if (isUniqueViolation(e) && requiresYear(d.type) && d.year !== null) {
      return { error: duplicateYearMessage(d.type, d.year) };
    }
    throw e;
  }
  // Fuera del try: un error del asiento no puede caer en el catch que borra el
  // archivo de una fila que quedó creada (patrón news_create).
  await audit({
    userId: actor.actorId,
    action: "institutional_document_create",
    entity: "institutional_document",
    entityId: docId,
    detail: { type: d.type, title: d.title, year: d.year, featured: d.featured },
    ip,
  });
  redirect(`/admin/documentos?tab=${tabForType(d.type)}`);
}

export async function updateDocumentAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireAdmin();
  if (!actor.ok) return { error: actor.error };
  const parsedId = parseForm(idSchema, formData);
  if (!parsedId.ok) return { error: parsedId.error };
  const parsed = parseForm(documentFormSchema, formData);
  if (!parsed.ok) return { error: parsed.error };

  const existing = await prisma.institutionalDocument.findUnique({
    where: { id: parsedId.data.id },
  });
  if (!existing) return { error: NOT_FOUND };

  // El tipo es inmutable en edición: cambiar una memoria a norma reescribiría
  // título y unicidad por atrás. Se ignora el `type` posteado y manda la fila.
  const prepared = prepareDocumentInput({
    type: existing.type,
    title: parsed.data.title,
    description: parsed.data.description,
    year: parsed.data.year,
    featured: parsed.data.featured === "on",
  });
  if (!prepared.ok) return { error: prepared.error };
  const d = prepared.data;

  // Archivo: uno nuevo reemplaza; sin archivo, queda el actual.
  let fileName = existing.fileName;
  let size = existing.size;
  let newFile: string | null = null;
  const file = fileFrom(formData);
  if (file) {
    const saved = await saveInstitutionalDocument(file);
    if (!saved.ok) return { error: saved.error };
    newFile = saved.fileName;
    fileName = saved.fileName;
    size = saved.size;
  }

  try {
    await prisma.$transaction(async (tx) => {
      if (d.featured && !existing.featured) {
        await tx.institutionalDocument.updateMany({
          where: { type: "norm", featured: true, id: { not: existing.id } },
          data: { featured: false },
        });
      }
      await tx.institutionalDocument.update({
        where: { id: existing.id },
        data: {
          title: d.title,
          description: d.description,
          year: d.year,
          yearKey: d.yearKey,
          fileName,
          size,
          featured: d.featured,
        },
      });
    });
  } catch (e) {
    if (newFile) await deleteDocBestEffort(newFile);
    if (isUniqueViolation(e) && requiresYear(d.type) && d.year !== null) {
      return { error: duplicateYearMessage(d.type, d.year) };
    }
    throw e;
  }
  await audit({
    userId: actor.actorId,
    action: "institutional_document_update",
    entity: "institutional_document",
    entityId: existing.id,
    detail: { type: d.type, title: d.title, year: d.year, featured: d.featured, replacedFile: newFile !== null },
    ip: await clientIp(),
  });
  // Recién acá, con la fila actualizada y auditada, se borra el PDF anterior.
  if (newFile && existing.fileName !== fileName) {
    await deleteDocBestEffort(existing.fileName);
  }
  redirect(`/admin/documentos?tab=${tabForType(existing.type)}`);
}

export async function deleteDocumentAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireAdmin();
  if (!actor.ok) return { error: actor.error };
  const parsed = parseForm(idSchema, formData);
  if (!parsed.ok) return { error: parsed.error };
  const existing = await prisma.institutionalDocument.findUnique({
    where: { id: parsed.data.id },
  });
  if (!existing) return { error: NOT_FOUND };
  await prisma.institutionalDocument.delete({ where: { id: existing.id } });
  // El asiento va ANTES de tocar el disco (regla dura: acción sensible sin
  // asiento no puede existir; deleteInstitutionalDocument propaga lo que no
  // sea ENOENT).
  await audit({
    userId: actor.actorId,
    action: "institutional_document_delete",
    entity: "institutional_document",
    entityId: existing.id,
    detail: { type: existing.type, title: existing.title, year: existing.year },
    ip: await clientIp(),
  });
  await deleteDocBestEffort(existing.fileName);
  redirect(`/admin/documentos?tab=${tabForType(existing.type)}`);
}
```

Nota: no hay `updateTag` — el sitio público no muestra documentos y `/mi/documentos` será `force-dynamic`.

- [ ] **Step 6: Correr y verificar que pasan**

```bash
npx vitest run tests/documentos-tabs.test.ts tests/documentos-actions-auth.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/institutional-documents/schema.ts src/lib/admin/documentos-tabs.ts src/app/admin/documentos/actions.ts tests/documentos-tabs.test.ts tests/documentos-actions-auth.test.ts
git commit -m "feat(documents): admin server actions with year uniqueness and featured norm"
```

---

### Task 5: Rutas de serving (socio y admin)

**Files:**
- Create: `src/lib/institutional-documents/response.ts`
- Create: `src/app/api/mi/documentos/[id]/route.ts`
- Create: `src/app/api/admin/documentos/[id]/route.ts`
- Test: `tests/institutional-documents-routes.test.ts`

**Interfaces:**
- Consumes: `pdfDownloadName` (Task 2), `institutionalDocsDir` + `isValidInstitutionalDocFileName`, `requireMember`, `requireAdmin`, `prisma`.
- Produces: `institutionalDocResponse(bytes: Uint8Array, downloadName: string): Response`; `GET /api/mi/documentos/[id]`; `GET /api/admin/documentos/[id]`.

- [ ] **Step 1: Escribir los tests que fallan**

Create `tests/institutional-documents-routes.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  institutionalDocument: { findUnique: vi.fn() },
}));
const fsMock = vi.hoisted(() => ({ readFile: vi.fn() }));
const requireMemberMock = vi.hoisted(() => vi.fn());
const requireAdminMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("node:fs/promises", () => fsMock);
vi.mock("@/lib/auth/require-member", () => ({ requireMember: requireMemberMock }));
vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: requireAdminMock }));

import { GET as memberGet } from "@/app/api/mi/documentos/[id]/route";
import { GET as adminGet } from "@/app/api/admin/documentos/[id]/route";

const DOC = {
  id: 7,
  title: "Memoria 2025",
  fileName: "123e4567-e89b-42d3-a456-426614174000.pdf",
};
const PDF = Buffer.from("%PDF-1.7 contenido");

const props = (id: string) => ({ params: Promise.resolve({ id }) });
const req = () => new Request("http://localhost/api/x");

describe("GET /api/mi/documentos/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireMemberMock.mockResolvedValue({ ok: true, memberId: 1 });
    prismaMock.institutionalDocument.findUnique.mockResolvedValue(DOC);
    fsMock.readFile.mockResolvedValue(PDF);
  });

  it("sirve el PDF con las cabeceras defensivas y el nombre derivado del título", async () => {
    const res = await memberGet(req(), props("7"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toBe('inline; filename="memoria-2025.pdf"');
    expect(res.headers.get("Cache-Control")).toBe("no-store, private");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Security-Policy")).toBe("default-src 'none'; sandbox");
    // El suspendido lee: modo lectura del panel de socio.
    expect(requireMemberMock).toHaveBeenCalledWith({ allowSuspended: true });
  });

  it("403 sin sesión de socio, sin tocar la base", async () => {
    requireMemberMock.mockResolvedValue({ ok: false, reason: "anonymous", error: "Iniciá sesión." });
    const res = await memberGet(req(), props("7"));
    expect(res.status).toBe(403);
    expect(prismaMock.institutionalDocument.findUnique).not.toHaveBeenCalled();
  });

  it("404 con id no numérico, documento inexistente o archivo faltante", async () => {
    expect((await memberGet(req(), props("abc"))).status).toBe(404);
    prismaMock.institutionalDocument.findUnique.mockResolvedValue(null);
    expect((await memberGet(req(), props("99"))).status).toBe(404);
    prismaMock.institutionalDocument.findUnique.mockResolvedValue(DOC);
    fsMock.readFile.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
    expect((await memberGet(req(), props("7"))).status).toBe(404);
  });

  it("404 si la fila trae un fileName corrupto (no se toca el filesystem)", async () => {
    prismaMock.institutionalDocument.findUnique.mockResolvedValue({ ...DOC, fileName: "../.env" });
    const res = await memberGet(req(), props("7"));
    expect(res.status).toBe(404);
    expect(fsMock.readFile).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/documentos/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdminMock.mockResolvedValue({ ok: true, actorId: 1 });
    prismaMock.institutionalDocument.findUnique.mockResolvedValue(DOC);
    fsMock.readFile.mockResolvedValue(PDF);
  });

  it("sirve el PDF a un admin", async () => {
    const res = await adminGet(req(), props("7"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
  });

  it("403 sin sesión de admin, sin tocar la base", async () => {
    requireAdminMock.mockResolvedValue({ ok: false, reason: "anonymous", error: "Sesión inválida." });
    const res = await adminGet(req(), props("7"));
    expect(res.status).toBe(403);
    expect(prismaMock.institutionalDocument.findUnique).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Correr y verificar que fallan**

```bash
npx vitest run tests/institutional-documents-routes.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implementar `src/lib/institutional-documents/response.ts`**

```ts
// Respuesta HTTP de un PDF institucional. Cabeceras defensivas calcadas de la
// ruta del estatuto del M5 (que este módulo retira) y de receipt-response.ts:
// inline, sin caché compartida, sin sniffing, CSP con sandbox.
export function institutionalDocResponse(bytes: Uint8Array, downloadName: string): Response {
  return new Response(bytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${downloadName}"`,
      "Cache-Control": "no-store, private",
      Vary: "Cookie",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
```

- [ ] **Step 4: Implementar `src/app/api/mi/documentos/[id]/route.ts`**

```ts
// Un documento institucional para el socio logueado. Sin auditoría por vista a
// propósito: no es documentación personal (esa regla queda para DNIs y
// facturas); la auditoría de este módulo es de gestión, en las actions.
// El suspendido lee (modo lectura del panel); el dado de baja no (requireMember).
import { readFile } from "node:fs/promises";
import path from "node:path";

import { requireMember } from "@/lib/auth/require-member";
import { prisma } from "@/lib/prisma";
import { isValidInstitutionalDocFileName } from "@/lib/institutional-documents/doc-name";
import { pdfDownloadName } from "@/lib/institutional-documents/rules";
import { institutionalDocResponse } from "@/lib/institutional-documents/response";
import { institutionalDocsDir } from "@/lib/institutional-documents/storage";

export async function GET(
  _req: Request,
  props: { params: Promise<{ id: string }> },
): Promise<Response> {
  const actor = await requireMember({ allowSuspended: true });
  if (!actor.ok) return new Response(actor.error, { status: 403 });
  const { id } = await props.params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    return new Response("El documento no existe", { status: 404 });
  }
  const doc = await prisma.institutionalDocument.findUnique({ where: { id: numericId } });
  if (!doc) return new Response("El documento no existe", { status: 404 });
  // Defensa en profundidad: el fileName viene de la base (lo escribió el
  // storage con un UUID), pero concatenar al filesystem exige revalidar.
  if (!isValidInstitutionalDocFileName(doc.fileName)) {
    return new Response("El documento no existe", { status: 404 });
  }
  let bytes: Buffer;
  try {
    bytes = await readFile(path.join(institutionalDocsDir(), doc.fileName));
  } catch {
    return new Response("El archivo no está disponible", { status: 404 });
  }
  return institutionalDocResponse(new Uint8Array(bytes), pdfDownloadName(doc.title));
}
```

- [ ] **Step 5: Implementar `src/app/api/admin/documentos/[id]/route.ts`**

Idéntico salvo la guarda:

```ts
// El mismo PDF para el panel de admin (verificar lo subido sin sesión de
// socio). Sin auditoría por vista: no es documentación personal.
import { readFile } from "node:fs/promises";
import path from "node:path";

import { requireAdmin } from "@/lib/auth/require-admin";
import { prisma } from "@/lib/prisma";
import { isValidInstitutionalDocFileName } from "@/lib/institutional-documents/doc-name";
import { pdfDownloadName } from "@/lib/institutional-documents/rules";
import { institutionalDocResponse } from "@/lib/institutional-documents/response";
import { institutionalDocsDir } from "@/lib/institutional-documents/storage";

export async function GET(
  _req: Request,
  props: { params: Promise<{ id: string }> },
): Promise<Response> {
  const actor = await requireAdmin();
  if (!actor.ok) return new Response(actor.error, { status: 403 });
  const { id } = await props.params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    return new Response("El documento no existe", { status: 404 });
  }
  const doc = await prisma.institutionalDocument.findUnique({ where: { id: numericId } });
  if (!doc) return new Response("El documento no existe", { status: 404 });
  if (!isValidInstitutionalDocFileName(doc.fileName)) {
    return new Response("El documento no existe", { status: 404 });
  }
  let bytes: Buffer;
  try {
    bytes = await readFile(path.join(institutionalDocsDir(), doc.fileName));
  } catch {
    return new Response("El archivo no está disponible", { status: 404 });
  }
  return institutionalDocResponse(new Uint8Array(bytes), pdfDownloadName(doc.title));
}
```

- [ ] **Step 6: Correr y verificar que pasan**

```bash
npx vitest run tests/institutional-documents-routes.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/institutional-documents/response.ts src/app/api/mi/documentos src/app/api/admin/documentos tests/institutional-documents-routes.test.ts
git commit -m "feat(documents): authenticated PDF routes for member and admin"
```

---

### Task 6: Navegación admin + listado con pestañas y tira de estado

**Files:**
- Modify: `src/lib/admin/nav.ts` (union `AdminNavIcon` + ítem en Contenido)
- Modify: `src/components/admin/nav-icons.ts` (import + entrada `library`)
- Modify: `src/lib/admin/dashboard-cards.ts` (card en Contenido)
- Modify: `tests/admin-nav.test.ts:39-44` (orden esperado)
- Create: `src/app/admin/documentos/documentos-tabs.tsx`
- Create: `src/app/admin/documentos/page.tsx`

**Interfaces:**
- Consumes: `DOCUMENTOS_TABS`, `initialDocumentosTab` (Task 4); `prisma.institutionalDocument`; `PageHeader`, `EmptyState`, `Badge`, `Table*`, `Card`, `Tabs*`.
- Produces: ruta `/admin/documentos` con `?tab=` y `?anio=`; componente `DocumentosTabs({ initial, normas, memorias, balances, otros })`.

- [ ] **Step 1: Actualizar el test de nav (falla primero)**

En `tests/admin-nav.test.ts`, test `"keeps every live section for superadmin, in stable order"`, reemplazar el array esperado por:

```ts
    expect(hrefs).toEqual([
      "/admin", "/admin/solicitudes", "/admin/reempadronamiento", "/admin/socios",
      "/admin/tesoreria", "/admin/actas",
      "/admin/noticias", "/admin/actividades", "/admin/documentos",
      "/admin/salud", "/admin/padron-electoral",
      "/admin/usuarios", "/admin/configuracion",
    ]);
```

Run: `npx vitest run tests/admin-nav.test.ts` — Expected: FAIL (el ítem no existe todavía; también falla el test de página en disco hasta el Step 5).

- [ ] **Step 2: Agregar el ítem a `src/lib/admin/nav.ts`**

En el union (línea 6-8) agregar `"library"`:

```ts
export type AdminNavIcon =
  | "home" | "inbox" | "users" | "wallet" | "scroll-text" | "newspaper" | "calendar-days" | "settings"
  | "activity" | "vote" | "clipboard-check" | "user-cog" | "library";
```

En el grupo Contenido, después de Actividades:

```ts
      { href: "/admin/actividades", label: "Actividades", icon: "calendar-days" },
      // Documentos institucionales (estatuto, memorias, balances): lo que la
      // Comisión publica a los socios en /mi/documentos. Sin superadminOnly:
      // es Contenido, como Noticias.
      { href: "/admin/documentos", label: "Documentos", icon: "library" },
```

- [ ] **Step 3: Registrar el ícono en `src/components/admin/nav-icons.ts`**

Agregar `Library` al import de lucide (orden alfabético) y al mapa:

```ts
import {
  Activity,
  CalendarDays,
  ClipboardCheck,
  Home,
  Inbox,
  Library,
  Newspaper,
  ScrollText,
  Settings,
  UserCog,
  Users,
  Vote,
  Wallet,
} from "lucide-react";
```

y en `NAV_ICONS`, después de `"calendar-days": CalendarDays,`:

```ts
  library: Library,
```

- [ ] **Step 4: Agregar la card en `src/lib/admin/dashboard-cards.ts`**

En el grupo Contenido, después de la card de Actividades:

```ts
      {
        title: "Documentos",
        description: "Estatuto, memorias, balances y otros documentos que ven los socios.",
        href: "/admin/documentos",
        cta: "Gestionar documentos",
      },
```

- [ ] **Step 5: Implementar `src/app/admin/documentos/documentos-tabs.tsx`**

```tsx
"use client";
// Pestañas de Documentos: Radix Tabs con `?tab=` (calco de config-tabs.tsx).
// Los cuatro paneles llegan renderizados del servidor; Radix solo decide cuál
// se ve. Los chips de año son <Link> server-side que llevan `?tab=` en el href,
// así que un clic en un chip no saca al operador de su pestaña.
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ComponentType, ReactNode } from "react";
import { BookOpen, ChartColumn, Files, Scale } from "lucide-react";

import {
  DOCUMENTOS_TABS,
  type DocumentosTab,
  type DocumentosTabId,
} from "@/lib/admin/documentos-tabs";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const ICONS: Record<DocumentosTab["icon"], ComponentType<{ className?: string }>> = {
  scale: Scale,
  "book-open": BookOpen,
  "chart-column": ChartColumn,
  files: Files,
};

export function DocumentosTabs({ initial, normas, memorias, balances, otros }: {
  initial: DocumentosTabId;
  normas: ReactNode;
  memorias: ReactNode;
  balances: ReactNode;
  otros: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  // Un `?tab=` inventado no rompe la pantalla: cae en la pestaña inicial.
  const requested = params.get("tab");
  const current = requested && DOCUMENTOS_TABS.some((t) => t.value === requested) ? requested : initial;
  const panels: Record<DocumentosTabId, ReactNode> = { normas, memorias, balances, otros };
  return (
    <Tabs
      value={current}
      onValueChange={(value) => {
        const next = new URLSearchParams(params.toString());
        if (value === initial) next.delete("tab");
        else next.set("tab", value);
        // El filtro de año es de la pestaña que se abandona: no viaja.
        next.delete("anio");
        const qs = next.toString();
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      }}
    >
      <TabsList
        variant="line"
        aria-label="Tipos de documento"
        className="group-data-horizontal/tabs:h-auto w-full justify-start overflow-x-auto border-b pb-2"
      >
        {DOCUMENTOS_TABS.map((t) => {
          const Icon = ICONS[t.icon];
          return (
            <TabsTrigger
              key={t.value}
              value={t.value}
              className="min-h-11 flex-none gap-1.5 px-3 after:bg-primary data-active:font-semibold"
            >
              <Icon className="size-4 shrink-0" aria-hidden />
              {t.label}
            </TabsTrigger>
          );
        })}
      </TabsList>
      {DOCUMENTOS_TABS.map((t) => (
        <TabsContent key={t.value} value={t.value} className="pt-2">
          {panels[t.value]}
        </TabsContent>
      ))}
    </Tabs>
  );
}
```

- [ ] **Step 6: Implementar `src/app/admin/documentos/page.tsx`**

```tsx
import Link from "next/link";
import { BookOpen, ChartColumn, Files, Scale } from "lucide-react";
import type { InstitutionalDocument, InstitutionalDocumentType } from "@/generated/prisma/client";

import { prisma } from "@/lib/prisma";
import { formatDateAR } from "@/lib/format";
import { DOCUMENTOS_TABS, initialDocumentosTab } from "@/lib/admin/documentos-tabs";
import { EmptyState } from "@/components/admin/empty-state";
import { PageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Suspense } from "react";
import { cn } from "@/lib/utils";
import { DocumentosTabs } from "./documentos-tabs";

export const dynamic = "force-dynamic";
export const metadata = { title: "Documentos — SIGeV" };

type Row = InstitutionalDocument & { uploadedBy: { name: string | null } | null };

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// La tira de estado del molde de Configuración: cero queries nuevas, todo sale
// del listado que la página ya trajo.
function StatusStrip({ rows }: { rows: Row[] }) {
  const featured = rows.find((r) => r.featured);
  const lastMemoria = rows.filter((r) => r.type === "annual_report")[0];
  const lastBalance = rows.filter((r) => r.type === "balance")[0];
  const items = [
    {
      href: "?tab=normas", icon: Scale, label: "Norma vigente",
      value: featured ? featured.title : "Sin norma vigente", warning: !featured,
    },
    {
      href: "?tab=memorias", icon: BookOpen, label: "Última memoria",
      value: lastMemoria ? lastMemoria.title : "Ninguna cargada", warning: !lastMemoria,
    },
    {
      href: "?tab=balances", icon: ChartColumn, label: "Último balance",
      value: lastBalance ? lastBalance.title : "Ninguno cargado", warning: !lastBalance,
    },
    {
      href: "?tab=otros", icon: Files, label: "Documentos publicados",
      value: `${rows.length}`, warning: false,
    },
  ];
  return (
    <ul className="grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item) => (
        <li key={item.label}>
          <Card size="sm" className="relative h-full transition-shadow hover:shadow-md">
            <CardContent className="flex items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <item.icon aria-hidden className="size-5" />
              </span>
              <div className="min-w-0">
                <div className="text-xs text-muted-foreground">
                  <Link
                    href={item.href}
                    className="outline-hidden after:absolute after:inset-0 after:rounded-xl after:ring-ring after:ring-inset focus-visible:after:ring-2"
                  >
                    {item.label}
                  </Link>
                </div>
                <div
                  title={item.value}
                  className={cn("truncate text-sm font-medium", item.warning && "text-warning")}
                >
                  {item.value}
                </div>
              </div>
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}

// Chips de año para memorias/balances: links server-side (deep-link y botón
// atrás gratis) que conservan la pestaña en el href.
function YearChips({ tab, years, selected }: { tab: string; years: number[]; selected?: number }) {
  if (years.length < 2) return null;
  const chip = (active: boolean) =>
    cn(
      "inline-flex min-h-9 items-center rounded-full border px-3 text-sm outline-hidden",
      "focus-visible:ring-2 focus-visible:ring-ring",
      active
        ? "border-primary bg-primary/10 font-semibold text-primary"
        : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground",
    );
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filtrar por año">
      <Link href={`?tab=${tab}`} className={chip(selected === undefined)}>
        Todos
      </Link>
      {years.map((y) => (
        <Link key={y} href={`?tab=${tab}&anio=${y}`} className={chip(selected === y)}>
          {y}
        </Link>
      ))}
    </div>
  );
}

function DocumentsTable({ rows, emptyText }: { rows: Row[]; emptyText: string }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        description={emptyText}
        action={
          <Button asChild>
            <Link href="/admin/documentos/nuevo">Subir documento</Link>
          </Button>
        }
      />
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Título</TableHead><TableHead>Año</TableHead>
          <TableHead>Tamaño</TableHead><TableHead>Subido</TableHead>
          <TableHead>Por</TableHead>
          <TableHead><span className="sr-only">Acciones</span></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((d) => (
          <TableRow key={d.id}>
            <TableCell>
              <span className="flex items-center gap-2">
                <Link className="text-primary hover:underline" href={`/admin/documentos/${d.id}`}>
                  {d.title}
                </Link>
                {d.featured && <Badge variant="success">Vigente</Badge>}
              </span>
              {d.description && (
                <span className="block text-xs text-muted-foreground">{d.description}</span>
              )}
            </TableCell>
            <TableCell>{d.year ?? "—"}</TableCell>
            <TableCell>{formatSize(d.size)}</TableCell>
            <TableCell>{formatDateAR(d.createdAt)}</TableCell>
            <TableCell>{d.uploadedBy?.name ?? "—"}</TableCell>
            <TableCell>
              <span className="flex items-center gap-3">
                <a
                  className="text-sm text-primary hover:underline"
                  href={`/api/admin/documentos/${d.id}`}
                  target="_blank"
                  rel="noopener"
                >
                  Ver PDF
                </a>
                <Link className="text-sm text-primary hover:underline" href={`/admin/documentos/${d.id}`}>
                  Editar
                </Link>
              </span>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default async function AdminDocumentsPage(props: {
  searchParams: Promise<{ tab?: string | string[]; anio?: string | string[] }>;
}) {
  const sp = await props.searchParams;
  const rows: Row[] = await prisma.institutionalDocument.findMany({
    orderBy: [{ year: "desc" }, { createdAt: "desc" }],
    include: { uploadedBy: { select: { name: true } } },
  });
  const anio = typeof sp.anio === "string" && /^\d{4}$/.test(sp.anio) ? Number(sp.anio) : undefined;

  const byType = (type: InstitutionalDocumentType) => rows.filter((r) => r.type === type);
  const yearsOf = (type: InstitutionalDocumentType) =>
    [...new Set(byType(type).map((r) => r.year).filter((y): y is number => y !== null))];

  const panel = (tab: "memorias" | "balances", type: InstitutionalDocumentType, emptyText: string) => (
    <div className="space-y-3">
      <YearChips tab={tab} years={yearsOf(type)} selected={anio} />
      <DocumentsTable
        rows={byType(type).filter((r) => anio === undefined || r.year === anio)}
        emptyText={emptyText}
      />
    </div>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Documentos"
        actions={
          <Button asChild>
            <Link href="/admin/documentos/nuevo">Subir documento</Link>
          </Button>
        }
      >
        <p className="max-w-3xl text-sm text-muted-foreground">
          Lo que se sube acá lo ven los socios en su panel, en Documentos.
        </p>
      </PageHeader>
      <StatusStrip rows={rows} />
      <Suspense fallback={null}>
        <DocumentosTabs
          initial={initialDocumentosTab(sp)}
          normas={
            <DocumentsTable
              rows={byType("norm")}
              emptyText="Todavía no hay normas. El estatuto y los reglamentos internos van acá."
            />
          }
          memorias={panel("memorias", "annual_report", "Todavía no hay memorias cargadas.")}
          balances={panel("balances", "balance", "Todavía no hay balances cargados.")}
          otros={
            <DocumentsTable
              rows={byType("other")}
              emptyText="Todavía no hay otros documentos."
            />
          }
        />
      </Suspense>
    </div>
  );
}
```

Nota: `DOCUMENTOS_TABS` queda importado solo si se usa — si el linter marca import sin uso en `page.tsx`, quitarlo (los labels salen del componente cliente).

- [ ] **Step 7: Correr los tests de nav y verificar que pasan**

```bash
npx vitest run tests/admin-nav.test.ts tests/dashboard-cards.test.ts
```

Expected: PASS (la página existe en disco, card y nav sincronizadas).

- [ ] **Step 8: Verificación visual en dev**

Levantar el dev server (preview) y abrir `/admin/documentos`: la sección aparece en la lateral (grupo Contenido), la card en `/admin`, las cuatro pestañas cambian con `?tab=`, cada una muestra su `EmptyState`. Verificar modo oscuro y móvil (375px): las pestañas scrollean horizontal, la tira de estado apila.

- [ ] **Step 9: Commit**

```bash
git add src/lib/admin/nav.ts src/components/admin/nav-icons.ts src/lib/admin/dashboard-cards.ts src/app/admin/documentos tests/admin-nav.test.ts
git commit -m "feat(documents): admin nav entry and tabbed listing with status strip"
```

---

### Task 7: Alta y edición en el admin (formulario + eliminar)

**Files:**
- Create: `src/app/admin/documentos/document-form.tsx`
- Create: `src/app/admin/documentos/nuevo/page.tsx`
- Create: `src/app/admin/documentos/[id]/page.tsx`

**Interfaces:**
- Consumes: actions de Task 4; `useSyncedForm`, `TextField` de `@/components/admin/synced-fields`; `FormMessage`; `SELECT_CLASS` de `@/lib/admin/field-styles`; `DOCUMENT_TYPE_LABELS`, `requiresYear` (puros, importables desde cliente — `rules.ts` no importa `node:`); `DOCUMENTOS_TABS` (labels de pestaña para el select).
- Produces: rutas `/admin/documentos/nuevo` (`?tipo=` preselecciona) y `/admin/documentos/[id]`.

- [ ] **Step 1: Implementar `src/app/admin/documentos/document-form.tsx`**

```tsx
"use client";
import { useActionState } from "react";
import { createDocumentAction, deleteDocumentAction, updateDocumentAction } from "./actions";
import { FormMessage } from "@/components/admin/form-message";
import { TextField, useSyncedForm } from "@/components/admin/synced-fields";
import { SELECT_CLASS } from "@/lib/admin/field-styles";
// rules.ts es puro (sin node:), importable desde un client component.
import { DOCUMENT_TYPE_LABELS, requiresYear } from "@/lib/institutional-documents/rules";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

type DocType = "norm" | "annual_report" | "balance" | "other";

export type EditableDocument = {
  id: number;
  type: DocType;
  title: string;
  description: string | null;
  year: number | null;
  featured: boolean;
  fileName: string;
};

const TYPE_OPTIONS: Array<{ value: DocType; label: string }> = [
  { value: "norm", label: "Norma (estatuto, reglamento)" },
  { value: "annual_report", label: "Memoria" },
  { value: "balance", label: "Balance" },
  { value: "other", label: "Otro documento" },
];

export function DocumentForm(
  props: { mode: "create"; initialType: DocType } | { mode: "edit"; doc: EditableDocument },
) {
  const editing = props.mode === "edit" ? props.doc : null;
  const [state, formAction, pending] = useActionState(
    editing ? updateDocumentAction : createDocumentAction, {},
  );
  // El select y el checkbox entran al estado sincronizado: sin esto, el reset
  // de React 19 tras un rechazo los volvería al valor inicial en silencio.
  const { values, setValue, formRef, field } = useSyncedForm({
    type: editing?.type ?? (props.mode === "create" ? props.initialType : "norm"),
    title: editing?.title ?? "",
    description: editing?.description ?? "",
    year: editing?.year ? String(editing.year) : "",
    featured: editing?.featured ? "on" : "",
  });
  const type = values.type as DocType;
  const yearRequired = requiresYear(type);

  return (
    <form ref={formRef} action={formAction} className="max-w-2xl space-y-4">
      {editing && <input type="hidden" name="id" value={editing.id} />}
      {editing ? (
        // El tipo es inmutable en edición (la action lo ignora): se muestra y
        // viaja igual para que el schema no falle por campo requerido ausente.
        <div className="space-y-1">
          <Label>Tipo</Label>
          <p className="text-sm">{DOCUMENT_TYPE_LABELS[editing.type]}</p>
          <input type="hidden" name="type" value={editing.type} />
        </div>
      ) : (
        <div className="space-y-1">
          <Label htmlFor="type">Tipo</Label>
          <select id="type" className={SELECT_CLASS} {...field("type")}>
            {TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      )}
      {yearRequired ? (
        <>
          <TextField
            label="Año (ejercicio)"
            field={field("year", (raw) => raw.replace(/\D/g, "").slice(0, 4))}
            inputMode="numeric"
            maxLength={4}
            hint={`El título se arma solo: "${DOCUMENT_TYPE_LABELS[type]} ${values.year || "AAAA"}". Un solo documento por año; para reemplazarlo, editá el existente.`}
          />
        </>
      ) : (
        <>
          <TextField label="Título" field={field("title")} maxLength={160} autoFocus={!editing} />
          <TextField
            label="Año (opcional)"
            field={field("year", (raw) => raw.replace(/\D/g, "").slice(0, 4))}
            inputMode="numeric"
            maxLength={4}
          />
        </>
      )}
      <TextField
        label="Descripción (opcional)"
        field={field("description")}
        maxLength={200}
        hint="Una línea que el socio ve bajo el título, por ejemplo la asamblea que lo aprobó."
      />
      {type === "norm" && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="featured"
            value="on"
            checked={values.featured === "on"}
            onChange={(e) => setValue("featured", e.target.checked ? "on" : "")}
          />
          Marcar como norma vigente (va destacada arriba en el panel del socio; desmarca la anterior)
        </label>
      )}
      <div className="space-y-1">
        <Label htmlFor="file">
          {editing ? "Reemplazar el PDF (opcional, máx. 10 MB)" : "Archivo PDF (máx. 10 MB)"}
        </Label>
        <input
          id="file" name="file" type="file" accept="application/pdf"
          className="block w-full text-sm file:mr-3 file:rounded-md file:border file:bg-muted file:px-3 file:py-1.5"
        />
        {editing && (
          <p className="text-xs text-muted-foreground">
            Si no subís nada, queda el archivo actual.{" "}
            <a
              className="text-primary hover:underline"
              href={`/api/admin/documentos/${editing.id}`}
              target="_blank"
              rel="noopener"
            >
              Ver el PDF actual
            </a>
          </p>
        )}
      </div>
      {state.error && <FormMessage kind="error">{state.error}</FormMessage>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Guardando…" : editing ? "Guardar cambios" : "Publicar documento"}
        </Button>
      </div>
    </form>
  );
}

export function DeleteDocumentButton({ doc }: { doc: EditableDocument }) {
  const [state, del, pending] = useActionState(deleteDocumentAction, {});
  return (
    <div className="space-y-2">
      <form
        action={del}
        onSubmit={(e) => {
          if (
            !window.confirm(
              "¿Eliminar este documento? Los socios dejan de verlo y el archivo se borra. Esta acción no se puede deshacer.",
            )
          )
            e.preventDefault();
        }}
      >
        <input type="hidden" name="id" value={doc.id} />
        <Button type="submit" variant="destructive" disabled={pending}>
          {pending ? "Eliminando…" : "Eliminar"}
        </Button>
      </form>
      {state.error && <FormMessage kind="error">{state.error}</FormMessage>}
    </div>
  );
}
```

- [ ] **Step 2: Implementar `src/app/admin/documentos/nuevo/page.tsx`**

```tsx
import { PageHeader } from "@/components/admin/page-header";
import { DOCUMENTOS_TABS, initialDocumentosTab } from "@/lib/admin/documentos-tabs";
import { DocumentForm } from "../document-form";

export const metadata = { title: "Subir documento — SIGeV" };

// `?tab=` llega desde la pestaña activa del listado (el botón "Subir documento"
// conserva la query) y preselecciona el tipo; sin él, arranca en Norma.
export default async function NewDocumentPage(props: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const sp = await props.searchParams;
  const tab = initialDocumentosTab(sp);
  const initialType = DOCUMENTOS_TABS.find((t) => t.value === tab)!.type;
  return (
    <div className="space-y-4">
      <PageHeader
        title="Subir documento"
        breadcrumb={[{ label: "Documentos", href: "/admin/documentos" }, { label: "Nuevo" }]}
      />
      <DocumentForm mode="create" initialType={initialType} />
    </div>
  );
}
```

Ajuste al listado (Task 6, `page.tsx`): el botón de `actions` del `PageHeader` y el de los `EmptyState` deben conservar la pestaña. Reemplazar en ambos `href="/admin/documentos/nuevo"` por un href armado con la pestaña activa: en `AdminDocumentsPage`, calcular `const activeTab = initialDocumentosTab(sp);` y pasar `href={`/admin/documentos/nuevo?tab=${activeTab}`}` al botón del header; en `DocumentsTable`, agregar prop `newHref: string` y usarla en el `EmptyState` (cada llamador pasa `/admin/documentos/nuevo?tab=<su pestaña>`).

- [ ] **Step 3: Implementar `src/app/admin/documentos/[id]/page.tsx`**

```tsx
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/ui/badge";
import { DeleteDocumentButton, DocumentForm, type EditableDocument } from "../document-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Editar documento — SIGeV" };

export default async function EditDocumentPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) notFound();
  const doc = await prisma.institutionalDocument.findUnique({ where: { id: numericId } });
  if (!doc) notFound();
  const editable: EditableDocument = {
    id: doc.id,
    type: doc.type,
    title: doc.title,
    description: doc.description,
    year: doc.year,
    featured: doc.featured,
    fileName: doc.fileName,
  };
  return (
    <div className="space-y-6">
      <PageHeader
        title={doc.title}
        breadcrumb={[{ label: "Documentos", href: "/admin/documentos" }, { label: "Editar" }]}
        actions={
          <>
            {doc.featured && <Badge variant="success">Vigente</Badge>}
            <DeleteDocumentButton doc={editable} />
          </>
        }
      />
      <DocumentForm mode="edit" doc={editable} />
    </div>
  );
}
```

- [ ] **Step 4: Verificación en dev (circuito completo)**

Con el dev server: subir una norma con "vigente" marcado, una memoria (solo año), un balance; intentar un segundo balance del mismo año y verificar el mensaje "Ya hay un Balance … cargado: editá el existente."; editar la memoria reemplazando el PDF; verificar "Ver PDF" (abre inline); eliminar el balance con el confirm. Verificar que cada operación deja su asiento en la tabla de auditoría (`SELECT action, entity_id FROM audit_logs ORDER BY id DESC LIMIT 5;` o desde donde el panel lo muestre).

- [ ] **Step 5: Correr la suite entera**

```bash
npx vitest run
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/admin/documentos
git commit -m "feat(documents): admin create/edit/delete screens"
```

---

### Task 8: Panel de socio — /mi/documentos, pestaña renombrada y retiro del estatuto viejo

**Files:**
- Modify: `src/lib/mi/nav.ts` (union + pestaña)
- Modify: `src/components/mi/mi-tabs.tsx` (mapa de íconos)
- Modify: `src/app/mi/page.tsx:2,264` (QuickLink)
- Modify: `src/app/mi/estatuto/page.tsx` (pasa a redirect)
- Delete: `src/app/api/mi/estatuto/route.ts`
- Create: `src/app/mi/documentos/page.tsx`
- Modify: `tests/mi-nav.test.ts`

**Interfaces:**
- Consumes: `requireMember`, `prisma`, `PanelHeader`, `EmptyState`, `formatDateAR`, `DOCUMENT_TYPE_LABELS`.
- Produces: ruta `/mi/documentos`; `/mi/estatuto` → redirect.

- [ ] **Step 1: Actualizar el test de nav de /mi (falla primero)**

En `tests/mi-nav.test.ts`, reemplazar el test `"includes Solicitudes between Mis datos and Estatuto"` por:

```ts
  it("includes Solicitudes between Mis datos and Documentos", () => {
    const hrefs = MI_TABS.map((t) => t.href);
    expect(hrefs.indexOf("/mi/solicitudes")).toBeGreaterThan(hrefs.indexOf("/mi/datos"));
    expect(hrefs.indexOf("/mi/solicitudes")).toBeLessThan(hrefs.indexOf("/mi/documentos"));
  });

  it("closes with Documentos (the old Estatuto tab, renamed)", () => {
    expect(MI_TABS.at(-1)).toMatchObject({ href: "/mi/documentos", label: "Documentos", icon: "library" });
    expect(MI_TABS.some((t) => t.href === "/mi/estatuto")).toBe(false);
  });
```

Run: `npx vitest run tests/mi-nav.test.ts` — Expected: FAIL.

- [ ] **Step 2: Renombrar la pestaña en `src/lib/mi/nav.ts`**

Union (línea 9): reemplazar `"scroll-text"` por `"library"`:

```ts
export type MiTabIcon = "home" | "wallet" | "user" | "file-text" | "library" | "refresh-cw";
```

Última entrada de `MI_TABS` (línea 32): reemplazar por:

```ts
  // El módulo de documentos institucionales absorbió al estatuto: la pestaña
  // lista todo lo que la Comisión publica (normas, memorias, balances).
  { href: "/mi/documentos", label: "Documentos", icon: "library" },
```

- [ ] **Step 3: Actualizar el mapa de íconos en `src/components/mi/mi-tabs.tsx`**

Import (línea 8): reemplazar `ScrollText` por `Library`:

```ts
import { FileText, Home, Library, RefreshCw, User, Wallet } from "lucide-react";
```

Mapa `ICONS`: reemplazar `"scroll-text": ScrollText,` por:

```ts
  library: Library,
```

- [ ] **Step 4: Actualizar la QuickLink del inicio (`src/app/mi/page.tsx`)**

Línea 2 — reemplazar `ScrollText` por `Library` en el import:

```ts
import { ClipboardCheck, Library, RefreshCw, User, Wallet } from "lucide-react";
```

Línea 264 — reemplazar la QuickLink de Estatuto por:

```tsx
        <QuickLink href="/mi/documentos" icon={Library} label="Documentos" description="Estatuto, memorias y balances" />
```

- [ ] **Step 5: `/mi/estatuto` pasa a redirect y la API vieja se elimina**

Reemplazar TODO el contenido de `src/app/mi/estatuto/page.tsx` por:

```tsx
import { redirect } from "next/navigation";

// El estatuto vive ahora en el módulo de documentos institucionales. La ruta
// queda como redirect para no romper marcadores del M5.
export default function MiEstatutoPage() {
  redirect("/mi/documentos");
}
```

Eliminar la ruta vieja:

```bash
git rm src/app/api/mi/estatuto/route.ts
```

- [ ] **Step 6: Implementar `src/app/mi/documentos/page.tsx`**

```tsx
import { BookOpen, ChartColumn, Files, Scale, ScrollText } from "lucide-react";
import type { InstitutionalDocument, InstitutionalDocumentType } from "@/generated/prisma/client";

import { EmptyState } from "@/components/admin/empty-state";
import { PanelHeader } from "@/components/admin/panel-header";
import { requireMember } from "@/lib/auth/require-member";
import { formatDateAR } from "@/lib/format";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const metadata = { title: "Documentos — Vecinal Ciudadela" };

// Fila-link entera al PDF: target de pulgar (≥44px) y anillo de foco del panel.
function DocRow({ doc }: { doc: InstitutionalDocument }) {
  return (
    <li>
      <a
        href={`/api/mi/documentos/${doc.id}`}
        target="_blank"
        rel="noopener"
        className="flex min-h-12 items-center justify-between gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10 outline-hidden transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="min-w-0">
          <span className="block text-sm font-semibold">{doc.title}</span>
          {doc.description && (
            <span className="block truncate text-xs text-muted-foreground">{doc.description}</span>
          )}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">
          PDF · {formatDateAR(doc.createdAt)}
        </span>
      </a>
    </li>
  );
}

function Section({ icon, title, docs }: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  docs: InstitutionalDocument[];
}) {
  // Sección vacía = sección que no existe: nunca un encabezado sin filas.
  if (docs.length === 0) return null;
  return (
    <section className="space-y-3">
      <PanelHeader icon={icon} title={title} />
      <ul className="list-none space-y-2 p-0">
        {docs.map((d) => (
          <DocRow key={d.id} doc={d} />
        ))}
      </ul>
    </section>
  );
}

export default async function MiDocumentosPage() {
  const actor = await requireMember({ allowSuspended: true });
  if (!actor.ok) return null; // el layout ya explica por qué
  const rows = await prisma.institutionalDocument.findMany({
    orderBy: [{ year: "desc" }, { createdAt: "desc" }],
  });
  const featured = rows.find((r) => r.featured) ?? null;
  const byType = (type: InstitutionalDocumentType) =>
    rows.filter((r) => r.type === type && r.id !== featured?.id);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">Documentos</h1>
        <p className="text-sm text-muted-foreground">
          El estatuto, las memorias y los balances de la asociación.
        </p>
      </div>
      {featured && (
        // La norma vigente, con el lenguaje visual de la credencial: rounded-2xl
        // + ring. Sobria y tipográfica — es un documento, no una tarjeta de
        // identidad.
        <section
          aria-label="Norma vigente"
          className="space-y-3 rounded-2xl bg-card p-5 ring-1 ring-foreground/10"
        >
          <p className="flex items-center gap-2 text-xs font-semibold tracking-widest text-primary uppercase">
            <ScrollText className="size-4" aria-hidden />
            Norma vigente
          </p>
          <div>
            <h2 className="text-xl font-bold">{featured.title}</h2>
            {featured.description && (
              <p className="text-sm text-muted-foreground">{featured.description}</p>
            )}
          </div>
          <a
            href={`/api/mi/documentos/${featured.id}`}
            target="_blank"
            rel="noopener"
            className="inline-flex min-h-12 items-center text-sm font-medium text-primary underline underline-offset-2 outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          >
            Abrir el PDF
          </a>
        </section>
      )}
      <Section icon={Scale} title="Normas" docs={byType("norm")} />
      <Section icon={BookOpen} title="Memorias" docs={byType("annual_report")} />
      <Section icon={ChartColumn} title="Balances" docs={byType("balance")} />
      <Section icon={Files} title="Otros documentos" docs={byType("other")} />
      {rows.length === 0 && (
        <EmptyState
          size="card"
          description="Los documentos van a aparecer acá cuando la Comisión los publique."
        />
      )}
    </div>
  );
}
```

- [ ] **Step 7: Correr los tests y buscar referencias colgadas**

```bash
npx vitest run tests/mi-nav.test.ts
```

Expected: PASS.

```bash
grep -rn "api/mi/estatuto\|mi/estatuto" src tests --include="*.ts" --include="*.tsx"
```

Expected: solo el redirect de `src/app/mi/estatuto/page.tsx`. Cualquier otra referencia se actualiza a `/mi/documentos`.

- [ ] **Step 8: Verificación en dev**

Como socio de prueba: la pestaña "Documentos" aparece con su ícono, `/mi/estatuto` redirige, la norma vigente se destaca arriba con su CTA, las secciones solo aparecen con contenido, las filas abren el PDF inline. Verificar móvil (375px) y modo oscuro.

- [ ] **Step 9: Commit**

```bash
git add src/lib/mi/nav.ts src/components/mi/mi-tabs.tsx src/app/mi tests/mi-nav.test.ts
git rm --cached src/app/api/mi/estatuto/route.ts 2>$null; git add -A src/app/api/mi
git commit -m "feat(documents): member documents page replaces estatuto tab"
```

---

### Task 9: Script de importación del estatuto + verificación final

**Files:**
- Create: `scripts/import-estatuto.ts`
- Modify: `docs/superpowers/specs/2026-08-29-documentos-institucionales-design.md` (marcar implementado, si hay desvíos anotarlos)

**Interfaces:**
- Consumes: `prisma`, `audit`, `institutionalDocsDir` (Task 3).
- Produces: comando one-shot idempotente para el VPS.

- [ ] **Step 1: Implementar `scripts/import-estatuto.ts`**

```ts
// One-shot: migra datos/estatuto.pdf al módulo de documentos institucionales
// como norma vigente. Idempotente: si ya existe una norma destacada, no hace
// nada (re-correrlo por error no duplica). Run: npx tsx scripts/import-estatuto.ts
//
// `tsx` no carga `.env` por su cuenta: sin esto el singleton de Prisma no ve
// DATABASE_URL. Tiene que ser el primer import del archivo.
import "dotenv/config";

import { randomUUID } from "node:crypto";
import { copyFile, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { prisma } from "../src/lib/prisma";
import { audit } from "../src/lib/audit";
import { institutionalDocsDir } from "../src/lib/institutional-documents/storage";

const SOURCE = join(process.cwd(), "datos", "estatuto.pdf");

async function main() {
  const existing = await prisma.institutionalDocument.findFirst({
    where: { type: "norm", featured: true },
  });
  if (existing) {
    console.log(`Ya existe una norma vigente ("${existing.title}", id ${existing.id}). No se hace nada.`);
    return;
  }
  const info = await stat(SOURCE); // tira ENOENT si falta: abortar es correcto
  const fileName = `${randomUUID()}.pdf`;
  await mkdir(institutionalDocsDir(), { recursive: true });
  await copyFile(SOURCE, join(institutionalDocsDir(), fileName));
  const doc = await prisma.institutionalDocument.create({
    data: {
      type: "norm",
      title: "Estatuto social",
      description: "El texto completo del estatuto de la asociación.",
      fileName,
      size: info.size,
      featured: true,
      // Sin uploadedById: lo importó el sistema, no un operador.
    },
  });
  await audit({
    action: "institutional_document_create",
    entity: "institutional_document",
    entityId: doc.id,
    detail: { type: "norm", title: doc.title, source: "import-estatuto" },
  });
  console.log(`Estatuto importado como documento ${doc.id} (${fileName}, ${info.size} bytes).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 2: Probarlo en local, dos veces**

```bash
npx tsx scripts/import-estatuto.ts
```

Expected: "Estatuto importado como documento N…". Verificar en `/mi/documentos` que aparece destacado y el PDF abre.

```bash
npx tsx scripts/import-estatuto.ts
```

Expected: "Ya existe una norma vigente… No se hace nada." (idempotencia).

- [ ] **Step 3: Suite completa, lint y build**

```bash
npx vitest run
```

Expected: PASS completo.

```bash
npm run lint
```

Expected: sin errores.

```bash
npm run build
```

Expected: build OK (atención a imports de `node:` en client components — `document-form.tsx` solo importa `rules.ts`, que es puro).

- [ ] **Step 4: Verificar el perímetro (la promesa de la spec §9)**

```bash
git diff --stat main...HEAD -- src/lib/treasury src/lib/mp next.config.ts
```

Expected: **vacío** (cero archivos tocados en el núcleo de plata y en la config).

- [ ] **Step 5: Actualizar la spec con el estado y commitear**

Agregar al final de la spec: estado "IMPLEMENTADO <fecha>" y cualquier desvío de ejecución respecto del plan.

```bash
git add scripts/import-estatuto.ts docs/superpowers/specs/2026-08-29-documentos-institucionales-design.md
git commit -m "feat(documents): estatuto import script and spec status"
```

- [ ] **Step 6: Nota de despliegue para el operador (no ejecutar: la corre Mariano)**

El deploy es el habitual de `docs/10` §4.5 (pull → migrate deploy → build → restart). Paso adicional post-deploy, una sola vez, desde el checkout del VPS (mismo patrón que `import-padron.ts`):

```bash
npx tsx scripts/import-estatuto.ts
```

---

## Self-review (hecho al escribir el plan)

- **Cobertura de la spec:** §1 decisiones → Tasks 2/4/7; §2 modelo → Task 1; §3 storage → Task 3; §4 serving → Task 5; §5 admin → Tasks 4/6/7; §6 /mi → Task 8; §7 migración → Task 9; §8 tests → distribuidos + suite final; §9 perímetro → Task 9 Step 4.
- **Placeholders:** ninguno; todo step de código lleva el código.
- **Consistencia de tipos:** `prepareDocumentInput`/`PreparedDocument` (Task 2) se consumen tal cual en Task 4; `saveInstitutionalDocument` devuelve `{fileName, size}` y las actions lo usan así; `initialDocumentosTab`/`tabForType` idénticos entre Tasks 4/6/7.
