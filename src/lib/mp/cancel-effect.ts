// «¿Qué le puedo AFIRMAR al operador que pasa cuando apriete Cancelar el
// débito?» — la pregunta de la pantalla de confirmación, y ninguna de las que ya
// existen sobre el estado de una suscripción (las dos de `subscription-status.ts`
// y la del lote REG-34) la contesta.
//
// Existe porque la confirmación la resolvía con un booleano
// (`status === "authorized"`) y con eso quedaban DOS frases para TRES casos: una
// `paused` caía en la rama negativa y la pantalla decía «el vecino nunca
// autorizó el débito, así que no hay ningún cobro que cortar». Las dos
// afirmaciones son falsas, y lo desmiente el propio `subscription-status.ts`:
// `paused` está en la lista blanca justamente porque **se reanuda y vuelve a
// cobrar**. Es alcanzable —la tabla Vinculadas lista por `isNotCancelled`, así
// que un ex socio con una pausada muestra el botón— y el daño es el de siempre:
// la pantalla que pide confirmar algo irreversible afirmando lo que el código no
// sostiene. Acá, además, el operador podía concluir que el clic era cosmético.
//
// No se aplana con `canStillCharge`: esa es lista BLANCA y contesta «¿puede
// salir plata?». Un estado que MP invente mañana ahí es `false` —no prometemos
// un débito que no existe— y acá tiene que ser su PROPIO caso: «no lo sabemos»
// es lo único honesto que se puede escribir en una confirmación, y desde luego
// no «nunca se autorizó».
//
// PRECONDICIÓN: el llamador ya descartó `cancelled` con `isKnownDead`. Las dos
// pantallas que la usan lo hacen antes (la página muestra su caja verde y la
// acción corta sin red); una `cancelled` acá caería en `unknown`, que sería
// falso, pero no hay camino que llegue.

/** Los CUATRO desenlaces distintos de una cancelación, que son cuatro frases
 *  distintas en pantalla:
 *
 *   - `stops_charging`   — `authorized`: hoy sale plata todos los meses y esto la corta.
 *   - `would_resume`     — `paused`: hoy no cobra, pero una pausa se reanuda.
 *   - `never_authorized` — `pending`: el vecino nunca autorizó nada; lo que se
 *                          corta es que pueda autorizarse más adelante.
 *   - `unknown`          — cualquier otra cosa que MP invente: no se puede
 *                          afirmar ni que cobra ni que no. */
export type CancelEffect = "stops_charging" | "would_resume" | "never_authorized" | "unknown";

export function cancelEffect(status: string): CancelEffect {
  if (status === "authorized") return "stops_charging";
  if (status === "paused") return "would_resume";
  if (status === "pending") return "never_authorized";
  return "unknown";
}

/** La frase de «Al confirmar» de la pantalla de cancelación, una por desenlace.
 *
 *  Vive acá y no en el componente por lo mismo que los avisos de la baja
 *  (`members/auto-debit.ts`): son afirmaciones sobre el dinero de un vecino, y
 *  cada una tiene que poder probarse sin renderizar nada.
 *
 *  `amountLabel` ya viene formateado en es-AR y `statusLabel` ya viene en
 *  minúscula: acá no se formatea, se redacta. */
export function cancelEffectSentence(sub: {
  effect: CancelEffect;
  amountLabel: string | null;
  statusLabel: string;
}): string {
  const fee = sub.amountLabel ? ` de ${sub.amountLabel}` : "";
  switch (sub.effect) {
    case "stops_charging":
      return `Mercado Pago deja de debitarle la cuota${fee} todos los meses.`;
    case "would_resume":
      return "Esta suscripción está pausada: hoy no le está debitando, pero una pausa se reanuda y " +
        `vuelve a cobrar. Al cancelarla, Mercado Pago no le puede volver a debitar la cuota${fee} nunca más.`;
    case "never_authorized":
      return "Esta suscripción está pendiente de autorización: el vecino nunca autorizó el débito, " +
        "así que hoy no le está saliendo plata. Lo que se corta es que pueda autorizarla más " +
        "adelante y empiece a cobrarle sola.";
    case "unknown":
      return `Mercado Pago informa esta suscripción como «${sub.statusLabel}», un estado que el ` +
        "sistema no conoce: no se puede afirmar que no le esté cobrando. Al cancelarla, Mercado " +
        `Pago no le puede volver a debitar la cuota${fee}.`;
  }
}

// EXCEPCIÓN AUTORIZADA (revisión Tarea 13, fase 5B): agregado ESTRICTAMENTE
// ADITIVO. `cancelEffectSentence` de arriba no se toca — la siguen usando las
// pantallas del admin, en TERCERA persona, para un operador que lee sobre "el
// vecino". `/mi/debito/cancelar` es la MISMA confirmación pero leída por el
// propio socio, tres líneas abajo de un título que lo trata de "vos": las
// frases de arriba ahí suenan a que alguien más está mirando su cuenta.
//
// Mismos cuatro casos, mismo cuidado de no mentir (ver el porqué de cada uno
// en el comentario de cabecera de este archivo), en segunda persona:
//
//  - `unknown` además evita la jerga de "un estado que el sistema no conoce":
//    eso describe el CÓDIGO, no algo que el socio necesite entender para
//    decidir si cancela. Tampoco nombra el `statusLabel` crudo de MP —es
//    ruido para quien no administra suscripciones—, sólo admite que no se
//    pudo confirmar y afirma lo único cierto: cancelar corta cualquier cobro
//    futuro.
export function cancelEffectSentenceForMember(sub: {
  effect: CancelEffect;
  amountLabel: string | null;
  statusLabel: string;
}): string {
  const fee = sub.amountLabel ? ` de ${sub.amountLabel}` : "";
  switch (sub.effect) {
    case "stops_charging":
      return `Mercado Pago te deja de debitar la cuota${fee} todos los meses.`;
    case "would_resume":
      return "Esta suscripción está pausada: hoy no te está debitando, pero una pausa se reanuda y " +
        `vuelve a cobrar. Al cancelarla, Mercado Pago no te va a poder debitar la cuota${fee} nunca más.`;
    case "never_authorized":
      return "Esta suscripción está pendiente de autorización: nunca autorizaste el débito, así que " +
        "hoy no te está saliendo plata. Lo que se corta es que puedas autorizarla más adelante y " +
        "que te empiece a cobrar sola.";
    case "unknown":
      return "No pudimos confirmar el estado exacto de tu débito en Mercado Pago; al cancelarlo, no " +
        "se te va a debitar más.";
  }
}
