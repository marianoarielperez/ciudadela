import { describe, expect, it, vi } from "vitest";

// Cada action de /admin/usuarios es un endpoint público (Next-Action): este
// archivo fija que el rechazo de superadmin no escribe, no audita, no manda
// correos y no redirige.
const serviceMock = vi.hoisted(() => ({
  createManagedUser: vi.fn(), updateManagedUser: vi.fn(),
  grantRole: vi.fn(), revokeRole: vi.fn(), setUserActive: vi.fn(),
  resendInvitation: vi.fn(), revokeInvitation: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/users/service", () => ({
  makeUserAdminService: () => serviceMock,
  USER_GUARD_MESSAGES: {},
}));
vi.mock("@/lib/users/invitation", () => ({ sendAdminInvitation: vi.fn() }));
vi.mock("@/lib/auth/require-admin", () => ({
  requireSuperadminUsers: vi.fn(async () => ({
    ok: false,
    reason: "not_admin",
    error: "Solo el superadmin puede gestionar las cuentas y los roles.",
  })),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { redirect } from "next/navigation";
import { audit } from "@/lib/audit";
import { sendAdminInvitation } from "@/lib/users/invitation";
import {
  createUserAction, grantRoleAction, revokeRoleAction, setActiveAction,
  updateUserAction, resendInvitationAction, revokeInvitationAction,
} from "@/app/admin/usuarios/actions";

const ACTIONS: Array<[string, (p: object, f: FormData) => Promise<{ error?: string }>, FormData]> = [
  ["createUserAction", createUserAction, (() => { const f = new FormData(); f.set("name", "X"); f.set("email", "x@x.com"); return f; })()],
  ["updateUserAction", updateUserAction, (() => { const f = new FormData(); f.set("id", "2"); f.set("name", "X"); return f; })()],
  ["grantRoleAction", grantRoleAction, (() => { const f = new FormData(); f.set("id", "2"); f.set("role", "admin"); return f; })()],
  ["revokeRoleAction", revokeRoleAction, (() => { const f = new FormData(); f.set("id", "2"); f.set("role", "admin"); return f; })()],
  ["setActiveAction", setActiveAction, (() => { const f = new FormData(); f.set("id", "2"); f.set("active", "0"); return f; })()],
  ["resendInvitationAction", resendInvitationAction, (() => { const f = new FormData(); f.set("id", "2"); return f; })()],
  ["revokeInvitationAction", revokeInvitationAction, (() => { const f = new FormData(); f.set("id", "2"); return f; })()],
];

describe("actions de /admin/usuarios sin superadmin", () => {
  it.each(ACTIONS)("%s: rechaza sin escribir, auditar, mandar correo ni redirigir", async (_n, action, form) => {
    const result = await action({}, form);
    expect(result.error).toBe("Solo el superadmin puede gestionar las cuentas y los roles.");
    for (const fn of Object.values(serviceMock)) expect(fn).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
    expect(sendAdminInvitation).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });
});
