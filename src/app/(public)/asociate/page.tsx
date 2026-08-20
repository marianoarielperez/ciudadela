import type { Metadata } from "next";
import Link from "next/link";
import { getAsociateActive, getLegalTexts } from "@/lib/config";
import { getFeeAmounts } from "@/lib/mp/plans";
import { prisma } from "@/lib/prisma";
import { SITE } from "@/lib/site";
import { AsociateWizard } from "./asociate-wizard";

export const metadata: Metadata = {
  // El sufijo va a mano en cada página (ver el comentario del layout raíz: el
  // panel usa otro), y todas las públicas usan exactamente este.
  title: "Asociate — Vecinal Ciudadela",
  description: `Asociate a la ${SITE.name} en línea, en cinco pasos.`,
};

export default async function AsociatePage() {
  // La home ya esconde el botón cuando `asociate_activo` está en false, pero la
  // URL es pública y se puede llegar por un enlace viejo o por el buscador:
  // revalidar acá es lo único que impide entrar al wizard con las asociaciones
  // suspendidas.
  const active = await getAsociateActive();
  if (!active) {
    return (
      <main className="mx-auto w-full max-w-xl px-4 py-16">
        <h1 className="text-2xl font-bold tracking-tight">Asociate</h1>
        <p className="mt-3 text-muted-foreground">
          Las asociaciones en línea están suspendidas por ahora. Para asociarte, acercate a la
          sede vecinal.
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

  // `loadOrder` viaja junto al nombre porque el buscador del paso 1 reusa
  // `searchStreets` (src/lib/streets/search.ts), que matchea también el código
  // catastral —"1906" encuentra "Hernandez , Jose"— y ordena los empates por
  // ese número. `normalizedName` no hace falta: esa misma función normaliza el
  // nombre en el cliente con una clave de búsqueda más laxa que la persistida.
  const [legal, fees, streets] = await Promise.all([
    getLegalTexts(),
    getFeeAmounts(),
    prisma.street.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, loadOrder: true },
    }),
  ]);

  return (
    <main className="mx-auto w-full max-w-xl px-4 py-8 sm:py-12">
      <AsociateWizard
        streets={streets}
        legal={legal}
        fees={fees}
        siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ""}
      />
    </main>
  );
}
