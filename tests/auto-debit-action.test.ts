import { beforeEach, describe, expect, it, vi } from "vitest";

// La corrección del flag `Member.autoDebit` de la ficha. Tres caminos lo suben
// (padrón importado, alta web, vinculación) y hasta la 4C ninguno lo bajaba,
// así que la ficha —y la exportación que va a la Comisión— podían decir que un
// socio tiene débito automático diez años después de que lo cancelara.
//
// Lo que fija este archivo: que la acción no se pueda correr sin admin, que no
// escriba ni audite cuando no hay nada que cambiar, y que el asiento diga de
// qué valor a qué valor.
vi.mock("@/lib/prisma", () => ({
  prisma: {
    member: { findUnique: vi.fn(), update: vi.fn(async () => ({})) },
    fee: { count: vi.fn(async () => 0) },
    minute: { findUnique: vi.fn(async () => ({ id: 5 })) },
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Map([["x-real-ip", "10.0.0.9"]])),
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

vi.mock("@/lib/auth/require-admin", () => ({
  requireAdmin: vi.fn(async () => ({ ok: true, actorId: 7 })),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/members/service", () => ({
  electionsOngoing: vi.fn(async () => false),
  memberService: {},
}));
vi.mock("@/lib/members/withdraw-with-debits", () => ({
  withdrawWithDebits: { withdraw: vi.fn(async () => ({ debits: { cancelled: [], failed: [] } })) },
}));

import { revalidatePath } from "next/cache";
import { setAutoDebitAction } from "@/app/admin/socios/[id]/actions";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth/require-admin";
import { prisma } from "@/lib/prisma";

type MockedFn = ReturnType<typeof vi.fn>;

const db = prisma as unknown as {
  member: { findUnique: MockedFn; update: MockedFn };
};

function form(over: Record<string, string> = {}) {
  const fd = new FormData();
  for (const [k, v] of Object.entries({ memberId: "12", ...over })) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAdmin).mockResolvedValue({ ok: true, actorId: 7 } as never);
  db.member.findUnique.mockResolvedValue({ id: 12, autoDebit: false });
});

describe("setAutoDebitAction", () => {
  it("sin admin no toca la ficha", async () => {
    vi.mocked(requireAdmin).mockResolvedValueOnce({
      ok: false, reason: "not_admin", error: "Necesitás permisos de administrador.",
    } as never);
    const r = await setAutoDebitAction({}, form({ autoDebit: "on" }));
    expect(r.error).toBe("Necesitás permisos de administrador.");
    expect(db.member.update).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("un socio que no existe se rechaza en castellano, no con un error de Prisma", async () => {
    db.member.findUnique.mockResolvedValueOnce(null);
    const r = await setAutoDebitAction({}, form({ autoDebit: "on" }));
    expect(r.error).toBe("El socio no existe.");
    expect(db.member.update).not.toHaveBeenCalled();
  });

  it("de false a true escribe y deja el asiento con el antes y el después", async () => {
    const r = await setAutoDebitAction({}, form({ autoDebit: "on" }));
    expect(r.error).toBeUndefined();
    expect(db.member.update).toHaveBeenCalledWith({ where: { id: 12 }, data: { autoDebit: true } });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      userId: 7, action: "member_auto_debit_set", entity: "member", entityId: 12,
      detail: { from: false, to: true }, ip: "10.0.0.9",
    }));
    expect(revalidatePath).toHaveBeenCalledWith("/admin/socios/12");
  });

  it("el checkbox destildado BAJA el flag: es el camino que no existía", async () => {
    db.member.findUnique.mockResolvedValueOnce({ id: 12, autoDebit: true });
    await setAutoDebitAction({}, form());
    expect(db.member.update).toHaveBeenCalledWith({ where: { id: 12 }, data: { autoDebit: false } });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ detail: { from: true, to: false } }));
  });

  it("guardar sin cambio no escribe ni audita", async () => {
    // El formulario se puede reenviar (recarga, doble clic) y una auditoría de
    // "false → false" es ruido en el único registro donde se busca quién tocó qué.
    await setAutoDebitAction({}, form());
    expect(db.member.update).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("un valor que el checkbox no puede mandar se rechaza", async () => {
    const r = await setAutoDebitAction({}, form({ autoDebit: "true" }));
    expect(r.error).toBeTruthy();
    expect(db.member.update).not.toHaveBeenCalled();
  });
});
