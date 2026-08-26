// Qué le impide a `scripts/import-padron.ts --prune --yes` borrar UNA ficha,
// como función PURA: sin Prisma, sin Excel y sin `.env`. Vive acá y no adentro
// del `main()` del script porque la regla que decide es estatutaria (REG-04) y
// se prueba con una tabla de casos, no corriendo un borrado físico contra la
// base — mismo criterio que `src/lib/padron/withdrawal-fix.ts`.
import type { MovementType, WithdrawalReason } from "@/generated/prisma/client";
import { REASON_LABELS } from "@/lib/members/labels";

/** El detalle del movimiento de admisión que escribe el import. Es constante
 *  porque la poda lo usa para reconocer una ficha "solo importada": una ficha
 *  con cualquier otro movimiento tiene trabajo hecho a mano encima. */
export const IMPORT_ADMISSION_DETAIL = "import Libro 1 (acta física no digitalizada)";

/** La ficha tal como la trae la consulta de la poda. */
export type PrunableMember = {
  user: { id: number } | null;
  _count: {
    applications: number;
    mpSubscriptions: number;
    payments: number;
    fees: number;
    /** Incluye la membresía del libro que se está podando. */
    memberships: number;
  };
  movements: { type: MovementType; detail: string | null }[];
  withdrawalReason: WithdrawalReason | null;
  reentryBlocked: boolean;
};

/** Motivos por los que ESTA ficha no se puede borrar, en es-AR y listos para el
 *  mensaje del script. Vacío = borrable. */
export function pruneBlockReasons(member: PrunableMember): string[] {
  const reasons: string[] = [];

  // REG-04 (Art. 5 inc. 2) va PRIMERO, y no porque sea más grave que un pago
  // cobrado: es el único motivo que puede aparecer SOLO, sobre una ficha que no
  // tiene nada más colgando. Un expulsado que entró por el import y que
  // desaparece del Excel pasaba los seis chequeos de abajo y se borraba; con él
  // se iban las DOS señales que mira la puerta del wizard
  // (`reentryBlocked || withdrawalReason === "expulsion"`, `eligibility.ts:64`)
  // y su DNI volvía a ser desconocido: el expulsado se asociaba por la web como
  // si nunca hubiera pasado por la vecinal. La prohibición del Art. 5 inc. 2 es
  // permanente y sobrevive al libro —el Módulo 6 cierra el Libro N° 1 y la
  // prohibición sigue—, así que no puede depender de que una fila siga en una
  // planilla. Se mira el criterio DOBLE, igual que `canReadmit`,
  // `reentryVerdict` y `decideWithdrawalFix`: hay fichas viejas con el motivo
  // puesto y el flag apagado, y el flag se prende también sobre otros motivos.
  const blockSignals: string[] = [];
  if (member.reentryBlocked) blockSignals.push("reingreso bloqueado");
  if (member.withdrawalReason === "expulsion") blockSignals.push(`motivo "${REASON_LABELS.expulsion}"`);
  if (blockSignals.length > 0) {
    reasons.push(
      `no puede reingresar jamás — REG-04, Art. 5 inc. 2 (${blockSignals.join(" + ")}): ` +
        `borrar la ficha le devolvería el alta por la web`,
    );
  }

  const c = member._count;
  if (member.user) reasons.push("tiene cuenta de acceso");
  if (c.applications > 0) reasons.push(`${c.applications} solicitud(es)`);
  if (c.mpSubscriptions > 0) reasons.push(`${c.mpSubscriptions} suscripción(es) de Mercado Pago`);
  if (c.payments > 0) reasons.push(`${c.payments} pago(s)`);
  if (c.fees > 0) reasons.push(`${c.fees} cuota(s)`);
  // Membresía en otro libro: borrar al socio dejaría esa otra ficha rota (y la
  // FK, que es Restrict, haría fallar el borrado a mitad de camino).
  if (c.memberships > 1) reasons.push(`membresía en ${c.memberships - 1} libro(s) más`);
  // Cualquier movimiento que no sea la admisión que escribió este import es
  // trabajo hecho desde el panel (una baja asentada, un cambio de categoría).
  const handMade = member.movements.filter(
    (mv) => !(mv.type === "admission" && mv.detail === IMPORT_ADMISSION_DETAIL),
  );
  if (handMade.length > 0) reasons.push(`${handMade.length} movimiento(s) cargados a mano`);

  return reasons;
}
