# Padrón electoral: rediseño visual, bloque de no habilitados por antigüedad y export a Excel

**Fecha:** 27/08/2026 · **Estado:** aprobado por el operador (3 rondas de decisiones, mismo día)
**Alcance:** `/admin/padron-electoral`, su dominio (`src/lib/members/electoral.ts`), su export y dos arreglos chicos en `/mi`.

---

## 1. Objetivo

Tres cosas, y nada más:

1. **Rediseño visual total de la pantalla** con el lenguaje del panel que estrenaron los
   Módulos 4 y 5 (Cards, secciones, íconos lucide, stat cards, dual tabla/cards en móvil).
   La pantalla actual es "de la era anterior a las tarjetas": usa `PageHeader` y los
   tokens correctos, pero organiza con `div`/`section` y bordes crudos.
2. **Un único cambio de fondo:** los socios que no alcanzan los 90 días de antigüedad
   (REG-30) dejan de ser un contador (`withoutSeniority: number`) y pasan a ser una
   **lista con nombre**, el tercer bloque del padrón. La regla ya está implementada y
   testeada; el cambio es exponer las filas que hoy se descartan.
3. **Export a Excel** (.xlsx) que **reemplaza** al CSV. REG-31 pide textualmente
   "Excel/PDF"; el CSV fue una divergencia deliberada (anotada en `route.ts:1-3`) que
   esta tarea cierra. ExcelJS ya es dependencia de producción con dos exports .xlsx
   como molde (`padron-export`, `resumen-export`).

### Qué NO cambia

- **Nada de plata.** Ni `registerPayment`, ni `src/lib/treasury/*`, ni `src/lib/mp/*`.
  El padrón solo LEE cuotas (`fee.groupBy`) y el valor vigente, igual que hoy.
- Las reglas del padrón: universo (`status: "active"` + categorías votantes, sin cadete,
  sin suspendido), exención de honorarios/vitalicios, mora sobre períodos anteriores,
  la enmienda del 23/08 (el moroso se lista, no se excluye), `compareForRoll`.
- La fecha sigue siendo un parámetro de URL (`?fecha=`) con default hoy (día civil).
  **No** se guarda fecha de elección en `Configuration` (decisión del 27/08).
- El flag "Hay elecciones en curso" (`ElectionsFlagForm`, `setElectionsFlagAction`):
  misma lógica y misma action, solo cambia el envoltorio visual.
- Los dos asientos de auditoría (`electoral_roll_generated` al renderizar,
  `electoral_roll_export` al descargar) y su semántica.
- `requireSuperadmin` en pantalla y route, con pantalla de bloqueo (no redirect).

---

## 2. Decisiones del operador (27/08/2026)

| # | Decisión |
|---|----------|
| 1 | El bloque nuevo aparece **en todos lados**: pantalla, Excel e impresión. La Junta recibe también la lista de excluidos con su fecha de ingreso — útil si alguien se presenta a votar y hay que mostrarle por qué no figura. |
| 2 | El Excel **reemplaza** al CSV: un solo botón "Exportar Excel". El endpoint conserva su path y pasa a servir .xlsx; `electoralCsv` y su ceremonia (BOM, CRLF, neutralización de fórmulas) se retiran. |
| 3 | **Días faltantes: solo en el bloque nuevo**, expresados como **"Habilitado desde el DD/MM/AAAA"** (ingreso + 90 días). La decisión del 24/08 ("el padrón no lleva columna de días") queda **intacta para los bloques de habilitados**, donde el número es redundante; en el bloque de excluidos la cuenta es la razón de la exclusión. |
| 4 | Excel con **una hoja por bloque** (precedente: `resumen-export`, 3 hojas). Con fecha de ingreso (como la hoja impresa) y montos como **número nativo** con formato moneda. |
| 5 | Pantalla de **página única**: Card generadora + la igualdad verificable elevada a stat cards clickeables + tres secciones de bloque. Sin pestañas. |
| 6 | Listas en móvil: **dual** — tabla en desktop (y para imprimir), Cards apiladas en `<md` (patrón de `/admin/socios`). |
| 7 | Se suman los dos arreglos del dominio detectados en el análisis: el **día civil en `/mi`** y **compartir la condición de mora** entre padrón y credencial (lección `coverageFloor`). |
| 8 | Título del bloque nuevo: **"No habilitados por antigüedad"** ("Sin antigüedad" es engañoso: un socio de 40 días tiene antigüedad, solo que insuficiente). |
| 9 | Los botones **Exportar Excel** e **Imprimir** viven en la **Card generadora**, junto a la fecha: lo que se exporta es el padrón A ESA FECHA, y la dependencia queda visible. Aparecen solo cuando hay padrón generado. |
| 10 | **Sin DNI** en ninguna salida (pantalla, papel, Excel). Lo fijan REG-31 (columnas: nombre, número, categoría) y el principio de pertinencia de la Ley 25.326; ya está decidido y comentado en `electoral.ts:230-238`. |

---

## 3. Dominio — `src/lib/members/electoral.ts`

### 3.1 El contador pasa a lista

`ElectoralRoll.withoutSeniority` cambia de `number` a `ElectoralRow[]`. En
`buildElectoralRoll`, donde hoy se filtra y descarta (`electoral.ts:164`), se
**particiona**:

- Las filas no elegibles conservan el orden que ya traen (la consulta ordena y
  `compareForRoll` ya corrió sobre `rows`; un `.filter()` preserva el orden — no se
  re-ordena nada).
- Sus `ElectoralRow` llevan `arrears: 0, debt: null`: la mora **no se consulta** para
  ellos. La consulta `fee.groupBy` sigue pidiéndose **solo para los elegibles**
  (`ids = eligible.map(...)`), y el test existente que verifica que con el padrón
  entero fuera de antigüedad no se le pregunta la deuda a nadie
  (`members-electoral.test.ts:283-287`) tiene que seguir en verde.
- La identidad verificable se mantiene con `.length`:
  `considered = enabled.length + toPurge.length + withoutSeniority.length`.
- El nombre interno `withoutSeniority` **no cambia** (es el término del código); la
  etiqueta de UI es "No habilitados por antigüedad".

### 3.2 Función nueva: `enabledFrom`

```ts
/** El día en que cumple los 90: ingreso + ELECTORAL_MIN_DAYS días. Ambos extremos
 *  viven a mediodía UTC (civilDateUtc), así que la suma cae exacta en el día civil
 *  argentino correcto. */
export function enabledFrom(joinedAt: Date): Date;
```

Implementación: `new Date(joinedAt.getTime() + ELECTORAL_MIN_DAYS * 86_400_000)`.
Coherente con `isEligibleBySeniority` (`>= 90`): el día que devuelve es el **primero**
en que el socio ya puede votar. Alimenta la columna "Habilitado desde" en pantalla,
papel y Excel. Borde testeado: para un ingreso D, `enabledFrom` cae en D+90 y
`meetsSeniority(cat, D, D+90) === true` (los dos lados de la misma moneda).

### 3.3 Función nueva compartida: `mustPurgeToVote`

```ts
/** "Sin mora" es requisito sólo de activos y colaboradores (REG-31): el aporte del
 *  adherente es voluntario y su deuda no le quita el voto; honorarios y vitalicios
 *  no devengan. */
export function mustPurgeToVote(category: MemberCategory, arrears: number): boolean;
```

Reemplaza las **dos copias** de la expresión
`arrears > 0 && ACCRUING_CATEGORIES.includes(category)`:

- `buildElectoralRoll` (`electoral.ts:196`) la usa para partir enabled/toPurge.
- `electoralStatusFor` (`mi/identity.ts:45`) la usa para la rama `arrears` — y de paso
  desaparece el cast `as readonly MemberCategory[]`.

Resultado **byte-idéntico** en ambos consumidores (misma tabla de verdad); es la lección
`coverageFloor`: compartir la función, no copiarla. Test por tabla de casos
(categoría × arrears) y verificación de que ambos call-sites la importan (por mutación:
borrar la guarda y ver el test en rojo).

### 3.4 Se retira el CSV

`electoralCsv`, `cell`, `FORMULA_LEAD` y `CSV_HEADER` (`electoral.ts:212-263`) se
eliminan. La neutralización de fórmulas y el BOM/CRLF son ceremonia específica de CSV:
en .xlsx una celda de string es un shared string y Excel no la reinterpreta — copiar el
apóstrofo sería un bug visible (`'=Pérez` literal en la hoja).

### 3.5 Builder puro del Excel

Nuevo módulo de datos, sin ExcelJS ni Prisma (patrón `members/export.ts`, para poder
testearlo sin `.env` y sin workbook):

```ts
export type ElectoralSheetSpec = {
  name: string;                       // nombre de la hoja (≤31 chars, sin : \ / ? * [ ])
  columns: { header: string; key: string; width: number; numFmt?: string }[];
  rows: Record<string, string | number | Date | null>[];
  totals?: Record<string, string | number>; // fila de total (solo "Con deuda a purgar")
};
export function electoralWorkbookSpec(roll: ElectoralRoll): ElectoralSheetSpec[];
```

Vive en un módulo hermano `src/lib/members/electoral-export.ts` (espejo del patrón
`members/export.ts`: `electoral.ts` queda como módulo de reglas, el export como módulo
de presentación de datos). Tres hojas, **en el orden de la pantalla**:

| Hoja | Columnas |
|------|----------|
| `Habilitados` | N° socio (número), Apellido y nombre, Categoría (etiqueta es-AR de `CATEGORY_LABELS`, no el enum), Ingreso (Date, `numFmt: "dd/mm/yyyy"`) |
| `Con deuda a purgar` | las cuatro comunes + Cuotas (número) + A purgar (número, `numFmt` moneda `"$" #,##0.00`) + fila de total (Total a purgar: `purgeFees`, `purgeAmount`) |
| `No habilitados por antigüedad` | las cuatro comunes + Habilitado desde (Date, `numFmt: "dd/mm/yyyy"`) |

Reglas heredadas de los moldes:

- **La hoja vacía se crea igual**, con solo el encabezado: una hoja faltante parece un
  error de exportación; una con encabezado informa que la lista está vacía
  (`resumen-export`).
- **Fechas nativas, no texto**: `joinedAt` ya es fecha civil a mediodía UTC — no se
  re-ancla (`members/export.ts:17-22`).
- `memberNumber === null` → celda vacía (el guión es cosa de la pantalla).
- `debt === null` (sin valor de cuota vigente) → celda vacía, nunca un cero.
- Encabezado en negrita (`ws.getRow(1).font = { bold: true }`), como los dos moldes.
- **Sin DNI, sin email, sin domicilio** (decisión 10) — con test que serializa el
  workbook y lo afirma.

---

## 4. Export — `src/app/api/admin/padron-electoral/route.ts`

Mismo path, mismo método, mismas guardas y validación (en este orden, como hoy):
`requireSuperadmin` → 403 sin tocar la base; regex de forma + `parseCivilDate(raw,
{ minYear: 2020 })` → 400 **antes** de consultar y de auditar.

Cambia la salida:

```
Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
Content-Disposition: attachment; filename="padron-electoral-{fecha}.xlsx"
Cache-Control: no-store, private
Vary: Cookie
```

La route mapea `electoralWorkbookSpec(roll)` a ExcelJS (`wb.addWorksheet` +
`ws.columns` + `ws.addRow`) y devuelve `await wb.xlsx.writeBuffer()`. Sin streaming
(160 filas; mismo criterio que los PDFs).

**Auditoría:** sigue `electoral_roll_export`, con el conteo nuevo en el detail:
`{ at, enabled, toPurge, purgeFees, withoutSeniority }` — metadatos y conteos, **nunca
una fila ni un nombre** (regla verificada por test hoy, se mantiene). El asiento de la
pantalla (`electoral_roll_generated`, en `page.tsx`) suma el mismo campo. IP desde
`x-real-ip`, como todos.

---

## 5. La pantalla — `src/app/admin/padron-electoral/page.tsx` + componentes

Contenedor `space-y-6`. De arriba hacia abajo:

### 5.1 PageHeader

`title="Padrón electoral"`, sin breadcrumb (sección de primer nivel), **sin `actions`**
(se mudan a la Card generadora, decisión 9). `children`: el párrafo normativo actual
(90 días, REG-30/31), ajustado para nombrar los **tres** bloques.

### 5.2 Card generadora (`print:hidden`)

`Card` con título "Generar padrón". Adentro:

- El form GET actual (`<Input type="date" name="fecha">` + botón "Generar"), con
  `aria-label`, `min-h-11` y el default `isoToday()` (día civil) como hoy.
- Cuando hay padrón generado, la fila de salidas: **"Exportar Excel"**
  (`Button asChild variant="outline"` sobre `<a href="/api/admin/padron-electoral?fecha=…">`,
  con ícono `FileSpreadsheet`) y **`PrintButton`** (componente compartido, sin tocar).
- La fecha generada visible en la Card ("Padrón al DD/MM/AAAA"), para que quede claro
  qué se exporta.

### 5.3 La firma visual: la igualdad como tira de stat cards

La ecuación `considerados = habilitados + a purgar + no habilitados` deja de ser una
frase y pasa a ser **cuatro stat cards conectadas por los signos `=` y `+` visibles**
(`print:hidden`; en papel la cuenta ya la dice la cabecera de la hoja).

- Cada tarjeta: icon chip del tablero (`flex size-9 items-center justify-center
  rounded-lg bg-primary/10 text-primary`), número grande `font-mono text-3xl
  tabular-nums`, etiqueta `text-sm text-muted-foreground`.
- Íconos lucide: considerados `Users` · habilitados `Vote` · con deuda a purgar
  `Wallet` · no habilitados `CalendarClock`. Todos `aria-hidden`.
- Las tres tarjetas de bloque son **anclas** a su sección (`#habilitados`,
  `#a-purgar`, `#no-habilitados`, con `scroll-mt-4` en el destino), con el patrón
  full-card link del tablero (pseudo-elemento, anillo de foco inset). La de
  "considerados" no es un bloque: no navega.
- **Contador en cero se apaga** (chip `bg-muted text-muted-foreground`, sin énfasis):
  regla anti-ruido de la 4C.
- Los signos: `span` `aria-hidden` en `font-mono text-2xl text-muted-foreground`,
  ocultos en `<sm` (las tarjetas apilan en `grid grid-cols-2 sm:flex`); la igualdad
  completa la enuncia una frase `sr-only` para lectores de pantalla.
- Si hay purga: la línea "A purgar en la mesa: N cuotas · $ X" queda como caption bajo
  la tira (con `NUM`), como hoy.

### 5.4 Los tres bloques

Cada uno es un `<section id aria-labelledby>` con el `h2` de la casa
(`text-sm font-semibold tracking-widest text-muted-foreground uppercase`) y su
contenido en `Card`. Orden: **Habilitados → Con deuda a purgar → No habilitados por
antigüedad**.

Presentación dual (decisión 6, molde `socios/page.tsx:267-316`):

- **Tabla** (`hidden md:block print:block`): la misma que se imprime. Columnas como
  hoy; el bloque 2 conserva su `TableFooter` de total; el bloque 3 lleva
  N° · Socio · Categoría · Ingreso · **Habilitado desde**.
- **Cards apiladas** (`md:hidden print:hidden`): una `Card size="sm"` por socio —
  N° + nombre en `font-medium`, y una fila `flex-wrap` de metadatos en
  `text-sm text-muted-foreground` (categoría · ingreso; el bloque 2 suma cuotas y
  monto con `NUM`; el 3 suma "habilitado desde").
- **Estado vacío** por bloque (`EmptyState size="card"`): los dos actuales se
  conservan; el del bloque 3 es la buena noticia — *"Todos los socios considerados
  alcanzan los 90 días de antigüedad."*
- La nota del bloque 3 (se imprime, `FormMessage kind="neutral" box role="none"`):
  *"No alcanzan los 90 días de antigüedad a la fecha de la elección (REG-30). No votan
  en este acto, y no hay trámite que lo modifique: la antigüedad se cumple con el
  tiempo."* — el espejo de la nota del bloque 2 ("no está excluido…"): aquel existe
  porque hay algo que hacer; éste porque no lo hay, y si la Junta lo lee como "otra
  lista que puede regularizar", el error es peor que no imprimirlo.

### 5.5 Card del flag

"Hay elecciones en curso" pasa del `<section className="max-w-2xl rounded-lg border
p-4">` crudo a una `Card` con título propio, al final de la página (`print:hidden`).
`ElectionsFlagForm` y su action **no se tocan**.

### 5.6 Impresión — `roll-sheet.tsx`

- La hoja imprime los **tres bloques** (decisión 1), con la cabecera de papel
  actualizada: conteos de los tres + "generado el…", y la nota de orden como hoy.
- El aviso de `pastDate` se re-redacta apenas: la antigüedad se mide a la fecha
  pedida; la mora **y la condición de socio** se leen al generar — un socio del bloque
  3 que se dio de baja después tampoco figura. Sigue imprimiéndose (sin
  `print:hidden`), porque es la advertencia de que la hoja no resuelve impugnaciones.
- `PAGE_CSS` (A4 portrait, último hijo), `break-inside-avoid` por fila y
  `break-after-avoid-page` en encabezados: sin cambios.

### 5.7 Accesibilidad (no romper)

Targets `min-h-11`, `outline-hidden` + `focus-visible:ring-2 focus-visible:ring-ring`,
`aria-current` no aplica (no hay tabs), anclas con `scroll-mt-4`, íconos decorativos
`aria-hidden`, columnas sin título visible con `sr-only` en un `<span>` interno, y los
`FormMessage` con `kind` correcto (`role="none"` solo para estado de pantalla).

---

## 6. Los dos arreglos de `/mi` (decisión 7)

1. **Día civil:** `src/app/mi/page.tsx:118` pasa de `at: new Date()` a
   `at: civilDayOf()`. Sin esto, entre las 00:00 y las 08:59 AR del día 90 la
   credencial dice "te falta 1 día" a quien ya cumple (misma clase de bug que
   `feeValueReader.current()` y `parseMinuteDate` ya corrigieron).
2. **Mora compartida:** `mi/identity.ts:45` usa `mustPurgeToVote` (§3.3). El resultado
   de `electoralStatusFor` es byte-idéntico; el cast desaparece.

---

## 7. Tests

Se actualizan las suites existentes; las guardas se verifican **por mutación** (regla
del proyecto: borrar la guarda y ver el test en rojo, después restaurar).

| Suite | Qué cambia |
|-------|-----------|
| `tests/members-electoral.test.ts` | `withoutSeniority` como lista (contenido, orden preservado, `arrears: 0`/`debt: null`); la identidad con `.length`; `enabledFrom` (borde D+90); `mustPurgeToVote` por tabla; **se conserva** el test de "no consulta mora para inelegibles". |
| `tests/padron-electoral-screen.test.ts` | Tres bloques renderizados con sus títulos y columnas (el 3 con "Habilitado desde"); la tira de la igualdad con los cuatro números; estados vacíos; Card generadora con Exportar Excel/Imprimir solo con padrón generado; el bloqueo por rol y la fecha inválida como hoy. |
| `tests/padron-electoral-route.test.ts` | Deja de afirmar CSV: parsea el buffer con ExcelJS y verifica los **nombres y el orden de las 3 hojas**, encabezados, conteos de filas, hoja vacía con solo encabezado, **ausencia de DNI/email en todo el workbook**, headers HTTP (.xlsx, attachment, no-store), 403/400 en el mismo orden, y auditoría con conteos y sin nombres. |
| `tests/electoral-actions-auth.test.ts` | Sin cambios (la action del flag no se toca). |
| `/mi` (identity) | La tabla de `electoralStatusFor` sigue pasando sin tocar aserciones (el refactor es interno); si no existe test del `at` de `mi/page.tsx`, no se agrega render test nuevo — el fix es de una línea y lo cubre la revisión. |

Comando de verificación final: la suite entera del proyecto en verde, más
`npx tsc --noEmit` (el cambio de tipo de `withoutSeniority` tiene que romper en
compilación cualquier consumidor no actualizado — esa es la gracia de cambiar el tipo
en vez de agregar un campo paralelo).

---

## 8. Riesgos y mitigaciones

| Riesgo | Mitigación |
|--------|-----------|
| Romper pagos/tesorería | El diff no toca `treasury/*` ni `mp/*`; se verifica con `git diff --stat` al cerrar (el precedente es el módulo de exención, que lo demostró igual). |
| Un consumidor de `withoutSeniority` sin actualizar | El cambio de tipo `number → ElectoralRow[]` rompe en compilación; `tsc --noEmit` es parte del cierre. |
| El Excel divulga datos de más | Test que serializa el workbook y afirma ausencia de DNI/email; columnas fijadas en el builder puro (decisión 10). |
| La Junta lee el bloque 3 como "lista regularizable" | La nota impresa del bloque lo niega expresamente (§5.4). |
| La impresión pierde las tablas por el patrón dual | `print:block` explícito en el wrapper de tabla y `print:hidden` en el de cards; test de pantalla verifica presencia de ambas presentaciones. |
| Se pierde el CSV que la Junta ya usaba | Decisión consciente del operador (ronda 1): REG-31 pedía Excel; el circuito real todavía no arrancó (el sitio no se difundió). |

---

## 9. Fuera de alcance (anotado, no incluido)

- Fecha de elección en `Configuration` (decidido en contra, 27/08).
- Padrón histórico / persistencia de versiones (limitación estructural conocida: la
  hoja mezcla dos relojes y lo advierte en papel).
- Unificar la **consulta** de arrears entre padrón (`fee.groupBy`) y `/mi`
  (`fee.count`) — la condición se comparte (§3.3); la consulta duplicada queda como
  deuda anotada en `identity.ts:5-7`.
- Deriva menor de referencias de línea en comentarios (`docs/02:155-158` vs. la
  posición actual de REG-30/31) — se corrige de paso solo en los archivos que este
  cambio ya toca.
