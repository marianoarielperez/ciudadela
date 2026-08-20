import type { Metadata } from "next";
import { getContactInfo } from "@/lib/config";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Ubicación — Vecinal Ciudadela",
  description: `Dónde queda la sede de la ${SITE.name} y cómo contactarnos.`,
};

// Bounding box chico alrededor de la sede para el embed de OpenStreetMap:
// ~0,004° son unas cuatro cuadras a cada lado, suficiente para ubicar la
// esquina sin perder los nombres de las calles.
const D = 0.004;
// toFixed(6) para que la resta en punto flotante no filtre a la URL un
// `-45.793136870000005`. A esta latitud el sexto decimal son ~10 cm: sobra para
// un recuadro de cuatro cuadras.
const bbox = (v: number) => v.toFixed(6);
const OSM_EMBED =
  `https://www.openstreetmap.org/export/embed.html?bbox=${bbox(SITE.lng - D)}%2C${bbox(SITE.lat - D)}%2C${bbox(SITE.lng + D)}%2C${bbox(SITE.lat + D)}` +
  `&layer=mapnik&marker=${SITE.lat}%2C${SITE.lng}`;
const OSM_LINK = `https://www.openstreetmap.org/?mlat=${SITE.lat}&mlon=${SITE.lng}#map=17/${SITE.lat}/${SITE.lng}`;

export default async function UbicacionPage() {
  const contact = await getContactInfo();

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10">
      <h1 className="text-2xl font-semibold">Ubicación y contacto</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Dónde queda la sede de la {SITE.name} y cómo comunicarte con la Comisión Directiva.
      </p>

      {/* Tres hijos del grid, no dos columnas con todo el texto de un lado: en
          el celular una página titulada "Ubicación" tiene que contestar "dónde
          queda" arriba de todo, y con el contacto metido antes el mapa
          arrancaba abajo del pliegue (y con loading="lazy" ni siquiera empezaba
          a bajarse hasta que el vecino scrolleaba). El orden del DOM es el
          orden de lectura — sede → mapa → contacto — sin `order-*`; en md el
          auto-placement deja la dirección al lado de su propio mapa y el
          contacto abajo. */}
      <div className="mt-8 grid gap-8 md:grid-cols-2">
        <div>
          <h2 className="text-lg font-semibold">La sede</h2>
          <address className="mt-2 space-y-1 text-sm not-italic">
            <span className="block font-medium">{SITE.name}</span>
            <span className="block">{SITE.address}</span>
            <span className="block">{SITE.city}</span>
          </address>
          {/* El footer ya repite en todas las páginas el nombre, la dirección,
              la personería y la fecha de fundación, así que acá no va otra
              ficha institucional: se imprime solo la fundación legal, que es la
              única fecha que no está en ningún otro lado del sitio. */}
          <p className="mt-2 text-sm text-muted-foreground">
            Fundación legal: {SITE.legallyFounded}.
          </p>
          <p className="mt-3 text-sm">
            {/* target="_blank" + rel: el mapa completo se abre afuera para no
                perder la página; rel="noopener" es obligatorio con _blank. */}
            <a
              className="text-primary underline"
              href={OSM_LINK}
              target="_blank"
              rel="noopener noreferrer"
            >
              Ver el mapa completo en OpenStreetMap
            </a>
          </p>
        </div>

        {/* El title es lo único que un lector de pantalla anuncia de un iframe:
            sin él dice "marco" y nada más. Va segundo, pegado a la dirección que
            ilustra: en el celular entra arriba del pliegue y `loading="lazy"` ya
            no lo demora hasta el primer scroll. */}
        <iframe
          src={OSM_EMBED}
          title={`Mapa de OpenStreetMap con la sede vecinal marcada en ${SITE.address}, ${SITE.city}`}
          className="h-80 w-full rounded-lg border"
          loading="lazy"
        />

        <div>
          <h2 className="text-lg font-semibold">Contacto</h2>
          {/* Teléfono y email viven en la tabla `configuration` y hoy están
              vacíos: mientras nadie los cargue, el bloque explica el hueco en
              vez de dejarlo. No es un borde raro, es el estado inicial. */}
          {contact.phone || contact.email ? (
            <ul className="mt-2 space-y-1 text-sm">
              {contact.phone && (
                <li>
                  Teléfono:{" "}
                  <a
                    className="text-primary underline"
                    href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`}
                  >
                    {contact.phone}
                  </a>
                </li>
              )}
              {contact.email && (
                <li className="[overflow-wrap:anywhere]">
                  Email:{" "}
                  <a className="text-primary underline" href={`mailto:${contact.email}`}>
                    {contact.email}
                  </a>
                </li>
              )}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              Todavía no hay un teléfono ni un email de contacto publicados. Podés acercarte a la
              sede, en la dirección de acá arriba.
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
