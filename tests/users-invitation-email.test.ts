import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { adminInvitationEmail } from "@/lib/email/templates";
import { ALLOWLIST_BLOCK_CODE } from "@/lib/email/transport";
import { makeSendAdminInvitation, type SendAdminInvitationDeps } from "@/lib/users/invitation";

// El doble se tipa con la firma real del mailer: sin esto `send.mock.calls[0][0]`
// es un elemento de una tupla vacía y `tsc` lo rechaza.
type SendArg = Parameters<SendAdminInvitationDeps["send"]>[0];

describe("adminInvitationEmail", () => {
  it("lleva el enlace en texto y html, y NO saluda por nombre", () => {
    const r = adminInvitationEmail({ url: "https://x/acceso/tok" });
    expect(r.text).toContain("https://x/acceso/tok");
    expect(r.html).toContain("https://x/acceso/tok");
    expect(r.text).not.toMatch(/^Hola /);
    expect(r.subject).toContain("Vecinal Ciudadela");
  });
});

describe("sendAdminInvitation", () => {
  it("arma la URL /acceso/{token} y reporta sent", async () => {
    const send = vi.fn<(input: SendArg) => Promise<{ messageId: string }>>(
      async () => ({ messageId: "m1" }),
    );
    const sender = makeSendAdminInvitation({ send, baseUrl: () => "https://x" });
    const res = await sender({ to: "a@b.com", token: "tok" });
    expect(res).toEqual({ sent: true, blocked: false });
    const arg = send.mock.calls[0][0];
    expect(arg.to).toBe("a@b.com");
    expect(arg.memberId).toBeNull();
    expect(arg.type).toBe("generic");
    expect(arg.message.text).toContain("https://x/acceso/tok");
  });

  it("distingue el bloqueo de allowlist de un fallo real", async () => {
    const blockedErr = Object.assign(new Error("blocked"), { code: ALLOWLIST_BLOCK_CODE });
    const sender = makeSendAdminInvitation({
      send: vi.fn(async () => { throw blockedErr; }), baseUrl: () => "https://x",
    });
    expect(await sender({ to: "a@b.com", token: "t" })).toEqual({ sent: false, blocked: true });
    const failing = makeSendAdminInvitation({
      send: vi.fn(async () => { throw new Error("smtp down"); }), baseUrl: () => "https://x",
    });
    expect(await failing({ to: "a@b.com", token: "t" })).toEqual({ sent: false, blocked: false });
  });
});
