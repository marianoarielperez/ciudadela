// La bandeja sin conciliar (spec 4B §7): plata que Mercado Pago ya cobró y que
// el sistema no pudo atribuirle a nadie. Es la ÚNICA superficie donde ese
// dinero aparece — si no está acá, no está en ningún lado — así que la pantalla
// arranca por el número que importa (cuánto hay sin atribuir) y no por el
// recuento de filas: cada pendiente es un vecino que pagó y todavía no tiene
// recibo.
//
// El encabezado NO se escribe acá: lo pone el layout de Tesorería. La guarda
// tampoco se hereda de él (Next renderiza layout y página en paralelo).
import Link from "next/link";
import { INLINE_LINK } from "@/lib/admin/link-styles";
import type { Prisma } from "@/generated/prisma/client";
import { EmptyState } from "@/components/admin/empty-state";
import { FormMessage } from "@/components/admin/form-message";
import { PaginationNav } from "@/components/admin/pagination-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { pageHref, paginate, parsePage } from "@/lib/admin/pagination";
import { unmatchedStatusBadgeVariant } from "@/lib/admin/status-badges";
import { UNMATCHED_REASON_LABELS, UNMATCHED_STATUS_LABELS } from "@/lib/admin/unmatched-labels";
import { requireAdmin } from "@/lib/auth/require-admin";
import { formatARS, formatDateAR } from "@/lib/format";
import type { UnmatchedReason } from "@/lib/mp/unmatched";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sin conciliar — SIGeV" };

const BASE = "/admin/tesoreria/sin-conciliar";
const PAGE_SIZE = 50;

export default async function SinConciliarPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireAdmin();
  if (!actor.ok) return <FormMessage kind="error" box>{actor.error}</FormMessage>;
  const sp = await props.searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  // La bandeja tiene exactamente dos vidas —espera una decisión o ya la tuvo—,
  // así que el filtro son dos links y no un <select>: el estado actual se lee
  // sin desplegar nada y cada vista tiene su propia URL para compartir.
  const resolved = one(sp.estado) === "resueltos";
  // "Resueltos" es todo lo que ya tuvo una decisión, y desde la tarea 8B son
  // TRES: aplicado a un socio, registrado como ingreso no societario, o
  // descartado. Sin el tercero en la lista, esas filas desaparecían de las dos
  // vistas y la bandeja perdía el rastro de plata que sí entró.
  const where: Prisma.MpUnmatchedPaymentWhereInput = resolved
    ? { status: { in: ["matched", "dismissed", "other_income"] } }
    : { status: "open" };

  const total = await prisma.mpUnmatchedPayment.count({ where });
  // El total en pesos se calcula sólo en Pendientes: es plata cobrada sin
  // recibo, y una fila ya resuelta dejó de serlo. Sobre TODO el filtro y no
  // sobre la página: la cifra sería mentira si dependiera de dónde está parado
  // el operador.
  const pendingSum = resolved || total === 0
    ? 0
    : Number((await prisma.mpUnmatchedPayment.aggregate({ where, _sum: { amount: true } }))._sum?.amount ?? 0);

  const pg = paginate(total, parsePage(sp), PAGE_SIZE);
  const rows = await prisma.mpUnmatchedPayment.findMany({
    where,
    // Pendientes por fecha de cobro (lo más reciente arriba, que es lo que el
    // operador todavía puede reconocer); resueltos por cuándo se resolvieron.
    orderBy: resolved ? { resolvedAt: "desc" } : { paidAt: "desc" },
    skip: pg.skip,
    take: pg.take,
    include: {
      payment: {
        // Se trae lo que la tabla muestra y nada más: a quién se le aplicó y con
        // qué recibo.
        select: {
          memberId: true,
          member: { select: { fullName: true } },
          receipt: { select: { id: true, number: true } },
        },
      },
    },
  });
  // Qué se registró como ingreso no societario, para la columna "Aplicado a".
  // La unión con `other_incomes` es el `mpPaymentId` (único en las dos tablas) y
  // no una FK: el módulo de ingresos es independiente del núcleo de plata. Sólo
  // para las filas de ESTA página, y sólo en Resueltos.
  const incomeIds = resolved ? rows.filter((r) => r.status === "other_income").map((r) => r.mpPaymentId) : [];
  const incomes = incomeIds.length
    ? new Map(
        (await prisma.otherIncome.findMany({
          where: { mpPaymentId: { in: incomeIds } },
          select: { mpPaymentId: true, concept: true },
        })).map((i) => [i.mpPaymentId, i.concept]),
      )
    : new Map<string | null, string>();
  const params = { estado: resolved ? "resueltos" : undefined };

  const tabs = [
    { href: BASE, label: "Pendientes", active: !resolved },
    { href: `${BASE}?estado=resueltos`, label: "Resueltos", active: resolved },
  ];

  return (
    <div className="space-y-4">
      <nav aria-label="Estado de la bandeja" className="flex w-fit gap-1 rounded-lg bg-muted p-1">
        {tabs.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            aria-current={t.active ? "page" : undefined}
            className={`inline-flex min-h-11 items-center rounded-md px-4 text-sm font-medium outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-ring ${
              t.active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {total === 0 ? (
        // Nunca un thead sin filas. Y el vacío de Pendientes es la BUENA
        // noticia: no ofrece ninguna acción porque no hay nada que resolver.
        <EmptyState
          description={
            resolved
              ? "Todavía no se resolvió ninguna fila."
              : "No hay pagos sin conciliar. Todo lo que llegó de Mercado Pago se aplicó solo."
          }
          action={
            resolved
              ? <Button asChild variant="outline"><Link href={BASE}>Ver pendientes</Link></Button>
              : undefined
          }
        />
      ) : (
        <>
          {resolved ? (
            <p className="text-sm text-muted-foreground">
              {total} {total === 1 ? "fila resuelta" : "filas resueltas"}
              {pg.pageCount > 1 && ` · página ${pg.page} de ${pg.pageCount}`}
            </p>
          ) : (
            // El titular de la pantalla es la plata, no el recuento de tareas:
            // lo primero que pregunta un tesorero es cuánto hay sin atribuir.
            <p className="text-sm text-muted-foreground">
              <span className="font-mono text-2xl font-semibold tabular-nums text-foreground">
                {formatARS(pendingSum)}
              </span>{" "}
              cobrados por Mercado Pago y todavía sin atribuir, en {total} {total === 1 ? "pago" : "pagos"}
              {pg.pageCount > 1 && ` · página ${pg.page} de ${pg.pageCount}`}.
            </p>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cobrado</TableHead>
                <TableHead className="text-right">Importe</TableHead>
                <TableHead>Pagador</TableHead>
                <TableHead>Referencia</TableHead>
                <TableHead>Motivo</TableHead>
                <TableHead>Estado</TableHead>
                {/* Sólo en Resueltos: en Pendientes no hay a quién mostrar todavía,
                    y una columna de guiones no dice nada. Revisar lo ya
                    conciliado es justamente preguntarse a quién fue a parar. */}
                {resolved && <TableHead>Aplicado a</TableHead>}
                <TableHead><span className="sr-only">Acción</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{formatDateAR(r.paidAt)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatARS(Number(r.amount))}</TableCell>
                  {/* El email del pagador es dato personal (Ley 25.326): se
                      muestra sólo acá, que es panel de admin, y nunca viaja a
                      la auditoría ni al log. Suele ser la única pista de quién
                      pagó, así que es la columna que el operador lee primero. */}
                  <TableCell className="max-w-[14rem] truncate" title={r.payerEmail ?? undefined}>
                    {r.payerEmail ?? "—"}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{r.externalReference ?? "—"}</TableCell>
                  <TableCell>{UNMATCHED_REASON_LABELS[r.reason as UnmatchedReason] ?? r.reason}</TableCell>
                  <TableCell>
                    <Badge variant={unmatchedStatusBadgeVariant(r.status)}>{UNMATCHED_STATUS_LABELS[r.status]}</Badge>
                    {r.payment?.receipt && (
                      <Link
                        className="ml-2 font-mono text-xs text-primary outline-hidden hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                        href={`/admin/tesoreria/recibos/${r.payment.receipt.id}`}
                      >
                        {r.payment.receipt.number}
                      </Link>
                    )}
                  </TableCell>
                  {resolved && (
                    <TableCell>
                      {r.payment?.memberId ? (
                        <Link
                          className={INLINE_LINK}
                          href={`/admin/socios/${r.payment.memberId}?tab=cuenta`}
                        >
                          {r.payment.member?.fullName ?? `Socio ${r.payment.memberId}`}
                        </Link>
                      ) : r.status === "other_income" ? (
                        // No hay socio, pero tampoco es un guión: la plata entró
                        // y es de la vecinal. Lo que va acá es a qué corresponde,
                        // que es lo único que la explica.
                        <span className="text-muted-foreground">
                          {incomes.get(r.mpPaymentId) ?? "Ingreso no societario"}
                        </span>
                      ) : (
                        // Una fila descartada no se le aplicó a nadie, y eso es
                        // exactamente lo que declara el descarte.
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  )}
                  <TableCell>
                    <Link
                      className="inline-flex min-h-11 items-center text-primary outline-hidden hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                      href={`${BASE}/${r.id}`}
                    >
                      {r.status === "open" ? "Resolver" : "Ver"}
                      {/* Siete filas con el mismo link "Resolver" son siete
                          destinos idénticos para un lector de pantalla: el
                          sufijo oculto dice cuál es cuál. */}
                      <span className="sr-only">
                        {" "}el cobro de {formatARS(Number(r.amount))} del {formatDateAR(r.paidAt)}
                      </span>
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <PaginationNav
            page={pg.page}
            pageCount={pg.pageCount}
            href={(n) => pageHref(BASE, params, n)}
            label="Páginas de la bandeja"
          />
        </>
      )}
    </div>
  );
}
