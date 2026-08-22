import { describe, expect, it, vi } from "vitest";

// Los dobles se tipan a mano: sin esto, `vi.fn(async () => [])` infiere
// `never[]` y `vi.fn(async () => ({ ok: false, ... }))` infiere un objeto sin
// `actorId`, y cada `mockResolvedValueOnce` del cuerpo no compila.
type AdminDouble = { ok: boolean; actorId?: number; reason?: string; error?: string };
type MemberDouble = { id: number; fullName: string; status: string };

const mocks = vi.hoisted(() => ({
  withdraw: vi.fn(),
  audit: vi.fn(async () => {}),
  admin: vi.fn(async (): Promise<AdminDouble> => ({ ok: false, reason: "not_admin", error: "Necesitás permisos de administrador." })),
  prisma: {
    member: { findMany: vi.fn(async (): Promise<MemberDouble[]> => []) },
    fee: { count: vi.fn(async () => 5) },
    minute: { findUnique: vi.fn(async () => ({ id: 3 })), create: vi.fn(), delete: vi.fn() },
    movement: { count: vi.fn(async () => 0) },
    book: { count: vi.fn(async () => 0) },
    application: { count: vi.fn(async () => 0) },
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/members/service", () => ({ memberService: { withdraw: mocks.withdraw } }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: mocks.admin }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { redirect } from "next/navigation";
import { declareArrearsAction } from "@/app/admin/tesoreria/deudores/actions";

function form(ids: string, minuteId = "3") {
  const f = new FormData();
  f.append("ids", ids);
  f.append("minuteMode", "existing");
  f.append("minuteId", minuteId);
  return f;
}

describe("declareArrearsAction", () => {
  it("sin admin no da de baja a nadie", async () => {
    const r = await declareArrearsAction({}, form("1,2"));
    expect(r.error).toBe("Necesitás permisos de administrador.");
    expect(mocks.withdraw).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("sin selección avisa", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    expect((await declareArrearsAction({}, form(""))).error).toBe("Seleccioná al menos un socio.");
  });

  it("da de baja por mora a cada seleccionado con ≥4 pendientes, audita y redirige", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.prisma.member.findMany.mockResolvedValueOnce([
      { id: 1, fullName: "A", status: "active" }, { id: 2, fullName: "B", status: "active" },
    ]);
    mocks.prisma.fee.count.mockResolvedValueOnce(5).mockResolvedValueOnce(3);
    mocks.withdraw.mockResolvedValue({});
    await declareArrearsAction({}, form("1,2"));
    expect(mocks.withdraw).toHaveBeenCalledTimes(1);
    expect(mocks.withdraw).toHaveBeenCalledWith(expect.objectContaining({ memberId: 1, reason: "arrears", minuteId: 3, actorId: 9 }));
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "arrears_declared", entity: "member", entityId: 1, detail: { minuteId: 3, pendingCount: 5 } }));
    // El 2 no llega a 4 cuotas: queda como fallo y no se redirige (éxito parcial).
    expect(redirect).not.toHaveBeenCalled();
  });

  // El formulario real NO manda una lista separada por comas: manda un campo
  // `ids` por cada checkbox tildado. Con `formData.get("ids")` se declararía la
  // cesantía de UNO SOLO y el operador creería haber dado de baja a todos.
  it("acepta la selección como un campo por socio (checkboxes nativos)", async () => {
    mocks.withdraw.mockClear();
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.prisma.member.findMany.mockResolvedValueOnce([
      { id: 5, fullName: "C", status: "active" }, { id: 6, fullName: "D", status: "active" },
    ]);
    mocks.prisma.fee.count.mockResolvedValueOnce(4).mockResolvedValueOnce(11);
    const f = new FormData();
    f.append("ids", "5");
    f.append("ids", "6");
    f.append("minuteMode", "existing");
    f.append("minuteId", "3");
    await declareArrearsAction({}, f);
    expect(mocks.withdraw).toHaveBeenCalledTimes(2);
    expect(redirect).toHaveBeenCalledWith("/admin/tesoreria/deudores?declaradas=2");
  });

  // Un acta sin ningún movimiento es un asiento fantasma en un libro que se
  // presenta ante la IGJ.
  it("descarta el acta que creó este lote si no se declaró ninguna cesantía", async () => {
    mocks.withdraw.mockClear();
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.prisma.member.findMany.mockResolvedValueOnce([{ id: 1, fullName: "Perez Ana", status: "active" }]);
    mocks.prisma.fee.count.mockResolvedValueOnce(2);
    mocks.prisma.minute.create.mockResolvedValueOnce({ id: 77 });
    const f = new FormData();
    f.append("ids", "1");
    f.append("minuteMode", "new");
    f.append("minuteNew", "1");
    f.append("minuteType", "board");
    f.append("minuteNumber", "48");
    f.append("minuteDate", "2026-08-20");
    const r = await declareArrearsAction({}, f);
    expect(mocks.withdraw).not.toHaveBeenCalled();
    expect(r.error).toBe("No se declaró ninguna cesantía.");
    expect(r.failures?.[0]).toMatchObject({ memberId: 1, name: "Perez Ana" });
    expect(r.failures?.[0].error).toContain("2");
    expect(mocks.prisma.minute.delete).toHaveBeenCalledWith({ where: { id: 77 } });
  });
});
