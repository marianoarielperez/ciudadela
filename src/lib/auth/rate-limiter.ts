type Options = { limit?: number; windowMs?: number; now?: () => number }

export function createRateLimiter({ limit = 5, windowMs = 15 * 60_000, now = Date.now }: Options = {}) {
  const hits = new Map<string, number[]>()
  return {
    /** true = intento permitido (y registrado); false = bloqueado */
    check(key: string): boolean {
      const t = now()
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
  }
}

// In-memory alcanza: PM2 corre un único proceso (escala ~300 socios).
// Si se clusteriza, migrar a almacenamiento compartido.
export const loginLimiter = createRateLimiter()
