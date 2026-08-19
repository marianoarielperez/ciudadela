import { beforeEach, describe, expect, it, vi } from "vitest";

// Comportamiento de las actions del ABM de noticias con el admin YA autorizado
// (la guarda en sí la fija `news-actions-auth.test.ts`).
//
// Lo que más importa acá es la PERSISTENCIA sanitizada: `sanitizeNewsBody` es
// una frontera de seguridad porque el cuerpo se renderiza después con
// `dangerouslySetInnerHTML` sin volver a limpiarlo. Que la función exista y esté
// testeada (`news-sanitize.test.ts`) no prueba que la action la use: eso se
// prueba mirando qué argumento le llega a `prisma.news.create/update`.
//
// `vi.hoisted` porque `vi.mock` se iza al tope del archivo: un `const` común
// todavía no existe cuando corre la factory.
const prismaMock = vi.hoisted(() => ({
  news: {
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    findUnique: vi.fn(),
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth/require-admin", () => ({
  requireAdmin: vi.fn(async () => ({ ok: true, actorId: 7 })),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-real-ip": "10.0.0.9" }),
}));
vi.mock("next/cache", () => ({ updateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
// El módulo de imágenes toca el disco: acá interesa el CONTRATO con la action
// (guardar, limpiar el huérfano, borrar la anterior), no el fs.
vi.mock("@/lib/news/images", () => ({
  saveNewsCover: vi.fn(async () => ({ ok: true, fileName: "nueva.jpg" })),
  deleteNewsCover: vi.fn(async () => {}),
}));

import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import {
  createNewsAction,
  deleteNewsAction,
  publishNewsAction,
  unpublishNewsAction,
  updateNewsAction,
} from "@/app/admin/noticias/actions";
import { audit } from "@/lib/audit";
import { deleteNewsCover, saveNewsCover } from "@/lib/news/images";
import { sanitizeNewsBody } from "@/lib/news/sanitize";
import { newsBodyByteLength, newsFormSchema } from "@/lib/news/schema";

type MockedFn = ReturnType<typeof vi.fn>;

const form = (entries: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.append(k, v);
  return fd;
};

const stored = (over: Record<string, unknown> = {}) => ({
  id: 5,
  title: "Asamblea",
  slug: "asamblea",
  body: "<p>vieja</p>",
  coverImagePath: null,
  status: "draft",
  publishedAt: null,
  ...over,
});

// Lo que efectivamente se manda a la base en el create/update.
const createdData = () => prismaMock.news.create.mock.calls[0][0].data as Record<string, unknown>;
const updatedData = () => prismaMock.news.update.mock.calls[0][0].data as Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.news.create.mockResolvedValue({ id: 11 });
  prismaMock.news.update.mockResolvedValue({});
  prismaMock.news.delete.mockResolvedValue({});
  prismaMock.news.findUnique.mockResolvedValue(stored());
  (saveNewsCover as MockedFn).mockResolvedValue({ ok: true, fileName: "nueva.jpg" });
  // clearAllMocks limpia las llamadas pero NO las implementaciones: sin esto un
  // mockRejectedValue de un test se filtra a los siguientes.
  (deleteNewsCover as MockedFn).mockResolvedValue(undefined);
});

describe("persistencia sanitizada (frontera de seguridad)", () => {
  const HOSTILE =
    '<p>Hola</p><script>alert(1)</script><img src=x onerror="alert(1)">' +
    '<a href="javascript:alert(1)" onclick="alert(1)">click</a>';

  it("createNewsAction: lo que llega a prisma.news.create ya está limpio", async () => {
    await createNewsAction({}, form({ title: "Asamblea", body: HOSTILE }));

    expect(prismaMock.news.create).toHaveBeenCalledTimes(1);
    const body = createdData().body as string;
    expect(body).toContain("<p>Hola</p>");
    expect(body).not.toContain("<script");
    expect(body).not.toContain("alert(1)");
    expect(body).not.toContain("onerror");
    expect(body).not.toContain("onclick");
    expect(body).not.toContain("javascript:");
    expect(body).not.toContain("<img");
  });

  it("updateNewsAction: lo que llega a prisma.news.update ya está limpio", async () => {
    await updateNewsAction({}, form({ id: "5", title: "Asamblea", body: HOSTILE }));

    expect(prismaMock.news.update).toHaveBeenCalledTimes(1);
    const body = updatedData().body as string;
    expect(body).toContain("<p>Hola</p>");
    expect(body).not.toContain("<script");
    expect(body).not.toContain("onerror");
    expect(body).not.toContain("javascript:");
  });

  it("un cuerpo que después de limpiarlo queda vacío no se guarda", async () => {
    const res = await createNewsAction({}, form({ title: "x", body: "<script>alert(1)</script>" }));

    expect(res).toEqual({ error: "Escribí el contenido de la noticia." });
    expect(prismaMock.news.create).not.toHaveBeenCalled();
  });

  it("los links externos conservan el rel que evita window.opener", async () => {
    await createNewsAction(
      {},
      form({ title: "x", body: '<p><a href="https://x.test">ir</a></p>' }),
    );

    expect(createdData().body).toContain('rel="noopener noreferrer"');
  });
});

describe("createNewsAction", () => {
  it("deriva el slug del título, atribuye el autor, audita con la IP e invalida el caché", async () => {
    await createNewsAction({}, form({ title: "Asamblea Anual 2026", body: "<p>x</p>" }));

    expect(createdData()).toMatchObject({
      title: "Asamblea Anual 2026",
      slug: "asamblea-anual-2026",
      authorId: 7,
      coverImagePath: null,
    });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 7,
        action: "news_create",
        entity: "news",
        entityId: 11,
        ip: "10.0.0.9",
      }),
    );
    expect(updateTag).toHaveBeenCalledWith("news");
    expect(redirect).toHaveBeenCalledWith("/admin/noticias/11");
  });

  it("respeta el slug que escribió el operador", async () => {
    await createNewsAction({}, form({ title: "Asamblea", body: "<p>x</p>", slug: "convocatoria" }));

    expect(createdData().slug).toBe("convocatoria");
  });

  it("traduce el choque de slug único a castellano y no redirige", async () => {
    prismaMock.news.create.mockRejectedValue(Object.assign(new Error("boom"), { code: "P2002" }));

    const res = await createNewsAction({}, form({ title: "Asamblea", body: "<p>x</p>" }));

    expect(res).toEqual({ error: "Ya existe una noticia con esa URL. Cambiá el campo URL." });
    expect(redirect).not.toHaveBeenCalled();
    expect(updateTag).not.toHaveBeenCalled();
  });

  it("no deja la portada huérfana en disco si el INSERT falla", async () => {
    prismaMock.news.create.mockRejectedValue(Object.assign(new Error("boom"), { code: "P2002" }));
    const fd = form({ title: "Asamblea", body: "<p>x</p>" });
    fd.set("cover", new File([new Uint8Array([1, 2, 3])], "p.jpg", { type: "image/jpeg" }));

    await createNewsAction({}, fd);

    expect(deleteNewsCover).toHaveBeenCalledWith("nueva.jpg");
  });

  it("corta con el mensaje del validador de imagen sin tocar la base", async () => {
    (saveNewsCover as MockedFn).mockResolvedValue({ ok: false, error: "La imagen no puede superar los 5 MB." });
    const fd = form({ title: "Asamblea", body: "<p>x</p>" });
    fd.set("cover", new File([new Uint8Array([1, 2, 3])], "p.jpg", { type: "image/jpeg" }));

    const res = await createNewsAction({}, fd);

    expect(res).toEqual({ error: "La imagen no puede superar los 5 MB." });
    expect(prismaMock.news.create).not.toHaveBeenCalled();
  });

  it("un input de archivo vacío no cuenta como portada", async () => {
    const fd = form({ title: "Asamblea", body: "<p>x</p>" });
    fd.set("cover", new File([], "", { type: "application/octet-stream" }));

    await createNewsAction({}, fd);

    expect(saveNewsCover).not.toHaveBeenCalled();
    expect(createdData().coverImagePath).toBeNull();
  });

  it("rechaza un cuerpo que desbordaría la columna TEXT antes de llegar al driver", async () => {
    const res = await createNewsAction({}, form({ title: "x", body: "á".repeat(40_000) }));

    expect(res.error).toBe("El contenido es demasiado largo para guardarlo: recortalo.");
    expect(prismaMock.news.create).not.toHaveBeenCalled();
  });

  // El schema mide el cuerpo CRUDO, pero lo que se guarda es el SANITIZADO, que
  // puede ser más grande: cada `&` se escapa a `&amp;` (1 byte → 5). Este cuerpo
  // pasa las dos guardas del schema con 24.007 bytes y llegaría al driver con
  // 72.007, por encima de los 65.535 de la columna TEXT.
  it("rechaza un cuerpo que recién desborda DESPUÉS de sanitizar", async () => {
    const body = `<p>${"& ".repeat(12_000)}</p>`;
    expect(newsBodyByteLength(body)).toBe(24_007);
    expect(newsBodyByteLength(sanitizeNewsBody(body))).toBe(72_007);
    expect(newsFormSchema.safeParse({ title: "x", body }).success).toBe(true);

    const res = await createNewsAction({}, form({ title: "x", body }));

    expect(res.error).toBe("El contenido es demasiado largo para guardarlo: recortalo.");
    expect(prismaMock.news.create).not.toHaveBeenCalled();
  });
});

describe("updateNewsAction", () => {
  it("avisa cuando la noticia ya no existe", async () => {
    prismaMock.news.findUnique.mockResolvedValue(null);

    const res = await updateNewsAction({}, form({ id: "5", title: "x", body: "<p>x</p>" }));

    expect(res).toEqual({ error: "La noticia no existe." });
    expect(prismaMock.news.update).not.toHaveBeenCalled();
  });

  it("rechaza un id inválido con mensaje en castellano", async () => {
    const res = await updateNewsAction({}, form({ id: "0", title: "x", body: "<p>x</p>" }));

    expect(res).toEqual({ error: "Noticia inválida." });
    expect(prismaMock.news.findUnique).not.toHaveBeenCalled();
  });

  it("borra la portada anterior recién DESPUÉS de que el UPDATE salió bien", async () => {
    prismaMock.news.findUnique.mockResolvedValue(stored({ coverImagePath: "vieja.jpg" }));
    const fd = form({ id: "5", title: "x", body: "<p>x</p>" });
    fd.set("cover", new File([new Uint8Array([1, 2, 3])], "p.jpg", { type: "image/jpeg" }));

    await updateNewsAction({}, fd);

    expect(updatedData().coverImagePath).toBe("nueva.jpg");
    expect(deleteNewsCover).toHaveBeenCalledWith("vieja.jpg");
  });

  it("si el UPDATE falla borra la NUEVA portada y deja la anterior en su lugar", async () => {
    prismaMock.news.findUnique.mockResolvedValue(stored({ coverImagePath: "vieja.jpg" }));
    prismaMock.news.update.mockRejectedValue(Object.assign(new Error("boom"), { code: "P2002" }));
    const fd = form({ id: "5", title: "x", body: "<p>x</p>" });
    fd.set("cover", new File([new Uint8Array([1, 2, 3])], "p.jpg", { type: "image/jpeg" }));

    const res = await updateNewsAction({}, fd);

    expect(res).toEqual({ error: "Ya existe una noticia con esa URL. Cambiá el campo URL." });
    expect(deleteNewsCover).toHaveBeenCalledWith("nueva.jpg");
    expect(deleteNewsCover).not.toHaveBeenCalledWith("vieja.jpg");
  });

  it("el checkbox removeCover saca la portada y borra el archivo", async () => {
    prismaMock.news.findUnique.mockResolvedValue(stored({ coverImagePath: "vieja.jpg" }));

    await updateNewsAction({}, form({ id: "5", title: "x", body: "<p>x</p>", removeCover: "on" }));

    expect(updatedData().coverImagePath).toBeNull();
    expect(deleteNewsCover).toHaveBeenCalledWith("vieja.jpg");
  });

  it("sin imagen nueva ni removeCover la portada queda como estaba", async () => {
    prismaMock.news.findUnique.mockResolvedValue(stored({ coverImagePath: "vieja.jpg" }));

    await updateNewsAction({}, form({ id: "5", title: "x", body: "<p>x</p>" }));

    expect(updatedData().coverImagePath).toBe("vieja.jpg");
    expect(deleteNewsCover).not.toHaveBeenCalled();
  });

  it("audita, invalida el caché y vuelve a la ficha", async () => {
    await updateNewsAction({}, form({ id: "5", title: "Nuevo", body: "<p>x</p>" }));

    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 7,
        action: "news_update",
        entity: "news",
        entityId: 5,
        ip: "10.0.0.9",
      }),
    );
    expect(updateTag).toHaveBeenCalledWith("news");
    expect(redirect).toHaveBeenCalledWith("/admin/noticias/5");
  });

  it("audita el UPDATE ANTES de borrar la portada anterior", async () => {
    prismaMock.news.findUnique.mockResolvedValue(stored({ coverImagePath: "vieja.jpg" }));

    await updateNewsAction({}, form({ id: "5", title: "x", body: "<p>x</p>", removeCover: "on" }));

    const auditedAt = (audit as MockedFn).mock.invocationCallOrder[0];
    const deletedAt = (deleteNewsCover as MockedFn).mock.invocationCallOrder[0];
    expect(auditedAt).toBeLessThan(deletedAt);
  });

  // El archivo huérfano es basura benigna en disco; perder la navegación (y
  // dejar el panel con datos viejos) no lo es.
  it("un fallo al borrar la portada anterior no rompe el caché ni la navegación", async () => {
    prismaMock.news.findUnique.mockResolvedValue(stored({ coverImagePath: "vieja.jpg" }));
    (deleteNewsCover as MockedFn).mockRejectedValue(
      Object.assign(new Error("EACCES"), { code: "EACCES" }),
    );

    const fd = form({ id: "5", title: "x", body: "<p>x</p>", removeCover: "on" });
    await expect(updateNewsAction({}, fd)).resolves.toBeUndefined();

    expect(updateTag).toHaveBeenCalledWith("news");
    expect(redirect).toHaveBeenCalledWith("/admin/noticias/5");
  });

  it("rechaza un cuerpo que recién desborda DESPUÉS de sanitizar", async () => {
    const body = `<p>${"& ".repeat(12_000)}</p>`;

    const res = await updateNewsAction({}, form({ id: "5", title: "x", body }));

    expect(res.error).toBe("El contenido es demasiado largo para guardarlo: recortalo.");
    expect(prismaMock.news.update).not.toHaveBeenCalled();
  });
});

describe("publishNewsAction", () => {
  it("publica un borrador y le fija la fecha", async () => {
    await publishNewsAction({}, form({ id: "5" }));

    const data = updatedData();
    expect(data.status).toBe("published");
    expect(data.publishedAt).toBeInstanceOf(Date);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "news_publish", entityId: 5, ip: "10.0.0.9" }),
    );
    expect(updateTag).toHaveBeenCalledWith("news");
  });

  // La fecha es la que ve el vecino y la que ordena la cartelera: republicar no
  // puede mandar una nota vieja al tope.
  it("no pisa la fecha original al re-publicar", async () => {
    const original = new Date("2026-01-02T03:04:05.000Z");
    prismaMock.news.findUnique.mockResolvedValue(stored({ status: "draft", publishedAt: original }));

    await publishNewsAction({}, form({ id: "5" }));

    expect(updatedData().publishedAt).toBe(original);
  });

  it("rechaza publicar lo ya publicado", async () => {
    prismaMock.news.findUnique.mockResolvedValue(stored({ status: "published" }));

    const res = await publishNewsAction({}, form({ id: "5" }));

    expect(res).toEqual({ error: "La noticia ya está publicada." });
    expect(prismaMock.news.update).not.toHaveBeenCalled();
    expect(updateTag).not.toHaveBeenCalled();
  });
});

describe("unpublishNewsAction", () => {
  it("vuelve la noticia a borrador y audita", async () => {
    prismaMock.news.findUnique.mockResolvedValue(stored({ status: "published" }));

    await unpublishNewsAction({}, form({ id: "5" }));

    expect(prismaMock.news.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { status: "draft" },
    });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "news_unpublish", entityId: 5 }),
    );
    expect(updateTag).toHaveBeenCalledWith("news");
  });

  it("rechaza despublicar un borrador", async () => {
    const res = await unpublishNewsAction({}, form({ id: "5" }));

    expect(res).toEqual({ error: "La noticia no está publicada." });
    expect(prismaMock.news.update).not.toHaveBeenCalled();
  });
});

// Una server action es un endpoint público: el id mal formado es tráfico
// esperable, no un caso de laboratorio. Sin mensajes propios zod devuelve
// "Invalid input: expected number, received NaN" y eso se muestra tal cual.
describe("id inválido", () => {
  it.each([
    ["ausente", {} as Record<string, string>],
    ["no numérico", { id: "abc" }],
    ["decimal", { id: "1.5" }],
  ])("%s: responde en castellano sin tocar la base", async (_caso, entries) => {
    const res = await publishNewsAction({}, form(entries));

    expect(res).toEqual({ error: "Noticia inválida." });
    expect(prismaMock.news.findUnique).not.toHaveBeenCalled();
  });
});

describe("deleteNewsAction", () => {
  it("borra la fila, después el archivo, audita el estado que tenía y vuelve al listado", async () => {
    prismaMock.news.findUnique.mockResolvedValue(
      stored({ status: "published", coverImagePath: "vieja.jpg" }),
    );

    await deleteNewsAction({}, form({ id: "5" }));

    expect(prismaMock.news.delete).toHaveBeenCalledWith({ where: { id: 5 } });
    expect(deleteNewsCover).toHaveBeenCalledWith("vieja.jpg");
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "news_delete",
        entityId: 5,
        detail: { title: "Asamblea", slug: "asamblea", status: "published" },
        ip: "10.0.0.9",
      }),
    );
    expect(updateTag).toHaveBeenCalledWith("news");
    expect(redirect).toHaveBeenCalledWith("/admin/noticias");
  });

  it("avisa en vez de romperse si la noticia ya no está", async () => {
    prismaMock.news.findUnique.mockResolvedValue(null);

    const res = await deleteNewsAction({}, form({ id: "5" }));

    expect(res).toEqual({ error: "La noticia no existe." });
    expect(prismaMock.news.delete).not.toHaveBeenCalled();
  });

  // El asiento va primero: `deleteNewsCover` propaga todo lo que no sea ENOENT,
  // y con la fila ya borrada un EACCES dejaría la acción sin rastro.
  it("audita ANTES de tocar el disco", async () => {
    prismaMock.news.findUnique.mockResolvedValue(stored({ coverImagePath: "vieja.jpg" }));

    await deleteNewsAction({}, form({ id: "5" }));

    const auditedAt = (audit as MockedFn).mock.invocationCallOrder[0];
    const deletedAt = (deleteNewsCover as MockedFn).mock.invocationCallOrder[0];
    expect(auditedAt).toBeLessThan(deletedAt);
  });

  it("un fallo de filesystem no tumba el borrado ya auditado", async () => {
    prismaMock.news.findUnique.mockResolvedValue(stored({ coverImagePath: "vieja.jpg" }));
    (deleteNewsCover as MockedFn).mockRejectedValue(
      Object.assign(new Error("EACCES"), { code: "EACCES" }),
    );

    await expect(deleteNewsAction({}, form({ id: "5" }))).resolves.toBeUndefined();

    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "news_delete" }));
    expect(updateTag).toHaveBeenCalledWith("news");
    expect(redirect).toHaveBeenCalledWith("/admin/noticias");
  });
});
