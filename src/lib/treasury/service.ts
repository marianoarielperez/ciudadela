// Escrituras de tesorería (spec §6.2, §2.4). Una transacción por operación:
// pago + cuotas + número de recibo. El PDF y el email van DESPUÉS del commit y
// son best-effort: el número ya es definitivo cuando se escribe el archivo.
import type { PaymentType, PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { createKeyedMutex } from "@/lib/keyed-mutex";
import { feeValueReader, makeFeeValueReader, NO_FEE_VALUE_MESSAGE } from "./fee-values";
import { PAYMENT_TYPE_LABELS, paymentConcept } from "./labels";
import { comparePeriods, currentPeriod, periodYear, type Period } from "./periods";
import { formatReceiptNumber, nextReceiptSeq, type TxLike } from "./receipt-number";
import { renderReceiptPdf, type ReceiptPdfData } from "./receipt-pdf";
import { receiptRelativePath, writeReceiptPdf } from "./receipts-dir";
import { allocate, cashConceptsFor, coverageFloor, feeAmountFor, revertFees, type CashConcept } from "./rules";
import { cents, INBOX_CONCEPT_TYPE, loadGroup, MAX_SPLIT_PARTS } from "./split-group";
import { SPLIT_GUARD_MESSAGES } from "./split-messages";
import { splitPartGuards, type SplitPartPlan } from "./split-preview";
import { isFeePeriodUniqueViolation, isUniqueViolation } from "./unique-violation";

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

/** Una parte del reparto de un cobro de la bandeja (spec 2026-09-10). */
export type SplitPartInput = SplitPartPlan;
export type RegisterSplitInput = { rowId: number; parts: SplitPartInput[]; actorId: number; note?: string | null };
export type SplitPartResult = {
  memberId: number; paymentId: number; receiptId: number; number: string; periods: Period[]; amount: number; pdfWritten: boolean;
};
export type RegisterSplitResult =
  | { kind: "registered"; rowStatus: "matched" | "partial"; parts: SplitPartResult[] }
  /** El unique del portador chocó: otro escritor asentó ESTE cobro en el medio. */
  | { kind: "already_processed"; paymentId: number };

/** Tipos que imputan cuotas. `entry` no imputa (REG-14: cubre el mes de alta). */
const FEE_TYPES: readonly PaymentType[] = ["debit", "link", "cash"];

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
      // Recibo colgado de la solicitud, sin ficha: la leyenda de admisión pendiente
      // del PDF (spec 2026-09-01 §6.4). Post-acta el pago ya tiene member y no aplica.
      // La clave se OMITE cuando no aplica —en vez de mandar `false`— para que el
      // dato del recibo de un socio siga siendo byte-idéntico al de siempre: este
      // es el camino de la plata y el flag es puramente aditivo.
      ...(!member && r.payment.application !== null ? { admissionPending: true } : {}),
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

  // ── Las tres piezas del asiento (spec 2026-09-10 §5.1) ─────────────────────
  //
  // `registerPaymentCore` era un solo bloque. El reparto necesita las MISMAS
  // escrituras N veces dentro de UNA transacción, así que el cuerpo se parte en
  // tres funciones que el cobro de siempre llama en el MISMO orden de hoy:
  // preparar → pago + cuotas → (cierre de la fila) → número + recibo. La suite
  // de `tests/treasury-service.test.ts` es la red de este refactor y no cambia.

  type PreparedPart = {
    memberId: number | null;
    applicationId: number | null;
    type: PaymentType;
    /** Redondeado a centavos. */
    amount: number;
    paidAt: Date;
    actorId: number | null;
    note: string | null;
    periods: Period[];
    toCreate: Period[];
    /** Congelado al preparar: es lo que dice el recibo para siempre. */
    concept: string;
    year: number;
  };

  /** Validaciones puras del cobro. Devuelve el monto redondeado a centavos. */
  function validateInput(input: RegisterPaymentInput): number {
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
    // cero está confundido sobre qué está cobrando, y silenciarlo asentaba el
    // pago con cero cuotas imputadas sin avisar a nadie. Esto es un bug del
    // llamador, no algo que Mercado Pago pueda provocar, así que es ruidoso.
    if (!FEE_TYPES.includes(input.type) && input.n !== 0) {
      throw new TreasuryError("Este tipo de pago no imputa cuotas: la cantidad tiene que ser 0.");
    }
    if (input.memberId === null && input.type !== "entry") throw new TreasuryError("El pago necesita un socio.");
    return amount;
  }

  /** Todo lo que corre ANTES de la transacción: validaciones, socio, cuotas,
   *  reingreso, imputación y concepto congelado.
   *
   *  `strictWithdrawn: false` es el camino de siempre: el cesante se recorta en
   *  silencio porque desde un webhook no hay a quién avisarle (y tirar sería un
   *  500 que MP reintentaría para siempre). `true` es el reparto: hay un
   *  operador enfrente y un recorte silencioso sería cobrar algo distinto de lo
   *  que acaba de confirmar. */
  async function preparePart(
    input: RegisterPaymentInput,
    opts: { strictWithdrawn: boolean },
  ): Promise<{ kind: "prepared"; part: PreparedPart } | { kind: "no_pending_withdrawn" }> {
    const amount = validateInput(input);
    let periods: Period[] = [];
    let toCreate: Period[] = [];
    // Ya se validó que `input.n === 0` para cualquier tipo fuera de FEE_TYPES.
    let n = input.n;
    if (input.memberId !== null) {
      const member = await db.member.findUnique({
        where: { id: input.memberId },
        select: { id: true, status: true, joinedAt: true },
      });
      if (!member) throw new TreasuryError("El socio no existe.");
      if (n > 0) {
        // El reingreso más nuevo entra en el piso de cobertura y NO se puede
        // derivar de `joinedAt` (REG-11: el reingreso no reinicia la antigüedad,
        // ver `applications/record.ts`). `date` es la fecha del ACTA que
        // resolvió el reingreso: el reingreso rige desde el acta.
        const [fees, readmission] = await Promise.all([
          db.fee.findMany({ where: { memberId: member.id }, select: { period: true, status: true } }),
          db.movement.findFirst({
            where: { memberId: member.id, type: "readmission" },
            orderBy: [{ date: "desc" }, { id: "desc" }],
            select: { date: true },
          }),
        ]);
        const pending = fees.filter((f) => f.status === "pending").map((f) => f.period);
        // Un dado de baja no devenga: se le cobra la deuda congelada y ni una
        // cuota más.
        if (member.status === "withdrawn") {
          if (opts.strictWithdrawn && n > pending.length) {
            throw new TreasuryError(SPLIT_GUARD_MESSAGES.withdrawnCount(pending.length));
          }
          n = Math.min(n, pending.length);
          if (n === 0) return { kind: "no_pending_withdrawn" };
        }
        const allocation = allocate({
          pending,
          existing: fees.map((f) => f.period),
          n,
          // El PISO, no el mes en curso: la cuenta corriente no tiene fila para
          // lo que ya está cubierto. El piso puede quedar ANTES de hoy (quien no
          // pagó septiembre y paga en octubre cubre septiembre primero) y también
          // DESPUÉS (un alta de noviembre).
          startAt: coverageFloor({ joinedAt: member.joinedAt, readmittedAt: readmission?.date ?? null }),
        });
        periods = allocation.toPay;
        toCreate = allocation.toCreate;
      }
    }
    return {
      kind: "prepared",
      part: {
        memberId: input.memberId,
        applicationId: input.applicationId ?? null,
        type: input.type,
        amount,
        paidAt: input.paidAt,
        actorId: input.actorId,
        note: input.note ?? null,
        periods,
        toCreate,
        // El concepto se congela al emitir: es lo que dice el recibo para siempre.
        concept: fitConcept(paymentConcept(input.type, periods)),
        year: seriesYear(input.paidAt),
      },
    };
  }

  /** De qué dinero es el pago: el de MP que porta ÉL (`mpPaymentId`), o una
   *  PARTE del que porta otro (`splitOfPaymentId`, spec 2026-09-10). Nunca las
   *  dos cosas: el tipo no deja escribirlas juntas. */
  type PaymentIdentity =
    | { mpPaymentId: string | null; preapprovalId: string | null }
    | { splitOfPaymentId: number };

  /** Pago + cuotas, dentro de la transacción del llamador. El pago va PRIMERO:
   *  si la unique de `mpPaymentId` choca (dos eventos del mismo cobro en
   *  paralelo), la transacción muere acá, antes de pedir número — un rollback
   *  no consume serie (REG-33). Devuelve el id del pago. */
  async function writePaymentAndFees(tx: TxLike, part: PreparedPart, identity: PaymentIdentity): Promise<number> {
    const payment = await tx.payment.create({
      data: {
        memberId: part.memberId,
        applicationId: part.applicationId,
        type: part.type,
        amount: part.amount.toFixed(2),
        paidAt: part.paidAt,
        ...("splitOfPaymentId" in identity
          ? { mpPaymentId: null, preapprovalId: null, splitOfPaymentId: identity.splitOfPaymentId }
          : { mpPaymentId: identity.mpPaymentId, preapprovalId: identity.preapprovalId }),
        registeredById: part.actorId,
        note: part.note,
        status: "applied",
      },
    });
    if (part.toCreate.length > 0) {
      await tx.fee.createMany({
        data: part.toCreate.map((period) => ({
          memberId: part.memberId!, period, status: "paid" as const, origin: "accrual" as const, paymentId: payment.id,
        })),
      });
    }
    const existingToPay = part.periods.filter((p) => !part.toCreate.includes(p));
    if (existingToPay.length > 0) {
      // `status: "pending"` no es redundante con la lectura de arriba: acota
      // el UPDATE a lo que sigue pendiente AHORA. Y se controla el `count`
      // porque un `where` que no matchea no falla, solo actualiza cero filas:
      // sin este chequeo, un pago podía quedar cobrado sin cuotas imputadas.
      const imputed = await tx.fee.updateMany({
        where: { memberId: part.memberId!, period: { in: existingToPay }, status: "pending" },
        data: { status: "paid", paymentId: payment.id },
      });
      if (imputed.count !== existingToPay.length) {
        throw new TreasuryError(
          "Las cuotas del socio cambiaron mientras se registraba el pago. Revisá la cuenta y volvé a intentarlo.",
        );
      }
    }
    return payment.id;
  }

  /** El número, lo último: el lock de la fila del año se sostiene hasta el
   *  commit, así que todo lo que se pueda escribir antes se escribe antes. */
  async function issueReceipt(tx: TxLike, paymentId: number, part: PreparedPart): Promise<{ receiptId: number; number: string }> {
    const seq = await nextReceiptSeq(tx, part.year);
    const number = formatReceiptNumber(part.year, seq);
    const receipt = await tx.receipt.create({
      data: {
        number, year: part.year, seq, paymentId, concept: part.concept,
        pdfPath: receiptRelativePath(number), issuedAt: part.paidAt,
      },
    });
    return { receiptId: receipt.id, number };
  }

  // Núcleo agnóstico del origen: asienta un cobro (pago + cuotas + recibo) sin
  // preguntar de dónde viene. NO toma el mutex — el mutex lo pone el método
  // público `registerPayment`, y `registerCashPayment` lo llama desde adentro
  // del suyo (no existe mutex reentrante: volver a tomarlo se bloquearía solo).
  async function registerPaymentCore(input: RegisterPaymentInput, retried = false): Promise<RegisterResult> {
    validateInput(input);

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

    const prepared = await preparePart(input, { strictWithdrawn: false });
    if (prepared.kind === "no_pending_withdrawn") return { kind: "no_pending_withdrawn" };
    const { part } = prepared;

    let created: { paymentId: number; receiptId: number; number: string };
    try {
      created = await db.$transaction(async (tx) => {
        const paymentId = await writePaymentAndFees(tx, part, {
          mpPaymentId: input.mpPaymentId ?? null,
          preapprovalId: input.preapprovalId ?? null,
        });
        // Cierre automático de la bandeja: si este cobro estaba esperando, deja
        // de esperar en la misma transacción que lo asienta.
        if (input.mpPaymentId) {
          await tx.mpUnmatchedPayment.updateMany({
            where: { mpPaymentId: input.mpPaymentId, status: "open" },
            data: { status: "matched", paymentId, resolvedAt: now() },
          });
        }
        const { receiptId, number } = await issueReceipt(tx, paymentId, part);
        return { paymentId, receiptId, number };
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
      // Carrera con el cron de devengo (4C): entre el `findMany` de las cuotas y
      // este INSERT, el cron creó el mismo período y el unique (memberId, period)
      // mató la transacción entera. Se recalcula la imputación desde cero y se
      // reintenta UNA vez. Acotado a ESE unique: el otro unique que puede matar
      // esta transacción es `mp_payment_id`, y ése no se reintenta nunca.
      if (!retried && input.memberId !== null && isFeePeriodUniqueViolation(e)) {
        console.warn("[treasury] P2002 al imputar: se recalcula la imputación y se reintenta", input.memberId);
        return registerPaymentCore(input, true);
      }
      throw e;
    }
    // Después del commit: el número ya es definitivo y el PDF es regenerable.
    const pdfWritten = await writePdfBestEffort(created.receiptId, receiptRelativePath(created.number));
    return { kind: "registered", ...created, periods: [...part.periods].sort(comparePeriods), amount: part.amount, pdfWritten };
  }

  // ── Reparto de un cobro de la bandeja (spec 2026-09-10 §5.2) ────────────────
  //
  // Un pago por socio en UNA transacción. El PORTADOR es el pago que lleva el
  // `mpPaymentId` de la fila: el que ya existe (aplicado, anulado o
  // reembolsado: sigue portando el id de MP y las partes nuevas cuelgan de él),
  // o la primera parte, que entonces es el primer INSERT de la transacción — si
  // el unique choca, muere antes de pedir número (REG-33). Los números, al
  // final, uno por parte. NO toma mutex: lo pone `registerSplitPayment`.
  async function registerSplitCore(input: RegisterSplitInput, retried: boolean): Promise<RegisterSplitResult> {
    const M = SPLIT_GUARD_MESSAGES;
    const row = await db.mpUnmatchedPayment.findUnique({
      where: { id: input.rowId },
      select: { id: true, mpPaymentId: true, preapprovalId: true, amount: true, paidAt: true, status: true },
    });
    if (!row) throw new TreasuryError(M.rowGone);
    if (row.status !== "open" && row.status !== "partial") throw new TreasuryError(M.rowResolved);
    const partsCents = input.parts.reduce((s, p) => s + cents(p.amount), 0);
    // Foto del grupo AFUERA de la transacción: es para el mensaje temprano de la
    // suma. La que manda es la relectura de adentro, con la fila bloqueada.
    const before = await loadGroup(db, { mpPaymentId: row.mpPaymentId, amount: Number(row.amount) });
    if (partsCents !== cents(before.totals.unassigned)) {
      throw new TreasuryError(M.sum(partsCents / 100, before.totals.unassigned));
    }
    const guard = await splitPartGuards(db, input.parts, now());
    if (guard) throw new TreasuryError(guard);

    const prepared: Array<{ memberId: number; part: PreparedPart }> = [];
    for (const p of input.parts) {
      const r = await preparePart({
        memberId: p.memberId,
        type: INBOX_CONCEPT_TYPE[p.concept],
        n: p.concept === "fees" ? p.n : 0,
        amount: p.amount,
        // La fecha REAL del cobro, la de MP: el recibo lleva el día en que se
        // cobró, no el día en que el operador lo repartió.
        paidAt: row.paidAt,
        actorId: input.actorId,
        note: input.note ?? null,
      }, { strictWithdrawn: true });
      // En modo estricto el cesante sin pendientes ya tiró arriba: esto no
      // puede pasar, y si pasa tiene que ser ruidoso, no un recorte silencioso.
      if (r.kind !== "prepared") throw new TreasuryError(M.withdrawnCount(0));
      prepared.push({ memberId: p.memberId, part: r.part });
    }

    let created: { rowStatus: "matched" | "partial"; parts: Array<{ paymentId: number; receiptId: number; number: string }> };
    try {
      created = await db.$transaction(async (tx) => {
        // Lock de la fila EN LA BASE: el mutex `unmatched:{id}` es de proceso y
        // no protege contra una consola de MySQL ni contra un segundo proceso.
        await tx.$queryRaw`SELECT id FROM mp_unmatched_payments WHERE id = ${row.id} FOR UPDATE`;
        const live = await tx.mpUnmatchedPayment.findUnique({ where: { id: row.id }, select: { status: true, amount: true } });
        if (!live || (live.status !== "open" && live.status !== "partial")) throw new TreasuryError(M.rowResolved);
        const group = await loadGroup(tx, { mpPaymentId: row.mpPaymentId, amount: Number(live.amount) });
        if (partsCents !== cents(group.totals.unassigned)) throw new TreasuryError(M.changed);

        let holderId: number | null = group.holder?.id ?? null;
        const written: Array<{ paymentId: number; part: PreparedPart }> = [];
        for (const { part } of prepared) {
          const identity: PaymentIdentity = holderId === null
            ? { mpPaymentId: row.mpPaymentId, preapprovalId: row.preapprovalId }
            : { splitOfPaymentId: holderId };
          const paymentId = await writePaymentAndFees(tx, part, identity);
          if (holderId === null) holderId = paymentId;
          written.push({ paymentId, part });
        }
        const assignedAfter = cents(group.totals.assigned) + partsCents;
        const rowStatus: "matched" | "partial" = assignedAfter >= cents(Number(live.amount)) ? "matched" : "partial";
        // El sello de quién resolvió va ADENTRO: antes se escribía después del
        // commit y, si fallaba, la pantalla decía "automático" sobre una
        // resolución manual.
        const updated = await tx.mpUnmatchedPayment.updateMany({
          where: { id: row.id, status: { in: ["open", "partial"] } },
          data: { status: rowStatus, paymentId: holderId, resolvedAt: now(), resolvedById: input.actorId },
        });
        if (updated.count !== 1) throw new TreasuryError(M.changed);
        // Los números, al final y en el orden de las partes.
        const parts: Array<{ paymentId: number; receiptId: number; number: string }> = [];
        for (const w of written) parts.push({ paymentId: w.paymentId, ...(await issueReceipt(tx, w.paymentId, w.part)) });
        return { rowStatus, parts };
      });
    } catch (e) {
      // El unique del portador chocó: otro escritor (la vinculación de una
      // suscripción, el cron) asentó ESTE cobro entre la foto y el INSERT. Se
      // excluye el unique de (socio, período), que es la carrera de abajo.
      if (isUniqueViolation(e) && !isFeePeriodUniqueViolation(e)) {
        const winner = await db.payment.findUnique({ where: { mpPaymentId: row.mpPaymentId }, select: { id: true } });
        if (winner) return { kind: "already_processed", paymentId: winner.id };
      }
      // Carrera con el cron de devengo: se recalcula TODO el reparto y se
      // reintenta una vez, igual que el cobro simple.
      if (!retried && isFeePeriodUniqueViolation(e)) {
        console.warn("[treasury] P2002 al imputar un reparto: se recalcula la imputación y se reintenta", input.rowId);
        return registerSplitCore(input, true);
      }
      throw e;
    }
    // Después del commit: PDF best-effort, uno por parte.
    const parts: SplitPartResult[] = [];
    for (let i = 0; i < created.parts.length; i++) {
      const c = created.parts[i];
      const { memberId, part } = prepared[i];
      const pdfWritten = await writePdfBestEffort(c.receiptId, receiptRelativePath(c.number));
      parts.push({
        memberId, paymentId: c.paymentId, receiptId: c.receiptId, number: c.number,
        periods: [...part.periods].sort(comparePeriods), amount: part.amount, pdfWritten,
      });
    }
    return { kind: "registered", rowStatus: created.rowStatus, parts };
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
        // Regla de la bandeja, ahora por GRUPO (spec 2026-09-10 §5.3): la fila
        // se decide por el cobro de MP entero —portador + partes—, no por este
        // pago solo. Si no queda ninguna parte aplicada, vuelve a `open` con el
        // MISMO statement de siempre (para un pago suelto, el portador es él
        // mismo, y un efectivo de mostrador se comporta idéntico); si queda
        // alguna, pasa a `partial` y el puntero sigue en el portador. Va DENTRO
        // de la transacción: si la reversión se cae, la fila queda como estaba.
        const holderId = r.payment.splitOfPaymentId ?? r.payment.id;
        const stillApplied = await tx.payment.findMany({
          where: { OR: [{ id: holderId }, { splitOfPaymentId: holderId }], status: "applied" },
          select: { id: true },
        });
        if (stillApplied.length === 0) {
          await tx.mpUnmatchedPayment.updateMany({
            where: { paymentId: holderId },
            data: { status: "open", paymentId: null, resolvedAt: null, resolvedById: null },
          });
        } else {
          await tx.mpUnmatchedPayment.updateMany({
            where: { paymentId: holderId, status: "matched" },
            data: { status: "partial" },
          });
        }
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

    /** Reparte un cobro de la bandeja entre 1..5 socios en UNA transacción
     *  (spec 2026-09-10 §5.2). La bandeja lo llama SIEMPRE, también con una
     *  sola parte. Mutex: la fila afuera, y adentro los socios en orden
     *  ASCENDENTE — claves distintas se anidan, y el orden fijo evita que dos
     *  repartos cruzados se traben. `revertCore` toma UN mutex de socio y no
     *  anida: no hay ciclo posible. */
    async registerSplitPayment(input: RegisterSplitInput): Promise<RegisterSplitResult> {
      const M = SPLIT_GUARD_MESSAGES;
      if (input.parts.length === 0) throw new TreasuryError(M.noParts);
      if (input.parts.length > MAX_SPLIT_PARTS) throw new TreasuryError(M.tooManyParts);
      if (new Set(input.parts.map((p) => p.memberId)).size !== input.parts.length) {
        throw new TreasuryError(M.duplicateMember);
      }
      for (const p of input.parts) {
        const amount = Math.round(p.amount * 100) / 100;
        if (!Number.isFinite(amount) || amount <= 0) throw new TreasuryError(M.amountZero);
        if (amount > MAX_AMOUNT) {
          throw new TreasuryError("El monto supera el máximo que admite el sistema ($ 99.999.999,99).");
        }
        const okCount = p.concept === "fees"
          ? Number.isInteger(p.n) && p.n >= 1 && p.n <= MAX_FEES_PER_PAYMENT
          : p.n === 0;
        if (!okCount) throw new TreasuryError(M.count);
      }
      const memberIds = [...new Set(input.parts.map((p) => p.memberId))].sort((a, b) => a - b);
      const withMembers = <T>(ids: number[], fn: () => Promise<T>): Promise<T> =>
        ids.length === 0 ? fn() : memberMutex.run(`member:${ids[0]}`, () => withMembers(ids.slice(1), fn));
      return memberMutex.run(`unmatched:${input.rowId}`, () => withMembers(memberIds, () => registerSplitCore(input, false)));
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
          throw new TreasuryError(SPLIT_GUARD_MESSAGES.withdrawnConcept);
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
            throw new TreasuryError(SPLIT_GUARD_MESSAGES.withdrawnCount(pending.length));
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
     *  (`voidedById` queda en null) y el cobro se busca por el id de MP, que es
     *  lo único que trae el webhook. Por GRUPO (spec 2026-09-10 §5.4): revierte
     *  el portador y todas las partes que sigan aplicadas, cada una con su mutex
     *  y su transacción. Idempotente por parte: si falla a mitad, el reintento
     *  de MP revierte lo que faltaba y devuelve `already_reverted` cuando ya no
     *  queda nada. */
    async refundPayment(input: { mpPaymentId: string; reason: string }): Promise<
      | { kind: "refunded"; paymentId: number; number: string; periodsReverted: number; parts: number }
      | { kind: "not_found" }
      | { kind: "already_reverted"; status: "refunded" | "voided" }
    > {
      const holder = await db.payment.findUnique({
        where: { mpPaymentId: input.mpPaymentId },
        select: { id: true, status: true },
      });
      if (!holder) return { kind: "not_found" };
      const applied = await db.payment.findMany({
        where: { OR: [{ id: holder.id }, { splitOfPaymentId: holder.id }], status: "applied" },
        select: { id: true },
        orderBy: { id: "asc" },
      });
      if (applied.length === 0) {
        return { kind: "already_reverted", status: holder.status === "voided" ? "voided" : "refunded" };
      }
      let periodsReverted = 0;
      let number: string | null = null;
      let reverted = 0;
      for (const p of applied) {
        const receipt = await db.receipt.findFirst({ where: { paymentId: p.id }, select: { id: true } });
        if (!receipt) continue;
        const done = await revertCore({ receiptId: receipt.id, status: "refunded", actorId: null, reason: input.reason });
        periodsReverted += done.periodsReverted;
        number ??= done.number;
        reverted += 1;
      }
      if (number === null) return { kind: "not_found" };
      return { kind: "refunded", paymentId: holder.id, number, periodsReverted, parts: reverted };
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

/** La interfaz del servicio, para que los consumidores (el webhook, la
 *  conciliación) la pidan por `Pick<>` sin importar el singleton. */
export type TreasuryService = ReturnType<typeof makeTreasuryService>;

export const treasuryService = makeTreasuryService({ db: prisma, feeValues: feeValueReader });
