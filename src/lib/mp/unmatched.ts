// Bandeja sin conciliar (spec 4B §7): lo que llegó de MP y no se pudo aplicar.
// Prisma inyectado. `payerEmail` y `description` son datos personales: van a la
// fila (la lee sólo el admin) y nunca a la auditoría ni al log.
import type { PrismaClient } from "@/generated/prisma/client";

export const UNMATCHED_REASONS = [
  "no_reference",         // sin referencia ni suscripción conocida
  "no_subscription",      // cobro de una suscripción que SIGeV no tiene vinculada
  "application_missing",  // `solicitud:{id}` de una solicitud que ya no existe
  "duplicate_entry",      // segundo cobro de una solicitud sin acta todavía
  "withdrawn_no_pending", // débito de un cesante sin cuotas pendientes
  "treasury_rejected",    // MP cobró y tesorería lo rechazó por una regla de negocio
] as const;
export type UnmatchedReason = (typeof UNMATCHED_REASONS)[number];

export type UnmatchedInput = {
  mpPaymentId: string;
  amount: number;
  paidAt: Date;
  payerEmail: string | null;
  externalReference: string | null;
  description: string | null;
  preapprovalId: string | null;
  reason: UnmatchedReason;
};

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2002";
}

export function makeUnmatchedInbox(db: Pick<PrismaClient, "mpUnmatchedPayment">) {
  return {
    /** Deja la fila. Si ya estaba (mismo cobro llegando por dos eventos), no es
     *  un error: la bandeja dice lo mismo que antes.
     *
     *  Con una excepción: el segundo evento puede traer MÁS información que el
     *  primero. El caso real es el débito de una suscripción creada a mano en el
     *  panel de MP: el tópico `payment` llega sin referencia y deja la fila con
     *  `preapprovalId: null`; el `subscription_authorized_payment` posterior sí
     *  sabe de qué suscripción es. Si esa fila sigue abierta y no tenía
     *  preapproval, se le completa —sólo ese campo—: sin eso la información más
     *  rica se descartaba y la fila quedaba inalcanzable para la pantalla de
     *  vinculación, que busca por `preapprovalId` o por referencia.
     *
     *  Devuelve `"exists"` igual: hacia afuera el hecho no cambió (no se creó
     *  una fila nueva, la bandeja tiene los mismos cobros esperando). Completar
     *  un campo vacío de la fila que ya estaba es terminar de escribir ese mismo
     *  hecho, no uno distinto; un tercer valor obligaría a cada llamador a
     *  distinguir dos casos que para él significan lo mismo. */
    async record(input: UnmatchedInput): Promise<"recorded" | "exists"> {
      try {
        await db.mpUnmatchedPayment.create({
          data: {
            mpPaymentId: input.mpPaymentId,
            amount: input.amount.toFixed(2),
            paidAt: input.paidAt,
            payerEmail: input.payerEmail,
            externalReference: input.externalReference?.slice(0, 128) ?? null,
            description: input.description?.slice(0, 200) ?? null,
            preapprovalId: input.preapprovalId,
            reason: input.reason,
          },
        });
        return "recorded";
      } catch (e) {
        if (!isUniqueViolation(e)) throw e;
        if (input.preapprovalId !== null) {
          // `status: "open"` y `preapprovalId: null` en el `where`: una fila que
          // el operador ya resolvió o descartó no se toca, y un preapproval ya
          // escrito no se pisa con otro.
          await db.mpUnmatchedPayment.updateMany({
            where: { mpPaymentId: input.mpPaymentId, status: "open", preapprovalId: null },
            data: { preapprovalId: input.preapprovalId },
          });
        }
        return "exists";
      }
    },

    /** Las filas abiertas que esperaban a esta suscripción: por su preapproval
     *  o por su referencia (una fila `application_missing` puede no traer el
     *  preapproval). La vinculación las aplica. */
    async openRowsForSubscription(input: { preapprovalId: string; externalReference: string | null }) {
      const or: Array<{ preapprovalId: string } | { externalReference: string }> = [{ preapprovalId: input.preapprovalId }];
      if (input.externalReference) or.push({ externalReference: input.externalReference });
      const rows = await db.mpUnmatchedPayment.findMany({
        where: { status: "open", OR: or },
        select: { id: true, mpPaymentId: true, amount: true, paidAt: true },
        orderBy: { paidAt: "asc" },
      });
      return rows.map((r) => ({ id: r.id, mpPaymentId: r.mpPaymentId, amount: Number(r.amount), paidAt: r.paidAt }));
    },
  };
}
