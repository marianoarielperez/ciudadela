import { beforeEach, describe, expect, it, vi } from "vitest";

// La guarda de las actions del calendario. Va en su propio archivo porque el
// mock de `requireAdmin` es el opuesto al del test de comportamiento: acá NO hay
// admin y lo único que se prueba es que ninguna action toque la base.
//
// No es ceremonia: una server action no se despacha por su URL sino por el id
// del encabezado `Next-Action` contra un manifiesto global, así que el proxy
// (matcher `/admin/:path*`) y el layout de /admin no la protegen. Ver el
// encabezado de `@/lib/auth/require-admin`.
//
// `vi.hoisted` porque `vi.mock` se iza al tope del archivo: un `const` común
// todavía no existe cuando corre la factory.
const prismaMock = vi.hoisted(() => ({
  activity: {
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(async () => []),
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth/require-admin", () => ({
  requireAdmin: vi.fn(async () => ({ ok: false, reason: "anonymous", error: "Sesión inválida." })),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ updateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

import { updateTag } from "next/cache";
import { audit } from "@/lib/audit";
import {
  createActivityAction,
  deleteActivityAction,
  updateActivityAction,
} from "@/app/admin/actividades/actions";

const form = (entries: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.append(k, v);
  return fd;
};

const full = { name: "Taekwondo niños", room: "glass", startTime: "18:00", endTime: "19:30", year: "2026" };

describe("autorización de las actions de actividades", () => {
  beforeEach(() => vi.clearAllMocks());

  const cases = [
    ["create", createActivityAction, form(full)],
    ["update", updateActivityAction, form({ id: "1", ...full })],
    ["delete", deleteActivityAction, form({ id: "1" })],
  ] as const;

  for (const [name, action, fd] of cases) {
    it(`${name}: sin sesión devuelve error y no toca la base`, async () => {
      const result = await action({}, fd);
      expect(result.error).toBe("Sesión inválida.");
      expect(prismaMock.activity.create).not.toHaveBeenCalled();
      expect(prismaMock.activity.update).not.toHaveBeenCalled();
      expect(prismaMock.activity.delete).not.toHaveBeenCalled();
      // Ni siquiera lee: `requireAdmin` es la PRIMERA operación de cada action,
      // antes de parsear el formulario o buscar la fila.
      expect(prismaMock.activity.findUnique).not.toHaveBeenCalled();
      expect(prismaMock.activity.findMany).not.toHaveBeenCalled();
    });

    it(`${name}: sin sesión tampoco audita ni invalida la caché pública`, async () => {
      await action({}, fd);
      expect(audit).not.toHaveBeenCalled();
      expect(updateTag).not.toHaveBeenCalled();
    });
  }
});
