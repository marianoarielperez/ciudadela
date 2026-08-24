// Qué le dice la pantalla de salud al operador después de apretar «Reenviar».
//
// Vive afuera de la server action por dos motivos. El práctico: un archivo
// `"use server"` sólo puede exportar funciones async, así que una tabla de
// mensajes no entra ahí. El de fondo: es la parte que más fácil se rompe y la
// que más caro sale que esté mal.
//
// El caso que la obliga a existir es el bloqueo por `EMAIL_ALLOWLIST`. En
// producción la variable está puesta hasta el checklist de lanzamiento, y el
// estado `not_attempted` del panel de recibos está lleno, justamente, de envíos
// que la allowlist frenó. Ofrecer «Reenviar» ahí y quedarse muda —o peor,
// decir "listo"— sería el botón mintiendo: se vuelve a bloquear y el operador
// piensa que el recibo salió. `sendReceiptEmail` devuelve el `code` intacto
// desde `transport.ts`; lo único que faltaba era traducirlo.
import { ALLOWLIST_BLOCK_CODE } from "@/lib/email/transport";
import type { ReceiptEmailResult } from "@/lib/treasury/receipt-email";

export type ResendOutcome = { ok?: string; error?: string };

export function describeResendResult(result: ReceiptEmailResult, number: string): ResendOutcome {
  if (result.sent) return { ok: `Recibo ${number} enviado por email.` };
  if (result.reason === "no_email") {
    return { error: `El destinatario del recibo ${number} no tiene una casilla utilizable. Cargale el email en su ficha y volvé a intentar.` };
  }
  if (result.reason === "voided") {
    return { error: `El recibo ${number} está anulado: no se envía por email.` };
  }
  if (result.code === ALLOWLIST_BLOCK_CODE) {
    // El texto nombra la variable a propósito: quien mira esta pantalla es el
    // superadmin, que es la misma persona que puede sacarla del `.env`.
    return {
      error: `El recibo ${number} no salió: este entorno tiene los envíos de email restringidos (EMAIL_ALLOWLIST) y ningún correo sale fuera de la lista. Reintentar no cambia nada; se resuelve sacando la variable del .env del servidor.`,
    };
  }
  if (result.code === "not_found") {
    return { error: `No se encontró el recibo ${number}.` };
  }
  return {
    error: `El recibo ${number} no se pudo enviar. El correo falló con el código ${result.code ?? "desconocido"}.`,
  };
}
