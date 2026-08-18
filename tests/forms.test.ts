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
    expect(r).toEqual({ ok: false, error: "Ingresá el nombre" });
  });
  it("treats a whitespace-only optional field as missing", () => {
    const r = parseForm(schema, fd({ fullName: "Perez Ana", email: "   " }));
    expect(r).toEqual({ ok: true, data: { fullName: "Perez Ana" } });
  });
  it("propagates the schema message of an optional field that is filled in wrong", () => {
    const r = parseForm(schema, fd({ fullName: "Perez Ana", email: "nope" }));
    expect(r).toEqual({ ok: false, error: "Email inválido" });
  });
});
