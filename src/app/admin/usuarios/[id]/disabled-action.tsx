"use client";
// El botón que la pantalla no ofrece, con el motivo al lado. Lo comparten
// `role-forms.tsx` y `account-forms.tsx`: el markup era el mismo en los dos y
// la accesibilidad tenía que arreglarse en un solo lugar.
//
// Accesibilidad, que es la razón de que esto no sea sólo `<Button disabled>`:
//  - `aria-label` va TAMBIÉN en la rama deshabilitada. Sin él, el lector de
//    pantalla dicta "Quitar Superadmin, no disponible" sin decir de quién, y en
//    esta pantalla hay varios botones con la misma etiqueta visible.
//  - el motivo se ASOCIA con `aria-describedby`. Suelto en un `<span>` hermano
//    no lo anuncia nadie: la persona escucha que no se puede y no por qué.
import { Button } from "@/components/ui/button";

export function DisabledAction(props: {
  /** Texto visible del botón. */
  label: string;
  /** El motivo, con el texto del dominio (USER_GUARD_MESSAGES). */
  reason: string;
  /** Lo que el lector de pantalla anuncia: el MISMO que lleva la rama
   *  habilitada, con el nombre de la persona adentro. */
  ariaLabel: string;
  /** id del `<span>` del motivo. Único en la página: se deriva del userId y de
   *  la acción, que juntos no se repiten. */
  reasonId: string;
}) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        className="min-h-11"
        disabled
        aria-label={props.ariaLabel}
        aria-describedby={props.reasonId}
      >
        {props.label}
      </Button>
      <span id={props.reasonId} className="text-xs text-muted-foreground">{props.reason}</span>
    </span>
  );
}
