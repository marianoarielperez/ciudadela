// Montos de la cuota: la fuente de verdad son los DOS planes de MP (decisión
// 20/08/2026, reemplaza los 3 de docs/06: "SOCIO ACTIVO" y "SOCIO
// ADHERENTE/COLABORADOR" comparten monto). Cache in-memory 24 h con
// stale-on-error: si MP está caído se sirve el último valor bueno antes que
// inventar un monto o tirar abajo el wizard. In-memory alcanza: PM2 corre un
// único proceso (mismo criterio que rate-limiter.ts).
import { CONFIG_KEYS, configReader } from "@/lib/config";
import { mpGateway, type MpGateway } from "./gateway";

export type FeeAmounts = { active: number; shared: number };

export const FEE_CACHE_TTL_MS = 24 * 60 * 60_000;

type Deps = {
  gateway: Pick<MpGateway, "getPlan">;
  config: { getString(key: string): Promise<string | null> };
  now?: () => number;
};

export function makeFeeAmountsReader(deps: Deps) {
  const now = deps.now ?? Date.now;
  let cached: { value: FeeAmounts; at: number } | null = null;

  return {
    async getFeeAmounts(): Promise<FeeAmounts | null> {
      if (cached && now() - cached.at < FEE_CACHE_TTL_MS) return cached.value;
      try {
        // La lectura de config va DENTRO del try: si Prisma falla queremos el
        // mismo stale-on-error que si falla MP, no una promesa rechazada.
        const [activeId, sharedId] = await Promise.all([
          deps.config.getString(CONFIG_KEYS.mpPlanActiveId),
          deps.config.getString(CONFIG_KEYS.mpPlanSharedId),
        ]);
        // Ids sin configurar no es un error: no hay monto que servir todavía.
        if (!activeId || !sharedId) return cached?.value ?? null;
        const [active, shared] = await Promise.all([
          deps.gateway.getPlan(activeId),
          deps.gateway.getPlan(sharedId),
        ]);
        cached = { value: { active: active.amount, shared: shared.amount }, at: now() };
        return cached.value;
      } catch {
        // MP caído (o la config ilegible): el último valor bueno sigue siendo
        // mejor que nada. La divergencia real plan↔local la vigila el sync
        // del M4 (REG-34).
        return cached?.value ?? null;
      }
    },
  };
}

const reader = makeFeeAmountsReader({ gateway: mpGateway, config: configReader });
export const getFeeAmounts = reader.getFeeAmounts;
