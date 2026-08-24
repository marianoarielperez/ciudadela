"use server";
// Pantalla de Configuración: los parámetros que el panel expone al sitio
// público. Hoy son ocho —el flag, los dos contactos, los dos textos legales del
// wizard ASOCIATE, los dos ids de plan de Mercado Pago y los destinatarios del
// resumen diario a la Comisión (4C)— y el que importa es
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
//
// Desde el Módulo 4 el archivo tiene una segunda action —`createFeeValueAction`,
// el valor de la cuota— que comparte pantalla, guarda y motivo: el monto de la
// cuota es la única fuente de plata del sistema y no lo toca el admin común.
import { headers } from "next/headers";
import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireSuperadmin } from "@/lib/auth/require-admin";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { parseForm } from "@/lib/forms";
import { parseCivilDate } from "@/lib/dates";
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
  // Destinatarios del resumen diario a la Comisión (4C §6). CSV, y por eso no
  // alcanza `z.email()`. La validación es acá y no en el cron: el cron descarta
  // en silencio lo que no parece una dirección —tiene que correr igual— así que
  // el único momento en que alguien puede enterarse de un dedazo es al guardar.
  // Un renglón vacío entre comas se tolera (el superadmin separa con ", " y
  // deja una coma colgada); una dirección mal escrita, no.
  digestRecipients: z
    .string("Destinatarios del resumen inválidos.")
    .max(500, "La lista de destinatarios no puede superar los 500 caracteres.")
    .refine(
      (v) => v.split(",").every((s) => s.trim() === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim())),
      "Alguna de las direcciones del resumen diario no es válida. Separalas con comas.",
    )
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
    [CONFIG_KEYS.digestRecipients, parsed.data.digestRecipients ?? ""],
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

// ── Valor de cuota (M4, REG-34) ───────────────────────────────────────────────
//
// Registrar un valor nuevo NO edita el vigente: agrega una fila al historial con
// su vigencia. La deuda de todos se valúa al vigente (REG-16), así que el valor
// viejo deja de usarse solo, sin tocar ninguna cuota. El acta es opcional al
// registrar (la asamblea ya lo fijó y el acta puede digitalizarse después).
//
// El tope de los montos no es cosmético: las dos columnas son `Decimal(10,2)`,
// así que arriba de 99.999.999 el INSERT lo rechazaría MariaDB y el superadmin
// vería un error de Prisma en crudo en vez de una frase.
const MAX_FEE_AMOUNT = 99_999_999;

const feeValueSchema = z.object({
  activeAmount: z.coerce
    .number("Ingresá el monto de la cuota de socio activo.")
    .int("El monto tiene que ser un número entero de pesos.")
    .positive("El monto de activo tiene que ser mayor a cero.")
    .max(MAX_FEE_AMOUNT, "El monto no puede superar los $ 99.999.999."),
  sharedAmount: z.coerce
    .number("Ingresá el monto de la cuota de adherente/colaborador.")
    .int("El monto tiene que ser un número entero de pesos.")
    .positive("El monto de adherente/colaborador tiene que ser mayor a cero.")
    .max(MAX_FEE_AMOUNT, "El monto no puede superar los $ 99.999.999."),
  // El mensaje va también en `z.string(...)`, no sólo en el `.regex(...)`: sin
  // clave `validFrom` en el POST, zod ni llega al regex y devuelve su texto por
  // defecto EN INGLÉS, que es lo que termina en pantalla (ver `@/lib/forms`).
  validFrom: z
    .string("Ingresá desde cuándo rige el valor.")
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Ingresá desde cuándo rige el valor."),
  // Mismo motivo que `validFrom`: el select nunca manda otra cosa que un id de
  // la lista, pero un POST a mano con "abc" o "-3" sí, y sin mensajes propios
  // el que se muestra es el texto por defecto de zod EN INGLÉS.
  minuteId: z.coerce
    .number("El acta seleccionada no es válida.")
    .int("El acta seleccionada no es válida.")
    .positive("El acta seleccionada no es válida.")
    .optional(),
});

export async function createFeeValueAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireSuperadmin();
  if (!actor.ok) return { error: actor.error };
  const parsed = parseForm(feeValueSchema, formData);
  if (!parsed.ok) return { error: parsed.error };
  // El regex del schema es sólo de forma: `parseCivilDate` es el que rechaza el
  // día que no existe y el año mal tipeado, y devuelve el mediodía UTC con el
  // que se guardan todas las fechas civiles del proyecto.
  const validFrom = parseCivilDate(parsed.data.validFrom, {
    minYear: 2015,
    invalidError: "La fecha de vigencia no es válida.",
  });
  if (!validFrom.ok) return { error: validFrom.error };

  if (parsed.data.minuteId !== undefined) {
    const minute = await prisma.minute.findUnique({
      where: { id: parsed.data.minuteId },
      select: { id: true },
    });
    if (!minute) return { error: "El acta seleccionada no existe." };
  }

  const row = await prisma.feeValue.create({
    data: {
      // Decimal(10,2): se manda string con dos decimales, no un float.
      activeAmount: parsed.data.activeAmount.toFixed(2),
      sharedAmount: parsed.data.sharedAmount.toFixed(2),
      validFrom: validFrom.value,
      minuteId: parsed.data.minuteId ?? null,
      createdById: actor.actorId,
    },
  });
  await audit({
    userId: actor.actorId,
    action: "fee_value_create",
    entity: "fee_value",
    entityId: row.id,
    detail: {
      activeAmount: parsed.data.activeAmount,
      sharedAmount: parsed.data.sharedAmount,
      validFrom: parsed.data.validFrom,
      minuteId: parsed.data.minuteId ?? null,
    },
    ip: await clientIp(),
  });
  // Fuera de cualquier try: `redirect` funciona tirando una excepción.
  redirect("/admin/configuracion?cuota=1");
}
