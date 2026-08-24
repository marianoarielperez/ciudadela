// `setElectionsFlagAction`: el interruptor del proceso electoral (Art. 5° ter).
//
// Una server action no se despacha por su URL sino por el id del encabezado
// `Next-Action`, así que ni el proxy ni el chequeo de rol del layout corren
// sobre este POST: lo único que cierra la puerta es el `requireSuperadmin()` de
// la primera línea, y eso es lo que estos tests impiden que se borre. Prender el
// flag bloquea los cambios de categoría de TODO el panel.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/require-admin", () => ({ requireSuperadmin: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: { configuration: { findUnique: vi.fn(), upsert: vi.fn() } },
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
// `@/lib/config` arrastra `unstable_cache` para las lecturas de la home, así que
// el mock de next/cache tiene que conservar el resto del módulo.
vi.mock("next/cache", async (orig) => ({
  ...(await orig<typeof import("next/cache")>()),
  revalidatePath: vi.fn(),
}));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Map([["x-real-ip", "10.0.0.7"]])),
}));

import { setElectionsFlagAction } from "@/app/admin/padron-electoral/actions";
import { audit } from "@/lib/audit";
import type { AdminActor } from "@/lib/auth/require-admin";
import { requireSuperadmin } from "@/lib/auth/require-admin";
import { CONFIG_KEYS } from "@/lib/config";
import { prisma } from "@/lib/prisma";

type MockedFn = ReturnType<typeof vi.fn>;

const ok: AdminActor = { ok: true, actorId: 7 };
const blocked: AdminActor = {
  ok: false,
  reason: "not_admin",
  error: "Solo el superadmin puede cambiar la configuración.",
};

function form(fields: Record<string, string> = {}): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  (prisma.configuration.findUnique as MockedFn).mockResolvedValue({ key: CONFIG_KEYS.electionsOngoing, value: false });
});

describe("setElectionsFlagAction — autorización", () => {
  it("rejects a plain admin without writing anything", async () => {
    (requireSuperadmin as MockedFn).mockResolvedValue(blocked);

    const state = await setElectionsFlagAction({}, form({ ongoing: "on" }));

    expect(state.error).toBe(blocked.error);
    expect(prisma.configuration.upsert).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("checks the role before even reading the current value", async () => {
    (requireSuperadmin as MockedFn).mockResolvedValue(blocked);

    await setElectionsFlagAction({}, form());

    expect(prisma.configuration.findUnique).not.toHaveBeenCalled();
  });
});

describe("setElectionsFlagAction — escritura", () => {
  beforeEach(() => {
    (requireSuperadmin as MockedFn).mockResolvedValue(ok);
  });

  it("turns the flag on, stamps who did it and leaves an audit entry", async () => {
    const state = await setElectionsFlagAction({}, form({ ongoing: "on" }));

    expect(state.error).toBeUndefined();
    expect(prisma.configuration.upsert).toHaveBeenCalledWith({
      where: { key: CONFIG_KEYS.electionsOngoing },
      update: { value: true, updatedBy: 7 },
      create: { key: CONFIG_KEYS.electionsOngoing, value: true, updatedBy: 7 },
    });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 7,
        action: "config_update",
        entity: "configuration",
        entityId: CONFIG_KEYS.electionsOngoing,
        detail: { from: false, to: true },
        ip: "10.0.0.7",
      }),
    );
  });

  it("turns it off when the checkbox comes back empty", async () => {
    (prisma.configuration.findUnique as MockedFn).mockResolvedValue({ value: true });

    await setElectionsFlagAction({}, form());

    expect(prisma.configuration.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { value: false, updatedBy: 7 } }),
    );
  });

  it("creates the row when the key was never written (from: null)", async () => {
    (prisma.configuration.findUnique as MockedFn).mockResolvedValue(null);

    await setElectionsFlagAction({}, form({ ongoing: "on" }));

    expect((audit as MockedFn).mock.calls[0][0].detail).toEqual({ from: null, to: true });
  });

  it("writes nothing and audits nothing when the value did not change", async () => {
    (prisma.configuration.findUnique as MockedFn).mockResolvedValue({ value: true });

    const state = await setElectionsFlagAction({}, form({ ongoing: "on" }));

    expect(prisma.configuration.upsert).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
    // El operador igual se entera de en qué quedó: un guardado mudo se lee como
    // un guardado que no funcionó.
    expect(state.success).toBeTruthy();
  });

  it("rejects a hand-made POST with a bogus checkbox value, in Spanish", async () => {
    const state = await setElectionsFlagAction({}, form({ ongoing: "true" }));

    expect(state.error).toBe("Valor inválido.");
    expect(prisma.configuration.upsert).not.toHaveBeenCalled();
  });
});
