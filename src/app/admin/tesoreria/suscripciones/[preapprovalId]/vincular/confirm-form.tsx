"use client";
// La confirmación de la vinculación. Todo lo que se lee acá lo resolvió el
// servidor (`page.tsx`) contra la base y contra Mercado Pago: este componente
// no calcula nada, sólo lo pone en frases.
//
// Las tres frases están ordenadas por TIEMPO, y por eso llevan esas etiquetas y
// no un "01 / 02 / 03": lo que el operador necesita separar es lo que va a
// pasar ahora de lo que ya pasó (los cobros viejos, que NO se importan) y de lo
// que va a pasar todos los meses a partir de mañana. Ese último renglón es el
// que justifica que esto sea superadmin: se está autorizando un cobro que
// después se repite solo sobre la tarjeta de un vecino.
//
// El grupo recibe el foco al montarse: el operador viene de hacer clic en un
// resultado del buscador, ese enlace se desmonta y el foco caería a <body>.
import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";
import { FormMessage } from "@/components/admin/form-message";
import { Button } from "@/components/ui/button";
import { linkSubscriptionAction } from "./actions";

const BASE = "/admin/tesoreria/suscripciones";

export function ConfirmForm({
  preapprovalId, memberId, token, member, subscription, charges, pendingRows, divergentWith, otherLive,
}: {
  preapprovalId: string;
  memberId: number;
  /** Huella de lo que se está confirmando; la arma el servidor. */
  token: string;
  member: {
    fullName: string;
    memberNumber: number | null;
    /** Ya en minúscula: van dentro de una frase. */
    categoryLabel: string;
    statusLabel: string;
    withdrawn: boolean;
  };
  subscription: {
    reason: string | null;
    /** Ya formateado en es-AR, o `null` si MP no informa monto. */
    amountLabel: string | null;
    statusLabel: string;
    /** Si la suscripción todavía puede cobrar. Con `false` (una `cancelled`) no
     *  va a llegar ningún débito y el socio NO queda marcado con débito
     *  automático: la confirmación tiene que decirlo antes, no después. */
    chargeable: boolean;
  };
  /** `null` = Mercado Pago no contestó la búsqueda de cobros. `last` ya viene
   *  formateada en es-AR. */
  charges: { count: number; last: string | null } | null;
  /** Las filas ABIERTAS de la bandeja que se van a aplicar, con fecha, monto e
   *  id del cobro. La lista y no el conteo: la bandeja se matchea también por
   *  `externalReference`, que es texto libre del panel de MP, y una colisión
   *  imputaría cobros ajenos sin que el operador llegue a verlo. Todo formateado
   *  por el servidor. */
  pendingRows: Array<{ id: number; mpPaymentId: string; dateLabel: string; amountLabel: string }>;
  /** Valor vigente de la cuota, ya formateado, cuando NO coincide con el monto
   *  que cobra la suscripción. `null` si coinciden o no hay con qué comparar. */
  divergentWith: string | null;
  /** Suscripciones del socio que siguen cobrando. Vincularle otra le duplica el
   *  débito, y eso hay que decirlo antes y no después. */
  otherLive: number;
}) {
  const [state, formAction, pending] = useActionState(linkSubscriptionAction, {});
  const groupRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    groupRef.current?.focus();
  }, []);

  const who = `N° ${member.memberNumber ?? "—"} · ${member.fullName}`;
  const what = subscription.reason ?? "sin descripción";
  const howMuch = subscription.amountLabel ?? "sin monto informado";

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="preapprovalId" value={preapprovalId} />
      <input type="hidden" name="memberId" value={memberId} />
      <input type="hidden" name="confirmToken" value={token} />
      <div
        ref={groupRef}
        tabIndex={-1}
        role="group"
        aria-labelledby="vincular-confirm-title"
        className="space-y-3 rounded-md border border-primary bg-primary/5 p-3 outline-hidden focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <p id="vincular-confirm-title" className="font-medium">
          {`Vas a vincular la suscripción “${what}” (${howMuch}, ${subscription.statusLabel}) a `}
          <span className="font-mono tabular-nums">{who}</span>
          {` (${member.statusLabel}, ${member.categoryLabel}).`}
        </p>
        <dl className="space-y-2 text-sm">
          <div className="grid gap-x-4 sm:grid-cols-[8rem_1fr]">
            <dt className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">Antes</dt>
            <dd>
              {charges === null
                ? "No pudimos leer los cobros previos en Mercado Pago."
                : charges.count === 0
                  ? "Mercado Pago no le hizo ningún cobro todavía."
                  : `Mercado Pago registra ${charges.count} ${charges.count === 1 ? "cobro previo" : "cobros previos"}${charges.last ? `; el último el ${charges.last}` : ""}. `}
              {charges !== null && charges.count > 0 && (
                <>
                  <strong>No se importan</strong>: la deuda histórica ya está cargada.
                </>
              )}
            </dd>
          </div>
          <div className="grid gap-x-4 sm:grid-cols-[8rem_1fr]">
            <dt className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">Ahora</dt>
            <dd>
              {pendingRows.length === 0 ? (
                "No hay pagos esperando en la bandeja sin conciliar."
              ) : (
                <>
                  {`${pendingRows.length} ${pendingRows.length === 1 ? "pago que estaba" : "pagos que estaban"} en la bandeja se ${pendingRows.length === 1 ? "va" : "van"} a aplicar ahora, uno por cuota, con su recibo:`}
                  {/* Cuáles, no cuántos: el operador tiene que poder reconocer
                      cada cobro antes de imputarlo. */}
                  <ul className="mt-1 space-y-0.5">
                    {pendingRows.map((r) => (
                      <li key={r.id} className="font-mono text-xs tabular-nums break-all">
                        {`${r.dateLabel} · ${r.amountLabel} · ${r.mpPaymentId}`}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </dd>
          </div>
          <div className="grid gap-x-4 sm:grid-cols-[8rem_1fr]">
            <dt className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">De acá en más</dt>
            <dd>
              {subscription.chargeable ? (
                <>
                  Cada débito mensual de esta suscripción se convierte en su cuota y se le emite el
                  recibo, sin que nadie toque nada. El socio queda marcado con débito automático.
                </>
              ) : (
                <>
                  {`Esta suscripción está ${subscription.statusLabel} en Mercado Pago: `}
                  <strong>no va a volver a cobrar</strong>. Se vincula para dejar registro y para
                  aplicar lo que haya quedado en la bandeja, pero el socio{" "}
                  <strong>no</strong> queda marcado con débito automático.
                </>
              )}
            </dd>
          </div>
        </dl>

        {/* Avisos: no bloquean, pero el operador no puede enterarse después.
            `role="none"`: son ayuda estática del panel, no la respuesta a una
            acción, y un role="alert" los reanunciaría en cada render. */}
        {divergentWith !== null && (
          <FormMessage kind="warning" role="none">
            {`La suscripción cobra un monto distinto del valor vigente (${divergentWith}). Se vincula igual y el cobro se imputa por lo que MP cobre de verdad; el ajuste del monto se hace aparte.`}
          </FormMessage>
        )}
        {member.withdrawn && (
          <FormMessage kind="warning" role="none">
            Ese socio está dado de baja. Los débitos que lleguen sólo van a poder cubrir las cuotas
            que le quedaron pendientes.
          </FormMessage>
        )}
        {otherLive > 0 && (
          <FormMessage kind="warning" role="none">
            {`Ese socio ya tiene ${otherLive === 1 ? "otra suscripción" : `otras ${otherLive} suscripciones`} que sigue${otherLive === 1 ? "" : "n"} cobrando. Si vinculás ésta, le van a debitar la cuota más de una vez por mes.`}
          </FormMessage>
        )}
      </div>

      {state.error && <FormMessage kind="error" box>{state.error}</FormMessage>}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>{pending ? "Vinculando…" : "Vincular"}</Button>
        <Button asChild variant="outline"><Link href={BASE}>Volver</Link></Button>
      </div>
    </form>
  );
}
