# Pagos ajenos en la conciliación diaria — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el paso 1 de la conciliación diaria deje de tratar como cobro lo que la cuenta de Mercado Pago **pagó** (la factura mensual de MP, que llega por `payments/search` con `collector_id` ausente), y que ese mismo paso le pase al procesador el id de suscripción que el pago trae, como ya hace el webhook.

**Architecture:** El gateway mapea `collector_id` a `collectorId` y expone `ownAccountId()` (`GET /users/me`, cacheado por proceso). Un predicado puro `isOwnCollection` decide "propio o nada". El reconcile resuelve el id propio antes de la búsqueda (si falla, el paso 1 no corre y queda en `errors[]`), saltea lo ajeno contándolo en `paymentsForeign` y auditándolo **una vez** por pago, y llama `applyPayment(p, p.subscriptionId)` en vez de `null`. Nada más cambia: ni `applyPayment`, ni el webhook, ni la bandeja, ni tesorería.

**Tech Stack:** Next.js 16 / TypeScript, vitest (`npx vitest run`), Prisma sobre MariaDB (sin migración en este plan), `fetch` directo a la API de MP (sin SDK para `/users/me`).

**Spec:** `docs/superpowers/specs/2026-09-11-foreign-payments-reconcile-design.md` (aprobada y commiteada en `c25bc1b`). Léela entera antes de la Task 1.

## Global Constraints

- **Rama:** `reconcile-foreign-payments`, creada desde `main` en `c25bc1b`. El árbol de trabajo tiene un `M datos/padron_socios.xlsx` y dos rutas sin seguimiento (`assets/hero-2.jpg`, `est/`) que **no son de este plan**: nunca `git add -A`; se agregan archivos por nombre.
- **No se toca:** `src/lib/treasury/*`, `prisma/*`, `src/app/*`, `src/lib/mp/webhook-processor.ts`, `src/lib/mp/resolve.ts`, `src/lib/mp/unmatched.ts`, `src/lib/mp/link-subscription.ts`, `.env.example`. Los parámetros de `searchPayments` quedan **idénticos** (no se manda `collector.id`).
- **TDD estricto:** cada test se escribe primero, se corre y se ve fallar por la razón esperada; recién ahí se implementa. Cada guarda nueva se verifica por **mutación** (borrarla, ver el test en rojo, restaurar) y la mutación se anota en el informe de la Task 6.
- **Idioma:** comentarios de código y docs en español (es-AR), nombres de código y mensajes de commit en inglés. Commits terminan con `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- **Conteo de base en `main` (medido el 11/09/2026, `npx vitest run`):** `Test Files 292 passed | 4 skipped (296)`, `Tests 4150 passed | 14 skipped (4164)`. Este plan agrega **16 tests y 1 archivo**: el cierre tiene que dar **293 archivos** y **4166 tests** en verde, 14 skipped sin cambio.
- **Datos medidos que los tests fijan:** id propio `1978062823` (entero en MP, texto en el dominio); pago ajeno `178354740076` de `94.88`, `description: "Facturas con cargos por operar"`, `external_reference: "[5117560041]"`, clave `collector_id` **ausente**; débito `177432666739` con `subscriptionId: "4b3e9b33a2954b82b7dfc25d5dbccf01"` y `external_reference: "socio:255"`.

---

## Estructura de archivos

| Archivo | Responsabilidad | Task |
|---|---|---|
| `src/lib/mp/gateway.ts` (modificar) | `collectorId` en `MpPaymentDetails`; `ownAccountId()` con cache; `retrying` | 1 |
| `tests/mp-gateway.test.ts` (modificar) | 6 tests: mapeo de `collector_id` en búsqueda y por id; `/users/me`, cache, fallo, sin id | 1 |
| `src/lib/mp/own-collection.ts` (crear) | `isOwnCollection` + `FOREIGN_PAYMENT_ACTION`; puro | 2 |
| `tests/mp-own-collection.test.ts` (crear) | 5 tests: tabla del predicado + la constante | 2 |
| `src/lib/mp/reconcile.ts` (modificar) | paso 1: id propio, guarda, `paymentsForeign`, asiento único, fail-closed; después `p.subscriptionId` | 3, 4 |
| `tests/mp-reconcile.test.ts` (modificar) | doble extendido; 4 tests de la guarda + 1 del `subscriptionId` | 3, 4 |
| `docs/06`, `docs/07`, `docs/10`, `docs/11`, `CLAUDE.md` (modificar) | lo medido, el diseño, la verificación post-deploy, el patrón | 5 |
| `.superpowers/sdd/foreign-payments-verificacion.md` (crear, git-ignored) | informe de la verificación final | 6 |

---

### Task 1: Gateway — `collectorId` mapeado y `ownAccountId()` cacheado

**Files:**
- Modify: `src/lib/mp/gateway.ts` (`MpPaymentDetails` líneas 9-29; tipo `MpGateway` desde la línea 48; `RawPayment` 149-161; `mapPayment` 163-181; `makeMpGateway` desde 234; bloque `retrying` 437-449)
- Test: `tests/mp-gateway.test.ts` (`describe("getPayment (4B)")` línea 133; `describe("searchPayments")` línea 359)

**Interfaces:**
- Consumes: nada nuevo.
- Produces: `MpPaymentDetails.collectorId: string | null`; `MpGateway.ownAccountId(): Promise<string>`. Las Tasks 2 y 3 dependen de estos dos nombres exactos.

- [ ] **Step 0: Crear la rama**

```bash
git checkout main && git pull --ff-only 2>/dev/null; git log --oneline -1
git checkout -b reconcile-foreign-payments
```
Expected: `c25bc1b docs(spec): foreign payments in the daily reconcile …` y la rama nueva activa. Si `git pull` falla por no tener remoto configurado en esta máquina, ignorarlo: `main` local ya está en `c25bc1b`.

- [ ] **Step 1: Escribir los tests que fallan**

En `tests/mp-gateway.test.ts`, dentro de `describe("searchPayments", …)` (después del `it("busca approved por date_approved desde `since`")`), agregar:

```ts
  // Medido el 11/09/2026 sobre los 13 pagos productivos desde julio: los cobros
  // traen `collector_id` como ENTERO igual al id de la cuenta; la factura mensual
  // de MP por cargos de operar —que la cuenta PAGÓ— viene sin la clave.
  it("mapea collector_id a texto; ausente o null → null", async () => {
    mocks.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          paging: { total: 3, limit: 100, offset: 0 },
          results: [
            { id: 1, status: "approved", transaction_amount: 6000, collector_id: 1978062823 },
            { id: 178354740076, status: "approved", transaction_amount: 94.88, description: "Facturas con cargos por operar", external_reference: "[5117560041]" },
            { id: 3, status: "approved", transaction_amount: 1, collector_id: null },
          ],
        }),
        { status: 200 },
      ),
    );
    const rows = await makeMpGateway().searchPayments({ since: new Date("2026-09-07T11:00:00Z") });
    expect(rows.map((r) => r.collectorId)).toEqual(["1978062823", null, null]);
    // Lo ajeno sigue saliendo del gateway: quién lo descarta es el cron, que
    // además lo cuenta y lo audita. El gateway sólo expone el dato.
    expect(rows).toHaveLength(3);
  });
```

Dentro de `describe("getPayment (4B)", …)`, después del `it("un pago que no viene de una suscripción no inventa preapproval")`, agregar:

```ts
  it("mapea collector_id (entero en MP) a texto", async () => {
    mocks.paymentGet.mockResolvedValue({ id: 5, status: "approved", transaction_amount: 3000, collector_id: 1978062823 });
    expect((await makeMpGateway().getPayment("5")).collectorId).toBe("1978062823");
  });
```

Al final del archivo (después del `describe("createPreference", …)`), agregar el bloque nuevo:

```ts
// ── 11/09/2026: el id de la cuenta propia. `payments/search` devuelve también lo
// que la cuenta PAGÓ, y sin este id el cron no tiene contra qué comparar. ──────

describe("ownAccountId", () => {
  const me = () =>
    new Response(JSON.stringify({ id: 1978062823, nickname: "VECINALCIUDADELA", site_id: "MLA" }), { status: 200 });

  it("pide GET /users/me con el bearer y devuelve el id como texto", async () => {
    mocks.fetch.mockResolvedValueOnce(me());
    expect(await makeMpGateway().ownAccountId()).toBe("1978062823");
    const [url, init] = mocks.fetch.mock.calls[0];
    expect(String(url)).toBe("https://api.mercadopago.com/users/me");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer TEST-token" });
  });

  it("cachea en el gateway: la segunda llamada no vuelve a pedir", async () => {
    mocks.fetch.mockResolvedValueOnce(me());
    const g = makeMpGateway();
    await g.ownAccountId();
    expect(await g.ownAccountId()).toBe("1978062823");
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it("una respuesta no-2xx lanza con el status colgado y NO se cachea: la siguiente vuelve a pedir", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response("{}", { status: 500 }));
    const g = makeMpGateway();
    await expect(g.ownAccountId()).rejects.toMatchObject({ status: 500 });
    mocks.fetch.mockResolvedValueOnce(me());
    expect(await g.ownAccountId()).toBe("1978062823");
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  it("una respuesta sin id lanza", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ nickname: "x" }), { status: 200 }));
    await expect(makeMpGateway().ownAccountId()).rejects.toThrow(/id de la cuenta/);
  });
});
```

- [ ] **Step 2: Correr y verlos fallar**

```bash
npx vitest run tests/mp-gateway.test.ts 2>&1 | tail -30
```
Expected: 6 tests en rojo. Los de `collectorId` fallan con `expected [ undefined, undefined, undefined ] to deeply equal [ "1978062823", null, null ]` (y `expected undefined to be "1978062823"`); los de `ownAccountId` con `makeMpGateway(...).ownAccountId is not a function`. El resto del archivo sigue en verde.

- [ ] **Step 3: Implementar en `src/lib/mp/gateway.ts`**

En `MpPaymentDetails` (línea 9-29), después de `subscriptionId: string | null;` agregar:

```ts
  /** Id de la cuenta que COBRÓ, como texto; `null` si MP no lo manda.
   *
   *  Medido el 11/09/2026 sobre los 13 pagos productivos desde julio:
   *  `/v1/payments/search` devuelve TAMBIÉN los pagos que la cuenta hizo como
   *  pagadora —la factura mensual de MP por cargos de operar— y en ésos la clave
   *  `collector_id` viene AUSENTE (no nula). En todo cobro real es un entero
   *  igual al id de `/users/me`. Quien decide con esto es el paso 1 de la
   *  conciliación (`isOwnCollection`); el gateway sólo lo expone. */
  collectorId: string | null;
```

En el tipo `MpGateway`, después de la firma de `searchPayments(...)`, agregar:

```ts
  /** El id de la cuenta dueña del token (`GET /users/me`), como texto, cacheado
   *  por proceso. El token DEFINE la identidad: no hay variable de entorno ni
   *  fila de configuración que pueda quedar desactualizada. Sólo se cachea un
   *  éxito; una respuesta no-2xx lanza con el `status` colgado, así el 429 se
   *  reintenta como cualquier lectura. */
  ownAccountId(): Promise<string>;
```

En `RawPayment` (149-161), agregar `collector_id?: number | string | null;` después de `description?: string | null;`.

Antes de `mapPayment` (163), agregar el normalizador:

```ts
/** Un id numérico o de texto de MP, como texto; ausente, nulo o vacío → null. */
function idText(v: unknown): string | null {
  return typeof v === "number" || (typeof v === "string" && v !== "") ? String(v) : null;
}
```

En `mapPayment`, después de la línea `subscriptionId: …,` agregar `collectorId: idText(res.collector_id),`.

Dentro de `makeMpGateway()`, justo después de `function mp(): MercadoPagoConfig { … }`, agregar el cache:

```ts
  // El id de la cuenta propia se pide una vez por proceso. Sólo se guarda un
  // éxito: un fallo deja `ownId` en null y la próxima llamada vuelve a pedir.
  let ownId: string | null = null;
```

En el objeto `api`, como primer método (antes de `async getPlan(planId)`), agregar:

```ts
    async ownAccountId() {
      if (ownId !== null) return ownId;
      const res = await fetch(`${API}/users/me`, { headers: { Authorization: `Bearer ${accessToken()}` } });
      if (!res.ok) throw httpFailure("users/me", res);
      const me = (await res.json()) as { id?: number | string | null };
      const id = idText(me.id);
      if (id === null) throw new Error("MP no devolvió el id de la cuenta.");
      ownId = id;
      return id;
    },
```

En el `return { ...api, … }` final (437-449), agregar `ownAccountId: retrying(api.ownAccountId),` después de `searchPayments: retrying(api.searchPayments),` y extender el comentario de arriba con una línea: `// \`ownAccountId\` es lectura y va con reintento: sin él, un 429 a las 03:17 apagaría el paso 1 entero.`

- [ ] **Step 4: Correr y verlos pasar**

```bash
npx vitest run tests/mp-gateway.test.ts 2>&1 | tail -8
npx tsc --noEmit
```
Expected: todos los tests del archivo en verde (los 6 nuevos incluidos); `tsc` sin salida. Si `tsc` se queja de un doble de `MpGateway` en otro test que no tenga `ownAccountId`, ese doble está tipado `as never` y no debería; anotar el archivo en el informe si aparece.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mp/gateway.ts tests/mp-gateway.test.ts
git commit -m "feat(mp): gateway maps collector_id and exposes ownAccountId() (GET /users/me, cached per process)

payments/search also returns what the account PAID (measured 11/09/2026: the
monthly MP invoice, collector_id absent). The gateway only exposes the data;
the reconcile decides.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Predicado puro `isOwnCollection`

**Files:**
- Create: `src/lib/mp/own-collection.ts`
- Test: `tests/mp-own-collection.test.ts`

**Interfaces:**
- Consumes: la forma `{ collectorId: string | null }` de la Task 1.
- Produces: `isOwnCollection(p: { collectorId: string | null }, ownId: string): boolean` y `FOREIGN_PAYMENT_ACTION = "payment_foreign"`. La Task 3 importa los dos.

- [ ] **Step 1: Escribir el test que falla**

Crear `tests/mp-own-collection.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FOREIGN_PAYMENT_ACTION, isOwnCollection } from "@/lib/mp/own-collection";

// La regla es "propio o nada": un cobro nuestro trae `collector_id` presente e
// igual al id de la cuenta; todo lo demás —incluida la AUSENCIA, que es cómo
// llega la factura mensual de MP (medido el 11/09/2026)— es ajeno.
describe("isOwnCollection", () => {
  it.each([
    ["mismo id", "1978062823", true],
    ["otro id", "202123439", false],
    ["sin collector_id (la factura mensual de MP)", null, false],
    ["cadena vacía", "", false],
  ])("%s → %s", (_label: string, collectorId: string | null, expected: boolean) => {
    expect(isOwnCollection({ collectorId }, "1978062823")).toBe(expected);
  });

  it("la acción del asiento es payment_foreign", () => {
    expect(FOREIGN_PAYMENT_ACTION).toBe("payment_foreign");
  });
});
```

- [ ] **Step 2: Correr y verlo fallar**

```bash
npx vitest run tests/mp-own-collection.test.ts 2>&1 | tail -12
```
Expected: falla al importar: `Failed to resolve import "@/lib/mp/own-collection"`.

- [ ] **Step 3: Implementar**

Crear `src/lib/mp/own-collection.ts`:

```ts
// ¿Este pago de Mercado Pago es un COBRO de la cuenta, o algo que la cuenta
// pagó? `/v1/payments/search` con el token del vendedor devuelve las dos cosas
// (medido el 11/09/2026: la factura mensual de MP por cargos de operar llega
// aprobada, con `collector_id` AUSENTE, y el cron la mandaba a la bandeja como
// un cobro sin referencia). La regla es "propio o nada": falla cerrada, y por
// eso vive en el paso 1 de la conciliación y no en `applyPayment` — si MP
// cambiara el payload, lo que se apaga es la red del cron (visible en
// `/admin/salud`), no el asiento de los cobros reales por webhook.
//
// Puro a propósito: sin Prisma, sin gateway, sin reloj.

/** Acción de auditoría de un pago que la búsqueda trajo y no es un cobro
 *  nuestro. Un asiento por pago, no por corrida (ver `reconcile.ts`). */
export const FOREIGN_PAYMENT_ACTION = "payment_foreign";

export function isOwnCollection(p: { collectorId: string | null }, ownId: string): boolean {
  return p.collectorId !== null && p.collectorId === ownId;
}
```

- [ ] **Step 4: Correr y verlo pasar**

```bash
npx vitest run tests/mp-own-collection.test.ts 2>&1 | tail -8
```
Expected: `Tests 5 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mp/own-collection.ts tests/mp-own-collection.test.ts
git commit -m "feat(mp): isOwnCollection — a payment is ours only with collector_id present and equal to the account id

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Reconcile paso 1 — id propio, guarda, `paymentsForeign`, asiento único, fail-closed

**Files:**
- Modify: `src/lib/mp/reconcile.ts` (imports 5-15; `ReconcileSummary` 88-118; `Deps` 120-135; inicialización del summary 145-150; helpers `hasLocal`/`inInbox` 181-189; paso 1 216-225; cableado por defecto 368-370)
- Test: `tests/mp-reconcile.test.ts` (mocks 1-11; `pay()` 15-16; `deps()` 19-69)

**Interfaces:**
- Consumes: `MpGateway.ownAccountId()` y `MpPaymentDetails.collectorId` (Task 1); `isOwnCollection`, `FOREIGN_PAYMENT_ACTION` (Task 2); `audit` y `AuditEntry` de `@/lib/audit` (existentes).
- Produces: `ReconcileSummary.paymentsForeign: number`; `Deps.audit`; `Deps.db` con `auditLog`; `Deps.gateway` con `ownAccountId`. La Task 4 edita la misma línea del paso 1; la Task 5 documenta el contador.

- [ ] **Step 1: Extender el doble de `tests/mp-reconcile.test.ts`**

Después de la línea `vi.mock("@/lib/config", …)` (línea 11) agregar:

```ts
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
```

Reemplazar `pay()` (líneas 15-16) por:

```ts
const pay = (id: string, over: Record<string, unknown> = {}) =>
  ({ id, status: "approved", statusDetail: null, transactionAmount: 6000, externalReference: null, dateApproved: NOW, payerEmail: null, description: null,
     // Un cobro nuestro por defecto: `collectorId` igual al id de la cuenta y sin suscripción.
     subscriptionId: null, collectorId: "1978062823", ...over });
```

En `deps()`, dentro del objeto `db`, después de `application: { … },` agregar:

```ts
    // El asiento `payment_foreign` se escribe UNA vez por pago: el cron pregunta
    // antes si ya existe. Por defecto no existe; un test lo hace existir.
    auditLog: { findFirst: vi.fn(async () => null as { id: bigint } | null) },
```

En el objeto `gateway`, después de `searchPayments: …,` agregar:

```ts
    ownAccountId: vi.fn(async () => "1978062823"),
```

Después de `const sleep = …;` agregar:

```ts
  const audit = vi.fn<(entry: { action: string; entity?: string; entityId?: string | number; detail?: unknown }) => Promise<void>>(async () => {});
```

Cambiar la construcción y el `return`:

```ts
  const r = makeReconcile({ db: db as never, gateway: gateway as never, processor, feeValues: feeValues as never, config, now: () => NOW, sleep, audit });
  return { r, db, gateway, processor, feeValues, config, sleep, audit };
```

- [ ] **Step 2: Escribir los cuatro tests que fallan**

Al final del `describe("reconcile", …)`, antes de su `});` de cierre, agregar:

```ts
  // ── 11/09/2026: la búsqueda devuelve también lo que la cuenta PAGÓ ──────────

  it("paso 1 saltea un pago cuyo collector_id no es el propio: lo cuenta en paymentsForeign, lo audita y no toca el procesador ni la bandeja", async () => {
    const d = deps({ payments: [
      pay("178354740076", { collectorId: null, transactionAmount: 94.88, description: "Facturas con cargos por operar", externalReference: "[5117560041]" }),
      pay("1"),
    ] });
    const s = await d.r.run();
    expect(d.gateway.ownAccountId).toHaveBeenCalledTimes(1);
    expect(d.processor.applyPayment).toHaveBeenCalledTimes(1);
    expect(d.processor.applyPayment).toHaveBeenCalledWith(expect.objectContaining({ id: "1" }), null, expect.anything());
    // Ni `hasLocal` ni `inInbox` se preguntan por lo ajeno: la guarda va primero.
    expect(d.db.payment.findUnique).not.toHaveBeenCalledWith({ where: { mpPaymentId: "178354740076" }, select: { id: true } });
    expect(d.db.mpUnmatchedPayment.findUnique).not.toHaveBeenCalledWith({ where: { mpPaymentId: "178354740076" }, select: { id: true } });
    expect(d.audit).toHaveBeenCalledWith({
      action: "payment_foreign", entity: "mp_payment", entityId: "178354740076",
      detail: { mpPaymentId: "178354740076", amount: 94.88, description: "Facturas con cargos por operar", externalReference: "[5117560041]" },
    });
    expect(s).toMatchObject({ paymentsForeign: 1, paymentsRecovered: 1, paymentsInbox: 0, paymentsSkipped: 0, errors: [] });
  });

  it("un pago ajeno ya auditado se cuenta igual pero no deja un segundo asiento (la ventana de 72 h lo ve tres noches)", async () => {
    const d = deps({ payments: [pay("178354740076", { collectorId: null })] });
    d.db.auditLog.findFirst.mockResolvedValueOnce({ id: BigInt(1) });
    const s = await d.r.run();
    expect(d.db.auditLog.findFirst).toHaveBeenCalledWith({
      where: { action: "payment_foreign", entity: "mp_payment", entityId: "178354740076" },
      select: { id: true },
    });
    expect(d.audit).not.toHaveBeenCalled();
    expect(s.paymentsForeign).toBe(1);
  });

  it("si /users/me falla, el paso 1 no corre —ni búsqueda ni procesador— y queda payments.owner en errors; los otros pasos siguen", async () => {
    const d = deps({ payments: [pay("1")], subs: [liveSub("pre-1", 14)] });
    d.gateway.ownAccountId.mockRejectedValueOnce(Object.assign(new Error("boom"), { status: 500 }));
    const s = await d.r.run();
    expect(d.gateway.searchPayments).not.toHaveBeenCalled();
    expect(d.processor.applyPayment).not.toHaveBeenCalled();
    expect(s.errors).toEqual([expect.stringMatching(/^payments\.owner: /)]);
    expect(s.paymentsForeign).toBe(0);
    // El paso 3 corrió igual: la red se aísla por pasos.
    expect(d.gateway.getPreapproval).toHaveBeenCalledWith("pre-1");
    expect(s.subscriptionsSynced).toBe(1);
  });

  it("el resumen arranca con paymentsForeign en 0", async () => {
    expect((await deps().r.run()).paymentsForeign).toBe(0);
  });
```

- [ ] **Step 3: Correr y verlos fallar**

```bash
npx vitest run tests/mp-reconcile.test.ts 2>&1 | tail -40
```
Expected: 4 tests en rojo (`paymentsForeign` es `undefined`; `applyPayment` llamado 2 veces en vez de 1; `audit` no llamado; `searchPayments` llamado aunque `ownAccountId` falle). Los 27 tests existentes siguen en verde: el doble extendido no cambia lo que ya se probaba.

- [ ] **Step 4: Implementar en `src/lib/mp/reconcile.ts`**

Imports: después de `import { prisma } from "@/lib/prisma";` agregar `import { audit, type AuditEntry } from "@/lib/audit";` y después de `import { mpGateway, … } from "./gateway";` agregar `import { FOREIGN_PAYMENT_ACTION, isOwnCollection } from "./own-collection";`.

En `ReconcileSummary`, después de `paymentsSkipped: number;` agregar:

```ts
  /** Filas de `payments/search` que NO son cobros de la cuenta: la cuenta fue
   *  la pagadora (la factura mensual de MP por cargos de operar, medida el
   *  11/09/2026). Se saltean sin tocar el procesador ni la bandeja. Cuenta POR
   *  CORRIDA —la ventana de 72 h ve la misma factura hasta tres noches—; lo que
   *  se escribe una sola vez es el asiento `payment_foreign`. */
  paymentsForeign: number;
```

En `Deps`:
- `db: Pick<PrismaClient, "payment" | "mpUnmatchedPayment" | "mpSubscription" | "application" | "auditLog">;`
- en `gateway: Pick<MpGateway, …>` agregar `| "ownAccountId"`.
- después de `config: …;` agregar `audit: (entry: AuditEntry) => Promise<void>;`.

En la inicialización del summary (145-150), la primera línea pasa a `paymentsRecovered: 0, paymentsInbox: 0, paymentsSkipped: 0, paymentsForeign: 0,`.

Después de `inInbox` (189) y antes del comentario del paso 2, agregar:

```ts
      // Un pago ajeno deja UN asiento, no uno por corrida: la ventana de 72 h
      // lo vuelve a ver hasta tres noches. Consulta por el índice
      // `[entity, entityId]`. Si esta lectura falla, cae en el catch por pago
      // y el ajeno igual no se aplicó, que es lo que importa.
      const noteForeign = async (p: MpPaymentDetails) => {
        const seen = await deps.db.auditLog.findFirst({
          where: { action: FOREIGN_PAYMENT_ACTION, entity: "mp_payment", entityId: p.id },
          select: { id: true },
        });
        if (seen) return;
        await deps.audit({
          action: FOREIGN_PAYMENT_ACTION, entity: "mp_payment", entityId: p.id,
          // Sin datos personales: un pago ajeno no trae pagador, y descripción y
          // referencia son texto de MP (el número de su factura).
          detail: { mpPaymentId: p.id, amount: p.transactionAmount, description: p.description, externalReference: p.externalReference },
        });
      };
```

Reemplazar el bloque entero del paso 1 (216-225) por:

```ts
      // ── 1. Pagos aprobados de las últimas 72 h sin rastro local ─────────────
      //
      // Primero, de quién es la cuenta. `payments/search` devuelve TAMBIÉN los
      // pagos que la cuenta hizo como pagadora —la factura mensual de MP por
      // cargos de operar— y en ésos `collector_id` viene AUSENTE (medido el
      // 11/09/2026 sobre los 13 pagos productivos desde julio: 10 cobros con el
      // id propio, 3 facturas sin la clave). Sin el id propio no hay contra qué
      // comparar, así que si `/users/me` falla el paso 1 no corre: mejor no
      // recuperar un día —queda en `errors[]`, 207, rojo en salud— que asentar
      // como cobro plata que salió. La guarda vive acá y no en `applyPayment` a
      // propósito: falla cerrada, y lo que apaga es la red, no el webhook.
      let ownId: string | null = null;
      try {
        ownId = await deps.gateway.ownAccountId();
      } catch (e) { fail("payments.owner", {}, e); }
      if (ownId !== null) {
        const own = ownId;
        try {
          const payments = await deps.gateway.searchPayments({ since: new Date(t.getTime() - RECONCILE_WINDOW_MS) });
          for (const p of payments) {
            try {
              // "¿Es nuestro?" antes que "¿ya lo conocemos?": un ajeno no puede
              // tener Payment local, y no tiene por qué preguntarse por la bandeja.
              if (!isOwnCollection(p, own)) { s.paymentsForeign++; await noteForeign(p); continue; }
              if ((await hasLocal(p.id)) || (await inInbox(p.id))) continue;
              count(await deps.processor.applyPayment(p, null, { mailBudget }), "payments");
            } catch (e) { fail("payments.apply", { mpPaymentId: p.id }, e); }
          }
        } catch (e) { fail("payments", {}, e); }
      }
```

Cableado por defecto (368-370): agregar `audit` al objeto: `db: prisma, gateway: mpGateway, processor: webhookProcessor, feeValues: feeValueReader, config: configReader, audit,`.

- [ ] **Step 5: Correr y verlos pasar**

```bash
npx vitest run tests/mp-reconcile.test.ts tests/mp-reconcile-route.test.ts 2>&1 | tail -8
npx tsc --noEmit
```
Expected: 31 tests en verde en `mp-reconcile` (27 + 4), los 5 del route sin cambio; `tsc` sin salida.

- [ ] **Step 6: Verificar las guardas por mutación (y restaurar)**

Una a la vez, correr `npx vitest run tests/mp-reconcile.test.ts 2>&1 | tail -6` y anotar qué test se pone en rojo:

1. Cambiar `if (!isOwnCollection(p, own))` por `if (false)` → rojo el test "paso 1 saltea un pago cuyo collector_id no es el propio". Restaurar.
2. Quitar `if (seen) return;` → rojo "un pago ajeno ya auditado se cuenta igual pero no deja un segundo asiento". Restaurar.
3. Cambiar `if (ownId !== null) {` por `if (true) {` (y `const own = ownId ?? ""`) → rojo "si /users/me falla, el paso 1 no corre". Restaurar.
4. Quitar `s.paymentsForeign++` → rojo los dos primeros. Restaurar.

Expected al final: `git diff --stat` de `src/lib/mp/reconcile.ts` igual que antes de las mutaciones y la suite del archivo en verde. Las cuatro mutaciones van al informe de la Task 6.

- [ ] **Step 7: Commit**

```bash
git add src/lib/mp/reconcile.ts tests/mp-reconcile.test.ts
git commit -m "fix(reconcile): step 1 skips, counts and audits payments the account PAID (collector_id absent); without the own id, step 1 does not run

The monthly MP invoice (\"Facturas con cargos por operar\") came through
payments/search as an approved payment and landed in the inbox as a
collection without reference. Own id from GET /users/me; guard in the cron,
not in applyPayment, so a payload change turns off the safety net and not
the webhook. One audit row per foreign payment; the counter is per run.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Reconcile paso 1 — `p.subscriptionId` al procesador, como el webhook

**Files:**
- Modify: `src/lib/mp/reconcile.ts` (comentario de `inInbox`, líneas 183-187 originales; la llamada a `applyPayment` del paso 1)
- Test: `tests/mp-reconcile.test.ts`

**Interfaces:**
- Consumes: `MpPaymentDetails.subscriptionId` (existente; el fixture `pay()` ya lo trae en `null` desde la Task 3).
- Produces: nada nuevo; cambia el segundo argumento de `applyPayment` en el paso 1.

- [ ] **Step 1: Escribir el test que falla**

Después de los tests de la Task 3, agregar:

```ts
  // Antes iba `null`, y un débito cuyo webhook no llegó hacía escala en la
  // bandeja como "sin referencia" hasta que el paso 2 lo levantaba (la corrida
  // del 11/09/2026: paymentsInbox 2, debitsRecovered 1, una sola fila visible).
  // El webhook ya pasa este id desde la T14; el cron quedó atrás.
  it("paso 1 le pasa al procesador el preapproval que trae el pago, como el webhook", async () => {
    const d = deps({ payments: [pay("177432666739", { subscriptionId: "4b3e9b33a2954b82b7dfc25d5dbccf01", externalReference: "socio:255" })] });
    await d.r.run();
    expect(d.processor.applyPayment).toHaveBeenCalledWith(
      expect.objectContaining({ id: "177432666739" }), "4b3e9b33a2954b82b7dfc25d5dbccf01", expect.anything(),
    );
  });
```

- [ ] **Step 2: Correr y verlo fallar**

```bash
npx vitest run tests/mp-reconcile.test.ts -t "preapproval que trae el pago" 2>&1 | tail -15
```
Expected: rojo, `applyPayment` recibió `null` como segundo argumento.

- [ ] **Step 3: Implementar**

En el paso 1, cambiar `count(await deps.processor.applyPayment(p, null, { mailBudget }), "payments");` por `count(await deps.processor.applyPayment(p, p.subscriptionId, { mailBudget }), "payments");`.

Reemplazar el comentario que precede a `inInbox` (el que empieza `// Paso 1: cualquier fila de la bandeja frena. Ahí el cron no sabe nada que`) por:

```ts
      // Paso 1: cualquier fila de la bandeja frena. El cron le pasa al procesador
      // exactamente lo que le pasa el webhook —el `payment` y el preapproval que
      // el propio pago trae en `point_of_interaction` (la búsqueda también lo
      // manda, medido el 11/09/2026)—, así que re-procesar una fila abierta
      // sería ruido, y una que el operador descartó (`dismissed`) o resolvió
      // (`matched`) es una decisión tomada que volver a aplicar sería pisar.
```

- [ ] **Step 4: Correr y verlo pasar**

```bash
npx vitest run tests/mp-reconcile.test.ts 2>&1 | tail -6
```
Expected: 32 tests en verde. El test existente `paso 1: pago aprobado sin registro local ni bandeja → applyPayment` sigue asertando `null` porque `pay("1")` no trae suscripción: no se toca.

- [ ] **Step 5: Mutación y restauración**

Volver a poner `null` → rojo sólo el test nuevo. Restaurar. Anotar en el informe.

- [ ] **Step 6: Commit**

```bash
git add src/lib/mp/reconcile.ts tests/mp-reconcile.test.ts
git commit -m "fix(reconcile): step 1 passes the payment's own subscription id to the processor, like the webhook

A subscription debit whose webhook never arrived no longer detours through
the inbox as \"no reference\" until step 2 picks it up: it resolves by
subscription in step 1 (resolve.ts rule 3), exactly as onPayment does.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Documentación

**Files:**
- Modify: `docs/06-integracion-mercadopago.md` (§2 tabla del gateway líneas 200-213; §6 paso 1 líneas 392-395 y lista de contadores 417-421)
- Modify: `docs/07-plan-de-etapas.md` (bloque nuevo antes de `### Insumos que deja el Módulo 3 para el Módulo 4`, línea 464)
- Modify: `docs/10-runbook-dominio-produccion.md` (§4.11 nueva, después de la §4.10 que termina en la línea 1107)
- Modify: `docs/11-preparacion-mp-sandbox-turnstile.md` (J.7 nueva, después de J.6 que empieza en la línea 927; agregar al final de la Parte J)
- Modify: `CLAUDE.md` (sección nueva después de "Patrones que estrenó el reparto de la bandeja (fase 4D, 10/09/2026)"; y, condicional, el párrafo de "Prioridad actual" sobre el crontab del devengo)

**Interfaces:** consume los hashes de los commits de las Tasks 1-4 (`git log --oneline -5`).

- [ ] **Step 1: Tomar los hashes**

```bash
git log --oneline -5
```
Anotar los cuatro hashes (gateway, predicado, guarda, subscriptionId) para usarlos en docs/07.

- [ ] **Step 2: `docs/06` §2**

En la tabla del gateway, después de la fila de `searchPayments`, agregar:

```
| `ownAccountId` | id de la cuenta propia (`GET /users/me`, cacheado por proceso): el paso 1 de la conciliación descarta lo que la cuenta PAGÓ |
```

Buscar en el §2 la palabra que cuenta los métodos (`grep -n "once" docs/06-integracion-mercadopago.md`); si dice "once métodos", pasar a "doce". Después del párrafo "Dos trampas de paginación, medidas contra la API real…" agregar:

```
Y una trampa de **universo**, medida el 11/09/2026 (`docs/11` J.7): `/v1/payments/search`
devuelve **también los pagos que la cuenta hizo como pagadora** —la factura mensual de
MP por cargos de operar, que llega aprobada— y en ésos la clave `collector_id` viene
**ausente**. `mapPayment` la expone como `collectorId` (`null` si falta) y el paso 1 de
la conciliación sólo procesa lo que tiene `collectorId` igual al propio
(`isOwnCollection`, `src/lib/mp/own-collection.ts`). El JSDoc del SDK ("payments
belonging to the authenticated collector") es falso. Existe un filtro de servidor
`collector.id=` que funciona y no está documentado: no se usa.
```

- [ ] **Step 3: `docs/06` §6**

Reemplazar el paso 1 (las cuatro líneas que empiezan `1. **\`GET /v1/payments/search\`** por \`date_approved\``) por:

```
1. **`GET /v1/payments/search`** por `date_approved` de las últimas 72 h. Antes de
   buscar, `ownAccountId()`: si `/users/me` falla, el paso 1 **no corre**
   (`payments.owner` en `errors[]`, 207): sin id propio no hay contra qué comparar,
   y es mejor no recuperar un día que asentar como cobro plata que salió. Cada fila
   con `collectorId` distinto del propio —o ausente, que es cómo llega la factura
   mensual de MP— se saltea, suma `paymentsForeign` y deja **un** asiento
   `payment_foreign` (id, monto, descripción, referencia); nunca entra a la bandeja,
   que es plata que entró. Lo demás sin registro local se procesa **por el mismo
   camino que el webhook** (`processor.applyPayment`, con el preapproval que el
   propio pago trae en `point_of_interaction`, igual que la notificación `payment`),
   así que el resultado es idéntico al del aviso perdido. La guarda vive acá y no en
   `applyPayment`: si MP cambiara el payload, se apaga la red, no el webhook.
```

En la lista de contadores, cambiar `paymentsRecovered/Inbox/Skipped` por `paymentsRecovered/Inbox/Skipped/Foreign` y agregar al final del párrafo: `\`paymentsForeign\` es por corrida (la ventana de 72 h ve la misma factura hasta tres noches) y un valor de 1 alrededor del día 10 de cada mes es lo normal, no una alarma.`

- [ ] **Step 4: `docs/07` bloque nuevo**

Insertar antes de `### Insumos que deja el Módulo 3 para el Módulo 4`:

```
### Pagos ajenos en la conciliación — **CERRADO** (11/09/2026)

**El incidente.** La corrida de las 03:17 del 11/09/2026 mandó a la bandeja Sin
conciliar, como "Sin referencia", un pago de $ 94,88 (id 178354740076) que era la
**factura mensual de Mercado Pago** por cargos de operar, pagada el 10/09 desde la
cuenta de la vecinal. Plata que salió, mostrada como plata que entró. Spec:
`docs/superpowers/specs/2026-09-11-foreign-payments-reconcile-design.md`.

**Dos causas, medidas contra la API real** (`docs/11` J.7):

1. `GET /v1/payments/search` con el token del vendedor devuelve **también lo que
   la cuenta pagó**, con `collector_id` **ausente**. El gateway no leía el campo, el
   sistema no conocía su propio id de cuenta y el resolutor sólo mira id,
   preapproval y referencia. La verificación "sí indexa en producción" de la 4B
   había medido que la búsqueda devuelve algo, no qué universo. Arreglo: el
   gateway mapea `collectorId` y expone `ownAccountId()` (`<hash gateway>`), el
   predicado puro `isOwnCollection` (`<hash predicado>`), y el paso 1 saltea, cuenta
   (`paymentsForeign`) y audita una vez lo ajeno; sin id propio, el paso 1 no corre
   (`<hash guarda>`).
2. El paso 1 pasaba `preapprovalId: null` aunque el pago trajera su suscripción, así
   que un débito sin webhook hacía escala en la bandeja hasta el paso 2 (por eso la
   corrida dijo `paymentsInbox 2, debitsRecovered 1` con una sola fila visible).
   Arreglo: `applyPayment(p, p.subscriptionId)`, como el webhook desde la T14
   (`<hash subscriptionId>`).

**Sin migración ni variable nueva.** Verificación post-deploy: `docs/10` §4.11.
**Deuda anotada:** el sistema asienta el importe **bruto** de MP (3.000 entran
netos 2.852,91), decisión nunca tomada; el webhook que no llegó para uno de los
dos débitos del 10/09 (salud no muestra avisos con error: no llegó, no falló);
la suscripción duplicada del socio 255; etiquetas legibles para los contadores del
reconcile en `/admin/salud`; el filtro de servidor `collector.id` existe y no se usa.
```

Reemplazar los cuatro `<hash …>` por los hashes reales del Step 1.

- [ ] **Step 5: `docs/10` §4.11**

Agregar después del final de la §4.10:

```
### 4.11 Específico del arreglo de pagos ajenos en la conciliación (11/09/2026)

Sin migración ni variable de entorno: `git pull`, `npm run build`, `pm2 restart`
según §4.1. Antes o después, en la bandeja, **descartar** la fila de $ 94,88 del
10/09 con motivo "Factura mensual de Mercado Pago por cargos de operar (percepción
de IVA); no es un cobro". El descarte no crea pago y deja la fila como barrera; el
egreso va al libro de tesorería, fuera de SIGeV.

Después del restart:

1. Corrida manual del reconcile con el `curl` de `docs/11` Parte H → HTTP **200**,
   `errors` vacío, y el resumen trae **`paymentsForeign`** (0 si la factura del
   10/09 ya quedó fuera de la ventana de 72 h; 1 si no).
2. `/admin/salud` → Tareas → Conciliación muestra `paymentsForeign` entre los
   contadores.
3. Si dio 1: un solo asiento `payment_foreign` en `audit_log` con `entity_id
   178354740076`, y **ninguna fila nueva** en la bandeja.
4. **La prueba real es la factura siguiente** (MP cierra el 7 y cobra alrededor
   del 10): la corrida posterior muestra `paymentsForeign 1`, `paymentsInbox 0` y la
   bandeja no gana filas.
5. El primer débito de suscripción cuyo webhook no llegue entra como
   `paymentsRecovered 1` en el paso 1, sin fila en Resueltos con hora 03:17.
```

- [ ] **Step 6: `docs/11` J.7**

Agregar al final de la Parte J (después del último párrafo de J.6):

```
### J.7 La búsqueda de pagos devuelve también lo que la cuenta PAGÓ (11/09/2026, producción)

Medido con el token productivo, sin tocar nada (todo `GET`). Es la base de la spec
`2026-09-11-foreign-payments-reconcile-design.md`.

| Hecho | Medición |
|---|---|
| Id de la cuenta de la vecinal | `GET /users/me` → `id: 1978062823` (entero), `nickname: VECINALCIUDADELA`, `site_id: MLA` |
| La búsqueda devuelve pagos del lado pagador | `payments/search` desde el 01/07 (`range=date_approved`, `status=approved`): 13 filas. 10 cobros reales con `collector_id: 1978062823` (clave presente): 3 `recurring_payment`, 4 `regular_payment` (links `pago:`, ingreso `solicitud:`, adhesión `socio:`), 3 `money_transfer`. **3 pagos ajenos** con la clave `collector_id` **ausente** y `payer` ausente, `operation_type: regular_payment`, `payment_type_id: account_money`: 27,11 el 14/07 (ref `MELIPAYMENTS-COLLECTIONATTEMPT-1978062823-…`), 27,11 el 13/08 y 94,88 el 10/09 ("Facturas con cargos por operar", ref `[5007340143]` y `[5117560041]`) |
| Un pago ajeno se puede pedir por id | `GET /v1/payments/178354740076` → 200, `approved`, sin `collector_id`, sin `payer`, `point_of_interaction.type: CHECKOUT` |
| `[5117560041]` no es un id de pago | `GET /v1/payments/5117560041` → 404. Es el número de la factura de MP, que viaja como `external_reference` |
| La búsqueda trae el id de suscripción | Las filas de los débitos traen `point_of_interaction.transaction_data.subscription_id`, aunque el tipo del SDK para el resultado de búsqueda lo omita |
| Filtro de servidor por cobrador | `payments/search?…&collector.id=1978062823` → total 4 → 3. Funciona, no está documentado, **no se usa** |
| El JSDoc del SDK es falso | `payment/search/index.d.ts`: "payments belonging to the authenticated collector" |
| MP factura cargos por operar todos los meses | Cierre el 7, cobro alrededor del 10: el pago ajeno es un evento mensual normal |

Para inspeccionar a mano, desde la carpeta de la app en el VPS (no hay `jq`):

    TOKEN=$(grep -E '^MP_ACCESS_TOKEN=' .env | cut -d= -f2- | tr -d '"' | tr -d "'")
    curl -s -H "Authorization: Bearer $TOKEN" https://api.mercadopago.com/users/me | python3 -c 'import sys,json; d=json.load(sys.stdin); print({k:d.get(k) for k in ("id","nickname","site_id")})'
    curl -s -H "Authorization: Bearer $TOKEN" "https://api.mercadopago.com/v1/payments/search?sort=date_approved&criteria=desc&range=date_approved&begin_date=2026-09-07T00:00:00.000Z&end_date=2026-09-12T00:00:00.000Z&status=approved&limit=100" | python3 -c '
    import sys,json
    for r in json.load(sys.stdin).get("results", []):
        print(r.get("id"), "collector_id" in r, r.get("collector_id"), r.get("operation_type"), r.get("transaction_amount"), r.get("description"), r.get("external_reference"))
    '
```

- [ ] **Step 7: `CLAUDE.md`**

Después de la sección "Patrones que estrenó el reparto de la bandeja (fase 4D, 10/09/2026)" agregar:

```
## Patrones que estrenó el arreglo de pagos ajenos (11/09/2026)

- **`payments/search` devuelve también lo que la cuenta PAGÓ, y la señal es la
  AUSENCIA de `collector_id`.** La factura mensual de MP por cargos de operar
  llega aprobada, sin `collector_id` ni `payer`, y el cron la mandaba a la bandeja
  como un cobro sin referencia. Medido sobre los 13 pagos productivos desde julio
  (`docs/11` J.7): los 10 cobros reales traen el id propio como entero; las 3
  facturas, nada. La regla es "propio o nada" (`isOwnCollection`), y falla cerrada.
- **El id propio sale del token, no de configuración.** `ownAccountId()` en el
  gateway (`GET /users/me`, cacheado por proceso): una variable de entorno o una
  fila de `Configuration` pueden quedar desactualizadas; el token no.
- **La guarda vive en el cron y no en el núcleo, a propósito.** Como la señal es
  una ausencia, un cambio de payload de MP la dispararía para todo: en el paso 1
  del reconcile eso apaga la red (207, rojo en salud); en `applyPayment` apagaría
  el asiento de los cobros reales por webhook sin ninguna alerta. Un pago ajeno
  no va a la bandeja —que es plata que entró— sino a `paymentsForeign` y a un
  asiento `payment_foreign` **único por pago** (el contador es por corrida).
- **El paso 1 le pasa al procesador lo mismo que el webhook.** `applyPayment(p,
  p.subscriptionId)`: la búsqueda trae `point_of_interaction` aunque el tipo del
  SDK lo omita. Antes iba `null` y un débito sin webhook hacía escala en la
  bandeja hasta el paso 2 (`paymentsInbox 2, debitsRecovered 1` con una fila).
- **"Sí indexa" no es "indexa lo correcto".** La primera corrida real midió que
  la búsqueda devuelve resultados, no qué universo. Contra MP, la pregunta
  siguiente después de "¿responde?" es "¿responde SÓLO lo nuestro?".
```

Además, en la sección "Patrones que estrenó el Módulo 3 (reutilizables)", el bullet de `makeMpGateway()` dice `hoy expone **once**`: pasar a `hoy expone **doce**` y agregar, después de `createPreference`—, la frase «y el arreglo de pagos ajenos del 11/09/2026 le sumó `ownAccountId`». La lista viva sigue en `docs/06` §2.

**Condicional:** si el brief de esta tarea dice que el operador confirmó con `crontab -l` que la línea del devengo está en el VPS, reemplazar en "Prioridad actual" el párrafo que empieza `**Pendiente de DESPLIEGUE, con fecha dura: el cron de devengo, antes del 01/10/2026.**` por:

```
El **cron de devengo ya está en el crontab del VPS** (confirmado el 11/09/2026:
`/admin/salud` muestra la corrida efectiva del 01/09/2026 a las 00:30 con
`forced no`, y `crontab -l` tiene la línea). La primera corrida que crea filas es
la del 01/10/2026 (septiembre). Procedimiento y escotilla: `docs/10` §4.5 y
`docs/11` Parte H.
```

Si el brief no lo dice, **no tocar** ese párrafo.

- [ ] **Step 8: Verificar y commitear**

```bash
grep -n "paymentsForeign" docs/06-integracion-mercadopago.md docs/10-runbook-dominio-produccion.md CLAUDE.md | wc -l
grep -n "<hash" docs/07-plan-de-etapas.md
```
Expected: la primera línea ≥ 4; la segunda **vacía** (ningún placeholder quedó).

```bash
git add docs/06-integracion-mercadopago.md docs/07-plan-de-etapas.md docs/10-runbook-dominio-produccion.md docs/11-preparacion-mp-sandbox-turnstile.md CLAUDE.md docs/superpowers/plans/2026-09-11-foreign-payments-reconcile.md
git commit -m "docs: foreign payments in the daily reconcile — what was measured, the guard, post-deploy checks (06, 07, 10 §4.11, 11 J.7, CLAUDE.md)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Verificación y auditoría (OBLIGATORIA — pedido del operador)

No se declara terminado el trabajo sin pasar TODOS estos puntos y anotar el resultado real de cada uno. Si algo falla, se arregla y se vuelve a correr desde el punto 1.

**Files:** ninguno de código; se escribe el informe en `.superpowers/sdd/foreign-payments-verificacion.md` (carpeta git-ignored).

- [ ] **Step 1: La suite entera, el typecheck y el lint**

```bash
npx vitest run 2>&1 | tail -8
```
Expected: `Test Files  293 passed | 4 skipped (297)` y `Tests  4166 passed | 14 skipped (4180)`, 0 failed. Contra `main`: +1 archivo (`tests/mp-own-collection.test.ts`) y **+16 tests** = 6 (gateway) + 5 (predicado) + 4 (guarda) + 1 (subscriptionId). Si el número no cierra, listar qué test falta o sobra.

```bash
npx tsc --noEmit && npm run lint
```
Expected: sin salida de error en ninguno.

- [ ] **Step 2: El build de producción**

```bash
npm run build 2>&1 | tail -30
```
Expected: build en verde, sin warnings nuevos. (Reiniciar el dev server después, porque el build pisa `.next`.)

- [ ] **Step 3: Auditoría del diff**

```bash
git diff --stat main..HEAD
git diff --stat main..HEAD -- src/lib/treasury prisma src/app src/lib/mp/webhook-processor.ts src/lib/mp/resolve.ts src/lib/mp/unmatched.ts src/lib/mp/link-subscription.ts .env.example
git diff main..HEAD -- src/lib/mp/gateway.ts | grep "^+" | grep -E "collector\.id|payer\.id|operation_type"
```
Expected: la segunda y la tercera línea **VACÍAS** (nada de tesorería, migraciones, pantallas, núcleo del webhook; y la búsqueda no manda ningún filtro nuevo). La primera lista SÓLO estos archivos, y ninguno más:

```
CLAUDE.md
docs/06-integracion-mercadopago.md
docs/07-plan-de-etapas.md
docs/10-runbook-dominio-produccion.md
docs/11-preparacion-mp-sandbox-turnstile.md
docs/superpowers/plans/2026-09-11-foreign-payments-reconcile.md
src/lib/mp/gateway.ts
src/lib/mp/own-collection.ts
src/lib/mp/reconcile.ts
tests/mp-gateway.test.ts
tests/mp-own-collection.test.ts
tests/mp-reconcile.test.ts
```

Un archivo fuera de esta lista es un desvío del plan: justificarlo en el informe o revertirlo.

- [ ] **Step 4: Las mutaciones**

Transcribir al informe la tabla de las cinco mutaciones (cuatro de la Task 3, una de la Task 4): qué se cambió, qué test se puso en rojo, y que la restauración dejó `git status` limpio en ese archivo.

- [ ] **Step 5: Prueba en el navegador (local, sandbox)**

Sólo si el `.env` local tiene `MP_ACCESS_TOKEN` del sandbox y `CRON_SECRET`. Con el dev server corriendo (`preview_start`, nunca Bash):

```bash
curl -s -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/reconcile
```
Expected: HTTP 200 y un JSON con `paymentsForeign: 0` y `errors: []` (el sandbox no tiene facturas). Después abrir `/admin/salud` → pestaña Tareas: la fila Conciliación muestra `paymentsForeign 0` entre los contadores. Captura de pantalla al informe. Si el `.env` local no tiene credenciales de MP, anotar "no aplica" y el motivo.

- [ ] **Step 6: Informe**

Escribir `.superpowers/sdd/foreign-payments-verificacion.md` con: conteos reales de suite/tsc/lint/build, la lista del `diff --stat` cotejada, la tabla de mutaciones, el resultado del navegador, y cualquier desvío con su justificación. Sin este informe en verde, la rama no está cerrada.

---

## Self-review del plan (hecho al escribirlo)

- **Cobertura de la spec:** §4.1 → Task 1; §4.2 → Task 2; §4.3 → Tasks 3 y 4; §4.4 → sin código (salud imprime claves crudas), documentado en Task 5; §5 casos borde → tests de Tasks 1 y 3 (`/users/me` 500 y sin id; ausente/nulo/vacío; fail-closed; asiento único); §6 → Tasks 1-4 con mutaciones y Task 6; §7 → Task 5; §8 → docs/10 §4.11 en Task 5 y Step 5 de Task 6; §9 → párrafo de deuda en docs/07; §10 → lista de la Task 6 Step 3.
- **Sin placeholders:** los `<hash …>` de la Task 5 se reemplazan con datos del Step 1 de esa misma tarea y el Step 8 verifica que no quede ninguno.
- **Consistencia de nombres:** `collectorId`, `ownAccountId`, `isOwnCollection`, `FOREIGN_PAYMENT_ACTION`, `paymentsForeign`, `noteForeign`, `payments.owner` se usan con la misma grafía en todas las tareas.
