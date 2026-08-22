# Módulo 4 — Fase 4B: Mercado Pago — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que los cobros de Mercado Pago (débitos de suscripción, links de Checkout Pro, cuota de ingreso) se registren solos como pago + cuotas + recibo, que las dos suscripciones preexistentes se puedan vincular a sus socios, que un cron diario recupere lo que el webhook pierda, que el valor de cuota se pueda empujar a MP en lote, y que el socio pueda pagar su deuda desde su panel — todo desplegado antes del **10/09/2026**.

**Architecture:** La transacción de cobro de 4A se extrae a un núcleo genérico `registerPayment` (mismo archivo `service.ts`) y Efectivo pasa a llamarlo. Un módulo puro `resolve.ts` decide a quién pertenece un pago de MP (suscripción antes que referencia). El procesador del webhook recibe el servicio de tesorería y la bandeja inyectados y **nunca lanza por regla de negocio**: toda situación termina en un `result` (aplicado / bandeja / ignorado). El cron `reconcile` reutiliza el mismo `applyPayment` del procesador. Las pantallas nuevas son pestañas por URL de Tesorería (`sin-conciliar`, `suscripciones`) más bloques en Valores, ficha del socio y `/mi/cuenta`.

**Tech Stack:** Next.js 16.3.1 (App Router, server actions), Prisma 7 (`@prisma/adapter-mariadb`), MariaDB 10.11 (Docker en dev), zod 4, Tailwind v4 + shadcn (radix-ui), SDK `mercadopago` v2 (`Preference`, `Payment`, `PreApproval`) + `fetch` para `/authorized_payments` y `/preapproval/search`, nodemailer, vitest 4.

Spec: `docs/superpowers/specs/2026-08-22-modulo-4b-mercadopago-design.md` (toda). Spec M4 (4A): `docs/superpowers/specs/2026-08-21-modulo-4-tesoreria-design.md`.

## Global Constraints

- **UI en español es-AR** ("vos", `formatDateAR`, `formatARS`). Código, variables, tablas, commits en inglés.
- **Toda tarea que cree o toque una pantalla carga el skill `frontend-design` (Skill tool, nombre `frontend-design`) ANTES de escribir JSX.** Las pantallas no pueden ser genéricas: heredan el shell (`PageHeader` lo pone el layout de Tesorería; `FormMessage`, `EmptyState`, `synced-fields`, badges desde `status-badges.ts`) y se diseñan con el mismo criterio que Efectivo/Deudores (ver `src/app/admin/tesoreria/**`).
- **Mensajes de zod en castellano** en todo schema de server action.
- **Autorización en cada página y cada server action** (`requireAdmin` / `requireSuperadmin` / `requireMember`), nunca solo en el layout. `redirect()` fuera de `try`.
- **Auditoría** con `audit()`: `detail` solo con ids, códigos, contadores, montos. **Nunca DNI, email, nombre ni el link de pago** (Ley 25.326). `payerEmail` de MP solo se muestra en la bandeja (admin).
- **El procesador del webhook y el cron no lanzan por regla de negocio.** Lanzar = fallo técnico (MP/base caída) = 500 = reintento de MP.
- **Las cuatro invariantes de plata** viven en `registerPayment` y en ningún otro lado: número de recibo pedido TARDE y dentro de la transacción, chequeo de `count` antes de pedir el número, PDF y email DESPUÉS del commit (best-effort), `Receipt.concept` congelado al emitir.
- **Dinero**: MP devuelve `number` en pesos; a la base va `amount.toFixed(2)`. Fechas de MP (`date_approved`, ISO con offset) se parsean en el gateway a `Date`; el año de serie y el período salen de `periods.ts`.
- **En módulos puros Prisma se INYECTA**; los singletons (`prisma`, `mailer`, `audit`, `mpGateway`, `treasuryService`) solo en rutas, actions, crons y scripts. Todo test que importe un módulo con singleton mockea `@/lib/prisma` **antes** de importar.
- **Migración con `prisma migrate dev`** (nunca `db push`). Una sola: `add_module_4b_mercadopago`.
- **Nunca renderizar un `thead` sin filas**; targets ≥ 44px; `aria-current="page"`; foco visible; cifras en `font-mono tabular-nums`; tokens `--success`/`--warning`, nunca verde/ámbar crudo.
- **Textos que mienten y se corrigen en la tarea que los vuelve falsos**: `valores/page.tsx` ("llega con la siguiente fase"), `mi/cuenta/page.tsx` ("acercate a la sede o esperá el débito"), `mi/page.tsx` ("Todavía estamos terminando"), `AUTO_DEBIT_WARNINGS` ("NO lo cancela / NO ajusta").
- Suite base al empezar: **114 archivos / 1446 tests** (`npm test`), `npx tsc --noEmit` limpio, `npm run lint` limpio. Cada tarea deja los tres en verde.
- Commits pequeños, mensajes en inglés, pie `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Branch de trabajo: `feat/m4b-mercadopago` desde `main`.
- Ledger: `.superpowers/sdd/progress.md` — cada tarea agrega su entrada (decisiones, bugs, diferidos), como en 4A.

## Mapa de archivos

**Crear**
- `prisma/migrations/<ts>_add_module_4b_mercadopago/migration.sql` (generada)
- `src/lib/mp/references.ts` — `external_reference`: parsear/armar `solicitud:{id}` y `pago:{memberId}:{n}` (puro)
- `src/lib/mp/resolve.ts` — decisión pura: a quién pertenece un pago de MP (§5 de la spec)
- `src/lib/mp/unmatched.ts` — escritura de la bandeja (Prisma inyectado) + `UnmatchedReason`
- `src/lib/mp/reconcile.ts` — el cron de conciliación (factory)
- `src/app/api/cron/reconcile/route.ts` — endpoint del cron, escribe `CronRun`
- `src/lib/mp/link-suggest.ts` — sugerencia de socio para una suscripción (puro)
- `src/lib/mp/link-subscription.ts` — vincular suscripción preexistente (Prisma inyectado)
- `src/lib/mp/fee-value-batch.ts` — lote REG-34 (factory, tandas de 25)
- `src/lib/mp/payment-link.ts` — Checkout Pro: título, monto, preferencia (factory)
- `src/lib/admin/unmatched-labels.ts` — etiquetas es-AR de motivos y estados de la bandeja
- `src/app/admin/tesoreria/sin-conciliar/{page.tsx,actions.ts,resolve-form.tsx,[id]/page.tsx}`
- `src/app/admin/tesoreria/suscripciones/{page.tsx,[preapprovalId]/vincular/{page.tsx,actions.ts,confirm-form.tsx}}`
- `src/app/admin/tesoreria/valores/{actions.ts,apply-batch.tsx}`
- `src/app/admin/socios/[id]/link/{page.tsx,actions.ts,link-form.tsx}`
- `src/app/mi/cuenta/{actions.ts,pay-form.tsx,return-notice.tsx}`
- `tests/mp-references.test.ts`, `tests/mp-resolve.test.ts`, `tests/mp-unmatched.test.ts`, `tests/mp-reconcile.test.ts`, `tests/mp-reconcile-route.test.ts`, `tests/mp-link-suggest.test.ts`, `tests/mp-link-subscription.test.ts`, `tests/mp-fee-value-batch.test.ts`, `tests/mp-payment-link.test.ts`, `tests/unmatched-actions-auth.test.ts`, `tests/subscriptions-actions-auth.test.ts`, `tests/fee-value-batch-action-auth.test.ts`, `tests/payment-link-actions-auth.test.ts`, `tests/member-pay-action.test.ts`, `tests/integration/mp-apply-concurrency.test.ts`

**Modificar**
- `prisma/schema.prisma` — `MpSubscription.planId/payerEmail` nullable; `MpUnmatchedPayment.preapprovalId/reason`
- `prisma/seed.ts` — suscripción y fila de bandeja de prueba (solo con `SEED_TEST_USERS`)
- `src/lib/mp/gateway.ts` — shapes nuevos + `searchPreapprovals`, `searchAuthorizedPayments`, `searchPayments`, `createPreference`
- `src/lib/treasury/service.ts` — `registerPayment`, `refundPayment`, `registerCashPayment` delegando, `voidReceipt` reabre bandeja
- `src/lib/treasury/receipt-email.ts` — recibo a una solicitud (pago de ingreso)
- `src/lib/mp/webhook-processor.ts` — aplica (reescritura), exporta `applyPayment`
- `src/lib/applications/record.ts` — `Payment.entry` cuelga del socio al asentar
- `src/lib/members/auto-debit.ts` — textos nuevos
- `src/lib/admin/treasury-tabs.ts`, `src/lib/admin/status-badges.ts`
- `src/lib/auth/rate-limiter.ts` — `memberPayLimiter`
- `src/lib/email/templates.ts` — `paymentLinkEmail`
- `src/app/(public)/asociate/actions.ts`, `page.tsx`, `retomar/[token]/page.tsx`, `wizard-shared.ts` — monto desde `fee_values`
- `src/app/admin/solicitudes/actions.ts` — recategorización sin `planIdForCategory`
- `src/app/admin/configuracion/{actions.ts,page.tsx,config-form.tsx}` — ids opcionales + aviso post valor nuevo
- `src/app/admin/tesoreria/valores/page.tsx`, `src/app/admin/socios/[id]/page.tsx`, `src/components/admin/account-section.tsx`, `src/app/mi/cuenta/page.tsx`, `src/app/mi/page.tsx`
- `tests/treasury-service.test.ts`, `tests/mp-webhook-processor.test.ts`, `tests/mp-gateway.test.ts`, `tests/treasury-receipt-email.test.ts`, `tests/application-record.test.ts`, `tests/member-auto-debit.test.ts`, `tests/config-actions.test.ts`
- `docs/04`, `docs/06`, `docs/07`, `docs/10`, `docs/11`, `CLAUDE.md`, `.superpowers/sdd/progress.md`

**Borrar**
- `src/lib/mp/plans.ts`, `tests/mp-plans.test.ts`

---

### Task 0: Branch y ledger

**Files:**
- Modify: `.superpowers/sdd/progress.md`

- [ ] **Step 1: Crear la rama**

```bash
git checkout main && git pull --ff-only && git checkout -b feat/m4b-mercadopago
```

- [ ] **Step 2: Verificar la base**

Run: `npm test 2>&1 | tail -5 && npx tsc --noEmit && npm run lint`
Expected: `Test Files  114 passed`, `Tests  1446 passed`, tsc y lint sin salida de error.

- [ ] **Step 3: Abrir la sección 4B en el ledger**

Agregar al final de `.superpowers/sdd/progress.md`:

```markdown
## Módulo 4 — Fase 4B (Mercado Pago) — rama feat/m4b-mercadopago — inicio 22/08/2026

Spec: docs/superpowers/specs/2026-08-22-modulo-4b-mercadopago-design.md
Plan: docs/superpowers/plans/2026-08-22-modulo-4b-mercadopago.md
Objetivo duro: débito del socio 14 (10/09/2026) registrado por el sistema.
Base: 114 archivos / 1446 tests.
```

- [ ] **Step 4: Commit**

```bash
git add .superpowers/sdd/progress.md
git commit -m "chore(m4b): open phase 4B ledger

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

(Si `.superpowers/` está en `.gitignore`, el ledger no se commitea: sólo se edita. Verificar con `git check-ignore .superpowers/sdd/progress.md`.)

---

### Task 1: Schema y migración nº 8

**Files:**
- Modify: `prisma/schema.prisma` (modelos `MpSubscription` ~523-552 y `MpUnmatchedPayment` ~719-741)
- Create: `prisma/migrations/<ts>_add_module_4b_mercadopago/migration.sql` (generada)
- Modify: `prisma/seed.ts` (al final de `main()`)

**Interfaces:**
- Produces: `MpSubscription.planId: string | null`, `MpSubscription.payerEmail: string | null`, `MpUnmatchedPayment.preapprovalId: string | null`, `MpUnmatchedPayment.reason: string` (VarChar(32); los valores válidos los define `UnmatchedReason` en Task 5).

- [ ] **Step 1: Editar `MpSubscription`**

Reemplazar las dos líneas:

```prisma
  planId            String       @map("plan_id") @db.VarChar(64)
```
```prisma
  payerEmail        String       @map("payer_email") @db.VarChar(191)
```

por:

```prisma
  // Nullable desde 4B: una suscripción creada a mano desde el panel de MP no
  // tiene plan de referencia. `""` como centinela queda prohibido.
  planId            String?      @map("plan_id") @db.VarChar(64)
```
```prisma
  // Nullable desde 4B: `GET /preapproval/{id}` puede no traerlo.
  payerEmail        String?      @map("payer_email") @db.VarChar(191)
```

- [ ] **Step 2: Editar `MpUnmatchedPayment`**

Después de `description       String?         @db.VarChar(200)` agregar:

```prisma
  // Con qué suscripción llegó (si se supo): la vinculación de 4B resuelve sola
  // las filas que esperaban a su socio.
  preapprovalId     String?         @map("preapproval_id") @db.VarChar(64)
  // Por qué no se pudo aplicar. Valores cerrados en código (`UnmatchedReason`,
  // src/lib/mp/unmatched.ts); string y no enum para no migrar por cada motivo.
  reason            String          @db.VarChar(32)
```

y después de `@@index([paymentId])` agregar `@@index([preapprovalId])`.

- [ ] **Step 3: Generar la migración**

Run: `npx prisma migrate dev --name add_module_4b_mercadopago`
Expected: carpeta nueva en `prisma/migrations/` con `ALTER TABLE mp_subscriptions MODIFY plan_id VARCHAR(64) NULL`, `MODIFY payer_email VARCHAR(191) NULL`, `ALTER TABLE mp_unmatched_payments ADD COLUMN preapproval_id …, ADD COLUMN reason VARCHAR(32) NOT NULL`, `CREATE INDEX`. La tabla de bandeja está vacía en todos los entornos, así que `reason NOT NULL` sin default no rompe nada; si Prisma generara un `DEFAULT ''`, borrarlo a mano de la migración (no se quiere un vacío silencioso).

- [ ] **Step 4: Seed de prueba (solo local)**

En `prisma/seed.ts`, dentro de `if (testUsers.create) { … }` (después de los dos `upsertUser`), agregar:

```ts
    // 4B: una suscripción vinculada y una fila de bandeja, para ver las
    // pantallas sin Mercado Pago. Sólo con cuentas de prueba: en producción la
    // bandeja y las suscripciones son datos reales.
    const seedMember = await prisma.member.findFirst({ where: { status: "active" }, select: { id: true } })
    if (seedMember) {
      await prisma.mpSubscription.upsert({
        where: { preapprovalId: "seed-preapproval-0001" },
        update: {},
        create: {
          preapprovalId: "seed-preapproval-0001", memberId: seedMember.id, status: "authorized",
          payerEmail: "socio.prueba@sigev.local", linkedManually: true, amount: "6000.00",
          externalReference: null, planId: null, lastSyncAt: new Date(),
        },
      })
      await prisma.mpUnmatchedPayment.upsert({
        where: { mpPaymentId: "seed-payment-0001" },
        update: {},
        create: {
          mpPaymentId: "seed-payment-0001", amount: "3000.00", paidAt: new Date(),
          payerEmail: "vecino@example.com", externalReference: null, description: "Cuota Vecinal",
          reason: "no_reference",
        },
      })
      console.log("new  4B: suscripción y fila de bandeja de prueba")
    }
```

- [ ] **Step 5: Regenerar y verificar**

Run: `npx prisma generate && npx tsc --noEmit && npm test 2>&1 | tail -3`
Expected: tsc limpio (ningún código lee `planId` como `string` estricto salvo `admin/solicitudes/actions.ts:351`, que hace `?.planId ?? null` y sigue compilando), 1446 tests.

- [ ] **Step 6: Commit**

```bash
git add prisma
git commit -m "feat(m4b): migration 8 — nullable plan/payer on subscriptions, inbox reason and preapproval

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Gateway ampliado

**Files:**
- Modify: `src/lib/mp/gateway.ts`
- Modify: `tests/mp-gateway.test.ts`
- Modify (adaptar a los shapes nuevos): `tests/mp-webhook-processor.test.ts` solo si deja de compilar (se reescribe entero en Task 6; acá alcanza con que `tsc` pase)

**Interfaces:**
- Produces (`MpGateway`):

```ts
export type MpPaymentDetails = {
  id: string; status: string; statusDetail: string | null; transactionAmount: number;
  externalReference: string | null; dateApproved: Date | null;
  payerEmail: string | null; description: string | null;
};
export type MpAuthorizedPayment = {
  id: string; preapprovalId: string | null; status: string; paymentId: string | null;
  amount: number | null; dateCreated: Date | null; externalReference: string | null;
};
export type MpPreapproval = {
  id: string; status: string; payerEmail: string | null; externalReference: string | null;
  amount: number | null; reason: string | null; nextPaymentDate: Date | null; dateCreated: Date | null;
};
getPayment(id): Promise<MpPaymentDetails>
getAuthorizedPayment(id): Promise<MpAuthorizedPayment>
getPreapproval(id): Promise<MpPreapproval>
searchPreapprovals(input?: { status?: string }): Promise<MpPreapproval[]>
searchAuthorizedPayments(preapprovalId: string): Promise<MpAuthorizedPayment[]>
searchPayments(input: { since: Date }): Promise<MpPaymentDetails[]>
createPreference(input: { title: string; amount: number; externalReference: string; backUrl: string; notificationUrl: string }): Promise<{ id: string; initPoint: string }>
```

- [ ] **Step 1: Tests nuevos en `tests/mp-gateway.test.ts`**

Ampliar el `vi.mock("mercadopago", …)` con `Preference` y un `get` de `Payment` controlable, y agregar un mock global de `fetch`:

```ts
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  planGet: vi.fn(),
  paymentGet: vi.fn(),
  preapprovalGet: vi.fn(),
  preferenceCreate: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("mercadopago", () => ({
  MercadoPagoConfig: class { constructor(public opts: unknown) {} },
  PreApproval: class { create = mocks.create; update = mocks.update; get = mocks.preapprovalGet; },
  PreApprovalPlan: class { get = mocks.planGet; },
  Payment: class { get = mocks.paymentGet; },
  Preference: class { create = mocks.preferenceCreate; },
}));
vi.stubGlobal("fetch", mocks.fetch);
```

Casos a agregar (después de los existentes):

```ts
describe("getPayment (4B)", () => {
  it("devuelve dateApproved como Date UTC, payerEmail y description", async () => {
    mocks.paymentGet.mockResolvedValue({
      id: 777, status: "approved", status_detail: "accredited", transaction_amount: 6000,
      external_reference: "solicitud:9", date_approved: "2026-09-10T08:15:30.000-03:00",
      payer: { email: "v@x.com" }, description: "Cuota Vecinal Ciudadela",
    });
    const p = await makeMpGateway().getPayment("777");
    expect(p).toMatchObject({ id: "777", status: "approved", statusDetail: "accredited", transactionAmount: 6000,
      externalReference: "solicitud:9", payerEmail: "v@x.com", description: "Cuota Vecinal Ciudadela" });
    expect(p.dateApproved?.toISOString()).toBe("2026-09-10T11:15:30.000Z");
  });
  it("sin date_approved → null; sin payer → null", async () => {
    mocks.paymentGet.mockResolvedValue({ id: 1, status: "in_process", transaction_amount: 1 });
    const p = await makeMpGateway().getPayment("1");
    expect(p.dateApproved).toBeNull();
    expect(p.payerEmail).toBeNull();
  });
});

describe("getAuthorizedPayment (4B)", () => {
  it("trae paymentId, amount y dateCreated del cobro", async () => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({
      id: 55, preapproval_id: "pre-1", status: "processed", payment: { id: 777, status: "approved" },
      transaction_amount: 6000, date_created: "2026-09-10T08:00:00.000-03:00", external_reference: "x",
    }), { status: 200 }));
    const a = await makeMpGateway().getAuthorizedPayment("55");
    expect(a).toMatchObject({ id: "55", preapprovalId: "pre-1", status: "processed", paymentId: "777", amount: 6000, externalReference: "x" });
    expect(a.dateCreated?.toISOString()).toBe("2026-09-10T11:00:00.000Z");
    expect(mocks.fetch.mock.calls[0][0]).toBe("https://api.mercadopago.com/authorized_payments/55");
  });
  it("sin `payment` → paymentId null (el cobro todavía no existe)", async () => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ id: 56, preapproval_id: "pre-1", status: "scheduled" }), { status: 200 }));
    expect((await makeMpGateway().getAuthorizedPayment("56")).paymentId).toBeNull();
  });
});

describe("getPreapproval (4B)", () => {
  it("suma amount, reason y nextPaymentDate", async () => {
    mocks.preapprovalGet.mockResolvedValue({
      id: "pre-1", status: "authorized", payer_email: "v@x.com", external_reference: null,
      reason: "Cuota", auto_recurring: { transaction_amount: 6000 }, next_payment_date: "2026-09-10T03:00:00.000Z",
    });
    const s = await makeMpGateway().getPreapproval("pre-1");
    expect(s).toMatchObject({ amount: 6000, reason: "Cuota", externalReference: null });
    expect(s.nextPaymentDate?.toISOString()).toBe("2026-09-10T03:00:00.000Z");
  });
});

describe("searchPreapprovals", () => {
  it("pagina de a 100 hasta agotar y filtra por status", async () => {
    mocks.fetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ paging: { total: 101, limit: 100, offset: 0 }, results: Array.from({ length: 100 }, (_, i) => ({ id: `p${i}`, status: "authorized" })) }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ paging: { total: 101, limit: 100, offset: 100 }, results: [{ id: "p100", status: "authorized" }] }), { status: 200 }));
    const rows = await makeMpGateway().searchPreapprovals({ status: "authorized" });
    expect(rows).toHaveLength(101);
    expect(String(mocks.fetch.mock.calls[0][0])).toContain("/preapproval/search?");
    expect(String(mocks.fetch.mock.calls[0][0])).toContain("status=authorized");
    expect(String(mocks.fetch.mock.calls[1][0])).toContain("offset=100");
  });
  it("una respuesta no-2xx lanza (fallo técnico, no result)", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response("nope", { status: 500 }));
    await expect(makeMpGateway().searchPreapprovals()).rejects.toThrow("preapproval/search respondió 500");
  });
});

describe("searchAuthorizedPayments", () => {
  it("consulta por preapproval_id y mapea los resultados", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ paging: { total: 1, limit: 100, offset: 0 },
      results: [{ id: 9, preapproval_id: "pre-1", status: "processed", payment: { id: 777 }, transaction_amount: 6000 }] }), { status: 200 }));
    const rows = await makeMpGateway().searchAuthorizedPayments("pre-1");
    expect(rows[0]).toMatchObject({ id: "9", paymentId: "777", amount: 6000 });
    expect(String(mocks.fetch.mock.calls[0][0])).toContain("authorized_payments/search?preapproval_id=pre-1");
  });
});

describe("searchPayments", () => {
  it("busca approved por date_approved desde `since`", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ paging: { total: 1, limit: 100, offset: 0 },
      results: [{ id: 777, status: "approved", transaction_amount: 6000, date_approved: "2026-09-10T11:15:30.000Z" }] }), { status: 200 }));
    const rows = await makeMpGateway().searchPayments({ since: new Date("2026-09-07T11:00:00Z") });
    expect(rows[0]).toMatchObject({ id: "777", status: "approved", transactionAmount: 6000 });
    const url = String(mocks.fetch.mock.calls[0][0]);
    expect(url).toContain("/v1/payments/search?");
    expect(url).toContain("range=date_approved");
    expect(url).toContain("status=approved");
    expect(decodeURIComponent(url)).toContain("begin_date=2026-09-07T11:00:00.000Z");
  });
});

describe("createPreference", () => {
  it("manda título, monto, referencia, back_urls y notification_url; devuelve init_point", async () => {
    mocks.preferenceCreate.mockResolvedValue({ id: "pref-1", init_point: "https://mp/checkout/pref-1" });
    const r = await makeMpGateway().createPreference({
      title: "Cuota Vecinal Ciudadela × 2", amount: 12000, externalReference: "pago:14:2",
      backUrl: "https://vecinalciudadela.ar/mi/cuenta?volvio=1", notificationUrl: "https://vecinalciudadela.ar/api/webhooks/mp",
    });
    expect(r).toEqual({ id: "pref-1", initPoint: "https://mp/checkout/pref-1" });
    const body = mocks.preferenceCreate.mock.calls[0][0].body;
    expect(body.items[0]).toMatchObject({ title: "Cuota Vecinal Ciudadela × 2", quantity: 1, unit_price: 12000, currency_id: "ARS" });
    expect(body.external_reference).toBe("pago:14:2");
    expect(body.back_urls).toEqual({ success: "https://vecinalciudadela.ar/mi/cuenta?volvio=1", pending: "https://vecinalciudadela.ar/mi/cuenta?volvio=1", failure: "https://vecinalciudadela.ar/mi/cuenta?volvio=1" });
    expect(body.auto_return).toBe("approved");
    expect(body.notification_url).toBe("https://vecinalciudadela.ar/api/webhooks/mp");
  });
});
```

- [ ] **Step 2: Correr y ver fallar**

Run: `npx vitest run tests/mp-gateway.test.ts`
Expected: FAIL (métodos inexistentes / shapes viejos).

- [ ] **Step 3: Implementar en `src/lib/mp/gateway.ts`**

Reemplazar el tipo `MpGateway` y las implementaciones de `getPreapproval`, `getPayment`, `getAuthorizedPayment`; agregar los cuatro métodos nuevos. Código completo:

```ts
import { MercadoPagoConfig, Payment, PreApproval, PreApprovalPlan, Preference } from "mercadopago";

export type MpPaymentDetails = {
  id: string;
  status: string;
  statusDetail: string | null;
  transactionAmount: number;
  externalReference: string | null;
  /** `date_approved` de MP como instante UTC; null si el pago no está aprobado. */
  dateApproved: Date | null;
  payerEmail: string | null;
  description: string | null;
};

export type MpAuthorizedPayment = {
  id: string;
  preapprovalId: string | null;
  status: string;
  /** El `payment.id` del cobro real; null mientras MP no lo haya creado. */
  paymentId: string | null;
  amount: number | null;
  dateCreated: Date | null;
  externalReference: string | null;
};

export type MpPreapproval = {
  id: string;
  status: string;
  payerEmail: string | null;
  externalReference: string | null;
  amount: number | null;
  reason: string | null;
  nextPaymentDate: Date | null;
  dateCreated: Date | null;
};

export type MpGateway = {
  getPlan(planId: string): Promise<{ id: string; reason: string; amount: number }>;
  createPreapproval(input: {
    reason: string; amount: number; payerEmail: string; externalReference: string; backUrl: string;
  }): Promise<{ id: string; initPoint: string; status: string }>;
  cancelPreapproval(id: string): Promise<void>;
  updatePreapprovalAmount(id: string, amount: number): Promise<void>;
  getPreapproval(id: string): Promise<MpPreapproval>;
  getPayment(id: string): Promise<MpPaymentDetails>;
  getAuthorizedPayment(id: string): Promise<MpAuthorizedPayment>;
  /** `GET /preapproval/search`, paginado hasta agotar. */
  searchPreapprovals(input?: { status?: string }): Promise<MpPreapproval[]>;
  /** `GET /authorized_payments/search?preapproval_id=`: la ÚNICA forma de hallar
   *  los cobros de una suscripción (docs/11 §7). */
  searchAuthorizedPayments(preapprovalId: string): Promise<MpAuthorizedPayment[]>;
  /** `GET /v1/payments/search` aprobados por `date_approved` desde `since`. */
  searchPayments(input: { since: Date }): Promise<MpPaymentDetails[]>;
  /** Checkout Pro. La preferencia NO se persiste: el pago se reconoce por la referencia. */
  createPreference(input: {
    title: string; amount: number; externalReference: string; backUrl: string; notificationUrl: string;
  }): Promise<{ id: string; initPoint: string }>;
};

const API = "https://api.mercadopago.com";
const PAGE = 100;

function isoToDate(s: unknown): Date | null {
  if (typeof s !== "string" || s === "") return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function numberOrNull(n: unknown): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

type RawPayment = {
  id?: number | string; status?: string; status_detail?: string; transaction_amount?: number;
  external_reference?: string | null; date_approved?: string | null;
  payer?: { email?: string | null } | null; description?: string | null;
};
function mapPayment(res: RawPayment, fallbackId: string): MpPaymentDetails {
  if (typeof res.transaction_amount !== "number") {
    throw new Error(`El pago ${fallbackId} no tiene monto en MP.`);
  }
  return {
    id: String(res.id ?? fallbackId),
    status: res.status ?? "unknown",
    statusDetail: res.status_detail ?? null,
    transactionAmount: res.transaction_amount,
    externalReference: res.external_reference ?? null,
    dateApproved: isoToDate(res.date_approved),
    payerEmail: res.payer?.email ?? null,
    description: res.description ?? null,
  };
}

type RawAuthorized = {
  id?: number | string; preapproval_id?: string; status?: string;
  payment?: { id?: number | string } | null; transaction_amount?: number;
  date_created?: string; external_reference?: string | null;
};
function mapAuthorized(data: RawAuthorized, fallbackId: string): MpAuthorizedPayment {
  return {
    id: String(data.id ?? fallbackId),
    preapprovalId: data.preapproval_id ?? null,
    status: data.status ?? "unknown",
    paymentId: data.payment?.id != null ? String(data.payment.id) : null,
    amount: numberOrNull(data.transaction_amount),
    dateCreated: isoToDate(data.date_created),
    externalReference: data.external_reference ?? null,
  };
}

type RawPreapproval = {
  id?: string; status?: string; payer_email?: string | null; external_reference?: string | null;
  reason?: string | null; auto_recurring?: { transaction_amount?: number } | null;
  next_payment_date?: string | null; date_created?: string | null;
};
function mapPreapproval(res: RawPreapproval, fallbackId: string): MpPreapproval {
  return {
    id: res.id ?? fallbackId,
    status: res.status ?? "unknown",
    payerEmail: res.payer_email ?? null,
    externalReference: res.external_reference ?? null,
    amount: numberOrNull(res.auto_recurring?.transaction_amount),
    reason: res.reason ?? null,
    nextPaymentDate: isoToDate(res.next_payment_date),
    dateCreated: isoToDate(res.date_created),
  };
}
```

Dentro de `makeMpGateway()`, agregar un helper y reemplazar/agregar métodos:

```ts
  // Búsquedas por fetch directo: el SDK no expone `/preapproval/search` ni
  // `/authorized_payments` y su `payments.search` no pagina por nosotros. Una
  // respuesta no-2xx lanza (es un fallo técnico, que el llamador convierte en
  // 500 o en `errors[]` del cron), nunca se traduce a "no hay resultados".
  async function searchAll<T>(path: string, params: Record<string, string>, label: string): Promise<T[]> {
    const out: T[] = [];
    let offset = 0;
    for (;;) {
      const qs = new URLSearchParams({ ...params, limit: String(PAGE), offset: String(offset) });
      const res = await fetch(`${API}${path}?${qs}`, { headers: { Authorization: `Bearer ${accessToken()}` } });
      if (!res.ok) throw new Error(`${label} respondió ${res.status}`);
      const data = (await res.json()) as { paging?: { total?: number }; results?: T[] };
      const page = data.results ?? [];
      out.push(...page);
      offset += page.length;
      const total = data.paging?.total ?? out.length;
      if (page.length === 0 || offset >= total) return out;
    }
  }
```

```ts
    async getPreapproval(id) {
      const res = await new PreApproval(mp()).get({ id });
      return mapPreapproval(res as RawPreapproval, id);
    },
    async getPayment(id) {
      const res = await new Payment(mp()).get({ id });
      return mapPayment(res as RawPayment, id);
    },
    async getAuthorizedPayment(id) {
      const res = await fetch(`${API}/authorized_payments/${id}`, {
        headers: { Authorization: `Bearer ${accessToken()}` },
      });
      if (!res.ok) throw new Error(`authorized_payments/${id} respondió ${res.status}`);
      return mapAuthorized((await res.json()) as RawAuthorized, id);
    },
    async searchPreapprovals(input) {
      const params: Record<string, string> = {};
      if (input?.status) params.status = input.status;
      const rows = await searchAll<RawPreapproval>("/preapproval/search", params, "preapproval/search");
      return rows.map((r) => mapPreapproval(r, r.id ?? ""));
    },
    async searchAuthorizedPayments(preapprovalId) {
      const rows = await searchAll<RawAuthorized>(
        "/authorized_payments/search", { preapproval_id: preapprovalId }, "authorized_payments/search",
      );
      return rows.map((r) => mapAuthorized(r, String(r.id ?? "")));
    },
    async searchPayments(input) {
      const rows = await searchAll<RawPayment>("/v1/payments/search", {
        sort: "date_approved", criteria: "desc", range: "date_approved",
        begin_date: input.since.toISOString(), end_date: new Date().toISOString(), status: "approved",
      }, "payments/search");
      // Un resultado sin monto se descarta en vez de tirar: el cron no puede
      // caerse entero por una fila rara de MP.
      return rows.filter((r) => typeof r.transaction_amount === "number").map((r) => mapPayment(r, String(r.id ?? "")));
    },
    async createPreference(input) {
      const res = await new Preference(mp()).create({
        body: {
          items: [{ id: input.externalReference, title: input.title, quantity: 1, unit_price: input.amount, currency_id: "ARS" }],
          external_reference: input.externalReference,
          back_urls: { success: input.backUrl, pending: input.backUrl, failure: input.backUrl },
          auto_return: "approved",
          notification_url: input.notificationUrl,
        },
      });
      if (!res.id || !res.init_point) throw new Error("MP no devolvió la preferencia creada.");
      return { id: res.id, initPoint: res.init_point };
    },
```

`getPlan`, `createPreapproval`, `cancelPreapproval`, `updatePreapprovalAmount` quedan como están.

- [ ] **Step 4: Correr tests del gateway y tsc**

Run: `npx vitest run tests/mp-gateway.test.ts && npx tsc --noEmit`
Expected: gateway PASS. `tsc` va a fallar en `tests/mp-webhook-processor.test.ts` sólo si castea shapes viejos (usa `as never`: no debería). Si falla en `src/lib/mp/plans.ts` o en el procesador, son usos de `getPayment` que siguen siendo compatibles (los campos viejos siguen existiendo). Arreglar sólo lo que no compile.

- [ ] **Step 5: Suite completa y commit**

Run: `npm test 2>&1 | tail -3`
Expected: todo verde.

```bash
git add src/lib/mp/gateway.ts tests/mp-gateway.test.ts
git commit -m "feat(m4b): widen MP gateway — payment dates, authorized payment ids, searches, Checkout Pro preference

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Núcleo `registerPayment` (Efectivo delega)

**Files:**
- Modify: `src/lib/treasury/service.ts`
- Modify: `tests/treasury-service.test.ts`

**Interfaces:**
- Produces (en `treasuryService`):

```ts
export type RegisterPaymentInput = {
  memberId: number | null;          // null sólo para `entry` (la solicitud todavía no es socio)
  applicationId?: number | null;
  type: PaymentType;
  n: number;                        // cuotas a imputar; 0 para voluntary/extraordinary/entry
  amount: number;                   // lo cobrado de verdad
  paidAt: Date;
  mpPaymentId?: string | null;
  preapprovalId?: string | null;
  actorId: number | null;           // null = automático
  note?: string | null;
};
export type RegisterResult =
  | { kind: "registered"; paymentId: number; receiptId: number; number: string; periods: Period[]; amount: number; pdfWritten: boolean }
  | { kind: "already_processed"; paymentId: number }
  | { kind: "no_pending_withdrawn" };
registerPayment(input: RegisterPaymentInput): Promise<RegisterResult>
```
- `registerCashPayment` conserva firma y retorno (`{ paymentId, receiptId, number, periods, amount, pdfWritten }`).

- [ ] **Step 1: Tests nuevos en `tests/treasury-service.test.ts`**

Primero ampliar `fakeDb`: en `tx` agregar a `payment` un `findUnique` y una tabla `mpUnmatchedPayment`:

```ts
    payment: {
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        // Unique de `mpPaymentId`, como la base: el segundo create del mismo
        // cobro tiene que chocar con P2002 y no crear una segunda fila.
        const mpId = args.data.mpPaymentId;
        if (mpId && state.payments.some((p) => p.mpPaymentId === mpId)) {
          throw Object.assign(new Error("Unique constraint failed"), { code: "P2002", meta: { target: ["mp_payment_id"] } });
        }
        const p = { id: state.payments.length + 1, ...args.data };
        state.payments.push(p);
        return p;
      }),
      findUnique: vi.fn(async (args: { where: { mpPaymentId?: string; id?: number } }) =>
        state.payments.find((p) => (args.where.mpPaymentId ? p.mpPaymentId === args.where.mpPaymentId : p.id === args.where.id)) ?? null),
      update: /* como estaba */,
    },
    mpUnmatchedPayment: {
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
```

y exponer `state` en lo que devuelve `fakeDb` si no lo está ya. Después, los casos:

```ts
describe("registerPayment (núcleo 4B)", () => {
  const member = { id: 1, category: "adherent", status: "active", joinedAt: civilDateUtc(2020, 1, 1), memberships: [] };
  const paidAt = new Date("2026-09-10T11:15:30Z");

  it("débito de un adherente: crea y paga la cuota del período, recibo con concepto de cuota, paidAt de MP", async () => {
    const { db, state } = fakeDb({ member, fees: [] });
    const svc = makeTreasuryService({ db: db as never, feeValues: feeValues(6000, 3000), now: () => new Date("2026-09-10T12:00:00Z"), renderPdf: async () => new Uint8Array(), writePdf: async () => {} });
    const r = await svc.registerPayment({ memberId: 1, type: "debit", n: 1, amount: 3000, paidAt, mpPaymentId: "777", preapprovalId: "pre-1", actorId: null });
    expect(r.kind).toBe("registered");
    if (r.kind !== "registered") return;
    expect(r.periods).toEqual(["2026-09"]);
    expect(state.fees).toEqual([expect.objectContaining({ period: "2026-09", status: "paid", origin: "accrual", paymentId: 1 })]);
    expect(state.payments[0]).toMatchObject({ type: "debit", amount: "3000.00", paidAt, mpPaymentId: "777", preapprovalId: "pre-1", registeredById: null, status: "applied" });
    expect(state.receipts[0]).toMatchObject({ concept: "Cuota social · septiembre 2026", issuedAt: paidAt, year: 2026 });
  });

  it("imputa la pendiente más vieja antes que el período corriente", async () => {
    const { db, state } = fakeDb({ member: { ...member, category: "active" }, fees: [
      { id: 1, memberId: 1, period: "2025-11", status: "pending", origin: "import", paymentId: null },
    ] });
    const svc = makeTreasuryService({ db: db as never, feeValues: feeValues(6000, 3000), renderPdf: async () => new Uint8Array(), writePdf: async () => {} });
    const r = await svc.registerPayment({ memberId: 1, type: "debit", n: 1, amount: 6000, paidAt, mpPaymentId: "778", actorId: null });
    expect(r.kind === "registered" && r.periods).toEqual(["2025-11"]);
    expect(state.fees.find((f) => f.period === "2025-11")?.status).toBe("paid");
  });

  it("mismo mpPaymentId dos veces → already_processed sin segundo recibo (consulta previa)", async () => {
    const { db, state } = fakeDb({ member, fees: [] });
    const svc = makeTreasuryService({ db: db as never, feeValues: feeValues(6000, 3000), renderPdf: async () => new Uint8Array(), writePdf: async () => {} });
    const input = { memberId: 1, type: "debit" as const, n: 1, amount: 3000, paidAt, mpPaymentId: "777", actorId: null };
    await svc.registerPayment(input);
    const r = await svc.registerPayment(input);
    expect(r).toEqual({ kind: "already_processed", paymentId: 1 });
    expect(state.receipts).toHaveLength(1);
    expect(state.seq).toBe(1);
  });

  it("carrera: el create choca con P2002 → already_processed y el número NO se consumió", async () => {
    const { db, state } = fakeDb({ member, fees: [] });
    // La consulta previa no ve nada (simula dos eventos en paralelo) y el
    // create choca contra la unique.
    db.payment.findUnique.mockResolvedValueOnce(null);
    state.payments.push({ id: 9, mpPaymentId: "777" });
    const svc = makeTreasuryService({ db: db as never, feeValues: feeValues(6000, 3000), renderPdf: async () => new Uint8Array(), writePdf: async () => {} });
    const r = await svc.registerPayment({ memberId: 1, type: "debit", n: 1, amount: 3000, paidAt, mpPaymentId: "777", actorId: null });
    expect(r).toEqual({ kind: "already_processed", paymentId: 9 });
    expect(state.seq).toBe(0);
    expect(state.receipts).toHaveLength(0);
  });

  it("cesante con 2 pendientes y n=3 → se acota a 2; sin pendientes → no_pending_withdrawn", async () => {
    const withdrawn = { ...member, status: "withdrawn" };
    const a = fakeDb({ member: withdrawn, fees: [
      { id: 1, memberId: 1, period: "2025-07", status: "pending", origin: "import", paymentId: null },
      { id: 2, memberId: 1, period: "2025-08", status: "pending", origin: "import", paymentId: null },
    ] });
    const svc = makeTreasuryService({ db: a.db as never, feeValues: feeValues(6000, 3000), renderPdf: async () => new Uint8Array(), writePdf: async () => {} });
    const r = await svc.registerPayment({ memberId: 1, type: "link", n: 3, amount: 9000, paidAt, mpPaymentId: "1", actorId: null });
    expect(r.kind === "registered" && r.periods).toEqual(["2025-07", "2025-08"]);
    expect(a.state.fees).toHaveLength(2);
    const b = fakeDb({ member: withdrawn, fees: [] });
    const svc2 = makeTreasuryService({ db: b.db as never, feeValues: feeValues(6000, 3000), renderPdf: async () => new Uint8Array(), writePdf: async () => {} });
    expect(await svc2.registerPayment({ memberId: 1, type: "debit", n: 1, amount: 3000, paidAt, mpPaymentId: "2", actorId: null })).toEqual({ kind: "no_pending_withdrawn" });
    expect(b.state.payments).toHaveLength(0);
  });

  it("la serie sale del día civil AR de paidAt: cobro del 31/12 23:30 AR es del año viejo", async () => {
    const { db, state } = fakeDb({ member, fees: [] });
    db.receiptSequence.findUniqueOrThrow.mockImplementation(async (args: { where: { year: number } }) => ({ year: args.where.year, last: 1 }));
    const svc = makeTreasuryService({ db: db as never, feeValues: feeValues(6000, 3000), renderPdf: async () => new Uint8Array(), writePdf: async () => {} });
    const r = await svc.registerPayment({ memberId: 1, type: "debit", n: 1, amount: 3000, paidAt: new Date("2027-01-01T02:30:00Z"), mpPaymentId: "3", actorId: null });
    expect(r.kind === "registered" && r.number.startsWith("2026-")).toBe(true);
    expect(state.receipts[0].year).toBe(2026);
  });

  it("entry: n=0, sin socio, cuelga de la solicitud; concepto 'Cuota de ingreso'", async () => {
    const { db, state } = fakeDb({ member, fees: [] });
    const svc = makeTreasuryService({ db: db as never, feeValues: feeValues(6000, 3000), renderPdf: async () => new Uint8Array(), writePdf: async () => {} });
    const r = await svc.registerPayment({ memberId: null, applicationId: 9, type: "entry", n: 0, amount: 6000, paidAt, mpPaymentId: "4", preapprovalId: "pre-9", actorId: null });
    expect(r.kind).toBe("registered");
    expect(state.payments[0]).toMatchObject({ memberId: null, applicationId: 9, type: "entry" });
    expect(state.receipts[0].concept).toBe("Cuota de ingreso");
    expect(state.fees).toHaveLength(0);
  });

  it("cierra las filas de la bandeja con ese mpPaymentId dentro de la transacción", async () => {
    const { db } = fakeDb({ member, fees: [] });
    const svc = makeTreasuryService({ db: db as never, feeValues: feeValues(6000, 3000), renderPdf: async () => new Uint8Array(), writePdf: async () => {} });
    await svc.registerPayment({ memberId: 1, type: "debit", n: 1, amount: 3000, paidAt, mpPaymentId: "777", actorId: null });
    expect(db.mpUnmatchedPayment.updateMany).toHaveBeenCalledWith({
      where: { mpPaymentId: "777", status: "open" },
      data: { status: "matched", paymentId: 1, resolvedAt: expect.any(Date) },
    });
  });

  it("monto ≤ 0 o > techo → TreasuryError", async () => {
    const { db } = fakeDb({ member, fees: [] });
    const svc = makeTreasuryService({ db: db as never, feeValues: feeValues(6000, 3000) });
    await expect(svc.registerPayment({ memberId: 1, type: "debit", n: 1, amount: 0, paidAt, actorId: null })).rejects.toThrow(TreasuryError);
    await expect(svc.registerPayment({ memberId: 1, type: "debit", n: 1, amount: 100_000_000, paidAt, actorId: null })).rejects.toThrow(TreasuryError);
  });
});
```

(`feeValues(a, s)` es el helper que el archivo ya usa para fabricar el lector; si se llama distinto, usar el existente.)

- [ ] **Step 2: Correr y ver fallar**

Run: `npx vitest run tests/treasury-service.test.ts`
Expected: FAIL con `registerPayment is not a function`.

- [ ] **Step 3: Implementar el núcleo en `service.ts`**

Agregar tipos y helpers arriba de `makeTreasuryService`:

```ts
export type RegisterPaymentInput = {
  memberId: number | null;
  applicationId?: number | null;
  type: PaymentType;
  n: number;
  amount: number;
  paidAt: Date;
  mpPaymentId?: string | null;
  preapprovalId?: string | null;
  actorId: number | null;
  note?: string | null;
};

export type RegisterResult =
  | { kind: "registered"; paymentId: number; receiptId: number; number: string; periods: Period[]; amount: number; pdfWritten: boolean }
  | { kind: "already_processed"; paymentId: number }
  | { kind: "no_pending_withdrawn" };

/** Tipos que imputan cuotas. `entry` no imputa (REG-14: cubre el mes de alta). */
const FEE_TYPES: readonly PaymentType[] = ["debit", "link", "cash"];

// Prisma lanza `PrismaClientKnownRequestError` con `code: "P2002"` en una
// violación de unique. Se mira por forma y no por `instanceof` para que el
// fake de los tests pueda producirlo sin importar la clase generada.
function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2002";
}
```

Dentro de `makeTreasuryService`, ANTES de `return {`, agregar el núcleo:

```ts
  async function registerPaymentCore(input: RegisterPaymentInput): Promise<RegisterResult> {
    const { paidAt } = input;
    const amount = Math.round(input.amount * 100) / 100;
    if (!Number.isFinite(amount) || amount <= 0) throw new TreasuryError("El monto del pago tiene que ser mayor a cero.");
    if (amount > MAX_AMOUNT) throw new TreasuryError("El monto supera el máximo que admite el sistema ($ 99.999.999,99).");
    if (!Number.isInteger(input.n) || input.n < 0 || input.n > MAX_FEES_PER_PAYMENT) {
      throw new TreasuryError(`La cantidad de cuotas tiene que estar entre 0 y ${MAX_FEES_PER_PAYMENT}.`);
    }
    if (input.memberId === null && input.type !== "entry") throw new TreasuryError("El pago necesita un socio.");

    // Primera barrera de idempotencia: el cobro de MP ya está asentado.
    if (input.mpPaymentId) {
      const existing = await db.payment.findUnique({ where: { mpPaymentId: input.mpPaymentId }, select: { id: true } });
      if (existing) return { kind: "already_processed", paymentId: existing.id };
    }

    let periods: Period[] = [];
    let toCreate: Period[] = [];
    let n = FEE_TYPES.includes(input.type) ? input.n : 0;
    if (input.memberId !== null) {
      const member = await db.member.findUnique({ where: { id: input.memberId }, select: { id: true, status: true } });
      if (!member) throw new TreasuryError("El socio no existe.");
      if (n > 0) {
        const fees = await db.fee.findMany({ where: { memberId: member.id }, select: { period: true, status: true } });
        const pending = fees.filter((f) => f.status === "pending").map((f) => f.period);
        // Un dado de baja no devenga: se le cobra la deuda congelada y ni una
        // cuota más. Acotar en vez de tirar — desde un webhook, tirar sería un
        // 500 y MP reintentaría para siempre un cobro que ya hizo.
        if (member.status === "withdrawn") {
          n = Math.min(n, pending.length);
          if (n === 0) return { kind: "no_pending_withdrawn" };
        }
        const allocation = allocate({ pending, existing: fees.map((f) => f.period), n, currentPeriod: currentPeriod(paidAt) });
        periods = allocation.toPay;
        toCreate = allocation.toCreate;
      }
    }

    const concept = fitConcept(paymentConcept(input.type, periods));
    const year = seriesYear(paidAt);
    let created: { paymentId: number; receiptId: number; number: string };
    try {
      created = await db.$transaction(async (tx) => {
        // El pago va PRIMERO: si la unique de `mpPaymentId` choca (dos eventos
        // del mismo cobro en paralelo), la transacción muere acá, antes de
        // pedir número — un rollback no consume serie (REG-33).
        const payment = await tx.payment.create({
          data: {
            memberId: input.memberId, applicationId: input.applicationId ?? null, type: input.type,
            amount: amount.toFixed(2), paidAt, mpPaymentId: input.mpPaymentId ?? null,
            preapprovalId: input.preapprovalId ?? null, registeredById: input.actorId,
            note: input.note ?? null, status: "applied",
          },
        });
        if (toCreate.length > 0) {
          await tx.fee.createMany({
            data: toCreate.map((period) => ({
              memberId: input.memberId!, period, status: "paid" as const, origin: "accrual" as const, paymentId: payment.id,
            })),
          });
        }
        const existingToPay = periods.filter((p) => !toCreate.includes(p));
        if (existingToPay.length > 0) {
          const imputed = await tx.fee.updateMany({
            where: { memberId: input.memberId!, period: { in: existingToPay }, status: "pending" },
            data: { status: "paid", paymentId: payment.id },
          });
          if (imputed.count !== existingToPay.length) {
            throw new TreasuryError("Las cuotas del socio cambiaron mientras se registraba el pago. Revisá la cuenta y volvé a intentarlo.");
          }
        }
        // Cierre automático de la bandeja: si este cobro estaba esperando, deja
        // de esperar en la misma transacción que lo asienta.
        if (input.mpPaymentId) {
          await tx.mpUnmatchedPayment.updateMany({
            where: { mpPaymentId: input.mpPaymentId, status: "open" },
            data: { status: "matched", paymentId: payment.id, resolvedAt: now() },
          });
        }
        const seq = await nextReceiptSeq(tx, year);
        const number = formatReceiptNumber(year, seq);
        const receipt = await tx.receipt.create({
          data: { number, year, seq, paymentId: payment.id, concept, pdfPath: receiptRelativePath(number), issuedAt: paidAt },
        });
        return { paymentId: payment.id, receiptId: receipt.id, number };
      });
    } catch (e) {
      if (input.mpPaymentId && isUniqueViolation(e)) {
        const winner = await db.payment.findUnique({ where: { mpPaymentId: input.mpPaymentId }, select: { id: true } });
        if (winner) return { kind: "already_processed", paymentId: winner.id };
      }
      throw e;
    }
    const pdfWritten = await writePdfBestEffort(created.receiptId, receiptRelativePath(created.number));
    return { kind: "registered", ...created, periods: [...periods].sort(comparePeriods), amount, pdfWritten };
  }
```

El mutex se toma en el método público:

```ts
    async registerPayment(input: RegisterPaymentInput): Promise<RegisterResult> {
      const key = input.memberId !== null ? `member:${input.memberId}` : `application:${input.applicationId ?? 0}`;
      return memberMutex.run(key, () => registerPaymentCore(input));
    },
```

Y `registerCashPayment` pasa a delegar: conserva TODO lo que hay hasta el cálculo de `amount` (validaciones, mensajes, chequeo del cesante, `allocate` ya no hace falta acá — se borra ese bloque y se deja sólo el cálculo de `count`/`unit`/`amount`), y reemplaza desde `// El concepto se congela` hasta el `return` por:

```ts
        const r = await registerPaymentCore({
          memberId: member.id, type: CONCEPT_TYPE[input.concept], n: input.concept === "fees" ? (input.count ?? 0) : 0,
          amount, paidAt: at, actorId: input.actorId, note: input.note ?? null,
        });
        // Los dos resultados no-registrados son imposibles acá: sin mpPaymentId
        // no hay `already_processed`, y el cesante sin pendientes ya se rechazó
        // arriba con su mensaje de mostrador.
        if (r.kind !== "registered") throw new TreasuryError("No se pudo registrar el pago.");
        const { kind: _kind, ...rest } = r;
        return rest;
```

Nota: `registerCashPayment` sigue dentro de su propio `memberMutex.run(...)`; por eso llama a `registerPaymentCore` (sin mutex) y no a `registerPayment` — un mutex reentrante no existe y se bloquearía solo. Mantener la lectura previa de `fees` en `registerCashPayment` sólo para el mensaje del cesante (`count > pending.length`); el núcleo vuelve a leer, y eso es aceptable (dos SELECT baratos bajo el mismo mutex).

`pdfDataFor` debe tolerar pagos de solicitud: en el `include` agregar `application: { select: { fullName: true } }` y:

```ts
      memberName: member?.fullName ?? r.payment.application?.fullName ?? "—",
```

- [ ] **Step 4: Correr los tests del servicio**

Run: `npx vitest run tests/treasury-service.test.ts`
Expected: PASS los 40 anteriores (efectivo y anulación intactos) + los 9 nuevos. Si un test viejo de efectivo afirmaba el `where` exacto del `findUnique` del socio (ahora hay dos lecturas), ajustar la aserción a `toHaveBeenCalledWith(expect.objectContaining(...))`.

- [ ] **Step 5: Suite, tsc, lint y commit**

Run: `npm test 2>&1 | tail -3 && npx tsc --noEmit && npm run lint`

```bash
git add src/lib/treasury/service.ts tests/treasury-service.test.ts
git commit -m "feat(m4b): extract registerPayment core from cash flow — origin-agnostic, idempotent by mpPaymentId

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: `refundPayment` y reapertura de la bandeja

**Files:**
- Modify: `src/lib/treasury/service.ts`
- Modify: `tests/treasury-service.test.ts`

**Interfaces:**
- Produces:

```ts
refundPayment(input: { mpPaymentId: string; reason: string }): Promise<
  | { kind: "refunded"; paymentId: number; number: string; periodsReverted: number }
  | { kind: "not_found" }
  | { kind: "already_reverted"; status: "refunded" | "voided" }>
```
- `voidReceipt` conserva firma; además reabre filas de bandeja.

- [ ] **Step 1: Tests**

```ts
describe("refundPayment / reapertura de bandeja", () => {
  const member = { id: 1, category: "active", status: "active", joinedAt: civilDateUtc(2020, 1, 1), memberships: [] };
  const paidAt = new Date("2026-09-10T11:15:30Z");

  it("reembolso: Payment.refunded, recibo anulado sin actor con el motivo, cuotas a pendiente, bandeja reabierta", async () => {
    const { db, state } = fakeDb({ member, fees: [{ id: 1, memberId: 1, period: "2025-11", status: "pending", origin: "import", paymentId: null }] });
    const svc = makeTreasuryService({ db: db as never, feeValues: feeValues(6000, 3000), now: () => new Date("2026-09-12T12:00:00Z"), renderPdf: async () => new Uint8Array(), writePdf: async () => {} });
    await svc.registerPayment({ memberId: 1, type: "debit", n: 1, amount: 6000, paidAt, mpPaymentId: "777", actorId: null });
    const r = await svc.refundPayment({ mpPaymentId: "777", reason: "Reembolso en Mercado Pago" });
    expect(r).toMatchObject({ kind: "refunded", paymentId: 1, periodsReverted: 1 });
    expect(state.payments[0].status).toBe("refunded");
    expect(state.receipts[0]).toMatchObject({ voidReason: "Reembolso en Mercado Pago", voidedById: null, voidedAt: expect.any(Date) });
    expect(state.fees[0]).toMatchObject({ status: "pending", paymentId: null });
    expect(db.mpUnmatchedPayment.updateMany).toHaveBeenLastCalledWith({
      where: { paymentId: 1 }, data: { status: "open", paymentId: null, resolvedAt: null, resolvedById: null },
    });
  });
  it("reembolso de un pago desconocido → not_found; dos veces → already_reverted", async () => {
    const { db } = fakeDb({ member, fees: [] });
    const svc = makeTreasuryService({ db: db as never, feeValues: feeValues(6000, 3000), renderPdf: async () => new Uint8Array(), writePdf: async () => {} });
    expect(await svc.refundPayment({ mpPaymentId: "nope", reason: "x" })).toEqual({ kind: "not_found" });
    await svc.registerPayment({ memberId: 1, type: "debit", n: 1, amount: 6000, paidAt, mpPaymentId: "1", actorId: null });
    await svc.refundPayment({ mpPaymentId: "1", reason: "x" });
    expect(await svc.refundPayment({ mpPaymentId: "1", reason: "x" })).toEqual({ kind: "already_reverted", status: "refunded" });
  });
  it("voidReceipt también reabre la bandeja", async () => {
    const { db } = fakeDb({ member, fees: [] });
    const svc = makeTreasuryService({ db: db as never, feeValues: feeValues(6000, 3000), renderPdf: async () => new Uint8Array(), writePdf: async () => {} });
    const r = await svc.registerPayment({ memberId: 1, type: "link", n: 1, amount: 6000, paidAt, mpPaymentId: "2", actorId: 5 });
    if (r.kind !== "registered") throw new Error();
    await svc.voidReceipt({ receiptId: r.receiptId, actorId: 5, reason: "error de carga" });
    expect(db.mpUnmatchedPayment.updateMany).toHaveBeenLastCalledWith({
      where: { paymentId: r.paymentId }, data: { status: "open", paymentId: null, resolvedAt: null, resolvedById: null },
    });
  });
});
```

El fake de `receipt.findUnique` tiene que devolver también `payment.status` y `payment.mpPaymentId` (ya expande `...payment`, así que los trae). Agregar `receipt.findFirst` al fake: `findFirst: vi.fn(async (args: { where: { payment: { mpPaymentId: string } } }) => { const p = state.payments.find((x) => x.mpPaymentId === args.where.payment.mpPaymentId); const r = p && state.receipts.find((x) => x.paymentId === p.id); return r ? { ...r, payment: { ...p, fees: state.fees.filter((f) => f.paymentId === p.id) } } : null; })`.

- [ ] **Step 2: Ver fallar**

Run: `npx vitest run tests/treasury-service.test.ts -t "refundPayment"` → FAIL.

- [ ] **Step 3: Extraer el cuerpo de la anulación**

En `service.ts`, reemplazar `voidReceipt` por un núcleo compartido y dos métodos:

```ts
  async function revertCore(input: {
    receiptId: number; status: "voided" | "refunded"; actorId: number | null; reason: string;
  }): Promise<{ paymentId: number; number: string; periodsReverted: number }> {
    const at = now();
    const head = await db.receipt.findUnique({ where: { id: input.receiptId }, select: { payment: { select: { memberId: true } } } });
    if (!head) throw new TreasuryError("El recibo no existe.");
    const memberId = head.payment.memberId;
    return memberMutex.run(`member:${memberId ?? 0}`, async () => {
      const r = await db.receipt.findUnique({
        where: { id: input.receiptId },
        include: { payment: { include: { fees: { select: { id: true, period: true } } } } },
      });
      if (!r) throw new TreasuryError("El recibo no existe.");
      if (r.voidedAt) throw new TreasuryError("El recibo ya está anulado.");
      const { toPending, toDelete } = revertFees(r.payment.fees.map((f) => f.period), currentPeriod(at));
      let periodsReverted = 0;
      await db.$transaction(async (tx) => {
        if (memberId !== null && toPending.length > 0) {
          const reverted = await tx.fee.updateMany({
            where: { memberId, paymentId: r.payment.id, period: { in: toPending } },
            data: { status: "pending", paymentId: null },
          });
          periodsReverted += reverted.count;
        }
        if (toDelete.length > 0) {
          const ids = r.payment.fees.filter((f) => toDelete.includes(f.period)).map((f) => f.id);
          const deleted = await tx.fee.deleteMany({ where: { id: { in: ids }, paymentId: r.payment.id } });
          periodsReverted += deleted.count;
        }
        await tx.payment.update({ where: { id: r.payment.id }, data: { status: input.status } });
        await tx.receipt.update({ where: { id: r.id }, data: { voidedAt: at, voidReason: input.reason, voidedById: input.actorId } });
        // Regla de la bandeja (deuda anotada en 4A): una fila nunca apunta a un
        // pago anulado. Vuelve a `open` para que el operador la resuelva de nuevo.
        await tx.mpUnmatchedPayment.updateMany({
          where: { paymentId: r.payment.id },
          data: { status: "open", paymentId: null, resolvedAt: null, resolvedById: null },
        });
      });
      await writePdfBestEffort(r.id, r.pdfPath ?? receiptRelativePath(r.number));
      return { paymentId: r.payment.id, number: r.number, periodsReverted };
    });
  }
```

(Conservar los comentarios largos de la versión anterior sobre la guarda de `paymentId` y la relectura dentro del mutex: son la justificación y siguen valiendo.)

```ts
    async voidReceipt(input: { receiptId: number; actorId: number; reason: string }) {
      return revertCore({ ...input, status: "voided" });
    },

    async refundPayment(input: { mpPaymentId: string; reason: string }) {
      const r = await db.receipt.findFirst({
        where: { payment: { mpPaymentId: input.mpPaymentId } },
        select: { id: true, payment: { select: { status: true } } },
      });
      if (!r) return { kind: "not_found" as const };
      if (r.payment.status !== "applied") return { kind: "already_reverted" as const, status: r.payment.status as "refunded" | "voided" };
      const done = await revertCore({ receiptId: r.id, status: "refunded", actorId: null, reason: input.reason });
      return { kind: "refunded" as const, ...done };
    },
```

- [ ] **Step 4: Tests, suite, commit**

Run: `npx vitest run tests/treasury-service.test.ts && npm test 2>&1 | tail -3 && npx tsc --noEmit`

```bash
git add src/lib/treasury/service.ts tests/treasury-service.test.ts
git commit -m "feat(m4b): refundPayment shares the void core; voiding reopens inbox rows

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Referencias, resolución pura y bandeja

**Files:**
- Create: `src/lib/mp/references.ts`, `src/lib/mp/resolve.ts`, `src/lib/mp/unmatched.ts`
- Create: `tests/mp-references.test.ts`, `tests/mp-resolve.test.ts`, `tests/mp-unmatched.test.ts`

**Interfaces:**
- Produces:

```ts
// references.ts
export const APPLICATION_REF = /^solicitud:(\d+)$/;
export const PAYMENT_LINK_REF = /^pago:(\d+):(\d+)$/;
export const MAX_LINK_FEES = 60;
export function applicationReference(applicationId: number): string;          // "solicitud:9"
export function parseApplicationReference(ref: string | null | undefined): number | null;
export function paymentLinkReference(memberId: number, n: number): string;    // "pago:14:2"
export function parsePaymentLinkReference(ref: string | null | undefined): { memberId: number; n: number } | null;

// resolve.ts
export type MpPaymentFacts = { mpPaymentId: string; preapprovalId: string | null; externalReference: string | null };
export type ResolveContext = {
  existingPayment: { id: number } | null;
  subscription: { memberId: number | null; applicationId: number | null } | null;      // por preapprovalId
  subscriptionByReference: { memberId: number | null } | null;                          // por externalReference (solicitud:)
  application: { id: number; mpPaymentIdEntry: string | null; memberId: number | null } | null;
  linkMember: { id: number } | null;                                                   // socio de pago:{id}:{n}
};
export type Decision =
  | { kind: "already_processed"; paymentId: number | null; result: "already_processed" | "entry_already_recorded" }
  | { kind: "debit"; memberId: number; preapprovalId: string | null }
  | { kind: "link"; memberId: number; n: number }
  | { kind: "entry"; applicationId: number }
  | { kind: "unmatched"; reason: UnmatchedReason };
export function resolveMpPayment(facts: MpPaymentFacts, ctx: ResolveContext): Decision;

// unmatched.ts
export const UNMATCHED_REASONS = ["no_reference", "no_subscription", "application_missing", "duplicate_entry", "withdrawn_no_pending"] as const;
export type UnmatchedReason = (typeof UNMATCHED_REASONS)[number];
export function makeUnmatchedInbox(db: Pick<PrismaClient, "mpUnmatchedPayment">): {
  record(input: { mpPaymentId: string; amount: number; paidAt: Date; payerEmail: string | null; externalReference: string | null; description: string | null; preapprovalId: string | null; reason: UnmatchedReason }): Promise<"recorded" | "exists">;
  openRowsForSubscription(input: { preapprovalId: string; externalReference: string | null }): Promise<Array<{ id: number; mpPaymentId: string; amount: number; paidAt: Date }>>;
};
```

- [ ] **Step 1: Tests de referencias (`tests/mp-references.test.ts`)**

```ts
import { describe, expect, it } from "vitest";
import {
  applicationReference, parseApplicationReference, parsePaymentLinkReference, paymentLinkReference,
} from "@/lib/mp/references";

describe("referencias de MP", () => {
  it("solicitud:{id} ida y vuelta", () => {
    expect(applicationReference(9)).toBe("solicitud:9");
    expect(parseApplicationReference("solicitud:9")).toBe(9);
    expect(parseApplicationReference("solicitud:x")).toBeNull();
    expect(parseApplicationReference(null)).toBeNull();
  });
  it("pago:{memberId}:{n} ida y vuelta, n entre 1 y 60", () => {
    expect(paymentLinkReference(14, 2)).toBe("pago:14:2");
    expect(parsePaymentLinkReference("pago:14:2")).toEqual({ memberId: 14, n: 2 });
    expect(parsePaymentLinkReference("pago:14:0")).toBeNull();
    expect(parsePaymentLinkReference("pago:14:61")).toBeNull();
    expect(parsePaymentLinkReference("pago:0:1")).toBeNull();
    expect(parsePaymentLinkReference("pago:14")).toBeNull();
    expect(parsePaymentLinkReference(undefined)).toBeNull();
  });
  it("armar con valores fuera de rango tira", () => {
    expect(() => paymentLinkReference(14, 0)).toThrow();
    expect(() => paymentLinkReference(14, 61)).toThrow();
  });
});
```

- [ ] **Step 2: Implementar `src/lib/mp/references.ts`**

```ts
// Las DOS formas de `external_reference` que SIGeV escribe y lee (spec 4B §5):
//   solicitud:{id}      preapproval del wizard (M3)
//   pago:{memberId}:{n} preferencia de Checkout Pro que aplica `n` cuotas (4B)
// Un solo lugar para parsear: el webhook, la conciliación y la bandeja leen lo
// mismo, y un formato nuevo se agrega acá y no en tres regex repartidas.
export const APPLICATION_REF = /^solicitud:(\d+)$/;
export const PAYMENT_LINK_REF = /^pago:(\d+):(\d+)$/;
/** Tope de cuotas por link: el mismo techo que un pago en efectivo. */
export const MAX_LINK_FEES = 60;

export function applicationReference(applicationId: number): string {
  return `solicitud:${applicationId}`;
}

export function parseApplicationReference(ref: string | null | undefined): number | null {
  const m = ref?.match(APPLICATION_REF);
  return m ? Number(m[1]) : null;
}

export function paymentLinkReference(memberId: number, n: number): string {
  if (!Number.isInteger(memberId) || memberId <= 0) throw new Error("memberId inválido");
  if (!Number.isInteger(n) || n < 1 || n > MAX_LINK_FEES) throw new Error("n fuera de rango");
  return `pago:${memberId}:${n}`;
}

export function parsePaymentLinkReference(ref: string | null | undefined): { memberId: number; n: number } | null {
  const m = ref?.match(PAYMENT_LINK_REF);
  if (!m) return null;
  const memberId = Number(m[1]);
  const n = Number(m[2]);
  if (memberId <= 0 || n < 1 || n > MAX_LINK_FEES) return null;
  return { memberId, n };
}
```

- [ ] **Step 3: Tests de resolución (`tests/mp-resolve.test.ts`)** — la tabla de §5 de la spec, un caso por fila

```ts
import { describe, expect, it } from "vitest";
import { resolveMpPayment, type ResolveContext } from "@/lib/mp/resolve";

const empty: ResolveContext = { existingPayment: null, subscription: null, subscriptionByReference: null, application: null, linkMember: null };
const facts = (over: Partial<{ preapprovalId: string | null; externalReference: string | null }> = {}) =>
  ({ mpPaymentId: "777", preapprovalId: null, externalReference: null, ...over });

describe("resolveMpPayment", () => {
  it("1. ya asentado → already_processed", () => {
    expect(resolveMpPayment(facts({ preapprovalId: "pre-1" }), { ...empty, existingPayment: { id: 3 }, subscription: { memberId: 14, applicationId: null } }))
      .toEqual({ kind: "already_processed", paymentId: 3, result: "already_processed" });
  });
  it("2. suscripción con socio → débito, aunque la referencia apunte a una solicitud borrada (caso 306)", () => {
    expect(resolveMpPayment(facts({ preapprovalId: "pre-1", externalReference: "solicitud:9" }), { ...empty, subscription: { memberId: 306, applicationId: null } }))
      .toEqual({ kind: "debit", memberId: 306, preapprovalId: "pre-1" });
  });
  it("3a. suscripción sin socio, solicitud sin ingreso cobrado → entry", () => {
    expect(resolveMpPayment(facts({ preapprovalId: "pre-1", externalReference: "solicitud:9" }), {
      ...empty, subscription: { memberId: null, applicationId: 9 }, application: { id: 9, mpPaymentIdEntry: null, memberId: null },
    })).toEqual({ kind: "entry", applicationId: 9 });
  });
  it("3b. suscripción sin socio, solicitud YA con otro ingreso → bandeja duplicate_entry", () => {
    expect(resolveMpPayment(facts({ preapprovalId: "pre-1", externalReference: "solicitud:9" }), {
      ...empty, subscription: { memberId: null, applicationId: 9 }, application: { id: 9, mpPaymentIdEntry: "111", memberId: null },
    })).toEqual({ kind: "unmatched", reason: "duplicate_entry" });
  });
  it("3c. el ingreso ya registrado en la solicitud con ESTE id (pre-4B) → entry_already_recorded", () => {
    expect(resolveMpPayment(facts({ externalReference: "solicitud:9" }), { ...empty, application: { id: 9, mpPaymentIdEntry: "777", memberId: 306 } }))
      .toEqual({ kind: "already_processed", paymentId: null, result: "entry_already_recorded" });
  });
  it("4. pago:{memberId}:{n} con socio existente → link n cuotas; socio inexistente → bandeja no_reference", () => {
    expect(resolveMpPayment(facts({ externalReference: "pago:14:2" }), { ...empty, linkMember: { id: 14 } })).toEqual({ kind: "link", memberId: 14, n: 2 });
    expect(resolveMpPayment(facts({ externalReference: "pago:14:2" }), empty)).toEqual({ kind: "unmatched", reason: "no_reference" });
  });
  it("5. solicitud viva sin ingreso, sin suscripción local → entry", () => {
    expect(resolveMpPayment(facts({ externalReference: "solicitud:9" }), { ...empty, application: { id: 9, mpPaymentIdEntry: null, memberId: null } }))
      .toEqual({ kind: "entry", applicationId: 9 });
  });
  it("6a. solicitud borrada pero suscripción con esa referencia y socio → débito", () => {
    expect(resolveMpPayment(facts({ externalReference: "solicitud:9" }), { ...empty, subscriptionByReference: { memberId: 306 } }))
      .toEqual({ kind: "debit", memberId: 306, preapprovalId: null });
  });
  it("6b. solicitud borrada y nada más → bandeja application_missing", () => {
    expect(resolveMpPayment(facts({ externalReference: "solicitud:9" }), empty)).toEqual({ kind: "unmatched", reason: "application_missing" });
  });
  it("6c. solicitud con ingreso de OTRO id y socio ya asentado, sin suscripción → débito del socio", () => {
    expect(resolveMpPayment(facts({ externalReference: "solicitud:9" }), { ...empty, application: { id: 9, mpPaymentIdEntry: "111", memberId: 306 } }))
      .toEqual({ kind: "debit", memberId: 306, preapprovalId: null });
  });
  it("7. preapproval sin suscripción local → bandeja no_subscription", () => {
    expect(resolveMpPayment(facts({ preapprovalId: "pre-x" }), empty)).toEqual({ kind: "unmatched", reason: "no_subscription" });
  });
  it("8. sin nada → bandeja no_reference", () => {
    expect(resolveMpPayment(facts(), empty)).toEqual({ kind: "unmatched", reason: "no_reference" });
  });
});
```

- [ ] **Step 4: Implementar `src/lib/mp/resolve.ts`**

```ts
// A quién pertenece un pago de Mercado Pago (spec 4B §5). Función PURA sobre
// datos que el llamador ya cargó: se prueba con una tabla de casos sin Prisma.
//
// La suscripción manda sobre la referencia (filas 2 y 3 antes que 4–6): el
// `preapprovalId` es el dato más confiable y resuelve los dos casos reales —
// la suscripción de Mariano sin referencia útil, y la de Martín con
// `solicitud:9` apuntando a una solicitud que ya no existe.
import { parseApplicationReference, parsePaymentLinkReference } from "./references";
import type { UnmatchedReason } from "./unmatched";

export type MpPaymentFacts = { mpPaymentId: string; preapprovalId: string | null; externalReference: string | null };

export type ResolveContext = {
  /** `Payment` con este `mpPaymentId`, si ya se asentó. */
  existingPayment: { id: number } | null;
  /** `MpSubscription` por `preapprovalId`. */
  subscription: { memberId: number | null; applicationId: number | null } | null;
  /** `MpSubscription` por `externalReference` (sólo si la referencia es `solicitud:`). */
  subscriptionByReference: { memberId: number | null } | null;
  /** `Application` de `solicitud:{id}`, si existe. */
  application: { id: number; mpPaymentIdEntry: string | null; memberId: number | null } | null;
  /** `Member` de `pago:{memberId}:{n}`, si existe. */
  linkMember: { id: number } | null;
};

export type Decision =
  | { kind: "already_processed"; paymentId: number | null; result: "already_processed" | "entry_already_recorded" }
  | { kind: "debit"; memberId: number; preapprovalId: string | null }
  | { kind: "link"; memberId: number; n: number }
  | { kind: "entry"; applicationId: number }
  | { kind: "unmatched"; reason: UnmatchedReason };

export function resolveMpPayment(facts: MpPaymentFacts, ctx: ResolveContext): Decision {
  // 1. Ya asentado.
  if (ctx.existingPayment) return { kind: "already_processed", paymentId: ctx.existingPayment.id, result: "already_processed" };

  // 2–3. Por suscripción.
  if (facts.preapprovalId && ctx.subscription) {
    if (ctx.subscription.memberId !== null) {
      return { kind: "debit", memberId: ctx.subscription.memberId, preapprovalId: facts.preapprovalId };
    }
    // Suscripción del wizard sin acta todavía: es el ingreso o un segundo cobro.
    if (ctx.application) {
      if (ctx.application.mpPaymentIdEntry === null) return { kind: "entry", applicationId: ctx.application.id };
      if (ctx.application.mpPaymentIdEntry === facts.mpPaymentId) {
        return { kind: "already_processed", paymentId: null, result: "entry_already_recorded" };
      }
      return { kind: "unmatched", reason: "duplicate_entry" };
    }
  }

  // 4. Link de pago.
  const link = parsePaymentLinkReference(facts.externalReference);
  if (link) {
    return ctx.linkMember ? { kind: "link", memberId: ctx.linkMember.id, n: link.n } : { kind: "unmatched", reason: "no_reference" };
  }

  // 5–6. Referencia a una solicitud.
  const applicationId = parseApplicationReference(facts.externalReference);
  if (applicationId !== null) {
    if (ctx.application) {
      if (ctx.application.mpPaymentIdEntry === null) return { kind: "entry", applicationId: ctx.application.id };
      if (ctx.application.mpPaymentIdEntry === facts.mpPaymentId) {
        return { kind: "already_processed", paymentId: null, result: "entry_already_recorded" };
      }
      // Ingreso ya cobrado con otro id: es un débito recurrente del socio asentado.
      if (ctx.application.memberId !== null) return { kind: "debit", memberId: ctx.application.memberId, preapprovalId: facts.preapprovalId };
      return { kind: "unmatched", reason: "duplicate_entry" };
    }
    if (ctx.subscriptionByReference?.memberId != null) {
      return { kind: "debit", memberId: ctx.subscriptionByReference.memberId, preapprovalId: facts.preapprovalId };
    }
    return { kind: "unmatched", reason: "application_missing" };
  }

  // 7. Suscripción que no conocemos.
  if (facts.preapprovalId) return { kind: "unmatched", reason: "no_subscription" };

  // 8. Nada.
  return { kind: "unmatched", reason: "no_reference" };
}
```

- [ ] **Step 5: Tests de la bandeja (`tests/mp-unmatched.test.ts`)**

```ts
import { describe, expect, it, vi } from "vitest";
import { makeUnmatchedInbox, UNMATCHED_REASONS } from "@/lib/mp/unmatched";

function db() {
  return {
    mpUnmatchedPayment: {
      create: vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: 1, ...args.data })),
      findMany: vi.fn(async () => [{ id: 1, mpPaymentId: "777", amount: "3000.00", paidAt: new Date("2026-09-10T11:00:00Z") }]),
    },
  };
}

describe("unmatched inbox", () => {
  it("record escribe la fila con motivo y preapproval; el monto va con dos decimales", async () => {
    const d = db();
    const inbox = makeUnmatchedInbox(d as never);
    const r = await inbox.record({ mpPaymentId: "777", amount: 3000, paidAt: new Date("2026-09-10T11:00:00Z"), payerEmail: "v@x.com", externalReference: null, description: "Cuota", preapprovalId: "pre-1", reason: "no_subscription" });
    expect(r).toBe("recorded");
    expect(d.mpUnmatchedPayment.create.mock.calls[0][0].data).toMatchObject({ mpPaymentId: "777", amount: "3000.00", preapprovalId: "pre-1", reason: "no_subscription", payerEmail: "v@x.com" });
  });
  it("una fila que ya existe (P2002) no es error: exists", async () => {
    const d = db();
    d.mpUnmatchedPayment.create.mockRejectedValueOnce(Object.assign(new Error("dup"), { code: "P2002" }));
    const inbox = makeUnmatchedInbox(d as never);
    expect(await inbox.record({ mpPaymentId: "777", amount: 1, paidAt: new Date(), payerEmail: null, externalReference: null, description: null, preapprovalId: null, reason: "no_reference" })).toBe("exists");
  });
  it("otro error sí se propaga (fallo técnico)", async () => {
    const d = db();
    d.mpUnmatchedPayment.create.mockRejectedValueOnce(new Error("db down"));
    await expect(makeUnmatchedInbox(d as never).record({ mpPaymentId: "1", amount: 1, paidAt: new Date(), payerEmail: null, externalReference: null, description: null, preapprovalId: null, reason: "no_reference" })).rejects.toThrow("db down");
  });
  it("openRowsForSubscription busca abiertas por preapproval O por referencia", async () => {
    const d = db();
    const rows = await makeUnmatchedInbox(d as never).openRowsForSubscription({ preapprovalId: "pre-1", externalReference: "solicitud:9" });
    expect(rows[0]).toMatchObject({ mpPaymentId: "777", amount: 3000 });
    expect(d.mpUnmatchedPayment.findMany.mock.calls[0][0].where).toEqual({
      status: "open", OR: [{ preapprovalId: "pre-1" }, { externalReference: "solicitud:9" }],
    });
  });
  it("sin referencia, sólo por preapproval", async () => {
    const d = db();
    await makeUnmatchedInbox(d as never).openRowsForSubscription({ preapprovalId: "pre-1", externalReference: null });
    expect(d.mpUnmatchedPayment.findMany.mock.calls[0][0].where).toEqual({ status: "open", OR: [{ preapprovalId: "pre-1" }] });
  });
  it("los motivos son exactamente los de la spec", () => {
    expect([...UNMATCHED_REASONS]).toEqual(["no_reference", "no_subscription", "application_missing", "duplicate_entry", "withdrawn_no_pending"]);
  });
});
```

- [ ] **Step 6: Implementar `src/lib/mp/unmatched.ts`**

```ts
// Bandeja sin conciliar (spec 4B §7): lo que llegó de MP y no se pudo aplicar.
// Prisma inyectado. `payerEmail` y `description` son datos personales: van a la
// fila (la lee sólo el admin) y nunca a la auditoría ni al log.
import type { PrismaClient } from "@/generated/prisma/client";

export const UNMATCHED_REASONS = [
  "no_reference",         // sin referencia ni suscripción conocida
  "no_subscription",      // cobro de una suscripción que SIGeV no tiene vinculada
  "application_missing",  // `solicitud:{id}` de una solicitud que ya no existe
  "duplicate_entry",      // segundo cobro de una solicitud sin acta todavía
  "withdrawn_no_pending", // débito de un cesante sin cuotas pendientes
] as const;
export type UnmatchedReason = (typeof UNMATCHED_REASONS)[number];

export type UnmatchedInput = {
  mpPaymentId: string;
  amount: number;
  paidAt: Date;
  payerEmail: string | null;
  externalReference: string | null;
  description: string | null;
  preapprovalId: string | null;
  reason: UnmatchedReason;
};

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2002";
}

export function makeUnmatchedInbox(db: Pick<PrismaClient, "mpUnmatchedPayment">) {
  return {
    /** Deja la fila. Si ya estaba (mismo cobro llegando por dos eventos), no es
     *  un error: la bandeja dice lo mismo que antes. */
    async record(input: UnmatchedInput): Promise<"recorded" | "exists"> {
      try {
        await db.mpUnmatchedPayment.create({
          data: {
            mpPaymentId: input.mpPaymentId,
            amount: input.amount.toFixed(2),
            paidAt: input.paidAt,
            payerEmail: input.payerEmail,
            externalReference: input.externalReference?.slice(0, 128) ?? null,
            description: input.description?.slice(0, 200) ?? null,
            preapprovalId: input.preapprovalId,
            reason: input.reason,
          },
        });
        return "recorded";
      } catch (e) {
        if (isUniqueViolation(e)) return "exists";
        throw e;
      }
    },

    /** Las filas abiertas que esperaban a esta suscripción: por su preapproval
     *  o por su referencia (una fila `application_missing` puede no traer el
     *  preapproval). La vinculación las aplica. */
    async openRowsForSubscription(input: { preapprovalId: string; externalReference: string | null }) {
      const or: Array<{ preapprovalId: string } | { externalReference: string }> = [{ preapprovalId: input.preapprovalId }];
      if (input.externalReference) or.push({ externalReference: input.externalReference });
      const rows = await db.mpUnmatchedPayment.findMany({
        where: { status: "open", OR: or },
        select: { id: true, mpPaymentId: true, amount: true, paidAt: true },
        orderBy: { paidAt: "asc" },
      });
      return rows.map((r) => ({ id: r.id, mpPaymentId: r.mpPaymentId, amount: Number(r.amount), paidAt: r.paidAt }));
    },
  };
}
```

- [ ] **Step 7: Correr los tres tests y commit**

Run: `npx vitest run tests/mp-references.test.ts tests/mp-resolve.test.ts tests/mp-unmatched.test.ts && npx tsc --noEmit`

```bash
git add src/lib/mp/references.ts src/lib/mp/resolve.ts src/lib/mp/unmatched.ts tests/mp-references.test.ts tests/mp-resolve.test.ts tests/mp-unmatched.test.ts
git commit -m "feat(m4b): MP references, pure payment resolution table and unmatched inbox writer

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Webhook que aplica

**Files:**
- Modify: `src/lib/mp/webhook-processor.ts` (reescritura)
- Modify: `src/lib/treasury/service.ts` (exportar `TreasuryService`)
- Modify: `src/lib/treasury/receipt-email.ts` (recibo a una solicitud)
- Modify: `src/lib/applications/record.ts` (~205-208)
- Modify: `tests/mp-webhook-processor.test.ts` (reescritura), `tests/treasury-receipt-email.test.ts`, `tests/application-record.test.ts`
- Sin cambios: `src/app/api/webhooks/mp/route.ts` y `tests/mp-webhook-route.test.ts` (el contrato `process({topic,dataId}) → string` se mantiene).

**Interfaces:**
- Consumes: `MpGateway` (Task 2), `treasuryService.registerPayment/refundPayment` (Tasks 3-4), `resolveMpPayment`, `makeUnmatchedInbox` (Task 5), `sendReceiptEmail`.
- Produces:

```ts
type Deps = {
  db: Pick<PrismaClient, "application" | "mpSubscription" | "payment" | "member" | "mpUnmatchedPayment">;
  gateway: Pick<MpGateway, "getPayment" | "getPreapproval" | "getAuthorizedPayment">;
  treasury: Pick<TreasuryService, "registerPayment" | "refundPayment">;
  unmatched: Pick<ReturnType<typeof makeUnmatchedInbox>, "record">;
  feeValues: Pick<ReturnType<typeof makeFeeValueReader>, "current">;
  mailer: Pick<typeof mailer, "sendToApplication">;
  sendReceiptEmail: (receiptId: number) => Promise<ReceiptEmailResult>;
  audit: typeof audit;
  auditStrict: typeof auditStrict;
  now?: () => Date;
};
export function makeWebhookProcessor(deps: Deps): {
  process(input: WebhookInput): Promise<string>;
  /** Aplica un pago ya leído de MP. Lo usa también el cron de conciliación. */
  applyPayment(payment: MpPaymentDetails, preapprovalId: string | null): Promise<string>;
};
export const REFUND_REASON = "Reembolso en Mercado Pago";
```
- Results posibles de `applyPayment` (≤ 64 chars): `already_processed`, `entry_already_recorded`, `debit_applied`, `link_applied`, `application_approved`, `application_approved_after_expiry`, `payment_refunded`, `refund_ignored`, `payment_rejected_traced`, `payment_ignored`, `unmatched_no_reference`, `unmatched_no_subscription`, `unmatched_application_missing`, `unmatched_duplicate_entry`, `unmatched_withdrawn_no_pending`.
- `process` con `subscription_authorized_payment` devuelve además `authorized_payment_traced` (sin `paymentId` o no `processed`).
- Asientos nuevos: `payment_applied` (`{ paymentId, memberId|applicationId, type, amount, mpPaymentId, receiptId, emailed }`), `payment_refunded`, `link_amount_mismatch` (`{ paymentId, memberId, n, expected, amount }`), `payment_unmatched` (`{ mpPaymentId, reason, amount }`).
- `service.ts`: `export type TreasuryService = ReturnType<typeof makeTreasuryService>;`

- [ ] **Step 1: Reescribir `tests/mp-webhook-processor.test.ts`**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/email", () => ({ mailer: {} }));
vi.mock("@/lib/treasury/service", () => ({ treasuryService: {} }));
vi.mock("@/lib/treasury/receipt-email", () => ({ sendReceiptEmail: vi.fn() }));
vi.mock("@/lib/treasury/fee-values", () => ({ feeValueReader: {} }));

import { makeWebhookProcessor } from "@/lib/mp/webhook-processor";

type PaymentOver = Partial<{ status: string; externalReference: string | null; transactionAmount: number; dateApproved: Date | null; payerEmail: string | null }>;

function deps(over: {
  payment?: PaymentOver;
  subscription?: { memberId: number | null; applicationId: number | null } | null;
  subscriptionByRef?: { memberId: number | null } | null;
  application?: { id: number; status: string; fullName: string; email: string; mpPaymentIdEntry: string | null; memberId: number | null } | null;
  member?: { id: number; category: string } | null;
  existingPayment?: { id: number } | null;
} = {}) {
  const paidAt = new Date("2026-09-10T11:15:30Z");
  const payment = {
    id: "777", status: "approved", statusDetail: "accredited", transactionAmount: 6000,
    externalReference: null as string | null, dateApproved: paidAt as Date | null, payerEmail: "v@x.com", description: "Cuota", ...over.payment,
  };
  const application = {
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    findUnique: vi.fn().mockResolvedValue(over.application ?? null),
  };
  const mpSubscription = {
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    findUnique: vi.fn().mockResolvedValue(over.subscription === undefined ? null : over.subscription),
    findFirst: vi.fn().mockResolvedValue(over.subscriptionByRef ?? null),
  };
  const db = {
    application, mpSubscription,
    payment: { findUnique: vi.fn().mockResolvedValue(over.existingPayment ?? null) },
    member: { findUnique: vi.fn().mockResolvedValue(over.member === undefined ? { id: 14, category: "active" } : over.member) },
    mpUnmatchedPayment: {},
  };
  const gateway = {
    getPayment: vi.fn().mockResolvedValue(payment),
    getPreapproval: vi.fn().mockResolvedValue({ id: "pre-1", status: "authorized", payerEmail: "a@b.com", externalReference: "solicitud:55", amount: 6000, reason: "Cuota", nextPaymentDate: null, dateCreated: null }),
    getAuthorizedPayment: vi.fn().mockResolvedValue({ id: "9", preapprovalId: "pre-1", status: "processed", paymentId: "777", amount: 6000, dateCreated: paidAt, externalReference: null }),
  };
  const treasury = {
    registerPayment: vi.fn().mockResolvedValue({ kind: "registered", paymentId: 1, receiptId: 2, number: "2026-00002", periods: ["2026-09"], amount: 6000, pdfWritten: true }),
    refundPayment: vi.fn().mockResolvedValue({ kind: "refunded", paymentId: 1, number: "2026-00002", periodsReverted: 1 }),
  };
  const unmatched = { record: vi.fn().mockResolvedValue("recorded") };
  const feeValues = { current: vi.fn().mockResolvedValue({ activeAmount: 6000, sharedAmount: 3000 }) };
  const mailerMock = { sendToApplication: vi.fn().mockResolvedValue({ messageId: "m" }) };
  const sendReceiptEmail = vi.fn().mockResolvedValue({ sent: true });
  const auditMock = vi.fn(async () => {});
  const auditStrictMock = vi.fn(async () => {});
  const p = makeWebhookProcessor({
    db: db as never, gateway: gateway as never, treasury: treasury as never, unmatched: unmatched as never,
    feeValues: feeValues as never, mailer: mailerMock as never, sendReceiptEmail, audit: auditMock as never, auditStrict: auditStrictMock as never,
    now: () => new Date("2026-09-10T12:00:00Z"),
  });
  return { p, db, gateway, treasury, unmatched, mailerMock, sendReceiptEmail, auditMock, auditStrictMock, paidAt, payment };
}

beforeEach(() => vi.clearAllMocks());

describe("subscription_authorized_payment", () => {
  it("cobro procesado de una suscripción vinculada → Payment.debit + recibo + email + asiento", async () => {
    const d = deps({ subscription: { memberId: 14, applicationId: null } });
    await expect(d.p.process({ topic: "subscription_authorized_payment", dataId: "9" })).resolves.toBe("debit_applied");
    expect(d.gateway.getPayment).toHaveBeenCalledWith("777");
    expect(d.treasury.registerPayment).toHaveBeenCalledWith({
      memberId: 14, type: "debit", n: 1, amount: 6000, paidAt: d.paidAt, mpPaymentId: "777", preapprovalId: "pre-1", actorId: null,
    });
    expect(d.sendReceiptEmail).toHaveBeenCalledWith(2);
    expect(d.auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "payment_applied", entity: "payment", entityId: 1,
      detail: expect.objectContaining({ memberId: 14, type: "debit", amount: 6000, mpPaymentId: "777", emailed: "sent" }) }));
    // Nunca el email del pagador en el asiento.
    expect(JSON.stringify(d.auditMock.mock.calls)).not.toContain("v@x.com");
  });
  it("sin paymentId todavía → authorized_payment_traced, sin tocar nada", async () => {
    const d = deps();
    d.gateway.getAuthorizedPayment.mockResolvedValue({ id: "9", preapprovalId: "pre-1", status: "scheduled", paymentId: null, amount: null, dateCreated: null, externalReference: null });
    await expect(d.p.process({ topic: "subscription_authorized_payment", dataId: "9" })).resolves.toBe("authorized_payment_traced");
    expect(d.gateway.getPayment).not.toHaveBeenCalled();
  });
  it("suscripción no vinculada → bandeja no_subscription con el preapproval, asiento sin email", async () => {
    const d = deps({ subscription: null });
    await expect(d.p.process({ topic: "subscription_authorized_payment", dataId: "9" })).resolves.toBe("unmatched_no_subscription");
    expect(d.unmatched.record).toHaveBeenCalledWith(expect.objectContaining({ mpPaymentId: "777", preapprovalId: "pre-1", reason: "no_subscription", payerEmail: "v@x.com", amount: 6000 }));
    expect(d.auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "payment_unmatched", detail: { mpPaymentId: "777", reason: "no_subscription", amount: 6000 } }));
  });
  it("cesante sin pendientes → bandeja withdrawn_no_pending (nunca error)", async () => {
    const d = deps({ subscription: { memberId: 14, applicationId: null } });
    d.treasury.registerPayment.mockResolvedValue({ kind: "no_pending_withdrawn" });
    await expect(d.p.process({ topic: "subscription_authorized_payment", dataId: "9" })).resolves.toBe("unmatched_withdrawn_no_pending");
    expect(d.unmatched.record).toHaveBeenCalledWith(expect.objectContaining({ reason: "withdrawn_no_pending" }));
  });
  it("ya asentado (consulta previa) → already_processed sin registrar", async () => {
    const d = deps({ subscription: { memberId: 14, applicationId: null }, existingPayment: { id: 3 } });
    await expect(d.p.process({ topic: "subscription_authorized_payment", dataId: "9" })).resolves.toBe("already_processed");
    expect(d.treasury.registerPayment).not.toHaveBeenCalled();
  });
  it("el servicio devuelve already_processed (carrera) → already_processed, sin email", async () => {
    const d = deps({ subscription: { memberId: 14, applicationId: null } });
    d.treasury.registerPayment.mockResolvedValue({ kind: "already_processed", paymentId: 1 });
    await expect(d.p.process({ topic: "subscription_authorized_payment", dataId: "9" })).resolves.toBe("already_processed");
    expect(d.sendReceiptEmail).not.toHaveBeenCalled();
  });
  it("el email falla → el pago queda y el asiento dice emailed:error", async () => {
    const d = deps({ subscription: { memberId: 14, applicationId: null } });
    d.sendReceiptEmail.mockRejectedValue(Object.assign(new Error("smtp"), { code: "ECONN" }));
    await expect(d.p.process({ topic: "subscription_authorized_payment", dataId: "9" })).resolves.toBe("debit_applied");
    expect(d.auditMock).toHaveBeenCalledWith(expect.objectContaining({ detail: expect.objectContaining({ emailed: "error" }) }));
  });
  it("MP caído en getPayment → lanza (500, reintento)", async () => {
    const d = deps();
    d.gateway.getPayment.mockRejectedValue({ message: "timeout", status: 500 });
    await expect(d.p.process({ topic: "subscription_authorized_payment", dataId: "9" })).rejects.toBeTruthy();
  });
});

describe("payment", () => {
  it("caso 306: solicitud:9 borrada + suscripción con esa referencia → débito del socio", async () => {
    const d = deps({ payment: { externalReference: "solicitud:9" }, application: null, subscriptionByRef: { memberId: 306 } });
    await expect(d.p.process({ topic: "payment", dataId: "777" })).resolves.toBe("debit_applied");
    expect(d.db.mpSubscription.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { externalReference: "solicitud:9" } }));
    expect(d.treasury.registerPayment).toHaveBeenCalledWith(expect.objectContaining({ memberId: 306, type: "debit", n: 1, preapprovalId: null }));
  });
  it("solicitud:9 borrada y sin suscripción → bandeja application_missing", async () => {
    const d = deps({ payment: { externalReference: "solicitud:9" }, application: null });
    await expect(d.p.process({ topic: "payment", dataId: "777" })).resolves.toBe("unmatched_application_missing");
  });
  it("pago:14:2 → link de 2 cuotas; monto distinto al esperado → se aplica y se audita link_amount_mismatch", async () => {
    const d = deps({ payment: { externalReference: "pago:14:2", transactionAmount: 11000 } });
    await expect(d.p.process({ topic: "payment", dataId: "777" })).resolves.toBe("link_applied");
    expect(d.treasury.registerPayment).toHaveBeenCalledWith(expect.objectContaining({ memberId: 14, type: "link", n: 2, amount: 11000 }));
    expect(d.auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "link_amount_mismatch", detail: { paymentId: 1, memberId: 14, n: 2, expected: 12000, amount: 11000 } }));
  });
  it("pago:14:2 con el monto justo → sin asiento de divergencia", async () => {
    const d = deps({ payment: { externalReference: "pago:14:2", transactionAmount: 12000 } });
    await d.p.process({ topic: "payment", dataId: "777" });
    expect(d.auditMock.mock.calls.map((c) => (c[0] as { action: string }).action)).not.toContain("link_amount_mismatch");
  });
  it("ingreso: solicitud pendiente sin pago → transición + Payment.entry + recibo a la solicitud + bienvenida", async () => {
    const d = deps({ payment: { externalReference: "solicitud:55" }, application: { id: 55, status: "pending_payment", fullName: "Ana", email: "a@b.com", mpPaymentIdEntry: null, memberId: null } });
    await expect(d.p.process({ topic: "payment", dataId: "777" })).resolves.toBe("application_approved");
    const upd = d.db.application.updateMany.mock.calls[0][0];
    expect(upd.where).toMatchObject({ id: 55, status: "pending_payment" });
    expect(upd.data).toMatchObject({ status: "approved_pending_minute", mpPaymentIdEntry: "777" });
    expect(d.treasury.registerPayment).toHaveBeenCalledWith(expect.objectContaining({ memberId: null, applicationId: 55, type: "entry", n: 0, amount: 6000, mpPaymentId: "777" }));
    expect(d.sendReceiptEmail).toHaveBeenCalledWith(2);
    expect(d.mailerMock.sendToApplication).toHaveBeenCalledTimes(1);
  });
  it("ingreso sobre solicitud VENCIDA → revive, asiento estricto, result distinguible", async () => {
    const d = deps({ payment: { externalReference: "solicitud:55" }, application: { id: 55, status: "expired", fullName: "Ana", email: "a@b.com", mpPaymentIdEntry: null, memberId: null } });
    d.db.application.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
    await expect(d.p.process({ topic: "payment", dataId: "777" })).resolves.toBe("application_approved_after_expiry");
    expect(d.auditStrictMock).toHaveBeenCalledWith(expect.objectContaining({ entity: "application", entityId: 55 }));
  });
  it("reintento del ingreso (mpPaymentIdEntry igual a este id) → entry_already_recorded sin email", async () => {
    const d = deps({ payment: { externalReference: "solicitud:55" }, application: { id: 55, status: "approved_pending_minute", fullName: "Ana", email: "a@b.com", mpPaymentIdEntry: "777", memberId: null } });
    await expect(d.p.process({ topic: "payment", dataId: "777" })).resolves.toBe("entry_already_recorded");
    expect(d.mailerMock.sendToApplication).not.toHaveBeenCalled();
    expect(d.treasury.registerPayment).not.toHaveBeenCalled();
  });
  it("segundo cobro de una solicitud sin acta → bandeja duplicate_entry", async () => {
    const d = deps({ payment: { externalReference: "solicitud:55" }, application: { id: 55, status: "approved_pending_minute", fullName: "Ana", email: "a@b.com", mpPaymentIdEntry: "111", memberId: null } });
    await expect(d.p.process({ topic: "payment", dataId: "777" })).resolves.toBe("unmatched_duplicate_entry");
  });
  it("refunded con pago local → refundPayment + asiento payment_refunded", async () => {
    const d = deps({ payment: { status: "refunded" } });
    await expect(d.p.process({ topic: "payment", dataId: "777" })).resolves.toBe("payment_refunded");
    expect(d.treasury.refundPayment).toHaveBeenCalledWith({ mpPaymentId: "777", reason: "Reembolso en Mercado Pago" });
    expect(d.auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "payment_refunded", entity: "payment", entityId: 1 }));
  });
  it("charged_back sin pago local → refund_ignored", async () => {
    const d = deps({ payment: { status: "charged_back" } });
    d.treasury.refundPayment.mockResolvedValue({ kind: "not_found" });
    await expect(d.p.process({ topic: "payment", dataId: "777" })).resolves.toBe("refund_ignored");
  });
  it("rejected → payment_rejected_traced; in_process → payment_ignored", async () => {
    expect(await deps({ payment: { status: "rejected" } }).p.process({ topic: "payment", dataId: "777" })).toBe("payment_rejected_traced");
    expect(await deps({ payment: { status: "in_process" } }).p.process({ topic: "payment", dataId: "777" })).toBe("payment_ignored");
  });
  it("sin referencia ni suscripción → bandeja no_reference", async () => {
    const d = deps();
    await expect(d.p.process({ topic: "payment", dataId: "777" })).resolves.toBe("unmatched_no_reference");
  });
  it("approved sin dateApproved → paidAt = now()", async () => {
    const d = deps({ payment: { externalReference: "pago:14:1", dateApproved: null } });
    await d.p.process({ topic: "payment", dataId: "777" });
    expect(d.treasury.registerPayment).toHaveBeenCalledWith(expect.objectContaining({ paidAt: new Date("2026-09-10T12:00:00Z") }));
  });
  it("plural `payments` también", async () => {
    const d = deps({ payment: { externalReference: "pago:14:1" } });
    await expect(d.p.process({ topic: "payments", dataId: "777" })).resolves.toBe("link_applied");
  });
});

describe("subscription_preapproval", () => {
  it("sincroniza status, amount, payerEmail, externalReference y lastSyncAt", async () => {
    const d = deps();
    await expect(d.p.process({ topic: "subscription_preapproval", dataId: "pre-1" })).resolves.toBe("subscription_synced");
    expect(d.db.mpSubscription.updateMany).toHaveBeenCalledWith({
      where: { preapprovalId: "pre-1" },
      data: { status: "authorized", amount: "6000.00", payerEmail: "a@b.com", externalReference: "solicitud:55", lastSyncAt: expect.any(Date) },
    });
  });
  it("sin fila local → no_match", async () => {
    const d = deps();
    d.db.mpSubscription.updateMany.mockResolvedValue({ count: 0 });
    await expect(d.p.process({ topic: "subscription_preapproval", dataId: "pre-1" })).resolves.toBe("no_match");
  });
});

it("tópico desconocido → unknown_topic", async () => {
  await expect(deps().p.process({ topic: "merchant_order", dataId: "1" })).resolves.toBe("unknown_topic");
});
```

- [ ] **Step 2: Ver fallar**

Run: `npx vitest run tests/mp-webhook-processor.test.ts` → FAIL.

- [ ] **Step 3: Reescribir `src/lib/mp/webhook-processor.ts`**

```ts
// Procesamiento de webhooks de MP (docs/06 §4, spec 4B §6), inline y
// idempotente. El registro crudo y la respuesta HTTP viven en la ruta; acá
// sólo la reacción a cada tópico.
//
// PRINCIPIO: el procesador NUNCA falla por una regla de negocio. Un cesante sin
// cuotas, una referencia rota, un monto raro: todo termina en un `result`
// (aplicado / bandeja / ignorado). Lo único que lanza es un fallo TÉCNICO (MP o
// la base caídas), y la ruta lo convierte en 500 para que MP reintente. Si una
// regla de negocio lanzara, MP reintentaría para siempre un cobro que ya hizo.
import type { PrismaClient } from "@/generated/prisma/client";
import { Prisma } from "@/generated/prisma/client";
import { APPROVED_AFTER_EXPIRY_ACTION } from "@/lib/applications/query";
import { audit, auditStrict } from "@/lib/audit";
import { mailer } from "@/lib/email";
import { applicationAcceptedEmail } from "@/lib/email/templates";
import { createKeyedMutex } from "@/lib/keyed-mutex";
import { safeMessage } from "@/lib/log-safe";
import { prisma } from "@/lib/prisma";
import { feeValueReader, type makeFeeValueReader } from "@/lib/treasury/fee-values";
import { sendReceiptEmail as sendReceiptEmailDefault, type ReceiptEmailResult } from "@/lib/treasury/receipt-email";
import { feeAmountFor } from "@/lib/treasury/rules";
import { treasuryService, type TreasuryService } from "@/lib/treasury/service";
import { mpGateway, type MpGateway, type MpPaymentDetails } from "./gateway";
import { parseApplicationReference, parsePaymentLinkReference } from "./references";
import { resolveMpPayment, type Decision, type ResolveContext } from "./resolve";
import { makeUnmatchedInbox, type UnmatchedReason } from "./unmatched";

export type WebhookInput = { topic: string; dataId: string };

export const REFUND_REASON = "Reembolso en Mercado Pago";

type Deps = {
  db: Pick<PrismaClient, "application" | "mpSubscription" | "payment" | "member" | "mpUnmatchedPayment">;
  gateway: Pick<MpGateway, "getPayment" | "getPreapproval" | "getAuthorizedPayment">;
  treasury: Pick<TreasuryService, "registerPayment" | "refundPayment">;
  unmatched: Pick<ReturnType<typeof makeUnmatchedInbox>, "record">;
  feeValues: Pick<ReturnType<typeof makeFeeValueReader>, "current">;
  mailer: Pick<typeof mailer, "sendToApplication">;
  sendReceiptEmail: (receiptId: number) => Promise<ReceiptEmailResult>;
  audit: typeof audit;
  auditStrict: typeof auditStrict;
  now?: () => Date;
};

function codeOf(e: unknown): string {
  return typeof e === "object" && e !== null && "code" in e ? String((e as { code: unknown }).code) : "unknown";
}

// Los dos eventos del mismo cobro (`payment` y `subscription_authorized_payment`)
// llegan casi juntos: se serializan por id de pago para que no resuelvan y
// apliquen a la vez. El servicio tiene su propia barrera (unique + P2002), así
// que esto es para que el segundo vea `already_processed` y no una carrera.
const paymentMutex = createKeyedMutex();

export function makeWebhookProcessor(deps: Deps) {
  const now = deps.now ?? (() => new Date());

  async function loadContext(p: MpPaymentDetails, preapprovalId: string | null): Promise<ResolveContext> {
    const applicationId = parseApplicationReference(p.externalReference);
    const link = parsePaymentLinkReference(p.externalReference);
    const [existingPayment, subscription, subscriptionByReference, application, linkMember] = await Promise.all([
      deps.db.payment.findUnique({ where: { mpPaymentId: p.id }, select: { id: true } }),
      preapprovalId
        ? deps.db.mpSubscription.findUnique({ where: { preapprovalId }, select: { memberId: true, applicationId: true } })
        : Promise.resolve(null),
      applicationId !== null && p.externalReference
        ? deps.db.mpSubscription.findFirst({ where: { externalReference: p.externalReference }, select: { memberId: true } })
        : Promise.resolve(null),
      applicationId !== null
        ? deps.db.application.findUnique({ where: { id: applicationId }, select: { id: true, mpPaymentIdEntry: true, memberId: true } })
        : Promise.resolve(null),
      link ? deps.db.member.findUnique({ where: { id: link.memberId }, select: { id: true } }) : Promise.resolve(null),
    ]);
    return {
      existingPayment: existingPayment ?? null, subscription: subscription ?? null,
      subscriptionByReference: subscriptionByReference ?? null, application: application ?? null, linkMember: linkMember ?? null,
    };
  }

  async function toInbox(p: MpPaymentDetails, preapprovalId: string | null, reason: UnmatchedReason): Promise<string> {
    await deps.unmatched.record({
      mpPaymentId: p.id, amount: p.transactionAmount, paidAt: p.dateApproved ?? now(),
      payerEmail: p.payerEmail, externalReference: p.externalReference, description: p.description,
      preapprovalId, reason,
    });
    // Sin email ni descripción: ids, motivo y monto.
    await deps.audit({ action: "payment_unmatched", entity: "mp_payment", entityId: p.id, detail: { mpPaymentId: p.id, reason, amount: p.transactionAmount } });
    return `unmatched_${reason}`;
  }

  async function emailReceipt(receiptId: number): Promise<string> {
    try {
      const r = await deps.sendReceiptEmail(receiptId);
      return r.sent ? "sent" : r.reason;
    } catch (e) {
      console.error("[mp-webhook] sendReceiptEmail lanzó", receiptId, codeOf(e));
      return "error";
    }
  }

  async function applyToMember(p: MpPaymentDetails, d: Extract<Decision, { kind: "debit" | "link" }>): Promise<string> {
    const n = d.kind === "debit" ? 1 : d.n;
    const preapprovalId = d.kind === "debit" ? d.preapprovalId : null;
    const r = await deps.treasury.registerPayment({
      memberId: d.memberId, type: d.kind, n, amount: p.transactionAmount, paidAt: p.dateApproved ?? now(),
      mpPaymentId: p.id, preapprovalId, actorId: null,
    });
    if (r.kind === "already_processed") return "already_processed";
    if (r.kind === "no_pending_withdrawn") return toInbox(p, preapprovalId, "withdrawn_no_pending");
    const emailed = await emailReceipt(r.receiptId);
    await deps.audit({
      action: "payment_applied", entity: "payment", entityId: r.paymentId,
      detail: { paymentId: r.paymentId, memberId: d.memberId, type: d.kind, amount: r.amount, mpPaymentId: p.id, receiptId: r.receiptId, emailed },
    });
    if (d.kind === "link") {
      // El link se emitió por `n × valor vigente`; si MP cobró otra cosa, se
      // aplica igual (spec 4B §6) y queda asentado para que alguien lo mire.
      const [member, value] = await Promise.all([
        deps.db.member.findUnique({ where: { id: d.memberId }, select: { category: true } }),
        deps.feeValues.current(p.dateApproved ?? now()),
      ]);
      const unit = member && value ? feeAmountFor(member.category, value) : null;
      if (unit !== null && Math.abs(unit * n - p.transactionAmount) >= 0.01) {
        await deps.audit({ action: "link_amount_mismatch", entity: "payment", entityId: r.paymentId,
          detail: { paymentId: r.paymentId, memberId: d.memberId, n, expected: unit * n, amount: p.transactionAmount } });
      }
      return "link_applied";
    }
    return "debit_applied";
  }

  async function applyEntry(p: MpPaymentDetails, applicationId: number): Promise<string> {
    // UPDATE condicional por estado = idempotencia de la transición (M3). Dos
    // updates y no uno con `in`: el segundo afirma, sin leer antes, que la
    // solicitud estaba VENCIDA — dato que no se puede perder (ver abajo).
    const data = {
      status: "approved_pending_minute" as const,
      mpPaymentIdEntry: p.id,
      entryAmount: new Prisma.Decimal(p.transactionAmount.toFixed(2)),
    };
    const onTime = await deps.db.application.updateMany({ where: { id: applicationId, status: "pending_payment" }, data });
    const late = onTime.count === 0
      ? await deps.db.application.updateMany({ where: { id: applicationId, status: "expired" }, data })
      : { count: 0 };
    const revived = late.count > 0;
    if (onTime.count === 0 && !revived) return "already_processed";

    if (revived) {
      // El pago manda sobre el vencimiento (decisión del cliente, 21/08/2026).
      // `auditStrict` porque el asiento ES la señal: al expirar, el cron mandó
      // a cancelar el preapproval y el alta puede haber quedado sin débito.
      // No se propaga: un throw → 500 → reintento → `already_processed`, y el
      // asiento no se reescribiría igual.
      try {
        await deps.auditStrict({ action: APPROVED_AFTER_EXPIRY_ACTION, entity: "application", entityId: applicationId, detail: { paymentId: p.id } });
      } catch (e) {
        console.error("[mp-webhook] CRÍTICO: la solicitud", applicationId, "revivió con un pago posterior al vencimiento y el asiento NO se pudo escribir. code:", codeOf(e), "message:", safeMessage(e));
      }
    }

    // 4B: el ingreso es un Payment con recibo (REG-33). Sin socio todavía:
    // cuelga de la solicitud y `record.ts` le pone el memberId al asentar.
    const r = await deps.treasury.registerPayment({
      memberId: null, applicationId, type: "entry", n: 0, amount: p.transactionAmount, paidAt: p.dateApproved ?? now(),
      mpPaymentId: p.id, preapprovalId: null, actorId: null,
    });
    if (r.kind === "registered") {
      const emailed = await emailReceipt(r.receiptId);
      await deps.audit({ action: "payment_applied", entity: "payment", entityId: r.paymentId,
        detail: { paymentId: r.paymentId, applicationId, type: "entry", amount: r.amount, mpPaymentId: p.id, receiptId: r.receiptId, emailed } });
    }

    const app = await deps.db.application.findUnique({ where: { id: applicationId } });
    if (app) {
      // Best-effort: el estado ya cambió; un SMTP caído no puede des-aceptar.
      try {
        await deps.mailer.sendToApplication({
          applicationId: app.id, to: app.email, type: "application_result",
          message: applicationAcceptedEmail({ name: app.fullName }), summary: "solicitud aceptada (débito autorizado)",
        });
      } catch (e) {
        console.error("[mp-webhook] falló el email de solicitud aceptada", app.id, "code:", codeOf(e), "message:", safeMessage(e));
        await deps.audit({ action: "application_accepted_email_failed", entity: "application", entityId: app.id, detail: { code: codeOf(e) } }).catch(() => {});
      }
    }
    return revived ? "application_approved_after_expiry" : "application_approved";
  }

  async function applyPayment(p: MpPaymentDetails, preapprovalId: string | null): Promise<string> {
    if (p.status === "refunded" || p.status === "charged_back") {
      const r = await deps.treasury.refundPayment({ mpPaymentId: p.id, reason: REFUND_REASON });
      if (r.kind !== "refunded") return "refund_ignored";
      await deps.audit({ action: "payment_refunded", entity: "payment", entityId: r.paymentId, detail: { paymentId: r.paymentId, mpPaymentId: p.id, status: p.status, periodsReverted: r.periodsReverted } });
      return "payment_refunded";
    }
    if (p.status === "rejected") return "payment_rejected_traced";
    if (p.status !== "approved") return "payment_ignored";

    return paymentMutex.run(`mp:${p.id}`, async () => {
      const ctx = await loadContext(p, preapprovalId);
      const decision = resolveMpPayment({ mpPaymentId: p.id, preapprovalId, externalReference: p.externalReference }, ctx);
      switch (decision.kind) {
        case "already_processed": return decision.result;
        case "debit":
        case "link": return applyToMember(p, decision);
        case "entry": return applyEntry(p, decision.applicationId);
        case "unmatched": return toInbox(p, preapprovalId, decision.reason);
      }
    });
  }

  async function onPayment(dataId: string): Promise<string> {
    const payment = await deps.gateway.getPayment(dataId);
    return applyPayment(payment, null);
  }

  async function onPreapproval(dataId: string): Promise<string> {
    const pre = await deps.gateway.getPreapproval(dataId);
    const { count } = await deps.db.mpSubscription.updateMany({
      where: { preapprovalId: pre.id },
      data: {
        status: pre.status,
        amount: pre.amount === null ? null : pre.amount.toFixed(2),
        payerEmail: pre.payerEmail,
        externalReference: pre.externalReference,
        lastSyncAt: now(),
      },
    });
    return count > 0 ? "subscription_synced" : "no_match";
  }

  async function onAuthorizedPayment(dataId: string): Promise<string> {
    const a = await deps.gateway.getAuthorizedPayment(dataId);
    // Sin `payment.id` el cobro todavía no existe (scheduled) o falló: no hay
    // nada que aplicar y el evento queda trazado.
    if (!a.paymentId || a.status !== "processed") return "authorized_payment_traced";
    const payment = await deps.gateway.getPayment(a.paymentId);
    return applyPayment(payment, a.preapprovalId);
  }

  return {
    async process(input: WebhookInput): Promise<string> {
      switch (input.topic) {
        case "payment":
        case "payments":
          return onPayment(input.dataId);
        case "subscription_preapproval":
          return onPreapproval(input.dataId);
        case "subscription_authorized_payment":
          return onAuthorizedPayment(input.dataId);
        default:
          return "unknown_topic";
      }
    },
    applyPayment,
  };
}

export const webhookProcessor = makeWebhookProcessor({
  db: prisma, gateway: mpGateway, treasury: treasuryService, unmatched: makeUnmatchedInbox(prisma),
  feeValues: feeValueReader, mailer, sendReceiptEmail: sendReceiptEmailDefault, audit, auditStrict,
});
```

En `service.ts` agregar: `export type TreasuryService = ReturnType<typeof makeTreasuryService>;`.

Ojo al ciclo de imports: `receipt-email.ts` importa `treasuryService` de `service.ts` y ahora `webhook-processor.ts` importa los dos. No hay ciclo (ninguno importa al procesador), pero en los tests hay que mockear `@/lib/treasury/receipt-email`, `@/lib/treasury/service` y `@/lib/treasury/fee-values` además de `@/lib/prisma` y `@/lib/email`, como muestra el test.

- [ ] **Step 4: `receipt-email.ts` — recibo a una solicitud**

`Mailer = Pick<typeof mailer, "sendToMember" | "sendToApplication">`. En `sendReceiptEmail`, el `include` del pago suma `application: { select: { id: true, fullName: true, email: true } }`, y se reemplaza desde `const member = r.payment.member;` hasta el `sendToMember` por:

```ts
      const member = r.payment.member;
      const application = r.payment.application;
      // Un pago de ingreso cuelga de la solicitud: el vecino todavía no es socio
      // pero el recibo le corresponde igual (REG-33). Va por `sendToApplication`
      // para que la Notification quede acreditada contra la solicitud.
      const target = member
        ? (member.email && member.emailStatus !== "bounced" ? { kind: "member" as const, id: member.id, name: member.fullName, to: member.email } : null)
        : application ? { kind: "application" as const, id: application.id, name: application.fullName, to: application.email } : null;
      if (!target) return { sent: false, reason: "no_email" };
      try {
        let pdf: Buffer;
        try {
          pdf = await deps.readPdf(r.pdfPath ?? receiptRelativePath(r.number));
        } catch {
          pdf = Buffer.from(await deps.regenerate(r.id));
        }
        const message = receiptEmail({ name: target.name, number: r.number, concept: r.concept, amount: Number(r.payment.amount) });
        const payload = {
          to: target.to, type: "receipt" as const,
          message: { ...message, attachments: [{ filename: `recibo-${r.number}.pdf`, content: pdf, contentType: "application/pdf" }] },
          summary: `recibo ${r.number}`,
        };
        if (target.kind === "member") await deps.mailer.sendToMember({ memberId: target.id, ...payload });
        else await deps.mailer.sendToApplication({ applicationId: target.id, ...payload });
      } catch (e) {
```

(conservar los comentarios existentes sobre el PDF regenerable y el concepto congelado.)

Test en `tests/treasury-receipt-email.test.ts`: `setup` acepta `application?: { id: number; fullName: string; email: string }`, el mock del mailer suma `sendToApplication`, y un caso nuevo:

```ts
  it("pago de ingreso sin socio → va por sendToApplication con el PDF", async () => {
    const s = setup(null, { id: 55, fullName: "Ana", email: "a@b.com" });
    expect(await s.emailer.sendReceiptEmail(7)).toEqual({ sent: true });
    expect(s.mailer.sendToMember).not.toHaveBeenCalled();
    const call = s.mailer.sendToApplication.mock.calls[0][0];
    expect(call).toMatchObject({ applicationId: 55, to: "a@b.com", type: "receipt" });
    expect(call.message.attachments[0].filename).toBe("recibo-2026-00007.pdf");
  });
```

- [ ] **Step 5: `record.ts` — el `Payment.entry` cuelga del socio**

Después del `mpSubscription.updateMany` de ~205-208:

```ts
          // 4B: el pago de la cuota de ingreso se registró contra la solicitud
          // cuando todavía no había ficha. Ahora pasa a la cuenta del socio.
          await tx.payment.updateMany({
            where: { applicationId: app.id, memberId: null },
            data: { memberId },
          });
```

Test en `tests/application-record.test.ts`: el fake de `tx` suma `payment: { updateMany: vi.fn(async () => ({ count: 1 })) }` y un caso afirma `toHaveBeenCalledWith({ where: { applicationId: <id>, memberId: null }, data: { memberId: <memberId> } })`.

- [ ] **Step 6: Correr, suite, commit**

Run: `npx vitest run tests/mp-webhook-processor.test.ts tests/treasury-receipt-email.test.ts tests/application-record.test.ts tests/mp-webhook-route.test.ts && npm test 2>&1 | tail -3 && npx tsc --noEmit && npm run lint`

```bash
git add src/lib/mp/webhook-processor.ts src/lib/treasury/service.ts src/lib/treasury/receipt-email.ts src/lib/applications/record.ts tests/
git commit -m "feat(m4b): webhook applies MP payments — debits, links, entry receipts, refunds, inbox; never fails on business rules

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Conciliación `POST /api/cron/reconcile`

**Files:**
- Create: `src/lib/mp/reconcile.ts`, `src/app/api/cron/reconcile/route.ts`
- Create: `tests/mp-reconcile.test.ts`, `tests/mp-reconcile-route.test.ts`

**Interfaces:**
- Consumes: `MpGateway.searchPayments/searchAuthorizedPayments/getPayment/getPreapproval/searchPreapprovals/cancelPreapproval/getPlan`, `webhookProcessor.applyPayment`, `feeValueReader.current`, `configReader.getString`.
- Produces:

```ts
export const RECONCILE_WINDOW_MS = 72 * 60 * 60_000;
export type ReconcileSummary = {
  paymentsRecovered: number; debitsRecovered: number; subscriptionsSynced: number; subscriptionsDrifted: number;
  orphanCreated: number; orphanCancelled: number; orphanPreapprovals: number; amountDivergent: number; planDivergent: number;
  errors: string[];  // "paso:detalle" sin datos personales
};
export function makeReconcile(deps: {
  db: Pick<PrismaClient, "payment" | "mpUnmatchedPayment" | "mpSubscription" | "application">;
  gateway: Pick<MpGateway, "searchPayments" | "searchAuthorizedPayments" | "getPayment" | "getPreapproval" | "searchPreapprovals" | "cancelPreapproval" | "getPlan">;
  processor: { applyPayment(payment: MpPaymentDetails, preapprovalId: string | null): Promise<string> };
  feeValues: Pick<ReturnType<typeof makeFeeValueReader>, "current">;
  config: { getString(key: string): Promise<string | null> };
  now?: () => Date;
}): { run(): Promise<ReconcileSummary> };
export const reconcile: ReturnType<typeof makeReconcile>;
```
- Ruta: 503 sin `CRON_SECRET`, 401 sin Bearer, 200 con el summary (207 si `errors` no está vacío); escribe `CronRun{ job: "reconcile" }` al empezar y al terminar; asiento `reconcile_cron` con el summary.

- [ ] **Step 1: Tests (`tests/mp-reconcile.test.ts`)**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/mp/webhook-processor", () => ({ webhookProcessor: {} }));
vi.mock("@/lib/treasury/fee-values", () => ({ feeValueReader: {} }));
vi.mock("@/lib/config", () => ({ configReader: {}, CONFIG_KEYS: { mpPlanActiveId: "mp_plan_active_id", mpPlanSharedId: "mp_plan_shared_id" } }));
import { makeReconcile, RECONCILE_WINDOW_MS } from "@/lib/mp/reconcile";

const NOW = new Date("2026-09-11T06:00:00Z");
const pay = (id: string, over: Record<string, unknown> = {}) =>
  ({ id, status: "approved", statusDetail: null, transactionAmount: 6000, externalReference: null, dateApproved: NOW, payerEmail: null, description: null, ...over });

type Sub = { preapprovalId: string; memberId: number | null; status: string; amount: string | null; externalReference: string | null; member: { category: string } | null };

function deps(over: Partial<{
  payments: ReturnType<typeof pay>[]; localIds: string[]; inboxIds: string[]; subs: Sub[];
  authorized: Array<{ id: string; preapprovalId: string; status: string; paymentId: string | null }>;
  remote: Record<string, { status: string; amount: number | null; payerEmail: string | null; externalReference: string | null }>;
  preapprovals: Array<{ id: string; status: string; externalReference: string | null; amount: number | null; payerEmail: string | null }>;
  applications: Record<number, { id: number; status: string }>;
  planIds: { active: string | null; shared: string | null }; plans: Record<string, number>;
}> = {}) {
  const localIds = new Set(over.localIds ?? []);
  const inboxIds = new Set(over.inboxIds ?? []);
  const subs = over.subs ?? [];
  const db = {
    payment: { findUnique: vi.fn(async ({ where }: { where: { mpPaymentId: string } }) => (localIds.has(where.mpPaymentId) ? { id: 1 } : null)) },
    mpUnmatchedPayment: { findUnique: vi.fn(async ({ where }: { where: { mpPaymentId: string } }) => (inboxIds.has(where.mpPaymentId) ? { id: 1 } : null)) },
    mpSubscription: {
      findMany: vi.fn(async () => subs),
      findUnique: vi.fn(async ({ where }: { where: { preapprovalId: string } }) => subs.find((s) => s.preapprovalId === where.preapprovalId) ?? null),
      updateMany: vi.fn(async () => ({ count: 1 })),
      create: vi.fn(async () => ({})),
    },
    application: { findUnique: vi.fn(async ({ where }: { where: { id: number } }) => over.applications?.[where.id] ?? null) },
  };
  const gateway = {
    searchPayments: vi.fn(async () => over.payments ?? []),
    searchAuthorizedPayments: vi.fn(async () => over.authorized ?? []),
    getPayment: vi.fn(async (id: string) => pay(id)),
    getPreapproval: vi.fn(async (id: string) => ({ id, reason: null, nextPaymentDate: null, dateCreated: null, ...(over.remote?.[id] ?? { status: "authorized", amount: 6000, payerEmail: null, externalReference: null }) })),
    searchPreapprovals: vi.fn(async () => (over.preapprovals ?? []).map((p) => ({ reason: null, nextPaymentDate: null, dateCreated: null, ...p }))),
    cancelPreapproval: vi.fn(async () => {}),
    getPlan: vi.fn(async (id: string) => ({ id, reason: "", amount: over.plans?.[id] ?? 6000 })),
  };
  const processor = { applyPayment: vi.fn(async () => "debit_applied") };
  const feeValues = { current: vi.fn(async () => ({ activeAmount: 6000, sharedAmount: 3000 })) };
  const config = { getString: vi.fn(async (k: string) => (k === "mp_plan_active_id" ? over.planIds?.active ?? null : over.planIds?.shared ?? null)) };
  const r = makeReconcile({ db: db as never, gateway: gateway as never, processor, feeValues: feeValues as never, config, now: () => NOW });
  return { r, db, gateway, processor };
}

const liveSub = (preapprovalId: string, memberId: number): Sub =>
  ({ preapprovalId, memberId, status: "authorized", amount: "6000.00", externalReference: null, member: { category: "active" } });

beforeEach(() => vi.clearAllMocks());

describe("reconcile", () => {
  it("paso 1: pago aprobado sin registro local ni bandeja → applyPayment; los conocidos se saltean", async () => {
    const d = deps({ payments: [pay("1"), pay("2"), pay("3")], localIds: ["2"], inboxIds: ["3"] });
    const s = await d.r.run();
    expect(d.gateway.searchPayments).toHaveBeenCalledWith({ since: new Date(NOW.getTime() - RECONCILE_WINDOW_MS) });
    expect(d.processor.applyPayment).toHaveBeenCalledTimes(1);
    expect(d.processor.applyPayment).toHaveBeenCalledWith(expect.objectContaining({ id: "1" }), null);
    expect(s.paymentsRecovered).toBe(1);
  });
  it("paso 2: cobros de cada suscripción viva sin Payment local → getPayment + applyPayment con el preapproval", async () => {
    const d = deps({ subs: [liveSub("pre-1", 14)], authorized: [
      { id: "a1", preapprovalId: "pre-1", status: "processed", paymentId: "777" },
      { id: "a2", preapprovalId: "pre-1", status: "scheduled", paymentId: null },
    ] });
    const s = await d.r.run();
    expect(d.gateway.searchAuthorizedPayments).toHaveBeenCalledWith("pre-1");
    expect(d.gateway.getPayment).toHaveBeenCalledWith("777");
    expect(d.processor.applyPayment).toHaveBeenCalledWith(expect.objectContaining({ id: "777" }), "pre-1");
    expect(s.debitsRecovered).toBe(1);
  });
  it("paso 2 no repite un cobro que ya tiene Payment local", async () => {
    const d = deps({ localIds: ["777"], subs: [liveSub("pre-1", 14)], authorized: [{ id: "a1", preapprovalId: "pre-1", status: "processed", paymentId: "777" }] });
    await d.r.run();
    expect(d.processor.applyPayment).not.toHaveBeenCalled();
  });
  it("paso 3: sincroniza estado y monto; cancelada en MP → subscriptionsDrifted", async () => {
    const d = deps({ subs: [liveSub("pre-1", 14)], remote: { "pre-1": { status: "cancelled", amount: 6000, payerEmail: null, externalReference: null } } });
    const s = await d.r.run();
    expect(d.db.mpSubscription.updateMany).toHaveBeenCalledWith({
      where: { preapprovalId: "pre-1" },
      data: { status: "cancelled", amount: "6000.00", payerEmail: null, externalReference: null, lastSyncAt: NOW },
    });
    expect(s.subscriptionsDrifted).toBe(1);
    expect(s.subscriptionsSynced).toBe(1);
  });
  it("paso 4: preapproval solicitud:{id} sin fila local → crea si la solicitud vive; cancela si expiró; huérfana si no existe o no tiene referencia", async () => {
    const d = deps({
      preapprovals: [
        { id: "p-live", status: "authorized", externalReference: "solicitud:1", amount: 6000, payerEmail: "a@b.com" },
        { id: "p-exp", status: "pending", externalReference: "solicitud:2", amount: 6000, payerEmail: null },
        { id: "p-gone", status: "authorized", externalReference: "solicitud:3", amount: 6000, payerEmail: null },
        { id: "p-manual", status: "authorized", externalReference: null, amount: 6000, payerEmail: null },
      ],
      applications: { 1: { id: 1, status: "pending_payment" }, 2: { id: 2, status: "expired" } },
    });
    const s = await d.r.run();
    expect(d.db.mpSubscription.create).toHaveBeenCalledWith({ data: expect.objectContaining({ preapprovalId: "p-live", applicationId: 1, status: "authorized", amount: "6000.00", externalReference: "solicitud:1", planId: null }) });
    expect(d.gateway.cancelPreapproval).toHaveBeenCalledWith("p-exp");
    expect(s).toMatchObject({ orphanCreated: 1, orphanCancelled: 1, orphanPreapprovals: 2 });
  });
  it("paso 5: divergencia de monto contra feeAmountFor y de planes contra fee_values", async () => {
    const d = deps({ subs: [liveSub("pre-1", 14)], remote: { "pre-1": { status: "authorized", amount: 5000, payerEmail: null, externalReference: null } },
      planIds: { active: "plan-a", shared: "plan-s" }, plans: { "plan-a": 6000, "plan-s": 2500 } });
    const s = await d.r.run();
    expect(s.amountDivergent).toBe(1);
    expect(s.planDivergent).toBe(1);
  });
  it("sin ids de plan, el chequeo de planes no corre", async () => {
    const d = deps();
    const s = await d.r.run();
    expect(d.gateway.getPlan).not.toHaveBeenCalled();
    expect(s.planDivergent).toBe(0);
  });
  it("un paso que explota se cuenta en errors y los demás corren igual", async () => {
    const d = deps({ payments: [pay("1")] });
    d.gateway.searchPayments.mockRejectedValue({ message: "boom", status: 500 });
    const s = await d.r.run();
    expect(s.errors).toEqual([expect.stringMatching(/^payments:/)]);
    expect(d.gateway.searchPreapprovals).toHaveBeenCalled();
  });
  it("un cobro que falla al aplicarse no frena la suscripción siguiente", async () => {
    const d = deps({ subs: [liveSub("pre-1", 14), liveSub("pre-2", 15)], authorized: [{ id: "a1", preapprovalId: "x", status: "processed", paymentId: "777" }] });
    d.processor.applyPayment.mockRejectedValueOnce(new Error("db"));
    const s = await d.r.run();
    expect(d.gateway.searchAuthorizedPayments).toHaveBeenCalledTimes(2);
    expect(s.errors).toHaveLength(1);
    expect(s.debitsRecovered).toBe(1);
  });
});
```

- [ ] **Step 2: Implementar `src/lib/mp/reconcile.ts`**

```ts
// Conciliación diaria con Mercado Pago (spec 4B §9): la red si el webhook no
// llega. Pasos aislados — un fallo se cuenta en `errors` y los demás corren
// igual —, y el que aplica pagos es el MISMO camino del webhook
// (`processor.applyPayment`), así el resultado es idéntico al del evento perdido.
import type { PrismaClient } from "@/generated/prisma/client";
import { CONFIG_KEYS, configReader } from "@/lib/config";
import { prisma } from "@/lib/prisma";
import { feeValueReader, type makeFeeValueReader } from "@/lib/treasury/fee-values";
import { feeAmountFor } from "@/lib/treasury/rules";
import { mpErrorLog } from "./error-log";
import { mpGateway, type MpGateway, type MpPaymentDetails } from "./gateway";
import { parseApplicationReference } from "./references";
import { webhookProcessor } from "./webhook-processor";

export const RECONCILE_WINDOW_MS = 72 * 60 * 60_000;
/** Estados de MP con los que una suscripción puede seguir cobrando. */
const LIVE_STATUSES = ["authorized", "paused"];
/** Solicitudes por las que vale la pena conservar un preapproval huérfano. */
const LIVE_APPLICATION_STATUSES = ["started", "pending_payment", "approved_pending_minute", "pending_board", "completed"];

export type ReconcileSummary = {
  paymentsRecovered: number;
  debitsRecovered: number;
  subscriptionsSynced: number;
  subscriptionsDrifted: number;
  orphanCreated: number;
  orphanCancelled: number;
  orphanPreapprovals: number;
  amountDivergent: number;
  planDivergent: number;
  errors: string[];
};

type Deps = {
  db: Pick<PrismaClient, "payment" | "mpUnmatchedPayment" | "mpSubscription" | "application">;
  gateway: Pick<MpGateway, "searchPayments" | "searchAuthorizedPayments" | "getPayment" | "getPreapproval" | "searchPreapprovals" | "cancelPreapproval" | "getPlan">;
  processor: { applyPayment(payment: MpPaymentDetails, preapprovalId: string | null): Promise<string> };
  feeValues: Pick<ReturnType<typeof makeFeeValueReader>, "current">;
  config: { getString(key: string): Promise<string | null> };
  now?: () => Date;
};

export function makeReconcile(deps: Deps) {
  const now = deps.now ?? (() => new Date());

  return {
    async run(): Promise<ReconcileSummary> {
      const t = now();
      const s: ReconcileSummary = {
        paymentsRecovered: 0, debitsRecovered: 0, subscriptionsSynced: 0, subscriptionsDrifted: 0,
        orphanCreated: 0, orphanCancelled: 0, orphanPreapprovals: 0, amountDivergent: 0, planDivergent: 0, errors: [],
      };
      // Al summary va un código corto; el detalle completo (enmascarado) al log.
      const fail = (step: string, refs: Record<string, string | number>, e: unknown) => {
        const detail = mpErrorLog(`reconcile.${step}`, refs, e);
        console.error("[reconcile]", detail);
        s.errors.push(`${step}:${detail.slice(0, 80)}`);
      };
      const hasLocal = async (mpPaymentId: string) =>
        Boolean(await deps.db.payment.findUnique({ where: { mpPaymentId }, select: { id: true } }));
      const inInbox = async (mpPaymentId: string) =>
        Boolean(await deps.db.mpUnmatchedPayment.findUnique({ where: { mpPaymentId }, select: { id: true } }));

      // ── 1. Pagos aprobados de las últimas 72 h sin rastro local ─────────────
      try {
        const payments = await deps.gateway.searchPayments({ since: new Date(t.getTime() - RECONCILE_WINDOW_MS) });
        for (const p of payments) {
          try {
            if ((await hasLocal(p.id)) || (await inInbox(p.id))) continue;
            await deps.processor.applyPayment(p, null);
            s.paymentsRecovered++;
          } catch (e) { fail("payments.apply", { mpPaymentId: p.id }, e); }
        }
      } catch (e) { fail("payments", {}, e); }

      // ── 2 y 3. Por cada suscripción viva: cobros perdidos + estado ──────────
      let subs: Array<{ preapprovalId: string; memberId: number | null; member: { category: "active" | "adherent" | "collaborator" | "cadet" | "honorary" | "lifetime" } | null }> = [];
      try {
        subs = await deps.db.mpSubscription.findMany({
          where: { status: { in: LIVE_STATUSES } },
          select: { preapprovalId: true, memberId: true, member: { select: { category: true } } },
        });
      } catch (e) { fail("subscriptions", {}, e); }
      const feeValue = await deps.feeValues.current(t).catch(() => null);

      for (const sub of subs) {
        if (sub.memberId !== null) {
          try {
            const charges = await deps.gateway.searchAuthorizedPayments(sub.preapprovalId);
            for (const c of charges) {
              if (!c.paymentId || c.status !== "processed") continue;
              try {
                if (await hasLocal(c.paymentId)) continue;
                const p = await deps.gateway.getPayment(c.paymentId);
                await deps.processor.applyPayment(p, sub.preapprovalId);
                s.debitsRecovered++;
              } catch (e) { fail("debits.apply", { preapprovalId: sub.preapprovalId, mpPaymentId: c.paymentId }, e); }
            }
          } catch (e) { fail("debits", { preapprovalId: sub.preapprovalId }, e); }
        }
        try {
          const remote = await deps.gateway.getPreapproval(sub.preapprovalId);
          await deps.db.mpSubscription.updateMany({
            where: { preapprovalId: sub.preapprovalId },
            data: {
              status: remote.status, amount: remote.amount === null ? null : remote.amount.toFixed(2),
              payerEmail: remote.payerEmail, externalReference: remote.externalReference, lastSyncAt: t,
            },
          });
          s.subscriptionsSynced++;
          if (remote.status !== "authorized") s.subscriptionsDrifted++;
          // 5a. Monto de la suscripción vs. valor vigente de la categoría.
          if (feeValue && sub.member && remote.amount !== null) {
            const expected = feeAmountFor(sub.member.category, feeValue);
            if (expected !== null && Math.abs(expected - remote.amount) >= 0.01) s.amountDivergent++;
          }
        } catch (e) { fail("sync", { preapprovalId: sub.preapprovalId }, e); }
      }

      // ── 4. Preapprovals del wizard sin fila local ───────────────────────────
      try {
        const remote = await deps.gateway.searchPreapprovals();
        for (const pre of remote) {
          try {
            if (await deps.db.mpSubscription.findUnique({ where: { preapprovalId: pre.id }, select: { preapprovalId: true } })) continue;
            const applicationId = parseApplicationReference(pre.externalReference);
            if (applicationId === null) { s.orphanPreapprovals++; continue; }
            const app = await deps.db.application.findUnique({ where: { id: applicationId }, select: { id: true, status: true } });
            if (!app) { s.orphanPreapprovals++; continue; }
            if (LIVE_APPLICATION_STATUSES.includes(app.status)) {
              await deps.db.mpSubscription.create({
                data: {
                  preapprovalId: pre.id, applicationId: app.id, status: pre.status, payerEmail: pre.payerEmail,
                  amount: pre.amount === null ? null : pre.amount.toFixed(2), externalReference: pre.externalReference, planId: null, lastSyncAt: t,
                },
              });
              s.orphanCreated++;
            } else if (pre.status !== "cancelled") {
              await deps.gateway.cancelPreapproval(pre.id);
              s.orphanCancelled++;
            }
          } catch (e) { fail("orphans.one", { preapprovalId: pre.id }, e); }
        }
      } catch (e) { fail("orphans", {}, e); }

      // ── 5b. Planes de referencia (si están cargados) vs. fee_values ─────────
      try {
        if (feeValue) {
          const [activeId, sharedId] = await Promise.all([
            deps.config.getString(CONFIG_KEYS.mpPlanActiveId), deps.config.getString(CONFIG_KEYS.mpPlanSharedId),
          ]);
          const checks: Array<[string | null, number]> = [[activeId, feeValue.activeAmount], [sharedId, feeValue.sharedAmount]];
          for (const [planId, expected] of checks) {
            if (!planId) continue;
            const plan = await deps.gateway.getPlan(planId);
            if (Math.abs(plan.amount - expected) >= 0.01) s.planDivergent++;
          }
        }
      } catch (e) { fail("plans", {}, e); }

      return s;
    },
  };
}

export const reconcile = makeReconcile({
  db: prisma, gateway: mpGateway, processor: webhookProcessor, feeValues: feeValueReader, config: configReader,
});
```

- [ ] **Step 3: Ruta (`src/app/api/cron/reconcile/route.ts`)**

```ts
// POST /api/cron/reconcile — lo dispara el crontab del VPS a las 03:00
// (docs/11 Parte H). Mismo esquema de autenticación que `/api/cron/applications`
// y estrena el registro en `cron_runs` (spec M4 §8): la última corrida de cada
// cron es lo que `/admin/salud` (4C) va a mostrar.
import { timingSafeEqual } from "node:crypto";
import { audit } from "@/lib/audit";
import { safeMessage } from "@/lib/log-safe";
import { reconcile } from "@/lib/mp/reconcile";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

function authorized(header: string | null, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`);
  const got = Buffer.from(header ?? "");
  return expected.length === got.length && timingSafeEqual(expected, got);
}

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ error: "not_configured" }, { status: 503 });
  if (!authorized(req.headers.get("authorization"), secret)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const run = await prisma.cronRun.create({ data: { job: "reconcile", startedAt: new Date() } });
  try {
    const summary = await reconcile.run();
    const ok = summary.errors.length === 0;
    await prisma.cronRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), ok, summary } });
    // Sin datos personales: contadores y códigos (docs/08).
    await audit({ action: "reconcile_cron", entity: "cron", entityId: String(run.id), detail: summary });
    return Response.json(summary, { status: ok ? 200 : 207 });
  } catch (e) {
    // `run()` ya se come los fallos por paso: llegar acá es que se cayó la base
    // antes de empezar. Al cuerpo no va el mensaje (lo lee un curl en un log).
    console.error("[cron] reconcile: la corrida falló entera", safeMessage(e));
    await prisma.cronRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), ok: false, error: safeMessage(e).slice(0, 500) } }).catch(() => {});
    return Response.json({ error: "cron_failed" }, { status: 500 });
  }
}
```

- [ ] **Step 4: Test de la ruta (`tests/mp-reconcile-route.test.ts`)**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  create: vi.fn(async () => ({ id: 7n })),
  update: vi.fn(async () => ({})),
  run: vi.fn(),
  audit: vi.fn(async () => {}),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { cronRun: { create: mocks.create, update: mocks.update } } }));
vi.mock("@/lib/mp/reconcile", () => ({ reconcile: { run: mocks.run } }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
import { POST } from "@/app/api/cron/reconcile/route";

const summary = { paymentsRecovered: 1, debitsRecovered: 0, subscriptionsSynced: 2, subscriptionsDrifted: 0, orphanCreated: 0, orphanCancelled: 0, orphanPreapprovals: 0, amountDivergent: 0, planDivergent: 0, errors: [] as string[] };
const req = (auth?: string) => new Request("http://x/api/cron/reconcile", { method: "POST", headers: auth ? { authorization: auth } : {} });

beforeEach(() => { vi.clearAllMocks(); process.env.CRON_SECRET = "s3cret"; mocks.run.mockResolvedValue(summary); });

describe("POST /api/cron/reconcile", () => {
  it("sin CRON_SECRET → 503", async () => {
    delete process.env.CRON_SECRET;
    expect((await POST(req("Bearer x"))).status).toBe(503);
  });
  it("bearer incorrecto → 401 y no abre corrida", async () => {
    expect((await POST(req("Bearer nope"))).status).toBe(401);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("ok → 200, CronRun abierto y cerrado con summary, asiento reconcile_cron", async () => {
    const res = await POST(req("Bearer s3cret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(summary);
    expect(mocks.create).toHaveBeenCalledWith({ data: { job: "reconcile", startedAt: expect.any(Date) } });
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: 7n }, data: { finishedAt: expect.any(Date), ok: true, summary } });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "reconcile_cron", detail: summary }));
  });
  it("con errores → 207 y ok:false", async () => {
    mocks.run.mockResolvedValue({ ...summary, errors: ["payments:boom"] });
    expect((await POST(req("Bearer s3cret"))).status).toBe(207);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ ok: false }) }));
  });
  it("run() lanza → 500 y el CronRun queda con error", async () => {
    mocks.run.mockRejectedValue(new Error("db down"));
    expect((await POST(req("Bearer s3cret"))).status).toBe(500);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ ok: false, error: expect.stringContaining("db down") }) }));
  });
});
```

- [ ] **Step 5: Correr, suite, commit**

Run: `npx vitest run tests/mp-reconcile.test.ts tests/mp-reconcile-route.test.ts && npm test 2>&1 | tail -3 && npx tsc --noEmit && npm run lint`

```bash
git add src/lib/mp/reconcile.ts src/app/api/cron/reconcile tests/mp-reconcile.test.ts tests/mp-reconcile-route.test.ts
git commit -m "feat(m4b): daily reconcile cron — recovers lost payments and debits, syncs subscriptions, writes CronRun

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Pestañas nuevas, badges y bandeja Sin conciliar

> Cargar el skill `frontend-design` antes de escribir JSX.

**Files:**
- Modify: `src/lib/admin/treasury-tabs.ts`, `src/lib/admin/status-badges.ts`
- Create: `src/lib/admin/unmatched-labels.ts`
- Create: `src/app/admin/tesoreria/sin-conciliar/page.tsx`, `src/app/admin/tesoreria/sin-conciliar/[id]/page.tsx`, `src/app/admin/tesoreria/sin-conciliar/[id]/actions.ts`, `src/app/admin/tesoreria/sin-conciliar/[id]/resolve-form.tsx`
- Create: `src/app/admin/tesoreria/suscripciones/page.tsx` (placeholder mínimo con `requireAdmin` + `EmptyState`, para que el test de pestañas pase; Task 9 lo reemplaza)
- Create: `tests/unmatched-actions-auth.test.ts`

**Interfaces:**
- Consumes: `treasuryService.registerPayment` (Task 3), `searchMembers` (`src/lib/treasury/member-search.ts`), `UNMATCHED_REASONS` (Task 5), `parsePage/paginate/pageHref` (`src/lib/admin/pagination.ts`).
- Produces:

```ts
// treasury-tabs.ts
TREASURY_TABS = [Deudores, Efectivo, Recibos, "Sin conciliar" (/admin/tesoreria/sin-conciliar), "Suscripciones" (/admin/tesoreria/suscripciones), Valores]
// status-badges.ts
export function unmatchedStatusBadgeVariant(status: UnmatchedStatus): BadgeVariant;   // open → "default", matched → "outline", dismissed → "secondary"
export function subscriptionStatusBadgeVariant(status: string): BadgeVariant;        // authorized → "default", paused → "secondary", cancelled → "destructive", otro → "outline"
// unmatched-labels.ts
export const UNMATCHED_REASON_LABELS: Record<UnmatchedReason, string>;
export const UNMATCHED_STATUS_LABELS: Record<UnmatchedStatus, string>;
// actions.ts
export async function resolveUnmatchedAction(_prev: State, formData: FormData): Promise<State>;
export async function dismissUnmatchedAction(_prev: State, formData: FormData): Promise<State>;
```

- [ ] **Step 1: Pestañas y badges**

`src/lib/admin/treasury-tabs.ts`:

```ts
export const TREASURY_TABS: TreasuryTab[] = [
  { href: "/admin/tesoreria/deudores", label: "Deudores" },
  { href: "/admin/tesoreria/efectivo", label: "Efectivo" },
  { href: "/admin/tesoreria/recibos", label: "Recibos" },
  { href: "/admin/tesoreria/sin-conciliar", label: "Sin conciliar" },
  { href: "/admin/tesoreria/suscripciones", label: "Suscripciones" },
  { href: "/admin/tesoreria/valores", label: "Valores de cuota" },
];
```

(y borrar la línea del comentario "4B suma…"). `src/lib/admin/status-badges.ts`:

```ts
import type { ApplicationStatus, FeeStatus, MemberStatus, NewsStatus, UnmatchedStatus } from "@/generated/prisma/client";

// La bandeja resalta lo que espera una decisión; lo resuelto va apagado.
export function unmatchedStatusBadgeVariant(status: UnmatchedStatus): BadgeVariant {
  if (status === "open") return "default";
  if (status === "dismissed") return "secondary";
  return "outline"; // matched
}

// El catálogo de estados es de MP (string). Sólo tres se afirman; cualquier
// otro es "no sé" y va neutro, nunca verde.
export function subscriptionStatusBadgeVariant(status: string): BadgeVariant {
  if (status === "authorized") return "default";
  if (status === "paused") return "secondary";
  if (status === "cancelled") return "destructive";
  return "outline";
}
```

`src/lib/admin/unmatched-labels.ts`:

```ts
import type { UnmatchedStatus } from "@/generated/prisma/client";
import type { UnmatchedReason } from "@/lib/mp/unmatched";

export const UNMATCHED_REASON_LABELS: Record<UnmatchedReason, string> = {
  no_reference: "Sin referencia",
  no_subscription: "Suscripción sin vincular",
  application_missing: "Solicitud inexistente",
  duplicate_entry: "Segundo cobro de ingreso",
  withdrawn_no_pending: "Cesante sin deuda",
};

export const UNMATCHED_STATUS_LABELS: Record<UnmatchedStatus, string> = {
  open: "Pendiente", matched: "Aplicado", dismissed: "Descartado",
};

export const SUBSCRIPTION_STATUS_LABELS: Record<string, string> = {
  authorized: "Activa", paused: "Pausada", cancelled: "Cancelada", pending: "Pendiente",
};
export function subscriptionStatusLabel(status: string): string {
  return SUBSCRIPTION_STATUS_LABELS[status] ?? status;
}
```

Placeholder `src/app/admin/tesoreria/suscripciones/page.tsx` (Task 9 lo reemplaza):

```tsx
import { EmptyState } from "@/components/admin/empty-state";
import { FormMessage } from "@/components/admin/form-message";
import { requireAdmin } from "@/lib/auth/require-admin";
export const dynamic = "force-dynamic";
export const metadata = { title: "Suscripciones — SIGeV" };
export default async function SuscripcionesPage() {
  const actor = await requireAdmin();
  if (!actor.ok) return <FormMessage kind="error" box>{actor.error}</FormMessage>;
  return <EmptyState description="Suscripciones de Mercado Pago: en construcción." />;
}
```

Run: `npx vitest run tests/treasury-tabs.test.ts` → debe fallar hasta que existan las dos `page.tsx`; después PASS.

- [ ] **Step 2: Listado `sin-conciliar/page.tsx`**

Diseño: la bandeja es una lista de cosas que esperan una decisión. Cada fila dice **cuánto, cuándo, quién pagó (email), qué referencia traía y por qué no se aplicó**, y tiene un solo camino: abrir la fila. Arriba, el filtro `?estado=pendientes|resueltos` como dos links tipo segmentado (no un select). Vacío → `EmptyState` "No hay pagos sin conciliar. Todo lo que llegó de Mercado Pago se aplicó solo." Paginación de 50 con `PaginationNav`.

```tsx
import Link from "next/link";
import { EmptyState } from "@/components/admin/empty-state";
import { FormMessage } from "@/components/admin/form-message";
import { PaginationNav } from "@/components/admin/pagination-nav";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { pageHref, paginate, parsePage } from "@/lib/admin/pagination";
import { unmatchedStatusBadgeVariant } from "@/lib/admin/status-badges";
import { UNMATCHED_REASON_LABELS, UNMATCHED_STATUS_LABELS } from "@/lib/admin/unmatched-labels";
import { requireAdmin } from "@/lib/auth/require-admin";
import { formatARS, formatDateAR } from "@/lib/format";
import type { UnmatchedReason } from "@/lib/mp/unmatched";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sin conciliar — SIGeV" };

const BASE = "/admin/tesoreria/sin-conciliar";
const PAGE_SIZE = 50;

export default async function SinConciliarPage(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireAdmin();
  if (!actor.ok) return <FormMessage kind="error" box>{actor.error}</FormMessage>;
  const sp = await props.searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const resolved = one(sp.estado) === "resueltos";
  const where = resolved ? { status: { in: ["matched", "dismissed"] as const } } : { status: "open" as const };
  const total = await prisma.mpUnmatchedPayment.count({ where });
  const pg = paginate(total, parsePage(sp), PAGE_SIZE);
  const rows = await prisma.mpUnmatchedPayment.findMany({
    where, orderBy: resolved ? { resolvedAt: "desc" } : { paidAt: "desc" }, skip: pg.skip, take: pg.take,
    include: { payment: { select: { id: true, memberId: true, member: { select: { fullName: true } }, receipt: { select: { id: true, number: true } } } } },
  });
  const params = { estado: resolved ? "resueltos" : undefined };

  return (
    <div className="space-y-4">
      <nav aria-label="Estado" className="flex gap-1 rounded-lg bg-muted p-1 w-fit">
        {[{ href: BASE, label: "Pendientes", active: !resolved }, { href: `${BASE}?estado=resueltos`, label: "Resueltos", active: resolved }].map((t) => (
          <Link key={t.href} href={t.href} aria-current={t.active ? "page" : undefined}
            className={`inline-flex min-h-11 items-center rounded-md px-4 text-sm font-medium outline-hidden focus-visible:ring-2 focus-visible:ring-ring ${t.active ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
            {t.label}
          </Link>
        ))}
      </nav>
      {total === 0 ? (
        <EmptyState description={resolved ? "Todavía no se resolvió ninguna fila." : "No hay pagos sin conciliar. Todo lo que llegó de Mercado Pago se aplicó solo."} />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{total} {total === 1 ? "pago" : "pagos"}{pg.pageCount > 1 && ` · página ${pg.page} de ${pg.pageCount}`}</p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cobrado</TableHead><TableHead className="text-right">Importe</TableHead><TableHead>Pagador</TableHead>
                <TableHead>Referencia</TableHead><TableHead>Motivo</TableHead><TableHead>Estado</TableHead>
                <TableHead><span className="sr-only">Acción</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{formatDateAR(r.paidAt)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatARS(Number(r.amount))}</TableCell>
                  <TableCell className="max-w-[14rem] truncate">{r.payerEmail ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{r.externalReference ?? "—"}</TableCell>
                  <TableCell>{UNMATCHED_REASON_LABELS[r.reason as UnmatchedReason] ?? r.reason}</TableCell>
                  <TableCell>
                    <Badge variant={unmatchedStatusBadgeVariant(r.status)}>{UNMATCHED_STATUS_LABELS[r.status]}</Badge>
                    {r.payment?.receipt && (
                      <Link className="ml-2 font-mono text-xs text-primary hover:underline" href={`/admin/tesoreria/recibos/${r.payment.receipt.id}`}>{r.payment.receipt.number}</Link>
                    )}
                  </TableCell>
                  <TableCell>
                    <Link className="inline-flex min-h-11 items-center text-primary hover:underline" href={`${BASE}/${r.id}`}>
                      {r.status === "open" ? "Resolver" : "Ver"}
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <PaginationNav page={pg.page} pageCount={pg.pageCount} href={(n) => pageHref(BASE, params, n)} label="Páginas de la bandeja" />
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Detalle `sin-conciliar/[id]/page.tsx`**

Dos columnas en `md`: a la izquierda la tarjeta del cobro (monto grande en mono, fecha, pagador, referencia, descripción, motivo explicado en una frase —mapa `REASON_HELP` local por motivo—, y si hay `preapprovalId` el link a Suscripciones); a la derecha, si está `open`, el buscador de socio (`?q=`, lista como en Efectivo) y, elegido uno (`?socio=`), la ficha corta + `ResolveForm`; debajo, en un `<details>` cerrado, "Descartar" con motivo. Si está resuelta, una tarjeta "Resuelto el … por …" con link al recibo o el motivo del descarte.

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/admin/empty-state";
import { FormMessage } from "@/components/admin/form-message";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { memberStatusBadgeVariant } from "@/lib/admin/status-badges";
import { UNMATCHED_REASON_LABELS, UNMATCHED_STATUS_LABELS } from "@/lib/admin/unmatched-labels";
import { requireAdmin } from "@/lib/auth/require-admin";
import { formatARS, formatDateAR } from "@/lib/format";
import { CATEGORY_LABELS, STATUS_LABELS } from "@/lib/members/labels";
import type { UnmatchedReason } from "@/lib/mp/unmatched";
import { prisma } from "@/lib/prisma";
import { fetchMemberAccount } from "@/lib/treasury/account";
import { feeValueReader } from "@/lib/treasury/fee-values";
import { searchMembers } from "@/lib/treasury/member-search";
import { ResolveForm } from "./resolve-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pago sin conciliar — SIGeV" };

const BASE = "/admin/tesoreria/sin-conciliar";
const REASON_HELP: Record<UnmatchedReason, string> = {
  no_reference: "Llegó sin referencia ni suscripción conocida: no hay forma de saber de qué socio es.",
  no_subscription: "Es un cobro de una suscripción que SIGeV todavía no tiene vinculada a ningún socio. Vinculala desde Suscripciones y esta fila se aplica sola.",
  application_missing: "Trae la referencia de una solicitud que ya no existe en el sistema.",
  duplicate_entry: "Es un segundo cobro sobre una solicitud cuyo ingreso ya se cobró y todavía no tiene acta.",
  withdrawn_no_pending: "El socio está dado de baja y no le quedan cuotas pendientes: no hay a qué imputarlo.",
};

export default async function UnmatchedDetailPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireAdmin();
  if (!actor.ok) return <FormMessage kind="error" box>{actor.error}</FormMessage>;
  const { id } = await props.params;
  const rowId = Number(id);
  if (!Number.isInteger(rowId) || rowId <= 0) notFound();
  const sp = await props.searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const q = one(sp.q)?.trim() ?? "";
  const socio = Number(one(sp.socio));
  const memberId = Number.isInteger(socio) && socio > 0 ? socio : null;

  const row = await prisma.mpUnmatchedPayment.findUnique({
    where: { id: rowId },
    include: { payment: { select: { id: true, member: { select: { id: true, fullName: true } }, receipt: { select: { id: true, number: true } } } }, resolvedBy: { select: { name: true } } },
  });
  if (!row) notFound();
  const reason = row.reason as UnmatchedReason;
  const open = row.status === "open";

  const [hits, member] = await Promise.all([
    open && memberId === null ? searchMembers(prisma, q) : Promise.resolve([]),
    open && memberId !== null ? prisma.member.findUnique({ where: { id: memberId }, include: { memberships: { include: { book: true } } } }) : Promise.resolve(null),
  ]);
  const account = member ? await fetchMemberAccount(prisma, member, await feeValueReader.current()) : null;

  return (
    <div className="space-y-4">
      <Link className="text-sm text-primary hover:underline" href={BASE}>← Sin conciliar</Link>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Pago de Mercado Pago</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="font-mono text-3xl tabular-nums">{formatARS(Number(row.amount))}</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <dt className="text-muted-foreground">Cobrado</dt><dd>{formatDateAR(row.paidAt)}</dd>
              <dt className="text-muted-foreground">Pagador</dt><dd className="break-all">{row.payerEmail ?? "—"}</dd>
              <dt className="text-muted-foreground">Referencia</dt><dd className="font-mono text-xs">{row.externalReference ?? "—"}</dd>
              <dt className="text-muted-foreground">Descripción</dt><dd>{row.description ?? "—"}</dd>
              <dt className="text-muted-foreground">Id de pago</dt><dd className="font-mono text-xs">{row.mpPaymentId}</dd>
              {row.preapprovalId && (<><dt className="text-muted-foreground">Suscripción</dt><dd><Link className="font-mono text-xs text-primary hover:underline" href="/admin/tesoreria/suscripciones">{row.preapprovalId}</Link></dd></>)}
              <dt className="text-muted-foreground">Estado</dt><dd><Badge variant={open ? "default" : "outline"}>{UNMATCHED_STATUS_LABELS[row.status]}</Badge></dd>
            </dl>
            <FormMessage kind="warning" box as="div" role="none">
              <p className="font-medium">{UNMATCHED_REASON_LABELS[reason] ?? row.reason}</p>
              <p className="mt-1">{REASON_HELP[reason] ?? ""}</p>
            </FormMessage>
          </CardContent>
        </Card>

        {!open ? (
          <Card>
            <CardHeader><CardTitle>{row.status === "matched" ? "Aplicado" : "Descartado"}</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>{row.resolvedAt ? formatDateAR(row.resolvedAt) : "—"}{row.resolvedBy ? ` · ${row.resolvedBy.name}` : " · automático"}</p>
              {row.payment?.member && <p>Socio: <Link className="text-primary hover:underline" href={`/admin/socios/${row.payment.member.id}?tab=cuenta`}>{row.payment.member.fullName}</Link></p>}
              {row.payment?.receipt && <p>Recibo: <Link className="font-mono text-primary hover:underline" href={`/admin/tesoreria/recibos/${row.payment.receipt.id}`}>{row.payment.receipt.number}</Link></p>}
            </CardContent>
          </Card>
        ) : member && account ? (
          <Card>
            <CardHeader><CardTitle>{member.fullName}</CardTitle></CardHeader>
            <CardContent className="space-y-4 text-sm">
              <p>N° {member.memberships.find((m) => m.book.status === "open")?.memberNumber ?? "—"} · {CATEGORY_LABELS[member.category]} · {STATUS_LABELS[member.status]}</p>
              <p>Cuotas pendientes: <span className="font-mono tabular-nums">{account.pendingCount}</span>
                {account.debt !== null && account.pendingCount > 0 && <> · deuda <span className="font-mono tabular-nums">{formatARS(account.debt)}</span></>}</p>
              <p><Link className="text-primary hover:underline" href={`${BASE}/${row.id}`}>Elegir otro socio</Link></p>
              <ResolveForm rowId={row.id} memberId={member.id} amount={Number(row.amount)} pendingCount={account.pendingCount} withdrawn={member.status === "withdrawn"} feeAmount={account.feeAmount} />
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader><CardTitle>¿De qué socio es este pago?</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <form className="flex flex-wrap items-end gap-2" method="get">
                <Input name="q" placeholder="Número, apellido o DNI" defaultValue={q} className="w-64" autoFocus />
                <Button type="submit" variant="secondary">Buscar socio</Button>
              </form>
              {q === "" ? (
                <EmptyState size="card" description="Buscá al socio por número, apellido o DNI. El email del pagador suele ser la pista." />
              ) : hits.length === 0 ? (
                <EmptyState description="Ningún socio coincide con la búsqueda." />
              ) : (
                <ul className="divide-y rounded-xl border">
                  {hits.map((h) => (
                    <li key={h.id}>
                      <Link href={`${BASE}/${row.id}?socio=${h.id}`}
                        className="flex min-h-11 flex-wrap items-center gap-x-3 px-3 py-2 text-sm hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring outline-hidden">
                        <span className="font-mono tabular-nums">N° {h.memberNumber}</span>
                        <span className="font-medium">{h.fullName}</span>
                        <span className="text-muted-foreground">{h.dni ?? "sin DNI"} · {CATEGORY_LABELS[h.category]}</span>
                        <Badge variant={memberStatusBadgeVariant(h.status)}>{STATUS_LABELS[h.status]}</Badge>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: `resolve-form.tsx`** (cliente; dos actions: aplicar y descartar, el descarte dentro de un `<details>`)

```tsx
"use client";
import { useActionState } from "react";
import { FormMessage } from "@/components/admin/form-message";
import { SelectField, TextField, useSyncedForm } from "@/components/admin/synced-fields";
import { Button } from "@/components/ui/button";
import { formatARS } from "@/lib/format";
import { dismissUnmatchedAction, resolveUnmatchedAction } from "./actions";

const digits = (v: string) => v.replace(/\D/g, "");

export function ResolveForm({ rowId, memberId, amount, pendingCount, withdrawn, feeAmount }: {
  rowId: number; memberId: number; amount: number; pendingCount: number; withdrawn: boolean; feeAmount: number | null;
}) {
  const [state, formAction, pending] = useActionState(resolveUnmatchedAction, {});
  const [dState, dAction, dPending] = useActionState(dismissUnmatchedAction, {});
  // Por defecto, lo que el monto sugiere: cuántas cuotas entran en lo cobrado
  // (mínimo 1). Un cesante sólo puede cubrir pendientes.
  const suggested = feeAmount ? Math.max(1, Math.min(60, Math.floor(amount / feeAmount))) : 1;
  const { values, formRef, field } = useSyncedForm({ concept: "fees", count: String(withdrawn ? Math.min(suggested, pendingCount) : suggested), note: "" });
  const concepts: Array<[string, string]> = withdrawn
    ? [["fees", "Cuotas sociales (deuda congelada)"]]
    : [["fees", "Cuotas sociales"], ["voluntary", "Aporte voluntario"]];
  return (
    <div className="space-y-4">
      <form ref={formRef} action={formAction} className="space-y-3">
        <input type="hidden" name="rowId" value={rowId} />
        <input type="hidden" name="memberId" value={memberId} />
        <SelectField label="Aplicar como" field={field("concept")} options={concepts} />
        {values.concept === "fees" && (
          <TextField label="Cantidad de cuotas" field={field("count", digits)} inputMode="numeric" maxLength={2}
            hint={withdrawn ? `Dado de baja: como máximo ${pendingCount}.` : pendingCount > 0 ? `Debe ${pendingCount}. Se imputan a las más antiguas.` : "Está al día: se imputa al período corriente y siguientes."} />
        )}
        <TextField label="Nota (opcional)" field={field("note")} maxLength={200} />
        <p className="text-sm">Se registra un pago de <span className="font-mono font-semibold tabular-nums">{formatARS(amount)}</span> con recibo, fechado el día del cobro en Mercado Pago.</p>
        {state.error && <FormMessage kind="error" box>{state.error}</FormMessage>}
        <Button type="submit" disabled={pending}>{pending ? "Aplicando…" : "Aplicar y emitir recibo"}</Button>
      </form>
      <details className="rounded-md border px-3">
        <summary className="cursor-pointer py-3 text-sm font-medium">Descartar este pago</summary>
        <form action={dAction} className="space-y-3 pb-3">
          <input type="hidden" name="rowId" value={rowId} />
          <TextField label="Motivo" field={{ id: "dismiss-reason", name: "reason", value: undefined as never, onChange: () => {} }} maxLength={200} />
          {dState.error && <FormMessage kind="error">{dState.error}</FormMessage>}
          <Button type="submit" variant="destructive" disabled={dPending}>{dPending ? "Descartando…" : "Descartar"}</Button>
        </form>
      </details>
    </div>
  );
}
```

Nota: el `TextField` del motivo de descarte es un campo no controlado a propósito (el `<details>` se cierra al resetear, no hay valor que preservar); si `TextField` exige un `FieldBinding` completo, usar un `<Input name="reason">` con `<label>` directo en vez de `TextField`.

- [ ] **Step 5: `actions.ts`**

```ts
"use server";
// Resolver una fila de la bandeja (spec 4B §7): aplicar a un socio como N
// cuotas o aporte voluntario —con el mpPaymentId y la fecha REAL del cobro—, o
// descartar con motivo. La auditoría lleva ids y montos, nunca el email del
// pagador.
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth/require-admin";
import { parseForm } from "@/lib/forms";
import { prisma } from "@/lib/prisma";
import { sendReceiptEmail } from "@/lib/treasury/receipt-email";
import { treasuryService, TreasuryError } from "@/lib/treasury/service";

type State = { error?: string };
const BASE = "/admin/tesoreria/sin-conciliar";

const resolveSchema = z.object({
  rowId: z.coerce.number("Fila inválida.").int("Fila inválida.").positive("Fila inválida."),
  memberId: z.coerce.number("Elegí a qué socio se le aplica.").int("Elegí a qué socio se le aplica.").positive("Elegí a qué socio se le aplica."),
  concept: z.enum(["fees", "voluntary"], { error: "Elegí cómo aplicar el pago." }),
  count: z.coerce.number("Indicá cuántas cuotas.").int("La cantidad tiene que ser un número entero.").positive("Indicá cuántas cuotas.").max(60, "Como máximo 60 cuotas.").optional(),
  note: z.string().max(200, "La nota no puede superar los 200 caracteres.").optional(),
});

export async function resolveUnmatchedAction(_prev: State, formData: FormData): Promise<State> {
  const actor = await requireAdmin();
  if (!actor.ok) return { error: actor.error };
  const parsed = parseForm(resolveSchema, formData);
  if (!parsed.ok) return { error: parsed.error };
  const d = parsed.data;
  if (d.concept === "fees" && !d.count) return { error: "Indicá cuántas cuotas." };

  const row = await prisma.mpUnmatchedPayment.findUnique({ where: { id: d.rowId } });
  if (!row) return { error: "La fila ya no existe." };
  if (row.status !== "open") return { error: "Esta fila ya fue resuelta." };

  let result;
  try {
    result = await treasuryService.registerPayment({
      memberId: d.memberId, type: d.concept === "fees" ? "link" : "voluntary", n: d.concept === "fees" ? (d.count ?? 1) : 0,
      amount: Number(row.amount), paidAt: row.paidAt, mpPaymentId: row.mpPaymentId, preapprovalId: row.preapprovalId,
      actorId: actor.actorId, note: d.note ?? null,
    });
  } catch (e) {
    if (e instanceof TreasuryError) return { error: e.message };
    console.error("[unmatched] registerPayment", e instanceof Error ? e.message : e);
    return { error: "No se pudo aplicar el pago. Reintentá en un momento." };
  }
  if (result.kind === "already_processed") return { error: "Ese cobro de Mercado Pago ya está registrado como pago." };
  if (result.kind === "no_pending_withdrawn") return { error: "El socio está dado de baja y no tiene cuotas pendientes: no hay a qué imputarlo." };

  // `registerPayment` ya cerró la fila dentro de su transacción; acá se sella quién.
  await prisma.mpUnmatchedPayment.updateMany({ where: { id: row.id, status: "matched" }, data: { resolvedById: actor.actorId } });

  let emailed = "skipped";
  try { const r = await sendReceiptEmail(result.receiptId); emailed = r.sent ? "sent" : r.reason; } catch { emailed = "error"; }

  const ip = (await headers()).get("x-real-ip") ?? "unknown";
  await audit({
    userId: actor.actorId, action: "unmatched_resolve", entity: "mp_unmatched_payment", entityId: row.id,
    detail: { action: "apply", memberId: d.memberId, paymentId: result.paymentId, receiptId: result.receiptId, concept: d.concept, count: d.count ?? null, amount: result.amount, emailed }, ip,
  });
  redirect(`/admin/tesoreria/recibos/${result.receiptId}?emitido=1&email=${emailed}`);
}

const dismissSchema = z.object({
  rowId: z.coerce.number("Fila inválida.").int("Fila inválida.").positive("Fila inválida."),
  reason: z.string("Indicá el motivo del descarte.").min(3, "Indicá el motivo del descarte.").max(200, "El motivo no puede superar los 200 caracteres."),
});

export async function dismissUnmatchedAction(_prev: State, formData: FormData): Promise<State> {
  const actor = await requireAdmin();
  if (!actor.ok) return { error: actor.error };
  const parsed = parseForm(dismissSchema, formData);
  if (!parsed.ok) return { error: parsed.error };
  const { count } = await prisma.mpUnmatchedPayment.updateMany({
    where: { id: parsed.data.rowId, status: "open" },
    data: { status: "dismissed", resolvedById: actor.actorId, resolvedAt: new Date(), description: parsed.data.reason.slice(0, 200) },
  });
  if (count === 0) return { error: "Esta fila ya fue resuelta." };
  const ip = (await headers()).get("x-real-ip") ?? "unknown";
  await audit({ userId: actor.actorId, action: "unmatched_resolve", entity: "mp_unmatched_payment", entityId: parsed.data.rowId, detail: { action: "dismiss" }, ip });
  redirect(`${BASE}?estado=resueltos`);
}
```

Nota de diseño: el motivo del descarte se guarda en `description` (la descripción de MP se pisa; queda en `webhook_events` si hace falta). Es la columna que existe; no se agrega otra.

- [ ] **Step 6: Test de autorización (`tests/unmatched-actions-auth.test.ts`)**

Copiar la estructura de `tests/cash-actions-auth.test.ts`: mocks de `@/lib/prisma` (`mpUnmatchedPayment.findUnique/updateMany`), `@/lib/treasury/service` (`treasuryService.registerPayment`), `@/lib/treasury/receipt-email`, `@/lib/audit`, `@/lib/auth/require-admin`, `next/headers`, `next/navigation`. Casos: (1) sin admin, ninguna de las dos actions toca Prisma ni audita; (2) con admin, `resolveUnmatchedAction` llama a `registerPayment` con `mpPaymentId` y `paidAt` de la fila, `type: "link"`, `actorId`, audita sin `payerEmail` y redirige al recibo; (3) fila ya resuelta → error y sin `registerPayment`; (4) `dismissUnmatchedAction` con motivo corto → error del schema en castellano.

- [ ] **Step 7: Verificar en el navegador**

Con `SEED_TEST_USERS` y el seed de Task 1, abrir `/admin/tesoreria/sin-conciliar`: la fila de prueba se ve; entrar, buscar un socio, aplicar 1 cuota → redirige al recibo; volver, `?estado=resueltos` la muestra con el número de recibo; anular ese recibo desde Recibos → la fila vuelve a Pendientes. Captura de la lista y del detalle.

- [ ] **Step 8: Suite, tsc, lint, commit**

```bash
git add src/lib/admin src/app/admin/tesoreria/sin-conciliar src/app/admin/tesoreria/suscripciones tests/unmatched-actions-auth.test.ts
git commit -m "feat(m4b): unmatched inbox tab — list, detail with member search, apply as fees/voluntary, dismiss

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Suscripciones — lista y vinculación en dos pasos

> Cargar el skill `frontend-design` antes de escribir JSX.

**Files:**
- Create: `src/lib/mp/link-suggest.ts`, `src/lib/mp/link-subscription.ts`
- Replace: `src/app/admin/tesoreria/suscripciones/page.tsx`
- Create: `src/app/admin/tesoreria/suscripciones/[preapprovalId]/vincular/page.tsx`, `…/vincular/actions.ts`, `…/vincular/confirm-form.tsx`
- Create: `tests/mp-link-suggest.test.ts`, `tests/mp-link-subscription.test.ts`, `tests/subscriptions-actions-auth.test.ts`

**Interfaces:**
- Consumes: `MpGateway.searchPreapprovals/getPreapproval/searchAuthorizedPayments`, `makeUnmatchedInbox.openRowsForSubscription`, `treasuryService.registerPayment`, `sendReceiptEmail`, `searchMembers`, `subscriptionStatusBadgeVariant`, `subscriptionStatusLabel`.
- Produces:

```ts
// link-suggest.ts (puro)
export type SuggestMember = { id: number; fullName: string; email: string | null };
export function suggestMember(sub: { payerEmail: string | null; reason: string | null }, members: SuggestMember[]): SuggestMember | null;

// link-subscription.ts
export function makeSubscriptionLinker(deps: {
  db: Pick<PrismaClient, "mpSubscription" | "member" | "$transaction">;
  gateway: Pick<MpGateway, "getPreapproval">;
  inbox: Pick<ReturnType<typeof makeUnmatchedInbox>, "openRowsForSubscription">;
  treasury: Pick<TreasuryService, "registerPayment">;
  now?: () => Date;
}): {
  link(input: { preapprovalId: string; memberId: number; actorId: number }): Promise<
    | { ok: true; applied: Array<{ paymentId: number; receiptId: number }>; amount: number | null; status: string }
    | { ok: false; error: string }>;
};
export const subscriptionLinker: ReturnType<typeof makeSubscriptionLinker>;

// vincular/actions.ts
export async function linkSubscriptionAction(_prev: State, formData: FormData): Promise<State>;
// State = { error?: string; confirm?: { token: string; member: {...}; subscription: {...}; charges: { count: number; last: Date | null }; pendingRows: number } }
```

- [ ] **Step 1: Sugerencia (puro) — test y código**

`tests/mp-link-suggest.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { suggestMember } from "@/lib/mp/link-suggest";

const members = [
  { id: 14, fullName: "Perez, Mariano Ariel", email: "marianoaperez@yahoo.com.ar" },
  { id: 306, fullName: "Gomez, Martin", email: null },
  { id: 7, fullName: "Perez, Ana", email: "ana@x.com" },
];
describe("suggestMember", () => {
  it("email exacto (case-insensitive) gana", () => {
    expect(suggestMember({ payerEmail: "MarianoAPerez@yahoo.com.ar", reason: "Cuota Gomez" }, members)?.id).toBe(14);
  });
  it("sin email, apellido contenido en el reason; si hay más de uno con ese apellido, ninguno", () => {
    expect(suggestMember({ payerEmail: null, reason: "Cuota Vecinal - Gomez" }, members)?.id).toBe(306);
    expect(suggestMember({ payerEmail: null, reason: "Cuota Perez" }, members)).toBeNull();
  });
  it("nada que matchee → null", () => {
    expect(suggestMember({ payerEmail: "x@y.com", reason: "Cuota" }, members)).toBeNull();
    expect(suggestMember({ payerEmail: null, reason: null }, members)).toBeNull();
  });
});
```

`src/lib/mp/link-suggest.ts`:

```ts
// Sugerencia de socio para una suscripción sin vincular (spec 4B §8). Es una
// AYUDA, no una decisión: el operador siempre elige y confirma.
export type SuggestMember = { id: number; fullName: string; email: string | null };

function norm(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Apellido = lo que va antes de la coma en "Apellido, Nombre" (formato del padrón). */
function surnameOf(fullName: string): string {
  return norm(fullName.split(",")[0] ?? fullName).trim();
}

export function suggestMember(
  sub: { payerEmail: string | null; reason: string | null },
  members: SuggestMember[],
): SuggestMember | null {
  if (sub.payerEmail) {
    const email = sub.payerEmail.trim().toLowerCase();
    const byEmail = members.find((m) => m.email?.trim().toLowerCase() === email);
    if (byEmail) return byEmail;
  }
  if (sub.reason) {
    const reason = norm(sub.reason);
    const hits = members.filter((m) => {
      const surname = surnameOf(m.fullName);
      return surname.length >= 3 && reason.includes(surname);
    });
    // Dos socios con el mismo apellido: sugerir uno sería adivinar.
    const unique = new Set(hits.map((m) => surnameOf(m.fullName)));
    if (hits.length === 1 || (hits.length > 1 && unique.size === 1 && hits.length === 1)) return hits[0];
  }
  return null;
}
```

- [ ] **Step 2: Vinculador — test y código**

`tests/mp-link-subscription.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/mp/gateway", () => ({ mpGateway: {} }));
vi.mock("@/lib/treasury/service", () => ({ treasuryService: {} }));
import { makeSubscriptionLinker } from "@/lib/mp/link-subscription";

const NOW = new Date("2026-09-01T12:00:00Z");
function deps(over: { existing?: boolean; member?: { id: number; status: string } | null; rows?: Array<{ id: number; mpPaymentId: string; amount: number; paidAt: Date }> } = {}) {
  const tx = {
    mpSubscription: { create: vi.fn(async (a: { data: unknown }) => ({ id: 1, ...(a.data as object) })) },
    member: { update: vi.fn(async () => ({})) },
  };
  const db = {
    mpSubscription: { findUnique: vi.fn(async () => (over.existing ? { id: 9 } : null)) },
    member: { findUnique: vi.fn(async () => (over.member === undefined ? { id: 14, status: "active" } : over.member)) },
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  const gateway = { getPreapproval: vi.fn(async () => ({ id: "pre-1", status: "authorized", payerEmail: "v@x.com", externalReference: null, amount: 6000, reason: "Cuota", nextPaymentDate: null, dateCreated: null })) };
  const inbox = { openRowsForSubscription: vi.fn(async () => over.rows ?? []) };
  const treasury = { registerPayment: vi.fn(async () => ({ kind: "registered", paymentId: 1, receiptId: 2, number: "2026-00002", periods: ["2026-09"], amount: 6000, pdfWritten: true })) };
  const linker = makeSubscriptionLinker({ db: db as never, gateway: gateway as never, inbox: inbox as never, treasury: treasury as never, now: () => NOW });
  return { linker, db, tx, gateway, inbox, treasury };
}
beforeEach(() => vi.clearAllMocks());

describe("subscriptionLinker.link", () => {
  it("crea la fila vinculada a mano con los datos frescos de MP, marca autoDebit y aplica las filas de la bandeja", async () => {
    const d = deps({ rows: [{ id: 3, mpPaymentId: "777", amount: 6000, paidAt: new Date("2026-08-10T11:00:00Z") }] });
    const r = await d.linker.link({ preapprovalId: "pre-1", memberId: 14, actorId: 5 });
    expect(r).toEqual({ ok: true, applied: [{ paymentId: 1, receiptId: 2 }], amount: 6000, status: "authorized" });
    expect(d.tx.mpSubscription.create).toHaveBeenCalledWith({ data: {
      preapprovalId: "pre-1", memberId: 14, linkedManually: true, status: "authorized", amount: "6000.00",
      payerEmail: "v@x.com", externalReference: null, planId: null, lastSyncAt: NOW,
    } });
    expect(d.tx.member.update).toHaveBeenCalledWith({ where: { id: 14 }, data: { autoDebit: true } });
    expect(d.treasury.registerPayment).toHaveBeenCalledWith({
      memberId: 14, type: "debit", n: 1, amount: 6000, paidAt: new Date("2026-08-10T11:00:00Z"), mpPaymentId: "777", preapprovalId: "pre-1", actorId: 5,
    });
  });
  it("ya vinculada → error claro, sin escribir", async () => {
    const d = deps({ existing: true });
    expect(await d.linker.link({ preapprovalId: "pre-1", memberId: 14, actorId: 5 })).toEqual({ ok: false, error: "Esa suscripción ya está vinculada." });
    expect(d.db.$transaction).not.toHaveBeenCalled();
  });
  it("socio inexistente → error", async () => {
    const d = deps({ member: null });
    expect(await d.linker.link({ preapprovalId: "pre-1", memberId: 99, actorId: 5 })).toMatchObject({ ok: false });
  });
  it("una fila de bandeja que no se puede aplicar no deshace la vinculación", async () => {
    const d = deps({ rows: [{ id: 3, mpPaymentId: "777", amount: 6000, paidAt: NOW }, { id: 4, mpPaymentId: "778", amount: 6000, paidAt: NOW }] });
    d.treasury.registerPayment.mockResolvedValueOnce({ kind: "no_pending_withdrawn" });
    const r = await d.linker.link({ preapprovalId: "pre-1", memberId: 14, actorId: 5 });
    expect(r).toMatchObject({ ok: true, applied: [{ paymentId: 1, receiptId: 2 }] });
  });
});
```

`src/lib/mp/link-subscription.ts`:

```ts
// Vincular una suscripción preexistente de MP a un socio (spec 4B §8). La fila
// local se crea con los datos FRESCOS de MP (no con lo que mostró la lista), y
// después —fuera de la transacción— se aplican las filas de la bandeja que
// esperaban a este socio, una por una, cada una con su recibo.
import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { treasuryService, type TreasuryService } from "@/lib/treasury/service";
import { mpGateway, type MpGateway } from "./gateway";
import { makeUnmatchedInbox } from "./unmatched";

type Deps = {
  db: Pick<PrismaClient, "mpSubscription" | "member" | "$transaction">;
  gateway: Pick<MpGateway, "getPreapproval">;
  inbox: Pick<ReturnType<typeof makeUnmatchedInbox>, "openRowsForSubscription">;
  treasury: Pick<TreasuryService, "registerPayment">;
  now?: () => Date;
};

export function makeSubscriptionLinker(deps: Deps) {
  const now = deps.now ?? (() => new Date());
  return {
    async link(input: { preapprovalId: string; memberId: number; actorId: number }) {
      if (await deps.db.mpSubscription.findUnique({ where: { preapprovalId: input.preapprovalId }, select: { id: true } })) {
        return { ok: false as const, error: "Esa suscripción ya está vinculada." };
      }
      const member = await deps.db.member.findUnique({ where: { id: input.memberId }, select: { id: true, status: true } });
      if (!member) return { ok: false as const, error: "El socio no existe." };
      const remote = await deps.gateway.getPreapproval(input.preapprovalId);

      await deps.db.$transaction(async (tx) => {
        await tx.mpSubscription.create({
          data: {
            preapprovalId: remote.id, memberId: member.id, linkedManually: true, status: remote.status,
            amount: remote.amount === null ? null : remote.amount.toFixed(2), payerEmail: remote.payerEmail,
            externalReference: remote.externalReference, planId: null, lastSyncAt: now(),
          },
        });
        await tx.member.update({ where: { id: member.id }, data: { autoDebit: true } });
      });

      // Lo que cayó en la bandeja esperando a este socio. Cada fila es un cobro
      // real: un débito = una cuota, fechado el día que MP lo cobró.
      const rows = await deps.inbox.openRowsForSubscription({ preapprovalId: remote.id, externalReference: remote.externalReference });
      const applied: Array<{ paymentId: number; receiptId: number }> = [];
      for (const row of rows) {
        const r = await deps.treasury.registerPayment({
          memberId: member.id, type: "debit", n: 1, amount: row.amount, paidAt: row.paidAt,
          mpPaymentId: row.mpPaymentId, preapprovalId: remote.id, actorId: input.actorId,
        });
        if (r.kind === "registered") applied.push({ paymentId: r.paymentId, receiptId: r.receiptId });
        // `already_processed` y `no_pending_withdrawn` dejan la fila como está:
        // la vinculación ya es válida y el operador la ve en la bandeja.
      }
      return { ok: true as const, applied, amount: remote.amount, status: remote.status };
    },
  };
}

export const subscriptionLinker = makeSubscriptionLinker({
  db: prisma, gateway: mpGateway, inbox: makeUnmatchedInbox(prisma), treasury: treasuryService,
});
```

Run: `npx vitest run tests/mp-link-suggest.test.ts tests/mp-link-subscription.test.ts` → PASS.

- [ ] **Step 3: Lista `suscripciones/page.tsx`**

Diseño: dos bloques apilados. **"Sin vincular"** arriba (es lo accionable): tarjetas-fila con `reason` como título, monto grande, "próximo cobro DD/MM", email del pagador, y a la derecha la sugerencia ("¿Es **Perez, Mariano**?" con botón "Vincular a este socio" que va directo al paso 2 con `?socio=`) o el botón "Vincular" pelado. Si MP no responde: `FormMessage kind="warning"` "No pudimos consultar Mercado Pago; el bloque de vinculadas sale de la base." **"Vinculadas"** abajo: tabla socio (link `?tab=cuenta`) / estado (badge) / monto / último sync / "a mano" / badge `divergente` cuando `amount ≠ feeAmountFor(categoría)`.

```tsx
import Link from "next/link";
import { EmptyState } from "@/components/admin/empty-state";
import { FormMessage } from "@/components/admin/form-message";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { subscriptionStatusBadgeVariant } from "@/lib/admin/status-badges";
import { subscriptionStatusLabel } from "@/lib/admin/unmatched-labels";
import { requireAdmin } from "@/lib/auth/require-admin";
import { formatARS, formatDateAR } from "@/lib/format";
import { mpErrorLog } from "@/lib/mp/error-log";
import { mpGateway, type MpPreapproval } from "@/lib/mp/gateway";
import { suggestMember } from "@/lib/mp/link-suggest";
import { prisma } from "@/lib/prisma";
import { feeValueReader } from "@/lib/treasury/fee-values";
import { feeAmountFor } from "@/lib/treasury/rules";

export const dynamic = "force-dynamic";
export const metadata = { title: "Suscripciones — SIGeV" };

const BASE = "/admin/tesoreria/suscripciones";

export default async function SuscripcionesPage() {
  const actor = await requireAdmin();
  if (!actor.ok) return <FormMessage kind="error" box>{actor.error}</FormMessage>;

  const [linked, feeValue, members] = await Promise.all([
    prisma.mpSubscription.findMany({
      where: { memberId: { not: null } },
      include: { member: { select: { id: true, fullName: true, category: true } } },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    }),
    feeValueReader.current(),
    // Sólo para la sugerencia: ~300 filas, tres columnas.
    prisma.member.findMany({ where: { status: { not: "withdrawn" } }, select: { id: true, fullName: true, email: true } }),
  ]);

  let remote: MpPreapproval[] | null = null;
  try {
    remote = await mpGateway.searchPreapprovals({ status: "authorized" });
  } catch (e) {
    console.error("[suscripciones] no se pudo listar en MP —", mpErrorLog("searchPreapprovals", {}, e));
  }
  const known = new Set((await prisma.mpSubscription.findMany({ select: { preapprovalId: true } })).map((s) => s.preapprovalId));
  const unlinked = (remote ?? []).filter((p) => !known.has(p.id));

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Sin vincular</h2>
        {remote === null ? (
          <FormMessage kind="warning" box>No pudimos consultar Mercado Pago en este momento. Las suscripciones vinculadas salen de la base; volvé a intentar en unos minutos para ver las que faltan.</FormMessage>
        ) : unlinked.length === 0 ? (
          <EmptyState size="card" description="Todas las suscripciones activas de Mercado Pago están vinculadas a un socio." />
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {unlinked.map((p) => {
              const hint = suggestMember({ payerEmail: p.payerEmail, reason: p.reason }, members);
              return (
                <li key={p.id} className="flex flex-col gap-3 rounded-xl border bg-background p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{p.reason ?? "Suscripción sin descripción"}</p>
                      <p className="truncate text-sm text-muted-foreground">{p.payerEmail ?? "sin email"}</p>
                    </div>
                    <p className="shrink-0 font-mono text-xl tabular-nums">{p.amount !== null ? formatARS(p.amount) : "—"}</p>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Alta {p.dateCreated ? formatDateAR(p.dateCreated) : "—"} · próximo cobro {p.nextPaymentDate ? formatDateAR(p.nextPaymentDate) : "—"}
                    <span className="ml-2 font-mono text-xs">{p.id}</span>
                  </p>
                  {hint ? (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted px-3 py-2 text-sm">
                      <span>¿Es <strong>{hint.fullName}</strong>?</span>
                      <Button asChild size="sm"><Link href={`${BASE}/${p.id}/vincular?socio=${hint.id}`}>Vincular a este socio</Link></Button>
                    </div>
                  ) : (
                    <Button asChild variant="outline" className="self-start"><Link href={`${BASE}/${p.id}/vincular`}>Vincular</Link></Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Vinculadas</h2>
        {linked.length === 0 ? (
          <EmptyState description="Ninguna suscripción vinculada todavía." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Socio</TableHead><TableHead>Estado</TableHead><TableHead className="text-right">Monto</TableHead>
                <TableHead>Último sync</TableHead><TableHead>Origen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {linked.map((s) => {
                const expected = s.member && feeValue ? feeAmountFor(s.member.category, feeValue) : null;
                const divergent = expected !== null && s.amount !== null && Math.abs(Number(s.amount) - expected) >= 0.01;
                return (
                  <TableRow key={s.id}>
                    <TableCell>
                      {s.member && <Link className="text-primary hover:underline" href={`/admin/socios/${s.member.id}?tab=cuenta`}>{s.member.fullName}</Link>}
                      <span className="ml-2 font-mono text-xs text-muted-foreground">{s.preapprovalId.slice(0, 8)}…</span>
                    </TableCell>
                    <TableCell><Badge variant={subscriptionStatusBadgeVariant(s.status)}>{subscriptionStatusLabel(s.status)}</Badge></TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {s.amount !== null ? formatARS(Number(s.amount)) : "—"}
                      {divergent && <Badge variant="destructive" className="ml-2">≠ vigente {expected !== null && formatARS(expected)}</Badge>}
                    </TableCell>
                    <TableCell>{s.lastSyncAt ? formatDateAR(s.lastSyncAt) : "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{s.linkedManually ? "Vinculada a mano" : "Alta web"}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Paso 2 — `vincular/page.tsx` y `confirm-form.tsx`**

`page.tsx` (superadmin; el admin común ve el bloqueo con `FormMessage`): lee `params.preapprovalId`, `?q=` y `?socio=`. Sin `socio`: buscador de socios (mismo bloque que la bandeja; los links llevan `?socio=`). Con `socio`: carga **en el servidor** socio (nº, nombre, categoría, estado, cuotas pendientes), suscripción fresca (`getPreapproval`: estado, monto, reason; si falla → `FormMessage kind="error"` "No pudimos leer la suscripción en Mercado Pago" y sin formulario), cobros previos (`searchAuthorizedPayments`: cuenta los `processed` y el último `dateCreated`; si falla, "no disponible"), filas de bandeja abiertas (`openRowsForSubscription`). Renderiza `ConfirmForm` con todo eso ya resuelto y `token = `${preapprovalId}|${memberId}``.

`confirm-form.tsx` (cliente): un `role="group"` con borde `border-primary` que lista lo que se va a hacer en frases ("Vincular la suscripción **{reason}** ($X, {estado}) al socio **N° 14 · Perez, Mariano** (activo, {categoría})", "Mercado Pago registra {n} cobros previos; el último el {fecha}. **No se importan**: la deuda histórica ya está cargada.", "{k} pagos que estaban en la bandeja se van a aplicar ahora, uno por cuota, con su recibo."), avisos en `FormMessage kind="warning" role="none"` cuando el monto difiere del vigente o el socio está de baja, `<input type="hidden" name="confirmToken">`, botón "Vincular" + link "Volver". Foco al grupo al montar (`tabIndex={-1}` + `useEffect`).

`actions.ts`:

```ts
"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireSuperadmin } from "@/lib/auth/require-admin";
import { parseForm } from "@/lib/forms";
import { subscriptionLinker } from "@/lib/mp/link-subscription";
import { sendReceiptEmail } from "@/lib/treasury/receipt-email";

type State = { error?: string };

const schema = z.object({
  preapprovalId: z.string("Suscripción inválida.").regex(/^[a-z0-9-]{1,64}$/, "Suscripción inválida."),
  memberId: z.coerce.number("Elegí el socio.").int("Elegí el socio.").positive("Elegí el socio."),
  confirmToken: z.string("Confirmá la vinculación.").min(1, "Confirmá la vinculación."),
});

export async function linkSubscriptionAction(_prev: State, formData: FormData): Promise<State> {
  const actor = await requireSuperadmin();
  if (!actor.ok) return { error: actor.error };
  const parsed = parseForm(schema, formData);
  if (!parsed.ok) return { error: parsed.error };
  const { preapprovalId, memberId, confirmToken } = parsed.data;
  // Huella de "esto es lo que leí": no es seguridad, evita el mis-click.
  if (confirmToken !== `${preapprovalId}|${memberId}`) return { error: "Lo que confirmaste no coincide con lo que se iba a vincular. Volvé a leer y confirmá de nuevo." };

  let result;
  try {
    result = await subscriptionLinker.link({ preapprovalId, memberId, actorId: actor.actorId });
  } catch (e) {
    console.error("[suscripciones] link", e instanceof Error ? e.message : e);
    return { error: "No pudimos vincular la suscripción. Reintentá en un momento." };
  }
  if (!result.ok) return { error: result.error };

  let emailed = 0;
  for (const a of result.applied) {
    try { if ((await sendReceiptEmail(a.receiptId)).sent) emailed++; } catch { /* best-effort */ }
  }
  const ip = (await headers()).get("x-real-ip") ?? "unknown";
  await audit({
    userId: actor.actorId, action: "subscription_linked", entity: "mp_subscription", entityId: preapprovalId,
    detail: { preapprovalId, memberId, amount: result.amount, status: result.status, applied: result.applied.map((a) => a.paymentId), emailed }, ip,
  });
  redirect(`/admin/tesoreria/suscripciones?vinculada=${encodeURIComponent(preapprovalId)}&aplicados=${result.applied.length}`);
}
```

En `suscripciones/page.tsx`, leer `searchParams.vinculada` y `aplicados` y mostrar arriba un `FormMessage kind="success"`: "Suscripción vinculada. {n} pagos de la bandeja se aplicaron con recibo." (o "No había pagos esperando.").

- [ ] **Step 5: Test de autorización (`tests/subscriptions-actions-auth.test.ts`)**

Mismo patrón de `tests/fee-value-action-auth.test.ts` (mock `requireSuperadmin`). Casos: admin común → error `SUPERADMIN_BLOCKED_MESSAGE` y sin `link`; superadmin con token que no coincide → error y sin `link`; superadmin ok → `link` llamado con `{ preapprovalId, memberId, actorId }`, asiento `subscription_linked` sin nombre ni email, redirect a `?vinculada=`.

- [ ] **Step 6: Verificar en el navegador**

Local sin token de MP: la lista muestra el aviso amarillo y el bloque "Vinculadas" con la suscripción del seed. Con `MP_ACCESS_TOKEN` de sandbox (cuando esté): "Sin vincular" lista las de prueba, la sugerencia aparece si el email coincide, el paso 2 muestra los cobros previos. Capturas de los dos bloques y de la confirmación.

- [ ] **Step 7: Suite, commit**

```bash
git add src/lib/mp/link-suggest.ts src/lib/mp/link-subscription.ts src/app/admin/tesoreria/suscripciones tests/mp-link-suggest.test.ts tests/mp-link-subscription.test.ts tests/subscriptions-actions-auth.test.ts
git commit -m "feat(m4b): subscriptions tab — unlinked from MP with member hint, two-step linking that drains the inbox

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Lote REG-34 en Valores y aviso en Configuración

> Cargar el skill `frontend-design` antes de escribir JSX.

**Files:**
- Create: `src/lib/mp/fee-value-batch.ts`, `src/app/admin/tesoreria/valores/actions.ts`, `src/app/admin/tesoreria/valores/apply-batch.tsx`
- Modify: `src/app/admin/tesoreria/valores/page.tsx`, `src/app/admin/configuracion/actions.ts` (redirect de `createFeeValueAction`), `src/app/admin/configuracion/page.tsx` (mensaje)
- Create: `tests/mp-fee-value-batch.test.ts`, `tests/fee-value-batch-action-auth.test.ts`

**Interfaces:**
- Produces:

```ts
// fee-value-batch.ts
export const BATCH_SIZE = 25;
export type DivergentSubscription = { preapprovalId: string; memberId: number; fullName: string; category: MemberCategory; current: number | null; expected: number };
export async function listDivergent(db: Pick<PrismaClient, "mpSubscription">, feeValue: FeeValueAmounts): Promise<DivergentSubscription[]>;
export function makeFeeValueBatch(deps: { db: Pick<PrismaClient, "mpSubscription">; gateway: Pick<MpGateway, "updatePreapprovalAmount">; feeValues: Pick<ReturnType<typeof makeFeeValueReader>, "current">; now?: () => Date }): {
  run(input: { only?: string[] }): Promise<{ updated: number; failed: Array<{ preapprovalId: string; memberId: number; code: string }>; remaining: number }>;
};
// actions.ts
export async function applyFeeValueBatchAction(input: { only?: string[] }): Promise<{ updated: number; failed: Array<{ preapprovalId: string; memberId: number; fullName: string; code: string }>; remaining: number } | { error: string }>;
```

- [ ] **Step 1: Tests (`tests/mp-fee-value-batch.test.ts`)**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/mp/gateway", () => ({ mpGateway: {} }));
vi.mock("@/lib/treasury/fee-values", () => ({ feeValueReader: {} }));
import { BATCH_SIZE, listDivergent, makeFeeValueBatch } from "@/lib/mp/fee-value-batch";

const sub = (i: number, amount: string | null, category = "active") =>
  ({ preapprovalId: `pre-${i}`, memberId: i, status: "authorized", amount, member: { id: i, fullName: `Socio ${i}`, category } });
const value = { activeAmount: 7000, sharedAmount: 3500 };

function deps(rows: ReturnType<typeof sub>[]) {
  const db = { mpSubscription: { findMany: vi.fn(async () => rows), updateMany: vi.fn(async () => ({ count: 1 })) } };
  const gateway = { updatePreapprovalAmount: vi.fn(async () => {}) };
  const feeValues = { current: vi.fn(async () => value) };
  return { db, gateway, batch: makeFeeValueBatch({ db: db as never, gateway: gateway as never, feeValues: feeValues as never, now: () => new Date("2026-10-01T12:00:00Z") }) };
}
beforeEach(() => vi.clearAllMocks());

describe("listDivergent", () => {
  it("sólo las autorizadas con monto distinto al vigente de su categoría; incluye las vinculadas a mano y las sin monto", async () => {
    const db = { mpSubscription: { findMany: vi.fn(async () => [sub(1, "7000.00"), sub(2, "6000.00"), sub(3, "3000.00", "adherent"), sub(4, null), sub(5, "1.00", "lifetime")]) } };
    const rows = await listDivergent(db as never, value);
    expect(rows.map((r) => r.memberId)).toEqual([2, 3, 4]);
    expect(rows[0]).toMatchObject({ current: 6000, expected: 7000 });
    expect(db.mpSubscription.findMany.mock.calls[0][0].where).toMatchObject({ status: "authorized", memberId: { not: null } });
  });
});

describe("feeValueBatch.run", () => {
  it("procesa hasta 25 en serie, escribe amount+lastSyncAt por éxito y devuelve remaining", async () => {
    const d = deps(Array.from({ length: 30 }, (_, i) => sub(i + 1, "6000.00")));
    const r = await d.batch.run({});
    expect(d.gateway.updatePreapprovalAmount).toHaveBeenCalledTimes(BATCH_SIZE);
    expect(d.gateway.updatePreapprovalAmount).toHaveBeenCalledWith("pre-1", 7000);
    expect(d.db.mpSubscription.updateMany).toHaveBeenCalledWith({ where: { preapprovalId: "pre-1" }, data: { amount: "7000.00", lastSyncAt: new Date("2026-10-01T12:00:00Z") } });
    expect(r).toMatchObject({ updated: 25, failed: [], remaining: 5 });
  });
  it("un fallo de MP se reporta con código y no frena la tanda", async () => {
    const d = deps([sub(1, "6000.00"), sub(2, "6000.00")]);
    d.gateway.updatePreapprovalAmount.mockRejectedValueOnce({ message: "not allowed", status: 403, cause: [{ code: "4040", description: "x" }] });
    const r = await d.batch.run({});
    expect(r.updated).toBe(1);
    expect(r.failed).toEqual([{ preapprovalId: "pre-1", memberId: 1, code: expect.stringContaining("403") }]);
  });
  it("`only` limita a esos preapprovals (reintento de las que fallaron)", async () => {
    const d = deps([sub(1, "6000.00"), sub(2, "6000.00"), sub(3, "6000.00")]);
    const r = await d.batch.run({ only: ["pre-3"] });
    expect(d.gateway.updatePreapprovalAmount).toHaveBeenCalledTimes(1);
    expect(d.gateway.updatePreapprovalAmount).toHaveBeenCalledWith("pre-3", 7000);
    expect(r.remaining).toBe(0);
  });
  it("sin valor vigente → no toca nada", async () => {
    const d = deps([sub(1, "6000.00")]);
    (d.batch as never as { deps?: unknown });
    const feeValues = { current: vi.fn(async () => null) };
    const b = makeFeeValueBatch({ db: d.db as never, gateway: d.gateway as never, feeValues: feeValues as never });
    expect(await b.run({})).toEqual({ updated: 0, failed: [], remaining: 0 });
    expect(d.gateway.updatePreapprovalAmount).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Implementar `src/lib/mp/fee-value-batch.ts`**

```ts
// Lote REG-34 (spec 4B §10): empujar el valor vigente a las suscripciones
// vivas cuyo monto difiere. En SERIE y de a 25 por llamada: MP responde ~1 s
// por update y una action no puede vivir minutos; el cliente reinvoca hasta
// vaciar. Incluye las vinculadas a mano: el valor de cuota es uno por categoría.
import type { MemberCategory, PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { feeValueReader, type makeFeeValueReader } from "@/lib/treasury/fee-values";
import { feeAmountFor, type FeeValueAmounts } from "@/lib/treasury/rules";
import { mpErrorLog } from "./error-log";
import { mpGateway, type MpGateway } from "./gateway";

export const BATCH_SIZE = 25;

export type DivergentSubscription = {
  preapprovalId: string; memberId: number; fullName: string; category: MemberCategory;
  current: number | null; expected: number;
};

export async function listDivergent(db: Pick<PrismaClient, "mpSubscription">, feeValue: FeeValueAmounts): Promise<DivergentSubscription[]> {
  const rows = await db.mpSubscription.findMany({
    where: { status: "authorized", memberId: { not: null } },
    select: { preapprovalId: true, amount: true, member: { select: { id: true, fullName: true, category: true } } },
    orderBy: { id: "asc" },
  });
  const out: DivergentSubscription[] = [];
  for (const r of rows) {
    if (!r.member) continue;
    const expected = feeAmountFor(r.member.category, feeValue);
    if (expected === null) continue; // la categoría no paga cuota: nada que empujar
    const current = r.amount === null ? null : Number(r.amount);
    if (current !== null && Math.abs(current - expected) < 0.01) continue;
    out.push({ preapprovalId: r.preapprovalId, memberId: r.member.id, fullName: r.member.fullName, category: r.member.category, current, expected });
  }
  return out;
}

type Deps = {
  db: Pick<PrismaClient, "mpSubscription">;
  gateway: Pick<MpGateway, "updatePreapprovalAmount">;
  feeValues: Pick<ReturnType<typeof makeFeeValueReader>, "current">;
  now?: () => Date;
};

export function makeFeeValueBatch(deps: Deps) {
  const now = deps.now ?? (() => new Date());
  return {
    async run(input: { only?: string[] }) {
      const value = await deps.feeValues.current(now());
      if (!value) return { updated: 0, failed: [] as Array<{ preapprovalId: string; memberId: number; code: string }>, remaining: 0 };
      let pending = await listDivergent(deps.db, value);
      if (input.only) pending = pending.filter((p) => input.only!.includes(p.preapprovalId));
      const batch = pending.slice(0, BATCH_SIZE);
      let updated = 0;
      const failed: Array<{ preapprovalId: string; memberId: number; code: string }> = [];
      for (const p of batch) {
        try {
          await deps.gateway.updatePreapprovalAmount(p.preapprovalId, p.expected);
          await deps.db.mpSubscription.updateMany({ where: { preapprovalId: p.preapprovalId }, data: { amount: p.expected.toFixed(2), lastSyncAt: now() } });
          updated++;
        } catch (e) {
          // Código corto para la pantalla; el detalle enmascarado al log.
          const detail = mpErrorLog("updatePreapprovalAmount", { preapprovalId: p.preapprovalId, amount: p.expected }, e);
          console.error("[fee-value-batch]", detail);
          failed.push({ preapprovalId: p.preapprovalId, memberId: p.memberId, code: detail.slice(0, 80) });
        }
      }
      return { updated, failed, remaining: pending.length - batch.length };
    },
  };
}

export const feeValueBatch = makeFeeValueBatch({ db: prisma, gateway: mpGateway, feeValues: feeValueReader });
```

- [ ] **Step 3: Action (`valores/actions.ts`)**

```ts
"use server";
// Lote REG-34: superadmin, por tandas, con asiento por tanda. Se invoca desde
// el cliente con un objeto (no FormData): el botón de la pantalla reinvoca
// mientras `remaining > 0`.
import { headers } from "next/headers";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireSuperadmin } from "@/lib/auth/require-admin";
import { feeValueBatch } from "@/lib/mp/fee-value-batch";
import { prisma } from "@/lib/prisma";

const schema = z.object({ only: z.array(z.string().regex(/^[a-z0-9-]{1,64}$/)).max(200).optional() });

export type BatchResult =
  | { updated: number; failed: Array<{ preapprovalId: string; memberId: number; fullName: string; code: string }>; remaining: number }
  | { error: string };

export async function applyFeeValueBatchAction(raw: unknown): Promise<BatchResult> {
  const actor = await requireSuperadmin();
  if (!actor.ok) return { error: actor.error };
  const parsed = schema.safeParse(raw ?? {});
  if (!parsed.success) return { error: "Pedido inválido." };

  const r = await feeValueBatch.run({ only: parsed.data.only });
  // El nombre sale de la base, no del cliente, y NO va a la auditoría.
  const names = new Map((await prisma.member.findMany({ where: { id: { in: r.failed.map((f) => f.memberId) } }, select: { id: true, fullName: true } })).map((m) => [m.id, m.fullName]));
  const ip = (await headers()).get("x-real-ip") ?? "unknown";
  await audit({
    userId: actor.actorId, action: "fee_value_applied", entity: "mp_subscription",
    detail: { updated: r.updated, failed: r.failed.map((f) => ({ preapprovalId: f.preapprovalId, memberId: f.memberId, code: f.code })), remaining: r.remaining }, ip,
  });
  return { updated: r.updated, remaining: r.remaining, failed: r.failed.map((f) => ({ ...f, fullName: names.get(f.memberId) ?? `Socio ${f.memberId}` })) };
}
```

- [ ] **Step 4: UI — `apply-batch.tsx` y `valores/page.tsx`**

`apply-batch.tsx` (cliente): recibe `divergent: DivergentSubscription[]` y `superadmin: boolean`. Muestra la tabla socio / categoría / "actual → nuevo" (mono). Si `superadmin` y hay filas: botón "Aplicar valor vigente a {n} suscripciones" → abre un `role="group"` de confirmación (borde `border-primary`, "Se le va a cambiar el monto del débito a {n} vecinos en Mercado Pago. Es lo que van a ver en su resumen de tarjeta desde el próximo cobro.") con botón "Confirmar y aplicar" que dispara un bucle `while (remaining > 0)` llamando `applyFeeValueBatchAction({})`, acumulando `updated` y `failed`, con `<progress>` + "N de M" en un `FormMessage role="status"`. Al terminar: "Actualizadas N" en `kind="success"`, o `kind="warning"` "Quedaron K sin actualizar" + lista (nombre con link a la ficha + código) + botón "Reintentar las que fallaron" (llama con `only: failed.map(f => f.preapprovalId)`). Al terminar, `router.refresh()` para que la tabla se re-lea.

`valores/page.tsx`: reemplazar el párrafo que dice "llega con la siguiente fase" por: "El valor nuevo se registra desde Configuración (solo superadmin). Las suscripciones de Mercado Pago no cambian solas: se actualizan desde acá con el lote." Debajo del historial, un `<section>` "Suscripciones con monto distinto al vigente" con `<ApplyBatch divergent superadmin />` (obtener `superadmin` con `requireSuperadmin()` sin bloquear la página: `const sa = await requireSuperadmin(); const superadmin = sa.ok;`). Vacío → `EmptyState size="card"` "Todas las suscripciones cobran el valor vigente."

- [ ] **Step 5: Aviso en Configuración**

En `createFeeValueAction` (configuracion/actions.ts), el `redirect` final pasa a `redirect("/admin/configuracion?valor=1")` si no lo hace ya; en `configuracion/page.tsx`, cuando `sp.valor === "1"`, calcular `divergent = await listDivergent(prisma, current)` (si hay `current`) y mostrar `FormMessage kind="success"`: "Valor registrado. Hay {n} suscripciones de Mercado Pago para actualizar: [Ir a Valores de cuota]" (o "…y ninguna suscripción para actualizar."). Los ids de plan quedan opcionales: en `config-form.tsx` el `hint` de los dos campos pasa a "Opcional: sólo para el aviso de divergencia en Valores de cuota. El monto del alta sale de la tabla de valores."

- [ ] **Step 6: Test de autorización (`tests/fee-value-batch-action-auth.test.ts`)**

Admin común → `{ error: SUPERADMIN_BLOCKED_MESSAGE }` y sin `feeValueBatch.run`; superadmin → `run` llamado, asiento `fee_value_applied` con `updated/failed/remaining` y sin `fullName`; `only` con basura → `{ error: "Pedido inválido." }`.

- [ ] **Step 7: Verificar en el navegador**

Registrar un valor nuevo (p. ej. 6500/3200) en Configuración: aparece el aviso con el link. En Valores, la suscripción del seed figura divergente; sin token de MP, "Aplicar" falla con código y la pantalla lo lista con "Reintentar". Volver a registrar 6000/3000 para dejar el entorno como estaba. Captura.

- [ ] **Step 8: Suite, commit**

```bash
git add src/lib/mp/fee-value-batch.ts src/app/admin/tesoreria/valores src/app/admin/configuracion tests/mp-fee-value-batch.test.ts tests/fee-value-batch-action-auth.test.ts
git commit -m "feat(m4b): REG-34 batch — push current fee value to divergent subscriptions in chunks of 25 with retry

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: Wizard lee `fee_values`; adiós a la caché de planes

**Files:**
- Modify: `src/app/(public)/asociate/actions.ts` (`startPaymentAction` ~548-681), `src/app/(public)/asociate/page.tsx`, `src/app/(public)/asociate/retomar/[token]/page.tsx`, `src/app/(public)/asociate/wizard-shared.ts`
- Modify: `src/app/admin/solicitudes/actions.ts` (recategorización ~300-412)
- Delete: `src/lib/mp/plans.ts`, `tests/mp-plans.test.ts`
- Modify: `tests/application-wizard.test.ts` / `tests/asociate-wizard-client.test.ts` si mockean `@/lib/mp/plans`; `tests/application-decision-actions.test.ts` si mockea `planIdForCategory`

**Interfaces:**
- Produces: `wizard-shared.ts` exporta `export type FeeAmounts = { active: number; shared: number };` (ya no importa de `plans`). `startPaymentAction` lee `feeValueReader.current()`; sin valor → `{ error: "El valor de la cuota todavía no está configurado. Probá más tarde o consultá en la sede." }`. Escribe `MpSubscription.amount` y `externalReference` al crear; `planId: null`.

- [ ] **Step 1: Helper de montos para el wizard**

En `wizard-shared.ts`:

```ts
export type FeeAmounts = { active: number; shared: number };
```

y en `src/lib/treasury/fee-values.ts` agregar (junto al reader) una función pura:

```ts
/** Los dos montos en la forma que muestra el wizard ASOCIATE. */
export function feeAmountsForWizard(v: { activeAmount: number; sharedAmount: number } | null): { active: number; shared: number } | null {
  return v ? { active: v.activeAmount, shared: v.sharedAmount } : null;
}
```

`asociate/page.tsx` y `retomar/[token]/page.tsx`: reemplazar `getFeeAmounts()` por `feeValueReader.current().then(feeAmountsForWizard)` y el import de `@/lib/mp/plans` por `@/lib/treasury/fee-values`. Borrar el comentario de `asociate/page.tsx:20` sobre la caché.

- [ ] **Step 2: `startPaymentAction`**

Reemplazar desde `const planKey =` hasta el `catch` de `getPlan` (~567-603) por:

```ts
  // El monto sale de `fee_values` (única fuente, REG-34): es literalmente lo
  // que MP le va a debitar al vecino todos los meses. Sin valor vigente NO se
  // crea la suscripción — cobrar mal es peor que no cobrar.
  const value = await feeValueReader.current();
  if (!value) {
    return { error: "El valor de la cuota todavía no está configurado. Probá más tarde o consultá en la sede." };
  }
  const amount = feeAmountFor(app.requestedCategory, value);
  if (amount === null) return { error: "La categoría elegida no paga cuota por débito." };
```

En `createPreapproval`: `reason: subscriptionReason(null)` (el helper ya tiene respaldo cuando no hay nombre de plan; verificar su firma en `src/lib/mp/reason.ts` y, si exige string, pasar `"Cuota Vecinal Ciudadela"`), `amount`. En el `mpSubscription.create`:

```ts
      await tx.mpSubscription.create({
        data: {
          preapprovalId: sub.id, planId: null, applicationId: app.id, status: sub.status, payerEmail: app.email,
          amount: amount.toFixed(2), externalReference: `solicitud:${app.id}`,
        },
      });
```

Borrar los imports de `CONFIG_KEYS`/`configReader` si quedan sin uso; importar `feeValueReader` de `@/lib/treasury/fee-values`, `feeAmountFor` de `@/lib/treasury/rules`. `mpErrorLog("getPlan", …)` desaparece de este archivo.

- [ ] **Step 3: Recategorización (`admin/solicitudes/actions.ts`)**

Reemplazar el bloque que va de `let newPlanId` hasta el `updatePreapprovalAmount` (~325-370): el monto nuevo es `feeAmountFor(newCategory, await feeValueReader.current())`; sin valor → error "El valor de la cuota no está configurado: no se puede ajustar el débito."; `null` (categoría sin cuota) → error "Esa categoría no paga cuota por débito." Se llama `updatePreapprovalAmount(app.preapprovalId, amount)` y el `updateMany` local escribe `{ amount: amount.toFixed(2), lastSyncAt }` (ya no `planId`). En el asiento `application_recategorize`, `oldPlanId` desaparece y queda `amount`. Borrar el import de `planIdForCategory`.

- [ ] **Step 4: Borrar la caché**

```bash
git rm src/lib/mp/plans.ts tests/mp-plans.test.ts
```

Run: `npx tsc --noEmit` → arreglar todo import que quede (`step-category.tsx` importa el tipo de `wizard-shared`, ya está). Buscar con `grep -rn "mp/plans" src tests` que no quede nada.

- [ ] **Step 5: Tests**

- `tests/create-application-action.test.ts` / `tests/application-wizard.test.ts`: donde mockeaban `@/lib/mp/plans` o `mpGateway.getPlan`, ahora mockean `@/lib/treasury/fee-values` (`feeValueReader.current` → `{ activeAmount: 6000, sharedAmount: 3000 }`). Agregar un caso: `startPaymentAction` con `current()` → `null` devuelve el error de "valor no configurado" **sin** llamar a `createPreapproval`; y otro que afirma que `mpSubscription.create` recibe `amount: "6000.00"`, `externalReference: "solicitud:<id>"`, `planId: null`.
- `tests/application-decision-actions.test.ts`: la recategorización con suscripción llama `updatePreapprovalAmount(id, 6000)` leyendo `feeValueReader` y ya no `getPlan`.

- [ ] **Step 6: Verificar en el navegador**

Con `asociate_activo` tildado y **sin** ids de plan en Configuración, el paso de categoría muestra $6.000 / $3.000 y el paso 2 arma la boleta. (No hace falta llegar a MP.)

- [ ] **Step 7: Suite, commit**

```bash
git add -A src/app/\(public\)/asociate src/app/admin/solicitudes src/lib/treasury/fee-values.ts tests
git commit -m "feat(m4b): wizard and recategorization read fee_values; drop MP plan cache; plan ids optional

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: Checkout Pro — link desde la ficha (admin) y "Pagar ahora" (socio)

> Cargar el skill `frontend-design` antes de escribir JSX.

**Files:**
- Create: `src/lib/mp/payment-link.ts`, `tests/mp-payment-link.test.ts`
- Modify: `src/lib/email/templates.ts` (`paymentLinkEmail`), `src/lib/auth/rate-limiter.ts` (`memberPayLimiter`)
- Create: `src/app/admin/socios/[id]/link/page.tsx`, `…/link/actions.ts`, `…/link/link-form.tsx`, `tests/payment-link-actions-auth.test.ts`
- Modify: `src/components/admin/account-section.tsx` (botón "Generar link de pago")
- Create: `src/app/mi/cuenta/actions.ts`, `src/app/mi/cuenta/pay-form.tsx`, `src/app/mi/cuenta/return-notice.tsx`, `tests/member-pay-action.test.ts`
- Modify: `src/app/mi/cuenta/page.tsx`, `src/app/mi/page.tsx`

**Interfaces:**
- Consumes: `MpGateway.createPreference` (Task 2), `paymentLinkReference` (Task 5), `feeValueReader.current`, `feeAmountFor`, `requireMember`, `mailer.sendToMember`.
- Produces:

```ts
// payment-link.ts
export function paymentLinkTitle(n: number): string;   // "Cuota Vecinal Ciudadela × 2" (× 1 → "Cuota Vecinal Ciudadela")
export function makePaymentLinks(deps: { gateway: Pick<MpGateway, "createPreference">; feeValues: Pick<ReturnType<typeof makeFeeValueReader>, "current">; baseUrl: () => string; now?: () => Date }): {
  create(input: { member: { id: number; category: MemberCategory }; n: number }): Promise<
    | { ok: true; initPoint: string; amount: number; unit: number; reference: string }
    | { ok: false; error: "no_fee_value" | "category_without_fee" | "bad_n" }>;
};
export const paymentLinks: ReturnType<typeof makePaymentLinks>;
// templates.ts
export function paymentLinkEmail(opts: { name: string; count: number; amount: number; url: string }): Rendered;
// rate-limiter.ts
export const MEMBER_PAY_LIMIT = 5; export const memberPayLimiter: limiter por memberId, ventana 60 s
// admin link/actions.ts
export async function createPaymentLinkAction(_prev: LinkState, formData: FormData): Promise<LinkState>;   // LinkState = { error?: string; link?: { url: string; amount: number; n: number } }
export async function emailPaymentLinkAction(_prev: LinkState, formData: FormData): Promise<LinkState>;    // reenvía el link ya generado (url en hidden) — + { emailed?: true }
// mi/cuenta/actions.ts
export async function startMemberPaymentAction(_prev: PayState, formData: FormData): Promise<PayState>;   // PayState = { error?: string; redirectUrl?: string }
```

- [ ] **Step 1: Módulo puro + tests (`tests/mp-payment-link.test.ts`)**

```ts
import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/mp/gateway", () => ({ mpGateway: {} }));
vi.mock("@/lib/treasury/fee-values", () => ({ feeValueReader: {} }));
import { makePaymentLinks, paymentLinkTitle } from "@/lib/mp/payment-link";

function deps(value: { activeAmount: number; sharedAmount: number } | null = { activeAmount: 6000, sharedAmount: 3000 }) {
  const gateway = { createPreference: vi.fn(async () => ({ id: "pref-1", initPoint: "https://mp/pref-1" })) };
  const feeValues = { current: vi.fn(async () => value) };
  return { gateway, links: makePaymentLinks({ gateway: gateway as never, feeValues: feeValues as never, baseUrl: () => "https://vecinalciudadela.ar" }) };
}

describe("paymentLinkTitle", () => {
  it("singular sin multiplicador, plural con ×", () => {
    expect(paymentLinkTitle(1)).toBe("Cuota Vecinal Ciudadela");
    expect(paymentLinkTitle(3)).toBe("Cuota Vecinal Ciudadela × 3");
  });
});

describe("paymentLinks.create", () => {
  it("crea la preferencia por n × valor de la categoría con referencia pago:{id}:{n} y URLs del sitio", async () => {
    const d = deps();
    const r = await d.links.create({ member: { id: 14, category: "active" }, n: 2 });
    expect(r).toEqual({ ok: true, initPoint: "https://mp/pref-1", amount: 12000, unit: 6000, reference: "pago:14:2" });
    expect(d.gateway.createPreference).toHaveBeenCalledWith({
      title: "Cuota Vecinal Ciudadela × 2", amount: 12000, externalReference: "pago:14:2",
      backUrl: "https://vecinalciudadela.ar/mi/cuenta?volvio=1", notificationUrl: "https://vecinalciudadela.ar/api/webhooks/mp",
    });
  });
  it("adherente usa el monto compartido", async () => {
    const d = deps();
    expect(await d.links.create({ member: { id: 306, category: "adherent" }, n: 1 })).toMatchObject({ ok: true, amount: 3000 });
  });
  it("sin valor vigente / categoría sin cuota / n fuera de rango → errores sin tocar MP", async () => {
    expect(await deps(null).links.create({ member: { id: 1, category: "active" }, n: 1 })).toEqual({ ok: false, error: "no_fee_value" });
    const d = deps();
    expect(await d.links.create({ member: { id: 1, category: "lifetime" }, n: 1 })).toEqual({ ok: false, error: "category_without_fee" });
    expect(await d.links.create({ member: { id: 1, category: "active" }, n: 0 })).toEqual({ ok: false, error: "bad_n" });
    expect(await d.links.create({ member: { id: 1, category: "active" }, n: 61 })).toEqual({ ok: false, error: "bad_n" });
    expect(d.gateway.createPreference).not.toHaveBeenCalled();
  });
});
```

`src/lib/mp/payment-link.ts`:

```ts
// Links de pago de Checkout Pro (spec 4B §12). La preferencia NO se persiste:
// el pago vuelve por webhook con `pago:{memberId}:{n}` y `allocate(n)` decide
// qué cuotas cubre (las más viejas). El monto es n × valor VIGENTE de la
// categoría, de `fee_values` — nunca de un plan de MP.
import type { MemberCategory } from "@/generated/prisma/client";
import { feeValueReader, type makeFeeValueReader } from "@/lib/treasury/fee-values";
import { feeAmountFor } from "@/lib/treasury/rules";
import { mpGateway, type MpGateway } from "./gateway";
import { MAX_LINK_FEES, paymentLinkReference } from "./references";

export function paymentLinkTitle(n: number): string {
  return n === 1 ? "Cuota Vecinal Ciudadela" : `Cuota Vecinal Ciudadela × ${n}`;
}

type Deps = {
  gateway: Pick<MpGateway, "createPreference">;
  feeValues: Pick<ReturnType<typeof makeFeeValueReader>, "current">;
  baseUrl: () => string;
  now?: () => Date;
};

export function makePaymentLinks(deps: Deps) {
  const now = deps.now ?? (() => new Date());
  return {
    async create(input: { member: { id: number; category: MemberCategory }; n: number }) {
      if (!Number.isInteger(input.n) || input.n < 1 || input.n > MAX_LINK_FEES) return { ok: false as const, error: "bad_n" as const };
      const value = await deps.feeValues.current(now());
      if (!value) return { ok: false as const, error: "no_fee_value" as const };
      const unit = feeAmountFor(input.member.category, value);
      if (unit === null) return { ok: false as const, error: "category_without_fee" as const };
      const amount = unit * input.n;
      const reference = paymentLinkReference(input.member.id, input.n);
      const base = deps.baseUrl();
      const pref = await deps.gateway.createPreference({
        title: paymentLinkTitle(input.n), amount, externalReference: reference,
        backUrl: `${base}/mi/cuenta?volvio=1`, notificationUrl: `${base}/api/webhooks/mp`,
      });
      return { ok: true as const, initPoint: pref.initPoint, amount, unit, reference };
    },
  };
}

export const paymentLinks = makePaymentLinks({
  gateway: mpGateway, feeValues: feeValueReader, baseUrl: () => process.env.AUTH_URL ?? "http://localhost:3000",
});
```

Mensajes para pantalla (un mapa compartido en el mismo archivo):

```ts
export const PAYMENT_LINK_ERRORS = {
  no_fee_value: "El valor de la cuota no está configurado: no se puede generar el link.",
  category_without_fee: "Esta categoría no paga cuota: no hay nada que cobrar por link.",
  bad_n: "La cantidad de cuotas tiene que estar entre 1 y 60.",
} as const;
```

- [ ] **Step 2: Email y rate limiter**

En `templates.ts`, después de `receiptEmail`:

```ts
export function paymentLinkEmail(opts: { name: string; count: number; amount: number; url: string }): Rendered {
  const amount = formatARS(opts.amount);
  const what = opts.count === 1 ? "1 cuota social" : `${opts.count} cuotas sociales`;
  return {
    subject: `Tu link para pagar la cuota — Vecinal Ciudadela`,
    text: `Hola ${opts.name}:

Te mandamos un link para pagar ${what} por ${amount} con Mercado Pago (tarjeta, débito o dinero en cuenta):

${opts.url}

Cuando el pago se acredite te llega el recibo por este mismo medio. Si ya pagaste o tenés dudas, respondé este mensaje o acercate a la sede.${SIGNATURE}`,
    html: layout("Tu link para pagar la cuota", `<p>Hola <strong>${esc(opts.name)}</strong>:</p>
<p>Te mandamos un link para pagar <strong>${esc(what)}</strong> por <strong>${esc(amount)}</strong> con Mercado Pago (tarjeta, débito o dinero en cuenta).</p>
<p><a href="${esc(opts.url)}" style="display:inline-block;padding:12px 20px;background:#0079BC;color:#fff;border-radius:6px;text-decoration:none">Pagar con Mercado Pago</a></p>
<p style="font-size:12px;color:#555">Si el botón no funciona, copiá este enlace: ${esc(opts.url)}</p>
<p>Cuando el pago se acredite te llega el recibo por este mismo medio. Si ya pagaste o tenés dudas, respondé este mensaje o acercate a la sede.</p>`),
  };
}
```

En `rate-limiter.ts`:

```ts
export const MEMBER_PAY_LIMIT = 5
/** "Pagar ahora" del panel de socio, por memberId: cada clic crea una
 *  preferencia en MP. Cinco por minuto alcanzan para arrepentirse y volver;
 *  más que eso es un script. */
export const memberPayLimiter = createRateLimiter({ limit: MEMBER_PAY_LIMIT, windowMs: 60_000 })
```

- [ ] **Step 3: Admin — `socios/[id]/link`**

`page.tsx`: `requireAdmin`; `params.id`; carga socio + cuenta (`fetchMemberAccount`) + `feeValueReader.current()`. `PageHeader title={member.fullName}` con miga `Socios / N° X / Link de pago` y, dentro, la tarjeta "Generar link de pago" con `LinkForm`. Si `feeAmountFor === null` → `EmptyState size="card"` "Esta categoría no paga cuota: no hay link que generar." (sin formulario).

`link-form.tsx` (cliente): `n` por defecto `max(1, pendingCount)`, total en vivo (`n × feeAmount`), botón "Generar link". Con `state.link`: bloque destacado (borde `border-primary`) con la URL en un `<input readOnly>` + botón "Copiar" (`navigator.clipboard.writeText`, feedback "Copiado" en `role="status"`), el monto y "vence en 24 h en Mercado Pago si no se usa"; debajo el segundo form (`emailPaymentLinkAction`, hidden `url`, `n`, `amount`) con botón "Enviar por email" — deshabilitado con `aria-describedby` que explica "El socio no tiene email cargado" cuando corresponde. Tras enviar, `FormMessage kind="success"` "Link enviado a la casilla del socio."

`actions.ts`:

```ts
"use server";
import { headers } from "next/headers";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth/require-admin";
import { mailer } from "@/lib/email";
import { paymentLinkEmail } from "@/lib/email/templates";
import { parseForm } from "@/lib/forms";
import { mpErrorLog } from "@/lib/mp/error-log";
import { PAYMENT_LINK_ERRORS, paymentLinks } from "@/lib/mp/payment-link";
import { prisma } from "@/lib/prisma";

type LinkState = { error?: string; link?: { url: string; amount: number; n: number }; emailed?: true };

const createSchema = z.object({
  memberId: z.coerce.number("Socio inválido.").int("Socio inválido.").positive("Socio inválido."),
  n: z.coerce.number("Indicá cuántas cuotas.").int("La cantidad tiene que ser un número entero.").min(1, "Al menos una cuota.").max(60, "Como máximo 60 cuotas."),
});

export async function createPaymentLinkAction(_prev: LinkState, formData: FormData): Promise<LinkState> {
  const actor = await requireAdmin();
  if (!actor.ok) return { error: actor.error };
  const parsed = parseForm(createSchema, formData);
  if (!parsed.ok) return { error: parsed.error };
  const member = await prisma.member.findUnique({ where: { id: parsed.data.memberId }, select: { id: true, category: true } });
  if (!member) return { error: "El socio no existe." };
  let r;
  try {
    r = await paymentLinks.create({ member, n: parsed.data.n });
  } catch (e) {
    console.error("[payment-link] createPreference —", mpErrorLog("createPreference", { memberId: member.id, n: parsed.data.n }, e));
    return { error: "No pudimos crear el link en Mercado Pago. Probá de nuevo en unos minutos." };
  }
  if (!r.ok) return { error: PAYMENT_LINK_ERRORS[r.error] };
  const ip = (await headers()).get("x-real-ip") ?? "unknown";
  // Ids, cantidad y monto. El link NO va al asiento.
  await audit({ userId: actor.actorId, action: "payment_link_create", entity: "member", entityId: member.id, detail: { memberId: member.id, n: parsed.data.n, amount: r.amount, channel: "admin" }, ip });
  return { link: { url: r.initPoint, amount: r.amount, n: parsed.data.n } };
}

const emailSchema = z.object({
  memberId: z.coerce.number("Socio inválido.").int("Socio inválido.").positive("Socio inválido."),
  url: z.url("Link inválido.").max(500, "Link inválido.").refine((u) => u.startsWith("https://www.mercadopago.com") || u.startsWith("https://mpago.la") || u.startsWith("https://sandbox.mercadopago.com"), "Link inválido."),
  n: z.coerce.number("Cantidad inválida.").int("Cantidad inválida.").min(1).max(60),
  amount: z.coerce.number("Monto inválido.").positive("Monto inválido."),
});

export async function emailPaymentLinkAction(_prev: LinkState, formData: FormData): Promise<LinkState> {
  const actor = await requireAdmin();
  if (!actor.ok) return { error: actor.error };
  const parsed = parseForm(emailSchema, formData);
  if (!parsed.ok) return { error: parsed.error };
  const d = parsed.data;
  const member = await prisma.member.findUnique({ where: { id: d.memberId }, select: { id: true, fullName: true, email: true, emailStatus: true } });
  if (!member) return { error: "El socio no existe." };
  if (!member.email || member.emailStatus === "bounced") return { error: "El socio no tiene un email válido cargado." };
  try {
    await mailer.sendToMember({
      memberId: member.id, to: member.email, type: "fee_reminder",
      message: paymentLinkEmail({ name: member.fullName, count: d.n, amount: d.amount, url: d.url }),
      summary: `link de pago × ${d.n}`,
    });
  } catch (e) {
    const code = (e as { code?: unknown } | null)?.code;
    console.error("[payment-link] email", typeof code === "string" ? code : "unknown");
    return { error: "No se pudo enviar el email. El link sigue siendo válido: copialo y mandalo por otro medio.", link: { url: d.url, amount: d.amount, n: d.n } };
  }
  const ip = (await headers()).get("x-real-ip") ?? "unknown";
  await audit({ userId: actor.actorId, action: "payment_link_create", entity: "member", entityId: member.id, detail: { memberId: member.id, n: d.n, amount: d.amount, channel: "email" }, ip });
  return { link: { url: d.url, amount: d.amount, n: d.n }, emailed: true };
}
```

La `refine` de la URL es la guarda contra usar la action como relé de spam: sólo se reenvían links de MP.

`account-section.tsx`: dentro de `{admin && (…)}` agregar `<Button asChild variant="outline"><Link href={`/admin/socios/${member.id}/link`}>Generar link de pago</Link></Button>`.

- [ ] **Step 4: Socio — `/mi/cuenta`**

`mi/cuenta/actions.ts`:

```ts
"use server";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { memberPayLimiter } from "@/lib/auth/rate-limiter";
import { requireMember } from "@/lib/auth/require-member";
import { parseForm } from "@/lib/forms";
import { mpErrorLog } from "@/lib/mp/error-log";
import { PAYMENT_LINK_ERRORS, paymentLinks } from "@/lib/mp/payment-link";
import { prisma } from "@/lib/prisma";

type PayState = { error?: string; redirectUrl?: string };
const schema = z.object({
  n: z.coerce.number("Indicá cuántas cuotas querés pagar.").int("La cantidad tiene que ser un número entero.").min(1, "Al menos una cuota.").max(60, "Como máximo 60 cuotas."),
});

export async function startMemberPaymentAction(_prev: PayState, formData: FormData): Promise<PayState> {
  const actor = await requireMember();
  if (!actor.ok) return { error: actor.error };
  if (!memberPayLimiter.check(String(actor.memberId))) return { error: "Demasiados intentos seguidos. Esperá un minuto y volvé a probar." };
  const parsed = parseForm(schema, formData);
  if (!parsed.ok) return { error: parsed.error };
  const member = await prisma.member.findUniqueOrThrow({ where: { id: actor.memberId }, select: { id: true, category: true } });
  let r;
  try {
    r = await paymentLinks.create({ member, n: parsed.data.n });
  } catch (e) {
    console.error("[mi/cuenta] createPreference —", mpErrorLog("createPreference", { memberId: member.id, n: parsed.data.n }, e));
    return { error: "No pudimos iniciar el pago en Mercado Pago. Probá de nuevo en unos minutos." };
  }
  if (!r.ok) return { error: PAYMENT_LINK_ERRORS[r.error] };
  await audit({ userId: actor.userId, action: "payment_link_create", entity: "member", entityId: member.id, detail: { memberId: member.id, n: parsed.data.n, amount: r.amount, channel: "member" } });
  return { redirectUrl: r.initPoint };
}
```

`pay-form.tsx` (cliente): recibe `pendingCount`, `feeAmount`, `oldestPending`. `n` por defecto `max(1, pendingCount)`; el hint dice "Debés N cuotas desde {mes}. Podés pagar menos: se imputan a las más viejas." o "Estás al día: pagás el mes en curso por adelantado."; total en vivo; botón "Pagar con Mercado Pago" (`pending || leaving` → "Abriendo Mercado Pago…"); `useEffect` con `window.location.assign(state.redirectUrl)`. Texto corto debajo: "Te lleva a Mercado Pago. Cuando el pago se acredite, el recibo aparece acá y te llega por email."

`return-notice.tsx` (cliente): se monta sólo con `?volvio=1`. `FormMessage kind="neutral" box role="status"` con un spinner (`motion-reduce:animate-none`) y "Si el pago salió bien, el recibo aparece acá en unos segundos." Sondeo: `router.refresh()` cada 5 s hasta 24 veces, sólo con `document.visibilityState === "visible"`; recibe `paymentsCount` como prop y, cuando el padre re-renderiza con un número mayor, muestra "¡Listo! Tu pago quedó registrado." en `kind="success"` y deja de sondear. Al agotar: "Todavía no nos llegó la confirmación. Puede demorar unos minutos; [Volver a consultar]" (botón que hace `router.refresh()`).

`mi/cuenta/page.tsx`: leer `searchParams.volvio`; la bajada pasa a "Tus cuotas y tus recibos. Podés pagar acá con Mercado Pago o en la sede."; debajo del `AccountSection`, `<section id="pagar">` con `Card` "Pagar ahora" que contiene `PayForm` (si `account.feeAmount !== null`) o `EmptyState size="card"` "Tu categoría no paga cuota." Arriba del todo, `<ReturnNotice paymentsCount={account.payments.length} />` cuando `volvio === "1"`.

`mi/page.tsx`: la tarjeta "Pagar" pasa a `{ title: "Pagar", description: "Pagá tu cuota social con Mercado Pago.", href: "/mi/cuenta#pagar" }` y el link dice "Pagar ahora →" (el array gana un campo `cta` opcional; por defecto "Ver →"). La bajada del `<h1>` pasa a "Acá ves tus datos, el estado de tu cuota y podés pagar con Mercado Pago."

- [ ] **Step 5: Tests de actions**

`tests/payment-link-actions-auth.test.ts`: sin admin, ninguna action toca `paymentLinks` ni `mailer`; con admin, `createPaymentLinkAction` devuelve `link` y audita sin URL; `emailPaymentLinkAction` con una URL que no es de MP → error del schema y sin `sendToMember`; socio sin email → error y sin envío.

`tests/member-pay-action.test.ts`: sin socio (`requireMember` ko) → error y sin `create`; rate limit superado → error y sin `create`; ok → `redirectUrl` y asiento `payment_link_create` con `channel: "member"`; `n` fuera de rango → mensaje en castellano.

- [ ] **Step 6: Verificar en el navegador**

Local sin token: `/mi/cuenta` muestra "Pagar ahora" con el total; al enviar, el error "No pudimos iniciar el pago…" (MP rechaza sin token) — correcto. Admin: `/admin/socios/14/link` genera (con sandbox) y muestra el link, "Copiar" funciona, "Enviar por email" deshabilitado con explicación si no hay email. Con sandbox y la URL pública de `docs/11` §4: pagar con tarjeta de prueba y disparar el `payment` a mano → la cuenta muestra el pago y `?volvio=1` lo detecta. Capturas de `/mi/cuenta` (antes y con `volvio`), y de la pantalla admin.

- [ ] **Step 7: Suite, commit**

```bash
git add src/lib/mp/payment-link.ts src/lib/email/templates.ts src/lib/auth/rate-limiter.ts src/app/admin/socios/\[id\]/link src/components/admin/account-section.tsx src/app/mi tests
git commit -m "feat(m4b): Checkout Pro — admin payment link with email, member 'Pagar ahora' with return polling

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 13: Ficha del socio y avisos de débito

> Cargar el skill `frontend-design` antes de escribir JSX.

**Files:**
- Modify: `src/app/admin/socios/[id]/page.tsx`, `src/components/admin/account-section.tsx`, `src/lib/members/auto-debit.ts`, `tests/member-auto-debit.test.ts`

**Interfaces:**
- `AccountSection` gana la prop opcional `subscription?: { preapprovalId: string; status: string; amount: number | null; nextPaymentDate: Date | null; linkedManually: boolean } | null` (sólo admin la pasa).

- [ ] **Step 1: La línea de débito en Cuenta corriente**

En `socios/[id]/page.tsx`, sumar al `Promise.all` la suscripción viva: `prisma.mpSubscription.findFirst({ where: { memberId, status: { in: ["authorized", "paused"] } }, orderBy: { createdAt: "desc" }, select: { preapprovalId: true, status: true, amount: true, linkedManually: true } })` y pasarla como `subscription={sub ? { ...sub, amount: sub.amount === null ? null : Number(sub.amount), nextPaymentDate: null } : null}`. (`nextPaymentDate` no se guarda localmente; la línea dice "próximo cobro" sólo si un día se persiste — por ahora se omite si es null.)

En `account-section.tsx`, debajo del bloque de deuda y antes de la cinta, cuando `admin`:

```tsx
      {admin && (
        <p className="text-sm">
          {subscription ? (
            <>
              Débito automático: <Badge variant={subscriptionStatusBadgeVariant(subscription.status)}>{subscriptionStatusLabel(subscription.status)}</Badge>
              {subscription.amount !== null && <> · <span className="font-mono tabular-nums">{formatARS(subscription.amount)}</span>/mes</>}
              <span className="ml-1 font-mono text-xs text-muted-foreground">{subscription.preapprovalId.slice(0, 8)}…</span>
              {subscription.linkedManually && <span className="ml-1 text-muted-foreground">(vinculada a mano)</span>}
            </>
          ) : (
            <>Sin débito automático. <Link className="text-primary hover:underline" href="/admin/tesoreria/suscripciones">Vincular una suscripción</Link></>
          )}
        </p>
      )}
```

- [ ] **Step 2: Textos de `AUTO_DEBIT_WARNINGS`**

```ts
export const AUTO_DEBIT_WARNINGS = {
  baja:
    "Este socio tiene débito automático en Mercado Pago. El sistema NO lo cancela (eso llega con el Módulo 5): " +
    "la cuota se le va a seguir debitando, y cada cobro se imputará a su deuda pendiente hasta agotarla; después " +
    "caerá en la bandeja Sin conciliar. Para cortar el débito, cancelá la suscripción desde el panel de Mercado Pago.",
  categoria:
    "Este socio tiene débito automático en Mercado Pago. El monto NO cambia solo con la categoría: después de " +
    "registrar el cambio, corré «Aplicar valor vigente» en Tesorería → Valores de cuota para actualizar la suscripción.",
} as const;
```

Actualizar `tests/member-auto-debit.test.ts` si afirmaba el texto literal (sólo debería afirmar `hasLiveAutoDebit`).

- [ ] **Step 3: Verificar, suite, commit**

Abrir la ficha del socio del seed → pestaña Cuenta corriente muestra la línea de débito. Captura.

```bash
git add src/app/admin/socios/\[id\]/page.tsx src/components/admin/account-section.tsx src/lib/members/auto-debit.ts tests/member-auto-debit.test.ts
git commit -m "feat(m4b): member account shows live subscription; auto-debit warnings say what now happens

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 14: Integración con MariaDB y pruebas manuales en sandbox

**Files:**
- Create: `tests/integration/mp-apply-concurrency.test.ts`
- Modify: `.superpowers/sdd/progress.md` (resultados de las pruebas manuales)

- [ ] **Step 1: Test de concurrencia real**

```ts
// Corre SOLO con DATABASE_URL_TEST. 20 llamadas concurrentes a registerPayment
// con el MISMO mpPaymentId: un solo pago, un solo recibo, y la serie del año de
// prueba avanza exactamente 1 (los perdedores chocan con la unique ANTES de
// pedir número).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "@/generated/prisma/client";
import { makeFeeValueReader } from "@/lib/treasury/fee-values";
import { makeTreasuryService } from "@/lib/treasury/service";

const url = process.env.DATABASE_URL_TEST;

describe.skipIf(!url)("registerPayment concurrency (MariaDB)", () => {
  let prisma: PrismaClient;
  let memberId: number;
  const MP_ID = "itest-777";
  const PAID_AT = new Date("1999-06-15T12:00:00Z"); // serie 1999: ningún recibo real

  beforeAll(async () => {
    prisma = new PrismaClient({ adapter: new PrismaMariaDb(url ?? "") });
    const m = await prisma.member.create({ data: { fullName: "Itest, Socio", category: "active", status: "active", joinedAt: new Date("1998-01-01") } });
    memberId = m.id;
  });
  beforeEach(async () => {
    await prisma.receipt.deleteMany({ where: { payment: { memberId } } });
    await prisma.fee.deleteMany({ where: { memberId } });
    await prisma.payment.deleteMany({ where: { memberId } });
    await prisma.receiptSequence.deleteMany({ where: { year: 1999 } });
  });
  afterAll(async () => {
    await prisma.receipt.deleteMany({ where: { payment: { memberId } } });
    await prisma.fee.deleteMany({ where: { memberId } });
    await prisma.payment.deleteMany({ where: { memberId } });
    await prisma.receiptSequence.deleteMany({ where: { year: 1999 } });
    await prisma.member.delete({ where: { id: memberId } });
    await prisma.$disconnect();
  });

  it("20 aplicaciones del mismo cobro → 1 pago, 1 recibo, serie +1", async () => {
    const svc = makeTreasuryService({
      db: prisma, feeValues: makeFeeValueReader(prisma), renderPdf: async () => new Uint8Array(), writePdf: async () => {},
    });
    const results = await Promise.all(Array.from({ length: 20 }, () =>
      svc.registerPayment({ memberId, type: "debit", n: 1, amount: 6000, paidAt: PAID_AT, mpPaymentId: MP_ID, actorId: null })));
    expect(results.filter((r) => r.kind === "registered")).toHaveLength(1);
    expect(results.filter((r) => r.kind === "already_processed")).toHaveLength(19);
    expect(await prisma.payment.count({ where: { mpPaymentId: MP_ID } })).toBe(1);
    expect(await prisma.receipt.count({ where: { payment: { memberId } } })).toBe(1);
    expect((await prisma.receiptSequence.findUnique({ where: { year: 1999 } }))?.last).toBe(1);
  });
});
```

Ojo: el mutex por socio serializa las 20 dentro del proceso, así que la mayoría verá `already_processed` por la consulta previa; para ejercitar también el P2002 real, un segundo `it` lanza las 20 con **dos instancias distintas** del servicio (`makeTreasuryService` × 2: mutex distintos, misma base) y afirma lo mismo.

Run: `DATABASE_URL_TEST="mysql://sigev:…@localhost:3306/sigev" npm run test:integration` → PASS (en PowerShell: `$env:DATABASE_URL_TEST="…"; npm run test:integration`).

- [ ] **Step 2: Pruebas manuales en sandbox local (Mariano genera el token cuando llegue acá)**

Checklist a ejecutar y anotar en el ledger, con capturas:

1. `.env` local con `MP_ACCESS_TOKEN` de sandbox (`docs/11` Parte A/B) y `MP_WEBHOOK_SECRET` cualquiera.
2. Crear en sandbox una suscripción de prueba (`POST /preapproval` con el bloque de `docs/11` Parte C adaptado, o desde el wizard con `asociate_activo`). Vincularla a un socio desde `/admin/tesoreria/suscripciones`.
3. Notificación firmada a mano (`docs/11` §7 con la URL `http://localhost:3000/api/webhooks/mp`) de tipo `subscription_authorized_payment` con un `authorized_payment` real de esa suscripción → `debit_applied`, recibo visible en la ficha, email en la consola (transporte dev).
4. Repetir la misma notificación → `ignored_duplicate` (ruta) ; cambiar `action` → `already_processed` (procesador).
5. Notificación `payment` con un `payment.id` real sin referencia → `unmatched_no_reference`; resolverla desde la bandeja.
6. Link de pago del socio desde `/mi/cuenta` con usuario `socio.prueba`, pagar con tarjeta de prueba (`docs/11` Parte G), volver con `?volvio=1`, disparar el `payment` a mano → el sondeo lo muestra.
7. Apagar el dev server, disparar nada; encenderlo y `curl -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/reconcile` → el summary recupera lo que falte; `cron_runs` tiene la fila.
8. Lote: registrar un valor nuevo en Configuración, correr "Aplicar" en Valores → la suscripción de prueba cambia de monto en el panel de MP; volver al valor anterior.
9. `payment` con `status: refunded` (reembolsar el pago de prueba desde el panel de MP o simular) → recibo anulado, cuotas pendientes, bandeja reabierta si aplica.

- [ ] **Step 3: Ledger y commit**

```bash
git add tests/integration/mp-apply-concurrency.test.ts
git commit -m "test(m4b): MariaDB concurrency — 20 applications of one MP payment yield one receipt

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 15: Documentación, despliegue y cierre de 4B

**Files:**
- Modify: `docs/04-modelo-de-datos.md`, `docs/06-integracion-mercadopago.md`, `docs/07-plan-de-etapas.md`, `docs/10-runbook-dominio-produccion.md` (§4), `docs/11-preparacion-mp-sandbox-turnstile.md` (Parte H + §7), `CLAUDE.md`, `.superpowers/sdd/progress.md`

- [ ] **Step 1: `docs/06`**

- §3: `external_reference = pago:{socio_id}:{n}` (cantidad, no períodos); `allocate(n)` decide las cuotas al llegar el pago; la preferencia no se persiste; el socio también genera el link desde `/mi/cuenta`.
- §5: vinculación real — pestaña Suscripciones, sugerencia, dos pasos, `planId: null`, la bandeja se aplica sola; las dos suscripciones vivas vinculadas el día del despliegue.
- §6: conciliación con **dos fuentes** (`payments/search` por fecha + `authorized_payments/search` por suscripción), divergencia contra `fee_values` (no contra el plan), `CronRun`, resultado visible en `/admin/salud` **(4C)** y mientras tanto en `cron_runs`/auditoría.
- §7: el lote REG-34 existe (`/admin/tesoreria/valores`), recategorización lee `fee_values`.
- §1 (nota de 4A): los ids de plan son opcionales; la caché de planes no existe más.

- [ ] **Step 2: `docs/07`**

Módulo 4 → Fase 4B: **cerrada**, con los 13 CA de la spec 4B §18 y su estado. Checklist de lanzamiento: "suscripciones preexistentes vinculadas" → hecho (fecha). Prioridad siguiente: 4C.

- [ ] **Step 3: `docs/10` §4 — reescritura (deuda del despliegue de 4A)**

Reemplazar la sección entera por el procedimiento real, en este orden y con bloques copiables SIN placeholders dentro de sentencias destructivas (toda variable va en un `SET @var := '...';` o `export VAR=...` aparte, al principio del bloque):

```
## 4. Despliegue en el VPS

### 4.1 Despliegue normal (cambios de código + migraciones)
cd /root/dev/ciudadela && git pull --ff-only && npm ci && npx prisma migrate deploy && npx prisma db seed && npm run build && pm2 restart sigev && pm2 logs sigev --lines 20 --nostream

### 4.2 Base desde cero (lo que se hizo el 22/08/2026)
1. Respaldo: scripts/backup.sh (verificar que el .sql.gz resultante se pueda leer: zcat … | head).
2. mysql: CREATE DATABASE IF NOT EXISTS sigev_rescate; y copiar configuration, users, roles, user_roles con INSERT … SELECT.
3. DROP DATABASE sigev; CREATE DATABASE sigev CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
4. npx prisma migrate deploy && npx prisma db seed
5. Restaurar las cuatro tablas desde sigev_rescate (INSERT … SELECT).
6. npx tsx scripts/import-calles.ts && npx tsx scripts/import-padron.ts --prune --yes && npx tsx scripts/import-deuda.ts
7. Controles: 278 socios, 40 calles, 3076 cuotas, 118 deudores, 4 usuarios.
8. DROP DATABASE sigev_rescate; (recién después de verificar).

### 4.3 Reglas
- Nunca un DELETE/UPDATE con un placeholder adentro de un bloque copiable.
- Nunca `db push`.
```

(Escribir los SQL completos, no este esquema: el runbook lo ejecuta Mariano a mano.)

- [ ] **Step 4: `docs/11`**

- Parte H: agregar la segunda línea del crontab:

```
# SIGeV — conciliación diaria con Mercado Pago (03:00 hora local)
0 3 * * * curl -sS --max-time 900 -X POST -H "Authorization: Bearer $(cat /root/.sigev-cron-secret)" https://vecinalciudadela.ar/api/cron/reconcile >> /var/log/sigev-cron.log 2>&1
```

y la nota "Estado del crontab tras la fase 4B: dos líneas".
- §7: el bloque de notificación firmada acepta `URL` como variable (`URL=${URL:-https://vecinalciudadela.ar}`) para apuntar a `http://localhost:3000` en local, y se agrega el ejemplo con `type=subscription_authorized_payment`.
- Nueva sección "Sandbox local para 4B": token de prueba en `.env` local, cómo crear una suscripción de prueba, qué NO hacer (ids de plan productivos con token de sandbox no sirven).

- [ ] **Step 5: `docs/04` y `CLAUDE.md`**

`docs/04`: `MpSubscription.planId/payerEmail` nullable, `MpUnmatchedPayment.preapprovalId/reason`, `Payment.mpPaymentId` como idempotencia, `CronRun` estrenado por `reconcile`.

`CLAUDE.md`: sección "Patrones que estrenó el Módulo 4 (fase 4B)":
- `registerPayment` es el ÚNICO camino que escribe pago+cuotas+recibo; Efectivo, webhook, bandeja y vinculación lo llaman.
- El procesador del webhook nunca falla por negocio; `resolve.ts` decide, suscripción antes que referencia.
- La bandeja se cierra sola al aplicar y se reabre al anular.
- `reconcile` con dos fuentes; `CronRun`.
- Links `pago:{memberId}:{n}`; preferencia no persistida.
- Prioridad actual: 4B cerrada → 4C.

- [ ] **Step 6: Runbook de despliegue de 4B (bloque para Mariano)**

En el ledger y en el mensaje final al operador:

```bash
cd /root/dev/ciudadela && git pull --ff-only && npm ci && npx prisma migrate deploy && npx prisma db seed && npm run build && pm2 restart sigev && pm2 logs sigev --lines 20 --nostream
```

```bash
crontab -l > /root/crontab.bak && (crontab -l; echo '0 3 * * * curl -sS --max-time 900 -X POST -H "Authorization: Bearer $(cat /root/.sigev-cron-secret)" https://vecinalciudadela.ar/api/cron/reconcile >> /var/log/sigev-cron.log 2>&1') | crontab - && crontab -l
```

Después: vincular `a69d4b7c9e65472bb46c0489897880af` → socio 14 y `fa4a1ba0102c4c0d9fc772920154ed5c` → socio 306 desde `/admin/tesoreria/suscripciones`; verificar "Vinculadas" con $6.000 y $3.000 sin badge divergente; correr una vez a mano el reconcile (`curl … /api/cron/reconcile`) y leer el summary.

- [ ] **Step 7: Suite final, ledger, commit**

Run: `npm test 2>&1 | tail -3 && npx tsc --noEmit && npm run lint && npm run build`

Ledger: entrada de cierre con conteo de tests, CA cumplidos (spec §18), diferidos (los que no se pudieron probar sin MP real: CA 13), y la lista de "lo que mira el 10/09".

```bash
git add docs CLAUDE.md
git commit -m "docs(m4b): MP integration docs, deployment runbook rewritten, reconcile crontab, CLAUDE.md patterns

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

Merge a `main` (`--no-ff`) lo hace Mariano después de la revisión final, como en 4A.

---

## Self-review del plan (hecho al escribirlo)

**Cobertura de la spec 4B:** §1 alcance → Tasks 1-15; §2 migración → T1; §3 núcleo → T3-T4; §4 gateway → T2; §5 resolución → T5; §6 webhook (6.1-6.6) → T6; §7 bandeja → T5 (escritura), T8 (pantalla), T3/T4 (cierre/reapertura); §8 vinculación → T9 + T13 (ficha, avisos); §9 reconcile → T7 + T15 (crontab); §10 lote → T10; §11 wizard/planes → T11; §12 Checkout Pro → T12; §13 emails → T6 (recibo a solicitud), T12 (`paymentLinkEmail`); §14 auditoría → asientos repartidos: `payment_applied/payment_refunded/link_amount_mismatch/payment_unmatched` (T6), `unmatched_resolve` (T8), `subscription_linked` (T9), `fee_value_applied` (T10), `payment_link_create` (T12), `reconcile_cron` (T7); §15 tests → cada tarea + T14; §16 docs → T15; §17 despliegue → T15; §18 CA → T14 (manual) + tests.

**Placeholders:** ninguno; los bloques de SQL de `docs/10` §4 se escriben completos en T15 (el esquema de arriba es la estructura, no el texto final — la instrucción lo dice).

**Consistencia de tipos:** `registerPayment(input: RegisterPaymentInput) → RegisterResult` (T3) se usa con esa forma en T6, T8, T9, T14. `refundPayment({ mpPaymentId, reason })` (T4) en T6. `MpPaymentDetails/MpAuthorizedPayment/MpPreapproval` (T2) en T6, T7, T9. `resolveMpPayment(facts, ctx)` y `ResolveContext` (T5) en T6. `makeUnmatchedInbox.record/openRowsForSubscription` (T5) en T6, T9. `applyPayment(payment, preapprovalId)` (T6) en T7. `UnmatchedReason` (T5) en T8 labels. `paymentLinks.create` y `PAYMENT_LINK_ERRORS` (T12) en sus dos actions. `TreasuryService` exportado en T6 y usado en T9.

**Decisiones que el implementador no debe reabrir:** la suscripción manda sobre la referencia; el procesador nunca lanza por negocio; `n` del cesante se acota en el núcleo; el motivo del descarte va en `description`; los ids de plan quedan opcionales; el lote incluye las vinculadas a mano.
