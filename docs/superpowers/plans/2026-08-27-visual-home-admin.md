# Visual polish HOME + /admin — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Institutional footer band + Ingresar button + hero-nuevo.jpg on the public site, and icon-chip clickable cards with a date line on the /admin dashboard — visual-only, zero logic changes.

**Architecture:** Rewrite `site-footer.tsx` as a dark band using existing sidebar tokens; restyle two `Link`s for Ingresar; swap two static image imports; redesign `src/app/admin/page.tsx` JSX reusing the sidebar's Lucide icons via a shared icon map resolved by `href`. Two tiny new pure modules (`dashboard-date`, `nav-icons`); everything else is markup/classes.

**Tech Stack:** Next.js 16 App Router, Tailwind v4 (tokens in `src/app/globals.css`), lucide-react, vitest (node env, no DOM).

**Spec:** `docs/superpowers/specs/2026-08-27-visual-home-admin-design.md` — read it before starting.

## Global Constraints

- **Visual-only.** No changes to queries, server actions, auth, payments, or any `src/lib/**` domain module. The ONLY allowed `src/lib` diffs: add `social` to `SITE` in `src/lib/site.ts`, and create `src/lib/admin/dashboard-date.ts` (new pure helper).
- **Do NOT touch** `src/lib/admin/nav.ts`, `src/lib/admin/dashboard-cards.ts`, or anything under `src/app/admin/socios/**`.
- **Existing tests must pass without modifying a single assertion.** Run `npm test` after every task. New test files are allowed (this plan adds one).
- `SiteFooter` and `SiteHeader` are mounted by `src/app/error.tsx` (a client component) and `src/app/not-found.tsx`: they must stay **client-safe** — no `async`, no Prisma, no `next/cache`, only `next/link`, `next/image`, and pure constants.
- Accessibility contract (verified, do not regress): touch targets ≥44px (`min-h-11`), `aria-current` on active nav, `outline-hidden` + `focus-visible:ring-*` on every custom-focused control (NEVER `outline-none`), decorative icons `aria-hidden`, logo images `alt=""` when the name is adjacent text.
- UI copy in es-AR; code, variables and commits in English.
- Colors: existing tokens only — `--sidebar` `#003C5F`, `--sidebar-primary` `#2E9BDF` (brand, decorative/large only), `--primary` `#0079BC` (buttons/links), `--sidebar-foreground`, `--sidebar-border`, `--sidebar-ring`.
- Work on branch `visual-home-admin`. **Never stage `datos/padron_socios.xlsx`** (it has unrelated local changes) — always `git add` specific files, never `git add -A`.
- Test env is node-only (no DOM): markup components are verified by `npx tsc --noEmit`, `npm test` (regressions), and the final browser verification task — this matches the repo's existing practice.

---

### Task 1: Branch + `SITE.social` constants

**Files:**
- Modify: `src/lib/site.ts:4-21`

**Interfaces:**
- Produces: `SITE.social.facebook: string`, `SITE.social.whatsapp: string` (consumed by Task 4's footer).

- [ ] **Step 1: Create the branch**

```bash
git -C C:\git\ciudadela checkout -b visual-home-admin
```

- [ ] **Step 2: Add the `social` block to `SITE`**

In `src/lib/site.ts`, inside the `SITE` object, after the `rooms` block (line 20, before the closing `} as const;`), add:

```ts
  rooms: {
    historic: "Salón Histórico",
    glass: "Salón Vidriado",
    kitchen: "Cocina",
    classroom: "Aulas",
  },
  // Presencia digital de la asociación (la usa el footer). URLs provistas
  // por el operador el 27/08/2026.
  social: {
    facebook: "https://www.facebook.com/vecinalciudadela",
    whatsapp: "https://whatsapp.com/channel/0029Vb5B4S29sBICFUz8ih1i",
  },
} as const;
```

(The `rooms` block is shown for anchoring — only the `social` block and its comment are new.)

- [ ] **Step 3: Typecheck and run the suite**

Run: `npx tsc --noEmit` — Expected: exit 0, no output.
Run: `npm test` — Expected: all tests pass (`site.test.ts` only exercises `siteBaseUrl`, unaffected).

- [ ] **Step 4: Commit**

```bash
git add src/lib/site.ts
git commit -m "feat(site): add social presence constants for the footer"
```

---

### Task 2: `formatDashboardDate` pure helper (TDD)

**Files:**
- Create: `src/lib/admin/dashboard-date.ts`
- Test: `tests/dashboard-date.test.ts`

**Interfaces:**
- Produces: `formatDashboardDate(now: Date): string` → e.g. `"Jueves 27 de agosto de 2026"` (Argentine civil day, es-AR, capitalized, no comma). Consumed by Task 7.

- [ ] **Step 1: Write the failing test**

Create `tests/dashboard-date.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { formatDashboardDate } from "@/lib/admin/dashboard-date";

describe("formatDashboardDate", () => {
  it("formats the date in es-AR with weekday, capitalized", () => {
    expect(formatDashboardDate(new Date("2026-08-27T15:00:00Z"))).toBe(
      "Jueves 27 de agosto de 2026",
    );
  });

  it("uses the Argentine civil day, not the UTC day, near midnight", () => {
    // 01:30Z of the 28th is 22:30 of the 27th in Argentina (UTC-3, no DST).
    expect(formatDashboardDate(new Date("2026-08-28T01:30:00Z"))).toBe(
      "Jueves 27 de agosto de 2026",
    );
    // 03:00Z of the 28th is 00:00 of the 28th in Argentina.
    expect(formatDashboardDate(new Date("2026-08-28T03:00:00Z"))).toBe(
      "Viernes 28 de agosto de 2026",
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/dashboard-date.test.ts`
Expected: FAIL — cannot resolve `@/lib/admin/dashboard-date`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/admin/dashboard-date.ts`:

```ts
// Fecha del tablero de /admin, en es-AR y por día civil argentino (UTC-3,
// sin DST). Puro: recibe el instante, no lee el reloj — testeable en node.
const FORMATTER = new Intl.DateTimeFormat("es-AR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "America/Argentina/Buenos_Aires",
});

export function formatDashboardDate(now: Date): string {
  // Intl emite "jueves, 27 de agosto de 2026": sin la coma y con mayúscula
  // inicial se lee como línea suelta bajo el saludo.
  const text = FORMATTER.format(now).replace(", ", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/dashboard-date.test.ts`
Expected: PASS (3 assertions).

- [ ] **Step 5: Run the full suite and commit**

Run: `npm test` — Expected: all pass.

```bash
git add src/lib/admin/dashboard-date.ts tests/dashboard-date.test.ts
git commit -m "feat(admin): pure es-AR date formatter for the dashboard greeting"
```

---

### Task 3: Extract the nav icon map to a shared module

**Files:**
- Create: `src/components/admin/nav-icons.ts`
- Modify: `src/components/admin/admin-nav-list.tsx:1-27,48`

**Interfaces:**
- Consumes: `AdminNavIcon` type from `@/lib/admin/nav` (unchanged).
- Produces: `NAV_ICONS: Record<AdminNavIcon, LucideIcon-like>` — consumed by `admin-nav-list.tsx` (this task) and the dashboard (Task 7). Exhaustiveness is compile-time guaranteed by the `Record<AdminNavIcon, …>` type: adding a nav icon name without a component fails `tsc`, so no runtime test is needed.

- [ ] **Step 1: Create `src/components/admin/nav-icons.ts`**

```ts
// Mapa nombre→componente de los íconos de navegación del panel. Vive en un
// módulo propio (sin "use client") para que lo compartan la lateral (client)
// y el tablero de /admin (server component); `nav.ts` sigue serializable y
// testeable en node sin arrastrar lucide.
import {
  Activity,
  CalendarDays,
  ClipboardCheck,
  Home,
  Inbox,
  Newspaper,
  ScrollText,
  Settings,
  Users,
  Vote,
  Wallet,
} from "lucide-react";

import type { AdminNavIcon } from "@/lib/admin/nav";

export const NAV_ICONS: Record<AdminNavIcon, typeof Home> = {
  home: Home,
  inbox: Inbox,
  "clipboard-check": ClipboardCheck,
  users: Users,
  wallet: Wallet,
  "scroll-text": ScrollText,
  newspaper: Newspaper,
  "calendar-days": CalendarDays,
  activity: Activity,
  vote: Vote,
  settings: Settings,
};
```

- [ ] **Step 2: Point `admin-nav-list.tsx` at the shared map**

Replace lines 1-27 of `src/components/admin/admin-nav-list.tsx` (the lucide import block and the local `ICONS` const) with:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { NAV_ICONS } from "@/components/admin/nav-icons";
import { isNavItemActive, type AdminNavGroup } from "@/lib/admin/nav";
import { cn } from "@/lib/utils";
```

Then change line 48 from `const Icon = ICONS[item.icon];` to:

```tsx
            const Icon = NAV_ICONS[item.icon];
```

Everything else in the file stays byte-identical (the `AdminNavIcon` type import is dropped because only the map used it).

- [ ] **Step 3: Typecheck, lint, run the suite**

Run: `npx tsc --noEmit` — Expected: exit 0.
Run: `npm run lint` — Expected: no new errors.
Run: `npm test` — Expected: all pass (`admin-nav.test.ts` imports `nav.ts`, untouched).

- [ ] **Step 4: Commit**

```bash
git add src/components/admin/nav-icons.ts src/components/admin/admin-nav-list.tsx
git commit -m "refactor(admin): share the nav icon map so the dashboard can reuse it"
```

---

### Task 4: Footer — institutional band

**Files:**
- Modify: `src/components/public/site-footer.tsx` (full rewrite of the component body)

**Interfaces:**
- Consumes: `SITE` incl. `SITE.social` (Task 1); `assets/logo-negativo.png` (static import, like `member-card.tsx` imports `hero.jpg`).
- Produces: same export `SiteFooter()` — mounted unchanged by `(public)/layout.tsx`, `app/not-found.tsx`, `app/error.tsx`.

- [ ] **Step 1: Rewrite `src/components/public/site-footer.tsx`**

Full new file content:

```tsx
import Image from "next/image";
import Link from "next/link";

import logoNegativo from "../../../assets/logo-negativo.png";
import { SITE } from "@/lib/site";

// Footer del sitio público. Mismo motivo que `SiteHeader`: lo comparten el
// layout de `(public)`, el 404 y la pantalla de error (client component), así
// que tiene que seguir siendo client-safe — sin async, sin Prisma, solo
// constantes puras. El teléfono/email de `configuration` NO entran acá.

const NAV_LINKS = [
  ["/", "Inicio"],
  ["/noticias", "Noticias"],
  ["/actividades", "Actividades"],
  ["/ubicacion", "Ubicación"],
] as const;

// Receta local de link sobre la banda oscura: mismo juego de foco que la
// lateral del panel (anillo --sidebar-ring sobre --sidebar) y min-h-11 de
// target táctil, como el nav público.
const FOOTER_LINK =
  "inline-flex min-h-11 items-center gap-2 rounded-sm text-sm text-sidebar-foreground outline-hidden hover:text-white hover:underline focus-visible:ring-2 focus-visible:ring-sidebar-ring";

const COLUMN_HEADING = "text-[10px] font-bold tracking-widest uppercase text-sidebar-foreground/70";

export function SiteFooter() {
  return (
    // border-t-4 con el celeste de MARCA (#2E9BDF, --sidebar-primary): la
    // franja hermana del border-b-4 del header de /mi. Es decorativa sobre la
    // banda oscura, no texto: no necesita el 4.5:1 de --primary.
    <footer className="border-t-4 border-sidebar-primary bg-sidebar text-sidebar-foreground">
      <div className="mx-auto w-full max-w-5xl px-4 py-10">
        <div className="grid gap-8 sm:grid-cols-2 md:grid-cols-3">
          <div className="space-y-3">
            {/* alt vacío: el nombre va como texto acá abajo. */}
            <Image src={logoNegativo} alt="" className="h-10 w-auto" sizes="40px" />
            <p className="font-semibold text-white">{SITE.name}</p>
            <div className="space-y-1 text-sm">
              <p>{SITE.address}</p>
              <p>{SITE.legalStatus}</p>
              <p>Fundada el {SITE.founded}</p>
            </div>
          </div>
          <nav aria-label="Secciones del sitio (pie de página)" className="space-y-2">
            <p className={COLUMN_HEADING}>Secciones</p>
            <ul className="flex flex-col">
              {NAV_LINKS.map(([href, label]) => (
                <li key={href}>
                  <Link href={href} className={FOOTER_LINK}>
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="space-y-2">
            <p className={COLUMN_HEADING}>Contacto y acceso</p>
            <ul className="flex flex-col">
              <li>
                <a
                  href={SITE.social.facebook}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={FOOTER_LINK}
                >
                  <FacebookIcon />
                  Facebook
                </a>
              </li>
              <li>
                <a
                  href={SITE.social.whatsapp}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={FOOTER_LINK}
                >
                  <WhatsAppIcon />
                  Canal de WhatsApp
                </a>
              </li>
              <li>
                <Link href="/ingresar" className={FOOTER_LINK}>
                  Ingresar
                </Link>
              </li>
              <li>
                <Link href="/asociate" className={FOOTER_LINK}>
                  Asociate
                </Link>
              </li>
            </ul>
          </div>
        </div>
        <div className="mt-8 flex flex-wrap items-center justify-between gap-2 border-t border-sidebar-border pt-4 text-xs text-sidebar-foreground/70">
          <p>
            {SITE.shortName} — {SITE.city}
          </p>
          <p>Sistema SIGeV</p>
        </div>
      </div>
    </footer>
  );
}

// Glifos de marca (lucide no incluye logos de terceros): paths de Simple
// Icons (CC0), viewBox 24×24, fill currentColor para heredar el color del
// link. SVG inline: compatible con la CSP (img-src 'self' no lo alcanza).
function FacebookIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="currentColor" className="size-4 shrink-0">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  );
}

function WhatsAppIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="currentColor" className="size-4 shrink-0">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}
```

- [ ] **Step 2: Typecheck, lint, run the suite**

Run: `npx tsc --noEmit` — Expected: exit 0.
Run: `npm run lint` — Expected: no new errors.
Run: `npm test` — Expected: all pass.

- [ ] **Step 3: Visual smoke check**

Start the dev server (`.claude/launch.json` name if defined; otherwise `npm run dev`, port 3000) and open `http://localhost:3000/`. Verify: dark band with 4px light-blue top edge, three columns (stacked on mobile width), logo visible, both social links present with icons, bottom legal line. Also open a bogus URL (e.g. `/no-existe`) to confirm the 404 renders the footer without errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/public/site-footer.tsx
git commit -m "feat(public): institutional footer band with nav, social and access links"
```

---

### Task 5: "Ingresar" as a primary button (desktop + mobile menu)

**Files:**
- Modify: `src/components/public/site-header.tsx:38-43`
- Modify: `src/components/public/site-nav.tsx:49-57`

**Interfaces:**
- Consumes: nothing new. Produces: no API change — both stay `Link`s to `/ingresar` (no `Button` import: header must stay client-safe and lean).

- [ ] **Step 1: Desktop link → button (site-header.tsx)**

Replace lines 38-43:

```tsx
          <Link
            href="/ingresar"
            className="hidden items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground outline-hidden transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring sm:inline-flex"
          >
            Ingresar
          </Link>
```

- [ ] **Step 2: Mobile menu link → full-width button (site-nav.tsx)**

Replace lines 49-57 (the `<li className="sm:hidden">` block):

```tsx
        <li className="sm:hidden">
          <Link
            href="/ingresar"
            // Mismo CTA que en desktop, ancho completo en el cajón y min-h-11
            // (el mismo mínimo táctil que el resto del menú).
            className="mt-1 flex min-h-11 items-center justify-center rounded-md bg-primary px-4 text-base font-medium text-primary-foreground outline-hidden transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => setOpen(false)}
          >
            Ingresar
          </Link>
        </li>
```

- [ ] **Step 3: Typecheck, lint, run the suite**

Run: `npx tsc --noEmit` && `npm run lint` && `npm test` — Expected: all clean.

- [ ] **Step 4: Visual smoke check**

In the browser at `/`: desktop width shows a filled blue "Ingresar" button in the header; narrow width (<640px) hides it, and opening "Menú" shows the full-width blue button as the last item. Tab to it: visible focus ring.

- [ ] **Step 5: Commit**

```bash
git add src/components/public/site-header.tsx src/components/public/site-nav.tsx
git commit -m "feat(public): style the Ingresar link as a primary button"
```

---

### Task 6: Swap the hero photo (`hero-nuevo.jpg`)

**Files:**
- Modify: `src/app/(public)/page.tsx:6`
- Modify: `src/components/mi/member-card.tsx:8`

- [ ] **Step 1: Change both static imports**

In `src/app/(public)/page.tsx` line 6:

```ts
import heroImg from "../../../assets/hero-nuevo.jpg";
```

In `src/components/mi/member-card.tsx` line 8:

```ts
import heroImg from "../../../assets/hero-nuevo.jpg";
```

Nothing else changes — `next/image` regenerates responsive variants + blur from the new file (1980×690).

- [ ] **Step 2: Typecheck and run the suite**

Run: `npx tsc --noEmit` && `npm test` — Expected: clean.

- [ ] **Step 3: Visual verification of the hero overlay (spec §3)**

In the browser at `/`: check the hero text ("Asociación Vecinal del Barrio Ciudadela" + city + CTA) is legible over the new crop at desktop AND mobile widths (the overlay gradient is pixel-calibrated from the bottom edge; the crop shifts framing, not the bottom-anchored text zone, so it should hold). If — and only if — legibility visibly degraded, adjust ONLY the gradient stops in the overlay class of `page.tsx:74` and note it in the commit message. Also open `/mi` (log in as a member, e.g. the dev seed user) and check the credential band still looks right.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(public)/page.tsx" src/components/mi/member-card.tsx
git commit -m "feat: swap hero photo for the recentered crop (home + member card)"
```

---

### Task 7: /admin dashboard redesign

**Files:**
- Modify: `src/app/admin/page.tsx` (JSX only; queries and `superadmin` logic byte-identical)

**Interfaces:**
- Consumes: `formatDashboardDate` (Task 2), `NAV_ICONS` (Task 3), `ADMIN_NAV` from `@/lib/admin/nav` (read-only import — the array itself is untouched).

- [ ] **Step 1: Rewrite `src/app/admin/page.tsx`**

Full new file content (lines 13-26 of the old file — the data fetching and `superadmin` — are copied verbatim):

```tsx
import Link from "next/link";

import { auth } from "@/auth";
import { NAV_ICONS } from "@/components/admin/nav-icons";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DASHBOARD_GROUPS } from "@/lib/admin/dashboard-cards";
import { formatDashboardDate } from "@/lib/admin/dashboard-date";
import { ADMIN_NAV } from "@/lib/admin/nav";
import { isSuperadmin } from "@/lib/auth/roles";
import { prisma } from "@/lib/prisma";

export const metadata = { title: "Panel de administración — SIGeV" };

// El ícono de cada tarjeta es el de su sección en la lateral, resuelto por
// href: el test de sincronía (dashboard-cards.test.ts) ya garantiza que cada
// tarjeta con href tiene exactamente un ítem de nav con ese href, así que acá
// no hay un segundo mapa que mantener.
const ICON_BY_HREF = new Map(
  ADMIN_NAV.flatMap((group) => group.items).map((item) => [item.href, NAV_ICONS[item.icon]]),
);

export default async function AdminHomePage() {
  const [session, altasCount, sociosCount] = await Promise.all([
    auth(),
    // Mismas dos queries que `solicitudes/layout.tsx`: el tablero y las
    // pestañas tienen que decir el mismo número. Ninguna de las dos es dato
    // personal (son sólo counts).
    prisma.application.count({
      where: { status: { in: ["pending_payment", "approved_pending_minute", "pending_board"] } },
    }),
    prisma.memberRequest.count({ where: { status: "pending" } }),
  ]);
  // Solo para mostrar u ocultar la tarjeta (roles del token, hasta 8 h de atraso
  // tras una degradación); el control de acceso real vive en la propia ruta.
  const superadmin = isSuperadmin(session?.user.roles ?? []);
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Hola, {session?.user.name ?? "administrador/a"}</h1>
        <p className="text-muted-foreground">{formatDashboardDate(new Date())}</p>
      </div>
      {DASHBOARD_GROUPS.map((group) => {
        const cards = group.cards.filter((c) => !c.superadminOnly || superadmin);
        if (cards.length === 0) return null;
        return (
          <section key={group.label} className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">{group.label}</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {cards.map((card) => {
                const Icon = card.href ? ICON_BY_HREF.get(card.href) : undefined;
                return (
                  <Card key={card.title} className="relative transition-shadow hover:shadow-md">
                    <CardHeader className="gap-2">
                      {Icon && (
                        <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                          <Icon aria-hidden className="size-5" />
                        </span>
                      )}
                      <CardTitle>
                        {card.href ? (
                          // El link semántico es el título, estirado a toda la
                          // card con el pseudo-elemento: un solo link por
                          // tarjeta, sin interactivos anidados. El anillo de
                          // foco va inset porque la Card recorta con
                          // overflow-hidden.
                          <Link
                            href={card.href}
                            className="outline-hidden after:absolute after:inset-0 after:rounded-xl after:ring-ring after:ring-inset focus-visible:after:ring-2"
                          >
                            {card.title}
                          </Link>
                        ) : (
                          card.title
                        )}
                      </CardTitle>
                      <CardDescription>{card.description}</CardDescription>
                      {/* Sólo la tarjeta de Solicitudes, y sólo si hay algo
                          pendiente: un "0 · 0" no le dice nada al operador que
                          ya ve la lateral, y `dashboard-cards.ts` no se toca
                          (sus tests de sincronía con la nav siguen intactos) —
                          el desglose lo inyecta esta página. */}
                      {card.href === "/admin/solicitudes" && (altasCount > 0 || sociosCount > 0) && (
                        <p className="font-mono text-xs tabular-nums text-muted-foreground">
                          {altasCount} {altasCount === 1 ? "alta" : "altas"} · {sociosCount} de socios pendientes
                        </p>
                      )}
                    </CardHeader>
                    <CardContent>
                      {card.href ? (
                        // Repite el destino del título para el ojo, no para el
                        // lector de pantalla (el link ya es el título).
                        <p aria-hidden className="text-sm font-medium text-primary group-hover/card:underline">
                          {card.cta ?? "Abrir"} →
                        </p>
                      ) : (
                        <Badge variant="secondary">Próximamente</Badge>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck, lint, run the suite**

Run: `npx tsc --noEmit` && `npm run lint` && `npm test` — Expected: all clean. `dashboard-cards.test.ts` and `admin-nav.test.ts` pass untouched (both read the arrays, not this JSX).

- [ ] **Step 3: Visual smoke check**

Log into `/admin` in the dev browser. Verify: greeting + capitalized Spanish date; every card shows its sidebar icon in a soft-blue chip; hovering a card elevates it and underlines the arrow CTA; clicking anywhere on a card navigates; Tab reaches one link per card with a visible inset ring; the Solicitudes counter shows the same numbers as before (seed data has pending items, or temporarily verify by checking it matches the Solicitudes tab counts).

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/page.tsx
git commit -m "feat(admin): dashboard cards with icon chips, full-card links and date greeting"
```

---

### Task 8: Full verification + evidence

**Files:** none (verification only).

- [ ] **Step 1: Full suite + build**

Run: `npm test` — Expected: entire suite green, zero modified assertions (`git diff main -- tests/` shows ONLY the new `tests/dashboard-date.test.ts`).
Run: `npm run build` — Expected: build succeeds (uses dev `.env`; if `AUTH_URL` is localhost the build only passes with `ALLOW_LOCALHOST_BASE_URL=1`, which is the documented local escape hatch — set it for this build only).

- [ ] **Step 2: Scope audit (spec §"Qué NO se toca")**

Run: `git diff main --stat`
Expected files ONLY:
- `docs/superpowers/plans/2026-08-27-visual-home-admin.md` (if committed on this branch)
- `src/lib/site.ts`, `src/lib/admin/dashboard-date.ts`, `tests/dashboard-date.test.ts`
- `src/components/admin/nav-icons.ts`, `src/components/admin/admin-nav-list.tsx`
- `src/components/public/site-footer.tsx`, `site-header.tsx`, `site-nav.tsx`
- `src/app/(public)/page.tsx`, `src/components/mi/member-card.tsx`
- `src/app/admin/page.tsx`

Zero diffs in `nav.ts`, `dashboard-cards.ts`, `src/app/admin/socios/**`, and `datos/**` is NOT staged.

- [ ] **Step 3: Browser evidence (spec acceptance criteria 3-7)**

With the dev server running, capture screenshots and send them to the operator:
1. HOME desktop: hero with new photo + header button + footer.
2. HOME mobile (375px): stacked footer columns, open menu with the full-width Ingresar button.
3. `/no-existe` (404) and — if reproducible — the error screen: footer renders.
4. `/admin` desktop and mobile: cards with chips, hover state, date line.
5. Keyboard: focus ring visible on a dashboard card and on a footer link (screenshot with focus).

- [ ] **Step 4: Report**

Summarize results against the spec's 8 acceptance criteria. Do NOT merge or push — the operator (Mariano) decides the merge and runs `git push` himself.
