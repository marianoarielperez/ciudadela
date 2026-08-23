import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminActor } from "@/lib/auth/require-admin";

// Otros ingresos registra plata que entró a la vecinal: la guarda tiene que
// cortar ANTES de escribir, de auditar y de redirigir. Y el asiento no puede
// llevar el concepto ni la nota — son texto libre del operador y pueden nombrar
// a un tercero, el inquilino del salón (Ley 25.326).
const mocks = vi.hoisted(() => ({
  record: vi.fn(),
  edit: vi.fn(),
  voidIncome: vi.fn(),
  audit: vi.fn(async () => {}),
  // Tipado explícito: sin él TS infiere la forma del rechazo y el
  // `mockResolvedValueOnce` del caso autorizado no compila.
  admin: vi.fn(async (): Promise<AdminActor> => (
    { ok: false, reason: "not_admin", error: "Necesitás permisos de administrador." }
  )),
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/treasury/other-income", async (importOriginal) => {
  // `OtherIncomeError` va el de verdad: la action lo usa con `instanceof` para
  // decidir si el mensaje se le muestra al operador o se traga como error nuestro.
  const real = await importOriginal<typeof import("@/lib/treasury/other-income")>();
  return {
    ...real,
    otherIncome: { record: mocks.record, edit: mocks.edit, void: mocks.voidIncome },
  };
});
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: mocks.admin }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { redirect } from "next/navigation";
import {
  editOtherIncomeAction,
  registerOtherIncomeAction,
  voidOtherIncomeAction,
} from "@/app/admin/tesoreria/otros-ingresos/actions";
import { OtherIncomeError } from "@/lib/treasury/other-income";

// `audit` se mockea sin parámetros, así que `mock.calls[0]` es una tupla vacía
// para TS: el ensanchado deja inspeccionar el asiento igual.
function auditedEntry(): unknown {
  return (mocks.audit.mock.calls[0] as unknown[] | undefined)?.[0];
}

function incomeForm(over: Record<string, string> = {}): FormData {
  const form = new FormData();
  const values = {
    amount: "45000",
    receivedAt: "2026-08-20",
    concept: "Alquiler del salón a Ramírez",
    note: "Pagó en mano",
    ...over,
  };
  for (const [k, v] of Object.entries(values)) if (v !== "") form.append(k, v);
  return form;
}

describe("registerOtherIncomeAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.record.mockResolvedValue({ kind: "recorded", id: 12 });
  });

  it("sin admin no registra, no audita y no redirige", async () => {
    const r = await registerOtherIncomeAction({}, incomeForm());
    expect(r.error).toBe("Necesitás permisos de administrador.");
    expect(mocks.record).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("con admin: registra en efectivo con la fecha civil al mediodía UTC y audita SIN el texto libre", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    await registerOtherIncomeAction({}, incomeForm());
    expect(mocks.record).toHaveBeenCalledWith({
      amount: 45000,
      // Mediodía UTC y no `new Date("2026-08-20")`: en UTC-3 el crudo cae el 19.
      receivedAt: new Date("2026-08-20T12:00:00.000Z"),
      concept: "Alquiler del salón a Ramírez",
      method: "cash",
      note: "Pagó en mano",
      actorId: 9,
    });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      userId: 9, ip: "unknown",
      action: "other_income_create", entity: "other_income", entityId: 12,
      detail: { amount: 45000, method: "cash", receivedAt: "2026-08-20" },
    }));
    const asiento = JSON.stringify(auditedEntry());
    expect(asiento).not.toContain("Ramírez");
    expect(asiento).not.toContain("mano");
    expect(redirect).toHaveBeenCalledWith("/admin/tesoreria/otros-ingresos?registrado=1");
  });

  it("un monto con centavos se rechaza con el mensaje de entero, no con el genérico", async () => {
    // Pesos enteros a propósito, como el mostrador: con la coma habría que
    // adivinar si es decimal o separador de miles.
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    const r = await registerOtherIncomeAction({}, incomeForm({ amount: "45000.50" }));
    expect(r.error).toBe("El monto tiene que ser un número entero de pesos.");
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it("un monto que no es número se rechaza en castellano, no con el NaN de zod", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    const r = await registerOtherIncomeAction({}, incomeForm({ amount: "45.000." }));
    expect(r.error).toBe("Ingresá el monto del ingreso.");
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it("un día que no existe se rechaza en vez de rodar al mes siguiente", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    const r = await registerOtherIncomeAction({}, incomeForm({ receivedAt: "2026-02-31" }));
    expect(r.error).toBe("La fecha del ingreso no es válida.");
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it("una fecha futura se rechaza: esa plata todavía no entró", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    const r = await registerOtherIncomeAction({}, incomeForm({ receivedAt: "2099-01-01" }));
    expect(r.error).toBe("La fecha del ingreso tiene que estar entre 2015 y hoy.");
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it("una regla del módulo se muestra tal cual; un error nuestro no se muestra crudo", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.record.mockRejectedValueOnce(new OtherIncomeError("El monto tiene que ser mayor a cero."));
    expect((await registerOtherIncomeAction({}, incomeForm())).error).toBe(
      "El monto tiene que ser mayor a cero.",
    );

    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    // El `message` de Prisma vuelca los argumentos de la consulta —y ahí va el
    // texto libre del operador—: no puede llegar a la pantalla.
    mocks.record.mockRejectedValueOnce(Object.assign(new Error("Alquiler del salón a Ramírez"), { code: "P2010" }));
    const r = await registerOtherIncomeAction({}, incomeForm());
    expect(r.error).toBe("No se pudo registrar el ingreso. Reintentá en un momento.");
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});

describe("editOtherIncomeAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.edit.mockResolvedValue({ kind: "edited" });
  });

  function editForm(over: Record<string, string> = {}): FormData {
    const form = new FormData();
    const values = {
      incomeId: "12",
      concept: "Alquiler del salón a Ramírez",
      note: "Pagó en mano",
      ...over,
    };
    for (const [k, v] of Object.entries(values)) if (v !== "") form.append(k, v);
    return form;
  }

  it("sin admin no corrige, no audita y no redirige", async () => {
    const r = await editOtherIncomeAction({}, editForm());
    expect(r.error).toBe("Necesitás permisos de administrador.");
    expect(mocks.edit).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("con admin: corrige SÓLO el texto y audita sin el concepto ni la nota", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    await editOtherIncomeAction({}, editForm());
    expect(mocks.edit).toHaveBeenCalledWith({
      id: 12,
      concept: "Alquiler del salón a Ramírez",
      note: "Pagó en mano",
    });
    // El monto y la fecha no son argumentos de esta acción: no hay forma de
    // que una corrección de texto mueva plata.
    expect(Object.keys(mocks.edit.mock.calls[0][0] as object).sort()).toEqual([
      "concept", "id", "note",
    ]);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      userId: 9, action: "other_income_edit", entity: "other_income", entityId: 12,
      detail: { fields: ["concept", "note"] },
    }));
    const asiento = JSON.stringify(auditedEntry());
    expect(asiento).not.toContain("Ramírez");
    expect(asiento).not.toContain("mano");
    expect(redirect).toHaveBeenCalledWith("/admin/tesoreria/otros-ingresos?corregido=1");
  });

  it("un concepto de dos letras se rechaza y no llega al módulo", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    const r = await editOtherIncomeAction({}, editForm({ concept: "no" }));
    expect(r.error).toBe("Ingresá a qué corresponde el ingreso.");
    expect(mocks.edit).not.toHaveBeenCalled();
  });

  it("un ingreso anulado no se corrige, y se distingue del inexistente", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.edit.mockResolvedValueOnce({ kind: "voided" });
    expect((await editOtherIncomeAction({}, editForm())).error).toBe(
      "Ese ingreso está anulado: un asiento anulado no se corrige.",
    );
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.edit.mockResolvedValueOnce({ kind: "not_found" });
    expect((await editOtherIncomeAction({}, editForm())).error).toBe("Ese ingreso ya no existe.");
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("un error nuestro no se muestra crudo: el message de Prisma trae el texto libre", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.edit.mockRejectedValueOnce(
      Object.assign(new Error("Alquiler del salón a Ramírez"), { code: "P2010" }),
    );
    const r = await editOtherIncomeAction({}, editForm());
    expect(r.error).toBe("No se pudo guardar la corrección. Reintentá en un momento.");
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});

describe("voidOtherIncomeAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.voidIncome.mockResolvedValue({ kind: "voided", reopened: false });
  });

  function voidForm(reason = "Se cargó dos veces el alquiler de Ramírez"): FormData {
    const form = new FormData();
    form.append("incomeId", "12");
    form.append("reason", reason);
    return form;
  }

  it("sin admin no anula, no audita y no redirige", async () => {
    const r = await voidOtherIncomeAction({}, voidForm());
    expect(r.error).toBe("Necesitás permisos de administrador.");
    expect(mocks.voidIncome).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("sin motivo no anula nada", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    const r = await voidOtherIncomeAction({}, voidForm("no"));
    expect(r.error).toBe("Indicá el motivo de la anulación.");
    expect(mocks.voidIncome).not.toHaveBeenCalled();
  });

  it("con admin: anula y audita SIN el motivo, dejando escrito si la fila volvió a la bandeja", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.voidIncome.mockResolvedValueOnce({ kind: "voided", reopened: true });
    await voidOtherIncomeAction({}, voidForm());
    expect(mocks.voidIncome).toHaveBeenCalledWith({
      id: 12, actorId: 9, reason: "Se cargó dos veces el alquiler de Ramírez",
    });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      userId: 9, action: "other_income_void", entity: "other_income", entityId: 12,
      detail: { reopened: true },
    }));
    expect(JSON.stringify(auditedEntry())).not.toContain("Ramírez");
    expect(redirect).toHaveBeenCalledWith("/admin/tesoreria/otros-ingresos?anulado=1");
  });

  it("un ingreso ya anulado no dice que se anuló, y no audita de nuevo", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.voidIncome.mockResolvedValueOnce({ kind: "already_voided" });
    const r = await voidOtherIncomeAction({}, voidForm());
    expect(r.error).toBe("Ese ingreso ya está anulado.");
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("un id que ya no existe se distingue del ya anulado", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: true, actorId: 9 });
    mocks.voidIncome.mockResolvedValueOnce({ kind: "not_found" });
    expect((await voidOtherIncomeAction({}, voidForm())).error).toBe("Ese ingreso ya no existe.");
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});
