import { describe, expect, it } from "vitest";
import { electoralSentence, electoralStatusFor } from "@/lib/mi/identity";

const at = new Date("2026-08-24T12:00:00Z");
const oldEnough = new Date("2025-01-01T12:00:00Z");
const recent = new Date("2026-08-01T12:00:00Z"); // 23 días al 24/08

const base = { status: "active" as const, joinedAt: oldEnough, arrears: 0, at };

describe("electoralStatusFor", () => {
  it("an old active member without arrears is eligible", () => {
    expect(electoralStatusFor({ ...base, category: "active" })).toEqual({ eligible: true });
  });

  it("a cadet is out by category", () => {
    expect(electoralStatusFor({ ...base, category: "cadet" })).toEqual({
      eligible: false, reason: "category",
    });
  });

  it("a suspended member does not vote (operator decision 23/08)", () => {
    expect(electoralStatusFor({ ...base, category: "active", status: "suspended" })).toEqual({
      eligible: false, reason: "suspended",
    });
  });

  it("a recent member is missing seniority days", () => {
    const s = electoralStatusFor({ ...base, category: "adherent", joinedAt: recent });
    expect(s).toEqual({ eligible: false, reason: "seniority", daysMissing: 67 });
  });

  it("honorary and lifetime skip the seniority floor (REG-30)", () => {
    expect(electoralStatusFor({ ...base, category: "honorary", joinedAt: recent })).toEqual({
      eligible: true,
    });
    expect(electoralStatusFor({ ...base, category: "lifetime", joinedAt: recent })).toEqual({
      eligible: true,
    });
  });

  it("arrears block actives and collaborators only", () => {
    expect(electoralStatusFor({ ...base, category: "active", arrears: 2 })).toEqual({
      eligible: false, reason: "arrears", arrears: 2,
    });
    expect(electoralStatusFor({ ...base, category: "collaborator", arrears: 1 })).toEqual({
      eligible: false, reason: "arrears", arrears: 1,
    });
    // El aporte del adherente es voluntario: su deuda no le quita el voto.
    expect(electoralStatusFor({ ...base, category: "adherent", arrears: 5 })).toEqual({
      eligible: true,
    });
  });
});

describe("electoralSentence", () => {
  it("has a sentence for every state", () => {
    expect(electoralSentence({ eligible: true })).toContain("Habilitado");
    expect(electoralSentence({ eligible: false, reason: "seniority", daysMissing: 10 })).toContain("10");
    expect(electoralSentence({ eligible: false, reason: "arrears", arrears: 3 })).toContain("al día");
    expect(electoralSentence({ eligible: false, reason: "category" })).toContain("categoría");
    expect(electoralSentence({ eligible: false, reason: "suspended" })).toContain("suspensión");
  });
});
