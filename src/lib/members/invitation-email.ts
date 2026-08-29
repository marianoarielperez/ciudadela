// La RED del canje de verificación (spec 2026-08-29-invitacion-perdida §7.1).
//
// Cuando la verificación emite la invitación de contraseña, el token crudo
// existe una sola vez y su único vehículo era el redirect de la action: si ese
// redirect se pierde (segunda pestaña, botón atrás, el navegador que se cierra),
// el token queda vivo sin que nadie lo haya visto nunca — el caso del socio 106.
// Este módulo manda ADEMÁS el mismo token por correo a la casilla que la persona
// acaba de confirmar. El redirect sigue siendo el camino rápido; esto es la red.
//
// Reglas que honra:
//  - Corre DESPUÉS del commit, nunca dentro de la transacción (la lección del
//    PDF del recibo y del cancelPreapproval de la baja).
//  - Best-effort y NUNCA rechaza: los llamadores redirigen inmediatamente
//    después, y una excepción acá les rompería justo el camino que este módulo
//    respalda. Un fallo real ya deja su fila `failed` en Notification (visible
//    en /admin/salud) y el operador conserva el reenvío de la ficha; un bloqueo
//    por EMAIL_ALLOWLIST es el entorno de prueba andando, no un fallo.
//  - UN solo token: el mismo del redirect. Emitir otro revocaría al primero.
//  - Saluda por nombre vía `invitationEmail`, y es correcto acá por el mismo
//    argumento del reenvío del panel (`templates.ts`): a esta rama sólo se
//    llega con el email confirmado por la propia persona haciendo clic.
import type { PrismaClient } from "@/generated/prisma/client";
import { failureCode, mailer } from "@/lib/email";
import { portalInvite } from "@/lib/email/templates";
import { ALLOWLIST_BLOCK_CODE } from "@/lib/email/transport";
import { prisma } from "@/lib/prisma";

type Deps = {
  db: Pick<PrismaClient, "member">;
  mail: Pick<typeof mailer, "sendToMember">;
};

export function makeInvitationEmailer(deps: Deps) {
  return {
    async sendAfterVerification(memberId: number, rawInvite: string): Promise<void> {
      try {
        // Se relee acá y no se devuelve desde `verifyEmail`: el contrato de
        // `VerifyResult` está fijado por tests con `toEqual` estricto, y esta
        // consulta corre después del commit, donde ya no bloquea nada.
        const member = await deps.db.member.findUnique({
          where: { id: memberId },
          select: { email: true, fullName: true, emailStatus: true },
        });
        if (!member?.email) return;
        // `emailStatus` no es una guarda cosmética: `portalInvite` SALUDA POR
        // NOMBRE, y eso sólo es legítimo hacia una casilla confirmada por su
        // propio titular (`templates.ts`). Los dos llamadores acaban de escribir
        // `verified` en la misma transacción, así que en el camino feliz esto no
        // corta nada; lo que hace es volver ESTRUCTURAL una invariante que hoy
        // depende de quién llame — un tercer call-site que mande la red desde
        // otro lado no puede filtrarle el nombre de un socio a un buzón ajeno.
        if (member.emailStatus !== "verified") return;
        const base = process.env.AUTH_URL ?? "http://localhost:3000";
        const { message, summary } = portalInvite({
          kind: "password_invitation", name: member.fullName, baseUrl: base, token: rawInvite,
        });
        await deps.mail.sendToMember({
          memberId, to: member.email, type: "password_invitation", message, summary,
        });
      } catch (e) {
        // Sólo el código, y el MISMO extractor que usa el mailer: el error de
        // nodemailer trae el sobre SMTP con la dirección del socio en claro
        // (Ley 25.326, docs/08).
        const code = failureCode(e);
        // Un bloqueo por EMAIL_ALLOWLIST no es un fallo: es el entorno de prueba
        // andando, el transporte ya avisó con su propio `console.warn` y el
        // mailer tampoco escribe una fila `failed`. Loguearlo como error acá
        // sería la misma alarma que enseña a ignorar los logs.
        if (code === ALLOWLIST_BLOCK_CODE) return;
        console.error("[verificar] no salió el correo de invitación del socio", memberId, "code:", code);
      }
    },
  };
}

export const invitationEmailer = makeInvitationEmailer({ db: prisma, mail: mailer });
