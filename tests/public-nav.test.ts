// La nav pública no tenía test (informe 01). Se fija: hrefs únicos, cada href
// con su page.tsx en disco, y que "Reportes" (M7) está después de Ubicación.
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PUBLIC_NAV_LINKS } from "@/lib/public-nav";

describe("PUBLIC_NAV_LINKS", () => {
  it("hrefs únicos y cada uno con page.tsx bajo src/app/(public)", () => {
    const hrefs = PUBLIC_NAV_LINKS.map(([href]) => href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    const root = path.resolve(import.meta.dirname, "..", "src", "app", "(public)");
    for (const href of hrefs) {
      const file = path.join(root, ...href.split("/").filter(Boolean), "page.tsx");
      expect(existsSync(file), `${href} → ${file}`).toBe(true);
    }
  });
  it("termina en Reportes, después de Ubicación", () => {
    const hrefs = PUBLIC_NAV_LINKS.map(([href]) => href);
    expect(hrefs.at(-1)).toBe("/reportes");
    expect(hrefs.indexOf("/reportes")).toBe(hrefs.indexOf("/ubicacion") + 1);
    expect(PUBLIC_NAV_LINKS.at(-1)?.[1]).toBe("Reportes");
  });
});
