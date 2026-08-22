import { describe, expect, it, vi } from "vitest";
import { civilDateUtc } from "@/lib/dates";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import { buildPeriodGrid, fetchMemberAccount, type AccountFee } from "@/lib/treasury/account";

const fee = (
  period: string, status: AccountFee["status"], origin: AccountFee["origin"] = "accrual", paymentId: number | null = null,
): AccountFee => ({ period, status, origin, paymentId });

describe("buildPeriodGrid", () => {
  it("una fila por año desde el primer dato hasta el corriente, 12 celdas", () => {
    const grid = buildPeriodGrid(
      [fee("2025-11", "paid", "accrual", 1), fee("2026-01", "pending"), fee("2026-02", "pending", "import")],
      new Map([[1, "2026-00001"]]),
      civilDateUtc(2025, 10, 15),
      "2026-03",
    );
    expect(grid.map((r) => r.year)).toEqual([2025, 2026]);
    expect(grid[0].cells).toHaveLength(12);
    expect(grid[0].cells[10]).toEqual({ period: "2025-11", state: "paid", receiptNumber: "2026-00001" });
    expect(grid[1].cells[0].state).toBe("pending");
    expect(grid[1].cells[1].state).toBe("pending_import");
    expect(grid[1].cells[2].state).toBe("none");
    expect(grid[1].cells[11].state).toBe("none");
  });

  it("sin cuotas devuelve solo el año corriente", () => {
    const grid = buildPeriodGrid([], new Map(), null, "2026-08");
    expect(grid.map((r) => r.year)).toEqual([2026]);
    expect(grid[0].cells.every((c) => c.state === "none")).toBe(true);
  });

  // allocate() en rules.ts puede generar cuotas en un año POSTERIOR al del
  // período corriente cuando un socio paga por adelantado más meses de los
  // que debe (un pago en noviembre que cubre nov/dic/ene crea una fila de
  // enero del año siguiente). El límite superior del recorrido de años tiene
  // que ensancharse igual que el inferior, o esa plata queda invisible en la
  // cinta.
  it("una cuota en un año posterior al corriente también aparece en la cinta", () => {
    const grid = buildPeriodGrid(
      [fee("2026-12", "pending"), fee("2027-01", "pending")],
      new Map(),
      null,
      "2026-11",
    );
    expect(grid.map((r) => r.year)).toEqual([2026, 2027]);
    expect(grid[1].cells[0]).toEqual({ period: "2027-01", state: "pending" });
  });

  it("una cuota paga en un año futuro también aparece con su estado", () => {
    const grid = buildPeriodGrid(
      [fee("2027-03", "paid", "accrual", 1)],
      new Map([[1, "2027-00001"]]),
      null,
      "2026-11",
    );
    expect(grid.map((r) => r.year)).toEqual([2026, 2027]);
    expect(grid[1].cells[2]).toEqual({ period: "2027-03", state: "paid", receiptNumber: "2027-00001" });
  });
});

describe("fetchMemberAccount", () => {
  // Las filas vienen DESORDENADAS a propósito (a diferencia de las filas de la
  // base real, `orderBy` no las ordena solo): si alguno de los dos
  // `.sort(comparePeriods)` de fetchMemberAccount se borra, este fake no lo
  // tapa y la prueba de abajo falla.
  const db = {
    fee: {
      findMany: vi.fn(async () => [
        { period: "2026-02", status: "pending", origin: "accrual", paymentId: null },
        { period: "2026-01", status: "paid", origin: "accrual", paymentId: 5 },
        { period: "2025-12", status: "pending", origin: "import", paymentId: null },
        { period: "2026-03", status: "paid", origin: "accrual", paymentId: 5 },
      ]),
    },
    payment: {
      findMany: vi.fn(async () => [
        {
          id: 5, type: "cash", amount: "6000.00", paidAt: civilDateUtc(2026, 2, 3), status: "applied", note: null,
          fees: [{ period: "2026-03" }, { period: "2026-01" }], receipt: { id: 9, number: "2026-00003", voidedAt: null },
        },
      ]),
    },
  } as never;

  it("resume pendientes, deuda a valor vigente y nivel de mora", async () => {
    const a = await fetchMemberAccount(db, { id: 1, category: "active" }, { activeAmount: 6000, sharedAmount: 3000 });
    expect(a.pendingCount).toBe(2);
    expect(a.pendingPeriods).toEqual(["2025-12", "2026-02"]);
    expect(a.oldestPending).toBe("2025-12");
    expect(a.debt).toBe(12000);
    expect(a.feeAmount).toBe(6000);
    expect(a.level).toBe(2);
    expect(a.payments[0]).toMatchObject({
      id: 5, amount: 6000, periods: ["2026-01", "2026-03"], receipt: { number: "2026-00003" },
    });
  });

  it("sin valor vigente la deuda es null (no se inventa un monto)", async () => {
    const a = await fetchMemberAccount(db, { id: 1, category: "active" }, null);
    expect(a.debt).toBeNull();
    expect(a.feeAmount).toBeNull();
    expect(a.pendingCount).toBe(2);
  });
});
