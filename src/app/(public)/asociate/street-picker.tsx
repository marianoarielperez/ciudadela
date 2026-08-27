"use client";
// Combo sobre las 40 calles catastrales del barrio (paso 1 del wizard).
import { useEffect, useMemo, useRef, useState } from "react";
import { FormMessage } from "@/components/admin/form-message";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { searchStreets } from "@/lib/streets/search";
import { cn } from "@/lib/utils";
import { CONTROL_HEIGHT, streetLabel, type StreetOption } from "./wizard-shared";

const DEFAULT_NOT_FOUND_HINT =
  "Esa calle no está en el barrio. Revisá cómo la escribiste o volvé arriba y elegí «En otro barrio».";

/** Reusa `searchStreets` —la misma búsqueda del modo carga del panel: normaliza
 *  tildes, tolera el ordinal de "1º de mayo", parte "Hernandez , Jose" en tokens
 *  y matchea también el código catastral— en vez de inventar otra normalización.
 *
 *  No reusa `StreetAutocomplete` del panel: aquel emite sus propios hidden
 *  inputs, ofrece una salida a texto libre —que acá es una rama distinta del
 *  wizard, no un campo— y está escrito para un operador que carga cincuenta
 *  fichas con el teclado. */
export function StreetPicker({
  streets,
  streetId,
  streetName,
  onPick,
  notFoundHint = DEFAULT_NOT_FOUND_HINT,
}: {
  streets: StreetOption[];
  streetId: number | null;
  streetName: string;
  onPick: (street: StreetOption | null) => void;
  /** Qué decir cuando lo tipeado no matchea ninguna calle del catálogo. El
   *  texto por defecto manda a la rama «En otro barrio» del paso 1 de ASOCIATE,
   *  que el wizard de re-empadronamiento NO tiene: allá la cohorte es de
   *  adherentes, que por el Art. 5 viven en el barrio, y la salida es la sede.
   *  Es una prop y no un componente aparte porque todo lo demás —la
   *  normalización de `searchStreets`, el combo accesible, el respiro del blur
   *  en el celular— es exactamente lo mismo, y de eso no puede haber dos
   *  copias. */
  notFoundHint?: string;
}) {
  const [query, setQuery] = useState(streetName);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const matches = useMemo(() => searchStreets(streets, query), [streets, query]);
  const active = open && matches[highlight] ? matches[highlight] : null;

  useEffect(() => () => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
  }, []);

  function choose(street: StreetOption) {
    onPick(street);
    setQuery(streetLabel(street.name));
    setOpen(false);
    setHighlight(0);
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor="street-search" className="text-sm">
        Calle
      </Label>
      <div className="relative">
        <Input
          id="street-search"
          className={CONTROL_HEIGHT}
          autoComplete="off"
          placeholder="Escribí las primeras letras"
          role="combobox"
          aria-expanded={open}
          // Sólo mientras la lista existe: apuntar a un id ausente es una
          // referencia rota para el lector de pantalla.
          aria-controls={open && matches.length > 0 ? "street-listbox" : undefined}
          aria-autocomplete="list"
          aria-describedby="street-search-hint"
          aria-activedescendant={active ? `street-option-${active.id}` : undefined}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            onPick(null);
            setOpen(true);
            setHighlight(0);
          }}
          onFocus={() => setOpen(true)}
          // El clic en una opción dispara blur antes que el mousedown en
          // algunos navegadores móviles: el respiro evita que la lista se
          // cierre debajo del dedo.
          onBlur={() => {
            blurTimer.current = setTimeout(() => setOpen(false), 150);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              if (!open) return setOpen(true);
              const delta = e.key === "ArrowDown" ? 1 : -1;
              setHighlight((h) =>
                matches.length === 0 ? 0 : (h + delta + matches.length) % matches.length,
              );
              return;
            }
            if (e.key === "Escape") return setOpen(false);
            if (e.key === "Enter" && open && matches[highlight]) {
              e.preventDefault();
              choose(matches[highlight]);
            }
          }}
        />
        {open && matches.length > 0 && (
          <ul
            id="street-listbox"
            role="listbox"
            aria-label="Calles del barrio"
            className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-border bg-background shadow-lg"
          >
            {matches.map((street, i) => (
              <li
                key={street.id}
                id={`street-option-${street.id}`}
                role="option"
                aria-selected={i === highlight}
                className={cn(
                  "flex min-h-12 cursor-pointer items-center px-4 py-2.5 text-base",
                  i === highlight && "bg-accent",
                )}
                onMouseEnter={() => setHighlight(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(street);
                }}
              >
                {streetLabel(street.name)}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Un solo contenedor con el id del `aria-describedby`: las tres
          variantes son el mismo mensaje del campo, y si el id apareciera y
          desapareciera con la rama, la referencia quedaría colgada. */}
      <div id="street-search-hint">
        {streetId !== null ? (
          <FormMessage kind="success" role="none" className="text-xs">
            Calle del barrio: {streetName}
          </FormMessage>
        ) : query.trim() !== "" && matches.length === 0 ? (
          // Ayuda del campo mientras se tipea, no respuesta a una acción: con
          // `role="alert"` el lector de pantalla interrumpiría en cada tecla.
          <FormMessage kind="warning" role="none" className="text-xs">
            {notFoundHint}
          </FormMessage>
        ) : (
          <p className="text-xs text-muted-foreground">
            Elegí tu calle de la lista. También podés buscar por el número de catálogo.
          </p>
        )}
      </div>
    </div>
  );
}
