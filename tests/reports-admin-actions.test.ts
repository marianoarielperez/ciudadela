// Las dos actions del admin sobre un reporte (spec §5.3): requireAdmin en la
// PRIMERA línea (la familia *-actions-auth), "Otro" exige texto, la fecha no
// puede ser futura, el acta es opcional y sólo para iniciativas, se audita con
// ids/códigos (nunca el motivo ni la identidad), y el aviso al vecino sale
// DESPUÉS del asiento.
//
// `@/lib/members/minute-form` se dobla PARCIALMENTE: el schema del acta y
// `createsNewMinute` son los de verdad —lo que se está probando es que el
// FormData del picker se lea bien—, y sólo las dos funciones que tocan la base
// (`resolveMinuteId`, `discardUnusedMinute`) son dobles.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  file: vi.fn(),
  dismiss: vi.fn(),
  sendFiled: vi.fn(async () => {}),
  findUnique: vi.fn(),
  audit: vi.fn(async (_entry: unknown) => {}),
  revalidatePath: vi.fn(),
  resolveMinuteId: vi.fn(async () => 33),
  discardUnusedMinute: vi.fn(async () => {}),
}));
vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/reports/service", () => ({ reports: { file: mocks.file, dismiss: mocks.dismiss } }));
vi.mock("@/lib/reports/notify", () => ({ reportNotifier: { sendFiled: mocks.sendFiled } }));
vi.mock("@/lib/prisma", () => ({ prisma: { report: { findUnique: mocks.findUnique } } }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/headers", () => ({ headers: async () => new Map([["x-real-ip", "1.1.1.1"]]) }));
vi.mock("@/lib/members/minute-form", async (orig) => ({
  ...(await orig<typeof import("@/lib/members/minute-form")>()),
  resolveMinuteId: mocks.resolveMinuteId,
  discardUnusedMinute: mocks.discardUnusedMinute,
}));

import { dismissReportAction, fileReportAction } from "@/app/admin/solicitudes/reportes/actions";

const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const TODAY = "2026-09-01";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockResolvedValue({ ok: true, actorId: 7 });
  mocks.findUnique.mockResolvedValue({ id: 14, kind: "claim", status: "received" });
  mocks.file.mockResolvedValue({ ok: true });
  mocks.dismiss.mockResolvedValue({ ok: true });
  mocks.resolveMinuteId.mockResolvedValue(33);
  // 15:00 UTC = 12:00 en Argentina, así que el día civil de acá y el de UTC
  // coinciden: lo que se prueba es la fecha tipeada, no el corte de medianoche.
  vi.useFakeTimers({ now: new Date("2026-09-01T15:00:00Z") });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("fileReportAction", () => {
  it("bloquea sin admin antes de tocar nada", async () => {
    mocks.requireAdmin.mockResolvedValue({ ok: false, reason: "not_admin", error: "no" });
    expect((await fileReportAction({}, fd({ reportId: "14", agency: "scpl", filedAt: TODAY }))).error).toBe("no");
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.file).not.toHaveBeenCalled();
  });

  it("presenta ante SCPL con fecha civil, avisa y audita sin texto", async () => {
    const r = await fileReportAction({}, fd({ reportId: "14", agency: "scpl", filedAt: TODAY, reference: "EXP 1" }));
    expect(r).toEqual({ done: true });
    expect(mocks.file).toHaveBeenCalledWith(expect.objectContaining({
      reportId: 14, actorId: 7, agency: "scpl", reference: "EXP 1", minuteId: null,
    }));
    // La fecha se guarda al MEDIODÍA UTC del día civil argentino, como toda
    // fecha sin hora del proyecto: así se muestra el mismo día en UTC-3.
    expect((mocks.file.mock.calls[0][0] as { filedAt: Date }).filedAt.toISOString())
      .toBe("2026-09-01T12:00:00.000Z");
    expect(mocks.sendFiled).toHaveBeenCalledWith(14);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      action: "report_filed", entity: "report", entityId: 14, detail: { agency: "scpl", minuteId: null },
    }));
    // El expediente es texto libre del operador y NO va al asiento (Ley 25.326).
    expect(JSON.stringify(mocks.audit.mock.calls[0][0])).not.toContain("EXP 1");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/solicitudes/reportes");
  });

  it("'Otro' sin texto y una fecha futura se rechazan sin escribir", async () => {
    expect((await fileReportAction({}, fd({ reportId: "14", agency: "other", filedAt: TODAY }))).error)
      .toContain("organismo");
    expect((await fileReportAction({}, fd({ reportId: "14", agency: "mcr", filedAt: "2026-09-02" }))).error)
      .toContain("no puede ser futura");
    expect(mocks.file).not.toHaveBeenCalled();
    expect(mocks.sendFiled).not.toHaveBeenCalled();
  });

  it("un reclamo sin organismo se rechaza: un reclamo se presenta ANTE alguien", async () => {
    expect((await fileReportAction({}, fd({ reportId: "14", filedAt: TODAY }))).error).toContain("organismo");
    expect(mocks.file).not.toHaveBeenCalled();
  });

  it("una iniciativa admite acta opcional y organismo vacío", async () => {
    mocks.findUnique.mockResolvedValue({ id: 3, kind: "initiative", status: "received" });
    const r = await fileReportAction({}, fd({ reportId: "3", filedAt: TODAY, minuteMode: "existing", minuteId: "33" }));
    expect(r).toEqual({ done: true });
    expect(mocks.file).toHaveBeenCalledWith(expect.objectContaining({ reportId: 3, agency: null, minuteId: 33 }));
    expect(mocks.audit.mock.calls[0][0]).toMatchObject({ detail: { agency: null, minuteId: 33 } });
  });

  it("una iniciativa sin acta no toca el libro de actas", async () => {
    mocks.findUnique.mockResolvedValue({ id: 3, kind: "initiative", status: "received" });
    expect(await fileReportAction({}, fd({ reportId: "3", filedAt: TODAY }))).toEqual({ done: true });
    expect(mocks.resolveMinuteId).not.toHaveBeenCalled();
    expect(mocks.file).toHaveBeenCalledWith(expect.objectContaining({ minuteId: null }));
  });

  // El acta es del Art. 6.2 —la Comisión TRATÓ la iniciativa—; un reclamo se
  // presenta ante un organismo y no asienta nada en el libro. Un `minuteId`
  // tipeado a mano en el POST de un reclamo no puede crear ni citar un acta.
  it("un reclamo ignora el acta aunque el POST la traiga", async () => {
    const r = await fileReportAction({}, fd({ reportId: "14", agency: "mcr", filedAt: TODAY, minuteMode: "existing", minuteId: "33" }));
    expect(r).toEqual({ done: true });
    expect(mocks.resolveMinuteId).not.toHaveBeenCalled();
    expect(mocks.file).toHaveBeenCalledWith(expect.objectContaining({ minuteId: null }));
  });

  // La compensación del acta huérfana: si el servicio rechaza DESPUÉS de que se
  // creó el acta nueva, el acta no puede quedar en el libro sin asiento.
  it("un acta nueva se descarta cuando el servicio rechaza", async () => {
    mocks.findUnique.mockResolvedValue({ id: 3, kind: "initiative", status: "received" });
    mocks.file.mockResolvedValue({ ok: false, error: "El reporte ya fue resuelto o no existe." });
    const r = await fileReportAction({}, fd({
      reportId: "3", filedAt: TODAY,
      minuteMode: "new", minuteNew: "1", minuteType: "board", minuteNumber: "12", minuteDate: "2026-09-01",
    }));
    expect(r.error).toContain("resuelto");
    expect(mocks.discardUnusedMinute).toHaveBeenCalledWith(expect.anything(), 33);
    expect(mocks.sendFiled).not.toHaveBeenCalled();
  });

  // Un acta EXISTENTE no se descarta nunca: es del libro y la eligió el operador.
  it("un acta existente no se descarta aunque el servicio rechace", async () => {
    mocks.findUnique.mockResolvedValue({ id: 3, kind: "initiative", status: "received" });
    mocks.file.mockResolvedValue({ ok: false, error: "El reporte ya fue resuelto o no existe." });
    await fileReportAction({}, fd({ reportId: "3", filedAt: TODAY, minuteMode: "existing", minuteId: "33" }));
    expect(mocks.discardUnusedMinute).not.toHaveBeenCalled();
  });

  it("traslada el error del servicio y no avisa", async () => {
    mocks.file.mockResolvedValue({ ok: false, error: "El reporte ya fue resuelto o no existe." });
    expect((await fileReportAction({}, fd({ reportId: "14", agency: "mcr", filedAt: TODAY }))).error)
      .toContain("resuelto");
    expect(mocks.sendFiled).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("un reporte que no existe no llega al servicio", async () => {
    mocks.findUnique.mockResolvedValue(null);
    expect((await fileReportAction({}, fd({ reportId: "99", agency: "mcr", filedAt: TODAY }))).error)
      .toContain("no existe");
    expect(mocks.file).not.toHaveBeenCalled();
  });
});

describe("dismissReportAction", () => {
  it("desestima con motivo, audita sin el motivo, no manda correo", async () => {
    const r = await dismissReportAction({}, fd({ reportId: "14", reason: "Duplicado del N° 3." }));
    expect(r).toEqual({ done: true });
    expect(mocks.dismiss).toHaveBeenCalledWith({ reportId: 14, actorId: 7, reason: "Duplicado del N° 3." });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      action: "report_dismissed", entity: "report", entityId: 14,
    }));
    expect(JSON.stringify(mocks.audit.mock.calls[0][0])).not.toContain("Duplicado");
    expect(mocks.sendFiled).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/solicitudes/reportes");
  });

  it("sin motivo o sin admin no escribe", async () => {
    expect((await dismissReportAction({}, fd({ reportId: "14", reason: "" }))).error).toBeTruthy();
    mocks.requireAdmin.mockResolvedValue({ ok: false, reason: "anonymous", error: "no" });
    expect((await dismissReportAction({}, fd({ reportId: "14", reason: "x" }))).error).toBe("no");
    expect(mocks.dismiss).not.toHaveBeenCalled();
  });

  it("traslada el error del servicio sin auditar", async () => {
    mocks.dismiss.mockResolvedValue({ ok: false, error: "El reporte ya fue resuelto o no existe." });
    expect((await dismissReportAction({}, fd({ reportId: "14", reason: "Spam." }))).error).toContain("resuelto");
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});
