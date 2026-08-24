import { describe, expect, it } from "vitest";
import { DEFAULT_MAIL_BATCH_CAP, mailBatchCap, makeMailBudget, UNLIMITED_MAIL_BUDGET } from "@/lib/email/batch-cap";

describe("mailBatchCap", () => {
  it("sin variable, 50", () => {
    expect(mailBatchCap(undefined)).toBe(DEFAULT_MAIL_BATCH_CAP);
    expect(DEFAULT_MAIL_BATCH_CAP).toBe(50);
  });
  it("un valor entero positivo manda", () => {
    expect(mailBatchCap("5")).toBe(5);
  });
  it("basura o cero caen al default: un tope de 0 apagaría todos los avisos en silencio", () => {
    for (const raw of ["", "0", "-3", "muchos", "3.5"]) expect(mailBatchCap(raw)).toBe(DEFAULT_MAIL_BATCH_CAP);
  });
});

describe("makeMailBudget", () => {
  it("da permiso hasta el tope y después cuenta diferidos", () => {
    const b = makeMailBudget(2);
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(false);
    expect(b.take()).toBe(false);
    expect(b.deferred).toBe(2);
  });
  it("sin consumo, cero diferidos", () => {
    expect(makeMailBudget(2).deferred).toBe(0);
  });
  // El tope es de correos ENVIADOS, no de intentos: con 37 emails cargados
  // sobre 278 socios, un lote de socios sin casilla lo agotaría sin mandar uno.
  it("un lugar devuelto vuelve al pote", () => {
    const b = makeMailBudget(1);
    expect(b.take()).toBe(true);
    b.refund();
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(false);
    expect(b.deferred).toBe(1);
  });
  it("un refund de más no regala cupo", () => {
    const b = makeMailBudget(1);
    b.refund();
    b.refund();
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(false);
  });
  it("el presupuesto ilimitado no cuenta nada", () => {
    for (let i = 0; i < 100; i++) expect(UNLIMITED_MAIL_BUDGET.take()).toBe(true);
    UNLIMITED_MAIL_BUDGET.refund();
    expect(UNLIMITED_MAIL_BUDGET.take()).toBe(true);
    expect(UNLIMITED_MAIL_BUDGET.deferred).toBe(0);
  });
});
