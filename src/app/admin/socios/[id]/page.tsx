import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { prisma } from "@/lib/prisma";
import { formatDateAR } from "@/lib/format";
import {
  CATEGORY_LABELS, EMAIL_STATUS_LABELS, MINUTE_TYPE_LABELS, MOVEMENT_LABELS,
  NOTIFICATION_STATUS_LABELS, NOTIFICATION_TYPE_LABELS, REASON_LABELS, STATUS_LABELS,
} from "@/lib/members/labels";
import { verificationTarget } from "@/lib/members/card-edit";
import { arrearsBadgeVariant, memberStatusBadgeVariant } from "@/lib/admin/status-badges";
import { buildPeriodGrid, fetchMemberAccount } from "@/lib/treasury/account";
import { feeValueReader } from "@/lib/treasury/fee-values";
import { currentPeriod } from "@/lib/treasury/periods";
import { AccountSection } from "@/components/admin/account-section";
import { EmptyState } from "@/components/admin/empty-state";
import { MemberTabs } from "@/components/admin/member-tabs";
import { PageHeader } from "@/components/admin/page-header";
import { SendVerificationForm } from "@/components/admin/send-verification-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export const metadata = { title: "Ficha de socio — SIGeV" };

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs uppercase text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value || "—"}</dd>
    </div>
  );
}

export default async function SocioPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  // El id llega de la URL: con "abc" o "1e9" Number() da NaN/no entero y Prisma
  // tiraría un error técnico en inglés en vez de un 404.
  const memberId = Number(id);
  if (!Number.isInteger(memberId) || memberId <= 0) notFound();

  // El valor vigente de la cuota no depende del socio: se pide EN PARALELO con
  // la ficha en vez de esperar a tenerla, que era una ida y vuelta de más en
  // cada render (mismo criterio que la ruta hermana `[accion]`).
  const [member, feeValue] = await Promise.all([
    prisma.member.findUnique({
      where: { id: memberId },
      include: {
        street: true,
        memberships: { include: { book: true } },
        movements: { include: { minute: true }, orderBy: { date: "desc" } },
        notifications: { orderBy: { sentAt: "desc" }, take: 20 },
      },
    }),
    feeValueReader.current(),
  ]);
  if (!member) notFound();

  // La cuenta corriente se carga siempre: la mora es un dato de encabezado
  // (el badge) y no solo del panel de la pestaña.
  const account = await fetchMemberAccount(prisma, member, feeValue);
  const receiptByPayment = new Map(account.payments.filter((p) => p.receipt).map((p) => [p.id, p.receipt!.number]));
  const grid = buildPeriodGrid(account.fees, receiptByPayment, currentPeriod());

  const openMembership = member.memberships.find((m) => m.book.status === "open");
  // Misma función que usa la server action como guarda: la ficha no decide nada
  // por su cuenta sobre a quién se le puede mandar el acceso (spec §8: el envío
  // se ofrece "desde carga de fichas o ficha").
  const sendTarget = verificationTarget(member);
  const address = member.street
    ? `${member.street.name} ${member.streetNumber ?? ""}`.trim()
    : [member.streetText, member.streetNumber].filter(Boolean).join(" ");

  return (
    <div className="space-y-4">
      <PageHeader
        title={member.fullName}
        breadcrumb={[
          { label: "Socios", href: "/admin/socios" },
          { label: `N° ${openMembership?.memberNumber ?? "—"}` },
        ]}
        actions={
          <>
            {openMembership && (
              <Button asChild variant="outline">
                <Link href={`/admin/socios/carga/${openMembership.memberNumber}`}>Cargar ficha</Link>
              </Button>
            )}
            {member.status !== "withdrawn" && (
              <>
                <Button asChild variant="outline"><Link href={`/admin/socios/${member.id}/categoria`}>Cambiar categoría</Link></Button>
                {member.status === "active" && (
                  <Button asChild variant="outline"><Link href={`/admin/socios/${member.id}/suspension`}>Suspender</Link></Button>
                )}
                <Button asChild variant="destructive"><Link href={`/admin/socios/${member.id}/baja`}>Dar de baja</Link></Button>
              </>
            )}
            {member.status === "suspended" && (
              <Button asChild variant="outline"><Link href={`/admin/socios/${member.id}/suspension`}>Levantar suspensión</Link></Button>
            )}
            {member.status === "withdrawn" && !member.reentryBlocked && (
              <Button asChild><Link href={`/admin/socios/${member.id}/reingreso`}>Reingreso</Link></Button>
            )}
          </>
        }
      >
        <div className="flex flex-wrap gap-2">
          {/* La categoría lleva prefijo: "Activo" (categoría) al lado de "Baja"
              (estado) se lee como una contradicción sin decir de qué es cada uno. */}
          <Badge variant="secondary">Categoría: {CATEGORY_LABELS[member.category]}</Badge>
          <Badge variant={memberStatusBadgeVariant(member.status)}>{STATUS_LABELS[member.status]}</Badge>
          {/* La deuda que se muestra es la VIVA de la cuenta corriente, no el
              `debtAtWithdrawal` congelado en la baja: el que saldó en la sede
              tiene que dejar de verse como deudor sin que nadie toque un flag. */}
          {account.pendingCount > 0 && (
            <Badge variant={arrearsBadgeVariant(account.level)}>
              Debe {account.pendingCount} {account.pendingCount === 1 ? "cuota" : "cuotas"}
            </Badge>
          )}
          {member.reentryBlocked && <Badge variant="destructive">Reingreso bloqueado</Badge>}
        </div>
      </PageHeader>

      <Suspense>
        <MemberTabs
          initial="ficha"
          tabs={[
            { value: "ficha", label: "Ficha" },
            { value: "cuenta", label: "Cuenta corriente" },
            { value: "historial", label: "Historial" },
            { value: "acceso", label: "Acceso" },
          ]}
          panels={{
            ficha: (
              <Card>
                <CardHeader><CardTitle>Datos personales</CardTitle></CardHeader>
                <CardContent>
                  <dl className="grid grid-cols-2 gap-3 md:grid-cols-3">
                    <Field label="DNI" value={member.dni} />
                    <Field label="Fecha de nacimiento" value={member.birthDate ? formatDateAR(member.birthDate) : null} />
                    <Field label="Estado civil" value={member.civilStatus} />
                    <Field label="Nacionalidad" value={member.nationality} />
                    <Field label="Ocupación" value={member.occupation} />
                    <Field label="Teléfono" value={member.phone} />
                    <Field label="Domicilio" value={address || null} />
                    <Field label="Barrio" value={member.neighborhood} />
                    <Field label="Email" value={member.email ? `${member.email} (${EMAIL_STATUS_LABELS[member.emailStatus]})` : null} />
                    <Field label="Débito automático" value={member.autoDebit ? "Sí" : "No"} />
                    <Field label="Fecha de ingreso" value={formatDateAR(member.joinedAt)} />
                    <Field label="Fecha de egreso" value={member.leftAt ? formatDateAR(member.leftAt) : null} />
                    {member.withdrawalReason && <Field label="Motivo de baja" value={REASON_LABELS[member.withdrawalReason]} />}
                    {member.status === "suspended" && (
                      <Field
                        label="Suspendido"
                        value={`${member.suspendedFrom ? formatDateAR(member.suspendedFrom) : "?"} — ${member.suspendedTo ? formatDateAR(member.suspendedTo) : "?"}`}
                      />
                    )}
                  </dl>
                </CardContent>
              </Card>
            ),
            cuenta: (
              <AccountSection
                member={member} account={account} rows={grid} admin
                receiptHref={(receiptId) => `/admin/tesoreria/recibos/${receiptId}`}
              />
            ),
            historial: (
              <div className="grid gap-4 md:grid-cols-2">
                <Card>
                  <CardHeader><CardTitle>Historial de movimientos</CardTitle></CardHeader>
                  <CardContent className="space-y-2">
                    {member.movements.length === 0 && <EmptyState size="card" description="Sin movimientos." />}
                    {member.movements.map((mv) => (
                      <div key={mv.id} className="border-b pb-2 text-sm last:border-0">
                        <span className="font-medium">{MOVEMENT_LABELS[mv.type]}</span> — {formatDateAR(mv.date)}
                        {mv.previousCategory && mv.newCategory && (
                          <> · {CATEGORY_LABELS[mv.previousCategory]} → {CATEGORY_LABELS[mv.newCategory]}</>
                        )}
                        {mv.reason && <> · {REASON_LABELS[mv.reason]}</>}
                        {mv.minute ? (
                          <> · <Link className="text-primary hover:underline" href={`/admin/actas/${mv.minute.id}`}>
                            Acta {MINUTE_TYPE_LABELS[mv.minute.type]} N° {mv.minute.number}
                          </Link></>
                        ) : (
                          <> · sin acta digitalizada</>
                        )}
                        {mv.detail && <p className="text-muted-foreground">{mv.detail}</p>}
                      </div>
                    ))}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader><CardTitle>Notificaciones</CardTitle></CardHeader>
                  <CardContent className="space-y-1">
                    {member.notifications.length === 0 && <EmptyState size="card" description="Sin notificaciones." />}
                    {member.notifications.map((n) => (
                      <p key={String(n.id)} className="text-sm">
                        {formatDateAR(n.sentAt)} — {n.payloadSummary ?? NOTIFICATION_TYPE_LABELS[n.type]}
                        {" "}({NOTIFICATION_STATUS_LABELS[n.status]})
                      </p>
                    ))}
                  </CardContent>
                </Card>
              </div>
            ),
            acceso: (
              <Card>
                <CardHeader><CardTitle>Acceso al portal</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    {member.email
                      ? `Email de la ficha: ${member.email} (${EMAIL_STATUS_LABELS[member.emailStatus]}).`
                      : "La ficha no tiene email cargado."}
                    {" "}
                    {member.userId ? "El socio ya creó su cuenta." : "El socio todavía no creó su cuenta."}
                  </p>
                  <SendVerificationForm
                    memberId={member.id}
                    target={sendTarget}
                    verified={member.emailStatus === "verified" && member.status !== "withdrawn"}
                  />
                </CardContent>
              </Card>
            ),
          }}
        />
      </Suspense>
    </div>
  );
}
