// La ÚNICA puerta de escritura de `reports` (spec §4 invariantes): el borrador
// nace con su llave hasheada, el envío revalida en la base (identidad, DNI,
// reglas) y pasa draft→received con un updateMany condicional, presentar y
// desestimar sólo tocan `received`, y los conteos son los de la pestaña y la
// landing. Doble de base en memoria que HONRA el `where` (lección del M6).
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import { hashClaim } from "@/lib/reports/claim";
import { REPORT_MESSAGES } from "@/lib/reports/rules";
import { makeReports } from "@/lib/reports/service";

const NOW = new Date("2026-09-01T15:00:00Z");
type Row = Record<string, unknown> & { id: number; status: string };
type FileRow = { id: number; reportId: number; kind: string };

function fakeDb() {
  const reports: Row[] = [];
  const files: FileRow[] = [];
  let nextId = 1;
  const matches = (r: Row, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => {
      if (v !== null && typeof v === "object" && "in" in (v as object)) {
        return (v as { in: unknown[] }).in.includes(r[k]);
      }
      if (v !== null && typeof v === "object" && "gte" in (v as object)) {
        const { gte, lt } = v as { gte?: Date; lt?: Date };
        const val = (r[k] ?? null) as Date | null;
        return val !== null && (!gte || val >= gte) && (!lt || val < lt);
      }
      return r[k] === v;
    });
  const withFiles = (r: Row) => ({ ...r, files: files.filter((f) => f.reportId === r.id) });
  const db = {
    report: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row: Row = { id: nextId++, status: "draft", createdAt: NOW, ...data };
        reports.push(row);
        return row;
      }),
      findUnique: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const r = reports.find((x) => matches(x, where));
        return r ? withFiles(r) : null;
      }),
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const r = reports.find((x) => matches(x, where));
        return r ? withFiles(r) : null;
      }),
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        reports.filter((x) => matches(x, where)).map(withFiles),
      ),
      updateMany: vi.fn(
        async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          let count = 0;
          for (const r of reports)
            if (matches(r, where)) {
              Object.assign(r, data);
              count++;
            }
          return { count };
        },
      ),
      count: vi.fn(
        async ({ where }: { where: Record<string, unknown> }) => reports.filter((x) => matches(x, where)).length,
      ),
    },
    reportFile: {
      findMany: vi.fn(async ({ where }: { where: { reportId: number } }) =>
        files.filter((f) => f.reportId === where.reportId),
      ),
    },
  };
  return { db, reports, files };
}

const reporter = { name: "Ana López", dni: "30123456", phone: "2974000000", email: "ana@example.com" };
const submission = {
  category: "streets",
  subtype: "pothole",
  description: "Un pozo enorme.",
  lat: -45.797,
  lng: -67.494,
  streetId: 3,
  streetName: "Cerro Catedral",
  addressDetail: "al 280",
  scplTicket: null,
  consent: true,
};

let ctx: ReturnType<typeof fakeDb>;
let service: ReturnType<typeof makeReports>;
beforeEach(() => {
  vi.clearAllMocks();
  ctx = fakeDb();
  service = makeReports({ db: ctx.db as never, now: () => NOW });
});

async function vecinoDraft() {
  const { id, claim } = await service.startDraft({
    kind: "claim",
    anonymous: false,
    ip: "1.1.1.1",
    userAgent: "ua",
  });
  await service.saveReporter({ reportId: id, ...reporter });
  ctx.files.push({ id: 1, reportId: id, kind: "dni_front" }, { id: 2, reportId: id, kind: "dni_back" });
  return { id, claim };
}

describe("startDraft y findByClaim", () => {
  it("crea el borrador con el hash de la llave, nunca con la llave", async () => {
    const { id, claim } = await service.startDraft({
      kind: "claim",
      anonymous: true,
      ip: "1.1.1.1",
      userAgent: "ua",
    });
    expect(ctx.reports[0]).toMatchObject({
      id,
      status: "draft",
      kind: "claim",
      anonymous: true,
      claimTokenHash: hashClaim(claim),
    });
    expect(JSON.stringify(ctx.reports[0])).not.toContain(claim);
    expect(await service.findByClaim(claim)).toMatchObject({ id });
    expect(await service.findByClaim("x".repeat(43))).toBeNull();
    expect(await service.findByClaim("../")).toBeNull();
    expect(ctx.db.report.findUnique).toHaveBeenCalledTimes(2); // la llave sin forma no consulta
  });

  it("el borrador de un socio copia la identidad de la ficha", async () => {
    const { id } = await service.startDraft({
      kind: "initiative",
      anonymous: false,
      memberId: 14,
      reporter,
      ip: "1.1.1.1",
      userAgent: "ua",
    });
    expect(ctx.reports[0]).toMatchObject({
      id,
      memberId: 14,
      reporterName: "Ana López",
      reporterDni: "30123456",
    });
  });
});

describe("saveReporter", () => {
  it("sólo escribe sobre un borrador", async () => {
    const { id } = await service.startDraft({ kind: "claim", anonymous: false, ip: "1", userAgent: "" });
    expect(await service.saveReporter({ reportId: id, ...reporter })).toEqual({ ok: true });
    ctx.reports[0].status = "received";
    expect(await service.saveReporter({ reportId: id, ...reporter })).toEqual({
      ok: false,
      error: REPORT_MESSAGES.notDraft,
    });
  });
});

describe("submit", () => {
  it("pasa draft→received, estampa submittedAt, consentAt y la marca de fuera del barrio", async () => {
    const { id } = await vecinoDraft();
    const r = await service.submit({ reportId: id, ...submission });
    expect(r).toEqual({ ok: true, id });
    expect(ctx.reports[0]).toMatchObject({
      status: "received",
      submittedAt: NOW,
      consentAt: NOW,
      category: "streets",
      subtype: "pothole",
      outsideBoundary: false,
      streetName: "Cerro Catedral",
    });
    const far = await vecinoDraft();
    await service.submit({ reportId: far.id, ...submission, lat: -45.8647, lng: -67.4823 });
    expect(ctx.reports[1]).toMatchObject({ outsideBoundary: true });
  });

  it("revalida en la base: sin DNI o sin identidad no pasa, y sin consentimiento tampoco", async () => {
    const { id } = await service.startDraft({ kind: "claim", anonymous: false, ip: "1", userAgent: "" });
    expect(await service.submit({ reportId: id, ...submission })).toEqual({
      ok: false,
      error: REPORT_MESSAGES.identity,
    });
    await service.saveReporter({ reportId: id, ...reporter });
    expect(await service.submit({ reportId: id, ...submission })).toEqual({
      ok: false,
      error: REPORT_MESSAGES.dni,
    });
    ctx.files.push({ id: 1, reportId: id, kind: "dni_front" }, { id: 2, reportId: id, kind: "dni_back" });
    expect(await service.submit({ reportId: id, ...submission, consent: false })).toEqual({
      ok: false,
      error: REPORT_MESSAGES.consent,
    });
    expect(ctx.reports[0].status).toBe("draft");
  });

  it("un socio envía sin DNI ni identidad declarada", async () => {
    const { id } = await service.startDraft({
      kind: "initiative",
      anonymous: false,
      memberId: 14,
      reporter,
      ip: "1",
      userAgent: "",
    });
    const r = await service.submit({
      reportId: id,
      ...submission,
      category: "social",
      subtype: null,
      lat: null,
      lng: null,
    });
    expect(r).toEqual({ ok: true, id });
  });

  // La normalización de `rules.ts` («"" → null») tiene que llegar a la BASE: una
  // categoría sin tipos guarda NULL, no la cadena vacía que manda el `<select>`.
  it("una categoría sin tipos persiste el subtipo en NULL, nunca en cadena vacía", async () => {
    const { id } = await vecinoDraft();
    const r = await service.submit({
      reportId: id,
      ...submission,
      category: "other",
      subtype: "",
      lat: null,
      lng: null,
    });
    expect(r).toEqual({ ok: true, id });
    expect(ctx.reports[0].subtype).toBeNull();
  });

  it("un segundo envío del mismo borrador no escribe dos veces", async () => {
    const { id } = await vecinoDraft();
    await service.submit({ reportId: id, ...submission });
    expect(await service.submit({ reportId: id, ...submission })).toEqual({
      ok: false,
      error: REPORT_MESSAGES.notDraft,
    });
  });

  // La CARRERA, no la precondición: el test de arriba lo corta la lectura previa
  // (`report.status !== "draft"`), así que no ejercita el `status` del `where`.
  // Acá el segundo POST llega con la foto VIEJA —leyó antes de que el primero
  // escribiera—, que es lo que pasa con dos clicks simultáneos: lo único que lo
  // frena es que el updateMany sea condicional por estado.
  it("dos envíos simultáneos: el updateMany condicional deja pasar uno solo", async () => {
    const { id } = await vecinoDraft();
    const stale = await ctx.db.report.findUnique({ where: { id } });
    await service.submit({ reportId: id, ...submission });
    ctx.db.report.findUnique.mockResolvedValueOnce(stale);
    expect(await service.submit({ reportId: id, ...submission })).toEqual({
      ok: false,
      error: REPORT_MESSAGES.notDraft,
    });
  });
});

describe("file y dismiss", () => {
  async function received() {
    const { id } = await vecinoDraft();
    await service.submit({ reportId: id, ...submission });
    return id;
  }

  it("presenta un reporte recibido y guarda organismo, fecha, expediente y quién", async () => {
    const id = await received();
    const r = await service.file({
      reportId: id,
      actorId: 9,
      agency: "scpl",
      agencyOther: null,
      filedAt: NOW,
      reference: "EXP-1",
      minuteId: null,
    });
    expect(r).toEqual({ ok: true });
    expect(ctx.reports[0]).toMatchObject({
      status: "filed",
      filedAgency: "scpl",
      filedReference: "EXP-1",
      filedById: 9,
      filedAt: NOW,
    });
  });

  it("'Otro' exige el texto del organismo", async () => {
    const id = await received();
    const r = await service.file({
      reportId: id,
      actorId: 9,
      agency: "other",
      agencyOther: null,
      filedAt: NOW,
      reference: null,
      minuteId: null,
    });
    expect(r).toEqual({ ok: false, error: REPORT_MESSAGES.agencyOther });
    expect(ctx.reports[0].status).toBe("received");
  });

  it("desestimar exige motivo y sólo actúa sobre received; presentar sobre desestimado falla", async () => {
    const id = await received();
    // El piso son 5 caracteres (spec §5.3): el vacío y un motivo de 4 no pasan.
    expect(await service.dismiss({ reportId: id, actorId: 9, reason: "  " })).toEqual({
      ok: false,
      error: REPORT_MESSAGES.dismissReason,
    });
    expect(await service.dismiss({ reportId: id, actorId: 9, reason: " dup " })).toEqual({
      ok: false,
      error: REPORT_MESSAGES.dismissReason,
    });
    expect(await service.dismiss({ reportId: id, actorId: 9, reason: "Duplicado del N° 3." })).toEqual({
      ok: true,
    });
    expect(ctx.reports[0]).toMatchObject({
      status: "dismissed",
      dismissReason: "Duplicado del N° 3.",
      dismissedById: 9,
    });
    expect(
      await service.file({
        reportId: id,
        actorId: 9,
        agency: "mcr",
        agencyOther: null,
        filedAt: NOW,
        reference: null,
        minuteId: null,
      }),
    ).toEqual({ ok: false, error: REPORT_MESSAGES.notPending });
    // Motivo válido a propósito: lo que se ejercita acá es el `where` (un id que
    // no existe), no la guarda de longitud que ya se probó arriba.
    expect(await service.dismiss({ reportId: 999, actorId: 9, reason: "No existe." })).toEqual({
      ok: false,
      error: REPORT_MESSAGES.notPending,
    });
  });
});

describe("conteos y listados", () => {
  it("pendingCount cuenta sólo received; yearStats cuenta enviados y presentados del año civil", async () => {
    const a = await vecinoDraft();
    await service.submit({ reportId: a.id, ...submission });
    const b = await vecinoDraft();
    await service.submit({ reportId: b.id, ...submission });
    await service.file({
      reportId: b.id,
      actorId: 9,
      agency: "mcr",
      agencyOther: null,
      filedAt: NOW,
      reference: null,
      minuteId: null,
    });
    await service.startDraft({ kind: "claim", anonymous: false, ip: "1", userAgent: "" });
    expect(await service.pendingCount()).toBe(1);
    expect(await service.yearStats(NOW)).toEqual({ received: 2, filed: 1 });
  });

  it("listForMember devuelve sólo los del socio, sin borradores", async () => {
    const mine = await service.startDraft({
      kind: "claim",
      anonymous: false,
      memberId: 14,
      reporter,
      ip: "1",
      userAgent: "",
    });
    await service.submit({ reportId: mine.id, ...submission });
    await service.startDraft({
      kind: "claim",
      anonymous: false,
      memberId: 14,
      reporter,
      ip: "1",
      userAgent: "",
    });
    await service.startDraft({
      kind: "claim",
      anonymous: false,
      memberId: 15,
      reporter,
      ip: "1",
      userAgent: "",
    });
    const list = await service.listForMember(14);
    expect(list.map((r) => r.id)).toEqual([mine.id]);
  });
});
