"use client";
// Formulario de efectivo. Controlado con `useSyncedForm` (React 19 resetea el
// form al terminar la action y el <select> del concepto volvería al primero).
// Acá el rechazo es el caso frecuente —concepto que no corresponde a la
// categoría, sin valor de cuota vigente, socio recién dado de baja— y del otro
// lado del escritorio hay alguien esperando: perder lo tipeado es el error que
// importa.
//
// El total se calcula en pantalla para que el operador lo lea ANTES de
// registrar; el monto real lo calcula el servicio con el valor vigente, y ese
// es el que se cobra.
import { useActionState } from "react";
import { registerCashPaymentAction } from "./actions";
import { digitsOnly } from "./digits";
import { useSyncedForm, TextField, SelectField } from "@/components/admin/synced-fields";
import { FormMessage } from "@/components/admin/form-message";
import { Button } from "@/components/ui/button";
import { formatARS } from "@/lib/format";
import { CASH_CONCEPT_LABELS } from "@/lib/treasury/labels";
import type { CashConcept } from "@/lib/treasury/rules";

export function CashForm({ memberId, concepts, feeAmount, hasEmail, pendingCount }: {
  memberId: number;
  concepts: CashConcept[];
  /** Valor vigente de la cuota para la categoría, o null si no paga cuota. */
  feeAmount: number | null;
  hasEmail: boolean;
  pendingCount: number;
}) {
  const [state, formAction, pending] = useActionState(registerCashPaymentAction, {});
  const { values, setValue, formRef, field } = useSyncedForm({
    concept: concepts[0] ?? "extraordinary",
    // Arranca en una cuota y no en lo que debe: cobrar de más por un default
    // que nadie miró es peor que tipear un número.
    count: "1",
    amount: "",
    note: "",
    sendEmail: hasEmail ? "on" : "",
  });
  const isFees = values.concept === "fees";
  const count = Number(values.count);
  const amount = Number(values.amount);
  // El total se muestra SIEMPRE, no solo en cuotas: es lo último que el
  // operador lee antes de cobrar, y en un aporte es la única forma de ver que
  // el número que tipeó es el que se va a cobrar.
  const total = isFees
    ? (feeAmount !== null && Number.isInteger(count) && count > 0 ? feeAmount * count : null)
    : (Number.isInteger(amount) && amount > 0 ? amount : null);

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      <input type="hidden" name="memberId" value={memberId} />
      <SelectField
        label="Concepto"
        field={field("concept")}
        options={concepts.map((c): [string, string] => [c, CASH_CONCEPT_LABELS[c]])}
      />
      {isFees ? (
        <TextField
          label="Cantidad de cuotas"
          field={field("count", digitsOnly)}
          inputMode="numeric"
          // El servicio rechaza por encima de 60, pero sin este techo la
          // pantalla renderiza un total de siete cifras antes de que el
          // rechazo llegue.
          maxLength={2}
          hint={pendingCount > 0
            ? `Debe ${pendingCount}. Se imputan a las más antiguas primero.`
            : "Está al día: se imputa al período corriente y siguientes."}
        />
      ) : (
        <TextField
          label="Monto ($)"
          // Solo dígitos, como el valor de cuota de Configuración: dejar entrar
          // la coma o el punto obliga a adivinar si "2500,50" son dos mil
          // quinientos con cincuenta o doscientos cincuenta mil.
          field={field("amount", digitsOnly)}
          inputMode="numeric"
          maxLength={8}
          placeholder="2500"
          hint="En pesos enteros."
        />
      )}
      <TextField label="Nota (opcional)" field={field("note")} maxLength={200} />
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="sendEmail"
          value="on"
          className="size-4"
          disabled={!hasEmail}
          checked={values.sendEmail === "on"}
          onChange={(e) => setValue("sendEmail", e.target.checked ? "on" : "")}
        />
        {hasEmail ? "Enviar el recibo por email" : "El socio no tiene email cargado"}
      </label>
      {total !== null && (
        <p className="text-sm">
          Total a cobrar:{" "}
          <span className="font-mono text-lg font-semibold tabular-nums">{formatARS(total)}</span>
        </p>
      )}
      {state.error && <FormMessage kind="error" box>{state.error}</FormMessage>}
      <Button type="submit" disabled={pending}>{pending ? "Registrando…" : "Registrar y emitir recibo"}</Button>
    </form>
  );
}
