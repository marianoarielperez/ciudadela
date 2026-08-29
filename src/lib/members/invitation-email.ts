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
import { mailer } from "@/lib/email";
import { portalInvite } from "@/lib/email/templates";
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
          select: { email: true, fullName: true },
        });
        if (!member?.email) return;
        const base = process.env.AUTH_URL ?? "http://localhost:3000";
        const { message, summary } = portalInvite({
          kind: "password_invitation", name: member.fullName, baseUrl: base, token: rawInvite,
        });
        await deps.mail.sendToMember({
          memberId, to: member.email, type: "password_invitation", message, summary,
        });
      } catch (e) {
        // Sólo el código: el error de nodemailer trae el sobre SMTP con la
        // dirección del socio en claro (Ley 25.326, docs/08).
        const code = typeof e === "object" && e !== null && "code" in e ? String(e.code) : "unknown";
        console.error("[verificar] no salió el correo de invitación del socio", memberId, "code:", code);
      }
    },
  };
}

export const invitationEmailer = makeInvitationEmailer({ db: prisma, mail: mailer });
