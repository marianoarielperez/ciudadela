import { beforeEach, describe, expect, it, vi } from "vitest";

// Una server action no se despacha por su URL sino por el id del encabezado
// `Next-Action` contra un manifiesto global, así que el proxy (matcher
// `/admin/:path*`) y el layout del panel NO la protegen: cada action es un
// endpoint público y el `requireAdmin()` que la abre es el único control. Este
// archivo lo fija — es el gap que señaló la revisión del M1.
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
  requireAdmin: vi.fn(async () => ({ ok: false, reason: "anonymous", error: "Sesión inválida." })),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ updateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

import { updateTag } from "next/cache";
import {
  createNewsAction,
  deleteNewsAction,
  publishNewsAction,
  unpublishNewsAction,
  updateNewsAction,
} from "@/app/admin/noticias/actions";
import { audit } from "@/lib/audit";

const form = (entries: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.append(k, v);
  return fd;
};

describe("autorización de las actions de noticias", () => {
  beforeEach(() => vi.clearAllMocks());

  const cases: Array<
    [string, (p: { error?: string }, f: FormData) => Promise<{ error?: string }>, FormData]
  > = [
    ["create", createNewsAction, form({ title: "x", body: "<p>x</p>" })],
    ["update", updateNewsAction, form({ id: "1", title: "x", body: "<p>x</p>" })],
    ["publish", publishNewsAction, form({ id: "1" })],
    ["unpublish", unpublishNewsAction, form({ id: "1" })],
    ["delete", deleteNewsAction, form({ id: "1" })],
  ];

  for (const [name, action, fd] of cases) {
    it(`${name}: sin sesión devuelve error y no toca la base`, async () => {
      const result = await action({}, fd);
      expect(result.error).toBe("Sesión inválida.");
      expect(prismaMock.news.create).not.toHaveBeenCalled();
      expect(prismaMock.news.update).not.toHaveBeenCalled();
      expect(prismaMock.news.delete).not.toHaveBeenCalled();
      // Ni siquiera se lee: un anónimo no tiene por qué enterarse de si la
      // noticia existe.
      expect(prismaMock.news.findUnique).not.toHaveBeenCalled();
      expect(audit).not.toHaveBeenCalled();
      expect(updateTag).not.toHaveBeenCalled();
    });
  }
});
