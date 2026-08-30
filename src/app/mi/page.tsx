import Link from "next/link";
import { ClipboardCheck, Library, RefreshCw, User, Wallet } from "lucide-react";

import { MemberCard } from "@/components/mi/member-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireMember } from "@/lib/auth/require-member";
import { formatARS, formatDateAR } from "@/lib/format";
import { memberExemptionFact } from "@/lib/members/debit-adhesion";
import { electoralStatusFor } from "@/lib/mi/identity";
import { isCharging, isNotCancelled } from "@/lib/mp/subscription-status";
import { prisma } from "@/lib/prisma";
import { openWizardProcess } from "@/lib/reregistration/current";
import { currentDeadline } from "@/lib/reregistration/rules";
import { activeExemption } from "@/lib/treasury/exemptions";
import { feeValueReader } from "@/lib/treasury/fee-values";
import { civilDayOf, currentPeriod } from "@/lib/treasury/periods";
import { ACCRUING_CATEGORIES, categoryPaysFee, debtAmount } from "@/lib/treasury/rules";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mi panel — Vecinal Ciudadela" };

const LINK_CTA =
  "inline-flex min-h-11 items-center text-sm font-medium text-primary outline-hidden hover:underline focus-visible:ring-2 focus-visible:ring-ring";

function QuickLink(props: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  description: string;
}) {
  const Icon = props.icon;
  return (
    <Link
      href={props.href}
      className="flex min-h-24 flex-col justify-between rounded-xl bg-card p-4 ring-1 ring-foreground/10 outline-hidden transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Icon className="size-5 text-primary" aria-hidden />
      <span>
        <span className="block text-sm font-semibold">{props.label}</span>
        <span className="block text-xs text-muted-foreground">{props.description}</span>
      </span>
    </Link>
  );
}

export default async function MiHomePage() {
  // La página se autoriza sola (el layout corre en paralelo y no la protege).
  const actor = await requireMember({ allowSuspended: true });
  if (!actor.ok) return null; // el layout ya explica por qué
  const [member, pendingCount, arrears, feeValue, debitSubs, openProcess, exemption] = await Promise.all([
    prisma.member.findUniqueOrThrow({
      where: { id: actor.memberId },
      select: {
        fullName: true,
        category: true,
        status: true,
        joinedAt: true,
        memberships: { select: { memberNumber: true, book: { select: { status: true } } } },
      },
    }),
    prisma.fee.count({ where: { memberId: actor.memberId, status: "pending" } }),
    // Mora electoral: pendientes ANTERIORES al mes en curso (misma definición
    // que el padrón de 4C — la cuota del mes corriente no es mora).
    prisma.fee.count({
      where: { memberId: actor.memberId, status: "pending", period: { lt: currentPeriod() } },
    }),
    feeValueReader.current(),
    // Consulta liviana para la tarjeta de débito: sólo el status, nada de lo
    // que ya trae `memberDebit.preview` (eso lo resuelve /mi/debito).
    prisma.mpSubscription.findMany({ where: { memberId: actor.memberId }, select: { status: true } }),
    // El proceso de re-empadronamiento abierto, si lo hay. Lectura DIRECTA (la
    // misma que usan el wizard y su action): esta pantalla es `force-dynamic` y
    // no hay nada que cachear. Sin proceso son cero consultas más abajo.
    openWizardProcess(prisma),
    // Art. 7 inc. a.4. La MISMA función que corta en `startMemberPaymentAction`
    // y que esconde la sección de pago en `/mi/cuenta`. De acá salen los DOS
    // atajos que esta pantalla no le ofrece al eximido: "Pagar ahora", que
    // mandaba a un ancla `#pagar` que esa pantalla ya no renderiza, y
    // "Adherirme", que terminaba en el bloqueo de `/mi/debito`.
    activeExemption(prisma, actor.memberId),
  ]);
  // ¿A ESTE socio le falta presentarse? La cohorte se congeló al convocar, así
  // que la fila de `presentations` es la respuesta completa: sin fila no fue
  // convocado (no es adherente, o lo recategorizaron después) y no se le muestra
  // nada. `pending` = no presentó; `observed` = presentó y le pidieron que
  // corrija. `submitted`, `validated`, `rejected` y `withdrawn` no tienen nada
  // que hacer acá: o ya cumplió, o el trámite terminó.
  const pendingPresentation =
    openProcess === null
      ? null
      : await prisma.presentation.findFirst({
          where: {
            processId: openProcess.id,
            memberId: actor.memberId,
            status: { in: ["pending", "observed"] },
          },
          select: { status: true },
        });
  // El plazo que corre AHORA (la 2ª instancia manda sobre la 1ª): la misma
  // función que usan los correos y el wizard, para que las tres superficies no
  // le citen al socio fechas distintas.
  const deadline = openProcess === null ? null : currentDeadline(openProcess);
  const reregistration =
    pendingPresentation === null
      ? null
      : {
          status: pendingPresentation.status,
          deadline: deadline === null ? null : formatDateAR(deadline),
        };
  // El número vigente es el del libro ABIERTO (mismo criterio que Deudores).
  const memberNumber =
    member.memberships.find((m) => m.book.status === "open")?.memberNumber ?? null;
  const electoral = electoralStatusFor({
    category: member.category,
    status: member.status,
    joinedAt: member.joinedAt,
    arrears,
    // Día civil argentino, no el instante: con `new Date()`, entre las 00:00 y
    // las 08:59 AR del día 90 la credencial decía "te falta 1 día" a quien ya
    // cumple (joinedAt vive a mediodía UTC). Misma clase de bug que ya
    // corrigieron feeValueReader.current() y parseMinuteDate.
    at: civilDayOf(),
  });
  const paysFee = categoryPaysFee(member.category);
  const accrues = (ACCRUING_CATEGORIES as readonly string[]).includes(member.category);
  const debt = feeValue ? debtAmount(pendingCount, member.category, feeValue) : null;
  // Lista NEGRA de un valor (`isNotCancelled`), no la blanca: acá interesa
  // "¿hay algo vivo?", igual que /mi/debito. `isCharging` decide entre las dos
  // frases positivas.
  const liveDebitStatuses = debitSubs.filter((s) => isNotCancelled(s.status)).map((s) => s.status);
  const debitState: "active" | "pending" | "none" = liveDebitStatuses.some(isCharging)
    ? "active"
    : liveDebitStatuses.length > 0
      ? "pending"
      : "none";

  return (
    <div className="space-y-4">
      <h1 className="sr-only">Inicio</h1>
      {reregistration !== null && (
        /* Llamado al re-empadronamiento. Va ARRIBA de la credencial y con
           `ring-primary`: es lo único de esta pantalla que tiene un plazo del
           que cuelga la baja del socio (Art. 9° bis), y el que entra al panel es
           justamente el que más fácil se pierde el correo. Desaparece solo
           cuando la presentación deja de estar `pending`/`observed`. */
        <Card className="ring-2 ring-primary">
          <CardHeader>
            <CardTitle as="h2" className="flex items-center gap-2">
              <ClipboardCheck className="size-4 text-primary" aria-hidden />
              Re-empadronate
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {reregistration.status === "observed" ? (
              // Una presentación observada NO se reabre tipeando el DNI (es la
              // garantía de `lookupVerdict`: el enlace del correo es lo único
              // que acredita que es él). Lo que se le ofrece acá es pedir que se
              // lo reenviemos, que es lo que hace el paso 1 con una observada.
              <p className="text-sm">
                La Comisión Directiva te pidió que corrijas algo de tu presentación. Entrá con el
                enlace que te mandamos por correo; si no lo tenés a mano, pedí que te lo
                reenviemos.
              </p>
            ) : (
              <p className="text-sm">
                Todavía no presentaste tu re-empadronamiento. Es obligatorio para seguir figurando
                en el padrón.
              </p>
            )}
            {reregistration.deadline !== null && (
              <p className="text-sm font-medium text-warning">
                Tenés tiempo hasta el {reregistration.deadline}.
              </p>
            )}
            <Link className={LINK_CTA} href="/reempadronate">
              {reregistration.status === "observed" ? "Pedir el enlace →" : "Re-empadronarme →"}
            </Link>
          </CardContent>
        </Card>
      )}
      <MemberCard
        fullName={member.fullName}
        memberNumber={memberNumber}
        category={member.category}
        joinedAt={member.joinedAt}
        electoral={electoral}
      />

      <Card>
        <CardHeader>
          <CardTitle as="h2" className="flex items-center gap-2">
            <Wallet className="size-4 text-primary" aria-hidden />
            Mi cuenta
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!paysFee ? (
            <p className="text-sm text-muted-foreground">Tu categoría no paga cuota.</p>
          ) : pendingCount > 0 ? (
            <p className="text-sm font-medium text-warning">
              Debés {pendingCount} {pendingCount === 1 ? "cuota" : "cuotas"}
              {debt !== null && <> · {formatARS(debt)} a valor vigente</>}
            </p>
          ) : accrues ? (
            <p className="text-sm font-medium text-success">Estás al día.</p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Tu aporte es voluntario: no tenés cuotas pendientes.
            </p>
          )}
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            <Link className={LINK_CTA} href="/mi/cuenta">
              Ver mi cuenta →
            </Link>
            {paysFee && feeValue && !exemption && (
              <Link className={LINK_CTA} href="/mi/cuenta#pagar">
                Pagar ahora →
              </Link>
            )}
          </div>
        </CardContent>
      </Card>

      {paysFee && (
        <Card>
          <CardHeader>
            <CardTitle as="h2" className="flex items-center gap-2">
              <RefreshCw className="size-4 text-primary" aria-hidden />
              Débito automático
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {debitState === "active" ? (
              <p className="text-sm font-medium text-success">Activo</p>
            ) : debitState === "pending" ? (
              <p className="text-sm font-medium text-muted-foreground">Pendiente de autorización</p>
            ) : exemption ? (
              // Art. 7 inc. a.4, misma familia que el atajo "Pagar ahora": sin
              // esto la tarjeta lo invitaba a adherirse y `/mi/debito` lo
              // frenaba con el bloqueo de la exención — un viaje de ida a una
              // puerta cerrada. Se le dice el HECHO, que es lo que explica por
              // qué no hay nada que ofrecerle acá.
              <p className="text-sm text-muted-foreground">
                {`${memberExemptionFact(exemption.toPeriod)}.`}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">No estás adherido.</p>
            )}
            {/* El eximido con un débito vivo (teórico: la guarda 3 del asiento
                lo impide) SÍ conserva el enlace: esa tarjeta le ofrece
                cancelarlo, que es lo que corresponde. Lo que se esconde es la
                invitación a adherirse. */}
            {(debitState !== "none" || !exemption) && (
              <Link className={LINK_CTA} href="/mi/debito">
                {debitState === "none" ? "Adherirme →" : "Ver mi débito →"}
              </Link>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-4">
        <QuickLink href="/mi/datos" icon={User} label="Mis datos" description="Tu ficha del padrón" />
        <QuickLink href="/mi/documentos" icon={Library} label="Documentos" description="Estatuto, memorias y balances" />
      </div>
    </div>
  );
}
