"use client";
// La confirmación de la cancelación. Todo lo que se lee acá lo resolvió el
// servidor (`page.tsx`) contra la base: este componente no calcula nada.
//
// Dos frases ordenadas por TIEMPO —lo que pasa al apretar y lo que pasa de acá
// en más—, igual que la confirmación de la vinculación: son las dos cosas que el
// operador tiene que separar antes de cortar un mandato de cobro que no se
// puede rehacer desde el panel.
//
// El grupo recibe el foco al montarse: el operador viene de hacer clic en el
// botón de la tabla, ese enlace se desmonta y el foco caería a <body>.
import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";
import { FormMessage } from "@/components/admin/form-message";
import { Button } from "@/components/ui/button";
import { type CancelEffect, cancelEffectSentence } from "@/lib/mp/cancel-effect";
import { cancelSubscriptionAction } from "./actions";

const BASE = "/admin/tesoreria/suscripciones";

export type CancelSubscriptionView = {
  /** Ya formateado en es-AR, o `null` si el espejo local no tiene monto. */
  amountLabel: string | null;
  /** Ya en minúscula: va dentro de una frase. */
  statusLabel: string;
  /** Qué se puede AFIRMAR que pasa al confirmar (`@/lib/mp/cancel-effect`).
   *  Son CUATRO y no un booleano: `paused` hoy no cobra pero se reanuda, y un
   *  estado que MP invente no se puede afirmar ni vivo ni muerto. En los cuatro
   *  casos el botón se ofrece igual —MEDIDO contra la API el 24/08/2026: MP
   *  acepta el salto a `cancelled` incluso desde `pending`—; lo que cambia es lo
   *  que la pantalla dice. */
  effect: CancelEffect;
  /** Cuándo se sincronizó por última vez con MP, ya formateado. */
  lastSyncLabel: string | null;
};

export function CancelForm({ preapprovalId, member, subscription }: {
  preapprovalId: string;
  member: { fullName: string; memberNumber: number | null };
  subscription: CancelSubscriptionView;
}) {
  const [state, formAction, pending] = useActionState(cancelSubscriptionAction, {});
  const groupRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    groupRef.current?.focus();
  }, []);

  const who = `N° ${member.memberNumber ?? "—"} · ${member.fullName}`;

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="preapprovalId" value={preapprovalId} />
      <div
        ref={groupRef}
        tabIndex={-1}
        role="group"
        aria-labelledby="cancelar-confirm-title"
        className="space-y-3 rounded-md border border-destructive bg-destructive/5 p-3 outline-hidden focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <p id="cancelar-confirm-title" className="font-medium">
          {"Vas a cancelar el débito automático de "}
          <span className="font-mono tabular-nums">{who}</span>
          {", que está dado de baja."}
        </p>
        <dl className="space-y-2 text-sm">
          <div className="grid gap-x-4 sm:grid-cols-[8rem_1fr]">
            <dt className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">Al confirmar</dt>
            {/* Las cuatro frases viven en `@/lib/mp/cancel-effect`, con los
                textos de la baja como precedente (`members/auto-debit.ts`): son
                afirmaciones sobre el dinero de un vecino y se prueban sin
                renderizar nada. */}
            <dd>{cancelEffectSentence(subscription)}</dd>
          </div>
          <div className="grid gap-x-4 sm:grid-cols-[8rem_1fr]">
            <dt className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">De acá en más</dt>
            <dd>
              <strong>No se deshace</strong>: si el vecino vuelve a asociarse, tiene que autorizar un
              débito nuevo desde el sitio. Los cobros que ya se le hicieron no se tocan y sus recibos
              siguen donde están.
            </dd>
          </div>
        </dl>
        <p className="text-xs text-muted-foreground">
          {`Estado según la última sincronización con Mercado Pago${
            subscription.lastSyncLabel ? ` (${subscription.lastSyncLabel})` : " (nunca sincronizada)"
          }: ${subscription.statusLabel}.`}
          {/* "Se cancela igual" sólo tiene sentido sobre un estado del que se
              podría dudar. Sobre una activa era una rareza: nadie duda de que
              haya que cancelar la que está cobrando. */}
          {subscription.effect !== "stops_charging" &&
            " Se cancela igual: lo único que se puede afirmar muerto es una cancelada."}
        </p>
      </div>

      {state.error && <FormMessage kind="error" box>{state.error}</FormMessage>}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="destructive" disabled={pending}>
          {pending ? "Cancelando…" : "Cancelar el débito"}
        </Button>
        <Button asChild variant="outline"><Link href={BASE}>Volver</Link></Button>
      </div>
    </form>
  );
}
