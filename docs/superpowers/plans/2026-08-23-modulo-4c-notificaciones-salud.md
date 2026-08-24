# Módulo 4 — Fase 4C: crons, notificaciones, salud y padrón electoral — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar el ciclo operativo mensual de Tesorería sin intervención manual — la deuda se devenga sola (**fecha dura: en producción antes del 01/10/2026**), el vencimiento se avisa solo, la Comisión recibe un resumen diario, los fallos de envío dejan rastro reintentable, el estado del sistema se lee en `/admin/salud` en vez de por SQL —, más el padrón electoral (REG-31) y las ocho deudas que 4B dejó anotadas.

**Architecture:** Tres crons nuevos (`accrual`, `reminder`, `digest`) que heredan el patrón del reconcile: ruta cáscara (`runtime nodejs`, 503 → 401, `CronRun`, 200/207/500) + factory con `Deps` y `now` inyectables en `src/lib/**`. La guarda de autenticación, hoy duplicada, se extrae a `src/lib/cron/auth.ts` junto con el catálogo `CRON_JOBS`. **La decisión de "hoy no corresponde actuar" vive en el módulo, no en la ruta**, y una corrida que no actúa **no escribe `CronRun`** (§8 D2). El devengo se apoya en una función pura nueva (`periodsToAccrue`) construida sobre `coverageFloor`, la MISMA que decide a qué mes va un pago: devengo e imputación no pueden divergir. El mailer pasa a registrar el intento fallido (`Notification.failed`) en su único punto de escritura, así que los doce call-sites quedan cubiertos de golpe; el tope de envíos por corrida se inyecta como un presupuesto (`MailBudget`) y no como un contador global. `/admin/salud` es una pantalla de sólo lectura (más un reenvío por entidad) que se arma **sin tablas nuevas**: `cron_runs`, `webhook_events`, `audit_log` por `action`, `notifications` por `status` y el `LAST_OK` del backup en disco.

**Tech Stack:** Next.js 16.3.1 (App Router, server actions), Prisma 7 (`@prisma/adapter-mariadb`), MariaDB 10.11 (Docker en dev), zod 4, Tailwind v4 + shadcn (radix-ui), nodemailer + Brevo SMTP, SDK `mercadopago` v2, `lucide-react`, vitest 4.

Spec (contrato): `docs/superpowers/specs/2026-08-23-modulo-4c-notificaciones-salud-design.md` (todas las secciones).
Informes de terreno con `archivo:línea` verificados: `.superpowers/sdd/4c-analysis-{notificaciones,crons-devengo,deuda-mora,salud,deudas}.md`.

## Global Constraints

- **UI en español es-AR** ("vos", `formatDateAR`, `formatARS`, DD/MM/AAAA). Código, variables, tablas, ramas y commits en **inglés**.
- **Mensajes de zod en castellano** en todo schema de server action y de cron: una action es un endpoint público y el texto por defecto de zod (en inglés) termina en pantalla tal cual (ver la cabecera de `src/lib/forms.ts`).
- **Toda tarea que cree o toque una pantalla carga el skill `frontend-design` (Skill tool, nombre `frontend-design`) ANTES de escribir JSX.** Las pantallas heredan el shell: `PageHeader` (entidad en el `<h1>`, última miga = sustantivo corto), `FormMessage` (`kind`: `error | success | warning | neutral`), `EmptyState` (`size="list"` reemplaza la tabla entera), badges desde `src/lib/admin/status-badges.ts`. **Nunca un `thead` sin filas.**
- **Autorización en la ruta Y en cada server action** (`requireAdmin` / `requireSuperadmin` / `requireMember`), nunca sólo en el layout: Next despacha una action por el id del encabezado `Next-Action`, no por su URL. `redirect()` siempre **fuera** de cualquier `try`.
- **Migraciones sólo con `prisma migrate dev`** (nunca `db push`). Una sola en esta fase: `add_module_4c_notifications` (la nº 10).
- **El `preapprovalId` nunca entero en pantalla ni en log de dominio**: al asiento y al log va el id sólo cuando es la acción a reintentar (cancelación fallida); a pantalla, recortado. Nunca el `payerEmail` de un tercero, nunca el DNI, nunca el nombre en un `detail` de auditoría (Ley 25.326, docs/08).
- **Los errores de Mercado Pago van por `mpErrorLog` / `describeMpError`** (`src/lib/mp/error-log.ts`): el SDK hace `throw await response.json()` y un `console.error` crudo vuelca el cuerpo entero, `payer_email` incluido. Los de nodemailer, por `codeOf()` — **sólo el código, nunca la dirección**.
- **Targets ≥44px**, `aria-current="page"` en lo activo, foco visible (`outline-hidden` + `focus-visible:ring-*`, nunca `outline-none`), cifras en `font-mono tabular-nums`.
- **Nada de verde/ámbar crudo de Tailwind**: tokens `--success` y `--warning` (y las variantes de `Badge` que ya existen: hay `success` y `destructive`; **no hay variante `warning`**).
- **El procesador del webhook y los crons no lanzan por regla de negocio.** Lanzar = fallo técnico = 500 = reintento de MP. Un aviso al socio jamás puede convertir un rechazo en 500.
- **En módulos puros Prisma se INYECTA** (`@/lib/prisma` explota al evaluarse sin `DATABASE_URL`); los singletons sólo en rutas, actions, crons y scripts. Todo test que importe un módulo con singleton mockea `@/lib/prisma` **antes** de importar.
- **Premisa de un solo proceso** (`docs/03`): mutex y limitadores viven en memoria. Toda idempotencia de un cron de email es **persistida** (fila en base), nunca una variable.
- Suite base al empezar: **130 archivos pasando + 2 skipped (132) / 1803 tests + 5 skipped (1808)** con `npm test`; `npx tsc --noEmit` y `npm run lint` limpios. **Cada tarea deja los tres en verde.**
- Commits pequeños, mensajes en **inglés**, pie `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Rama de trabajo: `feat/m4c-notificaciones-salud` desde `main` (HEAD `894b802`).
- Ledger: `.superpowers/sdd/progress.md` — cada tarea agrega su entrada (decisiones, bugs encontrados, diferidos).

## Tres desvíos deliberados respecto del texto literal de la spec

Se anotan acá porque el implementador de una tarea no ve las demás y no tiene que "corregirlos":

1. **§4 dice "socios de `ACCRUING_CATEGORIES` con `status: "active"`"; el devengo consulta `status in ("active","suspended")`.** La suspensión es disciplinaria y **no** es eximición: lo dice `rules.ts:80` y lo aplica `debtors.ts:56` (que cuenta pendientes de activos **y** suspendidos) y `accrues()` (`rules.ts:90`, que sólo excluye `withdrawn`). Devengar sólo a los `active` dejaría a un suspendido sin cuotas y con la lista de Deudores contándolo igual. Hoy hay **0 suspendidos**, así que el cambio no mueve una sola fila; la regla pura excluye `withdrawn` y nada más.
2. **La dedupe del recordatorio NO lleva índice `unique`.** Con `Notification.failed` escribiéndose (Task 5), un unique `(memberId, type, period)` haría que un intento fallido bloqueara para siempre el reintento de ese período. Queda **lectura previa que excluye `failed`** + índice `(type, period)` para que la consulta no sea un scan, sobre la premisa de un solo proceso.
3. **Se agrega un tercer índice que la spec no nombra**: `webhook_events(origin, receivedAt)`. El panel de MP de `/admin/salud` (§8.3) pide "el último evento recibido" y "los que fallaron", y hoy la tabla sólo tiene el unique `(origin, externalEventId)`: las dos consultas son full scan. Es barato ahora y caro después (`4c-analysis-salud.md` §7.5).

## Mapa de archivos

**Crear**

- `src/lib/cron/auth.ts` — guarda compartida (503/401 timing-safe) + catálogo `CRON_JOBS`
- `src/lib/treasury/accrual.ts` — cron de devengo (factory)
- `src/lib/treasury/reminder.ts` — cron del recordatorio de vencimiento (factory)
- `src/lib/treasury/upcoming.ts` — `upcomingPeriods` unificado
- `src/lib/admin/digest.ts` — resumen diario a la Comisión (factory + armado puro)
- `src/lib/admin/health.ts` — consultas y estados de `/admin/salud` (Prisma inyectado)
- `src/lib/admin/health-backup.ts` — lector del `LAST_OK` del backup (`node:fs`, nunca desde cliente)
- `src/lib/email/batch-cap.ts` — `MailBudget` y `MAIL_BATCH_CAP`
- `src/lib/mp/subscription-status.ts` — las DOS semánticas de "suscripción viva"
- `src/lib/mp/rejection-reasons.ts` — `status_detail` de MP → texto es-AR
- `src/lib/members/withdraw-with-debits.ts` — baja + cancelación del débito (después del commit)
- `src/lib/members/electoral.ts` — padrón electoral (REG-31 + enmienda)
- `src/app/api/cron/accrual/route.ts`, `src/app/api/cron/reminder/route.ts`, `src/app/api/cron/digest/route.ts`
- `src/app/api/admin/padron-electoral/route.ts` — export CSV
- `src/app/admin/tesoreria/deudores/gestion-manual/page.tsx` — lista imprimible (sin email)
- `src/app/admin/salud/{page.tsx,actions.ts,resend-form.tsx}`
- `src/app/admin/padron-electoral/{page.tsx,actions.ts,elections-flag-form.tsx}`
- `src/app/admin/socios/[id]/auto-debit-form.tsx` — toggle de débito automático
- `prisma/migrations/<ts>_add_module_4c_notifications/migration.sql` (generada)
- Tests: `tests/cron-auth.test.ts`, `tests/applications-cron-route.test.ts`, `tests/treasury-accrual.test.ts`, `tests/accrual-route.test.ts`, `tests/treasury-reminder.test.ts`, `tests/reminder-route.test.ts`, `tests/admin-digest.test.ts`, `tests/digest-route.test.ts`, `tests/mail-batch-cap.test.ts`, `tests/mp-subscription-status.test.ts`, `tests/mp-rejection-reasons.test.ts`, `tests/members-withdraw-with-debits.test.ts`, `tests/members-electoral.test.ts`, `tests/admin-health.test.ts`, `tests/health-actions-auth.test.ts`, `tests/electoral-actions-auth.test.ts`, `tests/treasury-upcoming.test.ts`, `tests/auto-debit-action.test.ts`, `tests/padron-electoral-route.test.ts`

**Modificar**

- `prisma/schema.prisma` — `Notification.period` + índices (`notifications.status`, `notifications(type,period)`, `audit_log.action`, `webhook_events(origin,receivedAt)`)
- `src/app/api/cron/reconcile/route.ts`, `src/app/api/cron/applications/route.ts` — guarda compartida; `applications` escribe `CronRun`
- `src/lib/treasury/rules.ts` — `periodsToAccrue`
- `src/lib/treasury/periods.ts` — `isLastCivilDayOfMonth` + comentario corregido
- `src/lib/treasury/fee-values.ts` — comentario corregido
- `src/lib/treasury/service.ts` — tolerancia al P2002 de período (reintento único)
- `src/lib/treasury/debtors.ts` — `phone`/`emailUsable` en `DebtorRow`
- `src/lib/email/index.ts` — `failed` + `error`; `period` opcional
- `src/lib/email/templates.ts` — `feeReminderEmail`, `boardDigestEmail`, `paymentRejectedEmail`
- `src/lib/mp/webhook-processor.ts` — `sendToMember` en deps, aviso de rechazo, `mailBudget` por llamada
- `src/lib/mp/reconcile.ts` — `deferred` en el summary, `canStillCharge`, huérfanas sin `cancelled`
- `src/lib/mp/link-subscription.ts` — importa el predicado compartido
- `src/lib/members/auto-debit.ts` — importa `isNotCancelled`
- `src/lib/members/service.ts` — nada de red adentro (se documenta el porqué); helper aparte
- `src/lib/config.ts` — `CONFIG_KEYS.digestRecipients` + `parseRecipients`
- `src/lib/admin/nav.ts`, `src/lib/admin/dashboard-cards.ts`, `src/components/admin/admin-nav-list.tsx` — Salud y Padrón electoral
- `src/lib/admin/status-badges.ts` — badges de salud
- `src/lib/format.ts` — `formatRelativeAgo`
- `src/lib/forms.ts` — `field?: string` en `FormResult`
- `src/app/admin/configuracion/{actions.ts,page.tsx,config-form.tsx}` — `digest_recipients`
- `src/app/admin/tesoreria/deudores/{page.tsx,actions.ts}` — REG-15, tercer balde, botón de la lista manual
- `src/app/admin/socios/[id]/{page.tsx,actions.ts,link/page.tsx,link/actions.ts}`
- `src/app/admin/tesoreria/suscripciones/[preapprovalId]/vincular/{page.tsx,actions.ts}`
- `src/app/mi/cuenta/page.tsx`
- `.env.example` — `BACKUP_DIR`, `MAIL_BATCH_CAP`
- `docs/07`, `docs/10`, `docs/11`, `CLAUDE.md`, `.superpowers/sdd/progress.md`
- Tests existentes: `tests/email.test.ts`, `tests/mp-reconcile.test.ts`, `tests/mp-reconcile-route.test.ts`, `tests/mp-webhook-processor.test.ts`, `tests/treasury-rules.test.ts`, `tests/treasury-debtors.test.ts`, `tests/treasury-service.test.ts`, `tests/admin-nav.test.ts`, `tests/dashboard-cards.test.ts`, `tests/status-badges.test.ts`, `tests/forms.test.ts`, `tests/format.test.ts`, `tests/config.test.ts`, `tests/config-actions.test.ts`, `tests/arrears-actions-auth.test.ts`, `tests/member-service.test.ts`, `tests/mp-link-subscription.test.ts`, `tests/member-auto-debit.test.ts`, `tests/applications-cron.test.ts`

---

### Task 0: Rama y ledger

**Files:**
- Modify: `.superpowers/sdd/progress.md`

**Interfaces:**
- Produces: la rama `feat/m4c-notificaciones-salud` y la sección 4C del ledger.
- Consumes: nada.

- [ ] **Step 1: Crear la rama desde `main`**

```bash
git checkout main && git pull --ff-only && git checkout -b feat/m4c-notificaciones-salud
```

- [ ] **Step 2: Verificar la base**

Run: `npm test 2>&1 | tail -6 && npx tsc --noEmit && npm run lint`
Expected: `Test Files  130 passed | 2 skipped (132)`, `Tests  1803 passed | 5 skipped (1808)`, `tsc` y `lint` sin salida de error.

- [ ] **Step 3: Abrir la sección 4C en el ledger**

Agregar al final de `.superpowers/sdd/progress.md`:

```markdown
## Módulo 4 — Fase 4C (crons, notificaciones, salud, padrón electoral) — rama feat/m4c-notificaciones-salud — inicio 23/08/2026

Spec: docs/superpowers/specs/2026-08-23-modulo-4c-notificaciones-salud-design.md
Plan: docs/superpowers/plans/2026-08-23-modulo-4c-notificaciones-salud.md
Informes: .superpowers/sdd/4c-analysis-{notificaciones,crons-devengo,deuda-mora,salud,deudas}.md
Objetivo duro: el cron de devengo en produccion ANTES del 01/10/2026.
Base: 130 archivos + 2 skipped / 1803 tests + 5 skipped.
```

- [ ] **Step 4: Commit**

```bash
git add .superpowers/sdd/progress.md
git commit -m "chore(m4c): open phase 4C ledger

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

(Si `.superpowers/` está en `.gitignore`, el ledger no se commitea: sólo se edita. Verificar con `git check-ignore .superpowers/sdd/progress.md`.)

---

### Task 1: Guarda de cron compartida y `applications` escribe `CronRun`

Hoy la función `authorized()` está duplicada **textualmente** en `src/app/api/cron/applications/route.ts:17-23` y `src/app/api/cron/reconcile/route.ts:13-17`. Con tres crons más serían cinco copias. Y `applications` **no escribe `CronRun`**, así que `/admin/salud` nacería mostrando cuatro corridas de cinco (spec §8.1, §12).

**Files:**
- Create: `src/lib/cron/auth.ts`
- Create: `tests/cron-auth.test.ts`, `tests/applications-cron-route.test.ts`
- Modify: `src/app/api/cron/reconcile/route.ts`, `src/app/api/cron/applications/route.ts`

**Interfaces:**
- Consumes: `applicationsCron.run()` → `{ reminded: number; expired: number; errors: number }` (`src/lib/applications/cron.ts:39`), `ApplicationsCronFailure` / `cronPartial(e)` (mismo archivo), `audit` (`@/lib/audit`), `safeMessage` (`@/lib/log-safe`), `prisma.cronRun`.
- Produces:

```ts
// src/lib/cron/auth.ts
export const CRON_JOBS = {
  reconcile: "reconcile",
  applications: "applications",
  accrual: "accrual",
  reminder: "reminder",
  digest: "digest",
} as const;
export type CronJob = (typeof CRON_JOBS)[keyof typeof CRON_JOBS];
export const CRON_JOB_LIST: readonly CronJob[];
export type CronAuthResult = { ok: true } | { ok: false; response: Response };
export function checkCronAuth(req: Request): CronAuthResult;
```

- [ ] **Step 1: Test que falla — la guarda compartida**

Crear `tests/cron-auth.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { checkCronAuth, CRON_JOBS, CRON_JOB_LIST } from "@/lib/cron/auth";

const req = (auth?: string) =>
  new Request("http://x/api/cron/x", { method: "POST", headers: auth ? { authorization: auth } : {} });

afterEach(() => { delete process.env.CRON_SECRET; });

describe("checkCronAuth", () => {
  it("sin CRON_SECRET → 503 not_configured (el endpoint no existe a efectos prácticos)", async () => {
    const r = checkCronAuth(req("Bearer x"));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.response.status).toBe(503);
    expect(await r.response.json()).toEqual({ error: "not_configured" });
  });
  it("bearer que no coincide → 401 unauthorized", async () => {
    process.env.CRON_SECRET = "s3cret";
    const r = checkCronAuth(req("Bearer nope"));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.response.status).toBe(401);
  });
  it("sin header → 401 y no revienta (timingSafeEqual tira si los largos difieren)", () => {
    process.env.CRON_SECRET = "s3cret";
    expect(checkCronAuth(req()).ok).toBe(false);
  });
  it("bearer correcto → ok", () => {
    process.env.CRON_SECRET = "s3cret";
    expect(checkCronAuth(req("Bearer s3cret")).ok).toBe(true);
  });
  it("el catálogo de jobs tiene los cinco y sus claves coinciden con su valor", () => {
    expect(CRON_JOB_LIST).toEqual(["reconcile", "applications", "accrual", "reminder", "digest"]);
    for (const [k, v] of Object.entries(CRON_JOBS)) expect(k).toBe(v);
    // `CronRun.job` es VarChar(32): un nombre más largo se truncaría en silencio.
    for (const j of CRON_JOB_LIST) expect(j.length).toBeLessThanOrEqual(32);
  });
});
```

- [ ] **Step 2: Correr y ver el fallo**

Run: `npx vitest run tests/cron-auth.test.ts`
Expected: falla con `Failed to resolve import "@/lib/cron/auth"`.

- [ ] **Step 3: Implementación mínima**

Crear `src/lib/cron/auth.ts`:

```ts
// Guarda de los endpoints de cron. No hay sesión ni cookie: lo único que los
// separa de internet es el `CRON_SECRET`.
//
// Vivía duplicada palabra por palabra en `applications/route.ts` y
// `reconcile/route.ts`; con los tres crons de la 4C serían cinco copias de una
// comparación criptográfica, que es exactamente el tipo de código que no se
// puede permitir divergir.
//
// `timingSafeEqual` y `Buffer` exigen Node: toda ruta que la use declara
// `export const runtime = "nodejs"` (en el runtime Edge la guarda no existiría).
import { timingSafeEqual } from "node:crypto";

/** Los cinco `CronRun.job` del sistema. Es un `Record` con clave = valor para
 *  que un typo no compile: sin esto, un `job: "acrual"` deja a /admin/salud
 *  mostrando una corrida fantasma y la buena "nunca corrió". */
export const CRON_JOBS = {
  reconcile: "reconcile",
  applications: "applications",
  accrual: "accrual",
  reminder: "reminder",
  digest: "digest",
} as const;

export type CronJob = (typeof CRON_JOBS)[keyof typeof CRON_JOBS];

/** El orden es el de la pantalla de salud: primero los que ya corren. */
export const CRON_JOB_LIST: readonly CronJob[] = [
  CRON_JOBS.reconcile, CRON_JOBS.applications, CRON_JOBS.accrual, CRON_JOBS.reminder, CRON_JOBS.digest,
];

export type CronAuthResult = { ok: true } | { ok: false; response: Response };

/** Orden de las guardas, idéntico al que ya tenían los dos crons:
 *  1. sin `CRON_SECRET` configurado → 503 (el endpoint no existe a efectos
 *     prácticos, que es lo que corresponde donde nadie debería llamarlo);
 *  2. bearer que no coincide → 401.
 *  El largo se compara antes porque `timingSafeEqual` tira si difiere: filtra el
 *  largo del secreto y nada más, que no es un secreto. */
export function checkCronAuth(req: Request): CronAuthResult {
  const secret = process.env.CRON_SECRET;
  if (!secret) return { ok: false, response: Response.json({ error: "not_configured" }, { status: 503 }) };
  const expected = Buffer.from(`Bearer ${secret}`);
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) {
    return { ok: false, response: Response.json({ error: "unauthorized" }, { status: 401 }) };
  }
  return { ok: true };
}
```

- [ ] **Step 4: Correr y ver verde**

Run: `npx vitest run tests/cron-auth.test.ts`
Expected: 5 tests PASS.

- [ ] **Step 5: Las dos rutas existentes usan la guarda**

En `src/app/api/cron/reconcile/route.ts`: borrar el `import { timingSafeEqual } from "node:crypto";` y la función `authorized` completa (líneas 13-17), agregar `import { checkCronAuth, CRON_JOBS } from "@/lib/cron/auth";` y reemplazar el arranque del `POST`:

```ts
export async function POST(req: Request) {
  const auth = checkCronAuth(req);
  if (!auth.ok) return auth.response;

  const run = await prisma.cronRun.create({ data: { job: CRON_JOBS.reconcile, startedAt: new Date() } });
```

Run: `npx vitest run tests/mp-reconcile-route.test.ts`
Expected: los 5 tests siguen en verde (el test ya cubre 503 / 401 / 200 / 207 / 500 y afirma `job: "reconcile"`).

- [ ] **Step 6: Test que falla — `applications` escribe `CronRun`**

Crear `tests/applications-cron-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  // `BigInt(7)` y no `7n`: el target del proyecto es ES2017.
  create: vi.fn(async () => ({ id: BigInt(7) })),
  update: vi.fn(async () => ({})),
  run: vi.fn(),
  audit: vi.fn(async () => {}),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { cronRun: { create: mocks.create, update: mocks.update } } }));
vi.mock("@/lib/applications/cron", async (orig) => ({
  ...(await orig<typeof import("@/lib/applications/cron")>()),
  applicationsCron: { run: mocks.run },
}));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
import { POST } from "@/app/api/cron/applications/route";

const req = (auth?: string) =>
  new Request("http://x/api/cron/applications", { method: "POST", headers: auth ? { authorization: auth } : {} });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "s3cret";
  mocks.run.mockResolvedValue({ reminded: 2, expired: 1, errors: 0 });
});

describe("POST /api/cron/applications", () => {
  it("sin CRON_SECRET → 503 y no abre corrida", async () => {
    delete process.env.CRON_SECRET;
    expect((await POST(req("Bearer x"))).status).toBe(503);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("bearer incorrecto → 401 y no abre corrida", async () => {
    expect((await POST(req("Bearer nope"))).status).toBe(401);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("corrida limpia → 200, CronRun abierto y cerrado con ok:true", async () => {
    const res = await POST(req("Bearer s3cret"));
    expect(res.status).toBe(200);
    expect(mocks.create).toHaveBeenCalledWith({ data: { job: "applications", startedAt: expect.any(Date) } });
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: BigInt(7) },
      data: { finishedAt: expect.any(Date), ok: true, summary: { reminded: 2, expired: 1, errors: 0 } },
    });
  });
  it("con errores por ítem → 207 y ok:false (la corrida terminó, pero algo no salió)", async () => {
    mocks.run.mockResolvedValue({ reminded: 1, expired: 0, errors: 3 });
    expect((await POST(req("Bearer s3cret"))).status).toBe(207);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ ok: false }) }));
  });
  it("la corrida se cae entera → 500, CronRun con error y el parcial asentado", async () => {
    mocks.run.mockRejectedValue(new Error("db down"));
    expect((await POST(req("Bearer s3cret"))).status).toBe(500);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ ok: false, error: expect.stringContaining("db down") }),
    }));
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "applications_cron" }));
  });
});
```

- [ ] **Step 7: Correr y ver el fallo**

Run: `npx vitest run tests/applications-cron-route.test.ts`
Expected: fallan los tres últimos (`mocks.create` nunca se llama: la ruta hoy no toca `cronRun`).

- [ ] **Step 8: Implementación — reescribir el `POST` de `applications`**

En `src/app/api/cron/applications/route.ts`: borrar el `import { timingSafeEqual }` y la función `authorized` (líneas 17-23), agregar `import { checkCronAuth, CRON_JOBS } from "@/lib/cron/auth";` y `import { prisma } from "@/lib/prisma";`, y reemplazar el `POST` entero por:

```ts
export async function POST(req: Request) {
  const auth = checkCronAuth(req);
  if (!auth.ok) return auth.response;

  // La corrida se abre ANTES de trabajar: si el proceso muere a mitad, la fila
  // queda con `finishedAt: null` y `ok: false`, que /admin/salud muestra como
  // "colgada" — distinto de "corrió mal". Hasta la 4C este cron no dejaba
  // ninguna huella en `cron_runs` y era el único de los dos que corría en
  // producción sin quedar registrado.
  const run = await prisma.cronRun.create({ data: { job: CRON_JOBS.applications, startedAt: new Date() } });
  let result;
  try {
    result = await applicationsCron.run();
  } catch (e) {
    // `run()` ya se come los fallos de cada solicitud: llegar acá significa que
    // se cayó una consulta entera. Al cuerpo no va el mensaje —la respuesta la
    // lee un `curl` que escribe en un log de texto plano—, sólo al log del
    // servidor, y sin el objeto de error. El mensaje pasa por `safeMessage`
    // porque un error de base o de SMTP puede traer la dirección del vecino.
    const reason = e instanceof ApplicationsCronFailure ? e.reason : e;
    console.error("[cron] applications: la corrida falló entera", safeMessage(reason));
    // Aunque falle, la corrida pudo haber mandado recordatorios reales antes de
    // caerse. Sin esto esa mitad no queda registrada en ningún lado.
    const partial = cronPartial(e);
    await prisma.cronRun.update({
      where: { id: run.id },
      data: { finishedAt: new Date(), ok: false, summary: partial ?? undefined, error: safeMessage(reason).slice(0, 500) },
    }).catch(() => {});
    await audit({
      action: "applications_cron",
      entity: "application",
      detail: { ...(partial ?? { reminded: 0, expired: 0, errors: 0 }), failed: true },
    });
    return Response.json({ error: "cron_failed" }, { status: 500 });
  }

  // 207 y no 200 cuando hubo errores por ítem: es la única señal de que algo se
  // rompió en una corrida que igual terminó (misma semántica que el reconcile,
  // docs/11 §H).
  const ok = result.errors === 0;
  await prisma.cronRun.update({
    where: { id: run.id },
    data: { finishedAt: new Date(), ok, summary: result },
  });
  // Sin datos personales: tres contadores (docs/08).
  await audit({ action: "applications_cron", entity: "application", detail: result });
  return Response.json(result, { status: ok ? 200 : 207 });
}
```

- [ ] **Step 9: Correr y ver verde**

Run: `npx vitest run tests/applications-cron-route.test.ts tests/mp-reconcile-route.test.ts tests/applications-cron.test.ts tests/cron-auth.test.ts`
Expected: todo PASS.

- [ ] **Step 10: Suite completa y commit**

Run: `npm test 2>&1 | tail -5 && npx tsc --noEmit && npm run lint`
Expected: 132+2 archivos, sin fallos.

```bash
git add -A && git commit -m "refactor(m4c): one cron guard for all five jobs, and applications finally writes CronRun

The bearer check was copied word for word in two routes and was about to be
copied three more times. The applications cron ran in production for a month
without leaving a row in cron_runs, so the health screen would have been born
showing four runs out of five.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Migración nº 10 — `Notification.period` e índices de salud

**Files:**
- Modify: `prisma/schema.prisma` (modelos `Notification` ~305-326, `AuditLog` ~73-87, `WebhookEvent` ~567-580)
- Create: `prisma/migrations/<ts>_add_module_4c_notifications/migration.sql` (generada)

**Interfaces:**
- Consumes: nada.
- Produces: `Notification.period: string | null` (`Char(7)`, formato `YYYY-MM`); índices `notifications(status)`, `notifications(type, period)`, `audit_log(action)`, `webhook_events(origin, received_at)`.

- [ ] **Step 1: Editar `Notification`**

En `prisma/schema.prisma`, después de la línea `error          String?            @db.VarChar(200)` agregar:

```prisma
  // Período (`YYYY-MM`) al que se refiere el aviso, cuando tiene uno. Hoy lo
  // escribe el recordatorio de vencimiento (4C): la dedupe "una vez por socio y
  // por mes" tiene que sobrevivir al restart de PM2, así que la marca es esta
  // fila y no una variable en memoria (docs/03: un solo proceso, pero el
  // proceso se reinicia).
  period         String?            @db.Char(7)
```

y reemplazar el bloque de índices por:

```prisma
  @@index([memberId])
  // La bandeja de "avisos que no salieron" de /admin/salud es exactamente la
  // consulta que el índice por socio no cubre.
  @@index([status])
  // La dedupe del recordatorio: "¿este socio ya tuvo su aviso de 2026-09?".
  // Deliberadamente NO es `@@unique`: con `failed` escribiéndose desde la 4C,
  // un unique haría que un intento fallido bloqueara para siempre el reintento
  // de ese período.
  @@index([type, period])
  @@map("notifications")
```

- [ ] **Step 2: Editar `AuditLog` y `WebhookEvent`**

En `AuditLog`, después de `@@index([entity, entityId])`:

```prisma
  // /admin/salud lee asientos por ACCIÓN (`link_amount_mismatch`,
  // `webhook_rejected_signature`, los `*_send_failed`). Sin este índice esa
  // consulta es un full scan sobre la tabla que más crece del sistema.
  @@index([action])
```

En `WebhookEvent`, después de `@@unique([origin, externalEventId])`:

```prisma
  // "¿MP nos sigue avisando?" es un MAX(received_at), y "¿qué entró y no se
  // pudo procesar?" un filtro por origen. Las dos son full scan hoy.
  @@index([origin, receivedAt])
```

- [ ] **Step 3: Generar la migración**

Run: `npx prisma migrate dev --name add_module_4c_notifications`
Expected: carpeta nueva en `prisma/migrations/` con, en este orden: `ALTER TABLE notifications ADD COLUMN period CHAR(7) NULL`, `CREATE INDEX notifications_status_idx ON notifications(status)`, `CREATE INDEX notifications_type_period_idx ON notifications(type, period)`, `CREATE INDEX audit_log_action_idx ON audit_log(action)`, `CREATE INDEX webhook_events_origin_received_at_idx ON webhook_events(origin, received_at)`. **Ningún `DROP`**: si la migración generada trae uno, parar y revisar el schema antes de seguir.

- [ ] **Step 4: Verificar contra la base real**

Run: `npx prisma migrate status && node -e "1"`
Expected: `Database schema is up to date!`.

- [ ] **Step 5: Suite completa y commit**

Run: `npm test 2>&1 | tail -5 && npx tsc --noEmit`
Expected: sin fallos (la columna es aditiva y nullable).

```bash
git add -A && git commit -m "feat(m4c): migration 10 — notification period and the four indexes the health screen needs

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: `periodsToAccrue` — la regla pura del devengo

Spec §4 ("Regla pura") y §3. Se construye sobre `coverageFloor`, que es la **misma** función con la que `allocate` decide a qué mes va un pago: devengo e imputación no pueden divergir. `accrues()` **no sirve** para esto y su propio contrato lo dice (`rules.ts:82-85`): decide con el status ACTUAL y no conoce el intervalo de baja, que es justamente el caso del backfill de un reingresado.

**Files:**
- Modify: `src/lib/treasury/rules.ts` (después de `accrues`, antes de `ARREARS_WARNING`)
- Modify: `tests/treasury-rules.test.ts`

**Interfaces:**
- Consumes: `coverageFloor(m: { joinedAt: Date; readmittedAt?: Date | null }): Period` (`rules.ts:74`), `ACCRUING_CATEGORIES` (`rules.ts:34`), `periodRange(from, to)` (`periods.ts:82`, inclusivo y **vacío si `to < from`**).
- Produces:

```ts
// src/lib/treasury/rules.ts
export function periodsToAccrue(
  m: { status: MemberStatus; category: MemberCategory; joinedAt: Date; readmittedAt?: Date | null },
  upTo: Period,
  existing: Period[],
): Period[];
```

- [ ] **Step 1: Test que falla — la tabla de casos**

Agregar al final de `tests/treasury-rules.test.ts` (el archivo ya importa de `@/lib/treasury/rules`; sumar `periodsToAccrue` al import existente):

```ts
describe("periodsToAccrue", () => {
  // Socio del padrón: ingresó mucho antes de la foto de deuda, así que su piso
  // es IMPORT_COVERAGE_FLOOR = 2026-09.
  const padron = { status: "active" as const, category: "active" as const, joinedAt: new Date("2019-03-10T12:00:00Z") };

  it("desde el piso de cobertura hasta upTo inclusive", () => {
    expect(periodsToAccrue(padron, "2026-09", [])).toEqual(["2026-09"]);
  });
  it("backfillea: primera corrida en noviembre crea septiembre Y octubre", () => {
    expect(periodsToAccrue(padron, "2026-10", [])).toEqual(["2026-09", "2026-10"]);
  });
  it("nunca antes del piso: la foto de deuda cubre hasta agosto de 2026", () => {
    expect(periodsToAccrue(padron, "2026-12", [])).not.toContain("2026-08");
  });
  it("saltea lo que ya existe, venga del import o del propio devengo", () => {
    expect(periodsToAccrue(padron, "2026-11", ["2026-09", "2026-10"])).toEqual(["2026-11"]);
  });
  it("vacío si ya está todo cubierto (correr dos veces el mismo día no crea nada)", () => {
    expect(periodsToAccrue(padron, "2026-09", ["2026-09"])).toEqual([]);
  });
  it("vacío si upTo es anterior al piso (alta futura: un socio de noviembre no devenga en octubre)", () => {
    const nuevo = { ...padron, joinedAt: new Date("2026-11-05T12:00:00Z") };
    expect(periodsToAccrue(nuevo, "2026-10", [])).toEqual([]);
  });
  it("REG-14: la cuota de ingreso cubre el mes de alta, así que arranca el mes siguiente", () => {
    const alta = { ...padron, joinedAt: new Date("2026-09-21T12:00:00Z") };
    expect(periodsToAccrue(alta, "2026-11", [])).toEqual(["2026-10", "2026-11"]);
  });
  it("REG-11: el reingreso manda sobre joinedAt — no se devengan los meses de baja", () => {
    const reingreso = { ...padron, readmittedAt: new Date("2026-11-08T12:00:00Z") };
    expect(periodsToAccrue(reingreso, "2026-12", [])).toEqual(["2026-12"]);
  });
  it("la baja no devenga: sus pendientes quedan congeladas (REG-16)", () => {
    expect(periodsToAccrue({ ...padron, status: "withdrawn" }, "2026-12", [])).toEqual([]);
  });
  it("el suspendido SÍ devenga: la suspensión es disciplinaria, no eximición", () => {
    expect(periodsToAccrue({ ...padron, status: "suspended" }, "2026-09", [])).toEqual(["2026-09"]);
  });
  it("sólo devengan las categorías obligadas (el adherente aporta voluntariamente)", () => {
    for (const category of ["adherent", "cadet", "honorary", "lifetime"] as const) {
      expect(periodsToAccrue({ ...padron, category }, "2026-12", [])).toEqual([]);
    }
    expect(periodsToAccrue({ ...padron, category: "collaborator" }, "2026-09", [])).toEqual(["2026-09"]);
  });
});
```

- [ ] **Step 2: Correr y ver el fallo**

Run: `npx vitest run tests/treasury-rules.test.ts`
Expected: falla en la compilación del test — `periodsToAccrue` no existe.

- [ ] **Step 3: Implementación mínima**

En `src/lib/treasury/rules.ts`, agregar `periodRange` al import de `./periods` y, después de `accrues`, escribir:

```ts
/** Qué períodos hay que CREARLE a este socio para que su cuenta esté completa
 *  hasta `upTo` inclusive. Vacío si la categoría no devenga, si está de baja, o
 *  si ya está todo cubierto.
 *
 *  Es la contracara de `allocate`: las dos arrancan en `coverageFloor(m)`, así
 *  que el mes que el devengo materializa es exactamente el mes que un pago
 *  habría cubierto. Si cada una calculara su propio piso, el sistema le crearía
 *  una cuota de un mes y le imputaría el pago a otro.
 *
 *  A diferencia de `accrues`, ésta SÍ sirve para recorrer el pasado: no
 *  pregunta por un período suelto contra el status de hoy, sino que recorre un
 *  rango cuyo piso ya conoce el reingreso (`readmittedAt`, que el llamador trae
 *  del `Movement` más nuevo — REG-11 impide derivarlo de `joinedAt`).
 *
 *  `existing` son TODOS los períodos que el socio ya tiene, con cualquier
 *  estado y cualquier origen: una cuota `import` manda sobre el devengo porque
 *  ya representa ese mes, y una `paid` no puede volver a nacer pendiente. */
export function periodsToAccrue(
  m: { status: MemberStatus; category: MemberCategory; joinedAt: Date; readmittedAt?: Date | null },
  upTo: Period,
  existing: Period[],
): Period[] {
  if (m.status === "withdrawn") return [];
  if (!ACCRUING_CATEGORIES.includes(m.category)) return [];
  const taken = new Set(existing);
  return periodRange(coverageFloor(m), upTo).filter((p) => !taken.has(p));
}
```

- [ ] **Step 4: Correr y ver verde**

Run: `npx vitest run tests/treasury-rules.test.ts`
Expected: los 11 casos nuevos PASS y los preexistentes siguen en verde.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(m4c): periodsToAccrue — the accrual rule, built on the same floor the allocation uses

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Cron de devengo — `POST /api/cron/accrual`

Spec §4 completa, más dos remiendos que van acá porque son del mismo hecho: la **tolerancia al P2002 de período** en el núcleo de plata (la carrera entre el devengo y un pago simultáneo, `service.ts:319-326`) y los **dos comentarios que dicen que el devengo necesita el valor de cuota** (`periods.ts:56-59`, `fee-values.ts:44-46`), que es falso: `Fee` no tiene columna de monto.

Escala real medida el 23/08/2026: **35 socios devengan** (los 124 adherentes no), ~35 filas la primera corrida, ~38 idas a la base, cero llamadas de red.

> Esta es la tarea con **fecha dura**: tiene que estar en producción **antes del 01/10/2026**.

**Files:**
- Create: `src/lib/treasury/accrual.ts`, `src/app/api/cron/accrual/route.ts`
- Create: `tests/treasury-accrual.test.ts`, `tests/accrual-route.test.ts`
- Modify: `src/lib/treasury/periods.ts` (agrega `isFirstCivilDayOfMonth`; corrige el comentario de `civilDayOf`), `src/lib/treasury/fee-values.ts` (corrige el comentario de `current`), `src/lib/treasury/service.ts` (reintento único), `tests/treasury-service.test.ts`

**Interfaces:**
- Consumes: `periodsToAccrue(m, upTo, existing)` (Task 3), `ACCRUING_CATEGORIES` (`rules.ts:34`), `currentPeriod(now)` / `addMonths(p, n)` / `comparePeriods(a, b)` / `civilDayOf(at)` (`periods.ts`), `checkCronAuth` / `CRON_JOBS` (Task 1), `audit` (`@/lib/audit`), `safeMessage` (`@/lib/log-safe`), `prisma.cronRun`.
- Produces:

```ts
// src/lib/treasury/periods.ts
export function isFirstCivilDayOfMonth(at?: Date): boolean;

// src/lib/treasury/accrual.ts
export type AccrualSummary = {
  membersScanned: number;   // socios que devengan (categoría + status)
  membersAccrued: number;   // socios a los que se les creó al menos una cuota
  feesCreated: number;      // filas efectivamente insertadas
  backfilled: number;       // de las planificadas, las de períodos ANTERIORES a upTo
  upTo: Period;             // hasta qué mes se devengó: la decisión de la corrida
  errors: string[];
  errorsOmitted: number;
};
export function makeAccrualCron(deps: {
  db: Pick<PrismaClient, "member" | "movement" | "fee">;
  now?: () => Date;
}): {
  willAct(): boolean;
  run(opts?: { upTo?: Period }): Promise<AccrualSummary>;
};
export const accrualCron: ReturnType<typeof makeAccrualCron>;
```

- [ ] **Step 1: Test que falla — el día civil y el módulo**

Crear `tests/treasury-accrual.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { makeAccrualCron } from "@/lib/treasury/accrual";
import { isFirstCivilDayOfMonth } from "@/lib/treasury/periods";

// Socio del padrón: piso de cobertura = IMPORT_COVERAGE_FLOOR = 2026-09.
const PADRON = new Date("2019-03-10T12:00:00Z");

function fakeDb(members: Array<{ id: number; status: string; category: string; joinedAt: Date }>, opts?: {
  fees?: Array<{ memberId: number; period: string }>;
  readmissions?: Array<{ memberId: number; _max: { date: Date | null } }>;
  createMany?: ReturnType<typeof vi.fn>;
}) {
  const createMany = opts?.createMany ?? vi.fn(async ({ data }: { data: unknown[] }) => ({ count: data.length }));
  return {
    db: {
      member: { findMany: vi.fn(async () => members) },
      movement: { groupBy: vi.fn(async () => opts?.readmissions ?? []) },
      fee: { findMany: vi.fn(async () => opts?.fees ?? []), createMany },
    },
    createMany,
  };
}

describe("isFirstCivilDayOfMonth", () => {
  it("las 00:30 argentinas del 1° son el día 1 (en UTC son las 03:30 del 1)", () => {
    expect(isFirstCivilDayOfMonth(new Date("2026-10-01T03:30:00Z"))).toBe(true);
  });
  it("las 23:00 argentinas del 30/09 NO son el día 1, aunque en UTC ya sea el 01/10", () => {
    expect(isFirstCivilDayOfMonth(new Date("2026-10-01T02:00:00Z"))).toBe(false);
  });
  it("el 15 no", () => {
    expect(isFirstCivilDayOfMonth(new Date("2026-10-15T12:00:00Z"))).toBe(false);
  });
});

describe("accrual cron", () => {
  const now = () => new Date("2026-10-01T03:30:00Z"); // 00:30 AR del 01/10

  it("willAct() sólo el día 1 del mes civil argentino", () => {
    const { db } = fakeDb([]);
    expect(makeAccrualCron({ db: db as never, now }).willAct()).toBe(true);
    expect(makeAccrualCron({ db: db as never, now: () => new Date("2026-10-15T12:00:00Z") }).willAct()).toBe(false);
  });

  it("devenga hasta el mes VENCIDO: el 01/10 crea 2026-09 y nunca 2026-10", async () => {
    const { db, createMany } = fakeDb([{ id: 1, status: "active", category: "active", joinedAt: PADRON }]);
    const s = await makeAccrualCron({ db: db as never, now }).run();
    expect(s.upTo).toBe("2026-09");
    expect(s.membersScanned).toBe(1);
    expect(s.membersAccrued).toBe(1);
    expect(s.feesCreated).toBe(1);
    expect(createMany).toHaveBeenCalledWith({
      data: [{ memberId: 1, period: "2026-09", status: "pending", origin: "accrual" }],
      skipDuplicates: true,
    });
  });

  it("backfillea: primera corrida el 01/11 crea septiembre Y octubre", async () => {
    const { db } = fakeDb([{ id: 1, status: "active", category: "active", joinedAt: PADRON }]);
    const s = await makeAccrualCron({ db: db as never, now: () => new Date("2026-11-01T03:30:00Z") }).run();
    expect(s.upTo).toBe("2026-10");
    expect(s.feesCreated).toBe(2);
    expect(s.backfilled).toBe(1); // 2026-09 es anterior a upTo; 2026-10 es el mes vencido
  });

  it("correrlo dos veces el mismo día no crea nada la segunda (lectura previa)", async () => {
    const { db, createMany } = fakeDb(
      [{ id: 1, status: "active", category: "active", joinedAt: PADRON }],
      { fees: [{ memberId: 1, period: "2026-09" }] },
    );
    const s = await makeAccrualCron({ db: db as never, now }).run();
    expect(s.feesCreated).toBe(0);
    expect(s.membersAccrued).toBe(0);
    expect(createMany).not.toHaveBeenCalled();
  });

  it("no trae socios que no devengan: el where filtra categoría y status", async () => {
    const { db } = fakeDb([]);
    await makeAccrualCron({ db: db as never, now }).run();
    expect(db.member.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: { in: ["active", "suspended"] }, category: { in: ["active", "collaborator"] } },
    }));
  });

  it("el reingreso se trae en LOTE, no una consulta por socio", async () => {
    const { db } = fakeDb(
      [{ id: 7, status: "active", category: "active", joinedAt: PADRON }],
      { readmissions: [{ memberId: 7, _max: { date: new Date("2026-09-20T12:00:00Z") } }] },
    );
    const s = await makeAccrualCron({ db: db as never, now }).run();
    expect(db.movement.groupBy).toHaveBeenCalledTimes(1);
    // Reingresó el 20/09: su piso es octubre y el mes vencido es septiembre.
    expect(s.feesCreated).toBe(0);
  });

  it("un socio que falla no frena a los demás y su causa queda en errors[]", async () => {
    const createMany = vi.fn()
      .mockRejectedValueOnce(new Error("deadlock"))
      .mockResolvedValueOnce({ count: 1 });
    const { db } = fakeDb([
      { id: 1, status: "active", category: "active", joinedAt: PADRON },
      { id: 2, status: "active", category: "active", joinedAt: PADRON },
    ], { createMany });
    const s = await makeAccrualCron({ db: db as never, now }).run();
    expect(s.feesCreated).toBe(1);
    expect(s.errors).toHaveLength(1);
    expect(s.errors[0]).toContain("member:1");
  });

  it("`upTo` inyectable: se puede pedir una corrida acotada sin tocar el reloj", async () => {
    const { db } = fakeDb([{ id: 1, status: "active", category: "active", joinedAt: PADRON }]);
    const s = await makeAccrualCron({ db: db as never, now }).run({ upTo: "2026-12" });
    expect(s.upTo).toBe("2026-12");
    expect(s.feesCreated).toBe(4); // 09, 10, 11 y 12
  });
});
```

- [ ] **Step 2: Correr y ver el fallo**

Run: `npx vitest run tests/treasury-accrual.test.ts`
Expected: falla con `Failed to resolve import "@/lib/treasury/accrual"`.

- [ ] **Step 3: `isFirstCivilDayOfMonth` en `periods.ts` y los dos comentarios que mienten**

En `src/lib/treasury/periods.ts`, después de `civilDayOf`, agregar:

```ts
/** ¿El día civil ARGENTINO de `at` es el 1° del mes? Lo pregunta el cron de
 *  devengo, que corre a las 00:30 y tiene que decidir con el calendario de acá:
 *  a esa hora UTC ya está en el día siguiente desde las 21:00 de la víspera. */
export function isFirstCivilDayOfMonth(at: Date = new Date()): boolean {
  return civilDayOf(at).getUTCDate() === 1;
}
```

Y en el docstring de `civilDayOf`, reemplazar

```
 *  00:00 y las 08:59 del propio día en que empieza a regir: el cron de devengo
 *  (00:30 del día 1) abortaría por "no hay valor vigente" y el superadmin que
```

por

```
 *  00:00 y las 08:59 del propio día en que empieza a regir: el superadmin que
```

(el devengo **no** lee `fee_values` — `Fee` no tiene columna de monto, `schema.prisma:652-671` —, así que ese ejemplo describe una preocupación anterior a la decisión de la 4A: la deuda se valúa a valor vigente al momento del pago.)

En `src/lib/treasury/fee-values.ts`, reemplazar el final del docstring de `current`

```
 *  crudo, un valor que rige "desde hoy" no existiría hasta las 09:00 y el
 *  cron de devengo de las 00:30 del día 1 abortaría sin valor de cuota. */
```

por

```
 *  crudo, un valor que rige "desde hoy" no existiría hasta las 09:00: un cobro
 *  de mostrador de la mañana abortaría por "no hay valor vigente" sobre un
 *  valor que la Comisión ya fijó para ese día. (El cron de DEVENGO no llama
 *  acá: la cuota no lleva monto, se valúa a valor vigente al momento del pago.) */
```

- [ ] **Step 4: Implementación — `src/lib/treasury/accrual.ts`**

```ts
// Cron de devengo (spec 4C §4). Corre todos los días a las 00:30 y ACTÚA sólo
// cuando el día civil argentino es 1.
//
// Qué materializa: la cuota del mes M nace el 01/M ("al cobro") pero su FILA se
// crea el 01/M+1, cuando ya es mora (decisión del operador, 23/08/2026). Por eso
// `upTo` es el mes VENCIDO y no el corriente: así los 21 puntos del sistema que
// cuentan filas `pending` a secas —Deudores, niveles de mora, cesantía,
// `debtAtWithdrawal`— siguen siendo correctos sin tocar ninguno.
//
// Por qué existe: el padrón de deuda (foto del 21/08/2026) cubre a todos hasta
// agosto de 2026 y trajo SÓLO lo impago. Sin este cron, desde octubre un socio
// que debe septiembre se muestra "al día" porque no hay fila que contar.
//
// NO manda emails y NO lee `fee_values`: la cuota no lleva monto (la deuda se
// valúa a valor vigente al momento del pago, REG-16 generalizado).
import type { PrismaClient } from "@/generated/prisma/client";
import { safeMessage } from "@/lib/log-safe";
import { prisma } from "@/lib/prisma";
import { addMonths, comparePeriods, currentPeriod, isFirstCivilDayOfMonth, type Period } from "./periods";
import { ACCRUING_CATEGORIES, periodsToAccrue } from "./rules";

/** Mismos topes que el reconcile: el summary va a `CronRun.summary` y al asiento
 *  de auditoría, así que no puede crecer sin techo. */
const MAX_ERRORS = 50;
const ERROR_MAX = 240;

export type AccrualSummary = {
  membersScanned: number;
  membersAccrued: number;
  feesCreated: number;
  /** De las planificadas, cuántas son de períodos ANTERIORES a `upTo`. Es el
   *  número que dice si la corrida fue de rutina o tapó un hueco. */
  backfilled: number;
  upTo: Period;
  errors: string[];
  errorsOmitted: number;
};

type Deps = {
  db: Pick<PrismaClient, "member" | "movement" | "fee">;
  now?: () => Date;
};

export function makeAccrualCron(deps: Deps) {
  const now = deps.now ?? (() => new Date());

  return {
    /** La decisión de "hoy no corresponde" vive ACÁ y no en la ruta (spec §4):
     *  la ruta sólo la consulta para no abrir un `CronRun` que no representa
     *  ninguna corrida (§8, D2: una corrida que decide no actuar no es una
     *  corrida). */
    willAct(): boolean {
      return isFirstCivilDayOfMonth(now());
    },

    async run(opts?: { upTo?: Period }): Promise<AccrualSummary> {
      // El mes VENCIDO. Inyectable para poder probar "corrió por primera vez en
      // noviembre" sin tocar el reloj del sistema.
      const upTo = opts?.upTo ?? addMonths(currentPeriod(now()), -1);
      const s: AccrualSummary = {
        membersScanned: 0, membersAccrued: 0, feesCreated: 0, backfilled: 0,
        upTo, errors: [], errorsOmitted: 0,
      };
      const fail = (ref: string, e: unknown) => {
        console.error("[accrual]", ref, safeMessage(e));
        if (s.errors.length >= MAX_ERRORS) { s.errorsOmitted++; return; }
        s.errors.push(`${ref}: ${safeMessage(e)}`.slice(0, ERROR_MAX));
      };

      // El `where` filtra las dos condiciones que la regla pura volvería a
      // aplicar: así no se traen los 124 adherentes ni los 117 dados de baja.
      // El SUSPENDIDO entra: la suspensión es disciplinaria, no eximición
      // (rules.ts:80), y Deudores ya cuenta sus pendientes (debtors.ts:56).
      const members = await deps.db.member.findMany({
        where: { status: { in: ["active", "suspended"] }, category: { in: [...ACCRUING_CATEGORIES] } },
        select: { id: true, status: true, category: true, joinedAt: true },
        orderBy: { id: "asc" },
      });
      s.membersScanned = members.length;
      if (members.length === 0) return s;
      const ids = members.map((m) => m.id);

      // Las dos consultas de contexto, en LOTE. El reingreso no se puede derivar
      // de `joinedAt` (REG-11: no reinicia la antigüedad), así que sale del
      // `Movement` de tipo `readmission` más nuevo — una consulta para todos, no
      // una por socio.
      const [feeRows, readmissions] = await Promise.all([
        deps.db.fee.findMany({ where: { memberId: { in: ids } }, select: { memberId: true, period: true } }),
        deps.db.movement.groupBy({
          by: ["memberId"],
          where: { type: "readmission", memberId: { in: ids } },
          _max: { date: true },
        }),
      ]);
      const existingBy = new Map<number, Period[]>();
      for (const f of feeRows) existingBy.set(f.memberId, [...(existingBy.get(f.memberId) ?? []), f.period]);
      const readmittedBy = new Map<number, Date | null>(readmissions.map((r) => [r.memberId, r._max.date ?? null]));

      for (const m of members) {
        const periods = periodsToAccrue(
          { ...m, readmittedAt: readmittedBy.get(m.id) ?? null },
          upTo,
          existingBy.get(m.id) ?? [],
        );
        if (periods.length === 0) continue;
        try {
          // Un `createMany` POR SOCIO y no uno global (mismo argumento de
          // atomicidad que el import de deuda): un socio queda con todo su
          // backfill o con nada, y la corrida se puede cortar y relanzar.
          //
          // `skipDuplicates` NO reemplaza a la lectura previa —la lectura es la
          // que respeta que una cuota `import` o `paid` manda sobre el devengo, y
          // la que hace honesto el summary—: está por la CARRERA con un pago
          // simultáneo, que puede crear el mismo período entre el findMany y esta
          // línea. Sin él, ese P2002 mataría el INSERT entero del socio.
          const r = await deps.db.fee.createMany({
            data: periods.map((period) => ({
              memberId: m.id, period, status: "pending" as const, origin: "accrual" as const,
            })),
            skipDuplicates: true,
          });
          s.feesCreated += r.count;
          s.backfilled += periods.filter((p) => comparePeriods(p, upTo) < 0).length;
          if (r.count > 0) s.membersAccrued++;
        } catch (e) {
          // El id del socio SÍ va al summary: es un id interno, no un dato
          // personal, y sin él "falló uno de 35" no le sirve a nadie.
          fail(`member:${m.id}`, e);
        }
      }
      return s;
    },
  };
}

export const accrualCron = makeAccrualCron({ db: prisma });
```

- [ ] **Step 5: Correr y ver verde**

Run: `npx vitest run tests/treasury-accrual.test.ts tests/treasury-periods.test.ts tests/treasury-fee-values.test.ts`
Expected: todo PASS.

- [ ] **Step 6: Test que falla — la ruta**

Crear `tests/accrual-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  // `BigInt(11)` y no `11n`: el target del proyecto es ES2017.
  create: vi.fn(async () => ({ id: BigInt(11) })),
  update: vi.fn(async () => ({})),
  run: vi.fn(),
  willAct: vi.fn(() => true),
  audit: vi.fn(async () => {}),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { cronRun: { create: mocks.create, update: mocks.update } } }));
vi.mock("@/lib/treasury/accrual", () => ({ accrualCron: { run: mocks.run, willAct: mocks.willAct } }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
import { POST } from "@/app/api/cron/accrual/route";

const summary = { membersScanned: 35, membersAccrued: 35, feesCreated: 35, backfilled: 0, upTo: "2026-09", errors: [] as string[], errorsOmitted: 0 };
const req = (auth?: string) => new Request("http://x/api/cron/accrual", { method: "POST", headers: auth ? { authorization: auth } : {} });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "s3cret";
  mocks.willAct.mockReturnValue(true);
  mocks.run.mockResolvedValue(summary);
});

describe("POST /api/cron/accrual", () => {
  it("sin CRON_SECRET → 503", async () => {
    delete process.env.CRON_SECRET;
    expect((await POST(req("Bearer x"))).status).toBe(503);
  });
  it("bearer incorrecto → 401", async () => {
    expect((await POST(req("Bearer nope"))).status).toBe(401);
  });
  it("un día que no es 1 → 200 skipped y NO escribe CronRun", async () => {
    mocks.willAct.mockReturnValue(false);
    const res = await POST(req("Bearer s3cret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ skipped: "not_first_day" });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it("el día 1 → 200, CronRun abierto y cerrado, asiento accrual_cron", async () => {
    const res = await POST(req("Bearer s3cret"));
    expect(res.status).toBe(200);
    expect(mocks.create).toHaveBeenCalledWith({ data: { job: "accrual", startedAt: expect.any(Date) } });
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: BigInt(11) }, data: { finishedAt: expect.any(Date), ok: true, summary } });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "accrual_cron", entity: "cron", detail: summary }));
  });
  it("con errores → 207 y ok:false", async () => {
    mocks.run.mockResolvedValue({ ...summary, errors: ["member:4: deadlock"] });
    expect((await POST(req("Bearer s3cret"))).status).toBe(207);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ ok: false }) }));
  });
  it("se cae entera → 500 y el CronRun queda con error", async () => {
    mocks.run.mockRejectedValue(new Error("db down"));
    expect((await POST(req("Bearer s3cret"))).status).toBe(500);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ ok: false, error: expect.stringContaining("db down") }),
    }));
  });
});
```

- [ ] **Step 7: Correr y ver el fallo**

Run: `npx vitest run tests/accrual-route.test.ts`
Expected: falla con `Failed to resolve import "@/app/api/cron/accrual/route"`.

- [ ] **Step 8: Implementación — `src/app/api/cron/accrual/route.ts`**

```ts
// POST /api/cron/accrual — lo dispara el crontab del VPS todos los días a las
// 00:30 (docs/11, crontab final de 6 líneas). ACTÚA sólo el día 1: la decisión
// vive en el módulo (`accrualCron.willAct()`), no acá, y un día que no
// corresponde NO abre fila en `cron_runs` — /admin/salud muestra la última
// corrida EFECTIVA, así que una fila vacía por día sería ruido que tapa la señal.
import { audit } from "@/lib/audit";
import { checkCronAuth, CRON_JOBS } from "@/lib/cron/auth";
import { safeMessage } from "@/lib/log-safe";
import { prisma } from "@/lib/prisma";
import { accrualCron } from "@/lib/treasury/accrual";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = checkCronAuth(req);
  if (!auth.ok) return auth.response;
  if (!accrualCron.willAct()) return Response.json({ skipped: "not_first_day" });

  const run = await prisma.cronRun.create({ data: { job: CRON_JOBS.accrual, startedAt: new Date() } });
  try {
    const summary = await accrualCron.run();
    const ok = summary.errors.length === 0;
    await prisma.cronRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), ok, summary } });
    // Sin datos personales: contadores, el mes devengado y los ids internos que
    // ya vienen recortados en `errors` (docs/08).
    await audit({ action: "accrual_cron", entity: "cron", entityId: String(run.id), detail: summary });
    return Response.json(summary, { status: ok ? 200 : 207 });
  } catch (e) {
    // `run()` ya se come el fallo de cada socio: llegar acá es que se cayó una
    // consulta entera. Al cuerpo no va el mensaje (lo lee un curl en un log).
    console.error("[cron] accrual: la corrida falló entera", safeMessage(e));
    await prisma.cronRun.update({
      where: { id: run.id },
      data: { finishedAt: new Date(), ok: false, error: safeMessage(e).slice(0, 500) },
    }).catch(() => {});
    return Response.json({ error: "cron_failed" }, { status: 500 });
  }
}
```

- [ ] **Step 9: Correr y ver verde**

Run: `npx vitest run tests/accrual-route.test.ts`
Expected: 6 tests PASS.

- [ ] **Step 10: Test que falla — el pago tolera el P2002 del devengo**

Hoy `service.ts:319-326` sólo captura el P2002 cuando es de `mpPaymentId`; cualquier otro se **re-lanza**. Si un pago cae justo cuando el devengo escribe el mismo período, el webhook devuelve 500 y MP reintenta un cobro que ya hizo. Agregar a `tests/treasury-service.test.ts`, dentro del `describe` de `registerPayment`, **reusando los helpers de fixtures que el archivo ya tiene** (no crear fixtures nuevos; si los nombres difieren, usar los existentes):

```ts
  it("tolera el P2002 de (memberId, period): recalcula la imputación y reintenta UNA vez", async () => {
    // Primera vuelta: el devengo escribió 2026-09 entre el findMany y el
    // createMany del pago. Segunda vuelta: la cuota ya existe y se imputa.
    let attempt = 0;
    const $transaction = vi.fn(async (fn: (t: unknown) => Promise<unknown>) => {
      attempt++;
      if (attempt === 1) throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      return fn(txClient());
    });
    const service = makeTreasuryService({ ...deps, db: { ...deps.db, $transaction } as never });
    const r = await service.registerPayment({ ...baseInput, memberId: 1, type: "cash", n: 1 });
    expect(r.kind).toBe("registered");
    expect($transaction).toHaveBeenCalledTimes(2);
  });

  it("no reintenta dos veces: el segundo P2002 se propaga", async () => {
    const $transaction = vi.fn(async () => {
      throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    });
    const service = makeTreasuryService({ ...deps, db: { ...deps.db, $transaction } as never });
    await expect(service.registerPayment({ ...baseInput, memberId: 1, type: "cash", n: 1 })).rejects.toThrow();
    expect($transaction).toHaveBeenCalledTimes(2);
  });
```

- [ ] **Step 11: Correr y ver el fallo**

Run: `npx vitest run tests/treasury-service.test.ts`
Expected: el primero falla — `$transaction` se llama una sola vez y el P2002 se propaga.

- [ ] **Step 12: Implementación — reintento único en `registerPaymentCore`**

En `src/lib/treasury/service.ts`, cambiar la firma:

```ts
  async function registerPaymentCore(input: RegisterPaymentInput, retried = false): Promise<RegisterResult> {
```

y en el `catch` del `$transaction` (hoy líneas 315-326), **después** del bloque del `mpPaymentId` y **antes** del `throw e`, agregar:

```ts
      // Carrera con el cron de devengo (4C): entre el `findMany` de las cuotas y
      // este INSERT, el cron creó el mismo período y el unique (memberId, period)
      // mató la transacción entera. No es un fallo: la fila que faltaba ahora
      // existe. Se recalcula la imputación desde cero —vuelve a leer las cuotas y
      // a llamar a `allocate`— y se reintenta UNA vez. Sin esto, un pago que
      // llegara a las 00:30 del día 1 terminaba en 500 y MP reintentaba un cobro
      // que ya había hecho.
      //
      // Una sola vez a propósito: si el segundo intento también choca, el
      // problema no es la carrera y hay que verlo, no reintentarlo en bucle.
      if (!retried && input.memberId !== null && isUniqueViolation(e)) {
        console.warn("[treasury] P2002 al imputar: se recalcula la imputación y se reintenta", input.memberId);
        return registerPaymentCore(input, true);
      }
      throw e;
```

- [ ] **Step 13: Correr y ver verde**

Run: `npx vitest run tests/treasury-service.test.ts`
Expected: PASS, incluidos los dos casos nuevos.
(El de integración `tests/integration/mp-apply-concurrency.test.ts` necesita MariaDB arriba: si el contenedor no está, dejarlo anotado en el ledger para la Task 16, que corre la batería completa.)

- [ ] **Step 14: Suite completa y commit**

Run: `npm test 2>&1 | tail -5 && npx tsc --noEmit && npm run lint`

```bash
git add -A && git commit -m "feat(m4c): the accrual cron — debt that materialises itself on the 1st, backfill included

The deadline was 01/10/2026: from October a member who owed September would
have shown as up to date, because the debt screens count rows and the import
only brought what was unpaid. The row is written on the 1st of the FOLLOWING
month, when the fee is already arrears, so the 21 places that count pending
rows stay correct untouched.

Also: registerPayment now survives the P2002 the accrual can cause on a
simultaneous payment (one retry, recomputing the allocation), and the two
comments claiming the accrual needs a fee value are gone — a Fee carries no
amount.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: El mailer dice la verdad — `Notification.failed`

Spec §7.1 y §7.2. Hoy `makeMailer().send()` **envía primero y registra después** (`email/index.ts:19-32`), así que un fallo de transporte **no deja fila**: el rastro muere repartido en diez `console.error` distintos. La columna `error VARCHAR(200)` y el estado `failed` existen en base desde la migración de la 4A y **nadie los escribe**.

> Esta tarea toca el mailer que usan wizard, panel y crons por igual: los tests existentes de email **no pueden romperse**.

**Files:**
- Modify: `src/lib/email/index.ts`
- Modify: `tests/email.test.ts`

**Interfaces:**
- Consumes: `MailTransport` (`src/lib/email/transport.ts:15`), el `code: "EMAIL_ALLOWLIST"` que `makeAllowlistTransport` adjunta al error (`transport.ts:67-70`), `Notification.period` (Task 2).
- Produces:

```ts
// src/lib/email/index.ts — firmas públicas ampliadas (todo lo nuevo es OPCIONAL)
sendToMember(input: {
  memberId: number | null; to: string; type: NotificationType;
  message: Omit<MailMessage, "to">; summary: string;
  /** "YYYY-MM" cuando el aviso se refiere a un período (la dedupe del
   *  recordatorio de vencimiento la consulta contra esta columna). */
  period?: string | null;
}): Promise<{ messageId: string | null }>;

sendToApplication(input: {
  applicationId: number; to: string; type: NotificationType;
  message: Omit<MailMessage, "to">; summary: string; period?: string | null;
}): Promise<{ messageId: string | null }>;
```

Comportamiento nuevo: un fallo REAL del transporte escribe `Notification` con `status: "failed"` y `error` = **el código** del fallo (nunca el mensaje, que trae la dirección) y **vuelve a lanzar**; un bloqueo por `EMAIL_ALLOWLIST` **no** escribe nada y lanza igual que hoy.

- [ ] **Step 1: Test que falla**

Agregar a `tests/email.test.ts` un `describe` nuevo:

```ts
describe("makeMailer: el fallo deja rastro", () => {
  const message = { subject: "s", text: "t", html: "<p>t</p>" };

  function mailerWith(sendImpl: () => Promise<{ messageId: string | null }>) {
    const create = vi.fn(async () => ({}));
    const mailer = makeMailer({ transport: { send: sendImpl }, db: { notification: { create } } as never });
    return { mailer, create };
  }

  it("el envío exitoso sigue registrando `sent` (y ahora también el período)", async () => {
    const { mailer, create } = mailerWith(async () => ({ messageId: "brevo-1" }));
    await mailer.sendToMember({ memberId: 4, to: "a@b.com", type: "fee_reminder", message, summary: "s", period: "2026-09" });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ memberId: 4, status: "sent", brevoMessageId: "brevo-1", period: "2026-09" }),
    });
  });

  it("un SMTP caído deja una fila `failed` con el CÓDIGO y vuelve a lanzar", async () => {
    const { mailer, create } = mailerWith(async () => {
      throw Object.assign(new Error("connect ECONNREFUSED 1.2.3.4:587 a@b.com"), { code: "ECONNREFUSED" });
    });
    await expect(mailer.sendToMember({ memberId: 4, to: "a@b.com", type: "receipt", message, summary: "recibo 0001" }))
      .rejects.toThrow();
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ memberId: 4, type: "receipt", status: "failed", error: "ECONNREFUSED", brevoMessageId: null }),
    });
    // El error de nodemailer trae la dirección en claro: al `error` va sólo el
    // código, nunca el mensaje (docs/08, Ley 25.326).
    const written = create.mock.calls[0][0].data as { error: string };
    expect(written.error).not.toContain("@");
  });

  it("un bloqueo de EMAIL_ALLOWLIST NO es un fallo: no escribe fila (es el entorno funcionando)", async () => {
    const { mailer, create } = mailerWith(async () => {
      throw Object.assign(new Error("Envíos restringidos"), { code: "EMAIL_ALLOWLIST" });
    });
    await expect(mailer.sendToMember({ memberId: 4, to: "x@y.com", type: "receipt", message, summary: "s" }))
      .rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });

  it("si la propia fila `failed` no se puede escribir, gana el error del envío", async () => {
    const create = vi.fn(async () => { throw new Error("db down"); });
    const mailer = makeMailer({
      transport: { send: async () => { throw Object.assign(new Error("smtp"), { code: "EAUTH" }); } },
      db: { notification: { create } } as never,
    });
    await expect(mailer.sendToMember({ memberId: 1, to: "a@b.com", type: "generic", message, summary: "s" }))
      .rejects.toThrow(/smtp/);
  });

  it("un aviso a una solicitud también deja su `failed` colgando de la solicitud", async () => {
    const { mailer, create } = mailerWith(async () => { throw Object.assign(new Error("x"), { code: "EENVELOPE" }); });
    await expect(mailer.sendToApplication({ applicationId: 9, to: "a@b.com", type: "application_result", message, summary: "s" }))
      .rejects.toThrow();
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ applicationId: 9, memberId: null, status: "failed", error: "EENVELOPE" }),
    });
  });
});
```

- [ ] **Step 2: Correr y ver el fallo**

Run: `npx vitest run tests/email.test.ts`
Expected: fallan los casos de `failed` (hoy la excepción sale antes del `create`).

- [ ] **Step 3: Implementación**

Reemplazar el cuerpo de `send` y las dos superficies públicas en `src/lib/email/index.ts`:

```ts
// Solo el CÓDIGO del fallo: el error de nodemailer trae `envelope`, `rejected`
// y el `response` del SMTP —o sea la dirección del vecino en claro— y la
// columna `error` es la que va a mostrar /admin/salud (docs/08, Ley 25.326).
function failureCode(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  if (typeof code === "string" && code !== "") return code.slice(0, 200);
  const name = (e as { name?: unknown } | null)?.name;
  return typeof name === "string" && name !== "" ? name.slice(0, 200) : "unknown";
}

/** El bloqueo del entorno de prueba NO es un fallo de envío: es la guarda
 *  funcionando (`transport.ts:60-75`). Si escribiera `failed`, el piloto con
 *  `EMAIL_ALLOWLIST` puesta llenaría la pantalla de salud de rojo por diseño. */
const ALLOWLIST_CODE = "EMAIL_ALLOWLIST";

export function makeMailer(deps: MailerDeps) {
  async function send(input: {
    memberId: number | null;
    applicationId: number | null;
    to: string;
    type: NotificationType;
    message: Omit<MailMessage, "to">;
    summary: string;
    period?: string | null;
  }): Promise<{ messageId: string | null }> {
    const row = {
      memberId: input.memberId,
      applicationId: input.applicationId,
      type: input.type,
      via: "email" as const,
      payloadSummary: input.summary,
      period: input.period ?? null,
    };
    let messageId: string | null;
    try {
      ({ messageId } = await deps.transport.send({ to: input.to, ...input.message }));
    } catch (e) {
      // Hasta la 4C, "envío fallido" era "no hay fila": la escritura estaba
      // DESPUÉS del envío para no acreditar como fehaciente (Art. 5° quater) un
      // correo que nunca salió. La fila `failed` no invierte ese argumento: es el
      // registro de un INTENTO, no una acreditación —la distinción vive en el
      // comentario del modelo y en la pantalla, que las separa—. Lo que no se
      // podía seguir sosteniendo es que el hueco no quedara en ningún lado: hoy
      // el rastro muere en el log de PM2, que rota a los 7 días.
      if (failureCode(e) !== ALLOWLIST_CODE) {
        // `.catch()`: si la base también está caída, el error que tiene que
        // llegar al llamador es el del ENVÍO, no el del registro del envío.
        await deps.db.notification.create({
          data: { ...row, status: "failed", brevoMessageId: null, error: failureCode(e) },
        }).catch((err) => console.error("[mail] no se pudo registrar la notificación fallida", failureCode(err)));
      }
      throw e;
    }
    await deps.db.notification.create({
      data: { ...row, status: "sent", brevoMessageId: messageId },
    });
    return { messageId };
  }
  return {
    sendToMember(input: {
      memberId: number | null;
      to: string;
      type: NotificationType;
      message: Omit<MailMessage, "to">;
      summary: string;
      period?: string | null;
    }) {
      return send({ ...input, applicationId: null });
    },
    // El destinatario todavía no es socio, pero el envío queda acreditado
    // igual (Art. 5° quater): la Notification cuelga de la solicitud.
    sendToApplication(input: {
      applicationId: number;
      to: string;
      type: NotificationType;
      message: Omit<MailMessage, "to">;
      summary: string;
      period?: string | null;
    }) {
      return send({ ...input, memberId: null });
    },
  };
}
```

- [ ] **Step 4: El comentario del modelo dice qué es una fila `failed`**

En `prisma/schema.prisma`, ampliar el comentario de `Notification.error`:

```prisma
  // Código del error de envío cuando `status = failed` (4C). Nunca la dirección.
  // Una fila `failed` registra un INTENTO, no una acreditación fehaciente
  // (Art. 5° quater): el correo no salió. Las pantallas que listan
  // notificaciones tienen que poder distinguirlas de una `sent`.
  error          String?            @db.VarChar(200)
```

(No hace falta migrar: es un comentario.)

- [ ] **Step 5: Correr y ver verde**

Run: `npx vitest run tests/email.test.ts tests/allowlist-transport.test.ts tests/application-emails.test.ts tests/treasury-receipt-email.test.ts tests/account-email-notice.test.ts`
Expected: todo PASS — ninguno de los doce call-sites cambia de comportamiento (la excepción sigue propagando exactamente igual).

- [ ] **Step 6: Suite completa y commit**

Run: `npm test 2>&1 | tail -5 && npx tsc --noEmit && npm run lint`

```bash
git add -A && git commit -m "feat(m4c): a failed email finally leaves a row

The enum value and the error column shipped with 4A and nobody wrote them: a
broken transport left its only trace in a PM2 log that rotates after 7 days.
The write lives in the mailer, so all twelve call sites are covered at once —
same argument that put EMAIL_ALLOWLIST in the transport. An allowlist block is
not a failure and writes nothing.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Tope de envíos por corrida (`MAIL_BATCH_CAP`)

Spec §7.3. El 23/08/2026 la conciliación recuperó 24 débitos históricos de un solo socio y **le mandó los 24 recibos de golpe** (`docs/07:300-304`, verificado: llegaron los 24). Los dos bucles que envían en lote son el de la vinculación (`vincular/actions.ts:69-76`) y el camino de recibos del reconcile (vía `webhook-processor.emailReceipt`, alcanzado por `reconcile.ts:182` y `:213`). Ninguno tiene techo.

El presupuesto se **inyecta por llamada** y no vive en el procesador: el procesador es un singleton de proceso, y un contador global dejaría al webhook sin poder mandar recibos después de 50 correos desde el arranque de PM2.

**Files:**
- Create: `src/lib/email/batch-cap.ts`, `tests/mail-batch-cap.test.ts`
- Modify: `src/lib/mp/webhook-processor.ts`, `src/lib/mp/reconcile.ts`, `src/app/admin/tesoreria/suscripciones/[preapprovalId]/vincular/actions.ts`, `src/app/admin/tesoreria/suscripciones/page.tsx`, `.env.example`
- Modify: `tests/mp-reconcile.test.ts`, `tests/mp-reconcile-route.test.ts`, `tests/mp-webhook-processor.test.ts`

**Interfaces:**
- Consumes: `deps.sendReceiptEmail(receiptId)` (`webhook-processor.ts:92`), `sendReceiptEmail` (`@/lib/treasury/receipt-email`), `ReconcileSummary` (`reconcile.ts:76`).
- Produces:

```ts
// src/lib/email/batch-cap.ts
export const DEFAULT_MAIL_BATCH_CAP = 50;
export function mailBatchCap(raw?: string | undefined): number;
export type MailBudget = { take(): boolean; readonly deferred: number };
export function makeMailBudget(cap?: number): MailBudget;
/** Presupuesto que nunca dice que no: el camino de un solo email (webhook,
 *  panel) no tiene por qué contar. */
export const UNLIMITED_MAIL_BUDGET: MailBudget;

// src/lib/mp/webhook-processor.ts — tercer parámetro OPCIONAL
applyPayment(p: MpPaymentDetails, preapprovalId: string | null, opts?: { mailBudget?: MailBudget }): Promise<WebhookResult>;

// src/lib/mp/reconcile.ts
export type ReconcileSummary = { /* …los 15 campos de hoy… */ deferred: number };
```

- [ ] **Step 1: Test que falla — el presupuesto**

Crear `tests/mail-batch-cap.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_MAIL_BATCH_CAP, mailBatchCap, makeMailBudget, UNLIMITED_MAIL_BUDGET } from "@/lib/email/batch-cap";

describe("mailBatchCap", () => {
  it("sin variable, 50", () => {
    expect(mailBatchCap(undefined)).toBe(DEFAULT_MAIL_BATCH_CAP);
    expect(DEFAULT_MAIL_BATCH_CAP).toBe(50);
  });
  it("un valor entero positivo manda", () => {
    expect(mailBatchCap("5")).toBe(5);
  });
  it("basura o cero caen al default: un tope de 0 apagaría todos los avisos en silencio", () => {
    for (const raw of ["", "0", "-3", "muchos", "3.5"]) expect(mailBatchCap(raw)).toBe(DEFAULT_MAIL_BATCH_CAP);
  });
});

describe("makeMailBudget", () => {
  it("da permiso hasta el tope y después cuenta diferidos", () => {
    const b = makeMailBudget(2);
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(false);
    expect(b.take()).toBe(false);
    expect(b.deferred).toBe(2);
  });
  it("sin consumo, cero diferidos", () => {
    expect(makeMailBudget(2).deferred).toBe(0);
  });
  it("el presupuesto ilimitado no cuenta nada", () => {
    for (let i = 0; i < 100; i++) expect(UNLIMITED_MAIL_BUDGET.take()).toBe(true);
    expect(UNLIMITED_MAIL_BUDGET.deferred).toBe(0);
  });
});
```

- [ ] **Step 2: Correr y ver el fallo**

Run: `npx vitest run tests/mail-batch-cap.test.ts`
Expected: `Failed to resolve import "@/lib/email/batch-cap"`.

- [ ] **Step 3: Implementación — `src/lib/email/batch-cap.ts`**

```ts
// Tope de envíos por corrida (spec 4C §7.3).
//
// El 23/08/2026 la conciliación recuperó 24 débitos históricos de un socio y le
// mandó los 24 recibos en minutos. Con 160 socios vigentes y sin
// `EMAIL_ALLOWLIST`, un backlog son cientos de correos contra la cuota de Brevo
// —y un vecino que recibe 24 mails no lee ninguno.
//
// El presupuesto se INYECTA por corrida y no es un contador de módulo: el
// procesador del webhook es un singleton de proceso, así que un contador global
// dejaría al webhook sin poder mandar un recibo después de 50 correos desde el
// último restart de PM2.

export const DEFAULT_MAIL_BATCH_CAP = 50;

/** Entero positivo o el default. Un `0` o una basura NO apagan los avisos: un
 *  tope de cero silenciaría el sistema entero por un typo en el `.env`. */
export function mailBatchCap(raw: string | undefined = process.env.MAIL_BATCH_CAP): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_MAIL_BATCH_CAP;
}

export type MailBudget = { take(): boolean; readonly deferred: number };

export function makeMailBudget(cap: number = mailBatchCap()): MailBudget {
  let used = 0;
  let deferred = 0;
  return {
    take() {
      if (used >= cap) { deferred++; return false; }
      used++;
      return true;
    },
    get deferred() { return deferred; },
  };
}

/** El camino de UN solo email (webhook de un cobro, botón del panel) no cuenta:
 *  ahí el tope no protege de nada y convertiría un envío legítimo en un
 *  diferido invisible. */
export const UNLIMITED_MAIL_BUDGET: MailBudget = { take: () => true, deferred: 0 };
```

- [ ] **Step 4: Correr y ver verde**

Run: `npx vitest run tests/mail-batch-cap.test.ts`
Expected: 6 tests PASS.

- [ ] **Step 5: El procesador acepta un presupuesto por llamada**

En `src/lib/mp/webhook-processor.ts`:

1. Importar: `import { UNLIMITED_MAIL_BUDGET, type MailBudget } from "@/lib/email/batch-cap";`
2. Cambiar `emailReceipt` para que reciba el presupuesto:

```ts
  async function emailReceipt(receiptId: number, budget: MailBudget): Promise<string> {
    // El tope se consulta ANTES de leer el PDF: diferir tiene que ser barato.
    // Un recibo diferido no se pierde — se manda desde su propia pantalla con
    // "Reenviar por email", que es el reintento por entidad del proyecto.
    if (!budget.take()) return "deferred";
    try {
      const r = await deps.sendReceiptEmail(receiptId);
      return r.sent ? "sent" : r.reason;
    } catch (e) {
      // `sendReceiptEmail` es best-effort por contrato, pero si algún día tira,
      // el cobro ya está asentado: no puede volverse un 500.
      console.error("[mp-webhook] sendReceiptEmail lanzó", receiptId, codeOf(e));
      return "error";
    }
  }
```

3. `applyToMember` recibe y propaga el presupuesto: cambiar su firma a
   `async function applyToMember(p, d, ctx, budget: MailBudget)` y la línea
   `const emailed = await emailReceipt(r.receiptId);` por
   `const emailed = await emailReceipt(r.receiptId, budget);`.
4. `applyEntry` hace lo mismo: gana `budget: MailBudget` como último parámetro y su llamada de la rama `r.kind === "registered"` (hoy `const emailed = await emailReceipt(r.receiptId);`, línea 372) pasa a `await emailReceipt(r.receiptId, budget)`.
5. `applyPayment` gana el tercer parámetro y lo pasa hacia abajo:

```ts
  async function applyPayment(
    p: MpPaymentDetails,
    preapprovalId: string | null,
    opts?: { mailBudget?: MailBudget },
  ): Promise<WebhookResult> {
    const budget = opts?.mailBudget ?? UNLIMITED_MAIL_BUDGET;
```

y en el `switch`, `case "debit": case "link": return applyToMember(p, decision, ctx, budget);`
(y el `applyEntry(...)` con `budget` como último argumento).

- [ ] **Step 6: El reconcile abre un presupuesto por corrida y lo informa**

En `src/lib/mp/reconcile.ts`:

1. `import { makeMailBudget, type MailBudget } from "@/lib/email/batch-cap";`
2. En `ReconcileSummary`, después de `planDivergent`:

```ts
  /** Recibos que la corrida NO mandó por el tope de envíos (`MAIL_BATCH_CAP`).
   *  No se pierden: se reenvían desde la pantalla del recibo. Que el número esté
   *  en el summary es la mitad del punto — un tope silencioso es peor que no
   *  tener tope. */
  deferred: number;
```

3. En `Deps`, el procesador acepta el presupuesto:

```ts
  processor: {
    applyPayment(
      payment: MpPaymentDetails,
      preapprovalId: string | null,
      opts?: { mailBudget?: MailBudget },
    ): Promise<string>;
  };
```

4. Dentro de `run()`, después de armar `s` (que ahora inicializa `deferred: 0`):

```ts
      // Un presupuesto POR CORRIDA: lo que exceda el tope queda para la
      // siguiente (o para el botón "Reenviar" del recibo). Vive acá y no en el
      // procesador porque el procesador es un singleton de proceso.
      const mailBudget = makeMailBudget();
```

5. Las dos llamadas pasan a `count(await deps.processor.applyPayment(p, null, { mailBudget }), "payments");` y `count(await deps.processor.applyPayment(p, sub.preapprovalId, { mailBudget }), "debits");`.
6. Antes del `return s;` final: `s.deferred = mailBudget.deferred;`

- [ ] **Step 7: Ajustar los tests del reconcile y del procesador**

En `tests/mp-reconcile.test.ts` y `tests/mp-reconcile-route.test.ts`, agregar `deferred: 0` a los objetos `ReconcileSummary` esperados. Agregar además a `tests/mp-reconcile.test.ts`:

```ts
  it("con el tope alcanzado, los recibos que sobran se cuentan en `deferred`", async () => {
    process.env.MAIL_BATCH_CAP = "1";
    // Dos débitos recuperables: el procesador consume el presupuesto en el
    // primero y el segundo queda diferido.
    const applyPayment = vi.fn(async (_p: unknown, _pre: unknown, opts?: { mailBudget?: { take(): boolean } }) => {
      opts?.mailBudget?.take();
      return "debit_applied";
    });
    const s = await makeReconcile({ ...deps, processor: { applyPayment } } as never).run();
    expect(s.deferred).toBeGreaterThanOrEqual(1);
    delete process.env.MAIL_BATCH_CAP;
  });
```

(usando los fixtures que el archivo ya tiene para que la corrida encuentre dos débitos).

En `tests/mp-webhook-processor.test.ts`, agregar:

```ts
  it("sin presupuesto, el webhook manda el recibo como siempre", async () => {
    // El camino de un solo cobro no puede quedar limitado por un tope pensado
    // para lotes: `applyPayment` sin `opts` usa el presupuesto ilimitado.
    await processor.applyPayment(approvedPayment, "pre-1");
    expect(deps.sendReceiptEmail).toHaveBeenCalled();
  });
  it("con el presupuesto agotado, el recibo se difiere y el cobro se asienta igual", async () => {
    const spent = { take: () => false, deferred: 1 };
    const r = await processor.applyPayment(approvedPayment, "pre-1", { mailBudget: spent });
    expect(r).toBe("debit_applied");
    expect(deps.sendReceiptEmail).not.toHaveBeenCalled();
    expect(deps.audit).toHaveBeenCalledWith(expect.objectContaining({
      detail: expect.objectContaining({ emailed: "deferred" }),
    }));
  });
```

- [ ] **Step 8: La vinculación también tiene techo**

En `src/app/admin/tesoreria/suscripciones/[preapprovalId]/vincular/actions.ts`, reemplazar el bucle de recibos (líneas 66-77):

```ts
  // El aviso del recibo es best-effort, como en el webhook: la plata ya está
  // asentada y el recibo se puede reenviar desde su pantalla.
  //
  // Con techo: vincular una suscripción vieja puede recuperar decenas de cobros
  // históricos de una sola persona (el 23/08/2026 fueron 24 recibos a un mismo
  // socio en minutos). Lo que excede el tope NO se pierde: queda sin enviar y la
  // pantalla lo dice, para que el operador los mande desde Recibos.
  const mailBudget = makeMailBudget();
  let emailed = 0;
  for (const a of result.applied) {
    if (!mailBudget.take()) continue;
    try {
      if ((await sendReceiptEmail(a.receiptId)).sent) emailed++;
    } catch (e) {
      // Best-effort, pero no invisible: sin esta línea el único rastro del
      // fallo es el `emailed` del asiento, que no dice cuál recibo ni por qué.
      console.error("[suscripciones] no se pudo enviar el recibo", a.receiptId, "code:", codeOf(e));
    }
  }
```

(más `import { makeMailBudget } from "@/lib/email/batch-cap";`), agregar `deferred: mailBudget.deferred` al `detail` del asiento `subscription_linked`, y sumar el parámetro al redirect:

```ts
  redirect(
    `/admin/tesoreria/suscripciones?vinculada=${encodeURIComponent(preapprovalId)}` +
      `&aplicados=${result.applied.length}&pendientes=${result.unapplied}&diferidos=${mailBudget.deferred}`,
  );
```

- [ ] **Step 9: La pantalla lo dice**

> Cargar el skill `frontend-design` antes de escribir JSX.

En `src/app/admin/tesoreria/suscripciones/page.tsx`, después de `const stillPending = ...` agregar `const deferredMails = Number(one(sp.diferidos) ?? 0);` y, dentro del `FormMessage` de `justLinked`, después del bloque de `stillPending`:

```tsx
          {deferredMails > 0 && (
            <>
              {" "}
              <Link
                className="font-medium underline underline-offset-2 outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                href="/admin/tesoreria/recibos"
              >
                {`${deferredMails} ${deferredMails === 1 ? "recibo quedó" : "recibos quedaron"} sin enviar por el tope de correos: mandalos desde Recibos.`}
              </Link>
            </>
          )}
```

- [ ] **Step 10: `.env.example`**

Después del bloque de `EMAIL_ALLOWLIST`, agregar:

```
# Tope de correos por corrida de cron o por lote del panel (Módulo 4C). Lo que
# excede queda para la corrida siguiente y el summary lo dice (`deferred: N`).
# Sin definir, 50. Un 0 o una basura caen al default: un tope de cero apagaría
# todos los avisos en silencio.
MAIL_BATCH_CAP=
```

- [ ] **Step 11: Correr y ver verde**

Run: `npx vitest run tests/mail-batch-cap.test.ts tests/mp-reconcile.test.ts tests/mp-reconcile-route.test.ts tests/mp-webhook-processor.test.ts tests/subscriptions-actions-auth.test.ts`
Expected: todo PASS.

- [ ] **Step 12: Suite completa y commit**

Run: `npm test 2>&1 | tail -5 && npx tsc --noEmit && npm run lint`

```bash
git add -A && git commit -m "feat(m4c): a ceiling on how many emails one run may send

One member got 24 receipts in minutes on 23/08 when the reconcile recovered his
historical debits. The budget is injected per run, not held in the processor
singleton, so a webhook handling a single payment is never throttled — and what
gets deferred is counted in the summary, because a silent cap is worse than none.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Recordatorio de vencimiento — `POST /api/cron/reminder`

Spec §5. Corre a diario a las 10:00 y **actúa el ÚLTIMO día civil del mes** — no "el 30", que en febrero no existe y ese mes nunca avisaría. El aviso va **antes** de caer en mora: el día 1 no se manda nada.

**Files:**
- Create: `src/lib/treasury/reminder.ts`, `src/app/api/cron/reminder/route.ts`
- Create: `tests/treasury-reminder.test.ts`, `tests/reminder-route.test.ts`
- Modify: `src/lib/treasury/periods.ts` (`isLastCivilDayOfMonth`), `src/lib/email/templates.ts` (`feeReminderEmail`), `tests/email.test.ts`, `tests/treasury-periods.test.ts`

**Interfaces:**
- Consumes: `mailer.sendToMember({ …, period })` (Task 5), `makeMailBudget` / `MailBudget` (Task 6), `feeValueReader.current(at)` (`fee-values.ts:47`), `feeAmountFor(category, v)` / `debtAmount(pending, category, v)` / `ACCRUING_CATEGORIES` (`rules.ts`), `currentPeriod(now)` / `periodLabel(p)` / `civilDayOf(at)` (`periods.ts`), `checkCronAuth` / `CRON_JOBS` (Task 1), `Notification.period` (Task 2).
- Produces:

```ts
// src/lib/treasury/periods.ts
export function isLastCivilDayOfMonth(at?: Date): boolean;

// src/lib/email/templates.ts
export function feeReminderEmail(opts: {
  name: string;
  period: string;          // "YYYY-MM"
  amount: number | null;   // cuota del mes a valor vigente, o null si no rige ninguno
  arrears: number;         // cuotas atrasadas que arrastra (0 = está al día)
  debt: number | null;     // deuda arrastrada a valor vigente
}): { subject: string; text: string; html: string };

// src/lib/treasury/reminder.ts
export type ReminderSummary = {
  period: Period;
  candidates: number;        // devengantes vigentes sin la cuota del mes paga
  sent: number;
  alreadyNotified: number;   // dedupe: ya tenían el aviso de ESTE período
  noEmail: number;           // sin casilla utilizable → lista de gestión manual
  deferred: number;          // los que excedieron MAIL_BATCH_CAP
  errors: string[];
  errorsOmitted: number;
};
export function makeReminderCron(deps: {
  db: Pick<PrismaClient, "member" | "fee" | "notification">;
  mailer: Pick<typeof mailer, "sendToMember">;
  feeValues: Pick<ReturnType<typeof makeFeeValueReader>, "current">;
  now?: () => Date;
}): { willAct(): boolean; run(): Promise<ReminderSummary> };
export const reminderCron: ReturnType<typeof makeReminderCron>;
```

- [ ] **Step 1: Test que falla — el último día del mes**

Agregar a `tests/treasury-periods.test.ts`:

```ts
describe("isLastCivilDayOfMonth", () => {
  it("el 30/09 a las 10:00 AR es el último día de septiembre", () => {
    expect(isLastCivilDayOfMonth(new Date("2026-09-30T13:00:00Z"))).toBe(true);
  });
  it("el 29/09 no", () => {
    expect(isLastCivilDayOfMonth(new Date("2026-09-29T13:00:00Z"))).toBe(false);
  });
  it("febrero avisa el 28 (y el 29 en bisiesto): el aviso no se salta un mes", () => {
    expect(isLastCivilDayOfMonth(new Date("2027-02-28T13:00:00Z"))).toBe(true);
    expect(isLastCivilDayOfMonth(new Date("2028-02-29T13:00:00Z"))).toBe(true);
    expect(isLastCivilDayOfMonth(new Date("2028-02-28T13:00:00Z"))).toBe(false);
  });
  it("el 31/12 a las 22:00 AR sigue siendo el último día de diciembre, aunque en UTC ya sea enero", () => {
    expect(isLastCivilDayOfMonth(new Date("2027-01-01T01:00:00Z"))).toBe(true);
  });
});
```

(agregar `isLastCivilDayOfMonth` al import del archivo).

- [ ] **Step 2: Correr y ver el fallo, e implementar**

Run: `npx vitest run tests/treasury-periods.test.ts` → falla la compilación.

En `src/lib/treasury/periods.ts`, junto a `isFirstCivilDayOfMonth`:

```ts
/** ¿El día civil ARGENTINO de `at` es el ÚLTIMO del mes? Lo pregunta el
 *  recordatorio de vencimiento, que avisa la víspera de la mora.
 *
 *  Se resuelve sumando un día al MEDIODÍA del día civil y mirando si cambió de
 *  mes: mediodía + 24 h sigue siendo mediodía, así que no hay borde de horario
 *  que lo confunda, y febrero (28 o 29) sale solo. Un cron atado al "día 30"
 *  simplemente no avisaría nunca en febrero. */
export function isLastCivilDayOfMonth(at: Date = new Date()): boolean {
  const today = civilDayOf(at);
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  return tomorrow.getUTCMonth() !== today.getUTCMonth();
}
```

Run: `npx vitest run tests/treasury-periods.test.ts` → PASS.

- [ ] **Step 3: Test que falla — la plantilla**

Agregar a `tests/email.test.ts`, dentro del `describe("templates")`:

```ts
  it("el recordatorio dice el mes, el importe y qué pasa mañana", () => {
    const m = feeReminderEmail({ name: "Ana", period: "2026-09", amount: 6000, arrears: 0, debt: 0 });
    expect(m.subject).toContain("Vecinal Ciudadela");
    for (const body of [m.text, m.html]) {
      expect(body).toContain("Ana");
      expect(body).toContain("septiembre");
      expect(body).toContain("6.000");
      // No hay que asustar a quien está al día: si no arrastra nada, el correo
      // no habla de deuda.
      expect(body).not.toContain("atrasada");
    }
  });
  it("si arrastra deuda, la nombra con cuotas y monto a valor vigente", () => {
    const m = feeReminderEmail({ name: "Ana", period: "2026-09", amount: 6000, arrears: 3, debt: 18000 });
    for (const body of [m.text, m.html]) {
      expect(body).toContain("3");
      expect(body).toContain("18.000");
    }
  });
  it("sin valor de cuota vigente no inventa un importe", () => {
    const m = feeReminderEmail({ name: "Ana", period: "2026-09", amount: null, arrears: 0, debt: null });
    expect(m.text).not.toContain("$");
    expect(m.text).toContain("septiembre");
  });
```

- [ ] **Step 4: Implementación de la plantilla**

En `src/lib/email/templates.ts`, agregar `import { periodLabel } from "@/lib/treasury/periods";` (módulo puro, sin Prisma) y, después de `paymentReminderEmail`:

```ts
/** Recordatorio de vencimiento (4C §5). Sale el ÚLTIMO día del mes: mañana la
 *  cuota pasa a ser mora.
 *
 *  Saluda por nombre —va a la casilla de la ficha del socio— y **no** trae link
 *  de pago: el link de Checkout Pro vence a las 72 h y lo emite un operador
 *  desde la ficha, así que meterlo acá sería prometer un camino que este correo
 *  no puede sostener. Se nombran las tres salidas reales: la sede, el débito
 *  automático y pedir un link. */
export function feeReminderEmail(opts: {
  name: string; period: string; amount: number | null; arrears: number; debt: number | null;
}): Rendered {
  const month = periodLabel(opts.period);
  const importe = opts.amount === null ? "" : ` de ${formatARS(opts.amount)}`;
  const arrearsText =
    opts.arrears > 0
      ? `\n\nAdemás tenés ${opts.arrears} ${opts.arrears === 1 ? "cuota atrasada" : "cuotas atrasadas"}${
          opts.debt === null ? "" : ` por ${formatARS(opts.debt)}`
        }.`
      : "";
  const arrearsHtml =
    opts.arrears > 0
      ? `<p>Además tenés <strong>${opts.arrears} ${opts.arrears === 1 ? "cuota atrasada" : "cuotas atrasadas"}</strong>${
          opts.debt === null ? "" : ` por <strong>${esc(formatARS(opts.debt))}</strong>`
        }.</p>`
      : "";
  return {
    subject: `Tu cuota de ${month} vence mañana — Vecinal Ciudadela`,
    text: `Hola ${opts.name}:

Te recordamos que tu cuota social de ${month}${importe} vence mañana.${arrearsText}

Podés pagarla en la sede, por débito automático o pidiéndonos un link de pago por Mercado Pago: respondé este mensaje y te lo mandamos.

Si ya pagaste, ignorá este correo.${SIGNATURE}`,
    html: layout(`Tu cuota de ${month} vence mañana`, `<p>Hola <strong>${esc(opts.name)}</strong>:</p>
<p>Te recordamos que tu <strong>cuota social de ${esc(month)}</strong>${opts.amount === null ? "" : ` de <strong>${esc(formatARS(opts.amount))}</strong>`} vence mañana.</p>
${arrearsHtml}
<p>Podés pagarla en la sede, por débito automático o pidiéndonos un link de pago por Mercado Pago: respondé este mensaje y te lo mandamos.</p>
<p>Si ya pagaste, ignorá este correo.</p>`),
  };
}
```

Run: `npx vitest run tests/email.test.ts` → PASS.

- [ ] **Step 5: Test que falla — el cron**

Crear `tests/treasury-reminder.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeReminderCron } from "@/lib/treasury/reminder";

const LAST_DAY = new Date("2026-09-30T13:00:00Z"); // 10:00 AR del 30/09
const MID_MONTH = new Date("2026-09-15T13:00:00Z");

type M = { id: number; fullName: string; email: string | null; emailStatus: string; category: string };
const socio = (over: Partial<M> = {}): M => ({
  id: 1, fullName: "Ana Gómez", email: "ana@example.com", emailStatus: "verified", category: "active", ...over,
});

function build(members: M[], opts?: {
  paidThisMonth?: number[];
  notified?: number[];
  pending?: Array<{ memberId: number; _count: { _all: number } }>;
  send?: ReturnType<typeof vi.fn>;
  now?: Date;
}) {
  const send = opts?.send ?? vi.fn(async () => ({ messageId: "id" }));
  const db = {
    member: { findMany: vi.fn(async () => members) },
    fee: {
      findMany: vi.fn(async () => (opts?.paidThisMonth ?? []).map((memberId) => ({ memberId }))),
      groupBy: vi.fn(async () => opts?.pending ?? []),
    },
    notification: { findMany: vi.fn(async () => (opts?.notified ?? []).map((memberId) => ({ memberId }))) },
  };
  const cron = makeReminderCron({
    db: db as never,
    mailer: { sendToMember: send },
    feeValues: { current: vi.fn(async () => ({ id: 1, activeAmount: 6000, sharedAmount: 3000, validFrom: new Date(), minuteId: null })) },
    now: () => opts?.now ?? LAST_DAY,
  });
  return { cron, db, send };
}

beforeEach(() => { delete process.env.MAIL_BATCH_CAP; });

describe("reminder cron", () => {
  it("willAct() sólo el último día civil del mes", () => {
    expect(build([]).cron.willAct()).toBe(true);
    expect(build([], { now: MID_MONTH }).cron.willAct()).toBe(false);
  });

  it("le avisa al devengante que no pagó el mes en curso", async () => {
    const { cron, send } = build([socio()]);
    const s = await cron.run();
    expect(s.period).toBe("2026-09");
    expect(s.candidates).toBe(1);
    expect(s.sent).toBe(1);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      memberId: 1, to: "ana@example.com", type: "fee_reminder", period: "2026-09",
    }));
  });

  it("al que ya pagó el mes NO se le avisa", async () => {
    const { cron, send } = build([socio()], { paidThisMonth: [1] });
    const s = await cron.run();
    expect(s.candidates).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("dedupe persistida: corrido dos veces, el segundo no reenvía", async () => {
    const { cron, send } = build([socio()], { notified: [1] });
    const s = await cron.run();
    expect(s.alreadyNotified).toBe(1);
    expect(s.sent).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("la dedupe NO cuenta los intentos fallidos: un `failed` no bloquea el reintento", async () => {
    const { cron, db } = build([socio()]);
    await cron.run();
    expect(db.notification.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        type: "fee_reminder", period: "2026-09", status: { not: "failed" },
      }),
    }));
  });

  it("el que no tiene casilla utilizable se cuenta aparte (va a la lista de gestión manual)", async () => {
    const { cron, send } = build([socio({ id: 2, email: null }), socio({ id: 3, emailStatus: "bounced" })]);
    const s = await cron.run();
    expect(s.noEmail).toBe(2);
    expect(send).not.toHaveBeenCalled();
  });

  it("si arrastra deuda, el correo la lleva a valor vigente", async () => {
    const { cron, send } = build([socio()], { pending: [{ memberId: 1, _count: { _all: 3 } }] });
    await cron.run();
    const msg = send.mock.calls[0][0].message;
    expect(msg.text).toContain("3");
    expect(msg.text).toContain("18.000"); // 3 × 6000, valor vigente del activo
  });

  it("el tope difiere lo que sobra y no lo pierde de vista", async () => {
    process.env.MAIL_BATCH_CAP = "1";
    const { cron, send } = build([socio({ id: 1 }), socio({ id: 2 })]);
    const s = await cron.run();
    expect(s.sent).toBe(1);
    expect(s.deferred).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("un envío que falla no frena a los demás y su CÓDIGO queda en errors[]", async () => {
    const send = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("connect ECONNREFUSED ana@example.com"), { code: "ECONNREFUSED" }))
      .mockResolvedValueOnce({ messageId: "id" });
    const { cron } = build([socio({ id: 1 }), socio({ id: 2 })], { send });
    const s = await cron.run();
    expect(s.sent).toBe(1);
    expect(s.errors).toEqual(["member:1: ECONNREFUSED"]);
    // Nunca la dirección: el error de nodemailer la trae en claro (docs/08).
    expect(s.errors[0]).not.toContain("@");
  });
});
```

- [ ] **Step 6: Correr y ver el fallo**

Run: `npx vitest run tests/treasury-reminder.test.ts`
Expected: `Failed to resolve import "@/lib/treasury/reminder"`.

- [ ] **Step 7: Implementación — `src/lib/treasury/reminder.ts`**

```ts
// Recordatorio de vencimiento (spec 4C §5). Corre a diario a las 10:00 y actúa
// el ÚLTIMO día civil del mes: mañana la cuota pasa a ser mora.
//
// Por qué el último día y no "el 30": febrero no tiene 30, y un aviso que se
// saltea un mes entero no es un aviso.
//
// Por qué antes de la mora y no después: el sistema avisa para que el socio
// pueda pagar, no para reprocharle. El aviso de mora (`arrears_alert`) sigue
// existiendo en el enum y no se usa todavía.
//
// La dedupe es una FILA, no una variable: PM2 se reinicia y una línea duplicada
// en el crontab dispara dos corridas (docs/10:595-598). Y excluye las `failed`,
// que registran un intento que no salió.
import type { PrismaClient } from "@/generated/prisma/client";
import { makeMailBudget } from "@/lib/email/batch-cap";
import { mailer } from "@/lib/email";
import { feeReminderEmail } from "@/lib/email/templates";
import { prisma } from "@/lib/prisma";
import { feeValueReader, type makeFeeValueReader } from "@/lib/treasury/fee-values";
import { currentPeriod, isLastCivilDayOfMonth, type Period } from "./periods";
import { ACCRUING_CATEGORIES, debtAmount, feeAmountFor } from "./rules";

const MAX_ERRORS = 50;
const ERROR_MAX = 240;

// Sólo el código: el error de nodemailer trae la dirección en claro y este
// summary va a `CronRun.summary` y al asiento de auditoría (docs/08).
function codeOf(e: unknown): string {
  const c = (e as { code?: unknown } | null)?.code;
  return typeof c === "string" && c !== "" ? c : "unknown";
}

export type ReminderSummary = {
  period: Period;
  candidates: number;
  sent: number;
  alreadyNotified: number;
  noEmail: number;
  deferred: number;
  errors: string[];
  errorsOmitted: number;
};

type Deps = {
  db: Pick<PrismaClient, "member" | "fee" | "notification">;
  mailer: Pick<typeof mailer, "sendToMember">;
  feeValues: Pick<ReturnType<typeof makeFeeValueReader>, "current">;
  now?: () => Date;
};

export function makeReminderCron(deps: Deps) {
  const now = deps.now ?? (() => new Date());

  return {
    willAct(): boolean {
      return isLastCivilDayOfMonth(now());
    },

    async run(): Promise<ReminderSummary> {
      const at = now();
      const period = currentPeriod(at);
      const s: ReminderSummary = {
        period, candidates: 0, sent: 0, alreadyNotified: 0, noEmail: 0, deferred: 0,
        errors: [], errorsOmitted: 0,
      };
      const fail = (ref: string, e: unknown) => {
        console.error("[reminder]", ref, codeOf(e));
        if (s.errors.length >= MAX_ERRORS) { s.errorsOmitted++; return; }
        s.errors.push(`${ref}: ${codeOf(e)}`.slice(0, ERROR_MAX));
      };

      // Los devengantes vigentes (el adherente no devenga; el suspendido sí).
      const members = await deps.db.member.findMany({
        where: { status: { in: ["active", "suspended"] }, category: { in: [...ACCRUING_CATEGORIES] } },
        select: { id: true, fullName: true, email: true, emailStatus: true, category: true },
        orderBy: { id: "asc" },
      });
      if (members.length === 0) return s;
      const ids = members.map((m) => m.id);

      const [paidRows, notifiedRows, pendingGroups, feeValue] = await Promise.all([
        // Bajo el modelo de dos niveles, la cuota del mes en curso sólo tiene
        // fila si alguien la pagó (el devengo la materializa el 01 del mes que
        // viene). O sea: "no existe `Fee(M, paid)`" es exactamente "no pagó el
        // mes en curso".
        deps.db.fee.findMany({
          where: { memberId: { in: ids }, period, status: "paid" },
          select: { memberId: true },
        }),
        deps.db.notification.findMany({
          where: { memberId: { in: ids }, type: "fee_reminder", period, status: { not: "failed" } },
          select: { memberId: true },
        }),
        deps.db.fee.groupBy({
          by: ["memberId"],
          where: { memberId: { in: ids }, status: "pending" },
          _count: { _all: true },
        }),
        deps.feeValues.current(at),
      ]);
      const paid = new Set(paidRows.map((r) => r.memberId));
      const notified = new Set(notifiedRows.map((r) => r.memberId));
      const pendingBy = new Map(pendingGroups.map((g) => [g.memberId, g._count._all]));

      const budget = makeMailBudget();
      for (const m of members) {
        if (paid.has(m.id)) continue;
        s.candidates++;
        if (notified.has(m.id)) { s.alreadyNotified++; continue; }
        // Mismo filtro que el recibo (`receipt-email.ts:59`): sin casilla o con
        // rebote, no se manda. Estos son los que van a la lista imprimible de
        // gestión manual de Deudores.
        if (!m.email || m.emailStatus === "bounced") { s.noEmail++; continue; }
        if (!budget.take()) continue;
        const arrears = pendingBy.get(m.id) ?? 0;
        try {
          await deps.mailer.sendToMember({
            memberId: m.id,
            to: m.email,
            type: "fee_reminder",
            period,
            message: feeReminderEmail({
              name: m.fullName,
              period,
              amount: feeValue ? feeAmountFor(m.category, feeValue) : null,
              arrears,
              debt: feeValue ? debtAmount(arrears, m.category, feeValue) : null,
            }),
            summary: `recordatorio de vencimiento ${period}`,
          });
          s.sent++;
        } catch (e) {
          // El mailer ya dejó la fila `failed` con el código (4C §7.1); acá
          // queda el contador y el id interno, para que el summary diga a
          // cuántos no se les pudo avisar.
          fail(`member:${m.id}`, e);
        }
      }
      s.deferred = budget.deferred;
      return s;
    },
  };
}

export const reminderCron = makeReminderCron({ db: prisma, mailer, feeValues: feeValueReader });
```

- [ ] **Step 8: Correr y ver verde**

Run: `npx vitest run tests/treasury-reminder.test.ts`
Expected: 9 tests PASS.

- [ ] **Step 9: Test que falla — la ruta**

Crear `tests/reminder-route.test.ts` copiando la estructura de `tests/accrual-route.test.ts`, con:
`vi.mock("@/lib/treasury/reminder", () => ({ reminderCron: { run: mocks.run, willAct: mocks.willAct } }))`,
`import { POST } from "@/app/api/cron/reminder/route";`,
`const summary = { period: "2026-09", candidates: 12, sent: 10, alreadyNotified: 0, noEmail: 2, deferred: 0, errors: [], errorsOmitted: 0 };`
y los seis casos equivalentes; el del día que no corresponde espera `{ skipped: "not_last_day" }`, `job: "reminder"` y acción `reminder_cron`.

- [ ] **Step 10: Implementación de la ruta**

Crear `src/app/api/cron/reminder/route.ts`, idéntico en estructura al de `accrual` (Task 4 Step 8) cambiando: el import a `reminderCron` de `@/lib/treasury/reminder`, `CRON_JOBS.reminder`, el cuerpo del skip a `{ skipped: "not_last_day" }`, la acción de auditoría a `reminder_cron` y el log a `[cron] reminder`. La cabecera del archivo:

```ts
// POST /api/cron/reminder — crontab del VPS, todos los días a las 10:00. ACTÚA
// el ÚLTIMO día civil del mes (`reminderCron.willAct()`): el aviso sale la
// víspera de la mora. Un día que no corresponde no abre `CronRun` — serían 29
// filas vacías por mes tapando la única que importa.
```

- [ ] **Step 11: Correr y ver verde, suite y commit**

Run: `npx vitest run tests/reminder-route.test.ts && npm test 2>&1 | tail -5 && npx tsc --noEmit && npm run lint`

```bash
git add -A && git commit -m "feat(m4c): the fee reminder goes out the day before the arrears, February included

Anchoring it to 'the 30th' would have skipped February every year. The dedupe
is a persisted Notification row keyed by member and period — PM2 restarts, and a
duplicated crontab line fires two runs — and it ignores failed rows so a broken
attempt does not silence the retry.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Lista imprimible para gestión manual (los deudores sin email)

Spec §5, decisión 2 del operador: hoy sólo **12 de los 35 devengantes** tienen email. A los demás la Comisión los llama o los visita, y para eso necesita una hoja. En la lista impresa no hay ningún dato nuevo: es lo que Deudores ya muestra, en papel.

> Cargar el skill `frontend-design` antes de escribir JSX.

**Files:**
- Create: `src/app/admin/tesoreria/deudores/gestion-manual/page.tsx`
- Create: `src/components/admin/print-button.tsx` (mudanza desde `src/app/admin/solicitudes/resumen/print-button.tsx`)
- Modify: `src/lib/treasury/debtors.ts`, `src/app/admin/tesoreria/deudores/page.tsx`, `src/app/admin/solicitudes/resumen/page.tsx`
- Delete: `src/app/admin/solicitudes/resumen/print-button.tsx`
- Modify: `tests/treasury-debtors.test.ts`

**Interfaces:**
- Consumes: `fetchDebtors(db, filters, feeValue)` / `parseDebtorFilters(sp)` (`debtors.ts:47,26`), `feeValueReader.current()`, `requireAdmin`, `PageHeader` / `EmptyState` / `Button`, `formatARS`, `CATEGORY_LABELS`.
- Produces:

```ts
// src/lib/treasury/debtors.ts — DebtorRow gana dos campos
export type DebtorRow = {
  /* …los de hoy… */
  /** Teléfono de la ficha, para la gestión manual. */
  phone: string | null;
  /** Si tiene casilla utilizable (mismo criterio que el recibo y el
   *  recordatorio: hay email y no rebotó). El que NO la tiene es el que hay que
   *  llamar. */
  emailUsable: boolean;
};

// src/components/admin/print-button.tsx
export function PrintButton(): JSX.Element;
```

- [ ] **Step 1: Test que falla — los dos campos nuevos**

Agregar a `tests/treasury-debtors.test.ts`:

```ts
  it("cada fila dice si el socio tiene casilla utilizable y su teléfono", async () => {
    const db = fakeDb({
      groups: [{ memberId: 1, _count: { _all: 4 } }, { memberId: 2, _count: { _all: 2 } }],
      members: [
        member({ id: 1, email: "a@b.com", emailStatus: "verified", phone: "297-4000000" }),
        member({ id: 2, email: "c@d.com", emailStatus: "bounced", phone: null }),
      ],
    });
    const rows = await fetchDebtors(db as never, {}, { activeAmount: 6000, sharedAmount: 3000 });
    expect(rows.find((r) => r.memberId === 1)).toMatchObject({ emailUsable: true, phone: "297-4000000" });
    // Una casilla que rebota no sirve para avisar: ese socio va a la lista de
    // gestión manual igual que el que no tiene email.
    expect(rows.find((r) => r.memberId === 2)).toMatchObject({ emailUsable: false, phone: null });
  });
```

(reusando los helpers `fakeDb` / `member` que el archivo ya tiene).

- [ ] **Step 2: Correr y ver el fallo**

Run: `npx vitest run tests/treasury-debtors.test.ts`
Expected: falla — `emailUsable` no existe.

- [ ] **Step 3: Implementación en `debtors.ts`**

En `DebtorRow`, después de `lastPaidAt`:

```ts
  /** Teléfono de la ficha: lo usa la lista imprimible de gestión manual, que es
   *  el canal de los socios sin email (hoy, 23 de los 35 devengantes). */
  phone: string | null;
  /** Si tiene casilla utilizable — mismo criterio que el recibo
   *  (`receipt-email.ts:59`) y el recordatorio: hay email y no rebotó. El que NO
   *  la tiene es al que hay que llamar. */
  emailUsable: boolean;
```

y en el `map` de filas, después de `lastPaidAt: m.payments[0]?.paidAt ?? null,`:

```ts
      phone: m.phone,
      emailUsable: Boolean(m.email) && m.emailStatus !== "bounced",
```

(el `findMany` usa `include`, así que los tres escalares ya vienen).

Run: `npx vitest run tests/treasury-debtors.test.ts` → PASS.

- [ ] **Step 4: Mudar `PrintButton` a componentes compartidos**

Mover `src/app/admin/solicitudes/resumen/print-button.tsx` a `src/components/admin/print-button.tsx` sin cambiar su cuerpo (es el botón que llama a `window.print()`), y actualizar el import de `src/app/admin/solicitudes/resumen/page.tsx` a `import { PrintButton } from "@/components/admin/print-button";`. Motivo: lo van a usar tres pantallas (resumen para acta, gestión manual, padrón electoral) y una la ubica en `@/components`.

Run: `npx vitest run tests/application-summary.test.ts && npx tsc --noEmit`

- [ ] **Step 5: La pantalla imprimible**

Crear `src/app/admin/tesoreria/deudores/gestion-manual/page.tsx`:

```tsx
// Lista imprimible de los deudores SIN casilla utilizable (spec 4C §5,
// decisión 2 del operador). El recordatorio de vencimiento cubre a los que
// tienen email; a estos la Comisión los llama o los visita, y para eso necesita
// una hoja con nombre, número, cuántas debe, cuánto y el teléfono.
//
// No hay ningún dato nuevo acá: es exactamente lo que Deudores ya muestra en
// pantalla, con el teléfono que la ficha ya tiene. El encabezado NO se escribe
// acá arriba: lo pone el layout de Tesorería, y esta pantalla agrega el suyo
// porque es una subruta con identidad propia.
import Link from "next/link";
import { EmptyState } from "@/components/admin/empty-state";
import { FormMessage } from "@/components/admin/form-message";
import { PageHeader } from "@/components/admin/page-header";
import { PrintButton } from "@/components/admin/print-button";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAdmin } from "@/lib/auth/require-admin";
import { formatARS, formatDateAR } from "@/lib/format";
import { CATEGORY_LABELS } from "@/lib/members/labels";
import { prisma } from "@/lib/prisma";
import { fetchDebtors } from "@/lib/treasury/debtors";
import { feeValueReader } from "@/lib/treasury/fee-values";

export const dynamic = "force-dynamic";
export const metadata = { title: "Gestión manual — SIGeV" };

const BASE = "/admin/tesoreria/deudores";

export default async function GestionManualPage() {
  const actor = await requireAdmin();
  if (!actor.ok) return <FormMessage kind="error" box>{actor.error}</FormMessage>;

  const feeValue = await feeValueReader.current();
  // Sin filtros: la hoja es para la Comisión y tiene que traerlos a todos.
  const rows = (await fetchDebtors(prisma, {}, feeValue)).filter((r) => !r.emailUsable);
  const total = rows.reduce((acc, r) => acc + (r.debt ?? 0), 0);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Gestión manual"
        breadcrumb={[{ label: "Deudores", href: BASE }, { label: "Gestión manual" }]}
        actions={
          <div className="flex flex-wrap gap-2 print:hidden">
            <Button asChild variant="outline"><Link href={BASE}>Volver a Deudores</Link></Button>
            <PrintButton />
          </div>
        }
      >
        <p className="text-sm text-muted-foreground">
          Socios con cuotas pendientes que <strong>no</strong> tienen email utilizable: a estos el
          recordatorio de vencimiento no les llega. Deuda valuada al valor de cuota vigente
          {feeValue ? ` (desde ${formatDateAR(feeValue.validFrom)})` : ""}.
        </p>
      </PageHeader>

      {!feeValue && (
        <FormMessage kind="warning" box>
          No hay un valor de cuota vigente: la deuda en pesos no se puede calcular. Registralo en
          Configuración → Tesorería.
        </FormMessage>
      )}

      {rows.length === 0 ? (
        <EmptyState description="Todos los socios con deuda tienen una casilla de correo utilizable: el recordatorio les llega solo." />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {`${rows.length} ${rows.length === 1 ? "socio" : "socios"} para contactar`}
            {feeValue && ` · ${formatARS(total)} en total`}.
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>N°</TableHead>
                <TableHead>Socio</TableHead>
                <TableHead>Categoría</TableHead>
                <TableHead className="text-right">Cuotas</TableHead>
                <TableHead className="text-right">Deuda</TableHead>
                <TableHead>Teléfono</TableHead>
                <TableHead>Último pago</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.memberId}>
                  <TableCell className="font-mono tabular-nums">{r.memberNumber ?? "—"}</TableCell>
                  <TableCell>{r.fullName}</TableCell>
                  <TableCell>{CATEGORY_LABELS[r.category]}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{r.pendingCount}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {r.debt !== null ? formatARS(r.debt) : "—"}
                  </TableCell>
                  {/* Sin teléfono queda un guión y no una celda vacía: en papel,
                      una celda vacía se lee como un error de impresión. */}
                  <TableCell className="font-mono tabular-nums">{r.phone ?? "—"}</TableCell>
                  <TableCell>{r.lastPaidAt ? formatDateAR(r.lastPaidAt) : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 6: El botón en Deudores**

En `src/app/admin/tesoreria/deudores/page.tsx`, después del `<form>` de filtros y antes del aviso de valor de cuota:

```tsx
      {rows.some((r) => !r.emailUsable) && (
        <p className="text-sm">
          <Link
            className="font-medium text-primary underline underline-offset-2 outline-hidden hover:no-underline focus-visible:ring-2 focus-visible:ring-ring"
            href={`${BASE}/gestion-manual`}
          >
            Lista para gestión manual
          </Link>{" "}
          <span className="text-muted-foreground">
            — los deudores sin email, para llamar o visitar (imprimible).
          </span>
        </p>
      )}
```

- [ ] **Step 7: Verificar en el navegador**

Run: `npm run dev` y abrir `/admin/tesoreria/deudores` → el link aparece; `/admin/tesoreria/deudores/gestion-manual` → tabla con la pestaña **Deudores** marcada (`isTreasuryTabActive` marca las subrutas), y `Ctrl+P` muestra la hoja sin lateral (`print:hidden` de `admin-sidebar.tsx:42`) y sin los botones.

- [ ] **Step 8: Suite y commit**

Run: `npm test 2>&1 | tail -5 && npx tsc --noEmit && npm run lint`

```bash
git add -A && git commit -m "feat(m4c): a printable list for the debtors the reminder cannot reach

Only 12 of the 35 accruing members have an email. The other 23 get a phone call,
and the Comisión needs a sheet: name, number, fees, amount, phone. Nothing on it
is new — it is what Deudores already shows, on paper.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Resumen diario a la Comisión — `POST /api/cron/digest`

Spec §6. Corre a diario a las 07:30 y junta las novedades del **día civil anterior**. **Sin novedades no se envía** — y esa decisión de no enviar **tampoco escribe `CronRun`**: es el desenlace sano, no una anomalía, y `/admin/salud` no puede pintarla de rojo. Los destinatarios son una clave de `Configuration` editable por el superadmin (decisión 3 del operador), igual que los ids de plan.

> Cargar el skill `frontend-design` antes de escribir el JSX del campo nuevo de Configuración.

**Files:**
- Create: `src/lib/admin/digest.ts`, `src/app/api/cron/digest/route.ts`
- Create: `tests/admin-digest.test.ts`, `tests/digest-route.test.ts`
- Modify: `src/lib/config.ts`, `src/lib/email/templates.ts`, `src/app/admin/configuracion/{actions.ts,page.tsx,config-form.tsx}`
- Modify: `tests/config.test.ts`, `tests/config-actions.test.ts`, `tests/email.test.ts`

**Interfaces:**
- Consumes: `mailer.sendToMember({ memberId: null, … })` (`email/index.ts:36`; `memberId` es `number | null` a propósito), `configReader.getString(key)` (`config.ts:29`), `civilDayOf(at)` (`periods.ts:64`), `formatARS` / `formatDateAR` (`@/lib/format`), `PAYMENT_TYPE_LABELS` (`@/lib/treasury/labels` o donde viva hoy — usar el existente, no crear otro), `checkCronAuth` / `CRON_JOBS` (Task 1).
- Produces:

```ts
// src/lib/config.ts
export const CONFIG_KEYS = { /* …las 7 de hoy… */ digestRecipients: "digest_recipients" } as const;
/** CSV → direcciones normalizadas y sin repetir. Vacío = nadie. */
export function parseRecipients(csv: string | null | undefined): string[];

// src/lib/admin/digest.ts
export type DigestPaymentGroup = { type: string; count: number; total: number };
export type DigestData = {
  from: Date; to: Date; label: string;      // el día civil anterior, DD/MM/AAAA
  payments: DigestPaymentGroup[];
  paymentsCount: number; paymentsTotal: number;
  applications: number;                      // altas web iniciadas
  inboxNew: number;                          // filas nuevas en la bandeja
  notificationsFailed: number;
  cronFailures: Array<{ job: string; startedAt: Date; error: string | null }>;
  webhookErrors: number;
};
export function hasNews(d: DigestData): boolean;
export function previousCivilDayRangeUtc(now: Date): { from: Date; to: Date; label: string };
export type DigestSendSummary = {
  day: string; recipients: number; sent: number; failed: number; errors: string[];
};
export function makeDigestCron(deps: {
  db: Pick<PrismaClient, "payment" | "application" | "mpUnmatchedPayment" | "notification" | "cronRun" | "webhookEvent">;
  mailer: Pick<typeof mailer, "sendToMember">;
  config: { getString(key: string): Promise<string | null> };
  now?: () => Date;
}): {
  collect(): Promise<DigestData>;
  send(data: DigestData): Promise<DigestSendSummary>;
};
export const digestCron: ReturnType<typeof makeDigestCron>;

// src/lib/email/templates.ts
export function boardDigestEmail(d: DigestData): { subject: string; text: string; html: string };
```

- [ ] **Step 1: Test que falla — la clave nueva y el parseo de destinatarios**

Agregar a `tests/config.test.ts`:

```ts
describe("parseRecipients", () => {
  it("CSV → direcciones normalizadas, sin repetir y sin vacíos", () => {
    expect(parseRecipients(" A@B.com , a@b.com ,, c@d.org ")).toEqual(["a@b.com", "c@d.org"]);
  });
  it("null, vacío o basura sin arroba → nadie (el resumen simplemente no sale)", () => {
    expect(parseRecipients(null)).toEqual([]);
    expect(parseRecipients("")).toEqual([]);
    expect(parseRecipients("comision")).toEqual([]);
  });
  it("la clave está en el catálogo", () => {
    expect(CONFIG_KEYS.digestRecipients).toBe("digest_recipients");
  });
});
```

- [ ] **Step 2: Correr, ver el fallo, implementar**

Run: `npx vitest run tests/config.test.ts` → falla.

En `src/lib/config.ts`, agregar a `CONFIG_KEYS`:

```ts
  /** Destinatarios del resumen diario a la Comisión (4C §6). CSV. Editable
   *  desde /admin/configuracion: cambiar quién lo recibe no puede exigir un
   *  deploy ni un reinicio de PM2. */
  digestRecipients: "digest_recipients",
```

y al final del archivo:

```ts
/** CSV → direcciones normalizadas, sin repetidos y sin las que ni siquiera
 *  parecen una dirección. Vacío significa "nadie": el resumen no sale y eso es
 *  preferible a fallar a una casilla inventada. La validación fina (formato) la
 *  hace el schema de la pantalla; acá el criterio es defensivo porque el valor
 *  puede haber quedado escrito por SQL. */
export function parseRecipients(csv: string | null | undefined): string[] {
  if (!csv) return [];
  return [...new Set(
    csv.split(",").map((s) => s.trim().toLowerCase()).filter((s) => s.includes("@") && s.length >= 5),
  )];
}
```

Run: `npx vitest run tests/config.test.ts` → PASS.

- [ ] **Step 3: Test que falla — el armado del resumen**

Crear `tests/admin-digest.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { hasNews, makeDigestCron, previousCivilDayRangeUtc, type DigestData } from "@/lib/admin/digest";

const NOW = new Date("2026-09-15T10:30:00Z"); // 07:30 AR del 15/09

const empty: DigestData = {
  from: new Date(), to: new Date(), label: "14/09/2026",
  payments: [], paymentsCount: 0, paymentsTotal: 0,
  applications: 0, inboxNew: 0, notificationsFailed: 0, cronFailures: [], webhookErrors: 0,
};

function build(over?: Partial<{
  payments: Array<{ type: string; _count: { _all: number }; _sum: { amount: unknown } }>;
  applications: number; inboxNew: number; failed: number;
  cronFailures: Array<{ job: string; startedAt: Date; error: string | null }>;
  webhookErrors: number; recipients: string | null;
  send: ReturnType<typeof vi.fn>;
}>) {
  const send = over?.send ?? vi.fn(async () => ({ messageId: "id" }));
  const db = {
    payment: { groupBy: vi.fn(async () => over?.payments ?? []) },
    application: { count: vi.fn(async () => over?.applications ?? 0) },
    mpUnmatchedPayment: { count: vi.fn(async () => over?.inboxNew ?? 0) },
    notification: { count: vi.fn(async () => over?.failed ?? 0) },
    cronRun: { findMany: vi.fn(async () => over?.cronFailures ?? []) },
    webhookEvent: { count: vi.fn(async () => over?.webhookErrors ?? 0) },
  };
  const cron = makeDigestCron({
    db: db as never,
    mailer: { sendToMember: send },
    config: { getString: vi.fn(async () => over?.recipients ?? "comision@vecinal.ar") },
    now: () => NOW,
  });
  return { cron, db, send };
}

describe("previousCivilDayRangeUtc", () => {
  it("el día civil argentino anterior, de 00:00 a 00:00 (03:00 UTC)", () => {
    const r = previousCivilDayRangeUtc(NOW);
    expect(r.from.toISOString()).toBe("2026-09-14T03:00:00.000Z");
    expect(r.to.toISOString()).toBe("2026-09-15T03:00:00.000Z");
    expect(r.label).toBe("14/09/2026");
  });
  it("a las 07:30 AR del 1° de mes, el día anterior es el último del mes pasado", () => {
    expect(previousCivilDayRangeUtc(new Date("2026-10-01T10:30:00Z")).label).toBe("30/09/2026");
  });
});

describe("hasNews", () => {
  it("un día sin nada no es novedad", () => {
    expect(hasNews(empty)).toBe(false);
  });
  it("cualquiera de los seis renglones alcanza", () => {
    expect(hasNews({ ...empty, paymentsCount: 1 })).toBe(true);
    expect(hasNews({ ...empty, applications: 1 })).toBe(true);
    expect(hasNews({ ...empty, inboxNew: 1 })).toBe(true);
    expect(hasNews({ ...empty, notificationsFailed: 1 })).toBe(true);
    expect(hasNews({ ...empty, webhookErrors: 1 })).toBe(true);
    expect(hasNews({ ...empty, cronFailures: [{ job: "reconcile", startedAt: NOW, error: "x" }] })).toBe(true);
  });
});

describe("digest cron", () => {
  it("junta los pagos del día anterior por medio, con total", async () => {
    const { cron, db } = build({
      payments: [
        { type: "cash", _count: { _all: 2 }, _sum: { amount: "9000.00" } },
        { type: "debit", _count: { _all: 1 }, _sum: { amount: "6000.00" } },
      ],
    });
    const d = await cron.collect();
    expect(d.paymentsCount).toBe(3);
    expect(d.paymentsTotal).toBe(15000);
    expect(d.payments).toEqual([
      { type: "cash", count: 2, total: 9000 },
      { type: "debit", count: 1, total: 6000 },
    ]);
    // Todas las consultas acotadas al MISMO rango del día civil anterior.
    expect(db.payment.groupBy).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ createdAt: { gte: expect.any(Date), lt: expect.any(Date) } }),
    }));
  });

  it("manda a cada destinatario configurado y cuenta los envíos", async () => {
    const { cron, send } = build({ applications: 2, recipients: "a@b.com, c@d.com" });
    const data = await cron.collect();
    const s = await cron.send(data);
    expect(s.recipients).toBe(2);
    expect(s.sent).toBe(2);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ memberId: null, type: "board_digest" }));
  });

  it("sin destinatarios configurados no manda nada y lo dice", async () => {
    const { cron, send } = build({ applications: 1, recipients: null });
    const s = await cron.send(await cron.collect());
    expect(s.recipients).toBe(0);
    expect(s.sent).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("un destinatario que falla no impide el envío al otro, y su código queda en errors[]", async () => {
    const send = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("smtp a@b.com"), { code: "EAUTH" }))
      .mockResolvedValueOnce({ messageId: "id" });
    const { cron } = build({ applications: 1, recipients: "a@b.com, c@d.com", send });
    const s = await cron.send(await cron.collect());
    expect(s.sent).toBe(1);
    expect(s.failed).toBe(1);
    expect(s.errors).toEqual(["EAUTH"]);
    // Nunca la dirección de un tercero, ni siquiera en el summary del cron.
    expect(s.errors[0]).not.toContain("@");
  });
});
```

- [ ] **Step 4: Correr y ver el fallo**

Run: `npx vitest run tests/admin-digest.test.ts`
Expected: `Failed to resolve import "@/lib/admin/digest"`.

- [ ] **Step 5: Implementación — `src/lib/admin/digest.ts`**

```ts
// Resumen diario a la Comisión (spec 4C §6). Corre a las 07:30 y cuenta lo que
// pasó el DÍA CIVIL ANTERIOR.
//
// Dos decisiones que están en el CA y no son detalle:
//   - Sin novedades NO se envía. Y no enviar es el desenlace sano, así que la
//     ruta tampoco abre un `CronRun`: /admin/salud no puede pintar de rojo un
//     día tranquilo.
//   - El contenido son AGREGADOS. Nombres de socio sólo donde el renglón los
//     pide; nunca direcciones de email de terceros ni ids de mandato completos
//     (Ley 25.326, mismo criterio que los asientos de auditoría).
//
// Va en dos pasos —`collect()` y `send(data)`— para que la ruta pueda decidir si
// hay algo que informar ANTES de abrir la corrida.
import type { PrismaClient } from "@/generated/prisma/client";
import { mailer } from "@/lib/email";
import { boardDigestEmail } from "@/lib/email/templates";
import { configReader, CONFIG_KEYS, parseRecipients } from "@/lib/config";
import { formatDateAR } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { civilDayOf } from "@/lib/treasury/periods";

const MAX_ERRORS = 20;

function codeOf(e: unknown): string {
  const c = (e as { code?: unknown } | null)?.code;
  return typeof c === "string" && c !== "" ? c : "unknown";
}

/** El día civil ARGENTINO anterior, como rango UTC semiabierto. 03:00 UTC son
 *  las 00:00 de acá — mismo idioma que `arMonthRangeUtc` en
 *  `applications/summary.ts`. Se resuelve desde `civilDayOf` y no desde el reloj
 *  UTC porque a las 07:30 AR del 1° de mes, "ayer" es el último día del mes
 *  anterior y UTC ya está en el mes nuevo. */
export function previousCivilDayRangeUtc(now: Date): { from: Date; to: Date; label: string } {
  const today = civilDayOf(now);
  const to = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 3));
  const from = new Date(to.getTime() - 24 * 60 * 60 * 1000);
  return { from, to, label: formatDateAR(from) };
}

export type DigestPaymentGroup = { type: string; count: number; total: number };

export type DigestData = {
  from: Date;
  to: Date;
  label: string;
  payments: DigestPaymentGroup[];
  paymentsCount: number;
  paymentsTotal: number;
  applications: number;
  inboxNew: number;
  notificationsFailed: number;
  cronFailures: Array<{ job: string; startedAt: Date; error: string | null }>;
  webhookErrors: number;
};

/** Qué cuenta como novedad. Si algún día se agrega un renglón al resumen, se
 *  agrega TAMBIÉN acá: un renglón que no cuenta como novedad no se manda nunca
 *  solo, y uno que cuenta pero no se muestra manda correos vacíos. */
export function hasNews(d: DigestData): boolean {
  return (
    d.paymentsCount > 0 || d.applications > 0 || d.inboxNew > 0 ||
    d.notificationsFailed > 0 || d.cronFailures.length > 0 || d.webhookErrors > 0
  );
}

export type DigestSendSummary = {
  day: string; recipients: number; sent: number; failed: number; errors: string[];
};

type Deps = {
  db: Pick<PrismaClient, "payment" | "application" | "mpUnmatchedPayment" | "notification" | "cronRun" | "webhookEvent">;
  mailer: Pick<typeof mailer, "sendToMember">;
  config: { getString(key: string): Promise<string | null> };
  now?: () => Date;
};

export function makeDigestCron(deps: Deps) {
  const now = deps.now ?? (() => new Date());

  return {
    async collect(): Promise<DigestData> {
      const { from, to, label } = previousCivilDayRangeUtc(now());
      const range = { gte: from, lt: to };
      const [payments, applications, inboxNew, notificationsFailed, cronFailures, webhookErrors] = await Promise.all([
        // Por `createdAt` y no por `paidAt`: el resumen cuenta lo que el sistema
        // REGISTRÓ ayer. Un débito de MP acreditado hace tres días que la
        // conciliación recuperó anoche es una novedad de anoche.
        deps.db.payment.groupBy({
          by: ["type"],
          where: { createdAt: range, status: "applied" },
          _count: { _all: true },
          _sum: { amount: true },
        }),
        deps.db.application.count({ where: { createdAt: range } }),
        deps.db.mpUnmatchedPayment.count({ where: { createdAt: range } }),
        deps.db.notification.count({ where: { sentAt: range, status: "failed" } }),
        deps.db.cronRun.findMany({
          where: { startedAt: range, ok: false },
          select: { job: true, startedAt: true, error: true },
          orderBy: { startedAt: "asc" },
        }),
        deps.db.webhookEvent.count({ where: { receivedAt: range, error: { not: null } } }),
      ]);
      const groups: DigestPaymentGroup[] = payments.map((p) => ({
        type: p.type,
        count: p._count._all,
        // Decimal → número de pesos, como en el resto del módulo.
        total: Number(p._sum.amount ?? 0),
      }));
      return {
        from, to, label,
        payments: groups,
        paymentsCount: groups.reduce((a, g) => a + g.count, 0),
        paymentsTotal: groups.reduce((a, g) => a + g.total, 0),
        applications, inboxNew, notificationsFailed,
        cronFailures: cronFailures.map((c) => ({ job: c.job, startedAt: c.startedAt, error: c.error })),
        webhookErrors,
      };
    },

    async send(data: DigestData): Promise<DigestSendSummary> {
      const to = parseRecipients(await deps.config.getString(CONFIG_KEYS.digestRecipients));
      const s: DigestSendSummary = { day: data.label, recipients: to.length, sent: 0, failed: 0, errors: [] };
      if (to.length === 0) return s;
      const message = boardDigestEmail(data);
      for (const address of to) {
        try {
          // `memberId: null`: el destinatario es la Comisión, no un socio. La
          // fila queda acreditada igual (el mailer la escribe).
          await deps.mailer.sendToMember({
            memberId: null, to: address, type: "board_digest", message,
            summary: `resumen diario ${data.label}`,
          });
          s.sent++;
        } catch (e) {
          s.failed++;
          // El CÓDIGO, nunca la dirección: este summary va a `CronRun.summary` y
          // al asiento de auditoría (docs/08).
          if (s.errors.length < MAX_ERRORS) s.errors.push(codeOf(e));
        }
      }
      return s;
    },
  };
}

export const digestCron = makeDigestCron({ db: prisma, mailer, config: configReader });
```

- [ ] **Step 6: La plantilla**

En `src/lib/email/templates.ts`, después de `feeReminderEmail`:

```ts
/** Resumen diario a la Comisión (4C §6). Agregados y nada más: cantidades,
 *  totales y qué se rompió. Ninguna dirección de tercero, ningún id de mandato,
 *  ningún DNI — es un correo que va a varias casillas y lo puede reenviar
 *  cualquiera (Ley 25.326). */
export function boardDigestEmail(d: {
  label: string;
  payments: Array<{ type: string; count: number; total: number }>;
  paymentsCount: number; paymentsTotal: number;
  applications: number; inboxNew: number; notificationsFailed: number;
  cronFailures: Array<{ job: string }>; webhookErrors: number;
}): Rendered {
  const lines: string[] = [];
  const html: string[] = [];
  const add = (text: string) => { lines.push(`· ${text}`); html.push(`<li>${esc(text)}</li>`); };

  if (d.paymentsCount > 0) {
    const detail = d.payments.map((p) => `${PAYMENT_TYPE_LABELS[p.type as PaymentType] ?? p.type}: ${p.count} (${formatARS(p.total)})`).join(" · ");
    add(`Pagos registrados: ${d.paymentsCount} por ${formatARS(d.paymentsTotal)} — ${detail}`);
  }
  if (d.applications > 0) add(`Solicitudes de alta iniciadas en el sitio: ${d.applications}`);
  if (d.inboxNew > 0) add(`Cobros que quedaron sin conciliar: ${d.inboxNew}`);
  if (d.notificationsFailed > 0) add(`Avisos por email que no salieron: ${d.notificationsFailed}`);
  if (d.webhookErrors > 0) add(`Notificaciones de Mercado Pago con error: ${d.webhookErrors}`);
  if (d.cronFailures.length > 0) add(`Tareas automáticas con problemas: ${d.cronFailures.map((c) => c.job).join(", ")}`);

  return {
    subject: `Resumen del ${d.label} — Vecinal Ciudadela`,
    text: `Novedades del ${d.label}:

${lines.join("\n")}

El detalle completo está en el panel: Salud, Tesorería y Solicitudes.${SIGNATURE}`,
    html: layout(`Novedades del ${d.label}`, `<ul>${html.join("\n")}</ul>
<p>El detalle completo está en el panel: Salud, Tesorería y Solicitudes.</p>`),
  };
}
```

(agregar los imports que falten: `PAYMENT_TYPE_LABELS` y el tipo `PaymentType` desde donde ya vivan — verificar con `grep -rn "PAYMENT_TYPE_LABELS" src/lib` y usar ese módulo, sin duplicar el mapa.)

Agregar a `tests/email.test.ts`:

```ts
  it("el resumen sólo lista los renglones que tienen algo", () => {
    const m = boardDigestEmail({
      label: "14/09/2026", payments: [{ type: "cash", count: 2, total: 9000 }],
      paymentsCount: 2, paymentsTotal: 9000, applications: 0, inboxNew: 1,
      notificationsFailed: 0, cronFailures: [], webhookErrors: 0,
    });
    expect(m.subject).toContain("14/09/2026");
    expect(m.text).toContain("9.000");
    expect(m.text).toContain("sin conciliar");
    expect(m.text).not.toContain("Solicitudes de alta");
    // Agregados, nunca nombres ni direcciones.
    expect(m.text).not.toContain("@");
  });
```

- [ ] **Step 7: Correr y ver verde**

Run: `npx vitest run tests/admin-digest.test.ts tests/email.test.ts`
Expected: PASS.

- [ ] **Step 8: La ruta**

Crear `tests/digest-route.test.ts` (misma estructura que `accrual-route`) con los casos: 503, 401, **sin novedades → 200 `{ skipped: "no_news" }` y `cronRun.create` no se llama**, con novedades → 200 + `job: "digest"` + asiento `digest_cron`, envío parcialmente fallido → 207, `collect()` que tira → 500.

Crear `src/app/api/cron/digest/route.ts`:

```ts
// POST /api/cron/digest — crontab del VPS, todos los días a las 07:30.
//
// Dos pasos a propósito: primero se junta la novedad, y sólo si hay algo que
// contar se abre la corrida. Un día tranquilo no deja fila en `cron_runs`
// porque no enviar ES el desenlace sano (spec §6 y §8 D2), y una fila
// `ok: true` que dice "no mandé nada" entrenaría al operador a ignorar el
// tablero. La contracara honesta: si `collect()` se cae, no hay `CronRun` que
// mostrar — el 500 queda en /var/log/sigev-cron.log y /admin/salud lo ve como
// antigüedad (el job pasa a "stale").
import { audit } from "@/lib/audit";
import { checkCronAuth, CRON_JOBS } from "@/lib/cron/auth";
import { digestCron, hasNews } from "@/lib/admin/digest";
import { safeMessage } from "@/lib/log-safe";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = checkCronAuth(req);
  if (!auth.ok) return auth.response;

  let data;
  try {
    data = await digestCron.collect();
  } catch (e) {
    console.error("[cron] digest: no se pudieron juntar las novedades", safeMessage(e));
    return Response.json({ error: "cron_failed" }, { status: 500 });
  }
  if (!hasNews(data)) return Response.json({ skipped: "no_news", day: data.label });

  const run = await prisma.cronRun.create({ data: { job: CRON_JOBS.digest, startedAt: new Date() } });
  try {
    const summary = await digestCron.send(data);
    const ok = summary.failed === 0;
    await prisma.cronRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), ok, summary } });
    await audit({ action: "digest_cron", entity: "cron", entityId: String(run.id), detail: summary });
    return Response.json(summary, { status: ok ? 200 : 207 });
  } catch (e) {
    console.error("[cron] digest: la corrida falló entera", safeMessage(e));
    await prisma.cronRun.update({
      where: { id: run.id },
      data: { finishedAt: new Date(), ok: false, error: safeMessage(e).slice(0, 500) },
    }).catch(() => {});
    return Response.json({ error: "cron_failed" }, { status: 500 });
  }
}
```

Run: `npx vitest run tests/digest-route.test.ts` → PASS.

- [ ] **Step 9: El campo en `/admin/configuracion`**

> Cargar el skill `frontend-design` antes de escribir JSX.

En `src/app/admin/configuracion/actions.ts`:

1. Al `schema`, agregar:

```ts
  digestRecipients: z
    .string("Destinatarios del resumen inválidos.")
    .max(500, "La lista de destinatarios no puede superar los 500 caracteres.")
    .refine(
      (v) => v.split(",").every((s) => s.trim() === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim())),
      "Alguna de las direcciones del resumen diario no es válida. Separalas con comas.",
    )
    .optional(),
```

2. A `entries`, agregar `[CONFIG_KEYS.digestRecipients, parsed.data.digestRecipients ?? ""],` (y el import de `CONFIG_KEYS` ya está).

En `src/app/admin/configuracion/page.tsx`: sumar `configReader.getString(CONFIG_KEYS.digestRecipients)` al `Promise.all` y a la desestructuración, y pasar `digestRecipients: digestRecipients ?? ""` al `initial` de `ConfigForm`.

En `src/app/admin/configuracion/config-form.tsx`: sumar `digestRecipients: string` al tipo `initial`, la clave al `useSyncedForm`, y una `Section` nueva al final:

```tsx
      <Section title="Avisos internos">
        <TextField
          label="Destinatarios del resumen diario"
          field={field("digestRecipients")}
          hint="Direcciones separadas por comas. Reciben todas las mañanas las novedades del día anterior (pagos, altas, cobros sin conciliar, avisos que no salieron y tareas automáticas con problemas). Vacío: no se envía a nadie. Un día sin novedades no genera correo."
        />
      </Section>
```

(usar la prop de ayuda que `TextField` ya expone — verificar su nombre en `src/components/admin/synced-fields.tsx` y usarlo tal cual; si no tiene, poner el texto en un `<p className="text-xs text-muted-foreground">` debajo, como hace el checkbox de ASOCIATE.)

Agregar a `tests/config-actions.test.ts`:

```ts
  it("guarda los destinatarios del resumen diario", async () => {
    prismaMock.configuration.findUnique.mockResolvedValue(null);
    await updateConfigAction({}, form({ ...filled, digestRecipients: "comision@vecinal.ar, tesoreria@vecinal.ar" }));
    expect(prismaMock.configuration.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { key: CONFIG_KEYS.digestRecipients },
      create: expect.objectContaining({ value: "comision@vecinal.ar, tesoreria@vecinal.ar" }),
    }));
  });

  it("una dirección mal escrita no se guarda: el resumen iría a la nada y nadie se enteraría", async () => {
    prismaMock.configuration.findUnique.mockResolvedValue(null);
    const r = await updateConfigAction({}, form({ ...filled, digestRecipients: "comision@, otra" }));
    expect(r.error).toContain("no es válida");
    expect(prismaMock.configuration.upsert).not.toHaveBeenCalled();
  });
```

(`form` y `filled` son los helpers que el archivo ya define en su cabecera; `filled` gana la clave `digestRecipients` con un valor válido para que el resto de los tests sigan pasando por el camino feliz.)

- [ ] **Step 10: Verificar en el navegador**

Run: `npm run dev` → `/admin/configuracion` como superadmin: el campo aparece en "Avisos internos", guarda, y al recargar muestra lo guardado. Cambiar el valor y volver a guardar **no** exige reiniciar nada (CA 13): el cron lee la clave en cada corrida.

- [ ] **Step 11: Suite y commit**

Run: `npm test 2>&1 | tail -5 && npx tsc --noEmit && npm run lint`

```bash
git add -A && git commit -m "feat(m4c): the daily digest, and a quiet day that stays quiet

No news means no email AND no cron_runs row: not sending is the healthy outcome,
and a green row saying 'I sent nothing' would teach the operator to ignore the
health board. Recipients live in Configuration, so changing who reads it is not
a deploy.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: El débito rechazado le avisa al socio

Spec §7.4. Hoy `webhook-processor.ts:435` corta con `return "payment_rejected_traced"` **antes** del mutex y de `loadContext`, descarta el `statusDetail` y no avisa a nadie: el único rastro es `webhook_events.result`, una tabla que ninguna pantalla muestra. Y el procesador **no puede escribirle a un socio**: sus deps son `Pick<typeof mailer, "sendToApplication">` (`webhook-processor.ts:92`).

**Files:**
- Create: `src/lib/mp/rejection-reasons.ts`, `tests/mp-rejection-reasons.test.ts`
- Modify: `src/lib/mp/webhook-processor.ts`, `src/lib/email/templates.ts`
- Modify: `tests/mp-webhook-processor.test.ts`, `tests/email.test.ts`

**Interfaces:**
- Consumes: `MpPaymentDetails` (`gateway.ts:8-28`: `id`, `status`, `statusDetail`, `transactionAmount`, `externalReference`, `subscriptionId`, `payerEmail`), `parsePaymentLinkReference` (`@/lib/mp/references`), `deps.db.mpSubscription` / `deps.db.member` (ya están en `Deps`), `mailer.sendToMember` (Task 5).
- Produces:

```ts
// src/lib/mp/rejection-reasons.ts
export const REJECTION_REASONS: Readonly<Record<string, string>>;
/** El motivo en es-AR, apto para un correo al socio. Lo no mapeado cae en un
 *  genérico: nunca se muestra el código crudo de MP. */
export function rejectionReason(statusDetail: string | null | undefined): string;

// src/lib/email/templates.ts
export function paymentRejectedEmail(opts: { name: string; amount: number; reason: string }): Rendered;

// src/lib/mp/webhook-processor.ts — Deps.mailer se amplía
mailer: Pick<typeof mailer, "sendToApplication" | "sendToMember">;
```

- [ ] **Step 1: Test que falla — el mapa de motivos**

Crear `tests/mp-rejection-reasons.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { REJECTION_REASONS, rejectionReason } from "@/lib/mp/rejection-reasons";

describe("rejectionReason", () => {
  it("traduce los motivos frecuentes a algo que un vecino entiende", () => {
    expect(rejectionReason("cc_rejected_insufficient_amount")).toContain("fondos");
    expect(rejectionReason("cc_rejected_card_disabled")).toContain("tarjeta");
    expect(rejectionReason("cc_rejected_call_for_authorize")).toContain("banco");
  });
  it("lo no mapeado cae en un genérico y NUNCA muestra el código crudo de MP", () => {
    const r = rejectionReason("cc_rejected_something_new_2027");
    expect(r).not.toContain("cc_rejected");
    expect(r).not.toContain("_");
    expect(r.length).toBeGreaterThan(10);
  });
  it("sin detalle, también el genérico", () => {
    expect(rejectionReason(null)).toBe(rejectionReason(undefined));
  });
  it("todos los textos están en castellano rioplatense y no terminan en punto doble", () => {
    for (const text of Object.values(REJECTION_REASONS)) {
      expect(text).not.toMatch(/\.\.$/);
      expect(text[0]).toBe(text[0].toLowerCase()); // se interpolan a mitad de frase
    }
  });
});
```

- [ ] **Step 2: Correr y ver el fallo, e implementar**

Run: `npx vitest run tests/mp-rejection-reasons.test.ts` → falla.

Crear `src/lib/mp/rejection-reasons.ts`:

```ts
// `status_detail` de Mercado Pago → castellano rioplatense (spec 4C §7.4).
//
// Los textos se interpolan A MITAD DE FRASE ("...no pudimos debitar tu cuota
// porque <motivo>"), así que arrancan en minúscula y no llevan punto final.
//
// El catálogo de MP puede crecer sin avisar: lo que no está mapeado cae en el
// genérico y NUNCA se le muestra al socio el código crudo — "tu pago fue
// rechazado por cc_rejected_high_risk" no le dice nada a un vecino y encima
// suena a acusación.
export const REJECTION_REASONS: Readonly<Record<string, string>> = {
  cc_rejected_insufficient_amount: "la tarjeta no tenía fondos suficientes",
  cc_rejected_card_disabled: "la tarjeta está inhabilitada para compras automáticas",
  cc_rejected_call_for_authorize: "el banco pide que autorices el cobro antes de aprobarlo",
  cc_rejected_bad_filled_card_number: "el número de tarjeta registrado no es correcto",
  cc_rejected_bad_filled_date: "la fecha de vencimiento de la tarjeta no es correcta",
  cc_rejected_bad_filled_security_code: "el código de seguridad de la tarjeta no es correcto",
  cc_rejected_bad_filled_other: "alguno de los datos de la tarjeta no es correcto",
  cc_rejected_card_error: "hubo un problema con la tarjeta",
  cc_rejected_duplicated_payment: "figura como un pago repetido",
  cc_rejected_high_risk: "Mercado Pago no autorizó el cobro",
  cc_rejected_max_attempts: "se superó la cantidad de intentos permitidos",
  cc_rejected_invalid_installments: "la tarjeta no admite este tipo de cobro",
  cc_rejected_blacklist: "Mercado Pago no autorizó el cobro",
  cc_rejected_other_reason: "el banco rechazó el cobro",
  cc_amount_rate_limit_exceeded: "se superó el límite de la tarjeta",
  rejected_by_bank: "el banco rechazó el cobro",
  rejected_insufficient_data: "faltaban datos para procesar el cobro",
};

const GENERIC = "el banco rechazó el cobro y no nos informó el motivo";

export function rejectionReason(statusDetail: string | null | undefined): string {
  return (statusDetail && REJECTION_REASONS[statusDetail]) || GENERIC;
}
```

Run: `npx vitest run tests/mp-rejection-reasons.test.ts` → PASS.

- [ ] **Step 3: La plantilla**

En `src/lib/email/templates.ts`:

```ts
/** Débito rechazado (4C §7.4). Lo dispara el webhook cuando MP intentó cobrar y
 *  no pudo.
 *
 *  El tono importa: el socio no hizo nada mal y el sistema no le está
 *  reclamando una deuda —la cuota puede no estar vencida todavía—. Le avisa
 *  para que arregle la tarjeta antes de que se le acumule, y le nombra las
 *  salidas. El motivo viene traducido: el `status_detail` crudo de MP no se
 *  muestra nunca. */
export function paymentRejectedEmail(opts: { name: string; amount: number; reason: string }): Rendered {
  const amount = formatARS(opts.amount);
  return {
    subject: "No pudimos debitar tu cuota — Vecinal Ciudadela",
    text: `Hola ${opts.name}:

Mercado Pago intentó debitar tu cuota social de ${amount} y no pudo: ${opts.reason}.

No hace falta que hagas nada con nosotros: cuando el medio de pago vuelva a estar disponible, el débito se reintenta solo. Si querés, podés revisar tu medio de pago en Mercado Pago, pagar en la sede o pedirnos un link de pago respondiendo este mensaje.${SIGNATURE}`,
    html: layout("No pudimos debitar tu cuota", `<p>Hola <strong>${esc(opts.name)}</strong>:</p>
<p>Mercado Pago intentó debitar tu cuota social de <strong>${esc(amount)}</strong> y no pudo: ${esc(opts.reason)}.</p>
<p>No hace falta que hagas nada con nosotros: cuando el medio de pago vuelva a estar disponible, el débito se reintenta solo. Si querés, podés revisar tu medio de pago en Mercado Pago, pagar en la sede o pedirnos un link de pago respondiendo este mensaje.</p>`),
  };
}
```

Y su test en `tests/email.test.ts`:

```ts
  it("el aviso de rechazo no reclama nada y no muestra el código de MP", () => {
    const m = paymentRejectedEmail({ name: "Ana", amount: 6000, reason: rejectionReason("cc_rejected_card_disabled") });
    for (const body of [m.text, m.html]) {
      expect(body).toContain("Ana");
      expect(body).toContain("6.000");
      expect(body).toContain("tarjeta");
      expect(body).not.toContain("cc_rejected");
      expect(body).not.toContain("deuda");
    }
  });
```

- [ ] **Step 4: Test que falla — el procesador avisa**

Agregar a `tests/mp-webhook-processor.test.ts`:

```ts
describe("pago rechazado", () => {
  const rejected = { ...approvedPayment, status: "rejected", statusDetail: "cc_rejected_insufficient_amount", dateApproved: null };

  it("le avisa al socio de la suscripción y devuelve el mismo result de siempre", async () => {
    deps.db.mpSubscription.findUnique.mockResolvedValue({ memberId: 5, applicationId: null });
    deps.db.member.findUnique.mockResolvedValue({ id: 5, fullName: "Ana", email: "ana@b.com", emailStatus: "verified" });
    const r = await processor.applyPayment(rejected, "pre-1");
    expect(r).toBe("payment_rejected_traced");
    expect(deps.mailer.sendToMember).toHaveBeenCalledWith(expect.objectContaining({
      memberId: 5, to: "ana@b.com", type: "payment_rejected",
    }));
    const msg = deps.mailer.sendToMember.mock.calls[0][0].message;
    expect(msg.text).toContain("fondos");
  });

  it("sin socio atribuible no manda nada y no rompe", async () => {
    deps.db.mpSubscription.findUnique.mockResolvedValue(null);
    expect(await processor.applyPayment({ ...rejected, externalReference: null }, null)).toBe("payment_rejected_traced");
    expect(deps.mailer.sendToMember).not.toHaveBeenCalled();
  });

  it("una casilla que rebota no recibe el aviso", async () => {
    deps.db.mpSubscription.findUnique.mockResolvedValue({ memberId: 5, applicationId: null });
    deps.db.member.findUnique.mockResolvedValue({ id: 5, fullName: "Ana", email: "ana@b.com", emailStatus: "bounced" });
    await processor.applyPayment(rejected, "pre-1");
    expect(deps.mailer.sendToMember).not.toHaveBeenCalled();
  });

  it("si el aviso explota, el rechazo NO se vuelve un 500: MP reintentaría el cobro para siempre", async () => {
    deps.db.mpSubscription.findUnique.mockResolvedValue({ memberId: 5, applicationId: null });
    deps.db.member.findUnique.mockResolvedValue({ id: 5, fullName: "Ana", email: "ana@b.com", emailStatus: "verified" });
    deps.mailer.sendToMember.mockRejectedValue(Object.assign(new Error("smtp"), { code: "EAUTH" }));
    expect(await processor.applyPayment(rejected, "pre-1")).toBe("payment_rejected_traced");
  });

  it("el asiento lleva el status_detail y NUNCA el payerEmail", async () => {
    deps.db.mpSubscription.findUnique.mockResolvedValue({ memberId: 5, applicationId: null });
    deps.db.member.findUnique.mockResolvedValue({ id: 5, fullName: "Ana", email: "ana@b.com", emailStatus: "verified" });
    await processor.applyPayment(rejected, "pre-1");
    const entry = deps.audit.mock.calls.find((c: [{ action: string }]) => c[0].action === "payment_rejected")?.[0];
    expect(entry.detail).toMatchObject({ statusDetail: "cc_rejected_insufficient_amount", memberId: 5, notified: true });
    expect(JSON.stringify(entry.detail)).not.toContain("@");
  });
});
```

(el fixture `deps` del archivo tiene que sumar `sendToMember: vi.fn()` a su `mailer`.)

- [ ] **Step 5: Correr y ver el fallo**

Run: `npx vitest run tests/mp-webhook-processor.test.ts`
Expected: falla — hoy la rama del rechazo devuelve sin mirar nada.

- [ ] **Step 6: Implementación en el procesador**

En `src/lib/mp/webhook-processor.ts`:

1. Ampliar la dep: `mailer: Pick<typeof mailer, "sendToApplication" | "sendToMember">;`
2. Importar `paymentRejectedEmail` y `rejectionReason`.
3. Agregar la función, junto a `emailReceipt`:

```ts
  // Un rechazo no aplica nada, pero el vecino tiene derecho a saber que le
  // intentaron cobrar y no se pudo: hasta la 4C el hecho moría en
  // `webhook_events.result`, una tabla que ninguna pantalla muestra.
  //
  // Best-effort de punta a punta: TODO esto va adentro de un try. Si el aviso
  // fallara y saliera como excepción, el webhook devolvería 500 y MP
  // reintentaría un rechazo —o sea, un no-cobro— con backoff para siempre.
  //
  // `p.payerEmail` NO se usa como destinatario: es la casilla de la cuenta de MP
  // del pagador, que puede ser de un tercero (el hijo que le puso la tarjeta al
  // padre). El domicilio electrónico es el de la ficha (Art. 5° quater).
  async function noticeRejection(p: MpPaymentDetails, preapprovalId: string | null): Promise<void> {
    try {
      const link = parsePaymentLinkReference(p.externalReference);
      let memberId = link?.memberId ?? null;
      if (memberId === null && preapprovalId) {
        const sub = await deps.db.mpSubscription.findUnique({
          where: { preapprovalId }, select: { memberId: true },
        });
        memberId = sub?.memberId ?? null;
      }
      if (memberId === null) return;
      const member = await deps.db.member.findUnique({
        where: { id: memberId },
        select: { id: true, fullName: true, email: true, emailStatus: true },
      });
      let notified = false;
      if (member?.email && member.emailStatus !== "bounced") {
        await deps.mailer.sendToMember({
          memberId: member.id,
          to: member.email,
          type: "payment_rejected",
          message: paymentRejectedEmail({
            name: member.fullName,
            amount: p.transactionAmount,
            reason: rejectionReason(p.statusDetail),
          }),
          summary: `débito rechazado (${p.statusDetail ?? "sin detalle"})`,
        });
        notified = true;
      }
      // El `status_detail` sí va al asiento: es un código de MP, no un dato
      // personal, y es lo único que explica el rechazo cuando el socio llama.
      // El `payerEmail` no (mismo criterio que `toInbox`).
      await deps.audit({
        action: "payment_rejected", entity: "mp_payment", entityId: p.id,
        detail: { mpPaymentId: p.id, memberId, statusDetail: p.statusDetail ?? null, amount: p.transactionAmount, notified },
      });
    } catch (e) {
      console.error("[mp-webhook] no se pudo avisar el rechazo", p.id, "code:", codeOf(e));
    }
  }
```

4. Cambiar la rama del rechazo en `applyPayment`:

```ts
    // Un rechazo se traza y se distingue del resto: no hay nada que aplicar,
    // pero el operador quiere poder ver que MP intentó cobrar y no pudo — y
    // desde la 4C el socio también se entera, con el motivo en castellano.
    if (p.status === "rejected") {
      await noticeRejection(p, preapprovalId);
      return "payment_rejected_traced";
    }
```

5. El singleton al final del archivo ya pasa `mailer` completo: no cambia.

- [ ] **Step 7: Correr y ver verde**

Run: `npx vitest run tests/mp-webhook-processor.test.ts tests/email.test.ts tests/mp-rejection-reasons.test.ts`
Expected: PASS.

- [ ] **Step 8: Suite y commit**

Run: `npm test 2>&1 | tail -5 && npx tsc --noEmit && npm run lint`

```bash
git add -A && git commit -m "feat(m4c): a rejected debit finally reaches the member, in Spanish

The branch returned before resolving anything and threw away the status_detail,
so the fact died in webhook_events — a table no screen shows. The notice is
best-effort end to end: if it threw, MP would retry a non-charge forever. The
payer's MP email is never used as the recipient; the ficha's address is.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: Una sola definición de "suscripción viva"

Spec §10 (último punto) y §11.2. Hoy hay **cinco** definiciones distintas (`4c-analysis-deudas.md` §3). No todas son bugs: la de la ficha (`s !== "cancelled"`, lista NEGRA) y la del lote REG-34 (`authorized` a secas) tienen argumento escrito. Las **dos dañinas** son:

- `reconcile.ts:17` — sin `pending`: una suscripción que autorizó y cuyo webhook no llegó **nunca se sincroniza** y el cron no le busca los débitos perdidos. **Es plata que no se recupera.**
- `vincular/page.tsx:55` — sin `paused`: no avisa "el socio ya tiene otra viva", el operador vincula una segunda y el vecino termina con **dos débitos por mes**.

Y de paso: `orphanPreapprovals` cuenta las canceladas para siempre (hoy da **3** en producción y no puede bajar nunca). `/admin/salud` nacería con una alarma que ninguna acción apaga, y una alarma que no se apaga entrena al operador a ignorar el tablero entero.

**Files:**
- Create: `src/lib/mp/subscription-status.ts`, `tests/mp-subscription-status.test.ts`
- Modify: `src/lib/mp/link-subscription.ts`, `src/lib/mp/reconcile.ts`, `src/lib/mp/fee-value-batch.ts` (sólo el comentario), `src/lib/members/auto-debit.ts`, `src/app/admin/tesoreria/suscripciones/[preapprovalId]/vincular/page.tsx`
- Modify: `tests/mp-reconcile.test.ts`, `tests/mp-link-subscription.test.ts`, `tests/member-auto-debit.test.ts`

**Interfaces:**
- Consumes: nada nuevo.
- Produces:

```ts
// src/lib/mp/subscription-status.ts
/** Lista BLANCA: los estados con los que MP todavía puede cobrar. */
export const CHARGEABLE_STATUSES: readonly string[];  // ["authorized", "pending", "paused"]
export function canStillCharge(status: string): boolean;
/** Lista NEGRA de UN valor: lo único que se puede afirmar como muerto. */
export function isKnownDead(status: string): boolean; // status === "cancelled"
export function isNotCancelled(status: string): boolean;
```

- [ ] **Step 1: Test que falla**

Crear `tests/mp-subscription-status.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CHARGEABLE_STATUSES, canStillCharge, isKnownDead, isNotCancelled } from "@/lib/mp/subscription-status";

describe("las dos semánticas de 'suscripción viva'", () => {
  it("puede cobrar: authorized, pending y paused — una pausada se reanuda", () => {
    expect(CHARGEABLE_STATUSES).toEqual(["authorized", "pending", "paused"]);
    for (const s of CHARGEABLE_STATUSES) expect(canStillCharge(s)).toBe(true);
    expect(canStillCharge("cancelled")).toBe(false);
  });
  it("un estado que MP invente mañana NO se afirma como cobrable (lista blanca)", () => {
    expect(canStillCharge("suspended_by_bank_2027")).toBe(false);
  });
  it("no está cancelada: lo ÚNICO que se puede afirmar muerto es `cancelled` (lista negra)", () => {
    expect(isKnownDead("cancelled")).toBe(true);
    for (const s of ["authorized", "pending", "paused", "suspended_by_bank_2027"]) {
      expect(isKnownDead(s)).toBe(false);
      expect(isNotCancelled(s)).toBe(true);
    }
  });
  it("las dos NO son complementarias, y ahí está el punto", () => {
    // Un estado desconocido no se puede cobrar (no prometemos un débito) pero
    // tampoco está muerto (la ficha tiene que seguir avisando).
    expect(canStillCharge("vaya_a_saber")).toBe(false);
    expect(isNotCancelled("vaya_a_saber")).toBe(true);
  });
});
```

- [ ] **Step 2: Correr y ver el fallo, e implementar**

Run: `npx vitest run tests/mp-subscription-status.test.ts` → falla.

Crear `src/lib/mp/subscription-status.ts`:

```ts
// "¿Esta suscripción sigue viva?" — las DOS semánticas que de verdad existen
// (spec 4C §10). Antes había cinco definiciones repartidas y dos de ellas
// producían daño observable: la del reconcile no incluía `pending` (una
// suscripción que autorizó sin webhook nunca se sincronizaba ni se le buscaban
// los débitos: plata no recuperada) y la del vinculador no incluía `paused` (no
// avisaba "ya tiene otra viva" y el vecino terminaba con dos débitos por mes).
//
// No se aplanan en una sola a propósito: son preguntas distintas.
//
//   canStillCharge  — LISTA BLANCA. "¿Puede salir plata por acá?" Se usa para
//                     prometer un débito, para buscarle cobros y para decidir a
//                     quién sincronizar. Un estado que MP invente mañana NO se
//                     afirma como cobrable: prometer un débito que no existe es
//                     peor que no prometer nada.
//   isNotCancelled  — LISTA NEGRA de un solo valor. "¿Puedo afirmar que acá NO
//                     hay débito?" Se usa para avisarle al operador. Acá el
//                     estado desconocido cuenta como débito posible: no saber es
//                     peor que avisar de más (el argumento original vive en
//                     `members/auto-debit.ts:44-49`).
//
// El lote REG-34 (`fee-value-batch.ts`) usa `authorized` a secas y NO importa
// ninguna de las dos: es una tercera pregunta —"¿a cuál tiene sentido empujarle
// un monto AHORA?"— y está documentada en su propio archivo.

export const CHARGEABLE_STATUSES: readonly string[] = ["authorized", "pending", "paused"];

export function canStillCharge(status: string): boolean {
  return CHARGEABLE_STATUSES.includes(status);
}

export function isKnownDead(status: string): boolean {
  return status === "cancelled";
}

export function isNotCancelled(status: string): boolean {
  return !isKnownDead(status);
}
```

Run: `npx vitest run tests/mp-subscription-status.test.ts` → PASS.

- [ ] **Step 3: Los cinco sitios pasan a importarlo**

1. `src/lib/mp/link-subscription.ts`: borrar `CHARGEABLE_STATUSES` y `canStillCharge` (líneas 26-34) y reemplazar por `export { canStillCharge } from "./subscription-status";` — se **re-exporta** para no romper a `vincular/page.tsx:35`, que ya lo importa desde acá.
2. `src/lib/mp/reconcile.ts`: borrar `const LIVE_STATUSES = ["authorized", "paused"];` (línea 17) e importar `CHARGEABLE_STATUSES`; la consulta de la línea 191 pasa a `where: { status: { in: [...CHARGEABLE_STATUSES] } }`. **Este cambio suma `pending` a lo que el cron sincroniza y le busca débitos.**
3. `src/app/admin/tesoreria/suscripciones/[preapprovalId]/vincular/page.tsx`: borrar `const LIVE_STATUSES = ["authorized", "pending"];` (línea 55) y cambiar la línea 163 por
   `const otherLive = member?.mpSubscriptions.filter((s) => canStillCharge(s.status)).length ?? 0;`
   (el import de `canStillCharge` ya existe). **Esto suma `paused` al aviso de "ya tiene otra viva".**
4. `src/lib/members/auto-debit.ts`: en `autoDebitSignal`, `if (input.subscriptionStatuses.some(isNotCancelled)) return "subscription";` con el import de `@/lib/mp/subscription-status`, y dejar el comentario de `:44-49` donde está (es el argumento de la lista negra) agregando una línea: `// El predicado vive ahora en `mp/subscription-status.ts`; el argumento, acá.`
5. `src/lib/mp/fee-value-batch.ts`: **no cambia el `where`**; se le agrega al comentario de `listDivergent`:

```
 *  Es una tercera pregunta, distinta de las dos de `mp/subscription-status.ts`:
 *  no es "¿puede cobrar?" sino "¿a cuál tiene sentido empujarle un monto AHORA?".
 *  El costo conocido: una `paused` que se reanuda vuelve a cobrar el monto viejo
 *  y no aparece en ninguna lista.
```

- [ ] **Step 4: Las huérfanas dejan de contar las canceladas**

En `src/lib/mp/reconcile.ts`, paso 4, **antes** de las dos ramas que incrementan `orphanPreapprovals` (o sea justo después del `if (await deps.db.mpSubscription.findUnique(...)) continue;`):

```ts
            // Una cancelada no es una huérfana que haya que atender: no cobra
            // nunca más. Antes se contaban igual y el número no podía bajar —en
            // producción daba 3 desde siempre—, así que /admin/salud iba a nacer
            // con una alarma que ninguna acción apaga. Una alarma que no se apaga
            // entrena al operador a ignorar el tablero entero.
            if (isKnownDead(pre.status)) continue;
```

(con el import de `isKnownDead`.) La guarda `pre.status !== "cancelled"` de la rama que cancela queda igual: es defensa en profundidad y no molesta.

- [ ] **Step 5: Ajustar los tests de reconcile**

En `tests/mp-reconcile.test.ts`, el caso que hoy fija `orphanPreapprovals: 2` cambia según los fixtures. Agregar además:

```ts
  it("una huérfana CANCELADA no se cuenta: la alarma tiene que poder apagarse", async () => {
    gateway.searchPreapprovals.mockResolvedValue([
      { id: "pre-cancelada", status: "cancelled", externalReference: null, amount: null, payerEmail: null },
    ]);
    const s = await reconcile.run();
    expect(s.orphanPreapprovals).toBe(0);
    expect(gateway.cancelPreapproval).not.toHaveBeenCalled();
  });

  it("las `pending` también se sincronizan: sin esto, una que autorizó sin webhook queda muerta para siempre", async () => {
    await reconcile.run();
    expect(db.mpSubscription.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: { in: ["authorized", "pending", "paused"] } },
    }));
  });
```

- [ ] **Step 6: Correr y ver verde**

Run: `npx vitest run tests/mp-subscription-status.test.ts tests/mp-reconcile.test.ts tests/mp-link-subscription.test.ts tests/member-auto-debit.test.ts`
Expected: PASS.

- [ ] **Step 7: Suite y commit**

Run: `npm test 2>&1 | tail -5 && npx tsc --noEmit && npm run lint`

```bash
git add -A && git commit -m "fix(m4c): five definitions of a live subscription, two of them costing money

The reconcile left pending ones out, so a subscription that authorised without a
webhook was never synced and its debits were never recovered. The linking screen
left paused ones out, so it never warned 'this member already has one' and the
neighbour ended up debited twice a month. Both now import the same two named
predicates, and the orphan counter stops counting cancelled ones forever —
the health screen would have been born with an alarm nobody could turn off.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: Bajas y Mercado Pago — cancelar el débito, el tercer balde, REG-15 y el toggle

Spec §10 y §11.4. Es la deuda de **riesgo ALTO** del inventario: hoy se puede dejar de ser socio y **seguir siendo debitado todos los meses**. `memberService.withdraw` (`service.ts:82-135`) no toca `MpSubscription` ni llama a MP, y el lote de cesantía usa el **mismo** servicio, así que las dos bajas del panel quedan afuera.

La llamada **no puede ir adentro de `withdraw`**: es una `$transaction` y una llamada de red adentro sostiene el lock hasta el timeout de 5 s de Prisma (mismo corolario que el PDF del recibo, fase 4A). Va en un módulo de dominio vecino que los dos llamadores comparten.

> Cargar el skill `frontend-design` antes de escribir JSX.

**Files:**
- Create: `src/lib/members/withdraw-with-debits.ts`, `tests/members-withdraw-with-debits.test.ts`
- Create: `src/app/admin/socios/[id]/auto-debit-form.tsx`, `tests/auto-debit-action.test.ts`
- Modify: `src/app/admin/socios/[id]/{actions.ts,page.tsx}`, `src/app/admin/tesoreria/deudores/{actions.ts,page.tsx,arrears-form.tsx}`
- Modify: `tests/arrears-actions-auth.test.ts`, `tests/member-actions.test.ts`

**Interfaces:**
- Consumes: `memberService.withdraw(input)` (`service.ts:82`), `mpGateway.cancelPreapproval(id): Promise<void>` (`gateway.ts:73`), `isKnownDead` / `canStillCharge` (Task 11), `mpErrorLog` (`@/lib/mp/error-log`), `ACCRUING_CATEGORIES` (`rules.ts:34`), `ARREARS_THRESHOLD` (`rules.ts:96`), `audit`, `requireAdmin`.
- Produces:

```ts
// src/lib/members/withdraw-with-debits.ts
export type DebitCancellation = {
  /** preapprovalIds que MP aceptó cancelar. */
  cancelled: string[];
  /** Los que NO se pudieron cancelar: la baja salió igual y esto queda para reintentar. */
  failed: Array<{ preapprovalId: string; code: string }>;
};
export function makeWithdrawWithDebits(deps: {
  db: Pick<PrismaClient, "mpSubscription">;
  service: { withdraw(input: WithdrawInput): Promise<unknown> };
  gateway: Pick<MpGateway, "cancelPreapproval">;
  now?: () => Date;
}): { withdraw(input: WithdrawInput): Promise<{ debits: DebitCancellation }> };
export const withdrawWithDebits: ReturnType<typeof makeWithdrawWithDebits>;
// WithdrawInput = { memberId: number; reason: WithdrawalReason; minuteId: number; actorId: number; detail?: string }

// src/app/admin/socios/[id]/actions.ts
export async function setAutoDebitAction(_prev: State, formData: FormData): Promise<State>;
```

- [ ] **Step 1: Test que falla — la baja cancela**

Crear `tests/members-withdraw-with-debits.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { makeWithdrawWithDebits } from "@/lib/members/withdraw-with-debits";

const input = { memberId: 3, reason: "resignation" as const, minuteId: 1, actorId: 9 };

function build(subs: Array<{ preapprovalId: string; status: string }>, opts?: {
  cancel?: ReturnType<typeof vi.fn>; updateMany?: ReturnType<typeof vi.fn>; withdraw?: ReturnType<typeof vi.fn>;
}) {
  const cancelPreapproval = opts?.cancel ?? vi.fn(async () => {});
  const updateMany = opts?.updateMany ?? vi.fn(async () => ({ count: 1 }));
  const withdraw = opts?.withdraw ?? vi.fn(async () => ({ id: 3 }));
  const db = { mpSubscription: { findMany: vi.fn(async () => subs), updateMany } };
  return {
    api: makeWithdrawWithDebits({ db: db as never, service: { withdraw }, gateway: { cancelPreapproval } as never }),
    cancelPreapproval, updateMany, withdraw, db,
  };
}

describe("withdrawWithDebits", () => {
  it("da la baja PRIMERO y recién después habla con Mercado Pago", async () => {
    const order: string[] = [];
    const withdraw = vi.fn(async () => { order.push("withdraw"); return { id: 3 }; });
    const cancel = vi.fn(async () => { order.push("cancel"); });
    const { api } = build([{ preapprovalId: "pre-1", status: "authorized" }], { withdraw, cancel });
    const r = await api.withdraw(input);
    expect(order).toEqual(["withdraw", "cancel"]);
    expect(r.debits.cancelled).toEqual(["pre-1"]);
  });

  it("cancela TODAS las vivas: memberId es índice, no unique, y puede haber dos", async () => {
    const { api, cancelPreapproval } = build([
      { preapprovalId: "pre-1", status: "authorized" },
      { preapprovalId: "pre-2", status: "paused" },
    ]);
    const r = await api.withdraw(input);
    expect(cancelPreapproval).toHaveBeenCalledTimes(2);
    expect(r.debits.cancelled).toEqual(["pre-1", "pre-2"]);
  });

  it("no vuelve a cancelar una ya cancelada", async () => {
    const { api, cancelPreapproval } = build([{ preapprovalId: "pre-1", status: "cancelled" }]);
    const r = await api.withdraw(input);
    expect(cancelPreapproval).not.toHaveBeenCalled();
    expect(r.debits.cancelled).toEqual([]);
  });

  it("si MP falla, la baja NO se deshace y el débito queda listado para reintentar", async () => {
    const cancel = vi.fn(async () => { throw { status: 500, message: "MP caído" }; });
    const { api, withdraw } = build([{ preapprovalId: "pre-1", status: "authorized" }], { cancel });
    const r = await api.withdraw(input);
    expect(withdraw).toHaveBeenCalled();
    expect(r.debits.cancelled).toEqual([]);
    expect(r.debits.failed).toEqual([{ preapprovalId: "pre-1", code: expect.any(String) }]);
  });

  it("el espejo local se actualiza en un try APARTE: marcar el fallo cuando falló el UPDATE local mandaría al operador a cancelar algo que MP ya canceló", async () => {
    const updateMany = vi.fn(async () => { throw new Error("db"); });
    const { api } = build([{ preapprovalId: "pre-1", status: "authorized" }], { updateMany });
    const r = await api.withdraw(input);
    expect(r.debits.cancelled).toEqual(["pre-1"]);
    expect(r.debits.failed).toEqual([]);
  });

  it("si la baja falla, no se cancela nada (no se le corta el débito a quien sigue siendo socio)", async () => {
    const withdraw = vi.fn(async () => { throw new Error("El socio ya está dado de baja."); });
    const { api, cancelPreapproval } = build([{ preapprovalId: "pre-1", status: "authorized" }], { withdraw });
    await expect(api.withdraw(input)).rejects.toThrow("ya está dado de baja");
    expect(cancelPreapproval).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Correr y ver el fallo, e implementar**

Run: `npx vitest run tests/members-withdraw-with-debits.test.ts` → falla.

Crear `src/lib/members/withdraw-with-debits.ts`:

```ts
// Baja + cancelación del débito automático en Mercado Pago (spec 4C §10).
//
// Por qué vive acá y no dentro de `memberService.withdraw`: `withdraw` es una
// `$transaction`, y una llamada de red adentro sostiene el lock de las filas
// hasta el timeout de 5 s de Prisma (mismo corolario que el PDF del recibo en la
// fase 4A). La cancelación va DESPUÉS del commit.
//
// Por qué no vive en la server action: el lote de cesantía por mora llama al
// mismo servicio, y si la cancelación colgara de `withdrawAction` el lote —que
// es el que más socios da de baja de una vez— quedaría afuera. Es exactamente la
// mitad del agujero que describe docs/07.
//
// Best-effort con FALLO VISIBLE: la baja ya está asentada en el acta y no se
// deshace porque MP esté caído, pero el llamador recibe qué quedó abierto para
// poder decirlo en pantalla y reintentarlo.
import type { PrismaClient, WithdrawalReason } from "@/generated/prisma/client";
import { describeMpError, mpErrorLog } from "@/lib/mp/error-log";
import { mpGateway, type MpGateway } from "@/lib/mp/gateway";
import { isKnownDead } from "@/lib/mp/subscription-status";
import { prisma } from "@/lib/prisma";
import { memberService } from "./service";

export type WithdrawInput = {
  memberId: number; reason: WithdrawalReason; minuteId: number; actorId: number; detail?: string;
};

export type DebitCancellation = {
  cancelled: string[];
  failed: Array<{ preapprovalId: string; code: string }>;
};

type Deps = {
  db: Pick<PrismaClient, "mpSubscription">;
  service: { withdraw(input: WithdrawInput): Promise<unknown> };
  gateway: Pick<MpGateway, "cancelPreapproval">;
  now?: () => Date;
};

export function makeWithdrawWithDebits(deps: Deps) {
  const now = deps.now ?? (() => new Date());

  return {
    async withdraw(input: WithdrawInput): Promise<{ debits: DebitCancellation }> {
      // Primero la baja. Si el estatuto la rechaza (ya está dado de baja), tira
      // y no se toca ningún débito: cortarle el cobro a quien sigue siendo socio
      // sería peor que el problema que esto viene a resolver.
      await deps.service.withdraw(input);

      const debits: DebitCancellation = { cancelled: [], failed: [] };
      const subs = await deps.db.mpSubscription.findMany({
        where: { memberId: input.memberId },
        select: { preapprovalId: true, status: true },
        orderBy: { id: "asc" },
      });
      for (const s of subs) {
        // Una cancelada no se vuelve a cancelar: sería una llamada de red que no
        // puede ganar nada y un error de MP que no significa nada.
        if (isKnownDead(s.status)) continue;
        try {
          await deps.gateway.cancelPreapproval(s.preapprovalId);
          debits.cancelled.push(s.preapprovalId);
        } catch (e) {
          // El SDK de MP no lanza `Error`: `mpErrorLog` desarma el cuerpo y lo
          // enmascara (puede traer el `payer_email` del vecino).
          console.error("[baja] no se pudo cancelar el débito —", mpErrorLog("cancelPreapproval", { preapprovalId: s.preapprovalId }, e));
          debits.failed.push({ preapprovalId: s.preapprovalId, code: describeMpError(e).code || "unknown" });
          continue;
        }
        // El espejo local va en su PROPIO try: si acá falla, MP ya canceló, y
        // marcarlo como fallido mandaría al operador a cancelar de nuevo algo que
        // ya está cancelado. La conciliación diaria corrige el espejo sola.
        try {
          await deps.db.mpSubscription.updateMany({
            where: { preapprovalId: s.preapprovalId },
            data: { status: "cancelled", lastSyncAt: now() },
          });
        } catch (e) {
          console.error("[baja] el débito se canceló en MP pero el espejo local no se actualizó", s.preapprovalId, e instanceof Error ? e.message : e);
        }
      }
      return { debits };
    },
  };
}

export const withdrawWithDebits = makeWithdrawWithDebits({
  db: prisma, service: memberService, gateway: mpGateway,
});
```

Run: `npx vitest run tests/members-withdraw-with-debits.test.ts` → PASS.

- [ ] **Step 3: La baja individual lo usa y la ficha lo dice**

En `src/app/admin/socios/[id]/actions.ts`:

1. En `runAction`, agregar a `opts`:

```ts
    /** Querystring del redirect final, derivado de lo que devolvió `run`. Lo usa
     *  la baja: si Mercado Pago no aceptó cancelar el débito, la ficha tiene que
     *  decirlo — la baja salió igual y el cobro sigue vivo. */
    redirectQuery?: (result: unknown) => string;
```

2. Capturar el resultado y usarlo en el redirect:

```ts
  let result: unknown;
  try {
    result = await opts.run({ actorId, memberId, minuteId }, member, data);
  } catch (e) {
    if (createdMinute) await discardUnusedMinute(prisma, minuteId);
    return { error: messageOf(e) };
  }
```

y al final: `redirect(`/admin/socios/${memberId}${opts.redirectQuery?.(result) ?? ""}`);`

3. `withdrawAction` pasa a usar el módulo nuevo y a informar el fallo:

```ts
export async function withdrawAction(_p: State, formData: FormData): Promise<State> {
  return runAction(
    formData,
    {
      reason: z.enum(REASONS, { error: "Elegí el motivo de la baja." }),
      detail: z.string().max(300, "El detalle no puede superar los 300 caracteres").optional(),
    },
    {
      guard: (member) => canWithdraw(member),
      // `withdrawWithDebits` y no `memberService.withdraw`: dejar de ser socio
      // tiene que cortar el débito automático por el camino que sea (REG-16 no
      // devenga más, así que un débito vivo le cobra a alguien que ya no es
      // socio). La cancelación corre DESPUÉS del commit.
      run: ({ memberId, minuteId, actorId }, _member, data) =>
        withdrawWithDebits.withdraw({
          memberId, minuteId, actorId,
          reason: data.reason as WithdrawalReason,
          detail: data.detail as string | undefined,
        }),
      auditAction: "member_withdraw",
      // Los preapprovalIds SÍ van al asiento: `cancelFailed: true` sin decir QUÉ
      // cancelar no le sirve a nadie, y el asiento es donde el operador va a
      // buscar el id para reintentar en el panel de MP.
      detail: (_m, data) => ({ reason: data.reason }),
      redirectQuery: (r) => {
        const failed = (r as { debits: DebitCancellation }).debits.failed.length;
        return failed > 0 ? `?debito=pendiente&n=${failed}` : "";
      },
    },
  );
}
```

**Nota para el implementador:** el `detail` de `runAction` no ve el resultado de `run`, así que el asiento con los ids de los débitos se escribe **adentro** de la action, después de `runAction`, no es posible — la forma correcta es agregar los ids al asiento desde `withdrawWithDebits` NO (no audita) sino ampliando `runAction` con un `detailFromResult?: (result: unknown) => Record<string, unknown>` que se fusiona con `detail`. Implementar ese segundo hook igual que `redirectQuery` y usarlo así:

```ts
      detailFromResult: (r) => {
        const d = (r as { debits: DebitCancellation }).debits;
        return { debitsCancelled: d.cancelled, debitsFailed: d.failed };
      },
```

4. En `src/app/admin/socios/[id]/page.tsx`, agregar `searchParams` a la firma y el aviso:

```tsx
export default async function SocioPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const debitPending = one(sp.debito) === "pendiente" ? Number(one(sp.n) ?? 0) : 0;
```

y arriba del `PageHeader` (o inmediatamente después, dentro del `div` raíz):

```tsx
      {debitPending > 0 && (
        <FormMessage kind="warning" box>
          {`La baja quedó asentada, pero Mercado Pago no aceptó cancelar ${debitPending === 1 ? "el débito automático" : `${debitPending} débitos automáticos`}. `}
          <Link className="font-medium underline underline-offset-2 outline-hidden focus-visible:ring-2 focus-visible:ring-ring" href="/admin/tesoreria/suscripciones">
            Revisalo en Suscripciones
          </Link>
          {" — mientras siga vivo, se le va a seguir cobrando."}
        </FormMessage>
      )}
```

- [ ] **Step 4: El lote de cesantía — REG-15 y el tercer balde**

En `src/app/admin/tesoreria/deudores/actions.ts`:

1. `State` gana el tercer balde:

```ts
type State = {
  error?: string;
  declared?: number;
  failures?: Array<{ memberId: number; name: string; error: string }>;
  /** Cesanteados a los que NO se les pudo cortar el débito en Mercado Pago.
   *  Balde propio y no `failures`: meterlos ahí diría que la cesantía falló
   *  sobre alguien que SÍ quedó cesante, que es lo contrario de lo que pasó. */
  debitFailures?: Array<{ memberId: number; name: string; count: number }>;
  confirm?: { token: string; minuteLabel: string; targets: ArrearsConfirmTarget[]; changed?: boolean };
};
```

2. El `select` del `findMany` de socios suma `category: true`.

3. En el bucle, antes del chequeo del umbral:

```ts
    // REG-15 (Art. 9 inc. c): la cesantía por mora alcanza a activos y
    // colaboradores. El adherente aporta voluntariamente y su deuda no lo hace
    // cesante — hasta la 4C la pantalla le ofrecía la casilla igual y esta
    // acción lo habría dado de baja.
    if (!ACCRUING_CATEGORIES.includes(m.category)) {
      failures.push({
        memberId: m.id, name: m.fullName,
        error: `${CATEGORY_LABELS[m.category]}: la cesantía por mora sólo alcanza a socios activos y colaboradores (Art. 9 inc. c).`,
      });
      continue;
    }
```

4. La baja pasa por el módulo nuevo y llena el tercer balde:

```ts
    try {
      const { debits } = await withdrawWithDebits.withdraw({
        memberId: m.id, reason: "arrears", minuteId, actorId,
        detail: `Cesantía por mora: ${pendingCount} cuotas adeudadas (Art. 9 inc. c)`,
      });
      declared++;
      if (debits.failed.length > 0) {
        debitFailures.push({ memberId: m.id, name: m.fullName, count: debits.failed.length });
      }
      // El servicio no audita: eso vive en esta capa, que es la única que ve la
      // IP del operador. Ids y conteos, nunca nombres ni DNIs (Ley 25.326).
      await audit({
        userId: actorId, action: "arrears_declared", entity: "member", entityId: m.id,
        detail: { minuteId, pendingCount, debitsCancelled: debits.cancelled, debitsFailed: debits.failed }, ip,
      });
    } catch (e) {
      failures.push({
        memberId: m.id,
        name: m.fullName,
        error: e instanceof Error ? e.message : "No se pudo declarar la cesantía.",
      });
    }
```

(declarando `const debitFailures: NonNullable<State["debitFailures"]> = [];` junto a `failures`).

5. El redirect deja de esconder el aviso:

```ts
  // Con éxito PARCIAL no se redirige: el querystring no tiene dónde poner los
  // motivos. Y tampoco se redirige cuando la cesantía salió pero el débito quedó
  // vivo: si redirigiéramos, ese aviso —el único que dice que a un ex socio se
  // le sigue cobrando— se perdería.
  if (failures.length > 0 || debitFailures.length > 0) {
    revalidatePath(BASE);
    return { declared, failures: failures.length > 0 ? failures : undefined, debitFailures: debitFailures.length > 0 ? debitFailures : undefined };
  }
```

- [ ] **Step 5: La pantalla — casilla sólo a quien corresponde y el tercer aviso**

En `src/app/admin/tesoreria/deudores/page.tsx`, cambiar el cálculo de candidatos:

```tsx
  // REG-15: la casilla sólo para quien el estatuto habilita a cesantear. El
  // adherente con deuda SIGUE siendo visible como deudor —su deuda es real— pero
  // sin casilla: la cesantía por mora no lo alcanza.
  const candidates = rows
    .filter((r) => r.pendingCount >= ARREARS_THRESHOLD && ACCRUING_CATEGORIES.includes(r.category))
    .map((r) => r.memberId);
```

y, en la fila, la condición de la casilla deja de repetir el umbral y pasa a preguntar por la lista ya calculada (que ahora también filtra por categoría):

```tsx
            {candidates.length > 0 && (
              <TableCell>
                {candidates.includes(r.memberId) && (
                  <label className="flex min-h-11 items-center">
                    <input type="checkbox" name="ids" value={r.memberId} className="size-4" />
                    <span className="sr-only">Seleccionar a {r.fullName}</span>
                  </label>
                )}
              </TableCell>
            )}
```

(el comentario de arriba de ese bloque —"la casilla sólo en las filas que el estatuto habilita"— pasa a decir *"…que el estatuto habilita: ni el que debe 3 cuotas ni el adherente, cualquiera sea su deuda"*.)

En `src/app/admin/tesoreria/deudores/arrears-form.tsx`, debajo del bloque que hoy renderiza `state.failures`:

```tsx
      {state.debitFailures && state.debitFailures.length > 0 && (
        <FormMessage kind="warning" box as="div">
          <p className="font-medium">
            Se declaró la cesantía, pero Mercado Pago no aceptó cancelar el débito automático:
          </p>
          <ul className="mt-1 list-disc pl-5">
            {state.debitFailures.map((f) => (
              <li key={f.memberId}>
                {f.name} — {f.count === 1 ? "1 débito sigue vivo" : `${f.count} débitos siguen vivos`}
              </li>
            ))}
          </ul>
          <p className="mt-1">
            Mientras sigan vivos se les va a seguir cobrando:{" "}
            <Link className="font-medium underline underline-offset-2 outline-hidden focus-visible:ring-2 focus-visible:ring-ring" href="/admin/tesoreria/suscripciones">
              cancelalos desde Suscripciones
            </Link>.
          </p>
        </FormMessage>
      )}
```

(y sumar `debitFailures` al tipo estructural del `State` que el formulario declara).

- [ ] **Step 6: Toggle de `Member.autoDebit` en la ficha**

`Member.autoDebit` tiene hoy **tres escrituras y ninguna lo baja** (`padron/mapping.ts:111`, `applications/record.ts:86`, `link-subscription.ts:91`, este último sólo escribe `true`), y **cuatro superficies lo muestran**, incluida la exportación que va a la Comisión. No hay ningún camino para corregirlo.

En `src/app/admin/socios/[id]/actions.ts`:

```ts
const autoDebitSchema = z.object({
  memberId: z.coerce.number("Socio inválido.").int("Socio inválido.").positive("Socio inválido."),
  // El checkbox manda "on" o no manda nada; cualquier otra cosa es un POST a mano.
  autoDebit: z.literal("on", { error: "Valor inválido." }).optional(),
});

/** El flag NO significa "tiene débito automático andando": significa que en
 *  algún momento hubo intención de débito (ver `members/auto-debit.ts:20-24`).
 *  Por eso esta acción no toca ninguna suscripción de Mercado Pago — no crea ni
 *  cancela nada— y por eso el texto de la pantalla dice lo que dice. */
export async function setAutoDebitAction(_p: State, formData: FormData): Promise<State> {
  const actor = await requireAdmin();
  if (!actor.ok) return { error: actor.error };
  const parsed = parseForm(autoDebitSchema, formData);
  if (!parsed.ok) return { error: parsed.error };
  const to = parsed.data.autoDebit === "on";
  const member = await prisma.member.findUnique({
    where: { id: parsed.data.memberId }, select: { id: true, autoDebit: true },
  });
  if (!member) return { error: "El socio no existe." };
  if (member.autoDebit === to) return {};
  await prisma.member.update({ where: { id: member.id }, data: { autoDebit: to } });
  const ip = (await headers()).get("x-real-ip") ?? "unknown";
  await audit({
    userId: actor.actorId, action: "member_auto_debit_set", entity: "member", entityId: member.id,
    detail: { from: member.autoDebit, to }, ip,
  });
  revalidatePath(`/admin/socios/${member.id}`);
  return {};
}
```

(agregar los imports de `revalidatePath` y `prisma` si no están.)

Crear `src/app/admin/socios/[id]/auto-debit-form.tsx`:

```tsx
"use client";
// Corrección del flag de débito automático de la ficha.
//
// El flag dice "hubo intención de débito", no "hay un débito andando": tres
// caminos lo suben (padrón importado, alta web, vinculación) y hasta la 4C
// ninguno lo bajaba, así que un socio que dejó de pagar por débito hace tres
// años seguía figurando con débito en la ficha, en el padrón y en la
// exportación que va a la Comisión.
//
// El checkbox vive en `useSyncedForm` por el mismo motivo que el de ASOCIATE:
// React 19 resetea el form cuando la action termina y un checkbox destildado por
// ese reset no lo corrige React.
import { useActionState } from "react";
import { FormMessage } from "@/components/admin/form-message";
import { useSyncedForm } from "@/components/admin/synced-fields";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { setAutoDebitAction } from "./actions";

export function AutoDebitForm({ memberId, autoDebit }: { memberId: number; autoDebit: boolean }) {
  const [state, formAction, pending] = useActionState(setAutoDebitAction, {} as { error?: string });
  const { values, setValue, formRef } = useSyncedForm({ autoDebit: autoDebit ? "on" : "" });

  return (
    <form ref={formRef} action={formAction} className="space-y-2">
      <input type="hidden" name="memberId" value={memberId} />
      <Label htmlFor="autoDebit" className="flex min-h-11 items-center gap-2 text-sm">
        <input
          id="autoDebit"
          type="checkbox"
          name="autoDebit"
          value="on"
          checked={values.autoDebit === "on"}
          onChange={(e) => setValue("autoDebit", e.target.checked ? "on" : "")}
          className="size-4"
        />
        Figura con débito automático
      </Label>
      <p className="text-xs text-muted-foreground">
        Es lo que declaró el socio o lo que traía el padrón, no el estado real del cobro en Mercado
        Pago: destildarlo no cancela ningún débito. Para eso, Tesorería → Suscripciones.
      </p>
      {state.error && <FormMessage kind="error">{state.error}</FormMessage>}
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Guardando…" : "Guardar"}
      </Button>
    </form>
  );
}
```

En `src/app/admin/socios/[id]/page.tsx`, reemplazar
`<Field label="Débito automático" value={member.autoDebit ? "Sí" : "No"} />`
por
```tsx
                    <div className="col-span-2 md:col-span-1">
                      <dt className="text-xs text-muted-foreground">Débito automático</dt>
                      <dd className="mt-1"><AutoDebitForm memberId={member.id} autoDebit={member.autoDebit} /></dd>
                    </div>
```

Crear `tests/auto-debit-action.test.ts` con los cuatro casos: sin sesión de admin → error; socio inexistente → "El socio no existe."; de `false` a `true` → `update` + asiento `member_auto_debit_set` con `{from:false,to:true}`; guardado sin cambio → no escribe ni audita.

- [ ] **Step 7: Correr y ver verde**

Run: `npx vitest run tests/members-withdraw-with-debits.test.ts tests/auto-debit-action.test.ts tests/arrears-actions-auth.test.ts tests/member-actions.test.ts tests/member-service.test.ts`
Expected: PASS.

- [ ] **Step 8: Verificar en el navegador**

Run: `npm run dev`
1. `/admin/tesoreria/deudores` con un adherente moroso de 4+ cuotas: **no** tiene casilla y sigue en la lista.
2. Ficha de un socio: el toggle guarda y persiste al recargar.
3. Baja de un socio con suscripción (en dev, con el gateway apuntando a sandbox o mockeado): al volver a la ficha, si MP falló, el aviso ámbar aparece.

- [ ] **Step 9: Suite y commit**

Run: `npm test 2>&1 | tail -5 && npx tsc --noEmit && npm run lint`

```bash
git add -A && git commit -m "fix(m4c): stop debiting people who stopped being members

withdraw() never touched Mercado Pago, and the arrears batch used the same
service, so both ways of leaving the association left the monthly charge alive.
The call lives next to the service and runs after the commit — inside the
transaction it would hold the row lock across a network call.

Three more: the batch reports a THIRD bucket (expelled, but the debit survived —
putting those in failures would claim the expulsion failed on someone who is
expelled), REG-15 stops offering the checkbox to adherents, and autoDebit finally
has a screen that can lower it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 13A: Los datos de `/admin/salud`

Spec §8, paneles 1 a 5, **sin la pantalla**: consultas y estados puros o con Prisma inyectado, para que la tarea siguiente sólo tenga que renderizar. **D3 resuelta**: es un tablero de una mirada — dice QUÉ está mal y desde cuándo, con el dato mínimo para ir a buscarlo. El diagnóstico fino sigue en PM2 y en las tablas.

**Files:**
- Create: `src/lib/admin/health.ts`, `src/lib/admin/health-backup.ts`
- Create: `tests/admin-health.test.ts`
- Modify: `src/lib/format.ts`, `src/lib/admin/status-badges.ts`, `.env.example`
- Modify: `tests/format.test.ts`, `tests/status-badges.test.ts`

**Interfaces:**
- Consumes: `CRON_JOBS` / `CRON_JOB_LIST` / `CronJob` (Task 1), los índices de la Task 2 (`notifications(status)`, `audit_log(action)`, `webhook_events(origin, receivedAt)`), y de Prisma sólo `cronRun`, `webhookEvent`, `auditLog`, `notification`, `mpUnmatchedPayment`, `mpSubscription` y `member` (el `receipt` lo consulta la action de reenvío de la Task 13B, no este módulo).
- Produces:

```ts
// src/lib/format.ts
/** "hace 3 horas" / "hace 2 días" / "recién". Puro: recibe el `now`. */
export function formatRelativeAgo(from: Date, now: Date): string;

// src/lib/admin/status-badges.ts
export function cronStateBadgeVariant(state: CronState): BadgeVariant;
export function backupStateBadgeVariant(state: BackupState): BadgeVariant;

// src/lib/admin/health-backup.ts
export type BackupState = "fresh" | "stale" | "missing" | "unconfigured";
export type BackupHealth = { state: BackupState; lastOkAt: Date | null };
export const BACKUP_FRESH_HOURS = 26;
export async function readBackupHealth(
  now: Date,
  opts?: { dir?: string; readFile?: (path: string) => Promise<string> },
): Promise<BackupHealth>;

// src/lib/admin/health.ts
export type CronState = "ok" | "errors" | "stale" | "hung" | "never";
export const CRON_EXPECTATION: Record<CronJob, { label: string; everyHours: number }>;
export function cronState(
  run: { startedAt: Date; finishedAt: Date | null; ok: boolean } | null,
  everyHours: number,
  now: Date,
): CronState;
export type CronHealth = {
  job: CronJob; label: string; everyHours: number; state: CronState;
  lastRun: { id: string; startedAt: Date; finishedAt: Date | null; ok: boolean; error: string | null; summary: unknown } | null;
};
export type MpHealth = { lastEventAt: Date | null; unprocessedWithError: number; signatureRejections: number };
export type AmountMismatch = {
  id: string; createdAt: Date; paymentId: number | null; memberId: number | null;
  memberName: string | null; n: number | null; expected: number | null; amount: number | null;
};
export type MoneyHealth = {
  inboxOpen: number; inboxTotal: number; subscriptionsDivergent: number; mismatches: AmountMismatch[];
};
export type FailedNotification = {
  id: string; sentAt: Date; type: NotificationType; error: string | null;
  payloadSummary: string | null; memberId: number | null; memberName: string | null;
  applicationId: number | null; /** Número de recibo si el aviso era un recibo (único camino de reenvío). */ receiptNumber: string | null;
};
export type HealthSnapshot = {
  now: Date; crons: CronHealth[]; mp: MpHealth; money: MoneyHealth; failed: FailedNotification[];
};
export function receiptNumberOf(payloadSummary: string | null): string | null;
export async function fetchHealth(db: HealthDb, now: Date): Promise<HealthSnapshot>;
```

- [ ] **Step 1: Test que falla — tiempo relativo, estados y backup**

Crear `tests/admin-health.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { CRON_EXPECTATION, cronState, receiptNumberOf } from "@/lib/admin/health";
import { readBackupHealth } from "@/lib/admin/health-backup";
import { formatRelativeAgo } from "@/lib/format";

const NOW = new Date("2026-09-15T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000);

describe("formatRelativeAgo", () => {
  it("bajo el minuto, 'recién'", () => {
    expect(formatRelativeAgo(new Date(NOW.getTime() - 30_000), NOW)).toBe("recién");
  });
  it("minutos, horas y días en es-AR, en singular y plural", () => {
    expect(formatRelativeAgo(hoursAgo(0.5), NOW)).toBe("hace 30 minutos");
    expect(formatRelativeAgo(hoursAgo(1), NOW)).toBe("hace 1 hora");
    expect(formatRelativeAgo(hoursAgo(3), NOW)).toBe("hace 3 horas");
    expect(formatRelativeAgo(hoursAgo(25), NOW)).toBe("hace 1 día");
    expect(formatRelativeAgo(hoursAgo(72), NOW)).toBe("hace 3 días");
  });
});

describe("cronState", () => {
  const ran = (over: Partial<{ startedAt: Date; finishedAt: Date | null; ok: boolean }> = {}) =>
    ({ startedAt: hoursAgo(2), finishedAt: hoursAgo(2), ok: true, ...over });

  it("sin ninguna corrida, 'never'", () => {
    expect(cronState(null, 24, NOW)).toBe("never");
  });
  it("corrida reciente y limpia, 'ok'", () => {
    expect(cronState(ran(), 24, NOW)).toBe("ok");
  });
  it("una corrida abierta hace horas está COLGADA, no 'mal': el proceso murió sin cerrarla", () => {
    expect(cronState(ran({ finishedAt: null, ok: false }), 24, NOW)).toBe("hung");
  });
  it("una corrida abierta recién puede estar corriendo ahora mismo", () => {
    expect(cronState({ startedAt: new Date(NOW.getTime() - 60_000), finishedAt: null, ok: false }, 24, NOW)).toBe("ok");
  });
  it("terminó con errores → 'errors', aunque sea de hace un minuto", () => {
    expect(cronState(ran({ ok: false }), 24, NOW)).toBe("errors");
  });
  it("vieja más del DOBLE del período esperado → 'stale'", () => {
    expect(cronState(ran({ startedAt: hoursAgo(49), finishedAt: hoursAgo(49) }), 24, NOW)).toBe("stale");
    expect(cronState(ran({ startedAt: hoursAgo(47), finishedAt: hoursAgo(47) }), 24, NOW)).toBe("ok");
  });
  it("el devengo y el recordatorio son MENSUALES: 30 h sin correr es normal", () => {
    expect(CRON_EXPECTATION.accrual.everyHours).toBeGreaterThan(24 * 27);
    expect(CRON_EXPECTATION.reminder.everyHours).toBeGreaterThan(24 * 27);
    expect(cronState(ran({ startedAt: hoursAgo(30), finishedAt: hoursAgo(30) }), CRON_EXPECTATION.accrual.everyHours, NOW)).toBe("ok");
  });
  it("los cinco jobs tienen expectativa declarada", () => {
    expect(Object.keys(CRON_EXPECTATION).sort()).toEqual(["accrual", "applications", "digest", "reconcile", "reminder"]);
  });
});

describe("readBackupHealth", () => {
  it("sin BACKUP_DIR, 'unconfigured' — no revienta ni acusa un backup roto", async () => {
    expect(await readBackupHealth(NOW, { dir: undefined })).toEqual({ state: "unconfigured", lastOkAt: null });
  });
  it("con el sello fresco, 'fresh'", async () => {
    const readFile = vi.fn(async () => `${hoursAgo(8).toISOString()}\n`);
    expect(await readBackupHealth(NOW, { dir: "/var/sigev/backups", readFile })).toEqual({
      state: "fresh", lastOkAt: hoursAgo(8),
    });
  });
  it("más de 26 h, 'stale' (el backup corre a las 04:00: 26 h da margen a un atraso)", async () => {
    const readFile = vi.fn(async () => hoursAgo(30).toISOString());
    expect((await readBackupHealth(NOW, { dir: "/x", readFile })).state).toBe("stale");
  });
  it("el archivo no existe → 'missing', que NO es lo mismo que 'viejo'", async () => {
    const readFile = vi.fn(async () => { throw Object.assign(new Error("ENOENT"), { code: "ENOENT" }); });
    expect(await readBackupHealth(NOW, { dir: "/x", readFile })).toEqual({ state: "missing", lastOkAt: null });
  });
  it("un sello ilegible también es 'missing': un backup que no se puede leer no es un backup", async () => {
    const readFile = vi.fn(async () => "la semana pasada");
    expect((await readBackupHealth(NOW, { dir: "/x", readFile })).state).toBe("missing");
  });
});

describe("receiptNumberOf", () => {
  it("saca el número del resumen que escribe el mailer del recibo", () => {
    expect(receiptNumberOf("recibo 2026-00042")).toBe("2026-00042");
  });
  it("cualquier otro resumen no tiene camino de reenvío", () => {
    expect(receiptNumberOf("link de pago × 3")).toBeNull();
    expect(receiptNumberOf(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Correr y ver el fallo**

Run: `npx vitest run tests/admin-health.test.ts`
Expected: `Failed to resolve import "@/lib/admin/health"`.

- [ ] **Step 3: `formatRelativeAgo` en `src/lib/format.ts`**

```ts
// "hace 3 horas". Recibe el `now` en vez de leer el reloj: es la regla del
// proyecto para todo lo que se testea (mismo criterio que `currentPeriod(now)`).
// Sin plurales irregulares y sin librería: son cuatro tramos.
export function formatRelativeAgo(from: Date, now: Date): string {
  const seconds = Math.max(0, Math.round((now.getTime() - from.getTime()) / 1000))
  if (seconds < 60) return "recién"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `hace ${minutes} ${minutes === 1 ? "minuto" : "minutos"}`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `hace ${hours} ${hours === 1 ? "hora" : "horas"}`
  const days = Math.floor(hours / 24)
  return `hace ${days} ${days === 1 ? "día" : "días"}`
}
```

- [ ] **Step 4: `src/lib/admin/health-backup.ts`**

```ts
// Lectura del sello del backup nocturno (spec 4C §8, panel 2).
//
// `scripts/backup.sh:39-41` escribe `LAST_OK` con un ISO-8601 UTC al terminar
// bien, y lo puso ahí a propósito para esta pantalla. El fallo NO deja rastro en
// disco (el `trap ... ERR` sólo escribe a stderr, que va al log del cron), así
// que lo único que se puede leer es la ANTIGÜEDAD del último éxito.
//
// `node:fs` acá adentro: este módulo no se importa NUNCA desde un componente
// cliente (misma nota que `treasury/receipts-dir.ts`).
import { readFile as fsReadFile } from "node:fs/promises";
import { join } from "node:path";

export type BackupState = "fresh" | "stale" | "missing" | "unconfigured";
export type BackupHealth = { state: BackupState; lastOkAt: Date | null };

/** El backup corre a las 04:00 (`scripts/backup.sh:3`). 26 h en vez de 24 le dan
 *  margen a una corrida lenta sin acusar un backup roto que no lo está. */
export const BACKUP_FRESH_HOURS = 26;

export async function readBackupHealth(
  now: Date,
  opts?: { dir?: string; readFile?: (path: string) => Promise<string> },
): Promise<BackupHealth> {
  const dir = opts && "dir" in opts ? opts.dir : process.env.BACKUP_DIR;
  // Los TRES estados se distinguen a propósito: "no configurado" (nadie definió
  // BACKUP_DIR), "no está el archivo" (el backup nunca corrió, o la ruta apunta
  // mal) y "viejo" (corría y se cortó). Un `Date | null` pelado los confunde, y
  // significan cosas muy distintas para el que tiene que arreglarlo.
  if (!dir) return { state: "unconfigured", lastOkAt: null };
  const read = opts?.readFile ?? ((p: string) => fsReadFile(p, "utf8"));
  let raw: string;
  try {
    raw = await read(join(dir, "LAST_OK"));
  } catch {
    return { state: "missing", lastOkAt: null };
  }
  const lastOkAt = new Date(raw.trim());
  if (Number.isNaN(lastOkAt.getTime())) return { state: "missing", lastOkAt: null };
  const hours = (now.getTime() - lastOkAt.getTime()) / 3_600_000;
  return { state: hours <= BACKUP_FRESH_HOURS ? "fresh" : "stale", lastOkAt };
}
```

- [ ] **Step 5: `src/lib/admin/health.ts`**

```ts
// Los datos de /admin/salud (spec 4C §8). Prisma INYECTADO: el módulo se prueba
// sin `.env`.
//
// Alcance (D3): tablero de una mirada. Dice QUÉ está mal y DESDE CUÁNDO, con el
// dato mínimo para ir a buscarlo. El diagnóstico fino sigue en `pm2 logs sigev`
// y en las tablas — y eso es un techo real, no una omisión: los ids de lo que
// falló en el reconcile van al log y NO al summary (decisión de
// `mp/reconcile.ts:124-127`, para que la causa sobreviva al recorte).
//
// Sin tablas nuevas: `cron_runs`, `webhook_events`, `audit_log` por acción,
// `notifications` por estado y el `LAST_OK` del backup en disco.
import type { NotificationType, PrismaClient } from "@/generated/prisma/client";
import { CRON_JOB_LIST, type CronJob } from "@/lib/cron/auth";

/** Cada cuánto se espera una corrida EFECTIVA de cada job. No es el intervalo
 *  del crontab: `accrual` y `reminder` corren a diario y actúan una vez por mes,
 *  y `digest` no escribe fila los días sin novedades. Medir a los cinco con la
 *  misma vara pintaría de rojo tres crons sanos varias veces por semana. */
export const CRON_EXPECTATION: Record<CronJob, { label: string; everyHours: number }> = {
  reconcile: { label: "Conciliación con Mercado Pago", everyHours: 24 },
  applications: { label: "Mantenimiento de solicitudes", everyHours: 24 },
  accrual: { label: "Devengo de cuotas", everyHours: 24 * 31 },
  reminder: { label: "Recordatorio de vencimiento", everyHours: 24 * 31 },
  // El resumen no se manda los días sin novedades, así que su fila puede faltar
  // varios días seguidos sin que nada esté mal. Una semana entera sin una sola
  // novedad en todo el sistema sí amerita mirar.
  digest: { label: "Resumen diario a la Comisión", everyHours: 24 * 7 },
};

export type CronState = "ok" | "errors" | "stale" | "hung" | "never";

/** Una corrida abierta hace menos de esto puede estar corriendo AHORA. */
const RUNNING_GRACE_HOURS = 2;

export function cronState(
  run: { startedAt: Date; finishedAt: Date | null; ok: boolean } | null,
  everyHours: number,
  now: Date,
): CronState {
  if (!run) return "never";
  const ageHours = (now.getTime() - run.startedAt.getTime()) / 3_600_000;
  // `finishedAt IS NULL` con `startedAt` viejo es una corrida que se abrió y
  // nunca cerró: el proceso murió. Es distinto de `ok: false` —que significa
  // "terminó y algo falló"— y hoy son indistinguibles si se mira sólo el
  // booleano, porque `ok` arranca en `false`.
  if (run.finishedAt === null) return ageHours > RUNNING_GRACE_HOURS ? "hung" : "ok";
  if (!run.ok) return "errors";
  // El doble del período esperado: un atraso de una corrida es ruido de
  // calendario; dos seguidas es que dejó de correr.
  return ageHours > everyHours * 2 ? "stale" : "ok";
}

export type CronHealth = {
  job: CronJob;
  label: string;
  everyHours: number;
  state: CronState;
  lastRun: {
    id: string; startedAt: Date; finishedAt: Date | null; ok: boolean; error: string | null; summary: unknown;
  } | null;
};

export type MpHealth = {
  /** El último evento RECIBIDO. Es la señal más importante del panel: un
   *  preapproval ignora `notification_url`, así que si la configuración de
   *  webhooks del panel de MP se rompe, los débitos dejan de avisar sin ninguna
   *  otra señal. */
  lastEventAt: Date | null;
  unprocessedWithError: number;
  signatureRejections: number;
};

export type AmountMismatch = {
  id: string; createdAt: Date; paymentId: number | null; memberId: number | null;
  memberName: string | null; n: number | null; expected: number | null; amount: number | null;
};

export type MoneyHealth = {
  inboxOpen: number;
  inboxTotal: number;
  subscriptionsDivergent: number;
  mismatches: AmountMismatch[];
};

export type FailedNotification = {
  id: string; sentAt: Date; type: NotificationType; error: string | null;
  payloadSummary: string | null; memberId: number | null; memberName: string | null;
  applicationId: number | null; receiptNumber: string | null;
};

export type HealthSnapshot = {
  now: Date; crons: CronHealth[]; mp: MpHealth; money: MoneyHealth; failed: FailedNotification[];
};

/** El ÚNICO camino de reenvío que existe (spec §7.5): el recibo, por el modelo
 *  del botón "Reenviar por email".
 *
 *  Sale de `payloadSummary` porque no hay de dónde más: la fila no guarda el id
 *  de la entidad y `payloadSummary` es texto libre de 300 caracteres, no un
 *  payload re-armable. Esa es la limitación, y por eso NO hay cola genérica de
 *  reintentos: los demás avisos se muestran con su error y de qué entidad
 *  vienen, y se rehacen desde la pantalla que los origina. El formato lo fija
 *  `treasury/receipt-email.ts:91` (`recibo ${número}`). */
export function receiptNumberOf(payloadSummary: string | null): string | null {
  if (!payloadSummary?.startsWith("recibo ")) return null;
  const n = payloadSummary.slice("recibo ".length).trim();
  return n === "" ? null : n;
}

const SIGNATURE_WINDOW_HOURS = 24;
const MISMATCH_LIMIT = 20;
const FAILED_LIMIT = 50;

type HealthDb = Pick<
  PrismaClient,
  "cronRun" | "webhookEvent" | "auditLog" | "notification" | "mpUnmatchedPayment" | "mpSubscription" | "member"
>;

export async function fetchHealth(db: HealthDb, now: Date): Promise<HealthSnapshot> {
  const since = new Date(now.getTime() - SIGNATURE_WINDOW_HOURS * 3_600_000);
  const [runs, lastEvent, unprocessedWithError, signatureRejections, inboxOpen, inboxTotal, subscriptionsDivergent, mismatchRows, failedRows] =
    await Promise.all([
      // Una consulta por job y no un groupBy: son cinco, el índice
      // `[job, startedAt]` está hecho para esto y el groupBy no puede traer la
      // fila entera de la última corrida.
      Promise.all(CRON_JOB_LIST.map((job) =>
        db.cronRun.findFirst({
          where: { job }, orderBy: { startedAt: "desc" },
          select: { id: true, startedAt: true, finishedAt: true, ok: true, error: true, summary: true },
        }).then((r) => [job, r] as const),
      )),
      db.webhookEvent.findFirst({ where: { origin: "mp" }, orderBy: { receivedAt: "desc" }, select: { receivedAt: true } }),
      db.webhookEvent.count({ where: { origin: "mp", processedAt: null, error: { not: null } } }),
      db.auditLog.count({ where: { action: "webhook_rejected_signature", createdAt: { gte: since } } }),
      db.mpUnmatchedPayment.count({ where: { status: "open" } }),
      db.mpUnmatchedPayment.count(),
      // "Desalineadas": el espejo local dice algo que no es `authorized`. No es
      // lo mismo que la divergencia de MONTO (esa la mide el lote REG-34) y por
      // eso el panel las nombra distinto.
      db.mpSubscription.count({ where: { status: { not: "authorized" } } }),
      db.auditLog.findMany({
        where: { action: "link_amount_mismatch" },
        orderBy: { id: "desc" }, take: MISMATCH_LIMIT,
        select: { id: true, createdAt: true, detail: true },
      }),
      db.notification.findMany({
        where: { status: "failed" },
        orderBy: { sentAt: "desc" }, take: FAILED_LIMIT,
        select: {
          id: true, sentAt: true, type: true, error: true, payloadSummary: true,
          memberId: true, applicationId: true,
        },
      }),
    ]);

  // Los nombres de socio se resuelven por id al renderizar (mismo criterio que
  // `fee_value_applied`): el `detail` del asiento nunca los guarda.
  const memberIds = [
    ...new Set([
      ...mismatchRows.map((r) => Number((r.detail as { memberId?: unknown } | null)?.memberId)).filter(Number.isInteger),
      ...failedRows.map((r) => r.memberId).filter((v): v is number => v !== null),
    ]),
  ];
  const members = memberIds.length === 0 ? [] : await db.member.findMany({
    where: { id: { in: memberIds } }, select: { id: true, fullName: true },
  });
  const nameOf = new Map(members.map((m) => [m.id, m.fullName]));
  const num = (v: unknown) => (typeof v === "number" ? v : null);

  return {
    now,
    crons: runs.map(([job, r]) => ({
      job,
      label: CRON_EXPECTATION[job].label,
      everyHours: CRON_EXPECTATION[job].everyHours,
      state: cronState(r, CRON_EXPECTATION[job].everyHours, now),
      lastRun: r ? { ...r, id: String(r.id) } : null,
    })),
    mp: { lastEventAt: lastEvent?.receivedAt ?? null, unprocessedWithError, signatureRejections },
    money: {
      inboxOpen, inboxTotal, subscriptionsDivergent,
      mismatches: mismatchRows.map((r) => {
        const d = (r.detail ?? {}) as Record<string, unknown>;
        const memberId = num(d.memberId);
        return {
          id: String(r.id), createdAt: r.createdAt,
          paymentId: num(d.paymentId), memberId,
          memberName: memberId === null ? null : nameOf.get(memberId) ?? null,
          n: num(d.n), expected: num(d.expected), amount: num(d.amount),
        };
      }),
    },
    failed: failedRows.map((r) => ({
      ...r, id: String(r.id),
      memberName: r.memberId === null ? null : nameOf.get(r.memberId) ?? null,
      receiptNumber: receiptNumberOf(r.payloadSummary),
    })),
  };
}
```

- [ ] **Step 6: Badges de salud**

En `src/lib/admin/status-badges.ts`:

```ts
// La salud se lee de un vistazo y por PESO, no sólo por color: lo que exige
// acción va con relleno; lo sano, con borde fino.
export function cronStateBadgeVariant(state: CronState): BadgeVariant {
  if (state === "hung" || state === "errors") return "destructive";
  // "stale" y "never" no son un error: son una ausencia. Gris con relleno —se ve
  // de lejos— pero no rojo, que en este tablero significa "algo se rompió".
  if (state === "stale" || state === "never") return "secondary";
  return "success";
}

export function backupStateBadgeVariant(state: BackupState): BadgeVariant {
  if (state === "missing") return "destructive";
  if (state === "stale") return "secondary";
  if (state === "unconfigured") return "outline";
  return "success";
}
```

y sus casos en `tests/status-badges.test.ts` (uno por estado, afirmando que **ningún** estado devuelve una variante inexistente y que `ok`/`fresh` son los únicos `success`).

- [ ] **Step 7: `.env.example`**

```
# --- Backup nocturno (Módulo 4C) ---
# Carpeta donde `scripts/backup.sh` deja el sello `LAST_OK` (docs/09). La usa
# /admin/salud para avisar si los backups se cortaron. Sin definir, el panel
# dice "sin configurar" y no acusa un backup roto que no lo está.
BACKUP_DIR=/var/sigev/backups
```

- [ ] **Step 8: Correr y ver verde**

Run: `npx vitest run tests/admin-health.test.ts tests/format.test.ts tests/status-badges.test.ts`
Expected: PASS.

- [ ] **Step 9: Suite y commit**

Run: `npm test 2>&1 | tail -5 && npx tsc --noEmit && npm run lint`

```bash
git add -A && git commit -m "feat(m4c): the numbers behind the health screen

No new tables: cron_runs, webhook_events, audit_log by action, notifications by
status and the backup's LAST_OK stamp on disk. A cron that legitimately does
nothing is not painted red — accrual and reminder are monthly, digest skips
quiet days — and a run that opened and never closed is told apart from one that
finished badly.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 13B: La pantalla `/admin/salud`

Spec §8. Sección nueva del grupo **Sistema**, superadmin. Cinco paneles de sólo lectura más el reenvío por entidad (§7.5).

> Cargar el skill `frontend-design` antes de escribir JSX.

**Files:**
- Create: `src/app/admin/salud/page.tsx`, `src/app/admin/salud/actions.ts`, `src/app/admin/salud/resend-form.tsx`
- Create: `tests/health-actions-auth.test.ts`
- Modify: `src/lib/admin/nav.ts`, `src/components/admin/admin-nav-list.tsx`, `src/lib/admin/dashboard-cards.ts`
- Modify: `tests/admin-nav.test.ts`, `tests/dashboard-cards.test.ts`

**Interfaces:**
- Consumes: `fetchHealth(db, now)` / `CRON_EXPECTATION` / `CronHealth` / `receiptNumberOf` (Task 13A), `readBackupHealth(now)` (Task 13A), `cronStateBadgeVariant` / `backupStateBadgeVariant` (Task 13A), `formatRelativeAgo` (Task 13A), `sendReceiptEmail(receiptId)` (`@/lib/treasury/receipt-email`), `requireSuperadmin`, `PageHeader` / `FormMessage` / `EmptyState` / `Badge` / `Table`.
- Produces:

```ts
// src/lib/admin/nav.ts
export type AdminNavIcon = /* …las 8 de hoy… */ | "activity";
// ADMIN_NAV, grupo Sistema: { href: "/admin/salud", label: "Salud", icon: "activity", superadminOnly: true }

// src/app/admin/salud/actions.ts
export async function resendNotificationAction(_prev: State, formData: FormData): Promise<State>;
// State = { error?: string; ok?: string }
```

- [ ] **Step 1: Test que falla — nav y tarjeta gemela**

En `tests/admin-nav.test.ts`, agregar:

```ts
  it("Salud vive en Sistema y es sólo para superadmin", () => {
    const sistema = ADMIN_NAV.find((g) => g.label === "Sistema")!;
    const salud = sistema.items.find((i) => i.href === "/admin/salud")!;
    expect(salud).toMatchObject({ label: "Salud", icon: "activity", superadminOnly: true });
    expect(navForRoles(["admin"]).some((g) => g.items.some((i) => i.href === "/admin/salud"))).toBe(false);
  });
  it("marca activa también en sus subrutas", () => {
    expect(isNavItemActive("/admin/salud", "/admin/salud")).toBe(true);
  });
```

`tests/dashboard-cards.test.ts` **no se toca**: sus cinco asserts ya exigen la tarjeta gemela (mismo `href`, `title` idéntico al `label`, mismo `superadminOnly`), así que van a fallar solos hasta que exista.

- [ ] **Step 2: Correr y ver el fallo**

Run: `npx vitest run tests/admin-nav.test.ts tests/dashboard-cards.test.ts`
Expected: fallan los dos.

- [ ] **Step 3: Nav, icono y tarjeta**

En `src/lib/admin/nav.ts`: agregar `| "activity"` a `AdminNavIcon` y, en el grupo Sistema, **antes** de Configuración:

```ts
      // Salud va primero: es la pantalla que se abre cuando algo anda mal, y
      // Configuración es la que se abre cuando hay que cambiar algo. Lo urgente
      // arriba.
      { href: "/admin/salud", label: "Salud", icon: "activity", superadminOnly: true },
```

En `src/components/admin/admin-nav-list.tsx`: importar `Activity` de `lucide-react` y agregar `activity: Activity,` al `Record` `ICONS` (es exhaustivo: sin esto no compila, que es exactamente para lo que está).

En `src/lib/admin/dashboard-cards.ts`, en el grupo Sistema, antes de Configuración:

```ts
      {
        // `title` idéntico al `label` de la nav: lo verifica dashboard-cards.test.ts.
        title: "Salud",
        description: "Tareas automáticas, backup, Mercado Pago y avisos que no salieron.",
        href: "/admin/salud",
        cta: "Ver el estado",
        superadminOnly: true,
      },
```

Run: `npx vitest run tests/admin-nav.test.ts tests/dashboard-cards.test.ts` → PASS.

- [ ] **Step 4: Test que falla — la autorización del reenvío**

Crear `tests/health-actions-auth.test.ts` siguiendo el molde de `tests/receipt-actions-auth.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  requireSuperadmin: vi.fn(),
  findUnique: vi.fn(),
  findFirst: vi.fn(),
  deleteMany: vi.fn(async () => ({ count: 1 })),
  sendReceiptEmail: vi.fn(async () => ({ sent: true })),
  audit: vi.fn(async () => {}),
}));
vi.mock("@/lib/auth/require-admin", () => ({ requireSuperadmin: mocks.requireSuperadmin }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  notification: { findUnique: mocks.findUnique, deleteMany: mocks.deleteMany },
  receipt: { findFirst: mocks.findFirst },
} }));
vi.mock("@/lib/treasury/receipt-email", () => ({ sendReceiptEmail: mocks.sendReceiptEmail }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { resendNotificationAction } from "@/app/admin/salud/actions";

const fd = (id: string) => { const f = new FormData(); f.set("notificationId", id); return f; };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireSuperadmin.mockResolvedValue({ ok: true, actorId: 1 });
  mocks.findUnique.mockResolvedValue({ id: BigInt(3), status: "failed", type: "receipt", payloadSummary: "recibo 2026-00042" });
  mocks.findFirst.mockResolvedValue({ id: 42 });
});

describe("resendNotificationAction", () => {
  it("un admin común no puede: la pantalla es superadmin y la action se autoriza sola", async () => {
    mocks.requireSuperadmin.mockResolvedValue({ ok: false, reason: "not_admin", error: "No tenés permiso." });
    expect((await resendNotificationAction({}, fd("3"))).error).toBe("No tenés permiso.");
    expect(mocks.sendReceiptEmail).not.toHaveBeenCalled();
  });
  it("reenvía el recibo y saca la fila fallida de la lista", async () => {
    const r = await resendNotificationAction({}, fd("3"));
    expect(mocks.sendReceiptEmail).toHaveBeenCalledWith(42);
    expect(mocks.deleteMany).toHaveBeenCalledWith({ where: { id: BigInt(3), status: "failed" } });
    expect(r.ok).toContain("2026-00042");
  });
  it("si el reenvío tampoco sale, la fila NO se borra", async () => {
    mocks.sendReceiptEmail.mockResolvedValue({ sent: false, reason: "error", code: "EAUTH" });
    const r = await resendNotificationAction({}, fd("3"));
    expect(mocks.deleteMany).not.toHaveBeenCalled();
    expect(r.error).toBeTruthy();
  });
  it("un aviso sin camino de reenvío lo dice, no lo intenta", async () => {
    mocks.findUnique.mockResolvedValue({ id: BigInt(3), status: "failed", type: "fee_reminder", payloadSummary: "recordatorio de vencimiento 2026-09" });
    expect((await resendNotificationAction({}, fd("3"))).error).toContain("no se puede reenviar");
  });
  it("una fila que ya no está fallida no se reenvía", async () => {
    mocks.findUnique.mockResolvedValue({ id: BigInt(3), status: "sent", type: "receipt", payloadSummary: "recibo 2026-00042" });
    expect((await resendNotificationAction({}, fd("3"))).error).toBeTruthy();
    expect(mocks.sendReceiptEmail).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 5: Implementación de la action**

Crear `src/app/admin/salud/actions.ts`:

```ts
"use server";
// Reenvío POR ENTIDAD de un aviso que no salió (spec 4C §7.5).
//
// No hay cola genérica de reintentos, y no es una omisión: `payloadSummary` es
// texto de 300 caracteres, no un payload re-armable, así que "reintentar" un
// aviso cualquiera significaría re-generar el mensaje desde cero con datos que
// la fila no guarda. El único camino que existe es el del RECIBO, que ya tiene
// su reenvío probado (`sendReceiptEmail` lee el recibo, regenera el PDF si hace
// falta y vuelve a mandar). Los demás avisos se muestran con su error y con la
// entidad de la que vienen, para rehacerlos desde su propia pantalla.
//
// Superadmin y no admin: la pantalla entera lo es, y una server action se
// autoriza a sí misma (Next la despacha por el id del encabezado `Next-Action`,
// no por su URL).
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireSuperadmin } from "@/lib/auth/require-admin";
import { receiptNumberOf } from "@/lib/admin/health";
import { parseForm } from "@/lib/forms";
import { prisma } from "@/lib/prisma";
import { sendReceiptEmail } from "@/lib/treasury/receipt-email";

type State = { error?: string; ok?: string };

const schema = z.object({
  notificationId: z
    .string("Aviso inválido.")
    .regex(/^\d{1,19}$/, "Aviso inválido."), // BigInt: no entra en un Number
});

export async function resendNotificationAction(_prev: State, formData: FormData): Promise<State> {
  const actor = await requireSuperadmin();
  if (!actor.ok) return { error: actor.error };
  const parsed = parseForm(schema, formData);
  if (!parsed.ok) return { error: parsed.error };
  const id = BigInt(parsed.data.notificationId);

  const row = await prisma.notification.findUnique({
    where: { id }, select: { id: true, status: true, type: true, payloadSummary: true },
  });
  if (!row) return { error: "El aviso no existe." };
  if (row.status !== "failed") return { error: "Ese aviso ya no figura como fallido." };
  const number = row.type === "receipt" ? receiptNumberOf(row.payloadSummary) : null;
  if (number === null) {
    return { error: "Este aviso no se puede reenviar desde acá: rehacelo desde la pantalla que lo origina." };
  }
  const receipt = await prisma.receipt.findFirst({ where: { number }, select: { id: true } });
  if (!receipt) return { error: `No se encontró el recibo ${number}.` };

  const result = await sendReceiptEmail(receipt.id);
  const ip = (await headers()).get("x-real-ip") ?? "unknown";
  await audit({
    userId: actor.actorId, action: "notification_resent", entity: "notification", entityId: String(id),
    // Ids, número de recibo y el desenlace. Nunca la dirección.
    detail: { notificationId: String(id), type: row.type, receiptId: receipt.id, sent: result.sent, reason: result.sent ? null : result.reason },
    ip,
  });
  if (!result.sent) {
    // La fila se queda: sigue siendo un aviso que no salió, y borrarla dejaría
    // el hueco sin rastro justo cuando el problema persiste.
    return { error: `No se pudo reenviar el recibo ${number}. Motivo: ${result.reason}.` };
  }
  // Salió: la fila `failed` era el registro de un INTENTO, y el envío nuevo dejó
  // su propia fila `sent`, que es la que acredita (Art. 5° quater). Dejarla
  // sería una alarma permanente sobre algo ya resuelto — y el CA pide que
  // "Reenviar" la saque de la lista.
  await prisma.notification.deleteMany({ where: { id, status: "failed" } });
  revalidatePath("/admin/salud");
  return { ok: `Recibo ${number} reenviado.` };
}
```

Run: `npx vitest run tests/health-actions-auth.test.ts` → PASS.

- [ ] **Step 6: El formulario de reenvío**

Crear `src/app/admin/salud/resend-form.tsx`:

```tsx
"use client";
import { useActionState } from "react";
import { FormMessage } from "@/components/admin/form-message";
import { Button } from "@/components/ui/button";
import { resendNotificationAction } from "./actions";

export function ResendForm({ notificationId, label }: { notificationId: string; label: string }) {
  const [state, formAction, pending] = useActionState(resendNotificationAction, {} as { error?: string; ok?: string });
  return (
    <form action={formAction} className="space-y-1">
      <input type="hidden" name="notificationId" value={notificationId} />
      <Button type="submit" variant="secondary" size="sm" disabled={pending}>
        {pending ? "Enviando…" : "Reenviar"}
        <span className="sr-only"> {label}</span>
      </Button>
      {state.error && <FormMessage kind="error">{state.error}</FormMessage>}
      {state.ok && <FormMessage kind="success">{state.ok}</FormMessage>}
    </form>
  );
}
```

- [ ] **Step 7: La pantalla**

Crear `src/app/admin/salud/page.tsx`:

```tsx
// /admin/salud (spec 4C §8): qué está mal y desde cuándo.
//
// Es un tablero de una mirada, no una herramienta de diagnóstico (D3): el
// detalle fino vive en `pm2 logs sigev` y en las tablas, y eso es un techo real
// —los ids de lo que falló en el reconcile van al log y NO al summary, por la
// decisión de `mp/reconcile.ts:124-127`—. Lo único que escribe acá es el
// reenvío de un aviso fallido.
//
// Sin gráficos: cinco bloques, cada uno con el número que importa arriba.
import Link from "next/link";
import { EmptyState } from "@/components/admin/empty-state";
import { FormMessage } from "@/components/admin/form-message";
import { PageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { backupStateBadgeVariant, cronStateBadgeVariant } from "@/lib/admin/status-badges";
import { fetchHealth, type CronState } from "@/lib/admin/health";
import { readBackupHealth, type BackupState } from "@/lib/admin/health-backup";
import { requireSuperadmin } from "@/lib/auth/require-admin";
import { formatARS, formatDateTimeAR, formatRelativeAgo } from "@/lib/format";
import { NOTIFICATION_TYPE_LABELS } from "@/lib/members/labels";
import { prisma } from "@/lib/prisma";
import { ResendForm } from "./resend-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Salud — SIGeV" };

const CRON_STATE_LABEL: Record<CronState, string> = {
  ok: "Al día",
  errors: "Terminó con errores",
  stale: "Hace mucho que no corre",
  hung: "Quedó colgada",
  never: "Nunca corrió",
};

const BACKUP_STATE_LABEL: Record<BackupState, string> = {
  fresh: "Al día",
  stale: "Atrasado",
  missing: "Sin rastro",
  unconfigured: "Sin configurar",
};

export default async function SaludPage() {
  const actor = await requireSuperadmin();
  if (!actor.ok) {
    // Pantalla de bloqueo, NO redirect (mismo motivo que /admin/configuracion:
    // acá no falta la sesión, falta un rol, y /redirigir lo mandaría de vuelta).
    return (
      <div className="space-y-4">
        <PageHeader title="Salud" />
        <FormMessage kind="error" box>{actor.error}</FormMessage>
      </div>
    );
  }

  const now = new Date();
  const [health, backup] = await Promise.all([fetchHealth(prisma, now), readBackupHealth(now)]);

  return (
    <div className="space-y-6">
      <PageHeader title="Salud">
        <p className="text-sm text-muted-foreground">
          Estado de las tareas automáticas, el backup, Mercado Pago y los avisos por email. Actualizado{" "}
          {formatDateTimeAR(now)}.
        </p>
      </PageHeader>

      {/* 1. Crons */}
      <section aria-labelledby="crons" className="space-y-3">
        <h2 id="crons" className="text-sm font-semibold tracking-widest text-muted-foreground uppercase">
          Tareas automáticas
        </h2>
        <p className="text-sm text-muted-foreground">
          Se muestra la última corrida <strong>efectiva</strong>: una tarea que decide no actuar —el devengo
          un día que no es 1, el resumen sin novedades— no deja registro, y eso es normal.
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tarea</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Última corrida</TableHead>
              <TableHead>Resultado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {health.crons.map((c) => (
              <TableRow key={c.job}>
                <TableCell>
                  {c.label}
                  <span className="block text-xs text-muted-foreground">{c.job}</span>
                </TableCell>
                <TableCell>
                  <Badge variant={cronStateBadgeVariant(c.state)}>{CRON_STATE_LABEL[c.state]}</Badge>
                </TableCell>
                <TableCell>
                  {c.lastRun ? (
                    <>
                      {formatRelativeAgo(c.lastRun.startedAt, now)}
                      <span className="block text-xs text-muted-foreground">{formatDateTimeAR(c.lastRun.startedAt)}</span>
                    </>
                  ) : "—"}
                </TableCell>
                <TableCell className="max-w-md">
                  {c.lastRun?.error ? (
                    // El texto del error va en monoespaciada y sin recortar: es
                    // lo único que explica qué se rompió, y viene ya enmascarado
                    // y acotado a 500 caracteres desde la ruta del cron.
                    <code className="block overflow-x-auto text-xs">{c.lastRun.error}</code>
                  ) : c.lastRun?.summary ? (
                    <code className="block overflow-x-auto text-xs">{JSON.stringify(c.lastRun.summary)}</code>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      {/* 2 y 3. Backup y Mercado Pago */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Backup nocturno</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Badge variant={backupStateBadgeVariant(backup.state)}>{BACKUP_STATE_LABEL[backup.state]}</Badge>
            <p>
              {backup.lastOkAt
                ? <>Último backup correcto {formatRelativeAgo(backup.lastOkAt, now)} ({formatDateTimeAR(backup.lastOkAt)}).</>
                : backup.state === "unconfigured"
                  ? <>Falta la variable <code>BACKUP_DIR</code> en el <code>.env</code> del servidor: el panel no puede leer el sello del backup.</>
                  : <>No se encontró el sello del último backup correcto. Puede que el script no esté instalado o que <code>BACKUP_DIR</code> apunte a otra carpeta.</>}
            </p>
            <p className="text-xs text-muted-foreground">
              El script corre a las 04:00 y sólo deja rastro cuando termina bien: lo que se mide es la
              antigüedad del último éxito.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Mercado Pago</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              {health.mp.lastEventAt
                ? <>Último aviso recibido {formatRelativeAgo(health.mp.lastEventAt, now)}.</>
                : <strong>Nunca llegó ningún aviso de Mercado Pago.</strong>}
            </p>
            <p className="text-xs text-muted-foreground">
              Es la señal más importante de este panel: una suscripción no usa la URL de aviso de la
              preferencia, así que si la configuración de webhooks del panel de Mercado Pago se rompe, los
              débitos dejan de avisar sin ninguna otra señal.
            </p>
            <ul className="space-y-1">
              <li>
                Avisos con error sin procesar:{" "}
                <span className="font-mono tabular-nums">{health.mp.unprocessedWithError}</span>
              </li>
              <li>
                Rechazos de firma (últimas 24 h):{" "}
                <span className="font-mono tabular-nums">{health.mp.signatureRejections}</span>
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>

      {/* 4. Dinero sin resolver */}
      <section aria-labelledby="dinero" className="space-y-3">
        <h2 id="dinero" className="text-sm font-semibold tracking-widest text-muted-foreground uppercase">
          Dinero sin resolver
        </h2>
        <p className="text-sm">
          <Link className="font-medium text-primary underline underline-offset-2 outline-hidden focus-visible:ring-2 focus-visible:ring-ring" href="/admin/tesoreria/sin-conciliar">
            {`${health.money.inboxOpen} ${health.money.inboxOpen === 1 ? "cobro" : "cobros"} esperando decisión`}
          </Link>{" "}
          <span className="text-muted-foreground">de {health.money.inboxTotal} que pasaron por la bandeja</span> ·{" "}
          <Link className="font-medium text-primary underline underline-offset-2 outline-hidden focus-visible:ring-2 focus-visible:ring-ring" href="/admin/tesoreria/suscripciones">
            {`${health.money.subscriptionsDivergent} ${health.money.subscriptionsDivergent === 1 ? "suscripción no activa" : "suscripciones no activas"}`}
          </Link>
        </p>
        <h3 className="text-sm font-medium">Links de pago cobrados por un importe distinto al vigente</h3>
        {health.money.mismatches.length === 0 ? (
          <EmptyState size="card" description="Ningún link cobró un importe distinto al que correspondía." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cuándo</TableHead>
                <TableHead>Socio</TableHead>
                <TableHead className="text-right">Cuotas</TableHead>
                <TableHead className="text-right">Se esperaba</TableHead>
                <TableHead className="text-right">Se cobró</TableHead>
                <TableHead className="text-right">Diferencia</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {health.money.mismatches.map((m) => {
                const diff = m.expected !== null && m.amount !== null ? m.amount - m.expected : null;
                return (
                  <TableRow key={m.id}>
                    <TableCell>{formatDateTimeAR(m.createdAt)}</TableCell>
                    <TableCell>
                      {m.memberId ? (
                        <Link className="text-primary hover:underline" href={`/admin/socios/${m.memberId}?tab=cuenta`}>
                          {m.memberName ?? `Socio ${m.memberId}`}
                        </Link>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{m.n ?? "—"}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{m.expected === null ? "—" : formatARS(m.expected)}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{m.amount === null ? "—" : formatARS(m.amount)}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {/* El signo importa: cobró de menos (hay que reclamar) o de
                          más (hay que devolver) son dos problemas distintos. */}
                      {diff === null ? "—" : <Badge variant={diff < 0 ? "destructive" : "secondary"}>{formatARS(diff)}</Badge>}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        <p className="text-xs text-muted-foreground">
          El cobro se imputó igual: lo que falta es decidir si se reclama la diferencia o se perdona. La
          lista sale de los asientos de auditoría, que son best-effort: muestra lo que se pudo asentar.
        </p>
      </section>

      {/* 5. Avisos fallidos */}
      <section aria-labelledby="avisos" className="space-y-3">
        <h2 id="avisos" className="text-sm font-semibold tracking-widest text-muted-foreground uppercase">
          Avisos por email que no salieron
        </h2>
        {health.failed.length === 0 ? (
          <EmptyState description="Todos los avisos salieron. Un envío bloqueado por la lista de prueba del entorno no cuenta como fallido." />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cuándo</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Destinatario</TableHead>
                  <TableHead>Detalle</TableHead>
                  <TableHead>Error</TableHead>
                  <TableHead><span className="sr-only">Acción</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {health.failed.map((n) => (
                  <TableRow key={n.id}>
                    <TableCell>{formatDateTimeAR(n.sentAt)}</TableCell>
                    <TableCell>{NOTIFICATION_TYPE_LABELS[n.type]}</TableCell>
                    <TableCell>
                      {n.memberId ? (
                        <Link className="text-primary hover:underline" href={`/admin/socios/${n.memberId}`}>
                          {n.memberName ?? `Socio ${n.memberId}`}
                        </Link>
                      ) : n.applicationId ? (
                        <Link className="text-primary hover:underline" href={`/admin/solicitudes/${n.applicationId}`}>
                          {`Solicitud ${n.applicationId}`}
                        </Link>
                      ) : (
                        // La dirección NO se muestra ni se guarda: la fila dice
                        // de qué entidad viene, no a qué casilla iba (docs/08).
                        <span className="text-muted-foreground">Aviso interno</span>
                      )}
                    </TableCell>
                    <TableCell>{n.payloadSummary ?? "—"}</TableCell>
                    <TableCell><code className="text-xs">{n.error ?? "—"}</code></TableCell>
                    <TableCell>
                      {n.receiptNumber ? (
                        <ResendForm notificationId={n.id} label={`el recibo ${n.receiptNumber}`} />
                      ) : (
                        <span className="text-xs text-muted-foreground">Rehacer desde su pantalla</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="text-xs text-muted-foreground">
              Sólo los recibos se pueden reenviar desde acá: son los únicos que el sistema puede rehacer
              solo. El resto se vuelve a mandar desde la pantalla que lo origina.
            </p>
          </>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 8: Verificar en el navegador**

Run: `npm run dev`
1. Como **admin común**: `/admin/salud` muestra la pantalla de bloqueo y la lateral **no** lista Salud.
2. Como superadmin: los cinco bloques renderizan; sin `BACKUP_DIR` el panel dice "Sin configurar" y **no** revienta; `reconcile` muestra su última corrida y las tres tareas nuevas dicen "Nunca corrió" hasta que corran.
3. Con una fila `failed` sembrada a mano (`INSERT` con `type='receipt'`, `payload_summary='recibo <uno real>'`), el botón "Reenviar" la saca de la lista.

- [ ] **Step 9: Suite y commit**

Run: `npm test 2>&1 | tail -5 && npx tsc --noEmit && npm run lint`

```bash
git add -A && git commit -m "feat(m4c): /admin/salud — what is broken and since when, on one screen

Five panels off tables that already existed. A cron that legitimately does
nothing is not an alarm; a run that opened and never closed is not the same as
one that finished badly; and a missing backup stamp is not the same as an old
one. Failed notices can be resent only where the system can rebuild the message
— receipts — and the screen says so instead of pretending otherwise.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 14: Padrón electoral (REG-31, con la enmienda del operador)

Spec §9. Pantalla **superadmin** en Sistema, junto al flag `elecciones_en_curso` — que por fin gana quien lo escriba (hoy sólo se cambia por SQL, `docs/05:417`).

La **enmienda del 23/08/2026**: el moroso puede purgar su deuda **hasta 1 hora antes** de la elección, así que el padrón **no lo excluye**. Salen dos bloques: **Habilitados** y **Con deuda a purgar** (con cuántas cuotas y cuánto, que es lo que tiene que pagar en la mesa para votar). El padrón es regenerable en cualquier momento, incluida la mañana de la elección.

Dato verificado de REG-31: **los adherentes VOTAN** (con ≥90 días de antigüedad); "sin mora" es requisito **sólo** de activos y colaboradores.

> Cargar el skill `frontend-design` antes de escribir JSX.

**Files:**
- Create: `src/lib/members/electoral.ts`, `tests/members-electoral.test.ts`
- Create: `src/app/admin/padron-electoral/{page.tsx,actions.ts,elections-flag-form.tsx}`
- Create: `src/app/api/admin/padron-electoral/route.ts`, `tests/padron-electoral-route.test.ts`, `tests/electoral-actions-auth.test.ts`
- Modify: `src/lib/admin/nav.ts`, `src/components/admin/admin-nav-list.tsx`, `src/lib/admin/dashboard-cards.ts`, `src/lib/config.ts`, `src/lib/members/service.ts`
- Modify: `tests/admin-nav.test.ts`

**Interfaces:**
- Consumes: `periodOf(date)` / `type Period` (`periods.ts:41`), `debtAmount(pending, category, v)` (`rules.ts:111`), `ACCRUING_CATEGORIES` (`rules.ts:34`), `feeValueReader.current()`, `parseCivilDate(iso, opts)` (`@/lib/dates`), `PrintButton` (Task 8), `requireSuperadmin`, `CATEGORY_LABELS`, `audit`.
- Produces:

```ts
// src/lib/config.ts
export const CONFIG_KEYS = { /* … */ electionsOngoing: "elecciones_en_curso" } as const;

// src/lib/members/electoral.ts
export const ELECTORAL_MIN_DAYS = 90;
/** REG-31: quiénes integran el padrón. El cadete NO (no tiene voto). */
export const ELECTORAL_CATEGORIES: readonly MemberCategory[];
export function seniorityDays(joinedAt: Date, at: Date): number;
export function isEligibleBySeniority(joinedAt: Date, at: Date): boolean;
export type ElectoralRow = {
  memberId: number; memberNumber: number | null; fullName: string;
  category: MemberCategory; joinedAt: Date; seniorityDays: number;
  arrears: number; debt: number | null;
};
export type ElectoralRoll = {
  at: Date; period: Period; enabled: ElectoralRow[]; toPurge: ElectoralRow[];
  purgeFees: number; purgeAmount: number;
};
export async function buildElectoralRoll(
  db: Pick<PrismaClient, "membership" | "fee">,
  at: Date,
  feeValue: FeeValueAmounts | null,
): Promise<ElectoralRoll>;
export function electoralCsv(roll: ElectoralRoll): string;

// src/app/admin/padron-electoral/actions.ts
export async function setElectionsFlagAction(_prev: State, formData: FormData): Promise<State>;
```

- [ ] **Step 1: Test que falla**

Crear `tests/members-electoral.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import {
  buildElectoralRoll, electoralCsv, ELECTORAL_MIN_DAYS, isEligibleBySeniority, seniorityDays,
} from "@/lib/members/electoral";

const AT = new Date("2026-11-15T12:00:00Z");
const daysBefore = (n: number) => new Date(AT.getTime() - n * 86_400_000);

const m = (over: Partial<{ id: number; fullName: string; category: string; status: string; joinedAt: Date }> = {}) => ({
  memberNumber: 10,
  member: { id: 1, fullName: "Ana Gómez", category: "active", status: "active", joinedAt: daysBefore(400), ...over },
});

function fakeDb(rows: ReturnType<typeof m>[], pending: Array<{ memberId: number; _count: { _all: number } }> = []) {
  return {
    membership: { findMany: vi.fn(async () => rows) },
    fee: { groupBy: vi.fn(async () => pending) },
  };
}

const VALUE = { activeAmount: 6000, sharedAmount: 3000 };

describe("antigüedad (REG-30/31)", () => {
  it("90 días exactos alcanzan", () => {
    expect(ELECTORAL_MIN_DAYS).toBe(90);
    expect(seniorityDays(daysBefore(90), AT)).toBe(90);
    expect(isEligibleBySeniority(daysBefore(90), AT)).toBe(true);
    expect(isEligibleBySeniority(daysBefore(89), AT)).toBe(false);
  });
});

describe("buildElectoralRoll", () => {
  it("el adherente con antigüedad VOTA y no se le exige estar sin mora", async () => {
    const db = fakeDb([m({ id: 2, category: "adherent" })], [{ memberId: 2, _count: { _all: 5 } }]);
    const roll = await buildElectoralRoll(db as never, AT, VALUE);
    expect(roll.enabled.map((r) => r.memberId)).toEqual([2]);
    expect(roll.toPurge).toEqual([]);
  });

  it("el activo con mora sale en el bloque de purga, con cuotas y monto", async () => {
    const db = fakeDb([m({ id: 1 })], [{ memberId: 1, _count: { _all: 3 } }]);
    const roll = await buildElectoralRoll(db as never, AT, VALUE);
    expect(roll.enabled).toEqual([]);
    expect(roll.toPurge[0]).toMatchObject({ memberId: 1, arrears: 3, debt: 18000 });
    expect(roll.purgeFees).toBe(3);
    expect(roll.purgeAmount).toBe(18000);
  });

  it("la mora se mide sobre períodos ANTERIORES al mes de la elección", async () => {
    const db = fakeDb([m({ id: 1 })]);
    await buildElectoralRoll(db as never, AT, VALUE);
    expect(db.fee.groupBy).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "pending", period: { lt: "2026-11" } }),
    }));
  });

  it("el que no llega a los 90 días no está en ningún bloque", async () => {
    const db = fakeDb([m({ id: 3, joinedAt: daysBefore(45) })]);
    const roll = await buildElectoralRoll(db as never, AT, VALUE);
    expect(roll.enabled).toEqual([]);
    expect(roll.toPurge).toEqual([]);
  });

  it("REG-11: al reingresado le vale su joinedAt original, que el reingreso no toca", async () => {
    // La antigüedad sale de `joinedAt` y nada más: si el reingreso la reiniciara,
    // un socio de 20 años quedaría fuera del padrón por volver en septiembre.
    const db = fakeDb([m({ id: 4, joinedAt: new Date("2006-03-01T12:00:00Z") })]);
    const roll = await buildElectoralRoll(db as never, AT, VALUE);
    expect(roll.enabled[0].seniorityDays).toBeGreaterThan(7000);
  });

  it("sin valor de cuota vigente el padrón sale igual, con el monto en null", async () => {
    const db = fakeDb([m({ id: 1 })], [{ memberId: 1, _count: { _all: 2 } }]);
    const roll = await buildElectoralRoll(db as never, AT, null);
    expect(roll.toPurge[0]).toMatchObject({ arrears: 2, debt: null });
    expect(roll.purgeAmount).toBe(0);
  });

  it("el CSV lleva las columnas de REG-31 y el bloque de cada uno", async () => {
    const db = fakeDb([m({ id: 1 }), m({ id: 2, category: "adherent" })], [{ memberId: 1, _count: { _all: 2 } }]);
    const csv = electoralCsv(await buildElectoralRoll(db as never, AT, VALUE));
    expect(csv.split("\n")[0]).toBe("bloque,numero_socio,apellido_nombre,categoria,cuotas_adeudadas,monto_a_purgar");
    expect(csv).toContain("habilitado,");
    expect(csv).toContain("a_purgar,");
  });
});
```

- [ ] **Step 2: Correr y ver el fallo, e implementar**

Run: `npx vitest run tests/members-electoral.test.ts` → falla.

Crear `src/lib/members/electoral.ts`:

```ts
// Padrón electoral (REG-31, docs/02:155-158) con la enmienda del operador del
// 23/08/2026.
//
// La enmienda: el Código Civil y Comercial deja al moroso purgar su deuda hasta
// una hora antes del acto, así que el padrón NO lo excluye — lo LISTA aparte,
// con cuántas cuotas y cuánto tiene que pagar en la mesa para votar. Por eso son
// dos bloques y no una lista filtrada.
//
// Tres cosas del estatuto que no son obvias:
//   - Los ADHERENTES votan (con ≥90 días). "Sin mora" es requisito sólo de
//     activos y colaboradores.
//   - La antigüedad sale de `joinedAt` y el reingreso NO la reinicia (REG-11),
//     así que no hay nada especial que hacer: `joinedAt` ya es el original.
//   - "No registrar deuda a la fecha de la elección" es MORA, no "al cobro": se
//     mide sobre períodos ANTERIORES al mes de la elección (§3 de la spec). Con
//     la otra definición, el padrón se vaciaría de activos todos los meses.
//
// Prisma inyectado; la fecha es un PARÁMETRO (docs/02:157), nunca el reloj.
import type { MemberCategory, PrismaClient } from "@/generated/prisma/client";
import { periodOf, type Period } from "@/lib/treasury/periods";
import { ACCRUING_CATEGORIES, debtAmount, type FeeValueAmounts } from "@/lib/treasury/rules";

export const ELECTORAL_MIN_DAYS = 90;

/** REG-31: activos, honorarios, colaboradores, vitalicios y adherentes. El
 *  CADETE no integra el padrón: no tiene voto (docs/02, tabla del Art. 5). */
export const ELECTORAL_CATEGORIES: readonly MemberCategory[] = [
  "active", "honorary", "collaborator", "lifetime", "adherent",
];

export function seniorityDays(joinedAt: Date, at: Date): number {
  return Math.floor((at.getTime() - joinedAt.getTime()) / 86_400_000);
}

export function isEligibleBySeniority(joinedAt: Date, at: Date): boolean {
  return seniorityDays(joinedAt, at) >= ELECTORAL_MIN_DAYS;
}

export type ElectoralRow = {
  memberId: number; memberNumber: number | null; fullName: string;
  category: MemberCategory; joinedAt: Date; seniorityDays: number;
  arrears: number; debt: number | null;
};

export type ElectoralRoll = {
  at: Date; period: Period;
  enabled: ElectoralRow[];
  toPurge: ElectoralRow[];
  purgeFees: number;
  purgeAmount: number;
};

export async function buildElectoralRoll(
  db: Pick<PrismaClient, "membership" | "fee">,
  at: Date,
  feeValue: FeeValueAmounts | null,
): Promise<ElectoralRoll> {
  // Del libro ABIERTO: el número de un libro cerrado es historia y no es el que
  // figura en el padrón de hoy (mismo criterio que `fetchDebtors`).
  //
  // Sólo socios `active`: el `withdrawn` no es socio y el `suspended` está bajo
  // sanción disciplinaria. El estatuto no resuelve expresamente el voto del
  // suspendido y hoy no hay ninguno; queda anotado como pregunta para la
  // Comisión antes de la primera elección real.
  const rows = await db.membership.findMany({
    where: {
      book: { status: "open" },
      member: { status: "active", category: { in: [...ELECTORAL_CATEGORIES] } },
    },
    select: {
      memberNumber: true,
      member: { select: { id: true, fullName: true, category: true, joinedAt: true } },
    },
    orderBy: { memberNumber: "asc" },
  });
  const eligible = rows.filter((r) => isEligibleBySeniority(r.member.joinedAt, at));
  const period = periodOf(at);
  const ids = eligible.map((r) => r.member.id);

  // La mora A LA FECHA: pendientes de períodos anteriores al mes de la elección.
  // `Fee.period` es Char(7) "YYYY-MM", que ordena lexicográficamente igual que
  // en el tiempo, así que el `lt` es una comparación de texto barata.
  const groups = ids.length === 0 ? [] : await db.fee.groupBy({
    by: ["memberId"],
    where: { memberId: { in: ids }, status: "pending", period: { lt: period } },
    _count: { _all: true },
  });
  const arrearsBy = new Map(groups.map((g) => [g.memberId, g._count._all]));

  const enabled: ElectoralRow[] = [];
  const toPurge: ElectoralRow[] = [];
  for (const r of eligible) {
    const arrears = arrearsBy.get(r.member.id) ?? 0;
    const row: ElectoralRow = {
      memberId: r.member.id,
      memberNumber: r.memberNumber,
      fullName: r.member.fullName,
      category: r.member.category,
      joinedAt: r.member.joinedAt,
      seniorityDays: seniorityDays(r.member.joinedAt, at),
      arrears,
      debt: feeValue ? debtAmount(arrears, r.member.category, feeValue) : null,
    };
    // La exigencia de estar sin mora es SÓLO para activos y colaboradores: el
    // aporte del adherente es voluntario y su deuda no le quita el voto.
    const owes = arrears > 0 && ACCRUING_CATEGORIES.includes(r.member.category);
    (owes ? toPurge : enabled).push(row);
  }

  return {
    at, period, enabled, toPurge,
    purgeFees: toPurge.reduce((a, r) => a + r.arrears, 0),
    purgeAmount: toPurge.reduce((a, r) => a + (r.debt ?? 0), 0),
  };
}

const CSV_HEADER = "bloque,numero_socio,apellido_nombre,categoria,cuotas_adeudadas,monto_a_purgar";

/** Comillas dobles siempre: los apellidos con coma ("Pizarro, Francisco" es el
 *  formato del catálogo de calles y aparece igual en nombres cargados a mano)
 *  parten la fila en dos. La comilla interna se duplica, como manda el RFC. */
function cell(value: string | number | null): string {
  const s = value === null ? "" : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

export function electoralCsv(roll: ElectoralRoll): string {
  const line = (block: string, r: ElectoralRow) =>
    [cell(block), cell(r.memberNumber), cell(r.fullName), cell(r.category), cell(r.arrears), cell(r.debt)].join(",");
  return [
    CSV_HEADER,
    ...roll.enabled.map((r) => line("habilitado", r)),
    ...roll.toPurge.map((r) => line("a_purgar", r)),
  ].join("\n");
}
```

Run: `npx vitest run tests/members-electoral.test.ts` → PASS.

- [ ] **Step 3: `elecciones_en_curso` entra al catálogo**

En `src/lib/config.ts`, agregar a `CONFIG_KEYS`:

```ts
  /** Bloquea los cambios de categoría mientras hay elecciones (Art. 5° ter).
   *  Lo leía `members/service.ts` con la clave escrita a mano; desde la 4C hay
   *  una pantalla que lo escribe y la clave vive en un solo lugar. */
  electionsOngoing: "elecciones_en_curso",
```

y en `src/lib/members/service.ts`, `electionsOngoing` pasa a usar `CONFIG_KEYS.electionsOngoing` en vez del literal (sin cambiar su comportamiento).

- [ ] **Step 4: Nav, icono y tarjeta**

`src/lib/admin/nav.ts`: agregar `| "vote"` a `AdminNavIcon` y, en Sistema, después de Salud:

```ts
      { href: "/admin/padron-electoral", label: "Padrón electoral", icon: "vote", superadminOnly: true },
```

`src/components/admin/admin-nav-list.tsx`: importar `Vote` de `lucide-react` y agregar `vote: Vote,` a `ICONS`.

`src/lib/admin/dashboard-cards.ts`, grupo Sistema:

```ts
      {
        title: "Padrón electoral",
        description: "Padrón para la Junta Electoral a una fecha dada, con los morosos que pueden purgar su deuda.",
        href: "/admin/padron-electoral",
        cta: "Generar",
        superadminOnly: true,
      },
```

- [ ] **Step 5: La pantalla**

> Cargar el skill `frontend-design` antes de escribir JSX.

Crear `src/app/admin/padron-electoral/actions.ts`:

```ts
"use server";
// El flag `elecciones_en_curso` (Art. 5° ter) por fin tiene quién lo escriba:
// hasta la 4C se cambiaba por SQL a mano (docs/05:417). Mientras está prendido,
// `canChangeCategory` bloquea los cambios de categoría — o sea que este
// checkbox mueve una regla estatutaria y por eso es superadmin y deja asiento.
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireSuperadmin } from "@/lib/auth/require-admin";
import { CONFIG_KEYS } from "@/lib/config";
import { parseForm } from "@/lib/forms";
import { prisma } from "@/lib/prisma";

type State = { error?: string };

const schema = z.object({
  ongoing: z.literal("on", { error: "Valor inválido." }).optional(),
});

export async function setElectionsFlagAction(_prev: State, formData: FormData): Promise<State> {
  const actor = await requireSuperadmin();
  if (!actor.ok) return { error: actor.error };
  const parsed = parseForm(schema, formData);
  if (!parsed.ok) return { error: parsed.error };
  const to = parsed.data.ongoing === "on";
  const key = CONFIG_KEYS.electionsOngoing;
  const previous = await prisma.configuration.findUnique({ where: { key } });
  if (previous?.value === to) return {};
  await prisma.configuration.upsert({
    where: { key },
    update: { value: to, updatedBy: actor.actorId },
    create: { key, value: to, updatedBy: actor.actorId },
  });
  await audit({
    userId: actor.actorId, action: "config_update", entity: "configuration", entityId: key,
    detail: { from: previous?.value ?? null, to }, ip: (await headers()).get("x-real-ip") ?? "unknown",
  });
  revalidatePath("/admin/padron-electoral");
  return {};
}
```

Crear `src/app/admin/padron-electoral/elections-flag-form.tsx` con el mismo patrón que `auto-debit-form.tsx` (checkbox en `useSyncedForm`, botón Guardar, `FormMessage` de error), etiqueta **"Hay elecciones en curso"** y ayuda: *"Mientras esté prendido, el panel bloquea los cambios de categoría (Art. 5° ter). No afecta al padrón que se genera abajo."*

Crear `src/app/admin/padron-electoral/page.tsx`:

```tsx
// Padrón electoral (REG-31 + enmienda del 23/08/2026). Superadmin.
//
// La fecha de la elección es un PARÁMETRO y viaja en la URL (`?fecha=`): el
// padrón se regenera en cualquier momento —incluida la mañana de la elección,
// que es justamente cuando los morosos terminan de purgar— y el link se comparte
// con la Junta Electoral.
//
// El sistema NO gestiona la elección: entrega el padrón y nada más (REG-31).
import { EmptyState } from "@/components/admin/empty-state";
import { FormMessage } from "@/components/admin/form-message";
import { PageHeader } from "@/components/admin/page-header";
import { PrintButton } from "@/components/admin/print-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireSuperadmin } from "@/lib/auth/require-admin";
import { CONFIG_KEYS, configReader } from "@/lib/config";
import { parseCivilDate } from "@/lib/dates";
import { formatARS, formatDateAR } from "@/lib/format";
import { buildElectoralRoll, ELECTORAL_MIN_DAYS, type ElectoralRow } from "@/lib/members/electoral";
import { CATEGORY_LABELS } from "@/lib/members/labels";
import { prisma } from "@/lib/prisma";
import { feeValueReader } from "@/lib/treasury/fee-values";
import { ElectionsFlagForm } from "./elections-flag-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Padrón electoral — SIGeV" };

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function Block({ title, rows, showDebt }: { title: string; rows: ElectoralRow[]; showDebt: boolean }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold tracking-widest text-muted-foreground uppercase">
        {title} <span className="font-mono tabular-nums">({rows.length})</span>
      </h2>
      {rows.length === 0 ? (
        <EmptyState size="card" description="Ningún socio en este bloque." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>N°</TableHead>
              <TableHead>Socio</TableHead>
              <TableHead>Categoría</TableHead>
              <TableHead>Ingreso</TableHead>
              {showDebt && <TableHead className="text-right">Cuotas</TableHead>}
              {showDebt && <TableHead className="text-right">A purgar</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.memberId}>
                <TableCell className="font-mono tabular-nums">{r.memberNumber ?? "—"}</TableCell>
                <TableCell>{r.fullName}</TableCell>
                <TableCell>{CATEGORY_LABELS[r.category]}</TableCell>
                <TableCell>{formatDateAR(r.joinedAt)}</TableCell>
                {showDebt && <TableCell className="text-right font-mono tabular-nums">{r.arrears}</TableCell>}
                {showDebt && (
                  <TableCell className="text-right font-mono tabular-nums">
                    {r.debt === null ? "—" : formatARS(r.debt)}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

export default async function PadronElectoralPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireSuperadmin();
  if (!actor.ok) {
    return (
      <div className="space-y-4">
        <PageHeader title="Padrón electoral" />
        <FormMessage kind="error" box>{actor.error}</FormMessage>
      </div>
    );
  }
  const sp = await props.searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const raw = one(sp.fecha) ?? isoToday();
  // El regex de forma no alcanza: `parseCivilDate` rechaza el día que no existe
  // y el año mal tipeado, y devuelve el mediodía UTC con el que el proyecto
  // guarda toda fecha civil.
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? parseCivilDate(raw, { minYear: 2020, invalidError: "La fecha de la elección no es válida." })
    : { ok: false as const, error: "La fecha de la elección no es válida." };

  const ongoing = await configReader.getBool(CONFIG_KEYS.electionsOngoing);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Padrón electoral"
        actions={
          parsed.ok ? (
            <div className="flex flex-wrap gap-2 print:hidden">
              <Button asChild variant="outline">
                <a href={`/api/admin/padron-electoral?fecha=${raw}`}>Exportar CSV</a>
              </Button>
              <PrintButton />
            </div>
          ) : undefined
        }
      >
        <p className="text-sm text-muted-foreground">
          Socios con derecho a voto a la fecha indicada: activos, honorarios, colaboradores, vitalicios y
          adherentes con {ELECTORAL_MIN_DAYS} días o más de antigüedad (REG-31). El sistema entrega el
          padrón; no gestiona la elección.
        </p>
      </PageHeader>

      <section className="max-w-2xl space-y-2 rounded-lg border p-4 print:hidden">
        <ElectionsFlagForm ongoing={ongoing} />
      </section>

      <form method="get" className="flex flex-wrap items-end gap-2 print:hidden">
        <div className="space-y-1">
          <label htmlFor="fecha" className="text-sm text-muted-foreground">Fecha de la elección</label>
          <input
            id="fecha" type="date" name="fecha" defaultValue={raw}
            className="h-11 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
          />
        </div>
        <Button type="submit" variant="secondary">Generar</Button>
      </form>

      {!parsed.ok ? (
        <FormMessage kind="error" box>{parsed.error}</FormMessage>
      ) : (
        <PadronBody at={parsed.value} raw={raw} />
      )}
    </div>
  );
}

async function PadronBody({ at, raw }: { at: Date; raw: string }) {
  const feeValue = await feeValueReader.current();
  const roll = await buildElectoralRoll(prisma, at, feeValue);
  return (
    <div className="space-y-6">
      <p className="text-sm">
        Padrón al <strong>{formatDateAR(at)}</strong> ·{" "}
        <Badge variant="default">{roll.enabled.length} habilitados</Badge>{" "}
        {roll.toPurge.length > 0 && (
          <Badge variant="secondary">
            {`${roll.toPurge.length} con deuda a purgar · ${roll.purgeFees} cuotas · ${formatARS(roll.purgeAmount)}`}
          </Badge>
        )}
      </p>
      <FormMessage kind="neutral" box role="none">
        El socio con deuda <strong>no está excluido</strong>: puede saldarla hasta una hora antes del acto
        y votar. Por eso figura acá, con lo que tiene que pagar en la mesa. Volvé a generar el padrón
        después del cierre de caja para tener la lista definitiva.
      </FormMessage>
      <Block title="Habilitados" rows={roll.enabled} showDebt={false} />
      <Block title="Con deuda a purgar" rows={roll.toPurge} showDebt />
      <p className="text-xs text-muted-foreground">
        La deuda se valúa al valor de cuota vigente y se cuenta sobre los períodos anteriores a{" "}
        {roll.period}: la cuota del mes en curso todavía no es mora.
      </p>
    </div>
  );
}
```

Nota: el asiento de la generación lo deja la **exportación** (Step 6), no el render — mirar una pantalla no es un hecho auditable, llevarse el padrón sí (mismo criterio que `padron_export`).

- [ ] **Step 6: La exportación CSV**

Crear `src/app/api/admin/padron-electoral/route.ts`:

```ts
// Export del padrón electoral (REG-31). CSV y no Excel: se lo lleva la Junta
// Electoral, que lo abre en cualquier cosa, y el archivo tiene tres columnas de
// texto y dos números.
//
// Deja asiento: llevarse el padrón SÍ es un hecho auditable (mismo criterio que
// `padron_export`), aunque mirarlo en pantalla no lo sea.
import { headers } from "next/headers";
import type { NextRequest } from "next/server";
import { audit } from "@/lib/audit";
import { requireSuperadmin } from "@/lib/auth/require-admin";
import { parseCivilDate } from "@/lib/dates";
import { buildElectoralRoll, electoralCsv } from "@/lib/members/electoral";
import { prisma } from "@/lib/prisma";
import { feeValueReader } from "@/lib/treasury/fee-values";

export async function GET(req: NextRequest) {
  const actor = await requireSuperadmin();
  if (!actor.ok) return new Response(actor.error, { status: 403 });
  const raw = req.nextUrl.searchParams.get("fecha") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return new Response("Fecha inválida.", { status: 400 });
  const parsed = parseCivilDate(raw, { minYear: 2020, invalidError: "Fecha inválida." });
  if (!parsed.ok) return new Response(parsed.error, { status: 400 });

  const roll = await buildElectoralRoll(prisma, parsed.value, await feeValueReader.current());
  const csv = electoralCsv(roll);
  await audit({
    userId: actor.actorId, action: "electoral_roll_export", entity: "member",
    // Metadatos: la fecha y los tamaños. Nunca las filas.
    detail: { at: raw, enabled: roll.enabled.length, toPurge: roll.toPurge.length, purgeFees: roll.purgeFees },
    ip: (await headers()).get("x-real-ip") ?? "unknown",
  });

  return new Response(csv, {
    headers: {
      // BOM: sin él, Excel en Windows abre el CSV en ANSI y rompe los acentos.
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="padron-electoral-${raw}.csv"`,
      // Nombres y números de socio de 160 personas (Ley 25.326): fuera de toda
      // caché, igual que el export del padrón administrativo.
      "Cache-Control": "no-store, private",
      Vary: "Cookie",
    },
  });
}
```

**Ojo con el BOM:** el comentario lo nombra, así que el cuerpo tiene que ser `"﻿" + csv`. Escribirlo así en la `Response`.

Crear `tests/padron-electoral-route.test.ts` (molde: `tests/padron-export-route.test.ts`) con: admin común → 403; fecha ausente o inválida → 400 sin tocar la base; fecha válida → 200, `Content-Type` de CSV, `Cache-Control: no-store, private`, cuerpo que empieza con el BOM y el encabezado, y asiento `electoral_roll_export` **sin** nombres en el `detail`.

Crear `tests/electoral-actions-auth.test.ts`: `setElectionsFlagAction` con admin común → error y sin escritura; con superadmin → upsert + asiento; sin cambio → no escribe ni audita.

- [ ] **Step 7: Verificar en el navegador**

Run: `npm run dev` → `/admin/padron-electoral` como superadmin: generar a una fecha pasada y a una futura, ver los dos bloques, imprimir (sin lateral ni formularios) y descargar el CSV. Como admin común: pantalla de bloqueo y sin ítem en la lateral.

- [ ] **Step 8: Suite y commit**

Run: `npm test 2>&1 | tail -5 && npx tsc --noEmit && npm run lint`

```bash
git add -A && git commit -m "feat(m4c): the electoral roll, with the debtors listed instead of excluded

The Código Civil lets a member clear the debt up to an hour before the vote, so
excluding them from the roll would have disenfranchised people who are going to
pay at the door. Two blocks: enabled, and to-be-cleared with fees and amount.
Arrears are measured on periods BEFORE the election month — with the other
definition the roll would empty itself of active members every month — and
adherents vote, which is what REG-31 actually says.

The elecciones_en_curso flag finally has a screen that writes it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 15: Las tres deudas menores

Spec §11.1, §11.3 y §11.5. Son chicas y sueltas, pero la primera **cobra plata que después nadie puede imputar**.

> Cargar el skill `frontend-design` antes de escribir JSX.

**Files:**
- Create: `src/lib/treasury/upcoming.ts`, `tests/treasury-upcoming.test.ts`
- Modify: `src/app/admin/socios/[id]/link/actions.ts`, `src/app/admin/socios/[id]/link/page.tsx`, `src/app/mi/cuenta/page.tsx`, `src/lib/forms.ts`
- Modify: `tests/forms.test.ts`, `tests/payment-link-actions-auth.test.ts`

**Interfaces:**
- Consumes: `allocate` / `coverageFloor` (`rules.ts:127,74`), `MAX_LINK_FEES` (`@/lib/mp/references`), `type Period` (`periods.ts`).
- Produces:

```ts
// src/lib/treasury/upcoming.ts
export function upcomingPeriods(existing: Period[], joinedAt: Date, readmittedAt: Date | null): Period[];

// src/lib/forms.ts — aditivo, ningún llamador que lo ignore cambia
export type FormResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; /** Nombre del campo que falló, si el schema lo dice. */ field?: string };
```

- [ ] **Step 1: Test que falla — `upcomingPeriods` con casa propia**

Crear `tests/treasury-upcoming.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { upcomingPeriods } from "@/lib/treasury/upcoming";
import { MAX_LINK_FEES } from "@/lib/mp/references";

const PADRON = new Date("2019-03-10T12:00:00Z"); // piso = IMPORT_COVERAGE_FLOOR = 2026-09

describe("upcomingPeriods", () => {
  it("arranca en el PISO de cobertura, no en el mes calendario", () => {
    expect(upcomingPeriods([], PADRON, null)[0]).toBe("2026-09");
  });
  it("devuelve tantos como cuotas admite un link", () => {
    expect(upcomingPeriods([], PADRON, null)).toHaveLength(MAX_LINK_FEES);
  });
  it("saltea los que ya tienen fila: lo que se anuncia es lo que va a decir el recibo", () => {
    expect(upcomingPeriods(["2026-09", "2026-10"], PADRON, null)[0]).toBe("2026-11");
  });
  it("REG-11: el reingreso mueve el piso sin tocar joinedAt", () => {
    expect(upcomingPeriods([], PADRON, new Date("2026-11-08T12:00:00Z"))[0]).toBe("2026-12");
  });
});
```

- [ ] **Step 2: Correr, ver el fallo, implementar**

Run: `npx vitest run tests/treasury-upcoming.test.ts` → falla.

Crear `src/lib/treasury/upcoming.ts` con el cuerpo y el comentario que hoy están **duplicados palabra por palabra** en `link/page.tsx:36-51` y `mi/cuenta/page.tsx:20-35`:

```ts
// Los períodos que un pago de este socio iría CREANDO. Vivía copiado en dos
// pantallas —el link del admin y /mi/cuenta— con su comentario incluido, justo
// en la zona por la que pasa el devengo de la 4C: tocar una sola de las dos
// copias rompía la promesa en la otra, en silencio.
import { MAX_LINK_FEES } from "@/lib/mp/references";
import { allocate, coverageFloor } from "./rules";
import type { Period } from "./periods";

/** Los períodos que un pago de este socio iría CREANDO, en orden, desde su piso
 *  de cobertura. La pantalla los usa para nombrar a qué mes va el pago; el
 *  servicio llama a `allocate` con el MISMO piso al imputarlo, así que lo que se
 *  anuncia es lo que va a decir el recibo.
 *
 *  El reingreso entra por parámetro: `joinedAt` no se toca al reingresar
 *  (REG-11), así que la fecha sale del `Movement` de tipo `readmission` más
 *  nuevo. Sin ese término, a un ex socio que vuelve en noviembre la pantalla le
 *  ofrecería cubrir septiembre y octubre, meses en los que no fue socio. */
export function upcomingPeriods(existing: Period[], joinedAt: Date, readmittedAt: Date | null): Period[] {
  return allocate({
    pending: [],
    existing,
    n: MAX_LINK_FEES,
    startAt: coverageFloor({ joinedAt, readmittedAt }),
  }).toCreate;
}
```

Borrar las dos copias y agregar en cada pantalla `import { upcomingPeriods } from "@/lib/treasury/upcoming";`.

Run: `npx vitest run tests/treasury-upcoming.test.ts && npx tsc --noEmit` → PASS.

- [ ] **Step 3: Test que falla — el link al cesante**

Agregar a `tests/payment-link-actions-auth.test.ts`:

```ts
  it("un cesante SIN cuotas pendientes no puede recibir un link: la plata entraría y no habría a qué imputarla", async () => {
    mocks.findUnique.mockResolvedValue({ id: 7, category: "active", status: "withdrawn" });
    mocks.feeCount.mockResolvedValue(0);
    const r = await createPaymentLinkAction({}, fd({ memberId: "7", n: "1" }));
    expect(r.error).toContain("dado de baja");
    expect(mocks.create).not.toHaveBeenCalled(); // ni siquiera se le pide el link a MP
  });

  it("un cesante CON deuda puede recibir un link por lo que debe, y no por más", async () => {
    mocks.findUnique.mockResolvedValue({ id: 7, category: "active", status: "withdrawn" });
    mocks.feeCount.mockResolvedValue(2);
    expect((await createPaymentLinkAction({}, fd({ memberId: "7", n: "3" }))).error).toContain("2");
    mocks.create.mockClear();
    expect((await createPaymentLinkAction({}, fd({ memberId: "7", n: "2" }))).error).toBeUndefined();
  });

  it("un socio vigente no paga la consulta de más: sólo se cuentan cuotas si está de baja", async () => {
    mocks.findUnique.mockResolvedValue({ id: 7, category: "active", status: "active" });
    await createPaymentLinkAction({}, fd({ memberId: "7", n: "3" }));
    expect(mocks.feeCount).not.toHaveBeenCalled();
  });
```

(el fake de `prisma` del archivo suma `fee: { count: mocks.feeCount }`.)

- [ ] **Step 4: Implementar la guarda**

En `src/app/admin/socios/[id]/link/actions.ts`, dentro de `createPaymentLinkAction`, cambiar la carga del socio y agregar la guarda:

```ts
  const member = await prisma.member.findUnique({
    where: { id: parsed.data.memberId },
    select: { id: true, category: true, status: true },
  });
  if (!member) return { error: "El socio no existe." };
  // Un cesante no devenga (REG-16): lo único que se le puede cobrar es la deuda
  // congelada al momento de la baja. Sin esta guarda el link se generaba igual,
  // el vecino pagaba, `registerPayment` devolvía `no_pending_withdrawn` y la
  // plata caía en la bandeja de sin conciliar sin recibo, esperando que alguien
  // la resolviera a mano o la devolviera. Se chequea ACÁ y no sólo en la
  // pantalla porque la pantalla se puede saltear escribiendo la URL.
  if (member.status === "withdrawn") {
    const pending = await prisma.fee.count({ where: { memberId: member.id, status: "pending" } });
    if (pending === 0) {
      return { error: "El socio está dado de baja y no tiene cuotas pendientes: no hay nada que cobrarle." };
    }
    if (parsed.data.n > pending) {
      return {
        error: `El socio está dado de baja: sólo se le puede cobrar la deuda que quedó (${pending} ${pending === 1 ? "cuota" : "cuotas"}).`,
      };
    }
  }
```

- [ ] **Step 5: La pantalla deja de prometer lo que no puede**

En `src/app/admin/socios/[id]/link/page.tsx` hay **tres textos** que hoy le hablan de deuda a un cesante que no tiene ninguna.

1. El `FormMessage kind="warning"` de la rama `member.status === "withdrawn"` (líneas 99-115) dice "El pago salda la deuda y emite recibo" **también** cuando no hay deuda. Envolverlo con la condición y agregar el caso:

```tsx
      {member.status === "withdrawn" && (
        account.pendingCount === 0 ? (
          <FormMessage kind="warning" box>
            Está dado de baja y no tiene cuotas pendientes: no hay nada que cobrarle. Un cesante no
            devenga cuotas (REG-16), así que tampoco puede pagar por adelantado.
          </FormMessage>
        ) : (
          <FormMessage kind="warning" box as="div">
            Está dado de baja. El pago salda la deuda y emite recibo, pero <strong>no</strong> lo
            reincorpora — y como su panel de socio está cerrado, al volver de Mercado Pago no va a
            ver la confirmación.{" "}
            {hasEmail
              ? "El recibo le llega igual por email."
              : "Y como no tiene un email válido cargado, el recibo se lo hacés llegar vos desde Tesorería."}
          </FormMessage>
        )
      )}
```

2. Dentro del `CardContent`, la rama que hoy renderiza el párrafo + `<LinkForm …>` (líneas 136-163) gana un caso ANTES del `<>`: el cesante sin deuda no ve formulario. Cambiar el ternario final por:

```tsx
          ) : member.status === "withdrawn" && account.pendingCount === 0 ? (
            // El servicio va a rechazar este cobro (`no_pending_withdrawn`) y la
            // plata quedaría en la bandeja sin recibo: mejor no ofrecerlo.
            <EmptyState
              size="card"
              description="No hay nada que cobrarle: está dado de baja y no le quedó ninguna cuota pendiente."
            />
          ) : (
            <>
```

(el resto del bloque —el párrafo con `Debe N cuotas` / `Está al día` y el `<LinkForm memberId={member.id} feeAmount={account.feeAmount} pendingCount={account.pendingCount} oldestPending={account.oldestPending} upcoming={upcoming} hasEmail={hasEmail} />`— queda **igual**.)

3. El párrafo de la rama sin deuda (línea 151) ya no puede alcanzar a un cesante, pero sí a un socio vigente al día: **no se toca**.

- [ ] **Step 6: Test que falla — `parseForm` dice qué campo**

Agregar a `tests/forms.test.ts`:

```ts
  it("el error dice QUÉ campo falló, sin cambiar el mensaje", () => {
    const schema = z.object({
      nombre: z.string().min(1, "Ingresá el nombre."),
      email: z.email("El email no es válido."),
    });
    const fd = new FormData();
    fd.set("nombre", "Ana");
    fd.set("email", "no-es-un-email");
    const r = parseForm(schema, fd);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("El email no es válido.");
    expect(r.field).toBe("email");
  });
  it("un error sin campo (schema no-objeto o issue de raíz) no inventa uno", () => {
    const fd = new FormData();
    const r = parseForm(z.object({ nombre: z.string().min(1, "Ingresá el nombre.") }), fd);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.field).toBe("nombre");
  });
  it("sigue eligiendo el MISMO issue de siempre: el primero", () => {
    // Cambiar cuál issue se elige cambiaría los textos que ve el usuario en los
    // schemas multicampo, y hay tests que los afirman.
    const schema = z.object({ a: z.string().min(1, "Falta A."), b: z.string().min(1, "Falta B.") });
    const r = parseForm(schema, new FormData());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("Falta A.");
  });
```

- [ ] **Step 7: Implementar**

En `src/lib/forms.ts`:

```ts
export type FormResult<T> =
  | { ok: true; data: T }
  // `field` es ADITIVO: los 34 llamadores que lo ignoran no cambian de
  // comportamiento. Es sólo el DATO —qué campo falló—; llevar el foco al campo
  // exige propagar el estado y pintar `aria-invalid` en cada pantalla, y eso
  // queda fuera de la 4C (spec §2).
  | { ok: false; error: string; field?: string };
```

y el retorno del error:

```ts
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    // El `path` de zod ya venía y se tiraba (`forms.ts:44` antes de la 4C): un
    // error de validación en un formulario largo decía el mensaje y no dónde, y
    // el operador buscó la causa en el lugar equivocado (deuda del M3).
    const field = typeof first?.path?.[0] === "string" ? first.path[0] : undefined;
    return { ok: false, error: first?.message ?? "Datos inválidos", field };
  }
```

- [ ] **Step 8: Correr y ver verde**

Run: `npx vitest run tests/forms.test.ts tests/treasury-upcoming.test.ts tests/payment-link-actions-auth.test.ts`
Expected: PASS.

- [ ] **Step 9: Suite y commit**

Run: `npm test 2>&1 | tail -5 && npx tsc --noEmit && npm run lint`

```bash
git add -A && git commit -m "fix(m4c): a payment link for an expelled member took money nobody could apply

The action never checked status, so the link was generated, the neighbour paid,
and the charge landed in the unmatched inbox with no receipt — money in, nothing
to allocate it to. Blocked in the action, because the screen can be skipped by
typing the URL.

Also: upcomingPeriods stops being two byte-identical copies right where the
accrual passes, and parseForm finally returns which field failed.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 16: Documentación, crontab y cierre de la fase

**Files:**
- Modify: `docs/07-plan-de-etapas.md`, `docs/10-runbook-dominio-productivo.md`, `docs/11-preparacion-mp-sandbox-turnstile.md`, `.env.example`, `CLAUDE.md`, `.superpowers/sdd/progress.md`

**Interfaces:**
- Consumes: todo lo de las tareas 1-15.
- Produces: documentación y el bloque de crontab copiable para Mariano.

- [ ] **Step 1: `docs/07` — la fase 4C queda cerrada**

Reemplazar el encabezado `### Fase 4C — Notificaciones y salud (pendiente) — **prioridad actual**` por `### Fase 4C — Crons, notificaciones, salud y padrón electoral (CERRADA, 23/08/2026)`, y debajo del enunciado agregar el estado real:

```markdown
**Qué quedó andando:** cron de devengo (`accrual`, día 1, con backfill desde
`coverageFloor`), recordatorio de vencimiento (`reminder`, último día del mes),
resumen diario a la Comisión (`digest`, sin novedades no envía),
`Notification.failed` con su error y reenvío por entidad, tope de envíos por
corrida (`MAIL_BATCH_CAP`), aviso al socio del débito rechazado, `/admin/salud`
con los cinco crons y el backup, padrón electoral (REG-31 + enmienda), y las
ocho deudas heredadas que la fase levantó.

**Los CA, uno por uno:**

| CA | Estado |
|---|---|
| Correr el devengo dos veces el mismo día crea una sola cuota por socio | ✅ lectura previa + `skipDuplicates` sobre el unique `(memberId, period)` |
| El aviso en un día que no corresponde no envía nada | ✅ el recordatorio actúa el ÚLTIMO día del mes (febrero incluido), no "el 30" |
| El resumen sin novedades no se envía | ✅ y tampoco escribe `CronRun` |
| Un email con el transporte roto queda `failed` y "Reenviar" lo saca | ✅ (el reenvío existe para los recibos, que es lo que el sistema puede rehacer) |
| `/admin/salud` muestra las cinco corridas y el backup | ✅ `applications` empezó a escribir `CronRun` en esta fase |
| Declarar la baja cancela la suscripción en MP y, si falla, la pantalla lo dice | ✅ individual y en lote, con el tercer balde |
```

Y actualizar el bloque de deudas de 4B: marcar como cerradas las siete que entraron (cancelar preapproval, huérfanas canceladas, link al cesante, `upcomingPeriods`, las dos divergencias de "suscripción viva", toggle de `autoDebit`, `parseForm`) y dejar abiertas las que siguen: `mp_subscriptions.member_id` sin unique, reimputar un cobro con recibo anulado, la navegación por ejercicio en Deudores/Efectivo/Recibos, `AdminActor` sin roles vivos y la migración a `synced-fields` (→ M5).

- [ ] **Step 2: `docs/11` — el crontab final de 6 líneas**

En la parte del crontab, reemplazar el bloque de dos líneas por el de seis, con el patrón **idempotente** que ya usa `docs/10:583-591` (sin el `if … grep -q`, correrlo dos veces duplica la línea):

```bash
# Bloque copiable — se puede correr más de una vez sin duplicar nada.
CRON_URL=https://vecinalciudadela.ar/api/cron
add_cron() {  # $1 = expresión horaria, $2 = job
  local line="$1 curl -sS --max-time 900 -X POST -H \"Authorization: Bearer \$(cat /root/.sigev-cron-secret)\" $CRON_URL/$2 >> /var/log/sigev-cron.log 2>&1"
  crontab -l 2>/dev/null | grep -qF "/api/cron/$2" || (crontab -l 2>/dev/null; echo "$line") | crontab -
}
add_cron "0 3 * * *"  reconcile     # conciliación con Mercado Pago
add_cron "5 8 * * *"  applications  # mantenimiento de solicitudes
add_cron "30 0 * * *" accrual       # devengo — corre a diario, ACTÚA el día 1
add_cron "30 7 * * *" digest        # resumen diario — sin novedades no envía
add_cron "0 10 * * *" reminder      # recordatorio — ACTÚA el último día del mes
crontab -l | grep -E 'backup|api/cron'   # verificación: 5 líneas de app + backup.sh
```

y dejar escrito, debajo:

```markdown
La sexta línea es `0 4 * * * /root/backup.sh`, que ya existe (`scripts/backup.sh:3`)
y **no** es un endpoint: es el script de shell que deja el sello `LAST_OK` que
`/admin/salud` lee. Si nunca se instaló, el panel va a decir "Sin rastro" —que es
distinto de "Atrasado"— y hay que instalarla antes de creerle a esa tarjeta.

Los tres crons nuevos **corren todos los días y deciden adentro** si actúan:
- `accrual` responde `{"skipped":"not_first_day"}` los días 2 a 31,
- `reminder` responde `{"skipped":"not_last_day"}` salvo el último día del mes,
- `digest` responde `{"skipped":"no_news"}` los días sin novedades.

Ninguna de esas respuestas escribe una fila en `cron_runs`, y eso es a propósito:
`/admin/salud` muestra la última corrida **efectiva**, y 29 filas vacías por mes
taparían la única que importa. Un `skipped` en `/var/log/sigev-cron.log` es una
corrida sana.

**El 524 de Cloudflare sigue valiendo** (docs/11 §H): un corte a los ~100 s no
significa que el cron no haya corrido — la verdad está en `cron_runs`, que ahora
se lee desde `/admin/salud` en vez de por SQL. El devengo no corre ese riesgo
(segundos, sin red); los de email sí el día que sean cientos de envíos, y para eso
está `MAIL_BATCH_CAP`.
```

- [ ] **Step 3: `docs/10` — runbook del despliegue de 4C**

Agregar una sección con el bloque copiable del despliegue, en el orden que importa:

```markdown
## Despliegue de la fase 4C (crons, notificaciones, salud, padrón electoral)

**Antes de tocar nada:** el cron de devengo tiene que estar arriba **antes del
01/10/2026**. Si se despliega después, la primera corrida backfillea sola (crea
septiembre Y octubre): no hay nada que reparar a mano.

```bash
cd /var/www/sigev
git pull
# 1. Variables nuevas del .env (ninguna es obligatoria; sin ellas hay defaults)
grep -q '^BACKUP_DIR=' .env      || echo 'BACKUP_DIR=/var/sigev/backups' >> .env
grep -q '^MAIL_BATCH_CAP=' .env  || echo 'MAIL_BATCH_CAP=50' >> .env
# 2. Migración nº 10 (aditiva: una columna nullable y cuatro índices)
npx prisma migrate deploy
npm ci && npm run build
pm2 restart sigev && pm2 save
```

Después del restart, en este orden:

1. `/admin/salud` como superadmin: `reconcile` y `applications` con su última
   corrida; los tres nuevos en "Nunca corrió"; el backup en "Al día" (si dice
   "Sin configurar", faltó `BACKUP_DIR`).
2. `/admin/configuracion`: cargar `digest_recipients` con la dirección de la
   Comisión. Vacío = el resumen no se manda a nadie.
3. Agregar las tres líneas del crontab (bloque de `docs/11`).
4. Prueba en seco de cada endpoint nuevo, sin esperar al horario:

```bash
S=$(cat /root/.sigev-cron-secret)
for j in accrual reminder digest; do
  echo "== $j"; curl -sS -X POST -H "Authorization: Bearer $S" https://vecinalciudadela.ar/api/cron/$j; echo
done
```

Un día cualquiera las tres respuestas son `{"skipped":…}` y **eso es lo correcto**:
prueba que el endpoint existe, que el secreto es el bueno y que la guarda del día
funciona. Sin `Authorization` tiene que dar 401; con el secreto borrado del
servidor, 503.

**Ojo con `EMAIL_ALLOWLIST`:** mientras siga definida en producción, el
recordatorio y el resumen se van a bloquear para toda dirección no listada. Eso
**no** ensucia `/admin/salud` (un bloqueo de allowlist no escribe `failed`), pero
tampoco le llega a nadie. Borrarla sigue siendo un paso del checklist de
lanzamiento de `docs/07`.
```

- [ ] **Step 4: `.env.example` y `CLAUDE.md`**

Verificar que `.env.example` tenga `BACKUP_DIR` (Task 13A) y `MAIL_BATCH_CAP` (Task 6). En `CLAUDE.md`:

1. En "Variables de entorno", agregar las dos líneas nuevas al bloque, con su comentario de una línea.
2. En "Prioridad actual", reemplazar el párrafo por:

```markdown
Módulos 0, 1, 2 y 3 cerrados y desplegados. Del **Módulo 4** están cerradas las
fases **4A** (cuenta corriente, efectivo, recibos, deudores), **4B** (Mercado
Pago) y **4C** (crons de devengo/recordatorio/resumen, `Notification.failed`,
`/admin/salud`, padrón electoral). Sigue el **Módulo 5**. Ver `docs/07`.
```

3. Agregar una sección "Patrones que estrenó la fase 4C" con lo reutilizable:

```markdown
## Patrones que estrenó la fase 4C

- **Un cron que decide no actuar NO es una corrida.** Los tres crons nuevos
  corren a diario y deciden adentro (`willAct()` en el módulo, nunca en la ruta);
  un día que no corresponde responde 200 con `{skipped}` y **no escribe
  `CronRun`**. `/admin/salud` muestra la última corrida EFECTIVA y marca *stale*
  cuando la antigüedad supera el doble del período esperado — que es **mensual**
  para el devengo y el recordatorio, no diario.
- **La guarda de los crons vive en un módulo** (`src/lib/cron/auth.ts`), junto
  con el catálogo `CRON_JOBS`: el `job` es texto libre de 32 chars y un typo deja
  una corrida fantasma en la pantalla de salud.
- **El devengo materializa la cuota del mes M el 01/M+1**, cuando ya es mora. Es
  lo que deja correctos, sin tocarlos, a los 21 puntos del sistema que cuentan
  filas `pending` a secas. Un socio al día paga el mes en curso vía
  `coverageFloor` + `allocate`, que no necesitan fila.
- **El mailer registra el intento fallido** (`Notification.failed` + `error` con
  el CÓDIGO, nunca la dirección) en su único punto de escritura: cubre los doce
  call-sites de golpe. Un bloqueo de `EMAIL_ALLOWLIST` **no** es un fallo.
- **El tope de correos es un presupuesto inyectado por corrida** (`MailBudget`),
  no un contador de módulo: el procesador del webhook es un singleton de proceso
  y un contador global lo dejaría mudo después de 50 correos.
- **Dos semánticas de "suscripción viva"** (`src/lib/mp/subscription-status.ts`):
  `canStillCharge` es lista BLANCA (no prometer un débito que no existe) e
  `isNotCancelled` es lista NEGRA de un valor (no saber es peor que avisar de
  más). No son complementarias, y ahí está el punto.
- **La cancelación del débito al dar de baja vive DESPUÉS del commit**, en un
  módulo de dominio que comparten la baja individual y el lote de cesantía. Una
  llamada de red adentro de la `$transaction` sostiene el lock hasta el timeout
  de 5 s de Prisma — mismo corolario que el PDF del recibo.
```

- [ ] **Step 5: El ledger**

Agregar al final de `.superpowers/sdd/progress.md` el cierre de la fase: las 16 tareas con una línea cada una, las decisiones que se tomaron durante la implementación, los bugs encontrados de paso y lo que quedó diferido. **Anotar explícitamente**:

- los tres desvíos del texto literal de la spec (suspendidos que devengan; dedupe sin `unique`; el índice extra de `webhook_events`);
- la pregunta abierta para la Comisión: **¿vota un socio suspendido?** (el estatuto no lo resuelve; hoy hay 0 suspendidos y el padrón los excluye);
- que el reenvío desde `/admin/salud` **borra** la fila `failed` cuando el envío nuevo sale, y por qué (la fila era el registro de un intento; el envío nuevo deja su propia acreditación).

- [ ] **Step 6: Batería completa**

Run:
```bash
npm test 2>&1 | tail -6
npx tsc --noEmit
npm run lint
npm run build
```
Expected: los cuatro limpios. El `build` es el que atrapa un import de `node:fs` que se coló en un componente cliente (`health-backup.ts`).

Y, con MariaDB arriba, la batería de integración:

```bash
npm run test:integration
```
Expected: `mp-apply-concurrency` y `receipt-sequence` en verde — el primero cubre la carrera que la Task 4 tocó.

- [ ] **Step 7: Prueba manual en local, de punta a punta**

Con la base local sembrada (`npm run dev`), en este orden:

1. `curl -X POST -H "Authorization: Bearer $CRON_SECRET" localhost:3006/api/cron/accrual` un día que no es 1 → `{"skipped":"not_first_day"}`.
2. Forzar el devengo con una corrida acotada desde un script de un solo uso (`accrualCron.run({ upTo: "2026-09" })`) y verificar en `/admin/tesoreria/deudores` que los 35 devengantes pasan a deber 1 cuota y que los adherentes **no**.
3. Correrlo de nuevo: `feesCreated: 0`.
4. `/api/cron/reminder` con el reloj del sistema en el último día del mes → llegan los correos al transporte de consola; correrlo dos veces → la segunda dice `alreadyNotified`.
5. `/api/cron/digest` → con novedades manda; sin novedades, `{"skipped":"no_news"}`.
6. `/admin/salud`: las cinco filas, el backup, la bandeja y los avisos fallidos.
7. `/admin/padron-electoral`: generar, imprimir y exportar.

- [ ] **Step 8: Commit final y cierre**

```bash
git add -A && git commit -m "docs(m4c): phase 4C closed — crontab, runbook, env and ledger

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

Después: `superpowers:requesting-code-review` sobre la rama completa y, con la revisión saldada, `superpowers:finishing-a-development-branch` para decidir el merge. **El despliegue lo corre Mariano** (bloque de `docs/10`, Step 3): Claude Code no entra por SSH.

---

## Mapa de los criterios de aceptación (spec §14) → tarea

| # | Criterio de aceptación | Tarea |
|---|---|---|
| 1 | Correr el devengo dos veces el mismo día crea una sola cuota por socio | **T4** (lectura previa + `skipDuplicates`), regla en **T3** |
| 2 | La primera corrida backfillea desde `coverageFloor`: el 01/11 crea 2026-09 y 2026-10 | **T3** (tabla de casos) + **T4** (`upTo` inyectable) |
| 3 | El 15 del mes, ni el que pagó ni el que no pagó el mes en curso aparecen en Deudores | **T4** (`upTo` = mes vencido; ninguna pantalla se toca — §3) |
| 4 | El recordatorio: nada salvo el último día; una sola vez por socio y período; febrero avisa el 28/29 | **T7** |
| 5 | El resumen sin novedades no se envía y no ensucia `/admin/salud` | **T9** (`hasNews` + la ruta que no abre `CronRun`) |
| 6 | Un débito rechazado le llega al socio en castellano; el resultado del webhook no cambia | **T10** |
| 7 | Un email con el transporte roto queda `failed` y "Reenviar" lo saca; la allowlist NO queda `failed` | **T5** (escritura) + **T13B** (reenvío) |
| 8 | `/admin/salud` muestra los cinco crons + backup, MP, la bandeja, las divergencias y los `link_amount_mismatch`; una corrida colgada se distingue | **T1** (`applications` escribe `CronRun`) + **T2** (índices) + **T13A** + **T13B** |
| 9 | El padrón a una fecha dada lista habilitados y morosos-con-cuotas, imprimible, exportable y con asiento | **T14** |
| 10 | La baja cancela la suscripción en MP; si MP falla, la pantalla lo dice. El lote, ídem con el tercer balde | **T12** |
| 11 | Deudores no ofrece casilla de cesantía a adherentes | **T12** |
| 12 | Generar un link de pago para un cesante está bloqueado con mensaje claro | **T15** |
| 13 | Un valor nuevo en `Configuration.digest_recipients` cambia los destinatarios sin reiniciar nada | **T9** |

## Mapa de la spec, sección por sección → tarea

| § | Sección | Tarea(s) |
|---|---|---|
| §1 | Objetivo | toda la fase; la fecha dura la sostiene **T4** |
| §2 | No entra en 4C | **Global Constraints** y las notas de **T13B** (sin cola genérica) y **T15** (sin foco automático) |
| §3 | El modelo de devengo (normativo) | **T3** + **T4**; el corolario "no corregir los 21 puntos" queda escrito en la cabecera de `accrual.ts` |
| §4 | Cron de devengo | **T3** (regla pura) + **T4** (cron, ruta, P2002, comentarios corregidos) |
| §5 | Recordatorio de vencimiento | **T7** (cron, plantilla, dedupe) + **T8** (lista imprimible de los sin email) + **T2** (columna `period`) |
| §6 | Resumen diario a la Comisión | **T9** |
| §7.1-7.2 | `Notification.failed` y la allowlist | **T5** |
| §7.3 | Tope de envíos por corrida | **T6** |
| §7.4 | `payment_rejected` avisa al socio | **T10** |
| §7.5 | Reintento por entidad | **T13A** (`receiptNumberOf`) + **T13B** (action + pantalla) |
| §8 | `/admin/salud` (5 paneles, D1/D2/D3) | **T1** (§8.1) + **T2** (índices) + **T13A** (datos, backup) + **T13B** (pantalla, nav, tarjeta) |
| §9 | Padrón electoral (REG-31 + enmienda) | **T14** |
| §10 | Bajas y Mercado Pago; unificar "suscripción viva" | **T11** (predicados y divergencias) + **T12** (cancelación, tercer balde, REG-15) |
| §11 | Deudas heredadas (las 7) | 11.1 y 11.3 y 11.5 → **T15**; 11.2 → **T11**; 11.4 → **T12**; 11.6 → **T12**; 11.7 → **T1** |
| §12 | Crontab final (6 líneas) | **T16** (documentación) + **T1/T4/T7/T9** (los endpoints) |
| §13 | Registro de decisiones | sin tarea: es el acta de la spec. Las ocho decisiones están aplicadas en T4, T7, T8, T9, T12 y T14 |
| §14 | Criterios de aceptación | la tabla de arriba; **T16** los transcribe a `docs/07` |

## Notas de la auto-revisión (23/08/2026)

Se recorrió la spec sección por sección y el código de cada firma citada. Lo que apareció:

1. **§4 dice `status: "active"` y el plan consulta `active` + `suspended`.** Está justificado arriba ("Tres desvíos deliberados") y anotado en el ledger. Hoy no cambia ninguna fila: hay 0 suspendidos.
2. **La dedupe del recordatorio no lleva `unique`**, porque con `failed` escribiéndose un intento fallido bloquearía el reintento del período. Queda lectura previa que excluye `failed`, sobre la premisa de un solo proceso de `docs/03`.
3. **Se agregó un índice que la spec no nombra** (`webhook_events(origin, receivedAt)`): las dos consultas del panel de MP eran full scan.
4. **El presupuesto de correos se pasa por LLAMADA y no como dep del procesador.** El procesador es un singleton de proceso; un contador en sus deps habría dejado al webhook sin poder mandar recibos después de 50 correos desde el último restart de PM2. Eso obligó a agregarle un tercer parámetro opcional a `applyPayment` y a tocar el tipo `Deps.processor` del reconcile.
5. **La cancelación del débito NO pudo ir "dentro de `memberService.withdraw`"** como sugiere la letra de §10: es una `$transaction` y una llamada de red adentro sostiene el lock hasta el timeout de 5 s de Prisma. Vive en `src/lib/members/withdraw-with-debits.ts`, que es un módulo de dominio vecino y lo comparten los dos llamadores — que es lo que la spec quería asegurar ("el lote usa el mismo servicio").
6. **`runAction` no le pasa a `detail` el resultado de `run`**, así que la baja individual no podía asentar los `preapprovalId` cancelados. Se agregan dos hooks chicos (`redirectQuery`, `detailFromResult`) en vez de duplicar la action.
7. **El reenvío por entidad necesita el id del recibo y la fila no lo guarda**: sale de `payloadSummary`, cuyo formato lo fija `receipt-email.ts:91` (`recibo ${número}`). Es exactamente la limitación que §7.5 manda anotar, y por eso el resto de los avisos se muestran sin botón.
8. **`upcomingPeriods` se movió a `src/lib/treasury/upcoming.ts` y no a `rules.ts`**: `rules.ts` es puro y no importa nada de `@/lib/mp`, y `upcomingPeriods` necesita `MAX_LINK_FEES` de `mp/references`. Meterlo en `rules.ts` habría atado las reglas de tesorería al módulo de Mercado Pago.
9. **`electionsOngoing` leía la clave con un literal a mano** (`service.ts:21`): entra al catálogo `CONFIG_KEYS` en T14, sin cambiar comportamiento.
10. **Pregunta abierta para la Comisión** (queda en el ledger, no la resuelve el sistema): **¿vota un socio suspendido?** El estatuto no lo dice; el padrón los excluye y hoy no hay ninguno.
