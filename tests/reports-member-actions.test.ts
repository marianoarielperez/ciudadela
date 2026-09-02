// El borrador del SOCIO (spec §5.2): requireMember({ allowSuspended: true })
// —el suspendido puede reportar—, el memberId sale del actor, la identidad se
// copia de la ficha, cupo por socio y sin Turnstile.
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  requireMember: vi.fn(), startDraft: vi.fn(), findUnique: vi.fn(),
  check: vi.fn(() => true),
}));
vi.mock("@/lib/auth/require-member", () => ({ requireMember: mocks.requireMember }));
vi.mock("@/lib/reports/service", () => ({ reports: { startDraft: mocks.startDraft } }));
vi.mock("@/lib/prisma", () => ({ prisma: { member: { findUnique: mocks.findUnique } } }));
vi.mock("@/lib/auth/rate-limiter", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth/rate-limiter")>()),
  reportMemberLimiter: { check: mocks.check },
}));
vi.mock("@/lib/turnstile", () => ({ verifyTurnstile: vi.fn(() => { throw new Error("el socio no pasa por Turnstile"); }) }));
// Misma invariante que las actions públicas: el wizard estampa la llave con
// `history.replaceState` y una revalidación remontaría el árbol vivo.
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(() => { throw new Error("una action del wizard NO revalida"); }),
  revalidateTag: vi.fn(() => { throw new Error("una action del wizard NO revalida"); }),
  unstable_cache: <T,>(fn: T) => fn,
}));
vi.mock("next/headers", () => ({ headers: async () => new Map([["x-real-ip", "1.1.1.1"], ["user-agent", "ua"]]) }));
import { startMemberReportAction } from "@/app/mi/solicitudes/reportes/actions";

const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireMember.mockResolvedValue({ ok: true, userId: 9, memberId: 14, fullName: "Ana López", suspension: null });
  mocks.findUnique.mockResolvedValue({ fullName: "Ana López", dni: "30123456", phone: "2974", email: "ana@example.com" });
  mocks.startDraft.mockResolvedValue({ id: 5, claim: "C".repeat(43) });
  mocks.check.mockReturnValue(true);
});

describe("startMemberReportAction", () => {
  it("crea el borrador del socio con la identidad de la ficha", async () => {
    const r = await startMemberReportAction({}, fd({ kind: "iniciativa", anonymous: "no" }));
    expect(r).toEqual({ started: { claim: "C".repeat(43) } });
    expect(mocks.requireMember).toHaveBeenCalledWith({ allowSuspended: true });
    expect(mocks.startDraft).toHaveBeenCalledWith({
      kind: "initiative", anonymous: false, memberId: 14,
      reporter: { name: "Ana López", dni: "30123456", phone: "2974", email: "ana@example.com" },
      ip: "1.1.1.1", userAgent: "ua",
    });
  });
  it("actor bloqueado o sin cupo: no toca el servicio", async () => {
    mocks.requireMember.mockResolvedValue({ ok: false, reason: "withdrawn", error: "baja" });
    expect((await startMemberReportAction({}, fd({ kind: "reclamo", anonymous: "si" }))).error).toBe("baja");
    mocks.requireMember.mockResolvedValue({ ok: true, userId: 9, memberId: 14, fullName: "x", suspension: null });
    mocks.check.mockReturnValue(false);
    expect((await startMemberReportAction({}, fd({ kind: "reclamo", anonymous: "si" }))).error).toContain("Demasiados");
    expect(mocks.startDraft).not.toHaveBeenCalled();
  });
  // El cupo se pide por memberId y no por IP: la pantalla está autenticada y
  // hay una identidad mejor que la conexión (rate-limiter.ts).
  it("el cupo se cuenta por socio", async () => {
    await startMemberReportAction({}, fd({ kind: "reclamo", anonymous: "si" }));
    expect(mocks.check).toHaveBeenCalledWith("14");
  });
  // La ficha sin teléfono ni email no puede colar `null` en el borrador: las
  // columnas son opcionales en `Member` y obligatorias en el reporte.
  it("una ficha incompleta viaja como cadena vacía, no como null", async () => {
    mocks.findUnique.mockResolvedValue({ fullName: "Ana López", dni: null, phone: null, email: null });
    await startMemberReportAction({}, fd({ kind: "reclamo", anonymous: "no" }));
    expect(mocks.startDraft.mock.calls[0][0].reporter).toEqual({
      name: "Ana López", dni: "", phone: "", email: "",
    });
  });
  it("sin ficha viva no hay borrador", async () => {
    mocks.findUnique.mockResolvedValue(null);
    const r = await startMemberReportAction({}, fd({ kind: "reclamo", anonymous: "no" }));
    expect(r.error).toContain("ficha");
    expect(mocks.startDraft).not.toHaveBeenCalled();
  });
  it("un tipo que no está en el catálogo se rechaza sin gastar el servicio", async () => {
    const r = await startMemberReportAction({}, fd({ kind: "otra_cosa", anonymous: "no" }));
    expect(r.error).toBeTruthy();
    expect(mocks.startDraft).not.toHaveBeenCalled();
  });
});
