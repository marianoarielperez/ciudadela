import type { NextConfig } from "next";

// Cabeceras de seguridad mínimas para todo el sitio. La CSP completa queda
// para el Módulo 2, cuando estén definidos los orígenes de Mercado Pago y
// Turnstile: una CSP a medias rompe pagos sin proteger de nada.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
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
