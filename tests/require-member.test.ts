import { describe, expect, it, vi } from "vitest";

// El helper ligado importa "@/auth" y "@/lib/prisma" con import() dinámico, pero
// el módulo se importa igual desde los tests: mockeamos el singleton por las dudas.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { makeRequireMember, MEMBER_BLOCKED } from "@/lib/auth/require-member";

type SessionLike = { user?: { id?: string | null; roles?: string[] | null } | null } | null;
type MemberRow = { id: number; fullName: string; status: string; userId: number };

const MEMBER: MemberRow = { id: 7, fullName: "Perez Ana", status: "active", userId: 3 };

/** Liga el helper a una sesión y a un padrón fijos, sin NextAuth ni base. */
function bind(session: SessionLike, members: MemberRow[] = [MEMBER]) {
  const lookup = vi.fn(async (userId: number) => members.find((m) => m.userId === userId) ?? null);
  return { run: makeRequireMember(async () => session, lookup as never), lookup };
}

function session(id: string, roles: string[] = ["socio"]): SessionLike {
  return { user: { id, roles } };
}

describe("requireMember", () => {
  it("rejects an anonymous visitor without hitting the database", async () => {
    const { run, lookup } = bind(null);
    expect(await run()).toEqual({ ok: false, reason: "anonymous", error: MEMBER_BLOCKED.anonymous });
    expect(await bind({ user: null }).run()).toMatchObject({ ok: false, reason: "anonymous" });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("rejects a non numeric id in the token", async () => {
    const { run, lookup } = bind(session("abc"));
    expect(await run()).toMatchObject({ ok: false, reason: "anonymous" });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("rejects a user with no member card linked", async () => {
    const { run } = bind(session("99"));
    expect(await run()).toEqual({ ok: false, reason: "not_member", error: MEMBER_BLOCKED.not_member });
  });

  // El punto de todo el helper: la sesión es un JWT de 8 h sin revalidación, así
  // que el rol "socio" del token sobrevive a la baja. La verdad es Member.status.
  it("rejects a withdrawn member even though the token still says socio", async () => {
    const { run } = bind(session("3"), [{ ...MEMBER, status: "withdrawn" }]);
    expect(await run()).toEqual({ ok: false, reason: "withdrawn", error: MEMBER_BLOCKED.withdrawn });
  });

  // REG-20: un socio suspendido no puede operar desde su panel mientras dure la
  // suspensión.
  it("rejects a suspended member (REG-20)", async () => {
    const { run } = bind(session("3"), [{ ...MEMBER, status: "suspended" }]);
    expect(await run()).toEqual({ ok: false, reason: "suspended", error: MEMBER_BLOCKED.suspended });
  });

  it("accepts a member in good standing and returns the live card", async () => {
    const { run } = bind(session("3"));
    expect(await run()).toEqual({ ok: true, userId: 3, memberId: 7, fullName: "Perez Ana" });
  });

  // El rol del token NO es la autorización: un admin al que le dieron de alta la
  // ficha entra a /mi por su Member, y un token sin rol socio tampoco lo saca si
  // la ficha está vigente. Lo que manda es la fila viva.
  it("does not authorize by the token roles", async () => {
    expect(await bind(session("3", [])).run()).toMatchObject({ ok: true, memberId: 7 });
    expect(await bind(session("3", ["socio"]), []).run()).toMatchObject({ ok: false, reason: "not_member" });
  });

  it("looks the member up by the session user id", async () => {
    const { run, lookup } = bind(session("3"));
    await run();
    expect(lookup).toHaveBeenCalledWith(3);
  });
});
