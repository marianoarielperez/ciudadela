import Link from "next/link";
import { RefreshCw, ScrollText, User, Wallet } from "lucide-react";

import { MemberCard } from "@/components/mi/member-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireMember } from "@/lib/auth/require-member";
import { formatARS } from "@/lib/format";
import { electoralStatusFor } from "@/lib/mi/identity";
import { isCharging, isNotCancelled } from "@/lib/mp/subscription-status";
import { prisma } from "@/lib/prisma";
import { feeValueReader } from "@/lib/treasury/fee-values";
import { currentPeriod } from "@/lib/treasury/periods";
import { ACCRUING_CATEGORIES, categoryPaysFee, debtAmount } from "@/lib/treasury/rules";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mi panel — Vecinal Ciudadela" };

const LINK_CTA =
  "inline-flex min-h-11 items-center text-sm font-medium text-primary outline-hidden hover:underline focus-visible:ring-2 focus-visible:ring-ring";

function QuickLink(props: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  description: string;
}) {
  const Icon = props.icon;
  return (
    <Link
      href={props.href}
      className="flex min-h-24 flex-col justify-between rounded-xl bg-card p-4 ring-1 ring-foreground/10 outline-hidden transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Icon className="size-5 text-primary" aria-hidden />
      <span>
        <span className="block text-sm font-semibold">{props.label}</span>
        <span className="block text-xs text-muted-foreground">{props.description}</span>
      </span>
    </Link>
  );
}

export default async function MiHomePage() {
  // La página se autoriza sola (el layout corre en paralelo y no la protege).
  const actor = await requireMember({ allowSuspended: true });
  if (!actor.ok) return null; // el layout ya explica por qué
  const [member, pendingCount, arrears, feeValue, debitSubs] = await Promise.all([
    prisma.member.findUniqueOrThrow({
      where: { id: actor.memberId },
      select: {
        fullName: true,
        category: true,
        status: true,
        joinedAt: true,
        memberships: { select: { memberNumber: true, book: { select: { status: true } } } },
      },
    }),
    prisma.fee.count({ where: { memberId: actor.memberId, status: "pending" } }),
    // Mora electoral: pendientes ANTERIORES al mes en curso (misma definición
    // que el padrón de 4C — la cuota del mes corriente no es mora).
    prisma.fee.count({
      where: { memberId: actor.memberId, status: "pending", period: { lt: currentPeriod() } },
    }),
    feeValueReader.current(),
    // Consulta liviana para la tarjeta de débito: sólo el status, nada de lo
    // que ya trae `memberDebit.preview` (eso lo resuelve /mi/debito).
    prisma.mpSubscription.findMany({ where: { memberId: actor.memberId }, select: { status: true } }),
  ]);
  // El número vigente es el del libro ABIERTO (mismo criterio que Deudores).
  const memberNumber =
    member.memberships.find((m) => m.book.status === "open")?.memberNumber ?? null;
  const electoral = electoralStatusFor({
    category: member.category,
    status: member.status,
    joinedAt: member.joinedAt,
    arrears,
    at: new Date(),
  });
  const paysFee = categoryPaysFee(member.category);
  const accrues = (ACCRUING_CATEGORIES as readonly string[]).includes(member.category);
  const debt = feeValue ? debtAmount(pendingCount, member.category, feeValue) : null;
  // Lista NEGRA de un valor (`isNotCancelled`), no la blanca: acá interesa
  // "¿hay algo vivo?", igual que /mi/debito. `isCharging` decide entre las dos
  // frases positivas.
  const liveDebitStatuses = debitSubs.filter((s) => isNotCancelled(s.status)).map((s) => s.status);
  const debitState: "active" | "pending" | "none" = liveDebitStatuses.some(isCharging)
    ? "active"
    : liveDebitStatuses.length > 0
      ? "pending"
      : "none";

  return (
    <div className="space-y-4">
      <h1 className="sr-only">Inicio</h1>
      <MemberCard
        fullName={member.fullName}
        memberNumber={memberNumber}
        category={member.category}
        joinedAt={member.joinedAt}
        electoral={electoral}
      />

      <Card>
        <CardHeader>
          <CardTitle as="h2" className="flex items-center gap-2">
            <Wallet className="size-4 text-primary" aria-hidden />
            Mi cuenta
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!paysFee ? (
            <p className="text-sm text-muted-foreground">Tu categoría no paga cuota.</p>
          ) : pendingCount > 0 ? (
            <p className="text-sm font-medium text-warning">
              Debés {pendingCount} {pendingCount === 1 ? "cuota" : "cuotas"}
              {debt !== null && <> · {formatARS(debt)} a valor vigente</>}
            </p>
          ) : accrues ? (
            <p className="text-sm font-medium text-success">Estás al día.</p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Tu aporte es voluntario: no tenés cuotas pendientes.
            </p>
          )}
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            <Link className={LINK_CTA} href="/mi/cuenta">
              Ver mi cuenta →
            </Link>
            {paysFee && feeValue && (
              <Link className={LINK_CTA} href="/mi/cuenta#pagar">
                Pagar ahora →
              </Link>
            )}
          </div>
        </CardContent>
      </Card>

      {paysFee && (
        <Card>
          <CardHeader>
            <CardTitle as="h2" className="flex items-center gap-2">
              <RefreshCw className="size-4 text-primary" aria-hidden />
              Débito automático
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {debitState === "active" ? (
              <p className="text-sm font-medium text-success">Activo</p>
            ) : debitState === "pending" ? (
              <p className="text-sm font-medium text-muted-foreground">Pendiente de autorización</p>
            ) : (
              <p className="text-sm text-muted-foreground">No estás adherido.</p>
            )}
            <Link className={LINK_CTA} href="/mi/debito">
              {debitState === "none" ? "Adherirme →" : "Ver mi débito →"}
            </Link>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-4">
        <QuickLink href="/mi/datos" icon={User} label="Mis datos" description="Tu ficha del padrón" />
        <QuickLink href="/mi/estatuto" icon={ScrollText} label="Estatuto" description="El texto completo en PDF" />
      </div>
    </div>
  );
}
