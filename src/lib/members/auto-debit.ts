// El aviso que le dice al operador que la baja o el cambio de categoría que está
// por registrar NO toca el débito automático del socio en Mercado Pago.
//
// El hecho que lo justifica: `withdrawAction` y `changeCategoryAction`
// (admin/socios/[id]/actions.ts) escriben la ficha, el acta y la auditoría, y
// nada más. Ninguna de las dos toca Mercado Pago, así que a un socio dado de
// baja se le sigue debitando la cuota todos los meses y a uno recategorizado se
// le sigue cobrando el monto viejo hasta que alguien haga algo. Lo que cambió
// con el Módulo 4 es QUÉ hay que hacer: el monto ya se empuja desde el panel
// (lote REG-34, /admin/tesoreria/valores), la cancelación sigue siendo a mano en
// Mercado Pago. Es plata real de un vecino: la pantalla tiene que decirlo antes,
// no el socio tres meses después.
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

/** El texto es distinto por acción porque lo que hay que hacer es distinto: en
 *  la baja hay que CANCELAR el débito —y eso sigue siendo a mano en el panel de
 *  Mercado Pago—; en el cambio de categoría, empujarle el monto nuevo, que
 *  desde el Módulo 4 se hace desde acá con el lote REG-34. Decir "gestionalo" a
 *  secas deja al operador adivinando.
 *
 *  CADA AFIRMACIÓN DE ESTOS DOS TEXTOS SALE DE CÓDIGO, no de lo que el sistema
 *  debería hacer. Si alguno de estos caminos cambia, el texto cambia con él:
 *
 *  `baja`
 *   - Nada cancela la suscripción al dar de baja: `memberService.withdraw`
 *     (members/service.ts) escribe `Member`, los tokens, el `User` y el
 *     `Movement`, y no toca `MpSubscription` ni llama a MP. Los tres llamadores
 *     de `cancelPreapproval` son de SOLICITUDES (rechazo en
 *     admin/solicitudes/actions.ts, vencimiento en applications/cron.ts y
 *     preapproval huérfano en mp/reconcile.ts): ninguno mira socios.
 *   - Un cobro que llega con la suscripción vinculada resuelve como `debit`
 *     (mp/resolve.ts) y `registerPaymentCore` acota `n` a las cuotas pendientes
 *     porque el socio está `withdrawn` (treasury/service.ts): imputa la MÁS
 *     VIEJA (`allocate`), emite recibo y no devenga ni una cuota nueva.
 *   - Sin pendientes devuelve `no_pending_withdrawn`, y el procesador lo manda a
 *     la bandeja con motivo `withdrawn_no_pending` — "Cesante sin deuda" en
 *     pantalla (admin/unmatched-labels.ts). Si la suscripción NO está vinculada
 *     (el flag del padrón sin fila local), el cobro cae en la misma bandeja como
 *     `no_subscription` desde el primer mes.
 *
 *  `categoria`
 *   - `memberService.changeCategory` sólo escribe `Member.category` y el
 *     `Movement`: no toca MP.
 *   - El lote REG-34 (`listDivergent`, mp/fee-value-batch.ts) calcula el monto
 *     esperado con `feeAmountFor(member.category, valor vigente)`, o sea contra
 *     la categoría que el socio tiene AHORA: un recategorizado aparece
 *     divergente en /admin/tesoreria/valores y el lote le empuja el monto nuevo.
 *   - Dos huecos que el lote NO cubre y por eso están en el texto: sólo mira
 *     suscripciones `authorized` con socio vinculado, y saltea las categorías
 *     sin cuota (`feeAmountFor` devuelve null para honorario, vitalicio y
 *     cadete), donde lo que corresponde no es un monto nuevo sino cancelar. */
export const AUTO_DEBIT_WARNINGS = {
  baja:
    "Este socio tiene débito automático en Mercado Pago. El sistema NO lo cancela: Mercado Pago le " +
    "va a seguir cobrando la cuota todos los meses. Mientras le queden cuotas pendientes, cada cobro " +
    "se imputa a la más vieja y emite recibo; cuando no queden —o si la suscripción no está " +
    "vinculada al socio— el cobro cae en Tesorería → Sin conciliar y esa plata, que ya salió de la " +
    "cuenta del vecino, queda esperando una decisión. Para cortar el débito hay que cancelar la " +
    "suscripción a mano en el panel de Mercado Pago.",
  categoria:
    "Este socio tiene débito automático en Mercado Pago. El monto NO se ajusta solo: después de " +
    "registrar el cambio, un superadmin tiene que correr «Aplicar valor vigente» en Tesorería → " +
    "Valores de cuota para empujarle a Mercado Pago la cuota de la categoría nueva. Ese lote sólo " +
    "alcanza a las suscripciones activas y vinculadas a un socio: si la categoría nueva no paga " +
    "cuota (honorario, vitalicio, cadete), no hay monto que empujar y el débito hay que cancelarlo " +
    "a mano en el panel de Mercado Pago.",
} as const;
