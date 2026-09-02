// La ficha de un reporte (spec §5.3): todo lo que el vecino contó, dónde cae en
// el barrio, quién lo mandó, en qué estado está y las dos decisiones que la
// Comisión puede tomar sobre él.
//
// Cuatro cosas que no se ven en el render:
//
// 1. `requireAdmin()` propio y primero, como la cola: el layout de la sección
//    NO autoriza, y acá se muestran el DNI, el teléfono y el email de vecinos
//    que pueden no ser socios (Ley 25.326).
// 2. El estado se nombra SIEMPRE con `statusLabel(kind, status)`: un reclamo se
//    "presenta" y una iniciativa se "trata", y `dismissed` tiene género.
// 3. El acta se nombra con `minuteName` —tipo y número—, nunca con su id: "Acta
//    N° 16" sobre lo que el libro llama Comisión Directiva N° 124 manda al
//    operador a buscar un documento que existe y no es ése.
// 4. Los formularios de decisión sólo se montan mientras el reporte está
//    `received`. La autorización real igual vive en las actions: esto es
//    display.
import { Ban, FileDown, MapPin, Send } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { TramiteTimeline } from "@/app/(public)/asociate/tramite-timeline";
import { FormMessage } from "@/components/admin/form-message";
import { PageHeader } from "@/components/admin/page-header";
import { PanelHeader } from "@/components/admin/panel-header";
import { ReportKindIcon } from "@/components/admin/report-kind-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { MinuteType } from "@/generated/prisma/client";
import { INLINE_LINK } from "@/lib/admin/link-styles";
import { reportPlaceLabel } from "@/lib/admin/reports-query";
import { REPORTS_BASE } from "@/lib/admin/reports-queue";
import { reportKindBadgeVariant, reportStatusBadgeVariant } from "@/lib/admin/status-badges";
import { requireAdmin } from "@/lib/auth/require-admin";
import { formatDateAR, formatDateTimeAR } from "@/lib/format";
import { MINUTE_TYPE_LABELS, minuteName } from "@/lib/members/labels";
import type { MinuteDraftDefaults, MinuteOption } from "@/lib/members/minute-choice";
import { prisma } from "@/lib/prisma";
import {
  AGENCY_LABELS, categoryLabel, KIND_LABELS, statusLabel, subtypeLabel, suggestedAgency,
} from "@/lib/reports/catalog";
import { civilDayOf } from "@/lib/treasury/periods";
import { DismissForm } from "./dismiss-form";
import { FileForm } from "./file-form";
import ReportMiniMap from "./report-mini-map-loader";

export const dynamic = "force-dynamic";

export const metadata = { title: "Reporte — SIGeV" };

/** El "YYYY-MM-DD" del día civil ARGENTINO, que es el que rellena el
 *  `<input type="date">` y el tope contra el futuro de la action. En UTC, desde
 *  las 21:00 de acá ya es mañana. */
function civilDayInput(now: Date): string {
  return civilDayOf(now).toISOString().slice(0, 10);
}

/** Las actas que ofrece el selector y los valores del modo "acta nueva". Sólo
 *  se consultan cuando hay un formulario que las use: un reclamo no asienta
 *  nada en el libro y un reporte ya resuelto no tiene formulario. */
async function loadMinutes(now: Date): Promise<{ minutes: MinuteOption[]; minuteDefaults: MinuteDraftDefaults }> {
  const [rows, maxByType] = await Promise.all([
    prisma.minute.findMany({ orderBy: [{ date: "desc" }, { id: "desc" }], take: 30 }),
    prisma.minute.groupBy({ by: ["type"], _max: { number: true } }),
  ]);
  // El número sugerido va POR TIPO: la numeración de actas lo es
  // (`@@unique([type, number])`).
  const next = (type: MinuteType) => (maxByType.find((g) => g.type === type)?._max.number ?? 0) + 1;
  return {
    minutes: rows.map((m) => ({
      id: m.id,
      label: `${MINUTE_TYPE_LABELS[m.type]} N° ${m.number} — ${formatDateAR(m.date)}`,
    })),
    minuteDefaults: {
      type: "board",
      numberByType: { board: next("board"), assembly: next("assembly") },
      date: civilDayInput(now),
    },
  };
}

const SECTION_TITLE = "text-sm font-semibold uppercase tracking-widest text-muted-foreground";

export default async function ReporteDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireAdmin();
  if (!actor.ok) {
    return (
      <div className="space-y-4">
        <PageHeader title="Reporte" />
        <FormMessage kind="error" box>{actor.error}</FormMessage>
      </div>
    );
  }

  const { id } = await params;
  // Con un id no numérico Prisma tiraría un error técnico en inglés; acá es 404.
  const reportId = Number(id);
  if (!Number.isInteger(reportId) || reportId <= 0) notFound();

  const r = await prisma.report.findUnique({
    where: { id: reportId },
    include: {
      files: { orderBy: { id: "asc" } },
      filedBy: { select: { name: true } },
      dismissedBy: { select: { name: true } },
      filedMinute: { select: { id: true, type: true, number: true } },
      member: {
        select: {
          id: true,
          memberships: { select: { memberNumber: true, book: { select: { status: true } } } },
        },
      },
    },
  });
  // Un BORRADOR no es un reporte: el vecino todavía no lo mandó y el panel no
  // lo lista en ninguna vista. Mismo criterio que `reportWhere`.
  if (!r || r.status === "draft") notFound();

  const now = new Date();
  const pending = r.status === "received";
  // Sólo una iniciativa pendiente necesita el libro de actas.
  const actas = pending && r.kind === "initiative"
    ? await loadMinutes(now)
    : { minutes: [] as MinuteOption[], minuteDefaults: {} as MinuteDraftDefaults };

  const photos = r.files.filter((f) => f.kind === "photo");
  const dniFiles = r.files.filter((f) => f.kind !== "photo");
  const what = r.kind === "claim" && r.subtype
    ? `${categoryLabel("claim", r.category)} › ${subtypeLabel(r.category, r.subtype)}`
    : categoryLabel(r.kind, r.category);
  // El número del libro ABIERTO: un socio migrado tiene también el del cerrado,
  // y ése ya no lo identifica.
  const memberNumber = r.member?.memberships.find((m) => m.book.status === "open")?.memberNumber ?? null;
  const agencyText = r.filedAgency === "other"
    ? r.filedAgencyOther
    : r.filedAgency
      ? AGENCY_LABELS[r.filedAgency]
      : null;
  const fileUrl = (fileId: number) => `/api/admin/reportes/${r.id}/archivos/${fileId}`;
  const place = reportPlaceLabel(r);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Reporte N° ${r.id}`}
        breadcrumb={[
          { label: "Solicitudes", href: "/admin/solicitudes" },
          { label: "Reportes", href: REPORTS_BASE },
          { label: `N° ${r.id}` },
        ]}
        actions={
          // <a> plano y no <Link>: es una descarga de API, no una navegación
          // (mismo patrón que el recibo y la constancia del acta).
          <Button asChild variant="outline" className="min-h-11">
            <a href={`/api/admin/reportes/${r.id}/pdf`}>
              <FileDown aria-hidden className="size-4" /> Descargar PDF
            </a>
          </Button>
        }
      >
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant={reportKindBadgeVariant(r.kind)}>
            <ReportKindIcon kind={r.kind} /> {KIND_LABELS[r.kind]}
          </Badge>
          <Badge variant={reportStatusBadgeVariant(r.status)}>{statusLabel(r.kind, r.status)}</Badge>
          {r.anonymous && (
            <Badge variant="outline" title="Identidad reservada ante el organismo">
              Reservado<span className="sr-only">: identidad reservada ante el organismo</span>
            </Badge>
          )}
          {r.outsideBoundary && (
            <Badge variant="outline" title="El punto cae fuera del barrio">Fuera del barrio</Badge>
          )}
          <span className="text-muted-foreground">
            {what} · enviado el {r.submittedAt ? formatDateTimeAR(r.submittedAt) : "—"}
          </span>
        </p>
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          <Card>
            <CardContent className="space-y-2">
              <h2 className={SECTION_TITLE}>Descripción</h2>
              <p className="whitespace-pre-line text-sm">{r.description || "Sin descripción."}</p>
              {r.scplTicket && (
                <p className="text-sm text-muted-foreground">
                  N° de reclamo ante la SCPL: <span className="font-mono">{r.scplTicket}</span>
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3">
              <h2 className={SECTION_TITLE}>Ubicación</h2>
              {r.lat !== null && r.lng !== null ? (
                <>
                  <div className="overflow-hidden rounded-xl ring-1 ring-foreground/10">
                    <ReportMiniMap lat={Number(r.lat)} lng={Number(r.lng)} />
                  </div>
                  {/* Las coordenadas en texto son la alternativa al mapa, no un
                      adorno: quien no lo ve tiene que poder copiarlas. */}
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                    <MapPin aria-hidden className="size-4 shrink-0 text-primary" />
                    {place}
                    <span className="font-mono text-xs text-muted-foreground">
                      {Number(r.lat).toFixed(5)}, {Number(r.lng).toFixed(5)}
                    </span>
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">{place}</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3">
              <h2 className={SECTION_TITLE}>Fotos</h2>
              {photos.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin fotos.</p>
              ) : (
                // Las fotos NO se auditan: un bache no es un dato personal (la
                // ruta audita sólo la cara de un DNI, ver su comentario).
                // `<img>` y no `next/image`: ese componente cachearía y
                // republicaría como asset público un archivo que la ruta
                // entrega con `no-store`.
                <ul className="grid list-none gap-3 p-0 sm:grid-cols-2">
                  {photos.map((f) => (
                    <li key={f.id}>
                      <a href={fileUrl(f.id)} target="_blank" rel="noopener" className="block">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={fileUrl(f.id)}
                          alt={`Foto adjunta al reporte N° ${r.id}`}
                          loading="lazy"
                          decoding="async"
                          className="w-full rounded-lg border border-border bg-muted object-cover"
                        />
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardContent className="space-y-2 text-sm">
              <h2 className={SECTION_TITLE}>Quién reporta</h2>
              <p className="font-medium">
                {r.reporterName ?? "—"}{" "}
                {r.member && (
                  <Link href={`/admin/socios/${r.member.id}`} className={INLINE_LINK}>
                    (socio N° {memberNumber ?? "—"})
                  </Link>
                )}
              </p>
              <p className="text-muted-foreground">
                DNI <span className="font-mono">{r.reporterDni || "—"}</span> · {r.reporterPhone || "—"} ·{" "}
                {r.reporterEmail || "—"}
              </p>
              {r.anonymous && (
                <FormMessage kind="neutral" box>
                  Pidió que su identidad quede reservada ante el organismo: el PDF no la incluye.
                </FormMessage>
              )}
              {dniFiles.length > 0 && (
                // Las caras del DNI se embeben, no se esconden detrás de un
                // link: el operador las compara con los datos de arriba sin
                // salir de la ficha. OJO con la contrapartida: cada <img>
                // dispara su propio GET y la ruta asienta un `report_dni_view`
                // por carga, así que abrir la ficha dos veces audita dos vistas
                // de cada cara aunque nadie las haya mirado de cerca (misma
                // semántica que `document-viewer.tsx`).
                <ul className="grid list-none grid-cols-2 gap-2 p-0 pt-2">
                  {dniFiles.map((f) => (
                    <li key={f.id}>
                      <a href={fileUrl(f.id)} target="_blank" rel="noopener" className="block">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={fileUrl(f.id)}
                          alt={f.kind === "dni_front" ? "Frente del DNI" : "Dorso del DNI"}
                          className="w-full rounded-md border border-border bg-muted object-cover"
                        />
                      </a>
                    </li>
                  ))}
                </ul>
              )}
              {r.dniPurgedAt && (
                <p className="text-xs text-muted-foreground">
                  Imágenes del DNI borradas el {formatDateAR(r.dniPurgedAt)} por retención.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3">
              <h2 className={SECTION_TITLE}>Estado</h2>
              <TramiteTimeline
                items={[
                  {
                    state: "done",
                    title: "Recibido",
                    children: r.submittedAt ? formatDateTimeAR(r.submittedAt) : undefined,
                  },
                  r.status === "dismissed"
                    ? {
                        state: "done",
                        title: statusLabel(r.kind, "dismissed"),
                        children: (
                          <>
                            {r.dismissedBy?.name ?? "—"} ·{" "}
                            {r.dismissedAt ? formatDateTimeAR(r.dismissedAt) : "—"}
                            {r.dismissReason && <> · {r.dismissReason}</>}
                          </>
                        ),
                      }
                    : {
                        state: r.status === "filed" ? "done" : "now",
                        title: r.kind === "claim"
                          ? "Presentado ante el organismo"
                          : "Tratada por la Comisión",
                        children: r.status === "filed" ? (
                          <>
                            {agencyText ?? "Comisión Directiva"} ·{" "}
                            {r.filedAt ? formatDateAR(r.filedAt) : "—"} · {r.filedBy?.name ?? "—"}
                            {r.filedReference && <> · exp. {r.filedReference}</>}
                            {r.filedMinute && (
                              <>
                                {" "}
                                ·{" "}
                                <Link className={INLINE_LINK} href={`/admin/actas/${r.filedMinute.id}`}>
                                  {minuteName(r.filedMinute)}
                                </Link>
                              </>
                            )}
                          </>
                        ) : undefined,
                      },
                ]}
              />
            </CardContent>
          </Card>

          {pending && (
            <>
              <section aria-labelledby="file-title" className="space-y-3">
                <PanelHeader
                  icon={Send}
                  titleId="file-title"
                  title={r.kind === "claim" ? "Marcar presentado" : "Marcar tratada"}
                  description={
                    r.kind === "claim"
                      ? "Queda asentado ante qué organismo y con qué fecha, y el vecino recibe el aviso."
                      : "La Comisión la trató (Art. 6.2). Si hay acta, se cita acá y el vecino recibe el aviso."
                  }
                />
                <FileForm
                  reportId={r.id}
                  kind={r.kind}
                  suggested={suggestedAgency({ kind: r.kind, category: r.category, subtype: r.subtype })}
                  today={civilDayInput(now)}
                  minutes={actas.minutes}
                  minuteDefaults={actas.minuteDefaults}
                />
              </section>
              <section aria-labelledby="dismiss-title" className="space-y-3">
                <PanelHeader
                  icon={Ban}
                  titleId="dismiss-title"
                  title={`Desestimar${r.kind === "claim" ? "" : " la iniciativa"}`}
                  description="Spam, duplicado, o algo que no le corresponde a la vecinal. No se le avisa al vecino."
                />
                <DismissForm reportId={r.id} />
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
