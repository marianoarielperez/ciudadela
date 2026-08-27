"use client";
// El formulario que CIERRA el libro. Es deliberadamente incómodo: acta de
// cierre, el acta NOMBRADA en el resumen, casilla de confirmación con el aviso
// completo y recién ahí el botón. Lo que el operador tilda acá es exactamente lo
// que la action re-exige del lado del servidor — la casilla no es cosmética: sin
// `confirmar=1` el POST se rechaza, también el armado a mano.
//
// Las dos cosas que esta pantalla hace distinto del resto de los formularios con
// acta, y por qué: en el simulacro el cierre del Libro N° 1 —irreversible, se
// asienta ante la IGJ— quedó registrado con el acta de las BAJAS (la CD 126,
// creada minutos antes) y no con la CD 127 que el operador creía estar creando.
// Se sumaron dos cosas: el selector arrancaba en "Acta existente" con la primera
// de la lista ya elegida —y la lista viene por fecha descendente, así que la
// preseleccionada es la del paso anterior— y esta pantalla no nombraba el acta
// en ningún lado.
//
//   1. `defaultMode="new"`: el cierre del libro merece acta propia, así que el
//      selector arranca en "Acta nueva" con el número siguiente sugerido y la
//      fecha de hoy. Ningún acta preexistente queda elegida en silencio.
//   2. `CloseMinuteSummary`: el acta elegida se lee en el bloque que se
//      confirma, con el mismo peso que el resto de los datos irreversibles.
import { useActionState, useState } from "react";

import { FormMessage } from "@/components/admin/form-message";
import { MinutePicker } from "@/components/admin/minute-picker";
import { Button } from "@/components/ui/button";
import {
  describeMinuteChoice,
  initialMinuteChoice,
  type MinuteChoice,
  type MinuteDraftDefaults,
  type MinuteOption,
} from "@/lib/members/minute-choice";
import { closeBookAction, type CloseBookState } from "./actions";
import { CloseMinuteSummary } from "./confirm-panels";

const NUM = "font-mono tabular-nums";

export function ConfirmCloseForm({ processId, oldNumber, newNumber, migrantCount, minutes, minuteDefaults }: {
  processId: number;
  oldNumber: number;
  newNumber: number;
  migrantCount: number;
  minutes: MinuteOption[];
  minuteDefaults: MinuteDraftDefaults;
}) {
  const [state, formAction, pending] = useActionState<CloseBookState, FormData>(closeBookAction, {});
  const [confirmed, setConfirmed] = useState(false);
  // El estado inicial sale de la MISMA función que usa el selector, así que el
  // resumen no puede nombrar un acta distinta de la que está elegida.
  const [choice, setChoice] = useState<MinuteChoice>(() =>
    initialMinuteChoice({ minutes, defaultMode: "new", newDefaults: minuteDefaults }),
  );
  const minute = describeMinuteChoice(choice);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="processId" value={processId} />

      {/* Borde destructivo, como el lote de bajas: este bloque no carga datos,
          cierra el documento que la asociación lleva ante la IGJ. */}
      <div className="space-y-4 rounded-md border border-destructive/40 p-3">
        <MinutePicker
          minutes={minutes}
          defaultMode="new"
          newDefaults={minuteDefaults}
          onChoiceChange={setChoice}
        />

        <CloseMinuteSummary text={minute.text} ready={minute.ready} />

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
          // Sólo display: la action vuelve a exigir la confirmación, a resolver
          // el acta y a revalidar la etapa y los bloqueos contra la base. El
          // `!minute.ready` es para que el botón no ofrezca cerrar el libro
          // mientras el acta todavía no tiene nombre que mostrar arriba.
          disabled={!confirmed || !minute.ready || pending}
        >
          {pending
            ? "Cerrando el libro…"
            : `Cerrar el Libro N° ${oldNumber} y abrir el N° ${newNumber}`}
        </Button>
      </div>
    </form>
  );
}
