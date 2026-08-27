import { describe, expect, it } from "vitest";
import { isSociosTabActive, SOCIOS_TABS } from "@/lib/admin/socios-tabs";

describe("SOCIOS_TABS", () => {
  it("Padrón, Libros e Histórico en ese orden", () => {
    expect(SOCIOS_TABS.map((t) => t.href)).toEqual([
      "/admin/socios", "/admin/socios/libros", "/admin/socios/historico",
    ]);
  });
});

// Regla del brief: "el prefijo más específico gana" — Libros e Histórico
// matchean por prefijo propio, y todo lo demás bajo /admin/socios (incluidas
// las subrutas de detalle, carga y alta) es Padrón.
describe("isSociosTabActive", () => {
  const PADRON = "/admin/socios";
  const LIBROS = "/admin/socios/libros";
  const HISTORICO = "/admin/socios/historico";

  it("cada pestaña está activa en su propio href", () => {
    expect(isSociosTabActive(PADRON, PADRON)).toBe(true);
    expect(isSociosTabActive(LIBROS, LIBROS)).toBe(true);
    expect(isSociosTabActive(HISTORICO, HISTORICO)).toBe(true);
  });

  it("el detalle de un socio es Padrón", () => {
    expect(isSociosTabActive("/admin/socios/123", PADRON)).toBe(true);
    expect(isSociosTabActive("/admin/socios/123", LIBROS)).toBe(false);
    expect(isSociosTabActive("/admin/socios/123", HISTORICO)).toBe(false);
  });

  it("una acción societaria del detalle es Padrón", () => {
    expect(isSociosTabActive("/admin/socios/123/baja", PADRON)).toBe(true);
    expect(isSociosTabActive("/admin/socios/123/baja", LIBROS)).toBe(false);
    expect(isSociosTabActive("/admin/socios/123/baja", HISTORICO)).toBe(false);
  });

  it("la carga de padrón es Padrón", () => {
    expect(isSociosTabActive("/admin/socios/carga/45", PADRON)).toBe(true);
    expect(isSociosTabActive("/admin/socios/carga/45", LIBROS)).toBe(false);
  });

  it("el alta nueva es Padrón", () => {
    expect(isSociosTabActive("/admin/socios/nuevo", PADRON)).toBe(true);
    expect(isSociosTabActive("/admin/socios/nuevo", LIBROS)).toBe(false);
  });

  it("una subruta de Libros es Libros, no Padrón", () => {
    expect(isSociosTabActive("/admin/socios/libros/1", LIBROS)).toBe(true);
    expect(isSociosTabActive("/admin/socios/libros/1", PADRON)).toBe(false);
  });

  it("Histórico con query string sigue siendo Histórico (pathname sin query)", () => {
    expect(isSociosTabActive("/admin/socios/historico", HISTORICO)).toBe(true);
    expect(isSociosTabActive("/admin/socios/historico", PADRON)).toBe(false);
  });
});
