"use client";
// Pestañas de la ficha (Radix Tabs, variante solapa) con `?tab=` en la URL para
// que "Cuenta corriente" sea enlazable desde tesorería y el botón atrás funcione.
//
// Radix y no links como en Tesorería: allá cada pestaña es una ruta distinta y
// cambiar de pestaña es navegar; acá los cuatro paneles ya vinieron en el HTML y
// mostrar otro es puro cliente, sin esperar al servidor. El `router.replace` de
// abajo sí vuelve a pedir el payload RSC de la ficha entera (la ruta es
// `force-dynamic`), pero eso pasa DESPUÉS y en segundo plano: lo que hace
// instantáneo el cambio de panel es Radix, no un ahorro de red.
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SECTION_TAB_RADIX_TRIGGER, SECTION_TABS_NAV_ADMIN, SECTION_TABS_RADIX_LIST } from "@/lib/ui/section-tabs";

export function MemberTabs({ tabs, panels, initial }: {
  tabs: Array<{ value: string; label: string }>;
  panels: Record<string, ReactNode>;
  initial: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  // Un `?tab=` inventado a mano no rompe la pantalla: cae en la pestaña inicial.
  const requested = params.get("tab");
  const current = requested && tabs.some((t) => t.value === requested) ? requested : initial;
  return (
    <Tabs
      value={current}
      onValueChange={(value) => {
        const next = new URLSearchParams(params.toString());
        if (value === initial) next.delete("tab"); else next.set("tab", value);
        const qs = next.toString();
        // `replace` y no `push`: cada clic de pestaña en el historial obligaría
        // a apretar "atrás" cinco veces para volver al padrón.
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      }}
    >
      {/* Solapa "Carpeta" (src/lib/ui/section-tabs.ts). `variant="section"`
          apaga las reglas de estado de `line`, que pesan más que `data-active:`.
          El div de afuera es el que scrollea (mismo envoltorio que las barras
          por URL): sobre la lista, el overflow recortaría el solape de la
          solapa y forzaría una barra vertical. */}
      <div className={SECTION_TABS_NAV_ADMIN}>
        <TabsList
          variant="section"
          aria-label="Secciones de la ficha"
          className={SECTION_TABS_RADIX_LIST}
        >
          {tabs.map((t) => (
            <TabsTrigger key={t.value} value={t.value} className={SECTION_TAB_RADIX_TRIGGER}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      {tabs.map((t) => <TabsContent key={t.value} value={t.value} className="pt-4">{panels[t.value]}</TabsContent>)}
    </Tabs>
  );
}
