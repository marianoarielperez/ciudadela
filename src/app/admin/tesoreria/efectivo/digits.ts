// Limpieza compartida de los dos campos numéricos del mostrador: cantidad de
// cuotas y monto. Solo dígitos, nunca coma ni punto: dejar pasar el separador
// es lo que en el cleaner anterior convertía "2500,50" en 250050 — un cobro
// cien veces mayor que no había forma de auditar a tiempo. Extraído a su
// propio módulo (en vez de vivir inline en el JSX) para poder probarlo como
// función pura, sin montar el formulario.
export function digitsOnly(v: string): string {
  return v.replace(/\D/g, "");
}
