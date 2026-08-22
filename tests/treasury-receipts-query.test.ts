import { describe, expect, it } from "vitest";
import {
  fetchReceiptsPage,
  parseReceiptFilters,
  RECEIPTS_PAGE_SIZE,
  receiptsWhere,
} from "@/lib/treasury/receipts-query";

// Un fake mínimo del cliente: el módulo recibe Prisma inyectado a propósito
// (importar "@/lib/prisma" tira sin DATABASE_URL y este test es puro).
type Args = Record<string, unknown>;

function fakeDb(total: number) {
  const counted: Args[] = [];
  const listed: Args[] = [];
  const db = {
    receipt: {
      count: async (args: Args) => { counted.push(args); return total; },
      findMany: async (args: Args) => { listed.push(args); return [] as unknown[]; },
    },
  };
  return { db: db as unknown as Parameters<typeof fetchReceiptsPage>[0], counted, listed };
}

describe("receipt filters", () => {
  it("parsea solo valores válidos", () => {
    expect(parseReceiptFilters({ q: " ana ", mes: "2026-09", medio: "cash", estado: "anulados" }))
      .toEqual({ q: "ana", mes: "2026-09", medio: "cash", estado: "anulados" });
    expect(parseReceiptFilters({ mes: "2026-13", medio: "x", estado: "y" })).toEqual({});
  });

  it("toma el primer valor cuando el querystring repite la clave", () => {
    // `?medio=cash&medio=link` llega como array: sin `one()` el filtro se
    // compararía contra un array y no coincidiría con ningún medio.
    expect(parseReceiptFilters({ q: ["ana", "otra"], medio: ["cash", "link"] }))
      .toEqual({ q: "ana", medio: "cash" });
  });

  it("arma el where por número de recibo, socio, mes, medio y estado", () => {
    const w = receiptsWhere({ q: "2026-00003", mes: "2026-09", medio: "cash", estado: "vigentes" });
    expect(w.voidedAt).toBeNull();
    expect(w.issuedAt).toEqual({ gte: new Date("2026-09-01T03:00:00.000Z"), lt: new Date("2026-10-01T03:00:00.000Z") });
    expect(w.payment).toMatchObject({ type: "cash" });
    expect(w.OR).toEqual([{ number: { contains: "2026-00003" } }, { payment: { member: { fullName: { contains: "2026-00003" } } } }]);
  });

  it("anulados pide voidedAt no nulo y sin filtros el where va vacío", () => {
    expect(receiptsWhere({ estado: "anulados" }).voidedAt).toEqual({ not: null });
    expect(receiptsWhere({})).toEqual({});
  });

  it("el mes de diciembre cierra en enero del año siguiente", () => {
    // El borde del año: si el mes se sumara sin arrastrar el año, diciembre
    // quedaría abierto hasta el mes 13 y traería todo el año siguiente.
    expect(receiptsWhere({ mes: "2026-12" }).issuedAt).toEqual({
      gte: new Date("2026-12-01T03:00:00.000Z"),
      lt: new Date("2027-01-01T03:00:00.000Z"),
    });
  });
});

describe("fetchReceiptsPage", () => {
  it("pagina de a 50, ordena por serie descendente y NO trae las cuotas", async () => {
    const { db, counted, listed } = fakeDb(120);
    const r = await fetchReceiptsPage(db, { estado: "vigentes" }, 2);
    expect(r).toMatchObject({ total: 120, page: 2, pageCount: 3 });
    expect(counted[0]).toEqual({ where: { voidedAt: null } });
    const args = listed[0] as unknown as {
      skip: number; take: number; orderBy: unknown;
      include: { payment: { include: Record<string, unknown> } };
    };
    expect(args.skip).toBe(RECEIPTS_PAGE_SIZE);
    expect(args.take).toBe(RECEIPTS_PAGE_SIZE);
    // La serie (year, seq) y no `issuedAt`: dos recibos emitidos en el mismo
    // segundo tienen que salir en el orden en que se numeraron.
    expect(args.orderBy).toEqual([{ year: "desc" }, { seq: "desc" }]);
    // El concepto está congelado en la fila del recibo. Traer `payment.fees`
    // para recalcularlo devolvería "Cuota social" pelada en los anulados, que
    // es justo cuando las cuotas se despegan del pago.
    expect(args.include.payment.include).not.toHaveProperty("fees");
  });

  it("acota una página fuera de rango a la última", async () => {
    const { db, listed } = fakeDb(60);
    const r = await fetchReceiptsPage(db, {}, 999);
    expect(r.page).toBe(2);
    expect((listed[0] as unknown as { skip: number }).skip).toBe(50);
  });
});
