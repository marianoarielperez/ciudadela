import { describe, expect, it } from "vitest";
import {
  DOCUMENTOS_TABS,
  initialDocumentosTab,
  tabForType,
} from "@/lib/admin/documentos-tabs";

describe("DOCUMENTOS_TABS", () => {
  it("cubre los cuatro tipos, en el orden de la spec", () => {
    expect(DOCUMENTOS_TABS.map((t) => t.value)).toEqual(["normas", "memorias", "balances", "otros"]);
    expect(DOCUMENTOS_TABS.map((t) => t.type)).toEqual(["norm", "annual_report", "balance", "other"]);
  });
});

describe("initialDocumentosTab", () => {
  it("honra un ?tab= válido y cae a normas ante basura o ausencia", () => {
    expect(initialDocumentosTab({ tab: "balances" })).toBe("balances");
    expect(initialDocumentosTab({ tab: "inventada" })).toBe("normas");
    expect(initialDocumentosTab({})).toBe("normas");
    expect(initialDocumentosTab({ tab: ["memorias", "otros"] })).toBe("normas");
  });
});

describe("tabForType", () => {
  it("mapea cada tipo a su pestaña", () => {
    expect(tabForType("norm")).toBe("normas");
    expect(tabForType("annual_report")).toBe("memorias");
    expect(tabForType("balance")).toBe("balances");
    expect(tabForType("other")).toBe("otros");
  });
});
