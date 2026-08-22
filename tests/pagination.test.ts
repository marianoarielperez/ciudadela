import { describe, expect, it } from "vitest";
import { pageHref, paginate, parsePage } from "@/lib/admin/pagination";

describe("pagination", () => {
  it("parsePage cae a 1 con basura", () => {
    expect(parsePage({ page: "3" })).toBe(3);
    expect(parsePage({ page: "0" })).toBe(1);
    expect(parsePage({ page: ["x"] })).toBe(1);
    expect(parsePage({})).toBe(1);
  });
  it("paginate acota al final y nunca da 0 páginas", () => {
    expect(paginate(0, 5, 50)).toEqual({ page: 1, pageCount: 1, skip: 0, take: 50 });
    expect(paginate(120, 9, 50)).toEqual({ page: 3, pageCount: 3, skip: 100, take: 50 });
  });
  it("pageHref conserva los filtros y omite page=1", () => {
    expect(pageHref("/admin/tesoreria/recibos", { q: "ana", mes: undefined }, 1)).toBe("/admin/tesoreria/recibos?q=ana");
    expect(pageHref("/admin/tesoreria/recibos", {}, 2)).toBe("/admin/tesoreria/recibos?page=2");
  });
});
