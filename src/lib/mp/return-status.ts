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

/** `Map` y no un objeto literal a propósito: con un objeto, `BY_VALUE[v]` para
 *  `v = "constructor"` o `v = "__proto__"` devuelve algo heredado de
 *  `Object.prototype` —una función, un objeto— que TypeScript tipa igual como
 *  `ReturnOutcome`. Eso cruzaba el borde servidor→cliente como prop y rompía la
 *  pantalla del socio: una función no es serializable. Un `Map` no tiene
 *  prototipo que consultar. */
const BY_VALUE = new Map<string, Exclude<ReturnOutcome, "unknown">>([
  ["approved", "approved"],
  ["accredited", "approved"],
  ["rejected", "rejected"],
  ["cancelled", "rejected"],
  ["canceled", "rejected"],
  ["failure", "rejected"],
  ["charged_back", "rejected"],
  ["pending", "pending"],
  ["in_process", "pending"],
  ["in_mediation", "pending"],
  ["authorized", "pending"],
]);

function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v)?.trim().toLowerCase() ?? "";
}

export function readReturnOutcome(
  searchParams: Record<string, string | string[] | undefined>,
): ReturnOutcome {
  for (const key of KEYS) {
    // "null" con todas las letras es lo que MP manda cuando el vecino abandona
    // el checkout: es la ausencia de resultado, no un resultado.
    const outcome = BY_VALUE.get(first(searchParams[key]));
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

/** Qué tarjeta le toca al vecino que vuelve de Checkout Pro.
 *
 *  Está acá y no adentro del componente para poder probar la matriz entera sin
 *  un DOM: son 16 combinaciones y una sola de ellas era la cara.
 *
 *  LAS DOS SEÑALES NO VALEN LO MISMO, y ahí estaba el bug:
 *
 *  - `settled` —entró un pago NUEVO mientras la pantalla miraba— es un hecho de
 *    ESTA vuelta. Manda sobre cualquier cosa que diga la query.
 *  - `paidBefore` —ya había un pago por link reciente al MONTAR— es ambiguo: si
 *    MP no dijo nada (`unknown`) es la carrera que ganó el webhook y ES la
 *    confirmación; pero si MP dijo `pending` o `rejected`, el desenlace de esta
 *    vuelta es ése y el pago que estaba es el de recién, otro. El caso caro:
 *    pagó una cuota con tarjeta a las 10:00 y a las 10:04 sacó un cupón de
 *    Rapipago por las otras dos. Decirle "listo" ahí es que nunca pague el cupón.
 *
 *  `approved` sin ningún pago a la vista NO alcanza para afirmar el éxito: es un
 *  query param y lo puede escribir cualquiera. Al revés tampoco: un `rejected`
 *  armado a mano contra un socio que sí pagó no puede mandarlo a pagar de nuevo,
 *  y por eso el rechazo con un pago reciente encima tiene tarjeta propia. */
export type ReturnView =
  /** El pago llegó: recibo abajo. */
  | "confirmed"
  /** MP lo dejó pendiente (cupón, transferencia) y no llegó nada nuevo. */
  | "pending"
  /** MP lo rechazó y no hay ningún pago reciente que lo contradiga. */
  | "rejected"
  /** MP lo rechazó, pero el servidor ya tenía un pago reciente de este socio.
   *  Las dos cosas pueden ser ciertas a la vez —pagó, reintentó, le rechazaron
   *  la segunda— y el texto tiene que nombrarlas sin empujar a pagar de nuevo. */
  | "rejected-after-payment"
  /** Sin desenlace utilizable todavía: hay que seguir esperando. */
  | "waiting";

export function returnView(input: {
  outcome: ReturnOutcome;
  /** ¿Había un pago por link reciente ya al montar la pantalla? (foto fija) */
  paidBefore: boolean;
  /** ¿Entró un pago nuevo mientras la pantalla sondeaba? */
  settled: boolean;
}): ReturnView {
  const { outcome, paidBefore, settled } = input;
  if (settled) return "confirmed";
  if (paidBefore && (outcome === "approved" || outcome === "unknown")) return "confirmed";
  if (outcome === "rejected") return paidBefore ? "rejected-after-payment" : "rejected";
  if (outcome === "pending") return "pending";
  return "waiting";
}
