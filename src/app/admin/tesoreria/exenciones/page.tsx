// Tesorería → Exenciones (Art. 7 inc. a.4): las vigentes, el historial, el
// asiento de una nueva y la anulación de una vigente.
//
// Es la única pestaña de Tesorería donde no entra plata: la Comisión exime a un
// socio ACTIVO de la cuota mensual por hasta 24 meses, y el aporte equivalente o
// la contribución en especie constan en el ACTA, no acá (decisión 1 de la spec).
// Por eso no hay un solo importe en toda la pantalla.
//
// El encabezado NO se escribe acá: lo pone el layout de Tesorería, junto con las
// pestañas. La guarda tampoco se hereda de él (Next renderiza layout y página en
// paralelo), así que la página llama a `requireAdmin()` por su cuenta.
//
// ── Los dos niveles de permiso ──────────────────────────────────────────────
// Mismo criterio que Valores de cuota (decisión 12): el admin común entra a ver
// quién está eximido y hasta cuándo —es consulta—, pero asentar y anular es del
// superadmin. El `requireSuperadmin` de acá SÓLO decide qué se dibuja: la
// autorización real la vuelven a hacer las dos actions.
//
// ── Pre-validación, no defensa ──────────────────────────────────────────────
// Con un socio elegido, la pantalla mira las cinco guardas del §5 para poder
// DECIR qué falta (categoría, estado, deuda, débito vivo, otra exención). El
// dominio las revalida todas dentro de su transacción: entre lo que el operador
// ve y el botón puede haber pasado un cobro de mostrador o el cron del día 1.
//
// ── Por qué la anulación tiene pantalla propia (`?anular={id}`) ─────────────
// `MinutePicker` escribe ids fijos para los campos del acta nueva
// (`minuteType`, `minuteNumber`, `minuteDate`), así que dos selectores montados
// a la vez en ese modo duplican esos ids en el documento y cada <label> queda
// apuntando al primero. Con la anulación en su propia vista hay exactamente un
// selector por pantalla, y de paso el acto que no se puede rehacer se confirma
// mirando sólo eso.
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { EmptyState } from "@/components/admin/empty-state";
import { FormMessage } from "@/components/admin/form-message";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { INLINE_LINK } from "@/lib/admin/link-styles";
import { memberStatusBadgeVariant } from "@/lib/admin/status-badges";
import { requireAdmin, requireSuperadmin } from "@/lib/auth/require-admin";
import { formatDateAR } from "@/lib/format";
import { CATEGORY_LABELS, MINUTE_TYPE_LABELS, minuteName, STATUS_LABELS } from "@/lib/members/labels";
import type { MinuteDraftDefaults, MinuteOption } from "@/lib/members/minute-choice";
import { countChargeable } from "@/lib/mp/subscription-status";
import { prisma } from "@/lib/prisma";
import {
  activeExemption,
  exemptions,
  MAX_EXEMPTION_MONTHS,
  monthsLeft,
  type ExemptionRecord,
} from "@/lib/treasury/exemptions";
import { searchMembers } from "@/lib/treasury/member-search";
import { addMonths, civilDayOf, comparePeriods, currentPeriod, periodLabel } from "@/lib/treasury/periods";
import { cn } from "@/lib/utils";
import type { MemberCategory, MemberStatus, MinuteType } from "@/generated/prisma/client";
import { GrantExemptionForm } from "./grant-form";
import { RevokeExemptionForm } from "./revoke-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Exenciones — SIGeV" };

const BASE = "/admin/tesoreria/exenciones";
const NUM = "font-mono tabular-nums";
const SECTION_TITLE = "text-sm font-semibold tracking-widest text-muted-foreground uppercase";

type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Hay un aviso arriba de la pantalla, así que el buscador no se roba el foco:
 *  moverlo se lleva por delante el mensaje sin leer (el criterio de Otros
 *  ingresos, que es el molde de esta pantalla). */
function hasNotice(sp: SearchParams): boolean {
  return one(sp.asentada) === "1" || one(sp.anulada) === "1";
}

/** Las actas que ofrecen los selectores, y con qué arranca el modo "Acta
 *  nueva". Sólo hacen falta si el que mira puede asentar o anular: al admin
 *  común no se le dibuja ningún selector, así que no se le cobran las consultas. */
async function loadMinutes(now: Date): Promise<{ minutes: MinuteOption[]; minuteDefaults: MinuteDraftDefaults }> {
  const [rows, maxByType] = await Promise.all([
    prisma.minute.findMany({ orderBy: [{ date: "desc" }, { id: "desc" }], take: 30 }),
    // El número siguiente por tipo, para SUGERIR el del acta nueva. Se pregunta
    // por el máximo y no por la lista de arriba, que viene ordenada por fecha y
    // recortada a 30: el índice único es (tipo, número), y un número ya usado se
    // rechazaría recién al confirmar.
    prisma.minute.groupBy({ by: ["type"], _max: { number: true } }),
  ]);
  const next = (type: MinuteType) => (maxByType.find((g) => g.type === type)?._max.number ?? 0) + 1;
  return {
    minutes: rows.map((m) => ({
      id: m.id,
      label: `${MINUTE_TYPE_LABELS[m.type]} N° ${m.number} — ${formatDateAR(m.date)}`,
    })),
    minuteDefaults: {
      type: "board",
      numberByType: { board: next("board"), assembly: next("assembly") },
      // El día se resuelve con el calendario argentino y no con el reloj UTC del
      // server: a las 21:00 de acá UTC ya está en el día siguiente, y el acta
      // nacería fechada mañana (que `parseMinuteDate` además rechaza).
      date: civilDayOf(now).toISOString().slice(0, 10),
    },
  };
}

export default async function ExencionesPage(props: { searchParams: Promise<SearchParams> }) {
  const [actor, sa] = await Promise.all([requireAdmin(), requireSuperadmin()]);
  if (!actor.ok) return <FormMessage kind="error" box>{actor.error}</FormMessage>;
  const superadmin = sa.ok;

  const sp = await props.searchParams;
  const now = new Date();
  const current = currentPeriod(now);

  const [inForce, history] = await Promise.all([exemptions.listInForce(), exemptions.history()]);
  // `minuteDefaults` vacío es un valor legítimo (todos sus campos son
  // opcionales) y nadie lo va a leer: sin superadmin no se dibuja un solo
  // selector de actas.
  const actas = superadmin ? await loadMinutes(now) : { minutes: [], minuteDefaults: {} };

  // La anulación sólo se ofrece sobre una exención VIGENTE, y la lista de
  // vigentes es la que decide: `revoke` no revalida la vigencia (una vencida
  // anulada no cambiaría nada), así que la pantalla simplemente nunca la ofrece.
  const anular = Number(one(sp.anular));
  const revokeId = superadmin && Number.isInteger(anular) && anular > 0 ? anular : null;
  const target = revokeId === null ? null : inForce.find((e) => e.id === revokeId) ?? null;

  if (target) {
    return <RevokeScreen exemption={target} current={current} actas={actas} />;
  }

  const socio = Number(one(sp.socio));
  const memberId = Number.isInteger(socio) && socio > 0 ? socio : null;
  const q = one(sp.q)?.trim() ?? "";

  return (
    <div className="space-y-6">
      {one(sp.asentada) === "1" && (
        <FormMessage kind="success" box>
          Exención asentada con su acta. El socio deja de devengar la cuota en los meses del rango.
        </FormMessage>
      )}
      {one(sp.anulada) === "1" && (
        <FormMessage kind="success" box>
          Exención anulada con su acta. Los meses futuros vuelven a devengar; el mes en curso y los
          transcurridos quedan exentos.
        </FormMessage>
      )}
      {revokeId !== null && (
        // Llegó con `?anular=` sobre algo que ya no está vigente: otro
        // administrador la anuló, o venció mientras la pantalla estaba abierta.
        <FormMessage kind="error" box>
          Esa exención ya no está vigente: puede que otro administrador la haya anulado.
        </FormMessage>
      )}

      <GrantSection
        superadmin={superadmin}
        autoFocusSearch={!hasNotice(sp)}
        q={q}
        memberId={memberId}
        current={current}
        actas={actas}
      />

      <section className="space-y-3" aria-labelledby="vigentes-title">
        <h2 id="vigentes-title" className={SECTION_TITLE}>Exenciones vigentes</h2>
        {inForce.length === 0 ? (
          <EmptyState
            description={
              superadmin
                ? "No hay ninguna exención de cuota vigente. Se asientan desde «Eximir de cuota», acá arriba."
                : "No hay ninguna exención de cuota vigente."
            }
          />
        ) : (
          <div className="space-y-3">
            {inForce.map((e) => (
              <InForceCard
                key={e.id}
                exemption={e}
                current={current}
                now={now}
                superadmin={superadmin}
              />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3" aria-labelledby="historial-title">
        <h2 id="historial-title" className={SECTION_TITLE}>Historial</h2>
        {history.length === 0 ? (
          <EmptyState description="Todavía no venció ni se anuló ninguna exención." />
        ) : (
          <div className="space-y-2">
            {history.map((e) => <PastCard key={e.id} exemption={e} />)}
          </div>
        )}
      </section>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Vigentes e historial
// ─────────────────────────────────────────────────────────────────────────────

/** El rango en palabras, que es como lo dice el acta: "septiembre 2026 a agosto
 *  2027". Nunca en `AAAA-MM`, que es formato de máquina. */
function rangeLabel(e: { fromPeriod: string; toPeriod: string }): string {
  return `${periodLabel(e.fromPeriod)} a ${periodLabel(e.toPeriod)}`;
}

/** El enlace al acta: LLEVA por `id` —que es la clave de la fila— y DICE tipo y
 *  número, que es como el acta se identifica en el libro y lo único con lo que
 *  el operador puede ir a buscarla. Nombrarla por el id (el "Acta #16" que leyó
 *  la verificación en vivo sobre la Comisión Directiva N° 124) apunta a otro
 *  documento, porque las dos numeraciones son independientes. */
function MinuteLink({ id, children }: { id: number; children: React.ReactNode }) {
  return <Link className={INLINE_LINK} href={`/admin/actas/${id}`}>{children}</Link>;
}

function InForceCard({ exemption, current, now, superadmin }: {
  exemption: ExemptionRecord;
  current: string;
  now: Date;
  superadmin: boolean;
}) {
  // "Vigente" incluye a la que TODAVÍA NO EMPEZÓ: el "no entra ni un peso" rige
  // desde que la Comisión lo decidió, no desde el primer mes eximido (spec
  // §3.1). Las dos van en la misma lista, pero no dicen lo mismo — a la que no
  // empezó no se le puede decir "faltan N meses", porque le faltarían más que
  // los que dura: se la rotula por su mes de arranque.
  const started = comparePeriods(exemption.fromPeriod, current) <= 0;
  const left = monthsLeft(exemption.toPeriod, now);

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h3" className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <span className="flex items-center gap-2">
            <ShieldCheck aria-hidden className="size-4 text-primary" />
            <Link className={cn(INLINE_LINK, "font-medium")} href={`/admin/socios/${exemption.memberId}`}>
              {exemption.member.fullName}
            </Link>
          </span>
          {started ? (
            <Badge variant="success">Vigente</Badge>
          ) : (
            <Badge variant="secondary">Comienza en {periodLabel(exemption.fromPeriod)}</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <span className={NUM}>N° {exemption.member.memberNumber ?? "—"}</span>
          <span aria-hidden>·</span>
          <span>{rangeLabel(exemption)}</span>
          <span aria-hidden>·</span>
          <span>
            <span className={NUM}>{exemption.months}</span> {exemption.months === 1 ? "mes" : "meses"}
          </span>
          {started && (
            <>
              <span aria-hidden>·</span>
              <span>
                {left === 1 ? "último mes" : <>faltan <span className={NUM}>{left}</span> meses</>}
              </span>
            </>
          )}
        </p>
        <p className="text-sm">
          <MinuteLink id={exemption.minuteId}>Acta {minuteName(exemption.minute)}</MinuteLink>
        </p>
        {/* La nota es texto libre del operador ("contribución en especie:
            pintura de la sede") y se lee acá, que es panel de admin: no viaja a
            la auditoría ni al log (Ley 25.326). */}
        {exemption.note && <p className="text-sm whitespace-pre-line">{exemption.note}</p>}
        {superadmin && (
          <p>
            <Link
              className="inline-flex min-h-11 items-center text-sm text-destructive outline-hidden hover:underline focus-visible:ring-2 focus-visible:ring-ring"
              href={`${BASE}?anular=${exemption.id}`}
            >
              Anular
              {/* Una columna entera de "Anular" son destinos idénticos para un
                  lector de pantalla: el sufijo oculto dice cuál es cuál. */}
              <span className="sr-only"> la exención de {exemption.member.fullName}</span>
            </Link>
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/** Una vencida o anulada: una línea con sus actas. No lleva acción — anular una
 *  exención que ya no rige no cambiaría nada. */
function PastCard({ exemption }: { exemption: ExemptionRecord }) {
  const revoked = exemption.revokedAt !== null;
  return (
    <Card size="sm">
      <CardContent className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <Link className={cn(INLINE_LINK, "font-medium")} href={`/admin/socios/${exemption.memberId}`}>
          {exemption.member.fullName}
        </Link>
        <span className="text-muted-foreground">
          <span className={NUM}>N° {exemption.member.memberNumber ?? "—"}</span> · {rangeLabel(exemption)}
        </span>
        <Badge variant={revoked ? "destructive" : "outline"}>
          {revoked ? `Anulada el ${formatDateAR(exemption.revokedAt!)}` : "Vencida"}
        </Badge>
        <span className="text-muted-foreground">
          <MinuteLink id={exemption.minuteId}>Acta {minuteName(exemption.minute)}</MinuteLink>
          {exemption.revokeMinuteId !== null && exemption.revokeMinute !== null && (
            <>
              {" · anulación: "}
              <MinuteLink id={exemption.revokeMinuteId}>
                Acta {minuteName(exemption.revokeMinute)}
              </MinuteLink>
            </>
          )}
        </span>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// La anulación, en su propia vista
// ─────────────────────────────────────────────────────────────────────────────

function RevokeScreen({ exemption, current, actas }: {
  exemption: ExemptionRecord;
  current: string;
  actas: { minutes: MinuteOption[]; minuteDefaults: MinuteDraftDefaults };
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Anular la exención de {exemption.member.fullName}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          <span className={NUM}>N° {exemption.member.memberNumber ?? "—"}</span> ·{" "}
          {rangeLabel(exemption)} · asentada por{" "}
          <MinuteLink id={exemption.minuteId}>acta {minuteName(exemption.minute)}</MinuteLink>
        </p>
        <FormMessage kind="warning" box as="div" role="none">
          <p>
            Los meses transcurridos y el corriente (<strong>{periodLabel(current)}</strong>) quedan
            exentos; los <strong>meses futuros vuelven a devengar</strong> — el devengo los repuebla
            como cuotas normales en su próxima corrida (decisión 9 de la spec).
          </p>
          <p className="mt-2">
            La anulación se asienta <strong>una sola vez</strong>, con su acta: es el documento que
            la asociación presenta si alguien discute que la exención se levantó.
          </p>
        </FormMessage>
        <RevokeExemptionForm
          exemptionId={exemption.id}
          backHref={BASE}
          minutes={actas.minutes}
          minuteDefaults={actas.minuteDefaults}
        />
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// El asiento
// ─────────────────────────────────────────────────────────────────────────────

async function GrantSection({ superadmin, autoFocusSearch, q, memberId, current, actas }: {
  superadmin: boolean;
  autoFocusSearch: boolean;
  q: string;
  memberId: number | null;
  current: string;
  actas: { minutes: MinuteOption[]; minuteDefaults: MinuteDraftDefaults };
}) {
  if (!superadmin) {
    return (
      <Card>
        <CardHeader><CardTitle as="h2">Eximir de cuota</CardTitle></CardHeader>
        <CardContent>
          <FormMessage kind="neutral" box role="none">
            Asentar y anular una exención es del superadmin, como el valor de cuota. Acá podés ver
            quién está eximido, hasta cuándo y con qué acta.
          </FormMessage>
        </CardContent>
      </Card>
    );
  }

  const member = memberId === null ? null : await prisma.member.findUnique({
    where: { id: memberId },
    select: {
      id: true, fullName: true, category: true, status: true,
      memberships: { where: { book: { status: "open" } }, select: { memberNumber: true }, take: 1 },
    },
  });

  return (
    <Card>
      <CardHeader><CardTitle as="h2">Eximir de cuota</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {memberId !== null && !member && (
          // `?socio=` apuntaba a un id que ya no existe (o nunca existió): sin
          // este aviso el operador vuelve al buscador vacío sin saber por qué
          // perdió la ficha que acababa de abrir.
          <FormMessage kind="error" box>No encontramos a ese socio. Buscalo de nuevo.</FormMessage>
        )}
        {member ? (
          <SelectedMember member={member} current={current} actas={actas} />
        ) : (
          <MemberSearch q={q} autoFocus={autoFocusSearch} />
        )}
        <p className="text-sm text-muted-foreground">
          El Art. 7 inc. a.4 exime al socio <strong>activo</strong> de la cuota mensual por hasta{" "}
          <span className={NUM}>{MAX_EXEMPTION_MONTHS}</span> meses, con acta de la Comisión. El
          aporte equivalente o la contribución en especie constan en el acta:{" "}
          <strong>a tesorería no entra nada</strong>, y mientras dure no se le puede cobrar ni una
          cuota ni un aporte.
        </p>
      </CardContent>
    </Card>
  );
}

async function MemberSearch({ q, autoFocus }: { q: string; autoFocus: boolean }) {
  // El buscador de Efectivo, importado tal cual: sólo encuentra socios con
  // membresía en el libro ABIERTO, que es lo que corresponde acá — el padrón
  // histórico no se exime.
  const hits = q === "" ? [] : await searchMembers(prisma, q);

  return (
    <div className="space-y-3">
      <form className="flex flex-wrap items-end gap-2" method="get">
        <Input
          name="q"
          placeholder="Número, apellido o DNI"
          defaultValue={q}
          className="w-64"
          autoFocus={autoFocus}
          aria-label="Buscar al socio que se exime"
        />
        <Button type="submit" variant="secondary" className="min-h-11">Buscar socio</Button>
      </form>
      {q === "" ? (
        <EmptyState size="card" description="Buscá al socio que la Comisión resolvió eximir." />
      ) : hits.length === 0 ? (
        <EmptyState description="Ningún socio coincide con la búsqueda." />
      ) : (
        <ul className="divide-y rounded-xl border">
          {hits.map((h) => (
            <li key={h.id}>
              <Link
                href={`${BASE}?socio=${h.id}`}
                className="flex min-h-11 flex-wrap items-center gap-x-3 px-3 py-2 text-sm outline-hidden hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className={NUM}>N° {h.memberNumber}</span>
                <span className="font-medium">{h.fullName}</span>
                <span className="text-muted-foreground">{CATEGORY_LABELS[h.category]}</span>
                {/* El buscador trae los tres estados y todas las categorías a
                    propósito (es el de Efectivo, intocable): el badge es lo
                    único que distingue en esta lista al que no se puede eximir,
                    y el corte con su motivo lo pone el dominio. */}
                <Badge variant={memberStatusBadgeVariant(h.status)}>{STATUS_LABELS[h.status]}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type SelectedMemberRow = {
  id: number;
  fullName: string;
  category: MemberCategory;
  status: MemberStatus;
  memberships: Array<{ memberNumber: number }>;
};

async function SelectedMember({ member, current, actas }: {
  member: SelectedMemberRow;
  current: string;
  actas: { minutes: MinuteOption[]; minuteDefaults: MinuteDraftDefaults };
}) {
  // Las cinco guardas del §5, en el mismo orden en que las revalida el dominio.
  // Las cuatro consultas van juntas: ninguna depende de la anterior.
  const [pending, subs, active, futureFees] = await Promise.all([
    prisma.fee.count({ where: { memberId: member.id, status: "pending" } }),
    prisma.mpSubscription.findMany({ where: { memberId: member.id }, select: { status: true } }),
    activeExemption(prisma, member.id),
    // Las cuotas que ya existen de este mes en adelante. Son poquísimas —el
    // devengo materializa hasta el mes vencido, así que acá sólo caen los pagos
    // adelantados y las exentas de una exención anterior— y son las que el
    // resumen del formulario necesita para decir, en vivo, qué mes del rango ya
    // está pago y va a quedar pago (decisión 11).
    prisma.fee.findMany({
      where: { memberId: member.id, period: { gte: current } },
      select: { period: true, status: true },
    }),
  ]);

  const number = member.memberships[0]?.memberNumber ?? null;
  const chargeable = countChargeable(subs);

  const blocker = (() => {
    if (member.category !== "active") {
      return (
        <>
          El Art. 7 inc. a.4 exime a los <strong>socios activos</strong>, y esta ficha es de
          categoría {CATEGORY_LABELS[member.category]}. Cambiala de categoría con acta si
          corresponde.
        </>
      );
    }
    if (member.status !== "active") {
      return (
        <>
          Sólo se exime a un socio vigente, y esta ficha está en estado{" "}
          {STATUS_LABELS[member.status]}. La suspensión es disciplinaria, no eximición: el
          suspendido sigue devengando.
        </>
      );
    }
    if (pending > 0) {
      return (
        <>
          Tiene <span className={NUM}>{pending}</span>{" "}
          {pending === 1 ? "cuota pendiente" : "cuotas pendientes"} y la exención exige estar al
          día: el Art. 7 perdona la cuota que viene, no la que quedó impaga.{" "}
          <Link className={INLINE_LINK} href={`/admin/tesoreria/efectivo?socio=${member.id}`}>
            Cobrale en Efectivo
          </Link>{" "}
          o llevá la deuda a la Comisión antes de eximirlo.
        </>
      );
    }
    if (chargeable > 0) {
      return (
        <>
          Tiene un débito automático que todavía puede cobrar: eximirlo dejaría entrando plata todos
          los meses contra el acta que la perdona. El débito de un socio vigente lo cancela él mismo
          desde su panel (Mi cuenta → Débito), a propósito: no existe cancelación por el admin.
        </>
      );
    }
    if (active) {
      return (
        <>
          Ya tiene una exención vigente hasta <strong>{periodLabel(active.toPeriod)}</strong> (
          <MinuteLink id={active.minuteId}>acta {minuteName(active.minute)}</MinuteLink>). La renovación
          nunca es automática: se asienta una nueva cuando ésta venza, o se anula la vigente con su
          acta.
        </>
      );
    }
    return null;
  })();

  return (
    <div className="space-y-4">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <Link className={cn(INLINE_LINK, "font-medium")} href={`/admin/socios/${member.id}`}>
          {member.fullName}
        </Link>
        <span className="text-muted-foreground">
          <span className={NUM}>N° {number ?? "—"}</span> · {CATEGORY_LABELS[member.category]} ·{" "}
          {STATUS_LABELS[member.status]}
        </span>
        <Link className={INLINE_LINK} href={BASE}>Elegir otro socio</Link>
      </p>

      {blocker ? (
        <FormMessage kind="warning" box as="div">{blocker}</FormMessage>
      ) : (
        <GrantExemptionForm
          memberId={member.id}
          maxMonths={MAX_EXEMPTION_MONTHS}
          currentPeriod={current}
          // El mes siguiente, sugerido (decisión 10): la exención suele empezar
          // el mes que viene, y el corriente puede tener cuota ya paga.
          suggestedFrom={addMonths(current, 1)}
          paidPeriods={futureFees.filter((f) => f.status === "paid").map((f) => f.period)}
          minutes={actas.minutes}
          minuteDefaults={actas.minuteDefaults}
        />
      )}
    </div>
  );
}
