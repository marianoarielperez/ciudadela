import Link from "next/link";
import { requireMember } from "@/lib/auth/require-member";
import { hasRecentLinkPayment, readReturnOutcome } from "@/lib/mp/return-status";
import { prisma } from "@/lib/prisma";
import { buildPeriodGrid, fetchMemberAccount } from "@/lib/treasury/account";
import { feeValueReader } from "@/lib/treasury/fee-values";
import { currentPeriod } from "@/lib/treasury/periods";
import { categoryPaysFee } from "@/lib/treasury/rules";
import { AccountSection } from "@/components/admin/account-section";
import { EmptyState } from "@/components/admin/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PayForm } from "./pay-form";
import { ReturnNotice } from "./return-notice";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mi cuenta — Vecinal Ciudadela" };

export default async function MiCuentaPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // La página se autoriza sola (el layout corre en paralelo y no la protege).
  const actor = await requireMember();
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
  // La señal de "el pago llegó" es de IDENTIDAD y de TIEMPO, no un contador
  // congelado en el primer render (ver `hasRecentLinkPayment`). `payments`
  // viene ordenado por fecha descendente, así que el primero es el más nuevo.
  const justPaidByLink = hasRecentLinkPayment(account.payments);
  const latestPaymentId = account.payments[0]?.id ?? 0;
  // La categoría manda sobre el valor: un vitalicio no paga cuota HAYA o no
  // valor vigente, y decirle "el valor todavía no está publicado" sería
  // mandarlo a esperar algo que no lo incumbe.
  const paysFee = categoryPaysFee(member.category);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Link className="text-sm text-primary hover:underline" href="/mi">
          ← Inicio
        </Link>
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

      <div className="rounded-xl border bg-background p-4">
        <AccountSection
          member={member}
          account={account}
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
              />
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
