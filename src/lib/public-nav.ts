// Secciones del sitio público. Puro y sin JSX a propósito (mismo criterio que
// src/lib/admin/nav.ts y src/lib/mi/nav.ts): es la ÚNICA fuente de la lista, y
// la comparten la nav del header (`SiteNav`, client component) y la columna
// "Secciones" del pie (`SiteFooter`, que además montan el 404 y la pantalla de
// error). Agregar una sección pública = agregar un ítem acá.
//
// Este módulo NO puede importar nada de servidor (ni Prisma, ni `auth()`, ni
// `configuration`): `SiteFooter` tiene que seguir siendo client-safe, y
// `SiteNav` es `"use client"`.
//
// Tuplas `[href, label]` en vez de objetos: es lo que los dos consumidores ya
// desestructuraban, y `as const` deja los href literales para el
// `aria-current` de la nav.
export const PUBLIC_NAV_LINKS = [
  ["/", "Inicio"],
  ["/noticias", "Noticias"],
  ["/actividades", "Actividades"],
  ["/ubicacion", "Ubicación"],
] as const;
