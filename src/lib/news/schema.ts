import { z } from "zod";

// La columna `body` es `@db.Text` de MySQL: 65.535 BYTES, no caracteres. Una
// nota en castellano lleva acentos y cada uno pesa 2 bytes en UTF-8, así que un
// texto largo puede desbordar la columna y morir con "Data too long for column
// 'body'" — un error técnico en inglés donde el operador esperaba un aviso.
//
// Por eso el cuerpo se mide dos veces:
//
//   1. En CARACTERES, que es la unidad que el editor y el contador de la UI
//      pueden mostrar. 50.000 es el tope declarado y el que sale en el mensaje.
//   2. En BYTES UTF-8, que es la unidad que le importa a MySQL. El tope en
//      caracteres NO alcanza por sí solo: 50.000 caracteres acentuados son
//      100.000 bytes. Un HTML real (etiquetas, espacios, la mayoría de las
//      letras) es casi todo ASCII y nunca se acerca, pero "casi nunca" no es
//      una garantía y acá el precio de fallar es un error crudo del driver.
export const NEWS_BODY_MAX_CHARS = 50_000;

// Presupuesto de bytes: por debajo de los 65.535 de TEXT, con margen para que
// nadie tenga que recalcular esto si algún día se agrega un prefijo o sufijo.
export const NEWS_BODY_MAX_BYTES = 60_000;

// Sin número: el operador no puede contar bytes, y decirle "50.000 caracteres"
// cuando lleva 35.000 acentuados sería mentirle. Se exporta porque la guarda
// corre DOS veces con el mismo texto: acá sobre el cuerpo crudo (corte
// temprano) y en las actions sobre el cuerpo ya sanitizado (el que se guarda).
export const NEWS_BODY_TOO_LONG = "El contenido es demasiado largo para guardarlo: recortalo.";

export function newsBodyByteLength(body: string): number {
  return new TextEncoder().encode(body).length;
}

// El cuerpo llega como hidden input con el HTML del editor; acá solo se
// valida presencia/longitud — la sanitización es de sanitize.ts y corre en
// la action ANTES de persistir.
export const newsFormSchema = z.object({
  title: z
    .string()
    .min(1, "Ingresá el título.")
    .max(160, "El título no puede superar los 160 caracteres."),
  slug: z
    .string()
    .max(180, "La URL no puede superar los 180 caracteres.")
    .regex(/^[a-z0-9-]*$/, "La URL solo puede tener minúsculas, números y guiones.")
    .optional(),
  body: z
    .string()
    .min(1, "Escribí el contenido de la noticia.")
    .max(NEWS_BODY_MAX_CHARS, "El contenido es demasiado largo: recortalo a 50.000 caracteres.")
    // OJO: esta medición es sobre el cuerpo CRUDO y sirve para cortar temprano,
    // pero NO alcanza: `sanitizeNewsBody` puede AGRANDAR el texto (escapa `&` a
    // `&amp;` e inyecta rel="noopener noreferrer" en cada <a>), y lo que se
    // persiste es el sanitizado. La medición que decide es la de las actions,
    // después de sanitizar.
    .refine((body) => newsBodyByteLength(body) <= NEWS_BODY_MAX_BYTES, NEWS_BODY_TOO_LONG),
  // checkbox "eliminar portada actual" del formulario de edición
  removeCover: z.literal("on").optional(),
});

export type NewsFormValues = z.infer<typeof newsFormSchema>;
