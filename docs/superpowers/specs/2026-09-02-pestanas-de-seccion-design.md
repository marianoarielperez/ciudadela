# Pestañas de sección "Carpeta" — diseño

**Fecha:** 02/09/2026 · **Estado:** aprobado por el operador (mockups comparados
en vivo; tres rondas de decisiones) · **Rama:** `section-tabs`

## 1. Problema

Las pestañas de sección "se pierden". En `/mi/solicitudes`, Institucional |
Reportes usa exactamente el mismo dibujo que la navegación principal del panel
de socio (subrayado fino de 2 px, texto gris) y queda a 60 px debajo de ella:
dos filas subrayadas una debajo de otra, sin fondo ni contorno que distinga
cuál es cuál. En el admin, sobre página blanca, el subrayado es lo único que
separa a Altas | De socios | Reportes de texto suelto.

El relevamiento (tres agentes, 02/09/2026) encontró **cuatro familias** de
"pestañas" en el sistema:

| Familia | Estilo hoy | Dónde |
|---|---|---|
| Nav del shell de `/mi` | subrayado fino + ícono | Inicio · Mi cuenta · Débito · Mis datos · Solicitudes · Documentos |
| Pestañas de sección por URL | **el mismo subrayado** | Tesorería (8), Socios (3), Solicitudes admin (3), `/mi/solicitudes` (2) |
| Pestañas Radix `?tab=` | el mismo subrayado (variante `line` de shadcn) | Ficha del socio (4), Configuración (5), Salud (4), Documentos (4) |
| Segmentos y chips de vista | píldora blanca sobre pista gris; píldoras redondas | Pendientes/Historial, Vigentes/Activos/…, Reportes, actas, usuarios; años y días |

Las nueve barras de sección comparten byte a byte las mismas clases, así que la
homogeneización es un cambio de `className`, no de estructura.

## 2. Decisiones tomadas con el operador

1. **Alcance: sólo las nueve barras de sección.** La nav del shell de `/mi` y
   los segmentos/chips de vista **no se tocan**.
2. **Tres niveles visuales, cada uno con su forma:** nav del shell (subrayado,
   como hoy) · pestañas de sección (solapa "Carpeta", nueva) · filtros de vista
   (segmentado gris, como hoy). Que una pestaña de sección no se confunda con la
   nav ni con los filtros depende de que las tres formas sean distintas.
3. **Dirección A · Carpeta**, elegida entre tres mockups (Carpeta / Barra
   enmarcada / Tinta): la activa es una solapa con fondo de tarjeta, contorno en
   tres lados, tapa celeste de 3 px arriba y se funde con el riel; las inactivas
   son texto gris que se ilumina en gris al pasar.
4. **Contador celeste en la activa** (Solicitudes admin). La alerta roja de
   Salud queda roja siempre.
5. **44 px de alto en todas** (`min-h-11`, el canon del shell). La nav del
   shell de `/mi` queda en 48 y así las sub-pestañas se distinguen también por
   tamaño.
6. **Ejecución: módulo de clases compartido**, no un componente nuevo. Los
   nueve componentes sólo cambian su `className`.
7. **Guarda por test de fuente**, verificada por mutación.
8. **Excepción aprobada:** una variante `section` de una línea en
   `tabsListVariants` (`src/components/ui/tabs.tsx`). Ver §4.2 por qué es
   necesaria y no cosmética.

## 3. Sólo visual: qué NO cambia

- Ninguna lógica de activación (`isTreasuryTabActive`, `isSociosTabActive`,
  `isSolicitudesTabActive`, `isMiSolicitudesTabActive`), ninguna ruta, ningún
  `?tab=`, ningún `router.replace`, ningún `useEffect` (el del ancla de Salud
  sigue igual), ningún contador ni ícono.
- Ninguna aserción de la suite existente. Los tests que fijan clases de
  pestañas (`filter-chips`, `documentos-screen`, `treasury-income-exercise`)
  son de chips y segmentos, fuera de alcance; los de módulos puros
  (`treasury-tabs`, `socios-tabs`, `solicitudes-tabs`, `config-tabs`,
  `salud-tabs`, `documentos-tabs`, `mi-nav`, `mi-solicitudes-tabs`) no
  renderizan; `documentos-tabs-component` asserta rótulos, paneles y
  `aria-label`, que se conservan.
- Ningún archivo de `src/lib/treasury/*` ni `src/lib/mp/*`.
- Accesibilidad del shell (canon, no romper): targets ≥44 px, `outline-hidden`
  + `focus-visible:ring-2 focus-visible:ring-ring` en todo control,
  `aria-current="page"` en la activa de las barras por URL, `aria-label` en
  toda lista, íconos `aria-hidden` siempre con texto, modo oscuro sólo por
  tokens (nada de color crudo de Tailwind).
- El truco `-mx-4 px-4 / -my-1 py-1` del envoltorio (`overflow-x-auto` recorta
  el anillo de foco sin ese padding) se conserva tal cual.

## 4. El módulo compartido

### 4.1 `src/lib/ui/section-tabs.ts`

Sin React, sin Prisma, sólo strings y una función pura. Es la ÚNICA fuente de
las clases de las nueve barras.

| Constante | Clases | Para qué |
|---|---|---|
| `SECTION_TABS_NAV` | `-mx-4 -my-1 overflow-x-auto px-4 py-1` | envoltorio (panel de socio) |
| `SECTION_TABS_NAV_ADMIN` | `SECTION_TABS_NAV` + `lg:mx-0 lg:px-0` | envoltorio (admin, que a partir de `lg` no sangra) |
| `SECTION_TABS_LIST` | `flex min-w-max items-end gap-1 border-b px-0.5` | el riel |
| `SECTION_TAB` | `relative -mb-px inline-flex min-h-11 items-center gap-1.5 rounded-t-md border border-b-0 border-transparent px-3.5 text-sm outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-ring` | base de cada pestaña |
| `SECTION_TAB_ACTIVE` | `border-border bg-card font-semibold text-foreground inset-shadow-[0_3px_0_0_var(--color-primary)]` | la solapa |
| `SECTION_TAB_INACTIVE` | `text-muted-foreground hover:bg-muted hover:text-foreground` | gris, se ilumina al pasar |
| `SECTION_TAB_COUNT` | `font-mono text-xs tabular-nums text-muted-foreground` | contador en inactiva |
| `SECTION_TAB_COUNT_ACTIVE` | `font-mono text-xs tabular-nums text-primary` | contador en activa |
| `SECTION_TAB_ICON` | `size-4 shrink-0` | ícono |
| `SECTION_TABS_RADIX_LIST` | `group-data-horizontal/tabs:h-auto w-full items-end justify-start overflow-x-auto rounded-none p-0 px-0.5 border-b` | el mismo riel sobre `TabsList variant="section"` |
| `SECTION_TAB_RADIX_TRIGGER` | `SECTION_TAB` + `flex-none justify-start py-0 font-normal` + `withPrefix("data-[state=inactive]:", SECTION_TAB_INACTIVE)` + `withPrefix("data-active:", SECTION_TAB_ACTIVE)` | el trigger Radix |

`withPrefix(prefix, classes)` antepone el prefijo a cada token separado por
espacios. Está para que las variantes Radix se **deriven** de las mismas
constantes y no se copien a mano: si mañana la solapa cambia, cambia en un
solo lugar.

Por qué cada decisión:

- **`-mb-px` + `border-b-0` + `bg-card`**: la solapa activa baja 1 px y pisa la
  línea del riel con su propio fondo. Es lo que la "abre" hacia el contenido y
  lo que la hace leerse como carpeta y no como subrayado.
- **La tapa es un `inset-shadow`, no un `border-t`**: así activa e inactiva
  miden lo mismo (las dos tienen `border` de 1 px) y el anillo de foco —que
  también es `box-shadow`— compone con la tapa en vez de pisarla. Tailwind v4
  encadena `--tw-inset-shadow`, `--tw-ring-shadow` y `--tw-shadow` en un solo
  `box-shadow`.
- **`items-end` en el riel**: las pestañas apoyan sobre la línea aunque una
  tenga dos filas de contenido.
- **`px-0.5` en el riel**: que el contorno de la primera solapa no toque el
  borde del envoltorio.
- **`px-3.5`** (14 px) en lugar de `px-3`: la solapa con contorno necesita un
  poco más de aire que el texto subrayado. Es lo que se aprobó en el mockup.
- **Tokens solamente**: `--card`, `--border`, `--primary`, `--muted`,
  `--muted-foreground`, `--foreground`. En modo oscuro la solapa es
  `oklch(0.205)` sobre `oklch(0.145)`, y en `/mi` (fondo `bg-secondary/40`)
  la solapa blanca se lee como parte de la tarjeta de abajo.

### 4.2 La variante `section` en `ui/tabs.tsx`

`tabsListVariants` gana una variante:

```ts
section: "gap-1 bg-transparent",
```

Es la misma definición que `line`. La diferencia no está en la lista sino en el
**trigger**: sus reglas de estado activo están escritas contra
`group-data-[variant=line]/tabs-list:` y `group-data-[variant=default]/tabs-list:`.
En shadcn (`shadcn/tailwind.css`) `data-active` es
`&:where([data-state="active"])` —especificidad **cero**— mientras que las
reglas de grupo llevan `[data-variant=line]`, que pesa (0,1,0). Un override
por `className` con `data-active:bg-card` sobre `variant="line"` **pierde
siempre** contra `…variant=line…:data-active:bg-transparent`, y `tailwind-merge`
no lo resuelve porque los prefijos son distintos.

Con `data-variant="section"` **ninguna** regla de `line` ni de `default` se
dispara, y lo que queda en el trigger (`data-active:bg-background`,
`dark:data-active:bg-input/30`, etc.) lleva los mismos prefijos que nuestros
overrides, así que `tailwind-merge` sí los reemplaza. Verificado contra
`shadcn/dist/tailwind.css` y `tailwind-merge` 3.x antes de decidir; es una
línea aditiva, y no modifica `default` ni `line`.

El subrayado que la variante `line` dibuja con `after:` 5 px por debajo del
trigger **no se activa** en `section` (su `after:opacity-100` también está
detrás de `[variant=line]`), así que el `pb-2` que las listas Radix llevaban
para "dejar adentro" esa línea desaparece.

## 5. Los nueve componentes

Sólo `className`, salvo los dos extras marcados.

| Componente | Cambio |
|---|---|
| `src/components/admin/treasury-tabs.tsx` | `nav` → `SECTION_TABS_NAV_ADMIN`; `ul` → `SECTION_TABS_LIST`; link → `cn(SECTION_TAB, active ? SECTION_TAB_ACTIVE : SECTION_TAB_INACTIVE)` |
| `src/components/admin/socios-tabs.tsx` | ídem; ícono → `SECTION_TAB_ICON` |
| `src/components/admin/solicitudes-tabs.tsx` | ídem; contador → `active ? SECTION_TAB_COUNT_ACTIVE : SECTION_TAB_COUNT` |
| `src/components/mi/solicitudes-tabs.tsx` | `nav` → `SECTION_TABS_NAV`; resto ídem; `min-h-12` → `min-h-11` (viene de `SECTION_TAB`) |
| `src/components/admin/member-tabs.tsx` | `variant="section"`, lista → `SECTION_TABS_RADIX_LIST`, trigger → `SECTION_TAB_RADIX_TRIGGER`; **extra:** `aria-label="Secciones de la ficha"` (era la única lista sin etiqueta) |
| `src/app/admin/configuracion/config-tabs.tsx` | `variant="section"`, lista y trigger como arriba; ícono → `SECTION_TAB_ICON` |
| `src/app/admin/salud/salud-tabs.tsx` | ídem; el contador rojo (`text-destructive`) y su `sr-only` quedan igual |
| `src/app/admin/documentos/documentos-tabs.tsx` | ídem |
| `src/components/mi/mi-tabs.tsx` | **NO se toca** (es la nav del shell). Se lista para dejar constancia de que la exclusión es deliberada |

Los comentarios de código que explican `h-auto`, `pb-2` y el `border-b` como
"riel canónico" se actualizan: `pb-2` ya no existe y la explicación del riel
vive en el módulo.

`TabsContent` conserva sus `pt-4` / `pt-2` actuales: el espacio bajo la barra
no es parte de esta decisión.

## 6. Tests

`tests/section-tabs.test.ts`, en tres partes:

1. **De fuente.** Los ocho archivos modificados (los nueve menos `mi-tabs`)
   importan de `@/lib/ui/section-tabs`, y ninguno conserva `border-b-2`,
   `after:bg-primary` ni `variant="line"`. `mi-tabs.tsx` **sí** conserva
   `border-b-2` y **no** importa del módulo: la nav del shell se queda con su
   subrayado, y este test también lo fija.
2. **Del módulo.** `withPrefix` deriva bien (incluye el caso de un token con
   `/`, como `bg-input/30`, y de uno con corchetes); `SECTION_TAB` contiene
   `min-h-11`, `outline-hidden` y `focus-visible:ring-ring`;
   `SECTION_TAB_RADIX_TRIGGER` contiene `data-active:bg-card` y
   `data-[state=inactive]:hover:bg-muted`.
3. **De render.** Con `next/navigation` doblado y `renderToStaticMarkup`
   (molde de `documentos-tabs-component`): `SolicitudesTabs` con tres pestañas
   y contadores da exactamente un `aria-current="page"`, la clase de la solapa
   está en el link activo y no en los otros, el contador de la activa lleva
   `text-primary`; `SaludTabs` con `actCounts.dinero = 1` emite
   `data-variant="section"`, cuatro triggers con `min-h-11`, el `sr-only`
   ", 1 para atender" y ningún `pb-2`.

Cada guarda se verifica por **mutación**: se rompe la condición (se quita el
import, se vuelve a `line`, se copia una clase a mano) y se mira el test en
rojo antes de restaurar. Suite completa en verde sin tocar una aserción
existente.

## 7. Verificación en vivo

Dev server local, las nueve pantallas, claro y oscuro, con capturas antes y
después:

- `/mi/solicitudes` (la del reporte del operador) y `/mi/solicitudes/reportes`
- `/admin/solicitudes`, `/socios`, `/reportes` (contadores) y con los segmentos
  Pendientes | Historial debajo
- `/admin/socios` y `/admin/socios/[id]` (ficha, `?tab=cuenta`)
- `/admin/tesoreria/*` en móvil (375 px): ocho pestañas con scroll horizontal
- `/admin/configuracion`, `/admin/salud` (con una alerta `act`), `/admin/documentos`
- Foco por teclado en una barra por URL y una Radix (anillo completo, no
  recortado)
- Impresión de la ficha del socio: las barras siguen en `print:hidden`

## 8. Fuera de alcance (anotado, no se hace)

- Unificar los tres segmentos inline (padrón, usuarios, actas) y los cuatro
  `SEGMENT_*` bajo `FilterChips`: deuda existente, otra tarea.
- Un degradado en el borde del riel cuando hay pestañas ocultas por scroll.
- Homogeneizar `pt-4` / `pt-2` bajo las barras Radix.
- Rediseñar la nav del shell de `/mi`.

## 9. Entrega

Rama `section-tabs` desde `main`. Sin migración, sin variable de entorno, sin
línea de crontab. Push y despliegue los corre el operador.
