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
import { requireAdmin, requireSuperadmin } from "@/lib/auth/require-admin";
import { CONFIG_KEYS, configReader } from "@/lib/config";
import { formatDateAR } from "@/lib/format";
import { PROCESS_STATUS_LABELS } from "@/lib/members/labels";
import { prisma } from "@/lib/prisma";
import { canPrepareClose, hasExpired } from "@/lib/reregistration/rules";
import { LIVE_PROCESS_STATUSES, reregistration } from "@/lib/reregistration/service";
import {
  BoardNoticesPanel, classifyNotice, CounterChips, ProcessVerdict, Section, UnnotifiedPanel,
  type UnnotifiedRow,
} from "./board-panels";
import { ProcessStepper } from "./process-stepper";
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
      igjApprovedAt: true, estimatedElectionAt: true, callMinuteId: true,
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

  const [counters, liveKey, rows, notices] = await Promise.all([
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
            notifications: { where: { type: noticeType }, select: { status: true } },
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
  const withoutMailbox = verdicts.filter((v) => v.verdict === "board").length;

  // `hasExpired` y no una comparación propia: es el único comparador de plazos
  // del módulo, y compara día civil contra día civil (el día del vencimiento el
  // socio lo tiene entero).
  const expired = deadline !== null && hasExpired(deadline, now);
  const canClose = canPrepareClose(process, now);
  const keyMatches = liveKey !== null && Number(liveKey) === process.id;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reempadronamiento"
        breadcrumb={[{ label: "Reempadronamiento" }]}
      >
        <p className="text-sm text-muted-foreground">
          Libro N° <span className={NUM}>{process.book.number}</span> ·{" "}
          {PROCESS_STATUS_LABELS[process.status]} ·{" "}
          <Link className="text-primary hover:underline" href={`/admin/actas/${process.callMinuteId}`}>
            acta de convocatoria
          </Link>
          {process.igjApprovedAt && <> · oficialización IGJ el <span className={NUM}>{formatDateAR(process.igjApprovedAt)}</span></>}
          {process.estimatedElectionAt && <> · elecciones estimadas el <span className={NUM}>{formatDateAR(process.estimatedElectionAt)}</span></>}
        </p>
      </PageHeader>

      {/* La divergencia entre el proceso vivo y la clave de configuración no es
          cosmética: de esa clave dependen la suspensión de ASOCIATE y el botón
          REEMPADRONATE del sitio público. Si el aviso aparece, el vecino no ve
          el wizard aunque el plazo le esté corriendo. */}
      {!keyMatches && (
        <FormMessage kind="error" box>
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
        hint="Estado de los convocados. La cola para validar, observar y rechazar llega en la próxima pantalla de la sección."
      >
        <CounterChips byStatus={counters.byStatus} />
      </Section>

      {(process.status === "first_instance" || process.status === "second_instance") && (
        <UnnotifiedPanel
          rows={unnotified}
          instanceLabel={onSecond ? "la segunda instancia" : "la convocatoria"}
        />
      )}

      <BoardNoticesPanel notices={notices} withoutMailbox={withoutMailbox} />

      <Section id="fases" title="Acciones de fase">
        {process.status === "first_instance" ? (
          <SecondInstanceForm
            processId={process.id}
            superadmin={superadmin}
            expired={expired}
            deadlineLabel={formatDateAR(process.firstEndsAt)}
            daysLeftLabel={counters.daysLeft === null ? "" : `faltan ${counters.daysLeft} días`}
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
