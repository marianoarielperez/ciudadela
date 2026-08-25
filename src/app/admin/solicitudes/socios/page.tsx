// Pestaña "De socios": la bandeja donde la Comisión ve y resuelve las bajas
// por renuncia (REG-19) y los cambios de categoría que los socios presentan
// desde `/mi/solicitudes`. Mismo lenguaje visual que esa pantalla —ícono por
// tipo, badge de estado con palabra, el escrito completo en
// `whitespace-pre-line` (ver `REQUEST_TYPE_ICONS`/`REQUEST_STATUS_BADGE_VARIANT`
// en `@/lib/members/labels`, compartidos con `/mi/solicitudes` para que las dos
// pantallas no diverjan)— y mismo conmutador Pendientes|Resueltas que la
// pestaña hermana de Altas (`admin/solicitudes/page.tsx`, Task 6): acá con
// `?estado=resueltas`, porque `?vista=historial` ya lo usa Altas para otra
// cosa y las dos pestañas comparten `layout.tsx`.
//
// `requireAdmin()` propio: el layout de la sección NO protege (ver su
// comentario) — sólo evita filtrarle el TAMAÑO de la cola a alguien que el
// panel ya bloqueó.
import Link from "next/link";
import { EmptyState } from "@/components/admin/empty-state";
import { FormMessage } from "@/components/admin/form-message";
import { PageHeader } from "@/components/admin/page-header";
import { PaginationNav } from "@/components/admin/pagination-nav";
import { RequestTypeIcon } from "@/components/admin/request-type-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { INLINE_LINK } from "@/lib/admin/link-styles";
import { pageHref, paginate, parsePage } from "@/lib/admin/pagination";
import { requireAdmin } from "@/lib/auth/require-admin";
import { formatDateTimeAR } from "@/lib/format";
import {
  CATEGORY_LABELS, REQUEST_STATUS_BADGE_VARIANT, REQUEST_STATUS_LABELS,
  REQUEST_TYPE_LABELS, STATUS_LABELS,
} from "@/lib/members/labels";
import { prisma } from "@/lib/prisma";
import { cn } from "@/lib/utils";
import type { MemberCategory, MemberRequestStatus, MemberRequestType, MemberStatus } from "@/generated/prisma/client";
import { RejectForm } from "./reject-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Solicitudes — SIGeV" };

const BASE = "/admin/solicitudes/socios";
const PAGE_SIZE = 50;
const RESOLVED_STATUSES: MemberRequestStatus[] = ["accepted", "rejected", "cancelled"];

type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

// Mismo segmented que la pestaña hermana de Altas (Task 6).
const SEGMENT_BASE =
  "inline-flex min-h-11 items-center rounded-md px-4 text-sm font-medium outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-ring";
const SEGMENT_ACTIVE = "bg-background text-foreground shadow-sm";
const SEGMENT_INACTIVE = "text-muted-foreground hover:text-foreground";

type RequestRow = {
  id: number;
  type: MemberRequestType;
  status: MemberRequestStatus;
  text: string;
  createdAt: Date;
  decidedAt: Date | null;
  decisionNote: string | null;
  cancelledAt: Date | null;
  decidedBy: { name: string | null } | null;
  movement: { minuteId: number | null } | null;
  member: {
    id: number;
    fullName: string;
    category: MemberCategory;
    status: MemberStatus;
    memberships: { memberNumber: number; book: { status: string } }[];
  };
};

async function fetchRequests(
  status: MemberRequestStatus | { in: MemberRequestStatus[] },
  paging?: { skip: number; take: number },
): Promise<RequestRow[]> {
  return prisma.memberRequest.findMany({
    where: { status },
    orderBy: { id: "desc" },
    skip: paging?.skip,
    take: paging?.take,
    select: {
      id: true, type: true, status: true, text: true, createdAt: true,
      decidedAt: true, decisionNote: true, cancelledAt: true,
      decidedBy: { select: { name: true } },
      movement: { select: { minuteId: true } },
      member: {
        select: {
          id: true, fullName: true, category: true, status: true,
          memberships: { select: { memberNumber: true, book: { select: { status: true } } } },
        },
      },
    },
  });
}

export default async function SolicitudesSociosPage(props: { searchParams: Promise<SearchParams> }) {
  // La página se autoriza a sí misma aunque `admin/layout.tsx` ya bloquee:
  // mismo criterio que la pestaña de Altas — `requireAdmin` resuelve contra la
  // fila viva de `User`, y el layout de la sección sólo mira el token.
  const actor = await requireAdmin();
  if (!actor.ok) {
    return (
      <div className="space-y-4">
        <PageHeader title="Solicitudes" />
        <FormMessage kind="error" box>{actor.error}</FormMessage>
      </div>
    );
  }

  const sp = await props.searchParams;
  const resueltas = one(sp.estado) === "resueltas";

  return (
    <div className="space-y-4">
      <PageHeader title="Solicitudes" />
      <nav aria-label="Vista de la bandeja de socios" className="flex w-fit gap-1 rounded-lg bg-muted p-1">
        <Link
          href={BASE}
          aria-current={!resueltas ? "page" : undefined}
          className={cn(SEGMENT_BASE, !resueltas ? SEGMENT_ACTIVE : SEGMENT_INACTIVE)}
        >
          Pendientes
        </Link>
        <Link
          href={`${BASE}?estado=resueltas`}
          aria-current={resueltas ? "page" : undefined}
          className={cn(SEGMENT_BASE, resueltas ? SEGMENT_ACTIVE : SEGMENT_INACTIVE)}
        >
          Resueltas
        </Link>
      </nav>

      {resueltas ? <ResueltasView sp={sp} /> : <PendientesView />}
    </div>
  );
}

async function PendientesView() {
  const requests = await fetchRequests("pending");

  if (requests.length === 0) {
    return (
      <EmptyState description="No hay solicitudes de socios pendientes. Las nuevas aparecen acá solas." />
    );
  }

  return (
    <div className="space-y-3">
      {requests.map((request) => (
        <RequestCard key={request.id} request={request} resolved={false} />
      ))}
    </div>
  );
}

async function ResueltasView({ sp }: { sp: SearchParams }) {
  const total = await prisma.memberRequest.count({ where: { status: { in: RESOLVED_STATUSES } } });

  if (total === 0) {
    return <EmptyState description="Todavía no se resolvió ninguna solicitud de socios." />;
  }

  const { page, pageCount, skip, take } = paginate(total, parsePage(sp), PAGE_SIZE);
  const requests = await fetchRequests({ in: RESOLVED_STATUSES }, { skip, take });

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {requests.map((request) => (
          <RequestCard key={request.id} request={request} resolved />
        ))}
      </div>
      <PaginationNav
        page={page}
        pageCount={pageCount}
        href={(n) => pageHref(BASE, { estado: "resueltas" }, n)}
        label="Páginas de resueltas"
      />
    </div>
  );
}

function applyHref(request: RequestRow): string {
  const path = request.type === "withdrawal" ? "baja" : "categoria";
  return `/admin/socios/${request.member.id}/${path}?solicitud=${request.id}`;
}

function RequestCard({ request, resolved }: { request: RequestRow; resolved: boolean }) {
  const number = request.member.memberships.find((m) => m.book.status === "open")?.memberNumber;

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2" className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <span className="flex items-center gap-2">
            <RequestTypeIcon type={request.type} className="size-4 text-primary" />
            {REQUEST_TYPE_LABELS[request.type]}
          </span>
          <Badge variant={REQUEST_STATUS_BADGE_VARIANT[request.status]}>
            {REQUEST_STATUS_LABELS[request.status]}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <Link className={cn(INLINE_LINK, "font-medium")} href={`/admin/socios/${request.member.id}`}>
            {request.member.fullName}
          </Link>
          <span className="text-muted-foreground">
            N° {number ?? "—"} · {CATEGORY_LABELS[request.member.category]} · {STATUS_LABELS[request.member.status]}
          </span>
        </p>
        <p className="text-xs text-muted-foreground">
          Presentada el {formatDateTimeAR(request.createdAt)}
        </p>
        {/* Texto plano SIEMPRE, mismo criterio que `/mi/solicitudes`: viene de
            `renderWithdrawalText` o del servicio, nunca HTML. `message` no se
            repite acá aparte: ya viene dentro del escrito. */}
        <p className="whitespace-pre-line text-sm">{request.text}</p>

        {resolved ? (
          <div className="space-y-1 border-t pt-2 text-sm text-muted-foreground">
            {request.status === "cancelled" ? (
              <p>Retirada por el socio el {request.cancelledAt ? formatDateTimeAR(request.cancelledAt) : "—"}.</p>
            ) : (
              <p>
                {request.decidedBy?.name ?? "—"}
                {" · "}
                {request.decidedAt ? formatDateTimeAR(request.decidedAt) : "—"}
              </p>
            )}
            {request.decisionNote && (
              <FormMessage kind="neutral" box className="whitespace-pre-line">
                {request.decisionNote}
              </FormMessage>
            )}
            {request.movement?.minuteId && (
              <Link className={INLINE_LINK} href={`/admin/actas/${request.movement.minuteId}`}>
                Ver acta
              </Link>
            )}
          </div>
        ) : (
          <>
            <div className="pt-1">
              <Button asChild className="min-h-11">
                <Link href={applyHref(request)}>Aplicar</Link>
              </Button>
            </div>
            <RejectForm requestId={request.id} />
          </>
        )}
      </CardContent>
    </Card>
  );
}
