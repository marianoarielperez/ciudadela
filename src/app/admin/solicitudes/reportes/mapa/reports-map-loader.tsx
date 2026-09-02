"use client";

// `dynamic(..., { ssr: false })` está PROHIBIDO dentro de un Server Component
// en Next 15/16: este wrapper cliente existe sólo para eso (mismo motivo que
// `location-picker-loader.tsx`, `sede-map-loader.tsx` y
// `report-mini-map-loader.tsx`). El chunk de Leaflet se baja recién al abrir
// esta pantalla, así que la cola de reportes no lo paga.
import dynamic from "next/dynamic";

const ReportsMapLoader = dynamic(() => import("./reports-map"), {
  ssr: false,
  loading: () => (
    <div
      aria-hidden
      className="h-[70vh] min-h-[24rem] w-full animate-pulse bg-muted motion-reduce:animate-none"
    />
  ),
});

export default ReportsMapLoader;
export type { MapPoint } from "./reports-map";
