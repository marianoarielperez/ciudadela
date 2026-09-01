// El notificador de Reportes (spec §9): best-effort después del commit, salta
// sin dirección, manda con `sendToReport` (la fila cuelga del reporte) y a la
// Comisión una fila por destinatario. Loguea el CÓDIGO, nunca la dirección.
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import type { mailer } from "@/lib/email";
import { makeReportNotifier } from "@/lib/reports/notify";

type SendInput = Parameters<typeof mailer.sendToReport>[0];

const report = {
  id: 14, kind: "claim", anonymous: false, category: "water", subtype: "leak",
  reporterName: "Ana López", reporterDni: "30123456", reporterPhone: "2974", reporterEmail: "ana@example.com" as string | null,
  streetName: "Cerro Catedral", addressDetail: "al 280", description: "Pierde agua.",
  filedAgency: "scpl", filedAgencyOther: null, filedAt: new Date("2026-09-12T15:00:00Z"), filedReference: null,
};

function build(over: Partial<typeof report> = {}) {
  const send = vi.fn<(input: SendInput) => Promise<{ messageId: string }>>(async () => ({ messageId: "m" }));
  const db = { report: { findUnique: vi.fn(async () => ({ ...report, ...over })) } };
  const notifier = makeReportNotifier({
    db: db as never, mailer: { sendToReport: send } as never,
    baseUrl: () => "https://vecinalciudadela.ar", contactEmail: async () => "info@vecinal.ar",
  });
  return { notifier, send, db };
}

beforeEach(() => vi.clearAllMocks());

describe("sendReceived / sendFiled", () => {
  it("mandan al email del reporte con el tipo y el reportId", async () => {
    const { notifier, send } = build();
    await notifier.sendReceived(14);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ reportId: 14, to: "ana@example.com", type: "report_received" }));
    await notifier.sendFiled(14);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ reportId: 14, type: "report_filed" }));
  });
  it("sin email no mandan nada y no fallan", async () => {
    const { notifier, send } = build({ reporterEmail: null });
    await notifier.sendReceived(14);
    expect(send).not.toHaveBeenCalled();
  });
  it("un SMTP caído no tira: se loguea el código", async () => {
    const { notifier, send } = build();
    send.mockRejectedValueOnce(Object.assign(new Error("smtp ana@example.com"), { code: "EAUTH" }));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(notifier.sendReceived(14)).resolves.toBeUndefined();
    expect(log.mock.calls.flat().join(" ")).not.toContain("ana@example.com");
    log.mockRestore();
  });
});

describe("sendBoardAlert", () => {
  it("una fila por destinatario, con el enlace al panel", async () => {
    const { notifier, send } = build();
    const r = await notifier.sendBoardAlert(14, ["a@b.com", "c@d.com"]);
    expect(r).toEqual({ sent: 2, failed: 0 });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][0]).toMatchObject({ reportId: 14, to: "a@b.com", type: "report_board_alert" });
    expect(JSON.stringify(send.mock.calls[0][0])).toContain("/admin/solicitudes/reportes/14");
  });
  it("un destinatario que falla no frena al otro", async () => {
    const { notifier, send } = build();
    send.mockRejectedValueOnce(Object.assign(new Error("x"), { code: "ECONN" }));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await notifier.sendBoardAlert(14, ["a@b.com", "c@d.com"])).toEqual({ sent: 1, failed: 1 });
    log.mockRestore();
  });
  // Corre DESPUÉS del commit: si la base se cae al releer el reporte, esto no
  // puede tirarle la excepción al caller y deshacerle el alta al vecino.
  it("una base caída al releer el reporte no tira: devuelve ceros", async () => {
    const { notifier, send, db } = build();
    db.report.findUnique.mockRejectedValueOnce(Object.assign(new Error("db ana@example.com"), { code: "P1001" }));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(notifier.sendBoardAlert(14, ["a@b.com", "c@d.com"])).resolves.toEqual({ sent: 0, failed: 0 });
    expect(send).not.toHaveBeenCalled();
    expect(log.mock.calls.flat().join(" ")).not.toContain("ana@example.com");
    expect(log.mock.calls.flat().join(" ")).not.toContain("a@b.com");
    log.mockRestore();
  });
});
