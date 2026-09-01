// Aviso de colisión de email en la bandeja de Altas (tarea B de
// `asociate-email-guards`). El módulo es de dominio puro con el cliente de
// Prisma INYECTADO, así que este test corre sin `.env` y sin base.
//
// El doble de base HONRA el `where` que recibe (lección del Módulo 6: un fake
// que re-implementa el filtro en vez de aplicarlo deja cláusulas del `where`
// real sin ejercitar y el test pasa igual). Cada guarda de acá se verificó por
// MUTACIÓN —borrarla y ver el test en rojo— y el resultado está en el informe.
import { describe, expect, it } from "vitest";
import { collisionsFor, findEmailCollisions } from "@/lib/applications/email-collision";

// `boundMemberId`: la ficha a la que está vinculada esa cuenta del portal
// (`Member.userId` es unique). Es lo que permite reconocer la cuenta del socio
// que el asiento acaba de crear y no avisarle sobre sí mismo.
type UserRow = { id: number; email: string; roles: string[]; boundMemberId?: number };
type MemberRow = {
  id: number; fullName: string; email: string | null; status: string;
  memberships: Array<{ memberNumber: number; bookStatus: string }>;
};
type AppRow = { id: number; email: string; status: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Where = Record<string, any>;

// MariaDB compara VARCHAR con una collation case-insensitive: un `in` con la
// dirección en minúsculas matchea la fila guardada en mayúsculas. El doble
// reproduce ESE comportamiento, no uno más estricto, porque si fuera sensible
// a mayúsculas el test pasaría con un módulo que en producción no encuentra
// nada.
const inList = (list: string[] | undefined, value: string | null) =>
  value !== null && (list ?? []).some((e) => e.toLowerCase() === value.trim().toLowerCase());

/** Aplica el `where` REAL que le llega, campo por campo. No sabe qué filtros
 *  espera el módulo: si el módulo deja de mandar uno, el doble deja de
 *  aplicarlo y el caso que dependía de él se cae. */
function statusMatches(where: Where, status: string): boolean {
  const w = where.status;
  if (w === undefined) return true;
  if (typeof w === "string") return status === w;
  if (w.not !== undefined) return status !== w.not;
  if (w.in !== undefined) return (w.in as string[]).includes(status);
  return true;
}

function makeDb(data: { users?: UserRow[]; members?: MemberRow[]; applications?: AppRow[] }) {
  const calls = { user: 0, member: 0, application: 0 };
  const db = {
    user: {
      findMany: async (args: { where: Where }) => {
        calls.user += 1;
        return (data.users ?? [])
          .filter((u) => inList(args.where.email?.in, u.email))
          .map((u) => ({
            id: u.id,
            email: u.email,
            roles: u.roles.map((name) => ({ role: { name } })),
            member: u.boundMemberId === undefined ? null : { id: u.boundMemberId },
          }));
      },
    },
    member: {
      findMany: async (args: { where: Where; select: Where }) => {
        calls.member += 1;
        // La sub-consulta de `memberships` también sale del `select` que manda
        // el módulo: el libro abierto se filtra con SU `where`, no con uno
        // inventado acá.
        const bookStatus = args.select?.memberships?.where?.book?.status;
        return (data.members ?? [])
          .filter((m) => inList(args.where.email?.in, m.email) && statusMatches(args.where, m.status))
          .map((m) => ({
            id: m.id,
            fullName: m.fullName,
            email: m.email,
            memberships: m.memberships
              .filter((ms) => bookStatus === undefined || ms.bookStatus === bookStatus)
              .map((ms) => ({ memberNumber: ms.memberNumber })),
          }));
      },
    },
    application: {
      findMany: async (args: { where: Where }) => {
        calls.application += 1;
        return (data.applications ?? [])
          .filter((a) => inList(args.where.email?.in, a.email) && statusMatches(args.where, a.status))
          .map((a) => ({ id: a.id, email: a.email }));
      },
    },
  };
  return { db: db as never, calls };
}

describe("findEmailCollisions", () => {
  it("sin direcciones devuelve un mapa vacío y NO consulta la base", async () => {
    const { db, calls } = makeDb({ users: [{ id: 1, email: "a@b.com", roles: [] }] });
    const map = await findEmailCollisions(db, []);
    expect(map.size).toBe(0);
    expect(calls).toEqual({ user: 0, member: 0, application: 0 });
  });

  it("una cuenta común es `account`; una con rol de gestión es `admin_account`", async () => {
    const { db } = makeDb({
      users: [
        { id: 7, email: "socio@b.com", roles: ["socio"] },
        { id: 8, email: "jefe@b.com", roles: ["admin"] },
        { id: 9, email: "manda@b.com", roles: ["socio", "superadmin"] },
      ],
    });
    const map = await findEmailCollisions(db, ["socio@b.com", "jefe@b.com", "manda@b.com"]);
    expect(map.get("socio@b.com")).toEqual([{ kind: "account", userId: 7, boundMemberId: null }]);
    expect(map.get("jefe@b.com")).toEqual([{ kind: "admin_account", userId: 8, boundMemberId: null }]);
    expect(map.get("manda@b.com")).toEqual([{ kind: "admin_account", userId: 9, boundMemberId: null }]);
  });

  it("una dirección sin colisión NO deja entrada en el mapa", async () => {
    const { db } = makeDb({ users: [{ id: 7, email: "otro@b.com", roles: [] }] });
    const map = await findEmailCollisions(db, ["libre@b.com"]);
    expect(map.has("libre@b.com")).toBe(false);
  });

  it("un socio dado de baja NO se marca; el suspendido sí", async () => {
    const { db } = makeDb({
      members: [
        { id: 1, fullName: "Baja Vieja", email: "compartida@b.com", status: "withdrawn", memberships: [] },
        {
          id: 2, fullName: "Suspendida Pérez", email: "suspendida@b.com", status: "suspended",
          memberships: [{ memberNumber: 44, bookStatus: "open" }],
        },
      ],
    });
    const map = await findEmailCollisions(db, ["compartida@b.com", "suspendida@b.com"]);
    expect(map.has("compartida@b.com")).toBe(false);
    expect(map.get("suspendida@b.com")).toEqual([
      { kind: "member", memberId: 2, memberNumber: 44, fullName: "Suspendida Pérez" },
    ]);
  });

  it("el número de socio sale del libro ABIERTO; sin ficha en él queda null", async () => {
    const { db } = makeDb({
      members: [
        {
          id: 3, fullName: "Sólo Libro Uno", email: "vieja@b.com", status: "active",
          memberships: [{ memberNumber: 120, bookStatus: "closed" }],
        },
      ],
    });
    const map = await findEmailCollisions(db, ["vieja@b.com"]);
    expect(map.get("vieja@b.com")).toEqual([
      { kind: "member", memberId: 3, memberNumber: null, fullName: "Sólo Libro Uno" },
    ]);
  });

  it("sólo cuentan las solicitudes en trámite: una rechazada no colisiona", async () => {
    const { db } = makeDb({
      applications: [
        { id: 10, email: "dos@b.com", status: "pending_board" },
        { id: 11, email: "dos@b.com", status: "rejected" },
      ],
    });
    const map = await findEmailCollisions(db, ["dos@b.com"]);
    expect(map.get("dos@b.com")).toEqual([{ kind: "application", applicationId: 10 }]);
  });

  it("matchea sin distinguir mayúsculas y devuelve la clave NORMALIZADA", async () => {
    const { db } = makeDb({
      members: [
        {
          id: 4, fullName: "Mixta Case", email: "Vecino@Gmail.COM", status: "active",
          memberships: [{ memberNumber: 12, bookStatus: "open" }],
        },
      ],
      applications: [{ id: 20, email: "  VECINO@gmail.com ", status: "started" }],
    });
    const map = await findEmailCollisions(db, ["  Vecino@GMAIL.com  "]);
    expect([...map.keys()]).toEqual(["vecino@gmail.com"]);
    expect(map.get("vecino@gmail.com")).toEqual([
      { kind: "member", memberId: 4, memberNumber: 12, fullName: "Mixta Case" },
      { kind: "application", applicationId: 20 },
    ]);
  });

  it("una misma casilla acumula sus varias colisiones en UNA entrada", async () => {
    const { db } = makeDb({
      users: [{ id: 5, email: "familia@b.com", roles: ["socio"] }],
      members: [
        {
          id: 6, fullName: "Ana Gómez", email: "familia@b.com", status: "active",
          memberships: [{ memberNumber: 88, bookStatus: "open" }],
        },
      ],
      applications: [{ id: 30, email: "familia@b.com", status: "pending_payment" }],
    });
    const map = await findEmailCollisions(db, ["familia@b.com"]);
    expect(map.get("familia@b.com")).toEqual([
      { kind: "account", userId: 5, boundMemberId: null },
      { kind: "member", memberId: 6, memberNumber: 88, fullName: "Ana Gómez" },
      { kind: "application", applicationId: 30 },
    ]);
  });

  it("consulta UNA sola vez por tabla para toda la lista (sin N+1)", async () => {
    const { db, calls } = makeDb({
      applications: [
        { id: 41, email: "a@b.com", status: "started" },
        { id: 42, email: "c@d.com", status: "started" },
      ],
    });
    const map = await findEmailCollisions(db, ["a@b.com", "c@d.com", "e@f.com", "a@b.com"]);
    expect(calls).toEqual({ user: 1, member: 1, application: 1 });
    expect(map.size).toBe(2);
  });

  it("descarta direcciones vacías o en blanco de la entrada", async () => {
    const { db, calls } = makeDb({});
    const map = await findEmailCollisions(db, ["", "   "]);
    expect(map.size).toBe(0);
    expect(calls).toEqual({ user: 0, member: 0, application: 0 });
  });
});

describe("collisionsFor", () => {
  it("la solicitud NO se ve a sí misma en la lista", async () => {
    const { db } = makeDb({
      applications: [
        { id: 50, email: "propia@b.com", status: "pending_board" },
        { id: 51, email: "propia@b.com", status: "started" },
      ],
    });
    const map = await findEmailCollisions(db, ["propia@b.com"]);
    expect(collisionsFor(map, "propia@b.com", 50)).toEqual([{ kind: "application", applicationId: 51 }]);
    expect(collisionsFor(map, "propia@b.com", 51)).toEqual([{ kind: "application", applicationId: 50 }]);
  });

  it("sin otra solicitud viva que la propia no queda nada que mostrar", async () => {
    const { db } = makeDb({
      applications: [{ id: 50, email: "propia@b.com", status: "pending_board" }],
    });
    const map = await findEmailCollisions(db, ["propia@b.com"]);
    expect(collisionsFor(map, "propia@b.com", 50)).toEqual([]);
  });

  // El asiento en acta COPIA el email de la solicitud a la ficha que crea
  // (`record.ts`, contactData.email), así que toda solicitud `completed` colisiona
  // contra su PROPIO socio —y contra la cuenta que esa alta le abrió—. Sin esta
  // exclusión el detalle de un alta ya resuelta mostraba un aviso que es falso
  // sobre la persona misma: "el email ya figura en la ficha del socio N° X",
  // siendo X ella.
  it("una solicitud ya asentada no se avisa sobre su propia ficha ni sobre la cuenta de esa ficha", async () => {
    const { db } = makeDb({
      users: [{ id: 60, email: "asentada@b.com", roles: ["socio"], boundMemberId: 70 }],
      members: [
        {
          id: 70, fullName: "Recién Asentada", email: "asentada@b.com", status: "active",
          memberships: [{ memberNumber: 300, bookStatus: "open" }],
        },
        {
          id: 71, fullName: "Cónyuge Pérez", email: "asentada@b.com", status: "active",
          memberships: [{ memberNumber: 301, bookStatus: "open" }],
        },
      ],
    });
    const map = await findEmailCollisions(db, ["asentada@b.com"]);
    // La ficha propia y su cuenta se van; el cónyuge que comparte casilla SIGUE
    // avisando, que es todo el punto de la pantalla.
    expect(collisionsFor(map, "asentada@b.com", 99, 70)).toEqual([
      { kind: "member", memberId: 71, memberNumber: 301, fullName: "Cónyuge Pérez" },
    ]);
    // Sin `ownMemberId` —la solicitud viva de la cola, que todavía no creó
    // ninguna ficha— no se excluye nada.
    expect(collisionsFor(map, "asentada@b.com", 99)).toEqual([
      { kind: "account", userId: 60, boundMemberId: 70 },
      { kind: "member", memberId: 70, memberNumber: 300, fullName: "Recién Asentada" },
      { kind: "member", memberId: 71, memberNumber: 301, fullName: "Cónyuge Pérez" },
    ]);
  });

  it("la cuenta vinculada a OTRA ficha sigue avisando aunque se excluya la propia", async () => {
    const { db } = makeDb({
      // `User.email` es unique: la cuenta con esta casilla es una sola, y acá
      // está vinculada a la ficha 72, que NO es la de la solicitud.
      users: [{ id: 62, email: "ajena@b.com", roles: ["admin"], boundMemberId: 72 }],
      members: [
        {
          id: 70, fullName: "Recién Asentada", email: "ajena@b.com", status: "active",
          memberships: [{ memberNumber: 300, bookStatus: "open" }],
        },
      ],
    });
    const map = await findEmailCollisions(db, ["ajena@b.com"]);
    expect(collisionsFor(map, "ajena@b.com", 99, 70)).toEqual([
      { kind: "admin_account", userId: 62, boundMemberId: 72 },
    ]);
  });

  it("una cuenta SIN ficha vinculada no la excluye ningún ownMemberId", async () => {
    const { db } = makeDb({
      users: [{ id: 63, email: "suelta@b.com", roles: ["socio"] }],
    });
    const map = await findEmailCollisions(db, ["suelta@b.com"]);
    expect(collisionsFor(map, "suelta@b.com", 99, 70)).toEqual([
      { kind: "account", userId: 63, boundMemberId: null },
    ]);
  });

  // La cola, que lista solicitudes VIVAS: un `memberId` ahí es la ficha
  // `withdrawn` del ex socio que reingresa. La ficha ya la descarta la consulta,
  // pero la CUENTA del portal vinculada a ella no, y sin `ownMemberId` el
  // reingreso se marcaba "Email en uso" por su propia cuenta — la misma clase de
  // falso positivo que el aviso del alta ya asentada.
  //
  // No hay una cuenta de un TERCERO con esta misma casilla porque `User.email`
  // es unique: sólo puede existir una. El caso de la cuenta colgada de otra
  // ficha lo cubre el test de acá arriba; lo que sí acompaña acá es un socio
  // vigente distinto y otra solicitud viva, que tienen que seguir avisando.
  it("un reingreso no se marca por su propia cuenta, pero un tercero con la misma casilla sí", async () => {
    const { db } = makeDb({
      users: [{ id: 81, email: "reingreso@b.com", roles: ["socio"], boundMemberId: 80 }],
      members: [
        { id: 80, fullName: "Ex Socio Vuelve", email: "reingreso@b.com", status: "withdrawn", memberships: [] },
        {
          id: 82, fullName: "Tercera Distinta", email: "reingreso@b.com", status: "active",
          memberships: [{ memberNumber: 150, bookStatus: "open" }],
        },
      ],
      applications: [
        { id: 90, email: "reingreso@b.com", status: "pending_board" },
        { id: 91, email: "reingreso@b.com", status: "started" },
      ],
    });
    const map = await findEmailCollisions(db, ["reingreso@b.com"]);
    expect(collisionsFor(map, "reingreso@b.com", 90, 80)).toEqual([
      { kind: "member", memberId: 82, memberNumber: 150, fullName: "Tercera Distinta" },
      { kind: "application", applicationId: 91 },
    ]);
    // Sin el cuarto argumento —lo que hacía la cola antes— la cuenta propia del
    // ex socio se colaba y la tarjeta se marcaba por ella sola.
    expect(collisionsFor(map, "reingreso@b.com", 90)).toContainEqual(
      { kind: "account", userId: 81, boundMemberId: 80 },
    );
  });

  // El caso MÁS común del detalle: una solicitud viva, cuyo `app.memberId` es
  // `null`, contra una cuenta del portal que no cuelga de ninguna ficha. Sin el
  // corto circuito de `ownMemberId` nulo, `null !== null` da false y la cuenta se
  // excluiría sola: el aviso desaparecía justo donde tiene que estar.
  it("con ownMemberId null, una cuenta sin ficha SIGUE avisando", async () => {
    const { db } = makeDb({
      users: [{ id: 64, email: "viva@b.com", roles: ["socio"] }],
    });
    const map = await findEmailCollisions(db, ["viva@b.com"]);
    expect(collisionsFor(map, "viva@b.com", 99, null)).toEqual([
      { kind: "account", userId: 64, boundMemberId: null },
    ]);
  });

  it("normaliza la dirección de consulta y tolera la ausente", () => {
    const map = new Map([["vecino@b.com", [{ kind: "account" as const, userId: 1, boundMemberId: null }]]]);
    expect(collisionsFor(map, "  Vecino@B.com ", 1)).toEqual([{ kind: "account", userId: 1, boundMemberId: null }]);
    expect(collisionsFor(map, null, 1)).toEqual([]);
    expect(collisionsFor(map, "nadie@b.com", 1)).toEqual([]);
  });
});
