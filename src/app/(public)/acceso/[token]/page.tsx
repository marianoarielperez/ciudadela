import { PasswordForm } from "./password-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ACCESS_ERRORS, canRedeem, REDEEM_CARD_SELECT, REDEEM_PAGE_COPY,
} from "@/lib/members/access";
import { prisma } from "@/lib/prisma";
import { tokens } from "@/lib/tokens";
import { ADMIN_REDEEM_PAGE_COPY } from "@/lib/users/admin-access";

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
  //
  // El MISMO formulario sirve para los dos circuitos (socio y cuenta de
  // gestión): la action decide la rama con el mismo par de peeks.
  const t = await tokens.peek(token, "password_invitation");
  const adminT = t ? null : await tokens.peek(token, "admin_invitation");

  // Sin el nombre del titular en ninguna de las dos ramas, por el mismo motivo
  // que /verificar: a esta URL se llega con un token que viajó por correo, y el
  // correo pudo haber ido a la casilla equivocada — ver `REDEEM_CARD_SELECT`.
  const member = t?.memberId
    ? await prisma.member.findUnique({ where: { id: t.memberId }, select: REDEEM_CARD_SELECT })
    : null;
  const adminUser = adminT?.userId
    ? await prisma.user.findUnique({ where: { id: adminT.userId }, select: { email: true, active: true } })
    : null;

  const blocked = member ? canRedeem(member) : { ok: false as const, error: ACCESS_ERRORS.dead };
  const memberUsable = member && blocked.ok && member.email;
  const adminUsable = adminUser?.active ? adminUser : null;

  const copy = adminUsable ? ADMIN_REDEEM_PAGE_COPY : REDEEM_PAGE_COPY;
  // `memberUsable` ya probó `member.email`; el `?? null` es para el narrowing.
  const email = adminUsable?.email ?? (memberUsable ? (member?.email ?? null) : null);
  const usable = Boolean(memberUsable || adminUsable);

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center p-4">
      <Card>
        <CardHeader>
          <CardTitle>Creá tu contraseña</CardTitle>
          <CardDescription>
            {usable
              ? adminUsable
                ? "Último paso para entrar al panel de administración."
                : "Último paso para entrar al portal."
              : "No pudimos usar este enlace."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {usable ? (
            <>
              <p className="text-sm">{copy.createLead}</p>
              <p className="rounded bg-secondary px-3 py-2 text-sm font-medium break-all">
                {email}
              </p>
              <p className="text-sm text-muted-foreground">{copy.createWhy}</p>
              <PasswordForm token={token} />
              <p className="text-sm text-muted-foreground">{copy.createNotYou}</p>
            </>
          ) : (
            // El texto de la rama socio queda como estaba, caso por caso. La rama
            // admin cae toda en `dead` a propósito: sin sesión no se le cuenta a
            // un anónimo si la cuenta existe pero está deshabilitada.
            <p className="text-sm text-red-600" role="alert">
              {member ? (blocked.ok ? ACCESS_ERRORS.noEmail : blocked.error) : ACCESS_ERRORS.dead}
            </p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
