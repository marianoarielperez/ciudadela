// Montos de la cuota: la fuente de verdad son los DOS planes de MP (decisión
// 20/08/2026, reemplaza los 3 de docs/06: "SOCIO ACTIVO" y "SOCIO
// ADHERENTE/COLABORADOR" comparten monto). Cache in-memory 24 h con
// stale-on-error: si MP está caído se sirve el último valor bueno antes que
// inventar un monto o tirar abajo el wizard. In-memory alcanza: PM2 corre un
// único proceso (mismo criterio que rate-limiter.ts).
//
// ESTA CACHÉ ES PARA MOSTRAR, NO PARA COBRAR. Desde que las suscripciones se
// crean sin plan asociado (docs/06 §2), el monto que se manda a MP es el que se
// debita: quien vaya a crear o modificar una suscripción tiene que leer el plan
// FRESCO con `mpGateway.getPlan` y abortar si falla, no servirse de acá. Ver
// `startPaymentAction` en `src/app/(public)/asociate/actions.ts` y
// `recategorizeApplicationAction` en `src/app/admin/solicitudes/actions.ts`
// (el `PUT` del monto fija lo que MP debita todos los meses).
//
// Y ojo con el stale-on-error: una lectura fallida NO tira, devuelve en silencio
// el último valor bueno. Para mostrar está bien; para cobrar es un débito
// equivocado que nadie ve fallar.
import { CONFIG_KEYS, configReader } from "@/lib/config";
import type { MemberCategory } from "@/generated/prisma/client";
import { mpGateway, type MpGateway } from "./gateway";

export type FeeAmounts = { active: number; shared: number };

/** El id del plan de MP que le corresponde a una categoría.
 *
 *  Los planes son DOS: "SOCIO ACTIVO" y "SOCIO ADHERENTE/COLABORADOR", y son el
 *  REGISTRO del monto, no un vínculo: la suscripción del vecino se crea sin
 *  `preapproval_plan_id` y COPIA el monto (`asociate/actions.ts`, docs/06 §2).
 *  El id queda igual en `MpSubscription.planId` como plan de referencia —de
 *  dónde salió ese monto—; cuando la Comisión recategoriza, la fila local tiene
 *  que seguir al plan nuevo o la conciliación del M4 (REG-34) va a leer una
 *  divergencia que no existe.
 *
 *  Devuelve `null` si el id todavía no está configurado: no es un error, es que
 *  no hay plan que apuntar. */
export async function planIdForCategory(category: MemberCategory): Promise<string | null> {
  return configReader.getString(
    category === "active" ? CONFIG_KEYS.mpPlanActiveId : CONFIG_KEYS.mpPlanSharedId,
  );
}

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
