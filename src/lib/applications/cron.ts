// Mantenimiento diario de solicitudes (spec §7): recordatorio a los 3 días de
// `pending_payment` (una sola vez) y expiración a los 7 de `started` /
// `pending_payment`. La expiración cancela la suscripción best-effort: si MP
// falla queda contada en `errors` y la conciliación del M4 la levanta.
import type { ApplicationStatus, PrismaClient } from "@/generated/prisma/client";
import { applicationService } from "@/lib/applications/service";
import { mailer } from "@/lib/email";
import { paymentReminderEmail } from "@/lib/email/templates";
import { mpErrorLog } from "@/lib/mp/error-log";
import { mpGateway, type MpGateway } from "@/lib/mp/gateway";
import { prisma } from "@/lib/prisma";

export const REMINDER_AFTER_DAYS = 3;
export const EXPIRE_AFTER_DAYS = 7;
const DAY_MS = 86_400_000;

// Subconjunto de `LIVE_APPLICATION_STATUSES`: sólo vencen los estados donde la
// pelota la tiene el vecino. `approved_pending_minute` y `pending_board` están
// esperando a la Comisión Directiva, y no se le puede caer al vecino una
// solicitud por una demora que no es suya.
const EXPIRABLE_STATUSES: ApplicationStatus[] = ["started", "pending_payment"];

// Los errores de nodemailer traen `envelope` y el `response` del SMTP, o sea la
// dirección en claro, y el log de PM2 no está cubierto por los cuidados de
// docs/08 (Ley 25.326). Al log va sólo el código.
function codeOf(e: unknown): string {
  return typeof e === "object" && e !== null && "code" in e ? String((e as { code: unknown }).code) : "unknown";
}

type Deps = {
  db: Pick<PrismaClient, "application" | "mpSubscription">;
  gateway: Pick<MpGateway, "cancelPreapproval">;
  mailer: Pick<typeof mailer, "sendToApplication">;
  tokens?: Pick<typeof applicationService, "mintResumeToken" | "commitResumeToken">;
  baseUrl: string;
  now?: () => Date;
};

export type ApplicationsCronResult = { reminded: number; expired: number; errors: number };

/** Fallo de una CONSULTA ENTERA (los fallos por solicitud se cuentan en
 *  `errors` y no llegan acá). Arrastra lo que la corrida alcanzó a hacer: si el
 *  paso 2 explota, el paso 1 ya mandó recordatorios reales y esa corrida tiene
 *  que quedar asentada igual —el asiento es el único registro consultable de
 *  que el cron corrió y qué hizo. */
export class ApplicationsCronFailure extends Error {
  readonly partial: ApplicationsCronResult;
  /** El error original, tal cual: el log de la ruta lo enmascara y lo escribe.
   *  Sin esto, "la base se cayó" se perdería detrás de un mensaje genérico. */
  readonly reason: unknown;
  constructor(partial: ApplicationsCronResult, reason: unknown) {
    super("la corrida de solicitudes falló entera");
    this.name = "ApplicationsCronFailure";
    this.partial = partial;
    this.reason = reason;
  }
}

/** Lo que la corrida alcanzó a hacer antes de fallar, o `null` si el error no
 *  viene del cron (y entonces no hay nada que asentar). */
export function cronPartial(e: unknown): ApplicationsCronResult | null {
  return e instanceof ApplicationsCronFailure ? e.partial : null;
}

export function makeApplicationsCron(deps: Deps) {
  const now = deps.now ?? (() => new Date());
  const tokens = deps.tokens ?? applicationService;

  return {
    async run(): Promise<ApplicationsCronResult> {
      let reminded = 0;
      let expired = 0;
      let errors = 0;
      const t = now();

      const reminderCutoff = new Date(t.getTime() - REMINDER_AFTER_DAYS * DAY_MS);
      const expiryCutoff = new Date(t.getTime() - EXPIRE_AFTER_DAYS * DAY_MS);

      try {

        // ── 1. Recordatorio (una sola vez por solicitud) ──────────────────────
        // El filtro `remindedAt: null` ES la garantía del "una sola vez": el
        // sello de abajo saca la solicitud de esta consulta para siempre.
        //
        // La ventana es CERRADA por arriba: `[3 días, 7 días)`. Sin el `gt`, una
        // solicitud de 9 días sin recordar —que las hay: las anteriores a que
        // este cron existiera, o cualquier día que el crontab no corra— recibiría
        // el mail "retomá y completá el pago" y sería expirada por el paso 2 unos
        // milisegundos después, en la MISMA corrida. Verificado en local antes de
        // agregar el `gt`.
        const toRemind = await deps.db.application.findMany({
          where: {
            status: "pending_payment",
            remindedAt: null,
            createdAt: { lte: reminderCutoff, gt: expiryCutoff },
          },
          // Sólo lo que hace falta: el resto de la ficha son datos personales que
          // no tienen por qué pasar por el proceso del cron.
          select: { id: true, email: true },
        });

        for (const app of toRemind) {
          // El correo YA salió o todavía no: son dos incidentes distintos y el
          // log tiene que decir cuál. Si falla el sellado, el vecino recibió un
          // enlace que la base nunca guardó (le sirve el anterior, que sigue
          // vivo) y mañana le va a llegar otro recordatorio.
          let sent = false;
          try {
            // El cron no conoce el token crudo (la base guarda sólo el sha256),
            // así que el enlace del recordatorio obliga a rotarlo. El costo es
            // que una pestaña vieja del vecino queda inválida — aceptable a los
            // 3 días de inactividad, y este mismo email le da el enlace nuevo.
            //
            // ACUÑAR → ENVIAR → PERSISTIR, nunca al revés (mismo criterio que el
            // reenvío del enlace en `asociate/actions.ts`): si se persistiera
            // primero y el SMTP fallara, le habríamos matado el enlace que YA
            // tenía sin poder darle uno nuevo. Acuñar no toca la base; el hash se
            // hace efectivo recién cuando el correo salió.
            const { raw, hash } = tokens.mintResumeToken();
            await deps.mailer.sendToApplication({
              applicationId: app.id,
              to: app.email,
              type: "fee_reminder",
              message: paymentReminderEmail({ url: `${deps.baseUrl}/asociate/retomar/${raw}` }),
              summary: "recordatorio de pago pendiente",
            });
            sent = true;
            // El enlace primero, el sello después: si el proceso muere entre las
            // dos escrituras, mañana se manda un recordatorio de más (molesto,
            // reversible). Al revés quedaría un enlace muerto y sellado, que no
            // se recupera nunca.
            await tokens.commitResumeToken(app.id, hash);
            await deps.db.application.update({ where: { id: app.id }, data: { remindedAt: t } });
            reminded++;
          } catch (e) {
            errors++;
            console.error(
              sent
                ? "[cron] el recordatorio de pago SÍ salió, pero no quedó sellado (enlace nuevo sin guardar y/o se repetirá mañana)"
                : "[cron] falló el recordatorio de pago",
              app.id, "code:", codeOf(e),
            );
          }
        }

        // ── 2. Expiración ─────────────────────────────────────────────────────
        const toExpire = await deps.db.application.findMany({
          where: {
            status: { in: EXPIRABLE_STATUSES },
            createdAt: { lte: expiryCutoff },
          },
          select: { id: true, preapprovalId: true },
        });

        for (const app of toExpire) {
          // UPDATE condicional por estado: entre el `findMany` y esta escritura
          // puede haber entrado el webhook del primer pago. Si lo hizo, `count`
          // vuelve 0 y gana el webhook — no se expira una solicitud aprobada.
          const { count } = await deps.db.application.updateMany({
            where: { id: app.id, status: { in: EXPIRABLE_STATUSES } },
            data: { status: "expired" },
          });
          if (count === 0) continue;
          expired++;

          if (!app.preapprovalId) continue;
          // Best-effort: la expiración local ya está hecha y NO se revierte
          // porque MP no conteste. Queda contada en `errors` y la conciliación
          // del M4 encuentra la suscripción huérfana.
          try {
            await deps.gateway.cancelPreapproval(app.preapprovalId);
            await deps.db.mpSubscription.updateMany({
              where: { preapprovalId: app.preapprovalId },
              data: { status: "cancelled", lastSyncAt: t },
            });
          } catch (e) {
            errors++;
            // `codeOf` no sirve para MP: el SDK lanza el cuerpo de la
            // respuesta, un objeto plano sin `.code` (ver `mp/error-log.ts`).
            console.error(
              "[cron] falló la cancelación en MP al expirar —",
              mpErrorLog("cancelPreapproval", {
                applicationId: app.id, preapprovalId: app.preapprovalId,
              }, e),
            );
          }
        }
      } catch (e) {
        // Se cayó una consulta entera. El paso 1 pudo haber mandado
        // recordatorios REALES antes de que el paso 2 explotara: el error se
        // propaga (la ruta contesta 500) pero se lleva puesto lo que la corrida
        // alcanzó a hacer, para que el asiento no se pierda.
        throw new ApplicationsCronFailure({ reminded, expired, errors }, e);
      }

      return { reminded, expired, errors };
    },
  };
}

export const applicationsCron = makeApplicationsCron({
  db: prisma,
  gateway: mpGateway,
  mailer,
  baseUrl: process.env.AUTH_URL ?? "http://localhost:3000",
});
