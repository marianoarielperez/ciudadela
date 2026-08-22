// La pantalla del mostrador: buscar al socio, leer lo que debe y cobrarle.
// Dos estados en una sola URL — sin `?socio=` es el buscador (GET plano, como
// el padrón: la búsqueda queda en la URL y se puede compartir o recargar); con
// `?socio=` es la ficha corta más el formulario de cobro.
//
// El encabezado NO se escribe acá: lo pone el layout de Tesorería.
import Link from "next/link";
import { EmptyState } from "@/components/admin/empty-state";
import { FormMessage } from "@/components/admin/form-message";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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

  const [hits, member, feeValue] = await Promise.all([
    memberId === null ? searchMembers(prisma, q) : Promise.resolve([]),
    memberId === null ? null : prisma.member.findUnique({
      where: { id: memberId },
      include: { memberships: { include: { book: true } } },
    }),
    feeValueReader.current(),
  ]);

  if (memberId !== null && member) {
    const account = await fetchMemberAccount(prisma, member, feeValue);
    const number = member.memberships.find((m) => m.book.status === "open")?.memberNumber ?? null;
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
          <CardContent>
            {member.status === "withdrawn" ? (
              // El servicio también lo rechaza; acá se evita ofrecer el
              // formulario que no puede terminar bien.
              <FormMessage kind="warning" box>El socio está dado de baja: registrá primero el reingreso.</FormMessage>
            ) : (
              <CashForm
                memberId={member.id}
                concepts={cashConceptsFor(member.category)}
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

  return (
    <div className="space-y-4">
      <form className="flex flex-wrap items-end gap-2" method="get">
        <Input name="q" placeholder="Número, apellido o DNI" defaultValue={q} className="w-64" autoFocus />
        <Button type="submit" variant="secondary">Buscar socio</Button>
      </form>
      {q === "" ? (
        <EmptyState size="card" description="Buscá al socio que está pagando en la sede." />
      ) : hits.length === 0 ? (
        <EmptyState description="Ningún socio vigente coincide con la búsqueda." />
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
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
