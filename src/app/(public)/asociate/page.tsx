import type { Metadata } from "next";
import Link from "next/link";
import {
  getActiveReregistration,
  getAsociateActive,
  getCollaboratorEnabled,
  getLegalTexts,
} from "@/lib/config";
import { prisma } from "@/lib/prisma";
import { SITE } from "@/lib/site";
import { feeAmountsForWizard, feeValueReader } from "@/lib/treasury/fee-values";
import { AsociateWizard } from "./asociate-wizard";

export const metadata: Metadata = {
  // El sufijo va a mano en cada página (ver el comentario del layout raíz: el
  // panel usa otro), y todas las públicas usan exactamente este.
  title: "Asociate — Vecinal Ciudadela",
  description: `Asociate a la ${SITE.name} en línea, en seis pasos.`,
};

// Una hora de revalidación, y no `force-dynamic`.
//
// El monto sale de `fee_values` (única fuente, REG-34), que la Comisión
// registra desde /admin/configuracion. Esa pantalla NO invalida esta página:
// el valor nuevo entra con un `validFrom` propio —puede ser hoy o dentro de un
// mes—, así que ningún tag disparado al guardar diría la verdad sobre cuándo
// cambia lo que acá se muestra. Sólo el tiempo la expira.
//
// Lo que arregla, en concreto: sin esto la página es un prerender del build
// (`getAsociateActive` y `getLegalTexts` sí están tagueadas con
// CACHE_TAGS.config), y el monto anunciado quedaba horneado hasta el próximo
// `npm run build` — exactamente lo que REG-14 prohíbe. Una consulta más a
// MariaDB por hora es barata; una por visita pública no compra nada.
export const revalidate = 3600;

export default async function AsociatePage() {
  // La home ya esconde el botón cuando `asociate_activo` está en false, pero la
  // URL es pública y se puede llegar por un enlace viejo o por el buscador:
  // revalidar acá es lo único que impide entrar al wizard con las asociaciones
  // suspendidas.
  // Dos causales de cierre, las mismas dos que corta la guarda 0 de
  // `createApplicationAction` y las mismas dos que decide la portada: el
  // interruptor de la Comisión y el proceso de re-empadronamiento en curso
  // (diseño M6 §11 — mientras la asociación depura su padrón no suma gente).
  // El re-empadronamiento se lee con la MISMA función cacheada por tag que usa
  // la portada, porque esta página también es cacheada (`revalidate = 3600`) y
  // se invalida por `updateTag(CACHE_TAGS.config)`.
  const [active, reregistration] = await Promise.all([
    getAsociateActive(),
    getActiveReregistration(),
  ]);
  if (reregistration !== null) {
    return (
      <main className="mx-auto w-full max-w-xl px-4 py-16">
        <h1 className="text-2xl font-bold tracking-tight">Asociate</h1>
        {/* La fecha se cita sólo si hay una que sea verdad: `currentDeadline`
            (adentro del lector cacheado) devuelve `null` fuera de las dos
            instancias y también cuando el plazo YA VENCIÓ y el proceso todavía
            no cambió de estado. Sin fecha la frase sigue siendo cierta —la
            suspensión dura lo que dure el proceso—; con una fecha pasada le
            estaría diciendo al vecino que ya puede asociarse en la misma
            pantalla que se lo impide. */}
        <p className="mt-3 text-muted-foreground">
          Las asociaciones están suspendidas temporalmente durante el proceso de
          re-empadronamiento
          {reregistration.deadline !== null && <> (hasta el {reregistration.deadline})</>}. Para
          asociarte, acercate a la sede vecinal.
        </p>
        <p className="mt-4 font-medium">
          <Link href="/ubicacion" className="text-primary underline underline-offset-2">
            {SITE.address}
          </Link>
        </p>
        {/* El que llega acá durante el proceso puede ser justamente un socio
            adherente buscando el trámite: el camino que SÍ está abierto se le
            ofrece en vez de dejarlo en un callejón. */}
        <p className="mt-6 text-sm text-muted-foreground">
          Si ya sos socio adherente,{" "}
          <Link href="/reempadronate" className="text-primary underline underline-offset-2">
            re-empadronate acá
          </Link>
          .
        </p>
        <p className="mt-8">
          <Link href="/" className="text-sm text-primary underline underline-offset-2">
            Volver al inicio
          </Link>
        </p>
      </main>
    );
  }
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

  // `loadOrder` viaja junto al nombre porque el buscador del paso 2 reusa
  // `searchStreets` (src/lib/streets/search.ts), que matchea también el código
  // catastral —"1906" encuentra "Hernandez , Jose"— y ordena los empates por
  // ese número. `normalizedName` no hace falta: esa misma función normaliza el
  // nombre en el cliente con una clave de búsqueda más laxa que la persistida.
  const [legal, fees, streets, collaboratorEnabled] = await Promise.all([
    getLegalTexts(),
    feeValueReader.current().then(feeAmountsForWizard),
    prisma.street.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, loadOrder: true },
    }),
    // La llave `colaborador_habilitado` (spec 2026-09-02): cacheada por tag como
    // el interruptor de ASOCIATE, porque esta página también es cacheada
    // (`revalidate = 3600` + `updateTag(CACHE_TAGS.config)` al guardar). La
    // GUARDA vive en `createApplicationAction` y lee directo.
    getCollaboratorEnabled(),
  ]);

  return (
    <main className="mx-auto w-full max-w-xl px-4 py-8 sm:py-12">
      <AsociateWizard
        streets={streets}
        legal={legal}
        fees={fees}
        collaboratorEnabled={collaboratorEnabled}
        siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ""}
      />
    </main>
  );
}
