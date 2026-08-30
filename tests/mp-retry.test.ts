import { describe, expect, it, vi } from "vitest";

import {
  isMpRateLimit,
  MP_RETRY_AFTER_CAP_MS,
  MP_RETRY_DELAYS_MS,
  MP_RETRY_JITTER_MS,
  retrying,
  withMpRetry,
} from "@/lib/mp/retry";

/** Un fallo del SDK de Mercado Pago tal como llega al `catch`: el cliente HTTP
 *  hace `throw await response.json()`, o sea un objeto plano con `status`. */
const sdkError = (status: number, message = "rate limited") => ({
  message,
  error: "local_rate_limited",
  status,
  cause: [],
});

/** Un fallo de las búsquedas por `fetch` directo: el gateway lanza un `Error`
 *  con el `status` colgado —y, si MP lo mandó, el `Retry-After` en ms—, que es
 *  lo que lo hace reconocible acá. */
const httpError = (status: number, retryAfterMs?: number) =>
  Object.assign(new Error(`authorized_payments/search respondió ${status}`), {
    status,
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  });

function recordingSleep() {
  const waited: number[] = [];
  return { waited, sleep: async (ms: number) => void waited.push(ms) };
}

describe("isMpRateLimit", () => {
  it("reconoce el 429 del SDK y el de las búsquedas por fetch", () => {
    expect(isMpRateLimit(sdkError(429))).toBe(true);
    expect(isMpRateLimit(httpError(429))).toBe(true);
  });

  it("no confunde otros fallos con un límite de ráfaga", () => {
    expect(isMpRateLimit(sdkError(500))).toBe(false);
    expect(isMpRateLimit(httpError(400))).toBe(false);
    expect(isMpRateLimit(new Error("ETIMEDOUT"))).toBe(false);
    expect(isMpRateLimit(undefined)).toBe(false);
  });
});

describe("withMpRetry", () => {
  it("429 → 429 → éxito: devuelve el resultado y espera con pausa creciente", async () => {
    const { waited, sleep } = recordingSleep();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(sdkError(429))
      .mockRejectedValueOnce(sdkError(429))
      .mockResolvedValueOnce("ok");

    await expect(withMpRetry(fn, { sleep, random: () => 0 })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
    expect(waited).toEqual([...MP_RETRY_DELAYS_MS]);
  });

  it("429 persistente: tres intentos y el error se propaga tal cual", async () => {
    const { waited, sleep } = recordingSleep();
    const boom = sdkError(429);
    const fn = vi.fn().mockRejectedValue(boom);

    await expect(withMpRetry(fn, { sleep, random: () => 0 })).rejects.toBe(boom);
    // Un intento + los dos reintentos: no hay un cuarto.
    expect(fn).toHaveBeenCalledTimes(3);
    expect(waited).toEqual([...MP_RETRY_DELAYS_MS]);
  });

  // La cuota que corta el 429 es COMPARTIDA entre clientes de MP (su FAQ lo
  // dice con todas las letras): con esperas fijas, todos los que chocaron
  // juntos reintentan juntos. El jitter desincroniza.
  it("cada espera suma un jitter aleatorio de hasta MP_RETRY_JITTER_MS", async () => {
    const { waited, sleep } = recordingSleep();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(sdkError(429))
      .mockRejectedValueOnce(sdkError(429))
      .mockResolvedValueOnce("ok");

    await expect(withMpRetry(fn, { sleep, random: () => 0.5 })).resolves.toBe("ok");
    expect(waited).toEqual([
      MP_RETRY_DELAYS_MS[0] + MP_RETRY_JITTER_MS / 2,
      MP_RETRY_DELAYS_MS[1] + MP_RETRY_JITTER_MS / 2,
    ]);
  });

  // Si MP dice cuánto esperar (`Retry-After`) y pide MÁS que la espera propia,
  // insistir antes es regalar el reintento. El jitter se suma IGUAL: la cuota
  // compartida le reparte el mismo header a todos los que chocaron en la
  // ráfaga, y sin jitter volverían a despertarse sincronizados.
  it("un Retry-After mayor que la espera propia la estira, y el jitter se suma igual", async () => {
    const { waited, sleep } = recordingSleep();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(httpError(429, 7_000))
      .mockResolvedValueOnce("ok");

    await expect(withMpRetry(fn, { sleep, random: () => 0.5 })).resolves.toBe("ok");
    expect(waited).toEqual([7_000 + MP_RETRY_JITTER_MS / 2]);
  });

  // Un header corto no acorta nada: la escalada 1 s → 3 s es el piso. Envoy
  // suele mandar los segundos que quedan de la ventana; obedecer un "0.2 s"
  // quemaría los dos reintentos dentro de la misma ventana cortada.
  it("un Retry-After menor que la espera propia NO la acorta: la escalada es el piso", async () => {
    const { waited, sleep } = recordingSleep();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(httpError(429, 200))
      .mockRejectedValueOnce(httpError(429, 200))
      .mockResolvedValueOnce("ok");

    await expect(withMpRetry(fn, { sleep, random: () => 0 })).resolves.toBe("ok");
    expect(waited).toEqual([...MP_RETRY_DELAYS_MS]);
  });

  it("un Retry-After desmedido se recorta al tope: el peor llamador es el webhook", async () => {
    const { waited, sleep } = recordingSleep();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(httpError(429, 120_000))
      .mockResolvedValueOnce("ok");

    await expect(withMpRetry(fn, { sleep, random: () => 0 })).resolves.toBe("ok");
    expect(waited).toEqual([MP_RETRY_AFTER_CAP_MS]);
  });

  it("un retryAfterMs inválido (cero, negativo, basura) cae a la espera propia", async () => {
    const { waited, sleep } = recordingSleep();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(httpError(429, 0))
      .mockRejectedValueOnce(httpError(429, -5))
      .mockResolvedValueOnce("ok");

    await expect(withMpRetry(fn, { sleep, random: () => 0 })).resolves.toBe("ok");
    expect(waited).toEqual([...MP_RETRY_DELAYS_MS]);
  });

  it("un 500 NO se reintenta: se propaga en el primer intento", async () => {
    const { waited, sleep } = recordingSleep();
    const boom = sdkError(500, "internal");
    const fn = vi.fn().mockRejectedValue(boom);

    await expect(withMpRetry(fn, { sleep })).rejects.toBe(boom);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(waited).toEqual([]);
  });

  it("sin fallo no duerme ni reintenta", async () => {
    const { waited, sleep } = recordingSleep();
    const fn = vi.fn().mockResolvedValue(7);

    await expect(withMpRetry(fn, { sleep })).resolves.toBe(7);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(waited).toEqual([]);
  });

  // La pausa por defecto es un `setTimeout` real: acá se verifica que exista y
  // que sean los milisegundos documentados, sin que la suite duerma de verdad.
  // Se avanza base + jitter entero porque el `random` por defecto es real.
  it("por defecto duerme con el reloj (verificado con timers falsos)", async () => {
    vi.useFakeTimers();
    try {
      const fn = vi.fn().mockRejectedValueOnce(sdkError(429)).mockResolvedValueOnce("ok");
      const p = withMpRetry(fn);
      await vi.advanceTimersByTimeAsync(MP_RETRY_DELAYS_MS[0] + MP_RETRY_JITTER_MS);
      await expect(p).resolves.toBe("ok");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("retrying", () => {
  it("conserva los argumentos y el resultado del método envuelto", async () => {
    const { sleep } = recordingSleep();
    const inner = vi
      .fn(async (a: string, b: number) => `${a}:${b}`)
      .mockRejectedValueOnce(httpError(429));
    const wrapped = retrying(inner, { sleep });

    await expect(wrapped("pre-1", 2)).resolves.toBe("pre-1:2");
    expect(inner).toHaveBeenCalledTimes(2);
    expect(inner).toHaveBeenLastCalledWith("pre-1", 2);
  });
});
