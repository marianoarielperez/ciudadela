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
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth/require-admin";
import { mailer } from "@/lib/email";
import { portalInvite } from "@/lib/email/templates";
import { prisma } from "@/lib/prisma";
import { tokens } from "@/lib/tokens";
import { accountEmailNotice } from "@/lib/members/account-email-notice";
import {
  createsNewMinute, discardUnusedMinute, minuteSelectionSchema, resolveMinuteId,
} from "@/lib/members/minute-form";
import type { AccountEmailMove } from "@/lib/members/write";
import { applicationRecorder, RECORDABLE_STATUSES } from "@/lib/applications/record";
import type { RecordResult } from "@/lib/applications/record";
import { parseApplicationFilters, parseApplicationsPage } from "@/lib/applications/query";

// Sin `export`: en un módulo "use server" todo lo exportado es un endpoint.
//
// `failures` lleva el id Y el motivo de cada solicitud que no entró: decirle al
// operador "3 quedaron sin asentar, revisalas a mano" sin decirle CUÁLES es
// ordenarle una acción sin darle los medios (en un lote de 20 no hay forma de
// deducirlo desde la bandeja). La pantalla las lista con link a cada una.
type State = { error?: string; recorded?: number; failures?: Array<{ id: number; error: string }> };

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
      const code = typeof e === "object" && e !== null && "code" in e ? String(e.code) : "unknown";
      console.error("[solicitudes] no se pudo enviar la invitación de acceso", id, code);
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
      const code = typeof e === "object" && e !== null && "code" in e ? String(e.code) : "unknown";
      console.error("[solicitudes] falló el aviso de mudanza de la dirección de ingreso", memberId, code);
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
