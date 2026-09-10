// Corre SOLO con DATABASE_URL_TEST apuntando a una base migrada (la de Docker
// sirve). Prueba, contra MariaDB de verdad, el reparto de un cobro de la
// bandeja (spec 2026-09-10): una transacción, el portador primero, los números
// al final y consecutivos, la fila derivada del grupo, la reapertura, el
// reembolso por grupo, y el TIEMPO de cinco partes contra el timeout de 5 s.
//
// Serie del año 1997: 1998 y 1999 las usan los otros dos archivos (los tests de
// integración no corren en paralelo entre archivos, pero un año propio sigue
// siendo más barato que depender de eso).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "@/generated/prisma/client";
import { makeFeeValueReader } from "@/lib/treasury/fee-values";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import { makeTreasuryService } from "@/lib/treasury/service";
import { groupTotals } from "@/lib/treasury/split-group";
import { SPLIT_GUARD_MESSAGES as M } from "@/lib/treasury/split-messages";

const url = process.env.DATABASE_URL_TEST;

describe.skipIf(!url)("reparto de un cobro de la bandeja (MariaDB)", () => {
  const YEAR = 1997;
  const PAID_AT = new Date("1997-06-15T12:00:00Z");
  const MP_ID = "itest-split-18k";
  let prisma: PrismaClient;
  let actorId: number;
  const ids: number[] = []; // los socios de prueba, en orden

  function svc() {
    return makeTreasuryService({
      db: prisma,
      feeValues: makeFeeValueReader(prisma),
      renderPdf: async () => new Uint8Array(),
      writePdf: async () => {},
    });
  }

  async function seedRow(amount = 18000, mpPaymentId = MP_ID) {
    const row = await prisma.mpUnmatchedPayment.create({
      data: { mpPaymentId, amount: amount.toFixed(2), paidAt: PAID_AT, reason: "no_reference", payerEmail: null },
    });
    return row.id;
  }

  // Borra SOLO lo de los socios de prueba y la serie del año de prueba. Las
  // partes van antes que los portadores: la FK `split_of_payment_id` es RESTRICT.
  async function cleanup() {
    if (ids.length === 0) return;
    await prisma.mpUnmatchedPayment.deleteMany({ where: { mpPaymentId: { startsWith: "itest-split" } } });
    const pays = (await prisma.payment.findMany({ where: { memberId: { in: ids } }, select: { id: true } })).map((p) => p.id);
    if (pays.length > 0) {
      await prisma.receipt.deleteMany({ where: { paymentId: { in: pays } } });
      await prisma.fee.deleteMany({ where: { paymentId: { in: pays } } });
    }
    await prisma.fee.deleteMany({ where: { memberId: { in: ids } } });
    await prisma.payment.deleteMany({ where: { memberId: { in: ids }, splitOfPaymentId: { not: null } } });
    await prisma.payment.deleteMany({ where: { memberId: { in: ids } } });
    await prisma.receiptSequence.deleteMany({ where: { year: YEAR } });
  }

  async function seedFees(memberId: number, periods: string[]) {
    await prisma.fee.createMany({
      data: periods.map((period) => ({ memberId, period, status: "pending", origin: "import" })),
    });
  }

  beforeAll(async () => {
    prisma = new PrismaClient({ adapter: new PrismaMariaDb(url ?? "") });
    const admin = await prisma.user.findFirst({ select: { id: true } });
    if (!admin) throw new Error("La base de prueba necesita al menos un usuario (el seed lo crea).");
    actorId = admin.id;
    for (const name of ["A", "B", "C", "D", "E"]) {
      const m = await prisma.member.create({
        data: { fullName: `Itest, Reparto ${name}`, category: "active", status: "active", joinedAt: new Date("1996-01-01T12:00:00Z") },
      });
      ids.push(m.id);
    }
  });

  beforeEach(async () => {
    await cleanup();
    // A debe marzo y abril de 1997; B, abril; C, D y E, abril.
    await seedFees(ids[0], ["1997-03", "1997-04"]);
    for (const id of ids.slice(1)) await seedFees(id, ["1997-04"]);
  });

  afterAll(async () => {
    await cleanup();
    if (ids.length > 0) await prisma.member.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  });

  const twoPlusOne = () => [
    { memberId: ids[0], concept: "fees" as const, n: 2, amount: 12000 },
    { memberId: ids[1], concept: "fees" as const, n: 1, amount: 6000 },
  ];

  it("2 + 1 en una transacción: dos recibos consecutivos, portador con el id de MP, parte apuntando a él, fila matched", async () => {
    const rowId = await seedRow();
    const r = await svc().registerSplitPayment({ rowId, parts: twoPlusOne(), actorId });
    if (r.kind !== "registered") throw new Error(r.kind);
    expect(r.rowStatus).toBe("matched");
    expect(r.parts.map((p) => p.number)).toEqual(["1997-00001", "1997-00002"]);
    const holder = await prisma.payment.findUniqueOrThrow({ where: { mpPaymentId: MP_ID } });
    expect(holder).toMatchObject({ memberId: ids[0], amount: expect.anything(), splitOfPaymentId: null });
    expect(Number(holder.amount)).toBe(12000);
    const part = await prisma.payment.findUniqueOrThrow({ where: { id: r.parts[1].paymentId } });
    expect(part).toMatchObject({ memberId: ids[1], mpPaymentId: null, splitOfPaymentId: holder.id });
    expect(Number(part.amount)).toBe(6000);
    const row = await prisma.mpUnmatchedPayment.findUniqueOrThrow({ where: { id: rowId } });
    expect(row).toMatchObject({ status: "matched", paymentId: holder.id, resolvedById: actorId });
    expect(await prisma.fee.count({ where: { memberId: { in: [ids[0], ids[1]] }, status: "paid" } })).toBe(3);
    expect((await prisma.receiptSequence.findUniqueOrThrow({ where: { year: YEAR } })).last).toBe(2);
  });

  it("dos repartos a la vez sobre la misma fila: uno gana, el otro lo lee, la serie no tiene huecos", async () => {
    const rowId = await seedRow();
    const s = svc();
    const results = await Promise.allSettled([
      s.registerSplitPayment({ rowId, parts: twoPlusOne(), actorId }),
      s.registerSplitPayment({ rowId, parts: [{ memberId: ids[2], concept: "fees", n: 1, amount: 18000 }], actorId }),
    ]);
    const ok = results.filter((x) => x.status === "fulfilled");
    const ko = results.filter((x) => x.status === "rejected") as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(ko).toHaveLength(1);
    expect([M.rowResolved, M.changed]).toContain(ko[0].reason.message);
    expect(await prisma.payment.count({ where: { OR: [{ mpPaymentId: MP_ID }, { splitOf: { mpPaymentId: MP_ID } }] } })).toBe(2);
    expect((await prisma.receiptSequence.findUniqueOrThrow({ where: { year: YEAR } })).last).toBe(2);
  });

  it("anular una parte → partial con el resto; reasignar → matched; anular todo → open; volver a repartir cuelga del portador anulado", async () => {
    const rowId = await seedRow();
    const s = svc();
    const r = await s.registerSplitPayment({ rowId, parts: twoPlusOne(), actorId });
    if (r.kind !== "registered") throw new Error(r.kind);
    await s.voidReceipt({ receiptId: r.parts[1].receiptId, actorId, reason: "no era" });
    expect(await prisma.mpUnmatchedPayment.findUniqueOrThrow({ where: { id: rowId } })).toMatchObject({ status: "partial", paymentId: r.parts[0].paymentId });
    const r2 = await s.registerSplitPayment({ rowId, parts: [{ memberId: ids[2], concept: "fees", n: 1, amount: 6000 }], actorId });
    if (r2.kind !== "registered") throw new Error(r2.kind);
    expect(r2.parts[0].number).toBe("1997-00003");
    expect(await prisma.mpUnmatchedPayment.findUniqueOrThrow({ where: { id: rowId } })).toMatchObject({ status: "matched" });
    await s.voidReceipt({ receiptId: r2.parts[0].receiptId, actorId, reason: "tampoco" });
    await s.voidReceipt({ receiptId: r.parts[0].receiptId, actorId, reason: "error" });
    expect(await prisma.mpUnmatchedPayment.findUniqueOrThrow({ where: { id: rowId } })).toMatchObject({ status: "open", paymentId: null });
    // El callejón de hoy, destrabado: la fila reabierta se vuelve a aplicar.
    const r3 = await s.registerSplitPayment({ rowId, parts: twoPlusOne(), actorId });
    if (r3.kind !== "registered") throw new Error(r3.kind);
    const holder = await prisma.payment.findUniqueOrThrow({ where: { mpPaymentId: MP_ID } });
    expect(holder.status).toBe("voided");
    for (const p of r3.parts) {
      expect(await prisma.payment.findUniqueOrThrow({ where: { id: p.paymentId } })).toMatchObject({ mpPaymentId: null, splitOfPaymentId: holder.id, status: "applied" });
    }
    expect(r3.parts.map((p) => p.number)).toEqual(["1997-00004", "1997-00005"]);
  });

  it("reembolso de MP: revierte todas las partes aplicadas y reabre la fila; el reintento da already_reverted", async () => {
    const rowId = await seedRow();
    const s = svc();
    await s.registerSplitPayment({ rowId, parts: twoPlusOne(), actorId });
    const r = await s.refundPayment({ mpPaymentId: MP_ID, reason: "Reembolso en Mercado Pago" });
    expect(r).toMatchObject({ kind: "refunded", periodsReverted: 3, parts: 2 });
    expect(await prisma.payment.count({ where: { memberId: { in: ids }, status: "refunded" } })).toBe(2);
    expect(await prisma.fee.count({ where: { memberId: { in: [ids[0], ids[1]] }, status: "pending" } })).toBe(3);
    expect(await prisma.mpUnmatchedPayment.findUniqueOrThrow({ where: { id: rowId } })).toMatchObject({ status: "open", paymentId: null });
    expect(await s.refundPayment({ mpPaymentId: MP_ID, reason: "x" })).toEqual({ kind: "already_reverted", status: "refunded" });
  });

  it("una fila REEMBOLSADA no se vuelve a repartir: ni un pago nuevo ni un número de la serie", async () => {
    // El reembolso deja la fila en `open` —el reparto se deshizo— y las cuotas
    // pendientes: la foto es indistinguible de una fila que nunca se aplicó. Sin
    // la guarda, el reparto entraba y les emitía recibos a los vecinos por plata
    // que Mercado Pago ya devolvió al pagador.
    const rowId = await seedRow();
    const s = svc();
    await s.registerSplitPayment({ rowId, parts: twoPlusOne(), actorId });
    await s.refundPayment({ mpPaymentId: MP_ID, reason: "Reembolso en Mercado Pago" });
    expect(await prisma.mpUnmatchedPayment.findUniqueOrThrow({ where: { id: rowId } })).toMatchObject({ status: "open" });
    const seqBefore = (await prisma.receiptSequence.findUniqueOrThrow({ where: { year: YEAR } })).last;
    const paymentsBefore = await prisma.payment.count({ where: { memberId: { in: ids } } });
    await expect(s.registerSplitPayment({ rowId, parts: twoPlusOne(), actorId })).rejects.toThrow(M.refunded);
    expect(await prisma.payment.count({ where: { memberId: { in: ids } } })).toBe(paymentsBefore);
    expect((await prisma.receiptSequence.findUniqueOrThrow({ where: { year: YEAR } })).last).toBe(seqBefore);
    expect(await prisma.mpUnmatchedPayment.findUniqueOrThrow({ where: { id: rowId } })).toMatchObject({ status: "open" });
  });

  it("anulación y reparto del resto A LA VEZ, con dos instancias del servicio: la fila queda consistente con el grupo", async () => {
    // El mutex de `registerSplitPayment` es de PROCESO: dos instancias del módulo
    // no lo comparten, así que lo único que serializa a los dos escritores es el
    // `FOR UPDATE` de la fila en MariaDB —el que la anulación ahora toma primero—.
    // Sin él, la anulación saca su foto de las partes aplicadas sin la fila
    // tomada y puede devolverla a `open` con plata imputada a un socio.
    //
    // El resultado se afirma como INVARIANTE y no por orden: los dos órdenes son
    // legítimos (gana el reparto → Parcial con lo que quede; gana la anulación →
    // el reparto lee "cambió" y la fila queda abierta) y cuál gana no es
    // determinístico. Lo que no puede pasar es que el estado de la fila y el
    // grupo digan cosas distintas.
    const rowId = await seedRow();
    const s = svc();
    const r = await s.registerSplitPayment({ rowId, parts: twoPlusOne(), actorId });
    if (r.kind !== "registered") throw new Error(r.kind);
    await s.voidReceipt({ receiptId: r.parts[1].receiptId, actorId, reason: "no era" });
    // Segunda instancia del módulo: mutex propio. El `vi.mock("@/lib/prisma")` es
    // hoisted y sigue aplicando después del reset.
    vi.resetModules();
    const { makeTreasuryService: makeSecond } = await import("@/lib/treasury/service");
    const s2 = makeSecond({
      db: prisma, feeValues: makeFeeValueReader(prisma),
      renderPdf: async () => new Uint8Array(), writePdf: async () => {},
    });
    await Promise.allSettled([
      s.voidReceipt({ receiptId: r.parts[0].receiptId, actorId, reason: "tampoco" }),
      s2.registerSplitPayment({ rowId, parts: [{ memberId: ids[2], concept: "fees", n: 1, amount: 6000 }], actorId }),
    ]);
    const row = await prisma.mpUnmatchedPayment.findUniqueOrThrow({ where: { id: rowId } });
    const holder = await prisma.payment.findUniqueOrThrow({ where: { mpPaymentId: MP_ID }, select: { id: true } });
    const all = await prisma.payment.findMany({
      where: { OR: [{ id: holder.id }, { splitOfPaymentId: holder.id }] },
      select: { amount: true, status: true },
    });
    const derived = groupTotals(all.map((p) => ({ amount: Number(p.amount), status: p.status })), Number(row.amount));
    console.log(`[unmatched-split] carrera: fila ${row.status}, grupo ${derived.status} (asignado ${derived.assigned})`);
    expect(row.status).toBe(derived.status);
  });

  it("cinco partes entran en el presupuesto de 5 s de Prisma (tiempo medido)", async () => {
    const rowId = await seedRow(30000, "itest-split-30k");
    const parts = ids.map((memberId) => ({ memberId, concept: "fees" as const, n: 1, amount: 6000 }));
    const t0 = performance.now();
    const r = await svc().registerSplitPayment({ rowId, parts, actorId });
    const ms = performance.now() - t0;
    if (r.kind !== "registered") throw new Error(r.kind);
    console.log(`[unmatched-split] 5 partes en ${ms.toFixed(0)} ms`);
    expect(r.parts.map((p) => p.number)).toEqual(["1997-00001", "1997-00002", "1997-00003", "1997-00004", "1997-00005"]);
    expect(ms).toBeLessThan(5000);
  });
});
