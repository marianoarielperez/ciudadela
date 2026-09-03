"use client";
// Nav del shell del panel de socio: pestañas por URL (links, no botones —
// deep-link, botón atrás y aria-current gratis; mismo criterio que
// TreasuryTabs). Dos presentaciones de la MISMA lista, una por corte:
//   < sm  MobileStrip: pestañas de 80×64 con el ícono arriba, la activa en
//         bloque celeste y una flecha flotante que desplaza la tira. Nace de
//         que en 375px "Solicitudes" y "Documentos" quedaban fuera de la vista
//         sin ninguna señal (spec 2026-09-02-mi-nav-movil-design).
//   ≥ sm  DesktopTabs: la tira con subrayado de siempre, sin cambios.
// Ninguna de las dos importa `section-tabs`: son la nav del shell (nivel 1),
// no pestañas de sección; tests/section-tabs.test.ts lo fija.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  Home,
  Library,
  RefreshCw,
  User,
  Wallet,
} from "lucide-react";

import { isMiTabActive, type MiTab, type MiTabIcon } from "@/lib/mi/nav";
import { cn } from "@/lib/utils";

const ICONS: Record<MiTabIcon, React.ComponentType<{ className?: string }>> = {
  home: Home,
  wallet: Wallet,
  user: User,
  "file-text": FileText,
  library: Library,
  "refresh-cw": RefreshCw,
};

export function MiTabs({ tabs }: { tabs: MiTab[] }) {
  const pathname = usePathname();
  return (
    <>
      <DesktopTabs tabs={tabs} pathname={pathname} />
      <MobileStrip tabs={tabs} pathname={pathname} />
    </>
  );
}

// ---- Escritorio (≥ sm): sin cambios respecto de la 5A ----------------------
// Targets de 48px. El -my-1/py-1 evita que overflow-x-auto recorte el anillo
// de foco (la trampa documentada en section-tabs.ts).
function DesktopTabs({ tabs, pathname }: { tabs: MiTab[]; pathname: string }) {
  return (
    <nav aria-label="Secciones del panel" className="-mx-4 -my-1 hidden overflow-x-auto px-4 py-1 sm:block">
      <ul className="flex min-w-max gap-1">
        {tabs.map((tab) => {
          const active = isMiTabActive(pathname, tab.href);
          const Icon = ICONS[tab.icon];
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-12 items-center gap-1.5 border-b-2 px-3 text-sm outline-hidden transition-colors",
                  "focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "border-primary font-semibold text-foreground"
                    : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
                )}
              >
                <Icon className="size-4 shrink-0 opacity-80" aria-hidden />
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// ---- Celular (< sm) ---------------------------------------------------------

type Edges = { overflows: boolean; atStart: boolean; atEnd: boolean };

// Holgura para "estoy en el borde": con zoom del sistema scrollLeft queda
// fraccionario y sin holgura la flecha del final no se apagaría nunca.
export const EDGE_SLACK = 2;

export function readEdges(el: HTMLElement): Edges {
  const max = el.scrollWidth - el.clientWidth;
  return {
    overflows: max > EDGE_SLACK,
    atStart: el.scrollLeft <= EDGE_SLACK,
    atEnd: el.scrollLeft >= max - EDGE_SLACK,
  };
}

// Lo que pinta el servidor (y la hidratación): desborde y al inicio, o sea la
// flecha derecha visible. Es el estado más probable en un celular; el layout
// effect lo corrige con medidas reales antes del primer pintado.
const SSR_EDGES: Edges = { overflows: true, atStart: true, atEnd: false };

function MobileStrip({ tabs, pathname }: { tabs: MiTab[]; pathname: string }) {
  const listRef = useRef<HTMLUListElement>(null);
  const lastWidth = useRef(0);
  const [edges, setEdges] = useState<Edges>(SSR_EDGES);

  const sync = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const next = readEdges(el);
    // Comparación por VALOR: el scroll dispara esto en cada tick y un objeto
    // nuevo por tick nunca sale por el bailout de setState (re-render siempre).
    setEdges((prev) =>
      prev.overflows === next.overflows && prev.atStart === next.atStart && prev.atEnd === next.atEnd
        ? prev
        : next,
    );
  }, []);

  // Posicionado inicial (spec §4): la activa a la vista ANTES de pintar,
  // escribiendo scrollLeft directo — scrollIntoView puede mover la página en
  // vertical. `offsetLeft` del <li> es relativo al <ul> porque el <ul> es
  // `relative`.
  const revealActive = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const item = el.querySelector<HTMLElement>('[aria-current="page"]')?.closest("li");
    if (!item) return;
    el.scrollLeft = Math.max(0, item.offsetLeft - (el.clientWidth - item.offsetWidth) / 2);
  }, []);

  // Se repite al cambiar de sección.
  useLayoutEffect(() => {
    revealActive();
    sync();
  }, [pathname, revealActive, sync]);

  // Las flechas se derivan del scroll y del ancho. Como flotan (absolute), que
  // aparezcan o desaparezcan no cambia el ancho de la tira: no hay vaivén
  // posible entre "hay desborde" y "ya no lo hay".
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[entries.length - 1]?.contentRect.width ?? el.clientWidth;
      // La tira volvió de `display:none` (vertical → horizontal → vertical
      // cruza `sm`): el navegador le dejó scrollLeft en 0 y hay que recentrar.
      const returned = lastWidth.current === 0 && width > 0;
      lastWidth.current = width;
      if (returned) revealActive();
      sync();
    });
    observer.observe(el);
    el.addEventListener("scroll", sync, { passive: true });
    // Un webfont que carga tarde cambia `scrollWidth` sin que haya resize: el
    // observer no se entera y la flecha quedaría mal.
    void document.fonts?.ready.then(sync);
    return () => {
      observer.disconnect();
      el.removeEventListener("scroll", sync);
    };
  }, [revealActive, sync]);

  function nudge(direction: -1 | 1) {
    const el = listRef.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: reduce ? "auto" : "smooth" });
  }

  return (
    // `-mx-4`: la tira usa el ancho entero de la pantalla (el envoltorio del
    // header trae px-4). `relative`: las flechas se posicionan contra esto, y
    // viven DENTRO del nav porque son los controles que lo operan.
    <nav aria-label="Secciones del panel" className="relative -mx-4 sm:hidden">
      {/* El padding vertical vive DENTRO del contenedor con scroll para que
          el anillo de foco (2px) de las pestañas no se recorte. La barra de
          scroll se esconde: las flechas son la señal.
          `scroll-px-16`: reserva la zona de 64px de la flecha para cualquier
          scroll-into-view (el del teclado incluido), así el foco no queda
          tapado. `overscroll-x-contain`: el gesto no se encadena al
          "volver atrás" del borde en iOS. */}
      <ul
        ref={listRef}
        className="relative flex gap-1 overflow-x-auto overscroll-x-contain scroll-px-16 px-1 pt-1.5 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {tabs.map((tab) => {
          const active = isMiTabActive(pathname, tab.href);
          const Icon = ICONS[tab.icon];
          return (
            <li key={tab.href} className="flex shrink-0 grow basis-20">
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-16 w-full flex-col items-center justify-center gap-1 rounded-[10px] px-1 text-sm font-medium outline-hidden transition-colors",
                  "focus-visible:ring-2 focus-visible:ring-ring",
                  active ? "bg-primary font-semibold text-primary-foreground" : "text-foreground hover:bg-muted",
                )}
              >
                <Icon
                  className={cn("size-6 shrink-0", active ? "text-primary-foreground" : "text-primary")}
                  aria-hidden
                />
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
      <EdgeButton side="left" shown={edges.overflows && !edges.atStart} onClick={() => nudge(-1)} />
      <EdgeButton side="right" shown={edges.overflows && !edges.atEnd} onClick={() => nudge(1)} />
    </nav>
  );
}

// El degradado y el botón flotan sobre el borde: no ocupan ancho, así que
// aparecer o desaparecer no mueve la tira. Se esconden con `hidden` (no con
// `invisible`): un botón que no se ve tampoco tiene que estar en el orden de
// tabulación. `pointer-events-none` en el envoltorio y `-auto` en el botón:
// el degradado no roba el toque a la pestaña parcial que tiene debajo.
function EdgeButton({
  side,
  shown,
  onClick,
}: {
  side: "left" | "right";
  shown: boolean;
  onClick: () => void;
}) {
  const Chevron = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <div
      // El atributo `hidden` y no la utilidad `flex`: el preflight de Tailwind v4
      // trae `[hidden]:where(:not([hidden='until-found'])) { display: none !important }`,
      // que le gana a `flex`. Bajo Tailwind v3 este patrón dejaría las dos a la vista.
      hidden={!shown}
      className={cn(
        "pointer-events-none absolute inset-y-0 flex w-16 items-center",
        side === "left"
          ? "left-0 justify-start bg-linear-to-r from-background from-40% to-transparent"
          : "right-0 justify-end bg-linear-to-l from-background from-40% to-transparent",
      )}
    >
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "group pointer-events-auto flex size-11 items-center justify-center rounded-full outline-hidden",
          side === "left" ? "ml-1" : "mr-1",
        )}
      >
        {/* El <button> es el target de 44px, pero el anillo se dibuja sobre el
            círculo visible de 36px: si no, el foco se ve como un halo suelto. */}
        <span className="flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md group-focus-visible:ring-2 group-focus-visible:ring-ring group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-background">
          <Chevron className="size-5" aria-hidden />
        </span>
        <span className="sr-only">{side === "left" ? "Ver secciones anteriores" : "Ver más secciones"}</span>
      </button>
    </div>
  );
}
