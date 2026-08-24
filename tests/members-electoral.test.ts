// Padrón electoral (REG-31 + enmienda del operador del 23/08/2026).
//
// Lo que estos tests fijan es la LECTURA del estatuto, que es donde el padrón se
// puede equivocar en silencio y dejar a un vecino sin votar:
//   - el adherente vota, y su deuda no le quita el voto;
//   - el moroso NO se excluye: cae en el bloque que dice cuánto tiene que pagar
//     en la mesa;
//   - la mora se mide sobre períodos ANTERIORES al mes de la elección;
//   - la antigüedad sale de `joinedAt` y el reingreso no la reinicia (REG-11).
//
// Prisma inyectado: la tabla entera se prueba sin fixtures ni base.
import { describe, expect, it, vi } from "vitest";
import {
  buildElectoralRoll,
  ELECTORAL_CATEGORIES,
  electoralCsv,
  ELECTORAL_MIN_DAYS,
  isEligibleBySeniority,
  seniorityDays,
} from "@/lib/members/electoral";

const AT = new Date("2026-11-15T12:00:00Z");
const daysBefore = (n: number) => new Date(AT.getTime() - n * 86_400_000);

const m = (
  over: Partial<{ id: number; fullName: string; category: string; status: string; joinedAt: Date }> = {},
) => ({
  memberNumber: 10,
  member: {
    id: 1,
    fullName: "Ana Gómez",
    category: "active",
    status: "active",
    joinedAt: daysBefore(400),
    ...over,
  },
});

function fakeDb(
  rows: ReturnType<typeof m>[],
  pending: Array<{ memberId: number; _count: { _all: number } }> = [],
) {
  return {
    // Los dobles se tipan CON argumento a propósito: dos tests miran CÓMO se
    // consulta (el libro abierto, el `period: { lt }`), no sólo qué vuelve, y
    // sin la firma `mock.calls[0][0]` no existe para TypeScript.
    membership: { findMany: vi.fn<(args: unknown) => Promise<typeof rows>>(async () => rows) },
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

  it("el cadete no integra el padrón: no tiene voto", () => {
    expect(ELECTORAL_CATEGORIES).not.toContain("cadet");
    expect([...ELECTORAL_CATEGORIES].sort()).toEqual(
      ["active", "adherent", "collaborator", "honorary", "lifetime"].sort(),
    );
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

  it("sólo mira el libro abierto y a los socios vigentes: el suspendido no vota", async () => {
    // Decisión del operador del 23/08/2026 (spec §13, decisión 9): la suspensión
    // es disciplinaria y suspende también el voto. Se resuelve en el `where`, así
    // que lo que se verifica es el filtro.
    const db = fakeDb([m()]);
    await buildElectoralRoll(db as never, AT, VALUE);
    const args = db.membership.findMany.mock.calls[0][0] as unknown as {
      where: { book: { status: string }; member: { status: string } };
    };
    expect(args.where.book).toEqual({ status: "open" });
    expect(args.where.member.status).toBe("active");
  });

  it("el que no llega a los 90 días no está en ningún bloque", async () => {
    const db = fakeDb([m({ id: 3, joinedAt: daysBefore(45) })]);
    const roll = await buildElectoralRoll(db as never, AT, VALUE);
    expect(roll.enabled).toEqual([]);
    expect(roll.toPurge).toEqual([]);
  });

  it("con el padrón entero fuera de antigüedad no le pregunta la deuda a nadie", async () => {
    const db = fakeDb([m({ id: 3, joinedAt: daysBefore(45) })]);
    await buildElectoralRoll(db as never, AT, VALUE);
    expect(db.fee.groupBy).not.toHaveBeenCalled();
  });

  it("REG-11: al reingresado le vale su joinedAt original, que el reingreso no toca", async () => {
    // La antigüedad sale de `joinedAt` y nada más: si el reingreso la reiniciara,
    // un socio de 20 años quedaría fuera del padrón por volver en septiembre.
    const db = fakeDb([m({ id: 4, joinedAt: new Date("2006-03-01T12:00:00Z") })]);
    const roll = await buildElectoralRoll(db as never, AT, VALUE);
    expect(roll.enabled[0].seniorityDays).toBeGreaterThan(7000);
  });

  it("sin valor de cuota vigente el padrón sale igual, con el monto en null", async () => {
    const db = fakeDb([m({ id: 1 })], [{ memberId: 1, _count: { _all: 2 } }]);
    const roll = await buildElectoralRoll(db as never, AT, null);
    expect(roll.toPurge[0]).toMatchObject({ arrears: 2, debt: null });
    expect(roll.purgeAmount).toBe(0);
  });

  it("el CSV lleva las columnas de REG-31 y el bloque de cada uno", async () => {
    const db = fakeDb([m({ id: 1 }), m({ id: 2, category: "adherent" })], [{ memberId: 1, _count: { _all: 2 } }]);
    const csv = electoralCsv(await buildElectoralRoll(db as never, AT, VALUE));
    expect(csv.split("\n")[0]).toBe("bloque,numero_socio,apellido_nombre,categoria,cuotas_adeudadas,monto_a_purgar");
    // Con comillas: TODAS las celdas van entrecomilladas, incluida la del
    // bloque. (El brief afirmaba `"habilitado,"` a secas, que su propio
    // `electoralCsv` nunca podría emitir.)
    expect(csv).toContain('"habilitado",');
    expect(csv).toContain('"a_purgar",');
  });

  it("el CSV no lleva DNI ni ningún dato que REG-31 no pida", async () => {
    // Columnas de REG-31 (docs/02:158): nombre, número de socio, categoría. El
    // documento sale del sistema hacia la Junta Electoral y en papel no queda
    // ningún control de acceso después (Ley 25.326).
    const db = fakeDb([m({ id: 1 })]);
    const csv = electoralCsv(await buildElectoralRoll(db as never, AT, VALUE));
    expect(csv.split("\n")[0].split(",")).toHaveLength(6);
    expect(csv.toLowerCase()).not.toContain("dni");
    expect(csv.toLowerCase()).not.toContain("email");
    expect(csv.toLowerCase()).not.toContain("domicilio");
  });

  it("el habilitado no publica cuántas cuotas debe: esas dos columnas son del bloque de purga", async () => {
    // El adherente moroso vota igual, así que su deuda no le dice nada a la
    // Junta Electoral — y es un dato financiero de un vecino en una hoja que
    // circula fuera del sistema.
    const db = fakeDb([m({ id: 2, category: "adherent" })], [{ memberId: 2, _count: { _all: 5 } }]);
    const csv = electoralCsv(await buildElectoralRoll(db as never, AT, VALUE));
    const row = csv.split("\n").find((l) => l.startsWith('"habilitado"'))!;
    expect(row).toBe('"habilitado","10","Ana Gómez","adherent","",""');
  });

  it("el CSV entrecomilla el apellido con coma en vez de partir la fila", async () => {
    const db = fakeDb([m({ id: 1, fullName: 'Pizarro, "Pancho" Francisco' })]);
    const csv = electoralCsv(await buildElectoralRoll(db as never, AT, VALUE));
    expect(csv).toContain('"Pizarro, ""Pancho"" Francisco"');
    expect(csv.split("\n")).toHaveLength(2);
  });
});
