// Datos institucionales estáticos de la Asociación. Lo que puede cambiar
// (teléfono, email de contacto) vive en la tabla `configuration` y se edita
// desde /admin/configuracion; esto es lo que no cambia.
export const SITE = {
  name: "Asociación Vecinal del Barrio Ciudadela",
  shortName: "Vecinal Ciudadela",
  city: "Comodoro Rivadavia, Chubut",
  address: "Cerro Catedral N° 286, Barrio Ciudadela",
  // Coordenadas de la sede (provistas por la Comisión).
  lat: -45.79713687,
  lng: -67.494067,
  founded: "4 de agosto de 1964",
  legallyFounded: "27 de febrero de 2015",
  legalStatus: "Personería jurídica 4139 — Resolución 184/15",
  rooms: { historic: "Salón Histórico", glass: "Salón Vidriado" },
} as const;

// URL base absoluta para metadata/sitemap. AUTH_URL ya apunta al dominio del
// entorno (staging o producción); en dev cae a localhost.
export function siteBaseUrl(): URL {
  return new URL(process.env.AUTH_URL ?? "http://localhost:3000");
}
