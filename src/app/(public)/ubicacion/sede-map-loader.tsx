"use client";

// `dynamic(..., { ssr: false })` está PROHIBIDO dentro de un Server Component
// en Next 15/16: este wrapper cliente existe solo para eso. El chunk de
// Leaflet (~47 KB gzip) se baja recién al montar; el bundle inicial del sitio
// no cambia.
import dynamic from "next/dynamic";

const SedeMap = dynamic(() => import("./sede-map"), {
  ssr: false,
  loading: () => (
    <div aria-hidden className="h-full w-full animate-pulse bg-muted motion-reduce:animate-none" />
  ),
});

export default SedeMap;
