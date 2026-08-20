"use server";
// Las actions públicas del wizard ASOCIATE. No hay sesión: la creación se
// protege con Turnstile + rate limit por IP, y el resto del circuito con el
// token de retome. Los mensajes de bloqueo vienen de `checkEligibility` y no
// revelan más de lo necesario (spec M3 §4).
import { headers } from "next/headers";
import { after } from "next/server";
import { z } from "zod";
import { audit } from "@/lib/audit";
import {
  applicationCreateLimiter, resumeResendLimiter, resumeResendTargetLimiter,
} from "@/lib/auth/rate-limiter";
import { checkEligibility } from "@/lib/applications/eligibility";
import { applicationService, DuplicateLiveApplicationError } from "@/lib/applications/service";
import { categoryAllowedForResidence, civilTodayAr, isAdult, WEB_CATEGORIES } from "@/lib/applications/wizard";
import { parseCivilDate } from "@/lib/dates";
import { mailer } from "@/lib/email";
import { applicationResumeEmail, verificationEmail, verifyUrl } from "@/lib/email/templates";
import { parseForm } from "@/lib/forms";
import { prisma } from "@/lib/prisma";
import { tokens } from "@/lib/tokens";
import { verifyTurnstile } from "@/lib/turnstile";

// Sin `export`: en un módulo "use server" todo lo exportado tiene que ser una
// función async (lo exportado es un endpoint). Los formularios cliente declaran
// su propio tipo estructural equivalente.
type CreateState = {
  error?: string;
  blocked?: {
    code: "in_progress" | "already_member" | "visit_office" | "debt" | "rejected_wait";
    message: string;
    retryAtIso?: string;
  };
  created?: { resumeToken: string };
};
type ResendState = { error?: string; done?: boolean };

const TOO_MANY = "Demasiados intentos desde esta conexión. Probá de nuevo en un rato.";
const NO_CAPTCHA = "No pudimos verificar que sos una persona. Recargá la página y probá de nuevo.";
const BAD_BIRTH_DATE = "La fecha de nacimiento no es válida.";
const IN_PROGRESS = "Ya tenés una solicitud en trámite. Te podemos reenviar por email el enlace para retomarla.";
// Respuesta única del reenvío: la misma exista o no la solicitud.
const RESEND_DONE: ResendState = { done: true };

const dniSchema = z.string().regex(/^\d{7,9}$/, "DNI inválido (solo números, sin puntos)");

const schema = z.object({
  livesInBarrio: z.enum(["si", "no"], { error: "Contanos dónde vivís." }),
  streetId: z.coerce.number({ error: "Elegí tu calle del listado." }).int().positive("Elegí tu calle del listado.").optional(),
  streetText: z.string().max(120, "La calle no puede superar los 120 caracteres").optional(),
  neighborhood: z.string().max(60, "El barrio no puede superar los 60 caracteres").optional(),
  streetNumber: z.string().min(1, "Ingresá la altura").max(10, "La altura no puede superar los 10 caracteres"),
  requestedCategory: z.enum(WEB_CATEGORIES, { error: "Elegí la categoría." }),
  wantsDebit: z.enum(["si", "no"], { error: "Indicá si querés adherir al débito automático." }).optional(),
  fullName: z.string().min(3, "Ingresá tu nombre y apellido").max(160, "El nombre no puede superar los 160 caracteres"),
  dni: dniSchema,
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ingresá tu fecha de nacimiento"),
  civilStatus: z.string().min(1, "Ingresá tu estado civil").max(40, "El estado civil no puede superar los 40 caracteres"),
  nationality: z.string().min(1, "Ingresá tu nacionalidad").max(60, "La nacionalidad no puede superar los 60 caracteres"),
  occupation: z.string().min(1, "Ingresá tu ocupación").max(80, "La ocupación no puede superar los 80 caracteres"),
  phone: z.string().min(6, "Ingresá tu teléfono").max(40, "El teléfono no puede superar los 40 caracteres"),
  email: z.email("Ingresá un email válido").max(191, "El email no puede superar los 191 caracteres"),
  emailConfirm: z.string().min(1, "Repetí tu email"),
  acceptTerms: z.literal("on", { error: "Tenés que aceptar los términos y el consentimiento de datos." }),
});

// Sólo X-Real-IP, como el login y el recupero: el resto de las cabeceras de IP
// las puede fijar el cliente si le pega directo al origen, y rotándolas se
// regalaría un presupuesto nuevo del limitador en cada intento.
async function requestMeta() {
  const h = await headers();
  return { ip: h.get("x-real-ip") ?? "unknown", userAgent: (h.get("user-agent") ?? "").slice(0, 255) };
}

function baseUrl(): string {
  return process.env.AUTH_URL ?? "http://localhost:3000";
}

// Los errores de nodemailer traen `envelope` y el `response` del SMTP, o sea la
// dirección en claro, y el log de PM2 no está cubierto por los cuidados de
// docs/08 (Ley 25.326). Al log va sólo el código.
function codeOf(e: unknown): string {
  return typeof e === "object" && e !== null && "code" in e ? String((e as { code: unknown }).code) : "unknown";
}

export async function createApplicationAction(_prev: CreateState, formData: FormData): Promise<CreateState> {
  const { ip, userAgent } = await requestMeta();

  // El orden es `allows` → captcha → formato → `record` → padrón.
  //
  // Se consulta el cupo primero (no se gasta un intento contra alguien que ya
  // está bloqueado) y se REGISTRA recién después del captcha y de las
  // validaciones puras. Que el registro vaya después del captcha evita que uno
  // vencido —la ficha dura 5 minutos y el paso 3 del wizard puede tardar más—
  // le queme un intento al vecino. Que vaya después del formato evita lo mismo
  // con los tipeos: son ~16 campos y el formulario reporta un error por vez, así
  // que corregir la fecha, el email repetido y la altura podía comerse los cinco
  // intentos de la hora sin haber llegado nunca a la base.
  //
  // Esto NO afloja la anti-enumeración de §4: la validez de FORMATO no depende
  // del padrón (es zod sobre el POST, ninguna consulta), cada intento sigue
  // costando un captcha resuelto —el token de Turnstile es de un solo uso— y
  // todo lo que toca el padrón sigue detrás del captcha Y del cupo ya gastado.
  if (!applicationCreateLimiter.allows(ip)) return { error: TOO_MANY };
  const captcha = await verifyTurnstile(String(formData.get("cf-turnstile-response") ?? ""), ip);
  if (!captcha) return { error: NO_CAPTCHA };

  const parsed = parseForm(schema, formData);
  if (!parsed.ok) return { error: parsed.error };
  const data = parsed.data;

  const email = data.email.toLowerCase();
  if (email !== data.emailConfirm.toLowerCase()) {
    return { error: "Los dos emails no coinciden: revisá el tipeo." };
  }

  const livesInBarrio = data.livesInBarrio === "si";
  if (livesInBarrio && !data.streetId) return { error: "Elegí tu calle del listado del barrio." };
  if (!livesInBarrio && (!data.streetText || !data.neighborhood)) {
    return { error: "Ingresá tu calle y tu barrio." };
  }
  // Revalidación de REG-01 en el server: el paso 2 del wizard ya filtra las
  // opciones, pero un POST armado a mano no pasa por ese filtro.
  if (!categoryAllowedForResidence(data.requestedCategory, livesInBarrio)) {
    return { error: "La categoría elegida no corresponde a tu lugar de residencia. Volvé al paso 2." };
  }

  // El día civil argentino, no el UTC del server (ver `civilTodayAr`).
  const today = civilTodayAr();
  const birth = parseCivilDate(data.birthDate, {
    invalidError: BAD_BIRTH_DATE,
    maxDate: today,
    rangeError: BAD_BIRTH_DATE,
  });
  if (!birth.ok) return { error: birth.error };
  if (!isAdult(birth.value, today)) {
    return {
      error: "Para asociarte por la web tenés que ser mayor de 18 años. Los cadetes (14-17) se asocian en la sede.",
    };
  }

  // Desde acá se toca el padrón, así que el intento se cobra: el cupo es lo
  // único, junto con el captcha, que impide usar este formulario para barrerlo.
  applicationCreateLimiter.record(ip);

  // Elegibilidad por DNI (spec §4): corre DESPUÉS de Turnstile + rate limit,
  // que son lo único que impide usar este formulario para barrer el padrón.
  const now = new Date();
  const member = await prisma.member.findUnique({
    where: { dni: data.dni },
    select: {
      id: true, status: true, withdrawalReason: true, debtAtWithdrawal: true,
      reentryBlocked: true, rejectedUntil: true,
    },
  });
  const [liveApplication, lastRejectionAt] = await Promise.all([
    applicationService.findLiveByDni(data.dni),
    applicationService.lastRejectionAt(data.dni),
  ]);
  const eligibility = checkEligibility({ member, liveApplication, lastRejectionAt, now });
  if (!eligibility.ok) {
    return {
      blocked: {
        code: eligibility.code,
        message: eligibility.error,
        retryAtIso: eligibility.code === "rejected_wait" ? eligibility.retryAt.toISOString() : undefined,
      },
    };
  }

  // `wantsDebit` sólo tiene sentido para el adherente; activo y colaborador van
  // SIEMPRE con débito (cuota obligatoria, docs/05 §2).
  const wantsDebit = data.requestedCategory === "adherent" ? data.wantsDebit === "si" : true;

  let created: { id: number; resumeToken: string };
  try {
    created = await applicationService.create({
      fullName: data.fullName, dni: data.dni, birthDate: birth.value,
      civilStatus: data.civilStatus, nationality: data.nationality,
      occupation: data.occupation, phone: data.phone, email,
      streetId: livesInBarrio ? (data.streetId ?? null) : null,
      streetText: livesInBarrio ? null : (data.streetText ?? null),
      streetNumber: data.streetNumber,
      neighborhood: livesInBarrio ? null : (data.neighborhood ?? null),
      requestedCategory: data.requestedCategory, wantsDebit,
      memberId: eligibility.memberId, acceptedTermsAt: now, ip, userAgent,
    });
  } catch (e) {
    // Carrera de dos POST con el mismo DNI: el chequeo de elegibilidad de arriba
    // corre sin exclusión, así que los dos lo pasan y el segundo cae acá (el
    // mutex por DNI del servicio es el que decide). Cualquier OTRO fallo es de
    // infraestructura y no puede disfrazarse de "ya tenés una solicitud": eso
    // mandaría al vecino a pedir un reenvío que no existe.
    if (e instanceof DuplicateLiveApplicationError) {
      return { blocked: { code: "in_progress", message: IN_PROGRESS } };
    }
    console.error("[asociate] falló la creación de la solicitud, code:", codeOf(e));
    return { error: "No pudimos registrar tu solicitud. Probá de nuevo en unos minutos." };
  }

  // Verificación de email inmediata (REG-08). Best-effort: si el SMTP falla, la
  // solicitud sigue viva — el vecino puede verificar más adelante y el asiento
  // no depende de esto.
  try {
    const raw = await tokens.issue({ purpose: "email_verification", applicationId: created.id });
    await mailer.sendToApplication({
      applicationId: created.id, to: email, type: "email_verification",
      message: verificationEmail({ url: verifyUrl(baseUrl(), raw) }),
      summary: "verificación de email de la solicitud",
    });
  } catch (e) {
    console.error("[asociate] falló el email de verificación de la solicitud", created.id, "code:", codeOf(e));
  }

  // Al detalle van códigos y flags, nunca el DNI, el email ni el domicilio: la
  // solicitud ya está identificada por su id y `audit_log` no es el lugar de los
  // datos personales (docs/08, Ley 25.326).
  await audit({
    action: "application_created", entity: "application", entityId: created.id,
    detail: { category: data.requestedCategory, wantsDebit, reentry: eligibility.memberId !== null }, ip,
  });

  return { created: { resumeToken: created.resumeToken } };
}

// Reenvío del enlace de retome. Formulario público y anónimo con un DNI adentro:
// vale la misma regla que el recupero de contraseña —la respuesta NO puede decir
// si ese DNI tiene una solicitud en trámite—, y se sostiene en los mismos tres
// frentes:
//   1. El texto: una sola respuesta (`RESEND_DONE`) para el DNI con solicitud
//      viva, el que no tiene y el que ni siquiera existe.
//   2. El tiempo: la búsqueda, la rotación y el SMTP van dentro de `after()`, o
//      sea después de contestar. Sin eso, el DNI con solicitud tarda lo que
//      tarda Brevo (cientos de ms) y el que no tiene vuelve al instante: la
//      diferencia se mide desde afuera y convierte el formulario en un
//      verificador de solicitudes por DNI.
//   3. Los cupos: se consultan y se registran ANTES de mirar si la solicitud
//      existe, para que el intento número cuatro conteste igual en los dos casos.
//      Son DOS —por IP y por DNI pedido— porque el techo por origen no protege
//      a un vecino concreto si el atacante rota de IP (ver los comentarios de
//      los dos limitadores).
export async function resendResumeLinkAction(_prev: ResendState, formData: FormData): Promise<ResendState> {
  const { ip } = await requestMeta();

  if (!resumeResendLimiter.allows(ip)) return { error: TOO_MANY };
  const captcha = await verifyTurnstile(String(formData.get("cf-turnstile-response") ?? ""), ip);
  if (!captcha) return { error: NO_CAPTCHA };

  // El formato se valida antes de REGISTRAR el cupo: un DNI mal tipeado no
  // puede dejar a nadie sin reintentos, y de paso es lo que da la clave del
  // segundo limitador. Es sólo zod sobre el POST: no hay consulta a la base
  // todavía, así que adelantarlo no abre ninguna vía de enumeración.
  const parsed = parseForm(z.object({ dni: dniSchema }), formData);
  if (!parsed.ok) return { error: parsed.error };
  const dni = parsed.data.dni; // ya normalizado: parseForm recorta y el regex deja sólo dígitos

  // Los dos se consultan sin registrar y recién después se registra en los dos
  // (mismo patrón que `sendVerificationAction`): con `check` a secas, el primero
  // en evaluarse le cobra el intento a su clave aunque el segundo termine
  // rechazando.
  if (!resumeResendTargetLimiter.allows(dni)) return { error: TOO_MANY };
  resumeResendLimiter.record(ip);
  resumeResendTargetLimiter.record(dni);

  after(() => deliverResumeLink(dni, ip));
  return RESEND_DONE; // idéntico exista o no la solicitud
}

/** Todo lo que toca la solicitud corre acá, después de responder. Nada de lo que
 *  pase adentro puede cambiar lo que ve el visitante: ni el resultado, ni el
 *  tiempo. Los errores se registran y se comen. */
async function deliverResumeLink(dni: string, ip: string): Promise<void> {
  let live: { id: number; email: string } | null = null;
  try {
    live = await applicationService.findLiveByDni(dni);
    if (!live) return;

    // Enviar PRIMERO y persistir después. El crudo sólo existe al generarlo (la
    // base guarda el hash), así que rotar antes del envío significa que un SMTP
    // caído deja al vecino con el enlace viejo YA invalidado y sin uno nuevo. Y
    // el caso más probable no es el SMTP caído sino el email mal tipeado en el
    // wizard, que Brevo va a rechazar SIEMPRE: con la rotación adelante, cada
    // reintento le movía el enlace de nuevo. Acá se acuña sin tocar la base
    // (`mintResumeToken`) y el hash se hace efectivo (`commitResumeToken`) sólo
    // cuando el correo salió: si falla, no se commitea nada y el enlace que el
    // wizard ya le dio sigue vivo.
    const { raw, hash } = applicationService.mintResumeToken();
    await mailer.sendToApplication({
      applicationId: live.id, to: live.email, type: "generic",
      message: applicationResumeEmail({ url: `${baseUrl()}/asociate/retomar/${raw}` }),
      summary: "reenvío del enlace de retome",
    });
    await applicationService.commitResumeToken(live.id, hash);
  } catch (e) {
    // Sin refund del cupo, a diferencia de `sendVerificationAction`: allá el
    // fallo dejaba un token vivo que se quema y nada que racionar, acá no queda
    // NINGÚN estado destructivo que compensar —el enlace viejo nunca se tocó—.
    // Y el cupo tiene que gastarse igual: si el envío que rebota se devolviera,
    // martillar contra una dirección inválida sería gratis, que es justo el
    // escenario que estos dos techos existen para racionar.
    console.error("[asociate] falló el reenvío del enlace de retome", live?.id ?? "?", "code:", codeOf(e));
    return;
  }

  await audit({ action: "application_resume_link_sent", entity: "application", entityId: live.id, ip });
}
