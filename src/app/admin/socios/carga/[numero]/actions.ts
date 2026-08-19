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
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { parseForm } from "@/lib/forms";
import { requireAdmin } from "@/lib/auth/require-admin";
import { verificationActorLimiter, verificationMemberLimiter } from "@/lib/auth/rate-limiter";
import { hashToken, tokens, MEMBER_EMAIL_TOKEN_PURPOSES } from "@/lib/tokens";
import { mailer } from "@/lib/email";
import { verificationEmail } from "@/lib/email/templates";
import {
  buildPatch, cardSchema, changedFields, parseBirthDate, verificationTarget,
} from "@/lib/members/card-edit";

async function clientIp(): Promise<string> {
  // Sólo X-Real-IP, como en el login: el resto de las cabeceras de IP las puede
  // fijar el cliente si le pega directo al origen.
  return (await headers()).get("x-real-ip") ?? "unknown";
}

export type SaveState = { error?: string; saved?: boolean; unchanged?: boolean };

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

  const { patch, emailChanged } = buildPatch(member, d, birth.value);

  const changed = changedFields(member, patch);
  // Ctrl+S es la forma normal de guardar en esta pantalla y se aprieta de más.
  // Sin esto, cada repetición dejaría un asiento de auditoría que no
  // corresponde a ningún cambio y ensuciaría el rastro que sí importa.
  if (changed.length === 0) return { saved: true, unchanged: true };

  try {
    await prisma.member.update({ where: { id: member.id }, data: patch });
  } catch (e) {
    if (typeof e === "object" && e !== null && "code" in e && e.code === "P2002") {
      return { error: "Ya existe otro socio con ese DNI." };
    }
    throw e;
  }

  // Los tokens vivos se emitieron para la dirección VIEJA: si el email cambió o
  // se borró, un enlace que quedó en ese buzón verificaría —y en el alta de
  // contraseña, tomaría— la cuenta de un socio cuyo domicilio electrónico ahora
  // es otro. Es el mismo caso del dedazo ("vecino@gmial.com"). Van después del
  // update: si el guardado falla, el email no cambió y no hay nada que revocar.
  const revoked = emailChanged
    ? await tokens.revokeForMember(member.id, MEMBER_EMAIL_TOKEN_PURPOSES)
    : 0;

  // La auditoría con IP la escribe la action: es la única capa que ve las
  // cabeceras. Sólo los NOMBRES de los campos tocados, nunca los valores: el
  // DNI y el domicilio no van al log (Ley 25.326).
  await audit({
    userId: actor.actorId, action: "member_update", entity: "member", entityId: member.id,
    detail: revoked > 0 ? { fields: changed, revokedTokens: revoked } : { fields: changed },
    ip: await clientIp(),
  });
  return { saved: true };
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
  // asiento de Notification que lo acredita. Primero el del admin, que es el más
  // amplio, para no gastarle el cupo al socio cuando el barrido ya está frenado.
  if (!verificationActorLimiter.check(`actor:${actor.actorId}`)) {
    return { error: "Enviaste demasiadas verificaciones seguidas. Esperá un rato antes de seguir." };
  }
  if (!verificationMemberLimiter.check(`member:${member.id}`)) {
    return { error: "Ya se le enviaron varios correos de verificación a este socio en la última hora. Esperá antes de reintentar." };
  }

  const ip = await clientIp();
  // Un enlace vivo por socio: el reenvío invalida el anterior. Si no, "no me
  // llegó" deja varios enlaces válidos en paralelo durante 7 días, cada uno
  // capaz de crear la contraseña de la cuenta.
  await tokens.revokeForMember(member.id, MEMBER_EMAIL_TOKEN_PURPOSES);
  const raw = await tokens.issue({ purpose: "email_verification", memberId: member.id });
  const base = process.env.AUTH_URL ?? "http://localhost:3000";

  try {
    await mailer.sendToMember({
      memberId: member.id, to: target.email, type: "email_verification",
      message: verificationEmail({ name: member.fullName, url: `${base}/verificar/${raw}` }),
      summary: "verificación de email + invitación de acceso",
    });
  } catch (e) {
    // `mailer.sendToMember` propaga la excepción del SMTP y NO registra la
    // Notification: es deliberado, no se acredita un envío que no salió (el
    // estatuto le da carácter fehaciente al domicilio electrónico). Pero una
    // excepción que sale de la action rompe el render y le deja al operador una
    // pantalla de error genérica en inglés. Acá la traducimos a un mensaje que
    // dice la verdad —no se envió— y dejamos la pantalla usable.
    //
    // El token ya emitido se quema: un enlace de verificación vivo que nadie
    // recibió es superficie de ataque sin ninguna contrapartida.
    await prisma.actionToken.deleteMany({ where: { tokenHash: hashToken(raw) } });
    // Ni el log ni el detalle de auditoría llevan el objeto de error: los errores
    // de nodemailer traen `envelope`, `rejected` y el `response` del SMTP, o sea
    // el email del socio en claro, y el log de PM2 no está cubierto por los
    // cuidados de docs/08 (Ley 25.326). Con el id del socio y el código del
    // error alcanza para diagnosticar: el resto se reconstruye desde la base.
    const code = typeof e === "object" && e !== null && "code" in e ? String(e.code) : "unknown";
    console.error("[carga] falló el envío de verificación al socio", member.id, "code:", code);
    // El intento sí queda auditado: alguien apretó el botón y no salió nada, y
    // eso es exactamente lo que hay que poder reconstruir después.
    await audit({
      userId: actor.actorId, action: "member_send_verification_failed", entity: "member",
      entityId: member.id, detail: { code }, ip,
    });
    return { error: "No se pudo enviar el email. Verificá la dirección y reintentá; si sigue fallando, revisá la configuración de correo." };
  }

  await audit({
    userId: actor.actorId, action: "member_send_verification", entity: "member",
    entityId: member.id, ip,
  });
  return { sent: true };
}
