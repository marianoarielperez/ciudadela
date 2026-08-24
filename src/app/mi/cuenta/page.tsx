import Link from "next/link";
import { requireMember } from "@/lib/auth/require-member";
import { hasRecentLinkPayment, readReturnOutcome } from "@/lib/mp/return-status";
import { prisma } from "@/lib/prisma";
import { buildPeriodGrid, fetchMemberAccount } from "@/lib/treasury/account";
import { feeValueReader } from "@/lib/treasury/fee-values";
import { currentPeriod } from "@/lib/treasury/periods";
import { categoryPaysFee } from "@/lib/treasury/rules";
import { upcomingPeriods } from "@/lib/treasury/upcoming";
import { cn } from "@/lib/utils";
import { AccountSection } from "@/components/admin/account-section";
import { EmptyState } from "@/components/admin/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PayForm } from "./pay-form";
import { ReturnNotice } from "./return-notice";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mi cuenta — Vecinal Ciudadela" };

function YearChip(props: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={props.href}
      scroll={false}
      aria-current={props.active ? "true" : undefined}
      className={cn(
        "inline-flex min-h-11 items-center rounded-full border px-4 text-sm outline-hidden transition-colors",
        "focus-visible:ring-2 focus-visible:ring-ring",
        props.active
          ? "border-primary bg-primary/10 font-semibold text-primary"
          : "border-border text-muted-foreground hover:text-foreground",
      )}
    >
      {props.children}
    </Link>
  );
}

export default async function MiCuentaPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // La página se autoriza sola (el layout corre en paralelo y no la protege).
  // El suspendido entra en modo lectura (spec M5 §5): ve su cuenta y puede
  // pagar, igual que un socio vigente.
  const actor = await requireMember({ allowSuspended: true });
  if (!actor.ok) return null;
  const sp = await props.searchParams;
  // `?volvio=1` lo pone la `back_url` de la preferencia de Mercado Pago. El
  // desenlace (aprobado / pendiente / rechazado) lo agrega MP a la misma query:
  // las tres `back_urls` son la misma URL, así que sin leerlo un rechazo
  // recibiría el texto de un pago en camino.
  const volvio = (Array.isArray(sp.volvio) ? sp.volvio[0] : sp.volvio) === "1";
  const outcome = readReturnOutcome(sp);
  // El valor vigente de la cuota no depende del socio: se pide en paralelo con
  // la ficha (mismo criterio que la ficha de socio del panel admin).
  const [member, feeValue, readmission] = await Promise.all([
    prisma.member.findUniqueOrThrow({
      where: { id: actor.memberId },
      select: { id: true, category: true, joinedAt: true },
    }),
    feeValueReader.current(),
    prisma.movement.findFirst({
      where: { memberId: actor.memberId, type: "readmission" },
      orderBy: [{ date: "desc" }, { id: "desc" }],
      select: { date: true },
    }),
  ]);
  const account = await fetchMemberAccount(prisma, member, feeValue);
  const upcoming = upcomingPeriods(account.fees.map((f) => f.period), member.joinedAt, readmission?.date ?? null);
  const receiptByPayment = new Map(
    account.payments.filter((p) => p.receipt).map((p) => [p.id, p.receipt!.number]),
  );
  const grid = buildPeriodGrid(account.fees, receiptByPayment, currentPeriod());
  // La señal de "el pago llegó" es de IDENTIDAD y de TIEMPO, no un contador
  // congelado en el primer render (ver `hasRecentLinkPayment`). `payments`
  // viene ordenado por fecha descendente, así que el primero es el más nuevo.
  const justPaidByLink = hasRecentLinkPayment(account.payments);
  const latestPaymentId = account.payments[0]?.id ?? 0;
  // La categoría manda sobre el valor: un vitalicio no paga cuota HAYA o no
  // valor vigente, y decirle "el valor todavía no está publicado" sería
  // mandarlo a esperar algo que no lo incumbe.
  const paysFee = categoryPaysFee(member.category);

  // Chips de filtro por año del libro de pagos (spec M5 §3.3). El filtro es por
  // URL (?anio=): server-rendered, sin estado de cliente. Sólo filtra la TABLA
  // de pagos: el resumen y la cinta siempre muestran la cuenta entera.
  const years = [...new Set(account.payments.map((p) => p.paidAt.getFullYear()))].sort(
    (a, b) => b - a,
  );
  const anioRaw = Array.isArray(sp.anio) ? sp.anio[0] : sp.anio;
  const anio = anioRaw && /^\d{4}$/.test(anioRaw) ? Number(anioRaw) : null;
  const visibleAccount =
    anio === null
      ? account
      : { ...account, payments: account.payments.filter((p) => p.paidAt.getFullYear() === anio) };

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">Mi cuenta</h1>
        <p className="text-sm text-muted-foreground">
          {paysFee
            ? "Tus cuotas y tus recibos. Podés pagar acá con Mercado Pago o en la sede."
            : "Tus cuotas y tus recibos."}
        </p>
      </div>

      {/* Va arriba de todo: es la respuesta a la pregunta con la que el vecino
          acaba de entrar ("¿salió el pago?"), y abajo del resumen no la vería. */}
      {volvio && (
        <ReturnNotice
          outcome={outcome}
          latestPaymentId={latestPaymentId}
          justPaidByLink={justPaidByLink}
        />
      )}

      {years.length > 1 && (
        <nav aria-label="Filtrar pagos por año" className="flex flex-wrap gap-2">
          <YearChip href="/mi/cuenta" active={anio === null}>
            Todos
          </YearChip>
          {years.map((y) => (
            <YearChip key={y} href={`/mi/cuenta?anio=${y}`} active={anio === y}>
              {y}
            </YearChip>
          ))}
        </nav>
      )}

      <div className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
        <AccountSection
          member={member}
          account={visibleAccount}
          rows={grid}
          admin={false}
          receiptHref={(id) => `/api/mi/recibos/${id}`}
        />
      </div>

      {/* Ancla propia: la tarjeta "Pagar" de /mi manda a `/mi/cuenta#pagar`, o
          sea que el vecino que viene a pagar aterriza directo acá abajo con el
          estado de su cuenta ya recorrido en el camino. */}
      <section id="pagar" className="scroll-mt-4">
        <Card>
          <CardHeader>
            <CardTitle>Pagar ahora</CardTitle>
          </CardHeader>
          <CardContent>
            {!paysFee || account.feeAmount === null ? (
              // Honorario, vitalicio o cadete — o todavía no hay valor de cuota
              // vigente. En los dos casos no hay monto que cobrar, y prometer un
              // checkout que no se va a poder crear es peor que decirlo. El
              // orden importa en los DOS sentidos: la categoría primero (es un
              // hecho definitivo), el valor faltante después (es transitorio).
              <EmptyState
                size="card"
                description={
                  !paysFee
                    ? "Tu categoría no paga cuota."
                    : "El valor de la cuota todavía no está publicado. Probá más tarde o consultá en la sede."
                }
              />
            ) : (
              <PayForm
                pendingCount={account.pendingCount}
                feeAmount={account.feeAmount}
                oldestPending={account.oldestPending}
                upcoming={upcoming}
              />
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
