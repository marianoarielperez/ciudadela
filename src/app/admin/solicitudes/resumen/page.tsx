import { prisma } from "@/lib/prisma";
import { formatDateAR } from "@/lib/format";
import { requireAdmin } from "@/lib/auth/require-admin";
import {
  formatMonthParam, makeSummaryQueries, monthLabelAR, monthRangeUtc, parseMonthParam,
  reentryLabel, type SummaryRow,
} from "@/lib/applications/summary";
import { CATEGORY_LABELS } from "@/lib/members/labels";
import { EmptyState } from "@/components/admin/empty-state";
import { FormMessage } from "@/components/admin/form-message";
import { PageHeader } from "@/components/admin/page-header";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { PrintButton } from "./print-button";

export const dynamic = "force-dynamic";

export const metadata = { title: "Resumen para acta — SIGeV" };

export default async function ResumenPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // La página se autoriza a sí misma aunque `admin/layout.tsx` ya bloquee: es
  // una hoja imprimible con nombres y DNIs de gente que todavía no es socia
  // (Ley 25.326), y `requireAdmin` resuelve contra la fila viva de User — el
  // layout mira el token, que puede estar hasta 8 h desactualizado.
  const actor = await requireAdmin();
  if (!actor.ok) {
    return (
      <div className="space-y-4">
        <PageHeader title="Resumen para acta" />
        <FormMessage kind="error" box>{actor.error}</FormMessage>
      </div>
    );
  }

  const sp = await props.searchParams;
  const month = parseMonthParam(sp.mes, new Date());
  const monthValue = formatMonthParam(month);
  const range = monthRangeUtc(month.year, month.month);
  const { accepted, pendingBoard, recordedInMonth } =
    await makeSummaryQueries(prisma).fetchSummary(range);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Resumen para acta"
        breadcrumb={[
          { label: "Solicitudes", href: "/admin/solicitudes" },
          { label: "Resumen" },
        ]}
        actions={
          <>
            {/* Form GET y no un onChange: la pantalla es un server component y
                el mes viaja en la URL, así que el link "Exportar Excel" y el
                botón de imprimir siempre hablan del mismo mes que se ve. */}
            <form method="get" className="flex flex-wrap items-center gap-2 print:hidden">
              <label htmlFor="mes" className="text-sm text-muted-foreground">Mes</label>
              <input
                id="mes" type="month" name="mes" defaultValue={monthValue}
                className="h-9 rounded-md border px-2 text-sm"
              />
              <Button type="submit" variant="secondary">Ver</Button>
            </form>
            <Button asChild variant="outline" className="print:hidden">
              <a href={`/api/admin/solicitudes/resumen-export?mes=${monthValue}`}>Exportar Excel</a>
            </Button>
            <PrintButton />
          </>
        }
      />

      {/* La hoja impresa no lleva encabezado del navegador que diga de qué se
          trata: el subtítulo es lo que le explica a quien la lee en la reunión
          por qué dos listas no tienen mes y una sí. */}
      <p className="max-w-prose text-sm text-muted-foreground">
        Las dos primeras listas son las que la próxima reunión tiene que tratar: van
        completas, sin filtro de mes. La tercera reconstruye lo asentado en un mes ya
        cerrado.
      </p>

      <Section
        title="Aceptadas pendientes de asiento"
        caption="Cumplieron los requisitos y pagaron: falta asentarlas en acta (REG-11)."
        empty="No hay solicitudes aceptadas esperando asiento."
        rows={accepted}
      />

      <Section
        title="Pendientes de decisión de la Comisión Directiva"
        caption="Requieren que la Comisión resuelva antes de asentarlas o rechazarlas."
        empty="No hay solicitudes esperando decisión de la Comisión."
        rows={pendingBoard}
      />

      <Section
        title={`Asentadas en ${monthLabelAR(month)}`}
        caption="Altas y reingresos ya volcados al Libro de Socios en el mes elegido."
        empty={`No se asentó ninguna solicitud en ${monthLabelAR(month)}.`}
        rows={recordedInMonth}
        recorded
      />
    </div>
  );
}

function Section({ title, caption, empty, rows, recorded = false }: {
  title: string;
  caption: string;
  empty: string;
  rows: SummaryRow[];
  recorded?: boolean;
}) {
  return (
    // `break-inside-avoid` no se puede pedir para una tabla larga (partiría
    // igual), pero sí evita que el encabezado de la sección quede huérfano al
    // pie de una hoja separado de sus filas.
    <section className="space-y-2">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight">
          {title}
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            {rows.length === 1 ? "1 solicitud" : `${rows.length} solicitudes`}
          </span>
        </h2>
        <p className="text-sm text-muted-foreground">{caption}</p>
      </div>
      {/* Nunca un thead sin filas (normativa del shell). */}
      {rows.length === 0 ? (
        <EmptyState size="card" description={empty} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Apellido y nombre</TableHead>
              <TableHead>DNI</TableHead>
              <TableHead>Categoría</TableHead>
              <TableHead>Débito</TableHead>
              <TableHead>Reingreso</TableHead>
              <TableHead>{recorded ? "Asentada" : "Solicitud"}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>{row.fullName}</TableCell>
                <TableCell>{row.dni}</TableCell>
                <TableCell>{CATEGORY_LABELS[row.requestedCategory]}</TableCell>
                <TableCell>{row.wantsDebit ? "Sí" : "No"}</TableCell>
                {/* "—" y no "No": ver `reentryLabel`. En las asentadas sin
                    movimiento que lo respalde, el sistema NO sabe si fue alta o
                    reingreso, y afirmarlo en un acta sería inventarlo. */}
                <TableCell>{reentryLabel(row.reentry)}</TableCell>
                <TableCell>{formatDateAR(row.decidedAt ?? row.createdAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
