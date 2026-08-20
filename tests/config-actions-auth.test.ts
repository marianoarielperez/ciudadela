import { describe, expect, it, vi } from "vitest";

// La guarda de la pantalla de Configuración.
//
// `updateConfigAction` es un endpoint HTTP público: Next despacha las server
// actions por el id del encabezado `Next-Action` contra un manifiesto global del
// build, así que la pantalla de bloqueo de `page.tsx` no protege NADA — esconde
// el formulario y nada más. Un admin común con sesión válida puede armar el POST
// a mano. Lo único que lo frena es el `requireSuperadmin()` de la action, y este
// archivo fija que ese rechazo no escriba, no audite y no invalide caché.
//
// `vi.hoisted` porque `vi.mock` se iza al tope del archivo y el mock de prisma es
// un `const` de este módulo.
const prismaMock = vi.hoisted(() => ({
  configuration: { findUnique: vi.fn(async () => null), upsert: vi.fn(async () => ({})) },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth/require-admin", () => ({
  requireSuperadmin: vi.fn(async () => ({
    ok: false,
    reason: "not_admin",
    error: "Solo el superadmin puede cambiar la configuración.",
  })),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ updateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { audit } from "@/lib/audit";
import { updateConfigAction } from "@/app/admin/configuracion/actions";

describe("updateConfigAction sin superadmin", () => {
  it("un admin común no puede tocar la configuración", async () => {
    const form = new FormData();
    form.append("asociateActivo", "on");
    const result = await updateConfigAction({}, form);
    expect(result.error).toBe("Solo el superadmin puede cambiar la configuración.");
    expect(prismaMock.configuration.upsert).not.toHaveBeenCalled();
  });

  it("el rechazo corta antes de leer, auditar, invalidar la caché o redirigir", async () => {
    await updateConfigAction({}, new FormData());
    // Ni siquiera consulta: el rechazo es lo primero que pasa.
    expect(prismaMock.configuration.findUnique).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
    expect(updateTag).not.toHaveBeenCalled();
    // Sin redirect el formulario se queda en pantalla y muestra el motivo, que es
    // lo que espera `useActionState`.
    expect(redirect).not.toHaveBeenCalled();
  });
});
