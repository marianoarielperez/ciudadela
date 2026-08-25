import Link from "next/link";
import { notFound } from "next/navigation";

import { FormMessage } from "@/components/admin/form-message";
import { subscriptionStatusLabel } from "@/lib/admin/unmatched-labels";
import { requireMember } from "@/lib/auth/require-member";
import { formatARS } from "@/lib/format";
import { cancelEffect } from "@/lib/mp/cancel-effect";
import { isKnownDead } from "@/lib/mp/subscription-status";
import { prisma } from "@/lib/prisma";
import { CancelForm } from "./cancel-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cancelar débito — Vecinal Ciudadela" };

/** Mismo formato que exige `cancelDebitAction` — un id de preapproval de MP y
 *  nada más. Repetido a propósito (mismo criterio que el admin
 *  `[preapprovalId]/cancelar/page.tsx:ID_RE`): el parseo de la URL no importa
 *  del módulo de la action. */
const ID_RE = /^[A-Za-z0-9]{1,64}$/;

export default async function CancelarDebitoPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // La página se autoriza sola. El suspendido VE esta pantalla (allowSuspended)
  // pero no actúa: `canAct` le esconde el formulario — la action corta antes
  // (requireMember SIN allowSuspended), así que esto no es la única barrera.
  const actor = await requireMember({ allowSuspended: true });
  if (!actor.ok) return null; // el layout ya explica por qué
  const canAct = actor.suspension === null;

  const sp = await props.searchParams;
  const raw = Array.isArray(sp.preapproval) ? sp.preapproval[0] : sp.preapproval;
  if (!raw || !ID_RE.test(raw)) notFound();

  // La suscripción tiene que ser DEL socio: una ajena da el mismo notFound()
  // que una inexistente — no hay forma de usar esta pantalla para averiguar si
  // un preapprovalId existe.
  const sub = await prisma.mpSubscription.findFirst({
    where: { preapprovalId: raw, memberId: actor.memberId },
    select: { status: true, amount: true },
  });
  if (!sub) notFound();

  return (
    <div className="max-w-2xl space-y-4">
      <BackLink />
      {isKnownDead(sub.status) ? (
        // Precondición de `cancelEffect`: una `cancelled` no se le pasa (caería
        // en "unknown", que sería falso). Nada que confirmar acá.
        <FormMessage kind="success" box>
          Ese débito ya está cancelado: Mercado Pago no te va a volver a cobrar.
        </FormMessage>
      ) : !canAct ? (
        <FormMessage kind="warning" box>
          Mientras estés suspendido no podés cancelar el débito desde acá. Comunicate con la
          vecinal.
        </FormMessage>
      ) : (
        <CancelForm
          preapprovalId={raw}
          subscription={{
            amountLabel: sub.amount !== null ? formatARS(Number(sub.amount)) : null,
            statusLabel: subscriptionStatusLabel(sub.status).toLowerCase(),
            // Los CUATRO desenlaces de `@/lib/mp/cancel-effect`, no un
            // booleano: una `paused` hoy no cobra pero se reanuda, y no es lo
            // mismo que "nunca se autorizó" (`pending`).
            effect: cancelEffect(sub.status),
          }}
        />
      )}
    </div>
  );
}

function BackLink() {
  return (
    <Link
      className="inline-flex min-h-11 items-center text-sm text-primary outline-hidden hover:underline focus-visible:ring-2 focus-visible:ring-ring"
      href="/mi/debito"
    >
      ← Débito automático
    </Link>
  );
}
