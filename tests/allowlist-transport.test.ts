import { describe, expect, it, vi } from "vitest";
import { makeAllowlistTransport, parseAllowlist, type MailTransport } from "@/lib/email/transport";

function innerMock(): { transport: MailTransport; send: ReturnType<typeof vi.fn> } {
  const send = vi.fn().mockResolvedValue({ messageId: "mid-1" });
  return { transport: { send }, send };
}

describe("parseAllowlist", () => {
  it("devuelve null sin variable o con string vacío", () => {
    expect(parseAllowlist(undefined)).toBeNull();
    expect(parseAllowlist("")).toBeNull();
    expect(parseAllowlist(" , ,")).toBeNull();
  });
  it("normaliza a minúsculas y recorta espacios", () => {
    const set = parseAllowlist(" A@b.com , c@D.com ");
    expect(set).toEqual(new Set(["a@b.com", "c@d.com"]));
  });
});

describe("makeAllowlistTransport", () => {
  const allow = new Set(["ok@test.com"]);
  it("deja pasar una casilla listada (case-insensitive)", async () => {
    const { transport, send } = innerMock();
    const t = makeAllowlistTransport(transport, allow);
    const res = await t.send({ to: "OK@test.com", subject: "s", text: "t", html: "<p>h</p>" });
    expect(send).toHaveBeenCalledOnce();
    expect(res.messageId).toBe("mid-1");
  });
  it("bloquea una casilla ajena sin llamar al transporte interno", async () => {
    const { transport, send } = innerMock();
    const t = makeAllowlistTransport(transport, allow);
    await expect(t.send({ to: "otro@x.com", subject: "s", text: "t", html: "h" })).rejects.toThrow(
      /restringidos/i,
    );
    expect(send).not.toHaveBeenCalled();
  });
});
