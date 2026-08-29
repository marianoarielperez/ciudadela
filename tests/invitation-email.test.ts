import { describe, expect, it, vi } from "vitest";

// El módulo liga su singleton con `prisma` y `mailer` al evaluarse: se mockean
// los dos para que el import no arrastre ni la base ni el transporte (misma
// técnica que tests/application-verify.test.ts).
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
// `failureCode` SÍ es el real: el módulo lo usa para decidir qué loguear y qué
// callar, y un doble propio probaría la copia del test en vez de la función.
// El resto del módulo (el singleton `mailer`) se reemplaza igual que antes.
vi.mock("@/lib/email", async () => {
  const actual = await vi.importActual<typeof import("@/lib/email")>("@/lib/email");
  return { failureCode: actual.failureCode, mailer: { sendToMember: vi.fn() } };
});

import { ALLOWLIST_BLOCK_CODE } from "@/lib/email/transport";
import { makeInvitationEmailer } from "@/lib/members/invitation-email";

const MEMBER = { email: "vecina@example.com", fullName: "Vecina Ejemplo", emailStatus: "verified" };

// La forma del argumento se declara acá y el doble se tipa con ella: un
// `vi.fn(async () => …)` sin firma tipa `mock.calls` como tupla VACÍA y
// `npx tsc --noEmit` rechaza el índice 0 (el repo está en cero errores).
type SendToMember = (input: {
  memberId: number; to: string; type: string;
  message: { text: string; html: string }; summary: string;
}) => Promise<{ messageId: string }>;

function makeDeps(member: unknown = MEMBER) {
  return {
    // El argumento queda a la vista para poder afirmar sobre el `select`: esta
    // consulta corre sobre una ficha y no puede traerse más de lo que necesita.
    db: { member: { findUnique: vi.fn(async (_args?: { where: unknown; select: unknown }) => member) } },
    mail: { sendToMember: vi.fn<SendToMember>(async () => ({ messageId: "x" })) },
  };
}

describe("invitationEmailer.sendAfterVerification (la red del §7.1)", () => {
  it("manda la invitación a la casilla de la ficha con el MISMO token del redirect", async () => {
    const deps = makeDeps();
    await makeInvitationEmailer(deps as never).sendAfterVerification(7, "RAW-INVITE");

    // La lectura es la ficha que se pidió y sólo los tres campos que se usan:
    // escrito como igualdad de forma para que agregar cualquier otro dato a esta
    // consulta —que alimenta un correo— ponga el test en rojo.
    expect(deps.db.member.findUnique).toHaveBeenCalledWith({
      where: { id: 7 },
      select: { email: true, fullName: true, emailStatus: true },
    });
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

  it("no manda nada si la dirección de la ficha NO está verificada", async () => {
    // El correo saluda por nombre, y eso sólo vale hacia una casilla que su
    // titular confirmó. Los dos llamadores escriben `verified` en la misma
    // transacción; la guarda vuelve estructural lo que hoy depende de quién
    // llame, en vez de confiar en el call-site.
    const declarada = makeDeps({ ...MEMBER, emailStatus: "declared" });
    await makeInvitationEmailer(declarada as never).sendAfterVerification(7, "RAW");
    expect(declarada.mail.sendToMember).not.toHaveBeenCalled();
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

  it("un bloqueo por EMAIL_ALLOWLIST no se loguea como error: es el entorno andando", async () => {
    // El transporte ya avisó con su propio `console.warn` y el mailer tampoco
    // escribe una fila `failed`. Un `console.error` acá pintaría de rojo cada
    // envío del piloto —donde la allowlist está puesta— y enseñaría a ignorar
    // el log, que es donde vive el fallo de verdad.
    const deps = makeDeps();
    deps.mail.sendToMember = vi.fn<SendToMember>(async () => {
      throw Object.assign(new Error("bloqueado"), { code: ALLOWLIST_BLOCK_CODE });
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(
        makeInvitationEmailer(deps as never).sendAfterVerification(7, "RAW"),
      ).resolves.toBeUndefined();
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
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
