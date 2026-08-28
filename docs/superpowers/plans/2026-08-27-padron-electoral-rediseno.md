# Padrón electoral: rediseño + bloque sin antigüedad + Excel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rediseñar `/admin/padron-electoral` con el lenguaje visual de M4/M5, exponer como lista el bloque "No habilitados por antigüedad" (hoy un contador) y reemplazar el export CSV por un .xlsx de tres hojas.

**Architecture:** El dominio (`src/lib/members/electoral.ts`) cambia en un punto: `withoutSeniority` pasa de `number` a `ElectoralRow[]`. Dos funciones puras nuevas (`enabledFrom`, `mustPurgeToVote`) se comparten con `/mi`. Un builder puro nuevo (`electoral-export.ts`) describe el workbook como datos; la route existente lo materializa con ExcelJS. La pantalla y la hoja se rediseñan sin tocar `ElectionsFlagForm` ni su action.

**Tech Stack:** Next.js 16 App Router, TypeScript, Prisma (inyectado en el dominio), ExcelJS 4.4 (ya en `dependencies`), Tailwind v4 + tokens del proyecto, lucide-react, Vitest + `renderToStaticMarkup`.

**Spec:** `docs/superpowers/specs/2026-08-27-padron-electoral-rediseno-design.md` — leerla entera antes de la Task 1.

## Global Constraints

- **UI en es-AR (vos), código/commits en inglés.** Fechas `DD/MM/AAAA` vía `formatDateAR`; moneda vía `formatARS`.
- **PROHIBIDO tocar** `src/lib/treasury/*`, `src/lib/mp/*`, `registerPayment` y `src/app/admin/padron-electoral/actions.ts` / `elections-flag-form.tsx`. La Task 7 lo verifica con `git diff`.
- **Sin DNI, email ni domicilio** en pantalla, papel ni Excel (REG-31 + Ley 25.326). Hay tests que lo afirman: no debilitarlos.
- Auditoría: **metadatos y conteos, nunca una fila ni un nombre**; sin `entity`; IP solo de `x-real-ip`.
- Colores solo por tokens (`--primary`, `--success`, `--warning`, `bg-muted`…): nunca verde/ámbar crudo de Tailwind.
- Accesibilidad no negociable: targets `min-h-11`, `outline-hidden` + `focus-visible:ring-2 focus-visible:ring-ring` (NUNCA `outline-none`), íconos decorativos `aria-hidden`, números en `font-mono tabular-nums`.
- El dominio recibe Prisma **inyectado**; ningún módulo de `src/lib/members/` importa `@/lib/prisma` ni ExcelJS.
- La fecha es un **parámetro** (`?fecha=`); "hoy" es SIEMPRE `civilDayOf()`, jamás `new Date()` en un cálculo de día civil.
- Guardas verificadas **por mutación**: borrar la guarda, ver el test en rojo, restaurar.
- Comandos de test: `npx vitest run <archivo>` (targeted) y `npx vitest run` + `npx tsc --noEmit` (cierre).

---

### Task 1: Funciones compartidas del dominio (`mustPurgeToVote`, `enabledFrom`) y fix de día civil en `/mi`

**Files:**
- Modify: `src/lib/members/electoral.ts` (líneas 44-55 y 196)
- Modify: `src/lib/mi/identity.ts` (líneas 8-15 y 44-47)
- Modify: `src/app/mi/page.tsx` (líneas 16 y 118)
- Test: `tests/members-electoral.test.ts`

**Interfaces:**
- Consumes: `ELECTORAL_MIN_DAYS`, `ACCRUING_CATEGORIES` (ya existen).
- Produces: `enabledFrom(joinedAt: Date): Date` y `mustPurgeToVote(category: MemberCategory, arrears: number): boolean`, exportadas desde `@/lib/members/electoral`. Las Tasks 3 y 5 las importan.

- [ ] **Step 1: Crear la branch**

```bash
git checkout -b padron-electoral-redesign
```

- [ ] **Step 2: Escribir los tests que fallan**

En `tests/members-electoral.test.ts`, sumar `enabledFrom` y `mustPurgeToVote` al import existente de `@/lib/members/electoral`, y agregar después del `describe("antigüedad (REG-30/31)")`:

```ts
describe("mustPurgeToVote — la condición de mora, compartida por padrón y /mi", () => {
  it("bloquea sólo al activo y al colaborador con mora", () => {
    expect(mustPurgeToVote("active", 1)).toBe(true);
    expect(mustPurgeToVote("collaborator", 3)).toBe(true);
    expect(mustPurgeToVote("adherent", 5)).toBe(false);
    expect(mustPurgeToVote("honorary", 4)).toBe(false);
    expect(mustPurgeToVote("lifetime", 9)).toBe(false);
  });

  it("sin mora nadie purga", () => {
    for (const c of ELECTORAL_CATEGORIES) expect(mustPurgeToVote(c, 0)).toBe(false);
  });
});

describe("enabledFrom — desde cuándo puede votar", () => {
  it("es ingreso + 90 días, y ese mismo día ya alcanza", () => {
    const joined = daysBefore(90);
    expect(enabledFrom(joined)).toEqual(AT);
    expect(isEligibleBySeniority(joined, enabledFrom(joined))).toBe(true);
  });

  it("al que ingresó ayer le faltan 89 días desde AT", () => {
    const joined = daysBefore(1);
    expect(enabledFrom(joined).getTime()).toBe(AT.getTime() + 89 * 86_400_000);
  });
});
```

- [ ] **Step 3: Correr y ver el rojo**

Run: `npx vitest run tests/members-electoral.test.ts`
Expected: FAIL — `mustPurgeToVote` / `enabledFrom` no exportadas.

- [ ] **Step 4: Implementar en `electoral.ts`**

Después de `meetsSeniority` (línea 55) agregar:

```ts
/** El primer día en que el socio alcanza el piso: ingreso + ELECTORAL_MIN_DAYS.
 *  Ambos extremos viven a mediodía UTC (`civilDateUtc`), así que la suma cae
 *  exacta en el día civil argentino y es la contracara de
 *  `isEligibleBySeniority` (>= 90: ese mismo día ya vota). */
export function enabledFrom(joinedAt: Date): Date {
  return new Date(joinedAt.getTime() + ELECTORAL_MIN_DAYS * 86_400_000);
}

/** "Sin mora" es requisito sólo de activos y colaboradores (REG-31): el aporte
 *  del adherente es voluntario y su deuda no le quita el voto; honorarios y
 *  vitalicios no devengan. Compartida por el padrón y la credencial de /mi para
 *  que las dos superficies no puedan divergir (lección `coverageFloor`). */
export function mustPurgeToVote(category: MemberCategory, arrears: number): boolean {
  return arrears > 0 && ACCRUING_CATEGORIES.includes(category);
}
```

Y en `buildElectoralRoll`, reemplazar (líneas 194-197):

```ts
    // La exigencia de estar sin mora es SÓLO para activos y colaboradores: el
    // aporte del adherente es voluntario y su deuda no le quita el voto.
    const owes = arrears > 0 && ACCRUING_CATEGORIES.includes(r.category);
    (owes ? toPurge : enabled).push(row);
```

por:

```ts
    (mustPurgeToVote(r.category, arrears) ? toPurge : enabled).push(row);
```

- [ ] **Step 5: Compartirla con `/mi`**

En `src/lib/mi/identity.ts`:
1. Sumar `mustPurgeToVote` al import de `@/lib/members/electoral` y **borrar** la línea `import { ACCRUING_CATEGORIES } from "@/lib/treasury/rules";`.
2. Reemplazar (líneas 44-47):

```ts
  // "Sin mora" es requisito sólo de activos y colaboradores (REG-31).
  if (input.arrears > 0 && (ACCRUING_CATEGORIES as readonly MemberCategory[]).includes(input.category)) {
    return { eligible: false, reason: "arrears", arrears: input.arrears };
  }
```

por:

```ts
  // La MISMA condición que parte enabled/toPurge en buildElectoralRoll.
  if (mustPurgeToVote(input.category, input.arrears)) {
    return { eligible: false, reason: "arrears", arrears: input.arrears };
  }
```

(Si `MemberCategory` queda sin uso en los imports de tipos, quitarlo del import.)

- [ ] **Step 6: Fix del día civil en `/mi`**

En `src/app/mi/page.tsx`:
1. Línea 16: `import { currentPeriod } from "@/lib/treasury/periods";` → `import { civilDayOf, currentPeriod } from "@/lib/treasury/periods";`
2. Línea 118: `at: new Date(),` → dejar así, con su comentario:

```ts
    // Día civil argentino, no el instante: con `new Date()`, entre las 00:00 y
    // las 08:59 AR del día 90 la credencial decía "te falta 1 día" a quien ya
    // cumple (joinedAt vive a mediodía UTC). Misma clase de bug que ya
    // corrigieron feeValueReader.current() y parseMinuteDate.
    at: civilDayOf(),
```

- [ ] **Step 7: Verde**

Run: `npx vitest run tests/members-electoral.test.ts tests/mi-identity.test.ts`
Expected: PASS completo (la suite de identity no cambia ni una aserción: el refactor es interno).

- [ ] **Step 8: Verificar la guarda por mutación**

En `mustPurgeToVote` cambiar transitoriamente el cuerpo por `return arrears > 0;` y correr `npx vitest run tests/members-electoral.test.ts tests/mi-identity.test.ts`.
Expected: FAIL (el adherente moroso aparecería excluido). **Restaurar el cuerpo** y volver a ver PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/members/electoral.ts src/lib/mi/identity.ts src/app/mi/page.tsx tests/members-electoral.test.ts
git commit -m "feat(electoral): share the purge rule with /mi and add enabledFrom; civil-day fix"
```

---

### Task 2: `withoutSeniority` pasa de contador a lista

**Files:**
- Modify: `src/lib/members/electoral.ts` (tipo `ElectoralRoll` línea 81, cuerpo de `buildElectoralRoll` líneas 164 y 200-209)
- Modify: `src/app/admin/padron-electoral/page.tsx` (línea 126, arreglo mínimo de compilación)
- Test: `tests/members-electoral.test.ts`, `tests/padron-electoral-screen.test.ts` (fixture)

**Interfaces:**
- Produces: `ElectoralRoll.withoutSeniority: ElectoralRow[]` (mismo nombre, tipo nuevo). Los no elegibles llevan `arrears: 0, debt: null`. Identidad: `considered === enabled.length + toPurge.length + withoutSeniority.length`. Las Tasks 3, 5 y 6 dependen de esto.

- [ ] **Step 1: Actualizar los tests del dominio (fallan primero)**

En `tests/members-electoral.test.ts`:

1. Test "el honorario de 10 días vota" (línea 139): `expect(roll.withoutSeniority).toBe(0);` → `expect(roll.withoutSeniority).toEqual([]);`
2. Test "la cuenta cierra" (líneas 268-271): reemplazar por

```ts
    expect(roll.withoutSeniority.map((r) => r.memberId)).toEqual([3]);
    expect(roll.considered).toBe(
      roll.withoutSeniority.length + roll.enabled.length + roll.toPurge.length,
    );
```

3. Test "el que no llega a los 90 días…" (líneas 274-281): reemplazar las dos últimas aserciones por

```ts
    expect(roll.considered).toBe(1);
    expect(roll.withoutSeniority.map((r) => r.memberId)).toEqual([3]);
    // La mora no se consulta para este bloque: pagar no habilita, y la deuda de
    // quien no vota es un dato sin finalidad acá.
    expect(roll.withoutSeniority[0]).toMatchObject({ arrears: 0, debt: null });
```

4. Agregar un test nuevo al final del `describe("buildElectoralRoll")`:

```ts
  it("el bloque sin antigüedad conserva el orden del padrón y no dispara consultas de deuda extra", async () => {
    const db = fakeDb(
      [
        mn(1, "Zurita, Carlos", 306),
        m({
          id: 2,
          fullName: "Ñandú, Rosa",
          joinedAt: daysBefore(10),
          memberships: [{ memberNumber: 41, book: { status: "open" } }],
        }),
        m({
          id: 3,
          fullName: "Ávila, Bruno",
          joinedAt: daysBefore(30),
          memberships: [{ memberNumber: 14, book: { status: "open" } }],
        }),
      ],
      [{ memberId: 1, _count: { _all: 2 } }],
    );
    const roll = await buildElectoralRoll(db as never, AT, VALUE);
    // Alfabético es-AR, igual que los otros dos bloques.
    expect(roll.withoutSeniority.map((r) => r.fullName)).toEqual(["Ávila, Bruno", "Ñandú, Rosa"]);
    // La consulta de mora sigue siendo SÓLO de los elegibles.
    expect(db.fee.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ memberId: { in: [1] } }) }),
    );
  });
```

- [ ] **Step 2: Rojo**

Run: `npx vitest run tests/members-electoral.test.ts`
Expected: FAIL (tipo y valores).

- [ ] **Step 3: Cambiar el tipo y particionar**

En `src/lib/members/electoral.ts`:

1. En `ElectoralRoll` (línea 81), `withoutSeniority: number;` → con su doc:

```ts
  /** Los que no llegan al piso de REG-30 (decisión del 27/08/2026: dejan de ser
   *  un contador y se listan con nombre — el contador decía que eran tres, no
   *  quiénes, ni si eran "demasiado nuevos" o un problema de datos). Llevan
   *  `arrears: 0, debt: null`: su mora NO se consulta — pagar no habilita, y la
   *  deuda de quien no vota es un dato sin finalidad (Ley 25.326). */
  withoutSeniority: ElectoralRow[];
```

2. Reemplazar la línea 164 (`const eligible = rows.filter(...)`) por:

```ts
  const eligible: typeof rows = [];
  const tooNew: typeof rows = [];
  for (const r of rows) (meetsSeniority(r.category, r.joinedAt, at) ? eligible : tooNew).push(r);
```

3. En el `return` (línea 204), `withoutSeniority: rows.length - eligible.length,` →

```ts
    withoutSeniority: tooNew.map((r) => ({
      memberId: r.id,
      memberNumber: r.memberNumber,
      fullName: r.fullName,
      category: r.category,
      joinedAt: r.joinedAt,
      arrears: 0,
      debt: null,
    })),
```

4. Actualizar el comentario del campo `considered` (líneas 75-79) para que la igualdad diga `considered = withoutSeniority.length + enabled.length + toPurge.length`.

- [ ] **Step 4: Arreglos mínimos de compilación en pantalla y fixture**

1. `src/app/admin/padron-electoral/page.tsx` línea 126:
   `<Count n={generated.roll.withoutSeniority} label="sin antigüedad" />` → `<Count n={generated.roll.withoutSeniority.length} label="sin antigüedad" />`
2. `tests/padron-electoral-screen.test.ts` línea 69 (fixture `roll`): `withoutSeniority: 0,` → `withoutSeniority: [],`
3. Mismo archivo, test "muestra la cuenta completa" (línea 287): `withoutSeniority: 1,` →
   `withoutSeniority: [row({ memberId: 9, fullName: "Nuevo, Vecino", joinedAt: new Date("2026-10-01T12:00:00Z") })],`

- [ ] **Step 5: Verde total de lo tocado + tipos**

Run: `npx vitest run tests/members-electoral.test.ts tests/padron-electoral-screen.test.ts && npx tsc --noEmit`
Expected: PASS y cero errores de tipos (si `tsc` marca otro consumidor de `withoutSeniority`, actualizarlo con `.length` — no debería haber ninguno más).

- [ ] **Step 6: Commit**

```bash
git add src/lib/members/electoral.ts src/app/admin/padron-electoral/page.tsx tests/members-electoral.test.ts tests/padron-electoral-screen.test.ts
git commit -m "feat(electoral): expose without-seniority members as a list"
```

---

### Task 3: Builder puro del workbook (`electoral-export.ts`)

**Files:**
- Create: `src/lib/members/electoral-export.ts`
- Test (create): `tests/electoral-export.test.ts`

**Interfaces:**
- Consumes: `ElectoralRoll`, `ElectoralRow`, `enabledFrom` de `@/lib/members/electoral`; `CATEGORY_LABELS` de `@/lib/members/labels`.
- Produces: `electoralWorkbookSpec(roll: ElectoralRoll, valued: boolean): ElectoralSheetSpec[]` con `ElectoralSheetSpec = { name: string; columns: { header; key; width; style?: { numFmt: string } }[]; rows: Record<string, string | number | Date | null>[]; totals?: Record<string, string | number | Date | null> }`. La Task 4 lo materializa con ExcelJS.

- [ ] **Step 1: Escribir el test que falla**

Crear `tests/electoral-export.test.ts`:

```ts
// El builder puro del Excel del padrón electoral (REG-31 pide "Excel/PDF"; el
// CSV de la 4C fue una divergencia que este módulo cierra — decisión del
// 27/08/2026). Sin ExcelJS y sin base, igual que tests/members-export.test.ts:
// lo que se afirma es QUÉ sale en el archivo — hojas, columnas, filas — y qué NO.
import { describe, expect, it } from "vitest";
import type { ElectoralRoll, ElectoralRow } from "@/lib/members/electoral";
import { electoralWorkbookSpec } from "@/lib/members/electoral-export";

const row = (over: Partial<ElectoralRow> = {}): ElectoralRow => ({
  memberId: 1,
  memberNumber: 42,
  fullName: "Coñuecar, Marta",
  category: "active",
  joinedAt: new Date("2019-09-01T12:00:00Z"),
  arrears: 0,
  debt: null,
  ...over,
});

const roll = (over: Partial<ElectoralRoll> = {}): ElectoralRoll => ({
  at: new Date("2026-11-15T12:00:00Z"),
  period: "2026-11",
  considered: 0,
  withoutSeniority: [],
  enabled: [],
  toPurge: [],
  purgeFees: 0,
  purgeAmount: 0,
  ...over,
});

describe("electoralWorkbookSpec", () => {
  it("arma SIEMPRE las tres hojas, en el orden de la pantalla, aunque estén vacías", () => {
    const sheets = electoralWorkbookSpec(roll(), true);
    expect(sheets.map((s) => s.name)).toEqual([
      "Habilitados",
      "Con deuda a purgar",
      "No habilitados por antigüedad",
    ]);
    expect(sheets.every((s) => s.rows.length === 0)).toBe(true);
    // Regla de Excel: nombres de hoja de hasta 31 caracteres y sin : \ / ? * [ ]
    for (const s of sheets) {
      expect(s.name.length).toBeLessThanOrEqual(31);
      expect(s.name).not.toMatch(/[:\\/?*[\]]/);
    }
  });

  it("la hoja de habilitados lleva las columnas de REG-31 y ninguna de plata", () => {
    const [enabled] = electoralWorkbookSpec(roll({ enabled: [row()] }), true);
    expect(enabled.columns.map((c) => c.header)).toEqual([
      "numero_socio",
      "apellido_nombre",
      "categoria",
      "fecha_ingreso",
    ]);
    expect(enabled.rows[0]).toEqual({
      n: 42,
      name: "Coñuecar, Marta",
      cat: "Activo",
      in: new Date("2019-09-01T12:00:00Z"),
    });
  });

  it("la hoja de purga suma cuotas, monto nativo y la fila de total", () => {
    const sheets = electoralWorkbookSpec(
      roll({ toPurge: [row({ arrears: 3, debt: 18000 })], purgeFees: 3, purgeAmount: 18000 }),
      true,
    );
    const purge = sheets[1];
    expect(purge.columns.map((c) => c.header)).toEqual([
      "numero_socio",
      "apellido_nombre",
      "categoria",
      "fecha_ingreso",
      "cuotas_adeudadas",
      "monto_a_purgar",
    ]);
    expect(purge.rows[0]).toMatchObject({ fees: 3, amount: 18000 });
    expect(purge.totals).toMatchObject({ name: "Total a purgar", fees: 3, amount: 18000 });
  });

  it("sin valor de cuota vigente el monto va vacío, nunca un cero", () => {
    const sheets = electoralWorkbookSpec(
      roll({ toPurge: [row({ arrears: 2, debt: null })], purgeFees: 2, purgeAmount: 0 }),
      false,
    );
    expect(sheets[1].rows[0]).toMatchObject({ amount: null });
    expect(sheets[1].totals).toMatchObject({ amount: null });
  });

  it("una hoja de purga vacía no lleva fila de total", () => {
    expect(electoralWorkbookSpec(roll(), true)[1].totals).toBeUndefined();
  });

  it("la hoja de no habilitados dice desde cuándo puede votar cada uno", () => {
    const sheets = electoralWorkbookSpec(
      roll({ withoutSeniority: [row({ joinedAt: new Date("2026-10-01T12:00:00Z") })] }),
      true,
    );
    const block = sheets[2];
    expect(block.columns.map((c) => c.header)).toEqual([
      "numero_socio",
      "apellido_nombre",
      "categoria",
      "fecha_ingreso",
      "habilitado_desde",
    ]);
    // 01/10/2026 + 90 días = 30/12/2026, a mediodía UTC como toda fecha civil.
    expect(block.rows[0].from).toEqual(new Date("2026-12-30T12:00:00Z"));
  });

  it("el socio sin número va con la celda vacía, no con un guión", () => {
    const [enabled] = electoralWorkbookSpec(roll({ enabled: [row({ memberNumber: null })] }), true);
    expect(enabled.rows[0].n).toBeNull();
  });

  it("la categoría sale con la etiqueta del Libro, no el enum", () => {
    const [enabled] = electoralWorkbookSpec(roll({ enabled: [row({ category: "adherent" })] }), true);
    expect(enabled.rows[0].cat).toBe("Adherente");
  });

  it("ninguna hoja lleva DNI, email ni domicilio", () => {
    const sheets = electoralWorkbookSpec(roll({ enabled: [row()] }), true);
    const everything = JSON.stringify(sheets).toLowerCase();
    expect(everything).not.toContain("dni");
    expect(everything).not.toContain("email");
    expect(everything).not.toContain("domicilio");
  });

  it("las fechas van como Date nativas con numFmt dd/mm/yyyy, para que ordenen bien", () => {
    const sheets = electoralWorkbookSpec(roll({ enabled: [row()] }), true);
    const inCol = sheets[0].columns.find((c) => c.key === "in")!;
    expect(inCol.style).toEqual({ numFmt: "dd/mm/yyyy" });
    expect(sheets[0].rows[0].in).toBeInstanceOf(Date);
  });
});
```

- [ ] **Step 2: Rojo**

Run: `npx vitest run tests/electoral-export.test.ts`
Expected: FAIL — el módulo no existe.

- [ ] **Step 3: Implementar `src/lib/members/electoral-export.ts`**

```ts
// Construcción pura del padrón electoral exportable a Excel (REG-31: la Junta
// pidió "Excel/PDF"; el CSV de la 4C fue una divergencia deliberada que la
// decisión del 27/08/2026 cierra). Nada de acá toca la base ni ExcelJS —patrón
// `members/export.ts`—, así que se testea sin fakes de infraestructura;
// `route.ts` sólo materializa el Workbook con lo que esta función devuelve.
//
// Tres hojas —una por bloque, en el orden de la pantalla— porque cada bloque es
// un documento distinto: la hoja de la mesa, la lista de cobro y la nómina de
// los que aún no llegan a los 90 días. La hoja vacía SE CREA igual, con sólo el
// encabezado: una hoja faltante parece un error de exportación, una vacía
// informa (precedente: resumen-export).
//
// Sin DNI, sin email, sin domicilio (REG-31 + Ley 25.326, pertinencia): las
// columnas son las de la hoja impresa y ni una más.
import type { ElectoralRoll, ElectoralRow } from "@/lib/members/electoral";
import { enabledFrom } from "@/lib/members/electoral";
import { CATEGORY_LABELS } from "@/lib/members/labels";

export type ElectoralExportColumn = {
  header: string;
  key: string;
  width: number;
  style?: { numFmt: string };
};

export type ElectoralExportCell = string | number | Date | null;

export type ElectoralSheetSpec = {
  name: string;
  columns: ElectoralExportColumn[];
  rows: Record<string, ElectoralExportCell>[];
  /** Fila final de totales (sólo la hoja de purga, y sólo si tiene filas). El
   *  monto va en null cuando no hay valor de cuota vigente: celda vacía, nunca
   *  un cero. */
  totals?: Record<string, ElectoralExportCell>;
};

// Fechas nativas con numFmt, no texto DD/MM/AAAA: un texto ordena mal en Excel
// (compara el día antes que el año). `joinedAt` ya vive a mediodía UTC, así que
// no hay que re-anclar nada (mismo razonamiento que members/export.ts:17-22).
const DATE_FMT = { numFmt: "dd/mm/yyyy" } as const;
// Monto nativo con formato moneda: el bloque "a purgar" ES una lista de cobro y
// la Junta suma sobre él en la mesa.
const ARS_FMT = { numFmt: '"$" #,##0.00' } as const;

const BASE_COLUMNS: ElectoralExportColumn[] = [
  { header: "numero_socio", key: "n", width: 12 },
  { header: "apellido_nombre", key: "name", width: 32 },
  { header: "categoria", key: "cat", width: 14 },
  { header: "fecha_ingreso", key: "in", width: 14, style: DATE_FMT },
];

function baseRow(r: ElectoralRow): Record<string, ElectoralExportCell> {
  return {
    // El socio sin número del libro abierto va con la celda VACÍA: el guión es
    // presentación de pantalla, y acá un texto rompería el orden numérico.
    n: r.memberNumber,
    name: r.fullName,
    cat: CATEGORY_LABELS[r.category],
    in: r.joinedAt,
  };
}

export function electoralWorkbookSpec(roll: ElectoralRoll, valued: boolean): ElectoralSheetSpec[] {
  return [
    {
      name: "Habilitados",
      columns: BASE_COLUMNS,
      rows: roll.enabled.map(baseRow),
    },
    {
      name: "Con deuda a purgar",
      columns: [
        ...BASE_COLUMNS,
        { header: "cuotas_adeudadas", key: "fees", width: 12 },
        { header: "monto_a_purgar", key: "amount", width: 16, style: ARS_FMT },
      ],
      rows: roll.toPurge.map((r) => ({ ...baseRow(r), fees: r.arrears, amount: r.debt })),
      totals:
        roll.toPurge.length === 0
          ? undefined
          : {
              name: "Total a purgar",
              fees: roll.purgeFees,
              amount: valued ? roll.purgeAmount : null,
            },
    },
    {
      name: "No habilitados por antigüedad",
      columns: [
        ...BASE_COLUMNS,
        { header: "habilitado_desde", key: "from", width: 16, style: DATE_FMT },
      ],
      rows: roll.withoutSeniority.map((r) => ({ ...baseRow(r), from: enabledFrom(r.joinedAt) })),
    },
  ];
}
```

- [ ] **Step 4: Verde**

Run: `npx vitest run tests/electoral-export.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/members/electoral-export.ts tests/electoral-export.test.ts
git commit -m "feat(electoral): pure workbook spec for the roll export"
```

---

### Task 4: La route sirve .xlsx y el CSV se retira

**Files:**
- Modify: `src/app/api/admin/padron-electoral/route.ts` (reescritura completa, abajo)
- Modify: `src/lib/members/electoral.ts` (borrar `electoralCsv`, `cell`, `FORMULA_LEAD`, `CSV_HEADER`: líneas 212-263)
- Test: `tests/padron-electoral-route.test.ts` (reescritura de la sección de descarga), `tests/members-electoral.test.ts` (borrar los tests del CSV)

**Interfaces:**
- Consumes: `electoralWorkbookSpec` (Task 3), `buildElectoralRoll` con `withoutSeniority: ElectoralRow[]` (Task 2).
- Produces: `GET /api/admin/padron-electoral?fecha=YYYY-MM-DD` → `.xlsx` (3 hojas), auditoría `electoral_roll_export` con `withoutSeniority` en el detail. La Task 6 enlaza este endpoint desde el botón "Exportar Excel".

- [ ] **Step 1: Reescribir los tests de descarga (fallan primero)**

En `tests/padron-electoral-route.test.ts`:

1. Agregar `import ExcelJS from "exceljs";` junto a los imports de módulo (después de la línea 25).
2. Extender el helper `memberRow` para aceptar `joinedAt`:

```ts
function memberRow(
  over: { id?: number; fullName?: string; category?: string; joinedAt?: Date } = {},
) {
  return {
    id: over.id ?? 1,
    fullName: over.fullName ?? "Coñuecar, Marta",
    category: over.category ?? "active",
    joinedAt: over.joinedAt ?? new Date("2019-09-01T12:00:00Z"),
    memberships: [{ memberNumber: 42, book: { status: "open" } }],
  };
}
```

3. Agregar el helper de lectura, debajo de `requestWithQuery`:

```ts
async function loadWorkbook(res: Response) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await res.arrayBuffer());
  return wb;
}
```

4. **Borrar** los dos tests del CSV: "returns the CSV with the attachment headers…" y "starts the body with the BOM…". Reemplazar el `describe("… — descarga")` por:

```ts
describe("GET /api/admin/padron-electoral — descarga", () => {
  beforeEach(() => {
    (requireSuperadmin as MockedFn).mockResolvedValue(ok);
  });

  it("returns the workbook with the attachment headers and the date in the filename", async () => {
    (prisma.member.findMany as MockedFn).mockResolvedValue([memberRow()]);

    const res = await GET(requestWithQuery({ fecha: "2026-11-15" }));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(res.headers.get("Content-Disposition")).toBe(
      'attachment; filename="padron-electoral-2026-11-15.xlsx"',
    );
    // Magic bytes de un .xlsx (es un ZIP): "PK".
    const buffer = Buffer.from(await res.clone().arrayBuffer());
    expect(buffer.subarray(0, 2).toString()).toBe("PK");
  });

  it("arma las tres hojas en el orden de la pantalla, la vacía incluida", async () => {
    (prisma.member.findMany as MockedFn).mockResolvedValue([memberRow()]);

    const wb = await loadWorkbook(await GET(requestWithQuery({ fecha: "2026-11-15" })));

    expect(wb.worksheets.map((ws) => ws.name)).toEqual([
      "Habilitados",
      "Con deuda a purgar",
      "No habilitados por antigüedad",
    ]);
    // La hoja vacía se crea igual, con sólo el encabezado: informa que la lista
    // está vacía; una hoja faltante parecería un error de exportación.
    expect(wb.getWorksheet("Con deuda a purgar")!.rowCount).toBe(1);
  });

  it("el que no llega a los 90 días sale en su hoja, con desde cuándo puede votar", async () => {
    (prisma.member.findMany as MockedFn).mockResolvedValue([
      memberRow(),
      memberRow({ id: 2, fullName: "Nuevo, Vecino", joinedAt: new Date("2026-10-01T12:00:00Z") }),
    ]);

    const wb = await loadWorkbook(await GET(requestWithQuery({ fecha: "2026-11-15" })));
    const ws = wb.getWorksheet("No habilitados por antigüedad")!;

    expect(ws.rowCount).toBe(2);
    expect(ws.getRow(2).getCell(2).value).toBe("Nuevo, Vecino");
    // habilitado_desde = 01/10/2026 + 90 días.
    expect(ws.getRow(2).getCell(5).value).toEqual(new Date("2026-12-30T12:00:00Z"));
  });

  it("ninguna hoja lleva DNI, email ni domicilio en sus encabezados", async () => {
    (prisma.member.findMany as MockedFn).mockResolvedValue([memberRow()]);

    const wb = await loadWorkbook(await GET(requestWithQuery({ fecha: "2026-11-15" })));

    for (const ws of wb.worksheets) {
      const headerRow = (ws.getRow(1).values as unknown[]).join(",").toLowerCase();
      expect(headerRow, ws.name).not.toContain("dni");
      expect(headerRow, ws.name).not.toContain("email");
      expect(headerRow, ws.name).not.toContain("domicilio");
    }
  });

  it("attaches no-store, private cache headers so no intermediary can cache the roll", async () => {
    const res = await GET(requestWithQuery({ fecha: "2026-11-15" }));

    expect(res.headers.get("Cache-Control")).toBe("no-store, private");
    expect(res.headers.get("Vary")).toContain("Cookie");
  });

  it("writes an audit entry with the date used and the block sizes — never a name", async () => {
    (prisma.member.findMany as MockedFn).mockResolvedValue([
      memberRow({ id: 1, fullName: "Pérez, Ana" }),
      memberRow({ id: 2, fullName: "Gómez, Luis" }),
      memberRow({ id: 3, fullName: "Nuevo, Vecino", joinedAt: new Date("2026-10-01T12:00:00Z") }),
    ]);
    (prisma.fee.groupBy as MockedFn).mockResolvedValue([{ memberId: 2, _count: { _all: 3 } }]);

    await GET(requestWithQuery({ fecha: "2026-11-15" }));

    expect(audit).toHaveBeenCalledTimes(1);
    const entry = (audit as MockedFn).mock.calls[0][0];
    expect(entry).toMatchObject({
      userId: 7,
      action: "electoral_roll_export",
      detail: { at: "2026-11-15", enabled: 1, toPurge: 1, purgeFees: 3, withoutSeniority: 1 },
      ip: "10.0.0.7",
    });
    const serialized = JSON.stringify(entry.detail);
    expect(serialized).not.toContain("Pérez");
    expect(serialized).not.toContain("Gómez");
    expect(serialized).not.toContain("Nuevo");
  });
});
```

Los `describe` de autorización y de fecha **quedan tal cual**.

- [ ] **Step 2: Rojo**

Run: `npx vitest run tests/padron-electoral-route.test.ts`
Expected: FAIL (la route sigue emitiendo CSV).

- [ ] **Step 3: Reescribir la route completa**

`src/app/api/admin/padron-electoral/route.ts` — contenido completo nuevo:

```ts
// Export del padrón electoral (REG-31: "Excel/PDF") en .xlsx. Reemplaza al CSV
// del cierre de la 4C por decisión del operador del 27/08/2026 (spec del
// rediseño §2): mismo path, misma guarda y la misma validación de fecha; cambia
// el cuerpo. Molde: padron-export/route.ts y el addSheet de resumen-export.
//
// Deja asiento: llevarse el padrón SÍ es un hecho auditable (mismo criterio que
// `padron_export`). La pantalla deja el suyo al generar, que es un hecho
// distinto —se puede imprimir sin pasar nunca por acá—.
import ExcelJS from "exceljs";
import { headers } from "next/headers";
import type { NextRequest } from "next/server";
import { audit } from "@/lib/audit";
import { requireSuperadmin } from "@/lib/auth/require-admin";
import { parseCivilDate } from "@/lib/dates";
import { buildElectoralRoll } from "@/lib/members/electoral";
import { electoralWorkbookSpec } from "@/lib/members/electoral-export";
import { prisma } from "@/lib/prisma";
import { feeValueReader } from "@/lib/treasury/fee-values";

export async function GET(req: NextRequest) {
  const actor = await requireSuperadmin();
  if (!actor.ok) return new Response(actor.error, { status: 403 });
  const raw = req.nextUrl.searchParams.get("fecha") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return new Response("Fecha inválida.", { status: 400 });
  const parsed = parseCivilDate(raw, { minYear: 2020, invalidError: "Fecha inválida." });
  if (!parsed.ok) return new Response(parsed.error, { status: 400 });

  const feeValue = await feeValueReader.current();
  const roll = await buildElectoralRoll(prisma, parsed.value, feeValue);

  const wb = new ExcelJS.Workbook();
  for (const sheet of electoralWorkbookSpec(roll, feeValue !== null)) {
    const ws = wb.addWorksheet(sheet.name);
    ws.columns = sheet.columns.map((c) => ({ ...c }));
    ws.getRow(1).font = { bold: true };
    for (const row of sheet.rows) ws.addRow(row);
    if (sheet.totals) ws.addRow(sheet.totals).font = { bold: true };
  }
  const buffer = await wb.xlsx.writeBuffer();

  await audit({
    userId: actor.actorId,
    action: "electoral_roll_export",
    // Sin `entity`: el asiento no es sobre ninguna fila en particular (mismo
    // criterio que `padron_export`). Metadatos: la fecha y los tamaños de los
    // TRES bloques. Nunca las filas.
    detail: {
      at: raw,
      enabled: roll.enabled.length,
      toPurge: roll.toPurge.length,
      purgeFees: roll.purgeFees,
      withoutSeniority: roll.withoutSeniority.length,
    },
    ip: (await headers()).get("x-real-ip") ?? "unknown",
  });

  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="padron-electoral-${raw}.xlsx"`,
      // Nombres y números de socio de 160 personas (Ley 25.326): fuera de toda
      // caché, igual que el export del padrón administrativo.
      "Cache-Control": "no-store, private",
      Vary: "Cookie",
    },
  });
}
```

- [ ] **Step 4: Retirar el CSV del dominio**

En `src/lib/members/electoral.ts`, **borrar** desde `const CSV_HEADER = …` (línea 212) hasta el final de `electoralCsv` (línea 263): `CSV_HEADER`, `FORMULA_LEAD`, `cell` y `electoralCsv`. Toda esa ceremonia (BOM, CRLF, apóstrofo anti-fórmula) es específica de CSV: en .xlsx una celda de string es un shared string y el apóstrofo se vería literal.

En `tests/members-electoral.test.ts`:
1. Quitar `electoralCsv` del import.
2. **Borrar** los tests: "el CSV lleva las columnas de REG-31…", "el CSV no lleva DNI…", "el habilitado no publica cuántas cuotas debe…", "el CSV entrecomilla el apellido…", "el CSV termina en CRLF…", "neutraliza el nombre que Excel abriría como fórmula", "no le pone apóstrofo al nombre normal". (Su cobertura vive ahora en `tests/electoral-export.test.ts` y en la route.)
3. En "el bloque a purgar y el CSV salen en el MISMO orden alfabético": renombrarlo a `"el bloque a purgar sale en el MISMO orden alfabético"` y borrar las tres líneas del CSV (la constante `csv` y los dos `expect(csv.indexOf…)`); las aserciones sobre `roll.toPurge` quedan.

- [ ] **Step 5: Verde**

Run: `npx vitest run tests/padron-electoral-route.test.ts tests/members-electoral.test.ts tests/electoral-export.test.ts && npx tsc --noEmit`
Expected: PASS y sin errores de tipos.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/admin/padron-electoral/route.ts src/lib/members/electoral.ts tests/padron-electoral-route.test.ts tests/members-electoral.test.ts
git commit -m "feat(electoral): serve the roll export as a three-sheet xlsx, replacing the CSV"
```

---

### Task 5: La hoja — tercer bloque, Cards y presentación dual

**Files:**
- Modify: `src/app/admin/padron-electoral/roll-sheet.tsx` (reescritura completa, abajo)
- Test: `tests/padron-electoral-screen.test.ts` (describe `ElectoralRollSheet`)

**Interfaces:**
- Consumes: `ElectoralRoll` con `withoutSeniority: ElectoralRow[]` (Task 2), `enabledFrom` (Task 1).
- Produces: secciones con anclas `#habilitados`, `#a-purgar`, `#no-habilitados` (la Task 6 enlaza a ellas desde las stat cards). Props de `ElectoralRollSheet` sin cambios.

- [ ] **Step 1: Actualizar y ampliar los tests de la hoja (fallan primero)**

En `tests/padron-electoral-screen.test.ts`, dentro de `describe("ElectoralRollSheet — qué sale impreso")`:

1. Agregar estos tests nuevos:

```ts
  it("lista al que no llega a los 90 días, con desde cuándo puede votar", () => {
    const html = sheet(
      roll({
        withoutSeniority: [
          row({ memberId: 9, fullName: "Nuevo, Vecino", joinedAt: new Date("2026-10-01T12:00:00Z") }),
        ],
      }),
    );

    expect(html).toContain("No habilitados por antigüedad");
    expect(html).toContain("Nuevo, Vecino");
    // enabledFrom: 01/10/2026 + 90 días.
    expect(html).toContain("30/12/2026");
    // La nota niega el trámite: si la Junta lo lee como "otra lista que puede
    // regularizar", el error es peor que no imprimirlo.
    expect(html).toContain("no hay trámite que lo modifique");
    // Y este bloque no publica deuda de nadie.
    expect(html).not.toContain("A purgar</th>");
  });

  it("con todos los considerados en edad, el bloque nuevo dice la buena noticia", () => {
    const html = sheet(roll({ enabled: [row()] }));

    expect(html).toContain("alcanzan los 90 días de antigüedad");
  });

  it("la cabecera de papel cuenta los TRES bloques", () => {
    const html = sheet(
      roll({
        enabled: [row()],
        withoutSeniority: [row({ memberId: 9, fullName: "Nuevo, Vecino" })],
      }),
    );

    expect(html).toContain("1 habilitados");
    expect(html).toContain("1 no habilitados por antigüedad");
  });

  it("los tres bloques salen en el orden de la pantalla", () => {
    const html = sheet(
      roll({
        enabled: [row()],
        toPurge: [row({ memberId: 2, arrears: 1, debt: 6000 })],
        withoutSeniority: [row({ memberId: 9, fullName: "Nuevo, Vecino" })],
      }),
    );

    expect(html.indexOf("Habilitados")).toBeLessThan(html.indexOf("Con deuda a purgar"));
    expect(html.indexOf("Con deuda a purgar")).toBeLessThan(
      html.indexOf("No habilitados por antigüedad"),
    );
  });

  it("la nota del socio sin número también dispara desde el bloque nuevo", () => {
    const html = sheet(roll({ withoutSeniority: [row({ memberNumber: null })] }));

    expect(html).toContain("figura primero");
  });

  it("cada bloque tiene su ancla para las stat cards", () => {
    const html = sheet(roll({ enabled: [row()] }));

    expect(html).toContain('id="habilitados"');
    expect(html).toContain('id="a-purgar"');
    expect(html).toContain('id="no-habilitados"');
  });

  it("el papel imprime la tabla y esconde las tarjetas; el móvil al revés", () => {
    const html = sheet(roll({ enabled: [row()] }));

    // La tabla vive en el wrapper que el papel muestra…
    expect(html).toContain("hidden md:block print:block");
    // …y las tarjetas apiladas en el que el papel esconde.
    expect(html).toContain("md:hidden print:hidden");
  });
```

2. En "un bloque vacío no renderiza un thead sin filas": agregar al final
   `expect(html).toContain("alcanzan los 90 días de antigüedad");`

- [ ] **Step 2: Rojo**

Run: `npx vitest run tests/padron-electoral-screen.test.ts`
Expected: FAIL (los tests nuevos).

- [ ] **Step 3: Reescribir `roll-sheet.tsx`**

Contenido completo nuevo de `src/app/admin/padron-electoral/roll-sheet.tsx`:

```tsx
// El cuerpo del padrón electoral, separado de la página para poder renderizarlo
// en un test sin Prisma ni sesión (mismo recurso que `ManualCollectionSheet`).
//
// Esta hoja SALE del sistema: se imprime y se la lleva la Junta Electoral, que
// es un cuerpo de vecinos y no la Comisión. Por eso las columnas son las de
// REG-31 y ni una más —número, nombre, categoría— con la fecha de ingreso, que
// es la prueba de los 90 días y lo único que contesta el "¿y éste por qué está?"
// que se pregunta en voz alta en la mesa. **Sin DNI**: es el dato más sensible
// del padrón y no hace falta para tomar lista.
//
// Los tres bloques no son una lista filtrada en pedazos: son documentos
// distintos. "Habilitados" se lee de corrido en la mesa; "Con deuda a purgar"
// es una lista de cobro, el único que lleva plata y el único que suma; y "No
// habilitados por antigüedad" (decisión del operador del 27/08/2026) contesta
// el "¿por qué no estoy?" del vecino nuevo — con la fecha desde la que va a
// poder votar, que no envejece ni depende de la elección.
//
// En PANTALLA cada bloque va en una Card y en móvil las filas apilan como
// tarjetas (patrón de /admin/socios). El PAPEL sigue siendo tabla plana:
// `hidden md:block print:block` muestra la tabla, `md:hidden print:hidden`
// esconde las tarjetas — sin esos `print:*`, imprimir desde un celular sacaría
// la versión de tarjetas.
import { EmptyState } from "@/components/admin/empty-state";
import { FormMessage } from "@/components/admin/form-message";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { formatARS, formatDateAR, formatDateTimeAR } from "@/lib/format";
import type { ElectoralRoll, ElectoralRow } from "@/lib/members/electoral";
import { ELECTORAL_MIN_DAYS, enabledFrom } from "@/lib/members/electoral";
import { CATEGORY_LABELS } from "@/lib/members/labels";
import { periodLabel } from "@/lib/treasury/periods";

// A4 vertical. La regla vive acá y no en `globals.css` porque `@page` no se
// puede acotar por ruta (mismo motivo que la hoja de gestión manual).
const PAGE_CSS = "@page { size: A4 portrait; margin: 14mm 12mm; }";

// Con `table-fixed` el navegador reparte exactamente esto. El nombre se queda
// con la mayor parte de la hoja: es lo único que se busca con el dedo en la
// mesa. (La suma por bloque no da 100 justo; table-fixed normaliza.)
const W = {
  number: "w-[10%]",
  name: "w-[46%]",
  category: "w-[18%]",
  joined: "w-[16%]",
  fees: "w-[10%]",
  amount: "w-[16%]",
  from: "w-[16%]",
} as const;

/** La fila del bloque en móvil (patrón MemberCard de /admin/socios): tarjeta
 *  compacta, nombre + número arriba y los metadatos como fila envolvente. */
function RowCard({ r, showDebt, showEnabledFrom }: {
  r: ElectoralRow;
  showDebt?: boolean;
  showEnabledFrom?: boolean;
}) {
  return (
    <Card size="sm">
      <CardContent className="space-y-1">
        <p className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="font-medium">{r.fullName}</span>
          <span className="font-mono text-sm tabular-nums text-muted-foreground">
            N° {r.memberNumber ?? "—"}
          </span>
        </p>
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span>{CATEGORY_LABELS[r.category]}</span>
          <span>Ingreso {formatDateAR(r.joinedAt)}</span>
          {showEnabledFrom && <span>Vota desde el {formatDateAR(enabledFrom(r.joinedAt))}</span>}
          {showDebt && (
            <span className="font-mono tabular-nums text-foreground">
              {r.arrears} {r.arrears === 1 ? "cuota" : "cuotas"}
              {r.debt !== null && ` · ${formatARS(r.debt)}`}
            </span>
          )}
        </p>
      </CardContent>
    </Card>
  );
}

function RollBlock({ id, title, note, rows, showDebt, showEnabledFrom, empty, totals }: {
  id: string;
  title: string;
  note: string;
  rows: ElectoralRow[];
  showDebt?: boolean;
  showEnabledFrom?: boolean;
  empty: string;
  totals?: { fees: number; amount: number; valued: boolean };
}) {
  return (
    // `scroll-mt-4`: las stat cards de la página enlazan a estas anclas.
    // `break-after-avoid-page` sólo en el encabezado: un bloque de 160 filas no
    // entra en una hoja y forzarlo dejaría la primera en blanco.
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-4 space-y-2">
      <div className="space-y-1 break-after-avoid-page">
        <h2 id={`${id}-title`} className="text-sm font-semibold tracking-widest uppercase">
          {title} <span className="font-mono tabular-nums">({rows.length})</span>
        </h2>
        <p className="max-w-prose text-xs text-muted-foreground">{note}</p>
      </div>

      {rows.length === 0 ? (
        // Nunca un thead sin filas.
        <EmptyState size="card" description={empty} />
      ) : (
        <>
          {/* La tabla: desktop y PAPEL. La Card se desviste al imprimir. */}
          <div className="hidden md:block print:block">
            <Card className="print:rounded-none print:bg-transparent print:py-0 print:ring-0">
              <CardContent className="print:px-0 print:[&_[data-slot=table-container]]:overflow-visible">
                <Table className="table-fixed print:text-[9pt] print:[&_td]:px-1 print:[&_th]:px-1">
                  <TableHeader>
                    <TableRow className="[&_th]:whitespace-normal [&_th]:align-bottom">
                      <TableHead className={W.number}>N°</TableHead>
                      <TableHead className={W.name}>Socio</TableHead>
                      <TableHead className={W.category}>Categoría</TableHead>
                      <TableHead className={W.joined}>Ingreso</TableHead>
                      {showDebt && <TableHead className={`${W.fees} text-right`}>Cuotas</TableHead>}
                      {showDebt && <TableHead className={`${W.amount} text-right`}>A purgar</TableHead>}
                      {showEnabledFrom && (
                        <TableHead className={W.from}>Habilitado desde</TableHead>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      // Una fila partida entre dos hojas deja el nombre de un
                      // vecino separado de su número.
                      <TableRow key={r.memberId} className="break-inside-avoid [&_td]:align-top">
                        <TableCell className={`${W.number} font-mono tabular-nums`}>
                          {r.memberNumber ?? "—"}
                        </TableCell>
                        <TableCell className={`${W.name} whitespace-normal`}>{r.fullName}</TableCell>
                        <TableCell className={`${W.category} whitespace-normal`}>
                          {CATEGORY_LABELS[r.category]}
                        </TableCell>
                        <TableCell className={`${W.joined} font-mono tabular-nums`}>
                          {formatDateAR(r.joinedAt)}
                        </TableCell>
                        {showDebt && (
                          <TableCell className={`${W.fees} text-right font-mono tabular-nums`}>
                            {r.arrears}
                          </TableCell>
                        )}
                        {showDebt && (
                          <TableCell className={`${W.amount} text-right font-mono tabular-nums`}>
                            {r.debt === null ? "—" : formatARS(r.debt)}
                          </TableCell>
                        )}
                        {showEnabledFrom && (
                          <TableCell className={`${W.from} font-mono tabular-nums`}>
                            {formatDateAR(enabledFrom(r.joinedAt))}
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                  {/* El total es lo que hay que recaudar en la puerta para que
                      voten todos: el número que la Junta lleva a la mesa. */}
                  {totals && (
                    <TableFooter>
                      <TableRow>
                        <TableCell colSpan={4}>Total a purgar</TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {totals.fees}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {totals.valued ? formatARS(totals.amount) : "—"}
                        </TableCell>
                      </TableRow>
                    </TableFooter>
                  )}
                </Table>
              </CardContent>
            </Card>
          </div>

          {/* Las tarjetas: sólo móvil, nunca papel. */}
          <div className="space-y-3 md:hidden print:hidden">
            {rows.map((r) => (
              <RowCard key={r.memberId} r={r} showDebt={showDebt} showEnabledFrom={showEnabledFrom} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

export function ElectoralRollSheet({ roll, valued, pastDate, generatedAt }: {
  roll: ElectoralRoll;
  /** Si había un valor de cuota vigente al generar. Sin él la deuda en pesos no
   *  se puede calcular y la hoja lo dice, en vez de imprimir un cero. */
  valued: boolean;
  /** Si la fecha pedida ya pasó. La hoja mezcla entonces dos relojes y tiene que
   *  decirlo EN PAPEL: ver el aviso de abajo. */
  pastDate: boolean;
  generatedAt: Date;
}) {
  // El socio sin número puede caer en cualquiera de los tres bloques.
  const hasUnnumbered = [...roll.enabled, ...roll.toPurge, ...roll.withoutSeniority].some(
    (r) => r.memberNumber === null,
  );
  return (
    <div className="space-y-6">
      {/* La cabecera del documento, y sólo en papel: en pantalla estos datos ya
          están en la tira de la cuenta y en la Card generadora. Una hoja
          impresa el martes y usada el domingo tiene que decir de cuándo son sus
          números — el padrón se regenera y la versión de la mañana de la
          elección es otra. */}
      <div className="hidden print:block print:space-y-1">
        <h2 className="text-base font-semibold">
          Padrón electoral — elección del {formatDateAR(roll.at)}
        </h2>
        <p className="text-[9pt]">
          {roll.enabled.length} habilitados · {roll.toPurge.length} con deuda a purgar ·{" "}
          {roll.withoutSeniority.length} no habilitados por antigüedad · generado el{" "}
          {formatDateTimeAR(generatedAt)}
        </p>
        {/* El orden se dice EN PAPEL: el que toma lista busca por apellido. El
            socio sin número va primero, fuera del orden, y eso también hay que
            avisarlo o se lee como un error de la hoja — pero SÓLO si hay
            alguno: anunciar una fila que no está manda a la Junta a buscarla
            por toda la hoja. */}
        <p className="text-[9pt]">
          Todos los bloques en orden alfabético por apellido.
          {hasUnnumbered && " El socio sin número de socio asentado figura primero, antes del orden."}
        </p>
      </div>

      {/* Se imprime a propósito (no lleva `print:hidden`): el que lee el papel
          meses después es quien más necesita saberlo. */}
      {pastDate && (
        <FormMessage kind="warning" box>
          Esta fecha ya pasó y la hoja mezcla dos relojes: la <strong>antigüedad</strong> se mide al{" "}
          {formatDateAR(roll.at)}, pero la <strong>mora</strong> y la{" "}
          <strong>condición de socio</strong> se leen como están al generarla (
          {formatDateTimeAR(generatedAt)}). El que pagó después de la elección figura acá como
          habilitado, y el que se dio de baja después no figura en ningún bloque — tampoco en el de
          no habilitados por antigüedad. No es el padrón de aquel día: no sirve para resolver una
          impugnación.
        </FormMessage>
      )}

      {!valued && (
        <FormMessage kind="warning" box>
          No hay un valor de cuota vigente: la deuda en pesos no se puede calcular. Registralo en
          Tesorería → Valores y volvé a generar el padrón.
        </FormMessage>
      )}

      <FormMessage kind="neutral" box role="none">
        El socio con deuda <strong>no está excluido</strong>: puede saldarla hasta una hora antes del
        acto y votar. Por eso figura acá, con lo que tiene que pagar en la mesa. Volvé a generar el
        padrón después del cierre de caja para tener la lista definitiva.
      </FormMessage>

      <RollBlock
        id="habilitados"
        title="Habilitados"
        note={`Votan sin trámite previo: no registran mora exigible y reúnen ${ELECTORAL_MIN_DAYS} días de antigüedad — salvo honorarios y vitalicios, a quienes el estatuto exime de ese piso (REG-30).`}
        rows={roll.enabled}
        empty="Ningún socio queda habilitado a esta fecha."
      />

      <RollBlock
        id="a-purgar"
        title="Con deuda a purgar"
        note="Activos y colaboradores con cuotas impagas anteriores al mes de la elección. Votan si pagan lo que figura acá, hasta una hora antes del acto."
        rows={roll.toPurge}
        showDebt
        empty="Ningún socio del padrón registra mora: no hay nada que purgar."
        totals={{ fees: roll.purgeFees, amount: roll.purgeAmount, valued }}
      />

      <RollBlock
        id="no-habilitados"
        title="No habilitados por antigüedad"
        note={`No alcanzan los ${ELECTORAL_MIN_DAYS} días de antigüedad a la fecha de la elección (REG-30). No votan en este acto, y no hay trámite que lo modifique: la antigüedad se cumple con el tiempo.`}
        rows={roll.withoutSeniority}
        showEnabledFrom
        empty={`Todos los socios considerados alcanzan los ${ELECTORAL_MIN_DAYS} días de antigüedad.`}
      />

      <p className="text-xs text-muted-foreground">
        La deuda se valúa al valor de cuota vigente y se cuenta sobre los períodos anteriores a{" "}
        {periodLabel(roll.period)}: la cuota del mes en curso todavía no es mora.
      </p>

      {/* Último hijo a propósito: un `<style>` cuenta para el selector `* + *`
          de `space-y-6` y puesto primero correría todo un renglón hacia abajo. */}
      <style>{PAGE_CSS}</style>
    </div>
  );
}
```

Nota: el wrapper `print:[&_[data-slot=table-container]]:overflow-visible` se movió del `div` viejo al `CardContent` — sin él, el `overflow-x-auto` del componente `Table` corta la impresión en una sola hoja.

- [ ] **Step 4: Verde**

Run: `npx vitest run tests/padron-electoral-screen.test.ts && npx tsc --noEmit`
Expected: PASS. Si algún test viejo de la hoja falla, leer QUÉ espera antes de tocar: los textos de los avisos y las columnas existentes no cambiaron de contenido, sólo el de `pastDate` ganó la frase del bloque nuevo.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/padron-electoral/roll-sheet.tsx tests/padron-electoral-screen.test.ts
git commit -m "feat(electoral): third block, cards and dual table/card layout in the roll sheet"
```

---

### Task 6: La página — Card generadora, tira de la cuenta y flag en Card

**Files:**
- Modify: `src/app/admin/padron-electoral/page.tsx` (reescritura completa, abajo)
- Test: `tests/padron-electoral-screen.test.ts` (describe `PadronElectoralPage`)

**Interfaces:**
- Consumes: anclas `#habilitados` / `#a-purgar` / `#no-habilitados` (Task 5), endpoint .xlsx (Task 4), `withoutSeniority: ElectoralRow[]` (Task 2).
- Produces: pantalla final. `generateRoll` audita también `withoutSeniority` (conteo).

- [ ] **Step 1: Actualizar los tests de la página (fallan primero)**

En `tests/padron-electoral-screen.test.ts`, describe `PadronElectoralPage`:

1. Reemplazar las dos aserciones `expect(html).not.toContain("Exportar CSV")` por `expect(html).not.toContain("Exportar Excel")` (tests "bloquea al admin común" y "rechaza una fecha inválida").
2. En "lleva el link de exportación a la misma fecha que muestra", agregar al final:
   `expect(html).toContain("Exportar Excel");`
3. En "deja asiento al generar…": el `detail` esperado pasa a
   `detail: { at: "2026-11-15", enabled: 1, toPurge: 1, purgeFees: 3, withoutSeniority: 0 },`
4. En "muestra la cuenta completa y no sólo el resultado": reemplazar las aserciones finales por

```ts
    expect(html).toContain("considerados");
    expect(html).toContain("no habilitados por antigüedad");
    expect(html).toContain("A purgar en la mesa");
    // Las stat cards de bloque son anclas a su sección.
    expect(html).toContain('href="#habilitados"');
    expect(html).toContain('href="#a-purgar"');
    expect(html).toContain('href="#no-habilitados"');
```

5. Agregar un test nuevo al final del describe:

```ts
  it("agrupa fecha, export e imprimir en la Card generadora", async () => {
    const html = await page("2026-11-15");

    expect(html).toContain("Generar padrón");
    expect(html).toContain("Exportar Excel");
    expect(html).toContain("Imprimir");
    // El flag estatutario sigue en la pantalla, ahora en su propia Card.
    expect(html).toContain("Elecciones en curso");
  });
```

- [ ] **Step 2: Rojo**

Run: `npx vitest run tests/padron-electoral-screen.test.ts`
Expected: FAIL.

- [ ] **Step 3: Reescribir `page.tsx`**

Contenido completo nuevo de `src/app/admin/padron-electoral/page.tsx`:

```tsx
// Padrón electoral (REG-31 + enmienda del 23/08/2026). Superadmin.
//
// La fecha de la elección es un PARÁMETRO y viaja en la URL (`?fecha=`): el
// padrón se regenera en cualquier momento —incluida la mañana de la elección,
// que es justamente cuando los morosos terminan de purgar— y el link se comparte
// con la Junta Electoral.
//
// El sistema NO gestiona la elección: entrega el padrón y nada más (REG-31).
//
// La firma visual de la pantalla (rediseño del 27/08/2026) es LA CUENTA: la
// igualdad `considerados = habilitados + a purgar + no habilitados` como tira
// de stat cards con los signos a la vista. "148 habilitados" sólo se puede
// creer; la igualdad se puede verificar, y es lo que distingue "tres son
// demasiado nuevos" de "tres faltan por un problema de datos".
import { CalendarClock, FileSpreadsheet, Users, Vote, Wallet } from "lucide-react";
import { headers } from "next/headers";
import { FormMessage } from "@/components/admin/form-message";
import { PageHeader } from "@/components/admin/page-header";
import { PrintButton } from "@/components/admin/print-button";
import { Button } from "@/components/ui/button";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { audit } from "@/lib/audit";
import { requireSuperadmin } from "@/lib/auth/require-admin";
import { CONFIG_KEYS, configReader } from "@/lib/config";
import { parseCivilDate } from "@/lib/dates";
import { formatARS, formatDateAR } from "@/lib/format";
import { buildElectoralRoll, ELECTORAL_MIN_DAYS } from "@/lib/members/electoral";
import { prisma } from "@/lib/prisma";
import { feeValueReader } from "@/lib/treasury/fee-values";
import { civilDayOf } from "@/lib/treasury/periods";
import { ElectionsFlagForm } from "./elections-flag-form";
import { ElectoralRollSheet } from "./roll-sheet";

export const dynamic = "force-dynamic";
export const metadata = { title: "Padrón electoral — SIGeV" };

const DATE_ERROR = "La fecha de la elección no es válida.";

/** Hoy según el calendario ARGENTINO, no el reloj UTC del server: a las 21:00 de
 *  acá, `new Date().toISOString()` ya está en el día siguiente y la pantalla
 *  abriría con la fecha de mañana. */
function isoToday(): string {
  return civilDayOf().toISOString().slice(0, 10);
}

export default async function PadronElectoralPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // La ruta se autoriza a sí misma aunque `admin/layout.tsx` ya bloquee: el
  // layout mira el token (hasta 8 h desactualizado) y esto es una lista de
  // vecinos que se imprime y sale del sistema, más el interruptor de una regla
  // estatutaria.
  const actor = await requireSuperadmin();
  if (!actor.ok) {
    // Pantalla de bloqueo, NO redirect (mismo motivo que /admin/configuracion:
    // acá no falta la sesión, falta un rol).
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
    ? parseCivilDate(raw, { minYear: 2020, invalidError: DATE_ERROR })
    : { ok: false as const, error: DATE_ERROR };

  const ongoing = await configReader.getBool(CONFIG_KEYS.electionsOngoing);
  // Todo se resuelve acá y no en un componente async anidado: el cuerpo del
  // padrón es lo único que esta pantalla muestra, así que no hay nada que
  // adelantar mientras se arma, y de paso se puede renderizar entera en un test.
  const generated = parsed.ok ? await generateRoll(parsed.value, actor.actorId) : null;

  return (
    <div className="space-y-6">
      <PageHeader title="Padrón electoral">
        <p className="max-w-prose text-sm text-muted-foreground">
          Socios con derecho a voto a la fecha indicada: activos, colaboradores y adherentes con{" "}
          {ELECTORAL_MIN_DAYS} días o más de antigüedad (REG-31), más honorarios y vitalicios, que
          votan sin ese piso (REG-30). Quien no llega a los {ELECTORAL_MIN_DAYS} días figura aparte,
          con la fecha desde la que va a poder votar. El sistema entrega el padrón; no gestiona la
          elección.
        </p>
      </PageHeader>

      {/* La fecha y sus salidas JUNTAS: lo que se exporta o imprime es el
          padrón A ESA FECHA, y la dependencia queda a la vista en vez de
          repartida entre el encabezado y un formulario suelto. */}
      <Card className="print:hidden">
        <CardHeader>
          <CardTitle>Generar padrón</CardTitle>
          <CardDescription>
            La fecha viaja en la URL: el link se comparte con la Junta Electoral y el padrón se
            regenera en cualquier momento, incluida la mañana del acto.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* GET y no server action: la fecha tiene que quedar en la URL para
              poder compartir el padrón y para que el botón atrás vuelva al
              anterior. */}
          <form method="get" className="flex flex-wrap items-end gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="fecha">Fecha de la elección</Label>
              <Input id="fecha" type="date" name="fecha" defaultValue={raw} className="h-11 w-auto" />
            </div>
            <Button type="submit" variant="secondary" className="h-11">Generar</Button>
          </form>
          {generated && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
              <Button asChild variant="outline">
                {/* `<a>` y no `<Link>`: es una descarga, no una navegación. */}
                <a href={`/api/admin/padron-electoral?fecha=${raw}`}>
                  <FileSpreadsheet aria-hidden className="size-4" />
                  Exportar Excel
                </a>
              </Button>
              <PrintButton />
              <p className="text-sm text-muted-foreground">
                Padrón al{" "}
                <strong className="font-mono tabular-nums">
                  {formatDateAR(generated.roll.at)}
                </strong>
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {!parsed.ok && <FormMessage kind="error" box>{parsed.error}</FormMessage>}

      {generated && (
        <div className="space-y-6">
          {/* LA CUENTA, no el resultado: la igualdad con los signos a la vista.
              En papel no va (la cabecera de la hoja ya trae los conteos). */}
          <div className="space-y-1.5 print:hidden">
            <div className="flex flex-wrap items-stretch gap-2">
              <StatCard icon={Users} n={generated.roll.considered} label="considerados" />
              <Operator glyph="=" />
              <StatCard
                icon={Vote}
                n={generated.roll.enabled.length}
                label="habilitados"
                href="#habilitados"
              />
              <Operator glyph="+" />
              <StatCard
                icon={Wallet}
                n={generated.roll.toPurge.length}
                label="con deuda a purgar"
                href="#a-purgar"
              />
              <Operator glyph="+" />
              <StatCard
                icon={CalendarClock}
                n={generated.roll.withoutSeniority.length}
                label="no habilitados por antigüedad"
                href="#no-habilitados"
              />
            </div>
            {generated.roll.toPurge.length > 0 && (
              <p className="text-sm text-muted-foreground">
                A purgar en la mesa:{" "}
                <span className="font-mono tabular-nums text-foreground">
                  {generated.roll.purgeFees}
                </span>{" "}
                cuotas
                {generated.valued ? (
                  <>
                    {" · "}
                    <span className="font-mono tabular-nums text-foreground">
                      {formatARS(generated.roll.purgeAmount)}
                    </span>
                  </>
                ) : null}
              </p>
            )}
          </div>

          <ElectoralRollSheet
            roll={generated.roll}
            valued={generated.valued}
            pastDate={generated.roll.at.getTime() < civilDayOf().getTime()}
            generatedAt={generated.generatedAt}
          />
        </div>
      )}

      {/* El interruptor del Art. 5° ter, al final: no es parte del padrón (lo
          que hace es bloquear los cambios de categoría en todo el panel). */}
      <Card className="max-w-2xl print:hidden">
        <CardHeader>
          <CardTitle>Elecciones en curso</CardTitle>
        </CardHeader>
        <CardContent>
          <ElectionsFlagForm ongoing={ongoing} />
        </CardContent>
      </Card>
    </div>
  );
}

/** Un signo de la igualdad. Decorativo (`aria-hidden`): un lector de pantalla
 *  ya recorre los cuatro números con sus etiquetas. Oculto en móvil, donde las
 *  tarjetas apilan y la ecuación no se lee en línea. */
function Operator({ glyph }: { glyph: string }) {
  return (
    <span aria-hidden className="hidden items-center font-mono text-2xl text-muted-foreground sm:flex">
      {glyph}
    </span>
  );
}

/** Un sumando de la reconciliación como stat card. Las de bloque son ANCLAS a
 *  su sección (patrón full-card link del tablero: el pseudo-elemento cubre la
 *  tarjeta y el anillo de foco va inset porque Card recorta con overflow).
 *  En cero, el chip se apaga (regla anti-ruido de la 4C). */
function StatCard({ icon: Icon, n, label, href }: {
  icon: typeof Users;
  n: number;
  label: string;
  href?: string;
}) {
  const off = n === 0;
  return (
    <Card size="sm" className="relative min-w-40 flex-1">
      <CardContent className="flex items-center gap-3">
        <span
          className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${
            off ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary"
          }`}
        >
          <Icon aria-hidden className="size-5" />
        </span>
        <span className="min-w-0">
          <span className="block font-mono text-3xl leading-none tabular-nums">{n}</span>
          {href ? (
            <a
              href={href}
              className="text-sm text-muted-foreground outline-hidden after:absolute after:inset-0 after:rounded-xl after:ring-ring after:ring-inset hover:text-foreground hover:underline focus-visible:after:ring-2"
            >
              {label}
            </a>
          ) : (
            <span className="block text-sm text-muted-foreground">{label}</span>
          )}
        </span>
      </CardContent>
    </Card>
  );
}

async function generateRoll(at: Date, actorId: number) {
  const feeValue = await feeValueReader.current();
  const roll = await buildElectoralRoll(prisma, at, feeValue);

  // El asiento se escribe al GENERAR y no al exportar (spec 4C §9). Es
  // deliberado que no dependa del export: esta pantalla se imprime, y el
  // navegador no le avisa al servidor cuando alguien aprieta Imprimir. La
  // exportación deja el suyo aparte, porque es un archivo que además se puede
  // reenviar.
  //
  // Metadatos únicamente: la fecha usada y los tamaños de los TRES bloques.
  // NUNCA una fila.
  await audit({
    userId: actorId,
    action: "electoral_roll_generated",
    // Sin `entity`: no es un asiento sobre una fila (mismo criterio que
    // `padron_export` y `manual_collection_sheet`).
    detail: {
      at: at.toISOString().slice(0, 10),
      enabled: roll.enabled.length,
      toPurge: roll.toPurge.length,
      purgeFees: roll.purgeFees,
      withoutSeniority: roll.withoutSeniority.length,
    },
    ip: (await headers()).get("x-real-ip") ?? "unknown",
  });

  return { roll, valued: feeValue !== null, generatedAt: new Date() };
}
```

(La función `Count` del archivo viejo desaparece: la reemplaza `StatCard`.)

- [ ] **Step 4: Verde**

Run: `npx vitest run tests/padron-electoral-screen.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/padron-electoral/page.tsx tests/padron-electoral-screen.test.ts
git commit -m "feat(electoral): redesign the roll screen with generator card and equation strip"
```

---

### Task 7: Verificación de cierre

**Files:** ninguno nuevo (solo verificación; arreglos si algo falla).

- [ ] **Step 1: Suite entera y tipos**

Run: `npx vitest run && npx tsc --noEmit`
Expected: TODO en verde. Un test rojo fuera de los archivos del plan = investigar antes de tocar (puede ser un consumidor de `withoutSeniority` no previsto).

- [ ] **Step 2: Verificar que la plata no se tocó**

Run: `git diff main --stat -- src/lib/treasury src/lib/mp src/app/api/webhooks 2>$null` (PowerShell) o `git diff main --stat -- src/lib/treasury src/lib/mp` (bash)
Expected: **salida vacía**. Si aparece un archivo, el plan se violó: revisar y revertir ese cambio.

- [ ] **Step 3: Verificación visual en el navegador**

Levantar el dev server (preview tools / launch.json, nunca Bash) y en `/admin/padron-electoral`:
1. Desktop: Card generadora, tira de la cuenta con los signos, tres bloques en Cards, flag al final. Sacar screenshot.
2. `resize_window` preset mobile: las stat cards apilan, las filas son tarjetas. Screenshot.
3. Vista previa de impresión (o `javascript_tool` con `window.matchMedia('print')` no alcanza: usar el diálogo de impresión del navegador manualmente o confiar en los tests de clases `print:*`): confirmar que la hoja imprime tabla plana con cabecera de tres conteos.
4. Descargar el Excel con una fecha válida y abrirlo: tres hojas, encabezados en negrita, fechas como fecha, monto como moneda.
5. Dark mode (`resize_window` colorScheme dark): tokens correctos, nada ilegible.

- [ ] **Step 4: Cierre**

Si todo pasó, dejar la branch lista y reportar al operador con el resumen de commits (`git log --oneline main..`). El merge a `main` y el push los decide Mariano (el push siempre lo corre él).

---

## Self-review del plan (hecha al escribirlo)

- **Cobertura de la spec:** §3.1→Task 2 · §3.2/3.3→Task 1 · §3.4→Task 4 · §3.5→Task 3 · §4→Task 4 · §5.1-5.3→Task 6 · §5.4/5.6→Task 5 · §5.5→Task 6 · §6→Task 1 · §7→Tasks 1-6 · §8→Task 7.
- **Sin placeholders:** cada step con código lleva el código completo; las rutas son exactas.
- **Consistencia de tipos:** `mustPurgeToVote(category, arrears)` y `enabledFrom(joinedAt)` se usan con esas firmas en Tasks 3, 5; `electoralWorkbookSpec(roll, valued)` idem en Task 4; `withoutSeniority: ElectoralRow[]` en Tasks 3-6.
