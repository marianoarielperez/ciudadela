"use client";
// Los dos caminos que tiene una fila abierta: imputarla a un socio o descartarla.
//
// Son dos formularios y no uno con un switch, porque son dos decisiones
// distintas y de peso distinto: una emite un recibo a nombre de un vecino, la
// otra declara que esa plata no se le atribuye a nadie. Cada una con su action,
// su estado y su botón.
//
// `useSyncedForm` en el de imputar: React 19 resetea el <form action> cuando la
// action termina, y con un <select> controlado el concepto volvería al primero
// justo cuando el operador está leyendo por qué se rechazó.
import { useActionState } from "react";
import { FormMessage } from "@/components/admin/form-message";
import { SelectField, TextField, useSyncedForm } from "@/components/admin/synced-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatARS } from "@/lib/format";
import { dismissUnmatchedAction, resolveUnmatchedAction } from "./actions";

const digits = (v: string) => v.replace(/\D/g, "");

export function ResolveForm({ rowId, memberId, amount, paidAt, pendingCount, withdrawn, feeAmount }: {
  rowId: number;
  memberId: number;
  amount: number;
  /** Ya formateada en es-AR: la fecha del recibo es la del cobro, no la de hoy. */
  paidAt: string;
  pendingCount: number;
  withdrawn: boolean;
  /** Valor vigente de la cuota de la categoría, o null si no paga cuota. */
  feeAmount: number | null;
}) {
  const [state, formAction, pending] = useActionState(resolveUnmatchedAction, {});
  // El default es lo que el monto ya sugiere: cuántas cuotas entran en lo
  // cobrado. No es una adivinanza gratuita —el importe vino de un plan de MP,
  // así que casi siempre es un múltiplo exacto— y el operador lo ve escrito
  // antes de confirmar. Mínimo 1: un monto menor a la cuota se imputa igual a
  // una, y el sistema no cobra de más por eso (las cuotas no llevan monto).
  const suggested = feeAmount ? Math.max(1, Math.min(60, Math.floor(amount / feeAmount))) : 1;
  const { values, formRef, field } = useSyncedForm({
    concept: "fees",
    // Un cesante no devenga: como mucho puede cubrir las que le quedaron.
    count: String(withdrawn ? Math.max(1, Math.min(suggested, pendingCount)) : suggested),
    note: "",
  });
  const concepts: Array<[string, string]> = withdrawn
    ? [["fees", "Cuotas sociales (deuda congelada)"]]
    : [["fees", "Cuotas sociales"], ["voluntary", "Aporte voluntario"]];

  return (
    <form ref={formRef} action={formAction} className="space-y-3">
      <input type="hidden" name="rowId" value={rowId} />
      <input type="hidden" name="memberId" value={memberId} />
      <SelectField label="Aplicar como" field={field("concept")} options={concepts} />
      {values.concept === "fees" && (
        <TextField
          label="Cantidad de cuotas"
          field={field("count", digits)}
          inputMode="numeric"
          // El servicio rechaza por encima de 60; el maxLength evita que la
          // pantalla muestre un total de siete cifras antes del rechazo.
          maxLength={2}
          hint={
            withdrawn
              ? `Dado de baja: como máximo ${pendingCount}.`
              : pendingCount > 0
                ? `Debe ${pendingCount}. Se imputan a las más antiguas primero.`
                : "Está al día: se imputa al período corriente y siguientes."
          }
        />
      )}
      <TextField label="Nota (opcional)" field={field("note")} maxLength={200} />
      {/* Lo último que se lee antes de confirmar: cuánto y con qué fecha. La
          fecha importa — el recibo lleva el día en que MP cobró, no el día en
          que el operador se dio cuenta. */}
      <p className="text-sm">
        Se registra un pago de{" "}
        <span className="font-mono font-semibold tabular-nums">{formatARS(amount)}</span> con recibo,
        fechado el {paidAt}, que es el día en que Mercado Pago lo cobró.
      </p>
      {state.error && <FormMessage kind="error" box>{state.error}</FormMessage>}
      <Button type="submit" disabled={pending}>{pending ? "Aplicando…" : "Aplicar y emitir recibo"}</Button>
    </form>
  );
}

export function DismissForm({ rowId }: { rowId: number }) {
  const [state, formAction, pending] = useActionState(dismissUnmatchedAction, {});
  return (
    <details className="rounded-md border px-3">
      <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium outline-hidden focus-visible:ring-2 focus-visible:ring-ring">
        Descartar este pago
      </summary>
      <form action={formAction} className="space-y-3 pb-3">
        <input type="hidden" name="rowId" value={rowId} />
        {/* Campo NO controlado a propósito: el <details> se cierra cuando la
            action termina, así que no hay valor que preservar del reset de
            React 19. Sin `useSyncedForm`, pero con su <label> real. */}
        <div className="space-y-1">
          <Label htmlFor="dismiss-reason">Motivo</Label>
          <Input
            id="dismiss-reason"
            name="reason"
            maxLength={200}
            autoComplete="off"
            className="max-w-md"
            placeholder="Por qué esta plata no se le imputa a nadie"
          />
          <p className="text-xs text-muted-foreground">
            Queda escrito en la fila. Descartar no devuelve la plata: sólo declara que la vecinal
            la cobró y no corresponde imputarla.
          </p>
        </div>
        {state.error && <FormMessage kind="error">{state.error}</FormMessage>}
        <Button type="submit" variant="destructive" disabled={pending}>
          {pending ? "Descartando…" : "Descartar"}
        </Button>
      </form>
    </details>
  );
}
