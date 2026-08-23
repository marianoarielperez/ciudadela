// Detalle de una fila de la bandeja. La pantalla está partida en dos mitades
// que significan cosas distintas:
//
//   izquierda  — la EVIDENCIA. Lo que dijo Mercado Pago, tal cual llegó. No se
//                edita, no se discute: es el respaldo del asiento.
//   derecha    — la DECISIÓN. Lo único que el operador puede cambiar, y de lo
//                que queda responsable en la auditoría.
//
// Por eso el motivo por el que la fila cayó acá se explica con una frase entera
// y no con una etiqueta: sin saber POR QUÉ no se aplicó sola, el operador no
// puede decidir si corresponde imputarla o descartarla.
//
// El encabezado NO se escribe acá: lo pone el layout de Tesorería.
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/admin/empty-state";
import { FormMessage } from "@/components/admin/form-message";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { memberStatusBadgeVariant, unmatchedStatusBadgeVariant } from "@/lib/admin/status-badges";
import { UNMATCHED_REASON_LABELS, UNMATCHED_STATUS_LABELS } from "@/lib/admin/unmatched-labels";
import { requireAdmin } from "@/lib/auth/require-admin";
import { formatARS, formatDateAR } from "@/lib/format";
import { CATEGORY_LABELS, STATUS_LABELS } from "@/lib/members/labels";
import type { UnmatchedReason } from "@/lib/mp/unmatched";
import { prisma } from "@/lib/prisma";
import { fetchMemberAccount } from "@/lib/treasury/account";
import { feeValueReader } from "@/lib/treasury/fee-values";
import { INCOME_METHOD_LABELS } from "@/lib/treasury/labels";
import { searchMembers } from "@/lib/treasury/member-search";
import { DismissForm, OtherIncomeForm, ResolveForm } from "./resolve-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pago sin conciliar — SIGeV" };

const BASE = "/admin/tesoreria/sin-conciliar";

// Una frase por motivo, en el idioma del operador y no en el del webhook. Dice
// qué pasó y, cuando la hay, cuál es la salida correcta.
const REASON_HELP: Record<UnmatchedReason, string> = {
  no_reference:
    "Llegó sin referencia ni suscripción conocida: no hay forma de saber de qué socio es.",
  no_subscription:
    "Es un cobro de una suscripción que SIGeV todavía no tiene vinculada a ningún socio. Vinculala desde Suscripciones y esta fila se aplica sola.",
  application_missing:
    "Trae la referencia de una solicitud que ya no existe en el sistema.",
  duplicate_entry:
    "Es un segundo cobro sobre una solicitud cuyo ingreso ya se cobró y todavía no tiene acta.",
  withdrawn_no_pending:
    "El socio está dado de baja y no le quedan cuotas pendientes: no hay a qué imputarlo.",
  treasury_rejected:
    "MP cobró y tesorería rechazó el asiento por una regla (monto fuera de rango, ficha inexistente, cuotas que cambiaron). El motivo exacto está en la auditoría (payment_not_applied).",
};

export default async function UnmatchedDetailPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireAdmin();
  if (!actor.ok) return <FormMessage kind="error" box>{actor.error}</FormMessage>;
  const { id } = await props.params;
  const rowId = Number(id);
  if (!Number.isInteger(rowId) || rowId <= 0) notFound();
  const sp = await props.searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const q = one(sp.q)?.trim() ?? "";
  const socio = Number(one(sp.socio));
  const memberId = Number.isInteger(socio) && socio > 0 ? socio : null;

  const row = await prisma.mpUnmatchedPayment.findUnique({
    where: { id: rowId },
    include: {
      payment: {
        select: {
          id: true,
          member: { select: { id: true, fullName: true } },
          receipt: { select: { id: true, number: true } },
        },
      },
      resolvedBy: { select: { name: true } },
    },
  });
  if (!row) notFound();
  const reason = row.reason as UnmatchedReason;
  const open = row.status === "open";
  // Al descartar se pisa `description` con el motivo del descarte (es la
  // columna que existe; la descripción original de MP sigue en `webhook_events`).
  // Entonces en una fila descartada ese texto YA NO es lo que dijo Mercado Pago:
  // mostrarlo en la tarjeta de evidencia sería atribuirle a MP una frase que
  // escribió un operador. Se muestra del otro lado, dicho por su nombre.
  const dismissed = row.status === "dismissed";
  // El ingreso no societario no es una FK de la fila: la unión es el
  // `mpPaymentId`, que es único en las dos tablas. El módulo de ingresos es
  // independiente del núcleo de plata a propósito (no hay `payments` de por
  // medio), y esa independencia se paga con esta consulta.
  const income = row.status === "other_income"
    ? await prisma.otherIncome.findUnique({
        where: { mpPaymentId: row.mpPaymentId },
        select: { concept: true, note: true, voidedAt: true },
      })
    : null;

  const [hits, member] = await Promise.all([
    open && memberId === null ? searchMembers(prisma, q) : Promise.resolve([]),
    open && memberId !== null
      ? prisma.member.findUnique({
          where: { id: memberId },
          include: { memberships: { include: { book: true } } },
        })
      : Promise.resolve(null),
  ]);
  // El valor vigente sólo se lee cuando hay ficha abierta: en modo búsqueda
  // nadie mira ese dato y esperarlo alargaría cada tecleo (mismo criterio que
  // la pantalla de Efectivo).
  const account = member ? await fetchMemberAccount(prisma, member, await feeValueReader.current()) : null;
  // Un cesante sin pendientes no tiene a qué imputarle nada: el servicio lo
  // rechaza con `no_pending_withdrawn`, así que ofrecerle el formulario sería
  // ofrecerle un callejón sin salida. Queda el descarte, que sigue abajo.
  const nothingToImpute = Boolean(member && account && member.status === "withdrawn" && account.pendingCount === 0);
  // `?socio=` apuntando a un id que ya no existe: sin este aviso el operador
  // vuelve al buscador sin saber por qué perdió la ficha que acababa de abrir.
  const memberGone = open && memberId !== null && !member;

  return (
    <div className="space-y-4">
      <Link
        className="inline-flex min-h-11 items-center text-sm text-primary outline-hidden hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        href={BASE}
      >
        ← Sin conciliar
      </Link>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Pago de Mercado Pago</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            {/* El importe es el hecho central de la fila: se lee antes que
                cualquier otra cosa y en la misma tipografía monoespaciada con
                que el panel escribe toda la plata. */}
            <p className="font-mono text-3xl tabular-nums">{formatARS(Number(row.amount))}</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <dt className="text-muted-foreground">Cobrado</dt>
              <dd>{formatDateAR(row.paidAt)}</dd>
              {/* Dato personal (Ley 25.326): se ve acá, que es panel de admin, y
                  no viaja a ningún asiento de auditoría ni a los logs. */}
              <dt className="text-muted-foreground">Pagador</dt>
              <dd className="break-all">{row.payerEmail ?? "—"}</dd>
              <dt className="text-muted-foreground">Referencia</dt>
              <dd className="font-mono text-xs break-all">{row.externalReference ?? "—"}</dd>
              {!dismissed && (
                <>
                  <dt className="text-muted-foreground">Descripción</dt>
                  <dd>{row.description ?? "—"}</dd>
                </>
              )}
              <dt className="text-muted-foreground">Id de pago</dt>
              <dd className="font-mono text-xs break-all">{row.mpPaymentId}</dd>
              {row.preapprovalId && (
                <>
                  <dt className="text-muted-foreground">Suscripción</dt>
                  <dd>
                    <Link
                      className="font-mono text-xs break-all text-primary outline-hidden hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                      href="/admin/tesoreria/suscripciones"
                    >
                      {row.preapprovalId}
                    </Link>
                  </dd>
                </>
              )}
              <dt className="text-muted-foreground">Estado</dt>
              <dd>
                <Badge variant={unmatchedStatusBadgeVariant(row.status)}>{UNMATCHED_STATUS_LABELS[row.status]}</Badge>
              </dd>
            </dl>
            {/* `role="none"`: es ayuda estática sobre por qué la fila está acá,
                no la respuesta a una acción. Un role="alert" la anunciaría de
                nuevo en cada render. */}
            <FormMessage kind="warning" box as="div" role="none">
              <p className="font-medium">{UNMATCHED_REASON_LABELS[reason] ?? row.reason}</p>
              <p className="mt-1">{REASON_HELP[reason] ?? "Este cobro no se pudo aplicar automáticamente."}</p>
            </FormMessage>
          </CardContent>
        </Card>

        {!open ? (
          <Card>
            {/* El título es el nombre del estado: "Aplicado", "Descartado" o
                "Ingreso no societario". Tres desenlaces distintos, tres títulos. */}
            <CardHeader><CardTitle>{UNMATCHED_STATUS_LABELS[row.status]}</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>
                {row.resolvedAt ? formatDateAR(row.resolvedAt) : "—"}
                {row.resolvedBy ? ` · ${row.resolvedBy.name ?? "un operador"}` : " · automático"}
              </p>
              {dismissed && row.description && <p>Motivo: {row.description}</p>}
              {row.status === "other_income" && (
                income ? (
                  <>
                    {/* El concepto y la nota son texto libre del operador y pueden
                        nombrar a un tercero: se leen acá, que es panel de admin, y
                        no viajan a la auditoría ni al log (Ley 25.326). */}
                    <p className="font-medium">{income.concept}</p>
                    {income.note && <p className="text-muted-foreground">{income.note}</p>}
                    <p className="text-muted-foreground">
                      Registrado como {INCOME_METHOD_LABELS.mp.toLowerCase()} en Otros ingresos.
                      No emite recibo: la serie numerada es de las cuotas sociales.
                    </p>
                    {income.voidedAt && (
                      <FormMessage kind="warning" box>
                        Ese ingreso figura anulado y la fila todavía dice lo contrario. Avisá antes de
                        tocarla.
                      </FormMessage>
                    )}
                    <p>
                      <Link
                        className="text-primary outline-hidden hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                        href="/admin/tesoreria/otros-ingresos"
                      >
                        Ver en Otros ingresos
                      </Link>
                    </p>
                  </>
                ) : (
                  <FormMessage kind="warning" box>
                    La fila dice que se registró como ingreso no societario, pero ese registro ya no
                    está.
                  </FormMessage>
                )
              )}
              {row.payment?.member && (
                <p>
                  Socio:{" "}
                  <Link
                    className="text-primary outline-hidden hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                    href={`/admin/socios/${row.payment.member.id}?tab=cuenta`}
                  >
                    {row.payment.member.fullName}
                  </Link>
                </p>
              )}
              {row.payment?.receipt && (
                <p>
                  Recibo:{" "}
                  <Link
                    className="font-mono text-primary outline-hidden hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                    href={`/admin/tesoreria/recibos/${row.payment.receipt.id}`}
                  >
                    {row.payment.receipt.number}
                  </Link>
                </p>
              )}
              {row.status === "matched" && (
                <p className="text-muted-foreground">
                  Si se anula o se reembolsa ese pago, la fila vuelve a Pendientes.
                </p>
              )}
            </CardContent>
          </Card>
        ) : member && account ? (
          <Card>
            <CardHeader><CardTitle>{member.fullName}</CardTitle></CardHeader>
            <CardContent className="space-y-4 text-sm">
              <p className="flex flex-wrap items-center gap-x-2">
                <span className="font-mono tabular-nums">
                  N° {member.memberships.find((m) => m.book.status === "open")?.memberNumber ?? "—"}
                </span>
                <span>· {CATEGORY_LABELS[member.category]} ·</span>
                <Badge variant={memberStatusBadgeVariant(member.status)}>{STATUS_LABELS[member.status]}</Badge>
              </p>
              <p>
                Cuotas pendientes: <span className="font-mono tabular-nums">{account.pendingCount}</span>
                {account.debt !== null && account.pendingCount > 0 && (
                  <> · deuda <span className="font-mono tabular-nums">{formatARS(account.debt)}</span> a valor vigente</>
                )}
              </p>
              <p className="flex flex-wrap gap-3">
                <Link
                  className="text-primary outline-hidden hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                  href={`/admin/socios/${member.id}?tab=cuenta`}
                >
                  Ver cuenta corriente
                </Link>
                <Link
                  className="text-primary outline-hidden hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                  href={`${BASE}/${row.id}`}
                >
                  Elegir otro socio
                </Link>
              </p>
              {nothingToImpute ? (
                <EmptyState
                  size="card"
                  description="Está dado de baja y no le quedan cuotas pendientes: no hay a qué imputarle este cobro. Elegí otro socio o descartá la fila."
                />
              ) : (
                <ResolveForm
                  rowId={row.id}
                  memberId={member.id}
                  amount={Number(row.amount)}
                  paidAt={formatDateAR(row.paidAt)}
                  pendingCount={account.pendingCount}
                  withdrawn={member.status === "withdrawn"}
                  feeAmount={account.feeAmount}
                />
              )}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader><CardTitle>¿De qué socio es este pago?</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {/* GET plano, como el buscador del padrón y el de Efectivo: la
                  búsqueda queda en la URL y se puede compartir o recargar.
                  Sin `autoFocus`, a diferencia de Efectivo: allá la pantalla ES
                  el buscador, acá primero hay que leer por qué el cobro no se
                  aplicó solo. Robarle el foco a esa explicación contradice el
                  orden de lectura de la pantalla. */}
              <form className="flex flex-wrap items-end gap-2" method="get">
                <Input
                  name="q"
                  placeholder="Número, apellido o DNI"
                  defaultValue={q}
                  className="w-64"
                  aria-label="Número, apellido o DNI"
                />
                <Button type="submit" variant="secondary">Buscar socio</Button>
              </form>
              {memberGone && (
                <FormMessage kind="error" box>No encontramos a ese socio. Probá buscarlo de nuevo.</FormMessage>
              )}
              {q === "" ? (
                <EmptyState
                  size="card"
                  description="Buscá al socio por número, apellido o DNI. El email del pagador suele ser la pista."
                />
              ) : hits.length === 0 ? (
                <EmptyState description="Ningún socio coincide con la búsqueda." />
              ) : (
                <ul className="divide-y rounded-xl border">
                  {hits.map((h) => (
                    <li key={h.id}>
                      <Link
                        href={`${BASE}/${row.id}?socio=${h.id}`}
                        className="flex min-h-11 flex-wrap items-center gap-x-3 px-3 py-2 text-sm outline-hidden hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span className="font-mono tabular-nums">N° {h.memberNumber}</span>
                        <span className="font-medium">{h.fullName}</span>
                        <span className="text-muted-foreground">{h.dni ?? "sin DNI"} · {CATEGORY_LABELS[h.category]}</span>
                        {/* La búsqueda trae suspendidos y bajas a propósito: el
                            badge es lo único que los distingue, y de este lado
                            se emite un recibo. */}
                        <Badge variant={memberStatusBadgeVariant(h.status)}>{STATUS_LABELS[h.status]}</Badge>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Las dos salidas que NO son un socio, juntas y al pie. El agrupamiento
          dice algo cierto: las dos contestan "esto no es de ningún socio", y sólo
          se diferencian en si la plata es de la vecinal o no. Antes el descarte
          era la única y por eso mentía.
          Están SIEMPRE que la fila esté abierta, aunque todavía no se haya
          elegido socio: un alquiler no se busca en el padrón, y un cobro
          duplicado se descarta sin buscar a nadie. */}
      {open && (
        <section aria-labelledby="otras-salidas" className="space-y-2">
          <h2 id="otras-salidas" className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Si no es de un socio
          </h2>
          <div className="divide-y rounded-md border">
            <OtherIncomeForm rowId={row.id} amount={Number(row.amount)} paidAt={formatDateAR(row.paidAt)} />
            <DismissForm rowId={row.id} />
          </div>
        </section>
      )}
    </div>
  );
}
