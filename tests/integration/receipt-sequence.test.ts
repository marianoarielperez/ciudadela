// Corre SOLO con DATABASE_URL_TEST apuntando a una base migrada (la de Docker
// sirve). 20 transacciones concurrentes piden número: tienen que salir 1..20
// sin huecos ni repetidos, y una transacción que falla no consume número.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "@/generated/prisma/client";
import { nextReceiptSeq } from "@/lib/treasury/receipt-number";

const url = process.env.DATABASE_URL_TEST;

describe.skipIf(!url)("receipt sequence (MariaDB)", () => {
  const YEAR = 1999; // año que ningún recibo real va a usar
  // El cliente se construye en `beforeAll` y no en el cuerpo del describe:
  // vitest evalúa el cuerpo aunque la suite esté salteada, y ahí abriría un pool
  // contra una URL vacía. Y el `afterAll` corre aunque un `it` falle, así que la
  // conexión y las filas de prueba no quedan colgadas.
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = new PrismaClient({ adapter: new PrismaMariaDb(url ?? "") });
  });

  beforeEach(async () => {
    await prisma.receiptSequence.deleteMany({ where: { year: YEAR } });
  });

  afterAll(async () => {
    await prisma.receiptSequence.deleteMany({ where: { year: YEAR } });
    await prisma.$disconnect();
  });

  it("20 pedidos concurrentes dan 1..20 sin huecos", async () => {
    const seqs = await Promise.all(
      Array.from({ length: 20 }, () =>
        prisma.$transaction((tx) => nextReceiptSeq(tx, YEAR), { timeout: 20000 })),
    );
    expect([...seqs].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it("una transacción que falla no consume número", async () => {
    await prisma.$transaction((tx) => nextReceiptSeq(tx, YEAR));
    await expect(
      prisma.$transaction(async (tx) => {
        await nextReceiptSeq(tx, YEAR);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await prisma.$transaction((tx) => nextReceiptSeq(tx, YEAR))).toBe(2);
  });
});
