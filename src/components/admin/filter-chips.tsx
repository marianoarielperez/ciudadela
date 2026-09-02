// Chips de filtro por URL (M7, spec §6.3). El vocabulario es EXACTAMENTE el de
// `admin/socios/page.tsx` —las tres cadenas de clases están copiadas de ahí sin
// tocar una letra—, que sigue con su copia inline hasta que alguien la migre:
// si acá se "mejora" el estilo, las dos pantallas dejan de parecerse y la
// extracción no sirvió para nada.
//
// Son LINKS, no botones con estado: el filtro queda en la URL, así que el deep
// link, el botón atrás y el `aria-current` salen solos. Mismo criterio que
// `TreasuryTabs` y `SociosTabs`.
//
// Regla que hereda de Socios y que el que arme los `chips` tiene que sostener:
// cada chip filtra EXACTAMENTE lo que cuenta —el número que muestra y la
// cantidad de filas que aparecen al clickearlo son el mismo— y una combinación
// de filtros que ningún chip representa NO prende ninguno. Por eso `active` es
// `string | null` y no un índice: quien llama decide si la URL actual
// corresponde a un chip, y "ninguno" es una respuesta válida.
import Link from "next/link";

import { cn } from "@/lib/utils";

export type FilterChip = { key: string; label: string; href: string; count?: number };

const BASE =
  "inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-medium outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-ring";
const ACTIVE = "bg-background text-foreground shadow-sm";
const INACTIVE = "text-muted-foreground hover:text-foreground";

export function FilterChips({
  label,
  chips,
  active,
}: {
  label: string;
  chips: FilterChip[];
  active: string | null;
}) {
  return (
    <nav aria-label={label} className="flex w-fit max-w-full flex-wrap gap-1 rounded-lg bg-muted p-1">
      {chips.map((chip) => (
        <Link
          key={chip.key}
          href={chip.href}
          aria-current={active === chip.key ? "page" : undefined}
          className={cn(BASE, active === chip.key ? ACTIVE : INACTIVE)}
        >
          {chip.label}
          {/* `!== undefined` y no un truthy check: un contador en cero es un
              dato ("Presentados 0"), no un chip sin contador. */}
          {chip.count !== undefined && <span className="font-mono tabular-nums">{chip.count}</span>}
        </Link>
      ))}
    </nav>
  );
}
