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
  | { kind: "already_processed"; paymentId: number | null; result: "already_processed" | "entry_already_recorded" }
  | { kind: "debit"; memberId: number; preapprovalId: string | null }
  | { kind: "link"; memberId: number; n: number }
  | { kind: "entry"; applicationId: number }
  | { kind: "unmatched"; reason: UnmatchedReason };

export function resolveMpPayment(facts: MpPaymentFacts, ctx: ResolveContext): Decision {
  // 1. Ya asentado.
  if (ctx.existingPayment) return { kind: "already_processed", paymentId: ctx.existingPayment.id, result: "already_processed" };

  // 2–3. Por suscripción.
  if (facts.preapprovalId && ctx.subscription) {
    if (ctx.subscription.memberId !== null) {
      return { kind: "debit", memberId: ctx.subscription.memberId, preapprovalId: facts.preapprovalId };
    }
    // Suscripción del wizard sin acta todavía: es el ingreso o un segundo cobro.
    if (ctx.application) {
      if (ctx.application.mpPaymentIdEntry === null) return { kind: "entry", applicationId: ctx.application.id };
      if (ctx.application.mpPaymentIdEntry === facts.mpPaymentId) {
        return { kind: "already_processed", paymentId: null, result: "entry_already_recorded" };
      }
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
      if (ctx.application.mpPaymentIdEntry === null) return { kind: "entry", applicationId: ctx.application.id };
      if (ctx.application.mpPaymentIdEntry === facts.mpPaymentId) {
        return { kind: "already_processed", paymentId: null, result: "entry_already_recorded" };
      }
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
