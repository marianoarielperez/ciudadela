// Rechazo de solicitudes de socios desde el panel (`admin/solicitudes/socios`).
// Andamiaje de `mi-solicitudes-actions.test.ts` adaptado a admin: acá se
// mockea `requireAdmin` en vez de `requireMember`, y el `decidedById` que
// llega al servicio es el del ACTOR (el admin logueado), nunca del formulario.
// La guarda de negocio real ("sólo actúa sobre pending") vive en el servicio:
// acá sólo se prueba que la action llama y traslada el error.
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdmin = vi.fn();
vi.mock("@/lib/auth/require-admin", () => ({
  requireAdmin: (...a: unknown[]) => requireAdmin(...a),
}));
type RejectResult =
  | { ok: true; memberId: number; type: "withdrawal" | "category_change" }
  | { ok: false; error: string };
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- la firma existe para tipar, no para leerse
const reject = vi.fn(async (..._args: unknown[]): Promise<RejectResult> => ({
  ok: true, memberId: 7, type: "withdrawal",
}));
vi.mock("@/lib/members/member-requests/service", () => ({
  memberRequests: { reject: (...a: unknown[]) => reject(...a) },
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("next/headers", () => ({ headers: async () => ({ get: () => "1.2.3.4" }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { rejectRequestAction } from "@/app/admin/solicitudes/socios/actions";

const OK_ACTOR = { ok: true, actorId: 3 };
const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

beforeEach(() => {
  vi.clearAllMocks();
  reject.mockResolvedValue({ ok: true, memberId: 7, type: "withdrawal" });
  requireAdmin.mockResolvedValue(OK_ACTOR);
});

describe("rejectRequestAction", () => {
  it("rejects a non-admin actor without touching the service", async () => {
    requireAdmin.mockResolvedValue({ ok: false, reason: "not_admin", error: "No tenés permiso." });
    const r = await rejectRequestAction({}, fd({ requestId: "55" }));
    expect(r.error).toBe("No tenés permiso.");
    expect(reject).not.toHaveBeenCalled();
  });

  it("passes the form's requestId with the ACTOR's decidedById, ignoring any decidedById in the form", async () => {
    const r = await rejectRequestAction({}, fd({ requestId: "55", decidedById: "999", note: "no cumple" }));
    expect(r.done).toBe(true);
    expect(reject).toHaveBeenCalledWith({ requestId: 55, decidedById: 3, note: "no cumple" });
  });

  it("surfaces the service's error verbatim", async () => {
    reject.mockResolvedValueOnce({ ok: false, error: "La solicitud ya fue resuelta o no existe." });
    const r = await rejectRequestAction({}, fd({ requestId: "55" }));
    expect(r.error).toBe("La solicitud ya fue resuelta o no existe.");
    expect(r.done).toBeUndefined();
  });

  it("rejects a note longer than 500 characters without touching the service", async () => {
    const r = await rejectRequestAction({}, fd({ requestId: "55", note: "x".repeat(501) }));
    expect(r.error).toContain("500");
    expect(reject).not.toHaveBeenCalled();
  });

  // Ley 25.326: el asiento lleva ids y el tipo, nunca la nota que escribió el
  // admin. Un cambio que agregara la nota al detail "para depurar mejor" tiene
  // que romper este test.
  it("audits with ids and type only, never the rejection note", async () => {
    const { audit } = await import("@/lib/audit");
    const r = await rejectRequestAction({}, fd({ requestId: "55", note: "no corresponde por REG-19" }));
    expect(r.done).toBe(true);
    expect(vi.mocked(audit)).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 3,
        action: "member_request_reject",
        entity: "member",
        entityId: 7,
        detail: expect.objectContaining({ requestId: 55, type: "withdrawal" }),
      }),
    );
    const [call] = vi.mocked(audit).mock.calls;
    expect(JSON.stringify(call[0])).not.toContain("no corresponde por REG-19");
  });
});
