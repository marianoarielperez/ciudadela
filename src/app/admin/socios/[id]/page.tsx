import Link from "next/link";
import { notFound } from "next/navigation";
import { BookMarked } from "lucide-react";
import { Suspense } from "react";
import { prisma } from "@/lib/prisma";
import { formatDateAR } from "@/lib/format";
import {
  CATEGORY_LABELS, EMAIL_STATUS_LABELS, MINUTE_TYPE_LABELS, MOVEMENT_LABELS,
  NOTIFICATION_STATUS_LABELS, NOTIFICATION_TYPE_LABELS, REASON_LABELS, STATUS_LABELS,
} from "@/lib/members/labels";
import { verificationTarget } from "@/lib/members/card-edit";
import { isNotCancelled } from "@/lib/mp/subscription-status";
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
import { FormMessage } from "@/components/admin/form-message";
import { AutoDebitForm } from "./auto-debit-form";
import { confirmAddressAction } from "./actions";

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

export default async function SocioPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await props.params;
  // La baja redirige acá con `?debito=pendiente&n=` cuando Mercado Pago no
  // aceptó cancelar el débito: la baja salió igual y el cobro sigue vivo, así
  // que la ficha —la pantalla a la que el operador vuelve— tiene que decirlo.
  const sp = await props.searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const debitPending = one(sp.debito) === "pendiente" ? Number(one(sp.n) ?? 0) : 0;
  // El id llega de la URL: con "abc" o "1e9" Number() da NaN/no entero y Prisma
  // tiraría un error técnico en inglés en vez de un 404.
  const memberId = Number(id);
  if (!Number.isInteger(memberId) || memberId <= 0) notFound();

  // El valor vigente de la cuota no depende del socio: se pide EN PARALELO con
  // la ficha en vez de esperar a tenerla, que era una ida y vuelta de más en
  // cada render (mismo criterio que la ruta hermana `[accion]`).
  const [member, feeValue, subscriptions] = await Promise.all([
    // `include` sin `select` explícito: Prisma ya devuelve todas las columnas
    // escalares del socio, `addressPendingReview` incluida, así que el aviso de
    // constatación de más abajo lee `member.addressPendingReview` sin sumar
    // nada acá (a diferencia de `select`, que el brief de la Tarea 9 pedía
    // tocar y que esta pantalla no usa).
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
    // TODAS las suscripciones del socio, para la pestaña Cuenta corriente: no
    // sólo las vivas. "Viva" es todo lo que no está `cancelled`, el mismo
    // criterio de `autoDebitSignal` —el catálogo de estados es de Mercado Pago
    // y puede crecer, así que un estado desconocido cuenta como débito posible—,
    // pero la ficha necesita además saber si las que hay están canceladas: una
    // suscripción cancelada NO es lo mismo que ninguna suscripción, y decir "no
    // hay ninguna vinculada" sobre una que el sistema tiene delante y sabe
    // muerta es mandar al operador a vincular lo que no hay que vincular (ver
    // `AutoDebitView`).
    //
    // `findMany` y no `findFirst` tampoco por capricho: `memberId` es índice y
    // NO unique, así que un socio puede tener dos preapprovals vivos —dos
    // débitos por mes— y `findFirst` los mostraba como uno. Sigue siendo UNA
    // consulta dentro del mismo `Promise.all`, y son 0-3 filas por socio.
    //
    // Sale de la BASE y no de Mercado Pago a propósito: la ficha del socio no
    // puede depender de que MP conteste. Lo que la base no tiene —el próximo
    // cobro— no se muestra.
    prisma.mpSubscription.findMany({
      where: { memberId },
      orderBy: { createdAt: "desc" },
      select: { preapprovalId: true, status: true, amount: true, linkedManually: true },
    }),
  ]);
  if (!member) notFound();
  // Lista NEGRA (`isNotCancelled`), no lista blanca: acá la pregunta no es si va
  // a cobrar sino si se puede AFIRMAR que no hay débito, y un estado que MP
  // invente mañana tiene que seguir apareciendo. El argumento entero está en
  // `members/auto-debit.ts`.
  const liveSubscriptions = subscriptions.filter((s) => isNotCancelled(s.status));

  // La cuenta corriente se carga siempre: la mora es un dato de encabezado
  // (el badge) y no solo del panel de la pestaña.
  const account = await fetchMemberAccount(prisma, member, feeValue);
  const receiptByPayment = new Map(account.payments.filter((p) => p.receipt).map((p) => [p.id, p.receipt!.number]));
  const grid = buildPeriodGrid(account.fees, receiptByPayment, currentPeriod());

  const openMembership = member.memberships.find((m) => m.book.status === "open");
  // Prisma no promete un orden en la relación: el bloque "Libros" los ordena
  // acá, del más viejo al más nuevo.
  const bookEntries = [...member.memberships].sort((a, b) => a.book.number - b.book.number);
  // Misma función que usa la server action como guarda: la ficha no decide nada
  // por su cuenta sobre a quién se le puede mandar el acceso (spec §8: el envío
  // se ofrece "desde carga de fichas o ficha").
  const sendTarget = verificationTarget(member);
  const address = member.street
    ? `${member.street.name} ${member.streetNumber ?? ""}`.trim()
    : [member.streetText, member.streetNumber].filter(Boolean).join(" ");

  return (
    <div className="space-y-4">
      {/* `error` y no `warning`: de los avisos que puede abrir esta ficha, éste
          es el único donde ahora mismo está saliendo plata de la cuenta de un
          vecino que ya no es socio. Va en el mismo color en las dos pantallas
          que lo dan (acá y el lote de cesantía). */}
      {debitPending > 0 && (
        <FormMessage kind="error" box>
          {`La baja quedó asentada, pero Mercado Pago no aceptó cancelar ${
            debitPending === 1 ? "el débito automático" : `${debitPending} débitos automáticos`
          }. `}
          <Link
            className="font-medium underline underline-offset-2 outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            href="/admin/tesoreria/suscripciones"
          >
            {debitPending === 1 ? "Cancelalo desde Suscripciones" : "Cancelalos desde Suscripciones"}
          </Link>
          {debitPending === 1
            ? " — mientras siga vivo, se le va a seguir cobrando."
            : " — mientras sigan vivos, se le va a seguir cobrando."}
        </FormMessage>
      )}

      {member.addressPendingReview && (
        <FormMessage kind="warning" box>
          El socio actualizó su domicilio desde el panel y está pendiente de constatación.
          <form action={confirmAddressAction} className="mt-2">
            <input type="hidden" name="memberId" value={member.id} />
            <Button variant="outline" className="min-h-11">
              Marcar constatado
            </Button>
          </form>
        </FormMessage>
      )}

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
              <div className="space-y-4">
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
                      {/* El único flag de la ficha que se corrige desde acá: tres
                          caminos lo suben y ninguno lo bajaba. Ocupa dos celdas
                          porque lleva la explicación de qué significa. */}
                      <div className="col-span-2 md:col-span-1">
                        <dt className="text-xs uppercase text-muted-foreground">Débito automático</dt>
                        <dd className="mt-1">
                          <AutoDebitForm memberId={member.id} autoDebit={member.autoDebit} />
                        </dd>
                      </div>
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

                {/* En qué libros está asentada esta persona. Con un solo libro es
                    una línea, pero después del re-empadronamiento son dos números
                    distintos para el mismo socio (REG-29: la antigüedad no se
                    reinicia), y la ficha es donde se pregunta "¿qué número tenía
                    antes?". El más viejo primero: se lee como historia. */}
                <Card size="sm">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <BookMarked className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      Libros
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-1">
                    {bookEntries.length === 0 ? (
                      <EmptyState size="card" description="No está asentado en ningún libro." />
                    ) : (
                      bookEntries.map((m) => (
                        <p key={m.id} className="text-sm">
                          Libro <span className="font-mono tabular-nums">{m.book.number}</span>
                          {" · N° "}
                          <span className="font-mono tabular-nums">{m.memberNumber}</span>
                          {m.book.status === "closed" && (
                            <span className="text-muted-foreground"> · cerrado</span>
                          )}
                        </p>
                      ))
                    )}
                  </CardContent>
                </Card>
              </div>
            ),
            cuenta: (
              <AccountSection
                member={member} account={account} rows={grid} admin
                receiptHref={(receiptId) => `/admin/tesoreria/recibos/${receiptId}`}
                autoDebit={{
                  flagged: member.autoDebit,
                  // El monto es `Decimal` en la base y número en la vista: el
                  // resto de la cuenta corriente ya viaja así (`fetchMemberAccount`).
                  live: liveSubscriptions.map((s) => ({
                    ...s, amount: s.amount === null ? null : Number(s.amount),
                  })),
                  cancelledCount: subscriptions.length - liveSubscriptions.length,
                  withdrawn: member.status === "withdrawn",
                }}
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
