import { describe, expect, it } from "vitest";
import type {
  MemberCategory,
  MemberStatus,
  PresentationStatus,
  ReregistrationStatus,
} from "@/generated/prisma/client";
import { civilDateUtc } from "@/lib/dates";
import {
  APPEAL_DAYS,
  appealUntil,
  canPrepareClose,
  canStartSecond,
  FIRST_INSTANCE_DAYS,
  firstEndsAt,
  isCohortMember,
  lookupVerdict,
  maskedName,
  SECOND_INSTANCE_DAYS,
  secondEndsAt,
  wizardOpen,
} from "@/lib/reregistration/rules";

const d = civilDateUtc;

describe("plazos del Art. 9° bis — DÍAS CORRIDOS", () => {
  it("fixes the three terms at 30 / 10 / 30", () => {
    expect(FIRST_INSTANCE_DAYS).toBe(30);
    expect(SECOND_INSTANCE_DAYS).toBe(10);
    expect(APPEAL_DAYS).toBe(30);
  });

  it("crosses a month", () => {
    // 02/10 + 30 corridos = 01/11 (octubre tiene 31 días).
    expect(firstEndsAt(d(2026, 10, 2))).toEqual(d(2026, 11, 1));
  });

  it("crosses a year", () => {
    expect(firstEndsAt(d(2026, 12, 15))).toEqual(d(2027, 1, 14));
    expect(appealUntil(d(2026, 12, 25))).toEqual(d(2027, 1, 24));
  });

  it("crosses February in a common year and in a leap year", () => {
    // 2026 no es bisiesto: 30/01 + 30 = 01/03. 2028 sí: cae el 29/02.
    expect(firstEndsAt(d(2026, 1, 30))).toEqual(d(2026, 3, 1));
    expect(firstEndsAt(d(2028, 1, 30))).toEqual(d(2028, 2, 29));
  });

  it("counts calendar days, holidays and weekends included", () => {
    // Del jueves 24/12/2026 salen 30 corridos exactos: 23/01/2027. Adentro hay
    // Navidad, Año Nuevo y cuatro fines de semana, y ninguno corre el plazo.
    expect(appealUntil(d(2026, 12, 24))).toEqual(d(2027, 1, 23));
  });

  it("adds ten days to the second instance", () => {
    expect(secondEndsAt(d(2026, 11, 1))).toEqual(d(2026, 11, 11));
    expect(secondEndsAt(d(2026, 12, 28))).toEqual(d(2027, 1, 7));
  });

  it("resolves the start by the ARGENTINE civil day, not by the UTC clock", () => {
    // 23:30 del 02/10 en Argentina ya es el 03/10 en UTC: un plazo legal no
    // puede empezar un día después porque el acta se cargó de noche.
    expect(firstEndsAt(new Date("2026-10-02T23:30:00-03:00"))).toEqual(d(2026, 11, 1));
    expect(firstEndsAt(new Date("2026-10-02T00:30:00-03:00"))).toEqual(d(2026, 11, 1));
  });
});

describe("isCohortMember — adherentes vigentes al activar (decisión 12)", () => {
  const cases: Array<[MemberCategory, MemberStatus, boolean]> = [
    ["adherent", "active", true],
    ["adherent", "suspended", true], // decisión 12: los suspendidos participan
    ["adherent", "withdrawn", false],
    ["active", "active", false],
    ["collaborator", "active", false],
    ["cadet", "active", false],
    ["honorary", "active", false],
    ["lifetime", "suspended", false],
  ];

  for (const [category, status, expected] of cases) {
    it(`${category} + ${status} → ${expected}`, () => {
      expect(isCohortMember({ category, status })).toBe(expected);
    });
  }
});

describe("maskedName — confirmar sin revelar", () => {
  it("masks the padrón format (Apellido Nombre)", () => {
    expect(maskedName("Castillo Nestor")).toBe("N***** C.");
  });

  it("keeps every given name and only the surname initial", () => {
    // REGLA FIJADA: la PRIMERA palabra es el apellido y viaja como inicial +
    // punto; todas las demás son nombres, y cada uno conserva su inicial.
    expect(maskedName("Perez Gomez Maria Ana")).toBe("G**** M**** A** P.");
  });

  it("returns only the initial when there is a single word", () => {
    expect(maskedName("Castillo")).toBe("C.");
  });

  it("handles ñ and accents as one character each", () => {
    expect(maskedName("Coñuecar Eduardo")).toBe("E****** C.");
    expect(maskedName("Perez Begoña")).toBe("B***** P.");
    expect(maskedName("Ávila Juan")).toBe("J*** Á.");
    expect(maskedName("Pérez José María")).toBe("J*** M**** P.");
  });

  it("handles a decomposed ñ (NFD) the same as a composed one", () => {
    // "Bego\u00f1a" en NFD son SIETE code points en vez de seis (la \u00f1 viaja como
    // "n" + tilde combinante): contarlos crudos delatar\u00eda una letra de m\u00e1s.
    const nfd = "Perez Begon\u0303a";
    expect(nfd.length).toBe(13); // "Perez Bego\u00f1a" compuesto mide 12
    expect(maskedName(nfd)).toBe("B***** P.");
  });

  it("uppercases the initials whatever the padrón casing is", () => {
    expect(maskedName("castillo nestor")).toBe("N***** C.");
    expect(maskedName("CASTILLO NESTOR")).toBe("N***** C.");
  });

  it("collapses stray whitespace", () => {
    expect(maskedName("  Castillo   Nestor  ")).toBe("N***** C.");
  });

  it("leaves a one-letter given name bare", () => {
    expect(maskedName("Perez A")).toBe("A P.");
  });

  it("returns an empty string for an empty name", () => {
    expect(maskedName("")).toBe("");
    expect(maskedName("   ")).toBe("");
  });
});

describe("lookupVerdict — paso 1 del wizard", () => {
  const member = {
    id: 42,
    fullName: "Castillo Nestor",
    category: "adherent" as MemberCategory,
    status: "active" as MemberStatus,
  };
  const withStatus = (status: PresentationStatus) => ({ status });

  it("eligible when the cohort row is pending", () => {
    expect(lookupVerdict({ member, presentation: withStatus("pending") })).toEqual({
      kind: "eligible",
      memberId: 42,
      maskedName: "N***** C.",
    });
  });

  it("eligible when the cohort row is observed (subsanación)", () => {
    expect(lookupVerdict({ member, presentation: withStatus("observed") })).toEqual({
      kind: "eligible",
      memberId: 42,
      maskedName: "N***** C.",
    });
  });

  it("already_submitted when the presentation is submitted", () => {
    expect(lookupVerdict({ member, presentation: withStatus("submitted") })).toEqual({
      kind: "already_submitted",
    });
  });

  it("already_submitted when the presentation is validated", () => {
    expect(lookupVerdict({ member, presentation: withStatus("validated") })).toEqual({
      kind: "already_submitted",
    });
  });

  it("not_found when the presentation was rejected", () => {
    expect(lookupVerdict({ member, presentation: withStatus("rejected") })).toEqual({
      kind: "not_found",
    });
  });

  it("not_found when the presentation ended in a declared withdrawal", () => {
    expect(lookupVerdict({ member, presentation: withStatus("withdrawn") })).toEqual({
      kind: "not_found",
    });
  });

  it("not_found when the DNI matches no member", () => {
    expect(lookupVerdict({ member: null, presentation: null })).toEqual({ kind: "not_found" });
  });

  it("not_found when the member is not in the cohort category", () => {
    const activeMember = { ...member, category: "active" as MemberCategory };
    expect(lookupVerdict({ member: activeMember, presentation: withStatus("pending") })).toEqual({
      kind: "not_found",
    });
  });

  it("not_found when the member was withdrawn", () => {
    const gone = { ...member, status: "withdrawn" as MemberStatus };
    expect(lookupVerdict({ member: gone, presentation: withStatus("pending") })).toEqual({
      kind: "not_found",
    });
  });

  it("not_found when the member exists but was never called (no cohort row)", () => {
    expect(lookupVerdict({ member, presentation: null })).toEqual({ kind: "not_found" });
  });

  it("never leaks WHY in the negative verdict", () => {
    // El cartel es genérico a propósito: los seis caminos negativos devuelven
    // exactamente la misma forma, sin motivo ni id.
    const negatives = [
      lookupVerdict({ member: null, presentation: null }),
      lookupVerdict({ member, presentation: null }),
      lookupVerdict({ member, presentation: withStatus("rejected") }),
      lookupVerdict({ member, presentation: withStatus("withdrawn") }),
      lookupVerdict({
        member: { ...member, category: "active" as MemberCategory },
        presentation: withStatus("pending"),
      }),
      lookupVerdict({
        member: { ...member, status: "withdrawn" as MemberStatus },
        presentation: withStatus("pending"),
      }),
    ];
    for (const verdict of negatives) {
      expect(Object.keys(verdict)).toEqual(["kind"]);
      expect(verdict.kind).toBe("not_found");
    }
  });
});

describe("transiciones del proceso", () => {
  const ALL: ReregistrationStatus[] = [
    "preparing",
    "first_instance",
    "second_instance",
    "closing",
    "closed",
  ];

  it("canStartSecond only from first_instance", () => {
    for (const status of ALL) {
      expect(canStartSecond({ status })).toBe(status === "first_instance");
    }
  });

  it("canPrepareClose only from second_instance, and only once it expired", () => {
    const now = new Date("2026-11-20T10:00:00-03:00");
    for (const status of ALL) {
      expect(canPrepareClose({ status, secondEndsAt: d(2026, 11, 11) }, now)).toBe(
        status === "second_instance",
      );
    }
  });

  it("canPrepareClose refuses while the second instance is still running", () => {
    const now = new Date("2026-11-10T10:00:00-03:00");
    const p = { status: "second_instance" as ReregistrationStatus, secondEndsAt: d(2026, 11, 11) };
    expect(canPrepareClose(p, now)).toBe(false);
  });

  it("canPrepareClose refuses ON the deadline day: the member still has it", () => {
    const noon = new Date("2026-11-11T12:00:00-03:00");
    const lateNight = new Date("2026-11-11T23:50:00-03:00");
    const p = { status: "second_instance" as ReregistrationStatus, secondEndsAt: d(2026, 11, 11) };
    expect(canPrepareClose(p, noon)).toBe(false);
    // 23:50 del 11/11 argentino ya es el 12 en UTC: el día lo decide el
    // calendario de acá, o el plazo se le cortaría al vecino unas horas antes.
    expect(canPrepareClose(p, lateNight)).toBe(false);
  });

  it("canPrepareClose refuses without a second deadline recorded", () => {
    const now = new Date("2026-11-20T10:00:00-03:00");
    expect(canPrepareClose({ status: "second_instance", secondEndsAt: null }, now)).toBe(false);
  });

  it("wizardOpen during both instances and never outside them", () => {
    for (const status of ALL) {
      expect(wizardOpen({ status })).toBe(
        status === "first_instance" || status === "second_instance",
      );
    }
  });

  it("wizardOpen is false when there is no process at all", () => {
    expect(wizardOpen(null)).toBe(false);
  });
});
