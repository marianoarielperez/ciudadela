"use client";
// La acción de fase "Iniciar 2ª instancia".
//
// El punto de esta pantalla es que el operador vea POR QUÉ el botón está
// apagado sin tener que adivinar. Hay tres motivos posibles y cada uno se dice
// con todas las letras:
//
//   1. No es superadmin — abrir el último plazo del Art. 9° bis es un acto de la
//      Comisión. Lo que se ve deshabilitado es exactamente lo que la action
//      rechaza (`requireSuperadmin`); acá el flag es SÓLO display.
//   2. La primera instancia todavía corre — y entonces aparece la escotilla:
//      un tilde explícito "Iniciar antes de tiempo". No es un botón secreto:
//      el Art. 9° bis no obliga a esperar y la Comisión manda sobre el
//      calendario, pero adelantarlo le come días a un plazo del que cuelga una
//      baja, así que no puede pasar por un clic distraído.
//   3. El proceso ya no está en primera instancia — no hay nada que iniciar.
import { useActionState, useState } from "react";

import { FormMessage } from "@/components/admin/form-message";
import { Button } from "@/components/ui/button";
import { startSecondAction } from "./actions";

export function SecondInstanceForm({ processId, superadmin, expired, deadlineLabel, daysLeftLabel }: {
  processId: number;
  superadmin: boolean;
  /** `hasExpired(firstEndsAt)` resuelto en el servidor: el navegador del
   *  operador puede tener cualquier fecha y de este plazo cuelga una baja. */
  expired: boolean;
  deadlineLabel: string;
  daysLeftLabel: string;
}) {
  const [state, formAction, pending] = useActionState(startSecondAction, {});
  const [force, setForce] = useState(false);

  const blocked = !superadmin || (!expired && !force);
  const reason = !superadmin
    ? "Solo el superadmin puede abrir la segunda instancia."
    : expired
      ? null
      : `La primera instancia corre hasta el ${deadlineLabel} (${daysLeftLabel.toLocaleLowerCase("es-AR")}). Para adelantarla, tildá la casilla.`;

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="processId" value={processId} />
      {!expired && superadmin && (
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="force"
            checked={force}
            onChange={(e) => setForce(e.target.checked)}
            className="size-4 rounded-[4px] border border-input outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          />
          Iniciar antes de tiempo (la Comisión resuelve adelantar el plazo)
        </label>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {/* `min-h-11`: el target táctil de 44px. `Button size="lg"` es h-9, y en
            la sede esto se toca desde el celular (precedente: `link-form.tsx`,
            `salud/resend-form.tsx`). */}
        <Button type="submit" size="lg" className="min-h-11 px-4" disabled={blocked || pending}>
          {pending ? "Iniciando…" : "Iniciar 2ª instancia"}
        </Button>
        {reason && <FormMessage kind="neutral" as="span" role="none">{reason}</FormMessage>}
      </div>
      <p className="max-w-2xl text-sm text-muted-foreground">
        Abre diez días corridos más y avisa, bajo apercibimiento de baja, a todos los convocados que
        todavía no tienen la presentación aprobada. Los que no tienen casilla van a un cartel nuevo.
      </p>
      {state.error && <FormMessage kind="error" box>{state.error}</FormMessage>}
      {state.ok && <FormMessage kind="success" box>La segunda instancia quedó abierta.</FormMessage>}
    </form>
  );
}
