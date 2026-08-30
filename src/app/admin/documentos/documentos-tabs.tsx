"use client";
// Pestañas de Documentos: Radix Tabs con `?tab=` (calco de config-tabs.tsx).
// Los cuatro paneles llegan renderizados del servidor; Radix solo decide cuál
// se ve. Los chips de año son <Link> server-side que llevan `?tab=` en el href,
// así que un clic en un chip no saca al operador de su pestaña.
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ComponentType, ReactNode } from "react";
import { BookOpen, ChartColumn, Files, Scale } from "lucide-react";

import {
  DOCUMENTOS_TABS,
  type DocumentosTab,
  type DocumentosTabId,
} from "@/lib/admin/documentos-tabs";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const ICONS: Record<DocumentosTab["icon"], ComponentType<{ className?: string }>> = {
  scale: Scale,
  "book-open": BookOpen,
  "chart-column": ChartColumn,
  files: Files,
};

export function DocumentosTabs({ initial, normas, memorias, balances, otros }: {
  initial: DocumentosTabId;
  normas: ReactNode;
  memorias: ReactNode;
  balances: ReactNode;
  otros: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  // Un `?tab=` inventado no rompe la pantalla: cae en la pestaña inicial.
  const requested = params.get("tab");
  const current = requested && DOCUMENTOS_TABS.some((t) => t.value === requested) ? requested : initial;
  const panels: Record<DocumentosTabId, ReactNode> = { normas, memorias, balances, otros };
  return (
    <Tabs
      value={current}
      onValueChange={(value) => {
        const next = new URLSearchParams(params.toString());
        if (value === initial) next.delete("tab");
        else next.set("tab", value);
        // El filtro de año es de la pestaña que se abandona: no viaja.
        next.delete("anio");
        const qs = next.toString();
        // `replace` y no `push`: cada clic de pestaña en el historial obligaría
        // a apretar "atrás" cuatro veces para salir de Documentos.
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      }}
    >
      {/* `h-auto` pisa el `h-8` de la variante compartida (los targets de 44px
          no entran en 32px); `pb-2` deja adentro la línea activa que Radix
          dibuja 5px por debajo del trigger; `border-b` es el riel. */}
      <TabsList
        variant="line"
        aria-label="Tipos de documento"
        className="group-data-horizontal/tabs:h-auto w-full justify-start overflow-x-auto border-b pb-2"
      >
        {DOCUMENTOS_TABS.map((t) => {
          const Icon = ICONS[t.icon];
          return (
            <TabsTrigger
              key={t.value}
              value={t.value}
              className="min-h-11 flex-none gap-1.5 px-3 after:bg-primary data-active:font-semibold"
            >
              <Icon className="size-4 shrink-0" aria-hidden />
              {t.label}
            </TabsTrigger>
          );
        })}
      </TabsList>
      {DOCUMENTOS_TABS.map((t) => (
        <TabsContent key={t.value} value={t.value} className="pt-2">
          {panels[t.value]}
        </TabsContent>
      ))}
    </Tabs>
  );
}
