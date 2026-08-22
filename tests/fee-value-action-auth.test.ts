import { describe, expect, it, vi } from "vitest";

// Misma guarda, misma pantalla: `createFeeValueAction` comparte el módulo
// "use server" de Configuración, así que también es un endpoint despachado por
// el id del encabezado `Next-Action`. Acá lo que se protege es el valor de la
// cuota —la única fuente de montos del sistema— y el rechazo tiene que cortar
// ANTES de insertar la fila, de auditar y de redirigir.
const prismaMock = vi.hoisted(() => ({
  feeValue: { create: vi.fn(async () => ({ id: 1 })) },
  minute: { findUnique: vi.fn(async () => null) },
  configuration: { findUnique: vi.fn(async () => null), upsert: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth/require-admin", () => ({
  requireSuperadmin: vi.fn(async () => ({
    ok: false, reason: "not_admin", error: "Solo el superadmin puede cambiar la configuración.",
  })),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ updateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { redirect } from "next/navigation";
import { audit } from "@/lib/audit";
import { createFeeValueAction } from "@/app/admin/configuracion/actions";

describe("createFeeValueAction sin superadmin", () => {
  it("rechaza sin escribir, auditar ni redirigir", async () => {
    const form = new FormData();
    form.append("activeAmount", "6000");
    form.append("sharedAmount", "3000");
    form.append("validFrom", "2026-09-01");
    const result = await createFeeValueAction({}, form);
    expect(result.error).toBe("Solo el superadmin puede cambiar la configuración.");
    expect(prismaMock.feeValue.create).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });
});
