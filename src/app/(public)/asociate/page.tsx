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

// El monto de la cuota NECESITA un camino de expiración por TIEMPO.
//
// Sin esto la página es un prerender del build: `getAsociateActive` y
// `getLegalTexts` se refrescan porque están tagueadas con CACHE_TAGS.config y
// `updateConfigAction` las invalida, pero `getFeeAmounts` (src/lib/mp/plans.ts)
// lee el monto de los planes de Mercado Pago —que la Comisión cambia en el
// panel de MP, FUERA de SIGeV— y por eso no hay ninguna acción nuestra que
// pueda invalidar un tag cuando ese monto se mueve. Taguear la lectura no
// alcanza: el tag no lo dispararía nadie. Sólo el tiempo la expira.
//
// Lo que arregla, en concreto:
//   (a) si MP está caído justo en el render que produjo el prerender,
//       `fees: null` quedaba horneado PARA SIEMPRE y el wizard se trababa en el
//       paso 2 sin ninguna forma de recuperarse; ahora se rehace solo.
//   (b) si la CD sube la cuota en MP (REG-34 la deja mover hasta 4 veces al
//       año), la página dejaba de anunciar el monto que MP efectivamente
//       debita — exactamente lo que REG-14 prohíbe.
//
// Una hora, y no `force-dynamic`: casi todo lo que renderiza (calles, textos
// legales, interruptor) es estable, y una consulta a MariaDB por cada visita
// pública no compra nada. Con este techo el límite real de desactualización del
// monto pasa a ser el TTL de 24 h del propio lector de `plans.ts` —el mismo que
// ya rige en /asociate/retomar, que es `force-dynamic`—, en vez de "hasta el
// próximo `npm run build`".
export const revalidate = 3600;

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
