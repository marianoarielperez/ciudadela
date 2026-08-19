// Los dos avisos que hacen que la mudanza de la dirección de INGRESO de un socio
// deje de ser silenciosa.
//
// El problema que resuelve: desde que `members/write.ts:syncAccountEmail` le
// lleva a la cuenta la dirección nueva de la ficha, editar el email de un socio
// que ya tiene cuenta le mueve el NOMBRE DE USUARIO —`verifyCredentials` busca
// la cuenta por `User.email`—. Que el acceso se mude enseguida es la decisión de
// producto (dejar la cuenta apuntando a una casilla que el padrón ya no le
// reconoce al socio es peor: quien la controle se emite un recupero cuando
// quiera). Lo que no puede pasar es que se mude sin que nadie se entere:
//
//  1. A la dirección ANTERIOR le sale un aviso de que perdió el acceso, con a
//     dónde reclamar. Va por `getTransport()` crudo, SIN `Notification`: esa
//     casilla ya no es el domicilio electrónico del socio, así que acreditar ahí
//     una notificación fehaciente (Art. 5° quater) sería exactamente al revés de
//     lo que el estatuto quiere; y el hecho no es un acto societario sino una
//     alerta de seguridad. El rastro es el asiento de auditoría del llamador.
//     Mismo criterio que el correo de recupero de contraseña.
//  2. A la dirección NUEVA le sale una verificación, para que el socio confirme
//     que la casilla es suya. Ésa SÍ va por `mailer.sendToMember` con
//     `type: "email_verification"`: es el domicilio electrónico declarado y el
//     mismo acto que ya acredita `sendVerificationAction`, con el mismo tipo. No
//     hay dos ledgers distintos para el mismo hecho.
//
// Sobre la supuesta contradicción con `verificationTarget`: no la hay. Esa
// función NO se niega a verificar una ficha con cuenta —lo que niega es
// REINVITARLA a crear la contraseña (`password_invitation`), y sólo cuando el
// email ya está verificado—. Con la dirección recién cambiada el `emailStatus`
// es `declared` (lo pone `buildPatch`), así que devuelve `email_verification`, y
// el canje de ese enlace es inofensivo para una cuenta ya creada:
// `memberAccess.verifyEmail` marca la dirección como verificada y corta antes de
// emitir ninguna invitación cuando `member.userId` existe. Por eso acá se pasa
// por `verificationTarget` en vez de emitir a mano: una sola función decide qué
// correo le corresponde al socio, y si algún día deja de corresponder, este
// camino se cierra solo.
import type { Member, PrismaClient } from "@/generated/prisma/client";
import { verificationActorLimiter, verificationMemberLimiter } from "@/lib/auth/rate-limiter";
import { mailer as defaultMailer } from "@/lib/email";
import { loginEmailMovedNotice, loginEmailVerification } from "@/lib/email/templates";
import { getTransport, type MailTransport } from "@/lib/email/transport";
import { verificationTarget } from "@/lib/members/card-edit";
import { prisma } from "@/lib/prisma";
import { hashToken, makeTokens } from "@/lib/tokens";

/** A cuál de las dos casillas le falló el envío. Es lo único que va al asiento
 *  de auditoría junto al código del error: nunca una dirección. */
export type NoticeTarget = "previous" | "current";

export type AccountEmailNoticeOutcome = {
  /** Salió el aviso a la casilla que perdió el acceso. */
  previousNotified: boolean;
  /** Salió la verificación a la casilla nueva. */
  verificationSent: boolean;
  /** No salió ninguno de los dos porque se acabó el cupo de correos del socio
   *  (o del operador) en esta hora. */
  throttled: boolean;
  failures: Array<{ target: NoticeTarget; code: string }>;
};

/** Avisos para el OPERADOR cuando el cambio se guardó pero el correo no salió.
 *
 *  Los cuatro empiezan con "Se guardó el cambio" a propósito: la edición ya
 *  commiteó y el socio YA ingresa con la dirección nueva. Ninguna de estas
 *  fallas la revierte —ver `announce`—, así que el operador tiene que salir
 *  sabiendo que el cambio está hecho y qué le queda por hacer a mano. */
export const ACCOUNT_EMAIL_NOTICE_WARNINGS = {
  throttled:
    "Se guardó el cambio, pero no salió ningún correo: ya se le enviaron varios avisos a este socio " +
    "en la última hora. Avisale por otro medio que a partir de ahora ingresa al portal con la " +
    "dirección nueva.",
  both:
    "Se guardó el cambio, pero no se pudo enviar ninguno de los dos correos: ni el aviso a la " +
    "dirección anterior ni la verificación a la nueva. Revisá que la dirección nueva esté bien " +
    "escrita y avisale al socio por otro medio que ahora ingresa con ella.",
  previous:
    "Se guardó el cambio y le mandamos la verificación a la dirección nueva, pero no se pudo " +
    "entregar el aviso a la dirección anterior. Es lo esperable si el socio perdió esa casilla; " +
    "si no es el caso, avisale por otro medio.",
  current:
    "Se guardó el cambio y avisamos a la dirección anterior, pero no se pudo enviar la " +
    "verificación a la dirección nueva. Revisá que esté bien escrita: el socio ya ingresa con ella.",
} as const;

/** El texto que le corresponde al operador, o `null` si los dos correos salieron
 *  y no hay nada que contarle (el "Guardado ✓" alcanza). */
export function accountEmailNoticeWarning(o: AccountEmailNoticeOutcome): string | null {
  if (o.throttled) return ACCOUNT_EMAIL_NOTICE_WARNINGS.throttled;
  if (!o.previousNotified && !o.verificationSent) return ACCOUNT_EMAIL_NOTICE_WARNINGS.both;
  if (!o.previousNotified) return ACCOUNT_EMAIL_NOTICE_WARNINGS.previous;
  if (!o.verificationSent) return ACCOUNT_EMAIL_NOTICE_WARNINGS.current;
  return null;
}

// Los errores de nodemailer traen `envelope`, `rejected` y el `response` del
// SMTP, o sea la dirección del socio en claro, y el log de PM2 no está cubierto
// por los cuidados de docs/08 (Ley 25.326). Del error sólo se conserva el código.
function codeOf(e: unknown): string {
  return typeof e === "object" && e !== null && "code" in e ? String(e.code) : "unknown";
}

type Limiter = { allows(key: string): boolean; record(key: string): void; refund(key: string): void };

type NoticeDeps = {
  db: Pick<PrismaClient, "actionToken">;
  transport: MailTransport;
  mailer: {
    sendToMember(input: {
      memberId: number | null;
      to: string;
      type: "email_verification";
      message: { subject: string; text: string; html: string };
      summary: string;
    }): Promise<{ messageId: string | null }>;
  };
  memberLimiter: Limiter;
  actorLimiter: Limiter;
  baseUrl(): string;
};

export function makeAccountEmailNotice(deps: NoticeDeps) {
  return {
    /** Avisa la mudanza. Se llama DESPUÉS de que la edición commiteó, y su
     *  resultado no la deshace nunca.
     *
     *  Por qué una falla de envío no revierte el cambio: el motivo más frecuente
     *  de este cambio en la vida real es justamente que el socio PERDIÓ el
     *  acceso a su correo viejo, así que un rebote de la casilla anterior es el
     *  caso esperado y no una anomalía. Condicionar la edición a que ese buzón
     *  reciba sería bloquear precisamente el caso legítimo y darle derecho a
     *  veto a quien controla —o borró— la casilla vieja. Y revertir sería peor
     *  que no haber cambiado nada: dejaría la cuenta apuntando a una dirección
     *  que el padrón ya no le reconoce al socio, que es la amenaza que
     *  `syncAccountEmail` viene a cerrar, y desharía en silencio la edición de un
     *  operador. Así que el cambio queda, y la falla se le dice al operador
     *  (`accountEmailNoticeWarning`) y se asienta en `audit_log`.
     *
     *  Los cupos son los MISMOS que raciona el botón de envío del panel
     *  (`sendVerificationAction`): si no, este camino sería la vuelta larga para
     *  saltearse el techo de 3 correos por socio por hora —editar el email
     *  emite y manda un `email_verification` igual que el botón— y le daría a un
     *  admin un mailbombing gratis contra cualquier casilla. Se reserva UNA vez
     *  para el par de correos: sin cupo no sale ninguno de los dos. */
    async announce(input: {
      // La ficha DESPUÉS de la edición: `verificationTarget` decide sobre ella.
      member: Pick<Member, "id" | "status" | "email" | "emailStatus" | "userId">;
      /** La dirección con la que el socio ingresaba hasta hace un instante. */
      previousEmail: string;
      actorId: number;
      now?: Date;
    }): Promise<AccountEmailNoticeOutcome> {
      const outcome: AccountEmailNoticeOutcome = {
        previousNotified: false,
        verificationSent: false,
        throttled: false,
        failures: [],
      };

      // Reserva atómica de los dos cupos, igual que en `sendVerificationAction`:
      // se consultan los dos y recién después se registran, para que el primero
      // no le cobre el intento a su clave cuando el segundo va a rechazar.
      const memberKey = `member:${input.member.id}`;
      const actorKey = `actor:${input.actorId}`;
      if (!deps.memberLimiter.allows(memberKey) || !deps.actorLimiter.allows(actorKey)) {
        outcome.throttled = true;
        return outcome;
      }
      deps.memberLimiter.record(memberKey);
      deps.actorLimiter.record(actorKey);

      // 1. La casilla que perdió el acceso. Va primero: es el control de
      //    seguridad, y si el proceso se cae en el medio conviene que sea el que
      //    ya salió.
      try {
        await deps.transport.send({ to: input.previousEmail, ...loginEmailMovedNotice() });
        outcome.previousNotified = true;
      } catch (e) {
        const code = codeOf(e);
        console.error("[carga] falló el aviso de mudanza a la dirección anterior del socio", input.member.id, "code:", code);
        outcome.failures.push({ target: "previous", code });
      }

      // 2. La casilla nueva. Quién decide si corresponde y con qué enlace es
      //    `verificationTarget`, la misma función que usa el botón del panel.
      const target = verificationTarget(input.member);
      if (!target.ok || target.kind !== "email_verification") {
        // Inalcanzable con una edición normal (`buildPatch` deja la dirección
        // nueva en `declared`, y la ficha no puede quedar sin email ni cambiar
        // de estado por esta pantalla), pero si alguna vez lo fuera, el operador
        // tiene que enterarse de que la verificación no salió en vez de que el
        // socio quede con una dirección de ingreso que nadie confirmó.
        outcome.failures.push({ target: "current", code: "not_eligible" });
      } else {
        const raw = await makeTokens(deps.db).issue({
          purpose: "email_verification",
          memberId: input.member.id,
          now: input.now,
        });
        const { message, summary } = loginEmailVerification({ baseUrl: deps.baseUrl(), token: raw });
        try {
          await deps.mailer.sendToMember({
            memberId: input.member.id,
            to: target.email,
            type: "email_verification",
            message,
            summary,
          });
          outcome.verificationSent = true;
        } catch (e) {
          // El enlace ya emitido se quema: un enlace de verificación vivo que
          // nadie recibió es superficie de ataque sin ninguna contrapartida
          // (mismo criterio que `sendVerificationAction`).
          await deps.db.actionToken.deleteMany({ where: { tokenHash: hashToken(raw) } });
          const code = codeOf(e);
          console.error("[carga] falló la verificación de la dirección nueva del socio", input.member.id, "code:", code);
          outcome.failures.push({ target: "current", code });
        }
      }

      // Si no salió NINGUNO de los dos no quedó ni un correo acreditado ni un
      // enlace vivo, así que no hay nada que racionar y el cupo se devuelve: tres
      // errores de configuración del SMTP no pueden dejar al socio sin avisos.
      if (!outcome.previousNotified && !outcome.verificationSent) {
        deps.memberLimiter.refund(memberKey);
        deps.actorLimiter.refund(actorKey);
      }
      return outcome;
    },
  };
}

export const accountEmailNotice = makeAccountEmailNotice({
  db: prisma,
  transport: getTransport(),
  mailer: defaultMailer,
  memberLimiter: verificationMemberLimiter,
  actorLimiter: verificationActorLimiter,
  baseUrl: () => process.env.AUTH_URL ?? "http://localhost:3000",
});
