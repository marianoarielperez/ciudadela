# /admin/actas Visual Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the four `/admin/actas` screens (card grid grouped by year, full-reference detail, polished forms) and add a PDF+Word "Constancia de asientos" export, without touching money code, picker queries, or the Prisma schema.

**Architecture:** The section stays a leaf of the dependency graph. New pure modules under `src/lib/minutes/` (filters, reference counts, export content) feed the screens and two renderers (pdf-lib + docx); a single authenticated route handler serves both formats with per-download audit. Screens follow the panel canon: PageHeader, segmented chips, GET filter forms, `PaginationNav`, stretched-link cards, `PanelHeader`, synced fields.

**Tech Stack:** Next.js 16 App Router (RSC), TypeScript, Prisma (read-only here), Tailwind v4 tokens, lucide-react, pdf-lib (existing), **docx (new dependency)**, vitest + renderToStaticMarkup.

**Spec:** `docs/superpowers/specs/2026-08-29-actas-visual-design.md` — read it first. The premise: a `Minute` is the record of what happened THROUGH the system; the export is an input for drafting the real acta in the paper book.

## Global Constraints

- Work on branch `actas-visual` off `main`.
- UI copy in Spanish es-AR ("vos", DD/MM/AAAA, `formatARS`); code, identifiers and commits in English. End every commit message with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` (blank line before it).
- **DO NOT modify:** `prisma/schema.prisma`, anything under `prisma/migrations/`, `src/lib/treasury/**`, `src/lib/mp/**`, `src/lib/members/minute-form.ts`, `src/lib/members/minute-edit.ts`, `src/lib/members/minute-choice.ts`, `src/lib/members/minute-date.ts`, `src/lib/members/labels.ts`, `src/components/admin/minute-picker.tsx`, `src/app/admin/actas/actions.ts`, `src/lib/board/notice-pdf.ts` (it is a MOLDE: read it, copy patterns, never edit or import from it).
- **DO NOT change** any of the 10 `prisma.minute.findMany({ orderBy: [{date:"desc"},{id:"desc"}], take: 30 })` picker queries in other screens. The listing's own query is private to its page.
- **DO NOT add** delete functionality for actas, new searchParams contracts on existing URLs, or changes to the `redirect()` targets in `actions.ts` (`/admin/actas` and `/admin/actas/${minuteId}`).
- Existing test files must pass **without editing a single assertion**: `tests/minute-actions.test.ts`, `tests/minute-edit.test.ts`, `tests/minute-choice.test.ts`, `tests/minute-form.test.ts`, `tests/reregistration-close-minute.test.ts`, `tests/admin-nav.test.ts`, `tests/exemption-member-card-screen.test.ts`.
- Never `outline-none`: the token is `outline-hidden` + `focus-visible:ring-*`. Touch targets ≥44px (`min-h-11`) on primary controls. Numbers in `font-mono tabular-nums`.
- All Minute dates are stored at **noon UTC of the Argentine civil day** (`parseMinuteDate`), so `date.getUTCFullYear()` IS the civil year — no timezone math needed.
- Audit `detail` payloads carry metadata only (ids, enums, counts) — never names or DNIs (Ley 25.326, same rule as `minuteEditAuditDetail`).

---

### Task 1: Branch + baseline screen test (the safety net)

The four actas screens have zero render tests today. Write the net BEFORE redesigning: assert only **invariants that must survive** (hrefs, names, the date lock), not current markup.

**Files:**
- Create: `tests/actas-screen.test.ts`

**Interfaces:**
- Produces: a test file that must pass before AND after every later task. Later tasks extend it; they never weaken these assertions.

- [ ] **Step 1: Create the branch**

```bash
git checkout main && git checkout -b actas-visual
```

- [ ] **Step 2: Write the baseline test**

```ts
// tests/actas-screen.test.ts
// Red de seguridad del rediseño de /admin/actas: fija los INVARIANTES que
// cualquier versión de estas pantallas tiene que sostener — los hrefs que otras
// nueve pantallas y los tests de regresión esperan, el nombre del acta por
// tipo+número (nunca el id), y el bloqueo de fecha en edición. No fija markup:
// el rediseño puede cambiar todo lo demás.
//
// Prisma y las actions se mockean: importarlas de verdad arrastra `@/lib/prisma`,
// que tira al evaluarse sin DATABASE_URL (regla del repo).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = {
  minute: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    count: vi.fn(),
    groupBy: vi.fn(),
  },
};
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/app/admin/actas/actions", () => ({
  createMinuteAction: vi.fn(),
  updateMinuteAction: vi.fn(),
}));

import ActasPage from "@/app/admin/actas/page";
import ActaPage from "@/app/admin/actas/[id]/page";
import EditarActaPage from "@/app/admin/actas/[id]/editar/page";
import { MinuteEditForm } from "@/app/admin/actas/[id]/editar/minute-edit-form";

const render = renderToStaticMarkup;

// _count superset: la versión vieja lee `movements`; la rediseñada lee las
// siete relaciones. Un fixture con todas sirve a las dos.
const COUNTS = {
  movements: 2, applications: 0, feeValues: 0, booksOpened: 0, booksClosed: 0,
  processesCalled: 0, processesClosed: 0,
};
const LIST = [
  { id: 16, type: "board", number: 124, date: new Date(Date.UTC(2026, 7, 15, 12)),
    description: "Exención de cuota del socio 7", _count: COUNTS },
  { id: 3, type: "assembly", number: 2, date: new Date(Date.UTC(2025, 2, 10, 12)),
    description: null, _count: { ...COUNTS, movements: 0 } },
];

// Fixture del detalle: superset con las relaciones que la versión rediseñada
// incluye vacías. La vieja sólo mira movements/description/type/number/date/id.
const DETAIL = {
  id: 16, type: "board", number: 124, date: new Date(Date.UTC(2026, 7, 15, 12)),
  description: "Exención de cuota del socio 7",
  movements: [
    { id: 1, type: "fee_exemption", memberId: 7, member: { fullName: "Juana Molina" } },
    { id: 2, type: "admission", memberId: 9, member: { fullName: "Ana Paz" } },
  ],
  applications: [], feeValues: [], booksOpened: [], booksClosed: [],
  processesCalled: [], processesClosed: [],
  _count: { movements: 2, booksOpened: 0, booksClosed: 0 },
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.minute.findMany.mockResolvedValue(LIST);
  prismaMock.minute.count.mockResolvedValue(LIST.length);
  prismaMock.minute.groupBy.mockResolvedValue([
    { type: "board", _count: { _all: 1 } },
    { type: "assembly", _count: { _all: 1 } },
  ]);
  prismaMock.minute.findUnique.mockResolvedValue(DETAIL);
});

describe("listado: invariantes que el rediseño no puede romper", () => {
  it("linkea al detalle de cada acta y al alta", async () => {
    const html = render(await ActasPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('href="/admin/actas/16"');
    expect(html).toContain('href="/admin/actas/3"');
    expect(html).toContain('href="/admin/actas/nueva"');
  });

  it("nombra las actas por tipo y número, nunca por id", async () => {
    const html = render(await ActasPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("Comisión Directiva");
    expect(html).toContain("Asamblea");
    expect(html).toContain("124");
  });
});

describe("detalle: invariantes", () => {
  const props = { params: Promise.resolve({ id: "16" }) };

  it("linkea a la ficha de cada socio asentado y a editar", async () => {
    const html = render(await ActaPage(props));
    expect(html).toContain('href="/admin/socios/7"');
    expect(html).toContain('href="/admin/socios/9"');
    expect(html).toContain('href="/admin/actas/16/editar"');
    expect(html).toContain("Juana Molina");
  });

  it("nombra el acta por tipo y número", async () => {
    const html = render(await ActaPage(props));
    expect(html).toContain("Comisión Directiva N° 124");
  });
});

describe("edición: el bloqueo de fecha sobrevive al rediseño", () => {
  const minute = {
    id: 16, type: "board", number: 124, date: "2026-08-15",
    description: "Exención de cuota del socio 7",
  };

  it("con movimientos, la fecha viaja en un hidden y el campo se ve bloqueado", () => {
    const html = render(
      createElement(MinuteEditForm, { minute, dateLocked: true, movementCount: 2 }),
    );
    expect(html).toContain('name="date"');
    expect(html).toContain('value="2026-08-15"');
    expect(html).toContain("disabled");
    expect(html).toContain("antigüedad estatutaria");
  });

  it("sin movimientos la fecha es editable", () => {
    const html = render(
      createElement(MinuteEditForm, { minute, dateLocked: false, movementCount: 0 }),
    );
    expect(html).toContain('name="date"');
    expect(html).not.toContain("antigüedad estatutaria");
  });

  it("la pantalla explica por qué no hay borrado", async () => {
    const html = render(await EditarActaPage({ params: Promise.resolve({ id: "16" }) }));
    expect(html).toContain("no se eliminan");
    expect(html).not.toContain("Eliminar");
  });
});
```

- [ ] **Step 3: Run it against the CURRENT screens — must pass already**

Run: `npx vitest run tests/actas-screen.test.ts`
Expected: PASS (all green). If anything fails, the fixture is wrong — fix the fixture, not the screens.

- [ ] **Step 4: Run the regression suite once to record the starting point**

Run: `npx vitest run tests/minute-actions.test.ts tests/minute-edit.test.ts tests/minute-choice.test.ts tests/minute-form.test.ts tests/reregistration-close-minute.test.ts tests/admin-nav.test.ts tests/exemption-member-card-screen.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/actas-screen.test.ts
git commit -m "test(actas): baseline screen invariants before the redesign"
```

---

### Task 2: Pure filter + reference-count modules

**Files:**
- Create: `src/lib/minutes/filters.ts`
- Create: `src/lib/minutes/references.ts`
- Test: `tests/minutes-filters.test.ts`

**Interfaces:**
- Consumes: `MinuteType` from `@/generated/prisma/client` (type-only import — keeps the module pure and importable in node tests without `.env`).
- Produces (used by Tasks 7–8):
  - `ACTAS_BASE = "/admin/actas"`, `ACTAS_PAGE_SIZE = 20`
  - `parseActasFilters(sp): ActasFilters` with `ActasFilters = { tipo: MinuteType | null; anio: number | null; q: string | null }`
  - `actasWhere(f): Record<string, unknown>` (plain object passed to Prisma)
  - `actasFilterParams(f): Record<string, string | undefined>` (for `pageHref`)
  - `activeChip(f): "todas" | "board" | "assembly" | null`
  - `yearOf(date: Date): number`, `groupByYear<T extends { date: Date }>(rows: T[]): Array<{ year: number; rows: T[] }>`
  - `REFERENCE_COUNT_SELECT` (the `_count.select` object), `referenceCount(c): number`, `referenceCountLabel(n): string`

- [ ] **Step 1: Write the failing test**

```ts
// tests/minutes-filters.test.ts
import { describe, expect, it } from "vitest";
import {
  actasFilterParams, actasWhere, activeChip, groupByYear, parseActasFilters, yearOf,
} from "@/lib/minutes/filters";
import { referenceCount, referenceCountLabel } from "@/lib/minutes/references";

describe("parseActasFilters", () => {
  it("ignores garbage and trims the query", () => {
    expect(parseActasFilters({})).toEqual({ tipo: null, anio: null, q: null });
    expect(parseActasFilters({ tipo: "x", anio: "abc", q: "  " }))
      .toEqual({ tipo: null, anio: null, q: null });
    expect(parseActasFilters({ tipo: "board", anio: "2026", q: " 124 " }))
      .toEqual({ tipo: "board", anio: 2026, q: "124" });
  });

  it("takes the first value of repeated params", () => {
    expect(parseActasFilters({ tipo: ["assembly", "board"] }).tipo).toBe("assembly");
  });
});

describe("actasWhere", () => {
  it("filters the civil year via UTC bounds (dates are stored at noon UTC)", () => {
    const w = actasWhere({ tipo: null, anio: 2026, q: null }) as {
      date: { gte: Date; lt: Date };
    };
    expect(w.date.gte.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(w.date.lt.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("a numeric query matches the number OR the description", () => {
    const w = actasWhere({ tipo: null, anio: null, q: "124" }) as { OR: unknown[] };
    expect(w.OR).toEqual([{ number: 124 }, { description: { contains: "124" } }]);
  });

  it("a text query only searches the description", () => {
    const w = actasWhere({ tipo: null, anio: null, q: "exención" }) as { OR: unknown[] };
    expect(w.OR).toEqual([{ description: { contains: "exención" } }]);
  });

  it("combines type with the rest", () => {
    expect(actasWhere({ tipo: "board", anio: null, q: null })).toEqual({ type: "board" });
  });
});

describe("activeChip", () => {
  it("chips only light up when they filter exactly what they count", () => {
    expect(activeChip({ tipo: null, anio: null, q: null })).toBe("todas");
    expect(activeChip({ tipo: "board", anio: null, q: null })).toBe("board");
    expect(activeChip({ tipo: "board", anio: 2026, q: null })).toBeNull();
    expect(activeChip({ tipo: null, anio: null, q: "algo" })).toBeNull();
  });
});

describe("groupByYear", () => {
  it("keeps the incoming order and cuts on UTC year", () => {
    const rows = [
      { date: new Date(Date.UTC(2026, 11, 31, 12)) },
      { date: new Date(Date.UTC(2026, 0, 1, 12)) },
      { date: new Date(Date.UTC(2025, 5, 1, 12)) },
    ];
    const groups = groupByYear(rows);
    expect(groups.map((g) => g.year)).toEqual([2026, 2025]);
    expect(groups[0].rows).toHaveLength(2);
    expect(yearOf(rows[2].date)).toBe(2025);
  });
});

describe("references", () => {
  it("counts the seven non-overlapping relations", () => {
    expect(referenceCount({
      movements: 2, applications: 1, feeValues: 1, booksOpened: 0, booksClosed: 1,
      processesCalled: 0, processesClosed: 1,
    })).toBe(6);
  });

  it("labels in es-AR", () => {
    expect(referenceCountLabel(0)).toBe("Sin asientos");
    expect(referenceCountLabel(1)).toBe("1 asiento");
    expect(referenceCountLabel(5)).toBe("5 asientos");
  });
});

describe("actasFilterParams", () => {
  it("serializes only the active filters", () => {
    expect(actasFilterParams({ tipo: "board", anio: 2026, q: null }))
      .toEqual({ tipo: "board", anio: "2026", q: undefined });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/minutes-filters.test.ts`
Expected: FAIL — cannot resolve `@/lib/minutes/filters`.

- [ ] **Step 3: Implement both modules**

```ts
// src/lib/minutes/filters.ts
// Filtros del LISTADO de /admin/actas, puros y sin Prisma: la pantalla los usa
// para armar el `where` y los links; el test los ejercita sin base.
//
// Regla dura del rediseño (mapa de riesgo): esta es la query de la PANTALLA.
// Los diez MinutePicker del panel tienen su propia consulta
// (`orderBy [{date:"desc"},{id:"desc"}], take: 30`) y NO comparten nada de acá.
import type { MinuteType } from "@/generated/prisma/client";

export const ACTAS_BASE = "/admin/actas";
export const ACTAS_PAGE_SIZE = 20;

export type ActasFilters = {
  tipo: MinuteType | null;
  anio: number | null;
  q: string | null;
};

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export function parseActasFilters(
  sp: Record<string, string | string[] | undefined>,
): ActasFilters {
  const tipoRaw = one(sp.tipo);
  const tipo = tipoRaw === "board" || tipoRaw === "assembly" ? tipoRaw : null;
  const anioN = Number(one(sp.anio));
  const anio = Number.isInteger(anioN) && anioN >= 1900 && anioN <= 2100 ? anioN : null;
  const qRaw = (one(sp.q) ?? "").trim();
  const q = qRaw === "" ? null : qRaw.slice(0, 100);
  return { tipo, anio, q };
}

/** El `where` de la pantalla. Las fechas de las actas se guardan al MEDIODÍA
 *  UTC del día civil argentino (`parseMinuteDate`), así que el año civil ES el
 *  año UTC y el filtro por año no necesita aritmética de zona horaria. */
export function actasWhere(f: ActasFilters): Record<string, unknown> {
  const where: Record<string, unknown> = {};
  if (f.tipo) where.type = f.tipo;
  if (f.anio) {
    where.date = {
      gte: new Date(Date.UTC(f.anio, 0, 1)),
      lt: new Date(Date.UTC(f.anio + 1, 0, 1)),
    };
  }
  if (f.q) {
    // Un número busca el N° del acta y también el texto ("124" puede estar en
    // una descripción); texto puro sólo busca la descripción.
    where.OR = /^\d+$/.test(f.q)
      ? [{ number: Number(f.q) }, { description: { contains: f.q } }]
      : [{ description: { contains: f.q } }];
  }
  return where;
}

/** Para `pageHref`: la paginación conserva los filtros vigentes. */
export function actasFilterParams(f: ActasFilters): Record<string, string | undefined> {
  return {
    tipo: f.tipo ?? undefined,
    anio: f.anio ? String(f.anio) : undefined,
    q: f.q ?? undefined,
  };
}

/** Qué chip está prendido, mirando los filtros YA parseados (regla del padrón:
 *  cada chip filtra exactamente lo que cuenta). Con búsqueda o año activos no
 *  se prende ninguno: el conteo del chip es global y ya no coincide. */
export function activeChip(f: ActasFilters): "todas" | MinuteType | null {
  if (f.q || f.anio) return null;
  return f.tipo ?? "todas";
}

export function yearOf(date: Date): number {
  return date.getUTCFullYear();
}

/** Agrupa filas YA ordenadas por fecha descendente en bloques por año civil.
 *  No reordena: el orden lo decide la query de la pantalla. */
export function groupByYear<T extends { date: Date }>(
  rows: T[],
): Array<{ year: number; rows: T[] }> {
  const groups: Array<{ year: number; rows: T[] }> = [];
  for (const row of rows) {
    const year = yearOf(row.date);
    const last = groups[groups.length - 1];
    if (last && last.year === year) last.rows.push(row);
    else groups.push({ year, rows: [row] });
  }
  return groups;
}
```

```ts
// src/lib/minutes/references.ts
// Cuántas cosas respalda un acta, contadas SIN duplicar.
//
// Las exenciones (`feeExemptions` / `feeExemptionsRevoked`) no se cuentan ni se
// listan aparte a propósito: conceder y anular escriben también un `Movement`
// (`fee_exemption` / `fee_exemption_revoked`) con la misma acta, así que ya
// están representadas en `movements` — sumarlas otra vez contaría el mismo
// hecho dos veces. `discardUnusedMinute` sí las chequea aparte, pero ese es un
// resguardo de integridad, no un conteo para mostrar.
export const REFERENCE_COUNT_SELECT = {
  movements: true,
  applications: true,
  feeValues: true,
  booksOpened: true,
  booksClosed: true,
  processesCalled: true,
  processesClosed: true,
} as const;

export type ReferenceCounts = Record<keyof typeof REFERENCE_COUNT_SELECT, number>;

export function referenceCount(c: ReferenceCounts): number {
  return (
    c.movements + c.applications + c.feeValues + c.booksOpened + c.booksClosed +
    c.processesCalled + c.processesClosed
  );
}

export function referenceCountLabel(n: number): string {
  if (n === 0) return "Sin asientos";
  return n === 1 ? "1 asiento" : `${n} asientos`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/minutes-filters.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/minutes/filters.ts src/lib/minutes/references.ts tests/minutes-filters.test.ts
git commit -m "feat(actas): pure filter and reference-count modules for the listing"
```

---

### Task 3: Export content — the shared, transcribable wording

One pure module builds the whole document model; the PDF and Word renderers consume it and cannot diverge (the `coverageFloor` lesson).

**Files:**
- Create: `src/lib/minutes/export-content.ts`
- Test: `tests/minute-export-content.test.ts`

**Interfaces:**
- Consumes: `CATEGORY_LABELS`, `REASON_LABELS`, `minuteName` from `@/lib/members/labels`; `formatARS`, `formatDateAR` from `@/lib/format`.
- Produces (used by Tasks 4, 5, 6):
  - `MinuteExportInput` (see code — plain data, `generatedAt` injected: no clock reads in pure modules)
  - `MinuteExportModel = { title: string; minuteLabel: string; description: string | null; sections: Array<{ heading: string; lines: string[] }>; totalLine: string; footer: string; fileBase: string }`
  - `minuteExportModel(input: MinuteExportInput): MinuteExportModel`

- [ ] **Step 1: Write the failing test**

```ts
// tests/minute-export-content.test.ts
import { describe, expect, it } from "vitest";
import { minuteExportModel, type MinuteExportInput } from "@/lib/minutes/export-content";

const BASE: MinuteExportInput = {
  type: "board", number: 124, date: new Date(Date.UTC(2026, 7, 15, 12)),
  description: null, movements: [], feeValues: [], applications: [],
  booksOpened: [], booksClosed: [], processesCalled: [], processesClosed: [],
  generatedAt: new Date(Date.UTC(2026, 7, 29, 12)),
};

const WHO = {
  member: { fullName: "Juana Molina", dni: "12345678" },
  memberNumber: 45, previousCategory: null, newCategory: null, reason: null,
};

describe("renglones transcribibles por tipo de movimiento", () => {
  const line = (mv: Partial<(typeof BASE)["movements"][number]> & { type: string }) => {
    const model = minuteExportModel({
      ...BASE,
      movements: [{ ...WHO, ...mv } as (typeof BASE)["movements"][number]],
    });
    return model.sections[0].lines[0];
  };

  it("alta, con DNI formateado y número de socio", () => {
    expect(line({ type: "admission" }))
      .toBe("Se asentó el alta de Juana Molina (DNI 12.345.678, socio N° 45).");
  });

  it("baja con motivo en minúscula", () => {
    expect(line({ type: "withdrawal", reason: "resignation" }))
      .toBe("Se asentó la baja de Juana Molina (DNI 12.345.678, socio N° 45), por renuncia.");
  });

  it("cambio de categoría nombra las dos", () => {
    expect(line({ type: "category_change", previousCategory: "adherent", newCategory: "active" }))
      .toBe("Se asentó el cambio de categoría de Juana Molina (DNI 12.345.678, socio N° 45): de Adherente a Activo.");
  });

  it("exención y anulación", () => {
    expect(line({ type: "fee_exemption" }))
      .toBe("Se asentó la exención de cuota de Juana Molina (DNI 12.345.678, socio N° 45).");
    expect(line({ type: "fee_exemption_revoked" }))
      .toBe("Se asentó la anulación de la exención de cuota de Juana Molina (DNI 12.345.678, socio N° 45).");
  });

  it("sin DNI y sin número de socio degrada con honestidad", () => {
    const model = minuteExportModel({
      ...BASE,
      movements: [{ ...WHO, member: { fullName: "Ana Paz", dni: null }, memberNumber: null,
        type: "admission" } as (typeof BASE)["movements"][number]],
    });
    expect(model.sections[0].lines[0]).toBe("Se asentó el alta de Ana Paz (sin DNI).");
  });
});

describe("las demás clases de asiento", () => {
  it("valor de cuota con montos ARS y vigencia", () => {
    const model = minuteExportModel({
      ...BASE,
      feeValues: [{ activeAmount: 5000, sharedAmount: 3500,
        validFrom: new Date(Date.UTC(2026, 8, 1, 12)) }],
    });
    expect(model.sections[0].heading).toBe("Valores de cuota");
    expect(model.sections[0].lines[0]).toBe(
      "Se fijó el valor de la cuota social en $ 5.000,00 (activos) y $ 3.500,00 " +
        "(adherentes y colaboradores), con vigencia desde el 01/09/2026.",
    );
  });

  it("solicitud asentada y rechazada", () => {
    const model = minuteExportModel({
      ...BASE,
      applications: [
        { fullName: "Ana Paz", dni: "30111222", status: "rejected" },
        { fullName: "Luis Sosa", dni: "28000111", status: "completed" },
      ],
    });
    expect(model.sections[0].lines).toEqual([
      "Se rechazó la solicitud de asociación de Ana Paz (DNI 30.111.222).",
      "Se asentó la solicitud de asociación de Luis Sosa (DNI 28.000.111).",
    ]);
  });

  it("libros y re-empadronamiento", () => {
    const model = minuteExportModel({
      ...BASE,
      booksOpened: [{ number: 2 }], booksClosed: [{ number: 1 }],
      processesCalled: [{ bookNumber: 1 }], processesClosed: [{ bookNumber: 1 }],
    });
    const lines = model.sections.flatMap((s) => s.lines);
    expect(lines).toContain("Se dispuso la apertura del Libro de Socios N° 2.");
    expect(lines).toContain("Se dispuso el cierre del Libro de Socios N° 1.");
    expect(lines).toContain("Se convocó al re-empadronamiento de los socios del Libro N° 1.");
    expect(lines).toContain("Se cerró el proceso de re-empadronamiento del Libro N° 1.");
  });
});

describe("el modelo del documento", () => {
  it("título, etiqueta del acta, total, pie y nombre de archivo", () => {
    const model = minuteExportModel({ ...BASE, movements: [
      { ...WHO, type: "admission" } as (typeof BASE)["movements"][number],
    ] });
    expect(model.title).toBe("Constancia de asientos del sistema");
    expect(model.minuteLabel).toBe("Comisión Directiva N° 124 — 15/08/2026");
    expect(model.totalLine).toBe("1 asiento registrado en el sistema bajo esta acta.");
    expect(model.footer).toContain("Generada por SIGeV el 29/08/2026");
    expect(model.footer).toContain("para incorporar al acta del libro");
    expect(model.fileBase).toBe("acta-cd-124");
  });

  it("una asamblea sin asientos", () => {
    const model = minuteExportModel({ ...BASE, type: "assembly", number: 3 });
    expect(model.fileBase).toBe("acta-asamblea-3");
    expect(model.sections).toEqual([]);
    expect(model.totalLine).toBe("Sin asientos registrados en el sistema bajo esta acta.");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/minute-export-content.test.ts`
Expected: FAIL — cannot resolve `@/lib/minutes/export-content`.

- [ ] **Step 3: Implement**

```ts
// src/lib/minutes/export-content.ts
// El CONTENIDO de la "Constancia de asientos del sistema", como función pura.
//
// Por qué existe: el acta del sistema es la constancia de lo que pasó POR el
// sistema. La Comisión decide muchas cosas que el sistema no ve, y en el acta
// real del libro vuelca esas decisiones MÁS estos asientos. Este módulo redacta
// cada asiento como un renglón transcribible —"Se asentó el alta de …"— para
// que la secretaría lo copie al acta junto con el resto (estilo del anexo de
// notificaciones del M6). PDF y Word consumen ESTE modelo: una sola redacción,
// dos formatos, sin poder divergir (la lección de `coverageFloor`).
//
// Lleva datos personales completos (nombre, DNI, N° de socio) por decisión del
// operador (spec 29/08/2026): es el insumo de un documento societario formal.
// La contrapartida vive en la ruta: descarga auditada y sin caché.
//
// `generatedAt` se INYECTA: regla del repo para todo lo testeable (nada de
// leer el reloj en módulos puros).
import type {
  ApplicationStatus, MemberCategory, MinuteType, MovementType, WithdrawalReason,
} from "@/generated/prisma/client";
import { formatARS, formatDateAR } from "@/lib/format";
import { CATEGORY_LABELS, REASON_LABELS, minuteName } from "@/lib/members/labels";

export type MinuteExportInput = {
  type: MinuteType;
  number: number;
  date: Date;
  description: string | null;
  movements: Array<{
    type: MovementType;
    member: { fullName: string; dni: string | null };
    /** N° del libro más reciente del socio; null si no tiene membresía. */
    memberNumber: number | null;
    previousCategory: MemberCategory | null;
    newCategory: MemberCategory | null;
    reason: WithdrawalReason | null;
  }>;
  feeValues: Array<{ activeAmount: number; sharedAmount: number; validFrom: Date }>;
  applications: Array<{ fullName: string; dni: string; status: ApplicationStatus }>;
  booksOpened: Array<{ number: number }>;
  booksClosed: Array<{ number: number }>;
  processesCalled: Array<{ bookNumber: number }>;
  processesClosed: Array<{ bookNumber: number }>;
  generatedAt: Date;
};

export type MinuteExportModel = {
  title: string;
  /** "Comisión Directiva N° 124 — 15/08/2026" */
  minuteLabel: string;
  description: string | null;
  sections: Array<{ heading: string; lines: string[] }>;
  totalLine: string;
  footer: string;
  /** "acta-cd-124" — derivado de tipo+número validados, NUNCA de texto libre. */
  fileBase: string;
};

/** "12345678" → "12.345.678". El DNI es una cadena; si trae algo no numérico
 *  (histórico) se muestra tal cual antes que inventar un formato. */
function formatDni(dni: string): string {
  return /^\d+$/.test(dni) ? dni.replace(/\B(?=(\d{3})+(?!\d))/g, ".") : dni;
}

function who(m: {
  member: { fullName: string; dni: string | null };
  memberNumber: number | null;
}): string {
  const parts: string[] = [];
  parts.push(m.member.dni ? `DNI ${formatDni(m.member.dni)}` : "sin DNI");
  if (m.memberNumber !== null) parts.push(`socio N° ${m.memberNumber}`);
  return `${m.member.fullName} (${parts.join(", ")})`;
}

function category(c: MemberCategory | null): string {
  return c ? CATEGORY_LABELS[c] : "—";
}

function movementLine(mv: MinuteExportInput["movements"][number]): string {
  const w = who(mv);
  switch (mv.type) {
    case "admission":
      return `Se asentó el alta de ${w}.`;
    case "withdrawal":
      return mv.reason
        ? `Se asentó la baja de ${w}, por ${REASON_LABELS[mv.reason].toLowerCase()}.`
        : `Se asentó la baja de ${w}.`;
    case "category_change":
      return `Se asentó el cambio de categoría de ${w}: de ${category(mv.previousCategory)} a ${category(mv.newCategory)}.`;
    case "readmission":
      return `Se asentó el reingreso de ${w}.`;
    case "suspension":
      return `Se asentó la suspensión de ${w}.`;
    case "suspension_end":
      return `Se asentó el fin de la suspensión de ${w}.`;
    case "book_migration":
      return `Se asentó la migración de ${w} al libro siguiente.`;
    case "fee_exemption":
      return `Se asentó la exención de cuota de ${w}.`;
    case "fee_exemption_revoked":
      return `Se asentó la anulación de la exención de cuota de ${w}.`;
  }
}

export function minuteExportModel(input: MinuteExportInput): MinuteExportModel {
  const sections: MinuteExportModel["sections"] = [];

  if (input.movements.length > 0) {
    sections.push({
      heading: "Movimientos de socios",
      lines: input.movements.map(movementLine),
    });
  }
  if (input.feeValues.length > 0) {
    sections.push({
      heading: "Valores de cuota",
      lines: input.feeValues.map(
        (v) =>
          `Se fijó el valor de la cuota social en ${formatARS(v.activeAmount)} (activos) y ` +
          `${formatARS(v.sharedAmount)} (adherentes y colaboradores), con vigencia desde el ` +
          `${formatDateAR(v.validFrom)}.`,
      ),
    });
  }
  if (input.applications.length > 0) {
    sections.push({
      heading: "Solicitudes de asociación",
      lines: input.applications.map((a) => {
        const person = `${a.fullName} (DNI ${formatDni(a.dni)})`;
        return a.status === "rejected"
          ? `Se rechazó la solicitud de asociación de ${person}.`
          : `Se asentó la solicitud de asociación de ${person}.`;
      }),
    });
  }
  const bookLines = [
    ...input.booksOpened.map((b) => `Se dispuso la apertura del Libro de Socios N° ${b.number}.`),
    ...input.booksClosed.map((b) => `Se dispuso el cierre del Libro de Socios N° ${b.number}.`),
  ];
  if (bookLines.length > 0) sections.push({ heading: "Libros", lines: bookLines });

  const processLines = [
    ...input.processesCalled.map(
      (p) => `Se convocó al re-empadronamiento de los socios del Libro N° ${p.bookNumber}.`,
    ),
    ...input.processesClosed.map(
      (p) => `Se cerró el proceso de re-empadronamiento del Libro N° ${p.bookNumber}.`,
    ),
  ];
  if (processLines.length > 0) {
    sections.push({ heading: "Re-empadronamiento", lines: processLines });
  }

  const total = sections.reduce((n, s) => n + s.lines.length, 0);
  const totalLine =
    total === 0
      ? "Sin asientos registrados en el sistema bajo esta acta."
      : total === 1
        ? "1 asiento registrado en el sistema bajo esta acta."
        : `${total} asientos registrados en el sistema bajo esta acta.`;

  return {
    title: "Constancia de asientos del sistema",
    minuteLabel: `${minuteName(input)} — ${formatDateAR(input.date)}`,
    description: input.description,
    sections,
    totalLine,
    footer:
      `Generada por SIGeV el ${formatDateAR(input.generatedAt)}. Documento de uso interno: ` +
      "refleja únicamente los asientos registrados en el sistema, para incorporar al acta del libro.",
    fileBase: `acta-${input.type === "board" ? "cd" : "asamblea"}-${input.number}`,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/minute-export-content.test.ts`
Expected: PASS. If the ARS assertions fail on the space character, remember `formatARS` normalizes U+00A0/U+202F to a plain space — copy the expected strings exactly as written here.

- [ ] **Step 5: Commit**

```bash
git add src/lib/minutes/export-content.ts tests/minute-export-content.test.ts
git commit -m "feat(actas): shared transcribable wording for the minute export"
```

---

### Task 4: PDF renderer

Modeled on `src/lib/board/notice-pdf.ts` (READ it first — it is the multi-page molde and already solved wrap, running headers, WinAnsi and page numbering). Per repo convention the molde is read, not imported: `safe()`/`wrap()`/`TYPOGRAPHIC` are re-written here.

**Files:**
- Create: `src/lib/minutes/export-pdf.ts`
- Test: `tests/minute-export-pdf.test.ts`

**Interfaces:**
- Consumes: `MinuteExportModel` from Task 3; `SITE` from `@/lib/site`; `pdf-lib`.
- Produces: `renderMinutePdf(model: MinuteExportModel): Promise<Uint8Array>` (used by Task 6).

- [ ] **Step 1: Write the failing smoke test**

```ts
// tests/minute-export-pdf.test.ts
// Smoke test: que el PDF salga, sea PDF, y pagine. El contenido (la redacción)
// ya está fijado por tests/minute-export-content.test.ts sobre el modelo puro.
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { renderMinutePdf } from "@/lib/minutes/export-pdf";
import type { MinuteExportModel } from "@/lib/minutes/export-content";

const MODEL: MinuteExportModel = {
  title: "Constancia de asientos del sistema",
  minuteLabel: "Comisión Directiva N° 124 — 15/08/2026",
  description: "Exención de cuota — pintura de la sede",
  sections: [
    { heading: "Movimientos de socios",
      lines: ["Se asentó el alta de Juana Molina (DNI 12.345.678, socio N° 45)."] },
  ],
  totalLine: "1 asiento registrado en el sistema bajo esta acta.",
  footer: "Generada por SIGeV el 29/08/2026. Documento de uso interno: refleja únicamente los asientos registrados en el sistema, para incorporar al acta del libro.",
  fileBase: "acta-cd-124",
};

describe("renderMinutePdf", () => {
  it("produce un PDF de una hoja con el título del documento", async () => {
    const bytes = await renderMinutePdf(MODEL);
    expect(bytes.length).toBeGreaterThan(500);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getTitle()).toContain("Constancia de asientos");
  });

  it("con doscientos renglones abre más hojas", async () => {
    const bytes = await renderMinutePdf({
      ...MODEL,
      sections: [{
        heading: "Movimientos de socios",
        lines: Array.from({ length: 200 }, (_, i) =>
          `Se asentó el alta de Socio Número ${i + 1} (DNI 10.000.${String(i).padStart(3, "0")}).`),
      }],
    });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/minute-export-pdf.test.ts`
Expected: FAIL — cannot resolve `@/lib/minutes/export-pdf`.

- [ ] **Step 3: Implement**

```ts
// src/lib/minutes/export-pdf.ts
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
```

Note on the footer loop: if the two-line footer overlaps visually when you verify the PDF by eye in Task 11, simplify to a single `drawText` of the full footer at size 7 — the text fits one A4 line at that size. Do not spend time perfecting it; the footer is metadata.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/minute-export-pdf.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/minutes/export-pdf.ts tests/minute-export-pdf.test.ts
git commit -m "feat(actas): PDF renderer for the minute constancia"
```

---

### Task 5: Word renderer (+ the `docx` dependency)

**Files:**
- Modify: `package.json` (via `npm install docx`)
- Create: `src/lib/minutes/export-docx.ts`
- Test: `tests/minute-export-docx.test.ts`

**Interfaces:**
- Consumes: `MinuteExportModel` from Task 3; `SITE` from `@/lib/site`; `docx` (`Document`, `Packer`, `Paragraph`, `TextRun`).
- Produces: `renderMinuteDocx(model: MinuteExportModel): Promise<Uint8Array>` (used by Task 6).

- [ ] **Step 1: Install the dependency**

```bash
npm install docx
```

Expected: `docx` added to `dependencies` in `package.json`. It is pure JS (no binaries) — safe for the VPS, same criterion as pdf-lib.

- [ ] **Step 2: Write the failing smoke test**

```ts
// tests/minute-export-docx.test.ts
// Smoke test del Word: que salga un .docx válido (ZIP: empieza con "PK") con
// el contenido del modelo adentro. La redacción ya la fija el test del modelo.
import { describe, expect, it } from "vitest";
import { renderMinuteDocx } from "@/lib/minutes/export-docx";
import type { MinuteExportModel } from "@/lib/minutes/export-content";

const MODEL: MinuteExportModel = {
  title: "Constancia de asientos del sistema",
  minuteLabel: "Comisión Directiva N° 124 — 15/08/2026",
  description: null,
  sections: [
    { heading: "Movimientos de socios",
      lines: ["Se asentó el alta de Juana Molina (DNI 12.345.678, socio N° 45)."] },
  ],
  totalLine: "1 asiento registrado en el sistema bajo esta acta.",
  footer: "Generada por SIGeV el 29/08/2026. Documento de uso interno: refleja únicamente los asientos registrados en el sistema, para incorporar al acta del libro.",
  fileBase: "acta-cd-124",
};

describe("renderMinuteDocx", () => {
  it("produce un ZIP OOXML", async () => {
    const bytes = await renderMinuteDocx(MODEL);
    expect(bytes.length).toBeGreaterThan(500);
    expect(bytes[0]).toBe(0x50); // "P"
    expect(bytes[1]).toBe(0x4b); // "K"
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run tests/minute-export-docx.test.ts`
Expected: FAIL — cannot resolve `@/lib/minutes/export-docx`.

- [ ] **Step 4: Implement**

```ts
// src/lib/minutes/export-docx.ts
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
```

If the `docx` version installed rejects `title` at the `Document` root, move it to `new Document({ ... })`'s supported metadata field or drop it — the document body is what matters; do not fight the metadata API.

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run tests/minute-export-docx.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/lib/minutes/export-docx.ts tests/minute-export-docx.test.ts
git commit -m "feat(actas): Word renderer for the minute constancia (new docx dependency)"
```

---

### Task 6: The export route (auth, headers, audit)

Molde: `src/app/api/admin/libros/[numero]/export/route.ts` — READ it first. Same guard, same header discipline, audit with metadata only.

**Files:**
- Create: `src/app/api/admin/actas/[id]/export/route.ts`
- Test: `tests/minute-export-route.test.ts`

**Interfaces:**
- Consumes: `requireAdmin` from `@/lib/auth/require-admin`; `audit` from `@/lib/audit`; `prisma` from `@/lib/prisma`; Task 3 `minuteExportModel`; Task 4 `renderMinutePdf`; Task 5 `renderMinuteDocx`.
- Produces: `GET /api/admin/actas/[id]/export?formato=pdf|docx` (used by Task 8's detail buttons).

- [ ] **Step 1: Write the failing test**

```ts
// tests/minute-export-route.test.ts
// La ruta de descarga de la constancia: guarda, validaciones, cabeceras y el
// asiento de auditoría SIN datos personales (misma aserción de estilo que
// "never copies the description text" en minute-edit).
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdminMock = vi.fn();
vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: requireAdminMock }));

const auditMock = vi.fn();
vi.mock("@/lib/audit", () => ({ audit: auditMock }));

const findUniqueMock = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: { minute: { findUnique: findUniqueMock } },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-real-ip": "10.0.0.9" }),
}));

import { GET } from "@/app/api/admin/actas/[id]/export/route";

const MINUTE = {
  id: 16, type: "board", number: 124, date: new Date(Date.UTC(2026, 7, 15, 12)),
  description: null,
  movements: [{
    type: "admission", previousCategory: null, newCategory: null, reason: null,
    member: { fullName: "Juana Molina", dni: "12345678",
      memberships: [{ memberNumber: 45 }] },
  }],
  applications: [], feeValues: [], booksOpened: [], booksClosed: [],
  processesCalled: [], processesClosed: [],
};

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (formato: string) =>
  new Request(`http://x/api/admin/actas/16/export?formato=${formato}`);

beforeEach(() => {
  vi.clearAllMocks();
  requireAdminMock.mockResolvedValue({ ok: true, actorId: 1 });
  findUniqueMock.mockResolvedValue(MINUTE);
});

describe("guardas", () => {
  it("403 sin admin vivo, sin cabeceras de archivo y sin tocar la base", async () => {
    requireAdminMock.mockResolvedValue({ ok: false, error: "No autorizado" });
    const res = await GET(req("pdf"), params("16"));
    expect(res.status).toBe(403);
    expect(res.headers.get("Content-Disposition")).toBeNull();
    expect(findUniqueMock).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("404 con id inválido, antes de tocar la base", async () => {
    for (const bad of ["abc", "-1", "1.5"]) {
      const res = await GET(req("pdf"), params(bad));
      expect(res.status).toBe(404);
    }
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it("404 con acta inexistente y 400 con formato desconocido", async () => {
    findUniqueMock.mockResolvedValue(null);
    expect((await GET(req("pdf"), params("16"))).status).toBe(404);
    expect((await GET(req("csv"), params("16"))).status).toBe(400);
  });
});

describe("descarga", () => {
  it("PDF: bytes, attachment con nombre derivado de tipo+número, sin caché", async () => {
    const res = await GET(req("pdf"), params("16"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition"))
      .toBe('attachment; filename="acta-cd-124.pdf"');
    expect(res.headers.get("Cache-Control")).toBe("no-store, private");
    expect(res.headers.get("Vary")).toBe("Cookie");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes.length).toBeGreaterThan(500);
  });

  it("Word: content-type OOXML y extensión .docx", async () => {
    const res = await GET(req("docx"), params("16"));
    expect(res.headers.get("Content-Type"))
      .toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(res.headers.get("Content-Disposition"))
      .toBe('attachment; filename="acta-cd-124.docx"');
  });
});

describe("auditoría", () => {
  it("asienta minute_export con metadatos y NUNCA nombres ni DNIs", async () => {
    await GET(req("pdf"), params("16"));
    expect(auditMock).toHaveBeenCalledTimes(1);
    const entry = auditMock.mock.calls[0][0];
    expect(entry).toMatchObject({
      userId: 1, action: "minute_export", entity: "minute", entityId: 16,
      ip: "10.0.0.9",
    });
    expect(entry.detail).toEqual({ type: "board", number: 124, format: "pdf", entries: 1 });
    const serialized = JSON.stringify(entry);
    expect(serialized).not.toContain("Juana");
    expect(serialized).not.toContain("12345678");
  });

  it("no asienta nada si el acta no existe", async () => {
    findUniqueMock.mockResolvedValue(null);
    await GET(req("pdf"), params("16"));
    expect(auditMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/minute-export-route.test.ts`
Expected: FAIL — cannot resolve the route module.

- [ ] **Step 3: Implement the route**

```ts
// src/app/api/admin/actas/[id]/export/route.ts
// Descarga de la "Constancia de asientos del sistema" de un acta, en PDF o
// Word. Molde: el export del libro (`api/admin/libros/[numero]/export`) —
// misma guarda, mismas cabeceras, mismo asiento con metadatos.
//
// El archivo lleva datos personales COMPLETOS (nombre, DNI, N° de socio) por
// decisión del operador (spec 29/08/2026): es el insumo del acta real del
// libro. Por eso: `requireAdmin` acá adentro (el layout no cubre route
// handlers), `no-store, private`, y auditoría por descarga cuyo detail lleva
// SOLO metadatos — nunca los datos de las filas (Ley 25.326, mismo criterio
// que `minuteEditAuditDetail`).
import { headers } from "next/headers";

import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth/require-admin";
import { minuteExportModel } from "@/lib/minutes/export-content";
import { renderMinuteDocx } from "@/lib/minutes/export-docx";
import { renderMinutePdf } from "@/lib/minutes/export-pdf";
import { prisma } from "@/lib/prisma";

const CONTENT_TYPES = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
} as const;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireAdmin();
  if (!actor.ok) return new Response(actor.error, { status: 403 });

  const { id } = await params;
  const minuteId = Number(id);
  if (!Number.isInteger(minuteId) || minuteId <= 0) {
    return new Response("Acta inexistente", { status: 404 });
  }

  const formato = new URL(req.url).searchParams.get("formato");
  if (formato !== "pdf" && formato !== "docx") {
    return new Response("Formato inválido", { status: 400 });
  }

  const minute = await prisma.minute.findUnique({
    where: { id: minuteId },
    include: {
      movements: {
        orderBy: { id: "asc" },
        select: {
          type: true, previousCategory: true, newCategory: true, reason: true,
          member: {
            select: {
              fullName: true, dni: true,
              // El N° de socio vive en la membresía; la del libro más alto es
              // la vigente (o la última que tuvo, si ya migró o es baja).
              memberships: {
                orderBy: { bookId: "desc" }, take: 1,
                select: { memberNumber: true },
              },
            },
          },
        },
      },
      applications: { select: { fullName: true, dni: true, status: true } },
      feeValues: {
        orderBy: { validFrom: "asc" },
        select: { activeAmount: true, sharedAmount: true, validFrom: true },
      },
      booksOpened: { select: { number: true } },
      booksClosed: { select: { number: true } },
      processesCalled: { select: { book: { select: { number: true } } } },
      processesClosed: { select: { book: { select: { number: true } } } },
    },
  });
  if (!minute) return new Response("Acta inexistente", { status: 404 });

  const model = minuteExportModel({
    type: minute.type,
    number: minute.number,
    date: minute.date,
    description: minute.description,
    movements: minute.movements.map((mv) => ({
      type: mv.type,
      member: { fullName: mv.member.fullName, dni: mv.member.dni },
      memberNumber: mv.member.memberships[0]?.memberNumber ?? null,
      previousCategory: mv.previousCategory,
      newCategory: mv.newCategory,
      reason: mv.reason,
    })),
    feeValues: minute.feeValues.map((v) => ({
      activeAmount: Number(v.activeAmount),
      sharedAmount: Number(v.sharedAmount),
      validFrom: v.validFrom,
    })),
    applications: minute.applications,
    booksOpened: minute.booksOpened,
    booksClosed: minute.booksClosed,
    processesCalled: minute.processesCalled.map((p) => ({ bookNumber: p.book.number })),
    processesClosed: minute.processesClosed.map((p) => ({ bookNumber: p.book.number })),
    generatedAt: new Date(),
  });

  const bytes =
    formato === "pdf" ? await renderMinutePdf(model) : await renderMinuteDocx(model);

  // La auditoría va DESPUÉS de tener los bytes: si la generación falla no queda
  // asiento de una descarga que no ocurrió. Metadatos únicamente.
  const ip = (await headers()).get("x-real-ip") ?? "unknown";
  const entries = model.sections.reduce((n, s) => n + s.lines.length, 0);
  await audit({
    userId: actor.actorId,
    action: "minute_export",
    entity: "minute",
    entityId: minute.id,
    detail: { type: minute.type, number: minute.number, format: formato, entries },
    ip,
  });

  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": CONTENT_TYPES[formato],
      "Content-Disposition": `attachment; filename="${model.fileBase}.${formato}"`,
      "Cache-Control": "no-store, private",
      Vary: "Cookie",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/minute-export-route.test.ts`
Expected: PASS (7 tests). If Prisma types complain about the `where` on `memberships`, note we use `orderBy` + `take`, no `where` — copy exactly.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/admin/actas/[id]/export/route.ts tests/minute-export-route.test.ts
git commit -m "feat(actas): audited PDF/Word export route for the minute constancia"
```

---

### Task 7: Listing redesign — cards, chips, year chronology, pagination

Full rewrite of `src/app/admin/actas/page.tsx`. Patterns to imitate (read them first): chips `src/app/admin/socios/page.tsx:41-67,168-183`; stretched-link card `src/app/admin/page.tsx:53-100`; GET filter form `src/app/admin/socios/page.tsx:185-241`; pagination consumers `src/app/admin/tesoreria/recibos/page.tsx`.

**Files:**
- Modify: `src/app/admin/actas/page.tsx` (full replacement)
- Test: extend `tests/actas-screen.test.ts`

**Interfaces:**
- Consumes: Task 2 modules; `parsePage`/`paginate`/`pageHref` from `@/lib/admin/pagination`; `PaginationNav` from `@/components/admin/pagination-nav`; `SELECT_CLASS` from `@/lib/admin/field-styles`; `minuteName`, `MINUTE_TYPE_LABELS` from `@/lib/members/labels`; `Card, CardContent, CardHeader, CardTitle` from `@/components/ui/card`; `Gavel`, `Landmark` from `lucide-react`.
- Produces: the page signature `ActasPage(props: { searchParams: Promise<Record<string, string | string[] | undefined>> })`. URLs: `/admin/actas?tipo=&anio=&q=&page=` (all optional — the bare URL keeps working).

- [ ] **Step 1: Replace the page**

```tsx
// src/app/admin/actas/page.tsx
// El listado de actas, rediseñado (spec 2026-08-29): tarjetas agrupadas por año
// —el gesto de la pantalla: las actas SON la cronología institucional—, chips
// por tipo, búsqueda + año en un GET plano, y paginación de 20.
//
// La query es PRIVADA de esta pantalla (mapa de riesgo): los diez MinutePicker
// del panel usan su propia consulta con otro orden y `take: 30` — no compartir
// jamás. El conteo de la tarjeta suma las SIETE relaciones no solapadas (ver
// `references.ts`): un acta que respalda una exención o un valor de cuota ya no
// se muestra "vacía".
import { Gavel, Landmark } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/admin/empty-state";
import { PageHeader } from "@/components/admin/page-header";
import { PaginationNav } from "@/components/admin/pagination-nav";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SELECT_CLASS } from "@/lib/admin/field-styles";
import { pageHref, paginate, parsePage } from "@/lib/admin/pagination";
import { cn } from "@/lib/utils";
import { formatDateAR } from "@/lib/format";
import { minuteName } from "@/lib/members/labels";
import {
  ACTAS_BASE, ACTAS_PAGE_SIZE, actasFilterParams, actasWhere, activeChip,
  groupByYear, parseActasFilters, yearOf, type ActasFilters,
} from "@/lib/minutes/filters";
import { REFERENCE_COUNT_SELECT, referenceCount, referenceCountLabel } from "@/lib/minutes/references";
import { prisma } from "@/lib/prisma";
import type { MinuteType } from "@/generated/prisma/client";

export const dynamic = "force-dynamic";

export const metadata = { title: "Actas — SIGeV" };

// Mismo segmented que el padrón: el chip es un LINK con el filtro en la URL.
const CHIP_BASE =
  "inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-medium outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-ring";
const CHIP_ACTIVE = "bg-background text-foreground shadow-sm";
const CHIP_INACTIVE = "text-muted-foreground hover:text-foreground";

const CHIPS: Array<{ key: "todas" | MinuteType; label: string; href: string }> = [
  { key: "todas", label: "Todas", href: ACTAS_BASE },
  { key: "board", label: "Comisión Directiva", href: `${ACTAS_BASE}?tipo=board` },
  { key: "assembly", label: "Asambleas", href: `${ACTAS_BASE}?tipo=assembly` },
];

const TYPE_ICONS = { board: Gavel, assembly: Landmark } as const;

type Search = Record<string, string | string[] | undefined>;

export default async function ActasPage(props: { searchParams: Promise<Search> }) {
  const sp = (await props.searchParams) ?? {};
  const filters = parseActasFilters(sp);
  const where = actasWhere(filters);

  const total = await prisma.minute.count({ where });
  const { page, pageCount, skip, take } = paginate(total, parsePage(sp), ACTAS_PAGE_SIZE);

  const [minutes, typeCounts, yearRows] = await Promise.all([
    prisma.minute.findMany({
      where,
      orderBy: [{ date: "desc" }, { number: "desc" }],
      skip,
      take,
      include: { _count: { select: REFERENCE_COUNT_SELECT } },
    }),
    // Conteos GLOBALES por tipo: los chips resetean búsqueda y año, así que
    // cuentan el universo entero — cada chip filtra exactamente lo que cuenta.
    prisma.minute.groupBy({ by: ["type"], _count: { _all: true } }),
    // Los años con actas, para el select. A escala de decenas esta segunda
    // consulta liviana es más simple que un raw SQL.
    prisma.minute.findMany({ select: { date: true }, orderBy: { date: "desc" } }),
  ]);

  const countByType: Record<string, number> = {};
  for (const row of typeCounts) countByType[row.type] = row._count._all;
  const chipCounts = {
    todas: (countByType.board ?? 0) + (countByType.assembly ?? 0),
    board: countByType.board ?? 0,
    assembly: countByType.assembly ?? 0,
  };
  const years = [...new Set(yearRows.map((r) => yearOf(r.date)))];
  const chip = activeChip(filters);
  const hasFilters = filters.tipo !== null || filters.anio !== null || filters.q !== null;
  const groups = groupByYear(minutes);
  const firstShown = total === 0 ? 0 : skip + 1;
  const lastShown = skip + minutes.length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Actas"
        actions={<Button asChild size="lg" className="min-h-11 px-4"><Link href="/admin/actas/nueva">Nueva acta</Link></Button>}
      >
        <p className="max-w-3xl text-sm text-muted-foreground">
          El registro de lo asentado por el sistema bajo cada acta, para incorporar al libro
          de actas junto con el resto de las decisiones de la Comisión.
        </p>
      </PageHeader>

      <nav aria-label="Actas por tipo" className="flex w-fit max-w-full flex-wrap gap-1 rounded-lg bg-muted p-1">
        {CHIPS.map(({ key, label, href }) => (
          <Link
            key={key}
            href={href}
            aria-current={chip === key ? "page" : undefined}
            className={cn(CHIP_BASE, chip === key ? CHIP_ACTIVE : CHIP_INACTIVE)}
          >
            {label}
            <span className="font-mono tabular-nums">{chipCounts[key]}</span>
          </Link>
        ))}
      </nav>

      {/* GET plano, como el resto del panel: el filtro queda en la URL y se
          puede compartir, recargar y volver con el botón atrás. */}
      <form className="flex flex-wrap items-end gap-2" method="get">
        <Input
          name="q"
          placeholder="Número o texto de la descripción"
          defaultValue={filters.q ?? ""}
          aria-label="Buscar actas"
          className="w-full sm:w-64"
        />
        <select
          name="anio"
          defaultValue={filters.anio ? String(filters.anio) : ""}
          className={cn(SELECT_CLASS, "max-w-full")}
          aria-label="Año"
        >
          <option value="">Todos los años</option>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        {filters.tipo && <input type="hidden" name="tipo" value={filters.tipo} />}
        <Button type="submit" variant="secondary" className="min-h-11">Filtrar</Button>
        {hasFilters && (
          <Button asChild variant="outline" className="min-h-11">
            <Link href={ACTAS_BASE}>Limpiar filtros</Link>
          </Button>
        )}
      </form>

      {total === 0 ? (
        hasFilters ? (
          <EmptyState
            description="Ninguna acta coincide con ese filtro."
            action={<Button asChild variant="outline"><Link href={ACTAS_BASE}>Limpiar filtros</Link></Button>}
          />
        ) : (
          <EmptyState
            description="Todavía no hay actas cargadas. Las acciones societarias (altas, bajas, cambios de categoría) se asientan siempre en un acta."
            action={<Button asChild><Link href="/admin/actas/nueva">Nueva acta</Link></Button>}
          />
        )
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {`${firstShown}–${lastShown} de ${total === 1 ? "1 acta" : `${total} actas`}`}
            {pageCount > 1 && ` · página ${page} de ${pageCount}`}
          </p>

          {groups.map((group) => (
            <section key={group.year} aria-labelledby={`anio-${group.year}`} className="space-y-3">
              {/* El gesto de la pantalla: el año como marca tipográfica de la
                  cronología del libro. El conteo es del AÑO EN ESTA PÁGINA: un
                  año partido por la paginación repite su encabezado enfrente. */}
              <div className="flex items-baseline gap-3">
                <h2
                  id={`anio-${group.year}`}
                  className="font-heading text-3xl font-semibold tracking-tight text-muted-foreground"
                >
                  {group.year}
                </h2>
                <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  {group.rows.length === 1 ? "1 acta" : `${group.rows.length} actas`}
                </span>
                <div aria-hidden className="h-px flex-1 bg-border" />
              </div>
              <ul className="grid list-none gap-4 p-0 sm:grid-cols-2 lg:grid-cols-3">
                {group.rows.map((m) => {
                  const Icon = TYPE_ICONS[m.type];
                  const count = referenceCount(m._count);
                  return (
                    <li key={m.id}>
                      <Card size="sm" className="relative h-full transition-shadow hover:shadow-md">
                        <CardHeader className="gap-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                              <Icon aria-hidden className="size-5" />
                            </span>
                            <span className="text-xs text-muted-foreground">{formatDateAR(m.date)}</span>
                          </div>
                          <CardTitle as="h3">
                            {/* Un solo link semántico, estirado a la tarjeta
                                entera (patrón del tablero /admin). */}
                            <Link
                              href={`/admin/actas/${m.id}`}
                              className="outline-hidden after:absolute after:inset-0 after:rounded-xl after:ring-ring after:ring-inset focus-visible:after:ring-2"
                            >
                              {minuteName(m)}
                            </Link>
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-2">
                          {m.description ? (
                            <p className="line-clamp-2 text-sm text-muted-foreground">{m.description}</p>
                          ) : (
                            <p className="text-sm text-muted-foreground/70">Sin descripción.</p>
                          )}
                          <p className="text-xs font-medium text-muted-foreground">
                            {referenceCountLabel(count)}
                          </p>
                        </CardContent>
                      </Card>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}

          <PaginationNav
            page={page}
            pageCount={pageCount}
            href={(n) => pageHref(ACTAS_BASE, actasFilterParams(filters), n)}
            label="Páginas de actas"
          />
        </>
      )}
    </div>
  );
}
```

Notes:
- `cn` lives at `@/lib/utils` — verify the import path against any existing screen (e.g. `src/app/admin/socios/page.tsx`) and match it.
- The chips reset `q`/`anio` on purpose (fixed hrefs, same as the padrón); the year `<select>` preserves `tipo` via the hidden input.
- The `?tipo=`/`?anio=`/`?q=`/`?page=` params are NEW — no external screen links to them, so no contract is broken (the bare `/admin/actas` renders page 1 unfiltered).

- [ ] **Step 2: Extend the screen test**

Append to `tests/actas-screen.test.ts`:

```ts
describe("listado rediseñado", () => {
  it("agrupa por año con encabezado y conteo", async () => {
    const html = render(await ActasPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain(">2026<");
    expect(html).toContain(">2025<");
    expect(html).toContain("1 acta");
  });

  it("chips con conteos que filtran exactamente lo que cuentan", async () => {
    const html = render(await ActasPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('href="/admin/actas?tipo=board"');
    expect(html).toContain('href="/admin/actas?tipo=assembly"');
    expect(html).toContain("Asambleas");
  });

  it("la tarjeta muestra el conteo real de asientos, no solo movimientos", async () => {
    prismaMock.minute.findMany.mockResolvedValueOnce([
      { ...LIST[1], _count: { ...LIST[1]._count, movements: 0, feeValues: 1 } },
    ]);
    prismaMock.minute.count.mockResolvedValueOnce(1);
    const html = render(await ActasPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("1 asiento");
    expect(html).not.toContain("Sin asientos");
  });

  it("con filtros y sin resultados ofrece limpiar", async () => {
    prismaMock.minute.findMany.mockResolvedValue([]);
    prismaMock.minute.count.mockResolvedValue(0);
    const html = render(await ActasPage({ searchParams: Promise.resolve({ q: "zzz" }) }));
    expect(html).toContain("Limpiar filtros");
    expect(html).toContain('href="/admin/actas"');
  });

  it("el formulario de filtros expone q y anio", async () => {
    const html = render(await ActasPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('name="q"');
    expect(html).toContain('name="anio"');
  });
});
```

Note the `mockResolvedValue` (not `Once`) in the empty-state test: the page calls `findMany` twice (rows + years), both must return `[]`.

- [ ] **Step 3: Run the screen tests — baseline AND new must pass**

Run: `npx vitest run tests/actas-screen.test.ts`
Expected: PASS, including every Task 1 baseline assertion. If a baseline test fails, the redesign broke an invariant — fix the page, never the baseline test.

- [ ] **Step 4: Run the regression suite**

Run: `npx vitest run tests/minute-actions.test.ts tests/minute-edit.test.ts tests/minute-choice.test.ts tests/minute-form.test.ts tests/reregistration-close-minute.test.ts tests/admin-nav.test.ts tests/exemption-member-card-screen.test.ts`
Expected: PASS with zero edits to those files.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/actas/page.tsx tests/actas-screen.test.ts
git commit -m "feat(actas): listing redesign with year chronology, chips and pagination"
```

---

### Task 8: Detail redesign — full references + export buttons

**Files:**
- Modify: `src/app/admin/actas/[id]/page.tsx` (full replacement)
- Test: extend `tests/actas-screen.test.ts`

**Interfaces:**
- Consumes: Task 6's route URL (`/api/admin/actas/{id}/export?formato=pdf|docx`); `referenceCountLabel` from Task 2; labels from `@/lib/members/labels`; `formatARS`, `formatDateAR`; icons `BookMarked, ClipboardCheck, FileDown, FileText, Inbox, Users, Wallet` from `lucide-react`; `INLINE_LINK` from `@/lib/admin/link-styles`.
- Produces: nothing new for later tasks. URL contract unchanged: `/admin/actas/[id]`.

- [ ] **Step 1: Replace the page**

```tsx
// src/app/admin/actas/[id]/page.tsx
// El detalle de un acta, rediseñado (spec 2026-08-29): TODO lo que el acta
// respalda —las nueve clases de FKs entrantes, no sólo movimientos— y los
// botones de descarga de la constancia. Un acta que respalda una exención o un
// valor de cuota ya no se ve "vacía".
//
// Las exenciones no tienen sección propia: conceder y anular escriben también
// un Movement con la misma acta, así que ya aparecen en "Movimientos" (ver el
// comentario de `references.ts`).
import {
  BookMarked, ClipboardCheck, FileDown, FileText, Inbox, Users, Wallet,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ComponentType, ReactNode } from "react";

import { EmptyState } from "@/components/admin/empty-state";
import { PageHeader } from "@/components/admin/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { INLINE_LINK } from "@/lib/admin/link-styles";
import { formatARS, formatDateAR } from "@/lib/format";
import { MOVEMENT_LABELS, minuteName } from "@/lib/members/labels";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export const metadata = { title: "Acta — SIGeV" };

function ReferenceGroup({ icon: Icon, title, count, children }: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <Card size="sm" className="h-full">
      <CardHeader>
        <CardTitle as="h3" className="flex items-center gap-2">
          <Icon aria-hidden className="size-4 shrink-0 text-primary" />
          {title}
          <span className="font-mono text-xs tabular-nums text-muted-foreground">{count}</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="list-none space-y-1.5 p-0 text-sm">{children}</ul>
      </CardContent>
    </Card>
  );
}

export default async function ActaPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  // Con un id no numérico Prisma tiraría un error técnico en inglés; acá es un 404.
  const minuteId = Number(id);
  if (!Number.isInteger(minuteId) || minuteId <= 0) notFound();

  const minute = await prisma.minute.findUnique({
    where: { id: minuteId },
    include: {
      // Select explícito: la pantalla muestra nombre y link; el DNI sólo lo
      // carga la ruta del export, que es donde la descarga se audita.
      movements: {
        orderBy: { id: "asc" },
        select: { id: true, type: true, memberId: true, member: { select: { fullName: true } } },
      },
      applications: { select: { id: true, fullName: true, status: true } },
      feeValues: {
        orderBy: { validFrom: "asc" },
        select: { id: true, activeAmount: true, sharedAmount: true, validFrom: true },
      },
      booksOpened: { select: { id: true, number: true } },
      booksClosed: { select: { id: true, number: true } },
      processesCalled: { select: { id: true, book: { select: { number: true } } } },
      processesClosed: { select: { id: true, book: { select: { number: true } } } },
    },
  });
  if (!minute) notFound();

  const bookEntries = [
    ...minute.booksOpened.map((b) => ({ key: `o-${b.id}`, text: `Apertura del Libro de Socios N° ${b.number}`, number: b.number })),
    ...minute.booksClosed.map((b) => ({ key: `c-${b.id}`, text: `Cierre del Libro de Socios N° ${b.number}`, number: b.number })),
  ];
  const processEntries = [
    ...minute.processesCalled.map((p) => ({ key: `call-${p.id}`, text: `Convocatoria al re-empadronamiento del Libro N° ${p.book.number}` })),
    ...minute.processesClosed.map((p) => ({ key: `close-${p.id}`, text: `Cierre del proceso de re-empadronamiento del Libro N° ${p.book.number}` })),
  ];
  const total =
    minute.movements.length + minute.applications.length + minute.feeValues.length +
    bookEntries.length + processEntries.length;

  return (
    <div className="space-y-4">
      <PageHeader
        title={minuteName(minute)}
        breadcrumb={[{ label: "Actas", href: "/admin/actas" }, { label: `N° ${minute.number}` }]}
        actions={
          <>
            {/* <a> plano y no <Link>: es una descarga de API, no una navegación
                (mismo patrón que el recibo y el export del libro). */}
            <Button asChild variant="outline" className="min-h-11">
              <a href={`/api/admin/actas/${minute.id}/export?formato=pdf`}>
                <FileDown aria-hidden /> PDF
              </a>
            </Button>
            <Button asChild variant="outline" className="min-h-11">
              <a href={`/api/admin/actas/${minute.id}/export?formato=docx`}>
                <FileText aria-hidden /> Word
              </a>
            </Button>
            <Button asChild variant="outline" className="min-h-11">
              <Link href={`/admin/actas/${minute.id}/editar`}>Editar</Link>
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">
          Asentada con fecha {formatDateAR(minute.date)}. La constancia descargable lista estos
          asientos para incorporarlos al acta del libro.
        </p>
      </PageHeader>

      {minute.description && (
        <div className="max-w-3xl rounded-xl border border-l-4 border-l-primary bg-muted/40 p-4 text-sm">
          {minute.description}
        </div>
      )}

      <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
        Lo que respalda esta acta
      </h2>

      {total === 0 ? (
        <EmptyState size="card" description="Esta acta todavía no respalda ningún asiento del sistema." />
      ) : (
        <div className="grid items-start gap-4 md:grid-cols-2">
          {minute.movements.length > 0 && (
            <ReferenceGroup icon={Users} title="Movimientos de socios" count={minute.movements.length}>
              {minute.movements.map((mv) => (
                <li key={mv.id}>
                  {MOVEMENT_LABELS[mv.type]} —{" "}
                  <Link className={INLINE_LINK} href={`/admin/socios/${mv.memberId}`}>
                    {mv.member.fullName}
                  </Link>
                </li>
              ))}
            </ReferenceGroup>
          )}

          {minute.feeValues.length > 0 && (
            <ReferenceGroup icon={Wallet} title="Valores de cuota" count={minute.feeValues.length}>
              {minute.feeValues.map((v) => (
                <li key={v.id}>
                  <Link className={INLINE_LINK} href="/admin/tesoreria/valores">
                    {formatARS(Number(v.activeAmount))} / {formatARS(Number(v.sharedAmount))}
                  </Link>{" "}
                  <span className="text-muted-foreground">
                    — vigente desde el {formatDateAR(v.validFrom)}
                  </span>
                </li>
              ))}
            </ReferenceGroup>
          )}

          {minute.applications.length > 0 && (
            <ReferenceGroup icon={Inbox} title="Solicitudes de asociación" count={minute.applications.length}>
              {minute.applications.map((a) => (
                <li key={a.id}>
                  <Link className={INLINE_LINK} href={`/admin/solicitudes/${a.id}`}>
                    {a.fullName}
                  </Link>{" "}
                  <span className="text-muted-foreground">
                    — {a.status === "rejected" ? "rechazada" : "asentada"}
                  </span>
                </li>
              ))}
            </ReferenceGroup>
          )}

          {bookEntries.length > 0 && (
            <ReferenceGroup icon={BookMarked} title="Libros" count={bookEntries.length}>
              {bookEntries.map((b) => (
                <li key={b.key}>
                  <Link className={INLINE_LINK} href={`/admin/socios/libros/${b.number}`}>
                    {b.text}
                  </Link>
                </li>
              ))}
            </ReferenceGroup>
          )}

          {processEntries.length > 0 && (
            <ReferenceGroup icon={ClipboardCheck} title="Re-empadronamiento" count={processEntries.length}>
              {processEntries.map((p) => (
                <li key={p.key}>
                  <Link className={INLINE_LINK} href="/admin/reempadronamiento">
                    {p.text}
                  </Link>
                </li>
              ))}
            </ReferenceGroup>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Extend the screen test**

Append to `tests/actas-screen.test.ts`:

```ts
describe("detalle rediseñado", () => {
  const props = { params: Promise.resolve({ id: "16" }) };

  it("ofrece PDF y Word contra la ruta de export", async () => {
    const html = render(await ActaPage(props));
    expect(html).toContain('href="/api/admin/actas/16/export?formato=pdf"');
    expect(html).toContain('href="/api/admin/actas/16/export?formato=docx"');
  });

  it("muestra las clases de referencia que existen y omite las vacías", async () => {
    prismaMock.minute.findUnique.mockResolvedValue({
      ...DETAIL,
      movements: [],
      feeValues: [{ id: 1, activeAmount: 5000, sharedAmount: 3500,
        validFrom: new Date(Date.UTC(2026, 8, 1, 12)) }],
      booksClosed: [{ id: 1, number: 1 }],
    });
    const html = render(await ActaPage(props));
    expect(html).toContain("Valores de cuota");
    expect(html).toContain("Cierre del Libro de Socios N° 1");
    expect(html).toContain('href="/admin/socios/libros/1"');
    expect(html).not.toContain("Movimientos de socios");
    expect(html).not.toContain("Solicitudes de asociación");
  });

  it("sin ninguna referencia lo dice sin fingir tabla", async () => {
    prismaMock.minute.findUnique.mockResolvedValue({
      ...DETAIL, movements: [],
    });
    const html = render(await ActaPage(props));
    expect(html).toContain("todavía no respalda ningún asiento");
  });
});
```

The Task 1 fixture (`DETAIL.movements` items) must gain the fields the new `select` returns — it already has `id`, `type`, `memberId`, `member.fullName`; no change needed.

- [ ] **Step 3: Run screen tests + regression suite**

Run: `npx vitest run tests/actas-screen.test.ts tests/exemption-member-card-screen.test.ts`
Expected: PASS — including the Task 1 baseline detail tests (member links, editar href, minuteName).

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/actas/[id]/page.tsx tests/actas-screen.test.ts
git commit -m "feat(actas): detail redesign with full references and export buttons"
```

---

### Task 9: Forms polish (nueva + editar)

Logic stays byte-identical in behavior: same field `name`s, same actions, same hidden-date trick. Visual: Card + PanelHeader + synced fields (the alta form still hand-rolls its state — migrate it to `useSyncedForm`, which is the same mechanism it already uses under the hood).

**Files:**
- Modify: `src/app/admin/actas/nueva/minute-form.tsx` (full replacement)
- Modify: `src/app/admin/actas/nueva/page.tsx` (only if needed for spacing — usually untouched)
- Modify: `src/app/admin/actas/[id]/editar/page.tsx` (wrap the form in a Card)

**Interfaces:**
- Consumes: `useSyncedForm`, `TextField`, `SelectField` from `@/components/admin/synced-fields`; `PanelHeader` from `@/components/admin/panel-header`; `ScrollText` from `lucide-react`; the untouched `createMinuteAction`.
- Produces: same FormData contract as today — `type`, `number`, `date`, `description` (alta); the editar form is NOT modified (it already uses synced fields; only its page wrapper changes).

- [ ] **Step 1: Replace `nueva/minute-form.tsx`**

```tsx
"use client";
// Alta de un acta. Campos controlados vía `useSyncedForm` (antes: useState +
// useFormResetSync a mano — mismo mecanismo, centralizado): React 19 resetea el
// form cuando la action termina, y con el rechazo por número repetido —el caso
// frecuente acá— el <select> de tipo volvía solo a "Comisión Directiva".
import { ScrollText } from "lucide-react";
import { useActionState } from "react";

import { createMinuteAction } from "../actions";
import { FormMessage } from "@/components/admin/form-message";
import { PanelHeader } from "@/components/admin/panel-header";
import { SelectField, TextField, useSyncedForm } from "@/components/admin/synced-fields";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

function digitsOnly(raw: string): string {
  return raw.replace(/\D/g, "");
}

export function MinuteForm() {
  const [state, formAction, pending] = useActionState(createMinuteAction, {});
  const { field, formRef } = useSyncedForm({
    type: "board", number: "", date: "", description: "",
  });

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <PanelHeader
          icon={ScrollText}
          title="Datos del acta"
          description="Copiá el tipo, el número y la fecha tal como figuran en el libro en papel."
        />
      </CardHeader>
      <CardContent>
        <form ref={formRef} action={formAction} className="space-y-4">
          <SelectField
            label="Tipo"
            field={field("type")}
            options={[["board", "Comisión Directiva"], ["assembly", "Asamblea"]]}
          />
          <TextField
            label="Número"
            field={field("number", digitsOnly)}
            inputMode="numeric"
            maxLength={6}
            hint="Es el número que figura en el libro en papel."
          />
          <TextField label="Fecha" field={field("date")} type="date" />
          <TextField
            label="Descripción"
            field={field("description")}
            maxLength={500}
            hint="Opcional: de qué se trató, en una línea."
          />
          {state.error && <FormMessage kind="error">{state.error}</FormMessage>}
          <Button type="submit" size="lg" className="min-h-11 px-4" disabled={pending}>
            {pending ? "Guardando…" : "Crear acta"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
```

Behavior deltas to accept knowingly: the old `type="number" min={1} required` inputs become the edit form's convention (`inputMode="numeric"` + `digitsOnly` + server-side validation with the message in `FormMessage`) — this is the SAME convention `minute-edit-form.tsx` already uses, so the section becomes internally consistent.

- [ ] **Step 2: Wrap the edit form in a Card (page only)**

In `src/app/admin/actas/[id]/editar/page.tsx`, replace the block that renders `<MinuteEditForm …/>` (currently followed by the "no se eliminan" paragraph) so both live inside a Card:

```tsx
      <Card className="max-w-xl">
        <CardHeader>
          <PanelHeader
            icon={ScrollText}
            title="Datos del acta"
            description={`Asentada el ${formatDateAR(minute.date)}. Corregí lo que se tipeó mal al cargarla desde el libro en papel.`}
          />
        </CardHeader>
        <CardContent className="space-y-4">
          <MinuteEditForm
            minute={{
              id: minute.id,
              type: minute.type,
              number: minute.number,
              date: minute.date.toISOString().slice(0, 10),
              description: minute.description,
            }}
            dateLocked={anchored > 0}
            movementCount={minute._count.movements}
          />

          {/* Por qué no hay "Eliminar": ver el encabezado de
              `@/lib/members/minute-edit`. */}
          <p className="max-w-md text-xs text-muted-foreground">
            Las actas no se eliminan: son parte del libro que la asociación presenta ante la IGJ.
            Si cargaste un acta por error y todavía no tiene movimientos, corregile acá el tipo,
            el número y la fecha para convertirla en la que corresponde.
          </p>
        </CardContent>
      </Card>
```

Add the imports at the top of that page: `import { ScrollText } from "lucide-react";`, `import { PanelHeader } from "@/components/admin/panel-header";`, `import { Card, CardContent, CardHeader } from "@/components/ui/card";` — and DELETE the now-duplicated standalone `<p className="text-sm text-muted-foreground">Asentada el …</p>` paragraph (its text moved into the PanelHeader description). Keep `MinuteEditForm` itself untouched.

- [ ] **Step 3: Run the tests**

Run: `npx vitest run tests/actas-screen.test.ts tests/minute-actions.test.ts tests/form-reset-sync.test.ts`
Expected: PASS. The baseline assertions on the edit form (hidden date, "antigüedad estatutaria", "no se eliminan") must still hold.

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/actas/nueva/minute-form.tsx "src/app/admin/actas/[id]/editar/page.tsx"
git commit -m "feat(actas): polish the create/edit forms with the panel card language"
```

---

### Task 10: Stale comment fix in Configuración

`src/app/admin/configuracion/page.tsx:70-71` claims Prisma would drag "el texto y los adjuntos del acta" — fields that do not exist on `Minute` (risk map, medium). Whoever plans future work against that comment plans against fiction.

**Files:**
- Modify: `src/app/admin/configuracion/page.tsx:70-71` (comment only)

- [ ] **Step 1: Fix the comment**

Open `src/app/admin/configuracion/page.tsx`, find the comment around lines 70-71 that mentions the acta's "texto y adjuntos", and reword it to describe reality, e.g.:

```
// `select` chico a propósito: de las actas sólo hacen falta id, tipo, número y
// fecha para armar las opciones del selector.
```

Adjust to the actual surrounding sentence — it is a comment-only change; the `select` itself does not change. Verify with `git diff` that ONLY comment lines moved.

- [ ] **Step 2: Run that screen's tests**

Run: `npx vitest run tests/config-tabs.test.ts tests/fee-value-action.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/configuracion/page.tsx
git commit -m "docs(configuracion): fix stale comment about nonexistent minute fields"
```

---

### Task 11: Final audit — scope, suite, build, visual pass

The operator's explicit requirement: nothing already built may break, ESPECIALLY money/Mercado Pago, and the work must be audited at the end.

- [ ] **Step 1: Scope audit — prove money, schema and shared minute modules are untouched**

```bash
git diff --stat main -- prisma src/lib/treasury src/lib/mp src/lib/board src/lib/members src/components/admin/minute-picker.tsx src/app/admin/actas/actions.ts
```

Expected: **empty output**. If ANY file shows up here, revert that change — it is out of scope by definition.

- [ ] **Step 2: Confirm the regression suite was never edited**

```bash
git diff --stat main -- tests/minute-actions.test.ts tests/minute-edit.test.ts tests/minute-choice.test.ts tests/minute-form.test.ts tests/reregistration-close-minute.test.ts tests/admin-nav.test.ts tests/exemption-member-card-screen.test.ts
```

Expected: **empty output** (acceptance criterion: the suite passes without touching a single assertion).

- [ ] **Step 3: Full test suite**

Run: `npx vitest run`
Expected: ALL tests pass (the project was fully green on `main`; any failure is caused by this branch — fix it before proceeding).

- [ ] **Step 4: Lint and build**

```bash
npm run lint && npm run build
```

Expected: both succeed. (`next build` needs `AUTH_URL`; in dev the localhost fallback applies — if the build refuses, prefix with `ALLOW_LOCALHOST_BASE_URL=1` as `src/lib/site.ts` documents for local builds.)

- [ ] **Step 5: Visual verification in the dev server**

Start the dev server via the launch config (never Bash) and check, in light AND dark mode, desktop AND 375px mobile:

1. `/admin/actas` — year headers, chips with counts, card grid (1 col mobile / 2 sm / 3 lg), stretched-link focus ring on keyboard Tab, pagination when >20 actas exist locally.
2. `/admin/actas/{id}` of an acta with references (in the local seed, the exemption acta) — reference groups, PDF/Word buttons.
3. Click **PDF** and **Word** — both download, open, and read correctly (membrete, renglones, pie); accented Spanish renders (no `?` in "N°", "Comisión").
4. `/admin/actas/nueva` — create a test acta; verify the duplicate-number error keeps the typed values AND the selected type (the React 19 reset regression).
5. `/admin/actas/{id}/editar` — date locked message on an acta with movements.
6. Screenshot the listing and detail for the operator.

- [ ] **Step 6: Request code review**

Use superpowers:requesting-code-review against the branch diff (`main...actas-visual`), then superpowers:verification-before-completion before claiming done. Fix findings; re-run Steps 1-4 after any fix.

- [ ] **Step 7: Final commit if the audit produced fixes, then hand off**

Do NOT merge to `main` and do NOT push: per project workflow, use superpowers:finishing-a-development-branch and let the operator (Mariano) decide the merge; he runs `git push` himself.
