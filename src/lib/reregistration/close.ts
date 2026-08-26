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
import type { MemberCategory, MemberStatus } from "@/generated/prisma/client";
import { civilDayOf } from "@/lib/treasury/periods";

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
