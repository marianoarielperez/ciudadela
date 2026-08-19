import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatDateAR } from "@/lib/format";
import { MINUTE_TYPE_LABELS } from "@/lib/members/labels";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const dynamic = "force-dynamic";

export const metadata = { title: "Actas — SIGeV" };

export default async function ActasPage() {
  const minutes = await prisma.minute.findMany({
    orderBy: [{ date: "desc" }, { number: "desc" }],
    include: { _count: { select: { movements: true } } },
  });
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Actas</h1>
        <Button asChild><Link href="/admin/actas/nueva">Nueva acta</Link></Button>
      </div>
      {minutes.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Todavía no hay actas cargadas. Las acciones societarias (altas, bajas, cambios de
          categoría) se asientan siempre en un acta.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tipo</TableHead><TableHead>N°</TableHead><TableHead>Fecha</TableHead>
              <TableHead>Descripción</TableHead><TableHead>Movimientos</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {minutes.map((m) => (
              <TableRow key={m.id}>
                <TableCell>{MINUTE_TYPE_LABELS[m.type]}</TableCell>
                <TableCell>
                  <Link className="text-primary hover:underline" href={`/admin/actas/${m.id}`}>{m.number}</Link>
                </TableCell>
                <TableCell>{formatDateAR(m.date)}</TableCell>
                <TableCell>{m.description ?? "—"}</TableCell>
                <TableCell>{m._count.movements}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
