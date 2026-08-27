// Etapa C del cierre (M6 §9): la VISTA PREVIA obligatoria y, después del
// cierre, el resumen de lo que pasó.
//
// La vista previa es la última pantalla antes del acto más grave del módulo:
// el mapeo completo número viejo → número nuevo, las bajas del proceso, los
// bloqueos y advertencias del checklist, y el aviso con todas las letras de
// que esto solo se revierte restaurando un backup. Es una foto CONSULTIVA: la
// transacción re-valida todo adentro, así que un bloqueo aparecido a último
// momento aborta el cierre aunque esta pantalla dijera que se podía.
//
// `requireSuperadmin()` propio, con el mismo criterio que el resto del cierre:
// acá se listan nombres del padrón entero (Ley 25.326) y se ofrece cerrar el
// libro. Y el chequeo de la página es sólo la mitad: la autorización real
// vuelve a hacerse dentro de la action.
import Link from "next/link";

import { EmptyState } from "@/components/admin/empty-state";
import { FormMessage } from "@/components/admin/form-message";
import { PageHeader } from "@/components/admin/page-header";
import { Button } from "@/components/ui/button";
import type { MinuteType } from "@/generated/prisma/client";
import { requireSuperadmin } from "@/lib/auth/require-admin";
import { formatDateAR } from "@/lib/format";
import { MINUTE_TYPE_LABELS } from "@/lib/members/labels";
import { prisma } from "@/lib/prisma";
import { closeBookService } from "@/lib/reregistration/close-book";
import { canPrepareClose } from "@/lib/reregistration/rules";
import { LIVE_PROCESS_STATUSES } from "@/lib/reregistration/service";
import { withdrawals } from "@/lib/reregistration/withdrawals";
import { civilDayOf } from "@/lib/treasury/periods";
import { ConfirmCloseForm } from "./confirm-close-form";
import {
  CloseBlockersNotice, CloseWarnings, IrreversibleWarning, MigrationPreview,
} from "./confirm-panels";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cerrar el libro — SIGeV" };

const NUM = "font-mono tabular-nums";

const BREADCRUMB = [
  { label: "Reempadronamiento", href: "/admin/reempadronamiento" },
  { label: "Cierre", href: "/admin/reempadronamiento/cierre" },
  { label: "Confirmar" },
];

/** El resumen post-cierre viaja por querystring — ids y conteos, nada personal.
 *  Cualquier parámetro roto vale lo mismo que no tenerlo: se vuelve a la vista
 *  previa, que con el proceso ya cerrado dice que no hay nada que cerrar. */
function parseDone(sp: Record<string, string | string[] | undefined>) {
  const num = (v: string | string[] | undefined) => {
    const n = Number(v);
    return typeof v === "string" && Number.isInteger(n) && n >= 0 ? n : null;
  };
  const closed = num(sp.cerrado);
  const opened = num(sp.nuevo);
  const migrated = num(sp.migrados);
  const withdrawn = num(sp.bajas);
  if (closed === null || opened === null || migrated === null || withdrawn === null) return null;
  return { closed, opened, migrated, withdrawn, audited: sp.asiento !== "0" };
}

export default async function ConfirmarCierrePage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireSuperadmin();
  if (!actor.ok) {
    return (
      <div className="space-y-4">
        <PageHeader title="Cerrar el libro" breadcrumb={BREADCRUMB} />
        <FormMessage kind="error" box>{actor.error}</FormMessage>
      </div>
    );
  }

  const done = parseDone(await props.searchParams);
  if (done) return <ClosedSummary {...done} />;

  // La MISMA consulta que el resto del módulo usa para encontrar el proceso
  // vivo — no la clave de configuración, que es del sitio público.
  const process = await prisma.reregistrationProcess.findFirst({
    where: { status: { in: [...LIVE_PROCESS_STATUSES] } },
    orderBy: { id: "desc" },
    select: { id: true, status: true, secondEndsAt: true, book: { select: { number: true } } },
  });

  if (!process) {
    return (
      <div className="space-y-6">
        <PageHeader title="Cerrar el libro" breadcrumb={BREADCRUMB} />
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

  const canClose = canPrepareClose(process);
  const [preview, checklist, unnotified, minuteRows, minuteMaxByType] = await Promise.all([
    closeBookService.preview(process.id),
    // Para las ADVERTENCIAS (mora, cartelera): los bloqueos ya vienen en la
    // vista previa, contados con los mismos `where` que la transacción.
    withdrawals.closeChecklist(process.id),
    withdrawals.listUnnotifiedWithdrawals(process.id),
    prisma.minute.findMany({ orderBy: [{ date: "desc" }, { id: "desc" }], take: 30 }),
    // El número siguiente por tipo, para SUGERIR el del acta de cierre. Se
    // pregunta por el máximo y no por la lista de arriba, que viene ordenada por
    // fecha y recortada a 30: el índice único es (tipo, número), y un número ya
    // usado se rechazaría recién al confirmar.
    prisma.minute.groupBy({ by: ["type"], _max: { number: true } }),
  ]);
  const arrears = checklist.preconditions.find((p) => p.kind === "arrears_candidates")?.count ?? 0;
  const oldNumber = process.book.number;
  const minutes = minuteRows.map((m) => ({
    id: m.id,
    label: `${MINUTE_TYPE_LABELS[m.type]} N° ${m.number} — ${formatDateAR(m.date)}`,
  }));
  const nextMinuteNumber = (type: MinuteType) =>
    (minuteMaxByType.find((g) => g.type === type)?._max.number ?? 0) + 1;
  // Con qué arranca el acta de cierre: NUEVA, de Comisión Directiva, con el
  // número siguiente y la fecha de hoy. El día se resuelve con el calendario
  // argentino (`civilDayOf`) y no con el reloj UTC del server: a las 21:00 de
  // acá UTC ya está en el día siguiente y el acta de cierre nacería fechada
  // mañana. La sugerencia va por tipo porque la numeración lo es.
  const minuteDefaults = {
    type: "board" as const,
    numberByType: { board: nextMinuteNumber("board"), assembly: nextMinuteNumber("assembly") },
    date: civilDayOf().toISOString().slice(0, 10),
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Cerrar el libro" breadcrumb={BREADCRUMB}>
        <p className="text-sm text-muted-foreground">
          Libro N° <span className={NUM}>{oldNumber}</span> ·{" "}
          <span className={NUM}>{preview.withdrawnCount}</span>{" "}
          {preview.withdrawnCount === 1 ? "baja declarada" : "bajas declaradas"} en el proceso ·{" "}
          <span className={NUM}>{preview.migrants.length}</span>{" "}
          {preview.migrants.length === 1 ? "socio migra" : "socios migran"}
        </p>
      </PageHeader>

      <IrreversibleWarning oldNumber={oldNumber} newNumber={preview.newBookNumber} />

      {!canClose && (
        <FormMessage kind="warning" box role="none">
          {process.secondEndsAt
            ? `Todavía no se puede cerrar: la segunda instancia vence el ${formatDateAR(process.secondEndsAt)} y el convocado tiene ese día entero para presentarse.`
            : "Todavía no se puede cerrar: la segunda instancia no se abrió. Abrila desde el tablero del proceso."}
        </FormMessage>
      )}

      <CloseBlockersNotice blockers={preview.blockers} />
      <CloseWarnings arrears={arrears} unnotified={unnotified} />

      {preview.migrants.length === 0 ? (
        // Imposible con datos reales (un libro sin un solo vigente), pero nunca
        // un thead sin filas — y un cierre que no migra a nadie merece pararse
        // a mirar, no un botón.
        <EmptyState
          size="list"
          description="Ningún socio vigente quedó para migrar al libro nuevo. Revisá el padrón antes de cerrar."
        />
      ) : (
        <MigrationPreview
          migrants={preview.migrants}
          oldNumber={oldNumber}
          newNumber={preview.newBookNumber}
        />
      )}

      {canClose && preview.blockers.length === 0 && preview.migrants.length > 0 && (
        <ConfirmCloseForm
          processId={process.id}
          oldNumber={oldNumber}
          newNumber={preview.newBookNumber}
          migrantCount={preview.migrants.length}
          minutes={minutes}
          minuteDefaults={minuteDefaults}
        />
      )}
    </div>
  );
}

/** El resumen: qué pasó y a dónde seguir. El libro viejo queda como foto para
 *  siempre; el export del padrón nuevo es la ruta de la fase A, que lista el
 *  libro por número — sirve para el N+1 sin tocarla. */
function ClosedSummary({ closed, opened, migrated, withdrawn, audited }: {
  closed: number;
  opened: number;
  migrated: number;
  withdrawn: number;
  audited: boolean;
}) {
  return (
    <div className="space-y-6">
      <PageHeader
        title={`Libro N° ${closed} cerrado`}
        breadcrumb={[
          { label: "Reempadronamiento", href: "/admin/reempadronamiento" },
          { label: "Cierre", href: "/admin/reempadronamiento/cierre" },
          { label: "Resumen" },
        ]}
      />

      <FormMessage kind="success" box>
        El Libro N° <span className={NUM}>{closed}</span> quedó cerrado con su foto, y el Libro N°{" "}
        <span className={NUM}>{opened}</span> quedó abierto con{" "}
        <span className={NUM}>{migrated}</span>{" "}
        {migrated === 1 ? "socio asentado" : "socios asentados"}, renumerados desde 1 por
        antigüedad. El proceso registró{" "}
        <span className={NUM}>{withdrawn}</span> {withdrawn === 1 ? "baja" : "bajas"}. El sitio
        público volvió a ofrecer asociarse.
      </FormMessage>

      {!audited && (
        <FormMessage kind="warning" box>
          El cierre quedó asentado en la base, pero el asiento de auditoría no se pudo escribir.
          Anotá el cierre a mano y avisale a quien administra el sistema: el libro nuevo es válido,
          lo que falta es la constancia en el registro de auditoría.
        </FormMessage>
      )}

      <div className="flex flex-wrap gap-3">
        <Button asChild className="min-h-11 px-4">
          <Link href={`/admin/socios/libros/${opened}`}>Ver el Libro N° {opened}</Link>
        </Button>
        <Button asChild variant="outline" className="min-h-11 px-4">
          {/* <a> y no <Link>: es una descarga, no una navegación del router. */}
          <a href={`/api/admin/libros/${opened}/export`}>Exportar el padrón nuevo</a>
        </Button>
        <Button asChild variant="outline" className="min-h-11 px-4">
          <Link href={`/admin/socios/libros/${closed}`}>Ver el Libro N° {closed} (la foto)</Link>
        </Button>
        <Button asChild variant="outline" className="min-h-11 px-4">
          <Link href="/admin/socios">Ir al padrón</Link>
        </Button>
      </div>
    </div>
  );
}
