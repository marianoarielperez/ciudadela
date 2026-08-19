import { beforeEach, describe, expect, it, vi } from "vitest";

// Las actions de `/admin/actas` son "use server" y usan los singletones de
// producción, así que se mockean sus dependencias módulo por módulo — el mismo
// patrón de `tests/update-member-action.test.ts`.
//
// Lo que fija este archivo, y hoy no fijaba nada: la guarda `requireAdmin()` de
// las dos actions (el proxy no cubre las server actions: ver el encabezado de
// `require-admin.ts`), el asiento de auditoría de la edición, y que el rechazo
// por fecha bloqueada y el choque contra `UNIQUE(type, number)` lleguen a la
// pantalla en castellano.
vi.mock("@/lib/prisma", () => {
  const db = {
    minute: {
      findUnique: vi.fn(),
      update: vi.fn(async () => ({})),
      create: vi.fn(async () => ({ id: 5 })),
    },
    movement: { count: vi.fn(async () => 0) },
    book: { count: vi.fn(async () => 0) },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  };
  return { prisma: db };
});

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Map([["x-real-ip", "10.0.0.9"]])),
}));

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

vi.mock("@/lib/auth/require-admin", () => ({
  requireAdmin: vi.fn(async () => ({ ok: true, actorId: 7 })),
}));

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));

import { redirect } from "next/navigation";
import { createMinuteAction, updateMinuteAction } from "@/app/admin/actas/actions";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth/require-admin";
import { prisma } from "@/lib/prisma";
import { civilDateUtc } from "@/lib/dates";
import { MINUTE_EDIT_ERRORS } from "@/lib/members/minute-edit";

type MockedFn = ReturnType<typeof vi.fn>;

const db = prisma as unknown as {
  minute: { findUnique: MockedFn; update: MockedFn; create: MockedFn };
  movement: { count: MockedFn };
  book: { count: MockedFn };
};

const STORED = {
  type: "board" as const, number: 47, date: civilDateUtc(2026, 8, 12),
  description: "Reunión ordinaria",
};

function editForm(over: Record<string, string> = {}) {
  const fd = new FormData();
  const values: Record<string, string> = {
    minuteId: "5", type: "board", number: "47", date: "2026-08-12",
    description: "Reunión ordinaria", ...over,
  };
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  db.minute.findUnique.mockResolvedValue(STORED);
  db.minute.update.mockResolvedValue({});
  db.minute.create.mockResolvedValue({ id: 5 });
  db.movement.count.mockResolvedValue(0);
  db.book.count.mockResolvedValue(0);
  (requireAdmin as MockedFn).mockResolvedValue({ ok: true, actorId: 7 });
});

describe("updateMinuteAction — autorización", () => {
  it("refuses to write anything when the actor is not a live admin", async () => {
    (requireAdmin as MockedFn).mockResolvedValue({
      ok: false, reason: "not_admin", error: "No tenés permisos de administración.",
    });

    const res = await updateMinuteAction({}, editForm({ number: "74" }));

    expect(res).toEqual({ error: "No tenés permisos de administración." });
    expect(db.minute.update).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe("createMinuteAction — autorización", () => {
  it("refuses to create a minute when the actor is not a live admin", async () => {
    (requireAdmin as MockedFn).mockResolvedValue({
      ok: false, reason: "anonymous", error: "Sesión inválida.",
    });

    const fd = new FormData();
    fd.set("type", "board");
    fd.set("number", "48");
    fd.set("date", "2026-08-19");

    const res = await createMinuteAction({}, fd);

    expect(res).toEqual({ error: "Sesión inválida." });
    expect(db.minute.create).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });
});

describe("updateMinuteAction — corrección del número mal tipeado", () => {
  it("saves the change and audits what moved, with the operator IP", async () => {
    await updateMinuteAction({}, editForm({ number: "74" }));

    expect(db.minute.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 5 },
      data: expect.objectContaining({ number: 74 }),
    }));
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      userId: 7, action: "minute_update", entity: "minute", entityId: 5, ip: "10.0.0.9",
      detail: { fields: ["number"], from: { number: 47 }, to: { number: 74 } },
    }));
    expect(redirect).toHaveBeenCalledWith("/admin/actas/5");
  });

  it("does not audit an edit that changed nothing", async () => {
    await updateMinuteAction({}, editForm());

    expect(db.minute.update).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledWith("/admin/actas/5");
  });
});

describe("createMinuteAction — desborde de fecha", () => {
  // El regex del schema deja pasar "2026-02-31" y años mal tipeados como
  // "0202": sin la guarda, `civilDateUtc` los desbordaría en silencio, y la
  // fecha del acta es el campo que después queda bloqueado para siempre.
  it("rejects a day that does not exist instead of rolling it over", async () => {
    const fd = new FormData();
    fd.set("type", "board");
    fd.set("number", "48");
    fd.set("date", "2026-02-31");

    const res = await createMinuteAction({}, fd);

    expect(res).toEqual({ error: "La fecha del acta no existe." });
    expect(db.minute.create).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });
});

describe("updateMinuteAction — rechazos con mensaje en castellano", () => {
  // REG-11: la fecha del acta es la fecha de ingreso de los socios admitidos en
  // ella, y esa antigüedad es inmutable.
  it("refuses to move the date of a minute that already has movements", async () => {
    db.movement.count.mockResolvedValue(2);

    const res = await updateMinuteAction({}, editForm({ date: "2026-08-13" }));

    expect(res).toEqual({ error: MINUTE_EDIT_ERRORS.dateLocked });
    expect(db.minute.update).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("turns the UNIQUE(type, number) clash into a sentence the operator can act on", async () => {
    db.minute.update.mockRejectedValue(Object.assign(new Error("boom"), { code: "P2002" }));

    const res = await updateMinuteAction({}, editForm({ number: "74" }));

    expect(res).toEqual({ error: "Ya existe el acta N° 74 de ese tipo." });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("reports a minute that no longer exists instead of crashing", async () => {
    db.minute.findUnique.mockResolvedValue(null);

    const res = await updateMinuteAction({}, editForm({ number: "74" }));

    expect(res).toEqual({ error: MINUTE_EDIT_ERRORS.notFound });
  });

  // Mismo caso que en el alta: el desborde se rechaza antes de tocar la
  // base, así que ni siquiera llega al editor a chocar contra el bloqueo por
  // movimientos.
  it("rejects a mistyped year instead of rolling it over", async () => {
    const res = await updateMinuteAction({}, editForm({ date: "0202-08-12" }));

    expect(res).toEqual({ error: "La fecha del acta tiene que estar entre 1900 y hoy." });
    expect(db.minute.update).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });
});
