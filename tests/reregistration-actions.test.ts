// Las dos acciones de fase del re-empadronamiento (`/admin/reempadronamiento`).
//
// Una server action no se despacha por su URL sino por el id del encabezado
// `Next-Action`, así que ni el proxy ni el chequeo de rol del layout corren
// sobre estos POST: lo único que cierra la puerta es el `requireSuperadmin()`
// de la primera línea. Convocar le abre a ciento y pico de vecinos un plazo de
// treinta días del que cuelga su condición de socio, y abrir la segunda
// instancia les abre el último — el que termina en la baja del Art. 9° bis.
//
// Lo otro que este archivo fija es el orden del acta: pre-validar → resolver el
// acta → ejecutar → COMPENSAR si falla. Un acta creada para un proceso que el
// servicio rechazó es un asiento fantasma en un libro que la asociación
// presenta ante la IGJ.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/require-admin", () => ({ requireSuperadmin: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: { reregistrationProcess: { findFirst: vi.fn(async () => null) } },
}));
vi.mock("@/lib/members/service", () => ({
  requireOpenBook: vi.fn(async () => ({ id: 1, number: 1 })),
}));
// El schema del acta y `createsNewMinute` quedan REALES: son la parte que
// decide si hay algo que compensar. Los dos que tocan la base se doblan.
vi.mock("@/lib/members/minute-form", async (orig) => ({
  ...(await orig<typeof import("@/lib/members/minute-form")>()),
  resolveMinuteId: vi.fn(async () => 77),
  discardUnusedMinute: vi.fn(async () => {}),
}));
vi.mock("@/lib/reregistration/service", () => ({
  LIVE_PROCESS_STATUSES: ["preparing", "first_instance", "second_instance", "closing"],
  reregistration: { activate: vi.fn(), startSecond: vi.fn() },
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("next/cache", async (orig) => ({
  ...(await orig<typeof import("next/cache")>()),
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
}));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Map([["x-real-ip", "10.0.0.4"]])),
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { revalidatePath, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { callProcessAction, startSecondAction } from "@/app/admin/reempadronamiento/actions";
import { audit } from "@/lib/audit";
import type { AdminActor } from "@/lib/auth/require-admin";
import { requireSuperadmin } from "@/lib/auth/require-admin";
import { CACHE_TAGS } from "@/lib/cache-tags";
import { discardUnusedMinute, resolveMinuteId } from "@/lib/members/minute-form";
import { requireOpenBook } from "@/lib/members/service";
import { prisma } from "@/lib/prisma";
import { reregistration } from "@/lib/reregistration/service";

type MockedFn = ReturnType<typeof vi.fn>;

const superadmin: AdminActor = { ok: true, actorId: 7 };
const plainAdmin: AdminActor = {
  ok: false,
  reason: "not_admin",
  error: "Solo el superadmin puede cambiar la configuración.",
};

const OK_ACTIVATE = {
  ok: true as const,
  processId: 3,
  cohortSize: 124,
  boardCount: 100,
  emailed: 20,
  failed: 1,
  blocked: 3,
  deferred: 0,
  failedIds: [14],
  blockedIds: [21, 22, 23],
  deferredIds: [],
};

const OK_SECOND = {
  ok: true as const,
  processId: 3,
  secondEndsAt: new Date("2026-10-11T15:00:00Z"),
  pending: 90,
  boardCount: 80,
  emailed: 8,
  failed: 0,
  blocked: 2,
  deferred: 0,
  failedIds: [],
  blockedIds: [21, 22],
  deferredIds: [],
};

/** El formulario completo de la convocatoria, con acta NUEVA salvo que el caso
 *  pida otra cosa (es el camino que puede dejar un acta huérfana). */
function callForm(over: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const fields: Record<string, string> = {
    calledAt: "2026-09-01",
    minuteMode: "new",
    minuteNew: "1",
    minuteType: "board",
    minuteNumber: "48",
    minuteDate: "2026-09-01",
    ...over,
  };
  for (const [k, v] of Object.entries(fields)) if (v !== "") fd.set(k, v);
  return fd;
}

function secondForm(over: Record<string, string> = {}): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries({ processId: "3", ...over })) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  (requireSuperadmin as MockedFn).mockResolvedValue(superadmin);
  (prisma.reregistrationProcess.findFirst as MockedFn).mockResolvedValue(null);
  (requireOpenBook as MockedFn).mockResolvedValue({ id: 1, number: 1 });
  (resolveMinuteId as MockedFn).mockResolvedValue(77);
  (reregistration.activate as MockedFn).mockResolvedValue(OK_ACTIVATE);
  (reregistration.startSecond as MockedFn).mockResolvedValue(OK_SECOND);
});

describe("callProcessAction — autorización", () => {
  it("corta al admin común sin llegar al servicio ni al acta", async () => {
    (requireSuperadmin as MockedFn).mockResolvedValue(plainAdmin);

    const state = await callProcessAction({}, callForm());

    expect(state?.error).toBe(plainAdmin.error);
    expect(resolveMinuteId).not.toHaveBeenCalled();
    expect(reregistration.activate).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("chequea el rol ANTES de leer nada de la base", async () => {
    (requireSuperadmin as MockedFn).mockResolvedValue(plainAdmin);

    await callProcessAction({}, callForm());

    expect(requireOpenBook).not.toHaveBeenCalled();
    expect(prisma.reregistrationProcess.findFirst).not.toHaveBeenCalled();
  });
});

describe("callProcessAction — el acta nunca queda huérfana", () => {
  it("no crea el acta si ya hay un proceso vivo (el rechazo frecuente)", async () => {
    (prisma.reregistrationProcess.findFirst as MockedFn).mockResolvedValue({ id: 9 });

    const state = await callProcessAction({}, callForm());

    expect(state?.error).toBe("Ya hay un proceso de re-empadronamiento en curso.");
    expect(resolveMinuteId).not.toHaveBeenCalled();
    expect(discardUnusedMinute).not.toHaveBeenCalled();
  });

  it("descarta el acta recién creada cuando `activate` rechaza", async () => {
    (reregistration.activate as MockedFn).mockResolvedValue({ ok: false, error: "Ya hay un proceso." });

    const state = await callProcessAction({}, callForm());

    expect(state?.error).toBe("Ya hay un proceso.");
    expect(discardUnusedMinute).toHaveBeenCalledWith(expect.anything(), 77);
    expect(audit).not.toHaveBeenCalled();
  });

  it("descarta el acta recién creada cuando `activate` explota", async () => {
    (reregistration.activate as MockedFn).mockRejectedValue(new Error("La base se cayó."));

    const state = await callProcessAction({}, callForm());

    expect(state?.error).toBe("La base se cayó.");
    expect(discardUnusedMinute).toHaveBeenCalledWith(expect.anything(), 77);
  });

  it("NO descarta un acta preexistente elegida del desplegable", async () => {
    (reregistration.activate as MockedFn).mockResolvedValue({ ok: false, error: "no" });

    await callProcessAction(
      {},
      // Acta existente: no la creó esta acción, así que no es suya para borrarla
      // (entre medio otro admin pudo haberla usado para su propio asiento).
      callForm({ minuteMode: "existing", minuteId: "12", minuteNew: "", minuteType: "", minuteNumber: "", minuteDate: "" }),
    );

    expect(discardUnusedMinute).not.toHaveBeenCalled();
  });
});

describe("callProcessAction — camino feliz", () => {
  it("convoca, asienta y deja el proceso apuntado por la configuración pública", async () => {
    await callProcessAction({}, callForm());

    expect(reregistration.activate).toHaveBeenCalledWith(
      expect.objectContaining({ bookId: 1, minuteId: 77, actorId: 7, igjApprovedAt: null, estimatedElectionAt: null }),
    );
    // La fecha civil viaja al mediodía UTC, que es como el proyecto guarda toda
    // fecha civil: a las 21:00 de acá un `new Date("2026-09-01")` crudo ya sería
    // el día siguiente.
    const { calledAt } = (reregistration.activate as MockedFn).mock.calls[0][0];
    expect((calledAt as Date).toISOString()).toBe("2026-09-01T12:00:00.000Z");
    expect(redirect).toHaveBeenCalledWith("/admin/reempadronamiento");
  });

  it("invalida el caché del sitio público: sin eso ASOCIATE sigue abierto", async () => {
    await callProcessAction({}, callForm());

    expect(updateTag).toHaveBeenCalledWith(CACHE_TAGS.config);
    expect(revalidatePath).toHaveBeenCalledWith("/admin/reempadronamiento");
  });

  it("el asiento lleva números de socio y conteos, nunca nombres ni direcciones", async () => {
    await callProcessAction({}, callForm());

    const entry = (audit as MockedFn).mock.calls[0][0] as { action: string; entityId: number; detail: Record<string, unknown> };
    expect(entry.action).toBe("reregistration_call");
    expect(entry.entityId).toBe(3);
    expect(entry.detail).toEqual({
      bookId: 1, cohortSize: 124, emailed: 20, boardCount: 100, minuteId: 77,
      failedIds: [14], blockedIds: [21, 22, 23], deferredIds: [],
    });
    // El candado: ni el JSON del asiento ni ninguna de sus claves puede traer
    // algo que parezca un nombre o un correo (Ley 25.326, docs/08).
    const dump = JSON.stringify(entry.detail);
    expect(dump).not.toMatch(/@/);
    expect(dump).not.toMatch(/[A-Za-z]{4,}\s+[A-Za-z]{4,}/);
  });

  it("rechaza una fecha que el calendario no tiene, antes de crear el acta", async () => {
    const state = await callProcessAction({}, callForm({ calledAt: "2026-02-31" }));

    expect(state?.error).toBe("La fecha de la convocatoria no existe en el calendario.");
    expect(resolveMinuteId).not.toHaveBeenCalled();
  });

  it("pasa las dos fechas opcionales cuando vienen", async () => {
    await callProcessAction({}, callForm({ igjApprovedAt: "2026-08-15", estimatedElectionAt: "2027-04-10" }));

    const arg = (reregistration.activate as MockedFn).mock.calls[0][0];
    expect((arg.igjApprovedAt as Date).toISOString()).toBe("2026-08-15T12:00:00.000Z");
    expect((arg.estimatedElectionAt as Date).toISOString()).toBe("2027-04-10T12:00:00.000Z");
  });
});

describe("startSecondAction", () => {
  it("corta al admin común sin llegar al servicio", async () => {
    (requireSuperadmin as MockedFn).mockResolvedValue(plainAdmin);

    const state = await startSecondAction({}, secondForm());

    expect(state.error).toBe(plainAdmin.error);
    expect(reregistration.startSecond).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("sin el tilde, `force` viaja en false: el plazo lo decide el servicio", async () => {
    await startSecondAction({}, secondForm());

    expect(reregistration.startSecond).toHaveBeenCalledWith({ processId: 3, actorId: 7, force: false });
  });

  it("con el tilde puesto, `force` viaja en true", async () => {
    await startSecondAction({}, secondForm({ force: "on" }));

    expect(reregistration.startSecond).toHaveBeenCalledWith({ processId: 3, actorId: 7, force: true });
  });

  it("devuelve el error del servicio sin asentar nada", async () => {
    (reregistration.startSecond as MockedFn).mockResolvedValue({
      ok: false, error: "La primera instancia todavía no venció.",
    });

    const state = await startSecondAction({}, secondForm());

    expect(state.error).toBe("La primera instancia todavía no venció.");
    expect(audit).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("asienta quién la abrió, si la adelantó y a quién no se pudo avisar", async () => {
    const state = await startSecondAction({}, secondForm({ force: "on" }));

    expect(state.ok).toBe(true);
    const entry = (audit as MockedFn).mock.calls[0][0] as { action: string; detail: Record<string, unknown> };
    expect(entry.action).toBe("reregistration_second");
    expect(entry.detail).toMatchObject({ pending: 90, emailed: 8, boardCount: 80, forced: true, blockedIds: [21, 22] });
    expect(JSON.stringify(entry.detail)).not.toMatch(/@/);
  });
});
