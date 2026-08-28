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
// en un plazo que salió corto—. La confirmación es el Dialog del design system
// (antes era window.confirm); la validación de los campos es del server (la
// action rechaza fecha inválida y nombre corto con su propio mensaje).
import { useActionState } from "react";

import { FormMessage } from "@/components/admin/form-message";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { TextField, useSyncedForm } from "@/components/admin/synced-fields";
import { createHolidayAction, deleteHolidayAction } from "./actions";

const NUM = "font-mono tabular-nums";

export function HolidayForm({ suggestedDate }: { suggestedDate: string }) {
  const [state, formAction, pending] = useActionState(createHolidayAction, {});
  const { formRef, field } = useSyncedForm({ date: suggestedDate, label: "" });
  return (
    <form ref={formRef} action={formAction} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
        <TextField label="Fecha" field={field("date")} type="date" />
        <TextField
          label="Nombre del feriado"
          field={field("label")}
          maxLength={80}
          placeholder="Día del Respeto a la Diversidad Cultural"
        />
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
  // DialogContent se monta en un portal, FUERA del árbol del form: el botón de
  // confirmar lo referencia por id con `form=`. Tras un borrado exitoso el
  // redirect re-renderiza, la fila desaparece y el diálogo se desmonta solo;
  // si la action rechaza, no hay navegación y el error se lee en el diálogo.
  const formId = `holiday-delete-${id}`;
  return (
    <>
      <Dialog>
        <form id={formId} action={formAction} className="hidden">
          <input type="hidden" name="id" value={id} />
        </form>
        <DialogTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="min-h-11 px-3"
            // Sin esto, una lista de treinta feriados le dicta al lector de
            // pantalla treinta botones "Borrar" idénticos.
            aria-label={`Borrar el feriado ${label} del ${dateLabel}`}
          >
            Borrar
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{`¿Borrar "${label}"?`}</DialogTitle>
            <DialogDescription>
              El {dateLabel} pasa a contarse como día hábil en los plazos de cartelera que se
              asienten desde ahora.
            </DialogDescription>
          </DialogHeader>
          {state.error && <FormMessage kind="error" box>{state.error}</FormMessage>}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancelar</Button>
            </DialogClose>
            <Button type="submit" form={formId} variant="destructive" disabled={pending}>
              {pending ? "Borrando…" : "Borrar feriado"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* El mismo error, también en la fila: si el diálogo se cerró con el
          borrado en vuelo, el portal ya no existe y esto es lo único que el
          operador ve. `w-full` para que ocupe su propia línea: es un tercer hijo
          del flex `justify-between` de la fila, y un error corto le corría
          "Borrar" al medio. */}
      {state.error && (
        <FormMessage kind="error" as="span" className="w-full">{state.error}</FormMessage>
      )}
    </>
  );
}

/** La fila de un feriado futuro. Cliente porque arrastra el botón de borrado; el
 *  resto del bloque lo dibuja el panel. */
export function HolidayRow({ id, label, dateLabel }: {
  id: number;
  label: string;
  dateLabel: string;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
      <span>
        <span className={NUM}>{dateLabel}</span> — {label}
      </span>
      <DeleteHolidayButton id={id} label={label} dateLabel={dateLabel} />
    </li>
  );
}
