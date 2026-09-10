// Las guardas por socio del reparto (spec 2026-09-10 §5.2 paso 3) y, desde la
// Task 7, la vista previa y el token de confirmación. Prisma inyectado: la
// action las usa para PRE-validar con mensaje, y el núcleo las vuelve a correr
// —la misma función, no una copia— antes de escribir.
import type { PrismaClient } from "@/generated/prisma/client";
import { countPendingFees } from "./account";
import { activeExemption } from "./exemptions";
import { cashConceptsFor, type CashConcept } from "./rules";
import { SPLIT_GUARD_MESSAGES as M } from "./split-messages";

/** Una parte del reparto, como la decide el operador. `n` es 0 para los aportes. */
export type SplitPartPlan = { memberId: number; concept: CashConcept; n: number; amount: number };

/** La primera guarda que corta, redactada, o `null` si todas pasan: socio
 *  existente; cesante → sólo `fees` y no más cuotas que sus pendientes;
 *  concepto según categoría (`cashConceptsFor`, la MISMA función que Efectivo);
 *  exento → sólo aportes (`activeExemption`, la MISMA función que las otras
 *  cinco guardas de cobro). */
export async function splitPartGuards(
  db: Pick<PrismaClient, "member" | "fee" | "feeExemption">,
  parts: SplitPartPlan[],
  at: Date = new Date(),
): Promise<string | null> {
  for (const p of parts) {
    const member = await db.member.findUnique({
      where: { id: p.memberId },
      select: { id: true, category: true, status: true },
    });
    if (!member) return M.memberGone;
    if (member.status === "withdrawn" && p.concept !== "fees") return M.withdrawnConcept;
    if (!cashConceptsFor(member.category).includes(p.concept)) return M.conceptCategory;
    if (p.concept === "fees") {
      if (member.status === "withdrawn") {
        const pending = await countPendingFees(db, member.id);
        if (p.n > pending) return M.withdrawnCount(pending);
      }
      const exemption = await activeExemption(db, member.id, at);
      if (exemption) return M.exempt(exemption);
    }
  }
  return null;
}
