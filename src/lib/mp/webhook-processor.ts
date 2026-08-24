// Procesamiento de webhooks de MP (docs/06 §4, spec 4B §6), inline e
// idempotente. El registro crudo y la respuesta HTTP viven en la ruta; acá
// sólo la reacción a cada tópico.
//
// PRINCIPIO: el procesador NUNCA falla por una regla de negocio. Un cesante sin
// cuotas, una referencia rota, un monto raro: todo termina en un `result`
// (aplicado / bandeja / ignorado). Lo único que lanza es un fallo TÉCNICO (MP o
// la base caídas), y la ruta lo convierte en 500 para que MP reintente. Si una
// regla de negocio lanzara, MP reintentaría con backoff PARA SIEMPRE un cobro
// que ya hizo, y el vecino quedaría con la plata debitada y sin recibo.
import type { MemberCategory, PrismaClient } from "@/generated/prisma/client";
import { Prisma } from "@/generated/prisma/client";
import { APPROVED_AFTER_EXPIRY_ACTION } from "@/lib/applications/query";
import { audit, auditStrict } from "@/lib/audit";
import { mailer } from "@/lib/email";
import { UNLIMITED_MAIL_BUDGET, type MailBudget } from "@/lib/email/batch-cap";
import { applicationAcceptedEmail, paymentRejectedEmail } from "@/lib/email/templates";
import { createKeyedMutex } from "@/lib/keyed-mutex";
import { safeMessage } from "@/lib/log-safe";
import { prisma } from "@/lib/prisma";
import { feeValueReader, type makeFeeValueReader } from "@/lib/treasury/fee-values";
import { sendReceiptEmail as sendReceiptEmailDefault, type ReceiptEmailResult } from "@/lib/treasury/receipt-email";
import { feeAmountFor } from "@/lib/treasury/rules";
import { treasuryService, type TreasuryService } from "@/lib/treasury/service";
import { mpGateway, type MpGateway, type MpPaymentDetails } from "./gateway";
import { parseApplicationReference, parsePaymentLinkReference } from "./references";
import { rejectionReason } from "./rejection-reasons";
import { resolveMpPayment, type Decision, type ResolveContext } from "./resolve";
import { makeUnmatchedInbox, type UnmatchedReason } from "./unmatched";

export type WebhookInput = { topic: string; dataId: string };

export const REFUND_REASON = "Reembolso en Mercado Pago";

/** Acción de auditoría del cobro que tesorería rechazó por una regla de
 *  negocio. NO es un error: si lo fuera, MP reintentaría para siempre un cobro
 *  que ya hizo. El caso además va a la bandeja (`treasury_rejected`), que es la
 *  única de las dos anotaciones que alguna vez va a tener pantalla. */
export const PAYMENT_NOT_APPLIED = "payment_not_applied";

/** Lo que puede terminar en `WebhookEvent.result` (VarChar(64)). Tipar los
 *  retornos con esta unión es lo que hace que un result nuevo no pueda entrar
 *  sin declararse; `WEBHOOK_RESULTS`, abajo, la vuelve enumerable en runtime. */
export type WebhookResult =
  | "unknown_topic"
  | "subscription_synced"
  | "no_match"
  | "authorized_payment_traced"
  | "payment_ignored"
  | "payment_rejected_traced"
  | "payment_refunded"
  | "refund_ignored"
  | "already_processed"
  | "debit_applied"
  | "link_applied"
  | "application_approved"
  | "application_approved_after_expiry"
  | "entry_payment_recovered"
  | `unmatched_${UnmatchedReason}`;

/** La lista completa, para poder recorrerla (el test de la longitud de la
 *  columna). Es un `Record` y no un array a propósito: el compilador exige una
 *  entrada por cada miembro de `WebhookResult`, así que un result nuevo —o un
 *  motivo nuevo de la bandeja— no puede quedarse afuera. */
export const WEBHOOK_RESULTS: Record<WebhookResult, true> = {
  unknown_topic: true,
  subscription_synced: true,
  no_match: true,
  authorized_payment_traced: true,
  payment_ignored: true,
  payment_rejected_traced: true,
  payment_refunded: true,
  refund_ignored: true,
  already_processed: true,
  debit_applied: true,
  link_applied: true,
  application_approved: true,
  application_approved_after_expiry: true,
  entry_payment_recovered: true,
  unmatched_no_reference: true,
  unmatched_no_subscription: true,
  unmatched_application_missing: true,
  unmatched_duplicate_entry: true,
  unmatched_withdrawn_no_pending: true,
  unmatched_treasury_rejected: true,
};

type Deps = {
  db: Pick<PrismaClient, "application" | "mpSubscription" | "payment" | "member" | "mpUnmatchedPayment">;
  gateway: Pick<MpGateway, "getPayment" | "getPreapproval" | "getAuthorizedPayment">;
  treasury: Pick<TreasuryService, "registerPayment" | "refundPayment">;
  unmatched: Pick<ReturnType<typeof makeUnmatchedInbox>, "record">;
  feeValues: Pick<ReturnType<typeof makeFeeValueReader>, "current">;
  mailer: Pick<typeof mailer, "sendToApplication" | "sendToMember">;
  sendReceiptEmail: (receiptId: number) => Promise<ReceiptEmailResult>;
  audit: typeof audit;
  auditStrict: typeof auditStrict;
  now?: () => Date;
};

// Los errores de nodemailer traen `envelope`, `rejected` y el `response` del
// SMTP —o sea la dirección del vecino en claro— y el log de PM2 no está cubierto
// por los cuidados de docs/08 (Ley 25.326). Al log va el código; el mensaje,
// cuando se usa, pasa antes por `safeMessage`.
function codeOf(e: unknown): string {
  return typeof e === "object" && e !== null && "code" in e ? String((e as { code: unknown }).code) : "unknown";
}

// `TreasuryError` es la negativa de NEGOCIO del servicio de tesorería. Se
// reconoce por forma y no con `instanceof` —mismo criterio que el P2002 de
// `service.ts`— para que un fake de test pueda producirla sin importar la
// clase, y para que mockear `@/lib/treasury/service` no deje el `instanceof`
// contra un `undefined`.
function isTreasuryError(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { name?: unknown }).name === "TreasuryError";
}

// Los dos eventos del mismo cobro (`payment` y `subscription_authorized_payment`)
// llegan casi juntos: se serializan por id de pago para que no resuelvan y
// apliquen a la vez. El servicio tiene su propia barrera (unique + P2002), así
// que esto es para que el segundo vea `already_processed` y no una carrera.
const paymentMutex = createKeyedMutex();

// El contexto que resuelve el pago, más la categoría del socio del link: la
// necesita el control de divergencia de monto y ya viene en la misma consulta,
// así que no se vuelve a preguntar. `resolveMpPayment` la ignora.
type LoadedContext = Omit<ResolveContext, "linkMember"> & {
  linkMember: { id: number; category: MemberCategory } | null;
};

/** Centavos redondeados: los montos de MP son floats y compararlos crudos
 *  (`6000.000000000001`) inventa divergencias que no existen. Exportada para
 *  que la conciliación compare con el MISMO criterio y no invente divergencias
 *  que el webhook no ve. */
export function cents(amount: number): number {
  return Math.round(amount * 100);
}

export function makeWebhookProcessor(deps: Deps) {
  const now = deps.now ?? (() => new Date());

  async function loadContext(p: MpPaymentDetails, preapprovalId: string | null): Promise<LoadedContext> {
    const applicationId = parseApplicationReference(p.externalReference);
    const link = parsePaymentLinkReference(p.externalReference);
    const [existingPayment, subscription, subscriptionByReference, application, linkMember] = await Promise.all([
      deps.db.payment.findUnique({ where: { mpPaymentId: p.id }, select: { id: true } }),
      preapprovalId
        ? deps.db.mpSubscription.findUnique({ where: { preapprovalId }, select: { memberId: true, applicationId: true } })
        : Promise.resolve(null),
      applicationId !== null && p.externalReference
        ? deps.db.mpSubscription.findFirst({ where: { externalReference: p.externalReference }, select: { memberId: true } })
        : Promise.resolve(null),
      applicationId !== null
        ? deps.db.application.findUnique({ where: { id: applicationId }, select: { id: true, mpPaymentIdEntry: true, memberId: true } })
        : Promise.resolve(null),
      link ? deps.db.member.findUnique({ where: { id: link.memberId }, select: { id: true, category: true } }) : Promise.resolve(null),
    ]);
    return {
      existingPayment: existingPayment ?? null, subscription: subscription ?? null,
      subscriptionByReference: subscriptionByReference ?? null, application: application ?? null, linkMember: linkMember ?? null,
    };
  }

  async function toInbox(p: MpPaymentDetails, preapprovalId: string | null, reason: UnmatchedReason): Promise<WebhookResult> {
    await deps.unmatched.record({
      mpPaymentId: p.id, amount: p.transactionAmount, paidAt: p.dateApproved ?? now(),
      payerEmail: p.payerEmail, externalReference: p.externalReference, description: p.description,
      preapprovalId, reason,
    });
    // Sin email ni descripción: ids, motivo y monto.
    await deps.audit({ action: "payment_unmatched", entity: "mp_payment", entityId: p.id, detail: { mpPaymentId: p.id, reason, amount: p.transactionAmount } });
    return `unmatched_${reason}`;
  }

  // El cobro ya estaba asentado: si además había quedado una fila ABIERTA en la
  // bandeja para ese mismo `mpPaymentId`, se cierra al pasar. El servicio cierra
  // la fila dentro de la transacción que asienta, pero ninguno de los dos
  // caminos de `already_processed` (la consulta previa del servicio y la de este
  // procesador) llega a esa transacción, así que sin esto la fila quedaba
  // abierta para siempre y el operador veía en la bandeja un cobro ya aplicado.
  // Best-effort a propósito: el cobro YA está bien asentado, y convertir un
  // fallo de esta limpieza en 500 haría que MP reintentara un pago que no tiene
  // nada de malo.
  async function closeInboxRow(mpPaymentId: string, paymentId: number): Promise<void> {
    try {
      await deps.db.mpUnmatchedPayment.updateMany({
        where: { mpPaymentId, status: "open" },
        data: { status: "matched", paymentId, resolvedAt: now() },
      });
    } catch (e) {
      console.error("[mp-webhook] no se pudo cerrar la fila de la bandeja del cobro", mpPaymentId, "code:", codeOf(e));
    }
  }

  // `registerPayment` puede rechazar por REGLA DE NEGOCIO (`TreasuryError`): un
  // monto que no entra en la columna, una ficha que ya no está, una cuota que se
  // reimputó mientras tanto. MP ya le cobró al vecino: si eso saliera como 500,
  // MP reintentaría ESE MISMO cobro con backoff para siempre. Así que se asienta
  // y se devuelve `null`; el llamador manda el cobro a la BANDEJA
  // (`treasury_rejected`), que es donde un operador lo va a ver — el asiento
  // solo no alcanza: `audit()` es best-effort y `audit_log` no tiene pantalla.
  // Un fallo TÉCNICO sí se propaga.
  async function registerOrTrace(
    input: Parameters<TreasuryService["registerPayment"]>[0],
    context: Record<string, unknown>,
  ): Promise<Awaited<ReturnType<TreasuryService["registerPayment"]>> | null> {
    try {
      return await deps.treasury.registerPayment(input);
    } catch (e) {
      if (!isTreasuryError(e)) throw e;
      console.error("[mp-webhook] tesorería rechazó el cobro", input.mpPaymentId, "motivo:", safeMessage(e));
      // Sin datos personales: ids, monto y el mensaje de la regla (que es un
      // texto fijo del servicio, y aun así pasa por `safeMessage`).
      await deps.audit({
        action: PAYMENT_NOT_APPLIED, entity: "mp_payment", entityId: input.mpPaymentId ?? undefined,
        detail: { ...context, mpPaymentId: input.mpPaymentId, amount: input.amount, message: safeMessage(e) },
      });
      return null;
    }
  }

  async function emailReceipt(receiptId: number, budget: MailBudget): Promise<string> {
    // El tope se consulta ANTES de leer el PDF: diferir tiene que ser barato.
    // Un recibo diferido no se pierde — se manda desde su propia pantalla con
    // "Reenviar por email", que es el reintento por entidad del proyecto, y
    // `/admin/salud` lista los que quedaron sin enviar.
    if (!budget.take()) return "deferred";
    try {
      const r = await deps.sendReceiptEmail(receiptId);
      // No hubo correo: el lugar vuelve al pote. El tope es de correos
      // ENVIADOS, no de intentos — con 37 emails cargados sobre 278 socios, un
      // lote de socios sin casilla lo agotaría sin mandar nada. `error` NO se
      // devuelve: ahí sí hubo intento, y si el SMTP está caído conviene que el
      // tope corte igual. (Una vez agotado el presupuesto ya no se distingue:
      // los diferidos posteriores pueden incluir socios sin casilla, que de
      // todos modos no iban a recibir nada.)
      if (!r.sent && (r.reason === "no_email" || r.reason === "voided")) budget.refund();
      return r.sent ? "sent" : r.reason;
    } catch (e) {
      // `sendReceiptEmail` es best-effort por contrato, pero si algún día tira,
      // el cobro ya está asentado: no puede volverse un 500.
      console.error("[mp-webhook] sendReceiptEmail lanzó", receiptId, codeOf(e));
      return "error";
    }
  }

  // Un rechazo no aplica nada, pero el vecino tiene derecho a saber que le
  // intentaron cobrar y no se pudo: hasta la 4C el hecho moría en
  // `webhook_events.result`, una tabla que ninguna pantalla muestra, y el socio
  // se enteraba cuando alguien le reclamaba la cuota tres meses después.
  //
  // Best-effort de punta a punta: TODO esto va adentro de un try. Si el aviso
  // fallara y saliera como excepción, el webhook devolvería 500 y MP
  // reintentaría un rechazo —o sea, un no-cobro— con backoff para siempre. El
  // `WebhookResult` que devuelve el procesador NO cambia por culpa del correo.
  //
  // `p.payerEmail` NO se usa como destinatario: es la casilla de la cuenta de MP
  // del pagador, que puede ser de un tercero (el hijo que le puso la tarjeta al
  // padre). El domicilio electrónico es el de la ficha (Art. 5° quater).
  async function noticeRejection(p: MpPaymentDetails, preapprovalId: string | null): Promise<void> {
    try {
      // El link de pago manda: si el cobro rechazado trae `pago:{id}:{n}`, el
      // socio es ese y no hace falta preguntar por ninguna suscripción. Una
      // referencia `solicitud:{id}` no entra acá a propósito: el que paga el
      // ingreso todavía no es socio y su aviso es otro (`sendToApplication`).
      const link = parsePaymentLinkReference(p.externalReference);
      let memberId = link?.memberId ?? null;
      if (memberId === null && preapprovalId) {
        const sub = await deps.db.mpSubscription.findUnique({
          where: { preapprovalId }, select: { memberId: true },
        });
        memberId = sub?.memberId ?? null;
      }
      // Un cobro rechazado que no se puede atribuir a nadie: no hay a quién
      // avisarle, y tampoco hay plata que perseguir (MP no cobró).
      if (memberId === null) return;
      const member = await deps.db.member.findUnique({
        where: { id: memberId },
        select: { id: true, fullName: true, email: true, emailStatus: true },
      });
      let notified = false;
      // Mismo filtro que `receipt-email.ts`: a una casilla que rebota no se le
      // insiste, o Brevo termina castigando la reputación del dominio.
      if (member?.email && member.emailStatus !== "bounced") {
        await deps.mailer.sendToMember({
          memberId: member.id,
          to: member.email,
          type: "payment_rejected",
          message: paymentRejectedEmail({
            name: member.fullName,
            amount: p.transactionAmount,
            reason: rejectionReason(p.statusDetail),
          }),
          summary: `cobro rechazado (${p.statusDetail ?? "sin detalle"})`,
        });
        notified = true;
      }
      // El `status_detail` sí va al asiento: es un código de MP, no un dato
      // personal, y es lo único que explica el rechazo cuando el socio llama.
      // El `payerEmail` no (mismo criterio que `toInbox`). `notified` distingue
      // "le avisamos" de "no tiene casilla / rebota", que es lo que el operador
      // necesita saber antes de levantar el teléfono.
      await deps.audit({
        action: "payment_rejected", entity: "mp_payment", entityId: p.id,
        detail: { mpPaymentId: p.id, memberId, statusDetail: p.statusDetail ?? null, amount: p.transactionAmount, notified },
      });
    } catch (e) {
      console.error("[mp-webhook] no se pudo avisar el rechazo", p.id, "code:", codeOf(e));
    }
  }

  async function applyToMember(
    p: MpPaymentDetails,
    d: Extract<Decision, { kind: "debit" | "link" }>,
    ctx: LoadedContext,
    budget: MailBudget,
  ): Promise<WebhookResult> {
    const n = d.kind === "debit" ? 1 : d.n;
    const preapprovalId = d.kind === "debit" ? d.preapprovalId : null;
    const r = await registerOrTrace({
      memberId: d.memberId, type: d.kind, n, amount: p.transactionAmount, paidAt: p.dateApproved ?? now(),
      mpPaymentId: p.id, preapprovalId, actorId: null,
    }, { memberId: d.memberId, type: d.kind, n });
    // Tesorería lo rechazó: MP ya cobró y acá no se asentó nada. A la bandeja,
    // que es lo único que alguien mira.
    if (r === null) return toInbox(p, preapprovalId, "treasury_rejected");
    if (r.kind === "already_processed") {
      await closeInboxRow(p.id, r.paymentId);
      return "already_processed";
    }
    // Un cesante sin cuotas pendientes no devenga: el cobro existe y no hay a
    // qué imputarlo. A la bandeja, nunca a un error (MP ya cobró).
    if (r.kind === "no_pending_withdrawn") return toInbox(p, preapprovalId, "withdrawn_no_pending");
    const emailed = await emailReceipt(r.receiptId, budget);
    await deps.audit({
      action: "payment_applied", entity: "payment", entityId: r.paymentId,
      detail: { paymentId: r.paymentId, memberId: d.memberId, type: d.kind, amount: r.amount, mpPaymentId: p.id, receiptId: r.receiptId, emailed },
    });
    if (d.kind === "link") {
      // El link se emitió por `n × valor vigente`; si MP cobró otra cosa, se
      // aplica igual (spec 4B §6) y queda asentado para que alguien lo mire.
      // La categoría del socio ya vino en `loadContext` (el link sólo resuelve
      // si el socio existe), así que no se vuelve a consultar.
      const value = await deps.feeValues.current(p.dateApproved ?? now());
      const unit = ctx.linkMember && value ? feeAmountFor(ctx.linkMember.category, value) : null;
      // En centavos redondeados, como el resto del módulo: comparar los floats
      // crudos con un umbral de 0,01 puede dar de un lado o del otro por error
      // de representación.
      const expected = unit === null ? null : cents(unit * n);
      const paid = cents(p.transactionAmount);
      if (expected !== null && expected !== paid) {
        await deps.audit({ action: "link_amount_mismatch", entity: "payment", entityId: r.paymentId,
          detail: { paymentId: r.paymentId, memberId: d.memberId, n, expected: expected / 100, amount: paid / 100 } });
      }
      return "link_applied";
    }
    return "debit_applied";
  }

  // El ingreso tiene DOS escrituras que no comparten transacción: la transición
  // de la solicitud (que además le pone la marca `mpPaymentIdEntry`) y el
  // `Payment` con su recibo. Si el proceso muere entre las dos, MP reintenta y
  // este mismo camino tiene que poder reponer la que falte — por eso no corta
  // cuando la transición no encuentra nada. Lo que SÍ es de una sola vez es lo
  // que depende de la transición: el asiento del pago tardío y el email de
  // bienvenida, que un reintento no puede volver a mandarle al vecino.
  //
  // `memberId` es el de la solicitud: `null` mientras no haya acta, y el del
  // socio cuando el acta ya pasó. Va al `Payment` para que el cobro se vea en
  // la cuenta corriente (ver la nota de `registerOrTrace`, abajo).
  async function applyEntry(
    p: MpPaymentDetails, applicationId: number, preapprovalId: string | null, memberId: number | null, budget: MailBudget,
  ): Promise<WebhookResult> {
    // UPDATE condicional por estado = idempotencia de la transición (M3). Dos
    // updates y no uno con `in`: el segundo afirma, sin leer antes y sin carrera
    // posible, que la solicitud estaba VENCIDA — dato que no se puede perder
    // (ver abajo) y que un `updateMany` no devuelve.
    const data = {
      status: "approved_pending_minute" as const,
      mpPaymentIdEntry: p.id,
      entryAmount: new Prisma.Decimal(p.transactionAmount.toFixed(2)),
    };
    const onTime = await deps.db.application.updateMany({ where: { id: applicationId, status: "pending_payment" }, data });
    // El pago manda sobre el vencimiento (decisión del cliente, 21/08/2026). El
    // cron expira a los 7 días; si MP demora el aviso, el vecino autorizó el
    // débito, MP le cobró y la solicitud ya estaba `expired`. Ahora revive.
    // El segundo update sólo se intenta si el primero no encontró nada, así que
    // un reintento del MISMO evento no vuelve a "revivir" nada: los dos dan 0 y
    // el camino sigue abajo sin bienvenida ni asiento de pago tardío.
    const late = onTime.count === 0
      ? await deps.db.application.updateMany({ where: { id: applicationId, status: "expired" }, data })
      : { count: 0 };
    const revived = late.count > 0;
    // ¿La transición la hizo ESTA llamada? Si no, es un reintento: la solicitud
    // ya está aceptada y acá sólo puede faltar el `Payment`.
    const transitioned = onTime.count > 0 || revived;

    if (revived) {
      // `auditStrict` porque el asiento ES la señal: al expirar, el cron mandó a
      // cancelar el preapproval y el alta puede haber quedado sin débito
      // automático. Sin esto el caso es invisible en pantalla: el estado final
      // es `approved_pending_minute`, idéntico al de una aceptación normal.
      // No se propaga: un throw → 500 → reintento → los dos updateMany dan 0,
      // `revived` es false y el asiento no se reescribiría igual; encima el
      // `WebhookEvent` quedaría sin `result`. Se grita con el id: ese log es lo
      // único que le queda al operador.
      // Sin datos personales (docs/08): id de solicitud y de pago.
      try {
        await deps.auditStrict({ action: APPROVED_AFTER_EXPIRY_ACTION, entity: "application", entityId: applicationId, detail: { paymentId: p.id } });
      } catch (e) {
        console.error(
          "[mp-webhook] CRÍTICO: la solicitud", applicationId,
          "revivió con un pago posterior al vencimiento y el asiento NO se pudo escribir:",
          "ninguna pantalla va a avisar que hay que revisar el débito.",
          "code:", codeOf(e), "message:", safeMessage(e),
        );
      }
    }

    // 4B: el ingreso es un Payment con recibo (REG-33), y tiene que quedar con
    // su `mpPaymentId` — es lo único que frena el reenvío de este mismo aviso
    // una vez que el socio está asentado (`resolve.ts` devolvería `debit` y se
    // cobraría como cuota).
    // Va SIEMPRE, haya transicionado esta llamada o no: si no transicionó es
    // porque la marca ya estaba escrita y lo que falta es justamente esto.
    // `registerPaymentCore` es idempotente por `mpPaymentId`, así que reponerlo
    // no puede cobrar dos veces.
    //
    // El `memberId` va cuando la solicitud ya lo tiene. Sin acta todavía es
    // `null` y el cobro cuelga de la solicitud: `record.ts` le pone el socio al
    // asentar el acta, con un `updateMany` que corre UNA sola vez. Si este
    // `Payment` se repone DESPUÉS del acta, ese updateMany ya pasó y no vuelve:
    // dejarlo en `null` lo hacía invisible para siempre en la cuenta corriente
    // (`fetchMemberAccount` filtra por `memberId`) — plata cobrada, recibo
    // emitido, y ni el vecino ni el operador lo ven. No imputa cuotas igual:
    // `n: 0` y REG-14 (el ingreso cubre el mes del alta).
    const r = await registerOrTrace({
      memberId, applicationId, type: "entry", n: 0, amount: p.transactionAmount, paidAt: p.dateApproved ?? now(),
      mpPaymentId: p.id, preapprovalId, actorId: null,
    }, { applicationId, type: "entry" });

    // Qué pasó con el `Payment`. Sólo se devuelve cuando esta llamada NO hizo la
    // transición: si la hizo, el result tiene que describirla (es el único que
    // distingue el pago tardío).
    let recorded: WebhookResult;
    if (r === null) {
      // Tesorería lo rechazó: la solicitud queda aceptada igual —ya cambió de
      // estado y la bienvenida sale— pero el cobro va a la bandeja, o si no
      // esa plata no aparece en ninguna pantalla y un re-apply posterior
      // (conciliación, reenvío de MP) la aplicaría como CUOTA.
      recorded = await toInbox(p, preapprovalId, "treasury_rejected");
    } else if (r.kind === "registered") {
      const emailed = await emailReceipt(r.receiptId, budget);
      await deps.audit({ action: "payment_applied", entity: "payment", entityId: r.paymentId,
        detail: { paymentId: r.paymentId, applicationId, memberId, type: "entry", amount: r.amount, mpPaymentId: p.id, receiptId: r.receiptId, emailed } });
      recorded = "entry_payment_recovered";
    } else if (r.kind === "already_processed") {
      // La carrera de los dos eventos del mismo cobro: el otro ya lo asentó.
      await closeInboxRow(p.id, r.paymentId);
      recorded = "already_processed";
    } else {
      // `no_pending_withdrawn`: hoy es inalcanzable para `entry` (el servicio lo
      // devuelve sólo con `n > 0`, y el ingreso va con `n: 0`). Rama propia
      // igual: colapsarla en `already_processed` sería decir que el cobro está
      // asentado cuando no lo está, y desde que el ingreso lleva `memberId` esa
      // rama dejó de ser imposible por construcción. Nada se asentó → bandeja.
      recorded = await toInbox(p, preapprovalId, "withdrawn_no_pending");
    }

    // Reintento: la solicitud ya estaba aceptada de antes. Ni bienvenida (el
    // vecino ya la recibió) ni result de transición.
    if (!transitioned) return recorded;

    const app = await deps.db.application.findUnique({ where: { id: applicationId } });
    if (app) {
      // Best-effort: el estado ya cambió; un SMTP caído no puede des-aceptar.
      //
      // Este email NO pasa por `budget` a propósito. El tope es para los lotes
      // —decenas de recibos del mismo socio— y un recibo diferido se reenvía
      // desde su pantalla. La bienvenida es de una sola vez y no tiene reenvío:
      // diferirla sería perderla para siempre. Además es una por alta, así que
      // no puede haber lote.
      try {
        await deps.mailer.sendToApplication({
          applicationId: app.id, to: app.email, type: "application_result",
          message: applicationAcceptedEmail({ name: app.fullName }), summary: "solicitud aceptada (débito autorizado)",
        });
      } catch (e) {
        console.error("[mp-webhook] falló el email de solicitud aceptada", app.id, "code:", codeOf(e), "message:", safeMessage(e));
        // El hueco tiene que quedar consultable: el vecino está aceptado y la
        // bienvenida no salió. Al detalle va el código, nunca el email (docs/08).
        await deps.audit({ action: "application_accepted_email_failed", entity: "application", entityId: app.id, detail: { code: codeOf(e) } }).catch(() => {});
      }
    }
    // Result distinguible: `application_approved` a secas haría creer que fue
    // una aceptación normal, con su débito en pie.
    return revived ? "application_approved_after_expiry" : "application_approved";
  }

  async function applyPayment(
    p: MpPaymentDetails,
    preapprovalId: string | null,
    opts?: { mailBudget?: MailBudget },
  ): Promise<WebhookResult> {
    // Sin presupuesto explícito, el camino de UN cobro: el webhook manda su
    // recibo siempre. El tope es para los lotes, y lo abre quien los corre.
    const budget = opts?.mailBudget ?? UNLIMITED_MAIL_BUDGET;
    if (p.status === "refunded" || p.status === "charged_back") {
      let r: Awaited<ReturnType<TreasuryService["refundPayment"]>>;
      try {
        r = await deps.treasury.refundPayment({ mpPaymentId: p.id, reason: REFUND_REASON });
      } catch (e) {
        // Con dos reversiones verdaderamente simultáneas, el chequeo de estado
        // de `refundPayment` queda afuera de su mutex y la segunda LANZA
        // `TreasuryError` en vez de devolver `already_reverted`. Eso es una
        // negativa de negocio —el recibo ya está anulado— y no puede volverse un
        // 500: MP reintentaría un reembolso que ya está hecho. Un fallo técnico
        // (base caída) sí se propaga.
        if (!isTreasuryError(e)) throw e;
        console.error("[mp-webhook] tesorería rechazó la reversión del cobro", p.id, "motivo:", safeMessage(e));
        return "refund_ignored";
      }
      if (r.kind !== "refunded") return "refund_ignored";
      await deps.audit({ action: "payment_refunded", entity: "payment", entityId: r.paymentId, detail: { paymentId: r.paymentId, mpPaymentId: p.id, status: p.status, periodsReverted: r.periodsReverted } });
      return "payment_refunded";
    }
    // Un rechazo se traza y se distingue del resto: no hay nada que aplicar,
    // pero el operador quiere poder ver que MP intentó cobrar y no pudo — y
    // desde la 4C el socio también se entera, con el motivo en castellano.
    // Fuera del mutex a propósito: acá no se escribe plata, así que no hay dos
    // caminos que serializar. El aviso duplicado tampoco puede venir del cron:
    // `searchPayments` pide `status=approved` y el paso 2 salta todo cobro que
    // no esté `processed`, así que un rechazo nunca vuelve por la conciliación.
    if (p.status === "rejected") {
      await noticeRejection(p, preapprovalId);
      return "payment_rejected_traced";
    }
    if (p.status !== "approved") return "payment_ignored";

    return paymentMutex.run(`mp:${p.id}`, async () => {
      const ctx = await loadContext(p, preapprovalId);
      const decision = resolveMpPayment({ mpPaymentId: p.id, preapprovalId, externalReference: p.externalReference }, ctx);
      switch (decision.kind) {
        case "already_processed":
          await closeInboxRow(p.id, decision.paymentId);
          return "already_processed";
        case "debit":
        case "link": return applyToMember(p, decision, ctx, budget);
        // `ctx.application` nunca es null cuando la decisión es `entry` (las dos
        // ramas que la devuelven lo exigen), pero el tipo no lo sabe.
        case "entry": return applyEntry(p, decision.applicationId, preapprovalId, ctx.application?.memberId ?? null, budget);
        case "unmatched": return toInbox(p, preapprovalId, decision.reason);
      }
    });
  }

  async function onPayment(dataId: string): Promise<WebhookResult> {
    const payment = await deps.gateway.getPayment(dataId);
    // El preapproval sale del PROPIO pago cuando viene de una suscripción (ver
    // `MpPaymentDetails.subscriptionId`). Pasarlo acá es lo que hace que la
    // notificación `payment` de un débito se baste sola: sin esto dependía de
    // que llegara además la `subscription_authorized_payment`, y mientras tanto
    // el cobro —plata que ya salió de la cuenta del vecino— esperaba en la
    // bandeja con el motivo equivocado ("sin referencia", cuando la suscripción
    // estaba ahí). Verificado contra la API real en la batería de la T14.
    return applyPayment(payment, payment.subscriptionId);
  }

  async function onPreapproval(dataId: string): Promise<WebhookResult> {
    const pre = await deps.gateway.getPreapproval(dataId);
    const { count } = await deps.db.mpSubscription.updateMany({
      where: { preapprovalId: pre.id },
      data: {
        status: pre.status,
        amount: pre.amount === null ? null : pre.amount.toFixed(2),
        payerEmail: pre.payerEmail,
        externalReference: pre.externalReference,
        lastSyncAt: now(),
      },
    });
    return count > 0 ? "subscription_synced" : "no_match";
  }

  async function onAuthorizedPayment(dataId: string): Promise<WebhookResult> {
    const a = await deps.gateway.getAuthorizedPayment(dataId);
    // Sin `payment.id` el cobro todavía no existe (scheduled) o falló: no hay
    // nada que aplicar y el evento queda trazado.
    if (!a.paymentId || a.status !== "processed") return "authorized_payment_traced";
    const payment = await deps.gateway.getPayment(a.paymentId);
    return applyPayment(payment, a.preapprovalId);
  }

  return {
    async process(input: WebhookInput): Promise<WebhookResult> {
      switch (input.topic) {
        case "payment":
        case "payments":
          return onPayment(input.dataId);
        case "subscription_preapproval":
          return onPreapproval(input.dataId);
        case "subscription_authorized_payment":
          return onAuthorizedPayment(input.dataId);
        default:
          return "unknown_topic";
      }
    },
    /** Aplica un pago ya leído de MP. Lo usa también el cron de conciliación. */
    applyPayment,
  };
}

export const webhookProcessor = makeWebhookProcessor({
  db: prisma, gateway: mpGateway, treasury: treasuryService, unmatched: makeUnmatchedInbox(prisma),
  feeValues: feeValueReader, mailer, sendReceiptEmail: sendReceiptEmailDefault, audit, auditStrict,
});
