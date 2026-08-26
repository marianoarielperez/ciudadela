// Cierre del libro, etapas A y B (M6 §9): el checklist que dice si se puede
// cerrar, y la declaración de las bajas de quienes no se re-empadronaron.
//
// La etapa C —la transacción que cierra el libro y abre el siguiente— llega en
// la tarea que sigue. Esta pantalla la prepara: sin desenlace para todos los
// convocados, aquella transacción no puede correr.
//
// `requireSuperadmin()` propio y no heredado de ningún layout: acá se listan
// nombres de socios (Ley 25.326, docs/08) y se ofrece el acto más grave del
// módulo. Y no es un `redirect`: acá no falta la sesión, falta un rol, y
// /redirigir devolvería al panel sin decir por qué (mismo criterio que
// /admin/salud y que el tablero del proceso).
//
// El chequeo de la página es sólo la mitad: la autorización real vuelve a
// hacerse dentro de cada action, porque una server action no se despacha por su
// URL sino por el id del encabezado `Next-Action`.
import Link from "next/link";

import { EmptyState } from "@/components/admin/empty-state";
import { FormMessage } from "@/components/admin/form-message";
import { PageHeader } from "@/components/admin/page-header";
import { Button } from "@/components/ui/button";
import { INLINE_LINK } from "@/lib/admin/link-styles";
import { requireSuperadmin } from "@/lib/auth/require-admin";
import { formatDateAR } from "@/lib/format";
import { MINUTE_TYPE_LABELS, PROCESS_STATUS_LABELS } from "@/lib/members/labels";
import { prisma } from "@/lib/prisma";
import { closeBlockers } from "@/lib/reregistration/close";
import { canPrepareClose } from "@/lib/reregistration/rules";
import { LIVE_PROCESS_STATUSES } from "@/lib/reregistration/service";
import { withdrawals } from "@/lib/reregistration/withdrawals";
import { BoardInProgress, CloseChecklist, CloseVerdict, Section } from "./close-panels";
import { WithdrawalNoticeButton } from "./withdrawal-notice-button";
import { WithdrawalBatch } from "./withdrawal-batch";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cierre del libro — SIGeV" };

const NUM = "font-mono tabular-nums";

export default async function CierrePage() {
  const actor = await requireSuperadmin();
  if (!actor.ok) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="Cierre del libro"
          breadcrumb={[{ label: "Reempadronamiento", href: "/admin/reempadronamiento" }, { label: "Cierre" }]}
        />
        <FormMessage kind="error" box>{actor.error}</FormMessage>
      </div>
    );
  }

  // La MISMA consulta que usa el tablero y que la action de convocatoria usa
  // como guarda, y no la clave de configuración: si divergieran, esta pantalla
  // ofrecería cerrar un proceso que la action no reconoce.
  const process = await prisma.reregistrationProcess.findFirst({
    where: { status: { in: [...LIVE_PROCESS_STATUSES] } },
    orderBy: { id: "desc" },
    select: {
      id: true, status: true, calledAt: true, firstEndsAt: true, secondEndsAt: true,
      book: { select: { number: true } },
    },
  });

  const header = (
    <PageHeader
      title="Cierre del libro"
      breadcrumb={[{ label: "Reempadronamiento", href: "/admin/reempadronamiento" }, { label: "Cierre" }]}
    >
      {process && (
        <p className="text-sm text-muted-foreground">
          Libro N° <span className={NUM}>{process.book.number}</span> ·{" "}
          {PROCESS_STATUS_LABELS[process.status]}
          {process.secondEndsAt && (
            <> · la segunda instancia venció el <span className={NUM}>{formatDateAR(process.secondEndsAt)}</span></>
          )}
        </p>
      )}
    </PageHeader>
  );

  if (!process) {
    return (
      <div className="space-y-6">
        {header}
        <EmptyState
          size="list"
          description="No hay ningún proceso de re-empadronamiento en curso, así que no hay ningún libro para cerrar."
          action={
            <Button asChild variant="outline" className="min-h-11 px-4">
              <Link href="/admin/reempadronamiento">Ir al tablero</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const now = new Date();
  const canClose = canPrepareClose(process, now);
  const [{ preconditions, openNotices }, pending, minuteRows] = await Promise.all([
    withdrawals.closeChecklist(process.id),
    withdrawals.listPendingWithdrawals(process.id),
    prisma.minute.findMany({ orderBy: [{ date: "desc" }, { id: "desc" }], take: 30 }),
  ]);
  const blockers = closeBlockers(preconditions);
  const minutes = minuteRows.map((m) => ({
    id: m.id,
    label: `${MINUTE_TYPE_LABELS[m.type]} N° ${m.number} — ${formatDateAR(m.date)}`,
  }));

  return (
    <div className="space-y-6">
      {header}

      <CloseVerdict preconditions={preconditions} blockers={blockers} />

      {!canClose && (
        // No es lo mismo que un bloqueante del checklist: acá el plazo del
        // vecino TODAVÍA CORRE, y se puede presentar hasta el último día. El
        // aviso va arriba de todo el trabajo porque apaga el botón de abajo.
        <FormMessage kind="warning" box role="none">
          {process.secondEndsAt
            ? `Todavía no se puede declarar ninguna baja: la segunda instancia vence el ${formatDateAR(process.secondEndsAt)} y el convocado tiene ese día entero para presentarse.`
            : "Todavía no se puede declarar ninguna baja: la segunda instancia no se abrió. Abrila desde el tablero del proceso."}
        </FormMessage>
      )}

      <Section
        id="checklist"
        title="Checklist previo al cierre"
        hint={
          <>
            Lo que hay que resolver antes de cerrar el libro y abrir el siguiente (Art. 40). Dos
            condiciones frenan el cierre y dos sólo avisan — entre las que avisan está la mora, que
            es <strong>otra causal, con su propia acta</strong>: el sistema muestra el número y no
            declara ninguna cesantía por su cuenta (REG-15).
          </>
        }
      >
        <CloseChecklist preconditions={preconditions} blockers={blockers} />
      </Section>

      {openNotices.length > 0 && (
        <Section
          id="cartelera-en-curso"
          title="Avisos de cartelera en curso"
          hint="Contexto: no frenan el cierre, pero son plazos que están corriendo."
        >
          <BoardInProgress notices={openNotices} />
        </Section>
      )}

      <Section
        id="bajas"
        title="Bajas por no haberse re-empadronado"
        hint={
          <>
            Cada tarjeta es una persona que deja de ser socia por resolución fundada de la Comisión
            (Art. 9° bis inc. c), y lo que lleva debajo —qué se le notificó, por qué vía y en qué
            fecha— es el <strong>anexo que el acta necesita</strong> para que la resolución sea
            oponible (REG-23). Desde la notificación fehaciente le corren 30 días para recurrir ante
            la asamblea. Revisá la lista antes de tildar: quien tiene notificaciones en blanco no
            debería entrar al lote.
          </>
        }
      >
        <WithdrawalBatch
          processId={process.id}
          rows={pending}
          minutes={minutes}
          // Sólo display: la action vuelve a resolver `requireSuperadmin` y a
          // revalidar el vencimiento contra la fila viva del proceso.
          canDeclare={canClose}
          blockedReason={canClose ? undefined : "El plazo de la segunda instancia todavía corre."}
        />
      </Section>

      <Section
        id="cartel-de-bajas"
        title="Cartel de bajas para la sede"
        hint={
          <>
            A quien no tiene casilla utilizable la baja se le notifica por la cartelera de la sede, y
            la notificación queda practicada recién <strong>al cumplirse los veinte días hábiles</strong>{" "}
            (Art. 5° ter) — no el día en que se cuelga el papel. Generá el cartel cuando hayas
            terminado los lotes; después imprimilo y asentá la fijación desde el{" "}
            <Link className={INLINE_LINK} href="/admin/reempadronamiento#cartelera">
              tablero del proceso
            </Link>.
          </>
        }
      >
        <WithdrawalNoticeButton processId={process.id} />
      </Section>
    </div>
  );
}
