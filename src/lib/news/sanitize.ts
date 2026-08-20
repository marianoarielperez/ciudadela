// Sanitización del cuerpo de la noticia. El editor (Tiptap) corre en el
// cliente y su HTML es input hostil por definición: acá se decide qué entra
// a la base. El render público usa dangerouslySetInnerHTML CONFIANDO en que
// todo lo persistido pasó por esta allowlist.
import sanitizeHtml from "sanitize-html";

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ["p", "br", "strong", "em", "u", "a", "ul", "ol", "li", "h2", "h3"],
  allowedAttributes: { a: ["href", "rel"] },
  // `mailto` y `tel` además de http/https: una noticia de la vecinal linkea un
  // mail o un teléfono de contacto con toda naturalidad, y el editor deja
  // escribirlos (pide la URL con un prompt, sin restringir esquema). Sin ellos
  // sanitize-html borra el href y DEJA el texto: el enlace desaparece sin
  // ningún aviso ni para el redactor ni para el lector. Ninguno de los dos
  // ejecuta código — el vector de esta lista es `javascript:`/`data:`, que
  // siguen afuera.
  allowedSchemes: ["http", "https", "mailto", "tel"],
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
  // Se corta por PUNTOS DE CÓDIGO, no por unidades UTF-16: `slice` parte al
  // medio los pares suplentes, y un emoji en el carácter 159 dejaba un suplente
  // alto suelto viajando al <meta name="description">, al og:description y al
  // resumen de la tarjeta. `[...text]` itera por punto de código, así que el
  // emoji entra entero o no entra.
  return `${[...text].slice(0, maxLength - 1).join("").trimEnd()}…`;
}
