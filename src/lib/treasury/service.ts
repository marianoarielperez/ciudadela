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

const MAX_FEES_PER_PAYMENT = 60;

// `Payment.amount` es Decimal(10,2): 99.999.999,99 es el techo del tipo. Se
// valida ANTES de la transacción para que el operador lea un mensaje en es-AR y
// no el error crudo de Prisma desde adentro del $transaction.
const MAX_AMOUNT = 99_999_999.99;

// `Receipt.concept` es VarChar(200). Un pago de 60 cuotas no contiguas describe
// una lista más larga que eso, así que se recorta antes de escribir: el recibo
// se emite igual y el detalle completo sigue estando en las cuotas del pago.
// Puntos suspensivos ASCII y no "…": el PDF usa fuentes WinAnsi.
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
        payment: { include: { member: { include: { memberships: { include: { book: true } } } } } },
      },
    });
    if (!r) throw new TreasuryError("El recibo no existe.");
    const member = r.payment.member;
    const open = member?.memberships.find((m) => m.book.status === "open");
    return {
      number: r.number,
      issuedAt: r.issuedAt,
      memberName: member?.fullName ?? "—",
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

  return {
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
        if (member.status === "withdrawn") {
          throw new TreasuryError("El socio está dado de baja: registrá primero el reingreso.");
        }
        if (!cashConceptsFor(member.category).includes(input.concept)) {
          throw new TreasuryError("Ese concepto no corresponde a la categoría del socio.");
        }

        let periods: Period[] = [];
        let toCreate: Period[] = [];
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
          const fees = await db.fee.findMany({ where: { memberId: member.id }, select: { period: true, status: true } });
          const allocation = allocate({
            pending: fees.filter((f) => f.status === "pending").map((f) => f.period),
            existing: fees.map((f) => f.period),
            n: count,
            currentPeriod: currentPeriod(at),
          });
          periods = allocation.toPay;
          toCreate = allocation.toCreate;
          amount = unit * count;
        } else {
          const free = input.amount ?? 0;
          if (!Number.isFinite(free) || free <= 0) throw new TreasuryError("Ingresá el monto del aporte.");
          amount = Math.round(free * 100) / 100;
        }
        if (amount > MAX_AMOUNT) {
          throw new TreasuryError("El monto supera el máximo que admite el sistema ($ 99.999.999,99).");
        }

        // El concepto se congela al emitir: es lo que dice el recibo para siempre.
        const concept = fitConcept(paymentConcept(CONCEPT_TYPE[input.concept], periods));
        const year = seriesYear(at);
        const created = await db.$transaction(async (tx) => {
          const payment = await tx.payment.create({
            data: {
              memberId: member.id, type: CONCEPT_TYPE[input.concept], amount: amount.toFixed(2), paidAt: at,
              registeredById: input.actorId, note: input.note ?? null, status: "applied",
            },
          });
          if (toCreate.length > 0) {
            await tx.fee.createMany({
              data: toCreate.map((period) => ({
                memberId: member.id, period, status: "paid" as const, origin: "accrual" as const, paymentId: payment.id,
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
              where: { memberId: member.id, period: { in: existingToPay }, status: "pending" },
              data: { status: "paid", paymentId: payment.id },
            });
            if (imputed.count !== existingToPay.length) {
              throw new TreasuryError(
                "Las cuotas del socio cambiaron mientras se registraba el pago. Revisá la cuenta y volvé a intentarlo.",
              );
            }
          }
          const seq = await nextReceiptSeq(tx, year);
          const number = formatReceiptNumber(year, seq);
          const receipt = await tx.receipt.create({
            data: {
              number, year, seq, paymentId: payment.id, concept,
              pdfPath: receiptRelativePath(number), issuedAt: at,
            },
          });
          return { paymentId: payment.id, receiptId: receipt.id, number };
        });

        const pdfWritten = await writePdfBestEffort(created.receiptId, receiptRelativePath(created.number));
        return { ...created, periods: [...periods].sort(comparePeriods), amount, pdfWritten };
      });
    },

    async voidReceipt(input: { receiptId: number; actorId: number; reason: string }) {
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
            const deleted = await tx.fee.deleteMany({ where: { id: { in: ids } } });
            periodsReverted += deleted.count;
          }
          await tx.payment.update({ where: { id: r.payment.id }, data: { status: "voided" } });
          await tx.receipt.update({
            where: { id: r.id },
            data: { voidedAt: at, voidReason: input.reason, voidedById: input.actorId },
          });
        });
        // El PDF se regenera con la marca ANULADO; si falla, se regenera al pedirlo.
        await writePdfBestEffort(r.id, r.pdfPath ?? receiptRelativePath(r.number));
        // El número devuelto es lo que se hizo, no lo que se pensaba hacer.
        return { paymentId: r.payment.id, number: r.number, periodsReverted };
      });
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
