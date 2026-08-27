// Adhesión al débito automático desde el panel del socio (5B). Puro, sin
// Prisma ni red: el llamador (un servicio con base de datos) le arma el
// `input` a partir de la ficha, y la tabla de casos se prueba sin fixtures.
//
// LA REGLA, en una línea: el socio NO puede adherirse si ya pagó una cuota
// este mes calendario — para que no le salgan dos cobros el mismo mes. La
// DEUDA no bloquea, y por eso esta función ni siquiera la recibe como
// parámetro: el primer débito la empieza a saldar, no hace falta estar al
// día para adherirse.
import type { MemberCategory, PaymentType } from "@/generated/prisma/client";
import { formatDateAR } from "@/lib/format";
import { canStillCharge } from "@/lib/mp/subscription-status";
import { addMonths, currentPeriod, periodLabel, periodMonth, periodYear } from "@/lib/treasury/periods";
import { categoryPaysFee } from "@/lib/treasury/rules";

/** Los tipos de pago que cuentan como "ya pagó la cuota de este mes" para la
 *  guarda de abajo. Incluye `entry`: la cuota de ingreso ya cubrió el mes del
 *  alta (REG-14), así que también bloquea. Quedan afuera `voluntary` (no es
 *  una cuota) y `extraordinary` (no es la cuota social del mes). El llamador
 *  es quien cuenta, contra la base, los pagos `applied` de estos tipos dentro
 *  del mes civil argentino — esta lista es sólo el criterio de qué cuenta. */
export const ADHESION_BLOCKING_TYPES: readonly PaymentType[] = ["debit", "link", "cash", "entry"];

export type AdhesionVerdict =
  | { ok: true }
  | { ok: false; reason: "category" | "active_subscription" | "no_email" }
  | { ok: false; reason: "paid_this_month"; availableFrom: Date }
  /** `until` es un `toPeriod` (AAAA-MM), no una fecha: la exención se vota por
   *  MESES calendario (Art. 7 inc. a.4) y el mensaje nombra el mes, no un día. */
  | { ok: false; reason: "exempted"; until: string };

/** El 1° del mes civil argentino SIGUIENTE, a las 00:00 AR (= 03:00Z), para el
 *  "podés adherirte desde el…" — mismo criterio de corrimiento que
 *  `monthBoundsAR` en `treasury/receipts-query.ts:35`: sin las 3 horas, un
 *  socio que mira la pantalla entre las 21:00 y las 24:00 vería una fecha que
 *  en Argentina todavía no llegó. */
export function nextMonthStartAR(at: Date): Date {
  const next = addMonths(currentPeriod(at), 1);
  return new Date(Date.UTC(periodYear(next), periodMonth(next) - 1, 1, 3));
}

/** Orden de las guardas: cada una corta antes de mirar la siguiente, así que
 *  el orden importa y está fijado por el brief (Task 11).
 *
 *  0) Exención de cuota vigente (Art. 7 inc. a.4): no hay nada que debitar.
 *     Va PRIMERA a propósito — se exime a un socio ACTIVO (guarda 1 del
 *     asiento), así que la guarda de categoría lo dejaría pasar y el vecino
 *     terminaría con un mandato de cobro mensual contra el acta que se lo
 *     perdona. Es aditiva: sin exención el veredicto es exactamente el de antes.
 *  1) Categoría que no paga cuota: no hay débito que adherir, sin importar
 *     nada más.
 *  2) Suscripción todavía cobrable (`canStillCharge`: authorized, pending o
 *     paused): cierra, para este camino, el hueco del doble preapproval
 *     (docs/06:469) — dos débitos por mes al mismo vecino.
 *  3) Pagó una cuota este mes calendario (ingreso incluido): bloquea hasta el
 *     mes que viene. La DEUDA no entra acá — no es parámetro de la función.
 *  4) Sin email: Mercado Pago exige `payer_email` para crear el preapproval. */
export function adhesionVerdict(input: {
  category: MemberCategory;
  email: string | null;
  subscriptionStatuses: string[];
  paidThisMonth: boolean;
  /** El `toPeriod` de la exención vigente del socio, o `null`. Lo resuelve el
   *  llamador con `activeExemption` —LA función compartida—, nunca con un
   *  `where` propio. Opcional para que los llamadores que todavía no la
   *  consultan sigan compilando: ausente equivale a "no hay exención". */
  exemptedUntil?: string | null;
  at: Date;
}): AdhesionVerdict {
  if (input.exemptedUntil) return { ok: false, reason: "exempted", until: input.exemptedUntil };
  if (!categoryPaysFee(input.category)) return { ok: false, reason: "category" };
  if (input.subscriptionStatuses.some(canStillCharge)) {
    return { ok: false, reason: "active_subscription" };
  }
  if (input.paidThisMonth) {
    return { ok: false, reason: "paid_this_month", availableFrom: nextMonthStartAR(input.at) };
  }
  if (!input.email) return { ok: false, reason: "no_email" };
  return { ok: true };
}

/** EL hecho de la exención como se le dice AL SOCIO, en una sola definición.
 *
 *  Lo dicen cuatro superficies del panel del vecino —el banner de `/mi/cuenta`,
 *  el rechazo de "Pagar ahora", el bloqueo del débito y la tarjeta de `/mi`— y
 *  llegó a estar redactado de dos maneras distintas. No es prolijidad: el mismo
 *  vecino ve tres de esas cuatro en el mismo minuto, y dos frases distintas para
 *  el mismo hecho se leen como dos situaciones distintas.
 *
 *  Devuelve la frase SIN puntuación final: cada pantalla la cierra con un punto
 *  o le agrega su cola ("…: no hay nada que debitar"). El hecho es lo que se
 *  comparte; la consecuencia es de cada pantalla.
 *
 *  Vive acá y no al lado de `adminExemptionNotice` —su gemelo del operador, en
 *  `treasury/exemptions.ts`— por una razón mecánica: ese módulo arma su singleton
 *  de Prisma al evaluarse, y `debit-adhesion.ts` es PURO y se prueba sin base.
 *  Importarlo desde acá rompería las dos cosas.
 *
 *  El ACTA no se nombra: su número es la referencia con la que el operador ubica
 *  la decisión en el libro, y al vecino no le dice nada. */
export function memberExemptionFact(toPeriod: string): string {
  return `Estás eximido de la cuota hasta ${periodLabel(toPeriod)}`;
}

/** El TONO del bloqueo, que no es el mismo para todos los motivos. Una exención
 *  es una decisión que la Comisión tomó A FAVOR del socio: no hay nada mal ni
 *  nada que él tenga que resolver, así que va neutral. Los otros cuatro sí son
 *  algo que le falta o que le impide adherirse hoy, y van en ámbar.
 *
 *  Es una función y no un ternario en la pantalla porque la regla es de este
 *  módulo —el mismo que redacta el mensaje—, y así una pantalla nueva no puede
 *  pintar de advertencia lo que las otras muestran como un hecho. */
export function adhesionBlockTone(v: Exclude<AdhesionVerdict, { ok: true }>): "neutral" | "warning" {
  return v.reason === "exempted" ? "neutral" : "warning";
}

export function adhesionBlockMessage(v: Exclude<AdhesionVerdict, { ok: true }>): string {
  switch (v.reason) {
    case "category":
      return "Tu categoría no paga cuota, así que no hay débito que adherir.";
    case "active_subscription":
      return "Ya tenés un débito automático activo. Si querés cambiarlo, primero cancelalo.";
    case "paid_this_month":
      return `Ya abonaste una cuota este mes. Podés adherirte desde el ${formatDateAR(v.availableFrom)}.`;
    case "no_email":
      return "Para adherir el débito necesitás un email cargado en tu ficha. Cargalo en Mis datos.";
    case "exempted":
      // El hecho sale del constructor compartido; lo único de esta pantalla es
      // la cola, que es la consecuencia concreta acá: no hay nada que debitar.
      return `${memberExemptionFact(v.until)}: no hay nada que debitar.`;
  }
}
