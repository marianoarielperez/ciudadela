"use client";

// `dynamic(..., { ssr: false })` está PROHIBIDO dentro de un Server Component
// en Next 15/16: este wrapper cliente existe sólo para eso (mismo motivo que
// `sede-map-loader.tsx`). El chunk de Leaflet se baja recién al montar el paso
// de ubicación, así que el bundle inicial del wizard no cambia.
import dynamic from "next/dynamic";

const LocationPickerLoader = dynamic(() => import("./location-picker"), {
  ssr: false,
  loading: () => (
    <div
      aria-hidden
      className="h-[22rem] w-full animate-pulse rounded-2xl bg-muted motion-reduce:animate-none"
    />
  ),
});

export default LocationPickerLoader;
