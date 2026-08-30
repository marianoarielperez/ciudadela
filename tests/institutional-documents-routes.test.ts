import { existsSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  institutionalDocument: { findUnique: vi.fn() },
}));
// `readFile` es lo único que ejercita esta suite, pero el módulo de carga
// arrastra `storage.ts` (y éste `news/images.ts`), que importan `mkdir`,
// `unlink` y `writeFile`: sin ellos en el doble, el import ESM falla.
const fsMock = vi.hoisted(() => ({
  readFile: vi.fn(),
  mkdir: vi.fn(),
  unlink: vi.fn(),
  writeFile: vi.fn(),
}));
const requireMemberMock = vi.hoisted(() => vi.fn());
const requireAdminMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("node:fs/promises", () => fsMock);
vi.mock("@/lib/auth/require-member", () => ({ requireMember: requireMemberMock }));
vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: requireAdminMock }));

import { GET as memberGet } from "@/app/api/mi/documentos/[id]/route";
import { GET as adminGet } from "@/app/api/admin/documentos/[id]/route";
import { INSTITUTIONAL_DOC_CSP } from "@/lib/institutional-documents/response";
import { institutionalDocsDir } from "@/lib/institutional-documents/storage";

const DOC = {
  id: 7,
  title: "Memoria 2025",
  fileName: "123e4567-e89b-42d3-a456-426614174000.pdf",
};
const PDF = Buffer.from("%PDF-1.7 contenido");
// La fila que existe con el PDF ausente del disco deja un `console.error`: es el
// único rastro (este módulo no audita por vista). Se silencia acá para no
// ensuciar la salida y se verifica abajo, en el caso del archivo faltante.
const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

const props = (id: string) => ({ params: Promise.resolve({ id }) });
const req = () => new Request("http://localhost/api/x");

describe("GET /api/mi/documentos/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireMemberMock.mockResolvedValue({ ok: true, memberId: 1 });
    prismaMock.institutionalDocument.findUnique.mockResolvedValue(DOC);
    fsMock.readFile.mockResolvedValue(PDF);
  });

  it("sirve el PDF con las cabeceras defensivas y el nombre derivado del título", async () => {
    const res = await memberGet(req(), props("7"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toBe('inline; filename="memoria-2025.pdf"');
    expect(res.headers.get("Cache-Control")).toBe("no-store, private");
    // Sexta cabecera del contrato: la respuesta depende de la cookie de sesión.
    // Sin este assert, borrarla del helper dejaba la suite verde (mutación).
    expect(res.headers.get("Vary")).toBe("Cookie");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    // Lo que se verifica acá es lo que EMITE EL HANDLER, no lo que llega al
    // navegador: este test llama a la función, no pasa por el servidor de Next.
    // Next copia las cabeceras de `headers()` de `next.config.ts` con
    // `setHeader`, que REEMPLAZA, así que quien decide la CSP que llega al
    // cliente es `next.config.ts`. Esta aserción sola pasó en verde durante
    // todo el módulo mientras la cabecera real era la CSP global del sitio
    // (medida en el navegador el 30/08/2026); lo que ata la config a estas dos
    // rutas es el describe del final, no ésta.
    expect(res.headers.get("Content-Security-Policy")).toBe(INSTITUTIONAL_DOC_CSP);
    // El cuerpo son los bytes del archivo que se leyó, no uno vacío ni otro.
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("%PDF-1.7 contenido");
    // Y la lectura fue de la ruta del documento PEDIDO: el doble resuelve el
    // mismo Buffer con cualquier argumento, así que sin este assert mutar la
    // ruta a un nombre fijo dejaba la suite en verde.
    expect(fsMock.readFile).toHaveBeenCalledWith(path.join(institutionalDocsDir(), DOC.fileName));
    // El suspendido lee: modo lectura del panel de socio.
    expect(requireMemberMock).toHaveBeenCalledWith({ allowSuspended: true });
  });

  it("403 sin sesión de socio, sin tocar la base", async () => {
    requireMemberMock.mockResolvedValue({ ok: false, reason: "anonymous", error: "Iniciá sesión." });
    const res = await memberGet(req(), props("7"));
    expect(res.status).toBe(403);
    expect(prismaMock.institutionalDocument.findUnique).not.toHaveBeenCalled();
  });

  it("404 con id no numérico, documento inexistente o archivo faltante", async () => {
    expect((await memberGet(req(), props("abc"))).status).toBe(404);
    prismaMock.institutionalDocument.findUnique.mockResolvedValue(null);
    expect((await memberGet(req(), props("99"))).status).toBe(404);
    prismaMock.institutionalDocument.findUnique.mockResolvedValue(DOC);
    fsMock.readFile.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
    expect((await memberGet(req(), props("7"))).status).toBe(404);
    // El 404 es opaco para el cliente —y así tiene que ser—, pero "la fila está
    // y el PDF no" es irrecuperable (el archivo subido es la única copia) y no
    // puede quedar sin rastro. Con el id numérico y el CÓDIGO del error; nunca
    // el fileName ni el `message`, que lleva la ruta absoluta de UPLOADS_DIR.
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining("falta en el disco"),
      7,
      "code:",
      "ENOENT",
    );
    expect(errorLog.mock.calls.flat().join(" ")).not.toContain(DOC.fileName);
  });

  // `Number("999999999999999999999")` es 1e21: `Number.isInteger` lo daba por
  // bueno y el id se colaba al `where` de Prisma, que respondía 500 con su
  // stack. Todo lo que no sea "no hay sesión" responde 404.
  it("404 con un id fuera del rango entero seguro, sin tocar la base", async () => {
    const res = await memberGet(req(), props("999999999999999999999"));
    expect(res.status).toBe(404);
    expect(prismaMock.institutionalDocument.findUnique).not.toHaveBeenCalled();
  });

  it("404 si la fila trae un fileName corrupto (no se toca el filesystem)", async () => {
    prismaMock.institutionalDocument.findUnique.mockResolvedValue({ ...DOC, fileName: "../.env" });
    const res = await memberGet(req(), props("7"));
    expect(res.status).toBe(404);
    expect(fsMock.readFile).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/documentos/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdminMock.mockResolvedValue({ ok: true, actorId: 1 });
    prismaMock.institutionalDocument.findUnique.mockResolvedValue(DOC);
    fsMock.readFile.mockResolvedValue(PDF);
  });

  it("sirve el PDF a un admin", async () => {
    const res = await adminGet(req(), props("7"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    // Las mismas cabeceras defensivas que la ruta del socio: las dos rutas
    // comparten `institutionalDocResponse`, y esto es lo que prueba que la del
    // panel no se arme una respuesta propia y pierda el nosniff o la CSP.
    expect(res.headers.get("Content-Disposition")).toBe('inline; filename="memoria-2025.pdf"');
    expect(res.headers.get("Cache-Control")).toBe("no-store, private");
    expect(res.headers.get("Vary")).toBe("Cookie");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    // Otra vez: esto es lo que emite el handler. Que llegue al cliente lo
    // decide `next.config.ts` (ver el describe del final).
    expect(res.headers.get("Content-Security-Policy")).toBe(INSTITUTIONAL_DOC_CSP);
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("%PDF-1.7 contenido");
  });

  it("404 con id no numérico, documento inexistente o archivo faltante", async () => {
    expect((await adminGet(req(), props("abc"))).status).toBe(404);
    prismaMock.institutionalDocument.findUnique.mockResolvedValue(null);
    expect((await adminGet(req(), props("99"))).status).toBe(404);
    prismaMock.institutionalDocument.findUnique.mockResolvedValue(DOC);
    fsMock.readFile.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
    expect((await adminGet(req(), props("7"))).status).toBe(404);
  });

  it("404 con un id fuera del rango entero seguro, sin tocar la base", async () => {
    const res = await adminGet(req(), props("999999999999999999999"));
    expect(res.status).toBe(404);
    expect(prismaMock.institutionalDocument.findUnique).not.toHaveBeenCalled();
  });

  // La guarda de path traversal es ahora una sola (vive en la carga compartida),
  // pero se ejercita por las dos rutas: lo que se prueba es que la del panel
  // pase por esa carga y no se arme una consulta propia.
  it("404 si la fila trae un fileName corrupto (no se toca el filesystem)", async () => {
    prismaMock.institutionalDocument.findUnique.mockResolvedValue({ ...DOC, fileName: "../.env" });
    const res = await adminGet(req(), props("7"));
    expect(res.status).toBe(404);
    expect(fsMock.readFile).not.toHaveBeenCalled();
  });

  it("403 sin sesión de admin, sin tocar la base", async () => {
    requireAdminMock.mockResolvedValue({ ok: false, reason: "anonymous", error: "Sesión inválida." });
    const res = await adminGet(req(), props("7"));
    expect(res.status).toBe(403);
    expect(prismaMock.institutionalDocument.findUnique).not.toHaveBeenCalled();
  });
});

// La guarda REAL de la CSP. Los dos describes de arriba llaman al handler, así
// que ven lo que el handler devuelve; lo que el navegador recibe lo decide
// `headers()` de `next.config.ts`, porque Next copia esas cabeceras con
// `setHeader` (REEMPLAZA). Entre el 29 y el 30/08/2026 el handler emitía su CSP
// dura, el test estaba en verde y al cliente le llegaba la CSP global del sitio.
// Esto es lo que ata una cosa con la otra.
describe("next.config.ts repone la CSP dura de los documentos institucionales", () => {
  // El `source` no se escribe a mano: se DERIVA del route.ts que existe en el
  // disco. Si alguien mueve o renombra la carpeta de la ruta, la derivación
  // cambia, la entrada de la config deja de encontrarse y este test se cae —
  // que es exactamente el día en que la CSP volvería a perderse en silencio.
  const routeFiles = [
    "src/app/api/mi/documentos/[id]/route.ts",
    "src/app/api/admin/documentos/[id]/route.ts",
  ];
  const sourceOf = (routeFile: string) =>
    "/" +
    routeFile
      .replace(/^src\/app\//, "")
      .replace(/\/route\.ts$/, "")
      .replace(/\[(\w+)\]/g, ":$1");

  it("tiene una entrada por ruta, con el mismo valor que emite el handler", async () => {
    // `next.config.ts` exporta una función que recibe la fase: con una fase que
    // no es la del build no corre la guarda de Turnstile, que exige el .env.
    const { default: config } = await import("../next.config");
    const rules = (await config("phase-development-server").headers!()) as {
      source: string;
      headers: { key: string; value: string }[];
    }[];

    for (const routeFile of routeFiles) {
      // El route.ts del que se deriva el `source` tiene que existir de verdad:
      // sin esto, renombrar la ruta Y la constante de acá dejaría el test verde
      // contra una entrada que no gobierna ninguna ruta.
      expect(existsSync(path.join(import.meta.dirname, "..", routeFile))).toBe(true);
      const source = sourceOf(routeFile);
      const rule = rules.find((r) => r.source === source);
      expect(rule, `falta la entrada de headers() para ${source}`).toBeDefined();
      const csp = rule!.headers.find((h) => h.key === "Content-Security-Policy");
      expect(csp?.value).toBe(INSTITUTIONAL_DOC_CSP);
      // Y NO se toca X-Frame-Options: estas dos rutas no tienen visor embebido,
      // así que el DENY de la entrada global es el que corresponde. Reponerlo
      // como SAMEORIGIN —copiando las entradas de solicitudes y de
      // re-empadronamiento, que sí framean— reabriría el framing sin motivo.
      expect(rule!.headers.some((h) => h.key === "X-Frame-Options")).toBe(false);
    }
  });

  it("la entrada global sigue negando el framing de todo el sitio", async () => {
    const { default: config } = await import("../next.config");
    const rules = (await config("phase-development-server").headers!()) as {
      source: string;
      headers: { key: string; value: string }[];
    }[];
    const global = rules.find((r) => r.source === "/(.*)");
    expect(global?.headers.find((h) => h.key === "X-Frame-Options")?.value).toBe("DENY");
  });
});
