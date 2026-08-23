// Generar un link de pago de Mercado Pago para un socio (spec 4B §12).
//
// La tercera forma de cobrar, después de la sede y del débito automático: el
// operador genera un enlace por N cuotas y se lo manda. La preferencia NO se
// persiste — cuando el vecino pague, el webhook lee `pago:{socioId}:{n}` y le
// imputa las N cuotas más viejas.
//
// Ruta propia y no un slug más de `[id]/[accion]`: aquélla es la familia de las
// acciones societarias (baja, categoría, suspensión, reingreso), todas con acta
// y todas de un solo envío. Esta no lleva acta, no cambia el estado del socio y
// su pantalla tiene DOS pasos (generar y después mandar).
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/admin/empty-state";
import { FormMessage } from "@/components/admin/form-message";
import { PageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { memberStatusBadgeVariant } from "@/lib/admin/status-badges";
import { requireAdmin } from "@/lib/auth/require-admin";
import { formatARS } from "@/lib/format";
import { CATEGORY_LABELS, STATUS_LABELS } from "@/lib/members/labels";
import { prisma } from "@/lib/prisma";
import { fetchMemberAccount } from "@/lib/treasury/account";
import { feeValueReader, NO_FEE_VALUE_MESSAGE } from "@/lib/treasury/fee-values";
import { LinkForm } from "./link-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Link de pago — SIGeV" };

export default async function PaymentLinkPage(props: { params: Promise<{ id: string }> }) {
  const actor = await requireAdmin();
  if (!actor.ok) return <FormMessage kind="error" box>{actor.error}</FormMessage>;

  const { id } = await props.params;
  // Mismo criterio que la ficha: con "abc" o "1e9" Number() da NaN y Prisma
  // tiraría un error técnico en inglés en vez de un 404.
  const memberId = Number(id);
  if (!Number.isInteger(memberId) || memberId <= 0) notFound();

  // El valor vigente no depende del socio: se pide en paralelo con la ficha.
  const [member, feeValue] = await Promise.all([
    prisma.member.findUnique({
      where: { id: memberId },
      include: { memberships: { include: { book: true } } },
    }),
    feeValueReader.current(),
  ]);
  if (!member) notFound();

  const account = await fetchMemberAccount(prisma, member, feeValue);
  const number = member.memberships.find((m) => m.book.status === "open")?.memberNumber ?? null;
  const hasEmail = Boolean(member.email) && member.emailStatus !== "bounced";

  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader
        title={member.fullName}
        breadcrumb={[
          { label: "Socios", href: "/admin/socios" },
          { label: `N° ${number ?? "—"}`, href: `/admin/socios/${member.id}` },
          { label: "Link de pago" },
        ]}
      >
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">Categoría: {CATEGORY_LABELS[member.category]}</Badge>
          <Badge variant={memberStatusBadgeVariant(member.status)}>{STATUS_LABELS[member.status]}</Badge>
        </div>
      </PageHeader>

      {member.status === "withdrawn" && (
        // Mismo criterio que la pantalla de efectivo: al cesante se le puede
        // cobrar la deuda que quedó (Art. 9 inc. c, REG-16), y el pago no lo
        // reincorpora. Lo que suma acá es la vuelta: su panel de socio está
        // cerrado, así que al volver de Mercado Pago no va a ver el recibo.
        <FormMessage kind="warning" box as="div">
          Está dado de baja. El pago salda la deuda y emite recibo, pero <strong>no</strong> lo
          reincorpora — y como su panel de socio está cerrado, al volver de Mercado Pago no va a
          ver la confirmación: el recibo se lo mandás vos desde Tesorería.
        </FormMessage>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Generar link de pago</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* El orden importa: `account.feeAmount` es null por DOS motivos
              distintos —no hay valor vigente, o la categoría no paga cuota— y
              tienen salidas opuestas (registrar el valor / no hay nada que
              hacer). Preguntar primero por la categoría le diría al operador
              que un socio activo no paga cuota. */}
          {feeValue === null ? (
            <FormMessage kind="error" box>{NO_FEE_VALUE_MESSAGE}</FormMessage>
          ) : account.feeAmount === null ? (
            // Honorario, vitalicio o cadete: no hay cuota, así que no hay nada
            // que cobrar por link. Se dice y no se muestra el formulario.
            <EmptyState size="card" description="Esta categoría no paga cuota: no hay link que generar." />
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                {account.pendingCount > 0 ? (
                  <>
                    Debe{" "}
                    <span className="font-mono tabular-nums">
                      {account.pendingCount} {account.pendingCount === 1 ? "cuota" : "cuotas"}
                    </span>
                    {account.debt !== null && (
                      <> · <span className="font-mono tabular-nums">{formatARS(account.debt)}</span> a valor vigente</>
                    )}
                    .
                  </>
                ) : (
                  <>Está al día. Un link le deja pagar por adelantado.</>
                )}{" "}
                Valor de la cuota:{" "}
                <span className="font-mono tabular-nums">{formatARS(account.feeAmount)}</span>.
              </p>
              <LinkForm
                memberId={member.id}
                feeAmount={account.feeAmount}
                pendingCount={account.pendingCount}
                oldestPending={account.oldestPending}
                hasEmail={hasEmail}
              />
            </>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline">
          <Link href={`/admin/socios/${member.id}?tab=cuenta`}>Volver a la cuenta corriente</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href={`/admin/tesoreria/efectivo?socio=${member.id}`}>Cobrar en efectivo</Link>
        </Button>
      </div>
    </div>
  );
}
