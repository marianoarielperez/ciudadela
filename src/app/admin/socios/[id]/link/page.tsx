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
import { activeExemption, adminExemptionNotice } from "@/lib/treasury/exemptions";
import { feeValueReader, NO_FEE_VALUE_MESSAGE } from "@/lib/treasury/fee-values";
import { periodLabel } from "@/lib/treasury/periods";
import { categoryPaysFee } from "@/lib/treasury/rules";
import { upcomingPeriods } from "@/lib/treasury/upcoming";
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
  const [member, feeValue, readmission, exemption] = await Promise.all([
    prisma.member.findUnique({
      where: { id: memberId },
      include: { memberships: { include: { book: true } } },
    }),
    feeValueReader.current(),
    prisma.movement.findFirst({
      where: { memberId, type: "readmission" },
      orderBy: [{ date: "desc" }, { id: "desc" }],
      select: { date: true },
    }),
    // La MISMA función que corta en las dos actions de esta pantalla: lo que acá
    // se esconde es exactamente lo que el servidor rechaza.
    activeExemption(prisma, memberId),
  ]);
  if (!member) notFound();

  const account = await fetchMemberAccount(prisma, member, feeValue);
  const upcoming = upcomingPeriods(account.fees.map((f) => f.period), member.joinedAt, readmission?.date ?? null);
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

      {member.status === "withdrawn" &&
        // Mismo criterio que la pantalla de efectivo: al cesante se le puede
        // cobrar la deuda que quedó (Art. 9 inc. c, REG-16), y el pago no lo
        // reincorpora. Lo que suma acá es la vuelta: su panel de socio está
        // cerrado, así que al volver de Mercado Pago no va a ver el recibo.
        // El recibo lo emite y lo manda el webhook: lo único que falta es
        // avisarle al operador que la VUELTA no la va a ver, no pedirle un
        // envío que ya ocurrió (salvo que no haya email al que mandarlo).
        //
        // Sin deuda no hay nada de eso que anunciar: prometerle un pago que
        // "salda la deuda" a quien no tiene ninguna era mandarlo a generar un
        // link que la action ahora rechaza.
        (account.pendingCount === 0 ? (
          <FormMessage kind="warning" box>
            Está dado de baja y no tiene cuotas pendientes: no hay nada que cobrarle. Un cesante no
            devenga cuotas (REG-16), así que tampoco puede pagar por adelantado.
          </FormMessage>
        ) : (
          <FormMessage kind="warning" box as="div">
            Está dado de baja. El pago salda la deuda y emite recibo, pero <strong>no</strong> lo
            reincorpora — y como su panel de socio está cerrado, al volver de Mercado Pago no va a
            ver la confirmación.{" "}
            {hasEmail
              ? "El recibo le llega igual por email."
              : "Y como no tiene un email válido cargado, el recibo se lo hacés llegar vos desde Tesorería."}
          </FormMessage>
        ))}

      <Card>
        <CardHeader>
          <CardTitle>Generar link de pago</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* El orden importa EN LOS DOS SENTIDOS: `account.feeAmount` es null
              por dos motivos distintos —la categoría no paga cuota, o no hay
              valor vigente— con salidas opuestas (no hay nada que hacer /
              registrar el valor). Se pregunta primero por la CATEGORÍA, que es
              un hecho definitivo y no depende de `fee_values`: preguntando por
              el valor primero, a un vitalicio se le mandaba a registrar un
              monto que igual no va a pagar. `categoryPaysFee` contesta esa
              mitad sin necesitar el valor. */}
          {exemption ? (
            // Va PRIMERO en la cadena, por lo mismo que la guarda de exención va
            // primera en el veredicto de adhesión: se exime a un socio ACTIVO,
            // así que `categoryPaysFee` lo dejaría pasar y el operador terminaría
            // leyendo un motivo que no es el que corta. Neutral y no ámbar: no
            // hay nada roto, hay una decisión de la Comisión.
            <FormMessage kind="neutral" box as="div">
              <p>{adminExemptionNotice(exemption)}</p>
              <p className="mt-2">
                Mientras esté vigente no se le genera ningún link de pago, ni se reenvía uno
                anterior. Si la Comisión la dejó sin efecto, anulala con su acta desde{" "}
                <Link className="underline" href={`/admin/tesoreria/exenciones?socio=${member.id}`}>
                  Tesorería → Exenciones
                </Link>.
              </p>
            </FormMessage>
          ) : !categoryPaysFee(member.category) ? (
            // Honorario, vitalicio o cadete: no hay cuota, así que no hay nada
            // que cobrar por link. Se dice y no se muestra el formulario.
            <EmptyState size="card" description="Esta categoría no paga cuota: no hay link que generar." />
          ) : feeValue === null || account.feeAmount === null ? (
            <FormMessage kind="error" box>{NO_FEE_VALUE_MESSAGE}</FormMessage>
          ) : member.status === "withdrawn" && account.pendingCount === 0 ? (
            // El servicio va a rechazar este cobro (`no_pending_withdrawn`) y la
            // plata quedaría en la bandeja sin recibo: mejor no ofrecerlo.
            <EmptyState
              size="card"
              description="No hay nada que cobrarle: está dado de baja y no le quedó ninguna cuota pendiente."
            />
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
                  <>Está al día. Un link le deja pagar por adelantado, desde {periodLabel(upcoming[0])}.</>
                )}{" "}
                Valor de la cuota:{" "}
                <span className="font-mono tabular-nums">{formatARS(account.feeAmount)}</span>.
              </p>
              <LinkForm
                memberId={member.id}
                feeAmount={account.feeAmount}
                pendingCount={account.pendingCount}
                oldestPending={account.oldestPending}
                upcoming={upcoming}
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
