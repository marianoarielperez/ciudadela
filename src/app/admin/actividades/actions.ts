"use server";
// ABM del calendario de actividades de los salones. Igual que el de noticias,
// cada action de este archivo es un endpoint HTTP público: Next NO despacha una
// server action por su URL sino por el id del encabezado `Next-Action` contra un
// manifiesto global del build, así que ni el proxy (matcher `/admin/:path*`) ni
// el chequeo de rol de `admin/layout.tsx` corren acá. Ver el encabezado de
// `@/lib/auth/require-admin`. El `requireAdmin()` que abre cada función no es
// ceremonia: es el único control que hay.
//
// La otra frontera es la de solapamiento. Los dos salones son un espacio físico:
// dos actividades activas del mismo salón y año que compartan día y horario no
// pueden convivir, y el alta que choca se rechaza NOMBRANDO a la existente para
// que el operador sepa con qué se pisó.
import { headers } from "next/headers";
import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { parseForm } from "@/lib/forms";
import { findOverlap, parseWeekdays, timeToMinutes } from "@/lib/activities/rules";
import { activitiesQueries } from "@/lib/activities/query";
import { CACHE_TAGS } from "@/lib/news/query";

// Sin `export`: en un módulo "use server" todo lo exportado tiene que ser una
// función async (es un endpoint).
async function clientIp(): Promise<string> {
  // Solo X-Real-IP, como en el resto del panel: las demás cabeceras de IP las
  // puede fijar el cliente si le pega directo al origen.
  return (await headers()).get("x-real-ip") ?? "unknown";
}

// Todos los mensajes en castellano a propósito: una server action es un endpoint
// público, así que un campo ausente o basura es tráfico esperable y el texto que
// zod devuelve por defecto ("Invalid input: expected number, received NaN")
// terminaría en pantalla tal cual.
const activitySchema = z.object({
  name: z
    .string()
    .min(1, "Ingresá el nombre de la actividad.")
    .max(120, "El nombre no puede superar los 120 caracteres."),
  room: z.enum(["historic", "glass"], { error: "Elegí el salón." }),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora de inicio inválida."),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora de fin inválida."),
  year: z.coerce.number("Año inválido.").int("Año inválido.").min(2024, "Año inválido.").max(2100, "Año inválido."),
  active: z.literal("on").optional(),
});

const idSchema = z.object({
  id: z.coerce
    .number("Actividad inválida.")
    .int("Actividad inválida.")
    .positive("Actividad inválida."),
});

type ActionState = { error?: string };

const NOT_FOUND = "La actividad no existe.";
const BACKWARDS_RANGE = "La hora de fin tiene que ser posterior a la de inicio.";

// Valida el formulario completo (campos + weekdays fuera de parseForm porque son
// checkboxes múltiples) y la regla de solapamiento. Devuelve los datos listos
// para escribir o el error redactado.
async function validateActivity(formData: FormData, selfId?: number) {
  const parsed = parseForm(activitySchema, formData);
  if (!parsed.ok) return { ok: false as const, error: parsed.error };
  const weekdays = parseWeekdays(formData.getAll("weekdays").map(String));
  if (!weekdays.ok) return { ok: false as const, error: weekdays.error };
  const start = timeToMinutes(parsed.data.startTime);
  const end = timeToMinutes(parsed.data.endTime);
  // ESTE chequeo va ANTES de findOverlap y no es cosmético: findOverlap da por
  // sentado que start < end y compara `start < oEnd && oStart < end`. Con un
  // rango invertido ("20:00 a 08:00") esa condición no se cumple contra nada, o
  // sea que la actividad entraría sin ningún control de solape y encima con un
  // horario que no significa nada. El orden acá es la guarda.
  if (start === null || end === null || start >= end) {
    return { ok: false as const, error: BACKWARDS_RANGE };
  }
  // `data` es exactamente lo que va a la fila: sin `id`, para no mandarle a
  // Prisma una clave que no le corresponde fijar. El id propio entra solo en el
  // candidato que mira `findOverlap`, que lo necesita para no comparar una
  // actividad contra sí misma al editarla.
  const data = {
    name: parsed.data.name,
    room: parsed.data.room,
    weekdays: weekdays.value,
    startTime: parsed.data.startTime,
    endTime: parsed.data.endTime,
    year: parsed.data.year,
    active: parsed.data.active === "on",
  };
  // Una actividad oculta no ocupa el salón: no se muestra en el sitio público y
  // se guarda como borrador aunque pise a otra.
  if (data.active) {
    const existing = await activitiesQueries.allForAdmin(data.year);
    const clash = findOverlap({ ...data, id: selfId }, existing);
    if (clash) {
      return {
        ok: false as const,
        error: `Se superpone con "${clash.name}" (${clash.startTime}–${clash.endTime}) en el mismo salón. Ajustá el horario o los días.`,
      };
    }
  }
  return { ok: true as const, data };
}

export async function createActivityAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireAdmin();
  if (!actor.ok) return { error: actor.error };
  const validated = await validateActivity(formData);
  if (!validated.ok) return { error: validated.error };
  const data = validated.data;
  const activity = await prisma.activity.create({ data });
  await audit({
    userId: actor.actorId,
    action: "activity_create",
    entity: "activity",
    entityId: activity.id,
    detail: { name: data.name, room: data.room, year: data.year },
    ip: await clientIp(),
  });
  // Sin esto la página pública seguiría sirviendo la grilla vieja para siempre:
  // getActivitiesForYear y getActivityYears están cacheadas con este tag y nada
  // más lo invalida.
  updateTag(CACHE_TAGS.activities);
  redirect("/admin/actividades");
}

export async function updateActivityAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireAdmin();
  if (!actor.ok) return { error: actor.error };
  const parsedId = parseForm(idSchema, formData);
  if (!parsedId.ok) return { error: parsedId.error };
  const existing = await prisma.activity.findUnique({ where: { id: parsedId.data.id } });
  if (!existing) return { error: NOT_FOUND };
  // El id propio va a validateActivity para que findOverlap NO se compare la
  // actividad contra sí misma: si no, editarle el nombre sin tocar el horario
  // se rechazaría por pisarse con su propia fila.
  const validated = await validateActivity(formData, existing.id);
  if (!validated.ok) return { error: validated.error };
  const data = validated.data;
  await prisma.activity.update({ where: { id: existing.id }, data });
  await audit({
    userId: actor.actorId,
    action: "activity_update",
    entity: "activity",
    entityId: existing.id,
    detail: { name: data.name, room: data.room, year: data.year },
    ip: await clientIp(),
  });
  updateTag(CACHE_TAGS.activities);
  redirect("/admin/actividades");
}

export async function deleteActivityAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireAdmin();
  if (!actor.ok) return { error: actor.error };
  const parsed = parseForm(idSchema, formData);
  if (!parsed.ok) return { error: parsed.error };
  const existing = await prisma.activity.findUnique({ where: { id: parsed.data.id } });
  if (!existing) return { error: NOT_FOUND };
  await prisma.activity.delete({ where: { id: existing.id } });
  // El asiento describe lo que había: después del delete la fila ya no está
  // para reconstruirlo.
  await audit({
    userId: actor.actorId,
    action: "activity_delete",
    entity: "activity",
    entityId: existing.id,
    detail: { name: existing.name, room: existing.room, year: existing.year },
    ip: await clientIp(),
  });
  updateTag(CACHE_TAGS.activities);
  redirect("/admin/actividades");
}
