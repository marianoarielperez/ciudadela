// La COLA de validación del re-empadronamiento: donde la Comisión ve lo que los
// vecinos presentaron y decide.
//
// Cuatro vistas por URL (`?estado=`), no cuatro pestañas de cliente: deep-link,
// botón atrás y `aria-current` salen solos, y los contadores del tablero pueden
// enlazar derecho a la vista que corresponde a cada estado. Las cuatro y sus
// filtros viven en `@/lib/admin/presentation-queue`, compartidas con esos
// contadores, para que un chip no pueda llevar a una vista donde su estado no
// se lista.
//
// El orden de la cola es `submittedAt` ASCENDENTE, y es lo contrario del resto
// del panel (las bandejas listan por id descendente). Acá es una COLA de
// verdad: la presentación que llegó primero es la que lleva más tiempo
// esperando y a la que menos plazo le queda para subsanar si hay que
// observarla. Ordenar por lo más nuevo dejaría al fondo justo a quien más
// urgencia tiene.
//
// La vista "Sin presentar" no es una cola: es la lista de trabajo del TELÉFONO.
// Lista a los convocados que todavía no hicieron nada con el estado de su aviso
// —le llegó el correo, le tocó el cartel de la sede, o no hay rastro— para que
// el operador sepa a quién llamar y con qué. Se ordena por número de socio, que
// es como se busca a alguien en el padrón de papel.
//
// `requireAdmin()` propio y no heredado del layout: acá se listan nombres de
// socios (Ley 25.326, docs/08). Mismo criterio que `/admin/solicitudes/socios`
// y que el tablero de la sección.
import Link from "next/link";

import { EmptyState } from "@/components/admin/empty-state";
import { FormMessage } from "@/components/admin/form-message";
import { PageHeader } from "@/components/admin/page-header";
import { PresentationChannelIcon } from "@/components/admin/presentation-channel-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { NotificationType, PresentationChannel, PresentationStatus } from "@/generated/prisma/client";
import { INLINE_LINK } from "@/lib/admin/link-styles";
import {
  parseQueueView, PRESENTATIONS_BASE, QUEUE_VIEWS, queueHref, queueView,
} from "@/lib/admin/presentation-queue";
import { presentationStatusBadgeVariant } from "@/lib/admin/status-badges";
import { requireAdmin } from "@/lib/auth/require-admin";
import { boardNotices } from "@/lib/board/notice";
import { formatDateTimeAR } from "@/lib/format";
import { PRESENTATION_STATUS_LABELS } from "@/lib/members/labels";
import { prisma } from "@/lib/prisma";
import { LIVE_PROCESS_STATUSES } from "@/lib/reregistration/service";
import { cn } from "@/lib/utils";
import { AddToBoardChip } from "../avisos/board-notice-card";
import { bouncedAfterSend, classifyNotice, type NoticeVerdict } from "../board-panels";

export const dynamic = "force-dynamic";
export const metadata = { title: "Presentaciones — SIGeV" };

const NUM = "font-mono tabular-nums";

// Mismo segmented que las dos bandejas de `/admin/solicitudes`.
const SEGMENT_BASE =
  "inline-flex min-h-11 items-center rounded-md px-4 text-sm font-medium outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-ring";
const SEGMENT_ACTIVE = "bg-background text-foreground shadow-sm";
const SEGMENT_INACTIVE = "text-muted-foreground hover:text-foreground";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function PresentacionesPage(props: { searchParams: Promise<SearchParams> }) {
  const actor = await requireAdmin();
  if (!actor.ok) {
    return (
      <div className="space-y-4">
        <PageHeader title="Presentaciones" />
        <FormMessage kind="error" box>{actor.error}</FormMessage>
      </div>
    );
  }

  // El proceso vivo se busca por ESTADO y no por la clave de configuración,
  // igual que el tablero: el panel sigue el estado, el público sigue la clave, y
  // la divergencia entre los dos la avisa el tablero.
  const process = await prisma.reregistrationProcess.findFirst({
    where: { status: { in: [...LIVE_PROCESS_STATUSES] } },
    orderBy: { id: "desc" },
    select: { id: true, bookId: true, createdAt: true, secondEndsAt: true, book: { select: { number: true } } },
  });

  const header = (
    <PageHeader
      title="Presentaciones"
      breadcrumb={[
        { label: "Reempadronamiento", href: "/admin/reempadronamiento" },
        { label: "Presentaciones" },
      ]}
      actions={
        process && (
          <Button asChild variant="outline" className="min-h-11 px-4">
            <Link href="/admin/reempadronamiento/presencial">Cargar presencial</Link>
          </Button>
        )
      }
    />
  );

  if (!process) {
    return (
      <div className="space-y-4">
        {header}
        <EmptyState
          size="list"
          description="No hay ningún proceso de re-empadronamiento en curso, así que no hay presentaciones que revisar."
          action={
            <Button asChild className="min-h-11 px-4">
              <Link href="/admin/reempadronamiento">Ir a Reempadronamiento</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const sp = await props.searchParams;
  const view = queueView(parseQueueView(sp.estado));

  return (
    <div className="space-y-4">
      {header}
      <nav aria-label="Vista de la cola" className="flex w-fit flex-wrap gap-1 rounded-lg bg-muted p-1">
        {QUEUE_VIEWS.map((v) => {
          const active = v.key === view.key;
          return (
            <Link
              key={v.key}
              href={queueHref(v.key)}
              aria-current={active ? "page" : undefined}
              className={cn(SEGMENT_BASE, active ? SEGMENT_ACTIVE : SEGMENT_INACTIVE)}
            >
              {v.label}
            </Link>
          );
        })}
      </nav>

      {view.key === "sin-presentar" ? (
        <MissingView process={process} empty={view.empty} />
      ) : (
        <QueueView
          processId={process.id}
          bookId={process.bookId}
          statuses={view.statuses}
          empty={view.empty}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Las tres vistas de presentaciones (pendientes, observadas, resueltas)
// ─────────────────────────────────────────────────────────────────────────────

async function QueueView({ processId, bookId, statuses, empty }: {
  processId: number;
  bookId: number;
  statuses: PresentationStatus[];
  empty: string;
}) {
  const rows = await prisma.presentation.findMany({
    where: { processId, status: { in: statuses } },
    // La cola de verdad: primero la que llegó primero. `id` desempata para que
    // dos presentaciones del mismo instante tengan un orden estable entre
    // recargas (sin él, MariaDB puede devolverlas al revés y la lista "salta").
    orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
    select: {
      id: true, status: true, channel: true, submittedAt: true, observation: true,
      validatedAt: true,
      validatedBy: { select: { name: true } },
      member: {
        select: {
          id: true, fullName: true,
          memberships: { where: { bookId }, select: { memberNumber: true } },
        },
      },
    },
  });

  if (rows.length === 0) return <EmptyState size="list" description={empty} />;

  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <Card key={row.id}>
          <CardContent className="space-y-2 pt-6">
            <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                <Link className={cn(INLINE_LINK, "font-medium")} href={`${PRESENTATIONS_BASE}/${row.id}`}>
                  {row.member.fullName}
                </Link>
                <span className="text-muted-foreground">
                  N° <span className={NUM}>{row.member.memberships[0]?.memberNumber ?? "—"}</span>
                </span>
                {row.channel && (
                  <span className="inline-flex items-center text-muted-foreground">
                    <PresentationChannelIcon channel={row.channel as PresentationChannel} className="size-4" />
                  </span>
                )}
              </p>
              <Badge variant={presentationStatusBadgeVariant(row.status)}>
                {PRESENTATION_STATUS_LABELS[row.status]}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {row.submittedAt
                ? <>Presentada el <span className={NUM}>{formatDateTimeAR(row.submittedAt)}</span></>
                : "Sin fecha de presentación"}
              {row.validatedAt && (
                <>
                  {" · resuelta el "}
                  <span className={NUM}>{formatDateTimeAR(row.validatedAt)}</span>
                  {row.validatedBy?.name ? ` por ${row.validatedBy.name}` : ""}
                </>
              )}
            </p>
            {/* La nota del operador (observación o motivo del rechazo) se
                muestra en la tarjeta: es lo que explica por qué esa fila está
                donde está, y obligar a abrir el detalle para leerla convierte
                un repaso de la cola en veinte clics. */}
            {row.observation && (
              <FormMessage kind="neutral" box className="whitespace-pre-line">
                {row.observation}
              </FormMessage>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// "Sin presentar": la lista de trabajo del teléfono
// ─────────────────────────────────────────────────────────────────────────────

/** Qué se le dijo (o no) a este convocado. Los cuatro veredictos salen de
 *  `classifyNotice`, la misma función con la que el tablero decide a quién le
 *  faltó el aviso: acá no se vuelve a escribir el criterio. */
const NOTICE_TEXT: Record<NoticeVerdict, string> = {
  sent: "le llegó el aviso por correo",
  board: "sin casilla: le toca el cartel de la sede",
  failed: "el aviso por correo falló",
  no_trace: "no hay rastro de que le haya salido el aviso",
};

const NOTICE_VARIANT: Record<NoticeVerdict, "outline" | "secondary" | "destructive"> = {
  sent: "outline",
  board: "outline",
  failed: "destructive",
  no_trace: "secondary",
};

async function MissingView({ process, empty }: {
  process: { id: number; bookId: number; createdAt: Date; secondEndsAt: Date | null };
  empty: string;
}) {
  // De qué instancia se habla. `secondEndsAt` es lo único que marca que la
  // segunda ya se abrió (mismo criterio que el tablero).
  const noticeType: NotificationType =
    process.secondEndsAt !== null ? "reregistration_second" : "reregistration_first";

  // Quién sigue esperando el cartel de la sede en un aviso COMPLEMENTARIO. Sale
  // del dominio (`kind: "other"`), no de una regla escrita otra vez acá: lo que
  // la fila ofrece tiene que ser exactamente lo que la action acepta.
  const pendingBoard = new Set(
    (await boardNotices.listRecipients({ processId: process.id, kind: "other" })).map(
      (r) => r.memberId,
    ),
  );

  const rows = await prisma.presentation.findMany({
    where: { processId: process.id, status: "pending" },
    select: {
      id: true,
      member: {
        select: {
          id: true, fullName: true, phone: true, email: true, emailStatus: true,
          // ACOTADAS A ESTE PROCESO por `createdAt`: sin ese piso, el
          // re-empadronamiento del Libro 2 leería el aviso que ese mismo socio
          // recibió en el del Libro 1 —mismo `type`— y lo daría por avisado.
          // Es el mismo piso que usa el tablero, y por el mismo motivo.
          notifications: {
            where: { type: noticeType, sentAt: { gte: process.createdAt } },
            select: { status: true },
          },
          memberships: { where: { bookId: process.bookId }, select: { memberNumber: true } },
        },
      },
    },
  });

  if (rows.length === 0) return <EmptyState size="list" description={empty} />;

  // Por número de socio, que es como se busca a alguien en el padrón de papel.
  // El orden no se puede pedir en el `orderBy` de Prisma (el número vive en
  // `Membership`, que acá es una relación filtrada), así que se ordena en
  // memoria: son ~124 filas.
  const sorted = rows
    .map((row) => ({
      presentationId: row.id,
      memberId: row.member.id,
      fullName: row.member.fullName,
      phone: row.member.phone,
      number: row.member.memberships[0]?.memberNumber ?? null,
      verdict: classifyNotice({
        email: row.member.email,
        emailStatus: row.member.emailStatus,
        notices: row.member.notifications,
      }),
      // El rebote POSTERIOR al envío masivo: le salió el correo, la casilla
      // rebotó después y por eso no entró en ningún cartel. Hoy no está
      // notificado por ninguna vía y el plazo le corre igual. Las dos
      // condiciones tienen que darse: que el hecho sea ése (`bouncedAfterSend`)
      // y que el dominio efectivamente lo espere en un aviso complementario.
      lateBounce:
        bouncedAfterSend({
          email: row.member.email,
          emailStatus: row.member.emailStatus,
          notices: row.member.notifications,
        }) && pendingBoard.has(row.member.id),
    }))
    .sort((a, b) => (a.number ?? Number.MAX_SAFE_INTEGER) - (b.number ?? Number.MAX_SAFE_INTEGER));

  return (
    <div className="space-y-3">
      <p className="max-w-3xl text-sm text-muted-foreground">
        Convocados que todavía no presentaron nada. Al lado de cada uno, qué se le dijo: es la lista
        para llamar por teléfono. Si el vecino se acerca a la sede, cargale la presentación desde{" "}
        <Link className={INLINE_LINK} href="/admin/reempadronamiento/presencial">Cargar presencial</Link>.
      </p>
      <ul className="list-none space-y-2 p-0">
        {sorted.map((row) => (
          <li key={row.presentationId}>
            <Card>
              <CardContent className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-4 text-sm">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-muted-foreground">
                    N° <span className={NUM}>{row.number ?? "—"}</span>
                  </span>
                  <Link className={cn(INLINE_LINK, "font-medium")} href={`/admin/socios/${row.memberId}`}>
                    {row.fullName}
                  </Link>
                  {/* El teléfono es el dato que hace útil esta lista: sin él,
                      "llamalo" es una instrucción sin número. */}
                  {row.phone && <span className={cn(NUM, "text-muted-foreground")}>{row.phone}</span>}
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  <Badge variant={NOTICE_VARIANT[row.verdict]}>
                    {row.lateBounce ? "el correo le rebotó después del envío" : NOTICE_TEXT[row.verdict]}
                  </Badge>
                  {row.lateBounce && (
                    <AddToBoardChip
                      processId={process.id}
                      memberId={row.memberId}
                      memberName={row.fullName}
                    />
                  )}
                </span>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
