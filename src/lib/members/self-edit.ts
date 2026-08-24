// Lista blanca de la AUTOEDICIÓN del socio (/mi/datos, spec M5 §8). Espejo
// chico de card-edit.ts: el socio edita MENOS que el modo carga (teléfono,
// domicilio, email) y lo que no está acá no se escribe aunque viaje en el
// FormData. Los límites de longitud son los MISMOS del cardSchema: dos
// pantallas escribiendo el mismo campo con topes distintos son un conflicto en
// diferido.
import { z } from "zod";

export const selfContactSchema = z.object({
  phone: z.string().max(40, "El teléfono no puede superar los 40 caracteres").optional(),
});

export const selfAddressSchema = z.object({
  streetId: z.coerce.number().int().positive("Calle inválida.").optional(),
  streetText: z.string().max(120, "La calle no puede superar los 120 caracteres").optional(),
  streetNumber: z.string().max(10, "La altura no puede superar los 10 caracteres").optional(),
  neighborhood: z.string().max(60, "El barrio no puede superar los 60 caracteres").optional(),
});

export const selfEmailSchema = z.object({
  email: z.email("Email inválido").max(191, "El email es demasiado largo"),
});

export type SelfAddressInput = z.infer<typeof selfAddressSchema>;

export type SelfAddressPatch = {
  streetId: number | null;
  streetText: string | null;
  streetNumber: string | null;
  neighborhood: string | null;
  /** El domicilio editado por el socio queda pendiente de constatación por la
   *  CD (docs/05 §7) — siempre, sin excepciones. */
  addressPendingReview: true;
};

export function buildSelfAddressPatch(d: SelfAddressInput): SelfAddressPatch {
  const streetId = d.streetId ?? null;
  return {
    streetId,
    // Con calle del catálogo, el texto libre sobra (mismo criterio que
    // buildPatch en card-edit.ts: dos fuentes de un domicilio es ambigüedad).
    streetText: streetId ? null : d.streetText?.trim() || null,
    streetNumber: d.streetNumber?.trim() || null,
    neighborhood: d.neighborhood?.trim() || null,
    addressPendingReview: true,
  };
}
