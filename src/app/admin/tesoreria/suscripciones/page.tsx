// Suscripciones de Mercado Pago (spec 4B §8). Dos bloques que dicen cosas
// distintas y por eso no comparten forma:
//
//   Sin vincular — lo ACCIONABLE, y arriba. Son débitos que MP ya cobra todos
//                  los meses y que el sistema no sabe de quién son: mientras no
//                  tengan dueño, cada cobro cae en la bandeja sin conciliar en
//                  vez de convertirse en la cuota del socio. Van como fichas con
//                  una regla ámbar al canto —la misma señal de "esto espera una
//                  decisión" que usa el resto del panel— y lideran con la fecha
//                  del próximo cobro, que es lo que va a pasar si nadie hace nada.
//   Vinculadas   — el REGISTRO, abajo y en tabla: se barre con la vista, no se
//                  decide nada. Sale de la base, así que se sigue viendo aunque
//                  Mercado Pago no conteste.
//
// El encabezado NO se escribe acá: lo pone el layout de Tesorería. La guarda
// tampoco se hereda del layout (Next lo renderiza en paralelo con la página).
import Link from "next/link";
import { INLINE_LINK } from "@/lib/admin/link-styles";
import { EmptyState } from "@/components/admin/empty-state";
import { FormMessage } from "@/components/admin/form-message";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { subscriptionStatusBadgeVariant } from "@/lib/admin/status-badges";
import { subscriptionStatusLabel } from "@/lib/admin/unmatched-labels";
import { requireAdmin } from "@/lib/auth/require-admin";
import { formatARS, formatDateAR } from "@/lib/format";
import { mpErrorLog } from "@/lib/mp/error-log";
import { mpGateway, type MpPreapproval } from "@/lib/mp/gateway";
import { suggestMember } from "@/lib/mp/link-suggest";
import { prisma } from "@/lib/prisma";
import { feeValueReader } from "@/lib/treasury/fee-values";
import { feeAmountFor } from "@/lib/treasury/rules";

export const dynamic = "force-dynamic";
export const metadata = { title: "Suscripciones — SIGeV" };

const BASE = "/admin/tesoreria/suscripciones";

export default async function SuscripcionesPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireAdmin();
  if (!actor.ok) return <FormMessage kind="error" box>{actor.error}</FormMessage>;
  const sp = await props.searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const justLinked = one(sp.vinculada) !== undefined;
  const appliedCount = Number(one(sp.aplicados) ?? 0);
  const stillPending = Number(one(sp.pendientes) ?? 0);

  const [linked, feeValue, members] = await Promise.all([
    prisma.mpSubscription.findMany({
      where: { memberId: { not: null } },
      include: { member: { select: { id: true, fullName: true, category: true } } },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    }),
    feeValueReader.current(),
    // Sólo para la sugerencia: ~300 filas, tres columnas.
    prisma.member.findMany({ where: { status: { not: "withdrawn" } }, select: { id: true, fullName: true, email: true } }),
  ]);

  // Mercado Pago es la parte frágil de la pantalla: si no contesta, se avisa y
  // el resto sigue en pie. `remote === null` es "no pudimos preguntar", que no
  // es lo mismo que "no hay ninguna".
  let remote: MpPreapproval[] | null = null;
  try {
    remote = await mpGateway.searchPreapprovals({ status: "authorized" });
  } catch (e) {
    console.error("[suscripciones] no se pudo listar en MP —", mpErrorLog("searchPreapprovals", {}, e));
  }
  // Todas las conocidas, no sólo las que tienen socio: una suscripción que
  // cuelga de una solicitud tampoco está "sin vincular".
  const known = new Set((await prisma.mpSubscription.findMany({ select: { preapprovalId: true } })).map((s) => s.preapprovalId));
  const unlinked = (remote ?? []).filter((p) => !known.has(p.id));

  return (
    <div className="space-y-8">
      {justLinked && (
        <FormMessage kind="success" box>
          {appliedCount > 0
            ? `Suscripción vinculada. ${appliedCount} ${appliedCount === 1 ? "pago de la bandeja se aplicó" : "pagos de la bandeja se aplicaron"} con recibo.`
            : "Suscripción vinculada. No había pagos esperando."}
          {stillPending > 0 && (
            <>
              {" "}
              <Link
                className="font-medium underline underline-offset-2 outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                href="/admin/tesoreria/sin-conciliar"
              >
                {`${stillPending} ${stillPending === 1 ? "quedó" : "quedaron"} sin aplicar en la bandeja.`}
              </Link>
            </>
          )}
        </FormMessage>
      )}

      <section aria-labelledby="sin-vincular" className="space-y-3">
        <div className="space-y-1">
          <h2 id="sin-vincular" className="text-sm font-semibold tracking-widest text-muted-foreground uppercase">
            Sin vincular
          </h2>
          <p className="max-w-prose text-sm text-muted-foreground">
            Mercado Pago ya le cobra a estos vecinos todos los meses, pero el sistema no sabe de qué
            socio es cada cobro. Hasta que se vinculen, cada débito cae en{" "}
            <Link
              className={INLINE_LINK}
              href="/admin/tesoreria/sin-conciliar"
            >
              Sin conciliar
            </Link>{" "}
            en vez de convertirse en su cuota.
          </p>
        </div>
        {remote === null ? (
          <FormMessage kind="warning" box>
            No pudimos consultar Mercado Pago en este momento. Las suscripciones vinculadas salen de
            la base; volvé a intentar en unos minutos para ver las que faltan.
          </FormMessage>
        ) : unlinked.length === 0 ? (
          <EmptyState size="card" description="Todas las suscripciones activas de Mercado Pago están vinculadas a un socio." />
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {unlinked.map((p) => {
              // La sugerencia es una PREGUNTA, no un destino: el paso 2 vuelve a
              // resolver el socio contra la base y el operador confirma ahí.
              const hint = suggestMember({ payerEmail: p.payerEmail, reason: p.reason }, members);
              return (
                <li
                  key={p.id}
                  className="relative flex flex-col gap-3 overflow-hidden rounded-xl border border-warning/40 bg-background p-4 pl-5"
                >
                  {/* La regla ámbar al canto: la misma señal que el resto del
                      panel usa para "esto espera una decisión". Decorativa para
                      el lector de pantalla, que ya leyó el título de la sección. */}
                  <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-warning/70" />
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{p.reason ?? "Suscripción sin descripción"}</p>
                      {/* Dato personal (Ley 25.326): se ve acá, que es panel de
                          admin, y no viaja a ningún asiento ni a los logs. */}
                      <p className="truncate text-sm text-muted-foreground">{p.payerEmail ?? "sin email"}</p>
                    </div>
                    <p className="shrink-0 font-mono text-xl tabular-nums">{p.amount !== null ? formatARS(p.amount) : "—"}</p>
                  </div>
                  {/* El próximo cobro primero y en el color del texto normal: es
                      la consecuencia de no hacer nada. El alta y el id son
                      respaldo y van apagados. */}
                  <p className="text-sm">
                    {p.nextPaymentDate
                      ? `Cobra de nuevo el ${formatDateAR(p.nextPaymentDate)}`
                      : "Sin próximo cobro informado"}
                    <span className="text-muted-foreground">
                      {" · alta "}
                      {p.dateCreated ? formatDateAR(p.dateCreated) : "—"}
                    </span>
                    <span className="mt-1 block font-mono text-xs break-all text-muted-foreground">{p.id}</span>
                  </p>
                  {hint ? (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted px-3 py-2 text-sm">
                      <span>¿Es <strong>{hint.fullName}</strong>?</span>
                      {/* `min-h-11` y no `size="sm"` (28 px): el panel exige
                          targets de 44 px en todo control, y estos dos son los
                          únicos de la ficha. Mismo recurso que la paginación de
                          Noticias. */}
                      <Button asChild className="min-h-11">
                        <Link href={`${BASE}/${p.id}/vincular?socio=${hint.id}`}>Vincular a este socio</Link>
                      </Button>
                    </div>
                  ) : (
                    <Button asChild variant="outline" className="min-h-11 self-start">
                      <Link href={`${BASE}/${p.id}/vincular`}>Vincular</Link>
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="vinculadas" className="space-y-3">
        <h2 id="vinculadas" className="text-sm font-semibold tracking-widest text-muted-foreground uppercase">
          Vinculadas
        </h2>
        {linked.length === 0 ? (
          <EmptyState description="Ninguna suscripción vinculada todavía." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Socio</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Monto</TableHead>
                <TableHead>Último sync</TableHead>
                <TableHead>Origen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {linked.map((s) => {
                // Divergencia: MP le cobra un monto y el valor vigente es otro.
                // No se corrige acá (eso es el lote REG-34), pero tiene que
                // verse: es plata de menos —o de más— todos los meses.
                const expected = s.member && feeValue ? feeAmountFor(s.member.category, feeValue) : null;
                const divergent = expected !== null && s.amount !== null && Math.abs(Number(s.amount) - expected) >= 0.01;
                return (
                  <TableRow key={s.id}>
                    <TableCell>
                      {s.member && (
                        <Link
                          className={INLINE_LINK}
                          href={`/admin/socios/${s.member.id}?tab=cuenta`}
                        >
                          {s.member.fullName}
                        </Link>
                      )}
                      <span className="ml-2 font-mono text-xs text-muted-foreground">{s.preapprovalId.slice(0, 8)}…</span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={subscriptionStatusBadgeVariant(s.status)}>{subscriptionStatusLabel(s.status)}</Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {s.amount !== null ? formatARS(Number(s.amount)) : "—"}
                      {divergent && expected !== null && (
                        <Badge variant="destructive" className="ml-2">{`≠ vigente ${formatARS(expected)}`}</Badge>
                      )}
                    </TableCell>
                    <TableCell>{s.lastSyncAt ? formatDateAR(s.lastSyncAt) : "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{s.linkedManually ? "Vinculada a mano" : "Alta web"}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}
