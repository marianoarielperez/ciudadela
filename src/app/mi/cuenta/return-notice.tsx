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
// DOS COSAS DECIDEN QUÉ SE MUESTRA, y ninguna es un contador:
//
//  1. `outcome` — el desenlace que MP agrega a la query de la vuelta
//     (`readReturnOutcome`). Un RECHAZO tiene que nombrarse como rechazo y
//     ofrecer reintentar: decirle "si pagaste, la cuota se va a imputar sola" a
//     alguien cuya tarjeta fue rechazada es garantizar que no reintente.
//  2. `justPaidByLink` — si el servidor ya ve un pago por link recién
//     acreditado de este socio. Lo más probable es que el webhook GANE la
//     carrera (MP notifica al aprobar; el redirect todavía tiene que dar la
//     vuelta por el navegador del vecino), así que el pago suele estar ahí ya
//     en el primer render. Comparar contra la foto del primer render lo daba
//     por "no llegó" para siempre — y a los dos minutos le decía que no había
//     confirmación con el recibo visible tres centímetros más abajo.
//
// `latestPaymentId` cubre el caso inverso —el webhook llega DESPUÉS, mientras
// la pantalla sondea— comparando el id del pago más nuevo contra el del momento
// de volver. El sondeo es un `router.refresh()`: no hay endpoint de estado, la
// página ya lee la cuenta corriente. Dos minutos (24 × 5 s) y después se ofrece
// consultar a mano, en vez de girar para siempre.
//
// Con la pestaña en segundo plano no se sondea: el vecino que se fue a otra
// cosa vuelve, la pestaña se hace visible y el intervalo sigue donde estaba.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FormMessage } from "@/components/admin/form-message";
import { Button } from "@/components/ui/button";
import type { ReturnOutcome } from "@/lib/mp/return-status";

const EVERY_MS = 5_000;
const MAX_TRIES = 24;

export function ReturnNotice({ outcome, latestPaymentId, justPaidByLink }: {
  outcome: ReturnOutcome;
  /** Id del pago más nuevo del socio, o 0 si no tiene ninguno. */
  latestPaymentId: number;
  /** Ya hay un pago por link acreditado en los últimos minutos: el webhook ganó
   *  la carrera y esto ES la confirmación que el vecino vino a buscar. */
  justPaidByLink: boolean;
}) {
  const router = useRouter();
  // La foto del momento de volver, para detectar el pago que entra MIENTRAS la
  // pantalla sondea. `useState` con valor inicial y no una constante derivada:
  // en cada `refresh()` la prop cambia.
  const [baseline] = useState(latestPaymentId);
  const [tries, setTries] = useState(0);
  const rejected = outcome === "rejected";
  const arrived = !rejected && (justPaidByLink || latestPaymentId > baseline);
  const done = rejected || arrived;
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

  if (rejected) {
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

  if (arrived) {
    return (
      <FormMessage kind="success" box>
        ¡Listo! Tu pago quedó registrado. Abajo tenés el recibo.
      </FormMessage>
    );
  }

  if (exhausted) {
    return (
      <FormMessage kind="warning" box as="div">
        {/* Este texto no puede prometer nada: acá no sabemos si el pago se
            aprobó. Nombra las dos salidas posibles y deja la puerta abierta a
            reintentar, porque el caso "se rechazó y nadie se lo dijo" es el que
            termina en una cuota impaga. */}
        <p>
          {outcome === "pending"
            ? "Mercado Pago dejó el pago pendiente de acreditación. Cuando se acredite, la cuota se imputa sola y el recibo aparece acá abajo: si elegiste efectivo o transferencia, puede tardar hasta dos días hábiles."
            : "Todavía no nos llegó la confirmación de Mercado Pago. Si el pago se aprobó, la cuota se imputa sola y el recibo aparece acá abajo. Si se rechazó, no se te cobró nada y la cuota sigue impaga."}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            className="min-h-11 px-4"
            onClick={() => {
              setTries(0);
              router.refresh();
            }}
          >
            Volver a consultar
          </Button>
          {outcome !== "pending" && <RetryButton />}
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
