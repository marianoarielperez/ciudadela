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
      message: verificationEmail({ name: input.name, url: `${input.baseUrl}/verificar/${input.token}` }),
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
