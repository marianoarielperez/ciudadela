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
import type { ComponentType, ReactNode } from "react";
import { Banknote, Clock, Mail, Server } from "lucide-react";

import { SALUD_TABS, type SaludTab, type SaludTabId } from "@/lib/admin/salud-tabs";
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
      {/* `h-auto` pisa el `h-8` de la variante (targets de 44px); `pb-2` deja
          adentro la línea activa que Radix dibuja 5px bajo el trigger;
          `border-b` es el riel canónico de las pestañas del panel. */}
      <TabsList
        variant="line"
        aria-label="Secciones de salud"
        className="group-data-horizontal/tabs:h-auto w-full justify-start overflow-x-auto border-b pb-2"
      >
        {SALUD_TABS.map((t) => {
          const Icon = ICONS[t.icon];
          const count = actCounts[t.value] ?? 0;
          return (
            <TabsTrigger
              key={t.value}
              value={t.value}
              className="min-h-11 flex-none gap-1.5 px-3 after:bg-primary data-active:font-semibold"
            >
              <Icon className="size-4 shrink-0" aria-hidden />
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
      {SALUD_TABS.map((t) => (
        <TabsContent key={t.value} value={t.value} className="pt-4">
          {panels[t.value]}
        </TabsContent>
      ))}
    </Tabs>
  );
}
