import type { Metadata } from "next";
import Link from "next/link";
import { Landmark, Mail, Navigation, Phone, ScrollText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ROOM_META } from "@/lib/activities/room-meta";
import { getContactInfo } from "@/lib/config";
import { SITE } from "@/lib/site";
import { formatDMS, googleMapsDirectionsUrl } from "./map-config";
import SedeMap from "./sede-map-loader";

export const metadata: Metadata = {
  title: "La sede — Vecinal Ciudadela",
  description: `Dónde queda la sede de la ${SITE.name}, cómo llegar y cómo contactarnos.`,
  alternates: { canonical: "/ubicacion" },
};

// JSON-LD de la sede con GeoCoordinates — previsto en el diseño del Módulo 2 y
// pendiente desde entonces. Mismo criterio que el Organization de la home:
// todo sale de constantes propias, así que dangerouslySetInnerHTML es seguro,
// y depende del script-src 'unsafe-inline' ya documentado en next.config.ts.
const placeJsonLd = {
  "@context": "https://schema.org",
  "@type": "Place",
  name: `Sede de la ${SITE.name}`,
  address: {
    "@type": "PostalAddress",
    streetAddress: SITE.address,
    addressLocality: "Comodoro Rivadavia",
    addressRegion: "Chubut",
    addressCountry: "AR",
  },
  geo: { "@type": "GeoCoordinates", latitude: SITE.lat, longitude: SITE.lng },
};

// Los salones ya tienen identidad visual en Actividades (room-meta.ts): acá se
// REUTILIZAN los mismos íconos — no se copia el mapa, se importa.
const ROOMS = [
  { icon: ROOM_META.historic.icon, label: SITE.rooms.historic },
  { icon: ROOM_META.glass.icon, label: SITE.rooms.glass },
  { icon: ROOM_META.kitchen.icon, label: SITE.rooms.kitchen },
  { icon: ROOM_META.classroom.icon, label: SITE.rooms.classroom },
] as const;

const HISTORY = [
  { year: "1964", text: `Fundación de la asociación: ${SITE.founded}.` },
  { year: "2015", text: `Fundación legal: ${SITE.legallyFounded}.` },
  { year: "2015", text: `${SITE.legalStatus}.` },
] as const;

// Chip de ícono tintado — el patrón del tablero /admin (27/08).
const ICON_CHIP =
  "flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary";

// La dirección + "Cómo llegar" se renderiza DOS veces: superpuesta al mapa en
// sm+ y como bloque a lo ancho debajo del mapa en mobile. Es el mismo markup;
// cambia solo el posicionamiento del contenedor.
function SedeCard() {
  return (
    <>
      <p className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground">
        Sede vecinal
      </p>
      <address className="mt-1 not-italic">
        <span className="block text-base font-semibold">{SITE.address}</span>
        <span className="block text-sm text-muted-foreground">{SITE.city}</span>
      </address>
      {/* target="_blank" + rel: la ruta se abre afuera para no perder la
          página; rel="noopener" es obligatorio con _blank. */}
      <a
        href={googleMapsDirectionsUrl(SITE.lat, SITE.lng)}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground outline-hidden transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Navigation aria-hidden className="size-4" />
        Cómo llegar
      </a>
    </>
  );
}

export default async function UbicacionPage() {
  const contact = await getContactInfo();

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(placeJsonLd) }}
      />

      {/* Eyebrow de coordenadas: la firma de la página. Derivadas de
          SITE.lat/lng por formatDMS, nunca hardcodeadas. */}
      <p className="font-mono text-xs font-semibold tracking-[0.14em] text-primary uppercase">
        {formatDMS(SITE.lat, SITE.lng)}
      </p>
      <h1 className="mt-1 text-2xl font-semibold">La sede</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Dónde queda la sede de la {SITE.name}, cómo llegar y cómo comunicarte con la Comisión
        Directiva.
      </p>

      {/* El mapa protagonista. El alto es del CONTENEDOR: Leaflet no infiere
          altura (con height 0 no se ve nada y no hay error). */}
      <div className="relative mt-8 h-[26rem] overflow-hidden rounded-2xl ring-1 ring-foreground/10 sm:h-[30rem]">
        <SedeMap />
        {/* Tarjeta superpuesta (solo sm+): z-[1000] para quedar sobre los
            panes de Leaflet. En mobile NO se superpone: taparía medio mapa. */}
        <div className="absolute top-4 left-4 z-[1000] hidden w-64 rounded-xl bg-card p-4 shadow-lg ring-1 ring-foreground/10 sm:block">
          <SedeCard />
        </div>
      </div>
      <div className="mt-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10 sm:hidden">
        <SedeCard />
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="gap-2">
            <span className={ICON_CHIP}>
              <Phone aria-hidden className="size-5" />
            </span>
            <CardTitle as="h2">Contacto</CardTitle>
          </CardHeader>
          <CardContent>
            {/* Teléfono y email viven en la tabla `configuration` y hoy están
                vacíos: mientras nadie los cargue, el bloque explica el hueco
                en vez de dejarlo. No es un borde raro, es el estado inicial. */}
            {contact.phone || contact.email ? (
              <ul className="space-y-1 text-sm">
                {contact.phone && (
                  <li className="flex items-center gap-2">
                    <Phone aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                    <a
                      className="inline-flex min-h-11 items-center text-primary underline underline-offset-2"
                      href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`}
                    >
                      {contact.phone}
                    </a>
                  </li>
                )}
                {contact.email && (
                  <li className="flex items-center gap-2 [overflow-wrap:anywhere]">
                    <Mail aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                    <a
                      className="inline-flex min-h-11 items-center text-primary underline underline-offset-2"
                      href={`mailto:${contact.email}`}
                    >
                      {contact.email}
                    </a>
                  </li>
                )}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                Todavía no hay un teléfono ni un email de contacto publicados. Podés acercarte a
                la sede, en la dirección de acá arriba.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="gap-2">
            <span className={ICON_CHIP}>
              <Landmark aria-hidden className="size-5" />
            </span>
            <CardTitle as="h2">La sede por dentro</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {ROOMS.map(({ icon: Icon, label }) => (
                <li key={label} className="flex items-center gap-2">
                  <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                  {label}
                </li>
              ))}
            </ul>
            <Link
              href="/actividades"
              className="mt-2 inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-2"
            >
              Ver qué pasa en cada salón
            </Link>
          </CardContent>
        </Card>

        <Card className="sm:col-span-2 lg:col-span-1">
          <CardHeader className="gap-2">
            <span className={ICON_CHIP}>
              <ScrollText aria-hidden className="size-5" />
            </span>
            <CardTitle as="h2">Historia</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-3 border-l pl-4">
              {HISTORY.map(({ year, text }) => (
                <li key={text} className="relative">
                  <span
                    aria-hidden
                    className="absolute top-1.5 -left-[1.3rem] size-2 rounded-full bg-primary"
                  />
                  <p className="font-mono text-sm font-semibold tabular-nums">{year}</p>
                  <p className="text-sm text-muted-foreground">{text}</p>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
