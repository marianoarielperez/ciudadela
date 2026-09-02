# Reportes — Parte 2 de 3: vecino y socio — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un vecino sin cuenta y un socio desde `/mi` puedan crear un reporte completo (tipo, reserva de identidad, datos y DNI, categoría, descripción, ubicación en el mapa con el límite del barrio, fotos) y reciban el acuse; y que la Comisión reciba la alerta.

**Architecture:** Wizard cliente de tres pasos (dos en modo socio) sobre las server actions públicas de `src/app/(public)/reportes/actions.ts`, todas dirigidas por la llave del borrador (Parte 1, `reports.findByClaim`). El estado de los pasos vive en el navegador hasta que cada action lo persiste; el borrador nace al terminar el paso 1 y la llave viaja a la URL con `history.replaceState`, exactamente como ASOCIATE. **Ninguna action del wizard revalida rutas** (invariante del `replaceState`). Las piezas visuales se reutilizan de `asociate/wizard-ui.tsx` y `ProcessRail` gana dos props opcionales.

**Tech Stack:** Next.js 16 (App Router, server actions, `useActionState`), React 19, Leaflet 1.9 (sin react-leaflet), Tailwind v4, lucide-react, zod 4, Vitest 4.

**Spec:** `docs/superpowers/specs/2026-09-01-reportes-design.md` §5.1, §5.2, §6.1, §6.2, §8, §10, §11. **Requiere la Parte 1 mergeada en la rama `reports`.**

## Global Constraints

- Las mismas de la Parte 1 (rama, commits, castellano/inglés, cero deps nuevas, `treasury/*` y `mp/*` intactos, auditoría sin datos personales).
- **Ninguna action de este wizard llama `revalidatePath`/`revalidateTag`.** La socio (`/mi/solicitudes/reportes`) es `force-dynamic`: no necesita revalidar.
- `NavButtons` con `submit` XOR `onNext`. Un `useActionState` **por ranura** de archivo. `file.size` antes de `arrayBuffer()`. Sin `capture` en `<input type="file">`. `useFormResetSync` donde haya radios/checkbox que posteen. Foco al `<h1 tabIndex={-1}>` al cambiar de paso. Inputs de 16 px (`CONTROL_HEIGHT`). Targets ≥ 44 px.
- Textos de cara al vecino: spec §11. Sin "vamos a resolver" ni "solucionar".
- Orden canónico de guardas en las actions públicas: guardas de apertura → `allows` → Turnstile → zod → `record` → base.
- Leaflet sólo dentro de un componente `"use client"` montado con `dynamic(..., { ssr: false })` desde OTRO componente cliente. `import "leaflet/dist/leaflet.css"` en el componente del mapa.

---

### Task 1: `ProcessRail` con fases configurables y pin de marca compartido

**Files:**
- Modify: `src/app/(public)/asociate/process-rail.tsx`
- Create: `src/components/map/brand-pin.ts`
- Modify: `src/app/(public)/ubicacion/sede-map.tsx` (importa el SVG del módulo nuevo)
- Test: `tests/process-rail.test.tsx` (nuevo), `tests/brand-pin.test.ts` (nuevo)

**Interfaces:**
- Produces: `ProcessRail({ step, total, subject?, phases? })` con `phases?: Array<{ icon: LucideIcon; label: React.ReactNode; srText: string }>` y `subject?: string` (default `"Tu solicitud"`); `PIN_SVG` y `pinSvg(fill: string): string` en `@/components/map/brand-pin`.

- [ ] **Step 1: Tests que fallan**

```tsx
// tests/process-rail.test.tsx
// `ProcessRail` gana `subject` y `phases` de forma ADITIVA (spec §6.1): sin
// props renderiza exactamente lo de ASOCIATE ("Tu solicitud", "La Comisión
// resuelve", "Alta en acta"); con ellas, lo que pida el wizard de Reportes.
import { renderToStaticMarkup } from "react-dom/server";
import { Landmark, Send } from "lucide-react";
import { describe, expect, it } from "vitest";
import { ProcessRail } from "@/app/(public)/asociate/process-rail";

describe("ProcessRail", () => {
  it("por defecto es el stepper de ASOCIATE", () => {
    const html = renderToStaticMarkup(<ProcessRail step={2} total={6} />);
    expect(html).toContain("Paso 2 de 6 · Tu solicitud");
    expect(html).toContain("La Comisión");
    expect(html).toContain("Alta");
    expect(html).toContain("el alta se asienta en");
  });

  it("acepta un sujeto y fases propias", () => {
    const html = renderToStaticMarkup(
      <ProcessRail
        step={1}
        total={3}
        subject="Tu reporte"
        phases={[
          { icon: Landmark, label: <>La Comisión<br />lo canaliza</>, srText: "lo revisa la Comisión Directiva" },
          { icon: Send, label: <>Presentado<br />al organismo</>, srText: "y lo presenta ante el organismo" },
        ]}
      />,
    );
    expect(html).toContain("Paso 1 de 3 · Tu reporte");
    expect(html).toContain("lo canaliza");
    expect(html).not.toContain("Alta");
    expect(html).toContain("lo revisa la Comisión Directiva y lo presenta ante el organismo");
  });
});
```

```ts
// tests/brand-pin.test.ts
// El pin de marca del mapa vive en un módulo compartido: /ubicacion, el picker
// del wizard y el mapa del admin dibujan el MISMO SVG, con el color que cada uno
// pide.
import { describe, expect, it } from "vitest";
import { PIN_SVG, pinSvg } from "@/components/map/brand-pin";

describe("brand pin", () => {
  it("el pin por defecto es celeste --primary con halo blanco", () => {
    expect(PIN_SVG).toContain('fill="#0079BC"');
    expect(PIN_SVG).toContain('stroke="#FFFFFF"');
    expect(PIN_SVG).toContain('aria-hidden="true"');
  });
  it("pinSvg cambia sólo el relleno", () => {
    const green = pinSvg("#15803D");
    expect(green).toContain('fill="#15803D"');
    expect(green).not.toContain('fill="#0079BC"');
    expect(green.replace("#15803D", "#0079BC")).toBe(PIN_SVG);
  });
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npm test -- --run tests/process-rail.test.tsx tests/brand-pin.test.ts` → FAIL. (Si Vitest no compila `.tsx` de tests con `react-dom/server`, revisar que `tests/health-panels*.test.tsx` ya existe con el mismo patrón y copiar su cabecera.)

- [ ] **Step 3: Extender `ProcessRail`**

Reemplazar el cuerpo exportado por:

```tsx
import { Landmark, Stamp, type LucideIcon } from "lucide-react";

export type ProcessPhase = {
  icon: LucideIcon;
  /** Dos líneas cortas (con `<br />`), como las de ASOCIATE. */
  label: React.ReactNode;
  /** Cómo se dice esa fase en la frase sr-only. */
  srText: string;
};

const ASOCIATE_PHASES: ProcessPhase[] = [
  { icon: Landmark, label: <>La Comisión<br />resuelve</>, srText: "la resuelve la Comisión Directiva" },
  { icon: Stamp, label: <>Alta<br />en acta</>, srText: "y el alta se asienta en acta" },
];

/** `subject` y `phases` son ADITIVAS (M7, spec §6.1): sin ellas el stepper es
 *  el de ASOCIATE, byte por byte en lo que dice. */
export function ProcessRail({
  step, total, subject = "Tu solicitud", phases = ASOCIATE_PHASES,
}: {
  step: number;
  total: number;
  subject?: string;
  phases?: ProcessPhase[];
}) {
  return (
    <div>
      <p className="font-mono text-xs font-semibold tracking-[0.14em] text-primary uppercase">
        Paso {step} de {total} · {subject}
      </p>
      <div aria-hidden className="mt-2.5 flex items-start">
        <div className="min-w-0 flex-1">
          <div className="flex h-6 items-center">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-300 motion-reduce:transition-none"
                style={{ width: `${(step / total) * 100}%` }}
              />
            </div>
          </div>
          <p className="mt-1 text-[10px] font-semibold leading-tight">{subject}</p>
        </div>
        {phases.map((phase, i) => {
          const Icon = phase.icon;
          return (
            <FuturePhase key={i} icon={<Icon className="size-3.5" />}>
              {phase.label}
            </FuturePhase>
          );
        })}
      </div>
      <p className="sr-only">
        Después de enviar, {phases.map((p) => p.srText).join(" ")}.
      </p>
    </div>
  );
}
```

`FuturePhase` queda igual. Verificar que la frase sr-only por defecto sigue conteniendo "el alta se asienta en acta" (el test lo fija).

- [ ] **Step 4: `brand-pin.ts` y el cambio de una línea en `sede-map.tsx`**

```ts
// src/components/map/brand-pin.ts
// El pin de marca de los mapas: gota --primary (#0079BC) con halo blanco. Un
// divIcon SVG evita los PNG del default de Leaflet, que llegan con rutas rotas
// por el bundler. Lo comparten /ubicacion, el picker del wizard de Reportes y
// el mapa del admin (que lo tiñe por estado con `pinSvg`). Módulo PURO: no
// importa Leaflet, así que lo puede leer un test en node.
export function pinSvg(fill: string): string {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="48" viewBox="0 0 40 48" aria-hidden="true">' +
    `<path d="M20 2C11.2 2 4 9.2 4 18c0 11.5 13.3 25.6 14.9 27.2a1.6 1.6 0 0 0 2.2 0C22.7 43.6 36 29.5 36 18 36 9.2 28.8 2 20 2Z" fill="${fill}" stroke="#FFFFFF" stroke-width="3"/>` +
    '<circle cx="20" cy="18" r="6" fill="#FFFFFF"/>' +
    "</svg>"
  );
}

export const PIN_SVG = pinSvg("#0079BC");
export const PIN_SIZE: [number, number] = [40, 48];
export const PIN_ANCHOR: [number, number] = [20, 46];
```

En `sede-map.tsx`: borrar la constante local `PIN_SVG` (y su comentario) y agregar `import { PIN_ANCHOR, PIN_SIZE, PIN_SVG } from "@/components/map/brand-pin";`; en `L.divIcon` usar `iconSize: PIN_SIZE, iconAnchor: PIN_ANCHOR`.

- [ ] **Step 5: Correr y verificar**

Run: `npm test -- --run tests/process-rail.test.tsx tests/brand-pin.test.ts` → PASS. `npx tsc --noEmit` limpio.

- [ ] **Step 6: Commit**

```bash
git add src/app/(public)/asociate/process-rail.tsx src/components/map/brand-pin.ts src/app/(public)/ubicacion/sede-map.tsx tests/process-rail.test.tsx tests/brand-pin.test.ts
git commit -m "refactor(public): ProcessRail accepts subject and phases; shared brand pin SVG

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Sección pública "Reportes": nav, sitemap, robots y cabecera de geolocalización

**Files:**
- Modify: `src/lib/public-nav.ts`, `src/app/sitemap.ts`, `src/app/robots.ts`, `next.config.ts`
- Test: `tests/public-nav.test.ts` (nuevo), `tests/reports-headers.test.ts` (nuevo)

- [ ] **Step 1: Tests que fallan**

```ts
// tests/public-nav.test.ts
// La nav pública no tenía test (informe 01). Se fija: hrefs únicos, cada href
// con su page.tsx en disco, y que "Reportes" (M7) está después de Ubicación.
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PUBLIC_NAV_LINKS } from "@/lib/public-nav";

describe("PUBLIC_NAV_LINKS", () => {
  it("hrefs únicos y cada uno con page.tsx bajo src/app/(public)", () => {
    const hrefs = PUBLIC_NAV_LINKS.map(([href]) => href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    const root = path.resolve(import.meta.dirname, "..", "src", "app", "(public)");
    for (const href of hrefs) {
      const file = path.join(root, ...href.split("/").filter(Boolean), "page.tsx");
      expect(existsSync(file), `${href} → ${file}`).toBe(true);
    }
  });
  it("termina en Reportes, después de Ubicación", () => {
    const hrefs = PUBLIC_NAV_LINKS.map(([href]) => href);
    expect(hrefs.at(-1)).toBe("/reportes");
    expect(hrefs.indexOf("/reportes")).toBe(hrefs.indexOf("/ubicacion") + 1);
    expect(PUBLIC_NAV_LINKS.at(-1)?.[1]).toBe("Reportes");
  });
});
```

```ts
// tests/reports-headers.test.ts
// Lo que llega al navegador lo decide `next.config.ts`, no el handler (lección
// CSP/setHeader). Se fija: la geolocalización queda apagada para el sitio y se
// enciende (`self`) SÓLO en las rutas del wizard de Reportes; robots cierra el
// prefijo de la llave; el sitemap lista /reportes.
import { describe, expect, it } from "vitest";
import config from "../next.config";
import robots from "@/app/robots";

type Header = { key: string; value: string };
type Entry = { source: string; headers: Header[] };

async function entries(): Promise<Entry[]> {
  const cfg = config("phase-development-server");
  return (await cfg.headers!()) as Entry[];
}

describe("Permissions-Policy", () => {
  it("global: geolocation=(); wizard público y del socio: geolocation=(self)", async () => {
    const all = await entries();
    const global = all.find((e) => e.source === "/(.*)")!;
    expect(global.headers.find((h) => h.key === "Permissions-Policy")?.value).toBe("camera=(), microphone=(), geolocation=()");
    for (const source of ["/reportes/:path*", "/mi/solicitudes/reportes/:path*"]) {
      const entry = all.find((e) => e.source === source);
      expect(entry, source).toBeDefined();
      expect(entry!.headers.find((h) => h.key === "Permissions-Policy")?.value).toBe("camera=(), microphone=(), geolocation=(self)");
      // Declarada DESPUÉS de la global: `headers()` pisa por clave en orden.
      expect(all.indexOf(entry!)).toBeGreaterThan(all.indexOf(global));
    }
  });
});

describe("robots", () => {
  it("cierra /reportes/nuevo (la llave viaja en la URL) y deja /reportes abierto", () => {
    process.env.AUTH_URL = "https://vecinalciudadela.ar";
    const r = robots();
    const disallow = (r.rules as { disallow: string[] }).disallow;
    expect(disallow).toContain("/reportes/nuevo");
    expect(disallow).not.toContain("/reportes");
  });
});
```

Run: `npm test -- --run tests/public-nav.test.ts tests/reports-headers.test.ts` → FAIL (falta `/reportes` y las entradas). El caso "page.tsx en disco" va a fallar hasta la Task 4; se acepta rojo transitorio SOLO en ese `it` hasta entonces (anotarlo en el commit).

- [ ] **Step 2: Cambios**

`src/lib/public-nav.ts`: agregar `["/reportes", "Reportes"],` después de Ubicación.

`src/app/sitemap.ts`: en `fixed`, agregar `{ url: abs("/reportes"), changeFrequency: "monthly", priority: 0.7 },`.

`src/app/robots.ts`: en `disallow`, agregar `"/reportes/nuevo",` después de `"/reempadronate/retomar"`, y en el comentario de cabecera sumar `/reportes/nuevo/<llave>` a la lista de rutas cuya URL es un secreto.

`next.config.ts`: dentro de `headers()`, **después** de las cuatro entradas específicas existentes, agregar:

```ts
      // M7 (Reportes): la entrada global apaga la geolocalización para todo el
      // sitio, y el picker de ubicación del wizard la necesita ("Usar mi
      // ubicación"). Se reabre SÓLO para las dos rutas del wizard —la pública y
      // la del socio— y sólo para el propio origen. `headers()` pisa por CLAVE
      // en orden de declaración: por eso estas dos van DESPUÉS de la global.
      {
        source: "/reportes/:path*",
        headers: [{ key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" }],
      },
      {
        source: "/mi/solicitudes/reportes/:path*",
        headers: [{ key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" }],
      },
```

- [ ] **Step 3: Correr y commitear**

Run: `npm test -- --run tests/reports-headers.test.ts` → PASS. `tests/public-nav.test.ts`: el `it` de "termina en Reportes" pasa; el de `page.tsx` queda rojo hasta la Task 4.

```bash
git add src/lib/public-nav.ts src/app/sitemap.ts src/app/robots.ts next.config.ts tests/public-nav.test.ts tests/reports-headers.test.ts
git commit -m "feat(reports): public nav entry, sitemap, robots and geolocation permission for the wizard routes

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Server actions públicas del wizard

**Files:**
- Create: `src/app/(public)/reportes/wizard-shared.ts`
- Create: `src/app/(public)/reportes/actions.ts`
- Test: `tests/reports-public-actions.test.ts`

**Interfaces:**
- Consumes (Parte 1): `reports`, `reportFileStore`, `reportNotifier`, limiters, `REPORT_MESSAGES`, `MAX_DESCRIPTION`, `isClaimShaped`, `verifyTurnstile`, `configReader`, `parseRecipients`, `audit`.
- Produces (todas `(prev, formData) => Promise<State>`):
  - `startReportAction` → `StartState = { error?: string; started?: { claim: string } }`; campos: `kind` (`reclamo|iniciativa`), `anonymous` (`si|no`), `cf-turnstile-response`.
  - `saveReporterAction` → `ReporterState = { error?: string; saved?: true }`; campos `claim, name, dni, phone, email`.
  - `uploadReportFileAction` → `UploadState = { error?: string; uploaded?: { id: number; kind: FileKindSlug } }`; campos `claim, kind, file`.
  - `removeReportFileAction` → `RemoveState = { error?: string; removed?: true }`; campos `claim, fileId`.
  - `submitReportAction` → `SubmitState = { error?: string; done?: { number: number } }`; campos `claim, category, subtype?, description, lat?, lng?, streetId?, streetName?, addressDetail?, scplTicket?, consent ("on")`.
  - `wizard-shared.ts`: los tipos de estado espejo, `type FileKindSlug = "photo" | "dni_front" | "dni_back"`, `type ReportSnapshot`, `type ReportMode = "public" | "member"`, `CONTROL_HEIGHT/FOCUS_RING/LINK_TARGET` re-exportadas de ASOCIATE.

- [ ] **Step 1: Test que falla**

```ts
// tests/reports-public-actions.test.ts
// Las actions públicas del wizard de Reportes (spec §5.1, §10): orden de
// guardas (allows → captcha → zod → record), la llave manda (nunca un id del
// formulario), el tamaño se mira antes de leer el archivo, el envío manda el
// acuse y la alerta DESPUÉS de escribir y audita sin datos personales, y ninguna
// revalida rutas.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  startDraft: vi.fn(), findByClaim: vi.fn(), saveReporter: vi.fn(), submit: vi.fn(),
  save: vi.fn(), remove: vi.fn(),
  sendReceived: vi.fn(async () => {}), sendBoardAlert: vi.fn(async () => ({ sent: 1, failed: 0 })),
  verify: vi.fn(async () => true), audit: vi.fn(async () => {}),
  getString: vi.fn(async () => "a@b.com"),
  draftAllows: vi.fn(() => true), draftRecord: vi.fn(),
  submitAllows: vi.fn(() => true), submitRecord: vi.fn(),
  uploadCheck: vi.fn(() => true), tokenCheck: vi.fn(() => true),
}));
vi.mock("@/lib/reports/service", () => ({
  reports: { startDraft: mocks.startDraft, findByClaim: mocks.findByClaim, saveReporter: mocks.saveReporter, submit: mocks.submit },
}));
vi.mock("@/lib/reports/storage", () => ({ reportFileStore: { save: mocks.save, remove: mocks.remove } }));
vi.mock("@/lib/reports/notify", () => ({ reportNotifier: { sendReceived: mocks.sendReceived, sendBoardAlert: mocks.sendBoardAlert } }));
vi.mock("@/lib/turnstile", () => ({ verifyTurnstile: mocks.verify }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/config", async (orig) => ({
  ...(await orig<typeof import("@/lib/config")>()),
  configReader: { getString: mocks.getString, getBool: vi.fn(async () => true) },
}));
vi.mock("@/lib/auth/rate-limiter", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth/rate-limiter")>()),
  reportDraftLimiter: { allows: mocks.draftAllows, record: mocks.draftRecord },
  reportSubmitLimiter: { allows: mocks.submitAllows, record: mocks.submitRecord },
  reportUploadLimiter: { check: mocks.uploadCheck },
  publicTokenLimiter: { check: mocks.tokenCheck },
}));
vi.mock("next/headers", () => ({ headers: async () => new Map([["x-real-ip", "9.9.9.9"], ["user-agent", "ua"]]) }));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(() => { throw new Error("una action del wizard NO revalida"); }),
  revalidateTag: vi.fn(() => { throw new Error("una action del wizard NO revalida"); }),
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import {
  removeReportFileAction, saveReporterAction, startReportAction, submitReportAction, uploadReportFileAction,
} from "@/app/(public)/reportes/actions";

const CLAIM = "A".repeat(43);
const fd = (o: Record<string, string | Blob>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const draft = (over: Record<string, unknown> = {}) => ({
  id: 14, status: "draft", kind: "claim", memberId: null, files: [], ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.startDraft.mockResolvedValue({ id: 14, claim: CLAIM });
  mocks.findByClaim.mockResolvedValue(draft());
  mocks.saveReporter.mockResolvedValue({ ok: true });
  mocks.submit.mockResolvedValue({ ok: true, id: 14 });
  mocks.save.mockResolvedValue({ id: 3, width: 10, height: 10 });
  mocks.remove.mockResolvedValue(true);
  mocks.draftAllows.mockReturnValue(true);
  mocks.submitAllows.mockReturnValue(true);
  mocks.verify.mockResolvedValue(true);
});

describe("startReportAction", () => {
  it("allows → captcha → zod → record → base, y devuelve la llave", async () => {
    const r = await startReportAction({}, fd({ kind: "reclamo", anonymous: "si", "cf-turnstile-response": "t" }));
    expect(r).toEqual({ started: { claim: CLAIM } });
    expect(mocks.startDraft).toHaveBeenCalledWith({ kind: "claim", anonymous: true, memberId: null, reporter: null, ip: "9.9.9.9", userAgent: "ua" });
    expect(mocks.draftRecord).toHaveBeenCalledWith("9.9.9.9");
  });
  it("sin cupo no llama al captcha; con captcha inválido no cobra el intento", async () => {
    mocks.draftAllows.mockReturnValue(false);
    expect((await startReportAction({}, fd({ kind: "reclamo", anonymous: "no" }))).error).toContain("Demasiados");
    expect(mocks.verify).not.toHaveBeenCalled();
    mocks.draftAllows.mockReturnValue(true);
    mocks.verify.mockResolvedValue(false);
    expect((await startReportAction({}, fd({ kind: "reclamo", anonymous: "no" }))).error).toContain("persona");
    expect(mocks.draftRecord).not.toHaveBeenCalled();
    expect(mocks.startDraft).not.toHaveBeenCalled();
  });
  it("un tipo fuera del enum se rechaza con el mensaje del schema", async () => {
    const r = await startReportAction({}, fd({ kind: "queja", anonymous: "no", "cf-turnstile-response": "t" }));
    expect(r.error).toBe("Elegí qué querés reportar.");
  });
});

describe("saveReporterAction", () => {
  it("guarda sobre el borrador de la llave, con el email en minúsculas", async () => {
    const r = await saveReporterAction({}, fd({ claim: CLAIM, name: "Ana López", dni: "30123456", phone: "2974000000", email: "ANA@Example.com" }));
    expect(r).toEqual({ saved: true });
    expect(mocks.saveReporter).toHaveBeenCalledWith({ reportId: 14, name: "Ana López", dni: "30123456", phone: "2974000000", email: "ana@example.com" });
  });
  it("una llave sin forma o sin borrador no toca el servicio", async () => {
    expect((await saveReporterAction({}, fd({ claim: "../x", name: "a", dni: "1234567", phone: "123456", email: "a@b.com" }))).error).toContain("No encontramos");
    mocks.findByClaim.mockResolvedValue(null);
    expect((await saveReporterAction({}, fd({ claim: CLAIM, name: "Ana López", dni: "30123456", phone: "2974000000", email: "a@b.com" }))).error).toContain("No encontramos");
    expect(mocks.saveReporter).not.toHaveBeenCalled();
  });
  it("el DNI se valida con el mismo regex de ASOCIATE", async () => {
    const r = await saveReporterAction({}, fd({ claim: CLAIM, name: "Ana López", dni: "12.345.678", phone: "2974000000", email: "a@b.com" }));
    expect(r.error).toContain("DNI");
  });
});

describe("uploadReportFileAction", () => {
  it("guarda una foto contra el borrador de la llave", async () => {
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff, 0])], "f.jpg", { type: "image/jpeg" });
    const r = await uploadReportFileAction({}, fd({ claim: CLAIM, kind: "photo", file }));
    expect(r).toEqual({ uploaded: { id: 3, kind: "photo" } });
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ reportId: 14, kind: "photo" }));
  });
  it("un archivo de más de 10 MB se rechaza SIN leerlo", async () => {
    const big = { size: 10 * 1024 * 1024 + 1, arrayBuffer: vi.fn() } as unknown as File;
    Object.setPrototypeOf(big, File.prototype);
    const r = await uploadReportFileAction({}, fd({ claim: CLAIM, kind: "photo", file: big as unknown as Blob }));
    expect(r.error).toContain("10 MB");
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("un tipo de archivo inválido o un borrador ya enviado se rechazan", async () => {
    const file = new File([new Uint8Array([1])], "f.jpg");
    expect((await uploadReportFileAction({}, fd({ claim: CLAIM, kind: "selfie", file }))).error).toBeTruthy();
    mocks.findByClaim.mockResolvedValue(draft({ status: "received" }));
    expect((await uploadReportFileAction({}, fd({ claim: CLAIM, kind: "photo", file }))).error).toContain("ya fue enviado");
  });
});

describe("removeReportFileAction", () => {
  it("quita un archivo del borrador de la llave", async () => {
    expect(await removeReportFileAction({}, fd({ claim: CLAIM, fileId: "3" }))).toEqual({ removed: true });
    expect(mocks.remove).toHaveBeenCalledWith({ reportId: 14, fileId: 3 });
  });
});

describe("submitReportAction", () => {
  const body = {
    claim: CLAIM, category: "streets", subtype: "pothole", description: "Un pozo.",
    lat: "-45.797", lng: "-67.494", streetId: "3", streetName: "Cerro Catedral", addressDetail: "al 280", consent: "on",
  };
  it("envía, manda el acuse y la alerta, audita sin datos personales", async () => {
    const r = await submitReportAction({}, fd(body));
    expect(r).toEqual({ done: { number: 14 } });
    expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({
      reportId: 14, category: "streets", subtype: "pothole", lat: -45.797, lng: -67.494, streetId: 3, consent: true,
    }));
    expect(mocks.submitRecord).toHaveBeenCalledWith("9.9.9.9");
    expect(mocks.sendReceived).toHaveBeenCalledWith(14);
    expect(mocks.sendBoardAlert).toHaveBeenCalledWith(14, ["a@b.com"]);
    const entry = mocks.audit.mock.calls[0][0] as { action: string; detail: unknown };
    expect(entry.action).toBe("report_submitted");
    expect(JSON.stringify(entry)).not.toContain("Cerro Catedral");
    expect(JSON.stringify(entry)).not.toContain("Un pozo");
  });
  it("sin consentimiento o sin cupo no escribe", async () => {
    expect((await submitReportAction({}, fd({ ...body, consent: "" }))).error).toContain("consentimiento");
    mocks.submitAllows.mockReturnValue(false);
    expect((await submitReportAction({}, fd(body))).error).toContain("Demasiados");
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("traslada el error del servicio y no manda correos", async () => {
    mocks.submit.mockResolvedValue({ ok: false, error: "Falta subir el frente y el dorso de tu DNI." });
    const r = await submitReportAction({}, fd(body));
    expect(r.error).toContain("DNI");
    expect(mocks.sendReceived).not.toHaveBeenCalled();
  });
  it("un SMTP caído en el acuse no convierte el envío en error", async () => {
    mocks.sendReceived.mockRejectedValueOnce(new Error("x"));
    expect(await submitReportAction({}, fd(body))).toEqual({ done: { number: 14 } });
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npm test -- --run tests/reports-public-actions.test.ts` → FAIL.

- [ ] **Step 3: `wizard-shared.ts`**

```ts
// src/app/(public)/reportes/wizard-shared.ts
// Tipos y piezas comunes del wizard de Reportes (M7). Los estados de las
// actions se redeclaran acá porque un módulo "use server" sólo exporta
// funciones async (misma regla y misma advertencia que ASOCIATE: la
// equivalencia con `actions.ts` se sostiene a mano).
import type { ReportKindSlug } from "@/lib/reports/catalog";

export { CONTROL_HEIGHT, FOCUS_RING, LINK_TARGET, type StreetOption } from "../asociate/wizard-shared";

export type ReportMode = "public" | "member";
export type FileKindSlug = "photo" | "dni_front" | "dni_back";

export type StartState = { error?: string; started?: { claim: string } };
export type ReporterState = { error?: string; saved?: true };
export type UploadState = { error?: string; uploaded?: { id: number; kind: FileKindSlug } };
export type RemoveState = { error?: string; removed?: true };
export type SubmitState = { error?: string; done?: { number: number } };

export type UploadedFile = { id: number; kind: FileKindSlug };

/** Lo que el wizard sabe de un borrador ya creado (rehidratación desde
 *  `/reportes/nuevo/[claim]`). Sin id, sin DNI, sin descripción: nada que no
 *  haga falta para decidir la pantalla (mismo criterio que `ApplicationSnapshot`). */
export type ReportSnapshot = {
  status: "draft" | "received" | "filed" | "dismissed";
  kind: ReportKindSlug;
  anonymous: boolean;
  /** Sólo `true` si nombre, DNI, teléfono y email ya están en la base. */
  reporterComplete: boolean;
  reporter: { name: string; phone: string; email: string; dni: string } | null;
  files: UploadedFile[];
  /** El N° visible, sólo cuando ya fue enviado. */
  number: number | null;
};

export type ReportDraft = {
  kind: ReportKindSlug | "";
  anonymous: "" | "si" | "no";
  name: string;
  dni: string;
  phone: string;
  email: string;
  category: string;
  subtype: string;
  description: string;
  lat: number | null;
  lng: number | null;
  streetId: number | null;
  streetName: string;
  addressDetail: string;
  scplTicket: string;
  consent: boolean;
};

export const EMPTY_REPORT_DRAFT: ReportDraft = {
  kind: "", anonymous: "", name: "", dni: "", phone: "", email: "",
  category: "", subtype: "", description: "", lat: null, lng: null,
  streetId: null, streetName: "", addressDetail: "", scplTicket: "", consent: false,
};
```

- [ ] **Step 4: `actions.ts`**

```ts
"use server";
// Las actions públicas del wizard de Reportes (M7, spec §5.1 y §10). No hay
// sesión: el paso 1 se protege con Turnstile + cupo por IP, y todo lo demás con
// la LLAVE del borrador (256 bits, sólo el hash en la base). Ninguna recibe un
// id por el formulario: el cliente no puede apuntar al reporte de otro.
//
// Y NINGUNA revalida rutas: el wizard estampa la llave en la URL con
// `history.replaceState` (el patrón de ASOCIATE) y esa invariante depende de
// que no haya payload de flight en la respuesta. Ver `asociate-wizard.tsx`.
//
// Las mismas actions las usa el wizard del SOCIO desde /mi: el socio ya tiene
// borrador (lo crea `startMemberReportAction`, en /mi/solicitudes/reportes/
// actions.ts), y a partir de ahí la llave manda igual que para el vecino.
import { headers } from "next/headers";
import { z } from "zod";
import { audit } from "@/lib/audit";
import {
  publicTokenLimiter, reportDraftLimiter, reportSubmitLimiter, reportUploadLimiter,
} from "@/lib/auth/rate-limiter";
import { CONFIG_KEYS, configReader, parseRecipients } from "@/lib/config";
import { parseForm } from "@/lib/forms";
import { isClaimShaped } from "@/lib/reports/claim";
import { reportNotifier } from "@/lib/reports/notify";
import { MAX_DESCRIPTION, REPORT_MESSAGES } from "@/lib/reports/rules";
import { reports, type ReportWithFiles } from "@/lib/reports/service";
import { reportFileStore } from "@/lib/reports/storage";
import { MAX_IMAGE_BYTES } from "@/lib/reports/images";
import { verifyTurnstile } from "@/lib/turnstile";

type StartState = { error?: string; started?: { claim: string } };
type ReporterState = { error?: string; saved?: true };
type UploadState = { error?: string; uploaded?: { id: number; kind: "photo" | "dni_front" | "dni_back" } };
type RemoveState = { error?: string; removed?: true };
type SubmitState = { error?: string; done?: { number: number } };

const TOO_MANY = "Demasiados intentos desde esta conexión. Probá de nuevo en un rato.";
const NO_CAPTCHA = "No pudimos verificar que sos una persona. Recargá la página y probá de nuevo.";
const FILE_KINDS = ["photo", "dni_front", "dni_back"] as const;

const dniSchema = z.string().regex(/^\d{7,9}$/, "DNI inválido (solo números, sin puntos)");

const startSchema = z.object({
  kind: z.enum(["reclamo", "iniciativa"], { error: "Elegí qué querés reportar." }),
  anonymous: z.enum(["si", "no"], { error: "Contanos cómo querés figurar." }),
});

const reporterSchema = z.object({
  claim: z.string(),
  name: z.string().min(3, "Ingresá tu nombre y apellido").max(160, "El nombre no puede superar los 160 caracteres"),
  dni: dniSchema,
  phone: z.string().min(6, "Ingresá tu teléfono").max(40, "El teléfono no puede superar los 40 caracteres"),
  email: z.email("Ingresá un email válido").max(191, "El email no puede superar los 191 caracteres"),
});

const coord = z.coerce.number({ error: REPORT_MESSAGES.location }).optional();

const submitSchema = z.object({
  claim: z.string(),
  category: z.string().min(1, REPORT_MESSAGES.category).max(40, REPORT_MESSAGES.category),
  subtype: z.string().max(60, REPORT_MESSAGES.subtype).optional(),
  description: z.string().min(1, REPORT_MESSAGES.description).max(MAX_DESCRIPTION, REPORT_MESSAGES.descriptionLong),
  lat: coord,
  lng: coord,
  streetId: z.coerce.number().int().positive().optional(),
  streetName: z.string().max(120, "La calle no puede superar los 120 caracteres").optional(),
  addressDetail: z.string().max(160, "La referencia no puede superar los 160 caracteres").optional(),
  scplTicket: z.string().max(40, "El número de reclamo no puede superar los 40 caracteres").optional(),
  consent: z.literal("on", { error: "Tenés que aceptar el consentimiento de datos personales." }),
});

async function requestMeta() {
  const h = await headers();
  return { ip: h.get("x-real-ip") ?? "unknown", userAgent: (h.get("user-agent") ?? "").slice(0, 255) };
}

function codeOf(e: unknown): string {
  return typeof e === "object" && e !== null && "code" in e ? String((e as { code: unknown }).code) : "unknown";
}

type Lookup = { ok: true; report: ReportWithFiles } | { ok: false; error: string };

/** El borrador desde la llave del formulario. Forma → cupo → base. Sólo
 *  `draft` admite escritura; el resto contesta que ya fue enviado. */
async function draftFromClaim(raw: string, limiter: { check(key: string): boolean }): Promise<Lookup> {
  if (!isClaimShaped(raw)) return { ok: false, error: REPORT_MESSAGES.linkDead };
  const { ip } = await requestMeta();
  if (!limiter.check(ip)) return { ok: false, error: TOO_MANY };
  const report = await reports.findByClaim(raw);
  if (!report) return { ok: false, error: REPORT_MESSAGES.linkDead };
  if (report.status !== "draft") return { ok: false, error: REPORT_MESSAGES.notDraft };
  return { ok: true, report };
}

export async function startReportAction(_prev: StartState, formData: FormData): Promise<StartState> {
  const { ip, userAgent } = await requestMeta();
  if (!reportDraftLimiter.allows(ip)) return { error: TOO_MANY };
  const captcha = await verifyTurnstile(String(formData.get("cf-turnstile-response") ?? ""), ip);
  if (!captcha) return { error: NO_CAPTCHA };
  const parsed = parseForm(startSchema, formData);
  if (!parsed.ok) return { error: parsed.error };
  reportDraftLimiter.record(ip);

  const { claim } = await reports.startDraft({
    kind: parsed.data.kind === "reclamo" ? "claim" : "initiative",
    anonymous: parsed.data.anonymous === "si",
    memberId: null,
    reporter: null,
    ip,
    userAgent,
  });
  return { started: { claim } };
}

export async function saveReporterAction(_prev: ReporterState, formData: FormData): Promise<ReporterState> {
  const parsed = parseForm(reporterSchema, formData);
  if (!parsed.ok) return { error: parsed.error };
  const found = await draftFromClaim(parsed.data.claim, publicTokenLimiter);
  if (!found.ok) return { error: found.error };
  const result = await reports.saveReporter({
    reportId: found.report.id,
    name: parsed.data.name,
    dni: parsed.data.dni,
    phone: parsed.data.phone,
    email: parsed.data.email.toLowerCase(),
  });
  return result.ok ? { saved: true } : { error: result.error };
}

export async function uploadReportFileAction(_prev: UploadState, formData: FormData): Promise<UploadState> {
  const kind = String(formData.get("kind") ?? "");
  if (!(FILE_KINDS as readonly string[]).includes(kind)) return { error: "Tipo de archivo inválido." };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Elegí una foto." };
  // El tope se mira ANTES de leer el buffer: sin esto un archivo de 30 MB se lee
  // entero a memoria antes de que nadie lo rechace.
  if (file.size > MAX_IMAGE_BYTES) {
    return { error: "La foto supera el máximo de 10 MB. Probá con una de menor calidad." };
  }
  const found = await draftFromClaim(String(formData.get("claim") ?? ""), reportUploadLimiter);
  if (!found.ok) return { error: found.error };

  try {
    const saved = await reportFileStore.save({
      reportId: found.report.id,
      kind: kind as (typeof FILE_KINDS)[number],
      data: Buffer.from(await file.arrayBuffer()),
    });
    return { uploaded: { id: saved.id, kind: kind as (typeof FILE_KINDS)[number] } };
  } catch (e) {
    // Los mensajes del store son para el vecino; un fallo de disco trae `code`
    // y su mensaje lleva la ruta absoluta: ése va al log, nunca a la pantalla.
    const code = codeOf(e);
    if (code !== "unknown") {
      console.error("[reportes] falló el guardado de un archivo", found.report.id, "code:", code);
      return { error: "No pudimos guardar la foto. Probá de nuevo en unos minutos." };
    }
    return { error: e instanceof Error ? e.message : "No pudimos guardar la foto." };
  }
}

export async function removeReportFileAction(_prev: RemoveState, formData: FormData): Promise<RemoveState> {
  const fileId = Number(formData.get("fileId"));
  if (!Number.isInteger(fileId) || fileId <= 0) return { error: "Archivo inválido." };
  const found = await draftFromClaim(String(formData.get("claim") ?? ""), reportUploadLimiter);
  if (!found.ok) return { error: found.error };
  const removed = await reportFileStore.remove({ reportId: found.report.id, fileId });
  return removed ? { removed: true } : { error: "Ese archivo ya no está." };
}

export async function submitReportAction(_prev: SubmitState, formData: FormData): Promise<SubmitState> {
  const { ip } = await requestMeta();
  if (!reportSubmitLimiter.allows(ip)) return { error: TOO_MANY };
  const parsed = parseForm(submitSchema, formData);
  if (!parsed.ok) return { error: parsed.error };
  const found = await draftFromClaim(parsed.data.claim, publicTokenLimiter);
  if (!found.ok) return { error: found.error };
  reportSubmitLimiter.record(ip);

  const d = parsed.data;
  const result = await reports.submit({
    reportId: found.report.id,
    category: d.category,
    subtype: d.subtype ?? null,
    description: d.description,
    lat: d.lat ?? null,
    lng: d.lng ?? null,
    streetId: d.streetId ?? null,
    streetName: d.streetName ?? null,
    addressDetail: d.addressDetail ?? null,
    scplTicket: d.scplTicket ?? null,
    consent: d.consent === "on",
  });
  if (!result.ok) return { error: result.error };

  // Todo lo que sigue es best-effort y DESPUÉS de la escritura: el reporte ya
  // entró y la pantalla lo dice. Un SMTP caído no puede convertirlo en error.
  try {
    await reportNotifier.sendReceived(result.id);
  } catch (e) {
    console.error("[reportes] falló el acuse", result.id, "code:", codeOf(e));
  }
  try {
    const recipients = parseRecipients(await configReader.getString(CONFIG_KEYS.digestRecipients));
    if (recipients.length > 0) await reportNotifier.sendBoardAlert(result.id, recipients);
  } catch (e) {
    console.error("[reportes] falló la alerta a la Comisión", result.id, "code:", codeOf(e));
  }
  // Ids, códigos y flags. Ni la calle, ni la descripción, ni la identidad.
  await audit({
    action: "report_submitted", entity: "report", entityId: result.id,
    detail: { kind: found.report.kind, category: d.category, subtype: d.subtype ?? null, member: found.report.memberId !== null, anonymous: found.report.anonymous },
    ip,
  });
  return { done: { number: result.id } };
}
```

- [ ] **Step 5: Correr y verificar que pasa**

Run: `npm test -- --run tests/reports-public-actions.test.ts` → PASS (13 tests).

- [ ] **Step 6: Commit**

```bash
git add src/app/(public)/reportes/wizard-shared.ts src/app/(public)/reportes/actions.ts tests/reports-public-actions.test.ts
git commit -m "feat(reports): public wizard server actions driven by the draft claim

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Landing `/reportes` con la silueta del barrio

**Files:**
- Create: `src/app/(public)/reportes/page.tsx`
- Create: `src/app/(public)/reportes/barrio-silhouette.tsx`

**Interfaces:**
- Consumes: `reports.yearStats()`, `boundaryToSvgPath`, `currentYearAR`.
- Produces: `BarrioSilhouette({ className?, title? })` (server-safe, sin `"use client"`).

- [ ] **Step 1: La silueta**

```tsx
// src/app/(public)/reportes/barrio-silhouette.tsx
// La pieza firma de Reportes (spec §6.1): el contorno real del barrio, sacado
// del KML del catastro, como SVG inline. Decorativo por defecto (`aria-hidden`);
// con `title` se vuelve una imagen nombrada.
import { boundaryToSvgPath } from "@/lib/reports/boundary";
import { cn } from "@/lib/utils";

const W = 240;
const H = 150;

export function BarrioSilhouette({ className, title }: { className?: string; title?: string }) {
  const d = boundaryToSvgPath(W, H, 6);
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={cn("h-auto w-full", className)}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <path d={d} fill="currentColor" fillOpacity="0.08" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}
```

- [ ] **Step 2: La landing**

```tsx
// src/app/(public)/reportes/page.tsx
import type { Metadata } from "next";
import Link from "next/link";
import { Lightbulb, MessageSquareWarning } from "lucide-react";
import { currentYearAR } from "@/lib/dates";
import { reports } from "@/lib/reports/service";
import { SITE, siteBaseUrl } from "@/lib/site";
import { cn } from "@/lib/utils";
import { BarrioSilhouette } from "./barrio-silhouette";

export const metadata: Metadata = {
  title: "Reportes — Vecinal Ciudadela",
  description: `Reclamos e iniciativas de los vecinos del barrio Ciudadela: la ${SITE.name} los recibe y los canaliza ante el municipio, la SCPL u otro organismo.`,
  alternates: { canonical: new URL("/reportes", siteBaseUrl()).toString() },
};

// Una hora, como /asociate: los contadores cambian de a uno y nadie necesita
// verlos al segundo; una consulta por hora es barata.
export const revalidate = 3600;

const DOOR =
  "group flex flex-col gap-3 rounded-2xl bg-card p-5 ring-1 ring-foreground/10 outline-hidden transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring";

export default async function ReportesPage() {
  const year = currentYearAR();
  const stats = await reports.yearStats();

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10">
      <div className="grid items-center gap-8 md:grid-cols-[1fr_260px]">
        <div>
          <p className="font-mono text-xs font-semibold tracking-[0.14em] text-primary uppercase">
            Art. 2 inc. g del estatuto
          </p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">Reportes del barrio</h1>
          <p className="mt-3 max-w-prose text-muted-foreground">
            Un bache, una luminaria apagada, una pérdida de agua, o una idea para el barrio. La
            {" "}{SITE.shortName} recibe lo que planteás, lo revisa la Comisión Directiva y, si
            corresponde, lo presenta ante el municipio, la SCPL u otro organismo.
          </p>
          {/* Transparencia (spec §2): sólo números del año, nunca una lista. */}
          <dl className="mt-6 flex flex-wrap gap-x-8 gap-y-2">
            <div>
              <dt className="text-xs text-muted-foreground">Recibidos en {year}</dt>
              <dd className="font-mono text-2xl font-bold tabular-nums text-primary">{stats.received}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Presentados ante organismos</dt>
              <dd className="font-mono text-2xl font-bold tabular-nums text-primary">{stats.filed}</dd>
            </div>
          </dl>
        </div>
        <BarrioSilhouette className="text-primary" title="Silueta del barrio Ciudadela" />
      </div>

      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        <Link href="/reportes/nuevo?tipo=reclamo" className={cn(DOOR)}>
          <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <MessageSquareWarning aria-hidden className="size-5" />
          </span>
          <span className="text-lg font-semibold">Hacer un reclamo</span>
          <span className="text-sm text-muted-foreground">
            Un problema en la vía pública: agua, cloacas, luz, residuos, calles, árboles o transporte.
          </span>
          <span aria-hidden className="text-sm font-medium text-primary group-hover:underline">Empezar →</span>
        </Link>
        <Link href="/reportes/nuevo?tipo=iniciativa" className={cn(DOOR)}>
          <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Lightbulb aria-hidden className="size-5" />
          </span>
          <span className="text-lg font-semibold">Proponer una iniciativa</span>
          <span className="text-sm text-muted-foreground">
            Una propuesta social, cultural, deportiva, de obras o de seguridad para el barrio.
          </span>
          <span aria-hidden className="text-sm font-medium text-primary group-hover:underline">Empezar →</span>
        </Link>
      </div>

      <p className="mt-8 max-w-prose text-sm text-muted-foreground">
        Te pedimos tus datos y una foto de tu DNI para que el reporte sea de una persona real del
        barrio. Podés elegir que tu nombre no figure ante el organismo. Este reporte no reemplaza
        el reclamo que podés hacer directamente ante el municipio o la SCPL.
      </p>
    </main>
  );
}
```

- [ ] **Step 3: Verificar**

Run: `npm test -- --run tests/public-nav.test.ts` → ahora PASS entero. `npx tsc --noEmit` limpio. Con `npm run dev`, abrir `http://localhost:3000/reportes` en el navegador: silueta celeste, dos contadores en 0, dos puertas.

- [ ] **Step 4: Commit**

```bash
git add src/app/(public)/reportes/page.tsx src/app/(public)/reportes/barrio-silhouette.tsx
git commit -m "feat(reports): public landing with barrio silhouette, yearly counters and the two doors

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Piezas del wizard — íconos, mosaico de categorías y ranura de archivo

**Files:**
- Create: `src/app/(public)/reportes/report-icons.tsx`
- Create: `src/app/(public)/reportes/category-grid.tsx`
- Create: `src/app/(public)/reportes/file-slot.tsx`

**Interfaces:**
- Produces:
  - `REPORT_ICONS: Record<ReportIconName, LucideIcon>`, `ReportIcon({ name, className })`
  - `CategoryGrid({ kind, value, onChange })` — radiogroup accesible sobre `CLAIM_CATEGORIES` o `INITIATIVE_CATEGORIES`
  - `FileSlot({ claim, kind, title, hint, existing, onUploaded, onRemoved, onBusy, optional? })` — un `useActionState` propio para subir y otro para quitar; vista previa con `URL.createObjectURL`.

- [ ] **Step 1: `report-icons.tsx`**

```tsx
"use client";
// Mapa nombre → componente lucide (regla del repo: el string viaja por `lib/`,
// el componente vive en el cliente).
import {
  BusFront, Droplets, HardHat, Lightbulb, MessageSquareWarning, Palette, Shield, TrafficCone,
  Trash2, TreeDeciduous, Trophy, Users, Waves, Zap, type LucideIcon,
} from "lucide-react";
import type { ReportIconName } from "@/lib/reports/catalog";

export const REPORT_ICONS: Record<ReportIconName, LucideIcon> = {
  droplets: Droplets, waves: Waves, zap: Zap, "trash-2": Trash2, "traffic-cone": TrafficCone,
  "tree-deciduous": TreeDeciduous, "bus-front": BusFront, "message-square-warning": MessageSquareWarning,
  users: Users, palette: Palette, trophy: Trophy, "hard-hat": HardHat, shield: Shield, lightbulb: Lightbulb,
};

export function ReportIcon({ name, className }: { name: ReportIconName; className?: string }) {
  const Icon = REPORT_ICONS[name];
  return <Icon aria-hidden className={className} />;
}
```

- [ ] **Step 2: `category-grid.tsx`**

```tsx
"use client";
// El mosaico de categorías (spec §6.1): radios nativos dentro de mosaicos, dos
// columnas en el celular y cuatro en escritorio. El foco lo lleva el radio y la
// tarjeta lo muestra con `has-[:focus-visible]` (mismo gesto que ChoiceCard).
import { CLAIM_CATEGORIES, INITIATIVE_CATEGORIES, type ReportKindSlug } from "@/lib/reports/catalog";
import { cn } from "@/lib/utils";
import { ReportIcon } from "./report-icons";

export function CategoryGrid({
  kind, value, onChange,
}: {
  kind: ReportKindSlug;
  value: string;
  onChange: (slug: string) => void;
}) {
  const options = kind === "claim" ? CLAIM_CATEGORIES : INITIATIVE_CATEGORIES;
  return (
    <fieldset>
      <legend className="text-sm font-medium">
        {kind === "claim" ? "¿De qué se trata?" : "¿Qué tipo de iniciativa es?"}
      </legend>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {options.map((c) => {
          const checked = value === c.slug;
          return (
            <label
              key={c.slug}
              className={cn(
                "flex min-h-24 cursor-pointer flex-col items-start justify-between gap-2 rounded-xl border-2 p-3 transition-colors",
                "has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50",
                checked ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50",
              )}
            >
              <input
                type="radio"
                name="category"
                value={c.slug}
                checked={checked}
                onChange={() => onChange(c.slug)}
                className="sr-only"
              />
              <span
                aria-hidden
                className={cn(
                  "flex size-9 items-center justify-center rounded-lg",
                  checked ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary",
                )}
              >
                <ReportIcon name={c.icon} className="size-5" />
              </span>
              <span className="text-sm font-semibold leading-tight">{c.label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
```

- [ ] **Step 3: `file-slot.tsx`**

```tsx
"use client";
// Una ranura de archivo del wizard de Reportes. REGLA (pagada cara en ASOCIATE,
// ver `step-documents.tsx`): cada ranura tiene su PROPIO `useActionState` de
// subida y otro de quitado, y ninguna sabe de las otras. Lo único que sube al
// paso es `onUploaded`/`onRemoved` (para la lista) y `onBusy` (para apagar
// "Continuar" mientras un archivo viaja).
//
// La vista previa es un `URL.createObjectURL` del archivo elegido (la CSP ya
// admite `blob:`), y se revoca al desmontar o al cambiar.
import { CheckIcon, X } from "lucide-react";
import { useActionState, useEffect, useId, useState } from "react";
import { FormMessage } from "@/components/admin/form-message";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { removeReportFileAction, uploadReportFileAction } from "./actions";
import { CONTROL_HEIGHT, FOCUS_RING, type FileKindSlug, type RemoveState, type UploadState, type UploadedFile } from "./wizard-shared";

// Sólo imágenes: el store re-codifica con sharp y pdf-lib no embebe PDF.
const ACCEPT = "image/jpeg,image/png,image/webp";

export function FileSlot({
  claim, kind, title, hint, existing, optional, onUploaded, onRemoved, onBusy,
}: {
  claim: string;
  kind: FileKindSlug;
  title: string;
  hint: string;
  /** El archivo ya subido en esta ranura, si lo hay. */
  existing: UploadedFile | null;
  optional?: boolean;
  onUploaded: (file: UploadedFile) => void;
  onRemoved: (fileId: number) => void;
  onBusy: (delta: 1 | -1) => void;
}) {
  const inputId = useId();
  const [hasFile, setHasFile] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const [uploadState, uploadAction, uploading] = useActionState<UploadState, FormData>(
    async (_prev, fd) => {
      onBusy(1);
      try {
        const r = await uploadReportFileAction({}, fd);
        if (r.uploaded) onUploaded(r.uploaded);
        return r;
      } finally {
        onBusy(-1);
      }
    },
    {},
  );
  const [removeState, removeAction, removing] = useActionState<RemoveState, FormData>(
    async (_prev, fd) => {
      const r = await removeReportFileAction({}, fd);
      if (r.removed && existing) onRemoved(existing.id);
      return r;
    },
    {},
  );

  // Ajuste en el render (no en efecto): React 19 vacía el <form> después de la
  // action, así que el archivo elegido ya no está, salga bien o mal.
  const [seen, setSeen] = useState(uploadState);
  if (uploadState !== seen) {
    setSeen(uploadState);
    setHasFile(false);
    if (uploadState.uploaded && preview) {
      URL.revokeObjectURL(preview);
      setPreview(null);
    }
  }

  const done = existing !== null;
  const error = uploadState.error ?? removeState.error;

  return (
    <li className={cn("rounded-xl border-2 p-4 transition-colors", done ? "border-success/40 bg-success/5" : "border-border")}>
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={cn(
            "mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border-2",
            done ? "border-success bg-success text-background" : "border-muted-foreground/40",
          )}
        >
          {done && <CheckIcon className="size-4" strokeWidth={3} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-base font-semibold">{title}</span>
          {!done && <span className="mt-1 block text-sm text-muted-foreground">{hint}</span>}
        </span>
        <span className={cn("shrink-0 text-xs font-semibold tracking-[0.08em] uppercase", done ? "text-success" : "text-muted-foreground")}>
          {done ? "Listo" : optional ? "Opcional" : "Falta"}
        </span>
      </div>

      {done ? (
        <form action={removeAction} className="mt-3 flex items-center gap-3">
          <input type="hidden" name="claim" value={claim} />
          <input type="hidden" name="fileId" value={existing.id} />
          <Button type="submit" variant="outline" disabled={removing} className={cn(CONTROL_HEIGHT, "sm:w-auto sm:px-5")}>
            <X aria-hidden className="size-4" />
            {removing ? "Quitando…" : kind === "photo" ? "Quitar" : "Cambiar"}
            <span className="sr-only"> {title.toLowerCase()}</span>
          </Button>
        </form>
      ) : (
        <form action={uploadAction} className="mt-4 space-y-3">
          <input type="hidden" name="claim" value={claim} />
          <input type="hidden" name="kind" value={kind} />
          <Label htmlFor={inputId} className="text-sm">Elegí la foto</Label>
          {/* Sin `capture`: en iOS fuerza la cámara y esconde la galería. */}
          <input
            id={inputId}
            name="file"
            type="file"
            accept={ACCEPT}
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setHasFile(f !== null);
              if (preview) URL.revokeObjectURL(preview);
              setPreview(f ? URL.createObjectURL(f) : null);
            }}
            className={cn(
              "block w-full rounded-md border border-input p-2 text-base",
              "file:mr-3 file:rounded-md file:border file:border-input file:bg-muted file:px-3 file:py-1.5 file:text-sm",
              FOCUS_RING,
            )}
          />
          {preview && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="" className="max-h-40 rounded-lg object-cover" />
          )}
          {/* Sin `onClick`: el clic NO toca estado. */}
          <Button type="submit" disabled={!hasFile || uploading} className={cn(CONTROL_HEIGHT, "font-semibold sm:w-auto sm:px-6")}>
            {uploading ? "Subiendo…" : "Subir"}
          </Button>
        </form>
      )}
      {error && <FormMessage kind="error" className="mt-2">{error}</FormMessage>}
    </li>
  );
}
```

- [ ] **Step 4: Verificar tipos y commitear**

Run: `npx tsc --noEmit` → limpio. `npm run lint` → limpio.

```bash
git add src/app/(public)/reportes/report-icons.tsx src/app/(public)/reportes/category-grid.tsx src/app/(public)/reportes/file-slot.tsx
git commit -m "feat(reports): wizard pieces — icon map, category grid and file slot with preview

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Picker de ubicación (Leaflet con el límite del barrio y geolocalización)

**Files:**
- Create: `src/app/(public)/reportes/location-picker.tsx`
- Create: `src/app/(public)/reportes/location-picker-loader.tsx`

**Interfaces:**
- Produces: `LocationPicker({ value: { lat, lng } | null, onChange(value | null) })` (default export del módulo con Leaflet), y `LocationPickerLoader` (mismas props) como default export del loader.

- [ ] **Step 1: El picker**

```tsx
"use client";
// Picker de ubicación del wizard de Reportes (spec §6.1). Leaflet pelado, como
// /ubicacion, con tres diferencias deliberadas: `dragging` ENCENDIDO también en
// touch (acá el usuario tiene que mover el mapa con un dedo; el scroll-trap se
// evita con la altura acotada del contenedor y `scrollWheelZoom: false`), un
// marcador que se coloca tocando y se arrastra, y el contorno del barrio.
//
// El dato viaja hacia arriba como `{lat, lng}`; la calle en texto es la
// alternativa accesible al mapa y vive en el paso, no acá. `geolocation` está
// apagada globalmente por Permissions-Policy y reabierta para esta ruta en
// next.config.ts (Parte 2, Task 2): sin eso el botón falla en silencio.
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { LocateFixed } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PIN_ANCHOR, PIN_SIZE, PIN_SVG } from "@/components/map/brand-pin";
import { BARRIO_BOUNDARY, BARRIO_BOUNDS } from "@/lib/reports/boundary";
import {
  IGN_ATTRIBUTION, IGN_TILE_OPTIONS, IGN_TILE_URL, OSM_ATTRIBUTION, OSM_TILE_URL, TILE_ERROR_THRESHOLD,
} from "../ubicacion/map-config";

export type LatLng = { lat: number; lng: number };

export default function LocationPicker({ value, onChange }: { value: LatLng | null; onChange: (v: LatLng | null) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const bounds = L.latLngBounds([BARRIO_BOUNDS.south, BARRIO_BOUNDS.west], [BARRIO_BOUNDS.north, BARRIO_BOUNDS.east]);
    const map = L.map(containerRef.current, { scrollWheelZoom: false, dragging: true, touchZoom: true, zoomControl: false });
    map.fitBounds(bounds, { padding: [12, 12] });
    mapRef.current = map;
    L.control.zoom({ position: "topright", zoomInTitle: "Acercar", zoomOutTitle: "Alejar" }).addTo(map);

    const ignLayer = L.tileLayer(IGN_TILE_URL, { ...IGN_TILE_OPTIONS, attribution: IGN_ATTRIBUTION }).addTo(map);
    let tileErrors = 0;
    let fellBack = false;
    ignLayer.on("tileerror", () => {
      tileErrors += 1;
      if (fellBack || tileErrors < TILE_ERROR_THRESHOLD) return;
      fellBack = true;
      map.removeLayer(ignLayer);
      L.tileLayer(OSM_TILE_URL, { maxZoom: 19, attribution: OSM_ATTRIBUTION }).addTo(map);
    });
    ignLayer.on("load", () => { tileErrors = 0; });

    L.polygon(BARRIO_BOUNDARY.map(([lat, lng]) => [lat, lng] as [number, number]), {
      color: "#0079BC", weight: 2, fillOpacity: 0.04, interactive: false,
    }).addTo(map);

    const icon = L.divIcon({ html: PIN_SVG, className: "", iconSize: PIN_SIZE, iconAnchor: PIN_ANCHOR });
    function place(latlng: L.LatLng) {
      if (!markerRef.current) {
        markerRef.current = L.marker(latlng, { icon, draggable: true, keyboard: true, title: "Punto del reporte" }).addTo(map);
        markerRef.current.on("dragend", () => {
          const p = markerRef.current!.getLatLng();
          onChangeRef.current({ lat: p.lat, lng: p.lng });
        });
      } else {
        markerRef.current.setLatLng(latlng);
      }
      onChangeRef.current({ lat: latlng.lat, lng: latlng.lng });
    }
    map.on("click", (e: L.LeafletMouseEvent) => place(e.latlng));
    if (value) place(L.latLng(value.lat, value.lng));

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // Sólo al montar: el valor inicial se coloca una vez; después manda el marcador.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function locate() {
    if (!navigator.geolocation) {
      setGeoError("Tu navegador no permite usar la ubicación. Tocá el mapa para marcar el punto.");
      return;
    }
    setLocating(true);
    setGeoError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const latlng = L.latLng(pos.coords.latitude, pos.coords.longitude);
        mapRef.current?.setView(latlng, 17);
        // Reusa el mismo camino que el clic: crea o mueve el marcador.
        mapRef.current?.fire("click", { latlng });
      },
      () => {
        setLocating(false);
        setGeoError("No pudimos leer tu ubicación. Tocá el mapa para marcar el punto.");
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  return (
    <div className="space-y-2">
      <div className="relative h-[22rem] overflow-hidden rounded-2xl ring-1 ring-foreground/10">
        <div
          ref={containerRef}
          className="h-full w-full"
          role="group"
          aria-label="Mapa del barrio Ciudadela para marcar dónde está el problema. Tocá el mapa para colocar el punto y arrastralo para ajustarlo."
        />
        <button
          type="button"
          onClick={locate}
          disabled={locating}
          className="absolute bottom-3 left-3 z-[1000] inline-flex min-h-11 items-center gap-2 rounded-md bg-card px-3 text-sm font-medium text-foreground shadow-md ring-1 ring-foreground/10 outline-hidden transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        >
          <LocateFixed aria-hidden className="size-4 shrink-0 text-primary" />
          {locating ? "Buscando…" : "Usar mi ubicación"}
        </button>
      </div>
      {geoError && <p className="text-xs text-warning">{geoError}</p>}
    </div>
  );
}
```

- [ ] **Step 2: El loader**

```tsx
"use client";
// `dynamic(..., { ssr: false })` está prohibido en un Server Component: este
// wrapper existe sólo para eso (mismo motivo que `sede-map-loader.tsx`).
import dynamic from "next/dynamic";

const LocationPickerLoader = dynamic(() => import("./location-picker"), {
  ssr: false,
  loading: () => <div aria-hidden className="h-[22rem] w-full animate-pulse rounded-2xl bg-muted motion-reduce:animate-none" />,
});

export default LocationPickerLoader;
```

- [ ] **Step 3: Verificar tipos y commitear**

Run: `npx tsc --noEmit` → limpio.

```bash
git add src/app/(public)/reportes/location-picker.tsx src/app/(public)/reportes/location-picker-loader.tsx
git commit -m "feat(reports): Leaflet location picker with barrio outline, draggable pin and geolocation

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Los tres pasos, la confirmación y el marco del wizard

**Files:**
- Create: `src/app/(public)/reportes/step-start.tsx`, `step-identity.tsx`, `step-report.tsx`, `report-done.tsx`, `report-wizard.tsx`

**Interfaces:**
- Produces: `ReportWizard({ mode, streets, consentText, siteKey, initialKind?, initial?: { claim: string; snapshot: ReportSnapshot }, startAction })` — `startAction` es la action del paso 1 (`startReportAction` en público, `startMemberReportAction` en socio, ver Task 9), para que el marco sea el mismo.

- [ ] **Step 1: `step-start.tsx`**

```tsx
"use client";
import { useRef } from "react";
import { Lightbulb, MessageSquareWarning, ShieldCheck, UserRound } from "lucide-react";
import { FormMessage } from "@/components/admin/form-message";
import { useFormResetSync } from "@/components/admin/use-form-reset-sync";
import { TurnstileWidget } from "@/components/public/turnstile-widget";
import { NavButtons, ChoiceCard } from "../asociate/wizard-ui";
import type { ReportDraft, ReportMode, StartState } from "./wizard-shared";

export function StepStart({
  mode, draft, patch, siteKey, actionState, formAction, pending, error,
}: {
  mode: ReportMode;
  draft: ReportDraft;
  patch: (values: Partial<ReportDraft>) => void;
  siteKey: string;
  actionState: StartState;
  formAction: (formData: FormData) => void;
  pending: boolean;
  error?: string;
}) {
  // Radios que postean: sin esto, tras un rechazo React 19 los deja en lo que
  // dice el DOM y no en el borrador.
  const formRef = useRef<HTMLFormElement>(null);
  useFormResetSync(formRef, { kind: draft.kind === "claim" ? "reclamo" : draft.kind === "initiative" ? "iniciativa" : "", anonymous: draft.anonymous });

  return (
    <form ref={formRef} action={formAction} className="space-y-6">
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">¿Qué querés reportar?</legend>
        <ChoiceCard
          name="kind" value="reclamo" checked={draft.kind === "claim"} onSelect={() => patch({ kind: "claim" })}
          title="Un reclamo" icon={<MessageSquareWarning className="size-4" />}
        >
          Un problema en la vía pública: agua, cloacas, luz, residuos, calles, árboles, transporte.
        </ChoiceCard>
        <ChoiceCard
          name="kind" value="iniciativa" checked={draft.kind === "initiative"} onSelect={() => patch({ kind: "initiative" })}
          title="Una iniciativa" icon={<Lightbulb className="size-4" />}
        >
          Una propuesta para el barrio, que la Comisión Directiva evalúa (Art. 6 del estatuto).
        </ChoiceCard>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">¿Cómo querés figurar en la presentación?</legend>
        <ChoiceCard
          name="anonymous" value="no" checked={draft.anonymous === "no"} onSelect={() => patch({ anonymous: "no" })}
          title="Con mi nombre" icon={<UserRound className="size-4" />}
        >
          Tu nombre acompaña el reporte cuando la asociación lo presenta.
        </ChoiceCard>
        <ChoiceCard
          name="anonymous" value="si" checked={draft.anonymous === "si"} onSelect={() => patch({ anonymous: "si" })}
          title="De forma reservada" icon={<ShieldCheck className="size-4" />}
        >
          La Asociación siempre sabe quién reporta; lo reservado es la presentación ante el municipio,
          la SCPL u otro organismo.
        </ChoiceCard>
      </fieldset>

      {mode === "public" && <TurnstileWidget siteKey={siteKey} resetKey={actionState} />}
      {error && <FormMessage kind="error" box>{error}</FormMessage>}
      <NavButtons submit nextLabel="Continuar" pending={pending} pendingLabel="Un momento…" nextDisabled={draft.kind === "" || draft.anonymous === ""} />
    </form>
  );
}
```

- [ ] **Step 2: `step-identity.tsx`**

```tsx
"use client";
// Paso 2 (sólo vecinos): datos de identidad + las dos caras del DNI. El
// formulario de datos y las dos ranuras son TRES forms distintos, cada uno con
// su action: mezclarlos es el bug de las 11/12 subidas.
import { useState } from "react";
import { FormMessage } from "@/components/admin/form-message";
import { Input } from "@/components/ui/input";
import { Field, NavButtons } from "../asociate/wizard-ui";
import { FileSlot } from "./file-slot";
import { CONTROL_HEIGHT, type ReportDraft, type ReporterState, type UploadedFile } from "./wizard-shared";

export function StepIdentity({
  claim, draft, patch, files, onUploaded, onRemoved, actionState, formAction, pending, error, onBack,
}: {
  claim: string;
  draft: ReportDraft;
  patch: (values: Partial<ReportDraft>) => void;
  files: UploadedFile[];
  onUploaded: (f: UploadedFile) => void;
  onRemoved: (fileId: number) => void;
  actionState: ReporterState;
  formAction: (formData: FormData) => void;
  pending: boolean;
  error?: string;
  onBack: () => void;
}) {
  const [inFlight, setInFlight] = useState(0);
  const front = files.find((f) => f.kind === "dni_front") ?? null;
  const back = files.find((f) => f.kind === "dni_back") ?? null;
  const dniReady = front !== null && back !== null;

  return (
    <div className="space-y-6">
      <form id="reporter-form" action={formAction} className="space-y-5">
        <input type="hidden" name="claim" value={claim} />
        <Field id="name" label="Nombre y apellido">
          <Input id="name" name="name" className={CONTROL_HEIGHT} autoComplete="name" maxLength={160} required value={draft.name} onChange={(e) => patch({ name: e.target.value })} />
        </Field>
        <Field id="dni" label="DNI" hint="Solo números, sin puntos.">
          <Input id="dni" name="dni" className={CONTROL_HEIGHT} inputMode="numeric" autoComplete="off" maxLength={9} required aria-describedby="dni-hint" value={draft.dni} onChange={(e) => patch({ dni: e.target.value.replace(/\D/g, "") })} />
        </Field>
        <Field id="phone" label="Teléfono">
          <Input id="phone" name="phone" type="tel" className={CONTROL_HEIGHT} inputMode="tel" autoComplete="tel" maxLength={40} required value={draft.phone} onChange={(e) => patch({ phone: e.target.value })} />
        </Field>
        <Field id="email" label="Email" hint="Acá te mandamos el acuse y el aviso cuando lo presentemos.">
          <Input id="email" name="email" type="email" className={CONTROL_HEIGHT} inputMode="email" autoComplete="email" maxLength={191} required aria-describedby="email-hint" value={draft.email} onChange={(e) => patch({ email: e.target.value })} />
        </Field>
      </form>

      <div>
        <p className="text-sm font-medium">Tu DNI</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Las dos caras, con el documento apoyado y bien iluminado. Es para que el reporte sea de una
          persona real del barrio; no viaja al organismo.
        </p>
        <ul className="mt-3 space-y-3">
          <FileSlot claim={claim} kind="dni_front" title="Frente del DNI" hint="La cara con tu foto y tu número." existing={front} onUploaded={onUploaded} onRemoved={onRemoved} onBusy={(d) => setInFlight((n) => n + d)} />
          <FileSlot claim={claim} kind="dni_back" title="Dorso del DNI" hint="La cara de atrás, con el domicilio." existing={back} onUploaded={onUploaded} onRemoved={onRemoved} onBusy={(d) => setInFlight((n) => n + d)} />
        </ul>
      </div>

      {error && <FormMessage kind="error" box>{error}</FormMessage>}
      {!dniReady && <FormMessage kind="neutral">Para continuar hacen falta las dos caras del DNI.</FormMessage>}
      {/* El botón envía el form de DATOS (por `form=`), no las ranuras. */}
      <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <button type="button" onClick={onBack} className="inline-flex min-h-11 items-center px-2 text-sm text-primary underline underline-offset-2">Volver</button>
        <button
          type="submit"
          form="reporter-form"
          disabled={!dniReady || inFlight > 0 || pending}
          className="inline-flex h-12 items-center justify-center rounded-lg bg-primary px-8 text-base font-semibold text-primary-foreground outline-hidden transition-colors hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
        >
          {pending ? "Guardando…" : "Guardar y continuar"}
        </button>
      </div>
    </div>
  );
}
```

> `NavButtons` no admite `form=` en el botón; por eso este paso arma su botonera con las mismas clases. Ver `actionState` en `reporterState.saved` para avanzar (lo decide el marco).

- [ ] **Step 3: `step-report.tsx`**

```tsx
"use client";
// Paso 3: el reporte. Mosaico de categorías, tipos (con el aviso SCPL), la
// descripción, el mapa + calle, las dos fotos, el consentimiento y el envío.
import { MessageCircle, TriangleAlert } from "lucide-react";
import { useRef, useState } from "react";
import { FormMessage } from "@/components/admin/form-message";
import { useFormResetSync } from "@/components/admin/use-form-reset-sync";
import { Callout } from "@/components/public/callout";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { findClaimCategory, isScplSubtype, SCPL_WHATSAPP } from "@/lib/reports/catalog";
import { isInsideBoundary } from "@/lib/reports/boundary";
import { isLocationRequired, MAX_DESCRIPTION } from "@/lib/reports/rules";
import { cn } from "@/lib/utils";
import { StreetPicker } from "../asociate/street-picker";
import { streetLabel } from "../asociate/wizard-shared";
import { ChoiceCard, Field, LegalDetails, NavButtons } from "../asociate/wizard-ui";
import { CategoryGrid } from "./category-grid";
import { FileSlot } from "./file-slot";
import LocationPicker from "./location-picker-loader";
import { CONTROL_HEIGHT, type ReportDraft, type StreetOption, type SubmitState, type UploadedFile } from "./wizard-shared";

export function StepReport({
  claim, kind, draft, patch, streets, consentText, files, onUploaded, onRemoved, actionState, formAction, pending, error, onBack,
}: {
  claim: string;
  kind: "claim" | "initiative";
  draft: ReportDraft;
  patch: (values: Partial<ReportDraft>) => void;
  streets: StreetOption[];
  consentText: string | null;
  files: UploadedFile[];
  onUploaded: (f: UploadedFile) => void;
  onRemoved: (fileId: number) => void;
  actionState: SubmitState;
  formAction: (formData: FormData) => void;
  pending: boolean;
  error?: string;
  onBack?: () => void;
}) {
  const [inFlight, setInFlight] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  useFormResetSync(formRef, { category: draft.category, subtype: draft.subtype, consent: draft.consent ? "on" : "" });

  const category = kind === "claim" ? findClaimCategory(draft.category) : null;
  const subtypes = category?.subtypes ?? [];
  const scpl = isScplSubtype(draft.category, draft.subtype);
  const locationRequired = isLocationRequired({ kind, category: draft.category || null });
  const hasPoint = draft.lat !== null && draft.lng !== null;
  const outside = hasPoint && !isInsideBoundary(draft.lat as number, draft.lng as number);
  const photos = files.filter((f) => f.kind === "photo");
  const canSend =
    draft.category !== "" &&
    (subtypes.length === 0 || draft.subtype !== "") &&
    draft.description.trim() !== "" &&
    (!locationRequired || hasPoint) &&
    draft.consent &&
    inFlight === 0;

  return (
    <form ref={formRef} action={formAction} className="space-y-8">
      <input type="hidden" name="claim" value={claim} />
      {draft.lat !== null && <input type="hidden" name="lat" value={draft.lat} />}
      {draft.lng !== null && <input type="hidden" name="lng" value={draft.lng} />}
      {draft.streetId !== null && <input type="hidden" name="streetId" value={draft.streetId} />}
      {draft.streetName !== "" && <input type="hidden" name="streetName" value={draft.streetName} />}

      <CategoryGrid kind={kind} value={draft.category} onChange={(slug) => patch({ category: slug, subtype: "" })} />

      {subtypes.length > 0 && (
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">¿Qué problema es?</legend>
          {subtypes.map((s) => (
            <ChoiceCard
              key={s.slug} name="subtype" value={s.slug} checked={draft.subtype === s.slug} onSelect={() => patch({ subtype: s.slug })}
              title={s.label}
              aside={s.scpl ? <span className="rounded-4xl bg-secondary px-2 py-0.5 text-xs font-medium">SCPL</span> : undefined}
            />
          ))}
        </fieldset>
      )}

      {scpl && (
        <div className="space-y-3">
          <Callout tone="info" icon={MessageCircle}>
            Este reclamo también conviene hacerlo directo a la SCPL por WhatsApp al{" "}
            <a href={SCPL_WHATSAPP.href} target="_blank" rel="noopener noreferrer" className="font-semibold underline underline-offset-2">
              {SCPL_WHATSAPP.display}
            </a>
            . Nosotros lo tomamos y lo elevamos, pero pedí tu número de reclamo ahí: es lo que después
            permite seguirlo.
          </Callout>
          <Field id="scplTicket" label="N° de reclamo SCPL (opcional)">
            <Input id="scplTicket" name="scplTicket" className={CONTROL_HEIGHT} maxLength={40} value={draft.scplTicket} onChange={(e) => patch({ scplTicket: e.target.value })} />
          </Field>
        </div>
      )}

      <Field id="description" label={kind === "claim" ? "Contanos qué pasa" : "Contanos tu propuesta"} hint={`${draft.description.length} / ${MAX_DESCRIPTION}`}>
        <Textarea id="description" name="description" rows={5} maxLength={MAX_DESCRIPTION} required aria-describedby="description-hint" className="text-base" value={draft.description} onChange={(e) => patch({ description: e.target.value })} />
      </Field>

      <div className="space-y-4">
        <div>
          <p className="text-sm font-medium">{locationRequired ? "¿Dónde está?" : "¿Dónde? (opcional)"}</p>
          <p className="mt-1 text-sm text-muted-foreground">Tocá el mapa para marcar el punto y arrastralo para ajustarlo. El contorno es el barrio Ciudadela.</p>
        </div>
        <LocationPicker value={hasPoint ? { lat: draft.lat as number, lng: draft.lng as number } : null} onChange={(v) => patch({ lat: v?.lat ?? null, lng: v?.lng ?? null })} />
        {hasPoint && (
          <p aria-hidden className="font-mono text-xs tracking-[0.08em] text-muted-foreground uppercase">
            {(draft.lat as number).toFixed(5)}, {(draft.lng as number).toFixed(5)}
          </p>
        )}
        {outside && (
          <Callout tone="warning" icon={TriangleAlert}>
            El punto queda fuera del barrio Ciudadela. Podés enviarlo igual; la Comisión decide si lo canaliza.
          </Callout>
        )}
        <StreetPicker
          streets={streets} streetId={draft.streetId} streetName={draft.streetName}
          onPick={(s) => patch({ streetId: s?.id ?? null, streetName: s ? streetLabel(s.name) : "" })}
          notFoundHint="Esa calle no está en el catálogo del barrio. Podés dejar el mapa como referencia y describir el lugar abajo."
        />
        <Field id="addressDetail" label="Altura o referencia" hint="Por ejemplo: al 280, frente a la plaza, esquina Alem.">
          <Input id="addressDetail" name="addressDetail" className={CONTROL_HEIGHT} maxLength={160} aria-describedby="addressDetail-hint" value={draft.addressDetail} onChange={(e) => patch({ addressDetail: e.target.value })} />
        </Field>
      </div>

      <div>
        <p className="text-sm font-medium">Fotos (opcional)</p>
        <p className="mt-1 text-sm text-muted-foreground">Hasta dos. Sin metadatos: la ubicación de tu celular no viaja con la foto.</p>
        <ul className="mt-3 space-y-3">
          <FileSlot claim={claim} kind="photo" title="Foto 1" hint="Lo que se ve desde la calle." existing={photos[0] ?? null} optional onUploaded={onUploaded} onRemoved={onRemoved} onBusy={(d) => setInFlight((n) => n + d)} />
          <FileSlot claim={claim} kind="photo" title="Foto 2" hint="Otro ángulo, si ayuda." existing={photos[1] ?? null} optional onUploaded={onUploaded} onRemoved={onRemoved} onBusy={(d) => setInFlight((n) => n + d)} />
        </ul>
      </div>

      <div className="space-y-3 rounded-xl border border-border p-4">
        <LegalDetails title="Consentimiento de datos personales" text={consentText} />
        <label className="flex cursor-pointer items-start gap-3 py-1.5">
          <input type="checkbox" name="consent" required checked={draft.consent} onChange={(e) => patch({ consent: e.target.checked })} className="mt-0.5 size-5 shrink-0 accent-primary" />
          <span className="text-sm">Leí y acepto el consentimiento de datos personales.</span>
        </label>
      </div>

      {error && <FormMessage kind="error" box>{error}</FormMessage>}
      <NavButtons onBack={onBack} submit nextLabel="Enviar reporte" pending={pending} pendingLabel="Enviando…" nextDisabled={!canSend} />
      <p className={cn("text-xs text-muted-foreground")}>Al enviar, la Comisión Directiva recibe el aviso y vos el acuse por email.</p>
    </form>
  );
}
```

> Nota: la segunda ranura de foto muestra `photos[1]`; con una sola foto subida, la ranura "Foto 2" queda vacía y la primera plegada. Quitar la foto 1 deja la 2 como `photos[0]` (se muestra en la primera ranura): es correcto, son dos ranuras de una lista, no dos posiciones fijas.

- [ ] **Step 4: `report-done.tsx`**

```tsx
// Pantalla terminal del wizard (spec §5.1 paso 5): la línea de tiempo del
// trámite con el N°. Server-safe.
import { Landmark, Send } from "lucide-react";
import Link from "next/link";
import { TramiteTimeline } from "../asociate/tramite-timeline";

export function ReportDone({ number, kind, mode, filed }: { number: number; kind: "claim" | "initiative"; mode: "public" | "member"; filed: boolean }) {
  const word = kind === "claim" ? "reporte" : "iniciativa";
  return (
    <div>
      <p className="font-mono text-xs font-semibold tracking-[0.14em] text-primary uppercase">{kind === "claim" ? "Reclamo" : "Iniciativa"}</p>
      <h1 tabIndex={-1} className="mt-1 text-2xl font-bold tracking-tight outline-hidden sm:text-3xl">
        Recibimos tu {word} <span className="font-mono tabular-nums text-primary">N° {number}</span>
      </h1>
      <p className="mt-3 text-muted-foreground">
        La Comisión Directiva lo revisa y, si corresponde, lo presenta ante el organismo. Te avisamos por email cuando eso pase.
      </p>
      <div className="mt-6">
        <TramiteTimeline
          items={[
            { state: "done", title: "Recibido", children: "Ya está en manos de la Comisión Directiva." },
            { state: filed ? "done" : "now", icon: Landmark, title: kind === "claim" ? "La Comisión lo canaliza" : "La Comisión lo evalúa" },
            { state: filed ? "done" : "next", icon: Send, title: kind === "claim" ? "Presentado ante el organismo" : "Tratado por la Comisión" },
          ]}
        />
      </div>
      <p className="mt-8">
        <Link href={mode === "member" ? "/mi/solicitudes/reportes" : "/"} className="inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-2">
          {mode === "member" ? "Ver mis reportes" : "Volver al inicio"}
        </Link>
      </p>
    </div>
  );
}
```

- [ ] **Step 5: `report-wizard.tsx` (el marco)**

```tsx
"use client";
// El marco del wizard de Reportes (spec §5.1-§5.2). Sólo el stepper, el
// borrador del navegador, el foco y el descarte de respuestas: cada paso está
// en su archivo. Copia la frontera de estado de ASOCIATE: el paso 1 CREA el
// borrador en la base y estampa la llave en la URL con `history.replaceState`;
// desde ahí, todo se opera con la llave y ninguna action revalida.
//
// `mode="member"`: sin Turnstile, sin paso 2 (la identidad vino de la ficha) y
// la URL de retome es la de /mi. `startAction` la inyecta la página: la pública
// exige captcha, la del socio exige sesión.
import { FileText, Landmark, MapPinned, Send, UserRound, type LucideIcon } from "lucide-react";
import { useActionState, useEffect, useRef, useState } from "react";
import { ProcessRail } from "../asociate/process-rail";
import { saveReporterAction, submitReportAction } from "./actions";
import { ReportDone } from "./report-done";
import { StepIdentity } from "./step-identity";
import { StepReport } from "./step-report";
import { StepStart } from "./step-start";
import {
  EMPTY_REPORT_DRAFT, type ReportDraft, type ReportMode, type ReportSnapshot, type ReporterState,
  type StartState, type StreetOption, type SubmitState, type UploadedFile,
} from "./wizard-shared";

const PHASES = [
  { icon: Landmark, label: <>La Comisión<br />lo canaliza</>, srText: "lo revisa la Comisión Directiva" },
  { icon: Send, label: <>Presentado<br />al organismo</>, srText: "y lo presenta ante el organismo" },
];

const ICONS: Record<"start" | "identity" | "report", LucideIcon> = { start: FileText, identity: UserRound, report: MapPinned };
const TITLES = { start: "Empezar", identity: "Tus datos", report: "Tu reporte" } as const;
type StepKey = keyof typeof TITLES;

export function ReportWizard({
  mode, streets, consentText, siteKey, initialKind, initial, startAction,
}: {
  mode: ReportMode;
  streets: StreetOption[];
  consentText: string | null;
  siteKey: string;
  initialKind?: "claim" | "initiative";
  initial?: { claim: string; snapshot: ReportSnapshot };
  startAction: (prev: StartState, formData: FormData) => Promise<StartState>;
}) {
  const steps: StepKey[] = mode === "public" ? ["start", "identity", "report"] : ["start", "report"];
  const retomePath = mode === "public" ? "/reportes/nuevo" : "/mi/solicitudes/reportes/nuevo";

  const [draft, setDraft] = useState<ReportDraft>(() => ({
    ...EMPTY_REPORT_DRAFT,
    kind: initial?.snapshot.kind ?? initialKind ?? "",
    anonymous: initial ? (initial.snapshot.anonymous ? "si" : "no") : "",
    name: initial?.snapshot.reporter?.name ?? "",
    dni: initial?.snapshot.reporter?.dni ?? "",
    phone: initial?.snapshot.reporter?.phone ?? "",
    email: initial?.snapshot.reporter?.email ?? "",
  }));
  const [files, setFiles] = useState<UploadedFile[]>(initial?.snapshot.files ?? []);
  const [reporterSaved, setReporterSaved] = useState(initial?.snapshot.reporterComplete ?? false);

  const [startState, startFormAction, starting] = useActionState<StartState, FormData>(startAction, {});
  const [reporterState, reporterAction, savingReporter] = useActionState<ReporterState, FormData>(saveReporterAction, {});
  const [submitState, submitAction, submitting] = useActionState<SubmitState, FormData>(submitReportAction, {});

  const claim = startState.started?.claim ?? initial?.claim ?? "";

  // El paso se DERIVA: sin llave, paso 1; con llave y (vecino sin datos
  // guardados), paso 2; si no, paso 3. `navBack` sólo permite volver del 3 al 2.
  const [seenReporter, setSeenReporter] = useState(reporterState);
  if (reporterState !== seenReporter) {
    setSeenReporter(reporterState);
    if (reporterState.saved) setReporterSaved(true);
  }
  const [backTo, setBackTo] = useState<StepKey | null>(null);
  const step: StepKey =
    claim === "" ? "start" : mode === "public" && (!reporterSaved || backTo === "identity") ? "identity" : "report";
  const stepIndex = steps.indexOf(step) + 1;

  // La llave a la URL apenas existe (ver el comentario largo de asociate-wizard).
  const createdClaim = startState.started?.claim;
  useEffect(() => {
    if (!createdClaim) return;
    window.history.replaceState(null, "", `${retomePath}/${encodeURIComponent(createdClaim)}`);
  }, [createdClaim, retomePath]);

  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusedStep = useRef(step);
  useEffect(() => {
    if (focusedStep.current === step) return;
    focusedStep.current = step;
    headingRef.current?.focus();
  }, [step]);

  function patch(values: Partial<ReportDraft>) { setDraft((d) => ({ ...d, ...values })); }
  function addFile(f: UploadedFile) {
    setFiles((prev) => (f.kind === "photo" ? [...prev, f] : [...prev.filter((p) => p.kind !== f.kind), f]));
  }
  function removeFile(id: number) { setFiles((prev) => prev.filter((p) => p.id !== id)); }

  const kind = draft.kind === "" ? "claim" : draft.kind;
  const doneNumber = submitState.done?.number ?? (initial && initial.snapshot.status !== "draft" ? initial.snapshot.number : null);
  if (doneNumber !== null) {
    return <ReportDone number={doneNumber} kind={kind} mode={mode} filed={initial?.snapshot.status === "filed"} />;
  }

  const StepIcon = ICONS[step];
  return (
    <div>
      <ProcessRail step={stepIndex} total={steps.length} subject="Tu reporte" phases={PHASES} />
      <h1 ref={headingRef} tabIndex={-1} className="mt-5 flex items-center gap-2.5 text-2xl font-bold tracking-tight outline-hidden sm:text-3xl">
        <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <StepIcon className="size-5" />
        </span>
        {TITLES[step]}
      </h1>
      <p role="status" className="sr-only">Paso {stepIndex} de {steps.length}: {TITLES[step]}</p>

      <div className="mt-6">
        {step === "start" && (
          <StepStart mode={mode} draft={draft} patch={patch} siteKey={siteKey} actionState={startState} formAction={startFormAction} pending={starting} error={startState.error} />
        )}
        {step === "identity" && (
          <StepIdentity
            claim={claim} draft={draft} patch={patch} files={files} onUploaded={addFile} onRemoved={removeFile}
            actionState={reporterState} formAction={reporterAction} pending={savingReporter} error={reporterState.error}
            onBack={() => { /* el paso 1 ya creó el borrador: no se vuelve; el enlace lleva al inicio */ window.location.assign("/reportes"); }}
          />
        )}
        {step === "report" && (
          <StepReport
            claim={claim} kind={kind} draft={draft} patch={patch} streets={streets} consentText={consentText}
            files={files} onUploaded={addFile} onRemoved={removeFile}
            actionState={submitState} formAction={submitAction} pending={submitting} error={submitState.error}
            onBack={mode === "public" ? () => setBackTo("identity") : undefined}
          />
        )}
      </div>
    </div>
  );
}
```

> Detalle del "Volver" del paso 3 al 2: `backTo` fuerza `identity`; al guardar de nuevo los datos, `reporterState` cambia y hay que limpiar `backTo`: agregar `setBackTo(null)` dentro del bloque `if (reporterState !== seenReporter)` cuando `reporterState.saved`.

- [ ] **Step 6: Verificar tipos y lint, commitear**

Run: `npx tsc --noEmit && npm run lint` → limpios.

```bash
git add src/app/(public)/reportes/step-start.tsx src/app/(public)/reportes/step-identity.tsx src/app/(public)/reportes/step-report.tsx src/app/(public)/reportes/report-done.tsx src/app/(public)/reportes/report-wizard.tsx
git commit -m "feat(reports): wizard frame and the three steps with claim-driven state

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Páginas del wizard público (`/reportes/nuevo` y `/reportes/nuevo/[claim]`)

**Files:**
- Create: `src/app/(public)/reportes/nuevo/page.tsx`
- Create: `src/app/(public)/reportes/nuevo/[claim]/page.tsx`
- Create: `src/app/(public)/reportes/snapshot.ts` (server, arma el `ReportSnapshot` desde un `ReportWithFiles`)

- [ ] **Step 1: `snapshot.ts`**

```ts
// Cómo se le cuenta al wizard un borrador que ya existe. Sin id, sin ip, sin
// descripción: sólo lo que decide la pantalla (mismo criterio que ASOCIATE).
import type { ReportWithFiles } from "@/lib/reports/service";
import type { ReportSnapshot } from "./wizard-shared";

export function snapshotOf(r: ReportWithFiles): ReportSnapshot {
  const complete = Boolean(r.reporterName && r.reporterDni && r.reporterPhone && r.reporterEmail);
  return {
    status: r.status,
    kind: r.kind,
    anonymous: r.anonymous,
    reporterComplete: complete,
    reporter: complete
      ? { name: r.reporterName ?? "", dni: r.reporterDni ?? "", phone: r.reporterPhone ?? "", email: r.reporterEmail ?? "" }
      : null,
    files: r.files.map((f) => ({ id: f.id, kind: f.kind })),
    number: r.status === "draft" ? null : r.id,
  };
}
```

- [ ] **Step 2: `nuevo/page.tsx`**

```tsx
import type { Metadata } from "next";
import { getLegalTexts } from "@/lib/config";
import { prisma } from "@/lib/prisma";
import { startReportAction } from "../actions";
import { ReportWizard } from "../report-wizard";

export const metadata: Metadata = { title: "Nuevo reporte — Vecinal Ciudadela", robots: { index: false, follow: true } };
export const dynamic = "force-dynamic";

export default async function NuevoReportePage(props: { searchParams: Promise<{ tipo?: string }> }) {
  const sp = await props.searchParams;
  const initialKind = sp.tipo === "iniciativa" ? "initiative" : sp.tipo === "reclamo" ? "claim" : undefined;
  const [legal, streets] = await Promise.all([
    getLegalTexts(),
    prisma.street.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, loadOrder: true } }),
  ]);
  return (
    <main className="mx-auto w-full max-w-xl px-4 py-8 sm:py-12">
      <ReportWizard
        mode="public"
        streets={streets}
        consentText={legal.privacyConsent}
        siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ""}
        initialKind={initialKind}
        startAction={startReportAction}
      />
    </main>
  );
}
```

- [ ] **Step 3: `nuevo/[claim]/page.tsx`**

```tsx
import Link from "next/link";
import { getLegalTexts } from "@/lib/config";
import { prisma } from "@/lib/prisma";
import { reports } from "@/lib/reports/service";
import { startReportAction } from "../../actions";
import { ReportWizard } from "../../report-wizard";
import { snapshotOf } from "../../snapshot";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tu reporte — Vecinal Ciudadela", robots: { index: false, follow: false } };

// GET sin efectos: la llave NO se consume (es la llave del borrador mientras
// viva). El escáner de enlaces de un cliente de correo no rompe nada.
export default async function RetomarReportePage({ params }: { params: Promise<{ claim: string }> }) {
  const { claim } = await params;
  const report = await reports.findByClaim(claim);
  if (!report || report.memberId !== null) {
    return (
      <main className="mx-auto w-full max-w-xl px-4 py-16">
        <h1 className="text-2xl font-bold tracking-tight">No encontramos ese reporte</h1>
        <p className="mt-3 text-muted-foreground">El enlace puede estar incompleto o el borrador ya se borró (los borradores duran dos días).</p>
        <p className="mt-6"><Link href="/reportes" className="text-primary underline underline-offset-2">Empezar un reporte</Link></p>
      </main>
    );
  }
  const [legal, streets] = await Promise.all([
    getLegalTexts(),
    prisma.street.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, loadOrder: true } }),
  ]);
  return (
    <main className="mx-auto w-full max-w-xl px-4 py-8 sm:py-12">
      <ReportWizard
        mode="public"
        streets={streets}
        consentText={legal.privacyConsent}
        siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ""}
        initial={{ claim, snapshot: snapshotOf(report) }}
        startAction={startReportAction}
      />
    </main>
  );
}
```

> `report.memberId !== null` → 404 en la ruta pública: el borrador de un socio se retoma desde `/mi`, no desde acá.

- [ ] **Step 4: Prueba en el navegador (dev)**

`npm run dev`, abrir `/reportes/nuevo?tipo=reclamo`: elegir reserva, Turnstile (claves dummy), Continuar → la URL pasa a `/reportes/nuevo/<llave>`; cargar datos y las dos caras del DNI (dos JPG cualesquiera); Continuar → paso 3; categoría Agua › Pérdida → aparece el Callout SCPL; descripción; mapa: tocar dentro del barrio → coordenadas; calle; una foto; consentimiento; Enviar → pantalla "Recibimos tu reporte N° 1". Recargar la URL con la llave → misma pantalla terminal. Revisar en `uploads/reports/1/` que hay tres JPG y en el log del dev server que salieron el acuse y la alerta (bloqueados por allowlist si aplica).

- [ ] **Step 5: Commit**

```bash
git add src/app/(public)/reportes/nuevo src/app/(public)/reportes/snapshot.ts
git commit -m "feat(reports): public wizard pages and claim resume

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Socio — sub-pestañas en `/mi/solicitudes`, lista de reportes y wizard en modo socio

**Files:**
- Create: `src/lib/mi/solicitudes-tabs.ts`, `src/components/mi/solicitudes-tabs.tsx`
- Create: `src/app/mi/solicitudes/layout.tsx`
- Modify: `src/app/mi/solicitudes/page.tsx` (quitar `<h1>` y subtítulo; el resto intacto)
- Create: `src/app/mi/solicitudes/reportes/page.tsx`, `reportes/actions.ts`, `reportes/nuevo/page.tsx`, `reportes/nuevo/[claim]/page.tsx`
- Create: `src/components/mi/report-card.tsx` (tarjeta de la lista; la reutiliza el admin en la Parte 3 sólo por el vocabulario, no por import)
- Modify: `src/app/mi/page.tsx` (tercera celda de atajos)
- Test: `tests/mi-solicitudes-tabs.test.ts`, `tests/reports-member-actions.test.ts`

**Interfaces:**
- Produces: `MI_SOLICITUDES_TABS`, `isMiSolicitudesTabActive(pathname, href)`, `MiSolicitudesTabs({ tabs })`, `startMemberReportAction` (misma firma que `startReportAction`).

- [ ] **Step 1: Tests que fallan**

```ts
// tests/mi-solicitudes-tabs.test.ts
// Las sub-pestañas de /mi/solicitudes (spec §6.2), con la trampa del prefijo
// hermano: /mi/solicitudes es prefijo de /mi/solicitudes/reportes, así que
// "reportes gana por prefijo; el resto es institucional".
import { describe, expect, it } from "vitest";
import { isMiSolicitudesTabActive, MI_SOLICITUDES_TABS } from "@/lib/mi/solicitudes-tabs";

const INST = "/mi/solicitudes";
const REP = "/mi/solicitudes/reportes";

describe("MI_SOLICITUDES_TABS", () => {
  it("Institucional primero, Reportes después", () => {
    expect(MI_SOLICITUDES_TABS.map((t) => t.href)).toEqual([INST, REP]);
  });
});

describe("isMiSolicitudesTabActive", () => {
  it("institucional en su ruta y NO en reportes", () => {
    expect(isMiSolicitudesTabActive(INST, INST)).toBe(true);
    expect(isMiSolicitudesTabActive(REP, INST)).toBe(false);
    expect(isMiSolicitudesTabActive(`${REP}/nuevo`, INST)).toBe(false);
  });
  it("reportes en su ruta y sus subrutas", () => {
    expect(isMiSolicitudesTabActive(REP, REP)).toBe(true);
    expect(isMiSolicitudesTabActive(`${REP}/nuevo/abc`, REP)).toBe(true);
    expect(isMiSolicitudesTabActive(INST, REP)).toBe(false);
  });
  it("no confunde una ruta ajena", () => {
    expect(isMiSolicitudesTabActive("/mi/cuenta", INST)).toBe(false);
  });
});
```

```ts
// tests/reports-member-actions.test.ts
// El borrador del SOCIO (spec §5.2): requireMember({ allowSuspended: true })
// —el suspendido puede reportar—, el memberId sale del actor, la identidad se
// copia de la ficha, cupo por socio y sin Turnstile.
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  requireMember: vi.fn(), startDraft: vi.fn(), findUnique: vi.fn(),
  check: vi.fn(() => true),
}));
vi.mock("@/lib/auth/require-member", () => ({ requireMember: mocks.requireMember }));
vi.mock("@/lib/reports/service", () => ({ reports: { startDraft: mocks.startDraft } }));
vi.mock("@/lib/prisma", () => ({ prisma: { member: { findUnique: mocks.findUnique } } }));
vi.mock("@/lib/auth/rate-limiter", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth/rate-limiter")>()),
  reportMemberLimiter: { check: mocks.check },
}));
vi.mock("@/lib/turnstile", () => ({ verifyTurnstile: vi.fn(() => { throw new Error("el socio no pasa por Turnstile"); }) }));
vi.mock("next/headers", () => ({ headers: async () => new Map([["x-real-ip", "1.1.1.1"], ["user-agent", "ua"]]) }));
import { startMemberReportAction } from "@/app/mi/solicitudes/reportes/actions";

const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireMember.mockResolvedValue({ ok: true, userId: 9, memberId: 14, fullName: "Ana López", suspension: null });
  mocks.findUnique.mockResolvedValue({ fullName: "Ana López", dni: "30123456", phone: "2974", email: "ana@example.com" });
  mocks.startDraft.mockResolvedValue({ id: 5, claim: "C".repeat(43) });
  mocks.check.mockReturnValue(true);
});

describe("startMemberReportAction", () => {
  it("crea el borrador del socio con la identidad de la ficha", async () => {
    const r = await startMemberReportAction({}, fd({ kind: "iniciativa", anonymous: "no" }));
    expect(r).toEqual({ started: { claim: "C".repeat(43) } });
    expect(mocks.requireMember).toHaveBeenCalledWith({ allowSuspended: true });
    expect(mocks.startDraft).toHaveBeenCalledWith({
      kind: "initiative", anonymous: false, memberId: 14,
      reporter: { name: "Ana López", dni: "30123456", phone: "2974", email: "ana@example.com" },
      ip: "1.1.1.1", userAgent: "ua",
    });
  });
  it("actor bloqueado o sin cupo: no toca el servicio", async () => {
    mocks.requireMember.mockResolvedValue({ ok: false, reason: "withdrawn", error: "baja" });
    expect((await startMemberReportAction({}, fd({ kind: "reclamo", anonymous: "si" }))).error).toBe("baja");
    mocks.requireMember.mockResolvedValue({ ok: true, userId: 9, memberId: 14, fullName: "x", suspension: null });
    mocks.check.mockReturnValue(false);
    expect((await startMemberReportAction({}, fd({ kind: "reclamo", anonymous: "si" }))).error).toContain("Demasiados");
    expect(mocks.startDraft).not.toHaveBeenCalled();
  });
});
```

Run: `npm test -- --run tests/mi-solicitudes-tabs.test.ts tests/reports-member-actions.test.ts` → FAIL.

- [ ] **Step 2: Pestañas**

```ts
// src/lib/mi/solicitudes-tabs.ts
// Sub-pestañas de /mi/solicitudes (M7): Institucional (bajas y cambios de
// categoría, lo de siempre) y Reportes. Por URL, como `solicitudes-tabs.ts` del
// admin, y con su misma trampa: /mi/solicitudes es PREFIJO de la otra.
export type MiSolicitudesTab = { href: string; label: string };

const REPORTES = "/mi/solicitudes/reportes";

export const MI_SOLICITUDES_TABS: MiSolicitudesTab[] = [
  { href: "/mi/solicitudes", label: "Institucional" },
  { href: REPORTES, label: "Reportes" },
];

export function isMiSolicitudesTabActive(pathname: string, href: string): boolean {
  const underReportes = pathname === REPORTES || pathname.startsWith(`${REPORTES}/`);
  if (href === REPORTES) return underReportes;
  if (underReportes) return false;
  return pathname === "/mi/solicitudes" || pathname.startsWith("/mi/solicitudes/");
}
```

```tsx
"use client";
// src/components/mi/solicitudes-tabs.tsx — calca `SolicitudesTabs` del admin.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { isMiSolicitudesTabActive, type MiSolicitudesTab } from "@/lib/mi/solicitudes-tabs";
import { cn } from "@/lib/utils";

export function MiSolicitudesTabs({ tabs }: { tabs: MiSolicitudesTab[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Tipos de solicitud" className="-mx-4 -my-1 overflow-x-auto px-4 py-1">
      <ul className="flex min-w-max gap-1 border-b">
        {tabs.map((tab) => {
          const active = isMiSolicitudesTabActive(pathname, tab.href);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-12 items-center gap-1.5 border-b-2 px-3 text-sm outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                  active ? "border-primary font-semibold text-foreground" : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
                )}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
```

- [ ] **Step 3: Layout y página institucional**

```tsx
// src/app/mi/solicitudes/layout.tsx
// Marco de Solicitudes del socio (M7): el <h1> y las dos sub-pestañas. NO
// autoriza: cada página llama a requireMember por su cuenta.
import { MiSolicitudesTabs } from "@/components/mi/solicitudes-tabs";
import { MI_SOLICITUDES_TABS } from "@/lib/mi/solicitudes-tabs";

export default function MiSolicitudesLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">Solicitudes</h1>
        <p className="text-sm text-muted-foreground">
          Trámites ante la Comisión —baja o cambio de categoría— y reportes del barrio: reclamos e iniciativas.
        </p>
      </div>
      <MiSolicitudesTabs tabs={MI_SOLICITUDES_TABS} />
      {children}
    </div>
  );
}
```

En `src/app/mi/solicitudes/page.tsx`: borrar el bloque `<div className="space-y-1">…</div>` con el `<h1>` y el `<p>` (líneas del encabezado). Nada más cambia. Los tests de `mi-solicitudes-actions` siguen verdes (no tocan la página).

- [ ] **Step 4: Tarjeta y lista del socio**

```tsx
// src/components/mi/report-card.tsx — la tarjeta de un reporte en /mi.
import { Lightbulb, MessageSquareWarning } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateAR } from "@/lib/format";
import { AGENCY_LABELS, categoryLabel, filedVerb, KIND_LABELS, subtypeLabel } from "@/lib/reports/catalog";
import type { Report } from "@/generated/prisma/client";

export function reportStatusVariant(status: Report["status"]): "default" | "success" | "secondary" | "outline" {
  if (status === "received") return "default";
  if (status === "filed") return "success";
  if (status === "dismissed") return "secondary";
  return "outline";
}

export function ReportCard({ report }: { report: Report }) {
  const Icon = report.kind === "claim" ? MessageSquareWarning : Lightbulb;
  const what = report.kind === "claim" && report.subtype
    ? `${categoryLabel("claim", report.category)} › ${subtypeLabel(report.category, report.subtype)}`
    : categoryLabel(report.kind, report.category);
  const statusText =
    report.status === "filed" ? filedVerb(report.kind) : report.status === "received" ? "Recibido" : "Desestimado";
  const where = [report.streetName, report.addressDetail].filter(Boolean).join(" ");
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2" className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <span className="flex items-center gap-2">
            <Icon aria-hidden className="size-4 text-primary" />
            <span className="font-mono tabular-nums text-muted-foreground">N° {report.id}</span>
            {KIND_LABELS[report.kind]}
          </span>
          <Badge variant={reportStatusVariant(report.status)}>{statusText}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 text-sm">
        <p className="font-medium">{what}</p>
        <p className="text-muted-foreground">
          {where && <>{where} · </>}
          {report.submittedAt ? `Enviado el ${formatDateAR(report.submittedAt)}` : ""}
          {report.anonymous && " · Reservado"}
        </p>
        {report.status === "filed" && report.filedAt && (
          <p className="text-success">
            {report.kind === "claim"
              ? `Presentado ante ${report.filedAgency === "other" ? report.filedAgencyOther : report.filedAgency ? AGENCY_LABELS[report.filedAgency] : "el organismo"} el ${formatDateAR(report.filedAt)}${report.filedReference ? ` (exp. ${report.filedReference})` : ""}.`
              : `Tratada por la Comisión Directiva el ${formatDateAR(report.filedAt)}.`}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
```

```tsx
// src/app/mi/solicitudes/reportes/page.tsx
import Link from "next/link";
import { Plus } from "lucide-react";
import { EmptyState } from "@/components/admin/empty-state";
import { ReportCard } from "@/components/mi/report-card";
import { Button } from "@/components/ui/button";
import { requireMember } from "@/lib/auth/require-member";
import { reports } from "@/lib/reports/service";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reportes — Vecinal Ciudadela" };

export default async function MiReportesPage() {
  const actor = await requireMember({ allowSuspended: true });
  if (!actor.ok) return null;
  const list = await reports.listForMember(actor.memberId);
  const cta = (
    <Button asChild className="min-h-12 w-full sm:w-auto">
      <Link href="/mi/solicitudes/reportes/nuevo"><Plus aria-hidden className="size-4" /> Nuevo reporte</Link>
    </Button>
  );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Reclamos e iniciativas que mandaste, y qué hizo la asociación con cada uno.</p>
        {cta}
      </div>
      {list.length === 0 ? (
        <EmptyState description="Todavía no mandaste ningún reporte." action={cta} />
      ) : (
        <div className="space-y-3">{list.map((r) => <ReportCard key={r.id} report={r} />)}</div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Action y páginas del wizard en modo socio**

```ts
"use server";
// src/app/mi/solicitudes/reportes/actions.ts
// El borrador de un SOCIO (spec §5.2): sin Turnstile (hay sesión), con cupo por
// socio, y la identidad copiada de la ficha. El suspendido puede reportar (es
// vecino igual, decisión del operador). Desde acá en adelante el wizard usa las
// actions públicas, dirigidas por la llave.
import { headers } from "next/headers";
import { z } from "zod";
import { reportMemberLimiter } from "@/lib/auth/rate-limiter";
import { requireMember } from "@/lib/auth/require-member";
import { parseForm } from "@/lib/forms";
import { prisma } from "@/lib/prisma";
import { reports } from "@/lib/reports/service";

type StartState = { error?: string; started?: { claim: string } };
const RATE_MSG = "Demasiados reportes en un día. Probá mañana.";

const startSchema = z.object({
  kind: z.enum(["reclamo", "iniciativa"], { error: "Elegí qué querés reportar." }),
  anonymous: z.enum(["si", "no"], { error: "Contanos cómo querés figurar." }),
});

export async function startMemberReportAction(_prev: StartState, formData: FormData): Promise<StartState> {
  const actor = await requireMember({ allowSuspended: true });
  if (!actor.ok) return { error: actor.error };
  if (!reportMemberLimiter.check(String(actor.memberId))) return { error: RATE_MSG };
  const parsed = parseForm(startSchema, formData);
  if (!parsed.ok) return { error: parsed.error };

  const member = await prisma.member.findUnique({
    where: { id: actor.memberId },
    select: { fullName: true, dni: true, phone: true, email: true },
  });
  if (!member) return { error: "No encontramos tu ficha." };
  const h = await headers();
  const { claim } = await reports.startDraft({
    kind: parsed.data.kind === "reclamo" ? "claim" : "initiative",
    anonymous: parsed.data.anonymous === "si",
    memberId: actor.memberId,
    reporter: { name: member.fullName, dni: member.dni ?? "", phone: member.phone ?? "", email: member.email ?? "" },
    ip: h.get("x-real-ip") ?? "unknown",
    userAgent: (h.get("user-agent") ?? "").slice(0, 255),
  });
  return { started: { claim } };
}
```

> Verificar los nombres reales de las columnas de `Member` (`phone`, `email`, `dni`) en `prisma/schema.prisma` antes de escribir el `select`; ajustar si difieren.

```tsx
// src/app/mi/solicitudes/reportes/nuevo/page.tsx
import { ReportWizard } from "@/app/(public)/reportes/report-wizard";
import { requireMember } from "@/lib/auth/require-member";
import { getLegalTexts } from "@/lib/config";
import { prisma } from "@/lib/prisma";
import { startMemberReportAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Nuevo reporte — Vecinal Ciudadela" };

export default async function MiNuevoReportePage() {
  const actor = await requireMember({ allowSuspended: true });
  if (!actor.ok) return null;
  const [legal, streets] = await Promise.all([
    getLegalTexts(),
    prisma.street.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, loadOrder: true } }),
  ]);
  return (
    <ReportWizard mode="member" streets={streets} consentText={legal.privacyConsent} siteKey="" startAction={startMemberReportAction} />
  );
}
```

```tsx
// src/app/mi/solicitudes/reportes/nuevo/[claim]/page.tsx
import { notFound } from "next/navigation";
import { ReportWizard } from "@/app/(public)/reportes/report-wizard";
import { snapshotOf } from "@/app/(public)/reportes/snapshot";
import { requireMember } from "@/lib/auth/require-member";
import { getLegalTexts } from "@/lib/config";
import { prisma } from "@/lib/prisma";
import { reports } from "@/lib/reports/service";
import { startMemberReportAction } from "../../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tu reporte — Vecinal Ciudadela", robots: { index: false, follow: false } };

export default async function MiRetomarReportePage({ params }: { params: Promise<{ claim: string }> }) {
  const actor = await requireMember({ allowSuspended: true });
  if (!actor.ok) return null;
  const { claim } = await params;
  const report = await reports.findByClaim(claim);
  // El borrador de OTRO socio (o de un vecino) es un 404, nunca un 403.
  if (!report || report.memberId !== actor.memberId) notFound();
  const [legal, streets] = await Promise.all([
    getLegalTexts(),
    prisma.street.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, loadOrder: true } }),
  ]);
  return (
    <ReportWizard mode="member" streets={streets} consentText={legal.privacyConsent} siteKey="" initial={{ claim, snapshot: snapshotOf(report) }} startAction={startMemberReportAction} />
  );
}
```

- [ ] **Step 6: Atajo en el home**

En `src/app/mi/page.tsx`: importar `FileText` de lucide, cambiar `<div className="grid grid-cols-2 gap-4">` por `<div className="grid grid-cols-2 gap-4 sm:grid-cols-3">` y agregar como tercera celda:

```tsx
        <QuickLink href="/mi/solicitudes" icon={FileText} label="Solicitudes y reportes" description="Trámites y reclamos del barrio" />
```

- [ ] **Step 7: Correr todo y probar en el navegador**

Run: `npm test -- --run tests/mi-solicitudes-tabs.test.ts tests/reports-member-actions.test.ts tests/mi-nav.test.ts tests/mi-solicitudes-actions.test.ts` → PASS. `npx tsc --noEmit && npm run lint` limpios.

En dev, entrar como socio: `/mi/solicitudes` muestra las dos pestañas; "Reportes" → lista vacía con CTA → wizard de 2 pasos → enviar → la lista muestra la tarjeta con badge "Recibido".

- [ ] **Step 8: Commit**

```bash
git add src/lib/mi/solicitudes-tabs.ts src/components/mi/solicitudes-tabs.tsx src/components/mi/report-card.tsx src/app/mi/solicitudes src/app/mi/page.tsx tests/mi-solicitudes-tabs.test.ts tests/reports-member-actions.test.ts
git commit -m "feat(reports): member sub-tabs in /mi/solicitudes, report list and member-mode wizard

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Cierre de la Parte 2

- [ ] **Step 1: Suite, tipos, lint, build**

Run: `npm test && npx tsc --noEmit && npm run lint && ALLOW_LOCALHOST_BASE_URL=1 npm run build`
Expected: todo en verde; el build lista `/reportes` (ISR 1h), `/reportes/nuevo` y `/reportes/nuevo/[claim]` (dinámicas).

- [ ] **Step 2: Núcleo de dinero intacto**

Run: `git diff --stat main..reports -- src/lib/treasury src/lib/mp` → vacío.

- [ ] **Step 3: Pasada de accesibilidad y móvil en el navegador**

Con `resize_window` a `mobile`: el mosaico va a dos columnas, el mapa entra a lo ancho y se puede arrastrar con un dedo, el botón "Usar mi ubicación" tiene ≥44 px, cada paso mueve el foco al `<h1>`, y `Tab` recorre mosaico → tipos → descripción → mapa (botones de zoom) → calle → fotos → consentimiento → Enviar.

- [ ] **Step 4: Informe y commit**

Escribir `.superpowers/sdd/reports/parte-2.md` (qué pantallas hay, qué se probó a mano, qué queda para la Parte 3) y commitear:

```bash
git add .superpowers/sdd/reports/parte-2.md
git commit -m "docs(reports): part 2 (public and member surfaces) report

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review de la Parte 2 contra la spec

- §5.1 pasos 1-6 → Tasks 3, 7, 8 (retome con `peek` = `findByClaim` sin consumo). §5.2 socio → Task 9. §6.1 componentes → Tasks 5-7 (`ProcessRail` extendido en Task 1; `brand-pin` extraído). §6.2 → Task 9. §8 nav/robots/sitemap/Permissions-Policy → Task 2 (las entradas CSP de las rutas de archivos van en la Parte 3 con las rutas). §10 orden de guardas, Turnstile sólo en el paso 1, sin id por formulario, texto plano → Task 3 y 7. §11 textos → Tasks 4, 7.
- Firmas cruzadas con la Parte 1: `reports.startDraft/findByClaim/saveReporter/submit/listForMember/yearStats`, `reportFileStore.save/remove`, `reportNotifier.sendReceived/sendBoardAlert`, `MAX_IMAGE_BYTES`, `REPORT_MESSAGES`, `isClaimShaped`, limiters. Todas existen con esos nombres en la Parte 1.
- La Parte 3 consume de acá: `snapshotOf` no; `reportStatusVariant` de `report-card.tsx` la reemplaza `reportStatusBadgeVariant` de `status-badges.ts` (Parte 3, Task 1) — ahí se hace que `report-card.tsx` importe la de `status-badges.ts` y borre la local.
