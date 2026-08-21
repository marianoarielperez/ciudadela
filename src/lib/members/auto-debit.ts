// El aviso que le dice al operador que la baja o el cambio de categoría que está
// por registrar NO toca el débito automático del socio en Mercado Pago.
//
// El hecho que lo justifica: `withdrawAction` y `changeCategoryAction`
// (admin/socios/[id]/actions.ts) escriben la ficha, el acta y la auditoría, y
// nada más. Cancelar o reajustar el preapproval está planificado para los
// Módulos 4/5. Hasta entonces, a un socio dado de baja se le sigue debitando la
// cuota todos los meses, y a uno recategorizado se le sigue cobrando el monto
// viejo. Es plata real de un vecino: la pantalla tiene que decirlo antes, no el
// socio tres meses después.
//
// QUÉ SE MIRA, y por qué las dos señales
// --------------------------------------
// Ninguna de las dos alcanza sola:
//
//  - `Member.autoDebit` es la columna `debito_automatico` del padrón importado
//    (`scripts/import-padron.ts`). Marca fichas viejas cuyo débito se gestionó
//    en el panel de MP a mano, mucho antes de que existiera este sistema: hay
//    débito vivo y NO hay ninguna fila local que lo represente.
//  - `MpSubscription` con `memberId` es la suscripción que el sistema conoce:
//    la creó el Módulo 3 al asociarse el vecino, o la vinculó un admin. Una
//    ficha nueva tiene fila y puede tener el flag en `false` (nadie lo edita al
//    completar el asiento).
//
// Así que el aviso sale con CUALQUIERA de las dos. Preferir una sola dejaría
// medio padrón sin aviso, y el costo de equivocarse es asimétrico: un aviso de
// más manda al operador a mirar el panel de MP y no encontrar nada; uno de
// menos le sigue cobrando a un vecino que se dio de baja.
//
// Sobre el estado de la suscripción: `cancelled` es lo ÚNICO que se puede
// afirmar como "acá no hay débito". El catálogo de estados es de MP y puede
// crecer (`pending`, `authorized`, `paused`…), así que se descarta por lista
// negra de un solo valor y cualquier estado desconocido cuenta como débito
// posible — el mismo criterio, invertido, que `lateEntryNotice` en
// applications/query.ts, donde no saber es peor que avisar.

/** ¿Hay que avisar que este socio puede tener un débito vivo en MP? */
export function hasLiveAutoDebit(input: {
  /** `Member.autoDebit`: el flag importado del padrón. */
  autoDebit: boolean;
  /** Estados de las filas de `mp_subscriptions` de este socio (puede haber más
   *  de una: una cancelada y una viva, si el débito se rehízo). */
  subscriptionStatuses: string[];
}): boolean {
  if (input.autoDebit) return true;
  return input.subscriptionStatuses.some((s) => s !== "cancelled");
}

/** El texto es distinto por acción porque lo que hay que hacer en MP es
 *  distinto: en la baja hay que CANCELAR el débito; en el cambio de categoría,
 *  AJUSTAR el monto a la cuota de la categoría nueva. Decir "gestionalo" a secas
 *  deja al operador adivinando. */
export const AUTO_DEBIT_WARNINGS = {
  baja:
    "Este socio tiene débito automático en Mercado Pago. El sistema NO lo cancela: la baja queda " +
    "registrada acá, pero la cuota se le va a seguir debitando todos los meses hasta que canceles " +
    "la suscripción a mano en el panel de Mercado Pago.",
  categoria:
    "Este socio tiene débito automático en Mercado Pago. El sistema NO ajusta el monto: el cambio " +
    "de categoría queda registrado acá, pero se le va a seguir debitando la cuota de la categoría " +
    "anterior hasta que actualices la suscripción a mano en el panel de Mercado Pago.",
} as const;
