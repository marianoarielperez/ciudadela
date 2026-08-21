// Filtros y paginado de la bandeja de solicitudes (patrón `members/query.ts`).
//
// El cliente de Prisma se INYECTA, no se importa: `@/lib/prisma` tira al
// evaluarse si falta DATABASE_URL, y este módulo lo importa `tests/applications-query.test.ts`,
// que es un test puro sin base ni `.env`. La página pasa `prisma`; el test pasa
// un doble. Mismo criterio que `fetchPadronPage`.
import type {
  ApplicationStatus, MemberCategory, Prisma, PrismaClient,
} from "@/generated/prisma/client";

// 50 filas: el mismo tamaño que el padrón. La bandeja arranca con decenas de
// solicitudes, no con miles, pero el día que haya una campaña de alta el
// operador no tiene que esperar una tabla de 2.000 filas.
export const APPLICATIONS_PAGE_SIZE = 50;

const STATUSES: ApplicationStatus[] = [
  "started", "pending_payment", "approved_pending_minute", "pending_board",
  "completed", "rejected", "expired",
];

export type ApplicationFilters = { q?: string; status?: ApplicationStatus };

// Next entrega `string[]` cuando el parámetro viene repetido en la URL, así que
// el tipo de entrada es el mismo que expone `searchParams`: sin el `one()` un
// `?q=a&q=b` mandaría un array al `where` de Prisma.
type SearchParams = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function parseApplicationFilters(sp: SearchParams): ApplicationFilters {
  const f: ApplicationFilters = {};
  const q = one(sp.q)?.trim();
  if (q) f.q = q;
  const status = one(sp.status);
  if (status && (STATUSES as string[]).includes(status)) f.status = status as ApplicationStatus;
  return f;
}

export function applicationsWhere(f: ApplicationFilters): Prisma.ApplicationWhereInput {
  const where: Prisma.ApplicationWhereInput = {};
  if (f.status) where.status = f.status;
  if (f.q) {
    // Una búsqueda toda de dígitos es un DNI (o su principio) y NO un nombre: el
    // operador que tipea "30111" está buscando a esa persona, no a la que tenga
    // un "30111" en el apellido. `startsWith` porque el DNI se tipea desde el
    // principio, no por el medio.
    if (/^\d+$/.test(f.q)) where.dni = { startsWith: f.q };
    else where.fullName = { contains: f.q };
  }
  return where;
}

/** La página NO es un filtro: viaja aparte para no ensuciar el querystring que
 *  reconstruyen los links de paginación ni el "Limpiar filtros". */
export function parseApplicationsPage(sp: SearchParams): number {
  const n = Number(one(sp.page));
  return Number.isInteger(n) && n > 0 ? n : 1;
}

export type ApplicationRow = {
  id: number;
  fullName: string;
  dni: string;
  requestedCategory: MemberCategory;
  wantsDebit: boolean;
  status: ApplicationStatus;
  memberId: number | null;
  createdAt: Date;
  emailVerifiedAt: Date | null;
  /** Estado de la ÚLTIMA suscripción de MP de esta solicitud, tal cual lo
   *  guarda `mp_subscriptions` (`pending` | `authorized` | `paused` |
   *  `cancelled`…), o `null` si nunca hubo una. Lo necesita el aviso de pago
   *  tardío: ver `lateEntryNotice`. */
  subscriptionStatus: string | null;
};

/** ¿La bandeja puede afirmar "Reingreso" mirando SÓLO esta fila?
 *
 *  `memberId` no es el discriminador alta/reingreso. Lo parece —lo es mientras
 *  la solicitud está viva— pero el asiento le escribe `memberId` a TODA
 *  solicitud que completa, sea alta nueva o reingreso: es el contrato de la
 *  Task 15, del que cuelga la verificación tardía de email (`/verificar` busca
 *  por ahí la ficha a la que propagar el canje). Con lo cual, después del
 *  asiento, un alta común es indistinguible de un reingreso por ese campo, y la
 *  bandeja llegó a mostrar "Alta completada · Reingreso" sobre una solicitud que
 *  acababa de CREAR al socio que decía estar readmitiendo.
 *
 *  Antes del asiento el campo sí significa "esta solicitud matcheó una ficha
 *  existente", que es justo lo que el operador necesita ver desde la bandeja
 *  para preparar el acta (REG-25). Después, la señal verdadera es el `Movement`
 *  (`admission` vs `readmission`) y eso es una consulta POR FILA: la bandeja no
 *  la hace y no afirma nada; el detalle —que ya corre varias consultas— la
 *  resuelve y muestra la distinción real. */
export function showsReentryBadge(row: Pick<ApplicationRow, "status" | "memberId">): boolean {
  return row.memberId !== null && row.status !== "completed";
}

/** Acción de auditoría que marca la solicitud aceptada DESPUÉS de haber vencido
 *  (el webhook del primer pago llegó cuando el cron ya la había expirado). Vive
 *  acá —módulo puro, sin prisma— porque la escribe el procesador de webhooks y
 *  la leen la bandeja y el detalle: si el string se desincroniza, el aviso
 *  desaparece de la pantalla sin que nada falle. */
export const APPROVED_AFTER_EXPIRY_ACTION = "application_approved_after_expiry";

/** Cuáles de estas solicitudes revivieron. UNA consulta para toda la página
 *  (nada de N+1): el índice `[entity, entityId]` de `audit_log` la cubre. */
export async function fetchApprovedAfterExpiry(
  db: Pick<PrismaClient, "auditLog">,
  ids: number[],
): Promise<Set<number>> {
  if (ids.length === 0) return new Set();
  const rows = await db.auditLog.findMany({
    where: {
      action: APPROVED_AFTER_EXPIRY_ACTION,
      entity: "application",
      entityId: { in: ids.map(String) },
    },
    select: { entityId: true },
  });
  return new Set(rows.map((r) => Number(r.entityId)));
}

/** El único estado de preapproval en el que MP está efectivamente cobrando. El
 *  catálogo es de MP y puede crecer (`pending`, `paused`, `cancelled`…), así que
 *  se afirma por lista blanca: cualquier estado desconocido NO cuenta como
 *  débito vivo. */
const ACTIVE_SUBSCRIPTION_STATUS = "authorized";

export type LateEntryNotice = "no_debit" | "verify";

/** Qué se puede AFIRMAR sobre una solicitud que revivió (el pago del ingreso
 *  llegó cuando el cron ya la había vencido).
 *
 *  El asiento de auditoría prueba UNA cosa: que el pago llegó tarde. NO prueba
 *  que el débito automático haya quedado cancelado, y ésa es toda la
 *  diferencia. `cancelPreapproval`, en el cron, es best-effort: su catch cuenta
 *  el fallo y sigue. Si esa llamada falló —la misma ventana de inestabilidad de
 *  MP que hace posible el pago tardío—, el preapproval sigue vivo y cobrando.
 *  Un aviso que dijera "quedó sin débito, gestionalo de nuevo" mandaría al
 *  operador a crear un SEGUNDO débito sobre el mismo vecino.
 *
 *  Por eso el aviso se deriva del estado VIVO de la suscripción y no del
 *  asiento (mismo criterio que `pendingCancellation` en el detalle):
 *  - `cancelled` o sin fila → `"no_debit"`: se puede afirmar que no hay débito.
 *  - `authorized` (o cualquier otro estado) → `"verify"`: la cancelación pudo
 *    no haberse aplicado, o el débito ya se rehizo. Hay que MIRAR el panel de
 *    MP antes de tocar nada.
 *
 *  Y como cuelga del estado vivo y no del asiento (que es permanente), el aviso
 *  cambia solo cuando la suscripción cambia: no se queda gritando para siempre.
 */
export function lateEntryNotice(
  hasLateEntry: boolean,
  subscriptionStatus: string | null | undefined,
): LateEntryNotice | null {
  if (!hasLateEntry) return null;
  return subscriptionStatus == null || subscriptionStatus === "cancelled" ? "no_debit" : "verify";
}

/** ¿La BANDEJA muestra el badge "Sin débito"?
 *
 *  Sólo en el caso probado (`"no_debit"`). El caso ambiguo se resuelve mirando
 *  MP, que es una acción del detalle —a un clic— y no algo que se pueda hacer
 *  desde una fila de una tabla: un badge de tres palabras no puede explicar
 *  "verificá antes de gestionar" sin mentirle a quien lo lee de reojo. El
 *  guardrail que la bandeja necesita es el otro: que nadie asiente en acta EN
 *  LOTE un alta que quedó sin débito. */
export function showsNoDebitBadge(
  hasLateEntry: boolean,
  subscriptionStatus: string | null | undefined,
): boolean {
  return lateEntryNotice(hasLateEntry, subscriptionStatus) === "no_debit";
}

/** ¿El débito está vivo? Expuesto para el detalle, que lo nombra en el aviso. */
export function subscriptionIsActive(status: string | null | undefined): boolean {
  return status === ACTIVE_SUBSCRIPTION_STATUS;
}

export type ApplicationsPage = {
  rows: ApplicationRow[];
  total: number;
  /** Página efectiva: puede diferir de la pedida si venía más allá del final. */
  page: number;
  pageCount: number;
  pageSize: number;
};

export function makeApplicationQueries(db: Pick<PrismaClient, "application">) {
  return {
    async fetchPage(f: ApplicationFilters, page: number): Promise<ApplicationsPage> {
      const where = applicationsWhere(f);
      const total = await db.application.count({ where });
      // Con 0 resultados sigue habiendo una página (vacía): la pantalla nunca
      // dice "página 1 de 0".
      const pageCount = Math.max(1, Math.ceil(total / APPLICATIONS_PAGE_SIZE));
      const current = Math.min(Math.max(1, page), pageCount);
      const rows = await db.application.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (current - 1) * APPLICATIONS_PAGE_SIZE,
        take: APPLICATIONS_PAGE_SIZE,
        // `select` explícito y no `include`: la fila de Application trae el hash
        // del token de retome, la IP y el user-agent del vecino. Nada de eso
        // tiene por qué viajar al render de una tabla.
        select: {
          id: true, fullName: true, dni: true, requestedCategory: true, wantsDebit: true,
          status: true, memberId: true, createdAt: true, emailVerifiedAt: true,
          // La última suscripción, sólo su estado: el badge "Sin débito" no lo
          // puede afirmar el asiento de auditoría solo (ver `lateEntryNotice`),
          // y sin este dato el badge no se apagaría nunca. Es un join sobre 50
          // filas como mucho, no un N+1. NO se trae `payerEmail`: es un dato
          // personal que la tabla no muestra (docs/08).
          subscriptions: { select: { status: true }, orderBy: { createdAt: "desc" }, take: 1 },
        },
      });
      return {
        // La fila se aplana acá y no en la página: `ApplicationRow` es el
        // contrato que consume la tabla, y un array anidado ahí obligaría a cada
        // pantalla a repetir el `[0]`.
        rows: rows.map(({ subscriptions, ...row }) => ({
          ...row,
          subscriptionStatus: subscriptions?.[0]?.status ?? null,
        })),
        total, page: current, pageCount, pageSize: APPLICATIONS_PAGE_SIZE,
      };
    },
  };
}
