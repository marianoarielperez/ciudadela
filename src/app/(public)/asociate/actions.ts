"use server";
// Las actions públicas del wizard ASOCIATE. No hay sesión: la creación se
// protege con Turnstile + rate limit por IP, y el resto del circuito con el
// token de retome. Los mensajes de bloqueo vienen de `checkEligibility` y no
// revelan más de lo necesario (spec M3 §4).
import { headers } from "next/headers";
import { after } from "next/server";
import { z } from "zod";
import type { Application } from "@/generated/prisma/client";
import { audit } from "@/lib/audit";
import {
  applicationCreateLimiter, applicationStatusLimiter, publicTokenLimiter,
  resumeResendLimiter, resumeResendTargetLimiter,
} from "@/lib/auth/rate-limiter";
import { MAX_ANNEXES, requiredDocsComplete } from "@/lib/applications/documents-rules";
import { checkEligibility } from "@/lib/applications/eligibility";
import { applicationService, DuplicateLiveApplicationError } from "@/lib/applications/service";
import { categoryAllowedForResidence, civilTodayAr, isAdult, WEB_CATEGORIES } from "@/lib/applications/wizard";
import { CONFIG_KEYS, configReader } from "@/lib/config";
import { parseCivilDate } from "@/lib/dates";
import { documentStore, MAX_DOCUMENT_BYTES } from "@/lib/documents/storage";
import { mailer } from "@/lib/email";
import {
  applicationReceivedEmail, applicationResumeEmail, verificationEmail, verifyUrl,
} from "@/lib/email/templates";
import { parseForm } from "@/lib/forms";
import { checkoutUrlFor } from "@/lib/mp/checkout";
import { mpGateway } from "@/lib/mp/gateway";
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
type UploadState = { error?: string; uploaded?: { type: string; count: number } };
type SubmitState = { error?: string; done?: boolean };
// `blocked` es terminal: sólo lo pone el catch de persistencia post-`createPreapproval`
// de abajo, donde reintentar crearía una SEGUNDA suscripción en MP. Los demás errores
// de `startPaymentAction` NO lo llevan, porque ahí sí se puede reintentar.
type PayState = { error?: string; redirectUrl?: string; blocked?: true };

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

// ── Pasos 4 y 5: operan sobre una solicitud YA creada ────────────────────────
//
// Acá no hay Turnstile: la creación ya pasó por el captcha y estas tres actions
// se autentican con el token de retome, que son 256 bits de `randomBytes` y no
// se enumeran. Lo que las protege es otra cosa:
//
//   1. El TOKEN dice sobre qué solicitud se opera. Nunca llega un id por el
//      formulario: el cliente no puede apuntar a la solicitud de otro.
//   2. El ESTADO dice qué se puede hacer. `started` es el único que admite
//      subir documentos y enviar; todo lo demás se rechaza nombrando por qué.
//   3. El cupo por IP (`publicTokenLimiter`) raciona el martilleo de los POST.
//      El sondeo de estado usa el suyo (ver `applicationStatusLimiter`).
//
// Y la completitud documental se revalida SIEMPRE en el server con la misma
// función pura que habilita el botón: un POST armado a mano no pasa por el botón.

const DOC_TYPES = ["dni_front", "dni_back", "annex"] as const;

const LINK_DEAD =
  "No encontramos tu solicitud: el enlace puede estar incompleto o vencido. Empezá de nuevo desde la página Asociate.";
const ALREADY_SENT = "Tu solicitud ya fue enviada.";
const CANT_EDIT =
  "Tu solicitud ya fue enviada, así que no se le pueden agregar documentos. Si necesitás corregir algo, acercate a la sede vecinal.";

type Lookup = { ok: true; app: Application } | { ok: false; error: string };

/** Resuelve la solicitud desde el token del formulario. Distingue los tres
 *  motivos de fallo en vez de devolver `null`: decirle "no encontramos tu
 *  solicitud" a quien se pasó de cupo lo manda a empezar de cero un trámite que
 *  está entero, y esa es la peor respuesta posible del paso 4. */
async function appFromToken(resumeToken: string): Promise<Lookup> {
  if (!resumeToken) return { ok: false, error: LINK_DEAD };
  const { ip } = await requestMeta();
  if (!publicTokenLimiter.check(ip)) return { ok: false, error: TOO_MANY };
  const app = await applicationService.findByResumeToken(resumeToken);
  if (!app) return { ok: false, error: LINK_DEAD };
  return { ok: true, app };
}

/** Los documentos ya subidos, para revalidar la completitud en el server. */
async function docsOf(applicationId: number): Promise<Array<{ type: (typeof DOC_TYPES)[number] }>> {
  return prisma.document.findMany({
    where: { ownerType: "application", ownerId: applicationId },
    select: { type: true },
  });
}

export async function uploadDocumentAction(
  _prev: UploadState,
  formData: FormData,
): Promise<UploadState> {
  const found = await appFromToken(String(formData.get("resumeToken") ?? ""));
  if (!found.ok) return { error: found.error };
  const app = found.app;
  if (app.status !== "started") return { error: CANT_EDIT };

  const docType = String(formData.get("docType") ?? "");
  if (!(DOC_TYPES as readonly string[]).includes(docType)) {
    return { error: "Tipo de documento inválido." };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Elegí un archivo." };
  // El tope se chequea acá ADEMÁS de en el store: sin esto, un archivo de 30 MB
  // se lee entero a memoria antes de que nadie lo rechace.
  if (file.size > MAX_DOCUMENT_BYTES) {
    return { error: "El archivo supera el máximo de 10 MB. Probá con una foto de menor calidad." };
  }

  // El tope de anexos vive acá y no en el store: el store no sabe de wizard, y
  // los otros dos tipos se REEMPLAZAN (re-subir el frente no acumula versiones).
  if (docType === "annex") {
    const annexes = await prisma.document.count({
      where: { ownerType: "application", ownerId: app.id, type: "annex" },
    });
    if (annexes >= MAX_ANNEXES) {
      return { error: `Ya subiste los ${MAX_ANNEXES} anexos permitidos. Borrá uno en la sede si necesitás cambiarlo.` };
    }
  }

  try {
    await documentStore.saveApplicationDocument({
      applicationId: app.id,
      type: docType as (typeof DOC_TYPES)[number],
      data: Buffer.from(await file.arrayBuffer()),
    });
  } catch (e) {
    // El store tira mensajes en castellano para lo que el vecino PUEDE arreglar
    // (formato no admitido, archivo vacío o de más de 10 MB). Un fallo del
    // sistema de archivos trae `code` y su mensaje lleva la ruta absoluta de
    // UPLOADS_DIR: ese va al log, nunca a la pantalla.
    const code = codeOf(e);
    if (code !== "unknown") {
      console.error("[asociate] falló el guardado del documento de la solicitud", app.id, "code:", code);
      return { error: "No pudimos guardar el archivo. Probá de nuevo en unos minutos." };
    }
    return { error: e instanceof Error ? e.message : "No pudimos guardar el archivo." };
  }

  const count = await prisma.document.count({
    where: { ownerType: "application", ownerId: app.id },
  });
  return { uploaded: { type: docType, count } };
}

/** Rama sin débito: adherente que eligió no adherir. Va derecho a la CD. */
export async function submitNoDebitAction(
  _prev: SubmitState,
  formData: FormData,
): Promise<SubmitState> {
  const found = await appFromToken(String(formData.get("resumeToken") ?? ""));
  if (!found.ok) return { error: found.error };
  const app = found.app;
  if (app.status !== "started") return { error: ALREADY_SENT };
  if (!(app.requestedCategory === "adherent" && !app.wantsDebit)) {
    return { error: "Tu solicitud requiere autorizar el débito automático: usá el botón de pago." };
  }

  const complete = requiredDocsComplete(await docsOf(app.id), app.requestedCategory);
  if (!complete.ok) return { error: complete.error };

  // UPDATE condicional por estado (patrón `tokens.consume`): dos envíos
  // simultáneos —o el doble clic de siempre— escriben uno solo, y sólo el que
  // escribió manda el email y deja el asiento.
  const { count } = await prisma.application.updateMany({
    where: { id: app.id, status: "started" },
    data: { status: "pending_board" },
  });
  if (count === 1) {
    try {
      await mailer.sendToApplication({
        applicationId: app.id, to: app.email, type: "application_result",
        message: applicationReceivedEmail({ name: app.fullName }),
        summary: "solicitud recibida (pendiente de CD)",
      });
    } catch (e) {
      // Best-effort: la solicitud YA está enviada y la pantalla se lo dice. Un
      // SMTP caído no puede convertirse en "no pudimos enviarla".
      console.error("[asociate] falló el email de solicitud recibida", app.id, "code:", codeOf(e));
    }
    const { ip } = await requestMeta();
    await audit({
      action: "application_submitted", entity: "application", entityId: app.id,
      detail: { branch: "no_debit" }, ip,
    });
  }
  return { done: true };
}

/** Rama con débito: crea la suscripción en MP y devuelve el checkout. */
export async function startPaymentAction(_prev: PayState, formData: FormData): Promise<PayState> {
  const resumeToken = String(formData.get("resumeToken") ?? "");
  const found = await appFromToken(resumeToken);
  if (!found.ok) return { error: found.error };
  const app = found.app;

  // Reintento del que abandonó el checkout: se vuelve a la MISMA suscripción,
  // no se crea otra. Es también el camino del email recordatorio del cron.
  if (app.status === "pending_payment" && app.preapprovalId) {
    return { redirectUrl: checkoutUrlFor(app.preapprovalId) };
  }
  if (app.status !== "started") return { error: ALREADY_SENT };
  if (app.requestedCategory === "adherent" && !app.wantsDebit) {
    return { error: "Elegiste no adherir al débito: enviá la solicitud con el otro botón." };
  }

  const complete = requiredDocsComplete(await docsOf(app.id), app.requestedCategory);
  if (!complete.ok) return { error: complete.error };

  const planKey =
    app.requestedCategory === "active" ? CONFIG_KEYS.mpPlanActiveId : CONFIG_KEYS.mpPlanSharedId;
  const planId = await configReader.getString(planKey);
  if (!planId) {
    return {
      error: "El sistema de pagos no está configurado todavía. Probá más tarde o consultá en la sede.",
    };
  }

  let sub: { id: string; initPoint: string; status: string };
  try {
    sub = await mpGateway.createPreapproval({
      planId,
      payerEmail: app.email,
      externalReference: `solicitud:${app.id}`,
      backUrl: `${baseUrl()}/asociate/retomar/${resumeToken}`,
    });
  } catch (e) {
    // El error del SDK trae el cuerpo de la respuesta de MP (y a veces el token
    // recortado): al log, nunca a la pantalla.
    console.error("[asociate] falló createPreapproval para la solicitud", app.id, "code:", codeOf(e));
    return { error: "No pudimos iniciar el pago en Mercado Pago. Probá de nuevo en unos minutos." };
  }

  // Residual conocido: dos clics que ganen la carrera antes de este UPDATE
  // crean DOS preapprovals en MP. La solicitud queda apuntando al último —el
  // que el vecino está por abrir, que es el correcto— y el huérfano queda
  // `pending` con el mismo `external_reference`; lo levanta la conciliación del
  // M4. El botón se deshabilita con `pending` y redirige enseguida, así que la
  // ventana es de milisegundos.
  //
  // La escritura va envuelta porque acá arriba YA hay una suscripción viva en
  // Mercado Pago: si la base no la registra (caída, timeout, o el `@unique` de
  // `preapproval_id` de la carrera de arriba), sin este catch la action tira, el
  // vecino ve el error genérico de Next y no queda NINGÚN rastro local de la
  // suscripción —la conciliación del M4 sólo la encuentra por
  // `external_reference`—. Al log va el id del preapproval, que no es dato
  // personal y es lo único que permite reconciliarla a mano.
  try {
    await prisma.$transaction(async (tx) => {
      await tx.application.update({
        where: { id: app.id },
        data: { status: "pending_payment", preapprovalId: sub.id },
      });
      await tx.mpSubscription.create({
        data: {
          preapprovalId: sub.id, planId, applicationId: app.id,
          status: sub.status, payerEmail: app.email,
        },
      });
    });
  } catch (e) {
    console.error(
      "[asociate] payment persist failed: hay una suscripción viva en MP sin registrar",
      { applicationId: app.id, preapprovalId: sub.id, code: codeOf(e) },
    );
    // A propósito NO invita a reintentar: el reintento crearía una SEGUNDA
    // suscripción en MP, porque la solicitud sigue en `started` y sin
    // `preapprovalId`. El camino que queda es humano. `blocked` es lo que la
    // pantalla usa para dejar el botón inerte en vez de sólo mientras `pending`.
    return {
      error:
        "No pudimos registrar tu pago. No lo intentes de nuevo por ahora: acercate a la sede vecinal o escribinos, que el problema ya quedó anotado de nuestro lado.",
      blocked: true,
    };
  }

  const { ip } = await requestMeta();
  await audit({
    action: "application_submitted", entity: "application", entityId: app.id,
    detail: { branch: "debit" }, ip,
  });
  return { redirectUrl: sub.initPoint };
}

/** Sondeo de la pantalla "estamos confirmando tu pago…". Devuelve CÓDIGOS y no
 *  prosa: la pantalla decide qué mostrar, y así el sondeo no puede convertirse
 *  en otra fuente de mensajes al vecino. */
export async function applicationStatusAction(
  resumeToken: string,
): Promise<{ status: string } | { error: string }> {
  const { ip } = await requestMeta();
  if (!applicationStatusLimiter.check(ip)) return { error: "rate_limited" };
  if (!resumeToken) return { error: "not_found" };
  const app = await applicationService.findByResumeToken(resumeToken);
  if (!app) return { error: "not_found" };
  return { status: app.status };
}
