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

/** El mensaje de un error, listo para el log: sin direcciones de correo y
 *  acotado. Los errores de nodemailer traen `envelope`, `rejected` y el
 *  `response` del SMTP (o sea el email del vecino en claro) dentro del propio
 *  `message`; los de Prisma pueden traer el valor de una columna. */
export function safeMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  return raw.replace(/[^\s<>@,;]+@[^\s<>@,;]+/g, "[email]").slice(0, 200);
}
