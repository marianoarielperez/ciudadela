// El estado electoral de UN socio para su credencial (spec M5 §9). REUTILIZA
// las piezas del padrón electoral de 4C (src/lib/members/electoral.ts) en vez
// de reimplementar la regla: si REG-31 cambia, cambia en un solo lugar.
//
// La definición de `arrears` es la MISMA del padrón: cuotas pendientes de
// períodos ANTERIORES al mes en curso (mora, no "al cobro"). El llamador la
// cuenta con `fee.count({ status: "pending", period: { lt: currentPeriod() } })`.
import type { MemberCategory, MemberStatus } from "@/generated/prisma/client";
import {
  ELECTORAL_CATEGORIES,
  ELECTORAL_MIN_DAYS,
  meetsSeniority,
  seniorityDays,
} from "@/lib/members/electoral";
import { ACCRUING_CATEGORIES } from "@/lib/treasury/rules";

export type ElectoralStatus =
  | { eligible: true }
  | { eligible: false; reason: "category" }
  | { eligible: false; reason: "suspended" }
  | { eligible: false; reason: "seniority"; daysMissing: number }
  | { eligible: false; reason: "arrears"; arrears: number };

export function electoralStatusFor(input: {
  category: MemberCategory;
  status: MemberStatus;
  joinedAt: Date;
  arrears: number;
  at: Date;
}): ElectoralStatus {
  if (!ELECTORAL_CATEGORIES.includes(input.category)) {
    return { eligible: false, reason: "category" };
  }
  // El suspendido no vota (decisión del operador del 23/08/2026, espejo de
  // buildElectoralRoll, que sólo considera `status: "active"`).
  if (input.status !== "active") return { eligible: false, reason: "suspended" };
  if (!meetsSeniority(input.category, input.joinedAt, input.at)) {
    return {
      eligible: false,
      reason: "seniority",
      daysMissing: ELECTORAL_MIN_DAYS - seniorityDays(input.joinedAt, input.at),
    };
  }
  // "Sin mora" es requisito sólo de activos y colaboradores (REG-31).
  if (input.arrears > 0 && (ACCRUING_CATEGORIES as readonly MemberCategory[]).includes(input.category)) {
    return { eligible: false, reason: "arrears", arrears: input.arrears };
  }
  return { eligible: true };
}

/**
 * La frase de la credencial (es-AR, de cara al socio). La del habilitado es
 * UNA sola para todas las categorías y en condicional ("cuando haya") —
 * decisión del cliente del 24/08/2026: nada de sonar a campaña permanente,
 * y sin recordatorios de cuota que a un adherente (aporte voluntario) o a un
 * vitalicio no le aplican. Quien pierda la habilitación por deuda lo va a
 * leer en la rama `arrears`, que es donde el dato es cierto y accionable.
 */
export function electoralSentence(s: ElectoralStatus): string {
  if (s.eligible) {
    return "Cumplís con la antigüedad necesaria para votar cuando haya elecciones.";
  }
  switch (s.reason) {
    case "category":
      return "Tu categoría no participa de las elecciones de la vecinal.";
    case "suspended":
      return "Mientras dure la suspensión no participás de las elecciones.";
    case "seniority":
      return `Vas a poder votar cuando cumplas ${ELECTORAL_MIN_DAYS} días de antigüedad (te faltan ${s.daysMissing}).`;
    case "arrears":
      return "Registrás cuotas pendientes: para votar tenés que estar al día. Podés ponerte al día incluso el día de la elección.";
  }
}
