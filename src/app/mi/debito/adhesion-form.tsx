"use client";
// Adhesión al débito automático (5B, Task 13). Calca el patrón de
// `mi/cuenta/pay-form.tsx`: la boleta previa antes del botón, y
// `useActionState` + `window.location.assign(state.redirectUrl)` para la ida a
// Mercado Pago (`assign` y no `replace`: si el vecino se arrepiente en el
// checkout, "atrás" en el navegador tiene que devolverlo acá).
import { useActionState, useEffect } from "react";
import { RefreshCw } from "lucide-react";

import { FormMessage } from "@/components/admin/form-message";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatARS } from "@/lib/format";
import { startDebitAction, type DebitState } from "./actions";

export function AdhesionForm({ unit, firstPeriodLabel }: {
  /** Monto mensual vigente (`fee_values`, vía `memberDebit.preview`). La
   *  página ya descartó el `null` (valor todavía no publicado) antes de
   *  montar este componente. */
  unit: number;
  /** `describePeriods(upcoming.slice(0, 1))`, ya resuelto en el servidor: acá
   *  NUNCA es la cuota de ingreso (a diferencia del wizard ASOCIATE) — el
   *  socio ya ingresó, así que el primer débito es una cuota social más. */
  firstPeriodLabel: string;
}) {
  const [state, formAction, pending] = useActionState<DebitState, FormData>(startDebitAction, {});

  // Irse del sitio ES un efecto sobre un sistema externo: acá está bien puesto
  // (mismo criterio que `pay-form.tsx:64-66`).
  useEffect(() => {
    if (state.redirectUrl) window.location.assign(state.redirectUrl);
  }, [state.redirectUrl]);
  const leaving = Boolean(state.redirectUrl);

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2" className="flex items-center gap-2">
          <RefreshCw className="size-4 text-primary" aria-hidden />
          Adherir el débito automático
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-5">
          {/* La boleta previa: mismo recuadro que `pay-form.tsx`, un solo
              renglón porque acá no hay cantidad que elegir — es un monto fijo,
              todos los meses. */}
          <div className="overflow-hidden rounded-xl border-2 border-border">
            <ul className="divide-y divide-border">
              <li className="flex items-baseline justify-between gap-4 px-4 py-3.5">
                <span className="min-w-0 text-sm">
                  Cuota social
                  <span className="block text-xs text-muted-foreground">por mes</span>
                </span>
                <span className="shrink-0 font-mono text-xl font-bold tabular-nums text-primary">
                  {formatARS(unit)}
                </span>
              </li>
            </ul>
          </div>

          {firstPeriodLabel && (
            <p className="text-sm text-muted-foreground">Tu primer débito cubre {firstPeriodLabel}.</p>
          )}
          <p className="text-sm text-muted-foreground">
            Te lleva a Mercado Pago a autorizar el débito con tu tarjeta.
          </p>

          {state.error && (
            <FormMessage kind="error" box>
              {state.error}
            </FormMessage>
          )}

          <Button type="submit" className="min-h-12 w-full px-4 text-base" disabled={pending || leaving}>
            {pending || leaving ? "Abriendo Mercado Pago…" : "Adherir el débito automático"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
