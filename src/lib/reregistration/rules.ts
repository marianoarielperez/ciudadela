// Reglas puras del re-empadronamiento del Art. 9° bis: plazos, cohorte,
// veredicto de identificación del wizard y transiciones del proceso. Sin
// Prisma (ni siquiera el singleton: acá sólo entran TIPOS), sin reloj propio
// salvo donde se inyecta, sin pantallas. De esta aritmética cuelgan bajas de
// socios reales, así que cada decisión está testeada en tabla.
//
// LOS PLAZOS DE ESTE ARCHIVO SON DÍAS CORRIDOS, TODOS. El Art. 9° bis no
// aclara si sus 30 / 10 / 30 días son corridos o hábiles, y el proyecto tomó la
// lectura conservadora del art. 6 del CCyC: los plazos se cuentan en días
// corridos salvo que la norma diga otra cosa. Lo mismo vale para los 90 días
// del Art. 40. La ÚNICA aritmética de días hábiles del módulo es la de la
// cartelera, y vive aparte —`src/lib/board/business-days.ts`— justamente para
// que nadie las mezcle: este archivo no importa feriados y no tiene que
// hacerlo.
import type {
  EmailStatus,
  MemberCategory,
  MemberStatus,
  PresentationStatus,
  ReregistrationStatus,
} from "@/generated/prisma/client";
import { civilDayOf } from "@/lib/treasury/periods";

/** 1ª instancia: 30 días corridos desde la convocatoria (Art. 9° bis). */
export const FIRST_INSTANCE_DAYS = 30;
/** 2ª instancia: 10 días corridos más. */
export const SECOND_INSTANCE_DAYS = 10;
/** Recurso del Art. 9° bis d): 30 días corridos desde la notificación
 *  fehaciente. Es el plazo para INTERPONERLO, no para resolverlo. */
export const APPEAL_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

// Suma días CORRIDOS sobre el día civil argentino de `from`, y devuelve otra
// fecha civil (mediodía UTC). El día se resuelve con `civilDayOf` y no con el
// reloj del server porque a las 23:30 de acá UTC ya está en el día siguiente:
// un acta cargada de noche correría todos los plazos un día. Sumar 24 h sobre
// el mediodía UTC es exacto —UTC no tiene DST— y los cruces de mes, de año y
// de febrero bisiesto salen solos del objeto Date.
function addCalendarDays(from: Date, days: number): Date {
  return new Date(civilDayOf(from).getTime() + days * DAY_MS);
}

/** Último día de la 1ª instancia, INCLUSIVE: 30 días corridos desde la
 *  convocatoria. Como los otros dos plazos, devuelve un MARCADOR DE DÍA CIVIL
 *  argentino y se compara con `hasExpired` — nunca contra el instante crudo.
 *  Ver el bloque de `hasExpired`, que explica por qué. */
export function firstEndsAt(calledAt: Date): Date {
  return addCalendarDays(calledAt, FIRST_INSTANCE_DAYS);
}

/** Último día de la 2ª instancia, INCLUSIVE: 10 días corridos desde que se
 *  abrió. Marcador de día civil argentino; se compara con `hasExpired`. */
export function secondEndsAt(startedAt: Date): Date {
  return addCalendarDays(startedAt, SECOND_INSTANCE_DAYS);
}

/** Último día para INTERPONER el recurso del Art. 9° bis d), INCLUSIVE: 30 días
 *  corridos desde la notificación fehaciente. Marcador de día civil argentino;
 *  se compara con `hasExpired`. */
export function appealUntil(notifiedAt: Date): Date {
  return addCalendarDays(notifiedAt, APPEAL_DAYS);
}

/** ¿El plazo que termina el día `deadline` YA VENCIÓ a la fecha `now`?
 *
 *  LA ÚNICA FORMA DE PREGUNTARLO. Las tres funciones de arriba devuelven el
 *  mediodía UTC del último día civil argentino del plazo, que es el criterio con
 *  el que el proyecto guarda toda fecha civil. Ese mediodía UTC son las 09:00 de
 *  la mañana en Argentina, así que la comparación que sale sola —
 *  `new Date() > process.firstEndsAt`— da "vencido" desde las nueve de la mañana
 *  del último día y le come al vecino las últimas QUINCE HORAS de un plazo
 *  estatutario de treinta días. De esta aritmética cuelga la baja de un socio
 *  real: la segunda instancia o la declaración de baja se dispararían un día en
 *  que todavía tiene derecho a presentarse.
 *
 *  Por eso se compara DÍA CIVIL CONTRA DÍA CIVIL, y estricto: el día del
 *  vencimiento NO está vencido, el socio lo tiene entero hasta las 23:59 de acá.
 *  Recién el día siguiente vence.
 *
 *  Y por eso es una función COMPARTIDA en vez de una comparación repetida en
 *  cada llamador. El proyecto ya pagó esa lección con `coverageFloor`
 *  (`src/lib/treasury/rules.ts`): el devengo y el recordatorio de vencimiento
 *  calculaban su propio piso de cobertura por separado, divergieron, y al vecino
 *  que ingresó en septiembre se le reclamaba septiembre. Se arregló compartiendo
 *  la función, no reimplementándola. Acá vale igual: hay nueve tareas por venir
 *  que van a consultar estos plazos, y si cada una escribe su propia comparación
 *  van a divergir. */
export function hasExpired(deadline: Date, now: Date = new Date()): boolean {
  return civilDayOf(now).getTime() > civilDayOf(deadline).getTime();
}

/** LA definición de la cohorte, en dos constantes: el Art. 9° bis convoca a los
 *  socios ADHERENTES, y "vigente" incluye al suspendido (decisión 12: la
 *  suspensión es disciplinaria y no exime del deber de re-empadronarse; se lo
 *  notifica y puede presentarse).
 *
 *  Están exportadas —y no escritas adentro de `isCohortMember`— para que la
 *  CONSULTA que congela la cohorte al convocar (`reregistration/service.ts`) se
 *  arme con estos mismos valores en vez de repetir el criterio a mano. Si los
 *  dos se separan, la divergencia tiene una víctima concreta: un socio al que la
 *  consulta convocó —le corre el plazo y le llegó el correo— recibiría
 *  "no te encontramos" del wizard público, que filtra con `isCohortMember`. Es
 *  la misma lección de `coverageFloor` en el Módulo 4: compartir la función, no
 *  reimplementarla.
 *
 *  Los estados vigentes se ENUMERAN en vez de escribir `!== "withdrawn"`: si
 *  algún día aparece un estado nuevo en el enum, queda AFUERA de la cohorte
 *  hasta que alguien decida a mano que entra. Convocar de más a un estado que
 *  nadie miró termina en una baja por no presentarse. */
export const COHORT_CATEGORY = "adherent" satisfies MemberCategory;
export const COHORT_STATUSES = ["active", "suspended"] as const satisfies readonly MemberStatus[];

/** ¿Este socio pertenece a la cohorte del proceso? Único veredicto del criterio
 *  de arriba: lo usan el wizard público (paso 1) y todo lo que tenga la ficha
 *  del socio en la mano. Quien tenga que CONSULTAR la base usa las constantes. */
export function isCohortMember(m: { category: MemberCategory; status: MemberStatus }): boolean {
  return (
    m.category === COHORT_CATEGORY &&
    (COHORT_STATUSES as readonly MemberStatus[]).includes(m.status)
  );
}

/** El criterio de "casilla utilizable" del proyecto: sin dirección o con rebote
 *  registrado no se manda nada, y esos son exactamente los que van a la
 *  cartelera.
 *
 *  Vive ACÁ, en el módulo puro, y no en `service.ts`, porque lo comparten el
 *  servicio (para decidir a quién escribirle) y el TABLERO del panel (para
 *  decidir a quién le faltó el aviso y a quién le toca el cartel). Si cada uno
 *  escribiera su versión, un cohortado podría aparecer a la vez en las dos
 *  listas, o en ninguna. Y no puede vivir en `service.ts`: ese módulo evalúa el
 *  cliente de Prisma al cargarse, así que un componente que lo importara para
 *  esto se volvería intesteable sin base (`@/lib/prisma` tira si falta
 *  `DATABASE_URL`) — la trampa que el proyecto ya documenta.
 *
 *  Y NO está escrito una sola vez en todo `src/lib`: ésta es la sexta copia
 *  —las otras cinco están en `admin/health.ts:286`, `treasury/debtors.ts:110`,
 *  `treasury/reminder.ts:184`, `treasury/receipt-email.ts:60` y
 *  `members/member-requests/notify.ts:53`, más algunas pantallas—. Es deuda
 *  conocida, no una decisión: unificarla toca el núcleo de dinero y excede este
 *  módulo. Lo que sí se sostiene es que la FORMA sea idéntica a las otras, para
 *  que el día que se unifique sea un reemplazo mecánico. */
export function emailUsable(m: { email: string | null; emailStatus: EmailStatus }): boolean {
  return Boolean(m.email) && m.emailStatus !== "bounced";
}

/** Paso 1 del wizard. El caller busca por DNI y pasa lo hallado (o null). */
export type LookupVerdict =
  | { kind: "eligible"; memberId: number; maskedName: string }
  | { kind: "not_found" };

/** Veredicto de identificación del paso 1.
 *
 *  Hay UN SOLO veredicto negativo a propósito: el DNI no es autenticación, y
 *  quien tipea uno ajeno no tiene que poder distinguir "no existe" de "existe
 *  pero no es adherente" ni de "le declararon la baja". El cartel de la
 *  pantalla es genérico y este tipo lo garantiza: `not_found` no lleva motivo
 *  ni id. `already_submitted` sí se separa porque no es un rechazo — el socio
 *  ya se presentó y va a la pantalla de estado de su propia presentación, que
 *  no muestra ningún dato cargado y le ofrece que le reenviemos el enlace.
 *
 *  Y por eso `observed` va AHÍ y no a `eligible`. Es la garantía que cierra el
 *  agujero: entrar por el paso 1 acuña una llave nueva y ROTA la anterior, así
 *  que si el DNI reabriera una presentación observada, cualquiera que tipeara
 *  ese número —que no es una contraseña— mataría el enlace que el socio tiene
 *  en el buzón justo cuando le corre el plazo para subsanar, y de paso podría
 *  pisarle lo cargado. El acceso a datos ya cargados es SIEMPRE por el enlace
 *  del correo (diseño M6 §5.4, primera línea): el buzón es lo único que
 *  acredita que es él. Editable la presentación sigue siéndolo —`observed`
 *  está en `EDITABLE_STATUSES`—; lo que cambia es por dónde se entra. */
export function lookupVerdict(input: {
  member: { id: number; fullName: string; category: MemberCategory; status: MemberStatus } | null;
  presentation: { status: PresentationStatus } | null;
}): LookupVerdict | { kind: "already_submitted" } {
  const { member, presentation } = input;
  if (member === null || !isCohortMember(member)) return { kind: "not_found" };
  // Sin fila de cohorte no fue convocado: el adherente que la CD recategorizó
  // DESPUÉS de activar queda fuera del proceso (cohorte fija).
  if (presentation === null) return { kind: "not_found" };
  switch (presentation.status) {
    case "pending":
      return { kind: "eligible", memberId: member.id, maskedName: maskedName(member.fullName) };
    case "observed": // se subsana por el ENLACE del correo, nunca tipeando el DNI
    case "submitted":
    case "validated":
      return { kind: "already_submitted" };
    case "rejected":
    case "withdrawn":
      return { kind: "not_found" };
  }
}

/** "Castillo Nestor" (formato del padrón: Apellido Nombre) → "N***** C."
 *
 *  Para qué: que quien tipeó un DNI confirme que es él, SIN que el sistema le
 *  revele el nombre completo de un tercero. Alcanza con que el propio socio se
 *  reconozca; a un desconocido el resultado no le dice quién es.
 *
 *  REGLA FIJADA (y fijada también en el test, que es donde se lee la tabla de
 *  casos): la PRIMERA palabra es el apellido y viaja sólo como inicial + punto;
 *  todas las demás son nombres, y cada uno conserva su inicial y enmascara el
 *  resto con un asterisco por letra. Un nombre de una sola palabra da "C." solo.
 *
 *  Por qué "primera palabra = apellido" y no una heurística de apellido
 *  compuesto: el padrón viene en formato "Apellido Nombre" y no marca dónde
 *  termina el apellido. "Perez Gomez Maria Ana" es indistinguible de un
 *  apellido compuesto con dos nombres o de un apellido simple con tres
 *  nombres, y adivinar mal cambia el cartel que ve el vecino. La regla
 *  mecánica siempre da lo mismo para el mismo dato, que es lo que se necesita
 *  para confirmar.
 *
 *  Los acentos y la ñ cuentan como UNA letra: el padrón los tiene (hay un socio
 *  "Coñuecar") y a veces llegan en forma descompuesta (la ñ como "n" + tilde
 *  combinante), que contada cruda mostraría un asterisco de más. Por eso se
 *  normaliza a NFC y se recorre por code points. */
export function maskedName(fullName: string): string {
  const words = fullName.normalize("NFC").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";

  // `split(/\s+/)` + `filter(Boolean)` garantiza que ninguna palabra esté vacía,
  // así que el primer code point siempre existe.
  const initial = (word: string) => [...word][0].toLocaleUpperCase("es-AR");
  const surname = `${initial(words[0])}.`;
  const given = words.slice(1).map((word) => initial(word) + "*".repeat([...word].length - 1));
  return given.length === 0 ? surname : `${given.join(" ")} ${surname}`;
}

/** La 2ª instancia se abre desde la 1ª y desde ningún otro estado. Que el plazo
 *  de la 1ª esté vencido no se exige acá: el Art. 9° bis no impide abrirla
 *  antes, y quien decide es la Comisión. */
export function canStartSecond(p: { status: ReregistrationStatus }): boolean {
  return p.status === "first_instance";
}

/** Preparar el cierre exige que la 2ª instancia esté abierta Y VENCIDA.
 *
 *  El vencimiento se chequea acá y no sólo el estado —por eso la firma pide
 *  `secondEndsAt`, que si no sobraría—: la etapa de cierre declara las bajas de
 *  quienes no se presentaron, y mientras el plazo corre todavía se pueden
 *  presentar. Habilitar el botón un día antes convierte una demora del vecino
 *  en una baja.
 *
 *  El día del vencimiento NO habilita: ese día el socio todavía tiene el plazo
 *  entero. Quién decide eso es `hasExpired`, que es el único comparador de
 *  plazos del módulo — acá no se vuelve a escribir la comparación. */
export function canPrepareClose(
  p: { status: ReregistrationStatus; secondEndsAt: Date | null },
  now: Date = new Date(),
): boolean {
  if (p.status !== "second_instance" || p.secondEndsAt === null) return false;
  return hasExpired(p.secondEndsAt, now);
}

/** El último día del plazo QUE CORRE AHORA, o `null` si el proceso no está en
 *  ninguna de sus dos instancias.
 *
 *  Para qué: lo que el vecino necesita saber cuando le pedimos que corrija algo
 *  no es cuándo empezó el trámite sino hasta cuándo tiene. Decirle "hacelo
 *  cuanto antes" y nada más lo deja calculando un plazo estatutario que él no
 *  puede reconstruir — y del vencimiento de ese plazo cuelga su baja.
 *
 *  Vive acá, con los otros plazos, y no en el llamador de turno: la 1ª y la 2ª
 *  instancia tienen columnas distintas, y "cuál de las dos manda" es
 *  exactamente la clase de decisión que copiada en dos pantallas termina
 *  citándole al vecino la fecha de la instancia equivocada.
 *
 *  `preparing`, `closing` y `closed` devuelven `null` y no una fecha vieja: en
 *  esos estados no hay plazo corriendo, y afirmar uno sería peor que callarlo.
 *  Es la misma lista que decide `wizardOpen`, escrita con `wizardOpen` para que
 *  no puedan divergir.
 *
 *  Y UNA FECHA YA VENCIDA TAMBIÉN DEVUELVE `null`, por el mismo motivo. El
 *  estado del proceso no cambia solo: cuando la 1ª instancia vence, el proceso
 *  se queda en `first_instance` hasta que la Comisión abre la 2ª o cierra. En
 *  esa ventana —el panel la detecta y le avisa a la Comisión, así que debería
 *  ser corta, pero mientras dura es real— citar `firstEndsAt` le decía al
 *  vecino "las asociaciones están suspendidas hasta el 25/09" un 30 de
 *  septiembre: le afirma que la suspensión terminó mientras el botón de
 *  asociarse sigue apagado y el POST sigue rechazando. Sin fecha el texto es
 *  verdadero en los dos momentos ("suspendidas durante el proceso"), y esa es
 *  la razón por la que se resuelve ACÁ y no en cada pantalla: la portada,
 *  `/asociate` y el mensaje del POST leen esta misma función —dos por el lector
 *  cacheado de `@/lib/config` y una directo— y así no pueden divergir. Lo mismo
 *  vale para el correo de observación y la tarjeta de `/mi`, que ya sabían
 *  redactarse sin fecha.
 *
 *  El vencimiento se pregunta con `hasExpired` —el único comparador de plazos
 *  del módulo, día civil contra día civil— y NO con un `>` sobre el instante:
 *  el día del vencimiento el vecino lo tiene entero, y ese día la fecha se
 *  sigue citando. */
export function currentDeadline(
  p: {
    status: ReregistrationStatus;
    firstEndsAt: Date;
    secondEndsAt: Date | null;
  },
  now: Date = new Date(),
): Date | null {
  if (!wizardOpen(p)) return null;
  const deadline = p.status === "second_instance" ? p.secondEndsAt : p.firstEndsAt;
  if (deadline === null || hasExpired(deadline, now)) return null;
  return deadline;
}

/** El wizard público sólo abre durante las dos instancias. Sin proceso vivo no
 *  hay nada que re-empadronar: `preparing` es antes del primer aviso y
 *  `closing`/`closed` ya no admiten presentaciones. */
export function wizardOpen(p: { status: ReregistrationStatus } | null): boolean {
  return p !== null && (p.status === "first_instance" || p.status === "second_instance");
}
