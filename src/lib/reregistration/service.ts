// El servicio que CONVOCA el re-empadronamiento del Art. 9° bis, abre la 2ª
// instancia y cuenta la cola (M6, fase 6B).
//
// Es la operación de mayor alcance del módulo: convocar le abre a cada
// adherente vigente —hoy 124— un plazo de treinta días del que cuelga su
// condición de socio, y dispara más de cien correos de una sola vez. Tres
// invariantes sostienen eso, y las tres están testeadas:
//
// 1. NINGUNA llamada de red adentro de la `$transaction`. El timeout de Prisma
//    es de 5 s y una llamada externa sostiene el lock hasta que vuelve; el
//    proyecto ya pagó esa lección dos veces (el PDF del recibo en la 4A, la
//    cancelación del débito de MP en la 4C — `members/withdraw-with-debits.ts`
//    existe justamente por eso). Los correos salen DESPUÉS del commit, y un
//    fallo de correo no deshace la convocatoria: el acto institucional ya está
//    asentado y no se cae porque Brevo esté caído.
// 2. La COHORTE SE CONGELA al convocar. Alcanzados = adherentes vigentes en el
//    momento de activar, y "vigente" incluye al suspendido: la suspensión es
//    disciplinaria y no exime del deber de re-empadronarse (Art. 7 inc. b.3).
//    Quien se vuelva adherente DESPUÉS no fue convocado. Por eso se escribe una
//    fila `pending` por convocado en ese acto: la cohorte es un hecho
//    registrado, no una consulta que se recalcula y cambia sola de resultado a
//    medida que el padrón se mueve.
// 3. Las filas de notificación POR CARTELERA no nacen acá. Al convocar se crea
//    el AVISO (el cartel que se va a imprimir y fijar en la sede) sin fecha de
//    fijación, porque nadie lo fijó todavía. La fila `Notification` con
//    `status: "posted_board"` se escribe recién cuando el operador asienta la
//    fijación (Task 13); hasta entonces el aviso lista a sus destinatarios
//    calculándolos en vivo. Crearlas acá obligaría a inventarles un estado
//    "pendiente de cartelera" que el enum no tiene, y sería registrar una
//    notificación que no ocurrió.
//
// El cliente de Prisma se INYECTA (el singleton se arma al final): así el
// servicio se prueba entero sin base.
import type {
  EmailStatus,
  PresentationStatus,
  PrismaClient,
  ReregistrationStatus,
} from "@/generated/prisma/client";
import { CONFIG_KEYS } from "@/lib/config-keys";
import { mailer } from "@/lib/email";
import { makeMailBudget, type MailBudget } from "@/lib/email/batch-cap";
import { reregistrationCallEmail, reregistrationSecondEmail } from "@/lib/email/templates";
import { ALLOWLIST_BLOCK_CODE } from "@/lib/email/transport";
import { prisma } from "@/lib/prisma";
import { civilDayOf } from "@/lib/treasury/periods";
import { canStartSecond, firstEndsAt, hasExpired, secondEndsAt } from "./rules";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Los estados en los que un proceso está VIVO y bloquea una convocatoria
 *  nueva. `closed` no está: ese es el proceso terminado, que la tabla conserva
 *  como prueba de cómo se llegó al libro nuevo.
 *
 *  Se enumera en vez de escribir `!== "closed"` por el mismo motivo que
 *  `isCohortMember` enumera los estados vigentes: un estado nuevo en el enum
 *  tiene que entrar acá a mano, y mientras tanto falla hacia el lado seguro
 *  —bloquear de más una convocatoria es un cartel; convocar dos veces son
 *  doscientos correos y dos cohortes pisadas—. */
export const LIVE_PROCESS_STATUSES = [
  "preparing",
  "first_instance",
  "second_instance",
  "closing",
] as const satisfies readonly ReregistrationStatus[];

/** Las seis claves del enum, para que los contadores nunca lleguen a la
 *  pantalla con un estado ausente en vez de un cero. */
const PRESENTATION_STATUSES = [
  "pending",
  "submitted",
  "observed",
  "validated",
  "rejected",
  "withdrawn",
] as const satisfies readonly PresentationStatus[];

/** El criterio de "casilla utilizable" del proyecto, escrito una sola vez.
 *  Es el MISMO de `treasury/reminder.ts:184` y `treasury/debtors.ts:110`: sin
 *  dirección o con rebote registrado no se manda nada, y esos son exactamente
 *  los que van a la cartelera. */
function emailUsable(m: { email: string | null; emailStatus: EmailStatus }): boolean {
  return Boolean(m.email) && m.emailStatus !== "bounced";
}

// Sólo el CÓDIGO del fallo, nunca la dirección: el error de nodemailer trae el
// `envelope` y el `response` del SMTP con el correo del vecino en claro, y este
// contador termina en el asiento de auditoría (docs/08, Ley 25.326).
function codeOf(e: unknown): string {
  const c = (e as { code?: unknown } | null)?.code;
  return typeof c === "string" && c !== "" ? c : "unknown";
}

/** Días civiles argentinos que faltan para `deadline`, contando el día del
 *  vencimiento como disponible: 0 es "vence hoy" y un negativo es "ya venció".
 *
 *  Se compara DÍA CIVIL contra DÍA CIVIL —igual que `hasExpired`, que es el
 *  único comparador de plazos del módulo— y no instante contra instante: a las
 *  09:00 de la mañana del último día el mediodía UTC ya quedó atrás, y una resta
 *  cruda le mostraría al operador un día menos del que el socio realmente tiene.
 *  Es un derivado de PANTALLA; quién decide si el plazo venció sigue siendo
 *  `hasExpired`. */
export function daysUntil(deadline: Date, now: Date): number {
  return Math.round((civilDayOf(deadline).getTime() - civilDayOf(now).getTime()) / DAY_MS);
}

type CohortRow = { id: number; fullName: string; email: string | null; emailStatus: EmailStatus };

/** Lo que el envío masivo deja como saldo. `emailed` es el único dato que la
 *  spec pide para el asiento de auditoría; los otros tres viajan igual porque
 *  cada uno significa un vecino que NO quedó notificado por correo, y este es
 *  el único lugar donde se sabe.
 *
 *  `deferred` es el más filoso de los cuatro: a diferencia del recordatorio de
 *  vencimiento —que vuelve a correr el mes siguiente—, la convocatoria ocurre
 *  UNA vez. Un correo diferido por el tope no lo levanta ninguna corrida
 *  posterior: es un socio al que le corre un plazo del que no se enteró. Por eso
 *  se devuelve y la pantalla tiene que mostrarlo, y por eso el presupuesto se
 *  puede inyectar (ver `Deps.mailBudget`). */
type MailOutcome = {
  emailed: number;
  /** Intentos que fallaron de verdad. El mailer ya dejó su fila `failed` con el
   *  código; acá queda el conteo. */
  failed: number;
  /** Frenados por `EMAIL_ALLOWLIST`. NO son fallos: es la guarda del entorno de
   *  prueba andando (4C §7.2). Devuelven el cupo. */
  blocked: number;
  /** Excedieron el tope de la corrida. Nadie los levanta después. */
  deferred: number;
};

export type ActivateInput = {
  bookId: number;
  calledAt: Date;
  minuteId: number;
  igjApprovedAt: Date | null;
  estimatedElectionAt: Date | null;
  actorId: number;
};

export type ActivateResult =
  | ({ ok: true; processId: number; cohortSize: number; boardCount: number } & MailOutcome)
  | { ok: false; error: string };

/** `actorId` viaja por simetría con `activate` y porque es parte del contrato
 *  acordado con la pantalla, pero el servicio no lo escribe en ningún lado: acá
 *  no hay fila de configuración que estampar. Quién abrió la instancia lo asienta
 *  la action, con `audit({ action: "reregistration_second" })`. */
export type StartSecondInput = { processId: number; actorId: number; force: boolean };

export type StartSecondResult =
  | ({
      ok: true;
      processId: number;
      secondEndsAt: Date;
      /** Cohortados sin presentación válida al abrir la 2ª instancia: los que
       *  están a un plazo de que la Comisión les declare la baja. */
      pending: number;
      boardCount: number;
    } & MailOutcome)
  | { ok: false; error: string };

export type ProcessCounters = {
  byStatus: Record<PresentationStatus, number>;
  cohortSize: number;
  /** Días que le quedan a la instancia abierta (0 = vence hoy). `null` cuando
   *  no hay ninguna corriendo: `preparing`, `closing` y `closed` no tienen
   *  cuenta regresiva. */
  daysLeft: number | null;
};

type Db = Pick<
  PrismaClient,
  "reregistrationProcess" | "presentation" | "member" | "boardNotice" | "configuration" | "$transaction"
>;

type Deps = {
  db: Db;
  mailer: Pick<typeof mailer, "sendToMember">;
  /** El presupuesto de correos se pide UNA VEZ POR CORRIDA y no es un contador
   *  de módulo: éste es un singleton de proceso, y un contador global lo dejaría
   *  mudo después de 50 correos hasta el próximo restart de PM2 (`batch-cap.ts`
   *  lo explica con el caso que lo motivó). Es inyectable para que el llamador
   *  pueda darle a la convocatoria un tope a la medida de la cohorte: el
   *  default de 50 alcanza para el padrón de hoy —37 emails cargados sobre 278
   *  socios— pero no es una garantía. */
  mailBudget?: () => MailBudget;
  /** `AUTH_URL` se hornea en el build; se inyecta para poder testear el enlace
   *  sin entorno. */
  baseUrl?: () => string;
  now?: () => Date;
};

export function makeReregistration(deps: Deps) {
  const now = deps.now ?? (() => new Date());
  const baseUrl = deps.baseUrl ?? (() => process.env.AUTH_URL ?? "http://localhost:3000");
  const budgetFor = deps.mailBudget ?? (() => makeMailBudget());

  /** El envío masivo, POST-COMMIT siempre. El mensaje es idéntico para todos
   *  —ninguna de las dos plantillas recibe el nombre del socio—, así que se
   *  renderiza una sola vez y no ciento y pico. */
  async function notify(input: {
    recipients: CohortRow[];
    type: "reregistration_first" | "reregistration_second";
    message: ReturnType<typeof reregistrationCallEmail>;
    summary: string;
    tag: string;
  }): Promise<MailOutcome> {
    const budget = budgetFor();
    const out: MailOutcome = { emailed: 0, failed: 0, blocked: 0, deferred: 0 };
    for (const m of input.recipients) {
      // `emailUsable` ya corrió del lado del llamador (los que no la pasan son
      // los de la cartelera); esto es el estrechamiento para TypeScript.
      if (!m.email) continue;
      if (!budget.take()) continue;
      try {
        await deps.mailer.sendToMember({
          memberId: m.id,
          to: m.email,
          type: input.type,
          message: input.message,
          summary: input.summary,
        });
        out.emailed++;
      } catch (e) {
        const code = codeOf(e);
        if (code === ALLOWLIST_BLOCK_CODE) {
          // El correo nunca tocó la red: el lugar vuelve al pote. Si no, en el
          // entorno de prueba los bloqueados agotarían el tope y diferirían
          // justo a los que sí están en la lista.
          budget.refund();
          out.blocked++;
          continue;
        }
        console.error(`[${input.tag}] no se pudo notificar al socio`, m.id, code);
        out.failed++;
      }
    }
    out.deferred = budget.deferred;
    if (out.deferred > 0) {
      // Un diferido acá no lo levanta ninguna corrida posterior: la convocatoria
      // ocurre una sola vez. Queda en el log además de en el resultado.
      console.warn(`[${input.tag}] ${out.deferred} socios quedaron sin aviso por el tope de correos`);
    }
    return out;
  }

  return {
    /** Convoca el proceso: lo asienta, congela la cohorte y deja el aviso de
     *  cartelera preparado. Los correos salen después del commit. */
    async activate(input: ActivateInput): Promise<ActivateResult> {
      const opened = await deps.db.$transaction(async (tx) => {
        // Guarda: un solo proceso vivo por vez. Va ADENTRO de la transacción
        // porque es la invariante del módulo entero —`reempadronamiento_proceso_id`
        // apunta a uno solo— y leerla afuera dejaría una ventana entre el
        // chequeo y la escritura.
        const live = await tx.reregistrationProcess.findFirst({
          where: { status: { in: [...LIVE_PROCESS_STATUSES] } },
          select: { id: true },
        });
        if (live) {
          return { ok: false as const, error: "Ya hay un proceso de re-empadronamiento en curso." };
        }

        const process = await tx.reregistrationProcess.create({
          data: {
            bookId: input.bookId,
            status: "first_instance",
            calledAt: input.calledAt,
            // El plazo sale de `rules.firstEndsAt`, que cuenta días corridos
            // sobre el día civil argentino del acta. Acá no se hace aritmética.
            firstEndsAt: firstEndsAt(input.calledAt),
            igjApprovedAt: input.igjApprovedAt,
            estimatedElectionAt: input.estimatedElectionAt,
            callMinuteId: input.minuteId,
          },
          select: { id: true },
        });

        // LA COHORTE. `orderBy: id` para que el orden de las filas y el de los
        // correos sea estable y reproducible (el número de socio manda en las
        // pantallas del módulo).
        const cohort = await tx.member.findMany({
          where: { category: "adherent", status: { in: ["active", "suspended"] } },
          select: { id: true, fullName: true, email: true, emailStatus: true },
          orderBy: { id: "asc" },
        });
        if (cohort.length > 0) {
          await tx.presentation.createMany({
            data: cohort.map((m) => ({ processId: process.id, memberId: m.id, status: "pending" as const })),
          });
        }

        const board = cohort.filter((m) => !emailUsable(m));
        // El aviso, SIN `postedAt`: nadie lo fijó todavía. Y sin filas
        // `Notification` — ver la invariante 3 de la cabecera.
        //
        // Es una escritura de base sin red, así que va ADENTRO de la
        // transacción y no después: si se creara post-commit y fallara, el
        // proceso quedaría convocado sin ningún camino para notificar a los
        // socios sin casilla, y no hay pantalla que cree un aviso de 1ª
        // instancia a mano. Sin destinatarios no se crea nada: un cartel de
        // cero socios es una tarjeta que el operador tiene que "fijar" para
        // nadie.
        if (board.length > 0) {
          await tx.boardNotice.create({ data: { processId: process.id, kind: "first_instance" } });
        }

        // Cuál es el proceso vivo es un dato de configuración. Se guarda como
        // STRING y no como número: `configReader.getString` —el lector que usa
        // el wizard público— devuelve null para cualquier otro tipo de Json, y
        // el mismo criterio ya rige para los ids de los planes de MP.
        await tx.configuration.upsert({
          where: { key: CONFIG_KEYS.reregistrationProcessId },
          update: { value: String(process.id), updatedBy: input.actorId },
          create: { key: CONFIG_KEYS.reregistrationProcessId, value: String(process.id), updatedBy: input.actorId },
        });

        return {
          ok: true as const,
          processId: process.id,
          // El plazo sale de la transacción en vez de recalcularse abajo: el
          // correo tiene que nombrar EXACTAMENTE la fecha que quedó asentada.
          firstEndsAt: firstEndsAt(input.calledAt),
          cohort,
          boardCount: board.length,
        };
      });

      if (!opened.ok) return opened;

      // ---- POST-COMMIT. De acá para abajo nada puede deshacer la convocatoria.
      const message = reregistrationCallEmail({
        url: `${baseUrl()}/reempadronate`,
        firstEndsAt: opened.firstEndsAt,
      });
      const mail = await notify({
        recipients: opened.cohort.filter(emailUsable),
        type: "reregistration_first",
        message,
        summary: "convocatoria al re-empadronamiento",
        tag: "reempadronamiento",
      });

      return {
        ok: true,
        processId: opened.processId,
        cohortSize: opened.cohort.length,
        boardCount: opened.boardCount,
        ...mail,
      };
    },

    /** Abre la 2ª instancia: diez días corridos más, con apercibimiento de
     *  baja. `force` es la escotilla de la Comisión —el Art. 9° bis no le
     *  impide abrirla antes—, pero exige tilde explícito en la pantalla. */
    async startSecond(input: StartSecondInput): Promise<StartSecondResult> {
      const at = now();
      const opened = await deps.db.$transaction(async (tx) => {
        const process = await tx.reregistrationProcess.findUnique({
          where: { id: input.processId },
          select: { id: true, status: true, firstEndsAt: true },
        });
        if (!process) return { ok: false as const, error: "El proceso no existe." };
        if (!canStartSecond(process)) {
          return { ok: false as const, error: "La segunda instancia se abre desde la primera y desde ningún otro estado." };
        }
        // `hasExpired` y no `at > firstEndsAt`: el día del vencimiento el socio
        // todavía tiene el día entero, y una comparación cruda contra el
        // mediodía UTC lo daría por vencido a las 09:00 de la mañana.
        if (!input.force && !hasExpired(process.firstEndsAt, at)) {
          return { ok: false as const, error: "La primera instancia todavía no venció." };
        }

        const ends = secondEndsAt(at);
        // Cerrojo optimista: el `status` viaja en el `where`, así que dos
        // clics simultáneos no abren la instancia dos veces ni pisan la fecha.
        const moved = await tx.reregistrationProcess.updateMany({
          where: { id: input.processId, status: "first_instance" },
          data: { status: "second_instance", secondEndsAt: ends },
        });
        if (moved.count === 0) {
          return { ok: false as const, error: "El proceso cambió de estado mientras se abría la segunda instancia." };
        }

        // Los que NO se presentaron válidamente. `observed` entra: la
        // presentación observada hay que subsanarla, y mientras no se subsane el
        // socio sigue expuesto a la baja. `rejected` también, por lo mismo.
        const rows = await tx.presentation.findMany({
          where: { processId: input.processId, status: { notIn: ["submitted", "validated"] } },
          select: {
            member: { select: { id: true, fullName: true, email: true, emailStatus: true } },
          },
          orderBy: { memberId: "asc" },
        });
        const missing = rows.map((r) => r.member);
        const board = missing.filter((m) => !emailUsable(m));
        // Mismo criterio que en la convocatoria: escritura sin red, adentro.
        if (board.length > 0) {
          await tx.boardNotice.create({ data: { processId: input.processId, kind: "second_instance" } });
        }
        return { ok: true as const, secondEndsAt: ends, missing, boardCount: board.length };
      });

      if (!opened.ok) return opened;

      // ---- POST-COMMIT.
      const message = reregistrationSecondEmail({
        url: `${baseUrl()}/reempadronate`,
        secondEndsAt: opened.secondEndsAt,
      });
      const mail = await notify({
        recipients: opened.missing.filter(emailUsable),
        type: "reregistration_second",
        message,
        summary: "segunda instancia del re-empadronamiento",
        tag: "reempadronamiento-2a",
      });

      return {
        ok: true,
        processId: input.processId,
        secondEndsAt: opened.secondEndsAt,
        pending: opened.missing.length,
        boardCount: opened.boardCount,
        ...mail,
      };
    },

    /** Contadores del tablero. Lectura pura: no escribe nada. */
    async counters(processId: number): Promise<ProcessCounters> {
      const [groups, process] = await Promise.all([
        deps.db.presentation.groupBy({
          by: ["status"],
          where: { processId },
          _count: { _all: true },
        }),
        deps.db.reregistrationProcess.findUnique({
          where: { id: processId },
          select: { status: true, firstEndsAt: true, secondEndsAt: true },
        }),
      ]);

      const byStatus = Object.fromEntries(PRESENTATION_STATUSES.map((s) => [s, 0])) as Record<
        PresentationStatus,
        number
      >;
      let cohortSize = 0;
      for (const g of groups) {
        byStatus[g.status] = g._count._all;
        cohortSize += g._count._all;
      }

      // Un proceso que no existe devuelve ceros en vez de reventar: esto lo
      // consume una pantalla, y un id viejo en la URL no tiene que tumbarla.
      const deadline =
        process?.status === "first_instance"
          ? process.firstEndsAt
          : process?.status === "second_instance"
            ? process.secondEndsAt
            : null;

      return { byStatus, cohortSize, daysLeft: deadline === null ? null : daysUntil(deadline, now()) };
    },
  };
}

export const reregistration = makeReregistration({ db: prisma, mailer });
