import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseForm } from "@/lib/forms";

const schema = z.object({
  fullName: z.string().min(1, "Ingresá el nombre"),
  email: z.string().email("Email inválido").optional(),
});

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
}

describe("parseForm", () => {
  it("parses valid data and trims", () => {
    const r = parseForm(schema, fd({ fullName: "  Perez Ana ", email: "a@b.com" }));
    expect(r).toEqual({ ok: true, data: { fullName: "Perez Ana", email: "a@b.com" } });
  });
  it("treats empty strings as missing", () => {
    const r = parseForm(schema, fd({ fullName: "Perez Ana", email: "" }));
    expect(r).toEqual({ ok: true, data: { fullName: "Perez Ana" } });
  });
  it("returns the first error message", () => {
    const r = parseForm(schema, fd({ fullName: "", email: "nope" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("Ingresá el nombre");
  });
  // Un campo requerido en blanco tiene que dar el mensaje del schema, nunca el
  // texto genérico en inglés de zod para "received undefined".
  it("uses the schema message for a blank required field", () => {
    const r = parseForm(schema, fd({ fullName: "   " }));
    expect(r).toEqual({ ok: false, error: "Ingresá el nombre", field: "fullName" });
  });
  it("treats a whitespace-only optional field as missing", () => {
    const r = parseForm(schema, fd({ fullName: "Perez Ana", email: "   " }));
    expect(r).toEqual({ ok: true, data: { fullName: "Perez Ana" } });
  });
  it("propagates the schema message of an optional field that is filled in wrong", () => {
    const r = parseForm(schema, fd({ fullName: "Perez Ana", email: "nope" }));
    expect(r).toEqual({ ok: false, error: "Email inválido", field: "email" });
  });
  it("el error dice QUÉ campo falló, sin cambiar el mensaje", () => {
    const s = z.object({
      nombre: z.string().min(1, "Ingresá el nombre."),
      email: z.string().email("El email no es válido."),
    });
    const r = parseForm(s, fd({ nombre: "Ana", email: "no-es-un-email" }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("El email no es válido.");
    expect(r.field).toBe("email");
  });
  it("un error de raíz (schema no-objeto) no inventa un campo", () => {
    // El issue de zod viene con `path: []`: no hay campo que nombrar y no se
    // fabrica uno a partir del índice.
    const r = parseForm(z.string("Datos inválidos."), new FormData());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.field).toBeUndefined();
  });
  it("sigue eligiendo el MISMO issue de siempre: el primero", () => {
    // Cambiar cuál issue se elige cambiaría los textos que ve el usuario en los
    // schemas multicampo, y hay tests que los afirman.
    const s = z.object({ a: z.string().min(1, "Falta A."), b: z.string().min(1, "Falta B.") });
    const r = parseForm(s, fd({ a: "", b: "" }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("Falta A.");
    expect(r.field).toBe("a");
  });
});
