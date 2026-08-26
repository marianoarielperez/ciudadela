// El AVISO DE CARTELERA como LOTE (M6 §8, decisión 6 del operador).
//
// ── Por qué la unidad de trabajo es el aviso y no el socio ───────────────────
// De los 124 adherentes convocados, 100 no tienen casilla de correo. Para ellos
// el Art. 5° ter prevé exactamente esto: si el mensaje no se puede entregar, la
// notificación se practica publicando el aviso en la cartelera de la sede
// social por veinte días hábiles, "con idéntico efecto". O sea que el papel
// pegado en la pared ES la notificación fehaciente, y de la fecha en que ese
// plazo se cumple dependen la validez de la baja del vecino y su ventana de
// recurso (Art. 9° bis d).
//
// Cargar cien socios de a uno en el mostrador de una vecinal es inviable, así
// que el sistema arma solo la lista, se imprime UN cartel y el operador asienta
// UNA sola fecha de fijación que estampa las cien filas de golpe. Las filas
// individuales existen como trazabilidad REG-09; nadie las opera de a una.
//
// ── La nómina es VIVA hasta que se asienta la fijación ───────────────────────
// Antes del asentado el aviso no tiene filas: lista a sus destinatarios
// calculándolos contra el padrón (`listRecipients`). Al asentar la fijación se
// CONGELA en filas `Notification`. Corolario operativo, y por eso la pantalla
// lo dice con todas las letras: la fijación se asienta el mismo día que se
// cuelga el cartel. Si se asienta tres días después, a los vecinos a los que
// mientras tanto les cargaron el correo el sistema los deja fuera del lote
// aunque su nombre esté impreso en la pared.
//
// ── Qué NO vive acá ──────────────────────────────────────────────────────────
// La aritmética de días hábiles vive en `./business-days` (Task 7) y no se
// reimplementa: acá sólo se la llama y se traducen sus dos excepciones a un
// mensaje para el operador. Ver `post`.
//
// El cliente de Prisma se INYECTA (el singleton se arma al final), como en
// `reregistration/service.ts`: así el módulo se prueba entero sin base.
import type {
  BoardNoticeKind,
  NotificationType,
  PresentationStatus,
  PrismaClient,
} from "@/generated/prisma/client";
import { createKeyedMutex } from "@/lib/keyed-mutex";
import { BOARD_NOTICE_KIND_LABELS } from "@/lib/members/labels";
import { prisma } from "@/lib/prisma";
import { emailUsable } from "@/lib/reregistration/rules";
import { civilDayOf } from "@/lib/treasury/periods";
import {
  BOARD_BUSINESS_DAYS,
  businessDayEnd,
  HolidayCoverageError,
  HolidayFormatError,
  holidayCoverageYears,
} from "./business-days";

/** Los tres avisos que tienen texto propio. `other` no es uno de ellos: es el
 *  MISMO aviso de la instancia en curso para un vecino que se quedó afuera del
 *  lote (ver `effectiveKind`). */
export type NoticeSubject = Exclude<BoardNoticeKind, "other">;

/** Qué tipo de notificación acredita cada aviso. Los tres existen en el enum
 *  desde el Módulo 0. */
export const NOTICE_TYPE_BY_KIND: Record<NoticeSubject, NotificationType> = {
  first_instance: "reregistration_first",
  second_instance: "reregistration_second",
  withdrawal: "withdrawal_declared",
};

/** El aviso `other` —el rebote que llega DESPUÉS del envío masivo— no dice nada
 *  nuevo: repite, para un vecino solo, el aviso que el resto de su instancia ya
 *  tiene en la pared. Cuál instancia es lo decide `secondEndsAt`, que es lo
 *  único que marca que la segunda se abrió; es el mismo criterio del tablero y
 *  de la cola, escrito una vez.
 *
 *  Se resuelve acá y no en la pantalla porque de esta decisión salen DOS cosas
 *  que no pueden divergir: el texto que se imprime en el cartel y el
 *  `NotificationType` que queda asentado como acreditación. Si el papel dijera
 *  "segunda instancia" y la fila dijera `reregistration_first`, la prueba del
 *  Art. 5° quater contradiría al documento. */
export function effectiveKind(
  kind: BoardNoticeKind,
  process: { secondEndsAt: Date | null },
): NoticeSubject {
  if (kind !== "other") return kind;
  return process.secondEndsAt === null ? "first_instance" : "second_instance";
}

/** A quiénes de la cohorte alcanza cada aviso, por el estado de su
 *  presentación.
 *
 *  Se ENUMERAN los estados en vez de escribir un `notIn`, por el mismo motivo
 *  que `COHORT_STATUSES`: un estado nuevo en el enum tiene que entrar acá a
 *  mano. Alcanzar de más con un cartel es papel; alcanzar de menos es un vecino
 *  al que se le declara la baja sin haberlo notificado nunca. */
const AUDIENCE: Record<BoardNoticeKind, readonly PresentationStatus[]> = {
  // La convocatoria alcanza a TODA la cohorte: al fijarse, nadie se presentó
  // todavía, y los estados que aparecen después sólo pueden restar gente de la
  // lista viva, nunca sumar.
  first_instance: ["pending", "submitted", "observed", "validated", "rejected", "withdrawn"],
  // La 2ª instancia, a quien no tiene presentación aprobada. Es el MISMO
  // conjunto que `startSecond` usa para elegir a quién escribirle
  // (`notIn: ["submitted", "validated"]`), enumerado.
  second_instance: ["pending", "observed", "rejected", "withdrawn"],
  // El aviso de bajas alcanza a los que efectivamente quedaron de baja.
  withdrawal: ["withdrawn"],
  // El rebote posterior: sólo tiene sentido para quien todavía está a tiempo de
  // hacer algo. Al validado no hay nada que avisarle y el dado de baja tiene su
  // propio aviso.
  other: ["pending", "observed", "rejected"],
};

export type BoardRecipient = {
  memberId: number;
  /** Número en el libro que se depura. `null` si no tiene membresía en ese
   *  libro; se imprime "—" en vez de romper el cartel. */
  memberNumber: number | null;
  fullName: string;
};

export type ListRecipientsInput = { processId: number; kind: BoardNoticeKind };

export type PostInput = {
  noticeId: number;
  /** Día en que el cartel se colgó en la pared. Se guarda como fecha civil. */
  postedAt: Date;
  /** El calendario, INYECTADO: el módulo no consulta `holidays` por su cuenta
   *  para que se pueda testear sin base y para que la pantalla pueda avisar de
   *  un año sin cobertura ANTES de que el operador apriete el botón
   *  (`coverageNotice`). */
  holidays: Date[];
};

export type PostResult =
  | { ok: true; dueAt: Date; stamped: number }
  | { ok: false; error: string };

type Db = Pick<
  PrismaClient,
  "reregistrationProcess" | "presentation" | "boardNotice" | "notification" | "$transaction"
>;
/** El mismo conjunto de modelos, pero dentro de una transacción interactiva. */
type Tx = Omit<Db, "$transaction">;

type Deps = { db: Db };

/** Serializa la apertura del aviso `other` por proceso: dos clics simultáneos
 *  en la cola de "Sin presentar" abrirían dos carteles vacíos. Premisa de un
 *  solo proceso (docs/03), como el resto de los mutex del proyecto. */
const mutex = createKeyedMutex();

/** Orden del cartel: por número de socio, que es como se busca a alguien en el
 *  padrón de papel. Los sin número al final, no al principio. */
function byMemberNumber(a: BoardRecipient, b: BoardRecipient): number {
  return (a.memberNumber ?? Number.MAX_SAFE_INTEGER) - (b.memberNumber ?? Number.MAX_SAFE_INTEGER);
}

/** La nómina VIVA de un aviso. Toma el handle de base como argumento (y no de
 *  las deps) para poder correr también dentro de la transacción de `post`: ahí
 *  la lista y las filas que la congelan tienen que salir de la misma foto. */
async function listRecipientsWith(db: Tx, input: ListRecipientsInput): Promise<BoardRecipient[]> {
  const process = await db.reregistrationProcess.findUnique({
    where: { id: input.processId },
    select: { bookId: true },
  });
  // Un id viejo en una URL no tiene que tumbar una pantalla.
  if (!process) return [];

  const rows = await db.presentation.findMany({
    where: { processId: input.processId, status: { in: [...AUDIENCE[input.kind]] } },
    select: {
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

  // Quién ya quedó acreditado por cartelera EN ESTE PROCESO. Para los tres
  // avisos propios se mira sólo el mismo `kind`: la 2ª instancia dice algo
  // distinto que la convocatoria (apercibimiento de baja), así que al mismo
  // vecino hay que volver a fijarlo. Para `other` se mira CUALQUIER aviso: su
  // razón de ser es cubrir al que se quedó afuera del lote, y quien ya está en
  // la pared no está afuera de nada.
  const covered = await db.notification.findMany({
    where: {
      via: "board",
      boardNotice: {
        processId: input.processId,
        ...(input.kind === "other" ? {} : { kind: input.kind }),
      },
    },
    select: { memberId: true },
  });
  const already = new Set(covered.map((c) => c.memberId));

  return rows
    .map((r) => r.member)
    .filter((m) => !emailUsable(m) && !already.has(m.id))
    .map((m) => ({
      memberId: m.id,
      memberNumber: m.memberships[0]?.memberNumber ?? null,
      fullName: m.fullName,
    }))
    .sort(byMemberNumber);
}

/** Lo que la pantalla necesita para dibujar la tarjeta de un aviso y para
 *  imprimirlo. */
export type BoardNoticeDoc = {
  id: number;
  kind: BoardNoticeKind;
  /** El aviso del que efectivamente se trata (ver `effectiveKind`). */
  subject: NoticeSubject;
  postedAt: Date | null;
  dueAt: Date | null;
  process: {
    id: number;
    bookNumber: number;
    calledAt: Date;
    firstEndsAt: Date;
    secondEndsAt: Date | null;
  };
  /** La nómina: CONGELADA si el aviso ya se fijó, viva si todavía no. */
  recipients: BoardRecipient[];
  frozen: boolean;
};

export function makeBoardNotices(deps: Deps) {
  return {
    /** Destinatarios de un aviso: cohortados alcanzados por `kind` sin casilla
     *  utilizable al momento de armarlo. */
    listRecipients(input: ListRecipientsInput): Promise<BoardRecipient[]> {
      return listRecipientsWith(deps.db, input);
    },

    /** El aviso entero, para la tarjeta y para el PDF. `null` si no existe. */
    async load(noticeId: number): Promise<BoardNoticeDoc | null> {
      const notice = await deps.db.boardNotice.findUnique({
        where: { id: noticeId },
        select: {
          id: true,
          kind: true,
          postedAt: true,
          dueAt: true,
          process: {
            select: {
              id: true,
              calledAt: true,
              firstEndsAt: true,
              secondEndsAt: true,
              bookId: true,
              book: { select: { number: true } },
            },
          },
        },
      });
      if (!notice) return null;

      // Fijado: la nómina que vale es la que quedó asentada, y no la de hoy.
      // Es lo que está impreso en la pared y lo que acredita el Art. 5° quater.
      const recipients = notice.postedAt
        ? (
            await deps.db.notification.findMany({
              where: { boardNoticeId: notice.id },
              select: {
                memberId: true,
                member: {
                  select: {
                    fullName: true,
                    memberships: {
                      where: { bookId: notice.process.bookId },
                      select: { memberNumber: true },
                    },
                  },
                },
              },
            })
          )
            .flatMap((n) =>
              n.memberId === null || n.member === null
                ? []
                : [{
                    memberId: n.memberId,
                    memberNumber: n.member.memberships[0]?.memberNumber ?? null,
                    fullName: n.member.fullName,
                  }],
            )
            .sort(byMemberNumber)
        : await listRecipientsWith(deps.db, { processId: notice.process.id, kind: notice.kind });

      return {
        id: notice.id,
        kind: notice.kind,
        subject: effectiveKind(notice.kind, notice.process),
        postedAt: notice.postedAt,
        dueAt: notice.dueAt,
        process: {
          id: notice.process.id,
          bookNumber: notice.process.book.number,
          calledAt: notice.process.calledAt,
          firstEndsAt: notice.process.firstEndsAt,
          secondEndsAt: notice.process.secondEndsAt,
        },
        recipients,
        frozen: notice.postedAt !== null,
      };
    },

    /** Asienta la fijación: estampa `postedAt`/`dueAt` en el aviso y congela la
     *  nómina en una fila `Notification` por destinatario.
     *
     *  El `dueAt` se calcula ANTES de abrir la transacción, y a propósito:
     *  `businessDayEnd` falla ruidoso en dos casos —un año que el calendario
     *  inyectado no cubre, y una fecha de feriado fuera del formato canónico—,
     *  y los dos son problemas del OPERADOR, no averías del servidor. Traducirlos
     *  a un mensaje que dice qué pasa y cómo arreglarlo es el punto entero de que
     *  esa función falle en vez de devolver un número: si acá se dejara propagar,
     *  el operador vería una pantalla rota y el vecino se quedaría sin cartel.
     *  Calcularlo afuera además garantiza que un aviso no quede estampado a
     *  medias: cuando el cómputo no se puede hacer, no se abre transacción. */
    async post(input: PostInput): Promise<PostResult> {
      let dueAt: Date;
      try {
        dueAt = businessDayEnd(input.postedAt, BOARD_BUSINESS_DAYS, input.holidays);
      } catch (e) {
        if (e instanceof HolidayCoverageError || e instanceof HolidayFormatError) {
          return { ok: false, error: e.message };
        }
        throw e;
      }
      // El día civil argentino de la fijación. El operador tipea una fecha, no
      // un instante, y de esta columna cuelga el plazo.
      const day = civilDayOf(input.postedAt);

      return deps.db.$transaction(async (tx) => {
        const notice = await tx.boardNotice.findUnique({
          where: { id: input.noticeId },
          select: { id: true, processId: true, kind: true },
        });
        if (!notice) return { ok: false, error: "El aviso de cartelera no existe." };

        // CERROJO OPTIMISTA: `postedAt: null` viaja en el `where`. Dos clics
        // simultáneos —o un reenvío del formulario— no pueden correr el plazo
        // de cien vecinos ni duplicarles la fila de acreditación. Nada se
        // escribió todavía cuando se devuelve el rechazo, así que la
        // transacción commitea vacía.
        const stamped = await tx.boardNotice.updateMany({
          where: { id: input.noticeId, postedAt: null },
          data: { postedAt: day, dueAt },
        });
        if (stamped.count === 0) {
          return {
            ok: false,
            error:
              "Este aviso ya tiene su fijación asentada: la fecha se registra una sola vez, " +
              "porque de ella cuelga el plazo de todos sus destinatarios.",
          };
        }

        const process = await tx.reregistrationProcess.findUnique({
          where: { id: notice.processId },
          select: { secondEndsAt: true },
        });
        const subject = effectiveKind(notice.kind, process ?? { secondEndsAt: null });
        const recipients = await listRecipientsWith(tx, {
          processId: notice.processId,
          kind: notice.kind,
        });

        if (recipients.length > 0) {
          await tx.notification.createMany({
            data: recipients.map((r) => ({
              memberId: r.memberId,
              boardNoticeId: notice.id,
              type: NOTICE_TYPE_BY_KIND[subject],
              via: "board" as const,
              status: "posted_board" as const,
              boardFrom: day,
              boardTo: dueAt,
              // Sin datos personales: el resumen dice de qué cartel se trata.
              payloadSummary: `cartelera — ${BOARD_NOTICE_KIND_LABELS[notice.kind]}`,
            })),
          });
        }

        return { ok: true, dueAt, stamped: recipients.length };
      });
    },

    /** El caso borde individual: un correo que rebota DESPUÉS del envío masivo.
     *  Ese vecino no entró en ningún cartel —cuando se armó el lote tenía
     *  casilla— así que hay que sumarlo a uno.
     *
     *  Se suma a un aviso `other` ABIERTO del proceso, y si no hay se crea. La
     *  acción no marca al socio en ningún lado: el aviso lo lista solo, porque
     *  su nómina es viva hasta que se fija (ver la cabecera). Lo que sí hace es
     *  VERIFICAR que el socio sea efectivamente destinatario, para que un botón
     *  perdido no abra un cartel que no corresponde. */
    async openOther(input: { processId: number; memberId: number }): Promise<
      { ok: true; noticeId: number } | { ok: false; error: string }
    > {
      return mutex.run(`board-other:${input.processId}`, async () => {
        const recipients = await listRecipientsWith(deps.db, {
          processId: input.processId,
          kind: "other",
        });
        if (!recipients.some((r) => r.memberId === input.memberId)) {
          return {
            ok: false as const,
            error:
              "Ese convocado no necesita el cartel de la sede: o su casilla volvió a ser utilizable, " +
              "o ya quedó cubierto por un aviso de este proceso.",
          };
        }

        const open = await deps.db.boardNotice.findFirst({
          where: { processId: input.processId, kind: "other", postedAt: null },
          orderBy: { id: "asc" },
          select: { id: true },
        });
        if (open) return { ok: true as const, noticeId: open.id };

        const created = await deps.db.boardNotice.create({
          data: { processId: input.processId, kind: "other" },
          select: { id: true },
        });
        return { ok: true as const, noticeId: created.id };
      });
    },
  };
}

/** Cuántos días CORRIDOS puede llegar a abarcar el plazo de la cartelera, para
 *  saber qué años del calendario hay que tener cargados antes de asentar.
 *
 *  20 días hábiles son 4 semanas de lunes a viernes = 28 días corridos, más un
 *  día por cada feriado del tramo. Con 60 el margen cubre holgadamente el año
 *  más feriado imaginable, y errar para arriba sólo hace que el aviso pida un
 *  año más de calendario: el costo es cargar feriados de más, y el de errar
 *  para abajo es que el operador se entere del faltante recién al apretar el
 *  botón. */
const COVERAGE_HORIZON_DAYS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

/** El aviso PREVENTIVO de la pantalla: `null` si el calendario alcanza para
 *  asentar una fijación hecha hoy, o el mensaje que hay que mostrarle al
 *  operador si no.
 *
 *  Existe porque las dos excepciones de `businessDayEnd` son arreglables por el
 *  operador, y enterarse ANTES de imprimir cien nombres no es lo mismo que
 *  enterarse al apretar el botón. `post` las sigue atendiendo igual: esto es un
 *  aviso, no una guarda.
 *
 *  Puro y exportado: se testea sin base y sin pantalla. */
export function coverageNotice(holidays: readonly Date[], from: Date = new Date()): string | null {
  let covered: Set<number>;
  try {
    covered = holidayCoverageYears(holidays);
  } catch (e) {
    // Una fila fuera del formato canónico no es un detalle de estilo: contada
    // así caería el día equivocado y engañaría a la propia guarda de cobertura.
    if (e instanceof HolidayFormatError) return e.message;
    throw e;
  }

  const start = civilDayOf(from);
  const end = new Date(start.getTime() + COVERAGE_HORIZON_DAYS * DAY_MS);
  const missing: number[] = [];
  for (let year = start.getUTCFullYear(); year <= end.getUTCFullYear(); year++) {
    if (!covered.has(year)) missing.push(year);
  }
  if (missing.length === 0) return null;

  const list = missing.join(" y ");
  return (
    `No hay feriados cargados para ${list}. El plazo de veinte días hábiles de un aviso fijado ` +
    `hoy puede entrar en ${missing.length === 1 ? "ese año" : "esos años"}, y sin el calendario ` +
    `no se puede computar sin arriesgarse a acortarle el plazo al vecino. Cargá los feriados ` +
    `desde Configuración antes de asentar la fijación.`
  );
}

export const boardNotices = makeBoardNotices({ db: prisma });
