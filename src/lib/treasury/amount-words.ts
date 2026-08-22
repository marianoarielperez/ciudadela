// Monto en letras para el recibo (castellano rioplatense). Enteros hasta
// 999.999.999 y centavos. Puro.
const UNITS = ["", "un", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve"];
const TEENS = ["diez", "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete", "dieciocho", "diecinueve"];
const TWENTIES = ["veinte", "veintiún", "veintidós", "veintitrés", "veinticuatro", "veinticinco", "veintiséis", "veintisiete", "veintiocho", "veintinueve"];
const TENS = ["", "", "veinte", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];
const HUNDREDS = ["", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos", "seiscientos", "setecientos", "ochocientos", "novecientos"];

function below100(n: number): string {
  if (n < 10) return UNITS[n];
  if (n < 20) return TEENS[n - 10];
  if (n < 30) return TWENTIES[n - 20];
  const t = Math.floor(n / 10);
  const u = n % 10;
  return u === 0 ? TENS[t] : `${TENS[t]} y ${UNITS[u]}`;
}

function below1000(n: number): string {
  if (n === 100) return "cien";
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const head = HUNDREDS[h];
  if (rest === 0) return head;
  return head ? `${head} ${below100(rest)}` : below100(rest);
}

function integerWords(n: number): string {
  if (n === 0) return "cero";
  const millions = Math.floor(n / 1_000_000);
  const thousands = Math.floor((n % 1_000_000) / 1000);
  const rest = n % 1000;
  const parts: string[] = [];
  if (millions === 1) parts.push("un millón");
  else if (millions > 1) parts.push(`${below1000(millions)} millones`);
  if (thousands === 1) parts.push("mil");
  else if (thousands > 1) parts.push(`${below1000(thousands)} mil`);
  if (rest > 0) parts.push(below1000(rest));
  return parts.join(" ");
}

export function amountInWords(amount: number): string {
  const cents = Math.round(amount * 100);
  const whole = Math.floor(cents / 100);
  const frac = cents % 100;
  let words = integerWords(whole);
  // "un millón DE pesos" solo con millones redondos.
  if (whole >= 1_000_000 && whole % 1_000_000 === 0) words += " de";
  words += whole === 1 ? " peso" : " pesos";
  if (frac > 0) words += ` con ${below100(frac)} centavos`;
  return words;
}
