import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Bell, ClipboardList, CreditCard, FileImage, Gavel, User,
} from "lucide-react";
import { prisma } from "@/lib/prisma";
import { formatARS, formatDateAR } from "@/lib/format";
import { requireAdmin } from "@/lib/auth/require-admin";
import { APPLICATION_STATUS_LABELS } from "@/lib/applications/labels";
import { isDecidable } from "@/lib/applications/decision";
import { collisionsFor, findEmailCollisions } from "@/lib/applications/email-collision";
import {
  APPROVED_AFTER_EXPIRY_ACTION, lateEntryNotice, subscriptionIsActive,
} from "@/lib/applications/query";
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
import { DocumentViewer } from "./document-viewer";

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
  const [
    documents, notifications, minuteRows, recordedMovement, revivedEntry, emailCollisions,
  ] = await Promise.all([
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
    // ── La casilla declarada, ¿ya está en uso? ────────────────────────────────
    // Aviso, no bloqueo: un matrimonio que comparte buzón es un caso legítimo
    // (docs/04). Lo que el operador no tenía era la SEÑAL: la guarda que existe
    // (`members/access.ts`) recién salta cuando la víctima intenta estrenar su
    // portal, meses después del acta.
    findEmailCollisions(prisma, [app.email]),
  ]);

  // La exclusión de lo que es la solicitud MISMA vive en `collisionsFor`, que
  // comparten esta pantalla y la cola: dos filtros no pueden divergir en qué es
  // "propio". Acá va además `app.memberId` porque una solicitud ya asentada TIENE
  // ficha, y el asiento le copió a esa ficha su mismo email (`record.ts`): sin
  // esto, toda alta resuelta se avisaba a sí misma "el email ya figura en la
  // ficha del socio N° X" nombrando a la persona de la propia solicitud.
  const collisions = collisionsFor(emailCollisions, app.email, app.id, app.memberId);

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
  // Aceptada DESPUÉS de vencida: QUÉ se puede afirmar sobre el débito no lo dice
  // el asiento —que sólo prueba que el pago llegó tarde— sino el estado vivo de
  // la suscripción. La cancelación del cron es best-effort: si falló, el
  // preapproval sigue cobrando y decirle al operador "quedó sin débito, volvé a
  // gestionarlo" le dejaría DOS débitos al vecino. Ver `lateEntryNotice`.
  const lateEntry = lateEntryNotice(revivedEntry !== null, subscription?.status);
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

      {/* Avisos de Mercado Pago, ARRIBA de todo: son la señal más cara de la
          pantalla (un débito que sigue cobrando, o uno que no se sabe si
          cobra) y estaban enterrados al final de la Card de Pago, cuarta de
          seis. Mismas cuatro condiciones y mismos textos que antes — sólo
          cambia dónde se pintan. */}
      {revivedEntry && lateEntry === "no_debit" && (
        // Mismo criterio que el aviso de "suscripción sin cancelar": el dato
        // existía sólo en la auditoría y ahí no lo mira nadie. Acá hace falta
        // porque la solicitud se puede asentar en acta desde la bandeja sin
        // abrir esta pantalla, y el alta quedaría sin débito.
        <FormMessage kind="warning" box>
          El pago de ingreso llegó el {formatDateAR(revivedEntry.createdAt)}, cuando la
          solicitud ya estaba vencida, y se aceptó igual. Al vencer se canceló la
          suscripción de Mercado Pago: el vecino pagó el ingreso pero{" "}
          <strong>quedó sin débito automático</strong>. Revisá la suscripción y volvé a
          gestionarla con él antes de asentar el alta.
        </FormMessage>
      )}
      {revivedEntry && lateEntry === "unknown" && (
        // Tercer caso, distinto de los otros dos: no hay fila local de
        // suscripción. Sin `preapprovalId` el cron ni siquiera intentó
        // cancelar (ver `cron.ts`), así que acá no hay NADA probado —ni que
        // el débito esté cancelado ni que siga vivo. No se puede reusar el
        // texto de "verify": no hay estado que mostrar (`subscription` es
        // null) ni preapproval que nombrar. El aviso dice la verdad: no se
        // sabe, y hay que mirar en MP antes de gestionar nada. Mismo criterio
        // que `pendingCancellation`, más abajo: sin fila local también avisa.
        <FormMessage kind="warning" box>
          El pago de ingreso llegó el {formatDateAR(revivedEntry.createdAt)}, cuando la
          solicitud ya estaba vencida, y se aceptó igual. Esta solicitud{" "}
          <strong>no tiene ninguna suscripción de Mercado Pago registrada</strong> en el
          sistema, así que no se sabe si quedó algún débito activo. Buscá al vecino por DNI
          o nombre en el panel de Mercado Pago y confirmá si hay un preapproval abierto
          antes de gestionar uno nuevo.
        </FormMessage>
      )}
      {revivedEntry && lateEntry === "verify" && (
        // La otra mitad del mismo caso: el pago llegó tarde, pero la
        // cancelación que el cron intentó al vencer NO figura aplicada. El
        // aviso no puede afirmar que no hay débito —mandaría a crear un
        // segundo preapproval sobre alguien a quien MP le sigue cobrando—,
        // así que pide mirar antes de tocar.
        <FormMessage kind="warning" box>
          El pago de ingreso llegó el {formatDateAR(revivedEntry.createdAt)}, cuando la
          solicitud ya estaba vencida, y se aceptó igual. Al vencer se intentó cancelar la
          suscripción de Mercado Pago, pero{" "}
          {subscriptionIsActive(subscription?.status)
            ? "sigue figurando autorizada"
            : `figura como «${subscription?.status}»`}
          : la cancelación puede no haberse aplicado.{" "}
          <strong>Verificá el preapproval en el panel de Mercado Pago</strong>
          {app.preapprovalId && (
            <> (<span className="font-mono">{app.preapprovalId}</span>)</>
          )}{" "}
          antes de gestionar un débito nuevo: si sigue activo, gestionar otro le dejaría dos
          débitos al vecino.
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

      {collisions.length > 0 && (
        // Una sola caja con TODAS las colisiones: son hechos distintos sobre la
        // misma casilla y el operador los tiene que leer juntos antes de
        // asentar. No bloquea nada —compartir buzón entre cónyuges es
        // legítimo—, pero el segundo de los dos no va a poder tener portal
        // propio, y eso conviene saberlo antes del acta y no después.
        // `as="div"`: la caja lleva una <ul> adentro y un <ul> dentro de un <p>
        // es HTML inválido (el <p> se cierra solo y el navegador desarma la
        // caja).
        <FormMessage kind="warning" box as="div">
          <span className="font-medium">
            El email declarado (<span className="font-mono">{app.email}</span>) ya está en uso.
          </span>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {collisions.map((c) => (
              <li key={`${c.kind}-${"userId" in c ? c.userId : "memberId" in c ? c.memberId : c.applicationId}`}>
                {c.kind === "admin_account" && (
                  <>
                    El email de esta solicitud es el de una{" "}
                    <strong>cuenta de gestión del sistema</strong>. Verificá la identidad antes
                    de asentar.
                  </>
                )}
                {c.kind === "account" && (
                  <>El email ya es la dirección de acceso de otra cuenta del portal.</>
                )}
                {c.kind === "member" && (
                  <>
                    El email ya figura en la ficha{" "}
                    {c.memberNumber !== null ? (
                      <>
                        del socio N° {c.memberNumber} (
                        <Link className="text-primary hover:underline" href={`/admin/socios/${c.memberId}`}>
                          {c.fullName}
                        </Link>
                        )
                      </>
                    ) : (
                      <>
                        de{" "}
                        <Link className="text-primary hover:underline" href={`/admin/socios/${c.memberId}`}>
                          {c.fullName}
                        </Link>
                      </>
                    )}
                    . Si comparten casilla (p. ej. un matrimonio), es esperable; el segundo no
                    va a poder tener portal propio.
                  </>
                )}
                {c.kind === "application" && (
                  <>
                    Otra solicitud en trámite (
                    <Link
                      className="text-primary hover:underline"
                      href={`/admin/solicitudes/${c.applicationId}`}
                    >
                      #{c.applicationId}
                    </Link>
                    ) declara la misma casilla.
                  </>
                )}
              </li>
            ))}
          </ul>
        </FormMessage>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {/* Sólo mientras la solicitud está viva: sobre una ya resuelta estos
            dos formularios serían botones que el servidor va a rechazar
            igual. Primera tarjeta y no quinta: es lo que el operador vino a
            hacer acá, no algo que encuentra después de leer todo lo demás. */}
        {decidable && (
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle as="h2" className="flex items-center gap-2">
                <Gavel className="size-4 text-primary" aria-hidden />
                Acciones
              </CardTitle>
            </CardHeader>
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
          <CardHeader>
            <CardTitle as="h2" className="flex items-center gap-2">
              <ClipboardList className="size-4 text-primary" aria-hidden />
              Estado
            </CardTitle>
          </CardHeader>
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
          <CardHeader>
            <CardTitle as="h2" className="flex items-center gap-2">
              <User className="size-4 text-primary" aria-hidden />
              Datos personales
            </CardTitle>
          </CardHeader>
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

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle as="h2" className="flex items-center gap-2">
              <FileImage className="size-4 text-primary" aria-hidden />
              Documentación
            </CardTitle>
          </CardHeader>
          <CardContent>
            {documents.length === 0 ? (
              <EmptyState size="card" description="La solicitud todavía no adjuntó documentos." />
            ) : (
              <DocumentViewer applicationId={app.id} documents={documents} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle as="h2" className="flex items-center gap-2">
              <CreditCard className="size-4 text-primary" aria-hidden />
              Pago y suscripción
            </CardTitle>
          </CardHeader>
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

        <Card>
          <CardHeader>
            <CardTitle as="h2" className="flex items-center gap-2">
              <Bell className="size-4 text-primary" aria-hidden />
              Notificaciones
            </CardTitle>
          </CardHeader>
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
