import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
// Static import (no se copia a public/): así next/image genera las variantes
// responsive y el blur placeholder del hero en tiempo de build.
import heroImg from "../../../assets/hero-3.jpg";
import { getActiveReregistration, getAsociateActive } from "@/lib/config";
import { getLatestNews } from "@/lib/news/query";
import { NewsCard } from "@/components/public/news-card";
import { SITE, siteBaseUrl } from "@/lib/site";

export const metadata: Metadata = {
  description: `Sitio oficial de la ${SITE.name} — noticias, actividades y asociación.`,
};

export default async function HomePage() {
  const [asociateActive, reregistration, latest] = await Promise.all([
    getAsociateActive(),
    getActiveReregistration(),
    getLatestNews(3),
  ]);
  // Mientras corre el re-empadronamiento las altas se suspenden: la asociación
  // está justamente depurando su padrón (diseño M6 §11). El interruptor de la
  // Comisión puede estar prendido y aun así ASOCIATE no se ofrece — y la guarda
  // de `createApplicationAction` corta por las MISMAS dos causales, para que lo
  // que la portada muestra apagado sea exactamente lo que el POST rechaza.
  const showAsociate = asociateActive && reregistration === null;
  return (
    <main>
      <script
        type="application/ld+json"
        // JSON-LD estático generado desde constantes propias (SITE): no hay
        // input de usuario acá, el dangerouslySetInnerHTML es seguro.
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Organization",
            name: SITE.name,
            address: {
              "@type": "PostalAddress",
              streetAddress: SITE.address,
              addressLocality: "Comodoro Rivadavia",
              addressRegion: "Chubut",
              addressCountry: "AR",
            },
            foundingDate: "1964-08-04",
            url: siteBaseUrl().toString(),
            logo: new URL("/logo-header.png", siteBaseUrl()).toString(),
          }),
        }}
      />
      {/* Hero: la ilustración tiene pixeles blancos (el papel de la acuarela,
          el patio) en TODA su altura, así que el contraste del texto no puede
          depender de qué zona le toque atrás. El overlay se define en píxeles
          desde el borde inferior — no en porcentajes de la altura del hero —
          porque el bloque de texto mide lo mismo en cualquier viewport: así el
          mismo degradé sirve en mobile y en desktop, sin variantes responsive.
          Calibrado contra el peor pixel posible (papel blanco puro, 255), que
          en esta imagen existe de verdad: el máximo de la banda del texto es
          255. Pisos MEDIDOS en el navegador, no estimados — la línea más alta
          del título en mobile cae a 184 px del piso, no a los ~290 que decía
          este comentario cuando el hero era una foto:

            desktop  título 4,58:1 (36 px bold) · subtítulo 5,15:1 (16 px)
            mobile   título 3,61:1 (24 px bold, 2 líneas) · subtítulo 4,74:1

          Los dos títulos son texto grande (piso AA 3:1) y los dos subtítulos
          son texto normal (piso AA 4,5:1): pasa en los cuatro. El del
          subtítulo en mobile es el más justo (4,74 contra 4,50), así que si
          algún día se cambia la imagen del hero o el tamaño de ese texto, hay
          que volver a medir acá. El text-shadow NO está contado en esos
          números: WCAG no lo acredita, y de eso se trata — es margen extra
          sobre un piso que ya cierra solo.
          Este degradé es más flojo que el que llevaba la foto aérea (0,68 en
          vez de 0,86 al ras del piso). Sobre una acuarela clara el negro se
          lee como una mancha y no como una sombra, así que se compensa con un
          text-shadow más marcado en lugar de oscurecer más el dibujo.
          Arriba de los 400 px el overlay ya no existe: la ilustración queda
          intacta justo donde tiene información (la sede, la arboleda). */}
      <section className="relative">
        <Image
          src={heroImg}
          alt="Ilustración en acuarela de la sede de la Asociación Vecinal del Barrio Ciudadela, vista desde el aire"
          placeholder="blur"
          priority
          sizes="100vw"
          className="h-[52vh] min-h-[26rem] w-full object-cover sm:h-[55vh]"
        />
        <div className="absolute inset-0 flex flex-col items-center justify-end bg-[linear-gradient(to_top,rgb(0_0_0/0.68)_0px,rgb(0_0_0/0.42)_230px,rgb(0_0_0/0.36)_300px,rgb(0_0_0/0)_400px)] px-4 pb-8 text-center text-white">
          {/* text-shadow real (no el filter `drop-shadow` de Tailwind, que es
              10 % y 6 % de negro y no mueve la aguja): suma contraste justo
              donde está el glifo, sin oscurecer un pixel más del dibujo. */}
          <h1 className="text-2xl font-bold [text-shadow:0_2px_10px_rgb(0_0_0/0.85),0_1px_3px_rgb(0_0_0/0.7)] sm:text-4xl">
            {SITE.name}
          </h1>
          <p className="mt-1 text-sm [text-shadow:0_2px_10px_rgb(0_0_0/0.85),0_1px_3px_rgb(0_0_0/0.7)] sm:text-base">
            {SITE.city}
          </p>
          <div className="mt-4 flex flex-col items-center gap-3">
            {/* REEMPADRONATE va PRIMERO y con el mismo tratamiento que
                ASOCIATE (mismo relleno, mismo peso, mismo tamaño): mientras el
                proceso corre, es el trámite que el vecino viene a hacer a la
                portada. Sólo aparece con un proceso en 1ª o 2ª instancia — de
                eso se ocupa `wizardOpen`, adentro de `getActiveReregistration`. */}
            {reregistration !== null && (
              <Link
                href="/reempadronate"
                className="rounded-md bg-primary px-6 py-3 text-base font-semibold text-primary-foreground shadow hover:opacity-90"
              >
                REEMPADRONATE
              </Link>
            )}
            {showAsociate ? (
              <Link
                href="/asociate"
                className="rounded-md bg-primary px-6 py-3 text-base font-semibold text-primary-foreground shadow hover:opacity-90"
              >
                ASOCIATE
              </Link>
            ) : (
              <>
                {/* Lo accionable acá es la información, no el control: el aviso
                    va primero y se lleva el peso visual del bloque. Superficie
                    opaca (no un negro translúcido): su contraste no puede
                    depender de qué pixel de la ilustración le toque atrás. */}
                <div className="max-w-md rounded-md bg-background px-4 py-2.5 text-left text-foreground shadow-lg">
                  {reregistration !== null ? (
                    /* Suspensión por re-empadronamiento: el vecino tiene que
                       saber HASTA CUÁNDO, que es lo único que le sirve para
                       volver. La fecha es la del plazo que corre ahora (la 2ª
                       instancia manda sobre la 1ª). Cuando no hay plazo que
                       citar la frase se lee igual y sigue siendo verdadera —la
                       suspensión dura lo que dure el proceso—, y esa rama no es
                       teórica: `currentDeadline` devuelve `null` también
                       mientras el plazo ya venció y el proceso todavía no
                       cambió de estado, justamente para no afirmarle al vecino
                       una fecha pasada. */
                    <p className="text-sm">
                      Las asociaciones están suspendidas temporalmente durante el proceso de
                      re-empadronamiento
                      {reregistration.deadline !== null && <> (hasta el {reregistration.deadline})</>}
                      . Para más información acercate a la sede vecinal:
                    </p>
                  ) : (
                    <p className="text-sm">
                      Las asociaciones están suspendidas temporalmente. Para más información
                      acercate a la sede vecinal:
                    </p>
                  )}
                  {/* La dirección era un callejón sin salida: decía dónde ir y
                      ahí terminaba. Ahora lleva al mapa y al contacto. */}
                  <p className="mt-1 text-sm font-semibold">
                    <Link href="/ubicacion" className="text-primary underline">
                      {SITE.address}
                    </Link>
                  </p>
                </div>
                {/* Estado inerte con tratamiento fantasma (sin relleno, borde
                    fino punteado, texto atenuado) para que se lea como no
                    disponible a simple vista, sin depender del cursor. No es un
                    <button disabled>: no hay acción que ejecutar, es una
                    etiqueta — se mantiene visible para que el vecino sepa que
                    el camino existe y va a volver. El sufijo `sr-only` da a un
                    lector de pantalla el estado que la atenuación da a la vista. */}
                <span className="cursor-not-allowed rounded-md border border-dashed border-white/45 px-5 py-1.5 text-sm font-medium tracking-wide text-white/70">
                  ASOCIATE
                  <span className="sr-only"> (no disponible por ahora)</span>
                </span>
              </>
            )}
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-5xl px-4 py-10">
        <div className="flex items-baseline justify-between">
          <h2 className="text-xl font-semibold">Noticias</h2>
          {latest.length > 0 && (
            <Link href="/noticias" className="text-sm text-primary underline">
              Ver todas
            </Link>
          )}
        </div>
        {latest.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">Todavía no hay noticias publicadas.</p>
        ) : (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {latest.map((n) => (
              // h3: acá la grilla cuelga del <h2> "Noticias" de la sección.
              <NewsCard key={n.id} news={n} titleAs="h3" />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
