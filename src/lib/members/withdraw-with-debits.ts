// Baja + cancelación del débito automático en Mercado Pago (spec 4C §10).
//
// Por qué vive acá y no dentro de `memberService.withdraw`: `withdraw` es una
// `$transaction`, y una llamada de red adentro sostiene el lock de las filas
// hasta el timeout de 5 s de Prisma (mismo corolario que el PDF del recibo en la
// fase 4A). La cancelación va DESPUÉS del commit.
//
// Por qué no vive en la server action: el lote de cesantía por mora llama al
// mismo servicio, y si la cancelación colgara de `withdrawAction` el lote —que
// es el que más socios da de baja de una vez— quedaría afuera. Es exactamente la
// mitad del agujero que describe docs/07.
//
// Best-effort con FALLO VISIBLE: la baja ya está asentada en el acta y no se
// deshace porque MP esté caído, pero el llamador recibe qué quedó abierto para
// poder decirlo en pantalla y reintentarlo.
import type { PrismaClient, WithdrawalReason } from "@/generated/prisma/client";
import { describeMpError, mpErrorLog } from "@/lib/mp/error-log";
import { mpGateway, type MpGateway } from "@/lib/mp/gateway";
import { isKnownDead } from "@/lib/mp/subscription-status";
import { prisma } from "@/lib/prisma";
import { memberService } from "./service";

export type WithdrawInput = {
  memberId: number;
  reason: WithdrawalReason;
  minuteId: number;
  actorId: number;
  detail?: string;
  /** Pasa derecho al servicio: la solicitud que se está aplicando por este
   *  mismo acto, que la baja NO cancela (la marca `markAccepted` después del
   *  commit). Ver el comentario en `service.withdraw`. */
  sparedRequestId?: number;
};

export type DebitCancellation = {
  /** preapprovalIds que MP aceptó cancelar. */
  cancelled: string[];
  /** Los que NO se pudieron cancelar: la baja salió igual y esto queda para
   *  reintentar. Lleva el id porque `cancelFailed: true` sin decir QUÉ cancelar
   *  no le sirve a nadie (mismo criterio que el rechazo de solicitudes). */
  failed: Array<{ preapprovalId: string; code: string }>;
};

type Deps = {
  db: Pick<PrismaClient, "mpSubscription">;
  service: { withdraw(input: WithdrawInput): Promise<unknown> };
  gateway: Pick<MpGateway, "cancelPreapproval">;
  now?: () => Date;
};

export function makeWithdrawWithDebits(deps: Deps) {
  const now = deps.now ?? (() => new Date());

  return {
    async withdraw(input: WithdrawInput): Promise<{ debits: DebitCancellation }> {
      // Primero la baja. Si el estatuto la rechaza (ya está dado de baja), tira
      // y no se toca ningún débito: cortarle el cobro a quien sigue siendo socio
      // sería peor que el problema que esto viene a resolver.
      await deps.service.withdraw(input);

      const debits: DebitCancellation = { cancelled: [], failed: [] };
      // `findMany` y no `findFirst`: `memberId` es índice y NO unique, así que un
      // socio puede tener dos preapprovals vivos —dos débitos por mes— y cancelar
      // sólo el primero le seguiría cobrando por el otro.
      const subs = await deps.db.mpSubscription.findMany({
        where: { memberId: input.memberId },
        select: { preapprovalId: true, status: true },
        orderBy: { id: "asc" },
      });
      for (const s of subs) {
        // Lista NEGRA (`isKnownDead`) y no lista blanca: la pregunta acá no es
        // "¿puede salir plata?" sino "¿puedo afirmar que no hay débito?". Un
        // estado que MP invente mañana se cancela igual; una ya cancelada no se
        // vuelve a cancelar, que sería una llamada de red que no puede ganar
        // nada y un error de MP que no significa nada.
        if (isKnownDead(s.status)) continue;
        try {
          await deps.gateway.cancelPreapproval(s.preapprovalId);
          debits.cancelled.push(s.preapprovalId);
        } catch (e) {
          // El SDK de MP no lanza `Error`: `mpErrorLog` desarma el cuerpo y lo
          // enmascara (puede traer el `payer_email` del vecino).
          console.error(
            "[baja] no se pudo cancelar el débito —",
            mpErrorLog("cancelPreapproval", { memberId: input.memberId, preapprovalId: s.preapprovalId }, e),
          );
          // MEDIDO contra la API real: un 404 sobre un preapproval que no existe
          // llega con `code: null` —MP no manda su `error` corto—, así que
          // `code || "unknown"` le sacaba al asiento lo único que distingue "ese
          // id no existe" de "el token no tiene permiso sobre este recurso". El
          // status entra al código cuando no hay otra cosa.
          const d = describeMpError(e);
          debits.failed.push({
            preapprovalId: s.preapprovalId,
            code: d.code || (d.status === null ? "unknown" : `http_${d.status}`),
          });
          continue;
        }
        // El espejo local va en su PROPIO try: si acá falla, MP ya canceló, y
        // marcarlo como fallido mandaría al operador a cancelar de nuevo algo que
        // ya está cancelado. La conciliación diaria corrige el espejo sola.
        try {
          await deps.db.mpSubscription.updateMany({
            where: { preapprovalId: s.preapprovalId },
            data: { status: "cancelled", lastSyncAt: now() },
          });
        } catch (e) {
          console.error(
            "[baja] el débito se canceló en MP pero el espejo local no se actualizó",
            s.preapprovalId,
            e instanceof Error ? e.message : e,
          );
        }
      }
      return { debits };
    },
  };
}

export const withdrawWithDebits = makeWithdrawWithDebits({
  db: prisma,
  service: memberService,
  gateway: mpGateway,
});
