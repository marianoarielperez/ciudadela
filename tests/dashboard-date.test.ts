import { describe, expect, it } from "vitest";

import { formatDashboardDate } from "@/lib/admin/dashboard-date";

describe("formatDashboardDate", () => {
  it("formats the date in es-AR with weekday, capitalized", () => {
    expect(formatDashboardDate(new Date("2026-08-27T15:00:00Z"))).toBe(
      "Jueves 27 de agosto de 2026",
    );
  });

  it("uses the Argentine civil day, not the UTC day, near midnight", () => {
    // 01:30Z of the 28th is 22:30 of the 27th in Argentina (UTC-3, no DST).
    expect(formatDashboardDate(new Date("2026-08-28T01:30:00Z"))).toBe(
      "Jueves 27 de agosto de 2026",
    );
    // 03:00Z of the 28th is 00:00 of the 28th in Argentina.
    expect(formatDashboardDate(new Date("2026-08-28T03:00:00Z"))).toBe(
      "Viernes 28 de agosto de 2026",
    );
  });
});
