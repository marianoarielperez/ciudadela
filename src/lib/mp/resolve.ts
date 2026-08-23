// A quién pertenece un pago de Mercado Pago (spec 4B §5). Función PURA sobre
// datos que el llamador ya cargó: se prueba con una tabla de casos sin Prisma.
//
// La suscripción manda sobre la referencia (filas 3 y 4 antes que 5–7): el
// `preapprovalId` es el dato más confiable y resuelve los dos casos reales —
// la suscripción de Mariano sin referencia útil, y la de Martín con
// `solicitud:9` apuntando a una solicitud que ya no existe.
//
// Lo único que se antepone a esa decisión es la marca de ingreso de ESTE mismo
// cobro (fila 2): ver la nota de `isMarkedEntryOf`.
import { parseApplicationReference, parsePaymentLinkReference } from "./references";
import type { UnmatchedReason } from "./unmatched";

export type MpPaymentFacts = { mpPaymentId: string; preapprovalId: string | null; externalReference: string | null };

export type ResolveContext = {
  /** `Payment` con este `mpPaymentId`, si ya se asentó. */
  existingPayment: { id: number } | null;
  /** `MpSubscription` por `preapprovalId`. */
  subscription: { memberId: number | null; applicationId: number | null } | null;
  /** `MpSubscription` por `externalReference` (sólo si la referencia es `solicitud:`). */
  subscriptionByReference: { memberId: number | null } | null;
  /** `Application` de `solicitud:{id}`, si existe. */
  application: { id: number; mpPaymentIdEntry: string | null; memberId: number | null } | null;
  /** `Member` de `pago:{memberId}:{n}`, si existe. */
  linkMember: { id: number } | null;
};

export type Decision =
  | { kind: "already_processed"; paymentId: number }
  | { kind: "debit"; memberId: number; preapprovalId: string | null }
  | { kind: "link"; memberId: number; n: number }
  | { kind: "entry"; applicationId: number }
  | { kind: "unmatched"; reason: UnmatchedReason };

// ¿La solicitud lleva la marca de ESTE cobro? O sea: este dinero ya fue
// declarado cuota de ingreso de esta solicitud, y lo que falta es el `Payment`.
//
// La marca `mpPaymentIdEntry` se escribe ANTES de crear el `Payment`: si el
// proceso muere en el medio (deadlock, restart, base caída) queda la marca sin
// `Payment`. Si además MP agota sus reintentos y después la Comisión asienta el
// acta, `record.ts` le pone `memberId` a la `MpSubscription` y este cobro
// dejaría de resolver como ingreso: la fila 3 lo agarraría como `debit`. Cuando
// la conciliación lo vuelva a pasar por `applyPayment` —su trabajo es
// exactamente re-aplicar cobros de MP sin `Payment` local— esos pesos de la
// CUOTA DE INGRESO se imputarían como CUOTA SOCIAL, contra REG-14. Lo mismo si
// alguien levanta desde la bandeja una fila `treasury_rejected` de un ingreso,
// que lleva `externalReference = solicitud:{id}`.
//
// Por eso la marca se consulta ANTES que la suscripción. Es lo único que se
// antepone: la marca es de este cobro y de ninguna otra cosa.
function isMarkedEntryOf(application: { mpPaymentIdEntry: string | null }, facts: MpPaymentFacts): boolean {
  return application.mpPaymentIdEntry === facts.mpPaymentId;
}

// ¿Este cobro es la cuota de ingreso de esta solicitud? Sí en dos casos: la
// solicitud todavía no tiene ingreso cobrado, o el que tiene es ESTE mismo id.
//
// El segundo caso (la marca) ya cortó arriba; acá el que decide es el primero.
// Devolver "ya registrado" en el caso de la marca dejaba el cobro sin `Payment`
// PARA SIEMPRE, y con eso sin recibo, sin bandeja y sin la única barrera que
// impide que ese mismo dinero se aplique después como CUOTA. Se devuelve
// `entry`: lo que falta es justamente el `Payment`, y reponerlo es seguro
// porque `registerPaymentCore` es idempotente por `mpPaymentId`. Si el
// `Payment` ya existía, no se llega hasta acá: cortó la fila 1.
function isEntryOf(application: { mpPaymentIdEntry: string | null }, facts: MpPaymentFacts): boolean {
  return application.mpPaymentIdEntry === null || isMarkedEntryOf(application, facts);
}

export function resolveMpPayment(facts: MpPaymentFacts, ctx: ResolveContext): Decision {
  // 1. Ya asentado. Es la ÚNICA regla que corta por "esto ya se aplicó", y
  // corta por el `Payment`, no por lo que diga la solicitud: mientras el
  // `Payment` no exista, el cobro sigue estando sin asentar aunque la solicitud
  // ya haya cambiado de estado (ver la nota de la marca de ingreso, arriba).
  if (ctx.existingPayment) return { kind: "already_processed", paymentId: ctx.existingPayment.id };

  // 2. La marca de ingreso de ESTE cobro, antes que cualquier otra cosa: este
  // dinero es la cuota de ingreso de esa solicitud aunque la suscripción ya
  // tenga socio y aunque el acta ya esté asentada.
  if (ctx.application && isMarkedEntryOf(ctx.application, facts)) {
    return { kind: "entry", applicationId: ctx.application.id };
  }

  // 3–4. Por suscripción.
  if (facts.preapprovalId && ctx.subscription) {
    if (ctx.subscription.memberId !== null) {
      return { kind: "debit", memberId: ctx.subscription.memberId, preapprovalId: facts.preapprovalId };
    }
    // Suscripción del wizard sin acta todavía: es el ingreso o un segundo cobro.
    if (ctx.application) {
      if (isEntryOf(ctx.application, facts)) return { kind: "entry", applicationId: ctx.application.id };
      return { kind: "unmatched", reason: "duplicate_entry" };
    }
  }

  // 5. Link de pago.
  const link = parsePaymentLinkReference(facts.externalReference);
  if (link) {
    return ctx.linkMember ? { kind: "link", memberId: ctx.linkMember.id, n: link.n } : { kind: "unmatched", reason: "no_reference" };
  }

  // 6–7. Referencia a una solicitud.
  const applicationId = parseApplicationReference(facts.externalReference);
  if (applicationId !== null) {
    if (ctx.application) {
      if (isEntryOf(ctx.application, facts)) return { kind: "entry", applicationId: ctx.application.id };
      // Ingreso ya cobrado con otro id: es un débito recurrente del socio asentado.
      if (ctx.application.memberId !== null) return { kind: "debit", memberId: ctx.application.memberId, preapprovalId: facts.preapprovalId };
      return { kind: "unmatched", reason: "duplicate_entry" };
    }
    if (ctx.subscriptionByReference?.memberId != null) {
      return { kind: "debit", memberId: ctx.subscriptionByReference.memberId, preapprovalId: facts.preapprovalId };
    }
    return { kind: "unmatched", reason: "application_missing" };
  }

  // 8. Suscripción que no conocemos.
  if (facts.preapprovalId) return { kind: "unmatched", reason: "no_subscription" };

  // 9. Nada.
  return { kind: "unmatched", reason: "no_reference" };
}
