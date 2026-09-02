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
  applicationCreateLimiter, applicationStatusLimiter, asociateDniCheckLimiter,
  asociateEmailLimiter, publicTokenLimiter, resumeResendLimiter, resumeResendTargetLimiter,
} from "@/lib/auth/rate-limiter";
import { dniCheckVerdict } from "@/lib/applications/dni-check";
import { MAX_ANNEXES, requiredDocsComplete } from "@/lib/applications/documents-rules";
import { collisionsFor, findEmailCollisions, isBlockingCollision } from "@/lib/applications/email-collision";
import { checkEligibility } from "@/lib/applications/eligibility";
import { loadEligibilityInputs } from "@/lib/applications/eligibility-inputs";
import { applicationService, DuplicateLiveApplicationError } from "@/lib/applications/service";
import {
  categoryAllowedForResidence, categoryOfferedOnWeb, civilTodayAr, isAdult, WEB_CATEGORIES,
} from "@/lib/applications/wizard";
import { CONFIG_KEYS, configReader } from "@/lib/config";
import { parseCivilDate } from "@/lib/dates";
import { documentStore, MAX_DOCUMENT_BYTES } from "@/lib/documents/storage";
import { mailer } from "@/lib/email";
import {
  applicationReceivedEmail, applicationResumeEmail, verificationEmail, verifyUrl,
} from "@/lib/email/templates";
import { parseForm } from "@/lib/forms";
import { formatDateAR } from "@/lib/format";
import { checkoutUrlFor } from "@/lib/mp/checkout";
import { mpErrorLog } from "@/lib/mp/error-log";
import { mpGateway } from "@/lib/mp/gateway";
import { subscriptionReason } from "@/lib/mp/reason";
import { prisma } from "@/lib/prisma";
import { openWizardProcess } from "@/lib/reregistration/current";
import { currentDeadline } from "@/lib/reregistration/rules";
import { tokens } from "@/lib/tokens";
import { feeValueReader } from "@/lib/treasury/fee-values";
import { feeAmountFor } from "@/lib/treasury/rules";
import { verifyTurnstile } from "@/lib/turnstile";
import { COLLABORATOR_CLOSED_MESSAGE } from "./wizard-shared";

// Sin `export`: en un módulo "use server" todo lo exportado tiene que ser una
// función async (lo exportado es un endpoint). Los formularios cliente declaran
// su propio tipo estructural equivalente.
type CreateState = {
  error?: string;
  blocked?: {
    code: "in_progress" | "already_member" | "expelled" | "visit_office" | "debt" | "rejected_wait";
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
// El estado del chequeo temprano por DNI (paso 1, spec 2026-08-27). `blocked`
// lleva CÓDIGOS y el nombre enmascarado; la prosa la escribe la pantalla
// (`dni-result-panel.tsx`). El espejo cliente vive en `wizard-shared.ts`.
type DniCheckState =
  | { kind: "idle" }
  | { kind: "ok" }
  | {
      kind: "blocked";
      code: "already_member" | "in_progress" | "expelled" | "visit_office" | "debt" | "rejected_wait";
      maskedName: string | null;
      pendingCount?: number;
      retryAtIso?: string;
    }
  | { kind: "error"; error: string };

const TOO_MANY = "Demasiados intentos desde esta conexión. Probá de nuevo en un rato.";
const ASOCIATE_CLOSED =
  "Las asociaciones en línea están cerradas en este momento. Para asociarte, acercate a la sede vecinal.";
// La segunda causal de la guarda 0: mientras corre el re-empadronamiento del
// Art. 9° bis la asociación está depurando su padrón y no suma gente (diseño M6
// §11). Lleva la fecha porque es lo único que le sirve al vecino para volver,
// y NO la lleva cuando `currentDeadline` devuelve `null` —fuera de las dos
// instancias, o con el plazo ya vencido y el proceso todavía sin cambiar de
// estado—: la frase sin fecha es verdadera en los dos momentos, y citar una
// fecha pasada le diría que la suspensión terminó justo en el mensaje que la
// aplica. Es la misma decisión, y la misma función, que la portada y
// `/asociate`.
function reregistrationClosed(deadline: Date | null): string {
  const until = deadline === null ? "" : ` (hasta el ${formatDateAR(deadline)})`;
  return `Las asociaciones están suspendidas temporalmente durante el proceso de re-empadronamiento${until}. Para asociarte, acercate a la sede vecinal.`;
}
// El formulario tiene un checkbox de aceptación OBLIGATORIO. Si los textos que
// se aceptan no están cargados, aceptarlos no significa nada y `acceptedTermsAt`
// quedaría grabado contra la nada: no hay constancia de qué aceptó el vecino
// (docs/08, Ley 25.326). Antes que registrar eso, no se recibe la solicitud.
const LEGAL_MISSING =
  "No podemos recibir tu solicitud en este momento: todavía no están publicados los textos que tenés que aceptar (términos y condiciones y consentimiento de datos). Probá más tarde o acercate a la sede vecinal.";
const NO_CAPTCHA = "No pudimos verificar que sos una persona. Recargá la página y probá de nuevo.";
// La casilla declarada ya es de una CUENTA del portal o de otra SOLICITUD viva
// (decisión del operador, 01/09/2026). UN solo texto para las tres causales: no
// se dice cuál, y mucho menos que la dirección sea la de una cuenta de gestión.
// El vecino que se topa con esto de verdad —el buzón familiar que su pareja ya
// usa para entrar al portal— tiene dos salidas que el mensaje nombra: otra
// dirección, o la sede.
const EMAIL_IN_USE =
  "Ese email ya está en uso en el sistema. Usá otra dirección; si creés que es un error, acercate a la sede vecinal.";
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

  // Guarda 0: el interruptor de ASOCIATE (docs/05 §2). `page.tsx` lo chequea al
  // RENDERIZAR, y eso no alcanza: la pestaña que ya estaba abierta cuando la CD
  // lo apagó, y un POST armado a mano, no vuelven a pasar por el render. Esta
  // action es un endpoint público y tiene que decidir por sí misma. Importa de
  // verdad porque es el paso final del checklist de lanzamiento. (La suspensión
  // por re-empadronamiento del M6 NO cuelga de este interruptor: es la causal
  // que sigue, y corta sola sin que la Comisión tenga que apagar nada.)
  //
  // Va primero por claridad, no por ahorro: `allows` es una consulta en memoria
  // que NO cobra el intento (eso lo hace el `record` de más abajo), así que
  // ponerla antes o después no le gasta cupo a nadie. Se lee mejor con la
  // pregunta más barata de responder arriba de todo.
  //
  // NO frena lo ya empezado: los pasos 5 y 6 operan con el token de retome
  // sobre solicitudes que YA existen y no chequean el interruptor, a propósito
  // (ver docs/05 §2). Apagar ASOCIATE cierra las altas nuevas; la cola viva se
  // vacía sola al vencer, hasta 7 días después.
  //
  // Lectura DIRECTA con `configReader`, no la cacheada `getAsociateActive`: esa
  // existe para las páginas públicas y se invalida por tag, pero acá es una
  // guarda de autorización y un `true` viejo dejaría crear solicitudes después
  // de apagar el interruptor. Mismo criterio que el panel (ver el comentario de
  // src/lib/config.ts sobre caché vs. lectura directa).
  if (!(await configReader.getBool(CONFIG_KEYS.asociateActivo))) {
    return { error: ASOCIATE_CLOSED };
  }

  // Guarda 0, segunda causal: el proceso de re-empadronamiento en curso.
  //
  // No alcanza con que la Comisión apague el interruptor de arriba a mano —de
  // hecho no tiene por qué tocarlo—: convocar suspende las altas por sí solo, y
  // la portada y `/asociate` ya lo muestran así. Esta línea es la que lo hace
  // cierto para un POST, que es lo único que crea una solicitud.
  //
  // Lectura DIRECTA con `openWizardProcess`, la MISMA función que usan la
  // página y las actions del wizard, y NO la cacheada `getActiveReregistration`:
  // acá es una guarda, y un `null` viejo dejaría entrar altas después de
  // convocar. Mismo criterio que la lectura del interruptor de arriba.
  const openProcess = await openWizardProcess(prisma);
  if (openProcess !== null) {
    return { error: reregistrationClosed(currentDeadline(openProcess)) };
  }

  // Guarda 0 bis: los textos legales tienen que EXISTIR.
  //
  // Son claves de `configuration` que nacen en el seed y que el superadmin
  // edita desde /admin/configuracion, o sea que pueden faltar (base recién
  // migrada, clave borrada). Cuando faltan, el paso 4 del wizard muestra "El
  // texto todavía no está publicado" justo encima de un checkbox obligatorio
  // que igual se puede tildar, y el POST se grababa con `acceptedTermsAt`
  // apuntando a unos términos inexistentes: una aceptación sin objeto, que es
  // exactamente lo que no puede quedar asentado en la solicitud.
  //
  // Lectura DIRECTA por el mismo motivo que la guarda de arriba: `getLegalTexts`
  // está cacheada para las páginas públicas, y acá se decide si se acepta o no
  // un POST.
  const [terms, privacyConsent] = await Promise.all([
    configReader.getString(CONFIG_KEYS.termsText),
    configReader.getString(CONFIG_KEYS.privacyConsentText),
  ]);
  if (!terms || !privacyConsent) {
    // Al log, para que se note: esto es una falta de configuración del panel,
    // no un error del vecino, y nadie más lo va a reportar.
    console.error(
      "[asociate] solicitud rechazada: faltan los textos legales",
      { terms: Boolean(terms), privacyConsent: Boolean(privacyConsent) },
    );
    return { error: LEGAL_MISSING };
  }

  // El orden es `allows` → captcha → formato → `record` → padrón.
  //
  // Se consulta el cupo primero (no se gasta un intento contra alguien que ya
  // está bloqueado) y se REGISTRA recién después del captcha y de las
  // validaciones puras. Que el registro vaya después del captcha evita que uno
  // vencido —la ficha dura 5 minutos y el paso 4 del wizard puede tardar más—
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

  // El techo por CASILLA (`asociateEmailLimiter`), consultado acá y registrado
  // abajo junto con el de IP: mismo patrón de reserva que el resto del archivo
  // —consultar todos los cupos y recién después registrarlos—, y por el mismo
  // motivo va después del formato (un typo no puede gastarle a nadie sus
  // intentos). La clave ya viene normalizada: `parseForm` recorta y la línea de
  // arriba baja a minúsculas.
  //
  // Lo que raciona: esta action le manda la verificación a una dirección que
  // NADIE verificó que sea de quien completa el formulario. El techo por IP no
  // alcanza si el atacante rota de origen, y el del DNI tampoco: acá los dos
  // datos los elige él (ver el comentario del limitador).
  //
  // El texto del bloqueo es el genérico de siempre, a propósito: uno propio
  // diría que esa casilla es conocida por el sistema.
  if (!asociateEmailLimiter.allows(email)) {
    // Sin la dirección en el log (Ley 25.326): el bloqueo se registra como
    // hecho —qué cupo lo frenó— y no como dato personal. Mismo estilo que el
    // del reenvío del enlace de retome, más abajo; acá no hay ni siquiera un id
    // de solicitud que nombrar, porque todavía no se creó ninguna.
    console.warn("[asociate] alta frenada por cupo de la casilla (asociateEmailLimiter)");
    return { error: TOO_MANY };
  }

  const livesInBarrio = data.livesInBarrio === "si";
  if (livesInBarrio && !data.streetId) return { error: "Elegí tu calle del listado del barrio." };
  if (!livesInBarrio && (!data.streetText || !data.neighborhood)) {
    return { error: "Ingresá tu calle y tu barrio." };
  }
  // Revalidación de REG-01 en el server MÁS la llave `colaborador_habilitado`
  // (spec 2026-09-02): el paso 2 deshabilita la tarjeta y el paso 3 filtra las
  // opciones, pero un POST armado a mano no pasa por ninguno de los dos.
  // Lectura DIRECTA con `configReader`, sin la caché de las páginas: es una
  // guarda, y un `true` viejo dejaría crear solicitudes de colaborador después
  // de apagar la llave. El mensaje se elige por CAUSA: si REG-01 ya lo rechaza
  // es un desajuste de residencia, y la llave no tiene nada que decir.
  const collaboratorEnabled = await configReader.getBool(CONFIG_KEYS.collaboratorEnabled);
  if (!categoryOfferedOnWeb(data.requestedCategory, livesInBarrio, collaboratorEnabled)) {
    return {
      error: categoryAllowedForResidence(data.requestedCategory, livesInBarrio)
        ? COLLABORATOR_CLOSED_MESSAGE
        : "La categoría elegida no corresponde a tu lugar de residencia. Volvé al paso 3.",
    };
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
  // Se registra ACÁ y no al final: el intento se cobra aunque la creación
  // termine rechazada por elegibilidad o falle. Contar sólo las que llegan a
  // escribir haría que el techo mismo revele qué sabe el padrón de ese DNI.
  asociateEmailLimiter.record(email);

  // Elegibilidad por DNI (spec §4): corre DESPUÉS de Turnstile + rate limit,
  // que son lo único que impide usar este formulario para barrer el padrón.
  // Los insumos salen de `loadEligibilityInputs`, la MISMA carga que usa el
  // chequeo temprano del paso "Tu DNI": los dos puntos de verdad no pueden
  // divergir en qué miran.
  const now = new Date();
  const inputs = await loadEligibilityInputs(prisma, applicationService, data.dni);
  const eligibility = checkEligibility({ ...inputs, now });
  if (!eligibility.ok) {
    return {
      blocked: {
        code: eligibility.code,
        message: eligibility.error,
        retryAtIso: eligibility.code === "rejected_wait" ? eligibility.retryAt.toISOString() : undefined,
      },
    };
  }

  // La casilla en USO corta el alta (decisión del operador, 01/09/2026). Hasta
  // ayer esto era sólo un AVISO en la cola del panel; sigue siéndolo para la
  // ficha sin cuenta —el buzón compartido de docs/04— y pasa a ser un bloqueo
  // para las tres causales de `BLOCKING_COLLISION_KINDS`.
  //
  // POR QUÉ acá y no antes: va DESPUÉS de la elegibilidad a propósito. El que
  // vuelve a intentar con su mismo DNI tiene una solicitud viva con su misma
  // casilla, así que las dos reglas disparan; la respuesta correcta es
  // "te reenviamos el enlace" y no "usá otra dirección", que lo dejaría sin
  // salida. Y va después del `record` de los dos cupos: el mensaje es
  // EXPLÍCITO —dice que esa dirección existe en el sistema—, o sea un oráculo,
  // y lo único que lo raciona es el techo por casilla ya cobrado arriba.
  //
  // `eligibility.memberId` es el reingreso: la cuenta del portal que cuelga de
  // SU PROPIA ficha no es una colisión (la misma exclusión que usa la cola del
  // panel). El `0` del id de solicitud es "todavía no hay ninguna": los ids son
  // autoincrementales positivos, así que no descuenta a nadie.
  const ownCollisions = collisionsFor(
    await findEmailCollisions(prisma, [email]),
    email,
    0,
    eligibility.memberId,
  );
  if (ownCollisions.some(isBlockingCollision)) {
    // Sin la dirección en el log (Ley 25.326) y sin los ids de lo que colisionó:
    // el hecho alcanza para saber que la regla está actuando.
    console.warn("[asociate] alta frenada: la casilla declarada ya está en uso");
    return { error: EMAIL_IN_USE };
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

// El chequeo temprano por DNI del paso 1 "Tu DNI" (spec 2026-08-27). Es una
// CORTESÍA de UX, no una guarda: `createApplicationAction` sigue corriendo
// `checkEligibility` entero en el envío del paso de datos, pase lo que pase
// acá, sobre los MISMOS insumos (`loadEligibilityInputs`).
//
// NO SE AUDITA (misma doctrina que el lookup de REEMPADRONATE): un asiento por
// intento dejaría registrado qué DNI consultó cada IP — un dato personal que
// hoy no existe (docs/08, Ley 25.326).
//
// Y NO REVALIDA (`revalidatePath`/`revalidateTag`): es una action del wizard,
// y la invariante del `replaceState` del retome depende de que ninguna lo haga
// (ver el comentario largo de `asociate-wizard.tsx`).
export async function checkDniAction(_prev: DniCheckState, formData: FormData): Promise<DniCheckState> {
  const { ip } = await requestMeta();

  // Las mismas dos causales de la guarda 0 de la creación (documentadas arriba
  // en largo), con lectura DIRECTA porque son guardas de autorización. La de
  // los textos legales NO va acá: este paso no acepta nada, y esa guarda
  // protege el registro de la aceptación.
  if (!(await configReader.getBool(CONFIG_KEYS.asociateActivo))) {
    return { kind: "error", error: ASOCIATE_CLOSED };
  }
  const openProcess = await openWizardProcess(prisma);
  if (openProcess !== null) {
    return { kind: "error", error: reregistrationClosed(currentDeadline(openProcess)) };
  }

  // El orden es `allows` → captcha → formato → `record` → padrón, el de
  // siempre (createApplicationAction lo documenta en largo). El cupo es
  // PROPIO (`asociateDniCheckLimiter`, 5/15 min por IP): gastar chequeos no
  // puede dejar sin envío a quien ya llegó al paso de datos.
  if (!asociateDniCheckLimiter.allows(ip)) return { kind: "error", error: TOO_MANY };
  const captcha = await verifyTurnstile(String(formData.get("cf-turnstile-response") ?? ""), ip);
  if (!captcha) return { kind: "error", error: NO_CAPTCHA };

  const parsed = parseForm(z.object({ dni: dniSchema }), formData);
  if (!parsed.ok) return { kind: "error", error: parsed.error };
  const dni = parsed.data.dni; // ya normalizado: parseForm recorta y el regex deja sólo dígitos

  // Desde acá se toca el padrón, así que el intento se cobra.
  asociateDniCheckLimiter.record(ip);

  const inputs = await loadEligibilityInputs(prisma, applicationService, dni);
  const verdict = dniCheckVerdict({ ...inputs, now: new Date() });
  if (verdict.ok) return { kind: "ok" };
  return {
    kind: "blocked",
    code: verdict.code,
    maskedName: verdict.maskedName,
    ...(verdict.code === "debt" ? { pendingCount: verdict.pendingCount } : {}),
    ...(verdict.code === "rejected_wait" ? { retryAtIso: verdict.retryAt.toISOString() } : {}),
  };
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
//
// A PROPÓSITO no lleva la guarda del interruptor de ASOCIATE: reenviar el enlace
// de una solicitud que YA existe no es asociarse. El interruptor suspende el
// alta de solicitudes nuevas; los trámites en curso —incluidos los que ya tienen
// una suscripción viva en Mercado Pago— tienen que poder terminarse, igual que
// los pasos 5 y 6, que tampoco lo chequean. Sumarla acá dejaría al vecino sin
// forma de retomar un trámite que la vecinal ya le aceptó.
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

    // El techo por CASILLA, con la dirección de la solicitud VIVA: la que va a
    // recibir el correo. Es el mismo presupuesto que gasta la creación —uno por
    // casilla, no uno por formulario—, así que los dos correos del wizard no
    // pueden sumarse contra el mismo buzón.
    //
    // Pasado el cupo se vuelve EN SILENCIO, exactamente como el DNI sin
    // solicitud viva de la línea de arriba: estamos después de haber contestado
    // `RESEND_DONE`, y cualquier diferencia visible desde afuera convertiría el
    // formulario en un verificador de solicitudes por DNI. Se consulta acá y no
    // en la action porque la dirección sólo se conoce después de buscar, y esa
    // búsqueda no puede correr antes de responder (frente 2 de la
    // anti-enumeración). El techo por IP y el techo por DNI ya se cobraron
    // antes, así que el intento no sale gratis.
    //
    // `check` y no `allows`+`record`: no hay un segundo cupo que consultar acá,
    // y el intento se cobra igual que en el catch de abajo —martillar contra
    // una casilla no puede ser gratis—. Normalizada, como en la creación: la
    // dirección viene de la base, pero el presupuesto es el mismo.
    if (!asociateEmailLimiter.check(live.email.trim().toLowerCase())) {
      // Sin la dirección en el log (Ley 25.326): la solicitud ya está
      // identificada por su id.
      console.warn("[asociate] reenvío del enlace de retome frenado por cupo de la casilla", live.id);
      return;
    }

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
 *  está entero, y esa es la peor respuesta posible del paso 5. */
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

  // El monto sale de `fee_values` (única fuente, REG-34): la suscripción se
  // crea SIN plan asociado (docs/06 §2), así que lo que mandamos acá es
  // literalmente lo que MP le va a debitar al vecino todos los meses. Sin valor
  // vigente NO se crea la suscripción — cobrar mal es peor que no cobrar.
  const value = await feeValueReader.current();
  if (!value) {
    return {
      error: "El valor de la cuota todavía no está configurado. Probá más tarde o consultá en la sede.",
    };
  }
  const amount = feeAmountFor(app.requestedCategory, value);
  if (amount === null) return { error: "La categoría elegida no paga cuota por débito." };

  let sub: { id: string; initPoint: string; status: string };
  try {
    sub = await mpGateway.createPreapproval({
      // Lo que el vecino ve en el checkout de MP y en el resumen de su tarjeta.
      // Ya no sale del `reason` del plan: sin plan de por medio, el sufijo
      // queda vacío y `subscriptionReason` cae en su base, "Cuota Vecinal
      // Ciudadela" (ver `mp/reason.ts`, tope de 60 caracteres de la API).
      reason: subscriptionReason(""),
      amount,
      payerEmail: app.email,
      externalReference: `solicitud:${app.id}`,
      backUrl: `${baseUrl()}/asociate/retomar/${resumeToken}`,
    });
  } catch (e) {
    // El error del SDK ES el cuerpo de la respuesta de MP (no un `Error`): lo
    // desarma `mpErrorLog`, que además enmascara el `payer_email` si viene en
    // el mensaje. Al log, nunca a la pantalla.
    console.error(
      "[asociate] falló la creación de la suscripción —",
      mpErrorLog("createPreapproval", { applicationId: app.id, amount }, e),
    );
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
      // `planId: null`: no hay plan de referencia porque el monto no salió de
      // ninguno. Lo que queda registrado es el `amount` que se le mandó a MP
      // —el mismo que lleva la suscripción en su `auto_recurring` (docs/06
      // §2)—, que es contra lo que la conciliación compara. `externalReference`
      // se guarda acá y no sólo en MP: es la única llave para reencontrar una
      // suscripción huérfana.
      await tx.mpSubscription.create({
        data: {
          preapprovalId: sub.id, planId: null, applicationId: app.id, status: sub.status,
          payerEmail: app.email,
          amount: amount.toFixed(2), externalReference: `solicitud:${app.id}`,
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
