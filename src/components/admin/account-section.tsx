// Resumen + cinta + libro de pagos. La misma sección sirve a la ficha del admin
// y a /mi/cuenta del socio: `admin` solo agrega los accesos a registrar efectivo
// y cambia el tratamiento ("Debe" / "Debés").
import Link from "next/link";
import type { MemberCategory } from "@/generated/prisma/client";
import { formatARS, formatDateAR } from "@/lib/format";
import type { GridRow, MemberAccount } from "@/lib/treasury/account";
import { PAYMENT_TYPE_LABELS, paymentConcept } from "@/lib/treasury/labels";
import { periodLabel } from "@/lib/treasury/periods";
import { ACCRUING_CATEGORIES } from "@/lib/treasury/rules";
import { EmptyState } from "@/components/admin/empty-state";
import { PeriodStrip } from "@/components/admin/period-strip";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function AccountSection({ member, account, rows, admin, receiptHref }: {
  member: { id: number; category: MemberCategory };
  account: MemberAccount;
  rows: GridRow[];
  admin: boolean;
  /** Link al recibo por id. */
  receiptHref: (receiptId: number) => string;
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
