// Fecha del tablero de /admin, en es-AR y por día civil argentino (UTC-3,
// sin DST). Puro: recibe el instante, no lee el reloj — testeable en node.
const FORMATTER = new Intl.DateTimeFormat("es-AR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "America/Argentina/Buenos_Aires",
});

export function formatDashboardDate(now: Date): string {
  // Intl emite "jueves, 27 de agosto de 2026": sin la coma y con mayúscula
  // inicial se lee como línea suelta bajo el saludo.
  const text = FORMATTER.format(now).replace(", ", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
