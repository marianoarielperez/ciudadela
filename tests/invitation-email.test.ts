import { describe, expect, it, vi } from "vitest";

// El módulo liga su singleton con `prisma` y `mailer` al evaluarse: se mockean
// los dos para que el import no arrastre ni la base ni el transporte (misma
// técnica que tests/application-verify.test.ts).
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/email", () => ({ mailer: { sendToMember: vi.fn() } }));

import { makeInvitationEmailer } from "@/lib/members/invitation-email";

const MEMBER = { email: "vecina@example.com", fullName: "Vecina Ejemplo" };

// La forma del argumento se declara acá y el doble se tipa con ella: un
// `vi.fn(async () => …)` sin firma tipa `mock.calls` como tupla VACÍA y
// `npx tsc --noEmit` rechaza el índice 0 (el repo está en cero errores).
type SendToMember = (input: {
  memberId: number; to: string; type: string;
  message: { text: string; html: string }; summary: string;
}) => Promise<{ messageId: string }>;

function makeDeps(member: unknown = MEMBER) {
  return {
    db: { member: { findUnique: vi.fn(async () => member) } },
    mail: { sendToMember: vi.fn<SendToMember>(async () => ({ messageId: "x" })) },
  };
}

describe("invitationEmailer.sendAfterVerification (la red del §7.1)", () => {
  it("manda la invitación a la casilla de la ficha con el MISMO token del redirect", async () => {
    const deps = makeDeps();
    await makeInvitationEmailer(deps as never).sendAfterVerification(7, "RAW-INVITE");

    expect(deps.mail.sendToMember).toHaveBeenCalledTimes(1);
    const call = deps.mail.sendToMember.mock.calls[0][0];
    expect(call.memberId).toBe(7);
    expect(call.to).toBe("vecina@example.com");
    // El tipo del asiento de Notification es el mismo que usa el reenvío del
    // panel: la ficha lista los dos envíos igual.
    expect(call.type).toBe("password_invitation");
    // Un solo token, el del redirect: si acá apareciera otro, el segundo
    // habría revocado al primero y roto el redirect.
    expect(call.message.text).toContain("/acceso/RAW-INVITE");
    expect(call.message.html).toContain("/acceso/RAW-INVITE");
  });

  it("no manda nada si la ficha quedó sin email (o desapareció)", async () => {
    const sinEmail = makeDeps({ email: null, fullName: "X" });
    await makeInvitationEmailer(sinEmail as never).sendAfterVerification(7, "RAW");
    expect(sinEmail.mail.sendToMember).not.toHaveBeenCalled();

    const sinFicha = makeDeps(null);
    await makeInvitationEmailer(sinFicha as never).sendAfterVerification(7, "RAW");
    expect(sinFicha.mail.sendToMember).not.toHaveBeenCalled();
  });

  it("NUNCA rechaza: un fallo del mailer no puede romper el redirect", async () => {
    const deps = makeDeps();
    deps.mail.sendToMember = vi.fn<SendToMember>(async () => {
      throw Object.assign(new Error("smtp caído"), { code: "ECONN" });
    });
    await expect(
      makeInvitationEmailer(deps as never).sendAfterVerification(7, "RAW"),
    ).resolves.toBeUndefined();
  });

  it("tampoco rechaza si la LECTURA de la ficha falla", async () => {
    const deps = makeDeps();
    deps.db.member.findUnique = vi.fn(async () => {
      throw new Error("db caída");
    });
    await expect(
      makeInvitationEmailer(deps as never).sendAfterVerification(7, "RAW"),
    ).resolves.toBeUndefined();
    expect(deps.mail.sendToMember).not.toHaveBeenCalled();
  });
});
