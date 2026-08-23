"use client";
// Los dos formularios de Otros ingresos: registrar y anular.
//
// El de registrar va controlado con `useSyncedForm` — React 19 resetea el
// <form action> cuando la action termina, y acá el rechazo es frecuente (una
// fecha futura, un concepto de dos letras) con alguien esperando del otro lado
// del mostrador: perder lo tipeado es el error que importa.
import { useActionState } from "react";
import { FormMessage } from "@/components/admin/form-message";
import { TextField, useSyncedForm } from "@/components/admin/synced-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatARS } from "@/lib/format";
import { registerOtherIncomeAction, voidOtherIncomeAction } from "./actions";

const digitsOnly = (v: string) => v.replace(/\D/g, "");

// Sugerencias, no categorías: el cliente descartó una lista fija y el campo
// sigue siendo texto libre. Sirven para que dos alquileres cargados con seis
// meses de diferencia se escriban igual y el filtro los encuentre juntos.
const CONCEPT_SUGGESTIONS = ["Alquiler del salón", "Evento", "Rifa", "Donación"];

export function RegisterIncomeForm({ today }: {
  /** "AAAA-MM-DD" del día civil argentino, calculado en el servidor: el reloj
   *  del navegador puede estar en otra zona y fechar el ingreso un día antes. */
  today: string;
}) {
  const [state, formAction, pending] = useActionState(registerOtherIncomeAction, {});
  const { values, formRef, field } = useSyncedForm({
    amount: "",
    receivedAt: today,
    concept: "",
    note: "",
  });
  const amount = Number(values.amount);
  const total = Number.isInteger(amount) && amount > 0 ? amount : null;

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      <TextField
        label="Monto ($)"
        // Sólo dígitos, como el mostrador: dejar entrar la coma o el punto
        // obliga a adivinar si "2500,50" son dos mil quinientos con cincuenta o
        // doscientos cincuenta mil.
        field={field("amount", digitsOnly)}
        inputMode="numeric"
        maxLength={8}
        placeholder="45000"
        autoFocus
      />
      <TextField
        label="Fecha del ingreso"
        field={field("receivedAt")}
        type="date"
        hint="El día en que entró la plata, no el día en que se carga."
      />
      <TextField
        label="Concepto"
        field={field("concept")}
        maxLength={200}
        placeholder="Alquiler del salón"
        options={CONCEPT_SUGGESTIONS}
        hint="Texto libre: escribí a qué corresponde. Las sugerencias son sólo eso."
      />
      <TextField label="Nota (opcional)" field={field("note")} maxLength={200} />
      {/* Lo último que se lee antes de registrar, como en el mostrador: cuánto
          es y qué NO hace. Que no haya recibo es la mitad de esta pantalla. */}
      <p className="text-sm">
        {total !== null ? (
          <>
            Se registra un ingreso de{" "}
            <span className="font-mono font-semibold tabular-nums">{formatARS(total)}</span>.{" "}
          </>
        ) : null}
        <span className="text-muted-foreground">
          No emite recibo ni toca la cuenta de ningún socio: la serie numerada es de las cuotas
          sociales.
        </span>
      </p>
      {state.error && <FormMessage kind="error" box>{state.error}</FormMessage>}
      <Button type="submit" disabled={pending}>{pending ? "Registrando…" : "Registrar el ingreso"}</Button>
    </form>
  );
}

export function VoidIncomeForm({ incomeId, concept }: { incomeId: number; concept: string }) {
  const [state, formAction, pending] = useActionState(voidOtherIncomeAction, {});
  return (
    <details className="w-fit">
      <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm text-primary outline-hidden hover:underline focus-visible:ring-2 focus-visible:ring-ring">
        Anular
        {/* Una columna entera de "Anular" son destinos idénticos para un lector
            de pantalla: el sufijo oculto dice cuál es cuál. */}
        <span className="sr-only"> el ingreso de {concept}</span>
      </summary>
      {/* Campo NO controlado: la action redirige al terminar, así que no hay
          valor que preservar del reset de React 19. */}
      <form action={formAction} className="space-y-2 py-2">
        <input type="hidden" name="incomeId" value={incomeId} />
        <div className="space-y-1">
          <Label htmlFor={`void-reason-${incomeId}`}>Motivo</Label>
          <Input
            id={`void-reason-${incomeId}`}
            name="reason"
            maxLength={200}
            autoComplete="off"
            className="w-64"
            placeholder="Por qué se anula"
          />
          <p className="text-xs text-muted-foreground">
            No borra el ingreso: queda tachado con el motivo y deja de sumar. Si vino de Mercado
            Pago, su fila vuelve a Pendientes en la bandeja.
          </p>
        </div>
        {state.error && <FormMessage kind="error">{state.error}</FormMessage>}
        <Button type="submit" variant="destructive" disabled={pending}>
          {pending ? "Anulando…" : "Anular"}
        </Button>
      </form>
    </details>
  );
}
