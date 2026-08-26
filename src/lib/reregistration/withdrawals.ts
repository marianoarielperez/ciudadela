// Las BAJAS por no haberse re-empadronado (M6 §9 etapas A y B) y el checklist
// que dice si se puede cerrar el libro.
//
// ── Qué se hace acá, dicho sin eufemismos ────────────────────────────────────
// Una persona real deja de ser socia de la Asociación Vecinal por resolución
// fundada de la Comisión Directiva (Art. 9° bis inc. c). Desde que esa
// resolución le queda notificada FEHACIENTEMENTE le corren treinta días
// corridos para recurrir ante la primera asamblea ordinaria (Art. 9° bis d).
// De dos fechas de este archivo dependen la validez de la baja y el derecho de
// defensa del vecino, así que ninguna de las dos se calcula acá: salen de
// `rules.appealUntil`, el único lugar del módulo que suma plazos.
//
// ── Las tres cosas que este módulo NO hace ───────────────────────────────────
// 1. NO da la baja por su cuenta: la escribe `withdrawWithDebits.withdraw`, el
//    mismo camino de la baja individual y del lote de cesantía por mora. Ese
//    camino ya resuelve `debtAtWithdrawal`, la revocación de enlaces vivos, el
//    apagado de la cuenta, el cierre de las solicitudes pendientes y la
//    cancelación del débito de Mercado Pago DESPUÉS del commit. Reimplementar
//    cualquiera de esas cinco cosas acá sería una segunda definición que puede
//    divergir.
// 2. NO declara ninguna cesantía por mora. El Art. 40 manda depurar también con
//    ese criterio, pero la cesantía es OTRA causal, con su propia acta: el
//    checklist muestra el número, advierte y enlaza a Deudores. Son actos
//    distintos porque el acta de cada persona tiene que decir por qué dejó de
//    ser socia.
// 3. NO clasifica las precondiciones del cierre: eso es `close.closeBlockers`,
//    que es puro y ya está testeado. Acá sólo se CUENTAN.
//
// El cliente de Prisma se INYECTA (el singleton se arma al final), como en
// `reregistration/service.ts` y `board/notice.ts`: así el módulo se prueba
// entero sin base.
import type {
  BoardNoticeKind,
  Prisma,
  MemberCategory,
  NotificationType,
  PresentationStatus,
  PrismaClient,
} from "@/generated/prisma/client";
import { audit as auditFn } from "@/lib/audit";
import { mailer } from "@/lib/email";
import { UNLIMITED_MAIL_BUDGET, type MailBudget } from "@/lib/email/batch-cap";
import { withdrawalDeclaredEmail } from "@/lib/email/templates";
import { ALLOWLIST_BLOCK_CODE } from "@/lib/email/transport";
import type { WithdrawInput, DebitCancellation } from "@/lib/members/withdraw-with-debits";
import { withdrawWithDebits } from "@/lib/members/withdraw-with-debits";
import { prisma } from "@/lib/prisma";
import type { ClosePrecondition, NoticeTrace } from "./close";
import { cohortNotTerminalWhere, unresolvedPresentationsWhere, WITHDRAWAL_BATCH_MAX } from "./close";
import { appealUntil, COHORT_CATEGORY, COHORT_STATUSES, emailUsable, hasExpired } from "./rules";

/** El tope del lote y el tipo del anexo viven en el módulo PURO `./close` y se
 *  re-exportan desde acá por comodidad del servidor. No pueden vivir en este
 *  archivo: la pantalla del lote es un componente de CLIENTE y este módulo
 *  arrastra Prisma y el mailer. El número con el que la pantalla corta la
 *  selección tiene que ser el mismo que el que esta acción revalida, así que
 *  tiene que poder importarse desde los dos lados. */
export { WITHDRAWAL_BATCH_MAX } from "./close";
export type { NoticeTrace } from "./close";

/** REG-15 (Art. 9 inc. c): cuatro cuotas atrasadas habilitan la cesantía por
 *  mora, y sólo sobre socios activos y colaboradores —el adherente aporta
 *  voluntariamente—.
 *
 *  ESPEJO deliberado de `ARREARS_THRESHOLD` / `ACCRUING_CATEGORIES`
 *  (`src/lib/treasury/rules.ts`): el criterio es ESTATUTARIO, no de tesorería, y
 *  el checklist del cierre no tiene por qué depender del módulo de la plata para
 *  decir cuántos vecinos están en condición de ser cesanteados. Lo que impide
 *  que las dos copias se separen en silencio es un test dedicado
 *  (`tests/reregistration-withdrawals.test.ts`) que las compara: si alguien
 *  cambia una, la otra se pone roja. */
export const ARREARS_THRESHOLD_MIRROR = 4;
export const ARREARS_CATEGORIES_MIRROR: readonly MemberCategory[] = ["active", "collaborator"];

/** El asiento de auditoría de la baja por no re-empadronarse. Vive acá y no como
 *  literal en la action por el mismo motivo que `CALL_AUDIT_ACTION`: se escribe
 *  en un lado y se lee en otro, y un string desincronizado hace desaparecer el
 *  dato de la pantalla sin que nada falle. */
export const WITHDRAWAL_AUDIT_ACTION = "reregistration_withdrawal";
export const WITHDRAWAL_AUDIT_ENTITY = "member";
/** El REINTENTO de la notificación de una baja ya declarada. Asiento propio y
 *  no el mismo de la baja: la baja se declara una sola vez y el reintento puede
 *  correr muchas, y el día que alguien tenga que probar cuándo quedó notificado
 *  un vecino —que es de lo que cuelga su ventana de recurso— tiene que poder
 *  separar los dos actos. */
export const WITHDRAWAL_RETRY_AUDIT_ACTION = "reregistration_withdrawal_retry";

/** Los estados de presentación que la etapa de bajas puede convertir en
 *  `withdrawn`.
 *
 *  Se ENUMERAN en vez de escribir "todo lo que no sea validated", por el mismo
 *  motivo que `COHORT_STATUSES`: un estado nuevo en el enum queda AFUERA hasta
 *  que alguien decida a mano que entra. Y las dos ausencias son deliberadas:
 *  `submitted` espera decisión de la Comisión —darle la baja sería resolverla
 *  por omisión— y `withdrawn` ya la tiene declarada. */
export const WITHDRAWABLE_STATUSES = [
  "pending",
  "observed",
  "rejected",
] as const satisfies readonly PresentationStatus[];

/** Los avisos del proceso que valen como notificación cursada para el anexo del
 *  acta (REG-23). Es lo que hace oponible la resolución: qué se le dijo al
 *  vecino, por qué vía y cuándo.
 *
 *  Entran los tres avisos del proceso —convocatoria, segunda instancia y la baja
 *  misma— y los dos que la Comisión le manda sobre SU presentación (la
 *  observación y el rechazo): los cinco son avisos de que su condición de socio
 *  estaba en juego. No entran los recibos ni los recordatorios de cuota, que no
 *  dicen nada de este proceso. */
const PROCESS_NOTICE_TYPES = [
  "reregistration_first",
  "reregistration_second",
  "withdrawal_declared",
  "presentation_observed",
  "presentation_rejected",
] as const satisfies readonly NotificationType[];

/** Un convocado al que le falta desenlace, con todo lo que el acta necesita
 *  decir de él. */
export type PendingWithdrawal = {
  presentationId: number;
  memberId: number;
  fullName: string;
  /** Número en el libro que se depura. `null` si no tiene membresía ahí. */
  memberNumber: number | null;
  status: PresentationStatus;
  /** Si tiene casilla utilizable la baja se le notifica por correo; si no, va al
   *  cartel de la sede. Se decide con `emailUsable`, la misma función que usa la
   *  cartelera para armar su nómina, así que nadie puede caer en las dos listas
   *  ni en ninguna. */
  byEmail: boolean;
  notices: NoticeTrace[];
};

/** Una baja YA declarada a la que todavía no se le notificó nada.
 *
 *  Es una lista distinta de `PendingWithdrawal` y no una variante suya: aquélla
 *  acota a adherentes VIGENTES —tiene que hacerlo, es a quién le falta
 *  desenlace— y esta persona ya dejó de serlo, así que sale de aquella consulta
 *  en cuanto la pantalla se recarga. Sin esta lista, quien queda de baja sin
 *  notificar no aparece en ningún lado. */
export type UnnotifiedWithdrawal = {
  presentationId: number;
  memberId: number;
  fullName: string;
  memberNumber: number | null;
  /** Tiene casilla utilizable: se le puede REINTENTAR el correo. Si no, su vía
   *  es el cartel de la sede y el reintento no le cambia nada. */
  byEmail: boolean;
};

/** El resultado del lote, con los tres baldes del molde REG-34 más uno.
 *
 *  Los baldes están separados porque significan cosas distintas para el
 *  operador, y meterlas juntas le haría repetir una acción que ya se hizo:
 *  `failures` es "esta persona sigue siendo socia"; `debitFailures` es "dejó de
 *  serlo pero se le sigue cobrando"; `unstamped` es "dejó de serlo pero el
 *  sistema no lo anotó en su presentación, así que no va a entrar al cartel de
 *  bajas". */
export type BatchOutcome = {
  /** Fallo que impidió tocar a nadie (el tope del lote). */
  error?: string;
  /** `presentationId` de cada baja declarada. */
  declared: number[];
  failures: Array<{ id: number; error: string }>;
  debitFailures: Array<{ id: number; count: number }>;
  unstamped: number[];
};

/** Qué pasó al intentar notificarle la baja a una persona.
 *
 *  `blocked` no es un fallo: es `EMAIL_ALLOWLIST` haciendo su trabajo en el
 *  entorno de prueba (4C §7.2). Se distingue de `failed` porque contarlo como
 *  fallo llenaría la pantalla de rojo por diseño. Y ninguno de los dos estampa
 *  la fecha fehaciente: no se notificó a nadie. */
export type NotifyOutcome = "email" | "board" | "skipped" | "deferred" | "blocked" | "failed";

/** El checklist de la etapa A: qué hay que mirar antes de cerrar. */
export type CloseChecklist = {
  /** Las CUATRO condiciones, siempre las cuatro, aunque estén en cero. Cuál de
   *  ellas frena lo decide `closeBlockers` (`./close`), que es puro. */
  preconditions: ClosePrecondition[];
  /** Los avisos de cartelera todavía en curso, para listarlos como contexto sin
   *  volver a consultarlos desde la pantalla. */
  openNotices: Array<{ id: number; kind: BoardNoticeKind; postedAt: Date | null; dueAt: Date | null }>;
};

type Db = Pick<
  PrismaClient,
  "reregistrationProcess" | "presentation" | "notification" | "boardNotice" | "fee"
>;

type Deps = {
  db: Db;
  /** El camino de baja existente. Se inyecta como interfaz mínima: el módulo no
   *  sabe —ni tiene que saber— que adentro hay una llamada a Mercado Pago. */
  withdrawer: { withdraw(input: WithdrawInput): Promise<{ debits: DebitCancellation }> };
  mailer: Pick<typeof mailer, "sendToMember">;
  /** El asiento por persona. Se inyecta porque la IP la sabe la action y porque
   *  así el test puede leer qué se asentó sin base. `audit()` traga sus propios
   *  errores: un asiento perdido no puede deshacer una baja ya escrita. */
  audit: typeof auditFn;
  now?: () => Date;
};

/** El `where` de "convocado al que todavía le falta desenlace", escrito UNA vez.
 *
 *  Lo comparten la lista de la pantalla y la revalidación del lote, y por eso no
 *  se escribe dos veces: si divergieran, la pantalla ofrecería tildar a alguien
 *  que la acción después rechaza, o —mucho peor— la acción daría de baja a
 *  alguien que la pantalla nunca mostró.
 *
 *  La cohorte se filtra con las constantes de `rules.ts`, las mismas de las que
 *  cuelga `isCohortMember`. Spec §3: un cohortado que dejó de ser adherente
 *  vigente por otro camino —una recategorización de la CD, una baja por otra
 *  causal— SALE del alcance de esta etapa. Su acta ya dice por qué dejó de ser
 *  socio, y declararle una segunda baja por un motivo distinto sería falso. */
function pendingWhere(processId: number): Prisma.PresentationWhereInput {
  return {
    processId,
    status: { in: [...WITHDRAWABLE_STATUSES] },
    member: { category: COHORT_CATEGORY, status: { in: [...COHORT_STATUSES] } },
  };
}

// Sólo el CÓDIGO del fallo, nunca la dirección: el error de nodemailer trae el
// `envelope` y el `response` del SMTP con el correo del vecino en claro
// (docs/08, Ley 25.326).
function codeOf(e: unknown): string {
  const c = (e as { code?: unknown } | null)?.code;
  return typeof c === "string" && c !== "" ? c : "unknown";
}

export function makeWithdrawals(deps: Deps) {
  const now = deps.now ?? (() => new Date());

  /** Las notificaciones cursadas EN ESTE PROCESO, agrupadas por socio.
   *
   *  `Notification` no tiene columna de proceso, así que el acotamiento son dos
   *  caminos: las de cartelera cuelgan del aviso, que sí lo tiene; las de correo
   *  se acotan por `createdAt` del proceso —el instante en que se escribió su
   *  fila, anterior a todo aviso suyo— y no por `calledAt`, que es la fecha
   *  CIVIL del acta y puede ser anterior. Es el mismo piso que usa el tablero, y
   *  existe por el mismo motivo: sin él, el proceso del Libro 2 leería los
   *  avisos que ese vecino recibió en el del Libro 1 y el anexo del acta
   *  afirmaría notificaciones que no son de esta baja. */
  async function noticesByMember(
    processId: number,
    processCreatedAt: Date,
    memberIds: number[],
  ): Promise<Map<number, NoticeTrace[]>> {
    const byMember = new Map<number, NoticeTrace[]>();
    if (memberIds.length === 0) return byMember;
    const rows = await deps.db.notification.findMany({
      where: {
        memberId: { in: memberIds },
        OR: [
          { boardNotice: { processId } },
          {
            via: "email",
            type: { in: [...PROCESS_NOTICE_TYPES] },
            sentAt: { gte: processCreatedAt },
          },
        ],
      },
      select: {
        memberId: true,
        type: true,
        via: true,
        status: true,
        sentAt: true,
        boardFrom: true,
        boardTo: true,
      },
      orderBy: { sentAt: "asc" },
    });
    for (const r of rows) {
      if (r.memberId === null) continue;
      const list = byMember.get(r.memberId) ?? [];
      list.push({
        type: r.type,
        via: r.via,
        status: r.status,
        // En una fila de cartelera `boardFrom` es la fijación; `sentAt` es
        // cuándo se escribió la fila, que es el mismo día. Se prefiere
        // `boardFrom` porque es la fecha que el operador asentó.
        at: r.boardFrom ?? r.sentAt,
        // La regla del módulo entero: correo → fehaciente al enviarse;
        // cartelera → al CUMPLIRSE los veinte días hábiles.
        effectiveAt: r.via === "board" ? r.boardTo : r.sentAt,
      });
      byMember.set(r.memberId, list);
    }
    return byMember;
  }

  return {
    /** Los convocados a los que hay que declararles la baja, con el anexo del
     *  acta ya armado. */
    async listPendingWithdrawals(processId: number): Promise<PendingWithdrawal[]> {
      const process = await deps.db.reregistrationProcess.findUnique({
        where: { id: processId },
        select: { bookId: true, createdAt: true },
      });
      // Un id viejo en una URL no tiene que tumbar una pantalla.
      if (!process) return [];

      const rows = await deps.db.presentation.findMany({
        where: pendingWhere(processId),
        select: {
          id: true,
          status: true,
          memberId: true,
          member: {
            select: {
              id: true,
              fullName: true,
              email: true,
              emailStatus: true,
              memberships: { where: { bookId: process.bookId }, select: { memberNumber: true } },
            },
          },
        },
        orderBy: { memberId: "asc" },
      });

      const notices = await noticesByMember(
        processId,
        process.createdAt,
        rows.map((r) => r.memberId),
      );

      return rows
        .map((r) => ({
          presentationId: r.id,
          memberId: r.memberId,
          fullName: r.member.fullName,
          memberNumber: r.member.memberships[0]?.memberNumber ?? null,
          status: r.status,
          byEmail: emailUsable(r.member),
          notices: notices.get(r.memberId) ?? [],
        }))
        // Por número de socio, que es como se busca a alguien en el padrón de
        // papel y como se va a leer el anexo del acta. Los sin número al final.
        .sort(
          (a, b) =>
            (a.memberNumber ?? Number.MAX_SAFE_INTEGER) - (b.memberNumber ?? Number.MAX_SAFE_INTEGER),
        );
    },

    /** Las bajas YA declaradas que siguen SIN notificar, con nombre.
     *
     *  Existe por un agujero concreto y medido: cuando el correo de baja no
     *  sale —falla el SMTP, o lo bloquea `EMAIL_ALLOWLIST`, que hoy sigue
     *  definida en producción— no se escribe ninguna fila de notificación, la
     *  persona ya no es socia vigente y por lo tanto desaparece de
     *  `listPendingWithdrawals`. El nombre de quien quedó de baja sin notificar
     *  no quedaba en ningún lado: ni en la base, ni en la pantalla, ni en el
     *  estado del formulario. Sin poder encontrarla, no hay reintento posible.
     *
     *  El acotamiento es `withdrawalNotifiedAt: null` y NO el estado del socio:
     *  esta persona ya está dada de baja: filtrar por vigentes la escondería,
     *  que es exactamente el defecto que esta lista arregla. Sale de la lista
     *  sola cuando se le estampa la fecha fehaciente, por cualquiera de las dos
     *  vías (el correo acá, la fijación del cartel en `boardNotices.post`). */
    async listUnnotifiedWithdrawals(processId: number): Promise<UnnotifiedWithdrawal[]> {
      const process = await deps.db.reregistrationProcess.findUnique({
        where: { id: processId },
        select: { bookId: true },
      });
      if (!process) return [];

      const rows = await deps.db.presentation.findMany({
        where: { processId, status: "withdrawn", withdrawalNotifiedAt: null },
        select: {
          id: true,
          memberId: true,
          member: {
            select: {
              id: true,
              fullName: true,
              email: true,
              emailStatus: true,
              memberships: { where: { bookId: process.bookId }, select: { memberNumber: true } },
            },
          },
        },
        orderBy: { memberId: "asc" },
      });

      return rows
        .map((r) => ({
          presentationId: r.id,
          memberId: r.memberId,
          fullName: r.member.fullName,
          memberNumber: r.member.memberships[0]?.memberNumber ?? null,
          // La misma función que decide la nómina del cartel, así que nadie
          // puede caer en las dos listas ni en ninguna.
          byEmail: emailUsable(r.member),
        }))
        .sort(
          (a, b) =>
            (a.memberNumber ?? Number.MAX_SAFE_INTEGER) - (b.memberNumber ?? Number.MAX_SAFE_INTEGER),
        );
    },

    /** Lo que la etapa A pone sobre la mesa: qué bloquea, qué advierte y qué es
     *  contexto. Sólo CUENTA; quién frena lo decide `closeBlockers`. */
    async closeChecklist(processId: number): Promise<CloseChecklist> {
      const at = now();
      const [unresolved, notTerminal, arrearsGroups, notices] = await Promise.all([
        // Los `where` de las dos condiciones BLOQUEANTES viven en `./close` y
        // los comparte la transacción de cierre, que re-valida adentro con los
        // datos que ella ve: si se escribieran acá de nuevo, este checklist
        // podría decir "se puede cerrar" sobre una condición que la transacción
        // no revisa. Incluir a los `submitted` en la segunda cuenta es a
        // propósito —tampoco tienen desenlace— aunque ya cuenten en la primera:
        // son dos cosas distintas y el operador tiene que ver las dos.
        deps.db.presentation.count({ where: unresolvedPresentationsWhere(processId) }),
        deps.db.presentation.count({ where: cohortNotTerminalWhere(processId) }),
        // Cesanteables por mora HOY. Cálculo en vivo y en una consulta agrupada
        // propia: el checklist ADVIERTE con el número y enlaza a Deudores, y no
        // automatiza ninguna cesantía jamás (decisión 1 del operador).
        deps.db.fee.groupBy({
          by: ["memberId"],
          where: {
            status: "pending",
            member: {
              category: { in: [...ARREARS_CATEGORIES_MIRROR] },
              status: { in: [...COHORT_STATUSES] },
            },
          },
          _count: { _all: true },
        }),
        deps.db.boardNotice.findMany({
          where: { processId },
          select: { id: true, kind: true, postedAt: true, dueAt: true },
          orderBy: { id: "asc" },
        }),
      ]);

      // El umbral se aplica en JS y no con un `having`: es la decisión
      // estatutaria del checklist, y acá se puede leer y testear.
      const arrears = arrearsGroups.filter((g) => g._count._all >= ARREARS_THRESHOLD_MIRROR).length;

      // "En curso" es el cartel que todavía no cumplió su plazo: el que no se
      // fijó (nadie lo colgó) y el fijado cuyo `dueAt` no venció. `hasExpired`
      // y no un `>` crudo: es el único comparador de plazos del módulo, y el día
      // del vencimiento el plazo todavía corre.
      const openNotices = notices.filter((n) => n.postedAt === null || n.dueAt === null || !hasExpired(n.dueAt, at));

      return {
        preconditions: [
          { kind: "unresolved_presentations", count: unresolved },
          { kind: "cohort_not_terminal", count: notTerminal },
          { kind: "arrears_candidates", count: arrears },
          { kind: "board_in_progress", count: openNotices.length },
        ],
        openNotices,
      };
    },

    /** Declara las bajas del lote. UNA POR SOCIO, EN SERIE y cada una con su
     *  propio desenlace.
     *
     *  El orden de adentro, que es lo que hay que leer antes de tocar nada:
     *
     *  1. Tope del lote. Corta ANTES de tocar a nadie (la action lo corta antes
     *     todavía: antes de crear el acta, para no dejar un asiento fantasma en
     *     un libro que se presenta ante la IGJ).
     *  2. Revalidación contra la base, socio por socio. La pantalla pudo quedar
     *     vieja —el vecino se presentó en el mostrador mientras el operador
     *     miraba la lista— y esto expulsa gente: lo que vale es la base, nunca
     *     el HTML. Un POST armado a mano tampoco puede saltearla.
     *  3. `withdrawWithDebits.withdraw`. Adentro: la transacción de la baja
     *     (status, `leftAt`, `debtAtWithdrawal`, enlaces revocados, cuenta
     *     apagada, solicitudes cerradas, movimiento) y DESPUÉS de su commit la
     *     cancelación del débito en Mercado Pago. Ninguna llamada de red vive
     *     dentro de una transacción.
     *  4. La presentación pasa a `withdrawn`, y sólo si la baja salió.
     *  5. El asiento de auditoría, con ids y banderas.
     *
     *  Si el paso 3 falla, el 4 y el 5 no ocurren y el vecino sigue siendo socio.
     *  Si falla el 4, la baja YA está asentada: eso no es un fallo de la baja y
     *  no puede decirse como si lo fuera (balde `unstamped`). */
    async declareBatch(input: {
      processId: number;
      presentationIds: number[];
      minuteId: number;
      actorId: number;
      ip?: string;
    }): Promise<BatchOutcome> {
      const out: BatchOutcome = { declared: [], failures: [], debitFailures: [], unstamped: [] };
      const ids = [...new Set(input.presentationIds)].sort((a, b) => a - b);
      if (ids.length === 0) return { ...out, error: "No seleccionaste a ningún convocado." };
      if (ids.length > WITHDRAWAL_BATCH_MAX) {
        return {
          ...out,
          error:
            `Seleccionaste ${ids.length} convocados y el lote acepta hasta ${WITHDRAWAL_BATCH_MAX} por vez. ` +
            "Declaralos en tandas: cada baja cancela además el débito automático en Mercado Pago y eso lleva su tiempo.",
        };
      }

      // Se cargan TODAS las pedidas, sin el filtro de elegibilidad, para poder
      // decir POR QUÉ quedó afuera cada una. "No cumple" a secas dejaría al
      // operador sin saber si el vecino se presentó a último momento o si la
      // pantalla mintió — la misma razón por la que el lote de mora dice cuántas
      // cuotas debe de verdad.
      const rows = await deps.db.presentation.findMany({
        where: { id: { in: ids }, processId: input.processId },
        select: {
          id: true,
          status: true,
          memberId: true,
          member: { select: { category: true, status: true } },
        },
      });
      const byId = new Map(rows.map((r) => [r.id, r]));

      for (const id of ids) {
        const row = byId.get(id);
        if (!row) {
          out.failures.push({ id, error: "La presentación no pertenece a este proceso." });
          continue;
        }
        if (row.status === "validated") {
          out.failures.push({
            id,
            error: "La presentación quedó validada: el socio se re-empadronó y no corresponde darlo de baja.",
          });
          continue;
        }
        if (row.status === "submitted") {
          out.failures.push({
            id,
            error: "La presentación espera decisión de la Comisión: resolvela antes de declarar la baja.",
          });
          continue;
        }
        if (row.status === "withdrawn") {
          out.failures.push({ id, error: "La baja de este convocado ya está declarada." });
          continue;
        }
        if (
          row.member.category !== COHORT_CATEGORY ||
          !(COHORT_STATUSES as readonly string[]).includes(row.member.status)
        ) {
          out.failures.push({
            id,
            error:
              "Ya no es adherente vigente: la baja por no haberse re-empadronado no lo alcanza (su desenlace lo decidió otra acta).",
          });
          continue;
        }

        let debits: DebitCancellation;
        try {
          ({ debits } = await deps.withdrawer.withdraw({
            memberId: row.memberId,
            reason: "not_reregistered",
            minuteId: input.minuteId,
            actorId: input.actorId,
            detail: "Baja por no haberse re-empadronado (Art. 9° bis inc. c del estatuto).",
          }));
        } catch (e) {
          out.failures.push({
            id,
            error: e instanceof Error ? e.message : "No se pudo declarar la baja.",
          });
          continue;
        }

        out.declared.push(id);
        if (debits.failed.length > 0) out.debitFailures.push({ id, count: debits.failed.length });

        // El estado viaja en el `where`: si otra pestaña ya la marcó, esto no
        // pisa nada. `updateMany` y no `update` justamente por eso.
        try {
          await deps.db.presentation.updateMany({
            where: { id, status: { in: [...WITHDRAWABLE_STATUSES] } },
            data: { status: "withdrawn" },
          });
        } catch (e) {
          console.error("[bajas] la baja salió pero la presentación no se marcó", id, e);
          out.unstamped.push(id);
        }

        // Ids, códigos y banderas. Ningún nombre ni DNI (Ley 25.326); el
        // `preapprovalId` sí va entero porque es lo único que permite reintentar
        // la cancelación a mano. `audit()` traga sus errores: un asiento perdido
        // no puede deshacer una baja ya escrita.
        await deps.audit({
          userId: input.actorId,
          action: WITHDRAWAL_AUDIT_ACTION,
          entity: WITHDRAWAL_AUDIT_ENTITY,
          entityId: row.memberId,
          detail: {
            processId: input.processId,
            presentationId: id,
            previousStatus: row.status,
            minuteId: input.minuteId,
            debitsCancelled: debits.cancelled,
            debitsFailed: debits.failed,
          },
          ip: input.ip,
        });
      }

      return out;
    },

    /** Le notifica la baja a UNA persona, y con eso arranca —o no— su ventana de
     *  recurso.
     *
     *  Por correo la notificación es fehaciente AL ENVIARSE (Art. 5° ter), así
     *  que acá se estampan las dos fechas. Sin casilla utilizable no se estampa
     *  nada: esa persona va al cartel de la sede, y ahí la notificación queda
     *  fehaciente recién al CUMPLIRSE los veinte días hábiles — la estampa la
     *  pone `boardNotices.post` al asentar la fijación, sobre todo el lote.
     *
     *  Un correo que no salió tampoco estampa nada, y es la diferencia que más
     *  importa de este archivo: una fecha fehaciente sobre un aviso que nunca
     *  llegó le arrancaría al vecino un plazo de defensa del que no se enteró. */
    async notifyWithdrawal(input: {
      presentationId: number;
      budget?: MailBudget;
    }): Promise<NotifyOutcome> {
      const budget = input.budget ?? UNLIMITED_MAIL_BUDGET;
      const row = await deps.db.presentation.findUnique({
        where: { id: input.presentationId },
        select: {
          id: true,
          status: true,
          withdrawalNotifiedAt: true,
          // El proceso viaja para acotar las notificaciones que el correo va a
          // AFIRMAR: sin el piso de `createdAt` se leerían los avisos que ese
          // vecino recibió en el libro anterior (mismo acotamiento que el anexo
          // del acta, y por eso se comparte `noticesByMember` en vez de
          // reescribir el `where`).
          processId: true,
          process: { select: { createdAt: true } },
          member: { select: { id: true, email: true, emailStatus: true } },
        },
      });
      if (!row || row.status !== "withdrawn") return "skipped";
      // Ya tiene su fecha fehaciente corriendo: volver a mandarle el correo le
      // reiniciaría la ventana de recurso, que es suya y ya arrancó.
      if (row.withdrawalNotifiedAt !== null) return "skipped";
      if (!emailUsable(row.member) || !row.member.email) return "board";
      if (!budget.take()) return "deferred";

      const at = now();
      // La fecha se calcula ANTES de mandar porque el correo la NOMBRA: el
      // vecino tiene que leer exactamente el día que queda registrado.
      const until = appealUntil(at);

      // QUÉ SE LE CURSÓ DE VERDAD. El correo de baja abre diciendo qué avisos
      // recibió antes, y la pantalla NO impide declararle la baja a quien no
      // tiene ninguno —esa decisión es de la Comisión, no del software—, así
      // que el texto no puede darlos por hechos: el documento con el que se
      // sostiene la baja abriría con una afirmación falsa y verificable contra
      // la propia base. Se lee con la MISMA función que arma el anexo del acta
      // y con el mismo criterio de `status`: una fila `failed` registra un
      // intento, no un aviso recibido.
      const traces = (await noticesByMember(row.processId, row.process.createdAt, [row.member.id]))
        .get(row.member.id) ?? [];
      const served = traces.filter((t) => t.status !== "failed");
      const notified = {
        first: served.some((t) => t.type === "reregistration_first"),
        second: served.some((t) => t.type === "reregistration_second"),
      };

      try {
        await deps.mailer.sendToMember({
          memberId: row.member.id,
          to: row.member.email,
          type: "withdrawal_declared",
          message: withdrawalDeclaredEmail({ appealUntil: until, notified }),
          summary: "baja declarada por no re-empadronarse",
        });
      } catch (e) {
        const code = codeOf(e);
        if (code === ALLOWLIST_BLOCK_CODE) {
          // El correo nunca tocó la red: el lugar vuelve al pote. No es un fallo
          // —es la guarda del entorno de prueba andando— y no notifica a nadie.
          budget.refund();
          return "blocked";
        }
        console.error("[bajas] no se pudo notificar la baja al socio", row.member.id, code);
        return "failed";
      }

      // `withdrawalNotifiedAt: null` en el `where`: dos corridas simultáneas no
      // pueden correrle la ventana de recurso a nadie.
      await deps.db.presentation.updateMany({
        where: { id: row.id, withdrawalNotifiedAt: null },
        data: { withdrawalNotifiedAt: at, appealUntil: until },
      });
      return "email";
    },
  };
}

/** ¿La ventana de recurso del Art. 9° bis d) SIGUE ABIERTA?
 *
 *  Una sola definición para las dos pantallas que la muestran —la ficha del
 *  socio y el Histórico— porque el criterio no es obvio: el último día del plazo
 *  el vecino lo tiene ENTERO, así que ese día la ventana sigue abierta. Quien lo
 *  decide es `hasExpired`, el único comparador de plazos del módulo; acá no se
 *  vuelve a escribir la comparación. */
export function appealWindowOpen(until: Date | null, at: Date = new Date()): boolean {
  return until !== null && !hasExpired(until, at);
}

export const withdrawals = makeWithdrawals({
  db: prisma,
  withdrawer: withdrawWithDebits,
  mailer,
  audit: auditFn,
});
