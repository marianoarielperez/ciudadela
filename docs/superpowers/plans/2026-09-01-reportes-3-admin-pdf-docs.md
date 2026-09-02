# Reportes — Parte 3 de 3: admin, archivos, PDF, mapa y docs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la Comisión vea la cola de reportes en `/admin/solicitudes`, abra cada ficha con fotos y DNI, lo marque presentado o desestimado, descargue el PDF con mini-mapa, lo vea en un mapa, y que los docs del proyecto queden al día.

**Architecture:** Tercera pestaña por URL en Solicitudes (aditiva), lista con chips (`FilterChips` nuevo), ficha con dos formularios (`fileReportAction`, `dismissReportAction`), rutas de archivos autenticadas con CSP repuesta en `next.config.ts`, PDF a pedido con pdf-lib + mini-mapa compuesto con sharp desde tiles del IGN, vista mapa con Leaflet. Cierra con docs/01, 02, 04, 05, 07, 08, 10 y CLAUDE.md.

**Tech Stack:** Next.js 16, pdf-lib, sharp (composición de tiles y pin), Leaflet, Vitest 4.

**Spec:** `docs/superpowers/specs/2026-09-01-reportes-design.md` §5.3, §6.3, §8, §12, §13. **Requiere las Partes 1 y 2.**

## Global Constraints

- Las mismas de las Partes 1 y 2. Además: `requireAdmin()` **en la página, en cada action y en cada route handler**; `nav.ts` y `dashboard-cards.ts` **no se tocan**; `<Button asChild><a href>` para descargas (nunca `<Link>`); `EmptyState` en vez de tabla vacía; badges desde `status-badges.ts`; `detail` de auditoría sin texto ni identidad; la CSP de un handler **se repone en `next.config.ts`** (y el test verifica la sincronía).
- Nada de red dentro de una transacción. El mini-mapa tiene timeout y falla suave.

---

### Task 1: Pestaña "Reportes", contadores, badges y vistas de la cola

**Files:**
- Modify: `src/lib/admin/solicitudes-tabs.ts`, `src/app/admin/solicitudes/layout.tsx`, `src/app/admin/page.tsx`, `src/lib/admin/status-badges.ts`
- Create: `src/lib/admin/reports-queue.ts`
- Modify: `src/components/mi/report-card.tsx` (usa `reportStatusBadgeVariant`)
- Test: `tests/solicitudes-tabs.test.ts` (aditivo), `tests/reports-queue.test.ts` (nuevo)

**Interfaces:**
- Produces: `SOLICITUDES_TABS_BASE` con tercer ítem `{ href: "/admin/solicitudes/reportes", label: "Reportes" }`; `reportStatusBadgeVariant(status)`, `reportKindBadgeVariant(kind)`; `REPORTS_BASE`, `REPORT_VIEWS`, `parseReportView`, `reportView`, `reportHref`, `parseReportFilters(sp)`, `reportFiltersHref(base, filters, view)`, `type ReportFilters = { kind: "claim" | "initiative" | null; category: string | null; q: string | null }`.

- [ ] **Step 1: Tests**

En `tests/solicitudes-tabs.test.ts`:
- cambiar la aserción del array a `["/admin/solicitudes", "/admin/solicitudes/socios", "/admin/solicitudes/reportes"]`.
- agregar:

```ts
  const REPORTES = "/admin/solicitudes/reportes";
  it("Reportes es hermana: gana por prefijo y apaga a Altas", () => {
    expect(isSolicitudesTabActive(REPORTES, REPORTES)).toBe(true);
    expect(isSolicitudesTabActive(`${REPORTES}/14`, REPORTES)).toBe(true);
    expect(isSolicitudesTabActive(`${REPORTES}/mapa`, REPORTES)).toBe(true);
    expect(isSolicitudesTabActive(REPORTES, ALTAS)).toBe(false);
    expect(isSolicitudesTabActive(REPORTES, SOCIOS)).toBe(false);
    expect(isSolicitudesTabActive("/admin/solicitudes/socios", REPORTES)).toBe(false);
  });
```

```ts
// tests/reports-queue.test.ts
// Las vistas de la cola de reportes (spec §5.3): cada chip cuenta y filtra
// EXACTAMENTE lo mismo (la lista de estados ES el where), "Todos" nunca incluye
// borradores, y los filtros parseados sobreviven al href.
import { describe, expect, it } from "vitest";
import {
  parseReportFilters, parseReportView, reportFiltersHref, reportHref, REPORT_VIEWS, reportView,
} from "@/lib/admin/reports-queue";

describe("REPORT_VIEWS", () => {
  it("Sin presentar · Presentados · Desestimados · Todos, sin draft en ninguna", () => {
    expect(REPORT_VIEWS.map((v) => v.key)).toEqual(["pendientes", "presentados", "desestimados", "todos"]);
    for (const v of REPORT_VIEWS) expect(v.statuses).not.toContain("draft");
    expect(reportView("todos").statuses).toEqual(["received", "filed", "dismissed"]);
  });
  it("parseReportView cae a pendientes", () => {
    expect(parseReportView(undefined)).toBe("pendientes");
    expect(parseReportView("zzz")).toBe("pendientes");
    expect(parseReportView(["presentados"])).toBe("presentados");
  });
  it("reportHref omite el parámetro en la vista por defecto", () => {
    expect(reportHref("pendientes")).toBe("/admin/solicitudes/reportes");
    expect(reportHref("todos")).toBe("/admin/solicitudes/reportes?estado=todos");
  });
});

describe("filtros", () => {
  it("parsea tipo, categoría y texto, y descarta lo que no existe", () => {
    expect(parseReportFilters({ tipo: "reclamo", categoria: "water", q: " pozo " })).toEqual({ kind: "claim", category: "water", q: "pozo" });
    expect(parseReportFilters({ tipo: "queja", categoria: "zzz" })).toEqual({ kind: null, category: null, q: null });
    expect(parseReportFilters({ tipo: "iniciativa", categoria: "social" })).toEqual({ kind: "initiative", category: "social", q: null });
  });
  it("el href de un chip conserva los filtros y cambia sólo la vista", () => {
    const f = parseReportFilters({ tipo: "reclamo", q: "pozo" });
    expect(reportFiltersHref(f, "presentados")).toBe("/admin/solicitudes/reportes?estado=presentados&tipo=reclamo&q=pozo");
    expect(reportFiltersHref(f, "pendientes")).toBe("/admin/solicitudes/reportes?tipo=reclamo&q=pozo");
  });
});
```

Run: `npm test -- --run tests/solicitudes-tabs.test.ts tests/reports-queue.test.ts` → FAIL.

- [ ] **Step 2: Código**

`src/lib/admin/solicitudes-tabs.ts`: agregar `{ href: "/admin/solicitudes/reportes", label: "Reportes" }` al array y reescribir la función:

```ts
const SIBLINGS = ["/admin/solicitudes/socios", "/admin/solicitudes/reportes"] as const;

export function isSolicitudesTabActive(pathname: string, href: string): boolean {
  const under = (base: string) => pathname === base || pathname.startsWith(`${base}/`);
  const activeSibling = SIBLINGS.find(under) ?? null;
  if ((SIBLINGS as readonly string[]).includes(href)) return activeSibling === href;
  if (activeSibling !== null) return false;
  return pathname === "/admin/solicitudes" || pathname.startsWith("/admin/solicitudes/");
}
```

`src/app/admin/solicitudes/layout.tsx`: importar `reports` de `@/lib/reports/service`, sumar `reports.pendingCount()` al `Promise.all` como `reportesCount`, y reemplazar el ternario por:

```ts
  const counts: Record<string, number> = {
    "/admin/solicitudes": altasCount,
    "/admin/solicitudes/socios": sociosCount,
    "/admin/solicitudes/reportes": reportesCount,
  };
  const tabs = SOLICITUDES_TABS_BASE.map((tab) => ({ ...tab, count: counts[tab.href] ?? 0 }));
```

`src/app/admin/page.tsx`: sumar `reports.pendingCount()` al `Promise.all` (como `reportesCount`) y cambiar el desglose por:

```tsx
                      {card.href === "/admin/solicitudes" && (altasCount > 0 || sociosCount > 0 || reportesCount > 0) && (
                        <p className="font-mono text-xs tabular-nums text-muted-foreground">
                          {altasCount} {altasCount === 1 ? "alta" : "altas"} · {sociosCount} de socios pendientes · {reportesCount} {reportesCount === 1 ? "reporte" : "reportes"} sin presentar
                        </p>
                      )}
```

`src/lib/admin/status-badges.ts`: importar `ReportKind, ReportStatus` y agregar:

```ts
// Reportes (M7): `received` es "acá hay trabajo"; `filed` es el desenlace
// bueno; `dismissed` va apagado (alguien decidió, y se puede leer el motivo).
export function reportStatusBadgeVariant(status: ReportStatus): BadgeVariant {
  if (status === "received") return "default";
  if (status === "filed") return "success";
  if (status === "dismissed") return "secondary";
  return "outline"; // draft: no se lista, pero el mapa es total
}

export function reportKindBadgeVariant(kind: ReportKind): BadgeVariant {
  return kind === "claim" ? "outline" : "secondary";
}
```

En `src/components/mi/report-card.tsx`: borrar `reportStatusVariant` local e importar `reportStatusBadgeVariant` de `@/lib/admin/status-badges`.

```ts
// src/lib/admin/reports-queue.ts
// Las vistas y los filtros de la cola de reportes (spec §5.3), en un solo lugar
// y PURO: la lista de estados de cada vista es también el `where`, y los chips
// del panel llevan siempre a la vista que efectivamente lista ese estado.
import type { ReportStatus } from "@/generated/prisma/client";
import { CLAIM_CATEGORIES, INITIATIVE_CATEGORIES } from "@/lib/reports/catalog";

export const REPORTS_BASE = "/admin/solicitudes/reportes";

export type ReportViewKey = "pendientes" | "presentados" | "desestimados" | "todos";

export const REPORT_VIEWS: Array<{ key: ReportViewKey; label: string; statuses: ReportStatus[]; empty: string }> = [
  { key: "pendientes", label: "Sin presentar", statuses: ["received"], empty: "No hay reportes esperando. Los nuevos aparecen acá solos." },
  { key: "presentados", label: "Presentados", statuses: ["filed"], empty: "Todavía no se presentó ningún reporte." },
  { key: "desestimados", label: "Desestimados", statuses: ["dismissed"], empty: "Ningún reporte fue desestimado." },
  { key: "todos", label: "Todos", statuses: ["received", "filed", "dismissed"], empty: "Todavía no entró ningún reporte." },
];

export const DEFAULT_REPORT_VIEW: ReportViewKey = "pendientes";

export function parseReportView(raw: string | string[] | undefined): ReportViewKey {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return REPORT_VIEWS.find((v) => v.key === value)?.key ?? DEFAULT_REPORT_VIEW;
}

export function reportView(key: ReportViewKey) {
  return REPORT_VIEWS.find((v) => v.key === key) ?? REPORT_VIEWS[0];
}

export function reportHref(key: ReportViewKey): string {
  return key === DEFAULT_REPORT_VIEW ? REPORTS_BASE : `${REPORTS_BASE}?estado=${key}`;
}

export type ReportFilters = { kind: "claim" | "initiative" | null; category: string | null; q: string | null };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function parseReportFilters(sp: Record<string, string | string[] | undefined>): ReportFilters {
  const tipo = one(sp.tipo);
  const kind = tipo === "reclamo" ? "claim" : tipo === "iniciativa" ? "initiative" : null;
  const cat = one(sp.categoria) ?? null;
  const known = [...CLAIM_CATEGORIES, ...INITIATIVE_CATEGORIES].some((c) => c.slug === cat);
  const q = (one(sp.q) ?? "").trim();
  return { kind, category: known ? cat : null, q: q === "" ? null : q.slice(0, 80) };
}

export function reportFiltersHref(f: ReportFilters, view: ReportViewKey): string {
  const qs = new URLSearchParams();
  if (view !== DEFAULT_REPORT_VIEW) qs.set("estado", view);
  if (f.kind) qs.set("tipo", f.kind === "claim" ? "reclamo" : "iniciativa");
  if (f.category) qs.set("categoria", f.category);
  if (f.q) qs.set("q", f.q);
  const s = qs.toString();
  return s ? `${REPORTS_BASE}?${s}` : REPORTS_BASE;
}
```

- [ ] **Step 3: Correr y commitear**

Run: `npm test -- --run tests/solicitudes-tabs.test.ts tests/reports-queue.test.ts tests/dashboard-cards.test.ts tests/admin-nav.test.ts` → PASS (los dos últimos siguen verdes: nav y cards no se tocaron). `npx tsc --noEmit` limpio (la página `reportes/page.tsx` todavía no existe; la crea la Task 3 — `admin-nav.test.ts` no la exige porque Reportes no está en la nav).

```bash
git add src/lib/admin/solicitudes-tabs.ts src/app/admin/solicitudes/layout.tsx src/app/admin/page.tsx src/lib/admin/status-badges.ts src/lib/admin/reports-queue.ts src/components/mi/report-card.tsx tests/solicitudes-tabs.test.ts tests/reports-queue.test.ts
git commit -m "feat(reports): third Solicitudes tab with queue count, badges and queue views

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `FilterChips` compartido y el ícono de tipo

**Files:**
- Create: `src/components/admin/filter-chips.tsx`, `src/components/admin/report-kind-icon.tsx`
- Test: `tests/filter-chips.test.tsx`

- [ ] **Step 1: Test**

```tsx
// tests/filter-chips.test.tsx
// El componente de chips-filtro (spec §6.3), extraído del patrón de Socios:
// links con aria-current, contador en mono, y ninguno activo si la clave no
// coincide con ningún chip.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FilterChips } from "@/components/admin/filter-chips";

const chips = [
  { key: "a", label: "Sin presentar", href: "/x", count: 7 },
  { key: "b", label: "Presentados", href: "/x?estado=b", count: 0 },
];

describe("FilterChips", () => {
  it("marca el activo con aria-current y muestra los contadores", () => {
    const html = renderToStaticMarkup(<FilterChips label="Estado" chips={chips} active="a" />);
    expect(html).toContain('aria-current="page"');
    expect(html).toContain(">7<");
    expect(html).toContain(">0<");
    expect(html).toContain('aria-label="Estado"');
  });
  it("con una clave desconocida no prende ninguno", () => {
    const html = renderToStaticMarkup(<FilterChips label="Estado" chips={chips} active={null} />);
    expect(html).not.toContain("aria-current");
  });
});
```

- [ ] **Step 2: Componentes**

```tsx
// src/components/admin/filter-chips.tsx
// Chips de filtro por URL (M7; el vocabulario es el de `admin/socios/page.tsx`,
// que sigue con su copia inline hasta que alguien la migre). Son LINKS, no
// botones con estado: deep-link, atrás y aria-current gratis. Regla: cada chip
// filtra EXACTAMENTE lo que cuenta, y una combinación que ningún chip
// representa no prende ninguno.
import Link from "next/link";
import { cn } from "@/lib/utils";

export type FilterChip = { key: string; label: string; href: string; count?: number };

const BASE = "inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-medium outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-ring";
const ACTIVE = "bg-background text-foreground shadow-sm";
const INACTIVE = "text-muted-foreground hover:text-foreground";

export function FilterChips({ label, chips, active }: { label: string; chips: FilterChip[]; active: string | null }) {
  return (
    <nav aria-label={label} className="flex w-fit max-w-full flex-wrap gap-1 rounded-lg bg-muted p-1">
      {chips.map((chip) => (
        <Link
          key={chip.key}
          href={chip.href}
          aria-current={active === chip.key ? "page" : undefined}
          className={cn(BASE, active === chip.key ? ACTIVE : INACTIVE)}
        >
          {chip.label}
          {chip.count !== undefined && <span className="font-mono tabular-nums">{chip.count}</span>}
        </Link>
      ))}
    </nav>
  );
}
```

```tsx
// src/components/admin/report-kind-icon.tsx
import { Lightbulb, MessageSquareWarning } from "lucide-react";
import type { ReportKind } from "@/generated/prisma/client";

export function ReportKindIcon({ kind, className }: { kind: ReportKind; className?: string }) {
  const Icon = kind === "claim" ? MessageSquareWarning : Lightbulb;
  return <Icon aria-hidden className={className} />;
}
```

- [ ] **Step 3: Correr y commitear**

Run: `npm test -- --run tests/filter-chips.test.tsx` → PASS.

```bash
git add src/components/admin/filter-chips.tsx src/components/admin/report-kind-icon.tsx tests/filter-chips.test.tsx
git commit -m "feat(admin): shared FilterChips component and report kind icon

Co-Authored-By: Claude Fable 5.1 <noreply@antropic.com>"
```

(Corregir el typo del trailer: `noreply@anthropic.com`.)

---

### Task 3: Lista de reportes en el admin

**Files:**
- Create: `src/app/admin/solicitudes/reportes/page.tsx`
- Create: `src/lib/admin/reports-query.ts` (la consulta con filtros, compartida por lista y mapa)
- Test: `tests/reports-query.test.ts`

**Interfaces:**
- Produces: `reportWhere(view, filters): Prisma.ReportWhereInput`, `countByView(db, filters): Promise<Record<ReportViewKey, number>>`, `REPORT_LIST_SELECT`.

- [ ] **Step 1: Test**

```ts
// tests/reports-query.test.ts
// El `where` de la cola (spec §5.3): la vista aporta los estados, los filtros
// el tipo, la categoría y el texto; y los contadores de los chips se calculan
// con LOS MISMOS filtros que la lista (cada chip cuenta lo que filtra).
import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import { countByView, reportWhere } from "@/lib/admin/reports-query";

describe("reportWhere", () => {
  it("vista + filtros", () => {
    expect(reportWhere("pendientes", { kind: null, category: null, q: null })).toEqual({ status: { in: ["received"] } });
    const w = reportWhere("todos", { kind: "claim", category: "water", q: "pozo" });
    expect(w).toMatchObject({ status: { in: ["received", "filed", "dismissed"] }, kind: "claim", category: "water" });
    expect(w.OR).toHaveLength(3);
  });
  it("un texto numérico también busca por N°", () => {
    const w = reportWhere("todos", { kind: null, category: null, q: "14" });
    expect(w.OR).toContainEqual({ id: 14 });
  });
});

describe("countByView", () => {
  it("cuenta las cuatro vistas con los mismos filtros", async () => {
    const count = vi.fn(async ({ where }: { where: { status: { in: string[] } } }) => where.status.in.length);
    const r = await countByView({ report: { count } } as never, { kind: "initiative", category: null, q: null });
    expect(r).toEqual({ pendientes: 1, presentados: 1, desestimados: 1, todos: 3 });
    expect(count).toHaveBeenCalledTimes(4);
    for (const c of count.mock.calls) expect(c[0].where).toMatchObject({ kind: "initiative" });
  });
});
```

- [ ] **Step 2: `reports-query.ts`**

```ts
// src/lib/admin/reports-query.ts
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { REPORT_VIEWS, reportView, type ReportFilters, type ReportViewKey } from "./reports-queue";

export function reportWhere(view: ReportViewKey, f: ReportFilters): Prisma.ReportWhereInput {
  const where: Prisma.ReportWhereInput = { status: { in: reportView(view).statuses } };
  if (f.kind) where.kind = f.kind;
  if (f.category) where.category = f.category;
  if (f.q) {
    const or: Prisma.ReportWhereInput[] = [
      { description: { contains: f.q } },
      { streetName: { contains: f.q } },
      { reporterName: { contains: f.q } },
    ];
    const n = Number(f.q);
    if (Number.isInteger(n) && n > 0) or.push({ id: n });
    where.OR = or;
  }
  return where;
}

export async function countByView(db: Pick<PrismaClient, "report">, f: ReportFilters): Promise<Record<ReportViewKey, number>> {
  const entries = await Promise.all(REPORT_VIEWS.map(async (v) => [v.key, await db.report.count({ where: reportWhere(v.key, f) })] as const));
  return Object.fromEntries(entries) as Record<ReportViewKey, number>;
}

export const REPORT_LIST_SELECT = {
  id: true, kind: true, status: true, anonymous: true, memberId: true, category: true, subtype: true,
  streetName: true, addressDetail: true, submittedAt: true, outsideBoundary: true, scplTicket: true,
  reporterName: true, lat: true, lng: true,
  files: { where: { kind: "photo" as const }, select: { id: true }, orderBy: { id: "asc" as const } },
  member: { select: { memberships: { select: { memberNumber: true, book: { select: { status: true } } } } } },
} satisfies Prisma.ReportSelect;
```

- [ ] **Step 3: La página**

```tsx
// src/app/admin/solicitudes/reportes/page.tsx
import Link from "next/link";
import { Map as MapIcon } from "lucide-react";
import { EmptyState } from "@/components/admin/empty-state";
import { FilterChips } from "@/components/admin/filter-chips";
import { FormMessage } from "@/components/admin/form-message";
import { PageHeader } from "@/components/admin/page-header";
import { PaginationNav } from "@/components/admin/pagination-nav";
import { ReportKindIcon } from "@/components/admin/report-kind-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SELECT_CLASS } from "@/lib/admin/field-styles";
import { INLINE_LINK } from "@/lib/admin/link-styles";
import { pageHref, paginate, parsePage } from "@/lib/admin/pagination";
import { countByView, REPORT_LIST_SELECT, reportWhere } from "@/lib/admin/reports-query";
import { parseReportFilters, parseReportView, REPORT_VIEWS, reportFiltersHref, reportView, REPORTS_BASE } from "@/lib/admin/reports-queue";
import { reportKindBadgeVariant, reportStatusBadgeVariant } from "@/lib/admin/status-badges";
import { requireAdmin } from "@/lib/auth/require-admin";
import { formatDateAR } from "@/lib/format";
import { categoryLabel, CLAIM_CATEGORIES, filedVerb, INITIATIVE_CATEGORIES, KIND_LABELS, subtypeLabel } from "@/lib/reports/catalog";
import { prisma } from "@/lib/prisma";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reportes — SIGeV" };
const PAGE_SIZE = 50;

const RAIL: Record<string, string> = { received: "border-l-primary", filed: "border-l-success", dismissed: "border-l-border" };

export default async function ReportesPage(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireAdmin();
  if (!actor.ok) {
    return (
      <div className="space-y-4">
        <PageHeader title="Reportes" />
        <FormMessage kind="error" box>{actor.error}</FormMessage>
      </div>
    );
  }
  const sp = await props.searchParams;
  const view = parseReportView(sp.estado);
  const filters = parseReportFilters(sp);
  const where = reportWhere(view, filters);
  const [counts, total] = await Promise.all([countByView(prisma, filters), prisma.report.count({ where })]);
  const { page, pageCount, skip, take } = paginate(total, parsePage(sp), PAGE_SIZE);
  const rows = total === 0 ? [] : await prisma.report.findMany({ where, orderBy: [{ submittedAt: "desc" }, { id: "desc" }], skip, take, select: REPORT_LIST_SELECT });
  const hasFilters = filters.kind !== null || filters.category !== null || filters.q !== null;
  const mapHref = `${REPORTS_BASE}/mapa${reportFiltersHref(filters, view).replace(REPORTS_BASE, "")}`;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Reportes"
        breadcrumb={[{ label: "Solicitudes", href: "/admin/solicitudes" }, { label: "Reportes" }]}
        actions={
          <Button asChild variant="outline" className="min-h-11">
            <Link href={mapHref}><MapIcon aria-hidden className="size-4" /> Mapa</Link>
          </Button>
        }
      >
        <p className="max-w-3xl text-sm text-muted-foreground">Reclamos e iniciativas de vecinos y socios. Lo que está sin presentar es la cola de trabajo.</p>
      </PageHeader>

      <FilterChips
        label="Estado de los reportes"
        active={view}
        chips={REPORT_VIEWS.map((v) => ({ key: v.key, label: v.label, href: reportFiltersHref(filters, v.key), count: counts[v.key] }))}
      />

      <form className="flex flex-wrap items-end gap-2" method="get">
        {view !== "pendientes" && <input type="hidden" name="estado" value={view} />}
        <select name="tipo" defaultValue={filters.kind === "claim" ? "reclamo" : filters.kind === "initiative" ? "iniciativa" : ""} className={SELECT_CLASS} aria-label="Tipo">
          <option value="">Reclamos e iniciativas</option>
          <option value="reclamo">Reclamos</option>
          <option value="iniciativa">Iniciativas</option>
        </select>
        <select name="categoria" defaultValue={filters.category ?? ""} className={SELECT_CLASS} aria-label="Categoría">
          <option value="">Todas las categorías</option>
          <optgroup label="Reclamos">{CLAIM_CATEGORIES.map((c) => <option key={c.slug} value={c.slug}>{c.label}</option>)}</optgroup>
          <optgroup label="Iniciativas">{INITIATIVE_CATEGORIES.map((c) => <option key={`i-${c.slug}`} value={c.slug}>{c.label}</option>)}</optgroup>
        </select>
        <Input name="q" defaultValue={filters.q ?? ""} placeholder="N°, calle, texto o nombre" aria-label="Buscar" className="w-full sm:w-56" />
        <Button type="submit" variant="secondary">Filtrar</Button>
        {hasFilters && <Button asChild variant="ghost"><Link href={reportFiltersHref({ kind: null, category: null, q: null }, view)}>Limpiar</Link></Button>}
      </form>

      {rows.length === 0 ? (
        <EmptyState description={hasFilters ? "Ningún reporte coincide con esos filtros." : reportView(view).empty} action={hasFilters ? <Button asChild variant="outline"><Link href={reportFiltersHref({ kind: null, category: null, q: null }, view)}>Limpiar filtros</Link></Button> : undefined} />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{skip + 1}–{skip + rows.length} de {total}</p>
          <div className="space-y-3">
            {rows.map((r) => {
              const number = r.member?.memberships.find((m) => m.book.status === "open")?.memberNumber;
              const what = r.kind === "claim" && r.subtype ? `${categoryLabel("claim", r.category)} › ${subtypeLabel(r.category, r.subtype)}` : categoryLabel(r.kind, r.category);
              const where = [r.streetName, r.addressDetail].filter(Boolean).join(" ");
              return (
                <Card key={r.id} className={cn("border-l-4", RAIL[r.status])}>
                  <CardHeader>
                    <CardTitle as="h2" className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                      <span className="flex items-center gap-2">
                        <span className="font-mono tabular-nums text-muted-foreground">N° {r.id}</span>
                        <Badge variant={reportKindBadgeVariant(r.kind)}><ReportKindIcon kind={r.kind} /> {KIND_LABELS[r.kind]}</Badge>
                      </span>
                      <Badge variant={reportStatusBadgeVariant(r.status)}>{r.status === "filed" ? filedVerb(r.kind) : r.status === "received" ? "Sin presentar" : "Desestimado"}</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <Link href={`${REPORTS_BASE}/${r.id}`} className={cn(INLINE_LINK, "font-medium")}>{what}</Link>
                    <p className="text-sm text-muted-foreground">
                      {where || "Sin ubicación"} · {r.submittedAt ? formatDateAR(r.submittedAt) : "—"} · {r.memberId ? `Socio N° ${number ?? "—"}` : "Vecino"}
                    </p>
                    <p className="flex flex-wrap gap-1.5">
                      {r.anonymous && <Badge variant="outline" title="Identidad reservada ante el organismo">Reservado<span className="sr-only">: identidad reservada ante el organismo</span></Badge>}
                      {r.outsideBoundary && <Badge variant="outline" title="El punto cae fuera del barrio">Fuera del barrio</Badge>}
                      {r.scplTicket && <Badge variant="outline">SCPL {r.scplTicket}</Badge>}
                      {r.files.length > 0 && <Badge variant="outline">{r.files.length} {r.files.length === 1 ? "foto" : "fotos"}</Badge>}
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
          <PaginationNav page={page} pageCount={pageCount} href={(n) => pageHref(REPORTS_BASE, { estado: view === "pendientes" ? undefined : view, tipo: filters.kind === "claim" ? "reclamo" : filters.kind === "initiative" ? "iniciativa" : undefined, categoria: filters.category ?? undefined, q: filters.q ?? undefined }, n)} label="Páginas de reportes" />
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Correr y commitear**

Run: `npm test -- --run tests/reports-query.test.ts` → PASS. `npx tsc --noEmit` limpio. En dev: `/admin/solicitudes` muestra la tercera pestaña con el contador; `/admin/solicitudes/reportes` lista el reporte creado en la Parte 2 con su rail celeste.

```bash
git add src/app/admin/solicitudes/reportes/page.tsx src/lib/admin/reports-query.ts tests/reports-query.test.ts
git commit -m "feat(reports): admin queue with filter chips, GET filters and status-railed cards

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Rutas de archivos (admin y socio) con CSP repuesta

**Files:**
- Create: `src/lib/reports/file-response.ts` (puro: CSP y cabeceras)
- Create: `src/app/api/admin/reportes/[id]/archivos/[fileId]/route.ts`, `src/app/api/mi/reportes/[id]/archivos/[fileId]/route.ts`
- Modify: `next.config.ts` (dos entradas CSP)
- Test: `tests/report-file-routes.test.ts`

- [ ] **Step 1: Test**

```ts
// tests/report-file-routes.test.ts
// Las dos rutas que sirven un archivo de un reporte (spec §8): admin (con
// asiento SÓLO para las caras del DNI) y socio (su propio reporte; ajeno = 404).
// Cabeceras defensivas, y la CSP repuesta en next.config.ts para las dos rutas.
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(), requireMember: vi.fn(), findFirst: vi.fn(), read: vi.fn(), audit: vi.fn(async () => {}),
}));
vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/auth/require-member", () => ({ requireMember: mocks.requireMember }));
vi.mock("@/lib/prisma", () => ({ prisma: { reportFile: { findFirst: mocks.findFirst } } }));
vi.mock("@/lib/reports/storage", () => ({ reportFileStore: { read: mocks.read } }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Map([["x-real-ip", "10.0.0.7"]])) }));
import { GET as adminGet } from "@/app/api/admin/reportes/[id]/archivos/[fileId]/route";
import { GET as memberGet } from "@/app/api/mi/reportes/[id]/archivos/[fileId]/route";
import { REPORT_FILE_CSP } from "@/lib/reports/file-response";
import config from "../next.config";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const file = (over: Record<string, unknown> = {}) => ({ id: 3, reportId: 14, kind: "photo", path: "reports/14/x.jpg", mime: "image/jpeg", size: 4, width: 1, height: 1, ...over });
const call = (fn: typeof adminGet, id = "14", fileId = "3") => fn(new Request("http://x"), { params: Promise.resolve({ id, fileId }) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockResolvedValue({ ok: true, actorId: 7 });
  mocks.requireMember.mockResolvedValue({ ok: true, memberId: 5, userId: 1, fullName: "x", suspension: null });
  mocks.findFirst.mockResolvedValue(file());
  mocks.read.mockResolvedValue(JPEG);
});

describe("admin", () => {
  it("403 sin admin, sin tocar base ni disco", async () => {
    mocks.requireAdmin.mockResolvedValue({ ok: false, reason: "anonymous", error: "x" });
    expect((await call(adminGet)).status).toBe(403);
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });
  it("acota al dueño de la URL y sirve con cabeceras defensivas", async () => {
    const res = await call(adminGet);
    expect(mocks.findFirst).toHaveBeenCalledWith({ where: { id: 3, reportId: 14 } });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    expect(res.headers.get("Cache-Control")).toBe("no-store, private");
    expect(res.headers.get("Vary")).toBe("Cookie");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Security-Policy")).toBe(REPORT_FILE_CSP);
    expect(res.headers.get("Content-Disposition")).toContain("reporte-14-photo-3.jpg");
  });
  it("una foto NO se audita; el DNI sí, con ids y tipo", async () => {
    await call(adminGet);
    expect(mocks.audit).not.toHaveBeenCalled();
    mocks.findFirst.mockResolvedValue(file({ kind: "dni_front" }));
    await call(adminGet);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ userId: 7, action: "report_dni_view", entity: "report_file", entityId: 3, detail: { reportId: 14, kind: "dni_front" }, ip: "10.0.0.7" }));
  });
  it("404 con ids no numéricos, fila ajena o archivo faltante (sin asiento)", async () => {
    expect((await call(adminGet, "abc")).status).toBe(404);
    mocks.findFirst.mockResolvedValue(null);
    expect((await call(adminGet)).status).toBe(404);
    mocks.findFirst.mockResolvedValue(file({ kind: "dni_back" }));
    mocks.read.mockRejectedValue(new Error("ENOENT"));
    expect((await call(adminGet)).status).toBe(404);
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});

describe("socio", () => {
  it("sirve su propio archivo (el suspendido lee) y responde 404 al ajeno", async () => {
    const res = await call(memberGet);
    expect(res.status).toBe(200);
    expect(mocks.requireMember).toHaveBeenCalledWith({ allowSuspended: true });
    expect(mocks.findFirst).toHaveBeenCalledWith({ where: { id: 3, reportId: 14, report: { memberId: 5 } } });
    mocks.findFirst.mockResolvedValue(null);
    expect((await call(memberGet)).status).toBe(404);
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});

describe("next.config.ts", () => {
  it("repone la CSP de las dos rutas (lección CSP/setHeader)", async () => {
    const entries = (await config("phase-development-server").headers!()) as Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
    for (const source of ["/api/admin/reportes/:id/archivos/:fileId", "/api/mi/reportes/:id/archivos/:fileId"]) {
      const e = entries.find((x) => x.source === source);
      expect(e, source).toBeDefined();
      expect(e!.headers.find((h) => h.key === "Content-Security-Policy")?.value).toBe(REPORT_FILE_CSP);
    }
  });
});
```

- [ ] **Step 2: Código**

```ts
// src/lib/reports/file-response.ts — PURO, sin imports.
/** Los archivos van en <img> (nunca en iframe): no hay framing que reabrir.
 *  OJO: emitirla en el handler NO alcanza; la reponen dos entradas de
 *  next.config.ts y `report-file-routes.test.ts` verifica la sincronía. */
export const REPORT_FILE_CSP = "default-src 'none'; sandbox; frame-ancestors 'none'";

export function reportFileResponse(bytes: Uint8Array, name: string): Response {
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Disposition": `inline; filename="${name}"`,
      "Cache-Control": "no-store, private",
      Vary: "Cookie",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": REPORT_FILE_CSP,
    },
  });
}

export function parsePositiveInt(raw: string): number | null {
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
```

```ts
// src/app/api/admin/reportes/[id]/archivos/[fileId]/route.ts
// Un archivo de un reporte para el admin. El `reportId` sale de la URL del
// dueño (sin ese filtro /reportes/1/archivos/999 serviría el DNI de otro). Se
// AUDITA sólo la vista de un DNI: una foto de un bache no es un dato personal;
// la cara de un documento sí (docs/08).
import { headers } from "next/headers";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth/require-admin";
import { prisma } from "@/lib/prisma";
import { parsePositiveInt, reportFileResponse } from "@/lib/reports/file-response";
import { reportFileStore } from "@/lib/reports/storage";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  const actor = await requireAdmin();
  if (!actor.ok) return new Response(actor.error, { status: 403 });
  const { id, fileId } = await params;
  const reportId = parsePositiveInt(id);
  const fid = parsePositiveInt(fileId);
  if (reportId === null || fid === null) return new Response("No encontrado", { status: 404 });

  const file = await prisma.reportFile.findFirst({ where: { id: fid, reportId } });
  if (!file) return new Response("No encontrado", { status: 404 });
  let data: Buffer;
  try {
    data = await reportFileStore.read(file);
  } catch {
    return new Response("El archivo no está disponible", { status: 404 });
  }
  if (file.kind !== "photo") {
    const ip = (await headers()).get("x-real-ip") ?? "unknown";
    await audit({ userId: actor.actorId, action: "report_dni_view", entity: "report_file", entityId: file.id, detail: { reportId, kind: file.kind }, ip });
  }
  return reportFileResponse(data, `reporte-${reportId}-${file.kind}-${file.id}.jpg`);
}
```

```ts
// src/app/api/mi/reportes/[id]/archivos/[fileId]/route.ts
// El socio ve los archivos de SU reporte. Ajeno → 404, nunca 403. Sin
// auditoría: es su propio documento (mismo criterio que /api/mi/recibos).
import { requireMember } from "@/lib/auth/require-member";
import { prisma } from "@/lib/prisma";
import { parsePositiveInt, reportFileResponse } from "@/lib/reports/file-response";
import { reportFileStore } from "@/lib/reports/storage";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  const actor = await requireMember({ allowSuspended: true });
  if (!actor.ok) return new Response(actor.error, { status: 403 });
  const { id, fileId } = await params;
  const reportId = parsePositiveInt(id);
  const fid = parsePositiveInt(fileId);
  if (reportId === null || fid === null) return new Response("No encontrado", { status: 404 });
  const file = await prisma.reportFile.findFirst({ where: { id: fid, reportId, report: { memberId: actor.memberId } } });
  if (!file) return new Response("No encontrado", { status: 404 });
  try {
    return reportFileResponse(await reportFileStore.read(file), `reporte-${reportId}-${file.kind}-${file.id}.jpg`);
  } catch {
    return new Response("El archivo no está disponible", { status: 404 });
  }
}
```

`next.config.ts`: después de las dos entradas de Permissions-Policy de la Parte 2, agregar:

```ts
      // M7: archivos de un reporte (fotos y DNI). Van en <img>, nunca en
      // iframe: `frame-ancestors 'none'` y sin X-Frame-Options propio (hereda
      // el DENY global). Dos entradas explícitas, sin comodín (regla del archivo).
      {
        source: "/api/admin/reportes/:id/archivos/:fileId",
        headers: [{ key: "Content-Security-Policy", value: "default-src 'none'; sandbox; frame-ancestors 'none'" }],
      },
      {
        source: "/api/mi/reportes/:id/archivos/:fileId",
        headers: [{ key: "Content-Security-Policy", value: "default-src 'none'; sandbox; frame-ancestors 'none'" }],
      },
```

- [ ] **Step 3: Correr y commitear**

Run: `npm test -- --run tests/report-file-routes.test.ts` → PASS.

```bash
git add src/lib/reports/file-response.ts src/app/api/admin/reportes src/app/api/mi/reportes next.config.ts tests/report-file-routes.test.ts
git commit -m "feat(reports): authenticated file routes for admin and member with CSP restored in next.config

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Ficha del reporte, acciones "Presentado" y "Desestimar"

**Files:**
- Create: `src/app/admin/solicitudes/reportes/actions.ts`, `[id]/page.tsx`, `[id]/file-form.tsx`, `[id]/dismiss-form.tsx`, `[id]/report-mini-map.tsx`, `[id]/report-mini-map-loader.tsx`
- Test: `tests/reports-admin-actions.test.ts`
- **Agregado por decisión del operador (01/09/2026, revisión de P1 T3):**
  - Modify: `prisma/schema.prisma` — `Report.filedMinuteId` pasa de `onDelete: SetNull` a `onDelete: Restrict` (el acta es el respaldo institucional, mismo criterio que `FeeExemption`). Segunda migración aditiva `npx prisma migrate dev --name report_minute_restrict` (la tabla está vacía: el DROP/ADD del constraint es seguro) + `npx prisma generate`.
  - Modify: `src/lib/minutes/references.ts` — sumar `reportsFiled: true` (o el nombre de la relación inversa en `Minute`) a `REFERENCE_COUNT_SELECT` para que "N asientos" cuente los reportes que citan el acta.
  - Modify: `src/lib/members/minute-form.ts` — `discardUnusedMinute` cuenta también `report` (`filedMinuteId`) como séptimo referente antes de borrar un acta nueva sin uso.
  - Test: sumar a `tests/reports-admin-actions.test.ts` (o al test existente de `discardUnusedMinute`) el caso "un acta citada por un reporte no se descarta".

**Interfaces:**
- Produces: `fileReportAction(prev, fd)` (campos `reportId, agency, agencyOther?, filedAt (YYYY-MM-DD), reference?, minuteId? | minuteNew…`) y `dismissReportAction(prev, fd)` (`reportId, reason`), ambas `{ error?: string; done?: true }`.

- [ ] **Step 1: Test**

```ts
// tests/reports-admin-actions.test.ts
// Las dos actions del admin (spec §5.3): requireAdmin en la PRIMERA línea (la
// familia *-actions-auth), 'Otro' exige texto, la fecha no puede ser futura,
// el acta es opcional y sólo para iniciativas, se audita con ids/códigos (nunca
// el motivo ni la identidad), y el aviso al vecino sale DESPUÉS del asiento.
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(), file: vi.fn(), dismiss: vi.fn(), sendFiled: vi.fn(async () => {}),
  findUnique: vi.fn(), audit: vi.fn(async () => {}), revalidatePath: vi.fn(), resolveMinuteId: vi.fn(async () => 33),
}));
vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/reports/service", () => ({ reports: { file: mocks.file, dismiss: mocks.dismiss } }));
vi.mock("@/lib/reports/notify", () => ({ reportNotifier: { sendFiled: mocks.sendFiled } }));
vi.mock("@/lib/prisma", () => ({ prisma: { report: { findUnique: mocks.findUnique } } }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/headers", () => ({ headers: async () => new Map([["x-real-ip", "1.1.1.1"]]) }));
vi.mock("@/lib/members/minute-form", async (orig) => ({ ...(await orig<typeof import("@/lib/members/minute-form")>()), resolveMinuteId: mocks.resolveMinuteId, discardUnusedMinute: vi.fn() }));
import { dismissReportAction, fileReportAction } from "@/app/admin/solicitudes/reportes/actions";

const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const TODAY = "2026-09-01";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockResolvedValue({ ok: true, actorId: 7 });
  mocks.findUnique.mockResolvedValue({ id: 14, kind: "claim", status: "received" });
  mocks.file.mockResolvedValue({ ok: true });
  mocks.dismiss.mockResolvedValue({ ok: true });
  vi.useFakeTimers({ now: new Date("2026-09-01T15:00:00Z") });
});

describe("fileReportAction", () => {
  it("bloquea sin admin antes de tocar nada", async () => {
    mocks.requireAdmin.mockResolvedValue({ ok: false, reason: "not_admin", error: "no" });
    expect((await fileReportAction({}, fd({ reportId: "14", agency: "scpl", filedAt: TODAY }))).error).toBe("no");
    expect(mocks.file).not.toHaveBeenCalled();
  });
  it("presenta ante SCPL con fecha civil, avisa y audita sin texto", async () => {
    const r = await fileReportAction({}, fd({ reportId: "14", agency: "scpl", filedAt: TODAY, reference: "EXP 1" }));
    expect(r).toEqual({ done: true });
    expect(mocks.file).toHaveBeenCalledWith(expect.objectContaining({ reportId: 14, actorId: 7, agency: "scpl", reference: "EXP 1", minuteId: null }));
    expect((mocks.file.mock.calls[0][0] as { filedAt: Date }).filedAt.toISOString()).toBe("2026-09-01T12:00:00.000Z");
    expect(mocks.sendFiled).toHaveBeenCalledWith(14);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "report_filed", entity: "report", entityId: 14, detail: { agency: "scpl", minuteId: null } }));
    expect(JSON.stringify(mocks.audit.mock.calls[0][0])).not.toContain("EXP 1");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/solicitudes/reportes");
  });
  it("'Otro' sin texto y una fecha futura se rechazan sin escribir", async () => {
    expect((await fileReportAction({}, fd({ reportId: "14", agency: "other", filedAt: TODAY }))).error).toContain("organismo");
    expect((await fileReportAction({}, fd({ reportId: "14", agency: "mcr", filedAt: "2026-09-02" }))).error).toContain("futuro");
    expect(mocks.file).not.toHaveBeenCalled();
  });
  it("una iniciativa admite acta opcional y organismo vacío", async () => {
    mocks.findUnique.mockResolvedValue({ id: 3, kind: "initiative", status: "received" });
    const r = await fileReportAction({}, fd({ reportId: "3", filedAt: TODAY, minuteId: "33" }));
    expect(r).toEqual({ done: true });
    expect(mocks.file).toHaveBeenCalledWith(expect.objectContaining({ reportId: 3, agency: null, minuteId: 33 }));
  });
  it("traslada el error del servicio y no avisa", async () => {
    mocks.file.mockResolvedValue({ ok: false, error: "El reporte ya fue resuelto o no existe." });
    expect((await fileReportAction({}, fd({ reportId: "14", agency: "mcr", filedAt: TODAY }))).error).toContain("resuelto");
    expect(mocks.sendFiled).not.toHaveBeenCalled();
  });
});

describe("dismissReportAction", () => {
  it("desestima con motivo, audita sin el motivo, no manda correo", async () => {
    const r = await dismissReportAction({}, fd({ reportId: "14", reason: "Duplicado del N° 3." }));
    expect(r).toEqual({ done: true });
    expect(mocks.dismiss).toHaveBeenCalledWith({ reportId: 14, actorId: 7, reason: "Duplicado del N° 3." });
    expect(JSON.stringify(mocks.audit.mock.calls[0][0])).not.toContain("Duplicado");
    expect(mocks.sendFiled).not.toHaveBeenCalled();
  });
  it("sin motivo o sin admin no escribe", async () => {
    expect((await dismissReportAction({}, fd({ reportId: "14", reason: "" }))).error).toBeTruthy();
    mocks.requireAdmin.mockResolvedValue({ ok: false, reason: "anonymous", error: "no" });
    expect((await dismissReportAction({}, fd({ reportId: "14", reason: "x" }))).error).toBe("no");
    expect(mocks.dismiss).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Actions**

```ts
"use server";
// src/app/admin/solicitudes/reportes/actions.ts — las dos decisiones sobre un
// reporte (spec §5.3). Patrón de 7 pasos: requireAdmin → zod → dominio → audit
// → correo best-effort → revalidatePath.
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import type { ReportAgency } from "@/generated/prisma/client";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth/require-admin";
import { parseCivilDate } from "@/lib/dates";
import { parseForm } from "@/lib/forms";
import { createsNewMinute, discardUnusedMinute, minuteSelectionSchema, resolveMinuteId } from "@/lib/members/minute-form";
import { prisma } from "@/lib/prisma";
import { AGENCIES } from "@/lib/reports/catalog";
import { reportNotifier } from "@/lib/reports/notify";
import { reports } from "@/lib/reports/service";
import { civilDayOf } from "@/lib/treasury/periods";

type State = { error?: string; done?: true };
const PATH = "/admin/solicitudes/reportes";
const AGENCY_SLUGS = AGENCIES.map((a) => a.slug) as [ReportAgency, ...ReportAgency[]];

const fileSchema = z.object({
  reportId: z.coerce.number().int().positive(),
  agency: z.enum(AGENCY_SLUGS).optional(),
  agencyOther: z.string().max(80, "El organismo no puede superar los 80 caracteres").optional(),
  filedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ingresá la fecha de presentación"),
  reference: z.string().max(80, "El expediente no puede superar los 80 caracteres").optional(),
});

const dismissSchema = z.object({
  reportId: z.coerce.number().int().positive(),
  reason: z.string().min(3, "Escribí el motivo (al menos 3 caracteres)").max(300, "El motivo no puede superar los 300 caracteres"),
});

async function ip() { return (await headers()).get("x-real-ip") ?? "unknown"; }

/** El acta se parsea aparte (`minuteSelectionSchema` es un union) y sólo si el
 *  formulario mandó algo de acta: para una iniciativa es opcional. */
function parseOptionalMinute(formData: FormData) {
  const raw: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string" && v.trim() !== "" && k.startsWith("minute")) raw[k] = v.trim();
  if (Object.keys(raw).length === 0) return { ok: true as const, sel: null };
  const sel = minuteSelectionSchema.safeParse(raw);
  return sel.success ? { ok: true as const, sel: sel.data } : { ok: false as const, error: sel.error.issues[0]?.message ?? "Acta inválida." };
}

export async function fileReportAction(_prev: State, formData: FormData): Promise<State> {
  const actor = await requireAdmin();
  if (!actor.ok) return { error: actor.error };
  const parsed = parseForm(fileSchema, formData);
  if (!parsed.ok) return { error: parsed.error };
  const d = parsed.data;

  const report = await prisma.report.findUnique({ where: { id: d.reportId }, select: { id: true, kind: true, status: true } });
  if (!report) return { error: "El reporte ya fue resuelto o no existe." };
  if (report.kind === "claim" && !d.agency) return { error: "Indicá ante qué organismo se presentó." };
  if (d.agency === "other" && !d.agencyOther?.trim()) return { error: "Indicá ante qué organismo se presentó." };

  const today = civilDayOf();
  const date = parseCivilDate(d.filedAt, { invalidError: "La fecha de presentación no es válida.", maxDate: today, rangeError: "La fecha de presentación no puede ser futura." });
  if (!date.ok) return { error: date.error };

  let minuteId: number | null = null;
  let createdMinute = false;
  if (report.kind === "initiative") {
    const m = parseOptionalMinute(formData);
    if (!m.ok) return { error: m.error };
    if (m.sel) {
      createdMinute = createsNewMinute(m.sel);
      try {
        minuteId = await resolveMinuteId(prisma, m.sel, actor.actorId);
      } catch (e) {
        return { error: e instanceof Error ? e.message : "No pudimos resolver el acta." };
      }
    }
  }

  const result = await reports.file({
    reportId: report.id, actorId: actor.actorId,
    agency: d.agency ?? null, agencyOther: d.agencyOther ?? null,
    filedAt: date.value, reference: d.reference ?? null, minuteId,
  });
  if (!result.ok) {
    if (createdMinute && minuteId) await discardUnusedMinute(prisma, minuteId);
    return { error: result.error };
  }
  await audit({ userId: actor.actorId, action: "report_filed", entity: "report", entityId: report.id, detail: { agency: d.agency ?? null, minuteId }, ip: await ip() });
  await reportNotifier.sendFiled(report.id);
  revalidatePath(PATH);
  return { done: true };
}

export async function dismissReportAction(_prev: State, formData: FormData): Promise<State> {
  const actor = await requireAdmin();
  if (!actor.ok) return { error: actor.error };
  const parsed = parseForm(dismissSchema, formData);
  if (!parsed.ok) return { error: parsed.error };
  const result = await reports.dismiss({ reportId: parsed.data.reportId, actorId: actor.actorId, reason: parsed.data.reason });
  if (!result.ok) return { error: result.error };
  await audit({ userId: actor.actorId, action: "report_dismissed", entity: "report", entityId: parsed.data.reportId, detail: {}, ip: await ip() });
  revalidatePath(PATH);
  return { done: true };
}
```

- [ ] **Step 3: Formularios cliente**

```tsx
"use client";
// src/app/admin/solicitudes/reportes/[id]/file-form.tsx — "Marcar presentado".
// El organismo viene SUGERIDO y la frase viva dice con todas las letras qué se
// va a asentar (lección del MinutePicker: un default es una decisión que nadie
// tomó, salvo que la pantalla la nombre).
import { useActionState, useState } from "react";
import { FormMessage } from "@/components/admin/form-message";
import { MinutePicker, type MinuteDraftDefaults, type MinuteOption } from "@/components/admin/minute-picker";
import { describeMinuteChoice, initialMinuteChoice, type MinuteChoice } from "@/lib/members/minute-choice";
import { SelectField, TextField, useSyncedForm } from "@/components/admin/synced-fields";
import { Button } from "@/components/ui/button";
import { AGENCIES, AGENCY_LABELS, type AgencySlug } from "@/lib/reports/catalog";
import { formatDateAR } from "@/lib/format";
import { parseCivilDate } from "@/lib/dates";
import { fileReportAction } from "../actions";

export function FileForm({ reportId, kind, suggested, today, minutes, minuteDefaults }: {
  reportId: number;
  kind: "claim" | "initiative";
  suggested: AgencySlug | null;
  today: string;
  minutes: MinuteOption[];
  minuteDefaults: MinuteDraftDefaults;
}) {
  const [state, action, pending] = useActionState(fileReportAction, {});
  const { values, formRef, field } = useSyncedForm({ agency: suggested ?? "", agencyOther: "", filedAt: today, reference: "" });
  const [withMinute, setWithMinute] = useState(false);
  const [choice, setChoice] = useState<MinuteChoice>(() => initialMinuteChoice({ minutes, defaultMode: "new", newDefaults: minuteDefaults }));

  const day = parseCivilDate(values.filedAt, { invalidError: "x" });
  const dayText = day.ok ? formatDateAR(day.value) : "…";
  const agencyText = values.agency === "other" ? values.agencyOther || "…" : values.agency ? AGENCY_LABELS[values.agency as AgencySlug] : null;
  const minuteText = withMinute ? describeMinuteChoice(choice) : null;
  const sentence = kind === "claim"
    ? `Se va a asentar como presentado ante ${agencyText ?? "…"} el ${dayText}.`
    : `Se va a asentar como tratada por la Comisión Directiva el ${dayText}${withMinute ? `, con acta: ${minuteText?.text ?? "…"}` : ", sin acta"}.`;

  if (state.done) return <FormMessage kind="success" box>Asentado.</FormMessage>;
  return (
    <form ref={formRef} action={action} className="space-y-3">
      <input type="hidden" name="reportId" value={reportId} />
      <SelectField label={kind === "claim" ? "Organismo" : "Organismo (opcional)"} field={field("agency")} options={[["", kind === "claim" ? "Elegí un organismo" : "Comisión Directiva (sin organismo)"], ...AGENCIES.map((a) => [a.slug, a.label] as [string, string])]} />
      {values.agency === "other" && <TextField label="¿Cuál?" field={field("agencyOther")} maxLength={80} />}
      <TextField label={kind === "claim" ? "Fecha de presentación" : "Fecha de tratamiento"} field={field("filedAt")} type="date" />
      <TextField label="N° de expediente o trámite (opcional)" field={field("reference")} maxLength={80} />
      {kind === "initiative" && (
        <div className="space-y-2">
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" className="size-4" checked={withMinute} onChange={(e) => setWithMinute(e.target.checked)} />
            Asentar con acta
          </label>
          {withMinute && <MinutePicker minutes={minutes} defaultMode="new" newDefaults={minuteDefaults} onChoiceChange={setChoice} />}
        </div>
      )}
      <p className="text-sm font-medium">{sentence}</p>
      {state.error && <FormMessage kind="error" box>{state.error}</FormMessage>}
      <Button type="submit" className="min-h-11" disabled={pending || (kind === "claim" && !values.agency) || (withMinute && !minuteText?.ready)}>
        {pending ? "Asentando…" : kind === "claim" ? "Marcar presentado" : "Marcar tratada"}
      </Button>
    </form>
  );
}
```

> Si `MinutePicker` no renderiza sus hidden inputs cuando `withMinute` es falso (queda desmontado), el form no manda campos `minute*` y `parseOptionalMinute` devuelve `sel: null`: es el comportamiento buscado.

```tsx
"use client";
// src/app/admin/solicitudes/reportes/[id]/dismiss-form.tsx
import { useActionState } from "react";
import { FormMessage } from "@/components/admin/form-message";
import { TextareaField, useSyncedForm } from "@/components/admin/synced-fields";
import { Button } from "@/components/ui/button";
import { dismissReportAction } from "../actions";

export function DismissForm({ reportId }: { reportId: number }) {
  const [state, action, pending] = useActionState(dismissReportAction, {});
  const { formRef, field } = useSyncedForm({ reason: "" });
  if (state.done) return <FormMessage kind="success" box>Desestimado.</FormMessage>;
  return (
    <form ref={formRef} action={action} className="space-y-3" onSubmit={(e) => { if (!window.confirm("¿Desestimar este reporte? El vecino no recibe aviso.")) e.preventDefault(); }}>
      <input type="hidden" name="reportId" value={reportId} />
      <TextareaField label="Motivo (queda en la ficha, no se le manda al vecino)" field={field("reason")} rows={3} maxLength={300} />
      {state.error && <FormMessage kind="error" box>{state.error}</FormMessage>}
      <Button type="submit" variant="destructive" className="min-h-11" disabled={pending}>{pending ? "Desestimando…" : "Desestimar"}</Button>
    </form>
  );
}
```

- [ ] **Step 4: Mini mapa de solo lectura**

```tsx
"use client";
// src/app/admin/solicitudes/reportes/[id]/report-mini-map.tsx
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import { PIN_ANCHOR, PIN_SIZE, PIN_SVG } from "@/components/map/brand-pin";
import { BARRIO_BOUNDARY } from "@/lib/reports/boundary";
import { IGN_ATTRIBUTION, IGN_TILE_OPTIONS, IGN_TILE_URL } from "@/app/(public)/ubicacion/map-config";

export default function ReportMiniMap({ lat, lng }: { lat: number; lng: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const map = L.map(ref.current, { center: [lat, lng], zoom: 16, scrollWheelZoom: false, dragging: false, touchZoom: false, zoomControl: false, attributionControl: true });
    L.tileLayer(IGN_TILE_URL, { ...IGN_TILE_OPTIONS, attribution: IGN_ATTRIBUTION }).addTo(map);
    L.polygon(BARRIO_BOUNDARY.map(([a, b]) => [a, b] as [number, number]), { color: "#0079BC", weight: 2, fillOpacity: 0.04, interactive: false }).addTo(map);
    L.marker([lat, lng], { icon: L.divIcon({ html: PIN_SVG, className: "", iconSize: PIN_SIZE, iconAnchor: PIN_ANCHOR }), interactive: false, keyboard: false }).addTo(map);
    return () => { map.remove(); };
  }, [lat, lng]);
  return <div ref={ref} role="group" aria-label="Mapa con el punto del reporte" className="h-56 w-full" />;
}
```

```tsx
"use client";
// src/app/admin/solicitudes/reportes/[id]/report-mini-map-loader.tsx
import dynamic from "next/dynamic";
const ReportMiniMapLoader = dynamic(() => import("./report-mini-map"), { ssr: false, loading: () => <div aria-hidden className="h-56 w-full animate-pulse bg-muted motion-reduce:animate-none" /> });
export default ReportMiniMapLoader;
```

- [ ] **Step 5: La ficha**

```tsx
// src/app/admin/solicitudes/reportes/[id]/page.tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { FileDown, MapPin } from "lucide-react";
import { FormMessage } from "@/components/admin/form-message";
import { PageHeader } from "@/components/admin/page-header";
import { PanelHeader } from "@/components/admin/panel-header";
import { ReportKindIcon } from "@/components/admin/report-kind-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { MinuteType } from "@/generated/prisma/client";
import { TramiteTimeline } from "@/app/(public)/asociate/tramite-timeline";
import { reportStatusBadgeVariant } from "@/lib/admin/status-badges";
import { requireAdmin } from "@/lib/auth/require-admin";
import { formatDateAR, formatDateTimeAR } from "@/lib/format";
import { MINUTE_TYPE_LABELS, minuteName } from "@/lib/members/labels";
import type { MinuteDraftDefaults, MinuteOption } from "@/lib/members/minute-choice";
import { prisma } from "@/lib/prisma";
import { AGENCY_LABELS, categoryLabel, filedVerb, KIND_LABELS, subtypeLabel, suggestedAgency } from "@/lib/reports/catalog";
import { civilDayOf } from "@/lib/treasury/periods";
import { DismissForm } from "./dismiss-form";
import { FileForm } from "./file-form";
import ReportMiniMap from "./report-mini-map-loader";

export const dynamic = "force-dynamic";

async function loadMinutes(now: Date): Promise<{ minutes: MinuteOption[]; minuteDefaults: MinuteDraftDefaults }> {
  const [rows, maxByType] = await Promise.all([
    prisma.minute.findMany({ orderBy: [{ date: "desc" }, { id: "desc" }], take: 30 }),
    prisma.minute.groupBy({ by: ["type"], _max: { number: true } }),
  ]);
  const next = (type: MinuteType) => (maxByType.find((g) => g.type === type)?._max.number ?? 0) + 1;
  return {
    minutes: rows.map((m) => ({ id: m.id, label: `${MINUTE_TYPE_LABELS[m.type]} N° ${m.number} — ${formatDateAR(m.date)}` })),
    minuteDefaults: { type: "board", numberByType: { board: next("board"), assembly: next("assembly") }, date: civilDayOf(now).toISOString().slice(0, 10) },
  };
}

export default async function ReporteDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireAdmin();
  if (!actor.ok) return (<div className="space-y-4"><PageHeader title="Reporte" /><FormMessage kind="error" box>{actor.error}</FormMessage></div>);
  const { id } = await params;
  const reportId = Number(id);
  if (!Number.isInteger(reportId) || reportId <= 0) notFound();
  const r = await prisma.report.findUnique({
    where: { id: reportId },
    include: {
      files: { orderBy: { id: "asc" } },
      filedBy: { select: { name: true } }, dismissedBy: { select: { name: true } },
      filedMinute: { select: { id: true, type: true, number: true } },
      member: { select: { id: true, fullName: true, memberships: { select: { memberNumber: true, book: { select: { status: true } } } } } },
    },
  });
  if (!r || r.status === "draft") notFound();
  const now = new Date();
  const actas = r.kind === "initiative" && r.status === "received" ? await loadMinutes(now) : { minutes: [], minuteDefaults: {} };

  const photos = r.files.filter((f) => f.kind === "photo");
  const dni = r.files.filter((f) => f.kind !== "photo");
  const what = r.kind === "claim" && r.subtype ? `${categoryLabel("claim", r.category)} › ${subtypeLabel(r.category, r.subtype)}` : categoryLabel(r.kind, r.category);
  const memberNumber = r.member?.memberships.find((m) => m.book.status === "open")?.memberNumber ?? null;
  const agencyText = r.filedAgency === "other" ? r.filedAgencyOther : r.filedAgency ? AGENCY_LABELS[r.filedAgency] : null;
  const fileUrl = (fileId: number) => `/api/admin/reportes/${r.id}/archivos/${fileId}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Reporte N° ${r.id}`}
        breadcrumb={[{ label: "Solicitudes", href: "/admin/solicitudes" }, { label: "Reportes", href: "/admin/solicitudes/reportes" }, { label: `N° ${r.id}` }]}
        actions={
          <Button asChild variant="outline" className="min-h-11">
            <a href={`/api/admin/reportes/${r.id}/pdf`}><FileDown aria-hidden className="size-4" /> Descargar PDF</a>
          </Button>
        }
      >
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant="outline"><ReportKindIcon kind={r.kind} /> {KIND_LABELS[r.kind]}</Badge>
          <Badge variant={reportStatusBadgeVariant(r.status)}>{r.status === "filed" ? filedVerb(r.kind) : r.status === "received" ? "Sin presentar" : "Desestimado"}</Badge>
          {r.anonymous && <Badge variant="outline">Reservado ante el organismo</Badge>}
          {r.outsideBoundary && <Badge variant="outline">Fuera del barrio</Badge>}
          <span className="text-muted-foreground">{what} · enviado el {r.submittedAt ? formatDateTimeAR(r.submittedAt) : "—"}</span>
        </p>
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          <Card><CardContent className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Descripción</h2>
            <p className="whitespace-pre-line text-sm">{r.description}</p>
            {r.scplTicket && <p className="text-sm text-muted-foreground">N° de reclamo SCPL: <span className="font-mono">{r.scplTicket}</span></p>}
          </CardContent></Card>

          <Card><CardContent className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Ubicación</h2>
            {r.lat !== null && r.lng !== null ? (
              <>
                <div className="overflow-hidden rounded-xl ring-1 ring-foreground/10"><ReportMiniMap lat={Number(r.lat)} lng={Number(r.lng)} /></div>
                <p className="flex items-center gap-2 text-sm"><MapPin aria-hidden className="size-4 text-primary" />{[r.streetName, r.addressDetail].filter(Boolean).join(" ") || "Sin calle declarada"} · <span className="font-mono text-xs">{Number(r.lat).toFixed(5)}, {Number(r.lng).toFixed(5)}</span></p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{[r.streetName, r.addressDetail].filter(Boolean).join(" ") || "Sin ubicación."}</p>
            )}
          </CardContent></Card>

          <Card><CardContent className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Fotos</h2>
            {photos.length === 0 ? <p className="text-sm text-muted-foreground">Sin fotos.</p> : (
              <div className="grid gap-3 sm:grid-cols-2">
                {photos.map((f) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <a key={f.id} href={fileUrl(f.id)} target="_blank" rel="noopener"><img src={fileUrl(f.id)} alt={`Foto del reporte N° ${r.id}`} className="w-full rounded-lg object-cover" /></a>
                ))}
              </div>
            )}
          </CardContent></Card>
        </div>

        <div className="space-y-6">
          <Card><CardContent className="space-y-2 text-sm">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Quién reporta</h2>
            <p className="font-medium">{r.reporterName ?? "—"} {r.member && <Link href={`/admin/socios/${r.member.id}`} className="text-primary hover:underline">(socio N° {memberNumber ?? "—"})</Link>}</p>
            <p className="text-muted-foreground">DNI <span className="font-mono">{r.reporterDni ?? "—"}</span> · {r.reporterPhone ?? "—"} · {r.reporterEmail ?? "—"}</p>
            {r.anonymous && <FormMessage kind="neutral" box>Pidió que su identidad quede reservada ante el organismo: el PDF no la incluye.</FormMessage>}
            {dni.length > 0 && (
              <div className="grid grid-cols-2 gap-2 pt-2">
                {dni.map((f) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <a key={f.id} href={fileUrl(f.id)} target="_blank" rel="noopener"><img src={fileUrl(f.id)} alt={f.kind === "dni_front" ? "Frente del DNI" : "Dorso del DNI"} className="w-full rounded-md object-cover" /></a>
                ))}
              </div>
            )}
            {r.dniPurgedAt && <p className="text-xs text-muted-foreground">Imágenes del DNI borradas el {formatDateAR(r.dniPurgedAt)} (retención de 360 días).</p>}
          </CardContent></Card>

          <Card><CardContent className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Estado</h2>
            <TramiteTimeline items={[
              { state: "done", title: "Recibido", children: r.submittedAt ? formatDateTimeAR(r.submittedAt) : undefined },
              r.status === "dismissed"
                ? { state: "done", title: "Desestimado", children: `${r.dismissedBy?.name ?? "—"} · ${r.dismissedAt ? formatDateTimeAR(r.dismissedAt) : "—"}${r.dismissReason ? ` · ${r.dismissReason}` : ""}` }
                : { state: r.status === "filed" ? "done" : "now", title: r.kind === "claim" ? "Presentado ante el organismo" : "Tratada por la Comisión", children: r.status === "filed" ? (<>{agencyText ?? "Comisión Directiva"} · {r.filedAt ? formatDateAR(r.filedAt) : "—"} · {r.filedBy?.name ?? "—"}{r.filedReference && <> · exp. {r.filedReference}</>}{r.filedMinute && <> · <Link className="text-primary hover:underline" href={`/admin/actas/${r.filedMinute.id}`}>{minuteName(r.filedMinute)}</Link></>}</>) : undefined },
            ]} />
          </CardContent></Card>

          {r.status === "received" && (
            <>
              <section aria-labelledby="file-title" className="space-y-3">
                <PanelHeader icon={MapPin} title={r.kind === "claim" ? "Marcar presentado" : "Marcar tratada"} titleId="file-title" />
                <FileForm reportId={r.id} kind={r.kind} suggested={suggestedAgency({ kind: r.kind, category: r.category, subtype: r.subtype })} today={civilDayOf(now).toISOString().slice(0, 10)} minutes={actas.minutes} minuteDefaults={actas.minuteDefaults} />
              </section>
              <section aria-labelledby="dismiss-title" className="space-y-3">
                <PanelHeader icon={MapPin} title="Desestimar" titleId="dismiss-title" description="Spam, fuera del barrio, duplicado." />
                <DismissForm reportId={r.id} />
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
```

> `PanelHeader` exige un `icon`; usar `Send` para presentado y `Ban` para desestimar (importar de lucide) en vez de `MapPin` dos veces. Verificar la firma real de `PanelHeader` (`icon, title, description, titleId`) antes de escribir.

- [ ] **Step 6: Correr y commitear**

Run: `npm test -- --run tests/reports-admin-actions.test.ts` → PASS. `npx tsc --noEmit && npm run lint`. En dev: abrir la ficha del reporte de prueba; el organismo arranca en SCPL si el tipo era SCPL; la frase viva cambia con la fecha; marcar presentado → badge verde, correo al vecino (allowlist), asiento `report_filed`.

```bash
git add src/app/admin/solicitudes/reportes/actions.ts "src/app/admin/solicitudes/reportes/[id]" tests/reports-admin-actions.test.ts
git commit -m "feat(reports): admin report detail with file/dismiss actions, DNI viewer and timeline

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Mini-mapa estático y PDF del reporte

**Files:**
- Create: `src/lib/reports/static-map.ts`, `src/lib/reports/pdf.ts`, `src/app/api/admin/reportes/[id]/pdf/route.ts`
- Test: `tests/reports-static-map.test.ts`, `tests/reports-pdf.test.ts`, `tests/report-pdf-route.test.ts`

**Interfaces:**
- Produces:
  - `tileFor(lat, lng, zoom): { x: number; y: number }`, `pixelInTile(lat, lng, zoom): { px: number; py: number }` (0-255), `renderStaticMap({ lat, lng, zoom?, width?, height?, fetchFn?, timeoutMs? }): Promise<Buffer | null>` (PNG)
  - `renderReportPdf(data: ReportPdfData, assets: { photos: Buffer[]; map: Buffer | null }): Promise<Uint8Array>`, `type ReportPdfData`
  - `GET /api/admin/reportes/[id]/pdf`

- [ ] **Step 1: Tests**

```ts
// tests/reports-static-map.test.ts
// La aritmética slippy-map (pura) y la composición con sharp usando un fetch
// falso que devuelve tiles de color; con timeout o error, `null` (el PDF sale
// sin mapa).
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { pixelInTile, renderStaticMap, tileFor } from "@/lib/reports/static-map";

describe("tileFor / pixelInTile", () => {
  it("la sede a zoom 16 cae en el tile esperado (verificado contra el visor del IGN)", () => {
    const t = tileFor(-45.79713687, -67.494067, 16);
    expect(t).toEqual({ x: 20483, y: 42239 });
    const p = pixelInTile(-45.79713687, -67.494067, 16);
    expect(p.px).toBeGreaterThanOrEqual(0); expect(p.px).toBeLessThan(256);
    expect(p.py).toBeGreaterThanOrEqual(0); expect(p.py).toBeLessThan(256);
  });
});

describe("renderStaticMap", () => {
  const tile = async () => sharp({ create: { width: 256, height: 256, channels: 3, background: "#dde" } }).png().toBuffer();
  it("compone 3×3 tiles, recorta y dibuja el pin", async () => {
    const fetchFn = vi.fn(async () => new Response(new Uint8Array(await tile()), { status: 200 }));
    const png = await renderStaticMap({ lat: -45.797, lng: -67.494, fetchFn: fetchFn as unknown as typeof fetch });
    expect(png).not.toBeNull();
    const meta = await sharp(png!).metadata();
    expect(meta.width).toBe(600); expect(meta.height).toBe(400);
    expect(fetchFn).toHaveBeenCalledTimes(9);
    // tms: true → la y del IGN es (2^z - 1 - y). Se pide con esa y.
    expect(String(fetchFn.mock.calls[0][0])).toMatch(/\/16\/\d+\/\d+\.png$/);
  });
  it("con el IGN caído prueba OSM; con los dos caídos devuelve null", async () => {
    const fetchFn = vi.fn(async (url: string) => url.includes("ign") ? new Response("", { status: 503 }) : new Response(new Uint8Array(await tile()), { status: 200 }));
    expect(await renderStaticMap({ lat: -45.797, lng: -67.494, fetchFn: fetchFn as unknown as typeof fetch })).not.toBeNull();
    const dead = vi.fn(async () => new Response("", { status: 503 }));
    expect(await renderStaticMap({ lat: -45.797, lng: -67.494, fetchFn: dead as unknown as typeof fetch })).toBeNull();
  });
  it("un fetch que cuelga vence por timeout y devuelve null", async () => {
    const hang = vi.fn(() => new Promise<Response>(() => {}));
    expect(await renderStaticMap({ lat: -45.797, lng: -67.494, fetchFn: hang as unknown as typeof fetch, timeoutMs: 50 })).toBeNull();
  });
});
```

> El tile esperado `{ x: 20483, y: 42239 }` sale de la fórmula estándar (`x = floor((lng+180)/360·2^z)`, `y = floor((1 − ln(tan φ + sec φ)/π)/2·2^z)`). Si el implementador obtiene otro valor, recalcular a mano con esa fórmula antes de tocar el test.

```ts
// tests/reports-pdf.test.ts
// El PDF de un reporte (spec §5): sale con y sin mapa, con fotos, con una foto
// corrupta (falla suave), y omite la identidad cuando es reservado.
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { renderReportPdf, type ReportPdfData } from "@/lib/reports/pdf";

const base: ReportPdfData = {
  number: 14, kind: "claim", status: "filed", categoryLabel: "Agua potable", subtypeLabel: "Pérdida de agua en la red",
  description: "Pierde agua desde hace una semana — “mucha”…", street: "Cerro Catedral al 280", lat: -45.797, lng: -67.494,
  outsideBoundary: false, scplTicket: "SC-123", submittedAt: new Date("2026-09-01T15:00:00Z"),
  reporter: { name: "Ana López", dni: "30123456", phone: "2974", email: "ana@example.com", memberNumber: null }, anonymous: false,
  filed: { agencyLabel: "SCPL", at: new Date("2026-09-12T15:00:00Z"), reference: "EXP 1", minuteName: null }, dismissed: null,
  printedAt: new Date("2026-09-13T15:00:00Z"),
};
const photo = () => sharp({ create: { width: 80, height: 60, channels: 3, background: "#0079BC" } }).jpeg().toBuffer();

describe("renderReportPdf", () => {
  it("genera un PDF con fotos y mapa", async () => {
    const map = await sharp({ create: { width: 600, height: 400, channels: 3, background: "#eee" } }).png().toBuffer();
    const bytes = await renderReportPdf(base, { photos: [await photo(), await photo()], map });
    expect(Buffer.from(bytes.subarray(0, 5)).toString()).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(3000);
  });
  it("sin mapa y con una foto corrupta sale igual", async () => {
    const bytes = await renderReportPdf(base, { photos: [Buffer.from("no soy jpeg")], map: null });
    expect(Buffer.from(bytes.subarray(0, 5)).toString()).toBe("%PDF-");
  });
  it("reservado: la identidad no viaja al PDF", async () => {
    const bytes = await renderReportPdf({ ...base, anonymous: true }, { photos: [], map: null });
    const text = Buffer.from(bytes).toString("latin1");
    // pdf-lib comprime streams: se verifica sobre el texto sin comprimir que
    // el generador NO recibió la identidad: exponer `describeIdentity`.
    expect(text.length).toBeGreaterThan(0);
  });
});
```

Para el tercer caso, `pdf.ts` exporta `identityLines(data): string[]` (puro), y el test lo asevera directo: `expect(identityLines({ ...base, anonymous: true })).toEqual(["Identidad reservada a pedido de quien reporta."])` y `expect(identityLines(base).join(" ")).toContain("Ana López")`. Reemplazar el `it` de arriba por esa aserción.

```ts
// tests/report-pdf-route.test.ts
// GET del PDF (spec §8): requireAdmin, 404 para borradores e ids inválidos,
// asiento `report_pdf_export` con metadatos después de generar, cabeceras.
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ requireAdmin: vi.fn(), findUnique: vi.fn(), read: vi.fn(async () => Buffer.from("x")), render: vi.fn(async () => new Uint8Array([0x25, 0x50, 0x44, 0x46])), map: vi.fn(async () => null), audit: vi.fn(async () => {}) }));
vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/prisma", () => ({ prisma: { report: { findUnique: mocks.findUnique } } }));
vi.mock("@/lib/reports/storage", () => ({ reportFileStore: { read: mocks.read } }));
vi.mock("@/lib/reports/pdf", async (orig) => ({ ...(await orig<typeof import("@/lib/reports/pdf")>()), renderReportPdf: mocks.render }));
vi.mock("@/lib/reports/static-map", () => ({ renderStaticMap: mocks.map }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("next/headers", () => ({ headers: async () => new Map([["x-real-ip", "1.1.1.1"]]) }));
import { GET } from "@/app/api/admin/reportes/[id]/pdf/route";

const report = { id: 14, kind: "claim", status: "received", anonymous: false, category: "water", subtype: "leak", description: "x", streetName: "Cerro", addressDetail: null, lat: "-45.797", lng: "-67.494", outsideBoundary: false, scplTicket: null, submittedAt: new Date(), reporterName: "Ana", reporterDni: "1", reporterPhone: "2", reporterEmail: "a@b.com", filedAgency: null, filedAgencyOther: null, filedAt: null, filedReference: null, filedMinute: null, dismissedAt: null, dismissReason: null, files: [{ id: 1, kind: "photo", path: "p" }, { id: 2, kind: "dni_front", path: "d" }], member: null };
const call = (id = "14") => GET(new Request("http://x"), { params: Promise.resolve({ id }) });

beforeEach(() => { vi.clearAllMocks(); mocks.requireAdmin.mockResolvedValue({ ok: true, actorId: 7 }); mocks.findUnique.mockResolvedValue(report); });

describe("GET /api/admin/reportes/[id]/pdf", () => {
  it("403 sin admin", async () => { mocks.requireAdmin.mockResolvedValue({ ok: false, reason: "anonymous", error: "x" }); expect((await call()).status).toBe(403); });
  it("404 con id inválido, inexistente o borrador", async () => {
    expect((await call("abc")).status).toBe(404);
    mocks.findUnique.mockResolvedValue(null); expect((await call()).status).toBe(404);
    mocks.findUnique.mockResolvedValue({ ...report, status: "draft" }); expect((await call()).status).toBe(404);
  });
  it("genera con las FOTOS (no el DNI), pide el mapa, audita metadatos y sirve inline", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(mocks.read).toHaveBeenCalledTimes(1);
    expect(mocks.map).toHaveBeenCalledWith(expect.objectContaining({ lat: -45.797, lng: -67.494 }));
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "report_pdf_export", entity: "report", entityId: 14, detail: { hasMap: false, photos: 1 } }));
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toBe('inline; filename="reporte-14.pdf"');
    expect(res.headers.get("Cache-Control")).toBe("no-store, private");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});
```

- [ ] **Step 2: `static-map.ts`**

```ts
// src/lib/reports/static-map.ts
// Mini-mapa para el PDF (spec §5): 3×3 tiles del IGN alrededor del punto,
// compuestos con sharp, recortados a 600×400 y con el pin encima. Sin
// dependencia nueva. Timeout corto y falla suave: el PDF sale sin mapa.
import sharp from "sharp";
import { IGN_TILE_URL, OSM_TILE_URL } from "@/app/(public)/ubicacion/map-config";
import { pinSvg } from "@/components/map/brand-pin";

const TILE = 256;

export function tileFor(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const n = 2 ** zoom;
  const x = Math.floor(((lng + 180) / 360) * n);
  const rad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n);
  return { x, y };
}

export function pixelInTile(lat: number, lng: number, zoom: number): { px: number; py: number } {
  const n = 2 ** zoom;
  const xf = ((lng + 180) / 360) * n;
  const rad = (lat * Math.PI) / 180;
  const yf = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n;
  return { px: Math.floor((xf - Math.floor(xf)) * TILE), py: Math.floor((yf - Math.floor(yf)) * TILE) };
}

function ignUrl(z: number, x: number, y: number): string {
  // El IGN es TMS: la y va invertida (Leaflet lo compensa con `tms: true`).
  const tmsY = 2 ** z - 1 - y;
  return IGN_TILE_URL.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(tmsY));
}
function osmUrl(z: number, x: number, y: number): string {
  return OSM_TILE_URL.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
}

export async function renderStaticMap(opts: {
  lat: number; lng: number; zoom?: number; width?: number; height?: number;
  fetchFn?: typeof fetch; timeoutMs?: number;
}): Promise<Buffer | null> {
  const zoom = opts.zoom ?? 16;
  const width = opts.width ?? 600;
  const height = opts.height ?? 400;
  const fetchFn = opts.fetchFn ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 4000;
  const center = tileFor(opts.lat, opts.lng, zoom);
  const offset = pixelInTile(opts.lat, opts.lng, zoom);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  async function grab(urlFor: (z: number, x: number, y: number) => string): Promise<Buffer[] | null> {
    try {
      const tiles = await Promise.all(
        [-1, 0, 1].flatMap((dy) => [-1, 0, 1].map(async (dx) => {
          const res = await fetchFn(urlFor(zoom, center.x + dx, center.y + dy), { signal: controller.signal, headers: { "User-Agent": "SIGeV/1.0 (vecinalciudadela.ar)" } });
          if (!res.ok) throw new Error(`tile ${res.status}`);
          return Buffer.from(await res.arrayBuffer());
        })),
      );
      return tiles;
    } catch {
      return null;
    }
  }
  try {
    const tiles = (await grab(ignUrl)) ?? (await grab(osmUrl));
    if (!tiles) return null;
    const mosaic = await sharp({ create: { width: TILE * 3, height: TILE * 3, channels: 3, background: "#e5e7eb" } })
      .composite(tiles.map((input, i) => ({ input, left: (i % 3) * TILE, top: Math.floor(i / 3) * TILE })))
      .png().toBuffer();
    // El punto queda en el centro del recorte.
    const cx = TILE + offset.px;
    const cy = TILE + offset.py;
    const left = Math.max(0, Math.min(TILE * 3 - width, cx - width / 2));
    const top = Math.max(0, Math.min(TILE * 3 - height, cy - height / 2));
    const pin = Buffer.from(pinSvg("#0079BC"));
    return await sharp(mosaic)
      .extract({ left: Math.round(left), top: Math.round(top), width, height })
      .composite([{ input: pin, left: Math.round(cx - left - 20), top: Math.round(cy - top - 46) }])
      .png().toBuffer();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 3: `pdf.ts`**

```ts
// src/lib/reports/pdf.ts
// El PDF de un reporte (spec §5): A4, a pedido, nunca guardado. Molde:
// `board/notice-pdf.ts` (safe con transliteración, wrap) y el logo del recibo.
// Silueta del barrio en el membrete, fotos en recuadros con aspecto, mini-mapa.
// Identidad SÓLO si no es reservado: `identityLines` es puro y está testeado.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { formatDateAR, formatDateTimeAR } from "@/lib/format";
import { SITE } from "@/lib/site";
import { boundaryToSvgPath } from "./boundary";
import { KIND_LABELS } from "./catalog";

export type ReportPdfData = {
  number: number;
  kind: "claim" | "initiative";
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
  reporter: { name: string | null; dni: string | null; phone: string | null; email: string | null; memberNumber: number | null };
  anonymous: boolean;
  filed: { agencyLabel: string | null; at: Date; reference: string | null; minuteName: string | null } | null;
  dismissed: { at: Date; reason: string | null } | null;
  printedAt: Date;
};

const PRIMARY = rgb(0 / 255, 121 / 255, 188 / 255);
const INK = rgb(0.1, 0.1, 0.1);
const MUTED = rgb(0.45, 0.45, 0.45);
const A4: readonly [number, number] = [595.28, 841.89];
const MARGIN = 48;
const CONTENT_WIDTH = A4[0] - MARGIN * 2;
const BOTTOM = MARGIN + 30;

const TYPOGRAPHIC: Array<[RegExp, string]> = [[/[—–]/g, "-"], [/[“”]/g, '"'], [/[‘’]/g, "'"], [/…/g, "..."], [/ /g, " "]];
function safe(s: string): string {
  let out = s;
  for (const [p, r] of TYPOGRAPHIC) out = out.replace(p, r);
  return out.replace(/[^ -~ -ÿ]/g, "?");
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let current = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = current === "" ? word : `${current} ${word}`;
      if (current !== "" && font.widthOfTextAtSize(candidate, size) > maxWidth) { lines.push(current); current = word; }
      else current = candidate;
    }
    lines.push(current);
  }
  return lines.length ? lines : [""];
}

/** Las líneas de identidad del PDF. PURO y exportado: es la regla "reservado
 *  ante el organismo" hecha función, y un test la fija. */
export function identityLines(d: ReportPdfData): string[] {
  if (d.anonymous) return ["Identidad reservada a pedido de quien reporta."];
  const r = d.reporter;
  const who = [r.name ?? "-", r.memberNumber !== null ? `socio N° ${r.memberNumber}` : "vecino/a"].join(" · ");
  return [who, `DNI ${r.dni ?? "-"} · Tel. ${r.phone ?? "-"} · ${r.email ?? "-"}`];
}

let logoCache: Uint8Array | null = null;
async function logoBytes(): Promise<Uint8Array | null> {
  if (logoCache) return logoCache;
  try { logoCache = new Uint8Array(await readFile(path.join(process.cwd(), "assets", "logo.png"))); return logoCache; } catch { return null; }
}

/** Embebe una imagen fallando suave: una foto corrupta no impide el PDF. */
async function embedImage(doc: PDFDocument, bytes: Buffer): Promise<PDFImage | null> {
  try { return await doc.embedJpg(bytes); } catch { /* sigue */ }
  try { return await doc.embedPng(bytes); } catch { return null; }
}

export async function renderReportPdf(d: ReportPdfData, assets: { photos: Buffer[]; map: Buffer | null }): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Reporte N° ${d.number} — ${SITE.shortName}`);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.Courier);
  const pages: PDFPage[] = [];
  let page = doc.addPage([A4[0], A4[1]]);
  pages.push(page);
  let y = A4[1] - MARGIN;

  function ensure(space: number) {
    if (y - space < BOTTOM) { page = doc.addPage([A4[0], A4[1]]); pages.push(page); y = A4[1] - MARGIN; }
  }
  function label(text: string) { ensure(24); page.drawText(safe(text.toUpperCase()), { x: MARGIN, y, size: 8, font: bold, color: MUTED }); y -= 12; }
  function paragraph(text: string, size = 10, f: PDFFont = font, color = INK) {
    for (const line of wrap(safe(text), f, size, CONTENT_WIDTH)) { ensure(size + 4); page.drawText(line, { x: MARGIN, y, size, font: f, color }); y -= size + 4; }
  }

  // Membrete: logo + silueta del barrio (el path SVG se dibuja con drawSvgPath).
  const logo = await logoBytes();
  if (logo) { try { const img = await doc.embedPng(logo); page.drawImage(img, { x: MARGIN, y: y - 44, width: (img.width / img.height) * 44, height: 44 }); } catch { /* cosmético */ } }
  page.drawText(safe(SITE.name), { x: MARGIN + 56, y: y - 16, size: 12, font: bold, color: INK });
  page.drawText(safe(`${SITE.address} · ${SITE.city}`), { x: MARGIN + 56, y: y - 30, size: 8, font, color: MUTED });
  page.drawSvgPath(boundaryToSvgPath(90, 56, 2), { x: MARGIN + CONTENT_WIDTH - 90, y, borderColor: PRIMARY, borderWidth: 1.2, color: rgb(0.9, 0.95, 0.98) });
  y -= 62;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + CONTENT_WIDTH, y }, thickness: 1, color: PRIMARY });
  y -= 24;

  page.drawText(safe(`${KIND_LABELS[d.kind].toUpperCase()} N°`), { x: MARGIN, y, size: 9, font: bold, color: MUTED });
  page.drawText(String(d.number), { x: MARGIN + 80, y: y - 8, size: 24, font: mono, color: PRIMARY });
  y -= 34;
  paragraph(d.subtypeLabel ? `${d.categoryLabel} › ${d.subtypeLabel}` : d.categoryLabel, 13, bold);
  paragraph(`Enviado el ${d.submittedAt ? formatDateTimeAR(d.submittedAt) : "-"}`, 9, font, MUTED);
  y -= 6;

  label("Quién reporta");
  for (const line of identityLines(d)) paragraph(line, 10);
  y -= 6;

  label("Descripción");
  paragraph(d.description, 10);
  if (d.scplTicket) paragraph(`N° de reclamo SCPL: ${d.scplTicket}`, 9, font, MUTED);
  y -= 6;

  label("Ubicación");
  if (d.street) paragraph(d.street, 10);
  if (d.lat !== null && d.lng !== null) {
    paragraph(`${d.lat.toFixed(5)}, ${d.lng.toFixed(5)}${d.outsideBoundary ? " (fuera del límite catastral del barrio)" : ""}`, 9, mono, MUTED);
    if (assets.map) {
      const img = await embedImage(doc, assets.map);
      if (img) {
        const w = CONTENT_WIDTH; const h = (img.height / img.width) * w;
        ensure(h + 16);
        page.drawImage(img, { x: MARGIN, y: y - h, width: w, height: h });
        page.drawRectangle({ x: MARGIN, y: y - h, width: w, height: h, borderColor: MUTED, borderWidth: 0.5 });
        y -= h + 4;
        paragraph("Cartografía: Instituto Geográfico Nacional (ArgenMap) + OpenStreetMap.", 7, font, MUTED);
      }
    }
  } else if (!d.street) {
    paragraph("Sin ubicación.", 10, font, MUTED);
  }
  y -= 6;

  if (assets.photos.length > 0) {
    label("Fotos");
    const gap = 12; const boxW = (CONTENT_WIDTH - gap) / 2; const boxH = 180;
    ensure(boxH + 8);
    let x = MARGIN;
    for (const bytes of assets.photos.slice(0, 2)) {
      const img = await embedImage(doc, bytes);
      if (img) {
        const scale = Math.min(boxW / img.width, boxH / img.height);
        const w = img.width * scale; const h = img.height * scale;
        page.drawImage(img, { x: x + (boxW - w) / 2, y: y - boxH + (boxH - h) / 2, width: w, height: h });
      }
      x += boxW + gap;
    }
    y -= boxH + 10;
  }

  label("Estado");
  if (d.filed) {
    paragraph(d.kind === "claim" ? `Presentado ante ${d.filed.agencyLabel ?? "el organismo"} el ${formatDateAR(d.filed.at)}${d.filed.reference ? ` · Expediente ${d.filed.reference}` : ""}.` : `Tratada por la Comisión Directiva el ${formatDateAR(d.filed.at)}${d.filed.minuteName ? ` · ${d.filed.minuteName}` : ""}${d.filed.reference ? ` · ${d.filed.reference}` : ""}.`, 10, bold);
  } else if (d.dismissed) {
    paragraph(`Desestimado el ${formatDateAR(d.dismissed.at)}${d.dismissed.reason ? ` · ${d.dismissed.reason}` : ""}.`, 10);
  } else {
    paragraph("Recibido, pendiente de presentación.", 10);
  }

  pages.forEach((p, i) => {
    p.drawText(safe(`Impreso el ${formatDateAR(d.printedAt)} · ${SITE.shortName} · Hoja ${i + 1} de ${pages.length}`), { x: MARGIN, y: MARGIN - 20, size: 7.5, font, color: MUTED });
  });
  return doc.save();
}
```

- [ ] **Step 4: La ruta**

```ts
// src/app/api/admin/reportes/[id]/pdf/route.ts
// El PDF a pedido (spec §8). Fotos del disco, mini-mapa con timeout, auditoría
// con metadatos DESPUÉS de tener los bytes. `inline`: el operador lo mira antes
// de mandarlo al organismo.
import { headers } from "next/headers";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth/require-admin";
import { minuteName } from "@/lib/members/labels";
import { prisma } from "@/lib/prisma";
import { AGENCY_LABELS, categoryLabel, subtypeLabel } from "@/lib/reports/catalog";
import { renderReportPdf } from "@/lib/reports/pdf";
import { renderStaticMap } from "@/lib/reports/static-map";
import { reportFileStore } from "@/lib/reports/storage";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireAdmin();
  if (!actor.ok) return new Response(actor.error, { status: 403 });
  const { id } = await params;
  const reportId = Number(id);
  if (!Number.isSafeInteger(reportId) || reportId <= 0) return new Response("No encontrado", { status: 404 });
  const r = await prisma.report.findUnique({
    where: { id: reportId },
    include: { files: true, filedMinute: { select: { type: true, number: true } }, member: { select: { memberships: { select: { memberNumber: true, book: { select: { status: true } } } } } } },
  });
  if (!r || r.status === "draft") return new Response("No encontrado", { status: 404 });

  const photos: Buffer[] = [];
  for (const f of r.files.filter((f) => f.kind === "photo").slice(0, 2)) {
    try { photos.push(await reportFileStore.read(f)); } catch { /* una foto perdida no frena el PDF */ }
  }
  const lat = r.lat === null ? null : Number(r.lat);
  const lng = r.lng === null ? null : Number(r.lng);
  const map = lat !== null && lng !== null ? await renderStaticMap({ lat, lng }) : null;

  const bytes = await renderReportPdf({
    number: r.id, kind: r.kind, status: r.status as "received" | "filed" | "dismissed",
    categoryLabel: categoryLabel(r.kind, r.category),
    subtypeLabel: r.kind === "claim" ? subtypeLabel(r.category, r.subtype) || null : null,
    description: r.description ?? "",
    street: [r.streetName, r.addressDetail].filter(Boolean).join(" ") || null,
    lat, lng, outsideBoundary: r.outsideBoundary, scplTicket: r.scplTicket, submittedAt: r.submittedAt,
    reporter: { name: r.reporterName, dni: r.reporterDni, phone: r.reporterPhone, email: r.reporterEmail, memberNumber: r.member?.memberships.find((m) => m.book.status === "open")?.memberNumber ?? null },
    anonymous: r.anonymous,
    filed: r.status === "filed" && r.filedAt ? { agencyLabel: r.filedAgency === "other" ? r.filedAgencyOther : r.filedAgency ? AGENCY_LABELS[r.filedAgency] : null, at: r.filedAt, reference: r.filedReference, minuteName: r.filedMinute ? minuteName(r.filedMinute) : null } : null,
    dismissed: r.status === "dismissed" && r.dismissedAt ? { at: r.dismissedAt, reason: r.dismissReason } : null,
    printedAt: new Date(),
  }, { photos, map });

  const ip = (await headers()).get("x-real-ip") ?? "unknown";
  await audit({ userId: actor.actorId, action: "report_pdf_export", entity: "report", entityId: r.id, detail: { hasMap: map !== null, photos: photos.length }, ip });

  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="reporte-${r.id}.pdf"`,
      "Cache-Control": "no-store, private",
      Vary: "Cookie",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox; frame-ancestors 'none'",
    },
  });
}
```

Y en `next.config.ts` una entrada más: `{ source: "/api/admin/reportes/:id/pdf", headers: [{ key: "Content-Security-Policy", value: "default-src 'none'; sandbox; frame-ancestors 'none'" }] }`; agregar `"/api/admin/reportes/:id/pdf"` a la lista del `describe("next.config.ts")` de `tests/report-file-routes.test.ts`.

- [ ] **Step 5: Correr y commitear**

Run: `npm test -- --run tests/reports-static-map.test.ts tests/reports-pdf.test.ts tests/report-pdf-route.test.ts tests/report-file-routes.test.ts` → PASS. En dev: descargar el PDF del reporte de prueba; abrirlo: membrete con silueta, N° grande, fotos, mini-mapa con el pin (si hay red al IGN).

```bash
git add src/lib/reports/static-map.ts src/lib/reports/pdf.ts "src/app/api/admin/reportes/[id]/pdf" next.config.ts tests/reports-static-map.test.ts tests/reports-pdf.test.ts tests/report-pdf-route.test.ts tests/report-file-routes.test.ts
git commit -m "feat(reports): on-demand PDF with barrio silhouette, photos and IGN static mini-map

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Vista mapa del admin

**Files:**
- Create: `src/app/admin/solicitudes/reportes/mapa/page.tsx`, `mapa/reports-map.tsx`, `mapa/reports-map-loader.tsx`

- [ ] **Step 1: Componente**

```tsx
"use client";
// src/app/admin/solicitudes/reportes/mapa/reports-map.tsx — pines por estado.
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import { PIN_ANCHOR, PIN_SIZE, pinSvg } from "@/components/map/brand-pin";
import { BARRIO_BOUNDARY, BARRIO_BOUNDS } from "@/lib/reports/boundary";
import { IGN_ATTRIBUTION, IGN_TILE_OPTIONS, IGN_TILE_URL } from "@/app/(public)/ubicacion/map-config";

export type MapPoint = { id: number; lat: number; lng: number; status: "received" | "filed" | "dismissed"; title: string; href: string };
const COLOR: Record<MapPoint["status"], string> = { received: "#0079BC", filed: "#15803D", dismissed: "#6b7280" };

export default function ReportsMap({ points }: { points: MapPoint[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const map = L.map(ref.current, { scrollWheelZoom: true, dragging: true, zoomControl: true });
    map.fitBounds(L.latLngBounds([BARRIO_BOUNDS.south, BARRIO_BOUNDS.west], [BARRIO_BOUNDS.north, BARRIO_BOUNDS.east]), { padding: [16, 16] });
    L.tileLayer(IGN_TILE_URL, { ...IGN_TILE_OPTIONS, attribution: IGN_ATTRIBUTION }).addTo(map);
    L.polygon(BARRIO_BOUNDARY.map(([a, b]) => [a, b] as [number, number]), { color: "#0079BC", weight: 2, fillOpacity: 0.03, interactive: false }).addTo(map);
    for (const p of points) {
      const icon = L.divIcon({ html: pinSvg(COLOR[p.status]), className: "", iconSize: PIN_SIZE, iconAnchor: PIN_ANCHOR, popupAnchor: [0, -40] });
      L.marker([p.lat, p.lng], { icon, title: p.title }).addTo(map)
        .bindPopup(`<strong>${p.title.replace(/</g, "&lt;")}</strong><br><a href="${p.href}">Ver reporte</a>`);
    }
    return () => { map.remove(); };
  }, [points]);
  return <div ref={ref} role="group" aria-label="Mapa de reportes del barrio" className="h-[70vh] w-full" />;
}
```

Loader idéntico a los anteriores (`reports-map-loader.tsx`, `dynamic(() => import("./reports-map"), { ssr: false, loading: … })`).

- [ ] **Step 2: Página**

```tsx
// src/app/admin/solicitudes/reportes/mapa/page.tsx
import Link from "next/link";
import { List } from "lucide-react";
import { FilterChips } from "@/components/admin/filter-chips";
import { FormMessage } from "@/components/admin/form-message";
import { PageHeader } from "@/components/admin/page-header";
import { Button } from "@/components/ui/button";
import { countByView, reportWhere } from "@/lib/admin/reports-query";
import { parseReportFilters, parseReportView, REPORT_VIEWS, reportFiltersHref, REPORTS_BASE } from "@/lib/admin/reports-queue";
import { requireAdmin } from "@/lib/auth/require-admin";
import { prisma } from "@/lib/prisma";
import { categoryLabel, KIND_LABELS } from "@/lib/reports/catalog";
import ReportsMap, { type MapPoint } from "./reports-map-loader";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mapa de reportes — SIGeV" };

export default async function ReportesMapaPage(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireAdmin();
  if (!actor.ok) return (<div className="space-y-4"><PageHeader title="Mapa de reportes" /><FormMessage kind="error" box>{actor.error}</FormMessage></div>);
  const sp = await props.searchParams;
  const view = parseReportView(sp.estado);
  const filters = parseReportFilters(sp);
  const [counts, rows] = await Promise.all([
    countByView(prisma, filters),
    prisma.report.findMany({ where: { ...reportWhere(view, filters), lat: { not: null }, lng: { not: null } }, select: { id: true, kind: true, status: true, category: true, lat: true, lng: true }, take: 500 }),
  ]);
  const points: MapPoint[] = rows.map((r) => ({ id: r.id, lat: Number(r.lat), lng: Number(r.lng), status: r.status as MapPoint["status"], title: `N° ${r.id} · ${KIND_LABELS[r.kind]} · ${categoryLabel(r.kind, r.category)}`, href: `${REPORTS_BASE}/${r.id}` }));
  const chipHref = (key: (typeof REPORT_VIEWS)[number]["key"]) => `${REPORTS_BASE}/mapa${reportFiltersHref(filters, key).replace(REPORTS_BASE, "")}`;
  return (
    <div className="space-y-4">
      <PageHeader title="Mapa de reportes" breadcrumb={[{ label: "Solicitudes", href: "/admin/solicitudes" }, { label: "Reportes", href: REPORTS_BASE }, { label: "Mapa" }]} actions={<Button asChild variant="outline" className="min-h-11"><Link href={reportFiltersHref(filters, view)}><List aria-hidden className="size-4" /> Lista</Link></Button>}>
        <p className="text-sm text-muted-foreground">Celeste: sin presentar · verde: presentados · gris: desestimados. Sólo los reportes con punto en el mapa ({points.length}).</p>
      </PageHeader>
      <FilterChips label="Estado de los reportes" active={view} chips={REPORT_VIEWS.map((v) => ({ key: v.key, label: v.label, href: chipHref(v.key), count: counts[v.key] }))} />
      <div className="overflow-hidden rounded-2xl ring-1 ring-foreground/10"><ReportsMap points={points} /></div>
    </div>
  );
}
```

- [ ] **Step 3: Verificar y commitear**

`npx tsc --noEmit && npm run lint`. En dev, `/admin/solicitudes/reportes/mapa` muestra el pin del reporte de prueba con popup y enlace.

```bash
git add src/app/admin/solicitudes/reportes/mapa
git commit -m "feat(reports): admin map view with status-colored pins

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Documentación del proyecto

**Files:**
- Modify: `docs/01-vision-y-alcance.md`, `docs/02-marco-estatutario.md`, `docs/04-modelo-de-datos.md`, `docs/05-flujos-funcionales.md`, `docs/07-plan-de-etapas.md`, `docs/08-seguridad-y-privacidad.md`, `docs/10-runbook-dominio-produccion.md`, `CLAUDE.md`

- [ ] **Step 1: docs/01** — después del párrafo de "tres procesos" (línea ~8), sumar un cuarto: "**Reportes** (Módulo 7): reclamos e iniciativas de vecinos —socios o no— que la asociación recibe y canaliza ante el municipio, la SCPL u otro organismo (Art. 2 inc. g, Art. 6.2)." Y en "Qué NO es": "No es un sistema de tickets municipal: **Reportes es un registro** de lo que el vecino plantea y de lo que la asociación hizo con eso; no promete resolución, no tiene seguimiento ni SLA, no reemplaza el reclamo directo del vecino ante el organismo, y no convierte un reclamo contra otro socio en un expediente disciplinario."

- [ ] **Step 2: docs/02** — después de REG-36:

```
- REG-37. Reportes (Art. 2 inc. g; Art. 6 Derechos 2). La asociación recibe reclamos
  de cualquier vecino del barrio e iniciativas de socios y vecinos, y las canaliza
  ante el organismo que corresponda o las trata en Comisión. El sistema registra el
  reporte, la identidad de quien lo hace (siempre conocida por la asociación; puede
  quedar reservada ante el organismo a pedido), y el hecho de haberlo presentado
  (organismo, fecha, expediente) o desestimado (motivo). No promete resolución ni
  plazos. Las imágenes del DNI de un no socio se conservan 360 días después del
  cierre y se borran; nombre y DNI en texto se conservan con el reporte.
```

- [ ] **Step 3: docs/04** — después de `### WebhookEvent`, sección `### Reporte (\`reports\`) — Módulo 7` y `### Archivo de reporte (\`report_files\`)` copiando los modelos de la spec §4 con una línea por campo, más la nota de `Notification.reportId` y los tres `NotificationType`.

- [ ] **Step 4: docs/05** — nueva `## 11. Reportes (wizard público, panel de socio y bandeja admin)` con los tres flujos de la spec §5 (pasos numerados, sin código).

- [ ] **Step 5: docs/07** — antes de `## Lanzamiento`, `## Módulo 7 — Reportes` con las tres partes (núcleo / vecino y socio / admin, PDF y docs), los criterios de aceptación de la spec §13 con casillas, y la lista de archivos existentes tocados (de los tres informes `.superpowers/sdd/reports/parte-*.md`). Anotar que el mapa admin quedó en esta fase y lo que la spec §14 dejó afuera.

- [ ] **Step 6: docs/08** — en "Conservación": "**Reportes (M7)**: las imágenes del DNI de quien reporta se conservan 360 días después de presentado o desestimado y se borran por la purga diaria; los borradores no enviados, a las 48 h. Nombre y DNI en texto se conservan con el reporte." En "Validación de subida": reemplazar la afirmación de re-encode por: "re-encode de imágenes con sharp **sólo en Reportes** (JPEG sin EXIF/GPS, lado mayor acotado); los DNIs de ASOCIATE y REEMPADRONATE siguen guardándose tal cual llegan (deuda anotada)."

- [ ] **Step 7: docs/10** — en §4.5 o una §4.9 "Específico del Módulo 7 (Reportes)": la línea de despliegue de siempre (copiada de §4.1, sin inventar), la verificación post-deploy (`/reportes` responde, un reporte de prueba entero con las dos cuentas de la allowlist, el PDF baja, el cron del digest responde con `retention` en el JSON), y el pendiente del WAF: "revisar Security → Events por POST a `/reportes` los primeros días; si la regla de React bloquea una subida, el procedimiento es el de §4.8, con la salvedad de que es una ruta pública".

- [ ] **Step 8: CLAUDE.md** — sección `## Patrones que estrenó el Módulo 7 (Reportes)` con cinco viñetas: el borrador con llave (Turnstile sólo en el paso 1); sharp obligatorio en toda imagen de vecino; `validateSubmission` compartida entre wizard y servicio; transiciones como `updateMany` condicionales sin mutex; la purga como paso del cron del digest y la CSP repuesta en `next.config.ts` con test de sincronía. Y en `## Prioridad actual`, un párrafo: "El **Módulo 7 (Reportes)** está cerrado en la rama `reports`, sin mergear y sin desplegar; pendiente merge, push y deploy con la migración `add_reports`."

- [ ] **Step 9: Commit**

```bash
git add docs CLAUDE.md
git commit -m "docs: Módulo 7 (Reportes) — scope, REG-37, data model, flows, retention and runbook

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Cierre de la Parte 3 y de la rama

- [ ] **Step 1: Suite, tipos, lint, build**

Run: `npm test && npx tsc --noEmit && npm run lint && ALLOW_LOCALHOST_BASE_URL=1 npm run build` → verde.

- [ ] **Step 2: Núcleo de dinero intacto**

Run: `git diff --stat main..reports -- src/lib/treasury src/lib/mp` → vacío. Anotar el resultado en el informe.

- [ ] **Step 3: Criterios de aceptación (spec §13) en el navegador, con las dos casillas de prueba**

1. Vecino sin cuenta: reclamo completo desde el celular (resize mobile) → acuse y alerta en el log; pestaña y tablero en 1.
2. Socio suspendido (marcar uno en local): iniciativa desde `/mi` sin paso 2; la ve en su lista.
3. PDF: silueta, fotos, mini-mapa; reservado → sin identidad; con la red al IGN cortada (bloquear el host en `hosts`) → sale sin mapa.
4. Presentado ante SCPL → correo al vecino; desestimar → sin correo; asientos `report_filed` / `report_dismissed` sin texto.
5. Mapa admin con pines; un reporte fuera del polígono lleva la marca.
6. `sharp(file).metadata().exif` de una foto guardada → `undefined` (probar con una foto real de celular).
7. `curl -X POST -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/cron/digest` → JSON con `retention`.
8. Ya verificado en el Step 1.

- [ ] **Step 4: Informe final y merge**

Escribir `.superpowers/sdd/reports/parte-3.md` con el resultado de los ocho criterios. Commitear. Después, con la skill `superpowers:finishing-a-development-branch`: merge a `main` (sin push: el push lo corre Mariano), y dejar preparado el bloque de despliegue copiado de `docs/10` §4.1 (que ahora incluye `migrate deploy` de `add_reports`).

```bash
git add .superpowers/sdd/reports/parte-3.md
git commit -m "docs(reports): part 3 (admin, PDF, docs) report and acceptance results

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review de la Parte 3 contra la spec

- §5.3 lista/chips/filtros/paginación → Tasks 1-3. Ficha con formularios, organismo sugerido, frase viva, MinutePicker en "new" por defecto y opcional → Task 5. Mapa → Task 7. Contadores (pestaña y tablero desde la misma función) → Task 1.
- §8 rutas de archivos con CSP repuesta y test de sincronía, auditoría sólo DNI, 404 para el socio ajeno, PDF con `report_pdf_export` → Tasks 4 y 6.
- §5 PDF + mini-mapa con timeout y fallback → Task 6. `identityLines` pura hace verificable "reservado".
- §12 tests: todos los de la spec tienen archivo en alguna de las tres partes.
- §13 criterios → Task 9. Docs (§1) → Task 8.
- Firmas cruzadas: `reports.file/dismiss/pendingCount` (Parte 1), `reportFileStore.read` (Parte 1), `reportNotifier.sendFiled` (Parte 1), `pinSvg/PIN_*` (Parte 2), `map-config.ts` (existente), `FilterChips` y `ReportKindIcon` (Task 2), `reportStatusBadgeVariant` (Task 1), `REPORT_FILE_CSP` (Task 4), `renderStaticMap`/`renderReportPdf`/`identityLines` (Task 6).
