// El store de archivos de un reporte (spec §7-§8): valida forma, re-codifica
// con sharp, escribe en `reports/{id}/{uuid}.jpg`, reemplaza el DNI anterior,
// acota las fotos a dos y sabe borrar por tipo (la purga de retención). Disco
// temporal real; `reportFile` es un doble en memoria que HONRA el `where`.
import { mkdtempSync, existsSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import {
  makeReportFileStore,
  REPORT_FILE_MESSAGES,
  ReportFileError,
  userMessageOf,
} from "@/lib/reports/storage";

// El disco real: sólo este test lo dobla, para que `writeFile` falle una vez.
vi.mock("node:fs/promises", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs/promises")>();
  return { ...real, writeFile: (...args: Parameters<typeof real.writeFile>) => writeFileImpl(...args) };
});
let writeFileImpl: typeof import("node:fs/promises").writeFile;
const { writeFile: realWriteFile } = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
beforeEach(() => {
  writeFileImpl = realWriteFile;
});

type Row = {
  id: number;
  reportId: number;
  kind: string;
  path: string;
  mime: string;
  size: number;
  width: number;
  height: number;
};

function fakeDb() {
  const rows: Row[] = [];
  let nextId = 1;
  // `kind` fuera del `Partial<Row>`: intersectarlo colapsaría el `{ in }` a never.
  const matches = (
    r: Row,
    where: Partial<Omit<Row, "kind">> & { kind?: string | { in: string[] } },
  ) => {
    if (where.id !== undefined && r.id !== where.id) return false;
    if (where.reportId !== undefined && r.reportId !== where.reportId) return false;
    if (where.kind !== undefined) {
      if (typeof where.kind === "string" ? r.kind !== where.kind : !where.kind.in.includes(r.kind))
        return false;
    }
    return true;
  };
  const db = {
    reportFile: {
      create: vi.fn(async ({ data }: { data: Omit<Row, "id"> }) => {
        const row = { id: nextId++, ...data };
        rows.push(row);
        return row;
      }),
      findMany: vi.fn(async ({ where }: { where: Parameters<typeof matches>[1] }) =>
        rows.filter((r) => matches(r, where)),
      ),
      findFirst: vi.fn(
        async ({ where }: { where: Parameters<typeof matches>[1] }) =>
          rows.find((r) => matches(r, where)) ?? null,
      ),
      count: vi.fn(
        async ({ where }: { where: Parameters<typeof matches>[1] }) =>
          rows.filter((r) => matches(r, where)).length,
      ),
      deleteMany: vi.fn(async ({ where }: { where: Parameters<typeof matches>[1] }) => {
        const before = rows.length;
        for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i], where)) rows.splice(i, 1);
        return { count: before - rows.length };
      }),
    },
  };
  return { db, rows };
}

const dirs: string[] = [];
function tmp() {
  const d = mkdtempSync(path.join(os.tmpdir(), "sigev-reports-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const img = (w = 50, h = 40) =>
  sharp({ create: { width: w, height: h, channels: 3, background: "#0079BC" } }).png().toBuffer();

describe("reportFileStore.save", () => {
  it("guarda una foto re-codificada bajo reports/{id}/, con fila y medidas", async () => {
    const root = tmp();
    const { db, rows } = fakeDb();
    const store = makeReportFileStore({ db: db as never, rootDir: root });
    const saved = await store.save({ reportId: 7, kind: "photo", data: await img() });
    expect(saved).toMatchObject({ id: 1, width: 50, height: 40 });
    expect(rows[0]).toMatchObject({ reportId: 7, kind: "photo", mime: "image/jpeg" });
    expect(rows[0].path).toMatch(/^reports\/7\/[0-9a-f-]{36}\.jpg$/);
    expect(existsSync(path.join(root, rows[0].path))).toBe(true);
  });

  it("rechaza vacío, tamaño excedido, formato no imagen e id no entero", async () => {
    const { db } = fakeDb();
    const store = makeReportFileStore({ db: db as never, rootDir: tmp() });
    await expect(
      store.save({ reportId: 7, kind: "photo", data: Buffer.alloc(0) }),
    ).rejects.toThrow(REPORT_FILE_MESSAGES.size);
    await expect(
      store.save({ reportId: 7, kind: "photo", data: Buffer.alloc(10 * 1024 * 1024 + 1) }),
    ).rejects.toThrow(REPORT_FILE_MESSAGES.size);
    await expect(
      store.save({ reportId: 7, kind: "photo", data: Buffer.from("%PDF-1.7") }),
    ).rejects.toThrow(REPORT_FILE_MESSAGES.format);
    await expect(store.save({ reportId: 1.5, kind: "photo", data: await img() })).rejects.toThrow(
      "inválido",
    );
    await expect(store.save({ reportId: -1, kind: "photo", data: await img() })).rejects.toThrow(
      "inválido",
    );
  });

  it("el frente del DNI REEMPLAZA al anterior (fila y archivo); las fotos acumulan hasta dos", async () => {
    const root = tmp();
    const { db, rows } = fakeDb();
    const store = makeReportFileStore({ db: db as never, rootDir: root });
    await store.save({ reportId: 7, kind: "dni_front", data: await img() });
    const firstPath = rows[0].path;
    await store.save({ reportId: 7, kind: "dni_front", data: await img() });
    expect(rows.filter((r) => r.kind === "dni_front")).toHaveLength(1);
    expect(existsSync(path.join(root, firstPath))).toBe(false);

    await store.save({ reportId: 7, kind: "photo", data: await img() });
    await store.save({ reportId: 7, kind: "photo", data: await img() });
    await expect(store.save({ reportId: 7, kind: "photo", data: await img() })).rejects.toThrow(
      REPORT_FILE_MESSAGES.photos,
    );
    expect(rows.filter((r) => r.kind === "photo")).toHaveLength(2);
  });
});

// Los rechazos que decide el store son `ReportFileError` y su texto se le puede
// mostrar al vecino; un error de fs NO lo es, y su `message` trae la ruta
// absoluta (Ley 25.326): `userMessageOf` devuelve el genérico y no la filtra.
describe("ReportFileError y userMessageOf", () => {
  it("los rechazos del store son ReportFileError y llevan su userMessage", async () => {
    const { db } = fakeDb();
    const store = makeReportFileStore({ db: db as never, rootDir: tmp() });
    const e = await store
      .save({ reportId: 7, kind: "photo", data: Buffer.from("%PDF-1.7") })
      .catch((err: unknown) => err);
    expect(e).toBeInstanceOf(ReportFileError);
    expect(userMessageOf(e, "genérico")).toBe(REPORT_FILE_MESSAGES.format);
  });

  it("un fallo crudo de fs se propaga tal cual y NO es ReportFileError", async () => {
    const { db, rows } = fakeDb();
    const store = makeReportFileStore({ db: db as never, rootDir: tmp() });
    writeFileImpl = (async () => {
      throw Object.assign(new Error("EACCES: /var/sigev/uploads/reports/7/x.jpg"), { code: "EACCES" });
    }) as never;
    const e = await store.save({ reportId: 7, kind: "photo", data: await img() }).catch((err: unknown) => err);
    expect(e).toBeInstanceOf(Error);
    expect(e).not.toBeInstanceOf(ReportFileError);
    expect((e as { code?: string }).code).toBe("EACCES");
    // Lo que ve el vecino no lleva la ruta del servidor.
    const shown = userMessageOf(e, "genérico");
    expect(shown).toBe("genérico");
    expect(shown).not.toContain("/var/sigev");
    // Y sin archivo escrito no queda fila.
    expect(rows).toHaveLength(0);
  });
});

describe("remove, read, deleteFiles y deleteReportDir", () => {
  it("remove sólo borra un archivo del MISMO reporte", async () => {
    const root = tmp();
    const { db, rows } = fakeDb();
    const store = makeReportFileStore({ db: db as never, rootDir: root });
    const a = await store.save({ reportId: 7, kind: "photo", data: await img() });
    expect(await store.remove({ reportId: 8, fileId: a.id })).toBe(false);
    expect(rows).toHaveLength(1);
    expect(await store.remove({ reportId: 7, fileId: a.id })).toBe(true);
    expect(rows).toHaveLength(0);
  });

  it("read devuelve los bytes escritos", async () => {
    const root = tmp();
    const { db, rows } = fakeDb();
    const store = makeReportFileStore({ db: db as never, rootDir: root });
    await store.save({ reportId: 7, kind: "photo", data: await img() });
    const bytes = await store.read(rows[0]);
    expect(bytes.length).toBe(rows[0].size);
  });

  it("deleteFiles por tipo borra sólo los DNI y deja las fotos; deleteReportDir vacía la carpeta", async () => {
    const root = tmp();
    const { db, rows } = fakeDb();
    const store = makeReportFileStore({ db: db as never, rootDir: root });
    await store.save({ reportId: 7, kind: "dni_front", data: await img() });
    await store.save({ reportId: 7, kind: "dni_back", data: await img() });
    await store.save({ reportId: 7, kind: "photo", data: await img() });
    expect(await store.deleteFiles(7, ["dni_front", "dni_back"])).toBe(2);
    expect(rows.map((r) => r.kind)).toEqual(["photo"]);
    expect(readdirSync(path.join(root, "reports", "7"))).toHaveLength(1);
    await store.deleteReportDir(7);
    expect(existsSync(path.join(root, "reports", "7"))).toBe(false);
  });
});
