// Sanitización del cuerpo de la noticia. El editor (Tiptap) corre en el
// cliente y su HTML es input hostil por definición: acá se decide qué entra
// a la base. El render público usa dangerouslySetInnerHTML CONFIANDO en que
// todo lo persistido pasó por esta allowlist.
import sanitizeHtml from "sanitize-html";

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ["p", "br", "strong", "em", "u", "a", "ul", "ol", "li", "h2", "h3"],
  allowedAttributes: { a: ["href", "rel"] },
  allowedSchemes: ["http", "https"],
  // Sin esto, sanitize-html deja pasar "//host/x": no es XSS, pero es un
  // esquema que nadie eligió permitir y el editor nunca genera. Los links
  // internos ("/noticias/1", "#seccion") siguen funcionando.
  allowProtocolRelative: false,
  // rel fijo: las noticias pueden linkear afuera y no queremos window.opener.
  transformTags: { a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer" }) },
};

export function sanitizeNewsBody(html: string): string {
  return sanitizeHtml(html, OPTIONS).trim();
}

const TEXT_ONLY: sanitizeHtml.IOptions = { allowedTags: [], allowedAttributes: {} };

export function newsBodyIsEmpty(html: string): boolean {
  return sanitizeHtml(html, TEXT_ONLY).replace(/&nbsp;/g, " ").trim() === "";
}

// Fin de bloque (o salto explícito) del HTML que produce el editor. Quitar las
// etiquetas no deja separador, así que "</p><h2>" pegaría las dos frases:
// `<p>Cuerpo</p><h2>Subtítulo</h2>` daba "CuerpoSubtítulo" en el og:description
// y en el resumen de cada tarjeta. Se inserta un espacio en cada límite ANTES
// de aplanar; el colapso de \s+ de más abajo se encarga de que no queden
// espacios dobles cuando el HTML ya traía uno.
const BLOCK_BOUNDARY = /<\s*(?:br\s*\/?|\/\s*(?:p|h2|h3|li|ul|ol|blockquote|div))\s*>/gi;

// Texto plano para meta description y tarjetas. maxLength por defecto 160
// (límite práctico de description en resultados de búsqueda).
export function newsPlainText(html: string, maxLength = 160): string {
  const spaced = html.replace(BLOCK_BOUNDARY, "$& ");
  const text = sanitizeHtml(spaced, TEXT_ONLY).replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}
