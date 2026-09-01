// ¿La casilla que declaró una solicitud de alta ya está EN USO en otra parte
// del sistema? Tiene DOS lectores, y no dicen lo mismo:
//
//   - El PANEL avisa y no bloquea nunca: un matrimonio que comparte buzón es un
//     caso legítimo y documentado (docs/04), así que la pantalla informa y la
//     Comisión decide.
//   - El WIZARD público corta el envío, pero sólo con las tres causales de
//     `BLOCKING_COLLISION_KINDS` (decisión del operador, 01/09/2026): la ficha
//     sin cuenta —el buzón compartido— lo sigue dejando pasar.
//
// Las dos lecturas salen de las MISMAS funciones para que no puedan divergir en
// qué llaman colisión.
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

/** `boundMemberId`: la ficha a la que está vinculada esa cuenta del portal
 *  (`Member.userId` es unique, así que es una o ninguna). No se muestra: sirve
 *  para que `collisionsFor` reconozca la cuenta del socio que el asiento acaba
 *  de abrirle a la solicitud y no le avise sobre sí mismo. */
export type EmailCollision =
  /** Cuenta del portal CON rol de gestión. El caso caro: una invitación de
   *  socio sobre esa dirección sería un cambio de contraseña de un admin. */
  | { kind: "admin_account"; userId: number; boundMemberId: number | null }
  /** Cuenta del portal sin rol de gestión. */
  | { kind: "account"; userId: number; boundMemberId: number | null }
  /** Ficha de un socio NO dado de baja (vigente o suspendido). */
  | { kind: "member"; memberId: number; memberNumber: number | null; fullName: string }
  /** Otra solicitud en trámite con la misma casilla. */
  | { kind: "application"; applicationId: number };

export type EmailCollisionMap = Map<string, EmailCollision[]>;

/** Las causales que además de AVISAR en el panel BLOQUEAN el envío del wizard
 *  público (decisión del operador, 01/09/2026). Son las tres que implican que
 *  esa casilla ya es la puerta de entrada de alguien al sistema:
 *
 *  - `admin_account` / `account`: una solicitud sobre esa dirección termina en
 *    una invitación de socio, o sea en un cambio de contraseña de OTRA persona.
 *  - `application`: dos trámites vivos disputándose el mismo buzón — el enlace
 *    de retome, la verificación y el aviso de resolución le llegan a los dos.
 *
 *  `member` NO está, a propósito: la ficha sin cuenta es el matrimonio que
 *  comparte buzón, que es legítimo y documentado (docs/04). Ese caso lo sigue
 *  cubriendo el aviso del panel, que es lo que este módulo hacía hasta ayer.
 *
 *  Vive acá y no en la action para que la pantalla que avisa y el camino que
 *  bloquea no puedan divergir en qué llaman colisión. Misma lección que
 *  `coverageFloor`. */
export const BLOCKING_COLLISION_KINDS: ReadonlySet<EmailCollision["kind"]> = new Set([
  "admin_account", "account", "application",
] as const);

/** ¿Esta colisión corta un alta pública? Se lee en `createApplicationAction`
 *  sobre lo que devuelve `collisionsFor`, o sea DESPUÉS de descontar lo propio
 *  (la cuenta del ex socio que reingresa cuelga de su ficha y no cuenta). */
export function isBlockingCollision(c: EmailCollision): boolean {
  return BLOCKING_COLLISION_KINDS.has(c.kind);
}

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
      select: {
        id: true, email: true,
        roles: { select: { role: { select: { name: true } } } },
        // La ficha vinculada a la cuenta: la usa `collisionsFor` para no
        // avisarle a un alta ya asentada sobre la cuenta que ella misma abrió.
        member: { select: { id: true } },
      },
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
    const boundMemberId = u.member?.id ?? null;
    push(u.email, isAdmin(roles)
      ? { kind: "admin_account", userId: u.id, boundMemberId }
      : { kind: "account", userId: u.id, boundMemberId });
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

/** Lo que hay que mostrarle a UNA solicitud: nada de lo que es ELLA MISMA
 *  cuenta como colisión. Son tres cosas, no una:
 *
 *  1. su propia fila en la lista de solicitudes vivas;
 *  2. la ficha que su asiento en acta creó — el asiento COPIA `app.email` a
 *     `Member.email` (`record.ts`), así que TODA solicitud `completed` colisiona
 *     contra su propio socio y el aviso decía "el email ya figura en la ficha
 *     del socio N° X" siendo X la misma persona;
 *  3. la cuenta del portal vinculada a ESA ficha, que arrastra la misma
 *     dirección por el mismo camino.
 *
 *  `ownMemberId` va `undefined` mientras la solicitud está viva (todavía no hay
 *  ficha suya: cualquier socio con esa casilla es OTRO y tiene que avisar).
 *
 *  Es el ÚNICO lugar donde se decide qué es "propio" —la cola y el detalle pasan
 *  por acá— para que las dos pantallas no puedan divergir. Misma lección que
 *  `coverageFloor`. */
export function collisionsFor(
  map: EmailCollisionMap,
  email: string | null | undefined,
  applicationId: number,
  ownMemberId?: number | null,
): EmailCollision[] {
  const key = normalize(email);
  if (!key) return [];
  const list = map.get(key);
  if (!list) return [];
  return list.filter((c) => {
    if (c.kind === "application") return c.applicationId !== applicationId;
    if (ownMemberId === undefined || ownMemberId === null) return true;
    if (c.kind === "member") return c.memberId !== ownMemberId;
    // `account` / `admin_account`: sólo se va la que cuelga de la ficha propia.
    // Una cuenta sin ficha (`boundMemberId` en null) o colgada de otra sigue
    // avisando.
    return c.boundMemberId !== ownMemberId;
  });
}
