// Pestaña "Histórico": toda persona que alguna vez pasó por la vecinal —las
// vigentes y las 119 bajas—, con su recorrido por los libros y con el veredicto
// de reingreso. Ese veredicto es el motivo de la pantalla: hasta acá, "¿este
// señor puede volver a asociarse?" se contestaba cruzando a mano el motivo de
// baja, la fecha del último rechazo y la deuda de la cuenta corriente, tres
// datos que viven en tres lugares distintos.
//
// Una tarjeta por persona, apiladas (molde `RequestCard`) y NO una tabla: lo que
// se lee de cada fila es un párrafo con fechas y un veredicto en palabras, no
// siete columnas comparables entre sí. A 375px una tabla de eso se navega
// empujando la pantalla de costado.
import Link from "next/link";

import { EmptyState } from "@/components/admin/empty-state";
import { FormMessage } from "@/components/admin/form-message";
import { PageHeader } from "@/components/admin/page-header";
import { PaginationNav } from "@/components/admin/pagination-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SELECT_CLASS } from "@/lib/admin/field-styles";
import { INLINE_LINK } from "@/lib/admin/link-styles";
import { pageHref, parsePage } from "@/lib/admin/pagination";
import { memberStatusBadgeVariant, type BadgeVariant } from "@/lib/admin/status-badges";
import { requireAdmin } from "@/lib/auth/require-admin";
import { formatDateAR } from "@/lib/format";
import {
  fetchHistoryPage, HISTORY_PAGE_SIZE, parseHistoryFilters, reentryVerdict,
  type HistoryRow, type ReentryVerdict,
} from "@/lib/members/history";
import { CATEGORY_LABELS, REASON_LABELS, STATUS_LABELS } from "@/lib/members/labels";
import { prisma } from "@/lib/prisma";
import { appealWindowOpen } from "@/lib/reregistration/withdrawals";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const metadata = { title: "Histórico — SIGeV" };

const BASE = "/admin/socios/historico";

/** El chip de reingreso, en palabras. El color nunca es el único canal: cada
 *  veredicto se lee entero aunque el badge se vea gris. El socio vigente no
 *  lleva chip — la pregunta no aplica, y un "no corresponde" en cada tarjeta
 *  del padrón sería ruido en las dos terceras partes de la lista. El fallecido
 *  tampoco: la pregunta no aplica igual que en el vigente, y el dato ya está en
 *  la línea de abajo ("egreso · Fallecimiento"). La ficha anulada por duplicado
 *  va por el mismo camino y por el mismo motivo: no es una persona que pueda
 *  reasociarse —su gemela viva está en el padrón y el wizard la manda a la sede,
 *  `eligibility.ts:71`— y su línea de abajo ya dice "Anulación por duplicado".
 *  Lo que no podía seguir es el chip verde: la pantalla no puede decir "sí"
 *  donde la puerta real dice "no". */
function reentryChip(v: ReentryVerdict, pendingFees: number):
  { variant: BadgeVariant; text: string } | null {
  switch (v.kind) {
    case "member":
    case "deceased":
    case "annulled":
      return null;
    case "blocked_forever":
      return { variant: "destructive", text: "No puede reingresar" };
    case "blocked_until":
      return { variant: "outline", text: `Puede reintentar desde el ${formatDateAR(v.until)}` };
    case "must_settle":
      // El plural se calcula, como en `canChangeCategory` (`rules.ts:28`): "Debe
      // saldar 1 cuotas" es el caso más común de una sola cuota impaga.
      return {
        variant: "outline",
        text: `Debe saldar ${pendingFees} ${pendingFees === 1 ? "cuota" : "cuotas"} para reingresar`,
      };
    case "clear":
      return { variant: "success", text: "Puede reasociarse" };
  }
}

function PersonCard({ row, now }: { row: HistoryRow; now: Date }) {
  const chip = reentryChip(reentryVerdict({ ...row, now }), row.pendingFees);
  const withdrawn = row.status === "withdrawn";

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle as="h2" className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <Link className={INLINE_LINK} href={`/admin/socios/${row.id}`}>{row.fullName}</Link>
          <span className="flex flex-wrap items-center gap-1">
            <Badge variant={memberStatusBadgeVariant(row.status)}>{STATUS_LABELS[row.status]}</Badge>
            {chip && <Badge variant={chip.variant}>{chip.text}</Badge>}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        <p className="text-sm text-muted-foreground">
          {/* Sólo la cifra va en mono: con la palabra adentro el espacio queda
              tabulado y se abre un hueco entre "N°" y el número. */}
          <span className="font-mono">{row.dni ?? "sin DNI"}</span>
          {row.memberships.map((m) => (
            <span key={m.bookNumber}>
              {" · "}
              Libro <span className="font-mono tabular-nums">{m.bookNumber}</span>
              {" · N° "}
              <span className="font-mono tabular-nums">{m.memberNumber}</span>
            </span>
          ))}
          {/* Sin ninguna membresía la persona existe igual: es el lapso del
              cierre de libro (REG-28) en que todavía no fue asentada, o una
              ficha creada a mano antes de asentarla. */}
          {row.memberships.length === 0 && " · sin libro"}
          {" · "}
          {CATEGORY_LABELS[row.category]}
        </p>
        <p className="text-sm text-muted-foreground">
          Ingreso {formatDateAR(row.joinedAt)}
          {withdrawn && (
            <>
              {" · egreso "}
              {row.leftAt ? formatDateAR(row.leftAt) : "sin fecha"}
              {row.withdrawalReason && ` · ${REASON_LABELS[row.withdrawalReason]}`}
            </>
          )}
        </p>
        {/* La ventana de recurso del Art. 9° bis d), mientras siga abierta. Acá
            —y no sólo en la ficha— porque el Histórico es la lista donde el
            operador busca a quien viene a preguntar por su baja: si el plazo
            corre, tiene que verse antes de abrir la ficha. Quién decide si sigue
            abierta es `appealWindowOpen`, que comparte el comparador de plazos
            del módulo (el último día lo tiene entero). */}
        {appealWindowOpen(row.appealUntil) && row.appealUntil && (
          <FormMessage kind="neutral" role="none">
            {`Baja recurrible hasta el ${formatDateAR(row.appealUntil)} inclusive.`}
          </FormMessage>
        )}
      </CardContent>
    </Card>
  );
}

export default async function HistoricoPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // La pantalla se autoriza a sí misma aunque `admin/layout.tsx` ya bloquee, por
  // el mismo motivo que la pestaña Libros: acá se muestran nombres, DNIs y
  // motivos de baja de gente que YA NO es socia (Ley 25.326), y `requireAdmin`
  // resuelve contra la fila viva de `User` mientras que el layout mira el token,
  // que puede estar hasta 8 h desactualizado tras una degradación de rol.
  const actor = await requireAdmin();
  if (!actor.ok) {
    return (
      <div className="space-y-4">
        <PageHeader title="Histórico" />
        <FormMessage kind="error" box>{actor.error}</FormMessage>
      </div>
    );
  }

  const sp = await props.searchParams;
  const filters = parseHistoryFilters(sp);
  const { rows, total, page, pageCount } = await fetchHistoryPage(prisma, filters, parsePage(sp));
  const hasFilters = Object.keys(filters).length > 0;
  // Una sola marca de tiempo para toda la página: con `new Date()` por tarjeta,
  // dos veredictos de la misma pantalla podrían mirar días distintos justo a la
  // medianoche.
  const now = new Date();
  const firstShown = (page - 1) * HISTORY_PAGE_SIZE + 1;
  const lastShown = (page - 1) * HISTORY_PAGE_SIZE + rows.length;

  return (
    <div className="space-y-4">
      <PageHeader title="Histórico">
        <p className="text-sm text-muted-foreground">
          Todas las personas que pasaron por la vecinal, con su recorrido y si pueden reasociarse.
        </p>
      </PageHeader>

      {/* GET plano, como el resto del panel: el filtro queda en la URL y se
          puede compartir, recargar y volver con el botón atrás. Los `name` son
          el contrato de `parseHistoryFilters` y no se tocan. */}
      <form className="flex flex-wrap items-end gap-2" method="get">
        <Input
          name="q"
          placeholder="Nombre o DNI"
          defaultValue={filters.q ?? ""}
          aria-label="Nombre o DNI"
          className="w-full sm:w-56"
        />
        <select
          name="status"
          defaultValue={filters.status ?? ""}
          className={cn(SELECT_CLASS, "max-w-full")}
          aria-label="Estado"
        >
          <option value="">Estado (todos)</option>
          {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select
          name="reason"
          defaultValue={filters.reason ?? ""}
          className={cn(SELECT_CLASS, "max-w-full")}
          aria-label="Motivo de baja"
        >
          <option value="">Motivo de baja (todos)</option>
          {Object.entries(REASON_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <Button type="submit" variant="secondary">Filtrar</Button>
      </form>

      {total === 0 ? (
        <EmptyState
          size="list"
          description={
            hasFilters
              ? "Ninguna persona coincide con estos filtros."
              : "Todavía no hay ninguna persona registrada."
          }
          action={
            hasFilters
              ? <Button asChild variant="outline"><Link href={BASE}>Limpiar filtros</Link></Button>
              : undefined
          }
        />
      ) : (
        <>
          {/* El total es el del histórico filtrado, no el de la página: el
              operador tiene que poder leer "279 personas" aunque en pantalla
              haya 50. */}
          <p className="text-sm text-muted-foreground">
            {`${firstShown}–${lastShown} de ${total} ${total === 1 ? "persona" : "personas"}`}
            {pageCount > 1 && ` · página ${page} de ${pageCount}`}
          </p>

          <div className="space-y-3">
            {rows.map((row) => <PersonCard key={row.id} row={row} now={now} />)}
          </div>
        </>
      )}

      <PaginationNav
        page={page}
        pageCount={pageCount}
        href={(n) => pageHref(BASE, filters, n)}
        label="Páginas del histórico"
      />
    </div>
  );
}
