import Link from "next/link";
import { requireMember } from "@/lib/auth/require-member";
import { prisma } from "@/lib/prisma";
import { buildPeriodGrid, fetchMemberAccount } from "@/lib/treasury/account";
import { feeValueReader } from "@/lib/treasury/fee-values";
import { currentPeriod } from "@/lib/treasury/periods";
import { AccountSection } from "@/components/admin/account-section";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mi cuenta — Vecinal Ciudadela" };

export default async function MiCuentaPage() {
  // La página se autoriza sola (el layout corre en paralelo y no la protege).
  const actor = await requireMember();
  if (!actor.ok) return null;
  // El valor vigente de la cuota no depende del socio: se pide en paralelo con
  // la ficha (mismo criterio que la ficha de socio del panel admin).
  const [member, feeValue] = await Promise.all([
    prisma.member.findUniqueOrThrow({
      where: { id: actor.memberId },
      select: { id: true, category: true },
    }),
    feeValueReader.current(),
  ]);
  const account = await fetchMemberAccount(prisma, member, feeValue);
  const receiptByPayment = new Map(
    account.payments.filter((p) => p.receipt).map((p) => [p.id, p.receipt!.number]),
  );
  const grid = buildPeriodGrid(account.fees, receiptByPayment, currentPeriod());

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Link className="text-sm text-primary hover:underline" href="/mi">
          ← Inicio
        </Link>
        <h1 className="text-2xl font-bold">Mi cuenta</h1>
        <p className="text-sm text-muted-foreground">
          Tus cuotas y tus recibos. Para pagar, acercate a la sede o esperá el débito mensual.
        </p>
      </div>
      <div className="rounded-xl border bg-background p-4">
        <AccountSection
          member={member}
          account={account}
          rows={grid}
          admin={false}
          receiptHref={(id) => `/api/mi/recibos/${id}`}
        />
      </div>
    </div>
  );
}
