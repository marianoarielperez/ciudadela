const TZ = "America/Argentina/Buenos_Aires"

export function formatDateAR(date: Date): string {
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date)
}

export function formatARS(amount: number): string {
  const s = new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 2,
  }).format(amount)
  // Intl usa espacio no separable tras "$"; normalizamos a espacio común
  return s.replace(/\u00A0/g, " ")
}
