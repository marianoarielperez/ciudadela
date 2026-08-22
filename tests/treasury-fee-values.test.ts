import { describe, expect, it, vi } from "vitest";
import { civilDateUtc } from "@/lib/dates";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import { makeFeeValueReader } from "@/lib/treasury/fee-values";

const rows = [
  { id: 1, activeAmount: "6000.00", sharedAmount: "3000.00", validFrom: civilDateUtc(2026, 9, 1), minuteId: null },
  { id: 2, activeAmount: "8000.00", sharedAmount: "4000.00", validFrom: civilDateUtc(2027, 1, 1), minuteId: 7 },
];

function db() {
  return {
    feeValue: {
      findFirst: vi.fn(async (args: { where: { validFrom: { lte: Date } } }) => {
        const at = args.where.validFrom.lte;
        const eligible = rows
          .filter((r) => r.validFrom <= at)
          .sort((a, b) => b.validFrom.getTime() - a.validFrom.getTime());
        return eligible[0] ?? null;
      }),
      // El fake NO ordena: quien tiene que pedir el orden es el lector, y el
      // test de abajo lo verifica mirando los argumentos que recibió. Si acá
      // devolviéramos la lista ya dada vuelta, `history()` pasaría igual
      // pidiendo el orden al revés.
      findMany: vi.fn(async () => [...rows].reverse()),
    },
  } as never;
}

describe("makeFeeValueReader", () => {
  it("current devuelve el de mayor validFrom <= la fecha, con montos numéricos", async () => {
    const reader = makeFeeValueReader(db());
    const v = await reader.current(civilDateUtc(2026, 10, 15));
    expect(v).toEqual({ id: 1, activeAmount: 6000, sharedAmount: 3000, validFrom: rows[0].validFrom, minuteId: null });
    const later = await reader.current(civilDateUtc(2027, 3, 1));
    expect(later?.id).toBe(2);
    expect(later?.activeAmount).toBe(8000);
  });

  it("current devuelve null si todavía no rige ninguno", async () => {
    expect(await makeFeeValueReader(db()).current(civilDateUtc(2026, 8, 1))).toBeNull();
  });

  // El borde que importa: `validFrom` es una fecha civil guardada al mediodía
  // UTC, que son las 09:00 argentinas. Comparado contra el instante crudo, un
  // valor que empieza a regir hoy no existe hasta las nueve de la mañana.
  describe("el valor rige el día entero, no desde las 09:00", () => {
    it("rige a las 00:30 argentinas del propio día de vigencia", async () => {
      // 03:30 UTC = 00:30 en Argentina del 1/9/2026, el mismo día del validFrom.
      const v = await makeFeeValueReader(db()).current(new Date("2026-09-01T03:30:00.000Z"));
      expect(v?.id).toBe(1);
    });

    it("el cron de devengo (00:30 del día 1) encuentra el valor que arranca ese día", async () => {
      // El caso que abortaba con "no hay valor de cuota vigente": el devengo de
      // enero corre el 1/1 a las 00:30 argentinas y el valor nuevo rige desde
      // ese mismo 1/1.
      const v = await makeFeeValueReader(db()).current(new Date("2027-01-01T03:30:00.000Z"));
      expect(v?.id).toBe(2);
      expect(v?.activeAmount).toBe(8000);
    });

    it("todavía NO rige a las 23:00 argentinas del día anterior", async () => {
      // 02:00 UTC del 1/9 son las 23:00 del 31/8 en Argentina: en UTC ya es el
      // día de la vigencia, pero acá todavía no. El día se resuelve en
      // Argentina, no en UTC.
      expect(await makeFeeValueReader(db()).current(new Date("2026-09-01T02:00:00.000Z"))).toBeNull();
      // Y el valor anterior sigue siendo el vigente esa misma noche.
      const v = await makeFeeValueReader(db()).current(new Date("2027-01-01T02:00:00.000Z"));
      expect(v?.id).toBe(1);
    });
  });

  it("history viene ordenada del más nuevo al más viejo", async () => {
    const d = db();
    const h = await makeFeeValueReader(d).history();
    expect(h.map((r) => r.id)).toEqual([2, 1]);
    expect(h[0].activeAmount).toBe(8000);
    // El orden es contrato del lector, no del fake: se le pide a la base.
    expect((d as unknown as { feeValue: { findMany: { mock: { calls: unknown[][] } } } })
      .feeValue.findMany.mock.calls[0][0]).toMatchObject({
      orderBy: [{ validFrom: "desc" }, { id: "desc" }],
    });
  });
});
