// Pure statutory guards. Error messages are user-facing (es-AR).
import type { MemberCategory, MemberStatus, WithdrawalReason } from "@/generated/prisma/client";

export type RuleResult = { ok: true } | { ok: false; error: string };

export function canWithdraw(m: { status: MemberStatus }): RuleResult {
  if (m.status === "withdrawn") return { ok: false, error: "El socio ya está dado de baja." };
  return { ok: true };
}

export function canChangeCategory(
  m: { status: MemberStatus; category: MemberCategory },
  newCategory: MemberCategory,
  electionsOngoing: boolean,
): RuleResult {
  if (m.status !== "active") return { ok: false, error: "Solo un socio vigente puede cambiar de categoría." };
  if (m.category === newCategory) return { ok: false, error: "El socio ya tiene esa categoría." };
  if (electionsOngoing) {
    return { ok: false, error: "Hay elecciones en curso: los cambios de categoría están bloqueados (Art. 5° ter)." };
  }
  return { ok: true };
}

export function canSuspend(m: { status: MemberStatus }): RuleResult {
  if (m.status !== "active") return { ok: false, error: "Solo un socio vigente puede ser suspendido." };
  return { ok: true };
}

// Defensa en profundidad: la prohibición de reingreso del expulsado es absoluta
// y sin excepción, así que no puede colgar de un solo flag. `reentryBlocked` lo
// escribe hoy únicamente la baja por expulsión, pero una fila que llegue del
// import, de un arreglo de datos a mano o de una edición futura con el motivo de
// expulsión y el flag en `false` reabriría la puerta en silencio. Cualquiera de
// las dos señales alcanza para bloquear.
export function canReadmit(m: {
  status: MemberStatus;
  reentryBlocked: boolean;
  withdrawalReason?: WithdrawalReason | null;
}): RuleResult {
  if (m.status !== "withdrawn") return { ok: false, error: "Solo un socio dado de baja puede reingresar." };
  if (m.reentryBlocked || m.withdrawalReason === "expulsion") {
    return { ok: false, error: "Baja por expulsión: el reingreso está prohibido por estatuto (Art. 5 inc. 2)." };
  }
  return { ok: true };
}
