// El GET del PDF de un reporte (spec §8). Lo que se fija es lo invisible: la
// guarda de sesión, que el borrador no exista, que al generador le lleguen las
// FOTOS y nunca el DNI, que el asiento lleve sólo metadatos y que las cabeceras
// defensivas estén.
//
// Verificado por MUTACIÓN (borrar la línea, ver el test en rojo, restaurar):
//  - `requireAdmin()` como primera línea (sin ella, 200 para cualquiera);
//  - `r.status === "draft"` (sin él, un borrador se imprime);
//  - `parsePositiveInt` (sin él, `/abc/pdf` llega a la consulta con NaN);
//  - el filtro `kind === "photo"` (sin él, la cara del DNI viaja al PDF que se
//    manda al municipio);
//  - el `detail` del asiento (sin los metadatos, no queda rastro de si el PDF
//    salió con mapa).
import { beforeEach, describe, expect, it, vi } from "vitest";

type PdfData = import("@/lib/reports/pdf").ReportPdfData;
type PdfAssets = { photos: Buffer[]; map: Buffer | null };

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  findUnique: vi.fn(),
  read: vi.fn(async () => Buffer.from("x")),
  // Tipado con los parámetros reales del generador: es lo que deja aseverar
  // sobre `mock.calls[0]` sin castear (y lo que rompe si la firma cambia).
  render: vi.fn(
    async () => new Uint8Array([0x25, 0x50, 0x44, 0x46]),
  ),
  map: vi.fn(async () => null as Buffer | null),
  audit: vi.fn(async () => {}),
}));

/** Los argumentos con los que se llamó al generador en la llamada `n`. */
function renderCall(n = 0): [PdfData, PdfAssets] {
  const call = mocks.render.mock.calls[n];
  expect(call, `no hubo llamada ${n} a renderReportPdf`).toBeDefined();
  return call!;
}

vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/prisma", () => ({ prisma: { report: { findUnique: mocks.findUnique } } }));
vi.mock("@/lib/reports/storage", () => ({ reportFileStore: { read: mocks.read } }));
vi.mock("@/lib/reports/pdf", async (orig) => ({
  ...(await orig<typeof import("@/lib/reports/pdf")>()),
  renderReportPdf: mocks.render,
}));
vi.mock("@/lib/reports/static-map", () => ({ renderStaticMap: mocks.map }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("next/headers", () => ({ headers: async () => new Map([["x-real-ip", "1.1.1.1"]]) }));

import { GET } from "@/app/api/admin/reportes/[id]/pdf/route";
import { REPORT_FILE_CSP } from "@/lib/reports/file-response";

const report = {
  id: 14,
  kind: "claim",
  status: "received",
  anonymous: false,
  category: "water",
  subtype: "leak",
  description: "Pierde agua",
  streetName: "Cerro Catedral",
  addressDetail: "al 280",
  lat: "-45.797",
  lng: "-67.494",
  outsideBoundary: false,
  scplTicket: null,
  submittedAt: new Date("2026-09-01T15:00:00Z"),
  reporterName: "Ana",
  reporterDni: "1",
  reporterPhone: "2",
  reporterEmail: "a@b.com",
  filedAgency: null,
  filedAgencyOther: null,
  filedAt: null,
  filedReference: null,
  filedMinute: null,
  dismissedAt: null,
  dismissReason: null,
  files: [
    { id: 1, kind: "photo", path: "reports/14/a.jpg" },
    { id: 2, kind: "dni_front", path: "reports/14/b.jpg" },
  ],
  member: null,
};

const call = (id = "14") => GET(new Request("http://localhost/x"), { params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockResolvedValue({ ok: true, actorId: 7 });
  mocks.findUnique.mockResolvedValue(report);
  mocks.read.mockResolvedValue(Buffer.from("x"));
  mocks.map.mockResolvedValue(null);
  mocks.render.mockResolvedValue(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
});

describe("GET /api/admin/reportes/[id]/pdf", () => {
  it("403 sin admin, sin tocar la base ni el disco", async () => {
    mocks.requireAdmin.mockResolvedValue({ ok: false, reason: "anonymous", error: "Ingresá." });
    const res = await call();
    expect(res.status).toBe(403);
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.render).not.toHaveBeenCalled();
  });

  it("404 con id inválido, inexistente o borrador", async () => {
    expect((await call("abc")).status).toBe(404);
    expect((await call("0")).status).toBe(404);
    expect((await call("-3")).status).toBe(404);
    expect(mocks.findUnique).not.toHaveBeenCalled();

    mocks.findUnique.mockResolvedValue(null);
    expect((await call()).status).toBe(404);

    // Un borrador no se envió todavía: no hay nada que presentar.
    mocks.findUnique.mockResolvedValue({ ...report, status: "draft" });
    expect((await call()).status).toBe(404);
    expect(mocks.render).not.toHaveBeenCalled();
  });

  it("genera con las FOTOS (no el DNI), pide el mapa, audita metadatos y sirve inline", async () => {
    const res = await call();
    expect(res.status).toBe(200);

    // Una sola lectura de disco: la foto. La cara del DNI NO viaja a un papel
    // que se manda afuera de la asociación.
    expect(mocks.read).toHaveBeenCalledTimes(1);
    expect(mocks.read).toHaveBeenCalledWith(report.files[0]);

    expect(mocks.map).toHaveBeenCalledWith(expect.objectContaining({ lat: -45.797, lng: -67.494 }));
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 7,
        action: "report_pdf_export",
        entity: "report",
        entityId: 14,
        detail: { hasMap: false, photos: 1 },
        ip: "1.1.1.1",
      }),
    );

    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toBe('inline; filename="reporte-14.pdf"');
    expect(res.headers.get("Cache-Control")).toBe("no-store, private");
    expect(res.headers.get("Vary")).toBe("Cookie");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Security-Policy")).toBe(REPORT_FILE_CSP);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
  });

  it("arma los datos del generador: dirección, tipo del catálogo e identidad", async () => {
    await call();
    const [data] = renderCall();
    expect(data).toMatchObject({
      number: 14,
      kind: "claim",
      status: "received",
      categoryLabel: "Agua potable",
      subtypeLabel: "Pérdida de agua en la red",
      street: "Cerro Catedral al 280",
      lat: -45.797,
      lng: -67.494,
      anonymous: false,
      filed: null,
      dismissed: null,
    });
    expect(data.reporter.memberNumber).toBeNull();
    // El número del socio es el del libro ABIERTO: sin ese `where` un socio
    // migrado imprimiría su número del Libro 1 en el PDF.
    expect(JSON.stringify(mocks.findUnique.mock.calls[0][0])).toContain('"where":{"book":{"status":"open"}}');
  });

  it("una foto que no está en disco no frena el PDF: sale con una menos", async () => {
    mocks.read.mockRejectedValue(new Error("ENOENT '/var/sigev/uploads/reports/14/a.jpg'"));
    const res = await call();
    expect(res.status).toBe(200);
    expect(renderCall()[1].photos).toEqual([]);
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ detail: { hasMap: false, photos: 0 } }),
    );
  });

  it("sin coordenadas no se pide el mapa; con mapa el asiento lo dice", async () => {
    mocks.findUnique.mockResolvedValue({ ...report, lat: null, lng: null });
    expect((await call()).status).toBe(200);
    expect(mocks.map).not.toHaveBeenCalled();
    expect(renderCall()[1].map).toBeNull();

    vi.clearAllMocks();
    mocks.requireAdmin.mockResolvedValue({ ok: true, actorId: 7 });
    mocks.findUnique.mockResolvedValue(report);
    mocks.read.mockResolvedValue(Buffer.from("x"));
    mocks.map.mockResolvedValue(Buffer.from("png"));
    await call();
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ detail: { hasMap: true, photos: 1 } }),
    );
  });

  it("un reporte presentado nombra el organismo y el acta por tipo y número", async () => {
    mocks.findUnique.mockResolvedValue({
      ...report,
      kind: "initiative",
      status: "filed",
      category: "social",
      subtype: null,
      filedAgency: null,
      filedAt: new Date("2026-09-12T15:00:00Z"),
      filedReference: "EXP 1",
      filedMinute: { type: "board", number: 124 },
    });
    await call();
    const [data] = renderCall();
    expect(data.subtypeLabel).toBeNull(); // una iniciativa no tiene tipo
    expect(data.filed).toMatchObject({
      agencyLabel: null,
      reference: "EXP 1",
      minuteName: "Comisión Directiva N° 124",
    });
  });

  it("el organismo 'otro' viaja con el texto que escribió el operador", async () => {
    mocks.findUnique.mockResolvedValue({
      ...report,
      status: "filed",
      filedAgency: "other",
      filedAgencyOther: "Defensoría del Pueblo",
      filedAt: new Date("2026-09-12T15:00:00Z"),
    });
    await call();
    expect(renderCall()[0].filed?.agencyLabel).toBe("Defensoría del Pueblo");
  });
});
