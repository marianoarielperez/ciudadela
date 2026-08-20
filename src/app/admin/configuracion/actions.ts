"use server";
// Pantalla de Configuración: los parámetros que el panel expone al sitio
// público. Hoy son siete —el flag, los dos contactos, los dos textos legales del
// wizard ASOCIATE y los dos ids de plan de Mercado Pago— y el que importa es
// `asociate_activo`: es la llave que
// abre y cierra el alta de socios de cara al vecino (docs/05:129).
//
// Por eso ESTA pantalla no la comparte el admin común. Es la primera consumidora
// real de `requireSuperadmin`, y vale acá el mismo recordatorio que abre
// `@/lib/auth/require-admin`: una server action NO se despacha por su URL sino
// por el id del encabezado `Next-Action` contra un manifiesto global del build,
// así que ni el proxy (matcher `/admin/:path*`) ni el chequeo de rol del layout
// corren sobre este POST. La pantalla de bloqueo de `page.tsx` esconde el
// formulario; lo único que efectivamente cierra la puerta es el
// `requireSuperadmin()` que abre esta función.
import { headers } from "next/headers";
import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireSuperadmin } from "@/lib/auth/require-admin";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { parseForm } from "@/lib/forms";
import { CONFIG_KEYS } from "@/lib/config";
import { CACHE_TAGS } from "@/lib/cache-tags";

// Sin `export`: en un módulo "use server" todo lo exportado tiene que ser una
// función async (es un endpoint).
async function clientIp(): Promise<string> {
  // Solo X-Real-IP, como en el resto del panel: las demás cabeceras de IP las
  // puede fijar el cliente si le pega directo al origen.
  return (await headers()).get("x-real-ip") ?? "unknown";
}

// Todos los mensajes en castellano a propósito: una server action es un endpoint
// público, así que un campo basura es tráfico esperable y el texto que zod
// devuelve por defecto ("Invalid input: expected \"on\"") terminaría en pantalla
// tal cual.
//
// Todos los campos son `.optional()` y eso cubre DOS casos que no son el mismo:
// el input vacío del formulario, que `parseForm` traduce a `undefined`, y la
// clave directamente ausente de un POST armado a mano. Los dos significan acá lo
// mismo —"sin valor"— y por eso ninguno necesita mensaje propio: se guardan como
// `false` / `""` más abajo. El resto de las validaciones sí lo lleva.
const schema = z.object({
  // El checkbox: el navegador manda "on" o no manda nada. Cualquier otro valor
  // es un POST a mano.
  asociateActivo: z.literal("on", { error: "Valor inválido para el botón ASOCIATE." }).optional(),
  contactPhone: z
    .string("Teléfono de contacto inválido.")
    .max(40, "El teléfono no puede superar los 40 caracteres.")
    .optional(),
  contactEmail: z
    .email("El email de contacto no es válido.")
    .max(191, "El email de contacto no puede superar los 191 caracteres.")
    .optional(),
  // Textos legales del wizard ASOCIATE. Texto PLANO: el sitio los renderiza con
  // `whitespace-pre-line`, así que acá no hay marcado que validar ni sanitizar.
  termsText: z
    .string("Términos y condiciones inválidos.")
    .max(20000, "Los términos no pueden superar los 20.000 caracteres.")
    .optional(),
  privacyConsentText: z
    .string("Texto de consentimiento inválido.")
    .max(20000, "El consentimiento no puede superar los 20.000 caracteres.")
    .optional(),
  mpPlanActiveId: z
    .string("Id de plan inválido.")
    .max(64, "El id de plan no puede superar los 64 caracteres.")
    .optional(),
  mpPlanSharedId: z
    .string("Id de plan inválido.")
    .max(64, "El id de plan no puede superar los 64 caracteres.")
    .optional(),
});

type ActionState = { error?: string };

export async function updateConfigAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireSuperadmin();
  if (!actor.ok) return { error: actor.error };
  const parsed = parseForm(schema, formData);
  if (!parsed.ok) return { error: parsed.error };

  // SIEMPRE valores JSON simples: boolean para el flag, string para todo lo demás
  // ("" = sin valor; `configReader.getString` ya devuelve null para ""). Guardar
  // un `null` de JSON obligaría a `Prisma.DbNull` en cada escritura y a
  // distinguirlo del `null` de "columna nula" en cada lectura, sin ganar nada:
  // el lector ya trata al vacío como ausente.
  const entries: Array<[string, boolean | string]> = [
    [CONFIG_KEYS.asociateActivo, parsed.data.asociateActivo === "on"],
    [CONFIG_KEYS.contactPhone, parsed.data.contactPhone ?? ""],
    [CONFIG_KEYS.contactEmail, parsed.data.contactEmail ?? ""],
    [CONFIG_KEYS.termsText, parsed.data.termsText ?? ""],
    [CONFIG_KEYS.privacyConsentText, parsed.data.privacyConsentText ?? ""],
    [CONFIG_KEYS.mpPlanActiveId, parsed.data.mpPlanActiveId ?? ""],
    [CONFIG_KEYS.mpPlanSharedId, parsed.data.mpPlanSharedId ?? ""],
  ];
  const ip = await clientIp();

  // Todas las claves se escriben en UNA transacción. Sin ella, si la segunda
  // falla (deadlock, P2024) la primera ya quedó escrita: el alta de socios
  // podría quedar cerrada en la base mientras el superadmin ve una pantalla de
  // error y cree que no se guardó nada.
  const changed = await prisma.$transaction(async (tx) => {
    const applied: Array<{ key: string; from: unknown; to: boolean | string }> = [];
    for (const [key, value] of entries) {
      const previous = await tx.configuration.findUnique({ where: { key } });
      // Un guardado sin cambios no es un evento: si se asentara igual, el día
      // que haya que reconstruir cuándo se cerró el alta de socios el asiento
      // útil estaría enterrado entre decenas de "de false a false".
      if (previous !== null && previous.value === value) continue;
      // `updatedBy` es la columna que existe desde el Módulo 0 y que hasta hoy
      // no escribía nadie: sin ella el asiento dice quién tocó qué, pero la
      // fila no sabe quién la dejó como está.
      await tx.configuration.upsert({
        where: { key },
        update: { value, updatedBy: actor.actorId },
        create: { key, value, updatedBy: actor.actorId },
      });
      applied.push({ key, from: previous?.value ?? null, to: value });
    }
    return applied;
  });

  // La invalidación va ANTES de auditar y fuera de la transacción: si algo
  // fallara acá abajo, el peor caso tiene que ser un asiento perdido, no el
  // sitio público sirviendo para siempre un botón ASOCIATE que ya no
  // corresponde. Son lecturas cacheadas bajo este tag y nada más las invalida.
  if (changed.length > 0) updateTag(CACHE_TAGS.config);

  for (const { key, from, to } of changed) {
    await audit({
      userId: actor.actorId,
      action: "config_update",
      entity: "configuration",
      entityId: key,
      // De qué a qué: el asiento tiene que alcanzar para reconstruir el estado
      // anterior sin ir a buscar otra fila. `null` en `from` es "la clave no
      // existía todavía".
      detail: { from, to },
      ip,
    });
  }

  redirect("/admin/configuracion?guardado=1");
}
