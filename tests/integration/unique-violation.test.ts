// Corre SOLO con DATABASE_URL_TEST apuntando a una base migrada (la de Docker
// sirve). Fija la FORMA REAL del P2002 que devuelve MariaDB a través del adapter
// de Prisma 7, porque de esa forma depende la guarda del reintento del núcleo de
// plata (`isFeePeriodUniqueViolation`).
//
// No es un detalle de estilo: el error NO trae `meta.target` —la propiedad que
// documenta Prisma para el motor clásico— sino el nombre del índice adentro de
// `meta.driverAdapterError.cause.constraint.index`. Una guarda escrita contra
// `meta.target` compila, pasa los tests con fakes y NUNCA matchea en producción:
// el reintento quedaría muerto y un pago que cae junto al devengo volvería a
// terminar en 500. Si una actualización de Prisma cambia la forma, este test es
// el que se pone en rojo.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "@/generated/prisma/client";
import { isFeePeriodUniqueViolation, isUniqueViolation, uniqueViolationTarget } from "@/lib/treasury/unique-violation";

const url = process.env.DATABASE_URL_TEST;

describe.skipIf(!url)("forma del P2002 (MariaDB)", () => {
  // Marcadores propios de este archivo: la config de integración corre los
  // archivos en serie, pero las filas igual no se comparten con nadie.
  const MARKER = "TEST unique-violation";
  const MP_ID = "test-unique-violation-1";
  const PERIOD = "1997-01";

  let prisma: PrismaClient;
  let memberId: number;

  beforeAll(async () => {
    prisma = new PrismaClient({ adapter: new PrismaMariaDb(url ?? "") });
    await cleanup();
    const member = await prisma.member.create({
      data: {
        fullName: MARKER, category: "adherent", status: "active",
        joinedAt: new Date("1997-01-01T12:00:00Z"),
      },
    });
    memberId = member.id;
    await prisma.fee.create({ data: { memberId, period: PERIOD } });
    await prisma.payment.create({
      data: { type: "cash", amount: "1.00", paidAt: new Date("1997-01-01T12:00:00Z"), mpPaymentId: MP_ID },
    });
  });

  async function cleanup() {
    await prisma.payment.deleteMany({ where: { mpPaymentId: MP_ID } });
    // Las cuotas caen por cascada con el socio.
    await prisma.member.deleteMany({ where: { fullName: MARKER } });
  }

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  async function violate(fn: () => Promise<unknown>): Promise<unknown> {
    try {
      await fn();
    } catch (e) {
      return e;
    }
    throw new Error("se esperaba una violación de unique y no hubo error");
  }

  it("el unique (member_id, period) de fees se reconoce y dispara el reintento", async () => {
    const e = await violate(() => prisma.fee.create({ data: { memberId, period: PERIOD } }));
    expect(isUniqueViolation(e)).toBe(true);
    expect(uniqueViolationTarget(e)).toBe("fees_member_id_period_key");
    expect(isFeePeriodUniqueViolation(e)).toBe(true);
  });

  it("el unique de mp_payment_id se reconoce como OTRO unique y NO dispara el reintento", async () => {
    const e = await violate(() => prisma.payment.create({
      data: { type: "cash", amount: "1.00", paidAt: new Date("1997-01-01T12:00:00Z"), mpPaymentId: MP_ID },
    }));
    expect(isUniqueViolation(e)).toBe(true);
    expect(uniqueViolationTarget(e)).toBe("payments_mp_payment_id_key");
    // Lo que protege el dinero de Mercado Pago: su barrera de idempotencia no se
    // reintenta nunca.
    expect(isFeePeriodUniqueViolation(e)).toBe(false);
  });
});
