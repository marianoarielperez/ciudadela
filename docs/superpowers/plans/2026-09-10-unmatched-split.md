# Reparto de un pago de MP entre socios — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la bandeja Sin conciliar reparta un cobro de Mercado Pago entre hasta cinco socios, cada uno con su recibo, en una sola transacción, sin tocar las barreras de idempotencia del dinero de MP.

**Architecture:** Un `Payment` por socio; uno solo (el **portador**) lleva `mpPaymentId`, los demás apuntan al portador con `splitOfPaymentId`. El estado de la fila de la bandeja (`open | partial | matched`) se deriva del **grupo** (portador + partes) y lo escribe siempre el núcleo. `registerPaymentCore` se parte en tres funciones internas (`preparePart`, `writePaymentAndFees`, `issueReceipt`) que el cobro de siempre llama en el mismo orden de hoy y el reparto en una sola transacción con lock de fila. Spec: `docs/superpowers/specs/2026-09-10-unmatched-split-design.md`.

**Tech Stack:** Next.js 16 (App Router, server actions), Prisma 7 con `@prisma/adapter-mariadb`, MariaDB (Docker `sigev-db` en local), vitest, pdf-lib, Tailwind v4 + shadcn, lucide-react.

## Global Constraints

- **Rama:** `unmatched-split` (ya creada, con la spec commiteada). Commits en inglés, `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` al final.
- **`tests/treasury-service.test.ts`, `tests/integration/mp-apply-concurrency.test.ts` y `tests/integration/receipt-sequence.test.ts`: NO se toca ninguna aserción.** Sólo se puede extender el *fake* de base del primero (métodos nuevos que el servicio necesita), y el diff de ese archivo se audita en la Task 13.
- **`src/lib/mp/*` no se modifica**, salvo `webhook-processor.ts` línea 624 (el asiento `payment_refunded` suma `parts`). `src/lib/treasury/rules.ts`, `fee-values.ts`, `receipt-number.ts`, `unique-violation.ts`: sin cambios.
- **Tope de partes:** `MAX_SPLIT_PARTS = 5`. **Cuotas por parte:** 1..60 (`MAX_FEES_PER_PAYMENT`). **Suma de las partes = `sinAsignar` exacto a centavos.**
- **Los números de recibo se piden al FINAL de la transacción, uno por parte; el portador es el PRIMER INSERT; el PDF va DESPUÉS del commit** (REG-33).
- **Auditoría:** ids, códigos, contadores y montos. **Nunca** el email del pagador, el nombre del socio ni texto libre del operador (Ley 25.326). Del error sólo el `code`/`name`.
- **UI en es-AR** ("vos"), moneda `formatARS` (`$ 18.000,00`), fechas `formatDateAR`. Tokens de color (`text-success`, `text-warning`, `--primary`); nunca `green-500`/`amber-500` crudos. Targets ≥ 44px (`min-h-11`). `FormMessage` con `role="none"` para ayuda estática.
- **Etiqueta del tipo `link` pasa a "Mercado Pago"** en `PAYMENT_TYPE_LABELS`.
- Tests unitarios: `npm test -- <archivo>`; integración: `DATABASE_URL_TEST="mysql://sigev:sigev_dev@localhost:3306/sigev" npm run test:integration -- <archivo>` (Docker `sigev-db` prendido, base migrada). En PowerShell: `$env:DATABASE_URL_TEST="mysql://sigev:sigev_dev@localhost:3306/sigev"; npm run test:integration -- <archivo>`.
- El doble de base de cada test **honra el `where` que recibe** (lección del M6); las guardas nuevas se verifican por mutación (borrar la guarda → test en rojo → restaurar) antes de dar la tarea por cerrada.

---

## Mapa de archivos

| Archivo | Rol | Tarea |
|---|---|---|
| `prisma/schema.prisma`, `prisma/migrations/<ts>_payment_split/migration.sql` | `Payment.splitOfPaymentId` + `UnmatchedStatus.partial` | 1 |
| `src/lib/admin/unmatched-labels.ts`, `src/lib/admin/status-badges.ts`, `tests/status-badges.test.ts` | etiqueta y badge de `partial` | 1 |
| `src/lib/treasury/split-group.ts` (nuevo), `tests/treasury-split-group.test.ts` (nuevo) | aritmética pura del grupo, `loadGroup`, `sharedPaymentOf`, `parseSociosParam`, constantes | 2 |
| `src/lib/treasury/split-messages.ts` (nuevo) | `SPLIT_GUARD_MESSAGES` | 2 |
| `src/lib/treasury/service.ts` | refactor `preparePart`/`writePaymentAndFees`/`issueReceipt` | 3 |
| `src/lib/treasury/service.ts`, `src/lib/treasury/split-preview.ts` (nuevo, sólo `splitPartGuards` en esta tarea), `tests/helpers/split-fake-db.ts` (nuevo), `tests/treasury-split.test.ts` (nuevo) | `registerSplitPayment` | 4 |
| `src/lib/treasury/service.ts`, `src/lib/mp/webhook-processor.ts:624`, `tests/treasury-service.test.ts` (sólo el fake), `tests/treasury-split.test.ts` | anulación y reembolso por grupo | 5 |
| `src/lib/treasury/labels.ts`, `receipt-pdf.ts`, `receipt-email.ts`, `service.ts` (`pdfDataFor`), `src/lib/email/templates.ts`, tests de pdf/email | leyenda y etiqueta "Mercado Pago" | 6 |
| `src/lib/treasury/split-preview.ts` (token, `previewSplit`), `src/lib/treasury/ars-input.ts` (nuevo), `src/lib/treasury/member-search.ts` (`membersByEmail`), `src/app/admin/tesoreria/sin-conciliar/[id]/actions.ts`, tests | action en dos pasos | 7 |
| `src/app/admin/tesoreria/sin-conciliar/[id]/page.tsx`, `split-form.tsx` (nuevo), `resolve-form.tsx` (queda sólo Dismiss/OtherIncome) | pantalla Resolver | 8 |
| `src/app/admin/tesoreria/sin-conciliar/page.tsx`, `src/lib/admin/health.ts`, `tests/admin-health.test.ts` | lista y salud | 9 |
| `src/app/admin/tesoreria/recibos/[id]/page.tsx`, `receipt-actions.tsx` | ficha del recibo | 10 |
| `tests/integration/unmatched-split.test.ts` (nuevo), `scripts/dev/seed-unmatched.ts` (nuevo) | integración MariaDB + siembra local | 11 |
| `docs/04`, `docs/05`, `docs/06`, `docs/07`, `docs/10`, `CLAUDE.md` | documentación | 12 |
| `.superpowers/sdd/unmatched-split/verification.md` | auditoría final | 13 |

---

### Task 1: Modelo de datos — `splitOfPaymentId`, estado `partial`, etiqueta y badge

**Files:**
- Modify: `prisma/schema.prisma:783-788` (enum `UnmatchedStatus`) y `:840-866` (model `Payment`)
- Create: `prisma/migrations/<timestamp>_payment_split/migration.sql` (la genera `prisma migrate dev`)
- Modify: `src/lib/admin/unmatched-labels.ts:19-27`
- Modify: `src/lib/admin/status-badges.ts:82-87`
- Test: `tests/status-badges.test.ts:88-110`

**Interfaces:**
- Produces: `Payment.splitOfPaymentId: number | null`, relaciones `splitOf` / `splitParts`; `UnmatchedStatus` con `partial`; `UNMATCHED_STATUS_LABELS.partial === "Parcial"`; `unmatchedStatusBadgeVariant("partial") === "default"`.

- [ ] **Step 1: Escribir el test de etiqueta y badge (falla)**

En `tests/status-badges.test.ts`, reemplazar el bloque `describe("unmatchedStatusBadgeVariant", …)` (líneas 88-110) por:

```ts
describe("unmatchedStatusBadgeVariant", () => {
  // Las vidas de una fila de la bandeja se ven distintas: la que espera decisión
  // (celeste), la aplicada a un socio, la descartada y el ingreso no societario.
  // `partial` (reparto con plata sin asignar, spec 2026-09-10) comparte el RELLENO
  // de `open` a propósito: es trabajo pendiente y se lee igual desde lejos; el
  // rótulo "Parcial" es lo que la distingue de cerca.
  it("le da una variante propia a cada estado, y parcial comparte la de pendiente", () => {
    const variants = (["open", "matched", "dismissed", "other_income", "partial"] as const).map(unmatchedStatusBadgeVariant);
    expect(variants).toEqual(["default", "outline", "secondary", "success", "default"]);
    expect(new Set(variants).size).toBe(4);
  });
  it("ninguna es 'ghost': esa variante no se ve como pastilla", () => {
    // `ghost` no tiene fondo y su borde es transparente: en la columna Estado
    // se leía como texto suelto de 12 px al lado de una pastilla de verdad.
    const variants = (["open", "matched", "dismissed", "other_income", "partial"] as const).map(unmatchedStatusBadgeVariant);
    expect(variants).not.toContain("ghost");
  });
  it("cada estado tiene su etiqueta en es-AR y ninguna se repite", () => {
    const labels = Object.values(UNMATCHED_STATUS_LABELS);
    expect(labels).toHaveLength(5);
    expect(new Set(labels).size).toBe(5);
    expect(UNMATCHED_STATUS_LABELS.other_income).toBe("Ingreso no societario");
    expect(UNMATCHED_STATUS_LABELS.partial).toBe("Parcial");
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -- tests/status-badges.test.ts`
Expected: FAIL — `"partial"` no es un `UnmatchedStatus` (error de tipo) y `UNMATCHED_STATUS_LABELS.partial` es `undefined`.

- [ ] **Step 3: Editar el schema**

En `prisma/schema.prisma`, el enum (líneas 783-788) queda:

```prisma
enum UnmatchedStatus {
  open
  matched
  dismissed
  other_income
  // Reparto (spec 2026-09-10): hay plata asignada y plata sin asignar. Lo
  // escribe SIEMPRE el núcleo, derivado del grupo del cobro (portador + partes).
  partial
}
```

En `model Payment`, después de la línea `preapprovalId  String? @map("preapproval_id") @db.VarChar(64)` agregar:

```prisma
  // Reparto (spec 2026-09-10): esta parte pertenece al dinero de MP que porta
  // `splitOf` —el pago que lleva `mpPaymentId`—. Nunca las dos cosas a la vez:
  // el portador tiene `mpPaymentId` y esto en null; una parte, al revés. Lo
  // garantiza el núcleo (`writePaymentAndFees`), no la base.
  splitOfPaymentId Int?      @map("split_of_payment_id")
  splitOf          Payment?  @relation("PaymentSplit", fields: [splitOfPaymentId], references: [id], onDelete: Restrict)
  splitParts       Payment[] @relation("PaymentSplit")
```

Y entre los índices, agregar `@@index([splitOfPaymentId])` antes de `@@map("payments")`.

- [ ] **Step 4: Generar y aplicar la migración**

Run (Docker `sigev-db` prendido):

```bash
npx prisma migrate dev --name payment_split
```

Expected: crea `prisma/migrations/<ts>_payment_split/migration.sql` con exactamente estas cuatro sentencias (revisar a ojo antes de seguir):

```sql
-- AlterTable
ALTER TABLE `mp_unmatched_payments` MODIFY `status` ENUM('open', 'matched', 'dismissed', 'other_income', 'partial') NOT NULL DEFAULT 'open';

-- AlterTable
ALTER TABLE `payments` ADD COLUMN `split_of_payment_id` INTEGER NULL;

-- CreateIndex
CREATE INDEX `payments_split_of_payment_id_idx` ON `payments`(`split_of_payment_id`);

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_split_of_payment_id_fkey` FOREIGN KEY (`split_of_payment_id`) REFERENCES `payments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
```

Si Prisma generó algo más (por ejemplo un DROP), **parar y revisar el schema**: no corresponde ninguna otra sentencia.

- [ ] **Step 5: Etiqueta y badge**

`src/lib/admin/unmatched-labels.ts`, dentro de `UNMATCHED_STATUS_LABELS` después de `other_income`:

```ts
  // Reparto (spec 2026-09-10): una parte se anuló y queda plata sin asignar.
  // Es trabajo pendiente: la lista la muestra entre las Pendientes.
  partial: "Parcial",
```

`src/lib/admin/status-badges.ts`, `unmatchedStatusBadgeVariant`:

```ts
export function unmatchedStatusBadgeVariant(status: UnmatchedStatus): BadgeVariant {
  // `partial` comparte el relleno de `open`: las dos son trabajo pendiente y se
  // leen igual de lejos; el rótulo las distingue de cerca.
  if (status === "open" || status === "partial") return "default";
  if (status === "dismissed") return "secondary";
  if (status === "other_income") return "success";
  return "outline"; // matched
}
```

- [ ] **Step 6: Verificar**

Run: `npm test -- tests/status-badges.test.ts && npx tsc --noEmit`
Expected: PASS; `tsc` sin errores (las pantallas que hacen `switch`/`Record` sobre `UnmatchedStatus` ya compilan porque `UNMATCHED_STATUS_LABELS` tiene la clave nueva).

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/lib/admin/unmatched-labels.ts src/lib/admin/status-badges.ts tests/status-badges.test.ts
git commit -m "feat(treasury): Payment.splitOfPaymentId and partial inbox status (schema, migration, label, badge)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `split-group.ts` — aritmética pura del grupo, `loadGroup`, `sharedPaymentOf`, mensajes

**Files:**
- Create: `src/lib/treasury/split-group.ts`
- Create: `src/lib/treasury/split-messages.ts`
- Test: `tests/treasury-split-group.test.ts`

**Interfaces:**
- Produces:
  - `MAX_SPLIT_PARTS = 5`, `INBOX_CONCEPT_TYPE: Record<CashConcept, PaymentType>` (`fees→link`, `voluntary→voluntary`, `extraordinary→extraordinary`)
  - `cents(n: number): number`
  - `groupTotals(payments: ReadonlyArray<{ amount: number; status: PaymentStatus }>, rowAmount: number): { assigned: number; unassigned: number; status: "open" | "partial" | "matched" }`
  - `loadGroup(db: Pick<PrismaClient, "payment">, row: { mpPaymentId: string; amount: number }): Promise<LoadedGroup>` con `LoadedGroup = { holder: GroupRow | null; parts: GroupRow[]; all: GroupRow[]; totals }` y `GroupRow = { id; amount: number; status; type; mpPaymentId; splitOfPaymentId; memberId; member: { id; fullName } | null; receipt: { id; number; concept; voidedAt } | null }`
  - `sharedPaymentOf(db: Pick<PrismaClient, "payment" | "mpUnmatchedPayment">, payment: { amount: number; mpPaymentId: string | null; splitOfPaymentId: number | null; hasParts: boolean }): Promise<{ rowId: number; mpPaymentId: string; total: number; paidAt: Date } | null>`
  - `parseSociosParam(raw: string | undefined): number[]`
  - `SPLIT_GUARD_MESSAGES` (ver código).

- [ ] **Step 1: Escribir los tests (fallan)**

`tests/treasury-split-group.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import {
  cents, groupTotals, loadGroup, MAX_SPLIT_PARTS, parseSociosParam, sharedPaymentOf,
} from "@/lib/treasury/split-group";
import { SPLIT_GUARD_MESSAGES } from "@/lib/treasury/split-messages";

// El grupo de un cobro de MP —portador + partes— es UNA aritmética compartida
// por el núcleo, la pantalla y la lista (spec 2026-09-10 §4.3). Se prueba pura.
describe("groupTotals", () => {
  it("sin pagos: nada asignado, todo sin asignar, fila abierta", () => {
    expect(groupTotals([], 18000)).toEqual({ assigned: 0, unassigned: 18000, status: "open" });
  });
  it("las partes aplicadas suman lo cobrado: matched", () => {
    const t = groupTotals([{ amount: 12000, status: "applied" }, { amount: 6000, status: "applied" }], 18000);
    expect(t).toEqual({ assigned: 18000, unassigned: 0, status: "matched" });
  });
  it("una parte anulada deja el resto sin asignar: partial", () => {
    const t = groupTotals([{ amount: 12000, status: "applied" }, { amount: 6000, status: "voided" }], 18000);
    expect(t).toEqual({ assigned: 12000, unassigned: 6000, status: "partial" });
  });
  it("todo anulado o reembolsado: open", () => {
    const t = groupTotals([{ amount: 12000, status: "refunded" }, { amount: 6000, status: "voided" }], 18000);
    expect(t.status).toBe("open");
    expect(t.unassigned).toBe(18000);
  });
  it("suma en centavos, sin deriva de coma flotante", () => {
    const t = groupTotals([{ amount: 0.1, status: "applied" }, { amount: 0.2, status: "applied" }], 0.3);
    expect(t).toEqual({ assigned: 0.3, unassigned: 0, status: "matched" });
    expect(cents(0.3)).toBe(30);
  });
  it("un grupo que supera lo cobrado no da 'sin asignar' negativo", () => {
    expect(groupTotals([{ amount: 20000, status: "applied" }], 18000)).toEqual({ assigned: 20000, unassigned: 0, status: "matched" });
  });
});

function fakeDb(payments: Array<Record<string, unknown> & { id: number }>, rows: Array<Record<string, unknown>> = []) {
  return {
    payment: {
      findUnique: vi.fn(async (a: { where: { mpPaymentId?: string; id?: number } }) =>
        payments.find((p) => (a.where.mpPaymentId !== undefined ? p.mpPaymentId === a.where.mpPaymentId : p.id === a.where.id)) ?? null),
      findMany: vi.fn(async (a: { where: { splitOfPaymentId: number } }) =>
        payments.filter((p) => p.splitOfPaymentId === a.where.splitOfPaymentId)),
    },
    mpUnmatchedPayment: {
      findUnique: vi.fn(async (a: { where: { mpPaymentId: string } }) =>
        rows.find((r) => r.mpPaymentId === a.where.mpPaymentId) ?? null),
    },
  };
}

describe("loadGroup", () => {
  it("sin portador: grupo vacío y fila abierta", async () => {
    const db = fakeDb([]);
    const g = await loadGroup(db as never, { mpPaymentId: "mp-1", amount: 18000 });
    expect(g.holder).toBeNull();
    expect(g.all).toEqual([]);
    expect(g.totals.status).toBe("open");
    // Sin portador no hay partes que buscar.
    expect(db.payment.findMany).not.toHaveBeenCalled();
  });
  it("portador + partes, ordenadas por id, con Decimal convertido a número", async () => {
    const db = fakeDb([
      { id: 7, mpPaymentId: "mp-1", splitOfPaymentId: null, amount: "12000.00", status: "applied" },
      { id: 9, mpPaymentId: null, splitOfPaymentId: 7, amount: "6000.00", status: "voided" },
      { id: 8, mpPaymentId: null, splitOfPaymentId: 7, amount: "0.01", status: "applied" },
      { id: 3, mpPaymentId: "otro", splitOfPaymentId: null, amount: "1.00", status: "applied" },
    ]);
    const g = await loadGroup(db as never, { mpPaymentId: "mp-1", amount: 18000 });
    expect(g.holder?.id).toBe(7);
    expect(g.parts.map((p) => p.id)).toEqual([8, 9]);
    expect(g.all.map((p) => p.amount)).toEqual([12000, 0.01, 6000]);
    expect(g.totals).toEqual({ assigned: 12000.01, unassigned: 5999.99, status: "partial" });
  });
});

describe("sharedPaymentOf", () => {
  const row = { id: 5, mpPaymentId: "mp-1", amount: "18000.00", paidAt: new Date("2026-09-08T15:00:00Z") };
  it("un pago suelto (sin partes ni portador) no consulta nada y no lleva leyenda", async () => {
    const db = fakeDb([], [row]);
    expect(await sharedPaymentOf(db as never, { amount: 18000, mpPaymentId: "mp-1", splitOfPaymentId: null, hasParts: false })).toBeNull();
    expect(db.mpUnmatchedPayment.findUnique).not.toHaveBeenCalled();
    expect(db.payment.findUnique).not.toHaveBeenCalled();
  });
  it("el portador de un reparto lleva la leyenda con el total y la fecha de la fila", async () => {
    const db = fakeDb([], [row]);
    expect(await sharedPaymentOf(db as never, { amount: 12000, mpPaymentId: "mp-1", splitOfPaymentId: null, hasParts: true }))
      .toEqual({ rowId: 5, mpPaymentId: "mp-1", total: 18000, paidAt: row.paidAt });
  });
  it("una parte resuelve el mpPaymentId a través del portador", async () => {
    const db = fakeDb([{ id: 7, mpPaymentId: "mp-1", splitOfPaymentId: null }], [row]);
    expect(await sharedPaymentOf(db as never, { amount: 6000, mpPaymentId: null, splitOfPaymentId: 7, hasParts: false }))
      .toMatchObject({ total: 18000 });
    expect(db.payment.findUnique).toHaveBeenCalledWith({ where: { id: 7 }, select: { mpPaymentId: true } });
  });
  it("una parte que cubre el cobro entero (fila reabierta y vuelta a aplicar) no lleva leyenda", async () => {
    const db = fakeDb([{ id: 7, mpPaymentId: "mp-1", splitOfPaymentId: null }], [row]);
    expect(await sharedPaymentOf(db as never, { amount: 18000, mpPaymentId: null, splitOfPaymentId: 7, hasParts: false })).toBeNull();
  });
  it("sin fila de bandeja (un grupo que no vino de ahí) no lleva leyenda", async () => {
    const db = fakeDb([{ id: 7, mpPaymentId: "mp-1", splitOfPaymentId: null }], []);
    expect(await sharedPaymentOf(db as never, { amount: 6000, mpPaymentId: null, splitOfPaymentId: 7, hasParts: false })).toBeNull();
  });
});

describe("parseSociosParam", () => {
  it("lee enteros positivos, sin repetidos, hasta el tope", () => {
    expect(parseSociosParam("192,193")).toEqual([192, 193]);
    expect(parseSociosParam("192,192,193")).toEqual([192, 193]);
    expect(parseSociosParam("1,2,3,4,5,6,7")).toHaveLength(MAX_SPLIT_PARTS);
  });
  it("ignora basura y devuelve vacío sin parámetro", () => {
    expect(parseSociosParam(undefined)).toEqual([]);
    expect(parseSociosParam("")).toEqual([]);
    expect(parseSociosParam("abc,-1,0,7.5,9")).toEqual([9]);
  });
});

describe("SPLIT_GUARD_MESSAGES", () => {
  it("la suma se redacta con los dos importes en es-AR", () => {
    expect(SPLIT_GUARD_MESSAGES.sum(17000, 18000)).toBe("Las partes suman $ 17.000,00 y hay $ 18.000,00 sin asignar.");
  });
  it("el cesante lee cuántas pendientes tiene, o que no tiene ninguna", () => {
    expect(SPLIT_GUARD_MESSAGES.withdrawnCount(0)).toBe("El socio está dado de baja y no tiene cuotas pendientes: no hay nada que cobrarle.");
    expect(SPLIT_GUARD_MESSAGES.withdrawnCount(1)).toBe("El socio está dado de baja: tiene 1 cuota pendiente y no devenga nuevas.");
    expect(SPLIT_GUARD_MESSAGES.withdrawnCount(3)).toBe("El socio está dado de baja: tiene 3 cuotas pendientes y no devenga nuevas.");
  });
  it("el exento lee el acta y que sólo va un aporte", () => {
    const m = SPLIT_GUARD_MESSAGES.exempt({ toPeriod: "2026-12", minute: { type: "board", number: 124 } });
    expect(m).toContain("eximido de la cuota hasta diciembre 2026");
    expect(m).toContain("Sólo se le puede registrar un aporte.");
  });
  it("el tope nombra el número", () => {
    expect(SPLIT_GUARD_MESSAGES.tooManyParts).toBe("Como máximo 5 socios por pago.");
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npm test -- tests/treasury-split-group.test.ts`
Expected: FAIL — módulos inexistentes.

- [ ] **Step 3: Escribir `split-group.ts`**

```ts
// El GRUPO de un cobro de Mercado Pago (spec 2026-09-10 §4.3): el portador —el
// pago que lleva `mpPaymentId`— más las partes que apuntan a él con
// `splitOfPaymentId`. Es UNA aritmética para el núcleo, la pantalla Resolver y
// la lista de la bandeja: con una copia por lector, alcanzaba con que uno
// olvidara filtrar `status: "applied"` para que una parte anulada siguiera
// contando como plata asignada.
//
// Prisma inyectado: este módulo lo importan tests puros (sin `.env`).
import type { PaymentStatus, PaymentType, PrismaClient } from "@/generated/prisma/client";
import type { CashConcept } from "./rules";

/** Tope de socios por cobro (decisión 1 del operador, 10/09/2026). Cinco recibos
 *  en una transacción entran holgados en el timeout de 5 s de Prisma; el
 *  tiempo real se mide en `tests/integration/unmatched-split.test.ts`. */
export const MAX_SPLIT_PARTS = 5;

/** Tipo de pago por concepto DESDE LA BANDEJA: distinto del `CONCEPT_TYPE` de
 *  Efectivo (`fees → cash`). La plata entró por Mercado Pago y el recibo lo
 *  tiene que decir; `link` se rotula "Mercado Pago" (decisión 10). */
export const INBOX_CONCEPT_TYPE: Record<CashConcept, PaymentType> = {
  fees: "link", voluntary: "voluntary", extraordinary: "extraordinary",
};

/** Plata en centavos enteros: toda comparación de importes del reparto se hace
 *  acá y no en flotantes (0.1 + 0.2 no es 0.3). */
export function cents(n: number): number {
  return Math.round(n * 100);
}

export type GroupStatus = "open" | "partial" | "matched";
export type GroupTotals = { assigned: number; unassigned: number; status: GroupStatus };

/** Asignado = Σ `applied` del grupo; sin asignar = lo cobrado menos eso. El
 *  estado de la fila se DERIVA de acá y no se decide en ninguna pantalla. Un
 *  grupo que supera lo cobrado —no debería existir: el núcleo revalida la suma
 *  dentro de la transacción— cuenta como `matched` con cero sin asignar, en vez
 *  de un negativo que la lista sumaría al total. */
export function groupTotals(
  payments: ReadonlyArray<{ amount: number; status: PaymentStatus }>,
  rowAmount: number,
): GroupTotals {
  const assigned = payments.filter((p) => p.status === "applied").reduce((s, p) => s + cents(p.amount), 0);
  const total = cents(rowAmount);
  const unassigned = Math.max(0, total - assigned);
  const status: GroupStatus = assigned === 0 ? "open" : assigned >= total ? "matched" : "partial";
  return { assigned: assigned / 100, unassigned: unassigned / 100, status };
}

export const GROUP_PAYMENT_SELECT = {
  id: true, amount: true, status: true, type: true, mpPaymentId: true, splitOfPaymentId: true, memberId: true,
  member: { select: { id: true, fullName: true } },
  receipt: { select: { id: true, number: true, concept: true, voidedAt: true } },
} as const;

export type GroupRow = {
  id: number;
  amount: number;
  status: PaymentStatus;
  type: PaymentType;
  mpPaymentId: string | null;
  splitOfPaymentId: number | null;
  memberId: number | null;
  member: { id: number; fullName: string } | null;
  receipt: { id: number; number: string; concept: string; voidedAt: Date | null } | null;
};

export type LoadedGroup = { holder: GroupRow | null; parts: GroupRow[]; all: GroupRow[]; totals: GroupTotals };

type RawRow = Omit<GroupRow, "amount"> & { amount: unknown };

function toRow(r: RawRow): GroupRow {
  return { ...r, amount: Number(r.amount) };
}

/** El grupo de una fila de la bandeja, con el portador primero y las partes por
 *  id. `holder` puede existir anulado o reembolsado: sigue siendo el portador del
 *  `mpPaymentId`, y las partes nuevas cuelgan de él. */
export async function loadGroup(
  db: Pick<PrismaClient, "payment">,
  row: { mpPaymentId: string; amount: number },
): Promise<LoadedGroup> {
  const holderRaw = await db.payment.findUnique({ where: { mpPaymentId: row.mpPaymentId }, select: GROUP_PAYMENT_SELECT });
  if (!holderRaw) return { holder: null, parts: [], all: [], totals: groupTotals([], row.amount) };
  const holder = toRow(holderRaw as RawRow);
  const partsRaw = await db.payment.findMany({
    where: { splitOfPaymentId: holder.id }, select: GROUP_PAYMENT_SELECT, orderBy: { id: "asc" },
  });
  const parts = (partsRaw as RawRow[]).map(toRow).sort((a, b) => a.id - b.id);
  const all = [holder, ...parts];
  return { holder, parts, all, totals: groupTotals(all, row.amount) };
}

/** La leyenda de "pago compartido" del recibo y del email (decisión 4): total y
 *  fecha del cobro de MP, sólo cuando este pago cubre MENOS que el cobro. Sin
 *  contar socios, para que el texto no envejezca cuando una parte se anula y se
 *  reasigna. Un pago sin partes ni portador no consulta nada: el dato del recibo
 *  de siempre sigue byte-idéntico. */
export async function sharedPaymentOf(
  db: Pick<PrismaClient, "payment" | "mpUnmatchedPayment">,
  payment: { amount: number; mpPaymentId: string | null; splitOfPaymentId: number | null; hasParts: boolean },
): Promise<{ rowId: number; mpPaymentId: string; total: number; paidAt: Date } | null> {
  if (payment.splitOfPaymentId === null && !payment.hasParts) return null;
  const holderMpId = payment.mpPaymentId
    ?? (payment.splitOfPaymentId !== null
      ? (await db.payment.findUnique({ where: { id: payment.splitOfPaymentId }, select: { mpPaymentId: true } }))?.mpPaymentId ?? null
      : null);
  if (!holderMpId) return null;
  const row = await db.mpUnmatchedPayment.findUnique({
    where: { mpPaymentId: holderMpId }, select: { id: true, amount: true, paidAt: true },
  });
  if (!row) return null;
  const total = Number(row.amount);
  return cents(payment.amount) < cents(total) ? { rowId: row.id, mpPaymentId: holderMpId, total, paidAt: row.paidAt } : null;
}

/** `?socios=192,193` → `[192, 193]`: enteros positivos, sin repetidos, hasta el
 *  tope. Lo que no es un id se ignora (una URL editada a mano no puede tirar la
 *  pantalla). */
export function parseSociosParam(raw: string | undefined): number[] {
  if (!raw) return [];
  const out: number[] = [];
  for (const piece of raw.split(",")) {
    if (!/^\d+$/.test(piece.trim())) continue;
    const n = Number(piece);
    if (n <= 0 || out.includes(n)) continue;
    out.push(n);
    if (out.length === MAX_SPLIT_PARTS) break;
  }
  return out;
}
```

- [ ] **Step 4: Escribir `split-messages.ts`**

```ts
// Los textos de las guardas del reparto, en UN lugar (la lección de
// `GRANT_GUARD_MESSAGES`): la action pre-valida lo barato con estos mismos
// textos y el núcleo revalida todo. El operador lee lo mismo se corte donde se
// corte. Módulo puro: sin Prisma.
import { formatARS } from "@/lib/format";
import { adminExemptionNotice, type ExemptionMinute } from "./exemptions";
import { MAX_SPLIT_PARTS } from "./split-group";

export const SPLIT_GUARD_MESSAGES = {
  noParts: "Elegí al menos un socio.",
  tooManyParts: `Como máximo ${MAX_SPLIT_PARTS} socios por pago.`,
  duplicateMember: "Un socio no puede aparecer dos veces en el reparto.",
  rowGone: "La fila ya no existe.",
  rowResolved: "Esta fila ya fue resuelta.",
  memberGone: "El socio no existe.",
  conceptCategory: "Ese concepto no corresponde a la categoría del socio.",
  // Los dos del cesante son los MISMOS textos que Efectivo (`registerCashPayment`).
  withdrawnConcept:
    "El socio está dado de baja: sólo se le puede cobrar la deuda de cuotas. Para registrar aportes, primero el reingreso.",
  withdrawnCount: (pending: number): string =>
    pending === 0
      ? "El socio está dado de baja y no tiene cuotas pendientes: no hay nada que cobrarle."
      : `El socio está dado de baja: tiene ${pending} ${pending === 1 ? "cuota pendiente" : "cuotas pendientes"} y no devenga nuevas.`,
  exempt: (e: { toPeriod: string; minute: ExemptionMinute }): string =>
    `${adminExemptionNotice(e)} Sólo se le puede registrar un aporte.`,
  amountZero: "El importe de cada parte tiene que ser mayor a cero.",
  // 60 es `MAX_FEES_PER_PAYMENT` (service.ts); acá va el literal para no importar
  // el servicio desde un módulo puro.
  count: "La cantidad de cuotas tiene que estar entre 1 y 60.",
  sum: (parts: number, unassigned: number): string =>
    `Las partes suman ${formatARS(parts)} y hay ${formatARS(unassigned)} sin asignar.`,
  changed: "Este pago cambió mientras lo repartías. Revisá la fila y volvé a intentarlo.",
} as const;
```

- [ ] **Step 5: Verificar**

Run: `npm test -- tests/treasury-split-group.test.ts && npx tsc --noEmit`
Expected: PASS, sin errores de tipo. Si `exemptions.ts` importara `@/lib/prisma` al evaluarse, el test se caería sin `.env`: no lo hace (recibe `db` por parámetro); confirmarlo con `grep -n "lib/prisma" src/lib/treasury/exemptions.ts` → sin resultados.

- [ ] **Step 6: Commit**

```bash
git add src/lib/treasury/split-group.ts src/lib/treasury/split-messages.ts tests/treasury-split-group.test.ts
git commit -m "feat(treasury): split group arithmetic, loader, shared-payment legend data and guard messages

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Refactor del núcleo sin cambio de comportamiento — `preparePart`, `writePaymentAndFees`, `issueReceipt`

**Files:**
- Modify: `src/lib/treasury/service.ts:1-20` (imports), `:165-349` (`registerPaymentCore`), `:456-477` (los dos mensajes del cesante en `registerCashPayment`)
- Test (sin cambios, es la red): `tests/treasury-service.test.ts`, `tests/cash-actions-auth.test.ts`, `tests/exemption-blocks.test.ts`, `tests/mp-webhook-processor.test.ts`, `tests/mp-reconcile.test.ts`

**Interfaces:**
- Consumes: `SPLIT_GUARD_MESSAGES.withdrawnCount/withdrawnConcept` (Task 2), `TxLike` de `./receipt-number`.
- Produces (internas al closure de `makeTreasuryService`, las usa la Task 4):
  - `type PreparedPart = { memberId: number | null; applicationId: number | null; type: PaymentType; amount: number; paidAt: Date; actorId: number | null; note: string | null; periods: Period[]; toCreate: Period[]; concept: string; year: number }`
  - `validateInput(input: RegisterPaymentInput): number` (monto redondeado)
  - `preparePart(input: RegisterPaymentInput, opts: { strictWithdrawn: boolean }): Promise<{ kind: "prepared"; part: PreparedPart } | { kind: "no_pending_withdrawn" }>`
  - `type PaymentIdentity = { mpPaymentId: string | null; preapprovalId: string | null } | { splitOfPaymentId: number }`
  - `writePaymentAndFees(tx: TxLike, part: PreparedPart, identity: PaymentIdentity): Promise<number>` (id del pago)
  - `issueReceipt(tx: TxLike, paymentId: number, part: PreparedPart): Promise<{ receiptId: number; number: string }>`

- [ ] **Step 1: Correr la suite de referencia y anotar el conteo**

Run: `npm test 2>&1 | tail -5`
Expected: todo verde. Anotar el número de tests (se compara en la Task 13).

- [ ] **Step 2: Imports**

En `src/lib/treasury/service.ts`, cambiar la línea `import { formatReceiptNumber, nextReceiptSeq } from "./receipt-number";` por:

```ts
import { formatReceiptNumber, nextReceiptSeq, type TxLike } from "./receipt-number";
```

y agregar después de la línea de `./rules`:

```ts
import { SPLIT_GUARD_MESSAGES } from "./split-messages";
```

- [ ] **Step 3: Reemplazar `registerPaymentCore` (líneas 165-349) por las cuatro funciones**

Borrar desde `  // Núcleo agnóstico del origen: asienta un cobro (pago + cuotas + recibo) sin` (línea 160) hasta el cierre de `registerPaymentCore` (línea 349, la que precede a la línea en blanco y al comentario `// Núcleo de la reversión`) y pegar:

```ts
  // ── Las tres piezas del asiento (spec 2026-09-10 §5.1) ─────────────────────
  //
  // `registerPaymentCore` era un solo bloque. El reparto necesita las MISMAS
  // escrituras N veces dentro de UNA transacción, así que el cuerpo se parte en
  // tres funciones que el cobro de siempre llama en el MISMO orden de hoy:
  // preparar → pago + cuotas → (cierre de la fila) → número + recibo. La suite
  // de `tests/treasury-service.test.ts` es la red de este refactor y no cambia.

  type PreparedPart = {
    memberId: number | null;
    applicationId: number | null;
    type: PaymentType;
    /** Redondeado a centavos. */
    amount: number;
    paidAt: Date;
    actorId: number | null;
    note: string | null;
    periods: Period[];
    toCreate: Period[];
    /** Congelado al preparar: es lo que dice el recibo para siempre. */
    concept: string;
    year: number;
  };

  /** Validaciones puras del cobro. Devuelve el monto redondeado a centavos. */
  function validateInput(input: RegisterPaymentInput): number {
    const amount = Math.round(input.amount * 100) / 100;
    if (!Number.isFinite(amount) || amount <= 0) throw new TreasuryError("El monto del pago tiene que ser mayor a cero.");
    if (amount > MAX_AMOUNT) {
      throw new TreasuryError("El monto supera el máximo que admite el sistema ($ 99.999.999,99).");
    }
    if (!Number.isInteger(input.n) || input.n < 0 || input.n > MAX_FEES_PER_PAYMENT) {
      throw new TreasuryError(`La cantidad de cuotas tiene que estar entre 0 y ${MAX_FEES_PER_PAYMENT}.`);
    }
    // `n` sólo tiene sentido para los tipos que imputan cuotas (FEE_TYPES). Un
    // llamador que mande `entry`/`voluntary`/`extraordinary` con `n` distinto de
    // cero está confundido sobre qué está cobrando, y silenciarlo asentaba el
    // pago con cero cuotas imputadas sin avisar a nadie. Esto es un bug del
    // llamador, no algo que Mercado Pago pueda provocar, así que es ruidoso.
    if (!FEE_TYPES.includes(input.type) && input.n !== 0) {
      throw new TreasuryError("Este tipo de pago no imputa cuotas: la cantidad tiene que ser 0.");
    }
    if (input.memberId === null && input.type !== "entry") throw new TreasuryError("El pago necesita un socio.");
    return amount;
  }

  /** Todo lo que corre ANTES de la transacción: validaciones, socio, cuotas,
   *  reingreso, imputación y concepto congelado.
   *
   *  `strictWithdrawn: false` es el camino de siempre: el cesante se recorta en
   *  silencio porque desde un webhook no hay a quién avisarle (y tirar sería un
   *  500 que MP reintentaría para siempre). `true` es el reparto: hay un
   *  operador enfrente y un recorte silencioso sería cobrar algo distinto de lo
   *  que acaba de confirmar. */
  async function preparePart(
    input: RegisterPaymentInput,
    opts: { strictWithdrawn: boolean },
  ): Promise<{ kind: "prepared"; part: PreparedPart } | { kind: "no_pending_withdrawn" }> {
    const amount = validateInput(input);
    let periods: Period[] = [];
    let toCreate: Period[] = [];
    // Ya se validó que `input.n === 0` para cualquier tipo fuera de FEE_TYPES.
    let n = input.n;
    if (input.memberId !== null) {
      const member = await db.member.findUnique({
        where: { id: input.memberId },
        select: { id: true, status: true, joinedAt: true },
      });
      if (!member) throw new TreasuryError("El socio no existe.");
      if (n > 0) {
        // El reingreso más nuevo entra en el piso de cobertura y NO se puede
        // derivar de `joinedAt` (REG-11: el reingreso no reinicia la antigüedad,
        // ver `applications/record.ts`). `date` es la fecha del ACTA que
        // resolvió el reingreso: el reingreso rige desde el acta.
        const [fees, readmission] = await Promise.all([
          db.fee.findMany({ where: { memberId: member.id }, select: { period: true, status: true } }),
          db.movement.findFirst({
            where: { memberId: member.id, type: "readmission" },
            orderBy: [{ date: "desc" }, { id: "desc" }],
            select: { date: true },
          }),
        ]);
        const pending = fees.filter((f) => f.status === "pending").map((f) => f.period);
        // Un dado de baja no devenga: se le cobra la deuda congelada y ni una
        // cuota más.
        if (member.status === "withdrawn") {
          if (opts.strictWithdrawn && n > pending.length) {
            throw new TreasuryError(SPLIT_GUARD_MESSAGES.withdrawnCount(pending.length));
          }
          n = Math.min(n, pending.length);
          if (n === 0) return { kind: "no_pending_withdrawn" };
        }
        const allocation = allocate({
          pending,
          existing: fees.map((f) => f.period),
          n,
          // El PISO, no el mes en curso: la cuenta corriente no tiene fila para
          // lo que ya está cubierto. El piso puede quedar ANTES de hoy (quien no
          // pagó septiembre y paga en octubre cubre septiembre primero) y también
          // DESPUÉS (un alta de noviembre).
          startAt: coverageFloor({ joinedAt: member.joinedAt, readmittedAt: readmission?.date ?? null }),
        });
        periods = allocation.toPay;
        toCreate = allocation.toCreate;
      }
    }
    return {
      kind: "prepared",
      part: {
        memberId: input.memberId,
        applicationId: input.applicationId ?? null,
        type: input.type,
        amount,
        paidAt: input.paidAt,
        actorId: input.actorId,
        note: input.note ?? null,
        periods,
        toCreate,
        // El concepto se congela al emitir: es lo que dice el recibo para siempre.
        concept: fitConcept(paymentConcept(input.type, periods)),
        year: seriesYear(input.paidAt),
      },
    };
  }

  /** De qué dinero es el pago: el de MP que porta ÉL (`mpPaymentId`), o una
   *  PARTE del que porta otro (`splitOfPaymentId`, spec 2026-09-10). Nunca las
   *  dos cosas: el tipo no deja escribirlas juntas. */
  type PaymentIdentity =
    | { mpPaymentId: string | null; preapprovalId: string | null }
    | { splitOfPaymentId: number };

  /** Pago + cuotas, dentro de la transacción del llamador. El pago va PRIMERO:
   *  si la unique de `mpPaymentId` choca (dos eventos del mismo cobro en
   *  paralelo), la transacción muere acá, antes de pedir número — un rollback
   *  no consume serie (REG-33). Devuelve el id del pago. */
  async function writePaymentAndFees(tx: TxLike, part: PreparedPart, identity: PaymentIdentity): Promise<number> {
    const payment = await tx.payment.create({
      data: {
        memberId: part.memberId,
        applicationId: part.applicationId,
        type: part.type,
        amount: part.amount.toFixed(2),
        paidAt: part.paidAt,
        ...("splitOfPaymentId" in identity
          ? { mpPaymentId: null, preapprovalId: null, splitOfPaymentId: identity.splitOfPaymentId }
          : { mpPaymentId: identity.mpPaymentId, preapprovalId: identity.preapprovalId }),
        registeredById: part.actorId,
        note: part.note,
        status: "applied",
      },
    });
    if (part.toCreate.length > 0) {
      await tx.fee.createMany({
        data: part.toCreate.map((period) => ({
          memberId: part.memberId!, period, status: "paid" as const, origin: "accrual" as const, paymentId: payment.id,
        })),
      });
    }
    const existingToPay = part.periods.filter((p) => !part.toCreate.includes(p));
    if (existingToPay.length > 0) {
      // `status: "pending"` no es redundante con la lectura de arriba: acota
      // el UPDATE a lo que sigue pendiente AHORA. Y se controla el `count`
      // porque un `where` que no matchea no falla, solo actualiza cero filas:
      // sin este chequeo, un pago podía quedar cobrado sin cuotas imputadas.
      const imputed = await tx.fee.updateMany({
        where: { memberId: part.memberId!, period: { in: existingToPay }, status: "pending" },
        data: { status: "paid", paymentId: payment.id },
      });
      if (imputed.count !== existingToPay.length) {
        throw new TreasuryError(
          "Las cuotas del socio cambiaron mientras se registraba el pago. Revisá la cuenta y volvé a intentarlo.",
        );
      }
    }
    return payment.id;
  }

  /** El número, lo último: el lock de la fila del año se sostiene hasta el
   *  commit, así que todo lo que se pueda escribir antes se escribe antes. */
  async function issueReceipt(tx: TxLike, paymentId: number, part: PreparedPart): Promise<{ receiptId: number; number: string }> {
    const seq = await nextReceiptSeq(tx, part.year);
    const number = formatReceiptNumber(part.year, seq);
    const receipt = await tx.receipt.create({
      data: {
        number, year: part.year, seq, paymentId, concept: part.concept,
        pdfPath: receiptRelativePath(number), issuedAt: part.paidAt,
      },
    });
    return { receiptId: receipt.id, number };
  }

  // Núcleo agnóstico del origen: asienta un cobro (pago + cuotas + recibo) sin
  // preguntar de dónde viene. NO toma el mutex — el mutex lo pone el método
  // público `registerPayment`, y `registerCashPayment` lo llama desde adentro
  // del suyo (no existe mutex reentrante: volver a tomarlo se bloquearía solo).
  async function registerPaymentCore(input: RegisterPaymentInput, retried = false): Promise<RegisterResult> {
    validateInput(input);

    // Primera barrera de idempotencia: el cobro de MP ya está asentado. La
    // barrera REAL es la unique de `mpPaymentId` (se maneja más abajo); esta
    // consulta sólo evita el trabajo y el rollback en el caso normal.
    if (input.mpPaymentId) {
      const existing = await db.payment.findUnique({
        where: { mpPaymentId: input.mpPaymentId },
        select: { id: true },
      });
      if (existing) return { kind: "already_processed", paymentId: existing.id };
    }

    const prepared = await preparePart(input, { strictWithdrawn: false });
    if (prepared.kind === "no_pending_withdrawn") return { kind: "no_pending_withdrawn" };
    const { part } = prepared;

    let created: { paymentId: number; receiptId: number; number: string };
    try {
      created = await db.$transaction(async (tx) => {
        const paymentId = await writePaymentAndFees(tx, part, {
          mpPaymentId: input.mpPaymentId ?? null,
          preapprovalId: input.preapprovalId ?? null,
        });
        // Cierre automático de la bandeja: si este cobro estaba esperando, deja
        // de esperar en la misma transacción que lo asienta.
        if (input.mpPaymentId) {
          await tx.mpUnmatchedPayment.updateMany({
            where: { mpPaymentId: input.mpPaymentId, status: "open" },
            data: { status: "matched", paymentId, resolvedAt: now() },
          });
        }
        const { receiptId, number } = await issueReceipt(tx, paymentId, part);
        return { paymentId, receiptId, number };
      });
    } catch (e) {
      // Barrera real de idempotencia: la unique de `mp_payment_id`. Si dos
      // eventos del mismo cobro corrieron en paralelo, el que perdió no
      // escribió nada y el ganador ya tiene el recibo.
      if (input.mpPaymentId && isUniqueViolation(e)) {
        const winner = await db.payment.findUnique({
          where: { mpPaymentId: input.mpPaymentId },
          select: { id: true },
        });
        if (winner) return { kind: "already_processed", paymentId: winner.id };
      }
      // Carrera con el cron de devengo (4C): entre el `findMany` de las cuotas y
      // este INSERT, el cron creó el mismo período y el unique (memberId, period)
      // mató la transacción entera. Se recalcula la imputación desde cero y se
      // reintenta UNA vez. Acotado a ESE unique: el otro unique que puede matar
      // esta transacción es `mp_payment_id`, y ése no se reintenta nunca.
      if (!retried && input.memberId !== null && isFeePeriodUniqueViolation(e)) {
        console.warn("[treasury] P2002 al imputar: se recalcula la imputación y se reintenta", input.memberId);
        return registerPaymentCore(input, true);
      }
      throw e;
    }
    // Después del commit: el número ya es definitivo y el PDF es regenerable.
    const pdfWritten = await writePdfBestEffort(created.receiptId, receiptRelativePath(created.number));
    return { kind: "registered", ...created, periods: [...part.periods].sort(comparePeriods), amount: part.amount, pdfWritten };
  }
```

- [ ] **Step 4: Los dos mensajes del cesante en `registerCashPayment` salen del módulo compartido**

En `registerCashPayment`, reemplazar el `throw` de `if (member.status === "withdrawn" && input.concept !== "fees")` por:

```ts
          throw new TreasuryError(SPLIT_GUARD_MESSAGES.withdrawnConcept);
```

y el `throw` de `if (member.status === "withdrawn" && count > pending.length)` por:

```ts
            throw new TreasuryError(SPLIT_GUARD_MESSAGES.withdrawnCount(pending.length));
```

(Los textos son idénticos letra por letra: `tests/cash-actions-auth.test.ts` y `tests/treasury-service.test.ts` los fijan y siguen verdes.)

- [ ] **Step 5: Verificar que NADA cambió**

Run:

```bash
npm test -- tests/treasury-service.test.ts tests/cash-actions-auth.test.ts tests/exemption-blocks.test.ts tests/mp-webhook-processor.test.ts tests/mp-reconcile.test.ts tests/mp-link-subscription.test.ts tests/unmatched-actions-auth.test.ts
npx tsc --noEmit
git diff --stat -- tests/
```

Expected: todo PASS; `tsc` limpio; `git diff --stat -- tests/` **vacío**.

- [ ] **Step 6: Commit**

```bash
git add src/lib/treasury/service.ts
git commit -m "refactor(treasury): split registerPaymentCore into preparePart, writePaymentAndFees and issueReceipt (no behaviour change)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: `registerSplitPayment` — el reparto en una transacción

**Files:**
- Create: `src/lib/treasury/split-preview.ts` (en esta tarea sólo `SplitPartPlan` y `splitPartGuards`; la Task 7 le suma el token y la vista previa)
- Modify: `src/lib/treasury/service.ts` (imports, tipos exportados, `registerSplitCore`, método público `registerSplitPayment`)
- Create: `tests/helpers/split-fake-db.ts`
- Test: `tests/treasury-split.test.ts`

**Interfaces:**
- Consumes: `preparePart`, `writePaymentAndFees`, `issueReceipt`, `PaymentIdentity` (Task 3); `loadGroup`, `cents`, `INBOX_CONCEPT_TYPE`, `MAX_SPLIT_PARTS` (Task 2); `SPLIT_GUARD_MESSAGES` (Task 2).
- Produces:
  - `export type SplitPartPlan = { memberId: number; concept: CashConcept; n: number; amount: number }` (en `split-preview.ts`)
  - `export async function splitPartGuards(db: Pick<PrismaClient, "member" | "fee" | "feeExemption">, parts: SplitPartPlan[], at?: Date): Promise<string | null>` — texto de la primera guarda que corta, o `null`
  - En `service.ts`: `export type SplitPartInput = SplitPartPlan`; `export type RegisterSplitInput = { rowId: number; parts: SplitPartInput[]; actorId: number; note?: string | null }`; `export type SplitPartResult = { memberId: number; paymentId: number; receiptId: number; number: string; periods: Period[]; amount: number; pdfWritten: boolean }`; `export type RegisterSplitResult = { kind: "registered"; rowStatus: "matched" | "partial"; parts: SplitPartResult[] } | { kind: "already_processed"; paymentId: number }`; método `treasuryService.registerSplitPayment(input: RegisterSplitInput): Promise<RegisterSplitResult>`.

- [ ] **Step 1: El doble de base compartido para los tests del reparto**

`tests/helpers/split-fake-db.ts` (no es un `.test.ts`: vitest no lo corre solo). Honra el `where` que recibe —status escalar o `{ in }`, `OR` del grupo, `paymentId`—: sin eso, borrar un filtro del servicio no pondría ningún test en rojo.

```ts
import { vi } from "vitest";

export type FakeMember = {
  id: number; fullName: string; category: string; status: string; joinedAt: Date; email?: string | null;
};
export type FakeFee = {
  id: number; memberId: number; period: string; status: string; origin: string; paymentId: number | null;
};
export type FakeRow = Record<string, unknown> & {
  id: number; mpPaymentId: string; amount: string; paidAt: Date; preapprovalId: string | null;
  status: string; paymentId: number | null;
};
export type FakeExemption = {
  id: number; memberId: number; fromPeriod: string; toPeriod: string; months: number; minuteId: number;
  minute: { type: string; number: number }; note: string | null; revokedAt: Date | null;
};
type Row = Record<string, unknown> & { id: number };
type StatusCond = string | { in: string[] } | undefined;
type FeeWhere = { memberId: number; period: { in: string[] }; paymentId?: number; status?: string };

// La forma REAL del P2002 con el adapter de MariaDB (medida en
// `tests/integration/unique-violation.test.ts`): el índice viaja en
// `driverAdapterError`, no en `meta.target`.
export function p2002(index: string): Error {
  return Object.assign(new Error(`Duplicate entry for key '${index}'`), {
    code: "P2002",
    meta: {
      driverAdapterError: {
        name: "DriverAdapterError",
        cause: { kind: "UniqueConstraintViolation", constraint: { index } },
      },
    },
  });
}

function statusMatches(value: unknown, cond: StatusCond): boolean {
  if (cond === undefined) return true;
  if (typeof cond === "string") return value === cond;
  return cond.in.includes(value as string);
}

export function splitFakeDb(opts: {
  members: FakeMember[];
  fees: FakeFee[];
  rows: FakeRow[];
  payments?: Row[];
  exemptions?: FakeExemption[];
  readmittedAt?: Record<number, Date>;
}) {
  const state = {
    fees: opts.fees.map((f) => ({ ...f })),
    payments: (opts.payments ?? []).map((p) => ({ ...p })),
    receipts: [] as Row[],
    rows: opts.rows.map((r) => ({ ...r })),
    seq: 0,
    /** Bitácora de orden: "start"/"end" del $transaction, "lock" (FOR UPDATE),
     *  "row-update", "seq" (número pedido), "receipt". */
    log: [] as string[],
    /** Gancho para simular OTRO escritor entre la foto y la transacción. */
    beforeTransaction: null as null | (() => void),
  };
  const memberOf = (id: unknown) => opts.members.find((m) => m.id === id) ?? null;
  const receiptWithPayment = (r: Row) => {
    const payment = state.payments.find((p) => p.id === r.paymentId)!;
    const m = memberOf(payment.memberId);
    return {
      ...r,
      payment: {
        ...payment,
        fees: state.fees.filter((f) => f.paymentId === payment.id),
        member: m ? { ...m, memberships: [] } : null,
        application: null,
        splitParts: state.payments.filter((p) => p.splitOfPaymentId === payment.id).map((p) => ({ id: p.id })),
      },
    };
  };
  const tx = {
    member: {
      findUnique: vi.fn(async (a: { where: { id: number } }) => memberOf(a.where.id)),
    },
    movement: {
      findFirst: vi.fn(async (a: { where: { memberId: number } }) => {
        const d = opts.readmittedAt?.[a.where.memberId];
        return d ? { date: d } : null;
      }),
    },
    feeExemption: {
      findFirst: vi.fn(async (a: { where: { memberId: number; revokedAt: null; toPeriod: { gte: string } } }) =>
        (opts.exemptions ?? []).find((e) =>
          e.memberId === a.where.memberId && e.revokedAt === null && e.toPeriod >= a.where.toPeriod.gte) ?? null),
    },
    fee: {
      findMany: vi.fn(async (a: { where: { memberId: number } }) =>
        state.fees.filter((f) => f.memberId === a.where.memberId)),
      count: vi.fn(async (a: { where: { memberId: number; status?: string } }) =>
        state.fees.filter((f) => f.memberId === a.where.memberId && statusMatches(f.status, a.where.status)).length),
      updateMany: vi.fn(async (a: { where: FeeWhere; data: Record<string, unknown> }) => {
        let count = 0;
        for (const f of state.fees) {
          if (f.memberId !== a.where.memberId) continue;
          if (!a.where.period.in.includes(f.period)) continue;
          if (a.where.paymentId !== undefined && f.paymentId !== a.where.paymentId) continue;
          if (a.where.status !== undefined && f.status !== a.where.status) continue;
          Object.assign(f, a.data);
          count++;
        }
        return { count };
      }),
      createMany: vi.fn(async (a: { data: Array<Omit<FakeFee, "id">> }) => {
        for (const d of a.data) {
          if (state.fees.some((f) => f.memberId === d.memberId && f.period === d.period)) {
            throw p2002("fees_member_id_period_key");
          }
        }
        for (const d of a.data) state.fees.push({ id: state.fees.length + 1, ...d });
        return { count: a.data.length };
      }),
      deleteMany: vi.fn(async (a: { where: { id: { in: number[] } } }) => {
        const before = state.fees.length;
        state.fees = state.fees.filter((f) => !a.where.id.in.includes(f.id));
        return { count: before - state.fees.length };
      }),
    },
    payment: {
      create: vi.fn(async (a: { data: Record<string, unknown> }) => {
        const mpId = a.data.mpPaymentId;
        if (mpId && state.payments.some((p) => p.mpPaymentId === mpId)) throw p2002("payments_mp_payment_id_key");
        const p = { id: state.payments.length + 1, ...a.data };
        state.payments.push(p);
        return p;
      }),
      findUnique: vi.fn(async (a: { where: { mpPaymentId?: string; id?: number } }) =>
        state.payments.find((p) => (
          a.where.mpPaymentId !== undefined ? p.mpPaymentId === a.where.mpPaymentId : p.id === a.where.id
        )) ?? null),
      findMany: vi.fn(async (a: {
        where: { splitOfPaymentId?: number; status?: string; OR?: Array<{ id?: number; splitOfPaymentId?: number }> };
      }) =>
        state.payments.filter((p) => {
          if (a.where.OR && !a.where.OR.some((c) =>
            (c.id !== undefined && p.id === c.id)
            || (c.splitOfPaymentId !== undefined && p.splitOfPaymentId === c.splitOfPaymentId))) return false;
          if (a.where.splitOfPaymentId !== undefined && p.splitOfPaymentId !== a.where.splitOfPaymentId) return false;
          if (a.where.status !== undefined && p.status !== a.where.status) return false;
          return true;
        }).sort((x, y) => x.id - y.id)),
      update: vi.fn(async (a: { where: { id: number }; data: Record<string, unknown> }) => {
        const p = state.payments.find((x) => x.id === a.where.id)!;
        Object.assign(p, a.data);
        return p;
      }),
    },
    mpUnmatchedPayment: {
      findUnique: vi.fn(async (a: { where: { id?: number; mpPaymentId?: string } }) =>
        state.rows.find((r) => (a.where.id !== undefined ? r.id === a.where.id : r.mpPaymentId === a.where.mpPaymentId)) ?? null),
      updateMany: vi.fn(async (a: {
        where: { id?: number; paymentId?: number | null; mpPaymentId?: string; status?: StatusCond };
        data: Record<string, unknown>;
      }) => {
        state.log.push("row-update");
        let count = 0;
        for (const r of state.rows) {
          if (a.where.id !== undefined && r.id !== a.where.id) continue;
          if (a.where.paymentId !== undefined && r.paymentId !== a.where.paymentId) continue;
          if (a.where.mpPaymentId !== undefined && r.mpPaymentId !== a.where.mpPaymentId) continue;
          if (!statusMatches(r.status, a.where.status)) continue;
          Object.assign(r, a.data);
          count++;
        }
        return { count };
      }),
    },
    receipt: {
      create: vi.fn(async (a: { data: Record<string, unknown> }) => {
        state.log.push("receipt");
        const r = { id: state.receipts.length + 1, ...a.data };
        state.receipts.push(r);
        return r;
      }),
      findUnique: vi.fn(async (a: { where: { id: number } }) => {
        const r = state.receipts.find((x) => x.id === a.where.id);
        return r ? receiptWithPayment(r) : null;
      }),
      findFirst: vi.fn(async (a: { where: { payment?: { mpPaymentId: string }; paymentId?: number } }) => {
        const pid = a.where.paymentId
          ?? state.payments.find((x) => x.mpPaymentId === a.where.payment?.mpPaymentId)?.id;
        const r = pid === undefined ? undefined : state.receipts.find((x) => x.paymentId === pid);
        return r ? receiptWithPayment(r) : null;
      }),
      update: vi.fn(async (a: { where: { id: number }; data: Record<string, unknown> }) => {
        const r = state.receipts.find((x) => x.id === a.where.id)!;
        Object.assign(r, a.data);
        return r;
      }),
    },
    $executeRaw: vi.fn(async () => { state.seq++; state.log.push("seq"); return 1; }),
    $queryRaw: vi.fn(async () => { state.log.push("lock"); return []; }),
    receiptSequence: {
      findUniqueOrThrow: vi.fn(async (a: { where: { year: number } }) => ({ year: a.where.year, last: state.seq })),
    },
  };
  const db = {
    ...tx,
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => {
      state.beforeTransaction?.();
      state.beforeTransaction = null;
      // Foto para el rollback: una transacción que falla no deja NADA escrito,
      // incluida la fila de la bandeja y el número de la serie.
      const snapshot = {
        fees: state.fees.map((f) => ({ ...f })),
        payments: state.payments.map((p) => ({ ...p })),
        receipts: state.receipts.map((r) => ({ ...r })),
        rows: state.rows.map((r) => ({ ...r })),
        seq: state.seq,
      };
      state.log.push("start");
      try {
        const result = await fn(tx);
        state.log.push("end");
        return result;
      } catch (e) {
        state.fees = snapshot.fees;
        state.payments = snapshot.payments;
        state.receipts = snapshot.receipts;
        state.rows = snapshot.rows;
        state.seq = snapshot.seq;
        state.log.push("rollback");
        throw e;
      }
    }),
  };
  return { db: db as never, mocks: db, state };
}
```

- [ ] **Step 2: Escribir los tests del reparto (fallan)**

`tests/treasury-split.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { civilDateUtc } from "@/lib/dates";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import { makeTreasuryService, TreasuryError } from "@/lib/treasury/service";
import { SPLIT_GUARD_MESSAGES as M } from "@/lib/treasury/split-messages";
import { splitFakeDb, type FakeFee, type FakeRow } from "./helpers/split-fake-db";

// El reparto de un cobro de MP entre socios (spec 2026-09-10 §5.2): un pago por
// socio en UNA transacción, el portador primero, los números al final, la fila
// derivada del grupo. Las guardas se verificaron por MUTACIÓN al escribirlos:
// borrar cada una en el servicio pone en rojo el `it` que la nombra.

const feeValue = { id: 1, activeAmount: 6000, sharedAmount: 3000, validFrom: civilDateUtc(2026, 9, 1), minuteId: null };
const feeValues = { current: vi.fn(async () => feeValue), history: vi.fn(async () => [feeValue]) };
const NOW = new Date("2026-09-10T15:00:00Z");
const PAID_AT = new Date("2026-09-08T14:00:00Z");
const JOINED = civilDateUtc(2015, 3, 1);
const hugo = { id: 192, fullName: "Araoz Hugo", category: "active", status: "active", joinedAt: JOINED };
const monica = { id: 193, fullName: "Maza Monica", category: "active", status: "active", joinedAt: JOINED };
const carlos = { id: 200, fullName: "Perez Carlos", category: "active", status: "active", joinedAt: JOINED };

function row(over: Partial<FakeRow> = {}): FakeRow {
  return {
    id: 5, mpPaymentId: "mp-18k", amount: "18000.00", paidAt: PAID_AT, preapprovalId: null,
    status: "open", paymentId: null, ...over,
  };
}
function pending(memberId: number, periods: string[], from = 1): FakeFee[] {
  return periods.map((period, i) => ({ id: from + i, memberId, period, status: "pending", origin: "import", paymentId: null }));
}
// Hugo debe julio y agosto; Mónica, agosto.
const FEES = [...pending(192, ["2026-07", "2026-08"], 1), ...pending(193, ["2026-08"], 3)];
const renderPdf = vi.fn(async () => new Uint8Array([1]));
function svcOn(fake: ReturnType<typeof splitFakeDb>) {
  return makeTreasuryService({ db: fake.db, feeValues, now: () => NOW, renderPdf, writePdf: async () => {} });
}
const twoPlusOne = [
  { memberId: 192, concept: "fees" as const, n: 2, amount: 12000 },
  { memberId: 193, concept: "fees" as const, n: 1, amount: 6000 },
];

beforeEach(() => vi.clearAllMocks());

describe("registerSplitPayment — forma", () => {
  it("cero partes, más de cinco, socio repetido, cuotas o importe inválidos: rechaza sin leer la fila", async () => {
    const fake = splitFakeDb({ members: [hugo], fees: [], rows: [row()] });
    const svc = svcOn(fake);
    const base = { rowId: 5, actorId: 9 };
    await expect(svc.registerSplitPayment({ ...base, parts: [] })).rejects.toThrow(M.noParts);
    await expect(svc.registerSplitPayment({ ...base, parts: [1, 2, 3, 4, 5, 6].map((id) => ({ memberId: id, concept: "fees" as const, n: 1, amount: 3000 })) }))
      .rejects.toThrow(M.tooManyParts);
    await expect(svc.registerSplitPayment({ ...base, parts: [{ memberId: 192, concept: "fees", n: 1, amount: 9000 }, { memberId: 192, concept: "fees", n: 1, amount: 9000 }] }))
      .rejects.toThrow(M.duplicateMember);
    await expect(svc.registerSplitPayment({ ...base, parts: [{ memberId: 192, concept: "fees", n: 0, amount: 18000 }] })).rejects.toThrow(M.count);
    await expect(svc.registerSplitPayment({ ...base, parts: [{ memberId: 192, concept: "fees", n: 61, amount: 18000 }] })).rejects.toThrow(M.count);
    await expect(svc.registerSplitPayment({ ...base, parts: [{ memberId: 192, concept: "voluntary", n: 1, amount: 18000 }] })).rejects.toThrow(M.count);
    await expect(svc.registerSplitPayment({ ...base, parts: [{ memberId: 192, concept: "fees", n: 1, amount: 0 }] })).rejects.toThrow(M.amountZero);
    expect(fake.mocks.mpUnmatchedPayment.findUnique).not.toHaveBeenCalled();
    expect(fake.mocks.$transaction).not.toHaveBeenCalled();
  });

  it("fila inexistente o ya resuelta", async () => {
    const svc = svcOn(splitFakeDb({ members: [hugo], fees: [], rows: [row({ status: "matched" })] }));
    await expect(svc.registerSplitPayment({ rowId: 99, actorId: 9, parts: [{ memberId: 192, concept: "fees", n: 3, amount: 18000 }] }))
      .rejects.toThrow(M.rowGone);
    await expect(svc.registerSplitPayment({ rowId: 5, actorId: 9, parts: [{ memberId: 192, concept: "fees", n: 3, amount: 18000 }] }))
      .rejects.toThrow(M.rowResolved);
  });

  it("la suma inexacta se rechaza ANTES de la transacción, con los dos importes", async () => {
    const fake = splitFakeDb({ members: [hugo, monica], fees: FEES, rows: [row()] });
    const svc = svcOn(fake);
    await expect(svc.registerSplitPayment({ rowId: 5, actorId: 9, parts: [{ memberId: 192, concept: "fees", n: 2, amount: 12000 }, { memberId: 193, concept: "fees", n: 1, amount: 5000 }] }))
      .rejects.toThrow("Las partes suman $ 17.000,00 y hay $ 18.000,00 sin asignar.");
    expect(fake.mocks.$transaction).not.toHaveBeenCalled();
    expect(fake.state.seq).toBe(0);
  });
});

describe("registerSplitPayment — el reparto", () => {
  it("2 + 1: dos pagos, el portador con el id de MP, la parte apuntando a él, cuotas por socio, números al final y en orden, fila matched con quién resolvió", async () => {
    const fake = splitFakeDb({ members: [hugo, monica], fees: FEES, rows: [row()] });
    const svc = svcOn(fake);
    const r = await svc.registerSplitPayment({ rowId: 5, actorId: 9, parts: twoPlusOne, note: "matrimonio" });
    if (r.kind !== "registered") throw new Error(r.kind);
    expect(r.rowStatus).toBe("matched");
    expect(r.parts).toEqual([
      { memberId: 192, paymentId: 1, receiptId: 1, number: "2026-00001", periods: ["2026-07", "2026-08"], amount: 12000, pdfWritten: true },
      { memberId: 193, paymentId: 2, receiptId: 2, number: "2026-00002", periods: ["2026-08"], amount: 6000, pdfWritten: true },
    ]);
    // El portador lleva el id de MP y la parte apunta a él; nunca las dos cosas.
    expect(fake.state.payments[0]).toMatchObject({ id: 1, memberId: 192, type: "link", amount: "12000.00", mpPaymentId: "mp-18k", preapprovalId: null, registeredById: 9, note: "matrimonio", paidAt: PAID_AT, status: "applied" });
    expect(fake.state.payments[0].splitOfPaymentId).toBeUndefined();
    expect(fake.state.payments[1]).toMatchObject({ id: 2, memberId: 193, type: "link", amount: "6000.00", mpPaymentId: null, preapprovalId: null, splitOfPaymentId: 1 });
    // Cada socio con SUS cuotas: las más viejas primero.
    expect(fake.state.fees.filter((f) => f.memberId === 192).map((f) => [f.period, f.status, f.paymentId])).toEqual([["2026-07", "paid", 1], ["2026-08", "paid", 1]]);
    expect(fake.state.fees.filter((f) => f.memberId === 193).map((f) => [f.period, f.status, f.paymentId])).toEqual([["2026-08", "paid", 2]]);
    expect(fake.state.receipts.map((x) => [x.number, x.paymentId, x.concept, x.issuedAt])).toEqual([
      ["2026-00001", 1, "Cuota social · julio a agosto 2026 (2 cuotas)", PAID_AT],
      ["2026-00002", 2, "Cuota social · agosto 2026", PAID_AT],
    ]);
    // La fila: cerrada por el grupo entero, con el portador y con quién resolvió, ADENTRO.
    expect(fake.state.rows[0]).toMatchObject({ status: "matched", paymentId: 1, resolvedById: 9, resolvedAt: NOW });
    // Orden: lock → escrituras → fila → números → recibos, todo dentro de la transacción.
    const log = fake.state.log;
    expect(log[0]).toBe("start");
    expect(log.at(-1)).toBe("end");
    expect(log.indexOf("lock")).toBe(1);
    expect(log.indexOf("row-update")).toBeLessThan(log.indexOf("seq"));
    expect(log.filter((e) => e === "seq" || e === "receipt")).toEqual(["seq", "receipt", "seq", "receipt"]);
    // El PDF, DESPUÉS del commit y uno por parte.
    expect(renderPdf).toHaveBeenCalledTimes(2);
  });

  it("una parte sola en una fila fresca escribe exactamente lo que escribe registerPayment", async () => {
    const one = { memberId: 192, concept: "fees" as const, n: 3, amount: 18000 };
    const a = splitFakeDb({ members: [hugo], fees: FEES.filter((f) => f.memberId === 192), rows: [row()] });
    const b = splitFakeDb({ members: [hugo], fees: FEES.filter((f) => f.memberId === 192), rows: [row()] });
    await svcOn(a).registerSplitPayment({ rowId: 5, actorId: 9, parts: [one] });
    await svcOn(b).registerPayment({ memberId: 192, type: "link", n: 3, amount: 18000, paidAt: PAID_AT, mpPaymentId: "mp-18k", preapprovalId: null, actorId: 9, note: null });
    expect(a.state.payments).toEqual(b.state.payments);
    expect(a.state.fees).toEqual(b.state.fees);
    expect(a.state.receipts).toEqual(b.state.receipts);
    expect(a.state.rows[0]).toMatchObject({ status: "matched", paymentId: 1 });
    expect(b.state.rows[0]).toMatchObject({ status: "matched", paymentId: 1 });
  });

  it("fila parcial: la parte nueva cuelga del portador aplicado y la fila pasa a matched", async () => {
    const fake = splitFakeDb({
      members: [hugo, monica, carlos],
      fees: pending(200, ["2026-08"], 10),
      rows: [row({ status: "partial", paymentId: 1 })],
      payments: [
        { id: 1, memberId: 192, type: "link", amount: "12000.00", status: "applied", mpPaymentId: "mp-18k", preapprovalId: null, splitOfPaymentId: null, paidAt: PAID_AT },
        { id: 2, memberId: 193, type: "link", amount: "6000.00", status: "voided", mpPaymentId: null, preapprovalId: null, splitOfPaymentId: 1, paidAt: PAID_AT },
      ],
    });
    const svc = svcOn(fake);
    const r = await svc.registerSplitPayment({ rowId: 5, actorId: 9, parts: [{ memberId: 200, concept: "fees", n: 1, amount: 6000 }] });
    if (r.kind !== "registered") throw new Error(r.kind);
    expect(r.rowStatus).toBe("matched");
    expect(fake.state.payments[2]).toMatchObject({ id: 3, memberId: 200, mpPaymentId: null, splitOfPaymentId: 1, status: "applied" });
    expect(fake.state.rows[0]).toMatchObject({ status: "matched", paymentId: 1 });
  });

  it("fila reabierta (todo anulado): las partes nuevas cuelgan del portador ANULADO, que conserva el id de MP", async () => {
    const fake = splitFakeDb({
      members: [hugo, monica],
      fees: FEES,
      rows: [row({ status: "open", paymentId: null })],
      payments: [
        { id: 1, memberId: 192, type: "link", amount: "18000.00", status: "voided", mpPaymentId: "mp-18k", preapprovalId: null, splitOfPaymentId: null, paidAt: PAID_AT },
      ],
    });
    const svc = svcOn(fake);
    const r = await svc.registerSplitPayment({ rowId: 5, actorId: 9, parts: twoPlusOne });
    if (r.kind !== "registered") throw new Error(r.kind);
    expect(fake.state.payments.slice(1).map((p) => [p.mpPaymentId, p.splitOfPaymentId, p.status])).toEqual([[null, 1, "applied"], [null, 1, "applied"]]);
    expect(fake.state.payments[0]).toMatchObject({ mpPaymentId: "mp-18k", status: "voided" });
    expect(fake.state.rows[0]).toMatchObject({ status: "matched", paymentId: 1 });
  });

  it("la suma de una fila parcial se compara contra lo SIN ASIGNAR, no contra el total", async () => {
    const fake = splitFakeDb({
      members: [carlos], fees: pending(200, ["2026-08"], 10),
      rows: [row({ status: "partial", paymentId: 1 })],
      payments: [{ id: 1, memberId: 192, type: "link", amount: "12000.00", status: "applied", mpPaymentId: "mp-18k", preapprovalId: null, splitOfPaymentId: null, paidAt: PAID_AT }],
    });
    await expect(svcOn(fake).registerSplitPayment({ rowId: 5, actorId: 9, parts: [{ memberId: 200, concept: "fees", n: 3, amount: 18000 }] }))
      .rejects.toThrow("Las partes suman $ 18.000,00 y hay $ 6.000,00 sin asignar.");
  });
});

describe("registerSplitPayment — guardas por socio (las mismas que Efectivo)", () => {
  const adherent = { ...carlos, id: 300, category: "adherent" };
  const withdrawn = { ...carlos, id: 301, status: "withdrawn" };
  it("adherente: sin cuotas sociales", async () => {
    const svc = svcOn(splitFakeDb({ members: [adherent], fees: [], rows: [row()] }));
    await expect(svc.registerSplitPayment({ rowId: 5, actorId: 9, parts: [{ memberId: 300, concept: "fees", n: 3, amount: 18000 }] }))
      .rejects.toThrow(M.conceptCategory);
  });
  it("cesante: sólo deuda, y no más cuotas que las pendientes", async () => {
    const svc = svcOn(splitFakeDb({ members: [withdrawn], fees: pending(301, ["2026-05"], 20), rows: [row()] }));
    await expect(svc.registerSplitPayment({ rowId: 5, actorId: 9, parts: [{ memberId: 301, concept: "voluntary", n: 0, amount: 18000 }] }))
      .rejects.toThrow(M.withdrawnConcept);
    await expect(svc.registerSplitPayment({ rowId: 5, actorId: 9, parts: [{ memberId: 301, concept: "fees", n: 3, amount: 18000 }] }))
      .rejects.toThrow(M.withdrawnCount(1));
  });
  it("exento: sin cuotas, sí aporte", async () => {
    const exemption = { id: 1, memberId: 192, fromPeriod: "2026-09", toPeriod: "2026-12", months: 4, minuteId: 3, minute: { type: "board", number: 124 }, note: null, revokedAt: null };
    const fake = splitFakeDb({ members: [hugo], fees: [], rows: [row()], exemptions: [exemption] });
    const svc = svcOn(fake);
    await expect(svc.registerSplitPayment({ rowId: 5, actorId: 9, parts: [{ memberId: 192, concept: "fees", n: 3, amount: 18000 }] }))
      .rejects.toThrow(M.exempt(exemption));
    const r = await svc.registerSplitPayment({ rowId: 5, actorId: 9, parts: [{ memberId: 192, concept: "voluntary", n: 0, amount: 18000 }] });
    expect(r.kind).toBe("registered");
    expect(fake.state.payments[0]).toMatchObject({ type: "voluntary" });
    expect(fake.state.receipts[0].concept).toBe("Aporte voluntario");
  });
  it("socio inexistente", async () => {
    const svc = svcOn(splitFakeDb({ members: [], fees: [], rows: [row()] }));
    await expect(svc.registerSplitPayment({ rowId: 5, actorId: 9, parts: [{ memberId: 1, concept: "fees", n: 3, amount: 18000 }] }))
      .rejects.toThrow(M.memberGone);
  });
});

describe("registerSplitPayment — carreras", () => {
  it("otro escritor creó el portador entre la foto y el INSERT: already_processed, sin número consumido", async () => {
    const fake = splitFakeDb({ members: [hugo, monica], fees: FEES, rows: [row()] });
    fake.state.beforeTransaction = () => {
      fake.state.payments.push({ id: 41, memberId: 192, type: "debit", amount: "18000.00", status: "applied", mpPaymentId: "mp-18k", preapprovalId: null, splitOfPaymentId: null, paidAt: PAID_AT });
    };
    const r = await svcOn(fake).registerSplitPayment({ rowId: 5, actorId: 9, parts: twoPlusOne });
    expect(r).toEqual({ kind: "already_processed", paymentId: 41 });
    expect(fake.state.receipts).toHaveLength(0);
    expect(fake.state.seq).toBe(0);
  });

  it("carrera con el devengo: el unique (socio, período) recalcula y reintenta UNA vez, sin huecos", async () => {
    // Hugo está al día: sus dos cuotas se CREAN; el cron materializa una en el medio.
    const fake = splitFakeDb({ members: [hugo, monica], fees: pending(193, ["2026-08"], 3), rows: [row()] });
    fake.state.beforeTransaction = () => {
      fake.state.fees.push({ id: 50, memberId: 192, period: "2026-09", status: "pending", origin: "accrual", paymentId: null });
    };
    const r = await svcOn(fake).registerSplitPayment({ rowId: 5, actorId: 9, parts: twoPlusOne });
    if (r.kind !== "registered") throw new Error(r.kind);
    expect(r.parts[0].periods).toEqual(["2026-09", "2026-10"]);
    expect(fake.state.receipts.map((x) => x.number)).toEqual(["2026-00001", "2026-00002"]);
    expect(fake.state.log.filter((e) => e === "rollback")).toHaveLength(1);
  });

  it("la fila se resolvió entre la foto y el lock: nada escrito", async () => {
    const fake = splitFakeDb({ members: [hugo, monica], fees: FEES, rows: [row()] });
    fake.state.beforeTransaction = () => { fake.state.rows[0].status = "dismissed"; };
    await expect(svcOn(fake).registerSplitPayment({ rowId: 5, actorId: 9, parts: twoPlusOne })).rejects.toThrow(M.rowResolved);
    expect(fake.state.payments).toHaveLength(0);
    expect(fake.state.seq).toBe(0);
  });

  it("el grupo cambió entre la foto y el lock (otro reparto): 'cambió mientras' y rollback", async () => {
    const fake = splitFakeDb({ members: [hugo, monica], fees: FEES, rows: [row()] });
    fake.state.beforeTransaction = () => {
      fake.state.payments.push({ id: 41, memberId: 192, type: "link", amount: "6000.00", status: "applied", mpPaymentId: "mp-18k", preapprovalId: null, splitOfPaymentId: null, paidAt: PAID_AT });
      fake.state.rows[0].status = "partial";
      fake.state.rows[0].paymentId = 41;
    };
    await expect(svcOn(fake).registerSplitPayment({ rowId: 5, actorId: 9, parts: twoPlusOne })).rejects.toThrow(M.changed);
    expect(fake.state.payments).toHaveLength(1);
    expect(fake.state.seq).toBe(0);
    expect(fake.state.fees.every((f) => f.status === "pending")).toBe(true);
  });

  it("un TreasuryError del reparto es TreasuryError (la action lo muestra tal cual)", async () => {
    const svc = svcOn(splitFakeDb({ members: [], fees: [], rows: [] }));
    await expect(svc.registerSplitPayment({ rowId: 5, actorId: 9, parts: twoPlusOne })).rejects.toBeInstanceOf(TreasuryError);
  });
});
```

- [ ] **Step 3: Correr y verificar que falla**

Run: `npm test -- tests/treasury-split.test.ts`
Expected: FAIL — `registerSplitPayment is not a function` / módulo `split-preview` inexistente.

- [ ] **Step 4: `split-preview.ts` con las guardas por socio**

```ts
// Las guardas por socio del reparto (spec 2026-09-10 §5.2 paso 3) y, desde la
// Task 7, la vista previa y el token de confirmación. Prisma inyectado: la
// action las usa para PRE-validar con mensaje, y el núcleo las vuelve a correr
// —la misma función, no una copia— antes de escribir.
import type { PrismaClient } from "@/generated/prisma/client";
import { countPendingFees } from "./account";
import { activeExemption } from "./exemptions";
import { cashConceptsFor, type CashConcept } from "./rules";
import { SPLIT_GUARD_MESSAGES as M } from "./split-messages";

/** Una parte del reparto, como la decide el operador. `n` es 0 para los aportes. */
export type SplitPartPlan = { memberId: number; concept: CashConcept; n: number; amount: number };

/** La primera guarda que corta, redactada, o `null` si todas pasan: socio
 *  existente; cesante → sólo `fees` y no más cuotas que sus pendientes;
 *  concepto según categoría (`cashConceptsFor`, la MISMA función que Efectivo);
 *  exento → sólo aportes (`activeExemption`, la MISMA función que las otras
 *  cinco guardas de cobro). */
export async function splitPartGuards(
  db: Pick<PrismaClient, "member" | "fee" | "feeExemption">,
  parts: SplitPartPlan[],
  at: Date = new Date(),
): Promise<string | null> {
  for (const p of parts) {
    const member = await db.member.findUnique({
      where: { id: p.memberId },
      select: { id: true, category: true, status: true },
    });
    if (!member) return M.memberGone;
    if (member.status === "withdrawn" && p.concept !== "fees") return M.withdrawnConcept;
    if (!cashConceptsFor(member.category).includes(p.concept)) return M.conceptCategory;
    if (p.concept === "fees") {
      if (member.status === "withdrawn") {
        const pending = await countPendingFees(db, member.id);
        if (p.n > pending) return M.withdrawnCount(pending);
      }
      const exemption = await activeExemption(db, member.id, at);
      if (exemption) return M.exempt(exemption);
    }
  }
  return null;
}
```

- [ ] **Step 5: El reparto en `service.ts`**

Imports nuevos (junto a los de la Task 3):

```ts
import { cents, INBOX_CONCEPT_TYPE, loadGroup, MAX_SPLIT_PARTS } from "./split-group";
import { splitPartGuards, type SplitPartPlan } from "./split-preview";
```

Tipos exportados, después de `RegisterResult`:

```ts
/** Una parte del reparto de un cobro de la bandeja (spec 2026-09-10). */
export type SplitPartInput = SplitPartPlan;
export type RegisterSplitInput = { rowId: number; parts: SplitPartInput[]; actorId: number; note?: string | null };
export type SplitPartResult = {
  memberId: number; paymentId: number; receiptId: number; number: string; periods: Period[]; amount: number; pdfWritten: boolean;
};
export type RegisterSplitResult =
  | { kind: "registered"; rowStatus: "matched" | "partial"; parts: SplitPartResult[] }
  /** El unique del portador chocó: otro escritor asentó ESTE cobro en el medio. */
  | { kind: "already_processed"; paymentId: number };
```

`registerSplitCore`, dentro de `makeTreasuryService`, inmediatamente después de `registerPaymentCore` (antes del comentario `// Núcleo de la reversión`):

```ts
  // ── Reparto de un cobro de la bandeja (spec 2026-09-10 §5.2) ────────────────
  //
  // Un pago por socio en UNA transacción. El PORTADOR es el pago que lleva el
  // `mpPaymentId` de la fila: el que ya existe (aplicado, anulado o
  // reembolsado: sigue portando el id de MP y las partes nuevas cuelgan de él),
  // o la primera parte, que entonces es el primer INSERT de la transacción — si
  // el unique choca, muere antes de pedir número (REG-33). Los números, al
  // final, uno por parte. NO toma mutex: lo pone `registerSplitPayment`.
  async function registerSplitCore(input: RegisterSplitInput, retried: boolean): Promise<RegisterSplitResult> {
    const M = SPLIT_GUARD_MESSAGES;
    const row = await db.mpUnmatchedPayment.findUnique({
      where: { id: input.rowId },
      select: { id: true, mpPaymentId: true, preapprovalId: true, amount: true, paidAt: true, status: true },
    });
    if (!row) throw new TreasuryError(M.rowGone);
    if (row.status !== "open" && row.status !== "partial") throw new TreasuryError(M.rowResolved);
    const partsCents = input.parts.reduce((s, p) => s + cents(p.amount), 0);
    // Foto del grupo AFUERA de la transacción: es para el mensaje temprano de la
    // suma. La que manda es la relectura de adentro, con la fila bloqueada.
    const before = await loadGroup(db, { mpPaymentId: row.mpPaymentId, amount: Number(row.amount) });
    if (partsCents !== cents(before.totals.unassigned)) {
      throw new TreasuryError(M.sum(partsCents / 100, before.totals.unassigned));
    }
    const guard = await splitPartGuards(db, input.parts, now());
    if (guard) throw new TreasuryError(guard);

    const prepared: Array<{ memberId: number; part: PreparedPart }> = [];
    for (const p of input.parts) {
      const r = await preparePart({
        memberId: p.memberId,
        type: INBOX_CONCEPT_TYPE[p.concept],
        n: p.concept === "fees" ? p.n : 0,
        amount: p.amount,
        // La fecha REAL del cobro, la de MP: el recibo lleva el día en que se
        // cobró, no el día en que el operador lo repartió.
        paidAt: row.paidAt,
        actorId: input.actorId,
        note: input.note ?? null,
      }, { strictWithdrawn: true });
      // En modo estricto el cesante sin pendientes ya tiró arriba: esto no
      // puede pasar, y si pasa tiene que ser ruidoso, no un recorte silencioso.
      if (r.kind !== "prepared") throw new TreasuryError(M.withdrawnCount(0));
      prepared.push({ memberId: p.memberId, part: r.part });
    }

    let created: { rowStatus: "matched" | "partial"; parts: Array<{ paymentId: number; receiptId: number; number: string }> };
    try {
      created = await db.$transaction(async (tx) => {
        // Lock de la fila EN LA BASE: el mutex `unmatched:{id}` es de proceso y
        // no protege contra una consola de MySQL ni contra un segundo proceso.
        await tx.$queryRaw`SELECT id FROM mp_unmatched_payments WHERE id = ${row.id} FOR UPDATE`;
        const live = await tx.mpUnmatchedPayment.findUnique({ where: { id: row.id }, select: { status: true, amount: true } });
        if (!live || (live.status !== "open" && live.status !== "partial")) throw new TreasuryError(M.rowResolved);
        const group = await loadGroup(tx, { mpPaymentId: row.mpPaymentId, amount: Number(live.amount) });
        if (partsCents !== cents(group.totals.unassigned)) throw new TreasuryError(M.changed);

        let holderId: number | null = group.holder?.id ?? null;
        const written: Array<{ paymentId: number; part: PreparedPart }> = [];
        for (const { part } of prepared) {
          const identity: PaymentIdentity = holderId === null
            ? { mpPaymentId: row.mpPaymentId, preapprovalId: row.preapprovalId }
            : { splitOfPaymentId: holderId };
          const paymentId = await writePaymentAndFees(tx, part, identity);
          if (holderId === null) holderId = paymentId;
          written.push({ paymentId, part });
        }
        const assignedAfter = cents(group.totals.assigned) + partsCents;
        const rowStatus: "matched" | "partial" = assignedAfter >= cents(Number(live.amount)) ? "matched" : "partial";
        // El sello de quién resolvió va ADENTRO: antes se escribía después del
        // commit y, si fallaba, la pantalla decía "automático" sobre una
        // resolución manual.
        const updated = await tx.mpUnmatchedPayment.updateMany({
          where: { id: row.id, status: { in: ["open", "partial"] } },
          data: { status: rowStatus, paymentId: holderId, resolvedAt: now(), resolvedById: input.actorId },
        });
        if (updated.count !== 1) throw new TreasuryError(M.changed);
        // Los números, al final y en el orden de las partes.
        const parts: Array<{ paymentId: number; receiptId: number; number: string }> = [];
        for (const w of written) parts.push({ paymentId: w.paymentId, ...(await issueReceipt(tx, w.paymentId, w.part)) });
        return { rowStatus, parts };
      });
    } catch (e) {
      // El unique del portador chocó: otro escritor (la vinculación de una
      // suscripción, el cron) asentó ESTE cobro entre la foto y el INSERT. Se
      // excluye el unique de (socio, período), que es la carrera de abajo.
      if (isUniqueViolation(e) && !isFeePeriodUniqueViolation(e)) {
        const winner = await db.payment.findUnique({ where: { mpPaymentId: row.mpPaymentId }, select: { id: true } });
        if (winner) return { kind: "already_processed", paymentId: winner.id };
      }
      // Carrera con el cron de devengo: se recalcula TODO el reparto y se
      // reintenta una vez, igual que el cobro simple.
      if (!retried && isFeePeriodUniqueViolation(e)) {
        console.warn("[treasury] P2002 al imputar un reparto: se recalcula la imputación y se reintenta", input.rowId);
        return registerSplitCore(input, true);
      }
      throw e;
    }
    // Después del commit: PDF best-effort, uno por parte.
    const parts: SplitPartResult[] = [];
    for (let i = 0; i < created.parts.length; i++) {
      const c = created.parts[i];
      const { memberId, part } = prepared[i];
      const pdfWritten = await writePdfBestEffort(c.receiptId, receiptRelativePath(c.number));
      parts.push({
        memberId, paymentId: c.paymentId, receiptId: c.receiptId, number: c.number,
        periods: [...part.periods].sort(comparePeriods), amount: part.amount, pdfWritten,
      });
    }
    return { kind: "registered", rowStatus: created.rowStatus, parts };
  }
```

Método público, en el objeto devuelto, después de `registerPayment`:

```ts
    /** Reparte un cobro de la bandeja entre 1..5 socios en UNA transacción
     *  (spec 2026-09-10 §5.2). La bandeja lo llama SIEMPRE, también con una
     *  sola parte. Mutex: la fila afuera, y adentro los socios en orden
     *  ASCENDENTE — claves distintas se anidan, y el orden fijo evita que dos
     *  repartos cruzados se traben. `revertCore` toma UN mutex de socio y no
     *  anida: no hay ciclo posible. */
    async registerSplitPayment(input: RegisterSplitInput): Promise<RegisterSplitResult> {
      const M = SPLIT_GUARD_MESSAGES;
      if (input.parts.length === 0) throw new TreasuryError(M.noParts);
      if (input.parts.length > MAX_SPLIT_PARTS) throw new TreasuryError(M.tooManyParts);
      if (new Set(input.parts.map((p) => p.memberId)).size !== input.parts.length) {
        throw new TreasuryError(M.duplicateMember);
      }
      for (const p of input.parts) {
        const amount = Math.round(p.amount * 100) / 100;
        if (!Number.isFinite(amount) || amount <= 0) throw new TreasuryError(M.amountZero);
        if (amount > MAX_AMOUNT) {
          throw new TreasuryError("El monto supera el máximo que admite el sistema ($ 99.999.999,99).");
        }
        const okCount = p.concept === "fees"
          ? Number.isInteger(p.n) && p.n >= 1 && p.n <= MAX_FEES_PER_PAYMENT
          : p.n === 0;
        if (!okCount) throw new TreasuryError(M.count);
      }
      const memberIds = [...new Set(input.parts.map((p) => p.memberId))].sort((a, b) => a - b);
      const withMembers = <T>(ids: number[], fn: () => Promise<T>): Promise<T> =>
        ids.length === 0 ? fn() : memberMutex.run(`member:${ids[0]}`, () => withMembers(ids.slice(1), fn));
      return memberMutex.run(`unmatched:${input.rowId}`, () => withMembers(memberIds, () => registerSplitCore(input, false)));
    },
```

- [ ] **Step 6: Verificar**

Run:

```bash
npm test -- tests/treasury-split.test.ts tests/treasury-service.test.ts tests/treasury-split-group.test.ts
npx tsc --noEmit
```

Expected: PASS. Si `tsc` se queja de `loadGroup(tx, …)` por el tipo del cliente de transacción, cambiar el parámetro de `loadGroup` a `db: Pick<PrismaClient, "payment"> | TxLike`-compatible: `Pick<Prisma.TransactionClient, "payment">` sirve para los dos (el `PrismaClient` lo satisface estructuralmente).

- [ ] **Step 7: Verificación por mutación (obligatoria)**

Una por una, comentar en `service.ts` y ver el test en rojo, después restaurar:
1. la línea `if (partsCents !== cents(group.totals.unassigned)) throw new TreasuryError(M.changed);` → rojo en "el grupo cambió…";
2. `if (updated.count !== 1) throw …` → cambiar el `where` a `{ id: row.id }` → rojo en "la fila se resolvió entre la foto y el lock";
3. quitar `status: { in: ["open", "partial"] }` → mismo rojo;
4. cambiar el orden para pedir el número ANTES de la fila → rojo en la aserción `indexOf("row-update") < indexOf("seq")`.

Run: `npm test -- tests/treasury-split.test.ts` después de cada mutación y después de restaurar (verde).

- [ ] **Step 8: Commit**

```bash
git add src/lib/treasury/service.ts src/lib/treasury/split-preview.ts tests/helpers/split-fake-db.ts tests/treasury-split.test.ts
git commit -m "feat(treasury): registerSplitPayment — split an inbox payment among members in one transaction (holder first, receipts last, row locked)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Anulación y reembolso por grupo

**Files:**
- Modify: `src/lib/treasury/service.ts` (`revertCore`, `refundPayment`)
- Modify: `src/lib/mp/webhook-processor.ts:624` (sólo `parts` en el detalle del asiento)
- Modify: `tests/treasury-service.test.ts` — **sólo el fake** (`payment.findMany` nuevo; `receipt.findFirst` acepta `where.paymentId`); ninguna aserción
- Test: `tests/treasury-split.test.ts` (describe nuevo)

**Interfaces:**
- Consumes: `revertCore` existente; `payment.findMany` con `{ OR: [{ id }, { splitOfPaymentId }], status: "applied" }`.
- Produces: `refundPayment` devuelve `{ kind: "refunded"; paymentId; number; periodsReverted; parts: number }` (campo `parts` aditivo). La reapertura de la fila es **por grupo**: `open` si no queda ninguna parte `applied`, `partial` si queda alguna.

- [ ] **Step 1: Extender el fake de `tests/treasury-service.test.ts` (sin tocar aserciones)**

En `fakeDb`, dentro de `tx.payment`, agregar después de `findUnique`:

```ts
      // Reparto (spec 2026-09-10): la reversión y el reembolso miran el GRUPO
      // del cobro (portador + partes) para decidir si la fila vuelve a `open`
      // o queda `partial`. Honra `OR` y `status`, como la base.
      findMany: vi.fn(async (args: {
        where: { OR?: Array<{ id?: number; splitOfPaymentId?: number }>; splitOfPaymentId?: number; status?: string };
      }) =>
        state.payments.filter((p) => {
          if (args.where.OR && !args.where.OR.some((c) =>
            (c.id !== undefined && p.id === c.id)
            || (c.splitOfPaymentId !== undefined && p.splitOfPaymentId === c.splitOfPaymentId))) return false;
          if (args.where.splitOfPaymentId !== undefined && p.splitOfPaymentId !== args.where.splitOfPaymentId) return false;
          if (args.where.status !== undefined && p.status !== args.where.status) return false;
          return true;
        })),
```

Y en `tx.receipt.findFirst`, reemplazar la implementación por una que acepte las dos formas:

```ts
      findFirst: vi.fn(async (args: { where: { payment?: { mpPaymentId: string }; paymentId?: number } }) => {
        const pid = args.where.paymentId
          ?? state.payments.find((x) => x.mpPaymentId === args.where.payment?.mpPaymentId)?.id;
        const r = pid === undefined ? undefined : state.receipts.find((x) => x.paymentId === pid);
        return r ? receiptWithPayment(r) : null;
      }),
```

Run: `npm test -- tests/treasury-service.test.ts` → sigue PASS (el fake nuevo no cambia nada todavía). `git diff tests/treasury-service.test.ts` muestra sólo esas dos zonas.

- [ ] **Step 2: Escribir los tests del grupo (fallan)**

Agregar al final de `tests/treasury-split.test.ts`:

```ts
describe("anulación y reembolso por grupo (spec §5.3, §5.4)", () => {
  async function splitted() {
    const fake = splitFakeDb({ members: [hugo, monica], fees: FEES, rows: [row()] });
    const svc = svcOn(fake);
    const r = await svc.registerSplitPayment({ rowId: 5, actorId: 9, parts: twoPlusOne });
    if (r.kind !== "registered") throw new Error(r.kind);
    return { fake, svc, parts: r.parts };
  }

  it("anular UNA parte deja la fila partial, con el portador como puntero, y la otra parte intacta", async () => {
    const { fake, svc, parts } = await splitted();
    await svc.voidReceipt({ receiptId: parts[1].receiptId, actorId: 9, reason: "no era de Mónica" });
    expect(fake.state.payments[1].status).toBe("voided");
    expect(fake.state.payments[0].status).toBe("applied");
    expect(fake.state.fees.filter((f) => f.memberId === 193)[0]).toMatchObject({ status: "pending", paymentId: null });
    expect(fake.state.fees.filter((f) => f.memberId === 192).every((f) => f.status === "paid")).toBe(true);
    expect(fake.state.rows[0]).toMatchObject({ status: "partial", paymentId: 1, resolvedById: 9 });
    expect(fake.mocks.mpUnmatchedPayment.updateMany).toHaveBeenLastCalledWith({
      where: { paymentId: 1, status: "matched" }, data: { status: "partial" },
    });
  });

  it("anular el PORTADOR con una parte viva también deja partial (el puntero no cambia)", async () => {
    const { fake, svc, parts } = await splitted();
    await svc.voidReceipt({ receiptId: parts[0].receiptId, actorId: 9, reason: "error" });
    expect(fake.state.rows[0]).toMatchObject({ status: "partial", paymentId: 1 });
    expect(fake.state.payments[0]).toMatchObject({ status: "voided", mpPaymentId: "mp-18k" });
  });

  it("anular la última parte aplicada devuelve la fila a open, exactamente como hoy", async () => {
    const { fake, svc, parts } = await splitted();
    await svc.voidReceipt({ receiptId: parts[1].receiptId, actorId: 9, reason: "a" });
    await svc.voidReceipt({ receiptId: parts[0].receiptId, actorId: 9, reason: "b" });
    expect(fake.state.rows[0]).toMatchObject({ status: "open", paymentId: null, resolvedAt: null, resolvedById: null });
    expect(fake.mocks.mpUnmatchedPayment.updateMany).toHaveBeenLastCalledWith({
      where: { paymentId: 1 }, data: { status: "open", paymentId: null, resolvedAt: null, resolvedById: null },
    });
    // El portador anulado conserva el id de MP: la barrera contra el reenvío no se toca.
    expect(fake.state.payments[0].mpPaymentId).toBe("mp-18k");
  });

  it("anular una parte y volver a asignar el resto cierra la fila otra vez", async () => {
    const { fake, svc, parts } = await splitted();
    await svc.voidReceipt({ receiptId: parts[1].receiptId, actorId: 9, reason: "no era" });
    fake.state.fees.push({ id: 30, memberId: 200, period: "2026-08", status: "pending", origin: "import", paymentId: null });
    (fake.mocks as { member: { findUnique: ReturnType<typeof vi.fn> } }).member.findUnique.mockImplementation(
      async (a: { where: { id: number } }) => [hugo, monica, carlos].find((m) => m.id === a.where.id) ?? null,
    );
    const r = await svc.registerSplitPayment({ rowId: 5, actorId: 9, parts: [{ memberId: 200, concept: "fees", n: 1, amount: 6000 }] });
    expect(r.kind).toBe("registered");
    expect(fake.state.payments[2]).toMatchObject({ memberId: 200, splitOfPaymentId: 1, status: "applied" });
    expect(fake.state.rows[0]).toMatchObject({ status: "matched", paymentId: 1 });
    expect(fake.state.receipts.map((x) => x.number)).toEqual(["2026-00001", "2026-00002", "2026-00003"]);
  });

  it("reembolso de MP: revierte TODAS las partes aplicadas, suma los períodos, reabre la fila, y el reintento da already_reverted", async () => {
    const { fake, svc } = await splitted();
    const r = await svc.refundPayment({ mpPaymentId: "mp-18k", reason: "Reembolso en Mercado Pago" });
    expect(r).toEqual({ kind: "refunded", paymentId: 1, number: "2026-00001", periodsReverted: 3, parts: 2 });
    expect(fake.state.payments.map((p) => p.status)).toEqual(["refunded", "refunded"]);
    expect(fake.state.receipts.every((x) => x.voidedAt instanceof Date && x.voidedById === null)).toBe(true);
    expect(fake.state.fees.every((f) => f.status === "pending" && f.paymentId === null)).toBe(true);
    expect(fake.state.rows[0]).toMatchObject({ status: "open", paymentId: null });
    expect(await svc.refundPayment({ mpPaymentId: "mp-18k", reason: "x" })).toEqual({ kind: "already_reverted", status: "refunded" });
  });

  it("reembolso con el portador ya anulado desde el mostrador: revierte la parte que seguía viva", async () => {
    const { fake, svc, parts } = await splitted();
    await svc.voidReceipt({ receiptId: parts[0].receiptId, actorId: 9, reason: "error" });
    const r = await svc.refundPayment({ mpPaymentId: "mp-18k", reason: "Reembolso en Mercado Pago" });
    expect(r).toMatchObject({ kind: "refunded", paymentId: 1, number: "2026-00002", periodsReverted: 1, parts: 1 });
    expect(fake.state.payments.map((p) => p.status)).toEqual(["voided", "refunded"]);
    expect(fake.state.rows[0].status).toBe("open");
  });

  it("reembolso de un cobro desconocido: not_found", async () => {
    const { svc } = await splitted();
    expect(await svc.refundPayment({ mpPaymentId: "nope", reason: "x" })).toEqual({ kind: "not_found" });
  });
});
```

- [ ] **Step 3: Correr y ver el rojo**

Run: `npm test -- tests/treasury-split.test.ts`
Expected: FAIL en los `it` de partial (hoy la anulación de una parte reabre la fila entera por `paymentId`, que para la parte 2 no matchea nada) y en el reembolso (`parts` ausente; sólo revierte el portador).

- [ ] **Step 4: `revertCore` por grupo**

En `revertCore`, reemplazar el bloque que empieza en `// Regla de la bandeja (deuda anotada en 4A): una fila nunca apunta a un` y termina en el `updateMany` de reapertura, por:

```ts
        // Regla de la bandeja, ahora por GRUPO (spec 2026-09-10 §5.3): la fila
        // se decide por el cobro de MP entero —portador + partes—, no por este
        // pago solo. Si no queda ninguna parte aplicada, vuelve a `open` con el
        // MISMO statement de siempre (para un pago suelto, el portador es él
        // mismo, y un efectivo de mostrador se comporta idéntico); si queda
        // alguna, pasa a `partial` y el puntero sigue en el portador. Va DENTRO
        // de la transacción: si la reversión se cae, la fila queda como estaba.
        const holderId = r.payment.splitOfPaymentId ?? r.payment.id;
        const stillApplied = await tx.payment.findMany({
          where: { OR: [{ id: holderId }, { splitOfPaymentId: holderId }], status: "applied" },
          select: { id: true },
        });
        if (stillApplied.length === 0) {
          await tx.mpUnmatchedPayment.updateMany({
            where: { paymentId: holderId },
            data: { status: "open", paymentId: null, resolvedAt: null, resolvedById: null },
          });
        } else {
          await tx.mpUnmatchedPayment.updateMany({
            where: { paymentId: holderId, status: "matched" },
            data: { status: "partial" },
          });
        }
```

El `include` del `findUnique` del recibo (dentro del mutex) tiene que traer `splitOfPaymentId`: ya viene, porque `payment` se incluye entero (`include: { payment: { include: { fees: … } } }`); en el fake es `undefined` para un pago viejo y el `??` lo resuelve a `r.payment.id`.

- [ ] **Step 5: `refundPayment` por grupo**

Reemplazar el método entero por:

```ts
    /** Reembolso o contracargo en Mercado Pago. No hay operador detrás
     *  (`voidedById` queda en null) y el cobro se busca por el id de MP, que es
     *  lo único que trae el webhook. Por GRUPO (spec 2026-09-10 §5.4): revierte
     *  el portador y todas las partes que sigan aplicadas, cada una con su mutex
     *  y su transacción. Idempotente por parte: si falla a mitad, el reintento
     *  de MP revierte lo que faltaba y devuelve `already_reverted` cuando ya no
     *  queda nada. */
    async refundPayment(input: { mpPaymentId: string; reason: string }): Promise<
      | { kind: "refunded"; paymentId: number; number: string; periodsReverted: number; parts: number }
      | { kind: "not_found" }
      | { kind: "already_reverted"; status: "refunded" | "voided" }
    > {
      const holder = await db.payment.findUnique({
        where: { mpPaymentId: input.mpPaymentId },
        select: { id: true, status: true },
      });
      if (!holder) return { kind: "not_found" };
      const applied = await db.payment.findMany({
        where: { OR: [{ id: holder.id }, { splitOfPaymentId: holder.id }], status: "applied" },
        select: { id: true },
        orderBy: { id: "asc" },
      });
      if (applied.length === 0) {
        return { kind: "already_reverted", status: holder.status === "voided" ? "voided" : "refunded" };
      }
      let periodsReverted = 0;
      let number: string | null = null;
      let reverted = 0;
      for (const p of applied) {
        const receipt = await db.receipt.findFirst({ where: { paymentId: p.id }, select: { id: true } });
        if (!receipt) continue;
        const done = await revertCore({ receiptId: receipt.id, status: "refunded", actorId: null, reason: input.reason });
        periodsReverted += done.periodsReverted;
        number ??= done.number;
        reverted += 1;
      }
      if (number === null) return { kind: "not_found" };
      return { kind: "refunded", paymentId: holder.id, number, periodsReverted, parts: reverted };
    },
```

- [ ] **Step 6: El asiento del webhook suma `parts`**

`src/lib/mp/webhook-processor.ts:624`, el `detail` del asiento `payment_refunded` queda:

```ts
detail: { paymentId: r.paymentId, mpPaymentId: p.id, status: p.status, periodsReverted: r.periodsReverted, parts: r.parts }
```

(Es el ÚNICO cambio en `src/lib/mp/*`. El mock de `tests/mp-webhook-processor.test.ts:62` no trae `parts`; la aserción de la línea 281 es `objectContaining` y sigue verde.)

- [ ] **Step 7: Verificar**

Run:

```bash
npm test -- tests/treasury-split.test.ts tests/treasury-service.test.ts tests/mp-webhook-processor.test.ts
npx tsc --noEmit
git diff --stat -- tests/treasury-service.test.ts
```

Expected: PASS; el diff del test viejo es sólo el fake (≈ 25 líneas, sin `expect`).

Mutación obligatoria: quitar `status: "applied"` del `findMany` de `revertCore` → rojo en "anular la última parte aplicada devuelve la fila a open" (el portador anulado seguiría contando). Restaurar.

- [ ] **Step 8: Commit**

```bash
git add src/lib/treasury/service.ts src/lib/mp/webhook-processor.ts tests/treasury-service.test.ts tests/treasury-split.test.ts
git commit -m "feat(treasury): group-aware void (partial rows) and refund (all applied parts)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Leyenda de pago compartido en PDF y email; etiqueta "Mercado Pago"

**Files:**
- Modify: `src/lib/treasury/labels.ts:8`
- Modify: `src/lib/treasury/receipt-pdf.ts` (`ReceiptPdfData.sharedPayment`, render)
- Modify: `src/lib/treasury/service.ts` (`pdfDataFor`)
- Modify: `src/lib/treasury/receipt-email.ts` (select + `sharedPayment`)
- Modify: `src/lib/email/templates.ts:468-491` (`receiptEmail`)
- Test: `tests/treasury-receipt-pdf.test.ts`, `tests/email.test.ts` (línea 155 y 274), `tests/treasury-receipt-email.test.ts`

**Interfaces:**
- Consumes: `sharedPaymentOf` (Task 2).
- Produces: `ReceiptPdfData.sharedPayment?: { total: number; paidAt: Date }`; `receiptEmail({ …, sharedPayment?: { total: number; paidAt: Date } })`; `PAYMENT_TYPE_LABELS.link === "Mercado Pago"`.

- [ ] **Step 1: Tests (fallan)**

`tests/email.test.ts`, línea 274: cambiar `expect(m.text).toContain("Link de pago");` por `expect(m.text).toContain("Mercado Pago");`. Y después del `it("receiptEmail nombra número, concepto y monto…")` agregar:

```ts
  // Reparto de un cobro de MP (spec 2026-09-10): el recibo de cada socio sale
  // por SU parte, y el correo tiene que explicar por qué dice $ 6.000 si el
  // vecino transfirió $ 18.000. Sin `sharedPayment`, ni una palabra de más.
  it("receiptEmail con sharedPayment agrega la leyenda del pago compartido; sin él, no", () => {
    const con = receiptEmail({
      name: "Ana", number: "2026-00012", concept: "Cuota social · agosto 2026", amount: 6000,
      sharedPayment: { total: 18000, paidAt: new Date("2026-09-08T15:00:00Z") },
    });
    expect(con.text).toContain("parte de un pago de $ 18.000,00 cobrado por Mercado Pago el 08/09/2026");
    expect(con.html).toContain("parte de un pago de $ 18.000,00");
    const sin = receiptEmail({ name: "Ana", number: "2026-00012", concept: "Cuota social · agosto 2026", amount: 6000 });
    expect(sin.text).not.toContain("parte de un pago");
  });
```

`tests/treasury-receipt-pdf.test.ts`, al final del `describe("renderReceiptPdf", …)`:

```ts
  // Reparto (spec 2026-09-10): la leyenda sólo con `sharedPayment`; sin él, el
  // dato del recibo de siempre produce el mismo pie.
  it("con sharedPayment dibuja la leyenda del pago compartido y empuja el motivo de anulación 12 pt", async () => {
    const base = {
      number: "2026-00012", issuedAt: new Date("2026-09-08T15:00:00Z"),
      memberName: "Maza Monica", memberNumber: 193,
      concept: "Cuota social · agosto 2026", methodLabel: "Mercado Pago", amount: 6000,
      voided: { reason: "no era de ella" },
    } as const;
    const sin = await drawnText(await renderReceiptPdf(base));
    const con = await drawnText(await renderReceiptPdf({
      ...base, sharedPayment: { total: 18000, paidAt: new Date("2026-09-08T15:00:00Z") },
    }));
    const all = (texts: Drawn[]) => texts.map((t) => t.text).join(" ");
    expect(all(con)).toContain("Parte de un pago de $ 18.000,00 cobrado por Mercado Pago el 08/09/2026.");
    expect(all(sin)).not.toContain("Parte de un pago");
    expect(yOf(sin, "Anulado: no era de ella") - yOf(con, "Anulado: no era de ella")).toBe(12);
  });
```

`tests/treasury-receipt-email.test.ts`: en `setup`, el `payment` del recibo gana `mpPaymentId: null, splitOfPaymentId: null, splitParts: []` (el select real los pide), y agregar un test:

```ts
  it("una parte de un reparto lleva la leyenda del pago compartido en el correo", async () => {
    const s = setup({ email: "ana@x.com", emailStatus: "declared" });
    // La parte: 6.000 de un cobro de 18.000 cuyo portador es el pago 1.
    Object.assign(s.receipt.payment, { amount: "6000.00", mpPaymentId: null, splitOfPaymentId: 1, splitParts: [] });
    const db = s.db as unknown as Record<string, unknown>;
    db.payment = { findUnique: vi.fn(async () => ({ mpPaymentId: "mp-18k" })) };
    db.mpUnmatchedPayment = {
      findUnique: vi.fn(async () => ({ id: 5, amount: "18000.00", paidAt: new Date("2026-09-08T15:00:00Z") })),
    };
    expect(await s.emailer.sendReceiptEmail(7)).toEqual({ sent: true });
    expect(s.mailer.sendToMember.mock.calls[0][0].message.text).toContain("parte de un pago de $ 18.000,00");
  });
```

Run: `npm test -- tests/email.test.ts tests/treasury-receipt-pdf.test.ts tests/treasury-receipt-email.test.ts` → FAIL (leyenda ausente, "Link de pago" todavía).

- [ ] **Step 2: Etiqueta**

`src/lib/treasury/labels.ts`:

```ts
  // "Mercado Pago" y no "Link de pago" (decisión 10, 10/09/2026): la bandeja
  // asienta con este tipo también las TRANSFERENCIAS al CVU, y el recibo tiene
  // que decir por dónde entró la plata sin afirmar un medio que no fue. El
  // gateway no lee `payment_type_id`, así que no hay forma de distinguirlos.
  link: "Mercado Pago",
```

- [ ] **Step 3: PDF**

`src/lib/treasury/receipt-pdf.ts`: en `ReceiptPdfData`, después de `admissionPending`:

```ts
  /** Parte de un cobro de MP repartido entre socios (spec 2026-09-10 §7): el
   *  total y la fecha del cobro. Sin contar socios, para que el texto no
   *  envejezca. Ausente → el pie de siempre. */
  sharedPayment?: { total: number; paidAt: Date };
```

Y después del bloque `if (data.admissionPending) { … }`, antes de `if (data.voided)`:

```ts
  if (data.sharedPayment) {
    // El vecino transfirió $ 18.000 y su recibo dice $ 6.000: esta línea es lo
    // que lo explica sin que tenga que llamar a la sede.
    y -= 12;
    page.drawText(
      safe(`Parte de un pago de ${formatARS(data.sharedPayment.total)} cobrado por Mercado Pago el ${formatDateAR(data.sharedPayment.paidAt)}.`),
      { x: margin, y, size: 8, font, color: MUTED },
    );
  }
```

- [ ] **Step 4: `pdfDataFor` arma la leyenda**

En `service.ts`, agregar `import { …, sharedPaymentOf } from "./split-group";` (junto a los otros de ese módulo). En `pdfDataFor`, el `include` del `payment` suma:

```ts
            application: { select: { fullName: true } },
            // Reparto: con esto `sharedPaymentOf` sabe si hay partes sin otra consulta.
            splitParts: { select: { id: true } },
```

y antes del `return`:

```ts
    const shared = await sharedPaymentOf(db, {
      amount: Number(r.payment.amount),
      mpPaymentId: r.payment.mpPaymentId ?? null,
      splitOfPaymentId: r.payment.splitOfPaymentId ?? null,
      hasParts: (r.payment.splitParts ?? []).length > 0,
    });
```

y en el objeto devuelto, después de la línea de `admissionPending`:

```ts
      // Misma regla: se OMITE cuando no aplica, para que el dato del recibo de
      // siempre siga byte-idéntico.
      ...(shared ? { sharedPayment: { total: shared.total, paidAt: shared.paidAt } } : {}),
```

- [ ] **Step 5: Email**

`src/lib/email/templates.ts`, `receiptEmail`: agregar al tipo de `opts`:

```ts
  /** Parte de un cobro de MP repartido (spec 2026-09-10): total y fecha del cobro. */
  sharedPayment?: { total: number; paidAt: Date };
```

y en el cuerpo, después de `const admission = …`:

```ts
  const shared = opts.sharedPayment
    ? `\n\nEste recibo es parte de un pago de ${formatARS(opts.sharedPayment.total)} cobrado por Mercado Pago el ${formatDateAR(opts.sharedPayment.paidAt)}.`
    : "";
```

En `text`, cambiar `Importe: ${amount}${admission}` por `Importe: ${amount}${admission}${shared}`. En `html`, después del `<p>` de admisión agregar `${opts.sharedPayment ? `\n<p>${esc(shared.trim())}</p>` : ""}`. (`formatDateAR` ya está importado en `templates.ts`; si no, importarlo de `@/lib/format`.)

`src/lib/treasury/receipt-email.ts`: el tipo de `deps.db` pasa a `Pick<PrismaClient, "receipt" | "payment" | "mpUnmatchedPayment">`; el `include` del `payment` suma `splitParts: { select: { id: true } }` (los escalares `amount`, `mpPaymentId`, `splitOfPaymentId` ya vienen porque es `include`); antes de armar `message`:

```ts
        const shared = await sharedPaymentOf(deps.db, {
          amount: Number(r.payment.amount),
          mpPaymentId: r.payment.mpPaymentId ?? null,
          splitOfPaymentId: r.payment.splitOfPaymentId ?? null,
          hasParts: (r.payment.splitParts ?? []).length > 0,
        });
```

y `receiptEmail({ …, admissionPending: …, ...(shared ? { sharedPayment: { total: shared.total, paidAt: shared.paidAt } } : {}) })`. Import: `import { sharedPaymentOf } from "./split-group";`.

- [ ] **Step 6: Verificar**

Run: `npm test -- tests/email.test.ts tests/treasury-receipt-pdf.test.ts tests/treasury-receipt-email.test.ts tests/treasury-service.test.ts tests/treasury-split.test.ts && npx tsc --noEmit`
Expected: PASS. En `tests/treasury-split.test.ts` el reparto 2+1 renderiza dos PDFs: `renderPdf` se llamó con `sharedPayment: { total: 18000, paidAt: PAID_AT }` en los dos (agregar esa aserción al `it` del reparto: `expect(renderPdf).toHaveBeenNthCalledWith(1, expect.objectContaining({ sharedPayment: { total: 18000, paidAt: PAID_AT } }))`).

- [ ] **Step 7: Commit**

```bash
git add src/lib/treasury/labels.ts src/lib/treasury/receipt-pdf.ts src/lib/treasury/service.ts src/lib/treasury/receipt-email.ts src/lib/email/templates.ts tests/email.test.ts tests/treasury-receipt-pdf.test.ts tests/treasury-receipt-email.test.ts tests/treasury-split.test.ts
git commit -m "feat(treasury): shared-payment legend on receipt PDF and email; link payments labelled \"Mercado Pago\"

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: La action en dos pasos — token, vista previa, importes con centavos, sugerencia por casilla

**Files:**
- Create: `src/lib/treasury/ars-input.ts`
- Modify: `src/lib/treasury/split-preview.ts` (suma `splitConfirmToken`, `previewSplit`)
- Modify: `src/lib/treasury/member-search.ts` (suma `membersByEmail`)
- Modify: `src/app/admin/tesoreria/sin-conciliar/[id]/actions.ts` (reescribe `resolveUnmatchedAction`; `dismiss` y `otherIncome` intactas)
- Test: `tests/treasury-ars-input.test.ts`, `tests/treasury-split-preview.test.ts`, `tests/treasury-member-search.test.ts` (crear si no existe), `tests/unmatched-actions-auth.test.ts` (reescribe el `describe("resolveUnmatchedAction")`)

**Interfaces:**
- Produces:
  - `parseArsInput(raw: string): number | null` (`"18000"` → 18000; `"18000,5"` → 18000.5; con punto o más de 2 decimales → `null`), `arsInputClean(v: string): string` (dígitos y una sola coma, ≤ 2 decimales), `formatArsInput(n: number): string` (`18000.5` → `"18000,50"`, `18000` → `"18000"`).
  - `splitConfirmToken(rowId: number, parts: SplitPartPlan[]): string` — `"5|192:fees:2:1200000,193:fees:1:600000"` (importes en centavos, ordenado por socio).
  - `previewSplit(db: Pick<PrismaClient, "member" | "fee" | "movement">, parts: SplitPartPlan[]): Promise<SplitPreviewPart[]>` con `SplitPreviewPart = { memberId; name; memberNumber: number | null; concept: string; amount: number }`.
  - `membersByEmail(db: Pick<PrismaClient, "membership">, email: string): Promise<MemberHit[]>` (libro abierto, hasta `MAX_SPLIT_PARTS`).
  - `resolveUnmatchedAction(prev: State, formData): Promise<State>` con `State = { error?; kind?: "error" | "warning"; receipt?: { id; number }; income?: { id }; confirm?: { token: string; total: number; parts: SplitPreviewPart[] } }`. FormData: `rowId`, `socios` ("192,193"), `note?`, `confirmar?` ("1"), `confirmToken?`, y por socio `part_<id>_concept` (`fees|voluntary|extraordinary`), `part_<id>_count` (sólo `fees`), `part_<id>_amount` (formato `parseArsInput`). Redirect de éxito: `/admin/tesoreria/sin-conciliar/{rowId}?emitidos={n}&email={a,b,...}` (un `ReceiptEmailOutcome` por parte, en orden).

- [ ] **Step 1: Tests puros (fallan)**

`tests/treasury-ars-input.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { arsInputClean, formatArsInput, parseArsInput } from "@/lib/treasury/ars-input";

// Los importes de las partes vienen de Mercado Pago y PUEDEN traer centavos
// (`Decimal(10,2)`), así que este campo es el único del panel que acepta coma:
// coma = decimales, siempre; el punto no entra, para no tener que adivinar si
// "2.500" son dos mil quinientos o dos con cinco.
describe("parseArsInput", () => {
  it("enteros y hasta dos decimales con coma", () => {
    expect(parseArsInput("18000")).toBe(18000);
    expect(parseArsInput(" 18000,5 ")).toBe(18000.5);
    expect(parseArsInput("0,01")).toBe(0.01);
  });
  it("rechaza puntos, tres decimales, vacío y letras", () => {
    expect(parseArsInput("18.000")).toBeNull();
    expect(parseArsInput("1,234")).toBeNull();
    expect(parseArsInput("")).toBeNull();
    expect(parseArsInput("abc")).toBeNull();
    expect(parseArsInput("123456789")).toBeNull(); // más de 8 enteros: supera el tipo
  });
});
describe("arsInputClean", () => {
  it("deja dígitos y UNA coma con dos decimales como mucho", () => {
    expect(arsInputClean("18.000,505")).toBe("18000,50");
    expect(arsInputClean("1,2,3")).toBe("1,23");
    expect(arsInputClean("abc12")).toBe("12");
  });
});
describe("formatArsInput", () => {
  it("es la inversa de parseArsInput", () => {
    expect(formatArsInput(18000)).toBe("18000");
    expect(formatArsInput(18000.5)).toBe("18000,50");
    expect(parseArsInput(formatArsInput(6000.07))).toBe(6000.07);
  });
});
```

`tests/treasury-split-preview.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { civilDateUtc } from "@/lib/dates";
import { previewSplit, splitConfirmToken, splitPartGuards } from "@/lib/treasury/split-preview";
import { SPLIT_GUARD_MESSAGES as M } from "@/lib/treasury/split-messages";

describe("splitConfirmToken", () => {
  it("es la huella del reparto: fila, socio, concepto, cuotas e importe en centavos, ordenado por socio", () => {
    const t = splitConfirmToken(5, [
      { memberId: 193, concept: "fees", n: 1, amount: 6000 },
      { memberId: 192, concept: "fees", n: 2, amount: 12000.5 },
    ]);
    expect(t).toBe("5|192:fees:2:1200050,193:fees:1:600000");
  });
  it("cambia si cambia cualquier parte", () => {
    const a = splitConfirmToken(5, [{ memberId: 192, concept: "fees", n: 2, amount: 12000 }]);
    expect(splitConfirmToken(5, [{ memberId: 192, concept: "fees", n: 1, amount: 12000 }])).not.toBe(a);
    expect(splitConfirmToken(5, [{ memberId: 192, concept: "voluntary", n: 0, amount: 12000 }])).not.toBe(a);
    expect(splitConfirmToken(6, [{ memberId: 192, concept: "fees", n: 2, amount: 12000 }])).not.toBe(a);
  });
});

function fakeDb(opts: {
  members: Array<{ id: number; fullName: string; category: string; status: string; joinedAt: Date; memberNumber: number | null }>;
  fees: Array<{ memberId: number; period: string; status: string }>;
  exemptions?: Array<{ memberId: number; toPeriod: string; minute: { type: string; number: number } }>;
  readmittedAt?: Record<number, Date>;
}) {
  return {
    member: {
      findUnique: vi.fn(async (a: { where: { id: number } }) => {
        const m = opts.members.find((x) => x.id === a.where.id);
        if (!m) return null;
        const { memberNumber, ...rest } = m;
        return { ...rest, memberships: memberNumber === null ? [] : [{ memberNumber, book: { status: "open" } }] };
      }),
    },
    fee: {
      findMany: vi.fn(async (a: { where: { memberId: number } }) => opts.fees.filter((f) => f.memberId === a.where.memberId)),
      count: vi.fn(async (a: { where: { memberId: number; status: string } }) =>
        opts.fees.filter((f) => f.memberId === a.where.memberId && f.status === a.where.status).length),
    },
    movement: {
      findFirst: vi.fn(async (a: { where: { memberId: number } }) => {
        const d = opts.readmittedAt?.[a.where.memberId];
        return d ? { date: d } : null;
      }),
    },
    feeExemption: {
      findFirst: vi.fn(async (a: { where: { memberId: number } }) => {
        const e = (opts.exemptions ?? []).find((x) => x.memberId === a.where.memberId);
        return e ? { id: 1, fromPeriod: "2026-09", months: 4, minuteId: 3, note: null, ...e } : null;
      }),
    },
  };
}
const JOINED = civilDateUtc(2015, 3, 1);

describe("previewSplit", () => {
  it("resuelve nombre, número y el MISMO concepto que va a decir el recibo (las más viejas primero)", async () => {
    const db = fakeDb({
      members: [
        { id: 192, fullName: "Araoz Hugo", category: "active", status: "active", joinedAt: JOINED, memberNumber: 192 },
        { id: 193, fullName: "Maza Monica", category: "active", status: "active", joinedAt: JOINED, memberNumber: null },
      ],
      fees: [
        { memberId: 192, period: "2026-07", status: "pending" }, { memberId: 192, period: "2026-08", status: "pending" },
        { memberId: 192, period: "2026-06", status: "paid" },
      ],
    });
    const p = await previewSplit(db as never, [
      { memberId: 192, concept: "fees", n: 2, amount: 12000 },
      { memberId: 193, concept: "voluntary", n: 0, amount: 6000 },
    ]);
    expect(p).toEqual([
      { memberId: 192, name: "Araoz Hugo", memberNumber: 192, concept: "Cuota social · julio a agosto 2026 (2 cuotas)", amount: 12000 },
      { memberId: 193, name: "Maza Monica", memberNumber: null, concept: "Aporte voluntario", amount: 6000 },
    ]);
  });
  it("un socio al día: los períodos que se CREAN salen del piso de cobertura, con el reingreso", async () => {
    const db = fakeDb({
      members: [{ id: 7, fullName: "Vuelve Juan", category: "active", status: "active", joinedAt: civilDateUtc(2019, 1, 1), memberNumber: 7 }],
      fees: [],
      readmittedAt: { 7: civilDateUtc(2026, 10, 5) },
    });
    const p = await previewSplit(db as never, [{ memberId: 7, concept: "fees", n: 2, amount: 12000 }]);
    // `coverageFloor`: el piso es el MÁS NUEVO entre la foto del padrón (sep 2026),
    // el mes siguiente al alta y el mes siguiente al reingreso (el mes del reingreso
    // lo cubre la cuota de reingreso, REG-14). Con reingreso en octubre, noviembre.
    expect(p[0].concept).toBe("Cuota social · noviembre a diciembre 2026 (2 cuotas)");
  });
  it("un socio inexistente tira: la action ya lo filtró con splitPartGuards", async () => {
    await expect(previewSplit(fakeDb({ members: [], fees: [] }) as never, [{ memberId: 1, concept: "fees", n: 1, amount: 1 }]))
      .rejects.toThrow(M.memberGone);
  });
});

describe("splitPartGuards", () => {
  const base = { fullName: "X", joinedAt: JOINED, memberNumber: 1 };
  it("pasa con activos y conceptos de su categoría", async () => {
    const db = fakeDb({ members: [{ id: 1, category: "active", status: "active", ...base }], fees: [] });
    expect(await splitPartGuards(db as never, [{ memberId: 1, concept: "fees", n: 1, amount: 6000 }])).toBeNull();
  });
  it("adherente con cuotas, cesante con aporte, cesante con más cuotas que pendientes, exento con cuotas", async () => {
    const db = fakeDb({
      members: [
        { id: 1, category: "adherent", status: "active", ...base },
        { id: 2, category: "active", status: "withdrawn", ...base },
        { id: 3, category: "active", status: "active", ...base },
      ],
      fees: [{ memberId: 2, period: "2026-05", status: "pending" }],
      exemptions: [{ memberId: 3, toPeriod: "2026-12", minute: { type: "board", number: 124 } }],
    });
    expect(await splitPartGuards(db as never, [{ memberId: 1, concept: "fees", n: 1, amount: 1 }])).toBe(M.conceptCategory);
    expect(await splitPartGuards(db as never, [{ memberId: 2, concept: "voluntary", n: 0, amount: 1 }])).toBe(M.withdrawnConcept);
    expect(await splitPartGuards(db as never, [{ memberId: 2, concept: "fees", n: 2, amount: 1 }])).toBe(M.withdrawnCount(1));
    expect(await splitPartGuards(db as never, [{ memberId: 3, concept: "fees", n: 1, amount: 1 }])).toContain("eximido");
    expect(await splitPartGuards(db as never, [{ memberId: 3, concept: "voluntary", n: 0, amount: 1 }])).toBeNull();
    expect(await splitPartGuards(db as never, [{ memberId: 9, concept: "fees", n: 1, amount: 1 }])).toBe(M.memberGone);
  });
});
```

`tests/treasury-member-search.test.ts` (si el archivo ya existe con otro nombre para `searchMembers`, agregar el `describe` ahí):

```ts
import { describe, expect, it, vi } from "vitest";
import { membersByEmail } from "@/lib/treasury/member-search";

describe("membersByEmail", () => {
  it("busca en el libro abierto por la casilla exacta, ordena por número y acota al tope", async () => {
    const findMany = vi.fn(async () => [
      { memberNumber: 192, member: { id: 192, fullName: "Araoz Hugo", dni: "1", category: "active", status: "active" } },
      { memberNumber: 193, member: { id: 193, fullName: "Maza Monica", dni: "2", category: "active", status: "active" } },
    ]);
    const hits = await membersByEmail({ membership: { findMany } } as never, "haraoz@yahoo.com");
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { book: { status: "open" }, member: { email: "haraoz@yahoo.com" } },
      orderBy: { memberNumber: "asc" },
      take: 5,
    }));
    expect(hits.map((h) => h.id)).toEqual([192, 193]);
  });
  it("sin casilla no consulta", async () => {
    const findMany = vi.fn();
    expect(await membersByEmail({ membership: { findMany } } as never, "  ")).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});
```

Run: `npm test -- tests/treasury-ars-input.test.ts tests/treasury-split-preview.test.ts tests/treasury-member-search.test.ts` → FAIL.

- [ ] **Step 2: `ars-input.ts`**

```ts
// El único campo de importe del panel que acepta centavos: los importes de las
// partes de un reparto salen de Mercado Pago (`Decimal(10,2)`) y pueden no ser
// enteros. Regla: coma = decimales, siempre; el punto NO entra. Efectivo y Otros
// ingresos siguen en pesos enteros con `digitsOnly`, y este módulo no los toca.

/** `"18000"` → 18000; `"18000,5"` → 18000.5; punto, tres decimales o basura → null. */
export function parseArsInput(raw: string): number | null {
  const m = /^(\d{1,8})(?:,(\d{1,2}))?$/.exec(raw.trim());
  if (!m) return null;
  return Number(`${m[1]}.${(m[2] ?? "").padEnd(2, "0")}`);
}

/** Limpieza mientras se tipea: dígitos y UNA coma con hasta dos decimales. */
export function arsInputClean(v: string): string {
  const [head, ...rest] = v.replace(/[^\d,]/g, "").split(",");
  return rest.length === 0 ? head : `${head},${rest.join("").slice(0, 2)}`;
}

/** Inversa de `parseArsInput`, para prellenar el campo. */
export function formatArsInput(n: number): string {
  const c = Math.round(n * 100);
  const whole = Math.floor(c / 100);
  const dec = c % 100;
  return dec === 0 ? String(whole) : `${whole},${String(dec).padStart(2, "0")}`;
}
```

- [ ] **Step 3: Token y vista previa en `split-preview.ts`**

Agregar los imports `import { describePeriods, paymentConcept } from "./labels";`, `import { allocate, coverageFloor } from "./rules";` (sumar a la línea existente de `./rules`), `import { cents, INBOX_CONCEPT_TYPE } from "./split-group";` y ampliar el `Pick` de `PrismaClient` del módulo. Después de `splitPartGuards`:

```ts
/** Huella de "esto es exactamente lo que se confirmó": fila + partes ordenadas
 *  por socio, importes en centavos. No es una firma —no hay secreto y no
 *  pretende serlo— sino la guarda contra la deriva, como `arrearsConfirmToken`:
 *  si el operador cambia una cuota después de leer la confirmación, la action
 *  vuelve a pedirla en vez de emitir a ciegas. */
export function splitConfirmToken(rowId: number, parts: SplitPartPlan[]): string {
  const sorted = [...parts].sort((a, b) => a.memberId - b.memberId);
  return `${rowId}|${sorted.map((p) => `${p.memberId}:${p.concept}:${p.n}:${cents(p.amount)}`).join(",")}`;
}

/** Una parte tal como la lee el operador antes de confirmar. `concept` es el
 *  MISMO texto que va a decir el recibo. */
export type SplitPreviewPart = { memberId: number; name: string; memberNumber: number | null; concept: string; amount: number };

/** La vista previa, resuelta en el SERVIDOR contra la base: qué cuotas se
 *  imputan a cada socio (las más viejas primero, y las que se crean desde el
 *  piso de cobertura con el reingreso), con el mismo `allocate` y el mismo
 *  `coverageFloor` que usa el núcleo al asentar. */
export async function previewSplit(
  db: Pick<PrismaClient, "member" | "fee" | "movement">,
  parts: SplitPartPlan[],
): Promise<SplitPreviewPart[]> {
  const out: SplitPreviewPart[] = [];
  for (const p of parts) {
    const member = await db.member.findUnique({
      where: { id: p.memberId },
      select: {
        id: true, fullName: true, joinedAt: true,
        memberships: { select: { memberNumber: true, book: { select: { status: true } } } },
      },
    });
    if (!member) throw new Error(M.memberGone);
    const memberNumber = member.memberships.find((m) => m.book.status === "open")?.memberNumber ?? null;
    const type = INBOX_CONCEPT_TYPE[p.concept];
    let periods: string[] = [];
    if (p.concept === "fees") {
      const [fees, readmission] = await Promise.all([
        db.fee.findMany({ where: { memberId: member.id }, select: { period: true, status: true } }),
        db.movement.findFirst({
          where: { memberId: member.id, type: "readmission" },
          orderBy: [{ date: "desc" }, { id: "desc" }],
          select: { date: true },
        }),
      ]);
      periods = allocate({
        pending: fees.filter((f) => f.status === "pending").map((f) => f.period),
        existing: fees.map((f) => f.period),
        n: p.n,
        startAt: coverageFloor({ joinedAt: member.joinedAt, readmittedAt: readmission?.date ?? null }),
      }).toPay;
    }
    out.push({ memberId: member.id, name: member.fullName, memberNumber, concept: paymentConcept(type, periods), amount: p.amount });
  }
  return out;
}
```

(`describePeriods` no hace falta si se usa `paymentConcept`; quitar ese import si el linter lo marca.)

- [ ] **Step 4: `membersByEmail` en `member-search.ts`**

Agregar `import { MAX_SPLIT_PARTS } from "./split-group";` y al final:

```ts
/** Los socios del libro abierto cuya casilla es la del pagador (spec 2026-09-10
 *  §8.1): un matrimonio suele compartir email, y es la pista con la que el
 *  operador arma el reparto. Casilla exacta, no `contains`: es un dato personal
 *  y no se busca por fragmentos. Hasta el tope de partes. */
export async function membersByEmail(db: Pick<PrismaClient, "membership">, email: string): Promise<MemberHit[]> {
  const trimmed = email.trim();
  if (trimmed === "") return [];
  const rows = await db.membership.findMany({
    where: { book: { status: "open" }, member: { email: trimmed } },
    include: { member: { select: { id: true, fullName: true, dni: true, category: true, status: true } } },
    orderBy: { memberNumber: "asc" },
    take: MAX_SPLIT_PARTS,
  });
  return rows.map((r) => ({ memberNumber: r.memberNumber, ...r.member }));
}
```

Run: `npm test -- tests/treasury-ars-input.test.ts tests/treasury-split-preview.test.ts tests/treasury-member-search.test.ts` → PASS.

- [ ] **Step 5: Reescribir el `describe("resolveUnmatchedAction")` del test de la action (falla)**

En `tests/unmatched-actions-auth.test.ts`: en `mocks`, reemplazar `register: vi.fn()` por `registerSplit: vi.fn()` y agregar `loadGroup: vi.fn()`, `guards: vi.fn(async () => null)`, `preview: vi.fn()`. Cambiar el mock del servicio y agregar dos mocks de módulo:

```ts
vi.mock("@/lib/treasury/service", () => ({
  treasuryService: { registerSplitPayment: mocks.registerSplit },
  TreasuryError: class extends Error {},
}));
vi.mock("@/lib/treasury/split-group", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/treasury/split-group")>()),
  loadGroup: mocks.loadGroup,
}));
vi.mock("@/lib/treasury/split-preview", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/treasury/split-preview")>()),
  splitPartGuards: mocks.guards,
  previewSplit: mocks.preview,
}));
```

y reemplazar `applyForm()` y todo el `describe("resolveUnmatchedAction", …)` por:

```ts
import { splitConfirmToken } from "@/lib/treasury/split-preview";

const TWO_PLUS_ONE = [
  { memberId: 192, concept: "fees" as const, n: 2, amount: 12000 },
  { memberId: 193, concept: "fees" as const, n: 1, amount: 6000 },
];
function splitForm(opts: { confirm?: boolean; token?: string; note?: string; amounts?: [string, string] } = {}): FormData {
  const form = new FormData();
  form.append("rowId", "5");
  form.append("socios", "192,193");
  form.append("part_192_concept", "fees");
  form.append("part_192_count", "2");
  form.append("part_192_amount", opts.amounts?.[0] ?? "12000");
  form.append("part_193_concept", "fees");
  form.append("part_193_count", "1");
  form.append("part_193_amount", opts.amounts?.[1] ?? "6000");
  if (opts.note) form.append("note", opts.note);
  if (opts.confirm) {
    form.append("confirmar", "1");
    form.append("confirmToken", opts.token ?? splitConfirmToken(5, TWO_PLUS_ONE));
  }
  return form;
}
function openGroup(unassigned = 18000) {
  return { holder: null, parts: [], all: [], totals: { assigned: 18000 - unassigned, unassigned, status: unassigned === 18000 ? "open" : "partial" } };
}
const PREVIEW = [
  { memberId: 192, name: "Araoz Hugo", memberNumber: 192, concept: "Cuota social · julio a agosto 2026 (2 cuotas)", amount: 12000 },
  { memberId: 193, name: "Maza Monica", memberNumber: 193, concept: "Cuota social · agosto 2026", amount: 6000 },
];
const REGISTERED = {
  kind: "registered" as const, rowStatus: "matched" as const,
  parts: [
    { memberId: 192, paymentId: 3, receiptId: 7, number: "2026-00007", periods: ["2026-07", "2026-08"], amount: 12000, pdfWritten: true },
    { memberId: 193, paymentId: 4, receiptId: 8, number: "2026-00008", periods: ["2026-08"], amount: 6000, pdfWritten: true },
  ],
};

describe("resolveUnmatchedAction (reparto en dos pasos)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sendEmail.mockResolvedValue({ sent: true });
    mocks.loadGroup.mockResolvedValue(openGroup());
    mocks.guards.mockResolvedValue(null);
    mocks.preview.mockResolvedValue(PREVIEW);
  });

  it("sin admin no lee la fila, no registra, no audita y no redirige", async () => {
    const r = await resolveUnmatchedAction({}, splitForm());
    expect(r.error).toBe("No tenés permiso para editar el padrón.");
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.registerSplit).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("primer envío: devuelve la confirmación resuelta en el servidor y NO registra", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.findUnique.mockResolvedValueOnce(openRow());
    const r = await resolveUnmatchedAction({}, splitForm());
    expect(r.confirm).toEqual({ token: splitConfirmToken(5, TWO_PLUS_ONE), total: 18000, parts: PREVIEW });
    expect(mocks.preview).toHaveBeenCalledWith(expect.anything(), TWO_PLUS_ONE);
    expect(mocks.registerSplit).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("segundo envío con el token: registra el reparto con la fila y el actor, manda un email por parte, audita sin la casilla y vuelve a la fila", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.findUnique.mockResolvedValueOnce(openRow());
    mocks.registerSplit.mockResolvedValueOnce(REGISTERED);
    mocks.sendEmail.mockResolvedValueOnce({ sent: true }).mockResolvedValueOnce({ sent: false, reason: "no_email" });
    await resolveUnmatchedAction({}, splitForm({ confirm: true, note: "matrimonio" }));
    expect(mocks.registerSplit).toHaveBeenCalledWith({ rowId: 5, parts: TWO_PLUS_ONE, actorId: 9, note: "matrimonio" });
    expect(mocks.sendEmail).toHaveBeenCalledTimes(2);
    expect(mocks.sendEmail).toHaveBeenNthCalledWith(1, 7);
    expect(mocks.sendEmail).toHaveBeenNthCalledWith(2, 8);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      userId: 9, ip: "unknown",
      action: "unmatched_resolve", entity: "mp_unmatched_payment", entityId: 5,
      detail: {
        action: "apply", rowStatus: "matched", total: 18000,
        parts: [
          { memberId: 192, paymentId: 3, receiptId: 7, concept: "fees", count: 2, amount: 12000, emailed: "sent" },
          { memberId: 193, paymentId: 4, receiptId: 8, concept: "fees", count: 1, amount: 6000, emailed: "no_email" },
        ],
      },
    }));
    const entry = JSON.stringify(auditedEntry());
    expect(entry).not.toContain("vecino@example.com");
    expect(entry).not.toContain("Cuota mensual");
    expect(entry).not.toContain("matrimonio");
    expect(entry).not.toContain("Araoz");
    expect(redirect).toHaveBeenCalledWith("/admin/tesoreria/sin-conciliar/5?emitidos=2&email=sent,no_email");
  });

  it("un token de otro reparto (las partes cambiaron después de leer) vuelve a pedir confirmación", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.findUnique.mockResolvedValueOnce(openRow());
    const r = await resolveUnmatchedAction({}, splitForm({ confirm: true, token: "5|192:fees:1:1200000,193:fees:1:600000" }));
    expect(r.confirm?.token).toBe(splitConfirmToken(5, TWO_PLUS_ONE));
    expect(mocks.registerSplit).not.toHaveBeenCalled();
  });

  it("la suma inexacta se rechaza con los dos importes, antes de la vista previa", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.findUnique.mockResolvedValueOnce(openRow());
    const r = await resolveUnmatchedAction({}, splitForm({ amounts: ["12000", "5000"] }));
    expect(r.error).toBe("Las partes suman $ 17.000,00 y hay $ 18.000,00 sin asignar.");
    expect(mocks.preview).not.toHaveBeenCalled();
    expect(mocks.registerSplit).not.toHaveBeenCalled();
  });

  it("una fila parcial se compara contra lo sin asignar y se puede completar", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.findUnique.mockResolvedValueOnce({ ...openRow(), status: "partial" });
    mocks.loadGroup.mockResolvedValueOnce(openGroup(6000));
    const form = new FormData();
    form.append("rowId", "5");
    form.append("socios", "200");
    form.append("part_200_concept", "fees");
    form.append("part_200_count", "1");
    form.append("part_200_amount", "6000");
    const r = await resolveUnmatchedAction({}, form);
    expect(r.confirm?.total).toBe(6000);
  });

  it("una fila ya resuelta no se vuelve a cobrar", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.findUnique.mockResolvedValueOnce({ ...openRow(), status: "matched" });
    const r = await resolveUnmatchedAction({}, splitForm({ confirm: true }));
    expect(r.error).toBe("Esta fila ya fue resuelta.");
    expect(mocks.registerSplit).not.toHaveBeenCalled();
  });

  it("la guarda de un socio se muestra tal cual (categoría, cesante, exento)", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.findUnique.mockResolvedValueOnce(openRow());
    mocks.guards.mockResolvedValueOnce("Ese concepto no corresponde a la categoría del socio.");
    const r = await resolveUnmatchedAction({}, splitForm());
    expect(r.error).toBe("Ese concepto no corresponde a la categoría del socio.");
    expect(mocks.preview).not.toHaveBeenCalled();
  });

  it("más de cinco socios, un socio repetido, cuotas o importe inválidos: se rechazan antes de tocar la base", async () => {
    mocks.admin.mockResolvedValue({ ok: true, actorId: 9 });
    const six = new FormData();
    six.append("rowId", "5");
    six.append("socios", "1,2,3,4,5,6");
    expect((await resolveUnmatchedAction({}, six)).error).toBe("Como máximo 5 socios por pago.");
    const dup = new FormData();
    dup.append("rowId", "5");
    dup.append("socios", "192,192");
    expect((await resolveUnmatchedAction({}, dup)).error).toBe("Un socio no puede aparecer dos veces en el reparto.");
    const badCount = splitForm();
    badCount.set("part_192_count", "72");
    expect((await resolveUnmatchedAction({}, badCount)).error).toBe("La cantidad de cuotas tiene que estar entre 1 y 60.");
    const badAmount = splitForm({ amounts: ["12.000", "6000"] });
    expect((await resolveUnmatchedAction({}, badAmount)).error).toBe("El importe de cada parte tiene que ser mayor a cero.");
    expect(mocks.findUnique).not.toHaveBeenCalled();
    mocks.admin.mockReset();
    mocks.admin.mockResolvedValue({ ok: false, reason: "not_admin", error: "No tenés permiso para editar el padrón." });
  });

  it("una regla de negocio del servicio se le muestra al operador tal como la redactó", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.findUnique.mockResolvedValueOnce(openRow());
    mocks.registerSplit.mockRejectedValueOnce(new TreasuryError("Este pago cambió mientras lo repartías. Revisá la fila y volvé a intentarlo."));
    const r = await resolveUnmatchedAction({}, splitForm({ confirm: true }));
    expect(r.error).toBe("Este pago cambió mientras lo repartías. Revisá la fila y volvé a intentarlo.");
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("already_processed con el pago aplicado: dice el recibo, lo linkea y no lo pinta de error", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.findUnique.mockResolvedValueOnce(openRow());
    mocks.registerSplit.mockResolvedValueOnce({ kind: "already_processed", paymentId: 3 });
    mocks.paymentFindUnique.mockResolvedValueOnce({ status: "applied", receipt: { id: 7, number: "2026-00007" } });
    const r = await resolveUnmatchedAction({}, splitForm({ confirm: true }));
    expect(r.error).toBe("Este cobro de Mercado Pago ya está asentado: se registró con el recibo N° 2026-00007. No hace falta volver a aplicarlo.");
    expect(r.kind).toBe("warning");
    expect(r.receipt).toEqual({ id: 7, number: "2026-00007" });
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("si el email de una parte explota, la plata ya cobrada igual queda auditada y redirige", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.findUnique.mockResolvedValueOnce(openRow());
    mocks.registerSplit.mockResolvedValueOnce(REGISTERED);
    mocks.sendEmail.mockRejectedValueOnce(Object.assign(new Error("pool timeout"), { code: "ETIMEDOUT" }));
    await resolveUnmatchedAction({}, splitForm({ confirm: true }));
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      detail: expect.objectContaining({ parts: [expect.objectContaining({ emailed: "error" }), expect.objectContaining({ emailed: "sent" })] }),
    }));
    expect(redirect).toHaveBeenCalledWith("/admin/tesoreria/sin-conciliar/5?emitidos=2&email=error,sent");
  });
});
```

Los `describe` de `dismissUnmatchedAction` y `registerAsOtherIncomeAction` quedan **como están** (el mock de `prisma` sigue exponiendo `mpUnmatchedPayment.findUnique/updateMany`, `otherIncome.*`, `payment.findUnique` y `$transaction`).

Run: `npm test -- tests/unmatched-actions-auth.test.ts` → FAIL (la action todavía espera `memberId`).

- [ ] **Step 6: Reescribir `resolveUnmatchedAction`**

En `actions.ts`, imports nuevos:

```ts
import { parseArsInput } from "@/lib/treasury/ars-input";
import { cents, loadGroup, MAX_SPLIT_PARTS } from "@/lib/treasury/split-group";
import { SPLIT_GUARD_MESSAGES as M } from "@/lib/treasury/split-messages";
import { previewSplit, splitConfirmToken, splitPartGuards, type SplitPartPlan, type SplitPreviewPart } from "@/lib/treasury/split-preview";
```

`State` suma:

```ts
  /** El paso de confirmación (spec 2026-09-10 §8.2): las partes resueltas en el
   *  servidor y el token que vuelve con el segundo envío. */
  confirm?: { token: string; total: number; parts: SplitPreviewPart[] };
```

Reemplazar `alreadyProcessedState` por (el caso "anulado" ya no es un callejón: las partes nuevas cuelgan del portador anulado, así que si se llega acá fue una carrera):

```ts
function alreadyProcessedState(
  existing: { status: PaymentStatus; receipt: { id: number; number: string } | null } | null,
): State {
  if (!existing) return { error: "Ese cobro de Mercado Pago ya está registrado como pago." };
  const receipt = existing.receipt ?? undefined;
  if (existing.status === "applied") {
    return {
      kind: "warning",
      error: receipt
        ? `Este cobro de Mercado Pago ya está asentado: se registró con el recibo N° ${receipt.number}. No hace falta volver a aplicarlo.`
        : "Este cobro de Mercado Pago ya está asentado como pago. No hace falta volver a aplicarlo.",
      receipt,
    };
  }
  return {
    error: receipt
      ? `Este cobro de Mercado Pago se asentó con el recibo N° ${receipt.number} mientras lo repartías, y ese recibo figura anulado. Recargá la fila y volvé a intentarlo.`
      : "Este cobro de Mercado Pago se asentó mientras lo repartías. Recargá la fila y volvé a intentarlo.",
    receipt,
  };
}
```

Reemplazar `resolveSchema` y `resolveUnmatchedAction` por:

```ts
const resolveSchema = z.object({
  rowId: z.coerce.number("Fila inválida.").int("Fila inválida.").positive("Fila inválida."),
  socios: z.string(M.noParts).min(1, M.noParts),
  note: z.string().max(200, "La nota no puede superar los 200 caracteres.").optional(),
  confirmar: z.string().optional(),
  confirmToken: z.string().optional(),
});

const CONCEPTS = ["fees", "voluntary", "extraordinary"] as const;

// Las partes viajan como `part_<socio>_concept|count|amount`, en el orden de
// `socios`. Se leen a mano: zod no modela claves dinámicas y el mensaje tiene
// que decir QUÉ parte falló en el idioma del operador.
function readParts(formData: FormData, socios: string): { ok: true; parts: SplitPartPlan[] } | { ok: false; error: string } {
  const ids = socios.split(",").map((s) => s.trim());
  if (ids.some((s) => !/^\d+$/.test(s) || Number(s) <= 0)) return { ok: false, error: M.noParts };
  if (ids.length > MAX_SPLIT_PARTS) return { ok: false, error: M.tooManyParts };
  if (new Set(ids).size !== ids.length) return { ok: false, error: M.duplicateMember };
  const parts: SplitPartPlan[] = [];
  for (const id of ids) {
    const concept = String(formData.get(`part_${id}_concept`) ?? "");
    if (!(CONCEPTS as readonly string[]).includes(concept)) return { ok: false, error: "Elegí cómo aplicar cada parte." };
    const countRaw = String(formData.get(`part_${id}_count`) ?? "").trim();
    const n = concept === "fees" ? Number(countRaw) : 0;
    if (concept === "fees" && (!/^\d{1,2}$/.test(countRaw) || n < 1 || n > 60)) return { ok: false, error: M.count };
    const amount = parseArsInput(String(formData.get(`part_${id}_amount`) ?? ""));
    if (amount === null || amount <= 0) return { ok: false, error: M.amountZero };
    parts.push({ memberId: Number(id), concept: concept as SplitPartPlan["concept"], n, amount });
  }
  return { ok: true, parts };
}

export async function resolveUnmatchedAction(_prev: State, formData: FormData): Promise<State> {
  const actor = await requireAdmin();
  if (!actor.ok) return { error: actor.error };
  const parsed = parseForm(resolveSchema, formData);
  if (!parsed.ok) return { error: parsed.error };
  const d = parsed.data;
  const read = readParts(formData, d.socios);
  if (!read.ok) return { error: read.error };
  const parts = read.parts;

  const row = await prisma.mpUnmatchedPayment.findUnique({ where: { id: d.rowId } });
  if (!row) return { error: M.rowGone };
  // Dos operadores sobre la misma fila: el segundo no vuelve a cobrarla. La
  // barrera dura es el lock de fila y el unique del portador en el servicio;
  // esto le da un mensaje en castellano en vez de un error técnico.
  if (row.status !== "open" && row.status !== "partial") return { error: M.rowResolved };

  // La suma se compara contra lo SIN ASIGNAR (una fila parcial ya tiene una
  // parte aplicada), con la misma aritmética que la pantalla y el núcleo.
  const group = await loadGroup(prisma, { mpPaymentId: row.mpPaymentId, amount: Number(row.amount) });
  const sum = parts.reduce((s, p) => s + cents(p.amount), 0);
  if (sum !== cents(group.totals.unassigned)) return { error: M.sum(sum / 100, group.totals.unassigned) };
  // Pre-validación barata con los MISMOS textos que el núcleo (que revalida).
  const guard = await splitPartGuards(prisma, parts);
  if (guard) return { error: guard };

  // Paso 1: la confirmación, resuelta en el servidor. El token vuelve con el
  // paso 2 y, si las partes cambiaron en el medio, se vuelve a pedir.
  const token = splitConfirmToken(row.id, parts);
  if (d.confirmar !== "1" || d.confirmToken !== token) {
    const preview = await previewSplit(prisma, parts);
    return { confirm: { token, total: group.totals.unassigned, parts: preview } };
  }

  let result;
  try {
    result = await treasuryService.registerSplitPayment({ rowId: row.id, parts, actorId: actor.actorId, note: d.note ?? null });
  } catch (e) {
    if (e instanceof TreasuryError) return { error: e.message };
    console.error("[unmatched] registerSplitPayment falló", errCode(e));
    return { error: "No se pudo aplicar el pago. Reintentá en un momento." };
  }
  if (result.kind === "already_processed") {
    const existing = await prisma.payment.findUnique({
      where: { id: result.paymentId },
      select: { status: true, receipt: { select: { id: true, number: true } } },
    });
    return alreadyProcessedState(existing);
  }

  // Best-effort, un email por parte: para acá los pagos, las cuotas y los
  // recibos numerados ya están commiteados. Reintentar cobraría dos veces.
  const emailed: ReceiptEmailOutcome[] = [];
  for (const part of result.parts) {
    try {
      const r = await sendReceiptEmail(part.receiptId);
      emailed.push(r.sent ? "sent" : r.reason);
    } catch (e) {
      console.error("[unmatched] sendReceiptEmail lanzó", errCode(e));
      emailed.push("error");
    }
  }

  const ip = (await headers()).get("x-real-ip") ?? "unknown";
  // Ids, códigos, contadores y montos. Ni la casilla del pagador, ni los
  // nombres, ni la nota (Ley 25.326).
  await audit({
    userId: actor.actorId,
    action: "unmatched_resolve",
    entity: "mp_unmatched_payment",
    entityId: row.id,
    detail: {
      action: "apply",
      rowStatus: result.rowStatus,
      total: group.totals.unassigned,
      parts: result.parts.map((p, i) => ({
        memberId: p.memberId, paymentId: p.paymentId, receiptId: p.receiptId,
        concept: parts[i].concept, count: parts[i].concept === "fees" ? parts[i].n : null,
        amount: p.amount, emailed: emailed[i],
      })),
    },
    ip,
  });
  // A la MISMA fila, que muestra las partes con sus recibos y a quién se le
  // envió. Fuera del try: redirect() señaliza con una excepción.
  redirect(`${BASE}/${row.id}?emitidos=${result.parts.length}&email=${emailed.join(",")}`);
}
```

- [ ] **Step 7: Verificar**

Run: `npm test -- tests/unmatched-actions-auth.test.ts tests/treasury-split-preview.test.ts && npx tsc --noEmit && npx eslint "src/app/admin/tesoreria/sin-conciliar/[id]/actions.ts" src/lib/treasury`
Expected: PASS, sin errores. (`resolve-form.tsx` sigue importando `resolveUnmatchedAction` y compila: el componente viejo se reemplaza en la Task 8.)

- [ ] **Step 8: Commit**

```bash
git add src/lib/treasury/ars-input.ts src/lib/treasury/split-preview.ts src/lib/treasury/member-search.ts "src/app/admin/tesoreria/sin-conciliar/[id]/actions.ts" tests/treasury-ars-input.test.ts tests/treasury-split-preview.test.ts tests/treasury-member-search.test.ts tests/unmatched-actions-auth.test.ts
git commit -m "feat(inbox): two-step split action with server-resolved preview, confirm token, cent-aware amounts and payer-email lookup

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: La pantalla Resolver — reparto tipo boleta, sugerencias por casilla, dos pasos, fila parcial

**Files:**
- Create: `src/app/admin/tesoreria/sin-conciliar/[id]/split-form.tsx`
- Modify: `src/app/admin/tesoreria/sin-conciliar/[id]/page.tsx` (reescritura)
- Modify: `src/app/admin/tesoreria/sin-conciliar/[id]/resolve-form.tsx` (se va `ResolveForm`; quedan `DismissForm` y `OtherIncomeForm`)
- Create: `scripts/dev/seed-unmatched.ts` (siembra local para verificar en el navegador)

**Interfaces:**
- Consumes: `resolveUnmatchedAction` y su `State.confirm` (Task 7); `loadGroup`, `parseSociosParam`, `MAX_SPLIT_PARTS`, `cents` (Task 2); `membersByEmail`, `searchMembers`; `arsInputClean`, `formatArsInput`, `parseArsInput` (Task 7); `activeExemption`, `adminExemptionNotice`; `cashConceptsFor`; `fetchMemberAccount`; `digitsOnly` de `../../efectivo/digits`.
- Produces: `SplitForm` (cliente) con props `{ rowId: number; sociosParam: string; parts: SplitPartMember[]; unassigned: number; paidAt: string }` y el tipo `SplitPartMember` (ver código). URL de la pantalla: `?socios=192,193` (elegidos), `?q=` (búsqueda), `?emitidos=N&email=…` (éxito).

- [ ] **Step 1: Siembra local (para ver la pantalla)**

`scripts/dev/seed-unmatched.ts`:

```ts
// Siembra una fila de la bandeja Sin conciliar en la base LOCAL, para probar el
// reparto a mano (spec 2026-09-10). Nunca en producción: ahí las filas las
// escribe Mercado Pago.
// Run: npx tsx scripts/dev/seed-unmatched.ts 18000 haraoz@yahoo.com
import "dotenv/config";
import { prisma } from "../../src/lib/prisma";
import { makeUnmatchedInbox } from "../../src/lib/mp/unmatched";

async function main() {
  const amount = Number(process.argv[2] ?? "18000");
  const payerEmail = process.argv[3] ?? null;
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Monto inválido");
  const mpPaymentId = `dev-${Date.now()}`;
  const r = await makeUnmatchedInbox(prisma).record({
    mpPaymentId, amount, paidAt: new Date(), payerEmail, externalReference: null,
    description: "Varios", preapprovalId: null, reason: "no_reference",
  });
  const row = await prisma.mpUnmatchedPayment.findUnique({ where: { mpPaymentId }, select: { id: true } });
  console.log(`${r}: fila ${row?.id} por $ ${amount} (${mpPaymentId}) → http://localhost:3000/admin/tesoreria/sin-conciliar/${row?.id}`);
}

main().finally(() => prisma.$disconnect());
```

Antes de sembrar, ponerle la casilla del pagador a dos socios activos con deuda para ver la sugerencia (SQL contra Docker, sólo local):

```bash
docker exec sigev-db mariadb -usigev -psigev_dev sigev -e "UPDATE members SET email='haraoz@yahoo.com' WHERE id IN (192,193);"
npx tsx scripts/dev/seed-unmatched.ts 18000 haraoz@yahoo.com
```

(Si 192/193 no son activos con cuotas pendientes en la base local, elegir dos ids que lo sean con `SELECT id, full_name, category, status FROM members WHERE status='active' AND category='active' LIMIT 5;`.)

- [ ] **Step 2: `split-form.tsx`**

```tsx
"use client";
// El reparto de un cobro de Mercado Pago entre socios (spec 2026-09-10 §8.1).
//
// Una boleta: una parte por socio elegido (los socios viajan en la URL, así que
// agregar y quitar es navegar), con concepto, cuotas e importe; el pie suma lo
// asignado y dice cuánto falta; y el envío es en DOS pasos —el primero devuelve
// la confirmación resuelta en el servidor (qué cuotas se imputan a cada uno),
// el segundo emite— con el mismo mecanismo que el lote de cesantía: token de
// lo confirmado, foco en el panel, Enter bloqueado mientras está visible.
//
// `useSyncedForm`: React 19 resetea el <form action> cuando la action termina
// y, con varios <select> controlados, cada rechazo devolvería todos los
// conceptos al primero mientras el operador lee por qué se rechazó.
import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { Receipt, X } from "lucide-react";
import { FormMessage } from "@/components/admin/form-message";
import { SelectField, TextField, useSyncedForm } from "@/components/admin/synced-fields";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { MemberStatus } from "@/generated/prisma/client";
import { memberStatusBadgeVariant } from "@/lib/admin/status-badges";
import { formatARS } from "@/lib/format";
import { arsInputClean, formatArsInput, parseArsInput } from "@/lib/treasury/ars-input";
import { CASH_CONCEPT_LABELS } from "@/lib/treasury/labels";
import type { CashConcept } from "@/lib/treasury/rules";
import { cents } from "@/lib/treasury/split-group";
import { digitsOnly } from "../../efectivo/digits";
import { resolveUnmatchedAction } from "./actions";

/** Lo que la pantalla resolvió en el servidor sobre cada socio elegido. */
export type SplitPartMember = {
  memberId: number;
  name: string;
  memberNumber: number | null;
  categoryLabel: string;
  status: MemberStatus;
  statusLabel: string;
  /** Conceptos que se le pueden asignar (categoría, cesante y exención ya
   *  aplicados en el servidor). Vacío = no hay nada que asignarle. */
  concepts: CashConcept[];
  /** Valor vigente de la cuota de su categoría, o null si no paga cuota. */
  feeAmount: number | null;
  pendingCount: number;
  /** "julio 2026", o null si está al día. */
  oldestPendingLabel: string | null;
  withdrawn: boolean;
  /** El aviso del acta si está eximido, ya redactado. */
  exemptionNotice: string | null;
  /** La URL de la pantalla sin este socio. */
  removeHref: string;
};

type SplitState = Awaited<ReturnType<typeof resolveUnmatchedAction>>;
type Confirmation = NonNullable<SplitState["confirm"]>;

const MAX_COUNT = 60;

export function SplitForm({ rowId, sociosParam, parts, unassigned, paidAt }: {
  rowId: number;
  sociosParam: string;
  parts: SplitPartMember[];
  /** Lo que queda por asignar de la fila (todo, o el resto de una parcial). */
  unassigned: number;
  /** Ya formateada en es-AR: la fecha del recibo es la del cobro. */
  paidAt: string;
}) {
  const [state, formAction, pending] = useActionState(resolveUnmatchedAction, {});
  const [dismissed, setDismissed] = useState<Confirmation | undefined>(undefined);
  const confirmRef = useRef<HTMLDivElement>(null);
  const single = parts.length === 1;

  const { values, setValue, formRef, field } = useSyncedForm<Record<string, string>>(() => {
    const v: Record<string, string> = { note: "" };
    for (const p of parts) {
      const concept = p.concepts[0] ?? "";
      // Con un solo socio, lo que el importe sugiere (cuántas cuotas entran);
      // con varios, una cuota cada uno y que el operador lo ajuste.
      const suggested = p.feeAmount ? Math.max(1, Math.min(MAX_COUNT, Math.floor(unassigned / p.feeAmount))) : 1;
      const count = concept === "fees"
        ? (single ? (p.withdrawn ? Math.max(1, Math.min(suggested, p.pendingCount)) : suggested) : 1)
        : 1;
      v[`part_${p.memberId}_concept`] = concept;
      v[`part_${p.memberId}_count`] = String(count);
      v[`part_${p.memberId}_amount`] = concept === "fees" && p.feeAmount
        ? formatArsInput(p.feeAmount * count)
        : single ? formatArsInput(unassigned) : "";
    }
    return v;
  });

  const amountCents = (p: SplitPartMember) => {
    const n = parseArsInput(values[`part_${p.memberId}_amount`] ?? "");
    return n === null ? 0 : cents(n);
  };
  const assigned = parts.reduce((s, p) => s + amountCents(p), 0);
  const remaining = cents(unassigned) - assigned;
  const blocked = parts.some((p) => p.concepts.length === 0);
  const confirm = state.confirm && state.confirm !== dismissed ? state.confirm : null;

  // Cambiar cuotas o concepto recalcula el importe (n × valor vigente); el
  // operador puede corregirlo después. Y cualquier cambio invalida lo que
  // acaba de leer en la confirmación.
  const onCountChange = (p: SplitPartMember, raw: string) => {
    const c = digitsOnly(raw).slice(0, 2);
    setValue(`part_${p.memberId}_count`, c);
    if (p.feeAmount && values[`part_${p.memberId}_concept`] === "fees" && c !== "") {
      setValue(`part_${p.memberId}_amount`, formatArsInput(p.feeAmount * Number(c)));
    }
  };
  const onConceptChange = (p: SplitPartMember, concept: string) => {
    setValue(`part_${p.memberId}_concept`, concept);
    if (concept === "fees" && p.feeAmount) {
      const c = Number(values[`part_${p.memberId}_count`] || "1");
      setValue(`part_${p.memberId}_amount`, formatArsInput(p.feeAmount * Math.max(1, c)));
    }
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLFormElement>) => {
    if (confirm && e.key === "Enter" && (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement)) {
      e.preventDefault();
    }
  };
  useEffect(() => {
    if (confirm) confirmRef.current?.focus();
  }, [confirm]);

  return (
    <form
      ref={formRef}
      action={formAction}
      onChange={() => setDismissed(state.confirm)}
      onKeyDown={onKeyDown}
      className="space-y-4"
    >
      <input type="hidden" name="rowId" value={rowId} />
      <input type="hidden" name="socios" value={sociosParam} />

      <ul className="divide-y rounded-xl border">
        {parts.map((p) => {
          const concept = values[`part_${p.memberId}_concept`] ?? "";
          const conceptField = field(`part_${p.memberId}_concept`);
          const countField = field(`part_${p.memberId}_count`);
          const amountField = field(`part_${p.memberId}_amount`, arsInputClean);
          return (
            <li key={p.memberId} className="space-y-3 p-3">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                <span className="font-mono tabular-nums text-muted-foreground">
                  {p.memberNumber !== null ? `N° ${p.memberNumber}` : "Sin número"}
                </span>
                <span className="font-medium">{p.name}</span>
                <span className="text-muted-foreground">· {p.categoryLabel}</span>
                <Badge variant={memberStatusBadgeVariant(p.status)}>{p.statusLabel}</Badge>
                <Link
                  href={p.removeHref}
                  className="ml-auto inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground outline-hidden hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="size-4" aria-hidden="true" />
                  Quitar
                  <span className="sr-only"> a {p.name} del reparto</span>
                </Link>
              </div>
              {p.concepts.length === 0 ? (
                <FormMessage kind="warning" role="none">
                  Está dado de baja y no le quedan cuotas pendientes: no hay a qué imputarle una parte. Quitalo del reparto.
                </FormMessage>
              ) : (
                <>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <SelectField
                      label="Concepto"
                      field={{ ...conceptField, onChange: (e) => onConceptChange(p, e.target.value) }}
                      options={p.concepts.map((c): [string, string] => [c, p.withdrawn && c === "fees" ? "Cuotas sociales (deuda congelada)" : CASH_CONCEPT_LABELS[c]])}
                    />
                    {concept === "fees" ? (
                      <TextField
                        label="Cuotas"
                        field={{ ...countField, onChange: (e) => onCountChange(p, e.target.value) }}
                        inputMode="numeric"
                        maxLength={2}
                        hint={
                          p.withdrawn
                            ? `Dado de baja: como máximo ${p.pendingCount}.`
                            : p.pendingCount > 0
                              ? `Debe ${p.pendingCount}${p.oldestPendingLabel ? ` desde ${p.oldestPendingLabel}` : ""}. Se imputan a las más antiguas primero.`
                              : "Está al día: se imputa a la primera cuota no cubierta."
                        }
                      />
                    ) : (
                      <div aria-hidden="true" />
                    )}
                    <TextField
                      label="Importe ($)"
                      field={amountField}
                      inputMode="text"
                      maxLength={11}
                      placeholder="6000"
                      hint="Centavos con coma: 6000,50."
                    />
                  </div>
                  {p.exemptionNotice && (
                    <FormMessage kind="warning" role="none">{p.exemptionNotice} Sólo se le puede registrar un aporte.</FormMessage>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>

      {/* La boleta: qué se le asigna a cada uno y cuánto falta. Verde en cero,
          ámbar mientras falte o sobre: se lee antes que el número. */}
      <div className="overflow-hidden rounded-xl border-2 border-border">
        <ul className="divide-y divide-border text-sm">
          {parts.map((p) => (
            <li key={p.memberId} className="flex items-baseline justify-between gap-4 px-4 py-2.5">
              <span className="min-w-0 truncate">{p.name}</span>
              <span className="shrink-0 font-mono tabular-nums text-muted-foreground">{formatARS(amountCents(p) / 100)}</span>
            </li>
          ))}
          <li className="flex items-baseline justify-between gap-4 bg-muted/40 px-4 py-3">
            <span className="font-medium">Total asignado</span>
            <span className="shrink-0 font-mono text-lg font-semibold tabular-nums">{formatARS(assigned / 100)}</span>
          </li>
          <li className="flex items-baseline justify-between gap-4 px-4 py-3">
            <span className="font-medium">Sin asignar</span>
            <span
              className={`shrink-0 font-mono text-lg font-semibold tabular-nums ${remaining === 0 ? "text-success" : "text-warning"}`}
              role="status"
            >
              {formatARS(remaining / 100)}
            </span>
          </li>
        </ul>
      </div>
      {remaining !== 0 && (
        <FormMessage kind="warning" role="none">
          {remaining > 0
            ? `Faltan asignar ${formatARS(remaining / 100)} de los ${formatARS(unassigned)} cobrados.`
            : `Las partes suman ${formatARS(-remaining / 100)} más que lo cobrado.`}
        </FormMessage>
      )}

      <TextField label="Nota (opcional)" field={field("note")} maxLength={200} hint="Va en los pagos de todas las partes, no en los recibos." />

      <p className="text-sm text-muted-foreground">
        Los recibos se fechan el {paidAt}, que es el día en que Mercado Pago lo cobró.
      </p>

      {state.error && (
        <FormMessage kind={state.kind ?? "error"} box>
          {state.error}
          {state.receipt && (
            <>
              {" "}
              <Link
                className="font-medium underline underline-offset-2 outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                href={`/admin/tesoreria/recibos/${state.receipt.id}`}
              >
                Ver el recibo N° {state.receipt.number}
              </Link>
            </>
          )}
        </FormMessage>
      )}

      {confirm && (
        <div
          ref={confirmRef}
          tabIndex={-1}
          role="group"
          aria-labelledby="split-confirm-title"
          className="space-y-3 rounded-md border border-primary bg-primary/5 p-3 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <p id="split-confirm-title" className="font-medium">
            {`Vas a emitir ${confirm.parts.length} ${confirm.parts.length === 1 ? "recibo" : "recibos"} por ${formatARS(confirm.total)}.`}
          </p>
          <ul className="space-y-1 text-sm">
            {confirm.parts.map((c) => (
              <li key={c.memberId} className="flex flex-wrap items-baseline gap-x-2">
                <Receipt className="size-4 shrink-0 self-center text-muted-foreground" aria-hidden="true" />
                <span className="font-mono tabular-nums text-muted-foreground">
                  {c.memberNumber !== null ? `N° ${c.memberNumber}` : "Sin número"}
                </span>
                <span className="font-medium">{c.name}</span>
                <span>· {c.concept} ·</span>
                <span className="font-mono tabular-nums">{formatARS(c.amount)}</span>
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted-foreground">
            Cada socio recibe su recibo por email si tiene casilla. Los números se asignan al confirmar y no se reutilizan.
          </p>
          <input type="hidden" name="confirmToken" value={confirm.token} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" name="confirmar" value="1" className="min-h-11 px-4" disabled={pending}>
              {pending ? "Emitiendo…" : `Confirmar y emitir ${confirm.parts.length} ${confirm.parts.length === 1 ? "recibo" : "recibos"}`}
            </Button>
            <Button type="button" variant="outline" className="min-h-11 px-4" disabled={pending} onClick={() => setDismissed(confirm)}>
              Volver
            </Button>
          </div>
        </div>
      )}

      {!confirm && (
        <Button type="submit" className="min-h-11 px-4" disabled={pending || blocked || parts.length === 0 || remaining !== 0}>
          {pending ? "Revisando…" : "Revisar el reparto"}
        </Button>
      )}
    </form>
  );
}
```

- [ ] **Step 3: Recortar `resolve-form.tsx`**

Borrar la función `ResolveForm` entera y `const digits`, y los imports que sólo ella usaba (`SelectField, TextField, useSyncedForm` y `resolveUnmatchedAction`). El comentario de cabecera pasa a decir que el archivo tiene las DOS salidas que no son un socio; el reparto vive en `split-form.tsx`. `DismissForm` y `OtherIncomeForm` quedan byte-idénticos.

- [ ] **Step 4: Reescribir `page.tsx`**

```tsx
// Detalle de una fila de la bandeja. La pantalla sigue partida en dos mitades:
//
//   izquierda  — la EVIDENCIA. Lo que dijo Mercado Pago, tal cual llegó, y
//                —desde el reparto— qué parte de esa plata ya está asignada y
//                a quién.
//   derecha    — la DECISIÓN. El reparto entre socios (spec 2026-09-10 §8.1):
//                sugerencias por la casilla del pagador, el buscador, una parte
//                por socio elegido y la confirmación en dos pasos.
//
// Los socios elegidos viajan en la URL (`?socios=192,193`), como antes viajaba
// `?socio=`: todo se resuelve en el servidor, sin fetch, y la pantalla se puede
// recargar o compartir a medio armar.
//
// El encabezado NO se escribe acá: lo pone el layout de Tesorería.
import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus, Users } from "lucide-react";
import { INLINE_LINK } from "@/lib/admin/link-styles";
import { EmptyState } from "@/components/admin/empty-state";
import { FormMessage } from "@/components/admin/form-message";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { PaymentStatus } from "@/generated/prisma/client";
import { memberStatusBadgeVariant, receiptBadgeVariant, unmatchedStatusBadgeVariant } from "@/lib/admin/status-badges";
import { UNMATCHED_REASON_LABELS, UNMATCHED_STATUS_LABELS } from "@/lib/admin/unmatched-labels";
import { requireAdmin } from "@/lib/auth/require-admin";
import { formatARS, formatDateAR } from "@/lib/format";
import { CATEGORY_LABELS, STATUS_LABELS } from "@/lib/members/labels";
import type { UnmatchedReason } from "@/lib/mp/unmatched";
import { prisma } from "@/lib/prisma";
import { fetchMemberAccount } from "@/lib/treasury/account";
import { activeExemption, adminExemptionNotice } from "@/lib/treasury/exemptions";
import { feeValueReader } from "@/lib/treasury/fee-values";
import { INCOME_METHOD_LABELS } from "@/lib/treasury/labels";
import { membersByEmail, searchMembers, type MemberHit } from "@/lib/treasury/member-search";
import { periodLabel } from "@/lib/treasury/periods";
import type { ReceiptEmailOutcome } from "@/lib/treasury/receipt-notice";
import { cashConceptsFor, type FeeValueAmounts } from "@/lib/treasury/rules";
import { loadGroup, MAX_SPLIT_PARTS, parseSociosParam, type GroupRow } from "@/lib/treasury/split-group";
import { DismissForm, OtherIncomeForm } from "./resolve-form";
import { SplitForm, type SplitPartMember } from "./split-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pago sin conciliar — SIGeV" };

const BASE = "/admin/tesoreria/sin-conciliar";

// Una frase por motivo, en el idioma del operador y no en el del webhook.
const REASON_HELP: Record<UnmatchedReason, string> = {
  no_reference:
    "Llegó sin referencia ni suscripción conocida: no hay forma de saber de qué socio es.",
  no_subscription:
    "Es un cobro de una suscripción que SIGeV todavía no tiene vinculada a ningún socio. Vinculala desde Suscripciones y esta fila se aplica sola.",
  application_missing:
    "Trae la referencia de una solicitud que ya no existe en el sistema.",
  duplicate_entry:
    "Es un segundo cobro sobre una solicitud cuyo ingreso ya se cobró y todavía no tiene acta.",
  withdrawn_no_pending:
    "El socio está dado de baja y no le quedan cuotas pendientes: no hay a qué imputarlo.",
  treasury_rejected:
    "MP cobró y tesorería rechazó el asiento por una regla (monto fuera de rango, ficha inexistente, cuotas que cambiaron). El motivo exacto está en la auditoría (payment_not_applied).",
};

const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = { applied: "Aplicado", voided: "Anulado", refunded: "Reembolsado" };

// Qué pasó con el email de cada recibo recién emitido, en dos palabras.
const EMAIL_SHORT: Record<ReceiptEmailOutcome, string> = {
  sent: "enviado por email", no_email: "sin casilla: imprimilo", voided: "no se envió", error: "el email no salió", skipped: "",
};

function hrefWith(rowId: number, ids: number[], q?: string): string {
  const sp = new URLSearchParams();
  if (ids.length > 0) sp.set("socios", ids.join(","));
  if (q) sp.set("q", q);
  const s = sp.toString();
  return `${BASE}/${rowId}${s ? `?${s}` : ""}`;
}

// Lo que el reparto necesita saber de un socio elegido: conceptos según
// categoría, cesante y exención (las MISMAS reglas que Efectivo y que la
// action), valor de cuota y deuda para el hint.
async function loadPartMember(
  id: number, feeValue: FeeValueAmounts | null, rowId: number, chosen: number[],
): Promise<SplitPartMember | null> {
  const member = await prisma.member.findUnique({
    where: { id },
    include: { memberships: { include: { book: true } } },
  });
  if (!member) return null;
  const [account, exemption] = await Promise.all([
    fetchMemberAccount(prisma, member, feeValue),
    activeExemption(prisma, member.id),
  ]);
  const withdrawn = member.status === "withdrawn";
  const concepts = withdrawn
    ? (account.pendingCount > 0 ? cashConceptsFor(member.category).filter((c) => c === "fees") : [])
    : cashConceptsFor(member.category).filter((c) => !exemption || c !== "fees");
  return {
    memberId: member.id,
    name: member.fullName,
    memberNumber: member.memberships.find((m) => m.book.status === "open")?.memberNumber ?? null,
    categoryLabel: CATEGORY_LABELS[member.category],
    status: member.status,
    statusLabel: STATUS_LABELS[member.status],
    concepts,
    feeAmount: account.feeAmount,
    pendingCount: account.pendingCount,
    oldestPendingLabel: account.oldestPending ? periodLabel(account.oldestPending) : null,
    withdrawn,
    exemptionNotice: exemption ? adminExemptionNotice(exemption) : null,
    removeHref: hrefWith(rowId, chosen.filter((c) => c !== id)),
  };
}

function MemberRow({ hit, addHref, disabled }: { hit: MemberHit; addHref: string; disabled: boolean }) {
  const body = (
    <>
      <span className="font-mono tabular-nums">N° {hit.memberNumber}</span>
      <span className="font-medium">{hit.fullName}</span>
      <span className="text-muted-foreground">{hit.dni ?? "sin DNI"} · {CATEGORY_LABELS[hit.category]}</span>
      <Badge variant={memberStatusBadgeVariant(hit.status)}>{STATUS_LABELS[hit.status]}</Badge>
    </>
  );
  return (
    <li className="flex min-h-11 flex-wrap items-center gap-x-3 px-3 py-2 text-sm">
      {body}
      {disabled ? (
        <span className="ml-auto text-xs text-muted-foreground">En el reparto</span>
      ) : (
        <Link
          href={addHref}
          className="ml-auto inline-flex min-h-11 items-center gap-1 text-primary outline-hidden hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Plus className="size-4" aria-hidden="true" />
          Agregar
          <span className="sr-only"> a {hit.fullName} al reparto</span>
        </Link>
      )}
    </li>
  );
}

function PartsList({ parts, rowId }: { parts: GroupRow[]; rowId: number }) {
  return (
    <ul className="divide-y rounded-xl border text-sm">
      {parts.map((p) => (
        <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
          {p.member ? (
            <Link className={INLINE_LINK} href={`/admin/socios/${p.member.id}?tab=cuenta`}>{p.member.fullName}</Link>
          ) : (
            <span className="text-muted-foreground">Socio fuera del padrón</span>
          )}
          <span className="text-muted-foreground">{p.receipt?.concept ?? "—"}</span>
          <span className="font-mono tabular-nums">{formatARS(p.amount)}</span>
          {p.receipt && (
            <Link
              className="font-mono text-xs text-primary outline-hidden hover:underline focus-visible:ring-2 focus-visible:ring-ring"
              href={`/admin/tesoreria/recibos/${p.receipt.id}`}
            >
              {p.receipt.number}
            </Link>
          )}
          <Badge variant={receiptBadgeVariant(p.status !== "applied")}>{PAYMENT_STATUS_LABELS[p.status]}</Badge>
          <span className="sr-only">de la fila {rowId}</span>
        </li>
      ))}
    </ul>
  );
}

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
  const chosen = parseSociosParam(one(sp.socios));
  const sociosParam = chosen.join(",");

  const row = await prisma.mpUnmatchedPayment.findUnique({
    where: { id: rowId },
    include: { resolvedBy: { select: { name: true } } },
  });
  if (!row) notFound();
  const reason = row.reason as UnmatchedReason;
  const canAssign = row.status === "open" || row.status === "partial";
  const dismissed = row.status === "dismissed";
  const group = await loadGroup(prisma, { mpPaymentId: row.mpPaymentId, amount: Number(row.amount) });
  const income = row.status === "other_income"
    ? await prisma.otherIncome.findUnique({
        where: { mpPaymentId: row.mpPaymentId },
        select: { id: true, concept: true, note: true, voidedAt: true },
      })
    : null;

  const [hits, suggestions, feeValue] = await Promise.all([
    canAssign && q !== "" ? searchMembers(prisma, q) : Promise.resolve([] as MemberHit[]),
    canAssign && row.payerEmail ? membersByEmail(prisma, row.payerEmail) : Promise.resolve([] as MemberHit[]),
    // El valor vigente sólo se lee cuando hay socios elegidos (mismo criterio
    // que Efectivo: en modo búsqueda nadie mira ese dato).
    canAssign && chosen.length > 0 ? feeValueReader.current() : Promise.resolve(null),
  ]);
  const loaded = canAssign
    ? await Promise.all(chosen.map((mid) => loadPartMember(mid, feeValue, row.id, chosen)))
    : [];
  const parts = loaded.filter((p): p is SplitPartMember => p !== null);
  const memberGone = loaded.some((p) => p === null);
  const full = chosen.length >= MAX_SPLIT_PARTS;
  const addHref = (mid: number) => hrefWith(row.id, [...chosen, mid]);
  const pendingSuggestions = suggestions.filter((s) => !chosen.includes(s.id));

  // Éxito del reparto: `?emitidos=N&email=a,b`. Los recibos son las últimas N
  // partes aplicadas del grupo, en orden de emisión.
  const emitted = Number(one(sp.emitidos));
  const emailOutcomes = (one(sp.email) ?? "").split(",").filter(Boolean) as ReceiptEmailOutcome[];
  const justIssued = Number.isInteger(emitted) && emitted > 0
    ? group.all.filter((p) => p.status === "applied" && p.receipt).slice(-emitted)
    : [];

  return (
    <div className="space-y-4">
      <Link
        className="inline-flex min-h-11 items-center text-sm text-primary outline-hidden hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        href={BASE}
      >
        ← Sin conciliar
      </Link>

      {justIssued.length > 0 && (
        <FormMessage kind="success" box as="div">
          <p className="font-medium">
            {justIssued.length === 1 ? "Se emitió 1 recibo." : `Se emitieron ${justIssued.length} recibos.`}
          </p>
          <ul className="mt-1 space-y-0.5">
            {justIssued.map((p, i) => (
              <li key={p.id}>
                <Link
                  className="font-mono underline underline-offset-2 outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                  href={`/admin/tesoreria/recibos/${p.receipt!.id}`}
                >
                  N° {p.receipt!.number}
                </Link>
                {p.member ? ` (${p.member.fullName}` : " ("}
                {emailOutcomes[i] && EMAIL_SHORT[emailOutcomes[i]] ? ` · ${EMAIL_SHORT[emailOutcomes[i]]})` : ")"}
              </li>
            ))}
          </ul>
        </FormMessage>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Pago de Mercado Pago</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="font-mono text-3xl tabular-nums">{formatARS(Number(row.amount))}</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <dt className="text-muted-foreground">Cobrado</dt>
              <dd>{formatDateAR(row.paidAt)}</dd>
              {/* Dato personal (Ley 25.326): se ve acá, que es panel de admin, y
                  no viaja a ningún asiento de auditoría ni a los logs. */}
              <dt className="text-muted-foreground">Pagador</dt>
              <dd className="break-all">{row.payerEmail ?? "—"}</dd>
              <dt className="text-muted-foreground">Referencia</dt>
              <dd className="font-mono text-xs break-all">{row.externalReference ?? "—"}</dd>
              {!dismissed && (
                <>
                  <dt className="text-muted-foreground">Descripción</dt>
                  <dd>{row.description ?? "—"}</dd>
                </>
              )}
              <dt className="text-muted-foreground">Id de pago</dt>
              <dd className="font-mono text-xs break-all">{row.mpPaymentId}</dd>
              {row.preapprovalId && (
                <>
                  <dt className="text-muted-foreground">Suscripción</dt>
                  <dd>
                    <Link
                      className="font-mono text-xs break-all text-primary outline-hidden hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                      href="/admin/tesoreria/suscripciones"
                    >
                      {row.preapprovalId}
                    </Link>
                  </dd>
                </>
              )}
              <dt className="text-muted-foreground">Estado</dt>
              <dd>
                <Badge variant={unmatchedStatusBadgeVariant(row.status)}>{UNMATCHED_STATUS_LABELS[row.status]}</Badge>
              </dd>
            </dl>
            {canAssign && (
              <FormMessage kind="warning" box as="div" role="none">
                <p className="font-medium">{UNMATCHED_REASON_LABELS[reason] ?? row.reason}</p>
                <p className="mt-1">{REASON_HELP[reason] ?? "Este cobro no se pudo aplicar automáticamente."}</p>
              </FormMessage>
            )}
            {group.all.length > 0 && (
              <div className="space-y-2">
                <p>
                  Asignado <span className="font-mono tabular-nums">{formatARS(group.totals.assigned)}</span>
                  {" · "}
                  Sin asignar{" "}
                  <span className={`font-mono tabular-nums ${group.totals.unassigned === 0 ? "text-success" : "text-warning"}`}>
                    {formatARS(group.totals.unassigned)}
                  </span>
                </p>
                <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Partes</h3>
                <PartsList parts={group.all} rowId={row.id} />
                {row.status === "matched" && (
                  <p className="text-muted-foreground">
                    Si se anula una parte, la fila vuelve a Pendientes con lo que quede sin asignar.
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {!canAssign ? (
          <Card>
            <CardHeader><CardTitle>{UNMATCHED_STATUS_LABELS[row.status]}</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>
                {row.resolvedAt ? formatDateAR(row.resolvedAt) : "—"}
                {row.resolvedBy ? ` · ${row.resolvedBy.name ?? "un operador"}` : " · automático"}
              </p>
              {dismissed && row.description && <p>Motivo: {row.description}</p>}
              {row.status === "other_income" && (
                income ? (
                  <>
                    <p className="font-medium">{income.concept}</p>
                    {income.note && <p className="text-muted-foreground">{income.note}</p>}
                    <p className="text-muted-foreground">
                      Registrado como {INCOME_METHOD_LABELS.mp.toLowerCase()} en Otros ingresos.
                      No emite recibo: la serie numerada es de las cuotas sociales.
                    </p>
                    {income.voidedAt && (
                      <FormMessage kind="warning" box>
                        Ese ingreso figura anulado y la fila todavía dice lo contrario. Avisá antes de tocarla.
                      </FormMessage>
                    )}
                    <p>
                      <Link className={INLINE_LINK} href={`/admin/tesoreria/otros-ingresos?ingreso=${income.id}`}>
                        Ver en Otros ingresos
                      </Link>
                    </p>
                  </>
                ) : (
                  <FormMessage kind="warning" box>
                    La fila dice que se registró como ingreso no societario, pero ese registro ya no está.
                  </FormMessage>
                )
              )}
              {row.status === "matched" && group.all.length === 0 && (
                <FormMessage kind="warning" box>
                  La fila figura aplicada pero no hay ningún pago con este id de Mercado Pago. Avisá antes de tocarla.
                </FormMessage>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="size-5 text-primary" aria-hidden="true" />
                {row.status === "partial" ? "Asignar el resto" : "Reparto"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {row.status === "partial" && (
                <FormMessage kind="warning" box role="none">
                  Quedan <span className="font-mono tabular-nums">{formatARS(group.totals.unassigned)}</span> sin asignar de este cobro.
                  Elegí a quién se le asigna esa parte.
                </FormMessage>
              )}
              {pendingSuggestions.length > 0 && !full && (
                <div className="space-y-1">
                  <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    Socios con la casilla del pagador
                  </h3>
                  <ul className="divide-y rounded-xl border">
                    {pendingSuggestions.map((h) => (
                      <MemberRow key={h.id} hit={h} addHref={addHref(h.id)} disabled={false} />
                    ))}
                  </ul>
                </div>
              )}
              {/* GET plano, como Efectivo: la búsqueda queda en la URL junto con
                  los socios ya elegidos. */}
              <form className="flex flex-wrap items-end gap-2" method="get">
                {sociosParam && <input type="hidden" name="socios" value={sociosParam} />}
                <Input
                  name="q"
                  placeholder="Número, apellido o DNI"
                  defaultValue={q}
                  className="w-64"
                  aria-label="Número, apellido o DNI"
                  disabled={full}
                />
                <Button type="submit" variant="secondary" disabled={full}>Buscar socio</Button>
              </form>
              {full && (
                <FormMessage kind="warning" role="none">
                  El reparto admite hasta {MAX_SPLIT_PARTS} socios. Quitá uno para agregar otro.
                </FormMessage>
              )}
              {memberGone && (
                <FormMessage kind="error" box>Uno de los socios elegidos ya no está en el padrón. Quitalo y buscalo de nuevo.</FormMessage>
              )}
              {q !== "" && (
                hits.length === 0 ? (
                  <EmptyState size="card" description="Ningún socio coincide con la búsqueda." />
                ) : (
                  <ul className="divide-y rounded-xl border">
                    {hits.map((h) => (
                      <MemberRow key={h.id} hit={h} addHref={addHref(h.id)} disabled={chosen.includes(h.id) || full} />
                    ))}
                  </ul>
                )
              )}
              {parts.length === 0 ? (
                <EmptyState
                  size="card"
                  description="Agregá al menos un socio. Si el cobro es de varios, agregalos a todos y repartí el importe entre ellos."
                />
              ) : (
                <SplitForm
                  rowId={row.id}
                  sociosParam={sociosParam}
                  parts={parts}
                  unassigned={group.totals.unassigned}
                  paidAt={formatDateAR(row.paidAt)}
                />
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Las dos salidas que NO son un socio: sólo con la fila abierta. Con una
          parte ya aplicada, la plata es de socios y el resto también. */}
      {row.status === "open" && (
        <section aria-labelledby="otras-salidas" className="space-y-2">
          <h2 id="otras-salidas" className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Si no es de un socio
          </h2>
          <div className="divide-y rounded-md border">
            <OtherIncomeForm rowId={row.id} amount={Number(row.amount)} paidAt={formatDateAR(row.paidAt)} />
            <DismissForm rowId={row.id} />
          </div>
        </section>
      )}
      {row.status === "partial" && (
        <p className="text-sm text-muted-foreground">
          Este pago ya tiene una parte aplicada: el resto sólo puede asignarse a socios.
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Compilar, lint y probar en el navegador**

Run: `npx tsc --noEmit && npx eslint "src/app/admin/tesoreria/sin-conciliar/[id]"` → limpio.

Con el dev server (`preview_start`, name del `.claude/launch.json`) y la fila sembrada en el Step 1, verificar y capturar:
1. La fila abierta muestra las sugerencias por casilla; **Agregar** a los dos deja `?socios=192,193` y dos partes con concepto/cuotas/importe prellenados (1 cuota cada uno).
2. Subir a 2 cuotas a Hugo → el importe pasa a $ 12.000,00 solo; el pie dice Sin asignar $ 0,00 en verde y el botón se habilita.
3. **Revisar el reparto** → panel con foco, dos renglones con el concepto real ("Cuota social · … (2 cuotas)"), total $ 18.000,00; Enter en un campo NO emite.
4. **Confirmar y emitir 2 recibos** → vuelve a la fila con el cartel verde, dos recibos enlazados, Partes con badge Aplicado, fila Aplicado.
5. Un solo socio → count sugerido = 3, importe $ 18.000,00, funciona igual.
6. Un adherente agregado no ofrece "Cuotas sociales"; un exento muestra el aviso del acta.
7. Móvil (`resize_window` mobile): las tarjetas se apilan, la boleta no scrollea horizontal, targets ≥ 44px.
8. Fila parcial (después de la Task 10, o anulando desde `/admin/tesoreria/recibos/<id>` ya hoy): título "Asignar el resto", aviso ámbar con el resto, reparto prellenado con ese importe.

Guardar las capturas en `.superpowers/sdd/unmatched-split/` (las lee la Task 13).

- [ ] **Step 6: Commit**

```bash
git add "src/app/admin/tesoreria/sin-conciliar/[id]/page.tsx" "src/app/admin/tesoreria/sin-conciliar/[id]/split-form.tsx" "src/app/admin/tesoreria/sin-conciliar/[id]/resolve-form.tsx" scripts/dev/seed-unmatched.ts
git commit -m "feat(inbox): Resolver screen splits a payment among members — parts in the URL, payer-email suggestions, live totals, two-step confirmation, partial rows

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: La lista de la bandeja y `/admin/salud` cuentan `open + partial`

**Files:**
- Modify: `src/app/admin/tesoreria/sin-conciliar/page.tsx:46-59` (where, total en pesos), `:62-80` (include), `:172-213` (columnas Estado y Aplicado a), `:218` (texto del link)
- Modify: `src/lib/admin/health.ts:480`
- Test: `tests/admin-health.test.ts:447-451`

**Interfaces:**
- Consumes: `groupTotals` (Task 2).
- Produces: Pendientes = `status in (open, partial)`; total en pesos = Σ `open.amount` + Σ `partial.unassigned`; "Aplicado a" y los recibos salen del grupo (portador + partes aplicadas); `inboxOpen` de salud cuenta `open + partial`.

- [ ] **Step 1: Test de salud (falla)**

En `tests/admin-health.test.ts`, el `it("la bandeja distingue lo abierto del total histórico…")` queda:

```ts
  it("la bandeja distingue lo abierto (open + partial, spec 2026-09-10) del total histórico que pasó por ahí", async () => {
    const h = await fetchHealth(fakeDb({
      unmatched: [{ status: "open" }, { status: "open" }, { status: "partial" }, { status: "matched" }, { status: "dismissed" }],
    }), NOW);
    expect(h.money).toMatchObject({ inboxOpen: 3, inboxTotal: 5 });
  });
```

Run: `npm test -- tests/admin-health.test.ts` → FAIL (`inboxOpen: 2`).

- [ ] **Step 2: Salud**

`src/lib/admin/health.ts:480`:

```ts
    // `partial` (reparto con plata sin asignar, spec 2026-09-10) es trabajo
    // pendiente igual que `open`: la bandeja lo lista entre las Pendientes.
    db.mpUnmatchedPayment.count({ where: { status: { in: ["open", "partial"] } } }),
```

Run: `npm test -- tests/admin-health.test.ts tests/admin-health-screen.test.ts` → PASS.

- [ ] **Step 3: La lista**

En `page.tsx` de la lista:

1. Import: `import { groupTotals } from "@/lib/treasury/split-group";` y `import type { PaymentStatus } from "@/generated/prisma/client";`.
2. El `where`:

```ts
  const where: Prisma.MpUnmatchedPaymentWhereInput = resolved
    ? { status: { in: ["matched", "dismissed", "other_income"] } }
    // `partial` es plata que sigue sin dueño (spec 2026-09-10): va con las pendientes.
    : { status: { in: ["open", "partial"] } };
```

3. El `include` del `findMany` (y del cálculo del total) trae el grupo:

```ts
const GROUP_INCLUDE = {
  payment: {
    select: {
      id: true, amount: true, status: true, memberId: true,
      member: { select: { fullName: true } },
      receipt: { select: { id: true, number: true } },
      splitParts: {
        select: {
          id: true, amount: true, status: true, memberId: true,
          member: { select: { fullName: true } },
          receipt: { select: { id: true, number: true } },
        },
        orderBy: { id: "asc" as const },
      },
    },
  },
} as const;
```

(declararlo arriba de la función de página). El `findMany` de la página usa `include: GROUP_INCLUDE`.

4. El total en pesos: reemplazar el `aggregate` por una lectura de las pendientes con su grupo (son pocas: la bandeja se vacía) y la aritmética compartida:

```ts
  // Lo sin asignar: el importe entero de las `open` y el RESTO de las
  // `partial`. Sobre todo el filtro y no sobre la página, y con la misma
  // función que la pantalla Resolver y el núcleo (`groupTotals`).
  const pendingSum = resolved || total === 0
    ? 0
    : (await prisma.mpUnmatchedPayment.findMany({ where, include: GROUP_INCLUDE }))
        .reduce((sum, r) => sum + groupTotals(groupOf(r), Number(r.amount)).unassigned, 0);
```

con el helper, arriba de la página:

```ts
type GroupPart = { id: number; amount: unknown; status: PaymentStatus; memberId: number | null; member: { fullName: string } | null; receipt: { id: number; number: string } | null };
type RowWithGroup = { payment: (GroupPart & { splitParts: GroupPart[] }) | null };

/** Portador + partes, como los lee `groupTotals`. Sin portador, grupo vacío. */
function groupOf(r: RowWithGroup): Array<GroupPart & { amount: number }> {
  if (!r.payment) return [];
  const { splitParts, ...holder } = r.payment;
  return [holder, ...splitParts].map((p) => ({ ...p, amount: Number(p.amount) }));
}
```

5. Columna **Estado**: en lugar de un solo `r.payment?.receipt`, los recibos de las partes aplicadas:

```tsx
                    {groupOf(r).filter((p) => p.status === "applied" && p.receipt).map((p) => (
                      <Link
                        key={p.id}
                        className="ml-2 font-mono text-xs text-primary outline-hidden hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                        href={`/admin/tesoreria/recibos/${p.receipt!.id}`}
                      >
                        {p.receipt!.number}
                      </Link>
                    ))}
```

6. Columna **Aplicado a** (sólo en Resueltos): los socios de las partes aplicadas, separados por coma:

```tsx
                      {groupOf(r).some((p) => p.status === "applied" && p.memberId) ? (
                        <span className="flex flex-wrap gap-x-1">
                          {groupOf(r).filter((p) => p.status === "applied" && p.memberId).map((p, i, arr) => (
                            <span key={p.id}>
                              <Link className={INLINE_LINK} href={`/admin/socios/${p.memberId}?tab=cuenta`}>
                                {p.member?.fullName ?? `Socio ${p.memberId}`}
                              </Link>
                              {i < arr.length - 1 ? "," : ""}
                            </span>
                          ))}
                        </span>
                      ) : r.status === "other_income" ? (
```

(el resto del ternario queda como está).

7. El link de acción: `{r.status === "open" || r.status === "partial" ? "Resolver" : "Ver"}`.

- [ ] **Step 4: Verificar**

Run: `npx tsc --noEmit && npx eslint src/app/admin/tesoreria/sin-conciliar/page.tsx src/lib/admin/health.ts && npm test -- tests/admin-health.test.ts tests/treasury-tabs.test.ts`
Expected: limpio. En el navegador: con la fila repartida en la Task 8, **Resueltos** muestra "Araoz Hugo, Maza Monica" y los dos números de recibo; tras anular una parte (Task 10) la fila aparece en **Pendientes** con badge "Parcial" y el total en pesos suma sólo el resto.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/tesoreria/sin-conciliar/page.tsx src/lib/admin/health.ts tests/admin-health.test.ts
git commit -m "feat(inbox): list and health count partial rows as pending; resolved rows show every part and receipt

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: La ficha del recibo dice si es parte de un reparto y qué pasa al anular

**Files:**
- Modify: `src/app/admin/tesoreria/recibos/[id]/page.tsx`
- Modify: `src/app/admin/tesoreria/recibos/[id]/receipt-actions.tsx` (prop `voidHint`)

**Interfaces:**
- Consumes: `sharedPaymentOf`, `loadGroup` (Task 2).
- Produces: `ReceiptActions` acepta `voidHint?: string | null` (una frase extra en el bloque de anulación).

- [ ] **Step 1: `ReceiptActions` acepta la frase**

En `receipt-actions.tsx`, sumar la prop:

```tsx
  /** Qué pasa con la bandeja al anular (parte de un reparto, spec 2026-09-10),
   *  ya redactado por el servidor. Null → nada extra. */
  voidHint?: string | null;
```

y dentro del `<details>` de anulación, después del `<p>` "El número no se reutiliza…":

```tsx
            {voidHint && <p className="text-sm text-warning">{voidHint}</p>}
```

- [ ] **Step 2: La página**

En `page.tsx` del recibo, imports: `import { loadGroup, sharedPaymentOf } from "@/lib/treasury/split-group";` y `import { INLINE_LINK } from "@/lib/admin/link-styles";`. En el `include` del `payment`, junto a `registeredBy`, sumar `splitParts: { select: { id: true } }`. Después de `const amount = …`:

```ts
  // Parte de un reparto (spec 2026-09-10 §7): total y fecha del cobro de MP, y
  // qué le pasa a la bandeja si este recibo se anula.
  const shared = await sharedPaymentOf(prisma, {
    amount, mpPaymentId: r.payment.mpPaymentId, splitOfPaymentId: r.payment.splitOfPaymentId,
    hasParts: r.payment.splitParts.length > 0,
  });
  let voidHint: string | null = null;
  if (shared && !voided) {
    const group = await loadGroup(prisma, { mpPaymentId: shared.mpPaymentId, amount: shared.total });
    const others = group.all.some((p) => p.status === "applied" && p.id !== r.payment.id);
    voidHint = others
      ? `Anularlo deja ${formatARS(amount)} sin asignar en la bandeja Sin conciliar.`
      : "Anularlo devuelve la fila a Pendientes en la bandeja Sin conciliar.";
  }
```

En el JSX, después del cartel `{r.voidedAt && (…)}`:

```tsx
      {shared && (
        <FormMessage kind="neutral" box as="div" role="none">
          Parte de un pago de <span className="font-mono tabular-nums">{formatARS(shared.total)}</span> cobrado por
          Mercado Pago el {formatDateAR(shared.paidAt)}.{" "}
          <Link className={INLINE_LINK} href={`/admin/tesoreria/sin-conciliar/${shared.rowId}`}>Ver en la bandeja</Link>
        </FormMessage>
      )}
```

y `<ReceiptActions … voidHint={voidHint} />`.

- [ ] **Step 3: Verificar**

Run: `npx tsc --noEmit && npx eslint "src/app/admin/tesoreria/recibos/[id]"` → limpio. Navegador: el recibo de Mónica del reparto muestra la línea "Parte de un pago de $ 18.000,00…" con el link; el bloque de anulación dice "Anularlo deja $ 6.000,00 sin asignar…"; anularlo lleva la fila a **Parcial** (Task 9) y en la fila el reparto queda prellenado con $ 6.000,00 (Task 8, punto 8). Anular después el de Hugo → la fila vuelve a **Pendiente**, y volver a repartirla funciona (las partes nuevas cuelgan del portador anulado). Un recibo de efectivo no muestra nada nuevo.

- [ ] **Step 4: Commit**

```bash
git add "src/app/admin/tesoreria/recibos/[id]/page.tsx" "src/app/admin/tesoreria/recibos/[id]/receipt-actions.tsx"
git commit -m "feat(receipts): receipt page names the shared MP payment and warns what voiding a part does to the inbox

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Integración contra MariaDB real — transacción, concurrencia, parcial, reapertura, reembolso y tiempo

**Files:**
- Create: `tests/integration/unmatched-split.test.ts`

**Interfaces:**
- Consumes: `makeTreasuryService`, `makeFeeValueReader`, `PrismaClient` + `PrismaMariaDb` (mismo arnés que `tests/integration/mp-apply-concurrency.test.ts`).

- [ ] **Step 1: El test**

```ts
// Corre SOLO con DATABASE_URL_TEST apuntando a una base migrada (la de Docker
// sirve). Prueba, contra MariaDB de verdad, el reparto de un cobro de la
// bandeja (spec 2026-09-10): una transacción, el portador primero, los números
// al final y consecutivos, la fila derivada del grupo, la reapertura, el
// reembolso por grupo, y el TIEMPO de cinco partes contra el timeout de 5 s.
//
// Serie del año 1997: 1998 y 1999 las usan los otros dos archivos (los tests de
// integración no corren en paralelo entre archivos, pero un año propio sigue
// siendo más barato que depender de eso).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "@/generated/prisma/client";
import { makeFeeValueReader } from "@/lib/treasury/fee-values";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import { makeTreasuryService } from "@/lib/treasury/service";
import { SPLIT_GUARD_MESSAGES as M } from "@/lib/treasury/split-messages";

const url = process.env.DATABASE_URL_TEST;

describe.skipIf(!url)("reparto de un cobro de la bandeja (MariaDB)", () => {
  const YEAR = 1997;
  const PAID_AT = new Date("1997-06-15T12:00:00Z");
  const MP_ID = "itest-split-18k";
  let prisma: PrismaClient;
  let actorId: number;
  let ids: number[] = []; // los socios de prueba, en orden

  function svc() {
    return makeTreasuryService({
      db: prisma,
      feeValues: makeFeeValueReader(prisma),
      renderPdf: async () => new Uint8Array(),
      writePdf: async () => {},
    });
  }

  async function seedRow(amount = 18000, mpPaymentId = MP_ID) {
    const row = await prisma.mpUnmatchedPayment.create({
      data: { mpPaymentId, amount: amount.toFixed(2), paidAt: PAID_AT, reason: "no_reference", payerEmail: null },
    });
    return row.id;
  }

  // Borra SOLO lo de los socios de prueba y la serie del año de prueba. Las
  // partes van antes que los portadores: la FK `split_of_payment_id` es RESTRICT.
  async function cleanup() {
    if (ids.length === 0) return;
    await prisma.mpUnmatchedPayment.deleteMany({ where: { mpPaymentId: { startsWith: "itest-split" } } });
    const pays = (await prisma.payment.findMany({ where: { memberId: { in: ids } }, select: { id: true } })).map((p) => p.id);
    if (pays.length > 0) {
      await prisma.receipt.deleteMany({ where: { paymentId: { in: pays } } });
      await prisma.fee.deleteMany({ where: { paymentId: { in: pays } } });
    }
    await prisma.fee.deleteMany({ where: { memberId: { in: ids } } });
    await prisma.payment.deleteMany({ where: { memberId: { in: ids }, splitOfPaymentId: { not: null } } });
    await prisma.payment.deleteMany({ where: { memberId: { in: ids } } });
    await prisma.receiptSequence.deleteMany({ where: { year: YEAR } });
  }

  async function seedFees(memberId: number, periods: string[]) {
    await prisma.fee.createMany({
      data: periods.map((period) => ({ memberId, period, status: "pending", origin: "import" })),
    });
  }

  beforeAll(async () => {
    prisma = new PrismaClient({ adapter: new PrismaMariaDb(url ?? "") });
    const admin = await prisma.user.findFirst({ select: { id: true } });
    if (!admin) throw new Error("La base de prueba necesita al menos un usuario (el seed lo crea).");
    actorId = admin.id;
    for (const name of ["A", "B", "C", "D", "E"]) {
      const m = await prisma.member.create({
        data: { fullName: `Itest, Reparto ${name}`, category: "active", status: "active", joinedAt: new Date("1996-01-01T12:00:00Z") },
      });
      ids.push(m.id);
    }
  });

  beforeEach(async () => {
    await cleanup();
    // A debe marzo y abril de 1997; B, abril; C, D y E, abril.
    await seedFees(ids[0], ["1997-03", "1997-04"]);
    for (const id of ids.slice(1)) await seedFees(id, ["1997-04"]);
  });

  afterAll(async () => {
    await cleanup();
    if (ids.length > 0) await prisma.member.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  });

  const twoPlusOne = () => [
    { memberId: ids[0], concept: "fees" as const, n: 2, amount: 12000 },
    { memberId: ids[1], concept: "fees" as const, n: 1, amount: 6000 },
  ];

  it("2 + 1 en una transacción: dos recibos consecutivos, portador con el id de MP, parte apuntando a él, fila matched", async () => {
    const rowId = await seedRow();
    const r = await svc().registerSplitPayment({ rowId, parts: twoPlusOne(), actorId });
    if (r.kind !== "registered") throw new Error(r.kind);
    expect(r.rowStatus).toBe("matched");
    expect(r.parts.map((p) => p.number)).toEqual(["1997-00001", "1997-00002"]);
    const holder = await prisma.payment.findUniqueOrThrow({ where: { mpPaymentId: MP_ID } });
    expect(holder).toMatchObject({ memberId: ids[0], amount: expect.anything(), splitOfPaymentId: null });
    expect(Number(holder.amount)).toBe(12000);
    const part = await prisma.payment.findUniqueOrThrow({ where: { id: r.parts[1].paymentId } });
    expect(part).toMatchObject({ memberId: ids[1], mpPaymentId: null, splitOfPaymentId: holder.id });
    expect(Number(part.amount)).toBe(6000);
    const row = await prisma.mpUnmatchedPayment.findUniqueOrThrow({ where: { id: rowId } });
    expect(row).toMatchObject({ status: "matched", paymentId: holder.id, resolvedById: actorId });
    expect(await prisma.fee.count({ where: { memberId: { in: [ids[0], ids[1]] }, status: "paid" } })).toBe(3);
    expect((await prisma.receiptSequence.findUniqueOrThrow({ where: { year: YEAR } })).last).toBe(2);
  });

  it("dos repartos a la vez sobre la misma fila: uno gana, el otro lo lee, la serie no tiene huecos", async () => {
    const rowId = await seedRow();
    const s = svc();
    const results = await Promise.allSettled([
      s.registerSplitPayment({ rowId, parts: twoPlusOne(), actorId }),
      s.registerSplitPayment({ rowId, parts: [{ memberId: ids[2], concept: "fees", n: 1, amount: 18000 }], actorId }),
    ]);
    const ok = results.filter((x) => x.status === "fulfilled");
    const ko = results.filter((x) => x.status === "rejected") as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(ko).toHaveLength(1);
    expect([M.rowResolved, M.changed]).toContain(ko[0].reason.message);
    expect(await prisma.payment.count({ where: { OR: [{ mpPaymentId: MP_ID }, { splitOf: { mpPaymentId: MP_ID } }] } })).toBe(2);
    expect((await prisma.receiptSequence.findUniqueOrThrow({ where: { year: YEAR } })).last).toBe(2);
  });

  it("anular una parte → partial con el resto; reasignar → matched; anular todo → open; volver a repartir cuelga del portador anulado", async () => {
    const rowId = await seedRow();
    const s = svc();
    const r = await s.registerSplitPayment({ rowId, parts: twoPlusOne(), actorId });
    if (r.kind !== "registered") throw new Error(r.kind);
    await s.voidReceipt({ receiptId: r.parts[1].receiptId, actorId, reason: "no era" });
    expect(await prisma.mpUnmatchedPayment.findUniqueOrThrow({ where: { id: rowId } })).toMatchObject({ status: "partial", paymentId: r.parts[0].paymentId });
    const r2 = await s.registerSplitPayment({ rowId, parts: [{ memberId: ids[2], concept: "fees", n: 1, amount: 6000 }], actorId });
    if (r2.kind !== "registered") throw new Error(r2.kind);
    expect(r2.parts[0].number).toBe("1997-00003");
    expect(await prisma.mpUnmatchedPayment.findUniqueOrThrow({ where: { id: rowId } })).toMatchObject({ status: "matched" });
    await s.voidReceipt({ receiptId: r2.parts[0].receiptId, actorId, reason: "tampoco" });
    await s.voidReceipt({ receiptId: r.parts[0].receiptId, actorId, reason: "error" });
    expect(await prisma.mpUnmatchedPayment.findUniqueOrThrow({ where: { id: rowId } })).toMatchObject({ status: "open", paymentId: null });
    // El callejón de hoy, destrabado: la fila reabierta se vuelve a aplicar.
    const r3 = await s.registerSplitPayment({ rowId, parts: twoPlusOne(), actorId });
    if (r3.kind !== "registered") throw new Error(r3.kind);
    const holder = await prisma.payment.findUniqueOrThrow({ where: { mpPaymentId: MP_ID } });
    expect(holder.status).toBe("voided");
    for (const p of r3.parts) {
      expect(await prisma.payment.findUniqueOrThrow({ where: { id: p.paymentId } })).toMatchObject({ mpPaymentId: null, splitOfPaymentId: holder.id, status: "applied" });
    }
    expect(r3.parts.map((p) => p.number)).toEqual(["1997-00004", "1997-00005"]);
  });

  it("reembolso de MP: revierte todas las partes aplicadas y reabre la fila; el reintento da already_reverted", async () => {
    const rowId = await seedRow();
    const s = svc();
    await s.registerSplitPayment({ rowId, parts: twoPlusOne(), actorId });
    const r = await s.refundPayment({ mpPaymentId: MP_ID, reason: "Reembolso en Mercado Pago" });
    expect(r).toMatchObject({ kind: "refunded", periodsReverted: 3, parts: 2 });
    expect(await prisma.payment.count({ where: { memberId: { in: ids }, status: "refunded" } })).toBe(2);
    expect(await prisma.fee.count({ where: { memberId: { in: [ids[0], ids[1]] }, status: "pending" } })).toBe(3);
    expect(await prisma.mpUnmatchedPayment.findUniqueOrThrow({ where: { id: rowId } })).toMatchObject({ status: "open", paymentId: null });
    expect(await s.refundPayment({ mpPaymentId: MP_ID, reason: "x" })).toEqual({ kind: "already_reverted", status: "refunded" });
  });

  it("cinco partes entran en el presupuesto de 5 s de Prisma (tiempo medido)", async () => {
    const rowId = await seedRow(30000, "itest-split-30k");
    const parts = ids.map((memberId) => ({ memberId, concept: "fees" as const, n: 1, amount: 6000 }));
    const t0 = performance.now();
    const r = await svc().registerSplitPayment({ rowId, parts, actorId });
    const ms = performance.now() - t0;
    if (r.kind !== "registered") throw new Error(r.kind);
    console.log(`[unmatched-split] 5 partes en ${ms.toFixed(0)} ms`);
    expect(r.parts.map((p) => p.number)).toEqual(["1997-00001", "1997-00002", "1997-00003", "1997-00004", "1997-00005"]);
    expect(ms).toBeLessThan(5000);
  });
});
```

- [ ] **Step 2: Correr**

Run (PowerShell): `$env:DATABASE_URL_TEST="mysql://sigev:sigev_dev@localhost:3306/sigev"; npm run test:integration -- tests/integration/unmatched-split.test.ts`
Expected: 5 PASS; en la salida, la línea `[unmatched-split] 5 partes en NNN ms` — **anotar NNN** para el informe (Task 13). Si la base de Docker no tiene usuarios, correr `npx prisma db seed` antes.

Después correr los tres archivos de integración juntos para confirmar que no se pisan: `npm run test:integration` → PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/unmatched-split.test.ts
git commit -m "test(integration): inbox split against MariaDB — one transaction, concurrency, partial rows, reopen, refund, 5-part timing

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: Documentación

**Files:**
- Modify: `docs/04-modelo-de-datos.md` (secciones `### Pago` y `### PagoSinConciliar`)
- Modify: `docs/05-flujos-funcionales.md:385-399` (bullet "Sin conciliar")
- Modify: `docs/06-integracion-mercadopago.md` (§4 refund, matriz de conciliación, nuevo §10)
- Modify: `docs/07-plan-de-etapas.md` (fila CA5 de la 4B, deuda "Reimputar un cobro", nueva sección de fase)
- Modify: `docs/10-runbook-dominio-produccion.md` (nueva §4.10)
- Modify: `CLAUDE.md` (nueva sección de patrones + "Prioridad actual")

- [ ] **Step 1: `docs/04`**

En `### Pago`, después de la viñeta de `mp_payment_id`, agregar:

```markdown
- **`split_of_payment_id`** (nullable, FK a `payments`, RESTRICT; reparto, spec
  2026-09-10): esta parte pertenece al dinero de MP que porta ese pago. El
  **portador** es el pago que lleva `mp_payment_id`; las partes llevan este puntero
  y `mp_payment_id` en NULL. Nunca las dos cosas: lo garantiza el núcleo
  (`writePaymentAndFees`). El **grupo** de un cobro = portador + partes; el
  reembolso lo revierte entero y la fila de la bandeja se decide por su suma
  (`split-group.ts`). Un cobro sin reparto es un portador sin partes.
```

En `### PagoSinConciliar`: `estado` pasa a `(open | partial | matched | dismissed | other_income)`, y la viñeta **"La fila se cierra sola al aplicar y se reabre al anular"** se reemplaza por:

```markdown
- **El estado se DERIVA del grupo y lo escribe siempre el núcleo** (spec 2026-09-10
  §4.3): `asignado` = Σ pagos `applied` del grupo; `open` ⇔ nada asignado,
  `partial` ⇔ queda plata sin asignar, `matched` ⇔ todo asignado. `registerSplitPayment`
  cierra (o deja `partial`) dentro de la misma transacción, con `resuelto_por`;
  anular una parte recalcula el grupo dentro de la transacción de la reversión
  (`open` con `pago_id` en NULL si no queda ninguna aplicada, `partial` si queda
  alguna); un reembolso revierte todo el grupo y la reabre. Una fila reabierta
  **se puede volver a aplicar**: las partes nuevas cuelgan del portador anulado,
  que conserva su `mp_payment_id` (la barrera contra reenvíos no se toca).
```

- [ ] **Step 2: `docs/05`**

Reemplazar el bullet completo de **Sin conciliar** (desde `- **Sin conciliar** (` hasta `…en vez de dejar que alguien descarte plata real.`) por:

```markdown
- **Sin conciliar** (`/admin/tesoreria/sin-conciliar`) — la plata de Mercado Pago que
  no se pudo atribuir a nadie. El encabezado de Pendientes muestra la **suma en
  pesos** sin asignar (el importe de las `open` más el resto de las `partial`).
  Pendientes = `open` + `partial`; Resueltos = aplicadas, ingresos no societarios y
  descartadas. Cada fila lleva a un detalle con **tres salidas**:
  1. **Repartir entre socios** (spec 2026-09-10): hasta 5 socios, que viajan en la
     URL (`?socios=`). Sugerencias por la casilla del pagador y buscador; una parte
     por socio con concepto según su categoría (la misma regla que Efectivo y la
     exención vigente), cantidad de cuotas e importe prellenado con n × valor
     vigente; la suma tiene que dar **exactamente** lo sin asignar. **Dos pasos**:
     el primero devuelve la confirmación resuelta en el servidor (qué cuotas se
     imputan a cada uno, importes y total), el segundo emite un recibo por socio
     en una sola transacción. Un solo socio es el caso de una parte.
  2. **Registrarlo como ingreso no societario**, con concepto en texto libre. **No
     emite recibo.** Sólo con la fila `open`.
  3. **Descartar**, con motivo. Sólo con la fila `open`.
  Anular el recibo de una parte deja la fila **Parcial** con el resto sin asignar,
  que se asigna desde la misma pantalla; anular todas la devuelve a Pendientes y se
  puede volver a aplicar. Cada recibo de un reparto lleva la leyenda "Parte de un
  pago de $ X cobrado por Mercado Pago el DD/MM/AAAA".
```

- [ ] **Step 3: `docs/06`**

1. En §4, la línea `` `refunded` / `charged_back` → `payment_refunded`: **anula el recibo y devuelve las cuotas a pendientes** `` pasa a: `` `refunded` / `charged_back` → `payment_refunded`: **anula el recibo —o TODOS los recibos del grupo, si el cobro se repartió (spec 2026-09-10)— y devuelve las cuotas a pendientes** ``.
2. En la **Matriz de conciliación**, la fila `| Pago suelto / transferencia al CVU | — | Manual (bandeja "Sin conciliar") |` pasa a `| Pago suelto / transferencia al CVU | — | Manual (bandeja "Sin conciliar"), a uno o varios socios (§10) |`.
3. Después de §9, antes de `## Matriz de conciliación`, nueva sección:

```markdown
### 10. Reparto de un cobro entre socios

Un cobro sin referencia puede ser de más de un socio (un matrimonio que transfiere
las cuotas de los dos). Desde la bandeja se reparte entre hasta cinco socios
(spec `docs/superpowers/specs/2026-09-10-unmatched-split-design.md`):

- **Un `Payment` por socio, cada uno con su recibo**, en **una** transacción con la
  fila bloqueada (`SELECT … FOR UPDATE`). Uno solo, el **portador**, lleva el
  `mpPaymentId`; los demás apuntan a él con `splitOfPaymentId`. Las tres barreras
  de idempotencia por `mpPaymentId` (`payments`, `mp_unmatched_payments`,
  `other_incomes`) quedan intactas; `resolve.ts` y `reconcile` encuentran al
  portador y responden `already_processed` como siempre.
- **La suma de las partes = lo cobrado, exacto a centavos**, revalidado dentro de
  la transacción. Las guardas por socio son las de Efectivo (`cashConceptsFor`) más
  la exención vigente (`activeExemption`).
- **La fila se deriva del grupo**: `partial` mientras quede plata sin asignar.
  Anular una parte → `partial`; anular todas → `open`, y la fila se vuelve a
  aplicar (las partes nuevas cuelgan del portador anulado). Un reembolso de MP
  revierte todo el grupo.
- El tipo `link` se rotula **"Mercado Pago"** en recibo, email y cuenta corriente:
  la bandeja asienta con él también las transferencias, y el gateway no lee
  `payment_type_id`.
```

- [ ] **Step 4: `docs/07`**

1. Fila **5** de la tabla de CA de la 4B: el Estado pasa a `✅ el primer caso real (08/09/2026, $ 18.000 sin referencia) se resolvió con el reparto entre dos socios (fase 4D); la reapertura al anular pasó a ser por grupo`.
2. La viñeta de deuda `- **Reimputar un cobro cuyo recibo se anuló** no tiene camino…` pasa a: `- **Reimputar un cobro cuyo recibo se anuló**: resuelto en la fase 4D (10/09/2026). La fila reabierta se vuelve a aplicar; las partes nuevas cuelgan del portador anulado, que conserva su `mpPaymentId`. Sigue sin camino la reimputación de un débito de suscripción anulado por mostrador FUERA de la bandeja (el reenvío de MP responde `already_processed`).`
3. Después de la sección de la 4C (antes de `### Insumos que deja el Módulo 3 para el Módulo 4`), nueva sección:

```markdown
### Fase 4D — Reparto de un cobro entre socios — **CERRADA** (<fecha del cierre>)

Spec: `docs/superpowers/specs/2026-09-10-unmatched-split-design.md`. Plan:
`docs/superpowers/plans/2026-09-10-unmatched-split.md`. Disparador: el cobro de
$ 18.000 sin referencia del 08/09/2026 (dos cuotas de un socio y una de su esposa).

- `Payment.splitOfPaymentId` (portador + partes), `UnmatchedStatus.partial`, una
  migración. `registerSplitPayment` en `service.ts`, sobre el núcleo refactorizado
  en `preparePart` / `writePaymentAndFees` / `issueReceipt` sin cambio de
  comportamiento (la suite de la 4A/4B pasó sin tocar una aserción).
- Anulación y reembolso por grupo; la fila reabierta se vuelve a aplicar.
- Pantalla Resolver con reparto tipo boleta, sugerencias por casilla, dos pasos con
  token; la lista y `/admin/salud` cuentan `open + partial`; leyenda en PDF y email;
  `link` → "Mercado Pago".
- Tres huecos de la bandeja cerrados: conceptos por categoría, exención vigente y
  suma exacta.

| # | Criterio | Estado |
|---|---|---|
| 1 | $ 18.000 → 2 cuotas a A + 1 a B → dos recibos consecutivos, fila Aplicado, cada socio ve su recibo, PDFs con leyenda y "Mercado Pago" | <resultado> |
| 2 | Suma inexacta: botón bloqueado; POST a mano rechazado sin consumir número | <resultado> |
| 3 | Anular el recibo de B → Parcial con $ 6.000; reasignar a C → Aplicado; el de A intacto | <resultado> |
| 4 | Anular todo → Pendiente; volver a aplicar funciona; el portador anulado conserva `mpPaymentId` | <resultado> |
| 5 | `refunded` de MP → todas las partes `refunded`, cuotas pendientes, fila Pendiente; reintento → `refund_ignored` | <resultado> |
| 6 | Dos repartos concurrentes → uno gana, el otro lee "cambió mientras"/"ya fue resuelta"; sin huecos | <resultado> |
| 7 | Adherente sin cuotas; exento sólo aportes con el acta; cesante sólo deuda | <resultado> |
| 8 | Una parte en fila fresca ≡ las filas de hoy | <resultado> |
| 9 | Cinco partes contra MariaDB: <NNN> ms (< 5 s) | <resultado> |
| 10 | Suite verde sin tocar aserciones de `treasury-service` ni `mp-apply-concurrency`; `tsc`, lint y build en verde | <resultado> |
```

(Los `<…>` los completa la Task 13 con lo medido.)

- [ ] **Step 5: `docs/10`**

Después de §4.9, nueva subsección:

```markdown
### 4.10 Específico de la fase 4D (reparto de un cobro entre socios)

Trae **una migración** (`payment_split`: columna `payments.split_of_payment_id` +
FK + índice, y el valor `partial` en el enum de `mp_unmatched_payments.status`).
`deploy.sh` la aplica; no hay backfill ni script.

Verificación post-deploy:

1. `/admin/tesoreria/sin-conciliar` abre y lista la fila de $ 18.000 del 08/09 como
   Pendiente.
2. Resolverla: agregar a los dos socios (la casilla del pagador los sugiere), 2
   cuotas al socio y 1 a la socia, Revisar → Confirmar. Tienen que salir **dos
   recibos consecutivos** y la fila quedar **Aplicado** con las dos partes.
3. Abrir cada recibo: leyenda "Parte de un pago de $ 18.000,00…" y medio
   "Mercado Pago". `/admin/salud` no cambia de veredicto.
4. Si algo sale mal a mitad del reparto, **no hay estado intermedio**: es una sola
   transacción. Revisar `pm2 logs sigev --lines 50 --nostream` por
   `[treasury]` y volver a intentar desde la misma fila.
```

- [ ] **Step 6: `CLAUDE.md`**

Después de la sección `## Patrones que estrenó el Módulo 7 (Reportes)` (antes de `## Flujo de trabajo con el operador`), nueva sección:

```markdown
## Patrones que estrenó el reparto de la bandeja (fase 4D, 10/09/2026)

- **Portador + partes, en UNA transacción.** Un cobro de MP repartido entre
  socios es un `Payment` por socio; uno solo (el portador) lleva `mpPaymentId` y
  los demás apuntan a él con `splitOfPaymentId`. Las tres barreras de
  idempotencia por `mpPaymentId` no se tocaron. El portador es el PRIMER INSERT
  (si el unique choca, muere antes de pedir número), la fila se bloquea con
  `SELECT … FOR UPDATE` y la suma se revalida adentro; los números, al final,
  uno por parte. `registerSplitPayment` es el único escritor del reparto y la
  bandeja lo llama SIEMPRE, también con una sola parte.
- **El estado de la fila se DERIVA del grupo y lo escribe el núcleo.**
  `groupTotals` (`split-group.ts`) es la única aritmética para la pantalla, la
  lista y el núcleo: `open` / `partial` / `matched` según Σ `applied` del grupo.
  Anular una parte recalcula el grupo dentro de la reversión; un reembolso
  revierte el grupo entero. Corolario: la fila reabierta se vuelve a aplicar
  (las partes nuevas cuelgan del portador anulado) — el callejón de la 4B se
  cerró sin tocar la barrera.
- **El refactor del núcleo fue sin cambio de comportamiento, con la suite vieja
  como red.** `registerPaymentCore` se partió en `preparePart` /
  `writePaymentAndFees` / `issueReceipt`, y `tests/treasury-service.test.ts` y
  `tests/integration/mp-apply-concurrency.test.ts` pasaron sin tocar una
  aserción (sólo se extendió el fake). Rediseñar una pantalla no autoriza a
  reescribir su lógica; refactorizar el núcleo tampoco.
- **La bandeja era un sexto camino de cobro sin las guardas de los otros
  cinco.** Ahora usa `cashConceptsFor` (la misma función que Efectivo) y
  `activeExemption` (la misma que las otras guardas), y `SPLIT_GUARD_MESSAGES`
  es el único texto: la action pre-valida lo barato y el núcleo revalida todo.
- **`link` se rotula "Mercado Pago".** La bandeja asienta con ese tipo también
  las transferencias; el gateway no lee `payment_type_id` y un tipo nuevo habría
  sido un dato que el operador tiene que adivinar.
```

Y en **Prioridad actual**, después del párrafo del Módulo 7, agregar:

```markdown
La **fase 4D (reparto de un cobro de la bandeja entre socios)** está en la rama
`unmatched-split` (spec 2026-09-10): trae una migración (`payment_split`) y su
verificación post-deploy es `docs/10` §4.10. Los $ 18.000 del 08/09 esperan ese
despliegue para repartirse 2+1 desde la pantalla.
```

- [ ] **Step 7: Commit**

```bash
git add docs/04-modelo-de-datos.md docs/05-flujos-funcionales.md docs/06-integracion-mercadopago.md docs/07-plan-de-etapas.md docs/10-runbook-dominio-produccion.md CLAUDE.md
git commit -m "docs: phase 4D — inbox split among members (data model, flows, MP integration, plan, runbook, CLAUDE.md)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: Verificación y auditoría final (obligatoria para declarar la rama cerrada)

**Files:**
- Create: `.superpowers/sdd/unmatched-split/verification.md`
- Modify: `docs/07-plan-de-etapas.md` (completar los `<…>` de la tabla de la 4D)

- [ ] **Step 1: Suite entera con conteo contra `main`**

```bash
git stash list  # nada pendiente
npm test 2>&1 | tail -6
git checkout main -q && npm test 2>&1 | tail -6 && git checkout unmatched-split -q
```

Anotar los dos conteos (archivos y tests). El de la rama tiene que ser **mayor** (tests nuevos) y sin ningún `failed`.

- [ ] **Step 2: Integración, tipos, lint, build**

```bash
$env:DATABASE_URL_TEST="mysql://sigev:sigev_dev@localhost:3306/sigev"; npm run test:integration
npx tsc --noEmit
npm run lint
npm run build
```

Expected: todo en verde; anotar la línea `[unmatched-split] 5 partes en NNN ms`.

- [ ] **Step 3: Auditoría del diff contra la lista del plan**

```bash
git diff --stat main..unmatched-split
git diff main..unmatched-split -- src/lib/mp/
git diff main..unmatched-split -- tests/treasury-service.test.ts tests/integration/mp-apply-concurrency.test.ts tests/integration/receipt-sequence.test.ts
git diff main..unmatched-split -- src/lib/treasury/rules.ts src/lib/treasury/fee-values.ts src/lib/treasury/receipt-number.ts src/lib/treasury/unique-violation.ts prisma/
```

Verificar y anotar:
- `src/lib/mp/`: **sólo** `webhook-processor.ts`, una línea (`parts` en el detalle).
- `tests/treasury-service.test.ts`: sólo el fake (`payment.findMany` y `receipt.findFirst`); **ningún `expect` cambiado**. Los dos de integración viejos: **sin diff**.
- `rules.ts`, `fee-values.ts`, `receipt-number.ts`, `unique-violation.ts`: sin diff. `prisma/`: sólo `schema.prisma` y la migración `payment_split`.
- Todo archivo del `--stat` está en el **Mapa de archivos** del plan; cualquiera que no esté se explica en el informe o se revierte.

- [ ] **Step 4: Revisión de código por subagente (modelo Fable)**

Dispatch de un revisor con el diff completo `main..unmatched-split`, la spec y este plan, con foco en: (1) REG-33 en `registerSplitCore` (portador primero, números al final, rollback sin número), (2) la reapertura por grupo en `revertCore` para pago suelto / efectivo / parte / portador, (3) `refundPayment` idempotente por parte, (4) Ley 25.326 en el asiento `unmatched_resolve` y en los logs, (5) que ninguna pantalla haya reimplementado `groupTotals`, `cashConceptsFor` ni `activeExemption`. Los hallazgos se corrigen antes de cerrar y quedan listados en el informe.

- [ ] **Step 5: Prueba en el navegador, de punta a punta, con capturas**

Con la base local sembrada (`scripts/dev/seed-unmatched.ts`), recorrer los CA 1, 2 (botón bloqueado), 3, 4 y 7 de la spec §13 en el navegador (`preview_start`, `read_page`, `computer` screenshot), además de `/mi/cuenta` de cada socio del reparto (su recibo, "Mercado Pago" como medio, el PDF ajeno da 404), la lista con una fila Parcial, y móvil. Capturas en `.superpowers/sdd/unmatched-split/`. Al terminar, dejar la base local como estaba (borrar la fila sembrada y sus pagos, o restaurar según `sigev-datos-de-prueba`).

- [ ] **Step 6: Informe**

`.superpowers/sdd/unmatched-split/verification.md` con: conteos de la suite (main vs rama), resultado de integración con el tiempo de 5 partes, `tsc`/lint/build, la auditoría del diff (lista de archivos y los tres "sin diff"), los hallazgos del revisor y su resolución, el recorrido en navegador con capturas, y la tabla de CA de la spec §13 con el resultado real de cada uno (incluidos los que no se pudieron verificar y por qué). Completar los `<…>` de la tabla de la 4D en `docs/07`.

- [ ] **Step 7: Commit final**

```bash
git add .superpowers/sdd/unmatched-split docs/07-plan-de-etapas.md
git commit -m "chore(4D): final verification report and acceptance table

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git log --oneline main..unmatched-split
```

El merge a `main` y el `git push` los decide y corre el operador (el push está bloqueado en este entorno). Dejarle el comando copiable y el recordatorio de `docs/10` §4.10 para el despliegue.

