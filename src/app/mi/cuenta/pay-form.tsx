"use client";
// "Pagar ahora" del socio. Se usa desde un celular, de pie, por alguien que
// entra una vez cada varios meses: la pantalla tiene que contestar dos cosas
// antes del botón —cuánto voy a pagar y qué cuotas cubre— y nada más.
//
// El recuadro de abajo es la misma BOLETA PREVIA que el paso 5 del wizard
// ASOCIATE (`asociate/step-payment.tsx`): mismo recuadro, mismo par
// concepto/importe, mismo importe grande a la derecha. Es a propósito — el
// vecino que se asoció por la web ya vio ese comprobante-antes-del-hecho, y el
// momento de comprometerse con plata tiene que verse igual en todo el sitio.
//
// La cantidad se toca con un +/− y no sólo con un campo de texto: en un
// teléfono, tres cuotas son dos toques y el teclado numérico ni aparece. El
// input sigue en el medio (se puede tipear 12) y es el que viaja en el FormData.
import { useActionState, useEffect, useState } from "react";
import { FormMessage } from "@/components/admin/form-message";
import { Button } from "@/components/ui/button";
import { formatARS } from "@/lib/format";
import { periodLabel, type Period } from "@/lib/treasury/periods";
import { startMemberPaymentAction, type PayState } from "./actions";

const MIN = 1;
/** El mismo techo que `MAX_LINK_FEES`. Duplicado acá y no importado del módulo
 *  del servidor a propósito: este archivo es de cliente y el otro arrastra el
 *  gateway. El servidor sigue siendo el que decide — esto es sólo el freno de
 *  la pantalla. */
const MAX = 60;

function clamp(n: number): number {
  if (!Number.isFinite(n)) return MIN;
  return Math.min(MAX, Math.max(MIN, Math.trunc(n)));
}

export function PayForm({ pendingCount, feeAmount, oldestPending }: {
  pendingCount: number;
  feeAmount: number;
  oldestPending: Period | null;
}) {
  const [state, formAction, pending] = useActionState<PayState, FormData>(startMemberPaymentAction, {});
  // Arranca en lo que debe: el caso frecuente es "quiero ponerme al día".
  // El estado es el TEXTO del campo y no un número, para que borrarlo y
  // volver a tipear no le pelee al vecino con un "1" que reaparece solo.
  const [raw, setRaw] = useState(String(Math.max(MIN, pendingCount)));
  const n = Number(raw);
  const valid = raw !== "" && Number.isInteger(n) && n >= MIN && n <= MAX;
  const total = valid ? feeAmount * n : null;
  const step = (delta: number) => setRaw(String(clamp((valid ? n : MIN) + delta)));

  // Irse del sitio ES un efecto sobre un sistema externo: acá está bien puesto.
  // `assign` y no `replace`: si el vecino se arrepiente en el checkout, el botón
  // "atrás" del navegador tiene que devolverlo a esta pantalla.
  useEffect(() => {
    if (state.redirectUrl) window.location.assign(state.redirectUrl);
  }, [state.redirectUrl]);
  const leaving = Boolean(state.redirectUrl);

  return (
    <form action={formAction} className="space-y-5">
      <div className="space-y-2">
        <span
          id="cuantas-cuotas"
          className="block text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase"
        >
          Cuántas cuotas
        </span>
        <div className="flex items-center gap-2">
          <StepButton label="Una cuota menos" onClick={() => step(-1)} disabled={valid && n <= MIN}>
            −
          </StepButton>
          <input
            name="n"
            inputMode="numeric"
            autoComplete="off"
            aria-labelledby="cuantas-cuotas"
            maxLength={2}
            value={raw}
            onChange={(e) => setRaw(e.target.value.replace(/\D/g, ""))}
            className="h-12 w-16 rounded-lg border bg-background text-center font-mono text-lg tabular-nums outline-hidden focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          <StepButton label="Una cuota más" onClick={() => step(1)} disabled={valid && n >= MAX}>
            +
          </StepButton>
        </div>
        <p className="text-sm text-muted-foreground">
          {pendingCount > 0
            ? `Debés ${pendingCount} ${pendingCount === 1 ? "cuota" : "cuotas"}${oldestPending ? ` desde ${periodLabel(oldestPending)}` : ""}. Podés pagar menos: se imputan a las más viejas.`
            : "Estás al día: pagás el mes en curso por adelantado."}
        </p>
      </div>

      {/* La boleta previa. Dos renglones y nada más: qué mes cubre cada cuota ya
          está en la cinta de arriba, y repetirlo sería ruido justo en el momento
          en que el vecino tiene que leer un número. */}
      <div className="overflow-hidden rounded-xl border-2 border-border">
        <ul className="divide-y divide-border">
          <li className="flex items-baseline justify-between gap-4 px-4 py-3.5">
            <span className="min-w-0 text-sm">
              Cuota social
              <span className="block text-xs text-muted-foreground">
                {valid ? `${n} × ${formatARS(feeAmount)}` : `Elegí entre ${MIN} y ${MAX} cuotas`}
              </span>
            </span>
            <span className="shrink-0 font-mono text-sm tabular-nums text-muted-foreground">
              {total === null ? "—" : formatARS(total)}
            </span>
          </li>
          <li className="flex items-baseline justify-between gap-4 bg-muted/40 px-4 py-3.5">
            <span className="text-sm font-medium">Total a pagar</span>
            <span className="shrink-0 font-mono text-xl font-bold tabular-nums text-primary">
              {total === null ? "—" : formatARS(total)}
            </span>
          </li>
        </ul>
      </div>

      {state.error && <FormMessage kind="error" box>{state.error}</FormMessage>}

      <Button
        type="submit"
        className="min-h-12 w-full px-4 text-base"
        disabled={!valid || pending || leaving}
      >
        {pending || leaving ? "Abriendo Mercado Pago…" : "Pagar con Mercado Pago"}
      </Button>
      <p className="text-sm text-muted-foreground">
        Te lleva a Mercado Pago. Cuando el pago se acredite, el recibo aparece acá y te llega por
        email.
      </p>
    </form>
  );
}

/** El +/− del contador. 48px de lado: es el control que más se toca de esta
 *  pantalla, y se toca con el pulgar. */
function StepButton({ label, onClick, disabled, children }: {
  label: string;
  onClick: () => void;
  disabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="size-12 shrink-0 rounded-lg border bg-background text-lg leading-none font-semibold outline-hidden hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40"
    >
      <span aria-hidden>{children}</span>
    </button>
  );
}
