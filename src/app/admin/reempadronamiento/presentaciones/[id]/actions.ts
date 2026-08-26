"use server";
// Las cuatro decisiones de la Comisión sobre una presentación: validar,
// observar, rechazar y volver a observada lo rechazado.
//
// TRES de las cuatro le escriben al socio, y las tres por el mismo motivo: lo
// que la Comisión decide acá le cuelga la condición de socio de un plazo, y el
// vecino no tiene ninguna otra forma de enterarse.
//
// ── Por qué son de ADMIN y no de superadmin ──────────────────────────────────
// Convocar el proceso y abrir la segunda instancia son actos de la Comisión y
// van con `requireSuperadmin` (ver `../../actions.ts`). Revisar una
// presentación contra el DNI que el vecino subió es trabajo de mostrador: lo
// hace el rol común de administración. Lo que sí es igual es DÓNDE va la
// guarda: en la primera línea de cada action, porque una server action se
// despacha por el id del encabezado `Next-Action` y ni el proxy ni el layout
// corren sobre estos POST — y el rol del token puede tener hasta 8 horas de
// atraso, así que `requireAdmin` resuelve contra la fila viva de `User`.
//
// ── Lo que estas cuatro NO hacen ─────────────────────────────────────────────
// Ninguna decide nada: las reglas —el cerrojo contra dos administradores, qué
// campos entran a la ficha, la nota obligatoria— viven en
// `@/lib/reregistration/presentation`, que se prueba sin base. Acá quedan la
// sesión, las cabeceras, el correo y la auditoría, que es el reparto de siempre
// del panel.
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth/require-admin";
import { verificationActorLimiter, verificationMemberLimiter } from "@/lib/auth/rate-limiter";
import { mailer } from "@/lib/email";
import {
  portalInvite, presentationObservedEmail, presentationRejectedEmail,
} from "@/lib/email/templates";
import { parseForm } from "@/lib/forms";
import {
  ACCOUNT_EMAIL_NOTICE_WARNINGS, accountEmailNotice, accountEmailNoticeWarning,
} from "@/lib/members/account-email-notice";
import { verificationTarget } from "@/lib/members/card-edit";
import { prisma } from "@/lib/prisma";
import { PRESENTATIONS_BASE } from "@/lib/admin/presentation-queue";
import { OBSERVATION_MAX, presentations } from "@/lib/reregistration/presentation";
import { presentationResumeUrl, reregistrationBaseUrl } from "@/lib/reregistration/resume-link";
import { currentDeadline } from "@/lib/reregistration/rules";
import { hashToken, MEMBER_EMAIL_TOKEN_PURPOSES, tokens } from "@/lib/tokens";
import type { Member } from "@/generated/prisma/client";

/** `warning` es una decisión que SÍ se tomó pero dejó algo pendiente de mano
 *  humana (un correo que no salió). Es distinto de `error`, que significa que
 *  no se escribió nada. */
export type DecisionState = { error?: string; ok?: boolean; warning?: string };

const idSchema = z.object({ presentationId: z.coerce.number().int().positive() });

async function clientIp(): Promise<string> {
  // Sólo X-Real-IP, como en el resto del panel: el resto de las cabeceras de IP
  // las puede fijar el cliente si le pega directo al origen.
  return (await headers()).get("x-real-ip") ?? "unknown";
}

// Del error sólo se conserva el CÓDIGO, nunca el objeto: los de nodemailer
// traen el sobre SMTP —o sea la dirección del socio en claro— y el log de PM2
// no está cubierto por los cuidados de docs/08 (Ley 25.326).
function codeOf(e: unknown): string {
  return typeof e === "object" && e !== null && "code" in e ? String(e.code) : "unknown";
}

function refresh(presentationId: number): void {
  revalidatePath(`${PRESENTATIONS_BASE}/${presentationId}`);
  revalidatePath(PRESENTATIONS_BASE);
  // Los contadores del tablero salen de estos mismos estados.
  revalidatePath("/admin/reempadronamiento");
}

// ─────────────────────────────────────────────────────────────────────────────
// Validar
// ─────────────────────────────────────────────────────────────────────────────

const VERIFICATION_FAILED_WARNING =
  "Se validó la presentación y los datos ya están en la ficha, pero no se pudo enviar la " +
  "verificación de la casilla nueva. Reintentala desde el modo carga de la ficha del socio.";
const VERIFICATION_THROTTLED_WARNING =
  "Se validó la presentación y los datos ya están en la ficha, pero no salió la verificación de " +
  "la casilla: ya se le mandaron varios correos a este socio en la última hora. Reintentala más " +
  "tarde desde el modo carga de su ficha.";

/** La verificación de la casilla declarada (REG-08), para el socio que NO tiene
 *  cuenta de acceso — que es el caso de casi toda la cohorte: el padrón
 *  importado no trae usuarios.
 *
 *  Calcada de `sendVerificationAction` del modo carga, con sus tres cuidados:
 *  los mismos dos cupos (si no, este camino sería la vuelta larga para
 *  saltearse el techo de correos por socio), el enlace anterior revocado al
 *  emitir uno nuevo, y el token QUEMADO si el envío falla — un enlace de
 *  verificación vivo que nadie recibió es superficie de ataque sin ninguna
 *  contrapartida.
 *
 *  Quién decide qué correo corresponde es `verificationTarget`, la misma
 *  función que usa el botón del panel: una sola fuente de verdad, y si algún
 *  día deja de corresponder, este camino se cierra solo.
 *
 *  Devuelve `null` si salió, o el texto del aviso para el operador si no. */
async function sendVerification(
  member: Pick<Member, "id" | "fullName" | "status" | "email" | "emailStatus" | "userId">,
  actorId: number,
): Promise<string | null> {
  const target = verificationTarget(member);
  // No corresponde ningún correo (el socio ya tiene cuenta con la dirección
  // verificada, por ejemplo). No es un problema que el operador tenga que
  // resolver: la validación se hizo y la ficha quedó bien.
  if (!target.ok) return null;

  const memberKey = `member:${member.id}`;
  const actorKey = `actor:${actorId}`;
  // Se consultan los DOS cupos y recién después se registran, para que el
  // primero no le cobre el intento a su clave cuando el segundo va a rechazar.
  if (!verificationMemberLimiter.allows(memberKey) || !verificationActorLimiter.allows(actorKey)) {
    return VERIFICATION_THROTTLED_WARNING;
  }
  verificationMemberLimiter.record(memberKey);
  verificationActorLimiter.record(actorKey);

  let raw: string | null = null;
  try {
    // Un enlace vivo por socio: el reenvío invalida el anterior. Revocar al
    // emitir es legítimo acá porque este camino está detrás de `requireAdmin`.
    await tokens.revokeForMember(member.id, MEMBER_EMAIL_TOKEN_PURPOSES);
    raw = await tokens.issue({ purpose: target.kind, memberId: member.id });
    const { message, summary } = portalInvite({
      kind: target.kind, name: member.fullName, baseUrl: reregistrationBaseUrl(), token: raw,
    });
    await mailer.sendToMember({
      memberId: member.id, to: target.email, type: target.kind, message, summary,
    });
    return null;
  } catch (e) {
    if (raw !== null) {
      try {
        // El enlace ya emitido se quema: uno vivo que nadie recibió es
        // superficie de ataque sin ninguna contrapartida. Va en su propio
        // `try` porque es una tercera escritura y tampoco puede tumbar la
        // action: un token huérfano vive 7 días y muere solo.
        await prisma.actionToken.deleteMany({ where: { tokenHash: hashToken(raw) } });
      } catch (burn) {
        console.error("[presentaciones] no se pudo quemar la verificación no entregada del socio", member.id, "code:", codeOf(burn));
      }
    }
    // Sin correo acreditado ni enlace vivo no hay nada que racionar.
    verificationMemberLimiter.refund(memberKey);
    verificationActorLimiter.refund(actorKey);
    console.error("[presentaciones] falló la verificación de la casilla del socio", member.id, "code:", codeOf(e));
    return VERIFICATION_FAILED_WARNING;
  }
}

export async function validatePresentationAction(
  _prev: DecisionState,
  formData: FormData,
): Promise<DecisionState> {
  const actor = await requireAdmin();
  if (!actor.ok) return { error: actor.error };

  const parsed = parseForm(idSchema, formData);
  if (!parsed.ok) return { error: parsed.error };
  const { presentationId } = parsed.data;

  const result = await presentations.validate({ presentationId, actorId: actor.actorId });
  if (!result.ok) return { error: result.error };

  // ── Todo lo que sigue es POSTERIOR al commit y best-effort ────────────────
  // La ficha ya está escrita y la presentación ya está validada. Un SMTP caído
  // no puede convertir eso en una pantalla de error: el reflejo del operador
  // sería volver a apretar Validar, y sobre una presentación ya resuelta eso
  // ahora contesta "otro administrador ya resolvió esta presentación", que es
  // desconcertante y falso.
  let warning: string | null = null;
  let verificationHandled = false;
  if (result.emailChanged) {
    verificationHandled = true;
    if (result.accountEmailMove) {
      // El socio TENÍA cuenta y la dirección con la que ingresa acaba de
      // mudarse. Eso son dos correos —el aviso a la casilla que perdió el
      // acceso y la verificación de la nueva— y los manda el módulo que ya
      // existe para eso, con sus mismos cupos.
      const notice = await accountEmailNotice.announce({
        member: result.member,
        previousEmail: result.accountEmailMove.from,
        actorId: actor.actorId,
      }).catch((e) => {
        console.error("[presentaciones] falló el aviso de mudanza de la dirección de ingreso del socio", result.memberId, "code:", codeOf(e));
        return null;
      });
      warning = notice === null ? ACCOUNT_EMAIL_NOTICE_WARNINGS.both : accountEmailNoticeWarning(notice);
    } else {
      warning = await sendVerification(result.member, actor.actorId);
    }
  }

  const ip = await clientIp();
  // IDS, NOMBRES DE CAMPOS Y BANDERAS (Ley 25.326): nunca el email, el DNI, el
  // domicilio ni el teléfono que se acaban de volcar.
  await audit({
    userId: actor.actorId,
    action: "presentation_validate",
    entity: "presentation",
    entityId: presentationId,
    detail: {
      memberId: result.memberId,
      applied: result.applied,
      emailChanged: result.emailChanged,
      // Mover la dirección de INGRESO de un socio es un hecho propio, no un
      // campo más de la ficha: se asienta aparte aunque `applied` traiga
      // "email".
      ...(result.accountEmailMove ? { accountEmailUpdated: true } : {}),
      ...(verificationHandled ? { verificationSent: warning === null } : {}),
    },
    ip,
  });

  refresh(presentationId);
  return warning ? { ok: true, warning } : { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Observar
// ─────────────────────────────────────────────────────────────────────────────

const observeSchema = idSchema.extend({
  note: z.string().max(OBSERVATION_MAX, `La observación no puede superar los ${OBSERVATION_MAX} caracteres.`),
});

export async function observePresentationAction(
  _prev: DecisionState,
  formData: FormData,
): Promise<DecisionState> {
  const actor = await requireAdmin();
  if (!actor.ok) return { error: actor.error };

  const parsed = parseForm(observeSchema, formData);
  if (!parsed.ok) return { error: parsed.error };
  const { presentationId, note } = parsed.data;

  const result = await presentations.observe({ presentationId, actorId: actor.actorId, note });
  if (!result.ok) return { error: result.error };

  // El correo de la observación, con la LLAVE rotada en el orden acuñar →
  // ENVIAR → persistir. Al revés, un rebote del SMTP dejaría al vecino sin
  // ninguna llave viva: sin la vieja, que ya habríamos pisado, y sin la nueva,
  // que nunca llegó. Es la lección de `applications/service.ts`, calcada.
  let mailed = false;
  try {
    const { raw, hash } = presentations.mintResumeToken();
    await mailer.sendToMember({
      memberId: result.memberId,
      // `to` explícito: la observación va a la casilla DECLARADA en la
      // presentación, que puede no ser la de la ficha —de hecho la enorme
      // mayoría del padrón no tiene ninguna—. La Notification cuelga igual del
      // socio, que es lo que le da carácter fehaciente (Art. 5° quater).
      to: result.email,
      type: "presentation_observed",
      message: presentationObservedEmail({
        url: presentationResumeUrl(raw),
        // LA NOTA VA SÍ O SÍ. La plantilla la acepta opcional —la omite a
        // propósito en el reenvío del enlace, donde repetirla sería tener el
        // mismo pedido en dos correos que pueden divergir—, así que si este
        // llamador se la olvidara, al vecino le llegaría "el detalle te lo
        // mandamos cuando lo revisamos" sin que ese detalle exista en ningún
        // lado: un callejón sin salida con el plazo corriendo. Lo fija un test.
        observation: result.note,
        // Hasta cuándo tiene. `currentDeadline` decide cuál de las dos
        // instancias manda; escribirlo acá a mano le citaría al vecino la fecha
        // de la instancia equivocada.
        deadline: currentDeadline(result.process),
      }),
      summary: "observación del re-empadronamiento",
    });
    // Sólo si el correo SALIÓ: acá la llave nueva reemplaza a la anterior.
    await presentations.commitResumeToken(result.presentationId, hash);
    mailed = true;
  } catch (e) {
    console.error("[presentaciones] falló el correo de observación", presentationId, "code:", codeOf(e));
  }

  await audit({
    userId: actor.actorId,
    action: "presentation_observe",
    entity: "presentation",
    entityId: presentationId,
    // El TEXTO de la observación NO va al asiento: es texto libre escrito por
    // el operador y puede nombrar al socio o describir su documento (docs/08).
    detail: { memberId: result.memberId, mailed },
    ip: await clientIp(),
  });

  refresh(presentationId);
  return mailed
    ? { ok: true }
    : {
        ok: true,
        warning:
          "Se observó la presentación, pero no se pudo enviar el correo con el detalle. " +
          "Avisale al socio por otro medio: sin ese correo no tiene cómo saber qué corregir " +
          "ni por dónde entrar.",
      };
}

// ─────────────────────────────────────────────────────────────────────────────
// Rechazar y revertir
// ─────────────────────────────────────────────────────────────────────────────

const rejectSchema = idSchema.extend({
  note: z.string().max(OBSERVATION_MAX, `El motivo no puede superar los ${OBSERVATION_MAX} caracteres.`).optional(),
});

export async function rejectPresentationAction(
  _prev: DecisionState,
  formData: FormData,
): Promise<DecisionState> {
  const actor = await requireAdmin();
  if (!actor.ok) return { error: actor.error };

  const parsed = parseForm(rejectSchema, formData);
  if (!parsed.ok) return { error: parsed.error };
  const { presentationId, note } = parsed.data;

  const result = await presentations.reject({ presentationId, actorId: actor.actorId, note });
  if (!result.ok) return { error: result.error };

  // EL AVISO AL SOCIO. Antes el rechazo no mandaba nada y el vecino se quedaba
  // tranquilo con el trámite caído: se enteraba con la baja, cuando ya no había
  // nada que corregir. Best-effort y POSTERIOR a la decisión, igual que el
  // correo de la observación: el rechazo ya está asentado y un SMTP caído no
  // puede convertirlo en una pantalla de error —el reflejo del operador sería
  // volver a apretar Rechazar, y sobre una presentación ya resuelta eso contesta
  // "otro administrador ya resolvió esta presentación", que es falso.
  //
  // NO rota la llave de retome, y no es una omisión: una presentación rechazada
  // no vuelve a ser editable por la web (`EDITABLE_STATUSES`), así que no hay
  // enlace que entregar. Por eso este correo no lleva ninguno y la salida que
  // ofrece es la sede.
  let mailed = false;
  try {
    await mailer.sendToMember({
      memberId: result.memberId,
      // La casilla DECLARADA en la presentación, como la observación: puede no
      // ser la de la ficha (casi toda la cohorte no tiene ninguna). La
      // Notification cuelga igual del socio, que es lo que le da carácter
      // fehaciente (Art. 5° quater).
      to: result.email,
      type: "presentation_rejected",
      message: presentationRejectedEmail({
        // EL MOTIVO VA SÍ O SÍ CUANDO EXISTE. La plantilla lo acepta opcional
        // —tiene que valerse sin él, porque en la pantalla el motivo lo es—,
        // así que si este llamador se lo olvidara, al vecino le llegaría
        // "preguntanos en la sede por qué" con el motivo escrito y guardado a
        // un centímetro. Lo fija un test.
        note: result.note,
        // Hasta cuándo puede volver a presentarse. `currentDeadline` decide
        // cuál de las dos instancias manda.
        deadline: currentDeadline(result.process),
      }),
      summary: "rechazo del re-empadronamiento",
    });
    mailed = true;
  } catch (e) {
    console.error("[presentaciones] falló el correo de rechazo", presentationId, "code:", codeOf(e));
  }

  await audit({
    userId: actor.actorId,
    action: "presentation_reject",
    entity: "presentation",
    entityId: presentationId,
    // Si hubo motivo escrito se asienta que lo hubo, nunca cuál. `mailed` es lo
    // único que después permite saber si al socio se le avisó antes de la baja.
    detail: { memberId: result.memberId, hasNote: Boolean(note?.trim()), mailed },
    ip: await clientIp(),
  });

  refresh(presentationId);
  return mailed
    ? { ok: true }
    : {
        ok: true,
        warning:
          "Se rechazó la presentación, pero no se pudo enviar el correo que se lo avisa al socio. " +
          "Avisale por otro medio: sin ese correo se queda creyendo que su trámite está hecho y no " +
          "vuelve a presentarse antes de que venza el plazo.",
      };
}

export async function unrejectPresentationAction(
  _prev: DecisionState,
  formData: FormData,
): Promise<DecisionState> {
  const actor = await requireAdmin();
  if (!actor.ok) return { error: actor.error };

  const parsed = parseForm(idSchema, formData);
  if (!parsed.ok) return { error: parsed.error };
  const { presentationId } = parsed.data;

  const result = await presentations.unreject({ presentationId, actorId: actor.actorId });
  if (!result.ok) return { error: result.error };

  await audit({
    userId: actor.actorId,
    action: "presentation_unreject",
    entity: "presentation",
    entityId: presentationId,
    detail: { memberId: result.memberId },
    ip: await clientIp(),
  });

  refresh(presentationId);
  return { ok: true };
}
