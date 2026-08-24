const TZ = "America/Argentina/Buenos_Aires"

export function formatDateAR(date: Date): string {
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date)
}

/** Fecha y hora civiles argentinas: "26/08/2026 a las 15:40". Se usa donde la
 *  hora es parte del hecho —el vencimiento de un link de pago— y no sólo el
 *  día. */
export function formatDateTimeAR(date: Date): string {
  const time = new Intl.DateTimeFormat("es-AR", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date)
  return `${formatDateAR(date)} a las ${time}`
}

// "hace 3 horas". Recibe el `now` en vez de leer el reloj: es la regla del
// proyecto para todo lo que se testea (mismo criterio que `currentPeriod(now)`).
// Sin plurales irregulares y sin librería: son cuatro tramos.
export function formatRelativeAgo(from: Date, now: Date): string {
  const seconds = Math.max(0, Math.round((now.getTime() - from.getTime()) / 1000))
  if (seconds < 60) return "recién"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `hace ${minutes} ${minutes === 1 ? "minuto" : "minutos"}`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `hace ${hours} ${hours === 1 ? "hora" : "horas"}`
  const days = Math.floor(hours / 24)
  return `hace ${days} ${days === 1 ? "día" : "días"}`
}

// Tamaño de archivo legible en es-AR (coma decimal). Base 1024, como reporta el
// sistema operativo: el operador compara este número con el que ve en su
// carpeta. Sin decimales en kB (nadie necesita "1,4 kB") y uno solo en MB.
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`
  const mb = bytes / (1024 * 1024)
  return `${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 }).format(mb)} MB`
}

export function formatARS(amount: number): string {
  const s = new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 2,
  }).format(amount)
  // Intl usa espacio no separable tras "$": U+00A0, o U+202F segun la version
  // de ICU del runtime. Normalizamos los dos a espacio comun.
  return s.replace(/[\u00A0\u202F]/g, " ")
}
