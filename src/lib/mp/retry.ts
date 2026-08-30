// Reintento ante el límite de ráfaga de Mercado Pago (HTTP 429).
//
// EL PORQUÉ: la conciliación de las 03:00 recorre las suscripciones una por
// una y por cada una hace al menos dos llamadas
// (`authorized_payments/search` + `preapproval`). La primera corrida real en
// producción (24/08/2026) terminó con `errors` así:
//
//   debits: authorized_payments/search respondió 429
//   sync: status=429 local_rate_limited
//   plans.one: status=429 local_rate_limited
//
// O sea: MP no rechazó nada por una regla de negocio, cortó por VELOCIDAD. Un
// cobro que el webhook no entregó queda sin recuperar por eso, y el cron es
// justamente la única red de los débitos de suscripción (un preapproval ignora
// `notification_url`). Reintentar un rato después alcanza.
//
// Se reintenta SÓLO el 429: cualquier otro fallo se propaga igual que antes
// —un 400 no mejora esperando— y sólo se envuelven LECTURAS. Un reintento
// sobre `create`/`cancel`/`update` puede duplicar el efecto: una suscripción de
// más es plata de un vecino.
//
// Sin estado de módulo a propósito (premisa de un solo proceso, `docs/03`): el
// backoff es local a la llamada, no un contador compartido que sobreviva entre
// corridas.
import { describeMpError } from "./error-log";

/** Esperas entre intentos. Dos reintentos: la ráfaga que MP corta dura
 *  segundos, no minutos, y el cron tiene toda la madrugada. Alargar esto
 *  encarece la corrida entera sin comprar nada. */
export const MP_RETRY_DELAYS_MS = [1_000, 3_000] as const;

/** Jitter sumado a cada espera. La cuota que corta el 429 es COMPARTIDA entre
 *  clientes de MP (lo dice su FAQ): con esperas fijas, todos los que chocaron
 *  en la misma ráfaga reintentan otra vez juntos. */
export const MP_RETRY_JITTER_MS = 1_000;

/** Tope para el `Retry-After` del servidor. El mismo máximo que usa el SDK
 *  oficial: un header desmedido no puede colgar la corrida minutos. */
export const MP_RETRY_AFTER_CAP_MS = 30_000;

export type Sleep = (ms: number) => Promise<void>;

const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export type RetryOptions = {
  /** Inyectable para que los tests no duerman de verdad. */
  sleep?: Sleep;
  delays?: readonly number[];
  /** Inyectable para que los tests fijen el jitter. */
  random?: () => number;
};

/** El `Retry-After` que el gateway le colgó al error (en ms), si MP lo mandó.
 *  Sólo llega en los fallos de las búsquedas por `fetch` directo: el SDK lanza
 *  el cuerpo pelado de la respuesta, sin headers. */
function retryAfterMsOf(e: unknown): number | null {
  if (typeof e !== "object" || e === null) return null;
  const v = (e as Record<string, unknown>).retryAfterMs;
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

/** ¿El fallo es el límite de ráfaga de MP?
 *
 *  Se lee con el MISMO criterio que el resto del diagnóstico
 *  (`describeMpError`), que ya sabe que el SDK no lanza `Error` sino el cuerpo
 *  crudo de la respuesta. Las búsquedas por `fetch` directo del gateway le
 *  cuelgan el `status` al `Error` que lanzan justamente para caer acá. */
export function isMpRateLimit(e: unknown): boolean {
  return describeMpError(e).status === 429;
}

/** Corre `fn` y la reintenta mientras MP conteste 429. Cualquier otro error
 *  —y el 429 del último intento— se propaga TAL CUAL: el llamador lo cuenta y
 *  lo loguea como siempre. */
export async function withMpRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const delays = opts.delays ?? MP_RETRY_DELAYS_MS;
  const sleep = opts.sleep ?? realSleep;
  const random = opts.random ?? Math.random;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= delays.length || !isMpRateLimit(e)) throw e;
      // Si el servidor dijo cuánto esperar, eso manda (acotado); si no, la
      // espera propia más el jitter que desincroniza de los demás clientes.
      const hinted = retryAfterMsOf(e);
      await sleep(
        hinted !== null
          ? Math.min(hinted, MP_RETRY_AFTER_CAP_MS)
          : delays[attempt] + Math.round(random() * MP_RETRY_JITTER_MS),
      );
    }
  }
}

/** Envuelve un método de LECTURA del gateway conservando su firma.
 *
 *  Ojo con las búsquedas paginadas: el reintento rehace la búsqueda ENTERA
 *  desde `offset=0`, no la página que falló. Es correcto porque son lecturas
 *  —el resultado se arma de nuevo, no se acumula sobre el anterior— y es lo
 *  más simple que puede estar bien. */
export function retrying<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
  opts: RetryOptions = {},
): (...args: A) => Promise<R> {
  return (...args: A) => withMpRetry(() => fn(...args), opts);
}
