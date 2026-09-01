// ¿La casilla que declaró una solicitud de alta ya está EN USO en otra parte
// del sistema? Es un AVISO para el operador, nunca un bloqueo: un matrimonio
// que comparte buzón es un caso legítimo y documentado (docs/04), así que la
// pantalla informa y la Comisión decide.
//
// Por qué hace falta: hoy el operador asienta un alta en acta sin ninguna señal
// de que el email declarado sea el de una cuenta de gestión o el de la ficha de
// otra persona. La guarda que hay (`members/access.ts`, el "buzón compartido")
// recién salta cuando la víctima intenta estrenar su portal —meses después, con
// un mensaje que nadie lee como incidente— y para entonces el acta ya está
// firmada. Este módulo adelanta el dato al único momento en que todavía es
// barato: antes del asiento.
//
// El cliente de Prisma se INYECTA, no se importa: `@/lib/prisma` tira al
// evaluarse si falta DATABASE_URL y este módulo lo importa un test puro, sin
// base ni `.env`. Mismo criterio que `query.ts`, `summary.ts` y
// `eligibility-inputs.ts`.
import type { PrismaClient } from "@/generated/prisma/client";
import { isAdmin } from "@/lib/auth/roles";
import { LIVE_APPLICATION_STATUSES } from "@/lib/applications/statuses";

type Db = Pick<PrismaClient, "user" | "member" | "application">;

export type EmailCollision =
  /** Cuenta del portal CON rol de gestión. El caso caro: una invitación de
   *  socio sobre esa dirección sería un cambio de contraseña de un admin. */
  | { kind: "admin_account"; userId: number }
  /** Cuenta del portal sin rol de gestión. */
  | { kind: "account"; userId: number }
  /** Ficha de un socio NO dado de baja (vigente o suspendido). */
  | { kind: "member"; memberId: number; memberNumber: number | null; fullName: string }
  /** Otra solicitud en trámite con la misma casilla. */
  | { kind: "application"; applicationId: number };

export type EmailCollisionMap = Map<string, EmailCollision[]>;

/** La MISMA normalización que `sameAddress` (`@/lib/members/write`) y que lo
 *  que `syncAccountEmail` termina escribiendo en la cuenta: minúsculas y sin
 *  espacios al borde. Se define acá y no se importa de `write.ts` para no
 *  arrastrar Prisma a un módulo que se quiere puro; el criterio es uno solo y
 *  está anotado en los dos lados. */
function normalize(email: string | null | undefined): string {
  return email?.trim().toLowerCase() ?? "";
}

/** Busca, para UNA lista de direcciones, todo lo que ya las usa. Tres consultas
 *  en total —una por tabla— y no una por solicitud: la cola de Altas la llama
 *  con las decenas de casillas de la pantalla entera.
 *
 *  El `in` viaja en minúsculas y MariaDB lo compara con una collation
 *  case-insensitive, así que matchea la fila guardada con mayúsculas; la clave
 *  del mapa se re-normaliza igual en JS para que el resultado no dependa de con
 *  qué caso quedó escrita cada fila.
 *
 *  Una dirección SIN colisión no deja entrada en el mapa: `map.get(email)` da
 *  `undefined`, no un array vacío. */
export async function findEmailCollisions(db: Db, emails: string[]): Promise<EmailCollisionMap> {
  const wanted = [...new Set(emails.map(normalize).filter((e) => e !== ""))];
  const out: EmailCollisionMap = new Map();
  // Sin nada que buscar no se toca la base: la cola puede venir vacía y las
  // solicitudes viejas migradas pueden no tener email.
  if (wanted.length === 0) return out;

  const push = (email: string, hit: EmailCollision) => {
    const key = normalize(email);
    if (!key) return;
    const list = out.get(key);
    if (list) list.push(hit);
    else out.set(key, [hit]);
  };

  const [users, members, applications] = await Promise.all([
    db.user.findMany({
      where: { email: { in: wanted } },
      select: { id: true, email: true, roles: { select: { role: { select: { name: true } } } } },
    }),
    db.member.findMany({
      // Los dados de baja NO cuentan: su casilla quedó libre y marcarla llenaría
      // la cola de avisos por gente que ya no está en el padrón.
      where: { email: { in: wanted }, status: { not: "withdrawn" } },
      select: {
        id: true, fullName: true, email: true,
        // El número de socio sale del libro ABIERTO (mismo criterio que
        // `electoral.ts`): el del libro cerrado ya no lo nombra nadie. Sin ficha
        // en el libro vivo queda `null` y la pantalla nombra al socio por su
        // nombre.
        memberships: { where: { book: { status: "open" } }, select: { memberNumber: true }, take: 1 },
      },
    }),
    db.application.findMany({
      where: { email: { in: wanted }, status: { in: LIVE_APPLICATION_STATUSES } },
      select: { id: true, email: true },
    }),
  ]);

  // El orden dentro de cada casilla es el de la gravedad con que lo lee el
  // operador: primero la cuenta (de gestión o no), después la ficha, después la
  // otra solicitud.
  for (const u of users) {
    const roles = u.roles.map((r) => r.role.name);
    push(u.email, isAdmin(roles) ? { kind: "admin_account", userId: u.id } : { kind: "account", userId: u.id });
  }
  for (const m of members) {
    if (!m.email) continue;
    push(m.email, {
      kind: "member",
      memberId: m.id,
      memberNumber: m.memberships[0]?.memberNumber ?? null,
      fullName: m.fullName,
    });
  }
  for (const a of applications) push(a.email, { kind: "application", applicationId: a.id });

  return out;
}

/** Lo que hay que mostrarle a UNA solicitud: su propia fila no es una colisión.
 *
 *  Es el ÚNICO lugar donde se excluye la solicitud misma —la cola y el detalle
 *  pasan por acá— para que las dos pantallas no puedan divergir en qué
 *  consideran "otra" solicitud. Misma lección que `coverageFloor`. */
export function collisionsFor(
  map: EmailCollisionMap,
  email: string | null | undefined,
  applicationId: number,
): EmailCollision[] {
  const key = normalize(email);
  if (!key) return [];
  const list = map.get(key);
  if (!list) return [];
  return list.filter((c) => c.kind !== "application" || c.applicationId !== applicationId);
}
