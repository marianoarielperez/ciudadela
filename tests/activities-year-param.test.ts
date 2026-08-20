import { describe, expect, it } from "vitest";
import {
  activitiesYearHref,
  currentYearAR,
  fallbackYear,
  resolveActivitiesYear,
} from "@/lib/activities/year-param";

// El calendario cargado; `current` es el año en curso en hora argentina.
const YEARS = [2027, 2026, 2025];

const resolve = (param: string | string[] | undefined, years = YEARS, current = 2026) =>
  resolveActivitiesYear(param, years, current);

describe("currentYearAR", () => {
  it("usa la hora argentina, no la UTC del server", () => {
    // 1 de enero 00:30 UTC = 31 de diciembre 21:30 en Comodoro.
    expect(currentYearAR(new Date("2027-01-01T00:30:00Z"))).toBe(2026);
    expect(currentYearAR(new Date("2027-01-01T03:00:00Z"))).toBe(2027);
  });
});

describe("fallbackYear", () => {
  it("prefiere el año en curso aunque haya uno más nuevo cargado", () => {
    expect(fallbackYear([2027, 2026], 2026)).toBe(2026);
  });
  it("cae en el más reciente cuando el año en curso no tiene nada", () => {
    expect(fallbackYear([2025, 2024], 2026)).toBe(2025);
  });
  it("cae en el año en curso si no hay ninguna actividad cargada", () => {
    expect(fallbackYear([], 2026)).toBe(2026);
  });
});

describe("resolveActivitiesYear", () => {
  it("sin parámetro muestra el año por defecto y ya es canónico", () => {
    expect(resolve(undefined)).toMatchObject({
      year: 2026,
      canonicalHref: "/actividades",
      isCanonical: true,
    });
  });

  it("un año cargado distinto del default es canónico con su query param", () => {
    expect(resolve("2025")).toMatchObject({
      year: 2025,
      canonicalHref: "/actividades?anio=2025",
      isCanonical: true,
    });
  });

  it("el año por defecto pedido explícitamente redirige a la URL sin parámetro", () => {
    expect(resolve("2026")).toMatchObject({
      year: 2026,
      canonicalHref: "/actividades",
      isCanonical: false,
    });
  });

  // El caso que dejaba dos URLs vivas para el mismo contenido: %20 delante del
  // número. Number(" 2025") es 2025, así que resuelve igual pero la dirección
  // no es la canónica.
  it("no deja viva la variante con espacio (?anio=%202025)", () => {
    expect(resolve(" 2025")).toMatchObject({
      year: 2025,
      canonicalHref: "/actividades?anio=2025",
      isCanonical: false,
    });
  });

  // Number() acepta varias escrituras del mismo año ("2025.0", "2025e0",
  // "0x7e9"): todas muestran 2025 y todas redirigen a la única URL canónica.
  it.each(["2025.0", "2025e0", "0x7e9"])("%s redirige a la forma canónica del año", (param) => {
    expect(resolve(param)).toMatchObject({
      year: 2025,
      canonicalHref: "/actividades?anio=2025",
      isCanonical: false,
    });
  });

  it.each([
    ["basura", "abc"],
    ["no numérico", "Infinity"],
    ["año sin actividades", "1999"],
    ["vacío", ""],
    ["cero", "0"],
    ["repetido (array)", ["2025", "2024"]] as [string, string[]],
  ])("%s cae en el default y redirige", (_label, param) => {
    expect(resolve(param as string | string[])).toMatchObject({
      year: 2026,
      canonicalHref: "/actividades",
      isCanonical: false,
    });
  });
});

describe("activitiesYearHref", () => {
  it("el año por defecto se linkea sin query param", () => {
    expect(activitiesYearHref(2026, 2026)).toBe("/actividades");
    expect(activitiesYearHref(2025, 2026)).toBe("/actividades?anio=2025");
  });
});
