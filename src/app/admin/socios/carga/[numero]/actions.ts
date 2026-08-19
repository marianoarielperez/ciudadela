"use server";
// Modo carga: edición de los datos de ficha de un socio ya asentado en el libro.
//
// A diferencia de las acciones societarias (../[id]/actions.ts), acá NO hay
// acta: pasar a máquina lo que ya está escrito en la ficha de papel no es un
// movimiento del padrón, es completar el registro. Por eso esta action no toca
// nunca `joinedAt`, `status`, `category` ni `withdrawalReason`: esos campos sólo
// cambian por un asiento con acta, y dejarlos entrar acá abriría una puerta
// lateral para modificar el libro sin dejar el rastro estatutario.
import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/auth";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { parseForm } from "@/lib/forms";
import { civilDateUtc } from "@/lib/dates";
import { isAdmin } from "@/lib/auth/roles";
import { hashToken, tokens } from "@/lib/tokens";
import { mailer } from "@/lib/email";
import { verificationEmail } from "@/lib/email/templates";
import type { EmailStatus, Member } from "@/generated/prisma/client";

const schema = z.object({
  memberId: z.coerce.number().int().positive("Socio inválido."),
  fullName: z.string().min(3, "Ingresá apellido y nombre"),
  dni: z.string().regex(/^\d{7,9}$/, "DNI inválido (7 a 9 dígitos, sin puntos)").optional(),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha de nacimiento inválida").optional(),
  civilStatus: z.string().max(40, "El estado civil no puede superar los 40 caracteres").optional(),
  nationality: z.string().max(60, "La nacionalidad no puede superar los 60 caracteres").optional(),
  occupation: z.string().max(80, "La ocupación no puede superar los 80 caracteres").optional(),
  phone: z.string().max(40, "El teléfono no puede superar los 40 caracteres").optional(),
  streetId: z.coerce.number().int().positive("Calle inválida.").optional(),
  streetText: z.string().max(120, "La calle no puede superar los 120 caracteres").optional(),
  streetNumber: z.string().max(10, "La altura no puede superar los 10 caracteres").optional(),
  neighborhood: z.string().max(60, "El barrio no puede superar los 60 caracteres").optional(),
  email: z.email("Email inválido").max(191, "El email es demasiado largo").optional(),
});

// Los datos que esta pantalla puede escribir. Enumerarlos explícitamente es la
// lista blanca: lo que no está acá no se toca aunque venga en el FormData.
type Patch = {
  fullName: string;
  dni: string | null;
  birthDate: Date | null;
  civilStatus: string | null;
  nationality: string | null;
  occupation: string | null;
  phone: string | null;
  streetId: number | null;
  streetText: string | null;
  streetNumber: string | null;
  neighborhood: string | null;
  email: string | null;
  emailStatus: EmailStatus;
  emailVerifiedAt: Date | null;
};

// Sin `export`: en un módulo "use server" todo lo exportado es un endpoint.
type Actor = { ok: true; actorId: number } | { ok: false; error: string };

// El proxy (proxy.ts) ya filtra /admin, pero Next recomienda que cada server
// action se autorice a sí misma: son endpoints POST públicos y estas dos tocan
// datos personales alcanzados por la Ley 25.326. Defensa en profundidad.
async function requireAdmin(): Promise<Actor> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Sesión inválida." };
  if (!isAdmin(session.user.roles)) return { ok: false, error: "No tenés permiso para editar el padrón." };
  return { ok: true, actorId: Number(session.user.id) };
}

async function clientIp(): Promise<string> {
  // Sólo X-Real-IP, como en el login: el resto de las cabeceras de IP las puede
  // fijar el cliente si le pega directo al origen.
  return (await headers()).get("x-real-ip") ?? "unknown";
}

function changedFields(member: Member, patch: Patch): string[] {
  return (Object.keys(patch) as Array<keyof Patch>).filter((key) => {
    const next = patch[key];
    const prev = member[key];
    if (next instanceof Date || prev instanceof Date) {
      const a = next instanceof Date ? next.getTime() : null;
      const b = prev instanceof Date ? prev.getTime() : null;
      return a !== b;
    }
    return next !== prev;
  });
}

export type SaveState = { error?: string; saved?: boolean; unchanged?: boolean };

export async function updateMemberAction(_prev: SaveState, formData: FormData): Promise<SaveState> {
  const actor = await requireAdmin();
  if (!actor.ok) return { error: actor.error };

  const parsed = parseForm(schema, formData);
  if (!parsed.ok) return { error: parsed.error };
  const d = parsed.data;

  const member = await prisma.member.findUnique({ where: { id: d.memberId } });
  if (!member) return { error: "Socio inexistente." };

  // El regex acepta "1983-02-31" y "0198-01-01": el <input type="date"> no los
  // produce, pero una action es un endpoint y `civilDateUtc` desbordaría el día
  // en silencio.
  let birthDate: Date | null = null;
  if (d.birthDate) {
    const [y, m, day] = d.birthDate.split("-").map(Number);
    birthDate = civilDateUtc(y, m, day);
    const rolled =
      birthDate.getUTCFullYear() !== y || birthDate.getUTCMonth() + 1 !== m || birthDate.getUTCDate() !== day;
    if (rolled) return { error: "Fecha de nacimiento inválida." };
    if (y < 1900 || birthDate.getTime() > Date.now()) {
      return { error: "La fecha de nacimiento tiene que estar entre 1900 y hoy." };
    }
  }

  const streetId = d.streetId ?? null;
  if (streetId !== null) {
    const street = await prisma.street.findUnique({ where: { id: streetId }, select: { id: true } });
    if (!street) return { error: "La calle elegida no existe en el catálogo." };
  }

  // Comparamos en minúsculas contra lo guardado: varios emails del padrón
  // importado vienen con mayúsculas, y sin esto abrir y guardar una ficha sin
  // tocar el email le bajaría la verificación a "declared" por un cambio que no
  // existió.
  const email = d.email?.toLowerCase() ?? null;
  const emailChanged = email !== (member.email?.toLowerCase() ?? null);

  const patch: Patch = {
    fullName: d.fullName,
    dni: d.dni ?? null,
    birthDate,
    civilStatus: d.civilStatus ?? null,
    nationality: d.nationality ?? null,
    occupation: d.occupation ?? null,
    phone: d.phone ?? null,
    streetId,
    // Con calle del catálogo el texto libre sobra: dejar los dos daría un
    // domicilio con dos fuentes de verdad.
    streetText: streetId ? null : d.streetText ?? null,
    streetNumber: d.streetNumber ?? null,
    neighborhood: d.neighborhood ?? null,
    email,
    // Email nuevo o cambiado vuelve a "declared"; borrado → "none"; igual → intacto.
    emailStatus: emailChanged ? (email ? "declared" : "none") : member.emailStatus,
    emailVerifiedAt: emailChanged ? null : member.emailVerifiedAt,
  };

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

  // La auditoría con IP la escribe la action: es la única capa que ve las
  // cabeceras. Sólo los NOMBRES de los campos tocados, nunca los valores: el
  // DNI y el domicilio no van al log (Ley 25.326).
  await audit({
    userId: actor.actorId, action: "member_update", entity: "member", entityId: member.id,
    detail: { fields: changed }, ip: await clientIp(),
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
  if (!member.email) return { error: "El socio no tiene email cargado. Guardá la ficha primero." };
  if (member.emailStatus === "verified") return { error: "El email ya está verificado." };

  const ip = await clientIp();
  const raw = await tokens.issue({ purpose: "email_verification", memberId: member.id });
  const base = process.env.AUTH_URL ?? "http://localhost:3000";

  try {
    await mailer.sendToMember({
      memberId: member.id, to: member.email, type: "email_verification",
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
    console.error("[carga] falló el envío de verificación al socio", member.id, e);
    // El intento sí queda auditado: alguien apretó el botón y no salió nada, y
    // eso es exactamente lo que hay que poder reconstruir después. En el detalle
    // va sólo el código del error, nunca el mensaje del SMTP (puede traer la
    // dirección del destinatario).
    const code = typeof e === "object" && e !== null && "code" in e ? String(e.code) : "unknown";
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
