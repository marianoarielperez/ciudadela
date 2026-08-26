// Qué hace `scripts/fix-withdrawal-reasons.ts` con cada fila del padrón, como
// función PURA: sin Prisma, sin Excel y sin `.env`. Las reglas que decide son
// estatutarias (REG-04 sobre todo), así que se prueban con una tabla de casos y
// no corriendo el script contra la base — mismo criterio que
// `src/lib/applications/eligibility.ts`.
//
// Las reglas están enunciadas en la cabecera del script; acá viven sus dos
// mitades duras:
//   · Regla 1: el ESTADO societario no se toca por script, en ninguna dirección.
//   · Regla 2: el bloqueo de reingreso se PRENDE, nunca se apaga — y eso vale
//     para las DOS señales que mira la puerta del wizard
//     (`reentryBlocked || withdrawalReason === "expulsion"`), no sólo para el
//     flag: degradar el motivo de una expulsión la borra igual.
import type { MemberStatus, WithdrawalReason } from "@/generated/prisma/client";
import { REASON_LABELS } from "@/lib/members/labels";
import { mapWithdrawalReason } from "@/lib/padron/mapping";

export type WithdrawalFixRow = {
  memberNumber: number;
  rowNumber: number;
  /** Ya normalizado por `isWithdrawnRow`: acá no llega una celda ambigua. */
  withdrawn: boolean;
  motivo: string | null;
  /** Sólo dígitos, o `null`. */
  dni: string | null;
};

export type WithdrawalFixMember = {
  fullName: string;
  dni: string | null;
  status: MemberStatus;
  withdrawalReason: WithdrawalReason | null;
  reentryBlocked: boolean;
};

export type WithdrawalFixDecision =
  | { kind: "skip" } // no es asunto de este script
  | { kind: "unchanged" } // la ficha ya dice lo que dice el padrón
  | { kind: "discrepancy"; message: string } // lo resuelve un humano, con acta
  | { kind: "plan"; to: WithdrawalReason; blockTo: boolean };

const label = (r: WithdrawalReason | null) => (r === null ? "sin motivo" : REASON_LABELS[r]);
const digits = (s: string | null) => (s ?? "").replace(/\D/g, "") || null;

/** Decide qué hacer con UNA fila del padrón contra la ficha de la base
 *  (`undefined` si el número de socio no existe en el Libro N° 1). */
export function decideWithdrawalFix(
  row: WithdrawalFixRow,
  member: WithdrawalFixMember | undefined,
): WithdrawalFixDecision {
  const who = `socio ${row.memberNumber}`;

  if (!member) {
    // Sólo se reporta si el Excel lo da de baja: los vigentes que falten en la
    // base son asunto del import, no de este script.
    return row.withdrawn
      ? { kind: "discrepancy", message: `${who} (fila ${row.rowNumber}): está en el Excel y NO en la base` }
      : { kind: "skip" };
  }

  // Regla 1: el estado societario no se toca por script, en ninguna dirección.
  if (row.withdrawn && member.status !== "withdrawn") {
    return {
      kind: "discrepancy",
      message:
        `${who} ${member.fullName}: el Excel lo da de BAJA y en la base está ` +
        `"${member.status}" — se resuelve con acta desde el panel, no acá`,
    };
  }
  if (!row.withdrawn) {
    if (member.status === "withdrawn") {
      return {
        kind: "discrepancy",
        message:
          `${who} ${member.fullName}: el Excel lo da por VIGENTE y en la base está ` +
          `dado de baja (${label(member.withdrawalReason)}) — se resuelve con acta desde el panel, no acá`,
      };
    }
    return { kind: "skip" };
  }

  // Cruce de identidad: el número de socio es la clave, pero si las dos puntas
  // tienen DNI y no coinciden, no estamos mirando a la misma persona.
  if (row.dni && member.dni && digits(member.dni) !== row.dni) {
    return {
      kind: "discrepancy",
      message:
        `${who} ${member.fullName}: el DNI del Excel no coincide con el de la ficha — ` +
        `no se toca nada hasta que se aclare cuál es la persona`,
    };
  }

  const { reason } = mapWithdrawalReason(row.motivo);
  // Regla 3: un motivo vacío o que el mapeo no entiende no pisa lo que ya hay.
  if (reason === null || reason === "other") {
    // Que los conteos del encabezado CIERREN: cada baja del Excel termina en
    // exactamente uno de los tres contadores. Un resto invisible es una fila que
    // nadie revisa.
    if (member.withdrawalReason === reason) return { kind: "unchanged" };
    return {
      kind: "discrepancy",
      message:
        `${who} ${member.fullName}: motivo_baja ${
          row.motivo === null ? "vacío" : `"${row.motivo}" (no mapeado)`
        } — la ficha conserva "${label(member.withdrawalReason)}"`,
    };
  }

  // Regla 2, la otra mitad: una EXPULSIÓN asentada no se degrada por lo que diga
  // una celda. La puerta del wizard bloquea por `reentryBlocked` O por el motivo
  // (`eligibility.ts:64`), y hay fichas viejas —importadas o arregladas a mano—
  // con el motivo puesto y el flag en `false` (ver `members/history.ts`): pisar
  // el motivo con "Mora" borraría en ellas la ÚNICA señal que queda y el
  // expulsado se asociaría por la web. Degradar una expulsión es una decisión con
  // acta, nunca el efecto colateral de leer un Excel: se reporta.
  if (member.withdrawalReason === "expulsion" && reason !== "expulsion") {
    return {
      kind: "discrepancy",
      message:
        `${who} ${member.fullName}: la ficha dice "${label("expulsion")}" y el Excel dice ` +
        `"${label(reason)}" — degradarla reabriría el reingreso que REG-04 cierra para siempre: ` +
        `se resuelve con acta desde el panel, no acá`,
    };
  }

  // Regla 2: el bloqueo se prende, nunca se apaga.
  const blockTo = member.reentryBlocked || reason === "expulsion";
  if (member.withdrawalReason === reason && member.reentryBlocked === blockTo) {
    return { kind: "unchanged" };
  }
  return { kind: "plan", to: reason, blockTo };
}
