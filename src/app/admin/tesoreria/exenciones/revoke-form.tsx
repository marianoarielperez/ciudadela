"use client";
// El formulario que ANULA una exención vigente, con su acta.
//
// La anulación se asienta una sola vez: el dominio la cierra con un cerrojo
// optimista (`revokedAt: null` en el `where`), así que dos operadores mirando la
// misma pantalla no pueden pisar la fecha y el acta de la primera — que es el
// documento que la asociación presenta si alguien discute la baja de la
// exención. Por eso el acta se NOMBRA arriba del botón, como en el asiento: un
// acto que no se puede rehacer no se confirma a ciegas (la lección del cierre
// del Libro N° 1).
//
// Vive en una pantalla propia (`?anular={id}`) y no en un `<details>` dentro de
// cada tarjeta: `MinutePicker` escribe ids fijos para sus campos (`minuteType`,
// `minuteNumber`, `minuteDate`), así que dos selectores montados a la vez en
// modo "Acta nueva" duplicarían esos ids en el documento y cada <label> quedaría
// apuntando al primero. Con la pantalla enfocada hay exactamente uno.
import Link from "next/link";
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
import { revokeExemptionAction } from "./actions";

export function RevokeExemptionForm({ exemptionId, backHref, minutes, minuteDefaults }: {
  exemptionId: number;
  /** Adónde vuelve el que se arrepiente. */
  backHref: string;
  minutes: MinuteOption[];
  minuteDefaults: MinuteDraftDefaults;
}) {
  const [state, formAction, pending] = useActionState(revokeExemptionAction, {});
  // `defaultMode: "new"`, como el cierre del libro y por el mismo motivo: la
  // anulación se asienta en SU acta, no en la del paso anterior. Arrancar en
  // "Acta existente" preselecciona la primera de la lista, que viene ordenada
  // por fecha descendente —la más reciente—, y en una exención recién asentada
  // esa es justo el acta que la CONCEDIÓ. La verificación en vivo abrió la
  // anulación de la exención de la Comisión Directiva N° 124 con la N° 124 ya
  // elegida: la anulación habría quedado firmada con el acta que la otorga.
  // El estado inicial se calcula con la MISMA función que usa el selector, así
  // que el resumen de abajo y el control no pueden diverger.
  const [choice, setChoice] = useState<MinuteChoice>(() =>
    initialMinuteChoice({ minutes, defaultMode: "new", newDefaults: minuteDefaults }),
  );
  const minute = describeMinuteChoice(choice);

  return (
    <form action={formAction} className="space-y-4 rounded-md border border-destructive/40 p-3">
      <input type="hidden" name="exemptionId" value={exemptionId} />

      <MinutePicker
        minutes={minutes}
        defaultMode="new"
        newDefaults={minuteDefaults}
        onChoiceChange={setChoice}
      />

      <p className="text-sm">
        <span className="font-medium">Acta de la anulación:</span> {minute.text}
      </p>

      {state.error && <FormMessage kind="error" box>{state.error}</FormMessage>}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          variant="destructive"
          className="min-h-11 px-4"
          // Sólo display: la action revalida el rol, resuelve el acta y el
          // dominio vuelve a mirar el cerrojo. El `!minute.ready` es para no
          // ofrecer anular mientras el acta todavía no tiene nombre que mostrar.
          disabled={!minute.ready || pending}
        >
          {pending ? "Anulando…" : "Anular la exención"}
        </Button>
        <Button asChild variant="ghost" className="min-h-11">
          <Link href={backHref}>Volver sin anular</Link>
        </Button>
      </div>
    </form>
  );
}
