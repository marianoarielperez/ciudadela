"use client";
// La vuelta de Mercado Pago (`/mi/cuenta?volvio=1`).
//
// EL PORQUÉ: la `back_url` la dispara el navegador del vecino, y la
// acreditación llega por OTRO camino —el webhook de MP contra el servidor—.
// Los dos ocurren en segundos, pero no en orden garantizado: sin esta tarjeta,
// el socio que vuelve de pagar aterriza en una cuenta que todavía dice "Debés 3
// cuotas" y concluye, razonablemente, que el pago no salió. Después llama a la
// sede.
//
// QUÉ SE MUESTRA lo decide `returnView` (`@/lib/mp/return-status`), que es puro
// y está testeado con la matriz completa. Acá quedan sólo los textos y el
// sondeo. La regla, en una línea: un hecho que el servidor vio le gana a la
// query, pero sólo si es un hecho de ESTA vuelta.
//
//  - `outcome` — lo que MP agrega a la query (`readReturnOutcome`). Es dato del
//    navegador: alcanza para NO afirmar un éxito, no para afirmarlo.
//  - `justPaidByLink` — el servidor ya ve un pago por link recién acreditado.
//    Se congela al montar (`paidBefore`): si ya estaba ahí al llegar y MP dijo
//    "pendiente" o "rechazado", ese pago es el de recién y no el desenlace de
//    esta vuelta. Con MP callado (`unknown`) sí es la confirmación —el webhook
//    le ganó la carrera al redirect, que es lo habitual—.
//  - `latestPaymentId` — comparado contra la foto del montaje, detecta el pago
//    que entra MIENTRAS la pantalla sondea. Ése sí es de esta vuelta.
//
// El sondeo es un `router.refresh()`: no hay endpoint de estado, la página ya
// lee la cuenta corriente. Dos minutos (24 × 5 s) y después se ofrece consultar
// a mano, en vez de girar para siempre. Con la pestaña en segundo plano no se
// sondea: el vecino que se fue a otra cosa vuelve, la pestaña se hace visible y
// el intervalo sigue donde estaba.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FormMessage } from "@/components/admin/form-message";
import { Button } from "@/components/ui/button";
import { returnView, type ReturnOutcome } from "@/lib/mp/return-status";

const EVERY_MS = 5_000;
const MAX_TRIES = 24;

export function ReturnNotice({ outcome, latestPaymentId, justPaidByLink }: {
  outcome: ReturnOutcome;
  /** Id del pago más nuevo del socio, o 0 si no tiene ninguno. */
  latestPaymentId: number;
  /** Ya hay un pago por link acreditado en los últimos minutos. */
  justPaidByLink: boolean;
}) {
  const router = useRouter();
  // Las dos fotos del momento de volver. `useState` con valor inicial y no una
  // constante derivada: en cada `refresh()` las props cambian.
  const [baseline] = useState(latestPaymentId);
  const [paidBefore] = useState(justPaidByLink);
  const [tries, setTries] = useState(0);
  const view = returnView({ outcome, paidBefore, settled: latestPaymentId > baseline });
  // Con el pago pendiente se sigue sondeando —un `in_process` se acredita en
  // segundos— pero el texto ya dice la verdad desde el primer render, sin
  // spinner: un cupón de Rapipago no se va a acreditar mientras el vecino mira.
  const done = view === "confirmed" || view === "rejected" || view === "rejected-after-payment";
  const exhausted = tries >= MAX_TRIES;

  useEffect(() => {
    if (done || exhausted) return;
    const id = setInterval(() => {
      // Un intervalo que corre con la pestaña oculta gasta el presupuesto de
      // intentos mientras el vecino mira otra cosa, y llega a los dos minutos
      // sin que nadie haya visto nada.
      if (document.visibilityState !== "visible") return;
      setTries((t) => t + 1);
      router.refresh();
    }, EVERY_MS);
    return () => clearInterval(id);
  }, [done, exhausted, router]);

  if (view === "confirmed") {
    return (
      <FormMessage kind="success" box>
        ¡Listo! Tu pago quedó registrado. Abajo tenés el recibo.
      </FormMessage>
    );
  }

  if (view === "rejected") {
    return (
      <FormMessage kind="error" box as="div">
        <p>
          Mercado Pago rechazó el pago: no se te cobró nada y la cuota sigue impaga. Podés probar
          otra vez, con otro medio de pago, o pagar en la sede.
        </p>
        <div className="mt-3">
          <RetryButton />
        </div>
      </FormMessage>
    );
  }

  if (view === "rejected-after-payment") {
    return (
      // Ámbar y no rojo: no es un fallo limpio. Las dos cosas son ciertas —hay
      // un pago registrado y este intento no entró— y el texto tiene que
      // nombrarlas juntas. Sin esto, un socio que sí pagó leía "la cuota sigue
      // impaga" con su recibo tres centímetros más abajo, y el empujón era
      // pagar dos veces.
      <FormMessage kind="warning" box as="div">
        <p>
          Este intento de pago no se completó y no se te cobró nada. Tenés otro pago registrado
          hace unos minutos, con su recibo acá abajo: fijate qué cuotas te quedan impagas antes de
          volver a pagar.
        </p>
        <div className="mt-3">
          <RetryButton />
        </div>
      </FormMessage>
    );
  }

  if (view === "pending") {
    return (
      <FormMessage kind="warning" box as="div">
        <p>
          Mercado Pago dejó el pago pendiente de acreditación. Cuando se acredite, la cuota se
          imputa sola y el recibo aparece acá abajo: si elegiste efectivo o transferencia, puede
          tardar hasta dos días hábiles.
        </p>
        {paidBefore && (
          // El recibo de abajo es de otro pago. Sin esta línea, el vecino que
          // acaba de sacar un cupón por las cuotas que le faltaban lo lee como
          // la confirmación del cupón y no lo paga nunca.
          <p className="mt-2">
            Ojo: el recibo que ya ves más abajo es de un pago anterior, no de éste.
          </p>
        )}
        <div className="mt-3">
          <RecheckButton onClick={() => { setTries(0); router.refresh(); }} />
        </div>
      </FormMessage>
    );
  }

  if (exhausted) {
    return (
      <FormMessage kind="warning" box as="div">
        {/* Este texto no puede prometer nada: acá no sabemos si el pago se
            aprobó (MP dijo "aprobado" en la query, que es dato del navegador, o
            no dijo nada). Nombra las dos salidas posibles y deja la puerta
            abierta a reintentar, porque el caso "se rechazó y nadie se lo dijo"
            es el que termina en una cuota impaga. El pendiente no llega acá:
            tiene tarjeta propia desde el primer render. */}
        <p>
          Todavía no nos llegó la confirmación de Mercado Pago. Si el pago se aprobó, la cuota se
          imputa sola y el recibo aparece acá abajo. Si se rechazó, no se te cobró nada y la cuota
          sigue impaga.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <RecheckButton onClick={() => { setTries(0); router.refresh(); }} />
          <RetryButton />
        </div>
      </FormMessage>
    );
  }

  return (
    <FormMessage kind="neutral" box role="status" as="div">
      <span className="flex items-center gap-3">
        <span
          aria-hidden
          className="size-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none"
        />
        <span>
          Estamos esperando la confirmación de Mercado Pago. Si el pago se aprobó, el recibo aparece
          acá en unos segundos.
        </span>
      </span>
    </FormMessage>
  );
}

/** Vuelve al formulario, que está en la misma pantalla más abajo. Un ancla y no
 *  un botón que dispare algo: lo que el vecino tiene que rehacer es elegir
 *  cuántas cuotas y volver a salir, exactamente como la primera vez. */
function RetryButton() {
  return (
    <Button asChild variant="outline" className="min-h-11 px-4">
      <a href="#pagar">Probar de nuevo</a>
    </Button>
  );
}

function RecheckButton({ onClick }: { onClick: () => void }) {
  return (
    <Button type="button" variant="outline" className="min-h-11 px-4" onClick={onClick}>
      Volver a consultar
    </Button>
  );
}
