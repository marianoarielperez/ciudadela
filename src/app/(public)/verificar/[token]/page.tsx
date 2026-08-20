import { ConfirmForm } from "./confirm-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ACCESS_ERRORS, canRedeem, REDEEM_CARD_SELECT, REDEEM_PAGE_COPY,
} from "@/lib/members/access";
import { prisma } from "@/lib/prisma";
import { tokens } from "@/lib/tokens";

// El token viene en la URL: nada de esto se puede cachear ni prerenderizar.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Verificá tu email — Vecinal Ciudadela",
  // El enlace lleva un token de un solo uso: que no lo indexe nadie.
  robots: { index: false, follow: false },
};

export default async function VerificarPage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;

  // `peek` y NO `consume`: este es un GET y los escáneres de enlaces de los
  // clientes de correo abren la URL antes que la persona. Un GET que consumiera
  // dejaría al socio con un enlace muerto sin haber hecho nada.
  const t = await tokens.peek(token, "email_verification");
  // Sólo la dirección y el estado: esta página es anónima y el correo que trajo
  // el enlace pudo haber ido a la casilla equivocada. El nombre del socio no se
  // lee ni se muestra — ver `REDEEM_CARD_SELECT`.
  const member = t?.memberId
    ? await prisma.member.findUnique({ where: { id: t.memberId }, select: REDEEM_CARD_SELECT })
    : null;

  // El mismo enlace puede pertenecer a una SOLICITUD del wizard (M3), que
  // todavía no tiene ficha ni cuenta. Se le muestra este mismo formulario: el
  // texto es genérico y no nombra a nadie. De la solicitud se lee sólo la
  // dirección, con el mismo criterio de `REDEEM_CARD_SELECT` — nunca el nombre.
  const application = t?.applicationId
    ? await prisma.application.findUnique({ where: { id: t.applicationId }, select: { email: true } })
    : null;

  // La misma revalidación en vivo que hace el canje: si el socio quedó dado de
  // baja después del envío, la página no le ofrece el botón. Lo que cierra el
  // agujero es la guarda del canje —esto es sólo no mentirle a la persona—.
  // La solicitud no tiene un estado equivalente que cierre el canje: verificar
  // el email es idempotente y no le da acceso a nada.
  const blocked = member ? canRedeem(member)
    : application ? { ok: true as const }
    : { ok: false as const, error: ACCESS_ERRORS.dead };
  const email = member?.email ?? application?.email ?? null;
  const usable = blocked.ok && email;

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center p-4">
      <Card>
        <CardHeader>
          <CardTitle>Verificación de email</CardTitle>
          <CardDescription>
            {usable
              ? "Confirmá tu domicilio electrónico ante la Vecinal Ciudadela."
              : "No pudimos usar este enlace."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {usable ? (
            <ConfirmForm
              token={token}
              footer={<p className="text-sm text-muted-foreground">{REDEEM_PAGE_COPY.verifyNotYou}</p>}
            >
              <p className="text-sm">{REDEEM_PAGE_COPY.verifyLead}</p>
              <p className="rounded bg-secondary px-3 py-2 text-sm font-medium break-all">
                {email}
              </p>
              <p className="text-sm text-muted-foreground">{REDEEM_PAGE_COPY.verifyWhy}</p>
            </ConfirmForm>
          ) : (
            <p className="text-sm text-red-600" role="alert">
              {blocked.ok ? ACCESS_ERRORS.noEmail : blocked.error}
            </p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
