// Adhesión, estado y cancelación del débito automático desde el panel del
// socio (5B, Task 12). Este módulo crea MANDATOS DE COBRO RECURRENTE sobre la
// tarjeta de un vecino real: el orden de las guardas no es estilo, es contrato
// — ninguna llamada a Mercado Pago antes de agotar todas las verificaciones
// locales, porque un preapproval creado de más es plata debitada de más.
//
// Calca el rigor del único otro creador de preapprovals del sistema
// (`asociate/actions.ts`, endurecido por tres pasadas contra la API real):
// el corte ANTES de llamar a MP si no hay valor vigente, la persistencia
// envuelta en su catch, y el final "NO reintentar" cuando la base falla con la
// suscripción ya viva en MP — el reintento crearía un SEGUNDO mandato de cobro.
//
// Deps inyectadas (patrón `link-subscription.ts`): los tests van con fakes,
// sin SDK ni red. La pantalla (`/mi/debito`) y la action comparten ESTE
// servicio: `preview` y `start` corren las mismas guardas y no pueden divergir.
import type { MemberCategory, PrismaClient } from "@/generated/prisma/client";
import { checkoutUrlFor } from "@/lib/mp/checkout";
import { mpErrorLog } from "@/lib/mp/error-log";
import { mpGateway, type MpGateway } from "@/lib/mp/gateway";
import { subscriptionReason } from "@/lib/mp/reason";
import { memberSubscriptionReference } from "@/lib/mp/references";
import { countChargeable, isKnownDead } from "@/lib/mp/subscription-status";
import { prisma } from "@/lib/prisma";
import { feeValueReader } from "@/lib/treasury/fee-values";
import { currentPeriod, periodMonth, periodYear, type Period } from "@/lib/treasury/periods";
import { feeAmountFor, type FeeValueAmounts } from "@/lib/treasury/rules";
import { upcomingPeriods } from "@/lib/treasury/upcoming";
import {
  ADHESION_BLOCKING_TYPES,
  adhesionBlockMessage,
  adhesionVerdict,
  type AdhesionVerdict,
} from "./debit-adhesion";

/** Mes civil en hora Argentina: el 1° a las 00:00 AR es 03:00Z. Sin el
 *  corrimiento, un pago hecho entre las 21:00 y las 24:00 del último día del
 *  mes anterior contaría como "de este mes" y bloquearía la adhesión de más.
 *  Calcado de `monthBoundsAR` (`treasury/receipts-query.ts:35`), que es privada
 *  de ese módulo y no se exporta: copiar las cuatro líneas con la cita es la
 *  decisión documentada, no un descuido. */
function currentMonthBoundsAR(at: Date): { gte: Date; lt: Date } {
  const p = currentPeriod(at);
  const y = periodYear(p);
  const m = periodMonth(p);
  // `Date.UTC(y, 12, …)` arrastra solo al año siguiente: diciembre cierra bien.
  return { gte: new Date(Date.UTC(y, m - 1, 1, 3)), lt: new Date(Date.UTC(y, m, 1, 3)) };
}

/** Los errores de Prisma no son los de MP: acá alcanza el `code` (`P1001`,
 *  `P2002`). Nunca el mensaje entero, que puede arrastrar valores de columnas. */
function codeOf(e: unknown): string {
  return typeof e === "object" && e !== null && "code" in e ? String((e as { code: unknown }).code) : "unknown";
}

type Deps = {
  // `fee` y `movement` son para el `preview` (los próximos períodos y el
  // reingreso); el resto lo comparten los cuatro métodos.
  db: Pick<PrismaClient, "$transaction" | "member" | "mpSubscription" | "payment" | "fee" | "movement">;
  gateway: Pick<MpGateway, "createPreapproval" | "getPreapproval" | "cancelPreapproval">;
  feeValues: { current(at?: Date): Promise<FeeValueAmounts | null> };
  baseUrl: () => string;
  now?: () => Date;
};

export type StartResult = { ok: true; checkoutUrl: string } | { ok: false; error: string };
export type CancelResult = { ok: true } | { ok: false; error: string };
export type DebitPreview = { verdict: AdhesionVerdict; upcoming: Period[]; unit: number | null };

export function makeMemberDebit(deps: Deps) {
  const now = deps.now ?? (() => new Date());

  /** Pasos 2-4 de `start`: lo que hay que saber del socio para el veredicto de
   *  adhesión (`debit-adhesion.ts`, puro). Lo comparten `start` y `preview`
   *  para que la pantalla nunca prometa lo que la action después rechaza. */
  async function verdictFor(member: { id: number; category: MemberCategory; email: string | null }): Promise<AdhesionVerdict> {
    const at = now();
    const memberId = member.id;
    const [paidThisMonth, subs] = await Promise.all([
      // "¿Ya pagó una cuota este mes calendario?" — la lista de tipos que
      // cuentan vive en `debit-adhesion.ts` (incluye `entry` por REG-14).
      deps.db.payment.count({
        where: {
          memberId,
          status: "applied",
          type: { in: [...ADHESION_BLOCKING_TYPES] },
          paidAt: currentMonthBoundsAR(at),
        },
      }),
      deps.db.mpSubscription.findMany({ where: { memberId }, select: { status: true } }),
    ]);
    return adhesionVerdict({
      category: member.category,
      email: member.email,
      subscriptionStatuses: subs.map((s) => s.status),
      paidThisMonth: paidThisMonth > 0,
      at,
    });
  }

  return {
    /** Crea el preapproval en MP y su espejo local, y devuelve el checkout.
     *  El orden de los pasos es contrato: MP se llama recién con TODAS las
     *  guardas locales agotadas. */
    async start(input: { memberId: number }): Promise<StartResult> {
      const member = await deps.db.member.findUniqueOrThrow({
        where: { id: input.memberId },
        select: { id: true, category: true, email: true, status: true },
      });
      // Defensa en profundidad: la action ya cortó al suspendido/cesante. Si
      // igual llega uno, error genérico y ni una llamada más.
      if (member.status !== "active") {
        return { ok: false as const, error: "No podés adherir el débito automático en este momento." };
      }

      const verdict = await verdictFor(member);
      if (!verdict.ok) return { ok: false as const, error: adhesionBlockMessage(verdict) };

      // El monto sale de `fee_values` (única fuente, REG-34): la suscripción se
      // crea SIN plan, así que lo que mandamos es literalmente lo que MP le va a
      // debitar al vecino todos los meses. Sin valor vigente NO se crea la
      // suscripción — cobrar mal es peor que no cobrar (patrón del wizard).
      const value = await deps.feeValues.current();
      if (!value) {
        return { ok: false as const, error: "El valor de la cuota todavía no está publicado. Probá más tarde." };
      }
      const amount = feeAmountFor(member.category, value);
      // Inalcanzable: el veredicto ya cortó a las categorías sin cuota. Queda
      // porque `feeAmountFor` devuelve null por dos motivos y acá no se inventa
      // un monto jamás.
      if (amount === null) {
        return { ok: false as const, error: "Tu categoría no paga cuota, así que no hay débito que adherir." };
      }

      let sub: { id: string; initPoint: string; status: string };
      try {
        sub = await deps.gateway.createPreapproval({
          // Lo que el vecino ve en el checkout y en el resumen de su tarjeta.
          reason: subscriptionReason(""),
          amount,
          // El veredicto garantiza que hay email (`no_email` corta antes).
          payerEmail: member.email!,
          externalReference: memberSubscriptionReference(member.id),
          // `?volvio=1` dispara el `syncStatus` de la vuelta del checkout.
          backUrl: `${deps.baseUrl()}/mi/debito?volvio=1`,
        });
      } catch (e) {
        // Acá NO quedó nada vivo en MP: reintentar es seguro y el mensaje lo
        // invita. El log va enmascarado (`mpErrorLog`), nunca el email.
        console.error(
          "[mi/debito] falló la creación de la suscripción —",
          mpErrorLog("createPreapproval", { memberId: member.id, amount }, e),
        );
        return { ok: false as const, error: "No pudimos iniciar la adhesión en Mercado Pago. Probá de nuevo en unos minutos." };
      }

      // La fila local nace con `memberId` puesto y `linkedManually: false`: es
      // lo que hace que los cobros entren solos por la regla 3 de `resolve.ts`
      // ("la suscripción manda") sin tocarla. Si esta escritura falla, los
      // cobros caen a la bandeja `no_subscription` — la red existente.
      try {
        await deps.db.$transaction(async (tx) => {
          await tx.mpSubscription.create({
            data: {
              preapprovalId: sub.id, memberId: member.id, planId: null, status: sub.status,
              payerEmail: member.email, amount: amount.toFixed(2),
              externalReference: memberSubscriptionReference(member.id),
              linkedManually: false, lastSyncAt: now(),
            },
          });
          // `canStillCharge("pending")` es true: se promete el débito ya, mismo
          // criterio que `link-subscription.ts:75`. Nunca se BAJA acá.
          await tx.member.update({ where: { id: member.id }, data: { autoDebit: true } });
        });
      } catch (e) {
        // La suscripción YA está viva en Mercado Pago y la base no la registró.
        // Al log va el preapprovalId —no es dato personal y es lo único que
        // permite reconciliarla a mano— y el código del fallo. El email jamás.
        console.error(
          "[mi/debito] persist failed: hay una suscripción viva en MP sin registrar",
          { memberId: member.id, preapprovalId: sub.id, code: codeOf(e) },
        );
        // A propósito NO invita a reintentar: el reintento crearía un SEGUNDO
        // preapproval — dos débitos por mes sobre la tarjeta del vecino. El
        // camino que queda es humano.
        return { ok: false as const, error: "No pudimos registrar la adhesión. NO vuelvas a intentarlo: comunicate con la vecinal." };
      }

      return { ok: true as const, checkoutUrl: checkoutUrlFor(sub.id) };
    },

    /** Lo que la pantalla `/mi/debito` necesita para contarle al socio qué va a
     *  pasar: el veredicto (los mismos pasos 1-4 de `start`, sin tocar MP), los
     *  períodos que el débito iría cubriendo y el monto mensual vigente
     *  (`null` si todavía no hay valor publicado: la pantalla lo dice, no
     *  muestra un cero). El status del socio no entra acá: la página se
     *  autoriza sola (`requireMember`), igual que `/mi/cuenta`. */
    async preview(input: { memberId: number }): Promise<DebitPreview> {
      const member = await deps.db.member.findUniqueOrThrow({
        where: { id: input.memberId },
        select: { id: true, category: true, email: true, joinedAt: true },
      });
      const [verdict, value, fees, readmission] = await Promise.all([
        verdictFor(member),
        deps.feeValues.current(),
        deps.db.fee.findMany({ where: { memberId: member.id }, select: { period: true } }),
        // El reingreso sale del `Movement` más nuevo: `joinedAt` no se toca al
        // reingresar (REG-11). Calcado de `mi/cuenta/page.tsx:41-48`.
        deps.db.movement.findFirst({
          where: { memberId: member.id, type: "readmission" },
          orderBy: [{ date: "desc" }, { id: "desc" }],
          select: { date: true },
        }),
      ]);
      return {
        verdict,
        upcoming: upcomingPeriods(fees.map((f) => f.period), member.joinedAt, readmission?.date ?? null),
        unit: value ? feeAmountFor(member.category, value) : null,
      };
    },

    /** Para la vuelta del checkout (`?volvio=1`): refresca contra MP el estado
     *  de la suscripción más nueva del socio. Best-effort: si MP no contesta se
     *  devuelve el status local sin actualizar — el checkout de suscripciones
     *  no usa `return-status.ts`, que es de Checkout Pro (spec §6.4). */
    async syncStatus(input: { memberId: number }): Promise<{ status: string | null }> {
      const local = await deps.db.mpSubscription.findFirst({
        where: { memberId: input.memberId },
        orderBy: { id: "desc" },
        select: { preapprovalId: true, status: true },
      });
      if (!local) return { status: null };
      let remote: { status: string };
      try {
        remote = await deps.gateway.getPreapproval(local.preapprovalId);
      } catch (e) {
        console.error(
          "[mi/debito] no se pudo refrescar el estado —",
          mpErrorLog("getPreapproval", { memberId: input.memberId, preapprovalId: local.preapprovalId }, e),
        );
        return { status: local.status };
      }
      try {
        await deps.db.mpSubscription.update({
          where: { preapprovalId: local.preapprovalId },
          data: { status: remote.status, lastSyncAt: now() },
        });
      } catch (e) {
        // El estado fresco ya se sabe: se devuelve igual. El espejo lo corrige
        // la conciliación diaria.
        console.error("[mi/debito] el estado fresco no se pudo espejar", local.preapprovalId, codeOf(e));
      }
      return { status: remote.status };
    },

    /** Cancela el mandato de cobro. La suscripción tiene que ser DEL socio: una
     *  ajena recibe el mismo error genérico que una inexistente, sin llamar al
     *  gateway — este método no puede ser un oráculo de qué preapprovals
     *  existen. */
    async cancel(input: { memberId: number; preapprovalId: string }): Promise<CancelResult> {
      const sub = await deps.db.mpSubscription.findFirst({
        where: { preapprovalId: input.preapprovalId, memberId: input.memberId },
        select: { preapprovalId: true, status: true },
      });
      if (!sub) return { ok: false as const, error: "La suscripción no existe." };
      // Una ya cancelada no se vuelve a cancelar: sería una llamada de red que
      // no puede ganar nada (mismo criterio que `withdraw-with-debits.ts`).
      if (isKnownDead(sub.status)) return { ok: false as const, error: "Ese débito ya está cancelado." };

      try {
        await deps.gateway.cancelPreapproval(input.preapprovalId);
      } catch (e) {
        console.error(
          "[mi/debito] cancelPreapproval —",
          mpErrorLog("cancelPreapproval", { memberId: input.memberId, preapprovalId: input.preapprovalId }, e),
        );
        return { ok: false as const, error: "Mercado Pago no aceptó la cancelación. Probá más tarde o consultá en la sede." };
      }

      // El espejo local va en su PROPIO try (patrón `withdraw-with-debits.ts`):
      // si acá falla, MP YA canceló, y decirle al socio que falló lo mandaría a
      // cancelar dos veces algo que ya está cancelado. La conciliación diaria
      // corrige el espejo sola.
      try {
        await deps.db.mpSubscription.update({
          where: { preapprovalId: input.preapprovalId },
          data: { status: "cancelled", lastSyncAt: now() },
        });
        // `autoDebit` se baja SOLO si no queda ninguna otra suscripción
        // cobrable: `memberId` no es unique y un socio puede tener dos
        // preapprovals vivos — bajarle la marca con uno todavía cobrando
        // escondería un débito real.
        const others = await deps.db.mpSubscription.findMany({
          where: { memberId: input.memberId, preapprovalId: { not: input.preapprovalId } },
          select: { status: true },
        });
        if (countChargeable(others) === 0) {
          await deps.db.member.update({ where: { id: input.memberId }, data: { autoDebit: false } });
        }
      } catch (e) {
        console.error(
          "[mi/debito] el débito se canceló en MP pero el espejo local no se actualizó",
          input.preapprovalId,
          codeOf(e),
        );
      }
      return { ok: true as const };
    },
  };
}

export type MemberDebit = ReturnType<typeof makeMemberDebit>;

export const memberDebit = makeMemberDebit({
  db: prisma,
  gateway: mpGateway,
  feeValues: feeValueReader,
  // Mismo criterio que el wizard: `AUTH_URL` se hornea en el build.
  baseUrl: () => process.env.AUTH_URL ?? "http://localhost:3000",
});
