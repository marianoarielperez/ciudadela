import { afterEach, describe, expect, it, vi } from "vitest";
import { authConfig } from "@/auth.config";

type Callbacks = NonNullable<typeof authConfig.callbacks>;
const jwt = authConfig.callbacks.jwt as (args: unknown) => Record<string, unknown>;
const session = authConfig.callbacks.session as Callbacks["session"];

const NOW = Date.parse("2026-08-19T10:00:00Z");
const NOW_SECONDS = Math.floor(NOW / 1000);

afterEach(() => {
  vi.useRealTimers();
});

function frozen() {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
}

describe("authConfig.callbacks.jwt — el sello de apertura de la sesión", () => {
  it("stamps authAt at sign in, in whole seconds", () => {
    frozen();
    const token = jwt({ token: {}, user: { id: "7", roles: ["socio"] } });
    expect(token).toMatchObject({ id: "7", roles: ["socio"], authAt: NOW_SECONDS });
  });

  // El punto de todo el mecanismo: el claim se escribe UNA vez, al entrar. Auth.js
  // vuelve a firmar el token en cada request que pasa por el proxy (/admin y /mi)
  // y en cada re-firma `jose` reescribe el `iat` estándar con la hora actual: si
  // la comparación colgara de `iat`, a la segunda visita la sesión ya parecería
  // posterior a cualquier cambio de contraseña y la defensa quedaría desactivada
  // en silencio. Este claim atraviesa las re-firmas sin moverse.
  it("never moves the stamp on the later calls that re-sign the token", () => {
    frozen();
    const first = jwt({ token: {}, user: { id: "7", roles: ["socio"] } });
    vi.setSystemTime(new Date(NOW + 6 * 60 * 60 * 1000));
    const refreshed = jwt({ token: { ...first, iat: NOW_SECONDS + 6 * 3600 } });
    expect(refreshed.authAt).toBe(NOW_SECONDS);
  });

  it("does not invent a stamp for a token that never had one", () => {
    frozen();
    const refreshed = jwt({ token: { id: "7", roles: ["socio"] } });
    expect(refreshed.authAt).toBeUndefined();
  });
});

describe("authConfig.callbacks.session — lo que ven las guardas", () => {
  function run(token: Record<string, unknown>) {
    const s = { user: {} } as never;
    return session!({ session: s, token } as never) as unknown as {
      user: { id?: string; roles: string[]; authAt: number | null };
    };
  }

  it("carries authAt through to the session", () => {
    expect(run({ id: "7", roles: ["admin"], authAt: NOW_SECONDS }).user.authAt).toBe(NOW_SECONDS);
  });

  // `null` y no 0 ni la hora actual: una sesión emitida antes de que el claim
  // existiera tiene que llegarles a las guardas como "no sé", que es lo que ellas
  // resuelven fallando cerradas si además la cuenta cambió la contraseña.
  it("reports an unknown stamp as null and never as a number", () => {
    expect(run({ id: "7", roles: [] }).user.authAt).toBeNull();
    expect(run({ id: "7", roles: [], authAt: "1760000000" }).user.authAt).toBeNull();
  });
});
