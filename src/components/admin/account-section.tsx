// Resumen + cinta + libro de pagos. La misma sección sirve a la ficha del admin
// y a /mi/cuenta del socio: `admin` solo agrega los accesos a registrar efectivo
// y cambia el tratamiento ("Debe" / "Debés").
import Link from "next/link";
import type { MemberCategory } from "@/generated/prisma/client";
import { INLINE_LINK } from "@/lib/admin/link-styles";
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

/** Una fila de `mp_subscriptions` como la muestra la ficha. */
export type MpSubscriptionView = {
  preapprovalId: string;
  /** Estado tal cual lo manda MP: el catálogo es de ellos y puede crecer. */
  status: string;
  amount: number | null;
  linkedManually: boolean;
};

/** Lo que la ficha sabe del débito automático del socio. Las DOS señales, por lo
 *  mismo que las mira `autoDebitSignal` (src/lib/members/auto-debit.ts): las
 *  suscripciones que el sistema conoce y el flag del padrón, que marca fichas
 *  viejas cuyo débito se gestionó en el panel de MP y no tiene fila local.
 *
 *  `cancelledCount` está separado a propósito, y es lo que hace que la ficha
 *  tenga un estado propio: "no hay ninguna fila" y "las que hay están
 *  canceladas" son cosas distintas. La segunda es el estado estacionario de todo
 *  socio que se da de baja del débito —el cron de conciliación escribe
 *  `cancelled` en la fila y NADIE baja nunca `Member.autoDebit`—, y tratarla
 *  como la primera hacía que la ficha dijera para siempre "no hay ninguna
 *  suscripción vinculada" sobre una suscripción que el sistema tiene delante y
 *  que sabe muerta, mandando al operador a vincular algo que no hay que
 *  vincular. */
export type AutoDebitView = {
  /** `Member.autoDebit`. */
  flagged: boolean;
  /** Las suscripciones VIVAS del socio (todo lo que no está `cancelled`), de la
   *  más nueva a la más vieja. Es una lista y no una sola porque
   *  `mp_subscriptions.memberId` es índice y NO unique, y el vinculador rechaza
   *  por `preapprovalId` repetido, nunca por socio repetido: dos preapprovals
   *  vivos son dos débitos por mes, plata real de más, y la pantalla no puede
   *  mostrarlos como si fueran uno. */
  live: MpSubscriptionView[];
  /** Cuántas filas canceladas conoce el sistema para este socio. */
  cancelledCount: number;
};

/** La línea de débito automático de la Cuenta corriente. Son CUATRO estados y
 *  el ORDEN de las ramas es la mitad del asunto:
 *
 *   1. hay suscripción viva  — lo que el sistema SABE gana sobre el flag del
 *                              padrón, que puede estar en cualquier valor.
 *   2. sólo canceladas       — el sistema sabe con certeza que el débito está
 *                              muerto. VA ANTES que el flag: al revés, la ficha
 *                              de todo socio que se da de baja del débito
 *                              mostraría para siempre el ámbar de "no hay
 *                              ninguna suscripción vinculada" —falso por
 *                              partida doble: hay una, y se sabe muerta— y lo
 *                              mandaría a vincular lo que no hay que vincular.
 *                              Es el estado estacionario, no un borde: el cron
 *                              de conciliación escribe `cancelled` en la fila y
 *                              nadie baja nunca `Member.autoDebit`.
 *   3. flag sin ninguna fila — acá sí puede haber un débito que el sistema no
 *                              conoce, y sus cobros no se imputan a nada.
 *   4. ninguna señal         — sin débito automático.
 *
 *  Las palabras son las MISMAS que las de /admin/tesoreria/suscripciones (badge
 *  de estado, monto, id corto, origen): es la misma suscripción vista desde dos
 *  lados y no puede llamarse distinto en cada uno. El `preapprovalId` va
 *  recortado a propósito: es el identificador del mandato de cobro contra la
 *  tarjeta de un vecino, y para reconocer una fila alcanzan los primeros
 *  caracteres.
 *
 *  `role="none"` en los avisos: es el ESTADO de la ficha, no la respuesta a una
 *  acción. Un `alert` acá interrumpiría al lector de pantalla cada vez que se
 *  abre la pestaña. */
function AutoDebitLine({ flagged, live, cancelledCount }: AutoDebitView) {
  if (live.length > 0) {
    // Más de una viva es plata real de más: dos mandatos de cobro son dos
    // débitos por mes. La pantalla las lista todas —afirmar "la suscripción" en
    // singular sería esconder la segunda— y el ámbar dice qué significa.
    const many = live.length > 1;
    return (
      <div className="space-y-2">
        {many && (
          <p className="text-sm">
            Débito automático:{" "}
            <span className="font-semibold">{live.length} suscripciones vivas</span>
          </p>
        )}
        {live.map((s) => (
          <div key={s.preapprovalId} className="border-l-2 border-border pl-3">
            <p className="text-sm">
              {!many && "Débito automático: "}
              <Badge className="align-middle" variant={subscriptionStatusBadgeVariant(s.status)}>
                {subscriptionStatusLabel(s.status)}
              </Badge>
              {s.amount !== null ? (
                <> · <span className="font-mono tabular-nums">{formatARS(s.amount)}</span> por mes</>
              ) : (
                <span className="text-muted-foreground"> · monto no informado</span>
              )}
            </p>
            <p className="text-xs text-muted-foreground">
              <span className="font-mono">{s.preapprovalId.slice(0, 8)}…</span>
              {" · "}
              {s.linkedManually ? "Vinculada a mano" : "Alta web"}
            </p>
          </div>
        ))}
        {many && (
          <FormMessage kind="warning" box as="div" role="none">
            Cada una de estas suscripciones es un mandato de cobro distinto: mientras sigan activas,
            a este socio se le debita la cuota una vez por cada una. Dejá una sola y cancelá las
            demás en el panel de Mercado Pago.
          </FormMessage>
        )}
      </div>
    );
  }

  if (cancelledCount > 0) {
    return (
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">
          {cancelledCount === 1
            ? "Débito automático cancelado en Mercado Pago."
            : `Las ${cancelledCount} suscripciones de este socio están canceladas en Mercado Pago.`}{" "}
          <Link className={INLINE_LINK} href="/admin/tesoreria/suscripciones">Ver en Suscripciones</Link>
        </p>
        {/* El flag del padrón contra una fila cancelada: el que quedó viejo es
            el flag, y la pestaña Ficha lo sigue mostrando dos clicks al lado.
            Va NEUTRO y no ámbar a propósito: no hay plata en riesgo ni nada que
            hacer: es una discrepancia que hay que poder leer, no una alarma. */}
        {flagged && (
          <FormMessage kind="neutral" box as="p" role="none">
            La pestaña Ficha todavía dice «Débito automático: Sí»: ese dato quedó viejo —el sistema
            nunca lo baja solo—. No hay nada que vincular.
          </FormMessage>
        )}
      </div>
    );
  }

  if (flagged) {
    // El flag del padrón sin NINGUNA fila local: puede haber un débito vivo del
    // que el sistema no sabe nada, y entonces sus cobros no se imputan. Se
    // afirma en condicional porque el flag es del Excel de 2026 y nadie verificó
    // contra MP que ese débito siga existiendo.
    return (
      <FormMessage kind="warning" box as="div" role="none">
        La ficha dice que tiene débito automático, pero el sistema no conoce ninguna suscripción de
        Mercado Pago de este socio, ni viva ni cancelada. Si el débito sigue vivo, cada cobro cae en
        Sin conciliar en lugar de imputarse a su cuota.{" "}
        <Link className={INLINE_LINK} href="/admin/tesoreria/suscripciones">Vincular la suscripción</Link>
      </FormMessage>
    );
  }

  return (
    <p className="text-sm text-muted-foreground">
      Sin débito automático.{" "}
      <Link className={INLINE_LINK} href="/admin/tesoreria/suscripciones">Vincular una suscripción</Link>
    </p>
  );
}

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

      {/* Cómo entra la plata todos los meses, debajo de cuánto debe. */}
      {admin && autoDebit && <AutoDebitLine {...autoDebit} />}

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
                  {/* El concepto CONGELADO del recibo gana sobre el derivado: al
                      revertir un pago las cuotas se sueltan y `periods` queda
                      vacío, así que la fila tachada decía "Cuota social" a secas
                      —justo la fila donde saber qué se había cobrado importa
                      más—. Es el mismo criterio que ya rige en `Receipt.concept`
                      (REG-33): un recibo dice lo que se cobró, no lo que hoy
                      queda imputado. El derivado sigue de respaldo por si algún
                      día hay un pago sin recibo. */}
                  <TableCell>{p.receipt?.concept ?? paymentConcept(p.type, p.periods)}</TableCell>
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
