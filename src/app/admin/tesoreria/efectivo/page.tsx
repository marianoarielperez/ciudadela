// La pantalla del mostrador: buscar al socio, leer lo que debe y cobrarle.
// Dos estados en una sola URL — sin `?socio=` es el buscador (GET plano, como
// el padrón: la búsqueda queda en la URL y se puede compartir o recargar); con
// `?socio=` es la ficha corta más el formulario de cobro.
//
// El encabezado NO se escribe acá: lo pone el layout de Tesorería.
import Link from "next/link";
import { INLINE_LINK } from "@/lib/admin/link-styles";
import { EmptyState } from "@/components/admin/empty-state";
import { FormMessage } from "@/components/admin/form-message";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { memberStatusBadgeVariant } from "@/lib/admin/status-badges";
import { requireAdmin } from "@/lib/auth/require-admin";
import { formatARS } from "@/lib/format";
import { CATEGORY_LABELS, STATUS_LABELS } from "@/lib/members/labels";
import { prisma } from "@/lib/prisma";
import { fetchMemberAccount } from "@/lib/treasury/account";
import { feeValueReader } from "@/lib/treasury/fee-values";
import { searchMembers } from "@/lib/treasury/member-search";
import { cashConceptsFor } from "@/lib/treasury/rules";
import { CashForm } from "./cash-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Efectivo — SIGeV" };

export default async function EfectivoPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireAdmin();
  if (!actor.ok) return <FormMessage kind="error" box>{actor.error}</FormMessage>;
  const sp = await props.searchParams;
  const q = (Array.isArray(sp.q) ? sp.q[0] : sp.q)?.trim() ?? "";
  const socio = Number(Array.isArray(sp.socio) ? sp.socio[0] : sp.socio);
  const memberId = Number.isInteger(socio) && socio > 0 ? socio : null;

  const [hits, member] = await Promise.all([
    memberId === null ? searchMembers(prisma, q) : Promise.resolve([]),
    memberId === null ? null : prisma.member.findUnique({
      where: { id: memberId },
      include: { memberships: { include: { book: true } } },
    }),
  ]);

  if (memberId !== null && member) {
    // Solo se lee el valor de cuota cuando hace falta: en modo búsqueda nadie
    // mira este dato y esperarlo alargaba cada tecleo del buscador para nada.
    const feeValue = await feeValueReader.current();
    const account = await fetchMemberAccount(prisma, member, feeValue);
    const number = member.memberships.find((m) => m.book.status === "open")?.memberNumber ?? null;
    // Al cesante sólo se le cobran las cuotas congeladas: el voluntario y el
    // extraordinario son del que hoy es socio (el servicio los rechaza), y sin
    // pendientes tampoco hay cuotas que cobrarle, porque no devenga nuevas.
    const withdrawn = member.status === "withdrawn";
    const concepts = withdrawn
      ? (account.pendingCount > 0 ? cashConceptsFor(member.category).filter((c) => c === "fees") : [])
      : cashConceptsFor(member.category);
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>{member.fullName}</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>N° {number ?? "—"} · {CATEGORY_LABELS[member.category]} · {STATUS_LABELS[member.status]}</p>
            <p>
              Cuotas pendientes: <span className="font-mono tabular-nums">{account.pendingCount}</span>
              {account.debt !== null && account.pendingCount > 0 && (
                <> · deuda <span className="font-mono tabular-nums">{formatARS(account.debt)}</span> a valor vigente</>
              )}
            </p>
            {account.feeAmount !== null && (
              <p>Valor de la cuota: <span className="font-mono tabular-nums">{formatARS(account.feeAmount)}</span></p>
            )}
            <p className="flex gap-3">
              <Link className="text-primary hover:underline" href={`/admin/socios/${member.id}?tab=cuenta`}>Ver cuenta corriente</Link>
              <Link className="text-primary hover:underline" href="/admin/tesoreria/efectivo">Elegir otro socio</Link>
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Registrar pago en efectivo</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {withdrawn && (
              // Art. 9 inc. c (REG-16): el cesante salda la deuda ANTES de que la
              // Comisión pueda readmitirlo, así que acá se cobra. El aviso dice
              // las dos cosas que el operador tiene que saber: que el pago es
              // válido y que NO lo reincorpora.
              <FormMessage kind="warning" box as="div">
                <p>
                  Está dado de baja. Podés cobrarle las cuotas que le quedaron pendientes, valuadas
                  al valor vigente de su categoría (Art. 9 inc. c). El pago salda la deuda y le
                  emite recibo, pero <strong>no</strong> lo reincorpora.
                </p>
                <p className="mt-2">
                  Con la deuda en cero, el reingreso se registra con acta desde{" "}
                  <Link className="underline" href={`/admin/socios/${member.id}/reingreso`}>
                    la ficha del socio
                  </Link>.
                </p>
              </FormMessage>
            )}
            {concepts.length === 0 ? (
              // Un cesante sin cuotas pendientes (o de una categoría que no paga
              // cuota) no tiene nada que pagar acá: los aportes se le rechazan.
              <EmptyState size="card" description="No hay nada para cobrarle en esta pantalla." />
            ) : (
              <CashForm
                memberId={member.id}
                concepts={concepts}
                feeAmount={account.feeAmount}
                hasEmail={Boolean(member.email) && member.emailStatus !== "bounced"}
                pendingCount={account.pendingCount}
              />
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // `?socio=` apuntaba a un id que ya no existe (o nunca existió): sin este
  // aviso, el operador vuelve al buscador vacío sin saber por qué perdió la
  // ficha que acababa de abrir.
  const notFound = memberId !== null && !member;

  return (
    <div className="space-y-4">
      <form className="flex flex-wrap items-end gap-2" method="get">
        <Input name="q" placeholder="Número, apellido o DNI" defaultValue={q} className="w-64" autoFocus />
        <Button type="submit" variant="secondary">Buscar socio</Button>
      </form>
      {notFound && (
        <FormMessage kind="error" box>No encontramos a ese socio. Probá buscarlo de nuevo.</FormMessage>
      )}
      {q === "" ? (
        <EmptyState size="card" description="Buscá al socio que está pagando en la sede." />
      ) : hits.length === 0 ? (
        // La búsqueda trae los tres estados a propósito (también las bajas):
        // no se puede prometer "vigente" en el estado vacío.
        <EmptyState description="Ningún socio coincide con la búsqueda." />
      ) : (
        <ul className="divide-y rounded-xl border">
          {hits.map((h) => (
            <li key={h.id}>
              <Link
                href={`/admin/tesoreria/efectivo?socio=${h.id}`}
                className="flex min-h-11 flex-wrap items-center gap-x-3 px-3 py-2 text-sm hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring outline-hidden"
              >
                <span className="font-mono tabular-nums">N° {h.memberNumber}</span>
                <span className="font-medium">{h.fullName}</span>
                <span className="text-muted-foreground">{h.dni ?? "sin DNI"} · {CATEGORY_LABELS[h.category]}</span>
                {/* La búsqueda trae suspendidos y bajas a propósito: el badge
                    es lo único que los distingue en esta lista, y es la
                    pantalla que cobra. */}
                <Badge variant={memberStatusBadgeVariant(h.status)}>{STATUS_LABELS[h.status]}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {/* Un alquiler del salón no se busca en el padrón: sin esta línea, el
          operador que cobró algo que no es una cuota se queda sin salida en la
          pantalla que sí cobra. Discreta a propósito — el trabajo de acá es
          cobrarle al socio. */}
      <p className="text-sm text-muted-foreground">
        ¿Cobraste algo que no es de un socio —el alquiler del salón, una rifa, un evento—?{" "}
        <Link
          className={INLINE_LINK}
          href="/admin/tesoreria/otros-ingresos"
        >
          Registralo en Otros ingresos
        </Link>.
      </p>
    </div>
  );
}
