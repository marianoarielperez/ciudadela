// Resumen + cinta + libro de pagos. La misma sección sirve a la ficha del admin
// y a /mi/cuenta del socio: `admin` solo agrega los accesos a registrar efectivo
// y cambia el tratamiento ("Debe" / "Debés").
import Link from "next/link";
import type { MemberCategory } from "@/generated/prisma/client";
import { subscriptionStatusBadgeVariant } from "@/lib/admin/status-badges";
import { subscriptionStatusLabel } from "@/lib/admin/unmatched-labels";
import { formatARS, formatDateAR } from "@/lib/format";
import type { GridRow, MemberAccount } from "@/lib/treasury/account";
import { PAYMENT_TYPE_LABELS, paymentConcept } from "@/lib/treasury/labels";
import { periodLabel } from "@/lib/treasury/periods";
import { ACCRUING_CATEGORIES } from "@/lib/treasury/rules";
import { EmptyState } from "@/components/admin/empty-state";
import { FormMessage } from "@/components/admin/form-message";
import { PeriodStrip } from "@/components/admin/period-strip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

/** Lo que la ficha sabe del débito automático del socio. Las DOS señales, por lo
 *  mismo que las mira `hasLiveAutoDebit` (src/lib/members/auto-debit.ts): la
 *  suscripción que el sistema conoce y el flag del padrón, que marca fichas
 *  viejas cuyo débito se gestionó en el panel de MP y no tiene fila local. */
export type AutoDebitView = {
  /** `Member.autoDebit`. */
  flagged: boolean;
  /** La suscripción viva vinculada a este socio, si el sistema la conoce. */
  subscription: {
    preapprovalId: string;
    /** Estado tal cual lo manda MP: el catálogo es de ellos y puede crecer. */
    status: string;
    amount: number | null;
    linkedManually: boolean;
  } | null;
};

const INLINE_LINK =
  "text-primary outline-hidden hover:underline focus-visible:ring-2 focus-visible:ring-ring";

export function AccountSection({ member, account, rows, admin, receiptHref, autoDebit }: {
  member: { id: number; category: MemberCategory };
  account: MemberAccount;
  rows: GridRow[];
  admin: boolean;
  /** Link al recibo por id. */
  receiptHref: (receiptId: number) => string;
  /** Sólo lo pasa el admin: el mandato de cobro vive en Mercado Pago y es
   *  información de gestión, no del libro que ve el socio en /mi/cuenta. */
  autoDebit?: AutoDebitView;
}) {
  const accruing = ACCRUING_CATEGORIES.includes(member.category);
  // La cinta conoce el NÚMERO del recibo (viene de `buildPeriodGrid`), pero el
  // link se arma con el id: este índice traduce uno en otro.
  const byNumber = new Map(account.payments.filter((p) => p.receipt).map((p) => [p.receipt!.number, p.receipt!.id]));
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        {account.pendingCount > 0 ? (
          <p className="text-lg">
            {admin ? "Debe" : "Debés"}{" "}
            <span className="font-mono font-semibold tabular-nums">
              {account.pendingCount} {account.pendingCount === 1 ? "cuota" : "cuotas"}
            </span>
            {account.debt !== null && <> · <span className="font-mono tabular-nums">{formatARS(account.debt)}</span> a valor vigente</>}
            {account.oldestPending && <span className="text-muted-foreground"> · desde {periodLabel(account.oldestPending)}</span>}
          </p>
        ) : accruing ? (
          <p className="text-lg text-success">{admin ? "Está al día." : "Estás al día."}</p>
        ) : (
          <p className="text-lg text-muted-foreground">
            {admin ? "La categoría no devenga cuota: el aporte es voluntario." : "Tu aporte es voluntario: no tenés cuotas pendientes."}
          </p>
        )}
        {account.feeAmount !== null && (
          <p className="text-sm text-muted-foreground">
            Valor vigente de la cuota: <span className="font-mono tabular-nums">{formatARS(account.feeAmount)}</span>
          </p>
        )}
      </div>

      {/* Cómo entra la plata todos los meses, debajo de cuánto debe. La línea
          describe la suscripción con las MISMAS palabras que la pantalla de
          Suscripciones (badge de estado, monto, id corto, origen): es la misma
          suscripción vista desde dos lados y no puede llamarse distinto en cada
          uno. El `preapprovalId` va recortado a propósito: es el identificador
          del mandato de cobro contra la tarjeta de un vecino, y para reconocer
          una fila alcanzan los primeros caracteres. */}
      {admin && autoDebit && (
        autoDebit.subscription ? (
          <div className="border-l-2 border-border pl-3">
            <p className="text-sm">
              Débito automático:{" "}
              <Badge className="align-middle" variant={subscriptionStatusBadgeVariant(autoDebit.subscription.status)}>
                {subscriptionStatusLabel(autoDebit.subscription.status)}
              </Badge>
              {autoDebit.subscription.amount !== null ? (
                <> · <span className="font-mono tabular-nums">{formatARS(autoDebit.subscription.amount)}</span> por mes</>
              ) : (
                <span className="text-muted-foreground"> · monto no informado</span>
              )}
            </p>
            <p className="text-xs text-muted-foreground">
              <span className="font-mono">{autoDebit.subscription.preapprovalId.slice(0, 8)}…</span>
              {" · "}
              {autoDebit.subscription.linkedManually ? "Vinculada a mano" : "Alta web"}
            </p>
          </div>
        ) : autoDebit.flagged ? (
          // El flag del padrón sin fila local: puede haber un débito vivo del que
          // el sistema no sabe nada, y entonces sus cobros no se imputan. Se
          // afirma en condicional porque el flag es del Excel de 2026 y nadie
          // verificó contra MP que ese débito siga existiendo.
          // `role="none"`: es el ESTADO de la ficha, no la respuesta a una
          // acción. Un `alert` acá interrumpiría al lector de pantalla cada vez
          // que se abre la pestaña.
          <FormMessage kind="warning" box as="div" role="none">
            La ficha dice que tiene débito automático, pero no hay ninguna suscripción de Mercado
            Pago vinculada a este socio. Si el débito sigue vivo, cada cobro cae en Sin conciliar en
            lugar de imputarse a su cuota.{" "}
            <Link className={INLINE_LINK} href="/admin/tesoreria/suscripciones">Vincular la suscripción</Link>
          </FormMessage>
        ) : (
          <p className="text-sm text-muted-foreground">
            Sin débito automático.{" "}
            <Link className={INLINE_LINK} href="/admin/tesoreria/suscripciones">Vincular una suscripción</Link>
          </p>
        )
      )}

      {/* La cinta se muestra si la categoría devenga o si alguna vez hubo cuotas:
          para un honorario sin una sola fila sería una grilla vacía sin sentido. */}
      {(accruing || account.fees.length > 0) && (
        <PeriodStrip rows={rows} receiptHref={(n) => { const id = byNumber.get(n); return id ? receiptHref(id) : null; }} />
      )}

      {admin && (
        <div className="flex flex-wrap gap-2">
          <Button asChild><Link href={`/admin/tesoreria/efectivo?socio=${member.id}`}>Registrar efectivo</Link></Button>
          <Button asChild variant="outline"><Link href={`/admin/socios/${member.id}/link`}>Generar link de pago</Link></Button>
          <Button asChild variant="outline"><Link href="/admin/tesoreria/recibos">Ver recibos</Link></Button>
        </div>
      )}

      <div className="space-y-2">
        <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Pagos</h3>
        {account.payments.length === 0 ? (
          <EmptyState size="card" description="Sin pagos registrados." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead><TableHead>Concepto</TableHead><TableHead>Medio</TableHead>
                <TableHead className="text-right">Importe</TableHead><TableHead>Recibo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {account.payments.map((p) => (
                <TableRow key={p.id} className={p.status !== "applied" ? "text-muted-foreground line-through" : undefined}>
                  <TableCell>{formatDateAR(p.paidAt)}</TableCell>
                  <TableCell>{paymentConcept(p.type, p.periods)}</TableCell>
                  <TableCell>{PAYMENT_TYPE_LABELS[p.type]}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatARS(p.amount)}</TableCell>
                  <TableCell className="font-mono tabular-nums">
                    {p.receipt ? <Link className="text-primary hover:underline" href={receiptHref(p.receipt.id)}>{p.receipt.number}</Link> : "—"}
                    {p.receipt?.voidedAt && <span className="ml-1 text-xs">(anulado)</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
