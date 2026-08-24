// El banner del suspendido (spec M5 §5, la resolución de docs/02 REG-20 vs
// docs/05 §7): puede VER y PAGAR; todo lo demás está deshabilitado. El texto
// vive acá —puro— y no en el layout, para poder testear los cuatro casos de
// fechas sin renderizar nada.
import { formatDateAR } from "@/lib/format";

export function suspensionNotice(s: { from: Date | null; to: Date | null }): string {
  const range =
    s.from && s.to
      ? ` del ${formatDateAR(s.from)} al ${formatDateAR(s.to)}`
      : s.from
        ? ` desde el ${formatDateAR(s.from)}`
        : s.to
          ? ` hasta el ${formatDateAR(s.to)}`
          : "";
  return (
    `Tu condición de socio está suspendida${range} (Art. 10). ` +
    "Podés consultar tu cuenta, tus recibos y pagar tus cuotas; el resto de las acciones está deshabilitado."
  );
}
