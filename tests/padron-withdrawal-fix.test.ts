import { describe, expect, it } from "vitest";
import { isWithdrawnRow } from "@/lib/padron/mapping";
import {
  decideWithdrawalFix,
  type WithdrawalFixMember,
  type WithdrawalFixRow,
} from "@/lib/padron/withdrawal-fix";

const row = (over: Partial<WithdrawalFixRow> = {}): WithdrawalFixRow => ({
  memberNumber: 38, rowNumber: 40, withdrawn: true, motivo: "Mora", dni: "30111222", ...over,
});
const member = (over: Partial<WithdrawalFixMember> = {}): WithdrawalFixMember => ({
  fullName: "Genta Javier", dni: "30111222", status: "withdrawn",
  withdrawalReason: "arrears", reentryBlocked: false, ...over,
});

describe("isWithdrawnRow", () => {
  it("reads the two values the padron uses", () => {
    expect(isWithdrawnRow("Si", "fila 2")).toBe(false);
    expect(isWithdrawnRow(" no ", "fila 2")).toBe(true);
    expect(isWithdrawnRow("NO", "fila 2")).toBe(true);
  });

  // Antes cualquier valor raro caía en `activo !== "no"` y la fila pasaba por
  // VIGENTE: el operador terminaba buscando un acta para un error de tipeo.
  it("throws on anything else, including the empty cell", () => {
    for (const raw of ["0", "false", "s", "", "  ", null]) {
      expect(() => isWithdrawnRow(raw, "fila 7")).toThrow(/activo debe ser Si\/No/);
    }
    expect(() => isWithdrawnRow("quizas", "fila 7")).toThrow(/fila 7/);
  });
});

describe("decideWithdrawalFix", () => {
  it("plans the fix and turns the reentry block on for an expulsion", () => {
    const d = decideWithdrawalFix(row({ motivo: "Expulsado" }), member());
    expect(d).toEqual({ kind: "plan", to: "expulsion", blockTo: true });
  });

  it("keeps an already set block when the new reason is not an expulsion", () => {
    const d = decideWithdrawalFix(
      row({ motivo: "Fallecido" }),
      member({ withdrawalReason: "arrears", reentryBlocked: true }),
    );
    expect(d).toEqual({ kind: "plan", to: "death", blockTo: true });
  });

  it("does nothing when the ficha already matches", () => {
    expect(decideWithdrawalFix(row(), member()).kind).toBe("unchanged");
    expect(
      decideWithdrawalFix(
        row({ motivo: "Expulsado" }),
        member({ withdrawalReason: "expulsion", reentryBlocked: true }),
      ).kind,
    ).toBe("unchanged");
  });

  // REG-04 (Art. 5 inc. 2): el expulsado no reingresa jamás, y la puerta del
  // wizard lo decide por DOS señales. Una ficha con el motivo puesto y el flag
  // en `false` —las viejas, importadas o arregladas a mano— contra una celda
  // que diga "Mora" perdía la única señal que quedaba.
  it("never downgrades an expulsion: it reports it instead", () => {
    const d = decideWithdrawalFix(row({ motivo: "Mora" }), member({ withdrawalReason: "expulsion" }));
    expect(d.kind).toBe("discrepancy");
    if (d.kind !== "discrepancy") throw new Error("unreachable");
    expect(d.message).toContain("38");
    expect(d.message).toContain("REG-04");
  });

  it("does not downgrade an expulsion even when the flag is on", () => {
    const d = decideWithdrawalFix(
      row({ motivo: "Fallecido" }),
      member({ withdrawalReason: "expulsion", reentryBlocked: true }),
    );
    expect(d.kind).toBe("discrepancy");
  });

  it("reports a missing ficha only when the padron gives it withdrawn", () => {
    expect(decideWithdrawalFix(row(), undefined).kind).toBe("discrepancy");
    expect(decideWithdrawalFix(row({ withdrawn: false }), undefined).kind).toBe("skip");
  });

  it("never touches the membership status, in either direction", () => {
    expect(decideWithdrawalFix(row(), member({ status: "active" })).kind).toBe("discrepancy");
    expect(
      decideWithdrawalFix(row({ withdrawn: false }), member({ status: "withdrawn" })).kind,
    ).toBe("discrepancy");
    expect(decideWithdrawalFix(row({ withdrawn: false }), member({ status: "active" })).kind).toBe("skip");
  });

  it("reports a DNI mismatch instead of writing", () => {
    const d = decideWithdrawalFix(row({ dni: "99888777" }), member({ withdrawalReason: "death" }));
    expect(d.kind).toBe("discrepancy");
  });

  it("does not overwrite a reason it cannot read", () => {
    expect(decideWithdrawalFix(row({ motivo: "texto raro" }), member()).kind).toBe("discrepancy");
    expect(decideWithdrawalFix(row({ motivo: null }), member()).kind).toBe("discrepancy");
    expect(decideWithdrawalFix(row({ motivo: null }), member({ withdrawalReason: null })).kind).toBe(
      "unchanged",
    );
  });
});
