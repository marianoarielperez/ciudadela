// Una sola ruta paramétrica para las cuatro acciones societarias:
// /admin/socios/7/baja, /categoria, /suspension, /reingreso. Cada slug elige su
// server action, su copy y sus campos; cargar el socio, cargar las actas, el
// layout y el formulario se escriben una vez.
//
// La pantalla también decide si la acción es POSIBLE, corriendo las mismas
// reglas puras que el servicio. Ofrecerle a un admin el formulario de reingreso
// de un expulsado sería invitarlo a algo que el estatuto prohíbe sin excepción:
// mejor decírselo antes que después de que complete el acta. El rechazo del
// lado del servidor sigue estando: esto es el cartel, no la cerradura.
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatDateAR } from "@/lib/format";
import { CATEGORY_LABELS, MINUTE_TYPE_LABELS, REASON_LABELS } from "@/lib/members/labels";
import { canChangeCategory, canReadmit, canSuspend, canWithdraw } from "@/lib/members/rules";
import { electionsOngoing } from "@/lib/members/service";
import { Button } from "@/components/ui/button";
import { ActionForm, type Field } from "../action-form";
import {
  changeCategoryAction, endSuspensionAction, readmitAction, suspendAction, withdrawAction,
} from "../actions";
import type { Member, MemberCategory } from "@/generated/prisma/client";

export const dynamic = "force-dynamic";

const SLUGS = ["baja", "categoria", "suspension", "reingreso"] as const;
type Slug = (typeof SLUGS)[number];

type Screen = {
  title: string;
  notice?: string;
  // Motivo estatutario por el que la acción no se puede hacer ahora. Si está,
  // se muestra en lugar del formulario.
  blocked?: string;
  warning?: string;
  action: Parameters<typeof ActionForm>[0]["action"];
  submitLabel: string;
  fields?: Field[];
};

const CATEGORY_OPTIONS = Object.entries(CATEGORY_LABELS) as [string, string][];
const DETAIL_FIELD: Field = { kind: "text", name: "detail", label: "Detalle (opcional)", maxLength: 300 };

function blockedBy(r: { ok: true } | { ok: false; error: string }): string | undefined {
  return r.ok ? undefined : r.error;
}

function screenFor(slug: Slug, member: Member, elections: boolean): Screen {
  switch (slug) {
    case "baja":
      return {
        title: `Dar de baja a ${member.fullName}`,
        notice: "La baja queda asentada con acta, en el historial y en auditoría. No borra datos.",
        blocked: blockedBy(canWithdraw(member)),
        action: withdrawAction,
        submitLabel: "Registrar baja",
        fields: [
          { kind: "select", name: "reason", label: "Motivo (catálogo REG-18)", options: Object.entries(REASON_LABELS) },
          DETAIL_FIELD,
        ],
      };

    case "categoria": {
      const options = CATEGORY_OPTIONS.filter(([v]) => v !== member.category);
      // Probamos la regla con una categoría distinta cualquiera en vez de repetir
      // acá los mensajes de rules.ts: lo que se está preguntando es si el socio
      // puede cambiar de categoría, no a cuál.
      const probe = (options[0]?.[0] ?? member.category) as MemberCategory;
      return {
        title: `Cambiar categoría de ${member.fullName}`,
        notice: `Categoría actual: ${CATEGORY_LABELS[member.category]}. El cambio no interrumpe la antigüedad (Art. 5° ter).`,
        blocked: blockedBy(canChangeCategory(member, probe, elections)),
        action: changeCategoryAction,
        submitLabel: "Cambiar categoría",
        fields: [{ kind: "select", name: "newCategory", label: "Nueva categoría", options }],
      };
    }

    case "suspension":
      if (member.status === "suspended") {
        return {
          title: `Levantar la suspensión de ${member.fullName}`,
          notice: `Suspendido desde ${member.suspendedFrom ? formatDateAR(member.suspendedFrom) : "—"} hasta ${member.suspendedTo ? formatDateAR(member.suspendedTo) : "—"}.`,
          action: endSuspensionAction,
          submitLabel: "Levantar suspensión",
        };
      }
      return {
        title: `Suspender a ${member.fullName}`,
        notice: "La suspensión no puede exceder 180 días (Art. 10 inc. b).",
        blocked: blockedBy(canSuspend(member)),
        action: suspendAction,
        submitLabel: "Suspender",
        fields: [
          { kind: "date", name: "from", label: "Desde" },
          { kind: "date", name: "to", label: "Hasta" },
          DETAIL_FIELD,
        ],
      };

    case "reingreso":
      return {
        title: `Reingreso de ${member.fullName}`,
        blocked: blockedBy(canReadmit(member)),
        // REG-16: el reingreso del cesante por mora exige saldar la deuda a
        // valores vigentes. No bloquea la pantalla — el cobro se hace en
        // tesorería papel hasta que el Módulo 4 sepa calcular el monto.
        warning: member.withdrawalReason === "arrears" && member.debtAtWithdrawal
          ? "Cesante por mora con deuda: para reingresar debe saldar la totalidad de la deuda a valores vigentes (Art. 9 inc. c). El cálculo del monto estará disponible con el Módulo 4 — registrá el cobro en tesorería papel antes de confirmar."
          : undefined,
        action: readmitAction,
        submitLabel: "Registrar reingreso",
        fields: [
          {
            kind: "select", name: "category", label: "Categoría de reingreso",
            options: CATEGORY_OPTIONS, initial: member.category,
          },
        ],
      };
  }
}

export default async function AccionPage(props: { params: Promise<{ id: string; accion: string }> }) {
  const { id, accion } = await props.params;
  if (!SLUGS.includes(accion as Slug)) notFound();
  // Mismo criterio que la ficha: con "abc" o "1e9" Number() da NaN y Prisma
  // tiraría un error técnico en inglés en vez de un 404.
  const memberId = Number(id);
  if (!Number.isInteger(memberId) || memberId <= 0) notFound();

  const member = await prisma.member.findUnique({ where: { id: memberId } });
  if (!member) notFound();

  const [minuteRows, elections] = await Promise.all([
    prisma.minute.findMany({ orderBy: [{ date: "desc" }, { id: "desc" }], take: 30 }),
    electionsOngoing(prisma),
  ]);
  const minutes = minuteRows.map((m) => ({
    id: m.id, label: `${MINUTE_TYPE_LABELS[m.type]} N° ${m.number} — ${formatDateAR(m.date)}`,
  }));
  const screen = screenFor(accion as Slug, member, elections);

  return (
    <div className="max-w-2xl space-y-4">
      <p className="text-sm text-muted-foreground">
        <Link href="/admin/socios" className="hover:underline">Socios</Link>
        {" / "}
        <Link href={`/admin/socios/${member.id}`} className="hover:underline">{member.fullName}</Link>
      </p>
      <h1 className="text-2xl font-semibold">{screen.title}</h1>
      {screen.notice && <p className="text-sm text-muted-foreground">{screen.notice}</p>}
      {screen.warning && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {screen.warning}
        </p>
      )}

      {screen.blocked ? (
        <div className="space-y-3">
          <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {screen.blocked}
          </p>
          <Button asChild variant="outline">
            <Link href={`/admin/socios/${member.id}`}>Volver a la ficha</Link>
          </Button>
        </div>
      ) : (
        <ActionForm
          action={screen.action}
          memberId={member.id}
          minutes={minutes}
          submitLabel={screen.submitLabel}
          fields={screen.fields}
        />
      )}
    </div>
  );
}
