import Link from "next/link";
import { activitiesQueries } from "@/lib/activities/query";
import { ROOM_LABELS, WEEKDAYS } from "@/lib/activities/rules";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DeleteActivityButton } from "./activity-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Actividades — SIGeV" };

const DAY_SHORT = new Map(WEEKDAYS.map(([d, l]) => [d, l.slice(0, 3)]));

// Firma explícita, como el resto de las páginas del panel: el tipo global
// `PageProps<"...">` solo existe después de que Next genera los tipos de rutas,
// así que `tsc --noEmit` en frío no lo encuentra.
export default async function AdminActivitiesPage(props: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await props.searchParams;
  const yearRaw = typeof sp.year === "string" && sp.year !== "" ? Number(sp.year) : undefined;
  // Un año basura en la query (?year=abc) filtra por nada en vez de reventar el
  // findMany: la pantalla del panel no es un endpoint que valga la pena hacer
  // fallar por un parámetro mal tipeado a mano.
  const year = yearRaw !== undefined && Number.isInteger(yearRaw) ? yearRaw : undefined;
  const rows = await activitiesQueries.allForAdmin(year);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Actividades de los salones</h1>
        <Button asChild>
          <Link href="/admin/actividades/nueva">Nueva actividad</Link>
        </Button>
      </div>
      {/* Filtro sin JS: un GET nativo, igual que el resto de los filtros del panel. */}
      <form method="get" className="flex items-end gap-2">
        <div className="space-y-1">
          <label htmlFor="year" className="block text-sm font-medium">
            Año
          </label>
          <input
            id="year"
            name="year"
            type="number"
            inputMode="numeric"
            defaultValue={year ?? ""}
            placeholder="Todos"
            className="h-9 w-28 rounded-md border bg-transparent px-2 text-sm shadow-xs"
          />
        </div>
        <Button type="submit" variant="outline">
          Filtrar
        </Button>
        {year !== undefined && (
          <Button asChild variant="ghost">
            <Link href="/admin/actividades">Ver todos</Link>
          </Button>
        )}
      </form>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No hay actividades cargadas{year !== undefined ? ` para ${year}` : ""}. Las activas se
          muestran en la página pública de actividades.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Actividad</TableHead>
              <TableHead>Salón</TableHead>
              <TableHead>Días</TableHead>
              <TableHead>Horario</TableHead>
              <TableHead>Año</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>
                <span className="sr-only">Acciones</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((a) => (
              <TableRow key={a.id}>
                <TableCell>
                  <Link
                    className="text-primary hover:underline"
                    href={`/admin/actividades/${a.id}`}
                  >
                    {a.name}
                  </Link>
                </TableCell>
                <TableCell>{ROOM_LABELS[a.room]}</TableCell>
                <TableCell>{a.weekdays.map((d) => DAY_SHORT.get(d) ?? d).join(", ")}</TableCell>
                <TableCell>
                  {a.startTime}–{a.endTime}
                </TableCell>
                <TableCell>{a.year}</TableCell>
                <TableCell>
                  <Badge variant={a.active ? "default" : "secondary"}>
                    {a.active ? "Activa" : "Oculta"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <DeleteActivityButton id={a.id} name={a.name} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
