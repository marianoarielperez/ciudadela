// Qué le pasó al pago, leído de la vuelta de Checkout Pro.
//
// EL PORQUÉ: las tres `back_urls` de la preferencia son la misma URL, así que
// aprobado, pendiente y rechazado aterrizan todos en `/mi/cuenta?volvio=1`. Sin
// leer el desenlace, al vecino cuya tarjeta fue rechazada se le dice "si
// pagaste, la cuota se va a imputar sola": no reintenta, y la vecinal no cobra.
//
// Mercado Pago agrega el resultado a la query de la vuelta, pero el nombre del
// parámetro no es uno solo ni está garantizado —según el flujo aparece como
// `collection_status`, como `status`, o directamente no aparece (el vecino
// cerró la pestaña y volvió a mano)—. Por eso esto NO depende de una clave:
// mira varias, se queda con la primera que trae un valor que entiende, y si no
// entiende nada devuelve `unknown`, que es una respuesta legítima y NO se
// traduce a "salió bien".
//
// Los nombres se confirman contra el sandbox en la Task 14. Agregar uno más es
// agregarlo a `KEYS`; agregar un estado, a `BY_VALUE`.

export type ReturnOutcome = "approved" | "rejected" | "pending" | "unknown";

/** En orden de preferencia. `collection_status` es el que MP documenta para
 *  Checkout Pro; `status` es el que aparece en la práctica; el tercero es
 *  defensivo. */
const KEYS = ["collection_status", "status", "payment_status"] as const;

const BY_VALUE: Record<string, Exclude<ReturnOutcome, "unknown">> = {
  approved: "approved",
  accredited: "approved",
  rejected: "rejected",
  cancelled: "rejected",
  canceled: "rejected",
  failure: "rejected",
  charged_back: "rejected",
  pending: "pending",
  in_process: "pending",
  in_mediation: "pending",
  authorized: "pending",
};

function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v)?.trim().toLowerCase() ?? "";
}

export function readReturnOutcome(
  searchParams: Record<string, string | string[] | undefined>,
): ReturnOutcome {
  for (const key of KEYS) {
    // "null" con todas las letras es lo que MP manda cuando el vecino abandona
    // el checkout: es la ausencia de resultado, no un resultado.
    const outcome = BY_VALUE[first(searchParams[key])];
    if (outcome) return outcome;
  }
  return "unknown";
}

/** Cuánto hacia atrás cuenta como "este pago, el que acabo de hacer". Diez
 *  minutos es holgado para el ida y vuelta por el checkout (tipear una tarjeta
 *  lleva un rato) y corto para no confundirse con el pago del mes pasado. */
export const RECENT_PAYMENT_MS = 10 * 60_000;

/** ¿Ya hay un pago por link acreditado de este socio, de recién?
 *
 *  EL PORQUÉ: lo más probable es que el webhook GANE la carrera contra el
 *  redirect —MP notifica al aprobar, y la vuelta todavía tiene que pasar por el
 *  navegador del vecino—, así que al primer render de `?volvio=1` el pago suele
 *  estar imputado. Una pantalla que decide comparando contra un contador
 *  congelado en ese primer render nunca ve llegar nada, y a los dos minutos le
 *  dice al vecino que no hay confirmación con el recibo visible más abajo.
 *
 *  La señal, entonces, es de identidad y de tiempo: tipo `link`, aplicado, de
 *  hace minutos. `now` se inyecta para poder testearlo. */
export function hasRecentLinkPayment(
  payments: readonly { type: string; status: string; paidAt: Date }[],
  now: () => number = Date.now,
): boolean {
  const t = now();
  return payments.some(
    (p) => p.type === "link" && p.status === "applied" && t - p.paidAt.getTime() < RECENT_PAYMENT_MS,
  );
}
