// Lote REG-34 (spec 4B §10): empujar el valor de cuota vigente a las
// suscripciones vivas cuyo monto difiere.
//
// EL PORQUÉ: las suscripciones de Mercado Pago se crean SIN plan (docs/06 §2) y
// llevan el monto COPIADO en su propio `auto_recurring`. Cambiar el valor de la
// cuota en `fee_values` —o el monto del plan de referencia— no las mueve: hay
// que empujarles el monto nuevo una por una con `updatePreapprovalAmount`. Si
// nadie corre este lote, la Comisión actualiza la cuota y a los vecinos con
// débito automático les siguen cobrando el valor viejo para siempre.
//
// En SERIE y de a 25 por llamada: MP tarda ~1 s por update y una server action
// no puede vivir minutos. El cliente reinvoca hasta vaciar la cola.
//
// Incluye las vinculadas a mano: el valor de la cuota es uno por categoría, no
// depende de cómo entró la suscripción al sistema.
import type { MemberCategory, MemberStatus, PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { feeValueReader, type makeFeeValueReader } from "@/lib/treasury/fee-values";
import { safeMessage } from "@/lib/log-safe";
import { feeAmountFor, type FeeValueAmounts } from "@/lib/treasury/rules";
import { describeMpError, mpErrorLog } from "./error-log";
import { BATCH_SIZE } from "./fee-value-batch-chunks";
import { mpGateway, type MpGateway } from "./gateway";
import { cents } from "./webhook-processor";

// El tamaño de tanda y la guarda del bucle viven en un módulo sin Prisma
// porque los comparte la pantalla; se re-exportan para que el servidor tenga un
// solo lugar de donde importar el lote entero.
export { BATCH_SIZE, shouldContinue } from "./fee-value-batch-chunks";

export type DivergentSubscription = {
  preapprovalId: string;
  memberId: number;
  fullName: string;
  category: MemberCategory;
  /** Nada cancela la suscripción al declarar una baja (sólo se cancelan las
   *  solicitudes rechazadas y los preapprovals huérfanos), así que un cesante
   *  puede seguir con débito vivo. Va en la fila para que el operador lo vea
   *  ANTES de subirle la cuota a alguien que ya no es socio. */
  status: MemberStatus;
  /** Último monto conocido de la suscripción, o `null` si nunca se supo. */
  current: number | null;
  expected: number;
};

export type BatchFailure = { preapprovalId: string; memberId: number; code: string };
export type BatchRun = { updated: number; failed: BatchFailure[]; remaining: number };

/** Las suscripciones que HOY cobran un monto distinto al vigente para la
 *  categoría de su socio.
 *
 *  Sólo las `authorized`: una pausada o cancelada no va a cobrar, y empujarle
 *  un monto a MP es una llamada que puede fallar sin que nadie gane nada.
 *
 *  El monto de referencia sale de la base (`MpSubscription.amount`), que el
 *  cron diario de conciliación refresca contra MP. Nunca se relee MP acá: son
 *  N llamadas para pintar una pantalla, y el lote recalcula igual antes de
 *  escribir.
 *
 *  La comparación va EN CENTAVOS (`cents`, el mismo criterio que el webhook y
 *  la conciliación): con floats crudos, una cola de precisión en el bit 53
 *  inventa una divergencia y le pisa el débito a un vecino por nada. */
export async function listDivergent(
  db: Pick<PrismaClient, "mpSubscription">,
  feeValue: FeeValueAmounts,
): Promise<DivergentSubscription[]> {
  const rows = await db.mpSubscription.findMany({
    where: { status: "authorized", memberId: { not: null } },
    select: {
      preapprovalId: true,
      amount: true,
      member: { select: { id: true, fullName: true, category: true, status: true } },
    },
    orderBy: { id: "asc" },
  });
  const out: DivergentSubscription[] = [];
  for (const r of rows) {
    // `memberId: { not: null }` ya lo filtra en SQL; esto es el estrechamiento
    // de tipo y el cinturón por si la relación quedó colgada.
    if (!r.member) continue;
    const expected = feeAmountFor(r.member.category, feeValue);
    if (expected === null) continue; // la categoría no paga cuota: nada que empujar
    const current = r.amount === null ? null : Number(r.amount);
    if (current !== null && cents(current) === cents(expected)) continue;
    out.push({
      preapprovalId: r.preapprovalId,
      memberId: r.member.id,
      fullName: r.member.fullName,
      category: r.member.category,
      status: r.member.status,
      current,
      expected,
    });
  }
  return out;
}

/** El código corto que ve el operador al lado del nombre del vecino.
 *
 *  NO es `mpErrorLog(...).slice(...)`: con un preapproval real (32 caracteres)
 *  el recorte se comía justo el `status=`, que es lo único accionable. Acá se
 *  arma a propósito con el status HTTP y el primer `cause[].code` de MP —"HTTP
 *  400 · 2034"—, que es lo que se busca en la documentación de MP.
 *
 *  PRIVACIDAD (Ley 25.326): el `message` de MP puede arrastrar el email del
 *  pagador ("payer_email is invalid: juan@…") y este código va a la pantalla Y
 *  al asiento de auditoría. Por eso el mensaje NO entra: sólo status y código.
 *  El detalle completo, ya enmascarado, va al log. */
function shortCode(e: unknown): string {
  const d = describeMpError(e);
  const parts = [d.status === null ? "sin respuesta" : `HTTP ${d.status}`];
  const code = d.cause.find((c) => c.code !== "")?.code ?? d.code;
  if (code) parts.push(code);
  return parts.join(" · ").slice(0, 60);
}

/** El código de la única falla que NO es de Mercado Pago: el monto ya se
 *  cambió allá y sólo quedó sin escribir la fila local. */
export const MIRROR_FAILED = "cambiado en MP, falta la base";

type Deps = {
  db: Pick<PrismaClient, "mpSubscription">;
  gateway: Pick<MpGateway, "updatePreapprovalAmount">;
  feeValues: Pick<ReturnType<typeof makeFeeValueReader>, "current">;
  now?: () => Date;
};

export function makeFeeValueBatch(deps: Deps) {
  const now = deps.now ?? (() => new Date());
  return {
    /** Una tanda. `only` limita a esos preapprovals (es como el cliente maneja
     *  la cola y el reintento de las que fallaron); sin `only`, las primeras
     *  `BATCH_SIZE` de la cola.
     *
     *  La divergencia y el monto se recalculan SIEMPRE acá: `only` elige a
     *  cuáles mirar, nunca cuánto cobrarles. Un POST armado a mano no puede
     *  fijarle un monto a la tarjeta de nadie. */
    async run(input: { only?: string[] }): Promise<BatchRun> {
      const value = await deps.feeValues.current(now());
      // Sin valor vigente no hay nada que empujar, y menos que inventar.
      if (!value) return { updated: 0, failed: [], remaining: 0 };

      let pending = await listDivergent(deps.db, value);
      if (input.only) {
        const wanted = new Set(input.only);
        pending = pending.filter((p) => wanted.has(p.preapprovalId));
      }
      const batch = pending.slice(0, BATCH_SIZE);

      let updated = 0;
      const failed: BatchFailure[] = [];
      for (const p of batch) {
        // El orden ES la recuperabilidad: primero Mercado Pago, después el
        // espejo local.
        //
        // Si el proceso muere entre las dos escrituras, MP quedó con el monto
        // nuevo y la base con el viejo. La fila sigue figurando divergente, el
        // operador la ve y el reintento la vuelve a empujar — empujar el mismo
        // monto dos veces no le hace nada al vecino.
        //
        // Al revés (base primero) la fila dejaría de figurar divergente y el
        // vecino seguiría pagando el valor viejo para siempre, sin que ninguna
        // pantalla pueda mostrarlo.
        //
        // Un fallo no frena la tanda: son suscripciones independientes y cortar
        // acá dejaría sin intentar a las que sí podían actualizarse.
        try {
          await deps.gateway.updatePreapprovalAmount(p.preapprovalId, p.expected);
        } catch (e) {
          console.error("[fee-value-batch]", mpErrorLog("updatePreapprovalAmount", { preapprovalId: p.preapprovalId, amount: p.expected }, e));
          failed.push({ preapprovalId: p.preapprovalId, memberId: p.memberId, code: shortCode(e) });
          continue;
        }
        try {
          await deps.db.mpSubscription.updateMany({
            where: { preapprovalId: p.preapprovalId },
            // Decimal(10,2): string con dos decimales, nunca un float.
            data: { amount: p.expected.toFixed(2), lastSyncAt: now() },
          });
        } catch (e) {
          // El catch va APARTE del de Mercado Pago a propósito: acá el débito
          // del vecino YA cambió y lo único que quedó atrás es nuestro espejo.
          // Pasarlo por `shortCode` diría "sin respuesta" —un error de Prisma no
          // tiene status HTTP— y el operador entendería que MP no contestó. El
          // reintento es inofensivo: empuja el mismo monto y reescribe la fila.
          console.error("[fee-value-batch] el espejo local no se pudo escribir —", p.preapprovalId, safeMessage(e));
          failed.push({ preapprovalId: p.preapprovalId, memberId: p.memberId, code: MIRROR_FAILED });
          continue;
        }
        updated++;
      }
      return { updated, failed, remaining: pending.length - batch.length };
    },
  };
}

export const feeValueBatch = makeFeeValueBatch({ db: prisma, gateway: mpGateway, feeValues: feeValueReader });
