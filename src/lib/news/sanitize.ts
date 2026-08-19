// Sanitización del cuerpo de la noticia. El editor (Tiptap) corre en el
// cliente y su HTML es input hostil por definición: acá se decide qué entra
// a la base. El render público usa dangerouslySetInnerHTML CONFIANDO en que
// todo lo persistido pasó por esta allowlist.
import sanitizeHtml from "sanitize-html";

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ["p", "br", "strong", "em", "u", "a", "ul", "ol", "li", "h2", "h3"],
  allowedAttributes: { a: ["href", "rel"] },
  allowedSchemes: ["http", "https"],
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

// Texto plano para meta description y tarjetas. maxLength por defecto 160
// (límite práctico de description en resultados de búsqueda).
export function newsPlainText(html: string, maxLength = 160): string {
  const text = sanitizeHtml(html, TEXT_ONLY).replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}
