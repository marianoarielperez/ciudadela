// robots.txt del sitio. Ojo con qué es esto y qué no: es una señal para
// buscadores bien portados, NO un control de acceso. Lo que protege de verdad
// /admin y /mi es la autorización del servidor; esto solo evita que el
// contenido llegue al índice de Google si algún día una URL se filtra.
//
// Por eso el disallow no es solo SEO: además del panel (`/admin`) y del panel
// de socio (`/mi`), que muestran datos personales alcanzados por la Ley 25.326,
// cubre las rutas cuya URL ES un secreto (`/verificar/<token>`,
// `/acceso/<token>`, `/ingresar/restablecer/<token>`,
// `/asociate/retomar/<token>`): indexadas, el token quedaría publicado. Cada
// entrada es un prefijo, así que `/ingresar` alcanza para las tres pantallas que
// cuelgan de ahí — y `/asociate/retomar` cierra sólo el retome, porque
// `/asociate` en sí es una página pública que queremos en el índice.
import type { MetadataRoute } from "next";
import { siteBaseUrl } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      // El allow más específico gana sobre el disallow más corto: `/api` queda
      // cerrado entero salvo las portadas de noticias, que son públicas a
      // propósito y son la imagen `og:image` de cada nota — sin esta excepción
      // los scrapers que respetan robots.txt no podrían levantarlas.
      allow: ["/", "/api/imagenes/"],
      disallow: [
        "/admin",
        "/mi",
        "/api",
        "/ingresar",
        "/verificar",
        "/acceso",
        "/asociate/retomar",
        "/redirigir",
      ],
    },
    sitemap: new URL("/sitemap.xml", siteBaseUrl()).toString(),
  };
}
