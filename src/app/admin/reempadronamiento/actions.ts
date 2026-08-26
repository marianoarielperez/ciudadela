"use server";
// Las dos acciones de FASE del re-empadronamiento: convocar el proceso y abrir
// la segunda instancia.
//
// ── Por qué las dos son de superadmin ────────────────────────────────────────
// Convocar le abre a ciento y pico de vecinos un plazo de treinta días del que
// cuelga su condición de socio, y abrir la segunda instancia les abre el último
// —el que termina en la baja del Art. 9° bis—. No son consultas ni carga de
// datos: son actos de la Comisión. Validar una presentación, en cambio, es del
// rol común de administración y llega en otra pantalla.
//
// Y la autorización va ACÁ, en la primera línea de cada action, no en la
// navegación: una server action no se despacha por su URL sino por el id del
// encabezado `Next-Action`, así que ni el proxy ni el chequeo del layout corren
// sobre este POST. El rol del token puede tener hasta 8 horas de atraso;
// `requireSuperadmin` resuelve contra la fila viva de `User`.
//
// ── El acta huérfana ─────────────────────────────────────────────────────────
// Mismo problema y misma resolución que las acciones societarias sobre un socio
// (ver el comentario largo de `../socios/[id]/actions.ts`): el servicio abre su
// propia transacción y puede rechazar después de que el acta ya se creó, y un
// acta sin ningún movimiento es basura en un libro que la asociación presenta
// ante la IGJ. Orden obligatorio: PRE-VALIDAR con las mismas reglas que corre el
// servicio → resolver el acta → ejecutar → si falla, COMPENSAR con
// `discardUnusedMinute`. Acá el rechazo frecuente es concreto: "ya hay un
// proceso en curso", que es exactamente lo que pasa cuando dos admins abren la
// pantalla de convocatoria a la vez.
import { revalidatePath, updateTag } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { requireSuperadmin } from "@/lib/auth/require-admin";
import { CACHE_TAGS } from "@/lib/cache-tags";
import { parseCivilDate } from "@/lib/dates";
import { formatDateAR } from "@/lib/format";
import { parseForm } from "@/lib/forms";
import {
  createsNewMinute, discardUnusedMinute, minuteSelectionSchema, resolveMinuteId,
} from "@/lib/members/minute-form";
import { requireOpenBook } from "@/lib/members/service";
import { prisma } from "@/lib/prisma";
import { firstEndsAt, hasExpired } from "@/lib/reregistration/rules";
import {
  CALL_AUDIT_ACTION, LIVE_PROCESS_STATUSES, PROCESS_AUDIT_ENTITY, reregistration, SECOND_AUDIT_ACTION,
} from "@/lib/reregistration/service";
import { civilDayOf } from "@/lib/treasury/periods";

export type CallState = { error?: string };
export type SecondState = { error?: string; ok?: boolean };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const callSchema = z.object({
  calledAt: z.string().regex(ISO_DATE, "Ingresá la fecha de la convocatoria."),
  igjApprovedAt: z.string().regex(ISO_DATE, "Fecha de oficialización inválida.").optional(),
  estimatedElectionAt: z.string().regex(ISO_DATE, "Fecha estimada de elecciones inválida.").optional(),
});

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : "Error inesperado.";
}

/** El acta viaja por su propio schema y NUNCA fusionada con el del formulario:
 *  `minuteSelectionSchema` es un `z.union` y `parseForm` sólo sabe reconocer
 *  campos opcionales sobre un `ZodObject` con `.shape`. Fusionarlos deja a los
 *  campos requeridos del acta sin su mensaje en castellano y saca a la pantalla
 *  el texto genérico de zod, en inglés. Es el mismo apaño que usan las otras
 *  cinco acciones con acta del panel. */
function parseMinute(formData: FormData) {
  const raw: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string" && v.trim() !== "") raw[k] = v.trim();
  return minuteSelectionSchema.safeParse(raw);
}

export async function callProcessAction(_prev: CallState, formData: FormData): Promise<CallState> {
  const actor = await requireSuperadmin();
  if (!actor.ok) return { error: actor.error };
  const actorId = actor.actorId;

  const parsed = parseForm(callSchema, formData);
  if (!parsed.ok) return { error: parsed.error };

  // ── El TOPE de la fecha de convocatoria ───────────────────────────────────
  // El regex del schema es sólo de forma. Sin tope, un año mal tipeado —el
  // pasado en vez de éste— crea un proceso NACIDO VENCIDO: salen ciento y pico
  // de correos anunciando un plazo que ya pasó, la acción de abrir la segunda
  // instancia queda habilitada de entrada y no hay ninguna pantalla para
  // cancelar un proceso. Se acota con la misma guarda compartida con la que ya
  // se acota la fecha del ACTA en este mismo formulario (`parseMinuteDate`).
  //
  // Arriba, HOY: la Comisión no puede convocar algo que todavía no resolvió, y
  // de esta fecha arranca el plazo de treinta días.
  const today = civilDayOf();
  const called = parseCivilDate(parsed.data.calledAt, {
    minYear: 2020,
    maxDate: today,
    invalidError: "La fecha de la convocatoria no existe en el calendario.",
    rangeError:
      "La fecha de la convocatoria tiene que estar entre 2020 y hoy: no se puede convocar algo que todavía no se resolvió.",
  });
  if (!called.ok) return { error: called.error };
  // Abajo, el plazo mismo, que ninguna cota de año atrapa: una fecha de hace más
  // de treinta días deja la primera instancia vencida antes de empezar. Se arma
  // con `firstEndsAt` —la misma función con la que el servicio asienta el
  // plazo— y se pregunta con `hasExpired`, el único comparador de plazos del
  // módulo: acá no se escribe una comparación propia.
  const ends = firstEndsAt(called.value);
  if (hasExpired(ends, today)) {
    return {
      error: `Con esa fecha el plazo de la primera instancia ya estaría vencido (venció el ${formatDateAR(ends)}). Revisá la fecha de la convocatoria.`,
    };
  }
  // Las dos opcionales se validan igual: una fecha imposible ("31/02") que
  // `civilDateUtc` rueda en silencio quedaría asentada como otro día, y de la
  // oficialización IGJ cuelga la cuenta regresiva de los 90 días del Art. 40.
  const igj = parsed.data.igjApprovedAt
    ? parseCivilDate(parsed.data.igjApprovedAt, { invalidError: "La fecha de oficialización no existe en el calendario." })
    : null;
  if (igj && !igj.ok) return { error: igj.error };
  const election = parsed.data.estimatedElectionAt
    ? parseCivilDate(parsed.data.estimatedElectionAt, { invalidError: "La fecha estimada de elecciones no existe en el calendario." })
    : null;
  if (election && !election.ok) return { error: election.error };

  const sel = parseMinute(formData);
  if (!sel.success) {
    return { error: sel.error.issues[0]?.message ?? "Elegí un acta existente o cargá una nueva." };
  }

  // ── Pre-validación, ANTES de tocar el acta ────────────────────────────────
  // Las mismas dos reglas que el servicio vuelve a chequear adentro de su
  // transacción: acá son para el libro y para el mensaje, nunca la única
  // defensa.
  let bookId: number;
  try {
    bookId = (await requireOpenBook(prisma)).id;
  } catch (e) {
    return { error: messageOf(e) };
  }
  const live = await prisma.reregistrationProcess.findFirst({
    where: { status: { in: [...LIVE_PROCESS_STATUSES] } },
    select: { id: true },
  });
  if (live) return { error: "Ya hay un proceso de re-empadronamiento en curso." };

  const createdMinute = createsNewMinute(sel.data);
  let minuteId: number;
  try {
    minuteId = await resolveMinuteId(prisma, sel.data, actorId);
  } catch (e) {
    return { error: messageOf(e) };
  }

  let result: Awaited<ReturnType<typeof reregistration.activate>>;
  try {
    result = await reregistration.activate({
      bookId,
      calledAt: called.value,
      minuteId,
      igjApprovedAt: igj?.ok ? igj.value : null,
      estimatedElectionAt: election?.ok ? election.value : null,
      actorId,
    });
  } catch (e) {
    // Compensación: el acta recién creada se descarta si no la usa nadie.
    if (createdMinute) await discardUnusedMinute(prisma, minuteId);
    return { error: messageOf(e) };
  }
  if (!result.ok) {
    if (createdMinute) await discardUnusedMinute(prisma, minuteId);
    return { error: result.error };
  }

  const ip = (await headers()).get("x-real-ip") ?? "unknown";
  await audit({
    userId: actorId,
    action: CALL_AUDIT_ACTION,
    entity: PROCESS_AUDIT_ENTITY,
    entityId: result.processId,
    // SIN NOMBRES NI DIRECCIONES (Ley 25.326): números de socio y conteos. Los
    // ids de los que quedaron sin aviso van igual porque son el rastro de a
    // quién hay que atender, y un número de socio ya está en el asiento de
    // cualquier movimiento del padrón.
    detail: {
      bookId,
      cohortSize: result.cohortSize,
      emailed: result.emailed,
      boardCount: result.boardCount,
      minuteId,
      failedIds: result.failedIds,
      blockedIds: result.blockedIds,
      deferredIds: result.deferredIds,
    },
    ip,
  });

  revalidatePath("/admin/reempadronamiento");
  // La home pública y la guarda de ASOCIATE leen si hay proceso vivo, y esas
  // lecturas están cacheadas con el tag `config` (`src/lib/config.ts`). Sin esta
  // línea el sitio seguiría ofreciendo asociarse —y sin el botón REEMPADRONATE—
  // hasta que el caché venciera solo. Va en la ACTION y no en el servicio: el
  // servicio es un módulo de dominio inyectable y no puede importar `next/cache`.
  updateTag(CACHE_TAGS.config);

  // Fuera del try: redirect() señaliza con una excepción y el catch se la comería.
  redirect("/admin/reempadronamiento");
}

const secondSchema = z.object({
  processId: z.coerce.number().int().positive(),
  /** La escotilla de la Comisión: el Art. 9° bis no le impide abrir la segunda
   *  instancia antes de que venza la primera. Exige tilde explícito en la
   *  pantalla; sin él el servicio corta por `hasExpired`.
   *
   *  Se exige el literal `"on"` —lo que manda un checkbox tildado— y NO
   *  `z.coerce.boolean()`: en zod 4 un campo ausente (que es lo que manda un
   *  checkbox SIN tildar) falla como "nonoptional" antes de llegar a
   *  coercionar, así que la acción reventaba con un mensaje en inglés en el
   *  camino normal. Verificado con un test. */
  force: z.literal("on").optional(),
});

export async function startSecondAction(_prev: SecondState, formData: FormData): Promise<SecondState> {
  const actor = await requireSuperadmin();
  if (!actor.ok) return { error: actor.error };

  const parsed = parseForm(secondSchema, formData);
  if (!parsed.ok) return { error: parsed.error };

  const result = await reregistration.startSecond({
    processId: parsed.data.processId,
    actorId: actor.actorId,
    force: parsed.data.force === "on",
  });
  if (!result.ok) return { error: result.error };

  const ip = (await headers()).get("x-real-ip") ?? "unknown";
  await audit({
    userId: actor.actorId,
    action: SECOND_AUDIT_ACTION,
    entity: PROCESS_AUDIT_ENTITY,
    entityId: result.processId,
    detail: {
      secondEndsAt: result.secondEndsAt.toISOString(),
      pending: result.pending,
      emailed: result.emailed,
      boardCount: result.boardCount,
      forced: parsed.data.force === "on",
      failedIds: result.failedIds,
      blockedIds: result.blockedIds,
      deferredIds: result.deferredIds,
    },
    ip,
  });

  revalidatePath("/admin/reempadronamiento");
  return { ok: true };
}
