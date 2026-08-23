// Corre SOLO con DATABASE_URL_TEST apuntando a una base migrada (la de Docker
// sirve). Prueba, contra MariaDB de verdad, las tres piezas que sostienen
// REG-33 cuando dos eventos del MISMO cobro de Mercado Pago llegan a la vez:
//
//  1. el pago es la PRIMERA escritura de la transacción, así que el que pierde
//     la unique de `mp_payment_id` muere antes de pedir número;
//  2. el número se pide TARDE y adentro de la transacción;
//  3. un rollback NO consume número (`INSERT … ON DUPLICATE KEY UPDATE` es
//     transaccional, a diferencia de un AUTO_INCREMENT).
//
// El servicio se importa con `@/lib/prisma` mockeado: `service.ts` construye su
// singleton al evaluarse y, sin ese mock, la suite normal (sin .env cargado) se
// caería al IMPORTAR el módulo en vez de saltear el describe.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import type { Prisma } from "@/generated/prisma/client";
import { PrismaClient } from "@/generated/prisma/client";
import { makeFeeValueReader } from "@/lib/treasury/fee-values";
import { formatReceiptNumber } from "@/lib/treasury/receipt-number";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import { makeTreasuryService } from "@/lib/treasury/service";

const url = process.env.DATABASE_URL_TEST;

type TxClient = Prisma.TransactionClient;
type Fn = (...args: unknown[]) => unknown;
type UniqueSpy = { count: number };

function isP2002(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2002";
}

function bound(value: unknown, self: object): unknown {
  return typeof value === "function" ? (value as Fn).bind(self) : value;
}

// Envuelve `payment.create` del cliente de transacción para CONTAR los choques
// reales contra la unique de `mp_payment_id`. Sin esto el test no puede
// distinguir un `already_processed` que salió de la consulta previa (el caso
// barato) de uno que salió del P2002 (el que de verdad prueba la barrera): el
// servicio devuelve lo mismo en los dos casos y se traga el error.
function watchPaymentCreate(tx: TxClient, spy: UniqueSpy): TxClient {
  return new Proxy(tx, {
    get(target, prop) {
      const value = Reflect.get(target, prop);
      if (prop !== "payment") return bound(value, target);
      const delegate = value as object;
      return new Proxy(delegate, {
        get(d, p) {
          const inner = Reflect.get(d, p);
          if (p !== "create" || typeof inner !== "function") return bound(inner, d);
          const create = inner as Fn;
          return async (...args: unknown[]) => {
            try {
              return await create.apply(d, args);
            } catch (e) {
              if (isP2002(e)) spy.count += 1;
              throw e;
            }
          };
        },
      });
    },
  });
}

/** Mismo cliente y misma base; lo único que agrega es el contador de P2002. */
function watchUniqueViolations(client: PrismaClient, spy: UniqueSpy): PrismaClient {
  return new Proxy(client, {
    get(target, prop) {
      const value = Reflect.get(target, prop);
      if (prop !== "$transaction") return bound(value, target);
      return (arg: unknown, options?: unknown) => {
        if (typeof arg !== "function") return (value as Fn).call(target, arg, options);
        const run = arg as (tx: TxClient) => Promise<unknown>;
        return (value as Fn).call(target, (tx: TxClient) => run(watchPaymentCreate(tx, spy)), options);
      };
    },
  });
}

describe.skipIf(!url)("aplicación concurrente de un cobro de MP (MariaDB)", () => {
  // 1998 y no 1999 porque `receipt-sequence.test.ts` usa la serie 1999. Los dos
  // archivos ya no corren en paralelo (`fileParallelism: false` en
  // `vitest.integration.config.mts`, que es lo que de verdad lo resuelve), pero
  // un año propio por archivo sigue siendo más barato que depender de eso.
  const YEAR = 1998; // serie que ningún recibo real va a usar
  const PAID_AT = new Date("1998-06-15T12:00:00Z");
  const AMOUNT = 6000;
  // El cliente se construye en `beforeAll` y no en el cuerpo del describe:
  // vitest evalúa el cuerpo aunque la suite esté salteada, y ahí abriría un pool
  // contra una URL vacía.
  let prisma: PrismaClient;
  let memberId: number;

  function serviceOn(db: PrismaClient, make = makeTreasuryService) {
    return make({
      db,
      feeValues: makeFeeValueReader(db),
      // Nada de I/O de archivos: el PDF es best-effort y acá no se prueba.
      renderPdf: async () => new Uint8Array(),
      writePdf: async () => {},
    });
  }

  function apply(svc: ReturnType<typeof makeTreasuryService>, mpPaymentId: string) {
    return svc.registerPayment({
      memberId, type: "debit", n: 1, amount: AMOUNT, paidAt: PAID_AT, mpPaymentId, actorId: null,
    });
  }

  // Borra SOLO lo del socio de prueba y la serie del año de prueba: la base local tiene datos
  // sembrados que se usan para probar a mano. Corre en `beforeEach` y en
  // `afterAll` (que corre aunque un `it` falle), así nada queda colgado.
  async function cleanup() {
    if (memberId === undefined) return;
    const ids = (await prisma.payment.findMany({ where: { memberId }, select: { id: true } })).map((p) => p.id);
    if (ids.length > 0) {
      await prisma.receipt.deleteMany({ where: { paymentId: { in: ids } } });
      await prisma.fee.deleteMany({ where: { paymentId: { in: ids } } });
    }
    await prisma.fee.deleteMany({ where: { memberId } });
    await prisma.payment.deleteMany({ where: { memberId } });
    await prisma.receiptSequence.deleteMany({ where: { year: YEAR } });
  }

  beforeAll(async () => {
    prisma = new PrismaClient({ adapter: new PrismaMariaDb(url ?? "") });
    const m = await prisma.member.create({
      data: {
        fullName: "Itest, Concurrencia MP", category: "active", status: "active",
        joinedAt: new Date("1997-01-01T12:00:00Z"),
      },
    });
    memberId = m.id;
  });

  beforeEach(cleanup);

  afterAll(async () => {
    await cleanup();
    if (memberId !== undefined) await prisma.member.delete({ where: { id: memberId } });
    await prisma.$disconnect();
  });

  it("20 aplicaciones con un solo servicio → 1 pago, 1 recibo, serie +1 (sin llegar al P2002)", async () => {
    const spy: UniqueSpy = { count: 0 };
    const svc = serviceOn(watchUniqueViolations(prisma, spy));
    const results = await Promise.all(Array.from({ length: 20 }, () => apply(svc, "itest-777")));

    expect(results.filter((r) => r.kind === "registered")).toHaveLength(1);
    expect(results.filter((r) => r.kind === "already_processed")).toHaveLength(19);
    expect(await prisma.payment.count({ where: { mpPaymentId: "itest-777" } })).toBe(1);
    expect(await prisma.receipt.count({ where: { paymentId: { in: await paymentIds() } } })).toBe(1);
    expect((await prisma.receiptSequence.findUnique({ where: { year: YEAR } }))?.last).toBe(1);
    // Lo que este caso NO prueba, dicho explícito: el mutex por socio serializa
    // las 20 dentro del proceso, así que las 19 perdedoras salen por la consulta
    // previa y la unique de la base nunca se ejercita. Si esto alguna vez da > 0,
    // el mutex dejó de serializar y hay que enterarse.
    expect(spy.count).toBe(0);
  }, 30000);

  it("20 aplicaciones repartidas en dos mutex distintos → mismo resultado, y el P2002 real se ejercita", async () => {
    // OJO: `memberMutex` es de MÓDULO, no de instancia. Dos
    // `makeTreasuryService()` del mismo import comparten cola, así que para
    // simular dos procesos hay que recargar el módulo: recién ahí hay dos mutex.
    vi.resetModules();
    const modB = await import("@/lib/treasury/service");
    expect(modB.makeTreasuryService).not.toBe(makeTreasuryService); // dos copias del módulo = dos mutex

    const spy: UniqueSpy = { count: 0 };
    const db = watchUniqueViolations(prisma, spy);
    const a = serviceOn(db);
    const b = serviceOn(db, modB.makeTreasuryService);
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => apply(i % 2 === 0 ? a : b, "itest-888")),
    );

    expect(results.filter((r) => r.kind === "registered")).toHaveLength(1);
    expect(results.filter((r) => r.kind === "already_processed")).toHaveLength(19);
    expect(await prisma.payment.count({ where: { mpPaymentId: "itest-888" } })).toBe(1);
    expect(await prisma.receipt.count({ where: { paymentId: { in: await paymentIds() } } })).toBe(1);
    expect(await prisma.fee.count({ where: { memberId } })).toBe(1);
    // El punto del caso: al menos una transacción llegó a `payment.create` y
    // chocó contra la unique de `mp_payment_id` de verdad.
    expect(spy.count).toBeGreaterThanOrEqual(1);
    // Y ese choque no consumió número: la serie avanzó exactamente 1.
    expect((await prisma.receiptSequence.findUnique({ where: { year: YEAR } }))?.last).toBe(1);
  }, 30000);

  it("una transacción que aborta DESPUÉS de pedir número no deja hueco en la serie", async () => {
    const svc = serviceOn(prisma);
    // 1) Un cobro bueno: la serie queda en 1.
    const first = await apply(svc, "itest-rb-1");
    expect(first.kind).toBe("registered");
    expect((await prisma.receiptSequence.findUnique({ where: { year: YEAR } }))?.last).toBe(1);

    // 2) Se ocupa a mano el número 1998-00002 para que la próxima transacción
    //    reviente en `receipt.create`, o sea DESPUÉS de haber pedido número.
    const blockerNumber = formatReceiptNumber(YEAR, 2);
    const blockerPayment = await prisma.payment.create({
      data: { memberId, type: "cash", amount: "1.00", paidAt: PAID_AT, status: "applied" },
    });
    const blockerReceipt = await prisma.receipt.create({
      data: {
        number: blockerNumber, year: YEAR, seq: 2, paymentId: blockerPayment.id,
        concept: "bloqueo de prueba", issuedAt: PAID_AT,
      },
    });

    // 3) El cobro que aborta. El servicio ve un P2002 (de `receipts.number`, no
    //    de `mp_payment_id`), no encuentra ganador y relanza.
    await expect(apply(svc, "itest-rb-2")).rejects.toMatchObject({ code: "P2002" });
    // Nada suyo quedó escrito…
    expect(await prisma.payment.count({ where: { mpPaymentId: "itest-rb-2" } })).toBe(0);
    // …y el número que había pedido volvió atrás con la transacción.
    expect((await prisma.receiptSequence.findUnique({ where: { year: YEAR } }))?.last).toBe(1);

    // 4) Liberado el bloqueo, el siguiente recibo bueno toma el 2: sin hueco.
    await prisma.receipt.delete({ where: { id: blockerReceipt.id } });
    await prisma.payment.delete({ where: { id: blockerPayment.id } });
    const second = await apply(svc, "itest-rb-3");
    expect(second.kind === "registered" && second.number).toBe(blockerNumber);
    expect((await prisma.receiptSequence.findUnique({ where: { year: YEAR } }))?.last).toBe(2);
  }, 30000);

  async function paymentIds(): Promise<number[]> {
    return (await prisma.payment.findMany({ where: { memberId }, select: { id: true } })).map((p) => p.id);
  }
});
