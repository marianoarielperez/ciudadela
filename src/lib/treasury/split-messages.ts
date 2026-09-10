// Los textos de las guardas del reparto, en UN lugar (la lección de
// `GRANT_GUARD_MESSAGES`): la action pre-valida lo barato con estos mismos
// textos y el núcleo revalida todo. El operador lee lo mismo se corte donde se
// corte. Módulo puro: sin Prisma.
import { formatARS } from "@/lib/format";
import { adminExemptionNotice, type ExemptionMinute } from "./exemptions";
import { MAX_SPLIT_PARTS } from "./split-group";

export const SPLIT_GUARD_MESSAGES = {
  noParts: "Elegí al menos un socio.",
  tooManyParts: `Como máximo ${MAX_SPLIT_PARTS} socios por pago.`,
  duplicateMember: "Un socio no puede aparecer dos veces en el reparto.",
  rowGone: "La fila ya no existe.",
  rowResolved: "Esta fila ya fue resuelta.",
  memberGone: "El socio no existe.",
  conceptCategory: "Ese concepto no corresponde a la categoría del socio.",
  // Los dos del cesante son los MISMOS textos que Efectivo (`registerCashPayment`).
  withdrawnConcept:
    "El socio está dado de baja: sólo se le puede cobrar la deuda de cuotas. Para registrar aportes, primero el reingreso.",
  withdrawnCount: (pending: number): string =>
    pending === 0
      ? "El socio está dado de baja y no tiene cuotas pendientes: no hay nada que cobrarle."
      : `El socio está dado de baja: tiene ${pending} ${pending === 1 ? "cuota pendiente" : "cuotas pendientes"} y no devenga nuevas.`,
  exempt: (e: { toPeriod: string; minute: ExemptionMinute }): string =>
    `${adminExemptionNotice(e)} Sólo se le puede registrar un aporte.`,
  amountZero: "El importe de cada parte tiene que ser mayor a cero.",
  // 60 es `MAX_FEES_PER_PAYMENT` (service.ts); acá va el literal para no importar
  // el servicio desde un módulo puro.
  count: "La cantidad de cuotas tiene que estar entre 1 y 60.",
  sum: (parts: number, unassigned: number): string =>
    `Las partes suman ${formatARS(parts)} y hay ${formatARS(unassigned)} sin asignar.`,
  changed: "Este pago cambió mientras lo repartías. Revisá la fila y volvé a intentarlo.",
  // Un reembolso NO es una anulación de mostrador: la plata volvió al pagador y
  // la asociación no la tiene. Ni se le puede emitir un recibo a un socio ni se
  // puede registrar como ingreso de la asociación; la única salida es descartar.
  refunded:
    "Mercado Pago reembolsó este cobro: la plata volvió al pagador y no se puede asignar a socios. Descartá la fila.",
} as const;
