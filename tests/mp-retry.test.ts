import { describe, expect, it, vi } from "vitest";

import { isMpRateLimit, MP_RETRY_DELAYS_MS, retrying, withMpRetry } from "@/lib/mp/retry";

/** Un fallo del SDK de Mercado Pago tal como llega al `catch`: el cliente HTTP
 *  hace `throw await response.json()`, o sea un objeto plano con `status`. */
const sdkError = (status: number, message = "rate limited") => ({
  message,
  error: "local_rate_limited",
  status,
  cause: [],
});

/** Un fallo de las búsquedas por `fetch` directo: el gateway lanza un `Error`
 *  con el `status` colgado, que es lo que lo hace reconocible acá. */
const httpError = (status: number) =>
  Object.assign(new Error(`authorized_payments/search respondió ${status}`), { status });

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

    await expect(withMpRetry(fn, { sleep })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
    expect(waited).toEqual([...MP_RETRY_DELAYS_MS]);
  });

  it("429 persistente: tres intentos y el error se propaga tal cual", async () => {
    const { waited, sleep } = recordingSleep();
    const boom = sdkError(429);
    const fn = vi.fn().mockRejectedValue(boom);

    await expect(withMpRetry(fn, { sleep })).rejects.toBe(boom);
    // Un intento + los dos reintentos: no hay un cuarto.
    expect(fn).toHaveBeenCalledTimes(3);
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
  it("por defecto duerme con el reloj (verificado con timers falsos)", async () => {
    vi.useFakeTimers();
    try {
      const fn = vi.fn().mockRejectedValueOnce(sdkError(429)).mockResolvedValueOnce("ok");
      const p = withMpRetry(fn);
      await vi.advanceTimersByTimeAsync(MP_RETRY_DELAYS_MS[0]);
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
