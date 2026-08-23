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
// Así que la pantalla dice lo que sabe —"estamos esperando la confirmación"— y
// sondea. El sondeo es un `router.refresh()`: no hay endpoint de estado, la
// página ya lee la cuenta corriente y el único dato que importa es si apareció
// un pago nuevo. Dos minutos de espera (24 × 5 s) y después se ofrece consultar
// a mano, en vez de girar para siempre.
//
// Con la pestaña en segundo plano no se sondea: el vecino que se fue a otra
// cosa vuelve, la pestaña se hace visible y el intervalo sigue donde estaba.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FormMessage } from "@/components/admin/form-message";
import { Button } from "@/components/ui/button";

const EVERY_MS = 5_000;
const MAX_TRIES = 24;

export function ReturnNotice({ paymentsCount }: { paymentsCount: number }) {
  const router = useRouter();
  // La foto del momento de volver. `useState` con valor inicial y no una
  // constante derivada: en cada `refresh()` la prop cambia, y lo que decide si
  // el pago llegó es la comparación contra ESTE número, el de la llegada.
  const [baseline] = useState(paymentsCount);
  const [tries, setTries] = useState(0);
  const arrived = paymentsCount > baseline;
  const exhausted = tries >= MAX_TRIES;

  useEffect(() => {
    if (arrived || exhausted) return;
    const id = setInterval(() => {
      // Un intervalo que corre con la pestaña oculta gasta el presupuesto de
      // intentos mientras el vecino mira otra cosa, y llega a los dos minutos
      // sin que nadie haya visto nada.
      if (document.visibilityState !== "visible") return;
      setTries((t) => t + 1);
      router.refresh();
    }, EVERY_MS);
    return () => clearInterval(id);
  }, [arrived, exhausted, router]);

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
        <p>
          Todavía no nos llegó la confirmación. Puede demorar unos minutos; si pagaste, la cuota se
          va a imputar sola.
        </p>
        <Button
          type="button"
          variant="outline"
          className="mt-3 min-h-11 px-4"
          onClick={() => {
            setTries(0);
            router.refresh();
          }}
        >
          Volver a consultar
        </Button>
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
        <span>Si el pago salió bien, el recibo aparece acá en unos segundos.</span>
      </span>
    </FormMessage>
  );
}
