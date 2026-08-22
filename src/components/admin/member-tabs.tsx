"use client";
// Pestañas de la ficha (Radix Tabs, variante línea) con `?tab=` en la URL para
// que "Cuenta corriente" sea enlazable desde tesorería y el botón atrás funcione.
//
// Radix y no links como en Tesorería: allá cada pestaña es una ruta distinta y
// cambiar de pestaña es navegar; acá los paneles ya están en la página y
// navegar volvería a pedir la ficha entera para mover el foco de lugar.
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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
      {/* `h-auto` pisa el `h-8` de la variante compartida: los targets de 44px
          del panel no entran en 32px y quedarían recortados por el scroll
          horizontal. El `pb-2` deja adentro del recuadro la línea de la pestaña
          activa, que Radix dibuja 5px por debajo del trigger. */}
      <TabsList
        variant="line"
        className="group-data-horizontal/tabs:h-auto w-full justify-start overflow-x-auto pb-2"
      >
        {tabs.map((t) => <TabsTrigger key={t.value} value={t.value} className="min-h-11 flex-none px-3">{t.label}</TabsTrigger>)}
      </TabsList>
      {tabs.map((t) => <TabsContent key={t.value} value={t.value} className="pt-4">{panels[t.value]}</TabsContent>)}
    </Tabs>
  );
}
