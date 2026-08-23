// El link dentro de un párrafo del panel. Estaba escrito a mano, carácter por
// carácter, en doce lugares: si alguno se copiaba mal se perdía el anillo de
// foco y el link quedaba invisible al navegar con teclado, que es justo lo que
// `outline-hidden` obliga a reponer con `focus-visible:ring-*` (misma regla que
// la lateral, ver CLAUDE.md → accesibilidad del shell).
//
// Es sólo para links de TEXTO CORRIDO. Los que además necesitan alto de toque
// (≥44px) o tipografía propia componen encima: `cn(INLINE_LINK, "inline-flex
// min-h-11 items-center")`, `cn(INLINE_LINK, "font-mono text-xs")`.
export const INLINE_LINK =
  "text-primary outline-hidden hover:underline focus-visible:ring-2 focus-visible:ring-ring";
