// Bloqueos del paso 4 del wizard (spec M3 §4). Regla PURA: la action junta los
// insumos (ficha por DNI, solicitud viva, último rechazo) y esta función decide.
// Los mensajes son user-facing es-AR y NO revelan más de lo necesario: el
// suspendido ve lo mismo que el vigente, y fallecimiento y anulación comparten
// un genérico de sede (anti-enumeración + Ley 25.326). La EXCEPCIÓN es la
// expulsión asentada como motivo, que desde el 27/08/2026 se nombra con todas
// las letras (decisión del operador, que revierte para este único caso la
// indistinguibilidad del 20/08/2026).
import type { Member } from "@/generated/prisma/client";

export const REJECTION_BLOCK_MONTHS = 6; // REG-05

// Un único literal para los desvíos genéricos a la sede: fallecimiento,
// anulación por duplicado y el flag de bloqueo sin motivo asentado deben ser
// indistinguibles desde afuera.
const VISIT_OFFICE_MESSAGE = "No podemos procesar tu solicitud por este medio. Acercate a la sede vecinal.";

// La expulsión asentada se nombra (decisión del operador, 27/08/2026). La
// ratificación por asamblea es un hecho institucional que el operador afirma
// para todas las expulsiones del padrón; el "no puede reingresar" es REG-04
// (Art. 5 inc. 2). El MISMO texto sale en el chequeo temprano del paso 1 y en
// la guarda del envío del paso 4.
const EXPELLED_MESSAGE =
  "La ficha registra la expulsión de la asociación, ratificada por asamblea. Conforme al estatuto, un socio expulsado no puede reingresar.";

export type EligibilityBlock =
  | { code: "in_progress"; error: string; applicationId: number }
  | { code: "already_member"; error: string }
  | { code: "expelled"; error: string }
  | { code: "visit_office"; error: string }
  | { code: "debt"; error: string }
  | { code: "rejected_wait"; error: string; retryAt: Date };

export type Eligibility = { ok: true; memberId: number | null } | ({ ok: false } & EligibilityBlock);

type MemberSlice = Pick<Member, "id" | "status" | "withdrawalReason" | "reentryBlocked" | "rejectedUntil"> & {
  /** Cuotas pendientes en la cuenta corriente (M4). */
  pendingFees: number;
};

/** Exportada porque el rechazo del panel calcula con ella el `rejectedUntil` de
 *  la ficha (REG-05): el bloqueo que se ESCRIBE al rechazar y el que se LEE acá
 *  tienen que salir de la misma aritmética, o el vecino vería una fecha de
 *  reintento distinta de la que el sistema respeta. */
export function addMonthsUtc(date: Date, months: number): Date {
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
    // 3. Expulsión ASENTADA como motivo (REG-04): se nombra, con su
    //    ratificación por asamblea (decisión del operador, 27/08/2026). Sólo el
    //    motivo registrado habilita este texto: afirmar una expulsión es
    //    afirmar un hecho sobre la ficha, y el flag suelto no lo acredita.
    if (member.withdrawalReason === "expulsion") {
      return { ok: false, code: "expelled", error: EXPELLED_MESSAGE };
    }
    // 3bis. Flag de bloqueo SIN la expulsión asentada: el bloqueo rige igual
    //    (doble señal, como en canReadmit) pero el mensaje queda genérico — el
    //    dato puede venir sucio del import (fix-withdrawal-reasons pendiente) y
    //    nunca se afirma una expulsión que la ficha no registra como motivo.
    if (member.reentryBlocked) {
      return { ok: false, code: "visit_office", error: VISIT_OFFICE_MESSAGE };
    }
    // 3ter. Fallecimiento o anulación por duplicado (decisión 20/08/2026): un DNI
    //    vivo contra una ficha de fallecido es error de datos o suplantación, y la
    //    ficha anulada tiene su gemela real en el padrón. Mensaje genérico:
    //    no se revela el motivo, lo resuelve la sede.
    if (member.withdrawalReason === "death" || member.withdrawalReason === "duplicate_annulment") {
      return { ok: false, code: "visit_office", error: VISIT_OFFICE_MESSAGE };
    }
    // 4. Deuda de tesorería (REG-16): lo único que bloquea es la deuda VIVA de la
    //    cuenta corriente (M4). El motivo histórico de la baja no bloquea
    //    (decisión del cliente, 22/08/2026): REG-16 dice que saldar la totalidad
    //    de la deuda habilita el reingreso, así que el cesante por mora que paga
    //    en la sede se rehabilita solo, sin que nadie tenga que bajar un flag.
    //    `debtAtWithdrawal` del Libro 1 ya no se lee.
    if (member.pendingFees > 0) {
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
