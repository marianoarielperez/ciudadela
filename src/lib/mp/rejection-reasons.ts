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
  cc_rejected_card_disabled: "la tarjeta está inhabilitada para compras automáticas",
  cc_rejected_call_for_authorize: "el banco pide que autorices el cobro antes de aprobarlo",
  cc_rejected_bad_filled_card_number: "el número de tarjeta registrado no es correcto",
  cc_rejected_bad_filled_date: "la fecha de vencimiento de la tarjeta no es correcta",
  cc_rejected_bad_filled_security_code: "el código de seguridad de la tarjeta no es correcto",
  cc_rejected_bad_filled_other: "alguno de los datos de la tarjeta no es correcto",
  cc_rejected_card_error: "hubo un problema con la tarjeta",
  cc_rejected_duplicated_payment: "figura como un pago repetido",
  // "Mercado Pago no autorizó el cobro" no puede ir tal cual: el texto se
  // interpola a mitad de frase (arranca en minúscula) y la oración ya nombra a
  // Mercado Pago al principio. Y no se dice "riesgo": el socio no hizo nada.
  cc_rejected_high_risk: "el sistema de seguridad de Mercado Pago no autorizó el cobro",
  cc_rejected_max_attempts: "se superó la cantidad de intentos permitidos",
  cc_rejected_invalid_installments: "la tarjeta no admite este tipo de cobro",
  cc_rejected_blacklist: "el sistema de seguridad de Mercado Pago no autorizó el cobro",
  cc_rejected_other_reason: "el banco rechazó el cobro",
  cc_amount_rate_limit_exceeded: "se superó el límite de la tarjeta",
  rejected_by_bank: "el banco rechazó el cobro",
  rejected_insufficient_data: "faltaban datos para procesar el cobro",
};

// Honesto y sin inventar: cuando MP no manda `status_detail` —o manda uno que
// todavía no conocemos— lo único que sabemos es que el cobro no salió.
const GENERIC = "el medio de pago rechazó el cobro y no nos informó el motivo";

/** El motivo en es-AR, apto para un correo al socio. Lo no mapeado cae en un
 *  genérico: nunca se muestra el código crudo de MP. */
export function rejectionReason(statusDetail: string | null | undefined): string {
  return (statusDetail && REJECTION_REASONS[statusDetail]) || GENERIC;
}
