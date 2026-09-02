"use client";
// Pestañas de Salud: Radix Tabs con `?tab=` (mismo mecanismo que ConfigTabs) —
// los cuatro contenidos ya vinieron en el HTML y mostrar otro no espera al
// servidor; el `router.replace` re-pide el payload RSC en segundo plano (la
// ruta es force-dynamic). Sin `forceMount`: acá no hay un form que abarque
// varias pestañas (los ResendForm viven por fila, dentro de su panel).
//
// El punto de solapa cuenta SOLO condiciones `act` (actCountByTab): un numerito
// que sume review o historia enseña a ignorar el tablero — la lección de las 51
// firmas. El veredicto, siempre visible arriba, es quien lista el detalle.
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, type ComponentType, type ReactNode } from "react";
import { Banknote, Clock, Mail, Server } from "lucide-react";

import { SALUD_TABS, type SaludTab, type SaludTabId } from "@/lib/admin/salud-tabs";
import { SECTION_TAB_ICON, SECTION_TAB_RADIX_TRIGGER, SECTION_TABS_NAV_ADMIN, SECTION_TABS_RADIX_LIST } from "@/lib/ui/section-tabs";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const ICONS: Record<SaludTab["icon"], ComponentType<{ className?: string }>> = {
  clock: Clock,
  server: Server,
  banknote: Banknote,
  mail: Mail,
};

const INITIAL: SaludTabId = SALUD_TABS[0].value;

export function SaludTabs({ actCounts, tareas, infraestructura, dinero, correo }: {
  actCounts: Partial<Record<SaludTabId, number>>;
  tareas: ReactNode;
  infraestructura: ReactNode;
  dinero: ReactNode;
  correo: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  // Un `?tab=` inventado a mano no rompe la pantalla: cae en la inicial.
  const requested = params.get("tab");
  const current = requested && SALUD_TABS.some((t) => t.value === requested) ? requested : INITIAL;
  const panels: Record<SaludTabId, ReactNode> = { tareas, infraestructura, dinero, correo };
  // Un link del veredicto (`?tab=X#ancla`) apunta a un panel que recién se
  // monta cuando la pestaña se activa: el scroll nativo al fragmento corre
  // ANTES y no encuentra el nodo (medido en la verificación en vivo). Este
  // efecto repone el scroll después del montaje. Un clic manual de solapa no
  // re-scrollea: su `replace` arma la URL sin hash, así que acá no hay ancla.
  useEffect(() => {
    const anchor = window.location.hash.slice(1);
    if (!anchor) return;
    document.getElementById(anchor)?.scrollIntoView();
  }, [current, params]);
  return (
    <Tabs
      value={current}
      onValueChange={(value) => {
        const next = new URLSearchParams(params.toString());
        if (value === INITIAL) next.delete("tab");
        else next.set("tab", value);
        const qs = next.toString();
        // `replace` y no `push`: cada clic de solapa en el historial obligaría
        // a apretar "atrás" cuatro veces para salir de Salud.
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      }}
    >
      {/* Solapa "Carpeta" (src/lib/ui/section-tabs.ts). `variant="section"`
          apaga las reglas de estado de `line`, que pesan más que `data-active:`.
          El div de afuera es el que scrollea (mismo envoltorio que las barras
          por URL): sobre la lista, el overflow recortaría el solape de la
          solapa y forzaría una barra vertical. */}
      <div className={SECTION_TABS_NAV_ADMIN}>
        <TabsList variant="section" aria-label="Secciones de salud" className={SECTION_TABS_RADIX_LIST}>
          {SALUD_TABS.map((t) => {
            const Icon = ICONS[t.icon];
            const count = actCounts[t.value] ?? 0;
            return (
              <TabsTrigger key={t.value} value={t.value} className={SECTION_TAB_RADIX_TRIGGER}>
                <Icon className={SECTION_TAB_ICON} aria-hidden />
                {t.label}
                {count > 0 && (
                  <>
                    <span aria-hidden className="font-mono text-xs font-semibold tabular-nums text-destructive">
                      {count}
                    </span>
                    <span className="sr-only">, {count} para atender</span>
                  </>
                )}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </div>
      {SALUD_TABS.map((t) => (
        <TabsContent key={t.value} value={t.value} className="pt-4">
          {panels[t.value]}
        </TabsContent>
      ))}
    </Tabs>
  );
}
