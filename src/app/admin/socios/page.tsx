import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { fetchPadron, parsePadronFilters } from "@/lib/members/query";
import { CATEGORY_LABELS, EMAIL_STATUS_LABELS, STATUS_LABELS } from "@/lib/members/labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";

export const metadata = { title: "Socios — SIGeV" };

export default async function SociosPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await props.searchParams;
  const filters = parsePadronFilters(sp);
  const rows = await fetchPadron(prisma, filters);
  const exportQs = new URLSearchParams(
    Object.entries(filters).map(([k, v]) => [k, String(v)]),
  ).toString();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Socios — Libro 1</h1>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <a href={`/api/admin/padron-export?${exportQs}`}>Exportar Excel</a>
          </Button>
          <Button asChild><Link href="/admin/socios/nuevo">Alta manual</Link></Button>
        </div>
      </div>

      <form className="flex flex-wrap items-end gap-2" method="get">
        <Input name="q" placeholder="Nombre, DNI o número" defaultValue={filters.q ?? ""} className="w-56" />
        <select name="category" defaultValue={filters.category ?? ""} className="h-9 rounded-md border px-2 text-sm">
          <option value="">Categoría (todas)</option>
          {Object.entries(CATEGORY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select name="status" defaultValue={filters.status ?? ""} className="h-9 rounded-md border px-2 text-sm">
          <option value="">Estado (todos)</option>
          {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select name="email" defaultValue={filters.email ?? ""} className="h-9 rounded-md border px-2 text-sm">
          <option value="">Email (todos)</option>
          <option value="con">Con email</option>
          <option value="sin">Sin email</option>
          <option value="verificado">Verificado</option>
        </select>
        <select name="dni" defaultValue={filters.dni ?? ""} className="h-9 rounded-md border px-2 text-sm">
          <option value="">DNI (todos)</option>
          <option value="con">Con DNI</option>
          <option value="sin">Sin DNI</option>
        </select>
        <Button type="submit" variant="secondary">Filtrar</Button>
      </form>

      <p className="text-sm text-muted-foreground">{rows.length} socios</p>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>N°</TableHead><TableHead>Apellido y nombre</TableHead>
            <TableHead>DNI</TableHead><TableHead>Categoría</TableHead>
            <TableHead>Estado</TableHead><TableHead>Email</TableHead>
            <TableHead>Débito</TableHead><TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ memberNumber, member }) => (
            <TableRow key={member.id}>
              <TableCell>{memberNumber}</TableCell>
              <TableCell>
                <Link className="hover:underline" href={`/admin/socios/${member.id}`}>{member.fullName}</Link>
              </TableCell>
              <TableCell>{member.dni ?? "—"}</TableCell>
              <TableCell>{CATEGORY_LABELS[member.category]}</TableCell>
              <TableCell>
                <Badge variant={member.status === "active" ? "default" : member.status === "suspended" ? "secondary" : "outline"}>
                  {STATUS_LABELS[member.status]}
                </Badge>
                {member.status === "withdrawn" && member.debtAtWithdrawal && (
                  <Badge variant="destructive" className="ml-1">Deuda</Badge>
                )}
              </TableCell>
              <TableCell>
                {member.email ? `${member.email} · ${EMAIL_STATUS_LABELS[member.emailStatus]}` : "—"}
              </TableCell>
              <TableCell>{member.autoDebit ? "Sí" : "No"}</TableCell>
              <TableCell>
                <Link className="text-sm text-primary hover:underline" href={`/admin/socios/carga/${memberNumber}`}>
                  Cargar ficha
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
