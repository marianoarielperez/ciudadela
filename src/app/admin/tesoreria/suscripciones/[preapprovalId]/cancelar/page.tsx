// Cancelar el débito automático de un ex socio (spec 4C §10, enmienda del
// operador del 24/08/2026).
//
// Los tres avisos de "Mercado Pago no aceptó cancelar el débito" mandan a
// Suscripciones, y hasta esta pantalla ahí no había nada que hacer: sus únicos
// controles vinculan. Acá está el reintento.
//
// La pantalla NO llama a Mercado Pago para decidir: la regla se resuelve contra
// la base (el socio está dado de baja, el espejo no dice `cancelled`) y la única
// llamada de red la hace la acción, al confirmar. Preguntarle a MP el estado
// antes tampoco agregaría nada: el criterio es lista NEGRA —sólo una `cancelled`
// se puede afirmar muerta— y una lectura que falle no puede impedir el corte.
//
// El encabezado NO se escribe acá: lo pone el layout de Tesorería.
import Link from "next/link";
import { notFound } from "next/navigation";
import { FormMessage } from "@/components/admin/form-message";
import { INLINE_LINK } from "@/lib/admin/link-styles";
import { subscriptionStatusLabel } from "@/lib/admin/unmatched-labels";
import { requireAdmin } from "@/lib/auth/require-admin";
import { formatARS, formatDateAR } from "@/lib/format";
import { STATUS_LABELS } from "@/lib/members/labels";
import { cancelEffect } from "@/lib/mp/cancel-effect";
import { isKnownDead } from "@/lib/mp/subscription-status";
import { prisma } from "@/lib/prisma";
import { CancelForm } from "./cancel-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cancelar débito — SIGeV" };

const BASE = "/admin/tesoreria/suscripciones";

/** El mismo formato que exige la acción: un id de preapproval de MP y nada más. */
const ID_RE = /^[a-z0-9-]{1,64}$/;

export default async function CancelarSuscripcionPage(props: {
  params: Promise<{ preapprovalId: string }>;
}) {
  const actor = await requireAdmin();
  const { preapprovalId } = await props.params;
  if (!ID_RE.test(preapprovalId)) notFound();
  if (!actor.ok) return <FormMessage kind="error" box>{actor.error}</FormMessage>;

  const sub = await prisma.mpSubscription.findUnique({
    where: { preapprovalId },
    select: {
      status: true, amount: true, lastSyncAt: true,
      member: {
        select: {
          id: true, fullName: true, status: true,
          memberships: { select: { memberNumber: true, book: { select: { status: true } } } },
        },
      },
    },
  });

  if (!sub) {
    return (
      <Blocked>
        <p>Esa suscripción no está en el sistema. Puede que nunca se haya vinculado a un socio.</p>
      </Blocked>
    );
  }
  if (isKnownDead(sub.status)) {
    return (
      <Blocked kind="success">
        <p>Ese débito ya está cancelado: Mercado Pago no le va a volver a cobrar.</p>
      </Blocked>
    );
  }
  if (!sub.member) {
    return (
      <Blocked>
        <p>
          Esa suscripción no tiene socio.{" "}
          <Link className={INLINE_LINK} href={`${BASE}/${preapprovalId}/vincular`}>Vinculala</Link>
          {" antes de cancelarla, así el corte queda registrado en la ficha de alguien."}
        </p>
      </Blocked>
    );
  }
  // La regla, dicha entera: por qué no hay botón y qué hacer en su lugar. Un
  // botón deshabilitado sin explicación deja al operador buscando el permiso que
  // le falta, y lo que falta no es un permiso.
  if (sub.member.status !== "withdrawn") {
    return (
      <Blocked>
        <p>
          {`Desde acá sólo se cancela el débito de quien dejó de ser socio, y ${sub.member.fullName} está `}
          {STATUS_LABELS[sub.member.status].toLowerCase()}
          {": la asociación le sigue cobrando la cuota con derecho."}
        </p>
        <p className="mt-1">
          {"Si corresponde cortarle el cobro, lo que corresponde es la baja: la "}
          <Link className={INLINE_LINK} href={`/admin/socios/${sub.member.id}/baja`}>registrás en la ficha</Link>
          {", queda asentada en un acta y el sistema cancela el débito solo."}
        </p>
      </Blocked>
    );
  }

  return (
    <div className="max-w-2xl space-y-4">
      <BackLink />
      <CancelForm
        preapprovalId={preapprovalId}
        member={{
          fullName: sub.member.fullName,
          memberNumber: sub.member.memberships.find((m) => m.book.status === "open")?.memberNumber ?? null,
        }}
        subscription={{
          amountLabel: sub.amount !== null ? formatARS(Number(sub.amount)) : null,
          statusLabel: subscriptionStatusLabel(sub.status).toLowerCase(),
          // CUATRO desenlaces, no dos: `paused` no cobra hoy pero se reanuda, y
          // un estado que MP invente no se puede afirmar muerto ni vivo. El
          // booleano de antes los aplastaba todos contra "nunca se autorizó".
          effect: cancelEffect(sub.status),
          lastSyncLabel: sub.lastSyncAt ? formatDateAR(sub.lastSyncAt) : null,
        }}
      />
    </div>
  );
}

function Blocked({ kind = "warning", children }: {
  kind?: "warning" | "success";
  children: React.ReactNode;
}) {
  return (
    <div className="max-w-2xl space-y-4">
      <BackLink />
      <FormMessage kind={kind} box as="div">{children}</FormMessage>
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
