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

export function firstEndsAt(calledAt: Date): Date {
  return addCalendarDays(calledAt, FIRST_INSTANCE_DAYS);
}

export function secondEndsAt(startedAt: Date): Date {
  return addCalendarDays(startedAt, SECOND_INSTANCE_DAYS);
}

export function appealUntil(notifiedAt: Date): Date {
  return addCalendarDays(notifiedAt, APPEAL_DAYS);
}

/** Cohorte del proceso: adherentes vigentes al activar (decisión 12: los
 *  suspendidos participan — se los notifica y pueden presentarse).
 *
 *  Los dos estados vigentes se enumeran en vez de escribir `!== "withdrawn"`:
 *  si algún día aparece un estado nuevo en el enum, queda AFUERA de la cohorte
 *  hasta que alguien decida a mano que entra. Convocar de más a un estado que
 *  nadie miró termina en una baja por no presentarse. */
export function isCohortMember(m: { category: MemberCategory; status: MemberStatus }): boolean {
  return m.category === "adherent" && (m.status === "active" || m.status === "suspended");
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
 *  ya se presentó y va a la pantalla de estado de su propia presentación. */
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
    case "observed": // observada = hay que subsanar, y se subsana por el wizard
      return { kind: "eligible", memberId: member.id, maskedName: maskedName(member.fullName) };
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
 *  entero. Se compara día civil argentino contra día civil, no instante contra
 *  instante, o a las 21:00 del último día el server —que ya está en el día
 *  siguiente en UTC— le cortaría el plazo tres horas antes. */
export function canPrepareClose(
  p: { status: ReregistrationStatus; secondEndsAt: Date | null },
  now: Date = new Date(),
): boolean {
  if (p.status !== "second_instance" || p.secondEndsAt === null) return false;
  return civilDayOf(now).getTime() > civilDayOf(p.secondEndsAt).getTime();
}

/** El wizard público sólo abre durante las dos instancias. Sin proceso vivo no
 *  hay nada que re-empadronar: `preparing` es antes del primer aviso y
 *  `closing`/`closed` ya no admiten presentaciones. */
export function wizardOpen(p: { status: ReregistrationStatus } | null): boolean {
  return p !== null && (p.status === "first_instance" || p.status === "second_instance");
}
