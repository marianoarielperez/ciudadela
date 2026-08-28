// Padrón electoral (REG-31 + enmienda del operador del 23/08/2026).
//
// Lo que estos tests fijan es la LECTURA del estatuto, que es donde el padrón se
// puede equivocar en silencio y dejar a un vecino sin votar:
//   - el adherente vota, y su deuda no le quita el voto;
//   - el honorario y el vitalicio votan SIN el piso de 90 días (REG-30 sobre
//     REG-31, decisión del operador del 24/08/2026);
//   - el moroso NO se excluye: cae en el bloque que dice cuánto tiene que pagar
//     en la mesa;
//   - la mora se mide sobre períodos ANTERIORES al mes de la elección;
//   - la antigüedad sale de `joinedAt` y el reingreso no la reinicia (REG-11);
//   - el socio vigente sin fila en el libro abierto FIGURA, con el número en
//     `null`: que falte es un derecho político negado.
//
// Prisma inyectado: la tabla entera se prueba sin fixtures ni base.
import { describe, expect, it, vi } from "vitest";
import {
  buildElectoralRoll,
  ELECTORAL_CATEGORIES,
  ELECTORAL_MIN_DAYS,
  enabledFrom,
  isEligibleBySeniority,
  mustPurgeToVote,
  SENIORITY_EXEMPT,
  seniorityDays,
} from "@/lib/members/electoral";

const AT = new Date("2026-11-15T12:00:00Z");
const daysBefore = (n: number) => new Date(AT.getTime() - n * 86_400_000);

/** Una fila de `member.findMany` tal como la pide `buildElectoralRoll`: la
 *  membresía viene ANIDADA y el número sale del libro abierto. `memberships: []`
 *  es el socio que todavía no fue asentado en el libro nuevo. */
const m = (
  over: Partial<{
    id: number;
    fullName: string;
    category: string;
    status: string;
    joinedAt: Date;
    memberships: Array<{ memberNumber: number; book: { status: string } }>;
  }> = {},
) => ({
  id: 1,
  fullName: "Ana Gómez",
  category: "active",
  status: "active",
  joinedAt: daysBefore(400),
  memberships: [{ memberNumber: 10, book: { status: "open" } }],
  ...over,
});

/** Atajo para los tests de ORDEN, que es lo único que miran: id, nombre y número
 *  de socio en el libro abierto. */
const mn = (id: number, fullName: string, memberNumber: number) =>
  m({ id, fullName, memberships: [{ memberNumber, book: { status: "open" } }] });

function fakeDb(
  rows: ReturnType<typeof m>[],
  pending: Array<{ memberId: number; _count: { _all: number } }> = [],
) {
  return {
    // Los dobles se tipan CON argumento a propósito: dos tests miran CÓMO se
    // consulta (los socios vigentes, el `period: { lt }`), no sólo qué vuelve, y
    // sin la firma `mock.calls[0][0]` no existe para TypeScript.
    member: { findMany: vi.fn<(args: unknown) => Promise<typeof rows>>(async () => rows) },
    fee: { groupBy: vi.fn<(args: unknown) => Promise<typeof pending>>(async () => pending) },
  };
}

const VALUE = { activeAmount: 6000, sharedAmount: 3000 };

describe("antigüedad (REG-30/31)", () => {
  it("90 días exactos alcanzan", () => {
    expect(ELECTORAL_MIN_DAYS).toBe(90);
    expect(seniorityDays(daysBefore(90), AT)).toBe(90);
    expect(isEligibleBySeniority(daysBefore(90), AT)).toBe(true);
    expect(isEligibleBySeniority(daysBefore(89), AT)).toBe(false);
  });

  it("el piso NO corre para honorarios ni vitalicios, y sí para los otros tres", () => {
    // REG-30 (docs/02:153-154) los exime expresamente; REG-31 no los distingue.
    // Prevalece REG-30 por decisión del operador del 24/08/2026 (spec §13,
    // decisión 10): la distinción de esas categorías existe para honrarlas.
    expect([...SENIORITY_EXEMPT].sort()).toEqual(["honorary", "lifetime"]);
    for (const c of ELECTORAL_CATEGORIES) {
      if (c === "honorary" || c === "lifetime") continue;
      expect(SENIORITY_EXEMPT, c).not.toContain(c);
    }
  });

  it("el cadete no integra el padrón: no tiene voto", () => {
    expect(ELECTORAL_CATEGORIES).not.toContain("cadet");
    expect([...ELECTORAL_CATEGORIES].sort()).toEqual(
      ["active", "adherent", "collaborator", "honorary", "lifetime"].sort(),
    );
  });
});

describe("mustPurgeToVote — la condición de mora, compartida por padrón y /mi", () => {
  it("bloquea sólo al activo y al colaborador con mora", () => {
    expect(mustPurgeToVote("active", 1)).toBe(true);
    expect(mustPurgeToVote("collaborator", 3)).toBe(true);
    expect(mustPurgeToVote("adherent", 5)).toBe(false);
    expect(mustPurgeToVote("honorary", 4)).toBe(false);
    expect(mustPurgeToVote("lifetime", 9)).toBe(false);
  });

  it("sin mora nadie purga", () => {
    for (const c of ELECTORAL_CATEGORIES) expect(mustPurgeToVote(c, 0)).toBe(false);
  });
});

describe("enabledFrom — desde cuándo puede votar", () => {
  it("es ingreso + 90 días, y ese mismo día ya alcanza", () => {
    const joined = daysBefore(90);
    expect(enabledFrom(joined)).toEqual(AT);
    expect(isEligibleBySeniority(joined, enabledFrom(joined))).toBe(true);
  });

  it("al que ingresó ayer le faltan 89 días desde AT", () => {
    const joined = daysBefore(1);
    expect(enabledFrom(joined).getTime()).toBe(AT.getTime() + 89 * 86_400_000);
  });
});

describe("buildElectoralRoll", () => {
  it("el adherente con antigüedad VOTA y no se le exige estar sin mora", async () => {
    const db = fakeDb([m({ id: 2, category: "adherent" })], [{ memberId: 2, _count: { _all: 5 } }]);
    const roll = await buildElectoralRoll(db as never, AT, VALUE);
    expect(roll.enabled.map((r) => r.memberId)).toEqual([2]);
    expect(roll.toPurge).toEqual([]);
  });

  it("el activo con mora sale en el bloque de purga, con cuotas y monto", async () => {
    const db = fakeDb([m({ id: 1 })], [{ memberId: 1, _count: { _all: 3 } }]);
    const roll = await buildElectoralRoll(db as never, AT, VALUE);
    expect(roll.enabled).toEqual([]);
    expect(roll.toPurge[0]).toMatchObject({ memberId: 1, arrears: 3, debt: 18000 });
    expect(roll.purgeFees).toBe(3);
    expect(roll.purgeAmount).toBe(18000);
  });

  it("el colaborador con mora también purga, a valor compartido", async () => {
    const db = fakeDb([m({ id: 5, category: "collaborator" })], [{ memberId: 5, _count: { _all: 2 } }]);
    const roll = await buildElectoralRoll(db as never, AT, VALUE);
    expect(roll.toPurge[0]).toMatchObject({ memberId: 5, arrears: 2, debt: 6000 });
  });

  it("la mora se mide sobre períodos ANTERIORES al mes de la elección", async () => {
    const db = fakeDb([m({ id: 1 })]);
    await buildElectoralRoll(db as never, AT, VALUE);
    expect(db.fee.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "pending", period: { lt: "2026-11" } }),
      }),
    );
  });

  it("el honorario de 10 días vota: REG-30 lo exime del piso de antigüedad", async () => {
    const db = fakeDb([
      m({ id: 6, category: "honorary", joinedAt: daysBefore(10) }),
      m({ id: 7, category: "lifetime", joinedAt: daysBefore(1) }),
    ]);
    const roll = await buildElectoralRoll(db as never, AT, VALUE);
    expect(roll.enabled.map((r) => r.memberId)).toEqual([6, 7]);
    expect(roll.withoutSeniority).toEqual([]);
  });

  it("el honorario y el vitalicio con cuotas impagas siguen en Habilitados", async () => {
    // No devengan (no están en ACCRUING_CATEGORIES), así que una fila pendiente
    // heredada del import no los puede mandar al bloque de purga.
    const db = fakeDb(
      [m({ id: 6, category: "honorary" }), m({ id: 7, category: "lifetime" })],
      [
        { memberId: 6, _count: { _all: 4 } },
        { memberId: 7, _count: { _all: 9 } },
      ],
    );
    const roll = await buildElectoralRoll(db as never, AT, VALUE);
    expect(roll.enabled.map((r) => r.memberId)).toEqual([6, 7]);
    expect(roll.toPurge).toEqual([]);
    expect(roll.purgeAmount).toBe(0);
  });

  it("sólo mira a los socios vigentes: el suspendido no vota", async () => {
    // Decisión del operador del 23/08/2026 (spec §13, decisión 9): la suspensión
    // es disciplinaria y suspende también el voto. Se resuelve en el `where`, así
    // que lo que se verifica es el filtro.
    const db = fakeDb([m()]);
    await buildElectoralRoll(db as never, AT, VALUE);
    const args = db.member.findMany.mock.calls[0][0] as unknown as {
      where: { status: string; category: { in: string[] } };
    };
    expect(args.where.status).toBe("active");
    expect([...args.where.category.in].sort()).toEqual([...ELECTORAL_CATEGORIES].sort());
  });

  it("el socio vigente sin fila en el libro abierto FIGURA, con el número en null", async () => {
    // El lapso de un re-empadronamiento (REG-28): el Libro 2 está abierto y a
    // este socio todavía no lo asentaron. Con la consulta armada desde
    // Membership desaparecía del padrón y la pantalla no lo decía.
    const db = fakeDb([
      m({ id: 8, memberships: [] }),
      m({ id: 9, memberships: [{ memberNumber: 77, book: { status: "closed" } }] }),
    ]);
    const roll = await buildElectoralRoll(db as never, AT, VALUE);
    expect(roll.enabled.map((r) => [r.memberId, r.memberNumber])).toEqual([
      [8, null],
      [9, null],
    ]);
    expect(roll.considered).toBe(2);
  });

  it("ordena ALFABÉTICO por apellido y pone PRIMERO al que no tiene número", async () => {
    // Decisión del operador del 24/08/2026 (spec §13, decisión 11): así se usa
    // en la mesa —llega un vecino y se lo busca por apellido—. El sin número
    // queda fuera del orden, adelante: es una anomalía de datos que tiene que
    // saltar en la primera hoja.
    const db = fakeDb([
      mn(1, "Zurita, Carlos", 306),
      mn(2, "Ñandú, Rosa", 41),
      m({ id: 3, fullName: "Villalba, Ema", memberships: [] }),
      mn(4, "Ávila, Bruno", 14),
      mn(5, "Aguirre, Dora", 200),
    ]);
    const roll = await buildElectoralRoll(db as never, AT, VALUE);
    expect(roll.enabled.map((r) => r.fullName)).toEqual([
      // Sin número: adelante y fuera del orden.
      "Villalba, Ema",
      "Aguirre, Dora",
      // Con `<` la Á caería DESPUÉS de la Z: es el caso que justifica el locale.
      "Ávila, Bruno",
      // Y la Ñ, también después de la Z.
      "Ñandú, Rosa",
      "Zurita, Carlos",
    ]);
  });

  it("los homónimos desempatan por número: dos impresiones dan la misma hoja", async () => {
    const db = fakeDb([mn(1, "Pérez, Juan", 88), mn(2, "Pérez, Juan", 12)]);
    const roll = await buildElectoralRoll(db as never, AT, VALUE);
    expect(roll.enabled.map((r) => r.memberNumber)).toEqual([12, 88]);
  });

  it("dos homónimos AMBOS sin número desempatan por id, no por el orden de la consulta", async () => {
    // Es el caso que el desempate por número no cerraba: `0 - 0 = 0` devolvía
    // al orden de la consulta y a la estabilidad del `sort`. Y cae justo en el
    // bloque de adelante, donde la anomalía se acumula. Se corre dos veces con
    // las filas al revés: la hoja tiene que salir igual.
    const sin = (id: number) => m({ id, fullName: "Pérez, Juan", memberships: [] });
    const a = await buildElectoralRoll(fakeDb([sin(9), sin(4)]) as never, AT, VALUE);
    const b = await buildElectoralRoll(fakeDb([sin(4), sin(9)]) as never, AT, VALUE);
    expect(a.enabled.map((r) => r.memberId)).toEqual([4, 9]);
    expect(b.enabled.map((r) => r.memberId)).toEqual([4, 9]);
  });

  it("el bloque a purgar sale en el MISMO orden alfabético", async () => {
    const db = fakeDb(
      [mn(1, "Zurita, Carlos", 306), mn(2, "Ñandú, Rosa", 41), mn(3, "Aguirre, Dora", 200)],
      [
        { memberId: 1, _count: { _all: 2 } },
        { memberId: 2, _count: { _all: 3 } },
        { memberId: 3, _count: { _all: 1 } },
      ],
    );
    const roll = await buildElectoralRoll(db as never, AT, VALUE);
    expect(roll.enabled).toHaveLength(0);
    expect(roll.toPurge.map((r) => r.fullName)).toEqual([
      "Aguirre, Dora",
      "Ñandú, Rosa",
      "Zurita, Carlos",
    ]);
  });

  it("la cuenta cierra: considerados = sin antigüedad + habilitados + a purgar", async () => {
    const db = fakeDb(
      [
        m({ id: 1 }),
        m({ id: 2, category: "adherent" }),
        m({ id: 3, joinedAt: daysBefore(45) }),
        m({ id: 4 }),
      ],
      [{ memberId: 4, _count: { _all: 2 } }],
    );
    const roll = await buildElectoralRoll(db as never, AT, VALUE);
    expect(roll.considered).toBe(4);
    expect(roll.withoutSeniority.map((r) => r.memberId)).toEqual([3]);
    expect(roll.considered).toBe(
      roll.withoutSeniority.length + roll.enabled.length + roll.toPurge.length,
    );
  });

  it("el que no llega a los 90 días no está en ningún bloque, y la hoja lo cuenta", async () => {
    const db = fakeDb([m({ id: 3, joinedAt: daysBefore(45) })]);
    const roll = await buildElectoralRoll(db as never, AT, VALUE);
    expect(roll.enabled).toEqual([]);
    expect(roll.toPurge).toEqual([]);
    expect(roll.considered).toBe(1);
    expect(roll.withoutSeniority.map((r) => r.memberId)).toEqual([3]);
    // La mora no se consulta para este bloque: pagar no habilita, y la deuda de
    // quien no vota es un dato sin finalidad acá.
    expect(roll.withoutSeniority[0]).toMatchObject({ arrears: 0, debt: null });
  });

  it("con el padrón entero fuera de antigüedad no le pregunta la deuda a nadie", async () => {
    const db = fakeDb([m({ id: 3, joinedAt: daysBefore(45) })]);
    await buildElectoralRoll(db as never, AT, VALUE);
    expect(db.fee.groupBy).not.toHaveBeenCalled();
  });

  it("REG-11: al reingresado le vale su joinedAt original, que el reingreso no toca", async () => {
    // La antigüedad sale de `joinedAt` y nada más: si el reingreso la reiniciara,
    // un socio de 20 años quedaría fuera del padrón por volver en septiembre.
    const joinedAt = new Date("2006-03-01T12:00:00Z");
    const db = fakeDb([m({ id: 4, joinedAt })]);
    const roll = await buildElectoralRoll(db as never, AT, VALUE);
    expect(roll.enabled.map((r) => r.memberId)).toEqual([4]);
    expect(roll.enabled[0].joinedAt).toEqual(joinedAt);
    expect(seniorityDays(joinedAt, AT)).toBeGreaterThan(7000);
  });

  it("sin valor de cuota vigente el padrón sale igual, con el monto en null", async () => {
    const db = fakeDb([m({ id: 1 })], [{ memberId: 1, _count: { _all: 2 } }]);
    const roll = await buildElectoralRoll(db as never, AT, null);
    expect(roll.toPurge[0]).toMatchObject({ arrears: 2, debt: null });
    expect(roll.purgeAmount).toBe(0);
  });

  it("el bloque sin antigüedad conserva el orden del padrón y no dispara consultas de deuda extra", async () => {
    const db = fakeDb(
      [
        mn(1, "Zurita, Carlos", 306),
        m({
          id: 2,
          fullName: "Ñandú, Rosa",
          joinedAt: daysBefore(10),
          memberships: [{ memberNumber: 41, book: { status: "open" } }],
        }),
        m({
          id: 3,
          fullName: "Ávila, Bruno",
          joinedAt: daysBefore(30),
          memberships: [{ memberNumber: 14, book: { status: "open" } }],
        }),
      ],
      [{ memberId: 1, _count: { _all: 2 } }],
    );
    const roll = await buildElectoralRoll(db as never, AT, VALUE);
    // Alfabético es-AR, igual que los otros dos bloques.
    expect(roll.withoutSeniority.map((r) => r.fullName)).toEqual(["Ávila, Bruno", "Ñandú, Rosa"]);
    // La consulta de mora sigue siendo SÓLO de los elegibles.
    expect(db.fee.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ memberId: { in: [1] } }) }),
    );
  });
});
