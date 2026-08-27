// EXENCIÓN DE CUOTA (Art. 7 inc. a.4): el dominio.
//
// El artículo permite eximir a un socio ACTIVO del pago de la cuota mensual por
// hasta veinticuatro (24) meses, mediante aporte económico equivalente o
// contribución en especie valuada por la Comisión, con mayoría de 2/3. Acá vive
// todo lo que decide y escribe; las pantallas sólo pre-validan para el mensaje.
//
// ── Por qué es un archivo NUEVO y no un método del núcleo ────────────────────
// Ningún archivo existente de `src/lib/treasury/*` ni de `src/lib/mp/*` se
// modifica. El módulo no lo necesita: la exención se materializa como filas de
// `Fee` en estado `exempt`, y el núcleo YA las trata bien **por omisión** —el
// devengo saltea el período porque ya tiene fila, y la deuda no la cuenta
// porque pregunta por `status: "pending"` a secas—. Esa garantía es
// estructural, no una línea que diga "exempt", y por eso tiene su propio bloque
// de tests fijándola.
//
// ── El módulo NO registra plata ─────────────────────────────────────────────
// El aporte del Art. 7 consta en el acta de la Comisión, no en tesorería
// (decisión 1 del operador). Acá no hay recibos, ni montos, ni una sola llamada
// de red: la guarda 3 garantiza que el eximido no tenga débito que cancelar en
// Mercado Pago, así que las dos transacciones son puras contra la base.
//
// El cliente de Prisma se INYECTA (el singleton se arma al final), como en
// `board/notice.ts`: así el módulo se prueba entero sin base.
import type {
  MemberCategory, MemberStatus, MinuteType, PrismaClient,
} from "@/generated/prisma/client";
import { CATEGORY_LABELS, minuteName, STATUS_LABELS } from "@/lib/members/labels";
import { countChargeable } from "@/lib/mp/subscription-status";
import { prisma } from "@/lib/prisma";
import {
  addMonths,
  comparePeriods,
  currentPeriod,
  isPeriod,
  periodLabel,
  periodMonth,
  periodRange,
  periodYear,
  type Period,
} from "./periods";

/** "hasta veinticuatro (24) meses" — la letra del Art. 7 inc. a.4. */
export const MAX_EXEMPTION_MONTHS = 24;

/** El último mes eximido, INCLUSIVE: 12 meses desde octubre terminan en
 *  septiembre, no en octubre del año siguiente. */
export function exemptionToPeriod(fromPeriod: Period, months: number): Period {
  return addMonths(fromPeriod, months - 1);
}

/** Los períodos del rango. Sale de `periodRange` —que ya es inclusivo en los
 *  dos extremos y sabe cruzar diciembre— en vez de un bucle propio: el rango de
 *  una exención es el mismo objeto que el rango de cualquier otra cosa del
 *  proyecto, y dos aritméticas de meses son una de más. */
export function exemptionPeriods(fromPeriod: Period, months: number): Period[] {
  return periodRange(fromPeriod, exemptionToPeriod(fromPeriod, months));
}

function monthIndex(p: Period): number {
  return periodYear(p) * 12 + periodMonth(p);
}

/** Cuántos meses le quedan a una exención, contando el corriente. En el ÚLTIMO
 *  mes devuelve 1, y una vez vencida devuelve 0 y no negativos: la pantalla que
 *  muestra "faltan N meses" no puede decir "faltan -3". */
export function monthsLeft(toPeriod: Period, at: Date = new Date()): number {
  const diff = monthIndex(toPeriod) - monthIndex(currentPeriod(at)) + 1;
  return diff > 0 ? diff : 0;
}

/** Vigente = no anulada y `toPeriod` ≥ período corriente.
 *
 *  Incluye a la que todavía NO EMPEZÓ, y no es un descuido: el "no entra ni un
 *  peso" (decisión 8) rige desde que la Comisión lo decidió, no desde el primer
 *  mes eximido (spec §3.1). Si esto mirara también el `fromPeriod`, un socio
 *  con exención asentada hoy para octubre podría pagar en septiembre y la
 *  Comisión se enteraría cuando ya estuviera el recibo emitido. */
export function isInForce(
  e: { revokedAt: Date | null; toPeriod: string },
  at: Date = new Date(),
): boolean {
  return e.revokedAt === null && comparePeriods(e.toPeriod, currentPeriod(at)) >= 0;
}

/** El acta que respalda una exención, como se la NOMBRA: tipo y número.
 *
 *  Viaja junto al `minuteId` y no en su lugar: el id es a dónde LLEVA el enlace
 *  (`/admin/actas/{id}`) y el par tipo+número es lo que el operador LEE y busca
 *  en el libro. Mostrar el id como si fuera la referencia del acta era señalar
 *  un documento equivocado (ver `minuteName`). */
export type ExemptionMinute = { type: MinuteType; number: number };

/** Lo que las cinco guardas de bloqueo y las tres pantallas necesitan saber de
 *  una exención vigente. Sin datos del socio: quien pregunta ya lo tiene. */
export type ActiveExemption = {
  id: number;
  fromPeriod: string;
  toPeriod: string;
  months: number;
  minuteId: number;
  minute: ExemptionMinute;
  note: string | null;
};

const MINUTE_NAME_SELECT = { select: { type: true, number: true } } as const;

const EXEMPTION_SELECT = {
  id: true,
  fromPeriod: true,
  toPeriod: true,
  months: true,
  minuteId: true,
  // El acta viene con la fila y no la busca cada pantalla: son cinco bocas que
  // tienen que nombrar el mismo documento, y la relación es obligatoria en el
  // esquema, así que no cuesta una consulta aparte ni puede venir vacía.
  minute: MINUTE_NAME_SELECT,
  note: true,
} as const;

/** El handle de base de `activeExemption`: SÓLO la tabla que consulta.
 *
 *  Angosto a propósito. Sus llamadores son los cinco caminos de pago y tres
 *  pantallas, cada uno con su propio `Pick` de Prisma; pedirles el `Db` entero
 *  del servicio los obligaría a declarar modelos que no usan. */
export type ExemptionReaderDb = Pick<PrismaClient, "feeExemption">;

/** LA función compartida: la exención vigente del socio, o `null`.
 *
 *  Una sola definición para los cinco bloqueos y las tres pantallas (la lección
 *  de `coverageFloor`): si cada camino se armara su propio `where`, alcanzaría
 *  con que uno olvidara el `revokedAt: null` para que a un vecino se le siguiera
 *  bloqueando el pago después de que la Comisión le anuló la exención.
 *
 *  El `orderBy` es defensivo: la guarda 4 del asiento garantiza una sola vigente
 *  por socio, pero MySQL no tiene unique parcial y la garantía es de aplicación
 *  (mismo criterio que `member_requests`). Ante dos, gana la más nueva. */
export async function activeExemption(
  db: ExemptionReaderDb,
  memberId: number,
  at: Date = new Date(),
): Promise<ActiveExemption | null> {
  return db.feeExemption.findFirst({
    where: { memberId, revokedAt: null, toPeriod: { gte: currentPeriod(at) } },
    orderBy: { id: "desc" },
    select: EXEMPTION_SELECT,
  });
}

/** El aviso que leen las DOS pantallas de cobro del operador —efectivo y link
 *  de pago— y sus TRES actions (registrar efectivo, generar link, reenviarlo).
 *
 *  Una sola definición, por el mismo motivo que `activeExemption`: son cinco
 *  lugares que tienen que decir lo mismo, y el operador que lee "eximido hasta
 *  septiembre" en la pantalla no puede recibir otra fecha del servidor. Nombra
 *  el ACTA porque el destinatario es el operador: si no está de acuerdo con el
 *  bloqueo, el número es por dónde empieza a buscar la decisión en el libro.
 *
 *  Vive acá y no en las pantallas porque es dato del dominio de la exención, y
 *  este módulo ya importa `periodLabel`. Recibe sólo los dos campos que usa: le
 *  sirve tanto un `ActiveExemption` como cualquier fila que los traiga.
 *
 *  El acta se nombra por TIPO y NÚMERO, que es su referencia en el libro. Decía
 *  "acta N° 16" con el `id` de la fila, y eso no es una referencia sino otra
 *  acta: la verificación en vivo leyó "acta N° 16" sobre una exención asentada
 *  por la Comisión Directiva N° 124. */
export function adminExemptionNotice(e: { toPeriod: string; minute: ExemptionMinute }): string {
  return `El socio está eximido de la cuota hasta ${periodLabel(e.toPeriod)} (acta ${minuteName(e.minute)}).`;
}

/** Una exención con su socio, para las dos listas de la pestaña. */
export type ExemptionRecord = ActiveExemption & {
  memberId: number;
  member: { fullName: string; memberNumber: number | null };
  revokedAt: Date | null;
  revokeMinuteId: number | null;
  /** El acta de la ANULACIÓN, con el mismo criterio que `minute`: null cuando la
   *  exención venció sola, que es la otra mitad del historial. */
  revokeMinute: ExemptionMinute | null;
  createdAt: Date;
};

const RECORD_SELECT = {
  ...EXEMPTION_SELECT,
  memberId: true,
  revokedAt: true,
  revokeMinuteId: true,
  revokeMinute: MINUTE_NAME_SELECT,
  createdAt: true,
  member: {
    select: {
      fullName: true,
      // El número del LIBRO ABIERTO, que es con el que el operador busca a
      // alguien en el padrón. Un socio sin membresía ahí imprime "—" en vez de
      // romper la tarjeta.
      memberships: { where: { book: { status: "open" as const } }, select: { memberNumber: true }, take: 1 },
    },
  },
} as const;

/** `member` NO es opcional: la relación es obligatoria en el esquema
 *  (`member Member @relation(...)`, sin `?`), así que Prisma la infiere no nula y
 *  la fila viene siempre con su socio. Tipearla `| null` obligaba a castear el
 *  resultado del `findMany` y a inventar un `?? ""` que nunca corría. */
type RecordRow = ActiveExemption & {
  memberId: number;
  revokedAt: Date | null;
  revokeMinuteId: number | null;
  revokeMinute: ExemptionMinute | null;
  createdAt: Date;
  member: { fullName: string; memberships: Array<{ memberNumber: number }> };
};

function toRecord(r: RecordRow): ExemptionRecord {
  return {
    id: r.id,
    memberId: r.memberId,
    fromPeriod: r.fromPeriod,
    toPeriod: r.toPeriod,
    months: r.months,
    minuteId: r.minuteId,
    minute: r.minute,
    note: r.note,
    revokedAt: r.revokedAt,
    revokeMinuteId: r.revokeMinuteId,
    revokeMinute: r.revokeMinute,
    createdAt: r.createdAt,
    member: {
      fullName: r.member.fullName,
      memberNumber: r.member.memberships[0]?.memberNumber ?? null,
    },
  };
}

/** Los mensajes de las TRES guardas baratas del asiento: la ficha, su categoría
 *  y la exención que ya rige.
 *
 *  Se exportan porque la action las pre-valida ANTES de crear el acta —son los
 *  rechazos frecuentes, y un acta creada para un asiento que no ocurre es basura
 *  en el libro que la asociación presenta ante la IGJ—. Lo que se comparte es el
 *  TEXTO, que es la parte que importa: la pre-validación y la revalidación de
 *  adentro de la transacción tienen que decirle al operador exactamente lo
 *  mismo, se corte por donde se corte. */
export const GRANT_GUARD_MESSAGES = {
  noMember: "El socio no existe.",
  category: (category: MemberCategory) =>
    `El Art. 7 inc. a.4 exime a los socios activos, y esta ficha es de categoría ` +
    `${CATEGORY_LABELS[category]}. Cambiala de categoría con acta si corresponde.`,
  status: (status: MemberStatus) =>
    `Sólo se exime a un socio vigente, y esta ficha está en estado ` +
    `${STATUS_LABELS[status]}. La suspensión es disciplinaria, no eximición: ` +
    "el suspendido sigue devengando.",
  alreadyInForce: (toPeriod: string) =>
    `El socio ya tiene una exención vigente hasta ${periodLabel(toPeriod)}. ` +
    "La renovación nunca es automática: se asienta una nueva cuando ésta venza, o se anula " +
    "la vigente con su acta.",
} as const;

export type GrantInput = {
  memberId: number;
  fromPeriod: string;
  months: number;
  minuteId: number;
  note: string | null;
  actorId: number;
};

export type GrantResult =
  | {
      ok: true;
      exemptionId: number;
      /** El rango CALENDARIO del acta, entero. No es la lista de filas creadas:
       *  un mes ya pago del medio sigue perteneciendo al rango que la Comisión
       *  votó (decisión 11) y aparece además en `skippedPaid`. */
      periods: string[];
      /** Los meses del rango que ya estaban PAGOS y quedan pagos. La pantalla
       *  los nombra con todas las letras en la confirmación. */
      skippedPaid: string[];
    }
  | { ok: false; error: string };

export type RevokeInput = { exemptionId: number; revokeMinuteId: number; actorId: number };

export type RevokeResult = { ok: true; removedFuture: number } | { ok: false; error: string };

type Db = Pick<
  PrismaClient,
  "$transaction" | "member" | "fee" | "mpSubscription" | "feeExemption" | "movement" | "minute"
>;
/** El mismo conjunto de modelos, pero dentro de una transacción interactiva. */
type Tx = Omit<Db, "$transaction">;

type Deps = { db: Db; now?: () => Date };

/** El único mensaje de las DOS carreras con el cron de devengo del día 1.
 *
 *  El operador tiene que hacer lo mismo en los dos casos —reintentar—, y el
 *  hecho es el mismo: una cuota del rango apareció mientras se asentaba. */
const RACE_MESSAGE =
  "El devengo creó una cuota dentro del rango mientras se asentaba la exención. " +
  "No se guardó nada: reintentá el asiento.";

/** Con `@prisma/adapter-mariadb` el `meta.target` de la doc de Prisma NO existe
 *  (la lección de la 4C), así que la única señal confiable es el `code`. Acá
 *  alcanza: el único unique que estas escrituras pueden violar es
 *  `fees.@@unique([memberId, period])`. */
function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2002";
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Los DOS motivos por los que una anulación no procede, y son distintos: una
 *  ya anulada tiene su acta y su fecha (el hecho ocurrió, una sola vez); una
 *  vencida no tiene nada que levantar, porque se terminó sola. */
const ALREADY_REVOKED_MESSAGE =
  "Otro administrador ya la anuló: la anulación se asienta una sola vez, con su acta.";
const NOT_IN_FORCE_MESSAGE =
  "La exención ya venció: no hay nada que anular. Si la Comisión asienta una nueva, se anula esa.";

export function makeExemptions(deps: Deps) {
  const nowOf = () => deps.now?.() ?? new Date();

  /** La lista que consultan las dos pestañas. `inForce` decide de qué lado del
   *  corte cae cada fila; el `where` es uno solo y su negación es la otra
   *  lista, así que ninguna exención puede quedar fuera de las dos. */
  async function list(inForce: boolean): Promise<ExemptionRecord[]> {
    const current = currentPeriod(nowOf());
    const where = inForce
      ? { revokedAt: null, toPeriod: { gte: current } }
      : { OR: [{ revokedAt: { not: null } }, { toPeriod: { lt: current } }] };
    const rows = await deps.db.feeExemption.findMany({
      where,
      orderBy: inForce ? [{ fromPeriod: "asc" }, { id: "asc" }] : [{ id: "desc" }],
      select: RECORD_SELECT,
    });
    return rows.map(toRecord);
  }

  return {
    /** Asienta la exención: revalida las SEIS guardas del §5 de la spec, crea el
     *  registro, las cuotas exentas y el movimiento con su acta.
     *
     *  Todo adentro de UNA transacción y sin una sola llamada de red. Las
     *  guardas se revalidan acá aunque la pantalla ya las haya mirado: entre lo
     *  que el operador vio y el botón puede haber pasado un cobro de mostrador,
     *  una adhesión al débito o el cron del día 1. La pantalla pre-valida para
     *  el MENSAJE, nunca como única defensa. */
    async grant(input: GrantInput): Promise<GrantResult> {
      const now = nowOf();
      const current = currentPeriod(now);

      try {
        return await deps.db.$transaction(async (tx: Tx) => {
          // ── Guarda 1: la ficha ─────────────────────────────────────────────
          const member = await tx.member.findUnique({
            where: { id: input.memberId },
            select: { id: true, category: true, status: true },
          });
          if (!member) return { ok: false as const, error: GRANT_GUARD_MESSAGES.noMember };
          if (member.category !== "active") {
            return { ok: false as const, error: GRANT_GUARD_MESSAGES.category(member.category) };
          }
          if (member.status !== "active") {
            return { ok: false as const, error: GRANT_GUARD_MESSAGES.status(member.status) };
          }

          // ── Guarda 2: al día ───────────────────────────────────────────────
          // Nada de "eximir para tapar la deuda": el Art. 7 perdona la cuota
          // que viene, no la que quedó impaga.
          const pending = await tx.fee.count({
            where: { memberId: input.memberId, status: "pending" },
          });
          if (pending > 0) {
            return {
              ok: false as const,
              error:
                `El socio tiene ${plural(pending, "cuota pendiente", "cuotas pendientes")} y la exención ` +
                "exige estar al día. Cobralas en el mostrador o llevá la deuda a la Comisión antes de eximirlo.",
            };
          }

          // ── Guarda 3: sin débito cobrable ──────────────────────────────────
          // `countChargeable` es la lista BLANCA de siempre (`authorized`,
          // `pending`, `paused`): eximir a alguien de quien todavía puede salir
          // plata dejaría entrando una cuota por mes contra el acta que la
          // perdona. `findMany` y no `findFirst`: `mp_subscriptions.member_id`
          // es índice y no unique, y un vecino puede tener dos vivas.
          const subs = await tx.mpSubscription.findMany({
            where: { memberId: input.memberId },
            select: { status: true },
          });
          if (countChargeable(subs) > 0) {
            return {
              ok: false as const,
              error:
                "El socio tiene un débito automático que todavía puede cobrar: eximirlo dejaría entrando " +
                "plata todos los meses. El débito de un socio vigente lo cancela él mismo desde su panel " +
                "(Mi cuenta → Débito), a propósito: no existe cancelación por el admin.",
            };
          }

          // ── Guarda 4: una sola vigente ─────────────────────────────────────
          // Por `activeExemption` y no por un `where` propio: es LA función
          // compartida de "vigente" (la lección de `coverageFloor`), y una
          // segunda copia a mano es justo lo que su docblock advierte. `Tx`
          // satisface su `Pick` de lectura, así que la guarda mira exactamente lo
          // mismo que los cinco bloqueos de pago y las tres pantallas.
          const other = await activeExemption(tx, input.memberId, now);
          if (other) {
            return { ok: false as const, error: GRANT_GUARD_MESSAGES.alreadyInForce(other.toPeriod) };
          }

          // ── Guarda 5: el rango ─────────────────────────────────────────────
          if (
            !Number.isInteger(input.months) ||
            input.months < 1 ||
            input.months > MAX_EXEMPTION_MONTHS
          ) {
            return {
              ok: false as const,
              error: `La exención va de 1 a ${MAX_EXEMPTION_MONTHS} meses enteros (Art. 7 inc. a.4: "hasta veinticuatro").`,
            };
          }
          if (!isPeriod(input.fromPeriod)) {
            return { ok: false as const, error: "El mes de inicio tiene que tener el formato AAAA-MM." };
          }
          // El mes CORRIENTE se permite: el devengo materializa hasta el mes
          // vencido, así que el mes en curso todavía no tiene fila salvo pago
          // adelantado. Hacia atrás no: eximir un mes ya devengado sería
          // borrarle una cuota que la Comisión no trató.
          if (comparePeriods(input.fromPeriod, current) < 0) {
            return {
              ok: false as const,
              error: `La exención no puede empezar en un mes pasado: elegí ${periodLabel(current)} o uno posterior.`,
            };
          }

          // ── Guarda 6: el acta ──────────────────────────────────────────────
          // Se lee acá adentro y no antes por dos motivos: la fecha del acta es
          // la que fecha el movimiento (el historial de la ficha se lee contra
          // el libro de actas, no contra el reloj del servidor), y un id de acta
          // que no existe tiene que cortar sin escribir nada.
          const minute = await tx.minute.findUnique({
            where: { id: input.minuteId },
            select: { id: true, date: true },
          });
          if (!minute) {
            return { ok: false as const, error: "El acta indicada no existe." };
          }

          // ── Las escrituras ─────────────────────────────────────────────────
          const periods = exemptionPeriods(input.fromPeriod, input.months);
          const existing = await tx.fee.findMany({
            where: { memberId: input.memberId, period: { in: periods } },
            select: { period: true, status: true },
          });

          const skippedPaid: string[] = [];
          const taken = new Set<string>();
          for (const fee of existing) {
            taken.add(fee.period);
            if (fee.status === "paid") {
              // Decisión 11: la plata que ya entró no se devuelve ni se
              // convierte en exenta, y el rango calendario del acta no se corre.
              skippedPaid.push(fee.period);
            } else if (fee.status === "pending") {
              // No puede haber (guarda 2) salvo que el cron del día 1 la haya
              // creado entre aquel `count` y este `findMany`. No se la puede
              // dejar parada adentro de un rango eximido: sería deuda que el
              // vecino no debe.
              return { ok: false as const, error: RACE_MESSAGE };
            }
            // Cualquier otro estado ya ocupa el mes y no hay nada que crear. El
            // caso real es una `exempt`: anular una exención deja el mes
            // CORRIENTE exento (decisión 9) y la Comisión puede asentar una
            // nueva desde ese mismo mes.
          }

          const toCreate = periods.filter((p) => !taken.has(p));
          if (toCreate.length > 0) {
            // SIN `skipDuplicates`, y es deliberado. El devengo sí lo usa —y su
            // comentario explica por qué—, pero acá la conclusión se invierte:
            // si el cron insertara una `pending` del rango entre el `findMany`
            // de arriba y esta línea, `skipDuplicates` la dejaría pasar en
            // silencio y quedaría una cuota impaga adentro de una exención, sin
            // ninguna señal. Sin él choca contra `fees.@@unique([memberId,
            // period])`, la transacción entera vuelve atrás y el operador lee
            // "reintentá" (ver el `catch` de abajo).
            await tx.fee.createMany({
              data: toCreate.map((period) => ({
                memberId: input.memberId,
                period,
                status: "exempt" as const,
                origin: "exemption" as const,
              })),
            });
          }

          const toPeriod = exemptionToPeriod(input.fromPeriod, input.months);
          const created = await tx.feeExemption.create({
            data: {
              memberId: input.memberId,
              fromPeriod: input.fromPeriod,
              toPeriod,
              months: input.months,
              minuteId: minute.id,
              note: input.note,
              createdById: input.actorId,
            },
            select: { id: true },
          });

          await tx.movement.create({
            data: {
              memberId: input.memberId,
              type: "fee_exemption",
              date: minute.date,
              minuteId: minute.id,
              createdById: input.actorId,
              // Períodos y conteo, nunca datos personales: el movimiento se lee
              // en una pantalla que ya sabe de quién es la ficha.
              detail:
                `Exención de cuota: ${periodLabel(input.fromPeriod)} a ${periodLabel(toPeriod)} ` +
                `(${plural(input.months, "mes", "meses")})`,
            },
          });

          return { ok: true as const, exemptionId: created.id, periods, skippedPaid };
        });
      } catch (e) {
        if (isUniqueViolation(e)) return { ok: false, error: RACE_MESSAGE };
        throw e;
      }
    },

    /** Anula una exención con su acta: los meses transcurridos y el CORRIENTE
     *  quedan exentos, los futuros vuelven a devengar (decisión 9).
     *
     *  El devengo repuebla solo los meses futuros en su próxima corrida: por eso
     *  las filas se borran en vez de pasarse a `pending`. Dejarlas pendientes
     *  sería cobrarle al vecino, el mismo día de la anulación, meses que todavía
     *  no llegaron.
     *
     *  La VIGENCIA se revalida acá adentro (`isInForce`), como `grant` revalida
     *  sus seis guardas: la pantalla sólo ofrece anular las vigentes, pero el
     *  `?anular=` de una pestaña vieja llega igual — y una anulación es un
     *  asiento en la ficha del socio con su acta. */
    async revoke(input: RevokeInput): Promise<RevokeResult> {
      const now = nowOf();
      const current = currentPeriod(now);

      return deps.db.$transaction(async (tx: Tx) => {
        const exemption = await tx.feeExemption.findUnique({
          where: { id: input.exemptionId },
          // `revokedAt` y `toPeriod` son lo que `isInForce` necesita: la
          // vigencia se REVALIDA acá adentro, no se hereda de la pantalla.
          select: {
            id: true, memberId: true, fromPeriod: true, toPeriod: true, revokedAt: true,
          },
        });
        if (!exemption) return { ok: false as const, error: "La exención no existe." };

        // LA VIGENCIA SE REVALIDA, con `isInForce` —LA misma definición que usan
        // la lista de la pestaña y los cinco bloqueos de cobro—. El cerrojo de
        // más abajo cubre una sola de las dos formas de "ya no corresponde": ve
        // la anulada (`revokedAt` escrito) y NO ve la vencida, que llega con su
        // `revokedAt` en null desde una pestaña vieja o un reenvío del
        // formulario. Sin esto, esa segunda forma estampaba en la ficha del
        // socio un movimiento `fee_exemption_revoked` con su acta por un hecho
        // que nunca ocurrió: la exención no se levantó, se terminó sola.
        if (!isInForce(exemption, now)) {
          return {
            ok: false as const,
            error: exemption.revokedAt !== null ? ALREADY_REVOKED_MESSAGE : NOT_IN_FORCE_MESSAGE,
          };
        }

        const minute = await tx.minute.findUnique({
          where: { id: input.revokeMinuteId },
          select: { id: true, date: true },
        });
        if (!minute) return { ok: false as const, error: "El acta de anulación no existe." };

        // CERROJO OPTIMISTA: `revokedAt: null` viaja en el `where`. La guarda de
        // vigencia de arriba ya rechazó lo que se podía ver al leer; esto cubre
        // la CARRERA que no se puede ver así — dos transacciones anulando la
        // misma fila a la vez—, y es lo que impide pisar la fecha y el acta de la
        // primera anulación, que es el documento que la asociación presenta si
        // alguien discute la baja de la exención.
        const locked = await tx.feeExemption.updateMany({
          where: { id: input.exemptionId, revokedAt: null },
          data: { revokedAt: now, revokeMinuteId: minute.id },
        });
        if (locked.count === 0) {
          return { ok: false as const, error: ALREADY_REVOKED_MESSAGE };
        }

        // Las CUATRO acotaciones del borrado, y ninguna sobra:
        //   · `memberId`   — las exentas de otro socio no son asunto de esta acta;
        //   · `origin`     — una exenta que venga del import no la creó esta exención;
        //   · `status`     — si adentro del rango entró plata, la plata no se borra;
        //   · el período   — `gt` el corriente (decisión 9: el mes en curso queda
        //                    exento) Y dentro del rango de ESTA exención, que
        //                    puede no haber empezado todavía.
        const removed = await tx.fee.deleteMany({
          where: {
            memberId: exemption.memberId,
            origin: "exemption",
            status: "exempt",
            period: { gt: current, gte: exemption.fromPeriod, lte: exemption.toPeriod },
          },
        });

        await tx.movement.create({
          data: {
            memberId: exemption.memberId,
            type: "fee_exemption_revoked",
            date: minute.date,
            minuteId: minute.id,
            createdById: input.actorId,
            detail:
              `Exención anulada: ${periodLabel(exemption.fromPeriod)} a ${periodLabel(exemption.toPeriod)}; ` +
              `${plural(removed.count, "mes vuelve", "meses vuelven")} a devengar`,
          },
        });

        return { ok: true as const, removedFuture: removed.count };
      });
    },

    /** Las vigentes, en curso o por comenzar, ordenadas por mes de inicio. */
    listInForce(): Promise<ExemptionRecord[]> {
      return list(true);
    },

    /** El historial: vencidas y anuladas, con sus dos actas. */
    history(): Promise<ExemptionRecord[]> {
      return list(false);
    },
  };
}

export const exemptions = makeExemptions({ db: prisma });
