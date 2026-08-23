import type { NextConfig } from "next";
import { PHASE_PRODUCTION_BUILD } from "next/constants";

// Content-Security-Policy del sitio. Notas de cada decisión:
//
// - script-src 'unsafe-inline': Next 16 emite scripts inline de hidratación
//   (el payload RSC va en `self.__next_f.push(...)`) y la home tiene el
//   JSON-LD de la organización en un <script type="application/ld+json">.
//   La alternativa —nonces— obliga a servir TODO dinámico, y este módulo
//   estrena caché estática con invalidación por tags. Trade-off deliberado,
//   documentado en la spec §7: NO cambiar a nonces sin rehacer el cacheo.
// - style-src 'unsafe-inline': Next/styled-jsx inyectan <style> inline y
//   next/image usa `style=""` en el wrapper del blur placeholder.
// - img-src data:: los blur placeholders de next/image viajan como data: URI
//   dentro del `style` del wrapper (el hero de la home los usa). Sin esto la
//   foto aparece de golpe, sin el degradé de carga.
//   blob: no lo necesita nada hoy —no hay un solo URL.createObjectURL en
//   `src/`— pero queda declarado para que el día que el editor previsualice
//   la portada elegida antes de subirla no haya que descubrirlo por una
//   imagen en blanco.
// - font-src 'self': next/font hospeda las tipografías en /_next/static, no
//   hay pedidos a Google Fonts.
// - connect-src 'self': navegación RSC y Server Actions, todo al mismo origen;
//   más la API de Mercado Pago para el SDK del navegador (MP_CONNECT).
// - frame-src: el embed de OpenStreetMap de /ubicacion, el widget de Turnstile
//   y los iframes de Checkout Pro / Bricks (MP_FRAME). Ojo: un iframe bloqueado
//   por CSP no rompe nada visible, deja un recuadro vacío en silencio — si se
//   cambia el proveedor de mapa o el de captcha hay que tocar acá.
// - frame-ancestors 'none' + X-Frame-Options: DENY: la segunda es para los
//   navegadores viejos que no leen frame-ancestors.
// - upgrade-insecure-requests: en prod todo va por HTTPS detrás de Cloudflare.
//   Salvedad al probar el build local sobre http://localhost: las navegaciones
//   y los formularios no se ven afectados, pero un fetch que sigue a un
//   redirect SÍ se reescribe a https://localhost:3006 y aborta (verificado en
//   la task 16). Si algo así falla en local, es esta directiva — no el código.
//
// Orígenes del Módulo 3 (Mercado Pago + Turnstile), ya activos. Viven en
// arrays y no inline para que sumar o sacar un origen sea agregar un string,
// sin espacios mágicos ni cirugía de comentarios.
//
// Mercado Pago (task 21). Hoy el pago sale del sitio por navegación de PRIMER
// NIVEL a `https://www.mercadopago.com.ar/subscriptions/checkout?...`
// (`checkoutUrlFor`, usado como href y como redirect), y una navegación no la
// gobierna la CSP: los tres orígenes están declarados para que el SDK embebido
// —Bricks / el botón de suscripción, que sí monta script + iframe— funcione sin
// que haya que redescubrir esta lista por un recuadro vacío. `http2.mlstatic.com`
// es el CDN desde donde el SDK carga sus propios chunks.
const MP_SCRIPT: string[] = ["https://sdk.mercadopago.com", "https://http2.mlstatic.com"];
// Los llamados a la API de MP salen del SERVIDOR (`src/lib/mp/gateway.ts`), que
// no pasa por la CSP; esto habilita al SDK del navegador, que consulta la misma
// API para validar el formulario antes de enviarlo.
const MP_CONNECT: string[] = ["https://api.mercadopago.com"];
const MP_FRAME: string[] = ["https://www.mercadopago.com.ar"];
// Turnstile ya está EN USO (task 12: el wizard ASOCIATE y el reenvío del enlace
// de retome montan el widget). `script-src` para `api.js` y `frame-src` para el
// iframe del desafío: sin los dos, el widget queda en blanco y todo envío falla
// con "No pudimos verificar que sos una persona".
const TURNSTILE: string[] = ["https://challenges.cloudflare.com"];

// React en desarrollo necesita eval() para reconstruir callstacks; sin esto
// cada página de `next dev` loguea un error fijo de CSP que tapa errores
// reales. En producción no se emite.
const scriptSrc = [
  "'self'",
  "'unsafe-inline'",
  ...(process.env.NODE_ENV !== "production" ? ["'unsafe-eval'"] : []),
  ...MP_SCRIPT,
  ...TURNSTILE,
];

const csp = [
  "default-src 'self'",
  `script-src ${scriptSrc.join(" ")}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src ${["'self'", ...MP_CONNECT].join(" ")}`,
  `frame-src ${["https://www.openstreetmap.org", ...MP_FRAME, ...TURNSTILE].join(" ")}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join("; ");

// HSTS NO se emite acá: la termina Cloudflare (SSL/TLS → Edge Certificates),
// que es quien ve el TLS. Emitirla desde Next sobre HTTP en dev no sirve y en
// prod duplicaría la cabecera.
const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // El sitio no usa cámara, micrófono ni geolocalización: se apagan para todos
  // (incluidos los iframes de terceros, como el mapa).
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

// Hosts, además de localhost, desde los que el dev server acepta servir sus
// propios chunks de `/_next/static`. SÓLO afecta a `next dev`.
//
// Hace falta para probar contra Mercado Pago: las `back_urls` de una preferencia
// y el `back_url` de una suscripción tienen que ser públicas, así que el circuito
// de pagos se prueba a través de un túnel de cloudflared (docs/11). Entrando por
// ese host, Next bloquea sus chunks por defecto y la página llega SIN JavaScript:
// el widget de Turnstile nunca se monta, el formulario manda el captcha vacío y
// `/ingresar` responde "credenciales inválidas". El síntoma no dice nada del
// origen — parece una contraseña mal puesta.
//
// El dominio del túnel cambia en cada corrida de cloudflared: si el login vuelve
// a fallar por esto, la línea a actualizar es ésta.
const DEV_TUNNEL_ORIGINS = ["geological-expectations-winner-canal.trycloudflare.com"];

const nextConfig: NextConfig = {
  allowedDevOrigins: DEV_TUNNEL_ORIGINS,
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
  experimental: {
    // El default de Next es 1 MB y las dos subidas del sistema pesan más: la
    // portada de una noticia hasta MAX_COVER_BYTES (5 MB) y, desde el M3, el
    // DNI o el anexo del wizard ASOCIATE hasta MAX_DOCUMENT_BYTES (10 MB, la
    // foto que sale de un celular actual). Sin esto el body parser corta ANTES
    // de que la action pueda devolver su mensaje en castellano, y el vecino ve
    // un 413 en inglés.
    //
    // Tiene que ser MAYOR que el archivo más grande, no igual. El límite de Next
    // se mide sobre el cuerpo multipart ENTERO —archivo + el resto de los campos
    // + límites MIME + payload de la server action—, así que con "10mb" justos
    // un DNI de 10 MB se pasa por el peso del sobre. El margen es para el sobre,
    // no para el archivo. Los documentos van de a UNO por envío, así que 12 MB
    // cubren el caso más grande posible.
    serverActions: { bodySizeLimit: "12mb" },
  },
};

// Guarda de BUILD para las dos claves de Turnstile. Desde el M3 el captcha no
// gobierna sólo el wizard de /asociate: también /ingresar y /ingresar/recuperar.
// Si falta `NEXT_PUBLIC_TURNSTILE_SITE_KEY` el widget no monta y el formulario
// no tiene token que mandar; si falta `TURNSTILE_SECRET_KEY` la verificación
// falla cerrado (`src/lib/turnstile.ts`) y el login se rechaza. Con cualquiera
// de las dos ausente, TODO admin y TODO socio quedan afuera del panel, con el
// recupero de contraseña también bloqueado: no hay camino de vuelta desde el
// navegador, sólo por SSH.
//
// Por qué en el BUILD y no al arrancar: romper el arranque dejaría al proceso
// en crash-loop y se llevaría puesto el sitio público y los webhooks de MP
// —mucho más daño que el que se quiere evitar—. Fallar en `npm run build`, en
// cambio, es gratis: `deploy.sh` corre con `set -e`, así que el deploy se corta
// ANTES del `pm2 restart` y la versión que ya está sirviendo ni se entera.
// El VPS buildea con el mismo `.env` que después usa en runtime, así que este
// chequeo cubre el caso real (un despliegue con la variable faltante).
//
// En dev las claves de prueba públicas de Cloudflare sirven (ver `.env.example`):
// site key `1x00000000000000000000AA`, secret `1x0000000000000000000000000000000AA`.
function assertTurnstileKeys() {
  const missing = ["NEXT_PUBLIC_TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY"].filter(
    (name) => !process.env[name],
  );
  if (missing.length === 0) return;
  throw new Error(
    `Turnstile sin configurar: falta ${missing.join(" y ")} en el .env. ` +
      "El captcha protege /ingresar y /ingresar/recuperar además de /asociate: un build sin " +
      "estas claves deja a todo admin y socio afuera del panel, sin recupero de contraseña. " +
      "En desarrollo usá las claves de prueba de Cloudflare (ver .env.example).",
  );
}

// Forma de función para recibir la fase: la guarda corre SOLO en `next build`.
// `next start` (PM2) carga este mismo archivo y no debe poder morir acá.
export default function config(phase: string): NextConfig {
  if (phase === PHASE_PRODUCTION_BUILD) assertTurnstileKeys();
  return nextConfig;
}
