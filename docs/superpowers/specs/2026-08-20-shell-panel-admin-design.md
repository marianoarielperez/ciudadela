# Mini-módulo — Shell y patrones del panel de administración (spec de diseño)

Fecha: 2026-08-20 · Estado: aprobada por Mariano (3 rondas de preguntas + mockups HTML + diseño presentado)
Referencias: `.superpowers/sdd/progress.md` (fase acordada 20/08), `docs/07-plan-de-etapas.md`,
análisis previo de 3 agentes (inventario de pantallas, duplicación de patrones, componentes y tokens).

## 1. Contexto y alcance

El panel (`src/app/admin/**`, 16 páginas) creció módulo a módulo sin marco: el layout es una barra
celeste con "Cerrar sesión" y un `<main className="p-4">`, **sin un solo link de navegación**. El grafo
real es un árbol con raíz en `/admin` sin arista de retorno (el título del header es un `<span>`), con
tres callejones sin salida (`/admin/configuracion`, `/admin/noticias/nueva`, `/admin/noticias/[id]`) y
tres convenciones de "volver" conviviendo. Con M3–M6 las secciones pasan de 5 a ~9 de primer nivel
(Tesorería suma 5-6 subpantallas, Re-empadronamiento 4): el marco definido ahora se hereda; definido
al final, son 15+ pantallas a retocar.

**Entra:**

1. **`AdminSidebar`**: navegación lateral persistente en escritorio (≥ `lg`), colapsable a íconos con
   persistencia en cookie; cajón (drawer) con hamburguesa en móvil (< `lg`). Estética "celeste
   profundo" (elegida sobre mockups): fondo `#003C5F`, logo negativo blanco, activo marcado con el
   celeste de marca `#2E9BDF`.
2. **Configuración de nav data-driven** en `src/lib/admin/nav.ts` (funciones puras, testeables):
   grupos, ítems, filtro por rol, resolución de ítem activo.
3. **`PageHeader`**: migas + título + slot de acciones, compartido por las 16 pantallas.
4. **`FormMessage`** + tokens nuevos `--success` / `--warning` en `globals.css`: unifica los ~19
   mensajes post-acción que hoy tienen 6 tratamientos visuales.
5. **`EmptyState`** con acción opcional; arregla el bug del padrón (tabla con `thead` huérfano cuando
   el filtro no tiene resultados).
6. **`SignOutButton`** compartido: reemplaza el form duplicado byte-idéntico de `admin/layout.tsx` y
   `mi/layout.tsx`.
7. **Micro-fixes**: mapa compartido estado→variante de `Badge` (hoy un suspendido se ve distinto en
   padrón y ficha), `sr-only` en la columna de acciones del padrón, 4 botones hechos a mano
   (dashboard, error, layout) migran a `Button`/`Badge`, link de entidad del padrón gana
   `text-primary`, tarjetas de `/admin` reordenadas según los grupos de la nav.
8. **Estado bloqueado del layout** ("El panel no está disponible") con salida: barra mínima SIN nav
   + mensaje + botón de cerrar sesión.
9. **Tests** de las funciones puras nuevas, al estilo del proyecto (Vitest en node, sin jsdom).

**Fuera de alcance (decidido en la entrevista):**

- **Sitio público intocable**: `src/components/public/**`, `src/app/(public)/**`, `app/not-found.tsx`,
  `app/error.tsx`. Tiene Lighthouse accesibilidad 1.00 medido en 5 rutas; no se vuelve a tocar sin
  volver a medir.
- **Primitivas compartidas** `button/card/input/label`: no se modifican (las usa el sitio público).
  `badge.tsx` y `table.tsx` son solo-panel y sí pueden tocarse si hace falta.
- **Migración de formularios a `synced-fields`** (4 forms y 9 `<select>` crudos): queda como deuda
  anotada; rozaba módulo aparte.
- **Toasts**: el feedback es todo inline; `sonner` sigue instalado y sin montarse.
- **Rediseño de `/mi`**: solo recibe el `SignOutButton` compartido, cero cambio visual. El portal
  crece en M5.
- **Dark mode**: el bloque `.dark` sigue existiendo y sigue muerto; no se activa.
- **Módulo 3**: no se arranca.

## 2. Decisiones cerradas en la entrevista

| # | Pregunta | Decisión |
|---|---|---|
| 1 | Estética de la lateral (mockups A/B/C) | **B: celeste profundo** `#003C5F` derivado del `#0079BC`, logo negativo, activo `#2E9BDF` |
| 2 | Estructura de la lista | **Agrupada desde el día uno**: Inicio suelto + Gestión / Contenido / Sistema |
| 3 | Alcance de patrones | **Ranking del análisis** (PageHeader, FormMessage+tokens, EmptyState) en lugar del trío original (contenedor/vacío/tarjeta), refutado por datos |
| 4 | Contenido de la nav según estado/rol | **Solo secciones vivas**; Configuración visible solo para superadmin (guarda del servidor intacta); el roadmap queda en las tarjetas de Inicio |
| 5 | Barra superior en escritorio | **Sin topbar**: la lateral absorbe logo, usuario y cerrar sesión |
| 6 | Destino de `/admin` | **Sigue siendo Inicio con tarjetas**, reordenadas según los grupos, con componentes nuevos |
| 7 | Feedback post-acción | **Todo inline** con `FormMessage`; sin toasts |
| 8 | `/mi` | **Solo comparte el `SignOutButton`**; nada más se toca |
| 9 | Nombres de grupos | **Gestión / Contenido / Sistema** (Tesorería será grupo propio en M4) |
| 10 | Colapso en escritorio | **Colapsable a íconos** (~56px), elegido contra la recomendación de dejarla fija — implica cookie persistente y labels accesibles |
| 11 | Breakpoint de la lateral | **`lg` (1024px)**; por debajo rige el cajón |
| 12 | Micro-fixes | **Se incluyen los tres** (badges, `sr-only`, botones a mano) |

## 3. Navegación

### 3.1 Configuración data-driven — `src/lib/admin/nav.ts`

```ts
type AdminNavItem = { href: string; label: string; icon: IconName; superadminOnly?: boolean }
type AdminNavGroup = { label: string | null; items: AdminNavItem[] }
```

Contenido inicial (solo secciones vivas):

- (sin grupo) **Inicio** → `/admin`
- **Gestión**: Socios → `/admin/socios` · Actas → `/admin/actas`
- **Contenido**: Noticias → `/admin/noticias` · Actividades → `/admin/actividades`
- **Sistema**: Configuración → `/admin/configuracion` (`superadminOnly: true`)

Funciones puras exportadas (testeables sin DOM):

- `navForRoles(roles: string[]): AdminNavGroup[]` — filtra ítems `superadminOnly` con
  `isSuperadmin()` de `src/lib/auth/roles.ts`; elimina grupos que quedan vacíos.
- `isNavItemActive(pathname: string, href: string): boolean` — igualdad exacta para `/admin`
  (Inicio); para el resto `pathname === href || pathname.startsWith(href + "/")`. Cubre las rutas
  anidadas (`/admin/socios/carga/45` marca Socios) sin falsos positivos por prefijo.

Los íconos salen de `lucide-react` (ya instalado, hoy sin uso propio): Inicio `Home`, Socios `Users`,
Actas `ScrollText`, Noticias `Newspaper`, Actividades `CalendarDays`, Configuración `Settings`. El mapa
nombre→componente vive en el componente cliente, no en `nav.ts`, para que la config sea serializable
y testeable.

### 3.2 Tokens — recalibrar `--sidebar-*` en `globals.css`

La familia completa `--sidebar-*` (8 variables) ya existe en `:root` y `.dark` con defaults de shadcn
que nadie usa (verificado: cero consumidores en `src/`). Se recalibra a la paleta elegida — el panel
usa SIEMPRE estos valores, no depende del modo oscuro, así que `:root` y `.dark` llevan lo mismo:

| Token | Valor | Uso |
|---|---|---|
| `--sidebar` | `#003C5F` | fondo de lateral, barra móvil y cajón |
| `--sidebar-foreground` | `rgba(255,255,255,.85)` (equiv. oklch) | texto de ítems |
| `--sidebar-primary` | `#2E9BDF` | riel del ítem activo, focus ring |
| `--sidebar-primary-foreground` | `#FFFFFF` | texto del ítem activo |
| `--sidebar-accent` | overlay activo/hover (blanco al 14% / 8% sobre el fondo) | fondos de estado |
| `--sidebar-accent-foreground` | `#FFFFFF` | texto sobre accent |
| `--sidebar-border` | blanco al 16% | separadores internos |
| `--sidebar-ring` | `#9ED3F2` | anillo de foco visible sobre fondo oscuro |

Es la única modificación a `globals.css` junto con los tokens `--success`/`--warning` (§5). Nada del
sitio público consume estas variables.

### 3.3 Escritorio (≥ `lg`)

- Lateral fija de ~230px: logo negativo + "SIGeV / Panel de administración" (link a `/admin`) arriba;
  nav agrupada; al pie, bloque de usuario (nombre + rol) y `SignOutButton`, y el botón de colapso.
- Ítem activo: fondo `--sidebar-accent`, texto blanco, riel izquierdo de 3px `--sidebar-primary`,
  `aria-current="page"`.
- **Colapso a íconos (~56px)**: labels pasan a `sr-only` + `title` en el link; los rótulos de grupo
  se vuelven separadores (`--sidebar-border`); el bloque de usuario muestra solo el botón de logout
  como ícono con `title`. Persistencia: cookie `sigev_sidebar` (`expanded` | `collapsed`,
  `path=/`, `SameSite=Lax`, max-age 1 año). El layout del servidor la lee con `cookies()` y renderiza
  el estado correcto de entrada — sin flash de hidratación. El toggle es un client component que
  escribe `document.cookie` y actualiza estado local.
- Sin topbar: el contenido arranca directo con el `PageHeader` de cada página.
- `<main>`: `p-4 lg:p-6`, sin `max-width` global (las tablas anchas lo necesitan; los formularios
  conservan sus `max-w-*` propios).
- Skip link "Saltar al contenido" al estilo del layout público, apuntando a `<main id="contenido">`.

### 3.4 Móvil (< `lg`)

- Barra superior pegajosa con fondo `--sidebar`: botón hamburguesa (`aria-expanded`,
  `aria-controls`, target ≥44px) + "SIGeV — Panel" como link a `/admin`.
- Cajón desde la izquierda (~288px) sobre overlay oscuro, construido con las primitivas de Dialog de
  `radix-ui` (ya instalado): foco atrapado, Escape y scroll-lock resueltos por la librería. Contenido
  idéntico a la lateral expandida (nav + usuario + logout). Se cierra al navegar (efecto sobre
  `usePathname`), al tocar el overlay o con Escape. Animación de deslizamiento con `tw-animate-css`,
  anulada bajo `prefers-reduced-motion` (`motion-reduce:`).
- El colapso no aplica en móvil: el cajón siempre se muestra expandido.

### 3.5 Composición del layout y estado bloqueado

`admin/layout.tsx` sigue siendo server component `async`:

1. `requireAdmin()` — la guarda no cambia.
2. Con actor válido: `auth()` para nombre y roles (ya vienen en `session.user.roles`), `cookies()`
   para el colapso, `navForRoles(roles)` para los grupos → renderiza el shell completo.
3. `reason === "anonymous"` → `redirect("/ingresar")` (igual que hoy).
4. Cualquier otro rechazo (**estado bloqueado**): barra mínima con logo y título **sin nav** (no se
   muestra navegación a quien no está habilitado) + mensaje en `FormMessage kind="error" box` +
   `SignOutButton`. Deja de ser un callejón sin salida; el motivo de no redirigir (bucle
   `/ingresar` → `/redirigir` → `/admin`) sigue documentado en el comentario existente.

El logo: `assets/logo-negativo.png` (blanco sobre transparente, ya provisto) se commitea y se importa
estático con `next/image` desde el componente de la lateral, como hace el hero del sitio público —
sin copiarlo a `public/`.

## 4. `PageHeader` — `src/components/admin/page-header.tsx`

Server component. Props:

```ts
{
  title: string
  breadcrumb?: Array<{ label: string; href?: string }>   // la última hoja va sin href
  actions?: React.ReactNode                               // botones a la derecha
  children?: React.ReactNode                              // fila opcional bajo el título (badges)
}
```

Render: migas en `<nav aria-label="Ruta de navegación">` (`text-sm text-muted-foreground`, links en
`text-primary hover:underline`, separador "/" uniforme renderizado por el componente, hoja final en
texto plano) + fila `flex flex-wrap items-start justify-between gap-x-4 gap-y-2` con
`<h1 className="text-2xl font-semibold tracking-tight">` y el slot de acciones
(`flex flex-wrap gap-2`). El `flex-wrap` + `gap` arregla el pisado título/botón que hoy tienen 6
pantallas en móvil.

Adopción en las 16 pantallas. Absorbe las 4 convenciones actuales:

- Las 7 migas a mano (socios, actas) → prop `breadcrumb`.
- "Volver al calendario" (actividades/nueva y [id]) → migas `Actividades / Nueva` y
  `Actividades / {nombre}`.
- `noticias/nueva` y `noticias/[id]` ganan migas (hoy: ninguna vía de vuelta). "Ver en el sitio"
  (noticias publicadas) se queda como acción del header, no como miga.
- El botón "Volver a la ficha" del estado bloqueado de `[accion]` se conserva (es acción, no miga).
- El único `text-2xl font-bold` (`/admin`) y el `h2` suelto de `actas/[id]` se normalizan.

## 5. `FormMessage` + tokens — `src/components/admin/form-message.tsx`

Tokens nuevos en `globals.css`, con mapeo en `@theme inline` para que existan las utilidades
`text-success`, `border-warning`, etc.:

| Token | `:root` | `.dark` |
|---|---|---|
| `--success` | `#15803D` (green-700, 4.54:1 sobre blanco) | `#4ADE80` (green-400) |
| `--warning` | `#B45309` (amber-700, 4.52:1 sobre blanco) | `#FBBF24` (amber-400) |

(Los valores light se verifican por contraste al implementar; si alguno queda bajo 4.5:1 sobre el
fondo real, se oscurece un paso y se anota en el commit.)

Componente:

```ts
{ kind: "error" | "success" | "warning" | "neutral"; box?: boolean; as?: "p" | "span" | "div"; children }
```

- `role`: `alert` para error y warning; `status` para success; sin role para neutral.
- Inline (default): `text-sm` + color del kind. En caja (`box`): `rounded-md border p-3` con
  borde/fondo tenue del kind (patrón del aviso REG-16 actual, pero con el color CORRECTO por tipo).
- `as="span"` cubre los dos sitios en filas flex (carga-form, send-verification-form).

Migra los ~19 sitios relevados: las 12 copias de la línea de error, los 4 estilos de éxito (el banner
de Configuración pasa a `box success`), el ámbar único del modo carga (`warning`), los neutrales del
modo carga, y **el aviso REG-16 de `[accion]` deja de vestirse de destructive**: pasa a
`kind="warning" box` (el bloqueo real de al lado sigue siendo error). Desaparece el verde/ámbar
crudo de Tailwind del panel.

## 6. `EmptyState` — `src/components/admin/empty-state.tsx`

```ts
{ description: string; action?: React.ReactNode; size?: "list" | "card" }
```

- `size="list"` (reemplaza a la tabla): el copy de dos oraciones existente + la acción que lo
  resuelve (`<Button asChild>` "Nueva acta" / "Nueva noticia" / "Nueva actividad") repetida desde el
  header.
- `size="card"` (dentro de `CardContent`): una línea `text-sm text-muted-foreground`, sin acción.
- **Fix del padrón**: con filtro sin resultados, `socios/page.tsx` deja de renderizar la tabla
  incondicionalmente; muestra `EmptyState` con "Ningún socio coincide con el filtro" y acción
  "Limpiar filtros" (link a `/admin/socios`). Se unifica el copy duplicado "Sin movimientos." /
  "Sin movimientos asociados." en una sola forma.

## 7. Micro-fixes

1. **Mapa estado→variante de Badge** en `src/lib/admin/status-badges.ts` (funciones puras):
   `member` (`active→default`, `suspended→secondary`, resto→`outline`), `news`
   (`published→default`, `draft→secondary`), `activity` (`active→default`, resto→`secondary`).
   Elimina los 4 ternarios a mano y la divergencia padrón/ficha del suspendido. El
   `STATUS_LABELS` local de `noticias/page.tsx` (que sombrea el central) se muda a
   `src/lib/` junto a los labels existentes.
2. **`sr-only`** en el `TableHead` de acciones del padrón (única tabla sin nombrar la columna).
3. **Botones a mano → primitivas**: los links-botón de las tarjetas de `/admin`, el botón de
   `admin/error.tsx` y el logout del layout pasan a `Button` (variantes correspondientes); la
   píldora "Próximamente" pasa a `Badge variant="secondary"`. El link de entidad del padrón gana
   `text-primary` como las otras 3 tablas.
4. **Tarjetas de Inicio** reordenadas según los grupos de la nav (Gestión / Contenido / Sistema),
   manteniendo las "Próximamente" (Solicitudes, Tesorería) como roadmap. La tarjeta Configuración
   se muestra solo a superadmin (mismo dato de sesión que la nav).

## 8. `SignOutButton` — `src/components/admin/sign-out-button.tsx`

Server component: `<form>` con la server action `signOut({ redirectTo: "/" })` (hoy inline y
duplicada byte-idéntica en `admin/layout.tsx` y `mi/layout.tsx`) + `Button` adentro. Prop de
apariencia mínima para servir en la lateral oscura (ghost claro), en el estado bloqueado y en `/mi`
(donde debe verse EXACTAMENTE como hoy: `text-sm underline` → variante `link`). `/mi` no cambia en
nada más.

## 9. Accesibilidad (criterios del shell)

- `aria-current="page"` en el ítem activo; `<nav aria-label>` en lateral, cajón y migas.
- Foco visible en TODOS los controles de la lateral (anillo `--sidebar-ring` sobre fondo oscuro).
- Contrastes sobre `#003C5F`: texto de ítems ≥7:1, activo sobre accent ≥4.5:1 — verificar con
  herramienta al implementar.
- Targets táctiles ≥44px en barra móvil y cajón (patrón de `site-nav.tsx`).
- Cajón: foco atrapado, Escape cierra, scroll de fondo bloqueado (radix Dialog).
- Colapsada: cada link conserva su nombre accesible (`sr-only` + `title`).
- Skip link al contenido en el layout del panel.
- `prefers-reduced-motion` anula la animación del cajón.

## 10. Tests (Vitest en node, sin jsdom — patrón del proyecto)

- `tests/admin-nav.test.ts`: `navForRoles` (admin no ve Configuración; superadmin sí; grupos vacíos
  se eliminan; orden estable) e `isNavItemActive` (Inicio solo exacto; `/admin/socios/carga/45`
  activa Socios; sin falsos positivos de prefijo tipo `/admin/soc`).
- `tests/status-badges.test.ts`: los 3 mapas completos, incluidos estados desconocidos.
- Suite existente (689) intacta; `tsc`, `lint` y build de producción verdes.

## 11. Criterios de aceptación

1. Desde cualquier pantalla del panel se llega a cualquier sección viva en un click (dos en móvil,
   contando abrir el cajón). Los 3 callejones sin salida desaparecen.
2. La sección activa se distingue visualmente y por `aria-current`, en escritorio y móvil,
   incluidas rutas anidadas (ficha, modo carga, acciones societarias).
3. El colapso persiste entre recargas y navegaciones sin flash (la cookie se lee en el servidor).
4. Un admin común no ve Configuración (nav ni tarjeta); un superadmin sí. Las guardas del servidor
   quedan intactas y verificadas (la pantalla directa por URL sigue bloqueando).
5. Las 16 pantallas usan `PageHeader`; a 375px el título y las acciones no se solapan.
6. Todos los mensajes post-acción usan `FormMessage`; los tokens `--success`/`--warning` existen en
   ambos temas; el aviso REG-16 se presenta como warning, no como destructive.
7. El padrón con filtro sin resultados muestra `EmptyState` (sin `thead` huérfano) con acción de
   limpiar filtros.
8. Un socio suspendido muestra el mismo badge en padrón y ficha.
9. **Sitio público intacto**: cero diff en `src/components/public/**`, `src/app/(public)/**`,
   `app/not-found.tsx`, `app/error.tsx`, `ui/{button,card,input,label}.tsx`. En `globals.css` solo
   se agregan `--success`/`--warning` y se recalibran los `--sidebar-*` (sin consumidores previos).
10. `/mi` sin cambio visual; el logout sale del componente compartido.
11. Suite completa verde (689 + nuevos), `tsc`, `lint`, build de producción.

## 12. Riesgos y decisiones técnicas anotadas

- **`globals.css` es compartido con el sitio público**: el cambio se limita a variables nuevas y a
  recalibrar variables sin consumidores. El CA 9 lo verifica por diff.
- **Primer uso directo de radix Dialog en el panel** (el `ui/dialog.tsx` instalado está estilado
  como modal centrado; el cajón usa las primitivas con estilo propio de sheet lateral). Si surge
  fricción, el fallback es un drawer a mano con el patrón de `site-nav.tsx` — se pierde el focus
  trap gratis, habría que implementarlo.
- **Cookie de colapso**: si falta o trae basura, se cae a `expanded`. No es dato sensible.
- **El operador real es uno (Mariano/Comisión)**: el colapso a íconos es preferencia de usuario
  única, no multiusuario — la cookie alcanza, no hace falta persistirlo en DB.
- **Deuda anotada, fuera de alcance**: migrar 4 formularios y 9 `<select>` crudos a
  `synced-fields`/`ui/select` (se ven planos en dark mode); ternario `pending` duplicado 12 veces;
  adopción de `ui/checkbox`.
