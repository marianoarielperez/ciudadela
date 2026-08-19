// es-AR transactional email copy. Keep text and html in sync: un cliente que no
// renderiza HTML tiene que entender el mensaje completo, enlace incluido.
import type { MemberEmailTokenPurpose } from "@/lib/tokens";

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
function verifyUrl(baseUrl: string, token: string): string {
  return `${baseUrl}/verificar/${token}`;
}

export function verificationEmail(opts: { name: string; url: string }): Rendered {
  return {
    subject: "Verificá tu email — Vecinal Ciudadela",
    text: `Hola ${opts.name}:\n\nLa Vecinal Ciudadela registró este email como tu domicilio electrónico. Para confirmarlo, abrí este enlace:\n\n${opts.url}\n\nEl enlace vence en 7 días. Si no esperabas este correo, ignoralo.${SIGNATURE}`,
    html: layout("Verificá tu email", `<p>Hola <strong>${esc(opts.name)}</strong>:</p>
<p>La Vecinal Ciudadela registró este email como tu domicilio electrónico. Para confirmarlo, hacé clic:</p>
${button(opts.url, "Verificar mi email")}
<p>El enlace vence en 7 días. Si no esperabas este correo, ignoralo.</p>`),
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
      message: verificationEmail({ name: input.name, url: verifyUrl(input.baseUrl, input.token) }),
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
// Deuda declarada: `verificationEmail` e `invitationEmail` —las del circuito de
// ALTA, que dispara el botón del panel— sí saludan por nombre, así que en ese
// circuito un dedazo del operador sigue nombrando al socio en el cuerpo del
// correo. Es preexistente y no lo toca esta ola; corresponde revisarlo aparte.

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
