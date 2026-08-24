// FormData → zod bridge shared by all server actions.
import type { z } from "zod";

export type FormResult<T> =
  | { ok: true; data: T }
  // `field` es ADITIVO: los llamadores que lo ignoran no cambian de
  // comportamiento. Es sólo el DATO —qué campo falló—; llevar el foco al campo
  // exige propagar el estado y pintar `aria-invalid` en cada pantalla, y eso
  // queda fuera de la 4C (spec §2).
  | { ok: false; error: string; /** Nombre del campo que falló, si el schema lo dice. */ field?: string };

// Un input vacío del navegador llega como "" y no como ausente, así que hay que
// traducirlo — pero no siempre al mismo valor:
//
//   - Campo opcional (`.optional()`, `.nullish()`, `.default()`): "" → undefined,
//     que es lo que `.optional()` espera. Sin esto, un email opcional en blanco
//     fallaría la validación de formato.
//   - Campo requerido: dejamos el "" tal cual. Si lo mandáramos como undefined,
//     zod no llegaría nunca a correr el `.min(1, "Ingresá el nombre")` del schema
//     y el usuario vería el texto genérico en inglés de zod ("Invalid input:
//     expected string, received undefined"). Estos mensajes se muestran tal cual
//     en pantalla, así que siempre tienen que venir del schema.
//
// Distinguimos preguntándole al propio campo si acepta undefined; no hace falta
// que quien escribe el schema marque nada aparte.
function isOptionalField(field: unknown): boolean {
  if (typeof (field as z.ZodType | undefined)?.safeParse !== "function") return true;
  return (field as z.ZodType).safeParse(undefined).success;
}

export function parseForm<S extends z.ZodType>(schema: S, formData: FormData): FormResult<z.infer<S>> {
  // Sólo los ZodObject tienen `shape`; con cualquier otro schema (o con claves que
  // el schema no declara) caemos al comportamiento simple de "" → undefined.
  const shape = (schema as { shape?: Record<string, unknown> }).shape;

  const raw: Record<string, string | undefined> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value !== "string") continue; // files are handled elsewhere (M3)
    const trimmed = value.trim();
    if (trimmed !== "") {
      raw[key] = trimmed;
      continue;
    }
    raw[key] = isOptionalField(shape?.[key]) ? undefined : "";
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    // El `path` de zod ya venía y se tiraba: un error de validación en un
    // formulario largo decía el mensaje y no dónde, y el operador buscó la causa
    // en el lugar equivocado (deuda del M3). Un issue de raíz (schema no-objeto)
    // trae `path: []` y no se le inventa campo.
    const field = typeof first?.path?.[0] === "string" ? first.path[0] : undefined;
    return { ok: false, error: first?.message ?? "Datos inválidos", field };
  }
  return { ok: true, data: parsed.data };
}
