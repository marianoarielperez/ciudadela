import { describe, expect, it } from "vitest";
import { periodCellLabel } from "@/components/admin/period-strip";

describe("periodCellLabel", () => {
  it("nombra mes, estado y recibo para el lector de pantalla", () => {
    expect(periodCellLabel({ period: "2025-03", state: "paid", receiptNumber: "2026-00001" })).toBe("marzo 2025: pagada, recibo 2026-00001");
    expect(periodCellLabel({ period: "2025-04", state: "pending_import" })).toBe("abril 2025: pendiente (deuda importada)");
    expect(periodCellLabel({ period: "2026-12", state: "none" })).toBe("diciembre 2026: sin cuota");
  });
});
