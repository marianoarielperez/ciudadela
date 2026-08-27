// Exención de cuota (Art. 7 inc. a.4): el DOMINIO.
//
// Qué se fija acá, y por qué cada cosa vale la pena:
//
//   - Las reglas puras del rango (24 meses, cruce de año, meses restantes) y
//     `isInForce`, que incluye a la exención POR COMENZAR: el "no entra ni un
//     peso" rige desde el asiento, no desde el primer mes eximido (spec §3.1).
//   - Las SEIS guardas del asiento, una por caso. Se revalidan dentro de la
//     transacción porque la pantalla pre-valida para el mensaje, nunca como
//     única defensa.
//   - Las dos carreras con el cron de devengo del día 1: la que se ve en la
//     lectura previa y la que revienta contra el unique. Las dos tienen que
//     volver como "reintentá" y no escribir NADA — una cuota `pending` parada
//     adentro de un rango eximido es deuda que el vecino no debe.
//   - El cerrojo de la anulación y la precisión quirúrgica de su `deleteMany`:
//     el mes corriente y los pasados quedan exentos (decisión 9), y una cuota
//     de otro origen, de otro socio o fuera del rango no se toca.
//
// Deps FAKES: acá no hay base. `@/lib/prisma` se mockea porque el módulo
// exporta también su singleton (mismo criterio que `board-notice`).
import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import type {
  FeeOrigin, FeeStatus, MemberCategory, MemberStatus, MinuteType,
} from "@/generated/prisma/client";
import { fetchDebtors } from "@/lib/treasury/debtors";
import {
  activeExemption,
  exemptionPeriods,
  exemptionToPeriod,
  isInForce,
  makeExemptions,
  MAX_EXEMPTION_MONTHS,
  monthsLeft,
} from "@/lib/treasury/exemptions";
import { periodsToAccrue } from "@/lib/treasury/rules";

/** 15/09/2026 09:00 en Argentina. El período corriente de todos los casos es
 *  "2026-09"; el mediodía UTC evita el borde de las 21:00, donde UTC ya está en
 *  el día siguiente. */
const NOW = new Date("2026-09-15T12:00:00Z");
const CURRENT = "2026-09";

// ─────────────────────────────────────────────────────────────────────────────
// El doble de base
// ─────────────────────────────────────────────────────────────────────────────

type MemberRow = {
  id: number;
  fullName: string;
  category: MemberCategory;
  status: MemberStatus;
  memberNumber: number | null;
};
type FeeRow = { memberId: number; period: string; status: FeeStatus; origin: FeeOrigin };
type SubRow = { memberId: number | null; status: string };
// El `type` no está de adorno: la referencia de un acta es el par tipo+número
// (`@@unique([type, number])`), y es lo que las pantallas y el aviso del
// operador nombran desde que se dejó de mostrar el `id`.
type MinuteRow = { id: number; type: MinuteType; number: number; date: Date };
type ExemptionRow = {
  id: number;
  memberId: number;
  fromPeriod: string;
  toPeriod: string;
  months: number;
  minuteId: number;
  note: string | null;
  createdById: number | null;
  revokedAt: Date | null;
  revokeMinuteId: number | null;
  createdAt: Date;
};

type World = {
  members: MemberRow[];
  fees: FeeRow[];
  subs: SubRow[];
  minutes: MinuteRow[];
  exemptions: ExemptionRow[];
  movements: Array<Record<string, unknown>>;
  /** La CARRERA con el cron de devengo, simulada: la fila `pending` aparece en
   *  el punto exacto en que el cron podría haberla insertado. Los dos puntos
   *  tienen salidas distintas en producción (la lectura previa la ve; el
   *  `createMany` choca contra el unique) y por eso se pueden elegir. */
  race?: { at: "fee.findMany" | "fee.createMany"; row: FeeRow };
};

/** Los operadores de `where` que este doble sabe aplicar. Cualquier otro es un
 *  error del TEST, no del código: un doble que ignora en silencio una cláusula
 *  que no entiende deja de ser un guardián — que es justo el vicio que el M6
 *  cazó tres veces. */
const OPERATORS = new Set(["in", "not", "gt", "gte", "lt", "lte"]);

/** Comparación de orden. "YYYY-MM" con cero a la izquierda ordena
 *  lexicográficamente igual que en el tiempo (el criterio de `comparePeriods`),
 *  así que un `gte` sobre períodos es una comparación de strings. */
function compareValues(a: unknown, b: unknown): number {
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === "string" && typeof b === "string") return a < b ? -1 : a > b ? 1 : 0;
  if (typeof a === "number" && typeof b === "number") return a - b;
  throw new Error(`El doble no sabe comparar ${typeof a} con ${typeof b}.`);
}

function matchesValue(actual: unknown, expected: unknown): boolean {
  // Dos `Date` distintas con el mismo instante son la misma fecha; el `===`
  // diría que no.
  if (expected instanceof Date) {
    return actual instanceof Date && actual.getTime() === expected.getTime();
  }
  // `null` en el `where` es "esta columna está vacía", no "es exactamente
  // null": una fila del doble puede no llevar la clave.
  if (expected === null) return actual === null || actual === undefined;
  if (typeof expected === "object") {
    const ops = Object.keys(expected as object);
    // Filtro de RELACIÓN (`member: { status: … }`, el `where` del groupBy de
    // deudores): ninguna clave es un operador y del otro lado hay un objeto. Se
    // resuelve con el mismo `matchesWhere`, así que la cláusula anidada tampoco
    // se da por supuesta. Si la fila no trae la relación, cae al `throw` de
    // abajo — que es lo correcto: el test se olvidó de sembrarla.
    if (
      ops.every((o) => !OPERATORS.has(o)) &&
      typeof actual === "object" &&
      actual !== null &&
      !(actual instanceof Date)
    ) {
      return matchesWhere(actual as Record<string, unknown>, expected as Record<string, unknown>);
    }
    const unknown = ops.filter((o) => !OPERATORS.has(o));
    if (unknown.length > 0) {
      throw new Error(
        `El doble de base no entiende el operador ${unknown.join(", ")}: agregalo antes de usarlo, ` +
          "o esta cláusula del `where` real quedaría sin probar.",
      );
    }
    return ops.every((op) => {
      const value = (expected as Record<string, unknown>)[op];
      switch (op) {
        case "in":
          return (value as unknown[]).includes(actual);
        case "not":
          return !matchesValue(actual, value);
        case "gt":
          return compareValues(actual, value) > 0;
        case "gte":
          return compareValues(actual, value) >= 0;
        case "lt":
          return compareValues(actual, value) < 0;
        default:
          return compareValues(actual, value) <= 0;
      }
    });
  }
  return actual === expected;
}

/** Aplica un `where` LITERALMENTE contra una fila: cada clave que llega se
 *  compara, y ninguna se da por supuesta.
 *
 *  Calcado de `tests/board-notice.test.ts` y extendido con los operadores de
 *  orden, que son los que este módulo usa de verdad: el `toPeriod: { gte }` de
 *  "vigente" y el `period: { gt, gte, lte }` de la anulación. Sin la extensión
 *  el doble los ignoraría en silencio y la anulación "pasaría" borrando meses
 *  que tenía que dejar exentos. */
function matchesWhere(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (key === "OR") {
      return (expected as Array<Record<string, unknown>>).some((w) => matchesWhere(row, w));
    }
    return matchesValue(row[key], expected);
  });
}

type OrderBy = Record<string, "asc" | "desc">;

function applyOrder<T extends Record<string, unknown>>(rows: T[], orderBy?: OrderBy | OrderBy[]): T[] {
  if (!orderBy) return rows;
  const keys = Array.isArray(orderBy) ? orderBy : [orderBy];
  return [...rows].sort((a, b) => {
    for (const clause of keys) {
      for (const [field, dir] of Object.entries(clause)) {
        const c = compareValues(a[field], b[field]);
        if (c !== 0) return dir === "desc" ? -c : c;
      }
    }
    return 0;
  });
}

function uniqueViolation(): Error {
  // Con `@prisma/adapter-mariadb` `meta.target` no existe; el código sí. El
  // dominio se apoya en `code` a propósito (la lección de la 4C).
  return Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
}

/** La fila con las relaciones QUE EL `select` PIDIÓ, resueltas contra el mundo y
 *  no inventadas: el socio, el acta que respalda la exención y —si la anularon—
 *  la de la anulación.
 *
 *  Se mira el `select` de verdad, y ahí está la gracia: un doble que adjunta
 *  siempre las tres deja el `select` de producción sin probar, y borrarle el
 *  `minute` dejaría la suite en verde mientras las pantallas se quedan sin acta
 *  que nombrar (la lección del M6: el doble tiene que honrar lo que recibe).
 *  Si una fila apuntara a un acta que el mundo no tiene, la relación viene
 *  `null` y el `toRecord` de producción la muestra como tal: el doble no la
 *  fabrica para taparlo. */
function withRelations(world: World, row: ExemptionRow, select?: Record<string, unknown>) {
  const minute = (id: number | null) => {
    const found = id === null ? undefined : world.minutes.find((x) => x.id === id);
    return found ? { type: found.type, number: found.number } : null;
  };
  const out: Record<string, unknown> = { ...row };
  if (select?.minute) out.minute = minute(row.minuteId);
  if (select?.revokeMinute) out.revokeMinute = minute(row.revokeMinuteId);
  if (select?.member) {
    const m = world.members.find((x) => x.id === row.memberId);
    out.member = {
      fullName: m?.fullName ?? "",
      memberships: m && m.memberNumber !== null ? [{ memberNumber: m.memberNumber }] : [],
    };
  }
  return out;
}

function fakeDb(world: World) {
  let raceFired = false;
  const fireRace = (at: "fee.findMany" | "fee.createMany") => {
    if (world.race && !raceFired && world.race.at === at) {
      raceFired = true;
      world.fees.push({ ...world.race.row });
    }
  };

  const tx = {
    member: {
      findUnique: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        world.members.find((m) => matchesWhere(m, where)) ?? null,
      ),
    },
    minute: {
      findUnique: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        world.minutes.find((m) => matchesWhere(m, where)) ?? null,
      ),
    },
    fee: {
      count: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        world.fees.filter((f) => matchesWhere(f, where)).length,
      ),
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        fireRace("fee.findMany");
        return world.fees.filter((f) => matchesWhere(f, where));
      }),
      createMany: vi.fn(
        async (args: { data: FeeRow[]; skipDuplicates?: boolean }) => {
          // EL `skipDuplicates` SE PRUEBA ACÁ, por su ausencia. Si el dominio lo
          // agregara, la carrera con el devengo dejaría una cuota `pending`
          // parada adentro de un rango eximido y nadie se enteraría: el silencio
          // es exactamente lo que no se quiere.
          if (args.skipDuplicates) {
            throw new Error(
              "`skipDuplicates` en las cuotas exentas taparía la carrera con el devengo: " +
                "la lectura previa es la decisión, no el silencio.",
            );
          }
          fireRace("fee.createMany");
          for (const row of args.data) {
            if (world.fees.some((f) => f.memberId === row.memberId && f.period === row.period)) {
              throw uniqueViolation();
            }
            world.fees.push({ ...row });
          }
          return { count: args.data.length };
        },
      ),
      deleteMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        // LA PRECISIÓN DE LA ANULACIÓN SE PRUEBA ACÁ. El `where` viaja tal cual:
        // si de producción desapareciera el `origin: "exemption"`, el `status`
        // o cualquiera de los tres operadores del período, esta línea borraría
        // filas que no le corresponden y los tests se pondrían rojos.
        const hits = world.fees.filter((f) => matchesWhere(f, where));
        world.fees = world.fees.filter((f) => !hits.includes(f));
        return { count: hits.length };
      }),
    },
    mpSubscription: {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        world.subs.filter((s) => matchesWhere(s, where)),
      ),
    },
    feeExemption: {
      findUnique: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        world.exemptions.find((e) => matchesWhere(e, where)) ?? null,
      ),
      findFirst: vi.fn(
        async (
          { where, orderBy, select }:
            { where: Record<string, unknown>; orderBy?: OrderBy | OrderBy[]; select?: Record<string, unknown> },
        ) => {
          const hit = applyOrder(world.exemptions.filter((e) => matchesWhere(e, where)), orderBy)[0];
          // Con las relaciones que el `select` pida: `activeExemption` pide el
          // acta ahí mismo, y los cinco bloqueos la nombran en su mensaje.
          return hit ? withRelations(world, hit, select) : null;
        },
      ),
      findMany: vi.fn(
        async (
          { where, orderBy, select }:
            { where: Record<string, unknown>; orderBy?: OrderBy | OrderBy[]; select?: Record<string, unknown> },
        ) =>
          applyOrder(world.exemptions.filter((e) => matchesWhere(e, where)), orderBy).map((e) =>
            withRelations(world, e, select),
          ),
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: Math.max(0, ...world.exemptions.map((e) => e.id)) + 1,
          revokedAt: null,
          revokeMinuteId: null,
          createdAt: NOW,
          note: null,
          createdById: null,
          ...data,
        } as ExemptionRow;
        world.exemptions.push(row);
        return row;
      }),
      updateMany: vi.fn(
        async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          // EL CERROJO SE PRUEBA ACÁ. La fila se busca con el `where` que manda
          // producción y con nada más: si de allá desaparece el
          // `revokedAt: null`, esta línea encuentra igual la exención ya anulada,
          // la pisa, y el test de la doble anulación se pone rojo.
          const hits = world.exemptions.filter((e) => matchesWhere(e, where));
          for (const hit of hits) Object.assign(hit, data);
          return { count: hits.length };
        },
      ),
    },
    movement: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        world.movements.push(data);
        return { id: world.movements.length, ...data };
      }),
    },
  };

  const db = {
    // EL "TODO ADENTRO DE LA TRANSACCIÓN" SE PRUEBA ACÁ, por lo que este objeto
    // NO tiene. Si `db` copiara los modelos de `tx`, reescribir una guarda de
    // `tx.member` a `deps.db.member` dejaría la suite en verde y las seis
    // dejarían de correr bajo el mismo lock. Acá cualquier `deps.db.<modelo>`
    // extraviado revienta con un TypeError.
    //
    // La ÚNICA lectura legítima fuera de la transacción es la de las dos
    // pestañas (`list`), y por eso se expone `feeExemption` con `findMany` y con
    // nada más: un `deps.db.feeExemption.findFirst` en una guarda tampoco pasa.
    feeExemption: { findMany: tx.feeExemption.findMany },
    // Transacción de mentira con ROLLBACK de verdad: sin esto, una carrera que
    // revienta a mitad de camino dejaría el mundo a medio escribir y el test no
    // podría afirmar que "no se guardó nada".
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => {
      const backup = {
        members: world.members.map((r) => ({ ...r })),
        fees: world.fees.map((r) => ({ ...r })),
        subs: world.subs.map((r) => ({ ...r })),
        minutes: world.minutes.map((r) => ({ ...r })),
        exemptions: world.exemptions.map((r) => ({ ...r })),
        movements: world.movements.map((r) => ({ ...r })),
      };
      try {
        return await fn(tx);
      } catch (e) {
        Object.assign(world, backup);
        throw e;
      }
    }),
  };
  return { db, tx };
}

// Los ids (7 y 8) y los números (12 y 13) se eligen DISTINTOS a propósito: si
// alguna pantalla o mensaje volviera a nombrar el acta por su `id`, los casos
// que fijan el texto se ponen rojos en vez de coincidir por casualidad.
const MINUTE: MinuteRow = { id: 7, type: "board", number: 12, date: new Date("2026-09-10T15:00:00Z") };
const REVOKE_MINUTE: MinuteRow = { id: 8, type: "board", number: 13, date: new Date("2026-09-20T15:00:00Z") };

function world(over: Partial<World> = {}): World {
  return {
    members: [
      { id: 1, fullName: "Pérez, Juan", category: "active", status: "active", memberNumber: 42 },
    ],
    fees: [],
    subs: [],
    minutes: [MINUTE, REVOKE_MINUTE],
    exemptions: [],
    movements: [],
    ...over,
  };
}

function service(w: World) {
  const { db, tx } = fakeDb(w);
  return { svc: makeExemptions({ db: db as never, now: () => NOW }), db, tx };
}

const GRANT = { memberId: 1, fromPeriod: "2026-10", months: 12, minuteId: 7, note: null, actorId: 3 };

// ─────────────────────────────────────────────────────────────────────────────

describe("reglas puras del rango", () => {
  it("el tope del artículo son 24 meses", () => {
    expect(MAX_EXEMPTION_MONTHS).toBe(24);
  });

  it("24 meses desde septiembre de 2026 terminan en agosto de 2028", () => {
    const periods = exemptionPeriods("2026-09", 24);
    expect(periods).toHaveLength(24);
    expect(periods[0]).toBe("2026-09");
    expect(periods[23]).toBe("2028-08");
    expect(exemptionToPeriod("2026-09", 24)).toBe("2028-08");
    // El cruce de año, que es donde una aritmética casera se rompe.
    expect(periods).toContain("2026-12");
    expect(periods).toContain("2027-01");
  });

  it("un mes es un solo período, y el último es inclusive", () => {
    expect(exemptionPeriods("2026-09", 1)).toEqual(["2026-09"]);
    expect(exemptionToPeriod("2026-09", 1)).toBe("2026-09");
    expect(exemptionPeriods("2026-12", 3)).toEqual(["2026-12", "2027-01", "2027-02"]);
  });

  it("monthsLeft cuenta el mes corriente y se planta en cero cuando venció", () => {
    // En el ÚLTIMO mes queda uno: el que se está cursando.
    expect(monthsLeft("2026-09", NOW)).toBe(1);
    expect(monthsLeft("2026-10", NOW)).toBe(2);
    expect(monthsLeft("2028-08", NOW)).toBe(24);
    // Vencida: no devuelve negativos, que en una pantalla se leerían como
    // "faltan -3 meses".
    expect(monthsLeft("2026-08", NOW)).toBe(0);
    expect(monthsLeft("2025-01", NOW)).toBe(0);
  });
});

describe("isInForce", () => {
  it("la del mes corriente todavía rige", () => {
    expect(isInForce({ revokedAt: null, toPeriod: CURRENT }, NOW)).toBe(true);
  });

  it("la que terminó el mes pasado, no", () => {
    expect(isInForce({ revokedAt: null, toPeriod: "2026-08" }, NOW)).toBe(false);
  });

  it("la anulada, no — aunque su rango siga corriendo", () => {
    expect(isInForce({ revokedAt: NOW, toPeriod: "2027-12" }, NOW)).toBe(false);
  });

  it("la que todavía NO empezó SÍ rige: el bloqueo de pagos corre desde el asiento", () => {
    // Spec §3.1: "no entra ni un peso" rige desde que la Comisión lo decidió,
    // no desde el primer mes eximido. Si esto diera `false`, un eximido con
    // exención asentada para octubre podría pagar en septiembre.
    expect(isInForce({ revokedAt: null, toPeriod: "2027-09" }, NOW)).toBe(true);
  });
});

describe("activeExemption", () => {
  const row = (over: Partial<ExemptionRow> = {}): ExemptionRow => ({
    id: 1, memberId: 1, fromPeriod: "2026-09", toPeriod: "2027-08", months: 12,
    minuteId: 7, note: null, createdById: 3, revokedAt: null, revokeMinuteId: null,
    createdAt: NOW, ...over,
  });

  // Se lee por `tx` y no por `db`: `activeExemption` acepta cualquier handle con
  // `feeExemption`, y la guarda 4 del asiento la llama justamente con el de la
  // transacción.
  it("devuelve la vigente con lo que las pantallas necesitan", async () => {
    const w = world({ exemptions: [row()] });
    const { tx } = fakeDb(w);
    const found = await activeExemption(tx as never, 1, NOW);
    expect(found).toMatchObject({ id: 1, fromPeriod: "2026-09", toPeriod: "2027-08", months: 12, minuteId: 7 });
    // El ACTA viaja con la fila: el `minuteId` es a dónde lleva el enlace, y el
    // par tipo+número es lo que las cinco bocas del bloqueo tienen que decir.
    // Pedirla aparte en cada pantalla era una consulta de más y cinco formas
    // distintas de nombrar el mismo documento.
    expect(found?.minute).toEqual({ type: "board", number: 12 });
  });

  it("no devuelve la anulada ni la vencida", async () => {
    for (const over of [{ revokedAt: NOW }, { toPeriod: "2026-08" }]) {
      const { tx } = fakeDb(world({ exemptions: [row(over)] }));
      expect(await activeExemption(tx as never, 1, NOW)).toBeNull();
    }
  });

  it("devuelve la que todavía no empezó", async () => {
    const { tx } = fakeDb(world({ exemptions: [row({ fromPeriod: "2026-11", toPeriod: "2027-10" })] }));
    expect(await activeExemption(tx as never, 1, NOW)).not.toBeNull();
  });

  it("no devuelve la de otro socio", async () => {
    const { tx } = fakeDb(world({ exemptions: [row({ memberId: 2 })] }));
    expect(await activeExemption(tx as never, 1, NOW)).toBeNull();
  });
});

describe("grant — las seis guardas", () => {
  it("guarda 1: la categoría del artículo es ACTIVO", async () => {
    for (const category of ["adherent", "collaborator", "cadet"] as MemberCategory[]) {
      const w = world({ members: [{ id: 1, fullName: "X", category, status: "active", memberNumber: 1 }] });
      const { svc } = service(w);
      const r = await svc.grant(GRANT);
      expect(r.ok).toBe(false);
      expect(r.ok === false && r.error).toContain("activos");
      expect(w.exemptions).toHaveLength(0);
      expect(w.fees).toHaveLength(0);
      expect(w.movements).toHaveLength(0);
    }
  });

  it("guarda 1: un suspendido no se exime (la suspensión es disciplinaria)", async () => {
    for (const status of ["suspended", "withdrawn"] as MemberStatus[]) {
      const w = world({ members: [{ id: 1, fullName: "X", category: "active", status, memberNumber: 1 }] });
      const r = await service(w).svc.grant(GRANT);
      expect(r.ok).toBe(false);
      expect(r.ok === false && r.error).toContain("vigente");
    }
  });

  it("guarda 1: un socio que no existe no rompe", async () => {
    const r = await service(world()).svc.grant({ ...GRANT, memberId: 99 });
    expect(r.ok).toBe(false);
  });

  it("guarda 2: las cuotas pendientes cortan, y el mensaje dice CUÁNTAS", async () => {
    const w = world({
      fees: [
        { memberId: 1, period: "2026-07", status: "pending", origin: "accrual" },
        { memberId: 1, period: "2026-08", status: "pending", origin: "accrual" },
      ],
    });
    const r = await service(w).svc.grant(GRANT);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain("2");
    expect(w.exemptions).toHaveLength(0);
  });

  it("guarda 2: una cuota PAGA vieja no es deuda y no molesta", async () => {
    const w = world({ fees: [{ memberId: 1, period: "2026-08", status: "paid", origin: "accrual" }] });
    expect((await service(w).svc.grant(GRANT)).ok).toBe(true);
  });

  it("guarda 3: cualquier suscripción que TODAVÍA pueda cobrar corta el asiento", async () => {
    for (const status of ["authorized", "pending", "paused"]) {
      const w = world({ subs: [{ memberId: 1, status }] });
      const r = await service(w).svc.grant(GRANT);
      expect(r.ok).toBe(false);
      expect(r.ok === false && r.error).toContain("débito");
      expect(w.exemptions).toHaveLength(0);
    }
  });

  it("guarda 3: una suscripción CANCELADA no impide nada", async () => {
    const w = world({ subs: [{ memberId: 1, status: "cancelled" }] });
    expect((await service(w).svc.grant(GRANT)).ok).toBe(true);
  });

  it("guarda 3: la suscripción de OTRO socio no impide nada", async () => {
    const w = world({ subs: [{ memberId: 2, status: "authorized" }] });
    expect((await service(w).svc.grant(GRANT)).ok).toBe(true);
  });

  it("guarda 4: no se apila otra exención vigente, ni siquiera una POR COMENZAR", async () => {
    for (const [fromPeriod, toPeriod] of [["2026-09", "2027-02"], ["2026-11", "2027-10"]]) {
      const w = world({
        exemptions: [{
          id: 5, memberId: 1, fromPeriod, toPeriod, months: 6, minuteId: 7, note: null,
          createdById: 3, revokedAt: null, revokeMinuteId: null, createdAt: NOW,
        }],
      });
      const r = await service(w).svc.grant(GRANT);
      expect(r.ok).toBe(false);
      expect(r.ok === false && r.error).toContain("vigente");
      expect(w.exemptions).toHaveLength(1);
    }
  });

  it("guarda 4: una VENCIDA o una ANULADA no bloquean la nueva (la renovación es un asiento nuevo)", async () => {
    const base = {
      id: 5, memberId: 1, fromPeriod: "2025-01", months: 6, minuteId: 7, note: null,
      createdById: 3, revokeMinuteId: null, createdAt: NOW,
    };
    for (const over of [
      { toPeriod: "2026-08", revokedAt: null },
      { toPeriod: "2027-08", revokedAt: NOW },
    ]) {
      const w = world({ exemptions: [{ ...base, ...over }] });
      expect((await service(w).svc.grant(GRANT)).ok).toBe(true);
    }
  });

  it("guarda 5: el rango es de 1 a 24 meses enteros", async () => {
    for (const months of [0, -1, 25, 100, 2.5]) {
      const w = world();
      const r = await service(w).svc.grant({ ...GRANT, months });
      expect(r.ok).toBe(false);
      expect(r.ok === false && r.error).toContain("24");
      expect(w.fees).toHaveLength(0);
    }
  });

  it("guarda 5: la exención no empieza hacia atrás, pero el mes corriente vale", async () => {
    const past = await service(world()).svc.grant({ ...GRANT, fromPeriod: "2026-08" });
    expect(past.ok).toBe(false);
    expect(past.ok === false && past.error).toContain("pasado");

    // El corriente SÍ: el devengo crea hasta el mes vencido, así que el mes en
    // curso no tiene fila salvo pago adelantado.
    expect((await service(world()).svc.grant({ ...GRANT, fromPeriod: CURRENT })).ok).toBe(true);
  });

  it("guarda 5: un mes de inicio con formato roto no llega a la base", async () => {
    const w = world();
    const r = await service(w).svc.grant({ ...GRANT, fromPeriod: "octubre" });
    expect(r.ok).toBe(false);
    // El mensaje EXACTO, como los hermanos: un `ok === false` a secas se pondría
    // verde también si cortara la guarda de la categoría o la del acta.
    expect(r.ok === false && r.error).toContain("AAAA-MM");
    expect(w.exemptions).toHaveLength(0);
    expect(w.fees).toHaveLength(0);
  });

  it("guarda 6: sin acta no hay asiento", async () => {
    const w = world();
    const r = await service(w).svc.grant({ ...GRANT, minuteId: 404 });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain("acta");
    expect(w.exemptions).toHaveLength(0);
  });
});

describe("grant — el asiento", () => {
  it("crea el registro, las N cuotas exentas y el movimiento con su acta", async () => {
    const w = world();
    const r = await service(w).svc.grant(GRANT);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.periods).toHaveLength(12);
    expect(r.periods[0]).toBe("2026-10");
    expect(r.periods[11]).toBe("2027-09");
    expect(r.skippedPaid).toEqual([]);

    // Las cuotas: todas del rango, todas exentas, todas con el origen nuevo
    // (de él depende que la anulación borre exactamente las suyas).
    expect(w.fees).toHaveLength(12);
    expect(w.fees.every((f) => f.status === "exempt" && f.origin === "exemption")).toBe(true);
    expect(w.fees.map((f) => f.period)).toEqual(r.periods);

    // El registro, con el rango cerrado y su acta.
    expect(w.exemptions).toHaveLength(1);
    expect(w.exemptions[0]).toMatchObject({
      memberId: 1, fromPeriod: "2026-10", toPeriod: "2027-09", months: 12, minuteId: 7,
      note: null, createdById: 3, revokedAt: null,
    });
    expect(r.exemptionId).toBe(w.exemptions[0].id);

    // El movimiento va FECHADO CON EL ACTA, no con el reloj: el historial de la
    // ficha tiene que leerse contra el libro de actas.
    expect(w.movements).toHaveLength(1);
    expect(w.movements[0]).toMatchObject({
      memberId: 1, type: "fee_exemption", date: MINUTE.date, minuteId: 7, createdById: 3,
    });
  });

  it("el detalle del movimiento no lleva un solo dato personal", async () => {
    const w = world();
    await service(w).svc.grant({ ...GRANT, note: "pintura de la sede" });
    // La nota es la contribución en especie que la Comisión valuó: llega tal cual
    // a la fila, que es de donde la leen las dos pestañas.
    expect(w.exemptions[0].note).toBe("pintura de la sede");
    const detail = String(w.movements[0].detail);
    expect(detail).not.toContain("Pérez");
    expect(detail).not.toContain("Juan");
    // Dice el rango en castellano y la cantidad de meses, que es lo que el
    // operador necesita leer en el historial.
    expect(detail).toContain("octubre 2026");
    expect(detail).toContain("septiembre 2027");
    expect(detail).toContain("12 meses");
  });

  it("un mes YA PAGO del medio queda pago y se informa: el rango del acta no se corre", async () => {
    // Decisión 11 del operador: la plata que ya entró no se devuelve ni se
    // convierte en exenta, y el rango calendario del acta sigue siendo el que
    // la Comisión votó.
    const w = world({ fees: [{ memberId: 1, period: "2027-01", status: "paid", origin: "accrual" }] });
    const r = await service(w).svc.grant(GRANT);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.skippedPaid).toEqual(["2027-01"]);
    expect(r.periods).toHaveLength(12); // el rango NO se corre
    expect(w.exemptions[0].toPeriod).toBe("2027-09");

    const paid = w.fees.find((f) => f.period === "2027-01");
    expect(paid).toMatchObject({ status: "paid", origin: "accrual" });
    expect(w.fees.filter((f) => f.status === "exempt")).toHaveLength(11);
  });

  it("una exenta que ya estaba en el rango no se duplica ni rompe", async () => {
    // Pasa de verdad: anular una exención deja el mes CORRIENTE exento, y la
    // Comisión puede asentar una nueva desde ese mismo mes.
    const w = world({ fees: [{ memberId: 1, period: CURRENT, status: "exempt", origin: "exemption" }] });
    const r = await service(w).svc.grant({ ...GRANT, fromPeriod: CURRENT, months: 3 });
    expect(r.ok).toBe(true);
    expect(w.fees).toHaveLength(3);
    expect(w.fees.every((f) => f.status === "exempt")).toBe(true);
  });
});

describe("grant — la carrera con el cron de devengo", () => {
  const RETRY = "reintent";

  it("una `pending` que aparece en la lectura previa vuelve como reintento, no como silencio", async () => {
    const w = world({
      race: { at: "fee.findMany", row: { memberId: 1, period: "2026-10", status: "pending", origin: "accrual" } },
    });
    const r = await service(w).svc.grant(GRANT);

    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error.toLowerCase()).toContain(RETRY);
    // Y NADA se escribió: una exención asentada con una cuota `pending` adentro
    // del rango sería deuda que el vecino no debe.
    expect(w.exemptions).toHaveLength(0);
    expect(w.movements).toHaveLength(0);
    expect(w.fees.filter((f) => f.status === "exempt")).toHaveLength(0);
  });

  it("la que se cuela DESPUÉS de la lectura choca contra el unique y hace rollback", async () => {
    // Ésta es la razón de que el `createMany` vaya SIN `skipDuplicates`: con él,
    // el INSERT pasaría de largo y la cuota `pending` quedaría parada adentro
    // del rango eximido, sin ninguna señal.
    const w = world({
      race: { at: "fee.createMany", row: { memberId: 1, period: "2026-11", status: "pending", origin: "accrual" } },
    });
    const r = await service(w).svc.grant(GRANT);

    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error.toLowerCase()).toContain(RETRY);
    expect(w.exemptions).toHaveLength(0);
    expect(w.movements).toHaveLength(0);
    expect(w.fees.filter((f) => f.status === "exempt")).toHaveLength(0);
  });
});

describe("revoke", () => {
  function granted(over: Partial<ExemptionRow> = {}, fees?: FeeRow[]): World {
    const from = over.fromPeriod ?? CURRENT;
    const to = over.toPeriod ?? "2027-08";
    return world({
      exemptions: [{
        id: 5, memberId: 1, fromPeriod: from, toPeriod: to, months: 12, minuteId: 7,
        note: null, createdById: 3, revokedAt: null, revokeMinuteId: null, createdAt: NOW, ...over,
      }],
      fees: fees ?? exemptionPeriods(from, 12).map((period) => ({
        memberId: 1, period, status: "exempt" as FeeStatus, origin: "exemption" as FeeOrigin,
      })),
    });
  }

  const REVOKE = { exemptionId: 5, revokeMinuteId: 8, actorId: 3 };

  it("anula con su acta, borra las FUTURAS y deja exentos el mes corriente y los pasados", async () => {
    const w = granted();
    const r = await service(w).svc.revoke(REVOKE);

    expect(r.ok).toBe(true);
    // Decisión 9: de septiembre (corriente) a agosto de 2027 son 12 meses; se
    // borran los 11 futuros y septiembre queda exento.
    expect(r.ok === true && r.removedFuture).toBe(11);
    expect(w.fees.map((f) => f.period)).toEqual([CURRENT]);
    expect(w.fees[0].status).toBe("exempt");

    expect(w.exemptions[0].revokedAt).toEqual(NOW);
    expect(w.exemptions[0].revokeMinuteId).toBe(8);

    expect(w.movements).toHaveLength(1);
    expect(w.movements[0]).toMatchObject({
      memberId: 1, type: "fee_exemption_revoked", date: REVOKE_MINUTE.date, minuteId: 8, createdById: 3,
    });
    expect(String(w.movements[0].detail)).not.toContain("Pérez");
  });

  it("la segunda anulación no pasa: el cerrojo la corta y no vuelve a tocar nada", async () => {
    const w = granted();
    const { svc } = service(w);

    expect((await svc.revoke(REVOKE)).ok).toBe(true);
    const firstRevokedAt = w.exemptions[0].revokedAt;
    const remaining = w.fees.length;

    const second = await svc.revoke({ ...REVOKE, revokeMinuteId: 7 });
    expect(second.ok).toBe(false);
    expect(second.ok === false && second.error).toContain("ya la anuló");
    // La fecha y el acta originales quedan intactas, y no se asienta un segundo
    // movimiento de anulación sobre el mismo hecho.
    expect(w.exemptions[0].revokedAt).toEqual(firstRevokedAt);
    expect(w.exemptions[0].revokeMinuteId).toBe(8);
    expect(w.fees).toHaveLength(remaining);
    expect(w.movements).toHaveLength(1);
  });

  it("borra SÓLO las exentas de ESTA exención: ni otro origen, ni otro estado, ni otro socio, ni fuera del rango", async () => {
    const w = granted({ fromPeriod: "2026-11", toPeriod: "2027-04", months: 6 }, [
      // Dentro del rango, del origen y del estado: ésta es la única que se va.
      { memberId: 1, period: "2026-12", status: "exempt", origin: "exemption" },
      // Mismo estado, OTRO origen: una exenta vieja del import no es de esta
      // exención y no se toca.
      { memberId: 1, period: "2027-01", status: "exempt", origin: "import" },
      // Mismo origen, OTRO estado: si alguna vez se cobrara adentro del rango,
      // la plata no se borra.
      { memberId: 1, period: "2027-02", status: "paid", origin: "exemption" },
      // Después del `toPeriod`.
      { memberId: 1, period: "2027-05", status: "exempt", origin: "exemption" },
      // Entre el mes corriente y el `fromPeriod`: sólo el `gte: fromPeriod` la
      // salva (el `gt: corriente` la dejaría pasar).
      { memberId: 1, period: "2026-10", status: "exempt", origin: "exemption" },
      // El mes corriente.
      { memberId: 1, period: CURRENT, status: "exempt", origin: "exemption" },
      // De OTRO socio, en pleno rango.
      { memberId: 2, period: "2026-12", status: "exempt", origin: "exemption" },
    ]);

    const r = await service(w).svc.revoke(REVOKE);
    expect(r.ok === true && r.removedFuture).toBe(1);
    expect(w.fees.map((f) => `${f.memberId}:${f.period}`)).toEqual([
      "1:2027-01", "1:2027-02", "1:2027-05", "1:2026-10", `1:${CURRENT}`, "2:2026-12",
    ]);
  });

  it("una exención que no existe no rompe", async () => {
    const w = granted();
    const r = await service(w).svc.revoke({ ...REVOKE, exemptionId: 404 });
    expect(r.ok).toBe(false);
    expect(w.exemptions[0].revokedAt).toBeNull();
  });

  it("sin acta de anulación no se anula nada", async () => {
    const w = granted();
    const r = await service(w).svc.revoke({ ...REVOKE, revokeMinuteId: 404 });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain("acta");
    expect(w.exemptions[0].revokedAt).toBeNull();
    expect(w.fees).toHaveLength(12);
  });
});

describe("listInForce e history", () => {
  const rows: ExemptionRow[] = [
    // Vigente en curso.
    { id: 1, memberId: 1, fromPeriod: "2026-09", toPeriod: "2027-08", months: 12, minuteId: 7,
      note: "pintura", createdById: 3, revokedAt: null, revokeMinuteId: null, createdAt: NOW },
    // Vigente por comenzar.
    { id: 2, memberId: 2, fromPeriod: "2026-11", toPeriod: "2027-10", months: 12, minuteId: 7,
      note: null, createdById: 3, revokedAt: null, revokeMinuteId: null, createdAt: NOW },
    // Vencida.
    { id: 3, memberId: 1, fromPeriod: "2025-01", toPeriod: "2026-08", months: 20, minuteId: 7,
      note: null, createdById: 3, revokedAt: null, revokeMinuteId: null, createdAt: NOW },
    // Anulada, con su segunda acta.
    { id: 4, memberId: 2, fromPeriod: "2026-01", toPeriod: "2027-12", months: 24, minuteId: 7,
      note: null, createdById: 3, revokedAt: NOW, revokeMinuteId: 8, createdAt: NOW },
  ];
  const w = () =>
    world({
      members: [
        { id: 1, fullName: "Pérez, Juan", category: "active", status: "active", memberNumber: 42 },
        { id: 2, fullName: "Gómez, Ana", category: "active", status: "active", memberNumber: null },
      ],
      exemptions: rows.map((r) => ({ ...r })),
    });

  it("las vigentes incluyen la que todavía no empezó, con el socio y su número", async () => {
    const list = await service(w()).svc.listInForce();
    expect(list.map((e) => e.id)).toEqual([1, 2]);
    expect(list[0].member).toEqual({ fullName: "Pérez, Juan", memberNumber: 42 });
    // Sin membresía en el libro abierto el número es `null`, no una excepción.
    expect(list[1].member.memberNumber).toBeNull();
  });

  it("el historial son las vencidas y las anuladas, con sus dos actas", async () => {
    const history = await service(w()).svc.history();
    expect(history.map((e) => e.id).sort()).toEqual([3, 4]);
    const revoked = history.find((e) => e.id === 4);
    expect(revoked?.minuteId).toBe(7);
    expect(revoked?.revokeMinuteId).toBe(8);
    expect(revoked?.revokedAt).toEqual(NOW);
    // Las DOS actas vienen nombradas, no numeradas por id: la tarjeta del
    // historial dice "Acta Comisión Directiva N° 12 · anulación: Acta Comisión
    // Directiva N° 13", que es como se las busca en el libro.
    expect(revoked?.minute).toEqual({ type: "board", number: 12 });
    expect(revoked?.revokeMinute).toEqual({ type: "board", number: 13 });
    // La que venció sola no tiene acta de anulación, y eso no es un hueco: es
    // la otra mitad del historial.
    expect(history.find((e) => e.id === 3)?.revokeMinute).toBeNull();
  });
});

describe("el núcleo trata `exempt` por OMISIÓN (invariante estructural)", () => {
  // POR QUÉ ESTE BLOQUE EXISTE. Todo el módulo se apoya en que el núcleo de
  // cuotas —que este módulo NO toca— ya trata bien una fila `exempt`, y lo hace
  // por omisión: el devengo la saltea porque su período ya está ocupado, y la
  // deuda no la ve porque pregunta por `status: "pending"` a secas. Son dos
  // garantías ESTRUCTURALES, no dos líneas de código que digan "exempt": un día
  // que alguien cambie el filtro de deudores a `status: { in: ["pending",
  // "paid"] }`, o que el devengo empiece a leer sólo las pendientes, el eximido
  // pasaría a deber los meses que la Comisión le perdonó y ninguna pantalla lo
  // diría. Estos casos son la chicharra.
  //
  // Los dos LLAMAN AL CÓDIGO DE PRODUCCIÓN de esos módulos —`periodsToAccrue` de
  // `rules.ts` y `fetchDebtors` de `debtors.ts`—, no a una copia de su `where`:
  // un pin que se afirma contra el doble del propio test no puede ponerse rojo
  // por ningún cambio en `src/`, que es exactamente lo que no se quiere de una
  // chicharra.
  it("el devengo no vuelve a crear un período que ya tiene fila exenta", () => {
    const member = { status: "active" as MemberStatus, category: "active" as MemberCategory,
      joinedAt: new Date("2020-03-15T12:00:00Z"), readmittedAt: null };
    // `existing` son TODOS los períodos que el socio ya tiene, con cualquier
    // estado: así es como el devengo lo arma (`fee.findMany` sin filtro de
    // estado), y por eso una exenta lo bloquea igual que una paga.
    const periods = periodsToAccrue(member, "2026-11", ["2026-09", "2026-10"]);
    expect(periods).not.toContain("2026-09");
    expect(periods).not.toContain("2026-10");
    expect(periods).toContain("2026-11");
  });

  // El doble de base de `fetchDebtors`, que es el OTRO módulo del núcleo que
  // este bloque fija. Honra el `where` real —incluido el filtro de relación
  // `member: { status: … }`— con el mismo `matchesWhere` que el resto del
  // archivo: si de `debtors.ts` desapareciera el `status: "pending"` a secas, las
  // exentas entrarían acá y los dos casos de abajo se pondrían rojos.
  function debtorsDb(w: World) {
    return {
      fee: {
        groupBy: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
          const rows = w.fees
            .map((f) => ({ ...f, member: w.members.find((m) => m.id === f.memberId) ?? null }))
            .filter((f) => matchesWhere(f, where));
          const counts = new Map<number, number>();
          for (const f of rows) counts.set(f.memberId, (counts.get(f.memberId) ?? 0) + 1);
          return [...counts].map(([memberId, n]) => ({ memberId, _count: { _all: n } }));
        }),
      },
      member: {
        findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
          w.members
            .filter((m) => matchesWhere(m, where))
            .map((m) => ({
              ...m,
              memberships:
                m.memberNumber === null ? [] : [{ memberNumber: m.memberNumber, book: { status: "open" } }],
              payments: [],
              street: null,
              streetText: null,
              streetNumber: null,
              phone: null,
              email: null,
              emailStatus: "none",
            })),
        ),
      },
    };
  }

  it("una cuota exenta no es deuda: `fetchDebtors` cuenta sólo la pendiente", async () => {
    // Se ejercita el módulo REAL (`@/lib/treasury/debtors`), no el doble: acá se
    // llama `fetchDebtors`, y el `where` que decide es el de producción.
    const w = world({
      fees: [
        { memberId: 1, period: "2026-08", status: "pending", origin: "accrual" },
        { memberId: 1, period: "2026-10", status: "exempt", origin: "exemption" },
        { memberId: 1, period: "2026-11", status: "exempt", origin: "exemption" },
      ],
    });
    const rows = await fetchDebtors(debtorsDb(w) as never, {}, null);
    expect(rows).toHaveLength(1);
    // UNA, no tres: las dos exentas no engrosan la deuda del eximido.
    expect(rows[0]).toMatchObject({ memberId: 1, pendingCount: 1, level: 1 });
  });

  it("un socio con TODAS sus cuotas exentas no aparece en la lista de deudores", async () => {
    // El caso del eximido al día, que es el normal: si el filtro de deudores se
    // ampliara alguna vez a otros estados, este vecino aparecería reclamado por
    // meses que la Comisión le perdonó, y con acta.
    const w = world({
      fees: [
        { memberId: 1, period: "2026-10", status: "exempt", origin: "exemption" },
        { memberId: 1, period: "2026-11", status: "exempt", origin: "exemption" },
      ],
    });
    expect(await fetchDebtors(debtorsDb(w) as never, {}, null)).toEqual([]);
  });

  // La otra mitad de la garantía —que la guarda 2 de ESTE módulo tampoco cuenta
  // una exenta como deuda— la fija "una exenta que ya estaba en el rango no se
  // duplica ni rompe", más arriba: ahí el socio tiene una cuota exenta y el
  // asiento pasa igual.
});
