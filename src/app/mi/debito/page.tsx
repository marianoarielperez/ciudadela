import Link from "next/link";
import { RefreshCw } from "lucide-react";

import { EmptyState } from "@/components/admin/empty-state";
import { FormMessage } from "@/components/admin/form-message";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireMember } from "@/lib/auth/require-member";
import { formatARS } from "@/lib/format";
import { adhesionBlockMessage } from "@/lib/members/debit-adhesion";
import { memberDebit } from "@/lib/members/member-debit";
import { isCharging, isNotCancelled } from "@/lib/mp/subscription-status";
import { prisma } from "@/lib/prisma";
import { describePeriods } from "@/lib/treasury/labels";
import { AdhesionForm } from "./adhesion-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Débito automático — Vecinal Ciudadela" };

const CANCEL_LINK =
  "inline-flex min-h-11 items-center text-sm font-medium text-destructive outline-hidden hover:underline focus-visible:ring-2 focus-visible:ring-ring";

/** El mensaje de la vuelta del checkout de suscripciones (`?volvio=1`), según
 *  el status FRESCO que `syncStatus` acaba de traer de MP — no el que había
 *  antes de que el socio se fuera al checkout. Sólo tres casillas: el resto de
 *  los estados que MP pueda devolver (o que no haya podido refrescarse) caen en
 *  la advertencia, porque no hay nada bueno que afirmar sobre ellos todavía. */
function volvioMessage(status: string | null): { kind: "success" | "neutral" | "warning"; text: string } {
  if (status === "authorized") return { kind: "success", text: "¡Listo! Tu débito quedó autorizado." };
  if (status === "pending") {
    return {
      kind: "neutral",
      text: "MP todavía está confirmando la autorización. Actualizá en un rato.",
    };
  }
  return {
    kind: "warning",
    text: "No pudimos confirmar el estado de tu adhesión. Actualizá la página en un rato o consultá en la sede.",
  };
}

export default async function MiDebitoPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // La página se autoriza sola (el layout corre en paralelo y no la protege).
  // El suspendido entra en modo lectura (spec M5 §5): VE su débito, pero
  // `canAct` le esconde los botones de adherir y cancelar — las actions vuelven
  // a exigir la vigencia por su cuenta (requireMember SIN allowSuspended), así
  // que esto es la comodidad de la pantalla, no la única barrera.
  const actor = await requireMember({ allowSuspended: true });
  if (!actor.ok) return null; // el layout ya explica por qué
  const canAct = actor.suspension === null;

  const sp = await props.searchParams;
  const volvio = (Array.isArray(sp.volvio) ? sp.volvio[0] : sp.volvio) === "1";

  // `?volvio=1` lo pone la `backUrl` del preapproval (member-debit.ts). El
  // checkout de SUSCRIPCIONES no usa `return-status.ts` —eso es de Checkout
  // Pro, spec §6.4—: acá el efecto lo dispara este GET, con el mismo criterio
  // que la conciliación diaria (`reconcile`, docs/07 4B): sincronizar el
  // espejo local contra MP antes de leerlo. Va ANTES de la lectura de
  // suscripciones para que la tarjeta de abajo ya muestre el estado fresco.
  let freshStatus: string | null = null;
  if (volvio) {
    const synced = await memberDebit.syncStatus({ memberId: actor.memberId });
    freshStatus = synced.status;
  }

  const [subs, preview] = await Promise.all([
    prisma.mpSubscription.findMany({
      where: { memberId: actor.memberId },
      orderBy: { id: "desc" },
      select: { preapprovalId: true, status: true, amount: true },
    }),
    // La página y la action comparten ESTE servicio: lo que acá se anuncia es
    // lo que `startDebitAction` va a poder cumplir, porque corren las mismas
    // guardas (`verdictFor`, dentro de `member-debit.ts`).
    memberDebit.preview({ memberId: actor.memberId }),
  ]);
  // Lista NEGRA de un valor (`isNotCancelled`, no `canStillCharge`): acá
  // interesa "¿hay algo que no esté muerto?", no "¿de esto puede salir plata
  // hoy?" — un estado que MP invente mañana se muestra igual, no se esconde.
  const live = subs.filter((s) => isNotCancelled(s.status));

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">Débito automático</h1>
        <p className="text-sm text-muted-foreground">
          Adherí tu cuota social a Mercado Pago y te la debita sola todos los meses.
        </p>
      </div>

      {volvio &&
        (() => {
          const msg = volvioMessage(freshStatus);
          return (
            <FormMessage kind={msg.kind} box>
              {msg.text}
            </FormMessage>
          );
        })()}

      {live.length > 0 ? (
        <div className="space-y-3">
          {live.map((sub) => (
            <Card key={sub.preapprovalId}>
              <CardHeader>
                <CardTitle as="h2" className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <span className="flex items-center gap-2">
                    <RefreshCw className="size-4 text-primary" aria-hidden />
                    Tu débito
                  </span>
                  <Badge variant={isCharging(sub.status) ? "success" : "secondary"}>
                    {isCharging(sub.status) ? "Activo" : "Pendiente"}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {sub.amount !== null && (
                  <p className="text-sm">
                    <span className="font-mono text-base font-semibold tabular-nums">
                      {formatARS(Number(sub.amount))}
                    </span>{" "}
                    por mes
                  </p>
                )}
                {canAct && (
                  <Link
                    className={CANCEL_LINK}
                    href={`/mi/debito/cancelar?preapproval=${encodeURIComponent(sub.preapprovalId)}`}
                  >
                    Cancelar el débito →
                  </Link>
                )}
              </CardContent>
            </Card>
          ))}
          {/* El sistema no crea un segundo débito vivo (el veredicto de
              adhesión lo bloquea): si hay dos, lo heredó de algo anterior a
              esta pantalla y no hay botón acá que lo resuelva. */}
          {live.length >= 2 && (
            <FormMessage kind="warning" box>
              Tenés más de un débito vivo: consultá en la sede.
            </FormMessage>
          )}
        </div>
      ) : !preview.verdict.ok ? (
        <FormMessage kind="warning" box>
          {adhesionBlockMessage(preview.verdict)}
        </FormMessage>
      ) : preview.unit === null ? (
        <EmptyState
          size="card"
          description="El valor de la cuota todavía no está publicado. Probá más tarde o consultá en la sede."
        />
      ) : (
        <AdhesionForm unit={preview.unit} firstPeriodLabel={describePeriods(preview.upcoming.slice(0, 1))} />
      )}
    </div>
  );
}
