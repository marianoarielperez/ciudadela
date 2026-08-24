// Tope de envíos por corrida (spec 4C §7.3).
//
// El 23/08/2026 la conciliación recuperó 24 débitos históricos de un socio y le
// mandó los 24 recibos en minutos. Con 160 socios vigentes y sin
// `EMAIL_ALLOWLIST`, un backlog son cientos de correos contra la cuota de Brevo
// —y un vecino que recibe 24 mails no lee ninguno.
//
// El presupuesto se INYECTA por corrida y no es un contador de módulo: el
// procesador del webhook es un singleton de proceso, así que un contador global
// dejaría al webhook sin poder mandar un recibo después de 50 correos desde el
// último restart de PM2.

export const DEFAULT_MAIL_BATCH_CAP = 50;

/** Entero positivo o el default. Un `0` o una basura NO apagan los avisos: un
 *  tope de cero silenciaría el sistema entero por un typo en el `.env`. */
export function mailBatchCap(raw: string | undefined = process.env.MAIL_BATCH_CAP): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_MAIL_BATCH_CAP;
}

export type MailBudget = { take(): boolean; readonly deferred: number };

export function makeMailBudget(cap: number = mailBatchCap()): MailBudget {
  let used = 0;
  let deferred = 0;
  return {
    take() {
      if (used >= cap) {
        deferred++;
        return false;
      }
      used++;
      return true;
    },
    get deferred() {
      return deferred;
    },
  };
}

/** El camino de UN solo email (webhook de un cobro, botón del panel) no cuenta:
 *  ahí el tope no protege de nada y convertiría un envío legítimo en un
 *  diferido invisible. */
export const UNLIMITED_MAIL_BUDGET: MailBudget = { take: () => true, deferred: 0 };
