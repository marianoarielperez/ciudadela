"use server";
// Pedido de recupero de contraseña. Ruta PÚBLICA y ANÓNIMA: cualquiera puede
// escribir cualquier dirección, así que la regla que manda sobre todo lo demás
// es que la respuesta NO puede decir si esa dirección tiene cuenta.
//
// Eso se sostiene en tres frentes:
//  1. El texto: una sola respuesta (`DONE`) para la cuenta que existe, la que no
//     existe y la que está deshabilitada.
//  2. El tiempo: el trabajo contra la base y el envío SMTP van dentro de
//     `after()`, o sea después de mandar la respuesta. Sin eso, el pedido de una
//     dirección registrada tarda lo que tarda Brevo (cientos de ms) y el de una
//     inexistente vuelve al instante: la diferencia es medible desde afuera y
//     convierte el formulario en un verificador de padrón.
//  3. Los cupos: se consultan y se registran ANTES de mirar si la cuenta existe,
//     con la dirección normalizada, para que el intento número cuatro conteste
//     igual en los dos casos.
import { headers } from "next/headers";
import { after } from "next/server";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { passwordReset } from "@/lib/auth/password-reset";
import { passwordResetEmailLimiter, passwordResetIpLimiter } from "@/lib/auth/rate-limiter";
import { passwordResetEmail } from "@/lib/email/templates";
import { getTransport } from "@/lib/email/transport";
import { parseForm } from "@/lib/forms";
import { hashToken } from "@/lib/tokens";
import { prisma } from "@/lib/prisma";

export type RecoverState = { done?: boolean; error?: string };

// Sin `export`: en un módulo "use server" todo lo exportado tiene que ser una
// función async (lo exportado es un endpoint), y una constante rompe el build.
const schema = z.object({ email: z.email("Escribí un email válido.") });
const DONE: RecoverState = { done: true };
const TOO_MANY = "Ya pediste el enlace varias veces. Esperá un rato antes de reintentar.";

/** Todo lo que toca la cuenta corre acá, después de responder. Nada de lo que
 *  pase adentro puede cambiar lo que ve el visitante: ni el resultado, ni el
 *  tiempo. Los errores se registran y se comen. */
async function deliver(email: string, ip: string): Promise<void> {
  // Declarado afuera del try: si la emisión llegó a ocurrir y después se cayó
  // algo, el catch tiene que poder quemar ese enlace.
  let issued: { userId: number; token: string } | null = null;
  try {
    // `request` devuelve null tanto si la dirección no está registrada como si
    // la cuenta está deshabilitada (baja del socio): desde acá no se distinguen.
    issued = await passwordReset.request(email);
    if (!issued) return;

    const base = process.env.AUTH_URL ?? "http://localhost:3000";
    const url = `${base}/ingresar/restablecer/${issued.token}`;

    // `getTransport()` crudo y no `mailer.sendToMember`: éste no es un acto de
    // notificación del Art. 5° quater —no lo decide la vecinal, lo dispara quien
    // olvidó su contraseña, y la cuenta puede ser la de un administrador sin
    // ficha—, así que no corresponde acreditarlo como `Notification`. El rastro
    // del hecho es el asiento de auditoría de abajo. (`NotificationType`
    // tampoco tiene un valor para esto; agregarlo sería inventar un acto
    // estatutario que no existe.)
    await getTransport().send({ to: email, ...passwordResetEmail({ url }) });
  } catch (e) {
    // El try empieza en el lookup y no en el envío a propósito: si la base falla
    // al buscar la cuenta o al emitir, el rechazo caía dentro de `after()` sin
    // asiento y —lo que se nota— sin devolver el cupo, o sea que el socio perdía
    // uno de sus pedidos por hora por una falla de infraestructura.
    if (issued) {
      // El enlace ya emitido se quema: un recupero vivo que nadie recibió es
      // superficie de ataque sin ninguna contrapartida (mismo criterio que el
      // envío del panel).
      await prisma.actionToken.deleteMany({ where: { tokenHash: hashToken(issued.token) } });
    }
    // Y el cupo reservado se devuelve: no salió ningún correo ni quedó ningún
    // enlace vivo, así que no hay nada que racionar.
    passwordResetIpLimiter.refund(ip);
    passwordResetEmailLimiter.refund(email);
    // Ni al log ni a la auditoría va el objeto de error: los errores de
    // nodemailer traen `envelope` y el `response` del SMTP, o sea la dirección
    // en claro, y el log de PM2 no está cubierto por los cuidados de docs/08
    // (Ley 25.326). Con el id de la cuenta y el código alcanza para diagnosticar.
    const code = typeof e === "object" && e !== null && "code" in e ? String(e.code) : "unknown";
    console.error("[recuperar] falló el pedido de recupero de la cuenta", issued?.userId ?? "?", "code:", code);
    // Sin cuenta emitida no hay a quién atribuirle el asiento —y meter la
    // dirección tipeada sería guardar el dato de un tercero (Ley 25.326)—: la
    // falla de infraestructura queda en el log del proceso, no en `audit_log`.
    if (issued) {
      await audit({
        userId: issued.userId, action: "password_reset_send_failed", entity: "user",
        entityId: issued.userId, detail: { code }, ip,
      });
    }
    return;
  }

  // El asiento va con `userId`, no con la dirección: identificar la cuenta por
  // su id evita meter el email en el log (Ley 25.326) y es lo que hace falta
  // para reconstruir quién pidió qué.
  await audit({
    userId: issued.userId, action: "password_reset_requested", entity: "user",
    entityId: issued.userId, ip,
  });
}

export async function recoverAction(_prev: RecoverState, formData: FormData): Promise<RecoverState> {
  // La validación de formato va primero y NO gasta cupo: un typo no puede dejar
  // a nadie sin reintentos. (Y el formulario conserva lo tipeado: el campo es
  // controlado, ver recover-form.tsx.)
  const parsed = parseForm(schema, formData);
  if (!parsed.ok) return { error: parsed.error };
  // El login busca la cuenta en minúsculas: normalizamos igual acá, y con la
  // MISMA clave se cuentan los intentos. Si el limitador contara el texto crudo,
  // alternar mayúsculas alcanzaría para saltarse el techo por casilla.
  const email = parsed.data.email.toLowerCase().trim();

  // Sólo X-Real-IP, como el login: el resto de las cabeceras de IP las puede
  // fijar el cliente si le pega directo al origen, y rotándolas se regalaría un
  // presupuesto nuevo del limitador en cada intento.
  const ip = (await headers()).get("x-real-ip") ?? "unknown";

  // Reserva atómica: se consultan los dos cupos y recién después se registran en
  // los dos. Con `check` a secas, el primero le cobraría el intento a su clave
  // aunque el segundo terminara rechazando.
  if (!passwordResetIpLimiter.allows(ip)) {
    // Sin la dirección en el detalle: acá lo que se está frenando es un origen,
    // y el texto que tipeó un anónimo es de un tercero que no pidió nada (Ley
    // 25.326). El caso que sí conviene poder investigar —una casilla concreta
    // bajo martilleo— se asienta abajo, con la dirección.
    await audit({ action: "password_reset_blocked", detail: { scope: "ip" }, ip });
    return { error: TOO_MANY };
  }
  if (!passwordResetEmailLimiter.allows(email)) {
    await audit({ action: "password_reset_blocked", detail: { scope: "email", email }, ip });
    return { error: TOO_MANY };
  }
  passwordResetIpLimiter.record(ip);
  passwordResetEmailLimiter.record(email);

  after(() => deliver(email, ip));
  return DONE; // idéntico exista o no la cuenta
}
