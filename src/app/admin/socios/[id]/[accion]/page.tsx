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
import { formatARS, formatDateAR } from "@/lib/format";
import { AUTO_DEBIT_WARNINGS, autoDebitSignal, type AutoDebitSignal } from "@/lib/members/auto-debit";
import { CATEGORY_LABELS, MINUTE_TYPE_LABELS, REASON_LABELS } from "@/lib/members/labels";
import { canChangeCategory, canReadmit, canSuspend, canWithdraw } from "@/lib/members/rules";
import { electionsOngoing } from "@/lib/members/service";
import { feeValueReader } from "@/lib/treasury/fee-values";
import { debtAmount } from "@/lib/treasury/rules";
import { FormMessage } from "@/components/admin/form-message";
import { PageHeader } from "@/components/admin/page-header";
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
  // Hoja del breadcrumb: sustantivo corto, no el h1 repetido. El h1 lleva el
  // socio ("Dar de baja a Juan Pérez"); la miga solo la acción ("Baja").
  crumb: string;
  notice?: string;
  // Motivo estatutario por el que la acción no se puede hacer ahora. Si está,
  // se muestra en lugar del formulario.
  blocked?: string;
  // ReactNode y no string: el aviso del reingreso lleva el enlace a Efectivo,
  // que es la pantalla donde se cobra la deuda que el aviso está reclamando.
  warning?: React.ReactNode;
  action: Parameters<typeof ActionForm>[0]["action"];
  submitLabel: string;
  fields?: Field[];
};

const CATEGORY_OPTIONS = Object.entries(CATEGORY_LABELS) as [string, string][];
const DETAIL_FIELD: Field = { kind: "text", name: "detail", label: "Detalle (opcional)", maxLength: 300 };

function blockedBy(r: { ok: true } | { ok: false; error: string }): string | undefined {
  return r.ok ? undefined : r.error;
}

/** Lo que el socio debe HOY según la cuenta corriente, valuado al valor
 *  vigente (`amount` es null si todavía no rige ninguno). */
type Debt = { pendingCount: number; amount: number | null };

function screenFor(
  slug: Slug, member: Member, elections: boolean, autoDebit: AutoDebitSignal, debt: Debt,
): Screen {
  switch (slug) {
    case "baja":
      return {
        title: `Dar de baja a ${member.fullName}`,
        crumb: "Baja",
        notice: "La baja queda asentada con acta, en el historial y en auditoría. No borra datos.",
        blocked: blockedBy(canWithdraw(member)),
        // Se muestra aunque la pantalla esté bloqueada, y a propósito: si la
        // baja ya está hecha y el débito sigue vivo, es todavía más urgente que
        // el operador lo vea. El aviso no bloquea nada, sólo cuenta lo que este
        // formulario no hace (ver members/auto-debit.ts). El texto depende de
        // QUÉ señal lo disparó: con la suscripción delante se afirma, con el
        // flag del padrón a secas se manda a verificar en el panel de MP.
        warning: autoDebit === "none" ? undefined : AUTO_DEBIT_WARNINGS.baja[autoDebit],
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
        crumb: "Cambio de categoría",
        notice: `Categoría actual: ${CATEGORY_LABELS[member.category]}. El cambio no interrumpe la antigüedad (Art. 5° ter).`,
        blocked: blockedBy(canChangeCategory(member, probe, elections, debt.pendingCount)),
        // La cuota la fija la categoría: cambiarla acá no reajusta el monto que
        // MP le sigue debitando (ver members/auto-debit.ts).
        warning: autoDebit === "none" ? undefined : AUTO_DEBIT_WARNINGS.categoria[autoDebit],
        action: changeCategoryAction,
        submitLabel: "Cambiar categoría",
        fields: [{ kind: "select", name: "newCategory", label: "Nueva categoría", options }],
      };
    }

    case "suspension":
      if (member.status === "suspended") {
        return {
          title: `Levantar la suspensión de ${member.fullName}`,
          crumb: "Fin de suspensión",
          notice: `Suspendido desde ${member.suspendedFrom ? formatDateAR(member.suspendedFrom) : "—"} hasta ${member.suspendedTo ? formatDateAR(member.suspendedTo) : "—"}.`,
          action: endSuspensionAction,
          submitLabel: "Levantar suspensión",
        };
      }
      return {
        title: `Suspender a ${member.fullName}`,
        crumb: "Suspensión",
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
        crumb: "Reingreso",
        blocked: blockedBy(canReadmit(member)),
        // REG-16: el reingreso con deuda exige saldarla a valores vigentes. La
        // deuda sale de las cuotas pendientes VIVAS, no del motivo de la baja ni
        // del `debtAtWithdrawal` congelado: el que ya pagó no tiene que ver el
        // aviso. No bloquea la pantalla — la decisión es de la Comisión.
        warning: debt.pendingCount > 0 ? (
          <>
            {`Debe ${debt.pendingCount} ${debt.pendingCount === 1 ? "cuota" : "cuotas"}`}
            {debt.amount !== null ? ` = ${formatARS(debt.amount)} a valor vigente` : ""}
            {" (Art. 9 inc. c, REG-16). Cobrale primero la deuda en "}
            <Link className="underline" href={`/admin/tesoreria/efectivo?socio=${member.id}`}>
              Tesorería → Efectivo
            </Link>
            {": al socio dado de baja se le puede cobrar sin reingresarlo. El sistema no bloquea el "}
            {"reingreso con deuda porque la decisión es de la Comisión, pero queda asentado en auditoría."}
          </>
        ) : undefined,
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

  const [minuteRows, elections, subscriptions, pendingCount, feeValue] = await Promise.all([
    prisma.minute.findMany({ orderBy: [{ date: "desc" }, { id: "desc" }], take: 30 }),
    electionsOngoing(prisma),
    // Las dos señales del débito vivo: el flag del padrón viene en la ficha, las
    // suscripciones que el sistema conoce salen de acá. Por qué hacen falta las
    // dos, en members/auto-debit.ts.
    prisma.mpSubscription.findMany({ where: { memberId }, select: { status: true } }),
    prisma.fee.count({ where: { memberId, status: "pending" } }),
    feeValueReader.current(),
  ]);
  const debt: Debt = {
    pendingCount,
    amount: feeValue ? debtAmount(pendingCount, member.category, feeValue) : null,
  };
  const minutes = minuteRows.map((m) => ({
    id: m.id, label: `${MINUTE_TYPE_LABELS[m.type]} N° ${m.number} — ${formatDateAR(m.date)}`,
  }));
  const autoDebit = autoDebitSignal({
    autoDebit: member.autoDebit,
    subscriptionStatuses: subscriptions.map((s) => s.status),
  });
  const screen = screenFor(accion as Slug, member, elections, autoDebit, debt);

  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader
        title={screen.title}
        breadcrumb={[
          { label: "Socios", href: "/admin/socios" },
          { label: member.fullName, href: `/admin/socios/${member.id}` },
          { label: screen.crumb },
        ]}
      />
      {screen.notice && <p className="text-sm text-muted-foreground">{screen.notice}</p>}
      {screen.warning && (
        <FormMessage kind="warning" box as="div">{screen.warning}</FormMessage>
      )}

      {screen.blocked ? (
        <div className="space-y-3">
          <FormMessage kind="error" box>{screen.blocked}</FormMessage>
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
