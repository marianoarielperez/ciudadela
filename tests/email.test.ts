import { afterEach, describe, expect, it, vi } from "vitest";

// El singleton importa @/lib/prisma (eager, explota sin .env) — mockear SIEMPRE.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { makeMailer } from "@/lib/email";
import {
  boardDigestEmail,
  feeReminderEmail, invitationEmail, loginEmailMovedNotice, loginEmailVerification,
  passwordResetEmail, paymentLinkEmail, paymentRejectedEmail, portalInvite,
  presentationObservedEmail, presentationReceivedEmail, receiptEmail,
  reregistrationCallEmail, reregistrationSecondEmail, verificationEmail,
} from "@/lib/email/templates";
import { PAYMENT_LINK_TTL_HOURS } from "@/lib/mp/references";
import { rejectionReason } from "@/lib/mp/rejection-reasons";
import { getTransport, makeAllowlistTransport, type MailMessage } from "@/lib/email/transport";

describe("templates", () => {
  // 26/08/2026 15:40 hora argentina (UTC-3). Los tests corren con TZ=UTC, así
  // que este instante ejercita de verdad la conversión.
  const EXPIRES = new Date("2026-08-26T18:40:00.000Z");

  // El correo de verificación es el de más volumen de la campaña de carga (uno
  // por ficha tipeada desde papel) y el único que un dedazo del operador entrega
  // SOLO, sin que nadie haga clic y sin reparación posible. Por eso no nombra al
  // socio, y la plantilla ni siquiera recibe el nombre: no hay forma de
  // filtrarlo por descuido desde el llamador.
  it("verification email carries the url and cannot carry the member's name", () => {
    const m = verificationEmail({ url: "https://x/verificar/abc" });
    // Y no puede recibirlo: el parámetro es `{ url }` a secas, así que un
    // llamador que intente pasarle `name` no compila (verificado con `tsc`).
    expect(verificationEmail.length).toBe(1);
    expect(m.subject).toContain("Verificá");
    for (const body of [m.text, m.html]) {
      expect(body).toContain("https://x/verificar/abc");
      expect(body).not.toContain("Hola ");
      // Contexto institucional suficiente para que el socio legítimo entienda
      // qué está confirmando y no lo tome por spam.
      expect(body).toContain("Asociación Vecinal del Barrio Ciudadela");
      expect(body).toContain("padrón de socios");
      expect(body).toContain("error de carga");
    }
  });
  it("invitation and reset include their urls", () => {
    expect(invitationEmail({ name: "Ana", url: "https://x/acceso/t" }).text).toContain("https://x/acceso/t");
    expect(passwordResetEmail({ url: "https://x/restablecer/t" }).text).toContain("https://x/restablecer/t");
  });
  // Un cliente sin HTML tiene que poder leer el mensaje completo, enlace incluido.
  it("every template ships a usable plain-text body carrying the link", () => {
    const rendered = [
      verificationEmail({ url: "https://x/v/t" }),
      invitationEmail({ name: "Ana", url: "https://x/i/t" }),
      passwordResetEmail({ url: "https://x/r/t" }),
      reregistrationCallEmail({ url: "https://x/reempadronate", firstEndsAt: EXPIRES }),
      reregistrationSecondEmail({ url: "https://x/reempadronate", secondEndsAt: EXPIRES }),
      presentationReceivedEmail({ url: "https://x/reempadronate/retomar/t", submittedAt: EXPIRES }),
      presentationObservedEmail({ url: "https://x/reempadronate/retomar/t", observation: "Falta el dorso" }),
    ];
    for (const m of rendered) {
      expect(m.subject).toContain("Vecinal Ciudadela");
      expect(m.text.length).toBeGreaterThan(80);
      expect(m.text).not.toContain("<");
      expect(m.text).toContain("Asociación Vecinal del Barrio Ciudadela");
      expect(m.html).toContain("Asociación Vecinal del Barrio Ciudadela");
    }
  });
  // Cada tipo de enlace se canjea en una ruta distinta: el de verificación en
  // /verificar y el de invitación en /acceso. Mandarlos cruzados le daría al
  // socio un enlace que muere en la primera pantalla.
  it("portalInvite pairs each kind with its own route and template", () => {
    const v = portalInvite({
      kind: "email_verification", name: "Ana", baseUrl: "https://x", token: "tok1",
    });
    expect(v.message.subject).toContain("Verificá");
    expect(v.message.text).toContain("https://x/verificar/tok1");
    expect(v.message.text).not.toContain("/acceso/");
    expect(v.summary).toContain("verificación");

    const i = portalInvite({
      kind: "password_invitation", name: "Ana", baseUrl: "https://x", token: "tok2",
    });
    expect(i.message.subject).toContain("contraseña");
    expect(i.message.text).toContain("https://x/acceso/tok2");
    expect(i.message.text).not.toContain("/verificar/");
    expect(i.summary).toContain("invitación");
  });

  // El correo que le avisa al socio que su dirección de INGRESO se mudó. Lo que
  // NO puede llevar es la dirección nueva: si el cambio fue un secuestro, este
  // correo le confirmaría al atacante que acertó; si fue un dedazo del operador,
  // le estaría mandando la casilla de un tercero a alguien que no tiene por qué
  // verla. Por eso la plantilla ni siquiera RECIBE la dirección nueva: no hay
  // forma de filtrarla por descuido desde el llamador.
  it("warns the previous address without ever naming the new one", () => {
    const m = loginEmailMovedNotice();
    expect(loginEmailMovedNotice.length).toBe(0); // no recibe ninguna dirección
    for (const body of [m.text, m.html]) {
      expect(body).not.toContain("@example");
      // Las tres cosas que la persona tiene que salir sabiendo.
      expect(body).toContain("otra dirección de correo");
      expect(body).toContain("ya no sirve para entrar");
      expect(body).toContain("sede");
    }
    expect(m.subject).toContain("Vecinal Ciudadela");
    // Y ningún enlace: quien recibe esto ya no tiene acceso, y un enlace en un
    // correo de alerta de seguridad es justo lo que enseña a hacer clic.
    expect(m.text).not.toContain("http");
  });

  // La verificación de la dirección nueva se canja en /verificar, igual que
  // cualquier otro `email_verification`: mandarla a /acceso le daría al socio un
  // enlace muerto.
  it("sends the new address a verification link on the /verificar route", () => {
    const v = loginEmailVerification({ baseUrl: "https://x", token: "tok9" });
    expect(v.message.text).toContain("https://x/verificar/tok9");
    expect(v.message.text).not.toContain("/acceso/");
    // Y le dice lo que el correo de verificación común no dice: que esta casilla
    // es, además, con la que ingresa.
    expect(v.message.text).toContain("ingresás al portal");
    expect(v.message.text).toContain("Tu contraseña no cambia");
    expect(v.summary).toContain("acceso");
  });

  // Ninguno de los dos saluda por nombre: la casilla vieja puede estar en manos
  // de un tercero y la nueva todavía no está confirmada.
  it("keeps the member's name out of both sides of the move", () => {
    const bodies = [
      loginEmailMovedNotice(),
      loginEmailVerification({ baseUrl: "https://x", token: "t" }).message,
    ];
    for (const m of bodies) {
      expect(m.text).not.toContain("Hola ");
      expect(m.subject).toContain("Vecinal Ciudadela");
      expect(m.text).toContain("Asociación Vecinal del Barrio Ciudadela");
      expect(m.text).not.toContain("<");
      expect(m.html).toContain("Asociación Vecinal del Barrio Ciudadela");
    }
  });

  // El enlace es dato de entrada: no puede romper el HTML ni inyectar atributos.
  it("escapes interpolated values in html", () => {
    const m = verificationEmail({ url: `https://x/v/t?a=1&b="2"` });
    expect(m.html).not.toContain(`b="2"`);
    expect(m.html).toContain("&amp;");
    expect(m.text).toContain(`https://x/v/t?a=1&b="2"`);
    // El nombre sigue entrando en la invitación, que es la única plantilla que
    // no puede caer en una casilla sin confirmar: ahí el escapado sigue vivo.
    const i = invitationEmail({ name: `Ana "<script>" & Cia`, url: "https://x/i/t" });
    expect(i.html).not.toContain("<script>");
    expect(i.html).toContain("&amp;");
  });

  it("receiptEmail nombra número, concepto y monto, y avisa que el PDF va adjunto", () => {
    const r = receiptEmail({ name: "Ana", number: "2026-00012", concept: "Cuota social · marzo 2025", amount: 6000 });
    expect(r.subject).toBe("Recibo 2026-00012 — Vecinal Ciudadela");
    expect(r.text).toContain("2026-00012");
    expect(r.text).toContain("$ 6.000,00");
    expect(r.text).toContain("adjunto");
    expect(r.html).toContain("Cuota social · marzo 2025");
  });

  // El vecino recibe un enlace de COBRO que no pidió: el correo tiene que
  // dejarlo verificar cuánto y por qué sin abrirlo, y decirle hasta cuándo vale
  // —el importe queda congelado al valor de cuota del día en que se generó—.
  it("paymentLinkEmail dice cuánto, por cuántas cuotas, hasta cuándo vale y cómo salir", () => {
    const r = paymentLinkEmail({ name: "Ana", count: 3, amount: 18000, url: "https://mpago.la/abc", expiresAt: EXPIRES });
    expect(r.subject).toContain("link para pagar");
    for (const body of [r.text, r.html]) {
      expect(body).toContain("Ana");
      expect(body).toContain("3 cuotas sociales");
      expect(body).toContain("$ 18.000,00");
      expect(body).toContain("https://mpago.la/abc");
      // El vencimiento es real (`expiration_date_to` en la preferencia): el
      // plazo sale de la misma constante que el cuerpo que se le manda a MP.
      expect(body).toContain(`${PAYMENT_LINK_TTL_HOURS} horas`);
      // Y el INSTANTE, no sólo el plazo: el operador puede generar el link hoy
      // y mandar el mail mañana, y ahí "72 horas" ya son 48. La pantalla del
      // panel muestra el mismo dato.
      expect(body).toContain("26/08/2026 a las 15:40");
      // La salida, porque el operador puede mandarlo el mismo día en que el
      // socio saldó en la sede.
      expect(body).toContain("Si ya pagaste");
    }
  });

  it("paymentLinkEmail usa el singular con una sola cuota y escapa el nombre", () => {
    expect(paymentLinkEmail({ name: "A", count: 1, amount: 6000, url: "https://mpago.la/x", expiresAt: EXPIRES }).text)
      .toContain("1 cuota social por $ 6.000,00");
    expect(paymentLinkEmail({ name: 'Ana & "Co"', count: 1, amount: 1, url: "https://mpago.la/x", expiresAt: EXPIRES }).html)
      .toContain("Ana &amp; &quot;Co&quot;");
  });

  it("el recordatorio dice el mes, el importe y qué pasa mañana", () => {
    const m = feeReminderEmail({ name: "Ana", period: "2026-09", amount: 6000, arrears: 0, debt: 0 });
    expect(m.subject).toContain("Vecinal Ciudadela");
    for (const body of [m.text, m.html]) {
      expect(body).toContain("Ana");
      expect(body).toContain("septiembre");
      expect(body).toContain("6.000");
      // No hay que asustar a quien está al día: si no arrastra nada, el correo
      // no habla de deuda.
      expect(body).not.toContain("atrasada");
    }
  });
  it("si arrastra deuda, la nombra con cuotas y monto a valor vigente", () => {
    const m = feeReminderEmail({ name: "Ana", period: "2026-09", amount: 6000, arrears: 3, debt: 18000 });
    for (const body of [m.text, m.html]) {
      expect(body).toContain("3");
      expect(body).toContain("18.000");
    }
  });
  // La segunda variante (enmienda del operador, 24/08/2026): el cron re-disparado
  // el 1° avisa por una cuota que ya venció, y "vence mañana" ahí es mentira.
  it("corrido después del vencimiento, el correo dice que la cuota venció y quedó impaga", () => {
    const m = feeReminderEmail({ name: "Ana", period: "2026-09", amount: 6000, arrears: 0, debt: 0, expired: true });
    expect(m.subject).toBe("Tu cuota de septiembre 2026 venció y quedó impaga — Vecinal Ciudadela");
    for (const body of [m.text, m.html]) {
      expect(body).toContain("venció y quedó impaga");
      expect(body).not.toContain("vence mañana");
      // Lo demás no cambia: el mes, el importe, cómo pagar y la salida.
      expect(body).toContain("septiembre");
      expect(body).toContain("6.000");
      expect(body).toContain("Si ya pagaste");
      expect(body).not.toContain("atrasada");
    }
  });
  it("la variante vencida arrastra la deuda anterior igual que la normal", () => {
    const m = feeReminderEmail({ name: "Ana", period: "2026-09", amount: 6000, arrears: 3, debt: 18000, expired: true });
    expect(m.text).toContain("venció y quedó impaga");
    expect(m.text).toContain("3 cuotas atrasadas");
    expect(m.text).toContain("18.000");
  });
  it("sin `expired` el correo es el de siempre: vence mañana", () => {
    const m = feeReminderEmail({ name: "Ana", period: "2026-09", amount: 6000, arrears: 0, debt: 0 });
    expect(m.subject).toBe("Tu cuota de septiembre 2026 vence mañana — Vecinal Ciudadela");
    for (const body of [m.text, m.html]) expect(body).toContain("vence mañana");
  });
  it("sin valor de cuota vigente no inventa un importe", () => {
    const m = feeReminderEmail({ name: "Ana", period: "2026-09", amount: null, arrears: 0, debt: null });
    expect(m.text).not.toContain("$");
    expect(m.text).toContain("septiembre");
  });

  it("el resumen sólo lista los renglones que tienen algo", () => {
    const m = boardDigestEmail({
      label: "14/09/2026", payments: [{ type: "cash", count: 2, total: 9000 }],
      paymentsCount: 2, paymentsTotal: 9000, applications: 0, inboxNew: 1,
      notificationsFailed: 0, cronFailures: [], webhookErrors: 0,
    });
    expect(m.subject).toContain("14/09/2026");
    expect(m.text).toContain("9.000");
    expect(m.text).toContain("sin conciliar");
    expect(m.text).not.toContain("Solicitudes de alta");
    // Agregados, nunca nombres ni direcciones.
    expect(m.text).not.toContain("@");
  });

  // El medio de pago se dice con EL mapa del proyecto, no con el valor crudo del
  // enum: la Comisión lee "Débito automático", igual que en la pantalla de
  // recibos y en el PDF.
  it("el resumen nombra los medios de pago como el resto del sistema", () => {
    const m = boardDigestEmail({
      label: "14/09/2026",
      payments: [{ type: "debit", count: 1, total: 6000 }, { type: "link", count: 1, total: 6000 }],
      paymentsCount: 2, paymentsTotal: 12000, applications: 0, inboxNew: 0,
      notificationsFailed: 0, cronFailures: [], webhookErrors: 0,
    });
    expect(m.text).toContain("Débito automático");
    expect(m.text).toContain("Link de pago");
    expect(m.text).not.toContain("debit");
  });

  it("las tareas automáticas con problemas se nombran por su job, sin el mensaje de error", () => {
    const m = boardDigestEmail({
      label: "14/09/2026", payments: [], paymentsCount: 0, paymentsTotal: 0,
      applications: 0, inboxNew: 0, notificationsFailed: 2,
      cronFailures: [{ job: "reconcile", runs: 4 }, { job: "reminder", runs: 1 }], webhookErrors: 3,
    });
    expect(m.text).toContain("Avisos por email que no salieron: 2");
    expect(m.text).toContain("Notificaciones de Mercado Pago con error: 3");
    // Dos jobs distintos: uno por entrada, cada uno con su cuenta y su plural.
    expect(m.text).toContain("Tareas automáticas con problemas: reconcile (4 corridas), reminder (1 corrida)");
    expect(m.text).not.toContain("Pagos registrados");
    // El HTML dice lo mismo que el texto: un cliente sin HTML no se pierde nada.
    for (const needle of ["Avisos por email", "reconcile (4 corridas), reminder (1 corrida)"]) {
      expect(m.html).toContain(needle);
    }
  });

  // El operador recibió un resumen real que decía "reconcile, reconcile,
  // reconcile, reconcile, reconcile, reconcile". `collect()` agrupa; la plantilla
  // redacta la cuenta y no vuelve a listar la corrida.
  it("seis corridas fallidas del mismo job son UN renglón con la cuenta", () => {
    const m = boardDigestEmail({
      label: "14/09/2026", payments: [], paymentsCount: 0, paymentsTotal: 0,
      applications: 0, inboxNew: 0, notificationsFailed: 0,
      cronFailures: [{ job: "reconcile", runs: 6 }], webhookErrors: 0,
    });
    expect(m.text).toContain("Tareas automáticas con problemas: reconcile (6 corridas)");
    // Una sola vez el nombre del job: el renglón no repite.
    expect(m.text.match(/reconcile/g)).toHaveLength(1);
  });

  it("una sola corrida fallida se dice en singular", () => {
    const m = boardDigestEmail({
      label: "14/09/2026", payments: [], paymentsCount: 0, paymentsTotal: 0,
      applications: 0, inboxNew: 0, notificationsFailed: 0,
      cronFailures: [{ job: "accrual", runs: 1 }], webhookErrors: 0,
    });
    expect(m.text).toContain("Tareas automáticas con problemas: accrual (1 corrida)");
    expect(m.text).not.toContain("1 corridas");
  });

  // El renglón cuenta lo que ENTRÓ sin conciliar, resuelto o no: la consulta no
  // filtra por estado. "Quedaron" mandaba a la Comisión a una bandeja que el
  // operador ya podía haber vaciado a la tarde.
  it("el renglón de la bandeja dice que los cobros ENTRARON sin conciliar", () => {
    const m = boardDigestEmail({
      label: "14/09/2026", payments: [], paymentsCount: 0, paymentsTotal: 0,
      applications: 0, inboxNew: 2, notificationsFailed: 0,
      cronFailures: [], webhookErrors: 0,
    });
    expect(m.text).toContain("Cobros que entraron sin conciliar: 2");
    expect(m.text).not.toContain("quedaron");
  });

  it("el aviso de rechazo no reclama nada y no muestra el código de MP", () => {
    const m = paymentRejectedEmail({ name: "Ana", amount: 6000, reason: rejectionReason("cc_rejected_card_disabled") });
    for (const body of [m.text, m.html]) {
      expect(body).toContain("Ana");
      expect(body).toContain("6.000");
      expect(body).toContain("tarjeta");
      expect(body).not.toContain("cc_rejected");
      expect(body).not.toContain("deuda");
    }
  });

  // El correo lo dispara TAMBIÉN un link de Checkout Pro rechazado, que no se
  // reintenta: prometer un reintento en indicativo sería mentirle al socio.
  it("el aviso de rechazo no promete un reintento que puede no existir", () => {
    const m = paymentRejectedEmail({ name: "Ana", amount: 6000, reason: rejectionReason(null) });
    expect(m.text).toContain("Si el cobro era tu débito automático");
    expect(m.text).toContain("pagar en la sede");
    // Y el genérico tampoco filtra el código crudo.
    expect(m.text).not.toContain("_");
  });

  // El reintento va ACOTADO —sin techo le decía al socio que podía no hacer
  // nada— pero el correo NO afirma qué hace MP después: cuántas veces reintenta
  // y si al final pausa o cancela la suscripción es algo que este proyecto no
  // midió. "Da de baja el débito y hay que volver a autorizarlo" cambiaba una
  // promesa por otra, y encima mandaba al socio a re-autorizar en un lugar que
  // no existe hasta el Módulo 5.
  it("el aviso de rechazo acota el reintento sin afirmar qué hace MP después", () => {
    const m = paymentRejectedEmail({ name: "Ana", amount: 6000, reason: rejectionReason(null) });
    for (const body of [m.text, m.html]) {
      expect(body).toContain("unas pocas veces");
      expect(body).toContain("no conviene esperar");
      expect(body).not.toContain("cuando el medio de pago esté disponible");
      // Nada sobre lo que no medimos, y ninguna acción sin destino.
      expect(body).not.toContain("da de baja el débito");
      expect(body).not.toContain("volver a autorizarlo");
    }
  });

  // La convocatoria del Art. 9° bis sale de una sola vez a toda la cohorte de
  // adherentes y abre un plazo de treinta días del que cuelga la condición de
  // socio. Tres cosas la hacen útil: el enlace al wizard, la fecha límite
  // ESCRITA (no "en 30 días", que obliga al vecino a contar desde una fecha que
  // no sabe) y la vía presencial, porque buena parte del padrón no usa la web.
  it("la convocatoria lleva el enlace al wizard, la fecha límite y la vía presencial", () => {
    const m = reregistrationCallEmail({ url: "https://x/reempadronate", firstEndsAt: EXPIRES });
    expect(m.subject).toContain("26/08/2026");
    for (const body of [m.text, m.html]) {
      expect(body).toContain("https://x/reempadronate");
      expect(body).toContain("26/08/2026");
      expect(body).toContain("Art. 9° bis");
      expect(body).toContain("sede vecinal");
      expect(body).toContain("no tiene ningún costo");
      // No saluda por nombre, y la plantilla ni siquiera lo recibe: el mensaje
      // es idéntico para los ciento y pico y se arma UNA vez.
      expect(body).not.toContain("Hola ");
    }
    expect(reregistrationCallEmail.length).toBe(1);
  });

  // Es la ÚLTIMA notificación antes de una baja estatutaria, así que el
  // apercibimiento con la cita del artículo tiene que estar: es lo que la hace
  // oponible. Y no puede afirmar que el socio no presentó nada: el correo va a
  // TODOS los que no tienen presentación aprobada, y ahí entran el observado (se
  // le registró la presentación y se le pidió corregir) y el rechazado (se le
  // registró y se le rechazó). Decirles que "no lo registramos" es un dato falso
  // en el aviso previo a la baja, y les regala el recurso del inc. d).
  it("el último plazo apercibe con el artículo y no afirma que el socio no presentó nada", () => {
    const m = reregistrationSecondEmail({ url: "https://x/reempadronate", secondEndsAt: EXPIRES });
    expect(m.subject).toContain("26/08/2026");
    for (const body of [m.text, m.html]) {
      expect(body).toContain("https://x/reempadronate");
      expect(body).toContain("26/08/2026");
      expect(body).toContain("apercibimiento de baja");
      expect(body).toContain("Art. 9° bis");
      expect(body).toContain("treinta días");
      // Verdadero para los cuatro casos que reciben este correo: el que no
      // presentó nada, el observado, el rechazado y el que retiró su
      // presentación.
      expect(body).toContain("aprobado");
      expect(body).not.toContain("no registramos");
    }
  });

  // La constancia es la PRUEBA del plazo: es lo que el socio puede mostrar si
  // alguna vez se discute si se presentó dentro de los treinta días. Por eso
  // lleva fecha Y hora, y por eso dice que hay que guardarla.
  it("la constancia lleva la fecha y hora del envío y el enlace de retorno", () => {
    const m = presentationReceivedEmail({
      url: "https://x/reempadronate/retomar/tok",
      submittedAt: EXPIRES,
    });
    for (const body of [m.text, m.html]) {
      expect(body).toContain("https://x/reempadronate/retomar/tok");
      expect(body).toContain("26/08/2026");
      expect(body).toContain("15:40");
      expect(body).toContain("constancia");
      // No nombra al socio, y la plantilla no puede recibir el nombre: el
      // enlace ya es el secreto, y un dedazo en la dirección no puede regalar
      // el nombre de quien se re-empadronó (Ley 25.326).
      expect(body).not.toContain("Hola ");
    }
    expect(presentationReceivedEmail.length).toBe(1);
  });

  // La observación es lo único que le dice al vecino qué corregir: el texto del
  // operador viaja TAL CUAL. Y tiene que decir que el plazo sigue corriendo,
  // que es la diferencia entre subsanar a tiempo y una baja.
  it("la observación lleva el pedido textual del operador y avisa que el plazo corre", () => {
    const m = presentationObservedEmail({
      url: "https://x/reempadronate/retomar/tok",
      observation: "La foto del dorso salió movida & no se lee el domicilio",
    });
    expect(m.text).toContain("La foto del dorso salió movida & no se lee el domicilio");
    // En el HTML el texto del operador se escapa como todo lo que entra desde
    // la base: un "&" suelto rompería el markup.
    expect(m.html).toContain("movida &amp; no se lee");
    for (const body of [m.text, m.html]) {
      expect(body).toContain("https://x/reempadronate/retomar/tok");
      expect(body).toContain("Art. 9° bis");
      expect(body).toContain("sigue corriendo");
    }
  });

  it("las plantillas del re-empadronamiento escapan la url en el html", () => {
    const url = "https://x/reempadronate?a=1&b=2";
    for (const m of [
      reregistrationCallEmail({ url, firstEndsAt: EXPIRES }),
      reregistrationSecondEmail({ url, secondEndsAt: EXPIRES }),
      presentationReceivedEmail({ url, submittedAt: EXPIRES }),
      presentationObservedEmail({ url, observation: "Falta el dorso" }),
    ]) {
      expect(m.html).toContain("a=1&amp;b=2");
      expect(m.html).not.toContain("a=1&b=2");
      // En el texto plano el enlace viaja crudo: ahí no hay markup que romper y
      // un `&amp;` sería un enlace que no funciona al copiarlo.
      expect(m.text).toContain(url);
    }
  });
});

describe("getTransport", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    vi.restoreAllMocks();
  });

  it("falls back to the console transport when Brevo envs are missing", async () => {
    for (const k of ["BREVO_SMTP_HOST", "BREVO_SMTP_USER", "BREVO_SMTP_KEY", "MAIL_FROM"]) {
      delete process.env[k];
    }
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await getTransport().send({
      to: "nobody@example.invalid",
      subject: "s",
      text: "t",
      html: "<p>t</p>",
    });
    expect(res.messageId).toBeNull();
    expect(log).toHaveBeenCalled();
  });

  it("el transporte de consola lista los adjuntos por nombre y tamaño, no por contenido", async () => {
    for (const k of ["BREVO_SMTP_HOST", "BREVO_SMTP_USER", "BREVO_SMTP_KEY", "MAIL_FROM", "EMAIL_ALLOWLIST"]) {
      delete process.env[k];
    }
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await getTransport().send({
      to: "a@b.com", subject: "s", text: "t", html: "<p>t</p>",
      attachments: [{ filename: "recibo-2026-00001.pdf", content: Buffer.from("%PDF-"), contentType: "application/pdf" }],
    });
    expect(log.mock.calls.flat().join("\n")).toContain("recibo-2026-00001.pdf (5 B)");
    log.mockRestore();
  });
});

describe("makeMailer", () => {
  it("sends through the transport and records a Notification", async () => {
    const sent: MailMessage[] = [];
    const created: unknown[] = [];
    const mailer = makeMailer({
      transport: { send: async (msg) => { sent.push(msg); return { messageId: "mid-1" }; } },
      db: { notification: { create: async ({ data }: { data: unknown }) => { created.push(data); return data; } } } as never,
    });
    await mailer.sendToMember({
      memberId: 5, to: "a@b.com", type: "email_verification",
      message: verificationEmail({ url: "https://x/v/t" }),
      summary: "verificación de email",
    });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("a@b.com");
    expect(created[0]).toMatchObject({
      memberId: 5, type: "email_verification", via: "email", status: "sent",
      brevoMessageId: "mid-1", payloadSummary: "verificación de email",
    });
  });

  // Si el SMTP falla, lo que NO se registra es un envío que nunca ocurrió: la
  // fila que queda es `failed` (registro del intento), nunca una `sent`.
  it("never records a `sent` Notification when the transport throws", async () => {
    const created: { status: string }[] = [];
    const mailer = makeMailer({
      transport: { send: async () => { throw new Error("smtp down"); } },
      db: {
        notification: {
          create: async ({ data }: { data: { status: string } }) => { created.push(data); return data; },
        },
      } as never,
    });
    await expect(
      mailer.sendToMember({
        memberId: 5, to: "a@b.com", type: "generic",
        message: passwordResetEmail({ url: "https://x/r/t" }),
        summary: "restablecer contraseña",
      }),
    ).rejects.toThrow("smtp down");
    expect(created.map((c) => c.status)).toEqual(["failed"]);
  });
});

describe("makeMailer: el fallo deja rastro", () => {
  const message = { subject: "s", text: "t", html: "<p>t</p>" };

  function mailerWith(sendImpl: () => Promise<{ messageId: string | null }>) {
    const create = vi.fn(async (args: { data: Record<string, unknown> }) => args.data);
    const mailer = makeMailer({ transport: { send: sendImpl }, db: { notification: { create } } as never });
    return { mailer, create };
  }

  it("el envío exitoso sigue registrando `sent` (y ahora también el período)", async () => {
    const { mailer, create } = mailerWith(async () => ({ messageId: "brevo-1" }));
    await mailer.sendToMember({ memberId: 4, to: "a@b.com", type: "fee_reminder", message, summary: "s", period: "2026-09" });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ memberId: 4, status: "sent", brevoMessageId: "brevo-1", period: "2026-09" }),
    });
  });

  it("un SMTP caído deja una fila `failed` con el CÓDIGO y vuelve a lanzar", async () => {
    const { mailer, create } = mailerWith(async () => {
      throw Object.assign(new Error("connect ECONNREFUSED 1.2.3.4:587 a@b.com"), { code: "ECONNREFUSED" });
    });
    await expect(mailer.sendToMember({ memberId: 4, to: "a@b.com", type: "receipt", message, summary: "recibo 0001" }))
      .rejects.toThrow();
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ memberId: 4, type: "receipt", status: "failed", error: "ECONNREFUSED", brevoMessageId: null }),
    });
    // El error de nodemailer trae la dirección en claro: al `error` va sólo el
    // código, nunca el mensaje (docs/08, Ley 25.326).
    const written = create.mock.calls[0][0].data as { error: string };
    expect(written.error).not.toContain("@");
  });

  it("un bloqueo de EMAIL_ALLOWLIST NO es un fallo: no escribe fila (es el entorno funcionando)", async () => {
    const { mailer, create } = mailerWith(async () => {
      throw Object.assign(new Error("Envíos restringidos"), { code: "EMAIL_ALLOWLIST" });
    });
    await expect(mailer.sendToMember({ memberId: 4, to: "x@y.com", type: "receipt", message, summary: "s" }))
      .rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });

  it("si la propia fila `failed` no se puede escribir, gana el error del envío", async () => {
    const create = vi.fn(async () => { throw new Error("db down"); });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const mailer = makeMailer({
      transport: { send: async () => { throw Object.assign(new Error("smtp"), { code: "EAUTH" }); } },
      db: { notification: { create } } as never,
    });
    await expect(mailer.sendToMember({ memberId: 1, to: "a@b.com", type: "generic", message, summary: "s" }))
      .rejects.toThrow(/smtp/);
    // Y el log del fallo del registro tampoco nombra la dirección.
    expect(err.mock.calls.flat().join(" ")).not.toContain("@");
    err.mockRestore();
  });

  // COSTURA: los dos tests de arriba usan un transporte de mentira que lanza el
  // código a mano, así que ninguno prueba que el mailer y la allowlist REAL se
  // entiendan. Si alguien envuelve o mueve ese error, los dos siguen en verde y
  // en producción —donde la allowlist bloquea a casi todos— una sola corrida de
  // devengo dejaría ~160 filas `failed` y /admin/salud nacería inservible.
  it("costura: el mailer con el transporte REAL de la allowlist no escribe fila al bloquear", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const inner = vi.fn(async () => ({ messageId: "no-debería-llegar" }));
    const create = vi.fn(async (args: { data: Record<string, unknown> }) => args.data);
    const mailer = makeMailer({
      transport: makeAllowlistTransport({ send: inner }, new Set(["permitido@b.com"])),
      db: { notification: { create } } as never,
    });

    await expect(
      mailer.sendToMember({ memberId: 4, to: "bloqueado@y.com", type: "fee_reminder", message, summary: "s" }),
    ).rejects.toThrow(/EMAIL_ALLOWLIST/);
    expect(inner).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    // Y el aviso del bloqueo no nombra la casilla (docs/08, Ley 25.326).
    expect(warn.mock.calls.flat().join(" ")).not.toContain("@");

    // La otra mitad de la costura: una dirección listada sí pasa y sí acredita.
    await mailer.sendToMember({ memberId: 4, to: "Permitido@B.com", type: "fee_reminder", message, summary: "s" });
    expect(inner).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ status: "sent" }) });
    warn.mockRestore();
  });

  it("un aviso a una solicitud también deja su `failed` colgando de la solicitud", async () => {
    const { mailer, create } = mailerWith(async () => { throw Object.assign(new Error("x"), { code: "EENVELOPE" }); });
    await expect(mailer.sendToApplication({ applicationId: 9, to: "a@b.com", type: "application_result", message, summary: "s" }))
      .rejects.toThrow();
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ applicationId: 9, memberId: null, status: "failed", error: "EENVELOPE" }),
    });
  });
});
