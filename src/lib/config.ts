// Lector tipado de la tabla clave/valor `configuration`. Reemplaza el patrón
// inline de src/lib/members/service.ts:21 de acá en adelante (aquel no se
// migra en este módulo para no ampliar el diff).
import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

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
