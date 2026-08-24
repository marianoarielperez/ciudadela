import { describe, expect, it, vi } from "vitest";

// El helper ligado importa "@/auth" y "@/lib/prisma" con import() dinámico, pero
// el módulo se importa igual desde los tests: mockeamos el singleton por las dudas.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { ADMIN_BLOCKED } from "@/lib/auth/require-admin";
import { makeRequireMember, MEMBER_BLOCKED } from "@/lib/auth/require-member";
import { STALE_SESSION_MESSAGE } from "@/lib/auth/session-freshness";

type SessionLike = {
  user?: { id?: string | null; roles?: string[] | null; authAt?: number | null } | null;
} | null;
type MemberRow = {
  id: number;
  fullName: string;
  status: string;
  userId: number;
  active: boolean;
  passwordChangedAt: Date | null;
};

// Momento en que se abrió la sesión de referencia, en MILISEGUNDOS epoch. Va
// relativo a la hora real y no a una fecha fija porque el techo absoluto de la
// sesión se mide contra `Date.now()`: una constante congelada convertiría estos
// tests en una bomba de tiempo que empieza a fallar sola a los siete días.
const AUTH_AT = Math.floor(Date.now() / 1000) * 1000 - 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

const MEMBER: MemberRow = {
  id: 7, fullName: "Perez Ana", status: "active", userId: 3,
  active: true, passwordChangedAt: null,
};

/** Liga el helper a una sesión y a un padrón fijos, sin NextAuth ni base. */
function bind(session: SessionLike, members: MemberRow[] = [MEMBER]) {
  const lookup = vi.fn(async (userId: number) => members.find((m) => m.userId === userId) ?? null);
  return { run: makeRequireMember(async () => session, lookup as never), lookup };
}

function session(id: string, roles: string[] = ["socio"], authAt: number | null = AUTH_AT): SessionLike {
  return { user: { id, roles, authAt } };
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
    expect(await run()).toEqual({
      ok: true, userId: 3, memberId: 7, fullName: "Perez Ana", suspension: null,
    });
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

// El otro hueco del JWT sin estado: al socio le robaron la contraseña, la
// cambió, y hasta acá el intruso seguía adentro hasta que el token venciera solo.
describe("requireMember — sesiones anteriores al cambio de contraseña", () => {
  const changedAfter = new Date(AUTH_AT + 60 * 1000);
  const changedBefore = new Date(AUTH_AT - 60 * 1000);

  it("rejects a session opened before the password changed", async () => {
    const { run } = bind(session("3"), [{ ...MEMBER, passwordChangedAt: changedAfter }]);
    expect(await run()).toEqual({
      ok: false, reason: "stale_session", error: STALE_SESSION_MESSAGE,
    });
  });

  it("accepts the session opened after the change", async () => {
    const { run } = bind(session("3"), [{ ...MEMBER, passwordChangedAt: changedBefore }]);
    expect(await run()).toMatchObject({ ok: true, memberId: 7 });
  });

  // Falla cerrada: sin `authAt` no se puede probar que la sesión sea posterior.
  it("rejects a token with no authAt once the account has a password change", async () => {
    const { run } = bind(session("3", ["socio"], null), [
      { ...MEMBER, passwordChangedAt: changedBefore },
    ]);
    expect(await run()).toMatchObject({ ok: false, reason: "stale_session" });
  });

  // La regla de la comparación de contraseña sigue siendo "no echar a nadie por
  // no saber": sin `passwordChangedAt` no hay nada que afirmar y esta sesión NO
  // muere por vieja-respecto-del-cambio. Lo que la termina echando es el techo
  // absoluto, que es otra pregunta y tiene su propio motivo: una sesión que no
  // puede probar cuándo empezó tampoco puede probar que esté dentro de los 7
  // días. Que el motivo sea `expired_session` y no `stale_session` es
  // exactamente lo que prueba que la primera regla no se movió.
  it("does not call a token with no authAt stale when the password never changed", async () => {
    const { run } = bind(session("3", ["socio"], null));
    expect(await run()).toMatchObject({ ok: false, reason: "expired_session" });
  });

  // Los dos sellos están en milisegundos y se comparan exacto: la sesión abierta
  // 800 ms ANTES del cambio muere igual que la de un día antes. Truncando al
  // segundo esa sesión quedaba viva para siempre, porque los dos sellos son
  // fijos y la comparación daba `false` en todas las visitas siguientes.
  it("throws out a session opened milliseconds before the change", async () => {
    const { run } = bind(session("3"), [
      { ...MEMBER, passwordChangedAt: new Date(AUTH_AT + 800) },
    ]);
    expect(await run()).toMatchObject({ ok: false, reason: "stale_session" });
  });

  // Y el empate exacto no echa a nadie: es el caso del alta de contraseña
  // seguida del login, que salen del mismo proceso.
  it("keeps the session of someone who just signed in at the very stamp", async () => {
    const { run } = bind(session("3"), [{ ...MEMBER, passwordChangedAt: new Date(AUTH_AT) }]);
    expect(await run()).toMatchObject({ ok: true, memberId: 7 });
  });

  // La sesión muerta gana sobre el estado de la ficha: si la contraseña cambió,
  // este token no representa a nadie, esté el socio como esté en el padrón.
  it("takes precedence over the state of the member card", async () => {
    const { run } = bind(session("3"), [
      { ...MEMBER, status: "suspended", passwordChangedAt: changedAfter },
    ]);
    expect(await run()).toMatchObject({ ok: false, reason: "stale_session" });
  });
});

// El techo absoluto: las 8 horas del JWT son de INACTIVIDAD y se renuevan solas
// en cada visita, así que sin esto un token robado que el atacante siga usando
// no vence nunca por sí solo.
describe("requireMember — el techo absoluto de la sesión", () => {
  it("accepts a session opened within the last seven days", async () => {
    const { run } = bind(session("3", ["socio"], Date.now() - 6 * DAY));
    expect(await run()).toMatchObject({ ok: true, memberId: 7 });
  });

  it("rejects a session older than seven days, however much it was used", async () => {
    const { run } = bind(session("3", ["socio"], Date.now() - 8 * DAY));
    expect(await run()).toEqual({
      ok: false, reason: "expired_session", error: MEMBER_BLOCKED.expired_session,
    });
  });

  // Un token todavía sellado en segundos (la unidad anterior) cae en 1970: se
  // cierra, que es la dirección correcta y cuesta un login.
  it("rejects a token still stamped in seconds", async () => {
    const { run } = bind(session("3", ["socio"], Math.floor(Date.now() / 1000)));
    expect(await run()).toMatchObject({ ok: false, reason: "expired_session" });
  });
});

// H2: `User.active` es la palanca de "cuenta deshabilitada" y hasta acá sólo la
// miraba /admin. Que hoy toda cuenta deshabilitada sea además una baja del
// padrón es una coincidencia de `memberService.withdraw`, no una guarda.
describe("requireMember — cuenta de acceso deshabilitada", () => {
  it("rejects a member whose account was disabled without touching the card", async () => {
    const { run } = bind(session("3"), [{ ...MEMBER, active: false }]);
    expect(await run()).toEqual({
      ok: false, reason: "disabled", error: MEMBER_BLOCKED.disabled,
    });
  });

  // Pero al socio dado de baja le sigue correspondiendo el mensaje de la baja,
  // que es el hecho que le importa, y no el genérico de la cuenta: `withdraw`
  // deja las dos cosas puestas en la misma transacción.
  it("still explains the withdrawal to a member whose account was disabled by it", async () => {
    const { run } = bind(session("3"), [{ ...MEMBER, status: "withdrawn", active: false }]);
    expect(await run()).toMatchObject({ ok: false, reason: "withdrawn" });
  });

  it("uses the same wording as the admin guard", async () => {
    expect(MEMBER_BLOCKED.disabled).toBe(ADMIN_BLOCKED.disabled);
  });
});

describe("allowSuspended (M5: modo lectura del suspendido)", () => {
  const session = () => async () => ({ user: { id: "1", authAt: Date.now() } });
  const row = (over: Record<string, unknown> = {}) => ({
    id: 7, fullName: "Socia Suspendida", status: "suspended" as const,
    active: true, passwordChangedAt: null,
    suspendedFrom: new Date("2026-08-01T12:00:00Z"), suspendedTo: null,
    ...over,
  });

  it("blocks a suspended member by default (unchanged behavior)", async () => {
    const rm = makeRequireMember(session(), async () => row());
    const actor = await rm();
    expect(actor).toMatchObject({ ok: false, reason: "suspended" });
  });

  it("lets a suspended member in with allowSuspended, carrying the dates", async () => {
    const rm = makeRequireMember(session(), async () => row());
    const actor = await rm({ allowSuspended: true });
    expect(actor.ok).toBe(true);
    if (actor.ok) {
      expect(actor.suspension).toEqual({ from: new Date("2026-08-01T12:00:00Z"), to: null });
    }
  });

  it("an active member carries suspension: null", async () => {
    const rm = makeRequireMember(session(), async () =>
      row({ status: "active", suspendedFrom: null }));
    const actor = await rm({ allowSuspended: true });
    expect(actor.ok).toBe(true);
    if (actor.ok) expect(actor.suspension).toBeNull();
  });

  it("still blocks withdrawn even with allowSuspended", async () => {
    const rm = makeRequireMember(session(), async () => row({ status: "withdrawn" }));
    const actor = await rm({ allowSuspended: true });
    expect(actor).toMatchObject({ ok: false, reason: "withdrawn" });
  });

  it("still blocks a disabled account even with allowSuspended", async () => {
    const rm = makeRequireMember(session(), async () => row({ active: false }));
    const actor = await rm({ allowSuspended: true });
    expect(actor).toMatchObject({ ok: false, reason: "disabled" });
  });
});
