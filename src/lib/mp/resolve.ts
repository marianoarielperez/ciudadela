// A quién pertenece un pago de Mercado Pago (spec 4B §5). Función PURA sobre
// datos que el llamador ya cargó: se prueba con una tabla de casos sin Prisma.
//
// La suscripción manda sobre la referencia (filas 2 y 3 antes que 4–6): el
// `preapprovalId` es el dato más confiable y resuelve los dos casos reales —
// la suscripción de Mariano sin referencia útil, y la de Martín con
// `solicitud:9` apuntando a una solicitud que ya no existe.
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

// ¿Este cobro es la cuota de ingreso de esta solicitud? Sí en dos casos: la
// solicitud todavía no tiene ingreso cobrado, o el que tiene es ESTE mismo id.
//
// El segundo caso es el que importa. La marca `mpPaymentIdEntry` se escribe en
// la solicitud ANTES de crear el `Payment`: si el proceso muere en el medio
// (deadlock, restart, base caída), queda la marca sin `Payment` y MP reintenta.
// Devolver "ya registrado" ahí dejaba el cobro sin `Payment` PARA SIEMPRE, y
// con eso sin recibo, sin bandeja y sin la única barrera que impide que ese
// mismo dinero se aplique después como CUOTA (regla 1) una vez asentada el
// acta. Así que se devuelve `entry`: lo que falta es justamente el `Payment`, y
// reponerlo es seguro porque `registerPaymentCore` es idempotente por
// `mpPaymentId`. Si el `Payment` ya existía, no se llega hasta acá: cortó la
// regla 1.
function isEntryOf(application: { mpPaymentIdEntry: string | null }, facts: MpPaymentFacts): boolean {
  return application.mpPaymentIdEntry === null || application.mpPaymentIdEntry === facts.mpPaymentId;
}

export function resolveMpPayment(facts: MpPaymentFacts, ctx: ResolveContext): Decision {
  // 1. Ya asentado. Es la ÚNICA regla que corta por "esto ya se aplicó", y
  // corta por el `Payment`, no por lo que diga la solicitud: mientras el
  // `Payment` no exista, el cobro sigue estando sin asentar aunque la solicitud
  // ya haya cambiado de estado (ver la nota de la marca de ingreso, abajo).
  if (ctx.existingPayment) return { kind: "already_processed", paymentId: ctx.existingPayment.id };

  // 2–3. Por suscripción.
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

  // 4. Link de pago.
  const link = parsePaymentLinkReference(facts.externalReference);
  if (link) {
    return ctx.linkMember ? { kind: "link", memberId: ctx.linkMember.id, n: link.n } : { kind: "unmatched", reason: "no_reference" };
  }

  // 5–6. Referencia a una solicitud.
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

  // 7. Suscripción que no conocemos.
  if (facts.preapprovalId) return { kind: "unmatched", reason: "no_subscription" };

  // 8. Nada.
  return { kind: "unmatched", reason: "no_reference" };
}
