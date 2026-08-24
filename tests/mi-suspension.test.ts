import { describe, expect, it } from "vitest";
import { suspensionNotice } from "@/lib/mi/suspension";

describe("suspensionNotice", () => {
  const from = new Date("2026-08-01T12:00:00Z");
  const to = new Date("2026-09-30T12:00:00Z");

  it("names both dates when it has them", () => {
    const text = suspensionNotice({ from, to });
    expect(text).toContain("del 01/08/2026 al 30/09/2026");
    expect(text).toContain("Art. 10");
    expect(text).toContain("pagar");
  });

  it("handles an open-ended suspension", () => {
    expect(suspensionNotice({ from, to: null })).toContain("desde el 01/08/2026");
    expect(suspensionNotice({ from: null, to })).toContain("hasta el 30/09/2026");
  });

  it("works without dates at all", () => {
    const text = suspensionNotice({ from: null, to: null });
    expect(text).toContain("suspendida");
    expect(text).not.toContain("del ");
  });
});
