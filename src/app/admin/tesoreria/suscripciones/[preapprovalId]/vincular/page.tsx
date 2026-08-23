// Paso 2 de la vinculación: a QUIÉN se le da esta suscripción, y qué pasa
// cuando se hace.
//
// La pantalla está partida como la del detalle de la bandeja, y por la misma
// razón:
//
//   izquierda — la EVIDENCIA. Lo que Mercado Pago dice AHORA de la suscripción
//               (se relee con `getPreapproval`, no se arrastra de la lista) y
//               los cobros que ya le hizo al vecino. No se edita.
//   derecha   — la DECISIÓN. Primero el buscador del padrón; con un socio
//               elegido, la confirmación.
//
// Todo lo que el operador lee antes de confirmar lo resuelve ESTE archivo
// contra la base y contra MP. El formulario no dicta nada: un POST armado a
// mano no puede mostrar un nombre y vincular a otro socio.
//
// Es superadmin: la vinculación crea un vínculo que después cobra solo, todos
// los meses, sobre la tarjeta de un vecino.
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/admin/empty-state";
import { FormMessage } from "@/components/admin/form-message";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { memberStatusBadgeVariant, subscriptionStatusBadgeVariant } from "@/lib/admin/status-badges";
import { subscriptionStatusLabel } from "@/lib/admin/unmatched-labels";
import { requireSuperadmin } from "@/lib/auth/require-admin";
import { formatARS, formatDateAR } from "@/lib/format";
import { CATEGORY_LABELS, STATUS_LABELS } from "@/lib/members/labels";
import { mpErrorLog } from "@/lib/mp/error-log";
import { mpGateway, type MpPreapproval } from "@/lib/mp/gateway";
import { canStillCharge } from "@/lib/mp/link-subscription";
import { makeUnmatchedInbox } from "@/lib/mp/unmatched";
import { prisma } from "@/lib/prisma";
import { fetchMemberAccount } from "@/lib/treasury/account";
import { feeValueReader } from "@/lib/treasury/fee-values";
import { searchMembers } from "@/lib/treasury/member-search";
import { feeAmountFor } from "@/lib/treasury/rules";
import { ConfirmForm } from "./confirm-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Vincular suscripción — SIGeV" };

const BASE = "/admin/tesoreria/suscripciones";

/** El mismo formato que exige la acción: un id de preapproval de MP y nada más.
 *  Sin esto, el segmento de la URL llegaría entero a la API de Mercado Pago. */
const ID_RE = /^[a-z0-9-]{1,64}$/;

/** Los estados en los que una suscripción SIGUE cobrando. Se usan para avisar
 *  que el socio ya tiene otra viva: vincularle una segunda le duplica el débito. */
const LIVE_STATUSES = ["authorized", "pending"];

export default async function VincularSuscripcionPage(props: {
  params: Promise<{ preapprovalId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireSuperadmin();
  const { preapprovalId } = await props.params;
  if (!ID_RE.test(preapprovalId)) notFound();
  // El bloqueo se muestra DESPUÉS de validar la ruta pero antes de consultar
  // nada: un admin común no dispara ni una llamada a Mercado Pago.
  if (!actor.ok) return <FormMessage kind="error" box>{actor.error}</FormMessage>;

  const sp = await props.searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const q = one(sp.q)?.trim() ?? "";
  const socio = Number(one(sp.socio));
  const memberId = Number.isInteger(socio) && socio > 0 ? socio : null;

  // Ya vinculada: alguien la tomó en otra pestaña, o el operador llegó por una
  // URL vieja. No hay nada que decidir, y decirlo con el nombre del dueño evita
  // que vuelva a intentarlo.
  const already = await prisma.mpSubscription.findUnique({
    where: { preapprovalId },
    select: { member: { select: { id: true, fullName: true } } },
  });
  if (already) {
    return (
      <div className="space-y-4">
        <BackLink />
        <FormMessage kind="warning" box as="div">
          <p>Esa suscripción ya está vinculada.</p>
          {already.member && (
            <p className="mt-1">
              {"Es de "}
              <Link
                className="font-medium underline underline-offset-2 outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                href={`/admin/socios/${already.member.id}?tab=cuenta`}
              >
                {already.member.fullName}
              </Link>
              .
            </p>
          )}
        </FormMessage>
      </div>
    );
  }

  // Lo que MP dice AHORA. Si no contesta, la pantalla lo dice y no ofrece
  // ningún formulario: vincular a ciegas escribiría una fila con datos que
  // nadie leyó.
  let remote: MpPreapproval | null = null;
  try {
    remote = await mpGateway.getPreapproval(preapprovalId);
  } catch (e) {
    console.error("[suscripciones] no se pudo leer la suscripción —", mpErrorLog("getPreapproval", { preapprovalId }, e));
  }

  // Los cobros que MP ya le hizo al vecino. Es un dato de contexto, no una
  // precondición: si la búsqueda falla se dice "no disponible" y se sigue.
  let charges: { count: number; last: Date | null } | null = null;
  if (remote) {
    try {
      const rows = await mpGateway.searchAuthorizedPayments(preapprovalId);
      const processed = rows.filter((r) => r.status === "processed");
      const last = processed.reduce<Date | null>(
        (acc, r) => (r.dateCreated && (!acc || r.dateCreated > acc) ? r.dateCreated : acc),
        null,
      );
      charges = { count: processed.length, last };
    } catch (e) {
      console.error("[suscripciones] no se pudieron listar los cobros —", mpErrorLog("searchAuthorizedPayments", { preapprovalId }, e));
    }
  }

  const [hits, member] = await Promise.all([
    memberId === null ? searchMembers(prisma, q) : Promise.resolve([]),
    memberId !== null
      ? prisma.member.findUnique({
          where: { id: memberId },
          include: {
            memberships: { include: { book: true } },
            mpSubscriptions: { select: { id: true, status: true } },
          },
        })
      : Promise.resolve(null),
  ]);
  const feeValue = member ? await feeValueReader.current() : null;
  const account = member ? await fetchMemberAccount(prisma, member, feeValue) : null;
  // CUÁLES filas de la bandeja se van a aplicar, no cuántas: `openRowsForSubscription`
  // matchea por preapproval O por `externalReference`, y esa referencia es texto
  // libre que alguien puede tipear en el panel de Mercado Pago. Si colisiona, se
  // imputan cobros ajenos — y un número no deja verlo. Sólo las ABIERTAS: una que
  // el operador descartó o registró como alquiler del salón es una decisión tomada
  // y la vinculación no la pisa.
  const pendingRows = member && remote
    ? await makeUnmatchedInbox(prisma).openRowsForSubscription({
        preapprovalId: remote.id,
        externalReference: remote.externalReference,
      })
    : [];

  const expected = member && feeValue ? feeAmountFor(member.category, feeValue) : null;
  const divergent =
    expected !== null && remote?.amount != null && Math.abs(remote.amount - expected) >= 0.01
      ? formatARS(expected)
      : null;
  const otherLive = member?.mpSubscriptions.filter((s) => LIVE_STATUSES.includes(s.status)).length ?? 0;
  const memberGone = memberId !== null && !member;

  return (
    <div className="space-y-4">
      <BackLink />

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Suscripción de Mercado Pago</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            {!remote ? (
              <FormMessage kind="error" box>
                No pudimos leer la suscripción en Mercado Pago. Volvé a intentar en unos minutos: sin
                sus datos frescos no se puede vincular.
              </FormMessage>
            ) : (
              <>
                <p className="font-mono text-3xl tabular-nums">
                  {remote.amount !== null ? formatARS(remote.amount) : "—"}
                  <span className="ml-1 align-middle text-sm text-muted-foreground">por mes</span>
                </p>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                  <dt className="text-muted-foreground">Descripción</dt>
                  <dd>{remote.reason ?? "—"}</dd>
                  <dt className="text-muted-foreground">Estado</dt>
                  <dd>
                    <Badge variant={subscriptionStatusBadgeVariant(remote.status)}>
                      {subscriptionStatusLabel(remote.status)}
                    </Badge>
                  </dd>
                  <dt className="text-muted-foreground">Próximo cobro</dt>
                  <dd>{remote.nextPaymentDate ? formatDateAR(remote.nextPaymentDate) : "—"}</dd>
                  {/* Dato personal (Ley 25.326): se ve acá, que es panel de admin,
                      y no viaja a la auditoría ni a los logs. */}
                  <dt className="text-muted-foreground">Pagador</dt>
                  <dd className="break-all">{remote.payerEmail ?? "—"}</dd>
                  <dt className="text-muted-foreground">Referencia</dt>
                  <dd className="font-mono text-xs break-all">{remote.externalReference ?? "—"}</dd>
                  <dt className="text-muted-foreground">Id</dt>
                  <dd className="font-mono text-xs break-all">{remote.id}</dd>
                  <dt className="text-muted-foreground">Cobros previos</dt>
                  <dd>
                    {charges === null
                      ? "no disponible"
                      : charges.count === 0
                        ? "ninguno todavía"
                        : `${charges.count}${charges.last ? ` · último el ${formatDateAR(charges.last)}` : ""}`}
                  </dd>
                </dl>
              </>
            )}
          </CardContent>
        </Card>

        {member && account && remote ? (
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
              {/* El email del socio está acá para que el operador pueda
                  contrastarlo con el "Pagador" de la tarjeta de la izquierda con
                  sus propios ojos: `Member.email` no es único en la base (un
                  matrimonio, un padre y su hijo), así que la sugerencia por email
                  de la lista pudo haber propuesto a un familiar. */}
              <p className="break-all">
                <span className="text-muted-foreground">Email: </span>
                {member.email ?? "sin email"}
              </p>
              <p>
                Cuotas pendientes: <span className="font-mono tabular-nums">{account.pendingCount}</span>
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
                  href={`${BASE}/${preapprovalId}/vincular`}
                >
                  Elegir otro socio
                </Link>
              </p>
              <ConfirmForm
                preapprovalId={preapprovalId}
                memberId={member.id}
                token={`${preapprovalId}|${member.id}`}
                member={{
                  fullName: member.fullName,
                  memberNumber: member.memberships.find((m) => m.book.status === "open")?.memberNumber ?? null,
                  categoryLabel: CATEGORY_LABELS[member.category].toLowerCase(),
                  statusLabel: STATUS_LABELS[member.status].toLowerCase(),
                  withdrawn: member.status === "withdrawn",
                }}
                subscription={{
                  reason: remote.reason,
                  amountLabel: remote.amount !== null ? formatARS(remote.amount) : null,
                  statusLabel: subscriptionStatusLabel(remote.status).toLowerCase(),
                  // El paso 2 no filtra por estado a propósito (hay que poder
                  // vincular una `paused`), así que por URL directa se puede
                  // llegar a una `cancelled`: la confirmación tiene que decir
                  // que de esa no va a llegar ningún débito.
                  chargeable: canStillCharge(remote.status),
                }}
                charges={
                  charges === null
                    ? null
                    : { count: charges.count, last: charges.last ? formatDateAR(charges.last) : null }
                }
                pendingRows={pendingRows.map((r) => ({
                  id: r.id,
                  mpPaymentId: r.mpPaymentId,
                  dateLabel: formatDateAR(r.paidAt),
                  amountLabel: formatARS(r.amount),
                }))}
                divergentWith={divergent}
                otherLive={otherLive}
              />
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader><CardTitle>¿De qué socio es esta suscripción?</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {/* GET plano, como el buscador del padrón y el de la bandeja: la
                  búsqueda queda en la URL y se puede compartir o recargar. */}
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
                  description="Buscá al socio por número, apellido o DNI. El email del pagador y la descripción de la suscripción suelen ser la pista."
                />
              ) : hits.length === 0 ? (
                <EmptyState description="Ningún socio coincide con la búsqueda." />
              ) : (
                <ul className="divide-y rounded-xl border">
                  {hits.map((h) => (
                    <li key={h.id}>
                      <Link
                        href={`${BASE}/${preapprovalId}/vincular?socio=${h.id}`}
                        className="flex min-h-11 flex-wrap items-center gap-x-3 px-3 py-2 text-sm outline-hidden hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span className="font-mono tabular-nums">N° {h.memberNumber}</span>
                        <span className="font-medium">{h.fullName}</span>
                        <span className="text-muted-foreground">{h.dni ?? "sin DNI"} · {CATEGORY_LABELS[h.category]}</span>
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
    </div>
  );
}

function BackLink() {
  return (
    <Link
      className="inline-flex min-h-11 items-center text-sm text-primary outline-hidden hover:underline focus-visible:ring-2 focus-visible:ring-ring"
      href={BASE}
    >
      ← Suscripciones
    </Link>
  );
}
