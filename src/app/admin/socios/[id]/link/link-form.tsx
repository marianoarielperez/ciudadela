"use client";
// Generar el link y, si el socio tiene email, mandárselo. Dos formularios
// encadenados en una pantalla: el segundo sólo existe una vez que el primero
// devolvió un link, y reenvía ESE link (viaja en hidden) en vez de crear otro.
// Generar dos preferencias por el mismo cobro no rompe nada —el webhook imputa
// por referencia, y `pago:{id}:{n}` es la misma en las dos—, pero le deja al
// socio dos enlaces distintos en el buzón, que es una llamada a la sede.
//
// El total se calcula en pantalla para que el operador lo lea ANTES de generar;
// el monto real lo calcula el servidor con el valor vigente, y ese es el que MP
// le cobra al socio.
import { useActionState, useEffect, useState } from "react";
import { FormMessage } from "@/components/admin/form-message";
import { TextField, useSyncedForm } from "@/components/admin/synced-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatARS } from "@/lib/format";
import { periodLabel, type Period } from "@/lib/treasury/periods";
import { createPaymentLinkAction, emailPaymentLinkAction, type LinkState } from "./actions";

/** Sólo dígitos mientras se tipea: la cantidad de cuotas es un entero, y dejar
 *  entrar el punto obliga a rechazar después lo que nunca debió entrar. */
function digitsOnly(raw: string): string {
  return raw.replace(/\D/g, "");
}

export function LinkForm({ memberId, feeAmount, pendingCount, oldestPending, hasEmail }: {
  memberId: number;
  /** Valor vigente de la cuota para la categoría (la pantalla no llega acá si es null). */
  feeAmount: number;
  pendingCount: number;
  oldestPending: Period | null;
  hasEmail: boolean;
}) {
  const [state, formAction, pending] = useActionState<LinkState, FormData>(createPaymentLinkAction, {});
  // Arranca en lo que el socio debe: a diferencia del efectivo —donde el
  // operador tiene la plata en la mano y cobrar de más es irreversible—, acá el
  // link es una propuesta que el socio puede no usar, y lo natural es ofrecerle
  // saldar todo. Sigue siendo editable.
  const { values, formRef, field } = useSyncedForm({ n: String(Math.max(1, pendingCount)) });
  const n = Number(values.n);
  const total = Number.isInteger(n) && n > 0 && n <= 60 ? feeAmount * n : null;

  return (
    <div className="space-y-5">
      <form ref={formRef} action={formAction} className="space-y-4">
        <input type="hidden" name="memberId" value={memberId} />
        <TextField
          label="Cantidad de cuotas"
          field={field("n", digitsOnly)}
          inputMode="numeric"
          maxLength={2}
          className="max-w-24"
          hint={
            pendingCount > 0
              ? `Debe ${pendingCount} ${pendingCount === 1 ? "cuota" : "cuotas"}${oldestPending ? ` desde ${periodLabel(oldestPending)}` : ""}. El pago se imputa a las más antiguas primero.`
              : "Está al día: el pago se imputa al período corriente y siguientes."
          }
        />
        <p className="text-sm">
          El socio va a pagar{" "}
          <span className="font-mono text-lg font-semibold tabular-nums">
            {total === null ? "—" : formatARS(total)}
          </span>
          {total !== null && (
            <span className="text-muted-foreground">
              {" "}
              ({n} × {formatARS(feeAmount)})
            </span>
          )}
        </p>
        {state.error && <FormMessage kind="error" box>{state.error}</FormMessage>}
        <Button type="submit" className="min-h-11 px-4" disabled={pending}>
          {pending ? "Generando…" : state.link ? "Generar otro link" : "Generar link"}
        </Button>
      </form>

      {state.link && <GeneratedLink memberId={memberId} link={state.link} hasEmail={hasEmail} />}
    </div>
  );
}

/** El link recién creado: lo que el operador vino a buscar. Es el único bloque
 *  destacado de la pantalla — todo lo demás queda en gris. */
function GeneratedLink({ memberId, link, hasEmail }: {
  memberId: number;
  link: { url: string; amount: number; n: number };
  hasEmail: boolean;
}) {
  return (
    <div className="space-y-4 rounded-xl border-2 border-primary p-4">
      <div>
        <p className="text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
          Link listo
        </p>
        <p className="mt-1 text-sm">
          {link.n === 1 ? "1 cuota" : `${link.n} cuotas`} ·{" "}
          <span className="font-mono text-lg font-semibold tabular-nums">{formatARS(link.amount)}</span>
        </p>
      </div>

      <CopyRow url={link.url} />

      <p className="text-xs text-muted-foreground">
        Mercado Pago da de baja el enlace a las 24 h si no se usa. Cuando el pago se acredite, la
        cuota se imputa sola y el recibo se emite acá.
      </p>

      <EmailRow memberId={memberId} link={link} hasEmail={hasEmail} />
    </div>
  );
}

function CopyRow({ url }: { url: string }) {
  // `idle | copied | manual`: el portapapeles no está disponible en todos los
  // contextos (sin HTTPS, o con el permiso denegado), y ahí el operador
  // necesita que le digan qué hacer, no un botón que no hizo nada.
  const [copy, setCopy] = useState<"idle" | "copied" | "manual">("idle");
  useEffect(() => {
    if (copy !== "copied") return;
    const t = setTimeout(() => setCopy("idle"), 4000);
    return () => clearTimeout(t);
  }, [copy]);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopy("copied");
    } catch {
      setCopy("manual");
    }
  }

  return (
    <div className="space-y-1">
      <label className="text-xs text-muted-foreground" htmlFor="link-url">
        Enlace de pago
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id="link-url"
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className="min-h-11 min-w-0 flex-1 font-mono text-xs"
        />
        <Button type="button" variant="outline" className="min-h-11 px-4" onClick={onCopy}>
          Copiar
        </Button>
      </div>
      {/* Vive siempre en el DOM (aunque vacío) para que el lector de pantalla
          anuncie el cambio: un `role="status"` que aparece recién con el texto
          adentro no siempre se anuncia. */}
      <p role="status" className="min-h-4 text-xs text-success">
        {copy === "copied" && "Copiado"}
        {copy === "manual" && (
          <span className="text-warning">
            No pudimos copiarlo solos. Hacé clic en el enlace y copialo con Ctrl+C.
          </span>
        )}
      </p>
    </div>
  );
}

function EmailRow({ memberId, link, hasEmail }: {
  memberId: number;
  link: { url: string; amount: number; n: number };
  hasEmail: boolean;
}) {
  const [state, formAction, pending] = useActionState<LinkState, FormData>(emailPaymentLinkAction, {});
  return (
    <form action={formAction} className="space-y-2 border-t pt-4">
      <input type="hidden" name="memberId" value={memberId} />
      <input type="hidden" name="url" value={link.url} />
      <input type="hidden" name="n" value={link.n} />
      <input type="hidden" name="amount" value={link.amount} />
      <Button
        type="submit"
        variant="outline"
        className="min-h-11 px-4"
        disabled={!hasEmail || pending}
        aria-describedby={hasEmail ? undefined : "sin-email"}
      >
        {pending ? "Enviando…" : state.emailed ? "Volver a enviar" : "Enviar por email"}
      </Button>
      {!hasEmail && (
        <p id="sin-email" className="text-xs text-muted-foreground">
          El socio no tiene email cargado. Copiá el enlace y mandáselo por otro medio.
        </p>
      )}
      {state.emailed && <FormMessage kind="success">Link enviado a la casilla del socio.</FormMessage>}
      {state.error && <FormMessage kind="error" box>{state.error}</FormMessage>}
    </form>
  );
}
