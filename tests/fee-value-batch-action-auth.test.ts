import { beforeEach, describe, expect, it, vi } from "vitest";

// La guarda del lote REG-34. Es la action más peligrosa del módulo: le cambia a
// cada vecino con débito automático cuánto le va a salir la cuota de la tarjeta
// todos los meses. Lo que se prueba acá es que un admin común no la dispara,
// que el pedido basura no llega a Mercado Pago, y que el asiento que queda NO
// lleva datos personales (Ley 25.326).
const runMock = vi.hoisted(() => vi.fn(async () => ({ updated: 2, applied: ["pre-1", "pre-2"], failed: [] as Array<{ preapprovalId: string; memberId: number; code: string }>, remaining: 0 })));
vi.mock("@/lib/mp/fee-value-batch", () => ({ feeValueBatch: { run: runMock } }));

const prismaMock = vi.hoisted(() => ({
  member: { findMany: vi.fn(async () => [{ id: 7, fullName: "Pérez, Juan" }]) },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const requireSuperadminMock = vi.hoisted(() => vi.fn(async () => ({ ok: true, actorId: 3 }) as unknown));
vi.mock("@/lib/auth/require-admin", () => ({
  requireSuperadmin: requireSuperadminMock,
  SUPERADMIN_BLOCKED_MESSAGE: "Solo el superadmin puede cambiar la configuración.",
}));

// Tipado por la firma (no por un parámetro sin usar) para poder afirmar sobre
// el `detail` del asiento.
const auditMock = vi.hoisted(() => vi.fn<(entry: { detail?: unknown }) => Promise<void>>(async () => {}));
vi.mock("@/lib/audit", () => ({ audit: auditMock }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { applyFeeValueBatchAction } from "@/app/admin/tesoreria/valores/actions";

const BLOCKED = "Solo el superadmin puede cambiar la configuración.";

beforeEach(() => {
  vi.clearAllMocks();
  requireSuperadminMock.mockResolvedValue({ ok: true, actorId: 3 });
  runMock.mockResolvedValue({ updated: 2, applied: ["pre-1", "pre-2"], failed: [], remaining: 0 });
});

describe("applyFeeValueBatchAction", () => {
  it("el admin común no llega a Mercado Pago ni deja asiento", async () => {
    requireSuperadminMock.mockResolvedValue({ ok: false, reason: "not_admin", error: BLOCKED });
    expect(await applyFeeValueBatchAction({})).toEqual({ error: BLOCKED });
    expect(runMock).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("un `only` con basura se rechaza antes de tocar Mercado Pago", async () => {
    // El id del preapproval viaja tal cual a la URL de la API de MP.
    const r = await applyFeeValueBatchAction({ only: ["../../algo", "pre-1"] });
    expect(r).toEqual({ error: "Pedido inválido." });
    expect(runMock).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("un `only` que no es lista se rechaza", async () => {
    expect(await applyFeeValueBatchAction({ only: "pre-1" })).toEqual({ error: "Pedido inválido." });
    expect(runMock).not.toHaveBeenCalled();
  });

  it("el superadmin corre la tanda y el asiento lleva el desglose", async () => {
    const r = await applyFeeValueBatchAction({ only: ["pre-1", "pre-2"] });
    expect(runMock).toHaveBeenCalledWith({ only: ["pre-1", "pre-2"] });
    expect(r).toEqual({ updated: 2, applied: ["pre-1", "pre-2"], failed: [], remaining: 0 });
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 3,
        action: "fee_value_applied",
        entity: "mp_subscription",
        detail: { updated: 2, failed: [], remaining: 0 },
      }),
    );
    // Sin fallos no hay a quién nombrar: la consulta al padrón ni se hace.
    expect(prismaMock.member.findMany).not.toHaveBeenCalled();
  });

  it("sin argumento corre la cola entera", async () => {
    await applyFeeValueBatchAction(undefined);
    expect(runMock).toHaveBeenCalledWith({ only: undefined });
  });

  it("el nombre del socio que falló va a la PANTALLA y nunca al asiento", async () => {
    runMock.mockResolvedValue({ updated: 1, applied: ["pre-8"], failed: [{ preapprovalId: "pre-9", memberId: 7, code: "HTTP 403 · 4040" }], remaining: 4 });
    const r = await applyFeeValueBatchAction({});
    expect(r).toEqual({
      updated: 1,
      applied: ["pre-8"],
      remaining: 4,
      failed: [{ preapprovalId: "pre-9", memberId: 7, fullName: "Pérez, Juan", code: "HTTP 403 · 4040" }],
    });
    const detail = auditMock.mock.calls[0][0].detail;
    expect(detail).toEqual({
      updated: 1,
      failed: [{ preapprovalId: "pre-9", memberId: 7, code: "HTTP 403 · 4040" }],
      remaining: 4,
    });
    expect(JSON.stringify(detail)).not.toContain("Pérez");
  });

  it("el nombre sale de la base, no del cliente", async () => {
    runMock.mockResolvedValue({ updated: 0, applied: [], failed: [{ preapprovalId: "pre-9", memberId: 7, code: "HTTP 400" }], remaining: 0 });
    // El cliente manda un nombre inventado: la action lo ignora.
    const r = await applyFeeValueBatchAction({ only: ["pre-9"], fullName: "Otro, Socio" });
    expect(r).toMatchObject({ failed: [expect.objectContaining({ fullName: "Pérez, Juan" })] });
  });

  it("una tanda que no tocó nada no deja asiento", async () => {
    // Un `only` que ya dejó de ser divergente, o una corrida sin valor vigente.
    // El asiento se exporta: registrar corridas que no hicieron nada lo ensucia.
    runMock.mockResolvedValue({ updated: 0, applied: [], failed: [], remaining: 0 });
    const r = await applyFeeValueBatchAction({ only: ["pre-1"] });
    expect(r).toEqual({ updated: 0, applied: [], failed: [], remaining: 0 });
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("un socio borrado entre medio no deja la fila sin etiqueta", async () => {
    prismaMock.member.findMany.mockResolvedValueOnce([]);
    runMock.mockResolvedValue({ updated: 0, applied: [], failed: [{ preapprovalId: "pre-9", memberId: 7, code: "HTTP 400" }], remaining: 0 });
    const r = await applyFeeValueBatchAction({});
    expect(r).toMatchObject({ failed: [expect.objectContaining({ fullName: "Socio 7" })] });
  });
});
