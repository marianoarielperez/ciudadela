import { describe, expect, it } from "vitest";
import { currentWeekdayAR } from "@/lib/dates";

describe("currentWeekdayAR", () => {
  it("devuelve el día de la semana argentino, no el del reloj UTC", () => {
    // 2026-08-24 fue lunes en AR; a las 23:30 AR el reloj UTC ya está en el martes 25.
    expect(currentWeekdayAR(new Date("2026-08-25T02:30:00Z"))).toBe(1);
  });
  it("lunes=1 … domingo=7", () => {
    expect(currentWeekdayAR(new Date("2026-08-29T15:00:00Z"))).toBe(6); // sábado
    expect(currentWeekdayAR(new Date("2026-08-30T15:00:00Z"))).toBe(7); // domingo
  });
});
