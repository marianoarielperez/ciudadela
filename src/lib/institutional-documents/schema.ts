import { z } from "zod";

// Mensajes en castellano: una server action es un endpoint público y los textos
// de zod por defecto ("Invalid input…") terminarían en pantalla tal cual.
export const documentFormSchema = z.object({
  type: z.enum(["norm", "annual_report", "balance", "other"], "Tipo de documento inválido."),
  title: z.string().max(160, "El título no puede superar los 160 caracteres.").optional(),
  description: z.string().max(200, "La descripción no puede superar los 200 caracteres.").optional(),
  year: z.coerce
    .number("Año inválido.")
    .int("Año inválido.")
    .min(1900, "Año inválido.")
    .max(2100, "Año inválido.")
    .optional(),
  featured: z.literal("on").optional(),
});

export type DocumentFormValues = z.infer<typeof documentFormSchema>;
