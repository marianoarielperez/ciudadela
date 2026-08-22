import { describe, expect, it, vi } from "vitest";

// Los tres singletons del módulo evalúan `@/lib/prisma` al importarse: mockear
// SIEMPRE antes de importar nada del módulo bajo prueba.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/email", () => ({ mailer: {} }));
vi.mock("@/lib/treasury/service", () => ({ treasuryService: {} }));

import { makeReceiptEmailer } from "@/lib/treasury/receipt-email";

// Lo que el módulo le pasa al mailer. Tiparlo en el mock evita castear el
// argumento capturado en cada aserción.
type SendCall = {
  to: string;
  type: string;
  message: { text: string; attachments: Array<{ filename: string; content: Buffer; contentType: string }> };
};

// El pago NO trae `fees`: el concepto tiene que salir de la fila del recibo, que
// lo congela al emitir. Si la implementación lo recalculara desde `payment.fees`
// —como al anular, donde las cuotas se despegan— acá reventaría.
function setup(member: { email: string | null; emailStatus: string } | null) {
  const receipt = {
    id: 7, number: "2026-00007", pdfPath: "2026/2026-00007.pdf" as string | null, emailedAt: null, voidedAt: null as Date | null,
    concept: "Cuota social · septiembre 2026",
    payment: {
      id: 3, type: "cash", amount: "6000.00", memberId: 1,
      member: member ? { id: 1, fullName: "Ana", ...member } : null,
    },
  };
  // La fake honra el id que le piden: si no coincide, se comporta como Prisma
  // ante un id inexistente (null), en vez de devolver siempre la misma fila.
  const db = {
    receipt: {
      findUnique: vi.fn(async ({ where }: { where: { id: number } }) => (where.id === receipt.id ? receipt : null)),
      update: vi.fn(async () => ({})),
    },
  };
  const mailer = {
    sendToMember: vi.fn<(call: SendCall) => Promise<{ messageId: string }>>(async () => ({ messageId: "m1" })),
  };
  const readPdf = vi.fn(async () => Buffer.from("%PDF-1.4"));
  const regenerate = vi.fn(async () => new Uint8Array([9, 9, 9]));
  return {
    receipt, db, mailer, readPdf, regenerate,
    emailer: makeReceiptEmailer({ db: db as never, mailer: mailer as never, readPdf, regenerate }),
  };
}

describe("sendReceiptEmail", () => {
  it("envía con el PDF adjunto y sella emailedAt", async () => {
    const s = setup({ email: "ana@x.com", emailStatus: "declared" });
    expect(await s.emailer.sendReceiptEmail(7)).toEqual({ sent: true });
    const call = s.mailer.sendToMember.mock.calls[0][0];
    expect(call.to).toBe("ana@x.com");
    expect(call.type).toBe("receipt");
    expect(call.message.attachments[0].filename).toBe("recibo-2026-00007.pdf");
    expect(call.message.attachments[0].contentType).toBe("application/pdf");
    expect(s.db.receipt.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 7 } }));
    expect(s.db.receipt.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { emailedAt: expect.any(Date) } });
  });

  // El concepto viaja congelado en el recibo, no derivado de las cuotas del pago.
  it("usa el concepto de la fila del recibo", async () => {
    const s = setup({ email: "ana@x.com", emailStatus: "verified" });
    await s.emailer.sendReceiptEmail(7);
    const call = s.mailer.sendToMember.mock.calls[0][0];
    expect(call.message.text).toContain("Cuota social · septiembre 2026");
    expect(call.message.text).toContain("$ 6.000,00");
  });

  it("sin email no envía y lo dice", async () => {
    const s = setup({ email: null, emailStatus: "none" });
    expect(await s.emailer.sendReceiptEmail(7)).toEqual({ sent: false, reason: "no_email" });
    expect(s.mailer.sendToMember).not.toHaveBeenCalled();
  });

  // Una casilla que rebotó no es una casilla: no se le manda el recibo.
  it("con la casilla rebotada tampoco envía", async () => {
    const s = setup({ email: "ana@x.com", emailStatus: "bounced" });
    expect(await s.emailer.sendReceiptEmail(7)).toEqual({ sent: false, reason: "no_email" });
    expect(s.mailer.sendToMember).not.toHaveBeenCalled();
  });

  it("si el PDF no está en disco lo regenera y adjunta esos bytes", async () => {
    const s = setup({ email: "ana@x.com", emailStatus: "verified" });
    s.readPdf.mockRejectedValueOnce(new Error("ENOENT"));
    await s.emailer.sendReceiptEmail(7);
    expect(s.regenerate).toHaveBeenCalledWith(7);
    const call = s.mailer.sendToMember.mock.calls[0][0];
    // No alcanza con que se haya llamado a `regenerate`: el adjunto tiene que
    // SER lo que devolvió, no un buffer viejo o vacío que pasó la aserción anterior.
    expect(call.message.attachments[0].content).toEqual(Buffer.from([9, 9, 9]));
  });

  it("si pdfPath es null arma la ruta canónica a partir del número", async () => {
    const s = setup({ email: "ana@x.com", emailStatus: "verified" });
    s.receipt.pdfPath = null;
    await s.emailer.sendReceiptEmail(7);
    expect(s.readPdf).toHaveBeenCalledWith("2026/2026-00007.pdf");
    expect(s.mailer.sendToMember).toHaveBeenCalled();
  });

  it("si el transporte falla devuelve el código sin tirar", async () => {
    const s = setup({ email: "ana@x.com", emailStatus: "declared" });
    s.mailer.sendToMember.mockRejectedValueOnce(Object.assign(new Error("x"), { code: "EAUTH" }));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await s.emailer.sendReceiptEmail(7)).toEqual({ sent: false, reason: "error", code: "EAUTH" });
    // El log no puede arrastrar la dirección del socio (Ley 25.326, docs/08).
    expect(errorLog.mock.calls.flat().join(" ")).not.toContain("ana@x.com");
    expect(s.db.receipt.update).not.toHaveBeenCalled();
    errorLog.mockRestore();
  });

  // El envío ya salió y la Notification ya quedó escrita (la escribe el mailer
  // ANTES de que este módulo intente sellar `emailedAt`): que el sello falle no
  // puede convertir un recibo ya recibido en `sent: false`, porque eso invita a
  // Task 12 a reenviar un segundo PDF por un problema que es solo cosmético.
  it("si el sello de emailedAt falla después de un envío exitoso, igual informa sent:true", async () => {
    const s = setup({ email: "ana@x.com", emailStatus: "declared" });
    s.db.receipt.update.mockRejectedValueOnce(Object.assign(new Error("deadlock"), { code: "ER_LOCK_DEADLOCK" }));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await s.emailer.sendReceiptEmail(7)).toEqual({ sent: true });
    expect(s.mailer.sendToMember).toHaveBeenCalled();
    // El log no puede arrastrar la dirección del socio (Ley 25.326, docs/08).
    expect(errorLog.mock.calls.flat().join(" ")).not.toContain("ana@x.com");
    errorLog.mockRestore();
  });

  // El PDF de un recibo anulado ya no representa nada cobrado. Es una negativa
  // de negocio, no un error de transporte: viaja en su propio `reason` para que
  // el llamador (Task 12) pueda distinguirla por tipo, sin parsear `code`.
  it("no manda un recibo anulado", async () => {
    const s = setup({ email: "ana@x.com", emailStatus: "declared" });
    s.receipt.voidedAt = new Date();
    expect(await s.emailer.sendReceiptEmail(7)).toEqual({ sent: false, reason: "voided" });
    expect(s.mailer.sendToMember).not.toHaveBeenCalled();
  });

  it("con un id inexistente no tira", async () => {
    const s = setup({ email: "ana@x.com", emailStatus: "declared" });
    expect(await s.emailer.sendReceiptEmail(99)).toEqual({ sent: false, reason: "error", code: "not_found" });
    expect(s.mailer.sendToMember).not.toHaveBeenCalled();
  });
});
