import { describe, it, expect } from "vitest"
import { formatDateAR, formatARS } from "@/lib/format"

describe("formatDateAR", () => {
  it("formats a UTC date in Argentina timezone as DD/MM/AAAA", () => {
    // 2026-08-17T02:30Z = 16/08 23:30 en Argentina (UTC-3)
    expect(formatDateAR(new Date("2026-08-17T02:30:00Z"))).toBe("16/08/2026")
  })
  it("formats midday dates plainly", () => {
    expect(formatDateAR(new Date("2026-01-05T15:00:00Z"))).toBe("05/01/2026")
  })
})

describe("formatARS", () => {
  it("formats with dot thousands and comma decimals", () => {
    expect(formatARS(1234.56)).toBe("$ 1.234,56")
  })
  it("always shows two decimals", () => {
    expect(formatARS(6000)).toBe("$ 6.000,00")
  })
})
