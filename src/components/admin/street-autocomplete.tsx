"use client";
// Autocompletado del catálogo de calles del barrio (40 calles catastrales).
//
// No usa <ActionForm>: ese componente recibe los campos como especificación
// serializable y sólo sabe de texto, fecha y select. Acá hace falta un combo con
// filtrado en el cliente, teclado y salida a texto libre, así que va aparte.
//
// Las 40 calles viajan enteras al cliente: son ~2 KB y así el filtrado es
// instantáneo. En una pantalla cuyo criterio de aceptación es "menos de 2
// minutos por ficha", un round-trip por tecla no es una opción.
//
// Emite `streetId` (oculto) cuando la calle es del catálogo y `streetText`
// cuando no. Nunca emite las dos: la action prioriza el id igual, pero mandar
// las dos escondería un domicilio ambiguo.
import { useMemo, useRef, useState } from "react";
import { searchStreets } from "@/lib/streets/search";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type StreetOption = { id: number; name: string; loadOrder: number };

export function StreetAutocomplete(props: {
  streets: StreetOption[];
  defaultStreetId: number | null;
  defaultStreetText: string | null;
  autoFocus?: boolean;
}) {
  const initial = props.streets.find((s) => s.id === props.defaultStreetId) ?? null;
  const [freeMode, setFreeMode] = useState(!initial && !!props.defaultStreetText);
  const [selected, setSelected] = useState<StreetOption | null>(initial);
  const [query, setQuery] = useState(initial?.name ?? "");
  // Controlado a propósito: con defaultValue, el reset de React 19 al terminar
  // la action le borraría al operador la calle que acaba de tipear.
  const [freeText, setFreeText] = useState(initial ? "" : props.defaultStreetText ?? "");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(() => searchStreets(props.streets, query), [props.streets, query]);

  function choose(street: StreetOption) {
    setSelected(street);
    setQuery(street.name);
    setOpen(false);
    setHighlight(0);
  }

  if (freeMode) {
    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Label htmlFor="streetText">Calle (fuera del barrio)</Label>
          {/* Fuera del orden de tabulación: en modo carga se pasa de campo en
              campo con Tab y este botón se usa una vez cada cincuenta fichas. */}
          <button
            type="button" tabIndex={-1} className="text-xs text-primary hover:underline"
            onClick={() => { setFreeMode(false); setQuery(""); setSelected(null); }}
          >
            Usar catálogo del barrio
          </button>
        </div>
        <Input
          id="streetText" name="streetText" autoComplete="off" maxLength={120}
          value={freeText} onChange={(e) => setFreeText(e.target.value)}
        />
      </div>
    );
  }

  const typedButUnmatched = !selected && query.trim() !== "";

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <Label htmlFor="street-search">Calle (catálogo)</Label>
        <button
          type="button" tabIndex={-1} className="text-xs text-primary hover:underline"
          onClick={() => { setFreeMode(true); setSelected(null); setFreeText(query); }}
        >
          Está en otro barrio
        </button>
      </div>

      {selected && <input type="hidden" name="streetId" value={selected.id} />}
      {/* Sin esto, lo tipeado que no coincide con el catálogo se perdería en
          silencio al guardar: el peor error posible en una carga de padrón. */}
      {typedButUnmatched && <input type="hidden" name="streetText" value={query.trim()} />}

      <div className="relative">
        <Input
          ref={inputRef}
          id="street-search" autoComplete="off" autoFocus={props.autoFocus}
          placeholder="Nombre o código (ej. hernandez, jose, 1906)"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setSelected(null); setOpen(true); setHighlight(0); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              if (!open) { setOpen(true); return; }
              const delta = e.key === "ArrowDown" ? 1 : -1;
              setHighlight((h) => (matches.length === 0 ? 0 : (h + delta + matches.length) % matches.length));
              return;
            }
            if (e.key === "Escape") { setOpen(false); return; }
            // Enter elige la calle resaltada. Sólo intercepta con la lista
            // abierta: cerrada, Enter tiene que seguir guardando la ficha.
            if (e.key === "Enter" && open && matches[highlight]) {
              e.preventDefault();
              choose(matches[highlight]);
            }
          }}
          aria-autocomplete="list" aria-expanded={open} role="combobox"
        />
        {open && matches.length > 0 && (
          /* La lista tiene scroll propio, y Chrome hace tabulable a todo
             contenedor con scroll: sin esto, salir del campo cuesta un Tab de más. */
          <ul tabIndex={-1} className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-background shadow-md">
            {matches.map((s, i) => (
              <li key={s.id}>
                <button
                  type="button"
                  // Fuera de la tabulación: las opciones se recorren con las
                  // flechas. Si fueran paradas de Tab, salir del campo con la
                  // lista abierta costaría una pulsación por calle listada.
                  tabIndex={-1}
                  className={`w-full px-3 py-1.5 text-left text-sm hover:bg-accent ${i === highlight ? "bg-accent" : ""}`}
                  onMouseEnter={() => setHighlight(i)}
                  onMouseDown={(e) => { e.preventDefault(); choose(s); }}
                >
                  {s.name} <span className="text-muted-foreground">({s.loadOrder})</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {typedButUnmatched && (
        <p className="text-xs text-amber-700 dark:text-amber-500">
          No coincide con el catálogo: se va a guardar como texto libre.
        </p>
      )}
      {selected && (
        <p className="text-xs text-muted-foreground">Catálogo N° {selected.loadOrder}</p>
      )}
    </div>
  );
}
