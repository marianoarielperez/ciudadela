"use server";
// El flag `elecciones_en_curso` (Art. 5° ter) por fin tiene quién lo escriba:
// hasta la 4C se cambiaba por SQL a mano (docs/05:417). Mientras está prendido,
// `canChangeCategory` bloquea los cambios de categoría — o sea que este
// checkbox mueve una regla estatutaria y por eso es superadmin y deja asiento.
//
// Vale el recordatorio que abre `@/lib/auth/require-admin`: una server action no
// se despacha por su URL sino por el id del encabezado `Next-Action`, así que ni
// el proxy ni el chequeo de rol del layout corren sobre este POST. Lo único que
// cierra la puerta es el `requireSuperadmin()` de la primera línea.
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireSuperadmin } from "@/lib/auth/require-admin";
import { CONFIG_KEYS } from "@/lib/config";
import { parseForm } from "@/lib/forms";
import { prisma } from "@/lib/prisma";

type State = { error?: string; success?: string };

// El checkbox: el navegador manda "on" o no manda nada. Cualquier otro valor es
// un POST armado a mano, y el mensaje va en castellano porque termina en
// pantalla tal cual.
const schema = z.object({
  ongoing: z.literal("on", { error: "Valor inválido." }).optional(),
});

export async function setElectionsFlagAction(_prev: State, formData: FormData): Promise<State> {
  const actor = await requireSuperadmin();
  if (!actor.ok) return { error: actor.error };
  const parsed = parseForm(schema, formData);
  if (!parsed.ok) return { error: parsed.error };

  const to = parsed.data.ongoing === "on";
  const key = CONFIG_KEYS.electionsOngoing;
  const previous = await prisma.configuration.findUnique({ where: { key } });
  // Sin cambio no se escribe ni se audita: guardar dos veces seguidas no puede
  // llenar la auditoría de asientos que no dicen nada.
  if (previous?.value === to) {
    return { success: to ? "Las elecciones ya figuraban en curso." : "Las elecciones ya figuraban cerradas." };
  }

  await prisma.configuration.upsert({
    where: { key },
    update: { value: to, updatedBy: actor.actorId },
    create: { key, value: to, updatedBy: actor.actorId },
  });
  await audit({
    userId: actor.actorId,
    action: "config_update",
    entity: "configuration",
    entityId: key,
    detail: { from: previous?.value ?? null, to },
    // Sólo X-Real-IP, igual que el resto del panel: Nginx la resuelve con el
    // módulo realip y la sobrescribe, así que no se puede rotar por request.
    ip: (await headers()).get("x-real-ip") ?? "unknown",
  });
  revalidatePath("/admin/padron-electoral");
  return {
    success: to
      ? "Elecciones en curso: el panel bloquea los cambios de categoría."
      : "Elecciones cerradas: los cambios de categoría vuelven a estar habilitados.",
  };
}
