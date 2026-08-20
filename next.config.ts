import type { NextConfig } from "next";

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
// - connect-src 'self': navegación RSC y Server Actions, todo al mismo origen.
// - frame-src: SOLO el embed de OpenStreetMap de /ubicacion. Ojo: un iframe
//   bloqueado por CSP no rompe nada visible, deja un recuadro vacío en
//   silencio — si se cambia el proveedor de mapa hay que tocar acá.
// - frame-ancestors 'none' + X-Frame-Options: DENY: la segunda es para los
//   navegadores viejos que no leen frame-ancestors.
// - upgrade-insecure-requests: en prod todo va por HTTPS detrás de Cloudflare.
//   No molesta al probar el build local sobre http://localhost: el navegador
//   trata a localhost como origen confiable y no lo reescribe a https.
//
// Módulo 3 (Mercado Pago + Turnstile): descomentar los orígenes marcados. Se
// dejan escritos para que el M3 no arranque con la CSP rota.
const MP = ""; // M3: " https://sdk.mercadopago.com https://http2.mlstatic.com"
const TURNSTILE = ""; // M3: " https://challenges.cloudflare.com"

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${MP}${TURNSTILE}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src 'self'${MP}`,
  `frame-src https://www.openstreetmap.org${TURNSTILE}`,
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

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
  experimental: {
    // El default de Next es 1 MB y la portada de una noticia puede pesar
    // hasta MAX_COVER_BYTES (5 MB): sin esto el body parser corta ANTES de
    // que saveNewsCover pueda devolver su mensaje en castellano.
    serverActions: { bodySizeLimit: "5mb" },
  },
};

export default nextConfig;
