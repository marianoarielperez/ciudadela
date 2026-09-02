# Reportes — Parte 1 de 3: núcleo del dominio — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dejar listo todo lo que el módulo Reportes necesita por debajo de las pantallas: catálogo, polígono del barrio, tablas, reglas, storage con sharp, servicio, correos, retención y la sección del resumen diario.

**Architecture:** Módulo aislado en `src/lib/reports/*` con tablas propias (`reports`, `report_files`) y `db` inyectado en cada factory. Sin una sola pantalla: la Parte 2 (vecino y socio) y la Parte 3 (admin, PDF, docs) se apoyan en las firmas de este plan. Las únicas modificaciones a archivos existentes son aditivas: `schema.prisma`, `rate-limiter.ts`, `labels.ts` (etiquetas de `NotificationType`), `email/index.ts` (`sendToReport`), `email/templates.ts` (tres plantillas), `admin/digest.ts` (una sección) y `api/cron/digest/route.ts` (la purga).

**Tech Stack:** Next.js 16, TypeScript, Prisma 7 sobre MariaDB (`@prisma/adapter-mariadb`), sharp 0.35 (ya instalado), zod 4, Vitest 4.

**Spec:** `docs/superpowers/specs/2026-09-01-reportes-design.md`. Las decisiones del operador están en su §2; este plan no las reabre.

## Global Constraints

- Rama `reports`. Un commit por tarea, mensaje en inglés, `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` al final.
- Código, nombres, tablas y commits en inglés; UI, mensajes y comentarios en castellano rioplatense ("vos").
- **Cero dependencias nuevas.** sharp, leaflet, pdf-lib y zod ya están en `package.json`.
- **Ni un archivo de `src/lib/treasury/*` ni de `src/lib/mp/*` se toca** (se verifica con `git diff --stat main..reports -- src/lib/treasury src/lib/mp` al cerrar cada parte: tiene que estar vacío).
- Migraciones con `npx prisma migrate dev --name <nombre>`, **nunca `db push`**. Valores nuevos de un enum van **al final** de la lista (MariaDB guarda el índice).
- Los módulos de `src/lib/reports/*` que no necesitan Prisma **no lo importan**; los que sí, reciben `db` inyectado (`Pick<PrismaClient, …>`) y exportan un singleton armado con `prisma` al final. `@/lib/prisma` tira al evaluarse sin `DATABASE_URL`: un test puro que lo importe se cae.
- Auditoría con `audit()` y `detail` de ids, códigos y conteos: **nunca** nombre, DNI, email, teléfono, descripción ni rutas de archivo (Ley 25.326). Logs con `codeOf(e)`, nunca la dirección.
- Un bloqueo por `EMAIL_ALLOWLIST` (`ALLOWLIST_BLOCK_CODE`) **no es un fallo**.
- Nada de red ni de disco dentro de una `$transaction` (timeout de 5 s).
- Tests en `tests/*.test.ts` (carpeta plana, kebab-case), con un comentario de cabecera que diga qué se fija y por qué. Los dobles de base **honran el `where`** que reciben.
- Comandos: `npm test -- --run <archivo>` para un test, `npm test` para la suite, `npm run lint`, `npx tsc --noEmit` para tipos (no hay script `typecheck`).
- Antes de arrancar: `git checkout reports && git pull` no aplica (repo local); verificar `git branch --show-current` = `reports`.

---

### Task 1: Catálogo puro de categorías, tipos y organismos

**Files:**
- Create: `src/lib/reports/catalog.ts`
- Test: `tests/reports-catalog.test.ts`

**Interfaces:**
- Produces:
  - `type ReportKindSlug = "claim" | "initiative"`
  - `type AgencySlug = "mcr" | "scpl" | "council" | "province" | "camuzzi" | "other"`
  - `type ReportIconName` (unión de strings; el mapa a Lucide vive en un componente cliente de la Parte 2)
  - `CLAIM_CATEGORIES: readonly ClaimCategory[]`, `INITIATIVE_CATEGORIES: readonly InitiativeCategory[]`, `AGENCIES: readonly { slug: AgencySlug; label: string }[]`
  - `findClaimCategory(slug)`, `findInitiativeCategory(slug)`, `findSubtype(categorySlug, subtypeSlug)`, `isScplSubtype(categorySlug, subtypeSlug)`
  - `suggestedAgency({ kind, category, subtype })`
  - `KIND_LABELS`, `STATUS_LABELS`, `AGENCY_LABELS`, `filedVerb(kind)`, `categoryLabel(kind, slug)`, `subtypeLabel(categorySlug, subtypeSlug)`
  - `SCPL_WHATSAPP = { display, href }`

- [ ] **Step 1: Escribir el test que falla**

```ts
// tests/reports-catalog.test.ts
// El catálogo de Reportes es la ÚNICA fuente de categorías, tipos y organismos
// (spec §3). Lo que se fija acá: la lista que dio el operador el 01/09/2026 —con
// sus tipos SCPL—, que "Otro reporte" no tiene tipos, que cada slug es único, y
// que el organismo sugerido sale del tipo (SCPL) o del reclamo (MCR).
import { describe, expect, it } from "vitest";
import {
  AGENCIES, CLAIM_CATEGORIES, INITIATIVE_CATEGORIES, KIND_LABELS, STATUS_LABELS,
  categoryLabel, filedVerb, findClaimCategory, findSubtype, isScplSubtype,
  subtypeLabel, suggestedAgency, SCPL_WHATSAPP,
} from "@/lib/reports/catalog";

describe("CLAIM_CATEGORIES", () => {
  it("son las ocho categorías del operador, en su orden", () => {
    expect(CLAIM_CATEGORIES.map((c) => c.slug)).toEqual([
      "water", "sewage", "electricity", "waste", "streets", "trees", "transport", "other",
    ]);
  });

  it("los slugs de categorías y de tipos son únicos", () => {
    const slugs = CLAIM_CATEGORIES.map((c) => c.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const c of CLAIM_CATEGORIES) {
      const sub = c.subtypes.map((s) => s.slug);
      expect(new Set(sub).size, c.slug).toBe(sub.length);
    }
  });

  it("'Otro reporte' no tiene tipos: va directo a la descripción", () => {
    expect(findClaimCategory("other")?.subtypes).toEqual([]);
  });

  it("los tipos SCPL son exactamente los que marcó el operador", () => {
    const scpl = CLAIM_CATEGORIES.flatMap((c) =>
      c.subtypes.filter((s) => s.scpl).map((s) => `${c.slug}/${s.slug}`),
    );
    expect(scpl).toEqual([
      "water/no_water", "water/low_pressure", "water/leak",
      "sewage/blocked", "sewage/internal_overflow", "sewage/manhole_overflow", "sewage/manhole_cover",
      "electricity/voltage", "electricity/streetlight", "electricity/pole",
    ]);
    expect(isScplSubtype("water", "leak")).toBe(true);
    expect(isScplSubtype("water", "other")).toBe(false);
    expect(isScplSubtype("waste", "dump")).toBe(false);
  });

  it("Árboles y espacios verdes no tiene 'Otro' (lista del operador tal cual)", () => {
    expect(findClaimCategory("trees")?.subtypes.map((s) => s.slug)).toEqual([
      "pruning", "fall_risk", "roots", "green_space",
    ]);
  });

  it("findSubtype devuelve null para combinaciones que no existen", () => {
    expect(findSubtype("water", "pothole")).toBeNull();
    expect(findSubtype("nope", "leak")).toBeNull();
    expect(findSubtype("streets", "pothole")?.label).toBe("Baches / pozos en calzada");
  });
});

describe("INITIATIVE_CATEGORIES", () => {
  it("son las seis aprobadas", () => {
    expect(INITIATIVE_CATEGORIES.map((c) => c.slug)).toEqual([
      "social", "cultural", "sports", "works", "safety", "other",
    ]);
  });
});

describe("AGENCIES y suggestedAgency", () => {
  it("lista fija con 'Otro' al final", () => {
    expect(AGENCIES.map((a) => a.slug)).toEqual(["mcr", "scpl", "council", "province", "camuzzi", "other"]);
  });

  it("un tipo SCPL sugiere SCPL; el resto de los reclamos, MCR; una iniciativa, nada", () => {
    expect(suggestedAgency({ kind: "claim", category: "water", subtype: "leak" })).toBe("scpl");
    expect(suggestedAgency({ kind: "claim", category: "water", subtype: "other" })).toBe("mcr");
    expect(suggestedAgency({ kind: "claim", category: "streets", subtype: "pothole" })).toBe("mcr");
    expect(suggestedAgency({ kind: "claim", category: "other", subtype: null })).toBe("mcr");
    expect(suggestedAgency({ kind: "initiative", category: "social", subtype: null })).toBeNull();
  });
});

describe("etiquetas", () => {
  it("KIND_LABELS y STATUS_LABELS cubren los enums", () => {
    expect(KIND_LABELS).toEqual({ claim: "Reclamo", initiative: "Iniciativa" });
    expect(STATUS_LABELS).toEqual({
      draft: "Borrador", received: "Recibido", filed: "Presentado", dismissed: "Desestimado",
    });
  });

  it("el segundo estado se lee distinto por tipo", () => {
    expect(filedVerb("claim")).toBe("Presentado");
    expect(filedVerb("initiative")).toBe("Tratada");
  });

  it("categoryLabel y subtypeLabel caen a un texto neutro si el slug no existe", () => {
    expect(categoryLabel("claim", "water")).toBe("Agua potable");
    expect(categoryLabel("initiative", "works")).toBe("Obras e infraestructura");
    expect(categoryLabel("claim", "zzz")).toBe("Sin categoría");
    expect(subtypeLabel("water", "leak")).toBe("Pérdida de agua en la red");
    expect(subtypeLabel("water", null)).toBe("");
  });

  it("el WhatsApp del bot de la SCPL es el que dio el operador", () => {
    expect(SCPL_WHATSAPP.display).toBe("+54 9 2975 26-0760");
    expect(SCPL_WHATSAPP.href).toBe("https://wa.me/5492975260760");
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -- --run tests/reports-catalog.test.ts`
Expected: FAIL — `Cannot find module '@/lib/reports/catalog'`.

- [ ] **Step 3: Escribir el catálogo**

```ts
// src/lib/reports/catalog.ts
// Catálogo de Reportes (Módulo 7, spec §3). Módulo PURO: sin Prisma, sin React,
// sin lucide. Es la ÚNICA fuente de categorías, tipos, organismos y etiquetas:
// el wizard público, el panel del socio, la bandeja admin, el PDF y los correos
// leen de acá. Los íconos viajan como NOMBRE (`ReportIconName`); el mapa a
// componentes de lucide vive en un componente cliente, como `nav-icons.ts`.
//
// La lista de reclamos la dio el operador el 01/09/2026 (calcada de Comodoro
// Reporta, con "Semáforos" fuera y "Otro reporte" como salida libre). Los tipos
// con `scpl: true` son los que el vecino puede y debe reclamar TAMBIÉN ante la
// SCPL por WhatsApp; el wizard lo avisa y pide el número de reclamo.

export type ReportKindSlug = "claim" | "initiative";
export type ReportStatusSlug = "draft" | "received" | "filed" | "dismissed";
export type AgencySlug = "mcr" | "scpl" | "council" | "province" | "camuzzi" | "other";

export type ReportIconName =
  | "droplets" | "waves" | "zap" | "trash-2" | "traffic-cone" | "tree-deciduous"
  | "bus-front" | "message-square-warning"
  | "users" | "palette" | "trophy" | "hard-hat" | "shield" | "lightbulb";

export type ClaimSubtype = { slug: string; label: string; scpl?: true };
export type ClaimCategory = {
  slug: string;
  label: string;
  icon: ReportIconName;
  /** Vacío = la categoría no tiene tipos y el vecino va directo a la descripción. */
  subtypes: readonly ClaimSubtype[];
};
export type InitiativeCategory = { slug: string; label: string; icon: ReportIconName };

export const CLAIM_CATEGORIES: readonly ClaimCategory[] = [
  {
    slug: "water", label: "Agua potable", icon: "droplets",
    subtypes: [
      { slug: "no_water", label: "Falta de agua", scpl: true },
      { slug: "low_pressure", label: "Falta presión de agua", scpl: true },
      { slug: "leak", label: "Pérdida de agua en la red", scpl: true },
      { slug: "other", label: "Otro" },
    ],
  },
  {
    slug: "sewage", label: "Cloacas y saneamiento", icon: "waves",
    subtypes: [
      { slug: "blocked", label: "Cloacas tapadas", scpl: true },
      { slug: "internal_overflow", label: "Desborde interno", scpl: true },
      { slug: "manhole_overflow", label: "Desborde en boca de registro", scpl: true },
      { slug: "manhole_cover", label: "Tapa de registro en malas condiciones", scpl: true },
      { slug: "other", label: "Otro" },
    ],
  },
  {
    slug: "electricity", label: "Electricidad y luminarias", icon: "zap",
    subtypes: [
      { slug: "voltage", label: "Problemas de tensión", scpl: true },
      { slug: "streetlight", label: "Falta de alumbrado público / luminaria quemada", scpl: true },
      { slug: "pole", label: "Poste dañado / peligro en vía pública", scpl: true },
      { slug: "other", label: "Otro" },
    ],
  },
  {
    slug: "waste", label: "Residuos", icon: "trash-2",
    subtypes: [
      { slug: "general", label: "Residuos generales" },
      { slug: "vacant_lot", label: "Residuos en terrenos / baldíos" },
      { slug: "dump", label: "Basural a cielo abierto / microbasural" },
      { slug: "other", label: "Otro" },
    ],
  },
  {
    slug: "streets", label: "Calles y vía pública", icon: "traffic-cone",
    subtypes: [
      { slug: "pothole", label: "Baches / pozos en calzada" },
      { slug: "dirt_road", label: "Calle de tierra en mal estado" },
      { slug: "sidewalk", label: "Veredas rotas" },
      { slug: "other", label: "Otro" },
    ],
  },
  {
    slug: "trees", label: "Árboles y espacios verdes", icon: "tree-deciduous",
    subtypes: [
      { slug: "pruning", label: "Poda de árboles" },
      { slug: "fall_risk", label: "Árbol en riesgo de caída" },
      { slug: "roots", label: "Raíces levantando veredas / viviendas" },
      { slug: "green_space", label: "Falta de mantenimiento de espacios verdes" },
    ],
  },
  {
    slug: "transport", label: "Transporte público", icon: "bus-front",
    subtypes: [
      { slug: "no_shelter", label: "Falta de garitas / refugios" },
      { slug: "no_signage", label: "Falta de señalización de paradas" },
      { slug: "shelter_damaged", label: "Garitas / refugios en mal estado" },
      { slug: "other", label: "Otro" },
    ],
  },
  { slug: "other", label: "Otro reporte", icon: "message-square-warning", subtypes: [] },
];

export const INITIATIVE_CATEGORIES: readonly InitiativeCategory[] = [
  { slug: "social", label: "Social", icon: "users" },
  { slug: "cultural", label: "Cultural", icon: "palette" },
  { slug: "sports", label: "Deportiva", icon: "trophy" },
  { slug: "works", label: "Obras e infraestructura", icon: "hard-hat" },
  { slug: "safety", label: "Seguridad", icon: "shield" },
  { slug: "other", label: "Otra", icon: "lightbulb" },
];

export const AGENCIES: readonly { slug: AgencySlug; label: string }[] = [
  { slug: "mcr", label: "Municipalidad de Comodoro Rivadavia (MCR)" },
  { slug: "scpl", label: "SCPL" },
  { slug: "council", label: "Concejo Deliberante" },
  { slug: "province", label: "Provincia del Chubut" },
  { slug: "camuzzi", label: "Camuzzi" },
  { slug: "other", label: "Otro" },
];

export const AGENCY_LABELS: Record<AgencySlug, string> = Object.fromEntries(
  AGENCIES.map((a) => [a.slug, a.label]),
) as Record<AgencySlug, string>;

export const KIND_LABELS: Record<ReportKindSlug, string> = {
  claim: "Reclamo",
  initiative: "Iniciativa",
};

export const STATUS_LABELS: Record<ReportStatusSlug, string> = {
  draft: "Borrador",
  received: "Recibido",
  filed: "Presentado",
  dismissed: "Desestimado",
};

/** El segundo estado se LEE distinto según el tipo (spec §2): un reclamo se
 *  presenta ante un organismo; una iniciativa la trata la Comisión (Art. 6.2). */
export function filedVerb(kind: ReportKindSlug): "Presentado" | "Tratada" {
  return kind === "claim" ? "Presentado" : "Tratada";
}

export function findClaimCategory(slug: string | null | undefined): ClaimCategory | null {
  return CLAIM_CATEGORIES.find((c) => c.slug === slug) ?? null;
}

export function findInitiativeCategory(slug: string | null | undefined): InitiativeCategory | null {
  return INITIATIVE_CATEGORIES.find((c) => c.slug === slug) ?? null;
}

export function findSubtype(
  categorySlug: string | null | undefined,
  subtypeSlug: string | null | undefined,
): ClaimSubtype | null {
  const category = findClaimCategory(categorySlug);
  if (!category) return null;
  return category.subtypes.find((s) => s.slug === subtypeSlug) ?? null;
}

export function isScplSubtype(categorySlug: string | null, subtypeSlug: string | null): boolean {
  return findSubtype(categorySlug, subtypeSlug)?.scpl === true;
}

/** El organismo con el que arranca el formulario de "presentado" (spec §2,
 *  "sugerido y visible"): SCPL cuando el tipo es SCPL, MCR para cualquier otro
 *  reclamo, y ninguno para una iniciativa (la trata la Comisión). */
export function suggestedAgency(input: {
  kind: ReportKindSlug;
  category: string | null;
  subtype: string | null;
}): AgencySlug | null {
  if (input.kind === "initiative") return null;
  return isScplSubtype(input.category, input.subtype) ? "scpl" : "mcr";
}

const NO_CATEGORY = "Sin categoría";

export function categoryLabel(kind: ReportKindSlug, slug: string | null | undefined): string {
  const hit = kind === "claim" ? findClaimCategory(slug) : findInitiativeCategory(slug);
  return hit?.label ?? NO_CATEGORY;
}

export function subtypeLabel(
  categorySlug: string | null | undefined,
  subtypeSlug: string | null | undefined,
): string {
  return findSubtype(categorySlug, subtypeSlug)?.label ?? "";
}

/** El bot de reclamos de la SCPL por WhatsApp (operador, 01/09/2026). */
export const SCPL_WHATSAPP = {
  display: "+54 9 2975 26-0760",
  href: "https://wa.me/5492975260760",
} as const;
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test -- --run tests/reports-catalog.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/reports/catalog.ts tests/reports-catalog.test.ts
git commit -m "feat(reports): pure catalog of categories, subtypes, agencies and labels

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Polígono del barrio (KML → constante pura)

**Files:**
- Create: `src/lib/reports/boundary.ts`
- Test: `tests/reports-boundary.test.ts`
- Reads (no modifica): `datos/limites-barrio.kml`

**Interfaces:**
- Produces:
  - `BARRIO_BOUNDARY: ReadonlyArray<readonly [number, number]>` — `[lat, lng]`, anillo cerrado (el último = el primero)
  - `BARRIO_BOUNDS: { south, north, west, east }`, `BARRIO_CENTER: readonly [number, number]`
  - `isInsideBoundary(lat: number, lng: number): boolean`
  - `boundaryToSvgPath(width: number, height: number, padding?: number): string`

- [ ] **Step 1: Escribir el test que falla**

```ts
// tests/reports-boundary.test.ts
// El polígono del barrio Ciudadela transcripto de `datos/limites-barrio.kml`
// (spec §3.4). Se fija: que la constante coincide vértice por vértice con el KML
// del repo (si alguien actualiza el archivo sin tocar la constante, esto lo
// dice), que la sede cae adentro, que el centro de la ciudad cae afuera, y que
// el path SVG de la silueta se arma dentro del viewBox pedido.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SITE } from "@/lib/site";
import {
  BARRIO_BOUNDARY, BARRIO_BOUNDS, BARRIO_CENTER, boundaryToSvgPath, isInsideBoundary,
} from "@/lib/reports/boundary";

function kmlRing(): Array<[number, number]> {
  const xml = readFileSync(path.resolve(import.meta.dirname, "..", "datos", "limites-barrio.kml"), "utf8");
  const raw = /<coordinates>([\s\S]*?)<\/coordinates>/.exec(xml)?.[1] ?? "";
  return raw.trim().split(/\s+/).map((triple) => {
    const [lng, lat] = triple.split(",").map(Number);
    return [lat, lng];
  });
}

describe("BARRIO_BOUNDARY", () => {
  it("coincide vértice por vértice con datos/limites-barrio.kml (lat, lng)", () => {
    const ring = kmlRing();
    expect(BARRIO_BOUNDARY.length).toBe(ring.length);
    ring.forEach(([lat, lng], i) => {
      expect(BARRIO_BOUNDARY[i][0]).toBeCloseTo(lat, 9);
      expect(BARRIO_BOUNDARY[i][1]).toBeCloseTo(lng, 9);
    });
  });

  it("es un anillo cerrado", () => {
    expect(BARRIO_BOUNDARY[0]).toEqual(BARRIO_BOUNDARY[BARRIO_BOUNDARY.length - 1]);
  });

  it("la caja envolvente y el centro salen del anillo", () => {
    expect(BARRIO_BOUNDS.south).toBeLessThan(BARRIO_BOUNDS.north);
    expect(BARRIO_BOUNDS.west).toBeLessThan(BARRIO_BOUNDS.east);
    expect(BARRIO_CENTER[0]).toBeGreaterThan(BARRIO_BOUNDS.south);
    expect(BARRIO_CENTER[0]).toBeLessThan(BARRIO_BOUNDS.north);
  });
});

describe("isInsideBoundary", () => {
  it("la sede vecinal está adentro", () => {
    expect(isInsideBoundary(SITE.lat, SITE.lng)).toBe(true);
  });
  it("el centro de Comodoro está afuera", () => {
    expect(isInsideBoundary(-45.8647, -67.4823)).toBe(false);
  });
  it("un punto justo fuera de la caja está afuera", () => {
    expect(isInsideBoundary(BARRIO_BOUNDS.north + 0.001, BARRIO_CENTER[1])).toBe(false);
  });
});

describe("boundaryToSvgPath", () => {
  it("arma un path cerrado con un punto por vértice, dentro del viewBox", () => {
    const d = boundaryToSvgPath(200, 120, 4);
    expect(d.startsWith("M")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
    const numbers = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
    const xs = numbers.filter((_, i) => i % 2 === 0);
    const ys = numbers.filter((_, i) => i % 2 === 1);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(4);
    expect(Math.max(...xs)).toBeLessThanOrEqual(196);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(4);
    expect(Math.max(...ys)).toBeLessThanOrEqual(116);
    // Un vértice por punto del anillo sin el cierre repetido.
    expect(xs.length).toBe(BARRIO_BOUNDARY.length - 1);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -- --run tests/reports-boundary.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Escribir el módulo**

```ts
// src/lib/reports/boundary.ts
// El límite del barrio Ciudadela, transcripto de `datos/limites-barrio.kml`
// (Placemark "Ciudadela", zona 14, circ. 5, sector 2; 20 vértices). Módulo PURO.
//
// Lo usan: el picker de ubicación del wizard (dibuja el contorno y encuadra el
// mapa), el mapa del admin, la silueta de la landing y del PDF, y
// `isInsideBoundary`, que marca `outsideBoundary` al enviar (spec §2: avisa y
// deja enviar; el admin ve la marca).
//
// Un test coteja esta constante contra el KML del repo, así que si el catastro
// cambia el archivo hay que tocar los dos.

/** Anillo cerrado en `[lat, lng]` (el KML viene como `lng,lat,0`). */
export const BARRIO_BOUNDARY: ReadonlyArray<readonly [number, number]> = [
  [-45.7966490548311, -67.5203381725855],
  [-45.7966335782021, -67.5203280279532],
  [-45.7928430848157, -67.5188696590574],
  [-45.7940202415481, -67.51334411454209],
  [-45.794915604367, -67.5089586426202],
  [-45.7953025975264, -67.5066823686993],
  [-45.7949679125177, -67.4990625336321],
  [-45.7947383310676, -67.49232330385411],
  [-45.796607286277, -67.4911369235349],
  [-45.7969768316563, -67.4908421414154],
  [-45.7973467462658, -67.4904607117541],
  [-45.7984235741003, -67.491202922399],
  [-45.7988017803042, -67.49389473238961],
  [-45.7987891434985, -67.4989238432735],
  [-45.8004740087592, -67.4990030629226],
  [-45.8008571551678, -67.4998220744812],
  [-45.8000257329911, -67.50169155484549],
  [-45.7985520854542, -67.5080535847346],
  [-45.79863034344049, -67.5139613348763],
  [-45.7966490548311, -67.5203381725855],
];

const lats = BARRIO_BOUNDARY.map((p) => p[0]);
const lngs = BARRIO_BOUNDARY.map((p) => p[1]);

export const BARRIO_BOUNDS = {
  south: Math.min(...lats),
  north: Math.max(...lats),
  west: Math.min(...lngs),
  east: Math.max(...lngs),
} as const;

export const BARRIO_CENTER: readonly [number, number] = [
  (BARRIO_BOUNDS.south + BARRIO_BOUNDS.north) / 2,
  (BARRIO_BOUNDS.west + BARRIO_BOUNDS.east) / 2,
];

/** Ray casting clásico (par-impar). Un punto sobre el borde puede caer de
 *  cualquiera de los dos lados: no importa, la marca es un aviso, no una guarda. */
export function isInsideBoundary(lat: number, lng: number): boolean {
  if (lat < BARRIO_BOUNDS.south || lat > BARRIO_BOUNDS.north) return false;
  if (lng < BARRIO_BOUNDS.west || lng > BARRIO_BOUNDS.east) return false;
  let inside = false;
  const n = BARRIO_BOUNDARY.length - 1; // el último repite al primero
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [yi, xi] = BARRIO_BOUNDARY[i];
    const [yj, xj] = BARRIO_BOUNDARY[j];
    const crosses = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

/** La silueta del barrio como `d` de un `<path>` SVG que entra en `width`×`height`
 *  con `padding` de margen, conservando la proporción (proyección equirrectangular
 *  corregida por la latitud media: a 45° S un grado de longitud mide ~0,7 de uno
 *  de latitud, y sin la corrección el barrio sale aplastado). */
export function boundaryToSvgPath(width: number, height: number, padding = 4): string {
  const cos = Math.cos((BARRIO_CENTER[0] * Math.PI) / 180);
  const pts = BARRIO_BOUNDARY.slice(0, -1).map(([lat, lng]) => ({ x: lng * cos, y: -lat }));
  const minX = Math.min(...pts.map((p) => p.x));
  const maxX = Math.max(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y));
  const maxY = Math.max(...pts.map((p) => p.y));
  const scale = Math.min((width - padding * 2) / (maxX - minX), (height - padding * 2) / (maxY - minY));
  const offsetX = (width - (maxX - minX) * scale) / 2;
  const offsetY = (height - (maxY - minY) * scale) / 2;
  const fmt = (n: number) => n.toFixed(2);
  return (
    pts
      .map((p, i) => {
        const x = fmt(offsetX + (p.x - minX) * scale);
        const y = fmt(offsetY + (p.y - minY) * scale);
        return `${i === 0 ? "M" : "L"}${x} ${y}`;
      })
      .join(" ") + " Z"
  );
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test -- --run tests/reports-boundary.test.ts`
Expected: PASS (7 tests). Si "la sede está adentro" falla, revisar que las coordenadas se transcribieron como `[lat, lng]` y no al revés.

- [ ] **Step 5: Commit**

```bash
git add src/lib/reports/boundary.ts tests/reports-boundary.test.ts
git commit -m "feat(reports): barrio boundary polygon with point-in-polygon and SVG silhouette

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Schema, migración aditiva y etiquetas de notificación

**Files:**
- Modify: `prisma/schema.prisma` (enums nuevos al final del bloque de enums, `NotificationType` +3 valores AL FINAL antes de `generic`… ver nota, modelos `Report` y `ReportFile`, relación en `Notification`, `Member`, `User`, `Minute`, `Street`)
- Create: `prisma/migrations/<timestamp>_add_reports/migration.sql` (la genera Prisma; se le agrega el comentario de cabecera)
- Modify: `src/lib/members/labels.ts` (`NOTIFICATION_TYPE_LABELS` +3)

**Interfaces:**
- Produces (tipos generados en `@/generated/prisma/client`): `ReportKind`, `ReportStatus`, `ReportFileKind`, `ReportAgency`, `Report`, `ReportFile`, `PrismaClient["report"]`, `PrismaClient["reportFile"]`, `Notification.reportId`, `NotificationType` con `report_received | report_filed | report_board_alert`.

> Nota sobre el orden en `NotificationType`: el enum termina en `generic`. Los tres valores nuevos van **después de `generic`**, o sea al final absoluto: un `MODIFY ENUM` que los intercale antes de `generic` corre el índice de las filas que ya son `generic` (los reenvíos del enlace de retome). La regla es "al final", no "antes del comodín".

- [ ] **Step 1: Agregar enums y modelos al schema**

En `prisma/schema.prisma`, dentro del bloque de enums (después de `InstitutionalDocumentType`), agregar:

```prisma
// ── Módulo 7: Reportes (reclamos e iniciativas, Art. 2 inc. g y Art. 6.2) ──
enum ReportKind {
  claim
  initiative
}

// `draft` es el borrador que nace al terminar el paso 1 del wizard (spec §5.1):
// existe para que las fotos y el DNI tengan dueño mientras el vecino completa
// el resto. Un borrador nunca enviado se purga a las 48 h (retention.ts).
// `filed` se LEE "presentado" para un reclamo y "tratada" para una iniciativa.
enum ReportStatus {
  draft
  received
  filed
  dismissed
}

enum ReportFileKind {
  photo
  dni_front
  dni_back
}

enum ReportAgency {
  mcr
  scpl
  council
  province
  camuzzi
  other
}
```

En `enum NotificationType`, agregar **al final, después de `generic`**:

```prisma
  // M7 (Reportes): acuse al que reporta, aviso al presentar o tratar, y la
  // alerta inmediata a la Comisión. Tipos propios y no `generic` por el mismo
  // motivo que los de M6: poder contarlos y buscarlos aparte.
  report_received
  report_filed
  report_board_alert
```

En `model Notification`, después de `boardNoticeId`/`boardNotice`, agregar:

```prisma
  // M7: aviso dirigido a un REPORTE (el acuse a un vecino que no es socio, o la
  // alerta a la Comisión sobre ese reporte). `SetNull` como `applicationId`.
  reportId       Int?               @map("report_id")
  report         Report?            @relation(fields: [reportId], references: [id], onDelete: SetNull)
```

Agregar los dos modelos al final del archivo:

```prisma
// Módulo 7 — Reportes: reclamos (Art. 2 inc. g, de VECINOS, socios o no) e
// iniciativas (Art. 6.2, evaluadas por la CD). Es un REGISTRO de lo que el
// vecino plantea y de lo que la asociación hizo con eso; no es un sistema de
// tickets ni promete resolución (docs/01). Spec 2026-09-01-reportes-design.md.
//
// La identidad es una FOTO al momento de reportar (para el socio se copia de su
// ficha al crear el borrador): el PDF dice quién reportó ese día. `anonymous`
// es "reservado ante el organismo": la asociación siempre conoce la identidad;
// el PDF y la presentación la omiten.
//
// Tablas propias y no `Document` polimórfico (decisión de arquitectura, spec
// §2): la purga de los DNI a los 360 días y el ancho/alto para el PDF piden
// columnas que `documents` no tiene, y "documento personal validable" no es lo
// mismo que "foto de un bache".
model Report {
  id               Int            @id @default(autoincrement())
  kind             ReportKind
  status           ReportStatus   @default(draft)
  anonymous        Boolean        @default(false)
  memberId         Int?           @map("member_id")
  member           Member?        @relation(fields: [memberId], references: [id], onDelete: SetNull)
  reporterName     String?        @map("reporter_name") @db.VarChar(160)
  reporterDni      String?        @map("reporter_dni") @db.VarChar(12)
  reporterPhone    String?        @map("reporter_phone") @db.VarChar(40)
  reporterEmail    String?        @map("reporter_email") @db.VarChar(191)
  consentAt        DateTime?      @map("consent_at")
  category         String?        @db.VarChar(40)
  subtype          String?        @db.VarChar(60)
  description      String?        @db.VarChar(2000)
  lat              Decimal?       @db.Decimal(9, 6)
  lng              Decimal?       @db.Decimal(9, 6)
  outsideBoundary  Boolean        @default(false) @map("outside_boundary")
  streetId         Int?           @map("street_id")
  street           Street?        @relation(fields: [streetId], references: [id], onDelete: SetNull)
  streetName       String?        @map("street_name") @db.VarChar(120)
  addressDetail    String?        @map("address_detail") @db.VarChar(160)
  scplTicket       String?        @map("scpl_ticket") @db.VarChar(40)
  // sha256 de la llave del borrador (spec §5.1). Sólo el hash; el crudo viaja
  // una vez, en la URL del wizard.
  claimTokenHash   String?        @unique @map("claim_token_hash") @db.Char(64)
  submittedAt      DateTime?      @map("submitted_at")
  filedAt          DateTime?      @map("filed_at")
  filedById        Int?           @map("filed_by_id")
  filedBy          User?          @relation("ReportFiledBy", fields: [filedById], references: [id], onDelete: SetNull)
  filedAgency      ReportAgency?  @map("filed_agency")
  filedAgencyOther String?        @map("filed_agency_other") @db.VarChar(80)
  filedReference   String?        @map("filed_reference") @db.VarChar(80)
  filedMinuteId    Int?           @map("filed_minute_id")
  filedMinute      Minute?        @relation("ReportFiledMinute", fields: [filedMinuteId], references: [id], onDelete: SetNull)
  dismissedAt      DateTime?      @map("dismissed_at")
  dismissedById    Int?           @map("dismissed_by_id")
  dismissedBy      User?          @relation("ReportDismissedBy", fields: [dismissedById], references: [id], onDelete: SetNull)
  dismissReason    String?        @map("dismiss_reason") @db.VarChar(300)
  dniPurgedAt      DateTime?      @map("dni_purged_at")
  ip               String?        @db.VarChar(45)
  userAgent        String?        @map("user_agent") @db.VarChar(255)
  createdAt        DateTime       @default(now()) @map("created_at")
  updatedAt        DateTime       @updatedAt @map("updated_at")
  files            ReportFile[]
  notifications    Notification[]

  @@index([status, kind])
  @@index([memberId, status])
  @@index([submittedAt])
  @@map("reports")
}

// Un archivo de un reporte, YA re-codificado por sharp (siempre JPEG, sin EXIF:
// docs/08). `path` es relativa a UPLOADS_DIR: `reports/{reportId}/{uuid}.jpg`.
model ReportFile {
  id        Int            @id @default(autoincrement())
  reportId  Int            @map("report_id")
  report    Report         @relation(fields: [reportId], references: [id], onDelete: Cascade)
  kind      ReportFileKind
  path      String         @db.VarChar(255)
  mime      String         @db.VarChar(100)
  size      Int
  width     Int
  height    Int
  createdAt DateTime       @default(now()) @map("created_at")

  @@index([reportId, kind])
  @@map("report_files")
}
```

Agregar las relaciones inversas:
- en `model Member`: `reports Report[]`
- en `model User`: `reportsFiled Report[] @relation("ReportFiledBy")` y `reportsDismissed Report[] @relation("ReportDismissedBy")`
- en `model Minute`: `reportsFiled Report[] @relation("ReportFiledMinute")`
- en `model Street`: `reports Report[]`

- [ ] **Step 2: Generar la migración**

Run (con MariaDB de Docker levantada): `npx prisma migrate dev --name add_reports`
Expected: crea `prisma/migrations/<ts>_add_reports/migration.sql` y regenera el cliente. Verificar que el SQL tenga `CREATE TABLE \`reports\``, `CREATE TABLE \`report_files\``, `ALTER TABLE \`notifications\` ADD COLUMN \`report_id\``, y que el `MODIFY \`type\` ENUM(...)` de `notifications` termine en `'generic', 'report_received', 'report_filed', 'report_board_alert'`. Si `generic` no es el penúltimo bloque, corregir el orden en el schema y regenerar.

- [ ] **Step 3: Agregar el comentario de cabecera al SQL**

Al principio del `migration.sql` generado, insertar:

```sql
-- Módulo 7 (Reportes): dos tablas nuevas, una columna nullable en
-- `notifications` y tres valores de `NotificationType` AL FINAL del enum
-- (después de `generic`): un ENUM se guarda como índice y no como texto, así
-- que intercalar corre el significado de cada fila ya escrita.
-- Estrictamente aditiva: apta para `migrate deploy` sobre la base con socios.
```

- [ ] **Step 4: Etiquetas del enum**

En `src/lib/members/labels.ts`, dentro de `NOTIFICATION_TYPE_LABELS`, agregar:

```ts
  report_received: "Reporte recibido",
  report_filed: "Reporte presentado",
  report_board_alert: "Aviso de reporte a la Comisión",
```

- [ ] **Step 5: Verificar tipos y suite**

Run: `npx tsc --noEmit && npm test`
Expected: sin errores de tipos; la suite entera en verde (3704+ tests). Si `tsc` acusa un `Record<NotificationType,…>` incompleto en otro archivo, agregar ahí las tres claves con el mismo texto.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/lib/members/labels.ts
git commit -m "feat(reports): reports and report_files tables, Notification.reportId, NotificationType values

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Reglas puras (validación del envío, retención, mensajes)

**Files:**
- Create: `src/lib/reports/rules.ts`
- Test: `tests/reports-rules.test.ts`

**Interfaces:**
- Consumes: `catalog.ts` (`findClaimCategory`, `findInitiativeCategory`, `findSubtype`)
- Produces:
  - `DRAFT_TTL_HOURS = 48`, `DNI_RETENTION_DAYS = 360`, `MAX_PHOTOS = 2`, `MAX_DESCRIPTION = 2000`
  - `isLocationRequired({ kind, category }): boolean`
  - `type SubmissionInput` y `validateSubmission(input): { ok: true } | { ok: false; error: string }`
  - `retentionDueAt(closedAt: Date): Date`, `draftExpiresAt(createdAt: Date): Date`
  - `REPORT_MESSAGES` (textos únicos por causal)

- [ ] **Step 1: Escribir el test que falla**

```ts
// tests/reports-rules.test.ts
// Reglas puras del envío de un reporte (spec §4 y §5): ubicación obligatoria en
// reclamos salvo "Otro reporte", identidad y DNI completos para el vecino (no
// para el socio), categoría y tipo del catálogo, y las dos aritméticas de
// retención. Sin Prisma: la tabla de casos se prueba sin fixtures.
import { describe, expect, it } from "vitest";
import {
  DNI_RETENTION_DAYS, DRAFT_TTL_HOURS, draftExpiresAt, isLocationRequired,
  REPORT_MESSAGES, retentionDueAt, validateSubmission, type SubmissionInput,
} from "@/lib/reports/rules";

const base: SubmissionInput = {
  kind: "claim", category: "streets", subtype: "pothole",
  description: "Hay un pozo enorme frente al 120.",
  lat: -45.797, lng: -67.494,
  isMember: false,
  reporter: { name: "Ana López", dni: "30123456", phone: "2974000000", email: "ana@example.com" },
  files: { dniFront: true, dniBack: true, photos: 1 },
};

describe("isLocationRequired", () => {
  it("reclamo con categoría → obligatoria; 'Otro reporte' e iniciativas → opcional", () => {
    expect(isLocationRequired({ kind: "claim", category: "water" })).toBe(true);
    expect(isLocationRequired({ kind: "claim", category: "other" })).toBe(false);
    expect(isLocationRequired({ kind: "initiative", category: "social" })).toBe(false);
  });
});

describe("validateSubmission", () => {
  it("acepta un reclamo completo", () => {
    expect(validateSubmission(base)).toEqual({ ok: true });
  });

  it("rechaza sin categoría, o con una que no existe para el tipo", () => {
    expect(validateSubmission({ ...base, category: null })).toEqual({ ok: false, error: REPORT_MESSAGES.category });
    expect(validateSubmission({ ...base, category: "social" })).toEqual({ ok: false, error: REPORT_MESSAGES.category });
    expect(validateSubmission({ ...base, kind: "initiative", category: "water", subtype: null })).toEqual({
      ok: false, error: REPORT_MESSAGES.category,
    });
  });

  it("un reclamo con tipos exige uno del catálogo; 'Otro reporte' no lleva tipo", () => {
    expect(validateSubmission({ ...base, subtype: null })).toEqual({ ok: false, error: REPORT_MESSAGES.subtype });
    expect(validateSubmission({ ...base, subtype: "leak" })).toEqual({ ok: false, error: REPORT_MESSAGES.subtype });
    expect(validateSubmission({ ...base, category: "other", subtype: null })).toEqual({ ok: true });
  });

  it("la descripción es obligatoria y tiene tope", () => {
    expect(validateSubmission({ ...base, description: "   " })).toEqual({ ok: false, error: REPORT_MESSAGES.description });
    expect(validateSubmission({ ...base, description: "x".repeat(2001) })).toEqual({ ok: false, error: REPORT_MESSAGES.descriptionLong });
  });

  it("ubicación obligatoria sólo donde corresponde", () => {
    expect(validateSubmission({ ...base, lat: null, lng: null })).toEqual({ ok: false, error: REPORT_MESSAGES.location });
    expect(validateSubmission({ ...base, category: "other", subtype: null, lat: null, lng: null })).toEqual({ ok: true });
    expect(validateSubmission({ ...base, kind: "initiative", category: "social", subtype: null, lat: null, lng: null })).toEqual({ ok: true });
  });

  it("un par de coordenadas a medias o fuera de rango se rechaza", () => {
    expect(validateSubmission({ ...base, lat: -45.79, lng: null })).toEqual({ ok: false, error: REPORT_MESSAGES.location });
    expect(validateSubmission({ ...base, lat: 91, lng: -67 })).toEqual({ ok: false, error: REPORT_MESSAGES.location });
  });

  it("el vecino necesita identidad completa y las dos caras del DNI; el socio no", () => {
    expect(validateSubmission({ ...base, reporter: { ...base.reporter, name: "" } })).toEqual({ ok: false, error: REPORT_MESSAGES.identity });
    expect(validateSubmission({ ...base, files: { ...base.files, dniBack: false } })).toEqual({ ok: false, error: REPORT_MESSAGES.dni });
    expect(validateSubmission({ ...base, isMember: true, files: { dniFront: false, dniBack: false, photos: 0 } })).toEqual({ ok: true });
  });

  it("más de dos fotos no puede pasar aunque el POST lo intente", () => {
    expect(validateSubmission({ ...base, files: { ...base.files, photos: 3 } })).toEqual({ ok: false, error: REPORT_MESSAGES.photos });
  });
});

describe("retención", () => {
  it("el DNI vence 360 días después del cierre; el borrador, 48 h después de nacer", () => {
    expect(DNI_RETENTION_DAYS).toBe(360);
    expect(DRAFT_TTL_HOURS).toBe(48);
    const closed = new Date("2026-09-01T15:00:00Z");
    expect(retentionDueAt(closed).toISOString()).toBe("2027-08-27T15:00:00.000Z");
    expect(draftExpiresAt(new Date("2026-09-01T15:00:00Z")).toISOString()).toBe("2026-09-03T15:00:00.000Z");
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npm test -- --run tests/reports-rules.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Escribir las reglas**

```ts
// src/lib/reports/rules.ts
// Reglas de negocio del envío de un reporte (spec §4-§5). PURO: sin Prisma.
// Las usa `service.submit` (la guarda real) y el wizard (para apagar el botón
// antes de un viaje al server): compartir la función y no copiarla es la
// lección de `coverageFloor` (CLAUDE.md).
import { findClaimCategory, findInitiativeCategory, findSubtype, type ReportKindSlug } from "./catalog";

export const DRAFT_TTL_HOURS = 48;
export const DNI_RETENTION_DAYS = 360;
export const MAX_PHOTOS = 2;
export const MAX_DESCRIPTION = 2000;

/** Textos únicos por causal: el wizard y el servicio dicen lo mismo se corte
 *  donde se corte (patrón `GRANT_GUARD_MESSAGES`). */
export const REPORT_MESSAGES = {
  category: "Elegí una categoría.",
  subtype: "Elegí el tipo de problema.",
  description: "Contanos qué pasa: la descripción es obligatoria.",
  descriptionLong: `La descripción no puede superar los ${MAX_DESCRIPTION} caracteres.`,
  location: "Marcá en el mapa dónde está el problema.",
  identity: "Faltan tus datos: nombre, DNI, teléfono y email.",
  dni: "Falta subir el frente y el dorso de tu DNI.",
  photos: `Podés adjuntar hasta ${MAX_PHOTOS} fotos.`,
  notDraft: "Este reporte ya fue enviado.",
  linkDead: "No encontramos tu reporte: el enlace puede estar incompleto o vencido. Empezá de nuevo desde Reportes.",
  notPending: "El reporte ya fue resuelto o no existe.",
} as const;

export function isLocationRequired(input: { kind: ReportKindSlug; category: string | null }): boolean {
  return input.kind === "claim" && input.category !== "other";
}

export type SubmissionInput = {
  kind: ReportKindSlug;
  category: string | null;
  subtype: string | null;
  description: string;
  lat: number | null;
  lng: number | null;
  /** El socio no declara identidad ni sube DNI: viene de su ficha. */
  isMember: boolean;
  reporter: { name: string | null; dni: string | null; phone: string | null; email: string | null };
  files: { dniFront: boolean; dniBack: boolean; photos: number };
};

export type SubmissionVerdict = { ok: true } | { ok: false; error: string };

function validCoords(lat: number | null, lng: number | null): boolean {
  return (
    lat !== null && lng !== null &&
    Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
  );
}

export function validateSubmission(input: SubmissionInput): SubmissionVerdict {
  const fail = (error: string): SubmissionVerdict => ({ ok: false, error });

  if (input.kind === "claim") {
    const category = findClaimCategory(input.category);
    if (!category) return fail(REPORT_MESSAGES.category);
    if (category.subtypes.length > 0 && !findSubtype(category.slug, input.subtype)) {
      return fail(REPORT_MESSAGES.subtype);
    }
    if (category.subtypes.length === 0 && input.subtype !== null) return fail(REPORT_MESSAGES.subtype);
  } else if (!findInitiativeCategory(input.category)) {
    return fail(REPORT_MESSAGES.category);
  }

  const description = input.description.trim();
  if (description === "") return fail(REPORT_MESSAGES.description);
  if (description.length > MAX_DESCRIPTION) return fail(REPORT_MESSAGES.descriptionLong);

  const hasAny = input.lat !== null || input.lng !== null;
  if (isLocationRequired(input) || hasAny) {
    if (!validCoords(input.lat, input.lng)) return fail(REPORT_MESSAGES.location);
  }

  if (!input.isMember) {
    const r = input.reporter;
    if (!r.name?.trim() || !r.dni?.trim() || !r.phone?.trim() || !r.email?.trim()) {
      return fail(REPORT_MESSAGES.identity);
    }
    if (!input.files.dniFront || !input.files.dniBack) return fail(REPORT_MESSAGES.dni);
  }

  if (input.files.photos > MAX_PHOTOS) return fail(REPORT_MESSAGES.photos);
  return { ok: true };
}

export function retentionDueAt(closedAt: Date): Date {
  return new Date(closedAt.getTime() + DNI_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

export function draftExpiresAt(createdAt: Date): Date {
  return new Date(createdAt.getTime() + DRAFT_TTL_HOURS * 60 * 60 * 1000);
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npm test -- --run tests/reports-rules.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/reports/rules.ts tests/reports-rules.test.ts
git commit -m "feat(reports): pure submission rules, retention arithmetic and shared messages

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Llave del borrador y limitadores

**Files:**
- Create: `src/lib/reports/claim.ts`
- Modify: `src/lib/auth/rate-limiter.ts` (al final)
- Test: `tests/reports-claim.test.ts`

**Interfaces:**
- Produces: `mintClaim(): { raw: string; hash: string }`, `hashClaim(raw): string`, `isClaimShaped(raw): boolean`; limiters `reportDraftLimiter` (IP, 5/60 min), `reportSubmitLimiter` (IP, 5/60 min), `reportUploadLimiter` (IP, 30/60 min), `reportMemberLimiter` (memberId, 5/24 h) con sus constantes `REPORT_DRAFT_LIMIT`, `REPORT_SUBMIT_LIMIT`, `REPORT_UPLOAD_LIMIT`, `REPORT_MEMBER_LIMIT`, `REPORT_WINDOW_MS`, `REPORT_MEMBER_WINDOW_MS`.

- [ ] **Step 1: Test que falla**

```ts
// tests/reports-claim.test.ts
// La llave del borrador (spec §5.1): 32 bytes de randomBytes en base64url, sólo
// el sha256 se persiste, y la forma se valida antes de consultar la base.
// También fija los cupos de los cuatro limitadores nuevos.
import { describe, expect, it } from "vitest";
import { hashClaim, isClaimShaped, mintClaim } from "@/lib/reports/claim";
import {
  REPORT_DRAFT_LIMIT, REPORT_MEMBER_LIMIT, REPORT_MEMBER_WINDOW_MS, REPORT_SUBMIT_LIMIT,
  REPORT_UPLOAD_LIMIT, REPORT_WINDOW_MS, reportDraftLimiter, reportMemberLimiter,
  reportSubmitLimiter, reportUploadLimiter,
} from "@/lib/auth/rate-limiter";

describe("claim", () => {
  it("acuña 43 caracteres base64url y un hash sha256 hex de 64", () => {
    const { raw, hash } = mintClaim();
    expect(raw).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashClaim(raw)).toBe(hash);
  });
  it("dos llaves no coinciden", () => {
    expect(mintClaim().raw).not.toBe(mintClaim().raw);
  });
  it("isClaimShaped rechaza lo que no tiene la forma", () => {
    expect(isClaimShaped(mintClaim().raw)).toBe(true);
    expect(isClaimShaped("")).toBe(false);
    expect(isClaimShaped("../etc/passwd")).toBe(false);
    expect(isClaimShaped("a".repeat(44))).toBe(false);
  });
});

describe("limitadores de Reportes", () => {
  it("cupos y ventanas fijados por la spec §7", () => {
    expect(REPORT_WINDOW_MS).toBe(60 * 60_000);
    expect(REPORT_MEMBER_WINDOW_MS).toBe(24 * 60 * 60_000);
    expect(reportDraftLimiter.limit).toBe(REPORT_DRAFT_LIMIT);
    expect(REPORT_DRAFT_LIMIT).toBe(5);
    expect(reportSubmitLimiter.limit).toBe(REPORT_SUBMIT_LIMIT);
    expect(REPORT_SUBMIT_LIMIT).toBe(5);
    expect(reportUploadLimiter.limit).toBe(REPORT_UPLOAD_LIMIT);
    expect(REPORT_UPLOAD_LIMIT).toBe(30);
    expect(reportMemberLimiter.limit).toBe(REPORT_MEMBER_LIMIT);
    expect(REPORT_MEMBER_LIMIT).toBe(5);
    expect(reportMemberLimiter.windowMs).toBe(REPORT_MEMBER_WINDOW_MS);
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npm test -- --run tests/reports-claim.test.ts` → FAIL (módulo y exports inexistentes).

- [ ] **Step 3: Escribir `claim.ts`**

```ts
// src/lib/reports/claim.ts
// La llave del borrador de un reporte (spec §5.1). Mismo criterio que el token
// de retome de ASOCIATE: 256 bits de `randomBytes`, sólo el sha256 en la base,
// el crudo viaja una vez en la URL (`/reportes/nuevo/<claim>`, en `disallow` de
// robots.txt). NO se consume: es la llave mientras el borrador viva.
import { randomBytes } from "node:crypto";
import { hashToken } from "@/lib/tokens";

const CLAIM_RE = /^[A-Za-z0-9_-]{43}$/;

export function mintClaim(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("base64url");
  return { raw, hash: hashToken(raw) };
}

export function hashClaim(raw: string): string {
  return hashToken(raw);
}

/** Forma antes que base: una llave que no tiene la forma no merece una consulta. */
export function isClaimShaped(raw: string): boolean {
  return CLAIM_RE.test(raw);
}
```

> `@/lib/tokens` importa `@/lib/prisma` al evaluarse (por el singleton `tokens`). El test de arriba corre con `.env` cargado por Vitest igual que los otros que importan `tokens`; si en el entorno del implementador falla por `DATABASE_URL`, agregar al inicio del test `vi.mock("@/lib/prisma", () => ({ prisma: {} }))`.

- [ ] **Step 4: Agregar los limitadores al final de `rate-limiter.ts`**

```ts
export const REPORT_WINDOW_MS = 60 * 60_000
export const REPORT_DRAFT_LIMIT = 5
export const REPORT_SUBMIT_LIMIT = 5
export const REPORT_UPLOAD_LIMIT = 30
export const REPORT_MEMBER_WINDOW_MS = 24 * 60 * 60_000
export const REPORT_MEMBER_LIMIT = 5

/** Creación del BORRADOR de un reporte (paso 1 del wizard público), por IP.
 *  Detrás de Turnstile, pero el captcha no raciona al humano persistente. Cinco
 *  por hora desde un origen alcanzan para un hogar detrás del CGNAT móvil y
 *  frenan el llenado masivo de borradores (que además se purgan a las 48 h). */
export const reportDraftLimiter = createRateLimiter({ limit: REPORT_DRAFT_LIMIT, windowMs: REPORT_WINDOW_MS })

/** ENVÍO del reporte (paso 3), por IP. Presupuesto SEPARADO del borrador: es
 *  el POST que dispara dos correos (el acuse y la alerta a la Comisión), y
 *  gastar borradores no puede dejar sin envío a quien ya cargó todo. */
export const reportSubmitLimiter = createRateLimiter({ limit: REPORT_SUBMIT_LIMIT, windowMs: REPORT_WINDOW_MS })

/** Subida de archivos contra la llave del borrador, por IP. Un reporte completo
 *  son cuatro archivos (dos caras del DNI y dos fotos) más los reintentos de
 *  una foto movida: treinta por hora sobra para el vecino y sigue siendo un
 *  techo para quien martille el disco con la misma llave. */
export const reportUploadLimiter = createRateLimiter({ limit: REPORT_UPLOAD_LIMIT, windowMs: REPORT_WINDOW_MS })

/** Reportes de un SOCIO desde /mi, por memberId (pantalla autenticada: hay una
 *  identidad mejor que la IP). Cinco por día: nadie legítimo reporta más, y sin
 *  Turnstile este techo es lo único que raciona un script con sesión. */
export const reportMemberLimiter = createRateLimiter({ limit: REPORT_MEMBER_LIMIT, windowMs: REPORT_MEMBER_WINDOW_MS })
```

- [ ] **Step 5: Correr y verificar que pasa**

Run: `npm test -- --run tests/reports-claim.test.ts` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/reports/claim.ts src/lib/auth/rate-limiter.ts tests/reports-claim.test.ts
git commit -m "feat(reports): draft claim token and the four report rate limiters

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Pipeline de imagen con sharp (re-encode sin EXIF)

**Files:**
- Create: `src/lib/reports/images.ts`
- Test: `tests/reports-images.test.ts`

**Interfaces:**
- Produces: `PHOTO_MAX_SIDE = 1600`, `DNI_MAX_SIDE = 2000`, `MAX_IMAGE_BYTES = 10 * 1024 * 1024`, `sniffImage(buf): "jpg" | "png" | "webp" | null`, `processImage(input: Buffer, opts: { maxSide: number; quality?: number }): Promise<{ data: Buffer; width: number; height: number }>`.

- [ ] **Step 1: Test que falla (usa sharp de verdad)**

```ts
// tests/reports-images.test.ts
// Toda imagen de un reporte pasa por sharp (spec §5): orientación aplicada,
// JPEG sin metadatos (adiós al GPS del celular), lado mayor acotado. Lo que
// docs/08 prometía y no existía. Se prueba con sharp real sobre imágenes
// generadas acá mismo.
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { DNI_MAX_SIDE, PHOTO_MAX_SIDE, processImage, sniffImage } from "@/lib/reports/images";

async function jpegWithExif(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 30, g: 120, b: 200 } } })
    .jpeg()
    .withMetadata({ exif: { IFD0: { Copyright: "vecino", ImageDescription: "gps-like" } } })
    .toBuffer();
}

describe("sniffImage", () => {
  it("reconoce jpg, png y webp por magic bytes y rechaza el resto", async () => {
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#fff" } }).png().toBuffer();
    const webp = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#fff" } }).webp().toBuffer();
    expect(sniffImage(await jpegWithExif(2, 2))).toBe("jpg");
    expect(sniffImage(png)).toBe("png");
    expect(sniffImage(webp)).toBe("webp");
    expect(sniffImage(Buffer.from("%PDF-1.7"))).toBeNull();
    expect(sniffImage(Buffer.from("<html>"))).toBeNull();
  });
});

describe("processImage", () => {
  it("devuelve JPEG sin EXIF y con las medidas finales", async () => {
    const out = await processImage(await jpegWithExif(400, 300), { maxSide: PHOTO_MAX_SIDE });
    expect(sniffImage(out.data)).toBe("jpg");
    const meta = await sharp(out.data).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.exif).toBeUndefined();
    expect(out.width).toBe(400);
    expect(out.height).toBe(300);
  });

  it("acota el lado mayor sin agrandar las chicas", async () => {
    const big = await sharp({ create: { width: 4000, height: 2000, channels: 3, background: "#ccc" } }).png().toBuffer();
    const out = await processImage(big, { maxSide: PHOTO_MAX_SIDE });
    expect(out.width).toBe(1600);
    expect(out.height).toBe(800);
    const small = await processImage(await jpegWithExif(100, 50), { maxSide: DNI_MAX_SIDE });
    expect(small.width).toBe(100);
  });

  it("convierte webp a JPEG (pdf-lib sólo embebe PNG y JPEG)", async () => {
    const webp = await sharp({ create: { width: 30, height: 20, channels: 3, background: "#123" } }).webp().toBuffer();
    const out = await processImage(webp, { maxSide: PHOTO_MAX_SIDE });
    expect(sniffImage(out.data)).toBe("jpg");
  });

  it("aplica la orientación EXIF: una foto marcada como rotada 90° sale con los lados invertidos", async () => {
    const rotated = await sharp({ create: { width: 200, height: 100, channels: 3, background: "#f00" } })
      .jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const out = await processImage(rotated, { maxSide: PHOTO_MAX_SIDE });
    expect(out.width).toBe(100);
    expect(out.height).toBe(200);
  });

  it("un archivo que no es imagen tira", async () => {
    await expect(processImage(Buffer.from("no soy una imagen"), { maxSide: 100 })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npm test -- --run tests/reports-images.test.ts` → FAIL (módulo inexistente).

- [ ] **Step 3: Escribir el módulo**

```ts
// src/lib/reports/images.ts
// Re-codificación de TODA imagen de un reporte con sharp (spec §5, docs/08):
// se aplica la orientación EXIF, se acota el lado mayor y se escribe un JPEG
// sin metadatos — o sea sin el GPS que el celular graba en cada foto, que en un
// reclamo suele ser la casa del vecino. sharp ya es dependencia de runtime
// (`scripts/generate-assets.ts`); acá es la primera vez que corre en un request.
//
// Sin `.withMetadata()`: es lo que conserva el EXIF, y no llamarlo es lo que lo
// borra. Un test verifica que `metadata().exif` sale undefined.
//
// Este módulo importa sharp (binario nativo): NO importarlo desde un client
// component ni desde un módulo que un test puro quiera cargar sin él.
import sharp from "sharp";

export const PHOTO_MAX_SIDE = 1600;
export const DNI_MAX_SIDE = 2000;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** Magic bytes, nunca extensión ni Content-Type del cliente. Sólo imágenes: a
 *  diferencia de `sniffDocument`, acá un PDF no es un formato admitido. */
export function sniffImage(buf: Buffer): "jpg" | "png" | "webp" | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (
    buf.length >= 8 &&
    buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) return "png";
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString("latin1") === "RIFF" &&
    buf.subarray(8, 12).toString("latin1") === "WEBP"
  ) return "webp";
  return null;
}

export async function processImage(
  input: Buffer,
  opts: { maxSide: number; quality?: number },
): Promise<{ data: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(input, { failOn: "error" })
    // `rotate()` sin argumento aplica la orientación EXIF y la descarta: la
    // foto queda derecha "de verdad" y no por un tag que el PDF no lee.
    .rotate()
    .resize({ width: opts.maxSide, height: opts.maxSide, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: opts.quality ?? 82, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npm test -- --run tests/reports-images.test.ts` → PASS (6 tests). Si el test de orientación falla con `orientation: 6` no soportado por `withMetadata`, reemplazar la generación por `.jpeg().withMetadata({ orientation: 6 })` sobre un `sharp(buffer)` ya codificado (dos pasos).

- [ ] **Step 5: Commit**

```bash
git add src/lib/reports/images.ts tests/reports-images.test.ts
git commit -m "feat(reports): sharp pipeline that re-encodes images to JPEG without EXIF

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Storage de archivos del reporte

**Files:**
- Create: `src/lib/reports/storage.ts`
- Test: `tests/reports-storage.test.ts`

**Interfaces:**
- Consumes: `images.ts` (`sniffImage`, `processImage`, `PHOTO_MAX_SIDE`, `DNI_MAX_SIDE`, `MAX_IMAGE_BYTES`), `rules.ts` (`MAX_PHOTOS`), `uploadsDir()` de `@/lib/news/images`
- Produces:
  - `makeReportFileStore(deps: { db: Pick<PrismaClient, "reportFile">; rootDir?: string }): ReportFileStore`
  - `ReportFileStore = { save({ reportId, kind, data }): Promise<{ id; width; height }>; remove({ reportId, fileId }): Promise<boolean>; read(file: { path }): Promise<Buffer>; deleteFiles(reportId, kinds?): Promise<number>; deleteReportDir(reportId): Promise<void> }`
  - `reportFileStore` (singleton), `REPORT_FILE_MESSAGES`

- [ ] **Step 1: Test que falla (disco temporal real + fake de `reportFile` que honra el `where`)**

```ts
// tests/reports-storage.test.ts
// El store de archivos de un reporte (spec §7-§8): valida forma, re-codifica
// con sharp, escribe en `reports/{id}/{uuid}.jpg`, reemplaza el DNI anterior,
// acota las fotos a dos y sabe borrar por tipo (la purga de retención). Disco
// temporal real; `reportFile` es un doble en memoria que HONRA el `where`.
import { mkdtempSync, existsSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import { makeReportFileStore, REPORT_FILE_MESSAGES } from "@/lib/reports/storage";

type Row = { id: number; reportId: number; kind: string; path: string; mime: string; size: number; width: number; height: number };

function fakeDb() {
  const rows: Row[] = [];
  let nextId = 1;
  const matches = (r: Row, where: Partial<Row> & { kind?: string | { in: string[] } }) => {
    if (where.id !== undefined && r.id !== where.id) return false;
    if (where.reportId !== undefined && r.reportId !== where.reportId) return false;
    if (where.kind !== undefined) {
      if (typeof where.kind === "string" ? r.kind !== where.kind : !where.kind.in.includes(r.kind)) return false;
    }
    return true;
  };
  const db = {
    reportFile: {
      create: vi.fn(async ({ data }: { data: Omit<Row, "id"> }) => { const row = { id: nextId++, ...data }; rows.push(row); return row; }),
      findMany: vi.fn(async ({ where }: { where: Parameters<typeof matches>[1] }) => rows.filter((r) => matches(r, where))),
      findFirst: vi.fn(async ({ where }: { where: Parameters<typeof matches>[1] }) => rows.find((r) => matches(r, where)) ?? null),
      count: vi.fn(async ({ where }: { where: Parameters<typeof matches>[1] }) => rows.filter((r) => matches(r, where)).length),
      deleteMany: vi.fn(async ({ where }: { where: Parameters<typeof matches>[1] }) => {
        const before = rows.length;
        for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i], where)) rows.splice(i, 1);
        return { count: before - rows.length };
      }),
    },
  };
  return { db, rows };
}

const dirs: string[] = [];
function tmp() { const d = mkdtempSync(path.join(os.tmpdir(), "sigev-reports-")); dirs.push(d); return d; }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const img = (w = 50, h = 40) =>
  sharp({ create: { width: w, height: h, channels: 3, background: "#0079BC" } }).png().toBuffer();

describe("reportFileStore.save", () => {
  it("guarda una foto re-codificada bajo reports/{id}/, con fila y medidas", async () => {
    const root = tmp();
    const { db, rows } = fakeDb();
    const store = makeReportFileStore({ db: db as never, rootDir: root });
    const saved = await store.save({ reportId: 7, kind: "photo", data: await img() });
    expect(saved).toMatchObject({ id: 1, width: 50, height: 40 });
    expect(rows[0]).toMatchObject({ reportId: 7, kind: "photo", mime: "image/jpeg" });
    expect(rows[0].path).toMatch(/^reports\/7\/[0-9a-f-]{36}\.jpg$/);
    expect(existsSync(path.join(root, rows[0].path))).toBe(true);
  });

  it("rechaza vacío, tamaño excedido, formato no imagen e id no entero", async () => {
    const { db } = fakeDb();
    const store = makeReportFileStore({ db: db as never, rootDir: tmp() });
    await expect(store.save({ reportId: 7, kind: "photo", data: Buffer.alloc(0) })).rejects.toThrow(REPORT_FILE_MESSAGES.size);
    await expect(store.save({ reportId: 7, kind: "photo", data: Buffer.alloc(10 * 1024 * 1024 + 1) })).rejects.toThrow(REPORT_FILE_MESSAGES.size);
    await expect(store.save({ reportId: 7, kind: "photo", data: Buffer.from("%PDF-1.7") })).rejects.toThrow(REPORT_FILE_MESSAGES.format);
    await expect(store.save({ reportId: 1.5, kind: "photo", data: await img() })).rejects.toThrow("inválido");
    await expect(store.save({ reportId: -1, kind: "photo", data: await img() })).rejects.toThrow("inválido");
  });

  it("el frente del DNI REEMPLAZA al anterior (fila y archivo); las fotos acumulan hasta dos", async () => {
    const root = tmp();
    const { db, rows } = fakeDb();
    const store = makeReportFileStore({ db: db as never, rootDir: root });
    await store.save({ reportId: 7, kind: "dni_front", data: await img() });
    const firstPath = rows[0].path;
    await store.save({ reportId: 7, kind: "dni_front", data: await img() });
    expect(rows.filter((r) => r.kind === "dni_front")).toHaveLength(1);
    expect(existsSync(path.join(root, firstPath))).toBe(false);

    await store.save({ reportId: 7, kind: "photo", data: await img() });
    await store.save({ reportId: 7, kind: "photo", data: await img() });
    await expect(store.save({ reportId: 7, kind: "photo", data: await img() })).rejects.toThrow(REPORT_FILE_MESSAGES.photos);
    expect(rows.filter((r) => r.kind === "photo")).toHaveLength(2);
  });
});

describe("remove, read, deleteFiles y deleteReportDir", () => {
  it("remove sólo borra un archivo del MISMO reporte", async () => {
    const root = tmp();
    const { db, rows } = fakeDb();
    const store = makeReportFileStore({ db: db as never, rootDir: root });
    const a = await store.save({ reportId: 7, kind: "photo", data: await img() });
    expect(await store.remove({ reportId: 8, fileId: a.id })).toBe(false);
    expect(rows).toHaveLength(1);
    expect(await store.remove({ reportId: 7, fileId: a.id })).toBe(true);
    expect(rows).toHaveLength(0);
  });

  it("read devuelve los bytes escritos", async () => {
    const root = tmp();
    const { db, rows } = fakeDb();
    const store = makeReportFileStore({ db: db as never, rootDir: root });
    await store.save({ reportId: 7, kind: "photo", data: await img() });
    const bytes = await store.read(rows[0]);
    expect(bytes.length).toBe(rows[0].size);
  });

  it("deleteFiles por tipo borra sólo los DNI y deja las fotos; deleteReportDir vacía la carpeta", async () => {
    const root = tmp();
    const { db, rows } = fakeDb();
    const store = makeReportFileStore({ db: db as never, rootDir: root });
    await store.save({ reportId: 7, kind: "dni_front", data: await img() });
    await store.save({ reportId: 7, kind: "dni_back", data: await img() });
    await store.save({ reportId: 7, kind: "photo", data: await img() });
    expect(await store.deleteFiles(7, ["dni_front", "dni_back"])).toBe(2);
    expect(rows.map((r) => r.kind)).toEqual(["photo"]);
    expect(readdirSync(path.join(root, "reports", "7"))).toHaveLength(1);
    await store.deleteReportDir(7);
    expect(existsSync(path.join(root, "reports", "7"))).toBe(false);
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npm test -- --run tests/reports-storage.test.ts` → FAIL.

- [ ] **Step 3: Escribir el store**

```ts
// src/lib/reports/storage.ts
// Archivos de un reporte (spec §7-§8): las dos caras del DNI y hasta dos fotos.
// FUERA de public/ (UPLOADS_DIR/reports/{reportId}/, cubierta por backup.sh sin
// tocarlo), validados por MAGIC BYTES y re-codificados por sharp ANTES de tocar
// el disco: lo que se escribe es siempre un JPEG sin metadatos.
//
// Tabla propia (`report_files`) y no `Document`: ver el comentario del modelo.
// Este módulo importa node:fs y sharp — NO importarlo desde un client component.
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PrismaClient, ReportFileKind } from "@/generated/prisma/client";
import { uploadsDir } from "@/lib/news/images";
import { prisma } from "@/lib/prisma";
import { DNI_MAX_SIDE, MAX_IMAGE_BYTES, PHOTO_MAX_SIDE, processImage, sniffImage } from "./images";
import { MAX_PHOTOS } from "./rules";

export const REPORT_FILE_MESSAGES = {
  size: "El archivo supera el máximo de 10 MB o está vacío.",
  format: "Formato no admitido: subí una foto JPG, PNG o WebP.",
  photos: `Ya subiste las ${MAX_PHOTOS} fotos permitidas. Quitá una para cambiarla.`,
  broken: "No pudimos leer la imagen. Probá con otra foto.",
} as const;

export const REPORTS_FOLDER = "reports";

type Db = Pick<PrismaClient, "reportFile">;

export function makeReportFileStore(deps: { db: Db; rootDir?: string }) {
  const { db } = deps;
  // Por llamada, no al construir: UPLOADS_DIR puede no estar leída todavía.
  const root = () => deps.rootDir ?? uploadsDir();

  function assertId(reportId: number) {
    // La ruta se arma con este número: un NaN o un "../" escaparía de UPLOADS_DIR.
    if (!Number.isInteger(reportId) || reportId <= 0) throw new Error("Reporte inválido.");
  }

  async function unlinkQuiet(relative: string) {
    try {
      await unlink(path.join(root(), relative));
    } catch {
      /* best-effort: la fila ya no está */
    }
  }

  return {
    async save(input: { reportId: number; kind: ReportFileKind; data: Buffer }): Promise<{ id: number; width: number; height: number }> {
      assertId(input.reportId);
      if (input.data.length === 0 || input.data.length > MAX_IMAGE_BYTES) throw new Error(REPORT_FILE_MESSAGES.size);
      if (!sniffImage(input.data)) throw new Error(REPORT_FILE_MESSAGES.format);
      if (input.kind === "photo") {
        const photos = await db.reportFile.count({ where: { reportId: input.reportId, kind: "photo" } });
        if (photos >= MAX_PHOTOS) throw new Error(REPORT_FILE_MESSAGES.photos);
      }

      let processed: { data: Buffer; width: number; height: number };
      try {
        processed = await processImage(input.data, {
          maxSide: input.kind === "photo" ? PHOTO_MAX_SIDE : DNI_MAX_SIDE,
        });
      } catch {
        throw new Error(REPORT_FILE_MESSAGES.broken);
      }

      const relative = path.posix.join(REPORTS_FOLDER, String(input.reportId), `${randomUUID()}.jpg`);
      const absolute = path.join(root(), relative);
      await mkdir(path.dirname(absolute), { recursive: true });
      await writeFile(absolute, processed.data);

      // El DNI se REEMPLAZA (una cara por reporte); las fotos acumulan.
      const previous =
        input.kind === "photo"
          ? []
          : await db.reportFile.findMany({ where: { reportId: input.reportId, kind: input.kind } });
      const created = await db.reportFile.create({
        data: {
          reportId: input.reportId,
          kind: input.kind,
          path: relative,
          mime: "image/jpeg",
          size: processed.data.length,
          width: processed.width,
          height: processed.height,
        },
      });
      for (const p of previous) {
        // Best-effort completo (mismo criterio que documents/storage.ts): la
        // fila nueva ya está; un unlink fallido no puede dejar el DNI sin subir.
        try {
          await db.reportFile.deleteMany({ where: { id: p.id } });
          await unlinkQuiet(p.path);
        } catch {
          /* best-effort */
        }
      }
      return { id: created.id, width: processed.width, height: processed.height };
    },

    /** Quitar una foto desde el wizard. El `reportId` en el `where` es la guarda
     *  de pertenencia: nunca borra un archivo de otro reporte. */
    async remove(input: { reportId: number; fileId: number }): Promise<boolean> {
      assertId(input.reportId);
      const file = await db.reportFile.findFirst({ where: { id: input.fileId, reportId: input.reportId } });
      if (!file) return false;
      await db.reportFile.deleteMany({ where: { id: file.id } });
      await unlinkQuiet(file.path);
      return true;
    },

    async read(file: { path: string }): Promise<Buffer> {
      return readFile(path.join(root(), file.path));
    },

    /** Borra los archivos de un reporte (todos, o sólo los de los tipos dados).
     *  Lo usa la purga de retención. Devuelve cuántas filas se borraron. */
    async deleteFiles(reportId: number, kinds?: ReportFileKind[]): Promise<number> {
      assertId(reportId);
      const where = kinds ? { reportId, kind: { in: kinds } } : { reportId };
      const files = await db.reportFile.findMany({ where });
      for (const f of files) await unlinkQuiet(f.path);
      const { count } = await db.reportFile.deleteMany({ where });
      return count;
    },

    async deleteReportDir(reportId: number): Promise<void> {
      assertId(reportId);
      await rm(path.join(root(), REPORTS_FOLDER, String(reportId)), { recursive: true, force: true });
    },
  };
}

export type ReportFileStore = ReturnType<typeof makeReportFileStore>;

export const reportFileStore = makeReportFileStore({ db: prisma });
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npm test -- --run tests/reports-storage.test.ts` → PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/reports/storage.ts tests/reports-storage.test.ts
git commit -m "feat(reports): report file store with sharp re-encode, DNI replacement and photo cap

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Servicio del dominio (borrador, envío, presentado, desestimado, listados)

**Files:**
- Create: `src/lib/reports/service.ts`
- Test: `tests/reports-service.test.ts`

**Interfaces:**
- Consumes: `rules.ts`, `claim.ts`, `boundary.ts`, `catalog.ts`
- Produces: `makeReports({ db: Pick<PrismaClient, "report" | "reportFile">; now?: () => Date })` con:
  - `startDraft(input: { kind; anonymous; memberId?: number | null; reporter?: { name; dni; phone; email } | null; ip; userAgent }): Promise<{ id: number; claim: string }>`
  - `findByClaim(raw: string): Promise<ReportWithFiles | null>`
  - `saveReporter(input: { reportId; name; dni; phone; email }): Promise<Result>`
  - `submit(input: { reportId; category; subtype; description; lat; lng; streetId; streetName; addressDetail; scplTicket; consent: boolean }): Promise<SubmitResult>`
  - `file(input: { reportId; actorId; agency: AgencySlug | null; agencyOther; filedAt: Date; reference; minuteId }): Promise<Result>`
  - `dismiss(input: { reportId; actorId; reason }): Promise<Result>`
  - `listForMember(memberId): Promise<ReportWithFiles[]>`
  - `pendingCount(): Promise<number>`, `yearStats(now): Promise<{ received: number; filed: number }>`
  - `reports` (singleton), tipos `ReportWithFiles`, `Result`, `SubmitResult`

- [ ] **Step 1: Test que falla**

```ts
// tests/reports-service.test.ts
// La ÚNICA puerta de escritura de `reports` (spec §4 invariantes): el borrador
// nace con su llave hasheada, el envío revalida en la base (identidad, DNI,
// reglas) y pasa draft→received con un updateMany condicional, presentar y
// desestimar sólo tocan `received`, y los conteos son los de la pestaña y la
// landing. Doble de base en memoria que HONRA el `where` (lección del M6).
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import { hashClaim } from "@/lib/reports/claim";
import { REPORT_MESSAGES } from "@/lib/reports/rules";
import { makeReports } from "@/lib/reports/service";

const NOW = new Date("2026-09-01T15:00:00Z");
type Row = Record<string, unknown> & { id: number; status: string };
type FileRow = { id: number; reportId: number; kind: string };

function fakeDb() {
  const reports: Row[] = [];
  const files: FileRow[] = [];
  let nextId = 1;
  const matches = (r: Row, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => {
      if (v !== null && typeof v === "object" && "in" in (v as object)) return (v as { in: unknown[] }).in.includes(r[k]);
      if (v !== null && typeof v === "object" && "gte" in (v as object)) {
        const { gte, lt } = v as { gte?: Date; lt?: Date };
        const val = r[k] as Date | null;
        return val !== null && (!gte || val >= gte) && (!lt || val < lt);
      }
      return r[k] === v;
    });
  const withFiles = (r: Row) => ({ ...r, files: files.filter((f) => f.reportId === r.id) });
  const db = {
    report: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row: Row = { id: nextId++, status: "draft", createdAt: NOW, ...data };
        reports.push(row);
        return row;
      }),
      findUnique: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const r = reports.find((x) => matches(x, where));
        return r ? withFiles(r) : null;
      }),
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const r = reports.find((x) => matches(x, where));
        return r ? withFiles(r) : null;
      }),
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => reports.filter((x) => matches(x, where)).map(withFiles)),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        let count = 0;
        for (const r of reports) if (matches(r, where)) { Object.assign(r, data); count++; }
        return { count };
      }),
      count: vi.fn(async ({ where }: { where: Record<string, unknown> }) => reports.filter((x) => matches(x, where)).length),
    },
    reportFile: {
      findMany: vi.fn(async ({ where }: { where: { reportId: number } }) => files.filter((f) => f.reportId === where.reportId)),
    },
  };
  return { db, reports, files };
}

const reporter = { name: "Ana López", dni: "30123456", phone: "2974000000", email: "ana@example.com" };
const submission = {
  category: "streets", subtype: "pothole", description: "Un pozo enorme.",
  lat: -45.797, lng: -67.494, streetId: 3, streetName: "Cerro Catedral", addressDetail: "al 280",
  scplTicket: null, consent: true,
};

let ctx: ReturnType<typeof fakeDb>;
let service: ReturnType<typeof makeReports>;
beforeEach(() => {
  vi.clearAllMocks();
  ctx = fakeDb();
  service = makeReports({ db: ctx.db as never, now: () => NOW });
});

async function vecinoDraft() {
  const { id, claim } = await service.startDraft({ kind: "claim", anonymous: false, ip: "1.1.1.1", userAgent: "ua" });
  await service.saveReporter({ reportId: id, ...reporter });
  ctx.files.push({ id: 1, reportId: id, kind: "dni_front" }, { id: 2, reportId: id, kind: "dni_back" });
  return { id, claim };
}

describe("startDraft y findByClaim", () => {
  it("crea el borrador con el hash de la llave, nunca con la llave", async () => {
    const { id, claim } = await service.startDraft({ kind: "claim", anonymous: true, ip: "1.1.1.1", userAgent: "ua" });
    expect(ctx.reports[0]).toMatchObject({ id, status: "draft", kind: "claim", anonymous: true, claimTokenHash: hashClaim(claim) });
    expect(JSON.stringify(ctx.reports[0])).not.toContain(claim);
    expect(await service.findByClaim(claim)).toMatchObject({ id });
    expect(await service.findByClaim("x".repeat(43))).toBeNull();
    expect(await service.findByClaim("../")).toBeNull();
    expect(ctx.db.report.findUnique).toHaveBeenCalledTimes(2); // la llave sin forma no consulta
  });

  it("el borrador de un socio copia la identidad de la ficha", async () => {
    const { id } = await service.startDraft({
      kind: "initiative", anonymous: false, memberId: 14, reporter, ip: "1.1.1.1", userAgent: "ua",
    });
    expect(ctx.reports[0]).toMatchObject({ id, memberId: 14, reporterName: "Ana López", reporterDni: "30123456" });
  });
});

describe("saveReporter", () => {
  it("sólo escribe sobre un borrador", async () => {
    const { id } = await service.startDraft({ kind: "claim", anonymous: false, ip: "1", userAgent: "" });
    expect(await service.saveReporter({ reportId: id, ...reporter })).toEqual({ ok: true });
    ctx.reports[0].status = "received";
    expect(await service.saveReporter({ reportId: id, ...reporter })).toEqual({ ok: false, error: REPORT_MESSAGES.notDraft });
  });
});

describe("submit", () => {
  it("pasa draft→received, estampa submittedAt, consentAt y la marca de fuera del barrio", async () => {
    const { id } = await vecinoDraft();
    const r = await service.submit({ reportId: id, ...submission });
    expect(r).toEqual({ ok: true, id });
    expect(ctx.reports[0]).toMatchObject({
      status: "received", submittedAt: NOW, consentAt: NOW, category: "streets", subtype: "pothole",
      outsideBoundary: false, streetName: "Cerro Catedral",
    });
    const far = await vecinoDraft();
    await service.submit({ reportId: far.id, ...submission, lat: -45.8647, lng: -67.4823 });
    expect(ctx.reports[1]).toMatchObject({ outsideBoundary: true });
  });

  it("revalida en la base: sin DNI o sin identidad no pasa, y sin consentimiento tampoco", async () => {
    const { id } = await service.startDraft({ kind: "claim", anonymous: false, ip: "1", userAgent: "" });
    expect(await service.submit({ reportId: id, ...submission })).toEqual({ ok: false, error: REPORT_MESSAGES.identity });
    await service.saveReporter({ reportId: id, ...reporter });
    expect(await service.submit({ reportId: id, ...submission })).toEqual({ ok: false, error: REPORT_MESSAGES.dni });
    ctx.files.push({ id: 1, reportId: id, kind: "dni_front" }, { id: 2, reportId: id, kind: "dni_back" });
    expect(await service.submit({ reportId: id, ...submission, consent: false })).toMatchObject({ ok: false });
    expect(ctx.reports[0].status).toBe("draft");
  });

  it("un socio envía sin DNI ni identidad declarada", async () => {
    const { id } = await service.startDraft({ kind: "initiative", anonymous: false, memberId: 14, reporter, ip: "1", userAgent: "" });
    const r = await service.submit({ reportId: id, ...submission, category: "social", subtype: null, lat: null, lng: null });
    expect(r).toEqual({ ok: true, id });
  });

  it("un segundo envío del mismo borrador no escribe dos veces", async () => {
    const { id } = await vecinoDraft();
    await service.submit({ reportId: id, ...submission });
    expect(await service.submit({ reportId: id, ...submission })).toEqual({ ok: false, error: REPORT_MESSAGES.notDraft });
  });
});

describe("file y dismiss", () => {
  async function received() {
    const { id } = await vecinoDraft();
    await service.submit({ reportId: id, ...submission });
    return id;
  }

  it("presenta un reporte recibido y guarda organismo, fecha, expediente y quién", async () => {
    const id = await received();
    const r = await service.file({ reportId: id, actorId: 9, agency: "scpl", agencyOther: null, filedAt: NOW, reference: "EXP-1", minuteId: null });
    expect(r).toEqual({ ok: true });
    expect(ctx.reports[0]).toMatchObject({ status: "filed", filedAgency: "scpl", filedReference: "EXP-1", filedById: 9, filedAt: NOW });
  });

  it("'Otro' exige el texto del organismo", async () => {
    const id = await received();
    const r = await service.file({ reportId: id, actorId: 9, agency: "other", agencyOther: null, filedAt: NOW, reference: null, minuteId: null });
    expect(r).toMatchObject({ ok: false });
    expect(ctx.reports[0].status).toBe("received");
  });

  it("desestimar exige motivo y sólo actúa sobre received; presentar sobre desestimado falla", async () => {
    const id = await received();
    expect(await service.dismiss({ reportId: id, actorId: 9, reason: "  " })).toMatchObject({ ok: false });
    expect(await service.dismiss({ reportId: id, actorId: 9, reason: "Duplicado del N° 3." })).toEqual({ ok: true });
    expect(ctx.reports[0]).toMatchObject({ status: "dismissed", dismissReason: "Duplicado del N° 3.", dismissedById: 9 });
    expect(await service.file({ reportId: id, actorId: 9, agency: "mcr", agencyOther: null, filedAt: NOW, reference: null, minuteId: null }))
      .toEqual({ ok: false, error: REPORT_MESSAGES.notPending });
    expect(await service.dismiss({ reportId: 999, actorId: 9, reason: "x" })).toEqual({ ok: false, error: REPORT_MESSAGES.notPending });
  });
});

describe("conteos y listados", () => {
  it("pendingCount cuenta sólo received; yearStats cuenta enviados y presentados del año civil", async () => {
    const a = await vecinoDraft(); await service.submit({ reportId: a.id, ...submission });
    const b = await vecinoDraft(); await service.submit({ reportId: b.id, ...submission });
    await service.file({ reportId: b.id, actorId: 9, agency: "mcr", agencyOther: null, filedAt: NOW, reference: null, minuteId: null });
    await service.startDraft({ kind: "claim", anonymous: false, ip: "1", userAgent: "" });
    expect(await service.pendingCount()).toBe(1);
    expect(await service.yearStats(NOW)).toEqual({ received: 2, filed: 1 });
  });

  it("listForMember devuelve sólo los del socio, sin borradores", async () => {
    const mine = await service.startDraft({ kind: "claim", anonymous: false, memberId: 14, reporter, ip: "1", userAgent: "" });
    await service.submit({ reportId: mine.id, ...submission });
    await service.startDraft({ kind: "claim", anonymous: false, memberId: 14, reporter, ip: "1", userAgent: "" });
    await service.startDraft({ kind: "claim", anonymous: false, memberId: 15, reporter, ip: "1", userAgent: "" });
    const list = await service.listForMember(14);
    expect(list.map((r) => r.id)).toEqual([mine.id]);
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npm test -- --run tests/reports-service.test.ts` → FAIL.

- [ ] **Step 3: Escribir el servicio**

```ts
// src/lib/reports/service.ts
// Única puerta de escritura de `reports` (spec §4, §5). Sin mutex: no hay
// invariante "una viva por vecino"; lo que hay son TRANSICIONES, y cada una es
// un `updateMany` condicional por estado (patrón `tokens.consume`): dos POST
// simultáneos escriben uno solo. Las reglas viven en `rules.ts`; acá sólo se
// resuelven datos reales (los archivos que hay, el borrador que existe).
//
// `db` inyectado y singleton al final, como `member-requests/service.ts`.
import type { Prisma, PrismaClient, Report, ReportAgency, ReportFile, ReportKind } from "@/generated/prisma/client";
import { currentYearAR } from "@/lib/dates";
import { prisma } from "@/lib/prisma";
import { isInsideBoundary } from "./boundary";
import { hashClaim, isClaimShaped, mintClaim } from "./claim";
import { REPORT_MESSAGES, validateSubmission } from "./rules";

export type ReportWithFiles = Report & { files: ReportFile[] };
export type Result = { ok: true } | { ok: false; error: string };
export type SubmitResult = { ok: true; id: number } | { ok: false; error: string };

export type ReporterInput = { name: string; dni: string; phone: string; email: string };

type Db = Pick<PrismaClient, "report" | "reportFile">;

/** Inicio del año civil argentino como instante UTC (00:00 AR = 03:00 UTC). */
function yearRangeUtc(now: Date): { gte: Date; lt: Date } {
  const year = currentYearAR(now);
  return { gte: new Date(Date.UTC(year, 0, 1, 3)), lt: new Date(Date.UTC(year + 1, 0, 1, 3)) };
}

export function makeReports(deps: { db: Db; now?: () => Date }) {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());

  return {
    async startDraft(input: {
      kind: ReportKind;
      anonymous: boolean;
      memberId?: number | null;
      reporter?: ReporterInput | null;
      ip: string;
      userAgent: string;
    }): Promise<{ id: number; claim: string }> {
      const { raw, hash } = mintClaim();
      const created = await db.report.create({
        data: {
          kind: input.kind,
          status: "draft",
          anonymous: input.anonymous,
          memberId: input.memberId ?? null,
          reporterName: input.reporter?.name ?? null,
          reporterDni: input.reporter?.dni ?? null,
          reporterPhone: input.reporter?.phone ?? null,
          reporterEmail: input.reporter?.email ?? null,
          claimTokenHash: hash,
          ip: input.ip,
          userAgent: input.userAgent,
        },
      });
      return { id: created.id, claim: raw };
    },

    /** Por el hash de la llave. Devuelve también los enviados: la pantalla del
     *  retome decide qué mostrar según el estado. Una llave sin forma no llega
     *  a la base. */
    async findByClaim(raw: string): Promise<ReportWithFiles | null> {
      if (!isClaimShaped(raw)) return null;
      return db.report.findUnique({ where: { claimTokenHash: hashClaim(raw) }, include: { files: true } });
    },

    async saveReporter(input: { reportId: number } & ReporterInput): Promise<Result> {
      const { count } = await db.report.updateMany({
        where: { id: input.reportId, status: "draft" },
        data: {
          reporterName: input.name.trim(),
          reporterDni: input.dni.trim(),
          reporterPhone: input.phone.trim(),
          reporterEmail: input.email.trim().toLowerCase(),
        },
      });
      return count === 1 ? { ok: true } : { ok: false, error: REPORT_MESSAGES.notDraft };
    },

    /** El envío. Revalida TODO contra la base con `validateSubmission` —el
     *  wizard sólo apaga botones— y escribe con un updateMany por estado. */
    async submit(input: {
      reportId: number;
      category: string | null;
      subtype: string | null;
      description: string;
      lat: number | null;
      lng: number | null;
      streetId: number | null;
      streetName: string | null;
      addressDetail: string | null;
      scplTicket: string | null;
      consent: boolean;
    }): Promise<SubmitResult> {
      const report = await db.report.findUnique({ where: { id: input.reportId }, include: { files: true } });
      if (!report || report.status !== "draft") return { ok: false, error: REPORT_MESSAGES.notDraft };
      if (!input.consent) return { ok: false, error: "Tenés que aceptar el consentimiento de datos personales." };

      const verdict = validateSubmission({
        kind: report.kind,
        category: input.category,
        subtype: input.subtype,
        description: input.description,
        lat: input.lat,
        lng: input.lng,
        isMember: report.memberId !== null,
        reporter: {
          name: report.reporterName, dni: report.reporterDni, phone: report.reporterPhone, email: report.reporterEmail,
        },
        files: {
          dniFront: report.files.some((f) => f.kind === "dni_front"),
          dniBack: report.files.some((f) => f.kind === "dni_back"),
          photos: report.files.filter((f) => f.kind === "photo").length,
        },
      });
      if (!verdict.ok) return verdict;

      const hasCoords = input.lat !== null && input.lng !== null;
      const at = now();
      const { count } = await db.report.updateMany({
        where: { id: report.id, status: "draft" },
        data: {
          status: "received",
          submittedAt: at,
          consentAt: at,
          category: input.category,
          subtype: input.subtype,
          description: input.description.trim(),
          lat: hasCoords ? new Prisma.Decimal(input.lat as number) : null,
          lng: hasCoords ? new Prisma.Decimal(input.lng as number) : null,
          outsideBoundary: hasCoords ? !isInsideBoundary(input.lat as number, input.lng as number) : false,
          streetId: input.streetId,
          streetName: input.streetName?.trim() || null,
          addressDetail: input.addressDetail?.trim() || null,
          scplTicket: input.scplTicket?.trim() || null,
        },
      });
      return count === 1 ? { ok: true, id: report.id } : { ok: false, error: REPORT_MESSAGES.notDraft };
    },

    async file(input: {
      reportId: number;
      actorId: number;
      agency: ReportAgency | null;
      agencyOther: string | null;
      filedAt: Date;
      reference: string | null;
      minuteId: number | null;
    }): Promise<Result> {
      if (input.agency === "other" && !input.agencyOther?.trim()) {
        return { ok: false, error: "Indicá ante qué organismo se presentó." };
      }
      const { count } = await db.report.updateMany({
        where: { id: input.reportId, status: "received" },
        data: {
          status: "filed",
          filedAt: input.filedAt,
          filedById: input.actorId,
          filedAgency: input.agency,
          filedAgencyOther: input.agency === "other" ? input.agencyOther?.trim() ?? null : null,
          filedReference: input.reference?.trim() || null,
          filedMinuteId: input.minuteId,
        },
      });
      return count === 1 ? { ok: true } : { ok: false, error: REPORT_MESSAGES.notPending };
    },

    async dismiss(input: { reportId: number; actorId: number; reason: string }): Promise<Result> {
      const reason = input.reason.trim();
      if (reason.length < 3) return { ok: false, error: "Escribí el motivo (al menos 3 caracteres)." };
      const { count } = await db.report.updateMany({
        where: { id: input.reportId, status: "received" },
        data: { status: "dismissed", dismissedAt: now(), dismissedById: input.actorId, dismissReason: reason.slice(0, 300) },
      });
      return count === 1 ? { ok: true } : { ok: false, error: REPORT_MESSAGES.notPending };
    },

    async listForMember(memberId: number): Promise<ReportWithFiles[]> {
      return db.report.findMany({
        where: { memberId, status: { in: ["received", "filed", "dismissed"] } },
        orderBy: { id: "desc" },
        take: 20,
        include: { files: true },
      });
    },

    /** El número de la pestaña y del tablero: la COLA (spec §5.3), no un histórico. */
    pendingCount(): Promise<number> {
      return db.report.count({ where: { status: "received" } });
    },

    /** Los contadores de transparencia de la landing (spec §5.1). */
    async yearStats(at: Date = now()): Promise<{ received: number; filed: number }> {
      const range = yearRangeUtc(at);
      const [received, filed] = await Promise.all([
        db.report.count({ where: { status: { in: ["received", "filed", "dismissed"] }, submittedAt: range } }),
        db.report.count({ where: { status: "filed", submittedAt: range } }),
      ]);
      return { received, filed };
    },
  };
}

export type ReportsService = ReturnType<typeof makeReports>;

export const reports = makeReports({ db: prisma });
```

> `Prisma.Decimal`: en Prisma 7 con `prisma-client`, `Prisma` se importa del cliente generado (`import { Prisma } from "@/generated/prisma/client"`). Si el import de tipo y de valor colisionan, separar: `import { Prisma } from "@/generated/prisma/client"; import type { PrismaClient, … } from …`. En el test, el fake recibe un objeto `Decimal`; las aserciones no lo comparan.

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npm test -- --run tests/reports-service.test.ts` → PASS (11 tests). Si `new Prisma.Decimal` falla en el test porque el cliente generado necesita `DATABASE_URL`, el fake sigue siendo válido: el módulo sólo usa `Prisma.Decimal` como constructor de valor, que no toca la base.

- [ ] **Step 5: Verificación por mutación (una vez, no queda en el repo)**

Quitar `status: "draft"` del `where` de `submit`, correr el test "un segundo envío…" y verlo en rojo. Restaurar.

- [ ] **Step 6: Commit**

```bash
git add src/lib/reports/service.ts tests/reports-service.test.ts
git commit -m "feat(reports): domain service with conditional state transitions and counts

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Correos — mailer `sendToReport`, tres plantillas y notificador

**Files:**
- Modify: `src/lib/email/index.ts` (campo `reportId` en `send`, método `sendToReport`)
- Modify: `src/lib/email/templates.ts` (al final: `reportReceivedEmail`, `reportFiledEmail`, `reportBoardAlertEmail`)
- Create: `src/lib/reports/notify.ts`
- Test: `tests/reports-notify.test.ts`, `tests/reports-email-templates.test.ts`

**Interfaces:**
- Produces:
  - `mailer.sendToReport({ reportId, to, type, message, summary })`
  - `reportReceivedEmail({ number, kind, categoryLabel, contactEmail })`, `reportFiledEmail({ number, kind, agencyLabel, filedAt, reference })`, `reportBoardAlertEmail({ number, kind, categoryLabel, subtypeLabel, street, description, reporter, panelUrl })` → `Rendered`
  - `makeReportNotifier({ db: Pick<PrismaClient,"report">; mailer: Pick<typeof mailer,"sendToReport">; baseUrl: () => string; contactEmail: () => Promise<string | null> })` con `sendReceived(reportId)`, `sendFiled(reportId)`, `sendBoardAlert(reportId, recipients: string[])`; singleton `reportNotifier`.

- [ ] **Step 1: Tests que fallan**

```ts
// tests/reports-email-templates.test.ts
// Las tres plantillas de Reportes (spec §9): el acuse no promete resolución y
// cierra con el canal ARCO; el aviso dice "presentado ante" o "trató tu
// iniciativa" según el tipo; la alerta a la Comisión lleva identidad completa
// (decisión del operador) y escapa el texto del vecino en el HTML.
import { describe, expect, it } from "vitest";
import { reportBoardAlertEmail, reportFiledEmail, reportReceivedEmail } from "@/lib/email/templates";

describe("reportReceivedEmail", () => {
  it("nombra el número, no promete resolución y cita el email de contacto", () => {
    const m = reportReceivedEmail({ number: 14, kind: "claim", categoryLabel: "Calles y vía pública", contactEmail: "info@vecinal.ar" });
    expect(m.subject).toContain("N° 14");
    expect(m.text).toContain("Comisión Directiva");
    expect(m.text).toContain("info@vecinal.ar");
    expect(m.text.toLowerCase()).not.toContain("vamos a resolver");
    expect(m.html).toContain("N° 14");
  });
  it("sin email de contacto cargado, manda a la sede", () => {
    const m = reportReceivedEmail({ number: 2, kind: "initiative", categoryLabel: "Social", contactEmail: null });
    expect(m.text).toContain("sede");
  });
});

describe("reportFiledEmail", () => {
  it("reclamo: presentado ante el organismo, con expediente si lo hay", () => {
    const m = reportFiledEmail({ number: 14, kind: "claim", agencyLabel: "SCPL", filedAt: new Date("2026-09-12T15:00:00Z"), reference: "1234" });
    expect(m.text).toContain("Presentamos tu reporte N° 14 ante SCPL el 12/09/2026");
    expect(m.text).toContain("1234");
  });
  it("iniciativa: la trató la Comisión", () => {
    const m = reportFiledEmail({ number: 3, kind: "initiative", agencyLabel: null, filedAt: new Date("2026-09-12T15:00:00Z"), reference: null });
    expect(m.text).toContain("La Comisión Directiva trató tu iniciativa N° 3");
  });
});

describe("reportBoardAlertEmail", () => {
  it("lleva identidad completa, marca 'reservado' y escapa el HTML del vecino", () => {
    const m = reportBoardAlertEmail({
      number: 14, kind: "claim", categoryLabel: "Agua potable", subtypeLabel: "Pérdida de agua en la red",
      street: "Cerro Catedral al 280", description: "Hay <b>agua</b> & barro",
      reporter: { name: "Ana López", dni: "30123456", phone: "2974", email: "ana@example.com", anonymous: true },
      panelUrl: "https://vecinalciudadela.ar/admin/solicitudes/reportes/14",
    });
    expect(m.subject).toContain("Reclamo N° 14");
    expect(m.text).toContain("Ana López");
    expect(m.text).toContain("30123456");
    expect(m.text).toContain("reservada");
    expect(m.html).toContain("&lt;b&gt;agua&lt;/b&gt; &amp; barro");
    expect(m.html).toContain("https://vecinalciudadela.ar/admin/solicitudes/reportes/14");
  });
});
```

```ts
// tests/reports-notify.test.ts
// El notificador de Reportes (spec §9): best-effort después del commit, salta
// sin dirección, manda con `sendToReport` (la fila cuelga del reporte) y a la
// Comisión una fila por destinatario. Loguea el CÓDIGO, nunca la dirección.
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import { makeReportNotifier } from "@/lib/reports/notify";

const report = {
  id: 14, kind: "claim", anonymous: false, category: "water", subtype: "leak",
  reporterName: "Ana López", reporterDni: "30123456", reporterPhone: "2974", reporterEmail: "ana@example.com",
  streetName: "Cerro Catedral", addressDetail: "al 280", description: "Pierde agua.",
  filedAgency: "scpl", filedAgencyOther: null, filedAt: new Date("2026-09-12T15:00:00Z"), filedReference: null,
};

function build(over: Partial<typeof report> = {}) {
  const send = vi.fn(async () => ({ messageId: "m" }));
  const db = { report: { findUnique: vi.fn(async () => ({ ...report, ...over })) } };
  const notifier = makeReportNotifier({
    db: db as never, mailer: { sendToReport: send } as never,
    baseUrl: () => "https://vecinalciudadela.ar", contactEmail: async () => "info@vecinal.ar",
  });
  return { notifier, send, db };
}

beforeEach(() => vi.clearAllMocks());

describe("sendReceived / sendFiled", () => {
  it("mandan al email del reporte con el tipo y el reportId", async () => {
    const { notifier, send } = build();
    await notifier.sendReceived(14);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ reportId: 14, to: "ana@example.com", type: "report_received" }));
    await notifier.sendFiled(14);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ reportId: 14, type: "report_filed" }));
  });
  it("sin email no mandan nada y no fallan", async () => {
    const { notifier, send } = build({ reporterEmail: null });
    await notifier.sendReceived(14);
    expect(send).not.toHaveBeenCalled();
  });
  it("un SMTP caído no tira: se loguea el código", async () => {
    const { notifier, send } = build();
    send.mockRejectedValueOnce(Object.assign(new Error("smtp ana@example.com"), { code: "EAUTH" }));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(notifier.sendReceived(14)).resolves.toBeUndefined();
    expect(log.mock.calls.flat().join(" ")).not.toContain("ana@example.com");
    log.mockRestore();
  });
});

describe("sendBoardAlert", () => {
  it("una fila por destinatario, con el enlace al panel", async () => {
    const { notifier, send } = build();
    const r = await notifier.sendBoardAlert(14, ["a@b.com", "c@d.com"]);
    expect(r).toEqual({ sent: 2, failed: 0 });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][0]).toMatchObject({ reportId: 14, to: "a@b.com", type: "report_board_alert" });
    expect(JSON.stringify(send.mock.calls[0][0])).toContain("/admin/solicitudes/reportes/14");
  });
  it("un destinatario que falla no frena al otro", async () => {
    const { notifier, send } = build();
    send.mockRejectedValueOnce(Object.assign(new Error("x"), { code: "ECONN" }));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await notifier.sendBoardAlert(14, ["a@b.com", "c@d.com"])).toEqual({ sent: 1, failed: 1 });
    log.mockRestore();
  });
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npm test -- --run tests/reports-email-templates.test.ts tests/reports-notify.test.ts` → FAIL.

- [ ] **Step 3: `sendToReport` en el mailer**

En `src/lib/email/index.ts`:
- en el `input` de `send`, agregar `reportId?: number | null;` y en `row` agregar `reportId: input.reportId ?? null,`.
- en `sendToMember` y `sendToApplication` no cambia nada (`reportId` queda `null` por el `??`).
- agregar después de `sendToApplication`:

```ts
    // M7: el destinatario es quien reportó (socio o no) o la Comisión, y la fila
    // cuelga del REPORTE. `memberId: null` aunque el autor sea socio: lo que se
    // acredita es el aviso sobre ese reporte, y su ficha ya lo apunta por
    // `Report.memberId`.
    sendToReport(input: {
      reportId: number;
      to: string;
      type: NotificationType;
      message: Omit<MailMessage, "to">;
      summary: string;
    }) {
      return send({ ...input, memberId: null, applicationId: null });
    },
```

- [ ] **Step 4: Las tres plantillas al final de `templates.ts`**

```ts
// ── Módulo 7: Reportes ───────────────────────────────────────────────────────

const REPORT_KIND_WORD = { claim: "reclamo", initiative: "iniciativa" } as const;

/** Acuse al que reporta (spec §9). NO promete resolución: la asociación recibe
 *  y canaliza. Cierra con el canal ARCO (docs/08): un vecino que no es socio no
 *  tiene panel, y el email de contacto de `Configuration` es su única vía. */
export function reportReceivedEmail(opts: {
  number: number;
  kind: "claim" | "initiative";
  categoryLabel: string;
  contactEmail: string | null;
}): Rendered {
  const word = REPORT_KIND_WORD[opts.kind];
  const title = `Recibimos tu ${word} N° ${opts.number}`;
  const arco = opts.contactEmail
    ? `Podés pedir la rectificación o supresión de tus datos escribiendo a ${opts.contactEmail}.`
    : "Podés pedir la rectificación o supresión de tus datos en la sede vecinal.";
  return {
    subject: `${title} — Vecinal Ciudadela`,
    text: `La ${ORG} recibió tu ${word} N° ${opts.number} (${opts.categoryLabel}).

La Comisión Directiva lo va a revisar y, si corresponde, lo va a presentar ante el organismo que corresponda. Te avisamos por este medio cuando eso pase.

Este reporte no reemplaza el reclamo que podés hacer directamente ante el municipio o la SCPL.

${arco}${SIGNATURE}`,
    html: layout(title, `<p>La ${esc(ORG)} recibió tu ${esc(word)} <strong>N° ${opts.number}</strong> (${esc(opts.categoryLabel)}).</p>
<p>La Comisión Directiva lo va a revisar y, si corresponde, lo va a presentar ante el organismo que corresponda. Te avisamos por este medio cuando eso pase.</p>
<p>Este reporte no reemplaza el reclamo que podés hacer directamente ante el municipio o la SCPL.</p>
<p style="font-size:12px;color:#666">${esc(arco)}</p>`),
  };
}

/** Aviso al presentar (reclamo) o tratar (iniciativa). */
export function reportFiledEmail(opts: {
  number: number;
  kind: "claim" | "initiative";
  agencyLabel: string | null;
  filedAt: Date;
  reference: string | null;
}): Rendered {
  const day = formatDateAR(opts.filedAt);
  const ref = opts.reference ? ` (expediente ${opts.reference})` : "";
  const line =
    opts.kind === "claim"
      ? `Presentamos tu reporte N° ${opts.number} ante ${opts.agencyLabel ?? "el organismo"} el ${day}${ref}.`
      : `La Comisión Directiva trató tu iniciativa N° ${opts.number} el ${day}${ref}.`;
  const title = opts.kind === "claim" ? `Presentamos tu reporte N° ${opts.number}` : `Tratamos tu iniciativa N° ${opts.number}`;
  return {
    subject: `${title} — Vecinal Ciudadela`,
    text: `${line}

Desde acá el seguimiento queda en manos del organismo; si te dieron un número de trámite, guardalo.${SIGNATURE}`,
    html: layout(title, `<p>${esc(line)}</p>
<p>Desde acá el seguimiento queda en manos del organismo; si te dieron un número de trámite, guardalo.</p>`),
  };
}

/** Alerta INMEDIATA a la Comisión por cada reporte nuevo (decisión del
 *  operador: con identidad completa). Va a `digest_recipients`, casillas de la
 *  propia Comisión, y por eso —a diferencia del digest— lleva nombre y DNI. El
 *  texto del vecino se escapa: entra tal cual lo tipeó. */
export function reportBoardAlertEmail(opts: {
  number: number;
  kind: "claim" | "initiative";
  categoryLabel: string;
  subtypeLabel: string | null;
  street: string | null;
  description: string;
  reporter: { name: string | null; dni: string | null; phone: string | null; email: string | null; anonymous: boolean };
  panelUrl: string;
}): Rendered {
  const kind = opts.kind === "claim" ? "Reclamo" : "Iniciativa";
  const what = opts.subtypeLabel ? `${opts.categoryLabel} › ${opts.subtypeLabel}` : opts.categoryLabel;
  const who = `${opts.reporter.name ?? "—"} · DNI ${opts.reporter.dni ?? "—"} · ${opts.reporter.phone ?? "—"} · ${opts.reporter.email ?? "—"}`;
  const reserved = opts.reporter.anonymous ? "Pidió que su identidad quede reservada ante el organismo." : "";
  const title = `${kind} N° ${opts.number}: ${what}`;
  return {
    subject: `Nuevo reporte — ${title}`,
    text: `Entró un ${kind.toLowerCase()} nuevo en el sitio.

${what}
${opts.street ? `Ubicación: ${opts.street}\n` : ""}
Quién reporta: ${who}
${reserved ? `${reserved}\n` : ""}
Descripción:
${opts.description}

Verlo en el panel: ${opts.panelUrl}${SIGNATURE}`,
    html: layout(title, `<p>Entró un ${esc(kind.toLowerCase())} nuevo en el sitio.</p>
${opts.street ? `<p><strong>Ubicación:</strong> ${esc(opts.street)}</p>` : ""}
<p><strong>Quién reporta:</strong> ${esc(who)}</p>
${reserved ? `<p><em>${esc(reserved)}</em></p>` : ""}
<p><strong>Descripción:</strong></p>
<p style="white-space:pre-line">${esc(opts.description)}</p>
${button(opts.panelUrl, "Ver en el panel")}`),
  };
}
```

- [ ] **Step 5: El notificador**

```ts
// src/lib/reports/notify.ts
// Correos de un reporte (spec §9). Best-effort, DESPUÉS del commit: un SMTP
// caído no puede convertir "tu reporte entró" en "no pudimos recibirlo". Se
// loguea el CÓDIGO del fallo, nunca la dirección (Ley 25.326). Un bloqueo por
// EMAIL_ALLOWLIST no es un fallo y se cuenta como no enviado sin ruido.
import type { PrismaClient } from "@/generated/prisma/client";
import { CONFIG_KEYS, configReader } from "@/lib/config";
import { mailer } from "@/lib/email";
import { reportBoardAlertEmail, reportFiledEmail, reportReceivedEmail } from "@/lib/email/templates";
import { ALLOWLIST_BLOCK_CODE } from "@/lib/email/transport";
import { prisma } from "@/lib/prisma";
import { AGENCY_LABELS, categoryLabel, subtypeLabel } from "./catalog";

function codeOf(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === "string" && code !== "" ? code.slice(0, 200) : "unknown";
}

export function makeReportNotifier(deps: {
  db: Pick<PrismaClient, "report">;
  mailer: Pick<typeof mailer, "sendToReport">;
  baseUrl: () => string;
  contactEmail: () => Promise<string | null>;
}) {
  async function load(reportId: number) {
    return deps.db.report.findUnique({ where: { id: reportId } });
  }

  function streetOf(r: { streetName: string | null; addressDetail: string | null }): string | null {
    const parts = [r.streetName, r.addressDetail].filter((p): p is string => Boolean(p && p.trim()));
    return parts.length ? parts.join(" ") : null;
  }

  return {
    async sendReceived(reportId: number): Promise<void> {
      try {
        const r = await load(reportId);
        if (!r?.reporterEmail) return;
        await deps.mailer.sendToReport({
          reportId, to: r.reporterEmail, type: "report_received",
          message: reportReceivedEmail({
            number: r.id, kind: r.kind, categoryLabel: categoryLabel(r.kind, r.category),
            contactEmail: await deps.contactEmail(),
          }),
          summary: "acuse de reporte recibido",
        });
      } catch (e) {
        if (codeOf(e) !== ALLOWLIST_BLOCK_CODE) console.error("[reports] falló el acuse del reporte", reportId, "code:", codeOf(e));
      }
    },

    async sendFiled(reportId: number): Promise<void> {
      try {
        const r = await load(reportId);
        if (!r?.reporterEmail || !r.filedAt) return;
        const agencyLabel =
          r.filedAgency === "other" ? r.filedAgencyOther : r.filedAgency ? AGENCY_LABELS[r.filedAgency] : null;
        await deps.mailer.sendToReport({
          reportId, to: r.reporterEmail, type: "report_filed",
          message: reportFiledEmail({ number: r.id, kind: r.kind, agencyLabel, filedAt: r.filedAt, reference: r.filedReference }),
          summary: r.kind === "claim" ? "aviso de reporte presentado" : "aviso de iniciativa tratada",
        });
      } catch (e) {
        if (codeOf(e) !== ALLOWLIST_BLOCK_CODE) console.error("[reports] falló el aviso de presentado", reportId, "code:", codeOf(e));
      }
    },

    /** Una fila por destinatario, como el digest. Devuelve conteos para el log
     *  de la action; nunca direcciones. */
    async sendBoardAlert(reportId: number, recipients: string[]): Promise<{ sent: number; failed: number }> {
      const out = { sent: 0, failed: 0 };
      const r = await load(reportId);
      if (!r) return out;
      const message = reportBoardAlertEmail({
        number: r.id, kind: r.kind,
        categoryLabel: categoryLabel(r.kind, r.category),
        subtypeLabel: r.kind === "claim" ? subtypeLabel(r.category, r.subtype) || null : null,
        street: streetOf(r),
        description: r.description ?? "",
        reporter: {
          name: r.reporterName, dni: r.reporterDni, phone: r.reporterPhone, email: r.reporterEmail, anonymous: r.anonymous,
        },
        panelUrl: `${deps.baseUrl()}/admin/solicitudes/reportes/${r.id}`,
      });
      for (const to of recipients) {
        try {
          await deps.mailer.sendToReport({ reportId, to, type: "report_board_alert", message, summary: "alerta de reporte nuevo a la Comisión" });
          out.sent++;
        } catch (e) {
          if (codeOf(e) === ALLOWLIST_BLOCK_CODE) continue;
          out.failed++;
          console.error("[reports] falló la alerta a la Comisión", reportId, "code:", codeOf(e));
        }
      }
      return out;
    },
  };
}

export const reportNotifier = makeReportNotifier({
  db: prisma,
  mailer,
  baseUrl: () => process.env.AUTH_URL ?? "http://localhost:3000",
  contactEmail: () => configReader.getString(CONFIG_KEYS.contactEmail),
});
```

- [ ] **Step 6: Correr y verificar que pasan**

Run: `npm test -- --run tests/reports-email-templates.test.ts tests/reports-notify.test.ts` → PASS. También `npm test -- --run tests/mailer*.test.ts` (o el que cubra `email/index.ts`) sigue verde: el campo nuevo es opcional.

- [ ] **Step 7: Commit**

```bash
git add src/lib/email/index.ts src/lib/email/templates.ts src/lib/reports/notify.ts tests/reports-email-templates.test.ts tests/reports-notify.test.ts
git commit -m "feat(reports): sendToReport mailer variant, three templates and best-effort notifier

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Retención (purga de DNI a los 360 días y de borradores a las 48 h)

**Files:**
- Create: `src/lib/reports/retention.ts`
- Test: `tests/reports-retention.test.ts`

**Interfaces:**
- Consumes: `rules.ts` (`DNI_RETENTION_DAYS`, `DRAFT_TTL_HOURS`), `storage.ts` (`deleteFiles`, `deleteReportDir`)
- Produces: `makeReportRetention({ db: Pick<PrismaClient, "report">; store: Pick<ReportFileStore, "deleteFiles" | "deleteReportDir">; audit: (e: AuditEntry) => Promise<void>; now?: () => Date })` con `purge(): Promise<RetentionSummary>`; `type RetentionSummary = { dniPurged: number; draftsPurged: number; errors: number }`; singleton `reportRetention`.

- [ ] **Step 1: Test que falla**

```ts
// tests/reports-retention.test.ts
// La purga de Reportes (spec §9): las imágenes del DNI se borran 360 días
// después de presentado o desestimado (y se estampa dniPurgedAt, para no volver
// a mirar esa fila), los borradores nunca enviados se borran a las 48 h con su
// carpeta, un fallo de disco cuenta y no corta la corrida, y sólo se audita si
// hubo algo que purgar.
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import { makeReportRetention } from "@/lib/reports/retention";

const NOW = new Date("2027-09-01T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

function build(rows: Array<Record<string, unknown> & { id: number }>) {
  const db = {
    report: {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const cutoffOr = where.OR as Array<Record<string, { lte: Date }>> | undefined;
        return rows.filter((r) => {
          if (where.status && typeof where.status === "object") {
            if (!(where.status as { in: string[] }).in.includes(r.status as string)) return false;
          } else if (where.status && r.status !== where.status) return false;
          if ("dniPurgedAt" in where && r.dniPurgedAt !== where.dniPurgedAt) return false;
          if (cutoffOr) {
            const hit = cutoffOr.some((c) => Object.entries(c).some(([k, v]) => r[k] instanceof Date && (r[k] as Date) <= v.lte));
            if (!hit) return false;
          }
          if (where.createdAt && !((r.createdAt as Date) <= (where.createdAt as { lte: Date }).lte)) return false;
          return true;
        });
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { id: number }; data: Record<string, unknown> }) => {
        const r = rows.find((x) => x.id === where.id);
        if (r) Object.assign(r, data);
        return { count: r ? 1 : 0 };
      }),
      delete: vi.fn(async ({ where }: { where: { id: number } }) => {
        const i = rows.findIndex((x) => x.id === where.id);
        if (i >= 0) rows.splice(i, 1);
        return {};
      }),
    },
  };
  const store = { deleteFiles: vi.fn(async () => 2), deleteReportDir: vi.fn(async () => {}) };
  const audit = vi.fn(async () => {});
  const retention = makeReportRetention({ db: db as never, store, audit, now: () => NOW });
  return { retention, db, store, audit, rows };
}

beforeEach(() => vi.clearAllMocks());

describe("purge", () => {
  it("borra los DNI de lo cerrado hace más de 360 días y estampa dniPurgedAt", async () => {
    const { retention, store, rows, audit } = build([
      { id: 1, status: "filed", filedAt: new Date(NOW.getTime() - 361 * DAY), dismissedAt: null, dniPurgedAt: null, createdAt: NOW },
      { id: 2, status: "dismissed", filedAt: null, dismissedAt: new Date(NOW.getTime() - 400 * DAY), dniPurgedAt: null, createdAt: NOW },
      { id: 3, status: "filed", filedAt: new Date(NOW.getTime() - 10 * DAY), dismissedAt: null, dniPurgedAt: null, createdAt: NOW },
      { id: 4, status: "filed", filedAt: new Date(NOW.getTime() - 500 * DAY), dismissedAt: null, dniPurgedAt: NOW, createdAt: NOW },
      { id: 5, status: "received", filedAt: null, dismissedAt: null, dniPurgedAt: null, createdAt: NOW },
    ]);
    const s = await retention.purge();
    expect(s).toEqual({ dniPurged: 2, draftsPurged: 0, errors: 0 });
    expect(store.deleteFiles).toHaveBeenCalledWith(1, ["dni_front", "dni_back"]);
    expect(store.deleteFiles).toHaveBeenCalledWith(2, ["dni_front", "dni_back"]);
    expect(store.deleteFiles).toHaveBeenCalledTimes(2);
    expect(rows.find((r) => r.id === 1)?.dniPurgedAt).toEqual(NOW);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "report_retention_purge", detail: s }));
  });

  it("borra los borradores de más de 48 h con su carpeta, y deja los recientes", async () => {
    const { retention, store, rows, db } = build([
      { id: 7, status: "draft", createdAt: new Date(NOW.getTime() - 49 * 60 * 60 * 1000), dniPurgedAt: null, filedAt: null, dismissedAt: null },
      { id: 8, status: "draft", createdAt: new Date(NOW.getTime() - 1 * 60 * 60 * 1000), dniPurgedAt: null, filedAt: null, dismissedAt: null },
    ]);
    const s = await retention.purge();
    expect(s).toEqual({ dniPurged: 0, draftsPurged: 1, errors: 0 });
    expect(store.deleteReportDir).toHaveBeenCalledWith(7);
    expect(db.report.delete).toHaveBeenCalledWith({ where: { id: 7 } });
    expect(rows.map((r) => r.id)).toEqual([8]);
  });

  it("un fallo de disco cuenta como error y no corta la corrida; sin trabajo no audita", async () => {
    const { retention, store, audit } = build([
      { id: 1, status: "filed", filedAt: new Date(NOW.getTime() - 361 * DAY), dismissedAt: null, dniPurgedAt: null, createdAt: NOW },
      { id: 2, status: "filed", filedAt: new Date(NOW.getTime() - 361 * DAY), dismissedAt: null, dniPurgedAt: null, createdAt: NOW },
    ]);
    store.deleteFiles.mockRejectedValueOnce(new Error("EACCES"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await retention.purge()).toEqual({ dniPurged: 1, draftsPurged: 0, errors: 1 });
    log.mockRestore();
    const quiet = build([]);
    expect(await quiet.retention.purge()).toEqual({ dniPurged: 0, draftsPurged: 0, errors: 0 });
    expect(quiet.audit).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npm test -- --run tests/reports-retention.test.ts` → FAIL.

- [ ] **Step 3: Escribir el módulo**

```ts
// src/lib/reports/retention.ts
// Retención de Reportes (spec §2 y §9, docs/08): las imágenes del DNI de un
// vecino se conservan 360 días después de que el reporte se presenta o se
// desestima, y después se borran; un borrador que nunca se envió se borra a
// las 48 h con su carpeta. Corre como paso del cron del digest (todos los días).
//
// Un fallo de disco en un reporte se cuenta y se sigue: la purga de los demás
// no puede depender de un archivo que ya no está. Se audita SÓLO cuando hubo
// algo que purgar: la auditoría es el rastro de un hecho, no un latido.
import type { PrismaClient } from "@/generated/prisma/client";
import { audit as auditReal, type AuditEntry } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { DNI_RETENTION_DAYS, DRAFT_TTL_HOURS } from "./rules";
import { reportFileStore, type ReportFileStore } from "./storage";

export type RetentionSummary = { dniPurged: number; draftsPurged: number; errors: number };

function codeOf(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === "string" && code !== "" ? code : e instanceof Error ? e.name : "unknown";
}

export function makeReportRetention(deps: {
  db: Pick<PrismaClient, "report">;
  store: Pick<ReportFileStore, "deleteFiles" | "deleteReportDir">;
  audit: (entry: AuditEntry) => Promise<void>;
  now?: () => Date;
}) {
  const now = deps.now ?? (() => new Date());

  return {
    async purge(): Promise<RetentionSummary> {
      const at = now();
      const summary: RetentionSummary = { dniPurged: 0, draftsPurged: 0, errors: 0 };

      const dniCutoff = new Date(at.getTime() - DNI_RETENTION_DAYS * 24 * 60 * 60 * 1000);
      const expired = await deps.db.report.findMany({
        where: {
          status: { in: ["filed", "dismissed"] },
          dniPurgedAt: null,
          OR: [{ filedAt: { lte: dniCutoff } }, { dismissedAt: { lte: dniCutoff } }],
        },
        select: { id: true },
      });
      for (const r of expired) {
        try {
          await deps.store.deleteFiles(r.id, ["dni_front", "dni_back"]);
          await deps.db.report.updateMany({ where: { id: r.id }, data: { dniPurgedAt: at } });
          summary.dniPurged++;
        } catch (e) {
          summary.errors++;
          console.error("[reports] no se pudo purgar el DNI del reporte", r.id, "code:", codeOf(e));
        }
      }

      const draftCutoff = new Date(at.getTime() - DRAFT_TTL_HOURS * 60 * 60 * 1000);
      const drafts = await deps.db.report.findMany({
        where: { status: "draft", createdAt: { lte: draftCutoff } },
        select: { id: true },
      });
      for (const r of drafts) {
        try {
          await deps.store.deleteReportDir(r.id);
          await deps.db.report.delete({ where: { id: r.id } }); // Cascade borra report_files
          summary.draftsPurged++;
        } catch (e) {
          summary.errors++;
          console.error("[reports] no se pudo purgar el borrador", r.id, "code:", codeOf(e));
        }
      }

      if (summary.dniPurged > 0 || summary.draftsPurged > 0 || summary.errors > 0) {
        await deps.audit({ action: "report_retention_purge", entity: "cron", detail: summary });
      }
      return summary;
    },
  };
}

export const reportRetention = makeReportRetention({ db: prisma, store: reportFileStore, audit: auditReal });
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npm test -- --run tests/reports-retention.test.ts` → PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/reports/retention.ts tests/reports-retention.test.ts
git commit -m "feat(reports): retention purge for DNI images (360 days) and stale drafts (48 h)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Sección del resumen diario y purga dentro del cron del digest

**Files:**
- Modify: `src/lib/admin/digest.ts` (tipo, `collect`, `hasNews`, `Deps.db`)
- Modify: `src/lib/email/templates.ts` (`boardDigestEmail`: un renglón)
- Modify: `src/app/api/cron/digest/route.ts` (la purga)
- Modify: `tests/admin-digest.test.ts`, `tests/digest-route.test.ts` (aditivo)

**Interfaces:**
- Produces: `DigestData` + `reportsReceived`, `reportsClaims`, `reportsInitiatives`, `reportsPending`; la respuesta del cron incluye `retention: RetentionSummary`.

- [ ] **Step 1: Agregar a los tests existentes los casos que fallan**

En `tests/admin-digest.test.ts`:
- en `empty` agregar `reportsReceived: 0, reportsClaims: 0, reportsInitiatives: 0, reportsPending: 0,`
- en `build`, `db` gana `report: { count: vi.fn(async ({ where }: { where: { kind?: string; status: string | { in: string[] } } }) => { if (where.status === "received" && !where.kind) return over?.reportsPending ?? 0; if (where.kind === "claim") return over?.reportsClaims ?? 0; if (where.kind === "initiative") return over?.reportsInitiatives ?? 0; return (over?.reportsClaims ?? 0) + (over?.reportsInitiatives ?? 0); }) }` y el tipo de `over` suma `reportsClaims: number; reportsInitiatives: number; reportsPending: number`.
- agregar en `describe("hasNews")`:

```ts
  it("un reporte recibido ayer es novedad; la cola sin novedades, no", () => {
    expect(hasNews({ ...empty, reportsReceived: 1 })).toBe(true);
    expect(hasNews({ ...empty, reportsPending: 7 })).toBe(false);
  });
```

- agregar en `describe("digest cron")`:

```ts
  it("junta los reportes recibidos ayer por tipo y la cola sin presentar", async () => {
    const { cron } = build({ reportsClaims: 2, reportsInitiatives: 1, reportsPending: 7 });
    const d = await cron.collect();
    expect(d).toMatchObject({ reportsReceived: 3, reportsClaims: 2, reportsInitiatives: 1, reportsPending: 7 });
  });
```

En `tests/digest-route.test.ts`:
- en `mocks` agregar `purge: vi.fn(async () => ({ dniPurged: 0, draftsPurged: 0, errors: 0 }))` y `vi.mock("@/lib/reports/retention", () => ({ reportRetention: { purge: mocks.purge } }));`
- en `quiet` agregar los cuatro campos en cero.
- reemplazar `expect(await res.json()).toEqual({ skipped: "no_news", day: "14/09/2026" })` por `expect(await res.json()).toEqual({ skipped: "no_news", day: "14/09/2026", retention: { dniPurged: 0, draftsPurged: 0, errors: 0 } })` y agregar `expect(mocks.purge).toHaveBeenCalledTimes(1);`
- reemplazar `expect(await res.json()).toEqual(summary)` por `expect(await res.json()).toEqual({ ...summary, retention: { dniPurged: 0, draftsPurged: 0, errors: 0 } })` y la aserción del `update` por `data: { finishedAt: expect.any(Date), ok: true, summary: { ...summary, retention: { dniPurged: 0, draftsPurged: 0, errors: 0 } } }`; ídem `detail: summary` → `detail: expect.objectContaining(summary)`.
- agregar:

```ts
  it("la purga de retención corre siempre, y si se cae no tumba el resumen", async () => {
    mocks.purge.mockRejectedValueOnce(new Error("disk"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(req("Bearer s3cret"));
    log.mockRestore();
    expect(res.status).toBe(200);
    expect((await res.json()).retention).toEqual({ dniPurged: 0, draftsPurged: 0, errors: 1 });
  });
```

Run: `npm test -- --run tests/admin-digest.test.ts tests/digest-route.test.ts` → FAIL en los casos nuevos.

- [ ] **Step 2: Modificar `digest.ts`**

- `DigestData` suma: `reportsReceived: number; reportsClaims: number; reportsInitiatives: number; reportsPending: number;`
- `hasNews` suma `|| d.reportsReceived > 0` (la cola `reportsPending` NO cuenta como novedad: sin eso, siete reportes viejos sin presentar mandarían un correo todas las mañanas).
- `Deps.db` suma `"report"` al `Pick`.
- en `collect`, al `Promise.all` agregar al final:

```ts
        // M7: reportes ENVIADOS ayer (por `submittedAt`, que es cuando el vecino
        // lo mandó), por tipo, y la cola de sin presentar al momento.
        deps.db.report.count({ where: { kind: "claim", status: { in: ["received", "filed", "dismissed"] }, submittedAt: range } }),
        deps.db.report.count({ where: { kind: "initiative", status: { in: ["received", "filed", "dismissed"] }, submittedAt: range } }),
        deps.db.report.count({ where: { status: "received" } }),
```

  desestructurar como `reportsClaims, reportsInitiatives, reportsPending` y devolver `reportsReceived: reportsClaims + reportsInitiatives, reportsClaims, reportsInitiatives, reportsPending`.

- [ ] **Step 3: El renglón en `boardDigestEmail`**

En `templates.ts`, la firma de `boardDigestEmail` suma `reportsReceived: number; reportsClaims: number; reportsInitiatives: number; reportsPending: number;`, y después del renglón de `applications`:

```ts
  if (d.reportsReceived > 0) {
    add(
      `Reportes recibidos: ${d.reportsReceived} (${d.reportsClaims} ${d.reportsClaims === 1 ? "reclamo" : "reclamos"}, ` +
        `${d.reportsInitiatives} ${d.reportsInitiatives === 1 ? "iniciativa" : "iniciativas"}) · ${d.reportsPending} sin presentar`,
    );
  }
```

- [ ] **Step 4: La purga en la ruta**

En `src/app/api/cron/digest/route.ts`:
- importar `import { reportRetention, type RetentionSummary } from "@/lib/reports/retention";`
- después de `if (!auth.ok) return auth.response;` agregar:

```ts
  // M7: la purga de retención de Reportes corre TODOS los días, antes de decidir
  // si hay novedades que contar, y es best-effort: un fallo de disco queda en el
  // conteo y en el log, y no puede dejar a la Comisión sin su resumen.
  let retention: RetentionSummary = { dniPurged: 0, draftsPurged: 0, errors: 0 };
  try {
    retention = await reportRetention.purge();
  } catch (e) {
    console.error("[cron] digest: la purga de reportes falló entera", safeMessage(e));
    retention = { dniPurged: 0, draftsPurged: 0, errors: 1 };
  }
```

- cambiar `return Response.json({ skipped: "no_news", day: data.label });` por `return Response.json({ skipped: "no_news", day: data.label, retention });`
- después de `const summary = await digestCron.send(data);` usar `const full = { ...summary, retention };` y reemplazar `summary` por `full` en el `update`, el `audit` y el `Response.json` (el `ok` se sigue calculando con `summary.failed === 0`).

- [ ] **Step 5: Correr y verificar**

Run: `npm test -- --run tests/admin-digest.test.ts tests/digest-route.test.ts` → PASS. Después `npx tsc --noEmit` (el tipo de `boardDigestEmail` y `DigestData` tienen que cerrar en todos los llamadores).

- [ ] **Step 6: Commit**

```bash
git add src/lib/admin/digest.ts src/lib/email/templates.ts src/app/api/cron/digest/route.ts tests/admin-digest.test.ts tests/digest-route.test.ts
git commit -m "feat(reports): digest section for reports and retention purge in the daily cron

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: Cierre de la Parte 1

**Files:** ninguno nuevo.

- [ ] **Step 1: Suite entera, tipos y lint**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: todo en verde.

- [ ] **Step 2: Verificar que el núcleo de dinero no se tocó**

Run: `git diff --stat main..reports -- src/lib/treasury src/lib/mp`
Expected: salida vacía.

- [ ] **Step 3: Verificar la migración contra `information_schema` (MariaDB local)**

Run: `npx prisma migrate status`
Expected: "Database schema is up to date!". Y en el cliente de MariaDB: `SHOW COLUMNS FROM notifications LIKE 'type';` tiene que terminar en `'generic','report_received','report_filed','report_board_alert'`.

- [ ] **Step 4: Informe**

Escribir en `.superpowers/sdd/reports/parte-1.md` (crear carpeta) un resumen de dos párrafos: qué se creó, qué se modificó (lista de archivos existentes tocados) y el conteo de tests. Commitear:

```bash
git add .superpowers/sdd/reports/parte-1.md
git commit -m "docs(reports): part 1 (domain core) report

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review de la Parte 1 contra la spec

- §3 catálogo → Task 1. §3.4 polígono → Task 2. §4 datos → Task 3. §4 invariantes (transiciones condicionales) → Task 8. §5 imágenes (sharp, sin EXIF, webp→jpeg) → Task 6-7. §7 `rules`, `service`, `storage`, `images`, `notify`, `retention`, `claim`, limiters → Tasks 4-10 (`counts.ts` de la spec quedó absorbido en `service.pendingCount`/`yearStats`: una función menos que sincronizar). §9 correos, digest, purga → Tasks 9-11. `static-map.ts` y `pdf.ts` van en la Parte 3; `counts.ts` no existe como archivo (cambio consciente respecto de la spec §7).
- Sin placeholders: cada paso trae el código o el comando.
- Firmas cruzadas: `reports.startDraft/findByClaim/saveReporter/submit/file/dismiss/listForMember/pendingCount/yearStats`, `reportFileStore.save/remove/read/deleteFiles/deleteReportDir`, `reportNotifier.sendReceived/sendFiled/sendBoardAlert`, `reportRetention.purge`, `mailer.sendToReport`, limiters `reportDraftLimiter/reportSubmitLimiter/reportUploadLimiter/reportMemberLimiter`. Las Partes 2 y 3 usan exactamente estos nombres.
