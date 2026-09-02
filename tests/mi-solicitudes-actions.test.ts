// El memberId sale de requireMember(), NUNCA del formulario (mismo contrato
// que mi-datos-actions.test.ts); requireMember() va SIN allowSuspended en las
// tres (el suspendido no presenta ni retira, Art. 10); las guardas de negocio
// —una pendiente por tipo, categoría fuera de catálogo, elecciones, deuda—
// viven en el servicio: acá sólo se comprueba que la action llama y traslada
// el error, salvo la categoría fuera de REQUESTABLE_CATEGORIES, que el schema
// zod rechaza ANTES de tocar el servicio.
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireMember = vi.fn();
vi.mock("@/lib/auth/require-member", () => ({
  requireMember: (...a: unknown[]) => requireMember(...a),
}));
type CreateResult = { ok: true; requestId: number } | { ok: false; error: string };
type CancelResult = { ok: true } | { ok: false; error: string };
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- la firma existe para tipar, no para leerse
const create = vi.fn(async (..._args: unknown[]): Promise<CreateResult> => ({ ok: true, requestId: 55 }));
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- la firma existe para tipar, no para leerse
const cancel = vi.fn(async (..._args: unknown[]): Promise<CancelResult> => ({ ok: true }));
vi.mock("@/lib/members/member-requests/service", () => ({
  memberRequests: { create: (...a: unknown[]) => create(...a), cancel: (...a: unknown[]) => cancel(...a) },
}));
vi.mock("@/lib/auth/rate-limiter", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/auth/rate-limiter")>();
  return { ...real, memberEditLimiter: { check: () => true } };
});
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("next/headers", () => ({ headers: async () => ({ get: () => "1.2.3.4" }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  cancelRequestAction,
  createCategoryRequestAction,
  createWithdrawalRequestAction,
} from "@/app/mi/solicitudes/actions";

const OK_ACTOR = { ok: true, userId: 9, memberId: 7, fullName: "Socia", suspension: null };
const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

beforeEach(() => {
  vi.clearAllMocks();
  create.mockResolvedValue({ ok: true, requestId: 55 });
  cancel.mockResolvedValue({ ok: true });
  requireMember.mockResolvedValue(OK_ACTOR);
});

describe("createWithdrawalRequestAction", () => {
  it("rejects a blocked actor without touching the service", async () => {
    requireMember.mockResolvedValue({ ok: false, reason: "suspended", error: "bloqueado" });
    const r = await createWithdrawalRequestAction({}, fd({ message: "me mudo" }));
    expect(r.error).toBe("bloqueado");
    expect(create).not.toHaveBeenCalled();
  });

  it("calls requireMember WITHOUT allowSuspended", async () => {
    await createWithdrawalRequestAction({}, fd({}));
    expect(requireMember).toHaveBeenCalledWith();
  });

  it("creates for the actor's member, ignoring any memberId in the form", async () => {
    const r = await createWithdrawalRequestAction({}, fd({ memberId: "999", message: "renuncio" }));
    expect(r.done).toBe(true);
    expect(create).toHaveBeenCalledWith({ memberId: 7, type: "withdrawal", message: "renuncio" });
  });

  it("surfaces the service's error verbatim", async () => {
    create.mockResolvedValueOnce({ ok: false, error: "Ya tenés una solicitud pendiente de este tipo." });
    const r = await createWithdrawalRequestAction({}, fd({}));
    expect(r.error).toBe("Ya tenés una solicitud pendiente de este tipo.");
    expect(r.done).toBeUndefined();
  });

  it("rejects a reason longer than 500 characters without touching the service", async () => {
    const r = await createWithdrawalRequestAction({}, fd({ message: "x".repeat(501) }));
    expect(r.error).toContain("500");
    expect(create).not.toHaveBeenCalled();
  });

  // Ley 25.326: el asiento lleva ids y flags, nunca el texto que escribió el
  // socio. Un cambio que agregara el motivo al detail para "depurar mejor"
  // tiene que romper este test.
  it("audits with ids and flags only, never the socio's message text", async () => {
    const { audit } = await import("@/lib/audit");
    const r = await createWithdrawalRequestAction({}, fd({ message: "me mudo a otra ciudad" }));
    expect(r.done).toBe(true);
    expect(vi.mocked(audit)).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "member_request_create",
        entityId: 7,
        detail: expect.objectContaining({ type: "withdrawal", requestId: 55 }),
      }),
    );
    const [call] = vi.mocked(audit).mock.calls;
    expect(JSON.stringify(call[0])).not.toContain("me mudo a otra ciudad");
  });
});

describe("createCategoryRequestAction", () => {
  it("rejects a blocked actor without touching the service", async () => {
    requireMember.mockResolvedValue({ ok: false, reason: "suspended", error: "bloqueado" });
    const r = await createCategoryRequestAction({}, fd({ requestedCategory: "active" }));
    expect(r.error).toBe("bloqueado");
    expect(create).not.toHaveBeenCalled();
  });

  it("calls requireMember WITHOUT allowSuspended", async () => {
    await createCategoryRequestAction({}, fd({ requestedCategory: "active" }));
    expect(requireMember).toHaveBeenCalledWith();
  });

  it("creates for the actor's member, ignoring any memberId in the form", async () => {
    const r = await createCategoryRequestAction({}, fd({ memberId: "999", requestedCategory: "adherent" }));
    expect(r.done).toBe(true);
    expect(create).toHaveBeenCalledWith({
      memberId: 7,
      type: "category_change",
      requestedCategory: "adherent",
      message: undefined,
    });
  });

  it("rejects a category outside REQUESTABLE_CATEGORIES without touching the service", async () => {
    // El mensaje EXACTO en castellano, no un truthy: si el schema se
    // desconectara, el vecino vería el texto en inglés de zod y un
    // `toBeTruthy()` seguiría en verde.
    const r = await createCategoryRequestAction({}, fd({ requestedCategory: "cadet" }));
    expect(r.error).toBe("Elegí la categoría nueva.");
    expect(create).not.toHaveBeenCalled();
  });

  it("collaborator passes the schema: whether the switch allows it is the service's call", async () => {
    // The schema validates SHAPE against ALL_REQUESTABLE_CATEGORIES; the
    // colaborador_habilitado switch is read by the service (spec 2026-09-02),
    // so the action must forward the category and surface the service's text.
    create.mockResolvedValueOnce({ ok: false, error: "Por ahora no se puede pedir el pase a socio colaborador." });
    const r = await createCategoryRequestAction({}, fd({ requestedCategory: "collaborator" }));
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ requestedCategory: "collaborator" }));
    expect(r.error).toBe("Por ahora no se puede pedir el pase a socio colaborador.");
  });

  it("surfaces the service's error verbatim", async () => {
    create.mockResolvedValueOnce({ ok: false, error: "Hay elecciones en curso." });
    const r = await createCategoryRequestAction({}, fd({ requestedCategory: "active" }));
    expect(r.error).toBe("Hay elecciones en curso.");
  });

  it("audits with ids and flags only, never the socio's message text", async () => {
    const { audit } = await import("@/lib/audit");
    const r = await createCategoryRequestAction(
      {},
      fd({ requestedCategory: "adherent", message: "porque cambié de laburo" }),
    );
    expect(r.done).toBe(true);
    expect(vi.mocked(audit)).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "member_request_create",
        entityId: 7,
        detail: expect.objectContaining({ type: "category_change", requestId: 55 }),
      }),
    );
    const [call] = vi.mocked(audit).mock.calls;
    expect(JSON.stringify(call[0])).not.toContain("porque cambié de laburo");
  });
});

describe("cancelRequestAction", () => {
  it("rejects a blocked actor without touching the service", async () => {
    requireMember.mockResolvedValue({ ok: false, reason: "suspended", error: "bloqueado" });
    const r = await cancelRequestAction({}, fd({ requestId: "55" }));
    expect(r.error).toBe("bloqueado");
    expect(cancel).not.toHaveBeenCalled();
  });

  it("calls requireMember WITHOUT allowSuspended", async () => {
    await cancelRequestAction({}, fd({ requestId: "55" }));
    expect(requireMember).toHaveBeenCalledWith();
  });

  it("passes the form's requestId with the actor's memberId", async () => {
    const r = await cancelRequestAction({}, fd({ requestId: "55", memberId: "999" }));
    expect(r.done).toBe(true);
    expect(cancel).toHaveBeenCalledWith({ memberId: 7, requestId: 55 });
  });

  it("surfaces the service's error verbatim", async () => {
    cancel.mockResolvedValueOnce({ ok: false, error: "La solicitud ya fue resuelta o no existe." });
    const r = await cancelRequestAction({}, fd({ requestId: "55" }));
    expect(r.error).toBe("La solicitud ya fue resuelta o no existe.");
  });

  it("audits with ids and flags only", async () => {
    const { audit } = await import("@/lib/audit");
    const r = await cancelRequestAction({}, fd({ requestId: "55" }));
    expect(r.done).toBe(true);
    expect(vi.mocked(audit)).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "member_request_cancel",
        entityId: 7,
        detail: expect.objectContaining({ requestId: 55 }),
      }),
    );
  });
});
