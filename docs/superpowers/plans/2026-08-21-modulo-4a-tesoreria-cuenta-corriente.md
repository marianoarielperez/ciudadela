# Módulo 4 — Fase 4A: Cuenta corriente, efectivo y recibos — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir la cuenta corriente del socio (cuotas devengadas, deuda a valor vigente), el registro de pagos en efectivo con recibo PDF numerado y enviado por email, la pantalla de deudores con cesantía en lote, el valor de cuota configurable con historial, la vista de lectura del socio en `/mi/cuenta` y los scripts que cargan el padrón definitivo y la deuda histórica.

**Architecture:** Cinco tablas nuevas (`fee_values`, `fees`, `payments`, `receipts`, `receipt_sequences`) más dos que usarán 4B/4C (`mp_unmatched_payments`, `cron_runs`) en una sola migración. Las reglas de negocio son funciones puras en `src/lib/treasury/rules.ts` (sin Prisma); un servicio con Prisma inyectado (`makeTreasuryService`) hace las escrituras transaccionales; la numeración de recibos se toma con `INSERT … ON DUPLICATE KEY UPDATE` dentro de la misma transacción (bloqueo de fila). Las pantallas heredan el shell del panel (`PageHeader`, `FormMessage`, `EmptyState`, `synced-fields`) y Tesorería usa pestañas por URL (cada pestaña es una ruta); la ficha del socio usa Radix `Tabs`.

**Tech Stack:** Next.js 16.3.1 (App Router, server actions), Prisma 7 (`@prisma/adapter-mariadb`), MariaDB 10.11 (Docker en dev), zod 4, Tailwind v4 + shadcn (radix-ui), `pdf-lib` (nuevo), nodemailer, vitest 4, ExcelJS (scripts).

Spec: `docs/superpowers/specs/2026-08-21-modulo-4-tesoreria-design.md` (secciones §2, §3, §4, §6, §7, §9, §10, §11, §12-4A).

## Global Constraints

- **UI en español es-AR** ("vos", fechas `DD/MM/AAAA` con `formatDateAR`, moneda con `formatARS` → `$ 1.234,56`). Código, variables, tablas, commits en inglés.
- **Mensajes de zod en castellano** en todo schema de server action (el texto va a pantalla tal cual).
- **Autorización en cada página y cada server action** (`requireAdmin` / `requireSuperadmin` / `requireMember`), nunca solo en el layout.
- **`redirect()` siempre fuera de `try`** (señaliza con una excepción).
- **Auditoría** con `audit()` de `@/lib/audit`: `detail` solo con ids, códigos, contadores, montos. **Nunca DNI, email ni domicilios** (Ley 25.326).
- **En módulos puros el cliente de Prisma se INYECTA** (`makeX(db)`); los singletons (`prisma`, `mailer`, `audit`) solo se importan en rutas, actions y scripts. Todo test que importe un módulo con singleton mockea `@/lib/prisma` **antes** de importar.
- **Fechas civiles** como mediodía UTC (`civilDateUtc`). Zona horaria de negocio `America/Argentina/Buenos_Aires`. Los tests corren con `TZ=UTC`.
- **Dinero** en `Decimal(10,2)`; en TypeScript se convierte con `Number(x)` al leer y se escribe como `new Prisma.Decimal(n.toFixed(2))` o string `"6000.00"`.
- **Migraciones con `prisma migrate dev`** (nunca `db push`). Una sola migración en esta fase: `add_module_4_treasury`.
- **No usar verde/ámbar crudo de Tailwind**: tokens `--success`, `--warning`, `--destructive`.
- **Nunca renderizar un `thead` sin filas**: `EmptyState size="list"` reemplaza la tabla.
- **Targets ≥ 44px**, `aria-current="page"` en pestañas activas, foco visible (`focus-visible:ring`).
- **Cifras** (montos, cantidades de cuotas, números de recibo) en `font-mono tabular-nums`.
- Todos los tests con `npm test` (vitest run) tienen que seguir en verde: hoy son 88 archivos / 1191 tests.
- Commits pequeños y frecuentes, mensajes en inglés, con el pie `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Branch de trabajo: `feat/m4a-treasury` desde `main`.

## Mapa de archivos

**Crear**
- `prisma/migrations/<ts>_add_module_4_treasury/migration.sql` (generada)
- `src/lib/treasury/periods.ts` — períodos `"YYYY-MM"`: actual en AR, suma, rango, etiqueta
- `src/lib/treasury/rules.ts` — reglas puras (devengo, deuda, mora, imputación, reversión)
- `src/lib/treasury/labels.ts` — etiquetas es-AR de enums y conceptos
- `src/lib/treasury/fee-values.ts` — lector del valor vigente + historial (Prisma inyectado)
- `src/lib/treasury/account.ts` — cuenta corriente de un socio + grilla de períodos
- `src/lib/treasury/receipt-number.ts` — formato y secuencia sin huecos
- `src/lib/treasury/receipts-dir.ts` — `RECEIPTS_DIR`, escritura/lectura del PDF
- `src/lib/treasury/amount-words.ts` — monto en letras
- `src/lib/treasury/receipt-pdf.ts` — generador con `pdf-lib`
- `src/lib/treasury/service.ts` — `makeTreasuryService(db)`: efectivo, anulación
- `src/lib/treasury/receipt-email.ts` — arma y envía el email del recibo con adjunto
- `src/lib/treasury/debtors.ts` — consulta de deudores
- `src/lib/treasury/debt-import.ts` — planificador puro del import de deuda
- `src/lib/admin/pagination.ts` — helper de paginación por querystring
- `src/lib/admin/treasury-tabs.ts` — pestañas de Tesorería (config declarativa)
- `src/components/admin/treasury-tabs.tsx` — barra de pestañas por URL
- `src/components/admin/period-strip.tsx` — cinta de períodos (tabla semántica)
- `src/components/admin/account-section.tsx` — resumen + cinta + libro de pagos (admin y socio)
- `src/components/admin/member-tabs.tsx` — pestañas Radix de la ficha con `?tab=`
- `src/app/admin/tesoreria/{layout,page}.tsx`
- `src/app/admin/tesoreria/deudores/{page.tsx,actions.ts,arrears-form.tsx}`
- `src/app/admin/tesoreria/efectivo/{page.tsx,actions.ts,cash-form.tsx}`
- `src/app/admin/tesoreria/recibos/{page.tsx,[id]/page.tsx,[id]/actions.ts,[id]/receipt-actions.tsx}`
- `src/app/admin/tesoreria/valores/page.tsx`
- `src/app/api/admin/recibos/[id]/route.ts`, `src/app/api/mi/recibos/[id]/route.ts`
- `src/app/mi/cuenta/page.tsx`
- `scripts/import-deuda.ts`
- `tests/treasury-*.test.ts`, `tests/integration/receipt-sequence.test.ts`, etc.

**Modificar**
- `prisma/schema.prisma`, `prisma/seed.ts`
- `src/lib/config.ts` (sin claves nuevas; se documenta que los ids de plan quedan opcionales)
- `src/app/admin/configuracion/{actions.ts,config-form.tsx,page.tsx}` — sección "Tesorería — valor de cuota"
- `src/lib/email/transport.ts` (adjuntos), `src/lib/email/templates.ts` (`receiptEmail`)
- `src/lib/admin/{nav.ts,dashboard-cards.ts,status-badges.ts}`, `src/components/admin/admin-nav-list.tsx`
- `src/lib/members/rules.ts` (REG-07 con deuda), `src/lib/members/service.ts`, `src/app/admin/socios/[id]/actions.ts`, `src/app/admin/socios/[id]/[accion]/page.tsx`
- `src/lib/applications/eligibility.ts` + su caller `src/app/(public)/asociate/actions.ts`
- `src/app/admin/socios/[id]/page.tsx` (pestañas + cuenta corriente)
- `src/app/mi/page.tsx` (tarjeta "Mi cuenta" con href)
- `scripts/import-padron.ts` (constantes + `--prune`)
- `.env.example`, `.gitignore` (ya ignora `recibos/`), `CLAUDE.md`, `docs/04`, `docs/05`, `docs/07`, `docs/11`
- `tests/admin-nav.test.ts`, `tests/dashboard-cards.test.ts`, `tests/member-rules.test.ts`, `tests/application-eligibility.test.ts`, `tests/email.test.ts`

---

### Task 0: Branch y dependencia

**Files:** `package.json`, `package-lock.json`

- [ ] **Step 1: Crear el branch**

```bash
git checkout -b feat/m4a-treasury main
```

- [ ] **Step 2: Instalar `pdf-lib`**

```bash
npm install pdf-lib@^1.17.1
```

Expected: `package.json` lista `"pdf-lib": "^1.17.1"` en `dependencies`. `pdf-lib` es JS puro (sin binarios), así que no cambia nada en el VPS.

- [ ] **Step 3: Verificar que la suite sigue verde**

```bash
npm test
```

Expected: `Test Files 88 passed` / `Tests 1191 passed`.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(m4): add pdf-lib for receipt generation

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 1: Schema y migración nº 7

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_module_4_treasury/migration.sql` (la genera Prisma)

**Interfaces:**
- Produces: modelos `FeeValue`, `Fee`, `Payment`, `Receipt`, `ReceiptSequence`, `MpUnmatchedPayment`, `CronRun`; enums `FeeStatus`, `FeeOrigin`, `PaymentType`, `PaymentStatus`, `UnmatchedStatus`; `NotificationStatus.failed`, `Notification.error`, `NotificationType.payment_rejected | board_digest`; `MpSubscription.amount`, `MpSubscription.externalReference`; relaciones `Member.fees`, `Member.payments`, `Application.payments`, `Minute.feeValues`.

- [ ] **Step 1: Agregar los enums y modelos al final de `prisma/schema.prisma`**

Al final del archivo, después de `WebhookEvent`:

```prisma
// ── Módulo 4: Tesorería ──────────────────────────────────────────────────────

enum FeeStatus {
  pending
  paid
  exempt
  voided
}

// `import` = cuota sintética creada por scripts/import-deuda.ts a partir de
// datos/deuda.xlsx (conteo por año asignado a los últimos N meses del año).
enum FeeOrigin {
  accrual
  import
}

enum PaymentType {
  debit
  link
  cash
  voluntary
  entry
  extraordinary
}

// `voided` = efectivo anulado desde el panel; `refunded` = reembolso en MP (4B).
enum PaymentStatus {
  applied
  refunded
  voided
}

enum UnmatchedStatus {
  open
  matched
  dismissed
}

// Historial de valores de cuota (REG-34). El vigente es el de mayor `validFrom`
// ≤ hoy. ÚNICA fuente de montos: devengo, deuda, wizard, efectivo, lote a MP.
model FeeValue {
  id           Int      @id @default(autoincrement())
  activeAmount Decimal  @map("active_amount") @db.Decimal(10, 2)
  // Adherente y colaborador comparten monto (decisión del cliente).
  sharedAmount Decimal  @map("shared_amount") @db.Decimal(10, 2)
  validFrom    DateTime @map("valid_from")
  minuteId     Int?     @map("minute_id")
  minute       Minute?  @relation(fields: [minuteId], references: [id], onDelete: SetNull)
  createdById  Int?     @map("created_by_id")
  createdBy    User?    @relation("FeeValueCreatedBy", fields: [createdById], references: [id], onDelete: SetNull)
  createdAt    DateTime @default(now()) @map("created_at")

  @@index([validFrom])
  @@map("fee_values")
}

// Cuota devengada. Sin monto a propósito: la deuda se valúa SIEMPRE a valor
// vigente al momento del pago (REG-16 generalizado, spec §2.2).
model Fee {
  id        Int       @id @default(autoincrement())
  memberId  Int       @map("member_id")
  member    Member    @relation(fields: [memberId], references: [id], onDelete: Cascade)
  period    String    @db.Char(7) // "YYYY-MM"
  status    FeeStatus @default(pending)
  origin    FeeOrigin @default(accrual)
  paymentId Int?      @map("payment_id")
  payment   Payment?  @relation(fields: [paymentId], references: [id], onDelete: SetNull)
  createdAt DateTime  @default(now()) @map("created_at")
  updatedAt DateTime  @updatedAt @map("updated_at")

  @@unique([memberId, period])
  @@index([status])
  @@index([memberId, status])
  @@map("fees")
}

model Payment {
  id             Int           @id @default(autoincrement())
  memberId       Int?          @map("member_id")
  member         Member?       @relation(fields: [memberId], references: [id], onDelete: SetNull)
  applicationId  Int?          @map("application_id")
  application    Application?  @relation(fields: [applicationId], references: [id], onDelete: SetNull)
  type           PaymentType
  amount         Decimal       @db.Decimal(10, 2)
  paidAt         DateTime      @map("paid_at")
  mpPaymentId    String?       @unique @map("mp_payment_id") @db.VarChar(64)
  preapprovalId  String?       @map("preapproval_id") @db.VarChar(64)
  registeredById Int?          @map("registered_by_id")
  registeredBy   User?         @relation("PaymentRegisteredBy", fields: [registeredById], references: [id], onDelete: SetNull)
  note           String?       @db.VarChar(200)
  status         PaymentStatus @default(applied)
  createdAt      DateTime      @default(now()) @map("created_at")
  fees           Fee[]
  receipt        Receipt?

  @@index([memberId, paidAt])
  @@map("payments")
}

// Serie única AAAA-NNNNN. Nunca se borra ni se renumera: se anula.
model Receipt {
  id         Int       @id @default(autoincrement())
  number     String    @unique @db.Char(10)
  year       Int       @db.SmallInt
  seq        Int
  paymentId  Int       @unique @map("payment_id")
  payment    Payment   @relation(fields: [paymentId], references: [id], onDelete: Restrict)
  pdfPath    String?   @map("pdf_path") @db.VarChar(255)
  issuedAt   DateTime  @default(now()) @map("issued_at")
  emailedAt  DateTime? @map("emailed_at")
  voidedAt   DateTime? @map("voided_at")
  voidReason String?   @map("void_reason") @db.VarChar(200)
  voidedById Int?      @map("voided_by_id")
  voidedBy   User?     @relation("ReceiptVoidedBy", fields: [voidedById], references: [id], onDelete: SetNull)

  @@unique([year, seq])
  @@map("receipts")
}

// Contador por año. Se incrementa con INSERT … ON DUPLICATE KEY UPDATE dentro
// de la transacción que crea el recibo: el bloqueo de fila serializa y, si la
// transacción falla, el número no se consumió (sin huecos).
model ReceiptSequence {
  year Int @id @db.SmallInt
  last Int

  @@map("receipt_sequences")
}

// Bandeja sin conciliar (4B). `payerEmail` es dato personal: solo al admin.
model MpUnmatchedPayment {
  id                Int             @id @default(autoincrement())
  mpPaymentId       String          @unique @map("mp_payment_id") @db.VarChar(64)
  amount            Decimal         @db.Decimal(10, 2)
  paidAt            DateTime        @map("paid_at")
  payerEmail        String?         @map("payer_email") @db.VarChar(191)
  externalReference String?         @map("external_reference") @db.VarChar(128)
  description       String?         @db.VarChar(200)
  status            UnmatchedStatus @default(open)
  paymentId         Int?            @map("payment_id")
  resolvedById      Int?            @map("resolved_by_id")
  resolvedBy        User?           @relation("UnmatchedResolvedBy", fields: [resolvedById], references: [id], onDelete: SetNull)
  resolvedAt        DateTime?       @map("resolved_at")
  createdAt         DateTime        @default(now()) @map("created_at")

  @@index([status])
  @@map("mp_unmatched_payments")
}

// Última corrida de cada cron, para /admin/salud (4C). `summary`: contadores.
model CronRun {
  id         BigInt    @id @default(autoincrement())
  job        String    @db.VarChar(32)
  startedAt  DateTime  @map("started_at")
  finishedAt DateTime? @map("finished_at")
  ok         Boolean   @default(false)
  summary    Json?
  error      String?   @db.VarChar(500)

  @@index([job, startedAt])
  @@map("cron_runs")
}
```

- [ ] **Step 2: Retocar los modelos y enums existentes**

En `model User` agregar las relaciones inversas (después de `documentsValidated`):

```prisma
  feeValuesCreated   FeeValue[]           @relation("FeeValueCreatedBy")
  paymentsRegistered Payment[]            @relation("PaymentRegisteredBy")
  receiptsVoided     Receipt[]            @relation("ReceiptVoidedBy")
  unmatchedResolved  MpUnmatchedPayment[] @relation("UnmatchedResolvedBy")
```

En `model Member`, después de `mpSubscriptions  MpSubscription[]`:

```prisma
  fees             Fee[]
  payments         Payment[]
```

En `model Application`, junto a `subscriptions MpSubscription[]`:

```prisma
  payments      Payment[]
```

En `model Minute`, después de `applications Application[]`:

```prisma
  feeValues    FeeValue[]
```

En `enum NotificationType` agregar antes de `generic`:

```prisma
  payment_rejected
  board_digest
```

En `enum NotificationStatus` agregar al final:

```prisma
  failed
```

En `model Notification`, después de `payloadSummary`:

```prisma
  // Código del error de envío cuando `status = failed` (4C). Nunca la dirección.
  error          String?            @db.VarChar(200)
```

En `model MpSubscription`, después de `linkedManually`:

```prisma
  // Último monto conocido/empujado (4B: lote REG-34 y divergencia).
  amount            Decimal?  @db.Decimal(10, 2)
  externalReference String?   @map("external_reference") @db.VarChar(128)
```

y antes de `@@map("mp_subscriptions")`:

```prisma
  @@index([memberId])
  @@index([status])
```

- [ ] **Step 3: Generar la migración (con Docker/MariaDB levantado)**

```bash
docker compose up -d
npx prisma migrate dev --name add_module_4_treasury
```

Expected: crea `prisma/migrations/2026…_add_module_4_treasury/migration.sql` con `CREATE TABLE fee_values`, `fees`, `payments`, `receipts`, `receipt_sequences`, `mp_unmatched_payments`, `cron_runs`, los `ALTER TABLE notifications` / `mp_subscriptions` y regenera el cliente. Revisar que el SQL no contenga ningún `DROP`.

- [ ] **Step 4: Typecheck y tests**

```bash
npx tsc --noEmit && npm test
```

Expected: sin errores; 1191 tests en verde (el schema nuevo no rompe nada existente).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(m4): treasury schema — fee values, fees, payments, receipts, sequences

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Períodos `"YYYY-MM"` (puro)

**Files:**
- Create: `src/lib/treasury/periods.ts`
- Test: `tests/treasury-periods.test.ts`

**Interfaces:**
- Produces: `type Period = string`; `periodOf(date: Date): Period` (en zona AR); `currentPeriod(now?: Date)`; `addMonths(p, n)`; `comparePeriods(a, b)`; `periodRange(from, to)` inclusivo; `periodLabel(p)` → `"marzo 2025"`; `periodYear(p)`, `periodMonth(p)`; `isPeriod(s)`; `lastPeriodsOfYear(year, n)` → los últimos `n` meses del año.

- [ ] **Step 1: Escribir el test**

`tests/treasury-periods.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  addMonths, comparePeriods, currentPeriod, isPeriod, lastPeriodsOfYear, periodLabel, periodOf,
  periodRange,
} from "@/lib/treasury/periods";

describe("periods", () => {
  it("periodOf usa la zona de Argentina, no UTC", () => {
    // 01/09/2026 01:30 UTC es todavía 31/08 en Argentina (UTC-3).
    expect(periodOf(new Date("2026-09-01T01:30:00Z"))).toBe("2026-08");
    expect(periodOf(new Date("2026-09-01T03:30:00Z"))).toBe("2026-09");
  });

  it("currentPeriod acepta un reloj inyectado", () => {
    expect(currentPeriod(new Date("2026-08-21T15:00:00Z"))).toBe("2026-08");
  });

  it("addMonths cruza el año en los dos sentidos", () => {
    expect(addMonths("2025-11", 3)).toBe("2026-02");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-05", 0)).toBe("2026-05");
  });

  it("comparePeriods ordena cronológicamente", () => {
    expect(comparePeriods("2025-12", "2026-01")).toBeLessThan(0);
    expect(comparePeriods("2026-01", "2026-01")).toBe(0);
    expect(["2026-03", "2025-11", "2026-01"].sort(comparePeriods)).toEqual(["2025-11", "2026-01", "2026-03"]);
  });

  it("periodRange es inclusivo", () => {
    expect(periodRange("2025-11", "2026-02")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(periodRange("2026-02", "2025-11")).toEqual([]);
  });

  it("periodLabel en castellano y minúsculas", () => {
    expect(periodLabel("2025-03")).toBe("marzo 2025");
    expect(periodLabel("2026-09")).toBe("septiembre 2026");
  });

  it("lastPeriodsOfYear devuelve los últimos n meses del año", () => {
    expect(lastPeriodsOfYear(2025, 8)).toEqual([
      "2025-05", "2025-06", "2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12",
    ]);
    expect(lastPeriodsOfYear(2024, 3)).toEqual(["2024-10", "2024-11", "2024-12"]);
    expect(lastPeriodsOfYear(2023, 0)).toEqual([]);
  });

  it("isPeriod valida forma y mes", () => {
    expect(isPeriod("2026-08")).toBe(true);
    expect(isPeriod("2026-13")).toBe(false);
    expect(isPeriod("26-08")).toBe(false);
  });
});
```

- [ ] **Step 2: Correr el test y verlo fallar**

```bash
npx vitest run tests/treasury-periods.test.ts
```

Expected: FAIL — `Cannot find module '@/lib/treasury/periods'`.

- [ ] **Step 3: Implementar `src/lib/treasury/periods.ts`**

```ts
// Períodos mensuales de la cuenta corriente: "YYYY-MM". Puro, sin Prisma.
// La zona de negocio es la de Argentina (UTC-3, sin DST): el "mes actual" se
// decide ahí y no en UTC, o el cron de las 00:30 del día 1 devengaría el mes
// equivocado.
const TZ = "America/Argentina/Buenos_Aires";

export type Period = string;

const PERIOD_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isPeriod(s: string): boolean {
  return PERIOD_RE.test(s);
}

export function periodYear(p: Period): number {
  return Number(p.slice(0, 4));
}

export function periodMonth(p: Period): number {
  return Number(p.slice(5, 7));
}

function build(year: number, month: number): Period {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function periodOf(date: Date): Period {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit" })
    .formatToParts(date);
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  return build(year, month);
}

export function currentPeriod(now: Date = new Date()): Period {
  return periodOf(now);
}

export function addMonths(p: Period, n: number): Period {
  const total = periodYear(p) * 12 + (periodMonth(p) - 1) + n;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  return build(year, month);
}

export function comparePeriods(a: Period, b: Period): number {
  // "YYYY-MM" con cero a la izquierda ordena lexicográficamente igual que en el tiempo.
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Inclusivo en los dos extremos; vacío si `to` es anterior a `from`. */
export function periodRange(from: Period, to: Period): Period[] {
  const out: Period[] = [];
  let p = from;
  while (comparePeriods(p, to) <= 0) {
    out.push(p);
    p = addMonths(p, 1);
  }
  return out;
}

const MONTHS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

export function monthName(month: number): string {
  return MONTHS[month - 1];
}

export function periodLabel(p: Period): string {
  return `${monthName(periodMonth(p))} ${periodYear(p)}`;
}

/** Los últimos `n` meses del año (`n` = 8 → mayo..diciembre). La excepción de
 *  las bajas (el Excel dice "8" para ene..ago 2025, hasta el mes de la baja) la
 *  resuelve `debt-import.ts`, no esta función. */
export function lastPeriodsOfYear(year: number, n: number): Period[] {
  if (n <= 0) return [];
  const from = Math.max(1, 12 - n + 1);
  const out: Period[] = [];
  for (let m = from; m <= 12; m++) out.push(build(year, m));
  return out;
}
```

> Regla de negocio (spec §4.2): las N cuotas de un año van a los **últimos N meses** del año. Para socios con baja, el año de la baja se cuenta hacia atrás desde el **mes de la baja** (31/08/2025 con 8 → ene..ago). Esa excepción la implementa `planDebtImport` en Task 15 con `periodRange`, no esta función.

- [ ] **Step 4: Correr el test y verlo pasar**

```bash
npx vitest run tests/treasury-periods.test.ts
```

Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/treasury/periods.ts tests/treasury-periods.test.ts
git commit -m "feat(m4): period helpers in Argentina time zone

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Reglas puras de tesorería

**Files:**
- Create: `src/lib/treasury/rules.ts`
- Create: `src/lib/treasury/labels.ts`
- Test: `tests/treasury-rules.test.ts`

**Interfaces:**
- Produces:
  - `type FeeValueAmounts = { activeAmount: number; sharedAmount: number }`
  - `feeAmountFor(category: MemberCategory, v: FeeValueAmounts): number | null`
  - `ACCRUING_CATEGORIES`, `accrues(m: { status, category, joinedAt }, period): boolean`
  - `firstAccrualPeriod(joinedAt: Date): Period`
  - `arrearsLevel(pending: number): 0 | 1 | 2 | 4` (0 al día · 1 una cuota · 2 mora · 4 candidato a cesantía)
  - `ARREARS_THRESHOLD = 4`, `ARREARS_WARNING = 2`
  - `debtAmount(pending: number, category, v): number`
  - `allocate({ pending, existing, n, currentPeriod }): { toPay: Period[]; toCreate: Period[] }`
  - `revertFees(periods: Period[], currentPeriod): { toPending: Period[]; toDelete: Period[] }`
  - `cashConceptsFor(category): CashConcept[]` con `type CashConcept = "fees" | "voluntary" | "extraordinary"`
  - labels: `PAYMENT_TYPE_LABELS`, `FEE_STATUS_LABELS`, `CASH_CONCEPT_LABELS`, `describePeriods(periods)`, `paymentConcept(type, periods)`

- [ ] **Step 1: Escribir el test**

`tests/treasury-rules.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { civilDateUtc } from "@/lib/dates";
import {
  accrues, allocate, arrearsLevel, cashConceptsFor, debtAmount, feeAmountFor, firstAccrualPeriod,
  revertFees,
} from "@/lib/treasury/rules";
import { describePeriods, paymentConcept } from "@/lib/treasury/labels";

const V = { activeAmount: 6000, sharedAmount: 3000 };

describe("feeAmountFor", () => {
  it("activo paga el monto de activo; adherente y colaborador el compartido", () => {
    expect(feeAmountFor("active", V)).toBe(6000);
    expect(feeAmountFor("adherent", V)).toBe(3000);
    expect(feeAmountFor("collaborator", V)).toBe(3000);
  });
  it("honorario, vitalicio y cadete no pagan", () => {
    expect(feeAmountFor("honorary", V)).toBeNull();
    expect(feeAmountFor("lifetime", V)).toBeNull();
    expect(feeAmountFor("cadet", V)).toBeNull();
  });
});

describe("firstAccrualPeriod / accrues", () => {
  it("la primera cuota es el primer mes completo posterior al ingreso", () => {
    expect(firstAccrualPeriod(civilDateUtc(2026, 8, 21))).toBe("2026-09");
    expect(firstAccrualPeriod(civilDateUtc(2026, 9, 1))).toBe("2026-10");
    expect(firstAccrualPeriod(civilDateUtc(2025, 12, 31))).toBe("2026-01");
  });
  it("devengan activos y colaboradores vigentes o suspendidos", () => {
    const joined = civilDateUtc(2026, 8, 21);
    expect(accrues({ status: "active", category: "active", joinedAt: joined }, "2026-09")).toBe(true);
    expect(accrues({ status: "suspended", category: "collaborator", joinedAt: joined }, "2026-09")).toBe(true);
    expect(accrues({ status: "withdrawn", category: "active", joinedAt: joined }, "2026-09")).toBe(false);
  });
  it("no devengan adherentes, honorarios, vitalicios ni cadetes", () => {
    const joined = civilDateUtc(2020, 1, 1);
    for (const category of ["adherent", "honorary", "lifetime", "cadet"] as const) {
      expect(accrues({ status: "active", category, joinedAt: joined }, "2026-09")).toBe(false);
    }
  });
  it("no devenga antes del primer mes completo", () => {
    const joined = civilDateUtc(2026, 8, 21);
    expect(accrues({ status: "active", category: "active", joinedAt: joined }, "2026-08")).toBe(false);
  });
});

describe("arrearsLevel (REG-15)", () => {
  it("0 al día, 1 una cuota, 2 desde la segunda, 4 desde la cuarta", () => {
    expect(arrearsLevel(0)).toBe(0);
    expect(arrearsLevel(1)).toBe(1);
    expect(arrearsLevel(2)).toBe(2);
    expect(arrearsLevel(3)).toBe(2);
    expect(arrearsLevel(4)).toBe(4);
    expect(arrearsLevel(23)).toBe(4);
  });
});

describe("debtAmount (REG-16)", () => {
  it("cuotas pendientes × valor vigente de la categoría", () => {
    expect(debtAmount(23, "active", V)).toBe(138000);
    expect(debtAmount(4, "collaborator", V)).toBe(12000);
    expect(debtAmount(3, "honorary", V)).toBe(0);
  });
});

describe("allocate", () => {
  it("imputa a las pendientes más antiguas primero", () => {
    const r = allocate({ pending: ["2025-03", "2024-11", "2025-01"], existing: [], n: 2, currentPeriod: "2026-08" });
    expect(r.toPay).toEqual(["2024-11", "2025-01"]);
    expect(r.toCreate).toEqual([]);
  });
  it("si faltan pendientes crea desde el período corriente, salteando las que ya existen", () => {
    const r = allocate({ pending: ["2026-07"], existing: ["2026-07", "2026-08"], n: 3, currentPeriod: "2026-08" });
    expect(r.toPay).toEqual(["2026-07", "2026-09", "2026-10"]);
    expect(r.toCreate).toEqual(["2026-09", "2026-10"]);
  });
  it("un socio al día que paga una cuota paga el período corriente", () => {
    const r = allocate({ pending: [], existing: [], n: 1, currentPeriod: "2026-09" });
    expect(r).toEqual({ toPay: ["2026-09"], toCreate: ["2026-09"] });
  });
  it("n = 0 no imputa nada", () => {
    expect(allocate({ pending: ["2026-01"], existing: ["2026-01"], n: 0, currentPeriod: "2026-08" }))
      .toEqual({ toPay: [], toCreate: [] });
  });
});

describe("revertFees", () => {
  it("las cuotas de períodos futuros se borran, el resto vuelve a pendiente", () => {
    const r = revertFees(["2026-07", "2026-08", "2026-09", "2026-10"], "2026-08");
    expect(r.toPending).toEqual(["2026-07", "2026-08"]);
    expect(r.toDelete).toEqual(["2026-09", "2026-10"]);
  });
});

describe("cashConceptsFor", () => {
  it("activo y colaborador: cuotas, voluntaria y extraordinaria", () => {
    expect(cashConceptsFor("active")).toEqual(["fees", "voluntary", "extraordinary"]);
    expect(cashConceptsFor("collaborator")).toEqual(["fees", "voluntary", "extraordinary"]);
  });
  it("adherente: voluntaria y extraordinaria; honorario/vitalicio/cadete: solo extraordinaria", () => {
    expect(cashConceptsFor("adherent")).toEqual(["voluntary", "extraordinary"]);
    expect(cashConceptsFor("honorary")).toEqual(["extraordinary"]);
    expect(cashConceptsFor("lifetime")).toEqual(["extraordinary"]);
    expect(cashConceptsFor("cadet")).toEqual(["extraordinary"]);
  });
});

describe("labels", () => {
  it("describePeriods resume rangos contiguos", () => {
    expect(describePeriods(["2025-03"])).toBe("marzo 2025");
    expect(describePeriods(["2025-03", "2025-04", "2025-05"])).toBe("marzo a mayo 2025 (3 cuotas)");
    expect(describePeriods(["2024-11", "2024-12", "2025-01"])).toBe("noviembre 2024 a enero 2025 (3 cuotas)");
    expect(describePeriods(["2025-01", "2025-03"])).toBe("enero 2025, marzo 2025 (2 cuotas)");
    expect(describePeriods([])).toBe("");
  });
  it("paymentConcept arma el concepto del recibo", () => {
    expect(paymentConcept("cash", ["2025-03", "2025-04"])).toBe("Cuota social · marzo a abril 2025 (2 cuotas)");
    expect(paymentConcept("voluntary", [])).toBe("Aporte voluntario");
    expect(paymentConcept("extraordinary", [])).toBe("Aporte extraordinario");
    expect(paymentConcept("entry", [])).toBe("Cuota de ingreso");
    expect(paymentConcept("debit", ["2026-09"])).toBe("Cuota social · septiembre 2026");
  });
});
```

- [ ] **Step 2: Correr y ver fallar**

```bash
npx vitest run tests/treasury-rules.test.ts
```

Expected: FAIL — módulos inexistentes.

- [ ] **Step 3: Implementar `src/lib/treasury/rules.ts`**

```ts
// Reglas puras de tesorería (spec §3). Sin Prisma: la tabla de casos se prueba
// sin fixtures. Los mensajes que llegan a pantalla viven en las actions.
import type { MemberCategory, MemberStatus } from "@/generated/prisma/client";
import { addMonths, comparePeriods, periodOf, type Period } from "./periods";

export type FeeValueAmounts = { activeAmount: number; sharedAmount: number };

/** Monto mensual de la categoría, o `null` si la categoría no paga cuota. */
export function feeAmountFor(category: MemberCategory, v: FeeValueAmounts): number | null {
  switch (category) {
    case "active":
      return v.activeAmount;
    case "adherent":
    case "collaborator":
      return v.sharedAmount;
    default:
      return null; // honorary, lifetime, cadet
  }
}

/** Quién devenga cuota obligatoria (docs/02 tabla Art. 5). Adherente es voluntaria. */
export const ACCRUING_CATEGORIES: readonly MemberCategory[] = ["active", "collaborator"];

/** Primer mes completo posterior al ingreso: la cuota de ingreso cubre el mes
 *  de alta (REG-14). Ingresó el 21/08 → primera cuota septiembre. */
export function firstAccrualPeriod(joinedAt: Date): Period {
  return addMonths(periodOf(joinedAt), 1);
}

// La suspensión es disciplinaria, no eximición: el suspendido sigue devengando.
// La baja no devenga: sus pendientes quedan congeladas (deuda al momento de la baja).
export function accrues(
  m: { status: MemberStatus; category: MemberCategory; joinedAt: Date },
  period: Period,
): boolean {
  if (m.status === "withdrawn") return false;
  if (!ACCRUING_CATEGORIES.includes(m.category)) return false;
  return comparePeriods(period, firstAccrualPeriod(m.joinedAt)) >= 0;
}

export const ARREARS_WARNING = 2; // alerta desde la 2ª (REG-15)
export const ARREARS_THRESHOLD = 4; // habilita la cesantía (REG-15)

export type ArrearsLevel = 0 | 1 | 2 | 4;

export function arrearsLevel(pending: number): ArrearsLevel {
  if (pending >= ARREARS_THRESHOLD) return 4;
  if (pending >= ARREARS_WARNING) return 2;
  if (pending === 1) return 1;
  return 0;
}

/** REG-16 generalizado: deuda = pendientes × valor vigente de la categoría. */
export function debtAmount(pending: number, category: MemberCategory, v: FeeValueAmounts): number {
  const amount = feeAmountFor(category, v);
  return amount === null ? 0 : pending * amount;
}

/** Qué cuotas cubre un pago de `n` cuotas: las pendientes más antiguas primero;
 *  si faltan, períodos nuevos desde el corriente, salteando los que ya existen
 *  (pagados, exentos) para no chocar con el unique (memberId, period). */
export function allocate(input: {
  pending: Period[];
  existing: Period[];
  n: number;
  currentPeriod: Period;
}): { toPay: Period[]; toCreate: Period[] } {
  const toPay = [...input.pending].sort(comparePeriods).slice(0, input.n);
  const toCreate: Period[] = [];
  const taken = new Set([...input.existing, ...toPay]);
  let p = input.currentPeriod;
  while (toPay.length < input.n) {
    if (!taken.has(p)) {
      toPay.push(p);
      toCreate.push(p);
      taken.add(p);
    }
    p = addMonths(p, 1);
  }
  return { toPay, toCreate };
}

/** Al anular un pago: una cuota de un período futuro no puede quedar pendiente
 *  (contaría como deuda antes de tiempo), así que se borra; las demás vuelven a
 *  pendientes. */
export function revertFees(periods: Period[], currentPeriod: Period): { toPending: Period[]; toDelete: Period[] } {
  const toPending: Period[] = [];
  const toDelete: Period[] = [];
  for (const p of [...periods].sort(comparePeriods)) {
    (comparePeriods(p, currentPeriod) > 0 ? toDelete : toPending).push(p);
  }
  return { toPending, toDelete };
}

export type CashConcept = "fees" | "voluntary" | "extraordinary";

export function cashConceptsFor(category: MemberCategory): CashConcept[] {
  if (ACCRUING_CATEGORIES.includes(category)) return ["fees", "voluntary", "extraordinary"];
  if (category === "adherent") return ["voluntary", "extraordinary"];
  return ["extraordinary"];
}
```

- [ ] **Step 4: Implementar `src/lib/treasury/labels.ts`**

```ts
// Etiquetas es-AR de tesorería. Un solo lugar: pantalla, PDF y email dicen lo mismo.
import type { FeeStatus, PaymentType } from "@/generated/prisma/client";
import { addMonths, comparePeriods, monthName, periodLabel, periodMonth, periodYear, type Period } from "./periods";
import type { CashConcept } from "./rules";

export const PAYMENT_TYPE_LABELS: Record<PaymentType, string> = {
  debit: "Débito automático",
  link: "Link de pago",
  cash: "Efectivo",
  voluntary: "Aporte voluntario",
  entry: "Cuota de ingreso",
  extraordinary: "Aporte extraordinario",
};

export const FEE_STATUS_LABELS: Record<FeeStatus, string> = {
  pending: "Pendiente",
  paid: "Pagada",
  exempt: "Exenta",
  voided: "Anulada",
};

export const CASH_CONCEPT_LABELS: Record<CashConcept, string> = {
  fees: "Cuotas sociales",
  voluntary: "Aporte voluntario",
  extraordinary: "Aporte extraordinario",
};

/** "marzo a mayo 2025 (3 cuotas)" para rangos contiguos; lista separada por
 *  comas cuando no lo son. Un solo período va sin contador. */
export function describePeriods(periods: Period[]): string {
  const sorted = [...periods].sort(comparePeriods);
  if (sorted.length === 0) return "";
  if (sorted.length === 1) return periodLabel(sorted[0]);
  const contiguous = sorted.every((p, i) => i === 0 || addMonths(sorted[i - 1], 1) === p);
  const count = ` (${sorted.length} cuotas)`;
  if (!contiguous) return sorted.map(periodLabel).join(", ") + count;
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (periodYear(first) === periodYear(last)) {
    return `${monthName(periodMonth(first))} a ${monthName(periodMonth(last))} ${periodYear(first)}${count}`;
  }
  return `${periodLabel(first)} a ${periodLabel(last)}${count}`;
}

export function paymentConcept(type: PaymentType, periods: Period[]): string {
  if (type === "voluntary" || type === "extraordinary" || type === "entry") return PAYMENT_TYPE_LABELS[type];
  const described = describePeriods(periods);
  return described ? `Cuota social · ${described}` : "Cuota social";
}
```

- [ ] **Step 5: Correr y ver pasar**

```bash
npx vitest run tests/treasury-rules.test.ts
```

Expected: PASS (todos los `describe`).

- [ ] **Step 6: Commit**

```bash
git add src/lib/treasury/rules.ts src/lib/treasury/labels.ts tests/treasury-rules.test.ts
git commit -m "feat(m4): pure treasury rules — accrual, debt, allocation, arrears

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Valor de cuota — lector, seed y sección en Configuración

**Files:**
- Create: `src/lib/treasury/fee-values.ts`
- Create: `src/app/admin/configuracion/fee-value-form.tsx`
- Modify: `prisma/seed.ts`
- Modify: `src/app/admin/configuracion/actions.ts`, `src/app/admin/configuracion/page.tsx`
- Test: `tests/treasury-fee-values.test.ts`, `tests/fee-value-action-auth.test.ts`

**Interfaces:**
- Produces: `makeFeeValueReader(db: Pick<PrismaClient,"feeValue">)` → `{ current(at?: Date): Promise<CurrentFeeValue | null>; history(): Promise<FeeValueRow[]> }` con `type CurrentFeeValue = { id: number; activeAmount: number; sharedAmount: number; validFrom: Date; minuteId: number | null }`; singleton `feeValueReader`; constante `NO_FEE_VALUE_MESSAGE`; server action `createFeeValueAction(prev, formData)` (superadmin).
- Consumes: nada de tareas previas (el `FeeValueAmounts` de Task 3 es estructuralmente compatible con `CurrentFeeValue`).

- [ ] **Step 1: Test del lector**

`tests/treasury-fee-values.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { civilDateUtc } from "@/lib/dates";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import { makeFeeValueReader } from "@/lib/treasury/fee-values";

const rows = [
  { id: 1, activeAmount: "6000.00", sharedAmount: "3000.00", validFrom: civilDateUtc(2026, 9, 1), minuteId: null },
  { id: 2, activeAmount: "8000.00", sharedAmount: "4000.00", validFrom: civilDateUtc(2027, 1, 1), minuteId: 7 },
];

function db() {
  return {
    feeValue: {
      findFirst: vi.fn(async (args: { where: { validFrom: { lte: Date } } }) => {
        const at = args.where.validFrom.lte;
        const eligible = rows
          .filter((r) => r.validFrom <= at)
          .sort((a, b) => b.validFrom.getTime() - a.validFrom.getTime());
        return eligible[0] ?? null;
      }),
      findMany: vi.fn(async () => [...rows].reverse()),
    },
  } as never;
}

describe("makeFeeValueReader", () => {
  it("current devuelve el de mayor validFrom <= la fecha, con montos numéricos", async () => {
    const reader = makeFeeValueReader(db());
    const v = await reader.current(civilDateUtc(2026, 10, 15));
    expect(v).toEqual({ id: 1, activeAmount: 6000, sharedAmount: 3000, validFrom: rows[0].validFrom, minuteId: null });
    const later = await reader.current(civilDateUtc(2027, 3, 1));
    expect(later?.id).toBe(2);
    expect(later?.activeAmount).toBe(8000);
  });

  it("current devuelve null si todavía no rige ninguno", async () => {
    expect(await makeFeeValueReader(db()).current(civilDateUtc(2026, 8, 1))).toBeNull();
  });

  it("history viene ordenada del más nuevo al más viejo", async () => {
    const h = await makeFeeValueReader(db()).history();
    expect(h.map((r) => r.id)).toEqual([2, 1]);
    expect(h[0].activeAmount).toBe(8000);
  });
});
```

- [ ] **Step 2: Ver fallar**

```bash
npx vitest run tests/treasury-fee-values.test.ts
```

Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar `src/lib/treasury/fee-values.ts`**

```ts
// Valor de cuota vigente e historial (REG-34). Prisma inyectado.
import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

export type CurrentFeeValue = {
  id: number;
  activeAmount: number;
  sharedAmount: number;
  validFrom: Date;
  minuteId: number | null;
};

export type FeeValueRow = CurrentFeeValue;

type Db = Pick<PrismaClient, "feeValue">;

function toRow(r: {
  id: number; activeAmount: unknown; sharedAmount: unknown; validFrom: Date; minuteId: number | null;
}): FeeValueRow {
  return {
    id: r.id,
    activeAmount: Number(r.activeAmount),
    sharedAmount: Number(r.sharedAmount),
    validFrom: r.validFrom,
    minuteId: r.minuteId,
  };
}

const SELECT = { id: true, activeAmount: true, sharedAmount: true, validFrom: true, minuteId: true } as const;

export function makeFeeValueReader(db: Db) {
  return {
    /** El vigente a `at` (default: ahora): mayor `validFrom` ≤ `at`. `null` si
     *  no rige ninguno todavía — quien cobra tiene que abortar, no inventar. */
    async current(at: Date = new Date()): Promise<CurrentFeeValue | null> {
      const row = await db.feeValue.findFirst({
        where: { validFrom: { lte: at } },
        orderBy: [{ validFrom: "desc" }, { id: "desc" }],
        select: SELECT,
      });
      return row ? toRow(row) : null;
    },
    async history(): Promise<FeeValueRow[]> {
      const rows = await db.feeValue.findMany({ orderBy: [{ validFrom: "desc" }, { id: "desc" }], select: SELECT });
      return rows.map(toRow);
    },
  };
}

export const feeValueReader = makeFeeValueReader(prisma);

/** Mensaje único para los caminos que necesitan un valor y no lo hay. */
export const NO_FEE_VALUE_MESSAGE =
  "No hay un valor de cuota vigente: registralo en Configuración → Tesorería antes de continuar.";
```

- [ ] **Step 4: Ver pasar**

```bash
npx vitest run tests/treasury-fee-values.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 5: Seed del valor inicial**

En `prisma/seed.ts`, dentro de `main()` después del bloque de `configuration`:

```ts
  // Valor de cuota inicial (M4, REG-34): $6.000 activo / $3.000 adherente y
  // colaborador, fijados por la asamblea de agosto de 2026, vigentes desde el
  // primer devengo del sistema (septiembre 2026). Solo si la tabla está vacía:
  // los valores posteriores se registran desde /admin/configuracion con acta.
  const anyFeeValue = await prisma.feeValue.findFirst({ select: { id: true } })
  if (!anyFeeValue) {
    await prisma.feeValue.create({
      data: { activeAmount: "6000.00", sharedAmount: "3000.00", validFrom: new Date(Date.UTC(2026, 8, 1, 12)) },
    })
    console.log("new  valor de cuota inicial: activo 6000 / compartido 3000 (vigente 01/08/2026)")
  } else {
    console.log("ok   valor de cuota (sin tocar)")
  }
```

Correr `npx prisma db seed` y verificar la línea `new  valor de cuota inicial…`.

- [ ] **Step 6: Test de autorización de la action nueva**

`tests/fee-value-action-auth.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  feeValue: { create: vi.fn(async () => ({ id: 1 })) },
  minute: { findUnique: vi.fn(async () => null) },
  configuration: { findUnique: vi.fn(async () => null), upsert: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth/require-admin", () => ({
  requireSuperadmin: vi.fn(async () => ({
    ok: false, reason: "not_admin", error: "Solo el superadmin puede cambiar la configuración.",
  })),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ updateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { redirect } from "next/navigation";
import { audit } from "@/lib/audit";
import { createFeeValueAction } from "@/app/admin/configuracion/actions";

describe("createFeeValueAction sin superadmin", () => {
  it("rechaza sin escribir, auditar ni redirigir", async () => {
    const form = new FormData();
    form.append("activeAmount", "6000");
    form.append("sharedAmount", "3000");
    form.append("validFrom", "2026-09-01");
    const result = await createFeeValueAction({}, form);
    expect(result.error).toBe("Solo el superadmin puede cambiar la configuración.");
    expect(prismaMock.feeValue.create).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 7: Ver fallar**

```bash
npx vitest run tests/fee-value-action-auth.test.ts
```

Expected: FAIL — `createFeeValueAction` no existe.

- [ ] **Step 8: Agregar la action a `src/app/admin/configuracion/actions.ts`**

Agregar arriba `import { parseCivilDate } from "@/lib/dates";` y, al final del archivo:

```ts
// ── Valor de cuota (M4, REG-34) ───────────────────────────────────────────────
//
// Registrar un valor nuevo NO edita el vigente: agrega una fila al historial con
// su vigencia. La deuda de todos se valúa al vigente (REG-16), así que el valor
// viejo deja de usarse solo, sin tocar ninguna cuota. El acta es opcional al
// registrar (la asamblea ya lo fijó y el acta puede digitalizarse después).
const feeValueSchema = z.object({
  activeAmount: z.coerce
    .number("Ingresá el monto de la cuota de socio activo.")
    .int("El monto tiene que ser un número entero de pesos.")
    .positive("El monto de activo tiene que ser mayor a cero."),
  sharedAmount: z.coerce
    .number("Ingresá el monto de la cuota de adherente/colaborador.")
    .int("El monto tiene que ser un número entero de pesos.")
    .positive("El monto de adherente/colaborador tiene que ser mayor a cero."),
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ingresá desde cuándo rige el valor."),
  minuteId: z.coerce.number().int().positive().optional(),
});

export async function createFeeValueAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireSuperadmin();
  if (!actor.ok) return { error: actor.error };
  const parsed = parseForm(feeValueSchema, formData);
  if (!parsed.ok) return { error: parsed.error };
  const validFrom = parseCivilDate(parsed.data.validFrom, {
    minYear: 2015,
    invalidError: "La fecha de vigencia no es válida.",
  });
  if (!validFrom.ok) return { error: validFrom.error };

  if (parsed.data.minuteId !== undefined) {
    const minute = await prisma.minute.findUnique({ where: { id: parsed.data.minuteId }, select: { id: true } });
    if (!minute) return { error: "El acta seleccionada no existe." };
  }

  const row = await prisma.feeValue.create({
    data: {
      activeAmount: parsed.data.activeAmount.toFixed(2),
      sharedAmount: parsed.data.sharedAmount.toFixed(2),
      validFrom: validFrom.value,
      minuteId: parsed.data.minuteId ?? null,
      createdById: actor.actorId,
    },
  });
  await audit({
    userId: actor.actorId,
    action: "fee_value_create",
    entity: "fee_value",
    entityId: row.id,
    detail: {
      activeAmount: parsed.data.activeAmount,
      sharedAmount: parsed.data.sharedAmount,
      validFrom: parsed.data.validFrom,
      minuteId: parsed.data.minuteId ?? null,
    },
    ip: await clientIp(),
  });
  redirect("/admin/configuracion?cuota=1");
}
```

- [ ] **Step 9: Ver pasar**

```bash
npx vitest run tests/fee-value-action-auth.test.ts tests/config-actions-auth.test.ts tests/config-actions.test.ts
```

Expected: PASS.

- [ ] **Step 10: Formulario y sección en la pantalla de Configuración**

Crear `src/app/admin/configuracion/fee-value-form.tsx`:

```tsx
"use client";
// Alta de un valor de cuota (M4). Formulario propio, separado del de
// configuración: es un INSERT al historial, no un upsert de claves, y tiene su
// propia acción y su propio mensaje de éxito.
import { useActionState } from "react";
import { createFeeValueAction } from "./actions";
import { useSyncedForm, TextField, SelectField } from "@/components/admin/synced-fields";
import { FormMessage } from "@/components/admin/form-message";
import { Button } from "@/components/ui/button";

const digits = (v: string) => v.replace(/\D/g, "");

export function FeeValueForm({ minutes, suggestedValidFrom }: {
  minutes: Array<{ id: number; label: string }>;
  suggestedValidFrom: string;
}) {
  const [state, formAction, pending] = useActionState(createFeeValueAction, {});
  const { formRef, field } = useSyncedForm({
    activeAmount: "", sharedAmount: "", validFrom: suggestedValidFrom, minuteId: "",
  });
  const minuteOptions: Array<[string, string]> = [
    ["", "Sin acta por ahora"],
    ...minutes.map((m): [string, string] => [String(m.id), m.label]),
  ];
  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Cuota de socio activo ($)" field={field("activeAmount", digits)}
          inputMode="numeric" placeholder="6000"
        />
        <TextField
          label="Cuota de adherente / colaborador ($)" field={field("sharedAmount", digits)}
          inputMode="numeric" placeholder="3000" hint="Las dos categorías comparten el mismo monto."
        />
        <TextField
          label="Rige desde" field={field("validFrom")} type="date"
          hint="Desde esa fecha, el devengo, la deuda pendiente y el alta web usan el valor nuevo."
        />
        <SelectField label="Acta (opcional)" field={field("minuteId")} options={minuteOptions} />
      </div>
      {state.error && <FormMessage kind="error">{state.error}</FormMessage>}
      <Button type="submit" disabled={pending}>{pending ? "Registrando…" : "Registrar valor nuevo"}</Button>
    </form>
  );
}
```

En `src/app/admin/configuracion/page.tsx` agregar los imports:

```tsx
import { prisma } from "@/lib/prisma";
import { feeValueReader } from "@/lib/treasury/fee-values";
import { formatARS, formatDateAR } from "@/lib/format";
import { MINUTE_TYPE_LABELS } from "@/lib/members/labels";
import { FeeValueForm } from "./fee-value-form";
```

dentro del componente, después del `Promise.all` existente:

```tsx
  const [current, history, minuteRows] = await Promise.all([
    feeValueReader.current(),
    feeValueReader.history(),
    prisma.minute.findMany({ orderBy: [{ date: "desc" }, { id: "desc" }], take: 30 }),
  ]);
  const minutes = minuteRows.map((m) => ({
    id: m.id, label: `${MINUTE_TYPE_LABELS[m.type]} N° ${m.number} — ${formatDateAR(m.date)}`,
  }));
  const today = new Date();
  const suggestedValidFrom = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1))
    .toISOString().slice(0, 10);
```

y en el JSX, después de `<ConfigForm … />`:

```tsx
      <section className="max-w-2xl space-y-4 border-t pt-6">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          Tesorería — valor de cuota
        </h2>
        {sp.cuota === "1" && <FormMessage kind="success" box>Valor de cuota registrado.</FormMessage>}
        <p className="text-sm text-muted-foreground">
          {current ? (
            <>
              Vigente desde {formatDateAR(current.validFrom)}: activo{" "}
              <span className="font-mono tabular-nums">{formatARS(current.activeAmount)}</span> · adherente/colaborador{" "}
              <span className="font-mono tabular-nums">{formatARS(current.sharedAmount)}</span>.
            </>
          ) : (
            "Todavía no rige ningún valor de cuota."
          )}{" "}
          Es la única fuente de montos del sistema: devengo, deuda, efectivo y alta web. Los planes de Mercado
          Pago son solo referencia.
        </p>
        <FeeValueForm minutes={minutes} suggestedValidFrom={suggestedValidFrom} />
        {history.length > 0 && (
          <ul className="divide-y text-sm">
            {history.map((h) => (
              <li key={h.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span>Desde {formatDateAR(h.validFrom)}{h.minuteId ? ` · acta #${h.minuteId}` : " · sin acta"}</span>
                <span className="font-mono tabular-nums">{formatARS(h.activeAmount)} / {formatARS(h.sharedAmount)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
```

- [ ] **Step 11: Typecheck, tests y verificación manual**

```bash
npx tsc --noEmit && npm test
```

Expected: verde. Luego `npm run dev`, entrar como superadmin a `/admin/configuracion`: el seed muestra "Vigente desde 01/08/2026: activo $ 6.000,00 · adherente/colaborador $ 3.000,00"; registrar un valor con monto `0` → "El monto de activo tiene que ser mayor a cero."; registrar uno válido con fecha futura → aparece en el historial y el vigente no cambia.

- [ ] **Step 12: Commit**

```bash
git add src/lib/treasury/fee-values.ts prisma/seed.ts src/app/admin/configuracion tests/treasury-fee-values.test.ts tests/fee-value-action-auth.test.ts
git commit -m "feat(m4): fee value history with superadmin registration in configuration

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Cuenta corriente de un socio y grilla de períodos

**Files:**
- Create: `src/lib/treasury/account.ts`
- Test: `tests/treasury-account.test.ts`

**Interfaces:**
- Produces:
  - `type AccountFee = { period: Period; status: FeeStatus; origin: FeeOrigin; paymentId: number | null }`
  - `type AccountPayment = { id: number; type: PaymentType; amount: number; paidAt: Date; status: PaymentStatus; periods: Period[]; receipt: { id: number; number: string; voidedAt: Date | null } | null; note: string | null }`
  - `type MemberAccount = { fees; payments; pendingCount: number; pendingPeriods: Period[]; oldestPending: Period | null; debt: number | null; feeAmount: number | null; level: ArrearsLevel }`
  - `fetchMemberAccount(db: Pick<PrismaClient,"fee"|"payment">, member: { id: number; category: MemberCategory }, feeValue: FeeValueAmounts | null): Promise<MemberAccount>`
  - `countPendingFees(db: Pick<PrismaClient,"fee">, memberId: number): Promise<number>`
  - `type GridCellState = "paid" | "pending" | "pending_import" | "exempt" | "voided" | "none"`, `type GridCell = { period: Period; state: GridCellState; receiptNumber?: string }`, `type GridRow = { year: number; cells: GridCell[] }`
  - `buildPeriodGrid(fees: AccountFee[], receiptByPayment: Map<number, string>, joinedAt: Date | null, currentPeriod: Period): GridRow[]`

- [ ] **Step 1: Test**

`tests/treasury-account.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { civilDateUtc } from "@/lib/dates";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import { buildPeriodGrid, fetchMemberAccount, type AccountFee } from "@/lib/treasury/account";

const fee = (
  period: string, status: AccountFee["status"], origin: AccountFee["origin"] = "accrual", paymentId: number | null = null,
): AccountFee => ({ period, status, origin, paymentId });

describe("buildPeriodGrid", () => {
  it("una fila por año desde el primer dato hasta el corriente, 12 celdas", () => {
    const grid = buildPeriodGrid(
      [fee("2025-11", "paid", "accrual", 1), fee("2026-01", "pending"), fee("2026-02", "pending", "import")],
      new Map([[1, "2026-00001"]]),
      civilDateUtc(2025, 10, 15),
      "2026-03",
    );
    expect(grid.map((r) => r.year)).toEqual([2025, 2026]);
    expect(grid[0].cells).toHaveLength(12);
    expect(grid[0].cells[10]).toEqual({ period: "2025-11", state: "paid", receiptNumber: "2026-00001" });
    expect(grid[1].cells[0].state).toBe("pending");
    expect(grid[1].cells[1].state).toBe("pending_import");
    expect(grid[1].cells[2].state).toBe("none");
    expect(grid[1].cells[11].state).toBe("none");
  });

  it("sin cuotas devuelve solo el año corriente", () => {
    const grid = buildPeriodGrid([], new Map(), null, "2026-08");
    expect(grid.map((r) => r.year)).toEqual([2026]);
    expect(grid[0].cells.every((c) => c.state === "none")).toBe(true);
  });
});

describe("fetchMemberAccount", () => {
  const db = {
    fee: {
      findMany: vi.fn(async () => [
        { period: "2025-12", status: "pending", origin: "import", paymentId: null },
        { period: "2026-01", status: "paid", origin: "accrual", paymentId: 5 },
        { period: "2026-02", status: "pending", origin: "accrual", paymentId: null },
      ]),
    },
    payment: {
      findMany: vi.fn(async () => [
        {
          id: 5, type: "cash", amount: "6000.00", paidAt: civilDateUtc(2026, 2, 3), status: "applied", note: null,
          fees: [{ period: "2026-01" }], receipt: { id: 9, number: "2026-00003", voidedAt: null },
        },
      ]),
    },
  } as never;

  it("resume pendientes, deuda a valor vigente y nivel de mora", async () => {
    const a = await fetchMemberAccount(db, { id: 1, category: "active" }, { activeAmount: 6000, sharedAmount: 3000 });
    expect(a.pendingCount).toBe(2);
    expect(a.pendingPeriods).toEqual(["2025-12", "2026-02"]);
    expect(a.oldestPending).toBe("2025-12");
    expect(a.debt).toBe(12000);
    expect(a.feeAmount).toBe(6000);
    expect(a.level).toBe(2);
    expect(a.payments[0]).toMatchObject({ id: 5, amount: 6000, periods: ["2026-01"], receipt: { number: "2026-00003" } });
  });

  it("sin valor vigente la deuda es null (no se inventa un monto)", async () => {
    const a = await fetchMemberAccount(db, { id: 1, category: "active" }, null);
    expect(a.debt).toBeNull();
    expect(a.feeAmount).toBeNull();
    expect(a.pendingCount).toBe(2);
  });
});
```

- [ ] **Step 2: Ver fallar**

```bash
npx vitest run tests/treasury-account.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implementar `src/lib/treasury/account.ts`**

```ts
// Cuenta corriente de un socio: cuotas, pagos y resumen. Prisma inyectado.
import type {
  FeeOrigin, FeeStatus, MemberCategory, PaymentStatus, PaymentType, PrismaClient,
} from "@/generated/prisma/client";
import { comparePeriods, periodOf, periodYear, type Period } from "./periods";
import { arrearsLevel, debtAmount, feeAmountFor, type ArrearsLevel, type FeeValueAmounts } from "./rules";

export type AccountFee = { period: Period; status: FeeStatus; origin: FeeOrigin; paymentId: number | null };

export type AccountPayment = {
  id: number;
  type: PaymentType;
  amount: number;
  paidAt: Date;
  status: PaymentStatus;
  periods: Period[];
  receipt: { id: number; number: string; voidedAt: Date | null } | null;
  note: string | null;
};

export type MemberAccount = {
  fees: AccountFee[];
  payments: AccountPayment[];
  pendingCount: number;
  pendingPeriods: Period[];
  oldestPending: Period | null;
  /** Deuda a valor vigente, o `null` si no hay valor vigente. */
  debt: number | null;
  feeAmount: number | null;
  level: ArrearsLevel;
};

type Db = Pick<PrismaClient, "fee" | "payment">;

export async function fetchMemberAccount(
  db: Db,
  member: { id: number; category: MemberCategory },
  feeValue: FeeValueAmounts | null,
): Promise<MemberAccount> {
  const [feeRows, paymentRows] = await Promise.all([
    db.fee.findMany({
      where: { memberId: member.id },
      select: { period: true, status: true, origin: true, paymentId: true },
      orderBy: { period: "asc" },
    }),
    db.payment.findMany({
      where: { memberId: member.id },
      select: {
        id: true, type: true, amount: true, paidAt: true, status: true, note: true,
        fees: { select: { period: true } },
        receipt: { select: { id: true, number: true, voidedAt: true } },
      },
      orderBy: [{ paidAt: "desc" }, { id: "desc" }],
    }),
  ]);
  const fees: AccountFee[] = feeRows.map((f) => ({
    period: f.period, status: f.status, origin: f.origin, paymentId: f.paymentId,
  }));
  const pendingPeriods = fees.filter((f) => f.status === "pending").map((f) => f.period).sort(comparePeriods);
  return {
    fees,
    payments: paymentRows.map((p) => ({
      id: p.id,
      type: p.type,
      amount: Number(p.amount),
      paidAt: p.paidAt,
      status: p.status,
      periods: p.fees.map((f) => f.period).sort(comparePeriods),
      receipt: p.receipt,
      note: p.note,
    })),
    pendingCount: pendingPeriods.length,
    pendingPeriods,
    oldestPending: pendingPeriods[0] ?? null,
    debt: feeValue ? debtAmount(pendingPeriods.length, member.category, feeValue) : null,
    feeAmount: feeValue ? feeAmountFor(member.category, feeValue) : null,
    level: arrearsLevel(pendingPeriods.length),
  };
}

export async function countPendingFees(db: Pick<PrismaClient, "fee">, memberId: number): Promise<number> {
  return db.fee.count({ where: { memberId, status: "pending" } });
}

export type GridCellState = "paid" | "pending" | "pending_import" | "exempt" | "voided" | "none";
export type GridCell = { period: Period; state: GridCellState; receiptNumber?: string };
export type GridRow = { year: number; cells: GridCell[] };

/** La cinta de períodos: una fila por año, 12 celdas. Desde el año del primer
 *  dato (cuota o ingreso) hasta el año del período corriente. */
export function buildPeriodGrid(
  fees: AccountFee[],
  receiptByPayment: Map<number, string>,
  joinedAt: Date | null,
  currentPeriod: Period,
): GridRow[] {
  const byPeriod = new Map(fees.map((f) => [f.period, f]));
  const currentYear = periodYear(currentPeriod);
  const years = [
    ...fees.map((f) => periodYear(f.period)),
    ...(joinedAt ? [periodYear(periodOf(joinedAt))] : []),
    currentYear,
  ];
  const firstYear = Math.min(...years);
  const rows: GridRow[] = [];
  for (let year = firstYear; year <= currentYear; year++) {
    const cells: GridCell[] = [];
    for (let m = 1; m <= 12; m++) {
      const period = `${year}-${String(m).padStart(2, "0")}`;
      const fee = byPeriod.get(period);
      if (!fee) {
        cells.push({ period, state: "none" });
        continue;
      }
      const state: GridCellState =
        fee.status === "paid" ? "paid"
        : fee.status === "pending" ? (fee.origin === "import" ? "pending_import" : "pending")
        : fee.status === "exempt" ? "exempt"
        : "voided";
      const receiptNumber = fee.paymentId !== null ? receiptByPayment.get(fee.paymentId) : undefined;
      cells.push(receiptNumber ? { period, state, receiptNumber } : { period, state });
    }
    rows.push({ year, cells });
  }
  return rows;
}
```

- [ ] **Step 4: Ver pasar**

```bash
npx vitest run tests/treasury-account.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/treasury/account.ts tests/treasury-account.test.ts
git commit -m "feat(m4): member account query and period grid

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Numeración sin huecos, directorio de recibos, monto en letras y PDF

**Files:**
- Create: `src/lib/treasury/receipt-number.ts`, `src/lib/treasury/receipts-dir.ts`, `src/lib/treasury/amount-words.ts`, `src/lib/treasury/receipt-pdf.ts`
- Test: `tests/treasury-receipt-number.test.ts`, `tests/treasury-amount-words.test.ts`, `tests/treasury-receipt-pdf.test.ts`, `tests/integration/receipt-sequence.test.ts`
- Modify: `package.json` (script `test:integration`), `.env.example`

**Interfaces:**
- Produces:
  - `formatReceiptNumber(year: number, seq: number): string` → `"2026-00001"`; `parseReceiptNumber(s): { year; seq } | null`.
  - `type TxLike = Prisma.TransactionClient`; `nextReceiptSeq(tx: TxLike, year: number): Promise<number>` — **solo dentro de `$transaction`**.
  - `receiptsDir(): string`, `receiptRelativePath(number): string` → `"2026/2026-00001.pdf"`, `writeReceiptPdf(relPath, bytes: Uint8Array)`, `readReceiptPdf(relPath): Promise<Buffer>`.
  - `amountInWords(n: number): string` → `"ciento treinta y ocho mil pesos"`.
  - `type ReceiptPdfData = { number: string; issuedAt: Date; memberName: string; memberNumber: number | null; concept: string; methodLabel: string; amount: number; voided: { reason: string } | null }`; `renderReceiptPdf(data): Promise<Uint8Array>`.

- [ ] **Step 1: Tests de número y de letras**

`tests/treasury-receipt-number.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatReceiptNumber, parseReceiptNumber } from "@/lib/treasury/receipt-number";

describe("receipt number", () => {
  it("formatea AAAA-NNNNN con ceros a la izquierda", () => {
    expect(formatReceiptNumber(2026, 1)).toBe("2026-00001");
    expect(formatReceiptNumber(2026, 12345)).toBe("2026-12345");
  });
  it("parsea y rechaza basura", () => {
    expect(parseReceiptNumber("2026-00042")).toEqual({ year: 2026, seq: 42 });
    expect(parseReceiptNumber("2026-42")).toBeNull();
    expect(parseReceiptNumber("../x")).toBeNull();
  });
});
```

`tests/treasury-amount-words.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { amountInWords } from "@/lib/treasury/amount-words";

describe("amountInWords", () => {
  it.each([
    [0, "cero pesos"],
    [1, "un peso"],
    [21, "veintiún pesos"],
    [100, "cien pesos"],
    [101, "ciento un pesos"],
    [3000, "tres mil pesos"],
    [6000, "seis mil pesos"],
    [18000, "dieciocho mil pesos"],
    [138000, "ciento treinta y ocho mil pesos"],
    [1000000, "un millón de pesos"],
    [2500000, "dos millones quinientos mil pesos"],
    [6000.5, "seis mil pesos con cincuenta centavos"],
  ])("%s → %s", (n, words) => {
    expect(amountInWords(n)).toBe(words);
  });
});
```

- [ ] **Step 2: Ver fallar**

```bash
npx vitest run tests/treasury-receipt-number.test.ts tests/treasury-amount-words.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implementar `src/lib/treasury/receipt-number.ts`**

```ts
// Serie única AAAA-NNNNN (REG-33). La secuencia se toma DENTRO de la transacción
// que crea el recibo: `INSERT … ON DUPLICATE KEY UPDATE` deja la fila del año
// bloqueada hasta el commit, así que dos pagos concurrentes se serializan y, si
// la transacción falla, el incremento se deshace con ella. Sin huecos.
import type { Prisma } from "@/generated/prisma/client";

export function formatReceiptNumber(year: number, seq: number): string {
  return `${year}-${String(seq).padStart(5, "0")}`;
}

export function parseReceiptNumber(s: string): { year: number; seq: number } | null {
  const m = /^(\d{4})-(\d{5})$/.exec(s);
  return m ? { year: Number(m[1]), seq: Number(m[2]) } : null;
}

// El cliente que `$transaction` le pasa al callback.
export type TxLike = Prisma.TransactionClient;

export async function nextReceiptSeq(tx: TxLike, year: number): Promise<number> {
  await tx.$executeRaw`INSERT INTO receipt_sequences (year, last) VALUES (${year}, 1) ON DUPLICATE KEY UPDATE last = last + 1`;
  const row = await tx.receiptSequence.findUniqueOrThrow({ where: { year } });
  return row.last;
}
```

- [ ] **Step 4: Implementar `src/lib/treasury/receipts-dir.ts`**

```ts
// Los PDFs viven fuera del webroot (RECEIPTS_DIR, prod /var/sigev/recibos, ya
// incluido en backup.sh) y se sirven solo por rutas autenticadas. Este módulo
// importa node:fs: NO importarlo desde componentes cliente.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseReceiptNumber } from "./receipt-number";

export function receiptsDir(): string {
  return process.env.RECEIPTS_DIR ?? "./recibos";
}

/** Ruta relativa determinística: `2026/2026-00001.pdf`. Lanza con un número
 *  que no tenga la forma de la serie: nunca se arma una ruta con texto libre. */
export function receiptRelativePath(number: string): string {
  const parsed = parseReceiptNumber(number);
  if (!parsed) throw new Error(`Número de recibo inválido: ${number}`);
  return path.posix.join(String(parsed.year), `${number}.pdf`);
}

export async function writeReceiptPdf(relPath: string, bytes: Uint8Array): Promise<void> {
  const abs = path.join(receiptsDir(), relPath);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, bytes);
}

export async function readReceiptPdf(relPath: string): Promise<Buffer> {
  return readFile(path.join(receiptsDir(), relPath));
}
```

- [ ] **Step 5: Implementar `src/lib/treasury/amount-words.ts`**

```ts
// Monto en letras para el recibo (castellano rioplatense). Enteros hasta
// 999.999.999 y centavos. Puro.
const UNITS = ["", "un", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve"];
const TEENS = ["diez", "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete", "dieciocho", "diecinueve"];
const TWENTIES = ["veinte", "veintiún", "veintidós", "veintitrés", "veinticuatro", "veinticinco", "veintiséis", "veintisiete", "veintiocho", "veintinueve"];
const TENS = ["", "", "veinte", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];
const HUNDREDS = ["", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos", "seiscientos", "setecientos", "ochocientos", "novecientos"];

function below100(n: number): string {
  if (n < 10) return UNITS[n];
  if (n < 20) return TEENS[n - 10];
  if (n < 30) return TWENTIES[n - 20];
  const t = Math.floor(n / 10);
  const u = n % 10;
  return u === 0 ? TENS[t] : `${TENS[t]} y ${UNITS[u]}`;
}

function below1000(n: number): string {
  if (n === 100) return "cien";
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const head = HUNDREDS[h];
  if (rest === 0) return head;
  return head ? `${head} ${below100(rest)}` : below100(rest);
}

function integerWords(n: number): string {
  if (n === 0) return "cero";
  const millions = Math.floor(n / 1_000_000);
  const thousands = Math.floor((n % 1_000_000) / 1000);
  const rest = n % 1000;
  const parts: string[] = [];
  if (millions === 1) parts.push("un millón");
  else if (millions > 1) parts.push(`${below1000(millions)} millones`);
  if (thousands === 1) parts.push("mil");
  else if (thousands > 1) parts.push(`${below1000(thousands)} mil`);
  if (rest > 0) parts.push(below1000(rest));
  return parts.join(" ");
}

export function amountInWords(amount: number): string {
  const cents = Math.round(amount * 100);
  const whole = Math.floor(cents / 100);
  const frac = cents % 100;
  let words = integerWords(whole);
  // "un millón DE pesos" solo con millones redondos.
  if (whole >= 1_000_000 && whole % 1_000_000 === 0) words += " de";
  words += whole === 1 ? " peso" : " pesos";
  if (frac > 0) words += ` con ${below100(frac)} centavos`;
  return words;
}
```

- [ ] **Step 6: Ver pasar**

```bash
npx vitest run tests/treasury-receipt-number.test.ts tests/treasury-amount-words.test.ts
```

Expected: PASS.

- [ ] **Step 7: Test del PDF**

`tests/treasury-receipt-pdf.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { renderReceiptPdf } from "@/lib/treasury/receipt-pdf";

describe("renderReceiptPdf", () => {
  it("produce un PDF A4 de una página", async () => {
    const bytes = await renderReceiptPdf({
      number: "2026-00001",
      issuedAt: new Date("2026-09-03T15:00:00Z"),
      memberName: "Skardius Ana Maria",
      memberNumber: 144,
      concept: "Cuota social · octubre a diciembre 2024 (3 cuotas)",
      methodLabel: "Efectivo",
      amount: 18000,
      voided: null,
    });
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getTitle()).toBe("Recibo 2026-00001 — Vecinal Ciudadela");
  });

  it("un recibo anulado también se renderiza", async () => {
    const bytes = await renderReceiptPdf({
      number: "2026-00002", issuedAt: new Date(), memberName: "Muñoz Ñandú", memberNumber: null,
      concept: "Aporte voluntario", methodLabel: "Efectivo", amount: 1000, voided: { reason: "Cargado por error" },
    });
    expect(bytes.length).toBeGreaterThan(1000);
  });
});
```

- [ ] **Step 8: Implementar `src/lib/treasury/receipt-pdf.ts`**

```ts
// Recibo PDF (spec §6.5): A4, una página, logo + nombre de la asociación, número
// grande, datos del pago. pdf-lib es JS puro: sin binarios en el VPS. Las fuentes
// estándar (Helvetica/Courier) solo tienen WinAnsi: cubre el castellano (tildes,
// ñ, ü) y lo demás se reemplaza para que un nombre raro no tire el recibo.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import { SITE } from "@/lib/site";
import { formatARS, formatDateAR } from "@/lib/format";
import { amountInWords } from "./amount-words";

export type ReceiptPdfData = {
  number: string;
  issuedAt: Date;
  memberName: string;
  memberNumber: number | null;
  concept: string;
  methodLabel: string;
  amount: number;
  voided: { reason: string } | null;
};

const PRIMARY = rgb(0 / 255, 121 / 255, 188 / 255); // #0079BC
const INK = rgb(0.1, 0.1, 0.1);
const MUTED = rgb(0.45, 0.45, 0.45);
const RED = rgb(0.85, 0.2, 0.2);

// Fuera de WinAnsi (U+0020–U+007E y U+00A0–U+00FF) se sustituye. El "·" del
// concepto es U+00B7, está cubierto.
function safe(s: string): string {
  return s.replace(/[^ -~ -ÿ]/g, "?");
}

let logoCache: Uint8Array | null = null;
async function logoBytes(): Promise<Uint8Array | null> {
  if (logoCache) return logoCache;
  try {
    logoCache = new Uint8Array(await readFile(path.join(process.cwd(), "assets", "logo.png")));
    return logoCache;
  } catch {
    return null; // sin logo el recibo sigue saliendo
  }
}

export async function renderReceiptPdf(data: ReceiptPdfData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Recibo ${data.number} — ${SITE.shortName}`);
  const page = doc.addPage([595.28, 841.89]); // A4
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.Courier);
  const margin = 48;
  const width = page.getWidth() - margin * 2;
  let y = page.getHeight() - margin;

  const logo = await logoBytes();
  if (logo) {
    const img = await doc.embedPng(logo);
    const h = 48;
    page.drawImage(img, { x: margin, y: y - h, width: (img.width / img.height) * h, height: h });
  }
  page.drawText(safe(SITE.name), { x: margin + 60, y: y - 18, size: 13, font: bold, color: INK });
  page.drawText(safe(SITE.city), { x: margin + 60, y: y - 34, size: 9, font, color: MUTED });

  // Número grande a la derecha: es lo que el socio busca cuando reclama.
  page.drawText("RECIBO", { x: margin + width - 150, y: y - 14, size: 10, font: bold, color: MUTED });
  page.drawText(data.number, { x: margin + width - 150, y: y - 42, size: 22, font: mono, color: PRIMARY });
  y -= 70;
  page.drawLine({ start: { x: margin, y }, end: { x: margin + width, y }, thickness: 1, color: PRIMARY });
  y -= 28;

  const row = (label: string, value: string, opts?: { big?: boolean; monoValue?: boolean }) => {
    page.drawText(safe(label.toUpperCase()), { x: margin, y, size: 8, font: bold, color: MUTED });
    page.drawText(safe(value), {
      x: margin + 140, y: y - 1, size: opts?.big ? 16 : 11,
      font: opts?.monoValue ? mono : font, color: INK, maxWidth: width - 140, lineHeight: 14,
    });
    y -= opts?.big ? 30 : 22;
  };

  row("Fecha", formatDateAR(data.issuedAt));
  row("Recibimos de", data.memberNumber !== null ? `${data.memberName} (socio N° ${data.memberNumber})` : data.memberName);
  row("Concepto", data.concept);
  row("Medio de pago", data.methodLabel);
  row("Importe", formatARS(data.amount), { big: true, monoValue: true });
  row("Son", amountInWords(data.amount));

  y -= 10;
  page.drawText(safe("Comprobante interno de la asociación. No válido como factura."), {
    x: margin, y, size: 8, font, color: MUTED,
  });

  if (data.voided) {
    page.drawText("ANULADO", { x: 120, y: 380, size: 72, font: bold, color: RED, opacity: 0.35, rotate: degrees(30) });
    page.drawText(safe(`Anulado: ${data.voided.reason}`), { x: margin, y: y - 16, size: 9, font: bold, color: RED });
  }

  return doc.save();
}
```

- [ ] **Step 9: Ver pasar**

```bash
npx vitest run tests/treasury-receipt-pdf.test.ts
```

Expected: PASS (2 tests). Si `embedPng` falla, verificar que `assets/logo.png` sea un PNG válido; el test también pasa sin logo (el `catch` devuelve `null`).

- [ ] **Step 10: Test de integración de la secuencia (MariaDB real)**

`tests/integration/receipt-sequence.test.ts`:

```ts
// Corre SOLO con DATABASE_URL_TEST apuntando a una base migrada (la de Docker
// sirve). 20 transacciones concurrentes piden número: tienen que salir 1..20
// sin huecos ni repetidos, y una transacción que falla no consume número.
import { describe, expect, it } from "vitest";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "@/generated/prisma/client";
import { nextReceiptSeq } from "@/lib/treasury/receipt-number";

const url = process.env.DATABASE_URL_TEST;

describe.skipIf(!url)("receipt sequence (MariaDB)", () => {
  const prisma = new PrismaClient({ adapter: new PrismaMariaDb(url ?? "") });
  const YEAR = 1999; // año que ningún recibo real va a usar

  it("20 pedidos concurrentes dan 1..20 sin huecos", async () => {
    await prisma.receiptSequence.deleteMany({ where: { year: YEAR } });
    const seqs = await Promise.all(
      Array.from({ length: 20 }, () =>
        prisma.$transaction((tx) => nextReceiptSeq(tx, YEAR), { timeout: 20000 })),
    );
    expect([...seqs].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it("una transacción que falla no consume número", async () => {
    await prisma.receiptSequence.deleteMany({ where: { year: YEAR } });
    await prisma.$transaction((tx) => nextReceiptSeq(tx, YEAR));
    await expect(
      prisma.$transaction(async (tx) => {
        await nextReceiptSeq(tx, YEAR);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await prisma.$transaction((tx) => nextReceiptSeq(tx, YEAR))).toBe(2);
    await prisma.receiptSequence.deleteMany({ where: { year: YEAR } });
    await prisma.$disconnect();
  });
});
```

`vitest.config.mts` ya incluye `tests/**/*.test.ts`: sin `DATABASE_URL_TEST` el `describe.skipIf` lo saltea. En `package.json` agregar el script:

```json
    "test:integration": "vitest run tests/integration"
```

En `.env.example`, debajo de `SHADOW_DATABASE_URL`:

```
# Solo para `npm run test:integration` (numeración de recibos contra MariaDB
# real). La base de desarrollo ya migrada sirve; el test usa el año 1999.
# DATABASE_URL_TEST="mysql://sigev:sigev_dev@localhost:3306/sigev"
```

- [ ] **Step 11: Correr la integración contra Docker**

PowerShell:

```powershell
$env:DATABASE_URL_TEST="mysql://sigev:sigev_dev@localhost:3306/sigev"; npx vitest run tests/integration; Remove-Item Env:DATABASE_URL_TEST
```

Expected: PASS (2 tests). Sin la variable: `skipped`.

- [ ] **Step 12: Commit**

```bash
git add src/lib/treasury/receipt-number.ts src/lib/treasury/receipts-dir.ts src/lib/treasury/amount-words.ts src/lib/treasury/receipt-pdf.ts tests/treasury-receipt-number.test.ts tests/treasury-amount-words.test.ts tests/treasury-receipt-pdf.test.ts tests/integration package.json .env.example
git commit -m "feat(m4): gapless receipt numbering, receipt PDF and storage

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Servicio de tesorería — efectivo y anulación

**Files:**
- Create: `src/lib/treasury/service.ts`
- Test: `tests/treasury-service.test.ts`

**Interfaces:**
- Consumes: `allocate`, `revertFees`, `feeAmountFor`, `cashConceptsFor`, `CashConcept` (Task 3); `paymentConcept`, `PAYMENT_TYPE_LABELS` (Task 3); `currentPeriod`, `comparePeriods` (Task 2); `makeFeeValueReader`, `feeValueReader`, `NO_FEE_VALUE_MESSAGE` (Task 4); `nextReceiptSeq`, `formatReceiptNumber` (Task 6); `receiptRelativePath`, `writeReceiptPdf` (Task 6); `renderReceiptPdf`, `ReceiptPdfData` (Task 6); `createKeyedMutex` de `@/lib/keyed-mutex`.
- Produces: `class TreasuryError extends Error`; `makeTreasuryService(deps: { db: PrismaClient; feeValues: ReturnType<typeof makeFeeValueReader>; now?: () => Date; renderPdf?; writePdf? })` con:
  - `registerCashPayment({ memberId, actorId, concept: CashConcept, count?, amount?, note? }): Promise<{ paymentId: number; receiptId: number; number: string; periods: Period[]; amount: number; pdfWritten: boolean }>`
  - `voidReceipt({ receiptId, actorId, reason }): Promise<{ paymentId: number; number: string; periodsReverted: number }>`
  - `receiptPdfData(receiptId): Promise<ReceiptPdfData>`, `regenerateReceiptPdf(receiptId): Promise<Uint8Array>`
  - singleton `treasuryService`.

- [ ] **Step 1: Test con dobles de Prisma**

`tests/treasury-service.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { civilDateUtc } from "@/lib/dates";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import { makeTreasuryService, TreasuryError } from "@/lib/treasury/service";

type Fee = { id: number; memberId: number; period: string; status: string; origin: string; paymentId: number | null };
type Row = Record<string, unknown> & { id: number };

function fakeDb(opts: { member: Record<string, unknown>; fees: Fee[] }) {
  const state = { fees: opts.fees.map((f) => ({ ...f })), payments: [] as Row[], receipts: [] as Row[], seq: 0 };
  const tx = {
    member: { findUnique: vi.fn(async () => opts.member) },
    fee: {
      findMany: vi.fn(async (args: { where: { memberId: number } }) =>
        state.fees.filter((f) => f.memberId === args.where.memberId)),
      updateMany: vi.fn(async (args: { where: { memberId: number; period: { in: string[] } }; data: Record<string, unknown> }) => {
        let count = 0;
        for (const f of state.fees) {
          if (f.memberId === args.where.memberId && args.where.period.in.includes(f.period)) { Object.assign(f, args.data); count++; }
        }
        return { count };
      }),
      createMany: vi.fn(async (args: { data: Array<Omit<Fee, "id">> }) => {
        for (const d of args.data) state.fees.push({ id: state.fees.length + 1, ...d });
        return { count: args.data.length };
      }),
      deleteMany: vi.fn(async (args: { where: { id: { in: number[] } } }) => {
        const before = state.fees.length;
        state.fees = state.fees.filter((f) => !args.where.id.in.includes(f.id));
        return { count: before - state.fees.length };
      }),
    },
    payment: {
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        const p = { id: state.payments.length + 1, ...args.data };
        state.payments.push(p);
        return p;
      }),
      update: vi.fn(async (args: { where: { id: number }; data: Record<string, unknown> }) => {
        const p = state.payments.find((x) => x.id === args.where.id)!;
        Object.assign(p, args.data);
        return p;
      }),
    },
    receipt: {
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        const r = { id: state.receipts.length + 1, ...args.data };
        state.receipts.push(r);
        return r;
      }),
      findUnique: vi.fn(async (args: { where: { id: number } }) => {
        const r = state.receipts.find((x) => x.id === args.where.id);
        if (!r) return null;
        const payment = state.payments.find((p) => p.id === r.paymentId)!;
        return {
          ...r,
          payment: { ...payment, fees: state.fees.filter((f) => f.paymentId === payment.id), member: opts.member },
        };
      }),
      update: vi.fn(async (args: { where: { id: number }; data: Record<string, unknown> }) => {
        const r = state.receipts.find((x) => x.id === args.where.id)!;
        Object.assign(r, args.data);
        return r;
      }),
    },
    $executeRaw: vi.fn(async () => { state.seq++; return 1; }),
    receiptSequence: { findUniqueOrThrow: vi.fn(async () => ({ year: 2026, last: state.seq })) },
  };
  const db = { ...tx, $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)) };
  return { db: db as never, state };
}

const feeValue = { id: 1, activeAmount: 6000, sharedAmount: 3000, validFrom: civilDateUtc(2026, 9, 1), minuteId: null };
const feeValues = { current: vi.fn(async () => feeValue), history: vi.fn(async () => [feeValue]) };
const renderPdf = vi.fn(async () => new Uint8Array([0x25, 0x50, 0x44, 0x46]));
const writePdf = vi.fn(async () => {});
const now = () => new Date("2026-09-03T15:00:00Z");
const active = (id: number) => ({
  id, fullName: "Socio", category: "active", status: "active",
  memberships: [{ memberNumber: id, book: { status: "open" } }],
});

describe("registerCashPayment", () => {
  beforeEach(() => { renderPdf.mockClear(); writePdf.mockClear(); });

  it("imputa N cuotas a las más viejas, numera y escribe el PDF", async () => {
    const { db, state } = fakeDb({
      member: active(144),
      fees: [
        { id: 1, memberId: 144, period: "2024-10", status: "pending", origin: "import", paymentId: null },
        { id: 2, memberId: 144, period: "2024-11", status: "pending", origin: "import", paymentId: null },
        { id: 3, memberId: 144, period: "2024-12", status: "pending", origin: "import", paymentId: null },
        { id: 4, memberId: 144, period: "2025-01", status: "pending", origin: "import", paymentId: null },
      ],
    });
    const svc = makeTreasuryService({ db, feeValues, now, renderPdf, writePdf });
    const r = await svc.registerCashPayment({ memberId: 144, actorId: 1, concept: "fees", count: 3 });
    expect(r.number).toBe("2026-00001");
    expect(r.periods).toEqual(["2024-10", "2024-11", "2024-12"]);
    expect(r.amount).toBe(18000);
    expect(r.pdfWritten).toBe(true);
    expect(state.fees.filter((f) => f.status === "paid").map((f) => f.period)).toEqual(["2024-10", "2024-11", "2024-12"]);
    expect(state.payments[0]).toMatchObject({ type: "cash", amount: "18000.00", registeredById: 1 });
    expect(state.receipts[0]).toMatchObject({ number: "2026-00001", year: 2026, seq: 1, pdfPath: "2026/2026-00001.pdf" });
    expect(writePdf).toHaveBeenCalledWith("2026/2026-00001.pdf", expect.any(Uint8Array));
  });

  it("un socio al día crea la cuota del período corriente", async () => {
    const { db, state } = fakeDb({ member: { ...active(2), category: "collaborator" }, fees: [] });
    const svc = makeTreasuryService({ db, feeValues, now, renderPdf, writePdf });
    const r = await svc.registerCashPayment({ memberId: 2, actorId: 1, concept: "fees", count: 1 });
    expect(r.periods).toEqual(["2026-09"]);
    expect(r.amount).toBe(3000);
    expect(state.fees[0]).toMatchObject({ period: "2026-09", status: "paid", origin: "accrual", paymentId: 1 });
  });

  it("voluntaria de monto libre no toca cuotas", async () => {
    const { db, state } = fakeDb({ member: { ...active(3), category: "adherent" }, fees: [] });
    const svc = makeTreasuryService({ db, feeValues, now, renderPdf, writePdf });
    const r = await svc.registerCashPayment({ memberId: 3, actorId: 1, concept: "voluntary", amount: 2500 });
    expect(r.amount).toBe(2500);
    expect(r.periods).toEqual([]);
    expect(state.fees).toHaveLength(0);
    expect(state.payments[0]).toMatchObject({ type: "voluntary" });
  });

  it("rechaza cuotas para un adherente, count 0 y socio dado de baja", async () => {
    const adh = fakeDb({ member: { ...active(3), category: "adherent" }, fees: [] });
    await expect(makeTreasuryService({ db: adh.db, feeValues, now, renderPdf, writePdf })
      .registerCashPayment({ memberId: 3, actorId: 1, concept: "fees", count: 1 })).rejects.toThrow(TreasuryError);
    const act = fakeDb({ member: active(4), fees: [] });
    await expect(makeTreasuryService({ db: act.db, feeValues, now, renderPdf, writePdf })
      .registerCashPayment({ memberId: 4, actorId: 1, concept: "fees", count: 0 })).rejects.toThrow(/cuotas/);
    const baja = fakeDb({ member: { ...active(5), status: "withdrawn" }, fees: [] });
    await expect(makeTreasuryService({ db: baja.db, feeValues, now, renderPdf, writePdf })
      .registerCashPayment({ memberId: 5, actorId: 1, concept: "voluntary", amount: 100 })).rejects.toThrow(/baja/);
  });

  it("sin valor vigente no cobra cuotas", async () => {
    const { db } = fakeDb({ member: active(4), fees: [] });
    const noValue = { current: vi.fn(async () => null), history: vi.fn(async () => []) };
    await expect(makeTreasuryService({ db, feeValues: noValue, now, renderPdf, writePdf })
      .registerCashPayment({ memberId: 4, actorId: 1, concept: "fees", count: 1 })).rejects.toThrow(/valor de cuota/);
  });

  it("si el PDF falla el recibo existe igual y se informa", async () => {
    const { db, state } = fakeDb({ member: active(4), fees: [] });
    const failingWrite = vi.fn(async () => { throw new Error("disk"); });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const svc = makeTreasuryService({ db, feeValues, now, renderPdf, writePdf: failingWrite });
    const r = await svc.registerCashPayment({ memberId: 4, actorId: 1, concept: "fees", count: 1 });
    expect(r.pdfWritten).toBe(false);
    expect(state.receipts[0]).toMatchObject({ number: "2026-00001" });
    errorLog.mockRestore();
  });
});

describe("voidReceipt", () => {
  it("anula el recibo, marca el pago voided; las cuotas vuelven a pendiente y las futuras se borran", async () => {
    const { db, state } = fakeDb({ member: active(4), fees: [
      { id: 1, memberId: 4, period: "2026-08", status: "pending", origin: "accrual", paymentId: null },
    ] });
    const svc = makeTreasuryService({ db, feeValues, now, renderPdf, writePdf });
    const r = await svc.registerCashPayment({ memberId: 4, actorId: 1, concept: "fees", count: 3 }); // ago, sep, oct
    expect(r.periods).toEqual(["2026-08", "2026-09", "2026-10"]);
    const v = await svc.voidReceipt({ receiptId: r.receiptId, actorId: 2, reason: "Cargado por error" });
    expect(v.number).toBe("2026-00001");
    expect(v.periodsReverted).toBe(3);
    expect(state.receipts[0]).toMatchObject({ voidReason: "Cargado por error", voidedById: 2 });
    expect(state.payments[0]).toMatchObject({ status: "voided" });
    expect(state.fees.map((f) => [f.period, f.status, f.paymentId]))
      .toEqual([["2026-08", "pending", null], ["2026-09", "pending", null]]);
  });

  it("no anula dos veces", async () => {
    const { db } = fakeDb({ member: active(4), fees: [] });
    const svc = makeTreasuryService({ db, feeValues, now, renderPdf, writePdf });
    const r = await svc.registerCashPayment({ memberId: 4, actorId: 1, concept: "extraordinary", amount: 500 });
    await svc.voidReceipt({ receiptId: r.receiptId, actorId: 1, reason: "x" });
    await expect(svc.voidReceipt({ receiptId: r.receiptId, actorId: 1, reason: "y" })).rejects.toThrow(/ya está anulado/);
  });
});
```

- [ ] **Step 2: Ver fallar**

```bash
npx vitest run tests/treasury-service.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implementar `src/lib/treasury/service.ts`**

```ts
// Escrituras de tesorería (spec §6.2, §2.4). Una transacción por operación:
// pago + cuotas + número de recibo. El PDF y el email van DESPUÉS del commit y
// son best-effort: el número ya es definitivo cuando se escribe el archivo.
import type { PaymentType, PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { createKeyedMutex } from "@/lib/keyed-mutex";
import { feeValueReader, makeFeeValueReader, NO_FEE_VALUE_MESSAGE } from "./fee-values";
import { PAYMENT_TYPE_LABELS, paymentConcept } from "./labels";
import { comparePeriods, currentPeriod, type Period } from "./periods";
import { formatReceiptNumber, nextReceiptSeq } from "./receipt-number";
import { renderReceiptPdf, type ReceiptPdfData } from "./receipt-pdf";
import { receiptRelativePath, writeReceiptPdf } from "./receipts-dir";
import { allocate, cashConceptsFor, feeAmountFor, revertFees, type CashConcept } from "./rules";

export class TreasuryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TreasuryError";
  }
}

type Deps = {
  db: PrismaClient;
  feeValues: ReturnType<typeof makeFeeValueReader>;
  now?: () => Date;
  renderPdf?: (data: ReceiptPdfData) => Promise<Uint8Array>;
  writePdf?: (relPath: string, bytes: Uint8Array) => Promise<void>;
};

const CONCEPT_TYPE: Record<CashConcept, PaymentType> = {
  fees: "cash", voluntary: "voluntary", extraordinary: "extraordinary",
};

const MAX_FEES_PER_PAYMENT = 60;

// Año de la serie en hora Argentina (un efectivo cargado el 31/12 a las 22:00
// AR es todavía del año viejo aunque en UTC ya sea 1° de enero).
function seriesYear(at: Date): number {
  return Number(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric" }).format(at));
}

// Dos admins registrando sobre el mismo socio: la transacción y el unique
// (memberId, period) ya impiden imputar dos veces la misma cuota; el mutex
// evita que el segundo vea un error técnico en vez de la cuenta actualizada.
// Un solo proceso (premisa de docs/03): vive en memoria.
const memberMutex = createKeyedMutex();

export function makeTreasuryService(deps: Deps) {
  const now = deps.now ?? (() => new Date());
  const renderPdf = deps.renderPdf ?? renderReceiptPdf;
  const writePdf = deps.writePdf ?? writeReceiptPdf;
  const { db } = deps;

  async function pdfDataFor(receiptId: number): Promise<ReceiptPdfData> {
    const r = await db.receipt.findUnique({
      where: { id: receiptId },
      include: {
        payment: {
          include: {
            fees: { select: { period: true } },
            member: { include: { memberships: { include: { book: true } } } },
          },
        },
      },
    });
    if (!r) throw new TreasuryError("El recibo no existe.");
    const member = r.payment.member;
    const open = member?.memberships.find((m) => m.book.status === "open");
    return {
      number: r.number,
      issuedAt: r.issuedAt,
      memberName: member?.fullName ?? "—",
      memberNumber: open?.memberNumber ?? null,
      concept: paymentConcept(r.payment.type, r.payment.fees.map((f) => f.period)),
      methodLabel: PAYMENT_TYPE_LABELS[r.payment.type],
      amount: Number(r.payment.amount),
      voided: r.voidedAt ? { reason: r.voidReason ?? "" } : null,
    };
  }

  async function writePdfBestEffort(receiptId: number, relPath: string): Promise<boolean> {
    try {
      await writePdf(relPath, await renderPdf(await pdfDataFor(receiptId)));
      return true;
    } catch (e) {
      // Sin datos personales en el log. El recibo se regenera bajo demanda.
      console.error("[treasury] no se pudo escribir el PDF del recibo", receiptId, e instanceof Error ? e.message : e);
      return false;
    }
  }

  return {
    async registerCashPayment(input: {
      memberId: number; actorId: number; concept: CashConcept; count?: number; amount?: number; note?: string;
    }) {
      return memberMutex.run(`member:${input.memberId}`, async () => {
        const at = now();
        const member = await db.member.findUnique({
          where: { id: input.memberId },
          include: { memberships: { include: { book: true } } },
        });
        if (!member) throw new TreasuryError("El socio no existe.");
        if (member.status === "withdrawn") {
          throw new TreasuryError("El socio está dado de baja: registrá primero el reingreso.");
        }
        if (!cashConceptsFor(member.category).includes(input.concept)) {
          throw new TreasuryError("Ese concepto no corresponde a la categoría del socio.");
        }

        let periods: Period[] = [];
        let toCreate: Period[] = [];
        let amount: number;
        if (input.concept === "fees") {
          const count = input.count ?? 0;
          if (!Number.isInteger(count) || count <= 0) throw new TreasuryError("Indicá cuántas cuotas paga (al menos una).");
          if (count > MAX_FEES_PER_PAYMENT) {
            throw new TreasuryError(`No se pueden registrar más de ${MAX_FEES_PER_PAYMENT} cuotas en un solo pago.`);
          }
          const value = await deps.feeValues.current(at);
          if (!value) throw new TreasuryError(NO_FEE_VALUE_MESSAGE);
          const unit = feeAmountFor(member.category, value);
          if (unit === null) throw new TreasuryError("La categoría del socio no paga cuota.");
          const fees = await db.fee.findMany({ where: { memberId: member.id }, select: { period: true, status: true } });
          const allocation = allocate({
            pending: fees.filter((f) => f.status === "pending").map((f) => f.period),
            existing: fees.map((f) => f.period),
            n: count,
            currentPeriod: currentPeriod(at),
          });
          periods = allocation.toPay;
          toCreate = allocation.toCreate;
          amount = unit * count;
        } else {
          const free = input.amount ?? 0;
          if (!Number.isFinite(free) || free <= 0) throw new TreasuryError("Ingresá el monto del aporte.");
          amount = Math.round(free * 100) / 100;
        }

        const year = seriesYear(at);
        const created = await db.$transaction(async (tx) => {
          const payment = await tx.payment.create({
            data: {
              memberId: member.id, type: CONCEPT_TYPE[input.concept], amount: amount.toFixed(2), paidAt: at,
              registeredById: input.actorId, note: input.note ?? null, status: "applied",
            },
          });
          if (toCreate.length > 0) {
            await tx.fee.createMany({
              data: toCreate.map((period) => ({
                memberId: member.id, period, status: "paid", origin: "accrual", paymentId: payment.id,
              })),
            });
          }
          const existingToPay = periods.filter((p) => !toCreate.includes(p));
          if (existingToPay.length > 0) {
            await tx.fee.updateMany({
              where: { memberId: member.id, period: { in: existingToPay } },
              data: { status: "paid", paymentId: payment.id },
            });
          }
          const seq = await nextReceiptSeq(tx, year);
          const number = formatReceiptNumber(year, seq);
          const receipt = await tx.receipt.create({
            data: { number, year, seq, paymentId: payment.id, pdfPath: receiptRelativePath(number), issuedAt: at },
          });
          return { paymentId: payment.id, receiptId: receipt.id, number };
        });

        const pdfWritten = await writePdfBestEffort(created.receiptId, receiptRelativePath(created.number));
        return { ...created, periods: [...periods].sort(comparePeriods), amount, pdfWritten };
      });
    },

    async voidReceipt(input: { receiptId: number; actorId: number; reason: string }) {
      const at = now();
      const r = await db.receipt.findUnique({
        where: { id: input.receiptId },
        include: { payment: { include: { fees: { select: { id: true, period: true } } } } },
      });
      if (!r) throw new TreasuryError("El recibo no existe.");
      if (r.voidedAt) throw new TreasuryError("El recibo ya está anulado.");
      const memberId = r.payment.memberId;
      return memberMutex.run(`member:${memberId ?? 0}`, async () => {
        const { toPending, toDelete } = revertFees(r.payment.fees.map((f) => f.period), currentPeriod(at));
        await db.$transaction(async (tx) => {
          if (memberId !== null && toPending.length > 0) {
            await tx.fee.updateMany({
              where: { memberId, period: { in: toPending } },
              data: { status: "pending", paymentId: null },
            });
          }
          if (toDelete.length > 0) {
            const ids = r.payment.fees.filter((f) => toDelete.includes(f.period)).map((f) => f.id);
            await tx.fee.deleteMany({ where: { id: { in: ids } } });
          }
          await tx.payment.update({ where: { id: r.payment.id }, data: { status: "voided" } });
          await tx.receipt.update({
            where: { id: r.id },
            data: { voidedAt: at, voidReason: input.reason, voidedById: input.actorId },
          });
        });
        // El PDF se regenera con la marca ANULADO; si falla, se regenera al pedirlo.
        await writePdfBestEffort(r.id, r.pdfPath ?? receiptRelativePath(r.number));
        return { paymentId: r.payment.id, number: r.number, periodsReverted: toPending.length + toDelete.length };
      });
    },

    receiptPdfData: pdfDataFor,

    async regenerateReceiptPdf(receiptId: number): Promise<Uint8Array> {
      const data = await pdfDataFor(receiptId);
      const bytes = await renderPdf(data);
      await writePdf(receiptRelativePath(data.number), bytes);
      return bytes;
    },
  };
}

export const treasuryService = makeTreasuryService({ db: prisma, feeValues: feeValueReader });
```

- [ ] **Step 4: Ver pasar**

```bash
npx vitest run tests/treasury-service.test.ts && npx tsc --noEmit
```

Expected: PASS (8 tests), sin errores de tipos.

- [ ] **Step 5: Commit**

```bash
git add src/lib/treasury/service.ts tests/treasury-service.test.ts
git commit -m "feat(m4): treasury service — cash payments with receipts, voiding

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Email del recibo con adjunto

**Files:**
- Modify: `src/lib/email/transport.ts` (adjuntos), `src/lib/email/index.ts` (tipo del mensaje), `src/lib/email/templates.ts` (`receiptEmail`)
- Create: `src/lib/treasury/receipt-email.ts`
- Test: `tests/email.test.ts` (casos nuevos), `tests/treasury-receipt-email.test.ts`

**Interfaces:**
- Produces: `type MailAttachment = { filename: string; content: Buffer; contentType: string }`; `MailMessage.attachments?: MailAttachment[]`; `receiptEmail({ name, number, concept, amount }): Rendered`; `makeReceiptEmailer({ db, mailer, readPdf, regenerate })` → `{ sendReceiptEmail(receiptId): Promise<ReceiptEmailResult> }` con `type ReceiptEmailResult = { sent: true } | { sent: false; reason: "no_email" | "error"; code?: string }`; singleton `sendReceiptEmail`.
- Consumes: `paymentConcept` (Task 3), `readReceiptPdf`, `receiptRelativePath` (Task 6), `treasuryService.regenerateReceiptPdf` (Task 7).

- [ ] **Step 1: Tests**

En `tests/email.test.ts`, sumar `receiptEmail` al import de `@/lib/email/templates` y agregar en el `describe` de plantillas:

```ts
  it("receiptEmail nombra número, concepto y monto, y avisa que el PDF va adjunto", () => {
    const r = receiptEmail({ name: "Ana", number: "2026-00012", concept: "Cuota social · marzo 2025", amount: 6000 });
    expect(r.subject).toBe("Recibo 2026-00012 — Vecinal Ciudadela");
    expect(r.text).toContain("2026-00012");
    expect(r.text).toContain("$ 6.000,00");
    expect(r.text).toContain("adjunto");
    expect(r.html).toContain("Cuota social · marzo 2025");
  });
```

y en el bloque del transporte de consola (el que borra las variables de Brevo):

```ts
  it("el transporte de consola lista los adjuntos por nombre y tamaño, no por contenido", async () => {
    for (const k of ["BREVO_SMTP_HOST", "BREVO_SMTP_USER", "BREVO_SMTP_KEY", "MAIL_FROM", "EMAIL_ALLOWLIST"]) delete process.env[k];
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await getTransport().send({
      to: "a@b.com", subject: "s", text: "t", html: "<p>t</p>",
      attachments: [{ filename: "recibo-2026-00001.pdf", content: Buffer.from("%PDF-"), contentType: "application/pdf" }],
    });
    expect(log.mock.calls.flat().join("\n")).toContain("recibo-2026-00001.pdf (5 B)");
    log.mockRestore();
  });
```

`tests/treasury-receipt-email.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/email", () => ({ mailer: {} }));
vi.mock("@/lib/treasury/service", () => ({ treasuryService: {} }));
import { makeReceiptEmailer } from "@/lib/treasury/receipt-email";

function setup(member: { email: string | null; emailStatus: string } | null) {
  const receipt = {
    id: 7, number: "2026-00007", pdfPath: "2026/2026-00007.pdf", emailedAt: null,
    payment: {
      id: 3, type: "cash", amount: "6000.00", memberId: 1, fees: [{ period: "2026-09" }],
      member: member ? { id: 1, fullName: "Ana", ...member } : null,
    },
  };
  const db = { receipt: { findUnique: vi.fn(async () => receipt), update: vi.fn(async () => ({})) } };
  const mailer = { sendToMember: vi.fn(async () => ({ messageId: "m1" })) };
  const readPdf = vi.fn(async () => Buffer.from("%PDF-1.4"));
  const regenerate = vi.fn(async () => new Uint8Array([1]));
  return {
    db, mailer, readPdf, regenerate,
    emailer: makeReceiptEmailer({ db: db as never, mailer: mailer as never, readPdf, regenerate }),
  };
}

describe("sendReceiptEmail", () => {
  it("envía con el PDF adjunto y sella emailedAt", async () => {
    const s = setup({ email: "ana@x.com", emailStatus: "declared" });
    expect(await s.emailer.sendReceiptEmail(7)).toEqual({ sent: true });
    const call = s.mailer.sendToMember.mock.calls[0][0] as {
      to: string; type: string; message: { attachments: Array<{ filename: string }> };
    };
    expect(call.to).toBe("ana@x.com");
    expect(call.type).toBe("receipt");
    expect(call.message.attachments[0].filename).toBe("recibo-2026-00007.pdf");
    expect(s.db.receipt.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { emailedAt: expect.any(Date) } });
  });

  it("sin email no envía y lo dice", async () => {
    const s = setup({ email: null, emailStatus: "none" });
    expect(await s.emailer.sendReceiptEmail(7)).toEqual({ sent: false, reason: "no_email" });
    expect(s.mailer.sendToMember).not.toHaveBeenCalled();
  });

  it("si el PDF no está en disco lo regenera", async () => {
    const s = setup({ email: "ana@x.com", emailStatus: "verified" });
    s.readPdf.mockRejectedValueOnce(new Error("ENOENT"));
    await s.emailer.sendReceiptEmail(7);
    expect(s.regenerate).toHaveBeenCalledWith(7);
    expect(s.mailer.sendToMember).toHaveBeenCalled();
  });

  it("si el transporte falla devuelve el código sin tirar", async () => {
    const s = setup({ email: "ana@x.com", emailStatus: "declared" });
    s.mailer.sendToMember.mockRejectedValueOnce(Object.assign(new Error("x"), { code: "EAUTH" }));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await s.emailer.sendReceiptEmail(7)).toEqual({ sent: false, reason: "error", code: "EAUTH" });
    errorLog.mockRestore();
  });
});
```

- [ ] **Step 2: Ver fallar**

```bash
npx vitest run tests/email.test.ts tests/treasury-receipt-email.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Adjuntos en `src/lib/email/transport.ts`**

Reemplazar las dos primeras líneas de tipos por:

```ts
export type MailAttachment = { filename: string; content: Buffer; contentType: string };
export type MailMessage = {
  to: string; subject: string; text: string; html: string; attachments?: MailAttachment[];
};
export type MailTransport = { send(msg: MailMessage): Promise<{ messageId: string | null }> };
```

`makeBrevoTransport` no cambia (nodemailer acepta `attachments` con esa forma en `sendMail({ from, ...msg })`). En `makeConsoleTransport`:

```ts
    async send(msg) {
      const attached = (msg.attachments ?? []).map((a) => `${a.filename} (${a.content.length} B)`).join(", ");
      console.log(
        `[mail:dev] to=${msg.to} subject="${msg.subject}"${attached ? ` attachments=${attached}` : ""}\n${msg.text}`,
      );
      return { messageId: null };
    },
```

En `src/lib/email/index.ts`, importar `type MailMessage` desde `./transport` y reemplazar las tres ocurrencias de `message: { subject: string; text: string; html: string }` por `message: Omit<MailMessage, "to">`.

- [ ] **Step 4: Plantilla en `src/lib/email/templates.ts`**

Agregar arriba `import { formatARS } from "@/lib/format";` y al final:

```ts
/** Recibo de tesorería (M4). El PDF viaja adjunto; el cuerpo repite lo esencial
 *  para quien no abre adjuntos. Saluda por nombre: va a la casilla del socio
 *  que pagó, registrada en su ficha. */
export function receiptEmail(opts: { name: string; number: string; concept: string; amount: number }): Rendered {
  const amount = formatARS(opts.amount);
  return {
    subject: `Recibo ${opts.number} — Vecinal Ciudadela`,
    text: `Hola ${opts.name}:

Registramos tu pago y te enviamos el recibo N° ${opts.number}.

Concepto: ${opts.concept}
Importe: ${amount}

El recibo en PDF va adjunto a este correo. Si no corresponde, respondé este mensaje o acercate a la sede.${SIGNATURE}`,
    html: layout(`Recibo ${opts.number}`, `<p>Hola <strong>${esc(opts.name)}</strong>:</p>
<p>Registramos tu pago y te enviamos el recibo <strong>N° ${esc(opts.number)}</strong>.</p>
<p>Concepto: ${esc(opts.concept)}<br>Importe: <strong>${esc(amount)}</strong></p>
<p>El recibo en PDF va adjunto a este correo. Si no corresponde, respondé este mensaje o acercate a la sede.</p>`),
  };
}
```

- [ ] **Step 5: Implementar `src/lib/treasury/receipt-email.ts`**

```ts
// Envío del recibo por email con el PDF adjunto. Best-effort: nunca tira; el
// llamador decide qué mostrar. Queda acreditado como Notification `receipt`.
import type { PrismaClient } from "@/generated/prisma/client";
import { mailer } from "@/lib/email";
import { receiptEmail } from "@/lib/email/templates";
import { prisma } from "@/lib/prisma";
import { paymentConcept } from "./labels";
import { readReceiptPdf, receiptRelativePath } from "./receipts-dir";
import { treasuryService } from "./service";

type Mailer = Pick<typeof mailer, "sendToMember">;

export type ReceiptEmailResult = { sent: true } | { sent: false; reason: "no_email" | "error"; code?: string };

// Solo `code`: el error de nodemailer trae la dirección en claro (docs/08).
function codeOf(e: unknown): string {
  const c = (e as { code?: unknown } | null)?.code;
  return typeof c === "string" ? c : "unknown";
}

export function makeReceiptEmailer(deps: {
  db: Pick<PrismaClient, "receipt">;
  mailer: Mailer;
  readPdf: (relPath: string) => Promise<Buffer>;
  regenerate: (receiptId: number) => Promise<Uint8Array>;
}) {
  return {
    async sendReceiptEmail(receiptId: number): Promise<ReceiptEmailResult> {
      const r = await deps.db.receipt.findUnique({
        where: { id: receiptId },
        include: {
          payment: {
            include: {
              fees: { select: { period: true } },
              member: { select: { id: true, fullName: true, email: true, emailStatus: true } },
            },
          },
        },
      });
      if (!r) return { sent: false, reason: "error", code: "not_found" };
      const member = r.payment.member;
      if (!member?.email || member.emailStatus === "bounced") return { sent: false, reason: "no_email" };
      try {
        let pdf: Buffer;
        try {
          pdf = await deps.readPdf(r.pdfPath ?? receiptRelativePath(r.number));
        } catch {
          pdf = Buffer.from(await deps.regenerate(r.id));
        }
        const message = receiptEmail({
          name: member.fullName,
          number: r.number,
          concept: paymentConcept(r.payment.type, r.payment.fees.map((f) => f.period)),
          amount: Number(r.payment.amount),
        });
        await deps.mailer.sendToMember({
          memberId: member.id,
          to: member.email,
          type: "receipt",
          message: {
            ...message,
            attachments: [{ filename: `recibo-${r.number}.pdf`, content: pdf, contentType: "application/pdf" }],
          },
          summary: `recibo ${r.number}`,
        });
        await deps.db.receipt.update({ where: { id: r.id }, data: { emailedAt: new Date() } });
        return { sent: true };
      } catch (e) {
        console.error("[treasury] no se pudo enviar el recibo por email", receiptId, codeOf(e));
        return { sent: false, reason: "error", code: codeOf(e) };
      }
    },
  };
}

export const { sendReceiptEmail } = makeReceiptEmailer({
  db: prisma,
  mailer,
  readPdf: readReceiptPdf,
  regenerate: (id) => treasuryService.regenerateReceiptPdf(id),
});
```

- [ ] **Step 6: Ver pasar**

```bash
npx vitest run tests/email.test.ts tests/treasury-receipt-email.test.ts && npx tsc --noEmit
```

Expected: PASS, sin errores de tipos.

- [ ] **Step 7: Commit**

```bash
git add src/lib/email src/lib/treasury/receipt-email.ts tests/email.test.ts tests/treasury-receipt-email.test.ts
git commit -m "feat(m4): receipt email with PDF attachment

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Rutas API de recibos (admin y socio)

**Files:**
- Create: `src/app/api/admin/recibos/[id]/route.ts`, `src/app/api/mi/recibos/[id]/route.ts`
- Test: `tests/receipt-routes.test.ts`

**Interfaces:**
- Consumes: `readReceiptPdf`, `receiptRelativePath` (Task 6); `treasuryService.regenerateReceiptPdf` (Task 7); `requireAdmin`, `requireMember`, `audit`.
- Produces: `GET /api/admin/recibos/[id]` (200 PDF inline, auditado `receipt_view`; 403 sin admin; 404 si no existe); `GET /api/mi/recibos/[id]` (200 PDF solo si el pago es del socio; 403/404).

- [ ] **Step 1: Test**

`tests/receipt-routes.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  receipt: { findUnique: vi.fn() },
  readPdf: vi.fn(async () => Buffer.from("%PDF-1.4 fake")),
  regenerate: vi.fn(async () => new Uint8Array([0x25, 0x50, 0x44, 0x46])),
  audit: vi.fn(async () => {}),
  admin: vi.fn(async () => ({ ok: true, actorId: 9 })),
  member: vi.fn(async () => ({ ok: true, userId: 3, memberId: 144, fullName: "Ana" })),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { receipt: mocks.receipt } }));
vi.mock("@/lib/treasury/receipts-dir", () => ({
  readReceiptPdf: mocks.readPdf, receiptRelativePath: (n: string) => `${n.slice(0, 4)}/${n}.pdf`,
}));
vi.mock("@/lib/treasury/service", () => ({ treasuryService: { regenerateReceiptPdf: mocks.regenerate } }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: mocks.admin }));
vi.mock("@/lib/auth/require-member", () => ({ requireMember: mocks.member }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-real-ip": "1.2.3.4" }) }));

import { GET as adminGet } from "@/app/api/admin/recibos/[id]/route";
import { GET as memberGet } from "@/app/api/mi/recibos/[id]/route";

const receipt = { id: 5, number: "2026-00005", pdfPath: "2026/2026-00005.pdf", payment: { memberId: 144 } };
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  mocks.receipt.findUnique.mockReset().mockResolvedValue(receipt);
  mocks.audit.mockClear();
  mocks.readPdf.mockClear();
  mocks.regenerate.mockClear();
});

describe("GET /api/admin/recibos/[id]", () => {
  it("sirve el PDF inline, sin caché, y audita la vista", async () => {
    const res = await adminGet(new Request("http://x"), params("5"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Cache-Control")).toBe("no-store, private");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Disposition")).toContain('filename="recibo-2026-00005.pdf"');
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      action: "receipt_view", entity: "receipt", entityId: 5, userId: 9, ip: "1.2.3.4",
    }));
  });

  it("regenera el PDF si falta en disco", async () => {
    mocks.readPdf.mockRejectedValueOnce(new Error("ENOENT"));
    const res = await adminGet(new Request("http://x"), params("5"));
    expect(res.status).toBe(200);
    expect(mocks.regenerate).toHaveBeenCalledWith(5);
  });

  it("403 sin admin, sin auditar", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: false, reason: "anonymous", error: "no" });
    const res = await adminGet(new Request("http://x"), params("5"));
    expect(res.status).toBe(403);
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("404 con id inválido o inexistente", async () => {
    expect((await adminGet(new Request("http://x"), params("abc"))).status).toBe(404);
    mocks.receipt.findUnique.mockResolvedValueOnce(null);
    expect((await adminGet(new Request("http://x"), params("77"))).status).toBe(404);
  });
});

describe("GET /api/mi/recibos/[id]", () => {
  it("sirve el recibo propio sin auditar", async () => {
    const res = await memberGet(new Request("http://x"), params("5"));
    expect(res.status).toBe(200);
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("404 para un recibo de otro socio (no revela que existe)", async () => {
    mocks.member.mockResolvedValueOnce({ ok: true, userId: 3, memberId: 999, fullName: "Otro" });
    const res = await memberGet(new Request("http://x"), params("5"));
    expect(res.status).toBe(404);
  });

  it("403 sin sesión de socio", async () => {
    mocks.member.mockResolvedValueOnce({ ok: false, reason: "anonymous", error: "no" });
    expect((await memberGet(new Request("http://x"), params("5"))).status).toBe(403);
  });
});
```

- [ ] **Step 2: Ver fallar**

```bash
npx vitest run tests/receipt-routes.test.ts
```

Expected: FAIL — rutas inexistentes.

- [ ] **Step 3: Implementar `src/app/api/admin/recibos/[id]/route.ts`**

```ts
// GET del PDF de un recibo para el panel (spec §6.5). Mismo criterio que los
// documentos de solicitud: solo admin, sin caché, nosniff, y CADA vista queda
// auditada (`receipt_view`). Si el archivo falta se regenera desde la base.
import { headers } from "next/headers";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth/require-admin";
import { prisma } from "@/lib/prisma";
import { readReceiptPdf, receiptRelativePath } from "@/lib/treasury/receipts-dir";
import { treasuryService } from "@/lib/treasury/service";

export async function loadReceiptPdf(receipt: { id: number; number: string; pdfPath: string | null }): Promise<Uint8Array> {
  try {
    return await readReceiptPdf(receipt.pdfPath ?? receiptRelativePath(receipt.number));
  } catch {
    return treasuryService.regenerateReceiptPdf(receipt.id);
  }
}

export function pdfResponse(bytes: Uint8Array, number: string): Response {
  return new Response(bytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="recibo-${number}.pdf"`,
      "Cache-Control": "no-store, private",
      Vary: "Cookie",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireAdmin();
  if (!actor.ok) return new Response(actor.error, { status: 403 });

  const { id } = await params;
  const receiptId = Number(id);
  if (!Number.isInteger(receiptId) || receiptId <= 0) return new Response("No encontrado", { status: 404 });

  const receipt = await prisma.receipt.findUnique({
    where: { id: receiptId },
    select: { id: true, number: true, pdfPath: true, payment: { select: { memberId: true } } },
  });
  if (!receipt) return new Response("No encontrado", { status: 404 });

  const bytes = await loadReceiptPdf(receipt);
  const ip = (await headers()).get("x-real-ip") ?? "unknown";
  await audit({
    userId: actor.actorId, action: "receipt_view", entity: "receipt", entityId: receipt.id,
    detail: { number: receipt.number, memberId: receipt.payment.memberId }, ip,
  });
  return pdfResponse(bytes, receipt.number);
}
```

> Next.js permite exportar helpers desde un `route.ts` solo si no son handlers HTTP; `loadReceiptPdf` y `pdfResponse` son funciones normales. Si el build se queja ("route.ts only exports HTTP methods"), moverlas a `src/lib/treasury/receipt-response.ts` e importarlas desde las dos rutas.

- [ ] **Step 4: Implementar `src/app/api/mi/recibos/[id]/route.ts`**

```ts
// El socio descarga SUS recibos. Se filtra por `payment.memberId` del actor:
// un id ajeno da 404 (no se revela que existe). Sin auditoría: ve lo propio.
import { requireMember } from "@/lib/auth/require-member";
import { prisma } from "@/lib/prisma";
import { loadReceiptPdf, pdfResponse } from "@/app/api/admin/recibos/[id]/route";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireMember();
  if (!actor.ok) return new Response(actor.error, { status: 403 });

  const { id } = await params;
  const receiptId = Number(id);
  if (!Number.isInteger(receiptId) || receiptId <= 0) return new Response("No encontrado", { status: 404 });

  const receipt = await prisma.receipt.findUnique({
    where: { id: receiptId },
    select: { id: true, number: true, pdfPath: true, payment: { select: { memberId: true } } },
  });
  if (!receipt || receipt.payment.memberId !== actor.memberId) return new Response("No encontrado", { status: 404 });

  return pdfResponse(await loadReceiptPdf(receipt), receipt.number);
}
```

- [ ] **Step 5: Ver pasar**

```bash
npx vitest run tests/receipt-routes.test.ts && npx tsc --noEmit
```

Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add src/app/api/admin/recibos src/app/api/mi tests/receipt-routes.test.ts
git commit -m "feat(m4): authenticated receipt PDF routes for admin and member

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: Navegación, badges, pestañas de Tesorería, paginación y pestaña Valores

**Files:**
- Modify: `src/lib/admin/nav.ts`, `src/components/admin/admin-nav-list.tsx`, `src/lib/admin/dashboard-cards.ts`, `src/lib/admin/status-badges.ts`
- Create: `src/lib/admin/treasury-tabs.ts`, `src/components/admin/treasury-tabs.tsx`, `src/lib/admin/pagination.ts`, `src/components/admin/pagination-nav.tsx`
- Create: `src/app/admin/tesoreria/layout.tsx`, `src/app/admin/tesoreria/page.tsx`, `src/app/admin/tesoreria/valores/page.tsx`
- Test: `tests/admin-nav.test.ts`, `tests/dashboard-cards.test.ts`, `tests/status-badges.test.ts` (ampliar), `tests/pagination.test.ts`, `tests/treasury-tabs.test.ts`

**Interfaces:**
- Produces: `AdminNavIcon` suma `"wallet"`; `TREASURY_TABS: Array<{ href: string; label: string }>`; `isTreasuryTabActive(pathname, href)`; `parsePage(sp)`, `paginate(total, page, size): { page; pageCount; skip; take }`, `pageHref(basePath, params: Record<string, string | undefined>, n)`; `PaginationNav({ page, pageCount, href: (n) => string, label })`; `arrearsBadgeVariant(level: ArrearsLevel)`, `receiptBadgeVariant(voided: boolean)`, `feeStatusBadgeVariant(status: FeeStatus)`.

- [ ] **Step 1: Tests**

En `tests/admin-nav.test.ts`, el test `keeps every live section for superadmin, in stable order` pasa a esperar:

```ts
    expect(hrefs).toEqual([
      "/admin", "/admin/solicitudes", "/admin/socios", "/admin/tesoreria", "/admin/actas",
      "/admin/noticias", "/admin/actividades", "/admin/configuracion",
    ]);
```

En `tests/status-badges.test.ts` agregar:

```ts
import { arrearsBadgeVariant, feeStatusBadgeVariant, receiptBadgeVariant } from "@/lib/admin/status-badges";

describe("treasury badges", () => {
  it("la mora escala: 1 secondary, 2 default, 4 destructive", () => {
    expect(arrearsBadgeVariant(0)).toBe("outline");
    expect(arrearsBadgeVariant(1)).toBe("secondary");
    expect(arrearsBadgeVariant(2)).toBe("default");
    expect(arrearsBadgeVariant(4)).toBe("destructive");
  });
  it("recibo anulado es destructive; cuota pagada default, pendiente secondary", () => {
    expect(receiptBadgeVariant(true)).toBe("destructive");
    expect(receiptBadgeVariant(false)).toBe("default");
    expect(feeStatusBadgeVariant("paid")).toBe("default");
    expect(feeStatusBadgeVariant("pending")).toBe("secondary");
    expect(feeStatusBadgeVariant("voided")).toBe("outline");
  });
});
```

`tests/pagination.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { pageHref, paginate, parsePage } from "@/lib/admin/pagination";

describe("pagination", () => {
  it("parsePage cae a 1 con basura", () => {
    expect(parsePage({ page: "3" })).toBe(3);
    expect(parsePage({ page: "0" })).toBe(1);
    expect(parsePage({ page: ["x"] })).toBe(1);
    expect(parsePage({})).toBe(1);
  });
  it("paginate acota al final y nunca da 0 páginas", () => {
    expect(paginate(0, 5, 50)).toEqual({ page: 1, pageCount: 1, skip: 0, take: 50 });
    expect(paginate(120, 9, 50)).toEqual({ page: 3, pageCount: 3, skip: 100, take: 50 });
  });
  it("pageHref conserva los filtros y omite page=1", () => {
    expect(pageHref("/admin/tesoreria/recibos", { q: "ana", mes: undefined }, 1)).toBe("/admin/tesoreria/recibos?q=ana");
    expect(pageHref("/admin/tesoreria/recibos", {}, 2)).toBe("/admin/tesoreria/recibos?page=2");
  });
});
```

`tests/treasury-tabs.test.ts`:

```ts
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isTreasuryTabActive, TREASURY_TABS } from "@/lib/admin/treasury-tabs";

describe("TREASURY_TABS", () => {
  it("cada pestaña apunta a una ruta que existe en disco", () => {
    const root = path.resolve(import.meta.dirname, "..", "src", "app");
    for (const tab of TREASURY_TABS) {
      const file = path.join(root, ...tab.href.split("/").filter(Boolean), "page.tsx");
      expect(existsSync(file), `${tab.href} → ${file}`).toBe(true);
    }
  });
  it("marca la pestaña en su raíz y en sus subrutas", () => {
    expect(isTreasuryTabActive("/admin/tesoreria/recibos/12", "/admin/tesoreria/recibos")).toBe(true);
    expect(isTreasuryTabActive("/admin/tesoreria/deudores", "/admin/tesoreria/recibos")).toBe(false);
  });
});
```

> Este test va a fallar hasta que existan las cuatro rutas (Tasks 10–13). Se crea ahora y se deja rojo **solo** en `deudores`, `efectivo` y `recibos` hasta la tarea que las implementa; al cerrar Task 13 tiene que estar verde. Como alternativa más estricta, crear en este paso las tres `page.tsx` faltantes con un `EmptyState` "En construcción" y reemplazarlas después — elegí esto último para que `npm test` nunca quede en rojo entre commits.

- [ ] **Step 2: Ver fallar**

```bash
npx vitest run tests/admin-nav.test.ts tests/status-badges.test.ts tests/pagination.test.ts tests/treasury-tabs.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Nav, icono y tarjeta**

`src/lib/admin/nav.ts`: en el tipo `AdminNavIcon` agregar `| "wallet"`, y en el grupo Gestión, después de Socios:

```ts
      { href: "/admin/tesoreria", label: "Tesorería", icon: "wallet" },
```

`src/components/admin/admin-nav-list.tsx`: importar `Wallet` de `lucide-react` y agregar `wallet: Wallet` al mapa `ICONS`.

`src/lib/admin/dashboard-cards.ts`: la tarjeta Tesorería pasa a

```ts
      {
        title: "Tesorería",
        description: "Cuotas, deudores, efectivo y recibos.",
        href: "/admin/tesoreria",
        cta: "Abrir tesorería",
      },
```

- [ ] **Step 4: Badges en `src/lib/admin/status-badges.ts`**

```ts
import type { ApplicationStatus, FeeStatus, MemberStatus, NewsStatus } from "@/generated/prisma/client";
import type { ArrearsLevel } from "@/lib/treasury/rules";

// La mora escala con el estatuto (REG-15): desde la 2ª cuota es alerta, desde
// la 4ª habilita la cesantía.
export function arrearsBadgeVariant(level: ArrearsLevel): BadgeVariant {
  if (level === 4) return "destructive";
  if (level === 2) return "default";
  if (level === 1) return "secondary";
  return "outline";
}

export function receiptBadgeVariant(voided: boolean): BadgeVariant {
  return voided ? "destructive" : "default";
}

export function feeStatusBadgeVariant(status: FeeStatus): BadgeVariant {
  if (status === "paid") return "default";
  if (status === "pending") return "secondary";
  return "outline"; // exempt, voided
}
```

- [ ] **Step 5: Pestañas y paginación**

`src/lib/admin/treasury-tabs.ts`:

```ts
// Pestañas de Tesorería: cada una es una RUTA (deep-link, botón atrás y
// aria-current salen solos). 4B suma "sin-conciliar" y "suscripciones".
export type TreasuryTab = { href: string; label: string };

export const TREASURY_TABS: TreasuryTab[] = [
  { href: "/admin/tesoreria/deudores", label: "Deudores" },
  { href: "/admin/tesoreria/efectivo", label: "Efectivo" },
  { href: "/admin/tesoreria/recibos", label: "Recibos" },
  { href: "/admin/tesoreria/valores", label: "Valores de cuota" },
];

export const TREASURY_HOME = TREASURY_TABS[0].href;

export function isTreasuryTabActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}
```

`src/components/admin/treasury-tabs.tsx`:

```tsx
"use client";
// Barra de pestañas por URL. Links, no botones: navegan. Scroll horizontal en
// móvil, targets ≥44px, foco visible.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { isTreasuryTabActive, type TreasuryTab } from "@/lib/admin/treasury-tabs";
import { cn } from "@/lib/utils";

export function TreasuryTabs({ tabs }: { tabs: TreasuryTab[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Secciones de tesorería" className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:px-0">
      <ul className="flex min-w-max gap-1 border-b">
        {tabs.map((tab) => {
          const active = isTreasuryTabActive(pathname, tab.href);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-11 items-center border-b-2 px-3 text-sm outline-hidden transition-colors",
                  "focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "border-primary font-semibold text-foreground"
                    : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
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

`src/lib/admin/pagination.ts`:

```ts
// Paginación por querystring compartida por las listas de tesorería. El padrón
// y la bandeja conservan su implementación propia (no se tocan en esta fase).
export function parsePage(sp: Record<string, string | string[] | undefined>): number {
  const raw = Array.isArray(sp.page) ? sp.page[0] : sp.page;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

export function paginate(total: number, page: number, size: number) {
  const pageCount = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(1, page), pageCount);
  return { page: current, pageCount, skip: (current - 1) * size, take: size };
}

export function pageHref(basePath: string, params: Record<string, string | undefined>, n: number): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  if (n > 1) qs.set("page", String(n));
  const s = qs.toString();
  return s ? `${basePath}?${s}` : basePath;
}
```

`src/components/admin/pagination-nav.tsx`:

```tsx
import Link from "next/link";
import { Button } from "@/components/ui/button";

export function PaginationNav({ page, pageCount, href, label }: {
  page: number; pageCount: number; href: (n: number) => string; label: string;
}) {
  if (pageCount <= 1) return null;
  return (
    <nav className="flex items-center gap-2" aria-label={label}>
      {page > 1
        ? <Button asChild variant="outline"><Link href={href(page - 1)}>← Anterior</Link></Button>
        : <Button variant="outline" disabled>← Anterior</Button>}
      <span className="text-sm text-muted-foreground">Página {page} de {pageCount}</span>
      {page < pageCount
        ? <Button asChild variant="outline"><Link href={href(page + 1)}>Siguiente →</Link></Button>
        : <Button variant="outline" disabled>Siguiente →</Button>}
    </nav>
  );
}
```

- [ ] **Step 6: Layout, raíz y pestaña Valores**

`src/app/admin/tesoreria/layout.tsx`:

```tsx
import { PageHeader } from "@/components/admin/page-header";
import { TreasuryTabs } from "@/components/admin/treasury-tabs";
import { TREASURY_TABS } from "@/lib/admin/treasury-tabs";

// El marco de Tesorería: encabezado + pestañas por URL. La autorización NO vive
// acá (Next renderiza layout y página en paralelo): cada página llama a
// `requireAdmin()` por su cuenta.
export default function TesoreriaLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <PageHeader title="Tesorería" />
      <TreasuryTabs tabs={TREASURY_TABS} />
      {children}
    </div>
  );
}
```

`src/app/admin/tesoreria/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { TREASURY_HOME } from "@/lib/admin/treasury-tabs";

export default function TesoreriaPage() {
  redirect(TREASURY_HOME);
}
```

`src/app/admin/tesoreria/valores/page.tsx`:

```tsx
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/require-admin";
import { formatARS, formatDateAR } from "@/lib/format";
import { feeValueReader } from "@/lib/treasury/fee-values";
import { EmptyState } from "@/components/admin/empty-state";
import { FormMessage } from "@/components/admin/form-message";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const dynamic = "force-dynamic";
export const metadata = { title: "Valores de cuota — SIGeV" };

export default async function ValoresPage() {
  const actor = await requireAdmin();
  if (!actor.ok) return <FormMessage kind="error" box>{actor.error}</FormMessage>;
  const [current, history] = await Promise.all([feeValueReader.current(), feeValueReader.history()]);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Socio activo</CardTitle></CardHeader>
          <CardContent className="font-mono text-3xl tabular-nums">{current ? formatARS(current.activeAmount) : "—"}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Adherente / colaborador</CardTitle></CardHeader>
          <CardContent className="font-mono text-3xl tabular-nums">{current ? formatARS(current.sharedAmount) : "—"}</CardContent>
        </Card>
      </div>
      <p className="text-sm text-muted-foreground">
        {current ? `Vigente desde ${formatDateAR(current.validFrom)}.` : "Todavía no rige ningún valor."}{" "}
        El valor nuevo se registra desde Configuración (solo superadmin). La aplicación del valor a las
        suscripciones de Mercado Pago llega con la siguiente fase.
      </p>
      <Button asChild variant="outline"><Link href="/admin/configuracion">Ir a Configuración</Link></Button>
      {history.length === 0 ? (
        <EmptyState description="Sin historial de valores de cuota." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Rige desde</TableHead><TableHead>Activo</TableHead>
              <TableHead>Adherente / colaborador</TableHead><TableHead>Acta</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {history.map((h) => (
              <TableRow key={h.id}>
                <TableCell>{formatDateAR(h.validFrom)}</TableCell>
                <TableCell className="font-mono tabular-nums">{formatARS(h.activeAmount)}</TableCell>
                <TableCell className="font-mono tabular-nums">{formatARS(h.sharedAmount)}</TableCell>
                <TableCell>{h.minuteId ? <Link className="text-primary hover:underline" href={`/admin/actas/${h.minuteId}`}>Acta #{h.minuteId}</Link> : "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
```

Crear además tres páginas provisorias que las tareas 11–13 reemplazan, todas con este contenido (cambiando el `metadata.title`):

`src/app/admin/tesoreria/deudores/page.tsx`, `…/efectivo/page.tsx`, `…/recibos/page.tsx`:

```tsx
import { requireAdmin } from "@/lib/auth/require-admin";
import { EmptyState } from "@/components/admin/empty-state";
import { FormMessage } from "@/components/admin/form-message";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tesorería — SIGeV" };

export default async function Page() {
  const actor = await requireAdmin();
  if (!actor.ok) return <FormMessage kind="error" box>{actor.error}</FormMessage>;
  return <EmptyState description="Esta sección se habilita en la próxima tarea del plan." />;
}
```

- [ ] **Step 7: Ver pasar**

```bash
npx vitest run tests/admin-nav.test.ts tests/dashboard-cards.test.ts tests/status-badges.test.ts tests/pagination.test.ts tests/treasury-tabs.test.ts && npx tsc --noEmit
```

Expected: PASS. En `npm run dev`: la lateral muestra "Tesorería" entre Socios y Actas; `/admin/tesoreria` redirige a Deudores; las pestañas navegan y la activa lleva `aria-current="page"`; en móvil la barra scrollea horizontal.

- [ ] **Step 8: Commit**

```bash
git add src/lib/admin src/components/admin/treasury-tabs.tsx src/components/admin/pagination-nav.tsx src/components/admin/admin-nav-list.tsx src/app/admin/tesoreria tests/admin-nav.test.ts tests/status-badges.test.ts tests/pagination.test.ts tests/treasury-tabs.test.ts
git commit -m "feat(m4): treasury section with URL tabs, nav entry and fee value screen

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: Registrar pago en efectivo

**Files:**
- Create: `src/lib/treasury/member-search.ts`
- Replace: `src/app/admin/tesoreria/efectivo/page.tsx`
- Create: `src/app/admin/tesoreria/efectivo/actions.ts`, `src/app/admin/tesoreria/efectivo/cash-form.tsx`
- Test: `tests/treasury-member-search.test.ts`, `tests/cash-actions-auth.test.ts`

**Interfaces:**
- Consumes: `treasuryService.registerCashPayment`, `TreasuryError` (Task 7); `sendReceiptEmail` (Task 8); `fetchMemberAccount` (Task 5); `feeValueReader` (Task 4); `cashConceptsFor`, `CASH_CONCEPT_LABELS`, `feeAmountFor` (Task 3).
- Produces: `searchMembers(db, q): Promise<MemberHit[]>` con `type MemberHit = { id; memberNumber: number; fullName; dni: string | null; category; status }`; `registerCashPaymentAction(prev, formData)`; `CashForm` (client).

- [ ] **Step 1: Tests**

`tests/treasury-member-search.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import { memberSearchWhere, searchMembers } from "@/lib/treasury/member-search";

describe("member search", () => {
  it("busca por número exacto, nombre o DNI, solo vigentes/suspendidos del libro abierto", () => {
    const where = memberSearchWhere("144");
    expect(where.book).toEqual({ status: "open" });
    expect(where.OR).toEqual([
      { member: { status: { in: ["active", "suspended"] }, fullName: { contains: "144" } } },
      { member: { status: { in: ["active", "suspended"] }, dni: { contains: "144" } } },
      { member: { status: { in: ["active", "suspended"] } }, memberNumber: 144 },
    ]);
    expect(memberSearchWhere("ana").OR).toHaveLength(2);
  });

  it("devuelve hasta 10 resultados con número y ficha", async () => {
    const db = {
      membership: {
        findMany: vi.fn(async () => [
          { memberNumber: 144, member: { id: 1, fullName: "Skardius Ana", dni: "1", category: "active", status: "active" } },
        ]),
      },
    } as never;
    const hits = await searchMembers(db, "ana");
    expect(hits).toEqual([{ id: 1, memberNumber: 144, fullName: "Skardius Ana", dni: "1", category: "active", status: "active" }]);
  });

  it("con consulta vacía no consulta", async () => {
    const db = { membership: { findMany: vi.fn() } } as never;
    expect(await searchMembers(db, "  ")).toEqual([]);
  });
});
```

`tests/cash-actions-auth.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  register: vi.fn(),
  sendEmail: vi.fn(),
  audit: vi.fn(async () => {}),
  admin: vi.fn(async () => ({ ok: false, reason: "not_admin", error: "Necesitás permisos de administrador." })),
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/treasury/service", () => ({
  treasuryService: { registerCashPayment: mocks.register },
  TreasuryError: class extends Error {},
}));
vi.mock("@/lib/treasury/receipt-email", () => ({ sendReceiptEmail: mocks.sendEmail }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: mocks.admin }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { redirect } from "next/navigation";
import { registerCashPaymentAction } from "@/app/admin/tesoreria/efectivo/actions";

describe("registerCashPaymentAction", () => {
  it("sin admin no registra, no audita, no redirige", async () => {
    const form = new FormData();
    form.append("memberId", "1");
    form.append("concept", "fees");
    form.append("count", "2");
    const r = await registerCashPaymentAction({}, form);
    expect(r.error).toBe("Necesitás permisos de administrador.");
    expect(mocks.register).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("con admin: registra, audita sin datos personales, manda el email si se pidió y redirige al recibo", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.register.mockResolvedValueOnce({ paymentId: 3, receiptId: 7, number: "2026-00007", periods: ["2026-09", "2026-10"], amount: 12000, pdfWritten: true });
    mocks.sendEmail.mockResolvedValueOnce({ sent: true });
    const form = new FormData();
    form.append("memberId", "1");
    form.append("concept", "fees");
    form.append("count", "2");
    form.append("sendEmail", "on");
    await registerCashPaymentAction({}, form);
    expect(mocks.register).toHaveBeenCalledWith({ memberId: 1, actorId: 9, concept: "fees", count: 2, amount: undefined, note: undefined });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      action: "cash_payment_create", entity: "payment", entityId: 3,
      detail: { memberId: 1, receiptId: 7, number: "2026-00007", concept: "fees", count: 2, amount: 12000, periods: 2, emailed: "sent" },
    }));
    expect(redirect).toHaveBeenCalledWith("/admin/tesoreria/recibos/7?emitido=1&email=sent");
  });

  it("un concepto inválido se rechaza en castellano antes de tocar el servicio", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    const form = new FormData();
    form.append("memberId", "1");
    form.append("concept", "lo-que-sea");
    const r = await registerCashPaymentAction({}, form);
    expect(r.error).toBe("Elegí el concepto del pago.");
    expect(mocks.register).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Ver fallar**

```bash
npx vitest run tests/treasury-member-search.test.ts tests/cash-actions-auth.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implementar `src/lib/treasury/member-search.ts`**

```ts
// Buscador de socio para Efectivo y para la bandeja sin conciliar (4B). Solo
// vigentes y suspendidos del libro abierto: a una baja no se le cobra sin
// reingreso. Hasta 10 resultados; el operador afina la consulta.
import type { MemberCategory, MemberStatus, Prisma, PrismaClient } from "@/generated/prisma/client";

export type MemberHit = {
  id: number; memberNumber: number; fullName: string; dni: string | null;
  category: MemberCategory; status: MemberStatus;
};

const LIVE: MemberStatus[] = ["active", "suspended"];

export function memberSearchWhere(q: string): Prisma.MembershipWhereInput {
  const member: Prisma.MemberWhereInput = { status: { in: LIVE } };
  const or: Prisma.MembershipWhereInput[] = [
    { member: { ...member, fullName: { contains: q } } },
    { member: { ...member, dni: { contains: q } } },
  ];
  const n = Number(q);
  if (Number.isInteger(n) && n > 0) or.push({ member, memberNumber: n });
  return { book: { status: "open" }, OR: or };
}

export async function searchMembers(db: Pick<PrismaClient, "membership">, q: string): Promise<MemberHit[]> {
  const trimmed = q.trim();
  if (trimmed === "") return [];
  const rows = await db.membership.findMany({
    where: memberSearchWhere(trimmed),
    include: { member: { select: { id: true, fullName: true, dni: true, category: true, status: true } } },
    orderBy: { memberNumber: "asc" },
    take: 10,
  });
  return rows.map((r) => ({ memberNumber: r.memberNumber, ...r.member }));
}
```

- [ ] **Step 4: Implementar `src/app/admin/tesoreria/efectivo/actions.ts`**

```ts
"use server";
// Registrar un pago en efectivo (spec §6.2). La regla vive en el servicio; acá
// se valida la forma, se audita con ids y montos (nunca el nombre) y se redirige
// al recibo recién emitido. El email es best-effort y su resultado viaja en la
// URL para que la pantalla del recibo lo cuente.
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth/require-admin";
import { parseForm } from "@/lib/forms";
import { sendReceiptEmail } from "@/lib/treasury/receipt-email";
import { treasuryService, TreasuryError } from "@/lib/treasury/service";

type State = { error?: string };

const schema = z.object({
  memberId: z.coerce.number().int().positive(),
  concept: z.enum(["fees", "voluntary", "extraordinary"], { error: "Elegí el concepto del pago." }),
  count: z.coerce.number().int("La cantidad de cuotas tiene que ser un número entero.").positive("Indicá cuántas cuotas paga.").optional(),
  amount: z.coerce.number().positive("Ingresá el monto del aporte.").optional(),
  note: z.string().max(200, "La nota no puede superar los 200 caracteres.").optional(),
  sendEmail: z.literal("on", { error: "Valor inválido." }).optional(),
});

export async function registerCashPaymentAction(_prev: State, formData: FormData): Promise<State> {
  const actor = await requireAdmin();
  if (!actor.ok) return { error: actor.error };
  const parsed = parseForm(schema, formData);
  if (!parsed.ok) return { error: parsed.error };
  const d = parsed.data;

  let result;
  try {
    result = await treasuryService.registerCashPayment({
      memberId: d.memberId, actorId: actor.actorId, concept: d.concept, count: d.count, amount: d.amount, note: d.note,
    });
  } catch (e) {
    if (e instanceof TreasuryError) return { error: e.message };
    console.error("[treasury] registerCashPayment", e instanceof Error ? e.message : e);
    return { error: "No se pudo registrar el pago. Reintentá en un momento." };
  }

  let emailed: "sent" | "no_email" | "error" | "skipped" = "skipped";
  if (d.sendEmail === "on") {
    const r = await sendReceiptEmail(result.receiptId);
    emailed = r.sent ? "sent" : r.reason;
  }

  const ip = (await headers()).get("x-real-ip") ?? "unknown";
  await audit({
    userId: actor.actorId, action: "cash_payment_create", entity: "payment", entityId: result.paymentId,
    detail: {
      memberId: d.memberId, receiptId: result.receiptId, number: result.number, concept: d.concept,
      count: d.count ?? null, amount: result.amount, periods: result.periods.length, emailed,
    },
    ip,
  });
  redirect(`/admin/tesoreria/recibos/${result.receiptId}?emitido=1&email=${emailed}`);
}
```

> En el test se espera `count: 2, amount: undefined, note: undefined` en la llamada al servicio y `count: 2` en el detail: con `count` ausente el detail lleva `null`. Ajustar el `expect` del test si se cambia.

- [ ] **Step 5: Implementar `src/app/admin/tesoreria/efectivo/cash-form.tsx`**

```tsx
"use client";
// Formulario de efectivo. Controlado con `useSyncedForm` (React 19 resetea el
// form al terminar la action y el <select> del concepto volvería al primero).
// El total se calcula en pantalla para que el operador lo lea ANTES de
// registrar; el monto real lo calcula el servicio con el valor vigente.
import { useActionState } from "react";
import { registerCashPaymentAction } from "./actions";
import { useSyncedForm, TextField, SelectField } from "@/components/admin/synced-fields";
import { FormMessage } from "@/components/admin/form-message";
import { Button } from "@/components/ui/button";
import { formatARS } from "@/lib/format";
import { CASH_CONCEPT_LABELS } from "@/lib/treasury/labels";
import type { CashConcept } from "@/lib/treasury/rules";

export function CashForm({ memberId, concepts, feeAmount, hasEmail, pendingCount }: {
  memberId: number;
  concepts: CashConcept[];
  /** Valor vigente de la cuota para la categoría, o null si no paga cuota. */
  feeAmount: number | null;
  hasEmail: boolean;
  pendingCount: number;
}) {
  const [state, formAction, pending] = useActionState(registerCashPaymentAction, {});
  const { values, setValue, formRef, field } = useSyncedForm({
    concept: concepts[0] ?? "extraordinary",
    count: String(Math.max(1, Math.min(pendingCount, 1))),
    amount: "",
    note: "",
    sendEmail: hasEmail ? "on" : "",
  });
  const isFees = values.concept === "fees";
  const count = Number(values.count);
  const total = isFees && feeAmount !== null && Number.isInteger(count) && count > 0 ? feeAmount * count : null;

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      <input type="hidden" name="memberId" value={memberId} />
      <SelectField
        label="Concepto" field={field("concept")}
        options={concepts.map((c): [string, string] => [c, CASH_CONCEPT_LABELS[c]])}
      />
      {isFees ? (
        <TextField
          label="Cantidad de cuotas" field={field("count", (v) => v.replace(/\D/g, ""))} inputMode="numeric"
          hint={pendingCount > 0 ? `Debe ${pendingCount}. Se imputan a las más antiguas primero.` : "Está al día: se imputa al período corriente y siguientes."}
        />
      ) : (
        <TextField label="Monto ($)" field={field("amount", (v) => v.replace(/[^\d.]/g, ""))} inputMode="numeric" placeholder="2500" />
      )}
      <TextField label="Nota (opcional)" field={field("note")} maxLength={200} />
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input
          type="checkbox" name="sendEmail" value="on" className="size-4" disabled={!hasEmail}
          checked={values.sendEmail === "on"} onChange={(e) => setValue("sendEmail", e.target.checked ? "on" : "")}
        />
        {hasEmail ? "Enviar el recibo por email" : "El socio no tiene email cargado"}
      </label>
      {total !== null && (
        <p className="text-sm">
          Total a cobrar: <span className="font-mono text-lg font-semibold tabular-nums">{formatARS(total)}</span>
        </p>
      )}
      {state.error && <FormMessage kind="error" box>{state.error}</FormMessage>}
      <Button type="submit" disabled={pending}>{pending ? "Registrando…" : "Registrar y emitir recibo"}</Button>
    </form>
  );
}
```

- [ ] **Step 6: Reemplazar `src/app/admin/tesoreria/efectivo/page.tsx`**

```tsx
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/require-admin";
import { formatARS } from "@/lib/format";
import { CATEGORY_LABELS, STATUS_LABELS } from "@/lib/members/labels";
import { prisma } from "@/lib/prisma";
import { fetchMemberAccount } from "@/lib/treasury/account";
import { feeValueReader } from "@/lib/treasury/fee-values";
import { searchMembers } from "@/lib/treasury/member-search";
import { cashConceptsFor } from "@/lib/treasury/rules";
import { EmptyState } from "@/components/admin/empty-state";
import { FormMessage } from "@/components/admin/form-message";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CashForm } from "./cash-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Efectivo — SIGeV" };

export default async function EfectivoPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireAdmin();
  if (!actor.ok) return <FormMessage kind="error" box>{actor.error}</FormMessage>;
  const sp = await props.searchParams;
  const q = (Array.isArray(sp.q) ? sp.q[0] : sp.q)?.trim() ?? "";
  const socio = Number(Array.isArray(sp.socio) ? sp.socio[0] : sp.socio);
  const memberId = Number.isInteger(socio) && socio > 0 ? socio : null;

  const [hits, member, feeValue] = await Promise.all([
    memberId === null ? searchMembers(prisma, q) : Promise.resolve([]),
    memberId === null ? null : prisma.member.findUnique({
      where: { id: memberId }, include: { memberships: { include: { book: true } } },
    }),
    feeValueReader.current(),
  ]);

  if (memberId !== null && member) {
    const account = await fetchMemberAccount(prisma, member, feeValue);
    const number = member.memberships.find((m) => m.book.status === "open")?.memberNumber ?? null;
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>{member.fullName}</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>N° {number ?? "—"} · {CATEGORY_LABELS[member.category]} · {STATUS_LABELS[member.status]}</p>
            <p>
              Cuotas pendientes: <span className="font-mono tabular-nums">{account.pendingCount}</span>
              {account.debt !== null && account.pendingCount > 0 && (
                <> · deuda <span className="font-mono tabular-nums">{formatARS(account.debt)}</span> a valor vigente</>
              )}
            </p>
            {account.feeAmount !== null && <p>Valor de la cuota: <span className="font-mono tabular-nums">{formatARS(account.feeAmount)}</span></p>}
            <p className="flex gap-3">
              <Link className="text-primary hover:underline" href={`/admin/socios/${member.id}?tab=cuenta`}>Ver cuenta corriente</Link>
              <Link className="text-primary hover:underline" href="/admin/tesoreria/efectivo">Elegir otro socio</Link>
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Registrar pago en efectivo</CardTitle></CardHeader>
          <CardContent>
            {member.status === "withdrawn" ? (
              <FormMessage kind="warning" box>El socio está dado de baja: registrá primero el reingreso.</FormMessage>
            ) : (
              <CashForm
                memberId={member.id}
                concepts={cashConceptsFor(member.category)}
                feeAmount={account.feeAmount}
                hasEmail={Boolean(member.email) && member.emailStatus !== "bounced"}
                pendingCount={account.pendingCount}
              />
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <form className="flex flex-wrap items-end gap-2" method="get">
        <Input name="q" placeholder="Número, apellido o DNI" defaultValue={q} className="w-64" autoFocus />
        <Button type="submit" variant="secondary">Buscar socio</Button>
      </form>
      {q === "" ? (
        <EmptyState size="card" description="Buscá al socio que está pagando en la sede." />
      ) : hits.length === 0 ? (
        <EmptyState description="Ningún socio vigente coincide con la búsqueda." />
      ) : (
        <ul className="divide-y rounded-xl border">
          {hits.map((h) => (
            <li key={h.id}>
              <Link
                href={`/admin/tesoreria/efectivo?socio=${h.id}`}
                className="flex min-h-11 flex-wrap items-center gap-x-3 px-3 py-2 text-sm hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring outline-hidden"
              >
                <span className="font-mono tabular-nums">N° {h.memberNumber}</span>
                <span className="font-medium">{h.fullName}</span>
                <span className="text-muted-foreground">{h.dni ?? "sin DNI"} · {CATEGORY_LABELS[h.category]}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Ver pasar y probar a mano**

```bash
npx vitest run tests/treasury-member-search.test.ts tests/cash-actions-auth.test.ts && npx tsc --noEmit
```

Expected: PASS. En `npm run dev`: buscar "144" → elegir → "Cuotas × 3" muestra "Total a cobrar $ 18.000,00" → Registrar → redirige a `/admin/tesoreria/recibos/1?emitido=1&email=…` (la página del recibo llega en Task 12; hasta entonces se ve la provisoria). Probar con un adherente: el select no ofrece "Cuotas sociales".

- [ ] **Step 8: Commit**

```bash
git add src/lib/treasury/member-search.ts src/app/admin/tesoreria/efectivo tests/treasury-member-search.test.ts tests/cash-actions-auth.test.ts
git commit -m "feat(m4): cash payment screen with member search and receipt emission

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 12: Recibos — listado, detalle, reenvío y anulación

**Files:**
- Create: `src/lib/treasury/receipts-query.ts`
- Replace: `src/app/admin/tesoreria/recibos/page.tsx`
- Create: `src/app/admin/tesoreria/recibos/[id]/page.tsx`, `src/app/admin/tesoreria/recibos/[id]/actions.ts`, `src/app/admin/tesoreria/recibos/[id]/receipt-actions.tsx`
- Test: `tests/treasury-receipts-query.test.ts`, `tests/receipt-actions-auth.test.ts`

**Interfaces:**
- Produces: `parseReceiptFilters(sp): ReceiptFilters` (`{ q?; mes?: "YYYY-MM"; medio?: PaymentType; estado?: "vigentes" | "anulados" }`), `receiptsWhere(f): Prisma.ReceiptWhereInput`, `fetchReceiptsPage(db, f, page)`, `RECEIPTS_PAGE_SIZE = 50`; actions `emailReceiptAction`, `voidReceiptAction`.
- Consumes: `paginate`, `pageHref`, `parsePage`, `PaginationNav` (Task 10); `treasuryService.voidReceipt` (Task 7); `sendReceiptEmail` (Task 8); `receiptBadgeVariant` (Task 10); `PAYMENT_TYPE_LABELS`, `paymentConcept` (Task 3).

- [ ] **Step 1: Tests**

`tests/treasury-receipts-query.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseReceiptFilters, receiptsWhere } from "@/lib/treasury/receipts-query";

describe("receipt filters", () => {
  it("parsea solo valores válidos", () => {
    expect(parseReceiptFilters({ q: " ana ", mes: "2026-09", medio: "cash", estado: "anulados" }))
      .toEqual({ q: "ana", mes: "2026-09", medio: "cash", estado: "anulados" });
    expect(parseReceiptFilters({ mes: "2026-13", medio: "x", estado: "y" })).toEqual({});
  });

  it("arma el where por número de recibo, socio, mes, medio y estado", () => {
    const w = receiptsWhere({ q: "2026-00003", mes: "2026-09", medio: "cash", estado: "vigentes" });
    expect(w.voidedAt).toBeNull();
    expect(w.issuedAt).toEqual({ gte: new Date("2026-09-01T03:00:00.000Z"), lt: new Date("2026-10-01T03:00:00.000Z") });
    expect(w.payment).toMatchObject({ type: "cash" });
    expect(w.OR).toEqual([{ number: { contains: "2026-00003" } }, { payment: { member: { fullName: { contains: "2026-00003" } } } }]);
  });
});
```

`tests/receipt-actions-auth.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  voidReceipt: vi.fn(),
  sendEmail: vi.fn(),
  audit: vi.fn(async () => {}),
  admin: vi.fn(async () => ({ ok: false, reason: "not_admin", error: "Necesitás permisos de administrador." })),
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/treasury/service", () => ({ treasuryService: { voidReceipt: mocks.voidReceipt }, TreasuryError: class extends Error {} }));
vi.mock("@/lib/treasury/receipt-email", () => ({ sendReceiptEmail: mocks.sendEmail }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: mocks.admin }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { redirect } from "next/navigation";
import { emailReceiptAction, voidReceiptAction } from "@/app/admin/tesoreria/recibos/[id]/actions";

describe("receipt actions", () => {
  it("sin admin ninguna de las dos escribe", async () => {
    const form = new FormData();
    form.append("receiptId", "7");
    form.append("reason", "error");
    expect((await voidReceiptAction({}, form)).error).toBe("Necesitás permisos de administrador.");
    expect((await emailReceiptAction({}, form)).error).toBe("Necesitás permisos de administrador.");
    expect(mocks.voidReceipt).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("anular exige motivo", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    const form = new FormData();
    form.append("receiptId", "7");
    expect((await voidReceiptAction({}, form)).error).toBe("Indicá el motivo de la anulación.");
    expect(mocks.voidReceipt).not.toHaveBeenCalled();
  });

  it("anular audita y redirige", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.voidReceipt.mockResolvedValueOnce({ paymentId: 3, number: "2026-00007", periodsReverted: 2 });
    const form = new FormData();
    form.append("receiptId", "7");
    form.append("reason", "Cargado por error");
    await voidReceiptAction({}, form);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      action: "receipt_void", entity: "receipt", entityId: 7, detail: { number: "2026-00007", paymentId: 3, periodsReverted: 2 },
    }));
    expect(redirect).toHaveBeenCalledWith("/admin/tesoreria/recibos/7?anulado=1");
  });

  it("reenviar devuelve el resultado en el estado y audita", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.sendEmail.mockResolvedValueOnce({ sent: false, reason: "no_email" });
    const form = new FormData();
    form.append("receiptId", "7");
    const r = await emailReceiptAction({}, form);
    expect(r).toEqual({ error: "El socio no tiene un email válido en su ficha." });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "receipt_email", detail: { result: "no_email" } }));
  });
});
```

- [ ] **Step 2: Ver fallar**

```bash
npx vitest run tests/treasury-receipts-query.test.ts tests/receipt-actions-auth.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implementar `src/lib/treasury/receipts-query.ts`**

```ts
// Listado de recibos: filtros por querystring + paginación. Prisma inyectado.
import type { PaymentType, Prisma, PrismaClient } from "@/generated/prisma/client";
import { paginate } from "@/lib/admin/pagination";
import { isPeriod, periodMonth, periodYear, type Period } from "./periods";

export type ReceiptFilters = {
  q?: string;
  mes?: Period;
  medio?: PaymentType;
  estado?: "vigentes" | "anulados";
};

const TYPES: PaymentType[] = ["debit", "link", "cash", "voluntary", "entry", "extraordinary"];

export function parseReceiptFilters(sp: Record<string, string | string[] | undefined>): ReceiptFilters {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const f: ReceiptFilters = {};
  const q = one(sp.q)?.trim();
  if (q) f.q = q;
  const mes = one(sp.mes);
  if (mes && isPeriod(mes)) f.mes = mes;
  const medio = one(sp.medio);
  if (medio && (TYPES as string[]).includes(medio)) f.medio = medio as PaymentType;
  const estado = one(sp.estado);
  if (estado === "vigentes" || estado === "anulados") f.estado = estado;
  return f;
}

// Mes civil en hora Argentina: el 1° a las 00:00 AR es 03:00Z.
function monthBoundsAR(p: Period): { gte: Date; lt: Date } {
  const y = periodYear(p);
  const m = periodMonth(p);
  return { gte: new Date(Date.UTC(y, m - 1, 1, 3)), lt: new Date(Date.UTC(y, m, 1, 3)) };
}

export function receiptsWhere(f: ReceiptFilters): Prisma.ReceiptWhereInput {
  const where: Prisma.ReceiptWhereInput = {};
  if (f.estado === "vigentes") where.voidedAt = null;
  if (f.estado === "anulados") where.voidedAt = { not: null };
  if (f.mes) where.issuedAt = monthBoundsAR(f.mes);
  if (f.medio) where.payment = { type: f.medio };
  if (f.q) {
    where.OR = [
      { number: { contains: f.q } },
      { payment: { member: { fullName: { contains: f.q } } } },
    ];
  }
  return where;
}

export const RECEIPTS_PAGE_SIZE = 50;

export async function fetchReceiptsPage(db: Pick<PrismaClient, "receipt">, f: ReceiptFilters, page: number) {
  const where = receiptsWhere(f);
  const total = await db.receipt.count({ where });
  const p = paginate(total, page, RECEIPTS_PAGE_SIZE);
  const rows = await db.receipt.findMany({
    where,
    include: { payment: { include: { member: { select: { id: true, fullName: true } }, fees: { select: { period: true } } } } },
    orderBy: [{ year: "desc" }, { seq: "desc" }],
    skip: p.skip,
    take: p.take,
  });
  return { rows, total, page: p.page, pageCount: p.pageCount };
}
```

- [ ] **Step 4: Implementar `src/app/admin/tesoreria/recibos/[id]/actions.ts`**

```ts
"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth/require-admin";
import { parseForm } from "@/lib/forms";
import { sendReceiptEmail } from "@/lib/treasury/receipt-email";
import { treasuryService, TreasuryError } from "@/lib/treasury/service";

type State = { error?: string; sent?: boolean };

async function ip(): Promise<string> {
  return (await headers()).get("x-real-ip") ?? "unknown";
}

const voidSchema = z.object({
  receiptId: z.coerce.number().int().positive(),
  reason: z.string().min(1, "Indicá el motivo de la anulación.").max(200, "El motivo no puede superar los 200 caracteres."),
});

// Anular no borra ni renumera: el recibo queda con motivo, fecha y quién; las
// cuotas que cubría vuelven a pendientes (las futuras se borran).
export async function voidReceiptAction(_prev: State, formData: FormData): Promise<State> {
  const actor = await requireAdmin();
  if (!actor.ok) return { error: actor.error };
  const parsed = parseForm(voidSchema, formData);
  if (!parsed.ok) return { error: parsed.error };
  let result;
  try {
    result = await treasuryService.voidReceipt({ receiptId: parsed.data.receiptId, actorId: actor.actorId, reason: parsed.data.reason });
  } catch (e) {
    if (e instanceof TreasuryError) return { error: e.message };
    console.error("[treasury] voidReceipt", e instanceof Error ? e.message : e);
    return { error: "No se pudo anular el recibo. Reintentá en un momento." };
  }
  await audit({
    userId: actor.actorId, action: "receipt_void", entity: "receipt", entityId: parsed.data.receiptId,
    detail: { number: result.number, paymentId: result.paymentId, periodsReverted: result.periodsReverted }, ip: await ip(),
  });
  redirect(`/admin/tesoreria/recibos/${parsed.data.receiptId}?anulado=1`);
}

const emailSchema = z.object({ receiptId: z.coerce.number().int().positive() });

const EMAIL_ERRORS = {
  no_email: "El socio no tiene un email válido en su ficha.",
  error: "No se pudo enviar el email. Revisá la configuración de correo y reintentá.",
} as const;

export async function emailReceiptAction(_prev: State, formData: FormData): Promise<State> {
  const actor = await requireAdmin();
  if (!actor.ok) return { error: actor.error };
  const parsed = parseForm(emailSchema, formData);
  if (!parsed.ok) return { error: parsed.error };
  const r = await sendReceiptEmail(parsed.data.receiptId);
  await audit({
    userId: actor.actorId, action: "receipt_email", entity: "receipt", entityId: parsed.data.receiptId,
    detail: { result: r.sent ? "sent" : r.reason }, ip: await ip(),
  });
  if (!r.sent) return { error: EMAIL_ERRORS[r.reason] };
  return { sent: true };
}
```

- [ ] **Step 5: Implementar `src/app/admin/tesoreria/recibos/[id]/receipt-actions.tsx`**

```tsx
"use client";
import { useActionState } from "react";
import { emailReceiptAction, voidReceiptAction } from "./actions";
import { FormMessage } from "@/components/admin/form-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ReceiptActions({ receiptId, voided, hasEmail, emailedAt }: {
  receiptId: number; voided: boolean; hasEmail: boolean; emailedAt: string | null;
}) {
  const [emailState, emailAction, emailPending] = useActionState(emailReceiptAction, {});
  const [voidState, voidAction, voidPending] = useActionState(voidReceiptAction, {});
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="outline">
          <a href={`/api/admin/recibos/${receiptId}`} target="_blank" rel="noopener">Imprimir / ver PDF</a>
        </Button>
        <form action={emailAction}>
          <input type="hidden" name="receiptId" value={receiptId} />
          <Button type="submit" variant="outline" disabled={emailPending || !hasEmail || voided}>
            {emailPending ? "Enviando…" : emailedAt ? "Reenviar por email" : "Enviar por email"}
          </Button>
        </form>
      </div>
      {emailedAt && <p className="text-sm text-muted-foreground">Enviado por email el {emailedAt}.</p>}
      {!hasEmail && <p className="text-sm text-muted-foreground">El socio no tiene email cargado.</p>}
      {emailState.sent && <FormMessage kind="success" box>Recibo enviado por email.</FormMessage>}
      {emailState.error && <FormMessage kind="error" box>{emailState.error}</FormMessage>}

      {!voided && (
        // Irreversible: detrás de un <details> cerrado, como el rechazo de solicitudes.
        <details className="rounded-md border border-destructive/40 p-3">
          <summary className="cursor-pointer text-sm font-medium text-destructive">Anular este recibo</summary>
          <form action={voidAction} className="mt-3 space-y-3">
            <input type="hidden" name="receiptId" value={receiptId} />
            <div className="space-y-1">
              <Label htmlFor="reason">Motivo</Label>
              <Input id="reason" name="reason" maxLength={200} required />
            </div>
            <p className="text-xs text-muted-foreground">
              El número no se reutiliza. Las cuotas que cubría vuelven a pendientes.
            </p>
            {voidState.error && <FormMessage kind="error">{voidState.error}</FormMessage>}
            <Button type="submit" variant="destructive" disabled={voidPending}>{voidPending ? "Anulando…" : "Anular recibo"}</Button>
          </form>
        </details>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Página del recibo `src/app/admin/tesoreria/recibos/[id]/page.tsx`**

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/require-admin";
import { formatARS, formatDateAR } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { PAYMENT_TYPE_LABELS, paymentConcept } from "@/lib/treasury/labels";
import { amountInWords } from "@/lib/treasury/amount-words";
import { receiptBadgeVariant } from "@/lib/admin/status-badges";
import { FormMessage } from "@/components/admin/form-message";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ReceiptActions } from "./receipt-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Recibo — SIGeV" };

const EMAIL_NOTICE: Record<string, { kind: "success" | "warning"; text: string }> = {
  sent: { kind: "success", text: "Recibo emitido y enviado por email." },
  no_email: { kind: "warning", text: "Recibo emitido. El socio no tiene email: imprimilo." },
  error: { kind: "warning", text: "Recibo emitido, pero el email no salió. Podés reenviarlo desde acá." },
  skipped: { kind: "success", text: "Recibo emitido." },
};

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  );
}

export default async function ReciboPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireAdmin();
  if (!actor.ok) return <FormMessage kind="error" box>{actor.error}</FormMessage>;
  const { id } = await props.params;
  const sp = await props.searchParams;
  const receiptId = Number(id);
  if (!Number.isInteger(receiptId) || receiptId <= 0) notFound();

  const r = await prisma.receipt.findUnique({
    where: { id: receiptId },
    include: {
      payment: {
        include: {
          fees: { select: { period: true } },
          member: { select: { id: true, fullName: true, email: true, emailStatus: true, memberships: { include: { book: true } } } },
          registeredBy: { select: { name: true } },
        },
      },
      voidedBy: { select: { name: true } },
    },
  });
  if (!r) notFound();
  const member = r.payment.member;
  const number = member?.memberships.find((m) => m.book.status === "open")?.memberNumber;
  const emailParam = Array.isArray(sp.email) ? sp.email[0] : sp.email;
  const notice = sp.emitido === "1" ? EMAIL_NOTICE[emailParam ?? "skipped"] : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link className="text-sm text-primary hover:underline" href="/admin/tesoreria/recibos">← Recibos</Link>
        <h2 className="font-mono text-2xl tabular-nums">{r.number}</h2>
        <Badge variant={receiptBadgeVariant(Boolean(r.voidedAt))}>{r.voidedAt ? "Anulado" : "Vigente"}</Badge>
      </div>
      {notice && <FormMessage kind={notice.kind} box>{notice.text}</FormMessage>}
      {sp.anulado === "1" && <FormMessage kind="success" box>Recibo anulado.</FormMessage>}
      {r.voidedAt && (
        <FormMessage kind="warning" box>
          Anulado el {formatDateAR(r.voidedAt)}{r.voidedBy?.name ? ` por ${r.voidedBy.name}` : ""}: {r.voidReason}
        </FormMessage>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Detalle</CardTitle></CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-3">
              <Field label="Fecha" value={formatDateAR(r.issuedAt)} />
              <Field label="Socio" value={member ? `${member.fullName}${number ? ` (N° ${number})` : ""}` : "—"} />
              <Field label="Concepto" value={paymentConcept(r.payment.type, r.payment.fees.map((f) => f.period))} />
              <Field label="Medio de pago" value={PAYMENT_TYPE_LABELS[r.payment.type]} />
              <Field label="Importe" value={formatARS(Number(r.payment.amount))} />
              <Field label="Son" value={amountInWords(Number(r.payment.amount))} />
              {r.payment.note && <Field label="Nota" value={r.payment.note} />}
              {r.payment.registeredBy?.name && <Field label="Registró" value={r.payment.registeredBy.name} />}
            </dl>
            {member && (
              <p className="mt-3 text-sm">
                <Link className="text-primary hover:underline" href={`/admin/socios/${member.id}?tab=cuenta`}>Ver cuenta corriente del socio</Link>
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Acciones</CardTitle></CardHeader>
          <CardContent>
            <ReceiptActions
              receiptId={r.id}
              voided={Boolean(r.voidedAt)}
              hasEmail={Boolean(member?.email) && member?.emailStatus !== "bounced"}
              emailedAt={r.emailedAt ? formatDateAR(r.emailedAt) : null}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Listado `src/app/admin/tesoreria/recibos/page.tsx`**

```tsx
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/require-admin";
import { pageHref, parsePage } from "@/lib/admin/pagination";
import { receiptBadgeVariant } from "@/lib/admin/status-badges";
import { formatARS, formatDateAR } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { PAYMENT_TYPE_LABELS, paymentConcept } from "@/lib/treasury/labels";
import { fetchReceiptsPage, parseReceiptFilters } from "@/lib/treasury/receipts-query";
import { EmptyState } from "@/components/admin/empty-state";
import { FormMessage } from "@/components/admin/form-message";
import { PaginationNav } from "@/components/admin/pagination-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const dynamic = "force-dynamic";
export const metadata = { title: "Recibos — SIGeV" };

const BASE = "/admin/tesoreria/recibos";

export default async function RecibosPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireAdmin();
  if (!actor.ok) return <FormMessage kind="error" box>{actor.error}</FormMessage>;
  const sp = await props.searchParams;
  const filters = parseReceiptFilters(sp);
  const { rows, total, page, pageCount } = await fetchReceiptsPage(prisma, filters, parsePage(sp));
  const params = { q: filters.q, mes: filters.mes, medio: filters.medio, estado: filters.estado };
  const hasFilters = Object.values(params).some(Boolean);

  return (
    <div className="space-y-4">
      <form className="flex flex-wrap items-end gap-2" method="get">
        <Input name="q" placeholder="Número de recibo o socio" defaultValue={filters.q ?? ""} className="w-56" />
        <Input name="mes" type="month" defaultValue={filters.mes ?? ""} className="w-40" aria-label="Mes" />
        <select name="medio" defaultValue={filters.medio ?? ""} className="h-9 rounded-md border px-2 text-sm" aria-label="Medio de pago">
          <option value="">Medio (todos)</option>
          {Object.entries(PAYMENT_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select name="estado" defaultValue={filters.estado ?? ""} className="h-9 rounded-md border px-2 text-sm" aria-label="Estado">
          <option value="">Estado (todos)</option>
          <option value="vigentes">Vigentes</option>
          <option value="anulados">Anulados</option>
        </select>
        <Button type="submit" variant="secondary">Filtrar</Button>
      </form>

      {total === 0 ? (
        <EmptyState
          description={hasFilters ? "Ningún recibo coincide con el filtro." : "Todavía no se emitió ningún recibo."}
          action={hasFilters
            ? <Button asChild variant="outline"><Link href={BASE}>Limpiar filtros</Link></Button>
            : <Button asChild><Link href="/admin/tesoreria/efectivo">Registrar efectivo</Link></Button>}
        />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{total} {total === 1 ? "recibo" : "recibos"}{pageCount > 1 && ` · página ${page} de ${pageCount}`}</p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Número</TableHead><TableHead>Fecha</TableHead><TableHead>Socio</TableHead>
                <TableHead>Concepto</TableHead><TableHead>Medio</TableHead>
                <TableHead className="text-right">Importe</TableHead><TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono tabular-nums">
                    <Link className="text-primary hover:underline" href={`${BASE}/${r.id}`}>{r.number}</Link>
                  </TableCell>
                  <TableCell>{formatDateAR(r.issuedAt)}</TableCell>
                  <TableCell>{r.payment.member ? <Link className="hover:underline" href={`/admin/socios/${r.payment.member.id}?tab=cuenta`}>{r.payment.member.fullName}</Link> : "—"}</TableCell>
                  <TableCell>{paymentConcept(r.payment.type, r.payment.fees.map((f) => f.period))}</TableCell>
                  <TableCell>{PAYMENT_TYPE_LABELS[r.payment.type]}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatARS(Number(r.payment.amount))}</TableCell>
                  <TableCell><Badge variant={receiptBadgeVariant(Boolean(r.voidedAt))}>{r.voidedAt ? "Anulado" : "Vigente"}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <PaginationNav page={page} pageCount={pageCount} href={(n) => pageHref(BASE, params, n)} label="Paginación de recibos" />
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 8: Ver pasar y probar a mano**

```bash
npx vitest run tests/treasury-receipts-query.test.ts tests/receipt-actions-auth.test.ts && npx tsc --noEmit && npm test
```

Expected: todo verde. A mano: el recibo emitido en Task 11 se ve en el listado y en su detalle; "Imprimir / ver PDF" abre el PDF en otra pestaña; "Enviar por email" con un socio de la `EMAIL_ALLOWLIST` llega con el adjunto; "Anular" con motivo → badge Anulado, el PDF muestra la marca y la cuenta del socio vuelve a tener las cuotas pendientes.

- [ ] **Step 9: Commit**

```bash
git add src/lib/treasury/receipts-query.ts src/app/admin/tesoreria/recibos tests/treasury-receipts-query.test.ts tests/receipt-actions-auth.test.ts
git commit -m "feat(m4): receipts list and detail with email resend and voiding

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 13: Deudores y cesantía en lote

**Files:**
- Create: `src/lib/treasury/debtors.ts`
- Replace: `src/app/admin/tesoreria/deudores/page.tsx`
- Create: `src/app/admin/tesoreria/deudores/actions.ts`, `src/app/admin/tesoreria/deudores/arrears-form.tsx`
- Test: `tests/treasury-debtors.test.ts`, `tests/arrears-actions-auth.test.ts`

**Interfaces:**
- Produces: `type DebtorRow = { memberId; memberNumber: number | null; fullName; category; status; pendingCount; debt: number | null; level: ArrearsLevel; lastPaidAt: Date | null }`; `rankDebtors(rows): DebtorRow[]` (puro: mayor deuda primero, luego número); `fetchDebtors(db, { level?: 2 | 4; q? }, feeValue): Promise<DebtorRow[]>`; `parseDebtorFilters(sp)`; action `declareArrearsAction(prev, formData)` con `State = { error?: string; declared?: number; failures?: Array<{ memberId: number; name: string; error: string }> }`.
- Consumes: `arrearsLevel`, `debtAmount`, `ARREARS_THRESHOLD` (Task 3); `memberService.withdraw`; `minuteSelectionSchema`, `resolveMinuteId`, `createsNewMinute`, `discardUnusedMinute` (`@/lib/members/minute-form`); `MinutePicker`; `useFormResetSync`.

- [ ] **Step 1: Tests**

`tests/treasury-debtors.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import { fetchDebtors, parseDebtorFilters, rankDebtors } from "@/lib/treasury/debtors";

describe("parseDebtorFilters", () => {
  it("acepta nivel 2 o 4 y texto", () => {
    expect(parseDebtorFilters({ nivel: "4", q: " sosa " })).toEqual({ level: 4, q: "sosa" });
    expect(parseDebtorFilters({ nivel: "7" })).toEqual({});
  });
});

describe("rankDebtors", () => {
  it("ordena por cuotas adeudadas desc y luego por número", () => {
    const rows = rankDebtors([
      { memberId: 1, memberNumber: 213, fullName: "Martinez", category: "active", status: "active", pendingCount: 4, debt: 24000, level: 4, lastPaidAt: null },
      { memberId: 2, memberNumber: 144, fullName: "Skardius", category: "active", status: "active", pendingCount: 23, debt: 138000, level: 4, lastPaidAt: null },
      { memberId: 3, memberNumber: 100, fullName: "X", category: "active", status: "active", pendingCount: 4, debt: 24000, level: 4, lastPaidAt: null },
    ]);
    expect(rows.map((r) => r.memberNumber)).toEqual([144, 100, 213]);
  });
});

describe("fetchDebtors", () => {
  it("agrupa pendientes por socio vigente/suspendido y calcula deuda y nivel", async () => {
    const db = {
      fee: {
        groupBy: vi.fn(async () => [{ memberId: 1, _count: { _all: 23 } }, { memberId: 2, _count: { _all: 1 } }]),
      },
      member: {
        findMany: vi.fn(async () => [
          { id: 1, fullName: "Skardius Ana", category: "active", status: "active", memberships: [{ memberNumber: 144, book: { status: "open" } }], payments: [{ paidAt: new Date("2024-05-01T12:00:00Z") }] },
          { id: 2, fullName: "Uno", category: "collaborator", status: "suspended", memberships: [{ memberNumber: 7, book: { status: "open" } }], payments: [] },
        ]),
      },
    } as never;
    const rows = await fetchDebtors(db, {}, { activeAmount: 6000, sharedAmount: 3000 });
    expect(rows[0]).toMatchObject({ memberId: 1, memberNumber: 144, pendingCount: 23, debt: 138000, level: 4 });
    expect(rows[1]).toMatchObject({ memberId: 2, pendingCount: 1, debt: 3000, level: 1 });
  });

  it("con nivel 4 solo devuelve candidatos a cesantía", async () => {
    const db = {
      fee: { groupBy: vi.fn(async () => [{ memberId: 1, _count: { _all: 5 } }, { memberId: 2, _count: { _all: 2 } }]) },
      member: { findMany: vi.fn(async () => [
        { id: 1, fullName: "A", category: "active", status: "active", memberships: [], payments: [] },
        { id: 2, fullName: "B", category: "active", status: "active", memberships: [], payments: [] },
      ]) },
    } as never;
    const rows = await fetchDebtors(db, { level: 4 }, null);
    expect(rows.map((r) => r.memberId)).toEqual([1]);
    expect(rows[0].debt).toBeNull();
  });
});
```

`tests/arrears-actions-auth.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  withdraw: vi.fn(),
  audit: vi.fn(async () => {}),
  admin: vi.fn(async () => ({ ok: false, reason: "not_admin", error: "Necesitás permisos de administrador." })),
  prisma: {
    member: { findMany: vi.fn(async () => []) },
    fee: { count: vi.fn(async () => 5) },
    minute: { findUnique: vi.fn(async () => ({ id: 3 })), create: vi.fn(), delete: vi.fn() },
    movement: { count: vi.fn(async () => 0) },
    book: { count: vi.fn(async () => 0) },
    application: { count: vi.fn(async () => 0) },
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/members/service", () => ({ memberService: { withdraw: mocks.withdraw } }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: mocks.admin }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { redirect } from "next/navigation";
import { declareArrearsAction } from "@/app/admin/tesoreria/deudores/actions";

function form(ids: string, minuteId = "3") {
  const f = new FormData();
  f.append("ids", ids);
  f.append("minuteMode", "existing");
  f.append("minuteId", minuteId);
  return f;
}

describe("declareArrearsAction", () => {
  it("sin admin no da de baja a nadie", async () => {
    const r = await declareArrearsAction({}, form("1,2"));
    expect(r.error).toBe("Necesitás permisos de administrador.");
    expect(mocks.withdraw).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("sin selección avisa", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    expect((await declareArrearsAction({}, form(""))).error).toBe("Seleccioná al menos un socio.");
  });

  it("da de baja por mora a cada seleccionado con ≥4 pendientes, audita y redirige", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.prisma.member.findMany.mockResolvedValueOnce([
      { id: 1, fullName: "A", status: "active" }, { id: 2, fullName: "B", status: "active" },
    ]);
    mocks.prisma.fee.count.mockResolvedValueOnce(5).mockResolvedValueOnce(3);
    mocks.withdraw.mockResolvedValue({});
    await declareArrearsAction({}, form("1,2"));
    expect(mocks.withdraw).toHaveBeenCalledTimes(1);
    expect(mocks.withdraw).toHaveBeenCalledWith(expect.objectContaining({ memberId: 1, reason: "arrears", minuteId: 3, actorId: 9 }));
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "arrears_declared", entity: "member", entityId: 1, detail: { minuteId: 3, pendingCount: 5 } }));
    // El 2 no llega a 4 cuotas: queda como fallo y no se redirige (éxito parcial).
    expect(redirect).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Ver fallar**

```bash
npx vitest run tests/treasury-debtors.test.ts tests/arrears-actions-auth.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implementar `src/lib/treasury/debtors.ts`**

```ts
// Deudores: socios vigentes o suspendidos con ≥1 cuota pendiente. Prisma inyectado.
import type { MemberCategory, MemberStatus, PrismaClient } from "@/generated/prisma/client";
import { arrearsLevel, debtAmount, type ArrearsLevel, type FeeValueAmounts } from "./rules";

export type DebtorRow = {
  memberId: number;
  memberNumber: number | null;
  fullName: string;
  category: MemberCategory;
  status: MemberStatus;
  pendingCount: number;
  debt: number | null;
  level: ArrearsLevel;
  lastPaidAt: Date | null;
};

export type DebtorFilters = { level?: 2 | 4; q?: string };

export function parseDebtorFilters(sp: Record<string, string | string[] | undefined>): DebtorFilters {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const f: DebtorFilters = {};
  const nivel = one(sp.nivel);
  if (nivel === "2" || nivel === "4") f.level = Number(nivel) as 2 | 4;
  const q = one(sp.q)?.trim();
  if (q) f.q = q;
  return f;
}

export function rankDebtors(rows: DebtorRow[]): DebtorRow[] {
  return [...rows].sort((a, b) => b.pendingCount - a.pendingCount || (a.memberNumber ?? 0) - (b.memberNumber ?? 0));
}

export async function fetchDebtors(
  db: Pick<PrismaClient, "fee" | "member">,
  f: DebtorFilters,
  feeValue: FeeValueAmounts | null,
): Promise<DebtorRow[]> {
  const groups = await db.fee.groupBy({
    by: ["memberId"],
    where: { status: "pending", member: { status: { in: ["active", "suspended"] } } },
    _count: { _all: true },
  });
  const counts = new Map(groups.map((g) => [g.memberId, g._count._all]));
  const minimum = f.level ?? 1;
  const ids = [...counts.entries()].filter(([, n]) => n >= minimum).map(([id]) => id);
  if (ids.length === 0) return [];
  const members = await db.member.findMany({
    where: { id: { in: ids }, ...(f.q ? { OR: [{ fullName: { contains: f.q } }, { dni: { contains: f.q } }] } : {}) },
    include: {
      memberships: { include: { book: true } },
      payments: { where: { status: "applied" }, orderBy: { paidAt: "desc" }, take: 1, select: { paidAt: true } },
    },
  });
  return rankDebtors(members.map((m) => {
    const pendingCount = counts.get(m.id) ?? 0;
    return {
      memberId: m.id,
      memberNumber: m.memberships.find((ms) => ms.book.status === "open")?.memberNumber ?? null,
      fullName: m.fullName,
      category: m.category,
      status: m.status,
      pendingCount,
      debt: feeValue ? debtAmount(pendingCount, m.category, feeValue) : null,
      level: arrearsLevel(pendingCount),
      lastPaidAt: m.payments[0]?.paidAt ?? null,
    };
  }));
}
```

- [ ] **Step 4: Implementar `src/app/admin/tesoreria/deudores/actions.ts`**

```ts
"use server";
// Cesantía por mora en lote (REG-15). Misma mecánica que el asiento masivo de
// solicitudes: un acta para todos, una baja por socio, éxito parcial reportado
// por socio. El umbral (≥4 pendientes) se REVALIDA acá: la pantalla pudo quedar
// vieja si alguien pagó en el medio. La declaración la decide la Comisión:
// el sistema solo la asienta.
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth/require-admin";
import { prisma } from "@/lib/prisma";
import { memberService } from "@/lib/members/service";
import {
  createsNewMinute, discardUnusedMinute, minuteSelectionSchema, resolveMinuteId,
} from "@/lib/members/minute-form";
import { ARREARS_THRESHOLD } from "@/lib/treasury/rules";

type State = { error?: string; declared?: number; failures?: Array<{ memberId: number; name: string; error: string }> };

export async function declareArrearsAction(_prev: State, formData: FormData): Promise<State> {
  const actor = await requireAdmin();
  if (!actor.ok) return { error: actor.error };

  const ids = String(formData.get("ids") ?? "")
    .split(",").map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0);
  if (ids.length === 0) return { error: "Seleccioná al menos un socio." };

  const raw: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string" && v.trim() !== "") raw[k] = v.trim();
  const sel = minuteSelectionSchema.safeParse(raw);
  if (!sel.success) return { error: sel.error.issues[0]?.message ?? "Elegí un acta existente o cargá una nueva." };

  const members = await prisma.member.findMany({
    where: { id: { in: ids } }, select: { id: true, fullName: true, status: true },
  });
  if (members.length === 0) return { error: "Ninguno de los socios seleccionados existe." };

  const createdMinute = createsNewMinute(sel.data);
  let minuteId: number;
  try {
    minuteId = await resolveMinuteId(prisma, sel.data, actor.actorId);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo resolver el acta." };
  }

  const ip = (await headers()).get("x-real-ip") ?? "unknown";
  const failures: State["failures"] = [];
  let declared = 0;
  for (const m of members) {
    const pendingCount = await prisma.fee.count({ where: { memberId: m.id, status: "pending" } });
    if (pendingCount < ARREARS_THRESHOLD) {
      failures.push({ memberId: m.id, name: m.fullName, error: `Debe ${pendingCount} cuotas: la cesantía requiere ${ARREARS_THRESHOLD} (Art. 9 inc. c).` });
      continue;
    }
    try {
      await memberService.withdraw({
        memberId: m.id, reason: "arrears", minuteId, actorId: actor.actorId,
        detail: `Cesantía por mora: ${pendingCount} cuotas adeudadas (Art. 9 inc. c)`,
      });
      declared++;
      await audit({
        userId: actor.actorId, action: "arrears_declared", entity: "member", entityId: m.id,
        detail: { minuteId, pendingCount }, ip,
      });
    } catch (e) {
      failures.push({ memberId: m.id, name: m.fullName, error: e instanceof Error ? e.message : "Error inesperado." });
    }
  }

  if (declared === 0) {
    if (createdMinute) await discardUnusedMinute(prisma, minuteId);
    return { error: "No se declaró ninguna cesantía.", failures };
  }
  if (failures.length > 0) return { declared, failures };
  redirect(`/admin/tesoreria/deudores?declaradas=${declared}`);
}
```

- [ ] **Step 5: Implementar `src/app/admin/tesoreria/deudores/arrears-form.tsx`**

```tsx
"use client";
// Cáscara del lote de cesantía: envuelve la tabla (server) y sigue la selección
// desde el onChange del form (patrón de RecordForm en solicitudes).
import Link from "next/link";
import { useActionState, useRef, useState } from "react";
import { declareArrearsAction } from "./actions";
import { FormMessage } from "@/components/admin/form-message";
import { MinutePicker, type MinuteOption } from "@/components/admin/minute-picker";
import { useFormResetSync } from "@/components/admin/use-form-reset-sync";
import { Button } from "@/components/ui/button";

export function ArrearsForm({ minutes, selectableIds, children }: {
  minutes: MinuteOption[]; selectableIds: number[]; children: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(declareArrearsAction, {});
  const [selected, setSelected] = useState<string[]>([]);
  const formRef = useRef<HTMLFormElement>(null);
  const all = selectableIds.map(String);
  const effective = selected.filter((id) => all.includes(id));
  useFormResetSync(formRef, { ids: effective.join(",") });

  const onChange = (e: React.ChangeEvent<HTMLFormElement>) => {
    const el = e.target;
    if (!(el instanceof HTMLInputElement) || el.name !== "ids" || el.type !== "checkbox") return;
    setSelected((prev) => (el.checked ? [...new Set([...prev, el.value])] : prev.filter((v) => v !== el.value)));
  };
  const allSelected = all.length > 0 && all.every((id) => effective.includes(id));

  return (
    <form ref={formRef} action={formAction} onChange={onChange} className="space-y-4">
      <div className="flex flex-wrap items-end gap-4 rounded-md border border-destructive/40 p-3">
        <div className="min-w-64 grow">
          <MinutePicker minutes={minutes} />
        </div>
        <div className="space-y-2">
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" className="size-4" checked={allSelected} onChange={() => setSelected(allSelected ? [] : all)} />
            Seleccionar todos los candidatos
          </label>
          <Button type="submit" variant="destructive" disabled={pending || effective.length === 0}>
            {pending ? "Declarando…" : `Declarar cesantía${effective.length > 0 ? ` (${effective.length})` : ""}`}
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Solo se pueden tildar socios con 4 o más cuotas adeudadas (Art. 9 inc. c). La deuda queda congelada
        en la ficha; el reingreso exige saldarla a valor vigente.
      </p>
      {state.error && <FormMessage kind="error" box>{state.error}</FormMessage>}
      {state.declared !== undefined && state.declared > 0 && (
        <FormMessage kind="warning" box>{state.declared} {state.declared === 1 ? "cesantía declarada" : "cesantías declaradas"}. {state.failures?.length ?? 0} sin declarar:</FormMessage>
      )}
      {state.failures && state.failures.length > 0 && (
        <FormMessage kind="warning" box as="div">
          <ul className="space-y-1">
            {state.failures.map((f) => (
              <li key={f.memberId}><Link className="underline" href={`/admin/socios/${f.memberId}`}>{f.name}</Link> — {f.error}</li>
            ))}
          </ul>
        </FormMessage>
      )}
      {children}
    </form>
  );
}
```

- [ ] **Step 6: Reemplazar `src/app/admin/tesoreria/deudores/page.tsx`**

```tsx
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/require-admin";
import { arrearsBadgeVariant } from "@/lib/admin/status-badges";
import { formatARS, formatDateAR } from "@/lib/format";
import { CATEGORY_LABELS, MINUTE_TYPE_LABELS, STATUS_LABELS } from "@/lib/members/labels";
import { prisma } from "@/lib/prisma";
import { fetchDebtors, parseDebtorFilters } from "@/lib/treasury/debtors";
import { feeValueReader } from "@/lib/treasury/fee-values";
import { ARREARS_THRESHOLD } from "@/lib/treasury/rules";
import { EmptyState } from "@/components/admin/empty-state";
import { FormMessage } from "@/components/admin/form-message";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrearsForm } from "./arrears-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Deudores — SIGeV" };

const LEVEL_LABEL = { 0: "Al día", 1: "1 cuota", 2: "En mora", 4: "Cesantía posible" } as const;

export default async function DeudoresPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireAdmin();
  if (!actor.ok) return <FormMessage kind="error" box>{actor.error}</FormMessage>;
  const sp = await props.searchParams;
  const filters = parseDebtorFilters(sp);
  const [feeValue, minuteRows] = await Promise.all([
    feeValueReader.current(),
    prisma.minute.findMany({ orderBy: [{ date: "desc" }, { id: "desc" }], take: 30 }),
  ]);
  const rows = await fetchDebtors(prisma, filters, feeValue);
  const minutes = minuteRows.map((m) => ({ id: m.id, label: `${MINUTE_TYPE_LABELS[m.type]} N° ${m.number} — ${formatDateAR(m.date)}` }));
  const candidates = rows.filter((r) => r.pendingCount >= ARREARS_THRESHOLD).map((r) => r.memberId);
  const hasFilters = Boolean(filters.level || filters.q);

  const table = rows.length === 0 ? (
    <EmptyState
      description={hasFilters ? "Ningún deudor coincide con el filtro." : "No hay socios con cuotas pendientes."}
      action={hasFilters ? <Button asChild variant="outline"><Link href="/admin/tesoreria/deudores">Limpiar filtros</Link></Button> : undefined}
    />
  ) : (
    <Table>
      <TableHeader>
        <TableRow>
          {candidates.length > 0 && <TableHead><span className="sr-only">Seleccionar</span></TableHead>}
          <TableHead>N°</TableHead><TableHead>Socio</TableHead><TableHead>Categoría</TableHead>
          <TableHead className="text-right">Cuotas</TableHead><TableHead className="text-right">Deuda</TableHead>
          <TableHead>Último pago</TableHead><TableHead>Situación</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.memberId}>
            {candidates.length > 0 && (
              <TableCell>
                {r.pendingCount >= ARREARS_THRESHOLD && (
                  <label className="flex min-h-11 items-center">
                    <input type="checkbox" name="ids" value={r.memberId} className="size-4" />
                    <span className="sr-only">Seleccionar a {r.fullName}</span>
                  </label>
                )}
              </TableCell>
            )}
            <TableCell className="font-mono tabular-nums">{r.memberNumber ?? "—"}</TableCell>
            <TableCell>
              <Link className="text-primary hover:underline" href={`/admin/socios/${r.memberId}?tab=cuenta`}>{r.fullName}</Link>
              {r.status === "suspended" && <span className="ml-1 text-xs text-muted-foreground">({STATUS_LABELS.suspended})</span>}
            </TableCell>
            <TableCell>{CATEGORY_LABELS[r.category]}</TableCell>
            <TableCell className="text-right font-mono tabular-nums">{r.pendingCount}</TableCell>
            <TableCell className="text-right font-mono tabular-nums">{r.debt !== null ? formatARS(r.debt) : "—"}</TableCell>
            <TableCell>{r.lastPaidAt ? formatDateAR(r.lastPaidAt) : "—"}</TableCell>
            <TableCell><Badge variant={arrearsBadgeVariant(r.level)}>{LEVEL_LABEL[r.level]}</Badge></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  return (
    <div className="space-y-4">
      {sp.declaradas && <FormMessage kind="success" box>{sp.declaradas} {sp.declaradas === "1" ? "cesantía declarada" : "cesantías declaradas"}.</FormMessage>}
      <form className="flex flex-wrap items-end gap-2" method="get">
        <Input name="q" placeholder="Nombre o DNI" defaultValue={filters.q ?? ""} className="w-56" />
        <select name="nivel" defaultValue={filters.level ? String(filters.level) : ""} className="h-9 rounded-md border px-2 text-sm" aria-label="Situación">
          <option value="">Todos los deudores</option>
          <option value="2">En mora (2 o más)</option>
          <option value="4">Candidatos a cesantía (4 o más)</option>
        </select>
        <Button type="submit" variant="secondary">Filtrar</Button>
      </form>
      {!feeValue && <FormMessage kind="warning" box>No hay valor de cuota vigente: la deuda en pesos no se puede calcular.</FormMessage>}
      <p className="text-sm text-muted-foreground">{rows.length} {rows.length === 1 ? "socio" : "socios"} con cuotas pendientes{candidates.length > 0 && ` · ${candidates.length} con ${ARREARS_THRESHOLD} o más`}.</p>
      {candidates.length > 0 ? (
        <ArrearsForm minutes={minutes} selectableIds={candidates}>{table}</ArrearsForm>
      ) : table}
    </div>
  );
}
```

- [ ] **Step 7: Ver pasar**

```bash
npx vitest run tests/treasury-debtors.test.ts tests/arrears-actions-auth.test.ts tests/treasury-tabs.test.ts && npx tsc --noEmit
```

Expected: PASS. A mano (con la deuda importada, Task 16): aparecen los 8 vigentes con deuda; Martinez (213, 4 cuotas) es tildable; declarar su cesantía con un acta nueva → `?declaradas=1`, su ficha queda "Baja · Cesantía por mora" y desaparece de Deudores (pero su deuda sigue visible en su cuenta corriente).

- [ ] **Step 8: Commit**

```bash
git add src/lib/treasury/debtors.ts src/app/admin/tesoreria/deudores tests/treasury-debtors.test.ts tests/arrears-actions-auth.test.ts
git commit -m "feat(m4): debtors screen with batch arrears declaration (REG-15)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 14: Ficha del socio con pestañas, cuenta corriente, REG-07 y REG-16

**Files:**
- Create: `src/components/admin/member-tabs.tsx`, `src/components/admin/period-strip.tsx`, `src/components/admin/account-section.tsx`
- Modify: `src/app/admin/socios/[id]/page.tsx`, `src/app/admin/socios/[id]/[accion]/page.tsx`, `src/app/admin/socios/[id]/actions.ts`, `src/lib/members/rules.ts`, `src/lib/members/service.ts`, `src/lib/applications/eligibility.ts`, `src/app/(public)/asociate/actions.ts`
- Test: `tests/member-rules.test.ts`, `tests/application-eligibility.test.ts`, `tests/period-strip.test.ts`

**Interfaces:**
- Produces: `canChangeCategory(m, newCategory, electionsOngoing, pendingFees = 0)`; `MemberSlice` de elegibilidad reemplaza `debtAtWithdrawal` por `pendingFees: number`; `PeriodStrip({ rows: GridRow[], receiptHref?: (number: string) => string | null })`; `AccountSection({ member, account, rows, admin, receiptHref })`; `MemberTabs({ tabs: Array<{ value; label }>, panels: Record<string, ReactNode>, initial: string })`; `periodCellLabel(cell): string` (puro, para el test).
- Consumes: `fetchMemberAccount`, `buildPeriodGrid`, `countPendingFees` (Task 5); `feeValueReader` (Task 4); `currentPeriod`, `periodLabel` (Task 2); `arrearsBadgeVariant` (Task 10); `PAYMENT_TYPE_LABELS`, `paymentConcept`, `describePeriods` (Task 3).

- [ ] **Step 1: Tests de reglas**

En `tests/member-rules.test.ts` agregar:

```ts
  it("category change requires zero pending fees (REG-07, M4)", () => {
    const blocked = canChangeCategory({ status: "active", category: "adherent" }, "active", false, 3);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error).toContain("3 cuotas");
    expect(canChangeCategory({ status: "active", category: "adherent" }, "active", false, 0).ok).toBe(true);
  });
```

En `tests/application-eligibility.test.ts`: reemplazar toda ocurrencia de `debtAtWithdrawal: true` por `pendingFees: 1` y de `debtAtWithdrawal: false` por `pendingFees: 0` en los objetos `member` de los casos (el archivo usa un helper para armar el socio; ajustar ahí). Agregar:

```ts
  it("bloquea por deuda real aunque la baja no haya sido por mora", () => {
    const r = checkEligibility({
      member: { id: 1, status: "withdrawn", withdrawalReason: "resignation", pendingFees: 2, reentryBlocked: false, rejectedUntil: null },
      liveApplication: null, lastRejectionAt: null, now: new Date(),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("debt");
  });
```

`tests/period-strip.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { periodCellLabel } from "@/components/admin/period-strip";

describe("periodCellLabel", () => {
  it("nombra mes, estado y recibo para el lector de pantalla", () => {
    expect(periodCellLabel({ period: "2025-03", state: "paid", receiptNumber: "2026-00001" })).toBe("marzo 2025: pagada, recibo 2026-00001");
    expect(periodCellLabel({ period: "2025-04", state: "pending_import" })).toBe("abril 2025: pendiente (deuda importada)");
    expect(periodCellLabel({ period: "2026-12", state: "none" })).toBe("diciembre 2026: sin cuota");
  });
});
```

- [ ] **Step 2: Ver fallar**

```bash
npx vitest run tests/member-rules.test.ts tests/application-eligibility.test.ts tests/period-strip.test.ts
```

Expected: FAIL.

- [ ] **Step 3: REG-07 en `src/lib/members/rules.ts`**

Reemplazar `canChangeCategory` por:

```ts
export function canChangeCategory(
  m: { status: MemberStatus; category: MemberCategory },
  newCategory: MemberCategory,
  electionsOngoing: boolean,
  // REG-07: "requiere no tener deuda". Desde el M4 es la cuenta corriente real.
  pendingFees = 0,
): RuleResult {
  if (m.status !== "active") return { ok: false, error: "Solo un socio vigente puede cambiar de categoría." };
  if (m.category === newCategory) return { ok: false, error: "El socio ya tiene esa categoría." };
  if (electionsOngoing) {
    return { ok: false, error: "Hay elecciones en curso: los cambios de categoría están bloqueados (Art. 5° ter)." };
  }
  if (pendingFees > 0) {
    return { ok: false, error: `El socio debe ${pendingFees} ${pendingFees === 1 ? "cuota" : "cuotas"}: tiene que saldarlas antes de cambiar de categoría (Art. 5° ter).` };
  }
  return { ok: true };
}
```

En `src/lib/members/service.ts`, `changeCategory`: agregar `"fee"` al tipo `Tx` y, dentro de la transacción, antes de `canChangeCategory`:

```ts
        const pendingFees = await tx.fee.count({ where: { memberId: member.id, status: "pending" } });
        const check = canChangeCategory(member, input.newCategory, ongoing, pendingFees);
```

En `src/app/admin/socios/[id]/actions.ts`, el `guard` de `changeCategoryAction`:

```ts
      guard: async (member, data) =>
        canChangeCategory(
          member, data.newCategory as MemberCategory, await electionsOngoing(prisma),
          await prisma.fee.count({ where: { memberId: member.id, status: "pending" } }),
        ),
```

- [ ] **Step 4: Elegibilidad con deuda real — `src/lib/applications/eligibility.ts`**

Cambiar `MemberSlice` a:

```ts
type MemberSlice = Pick<Member, "id" | "status" | "withdrawalReason" | "reentryBlocked" | "rejectedUntil"> & {
  /** Cuotas pendientes en la cuenta corriente (M4). */
  pendingFees: number;
};
```

y la regla 4:

```ts
    // 4. Deuda de tesorería (REG-16): cesante por mora o cuotas pendientes en la
    //    cuenta corriente real (M4). `debtAtWithdrawal` del Libro 1 ya no se lee.
    if (member.withdrawalReason === "arrears" || member.pendingFees > 0) {
```

En `src/app/(public)/asociate/actions.ts`, donde se carga el socio por DNI para el bloqueo (alrededor de la línea 230), sumar a `select` `_count: { select: { fees: { where: { status: "pending" } } } }` y pasar a `checkEligibility` un `member` con `pendingFees: member._count.fees` (quitando `debtAtWithdrawal` del select). Correr `tests/asociate-*.test.ts` para ajustar los dobles que armaban el socio con `debtAtWithdrawal`.

- [ ] **Step 5: Cinta de períodos `src/components/admin/period-strip.tsx`**

```tsx
// La cinta de períodos (spec §6.3): una fila por año, 12 celdas. Tabla
// semántica —imprime y se lee con lector de pantalla—, no un canvas.
import Link from "next/link";
import type { GridCell, GridRow } from "@/lib/treasury/account";
import { periodLabel } from "@/lib/treasury/periods";
import { cn } from "@/lib/utils";

const MONTHS = ["E", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

const STATE_LABEL: Record<GridCell["state"], string> = {
  paid: "pagada", pending: "pendiente", pending_import: "pendiente (deuda importada)",
  exempt: "exenta", voided: "anulada", none: "sin cuota",
};

const STATE_CLASS: Record<GridCell["state"], string> = {
  paid: "bg-success text-white",
  pending: "bg-warning text-white",
  pending_import: "bg-warning/70 text-white [background-image:repeating-linear-gradient(45deg,transparent,transparent_3px,rgb(255_255_255/.35)_3px,rgb(255_255_255/.35)_5px)]",
  exempt: "bg-muted text-muted-foreground",
  voided: "bg-muted text-muted-foreground line-through",
  none: "border border-dashed border-border text-transparent",
};

export function periodCellLabel(cell: GridCell): string {
  const base = `${periodLabel(cell.period)}: ${STATE_LABEL[cell.state]}`;
  return cell.receiptNumber ? `${base}, recibo ${cell.receiptNumber}` : base;
}

export function PeriodStrip({ rows, receiptHref }: {
  rows: GridRow[];
  /** Link al recibo de una celda pagada, o null si esta vista no los ofrece. */
  receiptHref?: (receiptNumber: string) => string | null;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-1 text-xs">
        <caption className="sr-only">Cuotas por mes y año</caption>
        <thead>
          <tr>
            <th scope="col" className="sr-only">Año</th>
            {MONTHS.map((m, i) => <th key={i} scope="col" className="w-8 font-normal text-muted-foreground" aria-label={periodLabel(`2000-${String(i + 1).padStart(2, "0")}`).split(" ")[0]}>{m}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.year}>
              <th scope="row" className="pr-2 text-right font-mono font-normal tabular-nums text-muted-foreground">{row.year}</th>
              {row.cells.map((cell) => {
                const href = cell.receiptNumber && receiptHref ? receiptHref(cell.receiptNumber) : null;
                const box = (
                  <span
                    title={periodCellLabel(cell)}
                    className={cn("flex size-8 items-center justify-center rounded-sm sm:size-7", STATE_CLASS[cell.state])}
                  >
                    <span className="sr-only">{periodCellLabel(cell)}</span>
                  </span>
                );
                return (
                  <td key={cell.period} className="p-0">
                    {href ? <Link href={href} className="block rounded-sm outline-hidden focus-visible:ring-2 focus-visible:ring-ring">{box}</Link> : box}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground" aria-label="Referencias">
        <li><span className="mr-1 inline-block size-3 rounded-sm bg-success align-middle" /> pagada</li>
        <li><span className="mr-1 inline-block size-3 rounded-sm bg-warning align-middle" /> pendiente</li>
        <li><span className="mr-1 inline-block size-3 rounded-sm bg-warning/70 align-middle" /> pendiente importada del Libro 1</li>
        <li><span className="mr-1 inline-block size-3 rounded-sm border border-dashed align-middle" /> sin cuota</li>
      </ul>
    </div>
  );
}
```

- [ ] **Step 6: Sección de cuenta `src/components/admin/account-section.tsx`**

```tsx
// Resumen + cinta + libro de pagos. La misma sección sirve a la ficha del admin
// y a /mi/cuenta del socio: `admin` solo agrega los accesos a registrar efectivo.
import Link from "next/link";
import type { MemberCategory } from "@/generated/prisma/client";
import { formatARS, formatDateAR } from "@/lib/format";
import type { GridRow, MemberAccount } from "@/lib/treasury/account";
import { PAYMENT_TYPE_LABELS, paymentConcept } from "@/lib/treasury/labels";
import { periodLabel } from "@/lib/treasury/periods";
import { ACCRUING_CATEGORIES } from "@/lib/treasury/rules";
import { EmptyState } from "@/components/admin/empty-state";
import { PeriodStrip } from "@/components/admin/period-strip";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function AccountSection({ member, account, rows, admin, receiptHref }: {
  member: { id: number; category: MemberCategory };
  account: MemberAccount;
  rows: GridRow[];
  admin: boolean;
  /** Link al recibo por id. */
  receiptHref: (receiptId: number) => string;
}) {
  const accruing = ACCRUING_CATEGORIES.includes(member.category);
  const byNumber = new Map(account.payments.filter((p) => p.receipt).map((p) => [p.receipt!.number, p.receipt!.id]));
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        {account.pendingCount > 0 ? (
          <p className="text-lg">
            {admin ? "Debe" : "Debés"} <span className="font-mono font-semibold tabular-nums">{account.pendingCount} {account.pendingCount === 1 ? "cuota" : "cuotas"}</span>
            {account.debt !== null && <> · <span className="font-mono tabular-nums">{formatARS(account.debt)}</span> a valor vigente</>}
            {account.oldestPending && <span className="text-muted-foreground"> · desde {periodLabel(account.oldestPending)}</span>}
          </p>
        ) : accruing ? (
          <p className="text-lg text-success">{admin ? "Está al día." : "Estás al día."}</p>
        ) : (
          <p className="text-lg text-muted-foreground">{admin ? "La categoría no devenga cuota: el aporte es voluntario." : "Tu aporte es voluntario: no tenés cuotas pendientes."}</p>
        )}
        {account.feeAmount !== null && <p className="text-sm text-muted-foreground">Valor vigente de la cuota: <span className="font-mono tabular-nums">{formatARS(account.feeAmount)}</span></p>}
      </div>

      {(accruing || account.fees.length > 0) && <PeriodStrip rows={rows} receiptHref={(n) => { const id = byNumber.get(n); return id ? receiptHref(id) : null; }} />}

      {admin && (
        <div className="flex flex-wrap gap-2">
          <Button asChild><Link href={`/admin/tesoreria/efectivo?socio=${member.id}`}>Registrar efectivo</Link></Button>
          <Button asChild variant="outline"><Link href={`/admin/tesoreria/recibos?q=`}>Ver recibos</Link></Button>
        </div>
      )}

      <div className="space-y-2">
        <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Pagos</h3>
        {account.payments.length === 0 ? (
          <EmptyState size="card" description="Sin pagos registrados." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead><TableHead>Concepto</TableHead><TableHead>Medio</TableHead>
                <TableHead className="text-right">Importe</TableHead><TableHead>Recibo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {account.payments.map((p) => (
                <TableRow key={p.id} className={p.status !== "applied" ? "text-muted-foreground line-through" : undefined}>
                  <TableCell>{formatDateAR(p.paidAt)}</TableCell>
                  <TableCell>{paymentConcept(p.type, p.periods)}</TableCell>
                  <TableCell>{PAYMENT_TYPE_LABELS[p.type]}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatARS(p.amount)}</TableCell>
                  <TableCell className="font-mono tabular-nums">
                    {p.receipt ? <Link className="text-primary hover:underline" href={receiptHref(p.receipt.id)}>{p.receipt.number}</Link> : "—"}
                    {p.receipt?.voidedAt && <span className="ml-1 text-xs">(anulado)</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Pestañas `src/components/admin/member-tabs.tsx`**

```tsx
"use client";
// Pestañas de la ficha (Radix Tabs, variante línea) con `?tab=` en la URL para
// que "Cuenta corriente" sea enlazable desde tesorería y el botón atrás funcione.
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function MemberTabs({ tabs, panels, initial }: {
  tabs: Array<{ value: string; label: string }>;
  panels: Record<string, ReactNode>;
  initial: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const current = params.get("tab") && tabs.some((t) => t.value === params.get("tab")) ? (params.get("tab") as string) : initial;
  return (
    <Tabs
      value={current}
      onValueChange={(value) => {
        const next = new URLSearchParams(params.toString());
        if (value === initial) next.delete("tab"); else next.set("tab", value);
        const qs = next.toString();
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      }}
    >
      <TabsList variant="line" className="w-full justify-start overflow-x-auto">
        {tabs.map((t) => <TabsTrigger key={t.value} value={t.value} className="min-h-11 flex-none px-3">{t.label}</TabsTrigger>)}
      </TabsList>
      {tabs.map((t) => <TabsContent key={t.value} value={t.value} className="pt-4">{panels[t.value]}</TabsContent>)}
    </Tabs>
  );
}
```

- [ ] **Step 8: Ficha `src/app/admin/socios/[id]/page.tsx` con pestañas**

Reemplazar la grilla de 5 `Card` por las pestañas. Imports nuevos:

```tsx
import { Suspense } from "react";
import { arrearsBadgeVariant } from "@/lib/admin/status-badges";
import { buildPeriodGrid, fetchMemberAccount } from "@/lib/treasury/account";
import { feeValueReader } from "@/lib/treasury/fee-values";
import { currentPeriod } from "@/lib/treasury/periods";
import { AccountSection } from "@/components/admin/account-section";
import { MemberTabs } from "@/components/admin/member-tabs";
```

Después de cargar `member`, calcular:

```tsx
  const feeValue = await feeValueReader.current();
  const account = await fetchMemberAccount(prisma, member, feeValue);
  const receiptByPayment = new Map(account.payments.filter((p) => p.receipt).map((p) => [p.id, p.receipt!.number]));
  const grid = buildPeriodGrid(account.fees, receiptByPayment, member.joinedAt, currentPeriod());
```

En los badges del header agregar:

```tsx
          {account.pendingCount > 0 && (
            <Badge variant={arrearsBadgeVariant(account.level)}>
              Debe {account.pendingCount} {account.pendingCount === 1 ? "cuota" : "cuotas"}
            </Badge>
          )}
```

y quitar el badge `Deuda de tesorería` basado en `debtAtWithdrawal`. El cuerpo pasa a:

```tsx
      <Suspense>
        <MemberTabs
          initial="ficha"
          tabs={[
            { value: "ficha", label: "Ficha" },
            { value: "cuenta", label: "Cuenta corriente" },
            { value: "historial", label: "Historial" },
            { value: "acceso", label: "Acceso" },
          ]}
          panels={{
            ficha: (
              <Card>
                <CardHeader><CardTitle>Datos personales</CardTitle></CardHeader>
                <CardContent>{/* el <dl> de datos personales tal como está hoy */}</CardContent>
              </Card>
            ),
            cuenta: (
              <AccountSection
                member={member} account={account} rows={grid} admin
                receiptHref={(id) => `/admin/tesoreria/recibos/${id}`}
              />
            ),
            historial: (
              <div className="grid gap-4 md:grid-cols-2">
                {/* Card "Historial de movimientos" y Card "Notificaciones" tal como están hoy */}
              </div>
            ),
            acceso: (
              <Card>{/* Card "Acceso al portal" tal como está hoy */}</Card>
            ),
          }}
        />
      </Suspense>
```

(`MemberTabs` usa `useSearchParams`: Next exige el `<Suspense>` alrededor.) La Card "Documentos y cuenta corriente" desaparece.

- [ ] **Step 9: Reingreso con deuda real — `src/app/admin/socios/[id]/[accion]/page.tsx`**

`screenFor` recibe un parámetro más, `debt: { pendingCount: number; amount: number | null }`, cargado en la página con:

```tsx
  const feeValue = await feeValueReader.current();
  const pendingCount = await prisma.fee.count({ where: { memberId, status: "pending" } });
  const debt = { pendingCount, amount: feeValue ? debtAmount(pendingCount, member.category, feeValue) : null };
```

(imports: `feeValueReader` de `@/lib/treasury/fee-values`, `debtAmount` de `@/lib/treasury/rules`, `formatARS` de `@/lib/format`). En el caso `reingreso`, el `warning` pasa a:

```tsx
        warning: debt.pendingCount > 0
          ? `Debe ${debt.pendingCount} ${debt.pendingCount === 1 ? "cuota" : "cuotas"}${debt.amount !== null ? ` = ${formatARS(debt.amount)} a valor vigente` : ""} (Art. 9 inc. c, REG-16). Registrá el cobro en Efectivo antes de confirmar el reingreso; el sistema no lo bloquea porque la decisión es de la Comisión.`
          : undefined,
```

y en el caso `categoria`, `blocked` pasa a `blockedBy(canChangeCategory(member, probe, elections, debt.pendingCount))`.

- [ ] **Step 10: Ver pasar y probar**

```bash
npx vitest run tests/member-rules.test.ts tests/application-eligibility.test.ts tests/period-strip.test.ts && npx tsc --noEmit && npm test
```

Expected: verde. A mano: `/admin/socios/<id>?tab=cuenta` abre directo en la cuenta; la cinta muestra oct–dic 2024 pagadas (celdas verdes con link al recibo) tras el efectivo de Task 11; "Cambiar categoría" de un deudor muestra el bloqueo con la cantidad de cuotas; el reingreso de un cesante muestra el monto.

- [ ] **Step 11: Commit**

```bash
git add src/components/admin/member-tabs.tsx src/components/admin/period-strip.tsx src/components/admin/account-section.tsx src/app/admin/socios src/lib/members src/lib/applications/eligibility.ts "src/app/(public)/asociate/actions.ts" tests/member-rules.test.ts tests/application-eligibility.test.ts tests/period-strip.test.ts tests
git commit -m "feat(m4): member card with tabs, account strip, REG-07 and REG-16 with real debt

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 15: `/mi/cuenta` (socio, solo lectura)

**Files:**
- Create: `src/app/mi/cuenta/page.tsx`
- Modify: `src/app/mi/page.tsx`

**Interfaces:**
- Consumes: `requireMember`; `fetchMemberAccount`, `buildPeriodGrid` (Task 5); `feeValueReader` (Task 4); `AccountSection` (Task 14); ruta `/api/mi/recibos/[id]` (Task 9).

- [ ] **Step 1: Página `src/app/mi/cuenta/page.tsx`**

```tsx
import Link from "next/link";
import { requireMember } from "@/lib/auth/require-member";
import { prisma } from "@/lib/prisma";
import { buildPeriodGrid, fetchMemberAccount } from "@/lib/treasury/account";
import { feeValueReader } from "@/lib/treasury/fee-values";
import { currentPeriod } from "@/lib/treasury/periods";
import { AccountSection } from "@/components/admin/account-section";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mi cuenta — Vecinal Ciudadela" };

export default async function MiCuentaPage() {
  // La página se autoriza sola (el layout corre en paralelo y no la protege).
  const actor = await requireMember();
  if (!actor.ok) return null;
  const member = await prisma.member.findUniqueOrThrow({
    where: { id: actor.memberId }, select: { id: true, category: true, joinedAt: true },
  });
  const feeValue = await feeValueReader.current();
  const account = await fetchMemberAccount(prisma, member, feeValue);
  const receiptByPayment = new Map(account.payments.filter((p) => p.receipt).map((p) => [p.id, p.receipt!.number]));
  const grid = buildPeriodGrid(account.fees, receiptByPayment, member.joinedAt, currentPeriod());

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Link className="text-sm text-primary hover:underline" href="/mi">← Inicio</Link>
        <h1 className="text-2xl font-bold">Mi cuenta</h1>
        <p className="text-sm text-muted-foreground">Tus cuotas y tus recibos. Para pagar, acercate a la sede o esperá el débito mensual.</p>
      </div>
      <div className="rounded-xl border bg-background p-4">
        <AccountSection
          member={member} account={account} rows={grid} admin={false}
          receiptHref={(id) => `/api/mi/recibos/${id}`}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Tarjeta con enlace en `src/app/mi/page.tsx`**

Reemplazar el array `sections` y el render por:

```tsx
const sections = [
  { title: "Mis datos", description: "Tus datos personales y de contacto en el padrón." },
  { title: "Mi cuenta", description: "Estado de tus cuotas y tus recibos.", href: "/mi/cuenta" },
  { title: "Pagar", description: "Pagá tu cuota social con Mercado Pago." },
]
```

y en el `CardContent`:

```tsx
            <CardContent>
              {section.href ? (
                <Link className="inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline" href={section.href}>
                  Ver mi cuenta →
                </Link>
              ) : (
                <span className="inline-block rounded bg-muted px-2 py-1 text-xs font-medium">Próximamente</span>
              )}
            </CardContent>
```

(agregar `import Link from "next/link"`).

- [ ] **Step 3: Verificar**

```bash
npx tsc --noEmit && npm test
```

A mano, con el usuario socio de prueba vinculado a una ficha con deuda: `/mi/cuenta` muestra "Debés N cuotas ($ X)", la cinta y el botón de descarga de cada recibo (`/api/mi/recibos/<id>` devuelve el PDF; con el id de otro socio devuelve 404).

- [ ] **Step 4: Commit**

```bash
git add src/app/mi
git commit -m "feat(m4): read-only member account page

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 16: Scripts de datos — padrón definitivo (`--prune`) y deuda histórica

**Files:**
- Create: `src/lib/treasury/debt-import.ts`, `scripts/import-deuda.ts`
- Modify: `scripts/import-padron.ts`
- Test: `tests/treasury-debt-import.test.ts`

**Interfaces:**
- Produces: `type DebtRow = { memberNumber: number; dni: string; counts: Partial<Record<number, number | null>>; leftAt: Date | null }`; `planDebtImport(rows: DebtRow[]): { plans: Array<{ memberNumber: number; dni: string; periods: Period[] }>; errors: string[] }`.
- Consumes: `lastPeriodsOfYear`, `periodRange`, `addMonths`, `periodOf` (Task 2).

- [ ] **Step 1: Test del planificador**

`tests/treasury-debt-import.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { civilDateUtc } from "@/lib/dates";
import { planDebtImport } from "@/lib/treasury/debt-import";

describe("planDebtImport", () => {
  it("asigna N cuotas a los últimos N meses de cada año", () => {
    const { plans, errors } = planDebtImport([
      { memberNumber: 144, dni: "1", counts: { 2022: 0, 2023: 0, 2024: 3, 2025: 12, 2026: 8 }, leftAt: null },
    ]);
    expect(errors).toEqual([]);
    expect(plans[0].periods).toEqual([
      "2024-10", "2024-11", "2024-12",
      "2025-01", "2025-02", "2025-03", "2025-04", "2025-05", "2025-06", "2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12",
      "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08",
    ]);
  });

  it("para una baja, el año de la baja cuenta hacia atrás desde el mes de egreso", () => {
    const { plans } = planDebtImport([
      { memberNumber: 1, dni: "2", counts: { 2024: 12, 2025: 8, 2026: null }, leftAt: civilDateUtc(2025, 8, 31) },
    ]);
    expect(plans[0].periods.slice(-8)).toEqual(["2025-01", "2025-02", "2025-03", "2025-04", "2025-05", "2025-06", "2025-07", "2025-08"]);
    expect(plans[0].periods).toHaveLength(20);
  });

  it("blancos y ceros no generan cuotas; un adherente sin datos no aparece", () => {
    const { plans } = planDebtImport([{ memberNumber: 3, dni: "3", counts: { 2025: null, 2026: null }, leftAt: null }]);
    expect(plans).toEqual([]);
  });

  it("rechaza cantidades imposibles", () => {
    const { errors } = planDebtImport([{ memberNumber: 4, dni: "4", counts: { 2025: 13 }, leftAt: null }]);
    expect(errors[0]).toContain("socio 4");
    expect(errors[0]).toContain("2025");
  });
});
```

- [ ] **Step 2: Ver fallar**

```bash
npx vitest run tests/treasury-debt-import.test.ts
```

- [ ] **Step 3: Implementar `src/lib/treasury/debt-import.ts`**

```ts
// Planificador PURO del import de deuda.xlsx (spec §4.2): de "N cuotas en el
// año Y" a períodos concretos. Regla: los últimos N meses del año; para el año
// de la baja, los N meses que terminan en el mes de egreso (el Excel dice "8"
// para ene..ago 2025 en las bajas del 31/08/2025).
import { addMonths, lastPeriodsOfYear, periodOf, periodRange, periodYear, type Period } from "./periods";

export type DebtRow = {
  memberNumber: number;
  dni: string;
  counts: Partial<Record<number, number | null>>;
  leftAt: Date | null;
};

export type DebtPlan = { memberNumber: number; dni: string; periods: Period[] };

export function planDebtImport(rows: DebtRow[]): { plans: DebtPlan[]; errors: string[] } {
  const plans: DebtPlan[] = [];
  const errors: string[] = [];
  for (const row of rows) {
    const periods: Period[] = [];
    const leftPeriod = row.leftAt ? periodOf(row.leftAt) : null;
    for (const [yearKey, n] of Object.entries(row.counts)) {
      const year = Number(yearKey);
      if (n === null || n === undefined || n === 0) continue;
      if (!Number.isInteger(n) || n < 0 || n > 12) {
        errors.push(`socio ${row.memberNumber}: cuotas_deuda_${year} = ${n} no es un entero entre 0 y 12`);
        continue;
      }
      if (leftPeriod && periodYear(leftPeriod) === year) {
        periods.push(...periodRange(addMonths(leftPeriod, -(n - 1)), leftPeriod));
      } else {
        periods.push(...lastPeriodsOfYear(year, n));
      }
    }
    if (periods.length > 0) plans.push({ memberNumber: row.memberNumber, dni: row.dni, periods: periods.sort() });
  }
  return { plans, errors };
}
```

- [ ] **Step 4: Ver pasar**

```bash
npx vitest run tests/treasury-debt-import.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Script `scripts/import-deuda.ts`**

```ts
// Carga la deuda histórica de datos/deuda.xlsx como cuotas `origin = import`.
// Run: npx tsx scripts/import-deuda.ts
//
// Idempotente por socio: si ya tiene alguna cuota importada, se saltea. Aborta
// ante cualquier fila que no matchee número Y DNI con la base: esta deuda se va
// a cobrar y a notificar fehacientemente, así que no se carga sobre una ficha
// dudosa. Nunca toca cuotas `accrual`.
import "dotenv/config";

import { existsSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { prisma } from "../src/lib/prisma";
import { audit } from "../src/lib/audit";
import { excelDateToCivilUtc } from "../src/lib/dates";
import { planDebtImport, type DebtRow } from "../src/lib/treasury/debt-import";

const FILE = join(process.cwd(), "datos", "deuda.xlsx");
const LOCK = join(process.cwd(), "datos", "~$deuda.xlsx");
const SHEET = "deuda";
const YEARS = [2022, 2023, 2024, 2025, 2026] as const;
const HEADERS = ["numero_socio", "apellido_nombre", "dni", "categoria_socio", ...YEARS.map((y) => `cuotas_deuda_${y}`), "fecha_egreso"] as const;

// Totales de control medidos sobre el archivo del 21/08/2026.
const EXPECTED_ROWS = 278;
const EXPECTED_TOTAL_FEES = 3080;
const EXPECTED_DEBTORS = 119;

class DebtDataError extends Error {}

function cellValue(cell: ExcelJS.Cell): string | number | Date | null {
  const v = cell.value;
  if (v === null || v === undefined) return null;
  if (typeof v === "string" || typeof v === "number") return v;
  if (v instanceof Date) return v;
  if (typeof v === "object" && "result" in v && v.result !== undefined) return cellValue({ value: v.result } as ExcelJS.Cell);
  if (typeof v === "object" && "richText" in v) return v.richText.map((r) => r.text).join("");
  if (typeof v === "object" && "text" in v) return String(v.text);
  throw new DebtDataError(`celda ${cell.address}: tipo de valor no soportado`);
}

async function main() {
  if (existsSync(LOCK)) throw new DebtDataError("deuda.xlsx está abierto en Excel (lock ~$). Cerralo y reintentá.");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(FILE);
  const ws = wb.getWorksheet(SHEET);
  if (!ws) throw new DebtDataError(`deuda.xlsx no tiene una hoja "${SHEET}"`);

  const columns = new Map<string, number>();
  ws.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => {
    const name = String(cellValue(cell) ?? "").trim();
    if (name) columns.set(name, col);
  });
  const missing = HEADERS.filter((h) => !columns.has(h));
  if (missing.length > 0) throw new DebtDataError(`faltan columnas: ${missing.join(", ")}`);

  const rows: DebtRow[] = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const get = (name: string) => cellValue(row.getCell(columns.get(name)!));
    const numero = get("numero_socio");
    if (numero === null) return;
    if (typeof numero !== "number" || !Number.isInteger(numero) || numero <= 0) {
      throw new DebtDataError(`fila ${rowNumber}: numero_socio inválido (${JSON.stringify(numero)})`);
    }
    const dni = get("dni");
    if (dni === null) throw new DebtDataError(`fila ${rowNumber}: dni vacío`);
    const counts: DebtRow["counts"] = {};
    for (const y of YEARS) {
      const v = get(`cuotas_deuda_${y}`);
      if (v === null || v === "") counts[y] = null;
      else if (typeof v === "number") counts[y] = v;
      else throw new DebtDataError(`fila ${rowNumber}: cuotas_deuda_${y} no es numérico (${JSON.stringify(v)})`);
    }
    const egreso = get("fecha_egreso");
    rows.push({
      memberNumber: numero,
      dni: String(dni).trim(),
      counts,
      leftAt: egreso instanceof Date ? excelDateToCivilUtc(egreso) : null,
    });
  });
  if (rows.length !== EXPECTED_ROWS) console.warn(`ATENCION: ${rows.length} filas (esperado ${EXPECTED_ROWS})`);

  const { plans, errors } = planDebtImport(rows);
  if (errors.length > 0) throw new DebtDataError(errors.join("\n"));

  // Join con la base por número de socio del libro abierto Y por DNI.
  const book = await prisma.book.findFirstOrThrow({ where: { status: "open" } });
  const memberships = await prisma.membership.findMany({
    where: { bookId: book.id }, include: { member: { select: { id: true, dni: true, fullName: true } } },
  });
  const byNumber = new Map(memberships.map((m) => [m.memberNumber, m.member]));
  const mismatches: string[] = [];
  for (const r of rows) {
    const m = byNumber.get(r.memberNumber);
    if (!m) mismatches.push(`socio ${r.memberNumber}: no está en el libro ${book.number}`);
    else if ((m.dni ?? "") !== r.dni) mismatches.push(`socio ${r.memberNumber}: el DNI del Excel no coincide con el de la ficha`);
  }
  if (mismatches.length > 0) throw new DebtDataError(["El Excel no coincide con el padrón cargado:", ...mismatches].join("\n"));

  const progress = { imported: 0, skipped: 0, fees: 0 };
  for (const plan of plans) {
    const member = byNumber.get(plan.memberNumber)!;
    const already = await prisma.fee.count({ where: { memberId: member.id, origin: "import" } });
    if (already > 0) { progress.skipped++; continue; }
    await prisma.$transaction(async (tx) => {
      await tx.fee.createMany({
        data: plan.periods.map((period) => ({ memberId: member.id, period, status: "pending", origin: "import" })),
      });
    });
    progress.imported++;
    progress.fees += plan.periods.length;
  }

  const totalFees = plans.reduce((n, p) => n + p.periods.length, 0);
  const lines = [
    `Debt import — ${new Date().toISOString()}`,
    `filas: ${rows.length} | socios con deuda: ${plans.length} (esperado ${EXPECTED_DEBTORS}) | cuotas en el Excel: ${totalFees} (esperado ${EXPECTED_TOTAL_FEES})`,
    `importados: ${progress.imported} | salteados (ya tenían deuda importada): ${progress.skipped} | cuotas creadas: ${progress.fees}`,
  ];
  if (plans.length !== EXPECTED_DEBTORS || totalFees !== EXPECTED_TOTAL_FEES) lines.push("ATENCION: TOTALES DISTINTOS DE LOS ESPERADOS");
  console.log(lines.join("\n"));
  await audit({
    action: "debt_import", entity: "book", entityId: book.id,
    detail: { rows: rows.length, debtors: plans.length, totalFees, ...progress },
  });
}

main()
  .catch((err: unknown) => {
    process.exitCode = 1;
    console.error(err instanceof DebtDataError ? "IMPORT ABORTADO — ERROR DE DATOS" : "IMPORT ABORTADO — ERROR DE INFRAESTRUCTURA");
    console.error(err instanceof Error ? err.message : String(err));
  })
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 6: `scripts/import-padron.ts` — constantes y `--prune`**

Constantes (líneas 42–51):

```ts
const EXPECTED_ROWS = 278;
const EXPECTED_ACTIVE = 160;
const EXPECTED_WITHDRAWN = EXPECTED_ROWS - EXPECTED_ACTIVE;
const EXPECTED_GAPS = [
  21, 71, 72, 73, 93, 94, 95, 97, 118, 125, 132, 141, 147, 158, 199, 208, 214, 221, 222, 223, 224,
  238, 239, 245, 254, 263, 287, 288,
] as const;
```

Flags: reemplazar el parseo de argumentos por:

```ts
const UPDATE_FLAG = "--update-existing";
const PRUNE_FLAG = "--prune";
const YES_FLAG = "--yes";
const KNOWN_FLAGS = [UPDATE_FLAG, PRUNE_FLAG, YES_FLAG];
// …dentro de main():
  const args = process.argv.slice(2);
  const updateExisting = args.includes(UPDATE_FLAG);
  const prune = args.includes(PRUNE_FLAG);
  const unknownArgs = args.filter((a) => !KNOWN_FLAGS.includes(a));
  if (unknownArgs.length > 0) throw new PadronDataError(`Argumento desconocido: ${unknownArgs.join(", ")}. Flags válidos: ${KNOWN_FLAGS.join(", ")}`);
  if (prune && !args.includes(YES_FLAG)) throw new PadronDataError(`${PRUNE_FLAG} borra socios de la base: confirmá con ${YES_FLAG}`);
```

Después del loop de filas y antes de los conteos del reporte, el bloque de poda:

```ts
  // ── Poda (--prune --yes): socios del libro que ya no están en el Excel ─────
  // El padrón definitivo es el Excel (decisión del 21/08/2026). Se borra
  // físicamente, pero SOLO si el socio no tiene nada colgando que el sistema
  // haya producido (cuenta, solicitud, suscripción, pago, cuota): en ese caso
  // se aborta sin borrar a nadie y se resuelve a mano.
  const pruned: number[] = [];
  if (prune) {
    const present = new Set(mapped.map((m) => m.memberNumber));
    const stale = await prisma.membership.findMany({
      where: { bookId: book.id, memberNumber: { notIn: [...present] } },
      include: {
        member: {
          include: {
            _count: { select: { applications: true, mpSubscriptions: true, payments: true, fees: true } },
            user: { select: { id: true } },
          },
        },
      },
    });
    const blocked = stale.filter((s) => {
      const c = s.member._count;
      return s.member.user || c.applications || c.mpSubscriptions || c.payments || c.fees;
    });
    if (blocked.length > 0) {
      throw new PadronDataError(
        ["No se puede podar: estos socios tienen datos del sistema (cuenta, solicitud, suscripción, pago o cuota):",
          ...blocked.map((s) => `  socio ${s.memberNumber}`)].join("\n"),
      );
    }
    for (const s of stale) {
      await prisma.$transaction(async (tx) => {
        await tx.notification.deleteMany({ where: { memberId: s.memberId } });
        await tx.actionToken.deleteMany({ where: { memberId: s.memberId } });
        await tx.movement.deleteMany({ where: { memberId: s.memberId } });
        await tx.membership.delete({ where: { id: s.id } });
        await tx.member.delete({ where: { id: s.memberId } });
      });
      pruned.push(s.memberNumber);
    }
    if (pruned.length > 0) {
      await audit({ action: "padron_prune", entity: "book", entityId: book.id, detail: { memberNumbers: pruned } });
    }
  }
```

Y en el reporte, una línea más: `` `podados (${pruned.length}): ${pruned.join(", ") || "ninguno"}` `` y `pruned: pruned.length` en el `detail` del asiento `padron_import`. (Los números de socio no son dato personal.)

> Verificar que `Membership` tenga `id` (sí: `id Int @id`). Si `Notification`/`ActionToken` de esos 6 no existen, los `deleteMany` dan 0 y siguen.

- [ ] **Step 7: Corrida local de punta a punta**

```bash
npx tsx scripts/import-padron.ts --update-existing --prune --yes
npx tsx scripts/import-deuda.ts
```

Expected: el reporte del padrón dice `filas: 278 (esperado 278)`, `podados (6): 118, 141, 158, 239, 287, 288` (si la base local venía del padrón viejo) y sin `ATENCION`; el de deuda dice `socios con deuda: 119 (esperado 119) | cuotas en el Excel: 3080 (esperado 3080)`. Segunda corrida del de deuda: `salteados: 119`, `cuotas creadas: 0`. En `/admin/tesoreria/deudores` aparecen 8 vigentes; Skardius (144) con 23 cuotas y $ 138.000.

- [ ] **Step 8: Commit**

```bash
git add src/lib/treasury/debt-import.ts scripts/import-deuda.ts scripts/import-padron.ts tests/treasury-debt-import.test.ts
git commit -m "feat(m4): debt import from deuda.xlsx and padron prune mode

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 17: Documentación, entorno y cierre de 4A

**Files:**
- Modify: `CLAUDE.md`, `.env.example`, `docs/04-modelo-de-datos.md`, `docs/05-flujos-funcionales.md`, `docs/07-plan-de-etapas.md`, `docs/10-runbook-dominio-productivo.md` (o el que describe el despliegue), `docs/11-preparacion-mp-sandbox-turnstile.md`

- [ ] **Step 1: `.env.example`**

Después de `UPLOADS_DIR`:

```
# --- Recibos PDF (Módulo 4) ---
# Fuera del webroot; prod /var/sigev/recibos (ya lo respalda backup.sh). dev: ./recibos (gitignored)
RECEIPTS_DIR=/var/sigev/recibos
```

y corregir el comentario de `MP_ACCESS_TOKEN`: `# PRODUCTIVAS desde el 22/08/2026 (piloto real). Sandbox solo en local.`

- [ ] **Step 2: `CLAUDE.md`**

- "Datos incluidos": `padron_socios.xlsx` → "padrón definitivo (278 filas, numeración 1-306 con 28 huecos, DNIs completos, 37 emails; 160 vigentes = 36 activos + 124 adherentes)". Agregar `datos/deuda.xlsx` — "deuda a agosto 2026 en cantidad de cuotas por año; la importa `scripts/import-deuda.ts` como cuotas `origin=import`".
- "Flujo de trabajo": reemplazar "Hasta el lanzamiento, ese dominio corre con credenciales de prueba de MP" por "Desde el 22/08/2026 corre con credenciales **productivas** de MP (piloto real del socio 306) y con `EMAIL_ALLOWLIST` definida. **Nunca probar cobros en producción**: el circuito de pagos se prueba en sandbox local (docs/11 §7) y el piloto productivo es el débito mensual real."
- Variables: agregar `RECEIPTS_DIR=/var/sigev/recibos`.
- "Patrones" (sección nueva, "Patrones que estrenó el Módulo 4"): (1) **la tabla `fee_values` es la única fuente de montos**; los planes de MP son referencia. (2) **Pestañas por URL** para secciones (`src/lib/admin/treasury-tabs.ts` + `TreasuryTabs`); Radix `Tabs` solo para vistas que no navegan (`MemberTabs` con `?tab=`). (3) **Numeración sin huecos**: `nextReceiptSeq(tx, year)` solo dentro de la transacción que crea el recibo. (4) **PDF después del commit, best-effort, regenerable** (`regenerateReceiptPdf`). (5) **Un débito = una cuota; un link trae `n`; efectivo = `n × valor vigente`** (`allocate`).
- En "Panel de administración": el checklist de secciones dice que Tesorería ya está en la lateral.

- [ ] **Step 3: `docs/04-modelo-de-datos.md`**

Reemplazar las definiciones de Cuota, Pago, Recibo y ValorCuota por las de la spec §2 (sin monto en Cuota, `ReceiptSequence`, `MpUnmatchedPayment`, `CronRun`, `Notification.failed`), y la nota de `deuda_tesoreria_baja` por: "histórico del Libro 1; desde el M4 no se lee: la deuda es la cuenta corriente".

- [ ] **Step 4: `docs/05-flujos-funcionales.md` §5**

Reescribir el bloque de Tesorería con las pantallas reales: pestañas Deudores / Efectivo / Recibos / Valores (4A) y Sin conciliar / Suscripciones (4B), la ficha con pestañas y la cinta, `/mi/cuenta`.

- [ ] **Step 5: `docs/07-plan-de-etapas.md`**

En Módulo 4: marcar **4A cerrada** con fecha y commit, listar lo que queda para 4B y 4C tal como en la spec §12, y anotar en el checklist de lanzamiento: "los ids de plan de MP dejan de ser obligatorios (el wizard y el devengo usan `fee_values`)" — **ojo**: el wizard sigue leyendo el plan hasta 4B (no se tocó `startPaymentAction` en 4A); dejarlo escrito como pendiente de 4B.

- [ ] **Step 6: Runbook de despliegue (docs/10 o docs/11 Parte H)**

Agregar el procedimiento de 4A en el VPS, en orden:

```bash
cd /root/dev/ciudadela && bash deploy.sh
# RECEIPTS_DIR en .env (una vez):
grep -q '^RECEIPTS_DIR=' .env || echo 'RECEIPTS_DIR=/var/sigev/recibos' >> .env
mkdir -p /var/sigev/recibos && chmod 750 /var/sigev/recibos
pm2 restart sigev --update-env
# Padrón definitivo y deuda (UNA vez, con backup previo):
bash scripts/backup.sh
npx tsx scripts/import-padron.ts --update-existing --prune --yes
npx tsx scripts/import-deuda.ts
```

con la advertencia de revisar antes los socios 31/32 (bajas sin fecha ni motivo) y 282 (categoría) en el Excel.

- [ ] **Step 7: Verificación final**

```bash
npx tsc --noEmit && npm run lint && npm test
```

Expected: sin errores de tipos ni de lint; todos los tests en verde (≈ 88 + 16 archivos nuevos). Recorrer a mano los criterios de aceptación de 4A (spec §12): Skardius 23 cuotas / $ 138.000; efectivo de 3 cuotas emite `2026-00001` sobre oct–dic 2024 con PDF y email; anular devuelve las cuotas; 20 efectivos concurrentes numeran sin huecos (`npm run test:integration`); Deudores lista los 8 y solo ≥4 son tildables; cambio de categoría bloqueado por deuda.

- [ ] **Step 8: Commit y cierre del branch**

```bash
git add CLAUDE.md .env.example docs
git commit -m "docs(m4): phase 4A — data, screens, deploy runbook and updated counts

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

Luego seguir la skill `superpowers:finishing-a-development-branch` (merge a `main`, push lo corre Mariano, deploy con el runbook del Step 6).

---

## Self-review del plan (hecho al escribirlo)

- **Cobertura de la spec (4A)**: §2 modelo → Task 1; §3 reglas → Task 3 (+ Task 14 para REG-07/eligibilidad); §4 scripts → Task 16; §2.1 valor de cuota + configuración → Task 4; §6.1 nav → Task 10; §6.2 deudores/efectivo/recibos/valores → Tasks 13/11/12/10; §6.3 ficha con pestañas y cinta → Task 14; §6.4 `/mi/cuenta` → Task 15; §6.5 PDF y rutas → Tasks 6 y 9; §7 `receiptEmail` + adjuntos → Task 8; §9 auditoría (`cash_payment_create`, `receipt_void`, `receipt_email`, `receipt_view`, `fee_value_create`, `arrears_declared`, `padron_prune`, `debt_import`) → Tasks 4, 9, 11, 12, 13, 16; §10 tests incluida la integración de secuencia → Task 6; §11 docs → Task 17. Fuera de 4A a propósito: `Notification.failed` lo escribe el mailer recién en 4C; el wizard sigue leyendo el plan de MP hasta 4B; el listado del padrón conserva el badge histórico `debtAtWithdrawal` (se migra cuando 4B toque `fetchPadronPage`).
- **Placeholders**: ninguno; cada paso con código lo muestra. Los dos "tal como está hoy" de Task 14 Step 8 se refieren a bloques JSX existentes que se mueven sin cambios.
- **Consistencia de tipos**: `CurrentFeeValue` (Task 4) cumple `FeeValueAmounts` (Task 3) estructuralmente; `MemberAccount.level` es `ArrearsLevel`; `GridRow/GridCell` se definen en Task 5 y los consumen Tasks 14/15; `TreasuryError` la importan Tasks 11/12; `sendReceiptEmail` devuelve `ReceiptEmailResult` y Tasks 11/12 leen `sent`/`reason`; `registerCashPayment` devuelve `pdfWritten` (usado en el test de Task 7 y no en la action, a propósito).
