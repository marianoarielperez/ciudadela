// Los valores por defecto son el control de seguridad de docs/08: viven como
// constantes exportadas para que un test los fije y un typo no los afloje.
export const DEFAULT_LIMIT = 5
export const DEFAULT_WINDOW_MS = 15 * 60_000
/** Techo de claves vivas antes de podar: acota la memoria del proceso. */
export const DEFAULT_MAX_KEYS = 10_000

type Options = {
  limit?: number
  windowMs?: number
  maxKeys?: number
  now?: () => number
}

export function createRateLimiter({
  limit = DEFAULT_LIMIT,
  windowMs = DEFAULT_WINDOW_MS,
  maxKeys = DEFAULT_MAX_KEYS,
  now = Date.now,
}: Options = {}) {
  const hits = new Map<string, number[]>()

  // Sin poda, quien rota claves (emails inventados) hace crecer el Map sin techo.
  // Barremos solo al pasarnos de maxKeys: es O(n) y ocurre muy de vez en cuando.
  function sweep(t: number) {
    for (const [key, stamps] of hits) {
      const newest = stamps[stamps.length - 1]
      if (newest === undefined || t - newest >= windowMs) hits.delete(key)
    }
  }

  return {
    /** true = intento permitido (y registrado); false = bloqueado */
    check(key: string): boolean {
      const t = now()
      if (hits.size > maxKeys) sweep(t)
      const recent = (hits.get(key) ?? []).filter((ts) => t - ts < windowMs)
      if (recent.length >= limit) {
        hits.set(key, recent)
        return false
      }
      recent.push(t)
      hits.set(key, recent)
      return true
    },
    reset(key: string) {
      hits.delete(key)
    },
    /** Introspección para tests y diagnóstico operativo; no es parte del control. */
    size(): number {
      return hits.size
    },
  }
}

// In-memory alcanza: PM2 corre un único proceso (escala ~300 socios).
// Si se clusteriza, migrar a almacenamiento compartido.

/** Por par email|ip: frena la fuerza bruta contra una cuenta concreta. */
export const loginLimiter = createRateLimiter()

/** Por IP sola: frena el barrido de muchas cuentas desde un mismo origen,
 *  que nunca llegaría a 5 intentos en ningún par email|ip. */
export const ipLimiter = createRateLimiter({ limit: 20 })
