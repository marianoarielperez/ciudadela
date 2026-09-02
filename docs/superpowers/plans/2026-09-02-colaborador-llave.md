# Llave `colaborador_habilitado` — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lanzar el sitio antes de que la IGJ oficialice el estatuto reformado: la categoría socio colaborador (Art. 5 bis) se apaga con una llave de configuración que cierra la rama "En otro barrio" de ASOCIATE y el pedido de pase a colaborador en `/mi/solicitudes`, y el rótulo "Norma vigente" de `/mi/documentos` pasa a "Estatuto".

**Architecture:** Una clave booleana `colaborador_habilitado` en la tabla `Configuration`, hermana de `asociate_activo`: switch de superadmin en `/admin/configuracion`, lector cacheado por el tag `config` para las páginas públicas y lectura directa con `configReader.getBool` en cada guarda de servidor. Dos funciones puras nuevas deciden qué se ofrece (`categoryOfferedOnWeb` para el wizard, `requestableCategories` para el socio) y las pantallas y las actions las comparten: lo que la pantalla deshabilita es exactamente lo que la action rechaza. Sin migración, sin seed, sin variable de entorno.

**Tech Stack:** Next.js 16 (App Router, server actions), TypeScript, Prisma sobre MariaDB, vitest (entorno node, sin jsdom), zod, Tailwind.

**Spec:** `docs/superpowers/specs/2026-09-02-colaborador-llave-design.md` (leerla entera antes de empezar).

## Global Constraints

- Rama de trabajo: `collaborator-switch`, creada desde `main`. Commits en inglés, terminados en `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Clave: `colaborador_habilitado` (en castellano, precedente `asociate_activo`). En código: `CONFIG_KEYS.collaboratorEnabled`. Ausente en la base = apagada.
- Las GUARDAS leen directo con `configReader.getBool` (o con un lector por `db` en dominio); sólo las páginas públicas cacheadas usan el getter con `unstable_cache` y `CACHE_TAGS.config`.
- Textos EXACTOS (es-AR, voseo):
  - Público: `Por ahora, la asociación en línea es sólo para quienes viven en el Barrio Ciudadela.`
  - Socio: `Por ahora no se puede pedir el pase a socio colaborador.`
  - Switch: `Categoría socio colaborador habilitada (Art. 5 bis)`; ayuda: `Apagada, ASOCIATE sólo admite a quienes viven en el barrio y el socio no puede pedir el pase a colaborador. Prendela cuando la IGJ oficialice el estatuto reformado.`
  - Tira de estado: etiqueta `Socio colaborador`, valores `Habilitado` / `Deshabilitado`, nunca en warning.
  - `/mi/documentos`: eyebrow y `aria-label` `Estatuto`.
- NO tocar `src/lib/treasury/*` ni `src/lib/mp/*` ni `prisma/`. NO crear migraciones. NO tocar las pantallas de admin que ofrecen colaborador (alta manual, cambio de categoría, recategorización de solicitudes): `categoryAllowedForResidence` queda **intacta** y sigue siendo lo que usan.
- Tests: `npx vitest run <archivo>` para uno; `npm test` para la suite; `npx tsc --noEmit`; `npm run lint`. Los archivos de test siguen la convención de cada archivo (nombres de `it` en castellano donde ya están en castellano, en inglés donde ya están en inglés).
- Los comentarios del código nuevo se escriben en castellano, como el resto del repo, y citan `spec 2026-09-02` cuando explican la llave.
- Las guardas nuevas se verifican por MUTACIÓN: borrar la guarda, ver el test en rojo, restaurar. Es un paso explícito en las tareas 2 y 5.
- La **Tarea 8 (verificación y auditoría) es obligatoria** y no se puede saltear: el operador la pidió como condición del trabajo.

---

### Task 1: La clave y el lector cacheado

**Files:**
- Modify: `src/lib/config-keys.ts` (después de `reregistrationProcessId`, línea ~33)
- Modify: `src/lib/config.ts` (después de `getAsociateActive`, línea ~49)
- Test: `tests/config.test.ts`

**Interfaces:**
- Produces: `CONFIG_KEYS.collaboratorEnabled === "colaborador_habilitado"` (módulo puro `@/lib/config-keys`, re-exportado por `@/lib/config`); `getCollaboratorEnabled(): Promise<boolean>` en `@/lib/config`, cacheada por `CACHE_TAGS.config`.

- [ ] **Step 1: Crear la rama**

```bash
git checkout main && git pull --ff-only && git checkout -b collaborator-switch
```

- [ ] **Step 2: Escribir los tests que fallan**

En `tests/config.test.ts`, agregar `getCollaboratorEnabled` al import de `@/lib/config`:

```ts
import {
  CONFIG_KEYS,
  getActiveReregistration,
  getCollaboratorEnabled,
  getLegalTexts,
  makeConfigReader,
  parseRecipients,
} from "@/lib/config";
```

Dentro de `describe("makeConfigReader", …)`, después de `it("expone las claves del módulo 3", …)`:

```ts
  it("expone la llave de la categoría colaborador (lanzamiento antes de la IGJ, spec 2026-09-02)", () => {
    expect(CONFIG_KEYS.collaboratorEnabled).toBe("colaborador_habilitado");
  });
```

Al final del archivo, un `describe` nuevo (mismo patrón que `getLegalTexts`: `rows` se vacía en cada test):

```ts
describe("getCollaboratorEnabled", () => {
  beforeEach(() => {
    for (const key of Object.keys(rows)) delete rows[key];
  });

  it("ausente en la base cuenta como apagada: el sitio nace sin colaboradores", async () => {
    expect(await getCollaboratorEnabled()).toBe(false);
  });

  it("sólo el true estricto la prende", async () => {
    rows[CONFIG_KEYS.collaboratorEnabled] = "true";
    expect(await getCollaboratorEnabled()).toBe(false);
    rows[CONFIG_KEYS.collaboratorEnabled] = true;
    expect(await getCollaboratorEnabled()).toBe(true);
  });
});
```

- [ ] **Step 3: Correr y ver que falla**

Run: `npx vitest run tests/config.test.ts`
Expected: FAIL — `getCollaboratorEnabled is not a function` y `expected undefined to be "colaborador_habilitado"`.

- [ ] **Step 4: Implementar la clave**

En `src/lib/config-keys.ts`, dentro de `CONFIG_KEYS`, después de `reregistrationProcessId`:

```ts
  /** Categoría socio colaborador (Art. 5 bis) ofrecida al público. Existe
   *  porque el sitio se lanza ANTES de que la IGJ oficialice el estatuto
   *  reformado, que es el que crea la categoría (spec 2026-09-02): apagada,
   *  ASOCIATE no admite a quien vive fuera del barrio y el socio no puede
   *  pedir el pase desde /mi/solicitudes. Ausente en la base cuenta como
   *  apagada (`getBool`), así que en producción no se siembra nada. Se prende
   *  a mano desde /admin/configuracion el día de la oficialización; no hay
   *  fecha ni cuenta regresiva. Nombre en castellano por el precedente de
   *  `asociate_activo`. */
  collaboratorEnabled: "colaborador_habilitado",
```

En `src/lib/config.ts`, después de `getAsociateActive`:

```ts
/** La llave `colaborador_habilitado` (spec 2026-09-02) para las páginas
 *  públicas CACHEADAS de `/asociate`. Misma división que el interruptor de
 *  ASOCIATE: esto es DISPLAY y se invalida por el tag `config`; las guardas
 *  —`createApplicationAction` y el servicio de solicitudes del socio— leen
 *  directo, porque un `true` viejo dejaría crear solicitudes de colaborador
 *  después de apagar la llave. */
export const getCollaboratorEnabled = unstable_cache(
  () => configReader.getBool(CONFIG_KEYS.collaboratorEnabled),
  ["config-collaborator"],
  { tags: [CACHE_TAGS.config] },
);
```

- [ ] **Step 5: Correr y ver que pasa**

Run: `npx vitest run tests/config.test.ts`
Expected: PASS (todos los tests del archivo).

- [ ] **Step 6: Commit**

```bash
git add src/lib/config-keys.ts src/lib/config.ts tests/config.test.ts
git commit -m "feat(config): colaborador_habilitado key and cached reader

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: La regla pura del wizard, `categoryOfferedOnWeb`

**Files:**
- Modify: `src/lib/applications/wizard.ts` (al final del archivo)
- Test: `tests/application-wizard.test.ts`

**Interfaces:**
- Consumes: nada nuevo (`categoryAllowedForResidence` ya existe y NO cambia de firma).
- Produces: `categoryOfferedOnWeb(category: MemberCategory, livesInBarrio: boolean, collaboratorEnabled: boolean): boolean`.

- [ ] **Step 1: Escribir los tests que fallan**

En `tests/application-wizard.test.ts`, agregar `categoryOfferedOnWeb` al import:

```ts
import {
  categoryAllowedForResidence, categoryOfferedOnWeb, civilTodayAr, isAdult, WEB_CATEGORIES,
} from "@/lib/applications/wizard";
```

Al final del archivo:

```ts
describe("categoryOfferedOnWeb (REG-01 + llave colaborador_habilitado, spec 2026-09-02)", () => {
  const ALL = ["active", "adherent", "collaborator", "cadet", "honorary", "lifetime"] as const;

  it("con la llave prendida coincide exactamente con categoryAllowedForResidence", () => {
    for (const cat of ALL) {
      for (const lives of [true, false]) {
        expect(categoryOfferedOnWeb(cat, lives, true)).toBe(categoryAllowedForResidence(cat, lives));
      }
    }
  });

  it("con la llave apagada, otro barrio no admite ninguna categoría", () => {
    for (const cat of ALL) expect(categoryOfferedOnWeb(cat, false, false)).toBe(false);
  });

  it("con la llave apagada, Ciudadela sigue igual: active y adherent sí, el resto no", () => {
    expect(categoryOfferedOnWeb("active", true, false)).toBe(true);
    expect(categoryOfferedOnWeb("adherent", true, false)).toBe(true);
    expect(categoryOfferedOnWeb("collaborator", true, false)).toBe(false);
    expect(categoryOfferedOnWeb("cadet", true, false)).toBe(false);
  });
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx vitest run tests/application-wizard.test.ts`
Expected: FAIL — `categoryOfferedOnWeb is not a function`.

- [ ] **Step 3: Implementar**

Al final de `src/lib/applications/wizard.ts`:

```ts
/** Lo que la WEB ofrece: REG-01 más la llave `colaborador_habilitado` (spec
 *  2026-09-02). La categoría colaborador es del estatuto reformado y el sitio
 *  se lanza antes de que la IGJ lo oficialice, así que con la llave apagada
 *  "otro barrio" no admite ninguna categoría.
 *
 *  `categoryAllowedForResidence` queda INTACTA a propósito: es la regla
 *  estatutaria, y el panel la usa para AVISAR de un desajuste de residencia
 *  sin gating (la recategorización de una solicitud es de la Comisión, que
 *  sabe qué estatuto rige). Sólo la creación pública pasa por acá. El tercer
 *  parámetro no tiene default: cada llamador decide qué llave leyó. */
export function categoryOfferedOnWeb(
  category: MemberCategory,
  livesInBarrio: boolean,
  collaboratorEnabled: boolean,
): boolean {
  if (!categoryAllowedForResidence(category, livesInBarrio)) return false;
  return category !== "collaborator" || collaboratorEnabled;
}
```

- [ ] **Step 4: Correr y ver que pasa**

Run: `npx vitest run tests/application-wizard.test.ts`
Expected: PASS.

- [ ] **Step 5: Verificación por mutación**

Reemplazar temporalmente la última línea de `categoryOfferedOnWeb` por `return true;`, correr `npx vitest run tests/application-wizard.test.ts` y confirmar que **falla** el test "con la llave apagada, otro barrio no admite ninguna categoría". Restaurar la línea (`return category !== "collaborator" || collaboratorEnabled;`) y correr de nuevo: PASS. Si la mutación no pone el test en rojo, el test no prueba la guarda: arreglar el test antes de seguir.

- [ ] **Step 6: Commit**

```bash
git add src/lib/applications/wizard.ts tests/application-wizard.test.ts
git commit -m "feat(applications): categoryOfferedOnWeb composes REG-01 with the collaborator switch

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: La guarda en `createApplicationAction` y el mensaje compartido

**Files:**
- Modify: `src/app/(public)/asociate/wizard-shared.ts` (después de `LINK_TARGET`, al final)
- Modify: `src/app/(public)/asociate/actions.ts` (import línea 21; bloque de revalidación de REG-01, líneas ~283-287)
- Test: `tests/create-application-action.test.ts` (fixture de `configRows` en el `beforeEach`, línea ~143; tests nuevos junto a "la categoría se revalida contra la residencia", línea ~426)

**Interfaces:**
- Consumes: `categoryOfferedOnWeb` (Task 2), `CONFIG_KEYS.collaboratorEnabled` (Task 1), `configReader` y `CONFIG_KEYS` ya importados en `actions.ts`.
- Produces: `COLLABORATOR_CLOSED_MESSAGE` exportada desde `wizard-shared.ts` (la usan el server acá y la tarjeta del paso 2 en Task 4).

- [ ] **Step 1: La constante compartida**

Al final de `src/app/(public)/asociate/wizard-shared.ts`:

```ts
/** La rama "otro barrio" con la llave `colaborador_habilitado` apagada (spec
 *  2026-09-02). Vive acá porque lo dicen DOS puntas con el mismo texto: la
 *  tarjeta deshabilitada del paso 2 y el rechazo de `createApplicationAction`
 *  a un POST armado a mano. Un módulo sin "use client", importable desde la
 *  action y desde el componente. */
export const COLLABORATOR_CLOSED_MESSAGE =
  "Por ahora, la asociación en línea es sólo para quienes viven en el Barrio Ciudadela.";
```

- [ ] **Step 2: Escribir los tests que fallan**

En `tests/create-application-action.test.ts`, en el `beforeEach`, la fixture `mocks.configRows` pasa a incluir la llave prendida (los tests de colaborador que ya existen la necesitan):

```ts
  // `asociate_activo` prendido (guarda 0, docs/05 §2), los dos textos legales
  // publicados (guarda 0 bis) y la llave `colaborador_habilitado` prendida
  // (spec 2026-09-02): el camino feliz de colaborador la necesita, y los tests
  // de la llave la apagan o la borran a mano.
  mocks.configRows = {
    asociate_activo: true,
    colaborador_habilitado: true,
    terms_text: "Términos de prueba",
    privacy_consent_text: "Consentimiento de prueba",
  };
```

Después del test `it("la categoría se revalida contra la residencia (POST armado a mano)", …)`:

```ts
  // ── La llave `colaborador_habilitado` (spec 2026-09-02) ─────────────────────
  //
  // La categoría colaborador es del estatuto reformado y el sitio se lanza
  // antes de que la IGJ lo oficialice. El paso 2 deshabilita la tarjeta, pero
  // un POST armado a mano no pasa por la pantalla: la action decide sola, y
  // lee la llave DIRECTO (un `true` cacheado dejaría entrar colaboradores
  // después de apagarla).
  it("llave ausente en configuration: la rama de otro barrio no crea nada y dice por qué", async () => {
    delete mocks.configRows.colaborador_habilitado;
    const result = await createApplicationAction({}, form({
      ...VALID, livesInBarrio: "no", streetId: "", streetText: "Rivadavia",
      neighborhood: "Centro", requestedCategory: "collaborator", wantsDebit: "no",
    }));
    expect(result.error).toBe(
      "Por ahora, la asociación en línea es sólo para quienes viven en el Barrio Ciudadela.",
    );
    expect(result.created).toBeUndefined();
    expect(mocks.service.create).not.toHaveBeenCalled();
  });

  it("llave apagada: pedir colaborador viviendo en Ciudadela cae por REG-01, no por la llave", async () => {
    // El mensaje se elige por CAUSA: acá lo que falla es la residencia, y
    // decirle "sólo para quienes viven en el barrio" a alguien que vive en el
    // barrio sería un mensaje falso.
    mocks.configRows.colaborador_habilitado = false;
    const result = await createApplicationAction({}, form({ ...VALID, requestedCategory: "collaborator" }));
    expect(result.error).toMatch(/no corresponde a tu lugar de residencia/i);
    expect(mocks.service.create).not.toHaveBeenCalled();
  });
```

- [ ] **Step 3: Correr y ver que falla**

Run: `npx vitest run tests/create-application-action.test.ts`
Expected: FAIL — el primer test nuevo recibe `created` (la solicitud se crea igual) porque la action todavía no mira la llave. El resto del archivo en verde.

- [ ] **Step 4: Implementar la guarda**

En `src/app/(public)/asociate/actions.ts`, el import de la línea 21 pasa a:

```ts
import {
  categoryAllowedForResidence, categoryOfferedOnWeb, civilTodayAr, isAdult, WEB_CATEGORIES,
} from "@/lib/applications/wizard";
```

Agregar el import de la constante compartida junto a los demás imports locales del archivo:

```ts
import { COLLABORATOR_CLOSED_MESSAGE } from "./wizard-shared";
```

Reemplazar el bloque de revalidación de REG-01 (hoy líneas ~283-287):

```ts
  // Revalidación de REG-01 en el server: el paso 3 del wizard ya filtra las
  // opciones, pero un POST armado a mano no pasa por ese filtro.
  if (!categoryAllowedForResidence(data.requestedCategory, livesInBarrio)) {
    return { error: "La categoría elegida no corresponde a tu lugar de residencia. Volvé al paso 3." };
  }
```

por:

```ts
  // Revalidación de REG-01 en el server MÁS la llave `colaborador_habilitado`
  // (spec 2026-09-02): el paso 2 deshabilita la tarjeta y el paso 3 filtra las
  // opciones, pero un POST armado a mano no pasa por ninguno de los dos.
  // Lectura DIRECTA con `configReader`, sin la caché de las páginas: es una
  // guarda, y un `true` viejo dejaría crear solicitudes de colaborador después
  // de apagar la llave. El mensaje se elige por CAUSA: si REG-01 ya lo rechaza
  // es un desajuste de residencia, y la llave no tiene nada que decir.
  const collaboratorEnabled = await configReader.getBool(CONFIG_KEYS.collaboratorEnabled);
  if (!categoryOfferedOnWeb(data.requestedCategory, livesInBarrio, collaboratorEnabled)) {
    return {
      error: categoryAllowedForResidence(data.requestedCategory, livesInBarrio)
        ? COLLABORATOR_CLOSED_MESSAGE
        : "La categoría elegida no corresponde a tu lugar de residencia. Volvé al paso 3.",
    };
  }
```

- [ ] **Step 5: Correr y ver que pasa**

Run: `npx vitest run tests/create-application-action.test.ts tests/asociate-dni-action.test.ts`
Expected: PASS en los dos archivos (el del DNI no cambia: el paso 1 no mira la llave).

- [ ] **Step 6: Commit**

```bash
git add "src/app/(public)/asociate/wizard-shared.ts" "src/app/(public)/asociate/actions.ts" tests/create-application-action.test.ts
git commit -m "feat(asociate): reject the other-barrio branch while the collaborator switch is off

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: `ChoiceCard.disabled`, la tarjeta del paso 2 y la prop del wizard

**Files:**
- Modify: `src/app/(public)/asociate/wizard-ui.tsx` (`ChoiceCard`, líneas 13-70)
- Modify: `src/app/(public)/asociate/step-residence.tsx` (props, import y la segunda `ChoiceCard`)
- Modify: `src/app/(public)/asociate/asociate-wizard.tsx` (props de `AsociateWizard`, línea ~132-148; render de `StepResidence`, línea ~436)
- Modify: `src/app/(public)/asociate/page.tsx` (import de `@/lib/config` y el `Promise.all` final)
- Modify: `src/app/(public)/asociate/retomar/[token]/page.tsx` (import, `Promise.all` de la línea ~48 y el render)
- Test: `tests/asociate-wizard-client.test.ts`

**Interfaces:**
- Consumes: `getCollaboratorEnabled` (Task 1), `COLLABORATOR_CLOSED_MESSAGE` (Task 3).
- Produces: `ChoiceCard` acepta `disabled?: boolean`; `AsociateWizard` exige `collaboratorEnabled: boolean`; `StepResidence` exige `collaboratorEnabled: boolean`.

- [ ] **Step 1: Escribir los tests que fallan (tests de FUENTE, sin jsdom)**

Al final de `tests/asociate-wizard-client.test.ts`:

```ts
// ── La llave `colaborador_habilitado` en el paso 2 (spec 2026-09-02) ─────────
//
// Sin jsdom se fija la ESTRUCTURA que hace imposible el bug: la tarjeta "En
// otro barrio" recibe el `disabled` derivado de la prop, explica por qué con la
// MISMA constante que devuelve el server, y `ChoiceCard` deshabilita el radio
// NATIVO —un radio disabled no dispara `onChange`, así que `chooseBranch("no")`
// es inalcanzable sin tocar la validación—. El comportamiento con clics se
// verifica en el navegador en la Tarea 8.
describe("la llave colaborador_habilitado en el paso 2", () => {
  const stepResidence = code(src("app", "(public)", "asociate", "step-residence.tsx"));
  const wizardUi = code(src("app", "(public)", "asociate", "wizard-ui.tsx"));
  const shared = code(src("app", "(public)", "asociate", "wizard-shared.ts"));
  const asociatePage = code(src("app", "(public)", "asociate", "page.tsx"));
  const retomePage = code(src("app", "(public)", "asociate", "retomar", "[token]", "page.tsx"));

  it("la tarjeta de otro barrio se deshabilita con la prop y explica con la constante compartida", () => {
    expect(stepResidence).toContain("disabled={!collaboratorEnabled}");
    expect(stepResidence).toContain("COLLABORATOR_CLOSED_MESSAGE");
  });

  it("ChoiceCard deshabilita el radio nativo", () => {
    expect(wizardUi).toContain("disabled?: boolean;");
    expect(wizardUi).toContain("disabled={disabled}");
  });

  it("el wizard exige la prop y se la pasa al paso 2", () => {
    expect(wizard).toContain("collaboratorEnabled: boolean;");
    expect(wizard).toContain("collaboratorEnabled={collaboratorEnabled}");
  });

  it("las dos páginas leen la llave cacheada y se la pasan al wizard", () => {
    for (const page of [asociatePage, retomePage]) {
      expect(page).toContain("getCollaboratorEnabled()");
      expect(page).toContain("collaboratorEnabled={collaboratorEnabled}");
    }
  });

  it("la constante dice lo mismo que el server", () => {
    expect(shared).toContain(
      "Por ahora, la asociación en línea es sólo para quienes viven en el Barrio Ciudadela.",
    );
  });
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx vitest run tests/asociate-wizard-client.test.ts`
Expected: FAIL en los cuatro primeros tests nuevos (el quinto ya pasa por la Task 3).

- [ ] **Step 3: `ChoiceCard.disabled`**

En `src/app/(public)/asociate/wizard-ui.tsx`, `ChoiceCard` pasa a:

```tsx
export function ChoiceCard({
  name,
  value,
  checked,
  onSelect,
  title,
  icon,
  aside,
  children,
  disabled = false,
}: {
  name: string;
  value: string;
  checked: boolean;
  onSelect: () => void;
  title: string;
  /** Chip decorativo a la izquierda del título. El dato es el título: el ícono
   *  va `aria-hidden` y la tarjeta se lee igual sin él. */
  icon?: React.ReactNode;
  aside?: React.ReactNode;
  children?: React.ReactNode;
  /** Visible pero no elegible (spec 2026-09-02): el radio NATIVO va `disabled`
   *  —no dispara `onChange`, así que el llamador no necesita otra guarda— y la
   *  tarjeta se atenúa. El `children` dice por qué. Prop opcional y aditiva:
   *  REEMPADRONATE y /mi/solicitudes también importan esta tarjeta y sin la
   *  prop nada cambia. */
  disabled?: boolean;
}) {
  return (
    <label
      className={cn(
        "flex items-start gap-3 rounded-xl border-2 p-4 transition-colors",
        // El foco vive en el radio nativo, que está adentro: sin `has-` el
        // recorrido con Tab no marcaría la tarjeta, que es lo que se ve.
        "has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50",
        disabled
          ? "cursor-not-allowed border-border opacity-60"
          : checked
            ? "cursor-pointer border-primary bg-primary/5"
            : "cursor-pointer border-border hover:bg-muted/50",
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={onSelect}
        className="mt-0.5 size-5 shrink-0 accent-primary"
      />
```

El resto del componente (ícono, título, `aside`, `children`) no cambia.

- [ ] **Step 4: El paso 2**

En `src/app/(public)/asociate/step-residence.tsx`:

Import de `wizard-shared` pasa a:

```ts
import {
  CONTROL_HEIGHT, COLLABORATOR_CLOSED_MESSAGE, streetLabel, type AsociateDraft, type StreetOption,
} from "./wizard-shared";
```

Props de `StepResidence`: agregar `collaboratorEnabled` en la destructuración y en el tipo:

```tsx
export function StepResidence({
  streets,
  collaboratorEnabled,
  draft,
  patch,
  error,
  onError,
  onNext,
}: {
  streets: StreetOption[];
  /** La llave `colaborador_habilitado` (spec 2026-09-02). Apagada, "En otro
   *  barrio" se muestra deshabilitada con el motivo: la categoría colaborador es
   *  del estatuto reformado y el sitio se lanza antes de la IGJ. La guarda real
   *  está en `createApplicationAction`; esto es display. */
  collaboratorEnabled: boolean;
  draft: AsociateDraft;
  patch: (values: Partial<AsociateDraft>) => void;
  error: string | null;
  onError: (message: string) => void;
  onNext: () => void;
}) {
```

La segunda `ChoiceCard` pasa a:

```tsx
          <ChoiceCard
            name="residence"
            value="no"
            checked={draft.livesInBarrio === "no"}
            onSelect={() => chooseBranch("no")}
            title="En otro barrio"
            disabled={!collaboratorEnabled}
          >
            {collaboratorEnabled
              ? "Podés solicitar el ingreso como socio colaborador."
              : COLLABORATOR_CLOSED_MESSAGE}
          </ChoiceCard>
```

`chooseBranch`, `next()` y el resto del paso no cambian: un radio deshabilitado no dispara `onChange`, y si un `draft.livesInBarrio === "no"` llegara por otro camino, la action lo rechaza (Task 3).

- [ ] **Step 5: La prop del wizard**

En `src/app/(public)/asociate/asociate-wizard.tsx`, las props de `AsociateWizard` (línea ~132) pasan a:

```tsx
export function AsociateWizard(props: {
  streets: StreetOption[];
  legal: LegalTexts;
  fees: FeeAmounts | null;
  siteKey: string;
  /** La llave `colaborador_habilitado` (spec 2026-09-02), leída cacheada por la
   *  página. Obligatoria a propósito —también en el retome, donde el paso 2 no
   *  se ve— para que ninguna página nueva la olvide. */
  collaboratorEnabled: boolean;
  /** Rehidratación desde /asociate/retomar/[token]: la solicitud ya existe y lo
   *  que decide la pantalla es su ESTADO, no el borrador. */
  initial?: {
    draft?: Partial<AsociateDraft>;
    resumeToken?: string;
    application?: ApplicationSnapshot;
  };
}) {
  const { streets, legal, fees, siteKey, collaboratorEnabled, initial } = props;
```

El render de `StepResidence` (línea ~436) pasa a:

```tsx
          <StepResidence
            streets={streets}
            collaboratorEnabled={collaboratorEnabled}
            draft={draft}
            patch={patch}
            error={localError}
            onError={setLocalError}
            onNext={() => goTo(3)}
          />
```

- [ ] **Step 6: Las dos páginas**

`src/app/(public)/asociate/page.tsx`, import:

```ts
import {
  getActiveReregistration, getAsociateActive, getCollaboratorEnabled, getLegalTexts,
} from "@/lib/config";
```

El `Promise.all` final:

```ts
  const [legal, fees, streets, collaboratorEnabled] = await Promise.all([
    getLegalTexts(),
    feeValueReader.current().then(feeAmountsForWizard),
    prisma.street.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, loadOrder: true },
    }),
    // La llave `colaborador_habilitado` (spec 2026-09-02): cacheada por tag como
    // el interruptor de ASOCIATE, porque esta página también es cacheada
    // (`revalidate = 3600` + `updateTag(CACHE_TAGS.config)` al guardar). La
    // GUARDA vive en `createApplicationAction` y lee directo.
    getCollaboratorEnabled(),
  ]);
```

Y el render:

```tsx
      <AsociateWizard
        streets={streets}
        legal={legal}
        fees={fees}
        collaboratorEnabled={collaboratorEnabled}
        siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ""}
      />
```

`src/app/(public)/asociate/retomar/[token]/page.tsx`, import de la línea 3:

```ts
import { getCollaboratorEnabled, getLegalTexts } from "@/lib/config";
```

El `Promise.all` (línea ~48):

```ts
  const [docs, legal, fees, collaboratorEnabled] = await Promise.all([
    prisma.document.findMany({
      where: { ownerType: "application", ownerId: app.id },
      select: { type: true },
    }),
    getLegalTexts(),
    feeValueReader.current().then(feeAmountsForWizard),
    // El retome entra en el paso 5 y no muestra el paso 2, pero la prop del
    // wizard es obligatoria (spec 2026-09-02): se pasa el valor real, no un
    // literal, para que esta página no mienta si el wizard cambia.
    getCollaboratorEnabled(),
  ]);
```

Y en el `<AsociateWizard …>` agregar `collaboratorEnabled={collaboratorEnabled}` después de `fees={fees}`.

- [ ] **Step 7: Correr los tests y el typecheck**

Run: `npx vitest run tests/asociate-wizard-client.test.ts tests/asociate-process-rail.test.ts && npx tsc --noEmit`
Expected: PASS y `tsc` sin errores (si `tsc` acusa otra página que renderiza `AsociateWizard` sin la prop, agregarla ahí con el mismo `getCollaboratorEnabled()`).

- [ ] **Step 8: Commit**

```bash
git add "src/app/(public)/asociate/wizard-ui.tsx" "src/app/(public)/asociate/step-residence.tsx" "src/app/(public)/asociate/asociate-wizard.tsx" "src/app/(public)/asociate/page.tsx" "src/app/(public)/asociate/retomar/[token]/page.tsx" tests/asociate-wizard-client.test.ts
git commit -m "feat(asociate): disable the other-barrio card while the collaborator switch is off

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: `/mi/solicitudes`: `requestableCategories` y la guarda del socio

**Files:**
- Modify: `src/lib/members/member-requests/rules.ts` (constante de la línea 14 y `canCreateRequest`)
- Modify: `src/lib/members/service.ts` (lector `collaboratorEnabled(db)` junto a `electionsOngoing`, línea ~31)
- Modify: `src/lib/members/member-requests/service.ts` (`Deps`, `create`, singleton)
- Modify: `src/app/mi/solicitudes/actions.ts` (import línea 17 y `categorySchema`, líneas ~74-83)
- Modify: `src/app/mi/solicitudes/page.tsx` (imports, `Promise.all`, prop de `CategoryRequestForm`)
- Modify: `src/app/mi/solicitudes/request-forms.tsx` (import línea 17, props de `CategoryRequestForm`, línea ~84)
- Test: `tests/member-requests-rules.test.ts`, `tests/member-requests-service.test.ts`, `tests/mi-solicitudes-actions.test.ts`

**Interfaces:**
- Consumes: `CONFIG_KEYS.collaboratorEnabled` (Task 1).
- Produces: `ALL_REQUESTABLE_CATEGORIES: readonly MemberCategory[]` (reemplaza a `REQUESTABLE_CATEGORIES`; forma del schema); `requestableCategories(collaboratorEnabled: boolean): readonly MemberCategory[]`; `canCreateRequest` exige `collaboratorEnabled: boolean` en su input; `collaboratorEnabled(db: Pick<PrismaClient, "configuration">): Promise<boolean>` en `@/lib/members/service`; `makeMemberRequests` exige `collaboratorEnabled: () => Promise<boolean>` en `Deps`; `CategoryRequestForm` exige `requestable: readonly MemberCategory[]`.

- [ ] **Step 1: Tests de la regla pura que fallan**

En `tests/member-requests-rules.test.ts`, el import pasa a:

```ts
import {
  canCreateRequest, renderWithdrawalText, requestableCategories,
} from "@/lib/members/member-requests/rules";
```

Todas las llamadas existentes a `canCreateRequest` ganan `collaboratorEnabled: true,` (el input pasa a exigirlo). Es mecánico: en cada objeto, después de la línea `pendingFees: N,` agregar `collaboratorEnabled: true,`. Ejemplo del primer test:

```ts
    const result = canCreateRequest({
      type: "withdrawal",
      member: { status: "active", category: "adherent" },
      requestedCategory: null,
      electionsOngoing: false,
      pendingFees: 0,
      collaboratorEnabled: true,
      hasPendingOfType: false,
    });
```

Después del test `it("blocks a category outside REQUESTABLE_CATEGORIES (e.g. cadet)", …)`, agregar:

```ts
  // The collaborator category belongs to the reformed statute, which the IGJ
  // has not approved yet (spec 2026-09-02): the switch decides whether it can
  // be requested, and the same function feeds the /mi/solicitudes cards.
  it("blocks requesting collaborator while colaborador_habilitado is off", () => {
    const result = canCreateRequest({
      type: "category_change",
      member: { status: "active", category: "adherent" },
      requestedCategory: "collaborator",
      electionsOngoing: false,
      pendingFees: 0,
      collaboratorEnabled: false,
      hasPendingOfType: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Por ahora no se puede pedir el pase a socio colaborador.");
  });

  it("allows requesting collaborator once the switch is on", () => {
    const result = canCreateRequest({
      type: "category_change",
      member: { status: "active", category: "adherent" },
      requestedCategory: "collaborator",
      electionsOngoing: false,
      pendingFees: 0,
      collaboratorEnabled: true,
      hasPendingOfType: false,
    });
    expect(result.ok).toBe(true);
  });

  it("a collaborator member asking for collaborator gets 'already your category', not the switch message", () => {
    const result = canCreateRequest({
      type: "category_change",
      member: { status: "active", category: "collaborator" },
      requestedCategory: "collaborator",
      electionsOngoing: false,
      pendingFees: 0,
      collaboratorEnabled: false,
      hasPendingOfType: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Esa ya es tu categoría.");
  });
});

describe("requestableCategories", () => {
  it("drops only collaborator while the switch is off", () => {
    expect(requestableCategories(false)).toEqual(["active", "adherent"]);
    expect(requestableCategories(true)).toEqual(["active", "adherent", "collaborator"]);
  });
});
```

(El `describe("canCreateRequest")` se cierra antes del `describe` nuevo: mover el `});` que hoy cierra el bloque para que quede después del test del socio colaborador.)

- [ ] **Step 2: Correr y ver que falla**

Run: `npx vitest run tests/member-requests-rules.test.ts`
Expected: FAIL — `requestableCategories is not a function` y el test "blocks requesting collaborator while … off" recibe `ok: true`.

- [ ] **Step 3: Implementar la regla**

En `src/lib/members/member-requests/rules.ts`, reemplazar la constante y su comentario (líneas ~11-14) por:

```ts
// Categorías que un socio puede pedir para sí mismo. `cadet` (menor sin cuota
// propia), `honorary` y `lifetime` las otorga la Comisión por acta, nunca a
// pedido: quedan fuera aunque figuren en `MemberCategory`. Esta lista es la
// FORMA que acepta el schema de la action; qué se ofrece de verdad lo decide
// `requestableCategories`, porque `collaborator` es del estatuto reformado y
// sólo se pide con la llave `colaborador_habilitado` prendida (spec 2026-09-02).
export const ALL_REQUESTABLE_CATEGORIES: readonly MemberCategory[] = ["active", "adherent", "collaborator"];

/** Las categorías que la pantalla ofrece y la regla acepta, decididas en UN
 *  solo lugar: con la llave apagada, colaborador no está. Lo que
 *  /mi/solicitudes no muestra es exactamente lo que `canCreateRequest`
 *  rechaza. */
export function requestableCategories(collaboratorEnabled: boolean): readonly MemberCategory[] {
  return collaboratorEnabled
    ? ALL_REQUESTABLE_CATEGORIES
    : ALL_REQUESTABLE_CATEGORIES.filter((c) => c !== "collaborator");
}
```

En `canCreateRequest`, el input y el bloque de `category_change` pasan a:

```ts
export function canCreateRequest(input: {
  type: MemberRequestType;
  member: { status: MemberStatus; category: MemberCategory };
  requestedCategory: MemberCategory | null; // solo category_change
  electionsOngoing: boolean; // solo category_change
  pendingFees: number; // solo category_change (REG-07)
  collaboratorEnabled: boolean; // solo category_change (spec 2026-09-02)
  hasPendingOfType: boolean;
}): RuleResult {
  const {
    type, member, requestedCategory, electionsOngoing, pendingFees, collaboratorEnabled, hasPendingOfType,
  } = input;
```

y, dentro de `if (type === "category_change") {`:

```ts
    if (requestedCategory === null || !ALL_REQUESTABLE_CATEGORIES.includes(requestedCategory)) {
      return { ok: false, error: "Elegí la categoría nueva." };
    }
    if (requestedCategory === member.category) {
      return { ok: false, error: "Esa ya es tu categoría." };
    }
    // La llave `colaborador_habilitado` (spec 2026-09-02): la MISMA función que
    // arma las tarjetas de /mi/solicitudes. Va después de "ya es tu categoría"
    // para que un colaborador existente reciba el mensaje que le corresponde.
    if (!requestableCategories(collaboratorEnabled).includes(requestedCategory)) {
      return { ok: false, error: "Por ahora no se puede pedir el pase a socio colaborador." };
    }
```

El resto (elecciones, deuda) no cambia.

- [ ] **Step 4: Correr, ver que pasa, y verificación por mutación**

Run: `npx vitest run tests/member-requests-rules.test.ts` → PASS.

Mutación: comentar el `if (!requestableCategories(collaboratorEnabled).includes(requestedCategory)) { … }` entero, correr de nuevo y confirmar que **falla** "blocks requesting collaborator while colaborador_habilitado is off". Restaurar y correr: PASS.

- [ ] **Step 5: El lector de dominio**

En `src/lib/members/service.ts`, después de `electionsOngoing` (línea ~34):

```ts
/** La llave `colaborador_habilitado` (spec 2026-09-02): la categoría es del
 *  estatuto reformado y se ofrece sólo cuando la IGJ lo oficialice. Misma
 *  lectura directa —sin la caché de las páginas públicas— y mismo criterio de
 *  `true` estricto que `electionsOngoing`: es una guarda, no display. */
export async function collaboratorEnabled(db: Pick<PrismaClient, "configuration">): Promise<boolean> {
  const row = await db.configuration.findUnique({ where: { key: CONFIG_KEYS.collaboratorEnabled } });
  return row?.value === true;
}
```

- [ ] **Step 6: Tests del servicio que fallan**

En `tests/member-requests-service.test.ts`:

El mock del módulo de dominio (línea 3) pasa a exportar también el lector nuevo:

```ts
vi.mock("@/lib/members/service", () => ({
  electionsOngoing: vi.fn(async () => false),
  collaboratorEnabled: vi.fn(async () => false),
}));
```

`fakeDb` acepta la llave y la inyecta:

```ts
function fakeDb(opts: { member: Member; electionsOngoing?: boolean; collaboratorEnabled?: boolean }) {
```

y, al final de `fakeDb`:

```ts
  const electionsOngoing = vi.fn(async () => opts.electionsOngoing ?? false);
  // Apagada por defecto: es el estado del lanzamiento (spec 2026-09-02) y lo
  // que un test que pide "active" o "adherent" no necesita tocar.
  const collaboratorEnabled = vi.fn(async () => opts.collaboratorEnabled ?? false);
  const service = makeMemberRequests({ db: db as never, electionsOngoing, collaboratorEnabled, now: () => NOW });
  return { service, db, tx, state, electionsOngoing, collaboratorEnabled };
```

Dentro de `describe("memberRequests.create", …)`, después de `it("crea una solicitud de cambio de categoría con su propio texto", …)`:

```ts
  it("con la llave colaborador_habilitado apagada, el pase a colaborador se rechaza con su mensaje", async () => {
    const { service, state, collaboratorEnabled } = fakeDb({ member: activeMember() });
    const r = await service.create({ memberId: 14, type: "category_change", requestedCategory: "collaborator" });
    expect(r).toEqual({ ok: false, error: "Por ahora no se puede pedir el pase a socio colaborador." });
    expect(state.requests).toHaveLength(0);
    // La llave se LEE (no se asume): un servicio que no la consultara pasaría
    // este test sólo porque el default del fake es "apagada".
    expect(collaboratorEnabled).toHaveBeenCalledTimes(1);
  });

  it("con la llave prendida, el pase a colaborador se crea con su texto", async () => {
    const { service, state } = fakeDb({ member: activeMember(), collaboratorEnabled: true });
    const r = await service.create({ memberId: 14, type: "category_change", requestedCategory: "collaborator" });
    expect(r).toEqual({ ok: true, requestId: 1 });
    expect(state.requests[0].text).toBe("Solicita el cambio de categoría de Adherente a Colaborador.");
  });
```

- [ ] **Step 7: Correr y ver que falla**

Run: `npx vitest run tests/member-requests-service.test.ts`
Expected: FAIL — `canCreateRequest` recibe `collaboratorEnabled: undefined` y el primer test nuevo obtiene `ok: true` (o el typecheck del fake acusa la dep que falta).

- [ ] **Step 8: Implementar en el servicio**

En `src/lib/members/member-requests/service.ts`:

Import del dominio (línea ~15):

```ts
import {
  collaboratorEnabled as checkCollaboratorEnabled,
  electionsOngoing as checkElectionsOngoing,
} from "@/lib/members/service";
```

`Deps`:

```ts
type Deps = {
  db: Pick<PrismaClient, "$transaction" | "memberRequest" | "member" | "fee" | "movement">;
  electionsOngoing: () => Promise<boolean>;
  /** La llave `colaborador_habilitado` (spec 2026-09-02), inyectada como
   *  `electionsOngoing`: bandera global de `Configuration`, no dato del socio. */
  collaboratorEnabled: () => Promise<boolean>;
  now?: () => Date;
};
```

En `create`, la lectura previa a la transacción pasa a:

```ts
      // No necesitan la foto de la transacción: son banderas globales de
      // `Configuration`, no datos del socio, mismo criterio que
      // `changeCategory` en `members/service.ts` (se leen antes de abrir la
      // transacción, no adentro).
      const [electionsAreOngoing, collaboratorIsEnabled] = await Promise.all([
        deps.electionsOngoing(),
        deps.collaboratorEnabled(),
      ]);
```

y el llamado a `canCreateRequest` suma la llave:

```ts
          const check = canCreateRequest({
            type: input.type,
            member: { status: member.status, category: member.category },
            requestedCategory,
            electionsOngoing: electionsAreOngoing,
            pendingFees,
            collaboratorEnabled: collaboratorIsEnabled,
            hasPendingOfType,
          });
```

El singleton del final:

```ts
export const memberRequests = makeMemberRequests({
  db: prisma,
  electionsOngoing: () => checkElectionsOngoing(prisma),
  collaboratorEnabled: () => checkCollaboratorEnabled(prisma),
});
```

- [ ] **Step 9: Correr y ver que pasa**

Run: `npx vitest run tests/member-requests-service.test.ts tests/member-requests-rules.test.ts`
Expected: PASS.

- [ ] **Step 10: La action y su test**

En `tests/mi-solicitudes-actions.test.ts`, dentro de `describe("createCategoryRequestAction", …)`, después de `it("rejects a category outside REQUESTABLE_CATEGORIES without touching the service", …)`:

```ts
  it("collaborator passes the schema: whether the switch allows it is the service's call", async () => {
    // The schema validates SHAPE against ALL_REQUESTABLE_CATEGORIES; the
    // colaborador_habilitado switch is read by the service (spec 2026-09-02),
    // so the action must forward the category and surface the service's text.
    create.mockResolvedValueOnce({ ok: false, error: "Por ahora no se puede pedir el pase a socio colaborador." });
    const r = await createCategoryRequestAction({}, fd({ requestedCategory: "collaborator" }));
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ requestedCategory: "collaborator" }));
    expect(r.error).toBe("Por ahora no se puede pedir el pase a socio colaborador.");
  });
```

No correr todavía: desde el Step 3 la action importa una constante que ya no existe (`REQUESTABLE_CATEGORIES`) y el archivo entero de test cae al cargar el módulo. Primero se corrige la action y después se corre.

En `src/app/mi/solicitudes/actions.ts`, el import de la línea 17 pasa a:

```ts
import { ALL_REQUESTABLE_CATEGORIES } from "@/lib/members/member-requests/rules";
```

y el schema (líneas ~74-83) a:

```ts
// ALL_REQUESTABLE_CATEGORIES es la FORMA que acepta el schema (rules.ts): el
// enum se arma desde ahí para que no puedan divergir. Si colaborador se puede
// pedir HOY lo decide el servicio con la llave `colaborador_habilitado` (spec
// 2026-09-02), y su mensaje llega tal cual. El cast es al tipo tupla que z.enum
// exige para inferir literales — el array en sí sigue viniendo de rules.ts.
const categorySchema = z.object({
  requestedCategory: z.enum(ALL_REQUESTABLE_CATEGORIES as [MemberCategory, ...MemberCategory[]], {
    error: "Elegí la categoría nueva.",
  }),
  message: messageSchema,
});
```

Run: `npx vitest run tests/mi-solicitudes-actions.test.ts` → PASS.

- [ ] **Step 11: La página y el formulario**

`src/app/mi/solicitudes/request-forms.tsx`: borrar el import `import { REQUESTABLE_CATEGORIES } from "@/lib/members/member-requests/rules";` y cambiar `CategoryRequestForm`:

```tsx
export function CategoryRequestForm({
  currentCategory,
  hasPending,
  requestable,
}: {
  currentCategory: MemberCategory;
  hasPending: boolean;
  /** Lo que la página armó con `requestableCategories(llave)`: con
   *  `colaborador_habilitado` apagada no viene colaborador (spec 2026-09-02).
   *  Display; la guarda real está en el servicio. */
  requestable: readonly MemberCategory[];
}) {
  const [state, formAction, pending] = useActionState<RequestState, FormData>(
    createCategoryRequestAction,
    {},
  );
  const options = requestable.filter((c) => c !== currentCategory);
```

`src/app/mi/solicitudes/page.tsx`: imports nuevos:

```ts
import { requestableCategories } from "@/lib/members/member-requests/rules";
import { collaboratorEnabled as readCollaboratorEnabled } from "@/lib/members/service";
```

El `Promise.all` pasa a leer la llave (directo: el panel no usa la caché de las páginas públicas):

```ts
  const [member, requests, collaboratorOn] = await Promise.all([
    prisma.member.findUniqueOrThrow({
      where: { id: actor.memberId },
      select: { category: true },
    }),
    prisma.memberRequest.findMany({
      where: { memberId: actor.memberId },
      orderBy: { id: "desc" },
      take: 20,
    }),
    readCollaboratorEnabled(prisma),
  ]);
```

y el render de `CategoryRequestForm`:

```tsx
          <CategoryRequestForm
            currentCategory={member.category}
            hasPending={requests.some((r) => r.type === "category_change" && r.status === "pending")}
            requestable={requestableCategories(collaboratorOn)}
          />
```

- [ ] **Step 12: Typecheck, lint y los tests que rozan el módulo**

Run: `npx tsc --noEmit && npm run lint && npx vitest run tests/member-requests-rules.test.ts tests/member-requests-service.test.ts tests/mi-solicitudes-actions.test.ts tests/member-actions.test.ts tests/member-category-mp.test.ts tests/solicitudes-socios-actions.test.ts`
Expected: sin errores y PASS. Si `tsc` acusa otro llamador de `canCreateRequest` o de `makeMemberRequests` que no aparece en este plan, agregarle `collaboratorEnabled` con el mismo criterio (lectura directa por `db`).

Además: `grep -rn "REQUESTABLE_CATEGORIES" src tests` tiene que devolver SÓLO `ALL_REQUESTABLE_CATEGORIES` (y los dos comentarios de test que nombran la constante vieja pueden quedar: describen el schema).

- [ ] **Step 13: Commit**

```bash
git add src/lib/members/member-requests/rules.ts src/lib/members/service.ts src/lib/members/member-requests/service.ts src/app/mi/solicitudes/actions.ts src/app/mi/solicitudes/page.tsx src/app/mi/solicitudes/request-forms.tsx tests/member-requests-rules.test.ts tests/member-requests-service.test.ts tests/mi-solicitudes-actions.test.ts
git commit -m "feat(mi): requestableCategories gates the collaborator request behind the switch

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Configuración → Sitio público: el switch y la tira de estado

**Files:**
- Modify: `src/app/admin/configuracion/config-form.tsx` (`ConfigFormInitial`, `GROUPS`, `AsociateSwitch` → `ConfigSwitch`, `initialValues`, render)
- Modify: `src/app/admin/configuracion/actions.ts` (comentario de cabecera, `schema`, `entries`)
- Modify: `src/app/admin/configuracion/page.tsx` (`Promise.all` de la línea ~45, `StatusStrip`, `configInitial`)
- Modify: `src/app/admin/configuracion/status-strip.tsx` (props, ítem nuevo, grilla)
- Test: `tests/config-actions.test.ts`

**Interfaces:**
- Consumes: `CONFIG_KEYS.collaboratorEnabled` (Task 1).
- Produces: `ConfigFormInitial.collaboratorEnabled: boolean`; `StatusStrip` exige `collaboratorEnabled: boolean`; `updateConfigAction` escribe la clave como boolean.

- [ ] **Step 1: Tests que fallan**

En `tests/config-actions.test.ts`:

`filled` suma la llave (el comentario de arriba pasa a decir "…prende el botón y la llave de colaborador…"):

```ts
const filled = {
  asociateActivo: "on",
  collaboratorEnabled: "on",
  contactPhone: "297 4 123456",
  contactEmail: "vecinal@ejemplo.com",
  termsText: "Términos y condiciones\n\n1. Primera cláusula.",
  privacyConsentText: "Consentimiento Ley 25.326\n\nSegundo párrafo.",
  mpPlanActiveId: "2c9380849abcd0001",
  mpPlanSharedId: "2c9380849abcd0002",
  digestRecipients: "comision@vecinal.ar",
};
```

`storedFilled` suma `[CONFIG_KEYS.collaboratorEnabled]: true,` después de `asociateActivo`.

En `it("escribe todas las claves con el superadmin en updated_by", …)`, después de la aserción de `asociateActivo`:

```ts
    expect(prismaMock.configuration.upsert).toHaveBeenCalledWith({
      where: { key: CONFIG_KEYS.collaboratorEnabled },
      update: { value: true, updatedBy: 3 },
      create: { key: CONFIG_KEYS.collaboratorEnabled, value: true, updatedBy: 3 },
    });
```

Después de `it("destildar el botón ASOCIATE guarda false, no la ausencia del campo", …)`:

```ts
  // La misma trampa del checkbox, para la llave de colaborador (spec
  // 2026-09-02): destildarla tiene que APAGAR la categoría, no "no tocarla".
  it("destildar la llave de colaborador guarda false, no la ausencia del campo", async () => {
    stored({ [CONFIG_KEYS.collaboratorEnabled]: true });
    await updateConfigAction({}, form({ asociateActivo: "on", contactPhone: "", contactEmail: "" }));
    expect(prismaMock.configuration.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: CONFIG_KEYS.collaboratorEnabled },
        update: { value: false, updatedBy: 3 },
      }),
    );
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: CONFIG_KEYS.collaboratorEnabled,
        detail: { from: true, to: false },
      }),
    );
  });

  it("rechaza un valor raro en la llave de colaborador en castellano", async () => {
    const result = await updateConfigAction({}, form({ ...filled, collaboratorEnabled: "yes" }));
    expect(result.error).toBe("Valor inválido para la llave de colaborador.");
    expect(prismaMock.configuration.upsert).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx vitest run tests/config-actions.test.ts`
Expected: FAIL — "escribe todas las claves" espera 9 upserts y ve 8; los dos tests nuevos fallan.

- [ ] **Step 3: La action**

En `src/app/admin/configuracion/actions.ts`:

El comentario de cabecera: "Hoy son ocho —el flag, …" pasa a "Hoy son nueve —el flag, la llave de la categoría colaborador (spec 2026-09-02), …".

En `schema`, después de `asociateActivo`:

```ts
  // La llave de la categoría colaborador (spec 2026-09-02): mismo checkbox
  // nativo con piel de switch que el interruptor de ASOCIATE, misma semántica
  // ("on" o nada; cualquier otro valor es un POST a mano).
  collaboratorEnabled: z.literal("on", { error: "Valor inválido para la llave de colaborador." }).optional(),
```

En `entries`, después de la fila de `asociateActivo`:

```ts
    [CONFIG_KEYS.collaboratorEnabled, parsed.data.collaboratorEnabled === "on"],
```

- [ ] **Step 4: Correr y ver que pasa**

Run: `npx vitest run tests/config-actions.test.ts tests/config-actions-auth.test.ts`
Expected: PASS.

- [ ] **Step 5: El formulario**

En `src/app/admin/configuracion/config-form.tsx`:

`ConfigFormInitial` suma `collaboratorEnabled: boolean;` después de `asociateActivo`.

`GROUPS`, pestaña "Sitio público": `keys: ["asociateActivo", "collaboratorEnabled", "contactPhone", "contactEmail"]`.

`AsociateSwitch` se generaliza (mismo markup, con el nombre y los textos como props) y se usa dos veces:

```tsx
// Un checkbox NATIVO con piel de switch (ver el comentario de cabecera sobre
// el reset de React 19). Genérico desde la llave de colaborador (spec
// 2026-09-02): el `name` es la clave del formulario y del `useSyncedForm`.
function ConfigSwitch({ name, checked, onChange, label, hint }: {
  name: string;
  checked: boolean;
  onChange: (on: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={name} className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium select-none">
        <input
          id={name}
          type="checkbox"
          role="switch"
          name={name}
          value="on"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="peer sr-only"
        />
        <span
          aria-hidden
          className="relative inline-flex h-6 w-10 shrink-0 rounded-full bg-muted ring-1 ring-inset ring-border transition-colors after:absolute after:left-0.5 after:top-0.5 after:size-5 after:rounded-full after:bg-background after:shadow-sm after:transition-transform peer-checked:bg-primary peer-checked:after:translate-x-4 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary"
        />
        {label}
      </label>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
```

`initialValues` suma `collaboratorEnabled: initial.collaboratorEnabled ? "on" : "",` después de `asociateActivo`.

En la `Card` de "Sitio público", el render del switch de ASOCIATE pasa a usar el componente genérico y se le suma el segundo:

```tsx
            <ConfigSwitch
              name="asociateActivo"
              checked={values.asociateActivo === "on"}
              onChange={(on) => setValue("asociateActivo", on ? "on" : "")}
              label="Botón ASOCIATE habilitado en el sitio público"
              hint="Apagado, el sitio muestra el aviso de asociaciones suspendidas. Se prende recién con el wizard del Módulo 3 funcionando."
            />
            <ConfigSwitch
              name="collaboratorEnabled"
              checked={values.collaboratorEnabled === "on"}
              onChange={(on) => setValue("collaboratorEnabled", on ? "on" : "")}
              label="Categoría socio colaborador habilitada (Art. 5 bis)"
              hint="Apagada, ASOCIATE sólo admite a quienes viven en el barrio y el socio no puede pedir el pase a colaborador. Prendela cuando la IGJ oficialice el estatuto reformado."
            />
```

- [ ] **Step 6: La página y la tira de estado**

`src/app/admin/configuracion/page.tsx`: el `Promise.all` de la configuración suma la llave (destructurar `collaboratorEnabled` después de `asociateActivo` y agregar `configReader.getBool(CONFIG_KEYS.collaboratorEnabled),` en la misma posición de la lista). Después:

```tsx
      <StatusStrip
        current={current}
        asociateActivo={asociateActivo}
        collaboratorEnabled={collaboratorEnabled}
        coverage={coverageEntries}
        digestCount={digestCount}
      />
```

y en `configInitial`, `collaboratorEnabled,` después de `asociateActivo,`.

`src/app/admin/configuracion/status-strip.tsx`: import de íconos `import { CalendarOff, Globe, Handshake, Mail, Wallet } from "lucide-react";`. El comentario "cuatro lecturas en vivo" pasa a "cinco lecturas en vivo". Props:

```tsx
export function StatusStrip({ current, asociateActivo, collaboratorEnabled, coverage, digestCount }: {
  current: CurrentFeeValue | null;
  asociateActivo: boolean;
  collaboratorEnabled: boolean;
  coverage: Array<[number, number]>;
  digestCount: number;
}) {
```

Ítem nuevo, inmediatamente después del de "Botón ASOCIATE":

```ts
    {
      href: "?tab=sitio",
      icon: Handshake,
      label: "Socio colaborador",
      value: collaboratorEnabled ? "Habilitado" : "Deshabilitado",
      // Nunca en warning: apagada es el estado esperado hasta que la IGJ
      // oficialice el estatuto reformado (spec 2026-09-02), y ninguna pantalla
      // nace en rojo.
      warning: false,
    },
```

La grilla pasa de cuatro a cinco tarjetas: `className="grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5"`.

- [ ] **Step 7: Typecheck, lint y tests**

Run: `npx tsc --noEmit && npm run lint && npx vitest run tests/config-actions.test.ts tests/config-tabs.test.ts`
Expected: sin errores y PASS.

- [ ] **Step 8: Commit**

```bash
git add src/app/admin/configuracion/config-form.tsx src/app/admin/configuracion/actions.ts src/app/admin/configuracion/page.tsx src/app/admin/configuracion/status-strip.tsx tests/config-actions.test.ts
git commit -m "feat(admin): collaborator switch in Configuración with its status row

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: El rótulo de `/mi/documentos` y la documentación

**Files:**
- Modify: `src/app/mi/documentos/page.tsx` (líneas ~80-93)
- Modify: `docs/02-marco-estatutario.md` (cabecera, líneas 3-5)
- Modify: `docs/05-flujos-funcionales.md` (§2 precondición línea 48; paso 2 líneas 98-102; paso 3 línea 115; §6 línea 454; §7 línea 515)
- Modify: `docs/07-plan-de-etapas.md` (checklist de Lanzamiento, líneas ~1318-1329)
- Modify: `CLAUDE.md` (bloque de `Configuration` después de la línea ~595; "Prioridad actual" antes de la línea 656)

- [ ] **Step 1: El rótulo**

En `src/app/mi/documentos/page.tsx`, el bloque del destacado pasa a:

```tsx
      {featured && (
        // El estatuto destacado, con el lenguaje visual de la credencial:
        // rounded-2xl + ring. Sobria y tipográfica — es un documento, no una
        // tarjeta de identidad. El eyebrow dice "Estatuto" y no "Norma
        // vigente" (spec 2026-09-02): el PDF cargado es el texto reformado,
        // pendiente de oficialización por la IGJ, y qué versión rige lo dice la
        // DESCRIPCIÓN del documento, que la Comisión edita desde /admin/documentos.
        <section
          aria-label="Estatuto"
          className="space-y-3 rounded-2xl bg-card p-5 ring-1 ring-foreground/10"
        >
          <p className="flex items-center gap-2 text-xs font-semibold tracking-widest text-primary uppercase">
            <ScrollText className="size-4" aria-hidden />
            Estatuto
          </p>
```

Verificar: `grep -rn "Norma vigente" src` no devuelve nada. Si algún test de fuente lo fijaba, actualizarlo al texto nuevo.

- [ ] **Step 2: `docs/02`**

Después del párrafo de la cabecera (línea 5, "…y se lanza cuando la IGJ apruebe (ver disposición transitoria, Art. 40)."), agregar:

```markdown
**Lanzamiento anticipado (02/09/2026):** el sitio se publica ANTES de la
oficialización con la única pieza que depende de la reforma apagada: la categoría
**socio colaborador** (Art. 5 bis) no se ofrece ni en ASOCIATE ni en
`/mi/solicitudes` mientras la llave `colaborador_habilitado` (tabla
`configuration`, switch de superadmin en Configuración → Sitio público) esté
apagada. Ausente en la base cuenta como apagada. Se prende a mano el día de la
oficialización. Spec: `docs/superpowers/specs/2026-09-02-colaborador-llave-design.md`.
```

- [ ] **Step 3: `docs/05`**

§2, precondición (línea 48) pasa a: `Precondición: `asociate_activo=true` y sin re-empadronamiento en curso. La rama "En otro barrio" (colaborador) exige además `colaborador_habilitado=true` (spec 2026-09-02).`

Paso 2, "Opción B" (línea 102) pasa a:

```markdown
- Opción B: "En otro barrio" → calle y barrio a mano (texto libre). Con la llave
  `colaborador_habilitado` apagada la tarjeta se muestra **deshabilitada** (radio
  nativo `disabled`) con el texto "Por ahora, la asociación en línea es sólo para
  quienes viven en el Barrio Ciudadela.", el mismo que devuelve
  `createApplicationAction` a un POST armado a mano (`categoryOfferedOnWeb`,
  que compone REG-01 con la llave; `categoryAllowedForResidence` queda intacta
  para el panel).
```

Paso 3 (línea 115), agregar al final del ítem "Si otro barrio: …": ` Sólo alcanzable con `colaborador_habilitado=true`.`

§6 Configuración (línea 454): después de "interruptor de ASOCIATE (`asociate_activo`)," agregar "la llave de la categoría colaborador (`colaborador_habilitado`, spec 2026-09-02; en la tira de estado sin advertencia porque apagada es lo esperado hasta la IGJ),".

§7 (línea 515), agregar al ítem de "solicitar cambio de categoría": ` Las categorías ofrecidas salen de `requestableCategories(llave)`: con `colaborador_habilitado` apagada no se ofrece ni se acepta Colaborador ("Por ahora no se puede pedir el pase a socio colaborador.").`

- [ ] **Step 4: `docs/07`**

En el checklist de "Lanzamiento (cuando IGJ oficialice)", después de "activar `asociate_activo`" agregar: "→ **prender `colaborador_habilitado`** en `/admin/configuracion` (la categoría colaborador es de la reforma; hasta ahí el sitio corre con la rama de otro barrio deshabilitada, spec 2026-09-02) → **actualizar la descripción del estatuto** en `/admin/documentos` (el PDF es el texto reformado)".

- [ ] **Step 5: `CLAUDE.md`**

Después del párrafo de `digest_recipients` (línea ~595-598), agregar:

```markdown
Y para **`colaborador_habilitado`** (02/09/2026): la categoría socio colaborador
es del estatuto reformado, pendiente de la IGJ, y el sitio se lanza antes. Con la
llave apagada —ausente cuenta como apagada— ASOCIATE deshabilita "En otro barrio"
y `/mi/solicitudes` no ofrece Colaborador; las guardas leen directo
(`categoryOfferedOnWeb`, `requestableCategories`) y las pantallas de admin no
cambian. Se prende desde `/admin/configuracion` el día de la oficialización.
```

En "Prioridad actual", antes de "No arrancar una fase…", agregar:

```markdown
La **llave `colaborador_habilitado`** (02/09/2026) está implementada en la rama
`collaborator-switch` para lanzar antes de la IGJ: cierra la rama "En otro
barrio" de ASOCIATE y el pase a colaborador desde `/mi/solicitudes`, y
`/mi/documentos` ya no rotula el estatuto reformado como "Norma vigente". Sin
migración ni variable nueva. Queda pendiente el pase de copy que cita artículos
de la reforma (spec 2026-09-02 §9), a cotejar contra el estatuto anterior.
```

- [ ] **Step 6: Commit**

```bash
git add src/app/mi/documentos/page.tsx docs/02-marco-estatutario.md docs/05-flujos-funcionales.md docs/07-plan-de-etapas.md CLAUDE.md
git commit -m "docs: collaborator switch across spec docs; /mi/documentos no longer labels the reformed statute as in force

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Verificación y auditoría (OBLIGATORIA — pedido del operador)

No se declara terminado el trabajo sin pasar TODOS estos puntos y anotar el resultado real de cada uno. Si algo falla, se arregla y se vuelve a correr desde el punto 1.

**Files:** ninguno nuevo; se escribe el informe en `.superpowers/sdd/colaborador-llave-verificacion.md`.

- [ ] **Step 1: La suite entera, el typecheck y el lint**

```bash
npm test 2>&1 | tail -20
```
Expected: `Test Files  N passed`, `Tests  M passed`, 0 failed. Anotar N y M, y compararlos con `main` (`git stash`-free: correr `git checkout main && npm test | tail -5 && git checkout collaborator-switch` si hace falta el número de referencia). M tiene que ser mayor que en `main` en exactamente la cantidad de tests agregados: **22** (3 en config, 3 en wizard, 2 en create-action, 5 en wizard-client, 4 en member-requests-rules incluido el de `requestableCategories`, 2 en member-requests-service, 1 en mi-solicitudes-actions, 2 en config-actions). Si el número no cierra, listar qué test falta o sobra.

```bash
npx tsc --noEmit && npm run lint
```
Expected: sin salida de error en ninguno.

- [ ] **Step 2: El build de producción**

```bash
npm run build 2>&1 | tail -30
```
Expected: build en verde, sin warnings nuevos sobre `/asociate`, `/asociate/retomar/[token]`, `/mi/solicitudes`, `/mi/documentos` ni `/admin/configuracion`. (Reiniciar el dev server después, porque el build pisa `.next`.)

- [ ] **Step 3: Auditoría del diff**

```bash
git diff --stat main..HEAD
git diff --stat main..HEAD -- src/lib/treasury src/lib/mp prisma src/app/admin/tesoreria src/app/api/webhooks src/app/api/cron src/lib/cron src/app/mi/debito src/app/mi/pagar src/app/api/mi src/app/api/admin/recibos src/lib/members/withdraw-with-debits.ts src/lib/members/debit-adhesion.ts src/lib/members/member-debit.ts
git diff main..HEAD | grep "^+" | grep -v "^+++ " | grep -i -E "preapproval|mercadopago|mpPaymentId|registerPayment|makeMpGateway|allocate\(|receipt"
```
Expected: la segunda línea VACÍA (ni tesorería, ni MP, ni migraciones, ni webhook, ni cron, ni recibos, ni débito del socio) y la tercera VACÍA (ninguna línea agregada nombra una pieza del circuito de pagos o suscripciones). Pedido explícito del operador (02/09/2026): no tocar ni romper nada de tesorería, Mercado Pago, pagos y suscripciones. La primera lista SÓLO estos archivos, y ninguno más:

```
CLAUDE.md
docs/02-marco-estatutario.md
docs/05-flujos-funcionales.md
docs/07-plan-de-etapas.md
docs/superpowers/plans/2026-09-02-colaborador-llave.md
docs/superpowers/specs/2026-09-02-colaborador-llave-design.md
src/app/(public)/asociate/actions.ts
src/app/(public)/asociate/asociate-wizard.tsx
src/app/(public)/asociate/page.tsx
src/app/(public)/asociate/retomar/[token]/page.tsx
src/app/(public)/asociate/step-residence.tsx
src/app/(public)/asociate/wizard-shared.ts
src/app/(public)/asociate/wizard-ui.tsx
src/app/admin/configuracion/actions.ts
src/app/admin/configuracion/config-form.tsx
src/app/admin/configuracion/page.tsx
src/app/admin/configuracion/status-strip.tsx
src/app/mi/documentos/page.tsx
src/app/mi/solicitudes/actions.ts
src/app/mi/solicitudes/page.tsx
src/app/mi/solicitudes/request-forms.tsx
src/lib/applications/wizard.ts
src/lib/config-keys.ts
src/lib/config.ts
src/lib/members/member-requests/rules.ts
src/lib/members/member-requests/service.ts
src/lib/members/service.ts
tests/application-wizard.test.ts
tests/asociate-wizard-client.test.ts
tests/config-actions.test.ts
tests/config.test.ts
tests/create-application-action.test.ts
tests/member-requests-rules.test.ts
tests/member-requests-service.test.ts
tests/mi-solicitudes-actions.test.ts
```

Un archivo fuera de esta lista es un desvío del plan: justificarlo en el informe o revertirlo.

Chequeos de texto:

```bash
grep -rn "Norma vigente" src
grep -rn "REQUESTABLE_CATEGORIES" src | grep -v ALL_REQUESTABLE_CATEGORIES
grep -rn "categoryAllowedForResidence(" src
```
Expected: los dos primeros vacíos; el tercero muestra los llamadores del panel intactos (`admin/solicitudes/actions.ts`, `admin/solicitudes/page.tsx`, `admin/solicitudes/[id]/decision-forms.tsx`, `lib/applications/query.ts`) más `asociate/actions.ts` (el mensaje por causa) y `lib/applications/wizard.ts` (la composición). Ninguno con un tercer argumento.

- [ ] **Step 4: Revisión de código**

Pedir una revisión con la skill `superpowers:requesting-code-review` sobre `git diff main..HEAD`, con la spec y este plan como contexto. Cada hallazgo se responde con `superpowers:receiving-code-review` (verificar antes de aplicar). Los hallazgos que se apliquen van en un commit `fix:` propio.

- [ ] **Step 5: Verificación en el navegador, con la llave en los DOS estados**

Levantar el dev server con `preview_start` (`name: "sigev-dev"`, puerto 3000). Antes de empezar, confirmar el estado de la llave en la base local (`SELECT * FROM configuration WHERE \`key\`='colaborador_habilitado';` debería no devolver fila).

Llave apagada (ausente):
1. `/asociate` → paso 1 con un DNI desconocido → paso 2: la tarjeta "En otro barrio" se ve atenuada, con el texto "Por ahora, la asociación en línea es sólo para quienes viven en el Barrio Ciudadela.", y un clic sobre ella NO la selecciona ni muestra los campos de calle/barrio. "En el Barrio Ciudadela" funciona como siempre. Captura de pantalla.
2. `/admin/configuracion` (superadmin) → pestaña Sitio público: el switch "Categoría socio colaborador habilitada (Art. 5 bis)" apagado; la tira de estado dice "Socio colaborador · Deshabilitado" **sin** color de advertencia. Captura.
3. `/mi/solicitudes` (un socio adherente de prueba) → "Cambio de categoría" ofrece sólo "Activo". Captura.
4. `/mi/documentos` → el destacado dice "Estatuto", no "Norma vigente". Captura.

Prender la llave desde `/admin/configuracion` y guardar (sin reiniciar nada):
5. `/asociate` → paso 2: "En otro barrio" habilitada con "Podés solicitar el ingreso como socio colaborador."; elegirla muestra calle y barrio; el paso 3 muestra la tarjeta de colaborador. Captura.
6. `/mi/solicitudes` → ofrece "Activo" y "Colaborador". Captura.
7. La tira de estado dice "Habilitado".

Apagar la llave otra vez y guardar; repetir el punto 1 para confirmar que la página cacheada volvió a cambiar sin deploy. Dejar la base local con la llave APAGADA (es el estado del lanzamiento).

Revisar `read_console_messages` y `preview_logs` después de cada pantalla: ningún error nuevo.

- [ ] **Step 6: El informe**

Escribir `.superpowers/sdd/colaborador-llave-verificacion.md` con: fecha, commit de `main` de base y último de la rama, salida resumida de `npm test` (N/M y la comparación con `main`), `tsc`, `lint`, `build`, el `git diff --stat` completo, el resultado de los tres `grep`, los hallazgos de la revisión y qué se hizo con cada uno, y la lista de las siete verificaciones del navegador con OK/FALLA y el nombre de cada captura. **Si algo quedó en FALLA, el módulo no está cerrado**: decirlo así en el informe y en el mensaje final al operador.

```bash
git add .superpowers/sdd/colaborador-llave-verificacion.md
git commit -m "chore: verification report for the collaborator switch

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 7: Cierre**

Invocar `superpowers:finishing-a-development-branch`. El merge a `main` y el `git push` los decide y ejecuta el operador (memoria: el push lo corre Mariano). Despliegue: sin migración ni variable nueva, es `git pull` → `npm run build` → `pm2 restart` según `docs/10`; el operador lo hace por SSH.
