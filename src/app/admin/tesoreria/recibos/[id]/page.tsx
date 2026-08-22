// El recibo, con los mismos datos que el PDF y las acciones que se le pueden
// hacer (spec §6.4). Es también el aterrizaje del cobro en efectivo: la pantalla
// de efectivo redirige acá con `?emitido=1&email=…`, así que este cartel es lo
// único que le dice al operador si el recibo salió por correo o hay que
// imprimirlo. Si esta ruta no existiera, un cobro exitoso terminaría en un 404 y
// el operador reintentaría, cobrándole dos veces al socio.
//
// El encabezado NO se escribe acá: lo pone el layout de Tesorería.
import Link from "next/link";
import { notFound } from "next/navigation";
import { FormMessage } from "@/components/admin/form-message";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { receiptBadgeVariant } from "@/lib/admin/status-badges";
import { requireAdmin } from "@/lib/auth/require-admin";
import { formatARS, formatDateAR } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { amountInWords } from "@/lib/treasury/amount-words";
import { PAYMENT_TYPE_LABELS } from "@/lib/treasury/labels";
import { resolveEmailNotice } from "@/lib/treasury/receipt-notice";
import { ReceiptActions } from "./receipt-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Recibo — SIGeV" };

// `wide` para los textos largos (el importe en letras, la nota): en media
// columna de media tarjeta se parten en cinco renglones y no se leen.
function Field({ label, value, mono = false, wide = false }: {
  label: string; value: string; mono?: boolean; wide?: boolean;
}) {
  return (
    <div className={wide ? "col-span-2" : undefined}>
      <dt className="text-xs uppercase text-muted-foreground">{label}</dt>
      <dd className={mono ? "text-sm font-mono tabular-nums" : "text-sm"}>{value}</dd>
    </div>
  );
}

export default async function ReciboPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireAdmin();
  if (!actor.ok) return <FormMessage kind="error" box>{actor.error}</FormMessage>;
  const { id } = await props.params;
  const sp = await props.searchParams;
  const receiptId = Number(id);
  if (!Number.isInteger(receiptId) || receiptId <= 0) notFound();

  const r = await prisma.receipt.findUnique({
    where: { id: receiptId },
    include: {
      payment: {
        include: {
          // Sin `fees`: el concepto está congelado en `r.concept` desde que se
          // emitió. Al anular, las cuotas se despegan del pago y recalcularlo
          // devolvería "Cuota social" pelada.
          member: {
            select: {
              id: true, fullName: true, email: true, emailStatus: true,
              memberships: { select: { memberNumber: true, book: { select: { status: true } } } },
            },
          },
          registeredBy: { select: { name: true } },
        },
      },
      voidedBy: { select: { name: true } },
    },
  });
  if (!r) notFound();
  const member = r.payment.member;
  const number = member?.memberships.find((m) => m.book.status === "open")?.memberNumber;
  const voided = Boolean(r.voidedAt);
  const emailParam = Array.isArray(sp.email) ? sp.email[0] : sp.email;
  // La resolución (incluido el fallback a "Recibo emitido" para un `?email=`
  // desconocido o una prototype key) vive en `resolveEmailNotice`: es lógica
  // pura y se prueba aparte, sin React ni Next (tests/treasury-receipt-notice.test.ts).
  const notice = sp.emitido === "1" ? resolveEmailNotice(emailParam) : null;
  const amount = Number(r.payment.amount);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link className="text-sm text-primary hover:underline" href="/admin/tesoreria/recibos">← Recibos</Link>
        <h2 className="font-mono text-2xl tabular-nums">{r.number}</h2>
        <Badge variant={receiptBadgeVariant(voided)}>{voided ? "Anulado" : "Vigente"}</Badge>
      </div>
      {notice && <FormMessage kind={notice.kind} box>{notice.text}</FormMessage>}
      {sp.anulado === "1" && <FormMessage kind="success" box>Recibo anulado.</FormMessage>}
      {r.voidedAt && (
        <FormMessage kind="warning" box>
          Anulado el {formatDateAR(r.voidedAt)}
          {r.voidedBy?.name ? ` por ${r.voidedBy.name}` : ""}
          {r.voidReason ? `: ${r.voidReason}` : "."}
        </FormMessage>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Detalle</CardTitle></CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-3">
              <Field label="Fecha" value={formatDateAR(r.issuedAt)} />
              <Field label="Socio" value={member ? `${member.fullName}${number ? ` (N° ${number})` : ""}` : "—"} />
              {/* Congelado al emitir: es lo que dice el papel que se entregó. */}
              <Field label="Concepto" value={r.concept} />
              <Field label="Medio de pago" value={PAYMENT_TYPE_LABELS[r.payment.type]} />
              <Field label="Importe" value={formatARS(amount)} mono />
              <Field label="Son" value={amountInWords(amount)} wide />
              {r.payment.note && <Field label="Nota" value={r.payment.note} wide />}
              {r.payment.registeredBy?.name && <Field label="Registró" value={r.payment.registeredBy.name} />}
            </dl>
            {member ? (
              <p className="mt-3 text-sm">
                <Link className="text-primary hover:underline" href={`/admin/socios/${member.id}?tab=cuenta`}>
                  Ver cuenta corriente del socio
                </Link>
              </p>
            ) : (
              // El socio se borró (Payment.memberId es SetNull): el recibo
              // sobrevive porque es un asiento institucional.
              <p className="mt-3 text-sm text-muted-foreground">El socio de este recibo ya no está en el padrón.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Acciones</CardTitle></CardHeader>
          <CardContent>
            <ReceiptActions
              receiptId={r.id}
              voided={voided}
              hasEmail={Boolean(member?.email) && member?.emailStatus !== "bounced"}
              emailedAt={r.emailedAt ? formatDateAR(r.emailedAt) : null}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
