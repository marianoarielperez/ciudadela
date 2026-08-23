// Escrituras de tesorería (spec §6.2, §2.4). Una transacción por operación:
// pago + cuotas + número de recibo. El PDF y el email van DESPUÉS del commit y
// son best-effort: el número ya es definitivo cuando se escribe el archivo.
import type { PaymentType, PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { createKeyedMutex } from "@/lib/keyed-mutex";
import { feeValueReader, makeFeeValueReader, NO_FEE_VALUE_MESSAGE } from "./fee-values";
import { PAYMENT_TYPE_LABELS, paymentConcept } from "./labels";
import { comparePeriods, currentPeriod, periodYear, type Period } from "./periods";
import { formatReceiptNumber, nextReceiptSeq } from "./receipt-number";
import { renderReceiptPdf, type ReceiptPdfData } from "./receipt-pdf";
import { receiptRelativePath, writeReceiptPdf } from "./receipts-dir";
import { allocate, cashConceptsFor, feeAmountFor, revertFees, type CashConcept } from "./rules";

export class TreasuryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TreasuryError";
  }
}

type Deps = {
  db: PrismaClient;
  feeValues: ReturnType<typeof makeFeeValueReader>;
  now?: () => Date;
  renderPdf?: (data: ReceiptPdfData) => Promise<Uint8Array>;
  writePdf?: (relPath: string, bytes: Uint8Array) => Promise<void>;
};

const CONCEPT_TYPE: Record<CashConcept, PaymentType> = {
  fees: "cash", voluntary: "voluntary", extraordinary: "extraordinary",
};

/** Lo que necesita el núcleo para asentar un cobro, venga del mostrador o de
 *  Mercado Pago. Deliberadamente NO trae categoría ni valor de cuota: el monto
 *  es lo que se cobró de verdad, y quién lo calculó es problema del llamador. */
export type RegisterPaymentInput = {
  /** `null` sólo para `entry`: la solicitud todavía no es socio. */
  memberId: number | null;
  applicationId?: number | null;
  type: PaymentType;
  /** Cuotas a imputar; 0 para voluntary/extraordinary/entry. */
  n: number;
  /** Lo cobrado de verdad, no lo que debería haberse cobrado. */
  amount: number;
  /** La fecha real del cobro (la de MP, no la del reloj de la corrida). */
  paidAt: Date;
  mpPaymentId?: string | null;
  preapprovalId?: string | null;
  /** `null` = automático (webhook, cron): no hay operador detrás. */
  actorId: number | null;
  note?: string | null;
};

export type RegisterResult =
  | {
      kind: "registered";
      paymentId: number;
      receiptId: number;
      number: string;
      periods: Period[];
      amount: number;
      pdfWritten: boolean;
    }
  | { kind: "already_processed"; paymentId: number }
  | { kind: "no_pending_withdrawn" };

/** Tipos que imputan cuotas. `entry` no imputa (REG-14: cubre el mes de alta). */
const FEE_TYPES: readonly PaymentType[] = ["debit", "link", "cash"];

// Prisma lanza `PrismaClientKnownRequestError` con `code: "P2002"` en una
// violación de unique. Se mira por forma y no por `instanceof` para que el
// fake de los tests pueda producirlo sin importar la clase generada.
function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2002";
}

const MAX_FEES_PER_PAYMENT = 60;

// `Payment.amount` es Decimal(10,2): 99.999.999,99 es el techo del tipo. Se
// valida ANTES de la transacción para que el operador lea un mensaje en es-AR y
// no el error crudo de Prisma desde adentro del $transaction.
const MAX_AMOUNT = 99_999_999.99;

// `Receipt.concept` es VarChar(200). Un pago de 60 cuotas no contiguas describe
// una lista más larga que eso, así que se recorta antes de escribir: el recibo
// se emite igual y el detalle completo sigue estando en las cuotas del pago.
// Puntos suspensivos ASCII y no "…": la función `safe()` en receipt-pdf.ts
// solo admite U+0020–U+007E y U+00A0–U+00FF, así que "…" (U+2026) se convierte en "?".
const CONCEPT_MAX = 200;

function fitConcept(concept: string): string {
  return concept.length <= CONCEPT_MAX ? concept : `${concept.slice(0, CONCEPT_MAX - 3)}...`;
}

// Año de la serie en hora Argentina (un efectivo cargado el 31/12 a las 22:00
// AR es todavía del año viejo aunque en UTC ya sea 1° de enero). Sale del
// período corriente y no de un `Intl` propio: `periods.ts` es el único lugar
// que traduce un instante a fecha civil, y si cambia la zona de negocio tiene
// que cambiar una sola línea (la de allá).
function seriesYear(at: Date): number {
  return periodYear(currentPeriod(at));
}

// Dos admins registrando sobre el mismo socio: la transacción y el unique
// (memberId, period) ya impiden imputar dos veces la misma cuota; el mutex
// evita que el segundo vea un error técnico en vez de la cuenta actualizada.
// Un solo proceso (premisa de docs/03): vive en memoria.
const memberMutex = createKeyedMutex();

export function makeTreasuryService(deps: Deps) {
  const now = deps.now ?? (() => new Date());
  const renderPdf = deps.renderPdf ?? renderReceiptPdf;
  const writePdf = deps.writePdf ?? writeReceiptPdf;
  const { db } = deps;

  async function pdfDataFor(receiptId: number): Promise<ReceiptPdfData> {
    const r = await db.receipt.findUnique({
      where: { id: receiptId },
      include: {
        payment: {
          include: {
            member: { include: { memberships: { include: { book: true } } } },
            // Un pago de cuota de ingreso cuelga de la solicitud y todavía no
            // tiene socio: sin esto el recibo salía a nombre de "—".
            application: { select: { fullName: true } },
          },
        },
      },
    });
    if (!r) throw new TreasuryError("El recibo no existe.");
    const member = r.payment.member;
    const open = member?.memberships.find((m) => m.book.status === "open");
    return {
      number: r.number,
      issuedAt: r.issuedAt,
      memberName: member?.fullName ?? r.payment.application?.fullName ?? "—",
      memberNumber: open?.memberNumber ?? null,
      // El concepto sale de la fila del recibo, no de `payment.fees`: al anular,
      // esas cuotas se despegan del pago (o se borran, si eran futuras) y
      // recalcularlo degradaba "Cuota social · agosto a octubre 2026 (3 cuotas)"
      // a un "Cuota social" pelado, sin forma de recuperar el detalle.
      concept: r.concept,
      methodLabel: PAYMENT_TYPE_LABELS[r.payment.type],
      amount: Number(r.payment.amount),
      voided: r.voidedAt ? { reason: r.voidReason ?? "" } : null,
    };
  }

  async function writePdfBestEffort(receiptId: number, relPath: string): Promise<boolean> {
    try {
      await writePdf(relPath, await renderPdf(await pdfDataFor(receiptId)));
      return true;
    } catch (e) {
      // Sin datos personales en el log. El recibo se regenera bajo demanda.
      console.error("[treasury] no se pudo escribir el PDF del recibo", receiptId, e instanceof Error ? e.message : e);
      return false;
    }
  }

  // Núcleo agnóstico del origen: asienta un cobro (pago + cuotas + recibo) sin
  // preguntar de dónde viene. NO toma el mutex — el mutex lo pone el método
  // público `registerPayment`, y `registerCashPayment` lo llama desde adentro
  // del suyo (no existe mutex reentrante: volver a tomarlo se bloquearía solo).
  async function registerPaymentCore(input: RegisterPaymentInput): Promise<RegisterResult> {
    const { paidAt } = input;
    const amount = Math.round(input.amount * 100) / 100;
    if (!Number.isFinite(amount) || amount <= 0) throw new TreasuryError("El monto del pago tiene que ser mayor a cero.");
    if (amount > MAX_AMOUNT) {
      throw new TreasuryError("El monto supera el máximo que admite el sistema ($ 99.999.999,99).");
    }
    if (!Number.isInteger(input.n) || input.n < 0 || input.n > MAX_FEES_PER_PAYMENT) {
      throw new TreasuryError(`La cantidad de cuotas tiene que estar entre 0 y ${MAX_FEES_PER_PAYMENT}.`);
    }
    // `n` sólo tiene sentido para los tipos que imputan cuotas (FEE_TYPES). Un
    // llamador que mande `entry`/`voluntary`/`extraordinary` con `n` distinto de
    // cero está confundido sobre qué está cobrando, y silenciarlo (como hacía la
    // línea de abajo antes de este chequeo) asentaba el pago con cero cuotas
    // imputadas sin avisar a nadie. Esto es un bug del llamador, no algo que
    // Mercado Pago pueda provocar, así que tiene que ser ruidoso.
    if (!FEE_TYPES.includes(input.type) && input.n !== 0) {
      throw new TreasuryError("Este tipo de pago no imputa cuotas: la cantidad tiene que ser 0.");
    }
    if (input.memberId === null && input.type !== "entry") throw new TreasuryError("El pago necesita un socio.");

    // Primera barrera de idempotencia: el cobro de MP ya está asentado. La
    // barrera REAL es la unique de `mpPaymentId` (se maneja más abajo); esta
    // consulta sólo evita el trabajo y el rollback en el caso normal.
    if (input.mpPaymentId) {
      const existing = await db.payment.findUnique({
        where: { mpPaymentId: input.mpPaymentId },
        select: { id: true },
      });
      if (existing) return { kind: "already_processed", paymentId: existing.id };
    }

    let periods: Period[] = [];
    let toCreate: Period[] = [];
    // Ya se validó arriba que `input.n === 0` para cualquier tipo fuera de
    // FEE_TYPES, así que tomar `input.n` directo es equivalente al recorte
    // silencioso de antes, pero ahora un valor inconsistente ya no llega hasta acá.
    let n = input.n;
    if (input.memberId !== null) {
      const member = await db.member.findUnique({ where: { id: input.memberId }, select: { id: true, status: true } });
      if (!member) throw new TreasuryError("El socio no existe.");
      if (n > 0) {
        const fees = await db.fee.findMany({ where: { memberId: member.id }, select: { period: true, status: true } });
        const pending = fees.filter((f) => f.status === "pending").map((f) => f.period);
        // Un dado de baja no devenga: se le cobra la deuda congelada y ni una
        // cuota más. Acotar en vez de tirar — desde un webhook, tirar sería un
        // 500 y MP reintentaría para siempre un cobro que ya hizo.
        if (member.status === "withdrawn") {
          n = Math.min(n, pending.length);
          if (n === 0) return { kind: "no_pending_withdrawn" };
        }
        const allocation = allocate({
          pending,
          existing: fees.map((f) => f.period),
          n,
          currentPeriod: currentPeriod(paidAt),
        });
        periods = allocation.toPay;
        toCreate = allocation.toCreate;
      }
    }

    // El concepto se congela al emitir: es lo que dice el recibo para siempre.
    const concept = fitConcept(paymentConcept(input.type, periods));
    const year = seriesYear(paidAt);
    let created: { paymentId: number; receiptId: number; number: string };
    try {
      created = await db.$transaction(async (tx) => {
        // El pago va PRIMERO: si la unique de `mpPaymentId` choca (dos eventos
        // del mismo cobro en paralelo), la transacción muere acá, antes de
        // pedir número — un rollback no consume serie (REG-33).
        const payment = await tx.payment.create({
          data: {
            memberId: input.memberId,
            applicationId: input.applicationId ?? null,
            type: input.type,
            amount: amount.toFixed(2),
            paidAt,
            mpPaymentId: input.mpPaymentId ?? null,
            preapprovalId: input.preapprovalId ?? null,
            registeredById: input.actorId,
            note: input.note ?? null,
            status: "applied",
          },
        });
        if (toCreate.length > 0) {
          await tx.fee.createMany({
            data: toCreate.map((period) => ({
              memberId: input.memberId!, period, status: "paid" as const, origin: "accrual" as const, paymentId: payment.id,
            })),
          });
        }
        const existingToPay = periods.filter((p) => !toCreate.includes(p));
        if (existingToPay.length > 0) {
          // `status: "pending"` no es redundante con la lectura de arriba: acota
          // el UPDATE a lo que sigue pendiente AHORA. Y se controla el `count`
          // porque un `where` que no matchea no falla, solo actualiza cero filas:
          // sin este chequeo, un pago podía quedar cobrado sin cuotas imputadas.
          const imputed = await tx.fee.updateMany({
            where: { memberId: input.memberId!, period: { in: existingToPay }, status: "pending" },
            data: { status: "paid", paymentId: payment.id },
          });
          if (imputed.count !== existingToPay.length) {
            throw new TreasuryError(
              "Las cuotas del socio cambiaron mientras se registraba el pago. Revisá la cuenta y volvé a intentarlo.",
            );
          }
        }
        // Cierre automático de la bandeja: si este cobro estaba esperando, deja
        // de esperar en la misma transacción que lo asienta.
        if (input.mpPaymentId) {
          await tx.mpUnmatchedPayment.updateMany({
            where: { mpPaymentId: input.mpPaymentId, status: "open" },
            data: { status: "matched", paymentId: payment.id, resolvedAt: now() },
          });
        }
        // El número, lo último: el lock de la fila del año se sostiene hasta el
        // commit, así que todo lo que se pueda escribir antes se escribe antes.
        const seq = await nextReceiptSeq(tx, year);
        const number = formatReceiptNumber(year, seq);
        const receipt = await tx.receipt.create({
          data: {
            number, year, seq, paymentId: payment.id, concept,
            pdfPath: receiptRelativePath(number), issuedAt: paidAt,
          },
        });
        return { paymentId: payment.id, receiptId: receipt.id, number };
      });
    } catch (e) {
      // Barrera real de idempotencia: la unique de `mp_payment_id`. Si dos
      // eventos del mismo cobro corrieron en paralelo, el que perdió no
      // escribió nada y el ganador ya tiene el recibo.
      if (input.mpPaymentId && isUniqueViolation(e)) {
        const winner = await db.payment.findUnique({
          where: { mpPaymentId: input.mpPaymentId },
          select: { id: true },
        });
        if (winner) return { kind: "already_processed", paymentId: winner.id };
      }
      throw e;
    }
    // Después del commit: el número ya es definitivo y el PDF es regenerable.
    const pdfWritten = await writePdfBestEffort(created.receiptId, receiptRelativePath(created.number));
    return { kind: "registered", ...created, periods: [...periods].sort(comparePeriods), amount, pdfWritten };
  }

  // Núcleo de la reversión: devuelve las cuotas, marca el pago y anula el
  // recibo. Es el MISMO movimiento para el mostrador (`voided`, con operador) y
  // para Mercado Pago (`refunded`, sin operador): lo único que cambia es el
  // estado que queda en el pago y quién firma la anulación. Toma el mutex del
  // socio; los dos métodos públicos lo llaman desde afuera de cualquier mutex
  // (no hay mutex reentrante: volver a tomarlo se bloquearía solo).
  async function revertCore(input: {
    receiptId: number; status: "voided" | "refunded"; actorId: number | null; reason: string;
  }): Promise<{ paymentId: number; number: string; periodsReverted: number }> {
    const at = now();
    // Lectura mínima, solo para saber sobre qué socio serializar. El socio de un
    // pago no cambia nunca, así que leerlo afuera del mutex no abre ninguna
    // ventana; la foto de la que dependen las ESCRITURAS se toma adentro.
    const head = await db.receipt.findUnique({
      where: { id: input.receiptId },
      select: { payment: { select: { memberId: true } } },
    });
    if (!head) throw new TreasuryError("El recibo no existe.");
    const memberId = head.payment.memberId;
    return memberMutex.run(`member:${memberId ?? 0}`, async () => {
      // Recién acá se lee el recibo con sus cuotas, y recién acá se controla que
      // no esté anulado: si la lectura vivía afuera, dos anulaciones simultáneas
      // pasaban las dos el control y la segunda escribía sobre una foto vieja.
      const r = await db.receipt.findUnique({
        where: { id: input.receiptId },
        include: { payment: { include: { fees: { select: { id: true, period: true } } } } },
      });
      if (!r) throw new TreasuryError("El recibo no existe.");
      if (r.voidedAt) throw new TreasuryError("El recibo ya está anulado.");
      const { toPending, toDelete } = revertFees(r.payment.fees.map((f) => f.period), currentPeriod(at));
      let periodsReverted = 0;
      await db.$transaction(async (tx) => {
        if (memberId !== null && toPending.length > 0) {
          // `paymentId` en el `where` es la guarda que impide devolver a pendiente
          // una cuota que ya se reimputó a OTRO pago con recibo válido: sin él,
          // (memberId, period) alcanzaba para pisar dinero cobrado por otro lado.
          const reverted = await tx.fee.updateMany({
            where: { memberId, paymentId: r.payment.id, period: { in: toPending } },
            data: { status: "pending", paymentId: null },
          });
          periodsReverted += reverted.count;
        }
        if (toDelete.length > 0) {
          const ids = r.payment.fees.filter((f) => toDelete.includes(f.period)).map((f) => f.id);
          // Una anulación solo puede tocar las cuotas que este pago cubrió: sin la guarda
          // de `paymentId`, el deleteMany podría eliminar una cuota que ya se reimputó a
          // OTRO pago con recibo válido.
          const deleted = await tx.fee.deleteMany({ where: { id: { in: ids }, paymentId: r.payment.id } });
          periodsReverted += deleted.count;
        }
        await tx.payment.update({ where: { id: r.payment.id }, data: { status: input.status } });
        await tx.receipt.update({
          where: { id: r.id },
          data: { voidedAt: at, voidReason: input.reason, voidedById: input.actorId },
        });
        // Regla de la bandeja (deuda anotada en 4A): una fila nunca apunta a un
        // pago anulado. Vuelve a `open` para que el operador la resuelva de nuevo.
        // Va DENTRO de la transacción: si la reversión se cae, la fila se queda
        // como estaba, cerrada contra un pago que sigue asentado. Se acota por
        // `paymentId` y no por `mpPaymentId` porque lo que dejó de valer es este
        // pago: un efectivo de mostrador también puede haber cerrado una fila.
        await tx.mpUnmatchedPayment.updateMany({
          where: { paymentId: r.payment.id },
          data: { status: "open", paymentId: null, resolvedAt: null, resolvedById: null },
        });
      });
      // El PDF se regenera con la marca ANULADO; si falla, se regenera al pedirlo.
      await writePdfBestEffort(r.id, r.pdfPath ?? receiptRelativePath(r.number));
      // El número devuelto es lo que se hizo, no lo que se pensaba hacer.
      return { paymentId: r.payment.id, number: r.number, periodsReverted };
    });
  }

  return {
    /** Asienta un cobro de cualquier origen. Serializa por socio (o por
     *  solicitud, en la cuota de ingreso) como lo hace el mostrador. */
    async registerPayment(input: RegisterPaymentInput): Promise<RegisterResult> {
      const key = input.memberId !== null ? `member:${input.memberId}` : `application:${input.applicationId ?? 0}`;
      return memberMutex.run(key, () => registerPaymentCore(input));
    },

    async registerCashPayment(input: {
      memberId: number; actorId: number; concept: CashConcept; count?: number; amount?: number; note?: string;
    }) {
      return memberMutex.run(`member:${input.memberId}`, async () => {
        const at = now();
        const member = await db.member.findUnique({
          where: { id: input.memberId },
          include: { memberships: { include: { book: true } } },
        });
        if (!member) throw new TreasuryError("El socio no existe.");
        // El cesante PUEDE pagar antes del reingreso, y es el orden que manda el
        // estatuto: Art. 9 inc. c (REG-16) exige saldar la deuda a valores
        // vigentes PARA poder ser readmitido, así que exigir el reingreso para
        // cobrarle invertía la regla y dejaba el mostrador sin salida. La cuota
        // se valúa con la categoría que quedó en la ficha —la que tenía a la
        // baja— y el pago no lo reincorpora: eso lo asienta la Comisión con acta.
        //
        // Los aportes voluntario y extraordinario sí se le rechazan. Son cosas
        // del que HOY es socio: el extraordinario lo vota la asamblea sobre el
        // padrón vigente (Art. 5) y el voluntario es el aporte con el que el
        // adherente sostiene a la asociación. Nada de eso es deuda, nada de eso
        // acerca el reingreso, y un recibo de "aporte" a nombre de quien ya no
        // es socio ensucia su cuenta corriente. Si la Comisión quiere aceptar
        // una donación de un no socio, no es un pago de este socio.
        if (member.status === "withdrawn" && input.concept !== "fees") {
          throw new TreasuryError(
            "El socio está dado de baja: sólo se le puede cobrar la deuda de cuotas. Para registrar aportes, primero el reingreso.",
          );
        }
        if (!cashConceptsFor(member.category).includes(input.concept)) {
          throw new TreasuryError("Ese concepto no corresponde a la categoría del socio.");
        }

        let amount: number;
        if (input.concept === "fees") {
          const count = input.count ?? 0;
          if (!Number.isInteger(count) || count <= 0) throw new TreasuryError("Indicá cuántas cuotas paga (al menos una).");
          if (count > MAX_FEES_PER_PAYMENT) {
            throw new TreasuryError(`No se pueden registrar más de ${MAX_FEES_PER_PAYMENT} cuotas en un solo pago.`);
          }
          const value = await deps.feeValues.current(at);
          if (!value) throw new TreasuryError(NO_FEE_VALUE_MESSAGE);
          const unit = feeAmountFor(member.category, value);
          if (unit === null) throw new TreasuryError("La categoría del socio no paga cuota.");
          // Esta lectura queda sólo para el mensaje de mostrador del cesante: el
          // núcleo vuelve a leer las cuotas para imputar. Son dos SELECT baratos
          // bajo el mismo mutex, y a cambio el operador lee cuántas pendientes
          // tiene en vez del recorte silencioso que hace el núcleo (ese recorte
          // existe para el webhook, donde no hay a quién avisarle).
          const fees = await db.fee.findMany({ where: { memberId: member.id }, select: { period: true, status: true } });
          const pending = fees.filter((f) => f.status === "pending");
          // Un dado de baja no devenga (`accrues()` lo dice explícito): si se le
          // cobraran más cuotas que las pendientes, `allocate` crearía períodos
          // NUEVOS a nombre de alguien que ya no es socio. Lo que se le cobra es
          // la deuda congelada, ni una cuota más.
          if (member.status === "withdrawn" && count > pending.length) {
            throw new TreasuryError(
              pending.length === 0
                ? "El socio está dado de baja y no tiene cuotas pendientes: no hay nada que cobrarle."
                : `El socio está dado de baja: tiene ${pending.length} ${pending.length === 1 ? "cuota pendiente" : "cuotas pendientes"} y no devenga nuevas.`,
            );
          }
          amount = unit * count;
        } else {
          const free = input.amount ?? 0;
          if (!Number.isFinite(free) || free <= 0) throw new TreasuryError("Ingresá el monto del aporte.");
          amount = Math.round(free * 100) / 100;
        }
        if (amount > MAX_AMOUNT) {
          throw new TreasuryError("El monto supera el máximo que admite el sistema ($ 99.999.999,99).");
        }

        // Ya estamos DENTRO del mutex de este socio, así que se llama al núcleo
        // sin mutex: `registerPayment` volvería a tomarlo y se bloquearía solo.
        const r = await registerPaymentCore({
          memberId: member.id,
          type: CONCEPT_TYPE[input.concept],
          n: input.concept === "fees" ? (input.count ?? 0) : 0,
          amount,
          paidAt: at,
          actorId: input.actorId,
          note: input.note ?? null,
        });
        // Los dos resultados no-registrados son imposibles acá: sin mpPaymentId
        // no hay `already_processed`, y el cesante sin pendientes ya se rechazó
        // arriba con su mensaje de mostrador.
        if (r.kind !== "registered") throw new TreasuryError("No se pudo registrar el pago.");
        // Se arma explícito y no con un rest: el retorno de Efectivo es contrato
        // de las pantallas y no tiene por qué heredar campos nuevos del núcleo.
        return {
          paymentId: r.paymentId, receiptId: r.receiptId, number: r.number,
          periods: r.periods, amount: r.amount, pdfWritten: r.pdfWritten,
        };
      });
    },

    /** Anulación de mostrador: la firma un operador y el pago queda `voided`. */
    async voidReceipt(input: { receiptId: number; actorId: number; reason: string }) {
      return revertCore({ ...input, status: "voided" });
    },

    /** Reembolso o contracargo en Mercado Pago. No hay operador detrás
     *  (`voidedById` queda en null) y el recibo se busca por el id del cobro de
     *  MP, que es lo único que trae el webhook. Idempotente: un pago ya
     *  revertido —por reembolso o por anulación de mostrador— no se revierte de
     *  nuevo, así el reintento de MP no vuelve a contar la deuda. */
    async refundPayment(input: { mpPaymentId: string; reason: string }): Promise<
      | { kind: "refunded"; paymentId: number; number: string; periodsReverted: number }
      | { kind: "not_found" }
      | { kind: "already_reverted"; status: "refunded" | "voided" }
    > {
      const r = await db.receipt.findFirst({
        where: { payment: { mpPaymentId: input.mpPaymentId } },
        select: { id: true, payment: { select: { status: true } } },
      });
      if (!r) return { kind: "not_found" };
      if (r.payment.status !== "applied") return { kind: "already_reverted", status: r.payment.status };
      const done = await revertCore({ receiptId: r.id, status: "refunded", actorId: null, reason: input.reason });
      return { kind: "refunded", ...done };
    },

    receiptPdfData: pdfDataFor,

    async regenerateReceiptPdf(receiptId: number): Promise<Uint8Array> {
      const data = await pdfDataFor(receiptId);
      const bytes = await renderPdf(data);
      await writePdf(receiptRelativePath(data.number), bytes);
      return bytes;
    },
  };
}

export const treasuryService = makeTreasuryService({ db: prisma, feeValues: feeValueReader });
