"use server";
// Las dos acciones de la CARTELERA: asentar la fijación de un aviso y sumar al
// cartel a un convocado cuyo correo rebotó después del envío masivo.
//
// ── Por qué asentar la fijación es de superadmin ─────────────────────────────
// Para los 100 convocados sin casilla, el papel pegado en la pared ES la
// notificación del Art. 5° ter, y esta fecha es la que hace correr sus veinte
// días hábiles. De ella salen la validez de su baja y su ventana de recurso. No
// es carga de datos: es el acto que da por notificada a media cohorte.
//
// Sumar a un aviso `other` NO mueve ningún plazo —el aviso queda sin fijar— así
// que es trabajo de mostrador y va con `requireAdmin`, igual que imprimir.
//
// Y la autorización va ACÁ, en la primera línea de cada action: una server
// action no se despacha por su URL sino por el id del encabezado `Next-Action`,
// así que ni el proxy ni el chequeo del layout corren sobre este POST. Lo que la
// pantalla dibuja deshabilitado es sólo display.
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { requireAdmin, requireSuperadmin } from "@/lib/auth/require-admin";
import { boardNotices } from "@/lib/board/notice";
import { parseCivilDate } from "@/lib/dates";
import { formatDateAR } from "@/lib/format";
import { parseForm } from "@/lib/forms";
import { prisma } from "@/lib/prisma";
import { civilDayOf } from "@/lib/treasury/periods";

export type PostNoticeState = { error?: string; ok?: string };
export type AddToBoardState = { error?: string; ok?: string };

export const POST_AUDIT_ACTION = "board_notice_post";
export const OTHER_AUDIT_ACTION = "board_notice_other";
export const NOTICE_AUDIT_ENTITY = "board_notice";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const postSchema = z.object({
  noticeId: z.coerce
    .number("El aviso seleccionado no es válido.")
    .int("El aviso seleccionado no es válido.")
    .positive("El aviso seleccionado no es válido."),
  // Mensaje propio: sin clave `postedAt` en el POST, zod ni llega al regex y
  // devuelve su texto por defecto EN INGLÉS, que es lo que termina en pantalla.
  postedAt: z
    .string("Ingresá la fecha en que se fijó el aviso.")
    .regex(ISO_DATE, "Ingresá la fecha en que se fijó el aviso."),
});

export async function postBoardNoticeAction(
  _prev: PostNoticeState,
  formData: FormData,
): Promise<PostNoticeState> {
  const actor = await requireSuperadmin();
  if (!actor.ok) return { error: actor.error };

  const parsed = parseForm(postSchema, formData);
  if (!parsed.ok) return { error: parsed.error };

  // El regex es sólo de forma. `parseCivilDate` rechaza el día que no existe y
  // el año mal tipeado, y devuelve el mediodía UTC con el que el proyecto
  // guarda toda fecha civil — que es además el formato canónico que el cómputo
  // de días hábiles exige.
  //
  // El tope es HOY: no se puede asentar que un cartel se fijó mañana. Una fecha
  // futura adelantaría el vencimiento del plazo de cien vecinos.
  const today = civilDayOf();
  const postedAt = parseCivilDate(parsed.data.postedAt, {
    minYear: 2020,
    maxDate: today,
    invalidError: "La fecha de fijación no existe en el calendario.",
    rangeError: "La fecha de fijación no puede ser futura: es el día en que el cartel se colgó.",
  });
  if (!postedAt.ok) return { error: postedAt.error };

  // El calendario se lee ACÁ y se INYECTA en el dominio: el módulo de días
  // hábiles se prueba sin base, y de paso el llamador puede avisar de un año
  // sin cobertura antes de llegar hasta acá (`coverageNotice`, en la pantalla).
  const holidays = (await prisma.holiday.findMany({ select: { date: true } })).map((h) => h.date);

  const result = await boardNotices.post({
    noticeId: parsed.data.noticeId,
    postedAt: postedAt.value,
    holidays,
  });
  // Los dos fallos del cómputo —año sin feriados cargados, feriado fuera del
  // formato canónico— vuelven como `error` con el texto que dice qué pasa y
  // cómo arreglarlo. No son un 500: son una tabla incompleta que el operador
  // puede completar desde Configuración.
  if (!result.ok) return { error: result.error };

  const ip = (await headers()).get("x-real-ip") ?? "unknown";
  await audit({
    userId: actor.actorId,
    action: POST_AUDIT_ACTION,
    entity: NOTICE_AUDIT_ENTITY,
    entityId: parsed.data.noticeId,
    // Ids, fechas y conteos. Ningún nombre (Ley 25.326): quiénes quedaron
    // notificados lo dicen las filas de `notifications`.
    detail: {
      postedAt: parsed.data.postedAt,
      dueAt: result.dueAt.toISOString(),
      stamped: result.stamped,
    },
    ip,
  });

  revalidatePath("/admin/reempadronamiento");
  return { ok: `Fijación asentada. La notificación queda practicada el ${formatDateAR(result.dueAt)}.` };
}

const addSchema = z.object({
  processId: z.coerce
    .number("El proceso seleccionado no es válido.")
    .int("El proceso seleccionado no es válido.")
    .positive("El proceso seleccionado no es válido."),
  memberId: z.coerce
    .number("El socio seleccionado no es válido.")
    .int("El socio seleccionado no es válido.")
    .positive("El socio seleccionado no es válido."),
});

/** El caso borde del módulo: un correo que rebota DESPUÉS del envío masivo. Ese
 *  convocado no entró en ningún cartel —cuando se armó el lote tenía casilla—
 *  así que se lo suma a un aviso `other` abierto del proceso, o se crea uno.
 *
 *  La action no "marca" al socio: el aviso lo lista solo, porque su nómina es
 *  viva hasta que se fija. Lo que hace es abrir el cartel donde va a aparecer, y
 *  verificar que efectivamente le corresponda. */
export async function addToBoardNoticeAction(
  _prev: AddToBoardState,
  formData: FormData,
): Promise<AddToBoardState> {
  const actor = await requireAdmin();
  if (!actor.ok) return { error: actor.error };

  const parsed = parseForm(addSchema, formData);
  if (!parsed.ok) return { error: parsed.error };

  const result = await boardNotices.openOther({
    processId: parsed.data.processId,
    memberId: parsed.data.memberId,
  });
  if (!result.ok) return { error: result.error };

  const ip = (await headers()).get("x-real-ip") ?? "unknown";
  await audit({
    userId: actor.actorId,
    action: OTHER_AUDIT_ACTION,
    entity: NOTICE_AUDIT_ENTITY,
    entityId: result.noticeId,
    detail: { processId: parsed.data.processId, memberId: parsed.data.memberId },
    ip,
  });

  revalidatePath("/admin/reempadronamiento");
  revalidatePath("/admin/reempadronamiento/presentaciones");
  return {
    ok: "Sumado al cartel de la sede. Imprimilo y fijalo desde el tablero del proceso.",
  };
}
