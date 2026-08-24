// Padrón electoral (REG-31, docs/02:155-158) con la enmienda del operador del
// 23/08/2026.
//
// La enmienda: el Código Civil y Comercial deja al moroso purgar su deuda hasta
// una hora antes del acto, así que el padrón NO lo excluye — lo LISTA aparte,
// con cuántas cuotas y cuánto tiene que pagar en la mesa para votar. Por eso son
// dos bloques y no una lista filtrada.
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
// Prisma inyectado; la fecha es un PARÁMETRO (docs/02:157), nunca el reloj.
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

/** REG-30 (docs/02:153-154) exime del piso de 90 días a honorarios y vitalicios.
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
   *  `considered = withoutSeniority + enabled + toPurge`. Sin esos dos números,
   *  "157 habilitados" no se puede verificar y un socio que falta por un problema
   *  de datos desaparece sin que nadie lo note. */
  considered: number;
  withoutSeniority: number;
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

  const eligible = rows.filter((r) => meetsSeniority(r.category, r.joinedAt, at));
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
    // La exigencia de estar sin mora es SÓLO para activos y colaboradores: el
    // aporte del adherente es voluntario y su deuda no le quita el voto.
    const owes = arrears > 0 && ACCRUING_CATEGORIES.includes(r.category);
    (owes ? toPurge : enabled).push(row);
  }

  return {
    at,
    period,
    considered: rows.length,
    withoutSeniority: rows.length - eligible.length,
    enabled,
    toPurge,
    purgeFees: toPurge.reduce((a, r) => a + r.arrears, 0),
    purgeAmount: toPurge.reduce((a, r) => a + (r.debt ?? 0), 0),
  };
}

const CSV_HEADER = "bloque,numero_socio,apellido_nombre,categoria,cuotas_adeudadas,monto_a_purgar";

/** Excel trata como FÓRMULA a toda celda que arranque con uno de estos cuatro,
 *  aunque venga entrecomillada. Un nombre cargado como "=Pérez" se convierte en
 *  un `#NAME?` en la hoja de la Junta Electoral, y con la función equivocada en
 *  algo peor. El apóstrofo inicial es la neutralización estándar: Excel lo come
 *  al mostrar y la celda queda como texto. */
const FORMULA_LEAD = /^[=+\-@]/;

/** Comillas dobles siempre: los apellidos con coma ("Pizarro, Francisco" es el
 *  formato del catálogo de calles y aparece igual en nombres cargados a mano)
 *  parten la fila en dos. La comilla interna se duplica, como manda el RFC. */
function cell(value: string | number | null): string {
  const s = value === null ? "" : String(value);
  const safe = FORMULA_LEAD.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** Las columnas de REG-31 (docs/02:158) y nada más: nombre, número de socio y
 *  categoría. **Sin DNI**, que es el dato más sensible del padrón y no hace
 *  falta para tomar lista en una mesa donde los vecinos se conocen.
 *
 *  Las dos columnas de plata salen en blanco para el bloque de habilitados, y no
 *  es cosmético: para un activo o un colaborador habilitado valen cero por
 *  definición, y para un adherente moroso —que vota igual— son un dato
 *  financiero personal que la Junta Electoral no necesita para nada y que en
 *  papel ya no vuelve (Ley 25.326, principio de pertinencia).
 *
 *  El orden es el mismo de la hoja —alfabético por apellido, con el socio sin
 *  número adelante—: el CSV no es otro documento, es el mismo en otro formato, y
 *  quien lo abre al lado de la impresión tiene que ver las mismas filas en el
 *  mismo lugar. */
export function electoralCsv(roll: ElectoralRoll): string {
  const line = (block: string, r: ElectoralRow, withDebt: boolean) =>
    [
      cell(block),
      cell(r.memberNumber),
      cell(r.fullName),
      cell(r.category),
      cell(withDebt ? r.arrears : ""),
      cell(withDebt ? r.debt : ""),
    ].join(",");
  // CRLF y salto final, como pide el RFC 4180. No es formalismo: los importadores
  // viejos de Excel se comen la última fila de un archivo que no termina en salto.
  return (
    [
      CSV_HEADER,
      ...roll.enabled.map((r) => line("habilitado", r, false)),
      ...roll.toPurge.map((r) => line("a_purgar", r, true)),
    ].join("\r\n") + "\r\n"
  );
}
