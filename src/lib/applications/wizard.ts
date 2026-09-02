// Reglas puras del wizard público (REG-01, REG-02). Separadas de la action
// para testearlas sin mocks.
import type { MemberCategory } from "@/generated/prisma/client";
import { civilDateUtc } from "@/lib/dates";

/** Las únicas categorías que se piden por la web. `cadet` se asocia en la sede
 *  (menor de edad, hace falta la firma del tutor) y `honorary`/`lifetime` las
 *  otorga la Comisión: no son solicitables. */
export const WEB_CATEGORIES = ["active", "adherent", "collaborator"] as const;

/** El día civil ARGENTINO, anclado a mediodía UTC como todas las fechas civiles
 *  del proyecto.
 *
 *  No alcanza con `new Date()` del server: entre las 21 y las 24 de Comodoro el
 *  reloj UTC ya está en el día siguiente, y el corte de los 18 años se correría
 *  un día para adelante. O sea que quien los cumple MAÑANA los tendría esta
 *  noche y se asociaría como adulto siendo menor, que es justo lo que REG-02 no
 *  permite. Mismo criterio que `currentYearAR` en activities/year-param.ts. */
export function civilTodayAr(now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now); // "YYYY-MM-DD"
  const [y, m, d] = parts.split("-").map(Number);
  return civilDateUtc(y, m, d);
}

/** 18+ comparando fechas civiles en UTC (las dos vienen ancladas a mediodía UTC
 *  por `civilDateUtc`, así que la comparación por componentes es exacta).
 *  Cumplirlos HOY ya cuenta: la mayoría de edad se adquiere el día del
 *  cumpleaños, no al día siguiente. */
export function isAdult(birthDate: Date, now: Date): boolean {
  const cutoff = new Date(Date.UTC(
    now.getUTCFullYear() - 18, now.getUTCMonth(), now.getUTCDate(), 12,
  ));
  return birthDate <= cutoff;
}

/** Ciudadela → active | adherent; otro barrio → collaborator (Art. 5 y 5 bis).
 *  Toma el enum completo de `MemberCategory` a propósito: es el guardián de que
 *  una categoría que no se pide por la web no entre por un POST armado a mano. */
export function categoryAllowedForResidence(
  category: MemberCategory,
  livesInBarrio: boolean,
): boolean {
  if (livesInBarrio) return category === "active" || category === "adherent";
  return category === "collaborator";
}

/** Lo que la WEB ofrece: REG-01 más la llave `colaborador_habilitado` (spec
 *  2026-09-02). La categoría colaborador es del estatuto reformado y el sitio
 *  se lanza antes de que la IGJ lo oficialice, así que con la llave apagada
 *  "otro barrio" no admite ninguna categoría.
 *
 *  `categoryAllowedForResidence` queda INTACTA a propósito: es la regla
 *  estatutaria, y el panel la usa para AVISAR de un desajuste de residencia
 *  sin gating (la recategorización de una solicitud es de la Comisión, que
 *  sabe qué estatuto rige). Sólo la creación pública pasa por acá. El tercer
 *  parámetro no tiene default: cada llamador decide qué llave leyó. */
export function categoryOfferedOnWeb(
  category: MemberCategory,
  livesInBarrio: boolean,
  collaboratorEnabled: boolean,
): boolean {
  if (!categoryAllowedForResidence(category, livesInBarrio)) return false;
  return category !== "collaborator" || collaboratorEnabled;
}
