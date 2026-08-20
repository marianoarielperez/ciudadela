import { describe, expect, it } from "vitest";
import { normalizeSlugInput, slugify } from "@/lib/news/slug";

describe("slugify", () => {
  it("baja a minúsculas, saca tildes y reemplaza no-alfanuméricos por guiones", () => {
    expect(slugify("Asamblea General Ordinaria 2026")).toBe("asamblea-general-ordinaria-2026");
    expect(slugify("¡Inscripción al Taekwondo — Niños!")).toBe("inscripcion-al-taekwondo-ninos");
  });
  it("colapsa guiones y recorta extremos", () => {
    expect(slugify("  hola   --- mundo  ")).toBe("hola-mundo");
  });
  it("nunca devuelve vacío", () => {
    expect(slugify("¡¡¡···!!!")).toBe("noticia");
    expect(slugify("")).toBe("noticia");
  });
  it("respeta el máximo de 180 sin cortar en guion colgante", () => {
    const s = slugify("a".repeat(300));
    expect(s.length).toBeLessThanOrEqual(180);
    expect(s.endsWith("-")).toBe(false);
  });
});

// Lo que aplica el campo "URL" tecla a tecla. La diferencia con `slugify` es
// una sola: acá los guiones de los extremos se respetan, porque el operador
// todavía está tipeando.
describe("normalizeSlugInput", () => {
  it("saca tildes igual que slugify: lo tipeado y lo derivado del título coinciden", () => {
    expect(normalizeSlugInput("Ñandú")).toBe("nandu");
    expect(normalizeSlugInput("Ñandú")).toBe(slugify("Ñandú"));
  });
  it("colapsa cualquier corrida de no-alfanuméricos en un solo guion", () => {
    expect(normalizeSlugInput("hola   ///mundo")).toBe("hola-mundo");
  });
  it("no recorta los guiones de los extremos: el operador sigue tipeando", () => {
    expect(normalizeSlugInput("asamblea-")).toBe("asamblea-");
    expect(normalizeSlugInput("-asamblea")).toBe("-asamblea");
  });
  it("devuelve vacío con la entrada vacía, sin fallback", () => {
    expect(normalizeSlugInput("")).toBe("");
  });
});
