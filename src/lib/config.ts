// Lector tipado de la tabla clave/valor `configuration`. Reemplaza el patrón
// inline de src/lib/members/service.ts:21 de acá en adelante (aquel no se
// migra en este módulo para no ampliar el diff).
import { unstable_cache } from "next/cache";
import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { CACHE_TAGS } from "@/lib/news/query";

export const CONFIG_KEYS = {
  asociateActivo: "asociate_activo",
  contactPhone: "contact_phone",
  contactEmail: "contact_email",
} as const;

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
