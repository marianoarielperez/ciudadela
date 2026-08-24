// es-AR transactional email copy. Keep text and html in sync: un cliente que no
// renderiza HTML tiene que entender el mensaje completo, enlace incluido.
import { formatARS, formatDateTimeAR } from "@/lib/format";
import { PAYMENT_LINK_TTL_HOURS } from "@/lib/mp/references";
import type { MemberEmailTokenPurpose } from "@/lib/tokens";
// Módulo puro (sin Prisma): importarlo acá no arrastra el cliente a la plantilla.
import { periodLabel } from "@/lib/treasury/periods";

type Rendered = { subject: string; text: string; html: string };

const ORG = "Asociación Vecinal del Barrio Ciudadela";
const CITY = "Comodoro Rivadavia";
const SIGNATURE = `\n\n—\n${ORG} — ${CITY}`;

// El nombre del socio y la URL entran desde la base: escapar siempre antes de
// interpolarlos en HTML (un "&" o una comilla en el nombre rompería el markup).
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function layout(title: string, bodyHtml: string): string {
  return `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:16px">
<h2 style="color:#0079BC">${esc(title)}</h2>
${bodyHtml}
<p style="color:#666;font-size:12px;margin-top:24px">${esc(ORG)} — ${esc(CITY)}</p>
</div>`;
}

function button(url: string, label: string): string {
  const href = esc(url);
  return `<p style="margin:24px 0"><a href="${href}" style="background:#0079BC;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none">${esc(label)}</a></p>
<p style="font-size:12px;color:#666">Si el botón no funciona, copiá este enlace: ${href}</p>`;
}

/** La ruta donde se canjea un `email_verification`. Vive en una sola función
 *  porque hay dos plantillas que la arman (la invitación del circuito de alta y
 *  la confirmación de la dirección nueva de una cuenta ya creada) y mandar el
 *  token a la ruta equivocada le daría al socio un enlace muerto. */
export function verifyUrl(baseUrl: string, token: string): string {
  return `${baseUrl}/verificar/${token}`;
}

/** Verificación de la dirección cargada en una ficha del padrón.
 *
 *  NO saluda por nombre, y la plantilla ni siquiera lo RECIBE: es el correo que
 *  dispara el botón del panel durante la carga de fichas desde papel, o sea el
 *  canal de más volumen y el único donde un dedazo del operador entrega solo,
 *  sin que nadie haga clic, y sin reparación posible —el correo ya está en el
 *  buzón de un tercero y ninguna edición posterior lo borra—. Con el nombre
 *  adentro, ese tercero se llevaba el nombre completo de una persona más el
 *  hecho de que es socia de la vecinal (Ley 25.326, docs/08). Sin el nombre no
 *  hay nada que aprender: la única dirección que aparece es la suya.
 *
 *  Mismo criterio que `loginEmailVerification` y que las páginas de canje
 *  (`REDEEM_CARD_SELECT` en `@/lib/members/access`), que tampoco nombran al
 *  socio del otro lado del clic. Lo que sí queda es el contexto institucional
 *  completo, porque el socio legítimo tiene que entender qué está confirmando y
 *  no tomarlo por spam. */
export function verificationEmail(opts: { url: string }): Rendered {
  return {
    subject: "Verificá tu email — Vecinal Ciudadela",
    text: `La ${ORG} registró esta dirección de correo como domicilio electrónico en el padrón de socios.

Para confirmar que esta casilla es tuya, abrí este enlace:

${opts.url}

El enlace vence en 7 días. Si todavía no tenés una contraseña para el portal de socios, vas a poder crearla apenas confirmes.

Si no esperabas este correo, ignoralo y avisale a la vecinal: puede ser un error de carga.${SIGNATURE}`,
    html: layout("Verificá tu email", `<p>La ${esc(ORG)} registró esta dirección de correo como domicilio electrónico en el padrón de socios.</p>
<p>Para confirmar que esta casilla es tuya, hacé clic:</p>
${button(opts.url, "Confirmar mi email")}
<p>El enlace vence en 7 días. Si todavía no tenés una contraseña para el portal de socios, vas a poder crearla apenas confirmes.</p>
<p>Si no esperabas este correo, ignoralo y avisale a la vecinal: puede ser un error de carga.</p>`),
  };
}

export function invitationEmail(opts: { name: string; url: string }): Rendered {
  return {
    subject: "Creá tu contraseña — Vecinal Ciudadela",
    text: `Hola ${opts.name}:\n\nYa podés crear tu contraseña para acceder al panel de socios de la Vecinal Ciudadela:\n\n${opts.url}\n\nEl enlace vence en 7 días.${SIGNATURE}`,
    html: layout("Creá tu contraseña", `<p>Hola <strong>${esc(opts.name)}</strong>:</p>
<p>Ya podés crear tu contraseña para acceder al panel de socios:</p>
${button(opts.url, "Crear mi contraseña")}
<p>El enlace vence en 7 días.</p>`),
  };
}

/** El correo que le corresponde a cada enlace del circuito de acceso, con su
 *  URL ya armada. La plantilla y el path van juntos a propósito: el token de
 *  verificación se canjea en /verificar y el de invitación en /acceso, y
 *  mandarlos cruzados le daría al socio un enlace muerto. Un solo lugar donde
 *  equivocarse, y testeado. */
export function portalInvite(input: {
  kind: MemberEmailTokenPurpose;
  name: string;
  baseUrl: string;
  token: string;
}): { message: Rendered; summary: string } {
  if (input.kind === "email_verification") {
    return {
      // Sin `name`: la verificación va a una dirección que todavía nadie
      // confirmó y puede ser un dedazo del operador. Ver `verificationEmail`.
      message: verificationEmail({ url: verifyUrl(input.baseUrl, input.token) }),
      summary: "verificación de email + invitación de acceso",
    };
  }
  return {
    message: invitationEmail({ name: input.name, url: `${input.baseUrl}/acceso/${input.token}` }),
    summary: "invitación de acceso al portal",
  };
}

export function passwordResetEmail(opts: { url: string }): Rendered {
  return {
    subject: "Restablecé tu contraseña — Vecinal Ciudadela",
    text: `Recibimos un pedido para restablecer tu contraseña. Abrí este enlace (vence en 30 minutos):\n\n${opts.url}\n\nSi no fuiste vos, ignorá este correo: tu contraseña no cambia.${SIGNATURE}`,
    html: layout("Restablecé tu contraseña", `<p>Recibimos un pedido para restablecer tu contraseña. El enlace vence en 30 minutos:</p>
${button(opts.url, "Restablecer contraseña")}
<p>Si no fuiste vos, ignorá este correo: tu contraseña no cambia.</p>`),
  };
}

// ── La dirección de ingreso de un socio se mudó ───────────────────────────────
//
// Cambiar el email de la ficha de un socio que YA tiene cuenta mueve la
// dirección con la que ingresa al portal (`members/write.ts:syncAccountEmail`,
// y `verifyCredentials` busca la cuenta por `User.email`). Estos dos correos son
// lo que hace que esa mudanza no sea silenciosa: uno avisa a la casilla que
// pierde el acceso, el otro le pide a la casilla nueva que confirme que es del
// socio.
//
// Ninguno de los dos lleva el nombre del socio ni su número: el de la casilla
// vieja puede estar hoy en manos de un tercero (es el motivo más común del
// cambio) y el de la casilla nueva todavía no está confirmado —puede ser un
// dedazo del operador—. Mismo criterio que `passwordResetEmail`, que tampoco
// saluda por nombre.
//
// Y el cuidado sigue del otro lado del click: la página que abre el enlace
// (/verificar) tampoco nombra al socio, si no el dedazo entregaría en un paso lo
// que el correo se cuidó de no decir. Ver `REDEEM_CARD_SELECT` en
// `@/lib/members/access`.
//
// Es el mismo criterio que ahora rige también en el circuito de ALTA:
// `verificationEmail` dejó de saludar por nombre, que era la deuda declarada acá
// y el canal de más volumen (una verificación por ficha tipeada desde papel).
//
// `invitationEmail` sí sigue saludando por nombre, y a propósito: es la única
// plantilla que NO puede caer en la casilla de un tercero por un dedazo, porque
// `verificationTarget` (`members/card-edit.ts`) sólo devuelve
// `password_invitation` cuando `emailStatus === "verified"`, o sea cuando el
// propio socio ya confirmó esa casilla haciendo clic en el enlace anterior. Un
// dedazo nunca llega a esa rama: muere antes, en la verificación.

/** Aviso a la dirección ANTERIOR. Deliberadamente NO nombra la dirección nueva:
 *  si el cambio fue un secuestro, este correo le estaría confirmando al atacante
 *  que la dirección que cargó quedó activa; si fue un dedazo del operador, le
 *  estaría mandando la casilla de un tercero a alguien que no tiene por qué
 *  verla (Ley 25.326). Lo que la persona necesita saber es que perdió el acceso
 *  y a dónde reclamar, no cuál es la dirección nueva. */
export function loginEmailMovedNotice(): Rendered {
  const text = `Te escribimos por tu cuenta del portal de socios de la ${ORG}.

La vecinal registró otra dirección de correo para tu cuenta. Desde ahora ingresás al portal con la dirección nueva: esta casilla ya no sirve para entrar ni para recuperar la contraseña.

Por seguridad no incluimos acá cuál es la dirección nueva.

Si el cambio lo pediste vos, no tenés que hacer nada.

Si NO lo pediste, comunicate cuanto antes con la vecinal acercándote a la sede: puede ser un error de carga o alguien pidiendo el cambio en tu nombre.${SIGNATURE}`;
  return {
    subject: "Cambió la dirección de acceso de tu cuenta — Vecinal Ciudadela",
    text,
    html: layout("Cambió la dirección de acceso de tu cuenta", `<p>Te escribimos por tu cuenta del portal de socios de la ${esc(ORG)}.</p>
<p>La vecinal registró <strong>otra dirección de correo</strong> para tu cuenta. Desde ahora ingresás al portal con la dirección nueva: esta casilla ya no sirve para entrar ni para recuperar la contraseña.</p>
<p>Por seguridad no incluimos acá cuál es la dirección nueva.</p>
<p>Si el cambio lo pediste vos, no tenés que hacer nada.</p>
<p>Si <strong>no</strong> lo pediste, comunicate cuanto antes con la vecinal acercándote a la sede: puede ser un error de carga o alguien pidiendo el cambio en tu nombre.</p>`),
  };
}

/** Verificación a la dirección NUEVA de un socio que ya tiene cuenta.
 *
 *  Es un `email_verification` como cualquier otro —mismo propósito de token,
 *  misma ruta de canje, mismo `NotificationType`— y su canje es inofensivo para
 *  una ficha con cuenta: `memberAccess.verifyEmail` marca la dirección como
 *  verificada y NO emite invitación de contraseña cuando `member.userId` ya
 *  existe. Lo único que cambia respecto de `verificationEmail` es el texto: acá
 *  hay que decirle al socio que esta casilla es, además, con la que ingresa. */
export function loginEmailVerification(input: { baseUrl: string; token: string }): {
  message: Rendered;
  summary: string;
} {
  const url = verifyUrl(input.baseUrl, input.token);
  return {
    summary: "verificación de la dirección nueva de acceso al portal",
    message: {
      subject: "Confirmá tu nueva dirección de acceso — Vecinal Ciudadela",
      text: `La ${ORG} registró esta dirección como tu email de contacto y, desde ahora, es también con la que ingresás al portal de socios.

Para confirmar que esta casilla es tuya, abrí este enlace:

${url}

El enlace vence en 7 días. Tu contraseña no cambia: seguís usando la misma.

Si no esperabas este correo, ignoralo y avisale a la vecinal: puede ser un error de carga.${SIGNATURE}`,
      html: layout("Confirmá tu nueva dirección de acceso", `<p>La ${esc(ORG)} registró esta dirección como tu email de contacto y, desde ahora, es también con la que ingresás al portal de socios.</p>
<p>Para confirmar que esta casilla es tuya, hacé clic:</p>
${button(url, "Confirmar mi email")}
<p>El enlace vence en 7 días. Tu contraseña no cambia: seguís usando la misma.</p>
<p>Si no esperabas este correo, ignoralo y avisale a la vecinal: puede ser un error de carga.</p>`),
    },
  };
}

// ── Módulo 3: circuito de la solicitud de alta ────────────────────────────────
//
// Criterio de nombres (mismo razonamiento que arriba): la ACEPTADA y la
// RECIBIDA sí saludan por nombre — la dirección la tipeó la propia persona en
// el wizard y confirmó el tipeo, no hay operador en el medio—. La RECHAZADA no
// saluda ni da causa: el estatuto no la exige (Art. 5 inc. 7) y el correo no
// tiene por qué cargar más datos que el hecho.

/** Aceptación automática (REG-12): el débito se autorizó y el primer pago entró. */
export function applicationAcceptedEmail(opts: { name: string }): Rendered {
  return {
    subject: "¡Tu solicitud fue aceptada! — Vecinal Ciudadela",
    text: `Hola ${opts.name}:

¡Bienvenido/a! Tu solicitud de asociación fue aceptada.

El alta formal se asentará en la próxima reunión de la Comisión Directiva, y la fecha de esa acta será tu fecha de ingreso como socio/a.

Te enviamos aparte un correo para verificar tu dirección de email: confirmala para poder recibir el acceso al portal de socios apenas se asiente tu alta.${SIGNATURE}`,
    html: layout("¡Tu solicitud fue aceptada!", `<p>Hola <strong>${esc(opts.name)}</strong>:</p>
<p>¡Bienvenido/a! Tu solicitud de asociación fue <strong>aceptada</strong>.</p>
<p>El alta formal se asentará en la próxima reunión de la Comisión Directiva, y la fecha de esa acta será tu <strong>fecha de ingreso</strong> como socio/a.</p>
<p>Te enviamos aparte un correo para verificar tu dirección de email: confirmala para poder recibir el acceso al portal de socios apenas se asiente tu alta.</p>`),
  };
}

/** Rama sin débito (adherente que no adhiere): la CD la trata en reunión. */
export function applicationReceivedEmail(opts: { name: string }): Rendered {
  return {
    subject: "Recibimos tu solicitud — Vecinal Ciudadela",
    text: `Hola ${opts.name}:

Tu solicitud de asociación fue recibida y será tratada por la Comisión Directiva en su próxima reunión. Te vamos a avisar por este medio el resultado.

Te enviamos aparte un correo para verificar tu dirección de email.${SIGNATURE}`,
    html: layout("Recibimos tu solicitud", `<p>Hola <strong>${esc(opts.name)}</strong>:</p>
<p>Tu solicitud de asociación fue recibida y será tratada por la Comisión Directiva en su próxima reunión. Te vamos a avisar por este medio el resultado.</p>
<p>Te enviamos aparte un correo para verificar tu dirección de email.</p>`),
  };
}

/** Rechazo (REG-13): sin expresión de causa. La retención del ingreso solo se
 *  menciona si hubo débito (REG-12.b), citando los términos aceptados. */
export function applicationRejectedEmail(opts: { entryFeeRetained: boolean }): Rendered {
  const retained = opts.entryFeeRetained
    ? `\n\nLa cuota de ingreso abonada no es reembolsable, conforme a los términos y condiciones aceptados al enviar la solicitud.`
    : "";
  const retainedHtml = opts.entryFeeRetained
    ? `<p>La cuota de ingreso abonada <strong>no es reembolsable</strong>, conforme a los términos y condiciones aceptados al enviar la solicitud.</p>`
    : "";
  return {
    subject: "Sobre tu solicitud de asociación — Vecinal Ciudadela",
    text: `Te escribimos por tu solicitud de asociación a la ${ORG}.

La Comisión Directiva resolvió no hacer lugar a la solicitud.${retained}

Según el estatuto, podés presentar una nueva solicitud pasados 6 (seis) meses de esta resolución. Ante cualquier consulta, acercate a la sede vecinal.${SIGNATURE}`,
    html: layout("Sobre tu solicitud de asociación", `<p>Te escribimos por tu solicitud de asociación a la ${esc(ORG)}.</p>
<p>La Comisión Directiva resolvió no hacer lugar a la solicitud.</p>
${retainedHtml}
<p>Según el estatuto, podés presentar una nueva solicitud pasados 6 (seis) meses de esta resolución. Ante cualquier consulta, acercate a la sede vecinal.</p>`),
  };
}

/** Reenvío del enlace de retome ("ya tenés una solicitud en trámite"). */
export function applicationResumeEmail(opts: { url: string }): Rendered {
  return {
    subject: "Retomá tu solicitud — Vecinal Ciudadela",
    text: `Pediste retomar tu solicitud de asociación a la ${ORG}. Abrí este enlace para continuarla donde la dejaste:

${opts.url}

Si no fuiste vos, ignorá este correo.${SIGNATURE}`,
    html: layout("Retomá tu solicitud", `<p>Pediste retomar tu solicitud de asociación a la ${esc(ORG)}. Hacé clic para continuarla donde la dejaste:</p>
${button(opts.url, "Retomar mi solicitud")}
<p>Si no fuiste vos, ignorá este correo.</p>`),
  };
}

/** Recordatorio del cron (día 3 de pending_payment): el checkout quedó a medias. */
export function paymentReminderEmail(opts: { url: string }): Rendered {
  return {
    subject: "Tu solicitud está esperando el pago — Vecinal Ciudadela",
    text: `Tu solicitud de asociación a la ${ORG} quedó pendiente de autorizar el débito automático en Mercado Pago.

Podés retomarla desde este enlace:

${opts.url}

Si no completás el pago, la solicitud vence a los 7 días de iniciada y vas a tener que empezar de nuevo.${SIGNATURE}`,
    html: layout("Tu solicitud está esperando el pago", `<p>Tu solicitud de asociación a la ${esc(ORG)} quedó pendiente de autorizar el débito automático en Mercado Pago.</p>
${button(opts.url, "Retomar y completar el pago")}
<p>Si no completás el pago, la solicitud <strong>vence a los 7 días</strong> de iniciada y vas a tener que empezar de nuevo.</p>`),
  };
}

/** Recordatorio de vencimiento (4C §5). Sale el ÚLTIMO día del mes: mañana la
 *  cuota pasa a ser mora.
 *
 *  Saluda por nombre —va a la casilla de la ficha del socio— y **no** trae link
 *  de pago: el link de Checkout Pro vence a las 72 h y lo emite un operador
 *  desde la ficha, así que meterlo acá sería prometer un camino que este correo
 *  no puede sostener. Se nombran las tres salidas reales: la sede, el débito
 *  automático y pedir un link. */
export function feeReminderEmail(opts: {
  name: string; period: string; amount: number | null; arrears: number; debt: number | null;
}): Rendered {
  const month = periodLabel(opts.period);
  const importe = opts.amount === null ? "" : ` de ${formatARS(opts.amount)}`;
  const arrearsText =
    opts.arrears > 0
      ? `\n\nAdemás tenés ${opts.arrears} ${opts.arrears === 1 ? "cuota atrasada" : "cuotas atrasadas"}${
          opts.debt === null ? "" : ` por ${formatARS(opts.debt)}`
        }.`
      : "";
  const arrearsHtml =
    opts.arrears > 0
      ? `<p>Además tenés <strong>${opts.arrears} ${opts.arrears === 1 ? "cuota atrasada" : "cuotas atrasadas"}</strong>${
          opts.debt === null ? "" : ` por <strong>${esc(formatARS(opts.debt))}</strong>`
        }.</p>`
      : "";
  return {
    subject: `Tu cuota de ${month} vence mañana — Vecinal Ciudadela`,
    text: `Hola ${opts.name}:

Te recordamos que tu cuota social de ${month}${importe} vence mañana.${arrearsText}

Podés pagarla en la sede, por débito automático o pidiéndonos un link de pago por Mercado Pago: respondé este mensaje y te lo mandamos.

Si ya pagaste, ignorá este correo.${SIGNATURE}`,
    html: layout(`Tu cuota de ${month} vence mañana`, `<p>Hola <strong>${esc(opts.name)}</strong>:</p>
<p>Te recordamos que tu <strong>cuota social de ${esc(month)}</strong>${opts.amount === null ? "" : ` de <strong>${esc(formatARS(opts.amount))}</strong>`} vence mañana.</p>
${arrearsHtml}
<p>Podés pagarla en la sede, por débito automático o pidiéndonos un link de pago por Mercado Pago: respondé este mensaje y te lo mandamos.</p>
<p>Si ya pagaste, ignorá este correo.</p>`),
  };
}

/** Recibo de tesorería (M4). El PDF viaja adjunto; el cuerpo repite lo esencial
 *  para quien no abre adjuntos. Saluda por nombre: va a la casilla del socio
 *  que pagó, registrada en su ficha. */
export function receiptEmail(opts: { name: string; number: string; concept: string; amount: number }): Rendered {
  const amount = formatARS(opts.amount);
  return {
    subject: `Recibo ${opts.number} — Vecinal Ciudadela`,
    text: `Hola ${opts.name}:

Registramos tu pago y te enviamos el recibo N° ${opts.number}.

Concepto: ${opts.concept}
Importe: ${amount}

El recibo en PDF va adjunto a este correo. Si no reconocés este pago, respondé este mensaje o acercate a la sede.${SIGNATURE}`,
    html: layout(`Recibo ${opts.number}`, `<p>Hola <strong>${esc(opts.name)}</strong>:</p>
<p>Registramos tu pago y te enviamos el recibo <strong>N° ${esc(opts.number)}</strong>.</p>
<p>Concepto: ${esc(opts.concept)}<br>Importe: <strong>${esc(amount)}</strong></p>
<p>El recibo en PDF va adjunto a este correo. Si no reconocés este pago, respondé este mensaje o acercate a la sede.</p>`),
  };
}

/** El link de Checkout Pro que el operador le manda al socio desde la ficha.
 *
 *  Dice CUÁNTO y POR QUÉ antes del botón: el vecino recibe un enlace de cobro
 *  sin haberlo pedido, así que el correo tiene que dejarlo verificar el importe
 *  sin abrirlo. Y cierra con la salida —"si ya pagaste"—, porque el operador
 *  puede mandarlo el mismo día en que el socio saldó en la sede. */
export function paymentLinkEmail(opts: { name: string; count: number; amount: number; url: string; expiresAt: Date }): Rendered {
  const amount = formatARS(opts.amount);
  const what = opts.count === 1 ? "1 cuota social" : `${opts.count} cuotas sociales`;
  // La fecha absoluta y no sólo "en 72 horas": el operador puede generar el
  // link hoy y mandar el mail mañana, y ahí "72 horas" son 48. El plazo se
  // sigue nombrando —explica por qué es corto— pero el que manda es el instante.
  const when = formatDateTimeAR(opts.expiresAt);
  return {
    subject: `Tu link para pagar la cuota — Vecinal Ciudadela`,
    text: `Hola ${opts.name}:

Te mandamos un link para pagar ${what} por ${amount} con Mercado Pago (tarjeta, débito o dinero en cuenta):

${opts.url}

El enlace vence el ${when} —${PAYMENT_LINK_TTL_HOURS} horas desde que se generó—: pasado ese plazo pedinos uno nuevo, porque el importe cambia cuando cambia el valor de la cuota.

Cuando el pago se acredite te llega el recibo por este mismo medio. Si ya pagaste o tenés dudas, respondé este mensaje o acercate a la sede.${SIGNATURE}`,
    html: layout("Tu link para pagar la cuota", `<p>Hola <strong>${esc(opts.name)}</strong>:</p>
<p>Te mandamos un link para pagar <strong>${esc(what)}</strong> por <strong>${esc(amount)}</strong> con Mercado Pago (tarjeta, débito o dinero en cuenta).</p>
<p><a href="${esc(opts.url)}" style="display:inline-block;padding:12px 20px;background:#0079BC;color:#fff;border-radius:6px;text-decoration:none">Pagar con Mercado Pago</a></p>
<p style="font-size:12px;color:#555">Si el botón no funciona, copiá este enlace: ${esc(opts.url)}</p>
<p>El enlace <strong>vence el ${esc(when)}</strong> (${PAYMENT_LINK_TTL_HOURS} horas desde que se generó): pasado ese plazo pedinos uno nuevo, porque el importe cambia cuando cambia el valor de la cuota.</p>
<p>Cuando el pago se acredite te llega el recibo por este mismo medio. Si ya pagaste o tenés dudas, respondé este mensaje o acercate a la sede.</p>`),
  };
}
