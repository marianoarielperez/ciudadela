// Etapa C del cierre (§9 del diseño): la transacción que CIERRA el Libro de
// Registro de Asociados y abre el siguiente. Es el acto más grave de todo el
// módulo —irreversible salvo restaurando un backup, y así se le advierte al
// operador— y por eso sus reglas están escritas acá, en un solo lugar:
//
//   - UNA sola `$transaction`, CERO red. Ni correo, ni Mercado Pago, ni PDFs:
//     el timeout de transacción de Prisma es de 5 s y una llamada externa
//     sostiene el bloqueo hasta que vuelve (el mismo corolario del PDF del
//     recibo en M4 y del débito en la baja de 4C). El cierre además no
//     notifica a nadie: las bajas ya se notificaron en la etapa B.
//   - La vista previa puede ENVEJECER: entre que el operador la mira y aprieta
//     el botón puede validarse una presentación o entrar una nueva. Por eso
//     las dos precondiciones bloqueantes se re-evalúan DENTRO de la
//     transacción, con los `where` compartidos de `./close` — los mismos que
//     usa el checklist, para que no puedan divergir (lección `coverageFloor`).
//     Y por el mismo motivo se re-valida adentro la tercera condición que la
//     pantalla exige para mostrar el botón: que haya ALGUIEN para migrar. Un
//     libro nuevo vacío no es un libro (paso 5).
//   - La numeración sale de `planMigration` (Task 15, revisada a mano y por
//     mutación) y de ningún otro lado. `assertDensePlan` re-verifica densidad
//     y unicidad ANTES de escribir: una numeración rota en el libro que la
//     asociación presenta ante la IGJ no se arregla después.
//   - En todo momento hay EXACTAMENTE un libro abierto: el cierre del viejo y
//     la apertura del nuevo ocurren en la misma transacción, así que ningún
//     lector ve cero ni dos. `requireOpenBook` (members/service) depende de
//     esa invariante y acá NO se usa: adentro de esta transacción el estado
//     intermedio la violaría a propósito — es la transacción la que la
//     sostiene hacia afuera, no la guarda.
//
// DOS VENTANAS DE CONCURRENCIA CONOCIDAS Y ACEPTADAS. No se cierran con código
// hoy; quedan escritas acá para que quien toque esto dentro de cinco años sepa
// que existen y por qué se convivió con ellas, en vez de descubrirlas el día
// que muerdan. Las dos son angostísimas y las dos tienen mitigación real —el
// cierre es una CEREMONIA que ejecuta una sola persona, con la Comisión
// reunida, no una pantalla que alguien abre un martes cualquiera—.
//
//   1. Un alta aprobada EN EL MISMO INSTANTE puede caer en el libro viejo.
//      `applications/record.ts` (aprobar una solicitud) y `members/service.ts`
//      (alta manual del panel) abren su PROPIA transacción y numeran con
//      `requireOpenBook`, que es un `findMany` sin bloqueo: si corre mientras
//      este cierre va por la mitad, ve el libro viejo todavía abierto e inserta
//      ahí. Esa membresía queda en un libro CERRADO, sin foto (`statusAtClose`
//      en null, porque el paso 2 ya pasó) y sin migrar (el paso 5 leyó su lista
//      antes de que existiera). Ninguna de las dos guardas de acá la ve: las
//      dos son SELECT comunes y la fila todavía no está commiteada.
//      Por qué se acepta: convocar SUSPENDE las altas web por sí solo
//      —`createApplicationAction` rechaza el POST leyendo `openWizardProcess`
//      mientras el proceso está en primera o segunda instancia—, así que no
//      entra ninguna solicitud nueva durante todo el proceso. Lo único que
//      queda es un operador aprobando la cola vieja o cargando un alta a mano
//      en el segundo exacto del cierre. Y si pasara, es DETECTABLE con la misma
//      condición que usa la guarda de completitud del paso 2: una membresía de
//      un libro cerrado con `statusAtClose` en null. La persona no se pierde
//      —quedan su ficha y su movimiento de admisión—: se la vuelve a asentar en
//      el libro nuevo a mano.
//
//   2. La foto y la decisión de migrar pueden leer VERSIONES DISTINTAS de la
//      misma persona. Esto es MEDIDO, no supuesto (MariaDB 10.11 —la misma
//      serie en el VPS—, nivel de aislamiento REPEATABLE READ, que es el
//      default y que este proyecto no cambia en ningún lado: no hay un solo
//      `isolationLevel` en `$transaction`):
//        · el `updateMany` de la foto compila a UNA sola sentencia
//          `UPDATE memberships … WHERE book_id = ? AND EXISTS(SELECT … FROM
//          members …)`, y el sub-SELECT de un DML es lectura ACTUAL: matchea
//          contra el último valor COMMITEADO, no contra la instantánea;
//        · `bookMemberships` compila a dos SELECT comunes (`memberships`, y
//          después `members WHERE id IN (…)`), que son lecturas consistentes:
//          ven la INSTANTÁNEA que la transacción fijó en su primera lectura, el
//          `findUnique` del paso 0.
//      Comprobado con dos conexiones sobre una base descartable: con la
//      instantánea diciendo `active` y otra sesión commiteando `withdrawn` en
//      el medio, el UPDATE matcheó igual y escribió la foto `withdrawn`,
//      mientras el SELECT posterior de la MISMA transacción seguía devolviendo
//      `active`. O sea que esa persona migraría al libro nuevo y quedaría
//      fotografiada de baja en el viejo (o al revés, según hacia dónde cambie
//      el estado).
//      Por qué se acepta: la ventana son los milisegundos entre el paso 0 y el
//      paso 2, y en ese rato nadie está cambiando el estado de un socio. Todos
//      los caminos que escriben `Member.status` son acciones de operador
//      —admisión, baja, suspensión, reintegro, readmisión, el lote de bajas y
//      el asiento de cartelera—: NINGÚN cron lo toca, así que no hay nada
//      automático que pueda meterse justo ahí. Y las bajas de la etapa B ya
//      están asentadas antes de llegar: que la cohorte esté terminal es
//      precondición bloqueante del paso 1.
//      Y no se arregla escribiendo la foto fila por fila desde `rows` —que
//      sería leer y escribir el mismo valor—: eso es exactamente lo que se
//      midió en el paso 2 y se comió el timeout entero.
//
// El cliente de Prisma se INYECTA (patrón del proyecto): este módulo no sabe
// de pantallas ni de `next/cache`, y sus tests corren sin base. La auditoría
// del cierre —estricta, porque el asiento ES la señal ante la IGJ— vive en la
// action, DESPUÉS del commit, con el patrón `auditAfterCommit` del modo carga.
import type { PrismaClient } from "@/generated/prisma/client";
// Del módulo de ENUMS generado, que exporta el objeto y el tipo con el mismo
// nombre y no evalúa ningún cliente: la foto del cierre recorre TODAS las
// combinaciones del enum, así que necesita los valores en runtime.
import { MemberCategory, MemberStatus } from "@/generated/prisma/enums";
import { CONFIG_KEYS } from "@/lib/config-keys";
import { createKeyedMutex } from "@/lib/keyed-mutex";
import { prisma } from "@/lib/prisma";
import {
  closeBlockers,
  cohortNotTerminalWhere,
  MIGRATING_STATUSES,
  planMigration,
  unresolvedPresentationsWhere,
  type ClosePrecondition,
  type MigrationEntry,
} from "./close";
import { canPrepareClose } from "./rules";

/** El nombre del asiento estricto del cierre y su entidad. Se nombran acá, no
 *  como literales en la action, por el mismo motivo que `CALL_AUDIT_ACTION`:
 *  el asiento se escribe en un lado y algún día se lee en otro. */
export const BOOK_CLOSE_AUDIT_ACTION = "book_close";
export const BOOK_AUDIT_ENTITY = "book";

type Db = Pick<
  PrismaClient,
  | "$transaction"
  | "reregistrationProcess"
  | "presentation"
  | "membership"
  | "book"
  | "movement"
  | "minute"
  | "configuration"
>;

type Deps = {
  db: Db;
  now?: () => Date;
};

/** Un aborto DECIDIDO del cierre, para distinguirlo de un fallo técnico: el
 *  mensaje está pensado para el operador y viaja tal cual a la pantalla. Se
 *  tira dentro de la transacción para que Prisma haga rollback de lo que
 *  hubiera, y se ataja afuera para devolver `{ ok: false }`. */
class CloseAborted extends Error {}

/** Re-verificación de las TRES propiedades del plan (densa, sin repetidos, sin
 *  perder gente) ANTES de escribir una sola fila. `planMigration` las
 *  garantiza por construcción y está testeada por mutación — esta guarda
 *  existe para el día en que alguien la toque: un libro con un salto o un
 *  número repetido es un documento ante la IGJ que no se puede corregir, así
 *  que acá se prefiere abortar el cierre entero a confiar.
 *
 *  `planMigration` devuelve las filas ya ordenadas por `newNumber` (índice+1),
 *  así que comparar contra `i + 1` caza a la vez el salto y el repetido. */
export function assertDensePlan(plan: MigrationEntry[], expectedCount: number): void {
  if (plan.length !== expectedCount) {
    throw new CloseAborted(
      `La numeración del libro nuevo salió con ${plan.length} filas para ${expectedCount} socios vigentes. No se cerró nada.`,
    );
  }
  const seen = new Set<number>();
  for (let i = 0; i < plan.length; i++) {
    if (plan[i].newNumber !== i + 1) {
      throw new CloseAborted(
        "La numeración del libro nuevo no es densa (hay un salto o un repetido). No se cerró nada.",
      );
    }
    if (seen.has(plan[i].memberId)) {
      throw new CloseAborted("La numeración del libro nuevo repite a un socio. No se cerró nada.");
    }
    seen.add(plan[i].memberId);
  }
}

export type ClosePreview = {
  blockers: ClosePrecondition[];
  migrants: Array<{
    memberId: number;
    fullName: string;
    oldNumber: number;
    newNumber: number;
    category: MemberCategory;
    status: MemberStatus;
  }>;
  withdrawnCount: number;
  newBookNumber: number;
};

export type CloseBookResult =
  | {
      ok: true;
      newBookId: number;
      migrated: number;
      /** Lo que la action necesita para el asiento estricto y el redirect al
       *  resumen, leído DENTRO de la transacción (la verdad del commit, no la
       *  vista previa que pudo envejecer). Superset de la firma del brief. */
      oldBookId: number;
      oldBookNumber: number;
      newBookNumber: number;
      withdrawnCount: number;
    }
  | { ok: false; error: string };

/** Serializa los cierres DENTRO del proceso (premisa de un solo proceso,
 *  docs/03): dos operadores apretando "Cerrar" a la vez entran de a uno, y el
 *  segundo encuentra el proceso ya cerrado y recibe su error legible en vez de
 *  una violación de unique en inglés. La clave es por proceso por prolijidad;
 *  en la práctica nunca hay dos procesos vivos. */
const mutex = createKeyedMutex();

/** Las membresías del libro, con lo vivo de cada socio. La comparten la vista
 *  previa y la transacción para que "quién migra" no pueda tener dos
 *  definiciones: las dos leen las MISMAS filas y filtran con
 *  `MIGRATING_STATUSES`. */
type BookRow = {
  id: number;
  memberNumber: number;
  member: { id: number; fullName: string; status: MemberStatus; category: MemberCategory; joinedAt: Date };
};

async function bookMemberships(
  db: Pick<PrismaClient, "membership">,
  bookId: number,
): Promise<BookRow[]> {
  return db.membership.findMany({
    where: { bookId },
    select: {
      id: true,
      memberNumber: true,
      member: { select: { id: true, fullName: true, status: true, category: true, joinedAt: true } },
    },
  });
}

function migrationCandidates(rows: BookRow[]) {
  return rows
    .filter((r) => (MIGRATING_STATUSES as readonly MemberStatus[]).includes(r.member.status))
    .map((r) => ({
      memberId: r.member.id,
      joinedAt: r.member.joinedAt,
      oldNumber: r.memberNumber,
      status: r.member.status,
      category: r.member.category,
    }));
}

/** Las dos cuentas bloqueantes, con los `where` compartidos. En SERIE y no con
 *  `Promise.all`: dentro de una transacción interactiva de Prisma las
 *  consultas van por la misma conexión y no deben solaparse. */
async function blockingPreconditions(
  db: Pick<PrismaClient, "presentation">,
  processId: number,
): Promise<ClosePrecondition[]> {
  const unresolved = await db.presentation.count({ where: unresolvedPresentationsWhere(processId) });
  const notTerminal = await db.presentation.count({ where: cohortNotTerminalWhere(processId) });
  return [
    { kind: "unresolved_presentations", count: unresolved },
    { kind: "cohort_not_terminal", count: notTerminal },
  ];
}

export function makeCloseBook(deps: Deps) {
  const now = deps.now ?? (() => new Date());

  return {
    /** Lo que la pantalla de confirmación muestra ANTES del botón: el mapeo
     *  completo número viejo → nuevo, las bajas del proceso, el número del
     *  libro que se va a abrir y los bloqueos vivos. Es una foto consultiva:
     *  la transacción vuelve a validar todo adentro. */
    async preview(processId: number): Promise<ClosePreview> {
      const process = await deps.db.reregistrationProcess.findUnique({
        where: { id: processId },
        select: { id: true, bookId: true, book: { select: { id: true, number: true } } },
      });
      if (!process || !process.book) throw new Error("El proceso no existe.");

      const blockers = closeBlockers(await blockingPreconditions(deps.db, processId));
      const withdrawnCount = await deps.db.presentation.count({
        where: { processId, status: "withdrawn" },
      });

      const rows = await bookMemberships(deps.db, process.bookId);
      const candidates = migrationCandidates(rows);
      const plan = planMigration(candidates);
      const byId = new Map(rows.map((r) => [r.member.id, r]));

      return {
        blockers,
        // `planMigration` ya devuelve las filas ordenadas por número nuevo.
        migrants: plan.map((p) => {
          const row = byId.get(p.memberId);
          if (!row) throw new Error("El plan de migración nombra a un socio que no está en el libro.");
          return {
            memberId: p.memberId,
            fullName: row.member.fullName,
            oldNumber: p.oldNumber,
            newNumber: p.newNumber,
            category: row.member.category,
            status: row.member.status,
          };
        }),
        withdrawnCount,
        newBookNumber: process.book.number + 1,
      };
    },

    /** El cierre. Una `$transaction`, cero red, y el orden exacto del diseño:
     *  re-validar → foto → cerrar el viejo → abrir el N+1 → membresías nuevas
     *  → movimientos → proceso cerrado y configuración limpia. */
    async closeBook(input: {
      processId: number;
      minuteId: number;
      actorId: number;
    }): Promise<CloseBookResult> {
      const { processId, minuteId, actorId } = input;
      return mutex.run(`book-close:${processId}`, async () => {
        try {
          return await deps.db.$transaction(async (tx) => {
            // ── 0. El proceso, su libro y el acta: la etapa tiene que ser la
            // correcta HOY, no cuando se abrió la pantalla.
            const process = await tx.reregistrationProcess.findUnique({
              where: { id: processId },
              select: {
                id: true,
                status: true,
                secondEndsAt: true,
                bookId: true,
                book: { select: { id: true, number: true, status: true } },
              },
            });
            if (!process || !process.book) throw new CloseAborted("El proceso no existe.");
            if (process.status === "closed") {
              throw new CloseAborted("El proceso ya está cerrado: el libro nuevo ya se abrió.");
            }
            // La misma función que habilita la etapa B: segunda instancia
            // abierta Y vencida. No se reescribe la comparación acá.
            if (!canPrepareClose(process, now())) {
              throw new CloseAborted(
                "Todavía no se puede cerrar el libro: la segunda instancia tiene que estar abierta y vencida.",
              );
            }
            if (process.book.status !== "open") {
              throw new CloseAborted(`El Libro N° ${process.book.number} ya está cerrado.`);
            }
            const minute = await tx.minute.findUnique({
              where: { id: minuteId },
              select: { id: true, date: true },
            });
            if (!minute) throw new CloseAborted("El acta de cierre seleccionada no existe.");

            // ── 1. Re-validación de los bloqueos, ADENTRO y con los datos que
            // la transacción ve: la vista previa pudo envejecer.
            const blockers = closeBlockers(await blockingPreconditions(tx, processId));
            if (blockers.length > 0) {
              const parts = blockers.map((b) =>
                b.kind === "unresolved_presentations"
                  ? `${b.count} ${b.count === 1 ? "presentación espera" : "presentaciones esperan"} decisión de la Comisión`
                  : `${b.count} ${b.count === 1 ? "convocado quedó" : "convocados quedaron"} sin desenlace`,
              );
              throw new CloseAborted(
                `Algo cambió después de la vista previa: ${parts.join(" y ")}. ` +
                  "No se cerró nada — volvé al checklist, resolvé lo pendiente y repetí la vista previa.",
              );
            }

            // ── 2. La foto: estado y categoría VIVOS de cada persona, en TODAS
            // las membresías del libro que se cierra — también las de las bajas
            // históricas. Es lo que hace consultable el libro cerrado para
            // siempre (REG-36).
            //
            // POR COMBINACIÓN, no por fila. El plan de esta tarea prescribía un
            // update por membresía y afirmaba que 278 filas entraban holgadas
            // en los 5 s del timeout; MEDIDO contra la MariaDB real del
            // entorno local, las 279 vueltas de ida y vuelta se comieron el
            // timeout enteras (P2028 a los ~5,05 s) y el cierre abortaba
            // siempre — la lección de la 4B, medir antes de suponer, una vez
            // más. La foto son a lo sumo 18 sentencias: una por combinación
            // estado × categoría, y se recorren TODAS las combinaciones del
            // enum —no sólo las presentes en una lectura previa— para que cada
            // fila reciba su foto con el valor que tiene EN LA BASE en este
            // instante: el `updateMany` matchea por el estado vivo y escribe
            // ese mismo estado.
            for (const status of Object.values(MemberStatus)) {
              for (const category of Object.values(MemberCategory)) {
                await tx.membership.updateMany({
                  where: { bookId: process.bookId, member: { status, category } },
                  data: { statusAtClose: status, categoryAtClose: category },
                });
              }
            }
            // Completitud, y falla CERRADA: si algún día el schema suma un
            // valor que estas listas generadas aún no traen (un cliente viejo
            // contra una base nueva), quedarían filas sin foto — mejor abortar
            // el cierre entero que cerrar un libro con la foto a medias.
            const unphotographed = await tx.membership.count({
              where: { bookId: process.bookId, statusAtClose: null },
            });
            if (unphotographed > 0) {
              throw new CloseAborted(
                `${unphotographed} ${unphotographed === 1 ? "membresía quedó" : "membresías quedaron"} sin foto al cerrar. No se cerró nada.`,
              );
            }

            const rows = await bookMemberships(tx, process.bookId);

            // ── 3. El libro viejo se cierra con su acta…
            await tx.book.update({
              where: { id: process.book.id },
              data: { status: "closed", closedAt: now(), closingMinuteId: minuteId },
            });

            // ── 4. …y el N+1 se abre EN LA MISMA transacción, con la misma
            // acta. Nada hardcodea "2": dentro de dos años este mismo código
            // cierra el 2 y abre el 3.
            const newBook = await tx.book.create({
              data: {
                number: process.book.number + 1,
                status: "open",
                openedAt: now(),
                openingMinuteId: minuteId,
              },
            });

            // ── 5. Los vigentes cruzan renumerados por `planMigration` (REG-28),
            // tal cual: densa, por antigüedad de día civil, empate por número
            // viejo. `joinedAt` NO se escribe en ningún lado de esta
            // transacción: la persona es la misma, con números distintos por
            // libro.
            const candidates = migrationCandidates(rows);
            // La tercera condición bloqueante, re-validada ADENTRO como las dos
            // del paso 1. La pantalla ya esconde el formulario cuando no hay
            // nadie para migrar, pero esa asimetría dejaba que la transacción
            // abriera un libro nuevo VACÍO sin protestar si entre la vista
            // previa y el botón se cayera el último vigente. Un libro sin un
            // solo socio no es un libro: se aborta y no se escribe nada.
            //
            // Vive acá y no en el paso 1 porque "quién migra" sale de `rows`,
            // que se lee en el paso 2 para la foto; contarlo antes con otra
            // consulta sería una SEGUNDA definición de vigente que puede
            // divergir de ésta (la lección de `coverageFloor`). La transacción
            // es atómica, así que abortar acá deshace también la foto y el
            // cierre del libro viejo.
            if (candidates.length === 0) {
              throw new CloseAborted(
                `Ningún socio vigente quedó para migrar al Libro N° ${process.book.number + 1}. ` +
                  "No se cerró nada — revisá el padrón y repetí la vista previa.",
              );
            }
            const plan = planMigration(candidates);
            assertDensePlan(plan, candidates.length);
            await tx.membership.createMany({
              data: plan.map((p) => ({
                memberId: p.memberId,
                bookId: newBook.id,
                memberNumber: p.newNumber,
              })),
            });

            // ── 6. Un movimiento por migrado, con la fecha del ACTA y el acta
            // de cierre como referencia (docs/04: "hereda el acta de cierre").
            await tx.movement.createMany({
              data: plan.map((p) => ({
                memberId: p.memberId,
                type: "book_migration" as const,
                date: minute.date,
                minuteId,
                createdById: actorId,
              })),
            });

            // ── 7. El proceso termina y la clave del sitio público se limpia:
            // sin ella, ASOCIATE vuelve a ofrecerse (la invalidación del caché
            // la hace la action, que es quien puede importar `next/cache`).
            await tx.reregistrationProcess.update({
              where: { id: processId },
              data: { status: "closed", closeMinuteId: minuteId },
            });
            await tx.configuration.deleteMany({
              where: { key: CONFIG_KEYS.reregistrationProcessId },
            });

            const withdrawnCount = await tx.presentation.count({
              where: { processId, status: "withdrawn" },
            });

            return {
              ok: true as const,
              newBookId: newBook.id,
              migrated: plan.length,
              oldBookId: process.book.id,
              oldBookNumber: process.book.number,
              newBookNumber: newBook.number,
              withdrawnCount,
            };
          },
          // Techo EXPLÍCITO y con margen sobre el default de 5 s. La
          // transacción entera son ~25 sentencias cortas —la foto por
          // combinación, dos createMany, un puñado de lecturas— y en el
          // entorno local cierra en menos de un segundo; el margen es para el
          // VPS compartido, porque acá un timeout no es un reintento barato:
          // es el operador apretando de nuevo el botón más grave del panel.
          { timeout: 15_000 });
        } catch (e) {
          if (e instanceof CloseAborted) return { ok: false as const, error: e.message };
          // Un fallo técnico (la base, un unique inesperado) no puede llegar a
          // la pantalla como stack trace en inglés en medio del acto más grave
          // del módulo. El detalle queda en el log del proceso.
          console.error("[close-book] transaction failed", e);
          return {
            ok: false as const,
            error: "El cierre falló y no se escribió nada. Revisá el estado del proceso y probá de nuevo.",
          };
        }
      });
    },
  };
}

export const closeBookService = makeCloseBook({ db: prisma });
