import { describe, it, expect } from "vitest"
import { formatBytes, formatDateAR, formatDateTimeAR, formatARS } from "@/lib/format"

describe("formatDateAR", () => {
  it("formats a UTC date in Argentina timezone as DD/MM/AAAA", () => {
    // 2026-08-17T02:30Z = 16/08 23:30 en Argentina (UTC-3)
    expect(formatDateAR(new Date("2026-08-17T02:30:00Z"))).toBe("16/08/2026")
  })
  it("formats midday dates plainly", () => {
    expect(formatDateAR(new Date("2026-01-05T15:00:00Z"))).toBe("05/01/2026")
  })
})

describe("formatDateTimeAR", () => {
  it("da día civil y hora argentinos, en 24 h", () => {
    // 26/08 15:00Z = 26/08 12:00 en Argentina (UTC-3).
    expect(formatDateTimeAR(new Date("2026-08-26T15:00:00Z"))).toBe("26/08/2026 a las 12:00")
  })
  it("cruza el día cuando la hora UTC es de madrugada", () => {
    expect(formatDateTimeAR(new Date("2026-08-27T02:30:00Z"))).toBe("26/08/2026 a las 23:30")
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

describe("formatBytes", () => {
  // El tamaño lo muestra la ficha de la solicitud al lado de cada documento: es
  // la única señal de que la foto del DNI que subió el vecino puede estar
  // recortada a 3 kB antes de abrirla.
  it("uses kB under a megabyte and MB above it", () => {
    expect(formatBytes(2048)).toBe("2 kB")
    expect(formatBytes(1_500_000)).toBe("1,4 MB")
  })
  it("keeps bytes readable for very small files", () => {
    expect(formatBytes(0)).toBe("0 B")
    expect(formatBytes(512)).toBe("512 B")
  })
  it("uses the es-AR decimal comma", () => {
    expect(formatBytes(1_572_864)).toBe("1,5 MB")
  })
})
