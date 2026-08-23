// Links de pago de Checkout Pro (spec 4B §12). La preferencia NO se persiste:
// el pago vuelve por webhook con `pago:{memberId}:{n}` y `allocate(n)` decide
// qué cuotas cubre (las más viejas). El monto es n × valor VIGENTE de la
// categoría, de `fee_values` — nunca de un plan de MP.
//
// Un solo módulo para los dos llamadores —el link que genera el operador desde
// la ficha y el "Pagar ahora" del panel del socio— porque lo que se le pide a
// MP tiene que ser idéntico: si el título, la referencia o la URL de vuelta se
// escribieran dos veces, un día el webhook recibiría un pago que no sabe imputar.
import type { MemberCategory } from "@/generated/prisma/client";
import { feeValueReader, type makeFeeValueReader } from "@/lib/treasury/fee-values";
import { feeAmountFor } from "@/lib/treasury/rules";
import { mpGateway, type MpGateway } from "./gateway";
import { MAX_LINK_FEES, PAYMENT_LINK_TTL_MS, paymentLinkReference } from "./references";

/** Lo que el vecino lee en el checkout de MP y después en el resumen de su
 *  tarjeta. Por eso nombra a la institución y no dice "SIGeV". */
export function paymentLinkTitle(n: number): string {
  return n === 1 ? "Cuota Vecinal Ciudadela" : `Cuota Vecinal Ciudadela × ${n}`;
}

export type PaymentLinkError = "no_fee_value" | "category_without_fee" | "bad_n";

/** Los tres rechazos, en castellano y de cara a quien los va a leer. Viven acá
 *  y no en cada action porque las dos pantallas —panel y socio— muestran lo
 *  mismo: el hecho es el mismo. */
export const PAYMENT_LINK_ERRORS: Record<PaymentLinkError, string> = {
  no_fee_value: "El valor de la cuota no está configurado: no se puede generar el link.",
  category_without_fee: "Esta categoría no paga cuota: no hay nada que cobrar por link.",
  bad_n: `La cantidad de cuotas tiene que estar entre 1 y ${MAX_LINK_FEES}.`,
};

export type PaymentLinkResult =
  | { ok: true; initPoint: string; amount: number; unit: number; reference: string; expiresAt: Date }
  | { ok: false; error: PaymentLinkError };

type Deps = {
  gateway: Pick<MpGateway, "createPreference">;
  feeValues: Pick<ReturnType<typeof makeFeeValueReader>, "current">;
  baseUrl: () => string;
  now?: () => Date;
};

export function makePaymentLinks(deps: Deps) {
  const now = deps.now ?? (() => new Date());
  return {
    async create(input: { member: { id: number; category: MemberCategory }; n: number }): Promise<PaymentLinkResult> {
      // El rango se valida ANTES de leer el valor y antes de tocar MP:
      // `paymentLinkReference` también lo valida, pero tirando, y para entonces
      // ya habría un monto calculado sobre un `n` que nadie va a poder imputar.
      if (!Number.isInteger(input.n) || input.n < 1 || input.n > MAX_LINK_FEES) {
        return { ok: false, error: "bad_n" };
      }
      const at = now();
      const value = await deps.feeValues.current(at);
      if (!value) return { ok: false, error: "no_fee_value" };
      const unit = feeAmountFor(input.member.category, value);
      // Honorario, vitalicio y cadete no pagan cuota: no hay link que generar,
      // y cobrarles "cero" sería peor que decirlo.
      if (unit === null) return { ok: false, error: "category_without_fee" };
      const amount = unit * input.n;
      const reference = paymentLinkReference(input.member.id, input.n);
      const base = deps.baseUrl();
      // El importe se congela acá, al valor de HOY. El vencimiento es lo que
      // impide que ese precio sobreviva a una actualización de cuota: se cuenta
      // desde el mismo instante con el que se leyó el valor, no desde el reloj.
      const expiresAt = new Date(at.getTime() + PAYMENT_LINK_TTL_MS);
      const pref = await deps.gateway.createPreference({
        title: paymentLinkTitle(input.n),
        amount,
        externalReference: reference,
        // Los tres desenlaces (aprobado, pendiente, rechazado) vuelven a la
        // MISMA pantalla, que los distingue leyendo la query que MP le agrega
        // (`readReturnOutcome`). Una URL sola y no tres: la que manda es la
        // acreditación que llega por webhook, y el desenlace de la vuelta sólo
        // decide QUÉ SE LE DICE al vecino mientras tanto — sobre todo que un
        // rechazo se nombre como rechazo y ofrezca reintentar.
        backUrl: `${base}/mi/cuenta?volvio=1`,
        notificationUrl: `${base}/api/webhooks/mp`,
        expiresAt,
      });
      return { ok: true, initPoint: pref.initPoint, amount, unit, reference, expiresAt };
    },
  };
}

export const paymentLinks = makePaymentLinks({
  gateway: mpGateway,
  feeValues: feeValueReader,
  baseUrl: () => process.env.AUTH_URL ?? "http://localhost:3000",
});
