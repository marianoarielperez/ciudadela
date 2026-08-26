// El tablero del re-empadronamiento del Art. 9° bis: la sección donde la
// Comisión convoca el proceso y lo sigue.
//
// Tres ramas y una sola pantalla: sin proceso vivo (estado vacío + historial),
// con proceso vivo (el tablero) y bloqueado (sin permiso). Lo que decide cuál
// es LA MISMA consulta que usa la action de convocatoria como guarda
// (`LIVE_PROCESS_STATUSES`), y no la clave de configuración: si las dos
// divergieran, la pantalla ofrecería convocar y la action contestaría "ya hay un
// proceso en curso". La clave se lee igual, para AVISAR de la divergencia —de
// ella depende que el sitio público suspenda las asociaciones y muestre
// REEMPADRONATE—.
//
// `requireAdmin()` propio y no heredado del layout: acá se listan nombres de
// socios (Ley 25.326, docs/08). Precedente: `/admin/solicitudes/socios`,
// `/admin/socios/libros`.
//
// El segundo `requireSuperadmin()` es SÓLO display —qué botones se dibujan—. La
// autorización real vuelve a hacerse dentro de cada action; el rol del token
// puede tener hasta 8 horas de atraso. Mismo patrón que `/admin/tesoreria/valores`.
import Link from "next/link";

import { EmptyState } from "@/components/admin/empty-state";
import { FormMessage } from "@/components/admin/form-message";
import { PageHeader } from "@/components/admin/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { NotificationType } from "@/generated/prisma/client";
import { INLINE_LINK } from "@/lib/admin/link-styles";
import { PRESENTATIONS_BASE } from "@/lib/admin/presentation-queue";
import { requireAdmin, requireSuperadmin } from "@/lib/auth/require-admin";
import { CONFIG_KEYS, configReader } from "@/lib/config";
import { formatDateAR } from "@/lib/format";
import { PROCESS_STATUS_LABELS } from "@/lib/members/labels";
import { prisma } from "@/lib/prisma";
import { canPrepareClose, hasExpired } from "@/lib/reregistration/rules";
import {
  CALL_AUDIT_ACTION, LIVE_PROCESS_STATUSES, PROCESS_AUDIT_ENTITY, reregistration,
  SECOND_AUDIT_ACTION,
} from "@/lib/reregistration/service";
import {
  boardAudience, BoardNoticesPanel, classifyNotice, CounterChips, ProcessVerdict, Section,
  UnnotifiedPanel, type UnnotifiedRow,
} from "./board-panels";
import { daysLeftLabel, ProcessStepper } from "./process-stepper";
import { SecondInstanceForm } from "./second-instance-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reempadronamiento — SIGeV" };

const NUM = "font-mono tabular-nums";

export default async function ReempadronamientoPage() {
  const [actor, sa] = await Promise.all([requireAdmin(), requireSuperadmin()]);
  if (!actor.ok) {
    // Pantalla de bloqueo, NO redirect: acá no falta la sesión, falta un rol, y
    // /redirigir lo mandaría de vuelta al panel (mismo criterio que /admin/salud).
    return (
      <div className="space-y-4">
        <PageHeader title="Reempadronamiento" />
        <FormMessage kind="error" box>{actor.error}</FormMessage>
      </div>
    );
  }
  const superadmin = sa.ok;

  const process = await prisma.reregistrationProcess.findFirst({
    where: { status: { in: [...LIVE_PROCESS_STATUSES] } },
    orderBy: { id: "desc" },
    select: {
      id: true, bookId: true, status: true, calledAt: true, firstEndsAt: true, secondEndsAt: true,
      igjApprovedAt: true, estimatedElectionAt: true, callMinuteId: true, createdAt: true,
      book: { select: { number: true } },
    },
  });

  if (!process) {
    const closed = await prisma.reregistrationProcess.findMany({
      where: { status: "closed" },
      orderBy: { id: "desc" },
      select: {
        id: true, calledAt: true, firstEndsAt: true, secondEndsAt: true,
        book: { select: { number: true } },
        _count: { select: { presentations: true } },
      },
    });

    return (
      <div className="space-y-6">
        <PageHeader
          title="Reempadronamiento"
          actions={
            // El link se dibuja sólo para el superadmin; la ruta y la action
            // cortan igual por su cuenta.
            superadmin && (
              <Button asChild className="min-h-11 px-4">
                <Link href="/admin/reempadronamiento/convocar">Convocar proceso</Link>
              </Button>
            )
          }
        />
        <EmptyState
          size="list"
          description="No hay ningún proceso en curso. La convocatoria abre la depuración de adherentes del libro vigente."
          action={
            superadmin ? (
              <Button asChild className="min-h-11 px-4">
                <Link href="/admin/reempadronamiento/convocar">Convocar proceso</Link>
              </Button>
            ) : undefined
          }
        />
        {closed.length > 0 && (
          <Card>
            <CardHeader><CardTitle>Procesos anteriores</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              {closed.map((p) => (
                <p key={p.id}>
                  <span className="font-medium">Libro N° <span className={NUM}>{p.book.number}</span></span>
                  {" — convocado el "}<span className={NUM}>{formatDateAR(p.calledAt)}</span>
                  {", "}<span className={NUM}>{p._count.presentations}</span>{" convocados."}
                </p>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  // ── Proceso vivo: el tablero ───────────────────────────────────────────────
  const now = new Date();
  // Cuál instancia está en juego decide QUÉ aviso se busca. `secondEndsAt` es la
  // marca de que la segunda ya se abrió: es lo único que la fija.
  const onSecond = process.secondEndsAt !== null;
  const noticeType: NotificationType = onSecond ? "reregistration_second" : "reregistration_first";
  const deadline = onSecond ? process.secondEndsAt : process.firstEndsAt;

  const [counters, liveKey, rows, notices, batchEntry] = await Promise.all([
    reregistration.counters(process.id),
    configReader.getString(CONFIG_KEYS.reregistrationProcessId),
    prisma.presentation.findMany({
      where: { processId: process.id },
      orderBy: { memberId: "asc" },
      select: {
        status: true,
        member: {
          select: {
            id: true, fullName: true, email: true, emailStatus: true,
            // ACOTADAS A ESTE PROCESO. `Notification` no tiene columna de
            // proceso, así que sin este piso el re-empadronamiento del Libro 2
            // leería el aviso que ese mismo socio recibió en el del Libro 1
            // —mismo `type`— y lo daría por avisado: el panel diría "todos los
            // convocados con casilla recibieron el aviso" sin que se hubiera
            // mandado uno solo. Falso negativo silencioso en el único panel que
            // existe para que no haya falsos negativos, y justo en el segundo
            // proceso, que es un requisito explícito del cliente.
            //
            // El piso es `createdAt` y NO `calledAt`: `calledAt` es una fecha
            // CIVIL a mediodía UTC —las 09:00 de acá— y además puede ser
            // anterior (es la fecha del acta), así que un aviso salido a las
            // 08:00 del mismo día quedaría por debajo del piso y se perdería.
            // `createdAt` es el instante en que se escribió la fila del proceso,
            // y TODO aviso suyo sale después de ese commit.
            notifications: {
              where: { type: noticeType, sentAt: { gte: process.createdAt } },
              select: { status: true },
            },
            memberships: { where: { bookId: process.bookId }, select: { memberNumber: true } },
          },
        },
      },
    }),
    prisma.boardNotice.findMany({
      where: { processId: process.id },
      orderBy: { id: "asc" },
      select: { id: true, kind: true, postedAt: true, dueAt: true },
    }),
    // El asiento de la instancia en curso: de ahí sale el TAMAÑO DEL LOTE de
    // cartelera que efectivamente se generó (`detail.boardCount`). Va por el
    // índice `[entity, entityId]` de `audit_log`, igual que el aviso de
    // solicitud revivida en `/admin/solicitudes/[id]`.
    prisma.auditLog.findFirst({
      where: {
        action: onSecond ? SECOND_AUDIT_ACTION : CALL_AUDIT_ACTION,
        entity: PROCESS_AUDIT_ENTITY,
        entityId: String(process.id),
      },
      orderBy: { id: "desc" },
      select: { detail: true },
    }),
  ]);

  // A quién le correspondía el aviso de ESTA instancia. En la primera, a toda la
  // cohorte; en la segunda, sólo a los que no tienen la presentación aprobada —
  // es el mismo filtro con el que `startSecond` eligió a quién escribirle, y por
  // eso se repite el `notIn` y no un "los que faltan" propio.
  const expected = onSecond
    ? rows.filter((r) => r.status !== "submitted" && r.status !== "validated")
    : rows;

  const verdicts = expected.map((r) => ({
    member: r.member,
    verdict: classifyNotice({
      email: r.member.email,
      emailStatus: r.member.emailStatus,
      notices: r.member.notifications,
    }),
  }));
  const unnotified: UnnotifiedRow[] = verdicts
    .filter((v) => v.verdict === "failed" || v.verdict === "no_trace")
    .map((v) => ({
      memberId: v.member.id,
      memberNumber: v.member.memberships[0]?.memberNumber ?? null,
      fullName: v.member.fullName,
      verdict: v.verdict as UnnotifiedRow["verdict"],
    }));
  // Los destinatarios del cartel salen del LOTE asentado, no del padrón vivo:
  // a cada adherente al que le cargan el correo durante el plazo el conteo en
  // vivo lo descuenta, y la nómina impresa que está en la pared no cambia.
  const audience = boardAudience({
    auditDetail: batchEntry?.detail ?? null,
    liveCount: verdicts.filter((v) => v.verdict === "board").length,
  });

  // `hasExpired` y no una comparación propia: es el único comparador de plazos
  // del módulo, y compara día civil contra día civil (el día del vencimiento el
  // socio lo tiene entero).
  const expired = deadline !== null && hasExpired(deadline, now);
  const canClose = canPrepareClose(process, now);
  const keyMatches = liveKey !== null && Number(liveKey) === process.id;

  return (
    <div className="space-y-6">
      {/* Sin miga: es una sección de primer nivel y la miga de un solo ítem
          repetía el título. Las otras secciones de primer nivel del panel no la
          llevan, y la rama de estado vacío de esta misma pantalla tampoco. */}
      <PageHeader title="Reempadronamiento">
        <p className="text-sm text-muted-foreground">
          Libro N° <span className={NUM}>{process.book.number}</span> ·{" "}
          {PROCESS_STATUS_LABELS[process.status]} ·{" "}
          <Link className={INLINE_LINK} href={`/admin/actas/${process.callMinuteId}`}>
            acta de convocatoria
          </Link>
          {process.igjApprovedAt && <> · oficialización IGJ el <span className={NUM}>{formatDateAR(process.igjApprovedAt)}</span></>}
          {process.estimatedElectionAt && <> · elecciones estimadas el <span className={NUM}>{formatDateAR(process.estimatedElectionAt)}</span></>}
        </p>
      </PageHeader>

      {/* La divergencia entre el proceso vivo y la clave de configuración no es
          cosmética: de esa clave dependen la suspensión de ASOCIATE y el botón
          REEMPADRONATE del sitio público. Si el aviso aparece, el vecino no ve
          el wizard aunque el plazo le esté corriendo.

          Va con `role="none"`, como el veredicto de acá abajo: es el ESTADO de
          la pantalla al abrirla y no la respuesta a una acción, así que un
          `alert` interrumpiría al lector de pantalla en cada recarga. */}
      {!keyMatches && (
        <FormMessage kind="error" box role="none">
          El sitio público no está apuntando a este proceso (la clave{" "}
          <code>{CONFIG_KEYS.reregistrationProcessId}</code> dice{" "}
          <code>{liveKey ?? "nada"}</code>). Mientras siga así, ASOCIATE no queda suspendido y el
          botón REEMPADRONATE no aparece.
        </FormMessage>
      )}

      <ProcessVerdict
        status={process.status}
        counters={counters}
        firstEndsAt={process.firstEndsAt}
        secondEndsAt={process.secondEndsAt}
        expired={expired}
        bookNumber={process.book.number}
      />

      <Section id="linea" title="Línea del proceso">
        <ProcessStepper process={process} daysLeft={counters.daysLeft} />
      </Section>

      <Section
        id="presentaciones"
        title="Presentaciones"
        hint={
          <>
            Estado de los convocados. Cada pastilla abre la{" "}
            <Link className={INLINE_LINK} href={PRESENTATIONS_BASE}>cola de validación</Link>{" "}
            filtrada por ese estado. Para el vecino que se acerca a la sede,{" "}
            <Link className={INLINE_LINK} href="/admin/reempadronamiento/presencial">
              cargá la presentación presencial
            </Link>.
          </>
        }
      >
        <CounterChips byStatus={counters.byStatus} />
      </Section>

      {(process.status === "first_instance" || process.status === "second_instance") && (
        <UnnotifiedPanel
          rows={unnotified}
          instanceLabel={onSecond ? "la segunda instancia" : "la convocatoria"}
        />
      )}

      <BoardNoticesPanel notices={notices} audience={audience} />

      <Section id="fases" title="Acciones de fase">
        {process.status === "first_instance" ? (
          <SecondInstanceForm
            processId={process.id}
            superadmin={superadmin}
            expired={expired}
            deadlineLabel={formatDateAR(process.firstEndsAt)}
            // LA MISMA función que la línea de proceso y el veredicto. Escrita
            // a mano acá decía "faltan 1 días" y "faltan 0 días" — y el 0 no es
            // "faltan 0": ese día el socio lo tiene entero.
            daysLeftLabel={counters.daysLeft === null ? "" : daysLeftLabel(counters.daysLeft)}
          />
        ) : (
          <FormMessage kind="neutral" role="none">
            La segunda instancia ya se abrió.
          </FormMessage>
        )}

        {/* TODO (M6 fase 6C): la pantalla de cierre —checklist, bajas por lote y
            migración al libro nuevo— llega con esa fase. Hasta entonces el
            control queda inerte a propósito: enlazarlo hoy sería un 404, y un
            botón que no hace nada es peor que uno que dice por qué no. */}
        <div className="flex flex-wrap items-center gap-3 border-t pt-4">
          <Button type="button" variant="outline" size="lg" className="min-h-11 px-4" disabled>
            Preparar cierre
          </Button>
          <FormMessage kind="neutral" as="span" role="none">
            {canClose
              ? "El plazo ya venció; la pantalla de cierre del libro todavía no está disponible."
              : process.secondEndsAt
                ? `Se habilita al vencer la segunda instancia (${formatDateAR(process.secondEndsAt)}).`
                : "Se habilita al vencer la segunda instancia."}
          </FormMessage>
        </div>
      </Section>
    </div>
  );
}
