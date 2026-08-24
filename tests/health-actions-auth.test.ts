import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminActor } from "@/lib/auth/require-admin";
import { describeResendResult } from "@/lib/admin/receipt-resend";

// Las dos acciones de /admin/salud mandan un PDF con datos del socio a una
// casilla: las dos son superadmin (la pantalla entera lo es) y las dos se
// autorizan SOLAS —Next despacha una action por el id del encabezado
// `Next-Action`, no por su URL, así que el rol del layout no las cubre—.
//
// Y las dos tienen una segunda obligación que no es de seguridad sino de
// honestidad: decir qué pasó. El bloqueo por `EMAIL_ALLOWLIST` es el caso que la
// obliga —en producción la variable está puesta— y un botón que se queda mudo
// deja al operador creyendo que el recibo salió.
const mocks = vi.hoisted(() => ({
  requireSuperadmin: vi.fn(async (): Promise<AdminActor> => ({ ok: true, actorId: 1 })),
  findUnique: vi.fn(),
  deleteMany: vi.fn(async () => ({ count: 1 })),
  receiptFindFirst: vi.fn(),
  receiptFindUnique: vi.fn(),
  sendReceiptEmail: vi.fn(),
  audit: vi.fn(async () => {}),
  revalidatePath: vi.fn(),
}));
vi.mock("@/lib/auth/require-admin", () => ({ requireSuperadmin: mocks.requireSuperadmin }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    notification: { findUnique: mocks.findUnique, deleteMany: mocks.deleteMany },
    receipt: { findFirst: mocks.receiptFindFirst, findUnique: mocks.receiptFindUnique },
  },
}));
vi.mock("@/lib/treasury/receipt-email", () => ({ sendReceiptEmail: mocks.sendReceiptEmail }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { resendNotificationAction, resendReceiptAction } from "@/app/admin/salud/actions";

const form = (entries: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
};
const notice = (id: string) => form({ notificationId: id });
const receipt = (id: string) => form({ receiptId: id });

const BLOCKED: AdminActor = { ok: false, reason: "not_admin", error: "No tenés permiso." };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireSuperadmin.mockResolvedValue({ ok: true, actorId: 1 });
  mocks.findUnique.mockResolvedValue({
    id: BigInt(3), status: "failed", type: "receipt", payloadSummary: "recibo 2026-00042",
  });
  mocks.receiptFindFirst.mockResolvedValue({ id: 42 });
  mocks.receiptFindUnique.mockResolvedValue({ number: "2026-00042" });
  mocks.sendReceiptEmail.mockResolvedValue({ sent: true });
});

describe("resendNotificationAction (panel 5)", () => {
  it("un admin común no puede: la pantalla es superadmin y la action se autoriza sola", async () => {
    mocks.requireSuperadmin.mockResolvedValue(BLOCKED);
    expect((await resendNotificationAction({}, notice("3"))).error).toBe("No tenés permiso.");
    expect(mocks.sendReceiptEmail).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("reenvía el recibo y saca la fila fallida de la lista", async () => {
    const r = await resendNotificationAction({}, notice("3"));
    expect(mocks.sendReceiptEmail).toHaveBeenCalledWith(42);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/salud");
    expect(r.ok).toContain("2026-00042");
    expect(r.error).toBeUndefined();
  });

  it("saca TODAS las fallidas de ese recibo, no sólo la fila del botón", async () => {
    // Dos intentos con el SMTP caído dejan DOS filas fallidas del mismo recibo.
    // Borrando sólo la propia, la gemela seguía listada y su botón «Reenviar» le
    // mandaba el recibo al socio de nuevo: correo duplicado.
    await resendNotificationAction({}, notice("3"));
    // El filtro va por NÚMERO y no lleva `id`: si lo llevara —la comparación es
    // exacta— la gemela sobreviviría.
    expect(mocks.deleteMany).toHaveBeenCalledWith({
      where: { type: "receipt", status: "failed", payloadSummary: "recibo 2026-00042" },
    });
  });

  it("si el reenvío tampoco sale, la fila NO se borra y el motivo se muestra", async () => {
    mocks.sendReceiptEmail.mockResolvedValue({ sent: false, reason: "error", code: "EAUTH" });
    const r = await resendNotificationAction({}, notice("3"));
    expect(mocks.deleteMany).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(r.error).toContain("EAUTH");
    // Auditar el intento fallido es la mitad del punto: el asiento es lo único
    // que después responde "¿cuántas veces se probó?".
    expect(mocks.audit).toHaveBeenCalledTimes(1);
  });

  it("un bloqueo de la allowlist se dice con todas las letras", async () => {
    // El caso que hace falsa la promesa del botón en producción: se vuelve a
    // bloquear y no sale nada. Sin este texto el operador no tiene cómo saberlo.
    mocks.sendReceiptEmail.mockResolvedValue({ sent: false, reason: "error", code: "EMAIL_ALLOWLIST" });
    const r = await resendNotificationAction({}, notice("3"));
    expect(r.error).toContain("EMAIL_ALLOWLIST");
    expect(r.error).toContain("no salió");
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });

  it("un aviso sin camino de reenvío lo dice, no lo intenta", async () => {
    mocks.findUnique.mockResolvedValue({
      id: BigInt(3), status: "failed", type: "fee_reminder",
      payloadSummary: "recordatorio de vencimiento 2026-09",
    });
    expect((await resendNotificationAction({}, notice("3"))).error).toContain("no se puede reenviar");
    expect(mocks.sendReceiptEmail).not.toHaveBeenCalled();
  });

  it("una fila que ya no está fallida no se reenvía", async () => {
    mocks.findUnique.mockResolvedValue({
      id: BigInt(3), status: "sent", type: "receipt", payloadSummary: "recibo 2026-00042",
    });
    expect((await resendNotificationAction({}, notice("3"))).error).toBeTruthy();
    expect(mocks.sendReceiptEmail).not.toHaveBeenCalled();
  });

  it("un id que no es un entero se rechaza antes de tocar la base", async () => {
    // `Notification.id` es BigInt: no entra en un Number y por eso viaja como
    // cadena. Un `BigInt("x")` sin validar tiraría dentro de la action.
    expect((await resendNotificationAction({}, notice("no-soy-un-id"))).error).toBe("Aviso inválido.");
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it("un aviso que ya no existe no rompe la pantalla", async () => {
    mocks.findUnique.mockResolvedValue(null);
    expect((await resendNotificationAction({}, notice("3"))).error).toBe("El aviso no existe.");
  });

  it("un recibo borrado detrás del aviso se reporta con su número", async () => {
    mocks.receiptFindFirst.mockResolvedValue(null);
    expect((await resendNotificationAction({}, notice("3"))).error).toContain("2026-00042");
    expect(mocks.sendReceiptEmail).not.toHaveBeenCalled();
  });

  it("una excepción del envío no rompe la action", async () => {
    // El `findUnique` del recibo vive AFUERA del try de `sendReceiptEmail`: un
    // timeout del pool se escapa y sin este catch la pantalla entera reventaría.
    mocks.sendReceiptEmail.mockRejectedValue(Object.assign(new Error("boom"), { code: "ETIMEDOUT" }));
    const r = await resendNotificationAction({}, notice("3"));
    expect(r.error).toContain("ETIMEDOUT");
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });
});

describe("resendReceiptAction (panel 6)", () => {
  it("un admin común tampoco puede", async () => {
    mocks.requireSuperadmin.mockResolvedValue(BLOCKED);
    expect((await resendReceiptAction({}, receipt("42"))).error).toBe("No tenés permiso.");
    expect(mocks.sendReceiptEmail).not.toHaveBeenCalled();
  });

  it("manda el recibo por id, sin pasar por el payloadSummary", async () => {
    const r = await resendReceiptAction({}, receipt("42"));
    expect(mocks.sendReceiptEmail).toHaveBeenCalledWith(42);
    expect(r.ok).toContain("2026-00042");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/salud");
  });

  it("al salir bien también limpia la fila fallida gemela del panel 5", async () => {
    // Si no, el mismo recibo se iría del panel 6 (queda sellado) y seguiría en
    // rojo en el 5 para siempre.
    await resendReceiptAction({}, receipt("42"));
    expect(mocks.deleteMany).toHaveBeenCalledWith({
      where: { type: "receipt", status: "failed", payloadSummary: "recibo 2026-00042" },
    });
  });

  it("un recibo sin casilla lo dice y no limpia nada", async () => {
    mocks.sendReceiptEmail.mockResolvedValue({ sent: false, reason: "no_email" });
    const r = await resendReceiptAction({}, receipt("42"));
    expect(r.error).toContain("casilla");
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });

  it("un recibo que no existe no llega al mailer", async () => {
    mocks.receiptFindUnique.mockResolvedValue(null);
    expect((await resendReceiptAction({}, receipt("42"))).error).toBe("El recibo no existe.");
    expect(mocks.sendReceiptEmail).not.toHaveBeenCalled();
  });

  it("un id inválido se rechaza con un mensaje en castellano", async () => {
    expect((await resendReceiptAction({}, receipt("0"))).error).toBe("No pudimos identificar el recibo.");
    expect(mocks.receiptFindUnique).not.toHaveBeenCalled();
  });
});

describe("describeResendResult", () => {
  // La tabla de mensajes es lo único que separa un botón honesto de uno que
  // miente, así que se prueba entera y aparte de la action.
  it("nombra el recibo en todos los desenlaces", () => {
    const n = "2026-00042";
    for (const result of [
      { sent: true } as const,
      { sent: false, reason: "no_email" } as const,
      { sent: false, reason: "voided" } as const,
      { sent: false, reason: "error", code: "EMAIL_ALLOWLIST" } as const,
      { sent: false, reason: "error", code: "EAUTH" } as const,
      { sent: false, reason: "error" } as const,
    ]) {
      const out = describeResendResult(result, n);
      expect(`${out.ok ?? ""}${out.error ?? ""}`).toContain(n);
    }
  });

  it("el anulado no manda a revisar la configuración de correo", () => {
    // Es una negativa de negocio, no un problema de transporte: mandar al
    // operador a mirar el SMTP por un recibo anulado le hace perder la tarde.
    const out = describeResendResult({ sent: false, reason: "voided" }, "2026-00042");
    expect(out.error).toContain("anulado");
    expect(out.error).not.toContain("código");
  });

  it("un código desconocido se muestra igual, sin inventarle una causa", () => {
    const out = describeResendResult({ sent: false, reason: "error", code: "ECONNRESET" }, "2026-1");
    expect(out.error).toContain("ECONNRESET");
  });

  it("sin código dice 'desconocido' en vez de 'undefined'", () => {
    const out = describeResendResult({ sent: false, reason: "error" }, "2026-1");
    expect(out.error).toContain("desconocido");
    expect(out.error).not.toContain("undefined");
  });
});
