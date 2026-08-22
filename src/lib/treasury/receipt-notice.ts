// Qué pasó con el email del recibo recién emitido (spec §6.4). `emailed` es lo
// que `registerCashPaymentAction` (src/app/admin/tesoreria/efectivo/actions.ts)
// deja en la URL de redirect después de un cobro en efectivo; este módulo
// traduce ese valor al cartel que muestra /admin/tesoreria/recibos/[id]. Vive
// acá y no en la página porque es lógica pura -- se prueba sin Next ni React --
// y porque `efectivo/actions.ts` importa `ReceiptEmailOutcome` de acá en vez de
// repetir el literal en dos lugares.
export type ReceiptEmailOutcome = "sent" | "no_email" | "voided" | "error" | "skipped";

export type NoticeKind = "success" | "warning";

export type Notice = { kind: NoticeKind; text: string };

// `satisfies Record<ReceiptEmailOutcome, Notice>` y no `Record<string, Notice>`:
// si `ReceiptEmailOutcome` gana un valor mañana y acá falta la entrada, esto no
// compila. Antes de este módulo el tipo era `Record<string, …>` y una key
// faltante se comía en runtime detrás del `??` de más abajo.
const EMAIL_NOTICE = {
  sent: { kind: "success", text: "Recibo emitido y enviado por email." },
  no_email: { kind: "warning", text: "Recibo emitido. El socio no tiene email: imprimilo." },
  voided: { kind: "warning", text: "Recibo emitido, pero figura anulado y por eso no se envió por email." },
  error: { kind: "warning", text: "Recibo emitido, pero el email no salió. Podés reenviarlo desde acá." },
  skipped: { kind: "success", text: "Recibo emitido." },
} as const satisfies Record<ReceiptEmailOutcome, Notice>;

// Un `?email=` desconocido (URL tipeada a mano, un valor que todavía no está en
// el mapa, o una prototype key como "constructor"/"toString") no puede hacer
// desaparecer la confirmación del cobro: cae en el cartel neutro de "Recibo
// emitido".
export function resolveEmailNotice(value: string | undefined): Notice {
  // `Object.hasOwn` y no un lookup + `??`: `EMAIL_NOTICE` es un objeto literal
  // y hereda de Object.prototype, así que `EMAIL_NOTICE["constructor"]`
  // resuelve a la función Object (verdadera) y el `??` nunca dispararía --
  // el cartel quedaría vacío (sin `kind` ni `text`) para `?email=constructor`.
  if (value !== undefined && Object.hasOwn(EMAIL_NOTICE, value)) {
    return EMAIL_NOTICE[value as ReceiptEmailOutcome];
  }
  return EMAIL_NOTICE.skipped;
}
