"use server";
// La action pública del paso 1 de REEMPADRONATE: el vecino escribe su DNI y el
// sistema le contesta si le corresponde re-empadronarse.
//
// No hay sesión y no puede haberla: el Art. 9° bis convoca a socios que en su
// enorme mayoría nunca tuvieron cuenta en el sitio. Lo único que protege este
// endpoint es el mismo orden de guardas del wizard de alta —interruptor, cupo,
// captcha, formato, cobro del intento, recién entonces el padrón—, y eso está
// calcado a propósito de `createApplicationAction`; el comentario de más abajo
// dice por qué cada pieza está donde está.
//
// Lo que esta pantalla NO puede hacer, y es la decisión de producto que la
// gobierna: revelar por diferencia. El DNI no es autenticación —cualquiera
// puede tipear el de otro—, así que todos los caminos negativos contestan lo
// MISMO y el positivo devuelve el nombre ENMASCARADO para que el propio vecino
// se reconozca sin que un desconocido se entere de quién es. La identidad real
// la acredita después el operador, mirando las fotos del DNI (Task 11).
//
// Y no hay ningún paso de pago en todo el wizard (decisión del operador,
// 25/08/2026): re-empadronarse no ofrece pagar, ni adherir débito, ni cambiar
// montos. Nada de este archivo toca el circuito de plata.
import { headers } from "next/headers";
import { after } from "next/server";
import { z } from "zod";
import { publicTokenLimiter, reregistrationLookupLimiter, reregistrationResendLimiter } from "@/lib/auth/rate-limiter";
import { audit } from "@/lib/audit";
import { parseCivilDate } from "@/lib/dates";
import { documentStore, MAX_DOCUMENT_BYTES } from "@/lib/documents/storage";
import { mailer } from "@/lib/email";
import { presentationObservedEmail, presentationReceivedEmail } from "@/lib/email/templates";
import { parseForm } from "@/lib/forms";
import { prisma } from "@/lib/prisma";
import { openWizardProcess } from "@/lib/reregistration/current";
import { civilTodayAr } from "@/lib/applications/wizard";
import { presentations, PRESENTATION_MAX_ANNEXES } from "@/lib/reregistration/presentation";
import { presentationResumeUrl as resumeUrl } from "@/lib/reregistration/resume-link";
import { currentDeadline, lookupVerdict } from "@/lib/reregistration/rules";
import { verifyTurnstile } from "@/lib/turnstile";

// Sin `export`: en un módulo "use server" todo lo exportado tiene que ser una
// función async (lo exportado es un endpoint). El wizard cliente declara su
// propio tipo estructural equivalente en `wizard-shared.ts`.
type LookupState =
  | { kind: "idle" }
  | { kind: "eligible"; maskedName: string; presentationToken: string; email: string }
  | { kind: "already_submitted"; canResend: boolean }
  | { kind: "not_found" }
  | { kind: "error"; error: string };

const TOO_MANY = "Demasiados intentos desde esta conexión. Probá de nuevo en un rato.";
const NO_CAPTCHA = "No pudimos verificar que sos una persona. Recargá la página y probá de nuevo.";
const BAD_BIRTH_DATE = "La fecha de nacimiento no es válida.";
const PROCESS_CLOSED =
  "En este momento no hay un proceso de re-empadronamiento en curso. Si creés que sí, acercate a la sede vecinal.";

// El mismo schema que ASOCIATE usa para el DNI: sólo dígitos, 7 a 9. No se
// comparte el símbolo porque allá es una constante de módulo dentro de un
// archivo "use server", que no puede exportar nada que no sea una función.
const schema = z.object({
  dni: z.string().regex(/^\d{7,9}$/, "DNI inválido (solo números, sin puntos)"),
});

// Sólo X-Real-IP, como el login, el recupero y ASOCIATE: el resto de las
// cabeceras de IP las puede fijar el cliente si le pega directo al origen, y
// rotándolas se regalaría un presupuesto nuevo del limitador en cada intento.
async function clientIp(): Promise<string> {
  return (await headers()).get("x-real-ip") ?? "unknown";
}

export async function lookupAction(_prev: LookupState, formData: FormData): Promise<LookupState> {
  const ip = await clientIp();

  // Guarda 1: el proceso tiene que estar ABIERTO.
  //
  // `page.tsx` ya lo chequea al renderizar, y eso no alcanza: la pestaña que
  // quedó abierta cuando venció la segunda instancia, y un POST armado a mano,
  // no vuelven a pasar por el render. Esta action es un endpoint público y
  // tiene que decidir por sí misma — exactamente el mismo argumento por el que
  // `createApplicationAction` revalida el interruptor de ASOCIATE.
  //
  // Importa de verdad: lo que cierra este wizard es el vencimiento de un plazo
  // estatutario, y una presentación aceptada un día tarde es una presentación
  // que la Comisión no puede considerar.
  //
  // Va primero por claridad, no por ahorro: `allows` es una consulta en memoria
  // que NO cobra el intento, así que ponerla antes o después no le gasta cupo a
  // nadie. Se lee mejor con la pregunta institucional arriba de todo.
  const activeProcess = await openWizardProcess(prisma);
  if (activeProcess === null) return { kind: "error", error: PROCESS_CLOSED };

  // El orden es `allows` → captcha → formato → `record` → padrón, calcado de
  // `createApplicationAction` (que lo documenta en largo). En corto:
  //
  //   - se CONSULTA el cupo primero, sin gastarlo, para no cobrarle un intento
  //     a quien ya está bloqueado;
  //   - se REGISTRA recién después del captcha, porque la ficha de Turnstile
  //     dura ~5 minutos y una vencida no puede quemarle un intento al vecino
  //     que fue a buscar el documento;
  //   - y después del formato, porque un DNI mal tipeado tampoco puede.
  //
  // Nada de esto afloja la anti-enumeración: la validez de FORMATO es zod sobre
  // el POST (ninguna consulta), cada intento sigue costando un captcha resuelto
  // —el token de Turnstile es de un solo uso— y todo lo que toca el padrón
  // queda detrás del captcha Y del cupo ya cobrado.
  if (!reregistrationLookupLimiter.allows(ip)) return { kind: "error", error: TOO_MANY };
  const captcha = await verifyTurnstile(String(formData.get("cf-turnstile-response") ?? ""), ip);
  if (!captcha) return { kind: "error", error: NO_CAPTCHA };

  const parsed = parseForm(schema, formData);
  if (!parsed.ok) return { kind: "error", error: parsed.error };
  const dni = parsed.data.dni; // normalizado: parseForm recorta y el regex deja sólo dígitos

  // Desde acá se toca el padrón, así que el intento se cobra: el cupo es lo
  // único, junto con el captcha, que impide usar este formulario para barrerlo.
  reregistrationLookupLimiter.record(ip);

  // Una sola consulta: la ficha y —si existe— SU fila de cohorte en ESTE
  // proceso. El `where` por `processId` es lo que hace que un socio convocado en
  // un proceso anterior no cuente como convocado en éste.
  const member = await prisma.member.findUnique({
    where: { dni },
    select: {
      id: true,
      fullName: true,
      category: true,
      status: true,
      // El email de la ficha viaja porque es la ÚNICA precarga que el paso 2
      // hace por el camino del DNI (decisión 8). Ver el comentario del
      // veredicto `eligible`, que explica por qué es el único dato que sale.
      email: true,
      presentations: {
        where: { processId: activeProcess.id },
        select: { id: true, status: true, email: true },
        // La unique (`processId`, `memberId`) ya garantiza que hay a lo sumo
        // una; el take es para que el tipo sea el que es.
        take: 1,
      },
    },
  });

  // NO SE AUDITA. Es una búsqueda anónima de un formulario público: un asiento
  // por intento llenaría `audit_log` de ruido y, peor, dejaría registrado qué
  // DNI consultó cada dirección IP — un dato personal que nadie va a mirar
  // nunca y que hoy no existe (docs/08, Ley 25.326). El precedente es el GET
  // público de la solicitud, que tampoco audita. Lo que sí se audita es lo que
  // hace el operador en el panel.
  const verdict = lookupVerdict({
    member,
    presentation: member?.presentations[0] ?? null,
  });

  const row = member?.presentations[0] ?? null;

  switch (verdict.kind) {
    case "eligible": {
      // La LLAVE de la sesión. Se acuña acá —y no al guardar el paso 2— porque
      // desde este punto todo lo que el vecino haga se dirige con ella: el
      // formulario nunca manda un id de presentación, así que el cliente no
      // puede apuntar a la de otro (mismo criterio que el token de retome de
      // ASOCIATE en los pasos 4 y 5).
      //
      // Rota en cada entrega, y por eso `lookupVerdict` no deja entrar por acá
      // a una presentación OBSERVADA: si lo hiciera, cualquiera que tipeara ese
      // DNI —que no es autenticación— le mataría al vecino el enlace vivo que
      // tiene en el buzón, justo mientras le corre el plazo para subsanar, y de
      // paso podría pisarle lo cargado. La observada se reabre SÓLO por el
      // enlace del correo. Por este camino queda entonces una presentación
      // `pending`, donde no hay ni enlace que matar ni datos que pisar; el
      // riesgo residual es el ACEPTADO por la decisión 8 y lo acotan el
      // captcha, el cupo de 5/15 min y que la pantalla no precargue NADA
      // guardado salvo el email.
      const claimed = row ? await presentations.claim({ presentationId: row.id }) : null;
      // Sin llave no hay trámite posible: pasa si la Comisión resolvió la
      // presentación entre el veredicto y el claim. Se contesta el cartel
      // genérico, que es el mismo que ve todo el mundo.
      if (!claimed) return { kind: "not_found" };
      return {
        kind: "eligible",
        maskedName: verdict.maskedName,
        presentationToken: claimed.raw,
        // La ÚNICA precarga por este camino (decisión 8): el email. Todo lo
        // demás se tipea de cero, porque precargar la fecha de nacimiento o el
        // domicilio se los mostraría a quien tipeó un DNI ajeno. Se prefiere el
        // de la presentación —el que el propio vecino declaró y está por
        // corregir— y si no, el de la ficha.
        email: row?.email ?? member?.email ?? "",
      };
    }
    // Enviada, validada u OBSERVADA: las tres van a la misma pantalla de
    // estado, sin ningún dato cargado, con el reenvío del enlace como única
    // puerta. No se distinguen entre sí a propósito: quién está observado es
    // algo que el vecino lee en SU correo, no algo que conteste un formulario
    // público donde el DNI es toda la credencial.
    case "already_submitted":
      return {
        kind: "already_submitted",
        // Si la presentación no dejó email no hay a dónde reenviar el enlace, y
        // la pantalla tiene que decirlo en vez de ofrecer un botón que no puede
        // funcionar.
        canResend: Boolean(row?.email),
      };
    case "not_found":
      return { kind: "not_found" };
  }
}

// ── Pasos 2 a 4: operan sobre una presentación que YA existe ─────────────────
//
// Acá no hay Turnstile, y es la misma decisión que en los pasos 4 y 5 de
// ASOCIATE: el captcha ya se pagó en el paso 1, y estas tres actions se
// autentican con la LLAVE de la presentación, que son 256 bits de `randomBytes`
// y no se enumeran. El precedente del proyecto está en CLAUDE.md: las rutas que
// se abren con un token de un solo uso no llevan captcha porque el token ya es
// la barrera. Lo que las protege es otra cosa:
//
//   1. La LLAVE dice sobre qué presentación se opera. Nunca llega un id por el
//      formulario: el cliente no puede apuntar a la presentación de otro.
//   2. El ESTADO —de la presentación y de SU proceso— dice qué se puede hacer.
//      Lo decide `editabilityOf`, la misma función para las tres.
//   3. El cupo por IP (`publicTokenLimiter`) raciona el martilleo de los POST.
//
// Y todo lo que el botón habilita se revalida en el server con la MISMA función
// pura: un POST armado a mano no pasa por ningún botón.

const DOC_TYPES = ["dni_front", "dni_back", "annex"] as const;

const LINK_DEAD =
  "No encontramos tu re-empadronamiento: el enlace puede estar incompleto o haber sido reemplazado por uno más nuevo. Volvé a empezar desde la página de re-empadronamiento.";

type SaveState = { error?: string; saved?: true };
type UploadState = { error?: string; uploaded?: { type: string; count: number } };
// `submittedAt` puede ser `null` y la pantalla tiene que bancárselo: ver el
// comentario de `SubmitResult` en `presentation.ts`. En corto: antes ese hueco
// se tapaba con `new Date(0)` y la constancia le imprimía 01/01/1970 al vecino
// como prueba del plazo del Art. 9° bis.
type SubmitState = { error?: string; done?: { submittedAt: string | null; mailed: boolean } };
type ResendState = { error?: string; done?: boolean };

// Respuesta única del reenvío: la misma exista o no la presentación.
const RESEND_DONE: ResendState = { done: true };

/** Los datos del paso 2 (§5.2). El NOMBRE no está: es el ancla de identidad de
 *  la ficha y con un DNI por toda credencial, dejarlo editar permitiría
 *  apropiarse de la ficha de otro. Las correcciones de nombre van por la sede.
 *
 *  Los anchos son los de `Member`/`Presentation`, no números elegidos acá: un
 *  string más largo que la columna termina en un error de base y no en un
 *  mensaje que el vecino pueda entender. */
const dataSchema = z.object({
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ingresá tu fecha de nacimiento"),
  civilStatus: z
    .string()
    .min(1, "Elegí tu estado civil")
    .max(40, "El estado civil no puede superar los 40 caracteres"),
  nationality: z
    .string()
    .min(1, "Ingresá tu nacionalidad")
    .max(60, "La nacionalidad no puede superar los 60 caracteres"),
  occupation: z
    .string()
    .min(1, "Ingresá tu ocupación")
    .max(80, "La ocupación no puede superar los 80 caracteres"),
  streetId: z.coerce
    .number({ error: "Elegí tu calle del listado." })
    .int()
    .positive("Elegí tu calle del listado."),
  streetNumber: z
    .string()
    .min(1, "Ingresá la altura")
    .max(10, "La altura no puede superar los 10 caracteres"),
  neighborhood: z
    .string()
    .min(1, "Elegí tu barrio")
    .max(60, "El barrio no puede superar los 60 caracteres"),
  phone: z
    .string()
    .min(6, "Ingresá tu teléfono")
    .max(40, "El teléfono no puede superar los 40 caracteres"),
  email: z.email("Ingresá un email válido").max(191, "El email no puede superar los 191 caracteres"),
  emailConfirm: z.string().min(1, "Repetí tu email"),
});

// La URL de retorno vive en `@/lib/reregistration/resume-link` y no acá: la
// arman también el correo de OBSERVACIÓN, que sale del panel de la Comisión
// (Task 12). Un módulo "use server" no puede exportar nada que no sea una
// función async, así que la única forma de que los cuatro correos armen la
// misma URL es que la función viva afuera.

// Los errores de nodemailer traen `envelope` y el `response` del SMTP, o sea la
// dirección en claro, y el log de PM2 no está cubierto por los cuidados de
// docs/08 (Ley 25.326). Al log va sólo el código.
function codeOf(e: unknown): string {
  return typeof e === "object" && e !== null && "code" in e
    ? String((e as { code: unknown }).code)
    : "unknown";
}

/** El cupo de los POST con llave. Se consulta ANTES de tocar la base, igual que
 *  en ASOCIATE. */
async function tokenBudget(): Promise<string | null> {
  const ip = await clientIp();
  return publicTokenLimiter.check(ip) ? null : TOO_MANY;
}

export async function savePresentationDataAction(
  _prev: SaveState,
  formData: FormData,
): Promise<SaveState> {
  const overBudget = await tokenBudget();
  if (overBudget) return { error: overBudget };

  const token = String(formData.get("token") ?? "");
  if (!token) return { error: LINK_DEAD };

  const parsed = parseForm(dataSchema, formData);
  if (!parsed.ok) return { error: parsed.error };
  const data = parsed.data;

  // La confirmación del email existe por lo mismo que en ASOCIATE: un dedazo en
  // la dirección no se nota hasta que la constancia no llega, y acá esa
  // dirección ES el domicilio electrónico del Art. 5° ter — la vía por la que
  // se notifica una observación y, llegado el caso, la baja.
  const email = data.email.toLowerCase();
  if (email !== data.emailConfirm.toLowerCase()) {
    return { error: "Los dos emails no coinciden: revisá el tipeo." };
  }

  // El día civil ARGENTINO, no el UTC del server: a las 21:30 de acá el server
  // ya está en el día siguiente y una fecha de hoy se rechazaría por futura.
  const birth = parseCivilDate(data.birthDate, {
    invalidError: BAD_BIRTH_DATE,
    maxDate: civilTodayAr(),
    rangeError: BAD_BIRTH_DATE,
  });
  if (!birth.ok) return { error: birth.error };

  const saved = await presentations.saveData({
    token,
    data: {
      birthDate: birth.value,
      civilStatus: data.civilStatus,
      nationality: data.nationality,
      occupation: data.occupation,
      // El domicilio del re-empadronamiento sale SIEMPRE del catálogo
      // catastral: la cohorte es de adherentes, que por el Art. 5 viven en el
      // barrio. `streetText` se limpia por si la ficha traía una calle libre de
      // la carga desde papel.
      streetId: data.streetId,
      streetText: null,
      streetNumber: data.streetNumber,
      neighborhood: data.neighborhood,
      phone: data.phone,
      email,
    },
  });
  if (!saved.ok) return { error: saved.error };
  return { saved: true };
}

export async function uploadPresentationDocumentAction(
  _prev: UploadState,
  formData: FormData,
): Promise<UploadState> {
  const overBudget = await tokenBudget();
  if (overBudget) return { error: overBudget };

  const token = String(formData.get("token") ?? "");
  if (!token) return { error: LINK_DEAD };
  const open = await presentations.openForEdit(token);
  if (!open.ok) return { error: open.error };
  const presentationId = open.view.id;

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
  // Se cuenta contra la base y no contra `open.view.uploadedTypes` por lo mismo
  // que en ASOCIATE: dos subidas simultáneas leen la misma vista.
  if (docType === "annex") {
    const annexes = await prisma.document.count({
      where: { ownerType: "presentation", ownerId: presentationId, type: "annex" },
    });
    if (annexes >= PRESENTATION_MAX_ANNEXES) {
      return {
        error: `Ya subiste los ${PRESENTATION_MAX_ANNEXES} archivos permitidos. Si necesitás cambiar uno, acercate a la sede.`,
      };
    }
  }

  try {
    await documentStore.savePresentationDocument({
      presentationId,
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
      console.error(
        "[reempadronate] falló el guardado del documento",
        presentationId,
        "code:",
        code,
      );
      return { error: "No pudimos guardar el archivo. Probá de nuevo en unos minutos." };
    }
    return { error: e instanceof Error ? e.message : "No pudimos guardar el archivo." };
  }

  const count = await prisma.document.count({
    where: { ownerType: "presentation", ownerId: presentationId },
  });
  return { uploaded: { type: docType, count } };
}

/** El envío: la declaración jurada del paso 4.
 *
 *  Lo que pasa DESPUÉS del envío es lo delicado. La constancia rota la llave
 *  —la que viajó por la URL durante toda la sesión muere, y el enlace del
 *  correo pasa a ser el único vivo— y esa rotación va en el orden acuñar →
 *  ENVIAR → persistir. Al revés, un rebote del SMTP dejaría al vecino sin
 *  ninguna llave: sin la vieja, que ya habríamos pisado, y sin la nueva, que
 *  nunca llegó. Es la misma lección que documenta `deliverResumeLink` en
 *  ASOCIATE, y acá pesa más: la presentación YA está asentada y el vecino tiene
 *  derecho a volver a verla. */
export async function submitPresentationAction(
  _prev: SubmitState,
  formData: FormData,
): Promise<SubmitState> {
  const overBudget = await tokenBudget();
  if (overBudget) return { error: overBudget };

  const token = String(formData.get("token") ?? "");
  if (!token) return { error: LINK_DEAD };

  // La declaración jurada no es decorativa: es lo que el socio firma. Si el
  // checkbox no vino, no hay declaración y no hay envío.
  if (String(formData.get("oath") ?? "") !== "on") {
    return {
      error: "Para enviar tu re-empadronamiento tenés que confirmar la declaración jurada.",
    };
  }

  const sent = await presentations.submit({ token });
  if (!sent.ok) return { error: sent.error };

  // Segundo envío (doble clic, reintento del navegador, o una presentación que
  // la Comisión ya validó): la pantalla dice lo mismo, pero NO se manda otra
  // constancia ni se rota la llave. Rotarla mataría el enlace que el vecino ya
  // tiene en el buzón sin darle nada a cambio.
  if (!sent.firstSubmission) {
    return { done: { submittedAt: sent.submittedAt?.toISOString() ?? null, mailed: false } };
  }

  let mailed = false;
  try {
    const { raw, hash } = presentations.mintResumeToken();
    await mailer.sendToMember({
      // `to` explícito: la constancia va a la casilla DECLARADA en la
      // presentación, que puede no ser la de la ficha —de hecho la enorme
      // mayoría del padrón no tiene ninguna—. La Notification cuelga igual del
      // socio, que es lo que le da carácter fehaciente (Art. 5° quater).
      memberId: sent.memberId,
      to: sent.email,
      type: "presentation_received",
      message: presentationReceivedEmail({ url: resumeUrl(raw), submittedAt: sent.submittedAt }),
      summary: "constancia de re-empadronamiento",
    });
    // Sólo si el correo SALIÓ: acá es donde la llave nueva reemplaza a la que
    // viajó por la URL.
    await presentations.commitResumeToken(sent.presentationId, hash);
    mailed = true;
  } catch (e) {
    // Best-effort: la presentación YA está enviada y `submittedAt` ya es la
    // prueba del plazo. Un SMTP caído no puede convertirse en "no pudimos
    // recibirla". La llave vieja sigue viva, así que el vecino conserva el
    // camino de vuelta que ya tenía abierto en esta pestaña.
    console.error("[reempadronate] falló la constancia", sent.presentationId, "code:", codeOf(e));
  }

  // El asiento va DESPUÉS del commit y SIN IP: es un acto público y anónimo,
  // como el alta web (diseño §12). Al detalle van ids y flags, nunca el DNI, el
  // email ni el domicilio (Ley 25.326).
  await audit({
    action: "presentation_submit",
    entity: "presentation",
    entityId: sent.presentationId,
    detail: { channel: "web", mailed },
  });

  return { done: { submittedAt: sent.submittedAt.toISOString(), mailed } };
}

/** Reenvío del enlace de una presentación ya enviada.
 *
 *  Formulario público y anónimo con un DNI adentro: vale la misma regla que el
 *  reenvío de ASOCIATE —la respuesta NO puede decir si ese DNI tiene una
 *  presentación—, y se sostiene en los mismos tres frentes:
 *
 *    1. El texto: una sola respuesta para el DNI con presentación, el que no
 *       tiene y el que ni existe.
 *    2. El tiempo: la búsqueda, la rotación y el SMTP van dentro de `after()`,
 *       o sea después de contestar. Sin eso, el que tiene presentación tarda lo
 *       que tarda Brevo y el que no vuelve al instante: la diferencia se mide
 *       desde afuera y convierte el formulario en un verificador de socios.
 *    3. El cupo: se consulta y se registra ANTES de mirar si la presentación
 *       existe, para que el intento de más conteste igual en los dos casos.
 *
 *  Y por eso la pantalla NO muestra la dirección, ni siquiera enmascarada: este
 *  mismo formulario vive también en la página del enlace muerto, donde el DNI
 *  se tipea de cero y una dirección parcial sería justamente el dato que la
 *  anti-enumeración no puede entregar. */
export async function resendPresentationLinkAction(
  _prev: ResendState,
  formData: FormData,
): Promise<ResendState> {
  const ip = await clientIp();

  const captcha = await verifyTurnstile(String(formData.get("cf-turnstile-response") ?? ""), ip);
  if (!captcha) return { error: NO_CAPTCHA };

  const parsed = parseForm(schema, formData);
  if (!parsed.ok) return { error: parsed.error };
  const dni = parsed.data.dni;

  // El cupo es POR DNI PEDIDO y no por IP: lo que raciona es la inundación del
  // buzón de un vecino identificable, y el techo por origen no lo protege si
  // quien molesta rota de IP. Se consulta y se registra SIEMPRE, exista o no la
  // presentación: contar sólo los pedidos que terminan en envío haría que el
  // techo mismo revele si ese DNI se presentó.
  if (!reregistrationResendLimiter.allows(dni)) return { error: TOO_MANY };
  reregistrationResendLimiter.record(dni);

  after(() => deliverPresentationLink(dni));
  return RESEND_DONE;
}

/** Todo lo que toca la presentación corre acá, después de responder. Nada de lo
 *  que pase adentro puede cambiar lo que ve el visitante: ni el resultado, ni
 *  el tiempo. Los errores se registran y se comen.
 *
 *  EL TEXTO DEPENDE DEL ESTADO REAL, y eso no es cosmética. A un socio
 *  OBSERVADO —al que la Comisión ya revisó y ya le pidió corregir algo— la
 *  constancia le dice que "la Comisión va a revisar lo que cargaste" y que "si
 *  hay que corregir algo te vamos a escribir": las dos frases son falsas para
 *  él y las dos lo mandan a esperar, justo cuando lo que le corre es el plazo
 *  para subsanar. Si no actúa, pierde la condición de socio. */
async function deliverPresentationLink(dni: string): Promise<void> {
  let target: {
    id: number;
    memberId: number;
    email: string;
    submittedAt: Date;
    observed: boolean;
  } | null = null;
  try {
    const process = await openWizardProcess(prisma);
    if (process === null) return;
    const row = await prisma.presentation.findFirst({
      where: {
        processId: process.id,
        member: { dni },
        // Sólo las que YA se presentaron: es el enlace de la constancia. Una
        // `pending` no tiene nada que mostrar, y el camino para empezarla es el
        // paso 1 con el DNI.
        status: { in: ["submitted", "validated", "observed"] },
        email: { not: null },
        submittedAt: { not: null },
      },
      select: { id: true, memberId: true, email: true, submittedAt: true, status: true },
    });
    if (!row?.email || !row.submittedAt) return;
    target = {
      id: row.id,
      memberId: row.memberId,
      email: row.email,
      submittedAt: row.submittedAt,
      observed: row.status === "observed",
    };

    // El observado recibe el correo de la OBSERVACIÓN, sin la nota del
    // operador: ésa ya viajó en el correo original y repetirla acá la pondría
    // en dos lugares que pueden divergir (el operador puede haberla editado en
    // el medio). Lo que sí lleva es la fecha límite, que es la mitad
    // accionable. Los otros dos estados —`submitted` y `validated`— siguen
    // recibiendo la constancia, que para ellos es verdadera.
    //
    // Acuñar → ENVIAR → persistir. Al revés, un rebote le mata al vecino el
    // enlace que ya tenía y no le deja ninguno: es el error que ASOCIATE pagó y
    // documentó, y el caso más probable no es el SMTP caído sino la dirección
    // mal tipeada, que Brevo va a rechazar SIEMPRE. `commitResumeToken` queda
    // DESPUÉS del `await` del envío a propósito: si el envío tira, esta línea
    // no corre y la llave vieja sigue abriendo.
    const { raw, hash } = presentations.mintResumeToken();
    await mailer.sendToMember({
      memberId: target.memberId,
      to: target.email,
      type: target.observed ? "presentation_observed" : "presentation_received",
      message: target.observed
        ? presentationObservedEmail({
            url: resumeUrl(raw),
            // Sin `observation`: no se duplica la nota del operador.
            deadline: currentDeadline(process),
          })
        : presentationReceivedEmail({
            url: resumeUrl(raw),
            submittedAt: target.submittedAt,
          }),
      summary: target.observed
        ? "reenvío del enlace para corregir el re-empadronamiento"
        : "reenvío del enlace del re-empadronamiento",
    });
    await presentations.commitResumeToken(target.id, hash);
  } catch (e) {
    console.error(
      "[reempadronate] falló el reenvío del enlace",
      target?.id ?? "?",
      "code:",
      codeOf(e),
    );
  }
}
