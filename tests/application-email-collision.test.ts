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

type UserRow = { id: number; email: string; roles: string[] };
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
    expect(map.get("socio@b.com")).toEqual([{ kind: "account", userId: 7 }]);
    expect(map.get("jefe@b.com")).toEqual([{ kind: "admin_account", userId: 8 }]);
    expect(map.get("manda@b.com")).toEqual([{ kind: "admin_account", userId: 9 }]);
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
      { kind: "account", userId: 5 },
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

  it("normaliza la dirección de consulta y tolera la ausente", () => {
    const map = new Map([["vecino@b.com", [{ kind: "account" as const, userId: 1 }]]]);
    expect(collisionsFor(map, "  Vecino@B.com ", 1)).toEqual([{ kind: "account", userId: 1 }]);
    expect(collisionsFor(map, null, 1)).toEqual([]);
    expect(collisionsFor(map, "nadie@b.com", 1)).toEqual([]);
  });
});
