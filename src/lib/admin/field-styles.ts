// Clase compartida para los <select> nativos del panel: mismos tokens que
// `Input`/`Button` (`border-input`, `bg-transparent`, anillo de foco en
// `focus-visible`), para que no se vean planos en modo oscuro.
//
// Estaba copiada a mano en cuatro lugares (`solicitudes/page.tsx`,
// `tesoreria/deudores/page.tsx`, `tesoreria/recibos/page.tsx` y
// `solicitudes/[id]/decision-forms.tsx`) y una de las copias arrastraba
// `outline-none`, que CLAUDE.md prohíbe explícitamente (deja el foco
// invisible en modo alto contraste). El token del proyecto es
// `outline-hidden`: saca el anillo por default del navegador SIN tapar el
// que pone `focus-visible:ring-*` acá al lado.
export const SELECT_CLASS =
  "h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs transition-colors outline-hidden focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";
