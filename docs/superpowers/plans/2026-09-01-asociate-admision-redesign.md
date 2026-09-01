# ASOCIATE Admission Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make it unequivocal across the ASOCIATE wizard, its emails and the entry-fee receipt that paying does NOT make you a member — the Comisión Directiva resolves admission and the alta is recorded in an acta — via visual/copy changes only.

**Architecture:** Four new presentation pieces (ProcessRail, Callout, TramiteTimeline, FormMessage `kind="info"`) plus copy rewrites in the wizard steps, status screens, two email templates, one admin label, and a conditional legend on entry-fee receipts. Zero logic/flow/data changes.

**Tech Stack:** Next.js 16 App Router, TypeScript, Tailwind v4 tokens (light-only public site), lucide-react ^1.31, vitest (node env, `renderToStaticMarkup` for component tests), pdf-lib.

**Spec:** `docs/superpowers/specs/2026-09-01-asociate-admision-redesign-design.md` — read it first. Its §7 exclusion list is BINDING.

## Global Constraints

- **Copy rules (spec §5):** person = "vos"; the thing = "tu solicitud"; the board's verb = **"resolver"** (never "tratar"); "socio/a" only after the acta. Forbidden pre-acta: "aceptada", "bienvenido", "socio", "tu número". UI text es-AR (voseo).
- **Colors:** actionable/info = `--primary` (#0079BC). `#2E9BDF` decorative only. Green/amber ONLY via `--success`/`--warning` tokens. No raw Tailwind palette colors.
- **Light-only:** no `dark:` variants anywhere in these files.
- **Icons:** lucide-react, always `aria-hidden`, data must also exist as text.
- **A11y:** keep every existing focus mechanism (headingRef/tabIndex=-1, `role="status"` sr-only announcements, fieldset/legend, FOCUS_RING); targets ≥44px.
- **DO NOT TOUCH (spec §7):** `src/app/(public)/asociate/actions.ts`, `src/lib/mp/**`, `src/lib/applications/record.ts|query.ts|summary.ts|cron.ts`, `prisma/**`, `src/app/(public)/reempadronate/**`, the four existing FormMessage kinds' classes, `webhook-processor.ts` (not even its import lines).
- **Tests:** `npm test` (vitest run, node env). Component tests use `renderToStaticMarkup` (see `tests/documentos-tabs-component.test.ts` as the house mold). Only assertions pinning deliberately-changed strings may be updated, each one named in a task below.
- Commit after every task. Messages in English, conventional style, ending with the Claude trailer used in this repo.

---

### Task 0: Branch

- [ ] **Step 0.1:** From a clean `main` (`git status` → only untracked/scratch noise), create the branch:

```bash
git checkout -b asociate-admision-redesign
```

---

### Task 1: FormMessage `kind="info"` (additive)

**Files:**
- Modify: `src/components/admin/form-message.tsx`
- Test: `tests/form-message-info.test.ts` (create)

**Interfaces:**
- Produces: `FormMessage` accepts `kind="info"` → text `text-primary`, box `border-primary/40 bg-primary/5`, no ARIA role by default. Tasks 6–8 consume it.

- [ ] **Step 1.1: Write the failing test**

```ts
// tests/form-message-info.test.ts
// El quinto kind de FormMessage (spec 2026-09-01 §4.3): celeste institucional,
// ADITIVO — los cuatro kinds existentes no cambian ni una clase.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FormMessage } from "@/components/admin/form-message";

describe("FormMessage kind=info", () => {
  it("texto text-primary y caja border-primary/40 bg-primary/5, sin role", () => {
    const html = renderToStaticMarkup(
      createElement(FormMessage, { kind: "info", box: true }, "hola"),
    );
    expect(html).toContain("text-primary");
    expect(html).toContain("border-primary/40");
    expect(html).toContain("bg-primary/5");
    expect(html).not.toContain('role="');
  });
  it("role explícito lo pisa, como en los demás kinds", () => {
    const html = renderToStaticMarkup(
      createElement(FormMessage, { kind: "info", role: "status" }, "hola"),
    );
    expect(html).toContain('role="status"');
  });
  it("los cuatro kinds existentes conservan sus clases exactas", () => {
    const pairs = [
      ["error", "text-destructive"], ["success", "text-success"],
      ["warning", "text-warning"], ["neutral", "text-muted-foreground"],
    ] as const;
    for (const [kind, cls] of pairs) {
      expect(renderToStaticMarkup(createElement(FormMessage, { kind }, "x"))).toContain(cls);
    }
  });
});
```

- [ ] **Step 1.2:** Run: `npx vitest run tests/form-message-info.test.ts` → Expected: FAIL (TS/type error: `"info"` not assignable).

- [ ] **Step 1.3: Implement.** In `src/components/admin/form-message.tsx`:

```ts
// In KIND_CLASSES add:
  info: "text-primary",
// In BOX_CLASSES add:
  info: "border-primary/40 bg-primary/5",
```

and widen the prop type:

```ts
  kind: "error" | "success" | "warning" | "neutral" | "info";
```

The role-derivation line already leaves anything that isn't error/warning/success without a role — do not touch it. Add one sentence to the component comment: `// "info" (2026-09): nota institucional celeste del sitio público; sin anuncio, como neutral.`

- [ ] **Step 1.4:** Run: `npx vitest run tests/form-message-info.test.ts` → PASS. Then `npx vitest run` (full suite) → all green (nothing else may change).

- [ ] **Step 1.5: Commit** — `feat(ui): additive info kind on FormMessage for institutional notes`

---

### Task 2: `Callout` public component

**Files:**
- Create: `src/components/public/callout.tsx`
- Test: `tests/public-callout.test.ts` (create)

**Interfaces:**
- Produces: `Callout({ tone: "info"|"warning"|"success", icon: LucideIcon, inset?: boolean, role?: string, id?: string, className?, children })`. Task 8 consumes `<Callout tone="info" icon={Landmark} inset role="note" id="aviso-admision">`.

- [ ] **Step 2.1: Write the failing test**

```ts
// tests/public-callout.test.ts
// Callout del sitio público (spec §4.2): ícono + borde lateral + fondo al 5%,
// calcado del banner de veredicto de /admin/salud. `inset` es la piel para
// vivir dentro de otro recuadro (la cabecera de la boleta del paso 6).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Landmark } from "lucide-react";
import { Callout } from "@/components/public/callout";

describe("Callout", () => {
  it("standalone info: rounded-xl + border-l-4 primary + fondo al 5%", () => {
    const html = renderToStaticMarkup(
      createElement(Callout, { tone: "info", icon: Landmark }, "aviso"),
    );
    expect(html).toContain("rounded-xl");
    expect(html).toContain("border-l-4");
    expect(html).toContain("border-l-primary");
    expect(html).toContain("bg-primary/5");
    expect(html).toContain('aria-hidden'); // el ícono es decorativo
  });
  it("inset: sin redondeo ni border-l, con línea inferior del tono", () => {
    const html = renderToStaticMarkup(
      createElement(Callout, { tone: "info", icon: Landmark, inset: true, role: "note", id: "aviso-admision" }, "aviso"),
    );
    expect(html).not.toContain("rounded-xl");
    expect(html).not.toContain("border-l-4");
    expect(html).toContain("border-b-2");
    expect(html).toContain('role="note"');
    expect(html).toContain('id="aviso-admision"');
  });
});
```

- [ ] **Step 2.2:** Run: `npx vitest run tests/public-callout.test.ts` → FAIL (module not found).

- [ ] **Step 2.3: Implement**

```tsx
// src/components/public/callout.tsx
// Aviso institucional del sitio público: ícono + borde lateral + fondo tintado.
// Calcado del banner de veredicto de /admin/salud (health-panels.tsx), la única
// pieza de este tipo ya aprobada en el sistema; se replica en vez de importarse
// porque aquélla está acoplada a HealthAlerts. Spec 2026-09-01 §4.2.
//
// `inset`: la piel para vivir DENTRO de otro recuadro (la cabecera de la boleta
// del paso 6 de ASOCIATE) — sin borde propio ni redondeo, con la línea del tono
// abajo. El ícono es decorativo: el mensaje tiene que valer como texto solo.
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const TONES = {
  info: { border: "border-l-primary", inset: "border-b-primary/35", bg: "bg-primary/5", tone: "text-primary" },
  warning: { border: "border-l-warning", inset: "border-b-warning/40", bg: "bg-warning/10", tone: "text-warning" },
  success: { border: "border-l-success", inset: "border-b-success/40", bg: "bg-success/10", tone: "text-success" },
} as const;

export function Callout({
  tone, icon: Icon, inset = false, role, id, className, children,
}: {
  tone: keyof typeof TONES;
  icon: LucideIcon;
  inset?: boolean;
  role?: string;
  id?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const t = TONES[tone];
  return (
    <div
      role={role}
      id={id}
      className={cn(
        "flex items-start gap-3 p-4 text-sm",
        inset ? cn("border-b-2", t.inset) : cn("rounded-xl border border-l-4", t.border),
        t.bg,
        className,
      )}
    >
      <Icon aria-hidden className={cn("mt-0.5 size-5 shrink-0", t.tone)} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
```

- [ ] **Step 2.4:** Run: `npx vitest run tests/public-callout.test.ts` → PASS.
- [ ] **Step 2.5: Commit** — `feat(public): Callout component (info/warning/success, inset skin)`

---

### Task 3: `ProcessRail` component

**Files:**
- Create: `src/app/(public)/asociate/process-rail.tsx`
- Test: `tests/asociate-process-rail.test.ts` (create)

**Interfaces:**
- Produces: `ProcessRail({ step: number, total: number })` — Task 5 replaces the inline stepper with it.

- [ ] **Step 3.1: Write the failing test**

```ts
// tests/asociate-process-rail.test.ts
// El stepper de proceso (spec §4.1): la barra mide el formulario; las etapas
// "La Comisión resuelve" y "Alta en acta" están SIEMPRE a la vista.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProcessRail } from "@/app/(public)/asociate/process-rail";

describe("ProcessRail", () => {
  const html = renderToStaticMarkup(createElement(ProcessRail, { step: 2, total: 6 }));
  it("eyebrow mono con el paso, y el gráfico es decorativo", () => {
    expect(html).toContain("Paso 2 de 6");
    expect(html).toContain("font-mono");
    expect(html).toContain("aria-hidden");
  });
  it("muestra las tres etapas del camino", () => {
    expect(html).toContain("Tu solicitud");
    expect(html).toMatch(/La Comisión\s*<br\/?>?\s*resuelve/);
    expect(html).toMatch(/Alta\s*<br\/?>?\s*en acta/);
  });
  it("la barra refleja el avance del formulario", () => {
    expect(html).toContain("width:33.3"); // 2/6 → 33.33…%
  });
  it("frase sr-only con el dato para lector de pantalla", () => {
    expect(html).toContain("sr-only");
    expect(html).toContain("la resuelve la Comisión Directiva");
  });
  it("respeta motion-reduce en la transición de la barra", () => {
    expect(html).toContain("motion-reduce:transition-none");
  });
});
```

- [ ] **Step 3.2:** Run: `npx vitest run tests/asociate-process-rail.test.ts` → FAIL (module not found).

- [ ] **Step 3.3: Implement**

```tsx
// src/app/(public)/asociate/process-rail.tsx
// El stepper de proceso del wizard ASOCIATE (spec 2026-09-01 §4.1). La barra de
// progreso mide el formulario, y el formulario es sólo el primer tramo del
// camino: las dos etapas que siguen —la resolución de la Comisión Directiva y
// el asiento en acta— quedan SIEMPRE a la vista, para que ningún paso pueda
// leerse como "completando esto quedás adentro" (Art. 5 inc. 7: la admisión la
// resuelve la CD; el acta marco de REG-12 no existe).
//
// El gráfico es decorativo (`aria-hidden`, como la barra que reemplaza): el
// dato viaja en el eyebrow, en el `role="status"` del wizard y en la frase
// sr-only de acá abajo — que se dice UNA vez por montaje, no por paso, para no
// castigar al lector de pantalla en cada avance.
import { Landmark, Stamp } from "lucide-react";

export function ProcessRail({ step, total }: { step: number; total: number }) {
  return (
    <div>
      <p className="font-mono text-xs font-semibold tracking-[0.14em] text-primary uppercase">
        Paso {step} de {total} · Tu solicitud
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
          <p className="mt-1 text-[10px] font-semibold leading-tight">Tu solicitud</p>
        </div>
        <FuturePhase icon={<Landmark className="size-3.5" />}>
          La Comisión<br />resuelve
        </FuturePhase>
        <FuturePhase icon={<Stamp className="size-3.5" />}>
          Alta<br />en acta
        </FuturePhase>
      </div>
      <p className="sr-only">
        Después de enviar tu solicitud, la resuelve la Comisión Directiva y el alta se asienta en
        acta.
      </p>
    </div>
  );
}

function FuturePhase({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <>
      <span className="flex h-6 w-3 shrink-0 items-center sm:w-4">
        <span className="h-0.5 w-full bg-border" />
      </span>
      <span className="shrink-0 px-0.5 text-center">
        <span className="mx-auto flex size-6 items-center justify-center rounded-full border-2 border-border text-muted-foreground">
          {icon}
        </span>
        <span className="mt-1 block text-[10px] font-semibold leading-tight text-muted-foreground">
          {children}
        </span>
      </span>
    </>
  );
}
```

- [ ] **Step 3.4:** Run: `npx vitest run tests/asociate-process-rail.test.ts` → PASS. If the `width:33.3` assertion fails on formatting, inspect the rendered style and pin the assertion to the actual stable substring (e.g. `33.33333`), never loosen the others.
- [ ] **Step 3.5: Commit** — `feat(asociate): ProcessRail — full-path stepper (form → board → acta)`

---

### Task 4: `TramiteTimeline` component

**Files:**
- Create: `src/app/(public)/asociate/tramite-timeline.tsx`
- Test: `tests/asociate-tramite-timeline.test.ts` (create)

**Interfaces:**
- Produces: `TramiteTimeline({ items })` with `items: { state: "done"|"now"|"next"; icon?: LucideIcon; title: ReactNode; children?: ReactNode }[]`. Task 9 consumes it.

- [ ] **Step 4.1: Write the failing test**

```ts
// tests/asociate-tramite-timeline.test.ts
// La línea de tiempo del trámite (spec §4.4): el camino del ProcessRail en
// vertical y con estado. Verde = cumplido; celeste + "Estás acá" = en curso.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Landmark, Stamp } from "lucide-react";
import { TramiteTimeline } from "@/app/(public)/asociate/tramite-timeline";

const ITEMS = [
  { state: "done" as const, title: "Solicitud completa y pago acreditado" },
  { state: "now" as const, icon: Landmark, title: "La Comisión Directiva resuelve" },
  { state: "next" as const, icon: Stamp, title: "Alta en acta" },
];

describe("TramiteTimeline", () => {
  const html = renderToStaticMarkup(createElement(TramiteTimeline, { items: ITEMS }));
  it("estados por tono: done verde, now foreground, next muted", () => {
    expect(html).toContain("text-success");
    expect(html).toContain("bg-success");
    expect(html).toContain("border-primary");
    expect(html).toContain("border-border");
  });
  it('el hito en curso lleva el chip "Estás acá" y solo ése', () => {
    expect(html.match(/Estás acá/g)).toHaveLength(1);
  });
  it("los discos son decorativos; los títulos son texto", () => {
    expect(html).toContain("aria-hidden");
    for (const item of ITEMS) expect(html).toContain(String(item.title));
  });
});
```

- [ ] **Step 4.2:** Run: `npx vitest run tests/asociate-tramite-timeline.test.ts` → FAIL.

- [ ] **Step 4.3: Implement**

```tsx
// src/app/(public)/asociate/tramite-timeline.tsx
// La línea de tiempo del trámite (spec 2026-09-01 §4.4): el mismo camino del
// ProcessRail, vertical y con estado. La usan las pantallas de estado de la
// solicitud (post-pago, sin débito, y el sondeo del pago). El patrón del
// conector viene de /ubicacion (ol con línea y punto absoluto); el disco verde
// con tilde, de las ranuras del paso 5. El estado viaja también en texto (el
// chip "Estás acá" y el copy de cada hito): los discos son decorativos.
import { Check } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type TimelineItem = {
  state: "done" | "now" | "next";
  icon?: LucideIcon;
  title: React.ReactNode;
  children?: React.ReactNode;
};

export function TramiteTimeline({ items }: { items: TimelineItem[] }) {
  return (
    <ol className="list-none p-0">
      {items.map((item, i) => (
        <li key={i} className="relative pb-5 pl-9 last:pb-0">
          {i < items.length - 1 && (
            <span aria-hidden className="absolute top-7 bottom-0 left-3 w-0.5 bg-border" />
          )}
          <Dot state={item.state} icon={item.icon} />
          <p
            className={cn(
              "text-sm font-semibold",
              item.state === "done" && "text-success",
              item.state === "now" && "text-foreground",
              item.state === "next" && "text-muted-foreground",
            )}
          >
            {item.title}
            {item.state === "now" && (
              <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 align-[2px] font-mono text-[10px] font-bold tracking-wide text-primary uppercase">
                Estás acá
              </span>
            )}
          </p>
          {item.children && (
            <div className={cn("mt-0.5 text-sm", item.state === "now" ? "text-foreground/80" : "text-muted-foreground")}>
              {item.children}
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}

function Dot({ state, icon: Icon }: { state: TimelineItem["state"]; icon?: LucideIcon }) {
  return (
    <span
      aria-hidden
      className={cn(
        "absolute top-0 left-0 flex size-6 items-center justify-center rounded-full",
        state === "done" && "bg-success text-background",
        state === "now" && "border-2 border-primary bg-background text-primary",
        state === "next" && "border-2 border-border bg-background text-muted-foreground",
      )}
    >
      {state === "done" ? <Check className="size-3.5" strokeWidth={3} /> : Icon ? <Icon className="size-3" /> : null}
    </span>
  );
}
```

- [ ] **Step 4.4:** Run: `npx vitest run tests/asociate-tramite-timeline.test.ts` → PASS.
- [ ] **Step 4.5: Commit** — `feat(asociate): TramiteTimeline — stateful vertical path for status screens`

---

### Task 5: Wire the frame — wizard titles, rail, step-icon chips, trail label, wizard-ui additive props

**Files:**
- Modify: `src/app/(public)/asociate/asociate-wizard.tsx`
- Modify: `src/app/(public)/asociate/wizard-ui.tsx` (two ADDITIVE props)

**Interfaces:**
- Consumes: `ProcessRail` (Task 3).
- Produces: `ChoiceCard` gains optional `icon?: React.ReactNode` (rendered as a 32px primary chip); `NavButtons` gains optional `nextDescribedBy?: string` (→ `aria-describedby` on the next/submit button). Tasks 7–8 consume both.

- [ ] **Step 5.1:** In `asociate-wizard.tsx`, update `STEP_TITLES` (lines ~76-83): entry 3 `"Elegí tu categoría"` → `"¿En qué categoría querés asociarte?"`; entry 6 `"Pago y envío"` → `"Pago y envío de tu solicitud"`. Others unchanged.

- [ ] **Step 5.2:** Add the step-icon map next to `STEP_TITLES` and import the icons:

```tsx
import { CreditCard, FileText, IdCard, MapPin, UserRound, Users } from "lucide-react";
import { ProcessRail } from "./process-rail";

// Ícono por paso, para el chip del h1 (el gesto size-9 bg-primary/10 del
// tablero /admin). Decorativos: el título es el dato.
const STEP_ICONS: Record<number, LucideIcon> = {
  1: IdCard, 2: MapPin, 3: Users, 4: UserRound, 5: FileText, 6: CreditCard,
};
```

(import `type { LucideIcon } from "lucide-react"` too.)

- [ ] **Step 5.3:** Replace the inline stepper block (the eyebrow `<p>` + `aria-hidden` progress `div`, currently ~lines 377-386) with `<ProcessRail step={step} total={TOTAL_STEPS} />`, and give the `h1` its chip. The `h1` block becomes:

```tsx
<h1
  ref={headingRef}
  tabIndex={-1}
  className="mt-5 flex items-center gap-2.5 text-2xl font-bold tracking-tight outline-hidden sm:text-3xl"
>
  <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
    <StepIcon className="size-5" />
  </span>
  {STEP_TITLES[step]}
</h1>
```

with `const StepIcon = STEP_ICONS[step] ?? IdCard;` computed just above the return. Keep the existing sr-only `role="status"` paragraph EXACTLY as is.

- [ ] **Step 5.4:** In the `AnsweredTrail` rows definition, change the category row's label string `"Categoría"` → `"Categoría solicitada"` (one string, ~line 511).

- [ ] **Step 5.5:** In `wizard-ui.tsx` — two additive props:

In `ChoiceCard`, add `icon` to props (`icon?: React.ReactNode`) and render it right after the radio `<input>`:

```tsx
{icon && (
  <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
    {icon}
  </span>
)}
```

In `NavButtons`, add `nextDescribedBy?: string` to the shared props and pass `aria-describedby={nextDescribedBy}` to the next/submit `<Button>` (both union branches render the same button — one attribute).

- [ ] **Step 5.6:** Run: `npx tsc --noEmit` → clean. `npx vitest run` → green. Start the dev server (`.claude/launch.json`) and open `/asociate`: rail visible, chip on h1, step 1 works. Screenshot.
- [ ] **Step 5.7: Commit** — `feat(asociate): process rail frame, step icon chips, solicited-category trail label`

---

### Task 6: Steps 2–3 copy (+ category icons)

**Files:**
- Modify: `src/app/(public)/asociate/step-residence.tsx`
- Modify: `src/app/(public)/asociate/step-category.tsx`

**Interfaces:**
- Consumes: `ChoiceCard icon` prop (Task 5), `FormMessage kind="info"` (Task 1).

- [ ] **Step 6.1:** `step-residence.tsx` — three copy changes:
  - Insert a subtitle as the first child of the returned `<div>`:
    ```tsx
    <p className="text-sm text-muted-foreground">
      De tu domicilio depende en qué categorías podés solicitar el ingreso.
    </p>
    ```
    and change the `<fieldset>` to `<fieldset className="mt-4">`.
  - Card 1 body: `Podés asociarte como socio activo o adherente.` → `Podés solicitar el ingreso como socio activo o adherente.`
  - Card 2 body: `Podés asociarte como socio colaborador.` → `Podés solicitar el ingreso como socio colaborador.`

- [ ] **Step 6.2:** `step-category.tsx` — imports: add `import { Handshake, Heart, Vote } from "lucide-react";`. Then:
  - sr-only legend: `"Elegí tu categoría"` → `"¿En qué categoría querés asociarte?"`, and insert the subtitle right before the `fieldset` (in-barrio branch) / before the collaborator card (out-of-barrio branch):
    ```tsx
    <p className="mb-4 text-sm text-muted-foreground">
      La categoría se solicita: la admisión la resuelve la Comisión Directiva.
    </p>
    ```
  - Active card: add `icon={<Vote className="size-4" />}`, body →
    ```tsx
    <span className="font-semibold text-primary">Si la Comisión te admite:</span> voz y voto en
    las asambleas, y podés ocupar cargos. El voto rige a los 90 días de tu fecha de ingreso.
    ```
  - Adherent card: add `icon={<Heart className="size-4" />}`, body →
    ```tsx
    <span className="font-semibold text-primary">Si la Comisión te admite:</span> voz en las
    asambleas y votás en las elecciones, también a los 90 días del ingreso.
    ```
  - Collaborator fixed card: inside its `<div className="rounded-xl border-2 border-primary bg-primary/5 p-4">`, add the same 32px chip before the title row:
    ```tsx
    <span aria-hidden className="mb-2 flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
      <Handshake className="size-4" />
    </span>
    ```
    and its description `<p>` →
    ```tsx
    <span className="font-semibold text-primary">Si la Comisión te admite:</span> participás como
    socio colaborador. Es la categoría que corresponde a quienes viven fuera del barrio.
    ```
  - Upsell box: `kind="neutral"` → `kind="info"`, and its first span →
    ```tsx
    Por {formatARS(fees.active)} al mes podés <strong>solicitar el ingreso como socio activo</strong>,
    la categoría con voz y voto en las asambleas.
    ```
  - Everything else (débito question, both wantsDebit cards, error handling) unchanged.

- [ ] **Step 6.3:** `npx tsc --noEmit` clean; `npx vitest run` green; dev server: walk to step 3, check both branches (in/out of barrio) visually. Screenshot.
- [ ] **Step 6.4: Commit** — `feat(asociate): steps 2-3 copy — solicit wording, board-conditioned rights, category icons`

---

### Task 7: Step 6 — boleta with admission notice, new button

**Files:**
- Modify: `src/app/(public)/asociate/step-payment.tsx`

**Interfaces:**
- Consumes: `Callout` (Task 2), `NavButtons nextDescribedBy` (Task 5).

- [ ] **Step 7.1:** Imports: add `import { Landmark } from "lucide-react";` and `import { Callout } from "@/components/public/callout";`.

- [ ] **Step 7.2:** In `DebitBranch`, replace `CATEGORY_FEE_LABEL` and the boleta block. New label map (top of file, replacing the old one):

```tsx
const CATEGORY_FEE_LABEL: Record<string, string> = {
  active: "Cuota mensual de la categoría activo",
  adherent: "Cuota mensual de la categoría adherente",
  collaborator: "Cuota mensual de la categoría colaborador",
};
```

New boleta (replaces the current `<div className="overflow-hidden rounded-xl border-2 border-border">…</div>` including the amber `<p>`):

```tsx
<div className="overflow-hidden rounded-xl border-2 border-border">
  {/* La regla del trámite, ANTES de los importes (spec §5.4): celeste y no
      rojo — en este sistema el rojo es error y el ámbar es dinero; esto es
      una condición institucional. role="note" + aria-describedby en el botón:
      quien tabula directo al pago también la escucha. */}
  <Callout tone="info" icon={Landmark} inset role="note" id="aviso-admision">
    <p>
      <strong>Pagar no te convierte en socio/a.</strong> La admisión la resuelve la Comisión
      Directiva en su próxima reunión, y puede no hacer lugar a tu solicitud.
    </p>
  </Callout>
  <ul className="divide-y divide-border">
    <FeeRow when="Ahora, al autorizar" what="Cuota de ingreso" amount={fee} emphasis />
    <FeeRow
      when="Después, todos los meses"
      what={CATEGORY_FEE_LABEL[category] ?? "Cuota mensual"}
      amount={fee}
    />
  </ul>
  {/* La condición del dinero: cita el Art. 5 (por qué se cobra antes) y
      atribuye la retención a los términos aceptados — el estatuto no norma el
      reembolso. NO menciona la "mensual adelantada": el flujo no la cobra. */}
  <p className="border-t-2 border-warning/40 bg-warning/10 px-4 py-3.5 text-sm text-warning">
    El estatuto pide abonar la cuota de ingreso —equivale a un mes de cuota— para poder ser
    admitido (Art. 5). Según los términos que aceptaste, <strong>no se devuelve</strong>,
    cualquiera sea el resultado. Luego se debita la cuota mensual.
  </p>
</div>
```

- [ ] **Step 7.3:** Replace the paragraph below the boleta:

```tsx
<p className="mt-5 text-sm text-muted-foreground">
  Te llevamos a Mercado Pago para que autorices el débito. Cuando vuelvas te confirmamos que el
  pago entró; el resultado de tu solicitud te lo avisamos por correo cuando la Comisión la
  resuelva.
</p>
```

- [ ] **Step 7.4:** `NavButtons` of `DebitBranch`: `nextLabel="Ir a Mercado Pago"` → `nextLabel="Pagar y enviar mi solicitud"`, and add `nextDescribedBy="aviso-admision"`. Keep both `pendingLabel`s and the `blocked`/`fee === null` logic untouched.

- [ ] **Step 7.5:** `NoDebitBranch` body paragraph →

```tsx
<p className="mt-1.5 text-sm text-muted-foreground">
  Elegiste no adherir al débito automático de la cuota voluntaria, así que no te vamos a cobrar
  nada. <strong>Todavía no sos socio/a</strong>: la Comisión Directiva va a resolver tu solicitud
  en su próxima reunión y te avisamos el resultado por email.
</p>
```

(title `Tu solicitud se envía sin pago`, the sede line, error box and buttons unchanged.)

- [ ] **Step 7.6:** Also update the file's header comment (lines 2-17) so it no longer describes the old layout: mention the three-body boleta (regla → importes → condición del dinero). `npx tsc --noEmit`; `npx vitest run`; dev server: reach step 6 in a debit branch and in the no-debit branch, screenshots of both.
- [ ] **Step 7.7: Commit** — `feat(asociate): step 6 boleta — admission notice first, statute-grounded money note, honest button`

---

### Task 8: Status screens with timeline

**Files:**
- Modify: `src/app/(public)/asociate/application-status.tsx`
- Test: `tests/asociate-status-screens.test.ts` (create)

**Interfaces:**
- Consumes: `TramiteTimeline` (Task 4), `FormMessage kind="info"` (Task 1).

- [ ] **Step 8.1: Write the failing test**

```ts
// tests/asociate-status-screens.test.ts
// Las pantallas de estado post-envío (spec §5.5). La garantía central del
// rediseño: ninguna pantalla afirma la admisión antes del acta.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ApplicationStatusScreen } from "@/app/(public)/asociate/application-status";

function render(status: string) {
  return renderToStaticMarkup(
    createElement(ApplicationStatusScreen, {
      status: status as never,
      resumeToken: "T",
      preapprovalId: null,
      fullName: "Marcela Gómez",
    }),
  );
}

describe("approved_pending_minute (pagó, espera el acta)", () => {
  const html = render("approved_pending_minute");
  it("dice 'completa' y niega la membresía; nunca 'aceptada' ni 'Bienvenido'", () => {
    expect(html).toContain("Tu solicitud quedó completa");
    expect(html).toContain("Todavía no sos socio/a");
    expect(html).not.toMatch(/aceptada/i);
    expect(html).not.toMatch(/Bienvenid/);
  });
  it("saluda por nombre en el acuse y muestra la timeline con 'Estás acá'", () => {
    expect(html).toContain("Marcela");
    expect(html).toContain("Estás acá");
    expect(html).toContain("La Comisión Directiva resuelve");
    expect(html).toContain("Alta en acta");
  });
  it("los 90 días del Art. 6 están dichos", () => {
    expect(html).toMatch(/90 días/);
  });
});

describe("pending_board (sin pago)", () => {
  const html = render("pending_board");
  it("presenta y resuelve, sin caja de éxito", () => {
    expect(html).toContain("Recibimos tu solicitud");
    expect(html).toContain("presentada");
    expect(html).toMatch(/resolver|resuelve/);
    expect(html).not.toMatch(/tratar/);
    expect(html).toContain("Estás acá");
  });
});

describe("expired y resueltas no cambian", () => {
  it("expired conserva su copy", () => {
    expect(render("expired")).toContain("vencen a los 7 días");
  });
  it("rejected/completed conservan su copy", () => {
    expect(render("rejected")).toContain("Revisá tu email");
  });
});
```

- [ ] **Step 8.2:** Run: `npx vitest run tests/asociate-status-screens.test.ts` → FAIL on the new copy (old strings render). Note: the component calls `useEffect`/`useState` — `renderToStaticMarkup` ignores effects and renders initial state; `pending_payment` polls, so tests only cover the other statuses (as above).

- [ ] **Step 8.3: Implement.** In `application-status.tsx`:

Imports: add `import { CreditCard, Landmark, Stamp } from "lucide-react";` and `import { TramiteTimeline } from "./tramite-timeline";`.

Widen `VIEWS` type so `body` can consume the name:

```tsx
const VIEWS: Record<string, {
  title: string | ((name: string) => string);
  body?: React.ReactNode | ((name: string) => React.ReactNode);
}> = { … };
```

and at the render site:

```tsx
{status === "pending_payment" ? (
  <PendingPayment … />
) : typeof view.body === "function" ? (
  view.body(fullName)
) : (
  view.body
)}
```

Replace the `approved_pending_minute` entry (delete the welcome comment above `VIEWS` too — it describes the screen being removed):

```tsx
approved_pending_minute: {
  title: "Tu solicitud quedó completa",
  body: (name: string) => (
    <>
      <FormMessage kind="info" box>
        Recibimos tu pago{firstName(name) ? `, ${firstName(name)}` : ""}.{" "}
        <strong>Ya cumpliste todos los requisitos del estatuto</strong> para pedir el ingreso a
        la vecinal.
      </FormMessage>
      <TramiteTimeline
        items={[
          {
            state: "done",
            title: "Solicitud completa y pago acreditado",
            children: "Te enviamos por correo el recibo de la cuota de ingreso.",
          },
          {
            state: "now",
            icon: Landmark,
            title: "La Comisión Directiva resuelve",
            children: (
              <>
                <strong className="text-foreground">Todavía no sos socio/a.</strong> La admisión
                se resuelve en la próxima reunión (Art. 5 del estatuto) y te avisamos el
                resultado por correo.
              </>
            ),
          },
          {
            state: "next",
            icon: Stamp,
            title: "Alta en acta",
            children:
              "Si te admiten, la fecha del acta es tu fecha de ingreso — y desde ahí corren los 90 días para votar en asambleas y elecciones.",
          },
        ]}
      />
      <p className="text-sm text-muted-foreground">
        Te mandamos un correo aparte para verificar tu dirección: confirmala así podés recibir el
        acceso al portal de socios si tu alta se asienta.
      </p>
    </>
  ),
},
```

Replace the `pending_board` entry:

```tsx
pending_board: {
  title: "Recibimos tu solicitud",
  body: (
    <>
      <FormMessage kind="info" box>
        Tu solicitud quedó <strong>presentada</strong>.
      </FormMessage>
      <TramiteTimeline
        items={[
          { state: "done", title: "Solicitud presentada" },
          {
            state: "now",
            icon: Landmark,
            title: "La Comisión Directiva resuelve",
            children:
              "Todavía no sos socio/a: la va a resolver en su próxima reunión y te avisamos el resultado por email.",
          },
          {
            state: "next",
            icon: Stamp,
            title: "Alta en acta",
            children: "Si te admiten, la fecha del acta es tu fecha de ingreso.",
          },
        ]}
      />
      <p className="text-sm text-muted-foreground">
        Te mandamos aparte un correo para verificar tu dirección. Revisá también la carpeta de
        correo no deseado.
      </p>
    </>
  ),
},
```

In `PendingPayment`, add the timeline UNDER the existing FormMessage (poll logic, buttons, links, messages all untouched):

```tsx
<TramiteTimeline
  items={[
    { state: "now", icon: CreditCard, title: "Estamos confirmando tu pago" },
    { state: "next", icon: Landmark, title: "La Comisión Directiva resuelve" },
    { state: "next", icon: Stamp, title: "Alta en acta" },
  ]}
/>
```

Keep `firstName` (still used), `expired`, `rejected`, `VIEWS.completed = VIEWS.rejected` untouched.

- [ ] **Step 8.4:** Run: `npx vitest run tests/asociate-status-screens.test.ts` → PASS. Full `npx vitest run` → green.
- [ ] **Step 8.5: Commit** — `feat(asociate): status screens — complete-not-admitted copy with trámite timeline`

---

### Task 9: Landing metadata

**Files:**
- Modify: `src/app/(public)/asociate/page.tsx` (line ~13)

- [ ] **Step 9.1:** Meta description: `` `Asociate a la ${SITE.name} en línea, en cinco pasos.` `` → `` `Asociate a la ${SITE.name} en línea, en seis pasos.` `` (it has said "cinco" since before the DNI step existed).
- [ ] **Step 9.2:** `npx vitest run` green. **Commit** — `fix(asociate): meta description says six steps`

---

### Task 10: Emails — acuse instead of aceptación

**Files:**
- Modify: `src/lib/email/templates.ts` (`applicationAcceptedEmail`, `applicationReceivedEmail`)
- Modify: `tests/application-emails.test.ts` (assertions pinning changed strings — listed below)
- Modify: `tests/mp-webhook-processor.test.ts` (ONLY the `it(...)` title at line ~406 naming "bienvenida"; no logic)

**Interfaces:**
- Produces: same exported names, same `(opts: { name: string })` signatures. `webhook-processor.ts` and `asociate/actions.ts` are NOT touched.

- [ ] **Step 10.1: Update the failing-first assertions** in `tests/application-emails.test.ts`. Replace the first test with:

```ts
it("acuse con pago: saluda por nombre, niega la membresía y explica quién resuelve", () => {
  const m = applicationAcceptedEmail({ name: "Ana Pérez" });
  expect(m.subject).toMatch(/Recibimos tu solicitud y tu pago/);
  expect(m.subject).not.toMatch(/aceptada/i);
  expect(m.text).toContain("Ana Pérez");
  expect(m.text).toContain("todavía no sos socio/a");
  expect(m.text).toMatch(/Comisión Directiva/);
  expect(m.text).toMatch(/fecha de ingreso/i);
  expect(m.text).toMatch(/no se devuelve/);
  expect(m.text).toMatch(/seis meses/);
  expect(m.text).not.toMatch(/Bienvenid/);
});
```

and the second with:

```ts
it("recibida: saluda por nombre, niega la membresía y la resuelve la Comisión Directiva", () => {
  const m = applicationReceivedEmail({ name: "Ana Pérez" });
  expect(m.text).toContain("Ana Pérez");
  expect(m.text).toContain("Todavía no sos socio/a");
  expect(m.text).toMatch(/resolver/);
  expect(m.text).toMatch(/Comisión Directiva/);
});
```

The other tests in the file (escaping, plain-text usability, rejected, resume/reminder) must NOT be edited.

- [ ] **Step 10.2:** Run: `npx vitest run tests/application-emails.test.ts` → FAIL (old copy).

- [ ] **Step 10.3: Implement.** Replace `applicationAcceptedEmail` in `templates.ts`:

```ts
/** Acuse de solicitud completa: el débito se autorizó y el primer pago entró.
 *  NO es una aceptación — el acta marco de REG-12 nunca se dictó y la admisión
 *  la resuelve la CD (Art. 5 inc. 7). El nombre exportado es histórico: se
 *  conserva para no tocar el webhook (spec 2026-09-01 §6.1). */
export function applicationAcceptedEmail(opts: { name: string }): Rendered {
  return {
    subject: "Recibimos tu solicitud y tu pago — Vecinal Ciudadela",
    text: `Hola ${opts.name}:

Registramos tu solicitud de asociación y acreditamos el pago de la cuota de ingreso. El recibo te lo enviamos en un correo aparte.

Con esto tu solicitud quedó completa, pero todavía no sos socio/a de la vecinal. La admisión la resuelve la Comisión Directiva en su próxima reunión y queda asentada en acta (Art. 5 del estatuto). La fecha de esa acta será tu fecha de ingreso.

La Comisión puede no hacer lugar a la solicitud. Si eso pasa, según los términos que aceptaste la cuota de ingreso no se devuelve, damos de baja tu débito automático en Mercado Pago y podés volver a presentarte a los seis meses.

Mientras tanto tu débito queda autorizado. Te avisamos el resultado por este mismo medio.

Te enviamos aparte un correo para verificar tu dirección de email: confirmala para poder recibir el acceso al portal de socios si tu alta se asienta.${SIGNATURE}`,
    html: layout("Recibimos tu solicitud y tu pago", `<p>Hola <strong>${esc(opts.name)}</strong>:</p>
<p>Registramos tu solicitud de asociación y acreditamos el pago de la cuota de ingreso. El recibo te lo enviamos en un correo aparte.</p>
<p><strong>Con esto tu solicitud quedó completa, pero todavía no sos socio/a de la vecinal.</strong> La admisión la resuelve la Comisión Directiva en su próxima reunión y queda asentada en acta (Art. 5 del estatuto). La fecha de esa acta será tu <strong>fecha de ingreso</strong>.</p>
<p>La Comisión puede no hacer lugar a la solicitud. Si eso pasa, según los términos que aceptaste la cuota de ingreso no se devuelve, damos de baja tu débito automático en Mercado Pago y podés volver a presentarte a los seis meses.</p>
<p>Mientras tanto tu débito queda autorizado. Te avisamos el resultado por este mismo medio.</p>
<p>Te enviamos aparte un correo para verificar tu dirección de email: confirmala para poder recibir el acceso al portal de socios si tu alta se asienta.</p>`),
  };
}
```

Replace `applicationReceivedEmail`'s middle paragraph (text AND html, kept in sync):

```
Tu solicitud de asociación fue recibida. Todavía no sos socio/a: la va a resolver la Comisión Directiva en su próxima reunión y te avisamos el resultado por este medio.
```

(html version: `<p>Tu solicitud de asociación fue recibida. <strong>Todavía no sos socio/a</strong>: la va a resolver la Comisión Directiva en su próxima reunión y te avisamos el resultado por este medio.</p>`.) Its docstring: `/** Rama sin débito (adherente que no adhiere): la CD la resuelve en reunión. */`. Also update the section comment above both functions: "la ACEPTADA" → "el ACUSE con pago".

- [ ] **Step 10.4:** In `tests/mp-webhook-processor.test.ts` line ~406, rename the test title only: `"si el ingreso no se puede asentar, la solicitud queda aceptada y la bienvenida sale igual"` → `"si el ingreso no se puede asentar, la solicitud avanza igual y el acuse sale igual"`. Touch nothing else in that file.

- [ ] **Step 10.5:** Run: `npx vitest run tests/application-emails.test.ts tests/mp-webhook-processor.test.ts` → PASS. Full suite → green. Verify with `git diff --stat` that `src/lib/mp/` shows NO changes.
- [ ] **Step 10.6: Commit** — `feat(emails): payment acknowledgement replaces premature acceptance email`

---

### Task 11: Admin queue label

**Files:**
- Modify: `src/lib/applications/labels.ts` (line 9)

- [ ] **Step 11.1:** `grep -rn "Aceptada — pendiente" src tests` → confirm the only hit is `labels.ts:9` (if a test pins it, update that one assertion too and say so in the commit).
- [ ] **Step 11.2:** Change: `approved_pending_minute: "Aceptada — pendiente de acta",` → `approved_pending_minute: "Completa — pendiente de resolución",`
- [ ] **Step 11.3:** `npx vitest run` → green. **Commit** — `fix(admin): approved_pending_minute label says complete, not accepted`

---

### Task 12: Entry-receipt admission legend (PDF + email) — CAREFUL ZONE

**Files:**
- Modify: `src/lib/email/templates.ts` (`receiptEmail` — additive param)
- Modify: `src/lib/treasury/receipt-email.ts` (pass the flag)
- Modify: `src/lib/treasury/receipt-pdf.ts` (`ReceiptPdfData.admissionPending?`, one footer line)
- Modify: `src/lib/treasury/service.ts` (`pdfDataFor` sets the flag)
- Test: extend `tests/treasury-receipt-pdf.test.ts`, `tests/treasury-receipt-email.test.ts`

**Interfaces:**
- Produces: `receiptEmail(opts)` gains optional `admissionPending?: boolean`; `ReceiptPdfData` gains optional `admissionPending?: boolean`. Both default absent → EXACTLY today's output.
- Legend text (spec §6.4, verbatim): `Este comprobante acredita el pago de la cuota de ingreso. No acredita la condición de socio/a, que se adquiere con la resolución de la Comisión Directiva asentada en acta.`
- Condition: the receipt hangs off an Application with no Member — i.e. the exact `sendToApplication` branch in `receipt-email.ts` and `!member && r.payment.application` in `pdfDataFor`. Entry receipts post-acta (memberId backfilled) get NO legend.

- [ ] **Step 12.1: Write the failing tests.** In `tests/treasury-receipt-email.test.ts`, extend the existing `"pago de ingreso sin socio → va por sendToApplication con el PDF"` test (it already captures `call`):

```ts
expect(call.message.text).toContain("No acredita la condición de socio/a");
```

and add to the member-path test (the one asserting `sendToApplication` NOT called): capture the `sendToMember` call and assert:

```ts
expect(memberCall.message.text).not.toContain("No acredita la condición de socio/a");
```

In `tests/treasury-receipt-pdf.test.ts`, add using the existing `drawnText`/`base` helpers:

```ts
it("recibo de ingreso sin socio: leyenda de admisión pendiente; con socio: no", async () => {
  const con = await drawnText(await renderReceiptPdf({ ...base, memberNumber: null, admissionPending: true }));
  const sin = await drawnText(await renderReceiptPdf(base));
  const all = (texts: { text: string }[]) => texts.map((t) => t.text).join(" ");
  expect(all(con)).toContain("asentada en acta");
  expect(all(sin)).not.toContain("asentada en acta");
});
```

(Adapt to the file's actual helper names — read its top 60 lines first; `drawnText` and a `base` fixture exist.)

- [ ] **Step 12.2:** Run: `npx vitest run tests/treasury-receipt-pdf.test.ts tests/treasury-receipt-email.test.ts` → FAIL (type + content).

- [ ] **Step 12.3: Implement — four small edits.**

`templates.ts` `receiptEmail`: signature → `opts: { name: string; number: string; concept: string; amount: number; admissionPending?: boolean }`. Build the extra paragraph once:

```ts
const admission = opts.admissionPending
  ? "\n\nEste comprobante acredita el pago de la cuota de ingreso. No acredita la condición de socio/a, que se adquiere con la resolución de la Comisión Directiva asentada en acta."
  : "";
```

insert `${admission}` in the text right after the `Importe: ${amount}` line (before "El recibo en PDF va adjunto…"), and in the html insert, at the same position:

```ts
${opts.admissionPending ? `<p>Este comprobante acredita el pago de la cuota de ingreso. No acredita la condición de socio/a, que se adquiere con la resolución de la Comisión Directiva asentada en acta.</p>` : ""}
```

`receipt-email.ts`: in the `receiptEmail({ … })` call add `admissionPending: target.kind === "application",`.

`receipt-pdf.ts`: add `admissionPending?: boolean;` to `ReceiptPdfData`. After the existing footer line ("Comprobante interno…"), add:

```ts
if (data.admissionPending) {
  // Recibo de cuota de ingreso previo al acta (spec 2026-09-01 §6.4): el
  // comprobante no puede funcionar como constancia de admisión.
  y -= 12;
  page.drawText(safe("Acredita el pago de la cuota de ingreso. No acredita la condición de socio/a,"), {
    x: margin, y, size: 8, font, color: MUTED,
  });
  y -= 11;
  page.drawText(safe("que se adquiere con la resolución de la Comisión Directiva asentada en acta."), {
    x: margin, y, size: 8, font, color: MUTED,
  });
}
```

(the `voided` stamp block below already positions from `y` — verify it still renders by running the existing voided test.)

`service.ts` `pdfDataFor`: in the returned object add:

```ts
// Recibo colgado de la solicitud, sin ficha: la leyenda de admisión pendiente
// del PDF (spec 2026-09-01 §6.4). Post-acta el pago ya tiene member y no aplica.
admissionPending: !member && r.payment.application !== null,
```

- [ ] **Step 12.4:** Run: `npx vitest run tests/treasury-receipt-pdf.test.ts tests/treasury-receipt-email.test.ts` → PASS. **Full suite** → green: every other treasury assertion must pass UNTOUCHED (this is the no-regression guard for the careful zone).
- [ ] **Step 12.5:** `git diff --stat src/lib/treasury src/lib/mp` → only `receipt-email.ts`, `receipt-pdf.ts`, `service.ts` listed; `src/lib/mp` absent.
- [ ] **Step 12.6: Commit** — `feat(treasury): admission-pending legend on pre-acta entry receipts (pdf + email)`

---

### Task 13: Docs note + final verification

**Files:**
- Modify: `CLAUDE.md` (append to the ASOCIATE patterns section)
- No other source files.

- [ ] **Step 13.1:** Add to `CLAUDE.md`, as a new bullet under "Patrones que estrenó el paso "Tu DNI" de ASOCIATE" (or a new short section "Patrones que estrenó el rediseño de admisión de ASOCIATE"):

```markdown
- **El wizard ASOCIATE dice el proceso entero y no promete admisión.** El stepper es un
  `ProcessRail` (formulario → "La Comisión resuelve" → "Alta en acta") y las pantallas de
  estado usan `TramiteTimeline`; ninguna superficie dice "aceptada" ni "bienvenido" antes del
  acta (el acta marco de REG-12 no existe; spec 2026-09-01). `applicationAcceptedEmail` es un
  ACUSE — el nombre es histórico para no tocar el webhook. Los recibos de ingreso pre-acta
  llevan leyenda de admisión pendiente. OJO: las primitivas de ASOCIATE ahora DIVERGEN de las
  de REEMPADRONATE (decisión del 01/09/2026): ese wizard conserva el stepper viejo a propósito.
```

- [ ] **Step 13.2: Full verification battery** (spec §8):

```bash
npm test
npx tsc --noEmit
npm run build
git diff --stat main
```

Expected: suite green; tsc clean; build clean; the diff lists ONLY: `docs/superpowers/specs|plans/*`, `CLAUDE.md`, `src/components/admin/form-message.tsx`, `src/components/public/callout.tsx`, `src/app/(public)/asociate/{asociate-wizard,wizard-ui,step-residence,step-category,step-payment,application-status,page,process-rail,tramite-timeline}.tsx`, `src/lib/email/templates.ts`, `src/lib/applications/labels.ts`, `src/lib/treasury/{receipt-email,receipt-pdf,service}.ts`, and the new/edited test files. Anything else = STOP and revert it.

- [ ] **Step 13.3: Visual walkthrough** (dev server via `.claude/launch.json`, Browser pane): steps 1→6 for (a) activo, (b) adherente con débito, (c) adherente sin débito, (d) colaborador (steps 1-4 create a real LOCAL application — allowed); check rail, chips, cards, boleta, no-debit screen; mobile width (`resize_window` 375px) for the rail; console clean. The three status screens are guaranteed by Task 8's render tests; optionally flip a local application's status by SQL and open its `/asociate/retomar/<token>` link to see them live. Screenshots of: paso 2, paso 3, paso 6 (both branches), and — if flipped — post-pago.
- [ ] **Step 13.4: Commit** — `docs: CLAUDE.md pattern note for ASOCIATE admission redesign` — then STOP: merge/push is the operator's call (superpowers:finishing-a-development-branch).

---

## Self-review notes (already applied)

- Spec §5.1-§5.6 → Tasks 5-9; §4 → Tasks 1-4; §6.1-6.3 → Tasks 10-11; §6.4 → Task 12; §8 → Task 13. §5.7 (DNI/blocked panels) intentionally has no task: spec says no changes.
- Names used across tasks: `ProcessRail`, `TramiteTimeline`, `Callout`, `FormMessage kind="info"`, `nextDescribedBy`, `icon` (ChoiceCard), `admissionPending` — consistent.
- `applicationAcceptedEmail` keeps its exported name/signature by design (spec §6.1).
