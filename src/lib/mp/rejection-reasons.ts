// `status_detail` de Mercado Pago → castellano rioplatense (spec 4C §7.4).
//
// Los textos se interpolan A MITAD DE FRASE ("...intentó debitar tu cuota y no
// pudo: <motivo>"), así que arrancan en minúscula y no llevan punto final.
//
// El catálogo de MP puede crecer sin avisar: lo que no está mapeado cae en el
// genérico y NUNCA se le muestra al socio el código crudo — "tu pago fue
// rechazado por cc_rejected_high_risk" no le dice nada a un vecino y encima
// suena a acusación.
//
// Módulo PURO: sin Prisma, sin gateway, sin SDK. Lo leen la plantilla del correo
// y el procesador del webhook, y su test no necesita fixtures.
export const REJECTION_REASONS: Readonly<Record<string, string>> = {
  cc_rejected_insufficient_amount: "la tarjeta no tenía fondos suficientes",
  // MP no dice "inhabilitada para compras automáticas" —eso sería una
  // restricción más chica que la real—: dice tarjeta inactiva o no habilitada
  // para comprar por internet. Y la salida es una sola: llamar al emisor. Sin
  // esa frase el vecino se queda mirando el rechazo sin saber qué hacer, y este
  // es el segundo motivo más frecuente del débito recurrente.
  cc_rejected_card_disabled: "la tarjeta está inactiva o no habilitada para comprar por internet, y hay que pedirle al banco que la active",
  cc_rejected_call_for_authorize: "el banco pide que autorices el cobro antes de aprobarlo",
  cc_rejected_bad_filled_card_number: "el número de tarjeta registrado no es correcto",
  cc_rejected_bad_filled_date: "la fecha de vencimiento de la tarjeta no es correcta",
  cc_rejected_bad_filled_security_code: "el código de seguridad de la tarjeta no es correcto",
  cc_rejected_bad_filled_other: "alguno de los datos de la tarjeta no es correcto",
  cc_rejected_card_error: "hubo un problema con la tarjeta",
  // MP dice que el TIPO de tarjeta no está permitido para este cobro, que no es
  // lo mismo que "no tiene habilitada la función crédito": puede ser una
  // prepaga, una emitida en el exterior o una marca que el cobro no acepta.
  // Afirmar "crédito" es el mismo invento que se corrigió en `card_disabled`.
  cc_rejected_card_type_not_allowed: "ese tipo de tarjeta no está habilitado para este cobro, y hay que pagarlo con otra",
  cc_rejected_duplicated_payment: "figura como un pago repetido",
  // "Mercado Pago no autorizó el cobro" no puede ir tal cual: el texto se
  // interpola a mitad de frase (arranca en minúscula) y la oración ya nombra a
  // Mercado Pago al principio. Y no se dice "riesgo": el socio no hizo nada.
  cc_rejected_high_risk: "el sistema de seguridad de Mercado Pago no autorizó el cobro",
  cc_rejected_max_attempts: "se superó la cantidad de intentos permitidos",
  cc_rejected_invalid_installments: "la tarjeta no admite este tipo de cobro",
  cc_rejected_blacklist: "el sistema de seguridad de Mercado Pago no autorizó el cobro",
  // 3DS: la autenticación con el banco quedó sin completar. Viene creciendo en
  // la Argentina, así que dejarla caer en el genérico es perder un caso
  // frecuente. Pero NO se le dice "autorizala desde tu banco": el challenge de
  // 3DS se completa DURANTE el cobro, y en un débito recurrente el socio no
  // estaba delante de nada. Ese cobro ya no se puede autorizar después; lo que
  // queda es rehacerlo, y esas salidas las nombra el párrafo siguiente del
  // correo (revisar el medio de pago, la sede, un link). Acá sólo se cuenta qué
  // pasó.
  cc_rejected_3ds_mandatory: "el banco pidió una verificación extra que no llegó a completarse",
  cc_rejected_3ds_challenge: "quedó pendiente una verificación con el banco que no llegó a completarse",
  cc_rejected_other_reason: "el banco rechazó el cobro",
  cc_rejected_time_out: "el banco no respondió a tiempo",
  // El tope es del medio de pago DENTRO de Mercado Pago, no del crédito de la
  // tarjeta: decir "el límite de la tarjeta" manda al vecino a llamar a un banco
  // que no tiene nada que arreglar.
  cc_amount_rate_limit_exceeded: "se superó el límite que Mercado Pago tiene para ese medio de pago",
  bank_error: "hubo un error del banco al procesar el cobro",
  rejected_by_bank: "el banco rechazó el cobro",
  rejected_by_regulations: "una restricción normativa impidió el cobro",
  rejected_insufficient_data: "faltaban datos para procesar el cobro",
};

// Honesto y sin inventar: cuando MP manda un `status_detail` que todavía no
// conocemos —el caso MÁS frecuente del genérico, porque el catálogo crece sin
// avisar— sí informó el motivo; los que no lo podemos identificar somos
// nosotros. "No nos informó el motivo" era falso justo en ese caso.
const GENERIC = "el medio de pago rechazó el cobro y no pudimos identificar el motivo";

/** El motivo en es-AR, apto para un correo al socio. Lo no mapeado cae en un
 *  genérico: nunca se muestra el código crudo de MP. */
export function rejectionReason(statusDetail: string | null | undefined): string {
  return (statusDetail && REJECTION_REASONS[statusDetail]) || GENERIC;
}
