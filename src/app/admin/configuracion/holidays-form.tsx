"use client";
// El ABM de feriados: alta y borrado. Dos formularios chicos con acciones
// propias, como el valor de cuota, y no un bloque más del form de
// configuración: acá se escriben FILAS de una tabla, no claves de `Configuration`.
//
// Por qué existe esta pantalla: los veinte días hábiles de la notificación por
// cartelera (Art. 5° ter) se cuentan sobre esta tabla. Un feriado que falte se
// cuenta como día hábil y le acorta el plazo al vecino; los trasladables cambian
// por decreto cada año y el sembrador cargó sólo 2026 y 2027. Sin esta pantalla,
// corregir una fecha pedía un deploy.
//
// El borrado pide confirmación aunque sea una fila: de esa fila cuelga cuándo
// vence el plazo de cien vecinos, y el error no se ve en ninguna pantalla —se ve
// en un plazo que salió corto—.
import { useActionState } from "react";

import { FormMessage } from "@/components/admin/form-message";
import { Button } from "@/components/ui/button";
import { createHolidayAction, deleteHolidayAction } from "./actions";

const NUM = "font-mono tabular-nums";

const FIELD =
  "min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm outline-hidden focus-visible:ring-2 focus-visible:ring-ring";

export function HolidayForm({ suggestedDate }: { suggestedDate: string }) {
  const [state, formAction, pending] = useActionState(createHolidayAction, {});
  return (
    <form action={formAction} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
        <label className="space-y-1">
          <span className="block text-xs font-medium">Fecha</span>
          <input type="date" name="date" defaultValue={suggestedDate} required className={FIELD} />
        </label>
        <label className="space-y-1">
          <span className="block text-xs font-medium">Nombre del feriado</span>
          <input
            type="text"
            name="label"
            maxLength={80}
            required
            placeholder="Día del Respeto a la Diversidad Cultural"
            className={FIELD}
          />
        </label>
      </div>
      {state.error && <FormMessage kind="error" box>{state.error}</FormMessage>}
      <Button type="submit" size="lg" className="min-h-11 px-4" disabled={pending}>
        {pending ? "Cargando…" : "Cargar feriado"}
      </Button>
    </form>
  );
}

export function DeleteHolidayButton({ id, label, dateLabel }: {
  id: number;
  label: string;
  dateLabel: string;
}) {
  const [state, formAction, pending] = useActionState(deleteHolidayAction, {});
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (
          !window.confirm(
            `¿Borrar "${label}" del ${dateLabel}? Ese día pasa a contarse como hábil en los plazos ` +
              `de cartelera que se asienten desde ahora.`,
          )
        ) {
          e.preventDefault();
        }
      }}
      className="flex flex-wrap items-center gap-2"
    >
      <input type="hidden" name="id" value={id} />
      <Button
        type="submit"
        variant="outline"
        size="sm"
        className="min-h-11 px-3"
        disabled={pending}
        // Sin esto, una lista de treinta feriados le dicta al lector de pantalla
        // treinta botones "Borrar" idénticos.
        aria-label={`Borrar el feriado ${label} del ${dateLabel}`}
      >
        {pending ? "Borrando…" : "Borrar"}
      </Button>
      {state.error && <FormMessage kind="error" as="span">{state.error}</FormMessage>}
    </form>
  );
}

/** La fila de un feriado futuro. Cliente porque arrastra el botón de borrado; el
 *  resto del bloque lo dibuja la página. */
export function HolidayRow({ id, label, dateLabel }: {
  id: number;
  label: string;
  dateLabel: string;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2">
      <span>
        <span className={NUM}>{dateLabel}</span> — {label}
      </span>
      <DeleteHolidayButton id={id} label={label} dateLabel={dateLabel} />
    </li>
  );
}
