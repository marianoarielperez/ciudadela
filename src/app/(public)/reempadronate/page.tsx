import type { Metadata } from "next";
import Link from "next/link";
import { getContactInfo } from "@/lib/config";
import { prisma } from "@/lib/prisma";
import { openWizardProcess } from "@/lib/reregistration/current";
import { SITE } from "@/lib/site";
import { ReempadronateWizard } from "./reempadronate-wizard";

export const metadata: Metadata = {
  // El sufijo va a mano en cada página (ver el comentario del layout raíz: el
  // panel usa otro), y todas las públicas usan exactamente este.
  title: "Re-empadronamiento — Vecinal Ciudadela",
  description: `Re-empadronate como socio de la ${SITE.name}, en línea y en cuatro pasos.`,
};

// `force-dynamic` y no una revalidación por tiempo como /asociate.
//
// Allá lo que la página muestra es un monto, que cambia por decisión de la
// Comisión y con una fecha de vigencia propia: una hora de desfasaje no le
// hace daño a nadie. Acá lo que decide qué se dibuja es si un PLAZO
// ESTATUTARIO está corriendo. Una versión cacheada seguiría ofreciendo el
// formulario después de que venza la segunda instancia (la action lo
// rechazaría, pero el vecino se enteraría recién al enviar), o peor: seguiría
// diciendo "no hay proceso en curso" durante la primera hora de una
// convocatoria a la que ya le empezaron a correr los treinta días.
export const dynamic = "force-dynamic";

export default async function ReempadronatePage() {
  // La MISMA función que usa la action como guarda. Si acá se consultara de
  // otra forma, la página y el POST podrían contestar distinto sobre el mismo
  // trámite (ver el comentario de `openWizardProcess`).
  const activeProcess = await openWizardProcess(prisma);

  if (activeProcess === null) {
    // La home tampoco muestra el botón REEMPADRONATE sin proceso vivo (Task
    // 14), pero la URL es pública y se llega por un enlace viejo, por el correo
    // de la convocatoria o por el buscador. Esta pantalla es lo único que
    // impide entrar al wizard con el proceso cerrado.
    return (
      <main className="mx-auto w-full max-w-xl px-4 py-16">
        <h1 className="text-2xl font-bold tracking-tight">Re-empadronamiento</h1>
        <p className="mt-3 text-muted-foreground">
          No hay un proceso de re-empadronamiento en curso. Cuando la Comisión Directiva convoque
          uno, te vamos a avisar por email y con un aviso en la cartelera de la sede.
        </p>
        <p className="mt-4 font-medium">
          <Link href="/ubicacion" className="text-primary underline underline-offset-2">
            {SITE.address}
          </Link>
        </p>
        <p className="mt-8">
          <Link href="/" className="text-sm text-primary underline underline-offset-2">
            Volver al inicio
          </Link>
        </p>
      </main>
    );
  }

  // Cacheada (tag `config`), a diferencia de la guarda de arriba: esto es
  // DISPLAY —el teléfono y el email que se imprimen en el cartel genérico— y no
  // decide si el trámite se puede hacer. Mismo criterio que /ubicacion.
  const contact = await getContactInfo();

  return (
    <main className="mx-auto w-full max-w-xl px-4 py-8 sm:py-12">
      <ReempadronateWizard
        siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ""}
        contact={contact}
      />
    </main>
  );
}
