// Confirmación en dos pasos de la declaración de bajas (M6 §9 etapa B).
//
// Entre la lista de convocados y la baja hay una pantalla que dice A QUIÉNES se
// les está por quitar la condición de socio y en qué acta va a quedar asentado.
// Este módulo es la parte pura de ese paso: sin Prisma, se prueba sin fixtures.
//
// La fila que se muestra la resuelve SIEMPRE el servidor contra la base (ver
// `declareWithdrawalsAction`): el formulario no dicta nombres, ni números de
// socio, ni notificaciones cursadas. Un POST armado a mano no puede mostrar un
// nombre y dar de baja a otra persona.
//
// ── Por qué es un archivo propio y no `treasury/arrears-confirm` ─────────────
// La técnica es la misma —y está deliberadamente calcada— pero el dominio no:
// la cesantía por mora es de tesorería y esto es del re-empadronamiento.
// Importar el de allá ataría el checklist del cierre al módulo de la plata por
// una función de cuatro líneas, y el día que uno de los dos necesite llevar otro
// dato en la huella arrastraría al otro.
//
// `withdrawalConfirmToken` NO es una barrera de seguridad: se deriva de datos
// que el cliente ya tiene (la selección y el acta), así que quien pueda postear
// como superadmin puede calcularlo y saltarse el primer paso en un solo request.
// Eso queda deliberadamente sin bloquear: lo que el token evita es el mis-click
// del operador humano —"esto es lo mismo que confirmé, no algo que cambió en el
// medio"—, no un atacante.
import type { PresentationStatus } from "@/generated/prisma/client";
import type { MinuteSelection } from "@/lib/members/minute-form";

/** Un convocado de la tanda, como lo va a leer el operador antes de confirmar. */
export type WithdrawalConfirmTarget = {
  presentationId: number;
  memberId: number;
  name: string;
  /** Número en el libro que se depura, o `null` si no tiene membresía ahí. */
  memberNumber: number | null;
  /** El estado de la presentación AHORA, no el que mostraba la lista. */
  status: PresentationStatus;
  /** Si la baja se le va a poder notificar por correo o si va al cartel de la
   *  sede. No es un detalle de presentación: de la vía depende CUÁNDO empieza a
   *  correr su ventana de recurso. */
  byEmail: boolean;
  /** Cuántas notificaciones se le cursaron en este proceso. Cero es la señal de
   *  que algo se hizo mal: una baja sin ninguna notificación previa no es
   *  oponible. */
  noticeCount: number;
};

// Huella de "esto es exactamente lo que se confirmó": la selección de
// presentaciones más el acta elegida. No es una firma —no hay secreto y no
// pretende serlo—, es la guarda contra la deriva: si el operador cambia de acta
// o destilda a alguien después de leer la confirmación, lo que se iba a ejecutar
// deja de ser lo que leyó, y la acción vuelve a pedir confirmación en vez de dar
// de baja a ciegas.
export function withdrawalConfirmToken(ids: number[], sel: MinuteSelection): string {
  const selection = [...new Set(ids)].sort((a, b) => a - b).join(",");
  const minute =
    "minuteId" in sel
      ? `m:${sel.minuteId}`
      : `n:${sel.minuteType}:${sel.minuteNumber}:${sel.minuteDate}`;
  return `${selection}|${minute}`;
}
