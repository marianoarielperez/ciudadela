import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatARS, formatBytes, formatDateAR } from "@/lib/format";
import { requireAdmin } from "@/lib/auth/require-admin";
import { APPLICATION_STATUS_LABELS, DOCUMENT_TYPE_LABELS } from "@/lib/applications/labels";
import { isDecidable } from "@/lib/applications/decision";
import { APPROVED_AFTER_EXPIRY_ACTION } from "@/lib/applications/query";
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
  const [documents, notifications, minuteRows, recordedMovement, revivedEntry] = await Promise.all([
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
    // ── Aceptada DESPUÉS de vencida ───────────────────────────────────────────
    // El estado final es `approved_pending_minute`, igual que el de una
    // aceptación normal: la única señal de que el pago llegó tarde —y de que al
    // expirar se canceló el débito— es este asiento. Va por el índice
    // `[entity, entityId]` de `audit_log`.
    prisma.auditLog.findFirst({
      where: {
        action: APPROVED_AFTER_EXPIRY_ACTION,
        entity: "application",
        entityId: String(applicationId),
      },
      orderBy: { id: "desc" },
      select: { createdAt: true },
    }),
  ]);

  // Tres estados y no dos. Viva, `memberId` sí significa "matcheó una ficha
  // existente" y el reingreso está por venir. Asentada, manda el movimiento; y
  // si no apareciera (un asiento anterior a este circuito, un dato migrado)
  // queda `null`: la pantalla NO sabe si fue alta o reingreso, y decir "Socio"
  // ahí sería afirmar que fue un alta sin tener con qué.
  const reentry: boolean | null = app.status === "completed"
    ? (recordedMovement ? recordedMovement.type === "readmission" : null)
    : app.memberId !== null;

  const address = app.street
    ? `${app.street.name} ${app.streetNumber ?? ""}`.trim()
    : [app.streetText, app.streetNumber].filter(Boolean).join(" ");
  const subscription = app.subscriptions[0] ?? null;
  // Al rechazar se manda a cancelar la suscripción, pero eso es best-effort: si
  // MP estaba caído el rechazo quedó firme igual y al vecino le SIGUEN debitando
  // la cuota (además de la de ingreso, que se retiene). El único rastro era la
  // auditoría y un console.error, y ninguno de los dos llega a un humano. Esta
  // es la pantalla que el admin abre para revisar la solicitud, así que el aviso
  // va acá. Sin fila local también avisa: no saber en qué estado está es peor.
  const pendingCancellation =
    app.status === "rejected" && app.preapprovalId !== null && subscription?.status !== "cancelled";
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
          {reentry === true && <Badge variant="secondary">Reingreso</Badge>}
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
                // el alta creó, la del ex socio que reingresa, o —cuando no hay
                // movimiento que lo diga— sólo "ficha vinculada", que es lo
                // único que la pantalla puede sostener.
                <div>
                  <dt className="text-xs uppercase text-muted-foreground">
                    {reentry === true ? "Reingreso" : reentry === false ? "Socio" : "Ficha vinculada"}
                  </dt>
                  <dd className="text-sm">
                    <Link className="text-primary hover:underline" href={`/admin/socios/${app.member.id}`}>
                      {reentry === true ? `Reingreso de ${app.member.fullName}` : app.member.fullName}
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
          <CardContent className="space-y-3">
            <dl className="grid grid-cols-2 gap-3">
              <Field label="Preapproval de MP" value={app.preapprovalId} />
              <Field label="Estado de la suscripción" value={subscription?.status} />
              <Field label="Pago de ingreso (MP)" value={app.mpPaymentIdEntry} />
              <Field
                label="Cuota de ingreso"
                value={app.entryAmount ? formatARS(Number(app.entryAmount)) : null}
              />
            </dl>
            {revivedEntry && (
              // Mismo criterio que el aviso de "suscripción sin cancelar": el
              // dato existía sólo en la auditoría y ahí no lo mira nadie. Acá
              // hace falta porque la solicitud se puede asentar en acta desde la
              // bandeja sin abrir esta pantalla, y el alta quedaría sin débito.
              <FormMessage kind="warning" box>
                El pago de ingreso llegó el {formatDateAR(revivedEntry.createdAt)}, cuando la
                solicitud ya estaba vencida, y se aceptó igual. Al vencer se canceló la
                suscripción de Mercado Pago: el vecino pagó el ingreso pero{" "}
                <strong>quedó sin débito automático</strong>. Revisá la suscripción y volvé a
                gestionarla con él antes de asentar el alta.
              </FormMessage>
            )}
            {pendingCancellation && (
              <FormMessage kind="warning" box>
                La solicitud está rechazada pero la suscripción de Mercado Pago no figura
                cancelada: puede seguir debitándole la cuota al vecino. Cancelá el preapproval{" "}
                <span className="font-mono">{app.preapprovalId}</span> a mano desde el panel de
                Mercado Pago.
              </FormMessage>
            )}
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
                // `streetId` es una calle del catastro del barrio; sin ella, lo
                // declarado fue calle + barrio de afuera (los dos juegos de
                // campos se escriben excluyentes en el wizard).
                livesInBarrio={app.streetId !== null}
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
