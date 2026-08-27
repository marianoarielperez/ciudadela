// El veredicto del paso "Tu DNI" del wizard ASOCIATE. Regla PURA: la action
// junta los insumos con `loadEligibilityInputs` y esta función decide qué
// pantalla ve el vecino ANTES de haber cargado ningún dato.
//
// No reimplementa ninguna regla: llama a `checkEligibility` —el único juez de
// elegibilidad— y traduce su resultado a códigos de pantalla. Lo que agrega es
// la capa de privacidad del paso 1:
//   - el nombre viaja ENMASCARADO (`maskedName`, la misma función que el
//     paso 1 de REEMPADRONATE);
//   - el reingreso habilitado es INDISTINGUIBLE del DNI desconocido: que
//     exista una ficha no se le dice a un visitante anónimo, y el `memberId`
//     lo re-resuelve el server al crear la solicitud (decisión del operador);
//   - `in_progress` no lleva nombre: habla de la solicitud, no de la ficha.
import { maskedName } from "@/lib/members/masked-name";
import { checkEligibility } from "./eligibility";
import type { EligibilityInputs } from "./eligibility-inputs";

export type DniCheckVerdict =
  | { ok: true }
  | { ok: false; code: "already_member" | "in_progress" | "visit_office"; maskedName: string | null }
  | { ok: false; code: "debt"; maskedName: string; pendingCount: number }
  | { ok: false; code: "rejected_wait"; maskedName: string | null; retryAt: Date };

export function dniCheckVerdict(input: EligibilityInputs & { now: Date }): DniCheckVerdict {
  const eligibility = checkEligibility(input);
  if (eligibility.ok) return { ok: true };

  const masked = input.member ? maskedName(input.member.fullName) : null;
  switch (eligibility.code) {
    case "in_progress":
      return { ok: false, code: "in_progress", maskedName: null };
    case "debt":
      // `checkEligibility` sólo devuelve `debt` con ficha: sin ficha no hay
      // cuotas que deber. El fallback es para que el tipo cierre.
      return {
        ok: false,
        code: "debt",
        maskedName: masked ?? "",
        pendingCount: input.member?.pendingFees ?? 0,
      };
    case "rejected_wait":
      return { ok: false, code: "rejected_wait", maskedName: masked, retryAt: eligibility.retryAt };
    default:
      return { ok: false, code: eligibility.code, maskedName: masked };
  }
}
