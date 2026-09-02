// Las dos rutas que sirven un archivo de un reporte (spec §8): la del panel
// —con asiento SÓLO para las caras del DNI— y la del socio —su propio reporte;
// ajeno = 404, nunca 403—. Todo lo que las hace seguras es invisible en el
// render y se puede borrar sin que nada más se rompa: la guarda de sesión, el
// `reportId` en el `where` (la pertenencia), el `memberId` del socio, las
// cabeceras defensivas y la CSP que repone `next.config.ts`.
//
// El doble de Prisma NO devuelve una fila fija: HONRA el `where` que recibe
// contra un conjunto de filas de prueba. Es la única forma de que borrar una
// cláusula del filtro real ponga un test en rojo — un fake que sintetiza la
// respuesta deja esa cláusula sin ejercitar y pasa igual (lección del M6).
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  requireMember: vi.fn(),
  findFirst: vi.fn(),
  read: vi.fn(),
  audit: vi.fn(async () => {}),
}));

vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/auth/require-member", () => ({ requireMember: mocks.requireMember }));
vi.mock("@/lib/prisma", () => ({ prisma: { reportFile: { findFirst: mocks.findFirst } } }));
vi.mock("@/lib/reports/storage", () => ({ reportFileStore: { read: mocks.read } }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Map([["x-real-ip", "10.0.0.7"]])) }));

import { GET as adminGet } from "@/app/api/admin/reportes/[id]/archivos/[fileId]/route";
import { GET as memberGet } from "@/app/api/mi/reportes/[id]/archivos/[fileId]/route";
import { REPORT_FILE_CSP } from "@/lib/reports/file-response";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

// `owner` no es una columna: es el `memberId` del reporte padre, y está sólo
// para que el fake pueda resolver `where.report.memberId` como lo haría el join.
type Row = {
  id: number;
  reportId: number;
  kind: string;
  path: string;
  mime: string;
  size: number;
  width: number;
  height: number;
  owner: number | null;
};

// El socio 5 tiene un reporte (14) con una foto y una cara del DNI. El 77 es de
// otro socio y el 88 es anónimo: los dos existen para que "ajeno" se pueda
// pedir de verdad, con un id que está en la base.
const ROWS: Row[] = [
  { id: 3, reportId: 14, kind: "photo", path: "reports/14/a.jpg", mime: "image/jpeg", size: 4, width: 1, height: 1, owner: 5 },
  { id: 9, reportId: 14, kind: "dni_front", path: "reports/14/b.jpg", mime: "image/jpeg", size: 4, width: 1, height: 1, owner: 5 },
  { id: 21, reportId: 77, kind: "photo", path: "reports/77/c.jpg", mime: "image/jpeg", size: 4, width: 1, height: 1, owner: 99 },
  { id: 30, reportId: 88, kind: "photo", path: "reports/88/d.jpg", mime: "image/jpeg", size: 4, width: 1, height: 1, owner: null },
];

type Where = { id?: number; reportId?: number; report?: { memberId?: number } };

/** Aplica el `where` recibido, cláusula por cláusula. Una cláusula ausente no
 *  filtra (igual que Prisma): por eso borrar `reportId` o `report.memberId` del
 *  handler cambia el resultado y el test lo ve. */
function findFirstAgainst(rows: Row[]) {
  return async (args: { where: Where }) => {
    const w = args.where ?? {};
    const row = rows.find(
      (r) =>
        (w.id === undefined || r.id === w.id) &&
        (w.reportId === undefined || r.reportId === w.reportId) &&
        (w.report?.memberId === undefined || r.owner === w.report.memberId),
    );
    if (!row) return null;
    const { owner: _owner, ...file } = row;
    return file;
  };
}

const call = (fn: typeof adminGet, id = "14", fileId = "3") =>
  fn(new Request("http://localhost/x"), { params: Promise.resolve({ id, fileId }) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockResolvedValue({ ok: true, actorId: 7 });
  mocks.requireMember.mockResolvedValue({
    ok: true,
    memberId: 5,
    userId: 1,
    fullName: "Vecina",
    suspension: null,
  });
  mocks.findFirst.mockImplementation(findFirstAgainst(ROWS));
  mocks.read.mockResolvedValue(JPEG);
});

describe("archivo de un reporte — panel", () => {
  it("403 sin admin, sin tocar la base ni el disco", async () => {
    mocks.requireAdmin.mockResolvedValue({ ok: false, reason: "not_admin", error: "Sin permiso." });
    const res = await call(adminGet);
    expect(res.status).toBe(403);
    expect(mocks.findFirst).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("acota al dueño de la URL y sirve con las cabeceras defensivas", async () => {
    const res = await call(adminGet);
    expect(mocks.findFirst).toHaveBeenCalledWith({ where: { id: 3, reportId: 14 } });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    expect(res.headers.get("Cache-Control")).toBe("no-store, private");
    expect(res.headers.get("Vary")).toBe("Cookie");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Security-Policy")).toBe(REPORT_FILE_CSP);
    // Nombre neutro: ids y tipo. Nada del vecino y nada del disco (el `path`
    // trae el uuid y la carpeta de UPLOADS_DIR).
    expect(res.headers.get("Content-Disposition")).toBe(
      'inline; filename="reporte-14-photo-3.jpg"',
    );
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array(JPEG));
  });

  it("una foto NO se audita; el DNI sí, con ids, tipo e IP y nada más", async () => {
    await call(adminGet);
    expect(mocks.audit).not.toHaveBeenCalled();

    const res = await call(adminGet, "14", "9");
    expect(res.status).toBe(200);
    expect(mocks.audit).toHaveBeenCalledWith({
      userId: 7,
      action: "report_dni_view",
      entity: "report_file",
      entityId: 9,
      detail: { reportId: 14, kind: "dni_front" },
      ip: "10.0.0.7",
    });
  });

  it("404 con ids no numéricos, sin llegar a la consulta", async () => {
    expect((await call(adminGet, "abc")).status).toBe(404);
    expect((await call(adminGet, "14", "-1")).status).toBe(404);
    expect((await call(adminGet, "0", "3")).status).toBe(404);
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it("404 cuando el archivo es de OTRO reporte, aunque el id exista", async () => {
    // La fila 21 existe (reporte 77). Pedirla desde la URL del reporte 14 no
    // puede servirla: sin `reportId` en el `where` esto respondería 200 con la
    // foto de otro vecino. Es la guarda de pertenencia.
    const res = await call(adminGet, "14", "21");
    expect(res.status).toBe(404);
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("404 cuando la fila no existe (incluye el DNI ya purgado por retención)", async () => {
    // `retention.purge()` BORRA las filas de las dos caras del DNI, no las
    // marca: el archivo purgado llega acá como una fila inexistente.
    mocks.findFirst.mockImplementation(findFirstAgainst([]));
    const res = await call(adminGet, "14", "9");
    expect(res.status).toBe(404);
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("404 y sin asiento cuando la fila está pero el archivo no, sin filtrar la ruta", async () => {
    mocks.read.mockRejectedValue(new Error("ENOENT: no such file '/var/sigev/uploads/reports/14/b.jpg'"));
    const res = await call(adminGet, "14", "9");
    expect(res.status).toBe(404);
    // Ni la ruta absoluta ni el errno viajan al cliente (Ley 25.326).
    expect(await res.text()).toBe("El archivo no está disponible");
    // No se vio ningún documento: no hay nada que asentar.
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("404 si la fila declara un mime que no es JPEG", async () => {
    // El store re-codifica todo con sharp y escribe siempre image/jpeg. Una
    // fila con otro mime no se sirve etiquetada como JPEG.
    mocks.findFirst.mockImplementation(
      findFirstAgainst(ROWS.map((r) => ({ ...r, mime: "application/pdf" }))),
    );
    expect((await call(adminGet)).status).toBe(404);
    expect(mocks.read).not.toHaveBeenCalled();
  });
});

describe("archivo de un reporte — socio", () => {
  it("403 sin sesión de socio, sin tocar la base", async () => {
    mocks.requireMember.mockResolvedValue({ ok: false, reason: "anonymous", error: "Ingresá." });
    expect((await call(memberGet)).status).toBe(403);
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it("sirve su propio archivo (el suspendido lee) sin auditar", async () => {
    const res = await call(memberGet);
    expect(res.status).toBe(200);
    expect(mocks.requireMember).toHaveBeenCalledWith({ allowSuspended: true });
    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: { id: 3, reportId: 14, report: { memberId: 5 } },
    });
    expect(res.headers.get("Content-Security-Policy")).toBe(REPORT_FILE_CSP);
    expect(res.headers.get("Cache-Control")).toBe("no-store, private");
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("404 —no 403— con el archivo de otro socio y con el de un reporte anónimo", async () => {
    // Las dos filas existen: sin `report: { memberId }` en el `where` esto
    // serviría el archivo de otro vecino. Y el 403 tampoco serviría: confirmaría
    // que ese id existe, que es justo lo que no se puede confirmar.
    const ajeno = await call(memberGet, "77", "21");
    expect(ajeno.status).toBe(404);
    const anonimo = await call(memberGet, "88", "30");
    expect(anonimo.status).toBe(404);
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});

// La guarda REAL de la CSP. Los describes de arriba llaman al handler, así que
// ven la cabecera que el handler EMITE — no la que llega al navegador. Esa la
// decide `headers()` de `next.config.ts`, porque Next copia esas cabeceras con
// `setHeader` (REEMPLAZA). Es exactamente el error que ya se cometió con los
// documentos institucionales: el test en verde y la CSP global llegando igual.
describe("next.config.ts repone la CSP de las dos rutas", () => {
  type Entry = { source: string; headers: Array<{ key: string; value: string }> };

  async function entries(): Promise<Entry[]> {
    // `next.config.ts` exporta una función que recibe la fase: con una fase que
    // no es la del build, la guarda de Turnstile no corre.
    const { default: config } = await import("../next.config");
    return (await config("phase-development-server").headers!()) as Entry[];
  }

  it("las dos entradas existen, con el MISMO valor que exporta el módulo", async () => {
    const all = await entries();
    for (const source of [
      "/api/admin/reportes/:id/archivos/:fileId",
      "/api/mi/reportes/:id/archivos/:fileId",
    ]) {
      const entry = all.find((e) => e.source === source);
      expect(entry, source).toBeDefined();
      expect(entry!.headers.find((h) => h.key === "Content-Security-Policy")?.value).toBe(
        REPORT_FILE_CSP,
      );
    }
  });

  it("van declaradas DESPUÉS de la global: `headers()` pisa por clave en orden", async () => {
    const all = await entries();
    const global = all.find((e) => e.source === "/(.*)")!;
    expect(global).toBeDefined();
    for (const source of [
      "/api/admin/reportes/:id/archivos/:fileId",
      "/api/mi/reportes/:id/archivos/:fileId",
    ]) {
      const entry = all.find((e) => e.source === source)!;
      expect(all.indexOf(entry), source).toBeGreaterThan(all.indexOf(global));
    }
  });

  it("no reabre el framing: sin X-Frame-Options propio, rige el DENY global", async () => {
    const all = await entries();
    for (const source of [
      "/api/admin/reportes/:id/archivos/:fileId",
      "/api/mi/reportes/:id/archivos/:fileId",
    ]) {
      const entry = all.find((e) => e.source === source)!;
      expect(entry.headers.some((h) => h.key === "X-Frame-Options"), source).toBe(false);
      expect(REPORT_FILE_CSP).toContain("frame-ancestors 'none'");
    }
  });
});

// `file-response.ts` es PURO —no tiene un solo import— y esa pureza es lo que
// deja testear las cabeceras sin `.env`: el singleton de `@/lib/prisma` tira al
// EVALUARSE si falta `DATABASE_URL`. Molde: el mismo test de
// `institutional-documents-routes.test.ts`.
describe("file-response.ts se mantiene puro", () => {
  it("no importa nada: ni estático, ni dinámico, ni require", () => {
    const src = readFileSync(
      new URL("../src/lib/reports/file-response.ts", import.meta.url),
      "utf8",
    );
    // Los comentarios NOMBRAN sus importaciones prohibidas (hablan de Prisma y
    // de `next.config.ts`), así que se sacan antes de mirar: si no, el test se
    // cae por lo que el archivo explica y no por lo que hace.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/^\s*import\b/m);
    expect(code).not.toMatch(/^\s*export\b[^;]*\bfrom\b/m);
    expect(code).not.toMatch(/\bimport\s*\(/);
    expect(code).not.toMatch(/\brequire\s*\(/);
    // Y el archivo sigue siendo el que importa: si se vaciara o se renombrara
    // el helper, las cuatro aserciones de arriba pasarían contra la nada.
    expect(code).toMatch(/export function reportFileResponse/);
  });
});
