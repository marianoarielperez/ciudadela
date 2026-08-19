import { PasswordForm } from "./password-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ACCESS_ERRORS, canRedeem } from "@/lib/members/access";
import { prisma } from "@/lib/prisma";
import { tokens } from "@/lib/tokens";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Creá tu contraseña — Vecinal Ciudadela",
  robots: { index: false, follow: false },
};

export default async function AccesoPage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;

  // `peek`, nunca `consume`: ver el comentario de /verificar. Acá el enlace
  // además puede haber llegado por redirect desde la verificación, así que un
  // GET que consumiera rompería el circuito completo de una.
  const t = await tokens.peek(token, "password_invitation");
  const member = t?.memberId
    ? await prisma.member.findUnique({
        where: { id: t.memberId },
        select: { fullName: true, email: true, status: true },
      })
    : null;

  const blocked = member ? canRedeem(member) : { ok: false as const, error: ACCESS_ERRORS.dead };
  const usable = member && blocked.ok && member.email;

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center p-4">
      <Card>
        <CardHeader>
          <CardTitle>Creá tu contraseña</CardTitle>
          <CardDescription>
            {usable ? "Último paso para entrar a tu panel de socio." : "No pudimos usar este enlace."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {usable ? (
            <>
              <p className="text-sm">
                Hola <strong>{member.fullName}</strong>: elegí una contraseña para entrar con{" "}
                <strong className="break-all">{member.email}</strong>.
              </p>
              <PasswordForm token={token} />
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
