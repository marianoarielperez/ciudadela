# Módulo 5 — Fase 5A: Shell, rediseño y lectura del panel de socio — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rediseñar el panel de socio `/mi` con shell propio (pestañas por URL, credencial de socio, accesibilidad completa), sumar Mis datos editable, el estatuto en PDF y la vista del suspendido en modo lectura — sin tocar el núcleo de pagos.

**Architecture:** Config de navegación pura (`src/lib/mi/nav.ts`) + componente `MiTabs` (patrón `TreasuryTabs`); `requireMember` gana la opción `allowSuspended` para el modo lectura del suspendido; la identidad/estado electoral es un módulo puro que reutiliza `src/lib/members/electoral.ts`; la autoedición reutiliza `memberWriter.updateMember` (invariantes de tokens y cuenta adentro) y `accountEmailNotice` para el cambio de email.

**Tech Stack:** Next.js 16 App Router, React 19 (`useActionState`), Prisma 7 + MariaDB, Tailwind v4 (tokens en `globals.css`), lucide-react, vitest.

**Spec:** `docs/superpowers/specs/2026-08-24-modulo-5-panel-socio-design.md` (secciones §3, §5, §8, §9, §10, §12-CA-5A).

## Global Constraints

- UI en **es-AR con "vos"**; código, variables y commits en **inglés**. Commits terminan con `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- **Targets táctiles ≥48px** en `/mi` (`min-h-12` / `size-12`; los links de texto al menos `min-h-11`). Foco: **nunca** `outline-none` — siempre `outline-hidden` + `focus-visible:ring-2 focus-visible:ring-ring`.
- **Light-only**: no montar ThemeProvider, no diseñar contra `.dark`. Colores SOLO por tokens (`--primary`, `--success`, `--warning`); prohibido verde/ámbar crudo de Tailwind y prohibidos los tokens `--sidebar-*` (identidad del admin).
- **Cada página y cada server action de `/mi` se autoriza a sí misma** con `requireMember()` — el layout corre en paralelo y NO protege.
- Matriz del suspendido (spec §5): páginas y `GET /api/mi/*` con `{ allowSuspended: true }`; la ÚNICA action que el suspendido puede ejecutar es `startMemberPaymentAction`. El cesante (`withdrawn`) queda bloqueado en todo, como hoy.
- Auditoría: en `detail` van **ids, códigos y flags** — nunca DNI, email ni domicilios (Ley 25.326).
- Migraciones **siempre** `npx prisma migrate dev` — nunca `db push`.
- **No tocar**: `src/lib/treasury/*` (salvo imports), `src/lib/mp/*`, `registerPayment`, `resolve.ts`, webhook, `AccountSection` (`src/components/admin/account-section.tsx`), ni los tests de integración del dinero.
- Tests: `npx vitest run <archivo>` para uno, `npx vitest run` para la suite. Entorno Windows/PowerShell.
- Trabajar sobre una rama `m5a-member-panel` creada desde `main`.

---

### Task 1: Config de navegación pura del panel (`src/lib/mi/nav.ts`)

**Files:**
- Create: `src/lib/mi/nav.ts`
- Test: `tests/mi-nav.test.ts`

**Interfaces:**
- Produces: `type MiTabIcon = "home" | "wallet" | "user" | "scroll-text"`, `type MiTab = { href: string; label: string; icon: MiTabIcon }`, `const MI_TABS: MiTab[]`, `isMiTabActive(pathname: string, href: string): boolean`. Los consumen `MiTabs` (Task 3) y nada más.

- [ ] **Step 1: Write the failing test**

```ts
// tests/mi-nav.test.ts
import { describe, expect, it } from "vitest";
import { isMiTabActive, MI_TABS } from "@/lib/mi/nav";

describe("MI_TABS", () => {
  it("has unique hrefs, all under /mi", () => {
    const hrefs = MI_TABS.map((t) => t.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const href of hrefs) expect(href.startsWith("/mi")).toBe(true);
  });

  it("starts at Inicio (/mi)", () => {
    expect(MI_TABS[0]).toMatchObject({ href: "/mi", label: "Inicio" });
  });
});

describe("isMiTabActive", () => {
  it("marks /mi only on the exact path (it is a prefix of everything)", () => {
    expect(isMiTabActive("/mi", "/mi")).toBe(true);
    expect(isMiTabActive("/mi/cuenta", "/mi")).toBe(false);
  });

  it("marks a section on itself and on its subroutes", () => {
    expect(isMiTabActive("/mi/cuenta", "/mi/cuenta")).toBe(true);
    expect(isMiTabActive("/mi/cuenta/algo", "/mi/cuenta")).toBe(true);
  });

  it("does not confuse sibling prefixes", () => {
    expect(isMiTabActive("/mi/cuentas-x", "/mi/cuenta")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mi-nav.test.ts`
Expected: FAIL — `Cannot find module '@/lib/mi/nav'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/mi/nav.ts
// Secciones del panel de socio. Puro y sin JSX a propósito (mismo criterio que
// src/lib/admin/nav.ts): la barra de pestañas, el marcado de sección activa y
// el test salen de esta única fuente. El mapa ícono→componente vive en el
// componente cliente (lucide no carga fuera del bundle).
//
// La fase 5A lista SOLO secciones que funcionan (la regla del shell admin:
// nada de "Próximamente" en la navegación). Débito automático y Solicitudes se
// agregan acá cuando la 5B les dé páginas reales.
export type MiTabIcon = "home" | "wallet" | "user" | "scroll-text";

export type MiTab = { href: string; label: string; icon: MiTabIcon };

export const MI_TABS: MiTab[] = [
  { href: "/mi", label: "Inicio", icon: "home" },
  { href: "/mi/cuenta", label: "Mi cuenta", icon: "wallet" },
  { href: "/mi/datos", label: "Mis datos", icon: "user" },
  { href: "/mi/estatuto", label: "Estatuto", icon: "scroll-text" },
];

// Mismo criterio que isTreasuryTabActive, con una excepción: "/mi" es prefijo
// de TODO el panel, así que Inicio sólo se marca en el match exacto.
export function isMiTabActive(pathname: string, href: string): boolean {
  if (href === "/mi") return pathname === "/mi";
  return pathname === href || pathname.startsWith(href + "/");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/mi-nav.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/mi/nav.ts tests/mi-nav.test.ts
git commit -m "feat(m5a): pure nav config for the member panel"
```

---

### Task 2: `requireMember` con `allowSuspended` (modo lectura del suspendido)

**Files:**
- Modify: `src/lib/auth/require-member.ts`
- Test: `tests/require-member.test.ts` (casos nuevos; los existentes se adaptan)

**Interfaces:**
- Produces: `requireMember(opts?: { allowSuspended?: boolean }): Promise<MemberActor>`. El actor `ok` gana el campo `suspension: { from: Date | null; to: Date | null } | null` (`null` = no suspendido). `MemberLookup` gana `suspendedFrom: Date | null; suspendedTo: Date | null`.
- Consumes: nada nuevo.

- [ ] **Step 1: Write the failing tests** (agregar al final de `tests/require-member.test.ts`; usan `makeRequireMember` directo, sin helpers del archivo)

```ts
describe("allowSuspended (M5: modo lectura del suspendido)", () => {
  const session = () => async () => ({ user: { id: "1", authAt: Date.now() } });
  const row = (over: Record<string, unknown> = {}) => ({
    id: 7, fullName: "Socia Suspendida", status: "suspended" as const,
    active: true, passwordChangedAt: null,
    suspendedFrom: new Date("2026-08-01T12:00:00Z"), suspendedTo: null,
    ...over,
  });

  it("blocks a suspended member by default (unchanged behavior)", async () => {
    const rm = makeRequireMember(session(), async () => row());
    const actor = await rm();
    expect(actor).toMatchObject({ ok: false, reason: "suspended" });
  });

  it("lets a suspended member in with allowSuspended, carrying the dates", async () => {
    const rm = makeRequireMember(session(), async () => row());
    const actor = await rm({ allowSuspended: true });
    expect(actor.ok).toBe(true);
    if (actor.ok) {
      expect(actor.suspension).toEqual({ from: new Date("2026-08-01T12:00:00Z"), to: null });
    }
  });

  it("an active member carries suspension: null", async () => {
    const rm = makeRequireMember(session(), async () =>
      row({ status: "active", suspendedFrom: null }));
    const actor = await rm({ allowSuspended: true });
    expect(actor.ok).toBe(true);
    if (actor.ok) expect(actor.suspension).toBeNull();
  });

  it("still blocks withdrawn even with allowSuspended", async () => {
    const rm = makeRequireMember(session(), async () => row({ status: "withdrawn" }));
    const actor = await rm({ allowSuspended: true });
    expect(actor).toMatchObject({ ok: false, reason: "withdrawn" });
  });

  it("still blocks a disabled account even with allowSuspended", async () => {
    const rm = makeRequireMember(session(), async () => row({ active: false }));
    const actor = await rm({ allowSuspended: true });
    expect(actor).toMatchObject({ ok: false, reason: "disabled" });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/require-member.test.ts`
Expected: FAIL — TypeScript no acepta `rm({ allowSuspended: true })` / `actor.suspension`.

- [ ] **Step 3: Implement**

En `src/lib/auth/require-member.ts`:

(a) Tipos — reemplazar `MemberActor` y agregar los nuevos:

```ts
export type RequireMemberOptions = {
  /** Deja pasar al SUSPENDIDO en modo lectura (spec M5 §5: ve su cuenta y puede
   *  pagar; ninguna otra acción). Las actions que muten datos NO pasan esta
   *  opción y siguen bloqueando. El cesante queda afuera siempre. */
  allowSuspended?: boolean;
};

export type MemberSuspension = { from: Date | null; to: Date | null };

export type MemberActor =
  | {
      ok: true;
      userId: number;
      memberId: number;
      fullName: string;
      /** `null` si el socio está vigente; con fechas si entró como suspendido
       *  vía `allowSuspended` (el banner del shell las muestra). */
      suspension: MemberSuspension | null;
    }
  | { ok: false; reason: MemberBlockReason; error: string };
```

(b) `MemberLookup` gana los dos campos (después de `passwordChangedAt`):

```ts
  suspendedFrom: Date | null;
  suspendedTo: Date | null;
```

(c) `makeRequireMember` — la función devuelta acepta `opts` y la guarda de suspendido se vuelve condicional. El orden de guardas NO cambia (withdrawn → suspended → disabled):

```ts
export function makeRequireMember(getSession: GetSession, findMemberByUserId: MemberLookup) {
  return async function requireMember(opts: RequireMemberOptions = {}): Promise<MemberActor> {
    // ... (guardas 1-5 idénticas: anonymous, not_member, stale, expired, withdrawn)
    if (member.status === "suspended" && !opts.allowSuspended) {
      return { ok: false, reason: "suspended", error: MEMBER_BLOCKED.suspended };
    }
    if (!member.active) {
      return { ok: false, reason: "disabled", error: MEMBER_BLOCKED.disabled };
    }
    return {
      ok: true,
      userId,
      memberId: member.id,
      fullName: member.fullName,
      suspension:
        member.status === "suspended"
          ? { from: member.suspendedFrom, to: member.suspendedTo }
          : null,
    };
  };
}
```

(d) La versión ligada acepta y propaga `opts`, y el `select` de Prisma suma `suspendedFrom: true, suspendedTo: true` (van en el `return` del lookup como `suspendedFrom: member.suspendedFrom, suspendedTo: member.suspendedTo`):

```ts
export async function requireMember(opts: RequireMemberOptions = {}): Promise<MemberActor> {
  const [{ auth }, { prisma }] = await Promise.all([import("@/auth"), import("@/lib/prisma")]);
  return makeRequireMember(auth, async (userId) => {
    const member = await prisma.member.findUnique({
      where: { userId },
      select: {
        id: true, fullName: true, status: true,
        suspendedFrom: true, suspendedTo: true,
        user: { select: { active: true, passwordChangedAt: true } },
      },
    });
    if (!member) return null;
    return {
      id: member.id, fullName: member.fullName, status: member.status,
      suspendedFrom: member.suspendedFrom, suspendedTo: member.suspendedTo,
      active: member.user?.active ?? false,
      passwordChangedAt: member.user?.passwordChangedAt ?? null,
    };
  })(opts);
}
```

(e) Actualizar el comentario de cabecera del archivo: la línea sobre `suspended` pasa a decir que REG-20 bloquea por defecto y que `allowSuspended` habilita el modo lectura del M5 (spec §5).

- [ ] **Step 4: Fix the existing test fakes**

Los fakes de `tests/require-member.test.ts` que construyen la fila del lookup ahora necesitan `suspendedFrom: null, suspendedTo: null`. Agregarlos donde TypeScript lo marque (buscá los objetos que devuelven `findMemberByUserId`). No cambiar ninguna aserción existente.

- [ ] **Step 5: Run the full suite** (otros tests pueden construir el actor `ok` a mano)

Run: `npx vitest run`
Expected: PASS. Si algún test construye un `MemberActor` ok literal (p. ej. mocks de `requireMember` en tests de actions o rutas), agregarle `suspension: null` — es el único cambio permitido en esos archivos.

- [ ] **Step 6: Commit**

```bash
git add src/lib/auth/require-member.ts tests
git commit -m "feat(m5a): requireMember allowSuspended option for read-mode access"
```

---

### Task 3: Shell nuevo — `MiTabs`, layout, banner de suspensión, error y not-found

**Files:**
- Create: `src/components/mi/mi-tabs.tsx`, `src/lib/mi/suspension.ts`, `src/app/mi/error.tsx`, `src/app/mi/not-found.tsx`
- Modify: `src/app/mi/layout.tsx` (reescritura completa)
- Test: `tests/mi-suspension.test.ts`

**Interfaces:**
- Consumes: `MI_TABS`, `isMiTabActive`, `MiTab`, `MiTabIcon` (Task 1); `requireMember({ allowSuspended: true })` + `actor.suspension` (Task 2); `FormMessage`, `SignOutButton`, `EmptyState`, `Button` existentes.
- Produces: `MiTabs({ tabs: MiTab[] })`; `suspensionNotice(s: { from: Date | null; to: Date | null }): string`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/mi-suspension.test.ts
import { describe, expect, it } from "vitest";
import { suspensionNotice } from "@/lib/mi/suspension";

describe("suspensionNotice", () => {
  const from = new Date("2026-08-01T12:00:00Z");
  const to = new Date("2026-09-30T12:00:00Z");

  it("names both dates when it has them", () => {
    const text = suspensionNotice({ from, to });
    expect(text).toContain("del 01/08/2026 al 30/09/2026");
    expect(text).toContain("Art. 10");
    expect(text).toContain("pagar");
  });

  it("handles an open-ended suspension", () => {
    expect(suspensionNotice({ from, to: null })).toContain("desde el 01/08/2026");
    expect(suspensionNotice({ from: null, to })).toContain("hasta el 30/09/2026");
  });

  it("works without dates at all", () => {
    const text = suspensionNotice({ from: null, to: null });
    expect(text).toContain("suspendida");
    expect(text).not.toContain("del ");
  });
});
```

Run: `npx vitest run tests/mi-suspension.test.ts` → FAIL (módulo inexistente).

- [ ] **Step 2: Implement `suspensionNotice`**

```ts
// src/lib/mi/suspension.ts
// El banner del suspendido (spec M5 §5, la resolución de docs/02 REG-20 vs
// docs/05 §7): puede VER y PAGAR; todo lo demás está deshabilitado. El texto
// vive acá —puro— y no en el layout, para poder testear los cuatro casos de
// fechas sin renderizar nada.
import { formatDateAR } from "@/lib/format";

export function suspensionNotice(s: { from: Date | null; to: Date | null }): string {
  const range =
    s.from && s.to
      ? ` del ${formatDateAR(s.from)} al ${formatDateAR(s.to)}`
      : s.from
        ? ` desde el ${formatDateAR(s.from)}`
        : s.to
          ? ` hasta el ${formatDateAR(s.to)}`
          : "";
  return (
    `Tu condición de socio está suspendida${range} (Art. 10). ` +
    "Podés consultar tu cuenta, tus recibos y pagar tus cuotas; el resto de las acciones está deshabilitado."
  );
}
```

Run: `npx vitest run tests/mi-suspension.test.ts` → PASS. (Si `formatDateAR` formatea distinto, ajustar las aserciones al formato real DD/MM/AAAA de `src/lib/format.ts` — nunca la función a las aserciones.)

- [ ] **Step 3: `MiTabs`**

```tsx
// src/components/mi/mi-tabs.tsx
"use client";
// Pestañas por URL del panel de socio (mismo criterio que TreasuryTabs: links,
// no botones — deep-link, botón atrás y aria-current gratis). Targets de 48px:
// acá se navega con el pulgar. El -my-1/py-1 evita que overflow-x-auto recorte
// el anillo de foco (la trampa documentada en treasury-tabs.tsx).
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, ScrollText, User, Wallet } from "lucide-react";

import { isMiTabActive, type MiTab, type MiTabIcon } from "@/lib/mi/nav";
import { cn } from "@/lib/utils";

const ICONS: Record<MiTabIcon, React.ComponentType<{ className?: string }>> = {
  home: Home,
  wallet: Wallet,
  user: User,
  "scroll-text": ScrollText,
};

export function MiTabs({ tabs }: { tabs: MiTab[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Secciones del panel" className="-mx-4 -my-1 overflow-x-auto px-4 py-1">
      <ul className="flex min-w-max gap-1">
        {tabs.map((tab) => {
          const active = isMiTabActive(pathname, tab.href);
          const Icon = ICONS[tab.icon];
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-12 items-center gap-1.5 border-b-2 px-3 text-sm outline-hidden transition-colors",
                  "focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "border-primary font-semibold text-foreground"
                    : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
                )}
              >
                <Icon className="size-4 shrink-0 opacity-80" aria-hidden />
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

- [ ] **Step 4: Rewrite the layout** (reemplaza `src/app/mi/layout.tsx` entero)

```tsx
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";

import { FormMessage } from "@/components/admin/form-message";
import { SignOutButton } from "@/components/admin/sign-out-button";
import { MiTabs } from "@/components/mi/mi-tabs";
import { requireMember } from "@/lib/auth/require-member";
import { MI_TABS } from "@/lib/mi/nav";
import { suspensionNotice } from "@/lib/mi/suspension";

function Shell({
  children,
  banner,
  showTabs = true,
}: {
  children: React.ReactNode;
  banner?: React.ReactNode;
  showTabs?: boolean;
}) {
  return (
    <div className="min-h-screen bg-secondary/40">
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
      >
        Saltar al contenido
      </a>
      <header className="border-b-4 border-primary bg-background">
        <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-4 px-4 pt-3 pb-1">
          <Link
            href="/mi"
            className="flex min-h-12 items-center gap-3 rounded-md outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          >
            {/* El texto de al lado ya nombra a la institución: alt="" como en
                site-header.tsx. */}
            <Image src="/logo-header.png" alt="" width={40} height={40} sizes="40px" className="h-9 w-auto" />
            <span className="leading-tight">
              <span className="block font-semibold">Vecinal Ciudadela</span>
              <span className="block text-xs text-muted-foreground">Panel de socio</span>
            </span>
          </Link>
          <SignOutButton />
        </div>
        {showTabs && (
          <div className="mx-auto w-full max-w-2xl px-4">
            <MiTabs tabs={MI_TABS} />
          </div>
        )}
      </header>
      <main id="contenido" tabIndex={-1} className="mx-auto w-full max-w-2xl space-y-4 p-4 outline-hidden">
        {banner}
        {children}
      </main>
    </div>
  );
}

export default async function MiLayout({ children }: { children: React.ReactNode }) {
  // La autorización real vive en cada página y cada action (el layout corre en
  // paralelo y no las protege). Acá sólo se decide el chrome. El suspendido
  // entra en modo lectura (spec M5 §5) y su banner vive acá para que TODAS las
  // secciones lo muestren sin repetirlo.
  const actor = await requireMember({ allowSuspended: true });
  if (actor.ok) {
    const banner = actor.suspension ? (
      <FormMessage kind="warning" box>
        {suspensionNotice(actor.suspension)}
      </FormMessage>
    ) : undefined;
    return <Shell banner={banner}>{children}</Shell>;
  }

  // Sin sesión: al login. Con sesión pero sin habilitación NO se puede
  // redirigir a /ingresar (rebote infinito /ingresar → /redirigir → /mi por el
  // rol del token): se explica el motivo y se ofrece salir. Sin pestañas: no se
  // le muestra el mapa del panel a quien no está habilitado (mismo criterio que
  // el layout admin).
  if (actor.reason === "anonymous") redirect("/ingresar");
  return (
    <Shell showTabs={false}>
      <div className="space-y-3 rounded-xl border bg-background p-4">
        <h1 className="text-xl font-bold">Tu panel no está disponible</h1>
        <FormMessage kind="error">{actor.error}</FormMessage>
      </div>
    </Shell>
  );
}
```

- [ ] **Step 5: `error.tsx` y `not-found.tsx`**

```tsx
// src/app/mi/error.tsx
"use client";
// Frontera de error propia de /mi: sin ella un fallo de render cae al chrome
// global, fuera del shell del socio (hueco anotado en el análisis del M5).
import { FormMessage } from "@/components/admin/form-message";
import { Button } from "@/components/ui/button";

export default function MiError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="space-y-4 rounded-xl border bg-background p-4">
      <h1 className="text-xl font-bold">Algo salió mal</h1>
      <FormMessage kind="error">
        No pudimos mostrar esta sección. Probá de nuevo; si sigue pasando, avisanos en la sede.
      </FormMessage>
      <Button className="min-h-12" onClick={reset}>
        Reintentar
      </Button>
    </div>
  );
}
```

```tsx
// src/app/mi/not-found.tsx
import Link from "next/link";
import { EmptyState } from "@/components/admin/empty-state";
import { Button } from "@/components/ui/button";

export default function MiNotFound() {
  return (
    <EmptyState
      description="Esa página no existe en tu panel."
      action={
        <Button asChild className="min-h-12">
          <Link href="/mi">Volver al inicio</Link>
        </Button>
      }
    />
  );
}
```

- [ ] **Step 6: Verify**

Run: `npx vitest run` → PASS. Después `npm run build` → compila sin errores. Arrancar `npm run dev`, entrar a `/mi` logueado como socio de prueba: header nuevo con logo, 4 pestañas con ícono, skip link con Tab, pestaña activa marcada.

- [ ] **Step 7: Commit**

```bash
git add src/app/mi src/components/mi src/lib/mi tests/mi-suspension.test.ts
git commit -m "feat(m5a): member panel shell — URL tabs, skip link, error boundaries, suspension banner"
```

---

### Task 4: Cablear `allowSuspended` en páginas, API y la action de pago

**Files:**
- Modify: `src/app/mi/page.tsx:40`, `src/app/mi/cuenta/page.tsx:23`, `src/app/api/mi/recibos/[id]/route.ts:26`, `src/app/mi/cuenta/actions.ts:36`

**Interfaces:**
- Consumes: `requireMember({ allowSuspended: true })` (Task 2).
- Produces: nada nuevo — cambia QUIÉN llega a lo existente.

- [ ] **Step 1: Update the four call sites**

En los cuatro archivos, `await requireMember()` pasa a `await requireMember({ allowSuspended: true })`. En `actions.ts` actualizar además el comentario de la línea 34-35:

```ts
  // Resuelve contra la fila viva. El SUSPENDIDO sí llega: pagar es la única
  // action que el modo lectura le permite (spec M5 §5 — saldar deuda lo acerca
  // a la rehabilitación). Un socio dado de baja no llega nunca.
  const actor = await requireMember({ allowSuspended: true });
```

- [ ] **Step 2: Run the suite and adapt only what breaks**

Run: `npx vitest run`
Expected: los tests que mockean `requireMember` (p. ej. `tests/receipt-routes.test.ts`, `tests/member-pay-action.test.ts`) pueden fallar por el shape del actor. Regla de adaptación: los mocks de actor `ok` ganan `suspension: null`; el caso "403 a suspendido" del recibo pasa a documentar el modo lectura — el mock devuelve `{ ok: true, ..., suspension: { from: null, to: null } }` y espera **200 con el PDF propio** (el cesante conserva su 403). No cambiar la lógica de las rutas.

- [ ] **Step 3: Commit**

```bash
git add src/app/mi src/app/api/mi tests
git commit -m "feat(m5a): suspended members reach their panel read-only and can pay (REG-20 amendment)"
```

---

### Task 5: Identidad y estado electoral del socio (módulo puro)

**Files:**
- Create: `src/lib/mi/identity.ts`
- Test: `tests/mi-identity.test.ts`

**Interfaces:**
- Consumes: `ELECTORAL_CATEGORIES`, `ELECTORAL_MIN_DAYS`, `meetsSeniority`, `seniorityDays` de `@/lib/members/electoral`; `ACCRUING_CATEGORIES` de `@/lib/treasury/rules`.
- Produces: `type ElectoralStatus` (unión discriminada), `electoralStatusFor(input): ElectoralStatus`, `electoralSentence(s: ElectoralStatus): string`. Los consume `MemberCard` (Task 6).

- [ ] **Step 1: Write the failing test**

```ts
// tests/mi-identity.test.ts
import { describe, expect, it } from "vitest";
import { electoralSentence, electoralStatusFor } from "@/lib/mi/identity";

const at = new Date("2026-08-24T12:00:00Z");
const oldEnough = new Date("2025-01-01T12:00:00Z");
const recent = new Date("2026-08-01T12:00:00Z"); // 23 días al 24/08

const base = { status: "active" as const, joinedAt: oldEnough, arrears: 0, at };

describe("electoralStatusFor", () => {
  it("an old active member without arrears is eligible", () => {
    expect(electoralStatusFor({ ...base, category: "active" })).toEqual({ eligible: true });
  });

  it("a cadet is out by category", () => {
    expect(electoralStatusFor({ ...base, category: "cadet" })).toEqual({
      eligible: false, reason: "category",
    });
  });

  it("a suspended member does not vote (operator decision 23/08)", () => {
    expect(electoralStatusFor({ ...base, category: "active", status: "suspended" })).toEqual({
      eligible: false, reason: "suspended",
    });
  });

  it("a recent member is missing seniority days", () => {
    const s = electoralStatusFor({ ...base, category: "adherent", joinedAt: recent });
    expect(s).toEqual({ eligible: false, reason: "seniority", daysMissing: 67 });
  });

  it("honorary and lifetime skip the seniority floor (REG-30)", () => {
    expect(electoralStatusFor({ ...base, category: "honorary", joinedAt: recent })).toEqual({
      eligible: true,
    });
    expect(electoralStatusFor({ ...base, category: "lifetime", joinedAt: recent })).toEqual({
      eligible: true,
    });
  });

  it("arrears block actives and collaborators only", () => {
    expect(electoralStatusFor({ ...base, category: "active", arrears: 2 })).toEqual({
      eligible: false, reason: "arrears", arrears: 2,
    });
    expect(electoralStatusFor({ ...base, category: "collaborator", arrears: 1 })).toEqual({
      eligible: false, reason: "arrears", arrears: 1,
    });
    // El aporte del adherente es voluntario: su deuda no le quita el voto.
    expect(electoralStatusFor({ ...base, category: "adherent", arrears: 5 })).toEqual({
      eligible: true,
    });
  });
});

describe("electoralSentence", () => {
  it("has a sentence for every state", () => {
    expect(electoralSentence({ eligible: true })).toContain("Habilitado");
    expect(electoralSentence({ eligible: false, reason: "seniority", daysMissing: 10 })).toContain("10");
    expect(electoralSentence({ eligible: false, reason: "arrears", arrears: 3 })).toContain("al día");
    expect(electoralSentence({ eligible: false, reason: "category" })).toBeTruthy();
    expect(electoralSentence({ eligible: false, reason: "suspended" })).toBeTruthy();
  });
});
```

Run: `npx vitest run tests/mi-identity.test.ts` → FAIL.

- [ ] **Step 2: Implement**

```ts
// src/lib/mi/identity.ts
// El estado electoral de UN socio para su credencial (spec M5 §9). REUTILIZA
// las piezas del padrón electoral de 4C (src/lib/members/electoral.ts) en vez
// de reimplementar la regla: si REG-31 cambia, cambia en un solo lugar.
//
// La definición de `arrears` es la MISMA del padrón: cuotas pendientes de
// períodos ANTERIORES al mes en curso (mora, no "al cobro"). El llamador la
// cuenta con `fee.count({ status: "pending", period: { lt: currentPeriod() } })`.
import type { MemberCategory, MemberStatus } from "@/generated/prisma/client";
import {
  ELECTORAL_CATEGORIES,
  ELECTORAL_MIN_DAYS,
  meetsSeniority,
  seniorityDays,
} from "@/lib/members/electoral";
import { ACCRUING_CATEGORIES } from "@/lib/treasury/rules";

export type ElectoralStatus =
  | { eligible: true }
  | { eligible: false; reason: "category" }
  | { eligible: false; reason: "suspended" }
  | { eligible: false; reason: "seniority"; daysMissing: number }
  | { eligible: false; reason: "arrears"; arrears: number };

export function electoralStatusFor(input: {
  category: MemberCategory;
  status: MemberStatus;
  joinedAt: Date;
  arrears: number;
  at: Date;
}): ElectoralStatus {
  if (!ELECTORAL_CATEGORIES.includes(input.category)) {
    return { eligible: false, reason: "category" };
  }
  // El suspendido no vota (decisión del operador del 23/08/2026, espejo de
  // buildElectoralRoll, que sólo considera `status: "active"`).
  if (input.status !== "active") return { eligible: false, reason: "suspended" };
  if (!meetsSeniority(input.category, input.joinedAt, input.at)) {
    return {
      eligible: false,
      reason: "seniority",
      daysMissing: ELECTORAL_MIN_DAYS - seniorityDays(input.joinedAt, input.at),
    };
  }
  // "Sin mora" es requisito sólo de activos y colaboradores (REG-31).
  if (input.arrears > 0 && (ACCRUING_CATEGORIES as readonly MemberCategory[]).includes(input.category)) {
    return { eligible: false, reason: "arrears", arrears: input.arrears };
  }
  return { eligible: true };
}

/** La frase de la credencial (es-AR, de cara al socio). */
export function electoralSentence(s: ElectoralStatus): string {
  if (s.eligible) return "Habilitado para votar en las elecciones de la vecinal.";
  switch (s.reason) {
    case "category":
      return "Tu categoría no participa de las elecciones de la vecinal.";
    case "suspended":
      return "Mientras dure la suspensión no participás de las elecciones.";
    case "seniority":
      return `Vas a poder votar cuando cumplas ${ELECTORAL_MIN_DAYS} días de antigüedad (te faltan ${s.daysMissing}).`;
    case "arrears":
      return "Registrás cuotas pendientes: para votar tenés que estar al día. Podés ponerte al día incluso el día de la elección.";
  }
}
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/mi-identity.test.ts` → PASS. (Si `daysMissing` da 67±1, verificar el cálculo contra `seniorityDays` — floor de días de 86.400.000 ms — y corregir la ASERCIÓN, no la función.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/mi/identity.ts tests/mi-identity.test.ts
git commit -m "feat(m5a): per-member electoral status derived from the 4C electoral roll rules"
```

---

### Task 6: La credencial de socio y el Inicio nuevo

**Files:**
- Create: `src/components/mi/member-card.tsx`
- Modify: `src/app/mi/page.tsx` (reescritura completa)

**Interfaces:**
- Consumes: `electoralStatusFor`, `electoralSentence`, `ElectoralStatus` (Task 5); `CATEGORY_LABELS` de `@/lib/members/labels`; `formatARS`, `formatDateAR` de `@/lib/format`; `categoryPaysFee`, `debtAmount`, `ACCRUING_CATEGORIES` de `@/lib/treasury/rules`; `currentPeriod` de `@/lib/treasury/periods`; `feeValueReader` de `@/lib/treasury/fee-values`; `requireMember({ allowSuspended: true })`.
- Produces: `MemberCard({ fullName, memberNumber, category, joinedAt, electoral })` (server component).

- [ ] **Step 1: `MemberCard`** — la pieza firma del panel (spec §3.3)

```tsx
// src/components/mi/member-card.tsx
// La credencial de socio: la pieza firma del panel (spec M5 §3.3). Franja de la
// foto aérea del barrio con overlay al estilo del hero público, y encima los
// datos que el socio no veía en ningún lado: su número del libro abierto, su
// categoría, su antigüedad y si está habilitado para votar (REG-31).
import Image from "next/image";
import { Vote } from "lucide-react";

import heroImg from "../../../assets/hero.jpg";
import { Badge } from "@/components/ui/badge";
import type { MemberCategory } from "@/generated/prisma/client";
import { formatDateAR } from "@/lib/format";
import { CATEGORY_LABELS } from "@/lib/members/labels";
import { electoralSentence, type ElectoralStatus } from "@/lib/mi/identity";
import { cn } from "@/lib/utils";

export function MemberCard(props: {
  fullName: string;
  memberNumber: number | null;
  category: MemberCategory;
  joinedAt: Date;
  electoral: ElectoralStatus;
}) {
  return (
    <section
      aria-label="Credencial de socio"
      className="overflow-hidden rounded-2xl bg-card ring-1 ring-foreground/10"
    >
      <div className="relative h-24">
        <Image
          src={heroImg}
          alt=""
          fill
          priority
          placeholder="blur"
          sizes="672px"
          className="object-cover"
        />
        {/* Overlay negro como el hero público (contraste calibrado allá): el
            eyebrow blanco apoya sobre la parte más oscura. */}
        <div className="absolute inset-0 flex items-end bg-[linear-gradient(to_top,rgb(0_0_0/0.72)_0%,rgb(0_0_0/0.35)_55%,rgb(0_0_0/0.05)_100%)] p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white">
            Vecinal Ciudadela · Credencial de socio
          </p>
        </div>
      </div>
      <div className="space-y-3 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-mono text-3xl font-bold tabular-nums text-primary">
            {props.memberNumber !== null ? `N° ${props.memberNumber}` : "N° —"}
          </p>
          <Badge variant="secondary">{CATEGORY_LABELS[props.category]}</Badge>
        </div>
        <div>
          <p className="text-lg font-semibold leading-tight">{props.fullName}</p>
          <p className="text-sm text-muted-foreground">
            {/* REG-29: la antigüedad nunca se reinicia — joinedAt es el original. */}
            Socio desde el {formatDateAR(props.joinedAt)}
          </p>
        </div>
        <p className="flex items-start gap-2 text-sm">
          <Vote
            aria-hidden
            className={cn(
              "mt-0.5 size-4 shrink-0",
              props.electoral.eligible ? "text-success" : "text-muted-foreground",
            )}
          />
          <span>{electoralSentence(props.electoral)}</span>
        </p>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Rewrite `/mi`** (reemplaza `src/app/mi/page.tsx` entero)

```tsx
import Link from "next/link";
import { ScrollText, User, Wallet } from "lucide-react";

import { MemberCard } from "@/components/mi/member-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireMember } from "@/lib/auth/require-member";
import { formatARS } from "@/lib/format";
import { electoralStatusFor } from "@/lib/mi/identity";
import { prisma } from "@/lib/prisma";
import { feeValueReader } from "@/lib/treasury/fee-values";
import { currentPeriod } from "@/lib/treasury/periods";
import { ACCRUING_CATEGORIES, categoryPaysFee, debtAmount } from "@/lib/treasury/rules";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mi panel — Vecinal Ciudadela" };

const LINK_CTA =
  "inline-flex min-h-11 items-center text-sm font-medium text-primary outline-hidden hover:underline focus-visible:ring-2 focus-visible:ring-ring";

function QuickLink(props: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  description: string;
}) {
  const Icon = props.icon;
  return (
    <Link
      href={props.href}
      className="flex min-h-24 flex-col justify-between rounded-xl bg-card p-4 ring-1 ring-foreground/10 outline-hidden transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Icon className="size-5 text-primary" aria-hidden />
      <span>
        <span className="block text-sm font-semibold">{props.label}</span>
        <span className="block text-xs text-muted-foreground">{props.description}</span>
      </span>
    </Link>
  );
}

export default async function MiHomePage() {
  // La página se autoriza sola (el layout corre en paralelo y no la protege).
  const actor = await requireMember({ allowSuspended: true });
  if (!actor.ok) return null; // el layout ya explica por qué
  const [member, pendingCount, arrears, feeValue] = await Promise.all([
    prisma.member.findUniqueOrThrow({
      where: { id: actor.memberId },
      select: {
        fullName: true,
        category: true,
        status: true,
        joinedAt: true,
        memberships: { select: { memberNumber: true, book: { select: { status: true } } } },
      },
    }),
    prisma.fee.count({ where: { memberId: actor.memberId, status: "pending" } }),
    // Mora electoral: pendientes ANTERIORES al mes en curso (misma definición
    // que el padrón de 4C — la cuota del mes corriente no es mora).
    prisma.fee.count({
      where: { memberId: actor.memberId, status: "pending", period: { lt: currentPeriod() } },
    }),
    feeValueReader.current(),
  ]);
  // El número vigente es el del libro ABIERTO (mismo criterio que Deudores).
  const memberNumber =
    member.memberships.find((m) => m.book.status === "open")?.memberNumber ?? null;
  const electoral = electoralStatusFor({
    category: member.category,
    status: member.status,
    joinedAt: member.joinedAt,
    arrears,
    at: new Date(),
  });
  const paysFee = categoryPaysFee(member.category);
  const accrues = (ACCRUING_CATEGORIES as readonly string[]).includes(member.category);
  const debt = feeValue ? debtAmount(pendingCount, member.category, feeValue) : null;

  return (
    <div className="space-y-4">
      <h1 className="sr-only">Inicio</h1>
      <MemberCard
        fullName={member.fullName}
        memberNumber={memberNumber}
        category={member.category}
        joinedAt={member.joinedAt}
        electoral={electoral}
      />

      <Card>
        <CardHeader>
          <CardTitle as="h2" className="flex items-center gap-2">
            <Wallet className="size-4 text-primary" aria-hidden />
            Mi cuenta
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!paysFee ? (
            <p className="text-sm text-muted-foreground">Tu categoría no paga cuota.</p>
          ) : pendingCount > 0 ? (
            <p className="text-sm font-medium text-warning">
              Debés {pendingCount} {pendingCount === 1 ? "cuota" : "cuotas"}
              {debt !== null && <> · {formatARS(debt)} a valor vigente</>}
            </p>
          ) : accrues ? (
            <p className="text-sm font-medium text-success">Estás al día.</p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Tu aporte es voluntario: no tenés cuotas pendientes.
            </p>
          )}
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            <Link className={LINK_CTA} href="/mi/cuenta">
              Ver mi cuenta →
            </Link>
            {paysFee && feeValue && (
              <Link className={LINK_CTA} href="/mi/cuenta#pagar">
                Pagar ahora →
              </Link>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-4">
        <QuickLink href="/mi/datos" icon={User} label="Mis datos" description="Tu ficha del padrón" />
        <QuickLink href="/mi/estatuto" icon={ScrollText} label="Estatuto" description="El texto completo en PDF" />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify**

`npx vitest run` → PASS. `npm run dev`, entrar a `/mi`: credencial con foto, número mono grande, badge de categoría, frase electoral; tarjeta de cuenta con el estado correcto según el socio de prueba. Verificar en 375px que nada desborda (la credencial es una columna).

- [ ] **Step 4: Commit**

```bash
git add src/components/mi/member-card.tsx src/app/mi/page.tsx
git commit -m "feat(m5a): member credential card and new panel home"
```

---

### Task 7: Restyle de Mi cuenta + chips de filtro por año

**Files:**
- Modify: `src/app/mi/cuenta/page.tsx`

**Interfaces:**
- Consumes: todo lo ya importado por la página; `cn` de `@/lib/utils`.
- Produces: nada nuevo (la página no exporta).

**Restricción dura:** NO tocar `AccountSection`, `PayForm` ni `ReturnNotice`. El filtro se hace pasando una copia filtrada de `account.payments`; el resumen, la cinta y `hasRecentLinkPayment` se calculan SIEMPRE sobre el account completo.

- [ ] **Step 1: Edit the page**

Cambios sobre `src/app/mi/cuenta/page.tsx` (el resto queda igual):

1. Borrar el link `← Inicio` (líneas 65-67) — las pestañas ya navegan.
2. Agregar `import { cn } from "@/lib/utils";` y el componente local `YearChip` arriba del `export default`:

```tsx
function YearChip(props: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={props.href}
      scroll={false}
      aria-current={props.active ? "true" : undefined}
      className={cn(
        "inline-flex min-h-11 items-center rounded-full border px-4 text-sm outline-hidden transition-colors",
        "focus-visible:ring-2 focus-visible:ring-ring",
        props.active
          ? "border-primary bg-primary/10 font-semibold text-primary"
          : "border-border text-muted-foreground hover:text-foreground",
      )}
    >
      {props.children}
    </Link>
  );
}
```

3. Después de calcular `justPaidByLink`/`latestPaymentId` (líneas 55-56) — o sea, SOBRE EL ACCOUNT COMPLETO — agregar:

```tsx
  // Chips de filtro por año del libro de pagos (spec M5 §3.3). El filtro es por
  // URL (?anio=): server-rendered, sin estado de cliente. Sólo filtra la TABLA
  // de pagos: el resumen y la cinta siempre muestran la cuenta entera.
  const years = [...new Set(account.payments.map((p) => p.paidAt.getFullYear()))].sort(
    (a, b) => b - a,
  );
  const anioRaw = Array.isArray(sp.anio) ? sp.anio[0] : sp.anio;
  const anio = anioRaw && /^\d{4}$/.test(anioRaw) ? Number(anioRaw) : null;
  const visibleAccount =
    anio === null
      ? account
      : { ...account, payments: account.payments.filter((p) => p.paidAt.getFullYear() === anio) };
```

4. En el JSX: el `<AccountSection ... account={account} ...>` pasa a `account={visibleAccount}`, y la caja que lo envuelve cambia `rounded-xl border bg-background p-4` por `rounded-xl bg-card p-4 ring-1 ring-foreground/10` (la superficie de `Card`, para que toda la pantalla comparta el mismo relieve). Inmediatamente ANTES de esa caja, los chips (sólo con 2+ años):

```tsx
      {years.length > 1 && (
        <nav aria-label="Filtrar pagos por año" className="flex flex-wrap gap-2">
          <YearChip href="/mi/cuenta" active={anio === null}>
            Todos
          </YearChip>
          {years.map((y) => (
            <YearChip key={y} href={`/mi/cuenta?anio=${y}`} active={anio === y}>
              {y}
            </YearChip>
          ))}
        </nav>
      )}
```

- [ ] **Step 2: Verify**

`npx vitest run` → PASS. En el navegador con un socio con pagos en 2+ años (sembrar en dev si hace falta): los chips aparecen, `?anio=2026` filtra la tabla, "Todos" la restaura, el resumen "Debés N" no cambia al filtrar, y `#pagar` sigue funcionando desde el Inicio.

- [ ] **Step 3: Commit**

```bash
git add src/app/mi/cuenta/page.tsx
git commit -m "feat(m5a): account page restyle with year filter chips"
```

---

### Task 8: Migración `addressPendingReview` + lista blanca de autoedición

**Files:**
- Modify: `prisma/schema.prisma:196` (después de `neighborhood`)
- Create: `src/lib/members/self-edit.ts`, migración Prisma
- Test: `tests/member-self-edit.test.ts`

**Interfaces:**
- Produces: campo `Member.addressPendingReview: boolean`; `selfContactSchema`, `selfAddressSchema`, `selfEmailSchema` (zod), `buildSelfAddressPatch(d: SelfAddressInput): SelfAddressPatch`. Los consumen las actions de Task 9/10 y la ficha admin.

- [ ] **Step 1: Schema + migration**

En `prisma/schema.prisma`, después de la línea de `neighborhood` en `model Member`:

```prisma
  /// Prendido cuando el SOCIO edita su domicilio desde /mi/datos (M5): queda
  /// "pendiente de constatación" para la CD (docs/05 §7), que lo apaga desde la
  /// ficha. El modo carga del admin NO lo toca.
  addressPendingReview Boolean @default(false) @map("address_pending_review")
```

Run: `npx prisma migrate dev --name member_address_pending_review`
Expected: migración creada y aplicada (Docker con MariaDB corriendo); `prisma generate` regenera el cliente.

- [ ] **Step 2: Write the failing test**

```ts
// tests/member-self-edit.test.ts
import { describe, expect, it } from "vitest";
import { buildSelfAddressPatch, selfAddressSchema } from "@/lib/members/self-edit";

describe("buildSelfAddressPatch", () => {
  it("catalog street wins and clears the free text (single source of truth)", () => {
    const patch = buildSelfAddressPatch({ streetId: 3, streetText: "otra", streetNumber: "123" });
    expect(patch).toEqual({
      streetId: 3, streetText: null, streetNumber: "123", neighborhood: null,
      addressPendingReview: true,
    });
  });

  it("free text without catalog id is kept", () => {
    const patch = buildSelfAddressPatch({ streetText: "Ruta 3 km 5", neighborhood: "Otro" });
    expect(patch).toMatchObject({ streetId: null, streetText: "Ruta 3 km 5", neighborhood: "Otro" });
  });

  it("always flags the address as pending review", () => {
    expect(buildSelfAddressPatch({}).addressPendingReview).toBe(true);
  });

  it("empty strings become null, never empty text", () => {
    const patch = buildSelfAddressPatch({ streetText: "  ", streetNumber: "", neighborhood: " " });
    expect(patch).toMatchObject({ streetText: null, streetNumber: null, neighborhood: null });
  });
});

describe("selfAddressSchema", () => {
  it("caps lengths like the card editor", () => {
    expect(selfAddressSchema.safeParse({ streetText: "x".repeat(121) }).success).toBe(false);
    expect(selfAddressSchema.safeParse({ streetNumber: "12345678901" }).success).toBe(false);
  });
});
```

Run: `npx vitest run tests/member-self-edit.test.ts` → FAIL.

- [ ] **Step 3: Implement**

```ts
// src/lib/members/self-edit.ts
// Lista blanca de la AUTOEDICIÓN del socio (/mi/datos, spec M5 §8). Espejo
// chico de card-edit.ts: el socio edita MENOS que el modo carga (teléfono,
// domicilio, email) y lo que no está acá no se escribe aunque viaje en el
// FormData. Los límites de longitud son los MISMOS del cardSchema: dos
// pantallas escribiendo el mismo campo con topes distintos es un conflicto en
// diferido.
import { z } from "zod";

export const selfContactSchema = z.object({
  phone: z.string().max(40, "El teléfono no puede superar los 40 caracteres").optional(),
});

export const selfAddressSchema = z.object({
  streetId: z.coerce.number().int().positive("Calle inválida.").optional(),
  streetText: z.string().max(120, "La calle no puede superar los 120 caracteres").optional(),
  streetNumber: z.string().max(10, "La altura no puede superar los 10 caracteres").optional(),
  neighborhood: z.string().max(60, "El barrio no puede superar los 60 caracteres").optional(),
});

export const selfEmailSchema = z.object({
  email: z.email("Email inválido").max(191, "El email es demasiado largo"),
});

export type SelfAddressInput = z.infer<typeof selfAddressSchema>;

export type SelfAddressPatch = {
  streetId: number | null;
  streetText: string | null;
  streetNumber: string | null;
  neighborhood: string | null;
  /** El domicilio editado por el socio queda pendiente de constatación por la
   *  CD (docs/05 §7) — siempre, sin excepciones. */
  addressPendingReview: true;
};

export function buildSelfAddressPatch(d: SelfAddressInput): SelfAddressPatch {
  const streetId = d.streetId ?? null;
  return {
    streetId,
    // Con calle del catálogo, el texto libre sobra (mismo criterio que
    // buildPatch en card-edit.ts: dos fuentes de un domicilio es ambigüedad).
    streetText: streetId ? null : d.streetText?.trim() || null,
    streetNumber: d.streetNumber?.trim() || null,
    neighborhood: d.neighborhood?.trim() || null,
    addressPendingReview: true,
  };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/member-self-edit.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add prisma src/lib/members/self-edit.ts tests/member-self-edit.test.ts
git commit -m "feat(m5a): addressPendingReview column and self-edit whitelist"
```

---

### Task 9: `/mi/datos` — página, formularios, actions de teléfono/domicilio y constatación en la ficha admin

**Files:**
- Create: `src/app/mi/datos/page.tsx`, `src/app/mi/datos/actions.ts`, `src/app/mi/datos/contact-form.tsx`, `src/app/mi/datos/address-form.tsx`
- Modify: `src/lib/auth/rate-limiter.ts` (al final), `src/app/admin/socios/[id]/page.tsx` (aviso + select), `src/app/admin/socios/[id]/actions.ts` (action de constatación)
- Test: `tests/mi-datos-actions.test.ts`

**Interfaces:**
- Consumes: `selfContactSchema`, `selfAddressSchema`, `buildSelfAddressPatch` (Task 8); `memberWriter.updateMember(memberId, data)` de `@/lib/members/write`; `StreetAutocomplete` (+ streets de `prisma.street.findMany({ orderBy: { loadOrder: "asc" }, select: { id, name, loadOrder } })`); `useSyncedForm`/`TextField` de `@/components/admin/synced-fields`; `requireMember` (sin `allowSuspended`: el suspendido no edita); `parseForm` de `@/lib/forms`; `audit`.
- Produces: `updateContactAction`, `updateAddressAction` (firma `(prev: SelfEditState, formData: FormData) => Promise<SelfEditState>` con `type SelfEditState = { error?: string; done?: boolean; message?: string; warning?: string }`); `memberEditLimiter`; `confirmAddressAction(formData: FormData): Promise<void>` (admin).

- [ ] **Step 1: Rate limiter** — agregar al final de `src/lib/auth/rate-limiter.ts`:

```ts
export const MEMBER_EDIT_LIMIT = 6

/** Edición de datos propios en /mi/datos, por memberId (mismo criterio que
 *  memberPayLimiter: la pantalla es autenticada, así que hay una identidad
 *  mejor que la IP). El cambio de email además consume los cupos de
 *  verificación existentes (verificationMemberLimiter) al enviar el correo. */
export const memberEditLimiter = createRateLimiter({ limit: MEMBER_EDIT_LIMIT, windowMs: 60_000 })
```

- [ ] **Step 2: Write the failing action tests**

```ts
// tests/mi-datos-actions.test.ts
// La invariante que este archivo fija: el memberId sale de requireMember(),
// NUNCA del formulario (mismo contrato que member-pay-action.test.ts), y el
// suspendido/bloqueado no escribe.
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireMember = vi.fn();
vi.mock("@/lib/auth/require-member", () => ({
  requireMember: (...a: unknown[]) => requireMember(...a),
}));
const updateMember = vi.fn(async () => ({
  member: {}, revokedTokens: 0, accountEmailMove: null, accountEmailUpdated: false,
}));
vi.mock("@/lib/members/write", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/members/write")>();
  return { ...real, memberWriter: { updateMember: (...a: unknown[]) => updateMember(...a) } };
});
vi.mock("@/lib/auth/rate-limiter", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/auth/rate-limiter")>();
  return { ...real, memberEditLimiter: { check: () => true } };
});
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("next/headers", () => ({ headers: async () => ({ get: () => "1.2.3.4" }) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    member: { findUniqueOrThrow: vi.fn(async () => ({ email: "vieja@x.com" })) },
    street: { findUnique: vi.fn(async () => ({ id: 3 })) },
  },
}));
vi.mock("@/lib/members/account-email-notice", () => ({
  accountEmailNotice: {
    announce: vi.fn(async () => ({
      previousNotified: true, verificationSent: true, throttled: false, failures: [],
    })),
  },
}));

import { updateAddressAction, updateContactAction } from "@/app/mi/datos/actions";

const OK_ACTOR = { ok: true, userId: 9, memberId: 7, fullName: "Socia", suspension: null };
const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

beforeEach(() => {
  vi.clearAllMocks();
  requireMember.mockResolvedValue(OK_ACTOR);
});

describe("updateContactAction", () => {
  it("rejects a blocked actor without touching the writer", async () => {
    requireMember.mockResolvedValue({ ok: false, reason: "suspended", error: "bloqueado" });
    const r = await updateContactAction({}, fd({ phone: "297" }));
    expect(r.error).toBe("bloqueado");
    expect(updateMember).not.toHaveBeenCalled();
  });

  it("writes to the actor's member, ignoring any memberId in the form", async () => {
    const r = await updateContactAction({}, fd({ phone: "2974", memberId: "999" }));
    expect(r.done).toBe(true);
    expect(updateMember).toHaveBeenCalledWith(7, { phone: "2974" });
  });

  it("does not ask requireMember for allowSuspended (the suspended cannot edit)", async () => {
    await updateContactAction({}, fd({ phone: "1" }));
    expect(requireMember).toHaveBeenCalledWith();
  });
});

describe("updateAddressAction", () => {
  it("writes the whitelist patch with the pending-review flag", async () => {
    const r = await updateAddressAction({}, fd({ streetId: "3", streetNumber: "742" }));
    expect(r.done).toBe(true);
    expect(updateMember).toHaveBeenCalledWith(7, {
      streetId: 3, streetText: null, streetNumber: "742", neighborhood: null,
      addressPendingReview: true,
    });
  });

  it("rejects a streetId outside the catalog", async () => {
    const { prisma } = await import("@/lib/prisma");
    vi.mocked(prisma.street.findUnique).mockResolvedValueOnce(null as never);
    const r = await updateAddressAction({}, fd({ streetId: "99" }));
    expect(r.error).toBeTruthy();
    expect(updateMember).not.toHaveBeenCalled();
  });
});
```

Run: `npx vitest run tests/mi-datos-actions.test.ts` → FAIL (módulo inexistente).

- [ ] **Step 3: Actions**

```ts
// src/app/mi/datos/actions.ts
"use server";
// Edición de los datos PROPIOS del socio (spec M5 §8). Tres invariantes:
//  - El memberId sale de requireMember(), nunca del formulario.
//  - El suspendido no edita (REG-20): requireMember() SIN allowSuspended.
//  - La lista blanca de campos vive en @/lib/members/self-edit; la escritura
//    pasa por memberWriter.updateMember, que arrastra las invariantes de
//    tokens y de la cuenta de acceso.
// Auditoría (Ley 25.326): nombres de campo y flags, nunca los valores.
import { headers } from "next/headers";

import { audit } from "@/lib/audit";
import { memberEditLimiter } from "@/lib/auth/rate-limiter";
import { requireMember } from "@/lib/auth/require-member";
import { parseForm } from "@/lib/forms";
import {
  buildSelfAddressPatch,
  selfAddressSchema,
  selfContactSchema,
} from "@/lib/members/self-edit";
import { memberWriter } from "@/lib/members/write";
import { prisma } from "@/lib/prisma";

export type SelfEditState = { error?: string; done?: boolean; message?: string; warning?: string };

const RATE_MSG = "Demasiados cambios seguidos. Esperá un minuto y volvé a probar.";

async function auditSelf(
  userId: number,
  memberId: number,
  fields: string[],
  extra?: Record<string, unknown>,
) {
  const ip = (await headers()).get("x-real-ip") ?? "unknown";
  await audit({
    userId,
    action: "member_self_update",
    entity: "member",
    entityId: memberId,
    detail: { fields, ...extra },
    ip,
  });
}

export async function updateContactAction(
  _prev: SelfEditState,
  formData: FormData,
): Promise<SelfEditState> {
  const actor = await requireMember();
  if (!actor.ok) return { error: actor.error };
  if (!memberEditLimiter.check(String(actor.memberId))) return { error: RATE_MSG };
  const parsed = parseForm(selfContactSchema, formData);
  if (!parsed.ok) return { error: parsed.error };
  await memberWriter.updateMember(actor.memberId, { phone: parsed.data.phone?.trim() || null });
  await auditSelf(actor.userId, actor.memberId, ["phone"]);
  return { done: true, message: "Teléfono guardado." };
}

export async function updateAddressAction(
  _prev: SelfEditState,
  formData: FormData,
): Promise<SelfEditState> {
  const actor = await requireMember();
  if (!actor.ok) return { error: actor.error };
  if (!memberEditLimiter.check(String(actor.memberId))) return { error: RATE_MSG };
  const parsed = parseForm(selfAddressSchema, formData);
  if (!parsed.ok) return { error: parsed.error };
  const patch = buildSelfAddressPatch(parsed.data);
  if (patch.streetId !== null) {
    // El id viaja oculto desde el autocompletado, pero una action es un
    // endpoint: un id fuera del catálogo no se escribe.
    const street = await prisma.street.findUnique({
      where: { id: patch.streetId },
      select: { id: true },
    });
    if (!street) return { error: "Elegí una calle del catálogo o escribila como texto." };
  }
  await memberWriter.updateMember(actor.memberId, patch);
  await auditSelf(actor.userId, actor.memberId, ["street", "streetNumber", "neighborhood"], {
    addressPendingReview: true,
  });
  return {
    done: true,
    message: "Domicilio guardado. La Comisión va a constatar el cambio (queda anotado en tu ficha).",
  };
}
```

Run: `npx vitest run tests/mi-datos-actions.test.ts` → PASS.

- [ ] **Step 4: Client forms**

```tsx
// src/app/mi/datos/contact-form.tsx
"use client";
import { useActionState } from "react";

import { FormMessage } from "@/components/admin/form-message";
import { TextField, useSyncedForm } from "@/components/admin/synced-fields";
import { Button } from "@/components/ui/button";
import { updateContactAction, type SelfEditState } from "./actions";

export function ContactForm({ phone }: { phone: string }) {
  const [state, formAction, pending] = useActionState<SelfEditState, FormData>(
    updateContactAction,
    {},
  );
  const { field, formRef } = useSyncedForm({ phone });
  return (
    <form ref={formRef} action={formAction} className="space-y-3">
      <TextField label="Teléfono" field={field("phone")} type="tel" inputMode="tel" maxLength={40} />
      {state.error && <FormMessage kind="error">{state.error}</FormMessage>}
      {state.done && <FormMessage kind="success">{state.message}</FormMessage>}
      <Button className="min-h-12" disabled={pending}>
        Guardar teléfono
      </Button>
    </form>
  );
}
```

```tsx
// src/app/mi/datos/address-form.tsx
"use client";
import { useActionState } from "react";

import { FormMessage } from "@/components/admin/form-message";
import { StreetAutocomplete, type StreetOption } from "@/components/admin/street-autocomplete";
import { TextField, useSyncedForm } from "@/components/admin/synced-fields";
import { Button } from "@/components/ui/button";
import { updateAddressAction, type SelfEditState } from "./actions";

export function AddressForm(props: {
  streets: StreetOption[];
  streetId: number | null;
  streetText: string | null;
  streetNumber: string;
  neighborhood: string;
}) {
  const [state, formAction, pending] = useActionState<SelfEditState, FormData>(
    updateAddressAction,
    {},
  );
  const { field, formRef } = useSyncedForm({
    streetNumber: props.streetNumber,
    neighborhood: props.neighborhood,
  });
  return (
    <form ref={formRef} action={formAction} className="space-y-3">
      <StreetAutocomplete
        streets={props.streets}
        defaultStreetId={props.streetId}
        defaultStreetText={props.streetText}
      />
      <TextField label="Altura" field={field("streetNumber")} inputMode="numeric" maxLength={10} />
      <TextField label="Barrio" field={field("neighborhood")} maxLength={60} />
      {state.error && <FormMessage kind="error">{state.error}</FormMessage>}
      {state.done && <FormMessage kind="warning">{state.message}</FormMessage>}
      <Button className="min-h-12" disabled={pending}>
        Guardar domicilio
      </Button>
    </form>
  );
}
```

- [ ] **Step 5: The page**

```tsx
// src/app/mi/datos/page.tsx
import { requireMember } from "@/lib/auth/require-member";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FormMessage } from "@/components/admin/form-message";
import { formatDateAR } from "@/lib/format";
import { CATEGORY_LABELS, EMAIL_STATUS_LABELS, STATUS_LABELS } from "@/lib/members/labels";
import { streetLabel } from "@/app/(public)/asociate/wizard-shared";
import { AddressForm } from "./address-form";
import { ContactForm } from "./contact-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mis datos — Vecinal Ciudadela" };

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-4 gap-y-0.5 py-2">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{value ?? "—"}</dd>
    </div>
  );
}

export default async function MiDatosPage() {
  // La página se autoriza sola. El suspendido VE sus datos (allowSuspended)
  // pero no los edita: las actions bloquean y acá ni se le muestran los
  // formularios.
  const actor = await requireMember({ allowSuspended: true });
  if (!actor.ok) return null;
  const canEdit = actor.suspension === null;
  const [member, streets] = await Promise.all([
    prisma.member.findUniqueOrThrow({
      where: { id: actor.memberId },
      select: {
        fullName: true, dni: true, birthDate: true, category: true, status: true,
        joinedAt: true, phone: true, email: true, emailStatus: true,
        streetId: true, streetText: true, streetNumber: true, neighborhood: true,
        addressPendingReview: true,
        street: { select: { name: true } },
      },
    }),
    prisma.street.findMany({
      orderBy: { loadOrder: "asc" },
      select: { id: true, name: true, loadOrder: true },
    }),
  ]);
  const address = member.street
    ? `${streetLabel(member.street.name)} ${member.streetNumber ?? ""}`.trim()
    : [member.streetText, member.streetNumber].filter(Boolean).join(" ") || null;

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">Mis datos</h1>
        <p className="text-sm text-muted-foreground">
          Tu ficha del padrón. Podés actualizar tu teléfono, tu domicilio y tu email; el resto lo
          corrige la vecinal en la sede.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Identidad</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="divide-y divide-border">
            <Row label="Apellido y nombre" value={member.fullName} />
            <Row label="DNI" value={member.dni} />
            <Row
              label="Fecha de nacimiento"
              value={member.birthDate ? formatDateAR(member.birthDate) : null}
            />
            <Row
              label="Categoría"
              value={<Badge variant="secondary">{CATEGORY_LABELS[member.category]}</Badge>}
            />
            <Row label="Estado" value={STATUS_LABELS[member.status]} />
            <Row label="Ingreso" value={formatDateAR(member.joinedAt)} />
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Contacto</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {canEdit ? (
            <ContactForm phone={member.phone ?? ""} />
          ) : (
            <dl>
              <Row label="Teléfono" value={member.phone} />
            </dl>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Domicilio</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {member.addressPendingReview && (
            <FormMessage kind="neutral" box>
              Tu último cambio de domicilio está pendiente de constatación por la Comisión.
            </FormMessage>
          )}
          {canEdit ? (
            <AddressForm
              streets={streets}
              streetId={member.streetId}
              streetText={member.streetText}
              streetNumber={member.streetNumber ?? ""}
              neighborhood={member.neighborhood ?? ""}
            />
          ) : (
            <dl>
              <Row label="Domicilio" value={address} />
            </dl>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Email de ingreso</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <dl className="divide-y divide-border">
            <Row label="Email" value={member.email} />
            <Row label="Estado" value={EMAIL_STATUS_LABELS[member.emailStatus]} />
          </dl>
          {/* El formulario de cambio de email llega en la próxima tarea. */}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 6: Admin — el aviso de constatación en la ficha**

1. En `src/app/admin/socios/[id]/actions.ts`, agregar (con los imports que el archivo ya usa — `requireAdmin`, `audit`, `prisma` — más `revalidatePath` de `next/cache`):

```ts
/** M5: apaga el "pendiente de constatación" que prende la autoedición del
 *  domicilio en /mi/datos. Sin acta: constatar no es un acto estatutario. */
export async function confirmAddressAction(formData: FormData): Promise<void> {
  const actor = await requireAdmin();
  if (!actor.ok) return;
  const memberId = Number(formData.get("memberId"));
  if (!Number.isInteger(memberId) || memberId <= 0) return;
  await prisma.member.update({
    where: { id: memberId },
    data: { addressPendingReview: false },
  });
  await audit({
    userId: actor.userId,
    action: "member_address_confirmed",
    entity: "member",
    entityId: memberId,
    detail: {},
  });
  revalidatePath(`/admin/socios/${memberId}`);
}
```

(Si `requireAdmin`/`audit` se usan con otra forma en ese archivo — p. ej. `actor.user.id` — copiar la forma de las actions vecinas. Si `audit` exige `ip`, agregarla con el patrón `headers()` del archivo.)

2. En `src/app/admin/socios/[id]/page.tsx`: sumar `addressPendingReview: true` al `select` de la consulta del socio, importar `confirmAddressAction` y `Button` (ya importado), y debajo del bloque `debitPending` (después de la línea 137) insertar:

```tsx
      {member.addressPendingReview && (
        <FormMessage kind="warning" box>
          El socio actualizó su domicilio desde el panel y está pendiente de constatación.
          <form action={confirmAddressAction} className="mt-2">
            <input type="hidden" name="memberId" value={member.id} />
            <Button variant="outline" className="min-h-11">
              Marcar constatado
            </Button>
          </form>
        </FormMessage>
      )}
```

- [ ] **Step 7: Verify**

`npx vitest run` → PASS. En el navegador: `/mi/datos` muestra las cuatro tarjetas; guardar un teléfono persiste y muestra "Teléfono guardado."; guardar un domicilio muestra el aviso ámbar y en `/admin/socios/[id]` aparece el cartel con el botón, que lo apaga.

- [ ] **Step 8: Commit**

```bash
git add src/app/mi/datos src/lib/auth/rate-limiter.ts src/app/admin/socios tests/mi-datos-actions.test.ts
git commit -m "feat(m5a): self-service member data editing with address review flow"
```

---

### Task 10: Cambio de email del socio (re-verificación REG-08)

**Files:**
- Modify: `src/app/mi/datos/actions.ts` (nueva action), `src/app/mi/datos/page.tsx` (montar el form)
- Create: `src/app/mi/datos/email-form.tsx`
- Test: `tests/mi-datos-actions.test.ts` (casos nuevos)

**Interfaces:**
- Consumes: `selfEmailSchema` (Task 8); `memberWriter.updateMember` + `MemberWriteError` + `sameAddress` de `@/lib/members/write`; `accountEmailNotice.announce({ member, previousEmail, actorId })` de `@/lib/members/account-email-notice` (maneja él solo el aviso a la casilla vieja, el token de verificación y los cupos de correo).
- Produces: `changeEmailAction(prev: SelfEditState, formData: FormData): Promise<SelfEditState>`.

- [ ] **Step 1: Write the failing tests** (agregar a `tests/mi-datos-actions.test.ts`; el mock de `@/lib/members/write` del archivo ya conserva `sameAddress` y `MemberWriteError` reales vía `importOriginal`)

```ts
import { changeEmailAction } from "@/app/mi/datos/actions";

describe("changeEmailAction", () => {
  it("refuses the current address without writing", async () => {
    const { prisma } = await import("@/lib/prisma");
    vi.mocked(prisma.member.findUniqueOrThrow).mockResolvedValueOnce({ email: "Vieja@X.com" } as never);
    const r = await changeEmailAction({}, fd({ email: "vieja@x.com" }));
    expect(r.error).toBeTruthy();
    expect(updateMember).not.toHaveBeenCalled();
  });

  it("writes declared + null verification and announces the move", async () => {
    const { prisma } = await import("@/lib/prisma");
    vi.mocked(prisma.member.findUniqueOrThrow)
      .mockResolvedValueOnce({ email: "vieja@x.com" } as never) // before
      .mockResolvedValueOnce({
        id: 7, status: "active", email: "nueva@x.com", emailStatus: "declared", userId: 9,
      } as never); // fresh, para announce
    updateMember.mockResolvedValueOnce({
      member: {}, revokedTokens: 0,
      accountEmailMove: { from: "vieja@x.com", to: "nueva@x.com" }, accountEmailUpdated: true,
    });
    const r = await changeEmailAction({}, fd({ email: "Nueva@X.com" }));
    expect(updateMember).toHaveBeenCalledWith(7, {
      email: "nueva@x.com", emailStatus: "declared", emailVerifiedAt: null,
    });
    const { accountEmailNotice } = await import("@/lib/members/account-email-notice");
    expect(vi.mocked(accountEmailNotice.announce)).toHaveBeenCalledWith(
      expect.objectContaining({ previousEmail: "vieja@x.com", actorId: 9 }),
    );
    expect(r.done).toBe(true);
    expect(r.warning).toBeUndefined();
  });

  it("surfaces a member-voiced conflict message", async () => {
    const { prisma } = await import("@/lib/prisma");
    const { MemberEmailConflictError } = await import("@/lib/members/write");
    vi.mocked(prisma.member.findUniqueOrThrow).mockResolvedValueOnce({ email: "vieja@x.com" } as never);
    updateMember.mockRejectedValueOnce(new MemberEmailConflictError());
    const r = await changeEmailAction({}, fd({ email: "deotro@x.com" }));
    expect(r.error).toContain("en uso");
    expect(r.error).not.toContain("socio"); // voz de socio, no de operador
  });
});
```

Run: `npx vitest run tests/mi-datos-actions.test.ts` → FAIL (la action no existe).

- [ ] **Step 2: Implement the action** (agregar a `src/app/mi/datos/actions.ts`; sumar los imports `accountEmailNotice`, `selfEmailSchema`, `MemberWriteError`, `sameAddress`)

```ts
export async function changeEmailAction(
  _prev: SelfEditState,
  formData: FormData,
): Promise<SelfEditState> {
  const actor = await requireMember();
  if (!actor.ok) return { error: actor.error };
  if (!memberEditLimiter.check(String(actor.memberId))) return { error: RATE_MSG };
  const parsed = parseForm(selfEmailSchema, formData);
  if (!parsed.ok) return { error: parsed.error };
  const email = parsed.data.email.toLowerCase().trim();

  const before = await prisma.member.findUniqueOrThrow({
    where: { id: actor.memberId },
    select: { email: true },
  });
  if (sameAddress(before.email, email)) return { error: "Ese ya es tu email actual." };

  // memberWriter arrastra las invariantes: revoca los enlaces viejos y le lleva
  // la dirección a la cuenta de acceso (User.email) en la misma transacción.
  let result;
  try {
    result = await memberWriter.updateMember(actor.memberId, {
      email,
      emailStatus: "declared", // REG-08: toda dirección nueva se re-verifica
      emailVerifiedAt: null,
    });
  } catch (e) {
    if (e instanceof MemberWriteError) {
      // El texto de write.ts habla en voz de operador; acá se traduce a voz de
      // vecino sin revelar de quién es la otra cuenta (criterio de access.ts).
      return {
        error:
          e.reason === "email_conflict"
            ? "Ese email ya está en uso en el sistema. Escribí otra dirección o consultá en la sede."
            : "No se pudo guardar el email. Consultá en la sede.",
      };
    }
    throw e;
  }

  // Post-commit: el aviso a la casilla anterior + la verificación a la nueva.
  // announce() decide solo, con los mismos cupos que el botón del panel admin.
  let warning: string | undefined;
  if (result.accountEmailMove) {
    const fresh = await prisma.member.findUniqueOrThrow({
      where: { id: actor.memberId },
      select: { id: true, status: true, email: true, emailStatus: true, userId: true },
    });
    const outcome = await accountEmailNotice.announce({
      member: fresh,
      previousEmail: result.accountEmailMove.from,
      actorId: actor.userId,
    });
    if (!outcome.verificationSent) {
      warning = outcome.throttled
        ? "El cambio se guardó, pero ya te mandamos varios correos en la última hora: la verificación te va a llegar cuando la pidas de nuevo más tarde."
        : "El cambio se guardó, pero no pudimos mandarte el correo de verificación. Probá más tarde o consultá en la sede.";
    }
  }
  await auditSelf(actor.userId, actor.memberId, ["email"], {
    accountEmailUpdated: result.accountEmailUpdated,
  });
  return {
    done: true,
    message:
      "Email guardado. A partir de ahora ingresás con la dirección nueva; te mandamos un correo para verificarla.",
    warning,
  };
}
```

Run: `npx vitest run tests/mi-datos-actions.test.ts` → PASS.

- [ ] **Step 3: The form + mount it**

```tsx
// src/app/mi/datos/email-form.tsx
"use client";
import { useActionState } from "react";

import { FormMessage } from "@/components/admin/form-message";
import { TextField, useSyncedForm } from "@/components/admin/synced-fields";
import { Button } from "@/components/ui/button";
import { changeEmailAction, type SelfEditState } from "./actions";

export function EmailForm() {
  const [state, formAction, pending] = useActionState<SelfEditState, FormData>(
    changeEmailAction,
    {},
  );
  const { field, formRef } = useSyncedForm({ email: "" });
  return (
    <form ref={formRef} action={formAction} className="space-y-3">
      <TextField
        label="Email nuevo"
        field={field("email")}
        type="email"
        maxLength={191}
        hint="Va a ser tu dirección de ingreso al panel. Te mandamos un correo para verificarla."
      />
      {state.error && <FormMessage kind="error">{state.error}</FormMessage>}
      {state.done && <FormMessage kind="success">{state.message}</FormMessage>}
      {state.warning && <FormMessage kind="warning">{state.warning}</FormMessage>}
      <Button className="min-h-12" disabled={pending}>
        Cambiar email
      </Button>
    </form>
  );
}
```

En `src/app/mi/datos/page.tsx`: importar `EmailForm` y reemplazar el comentario `{/* El formulario de cambio de email llega en la próxima tarea. */}` por `{canEdit && <EmailForm />}`.

- [ ] **Step 4: Verify end-to-end in dev**

Con `EMAIL_ALLOWLIST` local apuntando a las casillas de prueba (`marianoaperez@yahoo.com.ar`, `perezmarianoariel@gmail.com`): cambiar el email del socio de prueba a una de ellas → llega la verificación, `/verificar/[token]` la marca verificada, y el login pasa a exigir la dirección nueva.

- [ ] **Step 5: Commit**

```bash
git add src/app/mi/datos tests/mi-datos-actions.test.ts
git commit -m "feat(m5a): member self-service email change with re-verification (REG-08)"
```

---

### Task 11: Estatuto en PDF

**Files:**
- Create: `datos/estatuto.pdf` (conversión, ver Step 1), `src/app/api/mi/estatuto/route.ts`, `src/app/mi/estatuto/page.tsx`

**Interfaces:**
- Consumes: `requireMember({ allowSuspended: true })`; `EmptyState`, `Card*`.
- Produces: `GET /api/mi/estatuto` (PDF autenticado).

- [ ] **Step 1: The PDF**

Verificar si `datos/estatuto.pdf` existe. Si NO existe: **pausar y pedirle al operador** que exporte `datos/estatuto.docx` a PDF (Word → "Guardar como" → PDF) y lo deje en `datos/estatuto.pdf`. No convertirlo con herramientas que degraden el formato: es un documento estatutario. El PDF se commitea (es un documento institucional del repo, no un upload).

- [ ] **Step 2: The route**

```ts
// src/app/api/mi/estatuto/route.ts
// El estatuto como PDF autenticado (spec M5 §10; docs/07:48 lo movió del M2
// acá: no tiene página pública). Mismas cabeceras defensivas que los recibos
// (receipt-response.ts): inline, sin caché compartida, sin sniffing, CSP con
// sandbox. El suspendido y el vigente lo ven igual; el cesante no (requireMember).
import { readFile } from "node:fs/promises";
import path from "node:path";

import { requireMember } from "@/lib/auth/require-member";

export async function GET(): Promise<Response> {
  const actor = await requireMember({ allowSuspended: true });
  if (!actor.ok) return new Response(actor.error, { status: 403 });
  let bytes: Buffer;
  try {
    bytes = await readFile(path.join(process.cwd(), "datos", "estatuto.pdf"));
  } catch {
    return new Response("El archivo no está disponible", { status: 404 });
  }
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'inline; filename="estatuto-vecinal-ciudadela.pdf"',
      "Cache-Control": "no-store, private",
      Vary: "Cookie",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
```

- [ ] **Step 3: The page**

```tsx
// src/app/mi/estatuto/page.tsx
import { existsSync } from "node:fs";
import path from "node:path";
import { ScrollText } from "lucide-react";

import { EmptyState } from "@/components/admin/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireMember } from "@/lib/auth/require-member";

export const metadata = { title: "Estatuto — Vecinal Ciudadela" };

export default async function MiEstatutoPage() {
  const actor = await requireMember({ allowSuspended: true });
  if (!actor.ok) return null;
  const available = existsSync(path.join(process.cwd(), "datos", "estatuto.pdf"));
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">Estatuto</h1>
        <p className="text-sm text-muted-foreground">
          El texto completo del estatuto de la Asociación Vecinal del Barrio Ciudadela.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle as="h2" className="flex items-center gap-2">
            <ScrollText className="size-4 text-primary" aria-hidden />
            Estatuto social
          </CardTitle>
        </CardHeader>
        <CardContent>
          {available ? (
            <a
              className="inline-flex min-h-12 items-center text-sm font-medium text-primary underline underline-offset-2 outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
              href="/api/mi/estatuto"
              target="_blank"
              rel="noopener"
            >
              Abrir el estatuto (PDF)
            </a>
          ) : (
            <EmptyState
              size="card"
              description="El documento todavía no está publicado. Consultá en la sede."
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Verify**

En dev: `/mi/estatuto` muestra el link, el PDF abre inline en otra pestaña; deslogueado, `GET /api/mi/estatuto` responde 403.

- [ ] **Step 5: Commit**

```bash
git add datos/estatuto.pdf src/app/api/mi/estatuto src/app/mi/estatuto
git commit -m "feat(m5a): authenticated statute PDF inside the member panel"
```

---

### Task 12: Verificación final de la fase (CA-5A)

**Files:** ninguno nuevo — verificación y ajustes menores.

- [ ] **Step 1: Full suite, lint, build**

```bash
npx vitest run
npm run lint
npm run build
```
Expected: todo verde. Los tests de integración del dinero NO se tocaron en toda la fase (verificar con `git log --stat -- tests/integration` que no hay cambios).

- [ ] **Step 2: Browser QA (CA-5A-1)**

Con el dev server corriendo, verificar como socio de prueba en **375px** y desktop:
- Navegación completa por las 4 pestañas; pestaña activa marcada; skip link como primer Tab; foco visible en todos los controles; ningún scroll horizontal del body.
- Credencial: número, categoría, antigüedad, frase electoral coherente con el socio.
- `/mi/cuenta`: chips de año (si hay 2+ años), `#pagar` desde el Inicio, recibo PDF propio abre.
- Sacar capturas móvil + desktop del Inicio como evidencia.

- [ ] **Step 3: Suspended member QA (CA-5A-3)**

En la base local, suspender temporalmente al socio de prueba (`UPDATE members SET status='suspended', suspended_from=NOW() WHERE id=<id>;`), verificar: banner ámbar en todas las secciones, `/mi/datos` sin formularios, "Pagar ahora" visible y funcional, recibos accesibles. Revertir (`status='active', suspended_from=NULL`). Con un socio `withdrawn` (o simulando), verificar que el panel entero sigue bloqueado.

- [ ] **Step 4: Email flow QA (CA-5A-2)**

Ya cubierto en Task 10 Step 4 + Task 9 Step 7; re-verificar que ambos siguen andando tras el build.

- [ ] **Step 5: Update docs and close**

En `docs/07-plan-de-etapas.md`, sección Módulo 5: anotar "Fase 5A implementada el <fecha> (shell, credencial, Mis datos, estatuto, vista suspendido); resta 5B". Commit final:

```bash
git add docs
git commit -m "docs(m5a): phase 5A closed — shell, credential, self-service data, statute"
```

---

## Self-Review (ya aplicado)

- **Cobertura de spec 5A**: §3 shell/pestañas (T1-T3), §3.3 credencial y chips (T6, T7), §5 suspendido (T2-T4, T12), §8 Mis datos (T8-T10), §9 identidad/electoral (T5, T6), §10 estatuto (T11), CA-5A-1/2/3 (T12). `addressPendingReview` (§4.2): T8/T9.
- **Sin placeholders**: cada step de código lleva el código; los dos puntos que dependen de archivos existentes no leídos por el implementador (mocks de tests viejos, imports exactos de `socios/[id]/actions.ts`) llevan la regla de adaptación explícita y acotada.
- **Consistencia de tipos**: `MemberActor.suspension` (T2) es lo que consumen T3/T4/T9; `SelfEditState` se define una vez en T9 y lo importan los tres forms; `ElectoralStatus` (T5) es lo que recibe `MemberCard` (T6).
