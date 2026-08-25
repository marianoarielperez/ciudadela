import { describe, expect, it } from "vitest";
import { memberRequestDecided } from "@/lib/email/templates";

describe("plantilla de decisión sobre una solicitud de socio (memberRequestDecided)", () => {
  it("baja aceptada: dice que quedó asentada con acta", () => {
    const { message } = memberRequestDecided({ type: "withdrawal", accepted: true });
    expect(message.text).toMatch(/baja/i);
    expect(message.text).toMatch(/aceptada/i);
    expect(message.text).toMatch(/acta/i);
  });

  it("categoría aceptada: dice que ya rige", () => {
    const { message } = memberRequestDecided({ type: "category_change", accepted: true });
    expect(message.text).toMatch(/categoría/i);
    expect(message.text).toMatch(/aceptada/i);
    expect(message.text).toMatch(/rige/i);
  });

  it("baja rechazada: sin nota no la inventa, con nota la incluye", () => {
    const sinNota = memberRequestDecided({ type: "withdrawal", accepted: false });
    expect(sinNota.message.text).toMatch(/baja/i);
    expect(sinNota.message.text).toMatch(/rechazada/i);
    expect(sinNota.message.text).not.toContain("Falta la firma");

    const conNota = memberRequestDecided({
      type: "withdrawal", accepted: false, note: "Falta la firma del cónyuge.",
    });
    expect(conNota.message.text).toContain("Falta la firma del cónyuge.");
    expect(conNota.message.html).toContain("Falta la firma del cónyuge.");
  });

  it("categoría rechazada: incluye la nota cuando se pasa", () => {
    const conNota = memberRequestDecided({
      type: "category_change", accepted: false, note: "Deuda pendiente.",
    });
    expect(conNota.message.text).toMatch(/categoría/i);
    expect(conNota.message.text).toMatch(/rechazada/i);
    expect(conNota.message.text).toContain("Deuda pendiente.");
  });

  it("una nota en una decisión ACEPTADA no aparece: sólo las rechazadas la llevan", () => {
    const { message } = memberRequestDecided({
      type: "withdrawal", accepted: true, note: "Esto no debería salir.",
    });
    expect(message.text).not.toContain("Esto no debería salir.");
  });

  it("aceptada con fullName: saluda por nombre en texto y html", () => {
    const { message } = memberRequestDecided({ type: "withdrawal", accepted: true, fullName: "Soto Juan" });
    expect(message.text).toMatch(/^Hola Soto Juan:/);
    expect(message.html).toContain("Hola <strong>Soto Juan</strong>");
  });

  it("aceptada sin fullName: no saluda (el llamador no lo tenía a mano)", () => {
    const { message } = memberRequestDecided({ type: "category_change", accepted: true });
    expect(message.text).not.toMatch(/^Hola/);
    expect(message.html).not.toContain("Hola <strong>");
  });

  it("rechazada con fullName: NO saluda, mismo criterio que applicationRejectedEmail", () => {
    const { message } = memberRequestDecided({
      type: "withdrawal", accepted: false, fullName: "Soto Juan", note: "Falta la firma.",
    });
    expect(message.text).not.toMatch(/^Hola/);
    expect(message.html).not.toContain("Hola <strong>");
  });

  it("las cuatro variantes traen texto plano usable, sin HTML, y un summary no vacío", () => {
    const variants = [
      memberRequestDecided({ type: "withdrawal", accepted: true }),
      memberRequestDecided({ type: "withdrawal", accepted: false }),
      memberRequestDecided({ type: "category_change", accepted: true }),
      memberRequestDecided({ type: "category_change", accepted: false }),
    ];
    for (const { message, summary } of variants) {
      expect(message.subject).toContain("Vecinal Ciudadela");
      expect(message.text.length).toBeGreaterThan(40);
      expect(message.text).not.toContain("<");
      expect(summary.length).toBeGreaterThan(0);
    }
  });
});
