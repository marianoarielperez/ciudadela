"use server";
// Las dos acciones de la etapa B del cierre: DECLARAR LAS BAJAS de los
// convocados que no se re-empadronaron, y abrir el cartel de la sede con los
// que no tienen casilla para notificarlos.
//
// ── Por qué las dos son de superadmin ────────────────────────────────────────
// Declarar una baja le quita a una persona real su condición de socia de la
// asociación (Art. 9° bis inc. c). Es el acto más grave del módulo —más que
// convocar, más que asentar una fijación— así que va con el permiso más alto.
// Y la autorización va ACÁ, en la primera línea de cada action: una server
// action no se despacha por su URL sino por el id del encabezado `Next-Action`,
// así que ni el proxy ni el chequeo de la página corren sobre este POST. Lo que
// la pantalla dibuja deshabilitado es sólo display.
//
// ── El orden de la declaración, que es lo que hay que leer antes de tocar ────
//   1. Autorización.
//   2. Selección: dedupe y tope del lote. Se corta ACÁ, ANTES de resolver el
//      acta: un lote rechazado no puede dejar un asiento fantasma en un libro
//      que la asociación presenta ante la IGJ.
//   3. Precondición del cierre: la 2ª instancia tiene que estar VENCIDA. Se
//      revalida contra la base y no se confía en la pantalla — mientras el plazo
//      corre el vecino todavía se puede presentar, y declararle la baja
//      convertiría una demora suya en una expulsión.
//   4. Primer paso: se devuelve a quiénes se va a dar de baja, con nombre,
//      número, vía de notificación y cuántos avisos se le cursaron, todo
//      resuelto contra la base. No se escribe nada.
//   5. Segundo paso: recién ahí se crea (o se elige) el acta y corre el lote.
//   6. Post-lote, y siempre DESPUÉS de que las bajas están asentadas: los
//      correos, con el presupuesto de la corrida.
//
// El molde entero —dos pasos con huella, tope antes del acta, per-socio en
// serie, baldes separados, `discardUnusedMinute` si no entró nadie, sin redirect
// con fallos parciales— es el del lote de cesantía por mora
// (`/admin/tesoreria/deudores/actions.ts`), y sus razones valen igual acá.
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { requireSuperadmin } from "@/lib/auth/require-admin";
import {
  boardNotices, NOTICE_AUDIT_ENTITY, WITHDRAWAL_NOTICE_AUDIT_ACTION,
} from "@/lib/board/notice";
import { makeMailBudget } from "@/lib/email/batch-cap";
import { parseForm } from "@/lib/forms";
import {
  createsNewMinute,
  describeMinuteSelection,
  discardUnusedMinute,
  minuteSelectionSchema,
  resolveMinuteId,
} from "@/lib/members/minute-form";
import { prisma } from "@/lib/prisma";
import { canPrepareClose } from "@/lib/reregistration/rules";
import { withdrawalConfirmToken, type WithdrawalConfirmTarget } from "@/lib/reregistration/withdrawal-confirm";
import { WITHDRAWAL_BATCH_MAX, withdrawals } from "@/lib/reregistration/withdrawals";

const BASE = "/admin/reempadronamiento/cierre";

// Sin `export`: en un módulo "use server" todo lo exportado es un endpoint.
//
// Los cuatro baldes llevan el NOMBRE de cada persona y no un contador. "3 sin
// declarar" en un lote de diez no le dice al operador a quién tiene que volver a
// mirar, y acá la diferencia entre una persona y otra es si sigue siendo socia.
export type WithdrawalState = {
  error?: string;
  declared?: number;
  /** No se pudo dar de baja: SIGUE siendo socio. */
  failures?: Array<{ memberId: number; name: string; error: string }>;
  /** Quedó de baja pero Mercado Pago no aceptó cancelar su débito. Balde propio
   *  y no `failures`: ahí diría que la baja falló sobre alguien que sí quedó de
   *  baja, y el operador repetiría una acción que ya se hizo. */
  debitFailures?: Array<{ memberId: number; name: string; count: number }>;
  /** Quedó de baja pero la presentación no se marcó, así que NO va a entrar al
   *  cartel de bajas ni se le va a notificar. Es el balde más raro y el que más
   *  hay que decir: sin él, esa persona pierde la condición de socia sin
   *  enterarse. */
  unstamped?: Array<{ memberId: number; name: string }>;
  /** Cómo salió cada aviso de baja. Los tres primeros son los que dejan a
   *  alguien SIN notificar y por lo tanto sin ventana de recurso corriendo. */
  notices?: { emailed: number; board: number; failed: string[]; blocked: number; deferred: number };
  confirm?: {
    token: string;
    minuteLabel: string;
    targets: WithdrawalConfirmTarget[];
    changed?: boolean;
  };
};

export async function declareWithdrawalsAction(
  _prev: WithdrawalState,
  formData: FormData,
): Promise<WithdrawalState> {
  const actor = await requireSuperadmin();
  if (!actor.ok) return { error: actor.error };
  const actorId = actor.actorId;

  // `getAll` y no `get`: la selección viaja como un campo `ids` por checkbox
  // tildado. Con `get` se daría de baja al PRIMERO nomás y el operador se iría
  // creyendo que declaró todo el lote. El `split` acepta además la lista
  // separada por comas (el campo oculto que sincroniza el formulario).
  const ids = [
    ...new Set(
      formData
        .getAll("ids")
        .flatMap((v) => String(v).split(","))
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n > 0),
    ),
  ].sort((a, b) => a - b);
  if (ids.length === 0) return { error: "Seleccioná al menos un convocado." };

  const processId = Number(formData.get("processId"));
  if (!Number.isInteger(processId) || processId <= 0) {
    return { error: "El proceso seleccionado no es válido." };
  }
  const process = await prisma.reregistrationProcess.findUnique({
    where: { id: processId },
    select: { id: true, status: true, secondEndsAt: true },
  });
  if (!process) return { error: "El proceso no existe." };
  // Se revalida contra la BASE. Mientras el plazo de la 2ª instancia corre el
  // vecino todavía se puede presentar, y una baja declarada un día antes
  // convierte su demora en una expulsión. `canPrepareClose` es la misma función
  // que decide si la pantalla se abre — no se reescribe la comparación acá.
  if (!canPrepareClose(process)) {
    return {
      error:
        "Todavía no se puede declarar ninguna baja: la segunda instancia tiene que estar abierta y vencida. " +
        "Mientras el plazo corre, el convocado se puede seguir presentando.",
    };
  }

  // El tope se aplica ANTES de tocar el libro de actas. El dominio lo vuelve a
  // aplicar, pero si se aplicara sólo allá el acta ya estaría creada.
  if (ids.length > WITHDRAWAL_BATCH_MAX) {
    return {
      error:
        `Seleccionaste ${ids.length} convocados y el lote acepta hasta ${WITHDRAWAL_BATCH_MAX} por vez. ` +
        "Declaralos en tandas: cada baja cancela además el débito automático en Mercado Pago y eso lleva su tiempo.",
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

  // La lista viva, resuelta contra la base: es la MISMA que dibuja la pantalla
  // (`listPendingWithdrawals`), así que el nombre que el operador lee y la
  // persona que se da de baja no pueden ser dos distintas.
  const pending = await withdrawals.listPendingWithdrawals(processId);
  const byId = new Map(pending.map((p) => [p.presentationId, p]));
  const targets: WithdrawalConfirmTarget[] = ids.flatMap((id) => {
    const p = byId.get(id);
    return p
      ? [{
          presentationId: p.presentationId,
          memberId: p.memberId,
          name: p.fullName,
          memberNumber: p.memberNumber,
          status: p.status,
          byEmail: p.byEmail,
          noticeCount: p.notices.filter((n) => n.status !== "failed").length,
        }]
      : [];
  });
  // Anti acta huérfana: si ninguna de las seleccionadas sigue correspondiendo,
  // se corta antes de tocar el libro de actas.
  if (targets.length === 0) {
    return {
      error:
        "Ninguno de los convocados que seleccionaste sigue correspondiendo a la etapa de bajas. " +
        "Recargá la pantalla: puede que se hayan presentado o que su desenlace ya esté resuelto.",
    };
  }

  // Primer paso, o segundo paso sobre algo distinto de lo confirmado: se muestra
  // a quiénes se va a dar de baja y en qué acta, y no se escribe nada.
  const token = withdrawalConfirmToken(ids, sel.data);
  const confirmed = formData.get("confirmar") === "1" && formData.get("confirmToken") === token;
  if (!confirmed) {
    let minuteLabel: string;
    try {
      minuteLabel = await describeMinuteSelection(prisma, sel.data);
    } catch (e) {
      return { error: e instanceof Error ? e.message : "No se pudo resolver el acta." };
    }
    return {
      confirm: {
        token,
        minuteLabel,
        changed: formData.get("confirmar") === "1" ? true : undefined,
        targets,
      },
    };
  }

  const createdMinute = createsNewMinute(sel.data);
  let minuteId: number;
  try {
    minuteId = await resolveMinuteId(prisma, sel.data, actorId);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo resolver el acta." };
  }

  // Sólo X-Real-IP, como en el resto del panel: las demás cabeceras de IP las
  // puede fijar el cliente si le pega directo al origen.
  const ip = (await headers()).get("x-real-ip") ?? "unknown";
  const outcome = await withdrawals.declareBatch({
    processId,
    presentationIds: ids,
    minuteId,
    actorId,
    ip,
  });
  if (outcome.error) {
    if (createdMinute) await discardUnusedMinute(prisma, minuteId);
    return { error: outcome.error };
  }

  const name = (id: number) => byId.get(id)?.fullName ?? `Presentación N° ${id}`;
  const memberOf = (id: number) => byId.get(id)?.memberId ?? 0;

  if (outcome.declared.length === 0) {
    // Compensación: un acta sin ningún movimiento es un asiento fantasma en un
    // libro que la asociación presenta ante la IGJ. Sólo se descarta la que creó
    // ESTE lote, y `discardUnusedMinute` chequea que nadie más la haya tomado.
    if (createdMinute) await discardUnusedMinute(prisma, minuteId);
    return {
      // El motivo de cada uno va en `failures` y no se repite en `error`: con un
      // solo convocado fallido se leería dos veces.
      error: "No se declaró ninguna baja.",
      failures: outcome.failures.map((f) => ({ memberId: memberOf(f.id), name: name(f.id), error: f.error })),
    };
  }

  // ── POST-LOTE: los avisos. De acá para abajo nada deshace una baja ya escrita.
  //
  // El presupuesto se dimensiona a la tanda y no al default de 50: acá no hay
  // corrida siguiente que levante un diferido, y un aviso diferido es un vecino
  // al que se le declaró la baja y al que nunca le empezó a correr la ventana de
  // recurso. Sigue siendo un techo contado contra la base, no un envío libre.
  const budget = makeMailBudget(Math.max(outcome.declared.length, 1));
  const notices = { emailed: 0, board: 0, failed: [] as string[], blocked: 0, deferred: 0 };
  for (const id of outcome.declared) {
    const result = await withdrawals.notifyWithdrawal({ presentationId: id, budget });
    if (result === "email") notices.emailed++;
    else if (result === "board") notices.board++;
    else if (result === "failed") notices.failed.push(name(id));
    else if (result === "blocked") notices.blocked++;
    else if (result === "deferred") notices.deferred++;
  }

  revalidatePath(BASE);
  revalidatePath("/admin/reempadronamiento");

  const failures = outcome.failures.map((f) => ({ memberId: memberOf(f.id), name: name(f.id), error: f.error }));
  const debitFailures = outcome.debitFailures.map((f) => ({
    memberId: memberOf(f.id),
    name: name(f.id),
    count: f.count,
  }));
  const unstamped = outcome.unstamped.map((id) => ({ memberId: memberOf(id), name: name(id) }));

  // Con éxito PARCIAL —o con cualquier aviso que no salió— no se redirige: el
  // querystring no tiene dónde poner los motivos, y esos avisos son lo único que
  // dice a quién se le declaró la baja sin notificarle. El `revalidatePath` es lo
  // que hace que la lista ya no ofrezca a los que sí salieron.
  const somethingToSay =
    failures.length > 0 ||
    debitFailures.length > 0 ||
    unstamped.length > 0 ||
    notices.failed.length > 0 ||
    notices.deferred > 0;
  if (somethingToSay) {
    return {
      declared: outcome.declared.length,
      failures: failures.length > 0 ? failures : undefined,
      debitFailures: debitFailures.length > 0 ? debitFailures : undefined,
      unstamped: unstamped.length > 0 ? unstamped : undefined,
      notices,
    };
  }

  // Fuera del try: `redirect` señaliza con una excepción y un catch se la comería.
  redirect(`${BASE}?declaradas=${outcome.declared.length}&cartelera=${notices.board}`);
}

export type WithdrawalNoticeState = { error?: string; ok?: string };

const noticeSchema = z.object({
  processId: z.coerce
    .number("El proceso seleccionado no es válido.")
    .int("El proceso seleccionado no es válido.")
    .positive("El proceso seleccionado no es válido."),
});

/** Abre el cartel de la sede con las bajas ya declaradas de quienes no tienen
 *  casilla utilizable — que en este padrón son la enorme mayoría.
 *
 *  No asienta ninguna fijación ni corre ningún plazo: eso lo hace el tablero,
 *  con `postBoardNoticeAction`, y es ahí donde la notificación queda fehaciente
 *  al cumplirse los veinte días hábiles. Acá sólo se crea el papel que hay que
 *  imprimir, así que va con el mismo permiso que el resto de esta pantalla y no
 *  toca ninguna ventana de recurso. */
export async function openWithdrawalNoticeAction(
  _prev: WithdrawalNoticeState,
  formData: FormData,
): Promise<WithdrawalNoticeState> {
  const actor = await requireSuperadmin();
  if (!actor.ok) return { error: actor.error };

  const parsed = parseForm(noticeSchema, formData);
  if (!parsed.ok) return { error: parsed.error };

  const result = await boardNotices.openWithdrawalNotice(parsed.data.processId);
  if (!result.ok) return { error: result.error };

  const ip = (await headers()).get("x-real-ip") ?? "unknown";
  await audit({
    userId: actor.actorId,
    action: WITHDRAWAL_NOTICE_AUDIT_ACTION,
    entity: NOTICE_AUDIT_ENTITY,
    entityId: result.noticeId,
    // Ids y conteos, ningún nombre (Ley 25.326).
    detail: { processId: parsed.data.processId, kind: "withdrawal", recipients: result.recipients },
    ip,
  });

  revalidatePath(BASE);
  revalidatePath("/admin/reempadronamiento");
  return {
    ok:
      `El cartel de bajas quedó armado con ${result.recipients} ` +
      `${result.recipients === 1 ? "socio" : "socios"}. Imprimilo desde el tablero del proceso y asentá ahí la ` +
      "fecha en que lo colgás: la notificación queda practicada recién al cumplirse los veinte días hábiles.",
  };
}
