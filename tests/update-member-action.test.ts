import { beforeEach, describe, expect, it, vi } from "vitest";

// Los dos rechazos de `memberWriter` (la dirección nueva ya es de otra cuenta de
// acceso, o la edición dejaría sin email a una ficha que ya tiene cuenta) no
// escriben nada, y por eso mismo se salían del rastro: la action retornaba antes
// del `audit`. Un intento de mover la identidad de acceso de un socio a la
// casilla de otra cuenta es justo lo que la asociación tiene que poder
// reconstruir después —el padrón es el registro que se presenta ante la IGJ—,
// así que acá se fija que quedan asentados, con el motivo y SIN valores.
//
// La action es "use server" y usa los singletones de producción directo (no
// sigue el patrón `make*(deps)` del resto del módulo), así que se mockean sus
// dependencias módulo por módulo, igual que en tests/send-verification-action.test.ts.
vi.mock("@/lib/prisma", () => ({
  prisma: {
    member: { findUnique: vi.fn() },
    street: { findUnique: vi.fn() },
    actionToken: { deleteMany: vi.fn(async () => ({ count: 0 })) },
  },
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Map([["x-real-ip", "10.0.0.7"]])),
}));

vi.mock("@/lib/auth/require-admin", () => ({
  requireAdmin: vi.fn(async () => ({ ok: true, actorId: 7 })),
}));

vi.mock("@/lib/auth/rate-limiter", () => ({
  verificationMemberLimiter: { allows: vi.fn(() => true), record: vi.fn(), refund: vi.fn() },
  verificationActorLimiter: { allows: vi.fn(() => true), record: vi.fn(), refund: vi.fn() },
}));

vi.mock("@/lib/tokens", () => ({
  hashToken: vi.fn((raw: string) => `hash:${raw}`),
  tokens: { issue: vi.fn(async () => "RAW"), revokeForMember: vi.fn(async () => 0) },
  MEMBER_EMAIL_TOKEN_PURPOSES: ["email_verification", "password_invitation"],
}));

vi.mock("@/lib/email", () => ({ mailer: { sendToMember: vi.fn(async () => ({ messageId: "m" })) } }));

vi.mock("@/lib/email/templates", () => ({
  portalInvite: vi.fn(() => ({ message: { subject: "s", text: "t", html: "<p>t</p>" }, summary: "r" })),
}));

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));

// Del módulo de escritura sólo se stubea el SINGLETON: las clases de error
// tienen que ser las de verdad, si no `instanceof` en la action mediría el
// mock y el test pasaría con la rama rota.
vi.mock("@/lib/members/write", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/members/write")>();
  return { ...actual, memberWriter: { updateMember: vi.fn() } };
});

import { updateMemberAction } from "@/app/admin/socios/carga/[numero]/actions";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import {
  MEMBER_WRITE_ERRORS,
  MemberEmailConflictError,
  MemberEmailRequiredError,
  memberWriter,
} from "@/lib/members/write";

type MockedFn = ReturnType<typeof vi.fn>;

// La ficha guardada, con todos los campos que `buildPatch`/`changedFields` leen.
function stored(over: Record<string, unknown> = {}) {
  return {
    id: 1, status: "active", fullName: "Perez Ana", dni: "20111222", birthDate: null,
    civilStatus: null, nationality: null, occupation: null, phone: null,
    streetId: null, streetText: null, streetNumber: null, neighborhood: null,
    email: "vecino@example.com", emailStatus: "verified", emailVerifiedAt: new Date("2026-01-01T00:00:00Z"),
    userId: 50, ...over,
  };
}

function form(fields: Record<string, string>) {
  const fd = new FormData();
  fd.set("memberId", "1");
  fd.set("fullName", "Perez Ana");
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  (prisma.member.findUnique as MockedFn).mockResolvedValue(stored());
});

describe("updateMemberAction — rechazos de memberWriter", () => {
  // El operador borró el email de una ficha que ya tiene cuenta de acceso.
  it("shows the writer's message and audits the rejection when the card is left without email", async () => {
    (memberWriter.updateMember as MockedFn).mockRejectedValue(new MemberEmailRequiredError());

    // Sin campo email: `parseForm` lo traduce a undefined y `buildPatch` a null.
    const res = await updateMemberAction({}, form({}));

    expect(res).toEqual({ error: MEMBER_WRITE_ERRORS.emailRequired });
    expect(audit).toHaveBeenCalledTimes(1);
    const entry = (audit as MockedFn).mock.calls[0][0];
    expect(entry).toMatchObject({
      userId: 7, action: "member_update_rejected", entity: "member", entityId: 1, ip: "10.0.0.7",
    });
    expect(entry.detail.reason).toBe("email_required");
    // Los nombres de los campos que traía la edición, nunca los valores.
    expect(entry.detail.fields).toContain("email");
    // Y NO se asienta como un cambio efectivo: la transacción volvió atrás.
    expect(entry.action).not.toBe("member_update");
  });

  // La dirección nueva ya es la de otra cuenta de acceso.
  it("audits the collision attempt without leaking the other account holder", async () => {
    (memberWriter.updateMember as MockedFn).mockRejectedValue(new MemberEmailConflictError());

    const res = await updateMemberAction({}, form({ email: "otro.socio@example.com" }));

    expect(res).toEqual({ error: MEMBER_WRITE_ERRORS.emailConflict });
    const entry = (audit as MockedFn).mock.calls[0][0];
    expect(entry.action).toBe("member_update_rejected");
    expect(entry.detail.reason).toBe("email_conflict");
    // Ni la dirección tipeada ni ningún dato del titular de la otra cuenta: el
    // log de auditoría no lleva valores personales (Ley 25.326).
    expect(JSON.stringify(entry.detail)).not.toContain("@");
  });

  it("still audits the successful save as member_update", async () => {
    (memberWriter.updateMember as MockedFn).mockResolvedValue({
      member: stored({ email: "nuevo@example.com" }), revokedTokens: 2, accountEmailUpdated: true,
    });

    const res = await updateMemberAction({}, form({ email: "nuevo@example.com" }));

    expect(res).toEqual({ saved: true });
    const entry = (audit as MockedFn).mock.calls[0][0];
    expect(entry.action).toBe("member_update");
    expect(entry.detail).toMatchObject({ revokedTokens: 2, accountEmailUpdated: true });
  });

  // El P2002 del DNI no es un rechazo del writer y tiene su propio mensaje: no
  // puede caer en la rama nueva ni ensuciar la auditoría con un motivo inventado.
  it("does not audit the duplicated DNI as a writer rejection", async () => {
    (memberWriter.updateMember as MockedFn).mockRejectedValue(
      Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
    );

    const res = await updateMemberAction({}, form({ dni: "30999888" }));

    expect(res).toEqual({ error: "Ya existe otro socio con ese DNI." });
    expect(audit).not.toHaveBeenCalled();
  });
});
