// Bandeja de Altas (el wizard web): la pestaña "Altas" de la sección
// Solicitudes. Dos vistas por querystring —Pendientes (default) e
// Historial— con el mismo conmutador de `tesoreria/sin-conciliar/page.tsx`.
// Las pestañas las pone `layout.tsx`; el encabezado (`PageHeader`, con su
// único <h1> de la pantalla) lo pone ACÁ — el layout dejó de ponerlo
// (arreglo 1 de la revisión de la tarea 6: eran dos <h1> por pantalla).
//
// Pendientes es una COLA de trabajo, no una tabla paginada: las tres
// bandejas vivas (`pending_payment`, `approved_pending_minute`,
// `pending_board`) rara vez pasan de unas pocas decenas, así que se traen
// enteras y se ordenan por accionabilidad — lo asentable sin más trámite
// primero — en vez de recortarlas a una página. Por eso NO reusa
// `makeApplicationQueries.fetchPage` (un único `status`, orden fijo por
// fecha desc, paginado de a 50): es una consulta propia, hecha acá. Historial
// sí lo reusa tal cual, que es exactamente lo que ya hacía.
import Link from "next/link";
import { AtSign, MapPinOff, UserPlus } from "lucide-react";
import type { ApplicationStatus, MemberCategory } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { formatDateAR } from "@/lib/format";
import { requireAdmin } from "@/lib/auth/require-admin";
import { APPLICATION_STATUS_LABELS } from "@/lib/applications/labels";
import {
  fetchApprovedAfterExpiry, makeApplicationQueries, parseApplicationFilters,
  parseApplicationsPage, showsNoDebitBadge, showsReentryBadge, showsUnknownDebitBadge,
} from "@/lib/applications/query";
import { collisionsFor, findEmailCollisions } from "@/lib/applications/email-collision";
import { RECORDABLE_STATUSES } from "@/lib/applications/record";
import { categoryAllowedForResidence } from "@/lib/applications/wizard";
import { CATEGORY_LABELS, MINUTE_TYPE_LABELS } from "@/lib/members/labels";
import { applicationStatusBadgeVariant } from "@/lib/admin/status-badges";
import { SELECT_CLASS } from "@/lib/admin/field-styles";
import { INLINE_LINK } from "@/lib/admin/link-styles";
import { pageHref } from "@/lib/admin/pagination";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/admin/empty-state";
import { FormMessage } from "@/components/admin/form-message";
import { PageHeader } from "@/components/admin/page-header";
import { PaginationNav } from "@/components/admin/pagination-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { recordApplicationsAction } from "./actions";
import { ApplicationCards } from "./application-cards";

export const dynamic = "force-dynamic";

export const metadata = { title: "Solicitudes — SIGeV" };

const BASE = "/admin/solicitudes";

type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const SEGMENT_BASE =
  "inline-flex min-h-11 items-center rounded-md px-4 text-sm font-medium outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-ring";
const SEGMENT_ACTIVE = "bg-background text-foreground shadow-sm";
const SEGMENT_INACTIVE = "text-muted-foreground hover:text-foreground";

// Orden de la cola de Pendientes: primero lo asentable SIN más trámite
// (`approved_pending_minute`), después lo que espera decisión de la CD
// (`pending_board` — también asentable, pero recién después de esa
// decisión), por último lo que ni siquiera pagó (`pending_payment`, que no
// se puede tildar). Dentro de cada grupo, `fetchQueue` ya trae fecha
// ascendente: la más vieja de la cola primero.
const QUEUE_STATUSES: ApplicationStatus[] = ["approved_pending_minute", "pending_board", "pending_payment"];
const QUEUE_RANK: Record<string, number> = {
  approved_pending_minute: 0,
  pending_board: 1,
  pending_payment: 2,
};

const recordable = (status: string) => (RECORDABLE_STATUSES as readonly string[]).includes(status);

type QueueRow = {
  id: number;
  fullName: string;
  dni: string;
  requestedCategory: MemberCategory;
  wantsDebit: boolean;
  status: ApplicationStatus;
  memberId: number | null;
  email: string;
  createdAt: Date;
  subscriptionStatus: string | null;
  residenceMismatch: boolean;
};

async function fetchQueue(): Promise<QueueRow[]> {
  const rows = await prisma.application.findMany({
    where: { status: { in: QUEUE_STATUSES } },
    // Fecha ascendente PRIMERO: es lo que hace de esto una cola. El orden por
    // accionabilidad se aplica después, en JS, con un sort estable — no altera
    // el orden por fecha dentro de cada grupo.
    orderBy: { createdAt: "asc" },
    select: {
      id: true, fullName: true, dni: true, requestedCategory: true, wantsDebit: true,
      // `email` no se muestra en la tarjeta: alimenta el cruce de casillas en
      // uso (`findEmailCollisions`), que es UNA consulta para toda la cola.
      status: true, memberId: true, email: true, createdAt: true,
      subscriptions: { select: { status: true }, orderBy: { createdAt: "desc" }, take: 1 },
      // Sólo para derivar `residenceMismatch` (mismo criterio EXACTO que
      // `recategorizeApplicationAction`, ver `query.ts`): se aplana abajo y
      // el id de calle no sale de esta función.
      streetId: true,
    },
  });
  return rows
    .map(({ subscriptions, streetId, ...row }) => ({
      ...row,
      subscriptionStatus: subscriptions?.[0]?.status ?? null,
      residenceMismatch: !categoryAllowedForResidence(row.requestedCategory, streetId !== null),
    }))
    .sort((a, b) => QUEUE_RANK[a.status] - QUEUE_RANK[b.status]);
}

export default async function SolicitudesPage(props: { searchParams: Promise<SearchParams> }) {
  // La página se autoriza a sí misma aunque `admin/layout.tsx` ya bloquee: la
  // bandeja lista nombres y DNIs de gente que todavía no es socia (Ley 25.326),
  // y `requireAdmin` resuelve contra la fila viva de User — el layout mira el
  // token, que puede estar hasta 8 h desactualizado tras una degradación.
  const actor = await requireAdmin();
  if (!actor.ok) {
    // El layout ya no pone un encabezado propio (arreglo de la revisión de la
    // tarea 6: dos <h1> por pantalla, uno del layout y otro de acá), así que
    // esta pantalla tiene que poner el suyo también en la rama bloqueada —
    // mismo patrón que ya usan el detalle y el resumen.
    return (
      <div className="space-y-4">
        <PageHeader title="Solicitudes" />
        <FormMessage kind="error" box>{actor.error}</FormMessage>
      </div>
    );
  }

  const sp = await props.searchParams;
  const historial = one(sp.vista) === "historial";

  return (
    <div className="space-y-4">
      <PageHeader title="Solicitudes" />
      <nav aria-label="Vista de la bandeja de Altas" className="flex w-fit gap-1 rounded-lg bg-muted p-1">
        <Link
          href={BASE}
          aria-current={!historial ? "page" : undefined}
          className={cn(SEGMENT_BASE, !historial ? SEGMENT_ACTIVE : SEGMENT_INACTIVE)}
        >
          Pendientes
        </Link>
        <Link
          href={`${BASE}?vista=historial`}
          aria-current={historial ? "page" : undefined}
          className={cn(SEGMENT_BASE, historial ? SEGMENT_ACTIVE : SEGMENT_INACTIVE)}
        >
          Historial
        </Link>
      </nav>

      {historial ? <HistorialView sp={sp} /> : <PendientesView sp={sp} />}
    </div>
  );
}

async function PendientesView({ sp }: { sp: SearchParams }) {
  const [queue, minuteRows] = await Promise.all([
    fetchQueue(),
    prisma.minute.findMany({ orderBy: [{ date: "desc" }, { id: "desc" }], take: 30 }),
  ]);
  const minutes = minuteRows.map((m) => ({
    id: m.id, label: `${MINUTE_TYPE_LABELS[m.type]} N° ${m.number} — ${formatDateAR(m.date)}`,
  }));
  // Las que revivieron: el pago llegó después del vencimiento, así que se
  // aceptaron cuando el cron ya había mandado a cancelarles el débito. Se
  // marcan ACÁ y no sólo en el detalle porque desde esta misma pantalla se
  // las asienta en acta en lote, sin abrirlas. Es UNA consulta para toda la
  // cola.
  //
  // El asiento solo NO alcanza para el badge: prueba que el pago llegó
  // tarde, no que el débito haya quedado cancelado (la cancelación del cron
  // es best-effort). Por eso se cruza con el estado vivo de la suscripción,
  // que viene en la fila — ver `lateEntryNotice`, `showsNoDebitBadge` y
  // `showsUnknownDebitBadge` (sin fila local NO es lo mismo que cancelada).
  // Las dos vueltas que dependen de la cola ya cargada van en paralelo: son
  // independientes entre sí y encadenarlas le sumaba un round trip entero a la
  // pantalla (el detalle ya las junta así).
  //
  // La segunda son las casillas ya en uso en otra parte del sistema (cuenta del
  // portal, ficha de un socio no dado de baja, otra solicitud en trámite). Es un
  // AVISO —un matrimonio que comparte buzón es legítimo—, y se marca ACÁ y no
  // sólo en el detalle por el mismo motivo que "Sin débito": desde esta pantalla
  // se asienta en acta en lote, sin abrir la solicitud. Tres consultas para toda
  // la cola, no tres por tarjeta.
  const [revived, collisions] = await Promise.all([
    fetchApprovedAfterExpiry(prisma, queue.map((r) => r.id)),
    findEmailCollisions(prisma, queue.map((r) => r.email)),
  ]);
  // La exclusión de lo propio la hace `collisionsFor` y no un filtro escrito
  // acá: es el mismo criterio que usa el detalle. Sin cuarto argumento a
  // propósito: la cola lista solicitudes VIVAS, que todavía no tienen la ficha
  // que les crea el asiento. Un `memberId` acá es la ficha `withdrawn` del ex
  // socio que reingresa (la elegibilidad no deja pasar una vigente), y esas ya
  // las descarta la consulta: no hay nada "propio" que sacar.
  const emailInUse = new Set(
    queue.filter((r) => collisionsFor(collisions, r.email, r.id).length > 0).map((r) => r.id),
  );

  // Sólo estas dos pueden llegar al libro; el resto de las tarjetas se listan
  // pero no se pueden tildar. Con ninguna asentable en la cola, la barra de
  // asiento no se muestra: sería un botón que no puede hacer nada.
  const selectableIds = queue.filter((r) => recordable(r.status)).map((r) => r.id);

  // Resultado del asiento anterior, que llega por la URL del redirect. Sólo el
  // éxito COMPLETO redirige acá; el parcial vuelve por el estado del
  // formulario dentro de `ApplicationCards`, que es el único lugar donde
  // entran los motivos de las que no se asentaron.
  const recorded = Number(one(sp.asentadas));

  const cards = (
    <div className="space-y-3">
      {queue.map((app) => (
        <Card key={app.id}>
          <CardHeader>
            <CardTitle as="h2" className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
              <span className="flex items-center gap-2">
                {/* Sólo las asentables se pueden tildar. El servidor lo
                    revalida igual DENTRO de la transacción del asiento: esto
                    es el cartel, no la cerradura. El `<label>` envolvente y
                    no el input pelado agranda el blanco de toque a 44px. */}
                {recordable(app.status) && (
                  <label className="flex min-h-11 min-w-11 items-center justify-center">
                    <input
                      type="checkbox" name="ids" value={app.id} className="size-4"
                      aria-label={`Asentar la solicitud de ${app.fullName}`}
                    />
                  </label>
                )}
                <UserPlus className="size-4 shrink-0 text-primary" aria-hidden />
                <Link className={cn(INLINE_LINK, "font-medium")} href={`/admin/solicitudes/${app.id}`}>
                  {app.fullName}
                </Link>
              </span>
              <Badge variant={applicationStatusBadgeVariant(app.status)}>
                {APPLICATION_STATUS_LABELS[app.status]}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
              {/* La tabla vieja tenía columna "N°"; sin ella acá, el mensaje de
                  éxito parcial ("Solicitud N° {id}") y la miga del detalle
                  ("Solicitud #{id}") nombraban un número que no figuraba en
                  ninguna parte de la pantalla. */}
              <span>N° {app.id}</span>
              <span>DNI {app.dni}</span>
              <span>{CATEGORY_LABELS[app.requestedCategory]}</span>
              <span>Débito {app.wantsDebit ? "Sí" : "No"}</span>
              <span>{formatDateAR(app.createdAt)}</span>
            </p>
            <div className="flex flex-wrap gap-1">
              {/* Un reingreso no se asienta como alta nueva (REG-25): el
                  operador tiene que verlo desde la cola, sin abrir. Ya
                  asentada, la fila no lo afirma: ver `showsReentryBadge`. */}
              {showsReentryBadge(app) && <Badge variant="secondary">Reingreso</Badge>}
              {showsNoDebitBadge(revived.has(app.id), app.subscriptionStatus) && (
                <Badge
                  variant="destructive"
                  title="El pago llegó después del vencimiento: la suscripción figura cancelada."
                >
                  Sin débito
                  {/* El `title` no lo lee un lector de pantalla: el motivo va
                      también como texto. */}
                  <span className="sr-only">
                    {" "}— el pago llegó después del vencimiento y la suscripción figura cancelada
                  </span>
                </Badge>
              )}
              {/* Sin fila local no es lo mismo que cancelada: no hay nada
                  probado sobre el débito (ver `lateEntryNotice`). Variant
                  "outline" y no el otro: pide mirar, no afirma de más. */}
              {showsUnknownDebitBadge(revived.has(app.id), app.subscriptionStatus) && (
                <Badge
                  variant="outline"
                  title="El pago llegó después del vencimiento y no hay ninguna suscripción registrada: no se sabe si sigue debitando."
                >
                  Verificar débito
                  <span className="sr-only">
                    {" "}— el pago llegó después del vencimiento y no hay suscripción registrada
                    localmente: no se sabe si sigue debitando
                  </span>
                </Badge>
              )}
              {/* La categoría pedida no corresponde al domicilio declarado
                  (Art. 5 y 5 bis): mismo criterio que la recategorización
                  manual, no un cálculo aparte (ver `query.ts`). */}
              {app.residenceMismatch && (
                <Badge variant="outline">
                  <MapPinOff className="size-3" aria-hidden />
                  Revisar domicilio
                </Badge>
              )}
              {/* La casilla declarada ya está en uso (cuenta del portal, ficha
                  de un socio vigente u otra solicitud en trámite). Variant
                  "outline" a propósito: compartir buzón entre cónyuges es
                  legítimo y esperable, así que el badge pide mirar, no acusa.
                  El detalle explica cada colisión con su texto. */}
              {emailInUse.has(app.id) && (
                <Badge
                  variant="outline"
                  title="El email declarado ya figura en otra cuenta, en la ficha de un socio o en otra solicitud en trámite. Abrí la solicitud para ver el detalle."
                >
                  <AtSign className="size-3" aria-hidden />
                  Email en uso
                  {/* El `title` no lo lee un lector de pantalla: el motivo va
                      también como texto. */}
                  <span className="sr-only">
                    {" "}— el email declarado ya figura en otra cuenta, en la ficha de un socio
                    o en otra solicitud en trámite
                  </span>
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );

  return (
    <div className="space-y-4">
      {Number.isInteger(recorded) && recorded > 0 && (
        <FormMessage kind="success" box>
          {`${recorded} ${recorded === 1 ? "solicitud asentada" : "solicitudes asentadas"} en acta.`}
        </FormMessage>
      )}

      {queue.length === 0 ? (
        <>
          <QueueCountRow count={0} />
          <EmptyState description="No hay solicitudes pendientes. Las nuevas aparecen acá solas." />
        </>
      ) : selectableIds.length > 0 ? (
        // El contador y el "Seleccionar todas" viven ACÁ adentro y no en esta
        // función: la casilla necesita el estado de selección, que sólo existe
        // dentro de `ApplicationCards` (client component). Ver el comentario
        // de `queueCount` ahí — es la misma fila que `QueueCountRow`, con la
        // casilla de más.
        <ApplicationCards
          action={recordApplicationsAction}
          minutes={minutes}
          selectableIds={selectableIds}
          queueCount={queue.length}
          filters=""
        >
          {cards}
        </ApplicationCards>
      ) : (
        <>
          <QueueCountRow count={queue.length} />
          {cards}
        </>
      )}
    </div>
  );
}

// La fila del contador + "Resumen para acta", para las dos ramas que NO
// montan `ApplicationCards` (cola vacía, o sin ninguna solicitud asentable).
// Cuando SÍ hay algo que tildar, `ApplicationCards` renderiza su propia
// versión de esta misma fila con el checkbox "Seleccionar todas" agregado
// (ver el arreglo 2 de la revisión de la tarea 6): no se puede compartir un
// componente server acá porque esa casilla necesita el estado de selección,
// que vive del lado del cliente.
function QueueCountRow({ count }: { count: number }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm text-muted-foreground">
        {count} {count === 1 ? "solicitud" : "solicitudes"} en la cola
      </p>
      <Button asChild variant="outline">
        <Link href="/admin/solicitudes/resumen">Resumen para acta</Link>
      </Button>
    </div>
  );
}

async function HistorialView({ sp }: { sp: SearchParams }) {
  const filters = parseApplicationFilters(sp);
  const { rows, total, page, pageCount, pageSize } = await makeApplicationQueries(prisma).fetchPage(
    filters, parseApplicationsPage(sp),
  );
  const hasFilters = Object.keys(filters).length > 0;
  const firstShown = (page - 1) * pageSize + 1;
  const lastShown = (page - 1) * pageSize + rows.length;
  const params = { vista: "historial", q: filters.q, status: filters.status };

  return (
    <div className="space-y-4">
      <form className="flex flex-wrap items-end gap-2" method="get">
        <input type="hidden" name="vista" value="historial" />
        {/* `aria-label` y no un <label> visible: el formulario es una fila de
            filtros sin encabezados, y un placeholder no es un nombre accesible. */}
        <Input
          name="q"
          aria-label="Buscar por nombre o DNI"
          placeholder="Nombre o DNI"
          defaultValue={filters.q ?? ""}
          className="w-56"
        />
        <select
          name="status"
          aria-label="Filtrar por estado"
          defaultValue={filters.status ?? ""}
          className={SELECT_CLASS}
        >
          <option value="">Estado (todos)</option>
          {Object.entries(APPLICATION_STATUS_LABELS).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        <Button type="submit" variant="secondary">Filtrar</Button>
      </form>

      {total === 0 ? (
        <EmptyState
          description={
            hasFilters
              ? "No hay solicitudes que coincidan con los filtros."
              : "Todavía no entró ninguna solicitud de asociación."
          }
          action={
            hasFilters
              ? <Button asChild variant="outline"><Link href={`${BASE}?vista=historial`}>Limpiar filtros</Link></Button>
              : undefined
          }
        />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {`${firstShown}–${lastShown} de ${total} solicitudes`}
            {pageCount > 1 && ` · página ${page} de ${pageCount}`}
          </p>

          <div className="space-y-2">
            {rows.map((app) => (
              <Card key={app.id} size="sm">
                <CardContent className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <Link className={cn(INLINE_LINK, "font-medium")} href={`/admin/solicitudes/${app.id}`}>
                      {app.fullName}
                    </Link>
                    <span className="text-sm text-muted-foreground">N° {app.id}</span>
                    <span className="text-sm text-muted-foreground">DNI {app.dni}</span>
                  </span>
                  <span className="flex items-center gap-3">
                    <Badge variant={applicationStatusBadgeVariant(app.status)}>
                      {APPLICATION_STATUS_LABELS[app.status]}
                    </Badge>
                    <span className="text-sm text-muted-foreground">{formatDateAR(app.createdAt)}</span>
                  </span>
                </CardContent>
              </Card>
            ))}
          </div>

          <PaginationNav
            page={page}
            pageCount={pageCount}
            href={(n) => pageHref(BASE, params, n)}
            label="Páginas del historial"
          />
        </>
      )}
    </div>
  );
}
