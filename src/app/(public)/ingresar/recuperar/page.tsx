import Link from "next/link";

import { RecoverForm } from "./recover-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = {
  title: "Recuperar contraseña — Vecinal Ciudadela",
  robots: { index: false, follow: false },
};

export default function RecuperarPage() {
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center p-4">
      <Card>
        <CardHeader>
          <CardTitle>Recuperar contraseña</CardTitle>
          <CardDescription>
            Escribí el email con el que entrás al panel de socios. Si corresponde a una cuenta, te
            mandamos un enlace para elegir una contraseña nueva.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <RecoverForm />
          <p className="text-center text-sm">
            <Link href="/ingresar" className="text-primary hover:underline">
              Volver al ingreso
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
