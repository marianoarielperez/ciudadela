"use client";
// El formulario que CIERRA el libro. Es deliberadamente incómodo: acta de
// cierre, casilla de confirmación con el aviso completo y recién ahí el botón.
// Lo que el operador tilda acá es exactamente lo que la action re-exige del
// lado del servidor — la casilla no es cosmética: sin `confirmar=1` el POST se
// rechaza, también el armado a mano.
import { useActionState, useState } from "react";

import { FormMessage } from "@/components/admin/form-message";
import { MinutePicker, type MinuteOption } from "@/components/admin/minute-picker";
import { Button } from "@/components/ui/button";
import { closeBookAction, type CloseBookState } from "./actions";

const NUM = "font-mono tabular-nums";

export function ConfirmCloseForm({ processId, oldNumber, newNumber, migrantCount, minutes }: {
  processId: number;
  oldNumber: number;
  newNumber: number;
  migrantCount: number;
  minutes: MinuteOption[];
}) {
  const [state, formAction, pending] = useActionState<CloseBookState, FormData>(closeBookAction, {});
  const [confirmed, setConfirmed] = useState(false);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="processId" value={processId} />

      {/* Borde destructivo, como el lote de bajas: este bloque no carga datos,
          cierra el documento que la asociación lleva ante la IGJ. */}
      <div className="space-y-4 rounded-md border border-destructive/40 p-3">
        <MinutePicker minutes={minutes} />

        <label className="flex min-h-11 items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="confirmar"
            value="1"
            className="mt-0.5 size-4"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          <span>
            Entiendo que este paso cierra el Libro N° <span className={NUM}>{oldNumber}</span>, abre
            el Libro N° <span className={NUM}>{newNumber}</span> con{" "}
            <span className={NUM}>{migrantCount}</span>{" "}
            {migrantCount === 1 ? "socio renumerado" : "socios renumerados"}, y que{" "}
            <strong>solo se revierte restaurando un backup</strong>.
          </span>
        </label>

        {state.error && (
          <FormMessage kind="error" box>{state.error}</FormMessage>
        )}

        <Button
          type="submit"
          variant="destructive"
          className="min-h-11 px-4"
          // Sólo display: la action vuelve a exigir la confirmación y a
          // revalidar la etapa y los bloqueos contra la base.
          disabled={!confirmed || pending}
        >
          {pending
            ? "Cerrando el libro…"
            : `Cerrar el Libro N° ${oldNumber} y abrir el N° ${newNumber}`}
        </Button>
      </div>
    </form>
  );
}
