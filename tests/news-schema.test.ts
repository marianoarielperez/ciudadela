import { describe, expect, it } from "vitest";
import {
  NEWS_BODY_MAX_BYTES,
  NEWS_BODY_MAX_CHARS,
  newsBodyByteLength,
  newsFormSchema,
} from "@/lib/news/schema";

describe("newsFormSchema", () => {
  it("acepta el mínimo válido", () => {
    const r = newsFormSchema.safeParse({ title: "Hola", body: "<p>x</p>" });
    expect(r.success).toBe(true);
  });

  it("rechaza slug con mayúsculas o espacios, con mensaje es-AR", () => {
    const r = newsFormSchema.safeParse({ title: "Hola", body: "<p>x</p>", slug: "Con Espacios" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toContain("minúsculas");
  });

  it("exige título con mensaje es-AR", () => {
    const r = newsFormSchema.safeParse({ title: "", body: "<p>x</p>" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toBe("Ingresá el título.");
  });

  it("exige cuerpo con mensaje es-AR", () => {
    const r = newsFormSchema.safeParse({ title: "Hola", body: "" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toBe("Escribí el contenido de la noticia.");
  });

  // La columna `body` es TEXT de MySQL: 65.535 BYTES, no caracteres. Con acentos
  // (2 bytes en UTF-8) una nota larga se pasa y el INSERT muere con "Data too
  // long", un error técnico en inglés en vez de un mensaje para el operador. El
  // tope en caracteres deja margen de sobra para el multibyte.
  it("rechaza un cuerpo que desbordaría la columna TEXT, con mensaje es-AR", () => {
    const body = `<p>${"á".repeat(NEWS_BODY_MAX_CHARS)}</p>`;
    const r = newsFormSchema.safeParse({ title: "Hola", body });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0].message).toBe(
        "El contenido es demasiado largo: recortalo a 50.000 caracteres.",
      );
    }
  });

  // El tope en caracteres NO alcanza solo: 50.000 acentuados son 100.000 bytes
  // y pasarían el `.max()` para morir después en el driver. Este caso es el que
  // obliga a que exista además la guarda en bytes.
  it("rechaza un cuerpo que entra en caracteres pero desborda en bytes", () => {
    const body = "á".repeat(40_000);
    expect(body.length).toBeLessThan(NEWS_BODY_MAX_CHARS);
    expect(newsBodyByteLength(body)).toBeGreaterThan(65535);

    const r = newsFormSchema.safeParse({ title: "Hola", body });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0].message).toBe("El contenido es demasiado largo para guardarlo: recortalo.");
    }
  });

  it("el presupuesto de bytes queda por debajo del límite de la columna TEXT", () => {
    expect(NEWS_BODY_MAX_BYTES).toBeLessThan(65535);
  });

  it("acepta un cuerpo justo en el tope", () => {
    const r = newsFormSchema.safeParse({ title: "Hola", body: "x".repeat(NEWS_BODY_MAX_CHARS) });
    expect(r.success).toBe(true);
  });

  it("acepta el checkbox de quitar portada", () => {
    const r = newsFormSchema.safeParse({ title: "Hola", body: "<p>x</p>", removeCover: "on" });
    expect(r.success).toBe(true);
  });
});
