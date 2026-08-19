import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
// Static import (no se copia a public/): así next/image genera las variantes
// responsive y el blur placeholder del hero en tiempo de build.
import heroImg from "../../../assets/hero.jpg";
import { getAsociateActive } from "@/lib/config";
import { getLatestNews } from "@/lib/news/query";
import { NewsCard } from "@/components/public/news-card";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  description: `Sitio oficial de la ${SITE.name} — noticias, actividades y asociación.`,
};

export default async function HomePage() {
  const [asociateActive, latest] = await Promise.all([getAsociateActive(), getLatestNews(3)]);
  return (
    <main>
      {/* Hero: la foto tiene pixeles casi blancos (techos, chapa) en TODA su
          altura, así que el contraste del texto no puede depender de qué zona
          le toque atrás. El overlay se define en píxeles desde el borde
          inferior — no en porcentajes de la altura del hero — porque el bloque
          de texto mide lo mismo en cualquier viewport: así el mismo degradé
          sirve en mobile (donde el título ocupa dos líneas y sube hasta ~290 px
          del piso) y en desktop, sin variantes responsive.
          Calibrado contra el peor pixel posible (un techo blanco puro): a la
          altura del título el overlay compone ~0,60 de negro, o sea que 255
          cae a ~100 y el blanco da ~5,8:1 — piso garantizado, no promedio.
          Arriba de los 420 px el overlay ya no existe: la foto queda intacta
          justo donde tiene información (las manzanas, las calles, los árboles)
          y el hero se sigue leyendo como una foto aérea del barrio. */}
      <section className="relative">
        <Image
          src={heroImg}
          alt="Vista aérea del Barrio Ciudadela"
          placeholder="blur"
          priority
          sizes="100vw"
          className="h-[52vh] min-h-[26rem] w-full object-cover sm:h-[55vh]"
        />
        <div className="absolute inset-0 flex flex-col items-center justify-end bg-[linear-gradient(to_top,rgb(0_0_0/0.86)_0px,rgb(0_0_0/0.60)_230px,rgb(0_0_0/0.55)_300px,rgb(0_0_0/0)_420px)] px-4 pb-8 text-center text-white">
          {/* text-shadow real (no el filter `drop-shadow` de Tailwind, que es
              10 % y 6 % de negro y no mueve la aguja): suma contraste justo
              donde está el glifo, sin oscurecer un pixel más de la foto. */}
          <h1 className="text-2xl font-bold [text-shadow:0_1px_3px_rgb(0_0_0/0.55)] sm:text-4xl">
            {SITE.name}
          </h1>
          <p className="mt-1 text-sm [text-shadow:0_1px_3px_rgb(0_0_0/0.55)] sm:text-base">
            {SITE.city}
          </p>
          <div className="mt-4 flex flex-col items-center gap-3">
            {asociateActive ? (
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
                    depender de qué pixel de la foto le toque atrás. */}
                <div className="max-w-md rounded-md bg-background px-4 py-2.5 text-left text-foreground shadow-lg">
                  <p className="text-sm">
                    Las asociaciones están suspendidas temporalmente. Para más información acercate
                    a la sede vecinal:
                  </p>
                  <p className="mt-1 text-sm font-semibold">{SITE.address}</p>
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
            {/* REEMPADRONATE: oculto hasta que exista un proceso (Módulo 6). */}
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
              <NewsCard key={n.id} news={n} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
