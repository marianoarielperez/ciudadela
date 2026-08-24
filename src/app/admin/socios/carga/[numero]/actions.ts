"use server";
// Modo carga: edición de los datos de ficha de un socio ya asentado en el libro.
//
// A diferencia de las acciones societarias (../[id]/actions.ts), acá NO hay
// acta: pasar a máquina lo que ya está escrito en la ficha de papel no es un
// movimiento del padrón, es completar el registro. Por eso esta action no toca
// nunca `joinedAt`, `status`, `category` ni `withdrawalReason`: esos campos sólo
// cambian por un asiento con acta, y dejarlos entrar acá abriría una puerta
// lateral para modificar el libro sin dejar el rastro estatutario.
//
// La validación y el armado del patch (con esa lista blanca) viven en
// `@/lib/members/card-edit`, testeados sin base en `tests/card-edit.test.ts`.
// Acá quedan la sesión, la base, el correo y la auditoría.
import { headers } from "next/headers";
import { audit, auditStrict } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { parseForm } from "@/lib/forms";
import { requireAdmin } from "@/lib/auth/require-admin";
import { verificationActorLimiter, verificationMemberLimiter } from "@/lib/auth/rate-limiter";
import { hashToken, tokens, MEMBER_EMAIL_TOKEN_PURPOSES } from "@/lib/tokens";
import { mailer } from "@/lib/email";
import { portalInvite } from "@/lib/email/templates";
import {
  buildPatch, cardSchema, changedFields, parseBirthDate, verificationTarget,
} from "@/lib/members/card-edit";
import {
  ACCOUNT_EMAIL_NOTICE_WARNINGS, type AccountEmailNoticeOutcome,
  accountEmailNotice, accountEmailNoticeWarning,
} from "@/lib/members/account-email-notice";
import { type AccountEmailMove, MemberWriteError, memberWriter } from "@/lib/members/write";

async function clientIp(): Promise<string> {
  // Sólo X-Real-IP, como en el login: el resto de las cabeceras de IP las puede
  // fijar el cliente si le pega directo al origen.
  return (await headers()).get("x-real-ip") ?? "unknown";
}

// Del error sólo se conserva el código, nunca el objeto: los errores de Prisma y
// de nodemailer traen la consulta y el sobre SMTP, o sea datos del socio en
// claro, y el log de PM2 no está cubierto por los cuidados de docs/08 (Ley 25.326).
function codeOf(e: unknown): string {
  return typeof e === "object" && e !== null && "code" in e ? String(e.code) : "unknown";
}

/** Asiento POSTERIOR al commit. Devuelve si se pudo escribir en vez de propagar.
 *
 *  Una excepción acá —un hipo de MariaDB, el pool agotado— sale de la server
 *  action y le deja al operador la pantalla de error genérica de Next sobre una
 *  edición que YA se guardó. El reflejo natural entonces es volver a editar la
 *  ficha, y si lo que se editó fue el email eso produce una SEGUNDA mudanza de la
 *  dirección de ingreso, con su segundo par de correos: el modo de falla que
 *  todos los textos de esta pantalla están escritos para evitar. Perder el
 *  asiento es grave, pero perderlo Y provocar la segunda mudanza es peor, así
 *  que se degrada a un aviso explícito para el operador (`auditFailed`) y a un
 *  `console.error`.
 *
 *  Usa `auditStrict`, no `audit`: `audit()` traga sus propios errores y nunca
 *  rechaza, así que envolverla acá en un try/catch sería una rama muerta que
 *  ningún test real podría ejercitar. `auditStrict` es la única forma de que
 *  este `catch` —y el aviso que dispara— puedan pasar de verdad. */
async function auditAfterCommit(entry: Parameters<typeof audit>[0]): Promise<boolean> {
  try {
    await auditStrict(entry);
    return true;
  } catch (e) {
    console.error("[carga] no se pudo asentar", entry.action, "del socio", entry.entityId, "code:", codeOf(e));
    return false;
  }
}

/** `warning` es un guardado que SÍ ocurrió pero dejó algo pendiente de mano
 *  humana (los avisos de la mudanza de la dirección de ingreso que no salieron).
 *  Es distinto de `error`, que significa que no se guardó nada. */
export type SaveState = { error?: string; saved?: boolean; unchanged?: boolean; warning?: string };

export async function updateMemberAction(_prev: SaveState, formData: FormData): Promise<SaveState> {
  const actor = await requireAdmin();
  if (!actor.ok) return { error: actor.error };

  const parsed = parseForm(cardSchema, formData);
  if (!parsed.ok) return { error: parsed.error };
  const d = parsed.data;

  const member = await prisma.member.findUnique({ where: { id: d.memberId } });
  if (!member) return { error: "Socio inexistente." };

  const birth = parseBirthDate(d.birthDate);
  if (!birth.ok) return { error: birth.error };

  if (d.streetId) {
    const street = await prisma.street.findUnique({ where: { id: d.streetId }, select: { id: true } });
    if (!street) return { error: "La calle elegida no existe en el catálogo." };
  }

  const { patch } = buildPatch(member, d, birth.value);

  const changed = changedFields(member, patch);
  // Ctrl+S es la forma normal de guardar en esta pantalla y se aprieta de más.
  // Sin esto, cada repetición dejaría un asiento de auditoría que no
  // corresponde a ningún cambio y ensuciaría el rastro que sí importa.
  if (changed.length === 0) return { saved: true, unchanged: true };

  // El guardado va por `memberWriter`: el update, la revocación de los tokens
  // que el cambio de dirección invalida y la propagación de esa dirección a la
  // cuenta de acceso del socio corren en UNA transacción, y la regla vive del
  // lado del dueño del dato (ver `@/lib/members/write`), no acá — donde el
  // próximo camino de edición tendría que acordarse de repetirla.
  let revoked = 0;
  let accountEmailMove: AccountEmailMove | null = null;
  let updated = member;
  try {
    ({ member: updated, revokedTokens: revoked, accountEmailMove } =
      await memberWriter.updateMember(member.id, patch));
  } catch (e) {
    // Los dos rechazos de `memberWriter` —la dirección nueva ya es la de otra
    // cuenta de acceso, o la edición dejaría sin email a una ficha que ya tiene
    // cuenta— llegan acá con su mensaje ya escrito por la capa que conoce la
    // regla; acá sólo se muestra. No se guardó nada: la transacción entera
    // volvió atrás.
    //
    // Y se asientan igual. Que no haya habido escritura no los vuelve
    // irrelevantes: un intento de mover la identidad de acceso de un socio a la
    // casilla de otra cuenta es justo lo que la asociación tiene que poder
    // reconstruir después (el padrón es el registro que se presenta ante la
    // IGJ). Va el MOTIVO y los nombres de los campos que traía la edición,
    // nunca valores: ni la dirección tipeada ni un solo dato del titular de la
    // otra cuenta —que además esta capa no conoce— (Ley 25.326).
    if (e instanceof MemberWriteError) {
      await audit({
        userId: actor.actorId, action: "member_update_rejected", entity: "member",
        entityId: member.id, detail: { reason: e.reason, fields: changed }, ip: await clientIp(),
      });
      return { error: e.message };
    }
    if (typeof e === "object" && e !== null && "code" in e && e.code === "P2002") {
      return { error: "Ya existe otro socio con ese DNI." };
    }
    throw e;
  }

  // La auditoría con IP la escribe la action: es la única capa que ve las
  // cabeceras. Sólo los NOMBRES de los campos tocados, nunca los valores: el
  // DNI y el domicilio no van al log (Ley 25.326). `accountEmailUpdated` sí se
  // asienta aparte: mover la dirección con la que se ingresa al sistema es un
  // hecho propio, no un campo más de la ficha.
  const ip = await clientIp();
  const detail: Record<string, unknown> = { fields: changed };
  if (revoked > 0) detail.revokedTokens = revoked;
  if (accountEmailMove) detail.accountEmailUpdated = true;
  const savedAudited = await auditAfterCommit({
    userId: actor.actorId, action: "member_update", entity: "member", entityId: member.id,
    detail,
    ip,
  });
  if (!accountEmailMove) {
    return savedAudited
      ? { saved: true }
      : { saved: true, warning: ACCOUNT_EMAIL_NOTICE_WARNINGS.auditFailed };
  }

  // La dirección con la que el socio INGRESA acaba de mudarse. Los dos avisos
  // van después del commit y a propósito: un SMTP lento no puede transcurrir con
  // la transacción abierta, y un correo no se deshace con un rollback. Que
  // fallen no revierte el cambio —el motivo más frecuente de esta edición es que
  // el socio perdió la casilla vieja, así que el rebote es el caso esperado y
  // revertir dejaría la cuenta apuntando a una dirección que el padrón ya no le
  // reconoce—: se le dice al operador y queda asentado. Ver
  // `@/lib/members/account-email-notice`.
  //
  // Y va en `try`: `announce` ya degrada adentro lo que puede (ver su comentario),
  // pero cualquier cosa que igual se escape no puede convertir un guardado
  // exitoso en una pantalla de error. Se asume lo peor —ningún correo salió— para
  // que el operador salga con el aviso que le dice que avise por otro medio.
  let notice: AccountEmailNoticeOutcome;
  let noticeCrashed = false;
  try {
    notice = await accountEmailNotice.announce({
      member: updated, previousEmail: accountEmailMove.from, actorId: actor.actorId,
    });
  } catch (e) {
    noticeCrashed = true;
    const code = codeOf(e);
    console.error("[carga] falló el aviso de la mudanza de la dirección de ingreso del socio", member.id, "code:", code);
    notice = {
      previousNotified: false, verificationSent: false, throttled: false,
      failures: [{ target: "previous", code }, { target: "current", code }],
    };
  }
  // Asiento propio del hecho, separado de `member_update`: mover la identidad de
  // acceso de un socio es lo que hay que poder reconstruir después, y ahora
  // también con qué se le avisó. Sin una sola dirección: van banderas, el motivo
  // técnico de la falla y a cuál de las dos casillas le falló, nunca cuáles son
  // (Ley 25.326).
  const noticeDetail: Record<string, unknown> = {
    notifiedPrevious: notice.previousNotified,
    verificationSent: notice.verificationSent,
  };
  if (notice.throttled) noticeDetail.throttled = true;
  if (notice.failures.length > 0) noticeDetail.failures = notice.failures;
  // Distingue "los correos no salieron" de "el aviso entero se cayó": en el
  // segundo caso las banderas de arriba son una suposición conservadora, no una
  // observación, y quien reconstruya después tiene que poder saberlo.
  if (noticeCrashed) noticeDetail.crashed = true;
  const moveAudited = await auditAfterCommit({
    userId: actor.actorId, action: "member_login_email_moved", entity: "member",
    entityId: member.id, detail: noticeDetail, ip,
  });

  // Los dos avisos se acumulan: son dos cosas distintas que el operador tiene
  // que hacer (avisarle al socio por otro medio, y avisarle a quien administra).
  const warning = [
    accountEmailNoticeWarning(notice),
    savedAudited && moveAudited ? null : ACCOUNT_EMAIL_NOTICE_WARNINGS.auditFailed,
  ].filter((w): w is string => w !== null).join(" ");
  return warning ? { saved: true, warning } : { saved: true };
}

export type SendState = { error?: string; sent?: boolean };

export async function sendVerificationAction(_prev: SendState, formData: FormData): Promise<SendState> {
  const actor = await requireAdmin();
  if (!actor.ok) return { error: actor.error };

  const memberId = Number(formData.get("memberId"));
  if (!Number.isInteger(memberId) || memberId <= 0) return { error: "Socio inexistente." };
  const member = await prisma.member.findUnique({ where: { id: memberId } });
  if (!member) return { error: "Socio inexistente." };

  const target = verificationTarget(member);
  if (!target.ok) return { error: target.error };

  // El límite va después de las guardas de datos (un error de estado no consume
  // cupo) y antes de emitir: lo que se está racionando es el envío real y el
  // asiento de Notification que lo acredita.
  //
  // Se consultan los DOS cupos sin registrar nada y recién después se registra
  // en los dos. Con `check` a secas, el primero en evaluarse cobraba el intento
  // aunque el segundo rechazara: 21 clicks sobre el mismo socio dejaban al admin
  // bloqueado una hora para TODOS los socios habiendo salido 3 correos. Registrar
  // acá y no después del envío conserva la reserva (dos clicks simultáneos no
  // pueden pasar los dos por el mismo cupo); si el SMTP falla, se devuelve.
  const memberKey = `member:${member.id}`;
  const actorKey = `actor:${actor.actorId}`;
  if (!verificationMemberLimiter.allows(memberKey)) {
    return { error: "Ya se le enviaron varios correos de acceso a este socio en la última hora. Esperá antes de reintentar." };
  }
  if (!verificationActorLimiter.allows(actorKey)) {
    return { error: "Enviaste demasiados correos de acceso seguidos. Esperá un rato antes de seguir." };
  }
  verificationMemberLimiter.record(memberKey);
  verificationActorLimiter.record(actorKey);

  const ip = await clientIp();
  // Un enlace vivo por socio: el reenvío invalida el anterior. Si no, "no me
  // llegó" deja varios enlaces válidos en paralelo durante 7 días, cada uno
  // capaz de crear la contraseña de la cuenta. Revocar al emitir es legítimo
  // ACÁ y no en el recupero porque este envío está detrás de `requireAdmin`:
  // es la regla del encabezado de `@/lib/tokens`, no una excepción.
  await tokens.revokeForMember(member.id, MEMBER_EMAIL_TOKEN_PURPOSES);
  // `target.kind` decide los tres: el propósito del token, la plantilla y el
  // asiento de Notification. Con el email todavía sin confirmar va la
  // verificación; con el email ya confirmado y sin cuenta creada va derecho la
  // invitación de contraseña, que es la salida del socio que verificó y no llegó
  // a elegir la contraseña en la misma sentada.
  const raw = await tokens.issue({ purpose: target.kind, memberId: member.id });
  const base = process.env.AUTH_URL ?? "http://localhost:3000";
  const { message, summary } = portalInvite({
    kind: target.kind, name: member.fullName, baseUrl: base, token: raw,
  });

  try {
    await mailer.sendToMember({
      memberId: member.id, to: target.email, type: target.kind, message, summary,
    });
  } catch (e) {
    // `mailer.sendToMember` propaga la excepción del SMTP y no acredita ningún
    // envío: desde la 4C deja una Notification `failed` —el registro del
    // INTENTO— pero nunca una `sent`, porque el estatuto le da carácter
    // fehaciente al domicilio electrónico y ahí no salió nada. Pero una
    // excepción que sale de la action rompe el render y le deja al operador una
    // pantalla de error genérica en inglés. Acá la traducimos a un mensaje que
    // dice la verdad —no se envió— y dejamos la pantalla usable.
    //
    // El token ya emitido se quema: un enlace de verificación vivo que nadie
    // recibió es superficie de ataque sin ninguna contrapartida.
    await prisma.actionToken.deleteMany({ where: { tokenHash: hashToken(raw) } });
    // Y el cupo reservado se devuelve: no se acreditó ninguna Notification ni
    // quedó ningún enlace vivo, así que no hay nada que racionar. Sin esto, tres
    // errores de configuración del SMTP dejaban al socio sin reintentos por una
    // hora sin que hubiera salido un solo correo.
    verificationMemberLimiter.refund(memberKey);
    verificationActorLimiter.refund(actorKey);
    // Ni el log ni el detalle de auditoría llevan el objeto de error: los errores
    // de nodemailer traen `envelope`, `rejected` y el `response` del SMTP, o sea
    // el email del socio en claro, y el log de PM2 no está cubierto por los
    // cuidados de docs/08 (Ley 25.326). Con el id del socio y el código del
    // error alcanza para diagnosticar: el resto se reconstruye desde la base.
    const code = codeOf(e);
    console.error("[carga] falló el envío de verificación al socio", member.id, "code:", code);
    // El intento sí queda auditado: alguien apretó el botón y no salió nada, y
    // eso es exactamente lo que hay que poder reconstruir después.
    await audit({
      userId: actor.actorId, action: "member_send_verification_failed", entity: "member",
      entityId: member.id, detail: { code, kind: target.kind }, ip,
    });
    return { error: "No se pudo enviar el email. Verificá la dirección y reintentá; si sigue fallando, revisá la configuración de correo." };
  }

  await audit({
    userId: actor.actorId, action: "member_send_verification", entity: "member",
    entityId: member.id, detail: { kind: target.kind }, ip,
  });
  return { sent: true };
}
