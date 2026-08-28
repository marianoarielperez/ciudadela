// Padrón electoral (REG-31, docs/02:162-166) con la enmienda del operador del
// 23/08/2026.
//
// La enmienda: el Código Civil y Comercial deja al moroso purgar su deuda hasta
// una hora antes del acto, así que el padrón NO lo excluye — lo LISTA aparte,
// con cuántas cuotas y cuánto tiene que pagar en la mesa para votar. Por eso son
// TRES bloques y no una lista filtrada: habilitados, con deuda a purgar y (desde
// el 27/08/2026) los que no alcanzan la antigüedad mínima, también con nombre.
//
// Cuatro cosas del estatuto que no son obvias:
//   - Los ADHERENTES votan (con ≥90 días). "Sin mora" es requisito sólo de
//     activos y colaboradores.
//   - HONORARIOS y VITALICIOS votan SIN el piso de antigüedad: REG-30 los exime
//     expresamente y REG-31 no los distingue. Prevalece REG-30 por decisión del
//     operador del 24/08/2026 (spec §13, decisión 10): la distinción de esas dos
//     categorías existe para honrarlas, no para ponerles un plazo.
//   - La antigüedad sale de `joinedAt` y el reingreso NO la reinicia (REG-11),
//     así que no hay nada especial que hacer: `joinedAt` ya es el original.
//   - "No registrar deuda a la fecha de la elección" es MORA, no "al cobro": se
//     mide sobre períodos ANTERIORES al mes de la elección (§3 de la spec). Con
//     la otra definición, el padrón se vaciaría de activos todos los meses.
//
// Prisma inyectado; la fecha es un PARÁMETRO (docs/02:164), nunca el reloj.
import type { MemberCategory, PrismaClient } from "@/generated/prisma/client";
import { periodOf, type Period } from "@/lib/treasury/periods";
import { ACCRUING_CATEGORIES, debtAmount, type FeeValueAmounts } from "@/lib/treasury/rules";

export const ELECTORAL_MIN_DAYS = 90;

/** REG-31: activos, honorarios, colaboradores, vitalicios y adherentes. El
 *  CADETE no integra el padrón: no tiene voto (docs/02, tabla del Art. 5). */
export const ELECTORAL_CATEGORIES: readonly MemberCategory[] = [
  "active",
  "honorary",
  "collaborator",
  "lifetime",
  "adherent",
];

/** REG-30 (docs/02:160-161) exime del piso de 90 días a honorarios y vitalicios.
 *  Son las dos categorías que la asamblea OTORGA por trayectoria o servicios: un
 *  plazo de espera encima de una distinción no tendría a quién proteger. */
export const SENIORITY_EXEMPT: readonly MemberCategory[] = ["honorary", "lifetime"];

export function seniorityDays(joinedAt: Date, at: Date): number {
  return Math.floor((at.getTime() - joinedAt.getTime()) / 86_400_000);
}

export function isEligibleBySeniority(joinedAt: Date, at: Date): boolean {
  return seniorityDays(joinedAt, at) >= ELECTORAL_MIN_DAYS;
}

/** ¿Este socio pasa el filtro de antigüedad? Los exentos pasan siempre. */
export function meetsSeniority(category: MemberCategory, joinedAt: Date, at: Date): boolean {
  return SENIORITY_EXEMPT.includes(category) || isEligibleBySeniority(joinedAt, at);
}

/** El primer día en que el socio alcanza el piso: ingreso + ELECTORAL_MIN_DAYS.
 *  Ambos extremos viven a mediodía UTC (`civilDateUtc`), así que la suma cae
 *  exacta en el día civil argentino y es la contracara de
 *  `isEligibleBySeniority` (>= 90: ese mismo día ya vota). */
export function enabledFrom(joinedAt: Date): Date {
  return new Date(joinedAt.getTime() + ELECTORAL_MIN_DAYS * 86_400_000);
}

/** "Sin mora" es requisito sólo de activos y colaboradores (REG-31): el aporte
 *  del adherente es voluntario y su deuda no le quita el voto; honorarios y
 *  vitalicios no devengan. Compartida por el padrón y la credencial de /mi para
 *  que las dos superficies no puedan divergir (lección `coverageFloor`). */
export function mustPurgeToVote(category: MemberCategory, arrears: number): boolean {
  return arrears > 0 && ACCRUING_CATEGORIES.includes(category);
}

export type ElectoralRow = {
  memberId: number;
  /** `null` cuando el socio no tiene membresía en el libro ABIERTO. No es un caso
   *  teórico: al abrir el Libro 2 por re-empadronamiento (REG-28) hay un lapso en
   *  el que un socio vigente todavía no fue asentado. Figura igual, con un guión
   *  donde va el número — a un socio no se lo saca del padrón por un dato que
   *  falta. */
  memberNumber: number | null;
  fullName: string;
  category: MemberCategory;
  joinedAt: Date;
  arrears: number;
  debt: number | null;
};

export type ElectoralRoll = {
  at: Date;
  period: Period;
  /** Socios vigentes de categoría votante, ANTES del filtro de antigüedad. Con
   *  `withoutSeniority` cierra la cuenta que la pantalla imprime:
   *  `considered = withoutSeniority.length + enabled.length + toPurge.length`.
   *  Sin esos dos números, "157 habilitados" no se puede verificar y un socio
   *  que falta por un problema de datos desaparece sin que nadie lo note. */
  considered: number;
  /** Los que no llegan al piso de REG-30 (decisión del 27/08/2026: dejan de ser
   *  un contador y se listan con nombre — el contador decía que eran tres, no
   *  quiénes, ni si eran "demasiado nuevos" o un problema de datos). Llevan
   *  `arrears: 0, debt: null`: su mora NO se consulta — pagar no habilita, y la
   *  deuda de quien no vota es un dato sin finalidad (Ley 25.326). */
  withoutSeniority: ElectoralRow[];
  enabled: ElectoralRow[];
  toPurge: ElectoralRow[];
  purgeFees: number;
  purgeAmount: number;
};

/** El orden del padrón: el socio sin número del libro abierto primero, y el
 *  resto alfabético por `fullName` con criterio es-AR.
 *
 *  `localeCompare` con locale y no `<`: comparados por code unit, "Ñandú" cae
 *  después de "Zurita" y "Ávila" después de "Zurita" también — el apellido con
 *  eñe o con acento terminaría fuera de su letra, que en una mesa de votación se
 *  lee como "no está en el padrón". `es-AR` es el locale que ya usa el resto del
 *  panel (`activities/rules.ts`).
 *
 *  Desempate por número de socio: dos vecinos homónimos existen, y sin desempate
 *  su orden relativo cambiaría entre dos impresiones del mismo padrón. El `id`
 *  cierra el desempate: dos homónimos que ADEMÁS estén los dos sin número —el
 *  bloque de adelante, justo donde la anomalía se acumula— daban `0 - 0 = 0` y
 *  su orden volvía a depender de cómo los devolvió la consulta. El `id` es único
 *  y estable, así que la comparación es un orden total. */
export function compareForRoll(
  a: { id: number; memberNumber: number | null; fullName: string },
  b: { id: number; memberNumber: number | null; fullName: string },
): number {
  if ((a.memberNumber === null) !== (b.memberNumber === null)) {
    return a.memberNumber === null ? -1 : 1;
  }
  return (
    a.fullName.localeCompare(b.fullName, "es-AR") ||
    (a.memberNumber ?? 0) - (b.memberNumber ?? 0) ||
    a.id - b.id
  );
}

export async function buildElectoralRoll(
  db: Pick<PrismaClient, "member" | "fee">,
  at: Date,
  feeValue: FeeValueAmounts | null,
): Promise<ElectoralRoll> {
  // Se consulta desde MEMBER y no desde Membership, igual que `fetchDebtors`: el
  // número de socio es un dato DEL padrón, no su llave. Con la consulta al revés,
  // un socio vigente sin fila en el libro abierto —el lapso de un
  // re-empadronamiento, REG-28— no aparecía en ningún bloque y la pantalla no
  // tenía cómo decirlo. Un socio que falta indebidamente es un derecho político
  // negado, y ése era el único camino por el que podía faltar en silencio.
  //
  // Sólo socios `active`: el `withdrawn` no es socio, y el `suspended` NO vota
  // —la suspensión es disciplinaria y suspende también el voto— por decisión del
  // operador del 23/08/2026 (spec §13, decisión 9), que cerró la pregunta que el
  // estatuto no resuelve expresamente.
  const members = await db.member.findMany({
    where: { status: "active", category: { in: [...ELECTORAL_CATEGORIES] } },
    select: {
      id: true,
      fullName: true,
      category: true,
      joinedAt: true,
      // Del libro ABIERTO: el número de un libro cerrado es historia y no es el
      // que figura en el padrón de hoy (mismo criterio que `fetchDebtors`).
      memberships: { select: { memberNumber: true, book: { select: { status: true } } } },
    },
    orderBy: { fullName: "asc" },
  });
  // ALFABÉTICO POR APELLIDO, que es como se usa en la mesa: llega un vecino y se
  // lo busca por apellido (decisión del operador del 24/08/2026, spec §13
  // decisión 11). Con 160 filas, el orden por número obligaba a recorrer la hoja
  // entera al que no se trae su número de memoria — y nadie se lo trae.
  //
  // `fullName` viene en formato "Apellido Nombre" (así lo asentó el import del
  // Libro N° 1), así que ordenar por el campo entero ES ordenar por apellido.
  //
  // El que NO tiene número de libro abierto queda PRIMERO igual, fuera del orden
  // alfabético: es una anomalía de datos y tiene que saltar a la vista en la
  // primera hoja, no esconderse a mitad de la segunda.
  const rows = members
    .map((m) => ({
      ...m,
      memberNumber: m.memberships.find((ms) => ms.book.status === "open")?.memberNumber ?? null,
    }))
    .sort(compareForRoll);

  const eligible: typeof rows = [];
  const tooNew: typeof rows = [];
  for (const r of rows) (meetsSeniority(r.category, r.joinedAt, at) ? eligible : tooNew).push(r);
  const period = periodOf(at);
  const ids = eligible.map((r) => r.id);

  // La mora A LA FECHA: pendientes de períodos anteriores al mes de la elección.
  // `Fee.period` es Char(7) "YYYY-MM", que ordena lexicográficamente igual que
  // en el tiempo, así que el `lt` es una comparación de texto barata.
  const groups =
    ids.length === 0
      ? []
      : await db.fee.groupBy({
          by: ["memberId"],
          where: { memberId: { in: ids }, status: "pending", period: { lt: period } },
          _count: { _all: true },
        });
  const arrearsBy = new Map(groups.map((g) => [g.memberId, g._count._all]));

  const enabled: ElectoralRow[] = [];
  const toPurge: ElectoralRow[] = [];
  for (const r of eligible) {
    const arrears = arrearsBy.get(r.id) ?? 0;
    const row: ElectoralRow = {
      memberId: r.id,
      memberNumber: r.memberNumber,
      fullName: r.fullName,
      category: r.category,
      joinedAt: r.joinedAt,
      arrears,
      debt: feeValue ? debtAmount(arrears, r.category, feeValue) : null,
    };
    (mustPurgeToVote(r.category, arrears) ? toPurge : enabled).push(row);
  }

  return {
    at,
    period,
    considered: rows.length,
    withoutSeniority: tooNew.map((r) => ({
      memberId: r.id,
      memberNumber: r.memberNumber,
      fullName: r.fullName,
      category: r.category,
      joinedAt: r.joinedAt,
      arrears: 0,
      debt: null,
    })),
    enabled,
    toPurge,
    purgeFees: toPurge.reduce((a, r) => a + r.arrears, 0),
    purgeAmount: toPurge.reduce((a, r) => a + (r.debt ?? 0), 0),
  };
}
