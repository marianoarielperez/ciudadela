import { beforeEach, describe, expect, it, vi } from "vitest";

// Cableado de `recoverAction` (src/app/(public)/ingresar/recuperar/actions.ts).
// La action es "use server" y usa los singletones de producción directo, así que
// se mockean sus dependencias módulo por módulo, igual que
// tests/send-verification-action.test.ts.
//
// Lo que se ejercita acá es lo que ningún test de librería puede ver: que la
// respuesta al visitante sea IDÉNTICA exista o no la cuenta, que el enlace que
// viaja en el correo apunte a la ruta que lo sabe canjear, y que un SMTP caído
// no deje un enlace vivo que nadie recibió.

// El trabajo contra la cuenta va dentro de `after()` para que el tiempo de
// respuesta no delate si la dirección estaba registrada. El mock guarda las
// callbacks y el test las corre a mano.
const afterCalls: Promise<unknown>[] = [];
vi.mock("next/server", () => ({
  after: (fn: () => unknown) => {
    afterCalls.push(Promise.resolve(fn()));
  },
}));
async function flushAfter() {
  await Promise.all(afterCalls);
}

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Map([["x-real-ip", "203.0.113.7"]])),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { actionToken: { deleteMany: vi.fn(async () => ({ count: 1 })) } },
}));

vi.mock("@/lib/auth/password-reset", () => ({
  passwordReset: { request: vi.fn() },
}));

vi.mock("@/lib/auth/rate-limiter", () => ({
  passwordResetIpLimiter: { allows: vi.fn(() => true), record: vi.fn(), refund: vi.fn() },
  passwordResetEmailLimiter: { allows: vi.fn(() => true), record: vi.fn(), refund: vi.fn() },
}));

vi.mock("@/lib/email/transport", () => ({
  getTransport: vi.fn(() => ({ send: sendMock })),
}));

vi.mock("@/lib/tokens", () => ({ hashToken: (raw: string) => `hash:${raw}` }));

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));

type SentMail = { to: string; subject: string; text: string; html: string };
const sendMock = vi.fn(async (msg: SentMail) => ({ messageId: `mid:${msg.to}` as string | null }));

import { recoverAction } from "@/app/(public)/ingresar/recuperar/actions";
import { audit } from "@/lib/audit";
import { passwordReset } from "@/lib/auth/password-reset";
import { passwordResetEmailLimiter, passwordResetIpLimiter } from "@/lib/auth/rate-limiter";
import { prisma } from "@/lib/prisma";

type MockedFn = ReturnType<typeof vi.fn>;

function formDataFor(email: string) {
  const fd = new FormData();
  fd.set("email", email);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  afterCalls.length = 0;
  sendMock.mockResolvedValue({ messageId: "mid-1" });
  (passwordResetIpLimiter.allows as MockedFn).mockReturnValue(true);
  (passwordResetEmailLimiter.allows as MockedFn).mockReturnValue(true);
  process.env.AUTH_URL = "https://sigev.example.ar";
});

describe("recoverAction", () => {
  it("answers exactly the same for a registered address and for an unknown one", async () => {
    (passwordReset.request as MockedFn).mockResolvedValueOnce({ userId: 7, token: "RAW" });
    const conCuenta = await recoverAction({}, formDataFor("vecino@example.com"));

    (passwordReset.request as MockedFn).mockResolvedValueOnce(null);
    const sinCuenta = await recoverAction({}, formDataFor("nadie@example.com"));

    expect(conCuenta).toEqual({ done: true });
    expect(sinCuenta).toEqual(conCuenta);
  });

  it("sends the link to the account's address, pointing at the route that redeems it", async () => {
    (passwordReset.request as MockedFn).mockResolvedValueOnce({ userId: 7, token: "RAW" });
    await recoverAction({}, formDataFor("Vecino@Example.com"));
    await flushAfter();

    expect(sendMock).toHaveBeenCalledTimes(1);
    const msg = sendMock.mock.calls[0]![0];
    // Normalizada: el login busca la cuenta en minúsculas.
    expect(msg.to).toBe("vecino@example.com");
    // La URL tiene que ser la de /ingresar/restablecer/<token>: mandarla cruzada
    // (a /acceso, por ejemplo) le da al socio un enlace muerto.
    expect(msg.text).toContain("https://sigev.example.ar/ingresar/restablecer/RAW");
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 7, action: "password_reset_requested" }),
    );
  });

  it("sends nothing when there is no enabled account with that address", async () => {
    (passwordReset.request as MockedFn).mockResolvedValueOnce(null);
    const res = await recoverAction({}, formDataFor("nadie@example.com"));
    await flushAfter();

    expect(res).toEqual({ done: true });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("does not make the visitor wait for the mail server", async () => {
    // El envío queda agendado en `after()`: si se hiciera en línea, el tiempo de
    // respuesta separaría la dirección registrada de la que no lo está.
    let release = () => {};
    sendMock.mockImplementationOnce(
      () => new Promise((resolve) => { release = () => resolve({ messageId: "mid-1" }); }),
    );
    (passwordReset.request as MockedFn).mockResolvedValueOnce({ userId: 7, token: "RAW" });

    const res = await recoverAction({}, formDataFor("vecino@example.com"));
    expect(res).toEqual({ done: true });
    release();
    await flushAfter();
  });

  it("rejects a malformed address before spending any quota", async () => {
    const res = await recoverAction({}, formDataFor("esto-no-es-un-email"));
    expect(res.error).toBeTruthy();
    expect(res.done).toBeUndefined();
    expect(passwordResetIpLimiter.record).not.toHaveBeenCalled();
    expect(passwordReset.request).not.toHaveBeenCalled();
  });

  it("blocks and issues nothing when the origin ran out of quota", async () => {
    (passwordResetIpLimiter.allows as MockedFn).mockReturnValue(false);
    const res = await recoverAction({}, formDataFor("vecino@example.com"));
    await flushAfter();

    expect(res.error).toBeTruthy();
    expect(passwordReset.request).not.toHaveBeenCalled();
    // Cupo reservado en los DOS o en ninguno: sin esto, el rechazo del segundo
    // limitador se cobraría igual el intento del primero.
    expect(passwordResetEmailLimiter.record).not.toHaveBeenCalled();
    expect(passwordResetIpLimiter.record).not.toHaveBeenCalled();
  });

  it("blocks and issues nothing when that address ran out of quota", async () => {
    (passwordResetEmailLimiter.allows as MockedFn).mockReturnValue(false);
    const res = await recoverAction({}, formDataFor("vecino@example.com"));
    await flushAfter();

    expect(res.error).toBeTruthy();
    expect(passwordReset.request).not.toHaveBeenCalled();
    expect(passwordResetIpLimiter.record).not.toHaveBeenCalled();
  });

  it("counts the attempt by normalized address, not by what was typed", async () => {
    (passwordReset.request as MockedFn).mockResolvedValueOnce({ userId: 7, token: "RAW" });
    await recoverAction({}, formDataFor("  Vecino@Example.com "));
    // Si la clave fuera el texto crudo, alcanzaría con alternar mayúsculas para
    // saltarse el techo por casilla y seguir inundando el buzón del socio.
    expect(passwordResetEmailLimiter.allows).toHaveBeenCalledWith("vecino@example.com");
    expect(passwordResetEmailLimiter.record).toHaveBeenCalledWith("vecino@example.com");
  });

  it("burns the link and gives the quota back when the mail server fails", async () => {
    (passwordReset.request as MockedFn).mockResolvedValueOnce({ userId: 7, token: "RAW" });
    sendMock.mockRejectedValueOnce(Object.assign(new Error("smtp down"), { code: "ECONNREFUSED" }));

    const res = await recoverAction({}, formDataFor("vecino@example.com"));
    await flushAfter();

    // La respuesta al visitante no cambia: no puede aprender nada del SMTP.
    expect(res).toEqual({ done: true });
    // Un enlace de recupero vivo que nadie recibió es superficie de ataque sin
    // contrapartida.
    expect(prisma.actionToken.deleteMany).toHaveBeenCalledWith({ where: { tokenHash: "hash:RAW" } });
    expect(passwordResetIpLimiter.refund).toHaveBeenCalledWith("203.0.113.7");
    expect(passwordResetEmailLimiter.refund).toHaveBeenCalledWith("vecino@example.com");
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "password_reset_send_failed", detail: { code: "ECONNREFUSED" } }),
    );
    expect(audit).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "password_reset_requested" }),
    );
  });
});
