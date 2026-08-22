import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminActor } from "@/lib/auth/require-admin";

// Las dos acciones del recibo escriben (una anula plata cobrada, la otra manda
// un PDF con datos del socio): las dos tienen que cortar ANTES de tocar el
// servicio y de auditar. Y las dos tienen que auditar cuando SÍ hacen algo: el
// servicio no audita a propósito (no ve los encabezados del request).
const mocks = vi.hoisted(() => ({
  voidReceipt: vi.fn(),
  sendEmail: vi.fn(),
  audit: vi.fn(async () => {}),
  // Tipado explícito: sin él TS infiere la forma del rechazo y el
  // `mockResolvedValueOnce` del caso autorizado no compila.
  admin: vi.fn(async (): Promise<AdminActor> => (
    { ok: false, reason: "not_admin", error: "Necesitás permisos de administrador." }
  )),
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/treasury/service", () => ({
  treasuryService: { voidReceipt: mocks.voidReceipt },
  TreasuryError: class extends Error {},
}));
vi.mock("@/lib/treasury/receipt-email", () => ({ sendReceiptEmail: mocks.sendEmail }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: mocks.admin }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { redirect } from "next/navigation";
import { TreasuryError } from "@/lib/treasury/service";
import { emailReceiptAction, voidReceiptAction } from "@/app/admin/tesoreria/recibos/[id]/actions";

describe("receipt actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sin admin ninguna de las dos escribe", async () => {
    const form = new FormData();
    form.append("receiptId", "7");
    form.append("reason", "error");
    expect((await voidReceiptAction({}, form)).error).toBe("Necesitás permisos de administrador.");
    expect((await emailReceiptAction({}, form)).error).toBe("Necesitás permisos de administrador.");
    expect(mocks.voidReceipt).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("anular exige motivo", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    const form = new FormData();
    form.append("receiptId", "7");
    expect((await voidReceiptAction({}, form)).error).toBe("Indicá el motivo de la anulación.");
    expect(mocks.voidReceipt).not.toHaveBeenCalled();
  });

  it("un motivo de solo espacios se rechaza igual que uno vacío", async () => {
    // Hoy pasa por el trim de `parseForm` (src/lib/forms.ts): "   " recorta a
    // "" y ahí entra el `.min(1)` del schema. No es una regla propia de esta
    // acción, así que un cambio en `parseForm` la rompería en silencio si nada
    // la ejercita.
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    const form = new FormData();
    form.append("receiptId", "7");
    form.append("reason", "   ");
    expect((await voidReceiptAction({}, form)).error).toBe("Indicá el motivo de la anulación.");
    expect(mocks.voidReceipt).not.toHaveBeenCalled();
  });

  it("el motivo le llega recortado al servicio", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.voidReceipt.mockResolvedValueOnce({ paymentId: 3, number: "2026-00007", periodsReverted: 2 });
    const form = new FormData();
    form.append("receiptId", "7");
    form.append("reason", "  Cargado por error  ");
    await voidReceiptAction({}, form);
    // El motivo asentado (y el que ve `treasuryService.voidReceipt`) es el
    // recortado, no el que tipeó el operador con espacios de sobra.
    expect(mocks.voidReceipt).toHaveBeenCalledWith({ receiptId: 7, actorId: 9, reason: "Cargado por error" });
  });

  it("anular audita y redirige", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.voidReceipt.mockResolvedValueOnce({ paymentId: 3, number: "2026-00007", periodsReverted: 2 });
    const form = new FormData();
    form.append("receiptId", "7");
    form.append("reason", "Cargado por error");
    await voidReceiptAction({}, form);
    expect(mocks.voidReceipt).toHaveBeenCalledWith({ receiptId: 7, actorId: 9, reason: "Cargado por error" });
    // `userId` e `ip` explícitos: un objectContaining que no los mira deja pasar
    // un asiento atribuido al actor equivocado, o a nadie.
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      userId: 9, ip: "unknown",
      action: "receipt_void", entity: "receipt", entityId: 7,
      detail: { number: "2026-00007", paymentId: 3, periodsReverted: 2 },
    }));
    expect(redirect).toHaveBeenCalledWith("/admin/tesoreria/recibos/7?anulado=1");
  });

  it("la regla de negocio del servicio se muestra tal cual y no se audita ni se redirige", async () => {
    // "El recibo ya está anulado" ya viene redactado en es-AR: no hay que
    // taparlo con el mensaje genérico, y no pasó nada que asentar.
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.voidReceipt.mockRejectedValueOnce(new TreasuryError("El recibo ya está anulado."));
    const form = new FormData();
    form.append("receiptId", "7");
    form.append("reason", "Cargado por error");
    expect((await voidReceiptAction({}, form)).error).toBe("El recibo ya está anulado.");
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("un error inesperado del servicio no se le muestra crudo al operador", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.voidReceipt.mockRejectedValueOnce(new Error("ETIMEDOUT"));
    const form = new FormData();
    form.append("receiptId", "7");
    form.append("reason", "Cargado por error");
    expect((await voidReceiptAction({}, form)).error).toBe("No se pudo anular el recibo. Reintentá en un momento.");
    expect(redirect).not.toHaveBeenCalled();
  });

  it("reenviar devuelve el resultado en el estado y audita", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.sendEmail.mockResolvedValueOnce({ sent: false, reason: "no_email" });
    const form = new FormData();
    form.append("receiptId", "7");
    const r = await emailReceiptAction({}, form);
    expect(r).toEqual({ error: "El socio no tiene un email válido en su ficha." });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      userId: 9, action: "receipt_email", entity: "receipt", entityId: 7, detail: { result: "no_email" },
    }));
  });

  it("un recibo anulado tiene su propio mensaje (no el genérico de error)", async () => {
    // `ReceiptEmailResult` distingue "voided" de "error" a propósito: sin una
    // entrada propia, el operador leería "revisá la configuración de correo"
    // por algo que no tiene nada que ver con el correo — o, peor, un estado
    // con `error: undefined` que no muestra nada.
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.sendEmail.mockResolvedValueOnce({ sent: false, reason: "voided" });
    const form = new FormData();
    form.append("receiptId", "7");
    const r = await emailReceiptAction({}, form);
    expect(r.error).toBe("El recibo está anulado: no se puede enviar por email.");
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ detail: { result: "voided" } }));
  });

  it("el envío exitoso deja el estado en sent y lo asienta", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.sendEmail.mockResolvedValueOnce({ sent: true });
    const form = new FormData();
    form.append("receiptId", "7");
    expect(await emailReceiptAction({}, form)).toEqual({ sent: true });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ detail: { result: "sent" } }));
  });

  it("si sendReceiptEmail explota, la pantalla lo cuenta como error y el asiento queda", async () => {
    // Está documentado como best-effort, pero su primer statement (el
    // findUnique del recibo) vive AFUERA de su try interno: un timeout del pool
    // se escapa igual y tiraría la server action entera.
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.sendEmail.mockRejectedValueOnce(Object.assign(new Error("pool timeout"), { code: "ETIMEDOUT" }));
    const form = new FormData();
    form.append("receiptId", "7");
    const r = await emailReceiptAction({}, form);
    expect(r.error).toBe("No se pudo enviar el email. Revisá la configuración de correo y reintentá.");
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ detail: { result: "error" } }));
  });

  it("un id de recibo que no es número se rechaza en castellano", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    const form = new FormData();
    form.append("receiptId", "no");
    expect((await emailReceiptAction({}, form)).error).toBe("No pudimos identificar el recibo.");
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });
});
