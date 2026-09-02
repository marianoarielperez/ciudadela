"use client";
// Pestañas de Configuración: Radix Tabs con `?tab=` (calco de MemberTabs) — los
// cinco paneles ya vinieron en el HTML y mostrar otro no espera al servidor. El
// `router.replace` de abajo sí vuelve a pedir el payload RSC de la página entera
// (la ruta es `force-dynamic`), pero eso pasa DESPUÉS y en segundo plano: lo que
// hace instantáneo el cambio de panel es Radix, no un ahorro de red. Client-side
// y NO subrutas: los cuatro redirects de actions.ts apuntan a la raíz y no se
// tocan; una sola URL = una sola guarda de superadmin.
//
// El form de 8 claves envuelve sus TRES paneles con `forceMount`
// (config-form.tsx): updateConfigAction escribe las 8 claves SIEMPRE y trata
// campo ausente como vacío, así que un panel desmontado sería un borrado
// silencioso. Con forceMount Radix deja el panel montado y VISIBLE: el
// data-[state=inactive]:hidden de cada panel lo oculta por CSS y los campos
// siguen viajando en el POST (display:none no saca un control del FormData).
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ComponentType, ReactNode } from "react";
import { CalendarOff, Globe, Mail, UserPlus, Wallet } from "lucide-react";

import { CONFIG_TABS, type ConfigTab, type ConfigTabId } from "@/lib/admin/config-tabs";
import { SECTION_TAB_ICON, SECTION_TAB_RADIX_TRIGGER, SECTION_TABS_NAV_ADMIN, SECTION_TABS_RADIX_LIST } from "@/lib/ui/section-tabs";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConfigForm, type ConfigFormInitial } from "./config-form";

const ICONS: Record<ConfigTab["icon"], ComponentType<{ className?: string }>> = {
  globe: Globe,
  "user-plus": UserPlus,
  mail: Mail,
  wallet: Wallet,
  "calendar-off": CalendarOff,
};

export function ConfigTabs({ initial, configInitial, tesoreria, feriados }: {
  initial: ConfigTabId;
  configInitial: ConfigFormInitial;
  tesoreria: ReactNode;
  feriados: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  // Un `?tab=` inventado a mano no rompe la pantalla: cae en la pestaña inicial.
  const requested = params.get("tab");
  const current = requested && CONFIG_TABS.some((t) => t.value === requested) ? requested : initial;
  return (
    <Tabs
      value={current}
      onValueChange={(value) => {
        const next = new URLSearchParams(params.toString());
        if (value === initial) next.delete("tab");
        else next.set("tab", value);
        const qs = next.toString();
        // `replace` y no `push`: cada clic de pestaña en el historial obligaría
        // a apretar "atrás" cinco veces para salir de Configuración.
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
          aria-label="Secciones de configuración"
          className={SECTION_TABS_RADIX_LIST}
        >
          {CONFIG_TABS.map((t) => {
            const Icon = ICONS[t.icon];
            return (
              <TabsTrigger key={t.value} value={t.value} className={SECTION_TAB_RADIX_TRIGGER}>
                <Icon className={SECTION_TAB_ICON} aria-hidden />
                {t.label}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </div>
      <TabsContent value="tesoreria" className="pt-2">{tesoreria}</TabsContent>
      <TabsContent value="feriados" className="pt-2">{feriados}</TabsContent>
      <ConfigForm initial={configInitial} />
    </Tabs>
  );
}
