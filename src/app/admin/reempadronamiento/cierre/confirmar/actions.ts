"use server";
// La acción de la etapa C: CERRAR el Libro de Registro de Asociados y abrir el
// siguiente. Es el acto más grave del panel entero — irreversible salvo
// restaurando un backup, y así se lo advierte la pantalla al operador.
//
// El orden, que es lo que hay que leer antes de tocar:
//   1. Autorización (superadmin, resuelto contra la fila viva de `User`). Va
//      ACÁ y no sólo en la página: una server action se despacha por el id del
//      encabezado `Next-Action`, no por su URL.
//   2. La confirmación explícita. Sin la casilla tildada no se resuelve ni el
//      acta: el POST armado a mano tampoco puede saltearla.
//   3. Pre-validación contra la base, ANTES de crear el acta (patrón
//      anti-acta-huérfana): etapa correcta y cero bloqueos. La transacción
//      vuelve a validar TODO adentro — esto sólo evita crear un acta que el
//      dominio va a rechazar dos líneas después.
//   4. Resolver el acta de cierre (o crearla).
//   5. `closeBook`: la transacción única. Si falla, se descarta el acta que
//      ESTE cierre creó (`discardUnusedMinute` verifica que nadie la tomó).
//   6. POST-COMMIT: el asiento ESTRICTO. El cierre del libro ante la IGJ es el
//      caso en que el asiento ES la señal, así que se usa `auditStrict` con el
//      patrón `auditAfterCommit` del modo carga: si no se pudo escribir, el
//      operador lo VE en la pantalla de resumen en vez de enterarse nunca.
//   7. Invalidar el caché del sitio público y redirigir al resumen.
import { revalidatePath, updateTag } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auditStrict } from "@/lib/audit";
import { requireSuperadmin } from "@/lib/auth/require-admin";
import { CACHE_TAGS } from "@/lib/cache-tags";
import {
  createsNewMinute,
  discardUnusedMinute,
  minuteSelectionSchema,
  resolveMinuteId,
} from "@/lib/members/minute-form";
import { prisma } from "@/lib/prisma";
import {
  closeBlockers,
  cohortNotTerminalWhere,
  unresolvedPresentationsWhere,
} from "@/lib/reregistration/close";
import {
  BOOK_AUDIT_ENTITY,
  BOOK_CLOSE_AUDIT_ACTION,
  closeBookService,
} from "@/lib/reregistration/close-book";
import { canPrepareClose } from "@/lib/reregistration/rules";

const BASE = "/admin/reempadronamiento/cierre/confirmar";

export type CloseBookState = { error?: string };

// Del error sólo el código, nunca el objeto: los errores de Prisma traen la
// consulta con datos del socio en claro y el log de PM2 no está cubierto por
// los cuidados de docs/08 (Ley 25.326).
function codeOf(e: unknown): string {
  return typeof e === "object" && e !== null && "code" in e ? String(e.code) : "unknown";
}

export async function closeBookAction(_prev: CloseBookState, formData: FormData): Promise<CloseBookState> {
  const actor = await requireSuperadmin();
  if (!actor.ok) return { error: actor.error };
  const actorId = actor.actorId;

  const processId = Number(formData.get("processId"));
  if (!Number.isInteger(processId) || processId <= 0) {
    return { error: "El proceso seleccionado no es válido." };
  }

  // La confirmación explícita, antes que ninguna otra cosa: sin ella no se
  // resuelve el acta ni se toca la base.
  if (formData.get("confirmar") !== "1") {
    return { error: "Tildá la confirmación: este paso solo se revierte restaurando un backup." };
  }

  // Pre-validación contra la base. La MISMA función que habilita la etapa B y
  // los MISMOS `where` que la transacción re-valida adentro: acá sólo se evita
  // crear un acta huérfana, la palabra final la tiene la transacción.
  const process = await prisma.reregistrationProcess.findUnique({
    where: { id: processId },
    select: { id: true, status: true, secondEndsAt: true },
  });
  if (!process) return { error: "El proceso no existe." };
  if (process.status === "closed") {
    return { error: "El proceso ya está cerrado: el libro nuevo ya se abrió." };
  }
  if (!canPrepareClose(process)) {
    return {
      error:
        "Todavía no se puede cerrar el libro: la segunda instancia tiene que estar abierta y vencida.",
    };
  }
  const unresolved = await prisma.presentation.count({ where: unresolvedPresentationsWhere(processId) });
  const notTerminal = await prisma.presentation.count({ where: cohortNotTerminalWhere(processId) });
  const blockers = closeBlockers([
    { kind: "unresolved_presentations", count: unresolved },
    { kind: "cohort_not_terminal", count: notTerminal },
  ]);
  if (blockers.length > 0) {
    return {
      error:
        "El checklist tiene condiciones bloqueantes vivas: resolvé las presentaciones pendientes y " +
        "los convocados sin desenlace antes de cerrar.",
    };
  }

  // El acta se parsea aparte y nunca combinada con otro schema:
  // `minuteSelectionSchema` es un `z.union` y `parseForm` sólo sabe recorrer un
  // ZodObject con `.shape`.
  const raw: Record<string, string> = {};
  for (const [k, v] of formData.entries()) {
    if (typeof v === "string" && v.trim() !== "") raw[k] = v.trim();
  }
  const sel = minuteSelectionSchema.safeParse(raw);
  if (!sel.success) {
    return { error: sel.error.issues[0]?.message ?? "Elegí un acta existente o cargá una nueva." };
  }

  const createdMinute = createsNewMinute(sel.data);
  let minuteId: number;
  try {
    minuteId = await resolveMinuteId(prisma, sel.data, actorId);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo resolver el acta." };
  }

  const result = await closeBookService.closeBook({ processId, minuteId, actorId });
  if (!result.ok) {
    // Compensación: un acta de cierre sin ningún cierre es un asiento fantasma
    // en un libro que la asociación presenta ante la IGJ. Sólo se descarta la
    // que creó ESTE intento, y `discardUnusedMinute` chequea que nadie más la
    // haya tomado en el medio.
    if (createdMinute) await discardUnusedMinute(prisma, minuteId);
    return { error: result.error };
  }

  // ── POST-COMMIT: de acá para abajo el libro YA está cerrado y nada lo deshace.
  //
  // El asiento es ESTRICTO (auditStrict propaga) porque acá el asiento ES la
  // señal: el cierre del libro es el acto que la asociación presenta ante la
  // IGJ. Si no se pudo escribir, no se esconde detrás de un console.error —el
  // resumen se lo dice al operador con todas las letras (`asiento=0`)— pero
  // tampoco convierte en error una transacción que ya está commiteada.
  const ip = (await headers()).get("x-real-ip") ?? "unknown";
  let audited = true;
  try {
    await auditStrict({
      userId: actorId,
      action: BOOK_CLOSE_AUDIT_ACTION,
      entity: BOOK_AUDIT_ENTITY,
      entityId: result.oldBookId,
      // Ids y conteos, nunca nombres ni DNIs (Ley 25.326).
      detail: {
        oldBookId: result.oldBookId,
        newBookId: result.newBookId,
        migrated: result.migrated,
        withdrawnCount: result.withdrawnCount,
        minuteId,
      },
      ip,
    });
  } catch (e) {
    audited = false;
    console.error("[cierre] no se pudo asentar", BOOK_CLOSE_AUDIT_ACTION, "del libro", result.oldBookId, "code:", codeOf(e));
  }

  revalidatePath(BASE);
  revalidatePath("/admin/reempadronamiento");
  revalidatePath("/admin/socios");
  // La home pública y la guarda de ASOCIATE leen si hay proceso vivo, y esas
  // lecturas están cacheadas con el tag `config` (`src/lib/config.ts`). El
  // cierre limpió la clave: sin esta línea el sitio seguiría con ASOCIATE
  // suspendido —y sin volver a ofrecer asociarse— hasta que el caché venciera
  // solo. Va en la ACTION y no en el servicio: el servicio es un módulo de
  // dominio inyectable y no puede importar `next/cache`.
  updateTag(CACHE_TAGS.config);

  // Fuera del try: redirect() señaliza con una excepción y un catch se la
  // comería. El resumen recibe ids y conteos por querystring — nada personal.
  const params = new URLSearchParams({
    cerrado: String(result.oldBookNumber),
    nuevo: String(result.newBookNumber),
    migrados: String(result.migrated),
    bajas: String(result.withdrawnCount),
  });
  if (!audited) params.set("asiento", "0");
  redirect(`${BASE}?${params.toString()}`);
}
