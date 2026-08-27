// Dominio PURO del cierre del Libro de Registro de Asociados (Art. 40 del
// estatuto reformado): quién va a qué número en el libro nuevo, y qué impide
// cerrar. Sin Prisma —ni siquiera el singleton, que revienta al evaluarse si
// falta `DATABASE_URL`—, sin reloj propio, sin pantallas: acá sólo entran TIPOS.
//
// Vive aparte de `rules.ts` porque son dos etapas distintas del módulo: `rules`
// resuelve el proceso de re-empadronamiento (plazos, cohorte, wizard) y ahí
// queda `canPrepareClose`, que decide cuándo se PUEDE empezar a cerrar. Este
// archivo empieza donde ese termina: la etapa A (checklist) y la etapa C
// (migración) del diseño §9. La aritmética de días hábiles no está ni acá ni
// allá: es de la cartelera y vive en `src/lib/board/business-days.ts`.
import type {
  MemberCategory,
  MemberStatus,
  NotificationStatus,
  NotificationType,
  NotificationVia,
  Prisma,
} from "@/generated/prisma/client";
import { civilDayOf } from "@/lib/treasury/periods";
import { COHORT_CATEGORY, COHORT_STATUSES } from "./rules";

/** Una fila del libro viejo tal como la lee el caller para planificar. */
export type MigrationCandidate = {
  memberId: number;
  joinedAt: Date;
  oldNumber: number;
  status: MemberStatus;
  category: MemberCategory;
};

/** Dónde queda cada socio en el libro nuevo. */
export type MigrationEntry = {
  memberId: number;
  oldNumber: number;
  newNumber: number;
};

/** REG-28: renumeración DENSA 1..N por antigüedad para el Libro N° 2.
 *
 *  Entran los que el CALLER ya filtró (los vigentes del libro viejo: activos y
 *  suspendidos, decisión 12). Esta función no vuelve a filtrar a propósito: el
 *  criterio de "vigente" ya lo aplica la consulta que arma la lista, y
 *  reescribirlo acá sería una segunda definición que puede divergir de aquélla
 *  —la lección de `coverageFloor` en el Módulo 4—. `status` y `category` viajan
 *  en la entrada pero no deciden nada del orden: están para que el caller pase
 *  la fila entera y para que la etapa C tenga a mano la foto que va a escribir
 *  en la membresía nueva (§9 etapa C, paso 4).
 *
 *  ORDEN: día de ingreso ascendente; empate → número del libro anterior
 *  ascendente. El que ingresó primero se lleva el 1.
 *
 *  EL NÚMERO DE SOCIO CAMBIA, y el operador lo aceptó a sabiendas: el 306 puede
 *  quedar 64. Lo que NO cambia nunca es `joinedAt` —la antigüedad estatutaria,
 *  de la que cuelga el derecho a votar (`members/electoral.ts`)—: es la misma
 *  persona con un número distinto por libro, y el número viejo queda para
 *  siempre en la foto del libro cerrado.
 *
 *  TRES PROPIEDADES, y las tres están asertadas en el test:
 *  - **Densa**: `newNumber` es el índice + 1, así que sale 1..N sin saltos por
 *    construcción. El Libro 1 tiene 28 huecos en su numeración 1-306 y el nuevo
 *    no hereda ninguno.
 *  - **Sin repetidos**: mismo motivo — un índice de array no se repite. Y como
 *    no se filtra ni se agrupa, salen exactamente tantas filas como entraron,
 *    que es lo que hace válido el unique `[bookId, memberNumber]` del schema.
 *  - **Estable**: el comparador es un orden TOTAL, así que el resultado no
 *    depende del orden en que venga la lista. `oldNumber` ya alcanza para eso
 *    —el schema lo tiene único por libro (`@@unique([bookId, memberNumber])`)—;
 *    el tercer criterio por `memberId` no llega a usarse nunca con datos
 *    reales y está para que un dato imposible no vuelva el resultado
 *    dependiente del orden de la consulta, que es justo lo que haría el
 *    `sort` estable de JS.
 *
 *  Y el orden se decide por DÍA CIVIL ARGENTINO, no por el instante: hoy toda
 *  `joinedAt` se escribe a mediodía UTC —los tres caminos que la escriben son
 *  `padron/mapping.ts` (vía `excelDateToCivilUtc`) y `members/service.ts` /
 *  `applications/record.ts` (vía `minute.date`, que parsea con
 *  `parseCivilDate`); `card-edit.ts` la tiene fuera de su lista blanca—, así
 *  que `civilDayOf` es hoy la identidad. Lo que compra es UNA sola cosa, y para
 *  el día en que alguna fila entre con hora de reloj: COLAPSAR EN EMPATE los
 *  ingresos del mismo día, para que el desempate lo decida el número del libro
 *  anterior —que es el criterio acordado— y no la hora en que un operador cargó
 *  la ficha, que no dice nada de la antigüedad.
 *
 *  Lo que NO compra, y conviene dejarlo escrito porque tienta pensar lo
 *  contrario: el día civil no puede dar vuelta dos ingresos. Argentina es UTC-3
 *  FIJA (sin horario de verano), así que pasar del instante al día civil es
 *  monótono —restar tres horas y truncar—: si un instante es anterior a otro,
 *  su día civil nunca es posterior. Un ingreso de las 23 de acá, que en UTC ya
 *  cayó al día siguiente, no se "lee más nuevo" comparando instantes: sigue
 *  siendo posterior a todo lo de ese día y anterior a todo lo del que sigue.
 *  La única diferencia con comparar instantes es DÓNDE se pierde la hora, y ahí
 *  está el punto: la ventana del empate va de las 00:00 a las 23:59
 *  ARGENTINAS, no las UTC — ese ingreso de las 23 empata con el de las 09 de la
 *  mañana del mismo día de acá, y no con los del día UTC en el que cayó. Es la
 *  misma razón por la que los plazos se comparan con `hasExpired` y no con un
 *  `>` crudo. */
export function planMigration(members: MigrationCandidate[]): MigrationEntry[] {
  // Decorar-ordenar-desdecorar: `civilDayOf` arma un `Intl.DateTimeFormat` por
  // llamada, y dentro del comparador se ejecutaría O(n log n) veces por socio.
  return members
    .map((m) => ({ m, day: civilDayOf(m.joinedAt).getTime() }))
    .sort((a, b) => a.day - b.day || a.m.oldNumber - b.m.oldNumber || a.m.memberId - b.m.memberId)
    .map(({ m }, index) => ({
      memberId: m.memberId,
      oldNumber: m.oldNumber,
      newNumber: index + 1,
    }));
}

/** Las condiciones que la etapa A pone sobre la mesa antes de cerrar (§9). */
export type ClosePrecondition =
  | { kind: "unresolved_presentations"; count: number } // submitted|observed vivas → BLOQUEA
  | { kind: "cohort_not_terminal"; count: number } // adherentes vigentes de la cohorte sin validated → BLOQUEA (falta declarar bajas)
  | { kind: "arrears_candidates"; count: number } // cesanteables por mora HOY → ADVIERTE (decisión 1)
  | { kind: "board_in_progress"; count: number }; // avisos sin cumplir → contexto

/** Las DOS que bloquean, enumeradas y no derivadas de un `!==`: si mañana
 *  aparece un `kind` nuevo, cae del lado que no frena hasta que alguien decida
 *  a mano que frena. Un cierre trabado por una condición que nadie revisó es
 *  peor que uno que avisa de más — la etapa C tiene además su propia
 *  precondición dura re-validada adentro de la transacción. */
const BLOCKING_KINDS: readonly ClosePrecondition["kind"][] = [
  "unresolved_presentations",
  "cohort_not_terminal",
];

/** Cuáles de las condiciones relevadas IMPIDEN cerrar. Lista vacía = se puede.
 *
 *  La distinción entre "esto te frena" y "esto mirá antes de seguir" es la misma
 *  de `/admin/salud` (*act* vs *review*) y existe por el mismo motivo: un
 *  tablero que pinta todo de rojo se deja de mirar.
 *
 *  BLOQUEAN las presentaciones sin resolver y los cohortados sin desenlace. No
 *  es formalismo: cerrar con gente en el limbo la deja afuera del libro nuevo
 *  sin que nadie haya decidido nada sobre ella, y la baja de un socio necesita
 *  un acta que diga que se declaró.
 *
 *  ADVIERTEN los cesanteables por mora. El Art. 40 manda depurar también con ese
 *  criterio, pero **declarar una cesantía es una decisión de la Comisión con su
 *  propia acta**: el sistema la muestra y no la automatiza jamás. Advierten
 *  también los avisos de cartelera en curso, que son contexto.
 *
 *  Un contador en CERO no bloquea aunque su `kind` sea de los que frenan: "cero
 *  presentaciones sin resolver" es exactamente la condición cumplida. Así la
 *  pantalla puede armar la lista con las cuatro filas siempre —que es lo que
 *  hace legible un checklist— sin nacer en rojo. */
export function closeBlockers(pre: ClosePrecondition[]): ClosePrecondition[] {
  return pre.filter((p) => p.count > 0 && BLOCKING_KINDS.includes(p.kind));
}

/** Los `where` de las DOS condiciones bloqueantes, escritos UNA sola vez.
 *
 *  Los comparten el checklist de la etapa A (`withdrawals.closeChecklist`), la
 *  vista previa de la etapa C y —lo que importa— la re-validación DENTRO de la
 *  transacción de cierre. La vista previa puede envejecer entre que el operador
 *  la mira y aprieta el botón, así que la transacción vuelve a contar con los
 *  datos que ella ve; si el `where` de adentro divergiera del de afuera, la
 *  pantalla diría "se puede cerrar" sobre una condición que la transacción no
 *  revisa — la lección de `coverageFloor` del Módulo 4, una vez más.
 *
 *  Viven acá (puro, sólo tipos de Prisma) y no en `withdrawals.ts`, que arrastra
 *  el singleton de Prisma y el mailer: la transacción de cierre vive en un
 *  módulo con la base inyectada y no puede importar aquello. */
export function unresolvedPresentationsWhere(processId: number): Prisma.PresentationWhereInput {
  // Presentaciones que esperan una decisión de la Comisión: cerrar con ellas
  // vivas deja al vecino fuera del libro nuevo sin que nadie haya resuelto nada.
  return { processId, status: { in: ["submitted", "observed"] } };
}

export function cohortNotTerminalWhere(processId: number): Prisma.PresentationWhereInput {
  // Convocados que siguen siendo adherentes vigentes y no tienen su
  // re-empadronamiento validado: los que esperan que la Comisión les declare la
  // baja (§9 etapa C: "cero adherentes vigentes de la cohorte sin validated").
  return {
    processId,
    status: { notIn: ["validated"] },
    member: { category: COHORT_CATEGORY, status: { in: [...COHORT_STATUSES] } },
  };
}

/** Qué estados MIGRAN al libro nuevo: los vigentes (decisión 12 del diseño: los
 *  suspendidos migran suspendidos; `withdrawn` queda en la foto del libro que
 *  se cierra y nada más). Coincide en valores con `COHORT_STATUSES` porque las
 *  dos listas enumeran "vigente", pero es OTRA decisión: aquélla dice a quién
 *  alcanza la convocatoria (sólo adherentes); ésta dice quién cruza de libro
 *  (todas las categorías). Compartir la constante ataría el alcance de la
 *  cohorte al de la migración, que no tienen por qué moverse juntos. */
export const MIGRATING_STATUSES = ["active", "suspended"] as const satisfies readonly MemberStatus[];

/** Presupuesto de LLAMADAS DE RED de un lote de bajas. No es un tope de nombres
 *  por tanda: es cuántas cancelaciones de débito automático en Mercado Pago
 *  entran en una sola petición HTTP.
 *
 *  ── De dónde sale el número ─────────────────────────────────────────────────
 *  Cada baja del lote llama a `withdrawWithDebits`, que DESPUÉS del commit
 *  cancela en Mercado Pago cada suscripción que no se pueda afirmar muerta
 *  —medido en ~1,2 s cada una—. El lote corre en serie dentro de una server
 *  action detrás de un Nginx con `proxy_read_timeout` de 60 s: 25 × 1,2 s ≈ 30 s
 *  deja la otra mitad del presupuesto para la base y los correos. Es el mismo
 *  argumento —y el mismo número— que el lote de cesantía por mora, de donde se
 *  heredó.
 *
 *  ── Por qué dejó de contar CONVOCADOS y pasó a contar cancelaciones ─────────
 *  Porque acá los convocados son ADHERENTES, y la categoría no habilita el
 *  débito automático. En el ensayo real del 26/08/2026 el operador declaró 90
 *  bajas y hubo CERO llamadas a Mercado Pago: el tope de 25 nombres lo obligó a
 *  armar cuatro veces la selección y cuatro veces el acta para protegerse de un
 *  costo que ese lote no tenía. Contar nombres era medir la cosa equivocada.
 *
 *  ── El otro presupuesto: el tiempo de la petición ───────────────────────────
 *  Lo que gasta el lote sin débitos es base: por socio, una transacción corta
 *  (la baja, sus enlaces revocados, la cuenta apagada, el movimiento) contra
 *  MariaDB en localhost, más un `updateMany` y un asiento de auditoría. Medido
 *  en el ensayo, 25 bajas sin débito tardan pocos segundos, así que 90 entran
 *  holgadas en los 60 s.
 *
 *  La otra red de la petición son los correos del post-lote, y no se cuentan
 *  acá a propósito: sólo los tiene quien tiene casilla utilizable —en este
 *  padrón, unos 24 de 124 adherentes—, un envío SMTP es un orden de magnitud más
 *  barato que un `cancelPreapproval`, y hoy la `EMAIL_ALLOWLIST` de producción
 *  los corta antes de salir. Si algún día el lote sumara otra llamada externa
 *  POR SOCIO —una que le toque a todos—, el presupuesto a revisar es éste.
 *
 *  Vive en este módulo PURO y no en `withdrawals.ts` porque `withdrawals.ts`
 *  arrastra Prisma y el mailer: la regla se prueba sin base y la puede importar
 *  cualquiera de los dos lados (la action y el dominio la aplican por separado,
 *  y tienen que aplicar la MISMA). */
export const WITHDRAWAL_DEBIT_CALL_BUDGET = 25;

/** Cuánto le va a costar en RED a un lote de bajas: cuántos de los seleccionados
 *  tienen débito automático que hay que cancelar, y cuántas cancelaciones son.
 *
 *  Son dos números y no uno porque `memberId` NO es unique en `mp_subscriptions`:
 *  un vecino puede tener dos preapprovals vivos, y son dos llamadas de red. */
export type DebitLoad = { members: number; calls: number };

/** La guarda del lote, como función pura. `null` = se puede procesar entero.
 *
 *  El mensaje dice los dos números y qué hacer, porque un "no" a secas manda al
 *  operador a adivinar por dónde partir la selección — y lo que tiene que partir
 *  no son los nombres sino los que tienen débito: a los demás los puede declarar
 *  todos juntos. */
export function debitBudgetBlock(load: DebitLoad): string | null {
  if (load.calls <= WITHDRAWAL_DEBIT_CALL_BUDGET) return null;
  const cuantos =
    load.calls === load.members
      ? `${load.members} ${load.members === 1 ? "tiene" : "tienen"} el débito automático vivo en Mercado Pago`
      : `${load.members} ${load.members === 1 ? "tiene" : "tienen"} el débito automático vivo en Mercado Pago ` +
        `(${load.calls} débitos en total: hay quien tiene más de uno)`;
  return (
    `De los convocados que seleccionaste, ${cuantos}, y una tanda cancela hasta ` +
    `${WITHDRAWAL_DEBIT_CALL_BUDGET} por vez: cada cancelación es una llamada a Mercado Pago de ` +
    "alrededor de un segundo, y la pantalla se cortaría por tiempo antes de terminar de declarar las " +
    `bajas. Partí la selección dejando hasta ${WITHDRAWAL_DEBIT_CALL_BUDGET} de los que tienen débito ` +
    "en cada tanda; a los que no tienen podés declararlos todos juntos."
  );
}

/** Una notificación cursada, tal como va al anexo del acta (REG-23). Es lo que
 *  hace oponible la resolución: qué se le dijo al vecino, por qué vía y cuándo.
 *
 *  El tipo vive acá —puro, sin Prisma— porque lo consumen el dominio que lo
 *  arma y la pantalla de cliente que lo dibuja. */
export type NoticeTrace = {
  type: NotificationType;
  via: NotificationVia;
  /** El estado importa y no es decorado: una fila `failed` registra un INTENTO,
   *  no una acreditación (Art. 5° quater). El anexo no puede afirmar que a
   *  alguien se lo notificó cuando el correo no salió. */
  status: NotificationStatus;
  /** Correo: la fecha del envío. Cartelera: la fecha en que el cartel se fijó. */
  at: Date;
  /** CUÁNDO QUEDÓ FEHACIENTE, que no es lo mismo según la vía. Por correo, al
   *  enviarse. Por cartelera, al CUMPLIRSE los veinte días hábiles (`boardTo`),
   *  nunca al fijarse el cartel. De esta fecha cuelga la ventana de recurso.
   *  `null` en un cartel que todavía no se asentó. */
  effectiveAt: Date | null;
};
