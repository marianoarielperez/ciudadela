"use client";
// `dynamic(..., { ssr: false })` está PROHIBIDO dentro de un Server Component
// en Next 15/16: este wrapper cliente existe sólo para eso (mismo motivo que
// `location-picker-loader.tsx` y `sede-map-loader.tsx`). El chunk de Leaflet se
// baja recién al abrir una ficha con punto en el mapa.
import dynamic from "next/dynamic";

const ReportMiniMapLoader = dynamic(() => import("./report-mini-map"), {
  ssr: false,
  loading: () => (
    <div aria-hidden className="h-56 w-full animate-pulse bg-muted motion-reduce:animate-none" />
  ),
});

export default ReportMiniMapLoader;
