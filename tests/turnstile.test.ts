import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeTurnstileVerifier } from "@/lib/turnstile";

function fetchOk(success: boolean) {
  return vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success }) });
}

describe("makeTurnstileVerifier", () => {
  beforeEach(() => { process.env.TURNSTILE_SECRET_KEY = "sec-1"; });
  afterEach(() => { delete process.env.TURNSTILE_SECRET_KEY; });

  it("aprueba cuando siteverify responde success", async () => {
    const f = fetchOk(true);
    const verify = makeTurnstileVerifier(f as unknown as typeof fetch);
    await expect(verify("tok", "1.2.3.4")).resolves.toBe(true);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(String(init.body)).toContain("response=tok");
    expect(String(init.body)).toContain("remoteip=1.2.3.4");
  });
  it("rechaza con success=false", async () => {
    const verify = makeTurnstileVerifier(fetchOk(false) as unknown as typeof fetch);
    await expect(verify("tok", null)).resolves.toBe(false);
  });
  it("rechaza si siteverify contesta no-ok aunque el body diga success", async () => {
    const f = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ success: true }) });
    const verify = makeTurnstileVerifier(f as unknown as typeof fetch);
    await expect(verify("tok", null)).resolves.toBe(false);
  });
  it("falla CERRADO sin secreto configurado o sin token", async () => {
    delete process.env.TURNSTILE_SECRET_KEY;
    const f = fetchOk(true);
    const verify = makeTurnstileVerifier(f as unknown as typeof fetch);
    await expect(verify("tok", null)).resolves.toBe(false);
    process.env.TURNSTILE_SECRET_KEY = "sec-1";
    await expect(verify("", null)).resolves.toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
  it("rechaza si la red falla", async () => {
    const f = vi.fn().mockRejectedValue(new Error("boom"));
    const verify = makeTurnstileVerifier(f as unknown as typeof fetch);
    await expect(verify("tok", null)).resolves.toBe(false);
  });
});
