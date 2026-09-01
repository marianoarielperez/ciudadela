// La purga de Reportes (spec §9): las imágenes del DNI se borran 360 días
// después de presentado o desestimado (y se estampa dniPurgedAt, para no volver
// a mirar esa fila), los borradores nunca enviados se borran a las 48 h con su
// carpeta, un fallo de disco cuenta y no corta la corrida, y sólo se audita si
// hubo algo que purgar.
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import { makeReportRetention } from "@/lib/reports/retention";

const NOW = new Date("2027-09-01T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

function build(rows: Array<Record<string, unknown> & { id: number }>) {
  const db = {
    report: {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const cutoffOr = where.OR as Array<Record<string, { lte: Date }>> | undefined;
        return rows.filter((r) => {
          if (where.status && typeof where.status === "object") {
            if (!(where.status as { in: string[] }).in.includes(r.status as string)) return false;
          } else if (where.status && r.status !== where.status) return false;
          if ("dniPurgedAt" in where && r.dniPurgedAt !== where.dniPurgedAt) return false;
          if (cutoffOr) {
            const hit = cutoffOr.some((c) =>
              Object.entries(c).some(([k, v]) => r[k] instanceof Date && (r[k] as Date) <= v.lte),
            );
            if (!hit) return false;
          }
          if (where.createdAt && !((r.createdAt as Date) <= (where.createdAt as { lte: Date }).lte))
            return false;
          return true;
        });
      }),
      updateMany: vi.fn(
        async ({ where, data }: { where: { id: number }; data: Record<string, unknown> }) => {
          const r = rows.find((x) => x.id === where.id);
          if (r) Object.assign(r, data);
          return { count: r ? 1 : 0 };
        },
      ),
      delete: vi.fn(async ({ where }: { where: { id: number } }) => {
        const i = rows.findIndex((x) => x.id === where.id);
        if (i >= 0) rows.splice(i, 1);
        return {};
      }),
    },
  };
  const store = { deleteFiles: vi.fn(async () => 2), deleteReportDir: vi.fn(async () => {}) };
  const audit = vi.fn(async () => {});
  const retention = makeReportRetention({ db: db as never, store, audit, now: () => NOW });
  return { retention, db, store, audit, rows };
}

beforeEach(() => vi.clearAllMocks());

describe("purge", () => {
  it("borra los DNI de lo cerrado hace más de 360 días y estampa dniPurgedAt", async () => {
    const { retention, store, rows, audit } = build([
      {
        id: 1,
        status: "filed",
        filedAt: new Date(NOW.getTime() - 361 * DAY),
        dismissedAt: null,
        dniPurgedAt: null,
        createdAt: NOW,
      },
      {
        id: 2,
        status: "dismissed",
        filedAt: null,
        dismissedAt: new Date(NOW.getTime() - 400 * DAY),
        dniPurgedAt: null,
        createdAt: NOW,
      },
      {
        id: 3,
        status: "filed",
        filedAt: new Date(NOW.getTime() - 10 * DAY),
        dismissedAt: null,
        dniPurgedAt: null,
        createdAt: NOW,
      },
      {
        id: 4,
        status: "filed",
        filedAt: new Date(NOW.getTime() - 500 * DAY),
        dismissedAt: null,
        dniPurgedAt: NOW,
        createdAt: NOW,
      },
      { id: 5, status: "received", filedAt: null, dismissedAt: null, dniPurgedAt: null, createdAt: NOW },
    ]);
    const s = await retention.purge();
    expect(s).toEqual({ dniPurged: 2, draftsPurged: 0, errors: 0 });
    expect(store.deleteFiles).toHaveBeenCalledWith(1, ["dni_front", "dni_back"]);
    expect(store.deleteFiles).toHaveBeenCalledWith(2, ["dni_front", "dni_back"]);
    expect(store.deleteFiles).toHaveBeenCalledTimes(2);
    expect(rows.find((r) => r.id === 1)?.dniPurgedAt).toEqual(NOW);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "report_retention_purge", detail: s }),
    );
  });

  it("borra los borradores de más de 48 h con su carpeta, y deja los recientes", async () => {
    const { retention, store, rows, db } = build([
      {
        id: 7,
        status: "draft",
        createdAt: new Date(NOW.getTime() - 49 * 60 * 60 * 1000),
        dniPurgedAt: null,
        filedAt: null,
        dismissedAt: null,
      },
      {
        id: 8,
        status: "draft",
        createdAt: new Date(NOW.getTime() - 1 * 60 * 60 * 1000),
        dniPurgedAt: null,
        filedAt: null,
        dismissedAt: null,
      },
    ]);
    const s = await retention.purge();
    expect(s).toEqual({ dniPurged: 0, draftsPurged: 1, errors: 0 });
    expect(store.deleteReportDir).toHaveBeenCalledWith(7);
    expect(db.report.delete).toHaveBeenCalledWith({ where: { id: 7 } });
    expect(rows.map((r) => r.id)).toEqual([8]);
  });

  it("un fallo de disco cuenta como error y no corta la corrida; sin trabajo no audita", async () => {
    const { retention, store, audit } = build([
      {
        id: 1,
        status: "filed",
        filedAt: new Date(NOW.getTime() - 361 * DAY),
        dismissedAt: null,
        dniPurgedAt: null,
        createdAt: NOW,
      },
      {
        id: 2,
        status: "filed",
        filedAt: new Date(NOW.getTime() - 361 * DAY),
        dismissedAt: null,
        dniPurgedAt: null,
        createdAt: NOW,
      },
    ]);
    store.deleteFiles.mockRejectedValueOnce(new Error("EACCES"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await retention.purge()).toEqual({ dniPurged: 1, draftsPurged: 0, errors: 1 });
    log.mockRestore();
    const quiet = build([]);
    expect(await quiet.retention.purge()).toEqual({ dniPurged: 0, draftsPurged: 0, errors: 0 });
    expect(quiet.audit).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledTimes(1);
  });
});
