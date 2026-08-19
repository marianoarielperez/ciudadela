import { describe, expect, it } from "vitest";
import { slugify } from "@/lib/news/slug";

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
