import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MP_SIGNATURE_TOLERANCE_MS, validateMpSignature } from "@/lib/mp/signature";

const SECRET = "test-secret";

function sign(dataId: string, requestId: string, tsSeconds: number): string {
  const manifest = `id:${dataId};request-id:${requestId};ts:${tsSeconds};`;
  const v1 = createHmac("sha256", SECRET).update(manifest).digest("hex");
  return `ts=${tsSeconds},v1=${v1}`;
}

describe("validateMpSignature", () => {
  const now = 1_755_700_000_000; // ms
  const ts = Math.floor(now / 1000);

  it("acepta una firma válida dentro de la tolerancia", () => {
    expect(
      validateMpSignature({
        xSignature: sign("12345", "req-1", ts),
        xRequestId: "req-1",
        dataId: "12345",
        secret: SECRET,
        nowMs: now,
      }),
    ).toBe(true);
  });
  it("rechaza v1 adulterada, request-id cambiado y data.id cambiado", () => {
    const sig = sign("12345", "req-1", ts);
    expect(validateMpSignature({ xSignature: sig.replace(/.$/, "0"), xRequestId: "req-1", dataId: "12345", secret: SECRET, nowMs: now })).toBe(false);
    expect(validateMpSignature({ xSignature: sig, xRequestId: "req-2", dataId: "12345", secret: SECRET, nowMs: now })).toBe(false);
    expect(validateMpSignature({ xSignature: sig, xRequestId: "req-1", dataId: "99999", secret: SECRET, nowMs: now })).toBe(false);
  });
  it("rechaza headers ausentes y ts fuera de tolerancia", () => {
    expect(validateMpSignature({ xSignature: null, xRequestId: "r", dataId: "1", secret: SECRET, nowMs: now })).toBe(false);
    expect(validateMpSignature({ xSignature: sign("1", "r", ts), xRequestId: null, dataId: "1", secret: SECRET, nowMs: now })).toBe(false);
    const old = ts - Math.ceil(MP_SIGNATURE_TOLERANCE_MS / 1000) - 10;
    expect(validateMpSignature({ xSignature: sign("1", "r", old), xRequestId: "r", dataId: "1", secret: SECRET, nowMs: now })).toBe(false);
  });
});
