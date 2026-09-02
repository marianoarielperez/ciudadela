// `snapshotOf` es lo ÚNICO que la página del retome le cuenta al wizard sobre
// un borrador que ya existe. Puro: sin Prisma, sin fixtures.
import { describe, expect, it } from "vitest";
import { snapshotOf } from "@/app/(public)/reportes/snapshot";
import type { ReportWithFiles } from "@/lib/reports/service";

function report(over: Partial<ReportWithFiles> = {}): ReportWithFiles {
  return {
    id: 7,
    kind: "claim",
    status: "draft",
    anonymous: false,
    memberId: null,
    reporterName: null,
    reporterDni: null,
    reporterPhone: null,
    reporterEmail: null,
    files: [],
    ...over,
  } as ReportWithFiles;
}

const REPORTER = {
  reporterName: "Ana Pérez",
  reporterDni: "30111222",
  reporterPhone: "297 400 0000",
  reporterEmail: "ana@example.com",
};

describe("snapshotOf", () => {
  it("borrador con datos a medias: no da el paso 2 por hecho", () => {
    // Tres de cuatro no alcanza: el paso 2 guarda los cuatro juntos.
    const s = snapshotOf(report({ ...REPORTER, reporterEmail: null }));
    expect(s.reporterComplete).toBe(false);
    expect(s.reporter).toBeNull();
    expect(s.number).toBeNull();
    expect(s.status).toBe("draft");
  });

  it("borrador con los cuatro datos: los devuelve para rehidratar el formulario", () => {
    const s = snapshotOf(report({ ...REPORTER, anonymous: true, kind: "initiative" }));
    expect(s.reporterComplete).toBe(true);
    expect(s.reporter).toEqual({
      name: "Ana Pérez",
      dni: "30111222",
      phone: "297 400 0000",
      email: "ana@example.com",
    });
    expect(s.anonymous).toBe(true);
    expect(s.kind).toBe("initiative");
    expect(s.number).toBeNull();
  });

  it("ya enviado: el N° visible es el id, y el estado viaja entero", () => {
    for (const status of ["received", "filed", "dismissed"] as const) {
      const s = snapshotOf(report({ status, ...REPORTER }));
      expect(s.number, status).toBe(7);
      expect(s.status, status).toBe(status);
    }
  });

  it("de los archivos sólo viajan id y tipo: nunca la ruta en disco", () => {
    const files = [
      { id: 1, reportId: 7, kind: "dni_front", path: "reports/7/a.jpg", mime: "image/jpeg" },
      { id: 2, reportId: 7, kind: "photo", path: "reports/7/b.jpg", mime: "image/jpeg" },
    ] as ReportWithFiles["files"];
    const s = snapshotOf(report({ files }));
    expect(s.files).toEqual([
      { id: 1, kind: "dni_front" },
      { id: 2, kind: "photo" },
    ]);
    expect(JSON.stringify(s)).not.toContain("reports/7");
  });
});
