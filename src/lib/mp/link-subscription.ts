// Vincular una suscripción preexistente de MP a un socio (spec 4B §8). La fila
// local se crea con los datos FRESCOS de MP (no con lo que mostró la lista), y
// después —fuera de la transacción— se aplican las filas de la bandeja que
// esperaban a este socio, una por una, cada una con su recibo.
//
// Por qué las filas van FUERA de la transacción: cada `registerPayment` abre la
// suya, pide número de recibo (que serializa por año) y escribe un PDF. Meterlo
// todo en una transacción externa sostendría ese lock por varios cobros y se
// comería el timeout de 5 s de Prisma. Y no hace falta: la vinculación es
// válida por sí sola, y una fila que no se pudo aplicar sigue esperando en la
// bandeja, que es exactamente donde el operador la ve.
import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { treasuryService, type TreasuryService } from "@/lib/treasury/service";
import { mpErrorLog } from "./error-log";
import { mpGateway, type MpGateway } from "./gateway";
import { makeUnmatchedInbox } from "./unmatched";

/** El `preapprovalId` es UNIQUE: dos operadores vinculando la misma suscripción
 *  a la vez hacen que el segundo insert choque. Se reconoce por forma y no con
 *  `instanceof`, mismo criterio que `unmatched.ts` y `service.ts`. */
function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2002";
}

/** Los estados en los que la suscripción TODAVÍA puede cobrar. Una `cancelled`
 *  no vuelve nunca; el paso 2 no filtra por estado a propósito (hay que poder
 *  vincular una `paused`), así que por URL directa se puede llegar a vincular
 *  una muerta y no hay que prometer un débito que no va a existir. */
const CHARGEABLE_STATUSES = new Set(["authorized", "pending", "paused"]);

export function canStillCharge(status: string): boolean {
  return CHARGEABLE_STATUSES.has(status);
}

type Deps = {
  db: Pick<PrismaClient, "mpSubscription" | "member" | "$transaction">;
  gateway: Pick<MpGateway, "getPreapproval">;
  inbox: Pick<ReturnType<typeof makeUnmatchedInbox>, "openRowsForSubscription">;
  treasury: Pick<TreasuryService, "registerPayment">;
  now?: () => Date;
};

export type LinkResult =
  | {
      ok: true;
      applied: Array<{ paymentId: number; receiptId: number }>;
      /** Filas de la bandeja que siguieron esperando: ni error ni éxito, trabajo
       *  pendiente. Sin este número el operador se iría creyendo que la bandeja
       *  quedó vacía. */
      unapplied: number;
      amount: number | null;
      status: string;
      /** Si al socio se lo marcó con débito automático. `false` cuando la
       *  suscripción ya no puede cobrar: la marca sería una promesa que Mercado
       *  Pago no va a cumplir. */
      autoDebit: boolean;
    }
  | { ok: false; error: string };

export function makeSubscriptionLinker(deps: Deps) {
  const now = deps.now ?? (() => new Date());
  return {
    async link(input: { preapprovalId: string; memberId: number; actorId: number }): Promise<LinkResult> {
      if (await deps.db.mpSubscription.findUnique({ where: { preapprovalId: input.preapprovalId }, select: { id: true } })) {
        return { ok: false as const, error: "Esa suscripción ya está vinculada." };
      }
      const member = await deps.db.member.findUnique({ where: { id: input.memberId }, select: { id: true, status: true } });
      if (!member) return { ok: false as const, error: "El socio no existe." };
      // Si esto tira, no se escribió nada todavía: una fila local con datos
      // inventados sería peor que no tener fila.
      const remote = await deps.gateway.getPreapproval(input.preapprovalId);

      // `autoDebit` es una promesa hacia el socio y hacia el panel: "esto se
      // cobra solo". Con la suscripción cancelada en MP no se cobra nunca más,
      // así que la marca no se pone. Tampoco se BAJA la que hubiera: puede venir
      // de otra suscripción viva, y esta pantalla no vino a decidir eso.
      const autoDebit = canStillCharge(remote.status);

      try {
        await deps.db.$transaction(async (tx) => {
          await tx.mpSubscription.create({
            data: {
              preapprovalId: remote.id, memberId: member.id, linkedManually: true, status: remote.status,
              amount: remote.amount === null ? null : remote.amount.toFixed(2), payerEmail: remote.payerEmail,
              // Una suscripción creada a mano en el panel de MP no tiene plan de
              // referencia. `null`, nunca `""`.
              externalReference: remote.externalReference, planId: null, lastSyncAt: now(),
            },
          });
          if (autoDebit) await tx.member.update({ where: { id: member.id }, data: { autoDebit: true } });
        });
      } catch (e) {
        // Dos operadores a la vez: la guarda de arriba pasó en los dos, y el
        // UNIQUE del `preapprovalId` frena al segundo dentro de la transacción
        // (que vuelve atrás entera). El hecho es el mismo que detecta la guarda,
        // y merece el mismo mensaje: sin esto el segundo operador lee "reintentá
        // en un momento", reintenta, y recién ahí se entera de qué pasó.
        if (isUniqueViolation(e)) return { ok: false as const, error: "Esa suscripción ya está vinculada." };
        throw e;
      }

      // Lo que cayó en la bandeja esperando a este socio. Cada fila es un cobro
      // real: un débito = una cuota, fechado el día que MP lo cobró. Sólo las
      // ABIERTAS (lo garantiza `openRowsForSubscription`): una fila descartada o
      // registrada como ingreso no societario es una decisión ya tomada.
      const rows = await deps.inbox.openRowsForSubscription({ preapprovalId: remote.id, externalReference: remote.externalReference });
      const applied: Array<{ paymentId: number; receiptId: number }> = [];
      let unapplied = 0;
      for (const row of rows) {
        try {
          const r = await deps.treasury.registerPayment({
            memberId: member.id, type: "debit", n: 1, amount: row.amount, paidAt: row.paidAt,
            mpPaymentId: row.mpPaymentId, preapprovalId: remote.id, actorId: input.actorId,
          });
          if (r.kind === "registered") applied.push({ paymentId: r.paymentId, receiptId: r.receiptId });
          // `already_processed` y `no_pending_withdrawn` dejan la fila como está:
          // la vinculación ya es válida y el operador la ve en la bandeja.
          else unapplied++;
        } catch (e) {
          // Un rechazo de tesorería (las cuotas cambiaron, el monto está fuera de
          // rango) no puede tumbar la vinculación —que ya está escrita— ni cortar
          // las filas siguientes. El id del cobro va al log, el email no.
          unapplied++;
          console.error("[suscripciones] no se pudo aplicar un cobro de la bandeja —", mpErrorLog("linkSubscription", { preapprovalId: remote.id, mpPaymentId: row.mpPaymentId }, e));
        }
      }
      return { ok: true as const, applied, unapplied, amount: remote.amount, status: remote.status, autoDebit };
    },
  };
}

export const subscriptionLinker = makeSubscriptionLinker({
  db: prisma, gateway: mpGateway, inbox: makeUnmatchedInbox(prisma), treasury: treasuryService,
});
