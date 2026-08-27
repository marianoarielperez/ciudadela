# Paso "Tu DNI" en ASOCIATE — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar al wizard público ASOCIATE un paso 1 nuevo ("Tu DNI") que chequea la elegibilidad por DNI ANTES de que el vecino cargue ningún dato, con nombre enmascarado y veredictos por pantalla, renumerando el wizard de 5 a 6 pasos sin tocar el circuito de pagos.

**Architecture:** El motor es el existente `checkEligibility` (no se modifica); se extrae la carga de sus insumos a `loadEligibilityInputs` compartida por los DOS call-sites (chequeo temprano + envío del paso de datos), y una función pura nueva `dniCheckVerdict` traduce el resultado a códigos de pantalla con `maskedName` (la misma función de REEMPADRONATE, extraída a un módulo neutral). La action nueva `checkDniAction` calca el orden de guardas de `lookupAction` de REEMPADRONATE con limitador propio (5/15 min), sin auditoría y sin revalidación.

**Tech Stack:** Next.js 16 App Router (server actions, `"use client"`), TypeScript, Prisma/MariaDB (solo lecturas nuevas — CERO migraciones), Cloudflare Turnstile, vitest (entorno node, sin jsdom).

**Spec:** `docs/superpowers/specs/2026-08-27-asociate-paso-dni-design.md` (leerla antes de arrancar).

## Global Constraints

- **UI en es-AR con voseo**; código, nombres y commits en inglés. Los textos user-facing de este plan están escritos LITERALMENTE — copiarlos tal cual.
- **PROHIBIDO tocar**: `src/lib/mp/*`, `src/lib/treasury/*`, `src/lib/applications/eligibility.ts`, `startPaymentAction` / `uploadDocumentAction` / `submitNoDebitAction` / `applicationStatusAction`, el bloque `replaceState` de `asociate-wizard.tsx` (líneas del token de retome). El criterio de cierre incluye `git diff --stat` limpio de esas rutas.
- **Ninguna action del wizard llama `revalidatePath`/`revalidateTag`** (invariante documentada en `asociate-wizard.tsx:259-270`; romperla remonta el wizard en medio de un pago).
- **`checkEligibility` no se modifica**: el paso 1 es un segundo consumidor. `createApplicationAction` mantiene comportamiento observable idéntico (`tests/create-application-action.test.ts` pasa **sin tocar una aserción**).
- **`tests/reregistration-rules.test.ts` pasa sin tocarse** (la extracción de `maskedName` usa re-export).
- Componentes públicos: usar `Field`, `Input` + `CONTROL_HEIGHT`, `NavButtons`, `FormMessage`, `TurnstileWidget`, `LINK_TARGET` de los módulos existentes. **No definir constantes nuevas de alto/foco/link. Sin `dark:` en pantallas públicas. Sin colores crudos de Tailwind** (tokens `--primary`/`--success`/`--warning`).
- `NavButtons`: `submit` XOR `onNext`, NUNCA `type="submit"` + `onClick` (unión discriminada de `wizard-ui.tsx:83-102`; el bug se tragaba 11 de 12 envíos).
- `useActionState` no se limpia: usar el patrón `dismissed` por identidad (como `asociate-wizard.tsx:158-159`), jamás un `useEffect` que resetee banderas.
- Commits frecuentes, mensajes en inglés, terminados en `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Comandos: `npm test` (suite entera), `npm test -- tests/<archivo>` (uno solo), `npm run lint`, `npx tsc --noEmit`.

---

### Task 1: Extraer `maskedName` a un módulo neutral

`maskedName` vive en `src/lib/reregistration/rules.ts:217-227` y el paso 1 de ASOCIATE la necesita. Se muda a `src/lib/members/masked-name.ts` y `rules.ts` la re-exporta: ni un call-site ni un test de re-empadronamiento se toca.

**Files:**
- Create: `src/lib/members/masked-name.ts`
- Modify: `src/lib/reregistration/rules.ts` (borrar la función, importar + re-exportar)
- Test: `tests/reregistration-rules.test.ts` (NO se modifica — es la verificación)

**Interfaces:**
- Produces: `maskedName(fullName: string): string` importable desde `@/lib/members/masked-name` (y, como siempre, desde `@/lib/reregistration/rules`).

- [ ] **Step 1: Crear `src/lib/members/masked-name.ts`**

Mover la función VERBATIM con su doc comment completo (el de `rules.ts:194-216`). Contenido del archivo nuevo:

```ts
/** "Castillo Nestor" (formato del padrón: Apellido Nombre) → "N***** C."
 *
 *  Para qué: que quien tipeó un DNI confirme que es él, SIN que el sistema le
 *  revele el nombre completo de un tercero. Alcanza con que el propio socio se
 *  reconozca; a un desconocido el resultado no le dice quién es.
 *
 *  REGLA FIJADA (y fijada también en el test, que es donde se lee la tabla de
 *  casos): la PRIMERA palabra es el apellido y viaja sólo como inicial + punto;
 *  todas las demás son nombres, y cada uno conserva su inicial y enmascara el
 *  resto con un asterisco por letra. Un nombre de una sola palabra da "C." solo.
 *
 *  Por qué "primera palabra = apellido" y no una heurística de apellido
 *  compuesto: el padrón viene en formato "Apellido Nombre" y no marca dónde
 *  termina el apellido. "Perez Gomez Maria Ana" es indistinguible de un
 *  apellido compuesto con dos nombres o de un apellido simple con tres
 *  nombres, y adivinar mal cambia el cartel que ve el vecino. La regla
 *  mecánica siempre da lo mismo para el mismo dato, que es lo que se necesita
 *  para confirmar.
 *
 *  Los acentos y la ñ cuentan como UNA letra: el padrón los tiene (hay un socio
 *  "Coñuecar") y a veces llegan en forma descompuesta (la ñ como "n" + tilde
 *  combinante), que contada cruda mostraría un asterisco de más. Por eso se
 *  normaliza a NFC y se recorre por code points.
 *
 *  Nació en el paso 1 de REEMPADRONATE (M6) y desde el paso "Tu DNI" de
 *  ASOCIATE la comparten los dos wizards: por eso vive acá y no en
 *  `reregistration/rules.ts`, que la re-exporta para sus call-sites. */
export function maskedName(fullName: string): string {
  const words = fullName.normalize("NFC").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";

  // `split(/\s+/)` + `filter(Boolean)` garantiza que ninguna palabra esté vacía,
  // así que el primer code point siempre existe.
  const initial = (word: string) => [...word][0].toLocaleUpperCase("es-AR");
  const surname = `${initial(words[0])}.`;
  const given = words.slice(1).map((word) => initial(word) + "*".repeat([...word].length - 1));
  return given.length === 0 ? surname : `${given.join(" ")} ${surname}`;
}
```

- [ ] **Step 2: Reemplazar la función en `src/lib/reregistration/rules.ts`**

Borrar el bloque completo de la función y su doc comment (líneas 194-227, desde `/** "Castillo Nestor"` hasta la llave de cierre de `maskedName`). En su lugar, dejar:

```ts
// `maskedName` nació acá (paso 1 del wizard) y se mudó a un módulo neutral
// cuando el paso "Tu DNI" de ASOCIATE empezó a compartirla. Se re-exporta para
// que los call-sites y los tests de re-empadronamiento no tengan que saberlo.
export { maskedName } from "@/lib/members/masked-name";
```

Ojo: `rules.ts` usa `maskedName` internamente (en `lookupVerdict`, línea ~183). Un `export { x } from "…"` NO crea un binding local, así que además hay que importarla arriba del archivo, junto a los demás imports:

```ts
import { maskedName } from "@/lib/members/masked-name";
```

y entonces el re-export puede ser simplemente `export { maskedName };` (sin `from`). Usar esta segunda forma: un solo import, un solo símbolo.

- [ ] **Step 3: Verificar que los tests de re-empadronamiento pasan SIN tocarse**

Run: `npm test -- tests/reregistration-rules.test.ts tests/reempadronate-lookup.test.ts`
Expected: PASS (los dos archivos, cero modificaciones en ellos).

- [ ] **Step 4: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add src/lib/members/masked-name.ts src/lib/reregistration/rules.ts
git commit -m "refactor: extract maskedName to a neutral shared module"
```

---

### Task 2: `loadEligibilityInputs` — la carga compartida de insumos

Extraer la consulta que hoy vive inline en `createApplicationAction` (`src/app/(public)/asociate/actions.ts:261-277`) a una función compartida. La regla del proyecto: la lección de `coverageFloor` — el paso 1 y el envío del paso de datos consultan EXACTAMENTE lo mismo porque es la misma función, no una copia.

**Files:**
- Create: `src/lib/applications/eligibility-inputs.ts`
- Modify: `src/app/(public)/asociate/actions.ts:259-278` (usar la función) + import
- Test: `tests/create-application-action.test.ts` (NO se modifica — es la verificación)

**Interfaces:**
- Consumes: `applicationService.findLiveByDni` / `lastRejectionAt` (firmas en `src/lib/applications/service.ts:83-99`).
- Produces:
  ```ts
  loadEligibilityInputs(db, applications, dni): Promise<EligibilityInputs>
  type EligibilityInputs = {
    member: EligibilityMember | null;   // incluye fullName y pendingFees
    liveApplication: { id: number } | null;
    lastRejectionAt: Date | null;
  };
  ```
  `EligibilityInputs` es asignable al input de `checkEligibility` (el `fullName` extra no molesta) y es el input de `dniCheckVerdict` (Task 3).

- [ ] **Step 1: Crear `src/lib/applications/eligibility-inputs.ts`**

```ts
// La carga de insumos del chequeo de elegibilidad por DNI. Es UNA función para
// los DOS call-sites —el chequeo temprano del paso "Tu DNI" y la guarda del
// envío de "Tus datos"— por la misma razón que `coverageFloor` es una sola:
// con una copia por camino, alcanza con que alguien toque una para que el
// paso 1 y el envío diverjan en silencio.
//
// El cliente de Prisma y el servicio se INYECTAN (patrón de `query.ts` y
// `summary.ts`): `@/lib/prisma` tira al evaluarse si falta DATABASE_URL, y un
// test que importe este módulo se caería sin .env.
import type { MemberStatus, PrismaClient, WithdrawalReason } from "@/generated/prisma/client";

type Db = Pick<PrismaClient, "member">;

type ApplicationLookups = {
  findLiveByDni(dni: string): Promise<{ id: number; email: string } | null>;
  lastRejectionAt(dni: string): Promise<Date | null>;
};

export type EligibilityMember = {
  id: number;
  /** Para el nombre enmascarado del paso 1; `checkEligibility` lo ignora. */
  fullName: string;
  status: MemberStatus;
  withdrawalReason: WithdrawalReason | null;
  reentryBlocked: boolean;
  rejectedUntil: Date | null;
  /** Cuotas pendientes en la cuenta corriente (M4). */
  pendingFees: number;
};

export type EligibilityInputs = {
  member: EligibilityMember | null;
  liveApplication: { id: number } | null;
  lastRejectionAt: Date | null;
};

export async function loadEligibilityInputs(
  db: Db,
  applications: ApplicationLookups,
  dni: string,
): Promise<EligibilityInputs> {
  const [memberRow, liveApplication, lastRejectionAt] = await Promise.all([
    db.member.findUnique({
      where: { dni },
      select: {
        id: true, fullName: true, status: true, withdrawalReason: true,
        reentryBlocked: true, rejectedUntil: true,
        // La deuda que bloquea es la VIVA de la cuenta corriente (M4), no el
        // flag `debtAtWithdrawal` que quedó congelado en la baja: el que saldó
        // en la sede tiene que poder reingresar sin que nadie le toque la ficha.
        _count: { select: { fees: { where: { status: "pending" } } } },
      },
    }),
    applications.findLiveByDni(dni),
    applications.lastRejectionAt(dni),
  ]);
  return {
    member: memberRow ? { ...memberRow, pendingFees: memberRow._count.fees } : null,
    liveApplication,
    lastRejectionAt,
  };
}
```

- [ ] **Step 2: Usar la función en `createApplicationAction`**

En `src/app/(public)/asociate/actions.ts`, agregar el import (en el bloque de imports de `@/lib/applications/*`):

```ts
import { loadEligibilityInputs } from "@/lib/applications/eligibility-inputs";
```

y reemplazar el bloque de las líneas 259-278 (desde el comentario `// Elegibilidad por DNI (spec §4)` hasta la línea `const eligibility = checkEligibility({ member, liveApplication, lastRejectionAt, now });` inclusive) por:

```ts
  // Elegibilidad por DNI (spec §4): corre DESPUÉS de Turnstile + rate limit,
  // que son lo único que impide usar este formulario para barrer el padrón.
  // Los insumos salen de `loadEligibilityInputs`, la MISMA carga que usa el
  // chequeo temprano del paso "Tu DNI": los dos puntos de verdad no pueden
  // divergir en qué miran.
  const now = new Date();
  const inputs = await loadEligibilityInputs(prisma, applicationService, data.dni);
  const eligibility = checkEligibility({ ...inputs, now });
```

Nada más cambia en la action: el `if (!eligibility.ok)` siguiente y todo el resto quedan intactos. (El `now` se sigue usando más abajo en `acceptedTermsAt: now` — verificar que quedó declarado.)

- [ ] **Step 3: Verificar que los 34 casos existentes pasan SIN tocar una aserción**

Run: `npm test -- tests/create-application-action.test.ts`
Expected: PASS, archivo de test sin modificaciones. Si algo falla, el refactor cambió comportamiento: arreglar el refactor, no el test.

- [ ] **Step 4: Suite completa + tipos**

Run: `npm test` y `npx tsc --noEmit`
Expected: todo verde.

- [ ] **Step 5: Commit**

```bash
git add src/lib/applications/eligibility-inputs.ts "src/app/(public)/asociate/actions.ts"
git commit -m "refactor: share the eligibility-inputs load ahead of the DNI gate"
```

---

### Task 3: `dniCheckVerdict` — la función pura del veredicto (TDD)

**Files:**
- Create: `src/lib/applications/dni-check.ts`
- Test: `tests/application-dni-check.test.ts` (nuevo)

**Interfaces:**
- Consumes: `checkEligibility` (`@/lib/applications/eligibility`), `maskedName` (`@/lib/members/masked-name`), `EligibilityInputs` (Task 2).
- Produces:
  ```ts
  dniCheckVerdict(input: EligibilityInputs & { now: Date }): DniCheckVerdict
  type DniCheckVerdict =
    | { ok: true }
    | { ok: false; code: "already_member" | "in_progress" | "visit_office"; maskedName: string | null }
    | { ok: false; code: "debt"; maskedName: string; pendingCount: number }
    | { ok: false; code: "rejected_wait"; maskedName: string | null; retryAt: Date };
  ```

- [ ] **Step 1: Escribir el test que falla — `tests/application-dni-check.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { dniCheckVerdict } from "@/lib/applications/dni-check";
import { maskedName } from "@/lib/members/masked-name";

// La tabla del veredicto del paso "Tu DNI". La PRECEDENCIA no se re-testea acá
// entera —la dicta `checkEligibility` y la fija tests/application-eligibility.
// test.ts—; lo que este archivo fija es la capa de PRIVACIDAD del paso 1:
//   1. el reingreso habilitado es INDISTINGUIBLE del DNI desconocido;
//   2. el nombre sólo viaja enmascarado, nunca completo;
//   3. `in_progress` no lleva nombre (habla de la solicitud, no de la ficha);
//   4. `ok` no lleva memberId ni ningún otro campo.
const NOW = new Date("2026-08-27T15:00:00Z");

function member(over: Partial<{
  status: "active" | "suspended" | "withdrawn";
  withdrawalReason: string | null;
  reentryBlocked: boolean;
  rejectedUntil: Date | null;
  pendingFees: number;
}> = {}) {
  return {
    id: 42,
    fullName: "Castillo Nestor",
    status: over.status ?? ("withdrawn" as const),
    withdrawalReason: over.withdrawalReason === undefined ? ("resignation" as const) : over.withdrawalReason,
    reentryBlocked: over.reentryBlocked ?? false,
    rejectedUntil: over.rejectedUntil ?? null,
    pendingFees: over.pendingFees ?? 0,
  } as Parameters<typeof dniCheckVerdict>[0]["member"];
}

const base = { member: null, liveApplication: null, lastRejectionAt: null, now: NOW };

describe("dniCheckVerdict — el ok indistinguible", () => {
  it("un DNI desconocido continúa", () => {
    expect(dniCheckVerdict(base)).toStrictEqual({ ok: true });
  });

  it("un ex-socio habilitado (renuncia, sin deuda) contesta EXACTAMENTE lo mismo", () => {
    // Igualdad estructural estricta contra el MISMO literal del caso anterior:
    // ningún campo extra —memberId, bandera, nombre— puede separar los dos
    // casos leyendo la respuesta (decisión del operador #10).
    expect(dniCheckVerdict({ ...base, member: member() })).toStrictEqual({ ok: true });
  });

  it("el cesante por mora que saldó también continúa, indistinguible", () => {
    expect(
      dniCheckVerdict({ ...base, member: member({ withdrawalReason: "arrears" }) }),
    ).toStrictEqual({ ok: true });
  });
});

describe("dniCheckVerdict — bloqueos", () => {
  it("socio vigente: already_member con el nombre ENMASCARADO", () => {
    const res = dniCheckVerdict({ ...base, member: member({ status: "active", withdrawalReason: null }) });

    expect(res).toStrictEqual({
      ok: false,
      code: "already_member",
      maskedName: maskedName("Castillo Nestor"),
    });
    // La garantía que importa: el nombre completo no sale, ni adentro de otro campo.
    expect(JSON.stringify(res)).not.toContain("Castillo");
    expect(JSON.stringify(res)).not.toContain("Nestor");
  });

  it("suspendido: el mismo already_member (no se revela la suspensión)", () => {
    expect(
      dniCheckVerdict({ ...base, member: member({ status: "suspended", withdrawalReason: null }) }),
    ).toStrictEqual({
      ok: false,
      code: "already_member",
      maskedName: maskedName("Castillo Nestor"),
    });
  });

  it("solicitud viva: in_progress SIN nombre y SIN applicationId", () => {
    const res = dniCheckVerdict({
      ...base,
      member: member({ status: "active", withdrawalReason: null }),
      liveApplication: { id: 99 },
    });

    // Sin nombre a propósito: el veredicto habla de la solicitud, no de la
    // ficha, y sumarle el nombre sería puro oráculo. Y el id jamás sale.
    expect(res).toStrictEqual({ ok: false, code: "in_progress", maskedName: null });
    expect(JSON.stringify(res)).not.toContain("99");
  });

  it("deuda viva: debt con la CANTIDAD de cuotas (decisión del operador #7)", () => {
    expect(
      dniCheckVerdict({ ...base, member: member({ pendingFees: 7 }) }),
    ).toStrictEqual({
      ok: false,
      code: "debt",
      maskedName: maskedName("Castillo Nestor"),
      pendingCount: 7,
    });
  });

  it.each([
    ["expulsión", member({ withdrawalReason: "expulsion" })],
    ["reentryBlocked sin motivo", member({ withdrawalReason: null, reentryBlocked: true })],
    ["fallecimiento", member({ withdrawalReason: "death" })],
    ["anulación por duplicado", member({ withdrawalReason: "duplicate_annulment" })],
  ])("%s: visit_office, indistinguibles entre sí", (_label, m) => {
    expect(dniCheckVerdict({ ...base, member: m })).toStrictEqual({
      ok: false,
      code: "visit_office",
      maskedName: maskedName("Castillo Nestor"),
    });
  });

  it("la expulsión gana a la deuda (precedencia heredada de checkEligibility)", () => {
    expect(
      dniCheckVerdict({ ...base, member: member({ withdrawalReason: "expulsion", pendingFees: 5 }) }),
    ).toMatchObject({ code: "visit_office" });
  });

  it("rechazo reciente sobre la ficha: rejected_wait con la fecha y el nombre", () => {
    const until = new Date("2026-11-01T12:00:00Z");
    expect(
      dniCheckVerdict({ ...base, member: member({ rejectedUntil: until }) }),
    ).toStrictEqual({
      ok: false,
      code: "rejected_wait",
      maskedName: maskedName("Castillo Nestor"),
      retryAt: until,
    });
  });

  it("rechazo reciente SIN ficha: rejected_wait sin nombre", () => {
    const res = dniCheckVerdict({
      ...base,
      lastRejectionAt: new Date("2026-06-27T12:00:00Z"), // + 6 meses > NOW
    });
    expect(res).toMatchObject({ ok: false, code: "rejected_wait", maskedName: null });
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -- tests/application-dni-check.test.ts`
Expected: FAIL — `Cannot find module '@/lib/applications/dni-check'` (o equivalente).

- [ ] **Step 3: Implementar `src/lib/applications/dni-check.ts`**

```ts
// El veredicto del paso "Tu DNI" del wizard ASOCIATE. Regla PURA: la action
// junta los insumos con `loadEligibilityInputs` y esta función decide qué
// pantalla ve el vecino ANTES de haber cargado ningún dato.
//
// No reimplementa ninguna regla: llama a `checkEligibility` —el único juez de
// elegibilidad— y traduce su resultado a códigos de pantalla. Lo que agrega es
// la capa de privacidad del paso 1:
//   - el nombre viaja ENMASCARADO (`maskedName`, la misma función que el
//     paso 1 de REEMPADRONATE);
//   - el reingreso habilitado es INDISTINGUIBLE del DNI desconocido: que
//     exista una ficha no se le dice a un visitante anónimo, y el `memberId`
//     lo re-resuelve el server al crear la solicitud (decisión del operador);
//   - `in_progress` no lleva nombre: habla de la solicitud, no de la ficha.
import { maskedName } from "@/lib/members/masked-name";
import { checkEligibility } from "./eligibility";
import type { EligibilityInputs } from "./eligibility-inputs";

export type DniCheckVerdict =
  | { ok: true }
  | { ok: false; code: "already_member" | "in_progress" | "visit_office"; maskedName: string | null }
  | { ok: false; code: "debt"; maskedName: string; pendingCount: number }
  | { ok: false; code: "rejected_wait"; maskedName: string | null; retryAt: Date };

export function dniCheckVerdict(input: EligibilityInputs & { now: Date }): DniCheckVerdict {
  const eligibility = checkEligibility(input);
  if (eligibility.ok) return { ok: true };

  const masked = input.member ? maskedName(input.member.fullName) : null;
  switch (eligibility.code) {
    case "in_progress":
      return { ok: false, code: "in_progress", maskedName: null };
    case "debt":
      // `checkEligibility` sólo devuelve `debt` con ficha: sin ficha no hay
      // cuotas que deber. El fallback es para que el tipo cierre.
      return {
        ok: false,
        code: "debt",
        maskedName: masked ?? "",
        pendingCount: input.member?.pendingFees ?? 0,
      };
    case "rejected_wait":
      return { ok: false, code: "rejected_wait", maskedName: masked, retryAt: eligibility.retryAt };
    default:
      return { ok: false, code: eligibility.code, maskedName: masked };
  }
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test -- tests/application-dni-check.test.ts`
Expected: PASS (los ~12 casos).

- [ ] **Step 5: Commit**

```bash
git add src/lib/applications/dni-check.ts tests/application-dni-check.test.ts
git commit -m "feat: pure verdict for the ASOCIATE early DNI check"
```

---

### Task 4: `asociateDniCheckLimiter` + `checkDniAction` (TDD)

**Files:**
- Modify: `src/lib/auth/rate-limiter.ts` (limitador nuevo + corrección del comentario de `applicationCreateLimiter`)
- Modify: `src/app/(public)/asociate/actions.ts` (tipo `DniCheckState` + action nueva; imports)
- Test: `tests/asociate-dni-action.test.ts` (nuevo)

**Interfaces:**
- Consumes: `loadEligibilityInputs` (Task 2), `dniCheckVerdict` (Task 3), `verifyTurnstile`, `configReader`, `openWizardProcess`, `parseForm`, `dniSchema` (ya existe, `actions.ts:88`).
- Produces:
  ```ts
  checkDniAction(_prev: DniCheckState, formData: FormData): Promise<DniCheckState>
  // DniCheckState (server, NO exportable de un módulo "use server"):
  type DniCheckState =
    | { kind: "idle" }
    | { kind: "ok" }
    | { kind: "blocked"; code: "already_member" | "in_progress" | "visit_office" | "debt" | "rejected_wait";
        maskedName: string | null; pendingCount?: number; retryAtIso?: string }
    | { kind: "error"; error: string };
  ```
  El espejo cliente se declara en Task 5. `asociateDniCheckLimiter` (5 / 15 min por IP) exportado de `@/lib/auth/rate-limiter`.

- [ ] **Step 1: Escribir el test que falla — `tests/asociate-dni-action.test.ts`**

Molde: `tests/reempadronate-lookup.test.ts` (guardas) + `tests/create-application-action.test.ts` (arnés de config/proceso). Contenido completo:

```ts
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// `checkDniAction` es un endpoint público y ANÓNIMO: lo único que lo protege es
// el orden interruptor → proceso → `allows` (sin gastar) → Turnstile → zod →
// `record` → padrón, calcado de `createApplicationAction` y del lookup de
// REEMPADRONATE. Este archivo fija ese orden y las garantías de privacidad:
//
//   1. el `fullName` del padrón NUNCA sale en la respuesta, sólo el enmascarado;
//   2. el reingreso habilitado contesta EXACTAMENTE lo mismo que el DNI
//      desconocido (`{ kind: "ok" }` pelado, sin memberId);
//   3. ninguna búsqueda audita (dejaría registrado qué DNI consultó cada IP);
//   4. el cupo es PROPIO: no toca el de creación.
const mocks = vi.hoisted(() => ({
  prisma: {
    member: { findUnique: vi.fn() },
    configuration: { findUnique: vi.fn() },
    reregistrationProcess: { findUnique: vi.fn() },
  },
  service: {
    findLiveByDni: vi.fn(),
    lastRejectionAt: vi.fn(),
  },
  verifyTurnstile: vi.fn(),
  audit: vi.fn(),
  dniCheckLimiter: { allows: vi.fn(), record: vi.fn(), refund: vi.fn() },
  // Los demás limitadores que importa `actions.ts`; acá nadie los llama.
  otherLimiter: { allows: vi.fn(), record: vi.fn(), refund: vi.fn(), check: vi.fn() },
  configRows: {} as Record<string, unknown>,
}));

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/applications/service", () => ({
  applicationService: mocks.service,
  DuplicateLiveApplicationError: class DuplicateLiveApplicationError extends Error {},
}));
vi.mock("@/lib/turnstile", () => ({ verifyTurnstile: mocks.verifyTurnstile }));
// `audit` se mockea para poder AFIRMAR que no se llama (doctrina del lookup de
// REEMPADRONATE): si alguien le agrega el asiento, este archivo se pone rojo.
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/email", () => ({ mailer: { sendToApplication: vi.fn() } }));
vi.mock("@/lib/tokens", () => ({ tokens: { issue: vi.fn() } }));
vi.mock("@/lib/auth/rate-limiter", () => ({
  asociateDniCheckLimiter: mocks.dniCheckLimiter,
  applicationCreateLimiter: mocks.otherLimiter,
  applicationStatusLimiter: mocks.otherLimiter,
  publicTokenLimiter: mocks.otherLimiter,
  resumeResendLimiter: mocks.otherLimiter,
  resumeResendTargetLimiter: mocks.otherLimiter,
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-real-ip": "1.2.3.4", "user-agent": "vitest" }),
}));
vi.mock("next/server", () => ({ after: (_fn: () => unknown) => {} }));

import { checkDniAction } from "@/app/(public)/asociate/actions";
import { maskedName } from "@/lib/members/masked-name";

const IDLE = { kind: "idle" } as const;
const DNI = "28456757";

// El reloj se congela como en tests/create-application-action.test.ts: la
// guarda del re-empadronamiento cita el plazo y `currentDeadline` calla los
// vencidos, así que sin fijar "hoy" el caso pasaría o fallaría según el día.
vi.useFakeTimers({ toFake: ["Date"] });
vi.setSystemTime(new Date("2026-09-01T15:00:00Z")); // 12:00 en Argentina
afterAll(() => { vi.useRealTimers(); });

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.append(k, v);
  return fd;
}

const VALID = { "cf-turnstile-response": "captcha-ok", dni: DNI };

/** Una ficha del padrón tal como la devuelve `loadEligibilityInputs`. */
function memberRow(over: Partial<{
  status: string;
  withdrawalReason: string | null;
  reentryBlocked: boolean;
  rejectedUntil: Date | null;
  pending: number;
}> = {}) {
  return {
    id: 42,
    fullName: "Castillo Nestor",
    status: over.status ?? "withdrawn",
    withdrawalReason: over.withdrawalReason === undefined ? "resignation" : over.withdrawalReason,
    reentryBlocked: over.reentryBlocked ?? false,
    rejectedUntil: over.rejectedUntil ?? null,
    _count: { fees: over.pending ?? 0 },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.dniCheckLimiter.allows.mockReturnValue(true);
  mocks.verifyTurnstile.mockResolvedValue(true);
  mocks.configRows = { asociate_activo: true };
  mocks.prisma.configuration.findUnique.mockImplementation(
    async ({ where: { key } }: { where: { key: string } }) =>
      key in mocks.configRows ? { key, value: mocks.configRows[key] } : null,
  );
  mocks.prisma.reregistrationProcess.findUnique.mockResolvedValue(null);
  mocks.prisma.member.findUnique.mockResolvedValue(null);
  mocks.service.findLiveByDni.mockResolvedValue(null);
  mocks.service.lastRejectionAt.mockResolvedValue(null);
});

describe("checkDniAction — guardas", () => {
  it("interruptor de ASOCIATE apagado: no consulta nada ni gasta cupo", async () => {
    mocks.configRows.asociate_activo = false;

    const res = await checkDniAction(IDLE, form(VALID));

    expect(res).toEqual({ kind: "error", error: expect.stringMatching(/asociaciones en línea están cerradas/i) });
    expect(mocks.dniCheckLimiter.allows).not.toHaveBeenCalled();
    expect(mocks.verifyTurnstile).not.toHaveBeenCalled();
    expect(mocks.prisma.member.findUnique).not.toHaveBeenCalled();
  });

  it("re-empadronamiento en curso: suspendido aunque el interruptor esté prendido", async () => {
    mocks.configRows.reempadronamiento_proceso_id = "7";
    mocks.prisma.reregistrationProcess.findUnique.mockResolvedValue({
      id: 7,
      status: "first_instance",
      firstEndsAt: new Date("2026-09-25T12:00:00.000Z"),
      secondEndsAt: null,
    });

    const res = await checkDniAction(IDLE, form(VALID));

    expect(res).toEqual({
      kind: "error",
      error: expect.stringMatching(/suspendidas temporalmente durante el proceso de re-empadronamiento/i),
    });
    expect(mocks.dniCheckLimiter.record).not.toHaveBeenCalled();
    expect(mocks.prisma.member.findUnique).not.toHaveBeenCalled();
  });

  it("con el cupo agotado corta ANTES de Turnstile y sin tocar el padrón", async () => {
    mocks.dniCheckLimiter.allows.mockReturnValue(false);

    const res = await checkDniAction(IDLE, form(VALID));

    expect(res).toEqual({ kind: "error", error: expect.stringContaining("Demasiados intentos") });
    expect(mocks.verifyTurnstile).not.toHaveBeenCalled();
    expect(mocks.dniCheckLimiter.record).not.toHaveBeenCalled();
    expect(mocks.prisma.member.findUnique).not.toHaveBeenCalled();
  });

  it("el captcha se verifica antes del formato, y un captcha malo NO cobra el intento", async () => {
    mocks.verifyTurnstile.mockResolvedValue(false);

    // DNI inválido a propósito: si el orden fuera zod → Turnstile, el error
    // sería el del formato y esta aserción fallaría.
    const res = await checkDniAction(IDLE, form({ "cf-turnstile-response": "x", dni: "abc" }));

    expect(res).toEqual({ kind: "error", error: expect.stringContaining("sos una persona") });
    expect(mocks.dniCheckLimiter.record).not.toHaveBeenCalled();
  });

  it("un DNI mal tipeado tampoco cobra el intento", async () => {
    const res = await checkDniAction(IDLE, form({ "cf-turnstile-response": "ok", dni: "123" }));

    expect(res.kind).toBe("error");
    expect(mocks.dniCheckLimiter.record).not.toHaveBeenCalled();
    expect(mocks.prisma.member.findUnique).not.toHaveBeenCalled();
  });

  it("el intento se cobra recién cuando se va a tocar el padrón, en el cupo PROPIO", async () => {
    await checkDniAction(IDLE, form(VALID));

    expect(mocks.dniCheckLimiter.record).toHaveBeenCalledWith("1.2.3.4");
    expect(mocks.prisma.member.findUnique).toHaveBeenCalledTimes(1);
    // El cupo de creación no se toca: son presupuestos separados.
    expect(mocks.otherLimiter.allows).not.toHaveBeenCalled();
    expect(mocks.otherLimiter.record).not.toHaveBeenCalled();
  });
});

describe("checkDniAction — veredictos", () => {
  it("un DNI desconocido continúa: { kind: 'ok' } pelado", async () => {
    expect(await checkDniAction(IDLE, form(VALID))).toStrictEqual({ kind: "ok" });
  });

  it("un ex-socio habilitado contesta EXACTAMENTE lo mismo que el desconocido", async () => {
    mocks.prisma.member.findUnique.mockResolvedValue(memberRow());

    const res = await checkDniAction(IDLE, form(VALID));

    // Igualdad estructural estricta: ni memberId, ni bandera, ni nombre. Que
    // exista una ficha no se le dice a un visitante anónimo (decisión #10).
    expect(res).toStrictEqual({ kind: "ok" });
    expect(JSON.stringify(res)).not.toContain("42");
  });

  it("socio vigente: already_member con el nombre ENMASCARADO, nunca el completo", async () => {
    mocks.prisma.member.findUnique.mockResolvedValue(memberRow({ status: "active", withdrawalReason: null }));

    const res = await checkDniAction(IDLE, form(VALID));

    expect(res).toStrictEqual({
      kind: "blocked",
      code: "already_member",
      maskedName: maskedName("Castillo Nestor"),
    });
    expect(JSON.stringify(res)).not.toContain("Castillo");
    expect(JSON.stringify(res)).not.toContain("Nestor");
  });

  it("solicitud viva: in_progress sin nombre y sin applicationId", async () => {
    mocks.service.findLiveByDni.mockResolvedValue({ id: 99, email: "x@y.com" });

    const res = await checkDniAction(IDLE, form(VALID));

    expect(res).toStrictEqual({ kind: "blocked", code: "in_progress", maskedName: null });
    expect(JSON.stringify(res)).not.toContain("99");
    expect(JSON.stringify(res)).not.toContain("x@y.com");
  });

  it("deuda viva: debt con la cantidad de cuotas", async () => {
    mocks.prisma.member.findUnique.mockResolvedValue(memberRow({ pending: 7 }));

    expect(await checkDniAction(IDLE, form(VALID))).toStrictEqual({
      kind: "blocked",
      code: "debt",
      maskedName: maskedName("Castillo Nestor"),
      pendingCount: 7,
    });
  });

  it("expulsado: visit_office, y la deuda no lo cambia (precedencia)", async () => {
    mocks.prisma.member.findUnique.mockResolvedValue(
      memberRow({ withdrawalReason: "expulsion", pending: 5 }),
    );

    expect(await checkDniAction(IDLE, form(VALID))).toStrictEqual({
      kind: "blocked",
      code: "visit_office",
      maskedName: maskedName("Castillo Nestor"),
    });
  });

  it("rechazo reciente: rejected_wait con la fecha en ISO", async () => {
    const until = new Date("2026-11-01T12:00:00Z");
    mocks.prisma.member.findUnique.mockResolvedValue(memberRow({ rejectedUntil: until }));

    expect(await checkDniAction(IDLE, form(VALID))).toStrictEqual({
      kind: "blocked",
      code: "rejected_wait",
      maskedName: maskedName("Castillo Nestor"),
      retryAtIso: until.toISOString(),
    });
  });

  it("ninguna búsqueda deja asiento de auditoría", async () => {
    mocks.prisma.member.findUnique.mockResolvedValue(memberRow({ status: "active" }));
    await checkDniAction(IDLE, form(VALID));
    mocks.prisma.member.findUnique.mockResolvedValue(null);
    await checkDniAction(IDLE, form({ ...VALID, dni: "11111111" }));

    expect(mocks.audit).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -- tests/asociate-dni-action.test.ts`
Expected: FAIL — `checkDniAction` no existe (error de import).

- [ ] **Step 3: Agregar el limitador en `src/lib/auth/rate-limiter.ts`**

El archivo NO usa punto y coma — respetar el estilo. Agregar después del bloque de `reregistrationResendLimiter` (al final del archivo):

```ts
export const ASOCIATE_DNI_CHECK_WINDOW_MS = 15 * 60_000
export const ASOCIATE_DNI_CHECK_LIMIT = 5

/** Chequeo temprano por DNI del paso 1 de ASOCIATE, por IP.
 *
 *  Mismo riesgo y mismo presupuesto que `reregistrationLookupLimiter`: un
 *  formulario que contesta contra el padrón con un DNI suelto, sin nada
 *  cargado. Detrás de Turnstile, pero el captcha encarece el intento
 *  automatizado y no raciona al humano persistente. Ventana de 15 minutos por
 *  el mismo motivo que allá: el vecino legítimo reintenta el mismo día (tipeo,
 *  captcha vencido) y detrás del CGNAT móvil puede haber varios a la vez.
 *
 *  Es un presupuesto SEPARADO de `applicationCreateLimiter`: gastar chequeos
 *  del paso 1 no puede dejar sin envío a quien ya llegó al paso de datos, ni
 *  al revés. */
export const asociateDniCheckLimiter = createRateLimiter({
  limit: ASOCIATE_DNI_CHECK_LIMIT,
  windowMs: ASOCIATE_DNI_CHECK_WINDOW_MS,
})
```

Y en el comentario de `applicationCreateLimiter` (líneas ~218-223), reemplazar la última oración:

```
 *  incluido) y frenan el llenado masivo del padrón de solicitudes. Es además
 *  la única puerta del chequeo de elegibilidad por DNI (anti-enumeración,
 *  spec M3 §4). */
```

por:

```
 *  incluido) y frenan el llenado masivo del padrón de solicitudes. Junto con
 *  `asociateDniCheckLimiter` (el cupo del chequeo temprano del paso 1) es una
 *  de las DOS puertas del chequeo de elegibilidad por DNI (anti-enumeración,
 *  spec M3 §4): ésta raciona el del envío del paso de datos. */
```

- [ ] **Step 4: Agregar tipo y action en `src/app/(public)/asociate/actions.ts`**

Imports — agregar `asociateDniCheckLimiter` a la lista que ya importa de `@/lib/auth/rate-limiter`, y sumar:

```ts
import { dniCheckVerdict } from "@/lib/applications/dni-check";
```

(`loadEligibilityInputs` ya quedó importado en Task 2.)

Tipo — junto a los otros tipos de estado (después de `type PayState`, línea ~58):

```ts
// El estado del chequeo temprano por DNI (paso 1, spec 2026-08-27). `blocked`
// lleva CÓDIGOS y el nombre enmascarado; la prosa la escribe la pantalla
// (`dni-result-panel.tsx`). El espejo cliente vive en `wizard-shared.ts`.
type DniCheckState =
  | { kind: "idle" }
  | { kind: "ok" }
  | {
      kind: "blocked";
      code: "already_member" | "in_progress" | "visit_office" | "debt" | "rejected_wait";
      maskedName: string | null;
      pendingCount?: number;
      retryAtIso?: string;
    }
  | { kind: "error"; error: string };
```

Action — insertarla DESPUÉS de `createApplicationAction` (antes del comentario del reenvío, línea ~344):

```ts
// El chequeo temprano por DNI del paso 1 "Tu DNI" (spec 2026-08-27). Es una
// CORTESÍA de UX, no una guarda: `createApplicationAction` sigue corriendo
// `checkEligibility` entero en el envío del paso de datos, pase lo que pase
// acá, sobre los MISMOS insumos (`loadEligibilityInputs`).
//
// NO SE AUDITA (misma doctrina que el lookup de REEMPADRONATE): un asiento por
// intento dejaría registrado qué DNI consultó cada IP — un dato personal que
// hoy no existe (docs/08, Ley 25.326).
//
// Y NO REVALIDA (`revalidatePath`/`revalidateTag`): es una action del wizard,
// y la invariante del `replaceState` del retome depende de que ninguna lo haga
// (ver el comentario largo de `asociate-wizard.tsx`).
export async function checkDniAction(_prev: DniCheckState, formData: FormData): Promise<DniCheckState> {
  const { ip } = await requestMeta();

  // Las mismas dos causales de la guarda 0 de la creación (documentadas arriba
  // en largo), con lectura DIRECTA porque son guardas de autorización. La de
  // los textos legales NO va acá: este paso no acepta nada, y esa guarda
  // protege el registro de la aceptación.
  if (!(await configReader.getBool(CONFIG_KEYS.asociateActivo))) {
    return { kind: "error", error: ASOCIATE_CLOSED };
  }
  const openProcess = await openWizardProcess(prisma);
  if (openProcess !== null) {
    return { kind: "error", error: reregistrationClosed(currentDeadline(openProcess)) };
  }

  // El orden es `allows` → captcha → formato → `record` → padrón, el de
  // siempre (createApplicationAction lo documenta en largo). El cupo es
  // PROPIO (`asociateDniCheckLimiter`, 5/15 min por IP): gastar chequeos no
  // puede dejar sin envío a quien ya llegó al paso de datos.
  if (!asociateDniCheckLimiter.allows(ip)) return { kind: "error", error: TOO_MANY };
  const captcha = await verifyTurnstile(String(formData.get("cf-turnstile-response") ?? ""), ip);
  if (!captcha) return { kind: "error", error: NO_CAPTCHA };

  const parsed = parseForm(z.object({ dni: dniSchema }), formData);
  if (!parsed.ok) return { kind: "error", error: parsed.error };
  const dni = parsed.data.dni; // ya normalizado: parseForm recorta y el regex deja sólo dígitos

  // Desde acá se toca el padrón, así que el intento se cobra.
  asociateDniCheckLimiter.record(ip);

  const inputs = await loadEligibilityInputs(prisma, applicationService, dni);
  const verdict = dniCheckVerdict({ ...inputs, now: new Date() });
  if (verdict.ok) return { kind: "ok" };
  return {
    kind: "blocked",
    code: verdict.code,
    maskedName: verdict.maskedName,
    ...(verdict.code === "debt" ? { pendingCount: verdict.pendingCount } : {}),
    ...(verdict.code === "rejected_wait" ? { retryAtIso: verdict.retryAt.toISOString() } : {}),
  };
}
```

- [ ] **Step 5: Correr el test nuevo y verificar que pasa**

Run: `npm test -- tests/asociate-dni-action.test.ts`
Expected: PASS (los ~14 casos).

- [ ] **Step 6: Verificar que el arnés viejo no se rompió**

Run: `npm test -- tests/create-application-action.test.ts tests/rate-limiter.test.ts`
Expected: PASS sin tocar esos archivos. (El mock de `@/lib/auth/rate-limiter` del test viejo no define `asociateDniCheckLimiter`; como `createApplicationAction` no lo llama, no molesta. Si vitest se quejara por el import, agregar `asociateDniCheckLimiter: mocks.createLimiter` a esa factory es adaptación de ARNÉS permitida — las aserciones no se tocan.)

- [ ] **Step 7: Commit**

```bash
git add src/lib/auth/rate-limiter.ts "src/app/(public)/asociate/actions.ts" tests/asociate-dni-action.test.ts
git commit -m "feat: early DNI check action with its own rate budget"
```

---

### Task 5: Tipos cliente + extraer `ResendResumeForm`

**Files:**
- Modify: `src/app/(public)/asociate/wizard-shared.ts` (tipo `DniCheckState`)
- Create: `src/app/(public)/asociate/resend-resume-form.tsx` (extraído de `blocked-panel.tsx:93-126`)
- Modify: `src/app/(public)/asociate/blocked-panel.tsx` (importar el form; borrar la copia local)

**Interfaces:**
- Produces: `DniCheckState` (espejo cliente del tipo del server, Task 4) exportado de `wizard-shared.ts`; `ResendResumeForm({ dni, siteKey })` exportado de `./resend-resume-form`.

- [ ] **Step 1: Agregar el tipo a `wizard-shared.ts`**

Después de `export type PayState` (línea ~56):

```ts
/** Espejo cliente del `DniCheckState` del server (paso 1 "Tu DNI"). La misma
 *  advertencia que `CreateState`: la equivalencia se sostiene a mano. */
export type DniCheckState =
  | { kind: "idle" }
  | { kind: "ok" }
  | {
      kind: "blocked";
      code: "already_member" | "in_progress" | "visit_office" | "debt" | "rejected_wait";
      maskedName: string | null;
      pendingCount?: number;
      retryAtIso?: string;
    }
  | { kind: "error"; error: string };
```

- [ ] **Step 2: Crear `src/app/(public)/asociate/resend-resume-form.tsx`**

Mover `ResendResumeForm` VERBATIM desde `blocked-panel.tsx:93-126`, ahora exportado y con sus imports propios:

```tsx
"use client";
// El formulario de reenvío del enlace de retome ("ya tenés una solicitud en
// trámite"). Vivía adentro de `blocked-panel.tsx` y se extrajo cuando el paso
// "Tu DNI" empezó a necesitarlo también: el veredicto `in_progress` del paso 1
// ofrece el mismo reenvío, y duplicar el form duplicaría sus garantías.
import { useActionState } from "react";
import { FormMessage } from "@/components/admin/form-message";
import { TurnstileWidget } from "@/components/public/turnstile-widget";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { resendResumeLinkAction } from "./actions";
import { CONTROL_HEIGHT, type ResendState } from "./wizard-shared";

export function ResendResumeForm({ dni, siteKey }: { dni: string; siteKey: string }) {
  const [state, action, pending] = useActionState<ResendState, FormData>(
    resendResumeLinkAction,
    {},
  );
  if (state.done) {
    // Respuesta única de la action: no confirma ni desmiente que ese DNI tenga
    // una solicitud en trámite. El texto tiene que decir lo mismo.
    return (
      <FormMessage kind="success" box className="mt-6">
        Si hay una solicitud en trámite con ese DNI, te enviamos el enlace para retomarla al email
        que dejaste. Revisá también la carpeta de correo no deseado.
      </FormMessage>
    );
  }

  return (
    <form action={action} className="mt-6 space-y-4 rounded-xl border border-border p-4">
      <p className="text-sm">
        Te reenviamos por email el enlace para retomar la solicitud que ya empezaste.
      </p>
      <input type="hidden" name="dni" value={dni} />
      <TurnstileWidget siteKey={siteKey} resetKey={state} />
      {state.error && <FormMessage kind="error">{state.error}</FormMessage>}
      <Button
        type="submit"
        disabled={pending}
        className={cn(CONTROL_HEIGHT, "w-full font-semibold sm:w-auto sm:px-6")}
      >
        {pending ? "Enviando…" : "Reenviarme el enlace"}
      </Button>
    </form>
  );
}
```

- [ ] **Step 3: Adaptar `blocked-panel.tsx`**

Borrar la función local `ResendResumeForm` (líneas 93-126) y ajustar imports: sacar `useActionState`, `TurnstileWidget`, `resendResumeLinkAction` y `ResendState` (quedan sin uso), y agregar:

```ts
import { ResendResumeForm } from "./resend-resume-form";
```

El resto del panel no cambia.

- [ ] **Step 4: Verificar**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: todo verde (ningún test conoce la ubicación del form).

- [ ] **Step 5: Commit**

```bash
git add "src/app/(public)/asociate/wizard-shared.ts" "src/app/(public)/asociate/resend-resume-form.tsx" "src/app/(public)/asociate/blocked-panel.tsx"
git commit -m "refactor: client DniCheckState type and shared resend form"
```

---

### Task 6: `StepDni` y `DniResultPanel` (componentes nuevos)

**Files:**
- Create: `src/app/(public)/asociate/step-dni.tsx`
- Create: `src/app/(public)/asociate/dni-result-panel.tsx`

**Interfaces:**
- Consumes: `Field`, `NavButtons` (`./wizard-ui`), `Input`, `FormMessage`, `TurnstileWidget`, `Button`, `formatDateAR` (`@/lib/format`), `ResendResumeForm` (Task 5), `CONTROL_HEIGHT`, `LINK_TARGET`, `DniCheckState`, `AsociateDraft` (`./wizard-shared`).
- Produces: `StepDni(props)` y `DniResultPanel({ blocked, dni, siteKey, onRetry })` — los consume Task 7. No renderizan stepper: `DniResultPanel` REEMPLAZA la pantalla entera (doctrina de `BlockedPanel`).

- [ ] **Step 1: Crear `src/app/(public)/asociate/step-dni.tsx`**

```tsx
"use client";
// Paso 1 del wizard ASOCIATE: el DNI primero (spec 2026-08-27). El vecino que
// no puede asociarse por la web —vigente, con trámite, con deuda, expulsado—
// se entera ACÁ, antes de cargar un solo dato, y no al final del formulario
// más largo. El molde es el DniForm de REEMPADRONATE.
import { FormMessage } from "@/components/admin/form-message";
import { TurnstileWidget } from "@/components/public/turnstile-widget";
import { Input } from "@/components/ui/input";
import { CONTROL_HEIGHT, type AsociateDraft, type DniCheckState } from "./wizard-shared";
import { Field, NavButtons } from "./wizard-ui";

export function StepDni({
  draft,
  patch,
  siteKey,
  actionState,
  formAction,
  pending,
  error,
}: {
  draft: AsociateDraft;
  patch: (values: Partial<AsociateDraft>) => void;
  siteKey: string;
  /** Se le pasa entero a Turnstile: cada respuesta del server es un objeto
   *  nuevo, y cada respuesta significa que el token anterior ya se gastó. */
  actionState: DniCheckState;
  formAction: (formData: FormData) => void;
  pending: boolean;
  error?: string;
}) {
  return (
    <form action={formAction} className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Con tu DNI verificamos si ya estás asociado o si tenés un trámite pendiente.
      </p>

      <Field id="dni" label="DNI" hint="Sin puntos ni espacios.">
        <Input
          id="dni"
          name="dni"
          className={CONTROL_HEIGHT}
          inputMode="numeric"
          // Sin autocompletado ni autoFocus, por las razones que el DniForm de
          // REEMPADRONATE dejó escritas: el documento no es un dato del
          // navegador, y el foco automático tapa el texto en el celular y le
          // roba el foco al encabezado en el camino de vuelta del veredicto.
          autoComplete="off"
          maxLength={9}
          required
          aria-describedby="dni-hint"
          value={draft.dni}
          onChange={(e) => patch({ dni: e.target.value.replace(/\D/g, "") })}
        />
      </Field>

      <TurnstileWidget
        siteKey={siteKey}
        resetKey={actionState}
        unavailable="El formulario no está disponible por un problema de configuración del sitio. Acercate a la sede vecinal para asociarte."
      />

      {error && (
        <FormMessage kind="error" box>
          {error}
        </FormMessage>
      )}

      <NavButtons submit nextLabel="Continuar" pending={pending} pendingLabel="Verificando…" />
    </form>
  );
}
```

- [ ] **Step 2: Crear `src/app/(public)/asociate/dni-result-panel.tsx`**

```tsx
"use client";
// Pantallas de resultado del paso 1 "Tu DNI" (spec 2026-08-27 §3.2). Como el
// BlockedPanel: el veredicto REEMPLAZA la pantalla entera, stepper incluido —
// un bloqueo no es un paso—, y nunca es un callejón sin salida: siempre hay
// "Probar con otro documento" y "Volver al inicio".
//
// Qué revela y qué no (decisiones del operador, 27/08/2026): el nombre viaja
// ENMASCARADO; la deuda dice la CANTIDAD de cuotas (sin pesos); expulsión,
// fallecimiento y anulación comparten un único literal de sede, indistinguibles.
import Link from "next/link";
import { useEffect, useRef } from "react";
import { FormMessage } from "@/components/admin/form-message";
import { Button } from "@/components/ui/button";
import { formatDateAR } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ResendResumeForm } from "./resend-resume-form";
import { CONTROL_HEIGHT, LINK_TARGET, type DniCheckState } from "./wizard-shared";

type BlockedVerdict = Extract<DniCheckState, { kind: "blocked" }>;

const HEADINGS: Record<BlockedVerdict["code"], string> = {
  already_member: "Ya estás asociado/a",
  in_progress: "Ya tenés una solicitud en trámite",
  visit_office: "No pudimos seguir",
  debt: "No pudimos seguir",
  rejected_wait: "No pudimos seguir",
};

export function DniResultPanel({
  blocked,
  dni,
  siteKey,
  onRetry,
}: {
  blocked: BlockedVerdict;
  /** El DNI tal como se tipeó: precarga el reenvío del enlace (in_progress). */
  dni: string;
  siteKey: string;
  /** Vuelve al paso 1 con el campo limpio, descartando el veredicto. */
  onRetry: () => void;
}) {
  // El encabezado del wizard se saltea al reemplazarse la pantalla: sin esto el
  // foco cae al <body> y quien navega con teclado no se entera del veredicto.
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const masked = blocked.maskedName;

  return (
    <div>
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="text-2xl font-bold tracking-tight outline-hidden sm:text-3xl"
      >
        {HEADINGS[blocked.code]}
      </h1>

      <FormMessage kind={blocked.code === "already_member" ? "neutral" : "warning"} box className="mt-5">
        {blocked.code === "already_member" && (
          <>
            <span className="block">
              {masked ? (
                <>
                  Encontramos una ficha a nombre de <strong>{masked}</strong>, que ya está asociada
                  a la vecinal.
                </>
              ) : (
                <>Ya estás asociado/a a la vecinal.</>
              )}
            </span>
            <span className="mt-2 block">
              Si sos vos, no hace falta que te asocies de nuevo: podés ver tu cuenta, tus pagos y
              tus datos desde el panel de socio.
            </span>
          </>
        )}
        {blocked.code === "in_progress" && (
          <span className="block">
            Ya hay una solicitud de asociación en trámite con ese DNI. Te podemos reenviar por
            email el enlace para retomarla.
          </span>
        )}
        {blocked.code === "debt" && (
          <>
            <span className="block">
              La ficha a nombre de <strong>{masked}</strong> registra{" "}
              <strong>
                {blocked.pendingCount === 1
                  ? "1 cuota pendiente"
                  : `${blocked.pendingCount} cuotas pendientes`}
              </strong>{" "}
              con tesorería.
            </span>
            <span className="mt-2 block">
              Para reingresar como socio/a, acercate a la sede vecinal a regularizarla. Después vas
              a poder completar tu solicitud.
            </span>
          </>
        )}
        {blocked.code === "visit_office" && (
          <>
            {masked && (
              <span className="block">
                Encontramos una ficha a nombre de <strong>{masked}</strong>.
              </span>
            )}
            <span className={masked ? "mt-2 block" : "block"}>
              No podemos procesar tu solicitud por este medio. Acercate a la sede vecinal.
            </span>
          </>
        )}
        {blocked.code === "rejected_wait" && (
          <>
            {masked && (
              <span className="block">
                Encontramos una ficha a nombre de <strong>{masked}</strong>.
              </span>
            )}
            <span className={masked ? "mt-2 block" : "block"}>
              No podés presentar una nueva solicitud por el momento.
            </span>
            {blocked.retryAtIso && (
              <span className="mt-2 block">
                Vas a poder volver a solicitarlo a partir del{" "}
                <strong>{formatDateAR(new Date(blocked.retryAtIso))}</strong>.
              </span>
            )}
          </>
        )}
      </FormMessage>

      {blocked.code === "already_member" && (
        <div className="mt-6">
          <Button asChild className={cn(CONTROL_HEIGHT, "w-full font-semibold sm:w-auto sm:px-8")}>
            <Link href="/ingresar">Ingresar al panel de socio</Link>
          </Button>
        </div>
      )}

      {blocked.code === "in_progress" && <ResendResumeForm dni={dni} siteKey={siteKey} />}

      <div className="mt-6">
        <Button
          type="button"
          variant="outline"
          onClick={onRetry}
          className={cn(CONTROL_HEIGHT, "w-full font-semibold sm:w-auto sm:px-6")}
        >
          Probar con otro documento
        </Button>
        <p className="mt-2 text-xs text-muted-foreground">
          Si te equivocaste al escribir el DNI, corregilo y probá de nuevo.
        </p>
      </div>

      {(blocked.code === "debt" || blocked.code === "visit_office" || blocked.code === "rejected_wait") && (
        <p className="mt-8 text-sm text-muted-foreground">
          Si creés que hay un error, acercate a la sede vecinal o escribinos desde la{" "}
          <Link href="/ubicacion" className={LINK_TARGET}>
            página de contacto
          </Link>
          .
        </p>
      )}
      <p className="mt-2">
        <Link href="/" className={LINK_TARGET}>
          Volver al inicio
        </Link>
      </p>
    </div>
  );
}
```

Nota: si `Button` del proyecto no soporta `asChild` (es el patrón shadcn habitual — verificar en `src/components/ui/button.tsx`), reemplazar ese bloque por un `<Link>` con las clases del botón primario: `className={cn("inline-flex items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/80", CONTROL_HEIGHT, "w-full font-semibold sm:w-auto sm:px-8")}`.

- [ ] **Step 3: Verificar compilación y lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: sin errores (los componentes todavía no se montan — se cablean en Task 7).

- [ ] **Step 4: Commit**

```bash
git add "src/app/(public)/asociate/step-dni.tsx" "src/app/(public)/asociate/dni-result-panel.tsx"
git commit -m "feat: DNI step form and verdict result panel"
```

---

### Task 7: Cablear el wizard — renumeración 5→6 y el DNI fijo

La tarea más delicada del plan. Cada edit está listado; no improvisar ninguno extra. El bloque del `replaceState` (líneas 226-275) NO SE TOCA.

**Files:**
- Modify: `src/app/(public)/asociate/asociate-wizard.tsx`
- Modify: `src/app/(public)/asociate/step-personal.tsx` (quitar el campo DNI, agregar hidden)
- Modify: `tests/asociate-wizard-client.test.ts` (agregar un describe de la renumeración — NO tocar los existentes)

**Interfaces:**
- Consumes: `StepDni`, `DniResultPanel` (Task 6), `checkDniAction` (Task 4), `DniCheckState` (Task 5).
- Produces: el wizard de 6 pasos. Contratos que el resto del sistema espera: el retome entra en el paso 5 o 6 (`requiredDocsComplete` decide); con `resumeToken` no se navega por debajo del paso 5; el POST del paso de datos sigue mandando `name="dni"`.

- [ ] **Step 1: Edits en `asociate-wizard.tsx` — constantes y estado**

1a. Comentario de cabecera (línea 2): `// Wizard público ASOCIATE (docs/05 §2). Cinco pasos.` → `// Wizard público ASOCIATE (docs/05 §2). Seis pasos.` Y en el mismo bloque, actualizar los números: línea 9 `// De los pasos 1-3 a los 4-5` → `// De los pasos 1-4 a los 5-6`; línea 11 `Por eso a partir del paso 4 no se vuelve atrás:` → `Por eso a partir del paso 5 no se vuelve atrás:`; línea 12 `reenviar el paso 3` → `reenviar el paso 4`; línea 15-16 `la creación del paso 3` → `la creación del paso 4`; línea 19 `La subida del paso 4` → `La subida del paso 5`; línea 22 `para habilitar el paso 5` → `para habilitar el paso 6`.

1b. Imports:

```ts
import { checkDniAction, createApplicationAction, submitNoDebitAction } from "./actions";
import { DniResultPanel } from "./dni-result-panel";
import { StepDni } from "./step-dni";
```

y sumar `DniCheckState` al import de tipos de `./wizard-shared`:

```ts
  type CreateState,
  type DniCheckState,
```

1c. Constantes (líneas 71-78):

```ts
const TOTAL_STEPS = 6;
const STEP_TITLES: Record<number, string> = {
  1: "Tu DNI",
  2: "¿Dónde vivís?",
  3: "Elegí tu categoría",
  4: "Tus datos",
  5: "Documentación",
  6: "Pago y envío",
};
```

1d. Inicializador del retome (líneas 124-136) — el comentario y los números:

```ts
  // El retome cae directo en el paso que corresponde: con la documentación ya
  // completa, en el 6. La regla es la MISMA función pura que usa el server para
  // aceptar el envío, así que las dos puntas no se pueden desincronizar.
  const [navStep, setStep] = useState(() => {
    const app = initial?.application;
    if (app?.status !== "started") return 1;
    return requiredDocsComplete(
      app.uploadedTypes.map((type) => ({ type })),
      app.requestedCategory,
    ).ok
      ? 6
      : 5;
  });
```

1e. Estado del chequeo de DNI — insertar DESPUÉS del bloque de `dismissed`/`live` (después de la línea 159 `const live = createState === dismissed ? null : createState;`):

```ts
  // El chequeo temprano por DNI del paso 1: mismo patrón de descarte por
  // identidad que `createState` (arriba), y el avance al paso 2 se decide en
  // el RENDER reconociendo la respuesta nueva, sin efectos (el patrón del
  // wizard de REEMPADRONATE).
  const [dniState, dniAction, checkingDni] = useActionState<DniCheckState, FormData>(
    checkDniAction,
    { kind: "idle" },
  );
  const [dniDismissed, setDniDismissed] = useState<DniCheckState | null>(null);
  const dniLive = dniState === dniDismissed ? null : dniState;

  const [seenDniState, setSeenDniState] = useState(dniState);
  if (dniState !== seenDniState) {
    setSeenDniState(dniState);
    if (dniState.kind === "ok") setStep(2);
  }
```

1f. La guarda de no-retorno (línea 168-170) — comentario y números:

```ts
  // Con la solicitud ya creada no se vuelve a los pasos 1-4: los datos están en
  // la base y reenviar el paso 4 crearía un duplicado (que el server rechaza).
  const step = resumeToken && navStep < 5 ? 5 : navStep;
```

1g. Comentarios con números de paso que quedan viejos: línea 173-174 `la acaba de crear el paso 3` → `la acaba de crear el paso 4`; línea 180-181 (comentario interno del snapshot) no tiene números — dejar; línea 196-197 `porque el paso se desmonta al ir al 5` → `al ir al 6`.

1h. `dismissBlocked` (líneas 294-303) — el bloqueo de la CREACIÓN vuelve al paso de datos, que ahora es el 4:

```ts
  // Salir del bloqueo también mueve el foco, y necesita su propio disparo: el
  // panel lo tenía puesto en SU encabezado, que al descartar se desmonta, y
  // como el paso nunca cambió (siempre fue 4) el efecto de arriba corta en el
  // guardia y el foco se cae al body. Es el mismo agujero que arregla el
  // efecto de navegación, en el camino de vuelta.
  function dismissBlocked() {
    goTo(4);
    // Tras el re-render que desmonta el panel: el encabezado del paso 4 ya existe.
    queueMicrotask(() => headingRef.current?.focus());
  }

  // Volver al paso 1 desde un veredicto del chequeo de DNI, con el campo
  // limpio: el caso más común es el tipeo, y dejar el número anterior invita a
  // reenviar el mismo error. Mismo mecanismo de foco que dismissBlocked.
  function retryDni() {
    setDniDismissed(dniState);
    patch({ dni: "" });
    setStep(1);
    queueMicrotask(() => headingRef.current?.focus());
  }
```

1i. El panel de veredicto — insertar ANTES del bloque `if (live?.blocked)` (línea 305):

```ts
  // El veredicto del paso 1 no es un paso del wizard: reemplaza la pantalla
  // entera, stepper incluido, igual que el bloqueo de la creación de abajo.
  if (dniLive?.kind === "blocked") {
    return (
      <DniResultPanel
        blocked={dniLive}
        dni={draft.dni}
        siteKey={siteKey}
        onRetry={retryDni}
      />
    );
  }
```

- [ ] **Step 2: Edits en `asociate-wizard.tsx` — render**

2a. El rastro (línea 356):

```tsx
      {step >= 2 && step <= 4 && <AnsweredTrail draft={draft} step={step} onEdit={goTo} />}
```

2b. El bloque de pasos (líneas 358-414) queda así (StepResidence y los demás NO cambian de props, sólo de número; StepDni es nuevo):

```tsx
      <div className="mt-6">
        {step === 1 && (
          <StepDni
            draft={draft}
            patch={patch}
            siteKey={siteKey}
            actionState={dniState}
            formAction={dniAction}
            pending={checkingDni}
            error={dniLive?.kind === "error" ? dniLive.error : undefined}
          />
        )}
        {step === 2 && (
          <StepResidence
            streets={streets}
            draft={draft}
            patch={patch}
            error={localError}
            onError={setLocalError}
            onNext={() => goTo(3)}
          />
        )}
        {step === 3 && (
          <StepCategory
            draft={draft}
            fees={fees}
            patch={patch}
            error={localError}
            onError={setLocalError}
            onBack={() => goTo(2)}
            onNext={() => goTo(4)}
          />
        )}
        {step === 4 && (
          <StepPersonal
            draft={draft}
            patch={patch}
            legal={legal}
            siteKey={siteKey}
            actionState={createState}
            formAction={createAction}
            pending={creating}
            error={live?.error}
            onBack={() => goTo(3)}
          />
        )}
        {step === 5 && application && (
          <StepDocuments
            resumeToken={resumeToken}
            category={application.requestedCategory}
            uploaded={uploaded}
            onUploaded={addUploaded}
            onNext={() => goTo(6)}
          />
        )}
        {step === 6 && application && (
          <StepPayment
            resumeToken={resumeToken}
            category={application.requestedCategory}
            wantsDebit={application.wantsDebit}
            fees={fees}
            submitState={submitState}
            submitAction={submitAction}
            submitting={submitting}
            onBack={() => goTo(5)}
          />
        )}
      </div>
```

2c. `AnsweredTrail` (líneas 423-452) — la fila del DNI arriba de todo, y los números corridos:

```tsx
function AnsweredTrail({
  draft,
  step,
  onEdit,
}: {
  draft: AsociateDraft;
  step: number;
  onEdit: (step: number) => void;
}) {
  const rows: Array<{ step: number; label: string; value: string }> = [];

  // El DNI verificado del paso 1: cambiarlo es volver ahí y re-verificar
  // (captcha incluido) — por eso el campo del paso 4 ya no existe.
  rows.push({ step: 1, label: "DNI", value: draft.dni });

  if (step > 2) {
    const address =
      draft.livesInBarrio === "si"
        ? `${draft.streetName} ${draft.streetNumber}, Barrio Ciudadela`
        : `${draft.streetText} ${draft.streetNumber}, ${draft.neighborhood}`;
    rows.push({ step: 2, label: "Vivís en", value: address });
  }

  if (step > 3 && draft.requestedCategory) {
    const debit =
      draft.requestedCategory === "adherent"
        ? draft.wantsDebit === "si"
          ? " · con débito automático"
          : " · sin débito automático"
        : "";
    rows.push({
      step: 3,
      label: "Categoría",
      value: `${CATEGORY_LABELS[draft.requestedCategory]}${debit}`,
    });
  }
```

(el `return` del `<ul>` y el mapeo de filas quedan como están).

- [ ] **Step 3: Edits en `step-personal.tsx`**

3a. Comentario de cabecera (líneas 2-3): `// Paso 3 del wizard ASOCIATE` → `// Paso 4 del wizard ASOCIATE`. Y en el comentario de los hidden (líneas 76-82): `Los pasos 1 y 2 viajan acá` → `Los pasos 2 y 3 viajan acá`.

3b. Agregar el hidden del DNI junto a los otros hidden (después de la línea 97, el cierre del bloque de `wantsDebit`):

```tsx
      {/* El DNI viene VERIFICADO del paso 1 y se muestra en el rastro de
          respuestas: cambiarlo es volver ahí (y re-verificar). El server igual
          revalida la elegibilidad entera en el POST: esto es UX, no una guarda. */}
      <input type="hidden" name="dni" value={draft.dni} />
```

3c. Quitar el campo DNI: el grid de las líneas 112-140 contiene `Field id="dni"` y `Field id="birthDate"`. Borrar el `<Field id="dni">…</Field>` completo y desarmar el grid (queda un solo campo):

```tsx
      <Field id="birthDate" label="Fecha de nacimiento" hint="Tenés que ser mayor de 18 años.">
        <Input
          id="birthDate"
          name="birthDate"
          type="date"
          className={CONTROL_HEIGHT}
          autoComplete="bday"
          required
          aria-describedby="birthDate-hint"
          value={draft.birthDate}
          onChange={(e) => patch({ birthDate: e.target.value })}
        />
      </Field>
```

(reemplaza al `<div className="grid gap-5 sm:grid-cols-2">…</div>` entero de ese par; el grid siguiente —estado civil / nacionalidad— no se toca).

- [ ] **Step 4: Agregar el describe de la renumeración a `tests/asociate-wizard-client.test.ts`**

Al final del archivo (NO tocar los describes existentes):

```ts
// ── Paso 1 "Tu DNI" (spec 2026-08-27): la aritmética que protege el retome ──
//
// La renumeración 5→6 no tiene cobertura de comportamiento (no hay jsdom), así
// que se fijan los DOS literales que, mal corridos, romperían el retome o
// permitirían reenviar el paso de datos sobre una solicitud con preapproval.
describe("el wizard de 6 pasos", () => {
  it("declara 6 pasos y el DNI es el paso 1", () => {
    expect(wizard).toContain("const TOTAL_STEPS = 6;");
    expect(wizard).toContain('1: "Tu DNI",');
  });

  it("con la solicitud creada no se navega por debajo del paso 5", () => {
    expect(wizard).toContain("const step = resumeToken && navStep < 5 ? 5 : navStep;");
  });
});
```

- [ ] **Step 5: Verificación completa**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: todo verde. Atención especial a `tests/asociate-wizard-client.test.ts`: sus describes viejos leen la FUENTE del wizard — si alguno falla, revisar qué literal se movió de más (el bloque `replaceState` tiene que estar intacto).

- [ ] **Step 6: Commit**

```bash
git add "src/app/(public)/asociate/asociate-wizard.tsx" "src/app/(public)/asociate/step-personal.tsx" tests/asociate-wizard-client.test.ts
git commit -m "feat: wire the DNI gate as step 1 of 6 in the ASOCIATE wizard"
```

---

### Task 8: Documentación — docs/05 y docs/08

**Files:**
- Modify: `docs/05-flujos-funcionales.md` (§2, líneas 46-160 aprox.)
- Modify: `docs/08-seguridad-y-privacidad.md` (§minimización, líneas 14-16 aprox.)

- [ ] **Step 1: `docs/05-flujos-funcionales.md` §2**

1a. En el párrafo introductorio (líneas 48-54), reemplazar desde `**Turnstile validado server-side en el paso 3**` hasta `token de retome.` por:

```
**Turnstile validado server-side en los pasos 1 y 4** — el 1 consulta el padrón
con un DNI suelto y el 4 es el que escribe en la base. Los pasos 2 y 3 no
tocan la base; los 5 y 6 ya operan sobre una solicitud creada y se autentican
con el token de retome.
```

1b. En el párrafo **Arquitectura** (líneas 56-62): `un componente cliente de 5 pasos` → `un componente cliente de 6 pasos`; `El paso 3 crea la Application` → `El paso 4 crea la Application`; `Un refresh antes del paso 3 pierde el progreso — son dos pantallas cortas` → `Un refresh antes del paso 4 pierde el progreso — son tres pantallas cortas`; `A partir del paso 3` → `A partir del paso 4`.

1c. Insertar ANTES de `**Paso 1 — ¿Dónde vivís?**` (línea 64):

```
**Paso 1 — Tu DNI** (chequeo temprano, spec 2026-08-27)
- Campo DNI + Turnstile. La action (`checkDniAction`) corre el orden de guardas
  de siempre —interruptor → proceso de re-empadronamiento → cupo (`allows`) →
  captcha → zod → cobro (`record`) → padrón— con un **limitador propio de
  5 intentos / 15 min por IP** (`asociateDniCheckLimiter`), separado del cupo
  de creación. **No audita** (misma doctrina que el lookup de REEMPADRONATE:
  un asiento por intento registraría qué DNI consultó cada IP).
- Los insumos y el juez son LOS MISMOS del envío del paso 4:
  `loadEligibilityInputs` + `checkEligibility`. El paso 1 es una cortesía de
  UX; la guarda real sigue en el POST del paso 4.
- Veredictos (la prosa la escribe la pantalla; el server manda códigos):
  - **DNI desconocido o ex-socio habilitado** → continúa al paso 2, y los dos
    casos son **indistinguibles**: que exista una ficha no se le dice a un
    visitante anónimo; el `memberId` se re-resuelve al crear.
  - **Vigente o suspendido** → "Ya estás asociado/a" con el **nombre
    enmascarado** ("N***** C.", la misma `maskedName` de REEMPADRONATE) y
    botón al panel de socio (`/ingresar`).
  - **Solicitud viva** → el reenvío del enlace de retome, ahí mismo.
  - **Deuda viva** → nombre enmascarado + **cantidad de cuotas pendientes**
    (sin pesos; decisión del operador, 27/08/2026) + "acercate a la sede".
  - **Expulsión / fallecimiento / anulación** → el mismo literal genérico de
    sede de siempre, indistinguibles entre sí.
  - **Rechazo < 6 meses** → la fecha a partir de la cual puede reintentar.
- Superado el chequeo, el DNI queda **fijo**: viaja en el rastro de respuestas
  ("Cambiar" vuelve al paso 1 y re-verifica) y el paso 4 ya no tiene campo DNI
  (viaja como hidden).
```

1d. Renumerar los encabezados siguientes: `**Paso 1 — ¿Dónde vivís?**` → `**Paso 2 — ¿Dónde vivís?**`; `**Paso 2 — Categoría**` → `**Paso 3 — Categoría**`; `**Paso 3 — Tus datos**` → `**Paso 4 — Tus datos**`; `**Paso 4 — Documentación**` → `**Paso 5 — Documentación**`; `**Paso 5 — Pago / envío**` → `**Paso 6 — Pago / envío**`. Dentro del bloque de "Tus datos", donde dice `Orden de las guardas al enviar` no cambia nada (sigue siendo cierto). La tabla `**Bloqueos por DNI del paso 3**` pasa a `**Bloqueos por DNI del paso 4** (regla pura y testeada, en este orden — desde el paso "Tu DNI" es la SEGUNDA línea de defensa: el chequeo temprano ya mostró estos mismos veredictos, pero un POST armado a mano no pasa por él):` — el contenido de la tabla no cambia. Revisar el resto del §2 por menciones sueltas a números de paso (`el paso 3 del wizard muestra`, `los pasos 4 y 5`) y correrlas +1.

- [ ] **Step 2: `docs/08-seguridad-y-privacidad.md`**

En el punto de minimización (líneas ~14-16), reemplazar:

```
La identificación del re-empadronamiento responde con **nombre enmascarado** y
mensajes genéricos ante no-coincidencia.
```

por:

```
La identificación del re-empadronamiento responde con **nombre enmascarado** y
mensajes genéricos ante no-coincidencia. El chequeo temprano por DNI de
ASOCIATE (spec 2026-08-27) sigue la misma regla con una ampliación decidida
por el operador (27/08/2026): detrás de Turnstile y de un cupo de 5/15 min
por IP, responde el nombre **enmascarado**, veredictos distinguibles entre sí
(vigente / trámite / deuda / sede / rechazo) y, en el caso deuda, la
**cantidad** de cuotas pendientes — nunca montos, nunca el nombre completo,
nunca el motivo real de una baja de sede, y el reingreso habilitado es
indistinguible de un DNI desconocido.
```

- [ ] **Step 3: `CLAUDE.md` — el patrón que estrena el módulo**

Agregar al final de la sección de patrones (después del bloque "Patrones que estrenó la exención de cuota") una sección nueva:

```markdown
## Patrones que estrenó el paso "Tu DNI" de ASOCIATE

- **La carga de insumos de elegibilidad es UNA función para los dos
  call-sites.** `loadEligibilityInputs` (`src/lib/applications/eligibility-inputs.ts`)
  alimenta el chequeo temprano del paso 1 Y la guarda del envío del paso de
  datos; `checkEligibility` sigue siendo el único juez y no se tocó. Misma
  lección que `coverageFloor`: compartir la función, no copiarla — con una
  copia por camino, alcanza con que alguien toque una para que el paso 1 y el
  envío diverjan en silencio.
- **Un lookup público por DNI responde enmascarado y con presupuesto propio.**
  `maskedName` se mudó a `src/lib/members/masked-name.ts` (re-export desde
  `reregistration/rules.ts`) y ahora la comparten los dos wizards;
  `asociateDniCheckLimiter` (5/15 min por IP) es un cupo SEPARADO del de
  creación. El paso 1 es cortesía de UX, no una guarda: el POST del paso de
  datos revalida la elegibilidad entera, y el veredicto `ok` no distingue el
  reingreso habilitado del DNI desconocido (decisión del operador, 27/08/2026).
```

- [ ] **Step 4: Commit**

```bash
git add docs/05-flujos-funcionales.md docs/08-seguridad-y-privacidad.md CLAUDE.md
git commit -m "docs: early DNI gate in the ASOCIATE flow and privacy amendment"
```

---

### Task 9: Verificación final

- [ ] **Step 1: Suite entera, lint y tipos**

Run: `npm test && npm run lint && npx tsc --noEmit`
Expected: todo verde. En particular: `create-application-action` (34 casos, sin aserciones tocadas), `reregistration-rules` y `reempadronate-lookup` (sin tocarse), `application-eligibility` (sin tocarse), los dos archivos nuevos.

- [ ] **Step 2: La guarda del alcance**

Run: `git diff --stat main -- src/lib/mp src/lib/treasury src/lib/applications/eligibility.ts`
Expected: **salida vacía**. Si algo aparece, se rompió la restricción de la spec §7 — revertir eso antes de seguir.

- [ ] **Step 3: Verificación manual en el navegador (dev server)**

Levantar el dev server (`.claude/launch.json` / preview) y recorrer con datos locales (la base local tiene el padrón importado con 118 bajas y deuda; se puede sembrar lo que falte — sólo producción conserva el seed original):

1. **Camino feliz**: DNI desconocido → pasa a "¿Dónde vivís?" y completa el alta entera hasta la pantalla de enviada (rama sin débito alcanza). El stepper dice "Paso X de 6" en todos los pasos y la barra avanza.
2. **Vigente**: DNI de un socio `active` → pantalla "Ya estás asociado/a" con nombre enmascarado y botón a `/ingresar`. Verificar que "Probar con otro documento" vuelve al paso 1 con el campo vacío y el foco en el `<h1>`.
3. **Deuda**: DNI de un ex-socio con cuotas pendientes → cantidad correcta de cuotas, sin montos.
4. **Expulsado** (o ficha con `reentryBlocked`): mensaje genérico de sede, sin motivo.
5. **En trámite**: crear una solicitud con un DNI, volver a `/asociate`, tipear el mismo DNI → pantalla de trámite con el formulario de reenvío (con `EMAIL_ALLOWLIST` local, el correo puede no salir: lo que se verifica es la pantalla).
6. **Reingreso habilitado**: DNI de una baja por renuncia sin deuda → pasa SIN ninguna señal distinta del camino 1.
7. **Rastro**: en los pasos 2-4 se ve la fila "DNI — Cambiar"; tocarla vuelve al paso 1; cambiar el DNI exige re-verificar. En el paso 4 NO hay campo DNI visible.
8. **Retome**: abrir el enlace de retome de una solicitud `started` → entra en el paso 5 o 6 según documentos; no se puede navegar hacia atrás por debajo del 5; el pago (si se toca) sigue funcionando igual.
9. **Cupo**: siete chequeos seguidos → a partir del sexto, "Demasiados intentos…" (y el envío del paso 4 de otro trámite NO queda bloqueado por eso).
10. Consola del navegador sin errores en todo el recorrido.

- [ ] **Step 4: Actualizar la spec si algo divergió**

Si la verificación manual obligó a algún ajuste de texto o flujo, reflejarlo en `docs/superpowers/specs/2026-08-27-asociate-paso-dni-design.md` y commitear junto con el arreglo.

- [ ] **Step 5: Commit final (si quedaron arreglos) y resumen**

Dejar la rama `asociate-dni-gate` lista para revisión del operador: `git log --oneline main..HEAD` tiene que contar la historia en ~8 commits.
