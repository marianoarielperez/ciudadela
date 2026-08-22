import Link from "next/link";

import { EmptyState } from "@/components/admin/empty-state";
import { FormMessage } from "@/components/admin/form-message";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { requireAdmin } from "@/lib/auth/require-admin";
import { formatARS, formatDateAR } from "@/lib/format";
import { feeValueReader } from "@/lib/treasury/fee-values";

export const dynamic = "force-dynamic";
export const metadata = { title: "Valores de cuota — SIGeV" };

// Pantalla de LECTURA: el valor nuevo se registra en Configuración, que es de
// superadmin. Acá entra el admin común a ver con qué se está cobrando.
// Los importes van en font-mono + tabular-nums para que las columnas alineen.
export default async function ValoresPage() {
  const actor = await requireAdmin();
  if (!actor.ok) return <FormMessage kind="error" box>{actor.error}</FormMessage>;
  const [current, history] = await Promise.all([feeValueReader.current(), feeValueReader.history()]);

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
        El valor nuevo se registra desde Configuración (solo superadmin). La aplicación del valor a las
        suscripciones de Mercado Pago llega con la siguiente fase.
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
    </div>
  );
}
