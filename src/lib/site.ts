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
  rooms: {
    historic: "Salón Histórico",
    glass: "Salón Vidriado",
    kitchen: "Cocina",
    classroom: "Aulas",
  },
  // Presencia digital de la asociación (la usa el footer). URLs provistas
  // por el operador el 27/08/2026.
  social: {
    facebook: "https://www.facebook.com/vecinalciudadela",
    whatsapp: "https://whatsapp.com/channel/0029Vb5B4S29sBICFUz8ih1i",
  },
} as const;

// Hosts que NO pueden ser la base pública del sitio: si el build los hornea,
// lo que se publica apunta a la máquina del visitante, no al sitio.
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

// Escotilla para el caso legítimo de correr `next build` en la máquina de
// desarrollo (donde AUTH_URL ES localhost a propósito, porque Auth.js lo usa
// para los callbacks de `next dev`). NUNCA en el VPS.
const ESCAPE_HATCH = "ALLOW_LOCALHOST_BASE_URL";

// URL base absoluta para metadata/sitemap. AUTH_URL ya apunta al dominio del
// entorno (staging o producción); en dev cae a localhost.
//
// Ojo: este valor se HORNEA en el build. robots.txt, el sitemap, la home y
// todos los `canonical` salen estáticos, así que un build con AUTH_URL vacía o
// en localhost publica el sitio entero apuntando a localhost — y un canonical
// a localhost es peor que ninguno, porque desindexa. Por eso acá se rompe el
// build en vez de dejarlo salir con exit 0.
//
// La condición no puede ser sólo `NODE_ENV === "production"`: `next build` fija
// NODE_ENV=production también localmente, donde localhost es el valor correcto.
// De ahí la escotilla explícita, que en el VPS no existe.
export function siteBaseUrl(): URL {
  const raw = process.env.AUTH_URL;
  // Parseo tolerante: un AUTH_URL sin esquema ("sigev.redaccion.ar") es un
  // tipeo plausible en el .env del VPS, y `new URL()` ahí tira ERR_INVALID_URL.
  // Si eso ocurriera dentro de la condición de abajo, el build moriría con ese
  // error críptico en vez del mensaje redactado que existe para este caso.
  const parsed = raw ? safeParseUrl(raw) : null;
  if (
    process.env.NODE_ENV === "production" &&
    process.env[ESCAPE_HATCH] !== "1" &&
    (!raw || !parsed || LOCAL_HOSTS.has(parsed.hostname))
  ) {
    const problema = !raw
      ? "no está definida"
      : !parsed
        ? `no es una URL válida ("${raw}") — ¿le falta el https:// ?`
        : `apunta a localhost ("${raw}")`;
    throw new Error(
      `AUTH_URL ${problema} en un build de producción: el sitemap, el robots.txt y todos los ` +
        "canonical saldrían apuntando a localhost. Definí AUTH_URL con el dominio del entorno, " +
        `o ${ESCAPE_HATCH}=1 si de verdad es un build local de prueba.`,
    );
  }
  // Fuera de producción un AUTH_URL roto tampoco puede tumbar el proceso: se
  // cae al default local, que es lo que el desarrollador esperaba igual.
  return parsed ?? new URL("http://localhost:3000");
}

function safeParseUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}
