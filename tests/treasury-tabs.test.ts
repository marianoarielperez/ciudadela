import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isTreasuryTabActive, TREASURY_TABS } from "@/lib/admin/treasury-tabs";

describe("TREASURY_TABS", () => {
  it("cada pestaña apunta a una ruta que existe en disco", () => {
    const root = path.resolve(import.meta.dirname, "..", "src", "app");
    for (const tab of TREASURY_TABS) {
      const file = path.join(root, ...tab.href.split("/").filter(Boolean), "page.tsx");
      expect(existsSync(file), `${tab.href} → ${file}`).toBe(true);
    }
  });
  it("marca la pestaña en su raíz y en sus subrutas", () => {
    expect(isTreasuryTabActive("/admin/tesoreria/recibos/12", "/admin/tesoreria/recibos")).toBe(true);
    expect(isTreasuryTabActive("/admin/tesoreria/deudores", "/admin/tesoreria/recibos")).toBe(false);
  });
});
