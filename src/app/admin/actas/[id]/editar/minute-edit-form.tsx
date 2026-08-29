"use client";
// Edición de un acta ya asentada. Las reglas están del lado del servidor
// (`@/lib/members/minute-edit`); acá sólo se muestran, para que el operador no
// descubra el bloqueo recién después de tipear.
import { useActionState } from "react";
import { updateMinuteAction } from "../../actions";
import { FormMessage } from "@/components/admin/form-message";
import { SelectField, TextField, useSyncedForm } from "@/components/admin/synced-fields";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
// El cleaner compartido, no una copia: su cabecera registra el incidente real
// que las copias privadas dejan de heredar.
import { digitsOnly } from "@/app/admin/tesoreria/efectivo/digits";

export type MinuteEditData = {
  id: number;
  type: string;
  number: number;
  /** Fecha civil en formato del <input type="date">: YYYY-MM-DD. */
  date: string;
  description: string | null;
};

export function MinuteEditForm(props: {
  minute: MinuteEditData;
  /** El acta ya tiene movimientos (o abre/cierra un libro): la fecha no se toca. */
  dateLocked: boolean;
  movementCount: number;
}) {
  const { minute, dateLocked } = props;
  const [state, formAction, pending] = useActionState(updateMinuteAction, {});
  // `useSyncedForm` deja los campos controlados Y re-afirma el <select> después
  // del reset de React 19: el rechazo es el caso frecuente acá (número repetido,
  // fecha bloqueada) y sin esto el tipo de acta volvía solo a "Comisión
  // Directiva" mientras el operador leía el error.
  const { field, formRef } = useSyncedForm({
    type: minute.type,
    number: String(minute.number),
    date: minute.date,
    description: minute.description ?? "",
  });

  return (
    <form ref={formRef} action={formAction} className="max-w-md space-y-4">
      <input type="hidden" name="minuteId" value={minute.id} />

      <SelectField
        label="Tipo" field={field("type")}
        options={[["board", "Comisión Directiva"], ["assembly", "Asamblea"]]}
      />
      <TextField
        label="Número" field={field("number", digitsOnly)} inputMode="numeric" maxLength={6}
        hint="Es el número que figura en el libro en papel."
      />

      {dateLocked ? (
        // El campo se muestra deshabilitado pero el valor viaja igual en un
        // hidden: el schema pide la fecha siempre, y el servidor la compara
        // contra la asentada (un POST adulterado se rechaza igual).
        <div className="space-y-1">
          <Label htmlFor="date-locked">Fecha</Label>
          <input
            id="date-locked" type="date" value={minute.date} disabled readOnly
            className="h-9 w-full rounded-md border bg-muted px-2 text-sm text-muted-foreground"
          />
          <input type="hidden" name="date" value={minute.date} />
          <p className="text-xs text-muted-foreground">
            No se puede cambiar: el acta tiene {props.movementCount === 1
              ? "1 movimiento asentado"
              : `${props.movementCount} movimientos asentados`}, y esta fecha es la fecha de
            ingreso o de egreso de esos socios (la antigüedad estatutaria no se modifica).
            Si la fecha está mal, los movimientos tienen que reasentarse por acta de la Comisión.
          </p>
        </div>
      ) : (
        <TextField
          label="Fecha" field={field("date")} type="date"
          hint="Todavía se puede corregir: el acta no tiene movimientos asentados."
        />
      )}

      <TextField label="Descripción" field={field("description")} maxLength={500} />

      {state.error && <FormMessage kind="error">{state.error}</FormMessage>}
      <Button type="submit" disabled={pending}>{pending ? "Guardando…" : "Guardar cambios"}</Button>
    </form>
  );
}
