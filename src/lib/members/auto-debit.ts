// El aviso que le dice al operador que la baja o el cambio de categoría que está
// por registrar NO toca el débito automático del socio en Mercado Pago.
//
// El hecho que lo justifica: ninguna de las dos acciones deja el mandato de
// cobro de Mercado Pago intacto de forma segura y silenciosa. Desde la Task 10
// (5B) `changeCategoryAction` (admin/socios/[id]/actions.ts) le empuja el monto
// nuevo a MP EN EL MISMO envío —antes de escribir la ficha, el acta y la
// auditoría— y si MP lo rechaza el cambio de categoría no se registra: no hace
// falta correr nada a mano DESPUÉS. Pero eso sólo alcanza a lo que el cableado
// puede calcular (hay suscripción viva, hay valor de cuota, la categoría nueva
// paga cuota): la Comisión sigue necesitando saber cuándo NO alcanza. La baja
// era distinta hasta la 4C y ya no lo es: `withdrawAction` pasa por
// `withdrawWithDebits` y cancela la suscripción después del commit. Pero
// cancela lo que el sistema CONOCE y puede fallar sin deshacer la baja, así que
// el aviso sigue haciendo falta: dice qué va a pasar y qué queda por hacer si
// no pasa. Es plata real de un vecino: la pantalla tiene que decirlo antes, no
// el socio tres meses después.
//
// QUÉ SE MIRA, y por qué las dos señales
// --------------------------------------
// Ninguna de las dos alcanza sola:
//
//  - `Member.autoDebit` se escribe desde TRES lugares, no uno: el padrón
//    importado (`padron/mapping.ts`, fichas viejas cuyo débito se gestionó a
//    mano en el panel de MP antes de que existiera este sistema), el alta web y
//    el reingreso (`applications/record.ts`, con `app.wantsDebit`) y la
//    vinculación manual (`mp/link-subscription.ts`). Ninguno lo BAJA nunca. Por
//    eso el flag solo dice "en algún momento hubo intención de débito" y NO de
//    dónde salió: los textos de abajo no pueden atribuirle una procedencia.
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
// PERO LAS DOS SEÑALES NO VALEN LO MISMO, y por eso el aviso sabe cuál lo
// disparó. Con una fila local viva, el sistema SABE que el mandato de cobro
// existe y puede hablar en presente. Con el flag del padrón a secas no sabe
// nada: ese dato salió de un Excel de 2026, nadie lo verificó contra MP y el
// socio pudo haber cancelado su débito hace años. Afirmarle al operador que
// "Mercado Pago le va a seguir cobrando" sobre esa base es inventar un hecho:
// exactamente lo que estos textos vinieron a sacar de la pantalla. El aviso del
// flag solo va en condicional y manda a VERIFICAR, no a dar por sentado.
//
// Sobre el estado de la suscripción: `cancelled` es lo ÚNICO que se puede
// afirmar como "acá no hay débito". El catálogo de estados es de MP y puede
// crecer (`pending`, `authorized`, `paused`…), así que se descarta por lista
// negra de un solo valor y cualquier estado desconocido cuenta como débito
// posible — el mismo criterio, invertido, que `lateEntryNotice` en
// applications/query.ts, donde no saber es peor que avisar.
// El predicado vive ahora en `mp/subscription-status.ts`; el argumento, acá.

import { isNotCancelled } from "@/lib/mp/subscription-status";

/** Cuál de las dos señales de débito automático hay, si hay alguna. */
export type AutoDebitSignal =
  /** Hay al menos una fila en `mp_subscriptions` que no está `cancelled`. */
  | "subscription"
  /** Sólo el flag del padrón: ninguna fila local viva. Puede haber filas
   *  CANCELADAS, y por eso el texto de esta señal dice "ninguna suscripción
   *  viva" y no "ninguna suscripción": la ficha, que sí tiene las filas
   *  delante, distingue los dos casos (ver `AutoDebitView`). */
  | "flag_only"
  /** Ni flag ni fila viva. */
  | "none";

/** El ORDEN de las dos ramas importa: la fila local viva gana sobre el flag del
 *  padrón, porque es la única que el sistema puede afirmar. Al revés, un socio
 *  con las dos señales —el caso normal de un alta web sobre una ficha vieja—
 *  recibiría el texto débil ("si ese débito todavía existe") sobre una
 *  suscripción que el sistema tiene delante. */
export function autoDebitSignal(input: {
  /** `Member.autoDebit`: la intención de débito, venga de donde venga (ver la
   *  cabecera: son tres escrituras y ninguna lo baja). */
  autoDebit: boolean;
  /** Estados de las filas de `mp_subscriptions` de este socio (puede haber más
   *  de una: una cancelada y una viva, si el débito se rehízo). */
  subscriptionStatuses: string[];
}): AutoDebitSignal {
  if (input.subscriptionStatuses.some(isNotCancelled)) return "subscription";
  return input.autoDebit ? "flag_only" : "none";
}

/** El texto es distinto por acción porque lo que hay que hacer es distinto: en
 *  la baja hay que CANCELAR el débito —y eso sigue siendo a mano en el panel de
 *  Mercado Pago—; en el cambio de categoría, desde la Task 10 (5B) el sistema
 *  ya le empuja el monto nuevo SOLO, en el mismo envío que registra el cambio.
 *  Decir "gestionalo" a secas deja al operador adivinando.
 *
 *  Y es distinto por SEÑAL (`autoDebitSignal`): con la fila local delante se
 *  afirma, con el flag del padrón a secas se pregunta. El destino también
 *  cambia: el cableado automático (y el lote REG-34, que sigue siendo la red
 *  para lo que ese cableado no alcanza) no llegan a una suscripción que el
 *  sistema no conoce (los dos miran `mp_subscriptions` por `memberId`), así que
 *  mandar a un socio con flag solo al panel de Mercado Pago es la única salida
 *  real que le queda.
 *
 *  CADA AFIRMACIÓN DE ESTOS TEXTOS SALE DE CÓDIGO, no de lo que el sistema
 *  debería hacer. Si alguno de estos caminos cambia, el texto cambia con él:
 *
 *  `baja`
 *   - Desde la 4C la baja SÍ cancela: las dos pantallas que dan de baja —ésta y
 *     el lote de cesantía por mora— pasan por `withdrawWithDebits`
 *     (members/withdraw-with-debits.ts), que después del commit cancela en MP
 *     toda suscripción del socio que no se pueda afirmar muerta. Sigue siendo
 *     best-effort: si MP no contesta, la baja queda igual y el fallo se
 *     REPORTA —la ficha con `?debito=pendiente`, el lote con su tercer balde—,
 *     y por eso el texto promete la cancelación pero nombra la salida. La
 *     salida es un BOTÓN y por eso el texto lo nombra por su rótulo: desde la
 *     enmienda del 24/08/2026, la tabla "Vinculadas" de
 *     /admin/tesoreria/suscripciones ofrece "Cancelar el débito" en toda
 *     suscripción viva de un socio dado de baja
 *     (suscripciones/[preapprovalId]/cancelar). Antes de eso la pantalla era de
 *     sólo lectura y este texto mandaba a un lugar donde no había nada que hacer.
 *   - Lo que la baja NO alcanza es una suscripción sin fila local: el módulo
 *     recorre `mp_subscriptions` por `memberId`. De ahí que `flag_only` diga
 *     que no va a cancelar nada.
 *   - Un cobro que llega con la suscripción vinculada resuelve como `debit`
 *     (mp/resolve.ts) y `registerPaymentCore` acota `n` a las cuotas pendientes
 *     porque el socio está `withdrawn` (treasury/service.ts): imputa la MÁS
 *     VIEJA (`allocate`), emite recibo y no devenga ni una cuota nueva.
 *   - Sin pendientes devuelve `no_pending_withdrawn`, y el procesador lo manda a
 *     la bandeja con motivo `withdrawn_no_pending` — "Cesante sin deuda" en
 *     pantalla (admin/unmatched-labels.ts).
 *   - Un cobro cuya suscripción el sistema NO conoce cae en la misma bandeja
 *     desde el primer mes, pero el MOTIVO depende de la referencia que traiga el
 *     pago (mp/resolve.ts): con una `solicitud:{id}` cuya solicitud ya no existe
 *     sale `application_missing` (fila 7 — el caso real que documenta el
 *     encabezado de resolve.ts) y sólo sin esa referencia sale `no_subscription`
 *     (fila 8). Por eso el texto nombra la BANDEJA, que es lo único igual en los
 *     dos casos, y nunca el motivo.
 *
 *  `categoria`
 *   - Desde la Task 10 (5B), `changeCategoryAction`
 *     (`src/app/admin/socios/[id]/actions.ts`) empuja el monto a Mercado Pago
 *     EN EL MISMO envío, ANTES de escribir el cambio local
 *     (`subscriptionAmountPlan`, `members/subscription-amount.ts`): si MP lo
 *     rechaza, el cambio de categoría no se registra (corte total, mismo
 *     criterio que el resto de las actions). `memberService.changeCategory`
 *     sigue sin tocar MP por su cuenta — es la action la que orquesta el push.
 *   - El lote REG-34 (`listDivergent`, mp/fee-value-batch.ts) sigue siendo la
 *     RED para lo que ese cableado no alcanza a la primera: una suscripción
 *     cuyo espejo local quedó desincronizado porque MP aceptó el monto pero la
 *     escritura del espejo falló, o un socio recategorizado cuando MP todavía
 *     no había avisado la fila.
 *   - Un hueco que ni el cableado ni el lote cubren, y por eso sigue en el
 *     texto: las categorías sin cuota (`feeAmountFor` devuelve null para
 *     honorario, vitalicio y cadete). Ahí no hay monto que empujar — lo que
 *     corresponde es CANCELAR la suscripción, y esa es una decisión humana que
 *     ningún cableado dispara solo. */
export const AUTO_DEBIT_WARNINGS = {
  baja: {
    subscription:
      "Este socio tiene una suscripción de débito automático viva en Mercado Pago. Al registrar la " +
      "baja el sistema la va a cancelar. Si Mercado Pago no acepta la cancelación, la ficha te lo " +
      "avisa al volver y la suscripción te queda en Tesorería → Suscripciones con el botón " +
      "«Cancelar el débito» para reintentarlo: mientras siga viva le va a seguir cobrando la cuota " +
      "todos los meses. Un cobro que llegue " +
      "antes de que se corte se imputa a la cuota pendiente más vieja y emite recibo; si no le " +
      "quedan pendientes, cae en Tesorería → Sin conciliar y esa plata, que ya salió de la cuenta " +
      "del vecino, queda esperando una decisión.",
    flag_only:
      "La ficha de este socio dice que tiene débito automático, pero el sistema no conoce ninguna " +
      "suscripción viva suya en Mercado Pago, ni vinculada ni cancelada: ese dato quedó viejo o " +
      "nunca se vinculó. La baja sólo cancela las suscripciones que el sistema conoce, así que acá " +
      "no va a cancelar nada. Si ese débito todavía existe, cada cobro va a caer en Tesorería → " +
      "Sin conciliar en lugar de imputarse a una cuota. Buscalo en el panel de Mercado Pago: si " +
      "está vivo, cancelalo ahí; si no, no hay nada que hacer.",
  },
  categoria: {
    subscription:
      "Este socio tiene una suscripción de débito automático viva en Mercado Pago. Al registrar el " +
      "cambio de categoría el sistema le empuja el monto de la cuota nueva a Mercado Pago en el " +
      "mismo envío, antes de guardar nada: si Mercado Pago no acepta el monto nuevo, el cambio de " +
      "categoría no se registra y podés reintentarlo. Si la categoría nueva no paga cuota (honorario, " +
      "vitalicio, cadete), no hay monto que empujar y el débito hay que cancelarlo a mano en el " +
      "panel de Mercado Pago: eso el sistema no lo hace solo.",
    flag_only:
      "La ficha de este socio dice que tiene débito automático, pero el sistema no conoce ninguna " +
      "suscripción viva suya en Mercado Pago: ese dato quedó viejo. El empuje automático al " +
      "registrar el cambio no lo alcanza, y el lote «Aplicar valor vigente» de Tesorería → Valores " +
      "de cuota tampoco: los dos sólo tocan suscripciones que el sistema conoce. Si ese débito " +
      "todavía existe, va a seguir cobrando el monto viejo: buscalo en el panel de Mercado Pago y " +
      "ajustalo o cancelalo ahí.",
  },
} as const;
