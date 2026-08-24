// Lector tipado de la tabla clave/valor `configuration`. Reemplaza el patrón
// inline de src/lib/members/service.ts:21 de acá en adelante (aquel no se
// migra en este módulo para no ampliar el diff).
import { unstable_cache } from "next/cache";
import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { CACHE_TAGS } from "@/lib/cache-tags";
import { CONFIG_KEYS } from "@/lib/config-keys";

// Las claves viven en un módulo puro (`@/lib/config-keys`) y se re-exportan acá:
// este archivo evalúa `unstable_cache` y el cliente de Prisma al cargarse, y un
// módulo de dominio que sólo quiere el nombre de una clave no tiene por qué
// arrastrar el runtime de Next. Las pantallas y las actions la siguen importando
// de donde siempre.
export { CONFIG_KEYS };

type Db = Pick<PrismaClient, "configuration">;

export function makeConfigReader(db: Db) {
  return {
    // Comparación estricta contra el Json: cualquier cosa que no sea `true`
    // (string "true", 1, null) es false. Mismo criterio que electionsOngoing.
    async getBool(key: string): Promise<boolean> {
      const row = await db.configuration.findUnique({ where: { key } });
      return row?.value === true;
    },
    async getString(key: string): Promise<string | null> {
      const row = await db.configuration.findUnique({ where: { key } });
      if (typeof row?.value !== "string") return null;
      const trimmed = row.value.trim();
      return trimmed === "" ? null : trimmed;
    },
  };
}

export const configReader = makeConfigReader(prisma);

// Lecturas cacheadas para las páginas públicas (la home es estática y se
// invalida cuando el superadmin guarda la configuración: updateConfigAction
// llama a updateTag(CACHE_TAGS.config)). El panel NO las usa — lee directo
// contra `configReader` para ver siempre el estado real.
export const getAsociateActive = unstable_cache(
  () => configReader.getBool(CONFIG_KEYS.asociateActivo),
  ["config-asociate"],
  { tags: [CACHE_TAGS.config] },
);
export const getContactInfo = unstable_cache(
  async () => ({
    phone: await configReader.getString(CONFIG_KEYS.contactPhone),
    email: await configReader.getString(CONFIG_KEYS.contactEmail),
  }),
  ["config-contact"],
  { tags: [CACHE_TAGS.config] },
);

// Textos legales del wizard ASOCIATE (M3). Se guardan como texto PLANO y se
// renderizan con `whitespace-pre-line`: nunca HTML del admin al DOM. Es un
// desvío deliberado de la spec §2 —menos superficie de XSS, y el superadmin no
// necesita marcado para un pliego de condiciones— y por eso el lector devuelve
// el string tal cual, sin sanitizar nada aguas abajo.
export type LegalTexts = { terms: string | null; privacyConsent: string | null };

export const getLegalTexts = unstable_cache(
  async (): Promise<LegalTexts> => ({
    terms: await configReader.getString(CONFIG_KEYS.termsText),
    privacyConsent: await configReader.getString(CONFIG_KEYS.privacyConsentText),
  }),
  ["config-legal"],
  { tags: [CACHE_TAGS.config] },
);

/** CSV → direcciones normalizadas, sin repetidos y sin las que ni siquiera
 *  parecen una dirección. Vacío significa "nadie": el resumen no sale y eso es
 *  preferible a fallar a una casilla inventada. La validación fina (formato) la
 *  hace el schema de la pantalla; acá el criterio es defensivo porque el valor
 *  puede haber quedado escrito por SQL. */
export function parseRecipients(csv: string | null | undefined): string[] {
  if (!csv) return [];
  return [
    ...new Set(
      csv
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s.includes("@") && s.length >= 5),
    ),
  ];
}
