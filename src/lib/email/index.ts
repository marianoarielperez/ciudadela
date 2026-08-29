// Mailer: sends and records the statutory Notification row in one call.
// El estatuto (Art. 5° quater) le da carácter fehaciente al domicilio
// electrónico: cada envío tiene que quedar acreditado en la base.
//
// Desde la 4C también queda registrado el INTENTO que no salió: una fila
// `failed`. No es una acreditación fehaciente —el correo no llegó a salir— sino
// el rastro del hueco, que hasta ahora moría repartido en diez `console.error`
// dentro de un log de PM2 que rota a los 7 días. Las pantallas que listan
// notificaciones tienen que distinguir las dos cosas.
import type { NotificationType, PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { ALLOWLIST_BLOCK_CODE, getTransport, type MailMessage, type MailTransport } from "./transport";

type MailerDeps = { transport: MailTransport; db: Pick<PrismaClient, "notification"> };

/** Solo el CÓDIGO del fallo: el error de nodemailer trae `envelope`, `rejected`
 *  y el `response` del SMTP —o sea la dirección del vecino en claro— y la
 *  columna `error` es la que va a mostrar /admin/salud (docs/08, Ley 25.326).
 *
 *  Exportada porque hay call-sites que atrapan un fallo de envío y NO pasan por
 *  `send` (la red de la invitación, `@/lib/members/invitation-email`): con una
 *  copia local, la que loguea puede volcar el error entero el día que alguien la
 *  toque. Es la regla de siempre —compartir la función, no copiarla— aplicada a
 *  una función cuyo trabajo es justamente no filtrar una dirección. */
export function failureCode(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  if (typeof code === "string" && code !== "") return code.slice(0, 200);
  const name = (e as { name?: unknown } | null)?.name;
  return typeof name === "string" && name !== "" ? name.slice(0, 200) : "unknown";
}

// El bloqueo del entorno de prueba NO es un fallo de envío: es la guarda
// funcionando (`transport.ts`). Si escribiera `failed`, el piloto con
// `EMAIL_ALLOWLIST` puesta llenaría la pantalla de salud de rojo por diseño.
// El código se IMPORTA de `transport.ts` —una sola fuente del literal— y un
// test de costura arma el mailer con el transporte real de la allowlist.

export function makeMailer(deps: MailerDeps) {
  async function send(input: {
    memberId: number | null;
    applicationId: number | null;
    to: string;
    type: NotificationType;
    message: Omit<MailMessage, "to">;
    summary: string;
    period?: string | null;
  }): Promise<{ messageId: string | null }> {
    const row = {
      memberId: input.memberId,
      applicationId: input.applicationId,
      type: input.type,
      via: "email" as const,
      payloadSummary: input.summary,
      period: input.period ?? null,
    };
    let messageId: string | null;
    try {
      ({ messageId } = await deps.transport.send({ to: input.to, ...input.message }));
    } catch (e) {
      // Hasta la 4C, "envío fallido" era "no hay fila": la escritura estaba
      // DESPUÉS del envío para no acreditar como fehaciente (Art. 5° quater) un
      // correo que nunca salió. La fila `failed` no invierte ese argumento: es el
      // registro de un INTENTO, no una acreditación —la distinción vive en el
      // comentario del modelo y en la pantalla, que las separa—. Lo que no se
      // podía seguir sosteniendo es que el hueco no quedara en ningún lado: hoy
      // el rastro muere en el log de PM2, que rota a los 7 días.
      if (failureCode(e) !== ALLOWLIST_BLOCK_CODE) {
        try {
          await deps.db.notification.create({
            data: { ...row, status: "failed", brevoMessageId: null, error: failureCode(e) },
          });
        } catch (err) {
          // Si la base también está caída, el error que tiene que llegar al
          // llamador es el del ENVÍO, no el del registro del envío. `try/catch`
          // y no `.catch()`: así el fallback también cubre un `create` que no
          // devuelve una promesa (los dobles de los tests), en vez de tapar el
          // error real con un TypeError.
          console.error("[mail] no se pudo registrar la notificación fallida", failureCode(err));
        }
      }
      throw e;
    }
    await deps.db.notification.create({
      data: { ...row, status: "sent", brevoMessageId: messageId },
    });
    return { messageId };
  }
  return {
    sendToMember(input: {
      memberId: number | null;
      to: string;
      type: NotificationType;
      message: Omit<MailMessage, "to">;
      summary: string;
      /** "YYYY-MM" cuando el aviso se refiere a un período (la dedupe del
       *  recordatorio de vencimiento la consulta contra esta columna). */
      period?: string | null;
    }) {
      return send({ ...input, applicationId: null });
    },
    // El destinatario todavía no es socio, pero el envío queda acreditado
    // igual (Art. 5° quater): la Notification cuelga de la solicitud.
    sendToApplication(input: {
      applicationId: number;
      to: string;
      type: NotificationType;
      message: Omit<MailMessage, "to">;
      summary: string;
      period?: string | null;
    }) {
      return send({ ...input, memberId: null });
    },
  };
}

export const mailer = makeMailer({ transport: getTransport(), db: prisma });
