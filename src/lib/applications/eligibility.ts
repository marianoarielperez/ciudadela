// Bloqueos del paso 3 del wizard (spec M3 §4). Regla PURA: la action junta los
// insumos (ficha por DNI, solicitud viva, último rechazo) y esta función decide.
// Los mensajes son user-facing es-AR y NO revelan más de lo necesario: el
// suspendido ve lo mismo que el vigente, el expulsado ve lo mismo que
// cualquier "acercate a la sede" (anti-enumeración + Ley 25.326).
import type { Member } from "@/generated/prisma/client";

export const REJECTION_BLOCK_MONTHS = 6; // REG-05

// Un único literal para TODOS los desvíos a la sede: expulsión, fallecimiento y
// anulación por duplicado deben ser indistinguibles desde afuera.
const VISIT_OFFICE_MESSAGE = "No podemos procesar tu solicitud por este medio. Acercate a la sede vecinal.";

export type EligibilityBlock =
  | { code: "in_progress"; error: string; applicationId: number }
  | { code: "already_member"; error: string }
  | { code: "visit_office"; error: string }
  | { code: "debt"; error: string }
  | { code: "rejected_wait"; error: string; retryAt: Date };

export type Eligibility = { ok: true; memberId: number | null } | ({ ok: false } & EligibilityBlock);

type MemberSlice = Pick<
  Member,
  "id" | "status" | "withdrawalReason" | "debtAtWithdrawal" | "reentryBlocked" | "rejectedUntil"
>;

function addMonthsUtc(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

export function checkEligibility(input: {
  member: MemberSlice | null;
  liveApplication: { id: number } | null;
  lastRejectionAt: Date | null;
  now: Date;
}): Eligibility {
  const { member, liveApplication, lastRejectionAt, now } = input;

  // 1. Una solicitud viva gana a todo: la respuesta correcta es retomarla,
  //    no diagnosticar el estado del padrón.
  if (liveApplication) {
    return {
      ok: false,
      code: "in_progress",
      applicationId: liveApplication.id,
      error: "Ya tenés una solicitud en trámite. Te podemos reenviar por email el enlace para retomarla.",
    };
  }

  if (member) {
    // 2. Vigente o suspendido: mismo mensaje (no se revela la suspensión).
    if (member.status === "active" || member.status === "suspended") {
      return { ok: false, code: "already_member", error: "Ya estás asociado/a a la vecinal." };
    }
    // 3. Expulsión (REG-04): genérico, sin nombrar el motivo. Doble señal como
    //    en canReadmit: flag O motivo, cualquiera alcanza.
    if (member.reentryBlocked || member.withdrawalReason === "expulsion") {
      return { ok: false, code: "visit_office", error: VISIT_OFFICE_MESSAGE };
    }
    // 3bis. Fallecimiento o anulación por duplicado (decisión 20/08/2026): un DNI
    //    vivo contra una ficha de fallecido es error de datos o suplantación, y la
    //    ficha anulada tiene su gemela real en el padrón. Mismo mensaje genérico
    //    que la expulsión: no se revela el motivo, lo resuelve la sede.
    if (member.withdrawalReason === "death" || member.withdrawalReason === "duplicate_annulment") {
      return { ok: false, code: "visit_office", error: VISIT_OFFICE_MESSAGE };
    }
    // 4. Deuda de tesorería (REG-16, pedido del cliente): mora o deuda al bajar.
    if (member.withdrawalReason === "arrears" || member.debtAtWithdrawal) {
      return {
        ok: false,
        code: "debt",
        error: "Tenés una deuda pendiente con tesorería. Acercate a la sede vecinal para regularizarla.",
      };
    }
    // 5. Rechazo reciente sobre la ficha (REG-05).
    if (member.rejectedUntil && member.rejectedUntil > now) {
      return rejectedWait(member.rejectedUntil);
    }
  }

  // 5bis. Rechazo reciente SIN ficha: sale de la propia Application rechazada.
  if (lastRejectionAt) {
    const retryAt = addMonthsUtc(lastRejectionAt, REJECTION_BLOCK_MONTHS);
    if (retryAt > now) return rejectedWait(retryAt);
  }

  // 6. Ex socio sin bloqueo → reingreso (REG-25); DNI desconocido → alta común.
  return { ok: true, memberId: member?.id ?? null };
}

function rejectedWait(retryAt: Date): Eligibility {
  return {
    ok: false,
    code: "rejected_wait",
    retryAt,
    error: "No podés presentar una nueva solicitud por el momento. Vas a poder reintentar más adelante.",
  };
}
