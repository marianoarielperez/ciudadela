// Higiene de logs (docs/08, Ley 25.326): lo que se escribe en el log de PM2 no
// está cubierto por los cuidados del resto del proyecto —no se rota con las
// mismas reglas, lo lee cualquiera con acceso al VPS— así que un mensaje de
// error que arrastre la dirección de un vecino no puede salir tal cual.
//
// Vive en un módulo propio y NO en `mp/webhook-processor.ts`, que es de donde
// salió: la ruta del cron de solicitudes necesita el mismo cuidado, y para
// importar un helper de strings terminaba importando el procesador de webhooks
// entero —con su singleton, que evalúa `@/lib/prisma` y el gateway de MP— al
// arrancar. Acá no hay dependencias.

// Deliberadamente laxa con lo que acepta como "dirección": enmascarar de más en
// un log no le cuesta nada a nadie, y de menos es un dato personal en claro.
const EMAIL = /[^\s<>@,;]+@[^\s<>@,;]+/g;

/** Un texto cualquiera con las direcciones de correo tapadas. Es EL criterio de
 *  enmascarado del proyecto: quien tenga que higienizar algo que no sea el
 *  `message` de un error (el cuerpo de un error de Mercado Pago, por ejemplo)
 *  reusa esto en vez de escribir su propia expresión. */
export function maskEmails(raw: string): string {
  return raw.replace(EMAIL, "[email]");
}

/** El mensaje de un error, listo para el log: sin direcciones de correo y
 *  acotado. Los errores de nodemailer traen `envelope`, `rejected` y el
 *  `response` del SMTP (o sea el email del vecino en claro) dentro del propio
 *  `message`; los de Prisma pueden traer el valor de una columna.
 *
 *  OJO con los errores de Mercado Pago: el SDK NO lanza `Error`, así que acá
 *  caen en `String(e)` y salen como "[object Object]". Para esos está
 *  `describeMpError` en `@/lib/mp/error-log`. */
export function safeMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  return maskEmails(raw).slice(0, 200);
}
