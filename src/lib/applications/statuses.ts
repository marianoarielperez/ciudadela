// Conjuntos de estados de la Solicitud de alta web, en un módulo PURO.
//
// Vivían en `service.ts`, que importa `@/lib/prisma` —y eso tira al evaluarse
// si falta DATABASE_URL—: cualquier módulo puro que necesitara el conjunto se
// caía en un test sin `.env`. Se mudaron acá y `service.ts` los RE-EXPORTA, así
// que los call-sites de siempre no cambian. Mismo movimiento que `maskedName`
// hacia `members/masked-name.ts`.
import type { ApplicationStatus } from "@/generated/prisma/client";

// Estados en los que la solicitud "existe" para el vecino y para la unicidad
// por DNI. rejected/expired/completed no bloquean una solicitud nueva
// (completed no llega a molestar: ahí el DNI ya es socio vigente y lo frena
// la elegibilidad).
export const LIVE_APPLICATION_STATUSES: ApplicationStatus[] = [
  "started", "pending_payment", "approved_pending_minute", "pending_board",
];
