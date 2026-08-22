// Confirmación de la cesantía por mora (REG-15, decisión del cliente del
// 22/08/2026): entre la lista de deudores y la baja hay una pantalla que dice
// A QUIÉNES se está por expulsar. Este módulo es la parte pura de ese paso —
// sin Prisma, se prueba sin fixtures.
//
// La fila que se muestra la resuelve SIEMPRE el servidor contra la base (ver
// `declareArrearsAction`): el formulario no dicta nombres ni cuotas.
import type { MinuteSelection } from "@/lib/members/minute-form";

/** Un socio de la tanda, como lo va a leer el operador antes de confirmar. */
export type ArrearsConfirmTarget = {
  memberId: number;
  name: string;
  /** Número del libro ABIERTO, o `null` si no tiene uno vigente. */
  memberNumber: number | null;
  /** Cuotas pendientes AHORA, no las que mostraba la lista. */
  pendingCount: number;
};

// Huella de "esto es exactamente lo que se confirmó": la selección de socios más
// el acta elegida. No es una firma —no hay secreto y no pretende serlo—, es la
// guarda contra la deriva: si el operador cambia de acta o destilda a alguien
// después de leer la confirmación, lo que se iba a ejecutar deja de ser lo que
// leyó, y la acción vuelve a pedir confirmación en vez de expulsar a ciegas.
export function arrearsConfirmToken(ids: number[], sel: MinuteSelection): string {
  const selection = [...new Set(ids)].sort((a, b) => a - b).join(",");
  const minute = "minuteId" in sel
    ? `m:${sel.minuteId}`
    : `n:${sel.minuteType}:${sel.minuteNumber}:${sel.minuteDate}`;
  return `${selection}|${minute}`;
}
