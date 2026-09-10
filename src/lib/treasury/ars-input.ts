// El único campo de importe del panel que acepta centavos: los importes de las
// partes de un reparto salen de Mercado Pago (`Decimal(10,2)`) y pueden no ser
// enteros. Regla: coma = decimales, siempre; el punto NO entra. Efectivo y Otros
// ingresos siguen en pesos enteros con `digitsOnly`, y este módulo no los toca.

/** `"18000"` → 18000; `"18000,5"` → 18000.5; punto, tres decimales o basura → null. */
export function parseArsInput(raw: string): number | null {
  const m = /^(\d{1,8})(?:,(\d{1,2}))?$/.exec(raw.trim());
  if (!m) return null;
  return Number(`${m[1]}.${(m[2] ?? "").padEnd(2, "0")}`);
}

/** Limpieza mientras se tipea: dígitos y UNA coma con hasta dos decimales. */
export function arsInputClean(v: string): string {
  const [head, ...rest] = v.replace(/[^\d,]/g, "").split(",");
  return rest.length === 0 ? head : `${head},${rest.join("").slice(0, 2)}`;
}

/** Inversa de `parseArsInput`, para prellenar el campo. */
export function formatArsInput(n: number): string {
  const c = Math.round(n * 100);
  const whole = Math.floor(c / 100);
  const dec = c % 100;
  return dec === 0 ? String(whole) : `${whole},${String(dec).padStart(2, "0")}`;
}
