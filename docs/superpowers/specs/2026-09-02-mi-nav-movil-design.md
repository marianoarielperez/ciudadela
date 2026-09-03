# Navegación móvil del panel de socio (`/mi`) — diseño

**Fecha:** 2026-09-02
**Estado:** implementado y verificado en el navegador (2026-09-02)
**Alcance:** un componente. Cambio visual; ninguna regla de negocio ni ruta se toca.

## 1. Problema

La nav del shell de `/mi` (`src/components/mi/mi-tabs.tsx`) es una tira de seis pestañas
con subrayado fino de 2 px, ícono de 16 px y texto de 14 px, dentro de un `overflow-x-auto`.
En un celular de 375 px se ven tres pestañas y media; **Solicitudes** y **Documentos** quedan
fuera de la pantalla y **nada indica que hay que deslizar**. Para un socio mayor —el usuario
típico del panel— eso equivale a que esas secciones no existen. El operador señaló tres
problemas, en este orden: secciones escondidas, texto y targets chicos, y una marca de
sección activa que no se ve.

## 2. Decisiones (entrevista)

| Pregunta | Decisión |
|---|---|
| Alcance | **Solo celular** (< 640 px). Desde `sm` la nav actual queda **byte-idéntica**. |
| Espacio vertical | Lo que haga falta arriba; la nav **se va con el encabezado** al hacer scroll (no es sticky). |
| Patrón | Tira grande que desliza, con **señal y botón** de "hay más" (variante C del mockup). Descartadas: mosaico 3×2 y fichas en dos filas. |
| Flecha | Botón que **desplaza** la tira; al llegar al final aparece **del lado izquierdo** apuntando atrás. **Deslizar con el dedo sigue funcionando.** |
| Dónde va la flecha | **Flota sobre el borde** de la tira, con un degradado corto detrás. Se descartaron las columnas fijas de 44 px: con dos columnas en 375 px entran 3,5 pestañas de 80 px, no cuatro (decisión posterior a la primera versión del spec). |
| Activa a la vista | Al cargar cualquier sección la tira **arranca ya desplazada** para que la activa se vea. |
| Cuántas a la vista | Cuatro enteras en 375 px, con **texto de 14 px** (se descartó cinco con 12 px). |
| Marca de activa | **Bloque celeste lleno** (`bg-primary`, texto blanco). |
| Etiquetas | Las de hoy, sin cambios. |

## 3. Diseño visual

Mockup aprobado: artefacto "Navegación móvil de /mi" (tres estados a 375 px).

| Elemento | Medida |
|---|---|
| Pestaña | `flex: 1 0 80px` (80 px mínimo, se estira si sobra), 64 px de alto, radio 10 px, ícono arriba del texto |
| Ícono | 24 px; `text-primary` en la inactiva, blanco en la activa |
| Texto | 14 px `font-medium`; `font-semibold` en la activa |
| Activa | `bg-primary text-primary-foreground` (4,71:1) |
| Inactiva | `text-foreground`, sin fondo; `hover:bg-muted` |
| Flecha | **Flotante** sobre el borde de la tira: botón de 44 px de target con un círculo visible de 36 px `bg-primary` y chevron de 20 px, sobre un degradado de 64 px de `bg-background` a transparente. No ocupa ancho: la tira usa los 375 px enteros (`-mx-4`), y en 375 px se ven **cuatro pestañas enteras** y una parcial, que es la que queda bajo la flecha. |
| Alto total de la nav | ≈ 78 px (hoy ≈ 56 px) |
| Corte | `sm:hidden` para la tira nueva; `hidden sm:block` para la nav actual |

Estados de las flechas (cada una con su degradado):

- **Al inicio** (`scrollLeft ≈ 0`): la izquierda ausente, la derecha visible.
- **En el medio**: las dos visibles.
- **Al final**: la derecha ausente, la izquierda visible.
- **Todo entra** (`scrollWidth ≤ clientWidth`): las dos ausentes y las pestañas se reparten el
  ancho (`flex-grow`).

## 4. Comportamiento

- **Tocar la flecha** desplaza `±0,8 × clientWidth` con `behavior: "smooth"`, o `"auto"` si
  `prefers-reduced-motion: reduce`.
- **Posicionado inicial**: en un `useLayoutEffect` dependiente de `pathname`, se escribe
  `scrollLeft` directo para que la pestaña con `aria-current` quede visible (centrada si se
  puede). **No** se usa `scrollIntoView`: puede mover la página en vertical.
- **Estado de las flechas**: derivado de `scrollLeft`, `scrollWidth` y `clientWidth` con un
  listener de `scroll` (pasivo) y un `ResizeObserver` sobre el contenedor. Como las flechas
  **flotan** (posición absoluta), aparecer o desaparecer no cambia el ancho de la tira y el
  estado no puede oscilar; por eso se ocultan con `hidden` a secas, y un botón oculto sale
  del orden de tabulación.
- **Servidor e hidratación**: se pinta el estado "desborda y al inicio" (solo la flecha
  derecha), que es el más probable en un celular; el `useLayoutEffect` lo corrige con
  medidas reales antes del primer pintado.
- **Deslizar con el dedo**: el contenedor es `overflow-x-auto` como hoy; nada lo intercepta.

## 5. Accesibilidad

- Targets: pestañas 80 × 64 px; botones de 44 × 44 px (36 px visibles).
- Nombres accesibles de los botones: "Ver más secciones" / "Ver secciones anteriores";
  íconos `aria-hidden`. Un botón `hidden` sale del orden de tabulación.
- Foco: `outline-hidden focus-visible:ring-2 focus-visible:ring-ring` en pestañas y botones.
  El contenedor con scroll lleva `pt-1.5 pb-2` propios, así que el anillo de 2 px de las
  pestañas no se recorta (la trampa documentada en `section-tabs.ts`).
- Landmarks: la nav de escritorio y la móvil comparten `aria-label="Secciones del panel"`;
  como una de las dos está en `display: none`, el lector de pantalla ve una sola.
- `aria-current="page"` en la activa, con la misma `isMiTabActive` de hoy.
- Contraste: activa 4,71:1 (blanco sobre `#0079BC`); inactiva `text-foreground` sobre
  `bg-background`.

## 6. Qué NO cambia

- `src/lib/mi/nav.ts` (`MI_TABS`, `miTabsFor`, `isMiTabActive`): intacto.
- `src/app/mi/layout.tsx` y todas las páginas de `/mi`: intactas.
- `src/components/mi/solicitudes-tabs.tsx` y `src/lib/ui/section-tabs.ts`: intactos. La tira
  móvil **no** importa el módulo de solapas (es la nav del shell, nivel 1) y el archivo
  conserva `border-b-2` en la nav de escritorio, así que el test de fuente
  `tests/section-tabs.test.ts` ("la nav del shell de /mi NO usa el módulo y conserva su
  subrayado") sigue verde sin tocarlo.
- Etiquetas, íconos y orden de las secciones.
- Sin migración, sin variable de entorno, sin dependencia nueva.

## 7. Implementación

Un archivo de producto: `src/components/mi/mi-tabs.tsx` (ya es `"use client"`).

- `MiTabs` renderiza dos hermanos: `<nav className="hidden sm:block">` con el markup de hoy
  sin cambios, y `<MobileStrip>` (mismo archivo) con `sm:hidden`.
- `MobileStrip` es donde viven el `ref` del contenedor, el estado `{ atStart, atEnd, overflows }`,
  el `ResizeObserver`, el listener de scroll y el `useLayoutEffect` del posicionado.
- Mapa de íconos: el `ICONS` existente, con `size-6` en la tira.

## 8. Pruebas

- **Nuevo** `tests/mi-tabs.test.ts` (render con `renderToStaticMarkup` y `usePathname`
  mockeado, como en `section-tabs.test.ts`):
  - las dos navs listan las mismas pestañas en el mismo orden (`miTabsFor(true)` y
    `miTabsFor(false)`);
  - en cada nav hay **exactamente un** `aria-current="page"` para `/mi`, `/mi/documentos` y
    una subruta (`/mi/solicitudes/reportes`);
  - los dos botones tienen nombre accesible y `type="button"`;
  - la nav móvil lleva `sm:hidden` y la de escritorio `hidden sm:block`.
- **Existentes** sin tocar: `tests/mi-nav.test.ts`, `tests/section-tabs.test.ts`.
- **En navegador** (dev server, viewport 375 × 812 y 640): cuatro pestañas visibles en
  Inicio con la flecha derecha; en Documentos la tira arranca al final con la flecha
  izquierda; tocar la flecha desplaza; deslizar con el dedo funciona; en 640 px aparece la
  nav actual. Captura de cada estado.
