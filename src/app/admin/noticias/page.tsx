import Link from "next/link";
import { newsQueries } from "@/lib/news/query";
import { formatDateAR } from "@/lib/format";
import { NEWS_STATUS_LABELS } from "@/lib/news/labels";
import { newsStatusBadgeVariant } from "@/lib/admin/status-badges";
import { EmptyState } from "@/components/admin/empty-state";
import { PageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const dynamic = "force-dynamic";
export const metadata = { title: "Noticias — SIGeV" };

export default async function AdminNewsPage() {
  const rows = await newsQueries.allForAdmin();
  return (
    <div className="space-y-4">
      <PageHeader
        title="Noticias"
        actions={
          <Button asChild>
            <Link href="/admin/noticias/nueva">Nueva noticia</Link>
          </Button>
        }
      />
      {rows.length === 0 ? (
        <EmptyState
          description="Todavía no hay noticias. Las publicadas aparecen en la portada del sitio y en /noticias."
          action={
            <Button asChild>
              <Link href="/admin/noticias/nueva">Nueva noticia</Link>
            </Button>
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Título</TableHead><TableHead>Estado</TableHead>
              <TableHead>Publicada</TableHead><TableHead>Autor/a</TableHead>
              <TableHead><span className="sr-only">Acciones</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((n) => (
              <TableRow key={n.id}>
                <TableCell>
                  <Link className="text-primary hover:underline" href={`/admin/noticias/${n.id}`}>{n.title}</Link>
                </TableCell>
                <TableCell>
                  <Badge variant={newsStatusBadgeVariant(n.status)}>{NEWS_STATUS_LABELS[n.status]}</Badge>
                </TableCell>
                <TableCell>{n.publishedAtIso ? formatDateAR(new Date(n.publishedAtIso)) : "—"}</TableCell>
                <TableCell>{n.authorName ?? "—"}</TableCell>
                <TableCell>
                  <Link className="text-sm text-primary hover:underline" href={`/admin/noticias/${n.id}`}>Editar</Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
