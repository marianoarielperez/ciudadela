"use client";
// La confirmación de "Cancelar el débito" (5B, Task 13). Calca
// `admin/tesoreria/suscripciones/[preapprovalId]/cancelar/cancel-form.tsx`:
// mismos cuatro desenlaces (no un booleano), mismo grupo enfocable al
// montarse (el vecino viene de hacer clic en el link "Cancelar el débito" de
// la tarjeta de arriba, que se desmontó). La FRASE de efecto no es la misma:
// acá es el propio socio quien lee, así que usa `cancelEffectSentenceForMember`
// (segunda persona) y no la `cancelEffectSentence` del admin (que habla del
// "vecino" en tercera persona).
import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";

import { FormMessage } from "@/components/admin/form-message";
import { Button } from "@/components/ui/button";
import { type CancelEffect, cancelEffectSentenceForMember } from "@/lib/mp/cancel-effect";
import { cancelDebitAction, type DebitState } from "../actions";

export function CancelForm({ preapprovalId, subscription }: {
  preapprovalId: string;
  subscription: {
    /** Ya formateado en es-AR, o `null` si el espejo local no tiene monto. */
    amountLabel: string | null;
    /** Ya en minúscula: va dentro de una frase. */
    statusLabel: string;
    effect: CancelEffect;
  };
}) {
  const [state, formAction, pending] = useActionState<DebitState, FormData>(cancelDebitAction, {});
  const groupRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    groupRef.current?.focus();
  }, []);

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (
          !window.confirm(
            "¿Cancelar el débito automático? Mercado Pago no te va a volver a debitar la cuota; podés volver a adherirte cuando quieras.",
          )
        ) {
          e.preventDefault();
        }
      }}
      className="space-y-3"
    >
      <input type="hidden" name="preapprovalId" value={preapprovalId} />
      <div
        ref={groupRef}
        tabIndex={-1}
        role="group"
        aria-labelledby="cancelar-debito-title"
        className="space-y-3 rounded-md border border-destructive bg-destructive/5 p-3 outline-hidden focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <p id="cancelar-debito-title" className="font-medium">
          Vas a cancelar tu débito automático.
        </p>
        <dl className="space-y-2 text-sm">
          <div className="grid gap-x-4 sm:grid-cols-[8rem_1fr]">
            <dt className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
              Al confirmar
            </dt>
            <dd>{cancelEffectSentenceForMember(subscription)}</dd>
          </div>
          <div className="grid gap-x-4 sm:grid-cols-[8rem_1fr]">
            <dt className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
              De acá en más
            </dt>
            <dd>Podés seguir pagando por link o en la sede, y volver a adherirte cuando quieras.</dd>
          </div>
        </dl>
      </div>

      {state.error && (
        <FormMessage kind="error" box>
          {state.error}
        </FormMessage>
      )}
      {state.done && (
        <FormMessage kind="success" box>
          Listo: tu débito automático quedó cancelado.
        </FormMessage>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="destructive" className="min-h-12" disabled={pending || state.done}>
          {pending ? "Cancelando…" : "Cancelar el débito"}
        </Button>
        <Button asChild variant="outline" className="min-h-12">
          <Link href="/mi/debito">Volver</Link>
        </Button>
      </div>
    </form>
  );
}
