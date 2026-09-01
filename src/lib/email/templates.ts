// es-AR transactional email copy. Keep text and html in sync: un cliente que no
// renderiza HTML tiene que entender el mensaje completo, enlace incluido.
import type { MemberRequestType, PaymentType } from "@/generated/prisma/client";
import { formatARS, formatDateAR, formatDateTimeAR } from "@/lib/format";
import { PAYMENT_LINK_TTL_HOURS } from "@/lib/mp/references";
import type { MemberEmailTokenPurpose } from "@/lib/tokens";
// Los dos son módulos puros (sin Prisma): importarlos acá no arrastra el cliente
// a la plantilla. `PAYMENT_TYPE_LABELS` es EL mapa del proyecto — pantalla, PDF
// y este correo tienen que llamar "Débito automático" a lo mismo.
import { PAYMENT_TYPE_LABELS } from "@/lib/treasury/labels";
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
// Criterio de nombres (mismo razonamiento que arriba): el ACUSE con pago y la
// RECIBIDA sí saludan por nombre — la dirección la tipeó la propia persona en
// el wizard y confirmó el tipeo, no hay operador en el medio—. La RECHAZADA no
// saluda ni da causa: el estatuto no la exige (Art. 5 inc. 7) y el correo no
// tiene por qué cargar más datos que el hecho.

/** Acuse de solicitud completa: el débito se autorizó y el primer pago entró.
 *  NO es una aceptación — el acta marco de REG-12 nunca se dictó y la admisión
 *  la resuelve la CD (Art. 5 inc. 7). El nombre exportado es histórico: se
 *  conserva para no tocar el webhook (spec 2026-09-01 §6.1). */
export function applicationAcceptedEmail(opts: { name: string }): Rendered {
  return {
    subject: "Recibimos tu solicitud y tu pago — Vecinal Ciudadela",
    text: `Hola ${opts.name}:

Registramos tu solicitud de asociación y acreditamos el pago de la cuota de ingreso. El recibo te lo enviamos en un correo aparte.

Con esto tu solicitud quedó completa, pero todavía no sos socio/a de la vecinal. La admisión la resuelve la Comisión Directiva en su próxima reunión y queda asentada en acta (Art. 5 del estatuto). La fecha de esa acta será tu fecha de ingreso.

La Comisión puede no hacer lugar a la solicitud. Si eso pasa, según los términos que aceptaste la cuota de ingreso no se devuelve, damos de baja tu débito automático en Mercado Pago y podés volver a presentarte a los seis meses.

Mientras tanto tu débito queda autorizado. Te avisamos el resultado por este mismo medio.

Te enviamos aparte un correo para verificar tu dirección de email: confirmala para poder recibir el acceso al portal de socios si tu alta se asienta.${SIGNATURE}`,
    html: layout("Recibimos tu solicitud y tu pago", `<p>Hola <strong>${esc(opts.name)}</strong>:</p>
<p>Registramos tu solicitud de asociación y acreditamos el pago de la cuota de ingreso. El recibo te lo enviamos en un correo aparte.</p>
<p><strong>Con esto tu solicitud quedó completa, pero todavía no sos socio/a de la vecinal.</strong> La admisión la resuelve la Comisión Directiva en su próxima reunión y queda asentada en acta (Art. 5 del estatuto). La fecha de esa acta será tu <strong>fecha de ingreso</strong>.</p>
<p>La Comisión puede no hacer lugar a la solicitud. Si eso pasa, según los términos que aceptaste la cuota de ingreso no se devuelve, damos de baja tu débito automático en Mercado Pago y podés volver a presentarte a los seis meses.</p>
<p>Mientras tanto tu débito queda autorizado. Te avisamos el resultado por este mismo medio.</p>
<p>Te enviamos aparte un correo para verificar tu dirección de email: confirmala para poder recibir el acceso al portal de socios si tu alta se asienta.</p>`),
  };
}

/** Rama sin débito (adherente que no adhiere): la CD la resuelve en reunión. */
export function applicationReceivedEmail(opts: { name: string }): Rendered {
  return {
    subject: "Recibimos tu solicitud — Vecinal Ciudadela",
    text: `Hola ${opts.name}:

Tu solicitud de asociación fue recibida. Todavía no sos socio/a: la va a resolver la Comisión Directiva en su próxima reunión y te avisamos el resultado por este medio.

Te enviamos aparte un correo para verificar tu dirección de email.${SIGNATURE}`,
    html: layout("Recibimos tu solicitud", `<p>Hola <strong>${esc(opts.name)}</strong>:</p>
<p>Tu solicitud de asociación fue recibida. <strong>Todavía no sos socio/a</strong>: la va a resolver la Comisión Directiva en su próxima reunión y te avisamos el resultado por este medio.</p>
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
 *  automático y pedir un link.
 *
 *  `expired` es la segunda variante (enmienda del operador, 24/08/2026): cuando
 *  el cron se re-dispara a mano DESPUÉS del vencimiento —el 30 el VPS estaba
 *  caído y el operador fuerza la corrida el 1°—, "vence mañana" ya es mentira.
 *  El aviso sigue sirviendo, así que sale igual, diciendo lo que pasó de verdad:
 *  la cuota venció y quedó impaga. Cambia sólo el asunto y la primera frase; el
 *  resto del correo (deuda arrastrada, cómo pagar, la salida "si ya pagaste") es
 *  el mismo, y en ninguna de las dos variantes se reclama nada que el socio no
 *  deba. Quién elige la variante es el cron, comparando el período avisado
 *  contra el día civil argentino de la corrida — nunca esta plantilla. */
export function feeReminderEmail(opts: {
  name: string; period: string; amount: number | null; arrears: number; debt: number | null;
  expired?: boolean;
}): Rendered {
  const month = periodLabel(opts.period);
  const importe = opts.amount === null ? "" : ` de ${formatARS(opts.amount)}`;
  const headline = opts.expired
    ? `Tu cuota de ${month} venció y quedó impaga`
    : `Tu cuota de ${month} vence mañana`;
  const lead = opts.expired
    ? `Te avisamos que tu cuota social de ${month}${importe} venció y quedó impaga.`
    : `Te recordamos que tu cuota social de ${month}${importe} vence mañana.`;
  const importeHtml = opts.amount === null ? "" : ` de <strong>${esc(formatARS(opts.amount))}</strong>`;
  const leadHtml = opts.expired
    ? `<p>Te avisamos que tu <strong>cuota social de ${esc(month)}</strong>${importeHtml} venció y quedó impaga.</p>`
    : `<p>Te recordamos que tu <strong>cuota social de ${esc(month)}</strong>${importeHtml} vence mañana.</p>`;
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
    subject: `${headline} — Vecinal Ciudadela`,
    text: `Hola ${opts.name}:

${lead}${arrearsText}

Podés pagarla en la sede, por débito automático o pidiéndonos un link de pago por Mercado Pago: respondé este mensaje y te lo mandamos.

Si ya pagaste, ignorá este correo.${SIGNATURE}`,
    html: layout(headline, `<p>Hola <strong>${esc(opts.name)}</strong>:</p>
${leadHtml}
${arrearsHtml}
<p>Podés pagarla en la sede, por débito automático o pidiéndonos un link de pago por Mercado Pago: respondé este mensaje y te lo mandamos.</p>
<p>Si ya pagaste, ignorá este correo.</p>`),
  };
}

/** Resumen diario a la Comisión (4C §6). Agregados y nada más: cantidades,
 *  totales y qué se rompió. Ninguna dirección de tercero, ningún id de mandato,
 *  ningún DNI — es un correo que va a varias casillas y lo puede reenviar
 *  cualquiera (Ley 25.326).
 *
 *  Sólo entra el renglón que tiene algo: un resumen con cinco ceros y un uno
 *  esconde el uno. Y el correo entero no sale si no hay ningún renglón — esa
 *  decisión no vive acá sino en `hasNews` (`@/lib/admin/digest`), porque la ruta
 *  la necesita ANTES de abrir la corrida. */
export function boardDigestEmail(d: {
  label: string;
  payments: Array<{ type: string; count: number; total: number }>;
  paymentsCount: number; paymentsTotal: number;
  applications: number; inboxNew: number; notificationsFailed: number;
  cronFailures: Array<{ job: string; runs: number }>; webhookErrors: number;
}): Rendered {
  const lines: string[] = [];
  const html: string[] = [];
  const add = (text: string) => { lines.push(`· ${text}`); html.push(`<li>${esc(text)}</li>`); };

  if (d.paymentsCount > 0) {
    const detail = d.payments
      .map((p) => `${PAYMENT_TYPE_LABELS[p.type as PaymentType] ?? p.type}: ${p.count} (${formatARS(p.total)})`)
      .join(" · ");
    add(`Pagos registrados: ${d.paymentsCount} por ${formatARS(d.paymentsTotal)} — ${detail}`);
  }
  if (d.applications > 0) add(`Solicitudes de alta iniciadas en el sitio: ${d.applications}`);
  // "entraron", no "quedaron": el renglón cuenta los que ENTRARON ayer sin
  // conciliar, resueltos o no. Si el operador resolvió a la tarde el que entró a
  // la mañana, "quedaron" mandaría a la Comisión a una bandeja vacía.
  if (d.inboxNew > 0) add(`Cobros que entraron sin conciliar: ${d.inboxNew}`);
  if (d.notificationsFailed > 0) add(`Avisos por email que no salieron: ${d.notificationsFailed}`);
  if (d.webhookErrors > 0) add(`Notificaciones de Mercado Pago con error: ${d.webhookErrors}`);
  // Un job por entrada, con cuántas veces falló. Viene agrupado de `collect()`:
  // acá no se deduplica nada, sólo se redacta.
  if (d.cronFailures.length > 0) {
    const jobs = d.cronFailures
      .map((c) => `${c.job} (${c.runs} ${c.runs === 1 ? "corrida" : "corridas"})`)
      .join(", ");
    add(`Tareas automáticas con problemas: ${jobs}`);
  }

  return {
    subject: `Resumen del ${d.label} — Vecinal Ciudadela`,
    text: `Novedades del ${d.label}:

${lines.join("\n")}

El detalle completo está en el panel: Salud, Tesorería y Solicitudes.${SIGNATURE}`,
    html: layout(`Novedades del ${d.label}`, `<ul>${html.join("\n")}</ul>
<p>El detalle completo está en el panel: Salud, Tesorería y Solicitudes.</p>`),
  };
}

/** Recibo de la cuota de ingreso previo al acta (spec 2026-09-01 §6.4). Una
 *  sola constante para el texto plano y el HTML: si divergieran, el vecino que
 *  lee uno y el que lee el otro recibirían aclaraciones distintas. */
const ADMISSION_PENDING_LEGEND =
  "Este comprobante acredita el pago de la cuota de ingreso. No acredita la condición de socio/a, " +
  "que se adquiere con la resolución de la Comisión Directiva asentada en acta.";

/** Recibo de tesorería (M4). El PDF viaja adjunto; el cuerpo repite lo esencial
 *  para quien no abre adjuntos. Saluda por nombre: va a la casilla del socio
 *  que pagó, registrada en su ficha. */
export function receiptEmail(opts: {
  name: string; number: string; concept: string; amount: number;
  /** Recibo de la cuota de ingreso previo al acta (spec 2026-09-01 §6.4): el
   *  comprobante no acredita la condición de socio. Ausente → correo de siempre. */
  admissionPending?: boolean;
}): Rendered {
  const amount = formatARS(opts.amount);
  const admission = opts.admissionPending ? `\n\n${ADMISSION_PENDING_LEGEND}` : "";
  return {
    subject: `Recibo ${opts.number} — Vecinal Ciudadela`,
    text: `Hola ${opts.name}:

Registramos tu pago y te enviamos el recibo N° ${opts.number}.

Concepto: ${opts.concept}
Importe: ${amount}${admission}

El recibo en PDF va adjunto a este correo. Si no reconocés este pago, respondé este mensaje o acercate a la sede.${SIGNATURE}`,
    html: layout(`Recibo ${opts.number}`, `<p>Hola <strong>${esc(opts.name)}</strong>:</p>
<p>Registramos tu pago y te enviamos el recibo <strong>N° ${esc(opts.number)}</strong>.</p>
<p>Concepto: ${esc(opts.concept)}<br>Importe: <strong>${esc(amount)}</strong></p>${opts.admissionPending ? `\n<p>${esc(ADMISSION_PENDING_LEGEND)}</p>` : ""}
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

/** Débito rechazado (4C §7.4). Lo dispara el webhook cuando MP intentó cobrar y
 *  no pudo.
 *
 *  El tono importa: el socio no hizo nada mal y el sistema no le está
 *  reclamando una deuda —la cuota puede no estar vencida todavía, y puede
 *  haberla pagado en la sede el mismo día—. Por eso el correo no afirma NADA
 *  sobre el estado de su cuenta: sólo cuenta el intento fallido, para que
 *  arregle el medio de pago antes de que se le acumule, y le nombra las salidas.
 *
 *  El motivo viene traducido por `rejectionReason`: el `status_detail` crudo de
 *  MP no se muestra nunca.
 *
 *  "Cobrar" y no "debitar", y el reintento va en condicional: la misma plantilla
 *  cubre el débito automático de la suscripción (que MP reintenta solo) y un
 *  link de Checkout Pro rechazado (que no se reintenta ni existe más allá de sus
 *  72 h). Prometerle un reintento que no va a pasar es peor que no avisar.
 *
 *  El reintento va ACOTADO —"unas pocas veces más"— porque sin techo le decía al
 *  socio que podía no hacer nada. Pero NO se afirma qué pasa después: cuántas
 *  veces reintenta MP el débito recurrente y si al final lo pausa o lo da de
 *  baja es algo que este proyecto NO midió (`docs/06` §8 sólo dice que nada se
 *  cancela solo). Contra Mercado Pago se mide antes de suponer, así que el
 *  correo cierra el punto con lo único cierto: no conviene esperar. Queda para
 *  la próxima batería de sandbox (`docs/11` Parte J).
 *
 *  Tampoco se le dice "volvé a autorizarlo": hoy el socio no tiene panel propio
 *  —es del Módulo 5— y ninguna de las tres salidas que ofrece el párrafo
 *  siguiente re-autoriza un débito. Sería una acción sin destino. */
export function paymentRejectedEmail(opts: { name: string; amount: number; reason: string }): Rendered {
  const amount = formatARS(opts.amount);
  return {
    subject: "No pudimos cobrar tu cuota — Vecinal Ciudadela",
    text: `Hola ${opts.name}:

Mercado Pago intentó cobrar tu cuota social de ${amount} y no pudo: ${opts.reason}.

Tu cuota sigue como estaba: este intento no la modifica. Si el cobro era tu débito automático, Mercado Pago lo vuelve a intentar por su cuenta unas pocas veces más, pero no conviene esperar a que alguno prospere.

Si querés resolverlo ahora, podés revisar tu medio de pago en Mercado Pago, pagar en la sede o pedirnos un link de pago respondiendo este mensaje.${SIGNATURE}`,
    html: layout("No pudimos cobrar tu cuota", `<p>Hola <strong>${esc(opts.name)}</strong>:</p>
<p>Mercado Pago intentó cobrar tu cuota social de <strong>${esc(amount)}</strong> y no pudo: ${esc(opts.reason)}.</p>
<p>Tu cuota sigue como estaba: este intento no la modifica. Si el cobro era tu débito automático, Mercado Pago lo vuelve a intentar por su cuenta unas pocas veces más, pero no conviene esperar a que alguno prospere.</p>
<p>Si querés resolverlo ahora, podés revisar tu medio de pago en Mercado Pago, pagar en la sede o pedirnos un link de pago respondiendo este mensaje.</p>`),
  };
}

/** Decisión de la Comisión sobre una solicitud presentada desde `/mi/solicitudes`
 *  (M5B): baja por renuncia o cambio de categoría, aceptada (Task 9 — piggyback
 *  del flujo con acta, `notifyRequestDecided`) o rechazada (Task 8,
 *  `rejectRequestAction`).
 *
 *  Las RECHAZADAS no saludan por nombre a propósito, mismo criterio que
 *  `applicationRejectedEmail`: es un aviso de trámite, no una bienvenida. Las
 *  ACEPTADAS sí saludan (Task 9, revisión) —en particular la de baja es la
 *  despedida formal de un socio que puede llevar décadas, y un correo sin
 *  destinatario en el cuerpo se lee frío en una casilla familiar compartida—,
 *  con `fullName` opcional: si el llamador no lo tiene a mano, el correo sale
 *  igual, sin saludo. La aceptada de baja dice que quedó asentada CON ACTA (el
 *  socio dejó de serlo por una resolución formal, no por un clic); la de
 *  categoría, que YA RIGE. Las rechazadas suman la nota de la Comisión cuando la
 *  hay —nunca la inventan si no vino ninguna, mismo criterio que el rechazo de
 *  altas, que tampoco expresa causa si no se la dieron—. */
export function memberRequestDecided(opts: {
  type: MemberRequestType;
  accepted: boolean;
  note?: string | null;
  fullName?: string | null;
}): { message: Rendered; summary: string } {
  const kind = opts.type === "withdrawal" ? "baja por renuncia" : "cambio de categoría";
  const verdict = opts.accepted ? "aceptada" : "rechazada";
  const resultLine = opts.accepted
    ? opts.type === "withdrawal"
      ? "Tu baja quedó asentada con acta."
      : "El cambio de categoría ya rige."
    : "La Comisión Directiva resolvió no hacer lugar a tu solicitud.";
  const noteText = !opts.accepted && opts.note ? `\n\nNota de la Comisión: ${opts.note}` : "";
  const noteHtml = !opts.accepted && opts.note ? `<p>Nota de la Comisión: ${esc(opts.note)}</p>` : "";
  const greeting = opts.accepted && opts.fullName ? `Hola ${opts.fullName}:\n\n` : "";
  const greetingHtml = opts.accepted && opts.fullName ? `<p>Hola <strong>${esc(opts.fullName)}</strong>:</p>\n` : "";
  const text = `${greeting}Tu solicitud de ${kind}, presentada desde tu panel de socio, fue ${verdict}.

${resultLine}${noteText}

Ante cualquier consulta, acercate a la sede vecinal.${SIGNATURE}`;
  const html = layout(`Tu solicitud de ${kind} fue ${verdict}`, `${greetingHtml}<p>Tu solicitud de <strong>${esc(kind)}</strong>, presentada desde tu panel de socio, fue <strong>${esc(verdict)}</strong>.</p>
<p>${esc(resultLine)}</p>
${noteHtml}
<p>Ante cualquier consulta, acercate a la sede vecinal.</p>`);
  return {
    message: { subject: `Tu solicitud de ${kind} fue ${verdict} — Vecinal Ciudadela`, text, html },
    summary: `solicitud de ${kind} ${verdict}`,
  };
}

/** Convocatoria al re-empadronamiento del Art. 9° bis (M6, 1ª instancia).
 *
 *  Sale de una sola vez a TODA la cohorte de adherentes vigentes —hoy 124— y es
 *  el correo que abre un plazo estatutario de treinta días del que cuelga la
 *  condición de socio. Por eso dice tres cosas y en este orden: qué resolvió la
 *  Comisión, hasta cuándo hay tiempo (con la fecha escrita, no "en 30 días") y
 *  por dónde se hace. La alternativa presencial va SIEMPRE: el Art. 9° bis a)
 *  admite las dos vías y buena parte del padrón no usa la web.
 *
 *  No saluda por nombre y la plantilla ni siquiera lo recibe: el mensaje es el
 *  mismo para los ciento y pico, se arma UNA vez y se manda a todos. Nada de lo
 *  que dice es un dato personal, así que un correo que llegue a la casilla
 *  equivocada no revela nada de nadie. */
export function reregistrationCallEmail(opts: { url: string; firstEndsAt: Date }): Rendered {
  const until = formatDateAR(opts.firstEndsAt);
  const title = "Re-empadronamiento de socios adherentes";
  return {
    subject: `${title} — tenés tiempo hasta el ${until} — Vecinal Ciudadela`,
    text: `La Comisión Directiva de la ${ORG} convocó el re-empadronamiento de los socios adherentes (Art. 9° bis del estatuto).

Figurás en el padrón como socio adherente, así que para conservar tu condición de socio tenés que ratificar tus datos antes del ${until} inclusive.

Podés hacerlo de dos maneras:

1. Por internet, en este enlace:

${opts.url}

2. En persona, acercándote a la sede vecinal con tu DNI.

Te vamos a pedir tus datos actualizados y una foto o copia de tu DNI. Es un trámite corto y no tiene ningún costo.

Si ya te re-empadronaste, ignorá este correo.${SIGNATURE}`,
    html: layout(title, `<p>La Comisión Directiva de la ${esc(ORG)} convocó el <strong>re-empadronamiento de los socios adherentes</strong> (Art. 9° bis del estatuto).</p>
<p>Figurás en el padrón como socio adherente, así que para conservar tu condición de socio tenés que ratificar tus datos <strong>antes del ${esc(until)}</strong> inclusive.</p>
${button(opts.url, "Re-empadronarme")}
<p>También podés hacerlo <strong>en persona</strong>, acercándote a la sede vecinal con tu DNI.</p>
<p>Te vamos a pedir tus datos actualizados y una foto o copia de tu DNI. Es un trámite corto y no tiene ningún costo.</p>
<p>Si ya te re-empadronaste, ignorá este correo.</p>`),
  };
}

/** Segunda instancia del Art. 9° bis (M6): el aviso con APERCIBIMIENTO.
 *
 *  Va a todos los que NO tienen presentación aprobada, que son cuatro casos
 *  distintos: el que no presentó nada, el que presentó y quedó OBSERVADO, el que
 *  presentó y fue RECHAZADO y el que retiró su presentación. Por eso el correo
 *  abre diciendo que no tenemos el re-empadronamiento APROBADO y no que "no lo
 *  registramos": a dos de esos cuatro sí se les registró la presentación —y al
 *  rechazado se le registró y se le rechazó—, así que afirmar lo contrario sería
 *  un dato falso en la última notificación antes de una baja estatutaria, y le
 *  regalaría al socio un argumento para el recurso del inc. d).
 *
 *  Es la última notificación antes de que la Comisión resuelva la baja. Tiene que decir con
 *  todas las letras qué está en juego —el estatuto exige el apercibimiento para
 *  que la baja sea oponible— y al mismo tiempo no sonar a intimación de estudio
 *  jurídico: del otro lado hay un vecino que probablemente no abrió el correo
 *  anterior. De ahí el orden: primero que todavía está a tiempo y cómo, y recién
 *  después la consecuencia de no hacerlo. */
export function reregistrationSecondEmail(opts: { url: string; secondEndsAt: Date }): Rendered {
  const until = formatDateAR(opts.secondEndsAt);
  const title = "Último plazo para re-empadronarte";
  return {
    subject: `${title} — hasta el ${until} — Vecinal Ciudadela`,
    text: `Todavía no tenemos aprobado tu re-empadronamiento, así que la ${ORG} te concede un último plazo: tenés tiempo hasta el ${until} inclusive.

Podés hacerlo por internet, en este enlace:

${opts.url}

O en persona, acercándote a la sede vecinal con tu DNI.

Te lo pedimos ahora porque, vencido ese plazo y sin respuesta de tu parte, la Comisión Directiva declarará tu baja como socio, bajo apercibimiento de baja (Art. 9° bis del estatuto). Si eso ocurriera, se te va a notificar y vas a tener treinta días para presentar un recurso.

Si ya te avisamos que tu re-empadronamiento quedó aprobado, ignorá este correo. Si te pedimos que corrijas algo, entrá por el enlace y completalo antes de esa fecha: mientras no esté aprobado, el plazo sigue corriendo.${SIGNATURE}`,
    html: layout(title, `<p>Todavía no tenemos aprobado tu re-empadronamiento, así que la ${esc(ORG)} te concede un último plazo: tenés tiempo <strong>hasta el ${esc(until)}</strong> inclusive.</p>
${button(opts.url, "Re-empadronarme")}
<p>También podés hacerlo <strong>en persona</strong>, acercándote a la sede vecinal con tu DNI.</p>
<p>Te lo pedimos ahora porque, vencido ese plazo y sin respuesta de tu parte, la Comisión Directiva declarará tu baja como socio, <strong>bajo apercibimiento de baja</strong> (Art. 9° bis del estatuto). Si eso ocurriera, se te va a notificar y vas a tener treinta días para presentar un recurso.</p>
<p>Si ya te avisamos que tu re-empadronamiento quedó aprobado, ignorá este correo. Si te pedimos que corrijas algo, entrá por el enlace y completalo antes de esa fecha: mientras no esté aprobado, el plazo sigue corriendo.</p>`),
  };
}

/** LA CONSTANCIA del re-empadronamiento (M6 §5.3). Hace dos cosas a la vez, y
 *  las dos importan:
 *
 *  1. Es el ACUSE con fecha y hora. `submittedAt` es lo único que acredita que
 *     el socio se presentó dentro de los treinta días del Art. 9° bis, y de eso
 *     cuelga su condición de socio: el correo se lo deja por escrito en su
 *     buzón, que es lo que puede mostrar si alguna vez se discute el plazo. Por
 *     eso lleva la hora y no sólo el día.
 *  2. Lleva el ENLACE, que es la única forma de volver a ver la presentación.
 *     El wizard entrega su llave contra un DNI —que no es autenticación—, así
 *     que el acceso con datos vive acá: el buzón es lo que demuestra que la
 *     presentación es suya.
 *
 *  No saluda por nombre a propósito: el enlace ya es un secreto y el nombre no
 *  agrega nada que el destinatario no sepa, pero sí se lo regalaría a quien
 *  reciba el correo por un dedazo en la dirección (Ley 25.326, docs/08). Mismo
 *  criterio que `verificationEmail`. */
export function presentationReceivedEmail(opts: { url: string; submittedAt: Date }): Rendered {
  const when = formatDateTimeAR(opts.submittedAt);
  const title = "Recibimos tu re-empadronamiento";
  return {
    subject: `${title} — Vecinal Ciudadela`,
    text: `La ${ORG} recibió tu re-empadronamiento el ${when}.

Guardá este correo: es la constancia de que te presentaste dentro del plazo.

La Comisión Directiva va a revisar lo que cargaste. Si falta o hay que corregir algo, te vamos a escribir a esta misma dirección.

Con este enlace podés volver a ver tu re-empadronamiento:

${opts.url}

Es un enlace personal: no se lo pases a nadie.${SIGNATURE}`,
    html: layout(title, `<p>La ${esc(ORG)} recibió tu re-empadronamiento el <strong>${esc(when)}</strong>.</p>
<p>Guardá este correo: es la constancia de que te presentaste dentro del plazo.</p>
<p>La Comisión Directiva va a revisar lo que cargaste. Si falta o hay que corregir algo, te vamos a escribir a esta misma dirección.</p>
${button(opts.url, "Ver mi re-empadronamiento")}
<p>Es un enlace personal: no se lo pases a nadie.</p>`),
  };
}

/** La OBSERVACIÓN: la Comisión revisó la presentación y necesita una
 *  corrección (M6 §5.4, decisión 13 — las observaciones van siempre por email).
 *
 *  ES TAMBIÉN EL CORREO DEL REENVÍO DEL ENLACE cuando la presentación está
 *  observada, y de ahí que sus dos parámetros de contenido sean opcionales.
 *  Antes ese reenvío mandaba la CONSTANCIA, que a un observado le dice dos
 *  cosas falsas —"la Comisión va a revisar lo que cargaste" y "si hay que
 *  corregir algo te vamos a escribir"— y, peor, lo tranquiliza: lo manda a
 *  esperar justo cuando lo que tiene que hacer es actuar antes de una fecha, y
 *  de esa fecha cuelga su condición de socio.
 *
 *  `observation` — el pedido TEXTUAL del operador — viaja tal cual cuando está:
 *  es lo único que le dice al vecino qué arreglar, y resumirlo o reformatearlo
 *  sería cambiarle el pedido. Va escapado en el HTML como todo lo que entra
 *  desde la base.
 *
 *  Y se OMITE a propósito en el reenvío. La nota ya viajó en el correo original
 *  de la observación; repetirla acá la pondría en dos correos que pueden
 *  divergir —el operador puede haberla editado en el medio— y el vecino no
 *  tendría cómo saber cuál manda. Sin ella el correo dice lo que sí es cierto
 *  siempre: que hay algo para corregir, que el detalle está en el correo de la
 *  observación, por dónde entrar y hasta cuándo.
 *
 *  `deadline` es el último día del plazo que corre (`currentDeadline`), y es la
 *  mitad accionable del mensaje: "cuanto antes" no es una fecha, y el vecino no
 *  puede reconstruir un plazo estatutario por su cuenta. Es opcional porque
 *  puede no haber plazo corriendo (proceso fuera de sus dos instancias): en ese
 *  caso el correo no inventa uno.
 *
 *  Dice que el plazo SIGUE CORRIENDO porque es verdad y porque callarlo sería
 *  la diferencia entre subsanar a tiempo y una baja: mientras la presentación
 *  no esté validada, el Art. 9° bis cuenta igual. Y el orden es el mismo que el
 *  del aviso de la 2ª instancia: primero qué hacer y para cuándo, después la
 *  consecuencia — del otro lado hay un vecino, no una contraparte. */
export function presentationObservedEmail(opts: {
  url: string;
  observation?: string | null;
  deadline?: Date | null;
}): Rendered {
  const title = "Tenemos que pedirte una corrección";
  const until = opts.deadline ? formatDateAR(opts.deadline) : null;
  // El plazo primero, y con fecha si la hay: es lo único de este correo que el
  // vecino no puede averiguar solo.
  const deadlineText = until
    ? `Tenés tiempo hasta el ${until} inclusive: mientras tu re-empadronamiento no esté aprobado, el plazo del Art. 9° bis sigue corriendo.`
    : "Hacelo cuanto antes: mientras tu re-empadronamiento no esté aprobado, el plazo del Art. 9° bis sigue corriendo.";
  const deadlineHtml = until
    ? `<p>Tenés tiempo <strong>hasta el ${esc(until)}</strong> inclusive: mientras tu re-empadronamiento no esté aprobado, el plazo del Art. 9° bis sigue corriendo.</p>`
    : `<p>Hacelo cuanto antes: mientras tu re-empadronamiento no esté aprobado, el plazo del Art. 9° bis sigue corriendo.</p>`;
  const opening = opts.observation
    ? `Revisamos tu re-empadronamiento en la ${ORG} y necesitamos que corrijas lo siguiente:

${opts.observation}`
    : `Revisamos tu re-empadronamiento en la ${ORG} y te pedimos que corrijas algo. El detalle de qué es te lo mandamos por correo cuando lo revisamos.`;
  const openingHtml = opts.observation
    ? `<p>Revisamos tu re-empadronamiento en la ${esc(ORG)} y necesitamos que corrijas lo siguiente:</p>
<p style="border-left:3px solid #0079BC;padding-left:12px;margin:16px 0">${esc(opts.observation)}</p>`
    : `<p>Revisamos tu re-empadronamiento en la ${esc(ORG)} y te pedimos que corrijas algo. El detalle de qué es te lo mandamos por correo cuando lo revisamos.</p>`;
  return {
    subject: `${title} en tu re-empadronamiento — Vecinal Ciudadela`,
    text: `${opening}

Entrá por este enlace, corregilo y volvé a enviarlo:

${opts.url}

Vas a encontrar tus datos como los cargaste: sólo tenés que cambiar lo que te pedimos.

${deadlineText}${SIGNATURE}`,
    html: layout(title, `${openingHtml}
${button(opts.url, "Corregir mi re-empadronamiento")}
<p>Vas a encontrar tus datos como los cargaste: sólo tenés que cambiar lo que te pedimos.</p>
${deadlineHtml}`),
  };
}

/** EL RECHAZO: la Comisión revisó la presentación y NO la aceptó (M6 §5.4).
 *
 *  Hasta que existió esta plantilla el rechazo no avisaba nada, y esa es
 *  exactamente la forma del daño: el vecino se quedaba tranquilo creyendo que
 *  su trámite estaba hecho mientras el plazo del Art. 9° bis le corría en
 *  contra, y se enteraba con la notificación de la BAJA — cuando ya no había
 *  nada que corregir. Un rechazo silencioso es peor que una observación
 *  silenciosa: de la observación el vecino puede volver por su cuenta, del
 *  rechazo no.
 *
 *  NO LLEVA ENLACE, y no es un olvido. `rejected` no está en
 *  `EDITABLE_STATUSES` (`presentation-rules.ts`), así que la llave de retome
 *  rebota con "Tu re-empadronamiento ya fue resuelto por la Comisión": un botón
 *  que muere en la primera pantalla manda al vecino a pelearse con el sitio en
 *  vez de a la sede, que es lo único que le resuelve el trámite. Por eso la
 *  única salida que ofrece el correo es la presencial —donde el operador
 *  revierte el rechazo y lo carga con él, o le vuelve a habilitar la web— y por
 *  eso la plantilla ni siquiera RECIBE una url: no hay forma de meterle una por
 *  descuido desde el llamador.
 *
 *  `note` es el motivo TEXTUAL de la Comisión y viaja tal cual, escapado en el
 *  HTML como todo lo que entra desde la base. Es opcional porque en la pantalla
 *  el motivo lo es: sin él el correo dice lo que igual es cierto —que no se
 *  aceptó y que en la sede le explican por qué— en vez de imprimir un hueco.
 *
 *  El ORDEN es el mismo que el del aviso de la 2ª instancia y el de la
 *  observación: primero qué hacer y para cuándo, y recién al final la
 *  consecuencia. Pero la consecuencia VA: la regla que este módulo aprendió por
 *  las malas es que un correo que tranquiliza a quien tiene que actuar es peor
 *  que no mandarlo. Tampoco nombra al socio, por lo mismo que la constancia: un
 *  dedazo en la dirección declarada no puede regalarle a un tercero el nombre
 *  de quien se re-empadronó ni el hecho de que le rechazaron el trámite
 *  (Ley 25.326, docs/08). */
export function presentationRejectedEmail(opts: {
  note?: string | null;
  deadline?: Date | null;
}): Rendered {
  const title = "Tu re-empadronamiento no fue aceptado";
  const until = opts.deadline ? formatDateAR(opts.deadline) : null;
  const opening = opts.note
    ? `La Comisión Directiva de la ${ORG} revisó tu re-empadronamiento y no lo aceptó.

Motivo:

${opts.note}`
    : `La Comisión Directiva de la ${ORG} revisó tu re-empadronamiento y no lo aceptó. Si querés saber por qué, preguntanos en la sede vecinal.`;
  const openingHtml = opts.note
    ? `<p>La Comisión Directiva de la ${esc(ORG)} revisó tu re-empadronamiento y <strong>no lo aceptó</strong>.</p>
<p>Motivo:</p>
<p style="border-left:3px solid #0079BC;padding-left:12px;margin:16px 0">${esc(opts.note)}</p>`
    : `<p>La Comisión Directiva de la ${esc(ORG)} revisó tu re-empadronamiento y <strong>no lo aceptó</strong>. Si querés saber por qué, preguntanos en la sede vecinal.</p>`;
  // El plazo, con fecha si la hay: es lo único de este correo que el vecino no
  // puede averiguar solo.
  const deadlineText = until
    ? `Tenés tiempo hasta el ${until} inclusive.`
    : "Hacelo cuanto antes: mientras no tengamos tu re-empadronamiento aprobado, el plazo del Art. 9° bis sigue corriendo.";
  const deadlineHtml = until
    ? `<p>Tenés tiempo <strong>hasta el ${esc(until)}</strong> inclusive.</p>`
    : `<p>Hacelo cuanto antes: mientras no tengamos tu re-empadronamiento aprobado, el plazo del Art. 9° bis sigue corriendo.</p>`;
  return {
    subject: `${title} — Vecinal Ciudadela`,
    text: `${opening}

Todavía estás a tiempo de volver a presentarte. Acercate a la sede vecinal con tu DNI y lo hacemos ahí mismo con vos; si preferís volver a hacerlo por internet, pedinos en la sede que te habilitemos el trámite de nuevo.

${deadlineText}

Si el plazo vence sin que vuelvas a presentarte, vas a figurar como no re-empadronado y la Comisión Directiva puede declarar tu baja como socio (Art. 9° bis del estatuto).${SIGNATURE}`,
    html: layout(title, `${openingHtml}
<p><strong>Todavía estás a tiempo de volver a presentarte.</strong> Acercate a la sede vecinal con tu DNI y lo hacemos ahí mismo con vos; si preferís volver a hacerlo por internet, pedinos en la sede que te habilitemos el trámite de nuevo.</p>
${deadlineHtml}
<p>Si el plazo vence sin que vuelvas a presentarte, vas a figurar como no re-empadronado y la Comisión Directiva puede declarar tu baja como socio (Art. 9° bis del estatuto).</p>`),
  };
}

/** LA BAJA DECLARADA (M6 §9 etapa B, Art. 9° bis inc. c).
 *
 *  Es la notificación más grave que manda el sistema: le dice a un vecino que
 *  dejó de ser socio de la asociación. Y es además el punto de partida de un
 *  plazo —desde que queda fehaciente le corren treinta días corridos para
 *  recurrir ante la primera asamblea ordinaria (Art. 9° bis d)—, así que el
 *  correo TIENE que nombrar la fecha: es lo único de este mensaje que el vecino
 *  no puede averiguar solo, y de ella depende su derecho de defensa.
 *
 *  El orden está invertido respecto de los otros correos del módulo, y a
 *  propósito. En la convocatoria, la observación y el rechazo primero va qué
 *  hacer y recién al final la consecuencia, porque el vecino todavía está a
 *  tiempo. Acá la consecuencia YA OCURRIÓ: empezar por "podés recurrir" sobre
 *  alguien que no sabe que lo dieron de baja sería incomprensible. Primero el
 *  hecho y su fundamento, después qué puede hacer al respecto y hasta cuándo.
 *
 *  No saluda por nombre y la plantilla ni siquiera lo recibe, igual que la
 *  convocatoria: un dedazo en la dirección declarada no puede regalarle a un
 *  tercero el nombre de quien perdió la condición de socio (Ley 25.326,
 *  docs/08). Lo que sí dice, porque es lo que hace oponible la resolución, es
 *  cuál es la causal y de qué artículo sale.
 *
 *  Tampoco lleva enlace: no hay ninguna pantalla donde interponer un recurso
 *  —el Art. 9° bis d) lo dirige a la ASAMBLEA, no a la web— y un botón que
 *  muriera en la primera pantalla mandaría al vecino a pelearse con el sitio en
 *  vez de a la sede. Misma razón por la que `presentationRejectedEmail` ni
 *  recibe una url. */
/** Qué avisos se le cursaron EFECTIVAMENTE antes de la baja. No es decorado:
 *  ver el comentario de la frase de abajo. */
export type WithdrawalNoticesServed = {
  /** La convocatoria al re-empadronamiento (Art. 9° bis). */
  first: boolean;
  /** El último plazo, que es el que lleva el apercibimiento de baja. */
  second: boolean;
};

/** La primera frase del cuerpo: qué se le avisó antes de resolver la baja.
 *
 *  Se CONDICIONA a lo que efectivamente se le cursó, y no es un escrúpulo de
 *  redacción. La pantalla del lote marca en rojo a quien no tiene ninguna
 *  notificación cursada pero NO impide declararle la baja —esa decisión es de
 *  la Comisión, no del software—, así que un texto fijo que dijera siempre "te
 *  avisamos dos veces" haría que el documento con el que la asociación sostiene
 *  la resolución abriera con una afirmación falsa y verificable contra su
 *  propia base. Y es lo primero que leería un recurso ante la asamblea. */
function noticedSentence(n: WithdrawalNoticesServed): string {
  if (n.first && n.second) {
    return "Te habíamos avisado dos veces —la convocatoria y el último plazo— y el trámite no llegó a quedar aprobado, así que la Comisión resolvió la baja en los términos del Art. 9° bis inciso c).";
  }
  if (n.first) {
    return "Te habíamos notificado la convocatoria al re-empadronamiento y el trámite no llegó a quedar aprobado, así que la Comisión resolvió la baja en los términos del Art. 9° bis inciso c).";
  }
  if (n.second) {
    return "Te habíamos notificado el último plazo para re-empadronarte y el trámite no llegó a quedar aprobado, así que la Comisión resolvió la baja en los términos del Art. 9° bis inciso c).";
  }
  // Ningún aviso acreditado: se dice el hecho y su fundamento, y nada más.
  return "El trámite no llegó a quedar aprobado dentro del plazo del Art. 9° bis, así que la Comisión resolvió la baja en los términos de su inciso c).";
}

export function withdrawalDeclaredEmail(opts: {
  appealUntil: Date;
  notified: WithdrawalNoticesServed;
}): Rendered {
  const until = formatDateAR(opts.appealUntil);
  const noticed = noticedSentence(opts.notified);
  // Sin nombrar a la vecinal: el asunto ya lo lleva de sufijo, y "Tu baja
  // como socio de la Vecinal Ciudadela — Vecinal Ciudadela" es lo que salía.
  const title = "Tu baja como socio";
  return {
    subject: `${title} — Vecinal Ciudadela`,
    text: `La Comisión Directiva de la ${ORG} resolvió declarar tu baja como socio adherente por no haberte re-empadronado en el plazo del Art. 9° bis del estatuto.

${noticed}

Si no estás de acuerdo, podés recurrir esta resolución ante la primera asamblea ordinaria (Art. 9° bis inciso d). Tenés tiempo para presentar el recurso hasta el ${until} inclusive: acercate a la sede vecinal y dejalo por escrito.

Y si simplemente querés volver a ser socio, también podés hacerlo: pedí el reingreso en la sede. Tu antigüedad como asociado no se pierde.${SIGNATURE}`,
    html: layout(title, `<p>La Comisión Directiva de la ${esc(ORG)} resolvió <strong>declarar tu baja como socio adherente</strong> por no haberte re-empadronado en el plazo del Art. 9° bis del estatuto.</p>
<p>${esc(noticed)}</p>
<p>Si no estás de acuerdo, <strong>podés recurrir</strong> esta resolución ante la primera asamblea ordinaria (Art. 9° bis inciso d). Tenés tiempo para presentar el recurso <strong>hasta el ${esc(until)}</strong> inclusive: acercate a la sede vecinal y dejalo por escrito.</p>
<p>Y si simplemente querés volver a ser socio, también podés hacerlo: pedí el reingreso en la sede. Tu antigüedad como asociado no se pierde.</p>`),
  };
}

/** Invitación de una cuenta de GESTIÓN (módulo de usuarios, /admin/usuarios).
 *
 *  No saluda por nombre y la plantilla ni siquiera lo recibe: la dirección la
 *  tipea el superadmin al crear la cuenta — el mismo canal de dedazo que
 *  `verificationEmail`, y acá el premio sería una cuenta de administración.
 *  El enlace se canjea en /acceso (rama admin del mismo circuito). */
export function adminInvitationEmail(opts: { url: string }): Rendered {
  return {
    subject: "Tu acceso al panel de administración — Vecinal Ciudadela",
    text: `La ${ORG} creó una cuenta de administración de su sistema de gestión para esta dirección de correo.

Para activarla, creá tu contraseña desde este enlace:

${opts.url}

El enlace vence en 7 días y se puede usar una sola vez.

Si no esperabas este correo, ignoralo y avisale a la vecinal: nadie puede usar la cuenta sin crear la contraseña.${SIGNATURE}`,
    html: layout("Tu acceso al panel de administración", `<p>La ${esc(ORG)} creó una <strong>cuenta de administración</strong> de su sistema de gestión para esta dirección de correo.</p>
<p>Para activarla, creá tu contraseña:</p>
${button(opts.url, "Crear mi contraseña")}
<p>El enlace vence en 7 días y se puede usar una sola vez.</p>
<p>Si no esperabas este correo, ignoralo y avisale a la vecinal: nadie puede usar la cuenta sin crear la contraseña.</p>`),
  };
}

// ── Módulo 7: Reportes ───────────────────────────────────────────────────────

const REPORT_KIND_WORD = { claim: "reclamo", initiative: "iniciativa" } as const;

/** Acuse al que reporta (spec §9). NO promete resolución: la asociación recibe
 *  y canaliza. El cuerpo se bifurca por tipo: un RECLAMO puede terminar
 *  presentado ante un organismo, una INICIATIVA la trata la propia Comisión
 *  (Art. 6 del estatuto) y nunca se presenta ante nadie — prometerle a un
 *  vecino un trámite ante la SCPL por una propuesta vecinal es prometer algo
 *  que no va a pasar. Cierra con el canal ARCO (docs/08): un vecino que no es
 *  socio no tiene panel, y el email de contacto de `Configuration` es su única
 *  vía. */
export function reportReceivedEmail(opts: {
  number: number;
  kind: "claim" | "initiative";
  categoryLabel: string;
  contactEmail: string | null;
}): Rendered {
  const word = REPORT_KIND_WORD[opts.kind];
  const title = `Recibimos tu ${word} N° ${opts.number}`;
  const arco = opts.contactEmail
    ? `Podés pedir la rectificación o supresión de tus datos escribiendo a ${opts.contactEmail}.`
    : "Podés pedir la rectificación o supresión de tus datos en la sede vecinal.";
  const body =
    opts.kind === "claim"
      ? [
          "La Comisión Directiva lo va a revisar y, si corresponde, lo va a presentar ante el organismo que corresponda. Te avisamos por este medio cuando eso pase.",
          "Este reporte no reemplaza el reclamo que podés hacer directamente ante el municipio o la SCPL.",
        ]
      : ["La Comisión Directiva la va a evaluar (Art. 6 del estatuto) y te avisamos por este medio cuando la trate."];
  return {
    subject: `${title} — Vecinal Ciudadela`,
    text: `La ${ORG} recibió tu ${word} N° ${opts.number} (${opts.categoryLabel}).

${body.join("\n\n")}

${arco}${SIGNATURE}`,
    html: layout(title, `<p>La ${esc(ORG)} recibió tu ${esc(word)} <strong>N° ${opts.number}</strong> (${esc(opts.categoryLabel)}).</p>
${body.map((p) => `<p>${esc(p)}</p>`).join("\n")}
<p style="font-size:12px;color:#666">${esc(arco)}</p>`),
  };
}

/** Aviso al presentar (reclamo) o tratar (iniciativa). La iniciativa no va a
 *  ningún organismo: la resuelve la Comisión, así que su referencia es interna
 *  (`ref.`, no un expediente) y el seguimiento es en la sede, no en una mesa de
 *  entradas ajena. */
export function reportFiledEmail(opts: {
  number: number;
  kind: "claim" | "initiative";
  agencyLabel: string | null;
  filedAt: Date;
  reference: string | null;
}): Rendered {
  const day = formatDateAR(opts.filedAt);
  const refWord = opts.kind === "claim" ? "expediente" : "ref.";
  const ref = opts.reference ? ` (${refWord} ${opts.reference})` : "";
  const line =
    opts.kind === "claim"
      ? `Presentamos tu reporte N° ${opts.number} ante ${opts.agencyLabel ?? "el organismo"} el ${day}${ref}.`
      : `La Comisión Directiva trató tu iniciativa N° ${opts.number} el ${day}${ref}.`;
  const tail =
    opts.kind === "claim"
      ? "Desde acá el seguimiento queda en manos del organismo; si te dieron un número de trámite, guardalo."
      : "Si querés saber más sobre lo resuelto, acercate a la sede vecinal.";
  const title = opts.kind === "claim" ? `Presentamos tu reporte N° ${opts.number}` : `Tratamos tu iniciativa N° ${opts.number}`;
  return {
    subject: `${title} — Vecinal Ciudadela`,
    text: `${line}

${tail}${SIGNATURE}`,
    html: layout(title, `<p>${esc(line)}</p>
<p>${esc(tail)}</p>`),
  };
}

/** Alerta INMEDIATA a la Comisión por cada reporte nuevo (decisión del
 *  operador: con identidad completa). Va a `digest_recipients`, casillas de la
 *  propia Comisión, y por eso —a diferencia del digest— lleva nombre y DNI. El
 *  texto del vecino se escapa: entra tal cual lo tipeó. */
export function reportBoardAlertEmail(opts: {
  number: number;
  kind: "claim" | "initiative";
  categoryLabel: string;
  subtypeLabel: string | null;
  street: string | null;
  description: string;
  reporter: { name: string | null; dni: string | null; phone: string | null; email: string | null; anonymous: boolean };
  panelUrl: string;
}): Rendered {
  const kind = opts.kind === "claim" ? "Reclamo" : "Iniciativa";
  const what = opts.subtypeLabel ? `${opts.categoryLabel} › ${opts.subtypeLabel}` : opts.categoryLabel;
  const who = `${opts.reporter.name ?? "—"} · DNI ${opts.reporter.dni ?? "—"} · ${opts.reporter.phone ?? "—"} · ${opts.reporter.email ?? "—"}`;
  const reserved = opts.reporter.anonymous ? "Pidió que su identidad quede reservada ante el organismo." : "";
  const title = `${kind} N° ${opts.number}: ${what}`;
  return {
    subject: `Nuevo reporte — ${title}`,
    text: `Entró un ${kind.toLowerCase()} nuevo en el sitio.

${what}
${opts.street ? `Ubicación: ${opts.street}\n` : ""}
Quién reporta: ${who}
${reserved ? `${reserved}\n` : ""}
Descripción:
${opts.description}

Verlo en el panel: ${opts.panelUrl}${SIGNATURE}`,
    html: layout(title, `<p>Entró un ${esc(kind.toLowerCase())} nuevo en el sitio.</p>
${opts.street ? `<p><strong>Ubicación:</strong> ${esc(opts.street)}</p>` : ""}
<p><strong>Quién reporta:</strong> ${esc(who)}</p>
${reserved ? `<p><em>${esc(reserved)}</em></p>` : ""}
<p><strong>Descripción:</strong></p>
<p style="white-space:pre-line">${esc(opts.description)}</p>
${button(opts.panelUrl, "Ver en el panel")}`),
  };
}
