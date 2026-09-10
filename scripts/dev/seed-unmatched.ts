// Siembra una fila de la bandeja Sin conciliar en la base LOCAL, para probar el
// reparto a mano (spec 2026-09-10). Nunca en producción: ahí las filas las
// escribe Mercado Pago.
// Run: npx tsx scripts/dev/seed-unmatched.ts 18000 haraoz@yahoo.com
import "dotenv/config";
import { prisma } from "../../src/lib/prisma";
import { makeUnmatchedInbox } from "../../src/lib/mp/unmatched";

async function main() {
  const amount = Number(process.argv[2] ?? "18000");
  const payerEmail = process.argv[3] ?? null;
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Monto inválido");
  const mpPaymentId = `dev-${Date.now()}`;
  const r = await makeUnmatchedInbox(prisma).record({
    mpPaymentId, amount, paidAt: new Date(), payerEmail, externalReference: null,
    description: "Varios", preapprovalId: null, reason: "no_reference",
  });
  const row = await prisma.mpUnmatchedPayment.findUnique({ where: { mpPaymentId }, select: { id: true } });
  console.log(`${r}: fila ${row?.id} por $ ${amount} (${mpPaymentId}) → http://localhost:3000/admin/tesoreria/sin-conciliar/${row?.id}`);
}

main().finally(() => prisma.$disconnect());
