import Link from "next/link";

import { ResetForm } from "./reset-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RESET_ERRORS } from "@/lib/auth/password-reset";
import { tokens } from "@/lib/tokens";

// El token viene en la URL: nada de esto se puede cachear ni prerenderizar.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Restablecé tu contraseña — Vecinal Ciudadela",
  // El enlace lleva un token de un solo uso: que no lo indexe nadie.
  robots: { index: false, follow: false },
};

export default async function RestablecerPage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;

  // `peek` y NUNCA `consume`: este es un GET y los escáneres de enlaces de los
  // clientes de correo abren la URL antes que la persona. Una página que
  // consumiera dejaría al socio con un enlace muerto sin haber hecho nada.
  //
  // La página no dice de quién es la cuenta ni muestra el email: el enlace pudo
  // haber sido reenviado, y acá todavía no hay nada probado más allá de tenerlo.
  const usable = (await tokens.peek(token, "password_reset")) !== null;

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center p-4">
      <Card>
        <CardHeader>
          <CardTitle>Restablecé tu contraseña</CardTitle>
          <CardDescription>
            {usable ? "Elegí una contraseña nueva para entrar al panel." : "No pudimos usar este enlace."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {usable ? (
            <ResetForm token={token} />
          ) : (
            <>
              <p className="text-sm text-red-600" role="alert">
                {RESET_ERRORS.dead}
              </p>
              <p className="text-center text-sm">
                <Link href="/ingresar/recuperar" className="text-primary hover:underline">
                  Pedir un enlace nuevo
                </Link>
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
