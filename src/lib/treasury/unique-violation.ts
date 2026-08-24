// Clasificación de la violación de unique (P2002) que le importa al núcleo de
// plata. Módulo puro y aparte a propósito: `service.ts` importa `@/lib/prisma`,
// que tira si falta `DATABASE_URL`, así que el test de integración que fija la
// forma REAL del error contra MariaDB no podría importarlo desde ahí.
//
// Se mira por forma y no por `instanceof PrismaClientKnownRequestError` para que
// el fake de los tests pueda producir el error sin importar la clase generada.

/** Nombre del índice que MariaDB reporta para el `@@unique([memberId, period])`
 *  de `fees`. Lo genera Prisma a partir del modelo y sus campos, así que es
 *  estable mientras el unique se llame igual; el test de integración lo fija
 *  contra la base real. */
const FEE_PERIOD_INDEX = "fees_member_id_period_key";

/** Forma de `meta.target` cuando el error viene del motor clásico con Postgres:
 *  la lista de columnas en vez del nombre del índice. */
const FEE_PERIOD_COLUMNS = "member_id,period";

export function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2002";
}

/** Qué unique se violó, en texto, o `null` si no se puede saber.
 *
 *  MEDIDO contra MariaDB con el adapter de Prisma 7 (`@prisma/adapter-mariadb`):
 *  el error NO trae `meta.target` —eso es del motor clásico— sino
 *  `meta.driverAdapterError.cause.constraint.index` con el nombre del índice
 *  ("fees_member_id_period_key", "payments_mp_payment_id_key"). Se leen las dos
 *  formas para no quedar atados a esa interna. */
export function uniqueViolationTarget(e: unknown): string | null {
  if (!isUniqueViolation(e)) return null;
  const meta = (e as { meta?: unknown }).meta;
  if (typeof meta !== "object" || meta === null) return null;
  const m = meta as {
    target?: unknown;
    driverAdapterError?: { cause?: { constraint?: { index?: unknown; fields?: unknown } } };
  };
  const constraint = m.driverAdapterError?.cause?.constraint;
  if (typeof constraint?.index === "string") return constraint.index;
  if (Array.isArray(constraint?.fields)) return constraint.fields.join(",");
  if (typeof m.target === "string") return m.target;
  if (Array.isArray(m.target)) return m.target.join(",");
  return null;
}

/** ¿Es el P2002 del unique `(member_id, period)` de `fees`? Sólo ESE justifica
 *  reintentar la imputación: es la carrera con el cron de devengo. Un P2002 de
 *  `mp_payment_id` es la barrera de idempotencia del dinero de Mercado Pago y no
 *  se reintenta nunca. */
export function isFeePeriodUniqueViolation(e: unknown): boolean {
  const target = uniqueViolationTarget(e);
  return target === FEE_PERIOD_INDEX || target === FEE_PERIOD_COLUMNS;
}
