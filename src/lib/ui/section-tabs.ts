// Pestañas de SECCIÓN "Carpeta" (spec 2026-09-02-pestanas-de-seccion-design).
// ÚNICA fuente de las clases de las ocho barras: cuatro por URL (Tesorería,
// Socios, Solicitudes admin, /mi/solicitudes; la quinta barra por URL es la nav
// del shell de /mi, que NO usa este módulo) y cuatro Radix (ficha del socio,
// Configuración, Salud, Documentos). Sin React, sin Prisma: sólo strings.
//
// Tres niveles visuales, cada uno con su forma, para que una pestaña de sección
// no se confunda con la nav ni con los filtros:
//   1. nav del shell de /mi  → subrayado fino (mi-tabs.tsx, NO usa este módulo)
//   2. pestañas de sección   → esta solapa
//   3. segmentos de vista    → píldora sobre pista gris (filter-chips.tsx)
//
// La solapa activa: fondo de tarjeta, contorno en tres lados, tapa celeste de
// 3 px y `-mb-px` + `border-b-0` para que su fondo pise la línea del riel — es
// lo que la "abre" hacia el contenido. La tapa es un `inset-shadow` y no un
// `border-t` para que activa e inactiva midan lo mismo y el anillo de foco
// (que también es box-shadow) componga con ella en vez de pisarla.

/** Antepone `prefix` a cada token. Las variantes Radix se DERIVAN de las
 *  constantes de abajo con esto, no se copian a mano. */
export function withPrefix(prefix: string, classes: string): string {
  return classes
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => `${prefix}${token}`)
    .join(" ");
}

// Envoltorio. `-my-1 py-1`: overflow-x-auto calcula overflow-y en auto también
// (CSS Overflow), así que el contenedor recorta en vertical; el anillo de foco
// es un box-shadow ~2px afuera del borde y no cuenta como desborde. Sin este
// padding, el foco por teclado queda cortado. El margen negativo cancela el
// padding, no mueve nada visualmente. El admin deja de sangrar a partir de lg.
export const SECTION_TABS_NAV = "-mx-4 -my-1 overflow-x-auto px-4 py-1";
export const SECTION_TABS_NAV_ADMIN = `${SECTION_TABS_NAV} lg:mx-0 lg:px-0`;

// El riel. `items-end`: las solapas apoyan sobre la línea. `px-0.5`: que el
// contorno de la primera no toque el borde del envoltorio.
export const SECTION_TABS_LIST = "flex min-w-max items-end gap-1 border-b px-0.5";

// Base de cada pestaña (link o trigger).
export const SECTION_TAB =
  "relative -mb-px inline-flex min-h-11 items-center gap-1.5 rounded-t-md border border-b-0 border-transparent px-3.5 text-sm outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-ring";

export const SECTION_TAB_ACTIVE =
  "border-border bg-card font-semibold text-foreground inset-shadow-[0_3px_0_0_var(--color-primary)]";

export const SECTION_TAB_INACTIVE = "text-muted-foreground hover:bg-muted hover:text-foreground";

// Contador (Solicitudes admin): gris en la inactiva, celeste en la activa. La
// alerta roja de Salud NO pasa por acá: es roja siempre.
export const SECTION_TAB_COUNT = "font-mono text-xs tabular-nums text-muted-foreground";
export const SECTION_TAB_COUNT_ACTIVE = "font-mono text-xs tabular-nums text-primary";

export const SECTION_TAB_ICON = "size-4 shrink-0";

// Radix. Va sobre `<TabsList variant="section">`: con esa variante ninguna regla
// de estado de `line` ni de `default` se dispara (están escritas contra
// `group-data-[variant=…]`, que pesa más que `data-active:` porque shadcn lo
// define con `:where()`), y lo que queda en la base lleva los mismos prefijos
// que estos overrides, así que tailwind-merge sí los reemplaza.
// `h-auto` pisa el `h-8` de la variante compartida (los targets de 44px no
// entran en 32px). Ya no hay `pb-2`: el subrayado que `line` dibujaba 5px por
// debajo del trigger se apaga en el propio trigger (`after:hidden`), así que no
// hay espacio que reservarle.
// La lista NO lleva overflow: el desplazamiento horizontal va SIEMPRE en el
// envoltorio (`SECTION_TABS_NAV_ADMIN`), nunca acá, por dos razones — un
// overflow en la lista recorta el `-mb-px` con que la solapa activa pisa el
// riel (y deja de "abrirse" hacia el contenido), y `overflow-x:auto` implica
// `overflow-y:auto` (CSS Overflow), así que además aparece una barra vertical.
// `min-w-max` es lo que impide que las pestañas se compriman dentro de ese
// envoltorio. Ojo al orden: `px-0.5` va DESPUÉS de `p-0` o gana el `p-[3px]`
// de la base.
export const SECTION_TABS_RADIX_LIST =
  "group-data-horizontal/tabs:h-auto w-full min-w-max items-end justify-start rounded-none border-b p-0 px-0.5";

export const SECTION_TAB_RADIX_TRIGGER = [
  SECTION_TAB,
  // `rounded-b-none`: la base trae `rounded-md` y tailwind-merge NO lo saca con
  // un `rounded-t-md` posterior, así que las esquinas de abajo quedaban curvas y
  // el riel se veía por el hueco. `after:hidden`: la base dibuja un subrayado
  // 5px por debajo del trigger (opacidad 0, pero ocupa caja y desborda el
  // envoltorio).
  "flex-none justify-start rounded-b-none py-0 font-normal after:hidden",
  withPrefix("data-[state=inactive]:", SECTION_TAB_INACTIVE),
  withPrefix("data-active:", SECTION_TAB_ACTIVE),
  // La base pinta la activa en oscuro con `dark:data-active:border-input` y
  // `dark:data-active:bg-input/30`; el prefijo `dark:` pesa más que
  // `data-active:` a secas, así que el override se repite con el suyo.
  withPrefix("dark:data-active:", "border-border bg-card"),
].join(" ");
