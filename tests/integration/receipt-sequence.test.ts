// Corre SOLO con DATABASE_URL_TEST apuntando a una base migrada (la de Docker
// sirve). 20 transacciones concurrentes piden número: tienen que salir 1..20
// sin huecos ni repetidos, y una transacción que falla no consume número.
import { describe, expect, it } from "vitest";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "@/generated/prisma/client";
import { nextReceiptSeq } from "@/lib/treasury/receipt-number";

const url = process.env.DATABASE_URL_TEST;

describe.skipIf(!url)("receipt sequence (MariaDB)", () => {
  const prisma = new PrismaClient({ adapter: new PrismaMariaDb(url ?? "") });
  const YEAR = 1999; // año que ningún recibo real va a usar

  it("20 pedidos concurrentes dan 1..20 sin huecos", async () => {
    await prisma.receiptSequence.deleteMany({ where: { year: YEAR } });
    const seqs = await Promise.all(
      Array.from({ length: 20 }, () =>
        prisma.$transaction((tx) => nextReceiptSeq(tx, YEAR), { timeout: 20000 })),
    );
    expect([...seqs].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it("una transacción que falla no consume número", async () => {
    await prisma.receiptSequence.deleteMany({ where: { year: YEAR } });
    await prisma.$transaction((tx) => nextReceiptSeq(tx, YEAR));
    await expect(
      prisma.$transaction(async (tx) => {
        await nextReceiptSeq(tx, YEAR);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await prisma.$transaction((tx) => nextReceiptSeq(tx, YEAR))).toBe(2);
    await prisma.receiptSequence.deleteMany({ where: { year: YEAR } });
    await prisma.$disconnect();
  });
});
