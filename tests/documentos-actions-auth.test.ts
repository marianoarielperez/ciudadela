import { beforeEach, describe, expect, it, vi } from "vitest";

// Una server action no se despacha por su URL sino por el id del encabezado
// `Next-Action` contra un manifiesto global del build, así que ni el proxy
// (matcher `/admin/:path*`) ni el layout del panel corren sobre ella: cada
// action es un endpoint público y el `requireAdmin()` que la abre es el único
// control. Este archivo lo fija, igual que `news-actions-auth.test.ts`.
//
// `vi.hoisted` porque `vi.mock` se iza al tope del archivo: un `const` común
// todavía no existe cuando corre la factory.
const prismaMock = vi.hoisted(() => ({
  institutionalDocument: {
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
    findUnique: vi.fn(),
  },
  $transaction: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth/require-admin", () => ({
  requireAdmin: vi.fn(async () => ({ ok: false, reason: "anonymous", error: "Sesión inválida." })),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

import {
  createDocumentAction,
  deleteDocumentAction,
  updateDocumentAction,
} from "@/app/admin/documentos/actions";
import { audit } from "@/lib/audit";

const form = (entries: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.append(k, v);
  return fd;
};

describe("autorización de las actions de documentos", () => {
  beforeEach(() => vi.clearAllMocks());

  const cases: Array<
    [string, (p: { error?: string }, f: FormData) => Promise<{ error?: string }>, FormData]
  > = [
    ["create", createDocumentAction, form({ type: "norm", title: "x" })],
    ["update", updateDocumentAction, form({ id: "1", type: "norm", title: "x" })],
    ["delete", deleteDocumentAction, form({ id: "1" })],
  ];

  for (const [name, action, fd] of cases) {
    it(`${name}: sin sesión devuelve error y no toca la base`, async () => {
      const result = await action({}, fd);
      expect(result.error).toBe("Sesión inválida.");
      expect(prismaMock.institutionalDocument.create).not.toHaveBeenCalled();
      expect(prismaMock.institutionalDocument.update).not.toHaveBeenCalled();
      expect(prismaMock.institutionalDocument.delete).not.toHaveBeenCalled();
      expect(prismaMock.institutionalDocument.findUnique).not.toHaveBeenCalled();
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
      expect(audit).not.toHaveBeenCalled();
    });
  }
});
