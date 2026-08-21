"use client";
// Las dos decisiones que la Comisión toma sobre una solicitud VIVA, en la misma
// Card del detalle: corregirle la categoría y rechazarla.
//
// Cliente y con estado propio por lo mismo que `action-form.tsx` del padrón:
// React 19 resetea el <form action> cuando la action termina, y acá el rechazo
// es un caso frecuente (otro admin la resolvió, el número de acta ya existe, MP
// no aceptó el cambio de monto). Sin estado propio, cada error le borraría al
// operador la categoría elegida y los datos del acta que acababa de tipear.
//
// El rechazo va detrás de un <details> cerrado y no a la vista: es
// irreversible, retiene plata del vecino y bloquea su DNI por seis meses. Abrirlo
// es un acto deliberado, no un botón al lado del de guardar.
import { useActionState, useRef, useState } from "react";
import { FormMessage } from "@/components/admin/form-message";
import { MinutePicker, type MinuteOption } from "@/components/admin/minute-picker";
import { useFormResetSync } from "@/components/admin/use-form-reset-sync";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { changesFeeAmount } from "@/lib/applications/decision";
import type { MemberCategory } from "@/generated/prisma/client";

type State = { error?: string };
type Action = (prev: State, fd: FormData) => Promise<State>;

export function DecisionForms(props: {
  recategorize: Action;
  reject: Action;
  applicationId: number;
  currentCategory: MemberCategory;
  /** Las categorías web que ESTA solicitud puede tomar, ya filtradas por la
   *  residencia declarada (Art. 5 y 5 bis) y sin la actual. */
  options: [MemberCategory, string][];
  hasSubscription: boolean;
  minutes: MinuteOption[];
}) {
  const [reState, recategorizeAction, recategorizePending] = useActionState(props.recategorize, {});
  const [rjState, rejectAction, rejectPending] = useActionState(props.reject, {});
  const [category, setCategory] = useState<string>(props.options[0]?.[0] ?? "");

  // Un <select> no vuelve solo al valor del estado después del reset de React 19,
  // ni siquiera estando controlado (ver el encabezado del hook).
  const formRef = useRef<HTMLFormElement>(null);
  useFormResetSync(formRef, { newCategory: category });

  // El aviso sale del MISMO predicado que decide el viaje a MP en el servidor:
  // adherente ↔ colaborador comparten plan y no lo tocan.
  const willUpdateMp =
    props.hasSubscription && changesFeeAmount(props.currentCategory, category as MemberCategory);

  return (
    <div className="space-y-6">
      {props.options.length > 0 && (
        <form ref={formRef} action={recategorizeAction} className="space-y-2">
          <input type="hidden" name="applicationId" value={props.applicationId} />
          <Label htmlFor="newCategory">Recategorizar</Label>
          <div className="flex flex-wrap items-center gap-2">
            <select
              id="newCategory"
              name="newCategory"
              required
              className="h-9 rounded-md border px-2 text-sm"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {props.options.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <Button type="submit" variant="secondary" disabled={recategorizePending}>
              {recategorizePending ? "Guardando…" : "Cambiar categoría"}
            </Button>
          </div>
          {willUpdateMp && (
            <FormMessage kind="warning">
              Se actualizará el monto de la suscripción en Mercado Pago.
            </FormMessage>
          )}
          {reState.error && <FormMessage kind="error">{reState.error}</FormMessage>}
        </form>
      )}

      <details className="rounded-md border p-3">
        <summary className="cursor-pointer text-sm font-medium">Rechazar solicitud…</summary>
        <form action={rejectAction} className="mt-3 space-y-3">
          <input type="hidden" name="applicationId" value={props.applicationId} />
          <p className="text-sm text-muted-foreground">
            El rechazo queda asentado en acta. Si hubo cuota de ingreso debitada, se retiene
            (no es reembolsable) y se cancela la suscripción.
          </p>
          <MinutePicker minutes={props.minutes} />
          {rjState.error && <FormMessage kind="error">{rjState.error}</FormMessage>}
          <Button type="submit" variant="destructive" disabled={rejectPending}>
            {rejectPending ? "Rechazando…" : "Rechazar solicitud"}
          </Button>
        </form>
      </details>
    </div>
  );
}
