"use client";
// Formulario de Configuración.
//
// El campo delicado es el checkbox del botón ASOCIATE: React 19 resetea el
// <form action> cuando la server action termina, y un checkbox destildado por
// ese reset no lo corrige React (ver el comentario largo de
// use-form-reset-sync.ts). Acá el daño sería del peor tipo: el superadmin cierra
// el alta de socios, la action rechaza por otro campo, el reset vuelve a
// mostrarlo abierto y él se va creyendo que lo cerró. Por eso el estado del
// checkbox vive en `useSyncedForm` bajo la misma clave que su `name`, con el
// "on"/"" que manda el navegador: el hook lo re-tilda después de cada render.
import { useActionState } from "react";
import { updateConfigAction } from "./actions";
import { useSyncedForm, TextField } from "@/components/admin/synced-fields";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export function ConfigForm({
  initial,
}: {
  initial: { asociateActivo: boolean; contactPhone: string; contactEmail: string };
}) {
  const [state, formAction, pending] = useActionState(updateConfigAction, {});
  const { values, setValue, formRef, field } = useSyncedForm({
    asociateActivo: initial.asociateActivo ? "on" : "",
    contactPhone: initial.contactPhone,
    contactEmail: initial.contactEmail,
  });

  return (
    <form ref={formRef} action={formAction} className="max-w-md space-y-4">
      <div className="space-y-1">
        <Label htmlFor="asociateActivo" className="flex items-center gap-2 text-sm">
          <input
            id="asociateActivo"
            type="checkbox"
            name="asociateActivo"
            value="on"
            checked={values.asociateActivo === "on"}
            onChange={(e) => setValue("asociateActivo", e.target.checked ? "on" : "")}
          />
          Botón ASOCIATE habilitado en el sitio público
        </Label>
        <p className="text-xs text-muted-foreground">
          Apagado, el sitio muestra el aviso de asociaciones suspendidas. Se prende recién con el
          wizard del Módulo 3 funcionando.
        </p>
      </div>
      <TextField
        label="Teléfono de contacto"
        field={field("contactPhone")}
        type="tel"
        maxLength={40}
        hint="Se muestra en la página Ubicación. Dejalo vacío para ocultarlo."
      />
      <TextField
        label="Email de contacto"
        field={field("contactEmail")}
        type="email"
        maxLength={191}
        hint="Se muestra en la página Ubicación. Dejalo vacío para ocultarlo."
      />
      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? "Guardando…" : "Guardar"}
      </Button>
    </form>
  );
}
