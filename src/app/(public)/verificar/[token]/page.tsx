import { ConfirmForm } from "./confirm-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ACCESS_ERRORS, canRedeem } from "@/lib/members/access";
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
  const member = t?.memberId
    ? await prisma.member.findUnique({
        where: { id: t.memberId },
        select: { fullName: true, email: true, status: true },
      })
    : null;

  // La misma revalidación en vivo que hace el canje: si el socio quedó dado de
  // baja después del envío, la página no le ofrece el botón. Lo que cierra el
  // agujero es la guarda del canje —esto es sólo no mentirle a la persona—.
  const blocked = member ? canRedeem(member) : { ok: false as const, error: ACCESS_ERRORS.dead };
  const usable = member && blocked.ok && member.email;

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
            <>
              <p className="text-sm">
                Hola <strong>{member.fullName}</strong>: confirmá que{" "}
                <strong className="break-all">{member.email}</strong> es tu domicilio electrónico
                ante la Asociación Vecinal del Barrio Ciudadela. A partir de ahí vamos a poder
                notificarte de manera fehaciente (Art. 5° quater del estatuto).
              </p>
              <ConfirmForm token={token} />
            </>
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
