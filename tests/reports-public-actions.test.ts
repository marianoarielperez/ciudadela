// Las actions públicas del wizard de Reportes (spec §5.1, §10): orden de
// guardas (allows → captcha → zod → record), la llave manda (nunca un id del
// formulario), el tamaño se mira antes de leer el archivo, el envío manda el
// acuse y la alerta DESPUÉS de escribir y audita sin datos personales, y ninguna
// revalida rutas.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  startDraft: vi.fn(), findByClaim: vi.fn(), saveReporter: vi.fn(), submit: vi.fn(),
  save: vi.fn(), remove: vi.fn(),
  sendReceived: vi.fn(async () => {}), sendBoardAlert: vi.fn(async () => ({ sent: 1, failed: 0 })),
  verify: vi.fn(async () => true), audit: vi.fn(async () => {}),
  getString: vi.fn(async () => "a@b.com"),
  draftAllows: vi.fn(() => true), draftRecord: vi.fn(),
  submitAllows: vi.fn(() => true), submitRecord: vi.fn(),
  uploadCheck: vi.fn(() => true), tokenCheck: vi.fn(() => true),
}));
vi.mock("@/lib/reports/service", () => ({
  reports: { startDraft: mocks.startDraft, findByClaim: mocks.findByClaim, saveReporter: mocks.saveReporter, submit: mocks.submit },
}));
// Parcial y no un objeto pelado: `actions.ts` también importa `ReportFileError`
// y `userMessageOf` (los textos del catch), y ésos tienen que ser los reales.
vi.mock("@/lib/reports/storage", async (orig) => ({
  ...(await orig<typeof import("@/lib/reports/storage")>()),
  reportFileStore: { save: mocks.save, remove: mocks.remove },
}));
vi.mock("@/lib/reports/notify", () => ({ reportNotifier: { sendReceived: mocks.sendReceived, sendBoardAlert: mocks.sendBoardAlert } }));
vi.mock("@/lib/turnstile", () => ({ verifyTurnstile: mocks.verify }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/config", async (orig) => ({
  ...(await orig<typeof import("@/lib/config")>()),
  configReader: { getString: mocks.getString, getBool: vi.fn(async () => true) },
}));
vi.mock("@/lib/auth/rate-limiter", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth/rate-limiter")>()),
  reportDraftLimiter: { allows: mocks.draftAllows, record: mocks.draftRecord },
  reportSubmitLimiter: { allows: mocks.submitAllows, record: mocks.submitRecord },
  reportUploadLimiter: { check: mocks.uploadCheck },
  publicTokenLimiter: { check: mocks.tokenCheck },
}));
vi.mock("next/headers", () => ({ headers: async () => new Map([["x-real-ip", "9.9.9.9"], ["user-agent", "ua"]]) }));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(() => { throw new Error("una action del wizard NO revalida"); }),
  revalidateTag: vi.fn(() => { throw new Error("una action del wizard NO revalida"); }),
  // `@/lib/config` envuelve un par de lecturas con esto al evaluarse; acá es un
  // paso-a-través. Lo que este mock vigila son las DOS de arriba.
  unstable_cache: <T,>(fn: T) => fn,
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { ReportFileError } from "@/lib/reports/storage";
import {
  removeReportFileAction, saveReporterAction, startReportAction, submitReportAction, uploadReportFileAction,
} from "@/app/(public)/reportes/actions";

const CLAIM = "A".repeat(43);
const fd = (o: Record<string, string | Blob>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const draft = (over: Record<string, unknown> = {}) => ({
  id: 14, status: "draft", kind: "claim", memberId: null, files: [], ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.startDraft.mockResolvedValue({ id: 14, claim: CLAIM });
  mocks.findByClaim.mockResolvedValue(draft());
  mocks.saveReporter.mockResolvedValue({ ok: true });
  mocks.submit.mockResolvedValue({ ok: true, id: 14 });
  mocks.save.mockResolvedValue({ id: 3, width: 10, height: 10 });
  mocks.remove.mockResolvedValue(true);
  mocks.draftAllows.mockReturnValue(true);
  mocks.submitAllows.mockReturnValue(true);
  mocks.verify.mockResolvedValue(true);
});

describe("startReportAction", () => {
  it("allows → captcha → zod → record → base, y devuelve la llave", async () => {
    const r = await startReportAction({}, fd({ kind: "reclamo", anonymous: "si", "cf-turnstile-response": "t" }));
    expect(r).toEqual({ started: { claim: CLAIM } });
    expect(mocks.startDraft).toHaveBeenCalledWith({ kind: "claim", anonymous: true, memberId: null, reporter: null, ip: "9.9.9.9", userAgent: "ua" });
    expect(mocks.draftRecord).toHaveBeenCalledWith("9.9.9.9");
  });
  it("sin cupo no llama al captcha; con captcha inválido no cobra el intento", async () => {
    mocks.draftAllows.mockReturnValue(false);
    expect((await startReportAction({}, fd({ kind: "reclamo", anonymous: "no" }))).error).toContain("Demasiados");
    expect(mocks.verify).not.toHaveBeenCalled();
    mocks.draftAllows.mockReturnValue(true);
    mocks.verify.mockResolvedValue(false);
    expect((await startReportAction({}, fd({ kind: "reclamo", anonymous: "no" }))).error).toContain("persona");
    expect(mocks.draftRecord).not.toHaveBeenCalled();
    expect(mocks.startDraft).not.toHaveBeenCalled();
  });
  it("un tipo fuera del enum se rechaza con el mensaje del schema", async () => {
    const r = await startReportAction({}, fd({ kind: "queja", anonymous: "no", "cf-turnstile-response": "t" }));
    expect(r.error).toBe("Elegí qué querés reportar.");
  });
});

describe("saveReporterAction", () => {
  it("guarda sobre el borrador de la llave, con el email en minúsculas", async () => {
    const r = await saveReporterAction({}, fd({ claim: CLAIM, name: "Ana López", dni: "30123456", phone: "2974000000", email: "ANA@Example.com" }));
    expect(r).toEqual({ saved: true });
    expect(mocks.saveReporter).toHaveBeenCalledWith({ reportId: 14, name: "Ana López", dni: "30123456", phone: "2974000000", email: "ana@example.com" });
  });
  it("una llave sin forma o sin borrador no toca el servicio", async () => {
    // El cuerpo es válido a propósito: lo único que se está ejercitando es la
    // FORMA de la llave (si el nombre fuera inválido cortaría antes el schema).
    expect((await saveReporterAction({}, fd({ claim: "../x", name: "Ana López", dni: "30123456", phone: "2974000000", email: "a@b.com" }))).error).toContain("No encontramos");
    mocks.findByClaim.mockResolvedValue(null);
    expect((await saveReporterAction({}, fd({ claim: CLAIM, name: "Ana López", dni: "30123456", phone: "2974000000", email: "a@b.com" }))).error).toContain("No encontramos");
    expect(mocks.saveReporter).not.toHaveBeenCalled();
  });
  it("el DNI se valida con el mismo regex de ASOCIATE", async () => {
    const r = await saveReporterAction({}, fd({ claim: CLAIM, name: "Ana López", dni: "12.345.678", phone: "2974000000", email: "a@b.com" }));
    expect(r.error).toContain("DNI");
  });
});

describe("uploadReportFileAction", () => {
  it("guarda una foto contra el borrador de la llave", async () => {
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff, 0])], "f.jpg", { type: "image/jpeg" });
    const r = await uploadReportFileAction({}, fd({ claim: CLAIM, kind: "photo", file }));
    expect(r).toEqual({ uploaded: { id: 3, kind: "photo" } });
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ reportId: 14, kind: "photo" }));
  });
  it("un archivo de más de 10 MB se rechaza SIN leerlo", async () => {
    const big = { size: 10 * 1024 * 1024 + 1, arrayBuffer: vi.fn() } as unknown as File;
    Object.setPrototypeOf(big, File.prototype);
    const r = await uploadReportFileAction({}, fd({ claim: CLAIM, kind: "photo", file: big as unknown as Blob }));
    expect(r.error).toContain("10 MB");
    expect(big.arrayBuffer).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("un tipo de archivo inválido o un borrador ya enviado se rechazan", async () => {
    const file = new File([new Uint8Array([1])], "f.jpg");
    expect((await uploadReportFileAction({}, fd({ claim: CLAIM, kind: "selfie", file }))).error).toBeTruthy();
    mocks.findByClaim.mockResolvedValue(draft({ status: "received" }));
    expect((await uploadReportFileAction({}, fd({ claim: CLAIM, kind: "photo", file }))).error).toContain("ya fue enviado");
  });
  it("el rechazo del store se muestra tal cual; un fallo de disco NUNCA muestra su mensaje", async () => {
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff, 0])], "f.jpg", { type: "image/jpeg" });
    mocks.save.mockRejectedValueOnce(new ReportFileError("Formato no admitido: subí una foto JPG, PNG o WebP."));
    expect((await uploadReportFileAction({}, fd({ claim: CLAIM, kind: "photo", file }))).error).toContain("Formato no admitido");

    const fsError = Object.assign(
      new Error("ENOSPC: no space left on device, open '/var/sigev/uploads/reports/14/x.jpg'"),
      { code: "ENOSPC" },
    );
    mocks.save.mockRejectedValueOnce(fsError);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await uploadReportFileAction({}, fd({ claim: CLAIM, kind: "photo", file }));
    spy.mockRestore();
    expect(r.error).toBe("No pudimos guardar la foto. Probá de nuevo en unos minutos.");
    expect(r.error).not.toContain("/var/sigev");
  });
});

describe("removeReportFileAction", () => {
  it("quita un archivo del borrador de la llave", async () => {
    expect(await removeReportFileAction({}, fd({ claim: CLAIM, fileId: "3" }))).toEqual({ removed: true });
    expect(mocks.remove).toHaveBeenCalledWith({ reportId: 14, fileId: 3 });
  });
});

describe("submitReportAction", () => {
  const body = {
    claim: CLAIM, category: "streets", subtype: "pothole", description: "Un pozo.",
    lat: "-45.797", lng: "-67.494", streetId: "3", streetName: "Cerro Catedral", addressDetail: "al 280", consent: "on",
  };
  it("envía, manda el acuse y la alerta, audita sin datos personales", async () => {
    const r = await submitReportAction({}, fd(body));
    expect(r).toEqual({ done: { number: 14 } });
    expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({
      reportId: 14, category: "streets", subtype: "pothole", lat: -45.797, lng: -67.494, streetId: 3, consent: true,
    }));
    expect(mocks.submitRecord).toHaveBeenCalledWith("9.9.9.9");
    expect(mocks.sendReceived).toHaveBeenCalledWith(14);
    expect(mocks.sendBoardAlert).toHaveBeenCalledWith(14, ["a@b.com"]);
    const entry = (mocks.audit.mock.calls[0] as unknown[])[0] as { action: string; detail: unknown };
    expect(entry.action).toBe("report_submitted");
    expect(JSON.stringify(entry)).not.toContain("Cerro Catedral");
    expect(JSON.stringify(entry)).not.toContain("Un pozo");
  });
  it("sin consentimiento o sin cupo no escribe", async () => {
    expect((await submitReportAction({}, fd({ ...body, consent: "" }))).error).toContain("consentimiento");
    // Un formulario que ni siquiera valida NO cobra el intento (mismo criterio
    // que el captcha inválido del paso 1): el cupo cuenta envíos, no tipeos.
    expect(mocks.submitRecord).not.toHaveBeenCalled();
    mocks.submitAllows.mockReturnValue(false);
    expect((await submitReportAction({}, fd(body))).error).toContain("Demasiados");
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("traslada el error del servicio y no manda correos", async () => {
    mocks.submit.mockResolvedValue({ ok: false, error: "Falta subir el frente y el dorso de tu DNI." });
    const r = await submitReportAction({}, fd(body));
    expect(r.error).toContain("DNI");
    expect(mocks.sendReceived).not.toHaveBeenCalled();
  });
  it("un SMTP caído en el acuse no convierte el envío en error", async () => {
    mocks.sendReceived.mockRejectedValueOnce(new Error("x"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await submitReportAction({}, fd(body))).toEqual({ done: { number: 14 } });
    spy.mockRestore();
  });
});
