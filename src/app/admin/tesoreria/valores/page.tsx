import Link from "next/link";

import { EmptyState } from "@/components/admin/empty-state";
import { FormMessage } from "@/components/admin/form-message";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { memberStatusBadgeVariant } from "@/lib/admin/status-badges";
import { requireAdmin, requireSuperadmin } from "@/lib/auth/require-admin";
import { formatARS, formatDateAR } from "@/lib/format";
import { CATEGORY_LABELS, STATUS_LABELS } from "@/lib/members/labels";
import { listDivergent } from "@/lib/mp/fee-value-batch";
import { prisma } from "@/lib/prisma";
import { feeValueReader } from "@/lib/treasury/fee-values";
import { ApplyBatch } from "./apply-batch";

export const dynamic = "force-dynamic";
export const metadata = { title: "Valores de cuota — SIGeV" };

// El valor vigente, su historial, y el lote REG-34.
//
// La pantalla tiene DOS niveles de permiso a propósito: el admin común entra a
// ver con qué se está cobrando y qué suscripciones quedaron atrás (es consulta),
// pero aplicar el valor lo hace el superadmin, porque esa es la única escritura
// del sistema que le cambia a un vecino cuánto le van a debitar de la tarjeta.
// La autorización REAL vuelve a hacerse dentro de la action: acá el
// `requireSuperadmin` sólo decide qué se dibuja.
//
// Los importes van en font-mono + tabular-nums para que las columnas alineen.
export default async function ValoresPage() {
  const [actor, sa] = await Promise.all([requireAdmin(), requireSuperadmin()]);
  if (!actor.ok) return <FormMessage kind="error" box>{actor.error}</FormMessage>;
  const superadmin = sa.ok;

  const [current, history] = await Promise.all([feeValueReader.current(), feeValueReader.history()]);
  // Sin valor vigente no hay con qué comparar: la lista queda vacía y el
  // mensaje de arriba ya dice que no rige ninguno.
  const divergent = current ? await listDivergent(prisma, current) : [];

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Socio activo</CardTitle></CardHeader>
          <CardContent className="font-mono text-3xl tabular-nums">
            {current ? formatARS(current.activeAmount) : "—"}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Adherente / colaborador</CardTitle></CardHeader>
          <CardContent className="font-mono text-3xl tabular-nums">
            {current ? formatARS(current.sharedAmount) : "—"}
          </CardContent>
        </Card>
      </div>
      <p className="text-sm text-muted-foreground">
        {current ? `Vigente desde ${formatDateAR(current.validFrom)}.` : "Todavía no rige ningún valor."}{" "}
        El valor nuevo se registra desde Configuración (solo superadmin). Las suscripciones de
        Mercado Pago no cambian solas: se actualizan desde acá con el lote.
      </p>
      <Button asChild variant="outline"><Link href="/admin/configuracion">Ir a Configuración</Link></Button>
      {history.length === 0 ? (
        <EmptyState description="Sin historial de valores de cuota." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Rige desde</TableHead>
              <TableHead>Activo</TableHead>
              <TableHead>Adherente / colaborador</TableHead>
              <TableHead>Acta</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {history.map((h) => (
              <TableRow key={h.id}>
                <TableCell>{formatDateAR(h.validFrom)}</TableCell>
                <TableCell className="font-mono tabular-nums">{formatARS(h.activeAmount)}</TableCell>
                <TableCell className="font-mono tabular-nums">{formatARS(h.sharedAmount)}</TableCell>
                <TableCell>
                  {h.minuteId ? (
                    <Link className="text-primary hover:underline" href={`/admin/actas/${h.minuteId}`}>
                      Acta #{h.minuteId}
                    </Link>
                  ) : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <section className="space-y-3 border-t pt-6" aria-labelledby="lote-title">
        <h2 id="lote-title" className="text-sm font-semibold tracking-widest text-muted-foreground uppercase">
          Suscripciones con monto distinto al vigente
        </h2>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Las suscripciones de Mercado Pago llevan el monto copiado: no siguen al valor de cuota.
          Estas son las que hoy cobran otra cosa, según la última sincronización del cron diario.
        </p>
        <ApplyBatch
          superadmin={superadmin}
          divergent={divergent.map((d) => ({
            preapprovalId: d.preapprovalId,
            memberId: d.memberId,
            fullName: d.fullName,
            categoryLabel: CATEGORY_LABELS[d.category],
            statusLabel: STATUS_LABELS[d.status],
            statusVariant: memberStatusBadgeVariant(d.status),
            withdrawn: d.status === "withdrawn",
            currentLabel: d.current === null ? null : formatARS(d.current),
            expectedLabel: formatARS(d.expected),
          }))}
        />
      </section>
    </div>
  );
}
