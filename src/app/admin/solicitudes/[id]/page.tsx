import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatARS, formatBytes, formatDateAR } from "@/lib/format";
import { requireAdmin } from "@/lib/auth/require-admin";
import { APPLICATION_STATUS_LABELS, DOCUMENT_TYPE_LABELS } from "@/lib/applications/labels";
import { isDecidable } from "@/lib/applications/decision";
import { WEB_CATEGORIES } from "@/lib/applications/wizard";
import {
  CATEGORY_LABELS, MINUTE_TYPE_LABELS, NOTIFICATION_STATUS_LABELS, NOTIFICATION_TYPE_LABELS,
} from "@/lib/members/labels";
import type { MemberCategory } from "@/generated/prisma/client";
import { applicationStatusBadgeVariant } from "@/lib/admin/status-badges";
import { EmptyState } from "@/components/admin/empty-state";
import { FormMessage } from "@/components/admin/form-message";
import { PageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { recategorizeApplicationAction, rejectApplicationAction } from "../actions";
import { DecisionForms } from "./decision-forms";

export const dynamic = "force-dynamic";

export const metadata = { title: "Solicitud — SIGeV" };

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs uppercase text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value || "—"}</dd>
    </div>
  );
}

export default async function SolicitudPage(props: { params: Promise<{ id: string }> }) {
  // Misma guarda propia que el listado: la ficha muestra el DNI, el domicilio y
  // las fotos del documento de una persona (Ley 25.326), y `requireAdmin`
  // resuelve contra la fila viva de User, no contra el token del layout.
  const actor = await requireAdmin();
  if (!actor.ok) {
    return (
      <div className="space-y-4">
        <PageHeader title="Solicitud" breadcrumb={[{ label: "Solicitudes", href: "/admin/solicitudes" }]} />
        <FormMessage kind="error" box>{actor.error}</FormMessage>
      </div>
    );
  }

  const { id } = await props.params;
  // El id llega de la URL: con "abc" o "1e9" Number() da NaN/no entero y Prisma
  // tiraría un error técnico en inglés en vez de un 404.
  const applicationId = Number(id);
  if (!Number.isInteger(applicationId) || applicationId <= 0) notFound();

  const app = await prisma.application.findUnique({
    where: { id: applicationId },
    include: {
      street: true,
      member: { select: { id: true, fullName: true } },
      minute: true,
      // Ordenadas: la tarjeta muestra UNA (hoy hay una por solicitud), y si
      // alguna vez hay dos —un preapproval reintentado— tiene que ser la última
      // y no la que Prisma devuelva primero.
      subscriptions: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!app) notFound();

  // Los documentos son polimórficos y no tienen FK sobre `ownerId` (docs/04):
  // se consultan aparte, acotados a este dueño.
  const decidable = isDecidable(app.status);
  const [documents, notifications, minuteRows, recordedMovement] = await Promise.all([
    prisma.document.findMany({
      where: { ownerType: "application", ownerId: applicationId },
      orderBy: { uploadedAt: "asc" },
    }),
    prisma.notification.findMany({
      where: { applicationId },
      orderBy: { sentAt: "desc" },
    }),
    // Las actas para el rechazo: sólo si la Card de acciones se va a mostrar.
    decidable
      ? prisma.minute.findMany({ orderBy: [{ date: "desc" }, { id: "desc" }], take: 30 })
      : Promise.resolve([]),
    // ── Alta o reingreso, DESPUÉS del asiento ─────────────────────────────────
    // `memberId` no sirve como discriminador (el porqué está en
    // `showsReentryBadge`, en applications/query.ts): el asiento se lo escribe a
    // TODA solicitud que completa, así que un alta común terminaba mostrándose
    // como "Reingreso de <el socio que ella misma acababa de crear>".
    //
    // La señal verdadera es el movimiento que ese asiento creó —`admission` o
    // `readmission`—, y se identifica por el par (socio, acta) del asiento. Es
    // una consulta más, que esta pantalla puede pagar y la bandeja no.
    app.status === "completed" && app.memberId !== null && app.minuteId !== null
      ? prisma.movement.findFirst({
          where: {
            memberId: app.memberId, minuteId: app.minuteId,
            type: { in: ["admission", "readmission"] },
          },
          orderBy: { id: "desc" },
          select: { type: true },
        })
      : Promise.resolve(null),
  ]);

  // Viva, `memberId` sí significa "matcheó una ficha existente" y el reingreso
  // está por venir. Asentada, manda el movimiento; si no apareciera (un asiento
  // anterior a este circuito, un dato migrado) la pantalla no afirma nada.
  const reentry = app.status === "completed"
    ? recordedMovement?.type === "readmission"
    : app.memberId !== null;

  const address = app.street
    ? `${app.street.name} ${app.streetNumber ?? ""}`.trim()
    : [app.streetText, app.streetNumber].filter(Boolean).join(" ");
  const subscription = app.subscriptions[0] ?? null;
  const minutes = minuteRows.map((m) => ({
    id: m.id, label: `${MINUTE_TYPE_LABELS[m.type]} N° ${m.number} — ${formatDateAR(m.date)}`,
  }));
  // Las tres categorías que se piden por la web, menos la que ya tiene. Cadete,
  // honorario y vitalicio no entran: no se solicitan, las otorga la Comisión
  // sobre una ficha del padrón (REG-01).
  const categoryOptions = WEB_CATEGORIES
    .filter((c) => c !== app.requestedCategory)
    .map((c) => [c, CATEGORY_LABELS[c]] as [MemberCategory, string]);

  return (
    <div className="space-y-4">
      <PageHeader
        // La ENTIDAD va en el h1 (convención del shell): el nombre del
        // solicitante, no "Solicitud". La referencia corta va en la miga.
        title={app.fullName}
        breadcrumb={[
          { label: "Solicitudes", href: "/admin/solicitudes" },
          { label: `Solicitud #${app.id}` },
        ]}
      >
        <div className="flex flex-wrap gap-2">
          <Badge variant={applicationStatusBadgeVariant(app.status)}>
            {APPLICATION_STATUS_LABELS[app.status]}
          </Badge>
          <Badge variant="secondary">Categoría: {CATEGORY_LABELS[app.requestedCategory]}</Badge>
          {reentry && <Badge variant="secondary">Reingreso</Badge>}
        </div>
      </PageHeader>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Estado</CardTitle></CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-3">
              <Field label="Estado" value={APPLICATION_STATUS_LABELS[app.status]} />
              <Field label="Categoría solicitada" value={CATEGORY_LABELS[app.requestedCategory]} />
              <Field label="Débito automático" value={app.wantsDebit ? "Sí" : "No"} />
              <Field label="Iniciada" value={formatDateAR(app.createdAt)} />
              <Field
                label="Email"
                value={app.emailVerifiedAt
                  ? `Verificado el ${formatDateAR(app.emailVerifiedAt)}`
                  : "Sin verificar"}
              />
              <Field label="Resuelta" value={app.decidedAt ? formatDateAR(app.decidedAt) : null} />
              {app.member && (
                // La ficha vinculada se nombra por lo que REALMENTE es: la que
                // el alta creó, o la del ex socio que reingresa.
                <div>
                  <dt className="text-xs uppercase text-muted-foreground">
                    {reentry ? "Reingreso" : "Socio"}
                  </dt>
                  <dd className="text-sm">
                    <Link className="text-primary hover:underline" href={`/admin/socios/${app.member.id}`}>
                      {reentry ? `Reingreso de ${app.member.fullName}` : app.member.fullName}
                    </Link>
                  </dd>
                </div>
              )}
              {app.minute && (
                <div>
                  <dt className="text-xs uppercase text-muted-foreground">Acta</dt>
                  <dd className="text-sm">
                    <Link className="text-primary hover:underline" href={`/admin/actas/${app.minute.id}`}>
                      Acta N° {app.minute.number}
                    </Link>
                  </dd>
                </div>
              )}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Datos personales</CardTitle></CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-3">
              <Field label="DNI" value={app.dni} />
              <Field label="Fecha de nacimiento" value={formatDateAR(app.birthDate)} />
              <Field label="Estado civil" value={app.civilStatus} />
              <Field label="Nacionalidad" value={app.nationality} />
              <Field label="Ocupación" value={app.occupation} />
              <Field label="Teléfono" value={app.phone} />
              <Field label="Email" value={app.email} />
              <Field label="Domicilio" value={address || null} />
              <Field label="Barrio" value={app.neighborhood} />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Documentación</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {documents.length === 0 ? (
              <EmptyState size="card" description="La solicitud todavía no adjuntó documentos." />
            ) : (
              documents.map((doc) => (
                <p key={doc.id} className="text-sm">
                  {DOCUMENT_TYPE_LABELS[doc.type]} · {formatBytes(doc.size)} ·{" "}
                  {/* Pestaña nueva: el operador compara la foto con los datos de
                      esta misma pantalla sin perder el lugar. `rel="noopener"`
                      porque la ruta sirve un archivo subido por un tercero. */}
                  <a
                    className="text-primary hover:underline"
                    href={`/api/admin/solicitudes/${app.id}/documentos/${doc.id}`}
                    target="_blank"
                    rel="noopener"
                  >
                    Ver
                  </a>
                </p>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Pago y suscripción</CardTitle></CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-3">
              <Field label="Preapproval de MP" value={app.preapprovalId} />
              <Field label="Estado de la suscripción" value={subscription?.status} />
              <Field label="Pago de ingreso (MP)" value={app.mpPaymentIdEntry} />
              <Field
                label="Cuota de ingreso"
                value={app.entryAmount ? formatARS(Number(app.entryAmount)) : null}
              />
            </dl>
          </CardContent>
        </Card>

        {/* Sólo mientras la solicitud está viva: sobre una ya resuelta estos dos
            formularios serían botones que el servidor va a rechazar igual. */}
        {decidable && (
          <Card className="md:col-span-2">
            <CardHeader><CardTitle>Acciones</CardTitle></CardHeader>
            <CardContent>
              <DecisionForms
                recategorize={recategorizeApplicationAction}
                reject={rejectApplicationAction}
                applicationId={app.id}
                currentCategory={app.requestedCategory}
                options={categoryOptions}
                hasSubscription={app.preapprovalId !== null}
                minutes={minutes}
              />
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader><CardTitle>Notificaciones</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            {notifications.length === 0 ? (
              <EmptyState size="card" description="Sin notificaciones." />
            ) : (
              notifications.map((n) => (
                <p key={String(n.id)} className="text-sm">
                  {formatDateAR(n.sentAt)} — {n.payloadSummary ?? NOTIFICATION_TYPE_LABELS[n.type]}
                  {" "}({NOTIFICATION_STATUS_LABELS[n.status]})
                </p>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
