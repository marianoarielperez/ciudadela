"use server";
// Acciones de la bandeja de solicitudes. Mismo esqueleto que
// `src/app/admin/socios/[id]/actions.ts`: guarda propia, el acta parseada
// aparte, la compensación del acta huérfana, auditoría con IP y `redirect`
// fuera de todo `try`.
//
// ── El acta huérfana, en versión masiva ───────────────────────────────────────
// El asiento corre en la transacción del recorder, así que el acta se crea
// ANTES y podría quedar sin ningún movimiento colgando (basura en un libro que
// la asociación presenta ante la IGJ). La resolución es la misma de dos partes:
//   1. Pre-validación: si NINGUNA de las solicitudes elegidas está en un estado
//      asentable, se corta antes de tocar el acta. Es el caso frecuente —dos
//      admins mirando la misma bandeja, un lote ya asentado que se reenvía.
//   2. Compensación: si aun así no se asentó ninguna, `discardUnusedMinute`
//      borra el acta recién creada siempre que no la esté usando nadie.
// Con éxitos parciales el acta SÍ queda: tiene asientos reales adentro.
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth/require-admin";
import { mailer } from "@/lib/email";
import { applicationRejectedEmail, portalInvite } from "@/lib/email/templates";
import { parseForm } from "@/lib/forms";
import { prisma } from "@/lib/prisma";
import { tokens } from "@/lib/tokens";
import { accountEmailNotice } from "@/lib/members/account-email-notice";
import {
  createsNewMinute, discardUnusedMinute, minuteSelectionSchema, resolveMinuteId,
} from "@/lib/members/minute-form";
import type { AccountEmailMove } from "@/lib/members/write";
import { addMonthsUtc, REJECTION_BLOCK_MONTHS } from "@/lib/applications/eligibility";
import { applicationRecorder, RECORDABLE_STATUSES } from "@/lib/applications/record";
import type { RecordResult } from "@/lib/applications/record";
import { parseApplicationFilters, parseApplicationsPage } from "@/lib/applications/query";
import { changesFeeAmount, DECIDABLE_STATUSES, isDecidable } from "@/lib/applications/decision";
import { categoryAllowedForResidence, WEB_CATEGORIES } from "@/lib/applications/wizard";
import { mpErrorLog } from "@/lib/mp/error-log";
import { mpGateway } from "@/lib/mp/gateway";
import { planIdForCategory } from "@/lib/mp/plans";

// Sin `export`: en un módulo "use server" todo lo exportado es un endpoint.
//
// `failures` lleva el id Y el motivo de cada solicitud que no entró: decirle al
// operador "3 quedaron sin asentar, revisalas a mano" sin decirle CUÁLES es
// ordenarle una acción sin darle los medios (en un lote de 20 no hay forma de
// deducirlo desde la bandeja). La pantalla las lista con link a cada una.
type State = { error?: string; recorded?: number; failures?: Array<{ id: number; error: string }> };

/** El estado de las dos acciones individuales del detalle. */
type DecisionState = { error?: string };

/** El `code` de un error, y NADA más: los de nodemailer traen el sobre SMTP y
 *  los de Prisma el registro entero, o sea datos personales en claro al log
 *  (docs/08, Ley 25.326). */
function codeOf(e: unknown): string {
  return typeof e === "object" && e !== null && "code" in e ? String(e.code) : "unknown";
}

async function clientIp(): Promise<string> {
  // Sólo X-Real-IP, como en el login: el resto de las cabeceras de IP las puede
  // fijar el cliente si le pega directo al origen.
  return (await headers()).get("x-real-ip") ?? "unknown";
}

/** La invitación de acceso al portal, después de que el asiento ya está firme.
 *
 *  Sólo a las fichas con el email VERIFICADO y sin cuenta: la invitación crea la
 *  contraseña de quien tenga ese buzón, así que no puede caer en una dirección
 *  sin confirmar (es la misma regla que `verificationTarget` en el circuito de
 *  socios). La ficha que nace `declared` recibe la invitación recién cuando el
 *  vecino canjea su enlace de verificación (`/verificar`, Task 15).
 *
 *  Best-effort a propósito: el asiento societario ya está commiteado y un hipo
 *  del SMTP no puede deshacerlo ni romperle la pantalla al operador. Del error
 *  se conserva sólo el código: los de nodemailer traen el sobre SMTP, o sea
 *  datos del socio en claro (docs/08, Ley 25.326).
 */
async function inviteRecordedMembers(memberIds: number[]): Promise<void> {
  for (const id of memberIds) {
    try {
      const member = await prisma.member.findUnique({ where: { id } });
      if (!member?.email || member.emailStatus !== "verified" || member.userId !== null) continue;
      // Un enlace vivo por socio: si el asiento se repitiera, el anterior muere.
      await tokens.revokeForMember(member.id, ["password_invitation"]);
      const raw = await tokens.issue({ purpose: "password_invitation", memberId: member.id });
      const { message, summary } = portalInvite({
        kind: "password_invitation",
        name: member.fullName,
        baseUrl: process.env.AUTH_URL ?? "http://localhost:3000",
        token: raw,
      });
      await mailer.sendToMember({
        memberId: member.id, to: member.email, type: "password_invitation", message, summary,
      });
    } catch (e) {
      console.error("[solicitudes] no se pudo enviar la invitación de acceso", id, codeOf(e));
    }
  }
}

/** Los avisos de que la dirección con la que el socio INGRESA acaba de mudarse.
 *
 *  Sólo los reingresos los disparan, y sólo cuando el ex socio tenía cuenta y
 *  volvió declarando otra casilla: el asiento le llevó la dirección nueva a la
 *  cuenta (`syncAccountEmail`, dentro de la transacción) y desde ese momento
 *  ingresa con ella. Que se mude enseguida es la decisión de producto; lo que no
 *  puede pasar es que se mude en silencio (ver `@/lib/members/account-email-notice`).
 *
 *  Va DESPUÉS del commit y no adentro, como en el modo carga: un SMTP lento no
 *  puede transcurrir con la transacción abierta —y acá menos, que son hasta 50
 *  asientos seguidos— y un correo no se deshace con un rollback. Best-effort por
 *  el mismo motivo que la invitación: el asiento societario ya está firme.
 */
async function announceLoginEmailMoves(
  moves: Array<{ memberId: number; move: AccountEmailMove }>, actorId: number,
): Promise<void> {
  for (const { memberId, move } of moves) {
    try {
      const member = await prisma.member.findUnique({ where: { id: memberId } });
      if (!member) continue;
      await accountEmailNotice.announce({ member, previousEmail: move.from, actorId });
    } catch (e) {
      console.error("[solicitudes] falló el aviso de mudanza de la dirección de ingreso", memberId, codeOf(e));
    }
  }
}

export async function recordApplicationsAction(_p: State, formData: FormData): Promise<State> {
  const actor = await requireAdmin();
  if (!actor.ok) return { error: actor.error };
  const actorId = actor.actorId;

  const ids = [
    ...new Set(
      formData.getAll("ids")
        .map((v) => Number(v))
        .filter((n) => Number.isInteger(n) && n > 0),
    ),
  ];
  if (ids.length === 0) return { error: "Elegí al menos una solicitud para asentar." };

  // El acta se parsea aparte y NUNCA se combina con otro schema:
  // `minuteSelectionSchema` es un `z.union` y `parseForm` sólo sabe reconocer
  // campos opcionales sobre un ZodObject con `.shape`.
  const raw: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string" && v.trim() !== "") raw[k] = v.trim();
  const sel = minuteSelectionSchema.safeParse(raw);
  if (!sel.success) {
    return { error: sel.error.issues[0]?.message ?? "Elegí un acta existente o cargá una nueva." };
  }

  // Pre-validación anti acta huérfana (ver la cabecera).
  const recordable = await prisma.application.count({
    where: { id: { in: ids }, status: { in: [...RECORDABLE_STATUSES] } },
  });
  if (recordable === 0) {
    return { error: "Ninguna de las solicitudes elegidas está lista para asentar." };
  }

  const createdMinute = createsNewMinute(sel.data);
  let minuteId: number;
  try {
    minuteId = await resolveMinuteId(prisma, sel.data, actorId);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo resolver el acta." };
  }

  // En serie y no en paralelo: cada alta numera con el `max + 1` del libro
  // abierto, y dos transacciones concurrentes leerían el mismo máximo y
  // chocarían contra el índice único de (libro, número).
  const results: RecordResult[] = [];
  for (const applicationId of ids) {
    results.push(await applicationRecorder.recordOne({ applicationId, minuteId, actorId }));
  }
  const done = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  const failures = failed.map((r) => ({ id: r.applicationId, error: r.error }));

  if (done.length === 0) {
    if (createdMinute) await discardUnusedMinute(prisma, minuteId);
    // El encabezado resume y la lista dice cuál falló por qué, con link a cada
    // una: el motivo NO se copia también en `error` para no leerse dos veces
    // cuando la fallida es una sola.
    return { error: "No se pudo asentar ninguna de las solicitudes elegidas.", failures };
  }

  // La auditoría va apenas el lote commitea y ANTES de cualquier correo. Los
  // envíos son hasta 50 SMTP en serie: si el request muere por timeout ahí, los
  // asientos societarios ya están firmes en la base y sin este orden no quedaría
  // NINGÚN rastro de quién los hizo (CLAUDE.md: toda acción sensible de admin se
  // registra). El detalle lleva ids y nada más: ni nombres ni DNIs (docs/08,
  // Ley 25.326).
  const loginEmailMoves = done.flatMap((r) =>
    r.accountEmailMove ? [{ applicationId: r.applicationId, memberId: r.memberId, move: r.accountEmailMove }] : [],
  );
  const detail: Record<string, unknown> = {
    minuteId,
    recorded: done.map((r) => r.applicationId),
    reentries: done.filter((r) => r.reentry).map((r) => r.applicationId),
    failed: failed.map((r) => r.applicationId),
  };
  // Mudarle a un socio la dirección con la que ingresa al sistema es un hecho
  // propio y no un campo más de la ficha, así que se asienta aparte (mismo
  // criterio que `member_login_email_moved` en el modo carga). Sólo ids.
  if (loginEmailMoves.length > 0) {
    detail.loginEmailMoved = loginEmailMoves.map((m) => m.applicationId);
  }
  await audit({
    userId: actorId, action: "application_record", entity: "application",
    detail, ip: await clientIp(),
  });

  // Recién ahora los correos, los dos best-effort y en este orden: primero la
  // invitación de acceso (fichas sin cuenta), después los avisos de mudanza
  // (fichas con cuenta). Los dos conjuntos son disjuntos por construcción.
  await inviteRecordedMembers(done.map((r) => r.memberId));
  await announceLoginEmailMoves(loginEmailMoves, actorId);

  // Con éxito PARCIAL no se redirige: el querystring no tiene dónde poner los
  // motivos, y "3 quedaron sin asentar" sin decir cuáles ni por qué no le sirve
  // al operador. Se vuelve con el resultado y la pantalla las lista; el
  // `revalidatePath` es lo que hace que la tabla ya muestre asentadas las que sí
  // entraron (sin él, la bandeja se re-renderiza desde la caché del router).
  if (failed.length > 0) {
    revalidatePath("/admin/solicitudes");
    return { recorded: done.length, failures };
  }

  // Fuera del try: `redirect` señaliza con una excepción y un catch se la comería.
  // Los filtros vigentes de la bandeja vuelven por un campo oculto y se
  // RE-PARSEAN con el mismo parser de la pantalla: lo que se reconstruye son los
  // filtros reconocidos, nunca el texto crudo que llegó en el POST (un destino
  // de redirect no puede salir de un valor del cliente).
  const back = Object.fromEntries(new URLSearchParams(String(formData.get("filtros") ?? "")));
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(parseApplicationFilters(back))) qs.set(k, String(v));
  const backPage = parseApplicationsPage(back);
  if (backPage > 1) qs.set("page", String(backPage));
  qs.set("asentadas", String(done.length));
  redirect(`/admin/solicitudes?${qs.toString()}`);
}

// ── Recategorizar (docs/05 §3) ───────────────────────────────────────────────
// La Comisión corrige la categoría que el vecino eligió en el wizard ANTES de
// asentarla en el libro. No es un acto societario en sí —la solicitud todavía no
// es un socio— así que no lleva acta: el acta la lleva el asiento posterior, ya
// con la categoría corregida. Lo que sí lleva es auditoría y, cuando el monto de
// la cuota cambia, un viaje a Mercado Pago.
export async function recategorizeApplicationAction(
  _p: DecisionState, formData: FormData,
): Promise<DecisionState> {
  const actor = await requireAdmin();
  if (!actor.ok) return { error: actor.error };

  const parsed = parseForm(
    z.object({
      applicationId: z.coerce.number().int().positive(),
      newCategory: z.enum(WEB_CATEGORIES, { error: "Elegí la nueva categoría." }),
    }),
    formData,
  );
  if (!parsed.ok) return { error: parsed.error };
  const { applicationId, newCategory } = parsed.data;

  const app = await prisma.application.findUnique({ where: { id: applicationId } });
  if (!app) return { error: "La solicitud no existe." };
  if (!isDecidable(app.status)) {
    return { error: "La solicitud ya fue resuelta: no se puede recategorizar." };
  }
  if (app.requestedCategory === newCategory) return { error: "La solicitud ya tiene esa categoría." };

  // ── La residencia se ASIENTA, no se bloquea ─────────────────────────────────
  // `categoryAllowedForResidence` es la regla de lo que el vecino puede
  // AUTO-declarar en el wizard (Art. 5 y 5 bis). Acá NO bloquea: la
  // recategorización es justamente la corrección de la Comisión cuando lo
  // declarado no se corresponde con la realidad, y hoy no hay pantalla para
  // corregirle el domicilio a una solicitud —una guarda dura mataría la
  // corrección legítima—. Pero el desvío peligroso (no residente declarado →
  // `active`, que da voto y elegibilidad) tampoco puede quedar en silencio: la
  // pantalla lo advierte antes de guardar y acá queda en la auditoría, para que
  // el acta pueda reflejar que la Comisión decidió eso a sabiendas.
  //
  // La residencia sale de la propia solicitud: `streetId` es una calle del
  // catastro del barrio, y sin ella lo declarado fue `streetText` +
  // `neighborhood` (ver `asociate/actions.ts`, donde se escriben excluyentes).
  //
  // Las categorías que NO se piden por la web siguen cerradas: el enum del
  // schema es `WEB_CATEGORIES` (cadete, honorario y vitalicio salen del padrón,
  // no de una solicitud).
  const livesInBarrio = app.streetId !== null;
  const residenceMismatch = !categoryAllowedForResidence(newCategory, livesInBarrio);

  // Si hay suscripción y el monto de la categoría nueva difiere, se actualiza la
  // suscripción por API (docs/06 §7). MP va ANTES del update local y su fallo
  // corta la acción: al revés, la ficha quedaría diciendo "activo" mientras el
  // débito sigue saliendo por el monto de adherente, y nadie lo compensaría.
  const changesAmount = changesFeeAmount(app.requestedCategory, newCategory);
  const subscriptionUpdated = Boolean(app.preapprovalId && changesAmount);
  // El plan nuevo y el viejo, para que la fila local no siga apuntando al plan
  // del que ya no salió el monto: `MpSubscription.planId` es el plan de
  // REFERENCIA (la suscripción no está asociada a ningún plan en MP, docs/06
  // §2), se escribe UNA vez al crearla, y sin esto la conciliación del M4
  // (REG-34) leería una divergencia inventada —o la "arreglaría" al revés,
  // devolviendo el monto viejo—. `changesFeeAmount` es true exactamente cuando
  // el plan cambia: los planes son dos y adherente ↔ colaborador comparten el
  // mismo.
  //
  // El monto se lee FRESCO del plan nuevo, igual que en `startPaymentAction` y
  // por el mismo motivo. `getFeeAmounts` (src/lib/mp/plans.ts) NO sirve acá: es
  // una caché de 24 h con stale-on-error, o sea que una lectura fallida no
  // falla —devuelve en silencio el último valor bueno—. Y lo que se escribe con
  // `updatePreapprovalAmount` no es una pantalla: es el importe que MP le va a
  // debitar al socio TODOS los meses. Si la Comisión sube la cuota en el panel
  // de MP y alguien recategoriza dentro de las 24 h, la caché escribiría el
  // valor viejo sobre una suscripción viva, con éxito en pantalla y sin que
  // nada lo detecte (la conciliación de docs/06 compara plan contra
  // `ValorCuota`, nunca suscripción contra plan, y el lote del M4 que lo
  // corregiría todavía no existe). Mejor no tocar el monto que tocarlo mal.
  let newPlanId: string | null = null;
  let oldPlanId: string | null = null;
  let newAmount: number | null = null;
  if (app.preapprovalId && changesAmount) {
    // Primero el plan: sin id configurado no hay monto que leer NI plan al que
    // mover la fila local. Antes se llamaba igual a MP con el monto cacheado y
    // después se salteaba el update local del `planId`, o sea que la
    // divergencia que este bloque existe para evitar volvía en silencio.
    newPlanId = await planIdForCategory(newCategory);
    if (!newPlanId) {
      return {
        error: "El plan de Mercado Pago de esa categoría no está configurado. Pedile al superadmin que lo cargue en Configuración antes de recategorizar.",
      };
    }
    let amount: number;
    try {
      ({ amount } = await mpGateway.getPlan(newPlanId));
      newAmount = amount;
    } catch (e) {
      // El error del SDK ES el cuerpo de la respuesta de MP (un objeto plano,
      // no un `Error`): lo desarma `mpErrorLog`. Al log, nunca a la pantalla.
      console.error(
        "[solicitudes] no se pudo leer el monto del plan —",
        mpErrorLog("getPlan", { applicationId, planId: newPlanId }, e),
      );
      return {
        error: "No pudimos confirmar el valor de la cuota en Mercado Pago. Para no dejar el débito por un monto equivocado, no cambiamos nada: probá de nuevo en unos minutos.",
      };
    }
    oldPlanId = (await prisma.mpSubscription.findUnique({
      where: { preapprovalId: app.preapprovalId },
      select: { planId: true },
    }))?.planId ?? null;
    try {
      await mpGateway.updatePreapprovalAmount(app.preapprovalId, amount);
    } catch (e) {
      // Antes este catch era pelado: MP rechazaba el cambio de monto y en el
      // log no quedaba NADA —ni el status ni el motivo—, así que el operador
      // sólo podía reintentar a ciegas.
      console.error(
        "[solicitudes] MP no aceptó el cambio de monto de la suscripción —",
        mpErrorLog("updatePreapprovalAmount", {
          applicationId, preapprovalId: app.preapprovalId, amount,
        }, e),
      );
      return {
        error: "MP no aceptó el cambio de monto de la suscripción. Reintentá o resolvelo desde el panel de MP.",
      };
    }
  }

  // Los dos writes locales van juntos o no va ninguno: una solicitud "activa"
  // con la fila de suscripción apuntando al plan de adherente es exactamente la
  // divergencia que este bloque existe para evitar.
  //
  // Envuelto porque MP YA aceptó el monto nuevo: si el guardado local falla, el
  // débito sale por el monto de la categoría nueva y la base no lo sabe. Al log
  // va el id del preapproval, que no es dato personal y es lo único que permite
  // reconciliarlo a mano (mismo criterio que `asociate/actions.ts`).
  try {
    await prisma.$transaction(async (tx) => {
      await tx.application.update({
        where: { id: applicationId },
        data: { requestedCategory: newCategory },
      });
      if (app.preapprovalId && newPlanId) {
        await tx.mpSubscription.updateMany({
          where: { preapprovalId: app.preapprovalId },
          data: { planId: newPlanId, lastSyncAt: new Date() },
        });
      }
    });
  } catch (e) {
    console.error(
      "[solicitudes] recategorización: MP aceptó el monto nuevo pero el guardado local falló",
      applicationId, app.preapprovalId, codeOf(e),
    );
    return { error: "No pudimos guardar la categoría nueva. Reintentá en unos minutos." };
  }

  await audit({
    userId: actor.actorId, action: "application_recategorize", entity: "application",
    entityId: applicationId,
    // Sólo categorías, ids de MP y banderas: ni el nombre ni el DNI ni el
    // domicilio (docs/08, Ley 25.326). `residenceMismatch` no es dato personal:
    // es la marca de que la Comisión se apartó de Art. 5 / 5 bis a sabiendas.
    detail: {
      from: app.requestedCategory, to: newCategory,
      subscriptionUpdated,
      residenceMismatch,
      ...(subscriptionUpdated
        ? { preapprovalId: app.preapprovalId, oldPlanId, amount: newAmount }
        : {}),
    },
    ip: await clientIp(),
  });
  // Fuera del try: `redirect` señaliza con una excepción y un catch se la comería.
  redirect(`/admin/solicitudes/${applicationId}`);
}

// ── Rechazar (REG-13, REG-12.b, REG-05) ──────────────────────────────────────
// El rechazo SÍ es un acto societario: exige constancia en acta (REG-13, sin
// necesidad de expresar la causa). Además retiene la cuota de ingreso ya
// debitada (REG-12.b), cancela la suscripción de MP y bloquea al DNI por seis
// meses (REG-05).
//
// El bloqueo tiene dos soportes según haya ficha o no: sobre `Member.rejectedUntil`
// cuando la solicitud matcheó a un ex socio, y sobre la propia Application
// rechazada (`lastRejectionAt`) cuando el DNI no está en el padrón. Los dos los
// lee `checkEligibility`.
export async function rejectApplicationAction(
  _p: DecisionState, formData: FormData,
): Promise<DecisionState> {
  const actor = await requireAdmin();
  if (!actor.ok) return { error: actor.error };

  const parsed = parseForm(z.object({ applicationId: z.coerce.number().int().positive() }), formData);
  if (!parsed.ok) return { error: parsed.error };
  const { applicationId } = parsed.data;

  // El acta se parsea aparte y NUNCA se combina con el schema de arriba:
  // `minuteSelectionSchema` es un `z.union` y `parseForm` sólo sabe reconocer
  // campos opcionales sobre un ZodObject con `.shape`.
  const raw: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string" && v.trim() !== "") raw[k] = v.trim();
  const sel = minuteSelectionSchema.safeParse(raw);
  if (!sel.success) {
    return { error: sel.error.issues[0]?.message ?? "El rechazo exige constancia en acta (Art. 5 inc. 7)." };
  }

  // Pre-validación anti acta huérfana: si la solicitud ya está resuelta, se
  // corta ANTES de crear el acta (mismo criterio que el asiento masivo).
  const app = await prisma.application.findUnique({ where: { id: applicationId } });
  if (!app) return { error: "La solicitud no existe." };
  if (!isDecidable(app.status)) return { error: "La solicitud ya fue resuelta." };

  const createdMinute = createsNewMinute(sel.data);
  let minuteId: number;
  try {
    minuteId = await resolveMinuteId(prisma, sel.data, actor.actorId);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo resolver el acta." };
  }

  const decidedAt = new Date();
  try {
    await prisma.$transaction(async (tx) => {
      // `updateMany` con el estado en el WHERE y no `update`: es el cerrojo
      // contra dos admins resolviendo la misma solicitud desde dos pantallas.
      const { count } = await tx.application.updateMany({
        where: { id: applicationId, status: { in: [...DECIDABLE_STATUSES] } },
        data: { status: "rejected", minuteId, decidedAt },
      });
      if (count === 0) throw new Error("La solicitud ya fue resuelta por otro admin.");
      if (app.memberId) {
        await tx.member.update({
          where: { id: app.memberId },
          data: { rejectedUntil: addMonthsUtc(decidedAt, REJECTION_BLOCK_MONTHS) },
        });
      }
    });
  } catch (e) {
    if (createdMinute) await discardUnusedMinute(prisma, minuteId);
    return { error: e instanceof Error ? e.message : "No se pudo rechazar la solicitud." };
  }

  // Cancelación de la suscripción y correo: DESPUÉS del commit y best-effort. El
  // rechazo ya quedó asentado en el acta de la Comisión y NO se revierte porque
  // MP o el SMTP estén caídos; lo que sí queda es el rastro (`cancelFailed`)
  // para que alguien lo termine a mano desde el panel de MP.
  //
  // Los dos pasos van en `try` SEPARADOS: `cancelFailed` significa "en MP le
  // siguen debitando la cuota al vecino rechazado" y es lo que la pantalla
  // levanta para pedir la cancelación a mano. Si el que falla es el update
  // local, MP ya dejó de cobrar y marcarlo mandaría al operador a cancelar algo
  // que ya está cancelado.
  //
  // Al log y a la auditoría va el id del preapproval: no es dato personal y es
  // lo único que permite reconciliar a mano (mismo criterio que
  // `asociate/actions.ts`, donde la suscripción viva sin registrar se loguea
  // igual). Sin él, `cancelFailed: true` le dice al operador que hay algo roto
  // sin decirle QUÉ cancelar.
  let cancelFailed = false;
  if (app.preapprovalId) {
    try {
      await mpGateway.cancelPreapproval(app.preapprovalId);
    } catch (e) {
      cancelFailed = true;
      console.error(
        "[solicitudes] no se pudo cancelar la suscripción de MP: se le sigue debitando al vecino rechazado —",
        mpErrorLog("cancelPreapproval", {
          applicationId, preapprovalId: app.preapprovalId,
        }, e),
      );
    }
    if (!cancelFailed) {
      try {
        await prisma.mpSubscription.updateMany({
          where: { preapprovalId: app.preapprovalId },
          data: { status: "cancelled", lastSyncAt: new Date() },
        });
      } catch (e) {
        // MP ya no cobra; lo que quedó viejo es la fila local. Lo endereza la
        // conciliación del M4 (REG-34).
        console.error(
          "[solicitudes] MP canceló la suscripción pero el estado local no se actualizó",
          applicationId, app.preapprovalId, codeOf(e),
        );
      }
    }
  }
  try {
    await mailer.sendToApplication({
      applicationId, to: app.email, type: "application_result",
      // La retención sólo se menciona si hubo débito real (REG-12.b).
      message: applicationRejectedEmail({ entryFeeRetained: app.mpPaymentIdEntry !== null }),
      summary: "solicitud rechazada",
    });
  } catch (e) {
    // Del error sólo el código: los de nodemailer traen el sobre SMTP, o sea la
    // dirección del vecino en claro (docs/08, Ley 25.326).
    console.error("[solicitudes] no se pudo enviar el aviso de rechazo", applicationId, codeOf(e));
  }

  await audit({
    userId: actor.actorId, action: "application_reject", entity: "application",
    entityId: applicationId,
    detail: {
      minuteId, entryFeeRetained: app.mpPaymentIdEntry !== null, cancelFailed,
      hadMember: app.memberId !== null,
      // El preapproval que se mandó a cancelar. Con `cancelFailed: true` es el
      // único dato que permite terminar la cancelación a mano desde el panel de
      // MP; no es dato personal.
      preapprovalId: app.preapprovalId,
    },
    ip: await clientIp(),
  });
  redirect(`/admin/solicitudes/${applicationId}`);
}
