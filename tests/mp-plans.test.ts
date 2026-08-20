import { describe, expect, it, vi, type Mock } from "vitest";

// `src/lib/mp/plans.ts` exporta el singleton `getFeeAmounts`, armado sobre
// `configReader = makeConfigReader(prisma)`: importar el módulo instancia el
// cliente Prisma y sin DATABASE_URL revienta antes del primer test. Acá se
// ejercita la fábrica inyectable, así que alcanza con stubear el módulo
// (mismo criterio que tests/config.test.ts). El gateway NO se stubea: su
// cliente de MP es lazy y nunca se construye por importarlo.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { FEE_CACHE_TTL_MS, makeFeeAmountsReader } from "@/lib/mp/plans";

// El `vi.fn()` pelado de vitest 4 es `Mock<Procedure>` y no encaja en `Deps`:
// el doble se tipa con la firma real de `getPlan`.
type GetPlanMock = Mock<(planId: string) => Promise<{ id: string; reason: string; amount: number }>>;

function deps(overrides?: { getPlan?: GetPlanMock }) {
  const getPlan: GetPlanMock =
    overrides?.getPlan ??
    vi.fn(async (id: string) => ({
      id,
      reason: "Plan",
      amount: id === "plan-A" ? 6000 : 3000,
    }));
  const config = {
    getString: vi.fn(async (key: string) =>
      key === "mp_plan_active_id" ? "plan-A" : key === "mp_plan_shared_id" ? "plan-S" : null,
    ),
  };
  return { gateway: { getPlan }, config, getPlan };
}

describe("makeFeeAmountsReader", () => {
  it("lee los dos planes y cachea 24 h", async () => {
    let t = 0;
    const d = deps();
    const reader = makeFeeAmountsReader({ ...d, now: () => t });
    await expect(reader.getFeeAmounts()).resolves.toEqual({ active: 6000, shared: 3000 });
    t += FEE_CACHE_TTL_MS - 1;
    await reader.getFeeAmounts();
    expect(d.getPlan).toHaveBeenCalledTimes(2); // una vez por plan, sin refetch
    t += 2;
    await reader.getFeeAmounts();
    expect(d.getPlan).toHaveBeenCalledTimes(4); // vencido: refetch
  });

  it("devuelve null sin ids configurados", async () => {
    const d = deps();
    d.config.getString = vi.fn(async () => null);
    const reader = makeFeeAmountsReader(d);
    await expect(reader.getFeeAmounts()).resolves.toBeNull();
  });

  it("sirve el último valor bueno si MP falla (stale-on-error)", async () => {
    let t = 0;
    let fail = false;
    const getPlan: GetPlanMock = vi.fn(async (id: string) => {
      if (fail) throw new Error("mp down");
      return { id, reason: "Plan", amount: 6000 };
    });
    const d = deps({ getPlan });
    const reader = makeFeeAmountsReader({ ...d, now: () => t });
    await reader.getFeeAmounts();
    fail = true;
    t += FEE_CACHE_TTL_MS + 1;
    await expect(reader.getFeeAmounts()).resolves.toEqual({ active: 6000, shared: 6000 });
  });

  it("devuelve null si MP falla y nunca hubo valor bueno", async () => {
    const getPlan: GetPlanMock = vi.fn(async () => {
      throw new Error("mp down");
    });
    const reader = makeFeeAmountsReader(deps({ getPlan }));
    await expect(reader.getFeeAmounts()).resolves.toBeNull();
  });
});
