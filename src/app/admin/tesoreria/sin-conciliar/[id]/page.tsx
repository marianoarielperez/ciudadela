// Detalle de una fila de la bandeja. La pantalla sigue partida en dos mitades:
//
//   izquierda  — la EVIDENCIA. Lo que dijo Mercado Pago, tal cual llegó, y
//                —desde el reparto— qué parte de esa plata ya está asignada y
//                a quién.
//   derecha    — la DECISIÓN. El reparto entre socios (spec 2026-09-10 §8.1):
//                sugerencias por la casilla del pagador, el buscador, una parte
//                por socio elegido y la confirmación en dos pasos.
//
// Los socios elegidos viajan en la URL (`?socios=192,193`), como antes viajaba
// `?socio=`: todo se resuelve en el servidor, sin fetch, y la pantalla se puede
// recargar o compartir a medio armar.
//
// El encabezado NO se escribe acá: lo pone el layout de Tesorería.
import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus, Users } from "lucide-react";
import { INLINE_LINK } from "@/lib/admin/link-styles";
import { EmptyState } from "@/components/admin/empty-state";
import { FormMessage } from "@/components/admin/form-message";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { PaymentStatus } from "@/generated/prisma/client";
import { memberStatusBadgeVariant, receiptBadgeVariant, unmatchedStatusBadgeVariant } from "@/lib/admin/status-badges";
import { UNMATCHED_REASON_LABELS, UNMATCHED_STATUS_LABELS } from "@/lib/admin/unmatched-labels";
import { requireAdmin } from "@/lib/auth/require-admin";
import { formatARS, formatDateAR } from "@/lib/format";
import { CATEGORY_LABELS, STATUS_LABELS } from "@/lib/members/labels";
import type { UnmatchedReason } from "@/lib/mp/unmatched";
import { prisma } from "@/lib/prisma";
import { fetchMemberAccount } from "@/lib/treasury/account";
import { activeExemption, adminExemptionNotice } from "@/lib/treasury/exemptions";
import { feeValueReader } from "@/lib/treasury/fee-values";
import { INCOME_METHOD_LABELS } from "@/lib/treasury/labels";
import { membersByEmail, searchMembers, type MemberHit } from "@/lib/treasury/member-search";
import { periodLabel } from "@/lib/treasury/periods";
import type { ReceiptEmailOutcome } from "@/lib/treasury/receipt-notice";
import { cashConceptsFor, type FeeValueAmounts } from "@/lib/treasury/rules";
import { loadGroup, MAX_SPLIT_PARTS, parseSociosParam, type GroupRow } from "@/lib/treasury/split-group";
import { DismissForm, OtherIncomeForm } from "./resolve-form";
import { SplitForm, type SplitPartMember } from "./split-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pago sin conciliar — SIGeV" };

const BASE = "/admin/tesoreria/sin-conciliar";

// Una frase por motivo, en el idioma del operador y no en el del webhook.
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

const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = { applied: "Aplicado", voided: "Anulado", refunded: "Reembolsado" };

// Qué pasó con el email de cada recibo recién emitido, en dos palabras.
const EMAIL_SHORT: Record<ReceiptEmailOutcome, string> = {
  sent: "enviado por email", no_email: "sin casilla: imprimilo", voided: "no se envió", error: "el email no salió", skipped: "",
};

function hrefWith(rowId: number, ids: number[], q?: string): string {
  const sp = new URLSearchParams();
  if (ids.length > 0) sp.set("socios", ids.join(","));
  if (q) sp.set("q", q);
  const s = sp.toString();
  return `${BASE}/${rowId}${s ? `?${s}` : ""}`;
}

// Lo que el reparto necesita saber de un socio elegido: conceptos según
// categoría, cesante y exención (las MISMAS reglas que Efectivo y que la
// action), valor de cuota y deuda para el hint.
async function loadPartMember(
  id: number, feeValue: FeeValueAmounts | null, rowId: number, chosen: number[],
): Promise<SplitPartMember | null> {
  const member = await prisma.member.findUnique({
    where: { id },
    include: { memberships: { include: { book: true } } },
  });
  if (!member) return null;
  const [account, exemption] = await Promise.all([
    fetchMemberAccount(prisma, member, feeValue),
    activeExemption(prisma, member.id),
  ]);
  const withdrawn = member.status === "withdrawn";
  const concepts = withdrawn
    ? (account.pendingCount > 0 ? cashConceptsFor(member.category).filter((c) => c === "fees") : [])
    : cashConceptsFor(member.category).filter((c) => !exemption || c !== "fees");
  return {
    memberId: member.id,
    name: member.fullName,
    memberNumber: member.memberships.find((m) => m.book.status === "open")?.memberNumber ?? null,
    categoryLabel: CATEGORY_LABELS[member.category],
    status: member.status,
    statusLabel: STATUS_LABELS[member.status],
    concepts,
    feeAmount: account.feeAmount,
    pendingCount: account.pendingCount,
    oldestPendingLabel: account.oldestPending ? periodLabel(account.oldestPending) : null,
    withdrawn,
    exemptionNotice: exemption ? adminExemptionNotice(exemption) : null,
    removeHref: hrefWith(rowId, chosen.filter((c) => c !== id)),
  };
}

function MemberRow({ hit, addHref, disabled }: { hit: MemberHit; addHref: string; disabled: boolean }) {
  const body = (
    <>
      <span className="font-mono tabular-nums">N° {hit.memberNumber}</span>
      <span className="font-medium">{hit.fullName}</span>
      <span className="text-muted-foreground">{hit.dni ?? "sin DNI"} · {CATEGORY_LABELS[hit.category]}</span>
      <Badge variant={memberStatusBadgeVariant(hit.status)}>{STATUS_LABELS[hit.status]}</Badge>
    </>
  );
  return (
    <li className="flex min-h-11 flex-wrap items-center gap-x-3 px-3 py-2 text-sm">
      {body}
      {disabled ? (
        <span className="ml-auto text-xs text-muted-foreground">En el reparto</span>
      ) : (
        <Link
          href={addHref}
          className="ml-auto inline-flex min-h-11 items-center gap-1 text-primary outline-hidden hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Plus className="size-4" aria-hidden="true" />
          Agregar
          <span className="sr-only"> a {hit.fullName} al reparto</span>
        </Link>
      )}
    </li>
  );
}

function PartsList({ parts, rowId }: { parts: GroupRow[]; rowId: number }) {
  return (
    <ul className="divide-y rounded-xl border text-sm">
      {parts.map((p) => (
        <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
          {p.member ? (
            <Link className={INLINE_LINK} href={`/admin/socios/${p.member.id}?tab=cuenta`}>{p.member.fullName}</Link>
          ) : (
            <span className="text-muted-foreground">Socio fuera del padrón</span>
          )}
          <span className="text-muted-foreground">{p.receipt?.concept ?? "—"}</span>
          <span className="font-mono tabular-nums">{formatARS(p.amount)}</span>
          {p.receipt && (
            <Link
              className="font-mono text-xs text-primary outline-hidden hover:underline focus-visible:ring-2 focus-visible:ring-ring"
              href={`/admin/tesoreria/recibos/${p.receipt.id}`}
            >
              {p.receipt.number}
            </Link>
          )}
          <Badge variant={receiptBadgeVariant(p.status !== "applied")}>{PAYMENT_STATUS_LABELS[p.status]}</Badge>
          <span className="sr-only">de la fila {rowId}</span>
        </li>
      ))}
    </ul>
  );
}

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
  const chosen = parseSociosParam(one(sp.socios));
  const sociosParam = chosen.join(",");

  const row = await prisma.mpUnmatchedPayment.findUnique({
    where: { id: rowId },
    include: { resolvedBy: { select: { name: true } } },
  });
  if (!row) notFound();
  const reason = row.reason as UnmatchedReason;
  const canAssign = row.status === "open" || row.status === "partial";
  const dismissed = row.status === "dismissed";
  const group = await loadGroup(prisma, { mpPaymentId: row.mpPaymentId, amount: Number(row.amount) });
  const income = row.status === "other_income"
    ? await prisma.otherIncome.findUnique({
        where: { mpPaymentId: row.mpPaymentId },
        select: { id: true, concept: true, note: true, voidedAt: true },
      })
    : null;

  const [hits, suggestions, feeValue] = await Promise.all([
    canAssign && q !== "" ? searchMembers(prisma, q) : Promise.resolve([] as MemberHit[]),
    canAssign && row.payerEmail ? membersByEmail(prisma, row.payerEmail) : Promise.resolve([] as MemberHit[]),
    // El valor vigente sólo se lee cuando hay socios elegidos (mismo criterio
    // que Efectivo: en modo búsqueda nadie mira ese dato).
    canAssign && chosen.length > 0 ? feeValueReader.current() : Promise.resolve(null),
  ]);
  const loaded = canAssign
    ? await Promise.all(chosen.map((mid) => loadPartMember(mid, feeValue, row.id, chosen)))
    : [];
  const parts = loaded.filter((p): p is SplitPartMember => p !== null);
  const memberGone = loaded.some((p) => p === null);
  const full = chosen.length >= MAX_SPLIT_PARTS;
  const addHref = (mid: number) => hrefWith(row.id, [...chosen, mid]);
  const pendingSuggestions = suggestions.filter((s) => !chosen.includes(s.id));

  // Éxito del reparto: `?emitidos=N&email=a,b`. Los recibos son las últimas N
  // partes aplicadas del grupo, en orden de emisión.
  const emitted = Number(one(sp.emitidos));
  const emailOutcomes = (one(sp.email) ?? "").split(",").filter(Boolean) as ReceiptEmailOutcome[];
  const justIssued = Number.isInteger(emitted) && emitted > 0
    ? group.all.filter((p) => p.status === "applied" && p.receipt).slice(-emitted)
    : [];

  return (
    <div className="space-y-4">
      <Link
        className="inline-flex min-h-11 items-center text-sm text-primary outline-hidden hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        href={BASE}
      >
        ← Sin conciliar
      </Link>

      {justIssued.length > 0 && (
        <FormMessage kind="success" box as="div">
          <p className="font-medium">
            {justIssued.length === 1 ? "Se emitió 1 recibo." : `Se emitieron ${justIssued.length} recibos.`}
          </p>
          <ul className="mt-1 space-y-0.5">
            {justIssued.map((p, i) => (
              <li key={p.id}>
                <Link
                  className="font-mono underline underline-offset-2 outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                  href={`/admin/tesoreria/recibos/${p.receipt!.id}`}
                >
                  N° {p.receipt!.number}
                </Link>
                {p.member ? ` (${p.member.fullName}` : " ("}
                {emailOutcomes[i] && EMAIL_SHORT[emailOutcomes[i]] ? ` · ${EMAIL_SHORT[emailOutcomes[i]]})` : ")"}
              </li>
            ))}
          </ul>
        </FormMessage>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Pago de Mercado Pago</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
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
            {canAssign && (
              <FormMessage kind="warning" box as="div" role="none">
                <p className="font-medium">{UNMATCHED_REASON_LABELS[reason] ?? row.reason}</p>
                <p className="mt-1">{REASON_HELP[reason] ?? "Este cobro no se pudo aplicar automáticamente."}</p>
              </FormMessage>
            )}
            {group.all.length > 0 && (
              <div className="space-y-2">
                <p>
                  Asignado <span className="font-mono tabular-nums">{formatARS(group.totals.assigned)}</span>
                  {" · "}
                  Sin asignar{" "}
                  <span className={`font-mono tabular-nums ${group.totals.unassigned === 0 ? "text-success" : "text-warning"}`}>
                    {formatARS(group.totals.unassigned)}
                  </span>
                </p>
                <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Partes</h3>
                <PartsList parts={group.all} rowId={row.id} />
                {row.status === "matched" && (
                  <p className="text-muted-foreground">
                    Si se anula una parte, la fila vuelve a Pendientes con lo que quede sin asignar.
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {!canAssign ? (
          <Card>
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
                    <p className="font-medium">{income.concept}</p>
                    {income.note && <p className="text-muted-foreground">{income.note}</p>}
                    <p className="text-muted-foreground">
                      Registrado como {INCOME_METHOD_LABELS.mp.toLowerCase()} en Otros ingresos.
                      No emite recibo: la serie numerada es de las cuotas sociales.
                    </p>
                    {income.voidedAt && (
                      <FormMessage kind="warning" box>
                        Ese ingreso figura anulado y la fila todavía dice lo contrario. Avisá antes de tocarla.
                      </FormMessage>
                    )}
                    <p>
                      <Link className={INLINE_LINK} href={`/admin/tesoreria/otros-ingresos?ingreso=${income.id}`}>
                        Ver en Otros ingresos
                      </Link>
                    </p>
                  </>
                ) : (
                  <FormMessage kind="warning" box>
                    La fila dice que se registró como ingreso no societario, pero ese registro ya no está.
                  </FormMessage>
                )
              )}
              {row.status === "matched" && group.all.length === 0 && (
                <FormMessage kind="warning" box>
                  La fila figura aplicada pero no hay ningún pago con este id de Mercado Pago. Avisá antes de tocarla.
                </FormMessage>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="size-5 text-primary" aria-hidden="true" />
                {row.status === "partial" ? "Asignar el resto" : "Reparto"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {row.status === "partial" && (
                <FormMessage kind="warning" box role="none">
                  Quedan <span className="font-mono tabular-nums">{formatARS(group.totals.unassigned)}</span> sin asignar de este cobro.
                  Elegí a quién se le asigna esa parte.
                </FormMessage>
              )}
              {pendingSuggestions.length > 0 && !full && (
                <div className="space-y-1">
                  <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    Socios con la casilla del pagador
                  </h3>
                  <ul className="divide-y rounded-xl border">
                    {pendingSuggestions.map((h) => (
                      <MemberRow key={h.id} hit={h} addHref={addHref(h.id)} disabled={false} />
                    ))}
                  </ul>
                </div>
              )}
              {/* GET plano, como Efectivo: la búsqueda queda en la URL junto con
                  los socios ya elegidos. */}
              <form className="flex flex-wrap items-end gap-2" method="get">
                {sociosParam && <input type="hidden" name="socios" value={sociosParam} />}
                <Input
                  name="q"
                  placeholder="Número, apellido o DNI"
                  defaultValue={q}
                  className="w-64"
                  aria-label="Número, apellido o DNI"
                  disabled={full}
                />
                {/* `min-h-11` como en Exenciones: el alto por defecto del botón
                    es 32px y en el celular esto se toca con el dedo. */}
                <Button type="submit" variant="secondary" className="min-h-11" disabled={full}>Buscar socio</Button>
              </form>
              {full && (
                <FormMessage kind="warning" role="none">
                  El reparto admite hasta {MAX_SPLIT_PARTS} socios. Quitá uno para agregar otro.
                </FormMessage>
              )}
              {memberGone && (
                <FormMessage kind="error" box>Uno de los socios elegidos ya no está en el padrón. Quitalo y buscalo de nuevo.</FormMessage>
              )}
              {q !== "" && (
                hits.length === 0 ? (
                  <EmptyState size="card" description="Ningún socio coincide con la búsqueda." />
                ) : (
                  <ul className="divide-y rounded-xl border">
                    {hits.map((h) => (
                      <MemberRow key={h.id} hit={h} addHref={addHref(h.id)} disabled={chosen.includes(h.id) || full} />
                    ))}
                  </ul>
                )
              )}
              {parts.length === 0 ? (
                <EmptyState
                  size="card"
                  description="Agregá al menos un socio. Si el cobro es de varios, agregalos a todos y repartí el importe entre ellos."
                />
              ) : (
                <SplitForm
                  // Agregar o quitar un socio es NAVEGAR, y en una navegación
                  // del cliente React conserva la instancia del formulario: sin
                  // esta llave, el estado inicial —conceptos, cuotas e importes
                  // sugeridos— se calcula una sola vez y el socio recién
                  // agregado aparece sin concepto y en $ 0,00, con el importe
                  // entero pegado al primero. La llave lleva también lo sin
                  // asignar: si una parte se anula mientras la pantalla está
                  // abierta, la sugerencia se rehace contra el resto real.
                  key={`${sociosParam}|${group.totals.unassigned}`}
                  rowId={row.id}
                  sociosParam={sociosParam}
                  parts={parts}
                  unassigned={group.totals.unassigned}
                  paidAt={formatDateAR(row.paidAt)}
                />
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Las dos salidas que NO son un socio: sólo con la fila abierta. Con una
          parte ya aplicada, la plata es de socios y el resto también. */}
      {row.status === "open" && (
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
      {row.status === "partial" && (
        <p className="text-sm text-muted-foreground">
          Este pago ya tiene una parte aplicada: el resto sólo puede asignarse a socios.
        </p>
      )}
    </div>
  );
}
